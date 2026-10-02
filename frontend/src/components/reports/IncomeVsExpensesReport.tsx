"use client";

import { useState, useMemo, useRef } from "react";
import { CAPTION_CLASS, CellLabel, PHONE_HEADER_CLASS } from "@/components/ui/Table";
import type {
  SortColumn as TableSortColumn,
  SortColumnsByField as TableSortColumnsByField,
} from '@/components/ui/Table';
import { INTERACTIVE_ROW_FOCUS_CLASS, activateOnKey } from '@/components/ui/interactive-row';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { useRouter } from "next/navigation";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from "recharts";
import { parseISO } from "date-fns";
import { builtInReportsApi } from "@/lib/built-in-reports";
import { IncomeExpensePeriodItem } from "@/types/built-in-reports";
import type { Account } from "@/types/account";
import { accountsApi } from "@/lib/accounts";
import { usePersistedAccountFilter } from "@/hooks/usePersistedAccountFilter";
import { ReportAccountMultiSelect } from "@/components/reports/ReportAccountMultiSelect";
import { useNumberFormat } from "@/hooks/useNumberFormat";
import { useDateRange } from "@/hooks/useDateRange";
import { useReportData } from "@/hooks/useReportData";
import { useSortableTable, compareValues } from "@/hooks/useSortableTable";
import { DateRangeSelector } from "@/components/ui/DateRangeSelector";
import { ChartViewToggle } from "@/components/ui/ChartViewToggle";
import { ReportToolbarActions } from '@/components/reports/ReportToolbarActions';
import { SortableHeader } from '@/components/ui/SortableHeader';
import { ChartTooltip } from "@/components/reports/ChartTooltip";
import { ReportError } from "@/components/reports/ReportError";
import { exportToCsv } from "@/lib/csv-export";
import { chartColors } from "@/lib/chart-colors";
import { useChartDateFormat } from "@/hooks/useChartDateFormat";
import { useTranslations } from 'next-intl';
import { useExchangeRates } from "@/hooks/useExchangeRates";
import { PartialTotal } from "@/components/ui/PartialTotal";
import { useTagKeys } from "@/hooks/useTagKeys";
import { TagKeyBreakdownSelect } from "@/components/reports/TagKeyBreakdownSelect";
import { TagKeyBreakdownBuckets } from "@/components/reports/TagKeyBreakdownBuckets";
type IncomeVsExpensesSortField =
  | 'name'
  | 'income'
  | 'expenses'
  | 'savings'
  | 'savingsRate'
  | 'taggedInflows'
  | 'taggedOutflows';

const ACCOUNTS_STORAGE_KEY = 'monize-reports-income-vs-expenses-accounts';

// Same account list the dashboard's Income vs Expenses widget offers: an
// investment account's cash legs are excluded from the report by linkage.
const nonInvestmentAccounts = (a: Account) => a.accountType !== 'INVESTMENT';

/** The two columns that exist only while a tagged-flow series is shown. */
const isFlowField = (field: IncomeVsExpensesSortField) =>
  field === 'taggedInflows' || field === 'taggedOutflows';

/**
 * One sortable column of the table view. The five are declared once and
 * rendered by BOTH header rows -- the column header row (from `sm` up) and the
 * phone sort strip -- so the two can never list different fields.
 */
type SortColumn = TableSortColumn<IncomeVsExpensesSortField, 'right'>;

const HEADER_CLASS =
  'px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase';

// A money cell inside a wrapped card: no padding of its own below `sm` (the row
// supplies it and the grid does the spacing), the table cell's own padding from
// `sm` up. Smaller type on phones so a six-figure amount still fits a
// half-width column, and `whitespace-nowrap` so a locale that groups thousands
// with a space cannot break in the middle of a number.
//
// The tracks are sized so a compact six-figure amount fits at 320px and a
// seven-figure one at 390px (measured on a hand-CSS replica in Chromium).
// Right alignment is not a containment device: a nowrap amount longer than its
// track overflows past the END edge whatever `text-align` says, and in the
// right-hand track that does reopen the wrapper's sideways scroll (measured:
// a sixteen-character amount at 320px). That is the deliberate choice --
// `overflow-hidden` here would silently truncate a figure, and a scroll that
// appears only for an amount that large is honest.
const MONEY_CELL =
  'p-0 text-right text-xs whitespace-nowrap sm:table-cell sm:px-4 sm:py-3 sm:text-sm';

interface ChartDataItem {
  name: string;
  fullName: string;
  Income: number;
  Expenses: number;
  Savings: number;
  SavingsRate: number;
  /** Tagged transfer flows of the active bucket; absent when no flow series is shown. */
  TaggedInflows?: number;
  TaggedOutflows?: number;
  monthStart: string;
  monthEnd: string;
}

export function IncomeVsExpensesReport() {
  const t = useTranslations('reports');
  const formatChartDate = useChartDateFormat();
  const router = useRouter();
  const chartRef = useRef<HTMLDivElement>(null);
  const { formatCurrencyCompact: formatCurrency, formatCurrencyAxis, formatPercent, formatPercentTrimmed } =
    useNumberFormat();
  const { defaultCurrency } = useExchangeRates();
  const [viewType, setViewType] = useState<'bar' | 'table'>('bar');
  const tagKeys = useTagKeys();
  const [tagKey, setTagKey] = useState('');
  // Which tag-key bucket is selected. Owned here so the main chart can follow
  // the tab; TagKeyBreakdownBuckets is controlled by it.
  const [activeBucketValue, setActiveBucketValue] = useState('');
  const {
    dateRange,
    setDateRange,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    resolvedRange,
    isValid,
  } = useDateRange({ defaultRange: "1y", alignment: "month" });
  const { sortField, sortDirection, handleSort } = useSortableTable<IncomeVsExpensesSortField>(
    'reports.income-vs-expenses.table.sort',
    { field: 'name', direction: 'asc' },
  );

  const { start: rangeStart, end: rangeEnd } = resolvedRange;

  const { data: accountsData } = useReportData(() => accountsApi.getAll(), []);
  const offeredAccounts = useMemo(
    () => (accountsData ?? []).filter(nonInvestmentAccounts),
    [accountsData],
  );
  // Persisted so the report opens on the accounts the user last chose; empty
  // means every account, which is the report as it always was.
  const [selectedAccountIds, setSelectedAccountIds] = usePersistedAccountFilter(
    ACCOUNTS_STORAGE_KEY,
    offeredAccounts,
  );
  const accountIdsKey = selectedAccountIds.join(',');

  const { data: response, isLoading, error, reload } = useReportData(
    () =>
      isValid
        ? builtInReportsApi.getIncomeVsExpenses({
            startDate: rangeStart || undefined,
            endDate: rangeEnd,
            ...(selectedAccountIds.length > 0 ? { accountIds: selectedAccountIds } : {}),
            ...(tagKey ? { tagKey } : {}),
          })
        : Promise.resolve(null),
    [isValid, rangeStart, rangeEnd, tagKey, accountIdsKey],
  );

  // The bucket the breakdown card shows, and so the one whose tagged flows the
  // main chart draws. The card falls back to the first bucket for a value it
  // does not have; this does the same so the two cannot disagree. The untagged
  // bucket has no flows (an untagged transfer appears nowhere), so it adds no
  // series.
  const activeBucket = useMemo(
    () =>
      response?.tagKey && response.buckets
        ? (response.buckets.find((b) => b.value === activeBucketValue) ?? response.buckets[0])
        : undefined,
    [response, activeBucketValue],
  );
  const flowBucket = activeBucket && !activeBucket.isUntagged ? activeBucket : undefined;
  const showFlows = flowBucket !== undefined;

  // Map response to chart data. `name` must be unique across the dataset
  // (used as the XAxis category key); a non-unique value like "May" causes
  // Recharts to resolve the tooltip's payload to the first matching row,
  // showing data from the wrong year on multi-year ranges.
  const chartData = useMemo<ChartDataItem[]>(
    () =>
      (response?.data ?? []).map((item: IncomeExpensePeriodItem) => {
        const savings = item.income - item.expenses;
        const savingsRate =
          item.income > 0 ? Math.round((savings / item.income) * 100) : 0;
        // Flows ride beside the bars and never enter income, expenses or the
        // savings above (INV-REPORT-003). A period the bucket has no row for
        // had no tagged transfer in it, which is a known zero.
        const flows = flowBucket?.data.find((d) => d.period === item.period);
        return {
          name: item.period,
          fullName: formatChartDate(parseISO(item.periodStart), "MMM yyyy"),
          Income: Math.round(item.income),
          Expenses: Math.round(item.expenses),
          Savings: Math.round(savings),
          SavingsRate: savingsRate,
          ...(flowBucket
            ? {
                TaggedInflows: Math.round(flows ? flows.taggedInflows : 0),
                TaggedOutflows: Math.round(flows ? flows.taggedOutflows : 0),
              }
            : {}),
          // The dates the bar covers come from the server, which decided the
          // bucket; deriving them again here is a second definition of it.
          monthStart: item.periodStart,
          monthEnd: item.periodEnd,
        };
      }),
    [response, formatChartDate, flowBucket],
  );

  /**
   * The window's figures, and whether they are the whole story.
   *
   * The server withholds each total when a row could not be converted and sends
   * the part that did convert beside it, so what is shown is the subtotal and
   * the marker says so. Sharing one `ConvertedTotal` across all four keeps them
   * from disagreeing about their own completeness.
   */
  const totals = useMemo(() => {
    const totalIncome = response?.totals.knownIncome ?? 0;
    const totalExpenses = response?.totals.knownExpenses ?? 0;
    const totalSavings = totalIncome - totalExpenses;
    const savingsRate = totalIncome > 0 ? (totalSavings / totalIncome) * 100 : 0;
    return { totalIncome, totalExpenses, totalSavings, savingsRate };
  }, [response]);

  const completeness = useMemo(
    () => ({
      missingCurrencies: response?.missingCurrencies ?? [],
      excludedCount: response?.excludedCount ?? 0,
    }),
    [response],
  );
  const reportingCurrency = response?.currency ?? defaultCurrency;

  // A stored sort on a flow column falls back to the month when that column is
  // not on the screen.
  const effectiveSortField = !showFlows && isFlowField(sortField) ? 'name' : sortField;

  const sortedTableData = useMemo(() => {
    const sorted = [...chartData];
    sorted.sort((a, b) => {
      let comparison = 0;
      switch (effectiveSortField) {
        case 'name':
          comparison = compareValues(a.name, b.name);
          break;
        case 'income':
          comparison = compareValues(a.Income, b.Income);
          break;
        case 'expenses':
          comparison = compareValues(a.Expenses, b.Expenses);
          break;
        case 'savings':
          comparison = compareValues(a.Savings, b.Savings);
          break;
        case 'savingsRate':
          comparison = compareValues(a.SavingsRate, b.SavingsRate);
          break;
        case 'taggedInflows':
          comparison = compareValues(a.TaggedInflows, b.TaggedInflows);
          break;
        case 'taggedOutflows':
          comparison = compareValues(a.TaggedOutflows, b.TaggedOutflows);
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    return sorted;
  }, [chartData, effectiveSortField, sortDirection]);

  // Exhaustive over the sort field union, so a new field is a compile error
  // rather than a column with no control in either header. The list both
  // header rows render is DERIVED from the record, never re-listed beside it:
  // a hand-written list next to an exhaustive record is not exhaustive. The
  // record's declaration order is the column order.
  // The key is tied to the entry's own `field`, which a plain
  // `Record<IncomeVsExpensesSortField, SortColumn>` does not do: that forces an
  // entry to EXIST for every member of the union but lets it name a different
  // one, so `savingsRate: { field: 'savings', ... }` would type-check. Both
  // header rows would then render two controls keyed `savings` (a duplicate
  // React key), tapping "Savings Rate" would sort by Savings, and "Savings
  // Rate" would be unsortable -- none of which a test comparing header LABELS
  // can see, because the labels stay right. Here it is a compile error.
  const columns: TableSortColumnsByField<IncomeVsExpensesSortField, SortColumn> = {
    name: { field: 'name', label: t('incomeVsExpenses.colMonth') },
    income: { field: 'income', label: t('incomeVsExpenses.colIncome'), align: 'right' },
    expenses: { field: 'expenses', label: t('incomeVsExpenses.colExpenses'), align: 'right' },
    savings: { field: 'savings', label: t('incomeVsExpenses.colSavings'), align: 'right' },
    savingsRate: { field: 'savingsRate', label: t('incomeVsExpenses.colSavingsRate'), align: 'right' },
    taggedInflows: { field: 'taggedInflows', label: t('tagBreakdown.inflows'), align: 'right' },
    taggedOutflows: { field: 'taggedOutflows', label: t('tagBreakdown.outflows'), align: 'right' },
  };
  const sortColumns: readonly SortColumn[] = Object.values(columns).filter(
    (col) => showFlows || !isFlowField(col.field),
  );

  // The row's primary action, named once so the pointer and the keyboard cannot
  // come to run two slightly different pushes.
  const openMonth = (row: ChartDataItem) =>
    router.push(`/transactions?startDate=${row.monthStart}&endDate=${row.monthEnd}`);

  const handleExportPdf = async () => {
    const { exportToPdf } = await import("@/lib/pdf-export");
    await exportToPdf({
      title: t('page.names.income-vs-expenses' as Parameters<typeof t>[0]),
      summaryCards: [
        { label: t('incomeVsExpenses.totalIncome'), value: formatCurrency(totals.totalIncome), color: "#16a34a" },
        { label: t('incomeVsExpenses.totalExpenses'), value: formatCurrency(totals.totalExpenses), color: "#dc2626" },
        { label: t('incomeVsExpenses.totalSavings'), value: formatCurrency(totals.totalSavings), color: totals.totalSavings >= 0 ? "#2563eb" : "#ea580c" },
        { label: t('incomeVsExpenses.savingsRate'), value: formatPercent(totals.savingsRate, 1), color: totals.savingsRate >= 0 ? "#9333ea" : "#ea580c" },
      ],
      chartContainer: chartRef.current,
      filename: "income-vs-expenses",
    });
  };

  const handleExportCsv = () => {
    const headers = [t('incomeVsExpenses.colMonth'), t('incomeVsExpenses.colIncome'), t('incomeVsExpenses.colExpenses'), t('incomeVsExpenses.colSavings'), t('incomeVsExpenses.colSavingsRate'), ...(showFlows ? [t('tagBreakdown.inflows'), t('tagBreakdown.outflows')] : [])];
    const rows = sortedTableData.map((d) => [
      d.fullName,
      d.Income,
      d.Expenses,
      d.Savings,
      `${formatPercentTrimmed(d.SavingsRate)}`,
      ...(showFlows ? [d.TaggedInflows ?? null, d.TaggedOutflows ?? null] : []),
    ]);
    exportToCsv('income-vs-expenses', headers, rows);
  };

  const barClickedRef = useRef(false);

  const handleBarClick = (categoryType: 'income' | 'expense') => (data: { payload?: { monthStart?: string; monthEnd?: string } }) => {
    barClickedRef.current = true;
    const monthStart = data.payload?.monthStart;
    const monthEnd = data.payload?.monthEnd;
    if (monthStart && monthEnd) {
      router.push(
        `/transactions?startDate=${monthStart}&endDate=${monthEnd}&categoryType=${categoryType}`,
      );
    }
  };

  const handleChartClick = (state: any) => {
    if (barClickedRef.current) {
      barClickedRef.current = false;
      return;
    }
    const label = state?.activeLabel;
    if (!label) return;
    const item = chartData.find((d) => d.name === label);
    if (item?.monthStart && item?.monthEnd) {
      router.push(
        `/transactions?startDate=${item.monthStart}&endDate=${item.monthEnd}`,
      );
    }
  };

  const CustomTooltip = ({
    active,
    payload,
  }: {
    active?: boolean;
    payload?: Array<{
      name: string;
      value: number;
      color: string;
      payload: { fullName: string; SavingsRate: number };
    }>;
    label?: string;
  }) => {
    const data = payload?.[0]?.payload;
    return (
      <ChartTooltip
        active={active}
        label={data?.fullName}
        payload={payload}
        formatValue={(v) => formatCurrency(v)}
      >
        {data && (
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            {t('incomeVsExpenses.savingsRateTooltip', { rate: data.SavingsRate })}
          </p>
        )}
      </ChartTooltip>
    );
  };

  return (
    <div className="space-y-6">
      {/* Controls -- always rendered so focus inside DateInput survives reloads */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-4">
        <div className="flex flex-wrap gap-4 items-center justify-between">
          <ReportAccountMultiSelect
            accounts={offeredAccounts}
            value={selectedAccountIds}
            onChange={setSelectedAccountIds}
            filter={nonInvestmentAccounts}
          />
          <DateRangeSelector
            ranges={["6m", "1y", "2y"]}
            value={dateRange}
            onChange={setDateRange}
            showCustom
            customStartDate={startDate}
            onCustomStartDateChange={setStartDate}
            customEndDate={endDate}
            onCustomEndDateChange={setEndDate}
          />
          <div className="flex items-center gap-4">
            <ChartViewToggle
              value={viewType}
              onChange={(v) => setViewType(v as 'bar' | 'table')}
              options={['bar', 'table']}
            />
            <TagKeyBreakdownSelect tagKeys={tagKeys} value={tagKey} onChange={setTagKey} />
          </div>
          <ReportToolbarActions
            onExportPdf={handleExportPdf}
            onExportCsv={handleExportCsv}
            disabled={chartData.length === 0}
          />
        </div>
      </div>

      {/* Chart */}
      <div ref={chartRef} className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 px-2 py-4 sm:p-6">
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-8 w-1/3" />
            <Skeleton className="h-96 w-full" />
          </div>
        ) : error ? (
          <ReportError onRetry={reload} />
        ) : chartData.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400 text-center py-8">
            {t('incomeVsExpenses.noData')}
          </p>
        ) : viewType === 'table' ? (
          <>
            {/* Below `sm` the table becomes a block and each row wraps into a
                three-column grid so all five columns fit a phone without a
                horizontal scroll, on two lines: the month, its savings and its
                income share line 1; the savings rate (spanning the first two
                tracks) and the expenses share line 2. Each derived figure
                sits under the figure it derives from -- rate under savings,
                expenses under income -- and the month is the one cell allowed
                to wrap, since a compact amount never may. From `sm` up it is
                the ordinary table. The sort controls survive as their own
                phone-only header row, because the column header row that
                carries them on desktop is hidden there.

                Two costs of restyling one tree, both deliberate. Changing the
                display roles drops the table semantics below `sm`, which is
                why every value carries a `CellLabel` naming its column -- a
                phone reader gets labelled values rather than a header
                association. And the phone reading order differs from the DOM
                order, which is the desktop column order the grid placement
                overrides visually. Both are properties of the mechanism, not
                of this table. */}
            <div className="overflow-x-auto">
              {/* Explicit roles: restyling `display` below `sm` strips the implicit
                  table semantics, and these put them back (inert from `sm` up). */}
              <table role="table" className="block min-w-full divide-y divide-gray-200 dark:divide-gray-700 sm:table">
                <thead role="rowgroup" className="block bg-gray-50 dark:bg-gray-900/50 sm:table-header-group">
                  {/* Phone sort strip: the same five controls, as a wrapped
                      row of compact chips. Column alignment means nothing here
                      -- the column header row is hidden and each data row is a
                      grid -- so every control is left-aligned and self-naming.
                      The border and card background are what say "tappable":
                      there is no hover on a touch screen, and without them the
                      strip reads as another row of the captions the cells below
                      carry. */}
                  <tr role="row" className="flex flex-wrap gap-x-2 gap-y-1 px-2 py-2 sm:hidden">
                    {sortColumns.map((col) => (
                      <SortableHeader<IncomeVsExpensesSortField>
                        key={col.field}
                        field={col.field}
                        sortField={sortField}
                        sortDirection={sortDirection}
                        onSort={handleSort}
                        className={PHONE_HEADER_CLASS}
                      >
                        {col.label}
                      </SortableHeader>
                    ))}
                  </tr>
                  <tr role="row" className="hidden sm:table-row">
                    {sortColumns.map((col) => (
                      <SortableHeader<IncomeVsExpensesSortField>
                        key={col.field}
                        field={col.field}
                        sortField={sortField}
                        sortDirection={sortDirection}
                        onSort={handleSort}
                        align={col.align}
                        className={HEADER_CLASS}
                      >
                        {col.label}
                      </SortableHeader>
                    ))}
                  </tr>
                </thead>
                <tbody role="rowgroup" className="block divide-y divide-gray-200 dark:divide-gray-700 sm:table-row-group">
                  {sortedTableData.map((row) => (
                    <tr
                      key={row.name}
                      role="row"
                      tabIndex={0}
                      className={`grid grid-cols-3 items-start gap-x-3 gap-y-1.5 px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 ${INTERACTIVE_ROW_FOCUS_CLASS} sm:table-row sm:p-0`}
                      onClick={() => openMonth(row)}
                      onKeyDown={activateOnKey(() => openMonth(row))}
                    >
                      <td role="cell" className="col-start-1 row-start-1 p-0 text-sm font-medium text-gray-900 dark:text-gray-100 sm:table-cell sm:px-4 sm:py-3">
                        {row.fullName}
                      </td>
                      <td role="cell" className={`col-start-3 row-start-1 text-green-600 dark:text-green-400 ${MONEY_CELL}`}>
                        <CellLabel className={CAPTION_CLASS}>{t('incomeVsExpenses.colIncome')}</CellLabel>
                        {formatCurrency(row.Income)}
                      </td>
                      <td role="cell" className={`col-start-3 row-start-2 text-red-600 dark:text-red-400 ${MONEY_CELL}`}>
                        <CellLabel className={CAPTION_CLASS}>{t('incomeVsExpenses.colExpenses')}</CellLabel>
                        {formatCurrency(row.Expenses)}
                      </td>
                      {/* Savings takes the middle of line 1 beside the month:
                          it is the figure the row is read for. */}
                      <td role="cell"
                        className={`col-start-2 row-start-1 font-medium ${row.Savings >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-orange-600 dark:text-orange-400'} ${MONEY_CELL}`}
                      >
                        <CellLabel className={CAPTION_CLASS}>{t('incomeVsExpenses.colSavings')}</CellLabel>
                        {formatCurrency(row.Savings)}
                      </td>
                      {/* The rate spans the first two tracks so its caption --
                          the longest in the table in every locale -- has room
                          on one line; right-aligned, it ends under Savings. */}
                      <td role="cell"
                        className={`col-start-1 col-span-2 row-start-2 font-medium ${row.SavingsRate >= 0 ? 'text-purple-600 dark:text-purple-400' : 'text-orange-600 dark:text-orange-400'} ${MONEY_CELL}`}
                      >
                        <CellLabel className={CAPTION_CLASS}>{t('incomeVsExpenses.colSavingsRate')}</CellLabel>
                        {formatPercentTrimmed(row.SavingsRate)}
                      </td>
                      {/* Tagged transfer flows: indigo, never the green/red of
                          income and expenses, and third in the phone grid so
                          the five figures above keep their places. */}
                      {flowBucket && row.TaggedInflows !== undefined && row.TaggedOutflows !== undefined && (
                        <>
                          <td role="cell" className={`col-start-1 col-span-2 row-start-3 text-indigo-600 dark:text-indigo-400 ${MONEY_CELL}`}>
                            <CellLabel className={CAPTION_CLASS}>{t('tagBreakdown.inflows')}</CellLabel>
                            {formatCurrency(row.TaggedInflows)}
                          </td>
                          <td role="cell" className={`col-start-3 row-start-3 text-indigo-600 dark:text-indigo-400 ${MONEY_CELL}`}>
                            <CellLabel className={CAPTION_CLASS}>{t('tagBreakdown.outflows')}</CellLabel>
                            {formatCurrency(row.TaggedOutflows)}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot role="rowgroup" className="block bg-gray-50 dark:bg-gray-900/50 sm:table-footer-group">
                  {/* The totals are the largest figures on the table, so this
                      row wraps the same way a data row does -- the same three
                      tracks and placement, each money cell captioned. */}
                  <tr role="row" className="grid grid-cols-3 items-start gap-x-3 gap-y-1.5 px-4 py-3 sm:table-row sm:p-0">
                    <td role="cell" className="col-start-1 row-start-1 p-0 text-sm font-bold text-gray-900 dark:text-gray-100 sm:table-cell sm:px-4 sm:py-3">{t('incomeVsExpenses.total')}</td>
                    <td role="cell" className={`col-start-3 row-start-1 font-bold text-green-600 dark:text-green-400 ${MONEY_CELL}`}>
                      <CellLabel className={CAPTION_CLASS}>{t('incomeVsExpenses.colIncome')}</CellLabel>
                      <PartialTotal total={{ value: totals.totalIncome, ...completeness }} displayCurrency={reportingCurrency}>
                        {formatCurrency(totals.totalIncome)}
                      </PartialTotal>
                    </td>
                    <td role="cell" className={`col-start-3 row-start-2 font-bold text-red-600 dark:text-red-400 ${MONEY_CELL}`}>
                      <CellLabel className={CAPTION_CLASS}>{t('incomeVsExpenses.colExpenses')}</CellLabel>
                      <PartialTotal total={{ value: totals.totalExpenses, ...completeness }} displayCurrency={reportingCurrency}>
                        {formatCurrency(totals.totalExpenses)}
                      </PartialTotal>
                    </td>
                    <td role="cell"
                      className={`col-start-2 row-start-1 font-bold ${totals.totalSavings >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-orange-600 dark:text-orange-400'} ${MONEY_CELL}`}
                    >
                      <CellLabel className={CAPTION_CLASS}>{t('incomeVsExpenses.colSavings')}</CellLabel>
                      <PartialTotal total={{ value: totals.totalSavings, ...completeness }} displayCurrency={reportingCurrency}>
                        {formatCurrency(totals.totalSavings)}
                      </PartialTotal>
                    </td>
                    <td role="cell"
                      className={`col-start-1 col-span-2 row-start-2 font-bold ${totals.savingsRate >= 0 ? 'text-purple-600 dark:text-purple-400' : 'text-orange-600 dark:text-orange-400'} ${MONEY_CELL}`}
                    >
                      <CellLabel className={CAPTION_CLASS}>{t('incomeVsExpenses.colSavingsRate')}</CellLabel>
                      {formatPercent(totals.savingsRate, 1)}
                    </td>
                    {flowBucket && (
                      <>
                        <td role="cell" className={`col-start-1 col-span-2 row-start-3 font-bold text-indigo-600 dark:text-indigo-400 ${MONEY_CELL}`}>
                          <CellLabel className={CAPTION_CLASS}>{t('tagBreakdown.inflows')}</CellLabel>
                          <PartialTotal total={{ value: flowBucket.taggedInflows, missingCurrencies: flowBucket.missingCurrencies, excludedCount: flowBucket.excludedCount }} displayCurrency={reportingCurrency}>
                            {formatCurrency(flowBucket.taggedInflows)}
                          </PartialTotal>
                        </td>
                        <td role="cell" className={`col-start-3 row-start-3 font-bold text-indigo-600 dark:text-indigo-400 ${MONEY_CELL}`}>
                          <CellLabel className={CAPTION_CLASS}>{t('tagBreakdown.outflows')}</CellLabel>
                          <PartialTotal total={{ value: flowBucket.taggedOutflows, missingCurrencies: flowBucket.missingCurrencies, excludedCount: flowBucket.excludedCount }} displayCurrency={reportingCurrency}>
                            {formatCurrency(flowBucket.taggedOutflows)}
                          </PartialTotal>
                        </td>
                      </>
                    )}
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        ) : (
          <>
            <div className="h-96">
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <BarChart
                  data={chartData}
                  margin={{ top: 20, right: 10, left: 0, bottom: 5 }}
                  onClick={handleChartClick}
                  style={{ cursor: "pointer" }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 12 }}
                    tickFormatter={(value: string) =>
                      formatChartDate(`${value}-01`, "MMM")
                    }
                  />
                  <YAxis
                    tickFormatter={formatCurrencyAxis}
                    tick={{ fontSize: 12 }}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend />
                  <ReferenceLine y={0} stroke={chartColors.axis} />
                  <Bar
                    dataKey="Income"
                    name={t('incomeVsExpenses.seriesIncome')}
                    fill={chartColors.income}
                    radius={[4, 4, 0, 0]}
                    cursor="pointer"
                    onClick={handleBarClick('income')}
                  />
                  <Bar
                    dataKey="Expenses"
                    name={t('incomeVsExpenses.seriesExpenses')}
                    fill={chartColors.expense}
                    radius={[4, 4, 0, 0]}
                    cursor="pointer"
                    onClick={handleBarClick('expense')}
                  />
                  <Bar
                    dataKey="Savings"
                    name={t('incomeVsExpenses.seriesSavings')}
                    fill={chartColors.primary}
                    radius={[4, 4, 0, 0]}
                    cursor="pointer"
                  />
                  {/* The funding series: the active tag bucket's transfer flows,
                      drawn in the indigo pair the breakdown card uses so they
                      never read as income or expenses. Absent without a tag
                      key or on the untagged tab. */}
                  {flowBucket && (
                    <Bar
                      dataKey="TaggedInflows"
                      name={t('tagBreakdown.inflowsSeries', { value: flowBucket.value })}
                      fill={chartColors.inflow}
                      radius={[4, 4, 0, 0]}
                    />
                  )}
                  {flowBucket && (
                    <Bar
                      dataKey="TaggedOutflows"
                      name={t('tagBreakdown.outflowsSeries', { value: flowBucket.value })}
                      fill={chartColors.outflow}
                      radius={[4, 4, 0, 0]}
                    />
                  )}
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Summary Cards */}
            <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700 grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4 text-center">
                <div className="text-sm text-green-600 dark:text-green-400">
                  {t('incomeVsExpenses.totalIncome')}
                </div>
                <div className="text-xl font-bold text-green-700 dark:text-green-300">
                  <PartialTotal total={{ value: totals.totalIncome, ...completeness }} displayCurrency={reportingCurrency}>
                    {formatCurrency(totals.totalIncome)}
                  </PartialTotal>
                </div>
              </div>
              <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4 text-center">
                <div className="text-sm text-red-600 dark:text-red-400">
                  {t('incomeVsExpenses.totalExpenses')}
                </div>
                <div className="text-xl font-bold text-red-700 dark:text-red-300">
                  <PartialTotal total={{ value: totals.totalExpenses, ...completeness }} displayCurrency={reportingCurrency}>
                    {formatCurrency(totals.totalExpenses)}
                  </PartialTotal>
                </div>
              </div>
              <div
                className={`rounded-lg p-4 text-center ${
                  totals.totalSavings >= 0
                    ? "bg-blue-50 dark:bg-blue-900/20"
                    : "bg-orange-50 dark:bg-orange-900/20"
                }`}
              >
                <div
                  className={`text-sm ${
                    totals.totalSavings >= 0
                      ? "text-blue-600 dark:text-blue-400"
                      : "text-orange-600 dark:text-orange-400"
                  }`}
                >
                  {t('incomeVsExpenses.totalSavings')}
                </div>
                <div
                  className={`text-xl font-bold ${
                    totals.totalSavings >= 0
                      ? "text-blue-700 dark:text-blue-300"
                      : "text-orange-700 dark:text-orange-300"
                  }`}
                >
                  <PartialTotal total={{ value: totals.totalSavings, ...completeness }} displayCurrency={reportingCurrency}>
                    {formatCurrency(totals.totalSavings)}
                  </PartialTotal>
                </div>
              </div>
              <div
                className={`rounded-lg p-4 text-center ${
                  totals.savingsRate >= 0
                    ? "bg-purple-50 dark:bg-purple-900/20"
                    : "bg-orange-50 dark:bg-orange-900/20"
                }`}
              >
                <div
                  className={`text-sm ${
                    totals.savingsRate >= 0
                      ? "text-purple-600 dark:text-purple-400"
                      : "text-orange-600 dark:text-orange-400"
                  }`}
                >
                  {t('incomeVsExpenses.savingsRate')}
                </div>
                <div
                  className={`text-xl font-bold ${
                    totals.savingsRate >= 0
                      ? "text-purple-700 dark:text-purple-300"
                      : "text-orange-700 dark:text-orange-300"
                  }`}
                >
                  {formatPercent(totals.savingsRate, 1)}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {!isLoading && !error && response?.tagKey && response.buckets && (
        <TagKeyBreakdownBuckets
          tagKey={response.tagKey}
          buckets={response.buckets}
          reportingCurrency={reportingCurrency}
          idPrefix="income-vs-expenses-tag"
          activeValue={activeBucket?.value}
          onActiveValueChange={setActiveBucketValue}
        />
      )}
    </div>
  );
}
