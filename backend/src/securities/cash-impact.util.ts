import { InvestmentAction } from "./entities/investment-transaction.entity";
import {
  calculateContractCashImpact,
  investmentActionsWhere,
} from "./investment-action.contract";

export const EMBEDDED_INVESTMENT_SPLIT_ACTIONS: ReadonlySet<InvestmentAction> =
  new Set(investmentActionsWhere((state) => state.supportsEmbeddedSplit));

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
 *
 * The action classification lives in `investment-action.contract.ts`; adding a
 * new enum member without a cash formula fails the financial-invariant gate.
 */
export function computeInvestmentCashImpact(
  action: InvestmentAction,
  quantity: number,
  price: number,
  commission: number,
): number {
  return calculateContractCashImpact(action, quantity, price, commission);
}
