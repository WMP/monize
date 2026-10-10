import { TestingModule } from "@nestjs/testing";
import { DataSource } from "typeorm";
import { withSystemContext } from "@/common/db/with-context";
import { BondValuationService } from "@/bonds/bond-valuation.service";
import { manifestDocument } from "@/bonds/adapters/pl/pl-test-input";
import {
  cleanTables,
  createIntegrationModule,
} from "../helpers/integration-setup";

/**
 * The read service against a real PostgreSQL: the SQL, the NUMERIC and DATE
 * handling and the one-transaction read are properties the unit spec's mocked
 * manager cannot show. Rows are seeded with SQL, as a fetcher or a migration
 * would write them.
 */
describe("BondValuationService (integration)", () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let service: BondValuationService;

  beforeAll(async () => {
    module = await createIntegrationModule([]);
    dataSource = module.get(DataSource);
    service = new BondValuationService(dataSource);
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

  async function seed(
    manifest: "tos1029" | "edo1036",
    program: string,
    series: string,
  ): Promise<string> {
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO bond_instruments (issuer_country_code, issuer_code, program_code, series_code, currency_code, marketability)
       VALUES ('PL', 'PL_MF', $1, $2, 'PLN', 'RETAIL_REDEEMABLE')
       RETURNING id`,
      [program, series],
    );
    await dataSource.query(
      `INSERT INTO bond_terms_versions (bond_instrument_id, version, terms, content_hash, source_url, retrieved_at)
       VALUES ($1, 1, $2::jsonb, repeat('a', 64), 'https://example.test/terms', NOW())`,
      [rows[0].id, JSON.stringify(manifestDocument(manifest))],
    );
    return rows[0].id;
  }

  const value = (
    series: string,
    purchaseDate: string,
    asOf: string,
    termsVersion?: number,
  ) =>
    withSystemContext(() =>
      service.valueLot({
        issuerCountryCode: "PL",
        issuerCode: "PL_MF",
        seriesCode: series,
        termsVersion,
        lot: { purchaseDate, quantity: 1 },
        asOf,
      }),
    );

  it("E2: values a TOS1029 lot from stored terms", async () => {
    await seed("tos1029", "TOS", "TOS1029");
    const v = await value("TOS1029", "2026-10-15", "2027-04-15");
    expect(v).toMatchObject({
      termsVersion: 1,
      earlyRedemptionValue: "101.19",
      valuationComplete: true,
    });
  });

  it("applies an announced rate over the derived one, exactly", async () => {
    const id = await seed("edo1036", "EDO", "EDO1036");
    await dataSource.query(
      `INSERT INTO benchmark_series (code, kind, publisher, source_url, unit, covered_through)
       VALUES ('PL_CPI_GUS_YOY', 'MONTHLY', 'GUS', 'https://example.test/cpi', 'FRACTION', NULL)`,
    );
    await dataSource.query(
      `INSERT INTO benchmark_values (benchmark_code, observation_date, value, source_url, retrieved_at)
       VALUES ('PL_CPI_GUS_YOY', '2027-08-01', 0.0290000000, 'https://example.test/cpi', NOW())`,
    );
    // Derived would be 0.029 + 0.020 = 0.0490; the announced rate differs.
    await dataSource.query(
      `INSERT INTO bond_period_rates (bond_instrument_id, period_number, annual_rate, source_url, retrieved_at)
       VALUES ($1, 2, 0.0512345678, 'https://example.test/rate', NOW())`,
      [id],
    );
    const v = await value("EDO1036", "2026-10-01", "2027-10-16");
    expect(v.currentPeriod).toMatchObject({
      index: 2,
      annualRate: "0.0512345678",
      rateSource: "ANNOUNCED",
    });
  });

  it("derives from the stored month when no rate is announced", async () => {
    await seed("edo1036", "EDO", "EDO1036");
    await dataSource.query(
      `INSERT INTO benchmark_series (code, kind, publisher, source_url, unit)
       VALUES ('PL_CPI_GUS_YOY', 'MONTHLY', 'GUS', 'https://example.test/cpi', 'FRACTION')`,
    );
    await dataSource.query(
      `INSERT INTO benchmark_values (benchmark_code, observation_date, value, source_url, retrieved_at)
       VALUES ('PL_CPI_GUS_YOY', '2027-08-01', 0.0290000000, 'https://example.test/cpi', NOW())`,
    );
    const v = await value("EDO1036", "2026-10-01", "2027-10-16");
    expect(v.currentPeriod).toMatchObject({
      annualRate: "0.0490",
      rateSource: "DERIVED",
    });
  });

  it("names a missing CPI month instead of substituting another", async () => {
    await seed("edo1036", "EDO", "EDO1036");
    await dataSource.query(
      `INSERT INTO benchmark_series (code, kind, publisher, source_url, unit)
       VALUES ('PL_CPI_GUS_YOY', 'MONTHLY', 'GUS', 'https://example.test/cpi', 'FRACTION')`,
    );
    await dataSource.query(
      `INSERT INTO benchmark_values (benchmark_code, observation_date, value, source_url, retrieved_at)
       VALUES ('PL_CPI_GUS_YOY', '2027-07-01', 0.0290000000, 'https://example.test/cpi', NOW())`,
    );
    const v = await value("EDO1036", "2026-10-01", "2027-10-16");
    expect(v.grossValue).toBeNull();
    expect(v.missing).toEqual([
      {
        benchmarkId: "PL_CPI_GUS_YOY",
        observation: "2027-08",
        publisher: "GUS",
      },
    ]);
    expect(v.valuationComplete).toBe(false);
  });

  it("reports a benchmark with no stored series as missing", async () => {
    await seed("edo1036", "EDO", "EDO1036");
    const v = await value("EDO1036", "2026-10-01", "2027-10-16");
    expect(v.missing[0]).toMatchObject({ publisher: null });
  });

  it("refuses an unknown instrument and an unknown terms version", async () => {
    await expect(value("NOPE0000", "2026-10-15", "2027-04-15")).rejects.toThrow(
      /No bond instrument stored for PL PL_MF NOPE0000/,
    );
    await seed("tos1029", "TOS", "TOS1029");
    await expect(
      value("TOS1029", "2026-10-15", "2027-04-15", 9),
    ).rejects.toThrow(/No terms version 9 stored/);
  });
});
