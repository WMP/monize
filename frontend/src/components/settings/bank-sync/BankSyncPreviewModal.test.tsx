import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StrictMode } from 'react';
import { AxiosError, AxiosHeaders } from 'axios';
import toast from 'react-hot-toast';
import { act, fireEvent, render, screen, waitFor, within } from '@/test/render';
import { BankSyncPreviewModal } from './BankSyncPreviewModal';
import type { BankSyncPreview, BankSyncPreviewRow, BankSyncResult } from '@/types/bank-sync';

const mockPreviewAccount = vi.fn();
const mockSyncAccount = vi.fn();

vi.mock('@/lib/bank-sync', () => ({
  bankSyncApi: {
    previewAccount: (...args: unknown[]) => mockPreviewAccount(...args),
    syncAccount: (...args: unknown[]) => mockSyncAccount(...args),
  },
}));

vi.mock('@/hooks/useNumberFormat', async () => {
  const { numberFormatMockDefaults } = await import('@/test/number-format-mock');
  return {
    useNumberFormat: () => ({
      ...numberFormatMockDefaults(),
      formatCurrency: (amount: number, code?: string) => `${code ?? '???'} ${amount.toFixed(2)}`,
      formatNumber: (amount: number) => `n ${amount.toFixed(2)}`,
    }),
  };
});

vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatDate: (d: string) => `on ${d.slice(0, 10)}`,
    dateFormat: 'YYYY-MM-DD',
    datePattern: 'YYYY-MM-DD',
  }),
}));

const FINGERPRINT = 'ab'.repeat(32);

const row = (over: Partial<BankSyncPreviewRow> = {}): BankSyncPreviewRow => ({
  outcome: 'new',
  refusalReason: null,
  transactionDate: '2026-09-10',
  amount: '-50.0000',
  currencyCode: 'PLN',
  payeeText: 'Biedronka',
  description: 'Groceries',
  referenceNumber: null,
  payeeName: 'Biedronka',
  categoryName: 'Food',
  tagNames: [],
  ...over,
});

const preview = (over: Partial<BankSyncPreview> = {}): BankSyncPreview => ({
  bankAccountId: 'ba-1',
  currencyCode: 'PLN',
  rows: [
    row(),
    row({ payeeText: 'Employer', payeeName: 'Employer', categoryName: null, amount: '1200.1234' }),
    row({ outcome: 'duplicate', payeeText: 'Kiosk', payeeName: null, categoryName: null }),
    row({
      outcome: 'refused',
      refusalReason: 'currency_mismatch',
      payeeText: 'Abroad',
      payeeName: null,
      categoryName: null,
      currencyCode: 'EUR',
      amount: '-5.0000',
    }),
    row({ outcome: 'pending', payeeText: 'Later', payeeName: null, categoryName: null }),
    row({ outcome: 'before_cutoff', payeeText: 'Old', payeeName: null, categoryName: null }),
  ],
  summary: {
    new: 2,
    duplicate: 1,
    refused: 1,
    refusedByReason: { currency_mismatch: 1 },
    pending: 1,
    beforeCutoff: 1,
  },
  monizeBalance: '1000.0000',
  balanceAfter: '2150.1234',
  bankBalance: { amount: '2200.1234', currencyCode: 'PLN', referenceDate: '2026-09-29' },
  difference: '50.0000',
  planFingerprint: FINGERPRINT,
  ...over,
});

const result = (over: Partial<BankSyncResult> = {}): BankSyncResult => ({
  bankAccountId: 'ba-1',
  imported: 2,
  skipped: 0,
  refused: {},
  pending: 0,
  beforeCutoff: 0,
  bankBalance: null,
  ...over,
});

const axiosFailure = (status?: number, message = `Server said ${status}`) =>
  new AxiosError(
    'failed',
    status === undefined ? 'ECONNABORTED' : 'ERR_BAD_RESPONSE',
    undefined,
    undefined,
    status === undefined
      ? undefined
      : {
          status,
          statusText: '',
          headers: {},
          config: { headers: new AxiosHeaders() },
          data: { message },
        },
  );

function renderModal(over: { strict?: boolean } = {}) {
  const props = {
    onClose: vi.fn(),
    onImported: vi.fn(),
    onOutcomeUnknown: vi.fn(),
  };
  const modal = (
    <BankSyncPreviewModal isOpen bankAccountId="ba-1" accountName="Checking" {...props} />
  );
  const view = render(over.strict ? <StrictMode>{modal}</StrictMode> : modal);
  return { ...props, ...view };
}

const loaded = async (over: { strict?: boolean } = {}) => {
  let view!: ReturnType<typeof renderModal>;
  await act(async () => {
    view = renderModal(over);
  });
  return view;
};

const tab = (name: RegExp | string) => screen.getByRole('tab', { name });
const bodyRows = () => within(screen.getByRole('tabpanel')).getAllByRole('row').slice(1);

beforeEach(() => {
  vi.clearAllMocks();
  mockPreviewAccount.mockResolvedValue(preview());
});

describe('BankSyncPreviewModal', () => {
  describe('reading the bank', () => {
    it('asks for the preview of the account once, when it opens, and says it is reading', async () => {
      mockPreviewAccount.mockReturnValue(new Promise(() => {}));
      await loaded();
      expect(mockPreviewAccount).toHaveBeenCalledTimes(1);
      expect(mockPreviewAccount).toHaveBeenCalledWith('ba-1');
      expect(screen.getByText('Preview import into Checking')).toBeInTheDocument();
      expect(screen.getByText('Reading the bank...')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Import|Confirm/ })).toBeDisabled();
    });

    it('does not read the bank twice when React runs the effect twice (a read takes the account\'s lease)', async () => {
      await loaded({ strict: true });
      expect(mockPreviewAccount).toHaveBeenCalledTimes(1);
      expect(await screen.findByText('Monize balance now')).toBeInTheDocument();
    });

    it('says nothing is imported until the person confirms', async () => {
      await loaded();
      expect(screen.getByText(/Nothing is imported until you confirm/)).toBeInTheDocument();
    });

    it('shows the server\'s message when the read fails, and reads again on request', async () => {
      mockPreviewAccount.mockRejectedValueOnce(axiosFailure(409, 'A sync of this account is already running.'));
      await loaded();
      expect(await screen.findByRole('alert')).toHaveTextContent('A sync of this account is already running.');
      expect(screen.getByRole('button', { name: /Import|Confirm/ })).toBeDisabled();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      });
      expect(mockPreviewAccount).toHaveBeenCalledTimes(2);
      expect(await screen.findByText('Monize balance now')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('falls back to its own words when the failure carries none', async () => {
      mockPreviewAccount.mockRejectedValueOnce(axiosFailure(503, ''));
      await loaded();
      expect(await screen.findByRole('alert')).toHaveTextContent('Could not preview this account');
    });
  });

  describe('the summary', () => {
    it('shows the Monize balance now and after the import, and the bank balance with its date', async () => {
      await loaded();
      expect(await screen.findByText('PLN 1000.00')).toBeInTheDocument();
      expect(screen.getByText('Monize balance after the import')).toBeInTheDocument();
      expect(screen.getByText('PLN 2150.12')).toBeInTheDocument();
      expect(screen.getByText('PLN 2200.12 as of on 2026-09-29')).toBeInTheDocument();
    });

    it('shows the difference after the import when both balances are known in one currency', async () => {
      await loaded();
      await screen.findByText('Difference after the import');
      expect(screen.getByText('PLN 50.00')).toBeInTheDocument();
    });

    it('shows a known zero difference as a number', async () => {
      mockPreviewAccount.mockResolvedValue(preview({ difference: '0.0000' }));
      await loaded();
      await screen.findByText('Difference after the import');
      expect(screen.getByText('PLN 0.00')).toBeInTheDocument();
    });

    it('says the bank reported no balance, and shows no difference', async () => {
      mockPreviewAccount.mockResolvedValue(preview({ bankBalance: null, difference: null }));
      await loaded();
      expect(await screen.findByText('Not reported by the bank')).toBeInTheDocument();
      expect(screen.queryByText('Difference after the import')).not.toBeInTheDocument();
    });

    it('hides the difference and says why when the bank balance is in another currency', async () => {
      mockPreviewAccount.mockResolvedValue(
        preview({
          bankBalance: { amount: '10.0000', currencyCode: 'EUR', referenceDate: null },
          difference: null,
        }),
      );
      await loaded();
      expect(await screen.findByText('EUR 10.00')).toBeInTheDocument();
      expect(screen.queryByText('Difference after the import')).not.toBeInTheDocument();
      expect(
        screen.getByText(/The bank balance is in EUR and the Monize account is in PLN/),
      ).toBeInTheDocument();
    });
  });

  describe('the rows and the filter tabs', () => {
    it('counts every tab and opens on the new rows', async () => {
      await loaded();
      await screen.findByText('Monize balance now');
      expect(tab('All (6)')).toBeInTheDocument();
      expect(tab('New (2)')).toHaveAttribute('aria-selected', 'true');
      expect(tab('Already imported (1)')).toBeInTheDocument();
      expect(tab('Refused (1)')).toBeInTheDocument();
      expect(tab('Pending (1)')).toBeInTheDocument();
      expect(tab('Before the start date (1)')).toBeInTheDocument();
      expect(bodyRows()).toHaveLength(2);
    });

    it('opens on all rows when nothing is new', async () => {
      mockPreviewAccount.mockResolvedValue(
        preview({
          rows: [row({ outcome: 'duplicate' })],
          summary: { new: 0, duplicate: 1, refused: 0, refusedByReason: {}, pending: 0, beforeCutoff: 0 },
        }),
      );
      await loaded();
      await screen.findByText('Monize balance now');
      expect(tab('All (1)')).toHaveAttribute('aria-selected', 'true');
      expect(bodyRows()).toHaveLength(1);
    });

    it('shows one outcome\'s rows per tab, and all of them under All', async () => {
      await loaded();
      await screen.findByText('Monize balance now');

      fireEvent.click(tab('All (6)'));
      expect(bodyRows()).toHaveLength(6);

      fireEvent.click(tab('Already imported (1)'));
      expect(bodyRows()).toHaveLength(1);
      expect(within(screen.getByRole('tabpanel')).getByText('Kiosk')).toBeInTheDocument();

      fireEvent.click(tab('Refused (1)'));
      expect(within(screen.getByRole('tabpanel')).getByText('Abroad')).toBeInTheDocument();
      expect(within(screen.getByRole('tabpanel')).queryByText('Kiosk')).not.toBeInTheDocument();
    });

    it('shows the date, payee, category, description and signed amount of a new row', async () => {
      await loaded();
      await screen.findByText('Monize balance now');
      const first = bodyRows()[0];
      expect(within(first).getByText('on 2026-09-10')).toBeInTheDocument();
      expect(within(first).getByText('Biedronka')).toBeInTheDocument();
      expect(within(first).getByText('Groceries')).toBeInTheDocument();
      expect(within(first).getByText('Food')).toBeInTheDocument();
      expect(within(first).getByText('PLN -50.00')).toBeInTheDocument();
      expect(within(bodyRows()[1]).getByText('PLN 1200.12')).toBeInTheDocument();
    });

    it('draws an address in the bank\'s description as a link, as the register will once it is imported', async () => {
      mockPreviewAccount.mockResolvedValue(
        preview({ rows: [row({ description: 'Order https://shop.example/o/42 paid' })] }),
      );
      await loaded();
      await screen.findByText('Monize balance now');
      const link = within(bodyRows()[0]).getByRole('link', { name: 'https://shop.example/o/42' });
      expect(link).toHaveAttribute('href', 'https://shop.example/o/42');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('names the outcome of each row with a badge', async () => {
      await loaded();
      await screen.findByText('Monize balance now');
      fireEvent.click(tab('All (6)'));
      const rows = bodyRows();
      // Each status is drawn twice (one for the phone, one from `sm`), so ask by row.
      expect(within(rows[0]).getAllByText('New').length).toBeGreaterThan(0);
      expect(within(rows[2]).getAllByText('Already imported').length).toBeGreaterThan(0);
      expect(within(rows[3]).getAllByText('Other currency').length).toBeGreaterThan(0);
      expect(within(rows[4]).getAllByText('Pending').length).toBeGreaterThan(0);
      expect(within(rows[5]).getAllByText('Before the start date').length).toBeGreaterThan(0);
    });

    it('shows a refused row in the currency the bank sent it in, never the account\'s', async () => {
      await loaded();
      await screen.findByText('Monize balance now');
      fireEvent.click(tab('Refused (1)'));
      expect(within(bodyRows()[0]).getByText('EUR -5.00')).toBeInTheDocument();
    });

    it('names a refusal reason it has no sentence for as refused', async () => {
      mockPreviewAccount.mockResolvedValue(
        preview({
          rows: [row({ outcome: 'refused', refusalReason: 'brand_new_reason', currencyCode: 'PLN' })],
          summary: { new: 0, duplicate: 0, refused: 1, refusedByReason: {}, pending: 0, beforeCutoff: 0 },
        }),
      );
      await loaded();
      await screen.findByText('Monize balance now');
      expect(within(bodyRows()[0]).getAllByText('Refused').length).toBeGreaterThan(0);
    });

    it('shows an amount the bank sent unreadable as unknown, not zero', async () => {
      mockPreviewAccount.mockResolvedValue(
        preview({
          rows: [row({ outcome: 'refused', refusalReason: 'invalid_amount', amount: null })],
          summary: { new: 0, duplicate: 0, refused: 1, refusedByReason: {}, pending: 0, beforeCutoff: 0 },
        }),
      );
      await loaded();
      await screen.findByText('Monize balance now');
      expect(within(bodyRows()[0]).getByText('Unknown')).toBeInTheDocument();
      expect(within(bodyRows()[0]).queryByText(/0\.00/)).not.toBeInTheDocument();
    });

    it('shows a row without a date or a payee as such', async () => {
      mockPreviewAccount.mockResolvedValue(
        preview({
          rows: [row({ transactionDate: null, payeeText: null, payeeName: null, description: null })],
        }),
      );
      await loaded();
      await screen.findByText('Monize balance now');
      const only = bodyRows()[0];
      expect(within(only).getByText('No date')).toBeInTheDocument();
      expect(within(only).getByText('No payee')).toBeInTheDocument();
    });

    it('shows the tags the import rules would add', async () => {
      mockPreviewAccount.mockResolvedValue(preview({ rows: [row({ tagNames: ['Weekly', 'Food'] })] }));
      await loaded();
      await screen.findByText('Monize balance now');
      expect(within(bodyRows()[0]).getByText('Weekly')).toBeInTheDocument();
    });

    it('says so when the bank returned nothing, and when a tab is empty', async () => {
      mockPreviewAccount.mockResolvedValue(
        preview({
          rows: [],
          summary: { new: 0, duplicate: 0, refused: 0, refusedByReason: {}, pending: 0, beforeCutoff: 0 },
        }),
      );
      await loaded();
      expect(
        await screen.findByText('The bank returned no transactions for this period.'),
      ).toBeInTheDocument();
      fireEvent.click(tab('Pending (0)'));
      expect(screen.getByText('No transactions in this list.')).toBeInTheDocument();
    });
  });

  describe('importing', () => {
    it('says how many transactions it would import', async () => {
      await loaded();
      expect(await screen.findByRole('button', { name: 'Import 2 transactions' })).toBeEnabled();
    });

    it('says one in the singular', async () => {
      mockPreviewAccount.mockResolvedValue(
        preview({ summary: { ...preview().summary, new: 1 } }),
      );
      await loaded();
      expect(await screen.findByRole('button', { name: 'Import 1 transaction' })).toBeEnabled();
    });

    it('offers to confirm when there is nothing new, so the link can still be confirmed', async () => {
      mockPreviewAccount.mockResolvedValue(
        preview({ summary: { ...preview().summary, new: 0 } }),
      );
      await loaded();
      expect(
        await screen.findByRole('button', { name: 'Confirm: nothing new to import' }),
      ).toBeEnabled();
    });

    it('syncs with the fingerprint of the preview and hands the result on', async () => {
      mockSyncAccount.mockResolvedValue(result());
      const { onImported } = await loaded();
      await act(async () => {
        fireEvent.click(await screen.findByRole('button', { name: 'Import 2 transactions' }));
      });
      expect(mockSyncAccount).toHaveBeenCalledWith('ba-1', FINGERPRINT);
      await waitFor(() => expect(onImported).toHaveBeenCalledWith(result()));
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('is busy while the import runs, and cannot be fired twice', async () => {
      let resolve!: (value: BankSyncResult) => void;
      mockSyncAccount.mockReturnValue(new Promise<BankSyncResult>((r) => (resolve = r)));
      await loaded();
      await act(async () => {
        fireEvent.click(await screen.findByRole('button', { name: 'Import 2 transactions' }));
      });
      const busy = screen.getByRole('button', { name: 'Importing...' });
      expect(busy).toBeDisabled();
      fireEvent.click(busy);
      expect(mockSyncAccount).toHaveBeenCalledTimes(1);
      await act(async () => {
        resolve(result());
      });
    });

    it('on a 409 says the data changed, imports nothing, and reads the preview again', async () => {
      mockSyncAccount.mockRejectedValue(axiosFailure(409, 'The bank\'s data changed since the preview.'));
      const { onImported } = await loaded();
      mockPreviewAccount.mockResolvedValue(
        preview({
          rows: [row({ payeeText: 'Fresh row', payeeName: 'Fresh row' })],
          summary: { ...preview().summary, new: 1 },
          planFingerprint: 'cd'.repeat(32),
        }),
      );

      await act(async () => {
        fireEvent.click(await screen.findByRole('button', { name: 'Import 2 transactions' }));
      });

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          'The bank\'s data changed since this preview, so nothing was imported. The preview was read again: check it and import once more.',
        ),
      );
      expect(onImported).not.toHaveBeenCalled();
      expect(mockPreviewAccount).toHaveBeenCalledTimes(2);
      // The new answer is on screen, and confirming it uses its fingerprint.
      expect(await screen.findByText('Fresh row')).toBeInTheDocument();
      mockSyncAccount.mockResolvedValue(result({ imported: 1 }));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Import 1 transaction' }));
      });
      expect(mockSyncAccount).toHaveBeenLastCalledWith('ba-1', 'cd'.repeat(32));
    });

    it('shows the server\'s message for any other refusal and keeps the preview', async () => {
      mockSyncAccount.mockRejectedValue(axiosFailure(400, 'The linked account is closed.'));
      const { onImported } = await loaded();
      await act(async () => {
        fireEvent.click(await screen.findByRole('button', { name: 'Import 2 transactions' }));
      });
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('The linked account is closed.'));
      expect(onImported).not.toHaveBeenCalled();
      expect(mockPreviewAccount).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: 'Import 2 transactions' })).toBeEnabled();
    });

    it.each([undefined, 500, 504])(
      'does not claim the result when the import\'s outcome is unknown (%p)',
      async (status) => {
        mockSyncAccount.mockRejectedValue(axiosFailure(status));
        const { onOutcomeUnknown, onImported } = await loaded();
        await act(async () => {
          fireEvent.click(await screen.findByRole('button', { name: 'Import 2 transactions' }));
        });
        await waitFor(() => expect(onOutcomeUnknown).toHaveBeenCalledTimes(1));
        expect(onImported).not.toHaveBeenCalled();
        expect(toast.error).not.toHaveBeenCalled();
      },
    );

    it('closes without importing', async () => {
      const { onClose } = await loaded();
      await screen.findByText('Monize balance now');
      await act(async () => {
        fireEvent.click(screen.getAllByRole('button', { name: 'Close' }).at(-1) as HTMLElement);
      });
      expect(onClose).toHaveBeenCalled();
      expect(mockSyncAccount).not.toHaveBeenCalled();
    });
  });
});
