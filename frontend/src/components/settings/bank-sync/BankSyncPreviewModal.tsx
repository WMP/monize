'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
import { TABLE_BODY_CLASS, TABLE_CLASS, Td, Th } from '@/components/ui/Table';
import { useDateFormat } from '@/hooks/useDateFormat';
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
      maxWidth="4xl"
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
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-gray-500 dark:text-gray-400">{t('monizeBalance')}</dt>
        <dd className="text-gray-900 dark:text-gray-100">{money(preview.monizeBalance)}</dd>
        <dt className="text-gray-500 dark:text-gray-400">{t('balanceAfter')}</dt>
        <dd className="font-medium text-gray-900 dark:text-gray-100">
          {money(preview.balanceAfter)}
        </dd>
        <dt className="text-gray-500 dark:text-gray-400">{t('bankBalance')}</dt>
        <dd className="text-gray-900 dark:text-gray-100">
          {bank !== null && bankAmount !== null
            ? bank.referenceDate
              ? t('bankBalanceAsOf', {
                  amount: formatCurrency(bankAmount, bank.currencyCode),
                  date: formatDate(bank.referenceDate),
                })
              : formatCurrency(bankAmount, bank.currencyCode)
            : t('bankBalanceNotReported')}
        </dd>
        {differenceAmount !== null && (
          <>
            <dt className="flex items-center gap-1 text-gray-500 dark:text-gray-400">
              {t('difference')}
              <InfoTooltip text={t('differenceHelp')} usePortal />
            </dt>
            <dd className="text-gray-900 dark:text-gray-100">
              {formatCurrency(differenceAmount, preview.currencyCode)}
            </dd>
          </>
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
        ) : (
          <div className="scrollbar-slim max-h-[50vh] overflow-y-auto">
            <table className={TABLE_CLASS}>
              <thead>
                <tr>
                  <Th>{t('columns.date')}</Th>
                  <Th>{t('columns.payee')}</Th>
                  <Th className="hidden sm:table-cell">{t('columns.category')}</Th>
                  <Th className="hidden sm:table-cell">{t('columns.status')}</Th>
                  <Th align="right">{t('columns.amount')}</Th>
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

function PreviewRow({
  row,
  accountCurrency,
}: {
  row: BankSyncPreviewRow;
  accountCurrency: string;
}) {
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
  const status =
    row.outcome === 'refused' ? t(`refusal.${refusal}`) : t(`outcome.${row.outcome}`);
  const payee = row.payeeName ?? row.payeeText;
  const dimmed = row.outcome !== 'new';

  return (
    <tr className={dimmed ? 'text-gray-500 dark:text-gray-400' : undefined}>
      <Td className="whitespace-nowrap">
        {row.transactionDate ? formatDate(row.transactionDate) : t('dateUnknown')}
      </Td>
      <Td className="max-w-[12rem] sm:max-w-none">
        <div className="truncate">{payee ?? t('noPayee')}</div>
        {row.description && (
          <div className="truncate text-xs text-gray-500 dark:text-gray-400">
            <LinkifiedText text={row.description} />
          </div>
        )}
        <div className="mt-1 sm:hidden">
          <Badge variant={OUTCOME_VARIANTS[row.outcome]}>{status}</Badge>
        </div>
      </Td>
      <Td className="hidden sm:table-cell">
        {row.categoryName}
        {row.tagNames.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {row.tagNames.map((tag) => (
              <Badge key={tag}>{tag}</Badge>
            ))}
          </div>
        )}
      </Td>
      <Td className="hidden sm:table-cell">
        <Badge variant={OUTCOME_VARIANTS[row.outcome]}>{status}</Badge>
      </Td>
      <Td align="right" className="whitespace-nowrap">
        {amountText}
      </Td>
    </tr>
  );
}
