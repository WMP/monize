import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@/test/render';
import { AiReviewRow } from './AiReviewRow';
import { makeReviewItem, PROPOSED_ACTION } from './ai-review-fixtures';
import type { AiReviewItem } from '@/types/ai-review';

function renderRow(item: AiReviewItem) {
  return render(
    <table>
      <tbody>
        <AiReviewRow item={item} dismissing={false} onApprove={vi.fn()} onDismiss={vi.fn()} />
      </tbody>
    </table>,
  );
}

const emailReceiptItem = (overrides: Partial<AiReviewItem> = {}) =>
  makeReviewItem({
    kind: 'email_receipt',
    ruleId: null,
    ruleName: null,
    instruction: 'Enrich this transaction from the order email',
    emailReceipt: {
      id: 'r-1',
      fromAddress: 'orders@allegro.pl',
      subject: 'Your order 123',
      receivedAt: '2026-09-01T10:00:00.000Z',
    },
    ...overrides,
  });

describe('AiReviewRow', () => {
  it('names the rule for a request a rule raised', () => {
    renderRow(makeReviewItem());
    expect(screen.getByText('Rule: Allegro orders')).toBeInTheDocument();
    expect(screen.queryByText(/Email receipt/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View email receipts' })).not.toBeInTheDocument();
  });

  it('says it was requested manually for a request with neither rule nor email', () => {
    renderRow(makeReviewItem({ ruleId: null, ruleName: null }));
    expect(screen.getByText('Requested manually')).toBeInTheDocument();
  });

  it('shows the subject and sender of the email instead of the rule or manual line', () => {
    renderRow(emailReceiptItem());
    expect(screen.getByText(/Email receipt: Your order 123 from orders@allegro\.pl/)).toBeInTheDocument();
    expect(screen.queryByText('Requested manually')).not.toBeInTheDocument();
    expect(screen.queryByText(/^Rule:/)).not.toBeInTheDocument();
  });

  it('links to the receipts page from an email receipt row', () => {
    renderRow(emailReceiptItem());
    expect(screen.getByRole('link', { name: 'View email receipts' })).toHaveAttribute('href', '/email-receipts?tab=emails');
  });

  it('shows the email as it is, as plain text', () => {
    const { container } = renderRow(
      emailReceiptItem({
        emailReceipt: { id: 'r-1', fromAddress: 'x@y.example', subject: '<b>Hi</b>', receivedAt: '2026-09-01T10:00:00.000Z' },
      }),
    );
    expect(screen.getByText(/Email receipt: <b>Hi<\/b> from x@y\.example/)).toBeInTheDocument();
    expect(container.querySelector('b')).toBeNull();
  });

  it('says the email was deleted when the request outlived it, and still links to the receipts page', () => {
    renderRow(emailReceiptItem({ emailReceipt: null }));
    expect(screen.getByText(/Email receipt \(the email was deleted\)/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View email receipts' })).toBeInTheDocument();
  });

  it('keeps the transaction link and the instruction on an email receipt row', () => {
    renderRow(emailReceiptItem());
    expect(screen.getByText('Enrich this transaction from the order email')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View transaction' })).toHaveAttribute(
      'href',
      '/transactions?targetTransactionId=tx-1',
    );
  });

  describe('a pending email receipt request', () => {
    it('says it waits for an AI agent and links to the AI settings', () => {
      renderRow(emailReceiptItem({ status: 'pending' }));
      expect(screen.getByText(/Waiting for an AI agent\./)).toBeInTheDocument();
      expect(screen.getByText(/or let an MCP client claim it\./)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Connect an AI provider in Settings' })).toHaveAttribute(
        'href',
        '/settings/ai',
      );
    });

    it.each(['claimed', 'proposed', 'applied', 'rejected', 'expired'] as const)(
      'says nothing about waiting once the request is %s',
      (status) => {
        renderRow(emailReceiptItem({ status }));
        expect(screen.queryByText(/Waiting for an AI agent/)).not.toBeInTheDocument();
      },
    );

    it('says nothing for a pending request a rule raised', () => {
      renderRow(makeReviewItem({ status: 'pending' }));
      expect(screen.queryByText(/Waiting for an AI agent/)).not.toBeInTheDocument();
    });
  });

  describe('a parser draft request (kind email_parser_draft)', () => {
    const draftItem = (overrides: Partial<AiReviewItem> = {}) =>
      makeReviewItem({
        kind: 'email_parser_draft',
        ruleId: null,
        ruleName: null,
        transactionId: null,
        transaction: null,
        instruction: 'The user asked for a receipt parser for the order emails attached to this request.',
        parserDraft: { domain: 'shop.example.com', emailCount: 3, parserId: null },
        status: 'pending',
        ...overrides,
      });

    it('names the number of emails and the sender instead of a transaction', () => {
      renderRow(draftItem());
      expect(screen.getByText('Parser draft from 3 emails (shop.example.com)')).toBeInTheDocument();
      expect(screen.queryByText('This transaction no longer exists')).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'View transaction' })).not.toBeInTheDocument();
    });

    it('says one email when it names one', () => {
      renderRow(draftItem({ parserDraft: { domain: 'shop.example.com', emailCount: 1, parserId: null } }));
      expect(screen.getByText('Parser draft from 1 email (shop.example.com)')).toBeInTheDocument();
    });

    it('does not print the fixed instruction an agent reads', () => {
      renderRow(draftItem());
      expect(screen.queryByText(/The user asked for a receipt parser/)).not.toBeInTheDocument();
    });

    it('shows the created date where a transaction date would be', () => {
      renderRow(draftItem());
      const cells = screen.getAllByRole('cell');
      expect(cells[0]).not.toBeEmptyDOMElement();
      expect(cells[2]).toBeEmptyDOMElement();
    });

    it('links to the emails', () => {
      renderRow(draftItem());
      expect(screen.getByRole('link', { name: 'View email receipts' })).toHaveAttribute('href', '/email-receipts?tab=emails');
    });

    it('says a pending one waits for an AI agent, with the link to the AI settings', () => {
      renderRow(draftItem());
      expect(screen.getByText(/Waiting for an AI agent\./)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Connect an AI provider in Settings' })).toHaveAttribute('href', '/settings/ai');
    });

    it('says a proposed one is a draft parser ready, with a link to where it is tested and approved', () => {
      renderRow(
        draftItem({
          status: 'proposed',
          parserDraft: { domain: 'shop.example.com', emailCount: 3, parserId: 'p-1' },
        }),
      );
      expect(screen.getByText(/Draft parser ready\./)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Test and approve it in the parser settings' })).toHaveAttribute(
        'href',
        '/email-receipts?tab=profiles',
      );
      expect(screen.queryByText(/Waiting for an AI agent/)).not.toBeInTheDocument();
    });

    it.each(['claimed', 'applied', 'rejected', 'expired'] as const)('says neither of those once it is %s', (status) => {
      renderRow(draftItem({ status }));
      expect(screen.queryByText(/Waiting for an AI agent/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Draft parser ready/)).not.toBeInTheDocument();
    });

    it('shows no confirmation card: approving the parser in the settings is what applies it', () => {
      renderRow(draftItem({ status: 'proposed', parserDraft: { domain: 'shop.example.com', emailCount: 3, parserId: 'p-1' } }));
      expect(screen.getAllByRole('row')).toHaveLength(1);
    });

    it('can be dismissed while it is open, and only then', () => {
      const onDismiss = vi.fn();
      const { rerender } = render(
        <table>
          <tbody>
            <AiReviewRow item={draftItem()} dismissing={false} onApprove={vi.fn()} onDismiss={onDismiss} />
          </tbody>
        </table>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
      expect(onDismiss).toHaveBeenCalledWith(expect.objectContaining({ kind: 'email_parser_draft' }));

      rerender(
        <table>
          <tbody>
            <AiReviewRow item={draftItem({ status: 'applied' })} dismissing={false} onApprove={vi.fn()} onDismiss={onDismiss} />
          </tbody>
        </table>,
      );
      expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();
    });

    it('shows an agent\'s note, as for any request', () => {
      renderRow(draftItem({ agentNote: { reason: 'The emails were empty', at: '2026-09-02T10:00:00.000Z' } }));
      expect(screen.getByText('Note from the assistant: The emails were empty')).toBeInTheDocument();
    });
  });
  describe('selection', () => {
    const proposed = (overrides: Partial<AiReviewItem> = {}) =>
      emailReceiptItem({ status: 'proposed', proposal: { action: PROPOSED_ACTION }, ...overrides });

    function renderSelectable(item: AiReviewItem, props: { selected?: boolean; onToggleSelected?: () => void } = {}) {
      return render(
        <table>
          <tbody>
            <AiReviewRow
              item={item}
              dismissing={false}
              selectable
              selected={props.selected ?? false}
              onToggleSelected={props.onToggleSelected}
              onApprove={vi.fn()}
              onDismiss={vi.fn()}
            />
          </tbody>
        </table>,
      );
    }

    it('draws a checkbox named after the email subject for a proposal that can be approved', () => {
      const onToggle = vi.fn();
      renderSelectable(proposed(), { onToggleSelected: onToggle });
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select Your order 123' }));
      expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ id: 'req-1' }));
    });

    it('shows the selected state', () => {
      renderSelectable(proposed(), { selected: true });
      expect(screen.getByRole('checkbox')).toBeChecked();
    });

    it('leaves the cell empty for a request that cannot be approved', () => {
      renderSelectable(emailReceiptItem());
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    });

    it('spans the card row across the extra column', () => {
      const { container } = renderSelectable(proposed());
      expect(container.querySelector('td[colspan="5"]')).not.toBeNull();
    });
  });
});
