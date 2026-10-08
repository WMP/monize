import {
  Injectable,
  Logger,
  OnModuleInit,
  Inject,
  forwardRef,
} from "@nestjs/common";
import {
  DataSource,
  EntityManager,
  FindOperator,
  MoreThanOrEqual,
  LessThanOrEqual,
  And,
} from "typeorm";
import { Cron } from "@nestjs/schedule";
import { ExchangeRate } from "./entities/exchange-rate.entity";
import { Currency } from "./entities/currency.entity";
import { UserPreference } from "../users/entities/user-preference.entity";
import { YahooFinanceService } from "../securities/yahoo-finance.service";
import { mapWithConcurrency } from "../common/concurrency.util";
import { resolveFxRateOrNull } from "../common/fx-entry.util";
import { roundMoney } from "../common/round.util";
import { addDaysYMD, todayYMD } from "../common/date-utils";
import { withScopedDb } from "../common/db/scoped-db";
import { returnedRows } from "../common/db/query-result";
import { withSystemContext, withUserContext } from "../common/db/with-context";
import {
  FetchSyncJob,
  FetchSyncService,
} from "../common/jobs/fetch-sync.service";
import {
  EmptyWindowMemory,
  monthFetchWindow,
} from "../common/time-series/history-fill";
import {
  FX_MAX_RATE_AGE_DAYS,
  FxRateMode,
  FxRateResolution,
  describeFxGap,
  fxReferenceDate,
  resolveFxRate,
} from "../common/time-series/fx-rate-resolver";
import { preferredCurrency } from "../common/default-currency.util";
import {
  canonicalRateRow,
  isCanonicalOrientation,
} from "./canonical-rate.util";
import { isSparseRateSeries } from "./rate-gap-plan";

// Cap concurrent Yahoo FX fetches so the daily refresh does not burst every
// currency pair at once (this cron also runs alongside the security price
// refresh, so the combined load on Yahoo needs to stay bounded).
const FX_FETCH_CONCURRENCY = 6;

/**
 * A pair key that does not distinguish direction, because neither the fetch nor
 * the storage does: one provider call answers USD->CAD and CAD->USD alike, and
 * the pair is stored once, so the two are one unit of work and one negative-cache
 * entry.
 *
 * Built on `isCanonicalOrientation` so the ordering rule that decides which
 * orientation is stored and the one that decides which key a pair shares are the
 * same rule, written once.
 */
export function directionlessPairKey(from: string, to: string): string {
  return isCanonicalOrientation(from, to) ? `${from}|${to}` : `${to}|${from}`;
}

/**
 * An inclusive `rate_date` range, both bounds as `YYYY-MM-DD` strings.
 *
 * The entity declares `rateDate: Date` because the column is a SQL `date`, but
 * the values that cross the driver in both directions are strings: `main.ts`
 * sets the `pg` DATE parser to hand the literal back unparsed, and a select-side
 * parameter is rendered by `pg` rather than normalised by TypeORM -- so a `Date`
 * bound is rendered in the process time zone and, west of UTC, names the
 * previous calendar day. The cast is to the declared column type only; the
 * comparison itself is string-to-date, which PostgreSQL resolves per calendar
 * date in every time zone.
 */
function ymdSpan(fromYmd: string, toYmd: string): FindOperator<Date> {
  return And(
    MoreThanOrEqual(fromYmd),
    LessThanOrEqual(toYmd),
  ) as unknown as FindOperator<Date>;
}

/**
 * The distinct days a provider series carries a usable rate on, the same points
 * `persistRateSeries` would keep.
 */
function seriesDays(series: ReadonlyArray<{ date: Date; rate: number }>) {
  const days = new Set<string>();
  for (const point of series) {
    if (!isFinite(point.rate) || point.rate <= 0) continue;
    days.add(point.date.toISOString().slice(0, 10));
  }
  return [...days];
}

/**
 * One amount converted at the rate that applied on `date`. `rate` is
 * `fromCurrency -> toCurrency` at FX precision (10dp); `convertedAmount` is
 * money (4dp). `date` is the day whose rate was asked for, after clamping a
 * future date to today.
 */
export interface DatedConversion {
  amount: number;
  fromCurrency: string;
  toCurrency: string;
  date: string;
  rate: number;
  convertedAmount: number;
}

export interface RateUpdateResult {
  pair: string;
  success: boolean;
  rate?: number;
  error?: string;
}

export interface RateRefreshSummary {
  totalPairs: number;
  updated: number;
  failed: number;
  results: RateUpdateResult[];
  lastUpdated: Date;
}

export interface HistoricalRateBackfillResult {
  pair: string;
  success: boolean;
  ratesLoaded: number;
  error?: string;
}

export interface HistoricalRateBackfillSummary {
  totalPairs: number;
  successful: number;
  failed: number;
  totalRatesLoaded: number;
  results: HistoricalRateBackfillResult[];
}

@Injectable()
export class ExchangeRateService implements OnModuleInit {
  private readonly logger = new Logger(ExchangeRateService.name);

  /** Pair-months the provider answered with nothing. See `EmptyWindowMemory`. */
  private readonly emptyRateWindows = new EmptyWindowMemory();

  constructor(
    private dataSource: DataSource,
    @Inject(forwardRef(() => YahooFinanceService))
    private yahooFinanceService: YahooFinanceService,
    private readonly fetchSync: FetchSyncService,
  ) {}

  /**
   * On application startup, check if exchange rates exist and are recent.
   * If not, trigger a refresh so currency conversions work immediately.
   *
   * RLS: a bootstrap hook has no request context, and everything this reads is
   * cross-user (the recency probe on the global exchange_rates table, then the
   * sweep for users holding foreign-currency accounts), so the whole body runs
   * under `withSystemContext` -- the same shape C2 gave the crons. The per-user
   * backfills it fans out are re-wrapped in `withUserContext` below.
   */
  async onModuleInit(): Promise<void> {
    await withSystemContext(() => this.checkRatesOnStartup());
  }

  /**
   * How long one replica holds the FX fetch.
   *
   * Comfortably longer than a refresh takes and comfortably shorter than the
   * daily cron's interval, so a replica killed mid-fetch never blocks the next
   * day's tick: the expiry alone hands the job back.
   */
  private readonly FETCH_LEASE_MS = 15 * 60 * 1000;

  private async checkRatesOnStartup(): Promise<void> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Check for rates within the last 3 days (covers weekends — Friday rates still valid on Monday)
      const cutoff = new Date(today);
      cutoff.setDate(cutoff.getDate() - 3);

      const recentRate = await withScopedDb(this.dataSource, (manager) =>
        manager.getRepository(ExchangeRate).findOne({
          where: { rateDate: MoreThanOrEqual(cutoff) },
        }),
      );

      if (!recentRate) {
        // A rollout of N pods all find no recent rate and all fetch. The lease
        // is what makes that one fetch; the per-user historical backfills below
        // stay outside it, because they are per user, cheap, and already
        // idempotent.
        const fetched = await this.fetchSync.withLease(
          FetchSyncJob.ExchangeRates,
          this.FETCH_LEASE_MS,
          async () => {
            this.logger.log(
              "No recent exchange rates found — fetching rates on startup",
            );
            const summary = await this.refreshAllRates();
            this.logger.log(
              `Startup rate refresh: ${summary.updated} updated, ${summary.failed} failed`,
            );
          },
        );
        if (!fetched) {
          this.logger.log(
            "Startup rate refresh is being done by another replica",
          );
        }
      } else {
        this.logger.log("Exchange rates are up to date");
      }
      // Check if historical rates need backfilling for any user's accounts or securities
      const usersWithForeignAccounts: Array<{ user_id: string }> =
        await withScopedDb(this.dataSource, (manager) =>
          manager.query(
            `SELECT DISTINCT user_id FROM (
             SELECT a.user_id
             FROM accounts a
             INNER JOIN user_preferences up ON up.user_id = a.user_id
             WHERE a.is_closed = false
               AND a.currency_code != up.default_currency
             UNION
             SELECT a.user_id
             FROM securities s
             INNER JOIN holdings h ON h.security_id = s.id
             INNER JOIN accounts a ON a.id = h.account_id AND a.is_closed = false
             INNER JOIN user_preferences up ON up.user_id = a.user_id
             WHERE s.currency_code != up.default_currency
               AND s.is_active = true
               AND h.quantity > 0
           ) sub`,
          ),
        );

      for (const { user_id } of usersWithForeignAccounts) {
        withUserContext(user_id, () =>
          this.backfillHistoricalRates(user_id),
        ).catch((err) =>
          this.logger.warn(
            `Startup historical rate backfill failed for user ${user_id}: ${err.message}`,
          ),
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to check/refresh exchange rates on startup: ${error.message}`,
      );
    }
  }

  /**
   * Fetch exchange rate from Yahoo Finance for a currency pair.
   * Delegates to YahooFinanceService to avoid duplicating the v8 chart API logic.
   */
  private async fetchYahooRate(
    from: string,
    to: string,
  ): Promise<number | null> {
    if (from === to) return 1.0;

    const symbol = `${from}${to}=X`;
    const quote = await this.yahooFinanceService.fetchQuote(symbol);
    return quote?.regularMarketPrice ?? null;
  }

  /**
   * Fetch historical daily exchange rates from Yahoo Finance for a currency pair.
   * Delegates to YahooFinanceService to avoid duplicating the v8 chart API logic.
   */
  private async fetchYahooHistoricalRates(
    from: string,
    to: string,
  ): Promise<Array<{ date: Date; rate: number }> | null> {
    if (from === to) return [];

    const symbol = `${from}${to}=X`;
    const prices = await this.yahooFinanceService.fetchHistorical(symbol);
    if (!prices) return null;

    return prices.map((p) => ({ date: p.date, rate: p.close }));
  }

  /**
   * Like fetchYahooHistoricalRates, but bounded to a [from, to] date window so a
   * single-date lookup fetches a handful of bars instead of the entire history.
   */
  private async fetchYahooHistoricalRatesWindow(
    from: string,
    to: string,
    fromDate: Date,
    toDate: Date,
  ): Promise<Array<{ date: Date; rate: number }> | null> {
    if (from === to) return [];

    const symbol = `${from}${to}=X`;
    const prices = await this.yahooFinanceService.fetchHistoricalWindow(
      symbol,
      null,
      fromDate,
      toDate,
    );
    if (!prices) return null;

    return prices.map((p) => ({ date: p.date, rate: p.close }));
  }

  /**
   * Save or update an exchange rate for a given date, in the one orientation the
   * pair is stored in.
   *
   * One row, not two. The inverse row that used to be written beside it existed
   * so a reverse lookup would find something, but nothing kept the pair
   * reciprocal, and a write that touched one side only left two rows disagreeing
   * about one date (`canonicalRateRow`, INV-FX-003). Every reader resolves either
   * direction through `resolveFxRate`, so the reverse lookup loses nothing.
   */
  private async saveRate(
    from: string,
    to: string,
    rate: number,
    date: Date,
  ): Promise<ExchangeRate> {
    const row = canonicalRateRow(from, to, rate);
    if (row === null) {
      // A same-currency pair or a non-positive rate: absent, not applicable.
      // Refused before the write rather than stored as a rate nothing may use.
      throw new Error(
        `Refusing to store exchange rate ${from}/${to} at ${rate} for ${date.toISOString().slice(0, 10)}`,
      );
    }
    return withScopedDb(this.dataSource, (manager) =>
      this.upsertCanonicalRate(manager, row.from, row.to, row.rate, date),
    );
  }

  /**
   * Upsert one row whose orientation `canonicalRateRow` has already decided.
   * The codes arrive canonical; this does not re-order them.
   */
  private async upsertCanonicalRate(
    manager: EntityManager,
    from: string,
    to: string,
    rate: number,
    date: Date,
  ): Promise<ExchangeRate> {
    // One statement, arbitrated by `UNIQUE(from_currency, to_currency,
    // rate_date)`. This used to be a `findOne` and then either a save of the
    // found row or an insert -- a check-then-act, and one every replica runs:
    // the exchange-rate cron fires everywhere at 5:05 PM ET, so two processes
    // routinely fetch the same pair for the same day, both find no row, and both
    // insert. The loser got a unique violation and the refresh reported a pair
    // it had in fact fetched as failed.
    //
    // `persistRateSeries` a few lines below already did it this way; the two are
    // now consistent, which matters because they write the same rows.
    const rows: unknown = await manager.query(
      `INSERT INTO exchange_rates (from_currency, to_currency, rate_date, rate, source)
       VALUES ($1, $2, $3::DATE, $4, 'yahoo_finance')
       ON CONFLICT (from_currency, to_currency, rate_date) DO UPDATE SET
         rate = EXCLUDED.rate,
         source = EXCLUDED.source
       RETURNING id`,
      [from, to, date, rate],
    );

    // `DO UPDATE` always returns the row, so a read-back is only needed to hand
    // the caller an entity. Scoped by the id just written rather than by the
    // triple, so it cannot pick up a different row.
    const id = returnedRows<{ id: number }>(rows)[0]?.id;
    const saved = id
      ? await manager.getRepository(ExchangeRate).findOne({ where: { id } })
      : null;
    if (!saved) {
      // Nothing else can make an upsert return no row, so this is a real fault
      // rather than a state to paper over with a synthesized entity.
      throw new Error(
        `Failed to persist exchange rate ${from}/${to} for ${date.toISOString().slice(0, 10)}`,
      );
    }
    return saved;
  }

  /**
   * Bulk-upsert a daily rate series for a pair, one row per day in the pair's
   * canonical orientation.
   *
   * A provider call returns a whole daily series for the period asked for, and
   * costs the same whether that is one day or a hundred. Persisting only the
   * day that was wanted threw the rest away and sent the next lookup for a
   * neighbouring date straight back out to the provider -- which is how a user
   * stepping a date field backwards ran into rate limits. Storing the series
   * makes one call cover the whole window.
   *
   * The series may arrive in either orientation -- the reverse symbol is what
   * answered, for the pairs a provider carries only one way -- and
   * `canonicalRateRow` orients each point, so a window fetched as `USD->CAD` and
   * one fetched as `CAD->USD` land on the same rows rather than on two sets that
   * can drift apart (INV-FX-003).
   */
  private async persistRateSeries(
    from: string,
    to: string,
    series: Array<{ date: Date; rate: number }>,
  ): Promise<number> {
    // One row per day, last value wins, ignoring anything unusable.
    const byDay = new Map<string, { date: Date; rate: number }>();
    for (const point of series) {
      if (!isFinite(point.rate) || point.rate <= 0) continue;
      byDay.set(point.date.toISOString().slice(0, 10), point);
    }
    const points = Array.from(byDay.values());
    if (points.length === 0) return 0;

    const rows: Array<[string, string, Date, number]> = [];
    for (const point of points) {
      const row = canonicalRateRow(from, to, point.rate);
      // Unreachable for a point that survived the filter above; a guard rather
      // than a branch, so a future filter change cannot write an unusable rate.
      if (row === null) continue;
      rows.push([row.from, row.to, point.date, row.rate]);
    }
    if (rows.length === 0) return 0;

    const batchSize = 500;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const values = batch
        .map((_, idx) => {
          const offset = idx * 4;
          return `($${offset + 1}, $${offset + 2}, $${offset + 3}::DATE, $${offset + 4}, 'yahoo_finance')`;
        })
        .join(", ");
      const params: any[] = [];
      for (const [f, t, date, rate] of batch) params.push(f, t, date, rate);

      await withScopedDb(this.dataSource, (manager) =>
        manager.query(
          `INSERT INTO exchange_rates (from_currency, to_currency, rate_date, rate, source)
           VALUES ${values}
           ON CONFLICT (from_currency, to_currency, rate_date) DO UPDATE SET
             rate = EXCLUDED.rate,
             source = EXCLUDED.source`,
          params,
        ),
      );
    }

    return rows.length;
  }

  /**
   * Refresh exchange rates for all currencies in use
   */
  /**
   * Refresh every currency pair in use across the deployment.
   *
   * Global by definition: `exchange_rates` is shared reference data, and the pair
   * set is assembled from every user's accounts, securities and default currency.
   * The system context therefore belongs here, not at the call sites -- left to the
   * caller's ambient identity, the manual endpoint spans all users at
   * RLS_MODE=off and silently narrows to the caller's own currencies at enforce,
   * so the same button would mean two different things. A nested system context
   * from the cron is the same identity and joins.
   */
  async refreshAllRates(): Promise<RateRefreshSummary> {
    return withSystemContext(() => this.refreshAllRatesGlobally());
  }

  private async refreshAllRatesGlobally(): Promise<RateRefreshSummary> {
    const startTime = Date.now();
    this.logger.log("Starting exchange rate refresh");

    // Fetch all currencies in use: account currencies, security currencies for
    // active holdings, and every user's preferred default currency. Including
    // defaults ensures we fetch (CAD, GBP) even when the user has no GBP-
    // denominated accounts -- otherwise their GBP totals would silently fall
    // back to unconverted CAD values.
    const usedCurrencies: { code: string }[] = await withScopedDb(
      this.dataSource,
      (manager) =>
        manager.query(
          `SELECT DISTINCT code FROM (
         SELECT currency_code AS code FROM accounts WHERE is_closed = false
         UNION
         SELECT s.currency_code AS code
         FROM securities s
         INNER JOIN holdings h ON h.security_id = s.id
         INNER JOIN accounts a ON a.id = h.account_id AND a.is_closed = false
         WHERE s.is_active = true AND h.quantity > 0
         UNION
         SELECT default_currency AS code FROM user_preferences
         WHERE default_currency IS NOT NULL
       ) sub`,
        ),
    );

    const codes = usedCurrencies.map((c) => c.code);
    this.logger.log(`Currencies in use: ${codes.join(", ")}`);

    if (codes.length < 2) {
      return {
        totalPairs: 0,
        updated: 0,
        failed: 0,
        results: [],
        lastUpdated: new Date(),
      };
    }

    // Build all unique currency pairs from in-use currencies
    const pairs: { from: string; to: string }[] = [];
    for (let i = 0; i < codes.length; i++) {
      for (let j = i + 1; j < codes.length; j++) {
        pairs.push({
          from: codes[i],
          to: codes[j],
        });
      }
    }

    const results: RateUpdateResult[] = [];
    let updated = 0;
    let failed = 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Fetch rates with bounded concurrency
    await mapWithConcurrency(
      pairs,
      FX_FETCH_CONCURRENCY,
      async ({ from, to }) => {
        const pairLabel = `${from}/${to}`;
        const rate = await this.fetchYahooRate(from, to);

        if (rate === null) {
          results.push({
            pair: pairLabel,
            success: false,
            error: "No rate data available",
          });
          failed++;
          return;
        }

        try {
          await this.saveRate(from, to, rate, today);
          results.push({ pair: pairLabel, success: true, rate });
          updated++;
        } catch (error) {
          results.push({
            pair: pairLabel,
            success: false,
            error: error.message,
          });
          failed++;
        }
      },
    );

    const duration = Date.now() - startTime;
    this.logger.log(
      `Exchange rate refresh completed in ${duration}ms: ${updated} updated, ${failed} failed`,
    );

    return {
      totalPairs: pairs.length,
      updated,
      failed,
      results,
      lastUpdated: new Date(),
    };
  }

  /**
   * Backfill historical exchange rates for accounts with non-default currencies.
   * Fetches daily rates from the earliest transaction date to today.
   *
   * @param userId - The user whose default currency determines the conversion target
   * @param accountIds - Optional list of account IDs to scope the backfill (e.g. post-import)
   */
  async backfillHistoricalRates(
    userId: string,
    accountIds?: string[],
  ): Promise<HistoricalRateBackfillSummary> {
    const startTime = Date.now();
    this.logger.log("Starting historical exchange rate backfill");

    // 1. Get user's default currency
    const pref = await withScopedDb(this.dataSource, (manager) =>
      manager.getRepository(UserPreference).findOne({
        where: { userId },
      }),
    );
    const defaultCurrency = preferredCurrency(pref);

    // 2. Find non-default currencies and their earliest transaction dates
    //    Includes both account currencies AND security currencies held in those accounts
    let accountFilter = "";
    const params: any[] = [defaultCurrency];

    if (accountIds && accountIds.length > 0) {
      accountFilter = `AND a.id = ANY($2::UUID[])`;
      params.push(accountIds);
    }

    // Both discovery queries read from one snapshot -- they feed a single
    // pair->earliest-date map, so a row appearing between them would skew it.
    const [accountCurrencyRows, securityCurrencyRows] = await withScopedDb(
      this.dataSource,
      async (manager) => {
        // Query 1: Account-level currencies (accounts in a non-default currency)
        const accountRows: Array<{
          currency_code: string;
          earliest: string;
        }> = await manager.query(
          `SELECT a.currency_code,
              LEAST(
                (SELECT MIN(t.transaction_date) FROM transactions t WHERE t.account_id = a.id),
                (SELECT MIN(it.transaction_date) FROM investment_transactions it WHERE it.account_id = a.id AND it.status != 'VOID')
              )::TEXT AS earliest
       FROM accounts a
       WHERE a.currency_code != $1
         AND a.is_closed = false
         ${accountFilter}`,
          params,
        );

        // Query 2: Security-level currencies (securities in a non-default currency held in active accounts)
        const securityRows: Array<{
          currency_code: string;
          earliest: string;
        }> = await manager.query(
          `SELECT DISTINCT s.currency_code,
              (SELECT MIN(it.transaction_date)::TEXT
               FROM investment_transactions it
               WHERE it.security_id = s.id
                 AND it.status != 'VOID') AS earliest
       FROM securities s
       INNER JOIN holdings h ON h.security_id = s.id
       INNER JOIN accounts a ON a.id = h.account_id AND a.is_closed = false
       WHERE s.currency_code != $1
         AND s.is_active = true
         AND h.quantity > 0
         ${accountFilter ? `AND h.account_id = ANY($2::UUID[])` : ""}`,
          params,
        );

        return [accountRows, securityRows] as const;
      },
    );

    // 3. Determine unique currency pairs and the global earliest date per pair
    const pairEarliest = new Map<string, Date>();
    const allRows = [...accountCurrencyRows, ...securityCurrencyRows];
    for (const row of allRows) {
      if (!row.earliest) continue;
      const pairKey = `${row.currency_code}->${defaultCurrency}`;
      const earliest = new Date(row.earliest);
      earliest.setHours(0, 0, 0, 0);
      const existing = pairEarliest.get(pairKey);
      if (!existing || earliest < existing) {
        pairEarliest.set(pairKey, earliest);
      }
    }

    if (pairEarliest.size === 0) {
      this.logger.log("No currency pairs require historical backfill");
      return {
        totalPairs: 0,
        successful: 0,
        failed: 0,
        totalRatesLoaded: 0,
        results: [],
      };
    }

    this.logger.log(
      `Currency pairs to backfill: ${Array.from(pairEarliest.keys()).join(", ")}`,
    );

    // 4. Fetch and store historical rates for each pair
    const results: HistoricalRateBackfillResult[] = [];
    let successful = 0;
    let failed = 0;
    let totalRatesLoaded = 0;

    for (const [pairKey, cutoffDate] of pairEarliest.entries()) {
      const [from, to] = pairKey.split("->");

      // Skip if we already have historical rates for this pair, in either
      // direction: a pair is stored once, so asking only about `from->to` reads
      // a pair held the other way as uncovered and re-fetches it from the
      // provider on every run, forever. `readCoverage` asks the same way.
      const existingRates = await withScopedDb(this.dataSource, (manager) =>
        manager.query(
          `SELECT COUNT(*)::INT AS count FROM exchange_rates
         WHERE (from_currency = $1 AND to_currency = $2)
            OR (from_currency = $2 AND to_currency = $1)`,
          [from, to],
        ),
      );

      if (existingRates[0]?.count > 0) {
        results.push({ pair: `${from}/${to}`, success: true, ratesLoaded: 0 });
        successful++;
        continue;
      }

      const rates = await this.fetchYahooHistoricalRates(from, to);

      if (!rates || rates.length === 0) {
        results.push({
          pair: `${from}/${to}`,
          success: false,
          ratesLoaded: 0,
          error: "No historical data available",
        });
        failed++;
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }

      // Filter to only keep rates from the earliest transaction date onward
      let filtered = rates.filter((r) => r.date >= cutoffDate);

      // Deduplicate by date
      const seen = new Set<string>();
      filtered = filtered.filter((r) => {
        const key = r.date.toISOString().substring(0, 10);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      if (filtered.length === 0) {
        results.push({ pair: `${from}/${to}`, success: true, ratesLoaded: 0 });
        successful++;
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }

      try {
        // Same bulk upsert the single-date lookup uses, which also writes the
        // inverse pair -- this loop used to store one direction only, so a
        // CAD->USD lookup went out to the provider even though the USD->CAD
        // history had just been backfilled.
        await this.persistRateSeries(from, to, filtered);

        this.logger.log(
          `Backfilled ${filtered.length} rates for ${from}/${to} (from ${cutoffDate.toISOString().substring(0, 10)})`,
        );
        results.push({
          pair: `${from}/${to}`,
          success: true,
          ratesLoaded: filtered.length,
        });
        successful++;
        totalRatesLoaded += filtered.length;
      } catch (error) {
        this.logger.error(
          `Failed to save historical rates for ${from}/${to}: ${error.message}`,
        );
        results.push({
          pair: `${from}/${to}`,
          success: false,
          ratesLoaded: 0,
          error: error.message,
        });
        failed++;
      }

      // Small delay between pairs to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const duration = Date.now() - startTime;
    this.logger.log(
      `Historical rate backfill completed in ${duration}ms: ${successful} successful, ${failed} failed, ${totalRatesLoaded} total rates`,
    );

    return {
      totalPairs: pairEarliest.size,
      successful,
      failed,
      totalRatesLoaded,
      results,
    };
  }

  /**
   * Make sure the stored series can answer `date` for each pair, fetching from
   * the provider the ones it cannot.
   *
   * The daily refresh only ever writes today, and `backfillHistoricalRates`
   * skips a pair the moment it has *any* row -- so a user whose USD/CAD history
   * starts at their import has nothing at all for 2017, and a point-in-time
   * report asked about that year cannot present a USD account in CAD or value a
   * USD holding inside a CAD brokerage. Neither is a number to guess at: the
   * report reports the pair as missing and the total goes null, which is what
   * the user sees as "Total unavailable". The rates are simply not there yet,
   * so this fetches them.
   *
   * **The unit is a calendar month, not a day.** One provider call returns the
   * whole daily series for whatever period it is asked for and costs the same
   * either way, so asking for the month around `date` -- plus
   * `BOUNDARY_LAG_DAYS` of lead, which is the span `closeAt` may reach back
   * over, so the first days of the month are answerable too -- makes every
   * other date in that month a database read. A user stepping a report back
   * through a year pays twelve calls per pair rather than three hundred.
   *
   * Best-effort by construction: it is called from a read path, so a provider
   * failure is logged and the report renders with the pair still missing rather
   * than the request failing. Callers decide which pairs are missing; this does
   * not re-check the database, and it never invents a rate -- a pair the
   * provider has no data for stays absent.
   *
   * Returns the number of daily observations persisted.
   */
  async ensureRatesForDate(
    pairs: ReadonlyArray<{ from: string; to: string }>,
    date: string,
  ): Promise<number> {
    // A pair is stored once, whichever way it was asked for, so USD->CAD and
    // CAD->USD are the same piece of work and must not be fetched twice.
    const wanted = new Map<string, { from: string; to: string }>();
    for (const pair of pairs) {
      if (!pair.from || !pair.to || pair.from === pair.to) continue;
      const key = directionlessPairKey(pair.from, pair.to);
      if (!wanted.has(key)) wanted.set(key, pair);
    }
    if (wanted.size === 0) return 0;

    const month = date.slice(0, 7);
    const due = [...wanted.entries()].filter(
      ([key]) => !this.emptyRateWindows.has(key, month),
    );
    if (due.length === 0) return 0;

    const [start, end] = monthFetchWindow(date);
    this.logger.log(
      `Fetching historical rates for ${due.map(([, p]) => `${p.from}/${p.to}`).join(", ")} over ${start} to ${end}`,
    );

    const loaded = await mapWithConcurrency(
      due,
      FX_FETCH_CONCURRENCY,
      async ([key, pair]) => {
        try {
          const { stored, answered } = await this.fillRateWindow(
            pair.from,
            pair.to,
            start,
            end,
          );
          if (stored === 0 && answered) {
            // Nothing exists for this pair in this era -- a currency that
            // predates the provider's history, or one it does not carry. Note
            // it, so a report reloaded on the same date does not re-ask.
            //
            // Only when the provider actually answered: a refusal and a
            // transport failure produce the same zero, and this memory holds
            // for 30 minutes -- long enough for a two-minute outage to leave
            // every foreign-currency total in the report null well after the
            // provider came back. The fill reports it, because it is the one
            // that saw the response.
            this.emptyRateWindows.remember(key, month);
            this.logger.warn(
              `No historical rates available for ${pair.from}/${pair.to} over ${start} to ${end}`,
            );
          }
          return stored;
        } catch (error) {
          this.logger.warn(
            `Historical rate fetch ${pair.from}->${pair.to} over ${start} to ${end} failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          return 0;
        }
      },
    );

    return loaded.reduce((sum, count) => sum + count, 0);
  }

  /**
   * One pair, one window, persisted in the pair's canonical orientation.
   *
   * The reverse symbol is tried when the direct one returns nothing *or too
   * little* (`isSparseRateSeries`), because Yahoo carries some pairs fully under
   * one orientation only -- `VNDSGD=X` returned one bar for a month while
   * `SGDVND=X` had every day -- and `persistRateSeries` orients whatever
   * answered, so `CADUSD=X` answers a `USD->CAD` question just as well, landing
   * on the same rows the direct symbol would have.
   *
   * When both answered, the denser series is stored whole and the other only
   * for the days the denser one lacks: the two are the same rows once oriented,
   * so one day is written from one symbol, never from both.
   */
  /**
   * @returns the number of observations persisted, and whether the provider
   *   *answered* at all -- `[]` (no rates for this pair in this window) rather
   *   than `null` (a transport failure, or a call the breaker refused). Only an
   *   answer may be remembered as an empty window: the two produce the same
   *   zero, and the memory holds for 30 minutes.
   *
   * Public so `ExchangeRateHistoryService` can reach it: a user-driven history
   * extension asks the provider exactly the question the on-demand fill asks,
   * and a second copy of "fetch a window, try the reverse symbol, persist both
   * directions" is how the two would drift.
   */
  async fillRateWindow(
    from: string,
    to: string,
    start: string,
    end: string,
  ): Promise<{ stored: number; answered: boolean }> {
    const startDate = new Date(`${start}T00:00:00.000Z`);
    const endDate = new Date(`${end}T23:59:59.999Z`);

    const direct = await this.fetchYahooHistoricalRatesWindow(
      from,
      to,
      startDate,
      endDate,
    );
    if (direct && !isSparseRateSeries(seriesDays(direct), start, end)) {
      return {
        stored: await this.persistRateSeries(from, to, direct),
        answered: true,
      };
    }

    const reverse = await this.fetchYahooHistoricalRatesWindow(
      to,
      from,
      startDate,
      endDate,
    );
    const directSeries = { from, to, series: direct ?? [] };
    const reverseSeries = { from: to, to: from, series: reverse ?? [] };
    if (directSeries.series.length > 0 || reverseSeries.series.length > 0) {
      // The denser answer first, the direct one on a tie; the other contributes
      // only the days the first has no bar for.
      const [primary, secondary] =
        seriesDays(reverseSeries.series).length >
        seriesDays(directSeries.series).length
          ? [reverseSeries, directSeries]
          : [directSeries, reverseSeries];
      const covered = new Set(seriesDays(primary.series));
      const extra = secondary.series.filter(
        (point) => !covered.has(point.date.toISOString().slice(0, 10)),
      );
      const stored =
        (await this.persistRateSeries(
          primary.from,
          primary.to,
          primary.series,
        )) +
        (await this.persistRateSeries(secondary.from, secondary.to, extra));
      return { stored, answered: true };
    }

    // Both directions, not either: "this pair has no rates in this window" is
    // only known when both symbols answered. One of them answering `[]` while
    // the other failed or was refused is exactly the half-knowledge that used
    // to be cached for thirty minutes.
    return { stored: 0, answered: direct !== null && reverse !== null };
  }

  /**
   * Get the latest exchange rates (most recent per currency pair)
   */
  async getLatestRates(): Promise<ExchangeRate[]> {
    return withScopedDb(this.dataSource, (manager) =>
      manager
        .getRepository(ExchangeRate)
        .createQueryBuilder("er")
        .distinctOn(["er.from_currency", "er.to_currency"])
        .orderBy("er.from_currency")
        .addOrderBy("er.to_currency")
        .addOrderBy("er.rate_date", "DESC")
        .getMany(),
    );
  }

  /**
   * The latest stored rate for a pair, in whichever direction it is stored.
   *
   * Both directions are read and `resolveFxRate` chooses between them, so this
   * answers the same question as every other lookup rather than a
   * direction-specific one of its own. It used to read the stored pair one way
   * only, returning `null` whenever the pair happened to be held the other way
   * -- harmless while every fetch wrote a mirror row, and a silent gap once a
   * pair is stored once (INV-FX-003). The posting fallbacks and the
   * scheduled-estimate refresh were the callers that went unanswered.
   */
  async getLatestRate(
    from: string,
    to: string,
    /**
     * Reject a stored rate older than this many days, returning null instead.
     *
     * Omitted, the newest rate is returned whatever its age -- which is what
     * every caller that only needs an indicative conversion has always got. A
     * caller whose output is a money figure the user acts on should supply a
     * bound: a rate is a price like any other, and one from nine months ago
     * converts a 10,000 USD holding into a confident PLN total that is off by
     * the year's currency move, with nothing in the payload saying so
     * (`docs/financial-calculation-contract.md` rules 3 and 4).
     */
    maxAgeDays?: number,
  ): Promise<number | null> {
    if (from === to) return 1;
    const today = todayYMD();
    // The age bound on the query as well as in the resolver: the resolver
    // decides admissibility, this just keeps the rows it reads bounded. A
    // calendar step, not a local-midnight `Date` read back through `toISOString`.
    const bound: { rateDate?: FindOperator<Date> } =
      maxAgeDays === undefined
        ? {}
        : {
            // `MoreThanOrEqual` stays spelled out here rather than behind a
            // helper: `price-boundary.one-door.spec.ts` reads the lower bound of
            // a newest-row read off the lines around the ordering, and a bound
            // it cannot see is a bound the next reader cannot see either. The
            // string cast is what `ymdSpan` explains -- a `Date` bound is
            // rendered by `pg` in the process time zone and, west of UTC, names
            // the previous calendar day.
            rateDate: MoreThanOrEqual(
              addDaysYMD(today, -maxAgeDays),
            ) as unknown as FindOperator<Date>,
          };
    const [direct, reverse] = await withScopedDb(
      this.dataSource,
      async (manager) => {
        const repo = manager.getRepository(ExchangeRate);
        const newest = (f: string, t: string) =>
          repo.findOne({
            where: { fromCurrency: f, toCurrency: t, ...bound },
            order: { rateDate: "DESC" },
          });
        return [await newest(from, to), await newest(to, from)] as const;
      },
    );

    const observed = (row: ExchangeRate | null) => {
      if (row === null) return undefined;
      const date =
        row.rateDate instanceof Date
          ? row.rateDate.toISOString().slice(0, 10)
          : String(row.rateDate).slice(0, 10);
      return [{ date, rate: Number(row.rate) }];
    };

    // `live`: the freshest observation rather than one dated on or before today,
    // which is what "the latest rate" has always meant here. An omitted bound is
    // no bound at all, as before.
    return resolveFxRate(
      from,
      to,
      today,
      (f, t) => (f === from && t === to ? observed(direct) : observed(reverse)),
      {
        mode: "live",
        maxAgeDays: maxAgeDays ?? Number.POSITIVE_INFINITY,
        today,
      },
    ).rate;
  }

  /**
   * The stored observations that could price `onDate`, resolved through the one
   * door (`resolveFxRate`).
   *
   * This is the shared stored-rate step behind `getRateForDate` and any caller
   * that needs the *whole* answer -- the observation's own date, the direction
   * it was stored in, and the reason there is none -- rather than a bare
   * number. Only the admissible span is read (`FX_MAX_RATE_AGE_DAYS` back from
   * the clamped date, both directions), which is what stops one ancient row
   * standing in for a date it says nothing about and, equally, stops that row
   * short-circuiting the provider fetch that would have filled the gap.
   */
  async resolveStoredRate(
    from: string,
    to: string,
    onDate: string,
    options?: { mode?: FxRateMode; maxAgeDays?: number },
  ): Promise<FxRateResolution> {
    const mode = options?.mode ?? "historical";
    const maxAgeDays = options?.maxAgeDays ?? FX_MAX_RATE_AGE_DAYS;
    const today = todayYMD();

    if (!from || !to || from === to) {
      return resolveFxRate(from, to, onDate, () => undefined, {
        mode,
        maxAgeDays,
        today,
      });
    }

    // The reference day, refusing a value that names none: the span below is a
    // pair of `YYYY-MM-DD` strings and a request parameter typed `string` may
    // arrive as an array (`fxReferenceDate`).
    const reference = fxReferenceDate(onDate, today, mode);
    if (reference === null) {
      return resolveFxRate(from, to, onDate, () => undefined, {
        mode,
        maxAgeDays,
        today,
      });
    }
    // The span is expressed as YYYY-MM-DD strings, never `Date` objects.
    // TypeORM does not normalise a select-side parameter: `pg` renders a `Date`
    // in the process time zone, and PostgreSQL's cast to `date` keeps whatever
    // literal date that rendering produced. West of UTC a UTC-midnight `Date`
    // renders as the previous day, so the upper bound became yesterday and the
    // reference date's own row -- today's rate, in `live` mode -- dropped out of
    // the result. A string is compared as the calendar date it names in every
    // time zone.
    const floor = addDaysYMD(reference, -maxAgeDays);
    const span = ymdSpan(floor, reference);

    const rows = await withScopedDb(this.dataSource, (manager) =>
      manager.getRepository(ExchangeRate).find({
        where: [
          { fromCurrency: from, toCurrency: to, rateDate: span },
          { fromCurrency: to, toCurrency: from, rateDate: span },
        ],
        order: { rateDate: "ASC" },
      }),
    );

    const observed = new Map<string, Array<{ date: string; rate: number }>>();
    for (const row of rows) {
      const key = `${row.fromCurrency}->${row.toCurrency}`;
      const date =
        row.rateDate instanceof Date
          ? row.rateDate.toISOString().slice(0, 10)
          : String(row.rateDate).slice(0, 10);
      const list = observed.get(key);
      const point = { date, rate: Number(row.rate) };
      if (list) list.push(point);
      else observed.set(key, [point]);
    }

    return resolveFxRate(
      from,
      to,
      onDate,
      (f, t) => observed.get(`${f}->${t}`),
      {
        mode,
        maxAgeDays,
        today,
      },
    );
  }

  /**
   * Get the exchange rate for a currency pair as of a specific date.
   *
   * Unlike the once-a-day stored snapshot, this returns the
   * rate that applied on the transaction's date -- essential for back-dated
   * transactions, where the latest snapshot can be far from the historical
   * rate. Precedence:
   *   0. A date in the future has no rate and never will until it arrives, so
   *      the target is clamped to today and the answer is today's rate. Without
   *      the clamp a future date fell through to a Yahoo window that contains
   *      nothing, and the lookup returned null for a scheduled transaction
   *      posted ahead of time.
   *   1. The stored observations inside the admissible span, resolved by
   *      `resolveFxRate`: the most recent one on or before the target, in
   *      either stored direction. This is what makes a weekend or a holiday
   *      resolve -- Saturday and Sunday carry Friday's rate forward.
   *   2. When the span holds none, a historical daily window fetched from the
   *      provider around the target date, resolved by the same rule and
   *      persisted for reuse. The step is driven by *coverage of the target*,
   *      not by "does this pair have any row at all": one 2019 row used to
   *      short-circuit it, which is how a 285-day hole stayed a hole.
   * Returns null when no rate can be determined (so the caller can reject or
   * flag the operation rather than silently assuming 1.0). There is no
   * unbounded "latest stored rate of any date" step any more: a rate is a price
   * and an arbitrarily old one does not describe the date being asked about
   * (`docs/time-series-contract.md` section 2.2).
   */
  async getRateForDate(
    from: string,
    to: string,
    date: string | Date,
    options?: {
      /**
       * Fetch a provider window when the stored span covers nothing. Default
       * true; a read-only caller (a report converting hundreds of rows) passes
       * false to stay inside the database.
       */
      fetchMissing?: boolean;
      mode?: FxRateMode;
    },
  ): Promise<number | null> {
    if (from === to) return 1;

    const requested =
      typeof date === "string"
        ? date.slice(0, 10)
        : date.toISOString().slice(0, 10);

    // 0. Clamp a future date to today: today's rate is the best available
    //    estimate, and it is the same figure the bills list is showing.
    const todayUtc = todayYMD();
    const target = requested > todayUtc ? todayUtc : requested;
    const targetDate = new Date(`${target}T00:00:00.000Z`);

    // 1. The stored history, through the one door.
    const stored = await this.resolveStoredRate(from, to, target, {
      mode: options?.mode,
    });
    if (stored.rate !== null) return stored.rate;
    if (options?.fetchMissing === false) return null;

    // 2. Fetch a provider window around the target (not the full "max" history)
    //    and resolve it by the same rule.
    //
    //    The window is wide because it costs nothing to be: one call returns
    //    the whole daily series for the period, and every bar in it is
    //    persisted below. Six weeks back and one forward means a user stepping
    //    a date field through a month of history pays for a single fetch, and
    //    the reverse pair is filled in at the same time. It was two weeks back
    //    and one point kept, so neighbouring dates each went back out to the
    //    provider and ran into its rate limits. The span back is the age bound
    //    itself, so the fetch covers exactly what the bound would accept.
    const windowStart = new Date(
      targetDate.getTime() - FX_MAX_RATE_AGE_DAYS * 86_400_000,
    );
    const windowEnd = new Date(targetDate.getTime() + 7 * 86_400_000);
    const series = await this.fetchYahooHistoricalRatesWindow(
      from,
      to,
      windowStart,
      windowEnd,
    );
    if (series && series.length > 0) {
      const fetched = series.map((point) => ({
        date: point.date.toISOString().slice(0, 10),
        rate: point.rate,
      }));
      try {
        // The whole window, not just the day that was asked for: the next
        // lookup for any date in it is then a database read. Persisted whether
        // or not the target itself resolves, because a neighbouring date may.
        const persisted = await this.persistRateSeries(from, to, series);
        this.logger.log(
          `Stored ${persisted} daily ${from}/${to} rates around ${target} from one lookup`,
        );
      } catch (error) {
        this.logger.warn(
          `Could not persist historical rates ${from}->${to} around ${target}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      // The same rule as the stored step: the closest bar on or before the
      // target, never one from after it. A window that brackets the target but
      // starts after it answers nothing -- it used to answer with its nearest
      // point in either direction, which is the look-ahead this closes.
      const resolved = resolveFxRate(
        from,
        to,
        target,
        (f, t) => (f === from && t === to ? fetched : undefined),
        { mode: options?.mode, today: todayUtc },
      );
      if (resolved.rate !== null) return resolved.rate;
    }

    this.logger.warn(
      describeFxGap(
        `${from}->${to}`,
        target,
        stored.reason ?? "no_observation",
      ),
    );
    return null;
  }

  /**
   * Convert one amount between two currencies at the rate that applied on a
   * date -- the shared implementation behind the AI Assistant's and the MCP
   * server's `calculate` tool (`operation: "convert"`), so a model never does
   * the conversion itself.
   *
   * `date` is optional and defaults to today (`todayYMD`, the caller's request
   * timezone); a future date is clamped to today by `getRateForDate`, and the
   * clamped date is what `date` reports back. The rate goes through
   * `resolveFxRateOrNull`, the one market-rate ladder (the admissible stored
   * observations on or before the date, then a provider window resolved by the
   * same rule), so the figure matches what a transaction posted on that date
   * would carry.
   *
   * Returns `null` when no usable rate exists in either direction -- never `1`,
   * and never the input amount: `docs/specs/fx-conversion-completeness.md`.
   * Either stored direction answers, because the ladder resolves the pair
   * through `resolveFxRate`; this does not chase the reverse pair itself.
   */
  async convertOnDate(
    amount: number,
    fromCurrency: string,
    toCurrency: string,
    date?: string,
  ): Promise<DatedConversion | null> {
    const from = fromCurrency.toUpperCase();
    const to = toCurrency.toUpperCase();
    const requested = (date ?? todayYMD()).slice(0, 10);
    const today = todayYMD();
    // The same clamp `getRateForDate` applies, surfaced so the caller learns
    // which day's rate it actually received.
    const effectiveDate = requested > today ? today : requested;

    if (from === to) {
      return {
        amount,
        fromCurrency: from,
        toCurrency: to,
        date: effectiveDate,
        rate: 1,
        convertedAmount: amount,
      };
    }

    // One lookup. The second one this used to make -- the pair reversed, the
    // answer reciprocated -- could never add anything: the ladder it calls
    // already consults both stored directions and inverts the reverse
    // observation itself, so a `null` from the first call means the pair is
    // unknown, not that it is held the other way.
    const rate = await resolveFxRateOrNull(this, from, to, effectiveDate);
    if (rate === null) return null;

    return {
      amount,
      fromCurrency: from,
      toCurrency: to,
      date: effectiveDate,
      rate,
      convertedAmount: roundMoney(amount * rate),
    };
  }

  /**
   * Get the current spot rate for a currency pair, fetched live from the quote
   * provider. Tries the direct pair, then the reverse pair (inverted), then the
   * stored history when the live fetch is unavailable (rate limited,
   * unsupported pair, offline).
   *
   * The stored fallback is `resolveStoredRate` in `live` mode, not an
   * unbounded newest-row read: a rate quoted as "right now" is still a price,
   * so an observation older than `FX_MAX_RATE_AGE_DAYS` is not one. The
   * unbounded read is what let a 276-day-old rate be cached as live and carried
   * into a portfolio total that reported itself complete (issue #1390).
   *
   * Use this for "as of now" valuations such as the Investments portfolio
   * summary so they line up with the live intraday Portfolio Value Over Time
   * chart, which fetches live FX directly from the quote provider, rather than
   * the once-a-day stored snapshot. Returns `null` when neither a live quote
   * nor an admissible stored rate exists; `null` is unknown, and no caller may
   * read it as 1 or as the unconverted amount (INV-FX-001).
   */
  async getLiveRate(from: string, to: string): Promise<number | null> {
    if (from === to) return 1;
    try {
      const direct = await this.fetchYahooRate(from, to);
      if (direct !== null && direct > 0) return direct;
      const reverse = await this.fetchYahooRate(to, from);
      if (reverse !== null && reverse > 0) return 1 / reverse;
    } catch (error) {
      this.logger.warn(
        `Live FX fetch ${from}->${to} failed, falling back to stored rate: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    const stored = await this.resolveStoredRate(from, to, todayYMD(), {
      mode: "live",
    });
    if (stored.rate === null && stored.reason !== null) {
      this.logger.warn(
        describeFxGap(`${from}->${to}`, todayYMD(), stored.reason),
      );
    }
    return stored.rate;
  }

  /**
   * Get exchange rates within a date range (for historical net worth)
   */
  async getRateHistory(
    startDate?: string,
    endDate?: string,
  ): Promise<ExchangeRate[]> {
    const where: any = {};
    if (startDate) {
      where.rateDate = MoreThanOrEqual(startDate);
    }
    if (endDate) {
      where.rateDate = startDate
        ? And(MoreThanOrEqual(startDate), LessThanOrEqual(endDate))
        : LessThanOrEqual(endDate);
    }

    return withScopedDb(this.dataSource, (manager) =>
      manager.getRepository(ExchangeRate).find({
        where,
        order: { rateDate: "ASC", fromCurrency: "ASC", toCurrency: "ASC" },
      }),
    );
  }

  /**
   * Get all active currencies
   */
  async getCurrencies(): Promise<Currency[]> {
    return withScopedDb(this.dataSource, (manager) =>
      manager.getRepository(Currency).find({
        where: { isActive: true },
        order: { code: "ASC" },
      }),
    );
  }

  /**
   * Get the last time exchange rates were updated
   */
  async getLastUpdateTime(): Promise<Date | null> {
    const latest = await withScopedDb(this.dataSource, (manager) =>
      manager.getRepository(ExchangeRate).findOne({
        where: {},
        order: { createdAt: "DESC" },
      }),
    );
    return latest?.createdAt ?? null;
  }

  /**
   * Scheduled job to refresh exchange rates daily at 5:05 PM EST (after market
   * close). Runs Monday-Friday only. Staggered five minutes after the security
   * price refresh (5:00 PM) so the two Yahoo-hitting jobs do not burst at the
   * same instant.
   */
  @Cron("5 17 * * 1-5", { timeZone: "America/New_York" })
  async scheduledRateRefresh(): Promise<void> {
    this.logger.log("Running scheduled exchange rate refresh");
    try {
      // RLS (task C2): the currency-detection read spans all users' accounts,
      // securities, holdings and preferences (writes only the global
      // exchange_rates table), so the refresh runs under a system context.
      //
      // One replica per tick makes the provider calls (task C2). The upserts
      // beneath are idempotent, so this is about cost and rate limits rather
      // than about correctness -- which is why a lost lease is a debug line and
      // never blocks the next tick.
      await withSystemContext(() =>
        this.fetchSync.withLease(
          FetchSyncJob.ExchangeRates,
          this.FETCH_LEASE_MS,
          async () => {
            await this.refreshAllRates();
          },
        ),
      );
    } catch (error) {
      this.logger.error(
        `Scheduled exchange rate refresh failed: ${error.message}`,
      );
    }
  }
}
