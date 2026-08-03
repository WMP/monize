import { describe, it, expect } from 'vitest';
import { sumKnown, addKnown, subtractKnown, percentOf } from './partial-sum';

describe('sumKnown', () => {
  it('sums known components', () => {
    expect(sumKnown([100, 35.5])).toBe(135.5);
  });

  it('is a known zero for an empty list', () => {
    // Nothing to add is a settled answer, not a missing one.
    expect(sumKnown([])).toBe(0);
  });

  it('treats a known zero as a value', () => {
    expect(sumKnown([0, 0])).toBe(0);
  });

  it('returns null when any component is null', () => {
    expect(sumKnown([100, null, 35])).toBeNull();
  });

  it('returns null when any component is undefined', () => {
    expect(sumKnown([100, undefined])).toBeNull();
  });

  it('returns null rather than propagating NaN', () => {
    expect(sumKnown([100, NaN])).toBeNull();
  });

  it('does not fall back to zero for a missing component', () => {
    // The defect this exists to prevent: `?? 0` would give 135 here, which
    // reads as a complete total.
    expect(sumKnown([100, null, 35])).not.toBe(135);
  });
});

describe('addKnown', () => {
  it('adds two known figures', () => {
    expect(addKnown(100, 35)).toBe(135);
  });

  it('is unknown when either side is', () => {
    expect(addKnown(100, null)).toBeNull();
    expect(addKnown(null, 35)).toBeNull();
  });
});

describe('subtractKnown', () => {
  it('subtracts two known figures', () => {
    expect(subtractKnown(135, 100)).toBe(35);
  });

  it('is unknown when either side is', () => {
    expect(subtractKnown(135, null)).toBeNull();
    expect(subtractKnown(null, 100)).toBeNull();
  });

  it('does not report the whole value as a gain when the basis is unknown', () => {
    expect(subtractKnown(1350, null)).toBeNull();
  });
});

describe('percentOf', () => {
  it('computes a percentage', () => {
    expect(percentOf(350, 1000)).toBe(35);
  });

  it('is unknown when either side is', () => {
    expect(percentOf(350, null)).toBeNull();
    expect(percentOf(null, 1000)).toBeNull();
  });

  it('is a settled 0% when both are zero', () => {
    expect(percentOf(0, 0)).toBe(0);
  });

  it('is unknown, not 0%, for a value against a zero basis', () => {
    expect(percentOf(500, 0)).toBeNull();
  });

  it('keeps a gain positive against a negative basis', () => {
    expect(percentOf(150, -100)).toBe(150);
  });
});
