import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Between, DataSource, In } from "typeorm";
import { Account, AccountType } from "./entities/account.entity";
import { Transaction } from "../transactions/entities/transaction.entity";
import { TransactionSplit } from "../transactions/entities/transaction-split.entity";
import { withScopedDb } from "../common/db/scoped-db";
import { roundMoney, sumMoney } from "../common/round.util";
import { tr } from "../i18n/translate";

export interface DetectedLoanPayment {
  /** Detected regular payment amount (positive) */
  paymentAmount: number;
  /** Detected payment frequency */
  paymentFrequency: string;
  /** Confidence score 0-1 for the detection */
  confidence: number;
  /** Source account ID (where payments come from) */
  sourceAccountId: string | null;
  /** Source account name */
  sourceAccountName: string | null;
  /** Detected interest category ID (if splits found) */
  interestCategoryId: string | null;
  /** Detected interest category name */
  interestCategoryName: string | null;
  /** Detected principal category ID (if splits found) */
  principalCategoryId: string | null;
  /** Estimated interest rate (annual percentage, null if cannot determine) */
  estimatedInterestRate: number | null;
  /** Suggested next due date based on last payment */
  suggestedNextDueDate: string;
  /** Date of the first detected payment */
  firstPaymentDate: string;
  /** Date of the last detected payment */
  lastPaymentDate: string;
  /** Number of payments analyzed */
  paymentCount: number;
  /** Current loan balance (absolute value) */
  currentBalance: number;
  /** Whether the account is a mortgage */
  isMortgage: boolean;
  /** Average extra principal payment per period (0 if none detected) */
  averageExtraPrincipal: number;
  /** Number of extra principal payments detected */
  extraPrincipalCount: number;
  /** Principal portion from the most recent split payment (null if no splits) */
  lastPrincipalAmount: number | null;
  /** Interest portion from the most recent split payment (null if no splits) */
  lastInterestAmount: number | null;
}

export interface PaymentRecord {
  date: string;
  amount: number;
  sourceAccountId: string | null;
  sourceAccountName: string | null;
  interestAmount: number | null;
  principalAmount: number | null;
  /** Extra principal detected from splits (memo cues or multiple principal splits) */
  extraPrincipalAmount: number | null;
  /** Individual principal split amounts when multiple transfers to the loan exist */
  principalSplitAmounts: number[];
  interestCategoryId: string | null;
  interestCategoryName: string | null;
  /**
   * True when this account books interest separately (not as a split leg)
   * and `pairSeparateInterest` looked for -- but could not find -- a nearby
   * standalone interest expense to pair with this payment. `amount` is then
   * a principal-only subtotal, not the full installment, even though other
   * payments in the same set may have paired successfully and carry the
   * complete amount. Left `undefined`/`false` for every record where the
   * question does not apply: split-based interest, SPLIT-mode accounts
   * (never reach this method at all), and AUTO-mode accounts with no
   * separate-interest category configured (nothing asserts separate interest
   * applies here, a valid state distinct from "pairing was attempted and
   * failed"). A SEPARATE-mode account with no configured category is NOT in
   * this unmarked set, even though its `interestCategoryId` is also null --
   * SEPARATE is the account's own assertion that separate interest exists,
   * so a missing category is a failed pairing attempt, not "doesn't apply."
   * See REV-20260803-006 (reopened a sixth time for exactly this gap).
   */
  interestUnmatched?: boolean;
}

@Injectable()
export class LoanPaymentDetectorService {
  private readonly logger = new Logger(LoanPaymentDetectorService.name);

  constructor(private dataSource: DataSource) {}

  /**
   * Analyze transactions on a loan/mortgage account to detect payment patterns.
   * Looks at incoming transfers (payments) to determine amount, frequency,
   * source account, and interest/principal splits.
   */
  async detectPaymentPattern(
    userId: string,
    accountId: string,
  ): Promise<DetectedLoanPayment | null> {
    const account = await withScopedDb(this.dataSource, (m) =>
      m.getRepository(Account).findOne({
        where: { id: accountId, userId },
      }),
    );

    if (!account) {
      throw new NotFoundException(
        tr("errors.accounts.notFound", "Account not found"),
      );
    }

    if (
      account.accountType !== AccountType.LOAN &&
      account.accountType !== AccountType.MORTGAGE &&
      account.accountType !== AccountType.LINE_OF_CREDIT
    ) {
      return null;
    }

    // Find all transactions on this loan account that look like payments
    // Payments to a loan are positive amounts (reducing the negative balance)
    const transactions = await withScopedDb(this.dataSource, (m) =>
      m.getRepository(Transaction).find({
        where: { accountId, userId },
        relations: ["account"],
        order: { transactionDate: "ASC" },
      }),
    );

    if (transactions.length === 0) {
      return null;
    }

    // Build payment records from transactions
    const rawPayments = await this.buildPaymentRecords(
      userId,
      accountId,
      transactions,
    );

    // Consolidate payment records by date. Multiple loan-side transactions
    // on the same date are part of the same payment (e.g., regular principal
    // + extra principal splits). This handles cases where linkedTransactionId-
    // based dedup doesn't fully eliminate duplicates (e.g., imported data).
    const consolidated = this.consolidatePaymentsByDate(rawPayments);
    // Recover interest booked as a separate categorized transaction (not a
    // split leg) so payments entered that way still carry an interest amount.
    // Skipped in SPLIT mode, where interest is only ever a split leg -- pairing
    // a standalone expense there would attribute an unrelated transaction to
    // the payment, exactly as RateChangeInferenceService.detectAndPersist
    // already skips it for the same reason.
    const payments =
      account.interestBookingMode === "SPLIT"
        ? consolidated
        : await this.pairSeparateInterest(userId, account, consolidated);

    if (payments.length < 2) {
      // Need at least 2 payments to detect a pattern
      return payments.length === 1
        ? this.buildSinglePaymentResult(account, payments[0])
        : null;
    }

    // Detect the regular payment amount (most common amount)
    const regularAmount = this.detectRegularAmount(payments);
    if (!regularAmount) {
      return null;
    }

    // Filter to only regular payments (within 5% of detected amount).
    // An unmatched record's `amount` is principal-only (see
    // PaymentRecord.interestUnmatched / REV-20260803-006), so it will never
    // land near an interest-inclusive regularAmount on its own -- that would
    // wrongly drop it from the payment schedule (frequency, next-due-date)
    // on top of already being excluded from the amount vote. For comparison
    // only (never for the reported amount), add back the average interest
    // from records that did pair successfully, if any exist.
    const knownInterestAmounts = payments
      .map((p) => p.interestAmount)
      .filter((v): v is number => v != null);
    const avgKnownInterest =
      knownInterestAmounts.length > 0
        ? sumMoney(knownInterestAmounts) / knownInterestAmounts.length
        : null;
    const comparisonAmount = (p: PaymentRecord): number =>
      p.interestUnmatched && avgKnownInterest != null
        ? roundMoney(p.amount + avgKnownInterest)
        : p.amount;
    const regularPayments = payments.filter(
      (p) =>
        Math.abs(comparisonAmount(p) - regularAmount) / regularAmount < 0.05,
    );

    if (regularPayments.length < 2) {
      return null;
    }

    // Detect frequency from payment intervals
    const frequency = this.detectFrequency(regularPayments);
    const confidence = this.calculateConfidence(
      regularPayments,
      payments,
      regularAmount,
      frequency,
    );

    // Determine source account (most common)
    const sourceAccount = this.detectSourceAccount(regularPayments);

    // Detect interest/principal split info
    const splitInfo = this.detectSplitInfo(regularPayments);

    // Build running balance map from all transactions for accurate rate estimation
    const balanceMap = this.buildRunningBalanceMap(account, transactions);

    // Estimate interest rate if we have split data
    const estimatedRate = this.estimateInterestRate(
      payments,
      balanceMap,
      frequency,
    );

    // Detect extra principal payments
    const extraPrincipal = this.detectExtraPrincipal(
      payments,
      regularAmount,
      regularPayments.length,
    );

    // The regularAmount is the total from the source account (includes extra principal).
    // Subtract extra principal to get the base payment (principal + interest only).
    const basePaymentAmount =
      extraPrincipal.averageExtraPrincipal > 0
        ? roundMoney(regularAmount - extraPrincipal.averageExtraPrincipal)
        : regularAmount;

    // Analyze the recent P/I split trend from several payments.
    // In amortization, principal increases and interest decreases each period.
    // Use the trend to project the next expected split values.
    // Pass extra principal so it can be subtracted from principalAmount
    // when the combined total was stored without memo-based separation.
    const splitAnalysis = this.analyzeSplitTrend(
      payments,
      extraPrincipal.averageExtraPrincipal,
    );

    // Calculate next due date
    const lastPayment = regularPayments[regularPayments.length - 1];
    const suggestedNextDueDate = this.calculateNextDueDate(
      lastPayment.date,
      frequency,
    );

    return {
      paymentAmount: basePaymentAmount,
      paymentFrequency: frequency,
      confidence,
      sourceAccountId: sourceAccount.id,
      sourceAccountName: sourceAccount.name,
      interestCategoryId: splitInfo.interestCategoryId,
      interestCategoryName: splitInfo.interestCategoryName,
      principalCategoryId: splitInfo.principalCategoryId,
      estimatedInterestRate: estimatedRate,
      suggestedNextDueDate,
      firstPaymentDate: regularPayments[0].date,
      lastPaymentDate: lastPayment.date,
      paymentCount: regularPayments.length,
      currentBalance: Math.abs(Number(account.currentBalance)),
      isMortgage: account.accountType === AccountType.MORTGAGE,
      averageExtraPrincipal: extraPrincipal.averageExtraPrincipal,
      extraPrincipalCount: extraPrincipal.extraPrincipalCount,
      lastPrincipalAmount: splitAnalysis.projectedPrincipal,
      lastInterestAmount: splitAnalysis.projectedInterest,
    };
  }

  /**
   * Build payment records by examining transactions and their linked source transfers/splits.
   * The source account transaction represents the true total payment (principal + interest +
   * extra principal). Its splits break down the components clearly:
   *   - Transfer split to the loan account = principal
   *   - Categorized split = interest expense
   *   - Memo cues ("Extra"/"Additional") distinguish extra principal from regular principal
   *
   * When no linked source transaction is found (simple transfer without splits),
   * the loan account transaction amount is used as the payment amount.
   *
   * @param asOfDate - Optional upper bound (yyyy-MM-dd) on the LINKED source
   *   transaction's own date. A transfer's loan-side leg can stay dated
   *   today while its linked source parent is later moved to a future date
   *   (e.g. a PATCH that edits only the parent's `transactionDate` without
   *   touching its splits) -- following the link still reaches that now
   *   future-dated (or since-voided) transaction and would otherwise read
   *   its interest split as if it were a real observation as of today. When
   *   the linked transaction's date is after `asOfDate`, or the linked
   *   transaction is voided, its interest split is not used and this
   *   payment's `interestAmount` is left `null` -- the same "no interest
   *   information available" state used elsewhere in this file for a
   *   missing/unusable interest source -- rather than silently treating a
   *   not-yet-real (or reversed) interest split as genuine. Left unbounded
   *   (`undefined`, the default) for `detectPaymentPattern`, which
   *   legitimately wants to see every transaction regardless of date; the
   *   caller that needs a today-bounded view is
   *   `rate-change-inference.service.ts`'s `detectAndPersist`, which passes
   *   `todayYMD()`. Mirrors the `asOfDate` parameter already added to
   *   `pairSeparateInterest` for the paired/separate-interest leak this
   *   finding's four prior passes closed -- this is the split-leg leak,
   *   a different data path. See REV-20260803-024 (fifth reopen).
   */
  async buildPaymentRecords(
    userId: string,
    accountId: string,
    transactions: Transaction[],
    asOfDate?: string,
  ): Promise<PaymentRecord[]> {
    // One read block: the linked-transfer and split lookups below are a
    // per-transaction walk over the same snapshot of data.
    return withScopedDb(this.dataSource, async (m) => {
      const payments: PaymentRecord[] = [];
      // Track processed linked source transactions to avoid duplicates.
      // When extra principal is a second transfer split, each split creates its
      // own transaction on the loan side. We only want one payment record per
      // source transaction -- the first one will discover all splits.
      const processedLinkedIds = new Set<string>();

      for (const tx of transactions) {
        const loanSideAmount = Number(tx.amount);

        // Payments to a loan account are positive (reducing the negative liability)
        if (loanSideAmount <= 0) continue;

        // Skip if we already processed another loan-side transaction from the same source
        if (
          tx.linkedTransactionId &&
          processedLinkedIds.has(tx.linkedTransactionId)
        ) {
          continue;
        }

        let sourceAccountId: string | null = null;
        let sourceAccountName: string | null = null;
        let interestAmount: number | null = null;
        let principalAmount: number | null = null;
        let extraPrincipalAmount: number | null = null;
        let principalSplitAmounts: number[] = [];
        let interestCategoryId: string | null = null;
        let interestCategoryName: string | null = null;
        // Default to loan-side amount; override with source amount when available
        let totalPaymentAmount = loanSideAmount;

        // Check if this is a transfer - find the linked source transaction
        if (tx.isTransfer && tx.linkedTransactionId) {
          processedLinkedIds.add(tx.linkedTransactionId);
          const linkedTx = await m.findOne(Transaction, {
            where: { id: tx.linkedTransactionId, userId },
            relations: ["account"],
          });
          if (linkedTx) {
            sourceAccountId = linkedTx.accountId;
            sourceAccountName = linkedTx.account?.name || null;

            // The source transaction amount is the total payment (negative outflow).
            // Use its absolute value as the total payment amount.
            const sourceAmount = Math.abs(Number(linkedTx.amount));
            if (sourceAmount > 0) {
              totalPaymentAmount = sourceAmount;
            }

            // A future-dated (relative to `asOfDate`) or voided linked source
            // is not a real observation of today's interest -- see the
            // `asOfDate` doc above. Its interest split is skipped below so
            // this payment surfaces as "no interest information available"
            // rather than a silently-contaminated observation.
            const linkedTxDateKey = linkedTx.transactionDate
              ? String(linkedTx.transactionDate).split("T")[0]
              : null;
            const linkedInterestUsable =
              !linkedTx.isVoid &&
              (asOfDate == null ||
                linkedTxDateKey == null ||
                linkedTxDateKey <= asOfDate);

            // Check if the source transaction has splits (principal + interest)
            if (linkedTx.isSplit) {
              const splits = await m.find(TransactionSplit, {
                where: { transactionId: linkedTx.id },
                relations: ["category"],
              });

              // Collect all principal splits (transfers to the loan account)
              const principalSplits: Array<{
                amount: number;
                memo: string | null;
              }> = [];

              for (const split of splits) {
                const splitAmount = Math.abs(Number(split.amount));
                if (split.transferAccountId === accountId) {
                  principalSplits.push({
                    amount: splitAmount,
                    memo: split.memo,
                  });
                } else if (split.categoryId && linkedInterestUsable) {
                  // Categorized split = interest expense. Only trusted when
                  // the linked source transaction itself is not future-dated
                  // or voided (see `linkedInterestUsable` above) --
                  // otherwise this is left unset and `interestAmount` stays
                  // `null`, REV-20260803-024's fifth-reopen fix.
                  interestAmount = splitAmount;
                  interestCategoryId = split.categoryId;
                  interestCategoryName = split.category?.name || null;
                }
              }

              // Separate regular principal from extra principal using memo cues.
              // Regular principal varies with amortization; extra is typically static.
              if (principalSplits.length === 1) {
                // Single principal split -- check memo for "extra"/"additional"
                const memo = (principalSplits[0].memo || "").toLowerCase();
                if (memo.includes("extra") || memo.includes("additional")) {
                  extraPrincipalAmount = principalSplits[0].amount;
                } else {
                  principalAmount = principalSplits[0].amount;
                }
              } else if (principalSplits.length > 1) {
                // Multiple principal splits -- use memo cues to separate
                let regular = 0;
                let extra = 0;
                let hasMemoCues = false;

                for (const ps of principalSplits) {
                  const memo = (ps.memo || "").toLowerCase();
                  if (memo.includes("extra") || memo.includes("additional")) {
                    extra += ps.amount;
                    hasMemoCues = true;
                  } else {
                    regular += ps.amount;
                  }
                }

                if (hasMemoCues) {
                  principalAmount = regular > 0 ? regular : null;
                  extraPrincipalAmount = extra > 0 ? extra : null;
                } else {
                  // No memo cues -- keep individual split amounts for cross-payment
                  // analysis. The largest split is likely regular principal (varies),
                  // smaller splits may be extra principal (static).
                  // Sum all into principalAmount for now; detectExtraPrincipal will
                  // use principalSplitAmounts to separate them.
                  principalSplitAmounts = principalSplits.map(
                    (ps) => ps.amount,
                  );
                  principalAmount = sumMoney(principalSplitAmounts);
                }
              }
            }
          }
        }

        payments.push({
          date: tx.transactionDate,
          amount: totalPaymentAmount,
          sourceAccountId,
          sourceAccountName,
          interestAmount,
          principalAmount,
          extraPrincipalAmount,
          principalSplitAmounts,
          interestCategoryId,
          interestCategoryName,
        });
      }

      return payments;
    });
  }

  /**
   * Recover interest for payments recorded without an interest split.
   *
   * A very common ledger shape (especially outside North America) books the
   * principal as a plain transfer to the loan and the interest as a SEPARATE
   * categorized expense on the payment source account -- never as a split leg
   * of the transfer. buildPaymentRecords only reads split-leg interest, so those
   * payments carry interestAmount = null and yield no rate observation, which is
   * why rate detection reports "not enough payments with interest details".
   *
   * When the loan designates an interest category, we recover the interest by
   * pairing every source-account expense in that category to the nearest payment
   * (within half a payment period) and summing per payment. Interest can
   * legitimately be spread across several transactions in one period, so summing
   * is correct. Transfers are excluded: a ledger that tags the principal transfer
   * with the same category as the interest expense would otherwise fold the
   * principal into "interest" and roughly double the implied rate. Records that
   * already carry split-based interest are left as-is.
   *
   * A payment filled by this pairing had its `amount` built from a plain
   * (unsplit) transfer, so it carries the principal only. The recovered
   * interest is added into `amount` as well, so it reflects the full
   * installment rather than a principal subtotal reported as if it were the
   * whole payment -- see REV-20260803-006.
   *
   * @param asOfDate - Optional upper bound (yyyy-MM-dd) for the separate-
   *   interest-candidate query. When provided, no transaction dated after
   *   `asOfDate` is considered a pairing candidate, regardless of how far
   *   the 45-day window would otherwise reach. When omitted (the default),
   *   the query is unbounded above, exactly as before this parameter
   *   existed -- `detectPaymentPattern` relies on that default and must see
   *   no behavior change. Companion fix for REV-20260803-024
   *   ("Future-dated loan transactions contaminate historical rate
   *   inference"): the leak that finding kept reopening on originates here,
   *   in the unbounded upper end of this method's query window, not in
   *   `rate-change-inference.service.ts`'s consumption of it. That file's
   *   `detectAndPersist` is the intended caller of this parameter (passing
   *   `todayYMD()`), but is outside this method's partition and is not
   *   changed here.
   *
   * Returns a new array (records are copied, not mutated).
   */
  async pairSeparateInterest(
    userId: string,
    account: Account,
    payments: PaymentRecord[],
    asOfDate?: string,
  ): Promise<PaymentRecord[]> {
    if (payments.length === 0) return payments;

    const interestCategoryId = account.interestCategoryId;
    if (!interestCategoryId) {
      if (account.interestBookingMode !== "SEPARATE") {
        // AUTO mode only looks for separate interest opportunistically -- with
        // no category configured there is nothing that says this loan's
        // interest is booked apart from the transfer, so the question
        // genuinely doesn't apply. (SPLIT mode never reaches this method at
        // all; the caller in detectPaymentPattern routes it around
        // pairSeparateInterest entirely.)
        return payments;
      }
      // SEPARATE mode is the account's own positive assertion that this
      // loan's interest IS booked as separate expenses. A missing/cleared
      // category (the category is nullable and can be cleared independently
      // of the booking mode) means detection cannot find the interest it
      // knows must exist -- that is "pairing attempted, implicitly, by the
      // account's own configuration, and failed to find anything to pair
      // against," the same state as the interestTxns.length === 0 branch
      // below, not "the question doesn't apply." Every plain-transfer record
      // must carry the same interestUnmatched signal that branch uses, or
      // detectRegularAmount/buildSinglePaymentResult will vote/report a
      // principal-only amount as if it were the complete installment. See
      // REV-20260803-006 (reopened a sixth time for exactly this gap: a
      // SEPARATE-mode loan with a cleared category and three $450 principal
      // transfers reported paymentAmount: 450).
      return payments.map((p) =>
        p.interestAmount != null ? p : { ...p, interestUnmatched: true },
      );
    }
    // Nothing to fill if every payment already has split-based interest.
    if (payments.every((p) => p.interestAmount != null)) return payments;

    // Restrict to the accounts these payments actually came from so a shared
    // interest category on another loan cannot bleed in.
    const sourceIds = [
      ...new Set(
        payments
          .map((p) => p.sourceAccountId)
          .filter((id): id is string => id != null),
      ),
    ];
    if (sourceIds.length === 0) {
      // interestCategoryId is configured (this account expects separate
      // interest), but not a single payment carries a known sourceAccountId
      // -- there is no account to even query interest transactions against.
      // This is discovered before the query would run, but it is the same
      // "we expected separate interest and could establish nothing" state as
      // the interestTxns.length === 0 branch below: every plain-transfer
      // record's `amount` is a principal-only subtotal, and detectRegularAmount
      // must not vote over it as if it were the complete installment. See
      // REV-20260803-006 (reopened a fourth time for exactly this gap: three
      // imported/unlinked principal transfers with no source account produced
      // no interestUnmatched marking and were accepted as the full payment).
      return payments.map((p) =>
        p.interestAmount != null ? p : { ...p, interestUnmatched: true },
      );
    }

    const dateKeys = payments.map((p) => p.date.split("T")[0]).sort();
    const rangeStart = this.shiftDateKey(dateKeys[0], -45);
    const naturalRangeEnd = this.shiftDateKey(
      dateKeys[dateKeys.length - 1],
      45,
    );
    // ISO yyyy-MM-dd strings compare correctly lexically, so this caps the
    // window at `asOfDate` only when it is the tighter bound -- when
    // `asOfDate` is omitted, `rangeEnd` is exactly `naturalRangeEnd`, so the
    // query below is byte-identical to before this parameter existed. See
    // REV-20260803-024 (companion fix).
    const rangeEnd =
      asOfDate != null && asOfDate < naturalRangeEnd
        ? asOfDate
        : naturalRangeEnd;

    const interestTxns = await withScopedDb(this.dataSource, (m) =>
      m.getRepository(Transaction).find({
        where: {
          userId,
          accountId: In(sourceIds),
          categoryId: interestCategoryId,
          transactionDate: Between(rangeStart, rangeEnd),
        },
      }),
    );
    if (interestTxns.length === 0) {
      // interestCategoryId is configured (this account expects separate
      // interest) and at least one payment has a known source account, but
      // the query found NO separate-interest transactions at all for these
      // accounts in the whole date range -- not "nothing to pair against"
      // (that already returned above, at the interestCategoryId and
      // sourceIds checks), but "we looked, and every payment's pairing
      // attempt failed because there is nothing to pair with." Every plain-
      // transfer record must carry the same interestUnmatched signal a
      // partial failure would below, rather than being returned clean as if
      // the question never applied -- otherwise detectRegularAmount cannot
      // tell this apart from an account with no separate interest at all and
      // will vote over principal-only amounts as if they were complete
      // installments. See REV-20260803-006 (reopened a third time for
      // exactly this gap).
      return payments.map((p) =>
        p.interestAmount != null ? p : { ...p, interestUnmatched: true },
      );
    }

    const tolerance = this.paymentPeriodToleranceDays(payments);
    const byDate = new Map<string, number>();
    for (const tx of interestTxns) {
      // A voided transaction is out of the ledger: it moves no balance, and
      // every report in this codebase filters it out. Summing one in reports
      // interest -- and an inferred rate -- from money that was never charged.
      //
      // Filtered here rather than in the `where` above because
      // `transactions.status` is nullable (`VARCHAR(20) DEFAULT
      // 'UNRECONCILED'`, no NOT NULL), so a SQL `status != 'VOID'` would also
      // discard every NULL-status row. That is why the reports all spell it
      // `(t.status IS NULL OR t.status != 'VOID')`. The entity's own `isVoid`
      // getter gets this right by construction, and `find` returns hydrated
      // entities so it is available.
      if (tx.isVoid) continue;
      // Interest is always a plain expense; principal is a transfer to the loan.
      // A ledger that tags the principal transfer with the same category as the
      // interest expense (a common style) would otherwise have its principal
      // summed into "interest" and inflate the implied rate, so skip transfers.
      if (tx.isTransfer) continue;
      const txDate = tx.transactionDate.split("T")[0];
      const nearest = this.nearestPaymentDateKey(txDate, dateKeys, tolerance);
      if (!nearest) continue;
      byDate.set(
        nearest,
        (byDate.get(nearest) || 0) + Math.abs(Number(tx.amount)),
      );
    }

    return payments.map((p) => {
      if (p.interestAmount != null) return p;
      const summed = byDate.get(p.date.split("T")[0]);
      if (summed == null || summed <= 0) {
        // We got this far because separate-interest data exists for this
        // account (interestTxns.length > 0 above) -- so this is not the
        // "no separate interest at all" state, it is a specific payment we
        // tried and failed to pair. Its `amount` remains principal-only and
        // must not be allowed to outvote a payment whose installment is
        // fully known (see detectRegularAmount / REV-20260803-006).
        return { ...p, interestUnmatched: true };
      }
      const recoveredInterest = roundMoney(summed);
      // A payment reaching this branch had no interest split leg, so `amount`
      // (built from the loan-side transfer or its linked source transaction)
      // is the principal transfer only -- it never included this separately
      // booked interest. Fold the recovered interest in so `amount` reflects
      // the full contractual installment rather than a principal subtotal
      // masquerading as the whole payment (see REV-20260803-006): both
      // components are now known real ledger amounts, not a default standing
      // in for a missing one.
      return {
        ...p,
        amount: roundMoney(p.amount + recoveredInterest),
        interestAmount: recoveredInterest,
        interestCategoryId: p.interestCategoryId ?? account.interestCategoryId,
      };
    });
  }

  /** Shift an ISO date key (yyyy-MM-dd) by a number of days, timezone-safe. */
  private shiftDateKey(dateKey: string, days: number): string {
    const d = new Date(`${dateKey}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().split("T")[0];
  }

  /** Half the median payment interval, the window within which an interest
   *  transaction is considered part of a given payment (min 10 days). */
  private paymentPeriodToleranceDays(payments: PaymentRecord[]): number {
    if (payments.length < 2) return 20;
    const intervals: number[] = [];
    for (let i = 1; i < payments.length; i++) {
      const prev = new Date(payments[i - 1].date).getTime();
      const curr = new Date(payments[i].date).getTime();
      intervals.push(Math.round((curr - prev) / (1000 * 60 * 60 * 24)));
    }
    intervals.sort((a, b) => a - b);
    const median = intervals[Math.floor(intervals.length / 2)];
    return median > 0 ? Math.max(10, Math.round(median / 2)) : 20;
  }

  /** The payment date key nearest to a transaction date, or null when the
   *  closest payment is further away than the tolerance. */
  private nearestPaymentDateKey(
    dateKey: string,
    paymentDateKeys: string[],
    tolerance: number,
  ): string | null {
    const target = new Date(dateKey).getTime();
    let best: string | null = null;
    let bestDiff = Infinity;
    for (const key of paymentDateKeys) {
      const diff =
        Math.abs(new Date(key).getTime() - target) / (1000 * 60 * 60 * 24);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = key;
      }
    }
    return best != null && bestDiff <= tolerance ? best : null;
  }

  /**
   * Consolidate payment records that share the same date.
   * When a source transaction has multiple transfer splits to the loan account,
   * each creates its own loan-side transaction. Even with linkedTransactionId
   * dedup, imported data may have inconsistent linking. This ensures we have
   * exactly one payment record per date.
   *
   * Prefers the record with the most complete split data (has interestAmount).
   */
  consolidatePaymentsByDate(payments: PaymentRecord[]): PaymentRecord[] {
    const byDate = new Map<string, PaymentRecord[]>();
    for (const p of payments) {
      const dateKey = p.date.split("T")[0];
      const group = byDate.get(dateKey);
      if (group) {
        group.push(p);
      } else {
        byDate.set(dateKey, [p]);
      }
    }

    const result: PaymentRecord[] = [];
    for (const group of byDate.values()) {
      if (group.length === 1) {
        result.push(group[0]);
        continue;
      }

      // Pick the record with the most complete split data as the base
      const best = group.find((p) => p.interestAmount !== null) || group[0];

      // If the best record doesn't have split data but another does,
      // merge interest info from it
      if (best.interestAmount === null) {
        const withInterest = group.find((p) => p.interestAmount !== null);
        if (withInterest) {
          best.interestAmount = withInterest.interestAmount;
          best.interestCategoryId = withInterest.interestCategoryId;
          best.interestCategoryName = withInterest.interestCategoryName;
        }
      }

      // Use the largest amount as the total payment (source total, if found)
      const maxAmount = Math.max(...group.map((g) => g.amount));
      best.amount = maxAmount;

      // Use the source account from whichever record found it
      if (!best.sourceAccountId) {
        const withSource = group.find((p) => p.sourceAccountId !== null);
        if (withSource) {
          best.sourceAccountId = withSource.sourceAccountId;
          best.sourceAccountName = withSource.sourceAccountName;
        }
      }

      result.push(best);
    }

    // Sort by date
    return result.sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );
  }

  /**
   * Detect the most common payment amount (the regular payment).
   * Groups amounts within 1 cent tolerance and returns the mode.
   *
   * An unmatched SEPARATE-mode record (see `PaymentRecord.interestUnmatched`)
   * carries a principal-only subtotal, not the full installment, because
   * `pairSeparateInterest` could not find its paired interest. Letting it
   * vote alongside records whose installment is fully known lets an
   * incomplete majority beat a complete minority -- three $450 principal-only
   * records outvoting one correctly-completed $500 record, even though $500
   * is the real installment (REV-20260803-006, reopened). So the vote is
   * restricted to complete records whenever at least one exists.
   *
   * `completePayments` is empty in exactly two situations, and only one of
   * them is safe to vote over:
   *   - Every record has `interestUnmatched: undefined`/`false` -- SPLIT
   *     mode, or a SEPARATE-mode account with no separate-interest data at
   *     all -- is impossible here, because the filter keeps every record
   *     when none carry the flag, so `completePayments.length` would equal
   *     `payments.length` (which is >= 2), never 0.
   *   - Every record has `interestUnmatched: true` -- a SEPARATE-mode
   *     account where pairing was attempted for every payment and failed for
   *     every one (missing data or nothing close enough to pair). There is
   *     no complete record left to vote with, and every candidate's `amount`
   *     is a known-principal-only subtotal, not the full installment. Voting
   *     over it and returning the majority would report that subtotal in the
   *     total's field -- the exact "Missing data: a subtotal is not a total"
   *     violation root CLAUDE.md forbids -- so this returns `null`
   *     ("cannot determine") instead, matching `detectPaymentPattern`'s
   *     existing convention of returning `null` for every other
   *     undetectable-pattern case (see its `if (!regularAmount) return null`
   *     caller). Reopened a third time because a prior pass treated this
   *     case as "no data available, so fall back and report an imperfect
   *     answer" -- but a known-incomplete answer is not the same as no
   *     answer, and reporting it as if it were complete is worse than
   *     reporting nothing.
   */
  private detectRegularAmount(payments: PaymentRecord[]): number | null {
    const completePayments = payments.filter((p) => !p.interestUnmatched);

    if (completePayments.length === 0) {
      return null;
    }

    // A single complete record is still a fully-known installment -- it
    // outranks any number of incomplete ones in the excluded remainder, so
    // there's nothing to vote against within the trusted subset.
    if (completePayments.length === 1) {
      return completePayments[0].amount;
    }

    return this.detectRegularAmountFromSet(completePayments);
  }

  /**
   * Majority-vote / fuzzy amount detection over a specific candidate set.
   * Extracted from `detectRegularAmount` so the caller can restrict the
   * candidate set to complete (interest-paired, where applicable) records.
   */
  private detectRegularAmountFromSet(payments: PaymentRecord[]): number | null {
    // Round amounts to 2 decimal places and count occurrences
    const amountCounts = new Map<number, number>();
    for (const p of payments) {
      const rounded = Math.round(p.amount * 100) / 100;
      amountCounts.set(rounded, (amountCounts.get(rounded) || 0) + 1);
    }

    // Find the most frequent amount
    let maxCount = 0;
    let regularAmount: number | null = null;
    for (const [amount, count] of amountCounts) {
      if (count > maxCount) {
        maxCount = count;
        regularAmount = amount;
      }
    }

    // Require at least 2 occurrences of the same amount
    if (maxCount < 2) {
      // Try grouping within 5% tolerance
      return this.detectRegularAmountFuzzy(payments);
    }

    return regularAmount;
  }

  /**
   * Fuzzy amount detection - groups amounts within 5% of median.
   */
  private detectRegularAmountFuzzy(payments: PaymentRecord[]): number | null {
    const amounts = [...payments.map((p) => p.amount)].sort((a, b) => a - b);
    const median = amounts[Math.floor(amounts.length / 2)];

    const nearMedian = amounts.filter(
      (a) => Math.abs(a - median) / median < 0.05,
    );

    if (nearMedian.length >= 2) {
      // Return the average of the near-median amounts
      const sum = sumMoney(nearMedian);
      return roundMoney(sum / nearMedian.length);
    }

    return null;
  }

  /**
   * Detect payment frequency from intervals between payment dates.
   */
  private detectFrequency(payments: PaymentRecord[]): string {
    const intervals: number[] = [];
    for (let i = 1; i < payments.length; i++) {
      const prev = new Date(payments[i - 1].date);
      const curr = new Date(payments[i].date);
      const diffDays = Math.round(
        (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24),
      );
      intervals.push(diffDays);
    }

    // Calculate median interval
    const sorted = [...intervals].sort((a, b) => a - b);
    const medianInterval = sorted[Math.floor(sorted.length / 2)];

    // Map interval to frequency
    if (medianInterval <= 10) return "WEEKLY";
    if (medianInterval <= 18) return "BIWEEKLY";
    if (medianInterval <= 21) return "SEMIMONTHLY";
    if (medianInterval <= 45) return "MONTHLY";
    if (medianInterval <= 100) return "QUARTERLY";
    return "YEARLY";
  }

  /**
   * Calculate confidence score based on how consistent the payments are.
   */
  private calculateConfidence(
    regularPayments: PaymentRecord[],
    allPayments: PaymentRecord[],
    regularAmount: number,
    frequency: string,
  ): number {
    let score = 0;

    // 1. What percentage of all payments match the regular amount? (0-0.4)
    const matchRatio = regularPayments.length / allPayments.length;
    score += matchRatio * 0.4;

    // 2. How consistent are the intervals? (0-0.3)
    const expectedDays = this.getExpectedIntervalDays(frequency);
    const intervals: number[] = [];
    for (let i = 1; i < regularPayments.length; i++) {
      const prev = new Date(regularPayments[i - 1].date);
      const curr = new Date(regularPayments[i].date);
      const diffDays =
        (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
      intervals.push(diffDays);
    }

    if (intervals.length > 0) {
      const avgDeviation =
        intervals.reduce((sum, d) => sum + Math.abs(d - expectedDays), 0) /
        intervals.length;
      // Allow up to 5 days deviation for full score
      const intervalScore = Math.max(0, 1 - avgDeviation / 10);
      score += intervalScore * 0.3;
    }

    // 3. Number of payments (more = more confident) (0-0.2)
    const countScore = Math.min(1, regularPayments.length / 12);
    score += countScore * 0.2;

    // 4. Exact amount match bonus (0-0.1)
    const exactMatches = regularPayments.filter(
      (p) => Math.round(p.amount * 100) === Math.round(regularAmount * 100),
    ).length;
    const exactRatio = exactMatches / regularPayments.length;
    score += exactRatio * 0.1;

    return Math.round(score * 100) / 100;
  }

  private getExpectedIntervalDays(frequency: string): number {
    switch (frequency) {
      case "WEEKLY":
        return 7;
      case "BIWEEKLY":
        return 14;
      case "SEMIMONTHLY":
        return 15;
      case "MONTHLY":
        return 30;
      case "QUARTERLY":
        return 91;
      case "YEARLY":
        return 365;
      default:
        return 30;
    }
  }

  /**
   * Determine the most common source account for payments.
   */
  private detectSourceAccount(payments: PaymentRecord[]): {
    id: string | null;
    name: string | null;
  } {
    const counts = new Map<string, { count: number; name: string | null }>();
    for (const p of payments) {
      if (p.sourceAccountId) {
        const existing = counts.get(p.sourceAccountId);
        if (existing) {
          existing.count++;
        } else {
          counts.set(p.sourceAccountId, {
            count: 1,
            name: p.sourceAccountName,
          });
        }
      }
    }

    let bestId: string | null = null;
    let bestName: string | null = null;
    let bestCount = 0;
    for (const [id, { count, name }] of counts) {
      if (count > bestCount) {
        bestCount = count;
        bestId = id;
        bestName = name;
      }
    }

    return { id: bestId, name: bestName };
  }

  /**
   * Detect principal/interest split information from payment records.
   */
  private detectSplitInfo(payments: PaymentRecord[]): {
    interestCategoryId: string | null;
    interestCategoryName: string | null;
    principalCategoryId: string | null;
  } {
    // Find the most common interest category
    const categoryCounts = new Map<
      string,
      { count: number; name: string | null }
    >();
    for (const p of payments) {
      if (p.interestCategoryId) {
        const existing = categoryCounts.get(p.interestCategoryId);
        if (existing) {
          existing.count++;
        } else {
          categoryCounts.set(p.interestCategoryId, {
            count: 1,
            name: p.interestCategoryName,
          });
        }
      }
    }

    let interestCategoryId: string | null = null;
    let interestCategoryName: string | null = null;
    let bestCount = 0;
    for (const [id, { count, name }] of categoryCounts) {
      if (count > bestCount) {
        bestCount = count;
        interestCategoryId = id;
        interestCategoryName = name;
      }
    }

    return {
      interestCategoryId,
      interestCategoryName,
      // Principal category is not used in the current schema
      // (principal goes as a transfer to the loan account)
      principalCategoryId: null,
    };
  }

  /**
   * Build a map of running balance before each transaction date.
   * Works backwards from the known currentBalance (which is accurate)
   * rather than forwards from openingBalance (which may not match
   * the actual balance when the user started tracking).
   */
  buildRunningBalanceMap(
    account: Account,
    transactions: Transaction[],
  ): Map<string, number> {
    const balanceMap = new Map<string, number>();
    // Start from the current balance and work backwards through transactions.
    // This is more reliable than starting from openingBalance, which may
    // represent the original mortgage amount rather than the balance at
    // the time of the first tracked transaction.
    let absBalance = Math.abs(Number(account.currentBalance));

    // Process transactions in reverse chronological order to reconstruct
    // what the balance was before each transaction.
    const reversed = [...transactions].reverse();
    for (const tx of reversed) {
      const dateStr =
        typeof tx.transactionDate === "string"
          ? tx.transactionDate.split("T")[0]
          : String(tx.transactionDate);

      // Undo the transaction: payments (positive) had reduced the balance,
      // so add them back; charges/fees (negative) had increased it, so subtract.
      absBalance += Number(tx.amount);

      // Record the pre-transaction balance for this date.
      // Since we're going backwards, overwrite to get the earliest (pre-first-tx) balance.
      balanceMap.set(dateStr, absBalance);
    }

    return balanceMap;
  }

  /**
   * Estimate the annual interest rate from payment data.
   *
   * Uses consecutive payment splits to derive the periodic rate without
   * depending on the account balance (which may be wrong if openingBalance
   * had the wrong sign). For amortization:
   *   interest_n - interest_{n+1} = principal_n * periodicRate
   * So: periodicRate = (interest_n - interest_{n+1}) / principal_n
   *
   * Falls back to balance-based estimation when consecutive splits aren't
   * available.
   */
  private estimateInterestRate(
    payments: PaymentRecord[],
    balanceMap: Map<string, number>,
    frequency: string,
  ): number | null {
    const paymentsWithSplits = payments.filter(
      (p) => p.interestAmount !== null && p.principalAmount !== null,
    );

    if (paymentsWithSplits.length < 1) {
      return null;
    }

    const periodsPerYear = this.getPeriodsPerYear(frequency);
    const rates: number[] = [];

    // Primary: estimate from consecutive interest/principal pairs.
    // In amortization, the drop in interest between consecutive payments
    // equals the TOTAL principal reduction times the periodic rate.
    // Total principal = regular principal + extra principal, since both
    // reduce the balance and thus affect the next interest calculation.
    for (let i = 0; i < paymentsWithSplits.length - 1; i++) {
      const curr = paymentsWithSplits[i];
      const next = paymentsWithSplits[i + 1];
      if (
        !curr.interestAmount ||
        !next.interestAmount ||
        !curr.principalAmount
      ) {
        continue;
      }

      const interestDrop = curr.interestAmount - next.interestAmount;
      // Total principal going to the loan account (regular + extra)
      // Both reduce the balance and cause the interest to drop
      const totalPrincipal =
        (curr.principalAmount || 0) + (curr.extraPrincipalAmount || 0);

      if (totalPrincipal > 0 && interestDrop > 0) {
        const periodicRate = interestDrop / totalPrincipal;
        const annualRate = periodicRate * periodsPerYear * 100;
        if (annualRate > 0 && annualRate < 50) {
          rates.push(annualRate);
        }
      }
    }

    // Fallback: balance-based estimation if consecutive approach didn't work
    if (rates.length === 0) {
      for (const p of paymentsWithSplits) {
        const dateStr = p.date.split("T")[0];
        const balance = balanceMap.get(dateStr);
        if (!balance || balance <= 0 || !p.interestAmount) continue;

        const periodicRate = p.interestAmount / balance;
        const annualRate = periodicRate * periodsPerYear * 100;
        if (annualRate > 0 && annualRate < 50) {
          rates.push(annualRate);
        }
      }
    }

    if (rates.length === 0) {
      return null;
    }

    // Use median for robustness against outliers
    rates.sort((a, b) => a - b);
    const mid = Math.floor(rates.length / 2);
    const medianRate =
      rates.length % 2 === 0 ? (rates[mid - 1] + rates[mid]) / 2 : rates[mid];

    return Math.round(medianRate * 100) / 100;
  }

  /**
   * Detect extra principal payments from split-level data.
   *
   * The source account transaction for a loan payment has splits:
   *   - Transfer to loan account = principal (varies, increases over time)
   *   - Categorized expense = interest (varies, decreases over time)
   *   - (Optional) Second transfer to loan account = extra principal (static)
   *
   * Strategies (in priority order):
   * 1. Memo-based: Use "Extra"/"Additional" keywords from split memos.
   * 2. Multiple splits: When a payment has 2+ transfers to the loan account,
   *    find the split amount that is constant/static across payments. The
   *    varying one is regular principal; the static one is extra principal.
   * 3. Fall back to zero.
   */
  private detectExtraPrincipal(
    allPayments: PaymentRecord[],
    _regularAmount: number,
    _regularPaymentCount: number,
  ): { averageExtraPrincipal: number; extraPrincipalCount: number } {
    // Strategy 1: Use memo-detected extra principal from splits.
    const memoBasedExtras = allPayments.filter(
      (p) => p.extraPrincipalAmount !== null && p.extraPrincipalAmount > 0,
    );

    if (
      memoBasedExtras.length >= 3 &&
      memoBasedExtras.length / allPayments.length >= 0.5
    ) {
      const totalExtra = sumMoney(
        memoBasedExtras.map((p) => p.extraPrincipalAmount!),
      );
      const avg = roundMoney(totalExtra / memoBasedExtras.length);
      return {
        averageExtraPrincipal: avg,
        extraPrincipalCount: memoBasedExtras.length,
      };
    }

    // Strategy 2: Look for payments with multiple principal splits (2+ transfers
    // to the loan account). The extra principal appears as a second transfer
    // with a static/constant amount across payments, while regular principal
    // varies (increases with amortization).
    //
    // We compare the variance of each split group to determine which is static.
    const paymentsWithMultipleSplits = allPayments.filter(
      (p) => p.principalSplitAmounts.length >= 2,
    );

    if (paymentsWithMultipleSplits.length >= 3) {
      // For the common case of exactly 2 principal splits per payment,
      // sort each payment's splits and collect into two groups:
      // group[0] = smaller split from each payment, group[1] = larger split
      const twoSplitPayments = paymentsWithMultipleSplits.filter(
        (p) => p.principalSplitAmounts.length === 2,
      );

      if (twoSplitPayments.length >= 3) {
        const group0: number[] = []; // smaller split from each payment
        const group1: number[] = []; // larger split from each payment

        for (const p of twoSplitPayments) {
          const sorted = [...p.principalSplitAmounts].sort((a, b) => a - b);
          group0.push(sorted[0]);
          group1.push(sorted[1]);
        }

        // Compute coefficient of variation for each group to find the static one.
        // The group with lower CV is the extra principal (constant amount).
        const cv0 = this.coefficientOfVariation(group0);
        const cv1 = this.coefficientOfVariation(group1);

        // The static group must have very low variance (CV < 2%)
        const staticThreshold = 0.02;
        let extraGroup: number[] | null = null;

        if (cv0 < staticThreshold && cv0 < cv1) {
          extraGroup = group0;
        } else if (cv1 < staticThreshold && cv1 < cv0) {
          extraGroup = group1;
        }

        if (extraGroup) {
          const avg = sumMoney(extraGroup) / extraGroup.length;
          const extraAmount = roundMoney(avg);
          if (extraAmount > 0.01) {
            return {
              averageExtraPrincipal: extraAmount,
              extraPrincipalCount: twoSplitPayments.length,
            };
          }
        }
      }
    }

    return { averageExtraPrincipal: 0, extraPrincipalCount: 0 };
  }

  /**
   * Analyze the principal/interest split trend across recent payments.
   * In amortization: principal increases each period, interest decreases.
   * Uses the last several payments to project what the next split should be.
   *
   * @param extraPrincipalAmount - If detected, this is subtracted from
   *   principalAmount to get the regular principal before trend analysis.
   *
   * Returns projected REGULAR principal and interest values for the next payment.
   */
  private analyzeSplitTrend(
    allPayments: PaymentRecord[],
    extraPrincipalAmount: number = 0,
  ): { projectedPrincipal: number | null; projectedInterest: number | null } {
    // Get payments with split data, in chronological order
    const withSplits = allPayments.filter(
      (p) => p.principalAmount !== null && p.interestAmount !== null,
    );

    if (withSplits.length === 0) {
      return { projectedPrincipal: null, projectedInterest: null };
    }

    // Subtract extra principal from principalAmount to get regular principal
    const getRegularPrincipal = (p: PaymentRecord): number => {
      const total = p.principalAmount!;
      // If this payment had memo-based extra, it's already excluded from principalAmount.
      // Only subtract when extraPrincipalAmount was detected from multi-split analysis
      // and this payment's principalAmount includes the extra (no memo-based separation).
      if (
        extraPrincipalAmount > 0 &&
        p.extraPrincipalAmount === null &&
        p.principalSplitAmounts.length >= 2
      ) {
        return Math.max(0, total - extraPrincipalAmount);
      }
      return total;
    };

    if (withSplits.length === 1) {
      return {
        projectedPrincipal: getRegularPrincipal(withSplits[0]),
        projectedInterest: withSplits[0].interestAmount,
      };
    }

    // Use up to the last 6 payments for trend analysis
    const recent = withSplits.slice(-6);
    const principals = recent.map(getRegularPrincipal);
    const interests = recent.map((p) => p.interestAmount!);

    // Verify the amortization pattern:
    // principal should be increasing, interest should be decreasing
    let principalIncreasing = 0;
    let interestDecreasing = 0;
    for (let i = 1; i < recent.length; i++) {
      if (principals[i] >= principals[i - 1]) principalIncreasing++;
      if (interests[i] <= interests[i - 1]) interestDecreasing++;
    }

    const steps = recent.length - 1;
    const hasAmortizationPattern =
      principalIncreasing / steps >= 0.6 && interestDecreasing / steps >= 0.6;

    if (hasAmortizationPattern && recent.length >= 3) {
      // Project the next values by continuing the trend.
      const principalSteps: number[] = [];
      const interestSteps: number[] = [];
      for (let i = 1; i < recent.length; i++) {
        principalSteps.push(principals[i] - principals[i - 1]);
        interestSteps.push(interests[i] - interests[i - 1]);
      }

      const avgPrincipalStep =
        principalSteps.reduce((s, v) => s + v, 0) / principalSteps.length;
      const avgInterestStep =
        interestSteps.reduce((s, v) => s + v, 0) / interestSteps.length;

      const lastPrincipal = principals[principals.length - 1];
      const lastInterest = interests[interests.length - 1];

      const projectedPrincipal = roundMoney(lastPrincipal + avgPrincipalStep);
      const projectedInterest = Math.max(
        0,
        roundMoney(lastInterest + avgInterestStep),
      );

      return { projectedPrincipal, projectedInterest };
    }

    // No clear trend -- return the most recent split values
    const lastRegularPrincipal = getRegularPrincipal(
      withSplits[withSplits.length - 1],
    );
    return {
      projectedPrincipal: lastRegularPrincipal,
      projectedInterest: withSplits[withSplits.length - 1].interestAmount,
    };
  }

  /**
   * Compute the coefficient of variation (stddev / mean) for an array of numbers.
   * Returns Infinity for empty arrays or zero mean.
   */
  private coefficientOfVariation(values: number[]): number {
    if (values.length === 0) return Infinity;
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    if (mean === 0) return Infinity;
    const variance =
      values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
    return Math.sqrt(variance) / mean;
  }

  private getPeriodsPerYear(frequency: string): number {
    switch (frequency) {
      case "WEEKLY":
        return 52;
      case "BIWEEKLY":
        return 26;
      case "SEMIMONTHLY":
        return 24;
      case "MONTHLY":
        return 12;
      case "QUARTERLY":
        return 4;
      case "YEARLY":
        return 1;
      default:
        return 12;
    }
  }

  /**
   * Calculate the next due date by advancing one period from the last payment date.
   */
  private calculateNextDueDate(lastDate: string, frequency: string): string {
    const date = new Date(lastDate);

    switch (frequency) {
      case "WEEKLY":
        date.setDate(date.getDate() + 7);
        break;
      case "BIWEEKLY":
        date.setDate(date.getDate() + 14);
        break;
      case "SEMIMONTHLY":
        if (date.getDate() <= 15) {
          // Move to end of month
          date.setMonth(date.getMonth() + 1, 0);
        } else {
          // Move to 15th of next month
          date.setMonth(date.getMonth() + 1, 15);
        }
        break;
      case "MONTHLY":
        date.setMonth(date.getMonth() + 1);
        break;
      case "QUARTERLY":
        date.setMonth(date.getMonth() + 3);
        break;
      case "YEARLY":
        date.setFullYear(date.getFullYear() + 1);
        break;
    }

    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  /**
   * Build a result from a single payment when only one exists.
   *
   * `detectPaymentPattern` reaches this path instead of `detectRegularAmount`
   * whenever there is exactly one payment, so it never goes through that
   * function's `interestUnmatched` guard (built up across passes 2-4 of
   * REV-20260803-006 for the >=2-payment case). Without a check here, a
   * SEPARATE-mode loan whose sole payment is an unlinked/imported principal
   * transfer -- `pairSeparateInterest` attempted to pair its separate
   * interest and failed, marking it `interestUnmatched: true` -- would have
   * that principal-only `amount` returned as `paymentAmount` directly,
   * reporting a subtotal as the complete contractual installment. This is
   * the exact fifth-reopen defect: the record's `amount` is not the full
   * payment (the missing interest portion means the true installment cannot
   * be established), so this returns `null` -- matching
   * `detectRegularAmount`'s "cannot determine" convention for the
   * all-unmatched case -- rather than a known-incomplete amount.
   */
  private buildSinglePaymentResult(
    account: Account,
    payment: PaymentRecord,
  ): DetectedLoanPayment | null {
    if (payment.interestUnmatched) {
      return null;
    }
    const extraAmount = payment.extraPrincipalAmount ?? 0;
    const baseAmount =
      extraAmount > 0
        ? roundMoney(payment.amount - extraAmount)
        : payment.amount;
    return {
      paymentAmount: baseAmount,
      paymentFrequency: "MONTHLY", // Default assumption
      confidence: 0.2,
      sourceAccountId: payment.sourceAccountId,
      sourceAccountName: payment.sourceAccountName,
      interestCategoryId: payment.interestCategoryId,
      interestCategoryName: payment.interestCategoryName,
      principalCategoryId: null,
      estimatedInterestRate: null,
      suggestedNextDueDate: this.calculateNextDueDate(payment.date, "MONTHLY"),
      firstPaymentDate: payment.date,
      lastPaymentDate: payment.date,
      paymentCount: 1,
      currentBalance: Math.abs(Number(account.currentBalance)),
      isMortgage: account.accountType === AccountType.MORTGAGE,
      averageExtraPrincipal: payment.extraPrincipalAmount ?? 0,
      extraPrincipalCount: payment.extraPrincipalAmount ? 1 : 0,
      lastPrincipalAmount: payment.principalAmount,
      lastInterestAmount: payment.interestAmount,
    };
  }
}
