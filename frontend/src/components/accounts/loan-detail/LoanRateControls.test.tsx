import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@/test/render';
import { useLoanRateEditing } from './useLoanRateEditing';
import { LoanRateControls } from './LoanRateControls';
import { Account } from '@/types/account';
import { loanRateChangesApi } from '@/lib/loan-rate-changes';

vi.mock('@/lib/loan-rate-changes', () => ({
  loanRateChangesApi: {
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    applyScheduledPayment: vi.fn(),
  },
}));

const account = {
  id: 'loan-1',
  accountType: 'MORTGAGE',
  currencyCode: 'CAD',
} as Account;

function Harness({ onChanged }: { onChanged: () => void }) {
  const editing = useLoanRateEditing(account, onChanged);
  return <LoanRateControls editing={editing} />;
}

describe('LoanRateControls + useLoanRateEditing', () => {
  beforeEach(() => vi.clearAllMocks());

  it('adds a rate change and prompts to update the scheduled payment', async () => {
    (loanRateChangesApi.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'rc-1',
      scheduledPaymentPreview: {
        scheduledTransactionId: 'sched-1',
        scheduledTransactionName: 'Mortgage',
        currencyCode: 'CAD',
        currentPaymentAmount: 1000,
        proposedPaymentAmount: 1100,
        currentPrincipal: 300,
        proposedPrincipal: 350,
        currentInterest: 700,
        proposedInterest: 750,
        extraPrincipal: 0,
      },
    });
    (
      loanRateChangesApi.applyScheduledPayment as ReturnType<typeof vi.fn>
    ).mockResolvedValue(null);
    const onChanged = vi.fn();

    render(<Harness onChanged={onChanged} />);

    fireEvent.click(screen.getByText('Add rate change'));
    fireEvent.change(screen.getByLabelText('Effective date'), {
      target: { value: '2024-06-01' },
    });
    fireEvent.change(screen.getByLabelText('New annual rate (%)'), {
      target: { value: '5.5' },
    });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(loanRateChangesApi.create).toHaveBeenCalledWith('loan-1', {
        effectiveDate: '2024-06-01',
        annualRate: 5.5,
        newPaymentAmount: null,
        recalculatePayment: false,
        note: null,
      }),
    );

    // The scheduled-payment permission prompt (a12b8d8a) surfaces.
    await waitFor(() =>
      expect(screen.getByText('Update scheduled payment?')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText('Update payment'));

    await waitFor(() =>
      expect(loanRateChangesApi.applyScheduledPayment).toHaveBeenCalledWith('loan-1'),
    );
  });

  // The two user-visible halves of REV-20260803-012, at the surface that shows
  // them. This form passes DateInput only `onDateChange`, so whatever that
  // handler misses never reaches `form.effectiveDate` -- and `isFormValid`
  // requires a non-empty one.
  function withTouchDevice<T>(fn: () => T): T {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(pointer: coarse)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    try {
      return fn();
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  }

  it('enables Save after picking an effective date on a touch device', async () => {
    (loanRateChangesApi.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'rc-1' });

    withTouchDevice(() => {
      render(<Harness onChanged={vi.fn()} />);
      fireEvent.click(screen.getByText('Add rate change'));
      fireEvent.change(screen.getByLabelText('Effective date'), {
        target: { value: '2024-06-01' },
      });
      fireEvent.change(screen.getByLabelText('New annual rate (%)'), {
        target: { value: '5.5' },
      });
      // Save was permanently disabled here: the picked date never reached the
      // form, so the user could not record a rate change on a phone at all.
      fireEvent.click(screen.getByText('Save'));
    });

    await waitFor(() =>
      expect(loanRateChangesApi.create).toHaveBeenCalledWith(
        'loan-1',
        expect.objectContaining({ effectiveDate: '2024-06-01' }),
      ),
    );
  });

  it('does not save a cleared effective date', async () => {
    (loanRateChangesApi.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'rc-1' });

    render(<Harness onChanged={vi.fn()} />);
    fireEvent.click(screen.getByText('Add rate change'));
    const dateField = screen.getByLabelText('Effective date');
    fireEvent.change(dateField, { target: { value: '2024-06-01' } });
    fireEvent.change(screen.getByLabelText('New annual rate (%)'), {
      target: { value: '5.5' },
    });
    // The user changes their mind and empties the field.
    fireEvent.change(dateField, { target: { value: '' } });
    fireEvent.click(screen.getByText('Save'));

    // The clear used to be swallowed, so the form still held 2024-06-01 and
    // saved a rate change -- and recalculated a scheduled payment -- on a date
    // no longer on screen.
    await waitFor(() => expect(loanRateChangesApi.create).not.toHaveBeenCalled());
  });
});
