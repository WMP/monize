'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useOnUndoRedo } from '@/hooks/useOnUndoRedo';
import { useOnAiAction } from '@/hooks/useOnAiAction';
import { Button } from '@/components/ui/Button';
import { TOUR_ANCHORS, tourAnchor } from '@/lib/tours/anchors';

import { AccountList } from '@/components/accounts/AccountList';
import { AccountFormModal } from '@/components/accounts/AccountFormModal';
import { accountsApi } from '@/lib/accounts';
import { investmentsApi } from '@/lib/investments';
import { institutionsApi } from '@/lib/institutions';
import { countLogicalAccounts } from '@/lib/account-utils';
import { Account } from '@/types/account';
import { Institution } from '@/types/institution';
import { PortfolioSummary } from '@/types/investment';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { SummaryCard, SummaryIcons } from '@/components/ui/SummaryCard';
import { PartialTotal } from '@/components/ui/PartialTotal';
import { sumConverted, combineTotals } from '@/lib/currency-total';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useFormModal } from '@/hooks/useFormModal';
import { useExchangeRates } from '@/hooks/useExchangeRates';
import { useNumberFormat } from '@/hooks/useNumberFormat';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { createLogger } from '@/lib/logger';
import { showErrorToast } from '@/lib/errors';

const logger = createLogger('Accounts');

export default function AccountsPage() {
  return (
    <ProtectedRoute>
      <AccountsContent />
    </ProtectedRoute>
  );
}

function AccountsContent() {
  const t = useTranslations('accounts');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [portfolioSummary, setPortfolioSummary] = useState<PortfolioSummary | null>(null);
  // A failed portfolio request is not an empty portfolio. Kept apart so a
  // brokerage account's market value reads as unknown rather than zero -- the
  // page used to drop 100,000 of holdings out of Assets and Net Worth silently.
  const [portfolioFailed, setPortfolioFailed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const formModal = useFormModal<Account>();
  const { openCreate, openEdit } = formModal;
  const { convertToDefault, defaultCurrency } = useExchangeRates();
  const { formatCurrency } = useNumberFormat();

  const loadAccounts = useCallback(async () => {
    setIsLoading(true);
    try {
      const [data, portfolio, insts] = await Promise.all([
        accountsApi.getAll(true),
        investmentsApi
          .getPortfolioSummary()
          .then((summary) => ({ ok: true as const, summary }))
          .catch(() => ({ ok: false as const, summary: null })),
        institutionsApi.getAll().catch(() => [] as Institution[]),
      ]);
      setAccounts(data);
      setPortfolioSummary(portfolio.summary);
      setPortfolioFailed(!portfolio.ok);
      setInstitutions(insts);
    } catch (error) {
      showErrorToast(error, t('toast.loadFailed'));
      logger.error(error);
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  useOnUndoRedo(loadAccounts);
  // An AI write can change account balances (e.g. a transaction created from
  // the chat bubble), so refresh the same way as an undo/redo.
  useOnAiAction(loadAccounts);

  // Build a map of brokerage account ID -> market value of holdings only.
  // Cash balance is tracked separately via the linked INVESTMENT_CASH account
  // to avoid double-counting in the net worth summary.
  const brokerageMarketValues = useMemo(() => {
    const map = new Map<string, number>();
    if (!portfolioSummary) return map;
    for (const accountHoldings of portfolioSummary.holdingsByAccount) {
      map.set(accountHoldings.accountId, accountHoldings.totalMarketValue);
    }
    return map;
  }, [portfolioSummary]);

  const LIABILITY_TYPES = ['CREDIT_CARD', 'LOAN', 'MORTGAGE', 'LINE_OF_CREDIT'];

  /**
   * The balance an account contributes, or `null` when it is not known.
   *
   * A brokerage account's contribution is its holdings' market value, which
   * comes from the portfolio summary. When that request failed the value is
   * unknown -- `?? 0` used to drop the whole position out of the totals without
   * a trace. A brokerage account genuinely absent from a *successful* summary
   * holds no positions, which is a real zero.
   */
  const contributedBalance = (a: Account): number | null => {
    if (a.accountSubType === 'INVESTMENT_BROKERAGE') {
      if (portfolioFailed) return null;
      return brokerageMarketValues.get(a.id) ?? 0;
    }
    return (Number(a.currentBalance) || 0) + (Number(a.futureTransactionsSum) || 0);
  };

  const summary = useMemo(() => {
    const activeAccounts = accounts.filter((a) => !a.isClosed);
    const assets = activeAccounts.filter((a) => !LIABILITY_TYPES.includes(a.accountType));
    const liabilities = activeAccounts.filter((a) => LIABILITY_TYPES.includes(a.accountType));

    // An unknown component excludes the account from the subtotal and is
    // reported, rather than being converted to zero or 1:1.
    const convertOrUnknown = (amount: number | null, currency: string) =>
      amount === null ? null : convertToDefault(amount, currency);

    const totalAssets = sumConverted(
      assets,
      (a) => contributedBalance(a) ?? Number.NaN,
      (a) => a.currencyCode,
      (amount, currency) => convertOrUnknown(amount, currency),
    );
    const totalLiabilities = sumConverted(
      liabilities,
      (a) => contributedBalance(a) ?? Number.NaN,
      (a) => a.currencyCode,
      (amount, currency) => {
        const converted = convertOrUnknown(amount, currency);
        return converted === null ? null : Math.abs(converted);
      },
    );
    // Net worth inherits the incompleteness of both sides: a hole in either
    // makes the difference partial too.
    const totalBalance = combineTotals(
      [totalAssets, totalLiabilities],
      ([a, l]) => a - l,
    );

    return {
      totalBalance,
      totalAssets,
      totalLiabilities,
      accountCount: countLogicalAccounts(activeAccounts),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, brokerageMarketValues, portfolioFailed, convertToDefault]);

  return (
    <PageLayout>
      <main className="px-4 sm:px-6 lg:px-12 pt-6 pb-8">
        <PageHeader
          title={t('page.title')}
          subtitle={t('page.subtitle')}
          helpUrl="https://github.com/kenlasko/monize/wiki/Accounts"
          actions={
            <Button
              {...tourAnchor(TOUR_ANCHORS.accountsAddButton)}
              onClick={openCreate}
            >
              {t('page.newAccount')}
            </Button>
          }
        />
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 sm:gap-6 mb-4 sm:mb-6">
          <SummaryCard
            label={t('page.summary.totalActiveAccounts')}
            value={summary.accountCount}
            icon={SummaryIcons.accounts}
          />
          <SummaryCard
            label={t('page.summary.netWorth')}
            value={
              <PartialTotal total={summary.totalBalance} displayCurrency={defaultCurrency}>
                {formatCurrency(summary.totalBalance.value, defaultCurrency)}
              </PartialTotal>
            }
            icon={SummaryIcons.money}
            valueColor={summary.totalBalance.value >= 0 ? 'blue' : 'red'}
          />
          <SummaryCard
            label={t('page.summary.totalAssets')}
            value={
              <PartialTotal total={summary.totalAssets} displayCurrency={defaultCurrency}>
                {formatCurrency(summary.totalAssets.value, defaultCurrency)}
              </PartialTotal>
            }
            icon={SummaryIcons.checkmark}
            valueColor="green"
          />
          <SummaryCard
            label={t('page.summary.totalLiabilities')}
            value={
              <PartialTotal total={summary.totalLiabilities} displayCurrency={defaultCurrency}>
                {formatCurrency(summary.totalLiabilities.value, defaultCurrency)}
              </PartialTotal>
            }
            icon={SummaryIcons.cross}
            valueColor="red"
          />
        </div>

        {/* Form Modal */}
        <AccountFormModal formModal={formModal} onSaved={loadAccounts} />

        {/* Accounts List */}
        <div className="bg-white dark:bg-gray-800 shadow dark:shadow-gray-700/50 rounded-lg overflow-hidden">
          {isLoading ? (
            <LoadingSpinner text={t('page.loadingAccounts')} />
          ) : (
            <AccountList accounts={accounts} institutions={institutions} brokerageMarketValues={brokerageMarketValues} defaultCurrency={defaultCurrency} convertToDefault={convertToDefault} onEdit={openEdit} onRefresh={loadAccounts} />
          )}
        </div>
      </main>
    </PageLayout>
  );
}
