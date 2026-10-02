'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import toast from 'react-hot-toast';
import { isAxiosError } from 'axios';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Modal } from '@/components/ui/Modal';
import { Tabs, tabId, tabPanelId, type TabItem } from '@/components/ui/Tabs';
import { LinkifiedText } from '@/components/ui/LinkifiedText';
import { TABLE_BODY_CLASS, Td, Th } from '@/components/ui/Table';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useNumberFormat } from '@/hooks/useNumberFormat';
import { bankSyncApi } from '@/lib/bank-sync';
import { isUnknownSyncOutcome } from '@/lib/bank-sync-outcome';
import { KNOWN_REFUSAL_REASONS } from '@/lib/bank-sync-summary';
import {
  OUTCOME_VARIANTS,
  PREVIEW_FILTERS,
  filterPreviewRows,
  initialPreviewFilter,
  previewAmount,
  previewFilterCounts,
  type PreviewFilter,
} from '@/lib/bank-sync-preview';
import { getErrorMessage } from '@/lib/errors';
import { gainLossColor } from '@/lib/format';
import type { BankSyncPreview, BankSyncPreviewRow, BankSyncResult } from '@/types/bank-sync';

interface BankSyncPreviewModalProps {
  isOpen: boolean;
  bankAccountId: string;
  /** The Monize account the rows would go into, by name. */
  accountName: string;
  onClose: () => void;
  /** The sync that confirmed the preview finished; the modal has closed its own business. */
  onImported: (result: BankSyncResult) => void;
  /** The confirmation's result could not be learned (a timeout, a 5xx); the server may have written. */
  onOutcomeUnknown: () => void;
}

/** One read of the preview: settled, with its answer or with the error that stopped it. */
type Loaded =
  | { state: 'loading' }
  | { state: 'failed'; error: unknown }
  | { state: 'ready'; preview: BankSyncPreview };

const TAB_ID_PREFIX = 'bank-sync-preview';

/**
 * The list scrolls inside the modal so the footer's Import button never leaves
 * the screen: the panel is capped at 90vh (the whole viewport on a phone) and
 * scrolls as one, so the list is capped at what is left after the header, the
 * summary, the tabs and the footer. The floor keeps a short window usable.
 */
const LIST_HEIGHT_CLASS =
  'max-h-[max(12rem,calc(100dvh-27rem))] sm:max-h-[max(12rem,calc(90vh-24rem))]';

/** A header cell that stays put while the rows scroll under it. */
const STICKY_TH_CLASS =
  'sticky top-0 z-10 border-b border-gray-200 bg-white px-3 dark:border-gray-700 dark:bg-gray-800';

/** Body cells: tighter than the default so five columns fit one screen. */
const CELL_CLASS = 'px-3 align-top';

/**
 * What a sync of one bank account would do, row by row, before it does it
 * (docs/specs/bank-sync.md section 7a).
 *
 * **Nothing is written to open it**, and what the button writes is exactly
 * what the list shows: the import carries the preview's `planFingerprint`, and
 * the server refuses it (409) when the bank's answer changed in between. The
 * modal then says so and reads the preview again, so the person confirms what
 * the bank says now, not what it said a minute ago.
 *
 * **A figure the bank did not give is unknown, not zero**: a missing bank
 * balance says so, and the difference is shown only when both balances are
 * known in one currency. An amount the bank sent unreadable reads "Unknown".
 */
export function BankSyncPreviewModal({
  isOpen,
  bankAccountId,
  accountName,
  onClose,
  onImported,
  onOutcomeUnknown,
}: BankSyncPreviewModalProps) {
  const t = useTranslations('settings.bankSync.preview');
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [filter, setFilter] = useState<PreviewFilter>('all');
  const [importing, setImporting] = useState(false);
  // The read the modal is waiting for; an answer to an older one is dropped.
  const latestRequest = useRef(0);
  // The account the first read was started for. A read costs the bank a request
  // and takes the account's lease, so the effect below must not start a second
  // one when React runs it twice in development.
  const startedFor = useRef<string | null>(null);

  const fetchPreview = useCallback(async () => {
    const request = ++latestRequest.current;
    try {
      const preview = await bankSyncApi.previewAccount(bankAccountId);
      if (request !== latestRequest.current) return;
      setFilter(initialPreviewFilter(preview));
      setLoaded({ state: 'ready', preview });
    } catch (error) {
      if (request !== latestRequest.current) return;
      setLoaded({ state: 'failed', error });
    }
  }, [bankAccountId]);

  const reload = useCallback(() => {
    setLoaded({ state: 'loading' });
    return fetchPreview();
  }, [fetchPreview]);

  // The modal is mounted when it is opened, and this is the one read it starts.
  useEffect(() => {
    if (startedFor.current === bankAccountId) return;
    startedFor.current = bankAccountId;
    void fetchPreview();
  }, [bankAccountId, fetchPreview]);

  const handleImport = async () => {
    if (loaded.state !== 'ready') return;
    setImporting(true);
    try {
      const result = await bankSyncApi.syncAccount(bankAccountId, loaded.preview.planFingerprint);
      onImported(result);
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 409) {
        // Nothing was written. Read the bank again and show what it says now.
        toast.error(t('planChanged'));
        await reload();
      } else if (isUnknownSyncOutcome(error)) {
        onOutcomeUnknown();
      } else {
        toast.error(getErrorMessage(error, t('importFailed')));
      }
    } finally {
      setImporting(false);
    }
  };

  const ready = loaded.state === 'ready' ? loaded.preview : null;
  const newCount = ready?.summary.new ?? 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('title', { account: accountName })}
      description={t('description')}
      padding="md"
      maxWidth="6xl"
      fullScreenOnPhone
      pushHistory
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={importing}>
            {t('close')}
          </Button>
          <Button
            type="button"
            onClick={handleImport}
            disabled={ready === null || importing}
          >
            {importing ? t('importing') : t('import', { count: newCount })}
          </Button>
        </>
      }
    >
      {loaded.state === 'loading' && (
        <div className="flex items-center gap-2 py-8 text-sm text-gray-600 dark:text-gray-300">
          <LoadingSpinner />
          <span>{t('loading')}</span>
        </div>
      )}
      {loaded.state === 'failed' && (
        <div className="space-y-3 py-4">
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {getErrorMessage(loaded.error, t('loadFailed'))}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => void reload()}>
            {t('retry')}
          </Button>
        </div>
      )}
      {ready && (
        <PreviewBody
          preview={ready}
          filter={filter}
          onFilterChange={setFilter}
        />
      )}
    </Modal>
  );
}

function PreviewBody({
  preview,
  filter,
  onFilterChange,
}: {
  preview: BankSyncPreview;
  filter: PreviewFilter;
  onFilterChange: (filter: PreviewFilter) => void;
}) {
  const t = useTranslations('settings.bankSync.preview');
  const { formatDate } = useDateFormat();
  const { formatCurrency } = useNumberFormat();
  // A phone gets a card per row. Both layouts show the same figures, so this
  // selects a presentation, not a different answer.
  const isPhone = useIsMobile();

  const counts = previewFilterCounts(preview.rows);
  const tabs: TabItem<PreviewFilter>[] = PREVIEW_FILTERS.map((key) => ({
    key,
    label: t('filter.withCount', { label: t(`filter.${key}`), count: counts[key] }),
  }));
  const shown = filterPreviewRows(preview.rows, filter);

  const money = (amount: string) => {
    const value = previewAmount(amount);
    return value === null ? null : formatCurrency(value, preview.currencyCode);
  };
  const bank = preview.bankBalance;
  const bankAmount = bank ? previewAmount(bank.amount) : null;
  const differenceAmount = previewAmount(preview.difference);
  const currenciesDiffer =
    bank !== null && bankAmount !== null && bank.currencyCode !== preview.currencyCode;

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
        <SummaryItem label={t('monizeBalance')}>{money(preview.monizeBalance)}</SummaryItem>
        <SummaryItem label={t('balanceAfter')} strong>
          {money(preview.balanceAfter)}
        </SummaryItem>
        <SummaryItem label={t('bankBalance')}>
          {bank !== null && bankAmount !== null
            ? bank.referenceDate
              ? t('bankBalanceAsOf', {
                  amount: formatCurrency(bankAmount, bank.currencyCode),
                  date: formatDate(bank.referenceDate),
                })
              : formatCurrency(bankAmount, bank.currencyCode)
            : t('bankBalanceNotReported')}
        </SummaryItem>
        {differenceAmount !== null && (
          <SummaryItem
            label={
              <>
                {t('difference')}
                <InfoTooltip text={t('differenceHelp')} usePortal />
              </>
            }
          >
            {formatCurrency(differenceAmount, preview.currencyCode)}
          </SummaryItem>
        )}
      </dl>
      {currenciesDiffer && bank && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t('differenceHidden', {
            bankCurrency: bank.currencyCode,
            monizeCurrency: preview.currencyCode,
          })}
        </p>
      )}

      <Tabs
        tabs={tabs}
        value={filter}
        onChange={onFilterChange}
        idPrefix={TAB_ID_PREFIX}
        ariaLabel={t('filterLabel')}
        wrap
      />

      <div
        id={tabPanelId(TAB_ID_PREFIX, filter)}
        role="tabpanel"
        aria-labelledby={tabId(TAB_ID_PREFIX, filter)}
      >
        {shown.length === 0 ? (
          <EmptyState
            title={filter === 'all' ? t('empty.all') : t('empty.filtered')}
          />
        ) : isPhone ? (
          <ul
            className={`scrollbar-slim ${LIST_HEIGHT_CLASS} divide-y divide-gray-200 overflow-y-auto dark:divide-gray-700`}
          >
            {shown.map((row, index) => (
              <PreviewCard key={index} row={row} accountCurrency={preview.currencyCode} />
            ))}
          </ul>
        ) : (
          <div className={`scrollbar-slim ${LIST_HEIGHT_CLASS} overflow-y-auto`}>
            <table className="w-full table-fixed">
              <colgroup>
                <col className="w-32" />
                <col />
                <col className="hidden w-[22%] lg:table-column" />
                <col className="w-40" />
                <col className="w-44" />
              </colgroup>
              <thead>
                <tr>
                  <Th className={STICKY_TH_CLASS}>{t('columns.date')}</Th>
                  <Th className={STICKY_TH_CLASS}>{t('columns.payee')}</Th>
                  <Th className={`${STICKY_TH_CLASS} hidden lg:table-cell`}>
                    {t('columns.category')}
                  </Th>
                  <Th align="right" className={STICKY_TH_CLASS}>
                    {t('columns.amount')}
                  </Th>
                  <Th className={STICKY_TH_CLASS}>{t('columns.status')}</Th>
                </tr>
              </thead>
              <tbody className={TABLE_BODY_CLASS}>
                {shown.map((row, index) => (
                  <PreviewRow key={index} row={row} accountCurrency={preview.currencyCode} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/** One label and its figure; a pair per cell of the summary's two-column grid. */
function SummaryItem({
  label,
  strong = false,
  children,
}: {
  label: ReactNode;
  strong?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3">
      <dt className="flex shrink-0 items-center gap-1 text-gray-500 dark:text-gray-400">
        {label}
      </dt>
      <dd
        className={`min-w-0 text-right tabular-nums text-gray-900 dark:text-gray-100${
          strong ? ' font-medium' : ''
        }`}
      >
        {children}
      </dd>
    </div>
  );
}

/** What both layouts of a row print, worked out once. */
function useRowDisplay(row: BankSyncPreviewRow, accountCurrency: string) {
  const t = useTranslations('settings.bankSync.preview');
  const { formatDate } = useDateFormat();
  const { formatCurrency, formatNumber } = useNumberFormat();

  const amount = previewAmount(row.amount);
  // A row is shown in the currency the bank sent it in; one without a currency
  // is a bare number, never labelled with the account's.
  const currency = row.currencyCode ?? (row.outcome === 'refused' ? null : accountCurrency);
  const amountText =
    amount === null
      ? t('amountUnknown')
      : currency
        ? formatCurrency(amount, currency)
        : formatNumber(amount, 2);
  const refusal =
    row.refusalReason !== null &&
    (KNOWN_REFUSAL_REASONS as readonly string[]).includes(row.refusalReason)
      ? row.refusalReason
      : 'other';

  return {
    dateText: row.transactionDate ? formatDate(row.transactionDate) : t('dateUnknown'),
    payeeText: row.payeeName ?? row.payeeText ?? t('noPayee'),
    amountText,
    // An unreadable amount is unknown, so it takes no sign colour.
    amountClass: amount === null ? '' : gainLossColor(amount),
    status: row.outcome === 'refused' ? t(`refusal.${refusal}`) : t(`outcome.${row.outcome}`),
    dimmed: row.outcome !== 'new',
  };
}

function PreviewRow({
  row,
  accountCurrency,
}: {
  row: BankSyncPreviewRow;
  accountCurrency: string;
}) {
  const { dateText, payeeText, amountText, amountClass, status, dimmed } = useRowDisplay(
    row,
    accountCurrency,
  );

  return (
    <tr className={dimmed ? 'text-gray-500 dark:text-gray-400' : undefined}>
      <Td className={`${CELL_CLASS} whitespace-nowrap`}>{dateText}</Td>
      <Td className={CELL_CLASS}>
        <div className="min-w-0 truncate" title={payeeText}>
          {payeeText}
        </div>
        {row.description && (
          <div
            className="min-w-0 truncate text-xs text-gray-500 dark:text-gray-400"
            title={row.description}
          >
            <LinkifiedText text={row.description} />
          </div>
        )}
      </Td>
      <Td className={`${CELL_CLASS} hidden lg:table-cell`}>
        {row.categoryName && (
          <div className="min-w-0 truncate" title={row.categoryName}>
            {row.categoryName}
          </div>
        )}
        {row.tagNames.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {row.tagNames.map((tag) => (
              <Badge key={tag}>{tag}</Badge>
            ))}
          </div>
        )}
      </Td>
      <Td align="right" className={`${CELL_CLASS} whitespace-nowrap tabular-nums`}>
        <span className={amountClass}>{amountText}</span>
      </Td>
      <Td className={`${CELL_CLASS} whitespace-nowrap`}>
        <Badge variant={OUTCOME_VARIANTS[row.outcome]}>{status}</Badge>
      </Td>
    </tr>
  );
}

/** A row on a phone: date and amount, the payee, the description, then the outcome. */
function PreviewCard({
  row,
  accountCurrency,
}: {
  row: BankSyncPreviewRow;
  accountCurrency: string;
}) {
  const { dateText, payeeText, amountText, amountClass, status, dimmed } = useRowDisplay(
    row,
    accountCurrency,
  );

  return (
    <li
      className={`space-y-1 py-3 text-sm ${
        dimmed ? 'text-gray-500 dark:text-gray-400' : 'text-gray-900 dark:text-gray-100'
      }`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="whitespace-nowrap text-xs text-gray-500 dark:text-gray-400">
          {dateText}
        </span>
        <span className={`whitespace-nowrap font-medium tabular-nums ${amountClass}`}>
          {amountText}
        </span>
      </div>
      <div className="min-w-0 truncate font-medium" title={payeeText}>
        {payeeText}
      </div>
      {row.description && (
        <div
          className="min-w-0 truncate text-xs text-gray-500 dark:text-gray-400"
          title={row.description}
        >
          <LinkifiedText text={row.description} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1 pt-0.5">
        <Badge variant={OUTCOME_VARIANTS[row.outcome]}>{status}</Badge>
        {row.categoryName && (
          <span className="min-w-0 truncate text-xs text-gray-500 dark:text-gray-400">
            {row.categoryName}
          </span>
        )}
        {row.tagNames.map((tag) => (
          <Badge key={tag}>{tag}</Badge>
        ))}
      </div>
    </li>
  );
}
