import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@/test/render';
import { PostTransactionDialog } from './PostTransactionDialog';

// Issue #1581: a LINEAR mortgage installment is priced at storage precision
// (864.5833 principal + 306.0625 interest = 1,170.6458). The dialog rounded the
// parent to 1,170.65 but sent the 4dp lines, and the server refused the post:
// "Split amounts (-1170.6458) must equal transaction amount (-1170.65)". The
// real `toSplitRows` and format helpers run here; the shared dialog suite mocks
// both.

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const mockPostApi = vi.fn().mockResolvedValue({});
vi.mock('@/lib/scheduled-transactions', () => ({
  scheduledTransactionsApi: { post: (...args: any[]) => mockPostApi(...args) },
}));

vi.mock('@/lib/investments', () => ({
  investmentsApi: { getSecurityPrices: vi.fn().mockResolvedValue([]) },
}));

vi.mock('@/lib/exchange-rates', () => ({
  exchangeRatesApi: { getRateForDate: vi.fn().mockResolvedValue(null) },
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ formatDate: (d: string) => d, dateFormat: 'browser', datePattern: 'YYYY-MM-DD' }),
}));

vi.mock('@/hooks/useNumberFormat', async () => {
  const { numberFormatMockDefaults } = await import('@/test/number-format-mock');
  return { useNumberFormat: () => numberFormatMockDefaults() };
});

vi.mock('@/lib/forecast', () => ({
  getProjectedBalanceAtDate: (account: any) => Number(account.currentBalance) || 0,
}));

vi.mock('@/components/transactions/SplitEditor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/transactions/SplitEditor')>()),
  SplitEditor: ({ splits, transactionAmount }: any) => (
    <div data-testid="split-editor">
      <span data-testid="parent">{transactionAmount}</span>
      {splits.map((s: any) => (
        <span key={s.id} data-testid="line">{s.amount}</span>
      ))}
    </div>
  ),
}));

const mortgage = { id: 'mortgage-1', name: 'Mortgage', accountType: 'MORTGAGE', currentBalance: -61212.5 };
const checking = { id: 'a1', name: 'Main', accountType: 'CHEQUING', currentBalance: 5000 };

const linearInstallment = (currencyCode: string) =>
  ({
    id: 's1',
    name: 'Mortgage payment',
    amount: -1170.6458,
    currencyCode,
    accountId: 'a1',
    categoryId: null,
    description: '',
    nextDueDate: '2026-11-01T00:00:00Z',
    isTransfer: false,
    isSplit: true,
    account: { name: 'Main' },
    splits: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        transferAccountId: null,
        transferAccount: null,
        categoryId: 'cat-interest',
        amount: -306.0625,
        memo: 'Interest',
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        transferAccountId: 'mortgage-1',
        transferAccount: mortgage,
        categoryId: null,
        amount: -864.5833,
        memo: 'Principal',
      },
    ],
  }) as any;

const renderDialog = (currencyCode: string, overrides: Record<string, unknown> = {}) =>
  render(
    <PostTransactionDialog
      isOpen
      scheduledTransaction={{ ...linearInstallment(currencyCode), ...overrides }}
      categories={[{ id: 'cat-interest', name: 'Mortgage Interest', parentId: null }] as any[]}
      accounts={[checking, mortgage] as any[]}
      scheduledTransactions={[]}
      futureTransactions={[]}
      onClose={vi.fn()}
      onPosted={vi.fn()}
    />,
  );

const post = async () => {
  const buttons = screen.getAllByText('Post Transaction');
  fireEvent.click(buttons[buttons.length - 1]);
  await waitFor(() => expect(mockPostApi).toHaveBeenCalled());
  return mockPostApi.mock.calls[0][1];
};

describe('PostTransactionDialog: a bill priced below the cent (issue #1581)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pre-fills lines that sum to the amount shown, the cent on the principal line', () => {
    renderDialog('EUR');
    expect(screen.getByTestId('parent')).toHaveTextContent('-1170.65');
    expect(screen.getAllByTestId('line').map((el) => el.textContent)).toEqual(['-306.06', '-864.59']);
  });

  it('posts the parent and the lines in the same unit', async () => {
    renderDialog('EUR');
    const payload = await post();
    expect(payload.amount).toBe(-1170.65);
    expect(payload.splits.map((s: any) => [s.sourceSplitId, s.amount])).toEqual([
      ['11111111-1111-4111-8111-111111111111', -306.06],
      ['22222222-2222-4222-8222-222222222222', -864.59],
    ]);
  });

  it('leaves an override that changed only the amount unbalanced for the user to settle', () => {
    // An occurrence override of 1,500 that never touched the lines: the
    // 329.35 gap is not a rounding difference, so it is not pushed onto the
    // principal line behind the user's back.
    renderDialog('EUR', {
      nextOverride: { amount: -1500, isSplit: null, splits: null, overrideDate: null },
    });
    expect(screen.getByTestId('parent')).toHaveTextContent('-1500');
    expect(screen.getAllByTestId('line').map((el) => el.textContent)).toEqual(['-306.06', '-864.58']);
  });

  it('books whole units for a currency without a minor unit', async () => {
    renderDialog('JPY');
    const payload = await post();
    expect(payload.amount).toBe(-1171);
    expect(payload.splits.map((s: any) => s.amount)).toEqual([-306, -865]);
  });
});
