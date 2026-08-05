import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
  useExchangeRates,
  buildRateMap,
  convertWithRateMapOrNull,
} from './useExchangeRates';

vi.mock('@/store/preferencesStore', () => ({
  usePreferencesStore: vi.fn((selector: any) =>
    selector({ preferences: { defaultCurrency: 'CAD' } })
  ),
}));

vi.mock('@/lib/exchange-rates', () => ({
  exchangeRatesApi: {
    getLatestRates: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
}));

import { exchangeRatesApi } from '@/lib/exchange-rates';

describe('useExchangeRates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads rates on mount', async () => {
    vi.mocked(exchangeRatesApi.getLatestRates).mockResolvedValue([
      { id: 1, fromCurrency: 'USD', toCurrency: 'CAD', rate: 1.36, rateDate: '2025-01-15', source: 'test' },
    ]);
    const { result } = renderHook(() => useExchangeRates());
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.rates).toHaveLength(1);
  });

  it('convertOrNull returns the amount unchanged for the same currency', async () => {
    vi.mocked(exchangeRatesApi.getLatestRates).mockResolvedValue([]);
    const { result } = renderHook(() => useExchangeRates());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.convertOrNull(100, 'CAD', 'CAD')).toBe(100);
  });

  it('convertOrNull uses the direct rate', async () => {
    vi.mocked(exchangeRatesApi.getLatestRates).mockResolvedValue([
      { id: 1, fromCurrency: 'USD', toCurrency: 'CAD', rate: 1.36, rateDate: '2025-01-15', source: 'test' },
    ]);
    const { result } = renderHook(() => useExchangeRates());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.convertOrNull(100, 'USD', 'CAD')).toBeCloseTo(136, 1);
  });

  it('convertOrNull uses the inverse rate', async () => {
    vi.mocked(exchangeRatesApi.getLatestRates).mockResolvedValue([
      { id: 1, fromCurrency: 'USD', toCurrency: 'CAD', rate: 1.36, rateDate: '2025-01-15', source: 'test' },
    ]);
    const { result } = renderHook(() => useExchangeRates());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.convertOrNull(136, 'CAD', 'USD')).toBeCloseTo(100, 0);
  });

  it('getRate returns 1 for same currency', async () => {
    vi.mocked(exchangeRatesApi.getLatestRates).mockResolvedValue([]);
    const { result } = renderHook(() => useExchangeRates());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.getRate('CAD', 'CAD')).toBe(1);
  });

  it('getRate returns null when no rate found', async () => {
    vi.mocked(exchangeRatesApi.getLatestRates).mockResolvedValue([]);
    const { result } = renderHook(() => useExchangeRates());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.getRate('USD', 'GBP')).toBeNull();
  });

  it('handles API error gracefully', async () => {
    vi.mocked(exchangeRatesApi.getLatestRates).mockRejectedValue(new Error('API error'));
    const { result } = renderHook(() => useExchangeRates());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.rates).toEqual([]);
  });

  it('convertToDefault uses default currency', async () => {
    vi.mocked(exchangeRatesApi.getLatestRates).mockResolvedValue([
      { id: 1, fromCurrency: 'USD', toCurrency: 'CAD', rate: 1.5, rateDate: '2025-01-15', source: 'test' },
    ]);
    const { result } = renderHook(() => useExchangeRates());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.convertToDefault(100, 'USD')).toBeCloseTo(150, 1);
  });

  describe('a missing rate is missing data, not a rate of 1', () => {
    // `docs/financial-calculation-contract.md` section 3. The suite used to
    // assert only that `convert` returned the source amount unchanged, with no
    // case distinguishing that from a genuine same-currency conversion -- so a
    // green run was evidence the defect was still there.
    it('convertOrNull returns null when neither direction has a rate', async () => {
      vi.mocked(exchangeRatesApi.getLatestRates).mockResolvedValue([]);
      const { result } = renderHook(() => useExchangeRates());
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.convertOrNull(100, 'USD', 'GBP')).toBeNull();
      // Emphatically not the source amount wearing the target currency.
      expect(result.current.convertOrNull(100, 'USD', 'GBP')).not.toBe(100);
    });

    it('convertOrNull returns a real number for a same-currency pair', async () => {
      // The distinction the old test could not make: same-currency is a
      // successful conversion at exactly 1, so it is a number, not null.
      vi.mocked(exchangeRatesApi.getLatestRates).mockResolvedValue([]);
      const { result } = renderHook(() => useExchangeRates());
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.convertOrNull(100, 'CAD', 'CAD')).toBe(100);
    });

    it('convertOrNull converts at the direct rate', async () => {
      vi.mocked(exchangeRatesApi.getLatestRates).mockResolvedValue([
        { id: 1, fromCurrency: 'USD', toCurrency: 'CAD', rate: 1.35, rateDate: '2025-01-15', source: 'test' },
      ]);
      const { result } = renderHook(() => useExchangeRates());
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.convertOrNull(100, 'USD', 'CAD')).toBeCloseTo(135, 4);
    });

    it('convertOrNull converts at the inverse rate within the rounding contract', async () => {
      vi.mocked(exchangeRatesApi.getLatestRates).mockResolvedValue([
        { id: 1, fromCurrency: 'CAD', toCurrency: 'USD', rate: 0.7407407, rateDate: '2025-01-15', source: 'test' },
      ]);
      const { result } = renderHook(() => useExchangeRates());
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.convertOrNull(100, 'USD', 'CAD')).toBeCloseTo(135, 2);
    });

    it('canConvert distinguishes an available pair from an unavailable one', async () => {
      vi.mocked(exchangeRatesApi.getLatestRates).mockResolvedValue([
        { id: 1, fromCurrency: 'USD', toCurrency: 'CAD', rate: 1.35, rateDate: '2025-01-15', source: 'test' },
      ]);
      const { result } = renderHook(() => useExchangeRates());
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.canConvert('USD', 'CAD')).toBe(true);
      expect(result.current.canConvert('CAD', 'CAD')).toBe(true);
      expect(result.current.canConvert('USD', 'GBP')).toBe(false);
    });

    it('convertToDefault propagates the unavailable pair', async () => {
      vi.mocked(exchangeRatesApi.getLatestRates).mockResolvedValue([]);
      const { result } = renderHook(() => useExchangeRates());
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      // Default currency in this suite is CAD.
      expect(result.current.convertToDefault(100, 'USD')).toBeNull();
    });

  });

  it('getRate uses direct rate', async () => {
    vi.mocked(exchangeRatesApi.getLatestRates).mockResolvedValue([
      { id: 1, fromCurrency: 'USD', toCurrency: 'CAD', rate: 1.36, rateDate: '2025-01-15', source: 'test' },
    ]);
    const { result } = renderHook(() => useExchangeRates());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.getRate('USD', 'CAD')).toBe(1.36);
  });

  it('getRate uses inverse rate', async () => {
    vi.mocked(exchangeRatesApi.getLatestRates).mockResolvedValue([
      { id: 1, fromCurrency: 'USD', toCurrency: 'CAD', rate: 2, rateDate: '2025-01-15', source: 'test' },
    ]);
    const { result } = renderHook(() => useExchangeRates());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.getRate('CAD', 'USD')).toBe(0.5);
  });

  it('getRate uses default currency target when not provided', async () => {
    vi.mocked(exchangeRatesApi.getLatestRates).mockResolvedValue([
      { id: 1, fromCurrency: 'USD', toCurrency: 'CAD', rate: 1.36, rateDate: '2025-01-15', source: 'test' },
    ]);
    const { result } = renderHook(() => useExchangeRates());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.getRate('USD')).toBe(1.36);
  });
});

describe('buildRateMap', () => {
  it('builds lookup map from rates', () => {
    const map = buildRateMap([
      { id: 1, fromCurrency: 'USD', toCurrency: 'CAD', rate: 1.36, rateDate: '2025-01-15', source: 'test' },
    ]);
    expect(map.get('USD->CAD')).toBe(1.36);
  });
});

describe('convertWithRateMapOrNull', () => {
  const rateMap = new Map([['USD->CAD', 1.35]]);

  it('returns null when the pair has no rate in either direction', () => {
    expect(convertWithRateMapOrNull(100, 'GBP', 'JPY', rateMap)).toBeNull();
  });

  it('returns a real number for a same-currency pair', () => {
    expect(convertWithRateMapOrNull(100, 'CAD', 'CAD', rateMap)).toBe(100);
  });

  it('uses the direct rate', () => {
    expect(convertWithRateMapOrNull(100, 'USD', 'CAD', rateMap)).toBeCloseTo(135, 4);
  });

  it('uses the inverse rate', () => {
    expect(convertWithRateMapOrNull(135, 'CAD', 'USD', rateMap)).toBeCloseTo(100, 2);
  });
});
