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
      // Single foreign account: use raw values without conversion
      let cash = 0;
      let holdings = 0;
      let costBasis = 0;
      let netInvested = 0;
      for (const acct of summary.holdingsByAccount) {
        cash += acct.cashBalance;
        holdings += acct.totalMarketValue;
        costBasis += acct.totalCostBasis;
        netInvested += acct.netInvested;
      }
      const portfolio = cash + holdings;
      const gainLoss = holdings - costBasis;
      const gainLossPercent = costBasis > 0 ? (gainLoss / costBasis) * 100 : 0;
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

  // Compute default-currency total when showing foreign, for the "approx" line.
  // `null` when any account has no rate: the line says "approximately", not
  // "approximately, minus the accounts we could not convert".
  const defaultTotal = useMemo(() => {
    if (!summary || !foreignCurrency) return null;
    let total = 0;
    for (const acct of summary.holdingsByAccount) {
      const cash = convertToDefault(acct.cashBalance, acct.currencyCode);
      const holdings = convertToDefault(acct.totalMarketValue, acct.currencyCode);
      if (cash === null || holdings === null) return null;
      total += cash + holdings;
    }
    return total;
  }, [summary, convertToDefault, foreignCurrency]);

  /**
   * Holdings the server could not price.
   *
   * `totalHoldingsValue` and each account's `totalMarketValue` are built by
   * skipping holdings whose `currentPrice` is null, so they are subtotals whenever
   * one exists -- and every figure derived from them (portfolio value, gain,
   * simple return) is a subtotal too. The signal is in the payload; nothing was
   * reading it, so a portfolio missing 50,000 of unpriced stock rendered as an
   * ordinary complete total.
   */
  const unpricedHoldings = useMemo(
    () =>
      (summary?.holdings ?? []).filter(
        (h) => h.currentPrice === null || h.marketValue === null,
      ),
    [summary],
  );
  const valuationIncomplete = unpricedHoldings.length > 0;

  const fmtVal = (value: number) => {
    if (foreignCurrency) return `${formatCurrency(value, foreignCurrency)} ${foreignCurrency}`;
    return formatCurrency(value);
  };

  const formatPercent = (value: number) => formatSignedPercent(value);

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
  const twr = summary.timeWeightedReturn;
  const cagrVal = summary.cagr;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-3 sm:p-6 lg:min-h-[420px]">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
        {t('portfolioSummary.title')}{titleSuffix ? ` (${titleSuffix})` : ''}
      </h3>

      {/* Every value below is built by skipping holdings the server could not
          price, so it is a subtotal whenever one exists. Say which ones. */}
      {valuationIncomplete && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200"
        >
          {t('portfolioSummary.unpricedHoldings', {
            count: unpricedHoldings.length,
            symbols: unpricedHoldings.map((h) => h.symbol).join(', '),
          })}
        </div>
      )}

      <div className="space-y-4">
        {/* Total Portfolio Value */}
        <div>
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {t('portfolioSummary.totalPortfolioValue')}
          </div>
          <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {fmtVal(converted?.portfolio ?? summary.totalPortfolioValue)}
            {valuationIncomplete && (
              <span className="ml-1 align-super text-base text-amber-600 dark:text-amber-400" aria-hidden="true">
                *
              </span>
            )}
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
                {fmtVal(converted?.holdings ?? summary.totalHoldingsValue)}
              </div>
            </div>
            <div>
              <div className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 flex items-center">
                {t('portfolioSummary.cashBalance')}
                <InfoTooltip placement="top" text={t('portfolioSummary.cashBalanceTooltip')} />
              </div>
              <div className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100">
                {fmtVal(converted?.cash ?? summary.totalCashValue)}
              </div>
            </div>
            <div>
              <div className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 flex items-center">
                {t('portfolioSummary.totalGain')}
                <InfoTooltip placement="top" text={t('portfolioSummary.totalGainTooltip')} />
              </div>
              <div className={`text-base sm:text-lg font-semibold ${returnColorClass((converted?.portfolio ?? summary.totalPortfolioValue) - (converted?.netInvested ?? summary.totalNetInvested))}`}>
                {fmtVal((converted?.portfolio ?? summary.totalPortfolioValue) - (converted?.netInvested ?? summary.totalNetInvested))}
              </div>
            </div>
            <div>
              <div className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 flex items-center">
                {t('portfolioSummary.netInvested')}
                <InfoTooltip placement="top" text={t('portfolioSummary.netInvestedTooltip')} />
              </div>
              <div className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100">
                {fmtVal(converted?.netInvested ?? summary.totalNetInvested)}
              </div>
            </div>
            <div>
              <div className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 flex items-center">
                {t('portfolioSummary.costBasis')}
                <InfoTooltip placement="top" text={t('portfolioSummary.costBasisTooltip')} />
              </div>
              <div className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100">
                {fmtVal(converted?.costBasis ?? summary.totalCostBasis)}
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
                {twr != null ? formatPercent(twr) : (
                  <span className="text-gray-400 dark:text-gray-500 text-sm font-normal">{t('portfolioSummary.notAvailable')}</span>
                )}
              </div>
            </div>
            <div>
              <div className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 flex items-center">
                {t('portfolioSummary.cagr')}
                <InfoTooltip placement="top" text={t('portfolioSummary.cagrTooltip')} />
              </div>
              <div className={`text-base sm:text-lg font-semibold ${returnColorClass(cagrVal)}`}>
                {cagrVal != null ? formatPercent(cagrVal) : (
                  <span className="text-gray-400 dark:text-gray-500 text-sm font-normal">{t('portfolioSummary.notAvailable')}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
