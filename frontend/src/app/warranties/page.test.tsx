import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor, within } from '@/test/render';
import toast from 'react-hot-toast';
import type { Warranty, WarrantyListResult, WarrantySummary } from '@/types/warranty';
import WarrantiesPage from './page';

// Stable router, as the real hook returns; the search params are per test.
const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  prefetch: vi.fn(),
  refresh: vi.fn(),
}));
let mockSearch = '';
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/warranties',
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

vi.mock('@/components/auth/ProtectedRoute', () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/layout/PageLayout', () => ({
  PageLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));
// The search box's debounce is the hook's own concern (and its own test).
vi.mock('@/hooks/useDebouncedValue', () => ({ useDebouncedValue: <T,>(value: T) => value }));

const FORM_PAYLOAD = { name: 'Phone', purchaseDate: '2026-10-01', isLifetime: true };
// The form is loaded through dynamic(); a stub shows what the page handed it.
vi.mock('next/dynamic', () => ({
  default: () =>
    function WarrantyFormStub(props: any) {
      return (
        <div data-testid="warranty-form">
          {props.warranty && <span data-testid="editing">{props.warranty.name}</span>}
          {props.prefill && <span data-testid="prefill">{JSON.stringify(props.prefill)}</span>}
          <button type="button" onClick={() => Promise.resolve(props.onSubmit(FORM_PAYLOAD)).catch(() => {})}>
            Submit stub
          </button>
        </div>
      );
    },
}));

const mockList = vi.fn();
const mockSummary = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockArchive = vi.fn();
const mockUnarchive = vi.fn();
vi.mock('@/lib/warranties', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/warranties')>()),
  warrantiesApi: {
    list: (...args: unknown[]) => mockList(...args),
    summary: (...args: unknown[]) => mockSummary(...args),
    create: (...args: unknown[]) => mockCreate(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
    archive: (...args: unknown[]) => mockArchive(...args),
    unarchive: (...args: unknown[]) => mockUnarchive(...args),
  },
}));

const mockGetTransaction = vi.fn();
vi.mock('@/lib/transactions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/transactions')>()),
  transactionsApi: { getById: (...args: unknown[]) => mockGetTransaction(...args) },
}));

const TX_ID = '11111111-1111-4111-8111-111111111111';

function warranty(overrides: Partial<Warranty> = {}): Warranty {
  return {
    id: 'w-1',
    name: 'Laptop',
    vendorName: 'Best Buy',
    payeeId: null,
    modelNumber: null,
    serialNumbers: [],
    warrantyKind: 'manufacturer',
    purchaseDate: '2026-10-01',
    expiresOn: '2026-11-10',
    isLifetime: false,
    purchasePrice: null,
    currencyCode: null,
    productUrl: null,
    notes: null,
    today: '2026-10-21',
    status: 'expiring',
    daysLeft: 20,
    documentCount: 0,
    openClaimCount: 1,
    linkedTransaction: null,
    archivedAt: null,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

function page(rows: Warranty[], total = rows.length): WarrantyListResult {
  return {
    data: rows,
    pagination: { page: 1, limit: 50, total, totalPages: Math.ceil(total / 50), hasMore: false },
  };
}

const SUMMARY: WarrantySummary = {
  today: '2026-10-21',
  windowDays: 30,
  counts: { lifetime: 4, active: 7, expiring: 2, expired: 3 },
  total: 16,
};

async function renderPage() {
  await act(async () => {
    render(<WarrantiesPage />);
  });
}

function lastListParams() {
  return mockList.mock.calls[mockList.mock.calls.length - 1][0];
}

describe('WarrantiesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearch = '';
    mockList.mockResolvedValue(page([warranty()]));
    mockSummary.mockResolvedValue(SUMMARY);
    mockCreate.mockResolvedValue(warranty());
    mockUpdate.mockResolvedValue(warranty());
    mockDelete.mockResolvedValue(undefined);
    mockArchive.mockResolvedValue(warranty());
    mockUnarchive.mockResolvedValue(warranty());
  });

  it('lists the current warranties sorted by expiry, with the summary strip', async () => {
    await renderPage();
    expect(screen.getByRole('heading', { name: 'Warranties' })).toBeInTheDocument();
    expect(mockList).toHaveBeenCalledWith({
      status: 'all',
      q: undefined,
      archived: false,
      sort: 'expiresOn',
      page: 1,
      limit: 50,
      transactionId: undefined,
    });
    expect(screen.getByText('Laptop')).toBeInTheDocument();
    expect(screen.getByText('20 days left')).toBeInTheDocument();
    expect(screen.getByText('Within 30 days')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('1 warranty')).toBeInTheDocument();
  });

  it('shows a spinner until the first page arrives', async () => {
    mockList.mockReturnValue(new Promise(() => {}));
    await renderPage();
    expect(screen.getByText('Loading warranties...')).toBeInTheDocument();
  });

  it('says the summary was not loaded rather than showing zeros', async () => {
    mockSummary.mockRejectedValue(new Error('500'));
    await renderPage();
    expect(screen.getAllByText('Not loaded')).toHaveLength(4);
    expect(screen.queryByText('Within 30 days')).not.toBeInTheDocument();
  });

  it('offers to add the first warranty when there are none', async () => {
    mockList.mockResolvedValue(page([]));
    await renderPage();
    expect(screen.getByText('No warranties yet')).toBeInTheDocument();
    const adds = screen.getAllByRole('button', { name: 'Add warranty' });
    await act(async () => {
      fireEvent.click(adds[adds.length - 1]);
    });
    expect(screen.getByTestId('warranty-form')).toBeInTheDocument();
  });

  it('filters by status from the pills, from the first page', async () => {
    await renderPage();
    const pills = screen.getByRole('group', { name: 'Filter by status' });
    expect(within(pills).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    mockList.mockResolvedValue(page([]));
    await act(async () => {
      fireEvent.click(within(pills).getByRole('button', { name: 'Expired' }));
    });
    expect(lastListParams()).toMatchObject({ status: 'expired', page: 1 });
    expect(within(pills).getByRole('button', { name: 'Expired' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('No warranties match')).toBeInTheDocument();
  });

  it('searches through q', async () => {
    await renderPage();
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Search warranties'), { target: { value: ' SN-42 ' } });
    });
    expect(lastListParams()).toMatchObject({ q: 'SN-42', page: 1 });
  });

  it('switches to the archived warranties', async () => {
    await renderPage();
    mockList.mockResolvedValue(page([]));
    await act(async () => {
      fireEvent.click(screen.getByRole('switch', { name: 'Show archived' }));
    });
    expect(lastListParams()).toMatchObject({ archived: true });
    expect(screen.getByText('No archived warranties')).toBeInTheDocument();
  });

  it('asks the server for another sort', async () => {
    await renderPage();
    await act(async () => {
      fireEvent.click(screen.getByRole('columnheader', { name: /Name/ }));
    });
    expect(lastListParams()).toMatchObject({ sort: 'name' });
  });

  it('keeps showing the newest request when an older one answers last', async () => {
    let resolveFirst!: (value: WarrantyListResult) => void;
    mockList.mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)));
    await renderPage();
    mockList.mockResolvedValueOnce(page([warranty({ id: 'w-2', name: 'Camera', status: 'expired', daysLeft: -2 })]));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Expired' }));
    });
    expect(screen.getByText('Camera')).toBeInTheDocument();
    await act(async () => {
      resolveFirst(page([warranty()]));
    });
    expect(screen.getByText('Camera')).toBeInTheDocument();
    expect(screen.queryByText('Laptop')).not.toBeInTheDocument();
  });

  it('says a failed load failed, and tries again', async () => {
    mockList.mockRejectedValueOnce(new Error('500'));
    await renderPage();
    expect(screen.getByRole('alert')).toHaveTextContent('Your warranties could not be loaded.');
    expect(screen.queryByText('No warranties yet')).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    });
    expect(screen.getByText('Laptop')).toBeInTheDocument();
  });

  it('creates a warranty and reloads the list and the summary', async () => {
    await renderPage();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add warranty' }));
    });
    expect(screen.getByRole('dialog', { name: 'New warranty' })).toBeInTheDocument();
    const listCalls = mockList.mock.calls.length;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Submit stub' }));
    });
    expect(mockCreate).toHaveBeenCalledWith(FORM_PAYLOAD);
    expect(toast.success).toHaveBeenCalledWith('Warranty added');
    expect(mockList.mock.calls.length).toBe(listCalls + 1);
    expect(mockSummary).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('warranty-form')).not.toBeInTheDocument();
  });

  it('keeps the form open when the create fails', async () => {
    // An error with no server message falls back to the page's own words.
    mockCreate.mockRejectedValue({ response: { data: {} } });
    await renderPage();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add warranty' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Submit stub' }));
    });
    expect(toast.error).toHaveBeenCalledWith('The warranty could not be added');
    expect(screen.getByTestId('warranty-form')).toBeInTheDocument();
  });

  it('edits a warranty from its row', async () => {
    await renderPage();
    await act(async () => {
      fireEvent.click(screen.getByText('Laptop').closest('tr')!);
    });
    expect(screen.getByRole('dialog', { name: 'Edit warranty' })).toBeInTheDocument();
    expect(screen.getByTestId('editing')).toHaveTextContent('Laptop');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Submit stub' }));
    });
    expect(mockUpdate).toHaveBeenCalledWith('w-1', FORM_PAYLOAD);
    expect(toast.success).toHaveBeenCalledWith('Warranty updated');
  });

  it('archives a warranty', async () => {
    await renderPage();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    });
    expect(mockArchive).toHaveBeenCalledWith('w-1');
    expect(toast.success).toHaveBeenCalledWith('Warranty archived');
  });

  it('restores an archived warranty', async () => {
    mockList.mockResolvedValue(page([warranty({ archivedAt: '2026-10-20T00:00:00Z' })]));
    await renderPage();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Unarchive' }));
    });
    expect(mockUnarchive).toHaveBeenCalledWith('w-1');
    expect(toast.success).toHaveBeenCalledWith('Warranty restored');
  });

  it('deletes only after the confirmation', async () => {
    await renderPage();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    });
    expect(mockDelete).not.toHaveBeenCalled();
    const dialog = screen.getByText('Delete "Laptop"? Its claims and documents are deleted with it, and this cannot be undone.')
      .closest('[role="dialog"]') as HTMLElement;
    expect(dialog).not.toBeNull();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    });
    expect(mockDelete).toHaveBeenCalledWith('w-1');
    expect(toast.success).toHaveBeenCalledWith('Warranty deleted');
  });

  it('filters to one transaction from the link, and the chip clears it', async () => {
    mockSearch = `transactionId=${TX_ID}`;
    await renderPage();
    expect(lastListParams()).toMatchObject({ transactionId: TX_ID });
    expect(screen.getByText('Warranties for one transaction')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Show all warranties' }));
    });
    expect(router.replace).toHaveBeenCalledWith('/warranties');
    expect(lastListParams().transactionId).toBeUndefined();
    expect(screen.queryByText('Warranties for one transaction')).not.toBeInTheDocument();
  });

  it('ignores a transaction id that is not a UUID', async () => {
    mockSearch = 'transactionId=not-an-id';
    await renderPage();
    expect(lastListParams().transactionId).toBeUndefined();
  });

  it('opens the form filled from the transaction on ?new=1', async () => {
    mockSearch = `new=1&transactionId=${TX_ID}`;
    mockGetTransaction.mockResolvedValue({
      id: TX_ID,
      transactionDate: '2026-10-01',
      payeeId: 'p-1',
      payeeName: 'Best Buy',
      payee: { id: 'p-1', name: 'Best Buy' },
      description: 'Laptop and case',
      // The API sends a decimal as a string.
      amount: '-1299.9900',
      currencyCode: 'CAD',
    });
    await renderPage();
    expect(mockGetTransaction).toHaveBeenCalledWith(TX_ID);
    const prefill = JSON.parse(screen.getByTestId('prefill').textContent!);
    expect(prefill).toEqual({
      name: 'Best Buy',
      vendorName: 'Best Buy',
      payeeId: 'p-1',
      transactionId: TX_ID,
      purchaseDate: '2026-10-01',
      purchasePrice: 1299.99,
      currencyCode: 'CAD',
    });
    expect(router.replace).toHaveBeenCalledWith(`/warranties?transactionId=${TX_ID}`);
  });

  it('names a payee-less purchase by its description', async () => {
    mockSearch = `new=1&transactionId=${TX_ID}`;
    mockGetTransaction.mockResolvedValue({
      id: TX_ID,
      transactionDate: '2026-10-01',
      payeeId: null,
      payeeName: null,
      payee: null,
      description: 'Laptop and case',
      amount: '-50',
      currencyCode: 'USD',
    });
    await renderPage();
    const prefill = JSON.parse(screen.getByTestId('prefill').textContent!);
    expect(prefill).toMatchObject({ name: 'Laptop and case', vendorName: null, payeeId: null });
  });

  it('opens a blank form and says so when the transaction cannot be loaded', async () => {
    mockSearch = `new=1&transactionId=${TX_ID}`;
    mockGetTransaction.mockRejectedValue(new Error('404'));
    await renderPage();
    await waitFor(() => expect(screen.getByTestId('warranty-form')).toBeInTheDocument());
    expect(screen.queryByTestId('prefill')).not.toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith('That transaction could not be loaded, so the warranty starts blank');
  });
});
