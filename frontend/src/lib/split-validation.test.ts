import { describe, it, expect } from 'vitest';
import {
  validateSplits,
  oppositeSignCategorySplits,
  ValidatableSplit,
} from './split-validation';

const category = (amount: number): ValidatableSplit => ({
  amount,
  splitType: 'category',
});
const transfer = (amount: number): ValidatableSplit => ({
  amount,
  splitType: 'transfer',
});
const investment = (amount: number): ValidatableSplit => ({
  amount,
  splitType: 'investment',
});

describe('validateSplits — balance', () => {
  it('accepts an exact set', () => {
    expect(validateSplits([category(-60), category(-40)], -100)).toBeNull();
  });

  // The audit's numerical reproduction. The old editor called this balanced
  // because 0.0048 < 0.01, and the API rejected the save.
  it('rejects a four-decimal parent that cents cannot reach', () => {
    const issue = validateSplits([category(5), category(5)], 10.0048);
    expect(issue).toEqual({
      kind: 'unbalanced',
      splitsTotal: 10,
      transactionAmount: 10.0048,
    });
  });

  it('accepts four-decimal children that do reach it', () => {
    expect(validateSplits([category(5.0024), category(5.0024)], 10.0048)).toBeNull();
  });

  // The largest discrepancy the old tolerance let through.
  it('rejects a 0.0099 discrepancy', () => {
    expect(validateSplits([category(10), category(0.0001)], 10.01)?.kind).toBe(
      'unbalanced',
    );
  });

  it('accepts a sum that is equal but arrived by different arithmetic', () => {
    // 0.1 + 0.2 !== 0.3 in IEEE 754; at storage precision it is.
    expect(validateSplits([category(0.1), category(0.2)], 0.3)).toBeNull();
  });

  it('treats a non-numeric amount as zero rather than NaN', () => {
    const issue = validateSplits(
      [{ amount: Number.NaN, splitType: 'category' }, category(-100)],
      -100,
    );
    expect(issue).toBeNull();
  });
});

describe('oppositeSignCategorySplits', () => {
  // The audit's reproduction: -150 and +50 sum to -100, so a sum-only check
  // passes them and 50.00 of income is recorded inside an expense.
  it('flags an income row inside an expense', () => {
    expect(oppositeSignCategorySplits([category(-150), category(50)], -100)).toEqual([
      1,
    ]);
  });

  it('flags an expense row inside an income transaction', () => {
    expect(oppositeSignCategorySplits([category(150), category(-50)], 100)).toEqual([
      1,
    ]);
  });

  it('flags every offending row, not just the first', () => {
    expect(
      oppositeSignCategorySplits([category(-200), category(50), category(50)], -100),
    ).toEqual([1, 2]);
  });

  it('accepts rows that share the parent direction', () => {
    expect(oppositeSignCategorySplits([category(-60), category(-40)], -100)).toEqual(
      [],
    );
  });

  it('treats a zero row as neutral', () => {
    expect(oppositeSignCategorySplits([category(-100), category(0)], -100)).toEqual(
      [],
    );
  });

  // Transfer and investment splits model their opposite leg explicitly, so
  // their direction is theirs to define.
  it('exempts transfer splits', () => {
    expect(oppositeSignCategorySplits([category(-150), transfer(50)], -100)).toEqual(
      [],
    );
  });

  it('exempts investment splits', () => {
    expect(
      oppositeSignCategorySplits([category(-150), investment(50)], -100),
    ).toEqual([]);
  });

  it('says nothing about a zero parent, which has no direction', () => {
    expect(oppositeSignCategorySplits([category(-50), category(50)], 0)).toEqual([]);
  });
});

describe('validateSplits — precedence', () => {
  it('reports the imbalance first when a set is both unbalanced and mixed', () => {
    expect(validateSplits([category(-150), category(50)], -50)?.kind).toBe(
      'unbalanced',
    );
  });

  it('reports the mixed sign once the arithmetic is right', () => {
    expect(validateSplits([category(-150), category(50)], -100)).toEqual({
      kind: 'mixed-sign',
      indexes: [1],
    });
  });
});
