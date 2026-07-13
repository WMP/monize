'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LoanRateChange } from '@/types/loan-rate-change';
import { Account } from '@/types/account';
import { useNumberFormat } from '@/hooks/useNumberFormat';
import { useDateFormat } from '@/hooks/useDateFormat';
import { LoanRateControls } from './LoanRateControls';
import { LoanRateEditing } from './useLoanRateEditing';

interface RateHistoryPanelProps {
  account: Account;
  rateChanges: LoanRateChange[];
  /** Shared rate-timeline editing (add / edit / delete / detect). */
  editing: LoanRateEditing;
}

/**
 * The standalone Rate History table: the recorded interest-rate changes over
 * the life of the loan (initial + inferred + manual), each with its effective
 * date, rate, source badge, and the payment in effect from that date. A
 * "Detect from history" button (re)runs the backend segmentation to fill it
 * from the payment history. Complements the per-row rate in the Loan Schedule:
 * the schedule shows the rate on each installment, this shows the discrete
 * change points at a glance.
 */
export function RateHistoryPanel({ account, rateChanges, editing }: RateHistoryPanelProps) {
  const t = useTranslations('accounts');
  const { formatCurrency } = useNumberFormat();
  const { formatDate } = useDateFormat();

  const sortedChanges = useMemo(
    () =>
      [...rateChanges].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate)),
    [rateChanges],
  );

  const sourceBadge = (change: LoanRateChange) => {
    if (change.source === 'inferred') {
      return (
        <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
          {t('loanDetail.rateHistory.badgeInferred')}
        </span>
      );
    }
    if (change.source === 'initial') {
      return (
        <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
          {t('loanDetail.rateHistory.badgeInitial')}
        </span>
      );
    }
    return null;
  };

  const paymentLabel = (change: LoanRateChange) =>
    change.newPaymentAmount != null
      ? formatCurrency(change.newPaymentAmount, account.currencyCode)
      : t('loanDetail.rateHistory.paymentUnchanged');

  return (
    <div
      id="rate-history"
      className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-6 scroll-mt-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t('loanDetail.rateHistory.title')}
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('loanDetail.rateHistory.description')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={editing.openDetect}
            isLoading={editing.isDetecting}
          >
            {t('loanDetail.rateHistory.detect')}
          </Button>
          {/* Add button + the add/edit/delete/scheduled-payment modals. */}
          <LoanRateControls editing={editing} />
        </div>
      </div>

      {sortedChanges.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t('loanDetail.rateHistory.empty')}
        </p>
      ) : (
        <ul className="divide-y divide-gray-200 dark:divide-gray-700">
          {sortedChanges.map((change) => (
            <li
              key={change.id}
              className="py-2 flex flex-wrap items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2">
                  <span>{formatDate(change.effectiveDate)}</span>
                  <span className="text-blue-600 dark:text-blue-400">
                    {t('loanDetail.rateHistory.rateValue', { rate: change.annualRate })}
                  </span>
                  {sourceBadge(change)}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  {t('loanDetail.rateHistory.paymentSummary', {
                    payment: paymentLabel(change),
                  })}
                  {change.note ? ` — ${change.note}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" onClick={() => editing.openEdit(change)}>
                  {t('loanDetail.rateHistory.edit')}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => editing.requestDelete(change)}>
                  {t('loanDetail.rateHistory.delete')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        isOpen={editing.showDetectConfirm}
        title={t('loanDetail.rateHistory.detectTitle')}
        message={t('loanDetail.rateHistory.detectMessage')}
        confirmLabel={t('loanDetail.rateHistory.detect')}
        cancelLabel={t('loanDetail.rateHistory.cancel')}
        onConfirm={editing.runDetect}
        onCancel={editing.cancelDetect}
      />
    </div>
  );
}
