import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useRef } from 'react';
import { useFormSubmitRef } from './useFormSubmitRef';

describe('useFormSubmitRef', () => {
  it('sets submitRef.current to the bound handleSubmit function', () => {
    const onSubmit = vi.fn();
    const boundFn = vi.fn();
    const handleSubmit = vi.fn().mockReturnValue(boundFn);

    const { result } = renderHook(() => {
      const ref = useRef<(() => void) | null>(null);
      useFormSubmitRef(ref, handleSubmit, onSubmit);
      return ref;
    });

    expect(handleSubmit).toHaveBeenCalledWith(onSubmit);
    expect(result.current.current).toBe(boundFn);
  });

  it('clears submitRef.current on unmount', () => {
    const onSubmit = vi.fn();
    const handleSubmit = vi.fn().mockReturnValue(vi.fn());

    const { result, unmount } = renderHook(() => {
      const ref = useRef<(() => void) | null>(null);
      useFormSubmitRef(ref, handleSubmit, onSubmit);
      return ref;
    });

    expect(result.current.current).not.toBeNull();
    unmount();
    expect(result.current.current).toBeNull();
  });

  it('does not throw when submitRef is undefined', () => {
    const onSubmit = vi.fn();
    const handleSubmit = vi.fn().mockReturnValue(vi.fn());

    expect(() => {
      renderHook(() => useFormSubmitRef(undefined, handleSubmit, onSubmit));
    }).not.toThrow();
  });
});
