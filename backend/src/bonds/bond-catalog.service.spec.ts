import { Logger } from "@nestjs/common";
import { DataSource } from "typeorm";
import { createScopedDbMocks } from "../test-helpers/scoped-db-testing";
import { POLISH_BOND_ADAPTER } from "./adapters/pl";
import { BondAdapter } from "./bond-adapter";
import { BondCatalogService } from "./bond-catalog.service";
import { bondInstrumentId } from "./bond-instrument-id";
import { contentHash } from "./canonical-json";

jest.mock("../common/db/scoped-db", () =>
  jest.requireActual("../test-helpers/scoped-db-testing").scopedDbMockModule(),
);
jest.mock("../common/db/with-context", () => ({
  withSystemContext: jest.fn((fn: () => unknown) => fn()),
}));

type Row = Record<string, unknown>;

interface Db {
  currencies: string[];
  instruments: Row[];
  /** key "<instrumentId>:<version>" -> content hash */
  versions: Map<string, string>;
}

function setup(adapters: readonly BondAdapter[], seed: Partial<Db> = {}) {
  const db: Db = {
    currencies: ["PLN"],
    instruments: [],
    versions: new Map(),
    ...seed,
  };
  const { manager, dataSource } = createScopedDbMocks();
  const statements: string[] = [];
  manager.query.mockImplementation(async (sql: string, params: unknown[]) => {
    statements.push(sql);
    if (sql.includes("INSERT INTO benchmark_series")) return [];
    if (sql.includes("FROM currencies"))
      return db.currencies.includes(params[0] as string)
        ? [{ "?column?": 1 }]
        : [];
    if (sql.includes("INSERT INTO bond_instruments")) {
      if (!db.instruments.some((i) => i.series_code === params[3])) {
        db.instruments.push({ id: `id-${params[3]}`, series_code: params[3] });
      }
      return [];
    }
    if (sql.includes("ORDER BY issuer_country_code")) {
      return [
        {
          id: "i-1",
          issuer_country_code: "PL",
          issuer_code: "PL_MF",
          program_code: "TOS",
          series_code: "TOS1029",
          currency_code: "PLN",
        },
      ];
    }
    if (sql.includes("SELECT id FROM bond_instruments")) {
      return db.instruments
        .filter((i) => i.series_code === params[2])
        .map((i) => ({ id: i.id }));
    }
    if (sql.includes("INSERT INTO bond_terms_versions")) {
      const key = `${params[0]}:${params[1]}`;
      if (db.versions.has(key)) return [];
      db.versions.set(key, params[3] as string);
      return [{ version: params[1] }];
    }
    if (sql.includes("SELECT content_hash")) {
      return [{ content_hash: db.versions.get(`${params[0]}:${params[1]}`) }];
    }
    throw new Error(`unexpected query: ${sql}`);
  });
  const service = new BondCatalogService(dataSource as unknown as DataSource);
  return { service, db, statements, manager };
}

describe("BondCatalogService", () => {
  let error: jest.SpyInstance;
  beforeEach(() => {
    error = jest.spyOn(Logger.prototype, "error").mockImplementation();
    jest.spyOn(Logger.prototype, "log").mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it("seeds series metadata, four instruments and four terms versions in one transaction", async () => {
    const { service, db, manager } = setup([POLISH_BOND_ADAPTER]);
    await service.seed([POLISH_BOND_ADAPTER]);
    expect(db.instruments.map((i) => i.series_code).sort()).toEqual([
      "COI1030",
      "DOR1028",
      "EDO1036",
      "OTS0127",
      "ROD1038",
      "ROR1027",
      "ROS1032",
      "TOS1029",
    ]);
    expect(db.versions.size).toBe(8);
    expect(
      manager.query.mock.calls.filter(([s]) =>
        String(s).includes("INSERT INTO benchmark_series"),
      ),
    ).toHaveLength(2);
    expect(error).not.toHaveBeenCalled();
  });

  it("inserts each instrument under its deterministic id, so a link survives a restore elsewhere", async () => {
    const { service, manager } = setup([POLISH_BOND_ADAPTER]);
    await service.seed([POLISH_BOND_ADAPTER]);
    const inserts = manager.query.mock.calls.filter(([s]) =>
      String(s).includes("INSERT INTO bond_instruments"),
    );
    expect(inserts).toHaveLength(8);
    for (const [sql, params] of inserts) {
      expect(String(sql)).toMatch(/\(id, issuer_country_code/);
      expect(params[6]).toBe(bondInstrumentId(params[0], params[1], params[3]));
    }
    expect(new Set(inserts.map(([, p]) => p[6])).size).toBe(8);
  });

  it("never writes covered_through when seeding a series", async () => {
    const { service, statements } = setup([POLISH_BOND_ADAPTER]);
    await service.seed([POLISH_BOND_ADAPTER]);
    const upsert = statements.find((s) =>
      s.includes("INSERT INTO benchmark_series"),
    )!;
    expect(upsert).not.toMatch(/covered_through/);
  });

  it("is a no-op the second time: same hash, nothing logged", async () => {
    const { service, db } = setup([POLISH_BOND_ADAPTER]);
    await service.seed([POLISH_BOND_ADAPTER]);
    const before = new Map(db.versions);
    await service.seed([POLISH_BOND_ADAPTER]);
    expect(db.versions).toEqual(before);
    expect(db.instruments).toHaveLength(8);
    expect(error).not.toHaveBeenCalled();
  });

  it("stores the content hash of the canonical terms", async () => {
    const { service, db } = setup([POLISH_BOND_ADAPTER]);
    await service.seed([POLISH_BOND_ADAPTER]);
    expect(db.versions.get("id-TOS1029:1")).toBe(
      contentHash(
        POLISH_BOND_ADAPTER.catalog.find(
          (e) =>
            (e.terms as { instrument: { seriesCode: string } }).instrument
              .seriesCode === "TOS1029",
        )!.terms,
      ),
    );
  });

  it("logs and skips an entry whose stored version has different content", async () => {
    const { service, db } = setup([POLISH_BOND_ADAPTER], {
      instruments: [{ id: "id-TOS1029", series_code: "TOS1029" }],
      versions: new Map([["id-TOS1029:1", "f".repeat(64)]]),
    });
    await service.seed([POLISH_BOND_ADAPTER]);
    expect(db.versions.get("id-TOS1029:1")).toBe("f".repeat(64));
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toMatch(
      /version 1 of .*TOS1029.*INV-BOND-001/,
    );
    expect(db.versions.size).toBe(8);
  });

  it("logs a bad manifest and carries on with the rest", async () => {
    const broken: BondAdapter = {
      ...POLISH_BOND_ADAPTER,
      catalog: [
        { termsVersion: 1, publishedAt: null, terms: { schemaVersion: 1 } },
        ...POLISH_BOND_ADAPTER.catalog,
      ],
    };
    const { service, db } = setup([broken]);
    await service.seed([broken]);
    expect(db.versions.size).toBe(8);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toMatch(/Invalid bond terms/);
  });

  it("skips an entry whose currency is not in the currencies table", async () => {
    const { service, db } = setup([POLISH_BOND_ADAPTER], { currencies: [] });
    await service.seed([POLISH_BOND_ADAPTER]);
    expect(db.instruments).toHaveLength(0);
    expect(error).toHaveBeenCalledTimes(8);
  });

  it("lists the catalog ordered by country, issuer and series, in the API's shape", async () => {
    const { service, statements } = setup([POLISH_BOND_ADAPTER]);
    await expect(service.listInstruments()).resolves.toEqual([
      {
        id: "i-1",
        issuerCountryCode: "PL",
        issuerCode: "PL_MF",
        programCode: "TOS",
        seriesCode: "TOS1029",
        currencyCode: "PLN",
      },
    ]);
    expect(statements[0]).toMatch(
      /ORDER BY issuer_country_code, issuer_code, series_code/,
    );
  });

  it("seeds the series alone for the refresh", async () => {
    const { service, db, statements } = setup([POLISH_BOND_ADAPTER]);
    await service.seedBenchmarkSeries([POLISH_BOND_ADAPTER]);
    expect(db.instruments).toHaveLength(0);
    expect(statements).toHaveLength(2);
  });

  it("seeds at bootstrap under a system context, and never crashes the boot", async () => {
    const { service } = setup([POLISH_BOND_ADAPTER]);
    const seed = jest
      .spyOn(service, "seed")
      .mockRejectedValueOnce(new Error("db down"));
    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(error.mock.calls[0][0]).toMatch(/seeding failed: db down/);
    seed.mockResolvedValueOnce();
    await service.onApplicationBootstrap();
    expect(seed).toHaveBeenCalledTimes(2);
  });
});
