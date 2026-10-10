import { assertNever } from "../domain/assert-never";
import { BondTerms } from "../domain/bond-terms";
import { ExactDecimal } from "../domain/exact-decimal";

/**
 * Per-bond amounts from the primitives of the terms. Every amount is for ONE
 * bond; `priorRates` are the rates of periods 1..k-1 (empty unless the bond
 * compounds) and `rate` is period k's annual rate.
 */

export function nominalOf(terms: BondTerms): ExactDecimal {
  switch (terms.principalRule.type) {
    case "FIXED_NOMINAL":
      return ExactDecimal.parse(terms.instrument.faceValue);
    default:
      return assertNever(terms.principalRule.type);
  }
}

export function roundMoney(
  terms: BondTerms,
  value: ExactDecimal,
): ExactDecimal {
  return value.roundHalfUp(terms.rounding.moneyDecimals);
}

/** True when the value of period k depends on the rates of the periods before it. */
export function compounds(terms: BondTerms): boolean {
  switch (terms.capitalization.type) {
    case "NONE":
      return false;
    case "COMPOUND_AT_PERIOD_END":
      return true;
    default:
      return assertNever(terms.capitalization);
  }
}

/** Periods per year, F = 12 / periodMonths. */
function periodsPerYear(terms: BondTerms): ExactDecimal {
  return ExactDecimal.fromInt(12 / terms.schedule.periodMonths);
}

/** The share of a period's interest earned after `a` of its `D` days. */
function accruedFraction(
  terms: BondTerms,
  accruedDays: number,
  periodDays: number,
): ExactDecimal {
  switch (terms.accrual.type) {
    case "ACTUAL_DAYS_IN_PERIOD":
      return ExactDecimal.ratio(accruedDays, periodDays);
    default:
      return assertNever(terms.accrual.type);
  }
}

/** The rate earned over one whole period, r / F. */
function periodRate(terms: BondTerms, rate: ExactDecimal): ExactDecimal {
  return rate.div(periodsPerYear(terms));
}

function compoundedNominal(
  terms: BondTerms,
  rates: readonly ExactDecimal[],
): ExactDecimal {
  return rates.reduce(
    (base, rate) => base.mul(ExactDecimal.ONE.add(periodRate(terms, rate))),
    nominalOf(terms),
  );
}

/** The base interest accrues on at the start of period k. */
export function baseAt(
  terms: BondTerms,
  priorRates: readonly ExactDecimal[],
): ExactDecimal {
  const capitalization = terms.capitalization;
  switch (capitalization.type) {
    case "NONE":
      return nominalOf(terms);
    case "COMPOUND_AT_PERIOD_END": {
      const base = compoundedNominal(terms, priorRates);
      return capitalization.baseRounding === "PER_PERIOD"
        ? roundMoney(terms, base)
        : base;
    }
    default:
      return assertNever(capitalization);
  }
}

/** Value on day d of period k before any penalty, unrounded. */
export function valueAt(
  terms: BondTerms,
  priorRates: readonly ExactDecimal[],
  rate: ExactDecimal,
  accruedDays: number,
  periodDays: number,
): ExactDecimal {
  const accrual = periodRate(terms, rate).mul(
    accruedFraction(terms, accruedDays, periodDays),
  );
  return baseAt(terms, priorRates).mul(ExactDecimal.ONE.add(accrual));
}

/** The coupon paid at a period end, rounded; null when interest is capitalised instead. */
export function couponOf(
  terms: BondTerms,
  rate: ExactDecimal,
): ExactDecimal | null {
  switch (terms.capitalization.type) {
    case "NONE":
      return roundMoney(terms, nominalOf(terms).mul(periodRate(terms, rate)));
    case "COMPOUND_AT_PERIOD_END":
      return null;
    default:
      return assertNever(terms.capitalization);
  }
}

/** Cash received at maturity per bond, rounded. */
export function maturityValue(
  terms: BondTerms,
  priorRates: readonly ExactDecimal[],
  rate: ExactDecimal,
): ExactDecimal {
  const coupon = couponOf(terms, rate);
  return coupon === null
    ? roundMoney(terms, compoundedNominal(terms, [...priorRates, rate]))
    : nominalOf(terms).add(coupon);
}
