'use client';

import { useTranslations } from 'next-intl';
import { addKnown } from '@/lib/partial-sum';
import { SummaryCardGrid, SummaryCardItem } from '@/components/accounts/shared/SummaryCardGrid';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useNumberFormat } from '@/hooks/useNumberFormat';
import type { DisplayCurrencyStrategy } from '@/components/transactions/widget-shared';
import type { PayeeDetail } from '@/types/payee';

/** Income/expense totals reduced to the display currency. */
export interface PayeePeriodTotals {
  // `null` when a contributing currency has no rate to the display currency:
  // these are headline figures, so a partial sum under them would be a subtotal
  // wearing a total's name.
  income: number | null;
  expenses: number | null;
  net: number | null;
}

/** The payee's dominant detected cadence, with its latest and previous amounts. */
export interface PayeeRecurringSummary {
  cadence: string;
  amount: number;
  previousAmount: number;
}

interface PayeeSummaryCardsProps {
  detail: PayeeDetail;
  /** Lifetime totals; decides the spending vs income framing. */
  lifetimeTotals: PayeePeriodTotals | null;
  /** Jan 1 to today. */
  thisYearTotals: PayeePeriodTotals | null;
  /** Jan 1 to the same date, one year earlier. */
  lastYearTotals: PayeePeriodTotals | null;
  recurring: PayeeRecurringSummary | null;
  currencyStrategy: DisplayCurrencyStrategy;
  /** True when the summaries span more than one currency (figures converted). */
  isMultiCurrency: boolean;
  /** Apply-default-category flow for the Uncategorized card. */
  onUncategorizedClick: () => void;
}

/**
 * The key-figure row. For a payee that mostly pays the user (an employer, a
 * pension), the headline flips from "Spent this year" to "Received this year"
 * -- calling a salary "spending" and colouring it red reads as a bug.
 */
export function PayeeSummaryCards({
  detail,
  lifetimeTotals,
  thisYearTotals,
  lastYearTotals,
  recurring,
  currencyStrategy,
  isMultiCurrency,
  onUncategorizedClick,
}: PayeeSummaryCardsProps) {
  const t = useTranslations('payeeDetail');
  const { formatCurrency, formatSignedPercent } = useNumberFormat();
  const { formatDate } = useDateFormat();

  const { stats, payee } = detail;
  const displayCurrency = currencyStrategy.displayCurrency;

  // Unknown totals cannot settle "is this an income payee", so it stays false
  // (the expense reading) rather than being guessed from a substituted zero.
  const isIncomePayee =
    lifetimeTotals !== null &&
    lifetimeTotals.income !== null &&
    lifetimeTotals.expenses !== null &&
    lifetimeTotals.income > lifetimeTotals.expenses;

  const headlineOf = (totals: PayeePeriodTotals | null) =>
    totals === null ? null : isIncomePayee ? totals.income : totals.expenses;

  const thisYear = headlineOf(thisYearTotals);
  const lastYear = headlineOf(lastYearTotals);

  // Year-over-year, same window: Jan 1 to today vs Jan 1 to today last year.
  const yoyNote = (() => {
    if (thisYear === null || lastYear === null) return undefined;
    if (lastYear === 0) {
      return thisYear === 0 ? undefined : t('summary.vsLastYearNew');
    }
    const percent = ((thisYear - lastYear) / lastYear) * 100;
    return t('summary.vsLastYear', { percent: formatSignedPercent(percent) });
  })();

  const averageTransaction = (() => {
    if (lifetimeTotals === null || stats.transactionCount <= 0) return null;
    // Unknown in, unknown out.
    const combined = addKnown(lifetimeTotals.income, lifetimeTotals.expenses);
    return combined === null ? null : combined / stats.transactionCount;
  })();

  const firstYear = stats.firstTransactionDate?.slice(0, 4) ?? null;

  const priceChangeNote = (() => {
    if (!recurring || recurring.previousAmount === recurring.amount) return undefined;
    const key = recurring.amount > recurring.previousAmount ? 'summary.priceUp' : 'summary.priceDown';
    return t(key, {
      amount: formatCurrency(recurring.previousAmount, displayCurrency),
    });
  })();

  const convertedNote = isMultiCurrency
    ? t('summary.convertedNote', { currency: displayCurrency })
    : undefined;

  const cards: SummaryCardItem[] = [
    {
      label: isIncomePayee ? t('summary.receivedThisYear') : t('summary.spentThisYear'),
      value:
        thisYear !== null ? formatCurrency(thisYear, displayCurrency) : '—',
      valueClass: isIncomePayee
        ? 'text-green-600 dark:text-green-400'
        : 'text-red-600 dark:text-red-400',
      note: yoyNote ?? convertedNote,
    },
    {
      label: t('summary.averageTransaction'),
      value:
        averageTransaction !== null
          ? formatCurrency(averageTransaction, displayCurrency)
          : '—',
      note: convertedNote,
    },
    {
      label: t('summary.transactions'),
      value: stats.transactionCount.toLocaleString(),
      note: firstYear ? t('summary.sinceYear', { year: firstYear }) : undefined,
    },
    {
      label: t('summary.lastTransaction'),
      value: stats.lastTransactionDate ? formatDate(stats.lastTransactionDate) : '—',
    },
  ];

  if (recurring) {
    cards.push({
      label: t('summary.recurring'),
      value: t('summary.recurringValue', {
        cadence: t(`cadence.${recurring.cadence}`),
        amount: formatCurrency(recurring.amount, displayCurrency),
      }),
      note: priceChangeNote,
    });
  }

  if (stats.uncategorizedCount > 0) {
    cards.push({
      label: t('summary.uncategorized'),
      value: stats.uncategorizedCount.toLocaleString(),
      valueClass: 'text-yellow-600 dark:text-yellow-400',
      note: payee.defaultCategoryId
        ? t('summary.uncategorizedApply')
        : t('summary.uncategorizedSetDefault'),
      onClick: onUncategorizedClick,
    });
  }

  return (
    <SummaryCardGrid
      cards={cards}
      className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4"
    />
  );
}
