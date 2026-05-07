import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFormDirtyNotify } from './useFormDirtyNotify';

describe('useFormDirtyNotify', () => {
  it('calls onDirtyChange with current isDirty value on mount', () => {
    const onDirtyChange = vi.fn();
    renderHook(() => useFormDirtyNotify(true, onDirtyChange));
    expect(onDirtyChange).toHaveBeenCalledWith(true);
  });

  it('calls onDirtyChange with false when form is not dirty', () => {
    const onDirtyChange = vi.fn();
    renderHook(() => useFormDirtyNotify(false, onDirtyChange));
    expect(onDirtyChange).toHaveBeenCalledWith(false);
  });

  it('does not throw when onDirtyChange is not provided', () => {
    expect(() => {
      renderHook(() => useFormDirtyNotify(true, undefined));
    }).not.toThrow();
  });

  it('calls onDirtyChange again when isDirty changes', () => {
    const onDirtyChange = vi.fn();
    const { rerender } = renderHook(
      ({ isDirty }: { isDirty: boolean }) => useFormDirtyNotify(isDirty, onDirtyChange),
      { initialProps: { isDirty: false } },
    );
    expect(onDirtyChange).toHaveBeenCalledWith(false);
    rerender({ isDirty: true });
    expect(onDirtyChange).toHaveBeenCalledWith(true);
  });
});
