import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBillsFilters } from './useBillsFilters';

describe('useBillsFilters', () => {
  it('initializes with empty filters', () => {
    const { result } = renderHook(() => useBillsFilters());
    expect(result.current.nameSearch).toBe('');
    expect(result.current.selectedPayeeIds).toEqual([]);
    expect(result.current.selectedAccountIds).toEqual([]);
    expect(result.current.selectedCategoryIds).toEqual([]);
    expect(result.current.filtersExpanded).toBe(false);
    expect(result.current.activeFilterCount).toBe(0);
  });

  it('exposes a filterState object mirroring the individual filters', () => {
    const { result } = renderHook(() => useBillsFilters());
    act(() => {
      result.current.setNameSearch('rent');
      result.current.setSelectedAccountIds(['acc-1']);
    });
    expect(result.current.filterState).toEqual({
      nameSearch: 'rent',
      selectedPayeeIds: [],
      selectedAccountIds: ['acc-1'],
      selectedCategoryIds: [],
    });
  });

  it('counts each active filter group once', () => {
    const { result } = renderHook(() => useBillsFilters());
    act(() => {
      result.current.setNameSearch('rent');
      result.current.setSelectedPayeeIds(['p1']);
      result.current.setSelectedAccountIds(['a1', 'a2']);
      result.current.setSelectedCategoryIds(['c1']);
    });
    expect(result.current.activeFilterCount).toBe(4);
  });

  it('ignores whitespace-only name searches in the active count', () => {
    const { result } = renderHook(() => useBillsFilters());
    act(() => {
      result.current.setNameSearch('   ');
    });
    expect(result.current.activeFilterCount).toBe(0);
  });

  it('clears every filter', () => {
    const { result } = renderHook(() => useBillsFilters());
    act(() => {
      result.current.setNameSearch('rent');
      result.current.setSelectedPayeeIds(['p1']);
      result.current.setSelectedAccountIds(['a1']);
      result.current.setSelectedCategoryIds(['c1']);
    });
    act(() => {
      result.current.clearFilters();
    });
    expect(result.current.nameSearch).toBe('');
    expect(result.current.selectedPayeeIds).toEqual([]);
    expect(result.current.selectedAccountIds).toEqual([]);
    expect(result.current.selectedCategoryIds).toEqual([]);
    expect(result.current.activeFilterCount).toBe(0);
  });

  it('toggles the expanded state independently of filters', () => {
    const { result } = renderHook(() => useBillsFilters());
    act(() => {
      result.current.setFiltersExpanded(true);
    });
    expect(result.current.filtersExpanded).toBe(true);
    expect(result.current.activeFilterCount).toBe(0);
  });
});
