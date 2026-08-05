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
import { subtractKnown } from '@/lib/partial-sum';
import { useMoneyDisplay } from '@/hooks/useMoneyDisplay';
import { investmentsApi } from '@/lib/investments';
import { institutionsApi } from '@/lib/institutions';
import { countLogicalAccounts } from '@/lib/account-utils';
import { Account } from '@/types/account';
import { Institution } from '@/types/institution';
import { PortfolioSummary } from '@/types/investment';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { SummaryCard, SummaryIcons } from '@/components/ui/SummaryCard';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useFormModal } from '@/hooks/useFormModal';
import { useExchangeRates } from '@/hooks/useExchangeRates';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { createLogger } from '@/lib/logger';
import { showErrorToast } from '@/lib/errors';
import {
  brokerageMarketValue,
  buildBrokerageMarketValues,
} from '@/lib/brokerage-market-value';

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
  const [isLoading, setIsLoading] = useState(true);
  const formModal = useFormModal<Account>();
  const { openCreate, openEdit } = formModal;
  const { convertToDefault, defaultCurrency } = useExchangeRates();
  const { formatCurrencyOrNa } = useMoneyDisplay();

  const loadAccounts = useCallback(async () => {
    setIsLoading(true);
    try {
      const [data, portfolio, insts] = await Promise.all([
        accountsApi.getAll(true),
        investmentsApi.getPortfolioSummary().catch(() => null),
        institutionsApi.getAll().catch(() => [] as Institution[]),
      ]);
      setAccounts(data);
      setPortfolioSummary(portfolio);
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

  // Brokerage account id -> market value of its holdings, `null` when unknown.
  // Cash sits in the linked INVESTMENT_CASH account, so counting it here would
  // double it in the net-worth summary.
  const brokerageMarketValues = useMemo(
    () => buildBrokerageMarketValues(accounts, portfolioSummary),
    [accounts, portfolioSummary],
  );

  const calculateSummary = () => {
    const activeAccounts = accounts.filter((a) => !a.isClosed);
    const liabilityTypes = ['CREDIT_CARD', 'LOAN', 'MORTGAGE', 'LINE_OF_CREDIT'];
    let totalAssets = 0;
    let totalLiabilities = 0;
    let assetsKnown = true;
    let liabilitiesKnown = true;

    activeAccounts.forEach((a) => {
      // For brokerage accounts, use portfolio market value instead of currentBalance
      // For other accounts, include future-dated transactions in the balance
      const rawBalance = a.accountSubType === 'INVESTMENT_BROKERAGE'
        ? brokerageMarketValue(brokerageMarketValues, a.id)
        : (Number(a.currentBalance) || 0) + (Number(a.futureTransactionsSum) || 0);
      // A brokerage account whose market value is unknown -- a missing quote, a
      // missing rate, or a portfolio request that failed -- makes the total
      // unknown. `?? 0` here reported `500.00` as a complete Total Assets for a
      // user who also held ten shares with no quote.
      if (rawBalance === null) {
        if (liabilityTypes.includes(a.accountType)) liabilitiesKnown = false;
        else assetsKnown = false;
        return;
      }
      // Convert to default currency for accurate aggregation. An account whose
      // currency has no rate makes the affected total unknown -- adding only the
      // convertible ones would put a subtotal under a "Total Assets" label.
      const effectiveBalance = convertToDefault(rawBalance, a.currencyCode);
      if (effectiveBalance === null) {
        if (liabilityTypes.includes(a.accountType)) liabilitiesKnown = false;
        else assetsKnown = false;
        return;
      }

      if (liabilityTypes.includes(a.accountType)) {
        totalLiabilities += Math.abs(effectiveBalance);
      } else {
        totalAssets += effectiveBalance;
      }
    });

    const accountCount = countLogicalAccounts(activeAccounts);
    const assets = assetsKnown ? totalAssets : null;
    const liabilities = liabilitiesKnown ? totalLiabilities : null;
    return {
      totalBalance: subtractKnown(assets, liabilities),
      totalAssets: assets,
      totalLiabilities: liabilities,
      accountCount,
    };
  };

  const summary = calculateSummary();

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
            value={formatCurrencyOrNa(summary.totalBalance, defaultCurrency)}
            icon={SummaryIcons.money}
            valueColor={(summary.totalBalance ?? 0) >= 0 ? 'blue' : 'red'}
          />
          <SummaryCard
            label={t('page.summary.totalAssets')}
            value={formatCurrencyOrNa(summary.totalAssets, defaultCurrency)}
            icon={SummaryIcons.checkmark}
            valueColor="green"
          />
          <SummaryCard
            label={t('page.summary.totalLiabilities')}
            value={formatCurrencyOrNa(summary.totalLiabilities, defaultCurrency)}
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
