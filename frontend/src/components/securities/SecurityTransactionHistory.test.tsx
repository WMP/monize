import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@/test/render';
import { SecurityTransactionHistory } from './SecurityTransactionHistory';
import { investmentsApi } from '@/lib/investments';

vi.mock('@/lib/investments', () => ({
  investmentsApi: {
    getSecurityTransactionHistory: vi.fn(),
    createTransaction: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ formatDate: (d: string) => d, dateFormat: 'YYYY-MM-DD' }),
}));

vi.mock('@/hooks/useNumberFormat', () => ({
  useNumberFormat: () => ({
    formatCurrency: (n: number) => `$${n.toFixed(2)}`,
  }),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/errors', () => ({
  getErrorMessage: (_e: unknown, fallback: string) => fallback,
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

const security = {
  id: 'sec-1',
  symbol: 'ACME',
  name: 'Acme Corp',
  currencyCode: 'USD',
  isActive: false,
} as any;

const historyData = {
  securityId: 'sec-1',
  symbol: 'ACME',
  name: 'Acme Corp',
  currencyCode: 'USD',
  isActive: false,
  accounts: [
    { accountId: 'a1', accountName: 'Account A', isClosed: false, currentQuantity: 0.0003 },
    { accountId: 'a2', accountName: 'Account B', isClosed: true, currentQuantity: 50 },
  ],
  transactions: [
    { id: 't1', transactionDate: '2025-01-01', accountId: 'a1', accountName: 'Account A', action: 'ADD_SHARES', quantity: 100, price: null, commission: 0, totalAmount: 0, description: null, runningQuantityAccount: 100, runningQuantityAll: 100 },
    { id: 't2', transactionDate: '2025-02-01', accountId: 'a2', accountName: 'Account B', action: 'ADD_SHARES', quantity: 50, price: null, commission: 0, totalAmount: 0, description: null, runningQuantityAccount: 50, runningQuantityAll: 150 },
    { id: 't3', transactionDate: '2025-03-01', accountId: 'a1', accountName: 'Account A', action: 'REMOVE_SHARES', quantity: 99.9997, price: null, commission: 0, totalAmount: 0, description: null, runningQuantityAccount: 0.0003, runningQuantityAll: 50.0003 },
  ],
  currentQuantityAll: 50.0003,
};

async function renderHistory(props: Partial<Record<string, unknown>> = {}) {
  await act(async () => {
    render(
      <SecurityTransactionHistory
        security={security}
        onClose={vi.fn()}
        onChanged={(props.onChanged as () => void) ?? vi.fn()}
      />,
    );
  });
}

describe('SecurityTransactionHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(investmentsApi.getSecurityTransactionHistory).mockResolvedValue(historyData as any);
  });

  it('loads and shows transactions with the cross-account running total and current shares', async () => {
    await renderHistory();
    await waitFor(() => {
      expect(screen.getByText('ACME')).toBeInTheDocument();
    });
    expect(screen.getByText('Inactive')).toBeInTheDocument();
    // Cross-account running totals are shown in "All accounts" mode.
    expect(screen.getByText('150')).toBeInTheDocument();
    // Current shares (exact) appears (header + final running row).
    expect(screen.getAllByText('50.0003').length).toBeGreaterThan(0);
  });

  it('filters to a single account and shows its per-account running total', async () => {
    await renderHistory();
    await waitFor(() => {
      expect(screen.getByText('ACME')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Account'), { target: { value: 'a1' } });
    });

    // Account B's transaction (running-all 150) is filtered out.
    expect(screen.queryByText('150')).not.toBeInTheDocument();
    // Account A's residual per-account running total is shown.
    expect(screen.getAllByText('0.0003').length).toBeGreaterThan(0);
  });

  it('adds an adjustment and reloads the history', async () => {
    const onChanged = vi.fn();
    await renderHistory({ onChanged });
    await waitFor(() => {
      expect(screen.getByText('ACME')).toBeInTheDocument();
    });
    expect(investmentsApi.getSecurityTransactionHistory).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByText('+ Add transaction'));
    });
    expect(screen.getByText('Adjust shares')).toBeInTheDocument();

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Quantity (Shares)'), {
        target: { value: '0.0003' },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Record adjustment'));
    });

    await waitFor(() => {
      expect(investmentsApi.createTransaction).toHaveBeenCalled();
    });
    // History reloaded and parent notified.
    await waitFor(() => {
      expect(investmentsApi.getSecurityTransactionHistory).toHaveBeenCalledTimes(2);
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it('shows an empty state when there are no transactions', async () => {
    vi.mocked(investmentsApi.getSecurityTransactionHistory).mockResolvedValue({
      ...historyData,
      accounts: [],
      transactions: [],
      currentQuantityAll: 0,
    } as any);
    await renderHistory();
    await waitFor(() => {
      expect(screen.getByText(/No transactions for this security/)).toBeInTheDocument();
    });
  });
});
