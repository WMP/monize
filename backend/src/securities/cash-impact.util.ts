import { InvestmentAction } from "./entities/investment-transaction.entity";

export const EMBEDDED_INVESTMENT_SPLIT_ACTIONS: ReadonlySet<InvestmentAction> =
  new Set([
    InvestmentAction.BUY,
    InvestmentAction.SELL,
    InvestmentAction.DIVIDEND,
    InvestmentAction.INTEREST,
    InvestmentAction.CAPITAL_GAIN,
    InvestmentAction.REINVEST,
  ]);

export function isInvestmentActionAllowedInSplit(
  action: InvestmentAction,
): boolean {
  return EMBEDDED_INVESTMENT_SPLIT_ACTIONS.has(action);
}

/**
 * Signed cash impact of an investment action in the security's currency,
 * before any FX conversion. Used by transaction-split validation to ensure the
 * embedded investment split's amount matches the implied cash side.
 *
 * Negative = cash leaves the brokerage cash account (BUY).
 * Positive = cash arrives in the brokerage cash account (SELL, DIVIDEND, etc).
 * Zero     = no cash side (REINVEST and the share-only actions).
 */
export function computeInvestmentCashImpact(
  action: InvestmentAction,
  quantity: number,
  price: number,
  commission: number,
): number {
  const q = Number(quantity) || 0;
  const p = Number(price) || 0;
  const c = Number(commission) || 0;

  switch (action) {
    case InvestmentAction.BUY:
      return -(q * p + c);
    case InvestmentAction.SELL:
      return q * p - c;
    case InvestmentAction.DIVIDEND:
    case InvestmentAction.INTEREST:
    case InvestmentAction.CAPITAL_GAIN:
      return (q || 1) * p;
    case InvestmentAction.REINVEST:
      return 0;
    default:
      return 0;
  }
}
