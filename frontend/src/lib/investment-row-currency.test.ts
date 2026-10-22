import { describe, it, expect, vi } from 'vitest';
import { convertRowAmount } from './investment-row-currency';

/** A market-rate table: 1 USD = 1.4 CAD, 1 CAD = 0.7 EUR. */
const convert = vi.fn((amount: number, from: string, to: string): number | null => {
  const rates: Record<string, number> = { 'USD->CAD': 1.4, 'CAD->EUR': 0.7, 'USD->EUR': 0.95 };
  if (from === to) return amount;
  const rate = rates[`${from}->${to}`];
  return rate === undefined ? null : amount * rate;
});

const row = (over: Partial<Parameters<typeof convertRowAmount>[0]> = {}) => ({
  amountCurrencyCode: 'USD',
  security: null,
  exchangeRate: 1.35,
  ...over,
});

describe('convertRowAmount', () => {
  it('leaves an amount already in the target currency alone', () => {
    expect(convertRowAmount(row(), 100, 'CAD', 'USD', convert)).toBe(100);
  });

  it("converts into the account's currency at the row's own settlement rate, not the market's", () => {
    // INV-FX-002: the dividend settled at 1.35, whatever today's rate is.
    expect(convertRowAmount(row(), 100, 'CAD', 'CAD', convert)).toBe(135);
  });

  it("goes on from the account's currency at the market rate when the target is another", () => {
    expect(convertRowAmount(row(), 100, 'CAD', 'EUR', convert)).toBeCloseTo(94.5, 6);
  });

  it('uses the market rate for a row with no rate of its own', () => {
    expect(convertRowAmount(row({ exchangeRate: 0 }), 100, 'CAD', 'CAD', convert)).toBeCloseTo(140, 6);
  });

  it("reads the row's own currency, never the account's", () => {
    // A USD dividend in a CAD account is not 100 CAD.
    expect(convertRowAmount(row(), 100, 'CAD', 'CAD', convert)).not.toBe(100);
  });

  it('falls back to the security currency for a backend that predates the stamp', () => {
    expect(
      convertRowAmount(
        row({ amountCurrencyCode: undefined, security: { currencyCode: 'CAD' } as never }),
        100,
        'CAD',
        'CAD',
        convert,
      ),
    ).toBe(100);
  });

  it('is unknown when the row names no currency, or no rate is known', () => {
    expect(
      convertRowAmount(row({ amountCurrencyCode: null, security: null }), 100, 'CAD', 'CAD', convert),
    ).toBeNull();
    expect(convertRowAmount(row({ exchangeRate: 0 }), 100, 'CAD', 'JPY', convert)).toBeNull();
  });
});
