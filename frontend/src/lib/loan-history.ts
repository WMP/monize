import { Account } from '@/types/account';
import { Transaction } from '@/types/transaction';
import { transactionsApi } from '@/lib/transactions';

/**
 * Historical loan-payment derivation shared by the loan reports and the loan
 * detail page. Extracted verbatim from LoanAmortizationReport /
 * DebtPayoffTimelineReport so their rendered numbers are unchanged.
 *
 * Payments to the loan appear as positive transactions on the loan account;
 * the interest portion lives on the linked source-account transaction as the
 * split that does not transfer back to the loan.
 */

export interface LoanPaymentEvent {
  /** ISO transaction date (yyyy-MM-dd) */
  date: string;
  principal: number;
  interest: number;
  /** Balance remaining after this payment */
  balance: number;
  cumulativePrincipal: number;
  cumulativeInterest: number;
}

export interface LoanHistoryResult {
  events: LoanPaymentEvent[];
  /** Opening balance, or currentBalance + principal paid when unset */
  startingBalance: number;
  currentBalance: number;
  cumulativePrincipal: number;
  cumulativeInterest: number;
}

export function deriveLoanPaymentHistory(
  account: Account,
  transactions: Transaction[],
): LoanHistoryResult {
  const loanAccountId = account.id;

  const sortedTransactions = [...transactions]
    .filter((t) => t.amount > 0)
    .sort((a, b) => new Date(a.transactionDate).getTime() - new Date(b.transactionDate).getTime());

  const totalPrincipalPaid = sortedTransactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);

  const openingBalance = Math.abs(account.openingBalance || 0);
  const currentBalance = Math.abs(account.currentBalance || 0);
  const calculatedOriginalBalance = currentBalance + totalPrincipalPaid;

  const startingBalance = openingBalance > 0 ? openingBalance : calculatedOriginalBalance;
  let runningBalance = startingBalance;
  let cumulativePrincipal = 0;
  let cumulativeInterest = 0;

  // A source-account payment covering multiple loan transfers (e.g. regular +
  // extra principal) carries one interest split; count it once.
  const processedParentIds = new Set<string>();
  const events: LoanPaymentEvent[] = [];

  for (const transaction of sortedTransactions) {
    const principal = Math.abs(transaction.amount);
    let interest = 0;

    const linkedTx = transaction.linkedTransaction;
    if (linkedTx?.splits && linkedTx.splits.length > 0) {
      if (!processedParentIds.has(linkedTx.id)) {
        processedParentIds.add(linkedTx.id);
        const interestSplit = linkedTx.splits.find(
          (s) => s.transferAccountId !== loanAccountId,
        );
        if (interestSplit) {
          interest = Math.abs(interestSplit.amount);
        }
      }
    }

    runningBalance = Math.max(0, runningBalance - principal);
    cumulativePrincipal += principal;
    cumulativeInterest += interest;

    events.push({
      date: transaction.transactionDate,
      principal,
      interest,
      balance: runningBalance,
      cumulativePrincipal,
      cumulativeInterest,
    });
  }

  return {
    events,
    startingBalance,
    currentBalance,
    cumulativePrincipal,
    cumulativeInterest,
  };
}

/**
 * Fetch every transaction for an account, paginating through the API's
 * 200-per-page limit.
 */
export async function fetchAllAccountTransactions(accountId: string): Promise<Transaction[]> {
  let allTransactions: Transaction[] = [];
  let page = 1;
  let hasMore = true;
  while (hasMore) {
    const result = await transactionsApi.getAll({
      accountId,
      limit: 200,
      page,
    });
    allTransactions = allTransactions.concat(result.data);
    hasMore = result.pagination.hasMore;
    page++;
  }
  return allTransactions;
}
