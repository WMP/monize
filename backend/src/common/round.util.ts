/**
 * Round a number to the specified decimal places using "round half away
 * from zero" (standard financial rounding).
 *
 * Uses string-based decimal shifting instead of multiplication to avoid
 * IEEE 754 midpoint errors. JavaScript's number-to-string conversion
 * produces the shortest decimal that round-trips to the same double,
 * recovering the intended value (e.g., 159.735 not 159.73499...).
 * Shifting via string concatenation ('e+N') sidesteps the floating-point
 * error that direct multiplication would introduce.
 *
 * An additional one-ULP nudge (Number.EPSILON * abs) is applied before
 * rounding to recover values that fell just below a midpoint due to
 * IEEE 754 multiplication error (e.g., 10 * 15.9735 = 159.73499... in
 * IEEE 754 but should round as 159.735 -> 159.74). The nudge is smaller
 * than any legitimate distance from a midpoint in financial arithmetic.
 *
 * Examples:
 *   roundToDecimals(159.735, 2)       => 159.74   (not 159.73)
 *   roundToDecimals(10 * 15.9735, 2)  => 159.74   (not 159.73)
 *   roundToDecimals(-159.735, 2)      => -159.74  (not -159.73)
 *   roundToDecimals(1.005, 2)         => 1.01     (not 1.00)
 */
export function roundToDecimals(value: number, decimalPlaces: number): number {
  if (!isFinite(value)) return value;
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  const nudged = abs + Number.EPSILON * abs;
  return (
    sign *
    Number(
      Math.round(Number(nudged + "e" + decimalPlaces)) + "e-" + decimalPlaces,
    )
  );
}

/**
 * Number of decimal places money is stored at in PostgreSQL (`decimal(20,4)`).
 * All monetary aggregation in JS rounds to this precision so derived totals
 * stay consistent with the ledger; values are only rounded to a currency's
 * display precision (typically 2dp) at the formatting layer.
 */
export const MONEY_DECIMALS = 4;

/**
 * Round a monetary value to the canonical storage precision (4 decimals).
 *
 * This is the single helper every service should use for money rounding,
 * replacing the various ad-hoc `Math.round(x * 100) / 100` (2dp) and
 * `Math.round(x * 10000) / 10000` (4dp) snippets that previously diverged
 * across the codebase. Built on `roundToDecimals`, so it also fixes the
 * IEEE 754 midpoint errors those naive snippets had.
 */
export function roundMoney(value: number): number {
  return roundToDecimals(value, MONEY_DECIMALS);
}

/**
 * Sum an array of monetary values without floating-point drift by accumulating
 * in integer "ten-thousandths" (the 4dp storage unit) and converting back.
 *
 * Prefer this over `values.reduce((s, v) => s + v, 0)` for money: naive float
 * accumulation lets sub-cent errors compound across many rows. Non-finite
 * entries (NaN/Infinity) contribute 0.
 *
 * Examples:
 *   sumMoney([0.1, 0.2])            => 0.3      (not 0.30000000000000004)
 *   sumMoney([10.0001, 20.0002])   => 30.0003
 */
export function sumMoney(values: number[]): number {
  const scale = 10 ** MONEY_DECIMALS;
  const totalUnits = values.reduce((sum, v) => {
    if (!isFinite(v)) return sum;
    return sum + Math.round(v * scale);
  }, 0);
  return totalUnits / scale;
}

