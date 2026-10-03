import {
  Injectable,
  Inject,
  forwardRef,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { tr } from "../i18n/translate";
import { withScopedDb } from "../common/db/scoped-db";
import { LoanRateChange } from "./entities/loan-rate-change.entity";
import { Account, AccountType } from "../accounts/entities/account.entity";
import { CreateLoanRateChangeDto } from "./dto/create-loan-rate-change.dto";
import { UpdateLoanRateChangeDto } from "./dto/update-loan-rate-change.dto";
import { ScheduledTransactionsService } from "../scheduled-transactions/scheduled-transactions.service";
import { getPeriodicRate } from "../accounts/mortgage-amortization.util";
import { roundMoney } from "../common/round.util";
import { datedLoanDebt } from "../accounts/dated-loan-debt.util";
import {
  MortgageType,
  mortgageTypeOf,
  storesConstantPayment,
} from "../accounts/mortgage-type.util";
import { nonAnnuityInstallment } from "../accounts/mortgage-installment.util";
import { datedAnnuityInstallment } from "../accounts/annuity-relevel.util";
import { effectiveAnnualRateOn } from "../accounts/effective-loan-rate.util";
import { todayYMD, formatDateYMDLocal } from "../common/date-utils";
import {
  DEFAULT_PERIODS_PER_YEAR,
  periodsPerYearForStoredFrequency,
} from "../accounts/payment-frequency.util";

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
interface ScheduledUpdatePlan {
  scheduledTransactionId: string;
  payload: Parameters<ScheduledTransactionsService["update"]>[2];
  preview: ScheduledPaymentPreview;
}

/**
 * The rate and payment in effect today from the timeline, and the date the
 * rate took effect (absent when the caller supplies a rate of its own).
 */
export interface ResolvedTimeline {
  annualRate: number;
  paymentAmount: number | null;
  effectiveDate?: string;
}

/** A created rate change plus the pending scheduled-payment change, if any. */
export type CreateLoanRateChangeResult = LoanRateChange & {
  scheduledPaymentPreview: ScheduledPaymentPreview | null;
};

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

/** The later of two YYYY-MM-DD dates; `b` when `a` is absent. */
function laterYmd(a: string | undefined, b: string): string {
  return a !== undefined && a > b ? a : b;
}

/**
 * The type of a mortgage whose method states every installment itself
 * (LINEAR, INTEREST_ONLY), or null for an annuity mortgage and any other
 * loan. A stated payment on a rate change of such a mortgage would be a second,
 * conflicting answer to "what is the installment" (spec section 5.3).
 */
export function derivedInstallmentType(account: Account): MortgageType | null {
  if (account.accountType !== AccountType.MORTGAGE) return null;
  const type = mortgageTypeOf(account);
  return storesConstantPayment(type) ? null : type;
}

/** Refuse a stated payment for a mortgage whose method derives it. */
export function refuseStatedPayment(
  account: Account,
  paymentAmount: number | null | undefined,
): void {
  const type = derivedInstallmentType(account);
  if (type !== null && paymentAmount != null) {
    throw new BadRequestException(
      tr(
        "errors.loanRateChanges.methodDerivesPayment",
        `A ${type} mortgage's installment is priced from its debt and rate on each due date, so a rate change cannot state a payment amount`,
        { type },
      ),
    );
  }
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

    refuseStatedPayment(account, dto.newPaymentAmount);
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

    const { saved, resolved } = await withScopedDb(
      this.dataSource,
      async (m) => {
        await this.rejectDuplicateDate(m, accountId, dto.effectiveDate);
        // Read in the same transaction as the insert, so the payment recorded
        // is priced from the ledger the row is written against.
        const newPaymentAmount = dto.recalculatePayment
          ? await this.recalculatePaymentForRate(
              m,
              account,
              dto.annualRate,
              dto.effectiveDate,
            )
          : (dto.newPaymentAmount ?? null);
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
    if (resolved) {
      if (options?.deferScheduledSync) {
        const plan = await this.buildScheduledUpdate(userId, account, resolved);
        scheduledPaymentPreview = plan?.preview ?? null;
      } else {
        await this.syncScheduledTransaction(userId, account, resolved);
      }
    }
    return { ...saved, scheduledPaymentPreview };
  }

  async update(
    userId: string,
    accountId: string,
    id: string,
    dto: UpdateLoanRateChangeDto,
  ): Promise<LoanRateChange> {
    const account = await this.verifyLoanAccount(userId, accountId);
    refuseStatedPayment(account, dto.newPaymentAmount);
    const rateChange = await this.findOne(userId, accountId, id);

    const { saved, resolved } = await withScopedDb(
      this.dataSource,
      async (m) => {
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
          ...(dto.annualRate !== undefined
            ? { annualRate: dto.annualRate }
            : {}),
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

        return {
          saved: await m.save(merged),
          resolved: await this.resolveCurrentTimeline(m, account),
        };
      },
    );

    if (resolved) {
      await this.syncScheduledTransaction(userId, account, resolved);
    }
    return saved;
  }

  async remove(userId: string, accountId: string, id: string): Promise<void> {
    const account = await this.verifyLoanAccount(userId, accountId);
    const rateChange = await this.findOne(userId, accountId, id);

    const resolved = await withScopedDb(this.dataSource, async (m) => {
      await m.remove(rateChange);
      return this.resolveCurrentTimeline(m, account);
    });

    if (resolved) {
      await this.syncScheduledTransaction(userId, account, resolved);
    }
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
  ): Promise<ResolvedTimeline | null> {
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
      effectiveDate: toYmd(latest.effectiveDate) ?? undefined,
    };
  }

  /**
   * Resync the linked scheduled payment to the account's current rate and
   * payment. Best-effort, mirroring the tolerance of the mortgage-rate update
   * flow -- the rate history itself is already committed.
   */
  async syncScheduledTransaction(
    userId: string,
    account: Account,
    override?: ResolvedTimeline,
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
   */
  async applyScheduledPaymentSync(
    userId: string,
    accountId: string,
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
    await this.scheduledTransactionsService.update(
      userId,
      plan.scheduledTransactionId,
      plan.payload,
    );
    return plan.preview;
  }

  /**
   * Recompute the linked scheduled payment's principal/interest split from the
   * account's dated ledger debt and current rate, preserving any separate
   * extra-principal split (memo contains "extra"). Returns the update to apply
   * plus a before/after preview, or null when the account has no applicable
   * linked scheduled bill payment. Does not apply anything.
   */
  async buildScheduledUpdate(
    userId: string,
    account: Account,
    override?: ResolvedTimeline,
  ): Promise<ScheduledUpdatePlan | null> {
    if (account.isClosed || !account.scheduledTransactionId) return null;
    // A LINEAR or INTEREST_ONLY mortgage has no payment to carry: the method
    // states the installment from the debt and the rate (spec section 5.3).
    const derivedType = derivedInstallmentType(account);
    // The current rate/payment come from the resolved timeline when supplied,
    // else the account's own (user-owned) scalars. The timeline never mutates
    // the account, so this override is how a rate change reaches the bill.
    const annualRate = override?.annualRate ?? account.interestRate;
    const effectivePayment =
      override?.paymentAmount ?? account.paymentAmount ?? null;
    if (
      (derivedType === null && (annualRate == null || !effectivePayment)) ||
      !account.paymentFrequency
    ) {
      return null;
    }

    let scheduled: Awaited<ReturnType<ScheduledTransactionsService["findOne"]>>;
    try {
      scheduled = await this.scheduledTransactionsService.findOne(
        userId,
        account.scheduledTransactionId,
      );
    } catch (error) {
      this.logger.warn(
        `Could not load scheduled transaction: ${error.message}`,
      );
      return null;
    }

    // The debt the rewritten template first applies to, from the ledger
    // through that date (spec decision 5), the as-of read its next posting is
    // priced from (`resolveInstallment`): the template's next due date, or the
    // rate's effective date when that is later. `current_balance` stops at
    // today, so it missed a payment already posted for a date before the
    // installment this split describes. The timeline override only carries a
    // rate effective today or earlier (`resolveCurrentTimeline`), so the
    // effective date wins only over an overdue template; a future-dated
    // change is priced by `recalculatePaymentForRate`, not here -- except for
    // a LINEAR or INTEREST_ONLY mortgage, whose template is priced at the rate
    // dated to its own due date below.
    const pricingDate = laterYmd(
      override?.effectiveDate,
      toYmd(scheduled.nextDueDate) ?? todayYMD(),
    );
    const { balance, datedRate } = await withScopedDb(
      this.dataSource,
      async (m) => ({
        balance: await datedLoanDebt(m, account, pricingDate),
        // A derived installment is priced at the rate in force on the date it
        // is due (INV-LOAN-006), so a change recorded for a future date that
        // reaches this installment moves its interest, and only that.
        datedRate:
          derivedType === null
            ? null
            : effectiveAnnualRateOn(
                await m.find(LoanRateChange, {
                  where: { accountId: account.id },
                  order: { effectiveDate: "ASC" },
                }),
                pricingDate,
                account.interestRate == null
                  ? null
                  : Number(account.interestRate),
              ),
      }),
    );
    // No rate in the timeline or on the account is unknown, never 0%.
    if (derivedType !== null && datedRate === null) return null;
    if (balance === null) {
      this.logger.warn(
        `Could not read the ledger balance of loan account ${account.id}`,
      );
      return null;
    }
    if (balance <= 0.01) return null;

    const isMortgage = account.accountType === AccountType.MORTGAGE;
    // One lookup for both spellings of the stored cadence; only the COMPOUNDING
    // is mortgage-specific. Two casts into two domain functions meant a
    // semi-monthly mortgage was split at a monthly rate and a quarterly one at
    // three times its rate.
    const periodsPerYear =
      periodsPerYearForStoredFrequency(account.paymentFrequency) ??
      DEFAULT_PERIODS_PER_YEAR;
    const rateForSplit =
      derivedType === null ? Number(annualRate) : Number(datedRate);
    const periodicRate = isMortgage
      ? getPeriodicRate(rateForSplit, periodsPerYear, mortgageTypeOf(account))
      : rateForSplit / 100 / periodsPerYear;

    const splits = scheduled.splits || [];
    const extraSplit = splits.find(
      (s) =>
        s.transferAccountId === account.id &&
        s.memo?.toLowerCase().includes("extra"),
    );
    const extraAmount = extraSplit ? Math.abs(Number(extraSplit.amount)) : 0;

    let interest: number;
    let principal: number;
    let proposedPaymentAmount: number;
    if (derivedType !== null) {
      // The method's installment on the dated debt: principal from table 4.3
      // (unchanged by the rate), interest at the new rate (spec section 5.3).
      const installment = nonAnnuityInstallment(
        derivedType,
        account,
        pricingDate,
        balance,
        periodicRate,
      );
      if (!installment) {
        this.logger.warn(
          `Could not price the ${derivedType} installment of loan account ${account.id}: a term it needs is missing`,
        );
        return null;
      }
      ({ principal, interest } = installment);
      proposedPaymentAmount = roundMoney(principal + interest + extraAmount);
    } else {
      const paymentAmount = Number(effectivePayment);
      interest = roundMoney(balance * periodicRate);
      if (interest > paymentAmount) interest = paymentAmount;
      principal = roundMoney(paymentAmount - interest);
      if (principal > balance) principal = roundMoney(balance);
      proposedPaymentAmount = roundMoney(paymentAmount + extraAmount);
    }

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
        ...(extraSplit
          ? [
              {
                transferAccountId: account.id,
                amount: -extraAmount,
                memo: extraSplit.memo || "Extra Principal",
              },
            ]
          : []),
      ],
    };

    const principalSplit = splits.find(
      (s) =>
        s.transferAccountId === account.id &&
        !s.memo?.toLowerCase().includes("extra"),
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
      extraPrincipal: extraAmount,
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
   * (the pre-history mortgage-rate endpoint's behaviour, now opt-in), priced
   * from the debt the new rate first applies to: the ledger through the
   * effective date (spec decision 5), so a payment already posted for a date
   * before a future-dated change is not still owed by it.
   */
  private async recalculatePaymentForRate(
    m: EntityManager,
    account: Account,
    annualRate: number,
    effectiveDate: string,
  ): Promise<number | null> {
    // A LINEAR or INTEREST_ONLY mortgage records no payment on a rate change:
    // the method prices every installment, and the template follows through
    // the confirmed sync (spec section 5.3).
    if (derivedInstallmentType(account) !== null) return null;
    return datedAnnuityInstallment(m, account, annualRate, effectiveDate);
  }
}
