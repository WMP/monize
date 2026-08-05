'use client';

import { useTranslations } from 'next-intl';
import { useNumberFormat } from '@/hooks/useNumberFormat';
import { useDateFormat } from '@/hooks/useDateFormat';
import { RateCell } from './RateCell';
import { LoanRateEditing } from './useLoanRateEditing';
import type { DisplayRow } from '@/lib/loan-schedule-rows';

export type { DisplayRow } from '@/lib/loan-schedule-rows';

interface ScheduleTableRowProps {
  row: DisplayRow;
  currencyCode: string;
  showExtraColumn: boolean;
  /** When provided, a projected row's rate is inline-editable. */
  editing?: LoanRateEditing;
  /** An indented per-date detail row inside an expanded month group. */
  isChild?: boolean;
  /**
   * When set, this row is a month aggregate: the Date cell shows the month
   * label and an expand/collapse toggle for its detail rows instead of a date.
   */
  monthGroup?: {
    label: string;
    expanded: boolean;
    count: number;
    /** True when a gap in payments falls between two of this group's children. */
    hasGap: boolean;
    /** Accessible label describing the gap, shared with the full-width gap band. */
    gapLabel: string;
    onToggle: () => void;
  };
}

const cellClass = 'px-4 py-3 whitespace-nowrap text-sm';

/**
 * One Loan Schedule row: a historical payment, a month aggregate (with an
 * expand toggle), an indented per-date detail row, or a projected installment.
 * Historical and aggregate rows show their rate read-only (it is observed from
 * the interest charged); only projected rows expose the inline rate editor.
 */
export function ScheduleTableRow({
  row,
  currencyCode,
  showExtraColumn,
  editing,
  isChild = false,
  monthGroup,
}: ScheduleTableRowProps) {
  const t = useTranslations('accounts');
  const { formatCurrency } = useNumberFormat();
  const { formatDate } = useDateFormat();

  const existingChange = row.change;
  const editRateHandler = !editing || !row.isProjected
    ? undefined
    : existingChange
      ? () => editing.openEdit(existingChange)
      : row.annualRate != null
        ? () => editing.openAddWith(row.date, row.annualRate as number)
        : undefined;

  return (
    <tr
      className={`hover:bg-gray-50 dark:hover:bg-gray-700/50 ${
        row.isProjected ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''
      } ${isChild ? 'bg-gray-50/60 dark:bg-gray-900/20' : ''}`}
    >
      <td className={`${cellClass} text-gray-500 dark:text-gray-400`}>
        {isChild ? '' : row.paymentNumber}
      </td>
      <td className={`${cellClass} text-gray-900 dark:text-gray-100 ${isChild ? 'pl-10' : ''}`}>
        {monthGroup ? (
          <button
            type="button"
            onClick={monthGroup.onToggle}
            aria-expanded={monthGroup.expanded}
            aria-label={t('loanDetail.schedule.toggleMonth', { month: monthGroup.label })}
            className="inline-flex items-center gap-1.5 text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400"
          >
            <span className="text-xs text-gray-400">{monthGroup.expanded ? '▾' : '▸'}</span>
            {monthGroup.label}
            <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
              {t('loanDetail.schedule.monthEntries', { count: monthGroup.count })}
            </span>
            {monthGroup.hasGap && (
              <span
                className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                title={monthGroup.gapLabel}
              >
                <span aria-hidden="true">!</span>
                <span className="sr-only">{monthGroup.gapLabel}</span>
              </span>
            )}
          </button>
        ) : (
          <>
            {formatDate(row.date)}
            {row.isProjected && (
              <span className="ml-1.5 text-xs text-blue-500 dark:text-blue-400">*</span>
            )}
            {row.isOverpayment && (
              <span className="ml-1.5 inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                {t('loanDetail.schedule.overpaymentBadge')}
              </span>
            )}
            {row.rateChange && (
              <span className="ml-1.5 inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">
                {t('loanDetail.schedule.rateChangeBadge', {
                  from: row.rateChange.from,
                  to: row.rateChange.to,
                })}
              </span>
            )}
          </>
        )}
      </td>
      <td className={`${cellClass} text-right text-gray-900 dark:text-gray-100`}>
        {formatCurrency(row.payment, currencyCode)}
      </td>
      <td className={`${cellClass} text-right text-orange-600 dark:text-orange-400`}>
        {formatCurrency(row.interest, currencyCode)}
      </td>
      <td className={`${cellClass} text-right text-green-600 dark:text-green-400`}>
        {formatCurrency(row.principal, currencyCode)}
      </td>
      {showExtraColumn && (
        <td className={`${cellClass} text-right text-blue-600 dark:text-blue-400`}>
          {row.extraPrincipal > 0 ? formatCurrency(row.extraPrincipal, currencyCode) : '—'}
        </td>
      )}
      <td className={`${cellClass} text-right`}>
        <RateCell
          annualRate={row.annualRate}
          // A saved rate change already effective on this date is EDITED, not
          // added. This always opened the Add flow, which then failed on the
          // duplicate-date conflict -- so a change point, the row a user is
          // most likely to click, was the one row that could not be adjusted.
          //
          // Whether a HISTORICAL row should offer this at all is a separate
          // question and deliberately unchanged here: this component's doc
          // comment says only projected rows expose the editor, but a test
          // asserts historical rows seed the Add form, so removing that
          // affordance is a product decision (DEC-20260803-006).
          onEdit={editRateHandler}
          editLabel={t('loanDetail.schedule.editRateLabel', {
            date: formatDate(row.date),
          })}
        />
      </td>
      <td className={`${cellClass} text-right font-medium text-gray-900 dark:text-gray-100`}>
        {formatCurrency(row.balance, currencyCode)}
      </td>
    </tr>
  );
}
