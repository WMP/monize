import { Test, TestingModule } from "@nestjs/testing";
import { DataSource } from "typeorm";
import { ExchangeRateService } from "./exchange-rate.service";
import { ProviderHealthService } from "../provider-health/provider-health.service";
import { createTestProviderHealth } from "../test-helpers/provider-health-testing";
import { ExchangeRate } from "./entities/exchange-rate.entity";
import { addDaysYMD, todayYMD } from "../common/date-utils";
import { Currency } from "./entities/currency.entity";
import { UserPreference } from "../users/entities/user-preference.entity";
import { YahooFinanceService } from "../securities/yahoo-finance.service";
import { createScopedDbMocks } from "../test-helpers/scoped-db-testing";
import { roundFxRate } from "../common/fx-entry.util";
import {
  getRequestContext,
  requestContextStorage,
} from "../common/request-context";
import {
  createFetchSyncMock,
  fetchSyncProvider,
  type FetchSyncMock,
} from "../test-helpers/job-claim-testing";
import { FetchSyncJob } from "../common/jobs/fetch-sync.service";

jest.mock("../common/db/scoped-db", () =>
  jest.requireActual("../test-helpers/scoped-db-testing").scopedDbMockModule(),
);

// `ensureRatesForDate` clamps its fetch window at today, so today has to be a
// fixture: otherwise "does this month run past today" is a question about the
// day the suite happens to run on. Only `todayYMD` is replaced -- the month
// arithmetic beside it is the real thing.
jest.mock("../common/date-utils", () => ({
  ...jest.requireActual("../common/date-utils"),
  todayYMD: jest.fn(() => "2026-08-18"),
}));

describe("ExchangeRateService", () => {
  let service: ExchangeRateService;
  let fetchSync: FetchSyncMock;
  let health: ProviderHealthService;
  let exchangeRateRepository: Record<string, jest.Mock>;
  /** Rows the single-rate upsert wrote, in order, as the service supplied them. */
  let upsertedRates: Array<{
    fromCurrency: string;
    toCurrency: string;
    rate: number;
    source: string;
  }>;
  let currencyRepository: Record<string, jest.Mock>;
  let userPreferenceRepository: Record<string, jest.Mock>;
  let dataSource: Record<string, jest.Mock>;
  let yahooFinanceService: Record<string, jest.Mock>;

  const mockExchangeRate: ExchangeRate = {
    id: 1,
    fromCurrency: "USD",
    toCurrency: "CAD",
    rate: 1.365,
    rateDate: new Date("2026-02-10"),
    source: "yahoo_finance",
    fromCurrencyRef: null as any,
    toCurrencyRef: null as any,
    createdAt: new Date("2026-02-10T12:00:00Z"),
  };

  const mockCurrency: Currency = {
    code: "USD",
    name: "US Dollar",
    symbol: "$",
    decimalPlaces: 2,
    isActive: true,
    createdByUserId: null,
    createdAt: new Date("2025-01-01"),
  };

  const createMockQueryBuilder = (
    overrides: Record<string, jest.Mock> = {},
  ) => ({
    distinctOn: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
    ...overrides,
  });

  /**
   * Answer `manager.query` by statement instead of with one blanket value.
   *
   * The single-rate save is now `INSERT ... ON CONFLICT DO UPDATE RETURNING id`,
   * so a test that also needs the currency-list query cannot use one
   * `mockResolvedValue` for both. This records what the upsert wrote -- which is
   * what the assertions are about -- and answers the currency list from
   * `codes`.
   */
  function routeRateQueries(codes: string[]): void {
    dataSource.query.mockImplementation(
      async (sql: string, params?: unknown[]) => {
        if (
          typeof sql === "string" &&
          sql.includes("INSERT INTO exchange_rates") &&
          sql.includes("RETURNING id")
        ) {
          const [fromCurrency, toCurrency, , rate] = params as [
            string,
            string,
            Date,
            number,
          ];
          const id = upsertedRates.length + 1;
          upsertedRates.push({
            fromCurrency,
            toCurrency,
            rate,
            source: "yahoo_finance",
          });
          return [{ id }];
        }
        if (typeof sql === "string" && sql.includes("SELECT DISTINCT code")) {
          return codes.map((code) => ({ code }));
        }
        return [];
      },
    );
    // The service reads the upserted row back by id.
    exchangeRateRepository.findOne.mockImplementation(
      async ({ where }: { where: { id?: number } }) =>
        where?.id === undefined
          ? null
          : { id: where.id, ...upsertedRates[where.id - 1] },
    );
  }

  beforeEach(async () => {
    // The single-rate save is now one `INSERT ... ON CONFLICT DO UPDATE
    // RETURNING id` through the manager, so the spec records the statement and
    // hands back the row it wrote. `findOne` still answers the by-id read-back.
    upsertedRates = [];
    exchangeRateRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn().mockImplementation((data) => ({ ...data, id: 1 })),
      save: jest
        .fn()
        .mockImplementation((data) => ({ ...data, id: data.id || 1 })),
      createQueryBuilder: jest.fn(() => createMockQueryBuilder()),
    };

    currencyRepository = {
      find: jest.fn(),
    };

    userPreferenceRepository = {
      findOne: jest.fn(),
    };

    // Raw SQL now runs on the scoped transaction's EntityManager; alias the
    // spec's `dataSource.query` to it so the existing assertions still watch
    // the same statements.
    const scoped = createScopedDbMocks([
      [ExchangeRate, exchangeRateRepository],
      [Currency, currencyRepository],
      [UserPreference, userPreferenceRepository],
    ]);
    scoped.dataSource.query = scoped.manager.query;
    dataSource = scoped.dataSource as unknown as Record<string, jest.Mock>;

    yahooFinanceService = {
      fetchQuote: jest.fn(),
      fetchHistorical: jest.fn(),
      fetchHistoricalWindow: jest.fn(),
    };

    health = createTestProviderHealth();
    fetchSync = createFetchSyncMock();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExchangeRateService,
        { provide: DataSource, useValue: dataSource },
        { provide: YahooFinanceService, useValue: yahooFinanceService },
        // The real breaker, so a spec that drives the provider to failure sees
        // what production sees.
        { provide: ProviderHealthService, useValue: health },
        fetchSyncProvider(fetchSync),
      ],
    }).compile();

    service = module.get<ExchangeRateService>(ExchangeRateService);
  });

  describe("onModuleInit", () => {
    it("fetches rates on startup when no recent rates exist", async () => {
      // No recent rate found
      exchangeRateRepository.findOne.mockResolvedValue(null);
      // refreshAllRates dependencies: dataSource.query for used currencies
      dataSource.query
        .mockResolvedValueOnce([{ code: "USD" }]) // usedCurrencies (only 1, so no pairs)
        .mockResolvedValueOnce([]); // usersWithForeignAccounts

      await service.onModuleInit();

      // First findOne checks for recent rates
      expect(exchangeRateRepository.findOne).toHaveBeenCalledWith({
        where: { rateDate: expect.anything() },
      });
      // dataSource.query called for refreshAllRates + usersWithForeignAccounts
      expect(dataSource.query).toHaveBeenCalled();
    });

    it("skips rate fetch when recent rates exist", async () => {
      exchangeRateRepository.findOne.mockResolvedValue(mockExchangeRate);
      dataSource.query.mockResolvedValue([]); // usersWithForeignAccounts

      await service.onModuleInit();

      // dataSource.query called only once for usersWithForeignAccounts, not for refreshAllRates
      expect(dataSource.query).toHaveBeenCalledTimes(1);
    });

    it("triggers backfill for users with foreign accounts", async () => {
      // A real UUID: the startup fan-out re-wraps each backfill in
      // withUserContext, which rejects a non-UUID id.
      const backfillUserId = "11111111-1111-4111-8111-111111111111";
      exchangeRateRepository.findOne.mockResolvedValue(mockExchangeRate);
      dataSource.query.mockResolvedValue([{ user_id: backfillUserId }]);

      // Mock backfillHistoricalRates dependencies
      userPreferenceRepository.findOne.mockResolvedValue({
        userId: backfillUserId,
        defaultCurrency: "USD",
      });

      // The backfill call runs async via .catch(), so we need the query mocks for it
      // First call: usersWithForeignAccounts
      // Subsequent calls: backfill queries
      dataSource.query
        .mockResolvedValueOnce([{ user_id: backfillUserId }]) // usersWithForeignAccounts
        .mockResolvedValueOnce([]) // accountCurrencyRows
        .mockResolvedValueOnce([]); // securityCurrencyRows

      await service.onModuleInit();

      // Give the async backfill a moment to execute
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(userPreferenceRepository.findOne).toHaveBeenCalledWith({
        where: { userId: backfillUserId },
      });
    });

    it("handles errors gracefully without throwing", async () => {
      exchangeRateRepository.findOne.mockRejectedValue(new Error("DB down"));

      // Should not throw
      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });
  });

  describe("refreshAllRates", () => {
    /**
     * The pair set is assembled from every user's accounts, securities and default
     * currency, and `exchange_rates` is shared reference data -- so this is global
     * by definition. The system context used to live only in the cron, which left
     * the manual endpoint reading those tables in the requesting user's own scope:
     * identical to global at RLS_MODE=off, silently narrowed to the caller's own
     * currencies at enforce. A maintenance operation whose reach depends on which
     * caller reached it is the trap.
     */
    it("runs under a system context regardless of the caller", async () => {
      dataSource.query.mockResolvedValue([{ code: "USD" }]);
      let ctx: ReturnType<typeof getRequestContext>;
      dataSource.query.mockImplementation(() => {
        ctx = getRequestContext();
        return Promise.resolve([{ code: "USD" }]);
      });

      await requestContextStorage.run({ userId: "user-1" }, () =>
        service.refreshAllRates(),
      );

      expect(ctx).toMatchObject({ system: true });
      expect(ctx).not.toHaveProperty("userId");
    });

    it("returns empty summary when fewer than 2 currencies are in use", async () => {
      dataSource.query.mockResolvedValue([{ code: "USD" }]);

      const result = await service.refreshAllRates();

      expect(result.totalPairs).toBe(0);
      expect(result.updated).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.results).toEqual([]);
    });

    it("returns empty summary when no currencies are in use", async () => {
      dataSource.query.mockResolvedValue([]);

      const result = await service.refreshAllRates();

      expect(result.totalPairs).toBe(0);
      expect(result.updated).toBe(0);
    });

    it("builds correct pairs from 3 currencies and fetches rates", async () => {
      dataSource.query.mockResolvedValue([
        { code: "USD" },
        { code: "CAD" },
        { code: "EUR" },
      ]);

      routeRateQueries(["USD", "CAD", "EUR"]);
      yahooFinanceService.fetchQuote.mockResolvedValue({
        regularMarketPrice: 1.365,
      });

      const result = await service.refreshAllRates();

      // 3 currencies -> 3 pairs: USD/CAD, USD/EUR, CAD/EUR
      expect(result.totalPairs).toBe(3);
      expect(result.updated).toBe(3);
      expect(result.failed).toBe(0);
      expect(result.results).toHaveLength(3);
      expect(yahooFinanceService.fetchQuote).toHaveBeenCalledTimes(3);
    });

    it("handles failed Yahoo API calls gracefully", async () => {
      dataSource.query.mockResolvedValue([{ code: "USD" }, { code: "CAD" }]);

      // fetchQuote returns null when Yahoo API fails
      yahooFinanceService.fetchQuote.mockResolvedValue(null);

      const result = await service.refreshAllRates();

      expect(result.totalPairs).toBe(1);
      expect(result.updated).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.results[0].success).toBe(false);
      expect(result.results[0].error).toBe("No rate data available");
    });

    it("handles fetch network errors gracefully", async () => {
      dataSource.query.mockResolvedValue([{ code: "USD" }, { code: "CAD" }]);

      // fetchQuote returns null when network error occurs (YahooFinanceService catches internally)
      yahooFinanceService.fetchQuote.mockResolvedValue(null);

      const result = await service.refreshAllRates();

      expect(result.totalPairs).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.updated).toBe(0);
    });

    it("handles missing rate data in Yahoo response", async () => {
      dataSource.query.mockResolvedValue([{ code: "USD" }, { code: "CAD" }]);

      // fetchQuote returns result without regularMarketPrice
      yahooFinanceService.fetchQuote.mockResolvedValue({});

      const result = await service.refreshAllRates();

      expect(result.failed).toBe(1);
      expect(result.updated).toBe(0);
    });

    it("upserts one canonical row rather than reading first and then writing", async () => {
      // The rate cron fires on every replica, so two processes routinely fetch
      // the same pair for the same day. The old shape read the row and then
      // either saved it or inserted -- a check-then-act whose loser hit
      // `UNIQUE(from_currency, to_currency, rate_date)` and reported a pair it
      // had in fact fetched as failed.
      routeRateQueries(["USD", "CAD"]);

      yahooFinanceService.fetchQuote.mockResolvedValue({
        regularMarketPrice: 1.4,
      });

      const result = await service.refreshAllRates();

      expect(result.updated).toBe(1);
      const upserts = dataSource.query.mock.calls.filter(
        (call: unknown[]) =>
          typeof call[0] === "string" &&
          call[0].includes("INSERT INTO exchange_rates") &&
          call[0].includes("RETURNING id"),
      );
      // One row, not a pair. The inverse row that used to be written beside it
      // was what a one-sided write could then contradict (INV-FX-003).
      expect(upserts).toHaveLength(1);
      expect(upserts[0][0]).toContain(
        "ON CONFLICT (from_currency, to_currency, rate_date) DO UPDATE",
      );
      // The fetch asked for USD->CAD; the pair is stored as CAD->USD, so the
      // rate is inverted at the rate column's ten decimal places, not at money
      // precision: rounding it to four (0.7143) inverts back to 1.39997, which a
      // statement quoting six decimals reconciles against by cents.
      expect(upsertedRates).toHaveLength(1);
      expect(upsertedRates[0]).toMatchObject({
        fromCurrency: "CAD",
        toCurrency: "USD",
        rate: roundFxRate(1 / 1.4),
        source: "yahoo_finance",
      });
      expect(upsertedRates[0].rate).not.toBe(0.7143);
      expect(roundFxRate(1 / upsertedRates[0].rate)).toBeCloseTo(1.4, 6);
    });

    it("stores a fetch that is already canonical as it stands", async () => {
      // CAD sorts before USD, so a CAD->USD quote needs no inversion and the
      // stored rate is the fetched number itself.
      routeRateQueries(["CAD", "USD"]);

      yahooFinanceService.fetchQuote.mockResolvedValue({
        regularMarketPrice: 0.72,
      });

      await service.refreshAllRates();

      expect(upsertedRates).toEqual([
        {
          fromCurrency: "CAD",
          toCurrency: "USD",
          rate: 0.72,
          source: "yahoo_finance",
        },
      ]);
    });

    it("handles a rate write failure gracefully", async () => {
      routeRateQueries(["USD", "CAD"]);
      yahooFinanceService.fetchQuote.mockResolvedValue({
        regularMarketPrice: 1.365,
      });
      // The upsert itself fails: one pair is reported failed and the sweep
      // carries on.
      dataSource.query.mockImplementation(async (sql: string) => {
        if (
          typeof sql === "string" &&
          sql.includes("INSERT INTO exchange_rates")
        ) {
          throw new Error("DB write failed");
        }
        if (typeof sql === "string" && sql.includes("SELECT DISTINCT code")) {
          return [{ code: "USD" }, { code: "CAD" }];
        }
        return [];
      });

      const result = await service.refreshAllRates();

      expect(result.failed).toBe(1);
      expect(result.updated).toBe(0);
      expect(result.results[0].success).toBe(false);
      expect(result.results[0].error).toBe("DB write failed");
    });

    it("builds correct number of pairs from 4 currencies", async () => {
      routeRateQueries(["USD", "CAD", "EUR", "GBP"]);
      yahooFinanceService.fetchQuote.mockResolvedValue({
        regularMarketPrice: 1.0,
      });

      const result = await service.refreshAllRates();

      // 4 currencies -> C(4,2) = 6 pairs
      expect(result.totalPairs).toBe(6);
      expect(result.updated).toBe(6);
    });
  });

  describe("backfillHistoricalRates", () => {
    it("uses user default currency from preferences", async () => {
      userPreferenceRepository.findOne.mockResolvedValue({
        userId: "user-1",
        defaultCurrency: "CAD",
      });
      dataSource.query
        .mockResolvedValueOnce([]) // accountCurrencyRows
        .mockResolvedValueOnce([]); // securityCurrencyRows

      const result = await service.backfillHistoricalRates("user-1");

      expect(userPreferenceRepository.findOne).toHaveBeenCalledWith({
        where: { userId: "user-1" },
      });
      expect(result.totalPairs).toBe(0);
      expect(result.successful).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.totalRatesLoaded).toBe(0);
    });

    it("defaults to USD when user has no preference", async () => {
      userPreferenceRepository.findOne.mockResolvedValue(null);
      dataSource.query
        .mockResolvedValueOnce([
          { currency_code: "EUR", earliest: "2025-01-01" },
        ]) // accountCurrencyRows
        .mockResolvedValueOnce([]) // securityCurrencyRows
        .mockResolvedValueOnce([{ count: 5 }]); // existingRates check (already exists, skip)

      const result = await service.backfillHistoricalRates("user-1");

      // Should query for EUR->USD pair (default currency is USD)
      expect(result.totalPairs).toBe(1);
      expect(result.successful).toBe(1);
      expect(result.results[0].pair).toBe("EUR/USD");
      expect(result.results[0].ratesLoaded).toBe(0); // skipped because existing
    });

    it("counts a pair stored in the other direction as already covered", async () => {
      // A pair is stored once. Asking only about `EUR->USD` read a pair held as
      // `USD->EUR` as uncovered and re-fetched it from the provider on every
      // run, forever.
      userPreferenceRepository.findOne.mockResolvedValue(null);
      dataSource.query
        .mockResolvedValueOnce([
          { currency_code: "EUR", earliest: "2025-01-01" },
        ]) // accountCurrencyRows
        .mockResolvedValueOnce([]) // securityCurrencyRows
        .mockResolvedValueOnce([{ count: 5 }]); // the coverage probe

      const result = await service.backfillHistoricalRates("user-1");

      const probe = dataSource.query.mock.calls.find((call: unknown[]) =>
        String(call[0]).includes("COUNT(*)::INT AS count FROM exchange_rates"),
      );
      expect(probe).toBeDefined();
      expect(String(probe[0])).toContain(
        "(from_currency = $1 AND to_currency = $2)",
      );
      expect(String(probe[0])).toContain(
        "(from_currency = $2 AND to_currency = $1)",
      );
      expect(result.results[0].ratesLoaded).toBe(0);
      expect(yahooFinanceService.fetchHistorical).not.toHaveBeenCalled();
    });

    it("returns empty summary when no pairs need backfill", async () => {
      userPreferenceRepository.findOne.mockResolvedValue({
        userId: "user-1",
        defaultCurrency: "USD",
      });
      dataSource.query
        .mockResolvedValueOnce([]) // accountCurrencyRows
        .mockResolvedValueOnce([]); // securityCurrencyRows

      const result = await service.backfillHistoricalRates("user-1");

      expect(result.totalPairs).toBe(0);
      expect(result.results).toEqual([]);
    });

    it("skips rows without earliest dates", async () => {
      userPreferenceRepository.findOne.mockResolvedValue({
        userId: "user-1",
        defaultCurrency: "USD",
      });
      dataSource.query
        .mockResolvedValueOnce([{ currency_code: "EUR", earliest: null }]) // no earliest date
        .mockResolvedValueOnce([]); // securityCurrencyRows

      const result = await service.backfillHistoricalRates("user-1");

      expect(result.totalPairs).toBe(0);
    });

    it("skips pair when existing rates already exist in DB", async () => {
      userPreferenceRepository.findOne.mockResolvedValue({
        userId: "user-1",
        defaultCurrency: "USD",
      });
      dataSource.query
        .mockResolvedValueOnce([
          { currency_code: "CAD", earliest: "2025-01-01" },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: 100 }]); // existing rates count > 0

      const result = await service.backfillHistoricalRates("user-1");

      expect(result.totalPairs).toBe(1);
      expect(result.successful).toBe(1);
      expect(result.results[0].ratesLoaded).toBe(0);
    });

    it("fetches and stores historical rates from Yahoo Finance", async () => {
      userPreferenceRepository.findOne.mockResolvedValue({
        userId: "user-1",
        defaultCurrency: "USD",
      });

      dataSource.query
        .mockResolvedValueOnce([
          { currency_code: "CAD", earliest: "2025-06-01" },
        ])
        .mockResolvedValueOnce([]) // securityCurrencyRows
        .mockResolvedValueOnce([{ count: 0 }]) // no existing rates
        .mockResolvedValueOnce(undefined); // bulk upsert INSERT

      yahooFinanceService.fetchHistorical.mockResolvedValue([
        {
          date: new Date("2025-06-01"),
          open: null,
          high: null,
          low: null,
          close: 1.365,
          volume: null,
        },
        {
          date: new Date("2025-06-02"),
          open: null,
          high: null,
          low: null,
          close: 1.37,
          volume: null,
        },
      ]);

      const result = await service.backfillHistoricalRates("user-1");

      expect(result.totalPairs).toBe(1);
      expect(result.successful).toBe(1);
      expect(result.totalRatesLoaded).toBe(2);
      expect(result.results[0].pair).toBe("CAD/USD");
      expect(result.results[0].ratesLoaded).toBe(2);
    });

    it("filters historical rates by cutoff date", async () => {
      userPreferenceRepository.findOne.mockResolvedValue({
        userId: "user-1",
        defaultCurrency: "USD",
      });

      dataSource.query
        .mockResolvedValueOnce([
          { currency_code: "EUR", earliest: "2025-06-15" },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: 0 }])
        .mockResolvedValueOnce(undefined); // bulk upsert

      yahooFinanceService.fetchHistorical.mockResolvedValue([
        {
          date: new Date("2025-06-01"),
          open: null,
          high: null,
          low: null,
          close: 1.1,
          volume: null,
        }, // before cutoff
        {
          date: new Date("2025-06-15"),
          open: null,
          high: null,
          low: null,
          close: 1.2,
          volume: null,
        }, // on cutoff
        {
          date: new Date("2025-06-20"),
          open: null,
          high: null,
          low: null,
          close: 1.3,
          volume: null,
        }, // after cutoff
      ]);

      const result = await service.backfillHistoricalRates("user-1");

      expect(result.successful).toBe(1);
      // Only ts2 and ts3 should pass the filter (>= cutoff)
      expect(result.results[0].ratesLoaded).toBe(2);
    });

    it("deduplicates rates with the same date", async () => {
      userPreferenceRepository.findOne.mockResolvedValue({
        userId: "user-1",
        defaultCurrency: "USD",
      });

      // YahooFinanceService already normalizes dates to midnight, so two entries with same date
      const date1 = new Date("2025-07-01");
      date1.setHours(0, 0, 0, 0);
      const date2 = new Date("2025-07-01");
      date2.setHours(0, 0, 0, 0);
      const date3 = new Date("2025-07-02");
      date3.setHours(0, 0, 0, 0);

      dataSource.query
        .mockResolvedValueOnce([
          { currency_code: "GBP", earliest: "2025-07-01" },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: 0 }])
        .mockResolvedValueOnce(undefined); // bulk upsert

      yahooFinanceService.fetchHistorical.mockResolvedValue([
        {
          date: date1,
          open: null,
          high: null,
          low: null,
          close: 1.25,
          volume: null,
        },
        {
          date: date2,
          open: null,
          high: null,
          low: null,
          close: 1.26,
          volume: null,
        },
        {
          date: date3,
          open: null,
          high: null,
          low: null,
          close: 1.27,
          volume: null,
        },
      ]);

      const result = await service.backfillHistoricalRates("user-1");

      // date1 and date2 are the same date, so one is deduped
      expect(result.results[0].ratesLoaded).toBe(2);
    });

    it("handles null/NaN close values in Yahoo response", async () => {
      userPreferenceRepository.findOne.mockResolvedValue({
        userId: "user-1",
        defaultCurrency: "USD",
      });

      dataSource.query
        .mockResolvedValueOnce([
          { currency_code: "JPY", earliest: "2025-08-01" },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: 0 }])
        .mockResolvedValueOnce(undefined); // bulk upsert

      // YahooFinanceService.fetchHistorical already filters null/NaN, so only valid entries returned
      yahooFinanceService.fetchHistorical.mockResolvedValue([
        {
          date: new Date("2025-08-03"),
          open: null,
          high: null,
          low: null,
          close: 150.5,
          volume: null,
        },
      ]);

      const result = await service.backfillHistoricalRates("user-1");

      // Only the rate with value 150.5 should be included
      expect(result.results[0].ratesLoaded).toBe(1);
    });

    it("handles Yahoo API failure for historical rates", async () => {
      userPreferenceRepository.findOne.mockResolvedValue({
        userId: "user-1",
        defaultCurrency: "USD",
      });

      dataSource.query
        .mockResolvedValueOnce([
          { currency_code: "CAD", earliest: "2025-01-01" },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: 0 }]);

      // YahooFinanceService returns null on API failure
      yahooFinanceService.fetchHistorical.mockResolvedValue(null);

      const result = await service.backfillHistoricalRates("user-1");

      expect(result.totalPairs).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.successful).toBe(0);
      expect(result.results[0].error).toBe("No historical data available");
    });

    it("handles fetch network error for historical rates", async () => {
      userPreferenceRepository.findOne.mockResolvedValue({
        userId: "user-1",
        defaultCurrency: "USD",
      });

      dataSource.query
        .mockResolvedValueOnce([
          { currency_code: "CAD", earliest: "2025-01-01" },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: 0 }]);

      // YahooFinanceService returns null on network error
      yahooFinanceService.fetchHistorical.mockResolvedValue(null);

      const result = await service.backfillHistoricalRates("user-1");

      expect(result.failed).toBe(1);
      expect(result.results[0].error).toBe("No historical data available");
    });

    it("handles database error during bulk upsert", async () => {
      userPreferenceRepository.findOne.mockResolvedValue({
        userId: "user-1",
        defaultCurrency: "USD",
      });

      dataSource.query
        .mockResolvedValueOnce([
          { currency_code: "CHF", earliest: "2025-09-01" },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: 0 }])
        .mockRejectedValueOnce(new Error("Constraint violation"));

      yahooFinanceService.fetchHistorical.mockResolvedValue([
        {
          date: new Date("2025-09-01"),
          open: null,
          high: null,
          low: null,
          close: 0.92,
          volume: null,
        },
      ]);

      const result = await service.backfillHistoricalRates("user-1");

      expect(result.failed).toBe(1);
      expect(result.results[0].success).toBe(false);
      expect(result.results[0].error).toBe("Constraint violation");
    });

    it("passes accountIds filter when provided", async () => {
      userPreferenceRepository.findOne.mockResolvedValue({
        userId: "user-1",
        defaultCurrency: "USD",
      });
      dataSource.query
        .mockResolvedValueOnce([]) // accountCurrencyRows
        .mockResolvedValueOnce([]); // securityCurrencyRows

      await service.backfillHistoricalRates("user-1", ["acc-1", "acc-2"]);

      // The first query should include the accountIds parameter
      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining("AND a.id = ANY($2::UUID[])"),
        ["USD", ["acc-1", "acc-2"]],
      );
    });

    it("returns success with 0 ratesLoaded when all filtered rates are before cutoff", async () => {
      userPreferenceRepository.findOne.mockResolvedValue({
        userId: "user-1",
        defaultCurrency: "USD",
      });

      dataSource.query
        .mockResolvedValueOnce([
          { currency_code: "MXN", earliest: "2026-01-01" },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: 0 }]);

      // Earliest transaction is 2026-01-01, but rates are all from 2025
      yahooFinanceService.fetchHistorical.mockResolvedValue([
        {
          date: new Date("2025-01-01"),
          open: null,
          high: null,
          low: null,
          close: 17.0,
          volume: null,
        },
        {
          date: new Date("2025-06-01"),
          open: null,
          high: null,
          low: null,
          close: 17.5,
          volume: null,
        },
      ]);

      const result = await service.backfillHistoricalRates("user-1");

      expect(result.successful).toBe(1);
      expect(result.results[0].ratesLoaded).toBe(0);
    });

    it("merges security and account currency rows picking the earliest date", async () => {
      userPreferenceRepository.findOne.mockResolvedValue({
        userId: "user-1",
        defaultCurrency: "USD",
      });

      // Same currency from both account and security, different earliest dates
      dataSource.query
        .mockResolvedValueOnce([
          { currency_code: "EUR", earliest: "2025-06-01" },
        ]) // account
        .mockResolvedValueOnce([
          { currency_code: "EUR", earliest: "2025-03-01" },
        ]) // security (earlier)
        .mockResolvedValueOnce([{ count: 5 }]); // existing rates

      const result = await service.backfillHistoricalRates("user-1");

      // Should only have 1 pair (EUR->USD) not 2
      expect(result.totalPairs).toBe(1);
    });

    it("handles missing timestamp or indicators in Yahoo response", async () => {
      userPreferenceRepository.findOne.mockResolvedValue({
        userId: "user-1",
        defaultCurrency: "USD",
      });

      dataSource.query
        .mockResolvedValueOnce([
          { currency_code: "SEK", earliest: "2025-01-01" },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: 0 }]);

      // YahooFinanceService returns null when response has no timestamp/indicators
      yahooFinanceService.fetchHistorical.mockResolvedValue(null);

      const result = await service.backfillHistoricalRates("user-1");

      expect(result.failed).toBe(1);
      expect(result.results[0].error).toBe("No historical data available");
    });
  });

  /**
   * A stored row, dated: the age policy means a fixture's date is part of what
   * it asserts, not scenery.
   */
  const storedRow = (
    from: string,
    to: string,
    rate: number,
    date: string,
  ): ExchangeRate => ({
    ...mockExchangeRate,
    fromCurrency: from,
    toCurrency: to,
    rate,
    // `main.ts` sets the pg DATE parser to hand the literal back unparsed, so a
    // row that crossed the driver carries the `YYYY-MM-DD` string. The entity
    // declares `Date` for the SQL column type; the fixture is the shape
    // production actually produces, because a fixture the producer could not
    // have written is not evidence.
    rateDate: date as unknown as Date,
  });

  /** The [floor, ceiling] the span query asked the database for. */
  const spanBounds = (call: any): [string, string] => {
    const operator = call.where[0].rateDate;
    const [lower, upper] = operator.value as Array<{ value: unknown }>;
    return [String(lower.value), String(upper.value)];
  };

  describe("resolveStoredRate", () => {
    /**
     * Issue #1390. The span used to be built from UTC-midnight `Date` objects.
     * TypeORM does not normalise a select-side parameter, `pg` renders a `Date`
     * in the process time zone and PostgreSQL's cast to `date` keeps whatever
     * literal that rendering produced, so anywhere west of UTC the upper bound
     * named the previous calendar day and the reference date's own row -- in
     * `live` mode, today's rate -- was excluded from the result. The bounds are
     * calendar-date strings, which name the same day in every time zone.
     */
    it("bounds the span with calendar-date strings on both sides", async () => {
      exchangeRateRepository.find.mockResolvedValue([]);

      await service.resolveStoredRate("USD", "CAD", "2026-06-08");

      const call = exchangeRateRepository.find.mock.calls[0][0];
      const [lower, upper] = (call.where[0].rateDate as any).value as Array<{
        value: unknown;
      }>;
      expect(typeof lower.value).toBe("string");
      expect(typeof upper.value).toBe("string");
      expect(upper.value).toBe("2026-06-08");
      expect(lower.value).toBe("2026-04-24"); // the 45-day age bound
      // Both stored directions are read over the one span.
      expect(call.where[1].rateDate).toBe(call.where[0].rateDate);
    });

    /**
     * `onDate` reaches here from a query parameter, and Express parses a
     * repeated key into an array, so a value declared `string` need not be one.
     * The span was built by slicing it: an array sliced to an array, the
     * comparison that clamps a future date became a text coercion, and the
     * query ran over bounds nobody named (CodeQL
     * `js/type-confusion-through-parameter-tampering`).
     */
    it("refuses a date that names no day instead of querying a coerced span", async () => {
      for (const tampered of [
        ["2026-06-08"] as unknown as string,
        ["2026-06-08", "2026-06-09"] as unknown as string,
        "08/06/2026",
      ]) {
        const resolution = await service.resolveStoredRate(
          "USD",
          "CAD",
          tampered,
        );

        expect(resolution).toMatchObject({
          status: "unknown",
          rate: null,
          reason: "invalid_date",
        });
      }
      expect(exchangeRateRepository.find).not.toHaveBeenCalled();
    });

    it("bounds a live lookup at today, so today's own row is inside the span", async () => {
      // Today is the suite's fixture date (`todayYMD` is mocked above).
      exchangeRateRepository.find.mockResolvedValue([
        storedRow("USD", "CAD", 1.42, "2026-08-18"),
      ]);

      const resolution = await service.resolveStoredRate(
        "USD",
        "CAD",
        "2026-06-08",
        { mode: "live" },
      );

      const [floor, ceiling] = spanBounds(
        exchangeRateRepository.find.mock.calls[0][0],
      );
      expect(ceiling).toBe("2026-08-18");
      expect(floor).toBe("2026-07-04"); // today minus the 45-day bound
      expect(resolution.rate).toBe(1.42);
      expect(resolution.observedOn).toBe("2026-08-18");
    });

    /**
     * The entity declares `rateDate: Date` and only the pg DATE parser makes it
     * a string, so the normalisation keeps a `Date` readable for any caller
     * that builds a row without the driver. One case, deliberately: every other
     * fixture carries the string production produces.
     */
    it("normalises a Date-valued rateDate as well as the stored string", async () => {
      exchangeRateRepository.find.mockResolvedValue([
        {
          ...mockExchangeRate,
          fromCurrency: "USD",
          toCurrency: "CAD",
          rate: 1.31,
          rateDate: new Date("2026-06-05T00:00:00.000Z"),
        },
      ]);

      const resolution = await service.resolveStoredRate(
        "USD",
        "CAD",
        "2026-06-08",
      );

      expect(resolution.rate).toBe(1.31);
      expect(resolution.observedOn).toBe("2026-06-05");
    });
  });

  describe("getRateForDate", () => {
    it("returns 1 for the same currency without any lookup", async () => {
      const result = await service.getRateForDate("USD", "USD", "2026-06-08");

      expect(result).toBe(1);
      expect(exchangeRateRepository.find).not.toHaveBeenCalled();
      expect(yahooFinanceService.fetchHistoricalWindow).not.toHaveBeenCalled();
    });

    it("returns the closest stored rate on or before the target date", async () => {
      exchangeRateRepository.find.mockResolvedValue([
        storedRow("USD", "CAD", 1.3, "2026-06-01"),
        storedRow("USD", "CAD", 1.365, "2026-06-05"),
      ]);

      const result = await service.getRateForDate("USD", "CAD", "2026-06-08");

      expect(result).toBe(1.365);
      // Both stored directions are read, over a bounded span -- not a single
      // unbounded "any earlier row" lookup.
      const call = exchangeRateRepository.find.mock.calls[0][0];
      expect(call.where).toHaveLength(2);
      expect(call.where[0].fromCurrency).toBe("USD");
      expect(call.where[1].fromCurrency).toBe("CAD");
      // No provider fetch needed when the span covers the target.
      expect(yahooFinanceService.fetchHistoricalWindow).not.toHaveBeenCalled();
    });

    /**
     * Issue #1390. The stored step used to be "the newest row on or before the
     * target, whatever its age", so a single row from 2019 answered every later
     * date AND short-circuited the provider fetch that would have filled the
     * gap. A 285-day hole therefore stayed a hole, silently back-filled.
     */
    it("reads only the span the age policy admits, so an ancient row neither answers nor blocks the fetch", async () => {
      exchangeRateRepository.find.mockResolvedValue([]);
      yahooFinanceService.fetchHistoricalWindow.mockResolvedValue([
        {
          date: new Date("2026-06-05"),
          close: 1.4,
          open: null,
          high: null,
          low: null,
          volume: null,
        },
      ]);

      const result = await service.getRateForDate("USD", "CAD", "2026-06-08");

      expect(result).toBe(1.4);
      expect(yahooFinanceService.fetchHistoricalWindow).toHaveBeenCalledTimes(
        1,
      );
      const [floor, ceiling] = spanBounds(
        exchangeRateRepository.find.mock.calls[0][0],
      );
      expect(floor).toBe("2026-04-24"); // 2026-06-08 minus the 45-day bound
      expect(ceiling).toBe("2026-06-08");
    });

    it("uses a fresh inverse observation over an older direct one", async () => {
      exchangeRateRepository.find.mockResolvedValue([
        storedRow("USD", "CAD", 1.3, "2026-05-20"),
        storedRow("CAD", "USD", 0.8, "2026-06-05"),
      ]);

      const result = await service.getRateForDate("USD", "CAD", "2026-06-08");

      expect(result).toBe(1.25);
      expect(yahooFinanceService.fetchHistoricalWindow).not.toHaveBeenCalled();
    });

    it("fetches a bounded Yahoo window around the date when none is stored", async () => {
      exchangeRateRepository.find.mockResolvedValue([]);
      exchangeRateRepository.save.mockImplementation((data) => data);
      // Daily series straddling the target 2026-06-08 (a weekend in this set):
      // the closest day on or before is 2026-06-05.
      yahooFinanceService.fetchHistoricalWindow.mockResolvedValue([
        {
          date: new Date("2026-06-05"),
          close: 4.25,
          open: null,
          high: null,
          low: null,
          volume: null,
        },
        {
          date: new Date("2026-06-09"),
          close: 4.3,
          open: null,
          high: null,
          low: null,
          volume: null,
        },
      ]);

      const result = await service.getRateForDate("EUR", "PLN", "2026-06-08");

      expect(result).toBe(4.25);
      // A bounded window is fetched (not the full "max" history).
      expect(yahooFinanceService.fetchHistorical).not.toHaveBeenCalled();
      expect(yahooFinanceService.fetchHistoricalWindow).toHaveBeenCalledTimes(
        1,
      );
      const [sym, , fromDate, toDate] =
        yahooFinanceService.fetchHistoricalWindow.mock.calls[0];
      expect(sym).toBe("EURPLN=X");
      // Window brackets the target date, and is wide enough to be worth
      // storing: one call has to cover a run of nearby dates or a user
      // stepping the date field hits the provider's rate limit.
      const target = new Date("2026-06-08T00:00:00.000Z").getTime();
      expect((fromDate as Date).getTime()).toBeLessThan(
        target - 30 * 86_400_000,
      );
      expect((toDate as Date).getTime()).toBeGreaterThanOrEqual(target);
    });

    it("stores every day in the fetched window, not just the day asked for", async () => {
      exchangeRateRepository.find.mockResolvedValue([]);
      yahooFinanceService.fetchHistoricalWindow.mockResolvedValue([
        {
          date: new Date("2026-06-05"),
          close: 4.25,
          open: null,
          high: null,
          low: null,
          volume: null,
        },
        {
          date: new Date("2026-06-09"),
          close: 4.3,
          open: null,
          high: null,
          low: null,
          volume: null,
        },
      ]);

      await service.getRateForDate("EUR", "PLN", "2026-06-08");

      // One bulk upsert carrying both days. Keeping only the chosen point sent
      // the next lookup for a neighbouring date straight back out to the
      // provider, which is what ran into its rate limits.
      const insert = dataSource.query.mock.calls.find((call: any[]) =>
        String(call[0]).includes("INSERT INTO exchange_rates"),
      );
      expect(insert).toBeDefined();
      const params = insert[1] as unknown[];
      expect(params).toHaveLength(2 * 4); // 2 days x 4 columns, one row each

      // Read the flat parameter list back as (from, to, date, rate) rows.
      const rows: Array<[string, string, Date, number]> = [];
      for (let i = 0; i < params.length; i += 4) {
        rows.push(params.slice(i, i + 4) as [string, string, Date, number]);
      }
      const rowFor = (from: string, to: string, day: string) =>
        rows.find(
          (r) =>
            r[0] === from &&
            r[1] === to &&
            r[2].toISOString().slice(0, 10) === day,
        );

      // EUR sorts before PLN, so the fetched orientation is the stored one.
      expect(rowFor("EUR", "PLN", "2026-06-05")?.[3]).toBe(4.25);
      expect(rowFor("EUR", "PLN", "2026-06-09")?.[3]).toBe(4.3);
      // And the inverse rows are gone: a PLN->EUR lookup is still a database
      // read, resolved from these rows by `resolveFxRate`.
      expect(rowFor("PLN", "EUR", "2026-06-05")).toBeUndefined();
      expect(rowFor("PLN", "EUR", "2026-06-09")).toBeUndefined();
    });

    it("returns null when neither a stored rate nor a Yahoo window is available", async () => {
      exchangeRateRepository.find.mockResolvedValue([]);
      yahooFinanceService.fetchHistoricalWindow.mockResolvedValue(null);

      const result = await service.getRateForDate("EUR", "PLN", "2026-06-08");

      expect(result).toBeNull();
    });

    it("stays inside the database when the caller asks it to", async () => {
      exchangeRateRepository.find.mockResolvedValue([]);

      const result = await service.getRateForDate("EUR", "PLN", "2026-06-08", {
        fetchMissing: false,
      });

      expect(result).toBeNull();
      expect(yahooFinanceService.fetchHistoricalWindow).not.toHaveBeenCalled();
    });

    it("clamps a future date to today rather than hunting for a rate that cannot exist", async () => {
      // `todayYMD` is pinned to 2026-08-18 at the top of this file.
      const today = "2026-08-18";
      exchangeRateRepository.find.mockResolvedValue([
        storedRow("USD", "CAD", 1.365, today),
      ]);

      // A scheduled transaction posted ahead of time: there is no rate for its
      // due date and there never will be until the day arrives, so today's is
      // the answer -- the same figure the bills list is already showing.
      const result = await service.getRateForDate("USD", "CAD", "2099-01-01");

      expect(result).toBe(1.365);
      const [, ceiling] = spanBounds(
        exchangeRateRepository.find.mock.calls[0][0],
      );
      expect(ceiling).toBe(today);
      // No historical window: a future window contains nothing to choose from.
      expect(yahooFinanceService.fetchHistoricalWindow).not.toHaveBeenCalled();
    });

    it("carries the last trading day forward across a weekend", async () => {
      // 2026-06-06 is a Saturday; 2026-06-05 the Friday before it.
      exchangeRateRepository.find.mockResolvedValue([
        storedRow("USD", "CAD", 1.365, "2026-06-05"),
      ]);

      const result = await service.getRateForDate("USD", "CAD", "2026-06-06");

      expect(result).toBe(1.365);
      expect(yahooFinanceService.fetchHistoricalWindow).not.toHaveBeenCalled();
    });

    /**
     * Was: "takes the nearest day either side when the target predates the
     * window". A bar struck after the target is not evidence about the target
     * (issue #1390); the window answers nothing and the caller learns so.
     */
    it("refuses a fetched window whose every bar is dated after the target", async () => {
      exchangeRateRepository.find.mockResolvedValue([]);
      exchangeRateRepository.save.mockImplementation((data) => data);
      yahooFinanceService.fetchHistoricalWindow.mockResolvedValue([
        {
          date: new Date("2026-06-20"),
          close: 4.4,
          open: null,
          high: null,
          low: null,
          volume: null,
        },
        {
          date: new Date("2026-06-10"),
          close: 4.3,
          open: null,
          high: null,
          low: null,
          volume: null,
        },
      ]);

      const result = await service.getRateForDate("EUR", "PLN", "2026-06-08");

      expect(result).toBeNull();
      // The bars are still persisted: a neighbouring date they DO cover is
      // then a database read rather than a second provider call.
      const insert = dataSource.query.mock.calls.find((call: any[]) =>
        String(call[0]).includes("INSERT INTO exchange_rates"),
      );
      expect(insert).toBeDefined();
    });

    /**
     * Was: "falls back to the latest stored rate of any date when the provider
     * has nothing". An arbitrarily old rate does not describe the date being
     * asked about (`docs/time-series-contract.md` section 2.2), and reporting
     * it as that date's rate is the second half of issue #1390.
     */
    it("is null, not a rate from years away, when nothing covers the date", async () => {
      exchangeRateRepository.find.mockResolvedValue([]);
      yahooFinanceService.fetchHistoricalWindow.mockResolvedValue(null);

      const result = await service.getRateForDate("USD", "CAD", "2019-01-01");

      expect(result).toBeNull();
    });
  });

  describe("convertOnDate", () => {
    it("is 1:1 for the same currency without any lookup", async () => {
      const result = await service.convertOnDate(
        250,
        "usd",
        "USD",
        "2026-06-08",
      );

      expect(result).toEqual({
        amount: 250,
        fromCurrency: "USD",
        toCurrency: "USD",
        date: "2026-06-08",
        rate: 1,
        convertedAmount: 250,
      });
      expect(exchangeRateRepository.find).not.toHaveBeenCalled();
    });

    it("applies the stored rate on or before the date and reports that date", async () => {
      exchangeRateRepository.find.mockResolvedValue([
        storedRow("USD", "CAD", 1.365, "2026-06-05"),
      ]);

      const result = await service.convertOnDate(
        100,
        "USD",
        "CAD",
        "2026-06-08",
      );

      expect(result).toEqual({
        amount: 100,
        fromCurrency: "USD",
        toCurrency: "CAD",
        date: "2026-06-08",
        rate: 1.365,
        convertedAmount: 136.5,
      });
      const call = exchangeRateRepository.find.mock.calls[0][0];
      expect(call.where[0].fromCurrency).toBe("USD");
      expect(call.where[0].toCurrency).toBe("CAD");
    });

    it("defaults the date to today and clamps a future date to today", async () => {
      exchangeRateRepository.find.mockResolvedValue([
        storedRow("USD", "CAD", 1.365, "2026-08-18"),
      ]);

      const defaulted = await service.convertOnDate(1, "USD", "CAD");
      const future = await service.convertOnDate(1, "USD", "CAD", "2099-01-01");

      // `todayYMD` is pinned to 2026-08-18 at the top of this file.
      expect(defaulted?.date).toBe("2026-08-18");
      expect(future?.date).toBe("2026-08-18");
    });

    it("rounds the converted amount to money precision, never the rate", async () => {
      exchangeRateRepository.find.mockResolvedValue([
        storedRow("USD", "CAD", 0.7325312345, "2026-06-05"),
      ]);

      const result = await service.convertOnDate(
        1234.56,
        "USD",
        "CAD",
        "2026-06-08",
      );

      expect(result?.rate).toBe(0.7325312345);
      expect(result?.convertedAmount).toBe(904.3538);
    });

    it("reciprocates a rate stored only in the reverse direction", async () => {
      exchangeRateRepository.find.mockResolvedValue([
        storedRow("CAD", "USD", 1.365, "2026-06-05"),
      ]);
      yahooFinanceService.fetchHistoricalWindow.mockResolvedValue(null);

      // Only CAD->USD is stored (at 1.365); USD->CAD is derived from it.
      const result = await service.convertOnDate(
        136.5,
        "USD",
        "CAD",
        "2026-06-08",
      );

      expect(result?.rate).toBe(roundFxRate(1 / 1.365));
      expect(result?.convertedAmount).toBe(100);
      // One trip to the store. The second lookup this used to make -- the pair
      // reversed, the answer reciprocated -- could never add anything, because
      // the ladder it calls already reads both stored directions.
      expect(exchangeRateRepository.find).toHaveBeenCalledTimes(1);
    });

    it("returns null -- never 1, never the input -- when no rate exists either way", async () => {
      exchangeRateRepository.find.mockResolvedValue([]);
      yahooFinanceService.fetchHistoricalWindow.mockResolvedValue(null);

      const result = await service.convertOnDate(
        100,
        "USD",
        "XXX",
        "2026-06-08",
      );

      expect(result).toBeNull();
    });

    it("treats a zero or negative stored rate as absent", async () => {
      exchangeRateRepository.find.mockResolvedValue([
        storedRow("USD", "CAD", 0, "2026-06-05"),
      ]);
      yahooFinanceService.fetchHistoricalWindow.mockResolvedValue(null);

      const result = await service.convertOnDate(
        100,
        "USD",
        "CAD",
        "2026-06-08",
      );

      expect(result).toBeNull();
    });
  });

  describe("getLatestRates", () => {
    it("returns latest rates using distinctOn query", async () => {
      const rates = [mockExchangeRate];
      const qb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue(rates),
      });
      exchangeRateRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getLatestRates();

      expect(result).toEqual(rates);
      expect(exchangeRateRepository.createQueryBuilder).toHaveBeenCalledWith(
        "er",
      );
      expect(qb.distinctOn).toHaveBeenCalledWith([
        "er.from_currency",
        "er.to_currency",
      ]);
      expect(qb.orderBy).toHaveBeenCalledWith("er.from_currency");
      expect(qb.addOrderBy).toHaveBeenCalledWith("er.to_currency");
      expect(qb.addOrderBy).toHaveBeenCalledWith("er.rate_date", "DESC");
    });

    it("returns empty array when no rates exist", async () => {
      const qb = createMockQueryBuilder({
        getMany: jest.fn().mockResolvedValue([]),
      });
      exchangeRateRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getLatestRates();

      expect(result).toEqual([]);
    });
  });

  describe("getLatestRate", () => {
    /**
     * The truth table in `docs/specs/exchange-rate-canonical-orientation.md`
     * section 4. A pair is stored in one orientation, so "the latest rate" has to
     * be answered from whichever direction holds it -- this used to read
     * `from->to` alone and returned null for a pair held the other way.
     */
    const row = (
      fromCurrency: string,
      toCurrency: string,
      rate: number | string,
      rateDate: Date | string,
    ): ExchangeRate =>
      ({
        ...mockExchangeRate,
        fromCurrency,
        toCurrency,
        rate,
        rateDate,
      }) as unknown as ExchangeRate;

    /** Answer each direction's newest-row query from what the store holds. */
    const store = (rows: ExchangeRate[]): void => {
      exchangeRateRepository.findOne.mockImplementation(
        async (options: {
          where: { fromCurrency: string; toCurrency: string };
        }) =>
          rows.find(
            (r) =>
              r.fromCurrency === options.where.fromCurrency &&
              r.toCurrency === options.where.toCurrency,
          ) ?? null,
      );
    };

    const today = todayYMD();

    it("returns 1 when from and to are the same currency", async () => {
      const result = await service.getLatestRate("USD", "USD");

      expect(result).toBe(1);
      expect(exchangeRateRepository.findOne).not.toHaveBeenCalled();
    });

    it("returns the rate when the pair is stored in the direction asked for", async () => {
      store([row("USD", "CAD", 1.365, new Date("2026-02-10"))]);

      const result = await service.getLatestRate("USD", "CAD");

      expect(result).toBe(1.365);
      // Both directions are read; the resolver decides between them.
      expect(exchangeRateRepository.findOne).toHaveBeenCalledWith({
        where: { fromCurrency: "USD", toCurrency: "CAD" },
        order: { rateDate: "DESC" },
      });
      expect(exchangeRateRepository.findOne).toHaveBeenCalledWith({
        where: { fromCurrency: "CAD", toCurrency: "USD" },
        order: { rateDate: "DESC" },
      });
    });

    it("inverts the stored row when the pair is held the other way", async () => {
      // The case that used to come back null. CAD sorts first, so this is the
      // orientation the collapse stores.
      store([row("CAD", "USD", 0.7326, new Date("2026-02-10"))]);

      const result = await service.getLatestRate("USD", "CAD");

      expect(result).toBeCloseTo(1 / 0.7326, 9);
    });

    it("returns null when neither direction is stored", async () => {
      store([]);

      expect(await service.getLatestRate("USD", "XYZ")).toBeNull();
    });

    it("prefers the more recently observed direction", async () => {
      store([
        row("USD", "CAD", 1.3, addDaysYMD(today, -10)),
        row("CAD", "USD", 0.5, addDaysYMD(today, -1)),
      ]);

      // The fresher inverse row wins over the older direct one.
      expect(await service.getLatestRate("USD", "CAD")).toBeCloseTo(2, 9);
    });

    it("gives a tie to the direction asked for, so the answer is deterministic", async () => {
      store([
        row("USD", "CAD", 1.3, addDaysYMD(today, -2)),
        row("CAD", "USD", 0.5, addDaysYMD(today, -2)),
      ]);

      expect(await service.getLatestRate("USD", "CAD")).toBe(1.3);
    });

    it("applies an age bound to both directions", async () => {
      store([
        row("USD", "CAD", 1.3, addDaysYMD(today, -200)),
        row("CAD", "USD", 0.5, addDaysYMD(today, -200)),
      ]);

      // A rate is a price: past the bound the answer is unknown, not the last
      // one on file, whichever direction that one is stored in.
      expect(await service.getLatestRate("USD", "CAD", 30)).toBeNull();
      const [call] = exchangeRateRepository.findOne.mock.calls;
      expect(call[0].where.rateDate).toBeDefined();
    });

    it("answers from an admissible direction when the other is stale", async () => {
      store([
        row("USD", "CAD", 1.3, addDaysYMD(today, -200)),
        row("CAD", "USD", 0.5, addDaysYMD(today, -3)),
      ]);

      expect(await service.getLatestRate("USD", "CAD", 30)).toBeCloseTo(2, 9);
    });

    it("treats a non-positive stored rate as absent", async () => {
      store([row("USD", "CAD", 0, new Date("2026-02-10"))]);

      expect(await service.getLatestRate("USD", "CAD")).toBeNull();
    });

    it("converts a decimal string from the driver to a number", async () => {
      // The `pg` DATE parser hands the date back as a literal string and numerics
      // arrive as strings too, so this is the shape the real repository returns.
      store([row("USD", "CAD", "1.3650000000", "2026-02-10")]);

      const result = await service.getLatestRate("USD", "CAD");

      expect(result).toBe(1.365);
      expect(typeof result).toBe("number");
    });
  });

  describe("getLiveRate", () => {
    it("returns 1 when from and to are the same currency", async () => {
      const result = await service.getLiveRate("USD", "USD");

      expect(result).toBe(1);
      expect(yahooFinanceService.fetchQuote).not.toHaveBeenCalled();
      expect(exchangeRateRepository.findOne).not.toHaveBeenCalled();
    });

    it("returns the live direct quote when available", async () => {
      yahooFinanceService.fetchQuote.mockResolvedValue({
        regularMarketPrice: 1.372,
      });

      const result = await service.getLiveRate("USD", "CAD");

      expect(result).toBe(1.372);
      expect(yahooFinanceService.fetchQuote).toHaveBeenCalledWith("USDCAD=X");
      // Does not touch the stored daily snapshot when a live quote exists
      expect(exchangeRateRepository.findOne).not.toHaveBeenCalled();
    });

    it("inverts the reverse live quote when the direct pair is unavailable", async () => {
      yahooFinanceService.fetchQuote
        .mockResolvedValueOnce({ regularMarketPrice: null }) // direct USDCAD=X
        .mockResolvedValueOnce({ regularMarketPrice: 0.5 }); // reverse CADUSD=X

      const result = await service.getLiveRate("USD", "CAD");

      expect(result).toBe(2);
      expect(yahooFinanceService.fetchQuote).toHaveBeenNthCalledWith(
        1,
        "USDCAD=X",
      );
      expect(yahooFinanceService.fetchQuote).toHaveBeenNthCalledWith(
        2,
        "CADUSD=X",
      );
      expect(exchangeRateRepository.findOne).not.toHaveBeenCalled();
    });

    it("falls back to a recent stored rate when no live quote is available", async () => {
      yahooFinanceService.fetchQuote.mockResolvedValue({
        regularMarketPrice: null,
      });
      exchangeRateRepository.find.mockResolvedValue([
        storedRow("USD", "CAD", 1.365, "2026-08-15"),
      ]);

      const result = await service.getLiveRate("USD", "CAD");

      expect(result).toBe(1.365);
      // Through the one door, over the bounded span -- not an unbounded
      // newest-row read.
      expect(exchangeRateRepository.findOne).not.toHaveBeenCalled();
      const [floor, ceiling] = spanBounds(
        exchangeRateRepository.find.mock.calls[0][0],
      );
      expect(floor).toBe("2026-07-04");
      expect(ceiling).toBe("2026-08-18");
    });

    it("falls back to a recent stored rate when the live fetch throws", async () => {
      yahooFinanceService.fetchQuote.mockRejectedValue(
        new Error("rate limited"),
      );
      exchangeRateRepository.find.mockResolvedValue([
        storedRow("USD", "CAD", 1.365, "2026-08-15"),
      ]);

      const result = await service.getLiveRate("USD", "CAD");

      expect(result).toBe(1.365);
      expect(exchangeRateRepository.find).toHaveBeenCalled();
    });

    /**
     * Issue #1390. The stored fallback was `getLatestRate` with no age bound,
     * so with the provider down a rate struck nine months ago was returned as
     * the live one -- and cached as live by `primeLiveRates`, which is how a
     * portfolio total was built on it and still reported itself complete. A
     * rate quoted as "right now" is a price: past the age bound it is unknown.
     */
    it("refuses a stored rate older than the age bound instead of quoting it as live", async () => {
      yahooFinanceService.fetchQuote.mockResolvedValue({
        regularMarketPrice: null,
      });
      // 276 days before the fixture's today: outside FX_MAX_RATE_AGE_DAYS.
      exchangeRateRepository.find.mockResolvedValue([
        storedRow("USD", "CAD", 1.2, "2025-11-15"),
      ]);

      const result = await service.getLiveRate("USD", "CAD");

      expect(result).toBeNull();
    });

    it("returns null when neither a live quote nor a stored rate exists", async () => {
      yahooFinanceService.fetchQuote.mockResolvedValue({
        regularMarketPrice: null,
      });
      exchangeRateRepository.find.mockResolvedValue([]);

      const result = await service.getLiveRate("USD", "XYZ");

      expect(result).toBeNull();
    });
  });

  describe("getRateHistory", () => {
    it("returns all rates when no date filters are provided", async () => {
      const rates = [mockExchangeRate];
      exchangeRateRepository.find.mockResolvedValue(rates);

      const result = await service.getRateHistory();

      expect(result).toEqual(rates);
      expect(exchangeRateRepository.find).toHaveBeenCalledWith({
        where: {},
        order: { rateDate: "ASC", fromCurrency: "ASC", toCurrency: "ASC" },
      });
    });

    it("filters by startDate only", async () => {
      exchangeRateRepository.find.mockResolvedValue([]);

      await service.getRateHistory("2025-01-01");

      expect(exchangeRateRepository.find).toHaveBeenCalledWith({
        where: { rateDate: expect.anything() },
        order: { rateDate: "ASC", fromCurrency: "ASC", toCurrency: "ASC" },
      });
    });

    it("filters by endDate only", async () => {
      exchangeRateRepository.find.mockResolvedValue([]);

      await service.getRateHistory(undefined, "2025-12-31");

      expect(exchangeRateRepository.find).toHaveBeenCalledWith({
        where: { rateDate: expect.anything() },
        order: { rateDate: "ASC", fromCurrency: "ASC", toCurrency: "ASC" },
      });
    });

    it("filters by both startDate and endDate", async () => {
      exchangeRateRepository.find.mockResolvedValue([]);

      await service.getRateHistory("2025-01-01", "2025-12-31");

      expect(exchangeRateRepository.find).toHaveBeenCalledWith({
        where: { rateDate: expect.anything() },
        order: { rateDate: "ASC", fromCurrency: "ASC", toCurrency: "ASC" },
      });
    });

    it("returns empty array when no rates match the date range", async () => {
      exchangeRateRepository.find.mockResolvedValue([]);

      const result = await service.getRateHistory("2099-01-01", "2099-12-31");

      expect(result).toEqual([]);
    });
  });

  describe("getCurrencies", () => {
    it("returns active currencies ordered by code", async () => {
      const currencies = [
        mockCurrency,
        { ...mockCurrency, code: "CAD", name: "Canadian Dollar" },
      ];
      currencyRepository.find.mockResolvedValue(currencies);

      const result = await service.getCurrencies();

      expect(result).toEqual(currencies);
      expect(currencyRepository.find).toHaveBeenCalledWith({
        where: { isActive: true },
        order: { code: "ASC" },
      });
    });

    it("returns empty array when no active currencies exist", async () => {
      currencyRepository.find.mockResolvedValue([]);

      const result = await service.getCurrencies();

      expect(result).toEqual([]);
    });
  });

  describe("getLastUpdateTime", () => {
    it("returns the createdAt of the most recently created exchange rate", async () => {
      const date = new Date("2026-02-10T15:30:00Z");
      exchangeRateRepository.findOne.mockResolvedValue({
        ...mockExchangeRate,
        createdAt: date,
      });

      const result = await service.getLastUpdateTime();

      expect(result).toEqual(date);
      expect(exchangeRateRepository.findOne).toHaveBeenCalledWith({
        where: {},
        order: { createdAt: "DESC" },
      });
    });

    it("returns null when no exchange rates exist", async () => {
      exchangeRateRepository.findOne.mockResolvedValue(null);

      const result = await service.getLastUpdateTime();

      expect(result).toBeNull();
    });

    it("returns null when rate exists but createdAt is undefined", async () => {
      exchangeRateRepository.findOne.mockResolvedValue({
        ...mockExchangeRate,
        createdAt: undefined,
      });

      const result = await service.getLastUpdateTime();

      expect(result).toBeNull();
    });
  });

  describe("scheduledRateRefresh", () => {
    it("calls refreshAllRates", async () => {
      // Mock refreshAllRates dependencies
      dataSource.query.mockResolvedValue([{ code: "USD" }]);

      await service.scheduledRateRefresh();

      expect(dataSource.query).toHaveBeenCalled();
    });

    it("handles refreshAllRates errors without throwing", async () => {
      dataSource.query.mockRejectedValue(new Error("DB error"));

      // Should not throw
      await expect(service.scheduledRateRefresh()).resolves.toBeUndefined();
    });

    it("takes the deployment-wide lease before calling the provider", async () => {
      dataSource.query.mockResolvedValue([{ code: "USD" }]);

      await service.scheduledRateRefresh();

      expect(fetchSync.withLease).toHaveBeenCalledWith(
        FetchSyncJob.ExchangeRates,
        expect.any(Number),
        expect.any(Function),
      );
    });

    // The reason the lease exists: N replicas firing this cron is N times the
    // provider bill, and the upserts underneath converge either way.
    it("makes no provider call when another replica holds the lease", async () => {
      fetchSync.withLease.mockImplementation(async () => false);
      dataSource.query.mockResolvedValue([{ code: "USD" }]);

      await service.scheduledRateRefresh();

      expect(yahooFinanceService.fetchQuote).not.toHaveBeenCalled();
    });

    it("keeps the lease shorter than the daily interval", async () => {
      dataSource.query.mockResolvedValue([{ code: "USD" }]);

      await service.scheduledRateRefresh();

      // A crashed holder must never block the next tick; the expiry alone is
      // what hands the job back.
      const [, leaseMs] = fetchSync.withLease.mock.calls[0];
      expect(leaseMs).toBeLessThan(24 * 60 * 60 * 1000);
      expect(leaseMs).toBeGreaterThan(0);
    });
  });
  /**
   * On-demand historical fill, for the pairs a point-in-time report cannot
   * convert (issue: "Total unavailable" on the Account Balances report as the
   * date moves back through years the daily refresh never covered).
   */
  describe("ensureRatesForDate", () => {
    /** Every row the bulk upsert wrote, flattened out of its parameter list. */
    let inserted: Array<{
      from: string;
      to: string;
      date: string;
      rate: number;
    }>;

    const ymd = (date: Date): string => date.toISOString().slice(0, 10);

    /** One bar per weekday in `[start, end]`, the shape of a daily FX series. */
    const weekdayBars = (start: string, end: string, close: number) => {
      const bars: Array<{ date: Date; close: number }> = [];
      for (
        let day = new Date(`${start}T00:00:00Z`);
        ymd(day) <= end;
        day = new Date(day.getTime() + 86_400_000)
      ) {
        if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) {
          bars.push({ date: day, close });
        }
      }
      return bars;
    };

    beforeEach(() => {
      inserted = [];
      dataSource.query.mockImplementation(
        async (sql: string, params?: unknown[]) => {
          if (
            typeof sql === "string" &&
            sql.includes("INSERT INTO exchange_rates") &&
            Array.isArray(params)
          ) {
            for (let i = 0; i < params.length; i += 4) {
              inserted.push({
                from: params[i] as string,
                to: params[i + 1] as string,
                date: ymd(params[i + 2] as Date),
                rate: params[i + 3] as number,
              });
            }
          }
          return [];
        },
      );
    });

    // One provider call returns the whole daily series for whatever period it is
    // asked for and costs the same either way, so the unit is a calendar month --
    // plus the lead `closeAt` may reach back over, without which the first days
    // of the month would have nothing to carry forward from.
    it("fetches the whole month, with the boundary lead the lookup needs", async () => {
      const bars = weekdayBars("2017-07-18", "2017-08-31", 1.27);
      yahooFinanceService.fetchHistoricalWindow.mockResolvedValue(bars);

      const loaded = await service.ensureRatesForDate(
        [{ from: "USD", to: "CAD" }],
        "2017-08-18",
      );

      expect(loaded).toBe(bars.length);
      expect(yahooFinanceService.fetchHistoricalWindow).toHaveBeenCalledTimes(
        1,
      );
      const [symbol, , start, end] =
        yahooFinanceService.fetchHistoricalWindow.mock.calls[0];
      expect(symbol).toBe("USDCAD=X");
      expect(ymd(start)).toBe("2017-07-18");
      expect(ymd(end)).toBe("2017-08-31");
    });

    it("persists one canonical row from the one call", async () => {
      yahooFinanceService.fetchHistoricalWindow.mockResolvedValue([
        { date: new Date("2017-08-17T00:00:00Z"), close: 1.25 },
      ]);

      await service.ensureRatesForDate(
        [{ from: "USD", to: "CAD" }],
        "2017-08-18",
      );

      // Asked for USD->CAD at 1.25, stored as the canonical CAD->USD at 0.8.
      expect(inserted).toEqual([
        { from: "CAD", to: "USD", date: "2017-08-17", rate: 0.8 },
      ]);
    });

    // One fetch writes both directions, so USD->CAD and CAD->USD are one unit of
    // work -- fetching each would be the same request twice.
    it("asks once for a pair named in both directions", async () => {
      yahooFinanceService.fetchHistoricalWindow.mockResolvedValue(
        weekdayBars("2017-07-18", "2017-08-31", 1.25),
      );

      await service.ensureRatesForDate(
        [
          { from: "USD", to: "CAD" },
          { from: "CAD", to: "USD" },
        ],
        "2017-08-18",
      );

      expect(yahooFinanceService.fetchHistoricalWindow).toHaveBeenCalledTimes(
        1,
      );
    });

    it("ignores a pair whose two sides are the same currency", async () => {
      const loaded = await service.ensureRatesForDate(
        [{ from: "CAD", to: "CAD" }],
        "2017-08-18",
      );

      expect(loaded).toBe(0);
      expect(yahooFinanceService.fetchHistoricalWindow).not.toHaveBeenCalled();
    });

    // Yahoo carries some pairs under one orientation only, and either symbol
    // lands on the same stored row -- so `CADUSD=X` answers a USD->CAD question.
    it("falls back to the reverse symbol when the direct one has nothing", async () => {
      yahooFinanceService.fetchHistoricalWindow.mockImplementation(
        async (symbol: string) =>
          symbol === "CADUSD=X"
            ? [{ date: new Date("2017-08-17T00:00:00Z"), close: 0.8 }]
            : null,
      );

      const loaded = await service.ensureRatesForDate(
        [{ from: "USD", to: "CAD" }],
        "2017-08-18",
      );

      expect(loaded).toBe(1);
      // The reverse symbol answered with CAD->USD, which is already the stored
      // orientation, so it is written as it came back.
      expect(inserted).toEqual([
        { from: "CAD", to: "USD", date: "2017-08-17", rate: 0.8 },
      ]);
    });

    // A symbol that answered is not necessarily a daily series: `VNDSGD=X`
    // returned one bar for a month while `SGDVND=X` carried every weekday.
    it("asks the reverse symbol when the direct one is sparse, and keeps the denser answer", async () => {
      const reverseBars = weekdayBars("2017-07-18", "2017-08-31", 17_000);
      yahooFinanceService.fetchHistoricalWindow.mockImplementation(
        async (symbol: string) =>
          symbol === "VNDSGD=X"
            ? [
                // A day the reverse also carries, and one it does not.
                { date: new Date("2017-08-17T00:00:00Z"), close: 0.00005 },
                { date: new Date("2017-08-19T00:00:00Z"), close: 0.00005 },
              ]
            : reverseBars,
      );

      const loaded = await service.ensureRatesForDate(
        [{ from: "VND", to: "SGD" }],
        "2017-08-18",
      );

      expect(
        yahooFinanceService.fetchHistoricalWindow.mock.calls.map((c) => c[0]),
      ).toEqual(["VNDSGD=X", "SGDVND=X"]);
      // Every reverse day, plus the one day only the direct symbol had.
      expect(loaded).toBe(reverseBars.length + 1);
      expect(inserted).toHaveLength(reverseBars.length + 1);
      // One row per day: the shared day is written from the denser series only.
      const aug17 = inserted.filter((row) => row.date === "2017-08-17");
      expect(aug17).toEqual([
        { from: "SGD", to: "VND", date: "2017-08-17", rate: 17_000 },
      ]);
      expect(inserted).toContainEqual({
        from: "SGD",
        to: "VND",
        date: "2017-08-19",
        rate: roundFxRate(1 / 0.00005),
      });
    });

    it("keeps a sparse direct series when the reverse symbol has nothing", async () => {
      yahooFinanceService.fetchHistoricalWindow.mockImplementation(
        async (symbol: string) =>
          symbol === "USDCAD=X"
            ? [{ date: new Date("2017-08-17T00:00:00Z"), close: 1.25 }]
            : null,
      );

      const loaded = await service.ensureRatesForDate(
        [{ from: "USD", to: "CAD" }],
        "2017-08-18",
      );

      expect(yahooFinanceService.fetchHistoricalWindow).toHaveBeenCalledTimes(
        2,
      );
      expect(loaded).toBe(1);
      expect(inserted).toEqual([
        { from: "CAD", to: "USD", date: "2017-08-17", rate: 0.8 },
      ]);
    });

    it("does not ask the reverse symbol when the direct one is daily", async () => {
      yahooFinanceService.fetchHistoricalWindow.mockResolvedValue(
        weekdayBars("2017-07-18", "2017-08-31", 1.25),
      );

      await service.ensureRatesForDate(
        [{ from: "USD", to: "CAD" }],
        "2017-08-18",
      );

      expect(
        yahooFinanceService.fetchHistoricalWindow.mock.calls.map((c) => c[0]),
      ).toEqual(["USDCAD=X"]);
    });

    // The one case the fetch can never satisfy is the one that would otherwise
    // repeat on every page load: a date before the pair's history begins.
    it("does not ask again for a pair-month the provider had nothing for", async () => {
      // `[]`, not `null`: an answered-empty window is what may be remembered.
      // `null` means no answer -- a failure, or a call the breaker refused --
      // and remembering that leaves every foreign-currency total in the report
      // null for half an hour after the provider came back.
      yahooFinanceService.fetchHistoricalWindow.mockResolvedValue([]);

      await service.ensureRatesForDate(
        [{ from: "USD", to: "CAD" }],
        "2017-08-18",
      );
      const afterFirst =
        yahooFinanceService.fetchHistoricalWindow.mock.calls.length;
      expect(afterFirst).toBeGreaterThan(0);

      const loaded = await service.ensureRatesForDate(
        [{ from: "CAD", to: "USD" }],
        "2017-08-30",
      );

      expect(loaded).toBe(0);
      expect(yahooFinanceService.fetchHistoricalWindow).toHaveBeenCalledTimes(
        afterFirst,
      );
    });

    it("does ask again for a different month", async () => {
      yahooFinanceService.fetchHistoricalWindow.mockResolvedValue(null);

      await service.ensureRatesForDate(
        [{ from: "USD", to: "CAD" }],
        "2017-08-18",
      );
      const afterFirst =
        yahooFinanceService.fetchHistoricalWindow.mock.calls.length;

      await service.ensureRatesForDate(
        [{ from: "USD", to: "CAD" }],
        "2017-09-18",
      );

      expect(
        yahooFinanceService.fetchHistoricalWindow.mock.calls.length,
      ).toBeGreaterThan(afterFirst);
    });

    // The market has not been to the end of this month yet, so nothing asks it.
    it("clamps the window at today", async () => {
      yahooFinanceService.fetchHistoricalWindow.mockResolvedValue([
        { date: new Date("2026-08-17T00:00:00Z"), close: 1.4 },
      ]);

      await service.ensureRatesForDate(
        [{ from: "USD", to: "CAD" }],
        "2026-08-18",
      );

      const [, , start, end] =
        yahooFinanceService.fetchHistoricalWindow.mock.calls[0];
      expect(ymd(start)).toBe("2026-07-18");
      expect(ymd(end)).toBe("2026-08-18");
    });

    // Best-effort by construction: this runs inside a read the database could
    // answer for every other pair.
    it("lets the other pairs through when one provider call fails", async () => {
      yahooFinanceService.fetchHistoricalWindow.mockImplementation(
        async (symbol: string) => {
          if (symbol.startsWith("USD")) throw new Error("rate limited");
          if (symbol === "EURCAD=X")
            return [{ date: new Date("2017-08-17T00:00:00Z"), close: 1.47 }];
          return null;
        },
      );

      const loaded = await service.ensureRatesForDate(
        [
          { from: "USD", to: "CAD" },
          { from: "EUR", to: "CAD" },
        ],
        "2017-08-18",
      );

      expect(loaded).toBe(1);
      // Fetched as EUR->CAD, stored as the canonical CAD->EUR.
      expect(inserted).toContainEqual({
        from: "CAD",
        to: "EUR",
        date: "2017-08-17",
        rate: roundFxRate(1 / 1.47),
      });
    });

    it("does nothing at all when asked for no pairs", async () => {
      const loaded = await service.ensureRatesForDate([], "2017-08-18");

      expect(loaded).toBe(0);
      expect(yahooFinanceService.fetchHistoricalWindow).not.toHaveBeenCalled();
      expect(dataSource.query).not.toHaveBeenCalled();
    });
  });
  describe("ensureRatesForDate and the empty-window memory", () => {
    const dnsFailure = () =>
      Object.assign(new TypeError("fetch failed"), {
        cause: Object.assign(new Error("getaddrinfo EAI_AGAIN"), {
          code: "EAI_AGAIN",
        }),
      });

    it("does not remember a window the provider never answered", async () => {
      // A refusal and a transport failure both persist zero rates, and this
      // memory holds for 30 minutes: remembering one leaves every
      // foreign-currency total in the report null long after a two-minute
      // outage ended.
      yahooFinanceService.fetchHistoricalWindow.mockImplementation(async () => {
        health.recordFailure("yahoo_finance", dnsFailure());
        return null;
      });

      await service.ensureRatesForDate(
        [{ from: "USD", to: "CAD" }],
        "2026-03-15",
      );
      const callsAfterFirst =
        yahooFinanceService.fetchHistoricalWindow.mock.calls.length;

      await service.ensureRatesForDate(
        [{ from: "USD", to: "CAD" }],
        "2026-03-16",
      );
      expect(
        yahooFinanceService.fetchHistoricalWindow.mock.calls.length,
      ).toBeGreaterThan(callsAfterFirst);
    });

    it("does not remember a pair only one direction answered for", async () => {
      // `USDCAD=X` answering "no bars" says nothing about `CADUSD=X`, and this
      // memory holds for 30 minutes: half-knowledge is what used to be cached.
      let call = 0;
      yahooFinanceService.fetchHistoricalWindow.mockImplementation(() => {
        call++;
        return Promise.resolve(call === 1 ? [] : null);
      });

      await service.ensureRatesForDate(
        [{ from: "USD", to: "CAD" }],
        "2026-03-15",
      );
      const callsAfterFirst =
        yahooFinanceService.fetchHistoricalWindow.mock.calls.length;

      await service.ensureRatesForDate(
        [{ from: "USD", to: "CAD" }],
        "2026-03-16",
      );
      expect(
        yahooFinanceService.fetchHistoricalWindow.mock.calls.length,
      ).toBeGreaterThan(callsAfterFirst);
    });

    it("still remembers a window the provider answered as empty", async () => {
      yahooFinanceService.fetchHistoricalWindow.mockResolvedValue([]);

      await service.ensureRatesForDate(
        [{ from: "USD", to: "CAD" }],
        "2026-03-15",
      );
      const callsAfterFirst =
        yahooFinanceService.fetchHistoricalWindow.mock.calls.length;

      await service.ensureRatesForDate(
        [{ from: "USD", to: "CAD" }],
        "2026-03-16",
      );
      expect(yahooFinanceService.fetchHistoricalWindow.mock.calls.length).toBe(
        callsAfterFirst,
      );
    });
  });
});
