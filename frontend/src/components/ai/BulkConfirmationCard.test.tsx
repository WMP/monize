import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@/test/render';
import { BulkConfirmationCard } from './BulkConfirmationCard';
import type { PendingAction } from '@/types/ai';

function makeAction(overrides: Partial<PendingAction> = {}): PendingAction {
  return {
    actionId: 'bulk-1',
    type: 'create_transactions',
    status: 'pending',
    expiresAt: Date.now() + 60_000,
    signature: 'sig',
    descriptor: { type: 'create_transactions' },
    preview: {
      rows: [
        {
          status: 'ok',
          accountName: 'Checking',
          amount: -12.5,
          currencyCode: 'USD',
          transactionDate: '2026-01-15',
          payeeName: 'Starbucks',
          categoryName: 'Dining',
        },
        {
          status: 'error',
          accountName: 'Nope',
          transactionDate: '2026-01-16',
          error: 'Unknown account: Nope',
        },
      ],
    },
    ...overrides,
  };
}

describe('BulkConfirmationCard', () => {
  it('renders all rows, flags the bad one, and shows a valid/skipped summary', () => {
    render(
      <BulkConfirmationCard
        action={makeAction()}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(
      screen.getByText('Create these transactions?'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Starbucks/)).toBeInTheDocument();
    // Flagged row shows its error and a skipped badge.
    expect(screen.getByText('Unknown account: Nope')).toBeInTheDocument();
    expect(screen.getByText('Skipped')).toBeInTheDocument();
    // "1 transaction · 1 skipped" summary.
    expect(screen.getByText(/1 transaction.*1 skipped/)).toBeInTheDocument();
  });

  it('approves all valid rows via the single button', () => {
    const onConfirm = vi.fn();
    render(
      <BulkConfirmationCard
        action={makeAction()}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Approve all' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('disables approval when no row is valid', () => {
    render(
      <BulkConfirmationCard
        action={makeAction({
          preview: {
            rows: [{ status: 'error', error: 'bad', transactionDate: 'x' }],
          },
        })}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Approve all' }),
    ).toBeDisabled();
  });

  it('shows a created count and skipped note on success', () => {
    render(
      <BulkConfirmationCard
        action={makeAction({
          status: 'confirmed',
          resultCount: 1,
          resultSkipped: [{ index: 1, reason: 'Unknown account' }],
        })}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/1 transaction created/)).toBeInTheDocument();
    expect(screen.getByText(/1 row skipped/)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'View transaction' }),
    ).toBeInTheDocument();
  });

  it('renders investment rows with action and quantity', () => {
    render(
      <BulkConfirmationCard
        action={makeAction({
          type: 'create_investment_transactions',
          preview: {
            rows: [
              {
                status: 'ok',
                investmentAction: 'BUY',
                symbol: 'AAPL',
                transactionDate: '2026-01-15',
                quantity: 10,
                price: 150,
                totalAmount: 1500,
                securityCurrency: 'USD',
              },
            ],
          },
        })}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(
      screen.getByText('Create these investment transactions?'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Buy AAPL/)).toBeInTheDocument();
  });

  describe('batch_actions envelope', () => {
    it('renders an update batch with the edit title and success copy', () => {
      const { rerender } = render(
        <BulkConfirmationCard
          action={makeAction({
            type: 'batch_actions',
            descriptor: { type: 'batch_actions', operation: 'update' },
          })}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      expect(
        screen.getByText('Apply these transaction edits?'),
      ).toBeInTheDocument();

      rerender(
        <BulkConfirmationCard
          action={makeAction({
            type: 'batch_actions',
            descriptor: { type: 'batch_actions', operation: 'update' },
            status: 'confirmed',
            resultCount: 1,
          })}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      expect(screen.getByText(/1 transaction updated/)).toBeInTheDocument();
    });

    it('renders a delete batch with the delete title', () => {
      render(
        <BulkConfirmationCard
          action={makeAction({
            type: 'batch_actions',
            descriptor: { type: 'batch_actions', operation: 'delete' },
          })}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      expect(
        screen.getByText('Delete these transactions?'),
      ).toBeInTheDocument();
    });

    it('renders a transfer batch with From → To rows and transfer title', () => {
      render(
        <BulkConfirmationCard
          action={makeAction({
            type: 'batch_actions',
            descriptor: { type: 'batch_actions', operation: 'create_transfer' },
            preview: {
              rows: [
                {
                  status: 'ok',
                  fromAccountName: 'Checking',
                  toAccountName: 'Savings',
                  amount: 200,
                  currencyCode: 'USD',
                  toAmount: 200,
                  toCurrencyCode: 'USD',
                  transactionDate: '2026-03-01',
                },
              ],
            },
          })}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      expect(screen.getByText('Create these transfers?')).toBeInTheDocument();
      expect(screen.getByText(/Checking → Savings/)).toBeInTheDocument();
    });

    it('appends a custom payee to a transfer row secondary line', () => {
      render(
        <BulkConfirmationCard
          action={makeAction({
            type: 'batch_actions',
            descriptor: { type: 'batch_actions', operation: 'create_transfer' },
            preview: {
              rows: [
                {
                  status: 'ok',
                  fromAccountName: 'Checking',
                  toAccountName: 'Savings',
                  amount: 200,
                  currencyCode: 'USD',
                  toAmount: 200,
                  toCurrencyCode: 'USD',
                  transactionDate: '2026-03-01',
                  payeeName: 'Shared rent',
                },
              ],
            },
          })}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      expect(screen.getByText(/Shared rent/)).toBeInTheDocument();
    });

    it('appends the new-payee marker to a transfer row whose label will be created', () => {
      render(
        <BulkConfirmationCard
          action={makeAction({
            type: 'batch_actions',
            descriptor: { type: 'batch_actions', operation: 'create_transfer' },
            preview: {
              rows: [
                {
                  status: 'ok',
                  fromAccountName: 'Checking',
                  toAccountName: 'Savings',
                  amount: 200,
                  currencyCode: 'USD',
                  toAmount: 200,
                  toCurrencyCode: 'USD',
                  transactionDate: '2026-03-01',
                  payeeName: 'Brand New Label',
                  payeeWillBeCreated: true,
                },
              ],
            },
          })}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      expect(
        screen.getByText(/Brand New Label \(new payee\)/),
      ).toBeInTheDocument();
    });
  });

  it('shows retry on error and an expired notice', () => {
    const onConfirm = vi.fn();
    const { rerender } = render(
      <BulkConfirmationCard
        action={makeAction({ status: 'error', errorMessage: 'Server error' })}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText('Server error')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    rerender(
      <BulkConfirmationCard
        action={makeAction({ status: 'expired' })}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(
      screen.getByText('This confirmation expired. Ask again to retry.'),
    ).toBeInTheDocument();
  });
});
