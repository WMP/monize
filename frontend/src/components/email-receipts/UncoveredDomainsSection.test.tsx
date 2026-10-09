import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, within } from '@/test/render';
import { UncoveredDomainsSection } from './UncoveredDomainsSection';

const api = vi.hoisted(() => ({ listUncovered: vi.fn() }));
vi.mock('@/lib/email-receipts-api', () => ({ emailReceiptsApi: { receipts: { listUncovered: api.listUncovered } } }));
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

const entry = (domain: string, over: Record<string, unknown> = {}) => ({
  domain,
  count: 3,
  draftParserId: null,
  pendingRequestId: null,
  pendingRequestStatus: null,
  ...over,
});

async function renderSection() {
  await act(async () => {
    render(<UncoveredDomainsSection onSelect={vi.fn()} />);
  });
}

describe('UncoveredDomainsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marks a domain whose request waits in the AI inbox with a "Waiting for AI" badge, and only that one', async () => {
    api.listUncovered.mockResolvedValue([
      entry('allegro.pl', { pendingRequestId: 'req-1', pendingRequestStatus: 'pending' }),
      entry('shop.example.com'),
    ]);
    await renderSection();
    const waiting = screen.getByRole('button', { name: /allegro\.pl/ });
    expect(within(waiting).getByText('Waiting for AI')).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: /shop\.example\.com/ })).queryByText('Waiting for AI')).not.toBeInTheDocument();
  });

  it('shows no badge when no request is waiting', async () => {
    api.listUncovered.mockResolvedValue([entry('allegro.pl')]);
    await renderSection();
    expect(screen.queryByText('Waiting for AI')).not.toBeInTheDocument();
  });
});
