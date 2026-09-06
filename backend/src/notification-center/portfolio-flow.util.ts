import { roundMoney } from "../common/round.util";

/** One currency's external-flow subtotal, in that currency. */
export interface FlowSubtotal {
  currency: string;
  amount: number;
}

/** The external flow converted into the reporting currency, with completeness. */
export interface FoldedFlow {
  /** False when any subtotal could not be converted (a missing rate). */
  complete: boolean;
  /** The net external flow in the reporting currency (0 when complete and empty). */
  value: number;
  /** `"EUR->USD"` for each pair with no rate; empty when complete. */
  missingPairs: string[];
}

/**
 * Fold the per-currency external-flow subtotals into one figure in the reporting
 * currency. A subtotal with no rate makes the whole flow **incomplete** (the
 * movement is then unknown and withheld, INV-PORTMOVE-002) rather than dropping
 * that currency and reporting a subtotal as a total. `rateFor` returns the rate
 * from a currency into the reporting currency, or `null` when none is known
 * (and 1 for the reporting currency itself).
 *
 * Pure so the completeness policy is testable without the rate service or a
 * database.
 */
export function foldExternalFlow(
  subtotals: FlowSubtotal[],
  reportingCurrency: string,
  rateFor: (currency: string) => number | null,
): FoldedFlow {
  const missingPairs: string[] = [];
  let value = 0;
  for (const { currency, amount } of subtotals) {
    if (amount === 0) continue;
    const rate = currency === reportingCurrency ? 1 : rateFor(currency);
    if (rate === null || !(rate > 0)) {
      missingPairs.push(`${currency}->${reportingCurrency}`);
      continue;
    }
    value += amount * rate;
  }
  return {
    complete: missingPairs.length === 0,
    value: roundMoney(value),
    missingPairs,
  };
}
