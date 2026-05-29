import { describe, it, expect } from 'vitest';
import {
  filterScheduledTransactions,
  derivePayeesFromScheduledTransactions,
  countActiveBillsFilters,
  EMPTY_BILLS_FILTER_STATE,
  BillsFilterState,
} from '../bills-filters';
import { ScheduledTransaction } from '@/types/scheduled-transaction';

function makeTransaction(
  overrides: Partial<ScheduledTransaction>,
): ScheduledTransaction {
  return {
    id: overrides.id ?? 'id',
    userId: 'user',
    name: 'Bill',
    accountId: 'acct-1',
    categoryId: null,
    payeeId: null,
    amount: -10,
    type: 'expense',
    frequency: 'MONTHLY' as ScheduledTransaction['frequency'],
    startDate: '2026-01-01',
    nextDueDate: '2026-06-01',
    isActive: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  };
}

const filters = (overrides: Partial<BillsFilterState>): BillsFilterState => ({
  ...EMPTY_BILLS_FILTER_STATE,
  ...overrides,
});

describe('filterScheduledTransactions', () => {
  const netflix = makeTransaction({
    id: 'a',
    name: 'Netflix Subscription',
    accountId: 'acct-1',
    payeeId: 'payee-netflix',
    categoryId: 'cat-entertainment',
  });
  const rent = makeTransaction({
    id: 'b',
    name: 'Monthly Rent',
    accountId: 'acct-2',
    payeeId: 'payee-landlord',
    categoryId: 'cat-housing',
  });
  const salary = makeTransaction({
    id: 'c',
    name: 'Paycheck',
    accountId: 'acct-1',
    payeeId: null,
    categoryId: 'cat-income',
    amount: 2000,
  });
  const all = [netflix, rent, salary];

  it('returns everything when no filters are active', () => {
    expect(filterScheduledTransactions(all, EMPTY_BILLS_FILTER_STATE)).toEqual(all);
  });

  it('filters by name (case-insensitive substring on the name field)', () => {
    const result = filterScheduledTransactions(all, filters({ nameSearch: 'net' }));
    expect(result).toEqual([netflix]);
  });

  it('trims whitespace-only name searches', () => {
    const result = filterScheduledTransactions(all, filters({ nameSearch: '   ' }));
    expect(result).toEqual(all);
  });

  it('filters by account', () => {
    const result = filterScheduledTransactions(
      all,
      filters({ selectedAccountIds: ['acct-2'] }),
    );
    expect(result).toEqual([rent]);
  });

  it('filters by payee and excludes transactions without a payee', () => {
    const result = filterScheduledTransactions(
      all,
      filters({ selectedPayeeIds: ['payee-netflix', 'payee-landlord'] }),
    );
    expect(result).toEqual([netflix, rent]);
  });

  it('filters by category', () => {
    const result = filterScheduledTransactions(
      all,
      filters({ selectedCategoryIds: ['cat-housing'] }),
    );
    expect(result).toEqual([rent]);
  });

  it('matches a category found in splits', () => {
    const split = makeTransaction({
      id: 'd',
      name: 'Combined',
      categoryId: null,
      splits: [
        { id: 's1', scheduledTransactionId: 'd', categoryId: 'cat-housing', amount: -5, sortOrder: 0 },
      ],
    });
    const result = filterScheduledTransactions(
      [...all, split],
      filters({ selectedCategoryIds: ['cat-housing'] }),
    );
    expect(result).toEqual([rent, split]);
  });

  it('combines multiple filters with AND semantics', () => {
    const result = filterScheduledTransactions(
      all,
      filters({ selectedAccountIds: ['acct-1'], nameSearch: 'pay' }),
    );
    expect(result).toEqual([salary]);
  });

  it('does not mutate the input array', () => {
    const input = [...all];
    filterScheduledTransactions(input, filters({ nameSearch: 'net' }));
    expect(input).toEqual(all);
  });
});

describe('derivePayeesFromScheduledTransactions', () => {
  it('returns distinct payees sorted by name', () => {
    const transactions = [
      makeTransaction({ id: '1', payeeId: 'p-z', payeeName: 'Zebra Co' }),
      makeTransaction({ id: '2', payeeId: 'p-a', payee: { id: 'p-a', name: 'Acme', createdAt: '', updatedAt: '' } }),
      makeTransaction({ id: '3', payeeId: 'p-z', payeeName: 'Zebra Co' }),
      makeTransaction({ id: '4', payeeId: null }),
    ];
    const payees = derivePayeesFromScheduledTransactions(transactions);
    expect(payees.map((p) => p.name)).toEqual(['Acme', 'Zebra Co']);
  });

  it('falls back to a placeholder when no name is available', () => {
    const payees = derivePayeesFromScheduledTransactions([
      makeTransaction({ id: '1', payeeId: 'p-x' }),
    ]);
    expect(payees).toEqual([
      { id: 'p-x', name: 'Unknown payee', createdAt: '', updatedAt: '' },
    ]);
  });
});

describe('countActiveBillsFilters', () => {
  it('counts each active filter group once', () => {
    expect(countActiveBillsFilters(EMPTY_BILLS_FILTER_STATE)).toBe(0);
    expect(
      countActiveBillsFilters(
        filters({
          nameSearch: 'rent',
          selectedPayeeIds: ['p1'],
          selectedAccountIds: ['a1', 'a2'],
          selectedCategoryIds: ['c1'],
        }),
      ),
    ).toBe(4);
  });
});
