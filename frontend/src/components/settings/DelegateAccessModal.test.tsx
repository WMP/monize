import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@/test/render';
import { DelegateAccessModal } from './DelegateAccessModal';
import type { DelegateSummary } from '@/lib/delegation';
import type { Account } from '@/types/account';

vi.mock('@/lib/delegation', () => ({
  delegationApi: {
    setGrants: vi.fn(),
    setCapabilities: vi.fn(),
    setSectionGrants: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import { delegationApi } from '@/lib/delegation';

const baseDelegate: DelegateSummary = {
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
  grants: [],
  capabilities: {
    payees: { create: false, edit: false, delete: false },
    categories: { create: false, edit: false, delete: false },
    tags: { create: false, edit: false, delete: false },
  },
};

const accounts = [
  { id: 'a1', name: 'Chequing', accountType: 'CHEQUING' },
] as unknown as Account[];

function renderModal(delegate: DelegateSummary = baseDelegate) {
  const submitRef = { current: null as (() => void) | null };
  const setFormDirty = vi.fn();
  const onSaved = vi.fn();
  const onCancel = vi.fn();
  render(
    <DelegateAccessModal
      delegate={delegate}
      accounts={accounts}
      onCancel={onCancel}
      onSaved={onSaved}
      setFormDirty={setFormDirty}
      submitRef={submitRef}
    />,
  );
  return { submitRef, setFormDirty, onSaved, onCancel };
}

describe('DelegateAccessModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(delegationApi.setGrants).mockResolvedValue();
    vi.mocked(delegationApi.setCapabilities).mockResolvedValue();
    vi.mocked(delegationApi.setSectionGrants).mockResolvedValue();
  });

  it('lists grantable accounts grouped by type', () => {
    renderModal();
    expect(screen.getAllByText('Chequing').length).toBeGreaterThan(0);
    expect(
      screen.getByRole('switch', { name: /Read access to Chequing/i }),
    ).toBeInTheDocument();
  });

  it('Save is disabled until something changes', () => {
    const { setFormDirty } = renderModal();
    expect(screen.getByText('Save')).toBeDisabled();
    expect(setFormDirty).toHaveBeenLastCalledWith(false);
  });

  it('batches a per-account READ grant on Save', async () => {
    renderModal();

    await act(async () => {
      fireEvent.click(
        screen.getByRole('switch', { name: /Read access to Chequing/i }),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Save'));
    });

    await waitFor(() =>
      expect(delegationApi.setGrants).toHaveBeenCalledWith('g1', [
        {
          accountId: 'a1',
          canRead: true,
          canCreate: false,
          canEdit: false,
          canDelete: false,
        },
      ]),
    );
    expect(delegationApi.setCapabilities).not.toHaveBeenCalled();
    expect(delegationApi.setSectionGrants).not.toHaveBeenCalled();
  });

  it('enabling CREATE implies READ', async () => {
    renderModal({
      ...baseDelegate,
      grants: [{ accountId: 'a1', canRead: true }],
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole('switch', { name: /Create access to Chequing/i }),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Save'));
    });

    await waitFor(() =>
      expect(delegationApi.setGrants).toHaveBeenCalledWith('g1', [
        expect.objectContaining({
          accountId: 'a1',
          canRead: true,
          canCreate: true,
        }),
      ]),
    );
  });

  it('batches a granular capability change (Edit Payees)', async () => {
    renderModal();

    fireEvent.click(screen.getByRole('tab', { name: 'Shared data' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('switch', { name: /^Edit Payees$/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Save'));
    });

    await waitFor(() =>
      expect(delegationApi.setCapabilities).toHaveBeenCalledWith('g1', {
        payeesCanEdit: true,
      }),
    );
    expect(delegationApi.setGrants).not.toHaveBeenCalled();
  });

  it('batches Delete Tags independently', async () => {
    renderModal();

    fireEvent.click(screen.getByRole('tab', { name: 'Shared data' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('switch', { name: /^Delete Tags$/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Save'));
    });

    await waitFor(() =>
      expect(delegationApi.setCapabilities).toHaveBeenCalledWith('g1', {
        tagsCanDelete: true,
      }),
    );
  });

  it('batches a section grant on Save', async () => {
    const { onSaved } = renderModal();

    fireEvent.click(screen.getByRole('tab', { name: 'Sections' }));
    await act(async () => {
      fireEvent.click(
        screen.getByRole('switch', { name: /Bills & Deposits section/i }),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Save'));
    });

    await waitFor(() =>
      expect(delegationApi.setSectionGrants).toHaveBeenCalledWith('g1', {
        billsCanRead: true,
      }),
    );
    expect(onSaved).toHaveBeenCalled();
  });

  it('marks the form dirty when a toggle changes', async () => {
    const { setFormDirty } = renderModal();
    await act(async () => {
      fireEvent.click(
        screen.getByRole('switch', { name: /Read access to Chequing/i }),
      );
    });
    expect(setFormDirty).toHaveBeenLastCalledWith(true);
  });
});
