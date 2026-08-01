'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { RealizedGainEntry } from '@/types/investment';
import { CapitalGainsTaxMode } from '@/types/account';

interface EstimatedTaxByAccountPanelProps {
  entries: RealizedGainEntry[];
  /** Converts a value in the given account's currency into the display currency. */
  toDisplay: (value: number, currencyCode: string | null) => number;
  /** Formats a display-currency value. */
  fmtValue: (value: number) => string;
}

interface AccountTaxRow {
  accountId: string;
  accountName: string;
  estimatedGain: number;
  estimatedTax: number;
  mode: CapitalGainsTaxMode;
  rate: number;
}

/**
 * Estimated tax on the sales in the report, grouped by the account that held
 * each position.
 *
 * The grouping is the point, not a presentation choice: each account carries
 * its own tax settings, so a strategy spanning a taxable brokerage account and
 * an IKE has two different answers and no single blended rate to show. Rolling
 * these into one number would be wrong for every account but one.
 *
 * Everything here is a simplified estimate, and the panel says so.
 */
export function EstimatedTaxByAccountPanel({
  entries,
  toDisplay,
  fmtValue,
}: EstimatedTaxByAccountPanelProps) {
  const t = useTranslations('reports');

  const rows = useMemo((): AccountTaxRow[] => {
    const map = new Map<string, AccountTaxRow>();

    for (const entry of entries) {
      let row = map.get(entry.accountId);
      if (!row) {
        row = {
          accountId: entry.accountId,
          accountName: entry.accountName || t('estimatedTax.unknownAccount'),
          estimatedGain: 0,
          estimatedTax: 0,
          mode: entry.capitalGainsTaxMode,
          rate: entry.capitalGainsTaxRate,
        };
        map.set(entry.accountId, row);
      }
      row.estimatedGain += toDisplay(entry.realizedGain, entry.accountCurrencyCode);
      row.estimatedTax += toDisplay(entry.estimatedTax, entry.accountCurrencyCode);
    }

    return Array.from(map.values()).sort((a, b) => b.estimatedTax - a.estimatedTax);
  }, [entries, toDisplay, t]);

  if (rows.length === 0) return null;

  const calculationLabel = (row: AccountTaxRow): string => {
    if (row.mode === 'none') return t('estimatedTax.calculationNone');
    const rate = `${row.rate}%`;
    return row.mode === 'percentage_of_profit'
      ? t('estimatedTax.calculationOfProfit', { rate })
      : t('estimatedTax.calculationOfSaleValue', { rate });
  };

  return (
    <section className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-4">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
        {t('estimatedTax.title')}
      </h3>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        {t('estimatedTax.disclaimer')}
      </p>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
              <th className="py-2 pr-4 font-medium">{t('estimatedTax.account')}</th>
              <th className="py-2 pr-4 font-medium text-right">
                {t('estimatedTax.estimatedGainOnSale')}
              </th>
              <th className="py-2 pr-4 font-medium text-right">
                {t('estimatedTax.estimatedTax')}
              </th>
              <th className="py-2 font-medium">{t('estimatedTax.calculation')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.accountId}
                className="border-t border-gray-100 dark:border-gray-700"
              >
                <td className="py-2 pr-4 text-gray-900 dark:text-gray-100">{row.accountName}</td>
                <td className="py-2 pr-4 text-right text-gray-900 dark:text-gray-100">
                  {fmtValue(row.estimatedGain)}
                </td>
                <td className="py-2 pr-4 text-right font-medium text-gray-900 dark:text-gray-100">
                  {fmtValue(row.estimatedTax)}
                </td>
                <td className="py-2 text-gray-500 dark:text-gray-400">{calculationLabel(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
