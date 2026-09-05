'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { SecurityShareAdjustmentForm } from './SecurityShareAdjustmentForm';
import { InvestmentTransactionForm } from '@/components/investments/InvestmentTransactionForm';
import { investmentsApi } from '@/lib/investments';
import { accountsApi } from '@/lib/accounts';
import { getErrorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/logger';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useNumberFormat } from '@/hooks/useNumberFormat';
import toast from 'react-hot-toast';
import type { Account } from '@/types/account';
import type {
  InvestmentTransaction,
  Security,
  SecurityTransactionHistory as SecurityTransactionHistoryData,
} from '@/types/investment';

const logger = createLogger('SecurityTxHistory');

interface SecurityTransactionHistoryProps {
  security: Security;
  /** Called after a transaction is added so callers can refresh dependent data. */
  onChanged?: () => void;
}

export function SecurityTransactionHistory({
  security,
  onChanged,
}: SecurityTransactionHistoryProps) {
  const t = useTranslations('securities');
  const tc = useTranslations('common');
  const { formatDate } = useDateFormat();
  const { formatCurrency, formatCurrencyPrecise, formatShareQuantity } = useNumberFormat();
  const [history, setHistory] = useState<SecurityTransactionHistoryData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('all');
  const [showAddForm, setShowAddForm] = useState(false);
  // Full account objects (including closed) for the edit form's pickers.
  const [allAccounts, setAllAccounts] = useState<Account[]>([]);
  const [editTransaction, setEditTransaction] = useState<InvestmentTransaction | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await investmentsApi.getSecurityTransactionHistory(security.id);
      setHistory(data);
    } catch (error) {
      logger.error('Failed to load security transaction history:', error);
      // getErrorMessage keeps the message consistent with the rest of the app.
      setHistory(null);
      throw new Error(getErrorMessage(error, t('transactionHistory.toasts.loadHistoryFailed')));
    } finally {
      setIsLoading(false);
    }
  }, [security.id, t]);

  useEffect(() => {
    load().catch(() => {
      /* error already logged; UI shows empty state */
    });
  }, [load]);

  // Load all accounts (including closed) once, so editing a transaction in a
  // closed account still has its account available in the form.
  useEffect(() => {
    let cancelled = false;
    accountsApi
      .getAll(true)
      .then((data) => {
        if (!cancelled) setAllAccounts(data);
      })
      .catch((error) => {
        if (!cancelled) logger.error('Failed to load accounts:', error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleEditClick = useCallback(async (id: string) => {
    try {
      const tx = await investmentsApi.getTransaction(id);
      setEditTransaction(tx);
    } catch (error) {
      toast.error(getErrorMessage(error, t('transactionHistory.toasts.loadTransactionFailed')));
    }
  }, [t]);

  const handleEditSuccess = () => {
    setEditTransaction(null);
    onChanged?.();
    load().catch(() => {});
  };

  const accounts = useMemo(() => history?.accounts ?? [], [history]);
  const showAccountColumn = selectedAccountId === 'all';

  const visibleTransactions = useMemo(() => {
    const txns = history?.transactions ?? [];
    if (selectedAccountId === 'all') return txns;
    return txns.filter((t) => t.accountId === selectedAccountId);
  }, [history, selectedAccountId]);

  const defaultAdjustAccountId =
    selectedAccountId !== 'all' ? selectedAccountId : accounts[0]?.accountId;

  const handleAdjustmentSubmitted = () => {
    setShowAddForm(false);
    onChanged?.();
    load().catch(() => {});
  };

  return (
    <div>
      {/* No heading or share count: the detail page's header and summary cards
          already carry both. */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        {accounts.length > 0 && (
          <div className="w-full sm:max-w-xs">
            <Select
              label={t('transactionHistory.accountLabel')}
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
              options={[
                { value: 'all', label: t('transactionHistory.allAccounts', { shares: formatShareQuantity(history?.currentQuantityAll ?? 0) }) },
                ...accounts.map((a) => ({
                  value: a.accountId,
                  label: `${a.isClosed ? t('transactionHistory.accountClosed', { name: a.accountName }) : a.accountName} — ${formatShareQuantity(a.currentQuantity)}`,
                })),
              ]}
            />
          </div>
        )}
        {accounts.length > 0 && !showAddForm && (
          <Button size="sm" variant="outline" onClick={() => setShowAddForm(true)}>
            {t('transactionHistory.addTransaction')}
          </Button>
        )}
      </div>

      {showAddForm && (
        <div className="mb-4">
          <SecurityShareAdjustmentForm
            securityId={security.id}
            accounts={accounts}
            defaultAccountId={defaultAdjustAccountId}
            onSubmitted={handleAdjustmentSubmitted}
            onCancel={() => setShowAddForm(false)}
          />
        </div>
      )}

      {isLoading ? (
        <LoadingSpinner text={t('transactionHistory.loading')} />
      ) : visibleTransactions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500 dark:border-gray-600 dark:text-gray-400">
          {selectedAccountId !== 'all' ? t('transactionHistory.emptyAccount') : t('transactionHistory.emptyAll')}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('transactionHistory.columns.date')}</th>
                {showAccountColumn && (
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('transactionHistory.columns.account')}</th>
                )}
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('transactionHistory.columns.action')}</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('transactionHistory.columns.quantity')}</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('transactionHistory.columns.runningTotal')}</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('transactionHistory.columns.price')}</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('transactionHistory.columns.amount')}</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  <span className="sr-only">{t('transactionHistory.columns.actionsLabel')}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900">
              {visibleTransactions.map((tx) => {
                const running =
                  selectedAccountId === 'all'
                    ? tx.runningQuantityAll
                    : tx.runningQuantityAccount;
                return (
                  <tr key={tx.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-900 dark:text-gray-100">
                      {formatDate(tx.transactionDate)}
                    </td>
                    {showAccountColumn && (
                      <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300">
                        {tx.accountName}
                      </td>
                    )}
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700 dark:text-gray-300">
                      {t(`transactionHistory.actionLabels.${tx.action}` as Parameters<typeof t>[0]) ?? tx.action}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-sm text-gray-900 dark:text-gray-100">
                      {tx.quantity === null ? '-' : formatShareQuantity(tx.quantity)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-sm font-medium text-gray-900 dark:text-gray-100">
                      {formatShareQuantity(running)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-sm text-gray-700 dark:text-gray-300">
                      {tx.price === null ? '-' : formatCurrencyPrecise(tx.price, security.currencyCode, 4)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-sm text-gray-700 dark:text-gray-300">
                      {formatCurrency(tx.totalAmount, security.currencyCode)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEditClick(tx.id)}
                        className="text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300"
                      >
                        {tc('edit')}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit transaction modal, opened from a row on the detail page's
          Transactions tab. */}
      <Modal
        isOpen={!!editTransaction}
        onClose={() => setEditTransaction(null)}
        maxWidth="lg"
        className="p-6"
        pushHistory
      >
        {editTransaction && (
          <>
            <h2 className="mb-4 text-2xl font-bold text-gray-900 dark:text-gray-100">
              {t('transactionHistory.editTransactionTitle')}
            </h2>
            <InvestmentTransactionForm
              transaction={editTransaction}
              accounts={allAccounts}
              allAccounts={allAccounts}
              onSuccess={handleEditSuccess}
              onCancel={() => setEditTransaction(null)}
            />
          </>
        )}
      </Modal>
    </div>
  );
}
