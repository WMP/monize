import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useTableDensity, nextDensity } from './useTableDensity';

describe('useTableDensity', () => {
  it('returns dense padding for dense density', () => {
    const { result } = renderHook(() => useTableDensity('dense'));
    expect(result.current.cellPadding).toBe('px-3 py-1');
    expect(result.current.headerPadding).toBe('px-3 py-2');
  });

  it('returns compact padding for compact density', () => {
    const { result } = renderHook(() => useTableDensity('compact'));
    expect(result.current.cellPadding).toBe('px-4 py-2');
    expect(result.current.headerPadding).toBe('px-4 py-2');
  });

  it('returns normal (default) padding for normal density', () => {
    const { result } = renderHook(() => useTableDensity('normal'));
    expect(result.current.cellPadding).toBe('px-3 sm:px-6 py-4');
    expect(result.current.headerPadding).toBe('px-3 sm:px-6 py-3');
  });
});

describe('nextDensity', () => {
  it('cycles normal → compact', () => {
    expect(nextDensity('normal')).toBe('compact');
  });

  it('cycles compact → dense', () => {
    expect(nextDensity('compact')).toBe('dense');
  });

  it('cycles dense → normal', () => {
    expect(nextDensity('dense')).toBe('normal');
  });
});
