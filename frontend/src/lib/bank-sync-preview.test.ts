import { describe, it, expect } from 'vitest';
import {
  filterPreviewRows,
  initialPreviewFilter,
  previewAmount,
  previewFilterCounts,
} from './bank-sync-preview';
import type { BankSyncPreviewRow } from '@/types/bank-sync';

const row = (outcome: BankSyncPreviewRow['outcome'], over: Partial<BankSyncPreviewRow> = {}): BankSyncPreviewRow => ({
  outcome,
  refusalReason: null,
  transactionDate: '2026-09-10',
  amount: '-10.0000',
  currencyCode: 'PLN',
  payeeText: 'Shop',
  description: null,
  referenceNumber: null,
  payeeName: null,
  categoryName: null,
  tagNames: [],
  ...over,
});

const ROWS = [
  row('new', { payeeText: 'a' }),
  row('new', { payeeText: 'b' }),
  row('duplicate'),
  row('refused', { refusalReason: 'currency_mismatch' }),
  row('pending'),
  row('before_cutoff'),
  row('before_cutoff'),
];

describe('previewFilterCounts', () => {
  it('counts every tab from the rows', () => {
    expect(previewFilterCounts(ROWS)).toEqual({
      all: 7,
      new: 2,
      duplicate: 1,
      refused: 1,
      pending: 1,
      before_cutoff: 2,
    });
  });

  it('is all zeros for no rows', () => {
    expect(previewFilterCounts([])).toEqual({
      all: 0,
      new: 0,
      duplicate: 0,
      refused: 0,
      pending: 0,
      before_cutoff: 0,
    });
  });
});

describe('filterPreviewRows', () => {
  it('shows every row for all, in the bank order, as a copy', () => {
    const shown = filterPreviewRows(ROWS, 'all');
    expect(shown).toEqual(ROWS);
    expect(shown).not.toBe(ROWS);
  });

  it('shows only the rows of one outcome, in order', () => {
    expect(filterPreviewRows(ROWS, 'new').map((r) => r.payeeText)).toEqual(['a', 'b']);
    expect(filterPreviewRows(ROWS, 'refused')).toHaveLength(1);
    expect(filterPreviewRows(ROWS, 'before_cutoff')).toHaveLength(2);
  });

  it('shows nothing for an outcome no row has', () => {
    expect(filterPreviewRows([row('new')], 'pending')).toEqual([]);
  });
});

describe('previewAmount', () => {
  it('reads a decimal string', () => {
    expect(previewAmount('-12.3400')).toBe(-12.34);
    expect(previewAmount('0.0000')).toBe(0);
  });

  it.each([null, undefined, '', '  ', 'abc'])('is null for %p, never zero', (value) => {
    expect(previewAmount(value)).toBeNull();
  });
});

describe('initialPreviewFilter', () => {
  const summary = (n: number) => ({
    summary: { new: n, duplicate: 0, refused: 0, refusedByReason: {}, pending: 0, beforeCutoff: 0 },
  });

  it('opens on the new rows when there are any', () => {
    expect(initialPreviewFilter(summary(3))).toBe('new');
  });

  it('opens on all rows when nothing is new', () => {
    expect(initialPreviewFilter(summary(0))).toBe('all');
  });
});
