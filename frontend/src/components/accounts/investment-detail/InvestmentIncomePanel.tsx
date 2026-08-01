'use client';

import { useTranslations } from 'next-intl';
import { useNumberFormat } from '@/hooks/useNumberFormat';
import { Account } from '@/types/account';
import { estimateDividendTax, taxSettingsOf } from '@/lib/investment-tax';

interface InvestmentIncomePanelProps {
  dividendInterestYtd: number;
  realizedGainsYtd: number;
  currencyCode: string;
  isLoading: boolean;
  /**
   * The account holding the instruments, whose tax settings drive the dividend
   * estimate. Optional so existing callers and fixtures keep working; without
   * it the panel shows income only.
   */
  account?: Account | null;
  /**
   * Dividend withholding tax recorded on the year's transactions, when any is
   * recorded. Left undefined the estimate falls back to the account's own
   * withholding rate; it is never inferred from a security's country,
   * exchange or currency.
   */
  recordedWithholdingTaxYtd?: number | null;
}

function gainClass(value: number): string {
  return value < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400';
}

/** Year-to-date investment income: dividends/interest plus realized gains. */
export function InvestmentIncomePanel({
  dividendInterestYtd,
  realizedGainsYtd,
  currencyCode,
  isLoading,
  account,
  recordedWithholdingTaxYtd,
}: InvestmentIncomePanelProps) {
  const t = useTranslations('accountDetail-investment');
  const { formatCurrency } = useNumberFormat();

  const hasIncome = dividendInterestYtd !== 0 || realizedGainsYtd !== 0;

  const dividendTax = estimateDividendTax(taxSettingsOf(account), {
    grossDividend: dividendInterestYtd,
    recordedWithholdingTax: recordedWithholdingTaxYtd,
  });

  // The tax already taken at source stays visible even on an account that adds
  // no dividend tax of its own -- it is money gone either way, and hiding it
  // would make a tax-exempt account look like it received the gross amount.
  const showTax =
    hasIncome &&
    (dividendTax.estimatedDividendTax > 0 || dividendTax.taxAlreadyWithheld > 0);

  return (
    <section>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
        {t('income.title')}
      </h2>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-4">
        {isLoading ? (
          <div className="h-16 rounded bg-gray-100 dark:bg-gray-700 animate-pulse" />
        ) : !hasIncome ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('income.empty')}</p>
        ) : (
          <>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <dt className="text-xs text-gray-500 dark:text-gray-400">
                  {t('income.dividendsInterest')}
                </dt>
                <dd className="text-xl font-bold text-green-600 dark:text-green-400">
                  {formatCurrency(dividendInterestYtd, currencyCode)}
                </dd>
                <dd className="text-xs text-gray-500 dark:text-gray-400">{t('income.ytd')}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500 dark:text-gray-400">
                  {t('income.realizedGains')}
                </dt>
                <dd className={`text-xl font-bold ${gainClass(realizedGainsYtd)}`}>
                  {formatCurrency(realizedGainsYtd, currencyCode)}
                </dd>
                <dd className="text-xs text-gray-500 dark:text-gray-400">{t('income.ytd')}</dd>
              </div>
            </dl>

            {showTax && (
              <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
                <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-3">
                  {t('income.dividendTaxTitle')}
                </h3>
                <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <dt className="text-xs text-gray-500 dark:text-gray-400">
                      {t('income.estimatedDividendTax')}
                    </dt>
                    <dd className="text-base font-semibold text-gray-900 dark:text-gray-100">
                      {formatCurrency(dividendTax.estimatedDividendTax, currencyCode)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500 dark:text-gray-400">
                      {t('income.taxAlreadyWithheld')}
                    </dt>
                    <dd className="text-base font-semibold text-gray-900 dark:text-gray-100">
                      {formatCurrency(dividendTax.taxAlreadyWithheld, currencyCode)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500 dark:text-gray-400">
                      {t('income.estimatedAdditionalTax')}
                    </dt>
                    <dd className="text-base font-semibold text-gray-900 dark:text-gray-100">
                      {formatCurrency(dividendTax.estimatedAdditionalTax, currencyCode)}
                    </dd>
                  </div>
                </dl>
                <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                  {t('income.taxDisclaimer')}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
