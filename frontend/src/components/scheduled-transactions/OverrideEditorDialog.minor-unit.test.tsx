import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@/test/render';
import { OverrideEditorDialog } from './OverrideEditorDialog';

// Issue #1581, the "modify next occurrence" surface: the editor rounded the
// parent of a LINEAR mortgage installment (1,170.6458) to 1,170.65 and kept
// the 4dp lines, so saving the override was refused with "Split amounts
// (-1170.6458) must equal transaction amount (-1170.65)". The real
// `toSplitRows` and format helpers run here; the shared suite mocks both.

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const mockCreateOverride = vi.fn().mockResolvedValue({});
vi.mock('@/lib/scheduled-transactions', () => ({
  scheduledTransactionsApi: {
    createOverride: (...args: any[]) => mockCreateOverride(...args),
    updateOverride: vi.fn().mockResolvedValue({}),
    deleteOverride: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('@/lib/investments', () => ({
  investmentsApi: { getSecurityPrices: vi.fn().mockResolvedValue([]) },
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

const linearInstallment = {
  id: 's1',
  name: 'Mortgage payment',
  amount: -1170.6458,
  currencyCode: 'EUR',
  accountId: 'a1',
  categoryId: null,
  description: '',
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
} as any;

const renderEditor = () =>
  render(
    <OverrideEditorDialog
      isOpen
      scheduledTransaction={linearInstallment}
      overrideDate="2026-11-01"
      categories={[{ id: 'cat-interest', name: 'Mortgage Interest', parentId: null }] as any[]}
      accounts={[{ id: 'a1', name: 'Main', accountType: 'CHEQUING' }, mortgage] as any[]}
      onClose={vi.fn()}
      onSave={vi.fn()}
    />,
  );

describe('OverrideEditorDialog: a bill priced below the cent (issue #1581)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pre-fills lines that sum to the amount shown, the cent on the principal line', () => {
    renderEditor();
    expect(screen.getByTestId('parent')).toHaveTextContent('-1170.65');
    expect(screen.getAllByTestId('line').map((el) => el.textContent)).toEqual(['-306.06', '-864.59']);
  });

  it('saves the parent and the lines in the same unit', async () => {
    renderEditor();
    fireEvent.click(screen.getByText('Save Override'));
    await waitFor(() => expect(mockCreateOverride).toHaveBeenCalled());
    const payload = mockCreateOverride.mock.calls[0][1];
    expect(payload.amount).toBe(-1170.65);
    expect(payload.splits.map((s: any) => s.amount)).toEqual([-306.06, -864.59]);
  });
});
