import { describe, it, expect } from 'vitest';
import {
  brokerageMarketValue,
  buildBrokerageMarketValues,
} from './brokerage-market-value';
import type { Account } from '@/types/account';
import type { PortfolioSummary } from '@/types/investment';

const brokerage = (id: string): Account =>
  ({
    id,
    name: `Brokerage ${id}`,
    accountType: 'INVESTMENT',
    accountSubType: 'INVESTMENT_BROKERAGE',
    currencyCode: 'CAD',
    currentBalance: 0,
    isClosed: false,
  }) as unknown as Account;

const chequing = (id: string): Account =>
  ({
    id,
    name: 'Chequing',
    accountType: 'CHECKING',
    currencyCode: 'CAD',
    currentBalance: 500,
    isClosed: false,
  }) as unknown as Account;

const summary = (
  rows: Array<{ accountId: string; totalMarketValue: number | null }>,
): PortfolioSummary =>
  ({ holdingsByAccount: rows }) as unknown as PortfolioSummary;

describe('buildBrokerageMarketValues', () => {
  it('keeps a known value, including a real zero', () => {
    const map = buildBrokerageMarketValues(
      [brokerage('a'), brokerage('b')],
      summary([
        { accountId: 'a', totalMarketValue: 1234.5 },
        { accountId: 'b', totalMarketValue: 0 },
      ]),
    );

    expect(brokerageMarketValue(map, 'a')).toBe(1234.5);
    // A brokerage that holds nothing is worth zero. Reporting that as unknown
    // would make "nothing to show" indistinguishable from "cannot compute".
    expect(brokerageMarketValue(map, 'b')).toBe(0);
  });

  it('keeps an unknown value unknown rather than substituting zero', () => {
    const map = buildBrokerageMarketValues(
      [brokerage('a')],
      summary([{ accountId: 'a', totalMarketValue: null }]),
    );

    expect(brokerageMarketValue(map, 'a')).toBeNull();
  });

  it('treats a brokerage absent from a loaded summary as holding nothing', () => {
    const map = buildBrokerageMarketValues([brokerage('a')], summary([]));

    expect(brokerageMarketValue(map, 'a')).toBe(0);
  });

  it('treats a failed portfolio load as unknown for every brokerage', () => {
    // A failed lookup is not an empty dataset. Before this, a portfolio request
    // that threw rendered every brokerage account as a 0.00 balance.
    const map = buildBrokerageMarketValues(
      [brokerage('a'), brokerage('b')],
      null,
    );

    expect(brokerageMarketValue(map, 'a')).toBeNull();
    expect(brokerageMarketValue(map, 'b')).toBeNull();
  });

  it('does not enter non-brokerage accounts', () => {
    const map = buildBrokerageMarketValues(
      [chequing('c'), brokerage('a')],
      summary([{ accountId: 'a', totalMarketValue: 10 }]),
    );

    expect(map.has('c')).toBe(false);
    expect(map.size).toBe(1);
  });

  it('reads a missing key as unknown, not as zero', () => {
    // The accessor is the guard: `map.get(id) ?? 0` was the defect, and an
    // absent key must not resolve to a number through it either.
    expect(brokerageMarketValue(new Map(), 'nope')).toBeNull();
    expect(brokerageMarketValue(undefined, 'nope')).toBeNull();
  });
});
