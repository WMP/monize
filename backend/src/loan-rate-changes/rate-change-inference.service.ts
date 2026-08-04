import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { DataSource, In, LessThanOrEqual } from "typeorm";
import { tr } from "../i18n/translate";
import { todayYMD } from "../common/date-utils";
import { withScopedDb } from "../common/db/scoped-db";
import { LoanRateChange } from "./entities/loan-rate-change.entity";
import { Account, AccountType } from "../accounts/entities/account.entity";
import { Transaction } from "../transactions/entities/transaction.entity";
import {
  LoanPaymentDetectorService,
  PaymentRecord,
} from "../accounts/loan-payment-detector.service";
import { LoanRateChangesService } from "./loan-rate-changes.service";
import { getMortgagePeriodsPerYear } from "../accounts/mortgage-amortization.util";
import { getPeriodsPerYear } from "../accounts/loan-amortization.util";
import type { PaymentFrequency } from "../accounts/loan-amortization.util";
import type { MortgagePaymentFrequency } from "../accounts/mortgage-amortization.util";
import { roundMoney } from "../common/round.util";

/** Balances below this produce interest amounts too noisy to infer a rate from */
export const MIN_BALANCE_FOR_INFERENCE = 500;
/** Absolute rate deviation (percentage points) that signals a possible step */
export const RATE_TOLERANCE_PP = 0.15;
/** Relative rate deviation that signals a possible step */
export const RATE_TOLERANCE_REL = 0.025;
/** Minimum usable observations (payments with interest + known balance) */
export const MIN_USABLE_PAYMENTS = 3;
/** Payment amounts within this are considered the same payment level */
const PAYMENT_STEP_EPSILON = 0.01;

interface RateObservation {
  /** ISO date (yyyy-MM-dd) of the payment */
  date: string;
  /** Annualized rate implied by interest / balanceBefore, as a percentage */
  annualRate: number;
  /** Total payment amount */
  paymentAmount: number;
  /**
   * True when this specific payment's interest came from a separately
   * categorized expense (paired in) rather than a split leg of the payment
   * itself. Tracked per payment -- not once for the whole history -- so a
   * loan that changes booking style partway through is judged period by
   * period; see REV-20260803-005.
   */
  interestBookedSeparately: boolean;
}

interface RateSegment {
  observations: RateObservation[];
  medianRate: number;
  /** Mode of payment amounts within the segment */
  paymentAmount: number | null;
  /**
   * True when this segment contains at least one payment whose interest was
   * booked separately -- its `paymentAmount` may be a principal-only
   * subtotal rather than the full installment, so `newPaymentAmount` must be
   * suppressed for this segment specifically. Does not depend on whether any
   * other segment in the same loan's history used separate interest.
   */
  interestBookedSeparately: boolean;
}

export interface DetectRateChangesResult {
  created: LoanRateChange[];
  /** Number of previously inferred rows that were replaced */
  replacedCount: number;
  warnings: string[];
}

/**
 * Infers historical interest-rate changes from a loan's payment history.
 *
 * Each payment with an interest split yields a periodic-rate observation
 * (interest / balance before the payment), annualized per the account's
 * compounding convention. Chronological observations are segmented with a
 * step detector (two consecutive deviations beyond tolerance open a new
 * segment; single outliers such as lump-sum periods are skipped). The first
 * segment becomes the account's 'initial' rate row; later segments become
 * 'inferred' rows. Manual rows always win: re-running detection replaces
 * only previously inferred rows and skips candidates whose effective date
 * collides with a manual or initial row.
 */
@Injectable()
export class RateChangeInferenceService {
  private readonly logger = new Logger(RateChangeInferenceService.name);

  constructor(
    private dataSource: DataSource,
    private detector: LoanPaymentDetectorService,
    private rateChangesService: LoanRateChangesService,
  ) {}

  async detectAndPersist(
    userId: string,
    accountId: string,
  ): Promise<DetectRateChangesResult> {
    const account = await this.rateChangesService.verifyLoanAccount(
      userId,
      accountId,
    );

    // `account.currentBalance` never reflects future-dated transactions (see
    // `isTransactionInFuture`), so the reconstruction this feeds --
    // `buildRunningBalanceMap` walks backwards from `currentBalance` -- must
    // be anchored to the same cutoff, or a future scheduled/split payment
    // gets "undone" from today's balance and inflates every earlier balance,
    // understating every inferred rate (and future splits can themselves
    // become bogus observations). Voided rows moved no balance either; they
    // are filtered in-memory rather than via the `where` because
    // `transactions.status` is nullable and a SQL `status != 'VOID'` would
    // also discard NULL-status rows (see loan-payment-detector.service.ts).
    const fetchedTransactions = await withScopedDb(this.dataSource, (m) =>
      m.getRepository(Transaction).find({
        where: {
          accountId,
          userId,
          transactionDate: LessThanOrEqual(todayYMD()),
        },
        order: { transactionDate: "ASC" },
      }),
    );
    const transactions = fetchedTransactions.filter((tx) => !tx.isVoid);

    const rawPayments = await this.detector.buildPaymentRecords(
      userId,
      accountId,
      transactions,
    );
    const consolidated = this.detector.consolidatePaymentsByDate(rawPayments);
    // Whether each individual payment date already carried split-leg interest
    // *before* separate-interest pairing -- keyed per date (not collapsed to
    // one history-wide boolean) so a loan that changes booking style partway
    // through is judged period by period rather than by whatever happened
    // anywhere else in its history. See REV-20260803-005.
    const hadSplitInterestByDate = new Map<string, boolean>(
      consolidated.map((p) => [p.date.split("T")[0], p.interestAmount != null]),
    );
    // Recover interest booked as a separate categorized expense (not a split
    // leg) so those payments yield a rate observation instead of being dropped
    // as "no interest details". Skipped in SPLIT mode, where interest is only
    // ever a split leg and pairing a separate expense would double-count.
    const payments =
      account.interestBookingMode === "SPLIT"
        ? consolidated
        : await this.excludeFutureLeakedInterest(
            userId,
            account,
            consolidated,
            await this.detector.pairSeparateInterest(
              userId,
              account,
              consolidated,
            ),
            hadSplitInterestByDate,
          );
    // Per-payment: was *this* payment's interest booked separately (not a
    // split leg)? An account-wide SEPARATE mode always answers yes; otherwise
    // a payment counts only when its own date had no split-leg interest yet
    // ended up with a known interestAmount (i.e. it was recovered by
    // pairing). When interest is booked separately, the payment amount is a
    // principal-only subtotal (not the full installment), so it must not be
    // recorded as the rate row's payment for the segment(s) it falls in --
    // independent of how any other segment in the same history books
    // interest.
    const separatelyBookedByDate = new Map<string, boolean>(
      payments.map((p) => {
        const dateKey = p.date.split("T")[0];
        const hadSplitInterest = hadSplitInterestByDate.get(dateKey) ?? false;
        return [
          dateKey,
          account.interestBookingMode === "SEPARATE" ||
            (!hadSplitInterest && p.interestAmount != null),
        ];
      }),
    );
    const balanceMap = this.detector.buildRunningBalanceMap(
      account,
      transactions,
    );

    const warnings: string[] = [];
    const periodsPerYear = this.resolvePeriodsPerYear(
      account,
      payments,
      warnings,
    );
    const observations = this.buildObservations(
      account,
      payments,
      balanceMap,
      periodsPerYear,
      separatelyBookedByDate,
    );

    if (observations.length < MIN_USABLE_PAYMENTS) {
      throw new BadRequestException(
        tr(
          "errors.loanRateChanges.insufficientData",
          "Not enough payments with interest details to detect rate changes",
        ),
      );
    }

    const segments = this.segmentObservations(observations);
    if (segments.length === 0) {
      throw new BadRequestException(
        tr(
          "errors.loanRateChanges.insufficientData",
          "Not enough payments with interest details to detect rate changes",
        ),
      );
    }

    return this.persistSegments(userId, account, segments, warnings);
  }

  /**
   * REV-20260803-024 (third reopen): the second pass's `hasRealEvidenceNear`
   * asked "does ANY real (today-bounded) interest expense exist within 45
   * days of THIS payment's date" -- a question about the neighbourhood, not
   * about the specific pairing being verified. With payments 30 days apart
   * and a 45-day tolerance, the genuine evidence for an *adjacent* payment
   * (e.g. today-30) is also within 45 days of the payment under test (today)
   * and made the check pass even though that evidence has nothing to do with
   * whatever `pairSeparateInterest` actually paired to today's payment (a
   * future-dated expense at today+1). A coincidence of the tolerance window
   * being wider than the payment cadence, not genuine confirmation.
   *
   * The fix re-runs the same algorithm `pairSeparateInterest` itself uses --
   * assign each candidate interest expense to its nearest payment date
   * (within the same cadence-derived tolerance) and sum per date -- but over
   * ONLY real, non-void, non-transfer, today-bounded candidates. That
   * per-date assignment is what makes this specific: the today-30 evidence
   * lands on the today-30 date (distance 0), not on today's (distance 30),
   * exactly as `pairSeparateInterest`'s own `nearestPaymentDateKey` would
   * place it. A pairing is accepted only when this today-bounded recomputation
   * lands the same amount on the same date that `pairSeparateInterest`
   * actually recorded -- i.e. the pairing is exactly reproducible from
   * evidence that was real as of today. Anything the recomputation cannot
   * reproduce (nothing landed on that date, or a smaller amount because a
   * future-dated expense inflated the original sum) is discarded, and the
   * payment reverts to its pre-pairing, principal-only shape -- exactly how
   * `pairSeparateInterest` itself marks a pairing attempt that found
   * nothing.
   *
   * `nearestPaymentDateKey`/`paymentPeriodToleranceDays` are re-implemented
   * here (not imported) because they are private to
   * `loan-payment-detector.service.ts`, which this fix's partition may not
   * touch; keep them in lockstep with that file's originals if either
   * changes.
   */
  private async excludeFutureLeakedInterest(
    userId: string,
    account: Account,
    originalPayments: PaymentRecord[],
    pairedPayments: PaymentRecord[],
    hadSplitInterestByDate: Map<string, boolean>,
  ): Promise<PaymentRecord[]> {
    const interestCategoryId = account.interestCategoryId;
    if (!interestCategoryId) return pairedPayments;

    const wasPairedByDate = new Map<string, boolean>();
    for (const p of pairedPayments) {
      const dateKey = p.date.split("T")[0];
      wasPairedByDate.set(
        dateKey,
        p.interestAmount != null &&
          !(hadSplitInterestByDate.get(dateKey) ?? false),
      );
    }
    if (![...wasPairedByDate.values()].some(Boolean)) return pairedPayments;

    const sourceAccountIds = [
      ...new Set(
        pairedPayments
          .map((p) => p.sourceAccountId)
          .filter((id): id is string => id != null),
      ),
    ];
    if (sourceAccountIds.length === 0) return pairedPayments;

    const realInterestTxns = await withScopedDb(this.dataSource, (m) =>
      m.getRepository(Transaction).find({
        where: {
          userId,
          accountId: In(sourceAccountIds),
          categoryId: interestCategoryId,
          transactionDate: LessThanOrEqual(todayYMD()),
        },
      }),
    );
    // Voided and transfer rows carry no interest evidence, mirroring
    // pairSeparateInterest's own filtering (a voided row moved no money; a
    // transfer tagged with the interest category would be principal, not
    // interest).
    const realTxns = realInterestTxns.filter(
      (tx) => !tx.isVoid && !tx.isTransfer,
    );

    // Same cadence-derived tolerance and nearest-payment assignment
    // `pairSeparateInterest` uses, but fed only today-bounded candidates --
    // recomputing what that pairing would have found had the future-dated
    // transaction never existed.
    const dateKeys = originalPayments.map((p) => p.date.split("T")[0]);
    const tolerance = this.paymentPeriodToleranceDays(originalPayments);
    const todayBoundedSumByDate = new Map<string, number>();
    for (const tx of realTxns) {
      const txDate = tx.transactionDate.split("T")[0];
      const nearest = this.nearestPaymentDateKey(txDate, dateKeys, tolerance);
      if (!nearest) continue;
      todayBoundedSumByDate.set(
        nearest,
        (todayBoundedSumByDate.get(nearest) || 0) + Math.abs(Number(tx.amount)),
      );
    }

    const originalByDate = new Map<string, PaymentRecord>(
      originalPayments.map((p) => [p.date.split("T")[0], p]),
    );

    // Half a cent: both sides are produced by roundMoney over a sum of real
    // ledger amounts, so a genuine match is exact; this only absorbs
    // floating-point summation-order noise, never a materially different
    // amount.
    const AMOUNT_MATCH_EPSILON = 0.005;

    return pairedPayments.map((p) => {
      const dateKey = p.date.split("T")[0];
      if (!wasPairedByDate.get(dateKey)) return p;

      const todayBoundedSum = todayBoundedSumByDate.get(dateKey);
      const verified =
        todayBoundedSum != null &&
        todayBoundedSum > 0 &&
        Math.abs(roundMoney(todayBoundedSum) - (p.interestAmount ?? 0)) <=
          AMOUNT_MATCH_EPSILON;
      if (verified) return p;

      // A today-bounded rerun of the exact same nearest-payment matching
      // pairSeparateInterest used does not reproduce this payment's
      // recovered interest -- either nothing lands on this date at all, or
      // the original sum was inflated by a future-dated transaction. Revert
      // to the pre-pairing, principal-only record so it is treated exactly
      // like a failed pairing attempt, not a rate observation.
      const original = originalByDate.get(dateKey);
      return original
        ? { ...original, interestUnmatched: true }
        : { ...p, interestAmount: null, interestUnmatched: true };
    });
  }

  /**
   * Half the median payment interval, the window within which an interest
   * transaction is considered part of a given payment (min 10 days).
   * Mirrors `LoanPaymentDetectorService`'s private method of the same name
   * (`loan-payment-detector.service.ts`) exactly, so the verification below
   * uses the identical tolerance `pairSeparateInterest` used to produce the
   * pairing it is checking.
   */
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

  /**
   * The payment date key nearest to a transaction date, or null when the
   * closest payment is further away than the tolerance. Mirrors
   * `LoanPaymentDetectorService`'s private method of the same name
   * (`loan-payment-detector.service.ts`) exactly -- including ties resolving
   * to whichever candidate is encountered first -- so a today-bounded rerun
   * assigns evidence to payments exactly as the original pairing did.
   */
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
   * Convert each payment with an interest split and a known, large-enough
   * pre-payment balance into an annualized rate observation.
   */
  private buildObservations(
    account: Account,
    payments: PaymentRecord[],
    balanceMap: Map<string, number>,
    periodsPerYear: number,
    separatelyBookedByDate: Map<string, boolean>,
  ): RateObservation[] {
    const observations: RateObservation[] = [];
    for (const payment of payments) {
      if (payment.interestAmount == null || payment.interestAmount <= 0) {
        continue;
      }
      const dateKey = payment.date.split("T")[0];
      const balanceBefore = balanceMap.get(dateKey);
      if (!balanceBefore || balanceBefore < MIN_BALANCE_FOR_INFERENCE) {
        continue;
      }

      const periodicRate = payment.interestAmount / balanceBefore;
      const annualRate = this.annualizeRate(
        account,
        periodicRate,
        periodsPerYear,
      );
      if (annualRate <= 0 || annualRate >= 100) continue;

      observations.push({
        date: dateKey,
        annualRate,
        paymentAmount: payment.amount,
        interestBookedSeparately: separatelyBookedByDate.get(dateKey) ?? false,
      });
    }
    return observations;
  }

  /**
   * Annualize an observed periodic rate. This mirrors the frontend's
   * reconstruction (`assignObservedRates`) and the amortization formulas in
   * `loan-amortization.util.ts` / `mortgage-amortization.util.ts` -- both
   * define the periodic rate as `annualRate / periodsPerYear` (fixed by the
   * account's configured payment frequency), never by the calendar-day gap
   * between payments -- so a detected rate matches what the schedule shows:
   *  - Canadian mortgage: annualize by the nominal periods per year (the
   *    lender's convention), inverting the semi-annual compounding for a
   *    fixed-rate loan;
   *  - everything else (ordinary loans and non-Canadian mortgages): invert
   *    the same fixed-periods-per-year formula (`x periodsPerYear`), so a
   *    28-day February gap and a 31-day January gap on the same monthly loan
   *    yield the same annual rate instead of drifting with month length.
   */
  private annualizeRate(
    account: Account,
    periodicRate: number,
    periodsPerYear: number,
  ): number {
    const isCanadian = account.isCanadianMortgage || false;
    if (!isCanadian) {
      return periodicRate * periodsPerYear * 100;
    }
    return account.isVariableRate || false
      ? periodicRate * periodsPerYear * 100
      : (Math.pow(1 + periodicRate, periodsPerYear / 2) - 1) * 2 * 100;
  }

  /**
   * Payments per year from the account's configured frequency, falling back
   * to the median interval between payments when unset. Adds a warning when
   * the observed cadence disagrees with the configured frequency.
   */
  private resolvePeriodsPerYear(
    account: Account,
    payments: PaymentRecord[],
    warnings: string[],
  ): number {
    const observedPeriods = this.periodsPerYearFromIntervals(payments);

    if (account.paymentFrequency) {
      const configured =
        account.accountType === AccountType.MORTGAGE
          ? getMortgagePeriodsPerYear(
              account.paymentFrequency as MortgagePaymentFrequency,
            )
          : getPeriodsPerYear(account.paymentFrequency as PaymentFrequency);
      if (
        observedPeriods !== null &&
        Math.abs(observedPeriods - configured) / configured > 0.5
      ) {
        warnings.push(
          tr(
            "errors.loanRateChanges.frequencyMismatch",
            "Payment dates do not match the account's payment frequency; inferred rates may be less accurate",
          ),
        );
      }
      return configured;
    }

    return observedPeriods ?? 12;
  }

  /** Snap the median payment interval to a standard payments-per-year count */
  private periodsPerYearFromIntervals(
    payments: PaymentRecord[],
  ): number | null {
    if (payments.length < 3) return null;
    const intervals: number[] = [];
    for (let i = 1; i < payments.length; i++) {
      const prev = new Date(payments[i - 1].date);
      const curr = new Date(payments[i].date);
      intervals.push(
        Math.round((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24)),
      );
    }
    intervals.sort((a, b) => a - b);
    const median = intervals[Math.floor(intervals.length / 2)];
    if (median <= 0) return null;
    const raw = 365.25 / median;
    const standard = [52, 26, 24, 12, 4, 1];
    return standard.reduce((best, candidate) =>
      Math.abs(candidate - raw) < Math.abs(best - raw) ? candidate : best,
    );
  }

  /**
   * Step detection: maintain a running segment; a new segment opens when two
   * consecutive observations deviate from the segment median beyond
   * tolerance and agree with each other. A single deviating observation is
   * treated as an outlier (e.g. a lump-sum period) and skipped. Segments
   * with fewer than two observations are dropped.
   */
  private segmentObservations(observations: RateObservation[]): RateSegment[] {
    const rawSegments: RateObservation[][] = [];
    let current: RateObservation[] = [observations[0]];

    let i = 1;
    while (i < observations.length) {
      const median = this.median(current.map((o) => o.annualRate));
      const tolerance = Math.max(
        RATE_TOLERANCE_PP,
        median * RATE_TOLERANCE_REL,
      );
      const obs = observations[i];

      if (Math.abs(obs.annualRate - median) <= tolerance) {
        current.push(obs);
        i++;
        continue;
      }

      const next = observations[i + 1];
      const stepTolerance = Math.max(
        RATE_TOLERANCE_PP,
        obs.annualRate * RATE_TOLERANCE_REL,
      );
      const confirmed =
        next !== undefined &&
        Math.abs(next.annualRate - median) > tolerance &&
        Math.abs(next.annualRate - obs.annualRate) <= stepTolerance;

      if (confirmed) {
        rawSegments.push(current);
        current = [obs];
      }
      // Unconfirmed deviation: single outlier, skip it
      i++;
    }
    rawSegments.push(current);

    return rawSegments
      .filter((segment) => segment.length >= 2)
      .map((segment) => ({
        observations: segment,
        medianRate:
          Math.round(this.median(segment.map((o) => o.annualRate)) * 100) / 100,
        paymentAmount: this.modePaymentAmount(segment),
        // Any payment in this segment booking interest separately taints the
        // segment's paymentAmount for newPaymentAmount purposes, regardless
        // of what earlier or later segments in the same history did.
        interestBookedSeparately: segment.some(
          (o) => o.interestBookedSeparately,
        ),
      }));
  }

  /** Most common payment amount in a segment (1-cent grouping) */
  private modePaymentAmount(segment: RateObservation[]): number | null {
    const counts = new Map<number, number>();
    for (const obs of segment) {
      const rounded = Math.round(obs.paymentAmount * 100) / 100;
      counts.set(rounded, (counts.get(rounded) || 0) + 1);
    }
    let best: number | null = null;
    let bestCount = 0;
    for (const [amount, count] of counts) {
      if (count > bestCount) {
        bestCount = count;
        best = amount;
      }
    }
    return best;
  }

  private median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }

  /**
   * Replace previously inferred rows with the detected segments in one
   * transaction. Manual and initial rows are preserved; candidates whose
   * effective date collides with one are skipped.
   */
  private async persistSegments(
    userId: string,
    account: Account,
    segments: RateSegment[],
    warnings: string[],
  ): Promise<DetectRateChangesResult> {
    const created: LoanRateChange[] = [];
    let replacedCount = 0;
    await withScopedDb(this.dataSource, async (m) => {
      const deleted = await m.delete(LoanRateChange, {
        accountId: account.id,
        source: "inferred",
      });
      replacedCount = deleted.affected || 0;

      const kept = await m.find(LoanRateChange, {
        where: { accountId: account.id },
      });
      const keptDates = new Set(kept.map((row) => row.effectiveDate));
      const hasInitial = kept.some((row) => row.source === "initial");

      for (const [index, segment] of segments.entries()) {
        const isFirst = index === 0;
        // The first segment describes the origination rate: it becomes the
        // 'initial' row when none exists, and is otherwise already covered.
        if (isFirst && hasInitial) continue;

        const effectiveDate = segment.observations[0].date;
        if (keptDates.has(effectiveDate)) continue;

        const previous = index > 0 ? segments[index - 1] : null;
        const paymentStepped =
          previous?.paymentAmount != null &&
          segment.paymentAmount != null &&
          Math.abs(segment.paymentAmount - previous.paymentAmount) >
            PAYMENT_STEP_EPSILON;

        const row = m.create(LoanRateChange, {
          userId,
          accountId: account.id,
          effectiveDate,
          annualRate: segment.medianRate,
          newPaymentAmount: segment.interestBookedSeparately
            ? null
            : isFirst
              ? segment.paymentAmount != null
                ? roundMoney(segment.paymentAmount)
                : null
              : paymentStepped
                ? roundMoney(segment.paymentAmount!)
                : null,
          source: isFirst ? ("initial" as const) : ("inferred" as const),
          note: null,
        });
        created.push(await m.save(row));
      }
    });

    // Detection is historical inference: it only writes timeline rows and must
    // never overwrite the account's user-owned rate/payment or resync the
    // linked scheduled bill (that would clobber manually-set values).

    this.logger.log(
      `Detected ${created.length} rate segment(s) for account ${account.id} (replaced ${replacedCount} inferred rows)`,
    );
    return { created, replacedCount, warnings };
  }
}
