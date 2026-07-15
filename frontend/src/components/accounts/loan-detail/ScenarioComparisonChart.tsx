'use client';

import { useTranslations } from 'next-intl';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { chartColors } from '@/lib/chart-colors';
import { useChartDateFormat } from '@/hooks/useChartDateFormat';
import { useNumberFormat } from '@/hooks/useNumberFormat';
import { ChartTooltip } from '@/components/reports/ChartTooltip';

export interface ScenarioOutcome {
  id: string;
  name: string;
  /** Total remaining interest under this scenario */
  totalInterest: number;
  /** Projected payoff date (yyyy-MM-dd), or null when not paid off in range */
  payoffDate: string | null;
  /** True for the no-overpayment baseline reference bar */
  isBaseline?: boolean;
}

interface ScenarioComparisonChartProps {
  outcomes: ScenarioOutcome[];
  currencyCode: string;
}

/**
 * Compares saved overpayment scenarios (plus the no-overpayment baseline) side
 * by side: bar height is the total interest each would cost, and each bar is
 * labelled with its payoff date, so the interest/time trade-off between saved
 * simulations is visible at a glance. Rendered only when more than one scenario
 * is saved.
 */
export function ScenarioComparisonChart({
  outcomes,
  currencyCode,
}: ScenarioComparisonChartProps) {
  const t = useTranslations('accounts');
  const formatChartDate = useChartDateFormat();
  const { formatCurrency, formatCurrencyAxis } = useNumberFormat();

  const data = outcomes.map((o) => ({
    name: o.name,
    interest: o.totalInterest,
    payoffLabel: o.payoffDate ? formatChartDate(o.payoffDate, 'MMM yyyy') : '—',
    isBaseline: o.isBaseline ?? false,
  }));

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-6">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
        {t('loanDetail.scenarioChart.title')}
      </h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        {t('loanDetail.scenarioChart.description')}
      </p>
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <BarChart data={data} margin={{ top: 24, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} />
            <YAxis tickFormatter={formatCurrencyAxis} tick={{ fontSize: 12 }} />
            <Tooltip
              content={
                <ChartTooltip
                  formatValue={(value) => formatCurrency(value, currencyCode)}
                  extra={(point) => (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                      {t('loanDetail.scenarioChart.payoffTooltip', {
                        date: (point as { payoffLabel?: string }).payoffLabel ?? '—',
                      })}
                    </p>
                  )}
                />
              }
            />
            <Bar dataKey="interest" name={t('loanDetail.scenarioChart.interestSeries')} radius={[4, 4, 0, 0]}>
              {data.map((entry, index) => (
                <Cell
                  key={index}
                  fill={entry.isBaseline ? chartColors.axis : chartColors.primary}
                />
              ))}
              <LabelList
                dataKey="payoffLabel"
                position="top"
                style={{ fontSize: 11, fill: chartColors.axis }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
