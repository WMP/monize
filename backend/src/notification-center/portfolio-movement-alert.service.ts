import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { DataSource } from "typeorm";

import { withScopedDb } from "../common/db/scoped-db";
import { UserPreference } from "../users/entities/user-preference.entity";
import { withSystemContext, withUserContext } from "../common/db/with-context";
import { returnedRows } from "../common/db/query-result";
import {
  investmentLinkedSplitExclusion,
  investmentLinkedTransactionExclusion,
} from "../common/investment-filter.util";
import { todayYMD } from "../common/date-utils";
import { preferredCurrency } from "../common/default-currency.util";
import { ExchangeRateService } from "../currencies/exchange-rate.service";
import { PortfolioService } from "../securities/portfolio.service";
import { NotificationDispatchService } from "../notifications/notification-dispatch.service";
import {
  NotificationSeverity,
  NotificationType,
} from "./entities/notification.entity";
import { CreateNotificationInput } from "./notification.service";
import { FlowSubtotal, foldExternalFlow } from "./portfolio-flow.util";
import {
  NumberT,
  defaultNumberT,
  numberFormatterFor,
} from "../common/number-locale.util";
import {
  FiredMovement,
  MovementInputs,
  decideMovement,
} from "./portfolio-movement.util";

/** A user's opted-in threshold and stored baseline, read for one evaluation. */
interface PortfolioStateRow {
  move_alert_percent: string | null;
  baseline_value: string | null;
  baseline_currency: string | null;
  baseline_captured_on: string | null;
}

/**
 * Daily notification of the market-driven change in a user's investment-account
 * value, net of external cash flows -- so a deposit does not fire a false gain
 * and a dividend is return, not a loss
 * (`docs/specs/portfolio-movement-notifications.md`).
 *
 * The measure is `MV(today) - MV(baseline) - externalFlow`: today's portfolio
 * value from `getPortfolioSummary` (holdings + cash, in the reporting currency,
 * with its own completeness flag), the last COMPLETE value the producer stored,
 * and the day's cash that crossed the investment-account boundary from outside.
 * A subtotal is never fired and never becomes a baseline (INV-PORTMOVE-001).
 *
 * The withhold policy and the arithmetic live in `decideMovement`
 * (`portfolio-movement.util.ts`) and the flow conversion in `foldExternalFlow`
 * (`portfolio-flow.util.ts`); both are pure and unit-tested. This service is the
 * cron plumbing, the flow query and the baseline read-modify-write.
 */
@Injectable()
export class PortfolioMovementAlertService {
  private readonly logger = new Logger(PortfolioMovementAlertService.name);
  private running = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly portfolio: PortfolioService,
    private readonly exchangeRates: ExchangeRateService,
    private readonly dispatch: NotificationDispatchService,
  ) {}

  /**
   * Daily on weekdays, after the security-price (5 PM ET), market-index
   * (5:10 PM ET) and GEM (5:30 PM ET) jobs, so today's value is priced.
   */
  @Cron("40 17 * * 1-5", { timeZone: "America/New_York" })
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const userIds = await withSystemContext(() =>
        withScopedDb(this.dataSource, async (manager) =>
          returnedRows<{ user_id: string }>(
            await manager.query(
              `SELECT user_id FROM notification_portfolio_state
                WHERE move_alert_percent IS NOT NULL AND move_alert_percent > 0`,
            ),
          ).map((row) => row.user_id),
        ),
      );

      let fired = 0;
      for (const userId of userIds) {
        try {
          const raised = await withUserContext(userId, () =>
            this.evaluateUser(userId),
          );
          if (raised) fired += 1;
        } catch (error) {
          this.logger.error(
            `Portfolio-movement evaluation failed for user ${userId}`,
            error instanceof Error ? error.stack : error,
          );
        }
      }
      if (fired > 0) {
        this.logger.log(`Raised ${fired} portfolio-movement alert(s)`);
      }
    } catch (error) {
      this.logger.error(
        "Portfolio-movement cron failed",
        error instanceof Error ? error.stack : error,
      );
    } finally {
      this.running = false;
    }
  }

  /** Evaluate one user; returns whether an alert was raised. */
  private async evaluateUser(userId: string): Promise<boolean> {
    const today = todayYMD();
    const currency = await this.reportingCurrency(userId);
    const summary = await this.portfolio.getPortfolioSummary(userId);
    const state = await this.loadState(userId);
    const movePercent =
      state?.move_alert_percent == null
        ? null
        : Number(state.move_alert_percent);

    const baseline =
      state?.baseline_value != null && state.baseline_currency != null
        ? {
            value: Number(state.baseline_value),
            currency: state.baseline_currency,
          }
        : null;

    // The flow only matters when there is a same-currency baseline to compare
    // against; otherwise the decision rebaselines or withholds before reading it.
    const flow =
      baseline != null &&
      baseline.currency === currency &&
      state?.baseline_captured_on != null &&
      summary.valuationComplete === true
        ? await this.externalFlow(
            userId,
            state.baseline_captured_on,
            today,
            currency,
          )
        : { complete: true, value: 0 };

    const inputs: MovementInputs = {
      mvComplete: summary.valuationComplete === true,
      mvToday: summary.totalPortfolioValue,
      currency,
      baseline,
      flow,
      movePercent,
    };
    const decision = decideMovement(inputs);

    if (decision.rebaselineTo != null) {
      await this.storeBaseline(userId, decision.rebaselineTo, currency, today);
    }
    if (decision.fire == null) return false;

    const prefs = await withScopedDb(this.dataSource, (m) =>
      m.getRepository(UserPreference).findOne({ where: { userId } }),
    );
    const written = await this.dispatch.notify(
      userId,
      buildPortfolioNotification(
        decision.fire,
        currency,
        today,
        numberFormatterFor(prefs?.numberFormat, prefs?.language),
      ),
    );
    return written != null;
  }

  /** The user's reporting currency, resolved through the one shared reader. */
  private async reportingCurrency(userId: string): Promise<string> {
    return withScopedDb(this.dataSource, async (manager) => {
      const rows = returnedRows<{ default_currency: string | null }>(
        await manager.query(
          "SELECT default_currency FROM user_preferences WHERE user_id = $1",
          [userId],
        ),
      );
      return preferredCurrency({ defaultCurrency: rows[0]?.default_currency });
    });
  }

  private async loadState(userId: string): Promise<PortfolioStateRow | null> {
    return withScopedDb(this.dataSource, async (manager) => {
      const rows = returnedRows<PortfolioStateRow>(
        await manager.query(
          `SELECT move_alert_percent, baseline_value, baseline_currency,
                  TO_CHAR(baseline_captured_on, 'YYYY-MM-DD') AS baseline_captured_on
             FROM notification_portfolio_state WHERE user_id = $1`,
          [userId],
        ),
      );
      return rows[0] ?? null;
    });
  }

  private async storeBaseline(
    userId: string,
    value: number,
    currency: string,
    capturedOn: string,
  ): Promise<void> {
    await withScopedDb(this.dataSource, (manager) =>
      manager.query(
        `INSERT INTO notification_portfolio_state
           (user_id, baseline_value, baseline_currency, baseline_captured_on)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id) DO UPDATE
           SET baseline_value = $2,
               baseline_currency = $3,
               baseline_captured_on = $4`,
        [userId, value, currency, capturedOn],
      ),
    );
  }

  /**
   * The net cash that crossed the investment-account boundary from outside since
   * `sinceDate` (exclusive) through `today` (inclusive), in `reportingCurrency`.
   *
   * Included: ordinary deposits/withdrawals and transfers whose counterparty is
   * NOT an investment account. Excluded (internal): investment-linked cash legs
   * (BUY/SELL/DIVIDEND), transfers whose counterparty is also an investment
   * account, and VOID or future-dated rows. The investment-leg exclusion is the
   * shared predicate from `investment-filter.util.ts`
   * (`investmentLinkedTransactionExclusion` for a top-level row,
   * `investmentLinkedSplitExclusion` for an embedded split line) rather than a
   * hand-rolled one -- INV-PORTMOVE-006 requires it, and a hand-rolled copy had
   * joined `investment_transactions.transaction_split_id` (a `transaction_splits`
   * FK) against `transactions.id`, a table mismatch that made the split
   * exclusion a silent no-op. Grouped by account currency and converted through
   * the shared rate service; a currency with no rate makes the flow incomplete
   * (the movement is then withheld).
   *
   * TWO KNOWN COARSE CASES (INV-PORTMOVE, tracked in the spec's open items),
   * both narrowing rather than corrupting the common path:
   *  - A split parent that mixes an embedded investment line with an ordinary
   *    external cash line is excluded WHOLE (it sums `t.amount`, so it cannot
   *    keep one line and drop another). The line-granular form -- summing only
   *    the ordinary external children, `reportableTransactionAmount`'s dialect --
   *    is a spec-guided follow-up, because the flow's transfer policy (a transfer
   *    OUT of the set counts) differs from that helper's (it drops all transfers).
   *  - A BUY/SELL funded from an account OUTSIDE the investment set (an explicit
   *    `fundingAccountId` on an ordinary account) moves value into the set with
   *    no cash leg in the set, so this flow cannot see it and the purchase reads
   *    as a market move. The spec treats BUY/SELL as internal; widening that is a
   *    maintainer decision, not a coded defect.
   *
   * NOTE: verified by unit tests only at the fold layer; the SQL classification
   * needs the integration environment (a real database with the investment
   * account pair and an embedded-investment split) to confirm end to end.
   */
  private async externalFlow(
    userId: string,
    sinceDate: string,
    today: string,
    reportingCurrency: string,
  ): Promise<{ complete: boolean; value: number }> {
    const subtotals = await withScopedDb(this.dataSource, async (manager) =>
      returnedRows<{ currency: string; total: string }>(
        await manager.query(
          `SELECT t.currency_code AS currency, SUM(t.amount) AS total
             FROM transactions t
             JOIN accounts a ON a.id = t.account_id
            WHERE t.user_id = $1
              AND a.account_type = 'INVESTMENT'
              AND t.parent_transaction_id IS NULL
              AND t.transaction_date > $2
              AND t.transaction_date <= $3
              AND t.status IS DISTINCT FROM 'VOID'
              AND ${investmentLinkedTransactionExclusion("t")}
              AND NOT EXISTS (
                SELECT 1 FROM transaction_splits s
                 WHERE s.transaction_id = t.id
                   AND NOT (${investmentLinkedSplitExclusion("s")})
              )
              AND NOT (
                t.is_transfer = true
                AND EXISTS (
                  SELECT 1 FROM transactions lt
                   JOIN accounts la ON la.id = lt.account_id
                   WHERE lt.id = t.linked_transaction_id
                     AND la.account_type = 'INVESTMENT'
                )
              )
            GROUP BY t.currency_code`,
          [userId, sinceDate, today],
        ),
      ),
    );

    const flowRows: FlowSubtotal[] = subtotals.map((row) => ({
      currency: row.currency,
      amount: Number(row.total),
    }));

    // Resolve each currency's rate into the reporting currency, once.
    const rates = new Map<string, number | null>();
    for (const { currency } of flowRows) {
      if (rates.has(currency)) continue;
      rates.set(
        currency,
        currency === reportingCurrency
          ? 1
          : await this.exchangeRates.getRateForDate(
              currency,
              reportingCurrency,
              today,
            ),
      );
    }

    const folded = foldExternalFlow(
      flowRows,
      reportingCurrency,
      (currency) => rates.get(currency) ?? null,
    );
    return { complete: folded.complete, value: folded.value };
  }
}

/**
 * The notification a fired movement raises, as a pure function of the movement
 * and the reporting currency -- so the type/severity, deep link and `data`
 * snapshot are testable without the cron. Dedupe key carries the day, so at most
 * one movement alert exists per day.
 */
export function buildPortfolioNotification(
  fire: FiredMovement,
  currency: string,
  today: string,
  n: NumberT = defaultNumberT,
): CreateNotificationInput {
  return {
    type: NotificationType.PORTFOLIO_MOVEMENT,
    severity: NotificationSeverity.INFO,
    title: "Investment value moved",
    message:
      fire.direction === "up"
        ? `Your investments are up ${n.formatPercentTrimmed(fire.changePercent)} today (excluding deposits). Open Monize for the details.`
        : `Your investments are down ${n.formatPercentTrimmed(Math.abs(fire.changePercent))} today (excluding deposits). Open Monize for the details.`,
    data: {
      changePercent: fire.changePercent,
      direction: fire.direction,
      movementValue: fire.movementValue,
      currencyCode: currency,
    },
    target: "/investments",
    dedupeKey: `portmove:${currency}:${today}`,
  };
}
