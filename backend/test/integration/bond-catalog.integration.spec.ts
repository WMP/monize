import { readFileSync } from "fs";
import { join } from "path";
import { TestingModule } from "@nestjs/testing";
import { DataSource } from "typeorm";
import { withSystemContext } from "@/common/db/with-context";
import { todayInTimezone } from "@/common/date-utils";
import { FetchSyncService } from "@/common/jobs/fetch-sync.service";
import { ProviderHealthService } from "@/provider-health/provider-health.service";
import { BenchmarkRefreshService } from "@/bonds/benchmark-refresh.service";
import { BondCatalogService } from "@/bonds/bond-catalog.service";
import { POLISH_BOND_ADAPTER } from "@/bonds/adapters/pl/index";
import { GUS_CPI_CSV_URL } from "@/bonds/adapters/pl/pl-gus-cpi";
import {
  NBP_ARCHIVE_URL,
  NBP_CURRENT_URL,
} from "@/bonds/adapters/pl/pl-nbp-reference";
import {
  cleanTables,
  createIntegrationModule,
} from "../helpers/integration-setup";

const fixture = (name: string) =>
  readFileSync(join(__dirname, "../../src/bonds/adapters/pl/fixtures", name));

/** A fetch that answers from memory: no test here touches the network. */
function fakeFetch(gus: Buffer): typeof fetch {
  const answers: Record<string, Buffer> = {
    [NBP_ARCHIVE_URL]: fixture("nbp-archive.xml"),
    [NBP_CURRENT_URL]: fixture("nbp-current.xml"),
    [GUS_CPI_CSV_URL]: gus,
  };
  return (async (url: string) => {
    const body = answers[url];
    if (!body) return new Response("not found", { status: 404 });
    return new Response(new Uint8Array(body), { status: 200 });
  }) as unknown as typeof fetch;
}

/**
 * The catalog seed and the benchmark refresh against a real PostgreSQL:
 * idempotent upserts, the numeric and date handling, and a publisher's
 * correction updating a stored value are properties a mocked manager cannot show.
 */
describe("bond catalog and benchmark refresh (integration)", () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let catalog: BondCatalogService;
  let refresh: BenchmarkRefreshService;

  beforeAll(async () => {
    module = await createIntegrationModule([]);
    dataSource = module.get(DataSource);
    catalog = new BondCatalogService(dataSource);
    refresh = new BenchmarkRefreshService(
      dataSource,
      new ProviderHealthService(dataSource),
      new FetchSyncService(dataSource),
      catalog,
    );
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await cleanTables(dataSource, ["bond_instruments", "benchmark_series"]);
    await dataSource.query(
      `INSERT INTO currencies (code, name, symbol, decimal_places, is_active)
       VALUES ('PLN', 'Zloty', 'z', 2, true)
       ON CONFLICT (code) DO NOTHING`,
    );
  });

  const count = async (table: string): Promise<number> =>
    Number(
      (await dataSource.query(`SELECT COUNT(*)::int AS n FROM ${table}`))[0].n,
    );

  it("seeds eight instruments, eight terms versions and two series, idempotently", async () => {
    await withSystemContext(() => catalog.seed());
    await withSystemContext(() => catalog.seed());
    expect(await count("bond_instruments")).toBe(8);
    expect(await count("bond_terms_versions")).toBe(8);
    expect(await count("benchmark_series")).toBe(2);
    const hashes = await dataSource.query(
      `SELECT DISTINCT length(content_hash) AS n FROM bond_terms_versions`,
    );
    expect(hashes).toEqual([{ n: 64 }]);
  });

  it("does not move covered_through when the series are seeded again", async () => {
    await withSystemContext(() => catalog.seed());
    await dataSource.query(
      `UPDATE benchmark_series SET covered_through = '2026-10-01' WHERE code = 'PL_NBP_REFERENCE'`,
    );
    await withSystemContext(() => catalog.seed());
    const rows = await dataSource.query(
      `SELECT TO_CHAR(covered_through, 'YYYY-MM-DD') AS c FROM benchmark_series WHERE code = 'PL_NBP_REFERENCE'`,
    );
    expect(rows[0].c).toBe("2026-10-01");
  });

  it("refuses to rewrite a stored terms version with different content", async () => {
    await withSystemContext(() => catalog.seed());
    const before = await dataSource.query(
      `SELECT content_hash FROM bond_terms_versions ORDER BY content_hash`,
    );
    const changed = {
      ...POLISH_BOND_ADAPTER,
      catalog: POLISH_BOND_ADAPTER.catalog.map((e, i) =>
        i === 0
          ? {
              ...e,
              terms: {
                ...(e.terms as object),
                source: {
                  provider: "PL_MF",
                  url: "https://example.test/x",
                  document: "changed",
                },
              },
            }
          : e,
      ),
    };
    await withSystemContext(() => catalog.seed([changed]));
    const after = await dataSource.query(
      `SELECT content_hash FROM bond_terms_versions ORDER BY content_hash`,
    );
    expect(after).toEqual(before);
  });

  it("fetches both series, stores exact values and covers them", async () => {
    const gus = fixture("gus-cpi.csv");
    await withSystemContext(() =>
      refresh.refreshAll({ fetch: fakeFetch(gus) }),
    );

    const nbp = await dataSource.query(
      `SELECT TO_CHAR(observation_date, 'YYYY-MM-DD') AS d, value::text AS v
         FROM benchmark_values WHERE benchmark_code = 'PL_NBP_REFERENCE' ORDER BY observation_date`,
    );
    expect(nbp).toHaveLength(5);
    expect(nbp[nbp.length - 1]).toEqual({ d: "2026-03-05", v: "0.0375000000" });

    const cpi = await dataSource.query(
      `SELECT TO_CHAR(observation_date, 'YYYY-MM-DD') AS d, value::text AS v
         FROM benchmark_values WHERE benchmark_code = 'PL_CPI_GUS_YOY' ORDER BY observation_date`,
    );
    expect(cpi.map((r: { d: string }) => r.d)).toEqual([
      "2025-10-01",
      "2025-11-01",
      "2025-12-01",
      "2026-07-01",
      "2026-08-01",
    ]);
    expect(cpi[4].v).toBe("0.0340000000");

    const coverage = await dataSource.query(
      `SELECT code, TO_CHAR(covered_through, 'YYYY-MM-DD') AS c FROM benchmark_series ORDER BY code`,
    );
    expect(coverage).toEqual([
      { code: "PL_CPI_GUS_YOY", c: "2026-08-01" },
      { code: "PL_NBP_REFERENCE", c: todayInTimezone("Europe/Warsaw") },
    ]);
  });

  it("applies a publisher's correction to a stored value and leaves coverage alone", async () => {
    await withSystemContext(() =>
      refresh.refreshAll({ fetch: fakeFetch(fixture("gus-cpi.csv")) }),
    );
    const revised = Buffer.from(
      fixture("gus-cpi.csv")
        .toString("latin1")
        .replace(";2026;8;103,4;", ";2026;8;103,5;"),
      "latin1",
    );
    await withSystemContext(() =>
      refresh.refreshAll({ fetch: fakeFetch(revised) }),
    );
    const rows = await dataSource.query(
      `SELECT value::text AS v FROM benchmark_values
        WHERE benchmark_code = 'PL_CPI_GUS_YOY' AND observation_date = '2026-08-01'`,
    );
    expect(rows).toEqual([{ v: "0.0350000000" }]);
    expect(await count("benchmark_values")).toBe(10);
  });

  it("a source that fails leaves the other series refreshed", async () => {
    const failing = (async (url: string) => {
      if (url.includes("nbp.pl")) return new Response("down", { status: 503 });
      return new Response(new Uint8Array(fixture("gus-cpi.csv")), {
        status: 200,
      });
    }) as unknown as typeof fetch;
    await withSystemContext(() => refresh.refreshAll({ fetch: failing }));
    const rows = await dataSource.query(
      `SELECT benchmark_code, COUNT(*)::int AS n FROM benchmark_values GROUP BY benchmark_code`,
    );
    expect(rows).toEqual([{ benchmark_code: "PL_CPI_GUS_YOY", n: 5 }]);
  });
});
