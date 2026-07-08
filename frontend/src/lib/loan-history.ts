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

  const sortedTransactions = [...transactions].sort(
    (a, b) => new Date(a.transactionDate).getTime() - new Date(b.transactionDate).getTime(),
  );

  // On a debt account the balance is stored negative. Repayments post as
  // positive amounts (raising the balance toward zero); draws post as negative
  // amounts (driving it further into debt). Summing only the repayments would
  // count every payoff across the account's life while dropping the offsetting
  // draws -- which is exactly what inflates a revolving line of credit whose
  // real balance cycled near zero.
  const openingSigned = Number(account.openingBalance) || 0;
  const currentBalance = Math.abs(Number(account.currentBalance) || 0);
  const repayments = sortedTransactions.filter((t) => Number(t.amount) > 0);
  const hasDraws = sortedTransactions.some((t) => Number(t.amount) < 0);
  const totalPrincipalPaid = repayments.reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0);

  // Anchor to the real opening balance whenever we have one, or the account is
  // revolving (has draws). Only reconstruct the original principal by summing
  // repayments for an amortizing loan imported without an opening balance and
  // with no draws -- the one case where the true opening is genuinely unknown.
  const useReconstruction = openingSigned === 0 && !hasDraws;
  const startingBalance = useReconstruction
    ? currentBalance + totalPrincipalPaid
    : debtMagnitude(openingSigned);

  let cumulativePrincipal = 0;
  let cumulativeInterest = 0;

  // A source-account payment covering multiple loan transfers (e.g. regular +
  // extra principal) carries one interest split; count it once.
  const processedParentIds = new Set<string>();
  const events: LoanPaymentEvent[] = [];

  if (useReconstruction) {
    // Legacy path: monotonic amortizing loan, balance decreasing from the
    // reconstructed principal by each repayment.
    let runningBalance = startingBalance;
    for (const transaction of repayments) {
      const principal = Math.abs(Number(transaction.amount));
      const interest = readInterest(transaction, loanAccountId, processedParentIds);
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
  } else {
    // Ledger path: track the true signed running balance so draws and
    // repayments both count. Emit an event per repayment with the debt
    // magnitude at that point.
    let runningSigned = openingSigned;
    for (const transaction of sortedTransactions) {
      runningSigned += Number(transaction.amount);
      if (Number(transaction.amount) <= 0) continue; // draws move the balance, no row
      const principal = Math.abs(Number(transaction.amount));
      const interest = readInterest(transaction, loanAccountId, processedParentIds);
      cumulativePrincipal += principal;
      cumulativeInterest += interest;
      events.push({
        date: transaction.transactionDate,
        principal,
        interest,
        balance: debtMagnitude(runningSigned),
        cumulativePrincipal,
        cumulativeInterest,
      });
    }
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
 * Debt owed for a signed account balance. Debt accounts store the balance
 * negative, so the outstanding amount is `-balance`, floored at zero so an
 * overpaid balance (in credit) reads as paid off rather than as fresh debt.
 */
function debtMagnitude(signedBalance: number): number {
  return Math.max(0, -signedBalance);
}

/**
 * The interest portion of a payment lives on the linked source-account
 * transaction as the split that does not transfer back to the loan. A single
 * source payment covering several loan transfers is counted only once.
 */
function readInterest(
  transaction: Transaction,
  loanAccountId: string,
  processedParentIds: Set<string>,
): number {
  const linkedTx = transaction.linkedTransaction;
  if (!linkedTx?.splits || linkedTx.splits.length === 0) return 0;
  if (processedParentIds.has(linkedTx.id)) return 0;
  processedParentIds.add(linkedTx.id);
  const interestSplit = linkedTx.splits.find((s) => s.transferAccountId !== loanAccountId);
  return interestSplit ? Math.abs(interestSplit.amount) : 0;
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
