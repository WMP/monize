import { compareYMD, daysBetween, isValidYMD } from "../domain/calendar-date";
import { ExactDecimal } from "../domain/exact-decimal";
import { buildSchedule, SchedulePeriod } from "../domain/period-schedule";
import {
  baseAt,
  compounds,
  couponOf,
  maturityValue,
  nominalOf,
  roundMoney,
  valueAt,
} from "./accrual";
import {
  BondEngineError,
  BondEngineInput,
  BondValuation,
  CashFlow,
  EarlyRedemptionRefusal,
  MissingObservation,
} from "./bond-engine-types";
import { PeriodRate, resolvePeriodRates } from "./rate-resolution";
import {
  proceedsPerBond,
  referencedCalendarIds,
  windowRefusal,
} from "./redemption";

export * from "./bond-engine-types";

interface RateInputs {
  readonly prior: readonly ExactDecimal[];
  readonly rate: ExactDecimal;
}

/**
 * The rates the formulas of period `k` need, or null when one is unknown. A
 * compounding bond needs periods 1..k; a coupon bond only period k.
 */
function inputsFor(
  compounding: boolean,
  rates: readonly PeriodRate[],
  k: number,
): RateInputs | null {
  const current = rates[k - 1].rate;
  if (current === null) return null;
  if (!compounding) return { prior: [], rate: current };
  const prior: ExactDecimal[] = [];
  for (const earlier of rates.slice(0, k - 1)) {
    if (earlier.rate === null) return null;
    prior.push(earlier.rate);
  }
  return { prior, rate: current };
}

function validate(input: BondEngineInput): void {
  const { quantity, purchaseDate } = input.lot;
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new BondEngineError(
      `Quantity must be a positive integer: ${quantity}`,
    );
  }
  if (!isValidYMD(purchaseDate) || !isValidYMD(input.asOf)) {
    throw new BondEngineError("purchaseDate and asOf must be YYYY-MM-DD dates");
  }
  if (compareYMD(input.asOf, purchaseDate) < 0) {
    throw new BondEngineError(
      `asOf ${input.asOf} is before the purchase date ${purchaseDate}`,
    );
  }
}

/** Observations a value needs: every started period when compounding, else the current one. */
function neededMissing(
  compounding: boolean,
  rates: readonly PeriodRate[],
  startedCount: number,
  currentIndex: number | null,
): readonly MissingObservation[] {
  const wanted = compounding
    ? rates.slice(0, startedCount)
    : currentIndex === null
      ? []
      : rates.slice(currentIndex - 1, currentIndex);
  const seen = new Set<string>();
  const missing: MissingObservation[] = [];
  for (const entry of wanted) {
    const m = entry.missing;
    if (m && !seen.has(`${m.benchmarkId}|${m.observation}`)) {
      seen.add(`${m.benchmarkId}|${m.observation}`);
      missing.push(m);
    }
  }
  return missing;
}

/**
 * Value one holding lot (spec 2.4 to 2.6). All arithmetic is exact; rounding is
 * applied only where the terms round, per bond, and the lot is that amount times
 * the quantity.
 */
export function valueBondLot(input: BondEngineInput): BondValuation {
  validate(input);
  const { terms, asOf } = input;
  const compounding = compounds(terms);
  const schedule = buildSchedule(
    input.lot.purchaseDate,
    terms.schedule.periodCount,
    terms.schedule.periodMonths,
  );
  const lastPeriod = schedule[schedule.length - 1];
  const maturity = lastPeriod.end;
  const { rates, assumptions } = resolvePeriodRates(input, schedule);

  const quantity = ExactDecimal.fromInt(input.lot.quantity);
  const nominal = nominalOf(terms);
  const places = terms.rounding.moneyDecimals;
  const lot = (perBond: ExactDecimal) => perBond.mul(quantity).toFixed(places);

  const matured = compareYMD(asOf, maturity) >= 0;
  const current: SchedulePeriod | null = matured
    ? null
    : (schedule.find(
        (p) => compareYMD(p.start, asOf) <= 0 && compareYMD(asOf, p.end) < 0,
      ) ?? null);
  const currentRate = current ? rates[current.index - 1] : null;

  let principal: string | null = null;
  let accrued: string | null = null;
  let gross: string | null = null;
  let early: string | null = null;
  let refusal: EarlyRedemptionRefusal | null = windowRefusal(
    terms,
    input.calendars,
    input.lot.purchaseDate,
    asOf,
    current,
    maturity,
  );

  if (matured) {
    const inputs = inputsFor(compounding, rates, lastPeriod.index);
    if (inputs) {
      const perBond = compounding
        ? maturityValue(terms, inputs.prior, inputs.rate)
        : nominal;
      principal = perBond.toFixed(places);
      gross = lot(perBond);
      accrued = lot(perBond.sub(nominal));
    }
  } else if (current) {
    const inputs = inputsFor(compounding, rates, current.index);
    if (inputs) {
      const accruedDays = daysBetween(current.start, asOf);
      const value = valueAt(
        terms,
        inputs.prior,
        inputs.rate,
        accruedDays,
        current.days,
      );
      const grossBond = roundMoney(terms, value);
      principal = roundMoney(terms, baseAt(terms, inputs.prior)).toFixed(
        places,
      );
      gross = lot(grossBond);
      accrued = lot(grossBond.sub(nominal));
      if (refusal === null)
        early = lot(
          proceedsPerBond(
            terms,
            value,
            baseAt(terms, inputs.prior),
            current.index,
          ),
        );
    } else if (refusal === null) {
      refusal = "RATE_UNKNOWN";
    }
  }

  const isProjected = (k: number) => rates[k - 1].source === "PROJECTED";
  const maturityInputs = inputsFor(compounding, rates, lastPeriod.index);
  const maturityProjected = compounding
    ? rates.some((r) => r.source === "PROJECTED")
    : isProjected(lastPeriod.index);
  const maturityPerBond = maturityInputs
    ? maturityValue(terms, maturityInputs.prior, maturityInputs.rate)
    : null;

  const cashflows: CashFlow[] = [];
  const flow = (
    period: SchedulePeriod,
    type: CashFlow["type"],
    perBond: ExactDecimal,
    projected: boolean,
  ): CashFlow => ({
    date: period.end,
    type,
    amount: lot(perBond),
    status: projected ? "PROJECTED" : "KNOWN",
    period: period.index,
  });
  if (!compounding) {
    for (const period of schedule) {
      const rate = rates[period.index - 1].rate;
      if (compareYMD(period.end, asOf) <= 0 || rate === null) continue;
      const coupon = couponOf(terms, rate);
      if (coupon)
        cashflows.push(
          flow(period, "INTEREST", coupon, isProjected(period.index)),
        );
    }
    if (!matured) cashflows.push(flow(lastPeriod, "PRINCIPAL", nominal, false));
  } else if (!matured && maturityPerBond) {
    cashflows.push(
      flow(lastPeriod, "PRINCIPAL", maturityPerBond, maturityProjected),
    );
  }

  const startedCount = matured
    ? schedule.length
    : schedule.filter((p) => compareYMD(p.start, asOf) <= 0).length;
  const missing = neededMissing(
    compounding,
    rates,
    startedCount,
    current?.index ?? null,
  );

  const calendarsKnown = [...referencedCalendarIds(terms)].every((id) =>
    input.calendars.has(id),
  );
  const earlyTermsComplete =
    terms.redemption.type !== "ON_DEMAND" ||
    terms.redemption.blackouts.every((b) => input.calendars.has(b.calendarId));
  const dataCompleteness = {
    termsComplete: calendarsKnown,
    referenceDataComplete: missing.length === 0,
    earlyRedemptionTermsComplete: earlyTermsComplete,
  };

  return {
    asOf,
    seriesCode: terms.instrument.seriesCode,
    termsVersion: input.termsVersion,
    quantity: input.lot.quantity,
    maturityDate: maturity,
    currentPeriod:
      current && currentRate?.rate && currentRate.source
        ? {
            index: current.index,
            start: current.start,
            end: current.end,
            annualRate: currentRate.rate.toTrimmedString(10, 4),
            rateSource: currentRate.source,
          }
        : null,
    principal,
    accruedInterest: accrued,
    grossValue: gross,
    earlyRedemptionValue: early,
    earlyRedemptionRefusal: refusal,
    knownCashflows: cashflows.filter((c) => c.status === "KNOWN"),
    projectedCashflows: cashflows.filter((c) => c.status === "PROJECTED"),
    maturityValueKnown:
      maturityPerBond && !maturityProjected ? lot(maturityPerBond) : null,
    maturityValueProjected:
      maturityPerBond && maturityProjected ? lot(maturityPerBond) : null,
    projectionAssumptions: assumptions,
    dataCompleteness,
    missing,
    valuationComplete: Object.values(dataCompleteness).every(Boolean),
  };
}
