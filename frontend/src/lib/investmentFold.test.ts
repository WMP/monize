import { describe, it, expect } from 'vitest';
import { totalFromQuantity, quantityFromTotal } from './investmentFold';

describe('totalFromQuantity', () => {
  it('folds a buy commission into the total (sign +1)', () => {
    expect(totalFromQuantity(10, 100, 1, 5)).toBe(1005);
  });

  it('nets a sell commission out of the total (sign -1)', () => {
    expect(totalFromQuantity(10, 100, -1, 5)).toBe(995);
  });

  it('rounds to money precision (4dp)', () => {
    // 3 * 33.3333 = 99.9999, commission 0
    expect(totalFromQuantity(3, 33.3333, 1, 0)).toBe(99.9999);
    // A fifth decimal rounds into the fourth.
    expect(totalFromQuantity(3, 33.33335, 1, 0)).toBe(100.0001);
  });
});

describe('quantityFromTotal', () => {
  it('backs a buy commission out before dividing (sign +1)', () => {
    // (1005 - 5) / 100 = 10
    expect(quantityFromTotal(1005, 100, 1, 5)).toBe(10);
  });

  it('adds a sell commission back before dividing (sign -1)', () => {
    // (995 - (-1*5)) / 100 = 10
    expect(quantityFromTotal(995, 100, -1, 5)).toBe(10);
  });

  it('rounds to share precision (8dp)', () => {
    // 1000 / 123.45 = 8.100445524..., rounded to 8dp = 8.10044552
    expect(quantityFromTotal(1000, 123.45, 1, 0)).toBe(8.10044552);
  });

  it('never returns a negative quantity when commission exceeds the total', () => {
    expect(quantityFromTotal(3, 100, 1, 10)).toBe(0);
  });

  it('returns 0 rather than dividing by a non-positive price', () => {
    expect(quantityFromTotal(1000, 0, 1, 0)).toBe(0);
    expect(quantityFromTotal(1000, -5, 1, 0)).toBe(0);
  });
});
