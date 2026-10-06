import { roundMoney, roundToDecimals, sumMoney } from "./round.util";

/**
 * The number of decimals a currency's smallest unit has: 2 for EUR (cents),
 * 0 for JPY. What money a bank actually moves is booked at.
 *
 * Read from `Intl` exactly as the client's `getDecimalPlacesForCurrency`
 * (`frontend/src/lib/format.ts`) reads it, so a figure the Post dialog shows
 * and the figure the server books round to the same unit. An unknown or
 * missing code falls back to 2, as the client does.
 */
export function currencyMinorUnitDecimals(
  currencyCode: string | null | undefined,
): number {
  if (!currencyCode) return 2;
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

/**
 * Book a split set in a currency's smallest unit (issue #1581).
 *
 * Amounts are priced at storage precision (4dp): a LINEAR mortgage's
 * installment is 864.5833 + 306.0625 = 1,170.6458. The bank debits whole
 * cents, so the posted transaction carries the parent rounded to the unit
 * (1,170.65), every line rounded to the unit, and the difference the line
 * roundings leave (here +0.01) on the line at `absorbIndex` (864.59), so the
 * lines sum to the parent exactly and the split validator's 4dp equality
 * holds.
 *
 * Mirrored by `bookSplitsAtMinorUnit` in `frontend/src/lib/minor-unit-booking.ts`;
 * the two must return the same figures for the same input, because the
 * server recognises an unchanged Post dialog by comparing what it sent with
 * this function's answer for the stored template.
 */
export function bookSplitsAtMinorUnit(
  amounts: readonly number[],
  parentAmount: number,
  decimals: number,
  absorbIndex: number,
): { amounts: number[]; parentAmount: number } {
  const parent = roundToDecimals(Number(parentAmount), decimals);
  const rounded = amounts.map((amount) =>
    roundToDecimals(Number(amount), decimals),
  );
  if (absorbIndex < 0 || absorbIndex >= rounded.length) {
    return { amounts: rounded, parentAmount: parent };
  }
  const residual = roundMoney(parent - sumMoney(rounded));
  return {
    amounts: rounded.map((amount, index) =>
      index === absorbIndex ? roundMoney(amount + residual) : amount,
    ),
    parentAmount: parent,
  };
}
