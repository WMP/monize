import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@/test/render';
import { PastImpactSection } from './PastImpactSection';
import { deriveLoanPaymentHistory } from '@/lib/loan-history';
import { Account } from '@/types/account';
import { Transaction } from '@/types/transaction';

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  AreaChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="area-chart">{children}</div>
  ),
  Area: ({ name }: { name?: string }) => <div data-testid="area">{name}</div>,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));

vi.mock('@/hooks/useNumberFormat', () => ({
  useNumberFormat: () => ({
    formatCurrency: (amount: number) => `$${amount.toFixed(2)}`,
    formatCurrencyCompact: (amount: number) => `$${amount.toFixed(0)}`,
    formatCurrencyAxis: (amount: number) => `$${amount}`,
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

describe('PastImpactSection', () => {
  it('shows months and interest already saved with the three series', () => {
    const account = makeAccount();
    render(<PastImpactSection account={account} history={makeHistory(account)} />);

    expect(screen.getByText('Impact of Overpayments Made')).toBeInTheDocument();
    expect(screen.getByText('Time Already Saved')).toBeInTheDocument();
    expect(screen.getByText(/\d+ months?/)).toBeInTheDocument();
    expect(screen.getByText('Interest Already Saved')).toBeInTheDocument();
    expect(screen.getByText(/Originally .+, now .+/)).toBeInTheDocument();
    expect(screen.getByText('Original Schedule')).toBeInTheDocument();
    expect(screen.getByText('Actual Balance')).toBeInTheDocument();
    expect(screen.getByText('Current Projection')).toBeInTheDocument();
  });

  it('shows a data hint when the original schedule cannot be reconstructed', () => {
    const account = makeAccount({ originalPrincipal: null });
    render(<PastImpactSection account={account} history={makeHistory(account)} />);

    expect(
      screen.getByText(/set the original principal and first payment date/),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
  });
});
