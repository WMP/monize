/**
 * The two share-price conversions the scheduled-investment dialogs share: given
 * a price, derive the total from a quantity, or the quantity from a total. Kept
 * in one place so the post dialog and the override editor cannot drift on the
 * rounding scale or the signed commission -- only on *which* of the two they
 * choose to run, which is a per-surface decision (see each call site) and is
 * deliberately not encoded here.
 *
 * `sign` is +1 for a buy-side action and -1 for a SELL, matching how the
 * commission moves the cash total (a buy costs price + commission; a sell nets
 * price - commission).
 */

/** Total cash for `quantity` shares at `price`, commission folded in, at money precision. */
export function totalFromQuantity(
  quantity: number,
  price: number,
  sign: number,
  commission: number,
): number {
  return Math.round((quantity * price + sign * commission) * 10_000) / 10_000;
}

/**
 * Shares that `total` buys at `price` once the commission is backed out, never
 * negative, at share precision (8dp). A non-positive price yields 0 rather than
 * a division blow-up; callers gate on `price > 0` before offering it, so this is
 * belt and braces.
 */
export function quantityFromTotal(
  total: number,
  price: number,
  sign: number,
  commission: number,
): number {
  if (!(price > 0)) return 0;
  const cost = total - sign * commission;
  const qty = Math.max(0, cost / price);
  return Math.round(qty * 100_000_000) / 100_000_000;
}
