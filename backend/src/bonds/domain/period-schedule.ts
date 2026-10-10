import { addMonthsClamped, daysBetween } from "./calendar-date";

export interface SchedulePeriod {
  /** 1-based. */
  readonly index: number;
  readonly start: string;
  readonly end: string;
  /** Actual days, start inclusive, end exclusive (ACT or D in the letters). */
  readonly days: number;
}

/**
 * Periods are anchored on the lot's purchase date (spec 2.3); every boundary is
 * computed from the purchase date, so a 31st does not drift down after February.
 * Maturity is `end` of the last period.
 */
export function buildSchedule(
  purchaseDate: string,
  periodCount: number,
  periodMonths: number,
): readonly SchedulePeriod[] {
  if (!Number.isInteger(periodCount) || periodCount < 1) {
    throw new RangeError(`Invalid period count: ${periodCount}`);
  }
  if (!Number.isInteger(periodMonths) || periodMonths < 1) {
    throw new RangeError(`Invalid period length in months: ${periodMonths}`);
  }
  return Array.from({ length: periodCount }, (_unused, i) => {
    const start = addMonthsClamped(purchaseDate, i * periodMonths);
    const end = addMonthsClamped(purchaseDate, (i + 1) * periodMonths);
    return { index: i + 1, start, end, days: daysBetween(start, end) };
  });
}
