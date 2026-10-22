import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within, cleanup } from '@/test/render';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/store/authStore';
import type { Attachment } from '@/types/attachment';
import type { Warranty, WarrantyClaim } from '@/types/warranty';
import WarrantyDetailPage from './page';

// Stable router, as the real hook returns.
const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  prefetch: vi.fn(),
  refresh: vi.fn(),
}));
// The route segment; a test of a malformed one swaps it and `beforeEach` puts
// it back.
const W_ID = '22222222-2222-4222-8222-222222222222';
const route = vi.hoisted(() => ({ id: '22222222-2222-4222-8222-222222222222' }));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useParams: () => ({ id: route.id }),
  usePathname: () => `/warranties/${route.id}`,
  useSearchParams: () => new URLSearchParams(),
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

const WARRANTY_PAYLOAD = { name: 'Laptop Pro', purchaseDate: '2026-10-01', isLifetime: true };
const CLAIM_PAYLOAD = { claimDate: '2026-10-21', status: 'open', description: 'Hinge', resolution: null, resolvedOn: null };
// Both forms are loaded through dynamic(); a stub shows which one the page
// opened and submits a fixed payload.
vi.mock('next/dynamic', () => ({
  default: () =>
    function FormStub(props: any) {
      const isClaim = 'today' in props;
      return (
        <div data-testid={isClaim ? 'claim-form' : 'warranty-form'}>
          {props.warranty && <span data-testid="editing">{props.warranty.name}</span>}
          <button
            type="button"
            onClick={() => Promise.resolve(props.onSubmit(isClaim ? CLAIM_PAYLOAD : WARRANTY_PAYLOAD)).catch(() => {})}
          >
            {isClaim ? 'Submit claim stub' : 'Submit warranty stub'}
          </button>
        </div>
      );
    },
}));

const mockGetById = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockArchive = vi.fn();
const mockUnarchive = vi.fn();
const mockListClaims = vi.fn();
const mockCreateClaim = vi.fn();
const mockUpdateClaim = vi.fn();
const mockDeleteClaim = vi.fn();
vi.mock('@/lib/warranties', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/warranties')>()),
  warrantiesApi: {
    getById: (...args: unknown[]) => mockGetById(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
    archive: (...args: unknown[]) => mockArchive(...args),
    unarchive: (...args: unknown[]) => mockUnarchive(...args),
    listClaims: (...args: unknown[]) => mockListClaims(...args),
    createClaim: (...args: unknown[]) => mockCreateClaim(...args),
    updateClaim: (...args: unknown[]) => mockUpdateClaim(...args),
    deleteClaim: (...args: unknown[]) => mockDeleteClaim(...args),
  },
}));

const mockListAttachments = vi.fn();
vi.mock('@/lib/attachments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/attachments')>()),
  attachmentsApi: {
    list: (...args: unknown[]) => mockListAttachments(...args),
    upload: vi.fn(),
    delete: vi.fn(),
    fetchBytes: vi.fn(),
  },
}));

function warranty(overrides: Partial<Warranty> = {}): Warranty {
  return {
    id: W_ID,
    name: 'Laptop',
    vendorName: 'Best Buy',
    payeeId: null,
    modelNumber: 'XPS-13',
    serialNumbers: ['SN-1'],
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
    documentCount: 1,
    openClaimCount: 1,
    linkedTransactionHidden: false,
    transactionId: 'tx-1',
    linkedTransaction: {
      id: 'tx-1',
      transactionDate: '2026-10-01',
      payeeName: 'Best Buy',
      amount: -1299.99,
      currencyCode: 'USD',
      accountId: 'acc-1',
    },
    archivedAt: null,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

const CLAIM: WarrantyClaim = {
  id: 'c-1',
  warrantyId: W_ID,
  claimDate: '2026-10-05',
  status: 'open',
  description: 'Screen flickers',
  resolution: null,
  resolvedOn: null,
  createdAt: '2026-10-05T00:00:00Z',
  updatedAt: '2026-10-05T00:00:00Z',
};

const DOCUMENT: Attachment = {
  id: 'a-1',
  transactionId: null,
  warrantyId: W_ID,
  documentKind: 'receipt',
  filename: 'receipt.pdf',
  contentType: 'application/pdf',
  byteSize: 2048,
  sha256: 'abc',
  createdAt: '2026-10-01T00:00:00Z',
  originalAttachmentId: null,
};

async function renderPage() {
  await act(async () => {
    render(<WarrantyDetailPage />);
  });
}

describe('WarrantyDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    route.id = W_ID;
    mockGetById.mockResolvedValue(warranty());
    mockUpdate.mockResolvedValue(warranty());
    mockDelete.mockResolvedValue(undefined);
    mockArchive.mockResolvedValue(warranty({ archivedAt: '2026-10-21T00:00:00Z' }));
    mockUnarchive.mockResolvedValue(warranty());
    mockListClaims.mockResolvedValue([CLAIM]);
    mockCreateClaim.mockResolvedValue(CLAIM);
    mockUpdateClaim.mockResolvedValue(CLAIM);
    mockDeleteClaim.mockResolvedValue(undefined);
    mockListAttachments.mockResolvedValue([DOCUMENT]);
  });

  afterEach(() => {
    cleanup();
    useAuthStore.setState({ actingAsUserId: null });
  });

  it('heads the page with the name and status, under a way back to the list', async () => {
    await renderPage();
    expect(mockGetById).toHaveBeenCalledWith(W_ID);
    expect(screen.getByRole('heading', { level: 1, name: 'Laptop' })).toBeInTheDocument();
    expect(screen.getByText('Expiring soon')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Warranties' })).toHaveAttribute('href', '/warranties');
  });

  it('sizes the title-row actions as a detail header does', async () => {
    // docs/frontend/ui-conventions.md: a detail page's actions sit on the
    // title row at `size="md"`.
    await renderPage();
    // The header comes first; a claim row below carries its own Edit/Delete.
    for (const name of ['Edit', 'Archive', 'Delete']) {
      expect(screen.getAllByRole('button', { name })[0]).toHaveClass('px-4', 'py-2', 'text-base');
    }
  });

  it('renders a malformed route id as not found, without asking the server', async () => {
    route.id = 'foo';
    await renderPage();
    expect(screen.getByRole('alert')).toHaveTextContent('This warranty was not found.');
    expect(screen.getByRole('link', { name: 'Back to Warranties' })).toHaveAttribute('href', '/warranties');
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(mockGetById).not.toHaveBeenCalled();
    expect(mockListClaims).not.toHaveBeenCalled();
    expect(mockListAttachments).not.toHaveBeenCalled();
  });

  it('shows the status card', async () => {
    await renderPage();
    const card = screen.getByRole('region', { name: 'Details' });
    expect(within(card).getByText('20 days left')).toBeInTheDocument();
    expect(within(card).getByText('Manufacturer')).toBeInTheDocument();
    expect(within(card).getByText('XPS-13')).toBeInTheDocument();
    expect(within(card).getByText('SN-1')).toBeInTheDocument();
  });

  it("lists the warranty's documents through the shared attachment section", async () => {
    await renderPage();
    expect(mockListAttachments).toHaveBeenCalledWith({ warrantyId: W_ID });
    const documents = screen.getByRole('region', { name: 'Documents' });
    expect(within(documents).getByRole('button', { name: 'Preview receipt.pdf' })).toBeInTheDocument();
    expect(within(documents).getByTestId('document-kind-a-1')).toHaveTextContent('Receipt');
    expect(within(documents).getByLabelText('Document type')).toBeInTheDocument();
  });

  it('lists the claims and adds one', async () => {
    await renderPage();
    const claims = screen.getByRole('region', { name: 'Claims' });
    expect(within(claims).getByText('Screen flickers')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(within(claims).getByRole('button', { name: 'Add claim' }));
    });
    expect(screen.getByRole('dialog', { name: 'New claim' })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Submit claim stub' }));
    });
    expect(mockCreateClaim).toHaveBeenCalledWith(W_ID, CLAIM_PAYLOAD);
    // The warranty is read again, so its counts follow the claim.
    expect(mockGetById).toHaveBeenCalledTimes(2);
  });

  it('edits and deletes a claim', async () => {
    await renderPage();
    const claims = screen.getByRole('region', { name: 'Claims' });
    await act(async () => {
      fireEvent.click(within(claims).getByRole('button', { name: 'Edit' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Submit claim stub' }));
    });
    expect(mockUpdateClaim).toHaveBeenCalledWith(W_ID, 'c-1', CLAIM_PAYLOAD);

    await act(async () => {
      fireEvent.click(within(claims).getByRole('button', { name: 'Delete' }));
    });
    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    });
    expect(mockDeleteClaim).toHaveBeenCalledWith(W_ID, 'c-1');
  });

  it('links the purchase to the register', async () => {
    await renderPage();
    expect(screen.getByRole('link', { name: /Open the transaction of .*Best Buy/ })).toHaveAttribute(
      'href',
      '/transactions?targetTransactionId=tx-1',
    );
  });

  it('says there is no linked transaction when there is none', async () => {
    mockGetById.mockResolvedValue(warranty({ transactionId: undefined, linkedTransaction: null }));
    await renderPage();
    expect(screen.getByText('No linked transaction')).toBeInTheDocument();
  });

  it('tells a delegate the purchase is in an account they cannot read', async () => {
    useAuthStore.setState({ actingAsUserId: 'owner-1' });
    mockGetById.mockResolvedValue(
      warranty({ transactionId: undefined, linkedTransaction: null, linkedTransactionHidden: true }),
    );
    await renderPage();
    expect(screen.getByText('The purchase is in an account you cannot read.')).toBeInTheDocument();
    expect(screen.queryByText('No linked transaction')).not.toBeInTheDocument();
  });

  it('tells a delegate there is no linked transaction when the warranty has none', async () => {
    useAuthStore.setState({ actingAsUserId: 'owner-1' });
    mockGetById.mockResolvedValue(warranty({ transactionId: undefined, linkedTransaction: null }));
    await renderPage();
    expect(screen.getByText('No linked transaction')).toBeInTheDocument();
    expect(screen.queryByText(/cannot read/)).not.toBeInTheDocument();
  });

  it('shows a delegate the warranty, its documents and claims without any owner control', async () => {
    useAuthStore.setState({ actingAsUserId: 'owner-1' });
    await renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Laptop' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();

    const documents = screen.getByRole('region', { name: 'Documents' });
    expect(within(documents).getByRole('button', { name: 'Preview receipt.pdf' })).toBeInTheDocument();
    expect(within(documents).getByTestId('document-kind-a-1')).toHaveTextContent('Receipt');
    expect(within(documents).queryByText('Add attachment')).not.toBeInTheDocument();
    expect(within(documents).queryByText('Scan document')).not.toBeInTheDocument();
    expect(within(documents).queryByLabelText('Document type')).not.toBeInTheDocument();

    const claims = screen.getByRole('region', { name: 'Claims' });
    expect(within(claims).getByText('Screen flickers')).toBeInTheDocument();
    expect(within(claims).queryByRole('button', { name: 'Add claim' })).not.toBeInTheDocument();
  });

  it('edits the warranty in a modal', async () => {
    await renderPage();
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    });
    expect(screen.getByRole('dialog', { name: 'Edit warranty' })).toBeInTheDocument();
    expect(screen.getByTestId('editing')).toHaveTextContent('Laptop');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Submit warranty stub' }));
    });
    expect(mockUpdate).toHaveBeenCalledWith(W_ID, WARRANTY_PAYLOAD);
    expect(toast.success).toHaveBeenCalledWith('Warranty updated');
    expect(mockGetById).toHaveBeenCalledTimes(2);
  });

  it('archives a current warranty and unarchives an archived one', async () => {
    await renderPage();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    });
    expect(mockArchive).toHaveBeenCalledWith(W_ID);
    expect(toast.success).toHaveBeenCalledWith('Warranty archived');

    cleanup();
    mockGetById.mockResolvedValue(warranty({ archivedAt: '2026-10-21T00:00:00Z' }));
    await renderPage();
    expect(screen.getByText('Archived')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Unarchive' }));
    });
    expect(mockUnarchive).toHaveBeenCalledWith(W_ID);
  });

  it('deletes the warranty after confirmation and returns to the list', async () => {
    await renderPage();
    // The header's Delete comes first; each claim row carries its own.
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
    });
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Delete "Laptop"?');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    });
    expect(mockDelete).toHaveBeenCalledWith(W_ID);
    expect(router.push).toHaveBeenCalledWith('/warranties');
  });

  it('says the warranty could not be loaded and retries', async () => {
    mockGetById.mockRejectedValueOnce(new Error('404'));
    await renderPage();
    expect(screen.getByRole('alert')).toHaveTextContent('This warranty could not be loaded.');
    expect(screen.getByRole('link', { name: 'Back to Warranties' })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    });
    expect(screen.getByRole('heading', { level: 1, name: 'Laptop' })).toBeInTheDocument();
  });
});
