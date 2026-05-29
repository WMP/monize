import { useState, useMemo, useCallback } from 'react';
import {
  BillsFilterState,
  countActiveBillsFilters,
} from '@/lib/bills-filters';

/**
 * State management for the Bills & Deposits filter panel. Mirrors the
 * useTransactionFilters pattern: plain useState with derived active count
 * and a clear helper.
 */
export function useBillsFilters() {
  const [nameSearch, setNameSearch] = useState('');
  const [selectedPayeeIds, setSelectedPayeeIds] = useState<string[]>([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  const filterState: BillsFilterState = useMemo(
    () => ({
      nameSearch,
      selectedPayeeIds,
      selectedAccountIds,
      selectedCategoryIds,
    }),
    [nameSearch, selectedPayeeIds, selectedAccountIds, selectedCategoryIds],
  );

  const activeFilterCount = useMemo(
    () => countActiveBillsFilters(filterState),
    [filterState],
  );

  const clearFilters = useCallback(() => {
    setNameSearch('');
    setSelectedPayeeIds([]);
    setSelectedAccountIds([]);
    setSelectedCategoryIds([]);
  }, []);

  return {
    nameSearch,
    setNameSearch,
    selectedPayeeIds,
    setSelectedPayeeIds,
    selectedAccountIds,
    setSelectedAccountIds,
    selectedCategoryIds,
    setSelectedCategoryIds,
    filtersExpanded,
    setFiltersExpanded,
    filterState,
    activeFilterCount,
    clearFilters,
  };
}
