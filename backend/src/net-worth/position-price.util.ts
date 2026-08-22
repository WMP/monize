import { priceAsOf, PricePoint } from "../common/time-series/price-boundary.util";

export { PricePoint } from "../common/time-series/price-boundary.util";

/**
 * The raw close valuing a held position on `date`, from the accepted price
 * store, with a legacy transaction-derived fallback.
 *
 * **`skipPriceUpdates` does not appear here, and must not.** That flag governs
 * whether Monize fetches external provider prices for a security; it says
 * nothing about which stored observations are eligible to value a position.
 * Valuing a skip-flagged security from its transaction prices while ignoring a
 * manually entered `security_prices` row is issue #1242: a 401(k) whose latest
 * accepted close was $120 kept reporting $61 on every historical chart.
 *
 * `stored` is the accepted price store (`security_prices.close_price`): provider
 * quotes, imports, manual corrections, and transaction-derived observations all
 * land there, one row per `(security_id, price_date)` with source precedence
 * (manual/provider over transaction-derived) already applied at write time
 * (`SecurityPriceService`). So whenever `stored` can answer for `date` it is
 * authoritative, and same-day precedence is whatever `security_prices` recorded
 * -- there is deliberately no second precedence rule reimplemented here.
 *
 * `txFallback` is a legacy compatibility source: transaction-derived prices read
 * directly from `investment_transactions`. Every accepted transaction
 * observation is normally mirrored into `security_prices`
 * (`upsertTransactionPrice` on every investment-transaction mutation,
 * `backfillTransactionPrices` on import), so callers populate this **only** for
 * securities that have no `security_prices` row at all -- chiefly a backup taken
 * before transaction-derived `security_prices` existed and restored without a
 * price backfill. It is used only when `stored` cannot answer, so an accepted
 * price always wins.
 *
 * Neither source is read past `date`: `priceAsOf` returns the most recent
 * observation at or before it, so a future close never values an earlier day.
 * Both series must be sorted oldest-first (as loaded `ORDER BY ... price_date`).
 *
 * Uses raw `close_price`, never `adjusted_close`: adjusted prices belong to
 * return-series calculations, not point-in-time position market value.
 */
export function positionCloseAsOf(
  stored: PricePoint[] | undefined,
  txFallback: PricePoint[] | undefined,
  date: string,
): number | null {
  if (stored && stored.length > 0) {
    const close = priceAsOf(stored, date);
    if (close !== null) return close;
  }
  if (txFallback && txFallback.length > 0) {
    return priceAsOf(txFallback, date);
  }
  return null;
}
