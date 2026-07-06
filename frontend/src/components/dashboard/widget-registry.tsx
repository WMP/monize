'use client';

import type { ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { FavouriteAccounts } from '@/components/dashboard/FavouriteAccounts';
import { UpcomingBills } from '@/components/dashboard/UpcomingBills';
import { TopMovers } from '@/components/dashboard/TopMovers';
import { FavouriteSecurities } from '@/components/dashboard/FavouriteSecurities';
import { InsightsWidget } from '@/components/dashboard/InsightsWidget';
import { BudgetStatusWidget } from '@/components/dashboard/BudgetStatusWidget';
import { FavouriteReportsWidget } from '@/components/dashboard/FavouriteReportsWidget';
import { Account } from '@/types/account';
import { Transaction } from '@/types/transaction';
import { Category } from '@/types/category';
import { ScheduledTransaction } from '@/types/scheduled-transaction';
import { TopMover, FavouriteSecurityQuote } from '@/types/investment';
import { MonthlyNetWorth } from '@/types/net-worth';
import { DashboardWidgetPreference } from '@/types/auth';

const ExpensesPieChart = dynamic(
  () => import('@/components/dashboard/ExpensesPieChart').then((m) => m.ExpensesPieChart),
  {
    ssr: false,
    loading: () => (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-6 lg:min-h-[540px]" />
    ),
  },
);
const IncomeExpensesBarChart = dynamic(
  () => import('@/components/dashboard/IncomeExpensesBarChart').then((m) => m.IncomeExpensesBarChart),
  {
    ssr: false,
    loading: () => (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-3 sm:p-6 lg:min-h-[540px]" />
    ),
  },
);
const NetWorthChart = dynamic(
  () => import('@/components/dashboard/NetWorthChart').then((m) => m.NetWorthChart),
  {
    ssr: false,
    loading: () => (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-3 sm:p-6 lg:min-h-[500px]" />
    ),
  },
);
const AssetsVsLiabilities = dynamic(
  () => import('@/components/dashboard/AssetsVsLiabilities').then((m) => m.AssetsVsLiabilities),
  {
    ssr: false,
    loading: () => (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-3 sm:p-6 lg:min-h-[500px]" />
    ),
  },
);

/**
 * All centrally-loaded dashboard data and handlers. Each registry entry's
 * `render` receives this so the widget components stay prop-driven exactly as
 * they were in the old hardcoded grid.
 */
export interface DashboardWidgetContext {
  accounts: Account[];
  brokerageMarketValues: Map<string, number>;
  scheduledTransactions: ScheduledTransaction[];
  transactions: Transaction[];
  categories: Category[];
  topMovers: TopMover[];
  favouriteSecurities: FavouriteSecurityQuote[];
  netWorthData: MonthlyNetWorth[];
  hasSecurities: boolean;
  hasInvestments: boolean;
  isLoading: boolean;
  isRefreshing: boolean;
  onAccountsChanged: () => void;
  loadDashboardData: () => void;
  triggerManualRefresh: () => void;
}

export interface DashboardWidgetEntry {
  /** Stable kebab-case id persisted in preferences. */
  id: string;
  /** Order used when a widget is not present in the saved layout. */
  defaultOrder: number;
  /** i18n key (under the `dashboard` namespace) for the display name. */
  nameKey: string;
  /** Renders the widget from centrally-loaded data. */
  render: (ctx: DashboardWidgetContext) => ReactNode;
  /** Optional gate; when it returns false the widget is not rendered. */
  available?: (ctx: DashboardWidgetContext) => boolean;
}

/** Number of upcoming-bills rows to show, matching the legacy dashboard. */
function upcomingBillsMaxItems(accounts: Account[]): number {
  return accounts.filter((a) => a.isFavourite && !a.isClosed).length + 2;
}

export const DASHBOARD_WIDGETS: DashboardWidgetEntry[] = [
  {
    id: 'favourite-accounts',
    defaultOrder: 0,
    nameKey: 'widgetNames.favourite-accounts',
    render: (ctx) => (
      <FavouriteAccounts
        accounts={ctx.accounts}
        brokerageMarketValues={ctx.brokerageMarketValues}
        isLoading={ctx.isLoading}
        onAccountsChanged={ctx.loadDashboardData}
      />
    ),
  },
  {
    id: 'upcoming-bills',
    defaultOrder: 1,
    nameKey: 'widgetNames.upcoming-bills',
    render: (ctx) => (
      <UpcomingBills
        scheduledTransactions={ctx.scheduledTransactions}
        accounts={ctx.accounts}
        isLoading={ctx.isLoading}
        maxItems={upcomingBillsMaxItems(ctx.accounts)}
      />
    ),
  },
  {
    id: 'top-movers',
    defaultOrder: 2,
    nameKey: 'widgetNames.top-movers',
    available: (ctx) => ctx.hasSecurities,
    render: (ctx) => (
      <TopMovers
        movers={ctx.topMovers}
        isLoading={ctx.isLoading}
        hasInvestmentAccounts={ctx.hasInvestments}
        onRefresh={ctx.triggerManualRefresh}
        isRefreshing={ctx.isRefreshing}
      />
    ),
  },
  {
    id: 'favourite-securities',
    defaultOrder: 3,
    nameKey: 'widgetNames.favourite-securities',
    available: (ctx) => ctx.hasSecurities,
    render: (ctx) => (
      <FavouriteSecurities
        securities={ctx.favouriteSecurities}
        isLoading={ctx.isLoading}
        onRefresh={ctx.triggerManualRefresh}
        isRefreshing={ctx.isRefreshing}
      />
    ),
  },
  {
    id: 'net-worth',
    defaultOrder: 4,
    nameKey: 'widgetNames.net-worth',
    render: (ctx) => <NetWorthChart data={ctx.netWorthData} isLoading={ctx.isLoading} />,
  },
  {
    id: 'assets-vs-liabilities',
    defaultOrder: 5,
    nameKey: 'widgetNames.assets-vs-liabilities',
    render: (ctx) => <AssetsVsLiabilities data={ctx.netWorthData} isLoading={ctx.isLoading} />,
  },
  {
    id: 'expenses-pie',
    defaultOrder: 6,
    nameKey: 'widgetNames.expenses-pie',
    render: (ctx) => (
      <ExpensesPieChart
        transactions={ctx.transactions}
        categories={ctx.categories}
        isLoading={ctx.isLoading}
      />
    ),
  },
  {
    id: 'income-expenses',
    defaultOrder: 7,
    nameKey: 'widgetNames.income-expenses',
    render: (ctx) => (
      <IncomeExpensesBarChart transactions={ctx.transactions} isLoading={ctx.isLoading} />
    ),
  },
  {
    id: 'budget-status',
    defaultOrder: 8,
    nameKey: 'widgetNames.budget-status',
    render: (ctx) => <BudgetStatusWidget isLoading={ctx.isLoading} />,
  },
  {
    id: 'insights',
    defaultOrder: 9,
    nameKey: 'widgetNames.insights',
    render: (ctx) => <InsightsWidget isLoading={ctx.isLoading} />,
  },
  {
    id: 'favourite-reports',
    defaultOrder: 10,
    nameKey: 'widgetNames.favourite-reports',
    render: (ctx) => <FavouriteReportsWidget isLoading={ctx.isLoading} />,
  },
];

export interface ResolvedDashboardWidget {
  entry: DashboardWidgetEntry;
  visible: boolean;
}

/**
 * Resolve the effective dashboard layout:
 * - start from the saved layout (in saved order), dropping ids no longer in
 *   the registry and ignoring duplicates;
 * - append any registry widgets missing from the saved layout, in their
 *   default order, as visible (so widgets shipped in future releases show up).
 *
 * `available()` gating and hidden filtering are applied by the caller so the
 * full list (including hidden widgets) is still available for edit mode.
 */
export function resolveDashboardLayout(
  saved: DashboardWidgetPreference[] | undefined | null,
  registry: DashboardWidgetEntry[] = DASHBOARD_WIDGETS,
): ResolvedDashboardWidget[] {
  const byId = new Map(registry.map((entry) => [entry.id, entry]));
  const seen = new Set<string>();
  const resolved: ResolvedDashboardWidget[] = [];

  for (const item of saved ?? []) {
    const entry = byId.get(item.id);
    if (!entry || seen.has(item.id)) continue;
    seen.add(item.id);
    resolved.push({ entry, visible: item.visible });
  }

  const missing = registry
    .filter((entry) => !seen.has(entry.id))
    .sort((a, b) => a.defaultOrder - b.defaultOrder);
  for (const entry of missing) {
    resolved.push({ entry, visible: true });
  }

  return resolved;
}
