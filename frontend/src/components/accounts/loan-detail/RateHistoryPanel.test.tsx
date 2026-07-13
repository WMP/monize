import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@/test/render';
import { useLoanRateEditing } from './useLoanRateEditing';
import { RateHistoryPanel } from './RateHistoryPanel';
import { Account } from '@/types/account';
import { LoanRateChange } from '@/types/loan-rate-change';
import { loanRateChangesApi } from '@/lib/loan-rate-changes';

vi.mock('@/lib/loan-rate-changes', () => ({
  loanRateChangesApi: {
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    applyScheduledPayment: vi.fn(),
    detect: vi.fn(),
  },
}));

const account = {
  id: 'loan-1',
  accountType: 'MORTGAGE',
  currencyCode: 'CAD',
} as Account;

const rateChanges: LoanRateChange[] = [
  {
    id: 'rc-1',
    accountId: 'loan-1',
    effectiveDate: '2022-05-13',
    annualRate: 1.75,
    newPaymentAmount: 3200,
    source: 'initial',
    note: null,
  } as LoanRateChange,
  {
    id: 'rc-2',
    accountId: 'loan-1',
    effectiveDate: '2022-06-24',
    annualRate: 2.25,
    newPaymentAmount: 3233.04,
    source: 'inferred',
    note: null,
  } as LoanRateChange,
  {
    id: 'rc-3',
    accountId: 'loan-1',
    effectiveDate: '2024-06-21',
    annualRate: 5.5,
    newPaymentAmount: null,
    source: 'inferred',
    note: null,
  } as LoanRateChange,
];

function Harness({ rows, onChanged }: { rows: LoanRateChange[]; onChanged: () => void }) {
  const editing = useLoanRateEditing(account, onChanged);
  return <RateHistoryPanel account={account} rateChanges={rows} editing={editing} />;
}

describe('RateHistoryPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders each recorded rate change with its rate, source badge, and payment', () => {
    render(<Harness rows={rateChanges} onChanged={() => {}} />);

    expect(screen.getByText('Rate History')).toBeInTheDocument();
    expect(screen.getByText('1.75%')).toBeInTheDocument();
    expect(screen.getByText('2.25%')).toBeInTheDocument();
    expect(screen.getByText('Initial')).toBeInTheDocument();
    expect(screen.getAllByText('Inferred')).toHaveLength(2);
    // A row with no recorded payment shows "unchanged".
    expect(screen.getByText(/unchanged/)).toBeInTheDocument();
  });

  it('shows the empty state when there are no rate changes', () => {
    render(<Harness rows={[]} onChanged={() => {}} />);
    expect(screen.getByText(/No rate changes recorded/)).toBeInTheDocument();
  });

  it('detects rate changes from history after confirmation', async () => {
    (loanRateChangesApi.detect as ReturnType<typeof vi.fn>).mockResolvedValue({
      created: [rateChanges[0], rateChanges[1]],
      replacedCount: 2,
      warnings: [],
    });
    const onChanged = vi.fn();
    render(<Harness rows={rateChanges} onChanged={onChanged} />);

    // The trigger opens a confirmation dialog; the dialog's confirm button
    // shares the "Detect from history" label, so the confirm is the second one.
    fireEvent.click(screen.getByRole('button', { name: 'Detect from history' }));
    const buttons = screen.getAllByRole('button', { name: 'Detect from history' });
    fireEvent.click(buttons[buttons.length - 1]);

    await waitFor(() => expect(loanRateChangesApi.detect).toHaveBeenCalledWith('loan-1'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });
});
