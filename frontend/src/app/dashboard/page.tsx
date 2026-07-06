'use client';

import { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import { subMonths, subWeeks, startOfWeek, format } from 'date-fns';
import { useOnUndoRedo } from '@/hooks/useOnUndoRedo';
import { useOnAiAction } from '@/hooks/useOnAiAction';
import { useTranslations } from 'next-intl';
import { useAuthStore } from '@/store/authStore';
import { usePreferencesStore } from '@/store/preferencesStore';
import { FavouriteAccounts } from '@/components/dashboard/FavouriteAccounts';
import { UpcomingBills } from '@/components/dashboard/UpcomingBills';
import { GettingStarted } from '@/components/dashboard/GettingStarted';
import { DashboardEditor } from '@/components/dashboard/DashboardEditor';
import {
  resolveDashboardLayout,
  type DashboardWidgetContext,
} from '@/components/dashboard/widget-registry';
import { userSettingsApi } from '@/lib/user-settings';
import { DashboardWidgetPreference } from '@/types/auth';
import { accountsApi } from '@/lib/accounts';
import { transactionsApi } from '@/lib/transactions';
import { categoriesApi } from '@/lib/categories';
import { scheduledTransactionsApi } from '@/lib/scheduled-transactions';
import { investmentsApi } from '@/lib/investments';
import { netWorthApi } from '@/lib/net-worth';
import { invalidateCache } from '@/lib/apiCache';
import { Account } from '@/types/account';
import { Transaction } from '@/types/transaction';
import { Category } from '@/types/category';
import { ScheduledTransaction } from '@/types/scheduled-transaction';
import { TopMover, PortfolioSummary, FavouriteSecurityQuote } from '@/types/investment';
import { MonthlyNetWorth } from '@/types/net-worth';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { usePriceRefresh } from '@/hooks/usePriceRefresh';
import { createLogger } from '@/lib/logger';

const logger = createLogger('Dashboard');

export default function DashboardPage() {
  return (
    <ProtectedRoute>
      <DashboardContent />
    </ProtectedRoute>
  );
}

function DashboardContent() {
  const t = useTranslations('dashboard');
  const user = useAuthStore((s) => s.user);
  const actingAsUserId = useAuthStore((s) => s.actingAsUserId);
  const isDelegateView = !!actingAsUserId;
  const delegateSections = useAuthStore((s) => s.delegateSections);
  const delegateBills = !!delegateSections?.bills;
  // The acting-as context is rehydrated from localStorage; running the
  // owner-only data load before that completes would spuriously 403 a
  // delegate on the owner endpoints (and then re-run with the right
  // path), so wait until the store has hydrated before firing.
  const authHydrated = useAuthStore((s) => s._hasHydrated);
  const weekStartsOn = (usePreferencesStore((s) => s.preferences?.weekStartsOn) ?? 1) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
  const savedDashboardWidgets = usePreferencesStore((s) => s.preferences?.dashboardWidgets);
  const updateStorePreferences = usePreferencesStore((s) => s.updatePreferences);

  // Dashboard edit mode. `draft` holds the working layout while editing; it is
  // seeded from the saved layout in the "Edit dashboard" click handler (not an
  // effect) so we never call setState from useEffect.
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<DashboardWidgetPreference[]>([]);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [scheduledTransactions, setScheduledTransactions] = useState<ScheduledTransaction[]>([]);
  const [topMovers, setTopMovers] = useState<TopMover[]>([]);
  const [portfolioSummary, setPortfolioSummary] = useState<PortfolioSummary | null>(null);
  const [hasInvestments, setHasInvestments] = useState(false);
  const [netWorthData, setNetWorthData] = useState<MonthlyNetWorth[]>([]);
  const [favouriteSecurities, setFavouriteSecurities] = useState<FavouriteSecurityQuote[]>([]);
  const [hasSecurities, setHasSecurities] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const brokerageMarketValues = useMemo(() => {
    const map = new Map<string, number>();
    if (!portfolioSummary) return map;
    for (const accountHoldings of portfolioSummary.holdingsByAccount) {
      map.set(accountHoldings.accountId, accountHoldings.totalMarketValue);
    }
    return map;
  }, [portfolioSummary]);

  const reloadInvestmentWidgets = useCallback(async () => {
    // Favourite securities can exist without investment accounts, so always
    // refresh them; top movers only apply when there are holdings.
    invalidateCache('investments:favouriteSecurities');
    const favouritesPromise = investmentsApi
      .getFavouriteSecurities()
      .then(setFavouriteSecurities)
      .catch(() => {});
    if (hasInvestments) {
      try {
        const [moversData, portfolio] = await Promise.all([
          investmentsApi.getTopMovers(),
          investmentsApi.getPortfolioSummary().catch(() => null),
        ]);
        setTopMovers(moversData);
        setPortfolioSummary(portfolio);
      } catch {
        // Silently fail
      }
    }
    await favouritesPromise;
  }, [hasInvestments]);

  const { isRefreshing, triggerManualRefresh, triggerAutoRefresh } = usePriceRefresh({
    onRefreshComplete: reloadInvestmentWidgets,
  });

  const loadDashboardData = useCallback(async () => {
    if (!authHydrated) return;
    setIsLoading(true);
    try {
      // Phase 1: a delegate only sees the Favourite Accounts widget, and the
      // other dashboard endpoints are not delegate-accessible. Load just the
      // (server-filtered) accounts and stop.
      if (isDelegateView) {
        const delegateAccounts = await accountsApi.getAll();
        setAccounts(delegateAccounts);
        // 3C: when the owner granted the Bills & Deposits section, the
        // scheduled endpoint is delegate-reachable (server-filtered to the
        // delegate's readable accounts) so the widget can render.
        if (delegateBills) {
          try {
            const sched = await scheduledTransactionsApi.getAll();
            setScheduledTransactions(sched);
          } catch (error) {
            logger.error('Failed to load delegate scheduled data:', error);
          }
        }
        setIsLoading(false);
        return;
      }

      const now = new Date();
      const currentWeekStart = startOfWeek(now, { weekStartsOn });
      const fiveWeeksAgoStart = subWeeks(currentWeekStart, 4);
      const chartStartDate = format(fiveWeeksAgoStart, 'yyyy-MM-dd');
      const today = format(now, 'yyyy-MM-dd');

      const twelveMonthsAgo = format(subMonths(new Date(), 12), 'yyyy-MM-dd');

      const [accountsData, allTransactions, categoriesData, scheduledData, netWorth, favouriteSecs, securitiesList] = await Promise.all([
        accountsApi.getAll(),
        transactionsApi.getAllPages({ startDate: chartStartDate, endDate: today }),
        categoriesApi.getAll(),
        scheduledTransactionsApi.getAll(),
        netWorthApi.getMonthly({ startDate: twelveMonthsAgo, endDate: today }).catch(() => [] as MonthlyNetWorth[]),
        investmentsApi.getFavouriteSecurities().catch(() => [] as FavouriteSecurityQuote[]),
        investmentsApi.getSecurities().catch(() => []),
      ]);

      setAccounts(accountsData);
      setTransactions(allTransactions);
      setCategories(categoriesData);
      setScheduledTransactions(scheduledData);
      setNetWorthData(netWorth);
      setFavouriteSecurities(favouriteSecs);
      setHasSecurities(securitiesList.length > 0);

      const investmentAccounts = accountsData.filter(
        (a: Account) => a.accountType === 'INVESTMENT' && !a.isClosed,
      );
      const hasInvestmentAccounts = investmentAccounts.length > 0;
      setHasInvestments(hasInvestmentAccounts);

      // Load investment data directly so it appears even when price refresh is
      // skipped (outside market hours, cooldown active, etc.)
      if (hasInvestmentAccounts) {
        Promise.all([
          investmentsApi.getTopMovers().catch(() => [] as TopMover[]),
          investmentsApi.getPortfolioSummary().catch(() => null),
        ]).then(([moversData, portfolio]) => {
          setTopMovers(moversData);
          setPortfolioSummary(portfolio);
        });
      }
    } catch (error) {
      logger.error('Failed to load dashboard data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [authHydrated, weekStartsOn, isDelegateView, delegateBills]);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  useOnUndoRedo(loadDashboardData);
  // An AI write (e.g. a transaction created from the chat bubble) changes the
  // dashboard's totals and recent activity, so refresh the same way.
  useOnAiAction(loadDashboardData);

  useEffect(() => {
    if (hasInvestments && !isLoading) {
      triggerAutoRefresh();
    }
  }, [hasInvestments, isLoading, triggerAutoRefresh]);

  // Everything a registry widget needs to render, assembled from the centrally
  // loaded data and handlers above.
  const widgetContext: DashboardWidgetContext = useMemo(
    () => ({
      accounts,
      brokerageMarketValues,
      scheduledTransactions,
      transactions,
      categories,
      topMovers,
      favouriteSecurities,
      netWorthData,
      hasSecurities,
      hasInvestments,
      isLoading,
      isRefreshing,
      onAccountsChanged: loadDashboardData,
      loadDashboardData,
      triggerManualRefresh,
    }),
    [
      accounts,
      brokerageMarketValues,
      scheduledTransactions,
      transactions,
      categories,
      topMovers,
      favouriteSecurities,
      netWorthData,
      hasSecurities,
      hasInvestments,
      isLoading,
      isRefreshing,
      loadDashboardData,
      triggerManualRefresh,
    ],
  );

  // Effective layout for normal (non-edit) rendering: resolved from the saved
  // preference, then narrowed to visible + available widgets.
  const visibleWidgets = useMemo(
    () =>
      resolveDashboardLayout(savedDashboardWidgets).filter(
        ({ entry, visible }) =>
          visible && (entry.available ? entry.available(widgetContext) : true),
      ),
    [savedDashboardWidgets, widgetContext],
  );

  const startEditing = () => {
    setDraft(
      resolveDashboardLayout(savedDashboardWidgets).map(({ entry, visible }) => ({
        id: entry.id,
        visible,
      })),
    );
    setIsEditing(true);
  };

  const finishEditing = () => {
    const layout = resolveDashboardLayout(draft).map(({ entry, visible }) => ({
      id: entry.id,
      visible,
    }));
    updateStorePreferences({ dashboardWidgets: layout });
    userSettingsApi
      .updatePreferences({ dashboardWidgets: layout })
      .then((saved) => updateStorePreferences({ dashboardWidgets: saved.dashboardWidgets }))
      .catch((error) => logger.error('Failed to save dashboard layout:', error));
    setIsEditing(false);
  };

  const toggleWidget = (id: string) => {
    setDraft((current) =>
      current.map((w) => (w.id === id ? { ...w, visible: !w.visible } : w)),
    );
  };

  const moveWidget = (id: string, direction: 'up' | 'down') => {
    setDraft((current) => {
      const index = current.findIndex((w) => w.id === id);
      if (index === -1) return current;
      const target = direction === 'up' ? index - 1 : index + 1;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const reorderWidget = (fromId: string, toId: string) => {
    setDraft((current) => {
      const fromIndex = current.findIndex((w) => w.id === fromId);
      const toIndex = current.findIndex((w) => w.id === toId);
      if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return current;
      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  return (
    <PageLayout>
      <main className="px-4 sm:px-6 lg:px-12 pt-6 pb-8">
        <div className="sm:px-0">
          {/* Welcome section */}
          <PageHeader
            title={user?.firstName ? t('page.welcomeWithName', { name: user.firstName }) : `${t('page.welcomePrefix')}!`}
            subtitle={t('page.subtitle')}
            helpUrl="https://github.com/kenlasko/monize/wiki/Dashboard"
          />

          {isDelegateView ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              <FavouriteAccounts
                accounts={accounts}
                brokerageMarketValues={brokerageMarketValues}
                isLoading={isLoading}
                onAccountsChanged={loadDashboardData}
              />
              {delegateBills && (
                <UpcomingBills
                  scheduledTransactions={scheduledTransactions}
                  accounts={accounts}
                  isLoading={isLoading}
                  maxItems={
                    accounts.filter((a) => a.isFavourite && !a.isClosed)
                      .length + 2
                  }
                />
              )}
            </div>
          ) : (
            <>
              <GettingStarted />

              <div className="flex justify-end mb-4">
                <button
                  type="button"
                  onClick={isEditing ? finishEditing : startEditing}
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                >
                  {isEditing ? (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  )}
                  {isEditing ? t('edit.done') : t('edit.editDashboard')}
                </button>
              </div>

              {isEditing ? (
                <DashboardEditor
                  items={resolveDashboardLayout(draft)}
                  onToggle={toggleWidget}
                  onMove={moveWidget}
                  onReorder={reorderWidget}
                />
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {visibleWidgets.map(({ entry }) => (
                    <Fragment key={entry.id}>{entry.render(widgetContext)}</Fragment>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </PageLayout>
  );
}
