import type { SpecialCategoryFilterId } from '@/lib/categoryUtils';

/**
 * What a drill-down from a report into Transactions filters by. `categoryId`
 * is a category's id or one of the `SPECIAL_CATEGORY_FILTER_IDS` pseudo-ids
 * (`uncategorized`, `transfer`, ...); `categoryType` asks for every category of
 * one type, which `useTransactionFilters` reads ahead of `categoryId`.
 */
export interface TransactionsHrefOptions {
  categoryId?: string | SpecialCategoryFilterId | null;
  accountIds?: readonly string[];
  startDate?: string;
  endDate?: string;
  categoryType?: 'income' | 'expense';
}

/**
 * The Transactions URL a report links to, in the parameters
 * `useTransactionFilters` reads: `categoryId`, `categoryType`, `accountIds`
 * (comma-separated), `startDate`, `endDate`. An absent or empty value is left
 * out, since any parameter at all replaces the reader's stored filters.
 */
export function buildTransactionsHref(options: TransactionsHrefOptions): string {
  const params = new URLSearchParams();
  if (options.categoryType) params.set('categoryType', options.categoryType);
  if (options.categoryId) params.set('categoryId', options.categoryId);
  if (options.accountIds && options.accountIds.length > 0) {
    params.set('accountIds', options.accountIds.join(','));
  }
  if (options.startDate) params.set('startDate', options.startDate);
  if (options.endDate) params.set('endDate', options.endDate);
  const query = params.toString();
  return query ? `/transactions?${query}` : '/transactions';
}
