export interface CategorySpendingItem {
  categoryId: string | null;
  categoryName: string;
  color: string | null;
  /**
   * Spending in this category, in the response's `currency`. Rows that could
   * not be converted are in none of the figures, so when `missingCurrencies` is
   * non-empty this is the part that converted.
   */
  total: number;
}

export interface SpendingByCategoryResponse {
  /** Every net-spent category, largest first. The caller decides how many to draw. */
  data: CategorySpendingItem[];
  /**
   * Total spent, or `null` when a row could not be converted -- a missing rate
   * makes the total unknowable, never smaller. Render `knownSpending` through
   * `PartialTotal` in that case, never this under a caption saying "Total".
   */
  totalSpending: number | null;
  /** Sum of `data`; equals `totalSpending` when nothing was excluded. */
  knownSpending: number;
  /** Reporting currency every figure is expressed in. */
  currency: string;
  /** Source currencies with no rate into `currency`. Empty when complete. */
  missingCurrencies: string[];
  /** How many aggregate rows were left out, by any cause. */
  excludedCount: number;
}

/** Query parameters the Spending by Category report accepts beyond the window. */
export interface SpendingByCategoryParams extends ReportQueryParams {
  /** Restrict to these accounts; omit or leave empty for every account. */
  accountIds?: string[];
  /** Count a subcategory against its top-level ancestor. Defaults to true. */
  rollupToParent?: boolean;
}

export interface PayeeSpendingItem {
  payeeId: string | null;
  payeeName: string;
  total: number;
}

export interface SpendingByPayeeResponse {
  data: PayeeSpendingItem[];
  totalSpending: number;
}

export interface IncomeSourceItem {
  categoryId: string | null;
  categoryName: string;
  color: string | null;
  total: number;
}

export interface IncomeBySourceResponse {
  data: IncomeSourceItem[];
  totalIncome: number;
}

export interface MonthlyCategorySpending {
  categoryId: string | null;
  categoryName: string;
  color: string | null;
  total: number;
}

export interface MonthlySpendingItem {
  month: string;
  categories: MonthlyCategorySpending[];
  totalSpending: number;
}

export interface MonthlySpendingTrendResponse {
  data: MonthlySpendingItem[];
}

export interface MonthlyIncomeExpenseItem {
  month: string;
  income: number;
  expenses: number;
  net: number;
}

/** One bar of Income vs Expenses: a month or a week, with the dates it covers. */
export interface IncomeExpensePeriodItem {
  /** `YYYY-MM` for a month bucket, the week's first day for a week bucket. */
  period: string;
  /** First day the bar covers, inclusive. */
  periodStart: string;
  /** Last day the bar covers, inclusive. A drill-down uses the pair as-is. */
  periodEnd: string;
  /**
   * Money in over the period, in the response's `currency`. Rows that could not
   * be converted are in none of the figures, so when `missingCurrencies` is
   * non-empty this is the part that converted.
   */
  income: number;
  expenses: number;
  net: number;
}

/**
 * One bar of a tag-key bucket: the categorized figures plus the tagged
 * transfer flows that fell in the period (zero when none). The flows are never
 * part of `income`, `expenses` or `net`.
 */
export interface IncomeExpenseTagPeriodItem extends IncomeExpensePeriodItem {
  /** Tagged transfer legs in this period, positive side. */
  taggedInflows: number;
  /** Tagged transfer legs in this period, negative side, as a positive magnitude. */
  taggedOutflows: number;
}

export interface IncomeExpenseTotals {
  /**
   * Total over the window, or `null` when a row could not be converted -- a
   * missing rate makes the total unknowable, never smaller. Render the `known*`
   * figure through `PartialTotal` in that case.
   */
  income: number | null;
  expenses: number | null;
  net: number | null;
  /** The part that did convert; equals the field above when nothing was excluded. */
  knownIncome: number;
  knownExpenses: number;
  knownNet: number;
}

/**
 * The reserved id of the "untagged" value bucket
 * (`docs/specs/report-tag-key-breakdown.md` section 1.1, rule B2): rows
 * carrying no `K:*` tag for the requested key. Not a value a user can create --
 * render it from `reports.tagBreakdown.untagged`, never this id.
 */
export const UNTAGGED_TAG_BUCKET_ID = '__untagged__';

/**
 * One value bucket of a tag-key breakdown (Income vs Expenses / Cash Flow
 * only carry `taggedInflows`/`taggedOutflows`).
 *
 * `data`/`totals`/`missingCurrencies`/`excludedCount` are computed through the
 * exact same per-currency conversion and completeness path as the top-level
 * (All) figures: one bucket's missing rate never blanks another's.
 */
export interface IncomeExpenseTagBucket {
  /** The tag's value, or `UNTAGGED_TAG_BUCKET_ID` for the reserved bucket. */
  value: string;
  /** True only for the reserved untagged bucket. */
  isUntagged: boolean;
  data: IncomeExpenseTagPeriodItem[];
  totals: IncomeExpenseTotals;
  /**
   * Window total of the per-period `taggedInflows` in `data`. Transfer legs
   * carrying this bucket's value, positive side. Never folded
   * into `income`, `expenses` or `net` -- a transfer is never income.
   */
  taggedInflows: number;
  /** Transfer legs carrying this bucket's value, negative side, as a positive magnitude. */
  taggedOutflows: number;
  /**
   * Source currencies with no usable rate into the report's currency, across
   * both this bucket's categorized rows and its tagged transfer legs.
   */
  missingCurrencies: string[];
  /** How many aggregate rows this bucket left out, by any cause. */
  excludedCount: number;
}

export interface IncomeVsExpensesResponse {
  /** Every bucket in the window, in order, including the empty ones. */
  data: IncomeExpensePeriodItem[];
  totals: IncomeExpenseTotals;
  /** Reporting currency every figure is expressed in. */
  currency: string;
  /** Source currencies with no rate into `currency`. Empty when complete. */
  missingCurrencies: string[];
  /** How many aggregate rows were left out, by any cause. */
  excludedCount: number;
  /**
   * The tag key the caller asked to break the report down by. Present only
   * when the request carried `tagKey` (absent otherwise, never `null`).
   */
  tagKey?: string;
  /**
   * One bucket per discovered value of `tagKey`, plus the reserved untagged
   * bucket (`UNTAGGED_TAG_BUCKET_ID`). Present only when `tagKey` was
   * supplied; the fields above keep describing the unpartitioned (All)
   * figure, so a caller ignoring this field still renders today's report.
   */
  buckets?: IncomeExpenseTagBucket[];
}

/** Query parameters Income vs Expenses accepts beyond the window. */
export interface IncomeVsExpensesParams extends ReportQueryParams {
  /** Restrict to these accounts; omit or leave empty for every account. */
  accountIds?: string[];
  /** Width of one bar. Defaults to month. */
  bucket?: 'month' | 'week';
  /** Day a week bucket starts on, 0 = Sunday through 6 = Saturday. */
  weekStartsOn?: number;
  /**
   * Bare KEY of a `KEY:VALUE` tag (e.g. "scope") to break the report down by
   * (`docs/specs/report-tag-key-breakdown.md`). Absent renders today's
   * response unchanged.
   */
  tagKey?: string;
}

export interface ReportQueryParams {
  startDate?: string;
  endDate: string;
}

/** Query parameters the Cash Flow report accepts beyond the window. */
export interface CashFlowParams extends ReportQueryParams {
  /**
   * Bare KEY of a `KEY:VALUE` tag (e.g. "scope") to break the report down by
   * (`docs/specs/report-tag-key-breakdown.md`). Absent renders today's
   * response unchanged.
   */
  tagKey?: string;
}

// Monthly category breakdown types
export interface MonthlyBreakdownCategoryRow {
  categoryId: string | null;
  categoryName: string;
  parentId: string | null;
  parentName: string | null;
  parentIsIncome: boolean | null;
  isIncome: boolean;
  valuesByMonth: Record<string, number>;
  depositTotal: number;
  withdrawalTotal: number;
}

export interface MonthlyBreakdownTransferRow {
  accountId: string;
  accountName: string;
  direction: 'from' | 'to';
  valuesByMonth: Record<string, number>;
}

export interface MonthlyCategoryBreakdownResponse {
  months: string[];
  data: MonthlyBreakdownCategoryRow[];
  transfers: MonthlyBreakdownTransferRow[];
  currency: string;
}

// Year-over-year types
export interface YearMonthData {
  month: number;
  income: number;
  expenses: number;
  savings: number;
}

export interface YearData {
  year: number;
  months: YearMonthData[];
  totals: {
    income: number;
    expenses: number;
    savings: number;
  };
}

export interface YearOverYearResponse {
  data: YearData[];
}

// Weekend vs weekday types
export interface DaySpending {
  dayOfWeek: number;
  total: number;
  count: number;
}

export interface CategoryWeekendWeekday {
  categoryId: string | null;
  categoryName: string;
  weekendTotal: number;
  weekdayTotal: number;
}

export interface WeekendVsWeekdayResponse {
  summary: {
    weekendTotal: number;
    weekdayTotal: number;
    weekendCount: number;
    weekdayCount: number;
  };
  byDay: DaySpending[];
  byCategory: CategoryWeekendWeekday[];
}

// Spending anomalies types
export type AnomalyType = 'large_transaction' | 'category_spike' | 'unusual_payee';
export type AnomalySeverity = 'high' | 'medium' | 'low';

export interface SpendingAnomaly {
  type: AnomalyType;
  severity: AnomalySeverity;
  title: string;
  description: string;
  amount?: number;
  transactionId?: string;
  transactionDate?: string;
  payeeName?: string;
  categoryId?: string;
  categoryName?: string;
  currentPeriodAmount?: number;
  previousPeriodAmount?: number;
  percentChange?: number;
}

export interface SpendingAnomaliesResponse {
  statistics: {
    mean: number;
    stdDev: number;
  };
  anomalies: SpendingAnomaly[];
  counts: {
    high: number;
    medium: number;
    low: number;
  };
}

// Tax summary types
export interface CategoryTotal {
  name: string;
  total: number;
}

export interface TaxSummaryResponse {
  incomeBySource: CategoryTotal[];
  deductibleExpenses: CategoryTotal[];
  allExpenses: CategoryTotal[];
  totals: {
    income: number;
    expenses: number;
    deductible: number;
  };
}

// Recurring expenses types
export const RECURRING_EXPENSE_FREQUENCIES = [
  'WEEKLY',
  'BIWEEKLY',
  'MONTHLY',
  'OCCASIONAL',
  'IRREGULAR',
] as const;

export type RecurringExpenseFrequency = (typeof RECURRING_EXPENSE_FREQUENCIES)[number];

export interface RecurringExpenseItem {
  payeeName: string;
  payeeId: string | null;
  occurrences: number;
  totalAmount: number;
  averageAmount: number;
  lastTransactionDate: string;
  frequency: RecurringExpenseFrequency;
  categoryName: string | null;
}

export interface RecurringExpensesResponse {
  data: RecurringExpenseItem[];
  summary: {
    totalRecurring: number;
    monthlyEstimate: number;
    uniquePayees: number;
  };
}

// Bill payment history types
export interface BillPaymentItem {
  scheduledTransactionId: string;
  scheduledTransactionName: string;
  payeeName: string;
  totalPaid: number;
  paymentCount: number;
  averagePayment: number;
  lastPaymentDate: string | null;
}

export interface MonthlyBillTotal {
  /**
   * The month as structure (`YYYY-MM`), and the only form the server sends. It
   * used to ship a `label` beside this, formatted `en-US` on the server; a
   * month a person reads is rendered here instead, through their own date or
   * chart formatter.
   */
  month: string;
  total: number;
}

export interface BillPaymentHistoryResponse {
  billPayments: BillPaymentItem[];
  monthlyTotals: MonthlyBillTotal[];
  summary: {
    totalPaid: number;
    totalPayments: number;
    uniqueBills: number;
    monthlyAverage: number;
  };
}

// Uncategorized transactions types
export interface UncategorizedTransactionItem {
  id: string;
  transactionDate: string;
  amount: number;
  currencyCode: string;
  payeeName: string | null;
  description: string | null;
  accountName: string | null;
  accountId: string;
}

export interface UncategorizedTransactionsResponse {
  transactions: UncategorizedTransactionItem[];
  summary: {
    totalCount: number;
    expenseCount: number;
    expenseTotal: number;
    incomeCount: number;
    incomeTotal: number;
    currencyCode: string;
  };
}

// Duplicate transactions types
export interface DuplicateTransactionItem {
  id: string;
  transactionDate: string;
  amount: number;
  payeeName: string | null;
  description: string | null;
  accountName: string | null;
}

export interface DuplicateGroup {
  key: string;
  transactions: DuplicateTransactionItem[];
  reason: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface DuplicateTransactionsResponse {
  groups: DuplicateGroup[];
  summary: {
    totalGroups: number;
    highCount: number;
    mediumCount: number;
    lowCount: number;
    potentialSavings: number;
  };
}
