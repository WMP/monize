import { roundToDecimals } from "./round.util";

/**
 * Deterministic `en-US` money formatting, for output read by a MACHINE.
 *
 * "Machine" means: an LLM prompt, and the English `description` an
 * action-history row stores as its fallback for a reader whose client cannot
 * localize it. Those are documented fixed-locale contracts -- a prompt wants
 * one stable representation, and a stored English sentence cannot be
 * translated after the fact.
 *
 * **Anything addressed to a person goes through `number-locale.util.ts`**
 * instead, built from that recipient's `numberFormat` / `language`. Forcing
 * `en-US` into a translated email put `zl18,812.71` inside Polish copy
 * (issue #1316); `backend/src/common/number-locale.guard.spec.ts` fails on a
 * new caller of the two helpers below outside the classified set.
 */

/**
 * Format a number as currency with the correct decimal places for the given currency code.
 * Uses Intl.NumberFormat so JPY gets 0 decimals, USD/EUR get 2, BHD gets 3, etc.
 * Pre-rounds to the currency's native decimal places to avoid IEEE 754 midpoint errors
 * (e.g., 159.735 stored as 159.73499... rounding to 159.73 instead of 159.74).
 *
 * @returns Formatted string with currency symbol (e.g., "$1,234.56", "¥1,235")
 */
export function formatCurrency(amount: number, currencyCode: string): string {
  try {
    const formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currencyCode,
      currencyDisplay: "narrowSymbol",
    });
    const decimals = formatter.resolvedOptions().minimumFractionDigits ?? 2;
    return formatter.format(roundToDecimals(amount, decimals));
  } catch {
    return `${amount.toFixed(2)}`;
  }
}

/**
 * Format a number with currency-aware decimal places but no currency symbol.
 * Useful for contexts where the symbol is shown separately.
 *
 * @returns Formatted string without symbol (e.g., "1,234.56", "1,235")
 */
export function formatCurrencyAmount(
  amount: number,
  currencyCode: string,
): string {
  const decimals = getDecimalPlacesForCurrency(currencyCode);
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);
}

/**
 * Get the number of decimal places for a currency code using Intl.NumberFormat.
 * E.g., USD=2, JPY=0, BHD=3.
 */
export function getDecimalPlacesForCurrency(currencyCode: string): number {
  try {
    return (
      new Intl.NumberFormat("en", {
        style: "currency",
        currency: currencyCode,
      }).resolvedOptions().minimumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}
