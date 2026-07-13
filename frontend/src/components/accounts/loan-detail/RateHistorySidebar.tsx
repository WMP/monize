'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer } from 'recharts';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LoanRateChange } from '@/types/loan-rate-change';
import { Account } from '@/types/account';
import { chartColors } from '@/lib/chart-colors';
import { useChartDateFormat } from '@/hooks/useChartDateFormat';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useNumberFormat } from '@/hooks/useNumberFormat';
import { LoanRateControls } from './LoanRateControls';
import { LoanRateEditing } from './useLoanRateEditing';

interface RateHistorySidebarProps {
  account: Account;
  /** Recorded rate history (loan_rate_changes), any order. */
  rateChanges: LoanRateChange[];
  /** Shared rate-timeline editing (add / edit / delete / detect). */
  editing: LoanRateEditing;
  /** Last payment date, to extend the final rate to the end of the chart. */
  endDate: string | null;
  /** Stretch to the sibling's height (used beside the simulator, 70/30). */
  fillHeight?: boolean;
}

/**
 * The Rate History panel, full-width below the overpayment simulator. A
 * gradient area of the interest rate over the loan's life fills the card as a
 * backdrop; the recorded rate changes -- effective date, rate, source badge,
 * payment in effect -- float over it, each editable, with "Detect from history"
 * and "Add rate change". The header bar collapses the panel when clicked.
 */
export function RateHistorySidebar({
  account,
  rateChanges,
  editing,
  endDate,
  fillHeight = false,
}: RateHistorySidebarProps) {
  const t = useTranslations('accounts');
  const formatChartDate = useChartDateFormat();
  const { formatDate } = useDateFormat();
  const { formatCurrency } = useNumberFormat();
  const [collapsed, setCollapsed] = useState(false);

  const sorted = useMemo(
    () => [...rateChanges].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate)),
    [rateChanges],
  );

  const chartData = useMemo(() => {
    if (sorted.length === 0) return [];
    const rows = sorted.map((r) => ({ dateKey: r.effectiveDate, rate: r.annualRate }));
    // Hold the last recorded rate out to the end of the timeline.
    const last = sorted[sorted.length - 1];
    if (endDate && endDate > last.effectiveDate) {
      rows.push({ dateKey: endDate, rate: last.annualRate });
    }
    return rows.map((r) => ({ ...r, label: formatChartDate(r.dateKey, 'MMM yyyy') }));
  }, [sorted, endDate, formatChartDate]);

  const showChart = !collapsed && sorted.length > 0;

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
      className={`relative overflow-hidden bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 scroll-mt-4 ${
        fillHeight ? 'lg:h-full' : ''
      }`}
    >
      {/* Decorative gradient backdrop: the rate over the loan's life. */}
      {showChart && (
        <div className="pointer-events-none absolute inset-0 z-0" aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <AreaChart data={chartData} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="rateHistoryFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={chartColors.primary} stopOpacity={0.32} />
                  <stop offset="100%" stopColor={chartColors.primary} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="label" hide />
              <YAxis hide domain={['auto', 'auto']} />
              <Area
                type="stepAfter"
                dataKey="rate"
                stroke={chartColors.primary}
                strokeWidth={0}
                fill="url(#rateHistoryFill)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="relative z-10 p-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
            className="flex items-start gap-2 text-left group"
          >
            <span className="text-gray-400 dark:text-gray-500 mt-0.5 group-hover:text-blue-600 dark:group-hover:text-blue-400">
              {collapsed ? '▸' : '▾'}
            </span>
            <span>
              <span className="block text-base font-semibold text-gray-900 dark:text-gray-100">
                {t('loanDetail.rateHistory.title')}
              </span>
              <span className="block text-sm text-gray-500 dark:text-gray-400">
                {t('loanDetail.rateHistory.description')}
              </span>
            </span>
          </button>
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

        {!collapsed &&
          (sorted.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t('loanDetail.rateHistory.empty')}
            </p>
          ) : (
            <ul className="max-h-96 overflow-y-auto divide-y divide-gray-200/70 dark:divide-gray-700/70">
              {sorted.map((change) => (
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
                      {t('loanDetail.rateHistory.paymentSummary', { payment: paymentLabel(change) })}
                      {change.note ? ` — ${change.note}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
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
          ))}
      </div>

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
