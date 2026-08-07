import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Inject,
  forwardRef,
} from "@nestjs/common";
import { DataSource, EntityManager, In } from "typeorm";
import { Transaction } from "./entities/transaction.entity";
import { TransactionSplit } from "./entities/transaction-split.entity";
import { SplitKind } from "./entities/split-kind.enum";
import { Category } from "../categories/entities/category.entity";
import { CreateTransactionSplitDto } from "./dto/create-transaction-split.dto";
import { AccountsService } from "../accounts/accounts.service";
import { AccountSubType } from "../accounts/entities/account.entity";
import { isTransactionInFuture } from "../common/date-utils";
import { InvestmentTransactionsService } from "../securities/investment-transactions.service";
import {
  computeInvestmentCashImpact,
  isInvestmentActionAllowedInSplit,
} from "../securities/cash-impact.util";
import { NetWorthService } from "../net-worth/net-worth.service";
import { roundMoney, sumMoney } from "../common/round.util";
import { validateSplitAmountSum } from "../common/split-amount.util";
import { tr } from "../i18n/translate";
import { withScopedDb } from "../common/db/scoped-db";
import { lockTransactionRow, lockTransactionRows } from "../common/db/locks";
import { removeLockedTransactionLeg } from "./remove-transaction-leg";

function inferSplitKind(split: CreateTransactionSplitDto): SplitKind {
  if (split.splitKind) return split.splitKind;
  if (split.investment) return SplitKind.INVESTMENT;
  if (split.transferAccountId) return SplitKind.TRANSFER;
  return SplitKind.CATEGORY;
}

@Injectable()
export class TransactionSplitService {
  constructor(
    @Inject(forwardRef(() => AccountsService))
    private accountsService: AccountsService,
    @Inject(forwardRef(() => InvestmentTransactionsService))
    private investmentTransactionsService: InvestmentTransactionsService,
    @Inject(forwardRef(() => NetWorthService))
    private netWorthService: NetWorthService,
    private dataSource: DataSource,
  ) {}

  private async validateCategoryOwnership(
    userId: string,
    categoryId: string,
  ): Promise<void> {
    const category = await withScopedDb(this.dataSource, (m) =>
      m.getRepository(Category).findOne({
        where: { id: categoryId, userId },
      }),
    );
    if (!category) {
      throw new NotFoundException(
        tr("errors.transactions.categoryNotFound", "Category not found"),
      );
    }
  }

  validateSplits(
    splits: CreateTransactionSplitDto[],
    transactionAmount: number,
  ): void {
    validateSplitAmountSum(splits, transactionAmount, {
      allowSinglePassthrough: true,
      isPassthrough: (s) => {
        const split = s as CreateTransactionSplitDto;
        return Boolean(split.transferAccountId || split.investment);
      },
    });

    for (const split of splits) {
      const kind = inferSplitKind(split);
      if (kind !== SplitKind.INVESTMENT) continue;

      const inv = split.investment;
      if (!inv) {
        throw new BadRequestException(
          tr(
            "errors.transactions.investmentSplitRequiresPayload",
            "Investment split requires an investment payload",
          ),
        );
      }
      if (!isInvestmentActionAllowedInSplit(inv.action)) {
        throw new BadRequestException(
          tr(
            "errors.transactions.investmentActionNotAllowedInSplit",
            `Investment action ${inv.action} is not allowed inside a split transaction`,
            { action: inv.action },
          ),
        );
      }
      if (split.categoryId || split.transferAccountId) {
        throw new BadRequestException(
          tr(
            "errors.transactions.investmentSplitCannotSetCategoryOrTransfer",
            "Investment splits cannot also set categoryId or transferAccountId",
          ),
        );
      }

      const cashImpactInSecurity = computeInvestmentCashImpact(
        inv.action,
        Number(inv.quantity ?? 0),
        Number(inv.price ?? 0),
        Number(inv.commission ?? 0),
      );
      const exchangeRate =
        inv.exchangeRate !== undefined && inv.exchangeRate !== null
          ? Number(inv.exchangeRate)
          : 1;
      const expectedAmount = cashImpactInSecurity * exchangeRate;

      const expectedRounded = roundMoney(expectedAmount);
      const actualRounded = roundMoney(Number(split.amount));

      if (expectedRounded !== actualRounded) {
        throw new BadRequestException(
          tr(
            "errors.transactions.investmentSplitAmountMismatch",
            `Investment split amount (${split.amount}) does not match the cash impact ` +
              `of ${inv.action} ${inv.quantity ?? 0} @ ${inv.price ?? 0} ` +
              `(expected ${expectedAmount.toFixed(4)})`,
            {
              amount: split.amount,
              action: inv.action,
              quantity: inv.quantity ?? 0,
              price: inv.price ?? 0,
              expected: expectedAmount.toFixed(4),
            },
          ),
        );
      }
    }
  }

  /**
   * Create the split rows (and their transfer counterparts / embedded
   * investment rows). Runs in its own transaction when called standalone;
   * called from inside a caller's `withScopedDb` (transaction create/update,
   * updateSplits) it joins that transaction via re-entrancy.
   */
  async createSplits(
    transactionId: string,
    splits: CreateTransactionSplitDto[],
    userId?: string,
    sourceAccountId?: string,
    transactionDate?: Date,
    parentPayeeName?: string | null,
    parentPayeeId?: string | null,
  ): Promise<TransactionSplit[]> {
    return withScopedDb(this.dataSource, (m) =>
      this.createSplitsInternal(
        m,
        transactionId,
        splits,
        userId,
        sourceAccountId,
        transactionDate,
        parentPayeeName,
        parentPayeeId,
      ),
    );
  }

  private async createSplitsInternal(
    m: EntityManager,
    transactionId: string,
    splits: CreateTransactionSplitDto[],
    userId?: string,
    sourceAccountId?: string,
    transactionDate?: Date,
    parentPayeeName?: string | null,
    parentPayeeId?: string | null,
  ): Promise<TransactionSplit[]> {
    if (userId) {
      const categoryIds = [
        ...new Set(
          splits.map((s) => s.categoryId).filter((id): id is string => !!id),
        ),
      ];
      if (categoryIds.length > 0) {
        const found = await m.find(Category, {
          where: { id: In(categoryIds), userId },
          select: ["id"],
        });
        const foundIds = new Set(found.map((c) => c.id));
        const invalid = categoryIds.filter((id) => !foundIds.has(id));
        if (invalid.length > 0) {
          throw new NotFoundException(
            tr(
              "errors.transactions.categoriesNotFound",
              `Categories not found: ${invalid.join(", ")}`,
              { ids: invalid.join(", ") },
            ),
          );
        }
      }
    }

    const hasInvestment = splits.some(
      (s) => inferSplitKind(s) === SplitKind.INVESTMENT,
    );
    let brokerageAccountId: string | null = null;
    let parentDateStr = "";

    if (hasInvestment) {
      if (!userId || !sourceAccountId) {
        throw new BadRequestException(
          tr(
            "errors.transactions.investmentSplitRequiresSourceAccount",
            "Investment splits require a known source account",
          ),
        );
      }
      const sourceAccount = await this.accountsService.findOne(
        userId,
        sourceAccountId,
      );
      if (sourceAccount.accountSubType !== AccountSubType.INVESTMENT_CASH) {
        throw new BadRequestException(
          tr(
            "errors.transactions.investmentSplitRequiresInvestmentCashAccount",
            "Investment splits require the parent transaction to be on an INVESTMENT_CASH account",
          ),
        );
      }
      if (!sourceAccount.linkedAccountId) {
        throw new BadRequestException(
          tr(
            "errors.transactions.investmentCashAccountNotLinked",
            "Source INVESTMENT_CASH account is not linked to a brokerage account",
          ),
        );
      }
      brokerageAccountId = sourceAccount.linkedAccountId;
      parentDateStr = transactionDate
        ? transactionDate.toISOString().substring(0, 10)
        : "";
    }

    // Saved rows are placed back at their original input position so callers
    // that pair splits[i] with the result (e.g. split-level tag assignment) stay
    // aligned regardless of the batched/looped save ordering below.
    const savedSplits: TransactionSplit[] = new Array(splits.length);

    // Plain category splits (and transfers without userId/sourceAccountId
    // context, e.g. import flows) are batch-saved together. Each bucket keeps
    // the split's original index.
    const regularSplits: { split: CreateTransactionSplitDto; index: number }[] =
      [];
    const transferSplits: {
      split: CreateTransactionSplitDto;
      index: number;
    }[] = [];
    const investmentSplits: {
      split: CreateTransactionSplitDto;
      index: number;
    }[] = [];
    splits.forEach((split, index) => {
      const k = inferSplitKind(split);
      if (k === SplitKind.INVESTMENT) {
        investmentSplits.push({ split, index });
      } else if (
        k === SplitKind.TRANSFER &&
        split.transferAccountId &&
        userId &&
        sourceAccountId
      ) {
        transferSplits.push({ split, index });
      } else {
        regularSplits.push({ split, index });
      }
    });

    if (regularSplits.length > 0) {
      const regularEntities = regularSplits.map(({ split }) => {
        const kind = split.transferAccountId
          ? SplitKind.TRANSFER
          : SplitKind.CATEGORY;
        return m.create(TransactionSplit, {
          transactionId,
          kind,
          categoryId: split.categoryId || null,
          transferAccountId: split.transferAccountId || null,
          amount: split.amount,
          memo: split.memo || null,
        });
      });
      const batchSaved = await m.save(regularEntities);
      batchSaved.forEach((saved, j) => {
        savedSplits[regularSplits[j].index] = saved;
      });
    }

    for (const { split, index } of transferSplits) {
      const splitEntity = m.create(TransactionSplit, {
        transactionId,
        kind: SplitKind.TRANSFER,
        categoryId: null,
        transferAccountId: split.transferAccountId,
        amount: split.amount,
        memo: split.memo || null,
      });

      const savedSplit = await m.save(splitEntity);

      const targetAccount = await this.accountsService.findOne(
        userId!,
        split.transferAccountId!,
      );
      const sourceAccount = await this.accountsService.findOne(
        userId!,
        sourceAccountId!,
      );

      // Persist the transfer counterpart's date as a plain yyyy-MM-dd string,
      // not the Date object. The Date arrives as UTC midnight
      // (new Date("2024-01-05")), so saving it directly lets node-postgres
      // serialize it in the server's local time and Postgres truncates it to
      // the previous calendar day west of UTC -- shifting every split transfer
      // (e.g. loan payments) a day earlier than its parent. The ISO date part
      // recovers the intended day and matches the parent transaction.
      const dateStr = transactionDate
        ? transactionDate.toISOString().substring(0, 10)
        : "";

      const linkedTransaction = m.create(Transaction, {
        userId,
        accountId: split.transferAccountId,
        transactionDate: (dateStr || null) as any,
        amount: -split.amount,
        currencyCode: targetAccount.currencyCode,
        exchangeRate: 1,
        description: split.memo || null,
        isTransfer: true,
        payeeId: parentPayeeId || null,
        payeeName: parentPayeeName || `Transfer from ${sourceAccount.name}`,
      });

      const savedLinkedTransaction = await m.save(linkedTransaction);

      await m.update(TransactionSplit, savedSplit.id, {
        linkedTransactionId: savedLinkedTransaction.id,
      });

      await m.update(Transaction, savedLinkedTransaction.id, {
        linkedTransactionId: transactionId,
      });

      if (dateStr && isTransactionInFuture(dateStr)) {
        // The transfer counterpart is created under `userId` above, so its
        // account is the caller's -- scope the balance-write lock to that owner.
        await this.accountsService.recalculateCurrentBalance(
          userId!,
          split.transferAccountId!,
        );
      } else {
        await this.accountsService.updateBalance(
          split.transferAccountId!,
          -split.amount,
        );
      }

      savedSplit.linkedTransactionId = savedLinkedTransaction.id;
      savedSplits[index] = savedSplit;
    }

    for (const { split, index } of investmentSplits) {
      const splitEntity = m.create(TransactionSplit, {
        transactionId,
        kind: SplitKind.INVESTMENT,
        categoryId: null,
        transferAccountId: null,
        amount: split.amount,
        memo: split.memo || null,
      });
      const savedSplit = await m.save(splitEntity);

      await this.investmentTransactionsService.createEmbeddedForSplit(
        m,
        userId!,
        parentDateStr,
        savedSplit.id,
        brokerageAccountId!,
        sourceAccountId!,
        split.investment!,
      );

      savedSplits[index] = savedSplit;
    }

    if (hasInvestment && userId && brokerageAccountId) {
      this.netWorthService.triggerDebouncedRecalc(brokerageAccountId, userId);
    }

    return savedSplits;
  }

  /**
   * Reverse a split transaction's side effects (embedded investment holdings,
   * transfer counterpart rows and their balance impact) ahead of deleting or
   * rebuilding its splits. Joins the caller's ambient transaction; every call
   * site runs inside one (transaction update/remove, updateSplits).
   */
  async deleteSplitSideEffects(
    transactionId: string,
    userId: string,
  ): Promise<void> {
    return withScopedDb(this.dataSource, async (m) => {
      const splits = await m.getRepository(TransactionSplit).find({
        where: { transactionId },
        relations: ["linkedTransaction", "investmentTransaction"],
      });

      // Reverse investment splits' holdings effects before the split rows are
      // deleted.
      for (const s of splits) {
        if (s.kind === SplitKind.INVESTMENT && s.investmentTransaction) {
          await this.investmentTransactionsService.reverseAndRemoveEmbedded(
            m,
            userId,
            s.investmentTransaction,
          );
        }
      }

      const linkedTxIds = splits
        .filter((s) => s.linkedTransactionId && s.transferAccountId)
        .map((s) => s.linkedTransactionId!);

      if (linkedTxIds.length === 0) return;

      // Locked, re-read and conditionally deleted, exactly like the single-leg
      // path. An unlocked `find` followed by `remove(entity)` reversed whatever
      // amount the snapshot happened to hold and reversed it whether or not this
      // call was the one that removed the row -- a split replacement racing a
      // counterpart edit, or racing another replacement, each moved the target
      // account's balance once for one deleted row (audit FV4-002).
      const linked = await lockTransactionRows(m, linkedTxIds, userId);
      for (const leg of linked.values()) {
        await removeLockedTransactionLeg(m, leg, userId, this.accountsService);
      }
    });
  }

  /**
   * Find the split that owns a given transfer counterpart (the leg living in the
   * target account), or null if the transaction is not a split-transfer leg.
   * Used to mirror edits made on the counterpart back onto its split.
   */
  async getTransferSplitByLinkedTransaction(
    linkedTransactionId: string,
  ): Promise<TransactionSplit | null> {
    return withScopedDb(this.dataSource, (m) =>
      m.getRepository(TransactionSplit).findOne({
        where: { linkedTransactionId },
      }),
    );
  }

  async getSplits(transactionId: string): Promise<TransactionSplit[]> {
    return withScopedDb(this.dataSource, (m) =>
      m.getRepository(TransactionSplit).find({
        where: { transactionId },
        relations: ["category", "transferAccount", "investmentTransaction"],
        order: { createdAt: "ASC" },
      }),
    );
  }

  async updateSplits(
    transaction: Transaction,
    splits: CreateTransactionSplitDto[],
    userId: string,
  ): Promise<TransactionSplit[]> {
    return withScopedDb(this.dataSource, async (m) => {
      // Same parent lock as addSplit, so full replacement and incremental
      // addition serialize against each other, and validated against the
      // parent's committed amount rather than the caller's snapshot of it.
      const parent = await lockTransactionRow(m, transaction.id, userId);
      if (!parent) {
        throw new NotFoundException(
          tr(
            "errors.transactions.notFoundById",
            `Transaction with ID ${transaction.id} not found`,
            { id: transaction.id },
          ),
        );
      }
      this.validateSplits(splits, parent.amount);

      await this.deleteSplitSideEffects(transaction.id, userId);

      await m.delete(TransactionSplit, {
        transactionId: transaction.id,
      });

      // Every field the new splits are built from comes off the locked parent,
      // not off the caller's copy of it. The counterpart rows and embedded
      // investment rows *describe* the parent -- its account, its date, its payee
      // -- so a concurrent parent edit that committed after the caller read it
      // would otherwise be written into rows claiming the old values, with no
      // error and nothing to reconcile against (audit FV4-002).
      const newSplits = await this.createSplits(
        parent.id,
        splits,
        userId,
        parent.accountId,
        new Date(parent.transactionDate),
        parent.payeeName,
        parent.payeeId,
      );

      await m.update(Transaction, transaction.id, {
        isSplit: true,
        categoryId: null,
      });

      return newSplits;
    });
  }

  async addSplit(
    transaction: Transaction,
    splitDto: CreateTransactionSplitDto,
    userId: string,
  ): Promise<TransactionSplit> {
    if (splitDto.investment) {
      throw new BadRequestException(
        tr(
          "errors.transactions.investmentSplitNoIncremental",
          "Investment splits cannot be added incrementally; replace the full split set instead.",
        ),
      );
    }
    if (splitDto.categoryId) {
      await this.validateCategoryOwnership(userId, splitDto.categoryId);
    }

    const savedSplitId = await withScopedDb(this.dataSource, async (m) => {
      // The aggregate check and the insert are one serialized unit.
      //
      // Reading the split set, validating in application code, and inserting in
      // a later transaction is a check-then-act with nothing under it: the schema
      // has no aggregate constraint, and two inserts against the same parent hold
      // compatible foreign-key key-share locks, so both commit. Parent -100.00
      // with -60.00 already split, two concurrent -30.00 additions each
      // validating -90.00, and the splits total -120.00 (audit P4-009).
      //
      // The parent row lock is what serializes them. Every other writer of this
      // split set -- full replacement included -- takes the same lock, so the
      // second request re-reads the set the first one committed and refuses.
      const parent = await lockTransactionRow(m, transaction.id, userId);
      if (!parent) {
        throw new NotFoundException(
          tr(
            "errors.transactions.notFoundById",
            `Transaction with ID ${transaction.id} not found`,
            { id: transaction.id },
          ),
        );
      }

      const existingSplits = await m.getRepository(TransactionSplit).find({
        where: { transactionId: transaction.id },
      });
      const existingTotal = sumMoney(
        existingSplits.map((s) => Number(s.amount)),
      );
      const newTotal = sumMoney([existingTotal, Number(splitDto.amount)]);
      const transactionAmount = roundMoney(parent.amount);

      if (Math.abs(newTotal) > Math.abs(transactionAmount)) {
        throw new BadRequestException(
          tr(
            "errors.transactions.splitExceedsTransactionAmount",
            `Adding this split would exceed the transaction amount. ` +
              `Current total: ${existingTotal}, New split: ${splitDto.amount}, ` +
              `Transaction amount: ${transactionAmount}`,
            {
              existingTotal,
              newSplit: splitDto.amount,
              transactionAmount,
            },
          ),
        );
      }

      const splitKind = splitDto.transferAccountId
        ? SplitKind.TRANSFER
        : SplitKind.CATEGORY;
      const split = m.create(TransactionSplit, {
        transactionId: transaction.id,
        kind: splitKind,
        categoryId: splitDto.categoryId || null,
        transferAccountId: splitDto.transferAccountId || null,
        amount: splitDto.amount,
        memo: splitDto.memo || null,
      });

      const savedSplit = await m.save(split);

      if (splitDto.transferAccountId) {
        const targetAccount = await this.accountsService.findOne(
          userId,
          splitDto.transferAccountId,
        );
        // Built from the locked parent, not the caller's snapshot: see the note
        // in `updateSplits` (audit FV4-002).
        const sourceAccount = await this.accountsService.findOne(
          userId,
          parent.accountId,
        );

        const linkedTransaction = m.create(Transaction, {
          userId,
          accountId: splitDto.transferAccountId,
          transactionDate: parent.transactionDate,
          amount: -splitDto.amount,
          currencyCode: targetAccount.currencyCode,
          exchangeRate: 1,
          description: splitDto.memo || null,
          isTransfer: true,
          payeeId: parent.payeeId || null,
          payeeName: parent.payeeName || `Transfer from ${sourceAccount.name}`,
        });

        const savedLinkedTransaction = await m.save(linkedTransaction);

        await m.update(TransactionSplit, savedSplit.id, {
          linkedTransactionId: savedLinkedTransaction.id,
        });

        if (isTransactionInFuture(parent.transactionDate)) {
          await this.accountsService.recalculateCurrentBalance(
            userId,
            splitDto.transferAccountId,
          );
        } else {
          await this.accountsService.updateBalance(
            splitDto.transferAccountId,
            -splitDto.amount,
          );
        }
      }

      const totalSplits = existingSplits.length + 1;
      if (totalSplits >= 2 && !parent.isSplit) {
        await m.update(Transaction, transaction.id, {
          isSplit: true,
          categoryId: null,
        });
      }

      return savedSplit.id;
    });

    const splitWithRelations = await withScopedDb(this.dataSource, (m) =>
      m.getRepository(TransactionSplit).findOne({
        where: { id: savedSplitId },
        relations: ["category", "transferAccount"],
      }),
    );

    if (!splitWithRelations) {
      throw new NotFoundException(
        tr(
          "errors.transactions.splitNotFoundById",
          `Split with ID ${savedSplitId} not found`,
          { id: savedSplitId },
        ),
      );
    }

    return splitWithRelations;
  }

  /**
   * Delete a split's transfer counterpart and reverse its balance, once.
   *
   * The leg is locked and re-read here rather than taken from the split's
   * snapshot: the amount reversed has to be the amount the delete removes, and
   * the reversal only happens when this call is the one that removed the row.
   * Both split-removal paths below go through this, so the collapse case cannot
   * drift from the ordinary one.
   */
  private async removeLinkedLeg(
    m: EntityManager,
    linkedTransactionId: string,
    userId: string,
  ): Promise<void> {
    const linked = await lockTransactionRow(m, linkedTransactionId, userId);
    if (!linked) return;
    await removeLockedTransactionLeg(m, linked, userId, this.accountsService);
  }

  async removeSplit(
    transaction: Transaction,
    splitId: string,
    userId: string,
  ): Promise<void> {
    return withScopedDb(this.dataSource, async (m) => {
      // The parent first, so a concurrent split mutation on the same parent
      // serializes behind this one, and so the split below is read from a state
      // that cannot change under us. The old code read the split in its own
      // autocommit transaction before opening this one, then reversed a balance
      // from that snapshot -- two concurrent removals of the same transfer split
      // each applied the reversal while only one row went away (audit FV4-002).
      const lockedParent = await lockTransactionRow(m, transaction.id, userId);
      if (!lockedParent) {
        throw new NotFoundException(
          tr(
            "errors.transactions.notFoundById",
            `Transaction with ID ${transaction.id} not found`,
            { id: transaction.id },
          ),
        );
      }

      const split = await m.getRepository(TransactionSplit).findOne({
        where: { id: splitId, transactionId: transaction.id },
        relations: ["investmentTransaction"],
      });

      if (!split) {
        // Either it never existed or another request removed it while this one
        // waited for the parent lock. Both are "not found", and neither has left
        // a balance for this call to reverse.
        throw new NotFoundException(
          tr(
            "errors.transactions.splitNotFoundById",
            `Split with ID ${splitId} not found`,
            { id: splitId },
          ),
        );
      }

      if (split.kind === SplitKind.INVESTMENT && split.investmentTransaction) {
        await this.investmentTransactionsService.reverseAndRemoveEmbedded(
          m,
          userId,
          split.investmentTransaction,
        );
      } else if (split.linkedTransactionId && split.transferAccountId) {
        await this.removeLinkedLeg(m, split.linkedTransactionId, userId);
      }

      await m.remove(split);

      const remainingSplits = await m.find(TransactionSplit, {
        where: { transactionId: transaction.id },
        relations: ["category", "transferAccount", "investmentTransaction"],
        order: { createdAt: "ASC" },
      });

      if (remainingSplits.length < 2) {
        if (remainingSplits.length === 1) {
          const lastSplit = remainingSplits[0];

          // Don't auto-collapse if the last remaining split is investment-kind
          // — that representation only makes sense as part of a split parent.
          if (lastSplit.kind === SplitKind.INVESTMENT) {
            return;
          }

          if (lastSplit.linkedTransactionId && lastSplit.transferAccountId) {
            await this.removeLinkedLeg(
              m,
              lastSplit.linkedTransactionId,
              userId,
            );
          }

          await m.update(Transaction, transaction.id, {
            isSplit: false,
            categoryId: lastSplit.categoryId,
          });
          await m.remove(lastSplit);
        } else {
          await m.update(Transaction, transaction.id, {
            isSplit: false,
          });
        }
      }
    });
  }
}
