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
   * This is the *only* conversion function. A `convert` that fell back to the
   * source amount used to sit beside it -- see the note on the returned object.
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

  const convertToDefault = useCallback(
    (amount: number, fromCurrency: string): number | null => {
      return convertOrNull(amount, fromCurrency, defaultCurrency);
    },
    [convertOrNull, defaultCurrency],
  );

  return {
    rates,
    rateMap,
    isLoading,
    /**
     * The only conversion function. Returns `null` for a pair with no rate.
     *
     * There used to be a `convert` beside it that fell back to the source
     * amount, so `100.00 USD` rendered beside a CAD label read as `100.00 CAD`
     * -- a fabricated 1:1 conversion indistinguishable from a genuine
     * same-currency figure, which is what
     * `docs/financial-calculation-contract.md` section 3 forbids. It is gone,
     * along with `convertWithRateMap`, rather than deprecated: a fallback that
     * still compiles is a fallback something still calls.
     */
    convertOrNull,
    convertToDefault,
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
