import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@/test/render';
import type { Category } from '@/types/category';
import type { ScheduledTransaction } from '@/types/scheduled-transaction';
import { billLineAmount, payrollBillOptions, PayrollDeductionRuleForm } from './PayrollDeductionRuleForm';

vi.mock('@/lib/zodConfig', () => ({}));
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));
const mockSuggest = vi.fn();
vi.mock('@/lib/payroll-deductions', () => ({
  payrollDeductionsApi: { suggest: (...args: unknown[]) => mockSuggest(...args) },
}));
// The category picker's own behaviour is its own test; a select stands in.
vi.mock('@/components/ui/Combobox', () => ({
  Combobox: ({ label, options, value, onChange, error }: any) => (
    <label>
      {label}
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value, '')}>
        <option value="">--</option>
        {options.map((o: any) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error && <span>{error}</span>}
    </label>
  ),
}));

const bill = (overrides: Partial<ScheduledTransaction> = {}): ScheduledTransaction =>
  ({
    id: 'st-pay',
    name: 'Paycheque',
    isActive: true,
    isInvestment: false,
    isTransfer: false,
    currencyCode: 'CAD',
    splits: [
      { id: 's1', categoryId: 'cat-gross', amount: 2500 },
      { id: 's2', categoryId: 'cat-ei', amount: -64 },
    ],
    ...overrides,
  }) as ScheduledTransaction;

const categories = [
  { id: 'cat-ei', name: 'EI', parentId: null },
  { id: 'cat-cpp', name: 'CPP', parentId: null },
] as Category[];

describe('payrollBillOptions and billLineAmount', () => {
  it('offers only active, non-investment, non-transfer bills', () => {
    const options = payrollBillOptions([
      bill(),
      bill({ id: 'inactive', isActive: false }),
      bill({ id: 'inv', isInvestment: true }),
      bill({ id: 'xfer', isTransfer: true }),
    ]);
    expect(options.map((b) => b.id)).toEqual(['st-pay']);
  });

  it('reads the magnitude of a negative line and nothing from a positive one', () => {
    expect(billLineAmount(bill(), 'cat-ei')).toBe(64);
    expect(billLineAmount(bill(), 'cat-gross')).toBeNull();
    expect(billLineAmount(bill(), 'cat-cpp')).toBeNull();
    expect(billLineAmount(undefined, 'cat-ei')).toBeNull();
  });
});

describe('PayrollDeductionRuleForm', () => {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const onCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockSuggest.mockResolvedValue({ expectedPerPaycheque: null, expectedSource: null });
  });

  const fillMaximum = (value: string) => {
    const input = screen.getByLabelText('Yearly maximum');
    fireEvent.change(input, { target: { value } });
    fireEvent.blur(input);
  };

  it('preselects the only bill, defaults the reset to 1 January and names the line it will cap', async () => {
    render(
      <PayrollDeductionRuleForm scheduledTransactions={[bill()]} categories={categories} onSubmit={onSubmit} onCancel={onCancel} />,
    );
    expect(screen.getByLabelText('Payroll scheduled bill')).toHaveValue('st-pay');
    expect(screen.getByLabelText('Reset date')).toHaveValue(`01/01/${new Date().getFullYear()}`);
    fireEvent.change(screen.getByLabelText('Deduction category'), { target: { value: 'cat-ei' } });
    expect(await screen.findByText("The bill's line deducts $64.00 per paycheque.")).toBeInTheDocument();
    expect(screen.queryByLabelText('Expected per paycheque')).not.toBeInTheDocument();
    fillMaximum('1077.48');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Save|Create/ }));
    });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({
      scheduledTransactionId: 'st-pay',
      categoryId: 'cat-ei',
      yearlyMaximum: 1077.48,
      resetPeriod: 'YEARLY',
      resetDate: expect.stringMatching(/^\d{4}-01-01$/),
      expectedPerPaycheque: null,
    });
  });

  it('asks for the expected amount when the bill has no line, prefilled from the ledger when it has one', async () => {
    mockSuggest.mockResolvedValue({ expectedPerPaycheque: 61.5, expectedSource: 'recent' });
    render(
      <PayrollDeductionRuleForm scheduledTransactions={[bill()]} categories={categories} onSubmit={onSubmit} onCancel={onCancel} />,
    );
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Deduction category'), { target: { value: 'cat-cpp' } });
    });
    expect(mockSuggest).toHaveBeenCalledWith('st-pay', 'cat-cpp');
    const expected = await screen.findByLabelText('Expected per paycheque');
    await waitFor(() => expect(expected).toHaveValue('61.50'));
    expect(screen.getByText('Suggested from your most recent transaction in this category.')).toBeInTheDocument();
    fillMaximum('4034.10');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Save|Create/ }));
    });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ categoryId: 'cat-cpp', expectedPerPaycheque: 61.5 });
  });

  it('refuses to submit without the expected amount when nothing supplies it', async () => {
    render(
      <PayrollDeductionRuleForm scheduledTransactions={[bill()]} categories={categories} onSubmit={onSubmit} onCancel={onCancel} />,
    );
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Deduction category'), { target: { value: 'cat-cpp' } });
    });
    fillMaximum('4034.10');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Save|Create/ }));
    });
    expect(await screen.findByText('Enter the expected amount per paycheque')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('loads an existing rule, keeping an entered figure and dropping one the line supplies', () => {
    const rule = {
      id: 'r1',
      userId: 'u1',
      scheduledTransactionId: 'st-pay',
      scheduledTransactionName: 'Paycheque',
      categoryId: 'cat-cpp',
      categoryName: 'CPP',
      yearlyMaximum: 4034.1,
      resetPeriod: 'YEARLY' as const,
      resetDate: '2026-01-01',
      periodStart: '2026-01-01',
      periodEnd: '2026-12-31',
      nextResetOn: '2027-01-01',
      paidToDate: 0,
      remaining: 4034.1,
      foreignCurrencyRows: 0,
      currencyCode: 'CAD',
      expectedPerPaycheque: 150,
      expectedSource: 'entered' as const,
      createdAt: '',
      updatedAt: '',
    };
    render(
      <PayrollDeductionRuleForm rule={rule} scheduledTransactions={[bill()]} categories={categories} onSubmit={onSubmit} onCancel={onCancel} />,
    );
    expect(screen.getByLabelText('Yearly maximum')).toHaveValue('4,034.10');
    expect(screen.getByLabelText('Expected per paycheque')).toHaveValue('150.00');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
