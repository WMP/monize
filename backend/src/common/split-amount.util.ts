import { BadRequestException } from "@nestjs/common";
import { tr } from "../i18n/translate";
import { roundMoney, sumMoney } from "./round.util";

/**
 * Shared validation for transaction/scheduled-transaction split amount totals.
 *
 * Confirms that the rounded sum (4dp) of the split amounts equals the rounded
 * parent transaction amount, and that the minimum split count is met.
 *
 * - The default minimum split count is 2.
 * - When {@link options.allowSinglePassthrough} is `true` (the default for
 *   transaction-level splits where a single transfer or investment split is
 *   considered a "pass-through"), exactly one split is allowed when it is a
 *   transfer or investment split (the caller filters by `predicate`).
 *
 * @throws BadRequestException when the count or sum constraints are violated.
 */
export function validateSplitAmountSum(
  splits: { amount: number }[],
  transactionAmount: number,
  options: {
    allowSinglePassthrough?: boolean;
    isPassthrough?: (split: unknown) => boolean;
    /**
     * True when the split set legitimately mixes inflows and outflows, so the
     * parent amount is a net rather than a total of same-signed parts. Set for
     * a split containing an investment action: one brokerage line can sell
     * (+proceeds), pay a fee (-) and buy (-) at once, and each child's sign is
     * really its own. Every child there is validated against its computed cash
     * impact instead, which is stricter than a sign check.
     */
    allowMixedSign?: boolean;
  } = {},
): void {
  const allowSinglePassthrough = options.allowSinglePassthrough ?? false;

  const isPassthrough =
    allowSinglePassthrough &&
    splits.length === 1 &&
    (options.isPassthrough?.(splits[0]) ?? false);

  if (splits.length < 2 && !isPassthrough) {
    throw new BadRequestException(
      tr(
        "errors.common.splitMinCount",
        "Split transactions must have at least 2 splits",
      ),
    );
  }

  const roundedSum = sumMoney(splits.map((split) => Number(split.amount)));
  const roundedAmount = roundMoney(Number(transactionAmount));

  if (roundedSum !== roundedAmount) {
    throw new BadRequestException(
      tr(
        "errors.common.splitAmountMismatch",
        `Split amounts (${roundedSum}) must equal transaction amount (${roundedAmount})`,
        { roundedSum, roundedAmount },
      ),
    );
  }

  // Every non-zero child follows the parent's sign, which the split DTO has
  // always documented ("must be same sign as parent transaction") and nothing
  // enforced.
  //
  // The sum check alone accepts `+50` and `-150` under a `-100` parent. The
  // account balance is right -- it takes the parent once -- but budgets,
  // category reports and tax exports read the children, so that split reports
  // 50 of income that never arrived and 150 of expense against 100 of actual
  // outflow. Economic activity appears that did not occur (audit P5-004).
  //
  // Netting a refund against a charge is a real need; it is two linked
  // transactions, not one split, because only the two-row form leaves the
  // inflow and the outflow individually true.
  //
  // A zero parent is skipped: opposing children that cancel out have no parent
  // sign to follow.
  if (roundedAmount !== 0 && !options.allowMixedSign) {
    const parentIsNegative = roundedAmount < 0;
    const offending = splits.find((split) => {
      const amount = roundMoney(Number(split.amount));
      // Zero children carry no sign and are left to the caller's own rules.
      if (amount === 0) return false;
      return amount < 0 !== parentIsNegative;
    });

    if (offending) {
      throw new BadRequestException(
        tr(
          "errors.common.splitSignMismatch",
          `Split amounts must have the same sign as the transaction amount (${roundedAmount})`,
          { roundedAmount },
        ),
      );
    }
  }
}
