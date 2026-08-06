import { InvestmentAction } from "./entities/investment-transaction.entity";

/**
 * The canonical share-count effect of one investment action.
 *
 * Every surface that reconstructs a position from its transaction history --
 * the live holdings rebuild, the historical net-worth replay, the cost-basis
 * and capital-gains replays -- folds the same list of actions in the same
 * direction. Written out per call site the list drifts, and the drift is
 * invisible because each copy is internally consistent: three net-worth
 * reducers added a SPLIT's ratio to the share count (10 shares + a 2-for-1
 * ratio = 12) while the holdings service multiplied by it (= 20), so the same
 * position was worth 600 on the history chart and 1,000 on the holdings page.
 * The same three copies omitted ADD_SHARES and REMOVE_SHARES entirely, so
 * shares booked without a purchase never appeared in any historical chart.
 *
 * `quantity` means different things per action and that is the point of
 * centralizing it:
 * - BUY / REINVEST / TRANSFER_IN / ADD_SHARES -- shares acquired, added.
 * - SELL / TRANSFER_OUT / REMOVE_SHARES -- shares disposed of, subtracted.
 * - SPLIT -- a **ratio**, not a share count. The position is multiplied by it,
 *   which is what preserves total cost basis across a split. A 2-for-1 split
 *   carries `quantity = 2`; a 1-for-2 reverse split carries `0.5`.
 * - DIVIDEND / INTEREST / CAPITAL_GAIN -- cash only, no share movement.
 *
 * A non-positive SPLIT ratio is not applied: it would zero or invert a real
 * position, and a row that cannot say what the split was is not evidence that
 * the shares went away.
 */
export function applyActionToQuantity(
  currentQuantity: number,
  action: InvestmentAction | string,
  quantity: number,
): number {
  switch (action) {
    case InvestmentAction.BUY:
    case InvestmentAction.REINVEST:
    case InvestmentAction.TRANSFER_IN:
    case InvestmentAction.ADD_SHARES:
      return currentQuantity + quantity;
    case InvestmentAction.SELL:
    case InvestmentAction.TRANSFER_OUT:
    case InvestmentAction.REMOVE_SHARES:
      return currentQuantity - quantity;
    case InvestmentAction.SPLIT:
      return quantity > 0 ? currentQuantity * quantity : currentQuantity;
    default:
      // DIVIDEND / INTEREST / CAPITAL_GAIN move cash, not shares.
      return currentQuantity;
  }
}

/**
 * Actions that move shares, and therefore the ones a quantity replay must read.
 * A replay that filters its input by action list uses this rather than spelling
 * the list out, so a new action cannot be silently dropped from one surface.
 */
export const SHARE_MOVING_ACTIONS: readonly InvestmentAction[] = [
  InvestmentAction.BUY,
  InvestmentAction.SELL,
  InvestmentAction.REINVEST,
  InvestmentAction.TRANSFER_IN,
  InvestmentAction.TRANSFER_OUT,
  InvestmentAction.ADD_SHARES,
  InvestmentAction.REMOVE_SHARES,
  InvestmentAction.SPLIT,
];

/**
 * Whether an action adds shares to a position without supplying a cost for
 * them. Basis-carrying replays must record that the basis they computed is
 * incomplete rather than treating the shares as free.
 */
export function isQuantityOnlyAction(
  action: InvestmentAction | string,
): boolean {
  return (
    action === InvestmentAction.ADD_SHARES ||
    action === InvestmentAction.REMOVE_SHARES
  );
}

/**
 * What an acquisition cost, in the currency the trade settled in.
 *
 * The commission belongs in the basis: it is part of what was paid to acquire
 * the position, and the linked cash debit already includes it. Leaving it out
 * understates the basis and so overstates every gain and every tax derived
 * from one -- 10 of commission on a 1,000 purchase is 10 of phantom gain.
 *
 * Returns `null` when the row cannot say what the acquisition cost: a missing
 * price is unknown, not free. A stored `0` is *no price* too, not a free
 * acquisition -- before the acquisition guard shipped, `create()` stored
 * `price ?? 0` and the form accepted a blank field, so real databases hold
 * zero-price BUY and REINVEST rows that mean "unknown". Replaying one as a
 * known zero-cost lot understates the basis and overstates every gain and tax
 * drawn from it, the same defect the null case closes arriving by a different
 * route. No legitimate zero can be stored from here on:
 * `assertAcquisitionPriced` refuses it, because a zero-cost purchase is not a
 * concept this application has.
 */
export function acquisitionCost(tx: {
  quantity?: number | string | null;
  price?: number | string | null;
  commission?: number | string | null;
  exchangeRate?: number | string | null;
}): number | null {
  const quantity = Number(tx.quantity) || 0;
  const commission = Number(tx.commission) || 0;
  const hasPrice =
    tx.price !== null &&
    Number.isFinite(Number(tx.price)) &&
    Number(tx.price) > 0;

  if (!hasPrice && (quantity !== 0 || commission !== 0)) {
    return null;
  }

  const price = Number(tx.price) || 0;
  const rate = Number(tx.exchangeRate) || 1;
  return (quantity * price + commission) * rate;
}

/**
 * The per-share cost of an acquisition, commission included.
 *
 * `Holding.averageCost` is maintained incrementally on every acquisition, and it
 * was fed the raw market price -- so the live holding said 100.00 per share while
 * a rebuild, which goes through `acquisitionCost`, said 101.00 for the same buy.
 * The two disagreed until something unrelated triggered a rebuild, and the
 * holdings screen showed whichever had run last (review finding FR-008).
 *
 * Falls back to the price when there are no shares to divide by, and when the
 * row cannot say what it cost -- an unpriced acquisition has no per-share cost to
 * derive, and the caller's existing price guard decides what to do about that.
 */
export function acquisitionUnitCost(tx: {
  quantity?: number | string | null;
  price?: number | string | null;
  commission?: number | string | null;
}): number {
  const quantity = Number(tx.quantity) || 0;
  const price = Number(tx.price) || 0;
  if (quantity === 0) return price;

  const cost = acquisitionCost({
    quantity,
    price: tx.price,
    commission: tx.commission,
  });
  if (cost === null) return price;

  return cost / quantity;
}
