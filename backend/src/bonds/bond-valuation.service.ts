import { Injectable } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { withScopedDb } from "../common/db/scoped-db";
import { loadBondLedger } from "./bond-ledger";
import { BondLotsRefusal, bondLotsAsOf } from "./bond-lots";
import { BenchmarkData } from "./domain/benchmark";
import { ExactDecimal } from "./domain/exact-decimal";
import { BondTerms, parseBondTerms } from "./domain/bond-terms";
import { BOND_CALENDARS } from "./bond-adapters";
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
  issuer_country_code: string;
  issuer_code: string;
  program_code: string;
  series_code: string;
  currency_code: string;
}

/** A catalog instrument as the API names it. */
export interface BondInstrumentSummary {
  readonly id: string;
  readonly issuerCountryCode: string;
  readonly issuerCode: string;
  readonly programCode: string;
  readonly seriesCode: string;
  readonly currencyCode: string;
}

/**
 * Everything the engine reads about one instrument, loaded once: the terms
 * version, the announced rates and the benchmark observations the rate rule
 * needs. Any number of (lot, asOf) valuations are then computed from it in
 * memory (`valueLotFrom`), so a price series over thousands of days costs one
 * set of reads, not one per day.
 */
export interface BondReferenceData {
  readonly instrument: BondInstrumentSummary;
  readonly termsVersion: number;
  readonly terms: BondTerms;
  readonly announcedRates: ReadonlyMap<number, string>;
  readonly benchmarks: ReadonlyMap<string, BenchmarkData>;
}

/** One open lot of a linked security, valued at the requested day. */
export interface SecurityLotValuation {
  readonly purchaseDate: string;
  readonly quantity: number;
  readonly purchaseDateAssumed: boolean;
  readonly valuation: BondValuation;
}

/**
 * Lot totals. Each is null unless every lot has the figure: a subtotal is not a
 * total, so one lot without a gross value makes `grossValue` null rather than
 * the sum of the others. No lots at all is a known zero; lots that cannot be
 * derived (`refusal`) make every figure null.
 */
export interface SecurityValuationTotals {
  readonly quantity: number | null;
  readonly grossValue: string | null;
  readonly earlyRedemptionValue: string | null;
  readonly accruedInterest: string | null;
}

export interface SecurityValuation {
  readonly securityId: string;
  readonly instrument: BondInstrumentSummary;
  readonly asOf: string;
  readonly lots: readonly SecurityLotValuation[];
  readonly totals: SecurityValuationTotals;
  readonly refusal: BondLotsRefusal | null;
}

function summarize(row: InstrumentRow): BondInstrumentSummary {
  return {
    id: row.id,
    issuerCountryCode: row.issuer_country_code,
    issuerCode: row.issuer_code,
    programCode: row.program_code,
    seriesCode: row.series_code,
    currencyCode: row.currency_code,
  };
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
      const reference = await this.loadReferenceOf(
        m,
        instrument,
        request.termsVersion,
        named,
      );
      return this.valueLotFrom(
        reference,
        request.lot,
        request.asOf,
        request.projection,
      );
    });
  }

  /**
   * The reference data of the instrument with this id (the newest terms version
   * unless one is named). Runs on the caller's transaction, one query after
   * another; throws `BondDataNotFoundError` when the instrument or its terms are
   * not stored and `BondDataInconsistentError` when the rows contradict.
   */
  async loadReference(
    m: EntityManager,
    instrumentId: string,
    termsVersion?: number,
  ): Promise<BondReferenceData> {
    const rows: InstrumentRow[] = await m.query(
      `SELECT id, issuer_country_code, issuer_code, program_code, series_code, currency_code
         FROM bond_instruments
        WHERE id = $1`,
      [instrumentId],
    );
    if (rows.length === 0) {
      throw new BondDataNotFoundError(
        `No bond instrument stored with id ${instrumentId}`,
      );
    }
    const named = `${rows[0].issuer_country_code} ${rows[0].issuer_code} ${rows[0].series_code}`;
    return this.loadReferenceOf(m, rows[0], termsVersion, named);
  }

  /**
   * The lots a user's linked security holds on `asOf`, each valued at `asOf`,
   * with their totals (spec 12.5). Owner-scoped: another user's security and an
   * unlinked one are the same 404. One transaction; the reference data is read
   * once however many lots there are.
   */
  async valueSecurity(
    userId: string,
    securityId: string,
    asOf: string,
  ): Promise<SecurityValuation> {
    return withScopedDb(this.dataSource, async (m) => {
      const ledger = await loadBondLedger(m, userId, securityId);
      const reference = await this.loadReference(
        m,
        ledger.security.bondInstrumentId,
      );
      const { instrument } = reference;
      const folded = bondLotsAsOf(ledger.transactions, asOf);
      if (folded.lots === null) {
        return {
          securityId,
          instrument,
          asOf,
          lots: [],
          totals: {
            quantity: null,
            grossValue: null,
            earlyRedemptionValue: null,
            accruedInterest: null,
          },
          refusal: folded.refusal,
        };
      }

      const lots = folded.lots.map((lot) => ({
        ...lot,
        valuation: this.valueLotFrom(reference, lot, asOf),
      }));
      const places = reference.terms.rounding.moneyDecimals;
      const sum = (pick: (v: BondValuation) => string | null) =>
        sumKnown(
          lots.map((l) => pick(l.valuation)),
          places,
        );
      return {
        securityId,
        instrument,
        asOf,
        lots,
        totals: {
          quantity: lots.reduce((n, l) => n + l.quantity, 0),
          grossValue: sum((v) => v.grossValue),
          earlyRedemptionValue: sum((v) => v.earlyRedemptionValue),
          accruedInterest: sum((v) => v.accruedInterest),
        },
        refusal: null,
      };
    });
  }

  /** One lot at one date, from reference data already loaded. Pure. */
  valueLotFrom(
    reference: BondReferenceData,
    lot: { readonly purchaseDate: string; readonly quantity: number },
    asOf: string,
    projection?: ReadonlyMap<string, string>,
  ): BondValuation {
    return valueBondLot({
      terms: reference.terms,
      termsVersion: reference.termsVersion,
      announcedRates: reference.announcedRates,
      benchmarks: reference.benchmarks,
      calendars: BOND_CALENDARS,
      lot,
      asOf,
      projection,
    });
  }

  private async loadReferenceOf(
    m: EntityManager,
    instrument: InstrumentRow,
    termsVersion: number | undefined,
    named: string,
  ): Promise<BondReferenceData> {
    const { version, terms } = await this.loadTerms(
      m,
      instrument,
      termsVersion,
      named,
    );
    this.assertConsistent(instrument, terms, named, version);
    const announcedRates = await this.loadAnnouncedRates(m, instrument.id);
    const benchmarks = await this.loadBenchmarks(m, terms);
    return {
      instrument: summarize(instrument),
      termsVersion: version,
      terms,
      announcedRates,
      benchmarks,
    };
  }

  private async loadInstrument(
    m: EntityManager,
    request: ValueLotRequest,
    named: string,
  ): Promise<InstrumentRow> {
    const rows: InstrumentRow[] = await m.query(
      `SELECT id, issuer_country_code, issuer_code, program_code, series_code, currency_code
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
    termsVersion: number | undefined,
    named: string,
  ): Promise<{ version: number; terms: BondTerms }> {
    const params: unknown[] = [instrument.id];
    let versionFilter = "";
    if (termsVersion !== undefined) {
      params.push(termsVersion);
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
        termsVersion === undefined
          ? "terms version"
          : `terms version ${termsVersion}`;
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

/** The exact sum of the figures, or null when any is unknown. Zero figures sum to zero. */
function sumKnown(
  figures: ReadonlyArray<string | null>,
  places: number,
): string | null {
  let total = ExactDecimal.ZERO;
  for (const figure of figures) {
    if (figure === null) return null;
    total = total.add(ExactDecimal.parse(figure));
  }
  return total.toFixed(places);
}
