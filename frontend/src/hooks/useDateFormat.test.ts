import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDateFormat } from './useDateFormat';

vi.mock('@/store/preferencesStore', () => ({
  usePreferencesStore: vi.fn((selector: any) =>
    selector({ preferences: { dateFormat: 'YYYY-MM-DD' } })
  ),
}));

vi.mock('@/lib/utils', () => ({
  formatDate: vi.fn((date: Date | string, fmt: string) => `formatted:${fmt}`),
  formatMonth: vi.fn((month: string, fmt: string) => `month:${fmt}`),
}));

describe('useDateFormat', () => {
  it('returns formatDate/formatMonth functions and dateFormat', () => {
    const { result } = renderHook(() => useDateFormat());
    expect(result.current.dateFormat).toBe('YYYY-MM-DD');
    expect(typeof result.current.formatDate).toBe('function');
    expect(typeof result.current.formatMonth).toBe('function');
  });

  it('formatDate delegates to utils formatDate', () => {
    const { result } = renderHook(() => useDateFormat());
    const formatted = result.current.formatDate('2025-01-15');
    expect(formatted).toBe('formatted:YYYY-MM-DD');
  });

  it('formatMonth delegates to utils formatMonth', () => {
    const { result } = renderHook(() => useDateFormat());
    const formatted = result.current.formatMonth('2025-01');
    expect(formatted).toBe('month:YYYY-MM-DD');
  });
});
