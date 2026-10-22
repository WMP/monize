import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TRANSACTION_SORT,
  TRANSACTION_SORT_FIELDS,
  isSortedByDate,
  nextTransactionSort,
  resolveRegisterSort,
} from './transaction-sort';
import type { TransactionSort } from './transaction-sort';

describe('nextTransactionSort', () => {
  it('reverses the column that is already sorted', () => {
    expect(
      nextTransactionSort({ field: 'date', direction: 'desc' }, 'date'),
    ).toEqual({
      field: 'date',
      direction: 'asc',
    });
    expect(
      nextTransactionSort({ field: 'date', direction: 'asc' }, 'date'),
    ).toEqual({
      field: 'date',
      direction: 'desc',
    });
    expect(
      nextTransactionSort({ field: 'payee', direction: 'asc' }, 'payee'),
    ).toEqual({
      field: 'payee',
      direction: 'desc',
    });
  });

  it('starts a new column in the direction that column is read', () => {
    // A register is read newest first; a name column is read A to Z.
    expect(
      nextTransactionSort({ field: 'payee', direction: 'asc' }, 'date'),
    ).toEqual({
      field: 'date',
      direction: 'desc',
    });
    expect(
      nextTransactionSort({ field: 'date', direction: 'desc' }, 'payee'),
    ).toEqual({
      field: 'payee',
      direction: 'asc',
    });
    expect(
      nextTransactionSort({ field: 'payee', direction: 'desc' }, 'category'),
    ).toEqual({
      field: 'category',
      direction: 'asc',
    });
  });

  it('starts every column somewhere', () => {
    for (const field of TRANSACTION_SORT_FIELDS) {
      const next = nextTransactionSort(DEFAULT_TRANSACTION_SORT, field);
      expect(next.field).toBe(field);
      expect(['asc', 'desc']).toContain(next.direction);
    }
  });
});

describe('resolveRegisterSort', () => {
  const nothingHidden: ReadonlySet<string> = new Set();

  it('drops an account sort where there is no Account column to click', () => {
    // The column is not rendered on a single account's page, so a stored
    // account sort would order the register by a header nobody can reach.
    const stored: TransactionSort = { field: 'account', direction: 'asc' };
    expect(resolveRegisterSort(stored, true, nothingHidden)).toEqual(
      DEFAULT_TRANSACTION_SORT,
    );
    // Storage is untouched, so widening the filter brings it back.
    expect(resolveRegisterSort(stored, false, nothingHidden)).toBe(stored);
  });

  it('leaves every other field alone on either kind of page', () => {
    for (const field of TRANSACTION_SORT_FIELDS.filter(
      (f) => f !== 'account',
    )) {
      const sort: TransactionSort = { field, direction: 'asc' };
      expect(resolveRegisterSort(sort, true, nothingHidden)).toBe(sort);
      expect(resolveRegisterSort(sort, false, nothingHidden)).toBe(sort);
    }
  });

  it('drops a sort on a column the reader has hidden, storage untouched', () => {
    // A hidden column has no header at any width and no chip on a phone, so
    // a register ordered by it would also withhold the running balance with
    // nothing on screen to sort by date again. The same shape as the Account
    // rule: the fallback is for this render only, and showing the column
    // again restores the remembered sort.
    for (const field of ['description', 'refNumber', 'status'] as const) {
      const stored: TransactionSort = { field, direction: 'asc' };
      const hidden = new Set<string>([field]);
      expect(resolveRegisterSort(stored, false, hidden)).toEqual(
        DEFAULT_TRANSACTION_SORT,
      );
      expect(resolveRegisterSort(stored, true, hidden)).toEqual(
        DEFAULT_TRANSACTION_SORT,
      );
      expect(resolveRegisterSort(stored, false, nothingHidden)).toBe(stored);
    }
    // A hidden column the sort is not on changes nothing.
    const byPayee: TransactionSort = { field: 'payee', direction: 'asc' };
    expect(
      resolveRegisterSort(byPayee, false, new Set(['status', 'tags'])),
    ).toBe(byPayee);
  });

  it('refuses a remembered value the server would refuse', () => {
    // Browser storage outlives the code that wrote it. Sent verbatim, each of
    // these is a 400 on every register read, and the headers that could change
    // it never render -- so the page has no way out but clearing site data.
    const cases = [
      { field: 'runningBalance', direction: 'asc' },
      { field: 'date', direction: 'descending' },
      { field: '', direction: 'asc' },
      undefined,
      null,
    ];
    for (const stored of cases) {
      expect(resolveRegisterSort(stored as never, false, nothingHidden)).toEqual(
        DEFAULT_TRANSACTION_SORT,
      );
      expect(resolveRegisterSort(stored as never, true, nothingHidden)).toEqual(
        DEFAULT_TRANSACTION_SORT,
      );
    }
  });
});

describe('isSortedByDate', () => {
  it('is true for a register that offers no sorting at all', () => {
    // Every surface but the Transactions page renders plain headers and takes
    // the server's default order, which is by date.
    expect(isSortedByDate(undefined)).toBe(true);
  });

  it('is true in either date direction and false for every other column', () => {
    expect(isSortedByDate({ field: 'date', direction: 'asc' })).toBe(true);
    expect(isSortedByDate({ field: 'date', direction: 'desc' })).toBe(true);
    for (const field of TRANSACTION_SORT_FIELDS.filter((f) => f !== 'date')) {
      expect(isSortedByDate({ field, direction: 'asc' })).toBe(false);
    }
  });
});
