import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { DataSource, In, LessThanOrEqual } from "typeorm";
import {
  runOutsideActiveScopedManager,
  withScopedDb,
} from "../common/db/scoped-db";
import { lockAccountsForBalanceWrite } from "../common/db/locks";
import { withSystemContext, withUserContext } from "../common/db/with-context";
import { MonthlyAccountBalance } from "./entities/monthly-account-balance.entity";
import {
  Account,
  AccountType,
  AccountSubType,
} from "../accounts/entities/account.entity";
import {
  InvestmentTransaction,
  InvestmentAction,
} from "../securities/entities/investment-transaction.entity";
import { Security } from "../securities/entities/security.entity";
import { UserPreference } from "../users/entities/user-preference.entity";
import { convertWithRateLookup } from "../common/currency-conversion.util";
import { formatDateYMDLocal } from "../common/date-utils";

const LIABILITY_TYPES: AccountType[] = [
  AccountType.CREDIT_CARD,
  AccountType.LOAN,
  AccountType.MORTGAGE,
  AccountType.LINE_OF_CREDIT,
];

type RateIndex = Map<string, Array<{ date: string; rate: number }>>;

/**
 * Joint accounts to include in a grantee's net worth (joint-accounts spec,
 * N1). Built by the HTTP controller from the caller's active joint grants
 * MINUS their delegate_net_worth_exclusions -- inclusion here IS the
 * authorization and the preference, so the service applies no further
 * filtering (in particular, the OWNER's exclude_from_net_worth flag governs
 * the owner's view only and is deliberately not consulted for these rows).
 * Absent (undefined) everywhere else -- AI tools, internal calls -- which
 * keeps every existing path byte-identical.
 */
export interface JointNetWorthScope {
  accounts: Array<{ accountId: string; ownerUserId: string }>;
}

export type InvestmentBreakdownGranularity = "daily" | "monthly";

/**
 * One stacked band on the Portfolio Value Over Time "by security" chart. A
 * band is either an individual held security, the rolled-up "other" bucket of
 * smaller holdings beyond the top-N cutoff, or the aggregate cash band. Only
 * securities carry `symbol`/`name`; `cash` and `other` are labelled on the
 * client so their copy stays localized.
 */
export interface InvestmentBreakdownSeries {
  /** securityId for a real holding, or the sentinel "cash" / "other". */
  key: string;
  type: "security" | "cash" | "other";
  symbol: string | null;
  name: string;
}

export interface InvestmentBreakdownPoint {
  /** YYYY-MM-DD; the month-first date for monthly granularity. */
  date: string;
  /** Sum of every band's value at this point (in the display currency). */
  total: number;
  /** Per-series value keyed by {@link InvestmentBreakdownSeries.key}. */
  values: Record<string, number>;
}

export interface InvestmentBreakdown {
  granularity: InvestmentBreakdownGranularity;
  currency: string;
  series: InvestmentBreakdownSeries[];
  points: InvestmentBreakdownPoint[];
}

@Injectable()
export class NetWorthService {
  private readonly logger = new Logger(NetWorthService.name);
  private readonly recalcTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private static readonly RECALC_DEBOUNCE_MS = 2000;

  /**
   * How stale a snapshot may be, relative to its account's last change, before
   * the sweep recomputes it.
   *
   * Comfortably longer than the debounce plus a slow recalc, so the sweep does
   * not race the timer that is about to do the same work.
   */
  private static readonly STALE_SNAPSHOT_GRACE_MS = 10 * 60 * 1000;

  /** Accounts recomputed per sweep, so a broken deployment cannot melt the pool. */
  private static readonly STALE_SWEEP_BATCH = 200;

  constructor(private dataSource: DataSource) {}

  /**
   * One raw statement in its own short scoped transaction -- the RLS-compliant
   * equivalent of the autocommit `dataSource.query` this service used before
   * the migration. Reporting reads here are independent single statements, so
   * each gets its own tenant transaction rather than one long-held connection.
   */
  private scopedQuery<T = any>(sql: string, params?: any[]): Promise<T> {
    return withScopedDb(this.dataSource, (m) => m.query(sql, params));
  }

  /**
   * Debounced trigger for recalculating a single account's net worth snapshots.
   *
   * The timer lives in this process's memory, so it is a latency optimization and
   * nothing more: a pod killed in the two seconds before it fires, or a recalc
   * that throws, loses the work with only a `warn` to show for it, and the
   * snapshots then disagree with the ledger until something else happens to
   * touch the account (audit DR-04-03). `sweepStaleSnapshots` is what makes that
   * recoverable -- it finds the disagreement in the data rather than needing a
   * queue entry that the same crash would have lost.
   */
  triggerDebouncedRecalc(accountId: string, userId: string): void {
    const key = `${userId}:${accountId}`;
    const existing = this.recalcTimers.get(key);
    if (existing) clearTimeout(existing);

    // Several callers trigger this from *inside* a `withScopedDb` block (see
    // TransactionSplitService.createSplits). A timer created there would
    // inherit that block's EntityManager through the scoped-manager ALS, and
    // fire seconds later -- long after the transaction committed and its
    // connection went back to the pool -- so every query in the recalc would
    // run on a dead manager. Registering the timer outside the active manager
    // makes the recalc open its own transaction, which is what it wants
    // anyway: it is a background job, not part of the caller's write. The
    // identity context (userId) lives in a different ALS and is preserved.
    runOutsideActiveScopedManager(() =>
      this.recalcTimers.set(
        key,
        setTimeout(() => {
          this.recalcTimers.delete(key);
          this.recalculateAccount(userId, accountId).catch((err) =>
            this.logger.warn(
              `Net worth recalc failed for account ${accountId}: ${err.message}`,
            ),
          );
        }, NetWorthService.RECALC_DEBOUNCE_MS),
      ),
    );
  }

  async recalculateAccount(userId: string, accountId: string): Promise<void> {
    await withScopedDb(this.dataSource, async (m) => {
      // The lock first, then every read the snapshots are derived from, then the
      // delete-and-reinsert -- all in this transaction.
      //
      // Previously the monthly sums were read in one autocommit transaction and
      // written in another. Under READ COMMITTED that is two statement snapshots:
      // a transaction committing between them produced snapshots that did not
      // include it, permanently, until something else triggered a recalc. Two
      // concurrent recalcs of the same account were worse -- whichever wrote
      // second won, and it might be the one that read first, so the newer data
      // lost. Same protocol as every other absolute recomputation here: advisory
      // and row locks before the read they protect (see common/db/locks.ts).
      await lockAccountsForBalanceWrite(m, [accountId], userId);

      const account = await m.getRepository(Account).findOne({
        where: { id: accountId, userId },
      });
      if (!account) return;

      await this.recalculateLockedAccount(userId, account);
    });
  }

  /**
   * Recompute snapshots that no longer agree with their account.
   *
   * The debounce timer is process memory, so every way it can be lost -- a pod
   * killed inside the two-second window, a recalc that throws, a rolling deploy
   * -- leaves snapshots that disagree with the ledger and nothing that will ever
   * notice. A durable work queue would not help: the crash that loses the timer
   * loses the enqueue too, unless the enqueue joins the caller's transaction, and
   * then every write path has to know about net worth.
   *
   * So the staleness is *derived* rather than recorded. Every write that can
   * change a snapshot also moves the account's `current_balance` in the same
   * transaction, so `accounts.updated_at` is a timestamp the account itself keeps
   * -- and the snapshots are a delete-and-reinsert, so their `updated_at` is when
   * they were last computed. An account whose row is newer than its own snapshots
   * by more than the grace period was missed.
   *
   * This is the idempotent-predicate mechanism from `docs/cron-jobs.md`: two
   * replicas racing the sweep recompute the same accounts from scratch, under the
   * per-account lock, and the loser's work is simply redundant. Accounts with no
   * snapshots at all are deliberately not swept -- there is nothing to compare
   * against, and including them would recompute every empty account forever.
   */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async sweepStaleSnapshots(): Promise<void> {
    try {
      const stale = await withSystemContext(() =>
        withScopedDb(this.dataSource, (m) =>
          m.query(
            `SELECT a.user_id, a.id AS account_id
               FROM accounts a
               JOIN (
                 SELECT account_id, MAX(updated_at) AS computed_at
                   FROM monthly_account_balances
                  GROUP BY account_id
               ) s ON s.account_id = a.id
              WHERE a.updated_at > s.computed_at + ($1::text || ' milliseconds')::interval
              ORDER BY a.updated_at
              LIMIT $2`,
            [
              String(NetWorthService.STALE_SNAPSHOT_GRACE_MS),
              NetWorthService.STALE_SWEEP_BATCH,
            ],
          ),
        ),
      );

      if (stale.length === 0) return;

      this.logger.log(
        `Recomputing ${stale.length} account(s) whose net-worth snapshots fell behind`,
      );
      if (stale.length === NetWorthService.STALE_SWEEP_BATCH) {
        // Say so rather than letting a truncated pass read as "all caught up".
        this.logger.warn(
          `Stale snapshot sweep hit its batch limit of ${NetWorthService.STALE_SWEEP_BATCH}; more remain for the next pass`,
        );
      }

      for (const row of stale as Array<{
        user_id: string;
        account_id: string;
      }>) {
        try {
          await withUserContext(row.user_id, () =>
            this.recalculateAccount(row.user_id, row.account_id),
          );
        } catch (err) {
          this.logger.warn(
            `Stale snapshot recompute failed for account ${row.account_id}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    } catch (err) {
      this.logger.warn(
        `Stale snapshot sweep failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Dispatch for an account whose row is already locked inside the ambient
   * transaction. The two branches' own `withScopedDb`/`scopedQuery` calls join it.
   */
  private async recalculateLockedAccount(
    userId: string,
    account: Account,
  ): Promise<void> {
    if (this.isBrokerageOrStandaloneInvestment(account)) {
      await this.recalculateBrokerageAccount(userId, account);
    } else {
      await this.recalculateRegularAccount(userId, account);
    }
  }

  async recalculateAllAccounts(userId: string): Promise<void> {
    // Include closed accounts - they have important historical balances
    const accounts = await withScopedDb(this.dataSource, (m) =>
      m.getRepository(Account).find({
        where: { userId },
      }),
    );
    await Promise.all(
      accounts.map(async (account) => {
        try {
          // One locked transaction per account, exactly as the single-account
          // path: a full-user rebuild racing an ordinary edit must not write a
          // snapshot derived from rows that changed while it was reading.
          await this.recalculateAccount(userId, account.id);
        } catch (err) {
          this.logger.warn(
            `Failed to recalculate account ${account.id}: ${err.message}`,
          );
        }
      }),
    );
  }

  async ensurePopulated(userId: string): Promise<void> {
    const count = await withScopedDb(this.dataSource, (m) =>
      m.getRepository(MonthlyAccountBalance).count({ where: { userId } }),
    );
    if (count === 0) {
      await this.recalculateAllAccounts(userId);
      return;
    }

    await this.refreshStaleAccountsForCurrentMonth(userId);
  }

  /**
   * Per-account recalc is debounced and only runs when an account's
   * transactions change. When the calendar rolls into a new month, accounts
   * that haven't been touched still have snapshots ending in the previous
   * month, so they don't contribute to the new month's aggregate -- causing
   * the chart to drop to whatever subset of accounts had a transaction post
   * since the month rolled over. Detect those stale accounts and refresh them.
   */
  private async refreshStaleAccountsForCurrentMonth(
    userId: string,
  ): Promise<void> {
    const now = new Date();
    const currentMonthStr = `${now.getFullYear()}-${String(
      now.getMonth() + 1,
    ).padStart(2, "0")}-01`;

    const accounts = await withScopedDb(this.dataSource, (m) =>
      m.getRepository(Account).find({
        where: { userId },
        select: ["id"],
      }),
    );
    if (accounts.length === 0) return;

    const populated = await withScopedDb(this.dataSource, (m) =>
      m.getRepository(MonthlyAccountBalance).find({
        where: { userId, month: currentMonthStr },
        select: ["accountId"],
      }),
    );
    const populatedIds = new Set(populated.map((p) => p.accountId));

    const staleIds = accounts
      .map((a) => a.id)
      .filter((id) => !populatedIds.has(id));
    if (staleIds.length === 0) return;

    await Promise.all(
      staleIds.map((id) =>
        this.recalculateAccount(userId, id).catch((err) =>
          this.logger.warn(
            `Failed to refresh stale net worth for account ${id}: ${err.message}`,
          ),
        ),
      ),
    );
  }

  /**
   * Joint accounts' snapshots are owner-maintained, so ensurePopulated
   * (keyed to the caller) never refreshes them: when the calendar rolls into
   * a new month before the owner's next recalc, the grantee's chart would
   * silently drop the joint account from the current month. Refresh each
   * stale joint account under ITS OWNER's context -- identity-correct writes
   * (mab rows carry the owner's user_id) that both users then see.
   */
  private async refreshStaleJointMonths(
    scope: JointNetWorthScope,
  ): Promise<void> {
    const now = new Date();
    const currentMonthStr = `${now.getFullYear()}-${String(
      now.getMonth() + 1,
    ).padStart(2, "0")}-01`;

    const ids = scope.accounts.map((a) => a.accountId);
    // Readable in the grantee's session (migration-134 arm at enforcement).
    const populated = await withScopedDb(this.dataSource, (m) =>
      m.getRepository(MonthlyAccountBalance).find({
        where: { accountId: In(ids), month: currentMonthStr },
        select: ["accountId"],
      }),
    );
    const populatedIds = new Set(populated.map((p) => p.accountId));

    const stale = scope.accounts.filter((a) => !populatedIds.has(a.accountId));
    await Promise.all(
      stale.map(({ accountId, ownerUserId }) =>
        withUserContext(ownerUserId, () =>
          this.recalculateAccount(ownerUserId, accountId),
        ).catch((err) =>
          this.logger.warn(
            `Failed to refresh stale joint net worth for account ${accountId}: ${err.message}`,
          ),
        ),
      ),
    );
  }

  /**
   * Check if an account is a brokerage or standalone investment account
   * (i.e. an account that can hold securities and needs market value tracking)
   */
  private isBrokerageOrStandaloneInvestment(account: Account): boolean {
    return (
      account.accountSubType === AccountSubType.INVESTMENT_BROKERAGE ||
      (account.accountType === AccountType.INVESTMENT &&
        !account.accountSubType)
    );
  }

  /**
   * Recalculate monthly snapshots for all investment accounts that have holdings.
   * Called after security prices are refreshed to keep chart data in sync.
   */
  async recalculateAllInvestmentSnapshots(): Promise<void> {
    const accounts = await withScopedDb(this.dataSource, (m) =>
      m
        .getRepository(Account)
        .createQueryBuilder("a")
        .where("a.accountType = :type", { type: AccountType.INVESTMENT })
        .andWhere(
          "(a.accountSubType = :brokerage OR a.accountSubType IS NULL)",
          { brokerage: AccountSubType.INVESTMENT_BROKERAGE },
        )
        .getMany(),
    );

    await Promise.all(
      accounts.map(async (account) => {
        try {
          await this.recalculateBrokerageAccount(account.userId, account);
        } catch (err) {
          this.logger.warn(
            `Failed to recalculate investment snapshot for account ${account.id}: ${err.message}`,
          );
        }
      }),
    );
  }

  /**
   * Monthly net worth history shaped for LLM tools. Shared by the AI
   * Assistant and MCP `generate_report` tools (type `net_worth_history`) so
   * both surfaces return the same data with the same default range (last 12
   * months if no dates provided).
   */
  async getLlmHistory(
    userId: string,
    startDate?: string,
    endDate?: string,
  ): Promise<
    { month: string; assets: number; liabilities: number; netWorth: number }[]
  > {
    const today = new Date();
    const defaultStart = new Date(today.getFullYear() - 1, today.getMonth(), 1)
      .toISOString()
      .substring(0, 10);
    const resolvedStart = startDate || defaultStart;
    const resolvedEnd = endDate || today.toISOString().substring(0, 10);
    return this.getMonthlyNetWorth(userId, resolvedStart, resolvedEnd);
  }

  async getMonthlyNetWorth(
    userId: string,
    startDate?: string,
    endDate?: string,
    jointScope?: JointNetWorthScope,
  ): Promise<
    { month: string; assets: number; liabilities: number; netWorth: number }[]
  > {
    await this.ensurePopulated(userId);
    const jointIds = jointScope?.accounts.map((a) => a.accountId) ?? [];
    if (jointScope && jointIds.length > 0) {
      await this.refreshStaleJointMonths(jointScope);
    }

    const pref = await withScopedDb(this.dataSource, (m) =>
      m.getRepository(UserPreference).findOne({ where: { userId } }),
    );
    const defaultCurrency = pref?.defaultCurrency || "USD";

    const start = startDate || "1990-01-01";
    const end = endDate || new Date().toISOString().slice(0, 10);

    // Own rows keep the owner-side exclude_from_net_worth predicate; joint
    // rows are governed solely by the pre-filtered scope (see
    // JointNetWorthScope). One predicate for the series and (via
    // getLatestNetWorth) the latest month, so the two can never disagree.
    const snapshots: any[] = await this.scopedQuery(
      `SELECT mab.month, mab.balance, mab.market_value,
              a.id as account_id, a.account_type, a.account_sub_type, a.currency_code
       FROM monthly_account_balances mab
       JOIN accounts a ON a.id = mab.account_id
       WHERE ((mab.user_id = $1 AND a.exclude_from_net_worth = false)
              OR mab.account_id = ANY($4::UUID[]))
         AND mab.month >= DATE_TRUNC('month', $2::DATE)
         AND mab.month <= DATE_TRUNC('month', $3::DATE)
       ORDER BY mab.month`,
      [userId, start, end, jointIds],
    );

    if (snapshots.length === 0) return [];

    // Collect currencies that need conversion
    const currencies = new Set<string>();
    for (const s of snapshots) {
      if (s.currency_code !== defaultCurrency) {
        currencies.add(s.currency_code);
      }
    }

    const rateIndex = await this.buildRateIndex(
      currencies,
      defaultCurrency,
      start,
      end,
    );

    // Aggregate by month
    const monthMap = new Map<string, { assets: number; liabilities: number }>();

    for (const s of snapshots) {
      const monthKey = this.toDateString(s.month);

      if (!monthMap.has(monthKey)) {
        monthMap.set(monthKey, { assets: 0, liabilities: 0 });
      }
      const entry = monthMap.get(monthKey)!;

      // For brokerage accounts: use market_value (holdings only; cash is in linked account)
      // For standalone investment accounts: use market_value + balance (holdings + cash)
      // For all others: use balance
      let rawValue: number;
      if (
        s.account_sub_type === "INVESTMENT_BROKERAGE" &&
        s.market_value != null
      ) {
        rawValue = Number(s.market_value);
      } else if (
        s.account_type === "INVESTMENT" &&
        s.account_sub_type === null &&
        s.market_value != null
      ) {
        rawValue = Number(s.market_value) + Number(s.balance);
      } else {
        rawValue = Number(s.balance);
      }

      // Compute month-end date for rate lookup
      const monthEnd = this.monthEndDate(monthKey);
      const converted = this.convertCurrency(
        rawValue,
        s.currency_code,
        defaultCurrency,
        monthEnd,
        rateIndex,
      );

      const accountType = s.account_type as AccountType;
      if (LIABILITY_TYPES.includes(accountType)) {
        entry.liabilities += Math.abs(converted);
      } else {
        entry.assets += converted;
      }
    }

    return Array.from(monthMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => ({
        month,
        assets: Math.round(data.assets),
        liabilities: Math.round(data.liabilities),
        netWorth: Math.round(data.assets - data.liabilities),
      }));
  }

  /**
   * Latest-month net worth only. The account summary and the
   * `get_account_balances` tool need just the most recent month's
   * assets/liabilities/netWorth, not the whole series. Bounding the snapshot
   * query and rate index to a single month avoids replaying the entire
   * monthly_account_balances history just to read the last element. Returns
   * null when the user has no populated snapshots.
   */
  async getLatestNetWorth(
    userId: string,
    jointScope?: JointNetWorthScope,
  ): Promise<{ assets: number; liabilities: number; netWorth: number } | null> {
    await this.ensurePopulated(userId);

    const jointIds = jointScope?.accounts.map((a) => a.accountId) ?? [];
    const latestRows: { month: string | Date }[] = await this.scopedQuery(
      `SELECT MAX(month) AS month FROM monthly_account_balances
        WHERE user_id = $1 OR account_id = ANY($2::UUID[])`,
      [userId, jointIds],
    );
    const latestMonth = latestRows[0]?.month;
    if (!latestMonth) return null;

    const monthStr = this.toDateString(latestMonth);
    const months = await this.getMonthlyNetWorth(
      userId,
      monthStr,
      monthStr,
      jointScope,
    );
    const latest = months[months.length - 1];
    if (!latest) return null;
    return {
      assets: latest.assets,
      liabilities: latest.liabilities,
      netWorth: latest.netWorth,
    };
  }

  async getMonthlyInvestments(
    userId: string,
    startDate?: string,
    endDate?: string,
    accountIds?: string[],
    displayCurrency?: string,
  ): Promise<{ month: string; value: number }[]> {
    await this.ensurePopulated(userId);

    const pref = await withScopedDb(this.dataSource, (m) =>
      m.getRepository(UserPreference).findOne({ where: { userId } }),
    );
    const defaultCurrency = displayCurrency || pref?.defaultCurrency || "USD";

    const start = startDate || "1990-01-01";
    const end = endDate || new Date().toISOString().slice(0, 10);

    let accountFilter = "";
    const params: any[] = [userId, start, end];

    if (accountIds && accountIds.length > 0) {
      // Resolve the requested accounts plus their linked pairs in one query
      // (an account, anything linked to it, and the account it links to)
      // instead of one round-trip per id.
      const resolved: { id: string }[] = await this.scopedQuery(
        `SELECT id FROM accounts
         WHERE user_id = $2
           AND (
             id = ANY($1)
             OR linked_account_id = ANY($1)
             OR id IN (
               SELECT linked_account_id FROM accounts
               WHERE id = ANY($1) AND user_id = $2
             )
           )`,
        [accountIds, userId],
      );
      const idArray = [...new Set(resolved.map((a) => a.id))];
      if (idArray.length === 0) {
        // No matching accounts found — return empty result
        return [];
      }
      // Build parameterized IN clause
      const placeholders = idArray.map((_, i) => `$${i + 4}`).join(", ");
      accountFilter = `AND a.id IN (${placeholders})`;
      params.push(...idArray);
    } else {
      accountFilter = `AND (a.account_sub_type IN ('INVESTMENT_CASH', 'INVESTMENT_BROKERAGE') OR (a.account_type = 'INVESTMENT' AND a.account_sub_type IS NULL))`;
    }

    const snapshots: any[] = await this.scopedQuery(
      `SELECT mab.month, mab.balance, mab.market_value,
              a.id as account_id, a.account_type, a.account_sub_type, a.currency_code
       FROM monthly_account_balances mab
       JOIN accounts a ON a.id = mab.account_id
       WHERE mab.user_id = $1
         AND mab.month >= DATE_TRUNC('month', $2::DATE)
         AND mab.month <= DATE_TRUNC('month', $3::DATE)
         ${accountFilter}
       ORDER BY mab.month`,
      params,
    );

    if (snapshots.length === 0) return [];

    // For the first active month of an account, the stored market_value is the
    // month-end snapshot which silently absorbs any gains/losses on positions
    // that were established earlier the same month -- skewing the chart's
    // change column. Replace that first-month market_value with a cost-basis
    // computed from the in-month brokerage transactions so the starting point
    // reflects the actual net invested.
    const firstMonthCostBasisInDefault =
      await this.computeFirstActiveMonthCostBasis(
        userId,
        snapshots,
        defaultCurrency,
        start,
        end,
      );

    const currencies = new Set<string>();
    for (const s of snapshots) {
      if (s.currency_code !== defaultCurrency) {
        currencies.add(s.currency_code);
      }
    }

    const rateIndex = await this.buildRateIndex(
      currencies,
      defaultCurrency,
      start,
      end,
    );

    const monthMap = new Map<string, number>();

    for (const s of snapshots) {
      const monthKey = this.toDateString(s.month);

      if (!monthMap.has(monthKey)) {
        monthMap.set(monthKey, 0);
      }

      const monthEnd = this.monthEndDate(monthKey);
      const adjKey = `${s.account_id}:${monthKey}`;
      const costBasisInDefault = firstMonthCostBasisInDefault.get(adjKey);

      let convertedValue: number;
      if (costBasisInDefault !== undefined) {
        convertedValue = costBasisInDefault;
        // Standalone investment accounts hold cash inside the same account, so
        // include the month-end cash balance alongside the cost basis.
        if (s.account_type === "INVESTMENT" && s.account_sub_type === null) {
          convertedValue += this.convertCurrency(
            Number(s.balance),
            s.currency_code,
            defaultCurrency,
            monthEnd,
            rateIndex,
          );
        }
      } else {
        let rawValue: number;
        if (
          s.account_sub_type === "INVESTMENT_BROKERAGE" &&
          s.market_value != null
        ) {
          rawValue = Number(s.market_value);
        } else if (
          s.account_type === "INVESTMENT" &&
          s.account_sub_type === null &&
          s.market_value != null
        ) {
          rawValue = Number(s.market_value) + Number(s.balance);
        } else {
          rawValue = Number(s.balance);
        }

        convertedValue = this.convertCurrency(
          rawValue,
          s.currency_code,
          defaultCurrency,
          monthEnd,
          rateIndex,
        );
      }

      monthMap.set(monthKey, monthMap.get(monthKey)! + convertedValue);
    }

    return Array.from(monthMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, value]) => ({
        month,
        value: Math.round(value),
      }));
  }

  /**
   * For each brokerage / standalone-investment account in `snapshots` whose
   * snapshot row coincides with that account's first-ever active month,
   * compute the net cost basis of all in-month investment transactions
   * converted to `defaultCurrency`. Returns a map keyed by
   * `${accountId}:${monthKey}` -> value in `defaultCurrency`.
   */
  private async computeFirstActiveMonthCostBasis(
    userId: string,
    snapshots: any[],
    defaultCurrency: string,
    start: string,
    end: string,
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();

    const eligibleSnapshots = snapshots.filter((s) => {
      const isBrokerage = s.account_sub_type === "INVESTMENT_BROKERAGE";
      const isStandalone =
        s.account_type === "INVESTMENT" && s.account_sub_type === null;
      return isBrokerage || isStandalone;
    });
    if (eligibleSnapshots.length === 0) return result;

    const accountIds = [...new Set(eligibleSnapshots.map((s) => s.account_id))];

    const firstMonthRows: any[] = await this.scopedQuery(
      `SELECT account_id, MIN(month)::DATE as first_month
       FROM monthly_account_balances
       WHERE account_id = ANY($1::UUID[]) AND user_id = $2
       GROUP BY account_id`,
      [accountIds, userId],
    );
    const firstActiveMonth = new Map<string, string>();
    for (const r of firstMonthRows) {
      firstActiveMonth.set(r.account_id, this.toDateString(r.first_month));
    }

    const targetMonthByAccount = new Map<string, string>();
    for (const s of eligibleSnapshots) {
      const monthKey = this.toDateString(s.month);
      if (firstActiveMonth.get(s.account_id) === monthKey) {
        targetMonthByAccount.set(s.account_id, monthKey);
      }
    }
    if (targetMonthByAccount.size === 0) return result;

    const targetAccountIds = [...targetMonthByAccount.keys()];
    const txRows: any[] = await this.scopedQuery(
      `SELECT it.account_id, it.action, it.quantity, it.price, it.transaction_date,
              s.currency_code AS security_currency
       FROM investment_transactions it
       LEFT JOIN securities s ON s.id = it.security_id
       WHERE it.account_id = ANY($1::UUID[])
         AND it.price IS NOT NULL AND it.price > 0
         AND it.action IN ('BUY', 'SELL', 'REINVEST', 'TRANSFER_IN', 'TRANSFER_OUT')`,
      [targetAccountIds],
    );

    const adjCurrencies = new Set<string>();
    for (const r of txRows) {
      if (r.security_currency && r.security_currency !== defaultCurrency) {
        adjCurrencies.add(r.security_currency);
      }
    }
    const rateIndex =
      adjCurrencies.size > 0
        ? await this.buildRateIndex(adjCurrencies, defaultCurrency, start, end)
        : new Map();

    for (const r of txRows) {
      const targetMonth = targetMonthByAccount.get(r.account_id);
      if (!targetMonth) continue;
      const txDate = this.toDateString(r.transaction_date);
      if (txDate.substring(0, 7) !== targetMonth.substring(0, 7)) continue;

      const qty = Number(r.quantity) || 0;
      const price = Number(r.price) || 0;
      if (qty === 0 || price <= 0) continue;

      let signed: number;
      switch (r.action) {
        case "BUY":
        case "REINVEST":
        case "TRANSFER_IN":
          signed = qty * price;
          break;
        case "SELL":
        case "TRANSFER_OUT":
          signed = -qty * price;
          break;
        default:
          continue;
      }

      const secCurrency = r.security_currency || defaultCurrency;
      const monthEnd = this.monthEndDate(targetMonth);
      const inDefault = this.convertCurrency(
        signed,
        secCurrency,
        defaultCurrency,
        monthEnd,
        rateIndex,
      );

      const key = `${r.account_id}:${targetMonth}`;
      result.set(key, (result.get(key) || 0) + inDefault);
    }

    return result;
  }

  async getDailyInvestments(
    userId: string,
    startDate?: string,
    endDate?: string,
    accountIds?: string[],
    displayCurrency?: string,
  ): Promise<{ date: string; value: number }[]> {
    const pref = await withScopedDb(this.dataSource, (m) =>
      m.getRepository(UserPreference).findOne({ where: { userId } }),
    );
    const defaultCurrency = displayCurrency || pref?.defaultCurrency || "USD";

    const end = endDate || new Date().toISOString().slice(0, 10);

    let accountFilter = "";
    const acctParams: any[] = [userId];

    if (accountIds && accountIds.length > 0) {
      // Resolve the requested accounts plus their linked pairs in one query
      // instead of one round-trip per id.
      const resolved: { id: string }[] = await this.scopedQuery(
        `SELECT id FROM accounts
         WHERE user_id = $2
           AND (
             id = ANY($1)
             OR linked_account_id = ANY($1)
             OR id IN (
               SELECT linked_account_id FROM accounts
               WHERE id = ANY($1) AND user_id = $2
             )
           )`,
        [accountIds, userId],
      );
      const idArray = [...new Set(resolved.map((a) => a.id))];
      if (idArray.length === 0) return [];
      const placeholders = idArray.map((_, i) => `$${i + 2}`).join(", ");
      accountFilter = `AND a.id IN (${placeholders})`;
      acctParams.push(...idArray);
    } else {
      accountFilter = `AND (a.account_sub_type IN ('INVESTMENT_CASH', 'INVESTMENT_BROKERAGE') OR (a.account_type = 'INVESTMENT' AND a.account_sub_type IS NULL))`;
    }

    // Get investment accounts in scope
    const investAccounts: any[] = await this.scopedQuery(
      `SELECT a.id, a.account_type, a.account_sub_type, a.currency_code, a.opening_balance
       FROM accounts a
       WHERE a.user_id = $1 ${accountFilter}`,
      acctParams,
    );

    if (investAccounts.length === 0) return [];

    // "All time" (no startDate) begins where the scope's own history begins.
    const start =
      startDate ||
      (await this.resolveInvestmentInception(
        investAccounts.map((a) => a.id),
        end,
      ));

    const brokerageIds = investAccounts
      .filter(
        (a) =>
          a.account_sub_type === "INVESTMENT_BROKERAGE" ||
          (a.account_type === "INVESTMENT" && !a.account_sub_type),
      )
      .map((a) => a.id);
    const cashIds = investAccounts
      .filter(
        (a) =>
          a.account_sub_type === "INVESTMENT_CASH" ||
          (a.account_type === "INVESTMENT" && !a.account_sub_type),
      )
      .map((a) => a.id);
    // Load investment transactions up to end date for holdings replay
    const invTxs: any[] =
      brokerageIds.length > 0
        ? await this.scopedQuery(
            `SELECT account_id, security_id, action, quantity, transaction_date
           FROM investment_transactions
           WHERE account_id = ANY($1::UUID[])
             AND transaction_date <= $2
           ORDER BY transaction_date ASC`,
            [brokerageIds, end],
          )
        : [];

    // Collect security IDs and load prices for the date range
    const securityIds = [
      ...new Set(
        invTxs.filter((t: any) => t.security_id).map((t: any) => t.security_id),
      ),
    ];

    // Load securities to check skipPriceUpdates
    const securities =
      securityIds.length > 0
        ? await withScopedDb(this.dataSource, (m) =>
            m.getRepository(Security).findByIds(securityIds),
          )
        : [];
    const securityMap = new Map(securities.map((s) => [s.id, s]));

    const marketSecIds = securityIds.filter(
      (id) => !securityMap.get(id)?.skipPriceUpdates,
    );
    const skipSecIds = securityIds.filter(
      (id) => securityMap.get(id)?.skipPriceUpdates,
    );

    // Load market prices for the date range
    const priceRows: any[] =
      marketSecIds.length > 0
        ? await this.scopedQuery(
            `SELECT security_id, price_date, close_price
           FROM security_prices
           WHERE security_id = ANY($1::UUID[])
             AND price_date >= ($2::DATE - INTERVAL '7 days')
             AND price_date <= $3
           ORDER BY security_id, price_date`,
            [marketSecIds, start, end],
          )
        : [];

    // Index prices by security -> sorted array of {date, price}
    const pricesBySec = new Map<
      string,
      Array<{ date: string; price: number }>
    >();
    for (const p of priceRows) {
      const secId = p.security_id;
      if (!pricesBySec.has(secId)) pricesBySec.set(secId, []);
      pricesBySec.get(secId)!.push({
        date: this.toDateString(p.price_date),
        price: Number(p.close_price),
      });
    }

    // Load transaction-based prices for skipPriceUpdates securities
    const txPriceRows: any[] =
      skipSecIds.length > 0
        ? await this.scopedQuery(
            `SELECT security_id, transaction_date, price
           FROM investment_transactions
           WHERE security_id = ANY($1::UUID[])
             AND action IN ('BUY', 'SELL', 'REINVEST')
             AND price IS NOT NULL AND price > 0
           ORDER BY security_id, transaction_date`,
            [skipSecIds],
          )
        : [];

    const txPricesBySec = new Map<
      string,
      Array<{ date: string; price: number }>
    >();
    for (const r of txPriceRows) {
      const secId = r.security_id;
      if (!txPricesBySec.has(secId)) txPricesBySec.set(secId, []);
      txPricesBySec.get(secId)!.push({
        date: this.toDateString(r.transaction_date),
        price: Number(r.price),
      });
    }

    // Load daily cash balances for INVESTMENT_CASH and standalone accounts
    const cashBalances = new Map<string, Map<string, number>>();
    if (cashIds.length > 0) {
      const cashRows: any[] = await this.scopedQuery(
        `WITH target_accounts AS (
            SELECT id, opening_balance
            FROM accounts WHERE id = ANY($1::UUID[])
          ),
          pre_period AS (
            SELECT t.account_id, SUM(t.amount) as total
            FROM transactions t
            JOIN target_accounts ta ON ta.id = t.account_id
            WHERE (t.status IS NULL OR t.status != 'VOID')
              AND t.parent_transaction_id IS NULL
              AND t.transaction_date < $2
            GROUP BY t.account_id
          ),
          daily_tx AS (
            SELECT t.account_id, t.transaction_date::DATE as tx_date, SUM(t.amount) as total
            FROM transactions t
            JOIN target_accounts ta ON ta.id = t.account_id
            WHERE (t.status IS NULL OR t.status != 'VOID')
              AND t.parent_transaction_id IS NULL
              AND t.transaction_date >= $2
              AND t.transaction_date <= $3
            GROUP BY t.account_id, t.transaction_date::DATE
          ),
          account_daily AS (
            SELECT d.dt::DATE as date, ta.id as account_id,
              (ta.opening_balance + COALESCE(pp.total, 0) +
                COALESCE(SUM(dtx.total) OVER (
                  PARTITION BY ta.id ORDER BY d.dt ROWS UNBOUNDED PRECEDING
                ), 0)
              ) as balance
            FROM target_accounts ta
            CROSS JOIN generate_series($2::TIMESTAMP, $3::TIMESTAMP, '1 day') d(dt)
            LEFT JOIN pre_period pp ON pp.account_id = ta.id
            LEFT JOIN daily_tx dtx ON dtx.account_id = ta.id AND dtx.tx_date = d.dt::DATE
          )
          SELECT date::TEXT, balance::NUMERIC, account_id FROM account_daily ORDER BY date`,
        [cashIds, start, end],
      );
      for (const r of cashRows) {
        if (!cashBalances.has(r.account_id))
          cashBalances.set(r.account_id, new Map());
        cashBalances.get(r.account_id)!.set(r.date, Number(r.balance));
      }
    }

    // Generate daily dates
    const dates: string[] = [];
    const d = new Date(start + "T00:00:00");
    const endD = new Date(end + "T00:00:00");
    while (d <= endD) {
      dates.push(d.toISOString().substring(0, 10));
      d.setDate(d.getDate() + 1);
    }

    // Currency conversion setup: include both account currencies (for cash
    // balances) and security currencies (for holdings market value). Prices in
    // security_prices.close_price are stored in the security's native currency,
    // so market value must be converted from security currency -> default
    // currency, not account currency -> default currency.
    const currencies = new Set<string>();
    for (const a of investAccounts) {
      if (a.currency_code !== defaultCurrency) {
        currencies.add(a.currency_code);
      }
    }
    for (const sec of securities) {
      if (sec.currencyCode && sec.currencyCode !== defaultCurrency) {
        currencies.add(sec.currencyCode);
      }
    }
    const rateIndex = await this.buildRateIndex(
      currencies,
      defaultCurrency,
      start,
      end,
    );

    // Build account currency map (used for cash balance conversion)
    const acctCurrency = new Map<string, string>();
    for (const a of investAccounts) {
      acctCurrency.set(a.id, a.currency_code);
    }

    // Replay holdings per-account day by day and compute market value
    // Key: account_id -> (security_id -> quantity)
    const holdingsByAccount = new Map<string, Map<string, number>>();
    let txIdx = 0;

    const result: { date: string; value: number }[] = [];

    for (const dateStr of dates) {
      // Process investment transactions up to this date
      while (txIdx < invTxs.length) {
        const tx = invTxs[txIdx];
        const txDate = this.toDateString(tx.transaction_date);
        if (txDate > dateStr) break;

        const secId = tx.security_id;
        const acctId = tx.account_id;
        const qty = Number(tx.quantity) || 0;

        if (secId) {
          if (!holdingsByAccount.has(acctId))
            holdingsByAccount.set(acctId, new Map());
          const acctHoldings = holdingsByAccount.get(acctId)!;

          switch (tx.action) {
            case "BUY":
            case "REINVEST":
            case "TRANSFER_IN":
              acctHoldings.set(secId, (acctHoldings.get(secId) || 0) + qty);
              break;
            case "SELL":
            case "TRANSFER_OUT":
              acctHoldings.set(secId, (acctHoldings.get(secId) || 0) - qty);
              break;
            case "SPLIT":
              acctHoldings.set(secId, (acctHoldings.get(secId) || 0) + qty);
              break;
          }
        }
        txIdx++;
      }

      // Compute market value per holding and convert from security currency
      // to default currency. Security prices are stored in the security's
      // native currency, so we must convert each holding individually rather
      // than treating the total as being in the account's currency.
      let totalValue = 0;

      for (const [, acctHoldings] of holdingsByAccount) {
        for (const [secId, qty] of acctHoldings) {
          if (Math.abs(qty) < 0.00000001) continue;

          const security = securityMap.get(secId);
          let price: number | undefined;

          // Value each point at the latest close on or before that day
          // (end-of-day convention). The chart point at date X therefore
          // represents the portfolio's value as of the close of day X, so the
          // series lines up with the month-end-valued monthly snapshots and the
          // final point reflects the most recent available close rather than
          // lagging a trading day behind it.
          if (security?.skipPriceUpdates) {
            const txPrices = txPricesBySec.get(secId) || [];
            for (const tp of txPrices) {
              if (tp.date <= dateStr) price = tp.price;
              else break;
            }
          } else {
            const secPrices = pricesBySec.get(secId) || [];
            for (const sp of secPrices) {
              if (sp.date <= dateStr) price = sp.price;
              else break;
            }
          }

          if (price != null) {
            const valueInSecCurrency = qty * price;
            const secCurrency = security?.currencyCode || defaultCurrency;
            totalValue += this.convertCurrency(
              valueInSecCurrency,
              secCurrency,
              defaultCurrency,
              dateStr,
              rateIndex,
            );
          }
        }
      }

      // Add cash balances for INVESTMENT_CASH and standalone accounts
      for (const [acctId, dailyMap] of cashBalances) {
        const bal = dailyMap.get(dateStr) ?? 0;
        const currency = acctCurrency.get(acctId) || defaultCurrency;
        totalValue += this.convertCurrency(
          bal,
          currency,
          defaultCurrency,
          dateStr,
          rateIndex,
        );
      }

      result.push({
        date: dateStr,
        value: Math.round(totalValue),
      });
    }

    return result;
  }

  /**
   * Per-security contribution to the portfolio value over time, for the
   * Portfolio Value Over Time report's "by security" view. Replays holdings
   * over the requested window (day-by-day for daily granularity, month-by-month
   * for monthly) and values each security individually, so the returned bands
   * stack up to the total portfolio value. Cash held in investment cash /
   * standalone accounts is returned as its own aggregate band.
   *
   * The `limit` largest securities (ranked by their peak contribution across
   * the window) keep their own band; the rest roll into a single "other" band
   * so a large portfolio stays legible. Read-only; does not touch the stored
   * monthly snapshots that the aggregate views use.
   */
  async getInvestmentBreakdown(
    userId: string,
    opts: {
      granularity: InvestmentBreakdownGranularity;
      startDate?: string;
      endDate?: string;
      accountIds?: string[];
      displayCurrency?: string;
      limit?: number;
    },
  ): Promise<InvestmentBreakdown> {
    const { granularity } = opts;
    const limit = opts.limit ?? 10;

    const pref = await withScopedDb(this.dataSource, (m) =>
      m.getRepository(UserPreference).findOne({ where: { userId } }),
    );
    const defaultCurrency =
      opts.displayCurrency || pref?.defaultCurrency || "USD";

    const end = opts.endDate || new Date().toISOString().slice(0, 10);

    const empty: InvestmentBreakdown = {
      granularity,
      currency: defaultCurrency,
      series: [],
      points: [],
    };

    const investAccounts = await this.resolveScopedInvestmentAccounts(
      userId,
      opts.accountIds,
    );
    if (investAccounts.length === 0) return empty;

    // "All time" (no startDate) begins where the scope's own history begins.
    const start =
      opts.startDate ||
      (await this.resolveInvestmentInception(
        investAccounts.map((a) => a.id),
        end,
      ));

    const brokerageIds = investAccounts
      .filter(
        (a) =>
          a.account_sub_type === "INVESTMENT_BROKERAGE" ||
          (a.account_type === "INVESTMENT" && !a.account_sub_type),
      )
      .map((a) => a.id);
    const cashIds = investAccounts
      .filter(
        (a) =>
          a.account_sub_type === "INVESTMENT_CASH" ||
          (a.account_type === "INVESTMENT" && !a.account_sub_type),
      )
      .map((a) => a.id);

    // Investment transactions from inception up to the window end, so holdings
    // can be replayed forward to each sample point.
    const invTxs: any[] =
      brokerageIds.length > 0
        ? await this.scopedQuery(
            `SELECT account_id, security_id, action, quantity, transaction_date
             FROM investment_transactions
             WHERE account_id = ANY($1::UUID[])
               AND transaction_date <= $2
             ORDER BY transaction_date ASC`,
            [brokerageIds, end],
          )
        : [];

    const securityIds = [
      ...new Set(
        invTxs.filter((t: any) => t.security_id).map((t: any) => t.security_id),
      ),
    ];
    const securities =
      securityIds.length > 0
        ? await withScopedDb(this.dataSource, (m) =>
            m.getRepository(Security).findByIds(securityIds),
          )
        : [];
    const securityMap = new Map(securities.map((s) => [s.id, s]));

    const marketSecIds = securityIds.filter(
      (id) => !securityMap.get(id)?.skipPriceUpdates,
    );
    const skipSecIds = securityIds.filter(
      (id) => securityMap.get(id)?.skipPriceUpdates,
    );

    // Build the ordered list of sample dates and, for each, a valuation date
    // (the date whose close values that point) plus a price lookup.
    const sampleDates =
      granularity === "monthly"
        ? this.enumerateMonths(start, end)
        : this.enumerateDays(start, end);
    if (sampleDates.length === 0) return empty;

    // --- Price lookups -------------------------------------------------------
    // Daily values each point at the latest close on or before the date
    // (end-of-day convention, matching getDailyInvestments). Monthly values
    // each point at the latest close on or before the month end (matching the
    // stored monthly snapshots). Both are inclusive of their period end so the
    // daily and monthly series line up at overlapping dates.
    const pricesBySec = new Map<
      string,
      Array<{ date: string; price: number }>
    >();
    const txPricesBySec = new Map<
      string,
      Array<{ date: string; price: number }>
    >();
    const monthPrices = new Map<string, Map<string, number>>();
    const monthTxPrices = new Map<string, Map<string, number>>();

    if (granularity === "daily") {
      if (marketSecIds.length > 0) {
        const priceRows: any[] = await this.scopedQuery(
          `SELECT security_id, price_date, close_price
             FROM security_prices
             WHERE security_id = ANY($1::UUID[])
               AND price_date >= ($2::DATE - INTERVAL '7 days')
               AND price_date <= $3
             ORDER BY security_id, price_date`,
          [marketSecIds, start, end],
        );
        for (const p of priceRows) {
          const arr = pricesBySec.get(p.security_id) ?? [];
          arr.push({
            date: this.toDateString(p.price_date),
            price: Number(p.close_price),
          });
          pricesBySec.set(p.security_id, arr);
        }
      }
      if (skipSecIds.length > 0) {
        const txPriceRows: any[] = await this.scopedQuery(
          `SELECT security_id, transaction_date, price
             FROM investment_transactions
             WHERE security_id = ANY($1::UUID[])
               AND action IN ('BUY', 'SELL', 'REINVEST')
               AND price IS NOT NULL AND price > 0
             ORDER BY security_id, transaction_date`,
          [skipSecIds],
        );
        for (const r of txPriceRows) {
          const arr = txPricesBySec.get(r.security_id) ?? [];
          arr.push({
            date: this.toDateString(r.transaction_date),
            price: Number(r.price),
          });
          txPricesBySec.set(r.security_id, arr);
        }
      }
    } else {
      // Monthly: reuse the month-end price loaders (keyed by month-first date).
      await Promise.all([
        this.loadSecurityPrices(
          securityIds,
          securityMap,
          sampleDates,
          monthPrices,
        ),
        this.loadTransactionPrices(
          securityIds,
          securityMap,
          sampleDates,
          monthTxPrices,
        ),
      ]);
    }

    // --- Cash balances -------------------------------------------------------
    const cashBalances = new Map<string, Map<string, number>>();
    if (cashIds.length > 0) {
      const cashRows: any[] =
        granularity === "monthly"
          ? await this.loadMonthlyCashBalances(cashIds, start, end)
          : await this.loadDailyCashBalances(cashIds, start, end);
      for (const r of cashRows) {
        if (!cashBalances.has(r.account_id))
          cashBalances.set(r.account_id, new Map());
        cashBalances
          .get(r.account_id)!
          .set(this.toDateString(r.date ?? r.month), Number(r.balance));
      }
    }

    // --- Currency conversion -------------------------------------------------
    const currencies = new Set<string>();
    for (const a of investAccounts) {
      if (a.currency_code !== defaultCurrency) currencies.add(a.currency_code);
    }
    for (const sec of securities) {
      if (sec.currencyCode && sec.currencyCode !== defaultCurrency) {
        currencies.add(sec.currencyCode);
      }
    }
    const rateIndex = await this.buildRateIndex(
      currencies,
      defaultCurrency,
      start,
      end,
    );

    const acctCurrency = new Map<string, string>();
    for (const a of investAccounts) acctCurrency.set(a.id, a.currency_code);

    // --- Replay holdings, accumulating per security --------------------------
    const holdings = new Map<string, number>(); // securityId -> quantity
    let txIdx = 0;

    const ungrouped: Array<{
      date: string;
      valuesBySec: Map<string, number>;
      cash: number;
    }> = [];

    for (const sampleDate of sampleDates) {
      const valuationDate =
        granularity === "monthly" ? this.monthEndDate(sampleDate) : sampleDate;
      const monthKey = granularity === "monthly" ? sampleDate : null;

      // Apply every transaction up to this sample point. Daily includes
      // transactions dated on the day itself; monthly includes any transaction
      // whose month is at or before the sample month.
      while (txIdx < invTxs.length) {
        const tx = invTxs[txIdx];
        const txDate = this.toDateString(tx.transaction_date);
        if (granularity === "monthly") {
          if (txDate.substring(0, 7) > sampleDate.substring(0, 7)) break;
        } else if (txDate > sampleDate) {
          break;
        }

        const secId = tx.security_id;
        const qty = Number(tx.quantity) || 0;
        if (secId) {
          switch (tx.action) {
            case "BUY":
            case "REINVEST":
            case "TRANSFER_IN":
            case "SPLIT":
              holdings.set(secId, (holdings.get(secId) || 0) + qty);
              break;
            case "SELL":
            case "TRANSFER_OUT":
              holdings.set(secId, (holdings.get(secId) || 0) - qty);
              break;
          }
        }
        txIdx++;
      }

      const valuesBySec = new Map<string, number>();
      for (const [secId, qty] of holdings) {
        if (Math.abs(qty) < 0.00000001) continue;
        const security = securityMap.get(secId);
        const price = this.priceForSample(
          secId,
          security,
          granularity,
          sampleDate,
          monthKey,
          { pricesBySec, txPricesBySec, monthPrices, monthTxPrices },
        );
        if (price == null) continue;
        const secCurrency = security?.currencyCode || defaultCurrency;
        const value = this.convertCurrency(
          qty * price,
          secCurrency,
          defaultCurrency,
          valuationDate,
          rateIndex,
        );
        valuesBySec.set(secId, (valuesBySec.get(secId) ?? 0) + value);
      }

      // Cash maps are keyed by the sample date itself: day strings for daily,
      // month-first strings for monthly.
      let cash = 0;
      for (const [acctId, dailyMap] of cashBalances) {
        const bal = dailyMap.get(sampleDate) ?? 0;
        if (bal === 0) continue;
        const currency = acctCurrency.get(acctId) || defaultCurrency;
        cash += this.convertCurrency(
          bal,
          currency,
          defaultCurrency,
          valuationDate,
          rateIndex,
        );
      }

      ungrouped.push({ date: sampleDate, valuesBySec, cash });
    }

    const { series, points } = this.groupSecurityBreakdown(
      ungrouped,
      securityMap,
      limit,
    );
    return { granularity, currency: defaultCurrency, series, points };
  }

  // ---- Private helpers ----

  /**
   * Resolve the investment accounts in scope for a breakdown request, mirroring
   * getDailyInvestments: an explicit id list resolves its linked pairs, an
   * empty list falls back to all of the user's investment cash / brokerage /
   * standalone accounts. Returns the lightweight account rows the replay needs.
   */
  private async resolveScopedInvestmentAccounts(
    userId: string,
    accountIds?: string[],
  ): Promise<
    Array<{
      id: string;
      account_type: string;
      account_sub_type: string | null;
      currency_code: string;
      opening_balance: string | number;
    }>
  > {
    let accountFilter = "";
    const acctParams: any[] = [userId];

    if (accountIds && accountIds.length > 0) {
      const resolved: { id: string }[] = await this.scopedQuery(
        `SELECT id FROM accounts
         WHERE user_id = $2
           AND (
             id = ANY($1)
             OR linked_account_id = ANY($1)
             OR id IN (
               SELECT linked_account_id FROM accounts
               WHERE id = ANY($1) AND user_id = $2
             )
           )`,
        [accountIds, userId],
      );
      const idArray = [...new Set(resolved.map((a) => a.id))];
      if (idArray.length === 0) return [];
      const placeholders = idArray.map((_, i) => `$${i + 2}`).join(", ");
      accountFilter = `AND a.id IN (${placeholders})`;
      acctParams.push(...idArray);
    } else {
      accountFilter = `AND (a.account_sub_type IN ('INVESTMENT_CASH', 'INVESTMENT_BROKERAGE') OR (a.account_type = 'INVESTMENT' AND a.account_sub_type IS NULL))`;
    }

    return this.scopedQuery(
      `SELECT a.id, a.account_type, a.account_sub_type, a.currency_code, a.opening_balance
       FROM accounts a
       WHERE a.user_id = $1 ${accountFilter}`,
      acctParams,
    );
  }

  /**
   * Window start for a request that asked for "all time" (no startDate): the
   * earliest date the scoped accounts have anything to show. Per account that
   * is its first non-void transaction or investment transaction, falling back
   * to the date the account was created when it has neither -- the same rule
   * `resolveStartDate` / `recalculateBrokerageAccount` use to decide where an
   * account's monthly snapshots begin, so the by-security chart and the total
   * chart start on the same point rather than years apart.
   *
   * A fixed epoch here is what issue #1081 reported: the per-security series
   * enumerates every sample between start and end, so "all time" prepended
   * three decades of empty months and flattened the real data against the
   * x-axis. Callers resolve their account scope first and return early when it
   * is empty, so this never has to invent a date for an empty scope; the result
   * is clamped to `end` so a reversed window still yields a single point.
   */
  private async resolveInvestmentInception(
    accountIds: string[],
    end: string,
  ): Promise<string> {
    const rows: Array<{ earliest: string | Date | null }> =
      await this.scopedQuery(
        `WITH scoped AS (
            SELECT a.id, a.created_at FROM accounts a WHERE a.id = ANY($1::UUID[])
          ),
          first_tx AS (
            SELECT t.account_id, MIN(t.transaction_date) AS d
              FROM transactions t
             WHERE t.account_id = ANY($1::UUID[])
               AND (t.status IS NULL OR t.status != 'VOID')
               AND t.parent_transaction_id IS NULL
             GROUP BY t.account_id
          ),
          first_inv AS (
            SELECT it.account_id, MIN(it.transaction_date) AS d
              FROM investment_transactions it
             WHERE it.account_id = ANY($1::UUID[])
             GROUP BY it.account_id
          )
          SELECT MIN(
                   COALESCE(LEAST(ft.d, fi.d), s.created_at::DATE)
                 )::TEXT AS earliest
            FROM scoped s
            LEFT JOIN first_tx ft ON ft.account_id = s.id
            LEFT JOIN first_inv fi ON fi.account_id = s.id`,
        [accountIds],
      );

    const earliest = rows?.[0]?.earliest;
    if (!earliest) return end;
    const inception = this.toDateString(earliest);
    return inception > end ? end : inception;
  }

  /** Latest close valuing a security at one sample point (see granularity notes). */
  private priceForSample(
    secId: string,
    security: Security | undefined,
    granularity: InvestmentBreakdownGranularity,
    sampleDate: string,
    monthKey: string | null,
    maps: {
      pricesBySec: Map<string, Array<{ date: string; price: number }>>;
      txPricesBySec: Map<string, Array<{ date: string; price: number }>>;
      monthPrices: Map<string, Map<string, number>>;
      monthTxPrices: Map<string, Map<string, number>>;
    },
  ): number | undefined {
    if (granularity === "monthly") {
      const map = security?.skipPriceUpdates
        ? maps.monthTxPrices
        : maps.monthPrices;
      return map.get(secId)?.get(monthKey!);
    }
    const series = security?.skipPriceUpdates
      ? maps.txPricesBySec.get(secId)
      : maps.pricesBySec.get(secId);
    if (!series) return undefined;
    let price: number | undefined;
    for (const p of series) {
      if (p.date <= sampleDate) price = p.price;
      else break;
    }
    return price;
  }

  /** All calendar days in [start, end] inclusive, as YYYY-MM-DD strings. */
  private enumerateDays(start: string, end: string): string[] {
    const dates: string[] = [];
    const d = new Date(start + "T00:00:00");
    const endD = new Date(end + "T00:00:00");
    while (d <= endD) {
      dates.push(d.toISOString().substring(0, 10));
      d.setDate(d.getDate() + 1);
    }
    return dates;
  }

  /** Month-first dates for every month spanned by [start, end], YYYY-MM-01. */
  private enumerateMonths(start: string, end: string): string[] {
    const months: string[] = [];
    const [sy, sm] = start.split("-").map(Number);
    const [ey, em] = end.split("-").map(Number);
    let y = sy;
    let m = sm;
    while (y < ey || (y === ey && m <= em)) {
      months.push(`${y}-${String(m).padStart(2, "0")}-01`);
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
    return months;
  }

  /** Per-day cash balances for investment cash / standalone accounts. */
  private async loadDailyCashBalances(
    cashIds: string[],
    start: string,
    end: string,
  ): Promise<any[]> {
    return this.scopedQuery(
      `WITH target_accounts AS (
          SELECT id, opening_balance
          FROM accounts WHERE id = ANY($1::UUID[])
        ),
        pre_period AS (
          SELECT t.account_id, SUM(t.amount) as total
          FROM transactions t
          JOIN target_accounts ta ON ta.id = t.account_id
          WHERE (t.status IS NULL OR t.status != 'VOID')
            AND t.parent_transaction_id IS NULL
            AND t.transaction_date < $2
          GROUP BY t.account_id
        ),
        daily_tx AS (
          SELECT t.account_id, t.transaction_date::DATE as tx_date, SUM(t.amount) as total
          FROM transactions t
          JOIN target_accounts ta ON ta.id = t.account_id
          WHERE (t.status IS NULL OR t.status != 'VOID')
            AND t.parent_transaction_id IS NULL
            AND t.transaction_date >= $2
            AND t.transaction_date <= $3
          GROUP BY t.account_id, t.transaction_date::DATE
        ),
        account_daily AS (
          SELECT d.dt::DATE as date, ta.id as account_id,
            (ta.opening_balance + COALESCE(pp.total, 0) +
              COALESCE(SUM(dtx.total) OVER (
                PARTITION BY ta.id ORDER BY d.dt ROWS UNBOUNDED PRECEDING
              ), 0)
            ) as balance
          FROM target_accounts ta
          CROSS JOIN generate_series($2::TIMESTAMP, $3::TIMESTAMP, '1 day') d(dt)
          LEFT JOIN pre_period pp ON pp.account_id = ta.id
          LEFT JOIN daily_tx dtx ON dtx.account_id = ta.id AND dtx.tx_date = d.dt::DATE
        )
        SELECT date::TEXT, balance::NUMERIC, account_id FROM account_daily ORDER BY date`,
      [cashIds, start, end],
    );
  }

  /** Per-month-end cash balances for investment cash / standalone accounts. */
  private async loadMonthlyCashBalances(
    cashIds: string[],
    start: string,
    end: string,
  ): Promise<any[]> {
    return this.scopedQuery(
      `WITH target_accounts AS (
          SELECT id, opening_balance FROM accounts WHERE id = ANY($1::UUID[])
        ),
        bounds AS (
          SELECT date_trunc('month', $2::DATE)::DATE AS start_m,
                 date_trunc('month', $3::DATE)::DATE AS end_m
        ),
        pre_period AS (
          SELECT t.account_id, SUM(t.amount) as total
          FROM transactions t
          JOIN target_accounts ta ON ta.id = t.account_id
          CROSS JOIN bounds b
          WHERE (t.status IS NULL OR t.status != 'VOID')
            AND t.parent_transaction_id IS NULL
            AND t.transaction_date < b.start_m
          GROUP BY t.account_id
        ),
        monthly_tx AS (
          SELECT t.account_id, date_trunc('month', t.transaction_date)::DATE as month,
                 SUM(t.amount) as total
          FROM transactions t
          JOIN target_accounts ta ON ta.id = t.account_id
          CROSS JOIN bounds b
          WHERE (t.status IS NULL OR t.status != 'VOID')
            AND t.parent_transaction_id IS NULL
            AND t.transaction_date >= b.start_m
            AND t.transaction_date <= $3
          GROUP BY t.account_id, date_trunc('month', t.transaction_date)
        ),
        month_series AS (
          SELECT gs::DATE AS m FROM bounds b,
            generate_series(b.start_m, b.end_m, '1 month') gs
        )
        SELECT ta.id as account_id, s.m::TEXT as month,
          (ta.opening_balance + COALESCE(pp.total, 0) +
            COALESCE(SUM(mt.total) OVER (
              PARTITION BY ta.id ORDER BY s.m ROWS UNBOUNDED PRECEDING
            ), 0)
          )::NUMERIC as balance
        FROM target_accounts ta
        CROSS JOIN month_series s
        LEFT JOIN pre_period pp ON pp.account_id = ta.id
        LEFT JOIN monthly_tx mt ON mt.account_id = ta.id AND mt.month = s.m
        ORDER BY s.m`,
      [cashIds, start, end],
    );
  }

  /**
   * Rank securities by peak contribution, keep the top `limit` as their own
   * bands, roll the remainder into a single "other" band, and append a cash
   * band when any cash is present. Each band value is rounded to whole units so
   * the stacked bands add up exactly to the point total shown to the user.
   */
  private groupSecurityBreakdown(
    ungrouped: Array<{
      date: string;
      valuesBySec: Map<string, number>;
      cash: number;
    }>,
    securityMap: Map<string, Security>,
    limit: number,
  ): {
    series: InvestmentBreakdownSeries[];
    points: InvestmentBreakdownPoint[];
  } {
    const peak = new Map<string, number>();
    for (const pt of ungrouped) {
      for (const [secId, val] of pt.valuesBySec) {
        if (Math.abs(val) > Math.abs(peak.get(secId) ?? 0)) {
          peak.set(secId, val);
        }
      }
    }

    const rankedSecIds = [...peak.entries()]
      .filter(([, v]) => Math.abs(v) >= 0.005)
      .sort((a, b) => {
        const diff = Math.abs(b[1]) - Math.abs(a[1]);
        if (diff !== 0) return diff;
        const an = securityMap.get(a[0])?.name ?? "";
        const bn = securityMap.get(b[0])?.name ?? "";
        return an.localeCompare(bn);
      })
      .map(([secId]) => secId);

    const topIds = rankedSecIds.slice(0, limit);
    const otherIds = new Set(rankedSecIds.slice(limit));
    const hasOther = otherIds.size > 0;
    const hasCash = ungrouped.some((pt) => Math.abs(pt.cash) >= 0.005);

    const series: InvestmentBreakdownSeries[] = topIds.map((secId) => {
      const sec = securityMap.get(secId);
      return {
        key: secId,
        type: "security",
        symbol: sec?.symbol ?? null,
        name: sec?.name ?? sec?.symbol ?? secId,
      };
    });
    if (hasOther)
      series.push({ key: "other", type: "other", symbol: null, name: "" });
    if (hasCash)
      series.push({ key: "cash", type: "cash", symbol: null, name: "" });

    const points: InvestmentBreakdownPoint[] = ungrouped.map((pt) => {
      const values: Record<string, number> = {};
      let total = 0;
      for (const secId of topIds) {
        const v = Math.round(pt.valuesBySec.get(secId) ?? 0);
        values[secId] = v;
        total += v;
      }
      if (hasOther) {
        let otherSum = 0;
        for (const secId of otherIds)
          otherSum += pt.valuesBySec.get(secId) ?? 0;
        const v = Math.round(otherSum);
        values.other = v;
        total += v;
      }
      if (hasCash) {
        const v = Math.round(pt.cash);
        values.cash = v;
        total += v;
      }
      return { date: pt.date, total, values };
    });

    return { series, points };
  }

  private async recalculateRegularAccount(
    userId: string,
    account: Account,
  ): Promise<void> {
    const openingBalance = Number(account.openingBalance) || 0;

    const [{ earliest }] = await this.scopedQuery(
      `SELECT MIN(transaction_date) as earliest
       FROM transactions
       WHERE account_id = $1
         AND (status IS NULL OR status != 'VOID')
         AND parent_transaction_id IS NULL`,
      [account.id],
    );

    let startDate = this.resolveStartDate(account, earliest);

    // For ASSET with dateAcquired, ensure we start from the earlier of dateAcquired or first tx
    if (account.accountType === AccountType.ASSET && account.dateAcquired) {
      const daStr = this.toDateString(account.dateAcquired);
      if (daStr < startDate) startDate = daStr;
    }

    const rows: any[] = await this.scopedQuery(
      `WITH monthly_tx_sums AS (
        SELECT DATE_TRUNC('month', transaction_date)::DATE as month,
               SUM(amount) as total
        FROM transactions
        WHERE account_id = $1
          AND (status IS NULL OR status != 'VOID')
          AND parent_transaction_id IS NULL
          AND transaction_date <= CURRENT_DATE
        GROUP BY 1
      )
      SELECT m.month::DATE as month,
             ($2::NUMERIC + COALESCE(
               SUM(mts.total) OVER (ORDER BY m.month ROWS UNBOUNDED PRECEDING),
               0
             )) as balance
      FROM generate_series(
        DATE_TRUNC('month', $3::DATE)::TIMESTAMP,
        DATE_TRUNC('month', CURRENT_DATE)::TIMESTAMP,
        '1 month'::INTERVAL
      ) m(month)
      LEFT JOIN monthly_tx_sums mts ON mts.month = m.month::DATE
      ORDER BY m.month`,
      [account.id, openingBalance, startDate],
    );

    // Determine dateAcquired month for ASSET zeroing
    let dateAcquiredYM: string | null = null;
    if (account.accountType === AccountType.ASSET && account.dateAcquired) {
      dateAcquiredYM = this.toDateString(account.dateAcquired).substring(0, 7);
    }

    // Atomic delete + insert
    await withScopedDb(this.dataSource, async (m) => {
      await m.query(
        "DELETE FROM monthly_account_balances WHERE account_id = $1",
        [account.id],
      );

      for (const row of rows) {
        const monthStr = this.toDateString(row.month);
        const monthYM = monthStr.substring(0, 7);

        let balance = Number(row.balance);
        if (dateAcquiredYM && monthYM < dateAcquiredYM) {
          balance = 0;
        }

        await m.query(
          `INSERT INTO monthly_account_balances (user_id, account_id, month, balance)
           VALUES ($1, $2, $3::DATE, $4)`,
          [userId, account.id, monthStr, balance],
        );
      }
    });
  }

  private async recalculateBrokerageAccount(
    userId: string,
    account: Account,
  ): Promise<void> {
    const openingBalance = Number(account.openingBalance) || 0;

    // Find earliest date from both regular and investment transactions
    const [{ earliest }] = await this.scopedQuery(
      `SELECT MIN(transaction_date) as earliest
       FROM transactions
       WHERE account_id = $1
         AND (status IS NULL OR status != 'VOID')
         AND parent_transaction_id IS NULL`,
      [account.id],
    );

    const [{ inv_earliest }] = await this.scopedQuery(
      `SELECT MIN(transaction_date) as inv_earliest
       FROM investment_transactions
       WHERE account_id = $1`,
      [account.id],
    );

    const dates: string[] = [];
    if (earliest) dates.push(this.toDateString(earliest));
    if (inv_earliest) dates.push(this.toDateString(inv_earliest));
    const startDate =
      dates.length > 0
        ? dates.sort()[0]
        : account.createdAt.toISOString().substring(0, 10);

    // Compute cost-basis via cumulative transaction sums
    const costRows: any[] = await this.scopedQuery(
      `WITH monthly_tx_sums AS (
        SELECT DATE_TRUNC('month', transaction_date)::DATE as month,
               SUM(amount) as total
        FROM transactions
        WHERE account_id = $1
          AND (status IS NULL OR status != 'VOID')
          AND parent_transaction_id IS NULL
          AND transaction_date <= CURRENT_DATE
        GROUP BY 1
      )
      SELECT m.month::DATE as month,
             ($2::NUMERIC + COALESCE(
               SUM(mts.total) OVER (ORDER BY m.month ROWS UNBOUNDED PRECEDING),
               0
             )) as balance
      FROM generate_series(
        DATE_TRUNC('month', $3::DATE)::TIMESTAMP,
        DATE_TRUNC('month', CURRENT_DATE)::TIMESTAMP,
        '1 month'::INTERVAL
      ) m(month)
      LEFT JOIN monthly_tx_sums mts ON mts.month = m.month::DATE
      ORDER BY m.month`,
      [account.id, openingBalance, startDate],
    );

    const costByMonth = new Map<string, number>();
    const months: string[] = [];
    for (const row of costRows) {
      const monthStr = this.toDateString(row.month);
      costByMonth.set(monthStr, Number(row.balance));
      months.push(monthStr);
    }

    // Load investment transactions for holdings replay (exclude future-dated)
    const today = formatDateYMDLocal(new Date());
    const invTxs = await withScopedDb(this.dataSource, (m) =>
      m.getRepository(InvestmentTransaction).find({
        where: {
          accountId: account.id,
          transactionDate: LessThanOrEqual(today),
        },
        order: { transactionDate: "ASC" },
      }),
    );

    const securityIds = [
      ...new Set(invTxs.filter((t) => t.securityId).map((t) => t.securityId!)),
    ];
    const securities =
      securityIds.length > 0
        ? await withScopedDb(this.dataSource, (m) =>
            m.getRepository(Security).findByIds(securityIds),
          )
        : [];
    const securityMap = new Map(securities.map((s) => [s.id, s]));

    // Preload prices
    const marketPrices = new Map<string, Map<string, number>>();
    const txPrices = new Map<string, Map<string, number>>();
    if (securityIds.length > 0) {
      await Promise.all([
        this.loadSecurityPrices(securityIds, securityMap, months, marketPrices),
        this.loadTransactionPrices(securityIds, securityMap, months, txPrices),
      ]);
    }

    // Build a rate index for security currencies -> account currency so that
    // per-holding market values (which are stored in the security's native
    // currency) can be converted to the account's currency before being
    // written to monthly_account_balances.market_value. The read path in
    // getMonthlyInvestments converts the stored value from account currency
    // to the user's display currency, so the stored value must be in the
    // account currency.
    const secCurrencies = new Set<string>();
    for (const sec of securities) {
      if (sec.currencyCode && sec.currencyCode !== account.currencyCode) {
        secCurrencies.add(sec.currencyCode);
      }
    }
    const mvRateIndex =
      secCurrencies.size > 0 && months.length > 0
        ? await this.buildRateIndex(
            secCurrencies,
            account.currencyCode,
            months[0],
            months[months.length - 1],
          )
        : new Map();

    // Replay holdings month by month
    const holdings = new Map<string, number>();
    let txIdx = 0;
    const marketValueByMonth = new Map<string, number>();

    for (const monthStr of months) {
      const monthYM = monthStr.substring(0, 7);

      // Process investment transactions up to this month
      while (txIdx < invTxs.length) {
        const tx = invTxs[txIdx];
        const txYM = tx.transactionDate.substring(0, 7);
        if (txYM > monthYM) break;

        const secId = tx.securityId;
        const qty = Number(tx.quantity) || 0;

        if (secId) {
          switch (tx.action) {
            case InvestmentAction.BUY:
            case InvestmentAction.REINVEST:
            case InvestmentAction.TRANSFER_IN:
              holdings.set(secId, (holdings.get(secId) || 0) + qty);
              break;
            case InvestmentAction.SELL:
            case InvestmentAction.TRANSFER_OUT:
              holdings.set(secId, (holdings.get(secId) || 0) - qty);
              break;
            case InvestmentAction.SPLIT:
              holdings.set(secId, (holdings.get(secId) || 0) + qty);
              break;
          }
        }
        txIdx++;
      }

      // Compute market value from holdings. Each holding's value is in the
      // security's native currency; convert to the account's currency at the
      // month-end exchange rate before summing.
      let marketValue = 0;
      const monthEndStr = this.monthEndDate(monthStr);
      for (const [secId, qty] of holdings) {
        if (Math.abs(qty) < 0.00000001) continue;

        const security = securityMap.get(secId);
        let price: number | undefined;

        if (security?.skipPriceUpdates) {
          price = txPrices.get(secId)?.get(monthStr);
        } else {
          price = marketPrices.get(secId)?.get(monthStr);
        }

        if (price != null) {
          const valueInSecCurrency = qty * price;
          const secCurrency = security?.currencyCode || account.currencyCode;
          marketValue += this.convertCurrency(
            valueInSecCurrency,
            secCurrency,
            account.currencyCode,
            monthEndStr,
            mvRateIndex,
          );
        }
      }

      marketValueByMonth.set(monthStr, marketValue);
    }

    // Atomic write
    await withScopedDb(this.dataSource, async (m) => {
      await m.query(
        "DELETE FROM monthly_account_balances WHERE account_id = $1",
        [account.id],
      );

      for (const monthStr of months) {
        const balance = costByMonth.get(monthStr) ?? 0;
        const mv = marketValueByMonth.get(monthStr) ?? null;

        await m.query(
          `INSERT INTO monthly_account_balances
             (user_id, account_id, month, balance, market_value)
           VALUES ($1, $2, $3::DATE, $4, $5)`,
          [userId, account.id, monthStr, balance, mv],
        );
      }
    });
  }

  private async loadSecurityPrices(
    securityIds: string[],
    securityMap: Map<string, Security>,
    months: string[],
    result: Map<string, Map<string, number>>,
  ): Promise<void> {
    const marketSecIds = securityIds.filter(
      (id) => !securityMap.get(id)?.skipPriceUpdates,
    );
    if (marketSecIds.length === 0) return;

    const prices: any[] = await this.scopedQuery(
      `SELECT security_id, price_date, close_price
       FROM security_prices
       WHERE security_id = ANY($1::UUID[])
       ORDER BY security_id, price_date`,
      [marketSecIds],
    );

    const bySecId = new Map<string, Array<{ date: string; price: number }>>();
    for (const p of prices) {
      const secId = p.security_id;
      if (!bySecId.has(secId)) bySecId.set(secId, []);
      bySecId.get(secId)!.push({
        date: this.toDateString(p.price_date),
        price: Number(p.close_price),
      });
    }

    for (const secId of marketSecIds) {
      const secPrices = bySecId.get(secId) || [];
      const monthPrices = new Map<string, number>();

      for (const monthStr of months) {
        const monthEnd = this.monthEndDate(monthStr);
        let bestPrice: number | undefined;
        for (const sp of secPrices) {
          if (sp.date <= monthEnd) bestPrice = sp.price;
          else break;
        }
        if (bestPrice != null) monthPrices.set(monthStr, bestPrice);
      }

      result.set(secId, monthPrices);
    }
  }

  private async loadTransactionPrices(
    securityIds: string[],
    securityMap: Map<string, Security>,
    months: string[],
    result: Map<string, Map<string, number>>,
  ): Promise<void> {
    const skipSecIds = securityIds.filter(
      (id) => securityMap.get(id)?.skipPriceUpdates,
    );
    if (skipSecIds.length === 0) return;

    const rows: any[] = await this.scopedQuery(
      `SELECT security_id, transaction_date, price
       FROM investment_transactions
       WHERE security_id = ANY($1::UUID[])
         AND action IN ('BUY', 'SELL', 'REINVEST')
         AND price IS NOT NULL
         AND price > 0
       ORDER BY security_id, transaction_date`,
      [skipSecIds],
    );

    const bySecId = new Map<string, Array<{ date: string; price: number }>>();
    for (const r of rows) {
      const secId = r.security_id;
      if (!bySecId.has(secId)) bySecId.set(secId, []);
      bySecId.get(secId)!.push({
        date: this.toDateString(r.transaction_date),
        price: Number(r.price),
      });
    }

    for (const secId of skipSecIds) {
      const txs = bySecId.get(secId) || [];
      const monthPrices = new Map<string, number>();

      for (const monthStr of months) {
        const monthEnd = this.monthEndDate(monthStr);
        let bestPrice: number | undefined;
        for (const t of txs) {
          if (t.date <= monthEnd) bestPrice = t.price;
          else break;
        }
        if (bestPrice != null) monthPrices.set(monthStr, bestPrice);
      }

      result.set(secId, monthPrices);
    }
  }

  private async buildRateIndex(
    currencies: Set<string>,
    defaultCurrency: string,
    startDate: string,
    endDate: string,
  ): Promise<RateIndex> {
    if (currencies.size === 0) return new Map();

    const currArr = Array.from(currencies);
    const rates: any[] = await this.scopedQuery(
      `SELECT from_currency, to_currency, rate, rate_date
       FROM exchange_rates
       WHERE ((from_currency = ANY($1::TEXT[]) AND to_currency = $2)
           OR (from_currency = $2 AND to_currency = ANY($1::TEXT[])))
         AND rate_date >= ($3::DATE - INTERVAL '90 days')
         AND rate_date <= ($4::DATE + INTERVAL '31 days')
       ORDER BY rate_date`,
      [currArr, defaultCurrency, startDate, endDate],
    );

    const index: RateIndex = new Map();
    for (const r of rates) {
      const key = `${r.from_currency}->${r.to_currency}`;
      if (!index.has(key)) index.set(key, []);
      index.get(key)!.push({
        date: this.toDateString(r.rate_date),
        rate: Number(r.rate),
      });
    }

    return index;
  }

  private convertCurrency(
    amount: number,
    from: string,
    to: string,
    monthEnd: string,
    rateIndex: RateIndex,
  ): number {
    // Date-aware rate lookup: resolve the best rate on or before monthEnd from
    // the historical index. The direct/inverse decision lives in the shared
    // convertWithRateLookup helper so reports and net worth stay consistent.
    const result = convertWithRateLookup(amount, from, to, (f, t) => {
      const rates = rateIndex.get(`${f}->${t}`);
      return rates ? this.findBestRate(rates, monthEnd) : undefined;
    });
    return result ?? amount;
  }

  private findBestRate(
    rates: Array<{ date: string; rate: number }>,
    beforeOrOn: string,
  ): number | undefined {
    let best: number | undefined;
    for (const r of rates) {
      if (r.date <= beforeOrOn) best = r.rate;
      else break;
    }
    // If no rate before this date, use the earliest available
    if (best === undefined && rates.length > 0) {
      best = rates[0].rate;
    }
    return best;
  }

  private resolveStartDate(account: Account, earliest: any): string {
    if (earliest) {
      return this.toDateString(earliest);
    }
    if (account.accountType === AccountType.ASSET && account.dateAcquired) {
      return this.toDateString(account.dateAcquired);
    }
    return account.createdAt.toISOString().substring(0, 10);
  }

  private toDateString(value: string | Date): string {
    if (!value) return new Date().toISOString().substring(0, 10);
    if (typeof value === "string") return value.substring(0, 10);
    return value.toISOString().substring(0, 10);
  }

  private monthEndDate(monthFirstDay: string): string {
    const [y, m] = monthFirstDay.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    return `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  }
}
