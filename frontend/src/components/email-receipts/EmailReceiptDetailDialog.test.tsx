import { describe, it, expect, vi, beforeEach } from 'vitest';
import toast from 'react-hot-toast';
import { render, screen, fireEvent, act, within } from '@/test/render';
import { EmailReceiptDetailDialog } from './EmailReceiptDetailDialog';
import { makeDetail, PARSED_RECEIPT } from './email-receipts-fixtures';

const api = vi.hoisted(() => ({ get: vi.fn(), link: vi.fn() }));
const txApi = vi.hoisted(() => ({ getAll: vi.fn() }));
vi.mock('@/lib/email-receipts-api', () => ({ emailReceiptsApi: { receipts: api } }));
vi.mock('@/lib/transactions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/transactions')>()),
  transactionsApi: txApi,
}));
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

const onClose = vi.fn();
const onChanged = vi.fn();
const labels = new Map([['cat-1', 'Electronics: Cables']]);

const candidate = (id: string, amount: number, description: string | null = null) => ({
  id,
  date: '2026-08-30',
  amount,
  currencyCode: 'USD',
  payeeName: 'Allegro',
  description,
});

async function renderDialog(categoryLabels: ReadonlyMap<string, string> | null = labels) {
  await act(async () => {
    render(
      <EmailReceiptDetailDialog receiptId="r-1" categoryLabels={categoryLabels} onClose={onClose} onChanged={onChanged} />,
    );
  });
  await act(async () => {});
}

describe('EmailReceiptDetailDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockResolvedValue(makeDetail());
    txApi.getAll.mockResolvedValue({
      data: [
        { id: 'tx-p', transactionDate: '2026-09-02', payeeName: 'Allegro', amount: '-25.0000', currencyCode: 'USD', description: null, isTransfer: false, isVoid: false },
      ],
      pagination: { page: 1, limit: 50, total: 1, totalPages: 1, hasMore: false },
    });
  });

  it('loads the email and shows its headers', async () => {
    await renderDialog();
    expect(api.get).toHaveBeenCalledWith('r-1');
    const dialog = screen.getByRole('dialog', { name: 'Email receipt' });
    expect(within(dialog).getByText('orders@allegro.pl')).toBeInTheDocument();
    expect(within(dialog).getByText('Your order 123')).toBeInTheDocument();
    expect(within(dialog).getByText('No transaction found')).toBeInTheDocument();
    expect(within(dialog).getByText('None')).toBeInTheDocument();
  });

  it('shows the text as plain text in a scrollable block, never as markup', async () => {
    api.get.mockResolvedValue(
      makeDetail({ bodyText: 'Hello <b>bold</b> <img src=x onerror=alert(1)> <script>alert(1)</script>' }),
    );
    await renderDialog();
    // This text holds five tags, so it is offered as HTML by default (in the sandboxed
    // frame); the Text view shows the same characters as characters.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Text' }));
    });
    const text = screen.getByLabelText('Text of the email');
    expect(text.tagName).toBe('PRE');
    expect(text.className).toMatch(/overflow-auto/);
    expect(text.textContent).toBe('Hello <b>bold</b> <img src=x onerror=alert(1)> <script>alert(1)</script>');
    expect(text.querySelector('b, img, script')).toBeNull();
  });

  describe('the body of the email', () => {
    const html = '<html><body><h1>Receipt</h1><p>Total <b>25.00</b></p><img src="https://tracker.example/p.gif"></body></html>';

    it('shows the HTML in a frame by default, with no scripts, origin, forms or popups, and says remote images are not loaded', async () => {
      api.get.mockResolvedValue(makeDetail({ bodyText: 'Receipt\nTotal 25.00', bodyHtml: html }));
      await renderDialog();

      const frame = screen.getByTitle('The email as its sender formatted it') as HTMLIFrameElement;
      expect(frame.tagName).toBe('IFRAME');
      // An EMPTY sandbox: every restriction on.
      expect(frame.getAttribute('sandbox')).toBe('');
      expect(frame.getAttribute('srcdoc')).toContain('<h1>Receipt</h1>');
      expect(screen.getByText('Remote images are not loaded.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'HTML' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'Text' })).toHaveAttribute('aria-pressed', 'false');
      expect(screen.queryByLabelText('Text of the email')).not.toBeInTheDocument();
    });

    it('starts the frame\'s document with the CSP meta and the base target, before any of the email', async () => {
      api.get.mockResolvedValue(makeDetail({ bodyHtml: html }));
      await renderDialog();

      const srcdoc = (screen.getByTitle('The email as its sender formatted it') as HTMLIFrameElement).getAttribute('srcdoc') as string;
      expect(
        srcdoc.startsWith(
          `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: cid:; style-src 'unsafe-inline'; font-src data:"><base target="_blank">`,
        ),
      ).toBe(true);
      expect(srcdoc.indexOf('<html>')).toBeGreaterThan(srcdoc.indexOf('<base target="_blank">'));
    });

    it('switches to the plain text and back, and drops the remote-images note in the text view', async () => {
      api.get.mockResolvedValue(makeDetail({ bodyText: 'Receipt\nTotal 25.00', bodyHtml: html }));
      await renderDialog();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Text' }));
      });
      expect(screen.getByLabelText('Text of the email').textContent).toBe('Receipt\nTotal 25.00');
      expect(screen.queryByTitle('The email as its sender formatted it')).not.toBeInTheDocument();
      expect(screen.queryByText('Remote images are not loaded.')).not.toBeInTheDocument();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'HTML' }));
      });
      expect(screen.getByTitle('The email as its sender formatted it')).toBeInTheDocument();
    });

    it('never puts the email\'s HTML into the page itself', async () => {
      api.get.mockResolvedValue(
        makeDetail({ bodyHtml: '<h1 id="injected">Hi</h1><script>window.pwned = 1</script><img src=x onerror="window.pwned = 2">' }),
      );
      await renderDialog();

      expect(document.querySelector('#injected')).toBeNull();
      expect(document.body.querySelector('script')).toBeNull();
      expect((window as unknown as { pwned?: number }).pwned).toBeUndefined();
    });

    it('has no toggle and no frame for an email with no HTML', async () => {
      api.get.mockResolvedValue(makeDetail({ bodyText: 'Plain total 25.00', bodyHtml: null }));
      await renderDialog();

      expect(screen.queryByRole('button', { name: 'HTML' })).not.toBeInTheDocument();
      expect(screen.queryByTitle('The email as its sender formatted it')).not.toBeInTheDocument();
      expect(screen.queryByText('Remote images are not loaded.')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Text of the email').textContent).toBe('Plain total 25.00');
    });

    it('treats a text that is itself HTML, with no HTML part kept, as HTML in the same frame', async () => {
      api.get.mockResolvedValue(makeDetail({ bodyText: '<!DOCTYPE html><html><body><p>Total 25.00</p></body></html>', bodyHtml: null }));
      await renderDialog();

      const frame = screen.getByTitle('The email as its sender formatted it');
      expect(frame.getAttribute('sandbox')).toBe('');
      expect(frame.getAttribute('srcdoc')).toContain('<p>Total 25.00</p>');
      // and the text view still offers the stored text, as text
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Text' }));
      });
      expect(screen.getByLabelText('Text of the email').textContent).toContain('<p>Total 25.00</p>');
    });
  });

  describe('a forwarded email', () => {
    it('says who forwarded it and when the shop sent it, beside the day it arrived', async () => {
      api.get.mockResolvedValue(
        makeDetail({
          forwardedBy: 'alice.example@gmail.example.com',
          originalSentAt: '2026-08-10T08:15:00.000Z',
          effectiveDate: '2026-08-10T08:15:00.000Z',
          receivedAt: '2026-09-10T10:00:00.000Z',
        }),
      );
      await renderDialog();

      const dialog = screen.getByRole('dialog', { name: 'Email receipt' });
      expect(within(dialog).getByText('Forwarded by')).toBeInTheDocument();
      expect(within(dialog).getByText('alice.example@gmail.example.com')).toBeInTheDocument();
      expect(within(dialog).getByText('Sent by the shop')).toBeInTheDocument();
      expect(within(dialog).getByText('Received')).toBeInTheDocument();
    });

    it('says nothing about forwarding for an email that was not', async () => {
      await renderDialog();
      expect(screen.queryByText('Forwarded by')).not.toBeInTheDocument();
      expect(screen.queryByText('Sent by the shop')).not.toBeInTheDocument();
    });

    it('starts the transaction picker around the shop\'s day, not the day it was forwarded', async () => {
      api.get.mockResolvedValue(
        makeDetail({
          status: 'unmatched',
          forwardedBy: 'alice.example@gmail.example.com',
          originalSentAt: '2026-08-10T08:15:00.000Z',
          effectiveDate: '2026-08-10T08:15:00.000Z',
          receivedAt: '2026-09-10T10:00:00.000Z',
        }),
      );
      await renderDialog();

      expect(txApi.getAll).toHaveBeenCalledWith({ startDate: '2026-08-07', endDate: '2026-08-24', limit: 50 });
    });
  });

  it('says so when the email has no text', async () => {
    api.get.mockResolvedValue(makeDetail({ bodyText: '' }));
    await renderDialog();
    expect(screen.getByText('The email has no text.')).toBeInTheDocument();
  });

  it('shows what the parser read, amounts divided by 10000', async () => {
    api.get.mockResolvedValue(
      makeDetail({
        status: 'review',
        displayState: 'proposed',
        parserName: 'Allegro parser',
        matchKind: 'order_id',
        parsed: PARSED_RECEIPT,
        transaction: { id: 'tx-1', date: '2026-08-30', amount: -25, currencyCode: 'USD', payeeName: 'Allegro' },
      }),
    );
    await renderDialog();
    expect(screen.getByText('Waiting for approval')).toBeInTheDocument();
    expect(screen.getByText('Allegro parser')).toBeInTheDocument();
    expect(screen.getByText('Order number', { selector: 'dt' }).nextElementSibling).toHaveTextContent('123');
    expect(screen.getByText('Total').nextElementSibling).toHaveTextContent('$25.00');
    expect(within(screen.getByRole('row', { name: /USB-C cable/ })).getByText('$19.98')).toBeInTheDocument();
    expect(screen.getByText('Electronics: Cables')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View transaction' })).toHaveAttribute(
      'href',
      '/transactions?targetTransactionId=tx-1',
    );
  });

  it('says nothing has been read, rather than showing an empty result, when there is no parse', async () => {
    await renderDialog();
    expect(screen.getByText('Nothing has been read from this email yet.')).toBeInTheDocument();
  });

  it('says why the email is in its state, and the review request note', async () => {
    api.get.mockResolvedValue(
      makeDetail({
        status: 'review',
        displayState: 'dismissed',
        statusReason: 'amount_differs',
        requestNote: 'The lines do not add up.',
      }),
    );
    await renderDialog();
    expect(screen.getByText(/The parsed total differs from the transaction amount/)).toBeInTheDocument();
    expect(screen.getByText('Review request (Dismissed): The lines do not add up.')).toBeInTheDocument();
  });

  it('shows a reason it has no sentence for as it is', async () => {
    api.get.mockResolvedValue(makeDetail({ statusReason: 'brand_new_reason' }));
    await renderDialog();
    expect(screen.getByText('Reason: brand_new_reason')).toBeInTheDocument();
  });

  describe('candidates', () => {
    const ambiguous = () =>
      makeDetail({
        status: 'ambiguous',
        candidates: [candidate('tx-a', -25, 'Order 123'), candidate('tx-b', -25)],
      });

    it('lists the transactions that fit, each with a link button', async () => {
      api.get.mockResolvedValue(ambiguous());
      await renderDialog();
      expect(screen.getAllByRole('button', { name: 'Link to this transaction' })).toHaveLength(2);
      expect(screen.getByText('Order 123')).toBeInTheDocument();
    });

    it('draws an address in a candidate\'s description as a link, as the register does', async () => {
      api.get.mockResolvedValue(
        makeDetail({ status: 'ambiguous', candidates: [candidate('tx-a', -25, 'Ticket https://shop.example/orders/123')] }),
      );
      await renderDialog();
      expect(screen.getByRole('link', { name: /shop\.example\/orders\/123/ })).toHaveAttribute(
        'href',
        'https://shop.example/orders/123',
      );
    });

    it('links the email to the chosen transaction, then shows the updated email', async () => {
      api.get.mockResolvedValue(ambiguous());
      api.link.mockResolvedValue(
        makeDetail({
          status: 'review',
          displayState: 'proposed',
          matchKind: 'manual',
          transaction: { id: 'tx-b', date: '2026-08-30', amount: -25, currencyCode: 'USD', payeeName: 'Allegro' },
        }),
      );
      await renderDialog();
      await act(async () => {
        fireEvent.click(screen.getAllByRole('button', { name: 'Link to this transaction' })[1]);
      });
      await act(async () => {});
      expect(api.link).toHaveBeenCalledWith('r-1', 'tx-b');
      expect(toast.success).toHaveBeenCalledWith('Email linked to the transaction');
      expect(onChanged).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Waiting for approval')).toBeInTheDocument();
      expect(screen.getByText('Your choice')).toBeInTheDocument();
    });

    it('names a refusal and stays on the candidates', async () => {
      api.get.mockResolvedValue(ambiguous());
      api.link.mockRejectedValue({ response: { data: { message: 'That transaction is a transfer' } } });
      await renderDialog();
      await act(async () => {
        fireEvent.click(screen.getAllByRole('button', { name: 'Link to this transaction' })[0]);
      });
      await act(async () => {});
      expect(screen.getByRole('alert')).toHaveTextContent('That transaction is a transfer');
      expect(onChanged).not.toHaveBeenCalled();
      expect(screen.getAllByRole('button', { name: 'Link to this transaction' })).toHaveLength(2);
    });

    it('offers no link for an email whose proposal was already applied', async () => {
      api.get.mockResolvedValue(
        makeDetail({ status: 'review', displayState: 'applied', candidates: [candidate('tx-a', -25)] }),
      );
      await renderDialog();
      expect(screen.getByText('Transactions that fit')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Link to this transaction' })).not.toBeInTheDocument();
    });

    it('shows no candidate section when there are none', async () => {
      await renderDialog();
      expect(screen.queryByText('Transactions that fit')).not.toBeInTheDocument();
    });
  });

  describe('choosing a transaction by hand', () => {
    it.each(['unmatched', 'no_parser', 'parse_failed'] as const)('offers the picker for a %s email', async (status) => {
      api.get.mockResolvedValue(makeDetail({ status }));
      await renderDialog();
      expect(screen.getByText('Choose the transaction')).toBeInTheDocument();
      expect(txApi.getAll).toHaveBeenCalledWith({ startDate: '2026-08-29', endDate: '2026-09-15', limit: 50 });
    });

    it.each([
      ['ambiguous', null],
      ['review', 'proposed'],
      ['ignored', null],
      ['skipped', null],
      ['pending', null],
    ] as const)('does not offer it for a %s email', async (status, displayState) => {
      api.get.mockResolvedValue(makeDetail({ status, displayState }));
      await renderDialog();
      expect(screen.queryByText('Choose the transaction')).not.toBeInTheDocument();
      expect(txApi.getAll).not.toHaveBeenCalled();
    });

    it('links the email to the chosen transaction and shows the updated email', async () => {
      api.get.mockResolvedValue(makeDetail({ status: 'unmatched' }));
      api.link.mockResolvedValue(makeDetail({ status: 'review', displayState: 'proposed', matchKind: 'manual' }));
      await renderDialog();
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Link' }));
      });
      await act(async () => {});
      expect(api.link).toHaveBeenCalledWith('r-1', 'tx-p');
      expect(toast.success).toHaveBeenCalledWith('Email linked to the transaction');
      expect(onChanged).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Waiting for approval')).toBeInTheDocument();
      expect(screen.queryByText('Choose the transaction')).not.toBeInTheDocument();
    });

    it('shows the server refusal and keeps the picker', async () => {
      api.get.mockResolvedValue(makeDetail({ status: 'unmatched' }));
      api.link.mockRejectedValue({ response: { data: { message: 'A transfer cannot be linked' } } });
      await renderDialog();
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Link' }));
      });
      await act(async () => {});
      expect(screen.getByRole('alert')).toHaveTextContent('A transfer cannot be linked');
      expect(onChanged).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Link' })).toBeEnabled();
    });
  });

  it('shows a failed load as an error with a retry', async () => {
    api.get.mockRejectedValueOnce(new Error('boom'));
    await renderDialog();
    expect(screen.getByRole('alert')).toHaveTextContent('The email could not be loaded');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    });
    await act(async () => {});
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Your order 123')).toBeInTheDocument();
  });

  it('closes', async () => {
    await renderDialog();
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Close' }).at(-1) as HTMLElement);
    });
    expect(onClose).toHaveBeenCalled();
  });
});
