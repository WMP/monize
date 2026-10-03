import { describe, it, expect, vi, beforeEach } from 'vitest';
import toast from 'react-hot-toast';
import { useRouter } from 'next/navigation';
import { render, screen, fireEvent, act, within } from '@/test/render';
import { EmailReceiptsManager } from './EmailReceiptsManager';
import { makeDetail, makeMailbox, makeReceipt } from './email-receipts-fixtures';
import { peekChatHandoff } from '@/lib/ai-chat-handoff';

const api = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  mailboxGet: vi.fn(),
  draftWithAi: vi.fn(),
  reprocess: vi.fn(),
}));
const assistant = vi.hoisted(() => ({ canAnswer: vi.fn() }));

vi.mock('@/lib/email-receipts-api', () => ({
  emailReceiptsApi: {
    receipts: { list: api.list, get: api.get, reprocess: api.reprocess },
    mailbox: { get: api.mailboxGet },
    parsers: { draftWithAi: api.draftWithAi },
  },
}));
vi.mock('@/lib/assistant-ready', () => ({ assistantCanAnswerNow: assistant.canAnswer }));
vi.mock('@/hooks/useReceiptParserLookups', () => ({
  useReceiptParserLookups: () => ({ state: { status: 'loading' }, reload: vi.fn() }),
}));
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

const shop = (n: number, over: Record<string, unknown> = {}) =>
  makeReceipt({
    id: `r-${n}`,
    subject: `Order ${n}`,
    status: 'no_parser',
    fromAddress: 'orders@shop.example.com',
    fromDomain: 'shop.example.com',
    ...over,
  });

const six = [1, 2, 3, 4, 5, 6].map((n) => shop(n));

async function renderManager() {
  await act(async () => {
    render(<EmailReceiptsManager />);
  });
  await act(async () => {});
}

async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
  });
  await act(async () => {});
}

const checkbox = (subject: string) => screen.getByRole('checkbox', { name: `Select ${subject}` });
const bar = () => screen.queryByRole('region', { name: 'Selected emails' });
const draftButton = (count: number) => screen.getByRole('button', { name: `Draft parser with AI (${count})` });

describe('EmailReceiptsManager: drafting a parser with AI from selected emails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assistant.canAnswer.mockResolvedValue(true);
    api.list.mockResolvedValue(six);
    api.mailboxGet.mockResolvedValue(makeMailbox());
    api.draftWithAi.mockResolvedValue({ ok: true, requestId: 'req-draft' });
    api.get.mockImplementation(async (id: string) =>
      makeDetail({
        id,
        subject: `Order ${id.slice(2)}`,
        fromAddress: 'orders@shop.example.com',
        fromDomain: 'shop.example.com',
        bodyText: `Widget ${id} 12.00`,
        effectiveDate: '2026-08-10T08:15:00.000Z',
        forwardedBy: 'alice.example@gmail.example.com',
      }),
    );
  });

  describe('the selection', () => {
    it('puts a labelled checkbox on every email and no bar until one is ticked', async () => {
      await renderManager();
      for (const n of [1, 2, 3, 4, 5, 6]) expect(checkbox(`Order ${n}`)).not.toBeChecked();
      expect(bar()).not.toBeInTheDocument();
    });

    it('shows the selection bar with the count and a Draft parser with AI (N) button', async () => {
      await renderManager();
      await click(checkbox('Order 1'));
      await click(checkbox('Order 3'));

      expect(bar()).toHaveTextContent('2 emails selected (at most 5)');
      expect(draftButton(2)).toBeEnabled();
    });

    it('says one email when one is ticked', async () => {
      await renderManager();
      await click(checkbox('Order 1'));
      expect(bar()).toHaveTextContent('1 email selected (at most 5)');
    });

    it('stops at five: the others are disabled, the ticked ones stay free to untick', async () => {
      await renderManager();
      for (const n of [1, 2, 3, 4, 5]) await click(checkbox(`Order ${n}`));

      expect(checkbox('Order 6')).toBeDisabled();
      expect(checkbox('Order 5')).toBeEnabled();
      await click(checkbox('Order 5'));
      expect(checkbox('Order 6')).toBeEnabled();
      expect(bar()).toHaveTextContent('4 emails selected');
    });

    it('does not let a skipped email be selected: it has no text to write a parser from', async () => {
      api.list.mockResolvedValue([shop(1), shop(2, { status: 'skipped' })]);
      await renderManager();
      expect(checkbox('Order 2')).toBeDisabled();
    });

    it('warns, without blocking, when the selected emails come from different senders', async () => {
      api.list.mockResolvedValue([shop(1), shop(2, { fromAddress: 'news@other.example.org', fromDomain: 'other.example.org' })]);
      await renderManager();
      await click(checkbox('Order 1'));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      await click(checkbox('Order 2'));

      expect(within(bar() as HTMLElement).getByRole('alert')).toHaveTextContent(
        'different senders (shop.example.com, other.example.org)',
      );
      expect(draftButton(2)).toBeEnabled();
    });

    it('says nothing about senders when they are the same', async () => {
      await renderManager();
      await click(checkbox('Order 1'));
      await click(checkbox('Order 2'));
      expect(screen.queryByText(/different senders/)).not.toBeInTheDocument();
    });

    it('clears the selection from the bar', async () => {
      await renderManager();
      await click(checkbox('Order 1'));
      await click(screen.getByRole('button', { name: 'Clear selection' }));
      expect(bar()).not.toBeInTheDocument();
      expect(checkbox('Order 1')).not.toBeChecked();
    });

    it('clears the selection when the filter changes, so no action can be aimed at an email of the other list', async () => {
      await renderManager();
      await click(checkbox('Order 1'));
      api.list.mockResolvedValueOnce([shop(1), shop(2)]);
      await click(screen.getByRole('button', { name: 'No parser' }));
      expect(bar()).not.toBeInTheDocument();
      expect(checkbox('Order 1')).not.toBeChecked();
    });

    it('drops an email a reload no longer lists from the selection, and keeps the others', async () => {
      api.reprocess.mockResolvedValue(makeDetail());
      await renderManager();
      await click(checkbox('Order 1'));
      await click(checkbox('Order 2'));
      // An action on another email reloads the list; email 1 is gone from it.
      api.list.mockResolvedValueOnce([shop(2), shop(3)]);
      const row = screen.getByRole('row', { name: /Order 3/ });
      await click(within(row).getByRole('button', { name: 'More actions' }));
      await click(screen.getByRole('menuitem', { name: 'Reprocess' }));

      expect(bar()).toHaveTextContent('1 email selected');
      expect(checkbox('Order 2')).toBeChecked();
    });
  });

  describe('drafting from the selection', () => {
    it('queues one request for the selected emails in list order, then opens the chat with each attached and a message staged', async () => {
      await renderManager();
      await click(checkbox('Order 3'));
      await click(checkbox('Order 1'));
      await click(draftButton(2));

      expect(api.draftWithAi).toHaveBeenCalledTimes(1);
      // list order, not click order
      expect(api.draftWithAi).toHaveBeenCalledWith(['r-1', 'r-3']);
      expect(api.get).toHaveBeenCalledTimes(2);
      expect(toast.success).toHaveBeenCalledWith('Opened the chat with the emails attached. Read the message and press Send.');

      const push = useRouter().push as ReturnType<typeof vi.fn>;
      const url = push.mock.calls.at(-1)?.[0] as string;
      expect(url).toMatch(/^\/ai\?handoff=[0-9a-f-]{36}$/);
      const handoff = peekChatHandoff(url.replace('/ai?handoff=', ''));
      expect(handoff?.files).toHaveLength(2);
      expect(handoff?.files.map((file) => file.name)).toEqual(['order-email-1-2026-08-10.txt', 'order-email-2-2026-08-10.txt']);
      const first = await handoff!.files[0].text();
      expect(first).toContain('Id: r-1');
      expect(first).toContain('Forwarded by: alice.example@gmail.example.com');
      expect(first).toContain('Widget r-1 12.00');
      // The message names the count, the sender and the request to claim, and is only STAGED.
      expect(handoff?.draft).toBe(
        'Build an email receipt parser for these 2 order emails from shop.example.com. Claim AI review request req-draft, test your parser on every attached email with the email_receipt_parsers tool, fix it until each one reads completely, then save it as a draft for request req-draft.',
      );
    });

    it('says "this order email" for one email', async () => {
      await renderManager();
      await click(checkbox('Order 2'));
      await click(draftButton(1));

      const push = useRouter().push as ReturnType<typeof vi.fn>;
      const handoff = peekChatHandoff((push.mock.calls.at(-1)?.[0] as string).replace('/ai?handoff=', ''));
      expect(handoff?.draft).toContain('Build an email receipt parser for this order email from shop.example.com.');
    });

    it('never sends the message: nothing but the router is touched, and the selection is cleared', async () => {
      await renderManager();
      await click(checkbox('Order 1'));
      await click(draftButton(1));
      expect(bar()).not.toBeInTheDocument();
    });

    it('queues the request, opens no chat and says so when no assistant can answer now (no provider)', async () => {
      assistant.canAnswer.mockResolvedValue(false);
      await renderManager();
      await click(checkbox('Order 1'));
      await click(draftButton(1));

      expect(api.draftWithAi).toHaveBeenCalledWith(['r-1']);
      expect(api.get).not.toHaveBeenCalled();
      expect(useRouter().push).not.toHaveBeenCalled();
      const notice = screen.getByRole('status');
      expect(notice).toHaveTextContent('Queued: the request waits in the AI review inbox for an agent');
      expect(within(notice).getByRole('link', { name: 'Open the AI review inbox' })).toHaveAttribute('href', '/ai-reviews');
    });

    it('decides whether the assistant can answer after the request is queued: a relay agent that is not connected leaves it waiting', async () => {
      assistant.canAnswer.mockResolvedValue(false);
      await renderManager();
      await click(checkbox('Order 1'));
      await click(draftButton(1));

      expect(api.draftWithAi.mock.invocationCallOrder[0]).toBeLessThan(assistant.canAnswer.mock.invocationCallOrder[0]);
    });

    it('says the request is queued when the emails could not be read for the chat, and opens no chat', async () => {
      api.get.mockRejectedValueOnce(new Error('down'));
      await renderManager();
      await click(checkbox('Order 1'));
      await click(draftButton(1));

      expect(screen.getByRole('status')).toHaveTextContent('the emails could not be opened in the chat');
      expect(useRouter().push).not.toHaveBeenCalled();
    });

    it("shows the server's refusal and queues nothing, keeping the selection", async () => {
      api.draftWithAi.mockRejectedValue({ response: { data: { message: 'This email could not be read' } } });
      await renderManager();
      await click(checkbox('Order 1'));
      await click(draftButton(1));

      expect(screen.getByRole('alert')).toHaveTextContent('This email could not be read');
      expect(assistant.canAnswer).not.toHaveBeenCalled();
      expect(api.get).not.toHaveBeenCalled();
      expect(useRouter().push).not.toHaveBeenCalled();
      expect(bar()).toBeInTheDocument();
    });

    it('names a failure that carries no message', async () => {
      api.draftWithAi.mockRejectedValue(new Error('network'));
      await renderManager();
      await click(checkbox('Order 1'));
      await click(draftButton(1));
      expect(screen.getByRole('alert')).toHaveTextContent(/Could not start drafting a parser|network/);
    });

    it('waits while the request is in flight: no second press, no change of selection', async () => {
      let resolve!: (value: unknown) => void;
      api.draftWithAi.mockReturnValueOnce(new Promise((r) => (resolve = r)));
      await renderManager();
      await click(checkbox('Order 1'));
      await act(async () => {
        fireEvent.click(draftButton(1));
      });
      expect(draftButton(1)).toBeDisabled();
      expect(checkbox('Order 2')).toBeDisabled();
      await act(async () => {
        resolve({ ok: true, requestId: 'req-1' });
      });
    });
  });

  describe('the row action', () => {
    it('drafts from that one email through the same flow', async () => {
      await renderManager();
      const row = screen.getByRole('row', { name: /Order 4/ });
      await click(within(row).getByRole('button', { name: 'Draft parser with AI' }));

      expect(api.draftWithAi).toHaveBeenCalledWith(['r-4']);
      expect(api.get).toHaveBeenCalledWith('r-4');
      const push = useRouter().push as ReturnType<typeof vi.fn>;
      expect(push.mock.calls.at(-1)?.[0]).toMatch(/^\/ai\?handoff=/);
    });

    it('says it waits in the inbox when no assistant can answer now', async () => {
      assistant.canAnswer.mockResolvedValue(false);
      await renderManager();
      const row = screen.getByRole('row', { name: /Order 4/ });
      await click(within(row).getByRole('button', { name: 'Draft parser with AI' }));

      expect(screen.getByRole('status')).toHaveTextContent('Queued');
      expect(api.get).not.toHaveBeenCalled();
    });
  });
});
