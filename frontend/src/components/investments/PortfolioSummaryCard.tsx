'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { PortfolioSummary } from '@/types/investment';
import { useNumberFormat } from '@/hooks/useNumberFormat';
import { useExchangeRates } from '@/hooks/useExchangeRates';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import { gainLossColor } from '@/lib/format';

interface PortfolioSummaryCardProps {
  summary: PortfolioSummary | null;
  isLoading: boolean;
  singleAccountCurrency?: string | null;
  titleSuffix?: string;
}

export function PortfolioSummaryCard({
  summary,
  isLoading,
  singleAccountCurrency,
  titleSuffix,
}: PortfolioSummaryCardProps) {
  const t = useTranslations('investments');
  const { formatCurrency, formatSignedPercent } = useNumberFormat();
  const { convertToDefault, defaultCurrency } = useExchangeRates();

  // When viewing a single foreign-currency account, show values in that currency
  const foreignCurrency = singleAccountCurrency && singleAccountCurrency !== defaultCurrency
    ? singleAccountCurrency
    : null;

  const converted = useMemo(() => {
    if (!summary) return null;

    if (foreignCurrency) {
      // Single foreign account: use raw values without conversion. An account
      // whose market value or cost basis is unknown makes the corresponding
      // aggregate unknown -- adding only the accounts that happened to be
      // computable would put a subtotal under a total's label.
      let cash = 0;
      let netInvested = 0;
      let holdings: number | null = 0;
      let costBasis: number | null = 0;
      for (const acct of summary.holdingsByAccount) {
        cash += acct.cashBalance;
        netInvested += acct.netInvested;
        holdings =
          holdings === null || acct.totalMarketValue === null
            ? null
            : holdings + acct.totalMarketValue;
        costBasis =
          costBasis === null || acct.totalCostBasis === null
            ? null
            : costBasis + acct.totalCostBasis;
      }
      const portfolio = holdings === null ? null : cash + holdings;
      const gainLoss =
        holdings === null || costBasis === null ? null : holdings - costBasis;
      const gainLossPercent =
        gainLoss === null || costBasis === null
          ? null
          : costBasis > 0
            ? (gainLoss / costBasis) * 100
            : gainLoss === 0
              ? 0
              : null;
      return { cash, holdings, costBasis, netInvested, portfolio, gainLoss, gainLossPercent };
    }

    // Default-currency view: use the backend totals as-is. They are already
    // converted to the default currency using live spot FX -- the same rate
    // source the Portfolio Value Over Time chart uses -- so the two stay in
    // sync. Re-converting per account here with the cached daily-snapshot
    // rates from useExchangeRates drifted from the chart (and triangulated
    // through each account's currency); returning null makes every field below
    // fall back to summary.total* directly.
    return null;
  }, [summary, foreignCurrency]);

  // Compute default-currency total when showing foreign, for the "approx" line
  const defaultTotal = useMemo(() => {
    if (!summary || !foreignCurrency) return null;
    let total = 0;
    for (const acct of summary.holdingsByAccount) {
      // No approximate line at all when one account's value is unknown: an
      // approximation of a partial sum is not an approximation of the total.
      if (acct.totalMarketValue === null) return null;
      const cash = convertToDefault(acct.cashBalance, acct.currencyCode);
      const market = convertToDefault(acct.totalMarketValue, acct.currencyCode);
      // No rate: no approximate total either.
      if (cash === null || market === null) return null;
      total += cash;
      total += market;
    }
    return total;
  }, [summary, convertToDefault, foreignCurrency]);

  // An unknown figure renders as the card's existing "not available" marker,
  // never as a formatted 0.00 -- a measured zero and a value we could not work
  // out look identical once currency-formatted, and one of them is a lie.
  const notAvailable = (
    <span className="text-gray-400 dark:text-gray-500 text-sm font-normal">
      {t('portfolioSummary.notAvailable')}
    </span>
  );

  const fmtVal = (value: number | null | undefined) => {
    if (value == null) return notAvailable;
    if (foreignCurrency) return `${formatCurrency(value, foreignCurrency)} ${foreignCurrency}`;
    return formatCurrency(value);
  };

  const formatPercent = (value: number | null | undefined) =>
    value == null ? notAvailable : formatSignedPercent(value);

  const returnColorClass = (value: number | null | undefined) => {
    if (value == null) return 'text-gray-400 dark:text-gray-500';
    return gainLossColor(value);
  };

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-3 sm:p-6 lg:min-h-[420px]">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          {t('portfolioSummary.title')}{titleSuffix ? ` (${titleSuffix})` : ''}
        </h3>
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="animate-pulse">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-1" />
              <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-3 sm:p-6 lg:min-h-[420px]">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          {t('portfolioSummary.title')}{titleSuffix ? ` (${titleSuffix})` : ''}
        </h3>
        <p className="text-gray-500 dark:text-gray-400">
          {t('portfolioSummary.noData')}
        </p>
      </div>
    );
  }

  const gainLossVal = converted?.gainLoss ?? summary.totalGainLoss;
  const gainLossPercentVal = converted?.gainLossPercent ?? summary.totalGainLossPercent;
  const portfolioVal = converted ? converted.portfolio : summary.totalPortfolioValue;
  const netInvestedVal = converted ? converted.netInvested : summary.totalNetInvested;
  const totalGainVal =
    portfolioVal === null || netInvestedVal === null
      ? null
      : portfolioVal - netInvestedVal;
  const twr = summary.timeWeightedReturn;
  const cagrVal = summary.cagr;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-3 sm:p-6 lg:min-h-[420px]">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
        {t('portfolioSummary.title')}{titleSuffix ? ` (${titleSuffix})` : ''}
      </h3>

      <div className="space-y-4">
        {/* Total Portfolio Value */}
        <div>
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {t('portfolioSummary.totalPortfolioValue')}
          </div>
          <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {fmtVal(portfolioVal)}
          </div>
          {foreignCurrency && defaultTotal !== null && (
            <div className="text-xs text-gray-400 dark:text-gray-500">
              {'\u2248 '}{formatCurrency(defaultTotal, defaultCurrency)} {defaultCurrency}
            </div>
          )}
        </div>

        {/* Values Section */}
        <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
          <div className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">
            {t('portfolioSummary.values')}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
            <div>
              <div className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 flex items-center">
                {t('portfolioSummary.holdingsValue')}
                <InfoTooltip placement="top" text={t('portfolioSummary.holdingsValueTooltip')} />
              </div>
              <div className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100">
                {fmtVal(converted ? converted.holdings : summary.totalHoldingsValue)}
              </div>
            </div>
            <div>
              <div className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 flex items-center">
                {t('portfolioSummary.cashBalance')}
                <InfoTooltip placement="top" text={t('portfolioSummary.cashBalanceTooltip')} />
              </div>
              <div className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100">
                {fmtVal(converted ? converted.cash : summary.totalCashValue)}
              </div>
            </div>
            <div>
              <div className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 flex items-center">
                {t('portfolioSummary.totalGain')}
                <InfoTooltip placement="top" text={t('portfolioSummary.totalGainTooltip')} />
              </div>
              <div className={`text-base sm:text-lg font-semibold ${returnColorClass(totalGainVal)}`}>
                {fmtVal(totalGainVal)}
              </div>
            </div>
            <div>
              <div className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 flex items-center">
                {t('portfolioSummary.netInvested')}
                <InfoTooltip placement="top" text={t('portfolioSummary.netInvestedTooltip')} />
              </div>
              <div className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100">
                {fmtVal(netInvestedVal)}
              </div>
            </div>
            <div>
              <div className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 flex items-center">
                {t('portfolioSummary.costBasis')}
                <InfoTooltip placement="top" text={t('portfolioSummary.costBasisTooltip')} />
              </div>
              <div className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100">
                {fmtVal(converted ? converted.costBasis : summary.totalCostBasis)}
              </div>
            </div>
            <div>
              <div className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 flex items-center">
                {t('portfolioSummary.gainLoss')}
                <InfoTooltip placement="top" text={t('portfolioSummary.gainLossTooltip')} />
              </div>
              <div className={`text-base sm:text-lg font-semibold ${returnColorClass(gainLossVal)}`}>
                {fmtVal(gainLossVal)}
              </div>
            </div>
          </div>
        </div>

        {/* Returns Section */}
        <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
          <div className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">
            {t('portfolioSummary.returns')}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
            <div>
              <div className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 flex items-center">
                {t('portfolioSummary.simpleReturn')}
                <InfoTooltip placement="top" text={t('portfolioSummary.simpleReturnTooltip')} />
              </div>
              <div className={`text-base sm:text-lg font-semibold ${returnColorClass(gainLossPercentVal)}`}>
                {formatPercent(gainLossPercentVal)}
              </div>
            </div>
            <div>
              <div className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 flex items-center">
                {t('portfolioSummary.twr')}
                <span className="hidden sm:inline">&nbsp;{t('portfolioSummary.twrFull')}</span>
                <InfoTooltip placement="top" text={t('portfolioSummary.twrTooltip')} />
              </div>
              <div className={`text-base sm:text-lg font-semibold ${returnColorClass(twr)}`}>
                {formatPercent(twr)}
              </div>
            </div>
            <div>
              <div className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 flex items-center">
                {t('portfolioSummary.cagr')}
                <InfoTooltip placement="top" text={t('portfolioSummary.cagrTooltip')} />
              </div>
              <div className={`text-base sm:text-lg font-semibold ${returnColorClass(cagrVal)}`}>
                {formatPercent(cagrVal)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
