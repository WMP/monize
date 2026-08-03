import { useState, useEffect, useCallback, useMemo } from 'react';
import { exchangeRatesApi, ExchangeRate } from '@/lib/exchange-rates';
import { usePreferencesStore } from '@/store/preferencesStore';
import { createLogger } from '@/lib/logger';

const logger = createLogger('ExchangeRates');

export function useExchangeRates() {
  const [rates, setRates] = useState<ExchangeRate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const defaultCurrency =
    usePreferencesStore((state) => state.preferences?.defaultCurrency) || 'CAD';

  const refresh = useCallback(async () => {
    try {
      const data = await exchangeRatesApi.getLatestRates();
      setRates(data);
    } catch (error) {
      logger.error('Failed to load exchange rates:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Build a lookup map: "USD->CAD" => 1.365
  const rateMap = useMemo(() => {
    const map = new Map<string, number>();
    rates.forEach((r) => {
      map.set(`${r.fromCurrency}->${r.toCurrency}`, Number(r.rate));
    });
    return map;
  }, [rates]);

  const getRate = useCallback(
    (fromCurrency: string, toCurrency?: string): number | null => {
      const target = toCurrency || defaultCurrency;
      if (fromCurrency === target) return 1;
      const direct = rateMap.get(`${fromCurrency}->${target}`);
      if (direct) return direct;
      const inverse = rateMap.get(`${target}->${fromCurrency}`);
      if (inverse && inverse !== 0) return 1 / inverse;
      return null;
    },
    [rateMap, defaultCurrency],
  );

  /** True when the pair can be converted at all. */
  const canConvert = useCallback(
    (fromCurrency: string, toCurrency?: string): boolean =>
      getRate(fromCurrency, toCurrency) !== null,
    [getRate],
  );

  /**
   * Convert `amount`, or return `null` when the pair has no direct or inverse
   * rate.
   *
   * **This is the correct conversion function.** A same-currency pair returns
   * the amount unchanged, which is a real conversion at a rate of exactly 1 and
   * stays distinguishable from an unavailable pair by being a number rather
   * than `null`.
   *
   * Prefer this over `convert` in new code; see the note there for why the
   * other one still exists.
   */
  const convertOrNull = useCallback(
    (amount: number, fromCurrency: string, toCurrency?: string): number | null => {
      const target = toCurrency || defaultCurrency;
      if (fromCurrency === target) return amount;
      const rate = getRate(fromCurrency, target);
      if (rate === null) {
        // Skip the warning while the rates request is still in flight.
        if (!isLoading) {
          logger.warn(`No exchange rate for ${fromCurrency}->${target}`);
        }
        return null;
      }
      return amount * rate;
    },
    [getRate, defaultCurrency, isLoading],
  );

  /**
   * Convert `amount`, falling back to the **unconverted** amount when the pair
   * has no rate.
   *
   * That fallback is a known defect, not a design choice. A caller rendering
   * the result beside the destination currency label shows `100.00 USD` as
   * `100.00 CAD`: a fabricated 1:1 conversion, indistinguishable from a genuine
   * same-currency figure, and exactly what
   * `docs/financial-calculation-contract.md` section 3 forbids -- "a missing
   * exchange rate is missing data, not a rate of `1`".
   *
   * It survives only because around fifty display call sites across the
   * reports, dashboard widgets and account pages consume it as a plain
   * `number`, and each needs its own decision about how to show a figure that
   * cannot be worked out. The backend half of the same defect is fixed:
   * `PortfolioService` returns `null` totals and names the unavailable pairs in
   * `unavailableFxPairs`.
   *
   * **Do not call this from new code.** Use `convertOrNull` and render the
   * unknown case, or `canConvert` to decide whether to offer the figure at all.
   */
  const convert = useCallback(
    (amount: number, fromCurrency: string, toCurrency?: string): number => {
      return convertOrNull(amount, fromCurrency, toCurrency) ?? amount;
    },
    [convertOrNull],
  );

  const convertToDefault = useCallback(
    (amount: number, fromCurrency: string): number => {
      return convert(amount, fromCurrency, defaultCurrency);
    },
    [convert, defaultCurrency],
  );

  /** `convertToDefault`'s honest counterpart. */
  const convertToDefaultOrNull = useCallback(
    (amount: number, fromCurrency: string): number | null => {
      return convertOrNull(amount, fromCurrency, defaultCurrency);
    },
    [convertOrNull, defaultCurrency],
  );

  return {
    rates,
    rateMap,
    isLoading,
    convert,
    convertOrNull,
    convertToDefault,
    convertToDefaultOrNull,
    canConvert,
    getRate,
    refresh,
    defaultCurrency,
  };
}

/**
 * Build a rate map from an array of ExchangeRate objects.
 * Used for historical rate lookups in the NetWorthReport.
 */
export function buildRateMap(rates: ExchangeRate[]): Map<string, number> {
  const map = new Map<string, number>();
  rates.forEach((r) => {
    map.set(`${r.fromCurrency}->${r.toCurrency}`, Number(r.rate));
  });
  return map;
}

/**
 * Convert an amount using a rate map, or `null` when the pair has no direct or
 * inverse rate. Same contract as `convertOrNull`, for the historical
 * (date-indexed) rate lookups the net-worth report builds its own map for.
 */
export function convertWithRateMapOrNull(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  rateMap: Map<string, number>,
): number | null {
  if (fromCurrency === toCurrency) return amount;

  const directRate = rateMap.get(`${fromCurrency}->${toCurrency}`);
  if (directRate) return amount * directRate;

  const inverseRate = rateMap.get(`${toCurrency}->${fromCurrency}`);
  if (inverseRate && inverseRate !== 0) return amount / inverseRate;

  return null;
}

/**
 * Convert an amount using a rate map, falling back to the unconverted amount.
 *
 * Carries the same defect as `convert` above, for the same reason. Prefer
 * `convertWithRateMapOrNull`.
 */
export function convertWithRateMap(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  rateMap: Map<string, number>,
): number {
  return (
    convertWithRateMapOrNull(amount, fromCurrency, toCurrency, rateMap) ?? amount
  );
}
