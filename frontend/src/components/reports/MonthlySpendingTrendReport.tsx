"use client";

import { useState, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import { gainLossColor } from '@/lib/format';
import { CellLabel } from '@/components/ui/Table';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { useRouter } from "next/navigation";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { format, parseISO, startOfMonth, endOfMonth } from "date-fns";
import { builtInReportsApi } from "@/lib/built-in-reports";
import { MonthlyIncomeExpenseItem } from "@/types/built-in-reports";
import { useNumberFormat } from "@/hooks/useNumberFormat";
import { useChartDateFormat } from "@/hooks/useChartDateFormat";
import { useDateRange } from "@/hooks/useDateRange";
import { useReportData } from "@/hooks/useReportData";
import { useSortableTable, compareValues } from "@/hooks/useSortableTable";
import { DateRangeSelector } from "@/components/ui/DateRangeSelector";
import { ChartViewToggle } from "@/components/ui/ChartViewToggle";
import { ExportDropdown } from '@/components/ui/ExportDropdown';
import { SortableHeader } from '@/components/ui/SortableHeader';
import { ChartTooltip } from "@/components/reports/ChartTooltip";
import { ReportError } from "@/components/reports/ReportError";
import { exportToCsv } from "@/lib/csv-export";
import { chartColors } from "@/lib/chart-colors";
import { resolvePdfColor } from '@/components/reports/resolve-pdf-color';

type MonthlySpendingSortField = 'name' | 'income' | 'expenses' | 'net';

/**
 * One sortable column of the table view. The four are declared once and
 * rendered by BOTH header rows -- the column header row (from `sm` up) and the
 * phone sort strip -- so the two can never list different fields.
 */
interface SortColumn {
  field: MonthlySpendingSortField;
  label: string;
  /** Money columns are right-aligned in the column header row. */
  align?: 'right';
}

const HEADER_CLASS =
  'px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase';

// The same sort controls in the phone strip: a wrapped row of compact chips.
// Column alignment means nothing there -- the column header row is hidden and
// each data row is a grid -- so every control is left-aligned and self-naming.
// The border and card background are what say "tappable": there is no hover on
// a touch screen, and without them the strip reads as another row of the
// captions the cells below carry.
const PHONE_HEADER_CLASS =
  'rounded border border-gray-200 bg-white px-2 py-1.5 text-xs font-medium text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 uppercase';

// A money cell inside a wrapped card: no padding of its own below `sm` (the row
// supplies it and the grid does the spacing), the table cell's own padding from
// `sm` up. Smaller type on phones, and `whitespace-nowrap` so a locale that
// groups thousands with a space cannot break in the middle of a number.
//
// Width budget, measured on a hand-CSS replica in Chromium. This report
// formats with `formatCurrencyCompact` (no decimals, narrow symbol), so the
// widest realistic value is far shorter than a 2dp one. Two equal
// `minmax(0,1fr)` tracks give each money cell 138px at 320px and 173px at
// 390px, against a negative seven-figure `pl-PL` amount (space thousands,
// trailing currency glyph) of 79px, 88px in the totals row's bold. So both
// widths hold a seven-figure figure with well over half the track spare, and
// a negative NINE-figure total still fits at 320px (105px bold).
// Right alignment is not a containment device: a nowrap
// amount longer than its track overflows past the END edge whatever
// `text-align` says, and in the right-hand track that does reopen the
// wrapper's sideways scroll. That is the deliberate choice -- `overflow-hidden`
// here would silently truncate a figure, and a scroll that appears only for an
// amount past the budget is honest.
const MONEY_CELL =
  'p-0 text-right text-xs whitespace-nowrap sm:table-cell sm:px-4 sm:py-3 sm:text-sm';

interface ChartDataItem {
  name: string;
  fullName: string;
  Expenses: number;
  Income: number;
  Net: number;
  monthStart: string;
  monthEnd: string;
}

export function MonthlySpendingTrendReport() {
  const t = useTranslations('reports');
  const router = useRouter();
  const chartRef = useRef<HTMLDivElement>(null);
  const { formatCurrencyCompact: formatCurrency, formatCurrencyAxis } =
    useNumberFormat();
  const formatChartDate = useChartDateFormat();
  const [viewType, setViewType] = useState<'line' | 'table'>('line');
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
  const { sortField, sortDirection, handleSort } = useSortableTable<MonthlySpendingSortField>(
    'reports.monthly-spending-trend.table.sort',
    { field: 'name', direction: 'asc' },
  );

  const { start: rangeStart, end: rangeEnd } = resolvedRange;

  const { data: response, isLoading, error, reload } = useReportData(
    () =>
      isValid
        ? builtInReportsApi.getIncomeVsExpenses({
            startDate: rangeStart || undefined,
            endDate: rangeEnd,
          })
        : Promise.resolve(null),
    [isValid, rangeStart, rangeEnd],
  );

  // Map response to chart data. `name` must be unique across the dataset
  // (used as the XAxis category key); a non-unique value like "May" causes
  // Recharts to resolve the tooltip's payload to the first matching row,
  // showing data from the wrong year on multi-year ranges.
  const chartData = useMemo<ChartDataItem[]>(
    () =>
      (response?.data ?? []).map((item: MonthlyIncomeExpenseItem) => {
        const monthDate = parseISO(item.month + "-01");
        return {
          name: item.month,
          fullName: formatChartDate(monthDate, "MMM yyyy"),
          Expenses: Math.round(item.expenses),
          Income: Math.round(item.income),
          Net: Math.round(item.net),
          monthStart: format(startOfMonth(monthDate), "yyyy-MM-dd"),
          monthEnd: format(endOfMonth(monthDate), "yyyy-MM-dd"),
        };
      }),
    [response, formatChartDate],
  );

  const sortedTableData = useMemo(() => {
    const sorted = [...chartData];
    sorted.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'name':
          comparison = compareValues(a.name, b.name);
          break;
        case 'income':
          comparison = compareValues(a.Income, b.Income);
          break;
        case 'expenses':
          comparison = compareValues(a.Expenses, b.Expenses);
          break;
        case 'net':
          comparison = compareValues(a.Net, b.Net);
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    return sorted;
  }, [chartData, sortField, sortDirection]);

  const totals = useMemo(() => {
    const totalExpenses = chartData.reduce((sum, m) => sum + m.Expenses, 0);
    const totalIncome = chartData.reduce((sum, m) => sum + m.Income, 0);
    const avgExpenses =
      chartData.length > 0 ? totalExpenses / chartData.length : 0;
    const avgIncome = chartData.length > 0 ? totalIncome / chartData.length : 0;
    return { totalExpenses, totalIncome, avgExpenses, avgIncome };
  }, [chartData]);

  // The footer's Net column, named once so the figure and its sign colouring
  // cannot be computed from two different expressions.
  const totalNet = totals.totalIncome - totals.totalExpenses;

  // Exhaustive over the sort field union, so a new field is a compile error
  // rather than a column with no control in either header. The list both
  // header rows render is DERIVED from the record, never re-listed beside it:
  // a hand-written list next to an exhaustive record is not exhaustive. The
  // record's declaration order is the column order.
  const columns: Record<MonthlySpendingSortField, SortColumn> = {
    name: { field: 'name', label: t('monthlySpendingTrend.colMonth') },
    income: { field: 'income', label: t('monthlySpendingTrend.colIncome'), align: 'right' },
    expenses: { field: 'expenses', label: t('monthlySpendingTrend.colExpenses'), align: 'right' },
    net: { field: 'net', label: t('monthlySpendingTrend.colNet'), align: 'right' },
  };
  const sortColumns: readonly SortColumn[] = Object.values(columns);

  const handleExportPdf = async () => {
    const { exportToPdf } = await import("@/lib/pdf-export");
    await exportToPdf({
      title: t('monthlySpendingTrend.pdfTitle'),
      summaryCards: [
        { label: t('monthlySpendingTrend.totalIncome'), value: formatCurrency(totals.totalIncome), color: '#16a34a' },
        { label: t('monthlySpendingTrend.totalExpenses'), value: formatCurrency(totals.totalExpenses), color: '#dc2626' },
        { label: t('monthlySpendingTrend.avgMonthlyIncome'), value: formatCurrency(totals.avgIncome), color: '#16a34a' },
        { label: t('monthlySpendingTrend.avgMonthlyExpenses'), value: formatCurrency(totals.avgExpenses), color: '#dc2626' },
      ],
      chartContainer: chartRef.current,
      chartLegend: [
        { color: resolvePdfColor(chartColors.expense), label: t('monthlySpendingTrend.seriesExpenses') },
        { color: resolvePdfColor(chartColors.income), label: t('monthlySpendingTrend.seriesIncome') },
      ],
      filename: "monthly-spending-trend",
    });
  };

  const handleExportCsv = () => {
    const headers = [t('monthlySpendingTrend.colMonth'), t('monthlySpendingTrend.colIncome'), t('monthlySpendingTrend.colExpenses'), t('monthlySpendingTrend.colNet')];
    const rows = sortedTableData.map((d) => [d.fullName, d.Income, d.Expenses, d.Net]);
    exportToCsv('monthly-spending-trend', headers, rows);
  };

  const handleChartClick = (state: any) => {
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
      payload?: { fullName?: string };
    }>;
    label?: string;
  }) => (
    <ChartTooltip
      active={active}
      label={payload?.[0]?.payload?.fullName}
      payload={payload}
      formatValue={(v) => formatCurrency(v)}
    />
  );

  return (
    <div className="space-y-6">
      {/* Controls -- always rendered so focus inside DateInput survives reloads */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-4">
        <div className="flex flex-wrap gap-4 items-center justify-between">
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
              onChange={(v) => setViewType(v as 'line' | 'table')}
              options={['line', 'table']}
            />
            <ExportDropdown
              onExportPdf={handleExportPdf}
              onExportCsv={handleExportCsv}
              disabled={chartData.length === 0}
            />
          </div>
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
            {t('monthlySpendingTrend.noData')}
          </p>
        ) : viewType === 'table' ? (
          <>
            {/* Below `sm` the table becomes a block and each row wraps into a
                two-column grid so all four columns fit a phone without a
                horizontal scroll, on two lines: the month and its net share
                line 1 -- the net is the figure the row is read for, so it takes
                the right half beside the month -- and income and expenses,
                the two figures the net is made of, share line 2. The month is
                the one cell allowed to wrap, since a compact amount never may.
                Nothing is dropped: the card carries all four columns. From
                `sm` up it is the ordinary table. The sort controls survive as
                their own phone-only header row, because the column header row
                that carries them on desktop is hidden there.

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
                  {/* Phone sort strip: the same four controls, wrapped. */}
                  <tr role="row" className="flex flex-wrap gap-x-2 gap-y-1 px-2 py-2 sm:hidden">
                    {sortColumns.map((col) => (
                      <SortableHeader<MonthlySpendingSortField>
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
                      <SortableHeader<MonthlySpendingSortField>
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
                      className="grid grid-cols-2 items-start gap-x-3 gap-y-1.5 px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 sm:table-row sm:p-0"
                      onClick={() =>
                        router.push(
                          `/transactions?startDate=${row.monthStart}&endDate=${row.monthEnd}`,
                        )
                      }
                    >
                      <td role="cell" className="col-start-1 row-start-1 p-0 text-sm font-medium text-gray-900 dark:text-gray-100 sm:table-cell sm:px-4 sm:py-3">
                        {row.fullName}
                      </td>
                      <td role="cell" className={`col-start-1 row-start-2 text-green-600 dark:text-green-400 ${MONEY_CELL}`}>
                        <CellLabel className="sm:hidden">{t('monthlySpendingTrend.colIncome')}</CellLabel>
                        {formatCurrency(row.Income)}
                      </td>
                      <td role="cell" className={`col-start-2 row-start-2 text-red-600 dark:text-red-400 ${MONEY_CELL}`}>
                        <CellLabel className="sm:hidden">{t('monthlySpendingTrend.colExpenses')}</CellLabel>
                        {formatCurrency(row.Expenses)}
                      </td>
                      {/* Net takes the right of line 1 beside the month: it is
                          the figure the row is read for, and its sign colouring
                          is the same `gainLossColor` the column cell uses. */}
                      <td
                        role="cell"
                        className={`col-start-2 row-start-1 font-medium ${gainLossColor(row.Net)} ${MONEY_CELL}`}
                      >
                        <CellLabel className="sm:hidden">{t('monthlySpendingTrend.colNet')}</CellLabel>
                        {formatCurrency(row.Net)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot role="rowgroup" className="block bg-gray-50 dark:bg-gray-900/50 sm:table-footer-group">
                  {/* The totals are the largest figures on the table, so this
                      row wraps the same way a data row does -- the same two
                      tracks and placement, each money cell captioned. */}
                  <tr role="row" className="grid grid-cols-2 items-start gap-x-3 gap-y-1.5 px-4 py-3 sm:table-row sm:p-0">
                    <td role="cell" className="col-start-1 row-start-1 p-0 text-sm font-bold text-gray-900 dark:text-gray-100 sm:table-cell sm:px-4 sm:py-3">{t('monthlySpendingTrend.total')}</td>
                    <td role="cell" className={`col-start-1 row-start-2 font-bold text-green-600 dark:text-green-400 ${MONEY_CELL}`}>
                      <CellLabel className="sm:hidden">{t('monthlySpendingTrend.colIncome')}</CellLabel>
                      {formatCurrency(totals.totalIncome)}
                    </td>
                    <td role="cell" className={`col-start-2 row-start-2 font-bold text-red-600 dark:text-red-400 ${MONEY_CELL}`}>
                      <CellLabel className="sm:hidden">{t('monthlySpendingTrend.colExpenses')}</CellLabel>
                      {formatCurrency(totals.totalExpenses)}
                    </td>
                    <td
                      role="cell"
                      className={`col-start-2 row-start-1 font-bold ${gainLossColor(totalNet)} ${MONEY_CELL}`}
                    >
                      <CellLabel className="sm:hidden">{t('monthlySpendingTrend.colNet')}</CellLabel>
                      {formatCurrency(totalNet)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        ) : (
          <>
            <div className="h-96">
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <LineChart
                  data={chartData}
                  margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
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
                  <Line
                    type="monotone"
                    dataKey="Expenses"
                    stroke={chartColors.expense}
                    strokeWidth={2}
                    dot={{ fill: chartColors.expense, strokeWidth: 2, r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="Income"
                    stroke={chartColors.income}
                    strokeWidth={2}
                    dot={{ fill: chartColors.income, strokeWidth: 2, r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Summary */}
            <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700 grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
              <div>
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  {t('monthlySpendingTrend.totalIncome')}
                </div>
                <div className="text-lg font-semibold text-green-600 dark:text-green-400">
                  {formatCurrency(totals.totalIncome)}
                </div>
              </div>
              <div>
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  {t('monthlySpendingTrend.totalExpenses')}
                </div>
                <div className="text-lg font-semibold text-red-600 dark:text-red-400">
                  {formatCurrency(totals.totalExpenses)}
                </div>
              </div>
              <div>
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  {t('monthlySpendingTrend.avgMonthlyIncome')}
                </div>
                <div className="text-lg font-semibold text-green-600 dark:text-green-400">
                  {formatCurrency(totals.avgIncome)}
                </div>
              </div>
              <div>
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  {t('monthlySpendingTrend.avgMonthlyExpenses')}
                </div>
                <div className="text-lg font-semibold text-red-600 dark:text-red-400">
                  {formatCurrency(totals.avgExpenses)}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
