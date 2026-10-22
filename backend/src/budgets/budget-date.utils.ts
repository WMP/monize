/**
 * Shared utility for computing budget period date ranges.
 * Centralizes the period date calculation used across multiple budget services.
 */

export interface PeriodDateRange {
  periodStart: string;
  periodEnd: string;
}

/**
 * Returns the start and end dates for the current calendar month
 * in YYYY-MM-DD format.
 */
export function getCurrentMonthPeriodDates(): PeriodDateRange {
  const today = new Date();
  return getMonthPeriodDates(today.getUTCFullYear(), today.getUTCMonth());
}

/**
 * Returns the start and end dates for a specific calendar month.
 * @param year - Full year (e.g. 2026)
 * @param monthIndex - Zero-based month index (0 = January, 11 = December)
 */
export function getMonthPeriodDates(
  year: number,
  monthIndex: number,
): PeriodDateRange {
  const month = monthIndex + 1;
  const lastDay = new Date(year, month, 0).getDate();

  const periodStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const periodEnd = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  return { periodStart, periodEnd };
}

/**
 * Returns the start and end dates for the previous calendar month
 * relative to today.
 */
export function getPreviousMonthPeriodDates(): PeriodDateRange {
  const today = new Date();
  const prevMonth = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1),
  );
  return getMonthPeriodDates(
    prevMonth.getUTCFullYear(),
    prevMonth.getUTCMonth(),
  );
}

/**
 * The calendar month after the one `periodEnd` (YYYY-MM-DD) falls in: the
 * period that follows a closed one. Derived from the closed period, never from
 * the wall clock, so a close before the period ends (or a cron that runs late)
 * still opens the next month rather than colliding with the month it closed
 * (audit A26-L38).
 */
export function getFollowingMonthPeriodDates(
  periodEnd: string,
): PeriodDateRange {
  const [year, month] = periodEnd.split("-").map(Number);
  // `month` is 1-based, so as a zero-based index it already names the next one.
  const next = new Date(Date.UTC(year, month, 1));
  return getMonthPeriodDates(next.getUTCFullYear(), next.getUTCMonth());
}

/**
 * Parses a YYYY-MM string and returns the corresponding period dates.
 * Returns null if the format is invalid.
 */
export function parsePeriodFromYYYYMM(
  yearMonth: string,
): PeriodDateRange | null {
  const match = /^(\d{4})-(\d{2})$/.exec(yearMonth);
  if (!match) return null;

  const year = parseInt(match[1], 10);
  const monthIndex = parseInt(match[2], 10) - 1;

  if (monthIndex < 0 || monthIndex > 11) return null;

  return getMonthPeriodDates(year, monthIndex);
}
