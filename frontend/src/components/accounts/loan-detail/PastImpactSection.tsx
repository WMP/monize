'use client';

import { useTranslations } from 'next-intl';
import { Account } from '@/types/account';
import { PastImpactResult } from '@/lib/loan-past-impact';
import { useNumberFormat } from '@/hooks/useNumberFormat';
import { useChartDateFormat } from '@/hooks/useChartDateFormat';
import { SummaryCardGrid, SummaryCardItem } from '@/components/accounts/shared/SummaryCardGrid';

interface PastImpactSectionProps {
  account: Account;
  /**
   * Precomputed by the parent, which also feeds `originalSchedule` into the
   * payoff chart's contractual curve -- so the "already saved" figures here and
   * the actual-vs-contractual gap on that chart come from the same source.
   */
  impact: PastImpactResult | null;
}

/**
 * How overpayments already made have shortened the loan -- extra principal
 * paid, months saved, and interest saved versus the original contractual
 * schedule -- shown as a plain card row that continues the summary figures
 * above it. The balance-over-time comparison lives in the shared payoff chart.
 */
export function PastImpactSection({ account, impact }: PastImpactSectionProps) {
  const t = useTranslations('accounts');
  const formatChartDate = useChartDateFormat();
  const { formatCurrency } = useNumberFormat();

  if (!impact) return null;

  const formatMonth = (date: string | null) =>
    date ? formatChartDate(date, 'MMM yyyy') : t('loanDetail.pastImpact.unknown');

  const cards: SummaryCardItem[] = [
    {
      label: t('loanDetail.pastImpact.extraPrincipalPaid'),
      value: formatCurrency(impact.extraPrincipalPaid, account.currencyCode),
      valueClass: 'text-blue-600 dark:text-blue-400',
      note: t('loanDetail.pastImpact.extraPrincipalNote'),
    },
    {
      label: t('loanDetail.pastImpact.monthsAlreadySaved'),
      // Null when the loan is outstanding but has no current projection (e.g.
      // paymentAmount not yet configured) -- the remaining term is unknown, so
      // this must read as "not available", never as 0 months saved.
      value:
        impact.monthsAlreadySaved != null
          ? t('loanDetail.pastImpact.monthsValue', { count: impact.monthsAlreadySaved })
          : t('loanDetail.summary.notAvailable'),
      valueClass: 'text-green-600 dark:text-green-400',
      note: t('loanDetail.pastImpact.payoffComparison', {
        original: formatMonth(impact.originalPayoffDate),
        current: formatMonth(impact.currentPayoffDate),
      }),
    },
    {
      label: t('loanDetail.pastImpact.interestAlreadySaved'),
      // Same unknown case as above: an outstanding loan with no projection has
      // unknown remaining interest, so it must not render as a measured 0 or
      // any other computed figure.
      value:
        impact.interestAlreadySaved != null
          ? formatCurrency(impact.interestAlreadySaved, account.currencyCode)
          : t('loanDetail.summary.notAvailable'),
      valueClass: 'text-green-600 dark:text-green-400',
      note: t('loanDetail.pastImpact.vsOriginalInterest', {
        amount: formatCurrency(impact.originalSchedule.totalInterest, account.currencyCode),
      }),
    },
  ];

  return <SummaryCardGrid cards={cards} className="grid grid-cols-2 md:grid-cols-3 gap-4" />;
}
