import { describe, it, expect } from 'vitest';
import { computePastImpact } from './loan-past-impact';
import { deriveLoanPaymentHistory, LoanHistoryResult } from './loan-history';
import { calculateMortgagePaymentAmount, generateLoanSchedule } from './loan-schedule';
import { Account } from '@/types/account';
import { Transaction } from '@/types/transaction';

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'loan-1',
    accountType: 'LOAN',
    name: 'Car Loan',
    currencyCode: 'CAD',
    openingBalance: -10000,
    currentBalance: -8000,
    interestRate: 6,
    paymentAmount: 500,
    paymentFrequency: 'MONTHLY',
    paymentStartDate: '2025-01-15',
    originalPrincipal: 10000,
    amortizationMonths: null,
    isCanadianMortgage: false,
    isVariableRate: false,
    ...overrides,
  } as Account;
}

function makeHistory(account: Account, principals: number[]): LoanHistoryResult {
  const transactions = principals.map(
    (amount, i) =>
      ({
        id: `tx-${i}`,
        accountId: account.id,
        transactionDate: `2025-${String(i + 1).padStart(2, '0')}-15`,
        amount,
        linkedTransaction: null,
      }) as Transaction,
  );
  return deriveLoanPaymentHistory(account, transactions);
}

describe('computePastImpact', () => {
  it('returns null when originalPrincipal or paymentStartDate is missing', () => {
    const account = makeAccount();
    const history = makeHistory(account, [450]);

    expect(computePastImpact(makeAccount({ originalPrincipal: null }), history)).toBeNull();
    expect(computePastImpact(makeAccount({ paymentStartDate: null }), history)).toBeNull();
    expect(computePastImpact(makeAccount({ interestRate: null }), history)).toBeNull();
    expect(computePastImpact(makeAccount({ paymentFrequency: null }), history)).toBeNull();
    expect(
      computePastImpact(makeAccount({ paymentAmount: null }), history),
    ).toBeNull();
  });

  it('shows positive savings when extra principal was paid', () => {
    // A ~30-year contract (200k at 6% with 1200/mo from 2020) mostly paid
    // down by 20k/mo overpayments in its first year: the projection from the
    // remaining 40k balance ends decades before the original 2050 payoff.
    // The wide margin keeps the assertion stable regardless of the test's
    // run date (the current projection starts from "today").
    const account = makeAccount({
      originalPrincipal: 200000,
      currentBalance: -40000,
      paymentAmount: 1200,
      paymentStartDate: '2020-01-15',
    });
    const transactions = Array.from(
      { length: 8 },
      (_, i) =>
        ({
          id: `tx-${i}`,
          accountId: account.id,
          transactionDate: `2020-${String(i + 1).padStart(2, '0')}-15`,
          amount: 20000,
          linkedTransaction: null,
        }) as Transaction,
    );
    const history = deriveLoanPaymentHistory(account, transactions);

    const impact = computePastImpact(account, history);

    expect(impact).not.toBeNull();
    expect(impact!.originalSchedule.paidOff).toBe(true);
    expect(impact!.currentProjection).not.toBeNull();
    expect(impact!.monthsAlreadySaved).toBeGreaterThan(0);
    expect(impact!.interestAlreadySaved).toBeGreaterThan(0);
    expect(impact!.currentPayoffDate! < impact!.originalPayoffDate!).toBe(true);
  });

  it('shows zero savings for a loan paid exactly on contract', () => {
    // Reproduce the original schedule's own first four payments
    const original = generateLoanSchedule({
      startingBalance: 10000,
      annualRate: 6,
      paymentAmount: 500,
      frequency: 'MONTHLY',
      firstPaymentDate: new Date(2025, 0, 15),
    });
    const paidPrincipals = original.rows.slice(0, 4).map((row) => row.principal);
    const remaining = original.rows[3].balance;
    const history = makeHistory(makeAccount({ currentBalance: -remaining }), paidPrincipals);

    const impact = computePastImpact(
      makeAccount({ currentBalance: -remaining }),
      history,
    );

    expect(impact).not.toBeNull();
    // On-contract payments leave the projection within a month of the original
    expect(impact!.monthsAlreadySaved).toBeLessThanOrEqual(1);
    // No interest was recorded in history (no linked splits), so the saving
    // is capped rather than negative
    expect(impact!.interestAlreadySaved).toBeGreaterThanOrEqual(0);
  });

  it('derives the mortgage contractual payment from the amortization period', () => {
    const account = makeAccount({
      accountType: 'MORTGAGE',
      originalPrincipal: 300000,
      currentBalance: -290000,
      interestRate: 5,
      amortizationMonths: 300,
      isCanadianMortgage: true,
      paymentAmount: 2000,
    });
    const history = makeHistory(account, [10000]);

    const impact = computePastImpact(account, history);

    expect(impact).not.toBeNull();
    const expectedPayment = calculateMortgagePaymentAmount(300000, 5, 300, 'MONTHLY', true, false);
    // The original schedule amortizes with the derived payment: its first
    // row's payment matches the PMT-derived amount
    expect(impact!.originalSchedule.rows[0].payment).toBeCloseTo(expectedPayment, 0);
    expect(impact!.originalSchedule.numPayments).toBeGreaterThan(295);
    expect(impact!.originalSchedule.numPayments).toBeLessThanOrEqual(301);
  });

  it('uses the final actual payment as payoff for an already paid-off loan', () => {
    const account = makeAccount({ currentBalance: 0 });
    const history = makeHistory(account, [5000, 5000]);

    const impact = computePastImpact(account, history);

    expect(impact).not.toBeNull();
    expect(impact!.currentProjection).toBeNull();
    expect(impact!.currentPayoffDate).toBe('2025-02-15');
    expect(impact!.monthsAlreadySaved).toBeGreaterThan(0);
  });

  it('completes original schedules longer than the default projection cap', () => {
    // 25-year weekly mortgage: 1300 payments, beyond the 600 default cap
    const account = makeAccount({
      accountType: 'MORTGAGE',
      originalPrincipal: 300000,
      currentBalance: -299000,
      interestRate: 5,
      amortizationMonths: 300,
      paymentFrequency: 'WEEKLY' as Account['paymentFrequency'],
      paymentAmount: 405,
    });
    const history = makeHistory(account, [1000]);

    const impact = computePastImpact(account, history);

    expect(impact).not.toBeNull();
    expect(impact!.originalSchedule.paidOff).toBe(true);
    expect(impact!.originalSchedule.numPayments).toBeGreaterThan(600);
  });
});
