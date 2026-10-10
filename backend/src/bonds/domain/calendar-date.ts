import { addDaysYMD } from "@/common/date-utils";

const YMD_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

export interface CalendarParts {
  year: number;
  month: number;
  day: number;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isValidYMD(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = YMD_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ];
  return (
    month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month)
  );
}

export function parseYMD(value: string): CalendarParts {
  if (!isValidYMD(value)) {
    throw new RangeError(`Not a calendar date (YYYY-MM-DD): ${String(value)}`);
  }
  const match = YMD_PATTERN.exec(value)!;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

export function formatYMD(year: number, month: number, day: number): string {
  const p = (n: number, width: number) => String(n).padStart(width, "0");
  return `${p(year, 4)}-${p(month, 2)}-${p(day, 2)}`;
}

function toUtcMs(value: string): number {
  const { year, month, day } = parseYMD(value);
  return Date.UTC(year, month - 1, day);
}

/** Actual days from `from` (inclusive) to `to` (exclusive); negative if `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / MS_PER_DAY);
}

export function compareYMD(a: string, b: string): -1 | 0 | 1 {
  parseYMD(a);
  parseYMD(b);
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function addDays(value: string, days: number): string {
  parseYMD(value);
  return addDaysYMD(value, days);
}

/**
 * The date `months` after `anchor`, with the day of month clamped to the target
 * month's length. Always computed from the anchor, never from a previous
 * result, so 31 Jan -> 28 Feb -> 31 Mar rather than drifting to the 28th.
 */
export function addMonthsClamped(anchor: string, months: number): string {
  const { year, month, day } = parseYMD(anchor);
  const index = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = (index % 12) + 1;
  return formatYMD(
    targetYear,
    targetMonth,
    Math.min(day, daysInMonth(targetYear, targetMonth)),
  );
}

/** Day of week, 0 = Sunday .. 6 = Saturday. */
export function dayOfWeek(value: string): number {
  return new Date(toUtcMs(value)).getUTCDay();
}

export function firstOfMonth(value: string): string {
  const { year, month } = parseYMD(value);
  return formatYMD(year, month, 1);
}

/** `YYYY-MM` of the month `months` before the month of `value`. */
export function monthKeyBefore(value: string, months: number): string {
  const { year, month } = parseYMD(value);
  const index = year * 12 + (month - 1) - months;
  return `${String(Math.floor(index / 12)).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`;
}
