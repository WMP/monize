import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useEffect } from 'react';
import { render, screen, fireEvent, waitFor, act } from '@/test/render';
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
      scheduledPaymentPreviewHash: 'preview-hash-1',
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

    // REV-20260803-029: the hash from the create response must be forwarded so
    // the backend can reject a stale confirmation.
    await waitFor(() =>
      expect(loanRateChangesApi.applyScheduledPayment).toHaveBeenCalledWith(
        'loan-1',
        'preview-hash-1',
      ),
    );
  });

  // REV-20260803-018. The preview that drives this dialog is returned only by
  // rate-change creation, so once it is dropped it is gone -- a reload does not
  // bring it back. Clearing it before the request meant a transient failure left
  // the rate change saved, the linked scheduled bill stale, and no way to retry.
  describe('a failed scheduled-payment update stays retryable', () => {
    async function openTheConfirmation() {
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
        scheduledPaymentPreviewHash: 'preview-hash-1',
      });

      render(<Harness onChanged={vi.fn()} />);
      fireEvent.click(screen.getByText('Add rate change'));
      fireEvent.change(screen.getByLabelText('Effective date'), {
        target: { value: '2024-06-01' },
      });
      fireEvent.change(screen.getByLabelText('New annual rate (%)'), {
        target: { value: '5.5' },
      });
      fireEvent.click(screen.getByText('Save'));
      await waitFor(() =>
        expect(screen.getByText('Update scheduled payment?')).toBeInTheDocument(),
      );
    }

    it('keeps the dialog open and retries successfully', async () => {
      const apply = loanRateChangesApi.applyScheduledPayment as ReturnType<typeof vi.fn>;
      apply.mockRejectedValueOnce(new Error('network'));
      await openTheConfirmation();

      fireEvent.click(screen.getByText('Update payment'));
      await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));

      // The confirmation survives the failure -- this is the whole finding.
      expect(screen.getByText('Update scheduled payment?')).toBeInTheDocument();

      apply.mockResolvedValueOnce(null);
      fireEvent.click(screen.getByText('Update payment'));
      await waitFor(() => expect(apply).toHaveBeenCalledTimes(2));

      // Cleared only on success.
      await waitFor(() =>
        expect(screen.queryByText('Update scheduled payment?')).not.toBeInTheDocument(),
      );
    });

    it('closes the dialog on a successful apply', async () => {
      const apply = loanRateChangesApi.applyScheduledPayment as ReturnType<typeof vi.fn>;
      apply.mockResolvedValue(null);
      await openTheConfirmation();

      fireEvent.click(screen.getByText('Update payment'));
      await waitFor(() =>
        expect(screen.queryByText('Update scheduled payment?')).not.toBeInTheDocument(),
      );
    });

    it('disables both buttons while the apply is in flight', async () => {
      const apply = loanRateChangesApi.applyScheduledPayment as ReturnType<typeof vi.fn>;
      let settle: (() => void) | undefined;
      apply.mockImplementation(() => new Promise<void>((resolve) => { settle = resolve; }));
      await openTheConfirmation();

      fireEvent.click(screen.getByText('Update payment'));
      await waitFor(() =>
        expect(screen.getByText('Update payment').closest('button')).toBeDisabled(),
      );
      // Skip must not fire either: it clears the preview, which would discard the
      // confirmation for a request still on the wire.
      expect(screen.getByText('Leave as-is').closest('button')).toBeDisabled();

      await act(async () => {
        settle?.();
      });
    });

    it('survives an Escape dismissal while the apply is pending', async () => {
      // Disabling the buttons is not enough: ConfirmDialog passes onCancel to
      // Modal as onClose, so Escape and a backdrop click reach
      // skipScheduledPayment directly and would clear the preview out from under
      // a request still on the wire. If that request then failed, the
      // confirmation would be gone for good -- the finding's own failure mode
      // through a different door.
      const apply = loanRateChangesApi.applyScheduledPayment as ReturnType<typeof vi.fn>;
      let reject: ((err: Error) => void) | undefined;
      apply.mockImplementation(() => new Promise<void>((_resolve, rej) => { reject = rej; }));
      await openTheConfirmation();

      fireEvent.click(screen.getByText('Update payment'));
      await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));

      fireEvent.keyDown(document, { key: 'Escape' });

      await act(async () => {
        reject?.(new Error('network'));
      });

      // Still retryable.
      expect(screen.getByText('Update scheduled payment?')).toBeInTheDocument();
      apply.mockResolvedValueOnce(null);
      fireEvent.click(screen.getByText('Update payment'));
      await waitFor(() => expect(apply).toHaveBeenCalledTimes(2));
      await waitFor(() =>
        expect(screen.queryByText('Update scheduled payment?')).not.toBeInTheDocument(),
      );
    });

    it('still allows skipping when no apply is pending', async () => {
      // The guard must not make the dialog undismissable in the ordinary case.
      await openTheConfirmation();
      fireEvent.click(screen.getByText('Leave as-is'));
      await waitFor(() =>
        expect(screen.queryByText('Update scheduled payment?')).not.toBeInTheDocument(),
      );
      expect(loanRateChangesApi.applyScheduledPayment).not.toHaveBeenCalled();
    });

    it('ignores a second apply while one is already pending', async () => {
      // Invoked on the hook, not through the button: a disabled button makes
      // fireEvent a no-op, so clicking twice would pass either way.
      //
      // This does NOT fail against the original code, and that is not a gap in
      // it: the original nulled the preview before awaiting, so `!scheduledPreview`
      // turned the second call into a no-op -- re-entry was prevented by accident,
      // as a side effect of the very bug this finding is about. Now that the
      // preview is held until success, `isApplyingScheduled` is the only thing
      // stopping a double apply, and removing that check alone fails this test.
      const apply = loanRateChangesApi.applyScheduledPayment as ReturnType<typeof vi.fn>;
      let settle: (() => void) | undefined;
      apply.mockImplementation(() => new Promise<void>((resolve) => { settle = resolve; }));

      // Written in an effect, not during render: assigning an outer variable
      // while rendering is a side effect and eslint rejects it.
      const sink: { current?: ReturnType<typeof useLoanRateEditing> } = {};
      function CapturingHarness() {
        const editing = useLoanRateEditing(account, vi.fn());
        useEffect(() => {
          sink.current = editing;
        });
        return <LoanRateControls editing={editing} />;
      }

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
        scheduledPaymentPreviewHash: 'preview-hash-1',
      });

      render(<CapturingHarness />);
      fireEvent.click(screen.getByText('Add rate change'));
      fireEvent.change(screen.getByLabelText('Effective date'), {
        target: { value: '2024-06-01' },
      });
      fireEvent.change(screen.getByLabelText('New annual rate (%)'), {
        target: { value: '5.5' },
      });
      fireEvent.click(screen.getByText('Save'));
      await waitFor(() =>
        expect(screen.getByText('Update scheduled payment?')).toBeInTheDocument(),
      );

      await act(async () => {
        void sink.current!.applyScheduledPayment();
      });
      // Re-read: the first call has re-rendered the hook, so the handler captured
      // before it closed over the pre-pending state.
      await act(async () => {
        void sink.current!.applyScheduledPayment();
      });

      expect(apply).toHaveBeenCalledTimes(1);

      await act(async () => {
        settle?.();
      });
    });
  });

  // REV-20260803-029: the scheduled-payment confirmation was calling
  // applyScheduledPayment without the hash returned by creation, so the
  // backend's stale-preview check never ran.
  describe('scheduled-payment confirmation hash (REV-20260803-029)', () => {
    it('forwards the preview hash from creation to the confirmation API call', async () => {
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
        scheduledPaymentPreviewHash: 'abc123hash',
      });
      (
        loanRateChangesApi.applyScheduledPayment as ReturnType<typeof vi.fn>
      ).mockResolvedValue(null);

      render(<Harness onChanged={vi.fn()} />);
      fireEvent.click(screen.getByText('Add rate change'));
      fireEvent.change(screen.getByLabelText('Effective date'), {
        target: { value: '2024-06-01' },
      });
      fireEvent.change(screen.getByLabelText('New annual rate (%)'), {
        target: { value: '5.5' },
      });
      fireEvent.click(screen.getByText('Save'));

      await waitFor(() =>
        expect(screen.getByText('Update scheduled payment?')).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByText('Update payment'));

      await waitFor(() =>
        expect(loanRateChangesApi.applyScheduledPayment).toHaveBeenCalledWith(
          'loan-1',
          'abc123hash',
        ),
      );
    });

    it('refreshes the dialog with a fresh preview when the backend rejects with 409', async () => {
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
        scheduledPaymentPreviewHash: 'stale-hash',
      });
      const freshPreview = {
        scheduledTransactionId: 'sched-1',
        scheduledTransactionName: 'Mortgage',
        currencyCode: 'CAD',
        currentPaymentAmount: 1000,
        proposedPaymentAmount: 1200,
        currentPrincipal: 300,
        proposedPrincipal: 400,
        currentInterest: 700,
        proposedInterest: 800,
        extraPrincipal: 0,
      };
      const apply = loanRateChangesApi.applyScheduledPayment as ReturnType<typeof vi.fn>;
      // First call returns 409 with a fresh preview; second call succeeds.
      apply.mockRejectedValueOnce({
        response: { status: 409, data: { freshPreview, freshPreviewHash: 'fresh-hash' } },
      });
      apply.mockResolvedValueOnce(null);

      render(<Harness onChanged={vi.fn()} />);
      fireEvent.click(screen.getByText('Add rate change'));
      fireEvent.change(screen.getByLabelText('Effective date'), {
        target: { value: '2024-06-01' },
      });
      fireEvent.change(screen.getByLabelText('New annual rate (%)'), {
        target: { value: '5.5' },
      });
      fireEvent.click(screen.getByText('Save'));

      await waitFor(() =>
        expect(screen.getByText('Update scheduled payment?')).toBeInTheDocument(),
      );

      // First confirm -- stale, gets rejected.
      fireEvent.click(screen.getByText('Update payment'));
      await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
      // First call was with the stale hash.
      expect(apply).toHaveBeenNthCalledWith(1, 'loan-1', 'stale-hash');

      // Dialog must still be open with the refreshed preview.
      expect(screen.getByText('Update scheduled payment?')).toBeInTheDocument();

      // Second confirm -- uses the fresh hash from the 409 response.
      fireEvent.click(screen.getByText('Update payment'));
      await waitFor(() => expect(apply).toHaveBeenCalledTimes(2));
      expect(apply).toHaveBeenNthCalledWith(2, 'loan-1', 'fresh-hash');

      // Succeeds; dialog closes.
      await waitFor(() =>
        expect(screen.queryByText('Update scheduled payment?')).not.toBeInTheDocument(),
      );
    });
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
