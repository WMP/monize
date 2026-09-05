'use client';

import { useState, useMemo, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
  ReferenceDot,
  LabelList,
} from 'recharts';
import { chartColors } from '@/lib/chart-colors';
import { netWorthApi } from '@/lib/net-worth';
import { MonthlyNetWorth } from '@/types/net-worth';
import { useChartDateFormat } from '@/hooks/useChartDateFormat';
import { useNumberFormat } from '@/hooks/useNumberFormat';
import { gainLossColor } from '@/lib/format';
import { useDateRange } from '@/hooks/useDateRange';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useSortableTable, compareValues } from '@/hooks/useSortableTable';
import { DateRangeSelector } from '@/components/ui/DateRangeSelector';
import { ChartViewToggle } from '@/components/ui/ChartViewToggle';
import { ExportDropdown } from '@/components/ui/ExportDropdown';
import { SortableHeader } from '@/components/ui/SortableHeader';
import { CellLabel } from '@/components/ui/Table';
import { exportToCsv } from '@/lib/csv-export';
import { useReportData } from '@/hooks/useReportData';
import { ReportError } from '@/components/reports/ReportError';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { createLogger } from '@/lib/logger';

const logger = createLogger('NetWorthReport');

type NetWorthSortField = 'name' | 'assets' | 'liabilities' | 'netWorth';

/**
 * One sortable column of the table view. The four are declared once, as a
 * record over the sort field union, and rendered by BOTH header rows -- the
 * column header row (from `sm` up) and the phone sort strip -- so the two can
 * never list different fields, and adding a member to the union fails `tsc`
 * rather than stranding a phone with no control for it.
 */
interface SortColumn {
  field: NetWorthSortField;
  label: string;
  /** Money columns are right-aligned in the column header row. */
  align?: 'right';
}

// Today's header cell, unchanged.
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

// A money cell inside a wrapped card: no padding of its own below `sm` (the
// row supplies it and the grid does the spacing), the table cell's own padding
// from `sm` up. Smaller type on phones.
//
// `whitespace-nowrap` is the one property here that is NOT phone-only, and it
// is the single respect in which the `sm`-and-up cell differs from today's: a
// locale that groups thousands with a space could otherwise break a figure in
// the middle of a number, at any width.
//
// Width budget, measured on a hand-written CSS replica in Chromium at the
// insets this table really gets (the report page's `px-4` plus this card's
// `px-2`), so 272px of content at 320px and 342px at 390px. Two equal
// `minmax(0,1fr)` tracks inside the row's own `px-4` give each money cell
// 114px at 320px and 149px at 390px. The unit is part of the budget and is not
// always a symbol: `formatCurrencyCompact` asks for `narrowSymbol`, which
// falls back to the three-letter ISO code where a currency has none, so the
// widest realistic value is a negative seven-figure `1 439 000 CHF`-shaped
// amount -- 93.5px at `text-xs`. That leaves 20px spare at 320px, and a
// NEGATIVE NINE-FIGURE amount (109px) still fits there.
// Right alignment is not a containment device. Measured in Chromium at 320px
// with a fifteen-digit amount forced into each track: the text is laid out from
// the track's START edge and overflows past its END edge whatever `text-align`
// says (left track 40-154, text 40-202; right track 166-280, text 166-328). In
// the right-hand track that reopens the wrapper's sideways scroll (`scrollWidth`
// 304 against a `clientWidth` of 272); in the left-hand one it runs over the
// figure beside it instead. Both are the deliberate choice: `overflow-hidden`
// here would silently cut a figure, and a figure that is cut is worse than one
// that is crowded or an honest scroll past the measured budget.
const MONEY_CELL =
  'p-0 text-right text-xs whitespace-nowrap sm:table-cell sm:px-4 sm:py-3 sm:text-sm';

/** Every caption in a wrapped cell is phone-only. */
const CAPTION_CLASS = 'sm:hidden';

export function NetWorthReport() {
  const t = useTranslations('reports');
  const formatChartDate = useChartDateFormat();
  const { formatCurrencyCompact: formatCurrency, formatCurrencyAxis, formatCurrencyLabel, formatSignedPercent } = useNumberFormat();
  const isMobile = useIsMobile();
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [chartType, setChartType] = useLocalStorage<'line' | 'bar' | 'stacked' | 'table'>(
    'reports.net-worth.chartType',
    'bar',
  );
  const chartRef = useRef<HTMLDivElement>(null);
  const { dateRange, setDateRange, startDate, setStartDate, endDate, setEndDate, resolvedRange, isValid } = useDateRange({ defaultRange: '1y', alignment: 'month' });
  const { sortField, sortDirection, handleSort } = useSortableTable<NetWorthSortField>(
    'reports.net-worth.table.sort',
    { field: 'name', direction: 'asc' },
  );

  const { start: rangeStart, end: rangeEnd } = resolvedRange;

  const { data: response, isLoading, error, reload } = useReportData(
    () =>
      isValid && rangeEnd
        ? netWorthApi.getMonthly({
            startDate: rangeStart || undefined,
            endDate: rangeEnd,
          })
        : Promise.resolve(null),
    [isValid, rangeStart, rangeEnd],
  );

  const monthlyData = useMemo<MonthlyNetWorth[]>(
    () => response ?? [],
    [response],
  );

  const handleRecalculate = async () => {
    setIsRecalculating(true);
    try {
      await netWorthApi.recalculate();
      reload();
    } catch (error) {
      logger.error('Failed to recalculate:', error);
    } finally {
      setIsRecalculating(false);
    }
  };

  const handleExportPdf = async () => {
    const { exportToPdf } = await import('@/lib/pdf-export');
    await exportToPdf({
      title: t('netWorth.pdfTitle'),
      subtitle: `${chartData[0]?.name || ''} - ${chartData[chartData.length - 1]?.name || ''}`,
      summaryCards: [
        { label: t('netWorth.currentNetWorth'), value: formatCurrency(summary.current), color: summary.current >= 0 ? '#16a34a' : '#dc2626' },
        { label: t('netWorth.change'), value: `${summary.change >= 0 ? '+' : ''}${formatCurrency(summary.change)}`, color: summary.change >= 0 ? '#16a34a' : '#dc2626' },
        { label: t('netWorth.changePct'), value: formatSignedPercent(summary.changePercent, 1), color: summary.changePercent >= 0 ? '#16a34a' : '#dc2626' },
      ],
      chartContainer: chartRef.current,
      filename: 'net-worth-report',
    });
  };

  const handleExportCsv = () => {
    const headers = [t('netWorth.colMonth'), t('netWorth.colAssets'), t('netWorth.colLiabilities'), t('netWorth.colNetWorth')];
    const rows = sortedTableData.map((d) => [d.name, d.Assets, d.Liabilities, d.NetWorth]);
    exportToCsv('net-worth-report', headers, rows);
  };

  const chartData = useMemo(() =>
    monthlyData.map((d) => ({
      // `name` is the formatted display label; `sortKey` is the ISO month
      // (YYYY-MM) so the table can sort chronologically rather than
      // alphabetically by month-name ("Apr 2021" < "Aug 2020" lexically) and
      // so the chart axis can format month markers locale-aware from the raw
      // value rather than splitting the localized label.
      name: formatChartDate(d.month, 'MMM yyyy'),
      sortKey: d.month,
      Assets: Math.round(d.assets),
      Liabilities: Math.round(d.liabilities),
      NetWorth: Math.round(d.netWorth),
    })),
  [monthlyData, formatChartDate]);

  const summary = useMemo(() => {
    if (chartData.length === 0) return { current: 0, change: 0, changePercent: 0 };
    const current = chartData[chartData.length - 1]?.NetWorth || 0;
    const initial = chartData[0]?.NetWorth || 0;
    const change = current - initial;
    const changePercent = initial !== 0 ? (change / Math.abs(initial)) * 100 : 0;
    return { current, change, changePercent };
  }, [chartData]);

  const sortedTableData = useMemo(() => {
    const sorted = [...chartData];
    sorted.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'name':
          comparison = compareValues(a.sortKey, b.sortKey);
          break;
        case 'assets':
          comparison = compareValues(a.Assets, b.Assets);
          break;
        case 'liabilities':
          comparison = compareValues(a.Liabilities, b.Liabilities);
          break;
        case 'netWorth':
          comparison = compareValues(a.NetWorth, b.NetWorth);
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    return sorted;
  }, [chartData, sortField, sortDirection]);

  // Exhaustive over the sort field union, so a new field is a compile error
  // rather than a column with no control in either header.
  const columns: Record<NetWorthSortField, SortColumn> = {
    name: { field: 'name', label: t('netWorth.colMonth') },
    assets: { field: 'assets', label: t('netWorth.colAssets'), align: 'right' },
    liabilities: { field: 'liabilities', label: t('netWorth.colLiabilities'), align: 'right' },
    netWorth: { field: 'netWorth', label: t('netWorth.colNetWorth'), align: 'right' },
  };

  // Their order, rendered by BOTH header rows and matched by the cells' DOM
  // order. DERIVED from the record rather than re-listed: a hand-written list
  // beside an exhaustive record is not exhaustive, so a field added to the
  // union would compile (the record forces an entry) and still ship with no
  // sort control in either header -- exactly the stranding the record exists to
  // prevent. The record's declaration order is the column order.
  const sortColumns: readonly SortColumn[] = Object.values(columns);

  // For long ranges, explicitly specify which ticks to show so years don't repeat.
  // Ticks are keyed off the raw ISO month (sortKey, YYYY-MM-DD) so the January
  // filter and axis formatting stay locale-independent.
  const xAxisTicks = useMemo(() => {
    if (chartData.length <= 36) return undefined; // let Recharts auto-decide for shorter ranges
    // Only show ticks on January of each year
    return chartData
      .filter(d => d.sortKey.slice(5, 7) === '01')
      .map(d => d.sortKey);
  }, [chartData]);

  // Calculate Y-axis domain to avoid starting at 0 when values are significantly higher
  const yAxisDomain = useMemo(() => {
    if (chartData.length === 0) return [0, 'auto'] as [number, 'auto'];

    const values = chartData.map(d => d.NetWorth);
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const range = maxValue - minValue;

    // If min is significantly above 0 (more than 20% of the range), don't start at 0
    // Also check that all values are positive
    if (minValue > 0 && minValue > range * 0.2) {
      // Round down to a nice number for the axis minimum
      const padding = range * 0.1; // 10% padding below minimum
      const rawMin = minValue - padding;

      // Round to a nice number based on magnitude
      const magnitude = Math.pow(10, Math.floor(Math.log10(Math.abs(rawMin))));
      const niceMin = Math.floor(rawMin / magnitude) * magnitude;

      return [niceMin, 'auto'] as [number, 'auto'];
    }

    // If values cross 0 or start near 0, include 0 in the domain
    return [Math.min(0, minValue), 'auto'] as [number, 'auto'];
  }, [chartData]);

  const minMax = useMemo(() => {
    if (chartData.length < 2) return null;
    let minIdx = 0, maxIdx = 0;
    for (let i = 1; i < chartData.length; i++) {
      if (chartData[i].NetWorth < chartData[minIdx].NetWorth) minIdx = i;
      if (chartData[i].NetWorth > chartData[maxIdx].NetWorth) maxIdx = i;
    }
    if (minIdx === maxIdx) return null;
    return {
      min: chartData[minIdx],
      max: chartData[maxIdx],
    };
  }, [chartData]);

  // Per-bar value labels are only legible on the shorter (1y/2y) ranges; longer
  // ranges pack too many bars together. Beyond ~14 bars the labels are rotated
  // vertical so the 2-year view doesn't overlap. On mobile the bars are narrow
  // enough that even the 12-bar 1-year view needs vertical labels.
  const showBarLabels = dateRange === '1y' || dateRange === '2y';
  const barLabelsVertical = showBarLabels && (chartData.length > 14 || isMobile);

  // Shared between the area, bar and stacked charts so the month labels stay
  // consistent as the range widens. `value` is the raw ISO month (sortKey,
  // YYYY-MM-DD) so the markers are formatted locale-aware rather than by
  // splitting an already-localized label string.
  const formatXAxisTick = (value: string) => {
    if (chartData.length > 36) {
      // Long ranges show January ticks only, labelled with the year alone.
      // Read the year straight off the raw ISO value so it is exact and
      // locale-independent.
      return value.slice(0, 4);
    } else if (chartData.length > 18) {
      return formatChartDate(value, 'MMM yy');
    }
    return formatChartDate(value, 'MMM');
  };

  // The 100% stacked view normalises each bar to its assets/liabilities split,
  // so the Y axis reads as a percentage rather than a currency amount.
  const formatPercentAxis = (value: number) => `${Math.round(value * 100)}%`;

  const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string; payload: { name: string } }> }) => {
    if (active && payload && payload.length) {
      const data = payload[0]?.payload;
      return (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3">
          <p className="font-medium text-gray-900 dark:text-gray-100 mb-1">{data?.name}</p>
          {payload.map((entry, index) => (
            <p key={index} className="text-sm" style={{ color: entry.color }}>
              {entry.name}: {formatCurrency(entry.value)}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  const CompositionTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ payload: { name: string; Assets: number; Liabilities: number } }> }) => {
    if (active && payload && payload.length) {
      const data = payload[0]?.payload;
      const assets = data?.Assets ?? 0;
      const liabilities = data?.Liabilities ?? 0;
      const total = assets + liabilities;
      const pct = (value: number) => (total > 0 ? `${((value / total) * 100).toFixed(1)}%` : '0%');
      return (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3">
          <p className="font-medium text-gray-900 dark:text-gray-100 mb-1">{data?.name}</p>
          <p className="text-sm" style={{ color: chartColors.income }}>
            {t('netWorth.colAssets')}: {formatCurrency(assets)} ({pct(assets)})
          </p>
          <p className="text-sm" style={{ color: chartColors.expense }}>
            {t('netWorth.colLiabilities')}: {formatCurrency(liabilities)} ({pct(liabilities)})
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 pt-1 border-t border-gray-100 dark:border-gray-700">
            {t('netWorth.seriesNetWorth')}: {formatCurrency(assets - liabilities)}
          </p>
        </div>
      );
    }
    return null;
  };

  // Loading and error states are rendered *inside* this tree, never as an
  // early return. Returning a different tree unmounts the controls block, and
  // with it the date field the user is typing into -- which is what made this
  // report impossible to type a custom range into (issue #1201).
  const dataUnavailable = isLoading || !!error;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      {dataUnavailable ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-6">
          <div className="text-sm text-gray-500 dark:text-gray-400">{t('netWorth.currentNetWorth')}</div>
          <div className={`text-2xl font-bold ${
            gainLossColor(summary.current)
          }`}>
            {formatCurrency(summary.current)}
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-6">
          <div className="text-sm text-gray-500 dark:text-gray-400">{t('netWorth.change')}</div>
          <div className={`text-2xl font-bold ${gainLossColor(summary.change)}`}>
            {summary.change >= 0 ? '+' : ''}{formatCurrency(summary.change)}
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-6">
          <div className="text-sm text-gray-500 dark:text-gray-400">{t('netWorth.changePct')}</div>
          <div className={`text-2xl font-bold ${gainLossColor(summary.changePercent)}`}>
            {formatSignedPercent(summary.changePercent, 1)}
          </div>
        </div>
      </div>
      )}

      {/* Controls -- always rendered so focus inside DateInput survives reloads */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-4">
        <div className="flex flex-wrap gap-4 items-center justify-between">
          <DateRangeSelector
            ranges={['1y', '2y', '5y', 'all']}
            value={dateRange}
            onChange={setDateRange}
            showCustom
            customStartDate={startDate}
            onCustomStartDateChange={setStartDate}
            customEndDate={endDate}
            onCustomEndDateChange={setEndDate}
          />
          <div className="flex items-center gap-3">
            <ChartViewToggle
              value={chartType}
              onChange={(v) => setChartType(v as 'line' | 'bar' | 'stacked' | 'table')}
              options={['bar', 'stacked', 'line', 'table']}
            />
            <button
              onClick={handleRecalculate}
              disabled={isRecalculating}
              className="px-3 py-1.5 text-sm font-medium rounded-md transition-colors bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
            >
              {isRecalculating ? t('netWorth.recalculating') : t('netWorth.recalculate')}
            </button>
            <ExportDropdown onExportPdf={handleExportPdf} onExportCsv={handleExportCsv} disabled={chartData.length === 0} />
          </div>
        </div>
      </div>

      {/* Chart or Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 px-2 py-4 sm:p-6">
        {error ? (
          <ReportError onRetry={reload} />
        ) : isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-8 w-1/3" />
            <Skeleton className="h-96 w-full" />
          </div>
        ) : chartData.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400 text-center py-8">
            {t('netWorth.noData')}
          </p>
        ) : chartType === 'table' ? (
          /* Below `sm` the table becomes a block and each row wraps into a
             two-column grid so all four columns fit a phone without a
             horizontal scroll, on two lines: the month and its net worth share
             line 1 -- the net worth is the figure the row is read for, so it
             takes the right half beside the month -- and assets and
             liabilities, the two figures the net worth is made of, share line
             2. The month is the one cell allowed to wrap, since a compact
             amount never may. Nothing is dropped: the card carries all four
             columns, and the row stays what it is today -- hovering, but not
             clickable. From `sm` up it is the ordinary table. The sort controls
             survive as their own phone-only header row, because the column
             header row that carries them on desktop is hidden there.

             Two properties of restyling one tree, both deliberate. Changing the
             `display` would drop the implicit table semantics below `sm`, so
             the explicit ARIA roles below put them back -- the phone sort strip
             is the header row a phone reader gets, and its four controls sit in
             the cells' own DOM order, so the column association survives. The
             `CellLabel` captions are therefore REDUNDANT with that association
             rather than a substitute for it, and deliberately so: the grid
             places the cells out of DOM order visually, so a sighted phone
             reader has no header row to look up and needs the name beside the
             value. A screen reader hears the column name twice. And the phone
             reading order differs from the DOM order, which is the desktop
             column order the grid placement overrides visually (the WCAG 1.3.2
             tension the roles are the mitigation for). Both are properties of
             the mechanism, not of this table. */
          <div className="overflow-x-auto">
            {/* Explicit roles: restyling `display` below `sm` strips the implicit
                table semantics, and these put them back (inert from `sm` up). */}
            <table role="table" className="block min-w-full divide-y divide-gray-200 dark:divide-gray-700 sm:table">
              <thead role="rowgroup" className="block bg-gray-50 dark:bg-gray-900/50 sm:table-header-group">
                {/* Phone sort strip: the same four controls, wrapped. */}
                <tr role="row" className="flex flex-wrap gap-x-2 gap-y-1 px-2 py-2 sm:hidden">
                  {sortColumns.map((col) => (
                    <SortableHeader<NetWorthSortField>
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
                    <SortableHeader<NetWorthSortField>
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
                    className="grid grid-cols-2 items-start gap-x-3 gap-y-1.5 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 sm:table-row sm:p-0"
                  >
                    <td role="cell" className="col-start-1 row-start-1 p-0 text-sm font-medium text-gray-900 dark:text-gray-100 sm:table-cell sm:px-4 sm:py-3">
                      {row.name}
                    </td>
                    <td role="cell" className={`col-start-1 row-start-2 text-green-600 dark:text-green-400 ${MONEY_CELL}`}>
                      <CellLabel className={CAPTION_CLASS}>{columns.assets.label}</CellLabel>
                      {formatCurrency(row.Assets)}
                    </td>
                    <td role="cell" className={`col-start-2 row-start-2 text-red-600 dark:text-red-400 ${MONEY_CELL}`}>
                      <CellLabel className={CAPTION_CLASS}>{columns.liabilities.label}</CellLabel>
                      {formatCurrency(row.Liabilities)}
                    </td>
                    {/* Net worth takes the right of line 1 beside the month: it
                        is the figure the row is read for. Its sign colouring is
                        unchanged -- neutral at or above zero, red below. */}
                    <td role="cell" className={`col-start-2 row-start-1 font-medium ${row.NetWorth >= 0 ? 'text-gray-900 dark:text-gray-100' : 'text-red-600 dark:text-red-400'} ${MONEY_CELL}`}>
                      <CellLabel className={CAPTION_CLASS}>{columns.netWorth.label}</CellLabel>
                      {formatCurrency(row.NetWorth)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div ref={chartRef} className="h-96">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              {chartType === 'line' ? (
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorNetWorth" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={chartColors.primary} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={chartColors.primary} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
                <XAxis
                  dataKey="sortKey"
                  tick={{ fontSize: 12 }}
                  {...(xAxisTicks ? { ticks: xAxisTicks } : {})}
                  tickFormatter={formatXAxisTick}
                />
                <YAxis
                  domain={yAxisDomain}
                  tickFormatter={formatCurrencyAxis}
                  tick={{ fontSize: 12 }}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend />
                <ReferenceLine y={0} stroke={chartColors.axis} strokeDasharray="3 3" />
                <Area
                  type="monotone"
                  dataKey="NetWorth"
                  stroke={chartColors.primary}
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorNetWorth)"
                  name={t('netWorth.seriesNetWorth')}
                />
                {minMax && (
                  <ReferenceDot
                    x={minMax.max.sortKey}
                    y={minMax.max.NetWorth}
                    r={6}
                    fill={chartColors.income}
                    stroke={chartColors.surface}
                    strokeWidth={2}
                    label={{ value: formatCurrencyLabel(minMax.max.NetWorth), position: 'bottom', fontSize: 12, fill: chartColors.income, fontWeight: 600, offset: 8 }}
                  />
                )}
                {minMax && (
                  <ReferenceDot
                    x={minMax.min.sortKey}
                    y={minMax.min.NetWorth}
                    r={6}
                    fill={chartColors.expense}
                    stroke={chartColors.surface}
                    strokeWidth={2}
                    label={{ value: formatCurrencyLabel(minMax.min.NetWorth), position: 'top', fontSize: 12, fill: chartColors.expense, fontWeight: 600, offset: 8 }}
                  />
                )}
              </AreaChart>
              ) : chartType === 'stacked' ? (
              <BarChart data={chartData} stackOffset="expand" margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} vertical={false} />
                <XAxis
                  dataKey="sortKey"
                  tick={{ fontSize: 12 }}
                  {...(xAxisTicks ? { ticks: xAxisTicks } : {})}
                  tickFormatter={formatXAxisTick}
                />
                <YAxis
                  domain={[0, 1]}
                  tickFormatter={formatPercentAxis}
                  tick={{ fontSize: 12 }}
                />
                <Tooltip content={<CompositionTooltip />} />
                <Legend />
                <Bar dataKey="Assets" stackId="networth" fill={chartColors.income} name={t('netWorth.colAssets')} />
                <Bar dataKey="Liabilities" stackId="networth" fill={chartColors.expense} name={t('netWorth.colLiabilities')} radius={[4, 4, 0, 0]} />
              </BarChart>
              ) : (
              <BarChart data={chartData} margin={{ top: showBarLabels ? (barLabelsVertical ? 52 : 22) : 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} vertical={false} />
                <XAxis
                  dataKey="sortKey"
                  tick={{ fontSize: 12 }}
                  {...(xAxisTicks ? { ticks: xAxisTicks } : {})}
                  tickFormatter={formatXAxisTick}
                />
                <YAxis
                  domain={yAxisDomain}
                  tickFormatter={formatCurrencyAxis}
                  tick={{ fontSize: 12 }}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend />
                <ReferenceLine y={0} stroke={chartColors.axis} strokeDasharray="3 3" />
                <Bar dataKey="NetWorth" fill={chartColors.primary} name={t('netWorth.seriesNetWorth')} radius={[4, 4, 0, 0]}>
                  {showBarLabels && (
                    <LabelList
                      dataKey="NetWorth"
                      position="top"
                      angle={barLabelsVertical ? -90 : 0}
                      offset={barLabelsVertical ? 6 : 5}
                      textAnchor={barLabelsVertical ? 'start' : 'middle'}
                      formatter={(value: unknown) => formatCurrencyLabel(Number(value))}
                      style={{
                        fill: chartColors.axis,
                        fontSize: 11,
                        fontWeight: 600,
                        ...(barLabelsVertical && { dominantBaseline: 'central' as const }),
                      }}
                    />
                  )}
                </Bar>
              </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
