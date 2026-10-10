import { assertNever } from "../domain/assert-never";
import { BenchmarkData } from "../domain/benchmark";
import { nthBusinessDayBefore } from "../domain/business-day-calendar";
import { ObservationRule, RateRule } from "../domain/bond-terms";
import {
  compareYMD,
  firstOfMonth,
  monthKeyBefore,
} from "../domain/calendar-date";
import { ExactDecimal } from "../domain/exact-decimal";
import { SchedulePeriod } from "../domain/period-schedule";
import {
  BondEngineError,
  BondEngineInput,
  MissingObservation,
  RateSource,
} from "./bond-engine-types";

export interface PeriodRate {
  readonly period: SchedulePeriod;
  readonly rate: ExactDecimal | null;
  readonly source: RateSource | null;
  /** Set when the rate is null and the cause is a missing observation. */
  readonly missing: MissingObservation | null;
}

export interface RateResolution {
  readonly rates: readonly PeriodRate[];
  readonly assumptions: readonly string[];
}

type BenchmarkRule = Exclude<RateRule, { type: "FIXED" }>;

function parseDecimal(value: string, what: string): ExactDecimal {
  try {
    return ExactDecimal.parse(value);
  } catch {
    throw new BondEngineError(
      `${what} is not a decimal string: ${String(value)}`,
    );
  }
}

/** The value as the fraction it is stored as, e.g. 0.0290. */
function fraction(value: ExactDecimal): string {
  return value.toTrimmedString(10, 4);
}

function addendOf(rule: BenchmarkRule): ExactDecimal {
  switch (rule.type) {
    case "BENCHMARK_PLUS_SPREAD":
      return parseDecimal(rule.spread, "spread");
    case "INFLATION_PLUS_MARGIN_AS_RATE":
      return parseDecimal(rule.margin, "margin");
    default:
      return assertNever(rule);
  }
}

/** max(floor, benchmark) + addend: the floor keeps a negative benchmark out of the rate. */
function flooredRate(
  rule: BenchmarkRule,
  benchmark: ExactDecimal,
): ExactDecimal {
  const floor =
    rule.benchmarkFloor === null
      ? benchmark
      : parseDecimal(rule.benchmarkFloor, "floor");
  return ExactDecimal.max(floor, benchmark).add(addendOf(rule));
}

function newestStep(
  data: Extract<BenchmarkData, { kind: "STEP" }>,
  onOrBefore?: string,
) {
  let newest: (typeof data.changes)[number] | null = null;
  for (const change of data.changes) {
    if (
      onOrBefore !== undefined &&
      compareYMD(change.effectiveFrom, onOrBefore) > 0
    )
      continue;
    if (
      newest === null ||
      compareYMD(change.effectiveFrom, newest.effectiveFrom) > 0
    ) {
      newest = change;
    }
  }
  return newest;
}

interface Observation {
  readonly value: ExactDecimal | null;
  readonly missing: MissingObservation;
}

/** What the rule observes for `period`; null when a calendar it needs is unknown. */
function observe(
  rule: BenchmarkRule,
  period: SchedulePeriod,
  input: BondEngineInput,
): Observation | null {
  const data = input.benchmarks.get(rule.benchmarkId);
  const publisher = data ? data.publisher : null;
  const observation: ObservationRule = rule.observation;
  switch (observation.type) {
    case "STEP_VALUE_ON_NTH_BUSINESS_DAY_BEFORE_START_MONTH": {
      const calendar = input.calendars.get(observation.calendarId);
      if (!calendar) return null;
      const day = nthBusinessDayBefore(
        calendar,
        firstOfMonth(period.start),
        observation.businessDays,
      );
      const missing = {
        benchmarkId: rule.benchmarkId,
        observation: day,
        publisher,
      };
      if (
        !data ||
        data.kind !== "STEP" ||
        data.coveredThrough === null ||
        compareYMD(day, data.coveredThrough) > 0
      ) {
        return { value: null, missing };
      }
      const change = newestStep(data, day);
      return {
        value: change
          ? parseDecimal(
              change.value,
              `${rule.benchmarkId} ${change.effectiveFrom}`,
            )
          : null,
        missing,
      };
    }
    case "MONTHLY_VALUE_MONTHS_BEFORE_START": {
      const key = monthKeyBefore(period.start, observation.months);
      const stored =
        data && data.kind === "MONTHLY" ? data.values.get(key) : undefined;
      return {
        value:
          stored === undefined
            ? null
            : parseDecimal(stored, `${rule.benchmarkId} ${key}`),
        missing: { benchmarkId: rule.benchmarkId, observation: key, publisher },
      };
    }
    default:
      return assertNever(observation);
  }
}

interface Assumption {
  readonly value: ExactDecimal;
  readonly text: string;
}

/** The supplied assumption, else the newest stored observation, else none. */
function projectionAssumption(
  rule: BenchmarkRule,
  input: BondEngineInput,
): Assumption | null {
  const id = rule.benchmarkId;
  const suffix = "assumed for every later period";
  const supplied = input.projection?.get(id);
  if (supplied !== undefined) {
    const value = parseDecimal(supplied, `Projection assumption for ${id}`);
    return {
      value,
      text: `${id} = ${fraction(value)} (supplied assumption), ${suffix}`,
    };
  }
  const data = input.benchmarks.get(id);
  if (!data) return null;
  let at: string;
  let raw: string;
  if (data.kind === "STEP") {
    const newest = newestStep(data);
    if (!newest) return null;
    [at, raw] = [newest.effectiveFrom, newest.value];
  } else {
    const keys = [...data.values.keys()].sort();
    if (keys.length === 0) return null;
    [at, raw] = [
      keys[keys.length - 1],
      data.values.get(keys[keys.length - 1])!,
    ];
  }
  const value = parseDecimal(raw, `${id} ${at}`);
  return { value, text: `${id} = ${fraction(value)} (${at}), ${suffix}` };
}

/**
 * The rate of every period by the spec section 4 truth table: a fixed rate and a
 * stated first-period rate come from the terms, an announced rate wins,
 * otherwise the rate is derived from the stored observation. With none, a
 * period that has started has no rate (INV-BOND-002) and one that has not is
 * projected from an assumption.
 */
export function resolvePeriodRates(
  input: BondEngineInput,
  schedule: readonly SchedulePeriod[],
): RateResolution {
  const rule = input.terms.rateRule;
  const assumption =
    rule.type === "FIXED" ? null : projectionAssumption(rule, input);
  let usedAssumption = false;

  const rates = schedule.map((period): PeriodRate => {
    const known = (rate: ExactDecimal, source: RateSource): PeriodRate => ({
      period,
      rate,
      source,
      missing: null,
    });
    const unknown = (missing: MissingObservation | null): PeriodRate => ({
      period,
      rate: null,
      source: null,
      missing,
    });
    if (rule.type === "FIXED")
      return known(parseDecimal(rule.annualRate, "annualRate"), "TERMS");
    if (period.index === 1 && rule.firstPeriodRate !== null) {
      return known(
        parseDecimal(rule.firstPeriodRate, "firstPeriodRate"),
        "TERMS",
      );
    }
    const announced = input.announcedRates.get(period.index);
    if (announced !== undefined) {
      return known(
        parseDecimal(announced, `Announced rate ${period.index}`),
        "ANNOUNCED",
      );
    }
    const observation = observe(rule, period, input);
    if (observation === null) return unknown(null);
    if (observation.value !== null) {
      return known(flooredRate(rule, observation.value), "DERIVED");
    }
    if (compareYMD(period.start, input.asOf) <= 0)
      return unknown(observation.missing);
    if (assumption === null) return unknown(null);
    usedAssumption = true;
    return known(flooredRate(rule, assumption.value), "PROJECTED");
  });

  return {
    rates,
    assumptions: usedAssumption && assumption ? [assumption.text] : [],
  };
}
