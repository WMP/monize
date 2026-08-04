import { Account } from '@/types/account';
import { Transaction, TransactionSplit } from '@/types/transaction';
import { transactionsApi } from '@/lib/transactions';
import {
  LoanScheduleInput,
  ScheduleFrequency,
  RateTimelineRow,
  advanceDate,
  buildRateTimeline,
  effectiveAnnualRateOn,
  firstPeriodInterest,
  getPeriodicRate,
  getPeriodsPerYear,
} from '@/lib/loan-schedule';

/**
 * Historical loan-payment derivation shared by the loan reports and the loan
 * detail page.
 *
 * Payments to the loan appear as positive transactions on the loan account.
 * The interest portion of a regular installment is recovered, in order of
 * preference:
 *   1. an overpayment recognized by the loan's overpayment category or its
 *      overpayment memo text is 100% principal, so its interest is 0 and the
 *      row is flagged OVERPAYMENT;
 *   2. otherwise, if the linked source-account transaction carries an interest
 *      split (the shape ScheduledTransactionLoanService builds), that recorded
 *      interest is used -- exact even on variable-rate loans;
 *   3. otherwise, for a loan with no separately-booked interest at all, the
 *      interest is derived analytically from the running balance at the rate in
 *      effect on that date (`balance * periodicRate`, using the rate timeline
 *      when supplied), so a plain principal-only transfer shows a realistic
 *      interest that tracks the bank rather than 100% principal. When the loan
 *      DOES book interest as separate expenses, a payment with no paired expense
 *      carried no interest of its own (it is already represented by the booked
 *      expenses), so it is left at 0 rather than given an analytic estimate.
 *
 * The balance walk is unchanged -- it always tracks the actual ledger amount,
 * so the projected balance still ends at the account's current balance.
 */

export type LoanPaymentType = 'REGULAR' | 'OVERPAYMENT';

export interface LoanPaymentEvent {
  /** ISO transaction date (yyyy-MM-dd) */
  date: string;
  principal: number;
  interest: number;
  /** Balance remaining after this payment */
  balance: number;
  cumulativePrincipal: number;
  cumulativeInterest: number;
  /** REGULAR installment or a standalone OVERPAYMENT (extra principal) */
  type: LoanPaymentType;
  /**
   * The annual interest rate (percentage) for this installment. When the loan
   * has a recorded rate history it is the exact rate in effect on this row's
   * date (the clean, discrete history); with no rate history it falls back to
   * the rate reconstructed from the interest charged (`interest /
   * balanceBefore x periodsPerYear`). Null for overpayments. Always populated
   * by `deriveLoanPaymentHistory`; optional only so test fixtures that build
   * events by hand need not supply it.
   */
  annualRate?: number | null;
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
  rateChanges: RateTimelineRow[] = [],
  // Interest booked as separate categorized expenses (not a split leg) on the
  // payment's source account. When supplied, each payment's interest is the
  // actual expense paired to its date -- exact, matching the lender -- and
  // overpayments show the interest charged alongside them. Excludes transfers
  // (a principal transfer that happens to share the interest category is not
  // interest). Falls back to the split/analytic paths when none is paired.
  interestTransactions: Transaction[] = [],
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
  // debtMagnitude, not Math.abs: a debt account holding a positive signed
  // balance is a credit/overpayment, not fresh debt, so it must floor to 0
  // rather than abs-value into "still owed". Math.abs on a +25 credit read
  // currentBalance as 25 and loanPaidOff as false, so a later refinanced loan
  // sharing this loan's source account and interest category had its interest
  // transactions never bounded by the payoff date (REV-20260803-033).
  const currentBalance = debtMagnitude(Number(account.currentBalance) || 0);
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
  // The signed-ledger balance after every transaction, draws included -- not
  // only the ones that emit a row. Orphan interest events (below) have no
  // principal leg of their own, so their balance is looked up here instead of
  // carried from the last *emitted* event: that previously skipped over any
  // draw that landed between the last payment and the orphan charge, showing
  // the pre-draw balance on the orphan row and reconstructing its rate off the
  // wrong debt (REV-20260803-034).
  const balanceTimeline: { date: string; balance: number }[] = [];

  // Separately-booked interest is already scoped to this loan by its configured
  // interest category and source account (see fetchLoanInterestTransactions), so
  // include all of it regardless of date. A loan account legitimately has
  // activity before its configured start date -- an interest-only grace period,
  // or history migrated from another tool -- and those payments must still show
  // and count in the schedule and every figure derived from it, rather than
  // being truncated at a start date that is often set later than the real first
  // payment. The only bound kept is the upper one for a fully paid-off loan, so
  // interest later booked in the same category (e.g. a subsequent loan) is not
  // absorbed after this one is gone; an active loan still accrues to today.
  const lastTransactionDate =
    sortedTransactions.length > 0
      ? sortedTransactions[sortedTransactions.length - 1].transactionDate.split('T')[0]
      : null;
  const loanPaidOff = currentBalance <= 0.01;
  const scopedInterestTransactions = interestTransactions.filter((tx) => {
    if (!loanPaidOff || !lastTransactionDate) return true;
    return tx.transactionDate.split('T')[0] <= lastTransactionDate;
  });

  // A source-account payment covering multiple loan transfers (e.g. regular +
  // extra principal) carries one interest split; count it once.
  const processedParentIds = new Set<string>();
  // Actual interest expenses paired to each payment date. Each date's interest
  // is consumed once, so two rows on the same date can't double-count it.
  // Expenses with no payment in range (interest-only periods) become their own
  // rows below.
  const { byDate: separateInterestByDate, orphans: orphanInterest } =
    pairSeparateInterestByDate(
      scopedInterestTransactions,
      repayments.map((t) => t.transactionDate.split('T')[0]),
    );
  // Whether this loan books interest as separate expenses. When it does, a
  // payment with no paired interest carried none of its own (the interest for
  // its date is already represented by the booked expenses), so it must not
  // receive an analytic estimate -- see classifyPayment. Derived from the
  // pairing output (not the raw list) so all-transfer / zero-amount inputs,
  // which pairSeparateInterestByDate discards, don't falsely disable the
  // analytic fallback.
  const hasSeparateInterest =
    separateInterestByDate.size > 0 || orphanInterest.length > 0;
  const usedInterestDates = new Set<string>();
  // Which transaction, per date, is entitled to that date's real separate
  // interest expense -- resolved once, up front, for the whole date group
  // rather than left to whichever transaction classifyPayment happens to
  // process first. Without this, an overpayment and a regular payment
  // sharing a date raced for the one real charge on a first-come basis: the
  // loser fell back to 0 (suppressed by hasSeparateInterest below), so the
  // total stayed correct, but *which* row showed the real interest -- and
  // therefore whether the regular installment's annualRate could be
  // reconstructed from it at all -- depended on nothing but input array
  // order (REV-20260803-035).
  const interestOwnerByDate = resolveInterestOwnerByDate(
    repayments,
    account,
    loanAccountId,
  );
  const events: LoanPaymentEvent[] = [];

  // Day count for the very first row's rate, where there is no prior payment to
  // measure the accrual period against; later rows use the actual gap.
  const periodsPerYear = account.paymentFrequency
    ? getPeriodsPerYear(account.paymentFrequency as ScheduleFrequency)
    : 12;

  if (useReconstruction) {
    // Legacy path: monotonic amortizing loan, balance decreasing from the
    // reconstructed principal by each repayment.
    let runningBalance = startingBalance;
    for (const transaction of repayments) {
      const principal = Math.abs(Number(transaction.amount));
      const { interest, type } = classifyPayment(
        transaction,
        runningBalance,
        account,
        loanAccountId,
        processedParentIds,
        rateChanges,
        separateInterestByDate,
        usedInterestDates,
        hasSeparateInterest,
        interestOwnerByDate,
      );
      runningBalance = Math.max(0, runningBalance - principal);
      cumulativePrincipal += principal;
      cumulativeInterest += interest;
      balanceTimeline.push({ date: transaction.transactionDate, balance: runningBalance });
      events.push({
        date: transaction.transactionDate,
        principal,
        interest,
        balance: runningBalance,
        cumulativePrincipal,
        cumulativeInterest,
        type,
      });
    }
  } else {
    // Ledger path: track the true signed running balance so draws and
    // repayments both count. Emit an event per repayment with the debt
    // magnitude at that point.
    let runningSigned = openingSigned;
    for (const transaction of sortedTransactions) {
      const balanceBefore = debtMagnitude(runningSigned);
      runningSigned += Number(transaction.amount);
      // Recorded for every transaction -- including a draw, which moves the
      // balance but never emits its own row -- so the orphan-interest merge
      // below can look up the true debt as of any date, not just the dates
      // that happen to carry a principal-payment event.
      balanceTimeline.push({ date: transaction.transactionDate, balance: debtMagnitude(runningSigned) });
      if (Number(transaction.amount) <= 0) continue; // draws move the balance, no row
      const principal = Math.abs(Number(transaction.amount));
      const { interest, type } = classifyPayment(
        transaction,
        balanceBefore,
        account,
        loanAccountId,
        processedParentIds,
        rateChanges,
        separateInterestByDate,
        usedInterestDates,
        hasSeparateInterest,
        interestOwnerByDate,
      );
      cumulativePrincipal += principal;
      cumulativeInterest += interest;
      events.push({
        date: transaction.transactionDate,
        principal,
        interest,
        balance: debtMagnitude(runningSigned),
        cumulativePrincipal,
        cumulativeInterest,
        type,
      });
    }
  }

  if (orphanInterest.length === 0) {
    assignObservedRates(events, periodsPerYear, rateChanges, account);
    return {
      events,
      startingBalance,
      currentBalance,
      cumulativePrincipal,
      cumulativeInterest,
    };
  }

  // Merge interest-only rows for interest expenses with no matching principal
  // payment (an interest-only grace period before repayment begins). They carry
  // no principal, so they never move the balance; interleave them by date and
  // re-walk the cumulative totals and the balance shown on each row.
  const orphanEvents: LoanPaymentEvent[] = orphanInterest.map((tx) => ({
    date: tx.transactionDate,
    principal: 0,
    // Same separately-booked interest as takeSeparateInterest above -- keep 4dp
    // precision through the accumulation, not cents.
    interest: Math.round(Math.abs(Number(tx.amount)) * 10000) / 10000,
    balance: 0,
    cumulativePrincipal: 0,
    cumulativeInterest: 0,
    type: 'REGULAR' as const,
  }));
  const merged = [...events, ...orphanEvents].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
  let runningPrincipal = 0;
  let runningInterest = 0;
  // Sorted chronologically by construction (pushed in transaction order in
  // the reconstruction path, walked in date order in the ledger path), so a
  // single forward pointer through `balanceTimeline` in step with `merged`
  // (also date-sorted) is enough -- no re-sort needed.
  let lastBalance = startingBalance;
  let balanceIdx = 0;
  for (const event of merged) {
    runningPrincipal += event.principal;
    runningInterest += event.interest;
    event.cumulativePrincipal = runningPrincipal;
    event.cumulativeInterest = runningInterest;
    const eventDateKey = event.date.split('T')[0];
    while (
      balanceIdx < balanceTimeline.length &&
      balanceTimeline[balanceIdx].date.split('T')[0] <= eventDateKey
    ) {
      lastBalance = balanceTimeline[balanceIdx].balance;
      balanceIdx++;
    }
    if (event.principal > 0) {
      // A principal payment already carries its post-payment balance (and
      // agrees with the timeline entry for its own date).
      lastBalance = event.balance;
    } else {
      // Interest-only row: the debt is whatever the full signed ledger --
      // draws included -- says it is as of this date, not merely what it was
      // after the last *emitted* payment row.
      event.balance = lastBalance;
    }
  }
  assignObservedRates(merged, periodsPerYear, rateChanges, account);

  return {
    events: merged,
    startingBalance,
    currentBalance,
    cumulativePrincipal: runningPrincipal,
    cumulativeInterest: runningInterest,
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
 * The installment to seed a forward projection with, given the payment history:
 * the most recent regular payment's full amount, `principal + interest`. With
 * interest now taken from the rate timeline (or a recorded split), this is the
 * borrower's real current installment -- and it always covers the period's
 * interest, since the principal portion is positive, so the projection
 * amortizes. Falls back to the stored contractual payment only when there is no
 * usable regular payment yet (e.g. an interest-only grace period). The stored
 * payment is not preferred even when it is lower: for loans whose interest is
 * booked separately it often holds only the principal part and would seed a
 * non-amortizing payment.
 *
 * Returned at 4dp (decimal(20,4) storage precision), not rounded to cents:
 * this feeds `LoanScheduleInput.paymentAmount`, which the projection engine
 * uses unrounded throughout its accumulation and only rounds to cents on each
 * emitted row -- truncating the seed to cents here would lose sub-cent
 * separately-booked interest a step after it was correctly preserved through
 * the event.
 */
export function deriveCurrentInstallment(
  history: LoanHistoryResult,
  contractualPayment: number,
): number {
  const lastRegular = [...history.events]
    .reverse()
    .find((event) => event.type === 'REGULAR');
  if (!lastRegular) return contractualPayment;
  // Sum first, then round once at 4dp (decimal(20,4) storage precision) --
  // never round principal and interest separately to cents and add the
  // roundings. `buildLoanProjectionInput` feeds this straight into
  // `LoanScheduleInput.paymentAmount`, which the schedule engine consumes as
  // an unrounded float throughout its accumulation (only each emitted row is
  // rounded to cents); seeding it pre-truncated to cents here would just
  // reintroduce, one step later, the same premature-rounding loss that
  // `classifyPayment`/`analyticInterest`/the orphan-interest rows were fixed
  // to avoid (REV-20260803-036). A genuinely presented cents figure is the
  // caller's job, not this function's.
  const observed =
    Math.round((lastRegular.principal + lastRegular.interest) * 10000) / 10000;
  return observed > 0 ? observed : contractualPayment;
}

/**
 * The forward-projection input shared by the loan detail view and the loan
 * reports: a schedule that continues from today's balance at the loan's real
 * current installment. Returns null when the account cannot be projected (no
 * remaining balance, rate, payment, or frequency).
 *
 * The seed payment is the installment actually in effect -- the latest recorded
 * payment change from the rate timeline, else the real installment derived from
 * history (principal + interest of the last regular payment) -- never the stored
 * contractual `paymentAmount`, which is often stale or principal-only. When that
 * seed cannot cover the first period's interest (a principal-only figure for
 * separately-booked interest), it falls back to the derived installment, which
 * always amortizes. Future-dated rate steps bend the projection ahead; passing
 * no `rateChanges` simply omits them.
 */
export function buildLoanProjectionInput(
  account: Account,
  history: LoanHistoryResult,
  rateChanges: RateTimelineRow[] = [],
): LoanScheduleInput | null {
  const canProject =
    history.currentBalance > 0.01 &&
    account.interestRate != null &&
    !!account.paymentAmount &&
    account.paymentAmount > 0 &&
    !!account.paymentFrequency;
  if (!canProject) return null;

  const frequency = account.paymentFrequency as ScheduleFrequency;
  const isCanadian = account.isCanadianMortgage || false;
  const isVariableRate = account.isVariableRate || false;
  // The account's scalar rate is already current; only future-dated steps from
  // the rate history bend the projection ahead.
  const today = new Date().toISOString().slice(0, 10);
  const futureTimeline = buildRateTimeline(rateChanges, today, account.interestRate!);
  const installment = deriveCurrentInstallment(history, account.paymentAmount!);
  const seededPayment = futureTimeline.startingPaymentAmount ?? installment;
  const currentPayment =
    seededPayment >
    firstPeriodInterest(history.currentBalance, account.interestRate!, frequency, isCanadian, isVariableRate)
      ? seededPayment
      : installment;

  return {
    startingBalance: history.currentBalance,
    annualRate: account.interestRate!,
    paymentAmount: currentPayment,
    frequency,
    isCanadian,
    isVariableRate,
    firstPaymentDate: advanceDate(new Date(), frequency),
    rateChanges: futureTimeline.rateChanges,
  };
}

/**
 * Classify a positive loan-account transaction into its interest portion and
 * row type. Interest is resolved in order: a recorded interest split of the
 * payment; else the actual separate interest expense paired to this date (only
 * for the transaction `interestOwnerByDate` names as that date's owner -- see
 * `resolveInterestOwnerByDate`); else an analytic estimate from the running
 * balance and rate. An overpayment (recognized by the loan's overpayment
 * category / memo / payee) is extra principal, but still shows any real
 * interest charged alongside it (paired) -- never an analytic estimate.
 */
function classifyPayment(
  transaction: Transaction,
  balanceBefore: number,
  account: Account,
  loanAccountId: string,
  processedParentIds: Set<string>,
  rateChanges: RateTimelineRow[],
  separateInterestByDate: Map<string, number>,
  usedInterestDates: Set<string>,
  hasSeparateInterest: boolean,
  interestOwnerByDate: Map<string, string>,
): { interest: number; type: LoanPaymentType } {
  const dateKey = transaction.transactionDate.split('T')[0];
  // The actual interest expense paired to this date, consumed once. Which
  // transaction is allowed to take it was already decided for the whole date
  // group by `resolveInterestOwnerByDate`, so a transaction that isn't that
  // date's designated owner gets null here regardless of processing order --
  // it never grabs the charge just for having been processed first.
  const takeSeparateInterest = (): number | null => {
    if (usedInterestDates.has(dateKey)) return null;
    const owner = interestOwnerByDate.get(dateKey);
    if (owner != null && owner !== transaction.id) return null;
    const amount = separateInterestByDate.get(dateKey);
    if (amount == null || amount <= 0) return null;
    usedInterestDates.add(dateKey);
    // Preserve decimal(20,4) precision through the accumulation path -- only
    // normalize floating-point noise at 4dp, never round to cents here. The
    // running cumulativeInterest this feeds is presented at 2dp by the caller.
    return Math.round(amount * 10000) / 10000;
  };

  if (
    isOverpayment(
      transaction,
      account.overpaymentCategoryId,
      account.overpaymentMemo,
      account.overpaymentPayeeId,
      loanAccountId,
    )
  ) {
    const paired = takeSeparateInterest();
    return { interest: paired ?? 0, type: 'OVERPAYMENT' };
  }
  const recorded = readRecordedInterest(
    transaction,
    loanAccountId,
    processedParentIds,
  );
  if (recorded !== null) {
    return { interest: recorded, type: 'REGULAR' };
  }
  const paired = takeSeparateInterest();
  if (paired != null) {
    return { interest: paired, type: 'REGULAR' };
  }
  // A loan that books interest as separate expenses has this payment's interest
  // (if any) already captured by those expenses. When none is paired to this
  // payment -- e.g. a principal-only leg sharing a date with another payment
  // that already consumed the date's interest, like an overpayment and a
  // regular installment on the same day -- it genuinely carried no interest.
  // Only fall back to an analytic estimate for loans with no separate interest
  // booking at all, where the interest is not recorded anywhere else.
  if (hasSeparateInterest) {
    return { interest: 0, type: 'REGULAR' };
  }
  return {
    interest: analyticInterest(balanceBefore, account, transaction, rateChanges),
    type: 'REGULAR',
  };
}

/**
 * Whether a payment is a standalone overpayment. Recognized by the loan's
 * overpayment category, its overpayment memo text, or its overpayment payee --
 * each usable on its own or together, so any single match is sufficient.
 */
function isOverpayment(
  transaction: Transaction,
  overpaymentCategoryId: string | null | undefined,
  overpaymentMemo: string | null | undefined,
  overpaymentPayeeId: string | null | undefined,
  loanAccountId: string,
): boolean {
  return (
    matchesOverpaymentCategory(transaction, overpaymentCategoryId, loanAccountId) ||
    matchesOverpaymentMemo(transaction, overpaymentMemo, loanAccountId) ||
    matchesOverpaymentPayee(transaction, overpaymentPayeeId)
  );
}

/**
 * Whether the overpayment payee is the payee of the transaction itself or of
 * its linked source-account transaction (the payment is usually recorded with
 * the payee on the source side).
 */
function matchesOverpaymentPayee(
  transaction: Transaction,
  overpaymentPayeeId: string | null | undefined,
): boolean {
  if (!overpaymentPayeeId) return false;
  return (
    transaction.payeeId === overpaymentPayeeId ||
    transaction.linkedTransaction?.payeeId === overpaymentPayeeId
  );
}

/**
 * The parent-transaction split that produced this loan-side transfer. A split
 * source payment posts one loan transfer per transfer-split (e.g. a regular
 * principal transfer alongside an extra-principal one), and every such loan
 * transaction shares the same parent -- so only the single split that links
 * back to *this* transaction actually describes it. Correlated by the split's
 * linkedTransactionId, or, when that is unavailable (older data or imports),
 * by its transfer target and amount. Null when the parent is not a split (a
 * plain transfer) or no split corresponds.
 */
function correspondingParentSplit(
  transaction: Transaction,
  loanAccountId: string,
): TransactionSplit | null {
  const splits = transaction.linkedTransaction?.splits;
  if (!splits || splits.length === 0) return null;
  const byLink = splits.find(
    (s) => s.linkedTransactionId != null && s.linkedTransactionId === transaction.id,
  );
  if (byLink) return byLink;
  const txAmount = Math.abs(Number(transaction.amount));
  return (
    splits.find(
      (s) =>
        s.transferAccountId === loanAccountId &&
        Math.abs(Number(s.amount)) === txAmount,
    ) ?? null
  );
}

/**
 * Whether the overpayment category tags the transaction itself, its linked
 * source-account transaction, or the specific split of that linked transaction
 * that produced this transfer. When several transfers share one split parent,
 * scanning every split would wrongly flag a regular-principal sibling as an
 * overpayment, so only the correlated split is considered; scanning all splits
 * is kept solely as a fallback for data where the split cannot be correlated.
 */
function matchesOverpaymentCategory(
  transaction: Transaction,
  overpaymentCategoryId: string | null | undefined,
  loanAccountId: string,
): boolean {
  if (!overpaymentCategoryId) return false;
  if (transaction.categoryId === overpaymentCategoryId) return true;
  const linkedTx = transaction.linkedTransaction;
  if (!linkedTx) return false;
  if (linkedTx.categoryId === overpaymentCategoryId) return true;
  const own = correspondingParentSplit(transaction, loanAccountId);
  if (own) return own.categoryId === overpaymentCategoryId;
  return Boolean(
    linkedTx.splits?.some((s) => s.categoryId === overpaymentCategoryId),
  );
}

/**
 * Whether the overpayment memo text appears (case-insensitive substring) in the
 * transaction's memo, its linked source-account transaction's memo, or the
 * split that produced this transfer. As with the category match, only the
 * correlated split is inspected so a regular-principal sibling of an
 * overpayment split is not misflagged; all split memos are considered only when
 * the split cannot be correlated. The transaction-level memo is stored as
 * `description`.
 */
function matchesOverpaymentMemo(
  transaction: Transaction,
  overpaymentMemo: string | null | undefined,
  loanAccountId: string,
): boolean {
  const needle = overpaymentMemo?.trim().toLowerCase();
  if (!needle) return false;
  const linkedTx = transaction.linkedTransaction;
  const own = correspondingParentSplit(transaction, loanAccountId);
  const splitMemos = own
    ? [own.memo]
    : (linkedTx?.splits?.map((s) => s.memo) ?? []);
  const haystacks: (string | null | undefined)[] = [
    transaction.description,
    linkedTx?.description,
    ...splitMemos,
  ];
  return haystacks.some(
    (text) => !!text && text.toLowerCase().includes(needle),
  );
}

/**
 * The recorded interest of a payment lives on the linked source-account
 * transaction as the split that does not transfer back to the loan. Returns
 * null when there is no recorded interest split (so the caller falls back to
 * the analytic derivation); a single source payment covering several loan
 * transfers is counted only once.
 */
function readRecordedInterest(
  transaction: Transaction,
  loanAccountId: string,
  processedParentIds: Set<string>,
): number | null {
  const linkedTx = transaction.linkedTransaction;
  if (!linkedTx?.splits || linkedTx.splits.length === 0) return null;
  if (processedParentIds.has(linkedTx.id)) return 0;
  processedParentIds.add(linkedTx.id);
  const interestSplit = linkedTx.splits.find((s) => s.transferAccountId !== loanAccountId);
  return interestSplit ? Math.abs(interestSplit.amount) : 0;
}

/**
 * Whether a transaction carries its own recorded interest split (the same
 * condition `readRecordedInterest` checks), without the `processedParentIds`
 * bookkeeping -- a read-only predicate safe to call from a resolution pass
 * that runs before the main walk. A transaction sharing a parent with a
 * sibling loan transfer still resolves via that split (one of the two reads
 * the amount, the other reads 0 -- see `readRecordedInterest`); either way it
 * never reaches the separate-interest pool, so both are excluded here too.
 */
function hasOwnRecordedInterestSplit(transaction: Transaction, loanAccountId: string): boolean {
  const linkedTx = transaction.linkedTransaction;
  if (!linkedTx?.splits || linkedTx.splits.length === 0) return false;
  return linkedTx.splits.some((s) => s.transferAccountId !== loanAccountId);
}

/**
 * Resolve, for every date with more than one candidate, which single
 * transaction is entitled to that date's real separate interest expense --
 * decided once for the whole group rather than left to whichever transaction
 * `classifyPayment` happens to process first (REV-20260803-035). Only
 * transactions that would otherwise reach the paired-interest path are
 * considered: one with its own recorded split (`hasOwnRecordedInterestSplit`)
 * resolves independently and never touches this pool, so it is excluded from
 * consideration and cannot block a sibling from taking the real charge.
 *
 * Among the remaining candidates, a REGULAR payment (not recognized as an
 * overpayment by the loan's overpayment category / memo / payee) is preferred
 * over an OVERPAYMENT sharing the date: the real interest presumably accrued
 * against the scheduled installment, not an extra optional payment. Ties
 * within the same preference (more than one eligible REGULAR, or none and
 * more than one eligible OVERPAYMENT) keep the input order -- genuinely
 * ambiguous without more information, and not the case this resolves.
 *
 * Returns a `dateKey -> transaction.id` map; `classifyPayment` consults it so
 * a non-owner gets null from `takeSeparateInterest` regardless of processing
 * order, and the existing `hasSeparateInterest` fallback (0, not an analytic
 * estimate) already covers every other row on that date.
 */
function resolveInterestOwnerByDate(
  repayments: Transaction[],
  account: Account,
  loanAccountId: string,
): Map<string, string> {
  const groups = new Map<string, Transaction[]>();
  for (const transaction of repayments) {
    const dateKey = transaction.transactionDate.split('T')[0];
    const group = groups.get(dateKey);
    if (group) {
      group.push(transaction);
    } else {
      groups.set(dateKey, [transaction]);
    }
  }

  const owners = new Map<string, string>();
  for (const [dateKey, group] of groups) {
    const eligible = group.filter(
      (transaction) => !hasOwnRecordedInterestSplit(transaction, loanAccountId),
    );
    if (eligible.length === 0) continue;
    const regularCandidates = eligible.filter(
      (transaction) =>
        !isOverpayment(
          transaction,
          account.overpaymentCategoryId,
          account.overpaymentMemo,
          account.overpaymentPayeeId,
          loanAccountId,
        ),
    );
    const winner = (regularCandidates.length > 0 ? regularCandidates : eligible)[0];
    owners.set(dateKey, winner.id);
  }
  return owners;
}

/**
 * Interest a regular payment accrued over the period, `balance * periodicRate`,
 * for amortizing debt with a positive rate. Only loans and mortgages get an
 * analytic estimate (revolving credit has no fixed installment schedule). The
 * rate is the one in effect on the payment date from the rate timeline (falling
 * back to the account's rate), so a variable-rate loan reprices each month and
 * the figure tracks the bank's amortization. Not capped at the loan-side
 * transaction amount: that amount is principal-only when interest is booked as
 * a separate transaction, and capping there collapses interest to the principal
 * (the artifact this replaces). Floored at zero.
 */
function analyticInterest(
  balanceBefore: number,
  account: Account,
  transaction: Transaction,
  rateChanges: RateTimelineRow[],
): number {
  if (account.accountType !== 'LOAN' && account.accountType !== 'MORTGAGE') {
    return 0;
  }
  const annualRate = effectiveAnnualRateOn(
    rateChanges,
    transaction.transactionDate,
    Number(account.interestRate),
  );
  if (!annualRate || annualRate <= 0 || balanceBefore <= 0) return 0;
  const frequency = (account.paymentFrequency as ScheduleFrequency) || 'MONTHLY';
  const periodicRate = getPeriodicRate(
    annualRate,
    getPeriodsPerYear(frequency),
    account.isCanadianMortgage || false,
    account.isVariableRate || false,
  );
  const interest = balanceBefore * periodicRate;
  // Same precision rule as takeSeparateInterest above: keep 4dp through the
  // accumulation path, round to cents only at presentation.
  return Math.round(Math.max(0, interest) * 10000) / 10000;
}

/**
 * Pair separate interest expenses to payment dates: each expense (never a
 * transfer -- a principal transfer that happens to share the interest category
 * is not interest) is attributed to the nearest payment date within half a
 * payment interval, and amounts landing on the same date are summed. Expenses
 * with no payment in range are returned as `orphans` -- these are interest-only
 * periods (e.g. an interest-only grace period before principal repayment
 * begins) that get their own rows.
 */
function pairSeparateInterestByDate(
  interestTransactions: Transaction[],
  paymentDateKeys: string[],
): { byDate: Map<string, number>; orphans: Transaction[] } {
  const byDate = new Map<string, number>();
  const orphans: Transaction[] = [];
  if (interestTransactions.length === 0) return { byDate, orphans };
  const sortedDates = [...new Set(paymentDateKeys)].sort();
  const tolerance = paymentIntervalToleranceDays(sortedDates);
  for (const tx of interestTransactions) {
    if (tx.isTransfer) continue; // interest is never a transfer to the loan
    const amount = Math.abs(Number(tx.amount));
    if (!(amount > 0)) continue;
    const nearest =
      sortedDates.length > 0
        ? nearestDateKey(tx.transactionDate.split('T')[0], sortedDates, tolerance)
        : null;
    if (nearest) {
      byDate.set(nearest, (byDate.get(nearest) ?? 0) + amount);
    } else {
      orphans.push(tx);
    }
  }
  return { byDate, orphans };
}

/** Half the median gap between payment dates (min 15 days) -- the window within
 *  which a separate interest expense counts toward a payment. */
function paymentIntervalToleranceDays(sortedDateKeys: string[]): number {
  if (sortedDateKeys.length < 2) return 20;
  const gaps: number[] = [];
  for (let i = 1; i < sortedDateKeys.length; i++) {
    gaps.push(daysBetween(sortedDateKeys[i - 1], sortedDateKeys[i]));
  }
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  return median > 0 ? Math.max(15, Math.round(median / 2)) : 20;
}

/** The payment date nearest a given date, or null when the closest one is
 *  further away than the tolerance. */
function nearestDateKey(
  dateKey: string,
  sortedDateKeys: string[],
  toleranceDays: number,
): string | null {
  let best: string | null = null;
  let bestDiff = Infinity;
  for (const key of sortedDateKeys) {
    const diff = Math.abs(daysBetween(key, dateKey));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = key;
    }
  }
  return best != null && bestDiff <= toleranceDays ? best : null;
}

/**
 * The share of a full period's expected interest a regular installment must
 * carry for its observed rate to be trusted. Below this, the booked interest is
 * only a stub (an overpayment settled most of the period's interest with
 * itself, or a payment holiday left an odd partial charge), so annualizing it
 * yields an absurdly low rate; such rows show the contractual timeline rate
 * instead. The two populations are far apart in practice -- a full installment
 * lands near 1.0, a split stub near 0.0-0.2 -- so the exact threshold is not
 * sensitive.
 */
const FULL_PERIOD_INTEREST_RATIO = 0.5;

/**
 * Fill each event's annual rate. When the loan has a recorded rate history
 * (`rateChanges`), each regular row shows the exact rate in effect on its date
 * from that history and overpayments show none -- this is the primary path.
 *
 * Only when no rate history is recorded does the reconstruction below run: the
 * interest charged, annualized over the actual days since interest was last
 * settled (`interest / balanceBefore x 365 / days`). The period runs from the previous *interest-bearing* event, not
 * merely the previous row: a pure-principal overpayment (no interest) does not
 * reset the accrual clock, so the following installment still covers the whole
 * month -- measuring from the overpayment instead would divide a full month's
 * interest by a few days and report an absurd rate. Using the real gap keeps
 * the rate correct across partial first periods, payment holidays, and
 * mid-cycle overpayments that do carry interest. The first interest-bearing row
 * falls back to the nominal period length. Events must be sorted by date;
 * `balanceBefore` is the post-payment balance plus the principal paid, i.e. the
 * debt the interest accrued on.
 *
 * When a period's interest was booked irregularly -- most of it charged
 * alongside an overpayment, or a payment holiday leaving only a partial stub on
 * the regular installment -- the true accrual span is unrecoverable and the
 * annualized observed rate is misleadingly low. Such a row (booked interest
 * below `FULL_PERIOD_INTEREST_RATIO` of a full period's expected accrual at the
 * contractual rate) shows the timeline rate in effect on its date instead. A
 * full-period installment keeps its observed rate, which tracks the real
 * variable rate month to month. Falls back to the plain observed rate when no
 * timeline rate is available to compare against.
 */
function assignObservedRates(
  events: LoanPaymentEvent[],
  periodsPerYear: number,
  rateChanges: RateTimelineRow[],
  account: Account,
): void {
  // When the loan has recorded rate-change rows, show the actual rate in effect
  // on each date -- the clean, discrete rate history -- rather than a
  // per-installment figure reconstructed from the interest charged. The
  // reconstruction jitters with day-count and partial periods and reads as the
  // rate being "averaged by month"; the recorded timeline is exact. An
  // overpayment is an ad-hoc extra payment, not a scheduled installment, so it
  // still shows no rate. The reconstruction below is kept only for loans with
  // no rate history recorded (e.g. a variable-rate loan whose changes were
  // never detected), where it is the sole signal of how the rate moved.
  if (rateChanges.length > 0) {
    for (const event of events) {
      event.annualRate =
        event.type === 'REGULAR'
          ? effectiveAnnualRateOn(rateChanges, event.date, Number(account.interestRate))
          : null;
    }
    return;
  }

  const periodDays = 365 / periodsPerYear;
  const isCanadian = account.isCanadianMortgage || false;
  const isVariable = account.isVariableRate || false;
  let lastInterestDateKey: string | null = null;
  for (const event of events) {
    const balanceBefore = event.balance + event.principal;
    const dateKey = event.date.split('T')[0];
    const gap =
      lastInterestDateKey !== null ? daysBetween(lastInterestDateKey, dateKey) : periodDays;
    // A gap much longer than one payment interval means payments were skipped
    // (e.g. a payment holiday): the interest still covers a single billing
    // period, so cap the accrual span at one interval rather than dividing one
    // month of interest across the whole gap. A non-positive gap means a prior
    // interest event fell on this very date -- an overpayment that settled
    // interest the same day as the installment -- so there is no span to
    // measure; fall back to the nominal period rather than dropping the rate.
    // Shorter gaps (an overpayment that settled interest mid-cycle) keep their
    // actual span.
    const days = gap <= 0 || gap > periodDays * 1.5 ? periodDays : gap;
    // Only a scheduled installment carries a meaningful rate. An overpayment is
    // an ad-hoc extra payment whose attached interest spans an odd partial
    // period, so it shows no rate -- but its interest still settles the accrual
    // clock for the following installment.
    if (event.type === 'REGULAR' && event.interest > 0 && balanceBefore > 0 && days > 0) {
      const periodicRate = event.interest / balanceBefore;
      // Canadian mortgages annualize by the nominal periods-per-year (with the
      // semi-annual compounding inversion for a fixed rate) -- the convention
      // the lender quotes. Everything else annualizes over the actual accrual
      // window (days since interest was last settled), which self-corrects for
      // overpayments and payment gaps.
      const observed = isCanadian
        ? isVariable
          ? periodicRate * periodsPerYear * 100
          : (Math.pow(1 + periodicRate, periodsPerYear / 2) - 1) * 2 * 100
        : periodicRate * (365 / days) * 100;
      // No rate history here (this branch only runs when rateChanges is empty),
      // so the account's scalar rate is the only reference to sanity-check the
      // observed figure against.
      const fallbackRate = Number(account.interestRate);
      const expectedFullPeriodInterest =
        fallbackRate > 0
          ? balanceBefore * getPeriodicRate(fallbackRate, periodsPerYear, isCanadian, isVariable)
          : 0;
      const isFullPeriod =
        expectedFullPeriodInterest <= 0 ||
        event.interest >= expectedFullPeriodInterest * FULL_PERIOD_INTEREST_RATIO;
      event.annualRate = isFullPeriod ? observed : fallbackRate;
    } else {
      event.annualRate = null;
    }
    if (event.interest > 0) lastInterestDateKey = dateKey;
  }
}

/** Whole days from `aKey` to `bKey` (both yyyy-MM-dd), timezone-safe. */
function daysBetween(aKey: string, bKey: string): number {
  const a = new Date(`${aKey}T00:00:00Z`).getTime();
  const b = new Date(`${bKey}T00:00:00Z`).getTime();
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
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

/**
 * Fetch the loan's separate interest expenses: transactions in the loan's
 * interest category on its payment source account. Pass the result to
 * `deriveLoanPaymentHistory` so each row shows the actual interest booked
 * (rather than an analytic estimate) and overpayments show their interest too.
 * Returns [] when the loan has no interest category or source account set --
 * that is a *known* empty: nothing was configured, so there is no separate
 * interest to find.
 *
 * A failed fetch is the other thing entirely and **propagates**. It used to be
 * swallowed into `[]`, which told the caller "this loan has no booked interest"
 * on a timeout or a 500; `deriveLoanPaymentHistory` then fell back to analytic
 * interest and the page showed different cumulative interest and projections
 * with nothing on screen to say so. The swallow also defeated two callers that
 * had already built error+retry state for exactly this
 * (`LoanOverpaymentSimulatorReport`, `DebtPayoffTimelineReport`) -- their
 * failure branches could never run. Callers decide: propagate to the surface's
 * error state, as here, or catch locally with a toast the way the account page
 * does for the scenario and rate-history side panels.
 *
 * Only genuinely standalone interest expenses are returned. The category filter
 * also matches interest booked as a *split leg* of a payment (the backend
 * matches `splits.categoryId`), but that interest is already attributed to its
 * payment through the recorded interest split (path 2 of
 * `deriveLoanPaymentHistory`); returning it here as well would double-count it.
 * A standalone expense carries the interest category at the top level (split
 * parents have a null top-level category) and is not a transfer, so filtering
 * on that keeps only the interest this separate-expense path is meant to handle.
 *
 * Scoping to this loan is by the configured interest category + source account:
 * `deriveLoanPaymentHistory` no longer date-bounds the result, so all of it
 * counts (an interest-only grace period or migrated history included). Pointing
 * two loans at one interest category would therefore merge them -- give each
 * loan its own interest category to keep them apart.
 */
export async function fetchLoanInterestTransactions(
  account: Account,
): Promise<Transaction[]> {
  if (!account.interestCategoryId || !account.sourceAccountId) return [];
  const results = await transactionsApi.getAllPages({
    categoryIds: [account.interestCategoryId],
    accountIds: [account.sourceAccountId],
  });
  return results.filter(
    (tx) => tx.categoryId === account.interestCategoryId && !tx.isTransfer,
  );
}
