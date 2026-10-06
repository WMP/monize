import { roundMoney, roundToDecimals, sumMoney } from '@/lib/format';

/**
 * Book a split set in a currency's smallest unit (issue #1581): the parent and
 * every line rounded to `decimals`, and the difference the line roundings
 * leave on the line at `absorbIndex`, so the lines sum to the parent exactly.
 *
 * Mirrors `bookSplitsAtMinorUnit` in
 * `backend/src/common/currency-minor-unit.util.ts`, which books the same
 * stored template to recognise an unchanged Post dialog: the two must return
 * the same figures for the same input.
 */
export function bookSplitsAtMinorUnit(
  amounts: readonly number[],
  parentAmount: number,
  decimals: number,
  absorbIndex: number,
): { amounts: number[]; parentAmount: number } {
  const parent = roundToDecimals(Number(parentAmount), decimals);
  const rounded = amounts.map((amount) => roundToDecimals(Number(amount), decimals));
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

/** The account types a scheduled loan payment re-prices against; the server's `LOAN_LIKE_ACCOUNT_TYPES`. */
const LOAN_LIKE_ACCOUNT_TYPES: ReadonlySet<string> = new Set(['LOAN', 'MORTGAGE', 'LINE_OF_CREDIT']);

interface BookableLine {
  amount: number;
  transferAccountId?: string | null;
  memo?: string | null;
}

/**
 * Which line takes the rounding difference when a split set is booked in the
 * currency's unit.
 *
 * On a loan payment it is the principal line, as the server books it: the
 * first line transferring to a loan-like account whose memo does not name it
 * the extra principal (`ScheduledTransactionLoanService.bookedTemplateAmounts`).
 * Interest is the period's charge; principal is what retires the loan. Any
 * other split set gives it to its largest line, where a cent moves the least.
 */
export function minorUnitAbsorbIndex(
  lines: readonly BookableLine[],
  accountTypeById: ReadonlyMap<string, string>,
): number {
  const loanAccountId = lines
    .map((line) => line.transferAccountId)
    .find((id) => !!id && LOAN_LIKE_ACCOUNT_TYPES.has(accountTypeById.get(id) ?? ''));
  if (loanAccountId) {
    const principalIndex = lines.findIndex(
      (line) =>
        line.transferAccountId === loanAccountId &&
        !(line.memo ?? '').toLowerCase().includes('extra'),
    );
    if (principalIndex >= 0) return principalIndex;
  }
  return lines.reduce(
    (best, line, index) =>
      Math.abs(Number(line.amount)) > Math.abs(Number(lines[best].amount)) ? index : best,
    0,
  );
}
