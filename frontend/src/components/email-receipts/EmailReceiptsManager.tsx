'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { useTranslations } from 'next-intl';
import { EnvelopeIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { EmailReceiptDetailDialog } from '@/components/email-receipts/EmailReceiptDetailDialog';
import { ParserEditorDialog } from '@/components/email-receipts/ParserEditorDialog';
import { RecognizeWithAiDialog } from '@/components/email-receipts/RecognizeWithAiDialog';
import { ReceiptStateBadge } from '@/components/email-receipts/ReceiptStateBadge';
import { useParserDraftWithAi } from '@/components/email-receipts/useParserDraftWithAi';
import { Button, buttonClassName } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { RowActions, type RowAction } from '@/components/ui/row-actions';
import { Select } from '@/components/ui/Select';
import { SEGMENTED_GROUP_CLASS, segmentClass } from '@/components/ui/segmented-control';
import { TABLE_BODY_CLASS, TABLE_CLASS, Td, Th } from '@/components/ui/Table';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useNumberFormat } from '@/hooks/useNumberFormat';
import { useReceiptParserLookups } from '@/hooks/useReceiptParserLookups';
import { emailReceiptsApi } from '@/lib/email-receipts-api';
import {
  canDraftParser,
  canRecognizeWithAi,
  distinctSenderDomains,
  isReceiptActionable,
  normalizeDomainFilter,
  senderDomain,
} from '@/lib/email-receipts-format';
import { getErrorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/logger';
import {
  EMAIL_RECEIPT_STATUSES,
  PARSER_DRAFT_MAX_RECEIPTS,
  type EmailReceiptDomainCount,
  type EmailReceiptListItem,
  type EmailReceiptStatus,
} from '@/types/email-receipts';

const logger = createLogger('EmailReceipts');

const FILTERS = ['all', ...EMAIL_RECEIPT_STATUSES] as const;
type ReceiptFilter = (typeof FILTERS)[number];

/** States from which the detail dialog can link the email to a transaction. */
const LINKABLE_STATUSES: readonly EmailReceiptStatus[] = ['ambiguous', 'unmatched', 'no_parser', 'parse_failed'];

/** The list answers one pair of filters (state and sender domain, `''` for all); `items === null` is a request that failed. */
interface LoadedList {
  filter: ReceiptFilter;
  domain: string;
  items: EmailReceiptListItem[] | null;
}

/** Whether the user has a mailbox, as far as it is known: `none` is a loaded answer of "no mailbox". */
type MailboxState = { status: 'loading' } | { status: 'failed' } | { status: 'none' } | { status: 'ready' };

type Confirmation = { kind: 'ignore' | 'delete'; receipt: EmailReceiptListItem };

interface Notice {
  tone: 'success' | 'error';
  text: string;
  /** A place to go next, such as the parsers list a draft lands in. */
  link?: { href: string; label: string };
}

/**
 * The receipts page body: every stored order-confirmation email with its state
 * and the actions on it.
 *
 * A list belongs to the filters that asked for it (`LoadedList.filter` and
 * `.domain`), so a slow answer for a filter the reader has left is never drawn
 * under the new one
 * and no action can be aimed at a row of the other list. `null` is loading or
 * failed, never an empty list; only a loaded, empty answer says "nothing here".
 * "Draft parser with AI" and "Recognize with AI" are the person's own request to
 * the assistant, offered whatever the mailbox's AI mode: the request is queued and
 * the chat is opened (or the request waits in the review inbox) rather than a
 * provider being called from here. Up to five emails can be selected and drafted
 * from together.
 */
export function EmailReceiptsManager() {
  const t = useTranslations('emailReceipts.receipts');
  const tc = useTranslations('common');
  const { formatDate, formatDateTime } = useDateFormat();
  const { formatCurrency } = useNumberFormat();
  const { state: lookups, reload: reloadLookups } = useReceiptParserLookups();

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [filter, setFilter] = useState<ReceiptFilter>('all');
  // The sender domain filter starts from `?domain=` and is written back to it;
  // a value that is no host name is no filter.
  const [domain, setDomain] = useState<string>(() => normalizeDomainFilter(searchParams.get('domain')));
  // The sender domains with their counts for the filter; null while unknown or failed (the select then offers only "All" and the current one).
  const [domains, setDomains] = useState<EmailReceiptDomainCount[] | null>(null);
  const [loaded, setLoaded] = useState<LoadedList | null>(null);
  const [mailbox, setMailbox] = useState<MailboxState>({ status: 'loading' });
  // The emails ticked for "Draft parser with AI", by id. Only ids of the list on
  // screen count (`selected` below), and a change of filter clears the set.
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [drafting, setDrafting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [parserFor, setParserFor] = useState<EmailReceiptListItem | null>(null);
  const [recognizeFor, setRecognizeFor] = useState<EmailReceiptListItem | null>(null);
  const startParserDraft = useParserDraftWithAi();

  // Only the newest request may write the list, and a reload after an action
  // asks for the filter the reader is on NOW, not the one the handler saw.
  const latestLoad = useRef(0);
  const latestDomains = useRef(0);
  const currentFilters = useRef({ filter, domain });
  useEffect(() => {
    currentFilters.current = { filter, domain };
  }, [filter, domain]);

  const load = useCallback(async (forFilter: ReceiptFilter, forDomain: string) => {
    const request = ++latestLoad.current;
    try {
      const items = await emailReceiptsApi.receipts.list(
        forFilter === 'all' ? undefined : forFilter,
        undefined,
        forDomain === '' ? undefined : forDomain,
      );
      if (request !== latestLoad.current) return;
      setLoaded({ filter: forFilter, domain: forDomain, items });
    } catch (error) {
      if (request !== latestLoad.current) return;
      logger.error(error);
      setLoaded({ filter: forFilter, domain: forDomain, items: null });
    }
  }, []);

  /** The domains the filter offers; a failed read leaves them unknown, never an empty list. */
  const loadDomains = useCallback(async () => {
    const request = ++latestDomains.current;
    try {
      const found = await emailReceiptsApi.receipts.listDomains();
      if (request === latestDomains.current) setDomains(found);
    } catch (error) {
      if (request !== latestDomains.current) return;
      logger.error(error);
      setDomains(null);
    }
  }, []);

  // After a command or a change the list and the domain counts are read again.
  const reload = useCallback(async () => {
    void loadDomains();
    await load(currentFilters.current.filter, currentFilters.current.domain);
  }, [load, loadDomains]);

  useEffect(() => {
    void load(filter, domain);
  }, [filter, domain, load]);

  useEffect(() => {
    void loadDomains();
  }, [loadDomains]);

  const changeDomain = (next: string) => {
    setDomain(next);
    setSelectedIds(new Set());
    const params = new URLSearchParams(searchParams.toString());
    if (next === '') params.delete('domain');
    else params.set('domain', next);
    const query = params.toString();
    router.replace(query === '' ? pathname : `${pathname}?${query}`, { scroll: false });
  };

  useEffect(() => {
    let cancelled = false;
    emailReceiptsApi.mailbox
      .get()
      .then((found) => {
        if (cancelled) return;
        setMailbox(found ? { status: 'ready' } : { status: 'none' });
      })
      .catch((error) => {
        if (cancelled) return;
        logger.error(error);
        setMailbox({ status: 'failed' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const categoryLabels = useMemo(
    () =>
      lookups.status === 'ready' ? new Map(lookups.lookups.categories.map((option) => [option.value, option.label])) : null,
    [lookups],
  );

  /** Runs one command on one email: busy while it runs, the list reloaded after it, the failure named. */
  const runCommand = async (receipt: EmailReceiptListItem, work: () => Promise<Notice | null>, failureText: string) => {
    setBusyId(receipt.id);
    setNotice(null);
    try {
      const result = await work();
      if (result) setNotice(result);
      await reload();
    } catch (error) {
      setNotice({ tone: 'error', text: getErrorMessage(error, failureText) });
      logger.error(error);
    } finally {
      setBusyId(null);
    }
  };

  const handleReprocess = (receipt: EmailReceiptListItem) =>
    runCommand(
      receipt,
      async () => {
        await emailReceiptsApi.receipts.reprocess(receipt.id);
        toast.success(t('toasts.reprocessed'));
        return null;
      },
      t('toasts.reprocessFailed'),
    );

  /**
   * Queue a parser-draft request for these emails and open the chat or leave it in
   * the inbox (`useParserDraftWithAi`). The chat opening is the page changing, so
   * only the other two outcomes leave a notice behind.
   */
  const handleDraftParser = async (receipts: readonly EmailReceiptListItem[]) => {
    if (receipts.length === 0) return;
    setDrafting(true);
    setNotice(null);
    try {
      const outcome = await startParserDraft(receipts);
      if (outcome.kind === 'failed') {
        setNotice({ tone: 'error', text: outcome.message });
      } else if (outcome.kind === 'queued') {
        setNotice({
          tone: 'success',
          text: outcome.handoffFailed ? t('draft.handoffFailed') : t('draft.queued'),
          link: { href: '/ai-reviews', label: t('draft.inboxLink') },
        });
        setSelectedIds(new Set());
      } else {
        setSelectedIds(new Set());
      }
    } finally {
      setDrafting(false);
    }
  };

  const toggleSelected = (receipt: EmailReceiptListItem) =>
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(receipt.id)) next.delete(receipt.id);
      else if (next.size < PARSER_DRAFT_MAX_RECEIPTS) next.add(receipt.id);
      return next;
    });

  const handleConfirm = async () => {
    const target = confirmation;
    setConfirmation(null);
    if (!target) return;
    if (target.kind === 'ignore') {
      await runCommand(
        target.receipt,
        async () => {
          await emailReceiptsApi.receipts.ignore(target.receipt.id);
          toast.success(t('toasts.ignored'));
          return null;
        },
        t('toasts.ignoreFailed'),
      );
    } else {
      await runCommand(
        target.receipt,
        async () => {
          await emailReceiptsApi.receipts.remove(target.receipt.id);
          toast.success(t('toasts.deleted'));
          return null;
        },
        t('toasts.deleteFailed'),
      );
    }
  };

  const actionsFor = (receipt: EmailReceiptListItem): RowAction[] => {
    const actionable = isReceiptActionable(receipt);
    const disabled = busyId === receipt.id;
    return [
      {
        key: 'view',
        label: t('actions.view'),
        icon: 'view',
        tone: 'view',
        onClick: () => setDetailId(receipt.id),
        disabled,
      },
      {
        // The inline action of an email no parser read: the person's own request
        // to the assistant, offered whatever the mailbox's AI mode.
        key: 'draftParser',
        label: t('actions.draftParser'),
        icon: 'duplicate',
        tone: 'accent',
        onClick: () => void handleDraftParser([receipt]),
        hidden: !canDraftParser(receipt),
        disabled: disabled || drafting,
      },
      {
        key: 'createParser',
        label: t('actions.createParser'),
        icon: 'edit',
        tone: 'primary',
        onClick: () => setParserFor(receipt),
        hidden: receipt.status !== 'no_parser',
        disabled,
      },
      {
        key: 'link',
        label: t('actions.link'),
        icon: 'transactions',
        tone: 'primary',
        onClick: () => setDetailId(receipt.id),
        // The candidates of an ambiguous email, or the picker of one the matcher
        // could not tie to a transaction.
        hidden: !LINKABLE_STATUSES.includes(receipt.status),
        disabled,
      },
      {
        // Offered whatever the mailbox's AI mode: the mode governs only what
        // happens by itself, and pressing this is the person's own consent.
        key: 'recognizeAi',
        label: t('actions.recognizeAi'),
        icon: 'reconcile',
        tone: 'accent',
        onClick: () => setRecognizeFor(receipt),
        hidden: !canRecognizeWithAi(receipt),
        disabled,
      },
      {
        key: 'reprocess',
        label: t('actions.reprocess'),
        icon: 'reopen',
        tone: 'primary',
        onClick: () => void handleReprocess(receipt),
        hidden: !actionable || receipt.status === 'pending',
        disabled,
      },
      {
        key: 'ignore',
        label: t('actions.ignore'),
        icon: 'skip',
        tone: 'warning',
        onClick: () => setConfirmation({ kind: 'ignore', receipt }),
        hidden: !actionable,
        disabled,
      },
      {
        key: 'delete',
        label: tc('delete'),
        icon: 'delete',
        tone: 'delete',
        destructive: true,
        onClick: () => setConfirmation({ kind: 'delete', receipt }),
        disabled,
      },

    ];
  };

  const current = loaded !== null && loaded.filter === filter && loaded.domain === domain ? loaded : null;
  // What is ticked AND still on screen: an email a reload dropped is not selected.
  const selected = (current?.items ?? []).filter((receipt) => selectedIds.has(receipt.id));
  const selectedDomains = distinctSenderDomains(selected);

  // "All senders", each domain with its count, and the filtered one even when it is not (yet) in the list.
  const domainOptions = [
    { value: '', label: t('domainFilter.all') },
    ...(domains ?? []).map((entry) => ({
      value: entry.domain,
      label: t('domainFilter.option', { domain: entry.domain, count: entry.count }),
    })),
    ...(domain !== '' && !(domains ?? []).some((entry) => entry.domain === domain) ? [{ value: domain, label: domain }] : []),
  ];

  let body;
  if (current !== null && current.items === null) {
    body = (
      <div role="alert">
        <EmptyState
          icon={<ExclamationTriangleIcon />}
          title={t('error.title')}
          description={t('error.body')}
          action={<Button onClick={() => void reload()}>{t('error.retry')}</Button>}
        />
      </div>
    );
  } else if (current === null) {
    body = <LoadingSpinner text={t('loading')} />;
  } else if (current.items === null || current.items.length === 0) {
    const unfiltered = filter === 'all' && domain === '';
    const noMailbox = mailbox.status === 'none' && unfiltered;
    body = (
      <EmptyState
        icon={<EnvelopeIcon />}
        title={unfiltered ? t('empty.title') : t('empty.filteredTitle')}
        description={noMailbox ? t('empty.noMailboxBody') : unfiltered ? t('empty.body') : t('empty.filteredBody')}
        action={
          noMailbox ? (
            <Link href="/settings/email-receipts" className={buttonClassName('primary', 'md')}>
              {t('empty.connectButton')}
            </Link>
          ) : undefined
        }
      />
    );
  } else {
    body = (
      <div className="overflow-x-auto">
        <table className={TABLE_CLASS}>
          <thead>
            <tr>
              <Th className="w-8 px-2 sm:px-4">
                <span className="sr-only">{t('columns.select')}</span>
              </Th>
              <Th className="px-2 sm:px-4">{t('columns.received')}</Th>
              <Th className="px-2 sm:px-4">{t('columns.email')}</Th>
              <Th className="hidden px-2 sm:table-cell sm:px-4">{t('columns.transaction')}</Th>
              <Th className="px-2 sm:px-4">{t('columns.state')}</Th>
              <Th align="right" className="px-2 sm:px-4">
                {t('columns.actions')}
              </Th>
            </tr>
          </thead>
          <tbody className={TABLE_BODY_CLASS}>
            {current.items.map((receipt) => {
              const summary = receipt.transaction
                ? t('transactionSummary', {
                    date: formatDate(receipt.transaction.date),
                    amount: formatCurrency(receipt.transaction.amount, receipt.transaction.currencyCode),
                    payee: receipt.transaction.payeeName ?? t('noPayee'),
                  })
                : null;
              return (
                <tr key={receipt.id}>
                  <Td className="px-2 align-top sm:px-4">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(receipt.id)}
                      // A skipped email has no text to write a parser from, and at
                      // most five are drafted from together.
                      disabled={
                        drafting ||
                        receipt.status === 'skipped' ||
                        (!selectedIds.has(receipt.id) && selected.length >= PARSER_DRAFT_MAX_RECEIPTS)
                      }
                      onChange={() => toggleSelected(receipt)}
                      aria-label={t('selection.select', { subject: receipt.subject })}
                      className="h-4 w-4 cursor-pointer rounded border-gray-300 text-blue-600 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600"
                    />
                  </Td>
                  <Td className="px-2 align-top whitespace-nowrap sm:px-4">{formatDateTime(receipt.receivedAt)}</Td>
                  <Td className="min-w-0 px-2 align-top break-words sm:px-4">
                    <div className="font-medium">{receipt.subject}</div>
                    <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{receipt.fromAddress}</div>
                    {summary && (
                      <div className="mt-1 text-xs text-gray-700 dark:text-gray-300 sm:hidden">{summary}</div>
                    )}
                  </Td>
                  <Td className="hidden px-2 align-top sm:table-cell sm:px-4">
                    {receipt.transaction ? (
                      <Link
                        href={`/transactions?targetTransactionId=${receipt.transaction.id}`}
                        className="text-blue-600 hover:underline dark:text-blue-400"
                      >
                        {summary}
                      </Link>
                    ) : (
                      <span className="text-gray-500 dark:text-gray-400">{t('noTransaction')}</span>
                    )}
                  </Td>
                  <Td className="px-2 align-top sm:px-4">
                    <ReceiptStateBadge receipt={receipt} />
                  </Td>
                  <Td align="right" className="px-2 align-top sm:px-4">
                    <RowActions actions={actionsFor(receipt)} density="normal" maxInline={3} />
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  const confirmCopy = confirmation?.kind === 'delete' ? 'deleteDialog' : 'ignoreDialog';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <Link href="/ai-reviews" className="text-blue-600 hover:underline dark:text-blue-400">
          {t('links.reviewInbox')}
        </Link>
        <Link href="/settings/email-receipts" className="text-blue-600 hover:underline dark:text-blue-400">
          {t('links.settings')}
        </Link>
      </div>

      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div role="group" aria-label={t('filter.label')} className={`${SEGMENTED_GROUP_CLASS} max-w-full flex-wrap`}>
          {FILTERS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={filter === option}
              onClick={() => {
                setFilter(option);
                setSelectedIds(new Set());
              }}
              className={segmentClass(filter === option)}
            >
              {t(`filter.${option}`)}
            </button>
          ))}
        </div>
        <div className="w-full sm:w-72">
          <Select
            id="receipts-domain-filter"
            label={t('domainFilter.label')}
            value={domain}
            onChange={(e) => changeDomain(e.target.value)}
            options={domainOptions}
          />
        </div>
      </div>
      {domain !== '' && <p className="text-xs text-gray-500 dark:text-gray-400">{t('domainFilter.help', { domain })}</p>}

      {notice && (
        <div
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={
            notice.tone === 'error'
              ? 'rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-200'
              : 'rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800 dark:border-green-900/60 dark:bg-green-900/20 dark:text-green-200'
          }
        >
          {notice.text}
          {notice.link && (
            <>
              {' '}
              <Link href={notice.link.href} className="font-medium underline">
                {notice.link.label}
              </Link>
            </>
          )}
        </div>
      )}

      {selected.length > 0 && (
        <div
          role="region"
          aria-label={t('selection.label')}
          className="space-y-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-900/60 dark:bg-blue-900/20 dark:text-blue-100"
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span>{t('selection.count', { count: selected.length, max: PARSER_DRAFT_MAX_RECEIPTS })}</span>
            <Button isLoading={drafting} disabled={drafting} onClick={() => void handleDraftParser(selected)}>
              {t('selection.draftButton', { count: selected.length })}
            </Button>
            <Button variant="outline" disabled={drafting} onClick={() => setSelectedIds(new Set())}>
              {t('selection.clear')}
            </Button>
          </div>
          {selectedDomains.length > 1 && (
            <p role="alert" className="text-amber-800 dark:text-amber-200">
              {t('selection.differentSenders', { domains: selectedDomains.join(', ') })}
            </p>
          )}
        </div>
      )}

      <Card className="overflow-hidden">{body}</Card>

      {detailId !== null && (
        <EmailReceiptDetailDialog
          key={detailId}
          receiptId={detailId}
          categoryLabels={categoryLabels}
          onClose={() => setDetailId(null)}
          onChanged={() => void reload()}
        />
      )}

      {parserFor !== null && (
        <ParserEditorDialog
          parser={null}
          prefill={{
            name: parserFor.fromDomain || senderDomain(parserFor.fromAddress),
            fromDomains: parserFor.fromDomain || senderDomain(parserFor.fromAddress),
          }}
          initialReceiptId={parserFor.id}
          lookups={lookups}
          onReloadLookups={reloadLookups}
          onClose={() => setParserFor(null)}
          onSaved={() => {
            setParserFor(null);
            void reload();
          }}
          onConflict={() => setParserFor(null)}
        />
      )}

      {recognizeFor !== null && (
        <RecognizeWithAiDialog
          key={recognizeFor.id}
          receipt={recognizeFor}
          onClose={() => setRecognizeFor(null)}
          onChanged={() => void reload()}
        />
      )}

      <ConfirmDialog
        isOpen={confirmation !== null}
        title={t(`${confirmCopy}.title`)}
        message={t(`${confirmCopy}.message`, { subject: confirmation?.receipt.subject ?? '' })}
        confirmLabel={confirmation?.kind === 'delete' ? tc('delete') : t('ignoreDialog.confirm')}
        variant={confirmation?.kind === 'delete' ? 'danger' : 'warning'}
        onConfirm={() => void handleConfirm()}
        onCancel={() => setConfirmation(null)}
      />
    </div>
  );
}
