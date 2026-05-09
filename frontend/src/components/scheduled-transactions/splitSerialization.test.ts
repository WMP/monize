import { describe, expect, it } from 'vitest';
import { toOverrideSplits } from './splitSerialization';
import type { SplitRow } from '@/components/transactions/SplitEditor';

describe('toOverrideSplits', () => {
  it('preserves splitKind and the investment payload for investment-kind rows', () => {
    const rows: SplitRow[] = [
      {
        id: '1',
        splitType: 'category',
        categoryId: 'cat-income',
        amount: 1000,
        memo: '',
      },
      {
        id: '2',
        splitType: 'category',
        categoryId: 'cat-tax',
        amount: -250,
        memo: '',
      },
      {
        id: '3',
        splitType: 'investment',
        amount: -750,
        memo: '',
        investment: {
          action: 'BUY',
          securityId: 'sec-1',
          quantity: 75,
          price: 10,
          commission: 0,
          exchangeRate: 1,
        },
      },
    ];
    const out = toOverrideSplits(rows);
    expect(out).toHaveLength(3);
    expect(out[2]).toMatchObject({
      splitKind: 'investment',
      categoryId: null,
      transferAccountId: null,
      amount: -750,
      investment: {
        action: 'BUY',
        securityId: 'sec-1',
        quantity: 75,
        price: 10,
      },
    });
  });

  it('clears categoryId/transferAccountId for non-matching kinds', () => {
    const rows: SplitRow[] = [
      {
        id: '1',
        splitType: 'transfer',
        transferAccountId: 'acc-2',
        // categoryId stale leftover; should be cleared on output
        categoryId: 'cat-stale',
        amount: -50,
        memo: '',
      },
      {
        id: '2',
        splitType: 'category',
        categoryId: 'cat-1',
        // transferAccountId stale; should be cleared on output
        transferAccountId: 'acc-stale',
        amount: -50,
        memo: '',
      },
    ];
    const out = toOverrideSplits(rows);
    expect(out[0]).toMatchObject({
      splitKind: 'transfer',
      transferAccountId: 'acc-2',
      categoryId: null,
    });
    expect(out[1]).toMatchObject({
      splitKind: 'category',
      categoryId: 'cat-1',
      transferAccountId: null,
    });
  });

  it('omits investment payload on non-investment rows', () => {
    const rows: SplitRow[] = [
      {
        id: '1',
        splitType: 'category',
        categoryId: 'cat-1',
        amount: -10,
        memo: '',
        // Stale investment payload - should be dropped on output
        investment: {
          action: 'BUY',
          securityId: 'sec-x',
          quantity: 1,
          price: 1,
        } as any,
      },
    ];
    const out = toOverrideSplits(rows);
    expect(out[0].investment).toBeUndefined();
  });
});
