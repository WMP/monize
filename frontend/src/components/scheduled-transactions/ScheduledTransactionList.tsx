'use client';

import { useState, useCallback, useRef, memo, type JSX } from 'react';
import { useTranslations } from 'next-intl';
import { isPast, isToday, addDays, isBefore } from 'date-fns';
import toast from 'react-hot-toast';
import { ScheduledTransaction, FREQUENCY_LABELS } from '@/types/scheduled-transaction';
import { scheduledTransactionsApi } from '@/lib/scheduled-transactions';
import { parseLocalDate } from '@/lib/utils';
import { getErrorMessage } from '@/lib/errors';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useNumberFormat } from '@/hooks/useNumberFormat';
import { computeInvestmentCashImpact } from '@/lib/investmentCashImpact';
import { InvestmentAction } from '@/types/investment';

/**
 * Cash impact of a scheduled transaction occurrence, taking nextOverride into
 * account when useOverride is true. For investment-kind rows the amount column
 * isn't simply `transaction.amount`; it's derived from qty * price + commission
 * (or totalAmount for amount-only actions), and the override may carry a
 * different qty / price / total than the base row.
 */
function scheduledOccurrenceAmount(
  transaction: ScheduledTransaction,
  useOverride: boolean,
): number | null {
  if (transaction.isInvestment) {
    const action = transaction.investmentAction as InvestmentAction | null;
    if (!action) return null;
    const override = useOverride ? transaction.nextOverride : null;
    const commission = Number(transaction.investmentCommission ?? 0);

    if (action === 'BUY' || action === 'SELL' || action === 'REINVEST') {
      const qty = Number(
        override?.investmentQuantity ?? transaction.investmentQuantity ?? 0,
      );
      const price = Number(
        override?.investmentPrice ?? transaction.investmentPrice ?? 0,
      );
      if (qty <= 0 || price <= 0) return null;
      return computeInvestmentCashImpact(action, qty, price, commission);
    }
    if (action === 'DIVIDEND' || action === 'INTEREST' || action === 'CAPITAL_GAIN') {
      const total =
        override?.investmentTotalAmount ?? transaction.investmentTotalAmount;
      return total != null ? Number(total) : null;
    }
    // ADD_SHARES / REMOVE_SHARES / SPLIT -- shares move, no cash impact.
    return 0;
  }
  if (useOverride && transaction.nextOverride?.amount != null) {
    return Number(transaction.nextOverride.amount);
  }
  return Number(transaction.amount);
}
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Modal } from '@/components/ui/Modal';

type ConfirmAction = 'post' | 'skip' | 'delete';

interface ConfirmState {
  isOpen: boolean;
  action: ConfirmAction | null;
  transaction: ScheduledTransaction | null;
}

interface ScheduledTransactionRowProps {
  transaction: ScheduledTransaction;
  isProcessing: boolean;
  formatDate: (date: string) => string;
  formatAmount: (amount: number | null | undefined, currencyCode?: string) => JSX.Element;
  getDueDateStatus: (nextDueDate: string | undefined | null) => { status: 'overdue' | 'dueToday' | 'dueSoon'; label: string; className: string } | null;
  onRowClick: (transaction: ScheduledTransaction) => void;
  onLongPressStart: (transaction: ScheduledTransaction) => void;
  onLongPressStartTouch: (transaction: ScheduledTransaction, e: React.TouchEvent) => void;
  onLongPressEnd: () => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onPost?: (transaction: ScheduledTransaction) => void;
  onOpenConfirm: (action: 'post' | 'skip' | 'delete', transaction: ScheduledTransaction) => void;
  onEdit?: (transaction: ScheduledTransaction) => void;
  onEditOccurrence?: (transaction: ScheduledTransaction) => void;
  categoryColorMap?: Map<string, string | null>;
}

const ScheduledTransactionRow = memo(function ScheduledTransactionRow({
  transaction,
  isProcessing,
  formatDate,
  formatAmount,
  getDueDateStatus,
  onRowClick,
  onLongPressStart,
  onLongPressStartTouch,
  onLongPressEnd,
  onTouchMove,
  onPost,
  onOpenConfirm,
  onEdit,
  onEditOccurrence,
  categoryColorMap,
}: ScheduledTransactionRowProps) {
  const t = useTranslations('scheduledTransactions');
  const categoryColor = transaction.category
    ? (categoryColorMap?.get(transaction.category.id) ?? transaction.category.color)
    : null;
  const effectiveDueDate = transaction.nextOverride?.overrideDate || transaction.nextDueDate || '';
  const dueDateStatus = effectiveDueDate ? getDueDateStatus(effectiveDueDate) : null;
  const payee = transaction.payeeName || transaction.payee?.name;

  return (
    <tr
      className={`group hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer select-none ${!transaction.isActive ? 'opacity-50' : ''} ${dueDateStatus?.status === 'overdue' ? 'bg-red-50 dark:bg-red-900/10' : 'bg-white dark:bg-gray-900'}`}
      onClick={() => onRowClick(transaction)}
      onMouseDown={() => onLongPressStart(transaction)}
      onMouseUp={onLongPressEnd}
      onMouseLeave={onLongPressEnd}
      onTouchStart={(e) => onLongPressStartTouch(transaction, e)}
      onTouchMove={onTouchMove}
      onTouchEnd={onLongPressEnd}
      onTouchCancel={onLongPressEnd}
    >
      {/* Name / Payee */}
      <td className="px-4 py-3">
        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{transaction.name}</div>
        {payee && payee !== transaction.name && (
          <div className="text-xs text-gray-500 dark:text-gray-400">{payee}</div>
        )}
        {/* Mobile-only: show schedule info under name */}
        <div className="sm:hidden mt-0.5">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {effectiveDueDate ? formatDate(effectiveDueDate) : '\u2014'}
            {' \u00b7 '}{FREQUENCY_LABELS[transaction.frequency]}
          </div>
          {dueDateStatus && (
            <span className={`inline-flex text-xs font-medium rounded-full px-1.5 py-0.5 mt-0.5 ${dueDateStatus.className}`}>
              {dueDateStatus.label}
            </span>
          )}
        </div>
      </td>

      {/* Account */}
      <td className="px-4 py-3 hidden sm:table-cell">
        <div className="text-sm text-gray-900 dark:text-gray-100">{transaction.account?.name}</div>
      </td>

      {/* Category */}
      <td className="px-4 py-3 hidden md:table-cell">
        {transaction.isInvestment ? (
          <span
            className="inline-flex text-xs font-medium rounded-full px-2 py-0.5 bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200"
            title={
              transaction.investmentSecurity
                ? `${transaction.investmentAction || ''} ${transaction.investmentSecurity.symbol || transaction.investmentSecurity.name}`.trim()
                : transaction.investmentAction || t('list.investment')
            }
          >
            {transaction.investmentSecurity?.symbol
              ? t('list.investmentWithSecurity', { action: transaction.investmentAction || t('list.investment'), symbol: transaction.investmentSecurity.symbol })
              : transaction.investmentAction || t('list.investment')}
          </span>
        ) : transaction.isTransfer ? (
          <span
            className="inline-flex text-xs font-medium rounded-full px-2 py-0.5 bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
            title={t('list.transferTo', { name: transaction.transferAccount?.name || t('list.transferToAccountFallback') })}
          >
            {t('list.transfer')}
          </span>
        ) : transaction.isSplit ? (
          <span
            className="inline-flex text-xs font-medium rounded-full px-2 py-0.5 bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200"
            title={transaction.splits?.map(s => s.category?.name || t('list.uncategorized')).join(', ')}
          >
            {t('list.split', { count: transaction.splits?.length || 0 })}
          </span>
        ) : transaction.category ? (
          <span
            className="inline-flex text-xs font-medium rounded-full px-2 py-0.5"
            style={{
              backgroundColor: categoryColor
                ? `color-mix(in srgb, ${categoryColor} 15%, var(--category-bg-base, #e5e7eb))`
                : 'var(--category-bg-base, #e5e7eb)',
              color: categoryColor
                ? `color-mix(in srgb, ${categoryColor} 85%, var(--category-text-mix, #000))`
                : 'var(--category-text-base, #6b7280)',
            }}
          >
            {transaction.category.name}
          </span>
        ) : (
          <span className="text-xs text-gray-400 dark:text-gray-500">{'\u2014'}</span>
        )}
      </td>

      {/* Amount */}
      <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-right">
        {(() => {
          const baseAmount = scheduledOccurrenceAmount(transaction, false);
          const overrideAmount = transaction.nextOverride
            ? scheduledOccurrenceAmount(transaction, true)
            : null;
          const isModified =
            overrideAmount != null &&
            baseAmount != null &&
            Number(overrideAmount) !== Number(baseAmount);
          if (isModified) {
            return (
              <div className="flex flex-col items-end">
                <span className="text-xs text-gray-400 dark:text-gray-500 line-through">
                  {formatAmount(baseAmount, transaction.currencyCode)}
                </span>
                <span title={t('list.modifiedForNext')}>
                  {formatAmount(overrideAmount, transaction.currencyCode)}
                </span>
              </div>
            );
          }
          return formatAmount(baseAmount, transaction.currencyCode);
        })()}
      </td>

      {/* Schedule (Frequency + Next Due + Remaining) */}
      <td className="px-4 py-3 hidden sm:table-cell">
        <div className="text-sm text-gray-900 dark:text-gray-100">
          {/* Show override date if it differs from the original next due date */}
          {transaction.nextOverride?.overrideDate &&
           transaction.nextDueDate &&
           transaction.nextOverride.overrideDate !== String(transaction.nextDueDate).split('T')[0] ? (
            <span className="inline-flex flex-col align-middle">
              <span className="text-xs text-gray-400 dark:text-gray-500 line-through leading-tight">
                {formatDate(transaction.nextDueDate)}
              </span>
              <span className="leading-tight" title={t('list.dateModifiedForOccurrence')}>
                {formatDate(transaction.nextOverride.overrideDate)}
              </span>
            </span>
          ) : (
            transaction.nextDueDate ? formatDate(transaction.nextDueDate) : '\u2014'
          )}
          {dueDateStatus && (
            <span
              className={`ml-1.5 inline-flex text-xs font-medium rounded-full px-1.5 py-0.5 ${dueDateStatus.className}`}
            >
              {dueDateStatus.label}
            </span>
          )}
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {FREQUENCY_LABELS[transaction.frequency]}
          {transaction.occurrencesRemaining !== null && (
            <span className="ml-1">{'\u00b7'} {t('list.leftSuffix', { count: transaction.occurrencesRemaining })}</span>
          )}
          {transaction.overrideCount !== undefined && transaction.overrideCount > 0 && (
            <span
              className="ml-1.5 inline-flex text-xs font-medium rounded-full px-1.5 py-0.5 bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200"
              title={t('list.modifiedOccurrences', { count: transaction.overrideCount, plural: transaction.overrideCount !== 1 ? 's' : '' })}
            >
              {t('list.modifiedCount', { count: transaction.overrideCount })}
            </span>
          )}
        </div>
      </td>

      {/* Auto-post */}
      <td className="px-4 py-3 text-center hidden md:table-cell">
        {transaction.autoPost ? (
          <span
            className="inline-flex items-center text-xs font-medium rounded-full px-2 py-0.5 bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
            title={t('list.autoPostsWhenDue')}
          >
            {t('list.autoOn')}
          </span>
        ) : (
          <span className="text-xs text-gray-400 dark:text-gray-500">{'\u2014'}</span>
        )}
      </td>

      {/* Actions */}
      <td className={`px-4 py-3 whitespace-nowrap text-right hidden min-[480px]:table-cell sticky right-0 ${dueDateStatus?.status === 'overdue' ? 'bg-red-50 dark:bg-red-900/10' : 'bg-white dark:bg-gray-900'} group-hover:bg-gray-100 dark:group-hover:bg-gray-800`} onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-end items-center space-x-1">
          {transaction.isActive && (
            <>
              <button
                onClick={() => onPost ? onPost(transaction) : onOpenConfirm('post', transaction)}
                disabled={isProcessing}
                className="p-1 text-green-600 dark:text-green-400 hover:text-green-900 dark:hover:text-green-300 hover:bg-green-50 dark:hover:bg-green-900/50 rounded disabled:opacity-50"
                title={t('list.postTransaction')}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </button>
              {transaction.frequency !== 'ONCE' && (
                <button
                  onClick={() => onOpenConfirm('skip', transaction)}
                  disabled={isProcessing}
                  className="p-1 text-yellow-600 dark:text-yellow-400 hover:text-yellow-900 dark:hover:text-yellow-300 hover:bg-yellow-50 dark:hover:bg-yellow-900/50 rounded disabled:opacity-50"
                  title={t('list.skipThisOccurrence')}
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                  </svg>
                </button>
              )}
            </>
          )}
          {onEditOccurrence && transaction.isActive && (
            <button
              onClick={() => onEditOccurrence(transaction)}
              className="p-1 text-purple-600 dark:text-purple-400 hover:text-purple-900 dark:hover:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-900/50 rounded"
              title={t('list.editOccurrence')}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </button>
          )}
          {onEdit && (
            <button
              onClick={() => onEdit(transaction)}
              className="p-1 text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/50 rounded"
              title={t('list.editSchedule')}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          )}
          <button
            onClick={() => onOpenConfirm('delete', transaction)}
            disabled={isProcessing}
            className="p-1 text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/50 rounded disabled:opacity-50"
            title={t('list.delete')}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </td>
    </tr>
  );
});

interface ScheduledTransactionListProps {
  transactions: ScheduledTransaction[];
  onEdit?: (transaction: ScheduledTransaction) => void;
  onEditOccurrence?: (transaction: ScheduledTransaction) => void;
  onPost?: (transaction: ScheduledTransaction) => void;
  onRefresh?: () => void;
  categoryColorMap?: Map<string, string | null>;
}

export function ScheduledTransactionList({
  transactions,
  onEdit,
  onEditOccurrence,
  onPost,
  onRefresh,
  categoryColorMap,
}: ScheduledTransactionListProps) {
  const t = useTranslations('scheduledTransactions');
  const { formatDate } = useDateFormat();
  const { formatCurrency } = useNumberFormat();
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState>({
    isOpen: false,
    action: null,
    transaction: null,
  });

  // Long-press handling for context menu on mobile
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const longPressTriggered = useRef(false);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);
  const LONG_PRESS_MOVE_THRESHOLD = 10;
  const [contextTransaction, setContextTransaction] = useState<ScheduledTransaction | null>(null);

  const handleLongPressStart = useCallback((transaction: ScheduledTransaction, e?: React.TouchEvent) => {
    if (e?.touches?.[0]) {
      touchStartPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else {
      touchStartPos.current = null;
    }
    longPressTriggered.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true;
      setContextTransaction(transaction);
    }, 750);
  }, []);

  const handleLongPressEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    touchStartPos.current = null;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (touchStartPos.current && longPressTimer.current && e.touches?.[0]) {
      const deltaX = Math.abs(e.touches[0].clientX - touchStartPos.current.x);
      const deltaY = Math.abs(e.touches[0].clientY - touchStartPos.current.y);
      if (deltaX > LONG_PRESS_MOVE_THRESHOLD || deltaY > LONG_PRESS_MOVE_THRESHOLD) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
        touchStartPos.current = null;
      }
    }
  }, []);

  const handleRowClick = useCallback((transaction: ScheduledTransaction) => {
    if (longPressTriggered.current) {
      longPressTriggered.current = false;
      return;
    }
    onEdit?.(transaction);
  }, [onEdit]);

  const openConfirm = (action: ConfirmAction, transaction: ScheduledTransaction) => {
    setConfirmState({ isOpen: true, action, transaction });
  };

  const closeConfirm = () => {
    setConfirmState({ isOpen: false, action: null, transaction: null });
  };

  const handleConfirm = async () => {
    const { action, transaction } = confirmState;
    if (!action || !transaction) return;

    closeConfirm();
    setActionInProgress(transaction.id);

    try {
      switch (action) {
        case 'post':
          await scheduledTransactionsApi.post(transaction.id);
          toast.success(t('list.transactionPosted'));
          break;
        case 'skip':
          await scheduledTransactionsApi.skip(transaction.id);
          toast.success(t('list.occurrenceSkipped'));
          break;
        case 'delete':
          await scheduledTransactionsApi.delete(transaction.id);
          toast.success(t('list.scheduledTransactionDeleted'));
          break;
      }
      onRefresh?.();
    } catch (error) {
      const messages = {
        post: t('list.failedToPost'),
        skip: t('list.failedToSkip'),
        delete: t('list.failedToDelete'),
      };
      toast.error(getErrorMessage(error, messages[action]));
    } finally {
      setActionInProgress(null);
    }
  };

  const getConfirmConfig = () => {
    const { action, transaction } = confirmState;
    if (!action || !transaction) {
      return { title: '', message: '', confirmLabel: '', variant: 'info' as const };
    }

    switch (action) {
      case 'post':
        return {
          title: t('list.confirmPostTitle'),
          message: t('list.confirmPostMessage', { name: transaction.name, account: transaction.account?.name || t('list.accountFallback') }),
          confirmLabel: t('list.confirmPostLabel'),
          variant: 'info' as const,
        };
      case 'skip':
        return {
          title: t('list.confirmSkipTitle'),
          message: t('list.confirmSkipMessage', { name: transaction.name }),
          confirmLabel: t('list.confirmSkipLabel'),
          variant: 'warning' as const,
        };
      case 'delete':
        return {
          title: t('list.confirmDeleteTitle'),
          message: t('list.confirmDeleteMessage', { name: transaction.name }),
          confirmLabel: t('list.confirmDeleteLabel'),
          variant: 'danger' as const,
        };
    }
  };

  const formatAmount = (amount: number | null | undefined, currencyCode?: string) => {
    if (amount == null) return <span className="text-gray-400">—</span>;
    const numAmount = Number(amount);
    if (isNaN(numAmount)) return <span className="text-gray-400">—</span>;

    const isNegative = numAmount < 0;
    const absAmount = Math.abs(numAmount);
    const formatted = formatCurrency(absAmount, currencyCode);

    return (
      <span className={isNegative ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}>
        {isNegative ? '-' : '+'}
        {formatted}
      </span>
    );
  };

  const getDueDateStatus = (nextDueDate: string | undefined | null) => {
    if (!nextDueDate) return null;

    try {
      const date = parseLocalDate(nextDueDate);
      if (!date || isNaN(date.getTime())) return null;

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (isPast(date) && !isToday(date)) {
        return { status: 'overdue' as const, label: t('list.overdue'), className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' };
      }
      if (isToday(date)) {
        return { status: 'dueToday' as const, label: t('list.dueToday'), className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' };
      }
      if (isBefore(date, addDays(today, 7))) {
        return { status: 'dueSoon' as const, label: t('list.dueSoon'), className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' };
      }
      return null;
    } catch {
      return null;
    }
  };

  if (transactions.length === 0) {
    return (
      <div className="text-center py-12 bg-gray-50 dark:bg-gray-800 rounded-lg">
        <svg
          className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
        <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-gray-100">{t('list.noScheduledTransactions')}</h3>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {t('list.getStarted')}
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
        <thead className="bg-gray-50 dark:bg-gray-800">
          <tr>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              {t('list.headerNamePayee')}
            </th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell">
              {t('list.headerAccount')}
            </th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden md:table-cell">
              {t('list.headerCategory')}
            </th>
            <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              {t('list.headerAmount')}
            </th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell">
              {t('list.headerSchedule')}
            </th>
            <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden md:table-cell">
              {t('list.headerAuto')}
            </th>
            <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden min-[480px]:table-cell sticky right-0 bg-gray-50 dark:bg-gray-800">
              {t('list.headerActions')}
            </th>
          </tr>
        </thead>
        <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
          {transactions.map((transaction) => (
            <ScheduledTransactionRow
              key={transaction.id}
              transaction={transaction}
              isProcessing={actionInProgress === transaction.id}
              formatDate={formatDate}
              formatAmount={formatAmount}
              getDueDateStatus={getDueDateStatus}
              onRowClick={handleRowClick}
              onLongPressStart={handleLongPressStart}
              onLongPressStartTouch={handleLongPressStart}
              onLongPressEnd={handleLongPressEnd}
              onTouchMove={handleTouchMove}
              onPost={onPost}
              onOpenConfirm={openConfirm}
              onEdit={onEdit}
              onEditOccurrence={onEditOccurrence}
              categoryColorMap={categoryColorMap}
            />
          ))}
        </tbody>
      </table>

      {/* Long-press Context Menu */}
      <Modal isOpen={!!contextTransaction} onClose={() => setContextTransaction(null)} maxWidth="sm" className="p-0">
        {contextTransaction && (
          <div>
            <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 truncate">{contextTransaction.name}</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {FREQUENCY_LABELS[contextTransaction.frequency]}
                {!contextTransaction.isActive ? t('list.inactiveSuffix') : ''}
              </p>
            </div>
            <div className="py-2">
              {contextTransaction.isActive && (
                <>
                  <button
                    onClick={() => { const t = contextTransaction; setContextTransaction(null); onPost ? onPost(t) : openConfirm('post', t); }}
                    className="w-full text-left px-5 py-3 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-3"
                  >
                    <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {t('list.postTransactionAction')}
                  </button>
                  {contextTransaction.frequency !== 'ONCE' && (
                    <button
                      onClick={() => { const t = contextTransaction; setContextTransaction(null); openConfirm('skip', t); }}
                      className="w-full text-left px-5 py-3 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-3"
                    >
                      <svg className="w-5 h-5 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                      </svg>
                      {t('list.skipOccurrenceAction')}
                    </button>
                  )}
                  {onEditOccurrence && (
                    <button
                      onClick={() => { const t = contextTransaction; setContextTransaction(null); onEditOccurrence(t); }}
                      className="w-full text-left px-5 py-3 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-3"
                    >
                      <svg className="w-5 h-5 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      {t('list.editOccurrenceAction')}
                    </button>
                  )}
                </>
              )}
              {onEdit && (
                <button
                  onClick={() => { const t = contextTransaction; setContextTransaction(null); onEdit(t); }}
                  className="w-full text-left px-5 py-3 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-3"
                >
                  <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  {t('list.editScheduleAction')}
                </button>
              )}
              <button
                onClick={() => { const t = contextTransaction; setContextTransaction(null); openConfirm('delete', t); }}
                className="w-full text-left px-5 py-3 text-sm text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-3"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                {t('list.deleteAction')}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={confirmState.isOpen}
        onConfirm={handleConfirm}
        onCancel={closeConfirm}
        {...getConfirmConfig()}
      />
    </div>
  );
}
