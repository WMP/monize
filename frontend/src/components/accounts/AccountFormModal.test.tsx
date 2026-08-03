import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@/test/render';
import { AccountFormModal } from './AccountFormModal';
import { Account } from '@/types/account';

let capturedOnSubmit: ((data: any) => Promise<void>) | null = null;

// Stand-in for the dynamically loaded AccountForm: captures the onSubmit so the
// test can drive the modal's submit logic directly.
vi.mock('next/dynamic', () => ({
  default: () => (props: any) => {
    capturedOnSubmit = props.onSubmit ?? null;
    return <div data-testid="account-form" />;
  },
}));

vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ children, isOpen }: any) =>
    isOpen ? <div data-testid="modal">{children}</div> : null,
}));

vi.mock('@/components/ui/UnsavedChangesDialog', () => ({
  UnsavedChangesDialog: () => null,
}));

const mockCreate = vi.fn();
const mockUpdate = vi.fn();
vi.mock('@/lib/accounts', () => ({
  accountsApi: {
    create: (...args: any[]) => mockCreate(...args),
    update: (...args: any[]) => mockUpdate(...args),
  },
}));

vi.mock('@/lib/errors', () => ({ showErrorToast: vi.fn() }));

const buildFormModal = (overrides: Partial<any> = {}) => ({
  showForm: true,
  editingItem: undefined as Account | undefined,
  isEditing: false,
  close: vi.fn(),
  modalProps: { pushHistory: true, onBeforeClose: vi.fn() },
  setFormDirty: vi.fn(),
  unsavedChangesDialog: { isOpen: false, onSave: vi.fn(), onDiscard: vi.fn(), onCancel: vi.fn() },
  formSubmitRef: { current: null },
  ...overrides,
});

describe('AccountFormModal', () => {
  beforeEach(() => {
    capturedOnSubmit = null;
    vi.clearAllMocks();
  });

  it('renders nothing when the form is closed', () => {
    render(<AccountFormModal formModal={buildFormModal({ showForm: false })} onSaved={vi.fn()} />);
    expect(screen.queryByTestId('modal')).not.toBeInTheDocument();
  });

  it('shows the New Account heading when creating', () => {
    render(<AccountFormModal formModal={buildFormModal()} onSaved={vi.fn()} />);
    expect(screen.getByText('New Account')).toBeInTheDocument();
  });

  it('shows the Edit Account heading when editing', () => {
    render(
      <AccountFormModal
        formModal={buildFormModal({ editingItem: { id: 'a-1' } as Account, isEditing: true })}
        onSaved={vi.fn()}
      />,
    );
    expect(screen.getByText('Edit Account')).toBeInTheDocument();
  });

  it('creates an account and notifies the caller on submit', async () => {
    mockCreate.mockResolvedValue({ id: 'new' });
    const onSaved = vi.fn();
    const close = vi.fn();
    render(<AccountFormModal formModal={buildFormModal({ close })} onSaved={onSaved} />);

    await waitFor(() => expect(capturedOnSubmit).not.toBeNull());
    await act(async () => {
      await capturedOnSubmit!({ name: 'New', accountType: 'CHEQUING' });
    });

    expect(mockCreate).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalled();
  });

  it('updates an existing account on submit', async () => {
    mockUpdate.mockResolvedValue({});
    render(
      <AccountFormModal
        formModal={buildFormModal({ editingItem: { id: 'a-1', accountType: 'CHEQUING' } as Account, isEditing: true })}
        onSaved={vi.fn()}
      />,
    );

    await waitFor(() => expect(capturedOnSubmit).not.toBeNull());
    await act(async () => {
      await capturedOnSubmit!({ name: 'Renamed', accountType: 'CHEQUING' });
    });

    expect(mockUpdate).toHaveBeenCalledWith('a-1', expect.any(Object));
  });

  it('clears a previously set description by sending null when blanked on edit', async () => {
    mockUpdate.mockResolvedValue({});
    render(
      <AccountFormModal
        formModal={buildFormModal({
          editingItem: { id: 'a-1', accountType: 'CHEQUING', description: 'Old note' } as Account,
          isEditing: true,
        })}
        onSaved={vi.fn()}
      />,
    );

    await waitFor(() => expect(capturedOnSubmit).not.toBeNull());
    await act(async () => {
      await capturedOnSubmit!({ name: 'Renamed', accountType: 'CHEQUING', description: '' });
    });

    expect(mockUpdate).toHaveBeenCalledWith(
      'a-1',
      expect.objectContaining({ description: null }),
    );
  });

  // REV-20260803-010. A cleared recognition field arrived as '' and the
  // strip-empties cleanup deleted it, so the stored value stayed active: removing
  // an overpayment category from a mortgage silently kept it, and later ordinary
  // transactions in that category went on being read as 100% principal.
  describe('recognition fields on a debt account', () => {
    const debtAccount = {
      id: 'loan-1',
      accountType: 'MORTGAGE',
      interestCategoryId: 'cat-int',
      overpaymentCategoryId: 'cat-over',
      overpaymentPayeeId: 'payee-1',
      overpaymentMemo: 'EXTRA',
    } as Account;

    async function submitWith(data: Record<string, unknown>, editingItem: Account) {
      mockUpdate.mockResolvedValue({});
      render(
        <AccountFormModal
          formModal={buildFormModal({ editingItem, isEditing: true })}
          onSaved={vi.fn()}
        />,
      );
      await waitFor(() => expect(capturedOnSubmit).not.toBeNull());
      await act(async () => {
        await capturedOnSubmit!(data);
      });
    }

    it('sends null for each field the user cleared', async () => {
      await submitWith(
        {
          name: 'Mortgage',
          accountType: 'MORTGAGE',
          interestCategoryId: '',
          overpaymentCategoryId: '',
          overpaymentPayeeId: '',
          overpaymentMemo: '',
        },
        debtAccount,
      );

      expect(mockUpdate).toHaveBeenCalledWith(
        'loan-1',
        expect.objectContaining({
          interestCategoryId: null,
          overpaymentCategoryId: null,
          overpaymentPayeeId: null,
          overpaymentMemo: null,
        }),
      );
    });

    it('leaves an untouched field alone', async () => {
      await submitWith(
        {
          name: 'Mortgage',
          accountType: 'MORTGAGE',
          interestCategoryId: 'cat-int',
          overpaymentCategoryId: '',
          overpaymentPayeeId: 'payee-1',
          overpaymentMemo: 'EXTRA',
        },
        debtAccount,
      );

      const payload = mockUpdate.mock.calls[0][1];
      expect(payload.overpaymentCategoryId).toBeNull();
      expect(payload.interestCategoryId).toBe('cat-int');
      expect(payload.overpaymentPayeeId).toBe('payee-1');
      expect(payload.overpaymentMemo).toBe('EXTRA');
    });

    it('does not null recognition fields on a non-debt account type', async () => {
      // The issue #806 hazard: these controls only exist on LOAN/MORTGAGE, so on
      // any other type an absent value means "not rendered", not "cleared".
      // Force-nulling from absence is what wiped institutions before.
      await submitWith(
        { name: 'Chequing', accountType: 'CHEQUING' },
        { ...debtAccount, accountType: 'CHEQUING' } as Account,
      );

      const payload = mockUpdate.mock.calls[0][1];
      expect(payload).not.toHaveProperty('interestCategoryId');
      expect(payload).not.toHaveProperty('overpaymentCategoryId');
      expect(payload).not.toHaveProperty('overpaymentPayeeId');
      expect(payload).not.toHaveProperty('overpaymentMemo');
    });

    it('does not send null for a field that was never set', async () => {
      await submitWith(
        { name: 'Mortgage', accountType: 'MORTGAGE', overpaymentMemo: '' },
        { id: 'loan-1', accountType: 'MORTGAGE' } as Account,
      );

      expect(mockUpdate.mock.calls[0][1]).not.toHaveProperty('overpaymentMemo');
    });
  });

  it('clears a previously set account number by sending null when blanked on edit', async () => {
    mockUpdate.mockResolvedValue({});
    render(
      <AccountFormModal
        formModal={buildFormModal({
          editingItem: { id: 'a-1', accountType: 'CHEQUING', accountNumber: '12345' } as Account,
          isEditing: true,
        })}
        onSaved={vi.fn()}
      />,
    );

    await waitFor(() => expect(capturedOnSubmit).not.toBeNull());
    await act(async () => {
      await capturedOnSubmit!({ name: 'Renamed', accountType: 'CHEQUING', accountNumber: '' });
    });

    expect(mockUpdate).toHaveBeenCalledWith(
      'a-1',
      expect.objectContaining({ accountNumber: null }),
    );
  });

  it('clears a previously set institution when the form reports an explicit null', async () => {
    mockUpdate.mockResolvedValue({});
    render(
      <AccountFormModal
        formModal={buildFormModal({
          editingItem: { id: 'a-1', accountType: 'CHEQUING', institutionId: 'inst-1' } as Account,
          isEditing: true,
        })}
        onSaved={vi.fn()}
      />,
    );

    await waitFor(() => expect(capturedOnSubmit).not.toBeNull());
    await act(async () => {
      await capturedOnSubmit!({ name: 'Renamed', accountType: 'CHEQUING', institutionId: null });
    });

    expect(mockUpdate).toHaveBeenCalledWith(
      'a-1',
      expect.objectContaining({ institutionId: null }),
    );
  });

  it('keeps the stored institution when institutionId is merely absent on edit (issue #806)', async () => {
    mockUpdate.mockResolvedValue({});
    render(
      <AccountFormModal
        formModal={buildFormModal({
          editingItem: { id: 'a-1', accountType: 'INVESTMENT', institutionId: 'inst-1' } as Account,
          isEditing: true,
        })}
        onSaved={vi.fn()}
      />,
    );

    await waitFor(() => expect(capturedOnSubmit).not.toBeNull());
    await act(async () => {
      await capturedOnSubmit!({ name: 'Renamed', accountType: 'INVESTMENT', institutionId: undefined });
    });

    const [, payload] = mockUpdate.mock.calls[0];
    expect(payload).not.toHaveProperty('institutionId');
  });

  it('omits an empty description when the account never had one', async () => {
    mockUpdate.mockResolvedValue({});
    render(
      <AccountFormModal
        formModal={buildFormModal({
          editingItem: { id: 'a-1', accountType: 'CHEQUING' } as Account,
          isEditing: true,
        })}
        onSaved={vi.fn()}
      />,
    );

    await waitFor(() => expect(capturedOnSubmit).not.toBeNull());
    await act(async () => {
      await capturedOnSubmit!({ name: 'Renamed', accountType: 'CHEQUING', description: '' });
    });

    const [, payload] = mockUpdate.mock.calls[0];
    expect(payload).not.toHaveProperty('description');
  });
});
