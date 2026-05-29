import { ScheduledTransaction } from '@/types/scheduled-transaction';
import { Payee } from '@/types/payee';

export interface BillsFilterState {
  nameSearch: string;
  selectedPayeeIds: string[];
  selectedAccountIds: string[];
  selectedCategoryIds: string[];
}

export const EMPTY_BILLS_FILTER_STATE: BillsFilterState = {
  nameSearch: '',
  selectedPayeeIds: [],
  selectedAccountIds: [],
  selectedCategoryIds: [],
};

/**
 * Build the distinct list of payees referenced by a set of scheduled
 * transactions, sorted alphabetically. Used to populate the payee filter
 * dropdown without an extra API call.
 */
export function derivePayeesFromScheduledTransactions(
  transactions: ScheduledTransaction[],
): Payee[] {
  const byId = new Map<string, Payee>();
  transactions.forEach((t) => {
    if (!t.payeeId || byId.has(t.payeeId)) return;
    const name = t.payeeName || t.payee?.name || 'Unknown payee';
    byId.set(t.payeeId, { id: t.payeeId, name, createdAt: '', updatedAt: '' });
  });
  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Apply the Bills & Deposits filters (name, payee, account, category) to a
 * list of scheduled transactions. Filtering is client-side and immutable.
 */
export function filterScheduledTransactions(
  transactions: ScheduledTransaction[],
  filters: BillsFilterState,
): ScheduledTransaction[] {
  const name = filters.nameSearch.trim().toLowerCase();

  return transactions.filter((t) => {
    if (name && !(t.name || '').toLowerCase().includes(name)) {
      return false;
    }

    if (
      filters.selectedAccountIds.length > 0 &&
      !filters.selectedAccountIds.includes(t.accountId)
    ) {
      return false;
    }

    if (filters.selectedPayeeIds.length > 0) {
      if (!t.payeeId || !filters.selectedPayeeIds.includes(t.payeeId)) {
        return false;
      }
    }

    if (filters.selectedCategoryIds.length > 0) {
      const matchesTopLevel =
        !!t.categoryId && filters.selectedCategoryIds.includes(t.categoryId);
      const matchesSplit = (t.splits || []).some(
        (s) => !!s.categoryId && filters.selectedCategoryIds.includes(s.categoryId),
      );
      if (!matchesTopLevel && !matchesSplit) {
        return false;
      }
    }

    return true;
  });
}

export function countActiveBillsFilters(filters: BillsFilterState): number {
  let count = 0;
  if (filters.nameSearch.trim()) count++;
  if (filters.selectedPayeeIds.length > 0) count++;
  if (filters.selectedAccountIds.length > 0) count++;
  if (filters.selectedCategoryIds.length > 0) count++;
  return count;
}
