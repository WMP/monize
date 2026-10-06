import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@/test/render';
import { ScheduledTransactionForm } from './ScheduledTransactionForm';

// Issue #1581, the template form: editing a LINEAR mortgage installment
// (864.5833 + 306.0625 = 1,170.6458) loaded the amount in cents and the lines
// at 4dp, so saving the template, even for a description change, sent a
// cents parent over 4dp lines and was refused. The real `toSplitRows` and
// format helpers run here; the shared suite mocks both.

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/hooks/useNumberFormat', async () => {
  const { numberFormatMockDefaults } = await import('@/test/number-format-mock');
  return { useNumberFormat: () => ({ ...numberFormatMockDefaults(), defaultCurrency: 'EUR' }) };
});

vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ formatDate: (d: string) => d, dateFormat: 'browser', datePattern: 'YYYY-MM-DD' }),
}));

vi.mock('@/lib/exchange-rates', () => ({
  exchangeRatesApi: {
    getRateForDate: vi.fn().mockResolvedValue(null),
    getCurrencies: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@/components/transactions/CurrencyPickerButton', () => ({
  CurrencyPickerButton: () => <div data-testid="currency-picker" />,
}));

const mortgage = {
  id: 'mortgage-1',
  name: 'Mortgage',
  currencyCode: 'EUR',
  isClosed: false,
  accountType: 'MORTGAGE',
  accountSubType: null,
};
const main = {
  id: 'a1',
  name: 'Main',
  currencyCode: 'EUR',
  isClosed: false,
  accountType: 'CHEQUING',
  accountSubType: null,
};

vi.mock('@/lib/accounts', () => ({
  accountsApi: { getAll: vi.fn(async () => [main, mortgage]) },
}));
vi.mock('@/lib/categories', () => ({
  categoriesApi: { getAll: vi.fn().mockResolvedValue([]), create: vi.fn() },
}));
vi.mock('@/lib/payees', () => ({
  payeesApi: { getAll: vi.fn().mockResolvedValue([]), create: vi.fn(), getById: vi.fn() },
}));
vi.mock('@/lib/tags', () => ({
  tagsApi: { getAll: vi.fn().mockResolvedValue([]), create: vi.fn() },
}));
vi.mock('@/lib/scheduled-transactions', () => ({
  scheduledTransactionsApi: { create: vi.fn(), update: vi.fn() },
}));
vi.mock('@/lib/investments', () => ({
  investmentsApi: { getSecurities: vi.fn().mockResolvedValue([]), getSecurityPrices: vi.fn().mockResolvedValue([]) },
}));
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
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

const linearInstallment = {
  id: 's1',
  name: 'Mortgage payment',
  accountId: 'a1',
  account: main,
  payeeId: null,
  payeeName: null,
  categoryId: null,
  amount: -1170.6458,
  currencyCode: 'EUR',
  description: '',
  frequency: 'MONTHLY',
  nextDueDate: '2026-11-01',
  startDate: '2026-01-01',
  endDate: null,
  occurrencesRemaining: null,
  isActive: true,
  autoPost: false,
  reminderDaysBefore: 3,
  isTransfer: false,
  isSplit: true,
  tagIds: [],
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
} as any;

describe('ScheduledTransactionForm: a template priced below the cent (issue #1581)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads the lines and the amount in the same unit, the cent on the principal line', async () => {
    await act(async () => {
      render(<ScheduledTransactionForm scheduledTransaction={linearInstallment} />);
    });
    expect(screen.getByTestId('parent')).toHaveTextContent('-1170.65');
    expect(screen.getAllByTestId('line').map((el) => el.textContent)).toEqual(['-306.06', '-864.59']);
  });
});
