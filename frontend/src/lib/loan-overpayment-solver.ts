import {
  LoanScheduleInput,
  LoanScheduleResult,
  OverpaymentMode,
  generateLoanSchedule,
} from '@/lib/loan-schedule';

/**
 * Goal-seek helpers for the overpayment simulator: given a target (a total
 * interest cost, or a payoff month), find the smallest recurring extra payment
 * that reaches it. Both targets are monotonic in the recurring amount -- more
 * extra per period means less total interest and an earlier payoff -- so a
 * binary search converges reliably.
 *
 * The recurring amount is the knob because it is the natural "how much should I
 * overpay every month" answer. The mode is SHORTEN_TERM: paying off sooner (and
 * paying less interest) is only meaningful when the extra shortens the term;
 * LOWER_INSTALLMENT keeps the end date, so it cannot hit a payoff-date target.
 */

export type SolveStatus = 'ok' | 'already-met' | 'unreachable';

export interface SolveResult {
  status: SolveStatus;
  /** Required recurring extra per period (rounded up to `step`); null unless ok */
  amount: number | null;
  /** Schedule produced by `amount`; for already-met it is the no-overpayment
   *  baseline, and it is null when unreachable */
  result: LoanScheduleResult | null;
}

const ITERATIONS = 60;

function scheduleWith(
  base: LoanScheduleInput,
  amount: number,
  mode: OverpaymentMode,
): LoanScheduleResult {
  if (amount <= 0) {
    return generateLoanSchedule({ ...base, overpayments: undefined });
  }
  return generateLoanSchedule({
    ...base,
    overpayments: { recurringExtra: { amount, mode } },
  });
}

/** A generous upper bound: a recurring extra this large clears the balance in
 *  roughly one period, so the true answer always lies below it. */
function upperBound(base: LoanScheduleInput): number {
  return Math.max(base.startingBalance, base.paymentAmount * 2, 1);
}

/** Round up to the nearest `step` so the rounded amount still meets the goal
 *  (more overpayment can only help). */
function roundUpTo(amount: number, step: number): number {
  if (step <= 0) return Math.ceil(amount);
  return Math.ceil(amount / step) * step;
}

/**
 * Smallest recurring extra whose schedule leaves total interest at or below
 * `targetInterest`.
 * - `already-met`: the loan already costs that little (or less) with no extra.
 * - `unreachable`: even the maximum extra cannot get interest that low (the
 *   target is below the interest of a near-immediate payoff).
 */
export function solveRecurringForTargetInterest(
  base: LoanScheduleInput,
  targetInterest: number,
  mode: OverpaymentMode = 'SHORTEN_TERM',
  step = 1,
): SolveResult {
  const baseline = scheduleWith(base, 0, mode);
  if (baseline.totalInterest <= targetInterest) {
    return { status: 'already-met', amount: 0, result: baseline };
  }
  const hi0 = upperBound(base);
  if (scheduleWith(base, hi0, mode).totalInterest > targetInterest) {
    return { status: 'unreachable', amount: null, result: null };
  }
  let lo = 0;
  let hi = hi0;
  for (let i = 0; i < ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    if (scheduleWith(base, mid, mode).totalInterest <= targetInterest) hi = mid;
    else lo = mid;
  }
  const amount = roundUpTo(hi, step);
  return { status: 'ok', amount, result: scheduleWith(base, amount, mode) };
}

/**
 * Smallest recurring extra whose schedule pays the loan off no later than
 * `targetMonth` (comparison is at month granularity, so a payoff anywhere
 * within the target month counts).
 * - `already-met`: the loan already pays off by then with no extra.
 * - `unreachable`: the target month is earlier than the soonest possible payoff.
 */
export function solveRecurringForPayoffMonth(
  base: LoanScheduleInput,
  targetDate: string,
  mode: OverpaymentMode = 'SHORTEN_TERM',
  step = 1,
): SolveResult {
  const targetMonth = targetDate.slice(0, 7);
  const paysOffBy = (r: LoanScheduleResult): boolean =>
    r.payoffDate != null && r.payoffDate.slice(0, 7) <= targetMonth;

  const baseline = scheduleWith(base, 0, mode);
  if (paysOffBy(baseline)) {
    return { status: 'already-met', amount: 0, result: baseline };
  }
  const hi0 = upperBound(base);
  if (!paysOffBy(scheduleWith(base, hi0, mode))) {
    return { status: 'unreachable', amount: null, result: null };
  }
  let lo = 0;
  let hi = hi0;
  for (let i = 0; i < ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    if (paysOffBy(scheduleWith(base, mid, mode))) hi = mid;
    else lo = mid;
  }
  const amount = roundUpTo(hi, step);
  return { status: 'ok', amount, result: scheduleWith(base, amount, mode) };
}
