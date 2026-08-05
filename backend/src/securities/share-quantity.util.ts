import { InvestmentAction } from "./entities/investment-transaction.entity";

/**
 * Apply one investment transaction's effect on a running share count.
 *
 * This is the single source of truth for "what does this action do to the
 * quantity held". Every replay of investment history -- current holdings, a
 * historical net-worth series, a validation sweep -- must go through it,
 * because the actions do not all mean the same kind of arithmetic:
 *
 * - `BUY` / `REINVEST` / `TRANSFER_IN` / `ADD_SHARES` add shares.
 * - `SELL` / `TRANSFER_OUT` / `REMOVE_SHARES` remove shares.
 * - **`SPLIT` carries a ratio, not a share count**, so it multiplies. A 2-for-1
 *   split is stored as `2.0`, and 90 shares become 180 -- not 92. Adding the
 *   ratio instead of multiplying by it is the defect this helper exists to make
 *   impossible: `net-worth.service` spelled the switch out three times and got
 *   `SPLIT` wrong in all three, while `holdings.service` had it right, so the
 *   holdings page and the net-worth chart disagreed about the same history.
 * - `DIVIDEND` / `INTEREST` / `CAPITAL_GAIN` move cash, not shares.
 *
 * A non-positive split ratio is ignored rather than zeroing the position: a
 * `0` or negative ratio is not a representable corporate action, and treating
 * it as one would silently destroy a holding.
 *
 * Cost basis is deliberately not handled here. A split preserves total basis
 * while changing the per-share figure, and a sale consumes basis at the average
 * cost, so callers that track basis keep that arithmetic beside their own
 * accumulator -- but they still take the quantity from this function.
 */
export function applyShareAction(
  current: number,
  action: InvestmentAction | string,
  quantity: number,
): number {
  switch (action) {
    case InvestmentAction.BUY:
    case InvestmentAction.REINVEST:
    case InvestmentAction.TRANSFER_IN:
    case InvestmentAction.ADD_SHARES:
      return current + quantity;
    case InvestmentAction.SELL:
    case InvestmentAction.TRANSFER_OUT:
    case InvestmentAction.REMOVE_SHARES:
      return current - quantity;
    case InvestmentAction.SPLIT:
      return quantity > 0 ? current * quantity : current;
    default:
      // DIVIDEND / INTEREST / CAPITAL_GAIN do not move shares.
      return current;
  }
}

/**
 * True when the action changes the share count at all. Callers that need to
 * skip cash-only rows before doing per-row work use this rather than
 * re-listing the actions.
 */
export function movesShares(action: InvestmentAction | string): boolean {
  return (
    action === InvestmentAction.BUY ||
    action === InvestmentAction.REINVEST ||
    action === InvestmentAction.TRANSFER_IN ||
    action === InvestmentAction.ADD_SHARES ||
    action === InvestmentAction.SELL ||
    action === InvestmentAction.TRANSFER_OUT ||
    action === InvestmentAction.REMOVE_SHARES ||
    action === InvestmentAction.SPLIT
  );
}
