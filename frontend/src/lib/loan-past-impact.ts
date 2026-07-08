import { Account } from '@/types/account';
import { LoanHistoryResult } from '@/lib/loan-history';
import {
  LoanScheduleResult,
  ScheduleFrequency,
  advanceDate,
  calculateMortgagePaymentAmount,
  generateLoanSchedule,
} from '@/lib/loan-schedule';

/**
 * "How much have my overpayments already helped?" — compares the original
 * contractual schedule (from origination) against what actually happened
 * plus the current projection from today's balance.
 */
export interface PastImpactResult {
  /** Contractual schedule from originalPrincipal at paymentStartDate */
  originalSchedule: LoanScheduleResult;
  /** Projection from the current balance; null when the loan is paid off */
  currentProjection: LoanScheduleResult | null;
  originalPayoffDate: string | null;
  /** Projected payoff, or the final actual payment when already paid off */
  currentPayoffDate: string | null;
  monthsAlreadySaved: number;
  interestAlreadySaved: number;
}

/** Original schedules can be longer than the reports' 600-payment cap
 * (e.g. a 25-year weekly mortgage), so give them room to complete. */
const ORIGINAL_SCHEDULE_MAX_PAYMENTS = 10000;

/**
 * Compute the past impact of overpayments, or null when the account lacks
 * the data to reconstruct its original schedule (originalPrincipal,
 * paymentStartDate, rate, frequency, and a determinable contractual payment).
 */
export function computePastImpact(
  account: Account,
  history: LoanHistoryResult,
): PastImpactResult | null {
  if (
    !account.originalPrincipal ||
    account.originalPrincipal <= 0 ||
    !account.paymentStartDate ||
    account.interestRate == null ||
    !account.paymentFrequency
  ) {
    return null;
  }

  const frequency = account.paymentFrequency as ScheduleFrequency;
  const isCanadian = account.isCanadianMortgage || false;
  const isVariableRate = account.isVariableRate || false;

  // Mortgages derive their contractual payment from the amortization period;
  // plain loans use the configured payment amount
  const contractualPayment =
    account.accountType === 'MORTGAGE' && account.amortizationMonths
      ? calculateMortgagePaymentAmount(
          account.originalPrincipal,
          account.interestRate,
          account.amortizationMonths,
          frequency,
          isCanadian,
          isVariableRate,
        )
      : (account.paymentAmount ?? 0);
  if (contractualPayment <= 0) return null;

  const originalSchedule = generateLoanSchedule({
    startingBalance: account.originalPrincipal,
    annualRate: account.interestRate,
    paymentAmount: contractualPayment,
    frequency,
    isCanadian,
    isVariableRate,
    firstPaymentDate: parseIsoDate(account.paymentStartDate),
    maxPayments: ORIGINAL_SCHEDULE_MAX_PAYMENTS,
  });

  const isPaidOff = history.currentBalance <= 0.01;
  const canProjectCurrent =
    !isPaidOff && account.paymentAmount != null && account.paymentAmount > 0;

  const currentProjection = canProjectCurrent
    ? generateLoanSchedule({
        startingBalance: history.currentBalance,
        annualRate: account.interestRate,
        paymentAmount: account.paymentAmount!,
        frequency,
        isCanadian,
        isVariableRate,
        firstPaymentDate: advanceDate(new Date(), frequency),
      })
    : null;

  const lastActualPaymentDate =
    history.events.length > 0 ? history.events[history.events.length - 1].date : null;
  const currentPayoffDate = isPaidOff
    ? lastActualPaymentDate
    : (currentProjection?.payoffDate ?? null);

  const projectedRemainingInterest = currentProjection?.totalInterest ?? 0;
  const interestAlreadySaved = Math.max(
    0,
    Math.round(
      (originalSchedule.totalInterest -
        (history.cumulativeInterest + projectedRemainingInterest)) *
        100,
    ) / 100,
  );

  return {
    originalSchedule,
    currentProjection,
    originalPayoffDate: originalSchedule.payoffDate,
    currentPayoffDate,
    monthsAlreadySaved: Math.max(
      0,
      monthsBetween(currentPayoffDate, originalSchedule.payoffDate),
    ),
    interestAlreadySaved,
  };
}

/** Whole months from `fromDate` to `toDate` (0 when either is missing) */
function monthsBetween(fromDate: string | null, toDate: string | null): number {
  if (!fromDate || !toDate) return 0;
  const [fromYear, fromMonth] = fromDate.split('-').map(Number);
  const [toYear, toMonth] = toDate.split('-').map(Number);
  return (toYear - fromYear) * 12 + (toMonth - fromMonth);
}

function parseIsoDate(isoDate: string): Date {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day);
}
