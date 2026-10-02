/**
 * Config contract for the report-derived dashboard widgets. Each configurable
 * widget owns a slice of the cross-device `dashboardWidgetConfig` preference,
 * keyed by its widget id. Defaults are stable module-level constants (required
 * by useWidgetConfig, which memoizes on the defaults reference).
 */

/** Range presets offered by the transaction-based spending/income widgets. */
export const SPENDING_RANGES = ['mtd', '1m', '3m', '6m', '1y', 'ytd'] as const;
/** Range presets for month-trend widgets. */
export const TREND_RANGES = ['6m', 'ytd', '1y', '2y'] as const;
/**
 * Range presets for the portfolio value widget. 1W and MTD are measured from
 * the prior close (`PRIOR_CLOSE_BASELINE_RANGES`), which the daily series this
 * widget draws supports; 1D is absent because a single session has no daily
 * points to draw, and only the intraday chart on the Investments page can show
 * it.
 */
export const PORTFOLIO_RANGES = [
  '1w',
  'mtd',
  '3m',
  '6m',
  'ytd',
  '1y',
  '2y',
  '5y',
  'all',
] as const;
/** Range presets for the weekend/weekday widget. */
export const WEEKEND_RANGES = ['1m', '3m', '6m', '1y'] as const;

/**
 * Identity overrides available on every configurable widget: a custom display
 * name replacing the built-in title, and an optional description shown in
 * smaller type under the title. Managed centrally by WidgetCard (keyed by the
 * same widget id as the rest of the widget's settings), so individual widgets
 * only opt in by passing their `widgetId`.
 */
export interface WidgetIdentityConfig {
  displayName?: string;
  description?: string;
}

/** Max lengths for the identity fields (backend caps config strings at 100). */
export const WIDGET_DISPLAY_NAME_MAX = 60;
export const WIDGET_DESCRIPTION_MAX = 100;

export interface RangeConfig {
  range: string;
}

export interface PortfolioValueConfig {
  range: string;
  accountIds: string[];
}

export interface IncomeBySourceConfig {
  range: string;
  chartType: 'pie' | 'bar';
}

export interface AccountsConfig {
  accountIds: string[];
}

/** Timeframe + accounts config for the transaction-based summary charts. */
export interface RangeAccountsConfig {
  range: string;
  accountIds: string[];
}

/**
 * Expenses by Category adds a rollup choice: with `topLevelOnly` a subcategory's
 * spend is counted against its top-level ancestor, so the chart answers "which
 * part of my budget" rather than listing every leaf.
 */
export interface ExpensesPieConfig extends RangeAccountsConfig {
  topLevelOnly: boolean;
}

/**
 * Security Type Allocation view. `type` places each holding by its own security
 * type, from the portfolio summary; `assetClass` asks the backend for the
 * look-through breakdown, which sees inside a fund rather than filing the whole
 * of it under ETF.
 */
export interface SecurityTypeAllocationConfig {
  accountIds: string[];
  view: 'type' | 'assetClass';
}

export interface GeographicConfig {
  accountIds: string[];
  view: 'region' | 'exchange' | 'country';
}

/**
 * Upcoming Bills settings.
 *
 * `scope` is which occurrences the widget lists: `dueSoon` keeps the reminder
 * window each schedule carries, `all` shows every active schedule's next
 * occurrence however far off it is. `view` picks the list or the month grid.
 */
export interface UpcomingBillsConfig {
  scope: 'dueSoon' | 'all';
  view: 'list' | 'calendar';
}

export interface RecurringConfig {
  minOccurrences: number;
}

export interface WeekendConfig {
  range: string;
  view: 'overview' | 'byDay';
}

export const PORTFOLIO_VALUE_DEFAULT: PortfolioValueConfig = {
  range: '1y',
  accountIds: [],
};

export const SPENDING_BY_PAYEE_DEFAULT: RangeConfig = { range: '3m' };

export const MONTHLY_SPENDING_TREND_DEFAULT: RangeConfig = { range: '1y' };

export const INCOME_BY_SOURCE_DEFAULT: IncomeBySourceConfig = {
  range: '1y',
  chartType: 'pie',
};

export const CREDIT_UTILIZATION_ACCOUNTS_DEFAULT: AccountsConfig = {
  accountIds: [],
};

export const CREDIT_UTILIZATION_TOTAL_DEFAULT: AccountsConfig = {
  accountIds: [],
};

export const SECTOR_WEIGHTINGS_DEFAULT: AccountsConfig = { accountIds: [] };

export const SECURITY_TYPE_ALLOCATION_DEFAULT: SecurityTypeAllocationConfig = {
  accountIds: [],
  view: 'type',
};

export const GEOGRAPHIC_ALLOCATION_DEFAULT: GeographicConfig = {
  accountIds: [],
  view: 'region',
};

// The historical behaviour: only what is overdue or inside its reminder window,
// as a list.
export const UPCOMING_BILLS_DEFAULT: UpcomingBillsConfig = {
  scope: 'dueSoon',
  view: 'list',
};

export const RECURRING_EXPENSES_DEFAULT: RecurringConfig = { minOccurrences: 3 };

export const WEEKEND_WEEKDAY_DEFAULT: WeekendConfig = {
  range: '3m',
  view: 'overview',
};

// The two default summary charts default to their historical windows: the pie
// showed the past 30 days, the income/expenses bars the recent weeks.
export const EXPENSES_PIE_DEFAULT: ExpensesPieConfig = {
  range: '1m',
  accountIds: [],
  topLevelOnly: false,
};

/**
 * The Cash Flow Sankey widget: the report's own settings. An empty
 * `accountIds` is the server's default cash-flow scope.
 */
export interface CashFlowSankeyConfig extends RangeAccountsConfig {
  depth: 1 | 2;
  view: 'sankey' | 'table';
}

export const CASH_FLOW_SANKEY_DEFAULT: CashFlowSankeyConfig = {
  range: 'mtd',
  accountIds: [],
  depth: 1,
  view: 'sankey',
};

export const INCOME_EXPENSES_DEFAULT: RangeAccountsConfig = {
  range: '1m',
  accountIds: [],
};
