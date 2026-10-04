import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@/test/render';
import { ParserTestPanel } from './ParserTestPanel';
import { makeReceipt, PARSED_RECEIPT } from './email-receipts-fixtures';

const api = vi.hoisted(() => ({ list: vi.fn(), test: vi.fn() }));
vi.mock('@/lib/email-receipts-api', () => ({
  emailReceiptsApi: { receipts: { list: api.list }, parsers: { test: api.test } },
}));
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

const definition = { version: 2 as const, total: ['Total {amount}'] };
const labels = new Map([['cat-1', 'Electronics']]);

async function renderPanel(props: Partial<Parameters<typeof ParserTestPanel>[0]> = {}) {
  await act(async () => {
    render(<ParserTestPanel definition={definition} payeeId="" categoryLabels={labels} {...props} />);
  });
  await act(async () => {});
}

async function choose(id: string) {
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: id } });
  });
}

async function runTest() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
  });
  await act(async () => {});
}

describe('ParserTestPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.list.mockResolvedValue([
      makeReceipt({ id: 'r-1', subject: 'Order 1', fromAddress: 'a@shop.example' }),
      makeReceipt({ id: 'r-2', subject: 'Order 2', fromAddress: 'b@shop.example' }),
    ]);
  });

  it('cannot test a definition that is not there (the JSON does not parse) and says why', async () => {
    await renderPanel({ definition: null });
    await choose('r-1');
    expect(screen.getByText('The JSON is not valid, so there is nothing to test yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Test' })).toBeDisabled();
    expect(api.test).not.toHaveBeenCalled();
  });

  it('offers the stored emails and cannot test until one is chosen', async () => {
    await renderPanel();
    expect(api.list).toHaveBeenCalledWith(undefined, 50);
    expect(screen.getByRole('option', { name: /Order 1 from a@shop\.example/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Test' })).toBeDisabled();
  });

  it('tests the definition on the form against the chosen email, with the payee only when there is one', async () => {
    api.test.mockResolvedValue({
      parsed: PARSED_RECEIPT,
      match: { kind: 'unmatched' },
      candidateCount: 4,
      transaction: null,
    });
    await renderPanel({ payeeId: 'payee-1' });
    await choose('r-2');
    await runTest();
    expect(api.test).toHaveBeenCalledWith({ definition, receiptId: 'r-2', payeeId: 'payee-1' });
  });

  it('lists what matched each value under the result', async () => {
    api.test.mockResolvedValue({
      parsed: PARSED_RECEIPT,
      trace: {
        orderId: null,
        total: { entry: 0, pattern: 'Total {amount}', line: { line: 3, text: 'Total 25.00' } },
        paid: null,
        shipping: null,
        discount: null,
        payee: null,
        requireLine: null,
        skipIfLine: null,
        waitIfLine: null,
        items: [],
      },
      outcome: 'read',
      match: { kind: 'unmatched' },
      candidateCount: 0,
      transaction: null,
    });
    await renderPanel();
    await choose('r-1');
    await runTest();
    expect(screen.getByText('Matched by')).toBeInTheDocument();
    expect(screen.getByText(/entry 1 \(Total \{amount\}\), line 3: Total 25\.00/)).toBeInTheDocument();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it.each([
    ['not_applicable', /would not read this email/],
    ['skip_line', /would set this email aside/],
    ['wait_line', /would hold this email/],
  ])('says when a guard (%s) would stop the pipeline reading the email', async (outcome, text) => {
    api.test.mockResolvedValue({
      parsed: PARSED_RECEIPT,
      outcome,
      match: { kind: 'unmatched' },
      candidateCount: 0,
      transaction: null,
    });
    await renderPanel();
    await choose('r-1');
    await runTest();
    expect(screen.getByRole('note')).toHaveTextContent(text);
  });

  it('shows no trace from a server that sent none', async () => {
    api.test.mockResolvedValue({ parsed: PARSED_RECEIPT, match: { kind: 'unmatched' }, candidateCount: 0, transaction: null });
    await renderPanel();
    await choose('r-1');
    await runTest();
    expect(screen.queryByText('Matched by')).not.toBeInTheDocument();
  });

  it('sends no payee when none is picked', async () => {
    api.test.mockResolvedValue({ parsed: PARSED_RECEIPT, match: { kind: 'unmatched' }, candidateCount: 0, transaction: null });
    await renderPanel();
    await choose('r-1');
    await runTest();
    expect(api.test).toHaveBeenCalledWith({ definition, receiptId: 'r-1' });
  });

  it('shows what the parser read with every amount divided by 10000, and the matched transaction as it is', async () => {
    api.test.mockResolvedValue({
      parsed: PARSED_RECEIPT,
      match: { kind: 'matched', transactionId: 'tx-1', matchKind: 'order_id' },
      candidateCount: 1,
      transaction: { id: 'tx-1', date: '2026-08-30', amount: -25, payeeName: 'Allegro' },
    });
    await renderPanel();
    await choose('r-1');
    await runTest();

    expect(screen.getByText('Total').nextElementSibling).toHaveTextContent('25.00');
    expect(screen.getByText('Shipping').nextElementSibling).toHaveTextContent('5.00');
    const row = screen.getByRole('row', { name: /USB-C cable/ });
    expect(within(row).getByText(/19\.98/)).toBeInTheDocument();
    expect(screen.queryByText(/250,000|199,800/)).not.toBeInTheDocument();
    // The transaction's own amount is an ordinary amount: shown once, not divided again.
    expect(screen.getByText(/found by order number/)).toHaveTextContent(/25\.00/);
    expect(screen.getByText(/found by order number/)).toHaveTextContent('Allegro');
    expect(screen.getByText('Electronics')).toBeInTheDocument();
  });

  it('says when several transactions fit and when none does', async () => {
    api.test.mockResolvedValueOnce({
      parsed: PARSED_RECEIPT,
      match: { kind: 'ambiguous', candidateIds: ['a', 'b'] },
      candidateCount: 2,
      transaction: null,
    });
    await renderPanel();
    await choose('r-1');
    await runTest();
    expect(screen.getByText(/2 transactions fit equally well/)).toBeInTheDocument();

    api.test.mockResolvedValueOnce({
      parsed: PARSED_RECEIPT,
      match: { kind: 'unmatched' },
      candidateCount: 1,
      transaction: null,
    });
    await runTest();
    expect(screen.getByText('No transaction matches, out of 1 candidate.')).toBeInTheDocument();
  });

  it('clears the previous result when another email is chosen', async () => {
    api.test.mockResolvedValue({ parsed: PARSED_RECEIPT, match: { kind: 'unmatched' }, candidateCount: 0, transaction: null });
    await renderPanel();
    await choose('r-1');
    await runTest();
    expect(screen.getByText('Transaction match')).toBeInTheDocument();
    await choose('r-2');
    expect(screen.queryByText('Transaction match')).not.toBeInTheDocument();
  });

  it('shows the server refusal, such as a definition that is not valid, as an alert', async () => {
    api.test.mockRejectedValue({ response: { data: { message: 'The parser definition is not valid: total[0]: capture_missing' } } });
    await renderPanel();
    await choose('r-1');
    await runTest();
    expect(screen.getByRole('alert')).toHaveTextContent('capture_missing');
    expect(screen.queryByText('Transaction match')).not.toBeInTheDocument();
  });

  it('preselects the email the parser is being written for', async () => {
    await renderPanel({ initialReceiptId: 'r-2' });
    expect((screen.getByLabelText('Email') as HTMLSelectElement).value).toBe('r-2');
    expect(screen.getByRole('button', { name: 'Test' })).toBeEnabled();
  });

  it('says there is nothing to test against only when the list loaded empty', async () => {
    api.list.mockResolvedValue([]);
    await renderPanel();
    expect(screen.getByText('No emails are stored yet. Poll the mailbox first.')).toBeInTheDocument();
  });

  it('says the list failed rather than that there are no emails', async () => {
    api.list.mockRejectedValue(new Error('boom'));
    await renderPanel();
    expect(screen.getByRole('alert')).toHaveTextContent('could not be loaded');
    expect(screen.queryByText(/No emails are stored yet/)).not.toBeInTheDocument();
  });
});
