import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useNumberFormat } from './useNumberFormat';

/**
 * Formatters for money and percentages that **may be unknown**.
 *
 * The server sends `null` rather than `0` for anything it could not work out,
 * and `useExchangeRates.convertOrNull` does the same for a currency pair with no
 * rate. The last hundred pixels are where that gets thrown away: once
 * currency-formatted, a substituted `0` is indistinguishable from a real
 * balance, which is the defect
 * `docs/financial-calculation-contract.md` exists to prevent.
 *
 * This is one helper rather than a ternary at each of the ~30 display sites that
 * need one, so the marker reads the same everywhere and a translator has a
 * single string to change. It lives apart from `useNumberFormat` on purpose:
 * that hook is deliberately free of the `next-intl` provider (its own tests
 * render it bare), and adding a translation lookup there broke thirty of them.
 *
 * `0` is always formatted normally. A known zero is an answer; only `null` and
 * `undefined` are unknown.
 */
export function useMoneyDisplay() {
  const t = useTranslations('common');
  const { formatCurrency, formatPercent, formatSignedPercent, formatNumber } =
    useNumberFormat();

  /** The short marker for an unknown value, e.g. in a table cell. */
  const notAvailableShort = t('notAvailableShort');
  /** The spelled-out form, for a headline figure or a card. */
  const notAvailable = t('notAvailable');

  const formatCurrencyOrNa = useCallback(
    (
      amount: number | null | undefined,
      currencyCode?: string,
      fractionDigits?: number,
    ): string =>
      amount == null
        ? notAvailableShort
        : formatCurrency(amount, currencyCode, fractionDigits),
    [formatCurrency, notAvailableShort],
  );

  const formatPercentOrNa = useCallback(
    (value: number | null | undefined): string =>
      value == null ? notAvailableShort : formatPercent(value),
    [formatPercent, notAvailableShort],
  );

  const formatSignedPercentOrNa = useCallback(
    (value: number | null | undefined): string =>
      value == null ? notAvailableShort : formatSignedPercent(value),
    [formatSignedPercent, notAvailableShort],
  );

  const formatNumberOrNa = useCallback(
    (value: number | null | undefined, decimals?: number): string =>
      value == null ? notAvailableShort : formatNumber(value, decimals),
    [formatNumber, notAvailableShort],
  );

  /**
   * Sign prefix for a signed figure, and nothing at all when it is unknown --
   * `+n/a` reads as a gain.
   */
  const signPrefix = useCallback(
    (value: number | null | undefined): string =>
      value == null ? '' : value >= 0 ? '+' : '',
    [],
  );

  /**
   * Colour class for a gain/loss figure, greyed when the figure is unknown so it
   * does not read as a break-even.
   */
  const unknownColorClass = 'text-gray-400 dark:text-gray-500';

  return {
    formatCurrencyOrNa,
    formatPercentOrNa,
    formatSignedPercentOrNa,
    formatNumberOrNa,
    signPrefix,
    notAvailable,
    notAvailableShort,
    unknownColorClass,
  };
}
