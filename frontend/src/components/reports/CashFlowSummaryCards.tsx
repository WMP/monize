'use client';

import { useTranslations } from 'next-intl';
import { PartialTotal } from '@/components/ui/PartialTotal';
import { useNumberFormat } from '@/hooks/useNumberFormat';
import type { IncomeExpenseTagBucket } from '@/types/built-in-reports';
import type { TaggedBalanceWindow } from '@/lib/tagged-balance';

interface CashFlowSummaryCardsProps {
  totals: { totalIncome: number; totalExpenses: number; netCashFlow: number };
  reportingCurrency: string;
  /**
   * The Balance view (spec section 10.9): the part of the All totals that
   * converted, the All completeness, the active tag bucket and the window's
   * Balance. Absent = the three Net Cash Flow cards exactly as before.
   */
  balance?: {
    bucket: IncomeExpenseTagBucket;
    window: TaggedBalanceWindow;
    knownIncome: number;
    knownExpenses: number;
    completeness: { missingCurrencies: string[]; excludedCount: number };
  };
}

interface Tone {
  box: string;
  label: string;
  value: string;
}

const GREEN: Tone = {
  box: 'bg-green-50 dark:bg-green-900/20',
  label: 'text-green-600 dark:text-green-400',
  value: 'text-green-700 dark:text-green-300',
};
const RED: Tone = {
  box: 'bg-red-50 dark:bg-red-900/20',
  label: 'text-red-600 dark:text-red-400',
  value: 'text-red-700 dark:text-red-300',
};
const INDIGO: Tone = {
  box: 'bg-indigo-50 dark:bg-indigo-900/20',
  label: 'text-indigo-600 dark:text-indigo-400',
  value: 'text-indigo-700 dark:text-indigo-300',
};
const BLUE: Tone = {
  box: 'bg-blue-50 dark:bg-blue-900/20',
  label: 'text-blue-600 dark:text-blue-400',
  value: 'text-blue-700 dark:text-blue-300',
};
const PURPLE: Tone = {
  box: 'bg-purple-50 dark:bg-purple-900/20',
  label: 'text-purple-600 dark:text-purple-400',
  value: 'text-purple-700 dark:text-purple-300',
};
const ORANGE: Tone = {
  box: 'bg-orange-50 dark:bg-orange-900/20',
  label: 'text-orange-600 dark:text-orange-400',
  value: 'text-orange-700 dark:text-orange-300',
};

function SummaryCard({ tone, label, children }: { tone: Tone; label: string; children: React.ReactNode }) {
  return (
    <div className={`rounded-lg p-4 sm:p-6 ${tone.box}`}>
      <div className={`text-sm ${tone.label}`}>{label}</div>
      <div className={`text-2xl font-bold ${tone.value}`}>{children}</div>
    </div>
  );
}

export function CashFlowSummaryCards({ totals, reportingCurrency, balance }: CashFlowSummaryCardsProps) {
  const t = useTranslations('reports');
  const { formatCurrencyCompact: formatCurrency, formatPercent } = useNumberFormat();

  if (balance) {
    const { bucket, window: win, knownIncome, knownExpenses, completeness } = balance;
    const bucketCompleteness = {
      missingCurrencies: bucket.missingCurrencies,
      excludedCount: bucket.excludedCount,
    };
    const known = win.balance ?? 0;
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SummaryCard tone={GREEN} label={t('cashFlow.totalInflows')}>
          <PartialTotal total={{ value: knownIncome, ...completeness }} displayCurrency={reportingCurrency}>
            {formatCurrency(knownIncome)}
          </PartialTotal>
        </SummaryCard>
        <SummaryCard tone={INDIGO} label={t('tagBreakdown.inflows')}>
          <PartialTotal total={{ value: bucket.taggedInflows, ...bucketCompleteness }} displayCurrency={reportingCurrency}>
            {formatCurrency(bucket.taggedInflows)}
          </PartialTotal>
        </SummaryCard>
        <SummaryCard tone={RED} label={t('cashFlow.totalOutflows')}>
          <PartialTotal total={{ value: knownExpenses, ...completeness }} displayCurrency={reportingCurrency}>
            {formatCurrency(knownExpenses)}
          </PartialTotal>
        </SummaryCard>
        {bucket.taggedOutflows !== 0 && (
          <SummaryCard tone={INDIGO} label={t('tagBreakdown.outflows')}>
            <PartialTotal total={{ value: bucket.taggedOutflows, ...bucketCompleteness }} displayCurrency={reportingCurrency}>
              {formatCurrency(bucket.taggedOutflows)}
            </PartialTotal>
          </SummaryCard>
        )}
        <SummaryCard tone={known >= 0 ? BLUE : ORANGE} label={t('tagBreakdown.balance')}>
          <PartialTotal
            total={{ value: known, missingCurrencies: win.missingCurrencies, excludedCount: win.excludedCount }}
            displayCurrency={reportingCurrency}
          >
            {formatCurrency(known)}
          </PartialTotal>
        </SummaryCard>
        <SummaryCard
          tone={win.balancePercent !== null && win.balancePercent < 0 ? ORANGE : PURPLE}
          label={t('tagBreakdown.balancePercent')}
        >
          {win.balancePercent === null ? '—' : formatPercent(win.balancePercent, 2)}
        </SummaryCard>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <SummaryCard tone={GREEN} label={t('cashFlow.totalInflows')}>
        {formatCurrency(totals.totalIncome)}
      </SummaryCard>
      <SummaryCard tone={RED} label={t('cashFlow.totalOutflows')}>
        {formatCurrency(totals.totalExpenses)}
      </SummaryCard>
      <SummaryCard tone={totals.netCashFlow >= 0 ? BLUE : ORANGE} label={t('cashFlow.netCashFlow')}>
        {totals.netCashFlow >= 0 ? '+' : ''}
        {formatCurrency(totals.netCashFlow)}
      </SummaryCard>
    </div>
  );
}
