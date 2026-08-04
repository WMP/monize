import { Module } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import { DataSource } from "typeorm";
import { NetWorthService } from "@/net-worth/net-worth.service";
import { GemPriceService } from "@/strategies/gem-price.service";
import { GemStrategy } from "@/strategies/entities/gem-strategy.entity";
import {
  GEM_SIGNAL_ALGORITHM_VERSION,
  GemSignalService,
} from "@/strategies/gem-signal.service";
import { GemStrategySignal } from "@/strategies/entities/gem-strategy-signal.entity";
import { Security } from "@/securities/entities/security.entity";
import { SecurityPrice } from "@/securities/entities/security-price.entity";
import {
  createIntegrationModule,
  cleanTables,
  createTestUserDirect,
} from "../helpers/integration-setup";
import { withUserContext } from "@/common/db/with-context";

/**
 * Just the collaborators this suite touches -- deliberately not
 * `StrategiesModule`.
 *
 * That module imports `SecuritiesModule`, and entering the graph from there
 * leaves `HoldingsService` undefined in `InvestmentTransactionsService`'s
 * constructor metadata: a circular import whose resolution order depends on
 * which module is the entry point, so the app boots fine and this suite did not.
 * `GemPriceService` needs nothing but the `DataSource` that
 * `TypeOrmModule.forRoot` already provides globally, and the ON CONFLICT test
 * goes through a repository, so none of that graph is needed here.
 *
 * `NetWorthService` is stubbed because the shared harness silences its debounced
 * recalculation on whatever graph it is handed, and would otherwise fail to find
 * it in a module this small.
 */
@Module({
  providers: [
    GemPriceService,
    {
      provide: NetWorthService,
      useValue: { triggerDebouncedRecalc: () => {} },
    },
  ],
})
class GemPriceTestModule {}

/**
 * The two most safety-critical database interactions in the GEM layer, against a
 * real PostgreSQL.
 *
 * `gem-price.service.spec.ts` verifies them by matching SQL strings and says so
 * itself: a mocked `query` cannot execute the statement, so it can only assert
 * that the rule is *expressed*. Both rules are about semantics no string match
 * reaches -- which rows a per-security price basis actually returns, and what
 * `ON CONFLICT DO NOTHING ... RETURNING *` actually reports when it loses a
 * race. Each has already been wrong in a way that looked right:
 *
 * - a per-row `COALESCE(adjusted_close, close_price)` spliced raw rows into an
 *   adjusted series for any instrument the user had traded, fabricating a
 *   several-hundred-percent return across a split;
 * - `generatedMaps` was read as "the row went in", and it is truthy after a
 *   conflict too, so every lost-race branch was dead, tested and unreachable.
 */
describe("GEM prices and signal materialization (integration)", () => {
  let module: TestingModule;
  let prices: GemPriceService;
  let dataSource: DataSource;
  let userId: string;

  beforeAll(async () => {
    module = await createIntegrationModule([GemPriceTestModule]);
    prices = module.get(GemPriceService);
    dataSource = module.get(DataSource);
  });

  afterAll(async () => {
    // Guarded: a `beforeAll` that threw leaves this undefined, and calling
    // `close()` on it replaces the real error with a TypeError and buries the
    // suite under teardown noise -- which is exactly how the first CI run
    // reported this file.
    if (module) await module.close();
  });

  beforeEach(async () => {
    await cleanTables(dataSource, [
      "gem_strategy_signals",
      "gem_strategy_assets",
      "gem_strategy_accounts",
      "gem_strategies",
      "security_prices",
      "securities",
      "accounts",
      "categories",
      "payees",
      "users",
    ]);
    const user = await createTestUserDirect(dataSource);
    userId = user.id;
  });

  /** A security the price rows below hang off. */
  async function security(symbol: string): Promise<string> {
    const saved = await dataSource.manager.save(
      dataSource.manager.create(Security, {
        userId,
        symbol,
        name: `${symbol} fund`,
        securityType: "ETF",
        currencyCode: "USD",
      }),
    );
    return saved.id;
  }

  /**
   * One stored close. `adjustedClose` is nullable per row on purpose: only the
   * provider backfill writes it, while transaction-derived prices, the MNY
   * import and the demo seed insert a raw close with nothing beside it.
   */
  async function price(
    securityId: string,
    date: string,
    close: number,
    adjustedClose: number | null,
  ): Promise<void> {
    await dataSource.manager.save(
      dataSource.manager.create(SecurityPrice, {
        userId,
        securityId,
        priceDate: date,
        closePrice: close,
        adjustedClose,
      }),
    );
  }

  describe("one price basis per security, never per row", () => {
    it("returns only the adjusted rows for an instrument that has any", async () => {
      // A 4-for-1 split on 15 January: the raw close drops from 400 to 100 and
      // the adjusted series carries the pre-split closes restated. The 20
      // January row is transaction-derived -- raw only, no adjusted value --
      // which is exactly the row a per-row fallback spliced in.
      const spy = await security("SPY");
      await price(spy, "2025-01-10", 400, 100);
      await price(spy, "2025-01-15", 100, 100);
      await price(spy, "2025-01-20", 105, null);

      const series = await withUserContext(userId, () =>
        prices.loadSeries([spy], "2025-01-01"),
      );

      expect(series.get(spy)).toEqual([
        { date: "2025-01-10", close: 100 },
        { date: "2025-01-15", close: 100 },
      ]);
    });

    it("returns the raw closes for an instrument nobody has adjusted", async () => {
      // The only series available for such an instrument, and consistent
      // throughout -- which is the point of deciding per security.
      const ief = await security("IEF");
      await price(ief, "2025-01-10", 95, null);
      await price(ief, "2025-01-20", 96, null);

      const series = await withUserContext(userId, () =>
        prices.loadSeries([ief], "2025-01-01"),
      );

      expect(series.get(ief)).toEqual([
        { date: "2025-01-10", close: 95 },
        { date: "2025-01-20", close: 96 },
      ]);
    });

    it("decides per security within a single query", async () => {
      // The report loads four series at once. The basis is a property of the
      // instrument, so one adjusted instrument must not change what another
      // returns -- and one raw instrument must not drag an adjusted one onto
      // raw closes.
      const spy = await security("SPY");
      const ief = await security("IEF");
      await price(spy, "2025-01-10", 400, 100);
      await price(spy, "2025-01-20", 105, null);
      await price(ief, "2025-01-10", 95, null);
      await price(ief, "2025-01-20", 96, null);

      const series = await withUserContext(userId, () =>
        prices.loadSeries([spy, ief], "2025-01-01"),
      );

      expect(series.get(spy)).toEqual([{ date: "2025-01-10", close: 100 }]);
      expect(series.get(ief)).toEqual([
        { date: "2025-01-10", close: 95 },
        { date: "2025-01-20", close: 96 },
      ]);
    });

    it("excludes rows before the requested window", async () => {
      const spy = await security("SPY");
      await price(spy, "2024-12-01", 90, null);
      await price(spy, "2025-01-10", 100, null);

      const series = await withUserContext(userId, () =>
        prices.loadSeries([spy], "2025-01-01"),
      );

      expect(series.get(spy)).toEqual([{ date: "2025-01-10", close: 100 }]);
    });

    it("thins a month sampling to the last close of each month, oldest first", async () => {
      // `DISTINCT ON` orders descending inside a bucket, so the ascending order
      // every consumer assumes -- `pointAsOf` binary-searches on it -- is
      // restored afterwards. A mocked query cannot show that it needed to be.
      const spy = await security("SPY");
      await price(spy, "2025-01-05", 100, null);
      await price(spy, "2025-01-28", 110, null);
      await price(spy, "2025-02-03", 120, null);
      await price(spy, "2025-02-25", 130, null);

      const series = await withUserContext(userId, () =>
        prices.loadSeries([spy], "2025-01-01", "month"),
      );

      expect(series.get(spy)).toEqual([
        { date: "2025-01-28", close: 110 },
        { date: "2025-02-25", close: 130 },
      ]);
    });

    it("keeps the adjusted basis when thinning as well", async () => {
      const spy = await security("SPY");
      await price(spy, "2025-01-28", 400, 100);
      await price(spy, "2025-02-25", 130, null);

      const series = await withUserContext(userId, () =>
        prices.loadSeries([spy], "2025-01-01", "month"),
      );

      // February has no adjusted row at all, so the month is absent rather than
      // answered from a raw close on an adjusted series.
      expect(series.get(spy)).toEqual([{ date: "2025-01-28", close: 100 }]);
    });
  });

  describe("latest prices refuse a close that cannot stand for today", () => {
    it("returns a recent close and omits a stale one", async () => {
      const spy = await security("SPY");
      const old = await security("OLD");
      await price(spy, "2025-03-10", 500, 500);
      await price(old, "2024-01-02", 45, null);

      const latest = await withUserContext(userId, () =>
        prices.latestPrices([spy, old], undefined, "2025-03-14"),
      );

      // The raw close, deliberately: this values a position, where the adjusted
      // series is the wrong number.
      expect(latest.get(spy)).toBe(500);
      // Absent, not zero -- so the caller can tell "not priced" from "worthless".
      expect(latest.has(old)).toBe(false);
    });
  });

  describe("a lost materialization race reports itself", () => {
    /** The strategy the signals below belong to. */
    async function strategy(): Promise<string> {
      const saved = await dataSource.manager.save(
        dataSource.manager.create(GemStrategy, {
          userId,
          name: "GEM",
          cadence: "MONTHLY",
          lookbackMonths: 12,
        }),
      );
      return saved.id;
    }

    const signalFor = (strategyId: string, fingerprint: string) => ({
      userId,
      strategyId,
      evaluatedOn: "2025-07-31",
      effectiveFrom: "2025-08-01",
      state: "RISK_ON" as const,
      targetRole: "US_EQUITY" as const,
      targetSecurityId: null,
      targetWeightPercent: 100,
      momentum: { US_EQUITY: 12.5 },
      benchmarkRole: "RISK_FREE" as const,
      spreadPp: 8,
      leadPp: 2,
      previousRole: null,
      configFingerprint: fingerprint,
      algorithmVersion: GEM_SIGNAL_ALGORITHM_VERSION,
      executed: false,
    });

    /** The insert materialization performs, with the semantics under test. */
    const insertIgnoringConflict = (strategyId: string, fingerprint: string) =>
      withUserContext(userId, async () => {
        const repo = dataSource.getRepository(GemStrategySignal);
        const result = await repo
          .createQueryBuilder()
          .insert()
          .values(repo.create(signalFor(strategyId, fingerprint)))
          .orIgnore()
          .returning("*")
          .execute();
        return result;
      });

    it("writes the row and returns it when it wins", async () => {
      const strategyId = await strategy();

      const result = await insertIgnoringConflict(strategyId, "fingerprint-a");

      expect(Array.isArray(result.raw)).toBe(true);
      expect(result.raw).toHaveLength(1);
    });

    it("returns no rows when the unique key is already taken", async () => {
      // The assertion the unit suite cannot make. `generatedMaps` is built from
      // the value sets TypeORM was handed, not from what Postgres wrote, so it
      // is `[{}]` -- truthy -- after a conflict as well. `raw` is empty exactly
      // when the insert was skipped, and every abandon-and-re-read branch in
      // `materialize` hangs off that difference.
      const strategyId = await strategy();
      await insertIgnoringConflict(strategyId, "fingerprint-a");

      const second = await insertIgnoringConflict(strategyId, "fingerprint-b");

      expect(second.raw).toHaveLength(0);
      // ...and the misleading field really is truthy, which is why it must not
      // be the one that decides.
      expect(second.generatedMaps.length).toBeGreaterThan(0);

      // One row for the period, and it is the winner's -- the loser did not
      // overwrite the configuration the winner recorded.
      const stored = await withUserContext(userId, () =>
        dataSource.getRepository(GemStrategySignal).find({
          where: { strategyId, evaluatedOn: "2025-07-31" },
        }),
      );
      expect(stored).toHaveLength(1);
      expect(stored[0].configFingerprint).toBe("fingerprint-a");
    });

    it("does not raise, so the surrounding transaction stays usable", async () => {
      // Catching a unique violation instead would abort the transaction: every
      // later statement in the materialization loop would fail with 25P02 and
      // the request would 500. The skip is what keeps the loop going.
      const strategyId = await strategy();
      await withUserContext(userId, async () => {
        const repo = dataSource.getRepository(GemStrategySignal);
        await repo
          .createQueryBuilder()
          .insert()
          .values(repo.create(signalFor(strategyId, "fingerprint-a")))
          .orIgnore()
          .returning("*")
          .execute();
        await repo
          .createQueryBuilder()
          .insert()
          .values(repo.create(signalFor(strategyId, "fingerprint-b")))
          .orIgnore()
          .returning("*")
          .execute();
        // A read after the conflict, which an aborted transaction would refuse.
        await expect(repo.count({ where: { strategyId } })).resolves.toBe(1);
      });
    });

    it("is the service that owns this insert", () => {
      // The statement above mirrors `GemSignalService.materialize`. If that
      // moves off `orIgnore().returning("*")`, this file is testing something
      // nothing runs -- so the source is asserted to still use both.
      const source = GemSignalService.prototype.materialize.toString();
      expect(source).toContain("orIgnore");
      expect(source).toContain("returning");
    });
  });
});
