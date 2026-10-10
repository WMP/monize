import { Injectable } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { withScopedDb } from "../common/db/scoped-db";
import { BenchmarkData } from "./domain/benchmark";
import { BondTerms, parseBondTerms } from "./domain/bond-terms";
import { BOND_CALENDARS } from "./bond-calendars";
import {
  BondDataInconsistentError,
  BondDataNotFoundError,
} from "./bond-errors";
import { BondValuation, valueBondLot } from "./engine/bond-engine";

export interface ValueLotRequest {
  readonly issuerCountryCode: string;
  readonly issuerCode: string;
  readonly seriesCode: string;
  /** The newest version when omitted. */
  readonly termsVersion?: number;
  readonly lot: { readonly purchaseDate: string; readonly quantity: number };
  readonly asOf: string;
  readonly projection?: ReadonlyMap<string, string>;
}

interface InstrumentRow {
  id: string;
  series_code: string;
  currency_code: string;
}

/**
 * Values one holding lot from stored reference data (spec 2.6, section 8). The
 * valuation is computed on read and not stored. Every query runs in one
 * `withScopedDb` transaction, one after another on its single connection.
 *
 * The bond tables are global reference data, so the caller's identity is only
 * what `withScopedDb` needs, never a filter.
 */
@Injectable()
export class BondValuationService {
  constructor(private readonly dataSource: DataSource) {}

  async valueLot(request: ValueLotRequest): Promise<BondValuation> {
    return withScopedDb(this.dataSource, async (m) => {
      const named = `${request.issuerCountryCode} ${request.issuerCode} ${request.seriesCode}`;
      const instrument = await this.loadInstrument(m, request, named);
      const { version, terms } = await this.loadTerms(
        m,
        instrument,
        request,
        named,
      );
      this.assertConsistent(instrument, terms, named, version);

      const announcedRates = await this.loadAnnouncedRates(m, instrument.id);
      const benchmarks = await this.loadBenchmarks(m, terms);

      return valueBondLot({
        terms,
        termsVersion: version,
        announcedRates,
        benchmarks,
        calendars: BOND_CALENDARS,
        lot: request.lot,
        asOf: request.asOf,
        projection: request.projection,
      });
    });
  }

  private async loadInstrument(
    m: EntityManager,
    request: ValueLotRequest,
    named: string,
  ): Promise<InstrumentRow> {
    const rows: InstrumentRow[] = await m.query(
      `SELECT id, series_code, currency_code
         FROM bond_instruments
        WHERE issuer_country_code = $1 AND issuer_code = $2 AND series_code = $3`,
      [request.issuerCountryCode, request.issuerCode, request.seriesCode],
    );
    if (rows.length === 0) {
      throw new BondDataNotFoundError(`No bond instrument stored for ${named}`);
    }
    return rows[0];
  }

  private async loadTerms(
    m: EntityManager,
    instrument: InstrumentRow,
    request: ValueLotRequest,
    named: string,
  ): Promise<{ version: number; terms: BondTerms }> {
    const params: unknown[] = [instrument.id];
    let versionFilter = "";
    if (request.termsVersion !== undefined) {
      params.push(request.termsVersion);
      versionFilter = "AND version = $2";
    }
    const rows: Array<{ version: number; terms: unknown }> = await m.query(
      `SELECT version, terms
         FROM bond_terms_versions
        WHERE bond_instrument_id = $1 ${versionFilter}
        ORDER BY version DESC
        LIMIT 1`,
      params,
    );
    if (rows.length === 0) {
      const which =
        request.termsVersion === undefined
          ? "terms version"
          : `terms version ${request.termsVersion}`;
      throw new BondDataNotFoundError(`No ${which} stored for ${named}`);
    }
    return {
      version: Number(rows[0].version),
      terms: parseBondTerms(rows[0].terms),
    };
  }

  private assertConsistent(
    instrument: InstrumentRow,
    terms: BondTerms,
    named: string,
    version: number,
  ): void {
    const claimed = terms.instrument;
    if (
      instrument.series_code !== claimed.seriesCode ||
      instrument.currency_code !== claimed.currency
    ) {
      throw new BondDataInconsistentError(
        `Terms version ${version} of ${named} describe ${claimed.seriesCode} in ${claimed.currency}, ` +
          `but the instrument row is ${instrument.series_code} in ${instrument.currency_code}`,
      );
    }
  }

  private async loadAnnouncedRates(
    m: EntityManager,
    instrumentId: string,
  ): Promise<ReadonlyMap<number, string>> {
    const rows: Array<{ period_number: number; annual_rate: string }> =
      await m.query(
        `SELECT period_number, annual_rate::text AS annual_rate
           FROM bond_period_rates
          WHERE bond_instrument_id = $1`,
        [instrumentId],
      );
    return new Map(rows.map((r) => [Number(r.period_number), r.annual_rate]));
  }

  /** The series the rate rule reads; absent from the map when no row is stored. */
  private async loadBenchmarks(
    m: EntityManager,
    terms: BondTerms,
  ): Promise<ReadonlyMap<string, BenchmarkData>> {
    const benchmarks = new Map<string, BenchmarkData>();
    if (terms.rateRule.type === "FIXED") return benchmarks;
    const code = terms.rateRule.benchmarkId;

    const series: Array<{
      kind: "STEP" | "MONTHLY";
      publisher: string;
      covered_through: string | null;
    }> = await m.query(
      `SELECT kind, publisher, TO_CHAR(covered_through, 'YYYY-MM-DD') AS covered_through
         FROM benchmark_series
        WHERE code = $1`,
      [code],
    );
    if (series.length === 0) return benchmarks;

    const values: Array<{ observation_date: string; value: string }> =
      await m.query(
        `SELECT TO_CHAR(observation_date, 'YYYY-MM-DD') AS observation_date,
                value::text AS value
           FROM benchmark_values
          WHERE benchmark_code = $1
          ORDER BY observation_date`,
        [code],
      );
    const { kind, publisher, covered_through } = series[0];
    benchmarks.set(
      code,
      kind === "STEP"
        ? {
            kind,
            publisher,
            coveredThrough: covered_through,
            changes: values.map((v) => ({
              effectiveFrom: v.observation_date,
              value: v.value,
            })),
          }
        : {
            kind,
            publisher,
            // A monthly observation is stored on the first day of its month.
            values: new Map(
              values.map((v) => [v.observation_date.slice(0, 7), v.value]),
            ),
          },
    );
    return benchmarks;
  }
}
