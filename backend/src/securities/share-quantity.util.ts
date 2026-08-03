import { InvestmentAction } from "./entities/investment-transaction.entity";

/**
 * What an investment transaction does to a position's SHARE COUNT.
 *
 * Written once because the codebase held three different answers for one of
 * these actions. `SPLIT.quantity` is a **ratio** -- the multiplier a 2-for-1
 * split records as `2` -- and `HoldingsService`, `replayLots` and the investment
 * report replays all multiply by it. The net-worth history *added* it, so a
 * 2-for-1 split on a 100-share position produced 102 shares instead of 200, and
 * the TWR walk ignored `SPLIT` altogether and produced 100. Every historical
 * point after a split was therefore wrong, in a different direction depending on
 * which chart the user was looking at, with no error anywhere to notice.
 *
 * `ADD_SHARES` / `REMOVE_SHARES` move units without cash. They change what the
 * position is worth even though they carry no price, so a valuation walk that
 * skips them values a position the user does not hold. (What those units *cost*
 * is a separate question, and an unanswerable one -- see the `quantity_only_action`
 * basis gap in `portfolio-calculation.service.ts`.)
 *
 * Cash-only actions (DIVIDEND, INTEREST, CAPITAL_GAIN) leave the count alone.
 *
 * The cost-basis replays in `portfolio-calculation.service.ts` and
 * `investment-report-data.service.ts` interleave quantity and basis in one
 * switch and are not expressible through this helper; they already agree with it
 * on quantity, and `share-quantity.guard.spec.ts` pins the list so a new
 * disagreement has to be a deliberate, reviewed addition.
 */
export function applyShareQuantity(
  current: number,
  action: InvestmentAction | string,
  quantity: number,
): number {
  const qty = Number(quantity) || 0;
  switch (action) {
    case InvestmentAction.BUY:
    case InvestmentAction.REINVEST:
    case InvestmentAction.TRANSFER_IN:
    case InvestmentAction.ADD_SHARES:
      return current + qty;
    case InvestmentAction.SELL:
    case InvestmentAction.TRANSFER_OUT:
    case InvestmentAction.REMOVE_SHARES:
      return current - qty;
    case InvestmentAction.SPLIT:
      // A non-positive ratio is not a shrinking position -- it is a row that
      // cannot say what the split did, so the count is left as it stands rather
      // than multiplied to zero.
      return qty > 0 ? current * qty : current;
    default:
      return current;
  }
}
