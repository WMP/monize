import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@/test/render';
import type { Warranty } from '@/types/warranty';
import { TransactionWarrantiesLine } from './TransactionWarrantiesLine';

const mockList = vi.fn();
vi.mock('@/lib/warranties', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/warranties')>()),
  warrantiesApi: {
    list: (...args: unknown[]) => mockList(...args),
  },
}));
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ formatDate: (d: string) => `D(${d})` }),
}));
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

function makeWarranty(overrides: Partial<Warranty> = {}): Warranty {
  return {
    id: 'w-1',
    name: 'Dishwasher',
    vendorName: null,
    payeeId: null,
    modelNumber: null,
    serialNumbers: [],
    warrantyKind: 'manufacturer',
    purchaseDate: '2026-01-10',
    expiresOn: '2028-01-10',
    isLifetime: false,
    purchasePrice: null,
    currencyCode: null,
    productUrl: null,
    notes: null,
    today: '2026-10-21',
    status: 'active',
    daysLeft: 446,
    documentCount: 0,
    openClaimCount: 0,
    linkedTransactionHidden: false,
    transactionId: 'tx-1',
    linkedTransaction: null,
    archivedAt: null,
    createdAt: '2026-01-10T00:00:00Z',
    updatedAt: '2026-01-10T00:00:00Z',
    ...overrides,
  };
}

describe('TransactionWarrantiesLine', () => {
  beforeEach(() => {
    mockList.mockReset();
  });

  it('with no warranties renders the Add button alone and fetches nothing', () => {
    render(
      <TransactionWarrantiesLine transaction={{ id: 'tx-1', warrantyCount: 0 }} onAddWarranty={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Add warranty' })).toBeInTheDocument();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(mockList).not.toHaveBeenCalled();
  });

  it('reads an absent count as none and fetches nothing', () => {
    render(<TransactionWarrantiesLine transaction={{ id: 'tx-1' }} onAddWarranty={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Add warranty' })).toBeInTheDocument();
    expect(mockList).not.toHaveBeenCalled();
  });

  it('Add warranty hands the navigation to the host rather than linking away', () => {
    // A link would leave the edit window without its unsaved-changes check;
    // the host closes the window through its own close path first.
    const onAddWarranty = vi.fn();
    render(
      <TransactionWarrantiesLine transaction={{ id: 'tx-1', warrantyCount: 0 }} onAddWarranty={onAddWarranty} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add warranty' }));
    expect(onAddWarranty).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('link', { name: 'Add warranty' })).not.toBeInTheDocument();
  });

  it('offers no Add when the host supplies no handler', () => {
    render(<TransactionWarrantiesLine transaction={{ id: 'tx-1', warrantyCount: 0 }} />);
    expect(screen.queryByRole('button', { name: 'Add warranty' })).not.toBeInTheDocument();
  });

  it('lists the linked warranties, each a link to its detail', async () => {
    mockList.mockResolvedValue({
      data: [
        makeWarranty(),
        makeWarranty({ id: 'w-2', name: 'Drill', expiresOn: null, isLifetime: true, status: 'lifetime', daysLeft: null }),
      ],
      pagination: { page: 1, limit: 50, total: 2, totalPages: 1, hasMore: false },
    });
    await act(async () => {
      render(
        <TransactionWarrantiesLine transaction={{ id: 'tx-1', warrantyCount: 2 }} onAddWarranty={vi.fn()} />,
      );
    });
    expect(mockList).toHaveBeenCalledWith({ transactionId: 'tx-1' });
    const dishwasher = screen.getByRole('link', { name: /Dishwasher/ });
    expect(dishwasher).toHaveAttribute('href', '/warranties/w-1');
    expect(dishwasher).toHaveTextContent('Active');
    expect(dishwasher).toHaveTextContent('Expires D(2028-01-10)');
    const drill = screen.getByRole('link', { name: /Drill/ });
    expect(drill).toHaveAttribute('href', '/warranties/w-2');
    expect(drill).toHaveTextContent('Lifetime');
    expect(drill).not.toHaveTextContent('Expires');
    expect(screen.getByRole('button', { name: 'Add warranty' })).toBeInTheDocument();
  });

  it('says the list failed rather than showing an empty one', async () => {
    mockList.mockRejectedValue(new Error('boom'));
    await act(async () => {
      render(<TransactionWarrantiesLine transaction={{ id: 'tx-1', warrantyCount: 1 }} />);
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The warranties for this transaction could not be loaded.',
    );
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('shows a loading line until the list arrives', async () => {
    let resolve: (value: unknown) => void = () => {};
    mockList.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<TransactionWarrantiesLine transaction={{ id: 'tx-1', warrantyCount: 1 }} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading warranties');
    await act(async () => {
      resolve({ data: [makeWarranty()], pagination: { page: 1, limit: 50, total: 1, totalPages: 1, hasMore: false } });
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Dishwasher/ })).toBeInTheDocument();
  });
});
