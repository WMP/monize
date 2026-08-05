import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@/test/render';
import { LoanSummaryCards } from './LoanSummaryCards';
import { generateLoanSchedule } from '@/lib/loan-schedule';
import { Account } from '@/types/account';

vi.mock('@/hooks/useNumberFormat', () => ({
  useNumberFormat: () => ({
    formatCurrency: (amount: number) => `$${amount.toFixed(2)}`,
  }),
}));

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
    isCanadianMortgage: false,
    isVariableRate: false,
    ...overrides,
  } as Account;
}

function makeBaseline() {
  return generateLoanSchedule({
    startingBalance: 8000,
    annualRate: 6,
    paymentAmount: 500,
    frequency: 'MONTHLY',
    firstPaymentDate: new Date(2026, 7, 15),
  });
}

describe('LoanSummaryCards', () => {
  it('renders balance, original amount, rate, and payment figures', () => {
    render(
      <LoanSummaryCards
        account={makeAccount()}
        startingBalance={10000}
        currentInstallment={500}
        baseline={makeBaseline()}
      />,
    );

    expect(screen.getByText('Current Balance')).toBeInTheDocument();
    expect(screen.getByText('$8000.00')).toBeInTheDocument();
    expect(screen.getByText('Original Amount')).toBeInTheDocument();
    expect(screen.getByText('$10000.00')).toBeInTheDocument();
    expect(screen.getByText('6%')).toBeInTheDocument();
    expect(screen.getByText('$500.00')).toBeInTheDocument();
    expect(screen.getByText('Monthly')).toBeInTheDocument();
  });

  it('shows payoff date and remaining interest from the baseline projection', () => {
    const baseline = makeBaseline();
    render(
      <LoanSummaryCards
        account={makeAccount()}
        startingBalance={10000}
        currentInstallment={500}
        baseline={baseline}
      />,
    );

    expect(screen.getByText('Est. Payoff')).toBeInTheDocument();
    // 8000 at 6% with $500/mo pays off in ~17 payments from Aug 2026
    expect(screen.getByText(/2027/)).toBeInTheDocument();
    expect(screen.getByText(`$${baseline.totalInterest.toFixed(2)}`)).toBeInTheDocument();
  });

  it('shows the effective rate note for Canadian fixed mortgages', () => {
    render(
      <LoanSummaryCards
        account={makeAccount({ accountType: 'MORTGAGE', isCanadianMortgage: true, interestRate: 5 })}
        startingBalance={10000}
        currentInstallment={500}
        baseline={null}
      />,
    );

    // (1 + 0.05/2)^2 - 1 = 5.0625%
    expect(screen.getByText(/5\.062\d?% effective/)).toBeInTheDocument();
  });

  it('omits the effective rate for variable-rate mortgages', () => {
    render(
      <LoanSummaryCards
        account={makeAccount({ isCanadianMortgage: true, isVariableRate: true, interestRate: 5 })}
        startingBalance={10000}
        currentInstallment={500}
        baseline={null}
      />,
    );

    expect(screen.queryByText(/effective/)).not.toBeInTheDocument();
  });

  it('falls back to N/A and Not set when data is missing', () => {
    render(
      <LoanSummaryCards
        account={makeAccount({ interestRate: null, paymentAmount: null, paymentFrequency: null })}
        startingBalance={10000}
        currentInstallment={null}
        baseline={null}
      />,
    );

    expect(screen.getAllByText('Not set').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('N/A').length).toBeGreaterThanOrEqual(2);
  });

  it('shows Paid off when the balance is zero', () => {
    render(
      <LoanSummaryCards
        account={makeAccount({ currentBalance: 0 })}
        startingBalance={10000}
        currentInstallment={500}
        baseline={null}
      />,
    );

    expect(screen.getByText('Paid off')).toBeInTheDocument();
  });

  it('does not report a nonzero sub-cent balance as Paid off', () => {
    // -0.0099 is nonzero at 4dp precision but was falsely caught by the old
    // `Math.abs(balance) <= 0.01` threshold. The fix rounds to 4dp before
    // comparing, so only a balance that is genuinely zero at database precision
    // triggers the "Paid off" label.
    render(
      <LoanSummaryCards
        account={makeAccount({ currentBalance: -0.0099 })}
        startingBalance={10000}
        currentInstallment={500}
        baseline={null}
      />,
    );

    expect(screen.queryByText('Paid off')).not.toBeInTheDocument();
  });

  it('shows Paid off for a balance that rounds to zero at 4dp', () => {
    // -0.00004 rounds to 0 when multiplied by 10000 and passed through
    // Math.round, so it is a genuinely zero balance at database precision.
    render(
      <LoanSummaryCards
        account={makeAccount({ currentBalance: -0.00004 })}
        startingBalance={10000}
        currentInstallment={500}
        baseline={null}
      />,
    );

    expect(screen.getByText('Paid off')).toBeInTheDocument();
  });
});
