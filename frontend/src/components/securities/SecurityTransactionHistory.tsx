'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { SecurityShareAdjustmentForm } from './SecurityShareAdjustmentForm';
import { investmentsApi } from '@/lib/investments';
import { formatShareQuantity } from '@/lib/format';
import { getErrorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/logger';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useNumberFormat } from '@/hooks/useNumberFormat';
import type {
  InvestmentAction,
  Security,
  SecurityTransactionHistory as SecurityTransactionHistoryData,
} from '@/types/investment';

const logger = createLogger('SecurityTxHistory');

const ACTION_LABELS: Record<InvestmentAction, string> = {
  BUY: 'Buy',
  SELL: 'Sell',
  DIVIDEND: 'Dividend',
  INTEREST: 'Interest',
  CAPITAL_GAIN: 'Capital Gain',
  SPLIT: 'Split',
  TRANSFER_IN: 'Transfer In',
  TRANSFER_OUT: 'Transfer Out',
  REINVEST: 'Reinvest',
  ADD_SHARES: 'Add Shares',
  REMOVE_SHARES: 'Remove Shares',
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
  const { formatDate } = useDateFormat();
  const { formatCurrency } = useNumberFormat();
  const [history, setHistory] = useState<SecurityTransactionHistoryData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('all');
  const [showAddForm, setShowAddForm] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await investmentsApi.getSecurityTransactionHistory(security.id);
      setHistory(data);
    } catch (error) {
      logger.error('Failed to load security transaction history:', error);
      // getErrorMessage keeps the message consistent with the rest of the app.
      setHistory(null);
      throw new Error(getErrorMessage(error, 'Failed to load history'));
    } finally {
      setIsLoading(false);
    }
  }, [security.id]);

  useEffect(() => {
    load().catch(() => {
      /* error already logged; UI shows empty state */
    });
  }, [load]);

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
                Inactive
              </span>
            )}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">{security.name}</p>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wider text-gray-400 dark:text-gray-500">
            Current shares
          </div>
          <div className="font-mono text-lg font-semibold text-gray-900 dark:text-gray-100">
            {formatShareQuantity(currentShares)}
          </div>
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        {accounts.length > 0 && (
          <div className="w-full sm:max-w-xs">
            <Select
              label="Account"
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
              options={[
                { value: 'all', label: `All accounts (${formatShareQuantity(history?.currentQuantityAll ?? 0)})` },
                ...accounts.map((a) => ({
                  value: a.accountId,
                  label: `${a.isClosed ? `${a.accountName} (closed)` : a.accountName} — ${formatShareQuantity(a.currentQuantity)}`,
                })),
              ]}
            />
          </div>
        )}
        {accounts.length > 0 && !showAddForm && (
          <Button size="sm" variant="outline" onClick={() => setShowAddForm(true)}>
            + Add transaction
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
        <LoadingSpinner text="Loading transactions..." />
      ) : visibleTransactions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500 dark:border-gray-600 dark:text-gray-400">
          No transactions for this security{selectedAccountId !== 'all' ? ' in the selected account' : ''}.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Date</th>
                {showAccountColumn && (
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Account</th>
                )}
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Action</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Quantity</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Running Total</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Price</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Amount</th>
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
                      {ACTION_LABELS[tx.action] ?? tx.action}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-sm text-gray-900 dark:text-gray-100">
                      {tx.quantity === null ? '-' : formatShareQuantity(tx.quantity)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-sm font-medium text-gray-900 dark:text-gray-100">
                      {formatShareQuantity(running)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-sm text-gray-700 dark:text-gray-300">
                      {tx.price === null ? '-' : formatCurrency(tx.price, security.currencyCode, 4)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-sm text-gray-700 dark:text-gray-300">
                      {formatCurrency(tx.totalAmount, security.currencyCode)}
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
          Close
        </Button>
      </div>
    </div>
  );
}
