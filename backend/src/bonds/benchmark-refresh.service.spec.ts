import { Logger } from "@nestjs/common";
import { DataSource } from "typeorm";
import { createScopedDbMocks } from "../test-helpers/scoped-db-testing";
import { ProviderHealthService } from "../provider-health/provider-health.service";
import { ProviderUnavailableError } from "../provider-health/provider-unavailable.error";
import { FetchSyncService } from "../common/jobs/fetch-sync.service";
import { BondAdapter, BenchmarkFetchResult } from "./bond-adapter";
import { BenchmarkRefreshService } from "./benchmark-refresh.service";
import { BondCatalogService } from "./bond-catalog.service";

jest.mock("../common/db/scoped-db", () =>
  jest.requireActual("../test-helpers/scoped-db-testing").scopedDbMockModule(),
);
jest.mock("../common/db/with-context", () => ({
  withSystemContext: jest.fn((fn: () => unknown) => fn()),
}));
jest.mock("../common/date-utils", () => ({
  ...jest.requireActual("../common/date-utils"),
  todayInTimezone: jest.fn(() => "2026-10-10"),
}));

const result = (code: string, through: string): BenchmarkFetchResult => ({
  observations: [
    { observationDate: "2026-08-01", value: "0.0340", publishedOn: null },
  ],
  coveredThrough: through,
  sourceUrl: `https://example.test/${code}`,
});

function build(opts: {
  fetchers?: Record<string, jest.Mock>;
  covered?: Record<string, string | null>;
  health?: Partial<Record<keyof ProviderHealthService, jest.Mock>>;
}) {
  const fetchers = opts.fetchers ?? {
    NBP_X: jest.fn(async () => result("NBP_X", "2026-10-10")),
    CPI_X: jest.fn(async () => result("CPI_X", "2026-08-01")),
  };
  const adapter: BondAdapter = {
    countryCode: "PL",
    registerCalendars: (r) => r,
    catalog: [],
    benchmarks: [
      {
        code: "NBP_X",
        kind: "STEP",
        publisher: "NBP",
        sourceUrl: "u",
        unit: "RATE_FRACTION",
        providerId: "nbp",
      },
      {
        code: "CPI_X",
        kind: "MONTHLY",
        publisher: "GUS",
        sourceUrl: "u",
        unit: "RATE_FRACTION",
        providerId: "gus",
      },
    ],
    fetchBenchmark: (code, fetch) => fetchers[code](fetch),
  };
  const { manager, dataSource } = createScopedDbMocks();
  const writes: Array<{ sql: string; params: unknown[] }> = [];
  manager.query.mockImplementation(async (sql: string, params: unknown[]) => {
    if (sql.includes("SELECT TO_CHAR(covered_through")) {
      const covered = opts.covered?.[params[0] as string];
      return covered === undefined ? [] : [{ covered_through: covered }];
    }
    writes.push({ sql, params });
    return [];
  });
  const health = {
    assertAvailable: jest.fn(() => "open-gate"),
    recordSuccess: jest.fn(),
    recordFailure: jest.fn(() => true),
    releaseProbe: jest.fn(),
    logFailure: jest.fn(),
    ...opts.health,
  };
  const fetchSync = {
    withLease: jest.fn(
      async (_job: string, _ms: number, fn: () => Promise<void>) => {
        await fn();
        return true;
      },
    ),
  };
  const catalog = { seedBenchmarkSeries: jest.fn(async () => undefined) };
  const service = new BenchmarkRefreshService(
    dataSource as unknown as DataSource,
    health as unknown as ProviderHealthService,
    fetchSync as unknown as FetchSyncService,
    catalog as unknown as BondCatalogService,
  );
  return { service, adapter, fetchers, writes, health, fetchSync, catalog };
}

describe("BenchmarkRefreshService", () => {
  let logError: jest.SpyInstance;
  beforeEach(() => {
    logError = jest.spyOn(Logger.prototype, "error").mockImplementation();
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it("seeds the series, fetches each, stores the values and moves coverage forward", async () => {
    const { service, adapter, writes, catalog } = build({});
    await service.refreshAll({ adapters: [adapter] });
    expect(catalog.seedBenchmarkSeries).toHaveBeenCalledWith([adapter]);
    const inserts = writes.filter((w) =>
      w.sql.includes("INSERT INTO benchmark_values"),
    );
    expect(inserts).toHaveLength(2);
    expect(inserts[0].sql).toMatch(/IS DISTINCT FROM EXCLUDED\.value/);
    expect(inserts[0].params).toEqual([
      "NBP_X",
      ["2026-08-01"],
      ["0.0340"],
      [null],
      "https://example.test/NBP_X",
    ]);
    const coverage = writes.filter((w) =>
      w.sql.includes("UPDATE benchmark_series"),
    );
    expect(coverage.map((w) => w.params)).toEqual([
      ["NBP_X", "2026-10-10"],
      ["CPI_X", "2026-08-01"],
    ]);
    expect(coverage[0].sql).toMatch(/GREATEST\(COALESCE\(covered_through/);
  });

  it("skips the write of values when a source returns none, but still records coverage", async () => {
    const empty = jest.fn(async () => ({
      ...result("NBP_X", "2026-10-10"),
      observations: [],
    }));
    const { service, adapter, writes } = build({
      fetchers: {
        NBP_X: empty,
        CPI_X: jest.fn(async () => result("CPI_X", "2026-08-01")),
      },
    });
    await service.refreshAll({ adapters: [adapter] });
    expect(
      writes.filter((w) => w.sql.includes("INSERT INTO benchmark_values")),
    ).toHaveLength(1);
    expect(
      writes.filter((w) => w.sql.includes("UPDATE benchmark_series")),
    ).toHaveLength(2);
  });

  it("one series failing does not stop the other, and a plain failure is logged as an error", async () => {
    const { service, adapter, fetchers, writes } = build({
      fetchers: {
        NBP_X: jest.fn(async () => {
          throw new Error("unparseable");
        }),
        CPI_X: jest.fn(async () => result("CPI_X", "2026-08-01")),
      },
    });
    await service.refreshAll({ adapters: [adapter] });
    expect(fetchers.CPI_X).toHaveBeenCalled();
    expect(writes.some((w) => w.params[0] === "CPI_X")).toBe(true);
    expect(logError.mock.calls[0][0]).toMatch(/NBP_X failed: unparseable/);
  });

  it("a provider the breaker refuses is skipped quietly through the health logger", async () => {
    const refused = new ProviderUnavailableError(
      "Narodowy Bank Polski",
      1000,
      null,
    );
    const { service, adapter, health, writes } = build({
      fetchers: {
        NBP_X: jest.fn(async (fetch: (u: string) => Promise<unknown>) =>
          fetch("https://x"),
        ),
        CPI_X: jest.fn(async () => result("CPI_X", "2026-08-01")),
      },
      health: {
        assertAvailable: jest.fn((id: string) => {
          if (id === "nbp") throw refused;
          return "open-gate";
        }),
      },
    });
    await service.refreshAll({ adapters: [adapter] });
    expect(health.logFailure).toHaveBeenCalledWith(
      expect.anything(),
      "nbp",
      expect.stringContaining("NBP_X"),
      refused,
    );
    expect(logError).not.toHaveBeenCalled();
    expect(writes.some((w) => w.params[0] === "CPI_X")).toBe(true);
  });

  it("gates the injected fetch through the breaker and records success after the body", async () => {
    const http = jest.fn(async () => new Response("ok", { status: 200 }));
    const { service, adapter, health } = build({
      fetchers: {
        NBP_X: jest.fn(
          async (
            fetch: (u: string) => Promise<{ status: number; body: Uint8Array }>,
          ) => {
            const got = await fetch("https://x/a");
            expect(got.status).toBe(200);
            expect(new TextDecoder().decode(got.body)).toBe("ok");
            return result("NBP_X", "2026-10-10");
          },
        ),
        CPI_X: jest.fn(async () => result("CPI_X", "2026-08-01")),
      },
    });
    await service.refreshAll({
      adapters: [adapter],
      fetch: http as unknown as typeof fetch,
    });
    expect(health.assertAvailable).toHaveBeenCalledWith("nbp");
    expect(http).toHaveBeenCalledWith(
      "https://x/a",
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(health.recordSuccess).toHaveBeenCalledWith("nbp");
  });

  it("counts a transport failure, hands back an uncounted probe, and rethrows", async () => {
    const boom = new TypeError("fetch failed");
    const http = jest.fn(async () => {
      throw boom;
    });
    const { service, adapter, health } = build({
      fetchers: {
        NBP_X: jest.fn(async (fetch: (u: string) => Promise<unknown>) =>
          fetch("https://x"),
        ),
        CPI_X: jest.fn(async () => result("CPI_X", "2026-08-01")),
      },
      health: {
        assertAvailable: jest.fn(() => "probe"),
        recordFailure: jest.fn(() => false),
      },
    });
    await service.refreshAll({
      adapters: [adapter],
      fetch: http as unknown as typeof fetch,
    });
    expect(health.recordFailure).toHaveBeenCalledWith("nbp", boom);
    expect(health.releaseProbe).toHaveBeenCalledWith("nbp");
    expect(health.recordSuccess).not.toHaveBeenCalledWith("nbp");
  });

  it("the warm-up fetches only a series that is empty or older than a day", async () => {
    const { service, adapter, fetchers } = build({
      covered: { NBP_X: "2026-10-09", CPI_X: "2026-08-01" },
    });
    await service.refreshAll({ adapters: [adapter], onlyStale: true });
    expect(fetchers.NBP_X).not.toHaveBeenCalled();
    expect(fetchers.CPI_X).toHaveBeenCalled();

    const none = build({ covered: { NBP_X: null } });
    await none.service.refreshAll({
      adapters: [none.adapter],
      onlyStale: true,
    });
    expect(none.fetchers.NBP_X).toHaveBeenCalled();
    expect(none.fetchers.CPI_X).toHaveBeenCalled();
  });

  it("does not fetch at all when another replica holds the lease", async () => {
    const { service, fetchSync, fetchers } = build({});
    fetchSync.withLease.mockResolvedValue(false);
    await service.scheduledRefresh();
    expect(fetchSync.withLease).toHaveBeenCalledWith(
      "bond-benchmarks",
      600000,
      expect.any(Function),
    );
    expect(fetchers.NBP_X).not.toHaveBeenCalled();
  });

  it("the cron and the warm-up run refreshAll under the lease", async () => {
    const { service, fetchSync } = build({});
    const refresh = jest.spyOn(service, "refreshAll").mockResolvedValue();
    await service.scheduledRefresh();
    expect(refresh).toHaveBeenLastCalledWith();
    service.onApplicationBootstrap();
    await new Promise((r) => setImmediate(r));
    expect(refresh).toHaveBeenLastCalledWith({ onlyStale: true });
    expect(fetchSync.withLease).toHaveBeenCalledTimes(2);
  });

  it("a failed warm-up is a warning, not a crash", async () => {
    const { service, fetchSync } = build({});
    fetchSync.withLease.mockRejectedValue(new Error("lease table gone"));
    expect(() => service.onApplicationBootstrap()).not.toThrow();
    await new Promise((r) => setImmediate(r));
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringContaining("lease table gone"),
    );
  });
});
