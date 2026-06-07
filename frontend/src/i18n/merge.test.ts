import { describe, it, expect } from 'vitest';
import { deepMerge } from './merge';

describe('deepMerge', () => {
  it('overlays override values onto the base', () => {
    expect(deepMerge({ a: 1, b: 2 }, { b: 3 })).toEqual({ a: 1, b: 3 });
  });

  it('keeps base keys missing from the override (fallback behavior)', () => {
    const base = { greeting: 'Hello', farewell: 'Goodbye' };
    const override = { greeting: 'Cześć' };
    expect(deepMerge(base, override)).toEqual({
      greeting: 'Cześć',
      farewell: 'Goodbye',
    });
  });

  it('merges nested objects recursively', () => {
    const base = { nav: { home: 'Home', settings: 'Settings' } };
    const override = { nav: { home: 'Start' } };
    expect(deepMerge(base, override)).toEqual({
      nav: { home: 'Start', settings: 'Settings' },
    });
  });

  it('does not mutate the base object', () => {
    const base = { nav: { home: 'Home' } };
    const copy = structuredClone(base);
    deepMerge(base, { nav: { home: 'Start' } });
    expect(base).toEqual(copy);
  });

  it('overwrites arrays rather than merging them', () => {
    expect(deepMerge({ list: ['a', 'b'] }, { list: ['c'] })).toEqual({
      list: ['c'],
    });
  });

  it('falls back to the base when override is empty', () => {
    const base = { a: { b: 'c' } };
    expect(deepMerge(base, {})).toEqual(base);
  });
});
