import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { DataSource, EntityManager } from "typeorm";
import { returnedRows } from "../common/db/query-result";
import { withScopedDb } from "../common/db/scoped-db";
import { withSystemContext, withUserContext } from "../common/db/with-context";
import { todayYMD } from "../common/date-utils";
import {
  FetchSyncJob,
  FetchSyncService,
} from "../common/jobs/fetch-sync.service";
import { NetWorthService } from "../net-worth/net-worth.service";
import { enumerateDaysYMD } from "../net-worth/series-dates.util";
import { markHoldingAccountsDirty } from "../securities/holding-accounts-dirty.util";
import { invalidatePortfolioSummary } from "../securities/portfolio-summary-memo";
import { loadBondLedger } from "./bond-ledger";
import { BondLot, bondLotsAsOf } from "./bond-lots";
import {
  BondReferenceData,
  BondValuationService,
} from "./bond-valuation.service";
import { ExactDecimal } from "./domain/exact-decimal";

/**
 * The `security_prices.source` of a row this service writes. The one place the
 * literal is spelled; the upsert and the delete both bind it.
 */
export const BOND_ENGINE_PRICE_SOURCE = "bond_engine";

/** `security_prices.close_price` is NUMERIC(24,10). */
const PRICE_DECIMALS = 10;

export interface BondPriceRecompute {
  /** Rows inserted or changed. A day whose stored price already agrees is not counted. */
  readonly written: number;
  /** `bond_engine` rows of days that no longer get a price. */
  readonly deleted: number;
}

export interface RecomputeOptions {
  /** The last day priced (YYYY-MM-DD); today when omitted. A clock a test can set. */
  readonly today?: string;
}

/**
 * Writes the daily price of a bond-linked security from the bond engine
 * (spec 12.3, 12.4).
 *
 * For each calendar day from the first transaction to today, the unit price is
 * the sum of the open lots' gross values (the lots open ON that day, folded from
 * the ledger up to it) divided by the sum of their quantities, with exact
 * arithmetic, rounded half-up to the column's ten places. A day on which any
 * open lot has no gross value (a started period without a rate, INV-BOND-002)
 * gets no row, and neither does a day with no open lots or with lots that are
 * unknowable (a split, a fractional or over-removed quantity).
 *
 * A manual price or a transaction-derived price on the same day is never
 * overwritten: the upsert's `WHERE` admits only a `bond_engine` row, and an
 * unchanged day is not rewritten (INV-BOND-005). Rows of days that no longer get
 * a price are deleted. Reads and writes share one transaction; the derived state
 * (portfolio memo, net-worth snapshots) is invalidated after it commits, never
 * inside it (INV-CACHE-001).
 */
@Injectable()
export class BondPriceService {
  private readonly logger = new Logger(BondPriceService.name);

  /** Far shorter than the daily interval, so a killed replica never blocks tomorrow. */
  private readonly FETCH_LEASE_MS = 30 * 60 * 1000;

  constructor(
    private readonly dataSource: DataSource,
    private readonly valuation: BondValuationService,
    private readonly netWorthService: NetWorthService,
    private readonly fetchSync: FetchSyncService,
  ) {}

  /**
   * Daily, after the benchmark refresh (06:25 on weekdays): accrual moves every
   * calendar day, weekends included, so unlike the refresh this runs every day.
   *
   * Cross-user work with no request behind it, so it seeds its own system
   * context around the whole lease call (`docs/backend/cron-and-background-work.md`).
   * The lease is a cost control: the upserts converge however many replicas run.
   */
  // The timezone is spelled as a literal: cron-doc.spec.ts reads it from the decorator.
  @Cron("45 6 * * *", { timeZone: "Europe/Warsaw" })
  async scheduledRecompute(): Promise<void> {
    try {
      await withSystemContext(() =>
        this.fetchSync.withLease(
          FetchSyncJob.BondPrices,
          this.FETCH_LEASE_MS,
          async () => {
            await this.recomputeAll();
          },
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Scheduled bond price recompute failed: ${message}`);
    }
  }

  /**
   * Every linked security of every user, each user in its own context. One
   * security failing is logged and does not stop the rest. Needs an ambient
   * system identity (`withSystemContext`) for the cross-user listing.
   */
  async recomputeAll(
    options: RecomputeOptions = {},
  ): Promise<{ securities: number; failed: number }> {
    const linked: Array<{ id: string; user_id: string }> = await withScopedDb(
      this.dataSource,
      (m) =>
        m.query(
          `SELECT id, user_id FROM securities
            WHERE bond_instrument_id IS NOT NULL
            ORDER BY user_id, id`,
        ),
    );

    const byUser = new Map<string, string[]>();
    for (const row of linked) {
      byUser.set(row.user_id, [...(byUser.get(row.user_id) ?? []), row.id]);
    }

    let failed = 0;
    for (const [userId, securityIds] of byUser) {
      try {
        await withUserContext(userId, async () => {
          for (const securityId of securityIds) {
            try {
              await this.recomputeSecurity(userId, securityId, options);
            } catch (error) {
              failed += 1;
              this.logger.error(
                `Bond price recompute failed for security ${securityId}: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
            }
          }
        });
      } catch (error) {
        failed += securityIds.length;
        this.logger.error(
          `Bond price recompute failed for user ${userId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    this.logger.log(
      `Bond prices recomputed for ${linked.length} linked security/securities, ${failed} failed`,
    );
    return { securities: linked.length, failed };
  }

  /**
   * Recompute one linked security under the caller's identity. `userId` is the
   * owner (from the JWT, or the cron's per-user context); a security that is
   * not this user's, or not linked, is a 404.
   */
  async recomputeSecurity(
    userId: string,
    securityId: string,
    options: RecomputeOptions = {},
  ): Promise<BondPriceRecompute> {
    const today = options.today ?? todayYMD();

    const { result, accountIds } = await withScopedDb(
      this.dataSource,
      async (m) => {
        const ledger = await loadBondLedger(m, userId, securityId);
        const reference = await this.valuation.loadReference(
          m,
          ledger.security.bondInstrumentId,
        );
        const prices = this.dailyPrices(ledger.transactions, reference, today);

        const written = await this.upsertPrices(m, securityId, prices);
        const deleted = await this.deleteStalePrices(m, securityId, prices);
        const accountIds =
          written + deleted > 0
            ? await markHoldingAccountsDirty(m, securityId, userId)
            : [];
        return { result: { written, deleted }, accountIds };
      },
    );

    // After the commit, never inside it: a recompute started from within would
    // read the rows before they are visible.
    if (result.written + result.deleted > 0) {
      invalidatePortfolioSummary(userId);
      for (const accountId of accountIds) {
        this.netWorthService.triggerDebouncedRecalc(accountId, userId);
      }
    }
    return result;
  }

  /** The price of every day that has one, ascending. Pure over its inputs. */
  private dailyPrices(
    transactions: Parameters<typeof bondLotsAsOf>[0],
    reference: BondReferenceData,
    today: string,
  ): Array<{ date: string; price: string }> {
    const dated = transactions.filter((t) => t.status !== "VOID");
    if (dated.length === 0) return [];
    // Register order puts the earliest date first.
    const first = dated[0].transactionDate;

    const prices: Array<{ date: string; price: string }> = [];
    let lots: readonly BondLot[] | null = null;
    // Lots change only on a transaction date (the first day is one), so the
    // fold is redone only there and carried over the days between.
    const changeDates = new Set(dated.map((t) => t.transactionDate));

    for (const day of enumerateDaysYMD(first, today)) {
      if (changeDates.has(day)) lots = bondLotsAsOf(transactions, day).lots;
      if (lots === null || lots.length === 0) continue;

      const price = this.unitPrice(reference, lots, day);
      if (price !== null) prices.push({ date: day, price });
    }
    return prices;
  }

  /** Gross value of the open lots per bond, or null when any lot has none. */
  private unitPrice(
    reference: BondReferenceData,
    lots: readonly BondLot[],
    day: string,
  ): string | null {
    let total = ExactDecimal.ZERO;
    let quantity = 0;
    for (const lot of lots) {
      const { grossValue } = this.valuation.valueLotFrom(reference, lot, day);
      if (grossValue === null) return null;
      total = total.add(ExactDecimal.parse(grossValue));
      quantity += lot.quantity;
    }
    return total.div(ExactDecimal.fromInt(quantity)).toFixed(PRICE_DECIMALS);
  }

  /**
   * One statement. The `WHERE` is the whole rule: only a `bond_engine` row is
   * ever replaced, so a manual or transaction-derived price on the day wins, and
   * only when the close differs, so an unchanged day is not rewritten.
   */
  private async upsertPrices(
    m: EntityManager,
    securityId: string,
    prices: ReadonlyArray<{ date: string; price: string }>,
  ): Promise<number> {
    if (prices.length === 0) return 0;
    const rows: unknown = await m.query(
      // adjusted_close = close: an engine value has no split or distribution to
      // adjust for, and a series that holds any adjusted row reads only those.
      `INSERT INTO security_prices (security_id, price_date, close_price, adjusted_close, source)
       SELECT $1::uuid, t.d, t.p, t.p, $4::varchar
         FROM unnest($2::date[], $3::numeric[]) AS t(d, p)
       ON CONFLICT (security_id, price_date) DO UPDATE
          SET close_price = EXCLUDED.close_price,
              adjusted_close = EXCLUDED.adjusted_close
        WHERE security_prices.source = $4::varchar
          AND (security_prices.close_price IS DISTINCT FROM EXCLUDED.close_price
               OR security_prices.adjusted_close IS DISTINCT FROM EXCLUDED.adjusted_close)
       RETURNING id`,
      [
        securityId,
        prices.map((p) => p.date),
        prices.map((p) => p.price),
        BOND_ENGINE_PRICE_SOURCE,
      ],
    );
    return returnedRows<{ id: number }>(rows).length;
  }

  private async deleteStalePrices(
    m: EntityManager,
    securityId: string,
    prices: ReadonlyArray<{ date: string }>,
  ): Promise<number> {
    const rows: unknown = await m.query(
      `DELETE FROM security_prices
        WHERE security_id = $1
          AND source = $3::varchar
          AND NOT (price_date = ANY($2::date[]))
       RETURNING id`,
      [securityId, prices.map((p) => p.date), BOND_ENGINE_PRICE_SOURCE],
    );
    return returnedRows<{ id: number }>(rows).length;
  }
}
