import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@/test/render';
import { PastImpactSection } from './PastImpactSection';
import { computePastImpact } from '@/lib/loan-past-impact';
import { deriveLoanPaymentHistory, buildLoanProjectionInput } from '@/lib/loan-history';
import { generateLoanSchedule } from '@/lib/loan-schedule';
import { Account } from '@/types/account';
import { Transaction } from '@/types/transaction';

vi.mock('@/hooks/useNumberFormat', () => ({
  useNumberFormat: () => ({
    formatCurrency: (amount: number) => `$${amount.toFixed(2)}`,
  }),
}));

vi.mock('@/hooks/useChartDateFormat', () => ({
  useChartDateFormat: () => (date: string) => date.slice(0, 7),
}));

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'loan-1',
    accountType: 'LOAN',
    name: 'Car Loan',
    currencyCode: 'CAD',
    openingBalance: -10000,
    currentBalance: -6000,
    interestRate: 6,
    paymentAmount: 500,
    paymentFrequency: 'MONTHLY',
    paymentStartDate: '2025-01-15',
    originalPrincipal: 10000,
    amortizationMonths: 21,
    isCanadianMortgage: false,
    isVariableRate: false,
    ...overrides,
  } as Account;
}

function makeHistory(account: Account) {
  const transactions = [1000, 1000, 1000, 1000].map(
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

/**
 * Builds the forward projection the way LoanDetailView actually does --
 * `buildLoanProjectionInput` then `generateLoanSchedule` -- rather than
 * leaving `computePastImpact`'s currentProjection at its null default, so
 * these tests exercise the same wiring the page uses.
 */
function makeBaseline(account: Account, history: ReturnType<typeof deriveLoanPaymentHistory>) {
  const projectionInput = buildLoanProjectionInput(account, history, []);
  return projectionInput ? generateLoanSchedule(projectionInput) : null;
}

describe('PastImpactSection', () => {
  it('shows extra principal paid plus months and interest saved', () => {
    const account = makeAccount();
    const history = makeHistory(account);
    const impact = computePastImpact(account, history, makeBaseline(account, history));
    render(<PastImpactSection account={account} impact={impact} />);

    expect(screen.getByText('Extra Principal Paid')).toBeInTheDocument();
    expect(
      screen.getByText('Total extra principal paid on top of your scheduled payments'),
    ).toBeInTheDocument();
    expect(screen.getByText('Time Already Saved')).toBeInTheDocument();
    expect(screen.getByText(/\d+ months?/)).toBeInTheDocument();
    expect(screen.getByText('Interest Already Saved')).toBeInTheDocument();
    expect(screen.getByText(/Originally .+, now .+/)).toBeInTheDocument();
  });

  it('still renders when only the opening balance is set (no originalPrincipal)', () => {
    const account = makeAccount({ originalPrincipal: null });
    const history = makeHistory(account);
    const impact = computePastImpact(account, history, makeBaseline(account, history));
    render(<PastImpactSection account={account} impact={impact} />);

    // Falls back to the opening balance; the section renders rather than hinting
    expect(screen.getByText('Extra Principal Paid')).toBeInTheDocument();
    expect(
      screen.queryByText(/needs an interest rate, a payment frequency/),
    ).not.toBeInTheDocument();
  });

  it('renders nothing when the impact cannot be computed', () => {
    const { container } = render(
      <PastImpactSection account={makeAccount()} impact={null} />,
    );

    expect(screen.queryByText('Extra Principal Paid')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it('REV-20260803-011: does not show a false "Interest Already Saved" number for an outstanding loan with no current projection', () => {
    // $80,000 outstanding loan with principal, rate, frequency, start date and
    // amortization all configured, but no paymentAmount -- buildLoanProjectionInput
    // returns null (see loan-history.ts), so the page's baseline is null and
    // there is no current projection. The loan is nowhere near paid off, so its
    // remaining contractual interest is unknown, not zero.
    const account = makeAccount({
      originalPrincipal: 80000,
      currentBalance: -80000,
      paymentAmount: null,
      amortizationMonths: 240,
    });
    const history = deriveLoanPaymentHistory(account, []);
    expect(buildLoanProjectionInput(account, history, [])).toBeNull();

    const impact = computePastImpact(account, history, null, []);
    render(<PastImpactSection account={account} impact={impact} />);

    // The section still renders (extra principal paid is known: 0), but the
    // two figures that depend on an unavailable projection must read as N/A,
    // never as a computed months/interest-saved value.
    expect(screen.getByText('Extra Principal Paid')).toBeInTheDocument();
    expect(screen.getByText('Time Already Saved')).toBeInTheDocument();
    expect(screen.getByText('Interest Already Saved')).toBeInTheDocument();
    expect(screen.queryByText(/\d+ months?/)).not.toBeInTheDocument();
    expect(screen.getAllByText('N/A')).toHaveLength(2);
  });
});
