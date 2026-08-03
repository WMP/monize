import { moneyEquals, roundMoney, sumMoney } from './format';

/**
 * What "these splits are valid" means, written once.
 *
 * Three editors submit splits -- the transaction form, the scheduled-transaction
 * form and the occurrence-override dialog -- and each used to carry its own
 * arithmetic. That is how the balance rule drifted from the API's: every one of
 * them compared at cents (`Math.round(x * 100) / 100`) while
 * `validateSplitAmountSum` on the server compares at four decimals, so a payload
 * the UI called balanced could be rejected, and a stored four-decimal split could
 * be silently flattened. Both rules now live here.
 */

/** A split as the editors hold it, reduced to what validation needs. */
export interface ValidatableSplit {
  amount: number;
  /** 'category' | 'transfer' | 'investment' */
  splitType: string;
}

export type SplitValidationIssue =
  | {
      kind: 'unbalanced';
      /** 4dp sum of the children. */
      splitsTotal: number;
      /** 4dp parent amount. */
      transactionAmount: number;
    }
  | {
      kind: 'mixed-sign';
      /** Indexes of the category children whose sign opposes the parent's. */
      indexes: number[];
    };

/**
 * Indexes of ordinary category children whose sign reverses part of the parent.
 *
 * A category split inherits the economic direction of the transaction it belongs
 * to: an expense of -100.00 is made up of expenses. Children of -150.00 and
 * +50.00 sum to -100.00, so a sum-only check passes them, and the result records
 * 50.00 of income inside an expense -- which lands in budgets, category reports
 * and cash-flow analysis while the account balance still reconciles, so nothing
 * downstream reveals it.
 *
 * Transfer and investment splits are the deliberate exceptions: their opposite
 * leg is modelled explicitly elsewhere, and their direction is theirs to define.
 * A zero child is neutral and belongs to neither direction.
 */
export function oppositeSignCategorySplits(
  splits: ValidatableSplit[],
  transactionAmount: number,
): number[] {
  const parent = roundMoney(Number(transactionAmount) || 0);
  if (parent === 0) return [];
  const parentIsNegative = parent < 0;

  return splits.reduce<number[]>((indexes, split, index) => {
    if (split.splitType !== 'category') return indexes;
    const amount = roundMoney(Number(split.amount) || 0);
    if (amount === 0) return indexes;
    if (amount < 0 !== parentIsNegative) indexes.push(index);
    return indexes;
  }, []);
}

/**
 * The first issue that would make this split set wrong, or `null`.
 *
 * Balance is checked before signs: an unbalanced set is the more immediate
 * problem and the one the editor's footer is already pointing at.
 */
export function validateSplits(
  splits: ValidatableSplit[],
  transactionAmount: number,
): SplitValidationIssue | null {
  const splitsTotal = sumMoney(splits.map((s) => Number(s.amount) || 0));
  if (!moneyEquals(splitsTotal, transactionAmount)) {
    return {
      kind: 'unbalanced',
      splitsTotal,
      transactionAmount: roundMoney(Number(transactionAmount) || 0),
    };
  }

  const indexes = oppositeSignCategorySplits(splits, transactionAmount);
  if (indexes.length > 0) return { kind: 'mixed-sign', indexes };

  return null;
}
