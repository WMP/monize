'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { budgetsApi } from '@/lib/budgets';
import type { Budget, SeasonalPattern } from '@/types/budget';
import { useNumberFormat } from '@/hooks/useNumberFormat';
import { ExportDropdown } from '@/components/ui/ExportDropdown';
import { SortableHeader } from '@/components/ui/SortableHeader';
import { useSortableTable, compareValues } from '@/hooks/useSortableTable';
import { createLogger } from '@/lib/logger';

const logger = createLogger('BudgetSeasonalPatternsReport');

type SeasonalPatternsSortField = 'category' | 'typical' | 'highMonths';

export function BudgetSeasonalPatternsReport() {
  const { formatCurrencyCompact: formatCurrency } = useNumberFormat();
  const chartRef = useRef<HTMLDivElement>(null);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [selectedBudgetId, setSelectedBudgetId] = useState<string>('');
  const [patterns, setPatterns] = useState<SeasonalPattern[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const { sortField, sortDirection, handleSort } = useSortableTable<SeasonalPatternsSortField>(
    'reports.budget-seasonal-patterns.sort',
    { field: 'typical', direction: 'desc' },
  );

  const sortedPatterns = useMemo(() => {
    const sorted = [...patterns];
    sorted.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'category':
          comparison = compareValues(a.categoryName, b.categoryName);
          break;
        case 'typical':
          comparison = compareValues(a.typicalMonthlySpend, b.typicalMonthlySpend);
          break;
        case 'highMonths':
          comparison = compareValues(a.highMonths.length, b.highMonths.length);
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    return sorted;
  }, [patterns, sortField, sortDirection]);

  useEffect(() => {
    const loadBudgets = async () => {
      try {
        const data = await budgetsApi.getAll();
        setBudgets(data);
        const active = data.find((b) => b.isActive);
        if (active) {
          setSelectedBudgetId(active.id);
        } else if (data.length > 0) {
          setSelectedBudgetId(data[0].id);
        }
      } catch (error) {
        logger.error('Failed to load budgets:', error);
      }
    };
    loadBudgets();
  }, []);

  const loadPatterns = useCallback(async () => {
    if (!selectedBudgetId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const data = await budgetsApi.getSeasonalPatterns(selectedBudgetId);
      setPatterns(data);
      if (data.length > 0 && !selectedCategory) {
        setSelectedCategory(data[0].categoryId);
      }
    } catch (error) {
      logger.error('Failed to load seasonal patterns:', error);
    } finally {
      setIsLoading(false);
    }
  }, [selectedBudgetId, selectedCategory]);

  useEffect(() => {
    loadPatterns();
  }, [loadPatterns]);

  const activePattern = useMemo(
    () => patterns.find((p) => p.categoryId === selectedCategory),
    [patterns, selectedCategory],
  );

  const chartData = useMemo(() => {
    if (!activePattern) return [];
    return activePattern.monthlyAverages.map((m) => ({
      month: m.monthName.substring(0, 3),
      amount: m.average,
      isHigh: activePattern.highMonths.includes(m.month),
    }));
  }, [activePattern]);

  const handleExportPdf = async () => {
    const { exportToPdf } = await import('@/lib/pdf-export');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const headers = ['Category', 'Typical/Mo', 'High Months'];
    const rows = patterns.map((p) => [
      p.categoryName,
      formatCurrency(p.typicalMonthlySpend),
      p.highMonths.length > 0
        ? p.highMonths.map((m) => monthNames[m - 1]).join(', ')
        : 'None detected',
    ]);
    await exportToPdf({
      title: 'Budget Seasonal Patterns',
      chartContainer: chartRef.current,
      tableData: { headers, rows },
      filename: 'budget-seasonal-patterns',
    });
  };

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-6">
        <div className="space-y-4">
          <Skeleton className="h-8 w-1/3" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (budgets.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-6 text-center">
        <p className="text-gray-500 dark:text-gray-400">
          No budgets found. Create a budget to see seasonal patterns.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-4">
        <div className="flex flex-wrap gap-3 items-center justify-between">
          <div className="flex flex-wrap gap-3 items-center">
            <select
              value={selectedBudgetId}
              onChange={(e) => {
                setSelectedBudgetId(e.target.value);
                setSelectedCategory('');
              }}
              className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            >
              {budgets.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            {patterns.length > 0 && (
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              >
                {patterns.map((p) => (
                  <option key={p.categoryId} value={p.categoryId}>
                    {p.categoryName}
                  </option>
                ))}
              </select>
            )}
          </div>
          <ExportDropdown onExportPdf={handleExportPdf} />
        </div>
      </div>

      {patterns.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-6 text-center">
          <p className="text-gray-500 dark:text-gray-400">
            Not enough historical data to detect seasonal patterns.
          </p>
        </div>
      ) : activePattern ? (
        <>
          {/* Chart */}
          <div ref={chartRef} className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {activePattern.categoryName} - Monthly Spending
              </h2>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                Typical: {formatCurrency(activePattern.typicalMonthlySpend)}/mo
              </span>
            </div>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tickFormatter={(v) => formatCurrency(v)} tick={{ fontSize: 12 }} />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload || payload.length === 0) return null;
                      const data = payload[0].payload;
                      return (
                        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3">
                          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{label}</p>
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            {formatCurrency(data.amount)}
                          </p>
                          {data.isHigh && (
                            <p className="text-xs text-red-500 mt-1">High spending month</p>
                          )}
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="amount" radius={[4, 4, 0, 0]}>
                    {chartData.map((entry, index) => (
                      <Cell
                        key={index}
                        fill={entry.isHigh ? '#ef4444' : '#3b82f6'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            {activePattern.highMonths.length > 0 && (
              <div className="mt-3 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <div className="w-3 h-3 rounded-sm bg-red-500" />
                <span>High spending months (above typical + 1.5 std dev)</span>
              </div>
            )}
          </div>

          {/* All Categories Summary */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-4 sm:p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              All Category Patterns
            </h2>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <SortableHeader<SeasonalPatternsSortField>
                      field="category"
                      sortField={sortField}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                      className="py-2 pr-4 font-medium text-gray-500 dark:text-gray-400"
                    >
                      Category
                    </SortableHeader>
                    <SortableHeader<SeasonalPatternsSortField>
                      field="typical"
                      sortField={sortField}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                      align="right"
                      className="py-2 pr-4 font-medium text-gray-500 dark:text-gray-400"
                    >
                      Typical/Mo
                    </SortableHeader>
                    <SortableHeader<SeasonalPatternsSortField>
                      field="highMonths"
                      sortField={sortField}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                      className="py-2 font-medium text-gray-500 dark:text-gray-400"
                    >
                      High Months
                    </SortableHeader>
                  </tr>
                </thead>
                <tbody>
                  {sortedPatterns.map((p) => (
                    <tr
                      key={p.categoryId}
                      onClick={() => setSelectedCategory(p.categoryId)}
                      className={`border-b border-gray-100 dark:border-gray-700/50 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${
                        p.categoryId === selectedCategory ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                      }`}
                    >
                      <td className="py-2 pr-4 text-gray-900 dark:text-gray-100">{p.categoryName}</td>
                      <td className="py-2 pr-4 text-right text-gray-600 dark:text-gray-400">
                        {formatCurrency(p.typicalMonthlySpend)}
                      </td>
                      <td className="py-2">
                        {p.highMonths.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {p.highMonths.map((m) => {
                              const monthName = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1];
                              return (
                                <span
                                  key={m}
                                  className="px-1.5 py-0.5 text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 rounded"
                                >
                                  {monthName}
                                </span>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="text-gray-400 dark:text-gray-500 text-xs">None detected</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
