import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@/test/render';
import { useAuthStore } from '@/store/authStore';
import type { Warranty } from '@/types/warranty';
import { WarrantyDetailCard } from './WarrantyDetailCard';

function warranty(overrides: Partial<Warranty> = {}): Warranty {
  return {
    id: 'w-1',
    name: 'Laptop',
    vendorName: 'Best Buy',
    payeeId: 'p-1',
    modelNumber: 'XPS-13',
    serialNumbers: ['SN-1', 'SN-2'],
    warrantyKind: 'extended',
    purchaseDate: '2026-10-01',
    expiresOn: '2028-10-01',
    isLifetime: false,
    purchasePrice: 1299.99,
    currencyCode: 'CAD',
    productUrl: 'https://example.com/laptop',
    notes: 'Keep the box',
    today: '2026-10-21',
    status: 'active',
    daysLeft: 711,
    documentCount: 0,
    openClaimCount: 0,
    linkedTransactionHidden: false,
    transactionId: 'tx-1',
    linkedTransaction: {
      id: 'tx-1',
      transactionDate: '2026-10-01',
      payeeName: 'Best Buy',
      // A decimal crosses the wire as a string.
      amount: '-1299.9900' as unknown as number,
      currencyCode: 'CAD',
      accountId: 'acc-1',
    },
    archivedAt: null,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

describe('WarrantyDetailCard', () => {
  afterEach(() => {
    cleanup();
    useAuthStore.setState({ actingAsUserId: null });
  });

  it('shows what the warranty is from the server view', () => {
    render(<WarrantyDetailCard warranty={warranty()} />);
    expect(screen.getByText('711 days left')).toBeInTheDocument();
    expect(screen.getByText('Extended')).toBeInTheDocument();
    expect(screen.getByText('XPS-13')).toBeInTheDocument();
    expect(screen.getByText('SN-1')).toBeInTheDocument();
    expect(screen.getByText('SN-2')).toBeInTheDocument();
    expect(screen.getByText('$1,299.99 CAD')).toBeInTheDocument();
    expect(screen.getByText('Keep the box')).toBeInTheDocument();
  });

  it('links the vendor to its payee, and leaves a typed vendor as text', () => {
    const { rerender } = render(<WarrantyDetailCard warranty={warranty()} />);
    expect(screen.getByRole('link', { name: 'Best Buy' })).toHaveAttribute('href', '/payees/p-1');

    rerender(
      <WarrantyDetailCard
        warranty={warranty({ payeeId: null, vendorName: 'Corner shop', linkedTransaction: null, transactionId: undefined })}
      />,
    );
    expect(screen.getByText('Corner shop')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Corner shop' })).not.toBeInTheDocument();
  });

  it('opens the product page in a new tab without a handle on this one', () => {
    render(<WarrantyDetailCard warranty={warranty()} />);
    const link = screen.getByRole('link', { name: /example\.com\/laptop/ });
    expect(link).toHaveAttribute('href', 'https://example.com/laptop');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('never makes a link of an address that is not http or https', () => {
    render(<WarrantyDetailCard warranty={warranty({ productUrl: 'javascript:alert(1)' })} />);
    expect(screen.getByText('javascript:alert(1)')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /javascript/ })).not.toBeInTheDocument();
  });

  it('says Lifetime with no days left for a lifetime warranty', () => {
    render(
      <WarrantyDetailCard
        warranty={warranty({ isLifetime: true, expiresOn: null, status: 'lifetime', daysLeft: null })}
      />,
    );
    expect(screen.getByText('Lifetime')).toBeInTheDocument();
    expect(screen.queryByText('Time left')).not.toBeInTheDocument();
  });

  it('says None for the fields that are not filled in', () => {
    render(
      <WarrantyDetailCard
        warranty={warranty({
          vendorName: null,
          payeeId: null,
          modelNumber: null,
          serialNumbers: [],
          purchasePrice: null,
          currencyCode: null,
          productUrl: null,
          notes: null,
        })}
      />,
    );
    expect(screen.getAllByText('None')).toHaveLength(6);
  });

  it('links the purchase to the register with its date, payee and amount in its currency', () => {
    render(<WarrantyDetailCard warranty={warranty()} />);
    const link = screen.getByRole('link', {
      name: 'Open the transaction of 10/01/2026: Best Buy, -$1,299.99 CAD',
    });
    expect(link).toHaveAttribute('href', '/transactions?targetTransactionId=tx-1');
  });

  it('says there is no linked transaction when the owner has none', () => {
    render(<WarrantyDetailCard warranty={warranty({ transactionId: undefined, linkedTransaction: null })} />);
    expect(screen.getByText('No linked transaction')).toBeInTheDocument();
    expect(screen.queryByText(/cannot read/)).not.toBeInTheDocument();
  });

  it('tells a delegate the purchase is in an account they cannot read, not that there is none', () => {
    useAuthStore.setState({ actingAsUserId: 'owner-1' });
    render(
      <WarrantyDetailCard
        warranty={warranty({ transactionId: undefined, linkedTransaction: null, linkedTransactionHidden: true })}
      />,
    );
    expect(screen.getByText('The purchase is in an account you cannot read.')).toBeInTheDocument();
    expect(screen.queryByText('No linked transaction')).not.toBeInTheDocument();
  });

  it('tells a delegate there is no linked transaction when the server says none is hidden', () => {
    useAuthStore.setState({ actingAsUserId: 'owner-1' });
    render(<WarrantyDetailCard warranty={warranty({ transactionId: undefined, linkedTransaction: null })} />);
    expect(screen.getByText('No linked transaction')).toBeInTheDocument();
    expect(screen.queryByText(/cannot read/)).not.toBeInTheDocument();
  });

  it('shows a delegate the purchase when the server sent it', () => {
    useAuthStore.setState({ actingAsUserId: 'owner-1' });
    render(<WarrantyDetailCard warranty={warranty()} />);
    expect(screen.getByRole('link', { name: /Best Buy.*1,299\.99/ })).toHaveAttribute(
      'href',
      '/transactions?targetTransactionId=tx-1',
    );
  });
});
