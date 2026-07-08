import {
  Injectable,
  Inject,
  forwardRef,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, EntityManager, Repository } from "typeorm";
import { tr } from "../i18n/translate";
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
import { roundMoney } from "../common/round.util";
import { todayYMD, formatDateYMDLocal } from "../common/date-utils";

const RATE_CHANGE_ACCOUNT_TYPES = [AccountType.LOAN, AccountType.MORTGAGE];

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

@Injectable()
export class LoanRateChangesService {
  private readonly logger = new Logger(LoanRateChangesService.name);

  constructor(
    @InjectRepository(LoanRateChange)
    private rateChangesRepository: Repository<LoanRateChange>,
    @InjectRepository(Account)
    private accountsRepository: Repository<Account>,
    private dataSource: DataSource,
    @Inject(forwardRef(() => ScheduledTransactionsService))
    private scheduledTransactionsService: ScheduledTransactionsService,
  ) {}

  async findAll(userId: string, accountId: string): Promise<LoanRateChange[]> {
    await this.verifyLoanAccount(userId, accountId);
    return this.rateChangesRepository.find({
      where: { userId, accountId },
      order: { effectiveDate: "ASC" },
    });
  }

  async create(
    userId: string,
    accountId: string,
    dto: CreateLoanRateChangeDto,
  ): Promise<LoanRateChange> {
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

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    let saved: LoanRateChange;
    let applied = false;
    try {
      await this.rejectDuplicateDate(
        queryRunner.manager,
        accountId,
        dto.effectiveDate,
      );
      await this.insertInitialRowIfFirst(
        queryRunner.manager,
        account,
        dto.effectiveDate,
      );

      const rateChange = queryRunner.manager.create(LoanRateChange, {
        userId,
        accountId,
        effectiveDate: dto.effectiveDate,
        annualRate: dto.annualRate,
        newPaymentAmount,
        source: "manual" as const,
        note: dto.note ?? null,
      });
      saved = await queryRunner.manager.save(rateChange);

      applied = await this.syncAccountToTimeline(queryRunner.manager, account);

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }

    if (applied) {
      await this.syncScheduledTransaction(userId, account);
    }
    return saved;
  }

  async update(
    userId: string,
    accountId: string,
    id: string,
    dto: UpdateLoanRateChangeDto,
  ): Promise<LoanRateChange> {
    const account = await this.verifyLoanAccount(userId, accountId);
    const rateChange = await this.findOne(userId, accountId, id);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    let saved: LoanRateChange;
    let applied = false;
    try {
      if (
        dto.effectiveDate !== undefined &&
        dto.effectiveDate !== rateChange.effectiveDate
      ) {
        await this.rejectDuplicateDate(
          queryRunner.manager,
          accountId,
          dto.effectiveDate,
        );
      }

      const merged = queryRunner.manager.merge(LoanRateChange, rateChange, {
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
      saved = await queryRunner.manager.save(merged);

      applied = await this.syncAccountToTimeline(queryRunner.manager, account);

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }

    if (applied) {
      await this.syncScheduledTransaction(userId, account);
    }
    return saved;
  }

  async remove(userId: string, accountId: string, id: string): Promise<void> {
    const account = await this.verifyLoanAccount(userId, accountId);
    const rateChange = await this.findOne(userId, accountId, id);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    let applied = false;
    try {
      await queryRunner.manager.remove(rateChange);
      applied = await this.syncAccountToTimeline(queryRunner.manager, account);
      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }

    if (applied) {
      await this.syncScheduledTransaction(userId, account);
    }
  }

  /**
   * Keep the account's denormalized scalars in line with the timeline: the
   * rate in effect today is the latest row not in the future; the payment in
   * effect is the latest non-null newPaymentAmount at or before today. Rows
   * dated in the future are recorded but not applied. Closed accounts keep
   * their final scalars untouched. Returns whether scalars were applied, so
   * callers know whether the scheduled payment needs a resync.
   */
  async syncAccountToTimeline(
    manager: EntityManager,
    account: Account,
  ): Promise<boolean> {
    if (account.isClosed) return false;

    const rows = await manager.find(LoanRateChange, {
      where: { accountId: account.id },
      order: { effectiveDate: "ASC" },
    });
    const today = todayYMD();
    const applicable = rows.filter((row) => row.effectiveDate <= today);
    if (applicable.length === 0) return false;

    const latest = applicable[applicable.length - 1];
    const latestWithPayment = [...applicable]
      .reverse()
      .find((row) => row.newPaymentAmount != null);

    account.interestRate = Number(latest.annualRate);
    if (latestWithPayment?.newPaymentAmount != null) {
      account.paymentAmount = Number(latestWithPayment.newPaymentAmount);
    }
    await manager.save(account);
    return true;
  }

  /**
   * Resync the linked scheduled payment to the account's current rate and
   * payment: recompute the principal/interest split from the current balance,
   * preserving any separate extra-principal split (memo contains "extra").
   * Best-effort, mirroring the tolerance of the mortgage-rate update flow --
   * the rate history itself is already committed.
   */
  async syncScheduledTransaction(
    userId: string,
    account: Account,
  ): Promise<void> {
    if (account.isClosed || !account.scheduledTransactionId) return;
    if (
      account.interestRate == null ||
      !account.paymentAmount ||
      !account.paymentFrequency
    ) {
      return;
    }
    const balance = Math.abs(Number(account.currentBalance));
    if (balance <= 0.01) return;

    try {
      const scheduled = await this.scheduledTransactionsService.findOne(
        userId,
        account.scheduledTransactionId,
      );

      const isMortgage = account.accountType === AccountType.MORTGAGE;
      const periodicRate = isMortgage
        ? getPeriodicRate(
            account.interestRate,
            getMortgagePeriodsPerYear(
              account.paymentFrequency as MortgagePaymentFrequency,
            ),
            account.isCanadianMortgage || false,
            account.isVariableRate || false,
          )
        : account.interestRate /
          100 /
          getPeriodsPerYear(account.paymentFrequency as PaymentFrequency);

      const paymentAmount = Number(account.paymentAmount);
      let interest = roundMoney(balance * periodicRate);
      if (interest > paymentAmount) interest = paymentAmount;
      let principal = roundMoney(paymentAmount - interest);
      if (principal > balance) principal = roundMoney(balance);

      const splits = scheduled.splits || [];
      const extraSplit = splits.find(
        (s) =>
          s.transferAccountId === account.id &&
          s.memo?.toLowerCase().includes("extra"),
      );
      const extraAmount = extraSplit ? Math.abs(Number(extraSplit.amount)) : 0;

      await this.scheduledTransactionsService.update(
        userId,
        account.scheduledTransactionId,
        {
          amount: -roundMoney(paymentAmount + extraAmount),
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
        },
      );
    } catch (error) {
      this.logger.warn(
        `Could not update scheduled transaction: ${error.message}`,
      );
    }
  }

  /**
   * Snapshot the origination rate as an 'initial' row the first time any
   * change is recorded, so the pre-change rate survives the scalar overwrite.
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
    const account = await this.accountsRepository.findOne({
      where: { id: accountId, userId },
    });
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
    const rateChange = await this.rateChangesRepository.findOne({
      where: { id, userId, accountId },
    });
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
   */
  private recalculatePaymentForRate(
    account: Account,
    annualRate: number,
    effectiveDate: string,
  ): number {
    const currentBalance = Math.abs(Number(account.currentBalance));
    const startDate = toYmd(account.paymentStartDate) ?? todayYMD();
    const monthsElapsed = monthsBetweenYmd(startDate, effectiveDate);
    const remainingAmortizationMonths = Math.max(
      12,
      (account.amortizationMonths || 300) - monthsElapsed,
    );

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
