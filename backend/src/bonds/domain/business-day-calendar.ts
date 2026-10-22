import { addDays } from "./calendar-date";

/** A country's working-day rule; supplied by an adapter, never known to the engine. */
export interface BusinessDayCalendar {
  readonly id: string;
  isBusinessDay(ymd: string): boolean;
}

/** The n-th business day strictly before `date` (n >= 1). */
export function nthBusinessDayBefore(
  calendar: BusinessDayCalendar,
  date: string,
  n: number,
): string {
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError(`Invalid business day count: ${n}`);
  }
  let cursor = date;
  let counted = 0;
  while (counted < n) {
    cursor = addDays(cursor, -1);
    if (calendar.isBusinessDay(cursor)) counted += 1;
  }
  return cursor;
}
