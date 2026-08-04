import {
  Injectable,
  Inject,
  forwardRef,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from "@nestjs/common";
import { createHash } from "crypto";
import { DataSource, EntityManager } from "typeorm";
import { tr } from "../i18n/translate";
import { withScopedDb } from "../common/db/scoped-db";
import { LoanRateChange } from "./entities/loan-rate-change.entity";
import { Account, AccountType } from "../accounts/entities/account.entity";
import { CreateLoanRateChangeDto } from "./dto/create-loan-rate-change.dto";
import { UpdateLoanRateChangeDto } from "./dto/update-loan-rate-change.dto";
import { ScheduledTransactionsService } from "../scheduled-transactions/scheduled-transactions.service";
import {
  getPeriodicRate,
  getMortgagePeriodsPerYear,
  recalculateMortgageAfterRateChange,
  MortgagePaymentFrequency,
} from "../accounts/mortgage-amortization.util";
import { getPeriodsPerYear } from "../accounts/loan-amortization.util";
import { PaymentFrequency } from "../accounts/loan-amortization.util";
import { roundMoney, sumMoney } from "../common/round.util";
import { todayYMD, formatDateYMDLocal } from "../common/date-utils";

const RATE_CHANGE_ACCOUNT_TYPES = [AccountType.LOAN, AccountType.MORTGAGE];

/**
 * A before/after summary of how a linked scheduled bill payment would change
 * to match the account's new rate/payment. Returned by `create` when the caller
 * defers the sync so the UI can ask the user for permission before applying it.
 */
export interface ScheduledPaymentPreview {
  scheduledTransactionId: string;
  scheduledTransactionName: string | null;
  currencyCode: string;
  /** Absolute total payment amounts (null when unknown from the schedule) */
  currentPaymentAmount: number | null;
  proposedPaymentAmount: number;
  /** Absolute principal/interest portions; current values are null when the
   * schedule's splits do not clearly separate them */
  currentPrincipal: number | null;
  proposedPrincipal: number;
  currentInterest: number | null;
  proposedInterest: number;
  /** Extra-principal split preserved as-is (0 when there is none) */
  extraPrincipal: number;
}

/** The scheduled-payment update to apply, plus its user-facing preview. */
export interface ScheduledUpdatePlan {
  scheduledTransactionId: string;
  payload: Parameters<ScheduledTransactionsService["update"]>[2];
  preview: ScheduledPaymentPreview;
}

/** A created rate change plus the pending scheduled-payment change, if any. */
export type CreateLoanRateChangeResult = LoanRateChange & {
  scheduledPaymentPreview: ScheduledPaymentPreview | null;
  /**
   * SHA-256 hex hash binding the confirmation to the exact update that will be
   * applied; null when there is no pending change. Pass it back to
   * `applyScheduledPaymentSync` so a confirmation that no longer matches the
   * current state is rejected.
   */
  scheduledPaymentPreviewHash: string | null;
};

/**
 * Deterministic JSON: object keys sorted recursively so key order never
 * affects the hash, arrays kept in place (their order is meaningful), and
 * `undefined` normalized to `null`. Used to fingerprint the scheduled-payment
 * update payload.
 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * Fingerprint the *payload* that will actually be written to the linked
 * scheduled transaction, together with the transaction it targets -- i.e. the
 * complete set of state a confirmation applies.
 *
 * This deliberately hashes the payload, NOT the preview. The preview is a
 * lossy summary (aggregate principal/interest/extra totals), so materially
 * different payloads collapse to the same preview: two extra-principal splits
 * of 40/60 re-split as 50/50, the same amounts moved to a different category,
 * tag set or memo, or the whole bill relinked to another scheduled transaction
 * all leave every preview figure unchanged. Binding the confirmation to the
 * payload rejects ANY divergence between what the user previewed and what would
 * now be applied, rather than only the figures the preview happens to show
 * (REV-20260803-029). Because the payload is exactly the argument handed to
 * `ScheduledTransactionsService.update`, nothing that gets applied is left
 * unhashed -- including fields added to the payload later.
 *
 * `tagIds` are sorted before hashing so a tag set that is equal but returned in
 * a different order by the database does not read as a change; split order is
 * preserved because it is deterministic and part of what is written.
 */
export function hashScheduledUpdatePayload(
  scheduledTransactionId: string,
  payload: ScheduledUpdatePlan["payload"],
): string {
  // Spread the whole payload rather than pick fields: every field it carries
  // now, and any added later, is part of what gets written and so must be part
  // of the fingerprint. Only tagIds are normalized (sorted), because a tag set
  // is order-independent and the database may return it in any order.
  const normalized = {
    ...payload,
    scheduledTransactionId,
    splits: (payload.splits ?? []).map((split) => ({
      ...split,
      tagIds: Array.isArray(split.tagIds)
        ? [...split.tagIds].sort()
        : split.tagIds,
    })),
  };
  return createHash("sha256").update(stableStringify(normalized)).digest("hex");
}

/** Normalize a DATE column value (string at runtime, Date in tests) to YYYY-MM-DD */
export function toYmd(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.split("T")[0];
  return formatDateYMDLocal(value);
}

function dayBefore(ymd: string): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(year, month - 1, day - 1);
  return formatDateYMDLocal(date);
}

/** Whole calendar months from `fromYmd` to `toYmd` (floored at 0) */
function monthsBetweenYmd(fromYmd: string, toYmdStr: string): number {
  const [fromYear, fromMonth] = fromYmd.split("-").map(Number);
  const [toYear, toMonth] = toYmdStr.split("-").map(Number);
  return Math.max(0, (toYear - fromYear) * 12 + (toMonth - fromMonth));
}

/**
 * Whether a scheduled transaction's transfer-to-loan split is a standalone
 * extra-principal (overpayment) split, using the same per-account
 * overpayment recognition fields the loan-history report matches posted
 * transactions against (`isOverpayment` in
 * frontend/src/lib/loan-history.ts): the account's configured overpayment
 * category, or its configured overpayment memo substring (case-insensitive).
 * The literal "extra" substring is kept as an additional, unconditional
 * fallback so splits this same sync already created before an account had
 * either field configured -- its payload always memos a new extra split as
 * "Extra Principal" -- keep surviving rebuilds.
 *
 * The account's `overpaymentPayeeId` is deliberately not consulted here: it
 * lives on the parent scheduled transaction (the whole bill's payee), not on
 * the split, and every transfer-to-loan split -- the regular principal leg
 * and an extra-principal leg alike -- shares that one parent. Matching on it
 * would flag both splits identically instead of telling them apart, unlike
 * `isOverpayment`'s payee check against a posted transaction, which is never
 * shared between an overpayment and a same-day regular payment.
 */
function isExtraPrincipalSplit(
  split: { categoryId?: string | null; memo?: string | null },
  account: Account,
): boolean {
  if (
    account.overpaymentCategoryId &&
    split.categoryId === account.overpaymentCategoryId
  ) {
    return true;
  }
  const memo = split.memo?.toLowerCase() ?? "";
  const configuredMemo = account.overpaymentMemo?.trim().toLowerCase();
  if (configuredMemo && memo.includes(configuredMemo)) {
    return true;
  }
  return memo.includes("extra");
}

/**
 * Allocate a (possibly rate-capped) total across the amounts multiple
 * recognized extra-principal splits originally requested, preserving each
 * split's proportional share rather than collapsing them into one (REV-20260803-028).
 * When the balance does not force capping, every split simply keeps what it
 * asked for. When it does, amounts are scaled down proportionally and any
 * rounding remainder is absorbed by the last entry, so the returned amounts
 * always sum to exactly `total` -- required because the rebuilt payload's
 * parent amount must equal the sum of its splits.
 */
function allocateCappedAmounts(requested: number[], total: number): number[] {
  if (requested.length === 0) return [];
  const requestedTotal = sumMoney(requested);
  if (requestedTotal <= 0) {
    // Nothing was actually requested (e.g. all-zero splits) -- avoid
    // dividing by zero; the (also zero/negative-clamped) total has nothing
    // meaningful to distribute.
    return requested.map(() => 0);
  }
  if (total >= requestedTotal) {
    // No capping needed -- every split keeps exactly what it asked for.
    return requested.map((amount) => roundMoney(amount));
  }
  const scale = total / requestedTotal;
  const allocated = requested.map((amount) => roundMoney(amount * scale));
  const remainder = roundMoney(total - sumMoney(allocated));
  if (remainder !== 0) {
    allocated[allocated.length - 1] = roundMoney(
      allocated[allocated.length - 1] + remainder,
    );
  }
  return allocated;
}

@Injectable()
export class LoanRateChangesService {
  private readonly logger = new Logger(LoanRateChangesService.name);

  constructor(
    private dataSource: DataSource,
    @Inject(forwardRef(() => ScheduledTransactionsService))
    private scheduledTransactionsService: ScheduledTransactionsService,
  ) {}

  async findAll(userId: string, accountId: string): Promise<LoanRateChange[]> {
    await this.verifyLoanAccount(userId, accountId);
    return withScopedDb(this.dataSource, (m) =>
      m.getRepository(LoanRateChange).find({
        where: { userId, accountId },
        order: { effectiveDate: "ASC" },
      }),
    );
  }

  /**
   * Record a rate change. The account's own `interestRate`/`paymentAmount` are
   * left untouched (they are user-owned via the edit form); only the linked
   * scheduled bill payment is realigned to the timeline's current rate. By
   * default that resync is applied immediately (the legacy mortgage-rate
   * behaviour). Pass `deferScheduledSync` to instead return a preview of the
   * pending scheduled-payment change and leave it unapplied, so the caller can
   * confirm with the user before applying it via `applyScheduledPaymentSync`.
   */
  async create(
    userId: string,
    accountId: string,
    dto: CreateLoanRateChangeDto,
    options?: { deferScheduledSync?: boolean },
  ): Promise<CreateLoanRateChangeResult> {
    const account = await this.verifyLoanAccount(userId, accountId);

    if (dto.newPaymentAmount != null && dto.recalculatePayment) {
      throw new BadRequestException(
        tr(
          "errors.loanRateChanges.paymentModeConflict",
          "Provide either a new payment amount or recalculatePayment, not both",
        ),
      );
    }
    if (dto.recalculatePayment) {
      if (account.accountType !== AccountType.MORTGAGE) {
        throw new BadRequestException(
          tr(
            "errors.loanRateChanges.recalculateMortgageOnly",
            "Payment recalculation is only available for mortgage accounts",
          ),
        );
      }
      if (account.isClosed) {
        throw new BadRequestException(
          tr(
            "errors.accounts.updateRateClosed",
            "Cannot update rate on a closed account",
          ),
        );
      }
    }

    const newPaymentAmount = dto.recalculatePayment
      ? this.recalculatePaymentForRate(
          account,
          dto.annualRate,
          dto.effectiveDate,
        )
      : (dto.newPaymentAmount ?? null);

    const { saved, resolved } = await withScopedDb(
      this.dataSource,
      async (m) => {
        await this.rejectDuplicateDate(m, accountId, dto.effectiveDate);
        await this.insertInitialRowIfFirst(m, account, dto.effectiveDate);

        const rateChange = m.create(LoanRateChange, {
          userId,
          accountId,
          effectiveDate: dto.effectiveDate,
          annualRate: dto.annualRate,
          newPaymentAmount,
          source: "manual" as const,
          note: dto.note ?? null,
        });

        return {
          saved: await m.save(rateChange),
          resolved: await this.resolveCurrentTimeline(m, account),
        };
      },
    );

    let scheduledPaymentPreview: ScheduledPaymentPreview | null = null;
    let scheduledPaymentPreviewHash: string | null = null;
    if (resolved) {
      if (options?.deferScheduledSync) {
        const plan = await this.buildScheduledUpdate(userId, account, resolved);
        scheduledPaymentPreview = plan?.preview ?? null;
        scheduledPaymentPreviewHash = plan
          ? hashScheduledUpdatePayload(plan.scheduledTransactionId, plan.payload)
          : null;
      } else {
        await this.syncScheduledTransaction(userId, account, resolved);
      }
    }
    return { ...saved, scheduledPaymentPreview, scheduledPaymentPreviewHash };
  }

  async update(
    userId: string,
    accountId: string,
    id: string,
    dto: UpdateLoanRateChangeDto,
  ): Promise<LoanRateChange> {
    const account = await this.verifyLoanAccount(userId, accountId);
    const rateChange = await this.findOne(userId, accountId, id);

    return withScopedDb(this.dataSource, async (m) => {
      if (
        dto.effectiveDate !== undefined &&
        dto.effectiveDate !== rateChange.effectiveDate
      ) {
        await this.rejectDuplicateDate(m, accountId, dto.effectiveDate);
      }

      const merged = m.merge(LoanRateChange, rateChange, {
        ...(dto.effectiveDate !== undefined
          ? { effectiveDate: dto.effectiveDate }
          : {}),
        ...(dto.annualRate !== undefined ? { annualRate: dto.annualRate } : {}),
        ...(dto.newPaymentAmount !== undefined
          ? { newPaymentAmount: dto.newPaymentAmount }
          : {}),
        ...(dto.note !== undefined ? { note: dto.note } : {}),
        // A user-edited inferred row becomes manual so re-running detection
        // never clobbers their correction.
        ...(rateChange.source === "inferred"
          ? { source: "manual" as const }
          : {}),
      });

      const saved = await m.save(merged);
      const resolved = await this.resolveCurrentTimeline(m, account);

      // The scheduled-payment resync runs inside the same transaction as the
      // rate-change write (withScopedDb joins the ambient one, see
      // scoped-db.ts) and its failure is propagated rather than swallowed --
      // otherwise the rate-change row would already be committed while the
      // linked scheduled bill payment silently kept its stale rate/payment
      // split, and the caller would see success for a change that only half
      // happened.
      if (resolved) {
        await this.syncScheduledTransaction(userId, account, resolved, {
          propagateErrors: true,
        });
      }
      return saved;
    });
  }

  async remove(userId: string, accountId: string, id: string): Promise<void> {
    const account = await this.verifyLoanAccount(userId, accountId);
    const rateChange = await this.findOne(userId, accountId, id);

    await withScopedDb(this.dataSource, async (m) => {
      await m.remove(rateChange);
      const resolved = await this.resolveCurrentTimeline(m, account);

      // Same rationale as update(): sync inside the transaction and propagate
      // a failure so the removal never commits while the linked scheduled
      // bill payment is left pointing at a rate change that no longer exists.
      if (resolved) {
        await this.syncScheduledTransaction(userId, account, resolved, {
          propagateErrors: true,
        });
      }
    });
  }

  /**
   * Resolve the rate and payment in effect today from the timeline WITHOUT
   * mutating the account: the rate is the latest row not in the future; the
   * payment is the latest non-null newPaymentAmount at or before today. Rows
   * dated in the future are recorded but not applied. The account's own
   * `interestRate`/`paymentAmount` remain user-owned (set only via the account
   * edit form) and are never overwritten from the timeline -- so editing rates
   * or running detection can never clobber a manually-set rate/payment. Returns
   * null for a closed account or when no row applies (nothing to resync).
   */
  async resolveCurrentTimeline(
    manager: EntityManager,
    account: Account,
  ): Promise<{ annualRate: number; paymentAmount: number | null } | null> {
    if (account.isClosed) return null;

    const rows = await manager.find(LoanRateChange, {
      where: { accountId: account.id },
      order: { effectiveDate: "ASC" },
    });
    const today = todayYMD();
    const applicable = rows.filter((row) => row.effectiveDate <= today);
    if (applicable.length === 0) return null;

    const latest = applicable[applicable.length - 1];
    const latestWithPayment = [...applicable]
      .reverse()
      .find((row) => row.newPaymentAmount != null);

    return {
      annualRate: Number(latest.annualRate),
      paymentAmount:
        latestWithPayment?.newPaymentAmount != null
          ? Number(latestWithPayment.newPaymentAmount)
          : null,
    };
  }

  /**
   * Resync the linked scheduled payment to the account's current rate and
   * payment.
   *
   * By default this is best-effort (logged and swallowed), mirroring the
   * tolerance of the legacy mortgage-rate update flow -- used by `create`'s
   * immediate-sync path, where the rate history itself is already committed
   * in its own prior transaction and there is nothing left to roll back.
   *
   * Pass `propagateErrors: true` for a caller that runs this *inside* the
   * same transaction as the rate-change write (`update`/`remove`): there, a
   * sync failure must abort the whole transaction rather than leave the rate
   * change committed against a stale scheduled payment.
   */
  async syncScheduledTransaction(
    userId: string,
    account: Account,
    override?: { annualRate: number; paymentAmount: number | null },
    options?: { propagateErrors?: boolean },
  ): Promise<void> {
    const plan = await this.buildScheduledUpdate(userId, account, override);
    if (!plan) return;
    try {
      await this.scheduledTransactionsService.update(
        userId,
        plan.scheduledTransactionId,
        plan.payload,
      );
    } catch (error) {
      if (options?.propagateErrors) {
        throw error;
      }
      this.logger.warn(
        `Could not update scheduled transaction: ${error.message}`,
      );
    }
  }

  /**
   * Apply the pending scheduled-payment change for an account after the user
   * has granted permission. Recomputes from the account's current (already
   * updated) rate/payment so it matches the preview shown at rate-change time.
   * Returns the applied change, or null when there is nothing to sync.
   *
   * When `expectedPreviewHash` is supplied (the hash returned alongside the
   * preview by `create`), the freshly computed plan's *payload* is hashed and
   * compared before anything is applied. If the hashes differ -- because
   * another tab edited the rate, payment, or any individual extra split (its
   * amount, category, tags or memo) between preview and confirmation -- a
   * ConflictException is thrown that carries the fresh preview and its hash so
   * the UI can present the updated proposal for re-authorization.
   */
  async applyScheduledPaymentSync(
    userId: string,
    accountId: string,
    expectedPreviewHash?: string,
  ): Promise<ScheduledPaymentPreview | null> {
    const account = await this.verifyLoanAccount(userId, accountId);
    const resolved = await withScopedDb(this.dataSource, (m) =>
      this.resolveCurrentTimeline(m, account),
    );
    const plan = await this.buildScheduledUpdate(
      userId,
      account,
      resolved ?? undefined,
    );
    if (!plan) return null;
    if (expectedPreviewHash !== undefined) {
      const freshHash = hashScheduledUpdatePayload(
        plan.scheduledTransactionId,
        plan.payload,
      );
      if (freshHash !== expectedPreviewHash) {
        throw new ConflictException({
          message: tr(
            "errors.loanRateChanges.previewStale",
            "The scheduled-payment preview has changed since it was shown; please review the updated proposal",
          ),
          freshPreview: plan.preview,
          freshPreviewHash: freshHash,
        });
      }
    }
    await this.scheduledTransactionsService.update(
      userId,
      plan.scheduledTransactionId,
      plan.payload,
    );
    return plan.preview;
  }

  /**
   * Recompute the linked scheduled payment's principal/interest split from the
   * account's current balance and rate, preserving every separate
   * extra-principal split -- there can be more than one (recognized via
   * `isExtraPrincipalSplit` -- the account's configured overpayment category
   * or memo, or the legacy literal "extra" memo substring), along with each
   * one's categoryId and tags. Returns the update to apply plus a before/after
   * preview, or null when the account has no applicable linked scheduled bill
   * payment. Does not apply anything.
   */
  async buildScheduledUpdate(
    userId: string,
    account: Account,
    override?: { annualRate: number; paymentAmount: number | null },
  ): Promise<ScheduledUpdatePlan | null> {
    if (account.isClosed || !account.scheduledTransactionId) return null;
    // The current rate/payment come from the resolved timeline when supplied,
    // else the account's own (user-owned) scalars. The timeline never mutates
    // the account, so this override is how a rate change reaches the bill.
    const annualRate = override?.annualRate ?? account.interestRate;
    const effectivePayment =
      override?.paymentAmount ?? account.paymentAmount ?? null;
    if (annualRate == null || !effectivePayment || !account.paymentFrequency) {
      return null;
    }
    const balance = Math.abs(Number(account.currentBalance));
    if (balance <= 0.01) return null;

    let scheduled: Awaited<ReturnType<ScheduledTransactionsService["findOne"]>>;
    try {
      scheduled = await this.scheduledTransactionsService.findOne(
        userId,
        account.scheduledTransactionId,
      );
    } catch (error) {
      // Only a genuine "this scheduled transaction no longer exists" is a
      // legitimate no-op -- scheduledTransactionsService.findOne throws
      // NotFoundException exclusively for that case. Any other error (a
      // timeout, a transient DB failure, anything else) must not be
      // swallowed into the same null: doing so would make syncScheduledTransaction
      // treat a failed lookup as "nothing to sync", so update()/remove()
      // would report success via propagateErrors while the linked scheduled
      // payment silently keeps its stale rate/split.
      if (error instanceof NotFoundException) {
        this.logger.warn(
          `Could not load scheduled transaction: ${error.message}`,
        );
        return null;
      }
      throw error;
    }

    const isMortgage = account.accountType === AccountType.MORTGAGE;
    const periodicRate = isMortgage
      ? getPeriodicRate(
          annualRate,
          getMortgagePeriodsPerYear(
            account.paymentFrequency as MortgagePaymentFrequency,
          ),
          account.isCanadianMortgage || false,
          account.isVariableRate || false,
        )
      : annualRate /
        100 /
        getPeriodsPerYear(account.paymentFrequency as PaymentFrequency);

    const paymentAmount = Number(effectivePayment);
    let interest = roundMoney(balance * periodicRate);
    if (interest > paymentAmount) interest = paymentAmount;

    const splits = scheduled.splits || [];
    // A scheduled transaction can legitimately carry more than one recognized
    // extra-principal split (e.g. two separate recurring overpayments
    // configured differently) -- `filter`, not `find`, so every one of them
    // is preserved when the payload replaces all splits, not just the first
    // (REV-20260803-028).
    const extraSplits = splits.filter(
      (s) =>
        s.transferAccountId === account.id && isExtraPrincipalSplit(s, account),
    );
    const requestedExtraAmounts = extraSplits.map((s) =>
      Math.abs(Number(s.amount)),
    );
    const requestedExtraTotal = sumMoney(requestedExtraAmounts);

    // Regular principal and extra principal are capped against the remaining
    // balance *together*, not independently -- otherwise a near-payoff balance
    // can still be overshot by the extra split even after the regular split
    // alone respects it.
    let principal = roundMoney(paymentAmount - interest);
    if (principal > balance) principal = roundMoney(balance);
    const remainingForExtra = Math.max(0, roundMoney(balance - principal));
    const extraTotal = roundMoney(
      Math.min(requestedExtraTotal, remainingForExtra),
    );
    const extraAmounts = allocateCappedAmounts(
      requestedExtraAmounts,
      extraTotal,
    );

    // The parent amount must equal the sum of its splits -- ScheduledTransactionsService
    // rejects the update otherwise. Derive it from the actual interest plus the
    // (possibly capped) regular and extra principal, never leave it at the
    // uncapped full contractual payment.
    const proposedPaymentAmount = roundMoney(interest + principal + extraTotal);

    const payload = {
      amount: -proposedPaymentAmount,
      splits: [
        {
          transferAccountId: account.id,
          amount: -principal,
          memo: "Principal",
        },
        {
          categoryId: account.interestCategoryId || undefined,
          amount: -interest,
          memo: "Interest",
        },
        // Each recognized extra-principal split is rebuilt individually,
        // carrying over its own categoryId (and tags) -- not just
        // transferAccountId/amount/memo. Dropping categoryId here silently
        // un-recognizes a split that was originally matched via the
        // account's configured overpayment category: the next sync would no
        // longer see a category to match against and would fall through to
        // memo-based recognition, which fails too unless the memo happens to
        // contain "extra" (REV-20260803-028).
        ...extraSplits.map((extraSplit, index) => ({
          transferAccountId: account.id,
          ...(extraSplit.categoryId
            ? { categoryId: extraSplit.categoryId }
            : {}),
          ...(extraSplit.tags && extraSplit.tags.length > 0
            ? { tagIds: extraSplit.tags.map((tag) => tag.id) }
            : {}),
          amount: -extraAmounts[index],
          memo: extraSplit.memo || "Extra Principal",
        })),
      ],
    };

    const principalSplit = splits.find(
      (s) =>
        s.transferAccountId === account.id &&
        !isExtraPrincipalSplit(s, account),
    );
    const interestSplit = splits.find(
      (s) =>
        !s.transferAccountId &&
        (s.categoryId != null || s.memo?.toLowerCase().includes("interest")),
    );

    const preview: ScheduledPaymentPreview = {
      scheduledTransactionId: account.scheduledTransactionId,
      scheduledTransactionName: scheduled.name ?? null,
      currencyCode: scheduled.currencyCode ?? account.currencyCode ?? "",
      currentPaymentAmount:
        scheduled.amount != null ? Math.abs(Number(scheduled.amount)) : null,
      proposedPaymentAmount,
      currentPrincipal: principalSplit
        ? Math.abs(Number(principalSplit.amount))
        : null,
      proposedPrincipal: principal,
      currentInterest: interestSplit
        ? Math.abs(Number(interestSplit.amount))
        : null,
      proposedInterest: interest,
      // Summed across every recognized extra-principal split, not just one
      // -- the preview must stay consistent with the payload, which now
      // rebuilds every one of them (REV-20260803-028).
      extraPrincipal: extraTotal,
    };

    return {
      scheduledTransactionId: account.scheduledTransactionId,
      payload,
      preview,
    };
  }

  /**
   * Snapshot the origination rate as an 'initial' row the first time any
   * change is recorded, so the timeline carries an explicit anchor for the
   * pre-change rate rather than relying on the account's current scalar.
   */
  async insertInitialRowIfFirst(
    manager: EntityManager,
    account: Account,
    firstChangeDate: string,
  ): Promise<void> {
    const count = await manager.count(LoanRateChange, {
      where: { accountId: account.id },
    });
    if (count > 0) return;
    if (account.interestRate == null) return;

    const startDate = toYmd(account.paymentStartDate);
    const effectiveDate =
      startDate && startDate < firstChangeDate
        ? startDate
        : dayBefore(firstChangeDate);

    const initial = manager.create(LoanRateChange, {
      userId: account.userId,
      accountId: account.id,
      effectiveDate,
      annualRate: Number(account.interestRate),
      newPaymentAmount:
        account.paymentAmount != null ? Number(account.paymentAmount) : null,
      source: "initial" as const,
      note: null,
    });
    await manager.save(initial);
  }

  /** Ownership and type gate applied before any rate-change operation */
  async verifyLoanAccount(userId: string, accountId: string): Promise<Account> {
    const account = await withScopedDb(this.dataSource, (m) =>
      m.getRepository(Account).findOne({
        where: { id: accountId, userId },
      }),
    );
    if (!account) {
      throw new NotFoundException(
        tr(
          "errors.accounts.accountWithIdNotFound",
          `Account with ID ${accountId} not found`,
          { id: accountId },
        ),
      );
    }
    if (!RATE_CHANGE_ACCOUNT_TYPES.includes(account.accountType)) {
      throw new BadRequestException(
        tr(
          "errors.loanRateChanges.notLoanAccount",
          "Rate changes are only available for loan and mortgage accounts",
        ),
      );
    }
    return account;
  }

  private async findOne(
    userId: string,
    accountId: string,
    id: string,
  ): Promise<LoanRateChange> {
    const rateChange = await withScopedDb(this.dataSource, (m) =>
      m.getRepository(LoanRateChange).findOne({
        where: { id, userId, accountId },
      }),
    );
    if (!rateChange) {
      throw new NotFoundException(
        tr(
          "errors.loanRateChanges.notFound",
          `Rate change with ID ${id} not found`,
          { id },
        ),
      );
    }
    return rateChange;
  }

  private async rejectDuplicateDate(
    manager: EntityManager,
    accountId: string,
    effectiveDate: string,
  ): Promise<void> {
    const existing = await manager.findOne(LoanRateChange, {
      where: { accountId, effectiveDate },
    });
    if (existing) {
      throw new ConflictException(
        tr(
          "errors.loanRateChanges.duplicateDate",
          `A rate change effective ${effectiveDate} already exists for this account`,
          { date: effectiveDate },
        ),
      );
    }
  }

  /**
   * Payment that holds the remaining amortization constant at the new rate
   * (the pre-history mortgage-rate endpoint's behaviour, now opt-in).
   *
   * Only valid for effectiveDate = today: account.currentBalance is the
   * balance right now, so using it for any other date produces a wrong
   * payment (future date: balance too high; past date: balance too low).
   */
  private recalculatePaymentForRate(
    account: Account,
    annualRate: number,
    effectiveDate: string,
  ): number {
    if (effectiveDate !== todayYMD()) {
      throw new BadRequestException(
        tr(
          "errors.loanRateChanges.recalculateTodayOnly",
          "Automatic payment recalculation is only available for rate changes effective today; provide an explicit payment amount for other dates",
        ),
      );
    }
    const currentBalance = Math.abs(Number(account.currentBalance));
    const startDate = toYmd(account.paymentStartDate) ?? todayYMD();
    const monthsElapsed = monthsBetweenYmd(startDate, effectiveDate);
    const amortizationMonths = account.amortizationMonths || 300;
    const rawRemainingMonths = amortizationMonths - monthsElapsed;
    if (rawRemainingMonths < 1) {
      throw new BadRequestException(
        tr(
          "errors.loanRateChanges.effectiveDateBeyondAmortization",
          "Effective date is beyond the loan's configured amortization end date",
        ),
      );
    }
    // Clamp to a single valid payment period, not an arbitrary minimum term:
    // a mortgage with only a few months left must be recalculated over its
    // actual remaining term, not extended out to a full year.
    const remainingAmortizationMonths = Math.max(1, rawRemainingMonths);

    const result = recalculateMortgageAfterRateChange(
      currentBalance,
      annualRate,
      remainingAmortizationMonths,
      (account.paymentFrequency || "MONTHLY") as MortgagePaymentFrequency,
      account.isCanadianMortgage || false,
      account.isVariableRate || false,
    );
    return result.paymentAmount;
  }
}
