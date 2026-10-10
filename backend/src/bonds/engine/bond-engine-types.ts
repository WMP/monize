import { BenchmarkData } from "../domain/benchmark";
import { BusinessDayCalendar } from "../domain/business-day-calendar";
import { BondTerms } from "../domain/bond-terms";

export type RateSource = "TERMS" | "ANNOUNCED" | "DERIVED" | "PROJECTED";

export type EarlyRedemptionRefusal =
  | "NOT_REDEEMABLE"
  | "TOO_EARLY"
  | "TOO_LATE"
  | "RECORD_DAY"
  | "MATURED"
  | "RATE_UNKNOWN"
  | "TERMS_INCOMPLETE";

export interface BondEngineInput {
  readonly terms: BondTerms;
  readonly termsVersion: number;
  /** Announced rate fractions by period number; an announced rate wins (spec 2.2). */
  readonly announcedRates: ReadonlyMap<number, string>;
  /** Stored observations by benchmark id; the caller loads them, the engine never fetches. */
  readonly benchmarks: ReadonlyMap<string, BenchmarkData>;
  /** Calendars by id (a `CalendarRegistry.asMap()`); an unknown id makes the terms incomplete. */
  readonly calendars: ReadonlyMap<string, BusinessDayCalendar>;
  readonly lot: { readonly purchaseDate: string; readonly quantity: number };
  readonly asOf: string;
  /** Benchmark value assumed for periods that have not started and have no data. */
  readonly projection?: ReadonlyMap<string, string>;
}

export interface MissingObservation {
  readonly benchmarkId: string;
  /** `YYYY-MM` for a monthly series, the observation day for a step series. */
  readonly observation: string;
  /** Null when the benchmark itself is absent from the input. */
  readonly publisher: string | null;
}

export interface CashFlow {
  readonly date: string;
  readonly type: "INTEREST" | "PRINCIPAL";
  /** The whole lot, 2 decimals. */
  readonly amount: string;
  readonly status: "KNOWN" | "PROJECTED";
  readonly period: number;
}

export interface BondValuation {
  readonly asOf: string;
  readonly seriesCode: string;
  readonly termsVersion: number;
  readonly quantity: number;
  readonly maturityDate: string;
  readonly currentPeriod: {
    readonly index: number;
    readonly start: string;
    readonly end: string;
    readonly annualRate: string;
    readonly rateSource: RateSource;
  } | null;
  /** Per bond: the base of the current period (the nominal for a coupon bond). */
  readonly principal: string | null;
  /** Lot: gross value less nominal (capitalised plus current accrual when compounding). */
  readonly accruedInterest: string | null;
  /** Lot, before any early redemption penalty. */
  readonly grossValue: string | null;
  readonly earlyRedemptionValue: string | null;
  readonly earlyRedemptionRefusal: EarlyRedemptionRefusal | null;
  /** Cash flows after `asOf`, every rate they depend on known. */
  readonly knownCashflows: readonly CashFlow[];
  readonly projectedCashflows: readonly CashFlow[];
  readonly maturityValueKnown: string | null;
  /** Set only when a projected rate is involved; null otherwise. */
  readonly maturityValueProjected: string | null;
  readonly projectionAssumptions: readonly string[];
  readonly dataCompleteness: {
    readonly termsComplete: boolean;
    readonly referenceDataComplete: boolean;
    readonly earlyRedemptionTermsComplete: boolean;
  };
  readonly missing: readonly MissingObservation[];
  readonly valuationComplete: boolean;
}

export class BondEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BondEngineError";
  }
}
