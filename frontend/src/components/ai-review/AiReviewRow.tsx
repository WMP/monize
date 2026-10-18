'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { TransactionConfirmationCard } from '@/components/ai/TransactionConfirmationCard';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import { Td } from '@/components/ui/Table';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useNumberFormat } from '@/hooks/useNumberFormat';
import type { ProposalCardState } from '@/hooks/useAiReviewInbox';
import type { PendingAction } from '@/types/ai';
import {
  draftParserIds,
  isApprovable,
  isReopenable,
  isSendableToAssistant,
  reviewItemLabel,
  type AiReviewItem,
  type AiReviewStatus,
} from '@/types/ai-review';

/** Requests still open: the person may dismiss them. */
const DISMISSIBLE: readonly AiReviewStatus[] = ['pending', 'claimed', 'proposed'];

const STATUS_VARIANT: Record<AiReviewStatus, BadgeVariant> = {
  pending: 'gray',
  claimed: 'blue',
  proposed: 'purple',
  applied: 'green',
  rejected: 'gray',
  expired: 'amber',
};

/** Phone cells are tighter than the desktop's `px-4`. */
const CELL = 'px-2 py-3 align-top sm:px-4';

export interface AiReviewRowProps {
  item: AiReviewItem;
  card?: ProposalCardState;
  dismissing: boolean;
  /** Whether the list offers a selection (a column of checkboxes); a row that can be neither approved nor sent gets an empty cell. */
  selectable?: boolean;
  selected?: boolean;
  onToggleSelected?: (item: AiReviewItem) => void;
  onApprove: (item: AiReviewItem, action: Omit<PendingAction, 'status'>) => void;
  onDismiss: (item: AiReviewItem) => void;
  /** Send a closed request to AI review again; a row without it offers no such action. */
  onReopen?: (item: AiReviewItem) => void;
  reopening?: boolean;
}

/**
 * One request: its transaction, the rule's instruction and status, then, when
 * an agent proposed an edit, the ordinary confirmation card on a row of its own
 * (the split display is the card's, not re-implemented here).
 *
 * A request of kind `email_parser_draft` is about emails, not a transaction: it
 * says how many emails and which sender, waits for an agent while `pending`, and
 * once `proposed` (an agent saved a DRAFT parser) points to the parser settings
 * where the draft is tested and approved. There is no card: approving the parser
 * there marks this request applied.
 */
export function AiReviewRow({
  item,
  card,
  dismissing,
  selectable = false,
  selected = false,
  onToggleSelected,
  onApprove,
  onDismiss,
  onReopen,
  reopening = false,
}: AiReviewRowProps) {
  const t = useTranslations('aiReview');
  const { formatDate } = useDateFormat();
  const { formatCurrency, formatNumber, formatShareQuantity } = useNumberFormat();
  const { transaction, proposal, parserDraft, trade } = item;
  const draftIds = parserDraft ? draftParserIds(parserDraft) : [];

  const action = proposal && 'action' in proposal ? proposal.action : null;
  const proposalError = proposal && 'error' in proposal ? proposal.error : null;
  const showCard = action !== null && (item.status === 'proposed' || card?.status === 'confirmed');
  const rowName = reviewItemLabel(item) ?? t('row.noPayee');
  const canDismiss = DISMISSIBLE.includes(item.status) && !showCard && proposalError === null;
  // A trade request an agent has not answered yet holds no trade and no
  // transaction: it is about an email, not a missing transaction.
  const tradeRequest = item.kind === 'email_trade';
  const tradeCurrency = action?.preview.securityCurrency ?? trade?.currency ?? null;

  return (
    <>
      <tr>
        {selectable && (
          <Td className={`${CELL} w-10`}>
            {(isApprovable(item) || isSendableToAssistant(item) || isReopenable(item)) && (
              <input
                type="checkbox"
                checked={selected}
                onChange={() => onToggleSelected?.(item)}
                aria-label={t('bulk.selectRow', { name: rowName })}
                className="h-4 w-4 cursor-pointer rounded border-gray-300 text-blue-600 focus-visible:ring-blue-500 dark:border-gray-600"
              />
            )}
          </Td>
        )}
        <Td className={`${CELL} whitespace-nowrap`}>
          {transaction
            ? formatDate(transaction.date)
            : trade
              ? formatDate(trade.date)
              : parserDraft || tradeRequest
                ? formatDate(new Date(item.createdAt))
                : ''}
        </Td>
        <Td className={`${CELL} min-w-0 break-words`}>
          <div className="font-medium">
            {parserDraft ? (
              t('row.parserDraft', { count: parserDraft.emailCount, domain: parserDraft.domain })
            ) : trade ? (
              t('row.trade', { action: trade.action, quantity: formatShareQuantity(trade.quantity), symbol: trade.symbol })
            ) : tradeRequest ? (
              // "Not read yet" only while an agent may still answer it; a closed one never will.
              item.status === 'pending' || item.status === 'claimed' ? (
                t('row.tradePending')
              ) : (
                t('row.tradeEmail')
              )
            ) : transaction ? (
              (transaction.payeeName ?? <span className="text-gray-500 dark:text-gray-400">{t('row.noPayee')}</span>)
            ) : (
              <span className="text-gray-500 dark:text-gray-400">{t('row.transactionMissing')}</span>
            )}
          </div>
          <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {parserDraft ? (
              <Link href="/email-receipts?tab=emails" className="text-blue-600 hover:underline dark:text-blue-400">
                {t('row.viewEmailReceipts')}
              </Link>
            ) : item.kind === 'email_receipt' || item.kind === 'email_trade' ? (
              <>
                {item.emailReceipt
                  ? t('row.emailReceipt', { subject: item.emailReceipt.subject, sender: item.emailReceipt.fromAddress })
                  : t('row.emailReceiptMissing')}{' '}
                <Link href="/email-receipts?tab=emails" className="text-blue-600 hover:underline dark:text-blue-400">
                  {t('row.viewEmailReceipts')}
                </Link>
              </>
            ) : item.ruleName ? (
              t('row.rule', { name: item.ruleName })
            ) : (
              t('row.manualRequest')
            )}
          </div>
          {/* A parser draft request's instruction is the fixed text an agent reads, not a sentence for the person. */}
          {/* A receipt request's fixed instruction is shown in the reader's language; a rule's is their own words. */}
          {!parserDraft && (
            <p className="mt-1 whitespace-pre-line text-sm text-gray-700 dark:text-gray-300">
              {item.instructionKey ? t(`row.receiptInstruction.${item.instructionKey}`) : item.instruction}
            </p>
          )}
          {(item.kind === 'email_receipt' || tradeRequest || parserDraft) && item.status === 'pending' && (
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              {t.rich('row.waitingForAgent', {
                link: (chunks) => (
                  <Link href="/settings/ai" className="text-blue-600 hover:underline dark:text-blue-400">
                    {chunks}
                  </Link>
                ),
              })}
            </p>
          )}
          {parserDraft && item.status === 'proposed' && (
            <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
              {t.rich('row.parserDraftReady', {
                link: (chunks) => (
                  <Link href="/email-receipts?tab=profiles" className="text-blue-600 hover:underline dark:text-blue-400">
                    {chunks}
                  </Link>
                ),
              })}
              {draftIds.length > 0 && (
                <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
                  {t('row.parserDraftIds', { ids: draftIds.join(', ') })}
                </span>
              )}
            </p>
          )}
          {item.agentNote && (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {t('row.agentNote', { reason: item.agentNote.reason })}
            </p>
          )}
          {item.status === 'pending' && item.attempts > 0 && item.lastError && (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {t('row.attemptFailed', {
                count: item.attempts,
                error: item.lastError,
              })}
            </p>
          )}
          {/* An expired request ran out of time; only a rejected one is "closed for a reason", unknown for rows closed before it was kept. */}
          {(item.status === 'rejected' || (item.status === 'expired' && item.closeReason)) && (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {item.closeReason
                ? t('row.closeReason', {
                    reason: t(`row.closeReasons.${item.closeReason}`),
                  })
                : t('row.closeReasonUnknown')}
            </p>
          )}
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {t('row.dates', { created: formatDate(new Date(item.createdAt)), expires: formatDate(new Date(item.expiresAt)) })}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
            {transaction && (
              <Link
                href={`/transactions?targetTransactionId=${item.transactionId}`}
                className="text-blue-600 hover:underline dark:text-blue-400"
              >
                {t('row.viewTransaction')}
              </Link>
            )}
            {isReopenable(item) && onReopen && (
              <Button variant="outline" size="sm" onClick={() => onReopen(item)} disabled={reopening}>
                {t('actions.sendAgain')}
              </Button>
            )}
            {canDismiss && (
              <Button variant="outline" size="sm" onClick={() => onDismiss(item)} disabled={dismissing}>
                {t('actions.dismiss')}
              </Button>
            )}
          </div>
        </Td>
        <Td align="right" className={`${CELL} whitespace-nowrap`}>
          {transaction
            ? formatCurrency(transaction.amount, transaction.currencyCode)
            : trade
              ? tradeCurrency
                ? formatCurrency(trade.totalAmount, tradeCurrency)
                : formatNumber(trade.totalAmount, 2)
              : ''}
        </Td>
        <Td className={CELL}>
          <div className="flex flex-wrap items-center gap-1">
            <Badge variant={STATUS_VARIANT[item.status]}>{t(`status.${item.status}`)}</Badge>
            {item.status === 'pending' && item.needsAgent && (
              <>
                <Badge variant="amber">{t('row.needsAgent')}</Badge>
                <InfoTooltip text={t('row.needsAgentHelp', { count: item.attempts })} align="right" />
              </>
            )}
          </div>
        </Td>
      </tr>
      {(showCard || proposalError !== null) && (
        <tr>
          <Td colSpan={selectable ? 5 : 4} className="px-2 pb-4 pt-0 sm:px-4">
            {showCard && action && (
              <TransactionConfirmationCard
                action={{ ...action, status: card?.status ?? 'pending', errorMessage: card?.errorMessage, resultId: card?.resultId }}
                cancelLabel={t('actions.dismiss')}
                onConfirm={() => onApprove(item, action)}
                onCancel={() => onDismiss(item)}
              />
            )}
            {proposalError !== null && (
              <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 dark:border-red-900/60 dark:bg-red-900/20">
                <p className="text-sm font-semibold text-red-800 dark:text-red-200">{t('proposal.errorTitle')}</p>
                <p className="mt-1 text-sm text-red-700 dark:text-red-300">{proposalError}</p>
                <div className="mt-2 flex justify-end">
                  <Button variant="outline" size="sm" onClick={() => onDismiss(item)} disabled={dismissing}>
                    {t('actions.dismiss')}
                  </Button>
                </div>
              </div>
            )}
          </Td>
        </tr>
      )}
    </>
  );
}
