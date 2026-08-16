import { InvestmentAction } from "./entities/investment-transaction.entity";
import {
  getInvestmentActionState,
  investmentActionsWhere,
} from "./investment-action.contract";

/**
 * The canonical share-count effect of one investment action.
 *
 * Every surface that reconstructs a position from its transaction history --
 * the live holdings rebuild, the historical net-worth replay, the cost-basis
 * and capital-gains replays -- folds the same action contract in the same
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
 * - increase/decrease effects add or subtract shares;
 * - ratio effects multiply the existing position (SPLIT);
 * - none leaves the position unchanged.
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
  switch (getInvestmentActionState(action)?.shareEffect) {
    case "increase":
      return currentQuantity + quantity;
    case "decrease":
      return currentQuantity - quantity;
    case "ratio":
      return quantity > 0 ? currentQuantity * quantity : currentQuantity;
    case "none":
    default:
      return currentQuantity;
  }
}

/**
 * Actions that move shares, and therefore the ones a quantity replay must read.
 * Derived from the executable action contract so a new action cannot be silently
 * dropped from one surface.
 */
export const SHARE_MOVING_ACTIONS: readonly InvestmentAction[] =
  investmentActionsWhere((state) => state.shareEffect !== "none");

/**
 * Whether an action adds or removes shares without supplying a cost for them.
 * Basis-carrying replays must record that the basis they computed is incomplete
 * rather than treating the shares as free.
 */
export function isQuantityOnlyAction(
  action: InvestmentAction | string,
): boolean {
  return getInvestmentActionState(action)?.quantityOnly ?? false;
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
  // An absent rate means the trade settled in its own currency (the entity
  // default is 1). A stored zero or negative rate is absent-not-applicable
  // (root CLAUDE.md: "Rate 1 means same currency, never no rate found"), so
  // the basis is unknown rather than converted at par -- `|| 1` here would
  // bake the silent 1:1 fallback into the one door every basis goes through.
  const rate = tx.exchangeRate == null ? 1 : Number(tx.exchangeRate);
  if (!Number.isFinite(rate) || rate <= 0) return null;
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
