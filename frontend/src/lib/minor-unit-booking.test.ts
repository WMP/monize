import { describe, it, expect } from 'vitest';
import { bookSplitsAtMinorUnit, minorUnitAbsorbIndex } from './minor-unit-booking';

// The same cases as backend/src/common/currency-minor-unit.util.spec.ts: the
// server recognises an unchanged Post dialog by booking the stored template
// itself, so the two layers must agree figure for figure.
describe('bookSplitsAtMinorUnit', () => {
  it('books the issue #1581 installment in cents, principal taking the rounding', () => {
    expect(bookSplitsAtMinorUnit([-864.5833, -306.0625], -1170.6458, 2, 0)).toEqual({
      amounts: [-864.59, -306.06],
      parentAmount: -1170.65,
    });
  });

  it('books whole units for a currency without a minor unit', () => {
    expect(bookSplitsAtMinorUnit([-86458.33, -30606.25], -117064.58, 0, 0)).toEqual({
      amounts: [-86459, -30606],
      parentAmount: -117065,
    });
  });

  it('leaves a set already in the unit unchanged', () => {
    expect(bookSplitsAtMinorUnit([-500, -1000], -1500, 2, 0)).toEqual({
      amounts: [-500, -1000],
      parentAmount: -1500,
    });
  });

  it('puts a negative residual on the absorbing line too', () => {
    expect(bookSplitsAtMinorUnit([0.335, 0.665], 1, 2, 1)).toEqual({
      amounts: [0.34, 0.66],
      parentAmount: 1,
    });
  });

  it('only rounds when no line is named to absorb the difference', () => {
    expect(bookSplitsAtMinorUnit([-864.5833, -306.0625], -1170.6458, 2, -1)).toEqual({
      amounts: [-864.58, -306.06],
      parentAmount: -1170.65,
    });
  });
});

describe('minorUnitAbsorbIndex', () => {
  const types = new Map([
    ['mortgage-1', 'MORTGAGE'],
    ['savings-1', 'SAVINGS'],
  ]);

  it('picks the principal line of a loan payment, even when interest is larger', () => {
    expect(
      minorUnitAbsorbIndex(
        [
          { amount: -900, transferAccountId: null, memo: 'Interest' },
          { amount: -100, transferAccountId: 'mortgage-1', memo: 'Extra Principal' },
          { amount: -300, transferAccountId: 'mortgage-1', memo: 'Principal' },
        ],
        types,
      ),
    ).toBe(2);
  });

  it('picks the largest line of a split set that pays no loan', () => {
    expect(
      minorUnitAbsorbIndex(
        [
          { amount: -10, transferAccountId: 'savings-1' },
          { amount: -30 },
          { amount: -20 },
        ],
        types,
      ),
    ).toBe(1);
  });
});
