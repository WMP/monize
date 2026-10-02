import { describe, it, expect } from 'vitest';
import { buildTransactionsHref } from './transactions-href';

describe('buildTransactionsHref', () => {
  it('links a category over a range', () => {
    expect(
      buildTransactionsHref({ categoryId: 'cat-1', startDate: '2026-09-01', endDate: '2026-09-30' }),
    ).toBe('/transactions?categoryId=cat-1&startDate=2026-09-01&endDate=2026-09-30');
  });

  it('passes a pseudo-id through as the category', () => {
    expect(
      buildTransactionsHref({ categoryId: 'uncategorized', startDate: '2026-09-01', endDate: '2026-09-30' }),
    ).toBe('/transactions?categoryId=uncategorized&startDate=2026-09-01&endDate=2026-09-30');
  });

  it('joins the accounts into one comma-separated parameter', () => {
    const href = buildTransactionsHref({
      accountIds: ['a-1', 'a-2'],
      startDate: '2026-09-01',
      endDate: '2026-09-30',
    });
    expect(new URLSearchParams(href.split('?')[1]).get('accountIds')).toBe('a-1,a-2');
  });

  it('asks for a category type', () => {
    expect(buildTransactionsHref({ categoryType: 'expense', endDate: '2026-09-30' })).toBe(
      '/transactions?categoryType=expense&endDate=2026-09-30',
    );
  });

  it('leaves out what is absent or empty', () => {
    expect(buildTransactionsHref({ categoryId: null, accountIds: [] })).toBe('/transactions');
  });

  it('encodes a value the URL would otherwise misread', () => {
    const href = buildTransactionsHref({ categoryId: 'a&b=c' });
    expect(new URLSearchParams(href.split('?')[1]).get('categoryId')).toBe('a&b=c');
  });
});
