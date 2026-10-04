import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@/test/render';
import { ProcessAllButton } from './ProcessAllButton';

const api = vi.hoisted(() => ({ processBatch: vi.fn() }));
vi.mock('@/lib/email-receipts-api', () => ({ emailReceiptsApi: { receipts: api } }));
vi.mock('@/lib/apiCache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/apiCache')>()),
  clearAllCache: vi.fn(),
}));
vi.mock('@/lib/aiActionSignal', () => ({ notifyAiAction: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
  });
  await act(async () => {});
}

const answer = (over: Record<string, unknown> = {}) => ({
  processed: 3,
  byOutcome: { review: 2, unmatched: 1 },
  failed: 0,
  remaining: 0,
  since: 'T',
  ...over,
});

describe('ProcessAllButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('names how many emails it would process', () => {
    render(<ProcessAllButton count={12} />);
    expect(screen.getByRole('button', { name: 'Process all (12)' })).toBeEnabled();
  });

  it.each([[0], [null]])('is off when the count is %s', (count) => {
    render(<ProcessAllButton count={count} />);
    expect(screen.getByRole('button', { name: /Process all/ })).toBeDisabled();
  });

  it('asks first, and processes nothing when cancelled', async () => {
    render(<ProcessAllButton count={3} />);
    await click(screen.getByRole('button', { name: 'Process all (3)' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Process 3 stored emails?');
    await click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(api.processBatch).not.toHaveBeenCalled();
  });

  it('runs the bulk call for the chosen sender, reports where the emails ended and tells the page', async () => {
    api.processBatch.mockResolvedValue(answer());
    const onFinished = vi.fn();
    render(<ProcessAllButton count={3} domain="shop.example.com" onFinished={onFinished} />);
    await click(screen.getByRole('button', { name: 'Process all (3)' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('from shop.example.com');
    await click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Process' }));
    expect(api.processBatch).toHaveBeenCalledWith({ domain: 'shop.example.com' });
    expect(onFinished).toHaveBeenCalledTimes(1);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('3 emails processed.');
    expect(status).toHaveTextContent('2 In review');
    expect(status).toHaveTextContent('1 No transaction found');
  });

  it('says how many were passed over because they raised an error', async () => {
    api.processBatch.mockResolvedValue(answer({ failed: 2 }));
    render(<ProcessAllButton count={3} />);
    await click(screen.getByRole('button', { name: 'Process all (3)' }));
    await click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Process' }));
    expect(screen.getByRole('status')).toHaveTextContent('2 emails raised an error and were passed over.');
  });

  it('shows progress with Cancel while it runs', async () => {
    let release!: (value: unknown) => void;
    api.processBatch.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    render(<ProcessAllButton count={3} />);
    await click(screen.getByRole('button', { name: 'Process all (3)' }));
    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Process' }));
    });
    expect(screen.getByRole('status')).toHaveTextContent('Starting...');
    expect(screen.getByRole('button', { name: /Process all/ })).toBeDisabled();
    await click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Cancelling...' })).toBeDisabled();
    await act(async () => {
      release(answer({ remaining: 8 }));
    });
    expect(screen.getByRole('status')).toHaveTextContent('Cancelled after 3 emails.');
  });

  it('shows the progress of a run that has more to do', async () => {
    let release!: (value: unknown) => void;
    api.processBatch
      .mockResolvedValueOnce(answer({ remaining: 5 }))
      .mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    render(<ProcessAllButton count={8} />);
    await click(screen.getByRole('button', { name: 'Process all (8)' }));
    await click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Process' }));
    expect(screen.getByRole('status')).toHaveTextContent('3 emails processed, 5 left.');
    await act(async () => {
      release(answer({ remaining: 0, processed: 5, byOutcome: { review: 5 } }));
    });
    expect(screen.getByRole('status')).toHaveTextContent('8 emails processed.');
  });

  it('names the reason when a call fails and keeps what was done', async () => {
    api.processBatch.mockRejectedValue(Object.assign(new Error('x'), { response: { data: { message: 'Mailbox is busy' } } }));
    render(<ProcessAllButton count={3} />);
    await click(screen.getByRole('button', { name: 'Process all (3)' }));
    await click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Process' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Processing stopped: Mailbox is busy');
    await click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says a request failed when it gave no reason', async () => {
    api.processBatch.mockRejectedValue(new Error(''));
    render(<ProcessAllButton count={3} />);
    await click(screen.getByRole('button', { name: 'Process all (3)' }));
    await click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Process' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Processing stopped because a request failed.');
  });
});
