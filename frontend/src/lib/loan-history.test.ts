import { describe, it, expect, vi, afterEach } from 'vitest';
import { deriveLoanPaymentHistory, fetchAllAccountTransactions } from './loan-history';
import { transactionsApi } from '@/lib/transactions';
import { Account } from '@/types/account';
import { Transaction, TransactionSplit } from '@/types/transaction';

vi.mock('@/lib/transactions', () => ({
  transactionsApi: {
    getAll: vi.fn(),
  },
}));

const LOAN_ID = 'loan-1';

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: LOAN_ID,
    accountType: 'LOAN',
    name: 'Car Loan',
    openingBalance: -10000,
    currentBalance: -8000,
    interestRate: 6,
    paymentAmount: 500,
    paymentFrequency: 'MONTHLY',
    isCanadianMortgage: false,
    isVariableRate: false,
    ...overrides,
  } as Account;
}

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: `tx-${Math.abs(overrides.amount ?? 0)}-${overrides.transactionDate}`,
    accountId: LOAN_ID,
    transactionDate: '2026-01-15',
    amount: 450,
    linkedTransaction: null,
    ...overrides,
  } as Transaction;
}

function withInterestSplit(
  transaction: Transaction,
  linkedId: string,
  interestAmount: number,
): Transaction {
  return {
    ...transaction,
    linkedTransaction: {
      id: linkedId,
      splits: [
        { transferAccountId: LOAN_ID, amount: -transaction.amount } as TransactionSplit,
        { transferAccountId: null, categoryId: 'cat-interest', amount: -interestAmount } as TransactionSplit,
      ],
    } as Transaction,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('deriveLoanPaymentHistory', () => {
  it('builds events from positive transactions in date order', () => {
    const account = makeAccount();
    const transactions = [
      makeTransaction({ transactionDate: '2026-02-15', amount: 460 }),
      makeTransaction({ transactionDate: '2026-01-15', amount: 450 }),
      makeTransaction({ transactionDate: '2026-01-20', amount: -100 }), // disbursement, ignored
    ];

    const result = deriveLoanPaymentHistory(account, transactions);

    expect(result.events).toHaveLength(2);
    expect(result.events[0].date).toBe('2026-01-15');
    expect(result.events[1].date).toBe('2026-02-15');
    expect(result.startingBalance).toBe(10000);
    expect(result.events[0].balance).toBe(10000 - 450);
    expect(result.events[1].balance).toBe(10000 - 450 - 460);
    expect(result.cumulativePrincipal).toBe(910);
    expect(result.currentBalance).toBe(8000);
  });

  it('reads interest from the linked transaction split that is not the loan transfer', () => {
    const account = makeAccount();
    const tx = withInterestSplit(
      makeTransaction({ transactionDate: '2026-01-15', amount: 450 }),
      'parent-1',
      50,
    );

    const result = deriveLoanPaymentHistory(account, [tx]);

    expect(result.events[0].interest).toBe(50);
    expect(result.events[0].principal).toBe(450);
    expect(result.cumulativeInterest).toBe(50);
  });

  it('counts a shared parent transaction interest split only once', () => {
    const account = makeAccount();
    // Regular + extra principal transfers from the same source payment
    const regular = withInterestSplit(
      makeTransaction({ id: 'tx-a', transactionDate: '2026-01-15', amount: 450 }),
      'parent-1',
      50,
    );
    const extra = withInterestSplit(
      makeTransaction({ id: 'tx-b', transactionDate: '2026-01-15', amount: 200 }),
      'parent-1',
      50,
    );

    const result = deriveLoanPaymentHistory(account, [regular, extra]);

    expect(result.events).toHaveLength(2);
    expect(result.cumulativeInterest).toBe(50);
    expect(result.cumulativePrincipal).toBe(650);
  });

  it('derives the starting balance from principal paid when openingBalance is unset', () => {
    const account = makeAccount({ openingBalance: 0, currentBalance: -8000 });
    const transactions = [
      makeTransaction({ transactionDate: '2026-01-15', amount: 450 }),
      makeTransaction({ transactionDate: '2026-02-15', amount: 550 }),
    ];

    const result = deriveLoanPaymentHistory(account, transactions);

    expect(result.startingBalance).toBe(8000 + 1000);
  });

  it('floors the running balance at zero', () => {
    const account = makeAccount({ openingBalance: -100, currentBalance: 0 });
    const result = deriveLoanPaymentHistory(account, [
      makeTransaction({ transactionDate: '2026-01-15', amount: 450 }),
    ]);
    expect(result.events[0].balance).toBe(0);
  });

  it('returns an empty history for no transactions', () => {
    const result = deriveLoanPaymentHistory(makeAccount(), []);
    expect(result.events).toHaveLength(0);
    expect(result.cumulativePrincipal).toBe(0);
    expect(result.cumulativeInterest).toBe(0);
  });
});

describe('fetchAllAccountTransactions', () => {
  it('paginates until hasMore is false', async () => {
    const pageOne = Array.from({ length: 200 }, (_, i) => ({ id: `tx-${i}` }));
    const pageTwo = [{ id: 'tx-200' }];
    vi.mocked(transactionsApi.getAll)
      .mockResolvedValueOnce({
        data: pageOne,
        pagination: { hasMore: true },
      } as Awaited<ReturnType<typeof transactionsApi.getAll>>)
      .mockResolvedValueOnce({
        data: pageTwo,
        pagination: { hasMore: false },
      } as Awaited<ReturnType<typeof transactionsApi.getAll>>);

    const result = await fetchAllAccountTransactions(LOAN_ID);

    expect(result).toHaveLength(201);
    expect(transactionsApi.getAll).toHaveBeenCalledTimes(2);
    expect(transactionsApi.getAll).toHaveBeenNthCalledWith(1, {
      accountId: LOAN_ID,
      limit: 200,
      page: 1,
    });
    expect(transactionsApi.getAll).toHaveBeenNthCalledWith(2, {
      accountId: LOAN_ID,
      limit: 200,
      page: 2,
    });
  });
});
