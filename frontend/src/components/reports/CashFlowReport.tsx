"use client";

import { useMemo, useRef, useState } from "react";
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
import type { Account } from "@/types/account";
import { accountsApi } from "@/lib/accounts";
import { usePersistedAccountFilter } from "@/hooks/usePersistedAccountFilter";
import { ReportAccountMultiSelect } from "@/components/reports/ReportAccountMultiSelect";
import {
  IncomeExpensePeriodItem,
  CategorySpendingItem,
  IncomeSourceItem,
} from "@/types/built-in-reports";
import { useNumberFormat } from "@/hooks/useNumberFormat";
import { useChartDateFormat } from "@/hooks/useChartDateFormat";
import { useDateRange } from "@/hooks/useDateRange";
import { useReportData } from "@/hooks/useReportData";
import { DateRangeSelector } from "@/components/ui/DateRangeSelector";
import { ReportToolbarActions } from '@/components/reports/ReportToolbarActions';
import { ChartTooltip } from "@/components/reports/ChartTooltip";
import { ReportError } from "@/components/reports/ReportError";
import { chartColors } from "@/lib/chart-colors";
import { useTranslations } from 'next-intl';
import { useExchangeRates } from "@/hooks/useExchangeRates";
import { useTagKeys } from "@/hooks/useTagKeys";
import { TagKeyBreakdownSelect } from "@/components/reports/TagKeyBreakdownSelect";
import { TagKeyBreakdownBuckets } from "@/components/reports/TagKeyBreakdownBuckets";
import { StackTaggedFlowsToggle } from "@/components/reports/StackTaggedFlowsToggle";
import { useTaggedFlowBucket } from "@/hooks/useTaggedFlowBucket";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { flowBarStack } from "@/lib/tagged-flow-stack";

const ACCOUNTS_STORAGE_KEY = 'monize-reports-cash-flow-accounts';
const STACK_FLOWS_STORAGE_KEY = 'monize-reports-cash-flow-stack-tagged';

// Same account list Income vs Expenses offers: an investment account's cash
// legs are excluded from these reports by linkage.
const nonInvestmentAccounts = (a: Account) => a.accountType !== 'INVESTMENT';

interface ChartDataItem {
  name: string;
  fullName: string;
  Income: number;
  Expenses: number;
  Net: number;
  /** Tagged transfer flows of the active bucket; absent when no flow series is shown. */
  TaggedInflows?: number;
  TaggedOutflows?: number;
  monthStart: string;
  monthEnd: string;
}

export function CashFlowReport() {
  const t = useTranslations('reports');
  const router = useRouter();
  const chartRef = useRef<HTMLDivElement>(null);
  const { formatCurrencyCompact: formatCurrency, formatCurrencyAxis } =
    useNumberFormat();
  const formatChartDate = useChartDateFormat();
  const { defaultCurrency } = useExchangeRates();
  const {
    dateRange,
    setDateRange,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    resolvedRange,
    isValid,
  } = useDateRange({ defaultRange: "6m", alignment: "month" });
  const tagKeys = useTagKeys();
  const [tagKey, setTagKey] = useState('');
  // Which tag-key bucket is selected. Owned here so the main chart can follow
  // the tab; TagKeyBreakdownBuckets is controlled by it.
  const [activeBucketValue, setActiveBucketValue] = useState('');

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
    async () => {
      if (!isValid) return null;
      // All three reads take the same account scope, or the cards, the chart
      // and the two category lists would describe different sets of accounts.
      const params = {
        startDate: rangeStart || undefined,
        endDate: rangeEnd,
        ...(selectedAccountIds.length > 0 ? { accountIds: selectedAccountIds } : {}),
      };
      // Fetch all data in parallel
      const [cashFlowResponse, incomeResponse, spendingResponse] =
        await Promise.all([
          builtInReportsApi.getCashFlow({
            ...params,
            ...(tagKey ? { tagKey } : {}),
          }),
          builtInReportsApi.getIncomeBySource(params),
          builtInReportsApi.getSpendingByCategory(params),
        ]);
      return { cashFlowResponse, incomeResponse, spendingResponse };
    },
    [isValid, rangeStart, rangeEnd, tagKey, accountIdsKey],
  );

  const { activeBucket, flowBucket, flowsByPeriod } = useTaggedFlowBucket(
    response?.cashFlowResponse,
    activeBucketValue,
  );
  const showFlows = flowBucket !== undefined;
  // Opt-in, off by default; presentation only (net and the cards never read it).
  const [stackFlowsPref, setStackFlowsPref] = useLocalStorage<boolean>(
    STACK_FLOWS_STORAGE_KEY,
    false,
  );
  const stackFlows = showFlows && stackFlowsPref === true;

  // Map monthly data. `name` must be unique across the dataset (used as
  // the XAxis category key); a non-unique value like "May" causes Recharts
  // to resolve the tooltip's payload to the first matching row, showing data
  // from the wrong year on multi-year ranges.
  const monthlyData = useMemo<ChartDataItem[]>(
    () =>
      (response?.cashFlowResponse.data ?? []).map((item: IncomeExpensePeriodItem) => {
        return {
          name: item.period,
          fullName: formatChartDate(parseISO(item.periodStart), "MMM yyyy"),
          Income: Math.round(item.income),
          Expenses: Math.round(item.expenses),
          Net: Math.round(item.net),
          // Flows ride beside the bars and never enter income, expenses or net
          // (INV-REPORT-003). A period the bucket has no row for had no tagged
          // transfer in it, which is a known zero.
          ...(flowBucket
            ? {
                TaggedInflows: Math.round(flowsByPeriod.get(item.period)?.taggedInflows ?? 0),
                TaggedOutflows: Math.round(flowsByPeriod.get(item.period)?.taggedOutflows ?? 0),
              }
            : {}),
          // The dates the bucket covers come from the server that chose it.
          monthStart: item.periodStart,
          monthEnd: item.periodEnd,
        };
      }),
    [response, formatChartDate, flowBucket, flowsByPeriod],
  );

  const incomeItems = useMemo<IncomeSourceItem[]>(
    () => response?.incomeResponse.data ?? [],
    [response],
  );
  const expenseItems = useMemo<CategorySpendingItem[]>(
    () => response?.spendingResponse.data ?? [],
    [response],
  );
  const totals = useMemo(
    () => ({
      totalIncome: response?.cashFlowResponse.totals.income ?? 0,
      totalExpenses: response?.cashFlowResponse.totals.expenses ?? 0,
      netCashFlow: response?.cashFlowResponse.totals.net ?? 0,
    }),
    [response],
  );
  const reportingCurrency = response?.cashFlowResponse.currency ?? defaultCurrency;

  const handleExportPdf = async () => {
    const { exportToPdf } = await import("@/lib/pdf-export");

    const inflowRows = incomeItems.map((item) => [item.categoryName, formatCurrency(item.total)]);
    const outflowRows = expenseItems.map((item) => [item.categoryName, formatCurrency(item.total)]);

    await exportToPdf({
      title: t('cashFlow.monthlyCashFlow'),
      summaryCards: [
        { label: t('cashFlow.totalInflows'), value: formatCurrency(totals.totalIncome), color: "#16a34a" },
        { label: t('cashFlow.totalOutflows'), value: formatCurrency(totals.totalExpenses), color: "#dc2626" },
        { label: t('cashFlow.netCashFlow'), value: `${totals.netCashFlow >= 0 ? "+" : ""}${formatCurrency(totals.netCashFlow)}`, color: totals.netCashFlow >= 0 ? "#2563eb" : "#ea580c" },
      ],
      chartContainer: chartRef.current,
      additionalTables: [
        ...(inflowRows.length > 0 ? [{
          title: t('cashFlow.inflowsByCategory'),
          headers: ["Category", "Amount"],
          rows: inflowRows,
          totalRow: [t('cashFlow.totalInflows'), formatCurrency(totals.totalIncome)],
        }] : []),
        ...(outflowRows.length > 0 ? [{
          title: t('cashFlow.outflowsByCategory'),
          headers: ["Category", "Amount"],
          rows: outflowRows,
          totalRow: [t('cashFlow.totalOutflows'), formatCurrency(totals.totalExpenses)],
        }] : []),
      ],
      filename: "cash-flow",
    });
  };

  const handleChartClick = (state: any) => {
    const label = state?.activeLabel;
    if (!label) return;
    const item = monthlyData.find((d) => d.name === label);
    if (item?.monthStart && item?.monthEnd) {
      router.push(
        `/transactions?startDate=${item.monthStart}&endDate=${item.monthEnd}`,
      );
    }
  };

  const handleCategoryClick = (categoryId: string | null) => {
    if (!categoryId) return;
    const { start, end } = resolvedRange;
    const params = new URLSearchParams();
    params.set("categoryId", categoryId);
    if (start) params.set("startDate", start);
    if (end) params.set("endDate", end);
    router.push(`/transactions?${params.toString()}`);
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
      payload: { fullName: string };
    }>;
  }) => (
    <ChartTooltip
      active={active}
      label={payload?.[0]?.payload?.fullName}
      payload={payload}
      formatValue={(v) => formatCurrency(v)}
    />
  );

  // Loading and error render inside this tree, never as an early return: a
  // second tree unmounts the controls block and ejects focus from the date
  // field being typed into (issue #1201).
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
        <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4 sm:p-6">
          <div className="text-sm text-green-600 dark:text-green-400">
            {t('cashFlow.totalInflows')}
          </div>
          <div className="text-2xl font-bold text-green-700 dark:text-green-300">
            {formatCurrency(totals.totalIncome)}
          </div>
        </div>
        <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4 sm:p-6">
          <div className="text-sm text-red-600 dark:text-red-400">
            {t('cashFlow.totalOutflows')}
          </div>
          <div className="text-2xl font-bold text-red-700 dark:text-red-300">
            {formatCurrency(totals.totalExpenses)}
          </div>
        </div>
        <div
          className={`rounded-lg p-4 sm:p-6 ${
            totals.netCashFlow >= 0
              ? "bg-blue-50 dark:bg-blue-900/20"
              : "bg-orange-50 dark:bg-orange-900/20"
          }`}
        >
          <div
            className={`text-sm ${
              totals.netCashFlow >= 0
                ? "text-blue-600 dark:text-blue-400"
                : "text-orange-600 dark:text-orange-400"
            }`}
          >
            {t('cashFlow.netCashFlow')}
          </div>
          <div
            className={`text-2xl font-bold ${
              totals.netCashFlow >= 0
                ? "text-blue-700 dark:text-blue-300"
                : "text-orange-700 dark:text-orange-300"
            }`}
          >
            {totals.netCashFlow >= 0 ? "+" : ""}
            {formatCurrency(totals.netCashFlow)}
          </div>
        </div>
      </div>
      )}

      {/* Controls -- always rendered so focus inside DateInput survives reloads.
          It sits between the cards and the chart, and both of those change with
          the data, so it can only stay mounted if this is the one tree the
          component ever returns. */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-4">
        <div className="flex flex-wrap gap-4 items-center justify-between">
          <ReportAccountMultiSelect
            accounts={offeredAccounts}
            value={selectedAccountIds}
            onChange={setSelectedAccountIds}
            filter={nonInvestmentAccounts}
          />
          <DateRangeSelector
            ranges={["3m", "6m", "1y"]}
            value={dateRange}
            onChange={setDateRange}
            showCustom
            customStartDate={startDate}
            onCustomStartDateChange={setStartDate}
            customEndDate={endDate}
            onCustomEndDateChange={setEndDate}
          />
          <TagKeyBreakdownSelect tagKeys={tagKeys} value={tagKey} onChange={setTagKey} />
          {showFlows && (
            <StackTaggedFlowsToggle checked={stackFlows} onChange={setStackFlowsPref} />
          )}
          <ReportToolbarActions onExportPdf={handleExportPdf} />
        </div>
      </div>

      {error ? (
        <ReportError onRetry={reload} />
      ) : isLoading ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-6">
          <div className="space-y-4">
            <Skeleton className="h-8 w-1/3" />
            <Skeleton className="h-64 w-full" />
          </div>
        </div>
      ) : (
        <>
      {/* Monthly Chart */}
      <div ref={chartRef} className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 px-2 py-4 sm:p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 px-1 sm:px-0">
          {t('cashFlow.monthlyCashFlow')}
        </h3>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <BarChart
              data={monthlyData}
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
                fill={chartColors.income}
                name={t('cashFlow.seriesInflows')}
                {...flowBarStack(stackFlows, 'inflows', 'base')}
              />
              <Bar
                dataKey="Expenses"
                fill={chartColors.expense}
                name={t('cashFlow.seriesOutflows')}
                {...flowBarStack(stackFlows, 'outflows', 'base')}
              />
              {/* The funding series: the active tag bucket's transfer flows, in
                  the indigo pair the breakdown card uses so they never read as
                  income or expenses. Absent without a tag key or on the
                  untagged tab. */}
              {flowBucket && (
                <Bar
                  dataKey="TaggedInflows"
                  fill={chartColors.inflow}
                  name={t('tagBreakdown.inflowsSeries', { value: flowBucket.value })}
                  {...flowBarStack(stackFlows, 'inflows', 'tagged')}
                />
              )}
              {flowBucket && (
                <Bar
                  dataKey="TaggedOutflows"
                  fill={chartColors.outflow}
                  name={t('tagBreakdown.outflowsSeries', { value: flowBucket.value })}
                  {...flowBarStack(stackFlows, 'outflows', 'tagged')}
                />
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Breakdown Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Inflows */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 overflow-hidden">
          <div className="px-6 py-4 bg-green-50 dark:bg-green-900/20 border-b border-gray-200 dark:border-gray-700">
            <h3 className="text-lg font-semibold text-green-700 dark:text-green-300">
              {t('cashFlow.inflowsByCategory')}
            </h3>
          </div>
          <div className="divide-y divide-gray-200 dark:divide-gray-700 max-h-96 overflow-y-auto">
            {incomeItems.length === 0 ? (
              <p className="px-6 py-4 text-gray-500 dark:text-gray-400">
                {t('cashFlow.noIncome')}
              </p>
            ) : (
              incomeItems.map((item, index) => (
                <div
                  key={index}
                  className={`px-6 py-3 flex items-center justify-between ${item.categoryId ? "cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50" : ""}`}
                  onClick={() => handleCategoryClick(item.categoryId)}
                >
                  <span className="text-gray-900 dark:text-gray-100">
                    {item.categoryName}
                  </span>
                  <span className="font-medium text-green-600 dark:text-green-400">
                    {formatCurrency(item.total)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Outflows */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 overflow-hidden">
          <div className="px-6 py-4 bg-red-50 dark:bg-red-900/20 border-b border-gray-200 dark:border-gray-700">
            <h3 className="text-lg font-semibold text-red-700 dark:text-red-300">
              {t('cashFlow.outflowsByCategory')}
            </h3>
          </div>
          <div className="divide-y divide-gray-200 dark:divide-gray-700 max-h-96 overflow-y-auto">
            {expenseItems.length === 0 ? (
              <p className="px-6 py-4 text-gray-500 dark:text-gray-400">
                {t('cashFlow.noExpenses')}
              </p>
            ) : (
              expenseItems.map((item, index) => (
                <div
                  key={index}
                  className={`px-6 py-3 flex items-center justify-between ${item.categoryId ? "cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50" : ""}`}
                  onClick={() => handleCategoryClick(item.categoryId)}
                >
                  <span className="text-gray-900 dark:text-gray-100">
                    {item.categoryName}
                  </span>
                  <span className="font-medium text-red-600 dark:text-red-400">
                    {formatCurrency(item.total)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
        </>
      )}

      {!isLoading && !error && response?.cashFlowResponse.tagKey && response.cashFlowResponse.buckets && (
        <TagKeyBreakdownBuckets
          tagKey={response.cashFlowResponse.tagKey}
          buckets={response.cashFlowResponse.buckets}
          reportingCurrency={reportingCurrency}
          idPrefix="cash-flow-tag"
          activeValue={activeBucket?.value}
          onActiveValueChange={setActiveBucketValue}
        />
      )}
    </div>
  );
}
