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
import { formatShareQuantity } from '@/lib/format';
import { getErrorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/logger';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useNumberFormat } from '@/hooks/useNumberFormat';
import toast from 'react-hot-toast';
import type { Account } from '@/types/account';
import type {
  InvestmentAction,
  InvestmentTransaction,
  Security,
  SecurityTransactionHistory as SecurityTransactionHistoryData,
} from '@/types/investment';

const logger = createLogger('SecurityTxHistory');

// Action labels are stored as `transactionHistory.actionLabels` keys and
// resolved at render via t(...).
const ACTION_LABEL_KEYS: Record<InvestmentAction, string> = {
  BUY: 'transactionHistory.actionLabels.buy',
  SELL: 'transactionHistory.actionLabels.sell',
  DIVIDEND: 'transactionHistory.actionLabels.dividend',
  INTEREST: 'transactionHistory.actionLabels.interest',
  CAPITAL_GAIN: 'transactionHistory.actionLabels.capitalGain',
  SPLIT: 'transactionHistory.actionLabels.split',
  TRANSFER_IN: 'transactionHistory.actionLabels.transferIn',
  TRANSFER_OUT: 'transactionHistory.actionLabels.transferOut',
  REINVEST: 'transactionHistory.actionLabels.reinvest',
  ADD_SHARES: 'transactionHistory.actionLabels.addShares',
  REMOVE_SHARES: 'transactionHistory.actionLabels.removeShares',
};

interface SecurityTransactionHistoryProps {
  security: Security;
  onClose: () => void;
  /** Called after a transaction is added so callers can refresh dependent data. */
  onChanged?: () => void;
}

export function SecurityTransactionHistory({
  security,
  onClose,
  onChanged,
}: SecurityTransactionHistoryProps) {
  const t = useTranslations('securities');
  const { formatDate } = useDateFormat();
  const { formatCurrency, formatCurrencyPrecise } = useNumberFormat();
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
      throw new Error(getErrorMessage(error, t('transactionHistory.toast.loadFailed')));
    } finally {
      setIsLoading(false);
    }
    // `t` is intentionally omitted: next-intl returns a stable t in production,
    // but the test mock returns a fresh function each render; including it here
    // would re-create `load` every render and loop the load-on-mount effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [security.id]);

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
      toast.error(getErrorMessage(error, t('transactionHistory.toast.loadTransactionFailed')));
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

  // Shares currently held for the current view (selected account, or total).
  const currentShares = useMemo(() => {
    if (!history) return 0;
    if (selectedAccountId === 'all') return history.currentQuantityAll;
    return (
      accounts.find((a) => a.accountId === selectedAccountId)?.currentQuantity ?? 0
    );
  }, [history, selectedAccountId, accounts]);

  const defaultAdjustAccountId =
    selectedAccountId !== 'all' ? selectedAccountId : accounts[0]?.accountId;

  const handleAdjustmentSubmitted = () => {
    setShowAddForm(false);
    onChanged?.();
    load().catch(() => {});
  };

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {security.symbol}
            {!security.isActive && (
              <span className="ml-2 inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                {t('transactionHistory.inactive')}
              </span>
            )}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">{security.name}</p>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wider text-gray-400 dark:text-gray-500">
            {t('transactionHistory.currentShares')}
          </div>
          <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {formatShareQuantity(currentShares)}
          </div>
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        {accounts.length > 0 && (
          <div className="w-full sm:max-w-xs">
            <Select
              label={t('transactionHistory.account')}
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
              options={[
                { value: 'all', label: t('transactionHistory.allAccounts', { quantity: formatShareQuantity(history?.currentQuantityAll ?? 0) }) },
                ...accounts.map((a) => ({
                  value: a.accountId,
                  label: a.isClosed
                    ? t('transactionHistory.accountClosed', { name: a.accountName, quantity: formatShareQuantity(a.currentQuantity) })
                    : t('transactionHistory.accountOption', { name: a.accountName, quantity: formatShareQuantity(a.currentQuantity) }),
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
        <LoadingSpinner text={t('transactionHistory.loadingTransactions')} />
      ) : visibleTransactions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500 dark:border-gray-600 dark:text-gray-400">
          {selectedAccountId !== 'all'
            ? t('transactionHistory.noTransactionsInAccount')
            : t('transactionHistory.noTransactions')}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('transactionHistory.headers.date')}</th>
                {showAccountColumn && (
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('transactionHistory.headers.account')}</th>
                )}
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('transactionHistory.headers.action')}</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('transactionHistory.headers.quantity')}</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('transactionHistory.headers.runningTotal')}</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('transactionHistory.headers.price')}</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('transactionHistory.headers.amount')}</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  <span className="sr-only">{t('transactionHistory.headers.actions')}</span>
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
                      {ACTION_LABEL_KEYS[tx.action] ? t(ACTION_LABEL_KEYS[tx.action]) : tx.action}
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
                        {t('transactionHistory.edit')}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-6 flex justify-end">
        <Button variant="outline" onClick={onClose}>
          {t('transactionHistory.close')}
        </Button>
      </div>

      {/* Edit transaction modal (stacked on the history modal) */}
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
              {t('transactionHistory.editTransaction')}
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
