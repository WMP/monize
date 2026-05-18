import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@/test/render';
import { SharedAccessSection } from './SharedAccessSection';
import { __resetModalStateForTesting } from '@/components/ui/Modal';

vi.mock('@/lib/delegation', () => ({
  delegationApi: {
    listDelegates: vi.fn(),
    createDelegate: vi.fn(),
    setGrants: vi.fn(),
    setCapabilities: vi.fn(),
    setSectionGrants: vi.fn(),
    revokeDelegate: vi.fn(),
    resetPassword: vi.fn(),
  },
}));

vi.mock('@/lib/accounts', () => ({
  accountsApi: { getAll: vi.fn() },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import { delegationApi } from '@/lib/delegation';
import { accountsApi } from '@/lib/accounts';
import toast from 'react-hot-toast';

const delegate = {
  id: 'g1',
  status: 'active',
  createdAt: '2026-01-01',
  delegate: {
    id: 'd1',
    email: 'd@e.f',
    firstName: null,
    lastName: null,
    hasPassword: true,
  },
  grants: [{ accountId: 'a1', canRead: true }],
  capabilities: {
    payees: { create: false, edit: true, delete: false },
    categories: { create: false, edit: false, delete: false },
    tags: { create: false, edit: false, delete: false },
  },
  sections: {
    bills: true,
    investments: false,
    budgets: false,
    reports: false,
    ai: false,
  },
};

async function renderSection() {
  await act(async () => {
    render(<SharedAccessSection />);
  });
}

describe('SharedAccessSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetModalStateForTesting();
    vi.mocked(delegationApi.listDelegates).mockResolvedValue([
      { ...delegate },
    ]);
    vi.mocked(accountsApi.getAll).mockResolvedValue([
      { id: 'a1', name: 'Chequing', accountType: 'CHEQUING' },
    ] as never);
  });

  it('lists delegates with a summary of granted access', async () => {
    await renderSection();
    expect(await screen.findByText('d@e.f')).toBeInTheDocument();
    expect(
      screen.getByText(/Sections: 1.*Accounts: 1.*Shared data: 1/),
    ).toBeInTheDocument();
  });

  it('opens the edit-access modal for a delegate', async () => {
    await renderSection();
    await screen.findByText('d@e.f');

    await act(async () => {
      fireEvent.click(screen.getByText('Edit access'));
    });

    expect(
      await screen.findByRole('switch', {
        name: /Read access to Chequing/i,
      }),
    ).toBeInTheDocument();
  });

  it('rejects a password that fails the complexity policy', async () => {
    await renderSection();
    await screen.findByText('d@e.f');

    fireEvent.change(screen.getByPlaceholderText('Delegate email'), {
      target: { value: 'new@x.y' },
    });
    fireEvent.change(
      screen.getByPlaceholderText('Set a password (optional)'),
      { target: { value: 'weak' } },
    );
    await act(async () => {
      fireEvent.click(screen.getByText('Add delegate'));
    });

    expect(toast.error).toHaveBeenCalled();
    expect(delegationApi.createDelegate).not.toHaveBeenCalled();
  });

  it('creates a delegate with a policy-compliant password', async () => {
    vi.mocked(delegationApi.createDelegate).mockResolvedValue({
      id: 'g2',
      delegateUserId: 'd2',
      email: 'new@x.y',
      invited: false,
    });
    await renderSection();
    await screen.findByText('d@e.f');

    fireEvent.change(screen.getByPlaceholderText('Delegate email'), {
      target: { value: 'new@x.y' },
    });
    fireEvent.change(
      screen.getByPlaceholderText('Set a password (optional)'),
      { target: { value: 'StrongPass1!xyz' } },
    );
    await act(async () => {
      fireEvent.click(screen.getByText('Add delegate'));
    });

    await waitFor(() =>
      expect(delegationApi.createDelegate).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'new@x.y',
          password: 'StrongPass1!xyz',
          sendInvite: false,
        }),
      ),
    );
  });

  it('revokes a delegate after confirmation', async () => {
    vi.mocked(delegationApi.revokeDelegate).mockResolvedValue();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await renderSection();
    await screen.findByText('d@e.f');

    await act(async () => {
      fireEvent.click(screen.getByText('Remove'));
    });

    await waitFor(() =>
      expect(delegationApi.revokeDelegate).toHaveBeenCalledWith('g1'),
    );
  });
});
