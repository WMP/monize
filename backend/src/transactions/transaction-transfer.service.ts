import {
  Injectable,
  BadRequestException,
  ConflictException,
  Inject,
  NotFoundException,
  forwardRef,
  Logger,
} from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { Transaction, TransactionStatus } from "./entities/transaction.entity";
import { TransactionSplit } from "./entities/transaction-split.entity";
import { Category } from "../categories/entities/category.entity";
import { CreateTransferDto } from "./dto/create-transfer.dto";
import { UpdateTransferDto } from "./dto/update-transfer.dto";
import { AccountsService } from "../accounts/accounts.service";
import { Account } from "../accounts/entities/account.entity";
import { PayeesService } from "../payees/payees.service";
import { NetWorthService } from "../net-worth/net-worth.service";
import { isTransactionInFuture } from "../common/date-utils";
import { ActionHistoryService } from "../action-history/action-history.service";
import { CrossOwnerAccessService } from "../delegation/cross-owner-access.service";
import { formatCurrency } from "../common/format-currency.util";
import { roundMoney } from "../common/round.util";
import { stripHtml } from "../common/sanitization.util";
import { tr } from "../i18n/translate";
import { withScopedDb } from "../common/db/scoped-db";
import { lockTransactionRow, lockTransactionRows } from "../common/db/locks";
import { removeLockedTransactionLeg } from "./remove-transaction-leg";
import { withSystemContext } from "../common/db/with-context";

export interface TransferResult {
  fromTransaction: Transaction;
  toTransaction: Transaction;
}

/**
 * Who is performing a transfer operation. `effectiveUserId` is the ledger the
 * request runs against (the owner's id while a delegate is acting);
 * `realUserId` is the authenticated human, whose delegations decide
 * cross-owner access. Non-HTTP callers (scheduled posting, AI prep) omit it
 * and both ids default to `userId` -- identical to pre-cross-owner behavior.
 */
export interface TransferActor {
  effectiveUserId: string;
  realUserId: string;
}

/**
 * Resolved, sanitized preview of a transfer the assistant proposes to create.
 * Carries the resulting state of both legs (resolved account ids/names, derived
 * currencies, and the computed destination amount) so the signed descriptor can
 * reproduce it on confirm. Shared by the AI Assistant tool executor and the MCP
 * tool via the transaction-tool prep service.
 */
export interface CreateTransferPreview {
  fromAccountId: string;
  fromAccountName: string;
  fromCurrencyCode: string;
  toAccountId: string;
  toAccountName: string;
  toCurrencyCode: string;
  amount: number;
  toAmount: number;
  exchangeRate: number;
  transactionDate: string;
  description: string | null;
  /** Existing payee the custom label resolved to, or null to record free text. */
  payeeId: string | null;
  payeeName: string | null;
  /** True when the custom label matched an existing payee. */
  payeeMatched: boolean;
  /** True when approving will create a new payee from an unmatched label. */
  payeeWillBeCreated: boolean;
  /** Spending category applied to both legs on create (null = none). */
  categoryId: string | null;
  categoryName: string | null;
}

/** Resolved, sanitized preview of an edit the assistant proposes to a transfer. */
export interface UpdateTransferPreview {
  transactionId: string;
  fromAccountId: string;
  fromAccountName: string;
  fromCurrencyCode: string;
  toAccountId: string;
  toAccountName: string;
  toCurrencyCode: string;
  amount: number;
  toAmount: number;
  exchangeRate: number;
  transactionDate: string;
  description: string | null;
  payeeId: string | null;
  payeeName: string | null;
  payeeMatched: boolean;
  payeeWillBeCreated: boolean;
  /** Spending category applied to both legs after the edit (null = none). */
  categoryId: string | null;
  categoryName: string | null;
}

@Injectable()
export class TransactionTransferService {
  private readonly logger = new Logger(TransactionTransferService.name);

  constructor(
    @Inject(forwardRef(() => AccountsService))
    private accountsService: AccountsService,
    private payeesService: PayeesService,
    @Inject(forwardRef(() => NetWorthService))
    private netWorthService: NetWorthService,
    private dataSource: DataSource,
    private actionHistoryService: ActionHistoryService,
    private crossOwnerAccess: CrossOwnerAccessService,
  ) {}

  private triggerNetWorthRecalc(accountId: string, userId: string): void {
    this.netWorthService.triggerDebouncedRecalc(accountId, userId);
  }

  /**
   * Ensure a category belongs to the user before it is stored on a transfer
   * leg. Mirrors the check in transactions.service.create(). A null/undefined
   * id is allowed (no category / clearing it).
   */
  private async assertCategoryOwned(
    userId: string,
    categoryId: string | null | undefined,
  ): Promise<void> {
    if (!categoryId) return;
    const category = await withScopedDb(this.dataSource, (m) =>
      m.getRepository(Category).findOne({
        where: { id: categoryId, userId },
      }),
    );
    if (!category) {
      throw new BadRequestException(
        tr("errors.transactions.categoryNotFound", "Category not found"),
      );
    }
  }

  async createTransfer(
    userId: string,
    createTransferDto: CreateTransferDto,
    findOne: (userId: string, id: string) => Promise<Transaction>,
    actor?: TransferActor,
  ): Promise<TransferResult> {
    const realUserId = actor?.realUserId ?? userId;
    const {
      fromAccountId,
      toAccountId,
      transactionDate,
      amount,
      fromCurrencyCode,
      toCurrencyCode,
      exchangeRate = 1,
      toAmount: explicitToAmount,
      description,
      payeeId,
      payeeName: customPayeeName,
      referenceNumber,
      status = TransactionStatus.UNRECONCILED,
      categoryId,
    } = createTransferDto;

    if (fromAccountId === toAccountId) {
      throw new BadRequestException(
        tr(
          "errors.transactions.transferSameAccount",
          "Source and destination accounts must be different",
        ),
      );
    }

    if (amount < 0) {
      throw new BadRequestException(
        tr(
          "errors.transactions.transferAmountNegative",
          "Transfer amount must not be negative",
        ),
      );
    }

    await this.assertCategoryOwned(userId, categoryId);

    // The authoritative per-leg authorization: the REAL user must own each
    // account or hold an active delegation with the create grant on it. For a
    // normal user this reduces to today's ownership check (foreign -> 404).
    const { account: fromAccount } =
      await this.crossOwnerAccess.accountAccessFor(
        realUserId,
        fromAccountId,
        "create",
      );
    const { account: toAccount } = await this.crossOwnerAccess.accountAccessFor(
      realUserId,
      toAccountId,
      "create",
    );
    const fromOwnerId = fromAccount.userId;
    const toOwnerId = toAccount.userId;
    // A leg not owned by the effective user makes this a cross-owner write:
    // per-leg user_id, gated reference data, and a system-context transaction
    // (the transactions WITH CHECK stays owner-only under RLS). Authorization
    // is fully decided above, before the bypass window opens.
    const hasForeignLeg = fromOwnerId !== userId || toOwnerId !== userId;

    const toAmount =
      explicitToAmount !== undefined
        ? roundMoney(explicitToAmount)
        : roundMoney(amount * exchangeRate);
    const destinationCurrency = toCurrencyCode || fromCurrencyCode;

    const fromPayeeName = customPayeeName || `Transfer to ${toAccount.name}`;
    const toPayeeName = customPayeeName || `Transfer from ${fromAccount.name}`;

    // Both legs, their linkage, and the balance updates commit atomically.
    // Each leg is owned by ITS account's owner; per-user reference data
    // (category, payee link) is only written onto effective-user legs.
    const writeLegsAtomically = async (m: EntityManager) => {
      const fromTransaction = m.create(Transaction, {
        userId: fromOwnerId,
        accountId: fromAccountId,
        transactionDate: transactionDate as any,
        amount: -amount,
        currencyCode: fromCurrencyCode,
        exchangeRate: 1,
        description: description || null,
        referenceNumber,
        status,
        isTransfer: true,
        payeeId: fromOwnerId === userId ? payeeId || null : null,
        payeeName: fromPayeeName,
        categoryId: fromOwnerId === userId ? categoryId || null : null,
      });

      const toTransaction = m.create(Transaction, {
        userId: toOwnerId,
        accountId: toAccountId,
        transactionDate: transactionDate as any,
        amount: toAmount,
        currencyCode: destinationCurrency,
        exchangeRate: exchangeRate,
        description: description || null,
        referenceNumber,
        status,
        isTransfer: true,
        payeeId: toOwnerId === userId ? payeeId || null : null,
        payeeName: toPayeeName,
        categoryId: toOwnerId === userId ? categoryId || null : null,
      });

      const savedFromTransaction = await m.save(fromTransaction);
      const savedToTransaction = await m.save(toTransaction);

      const fromId = savedFromTransaction.id;
      const toId = savedToTransaction.id;

      await m.update(Transaction, fromId, {
        linkedTransactionId: toId,
      });
      await m.update(Transaction, toId, {
        linkedTransactionId: fromId,
      });

      if (isTransactionInFuture(transactionDate)) {
        // Each leg's account is owned by ITS account's owner, which for a
        // cross-owner transfer differs from the acting user -- scope each lock
        // to that owner, never to the caller (maintainer review, PR #1095).
        await this.accountsService.recalculateCurrentBalance(
          fromOwnerId,
          fromAccountId,
        );
        await this.accountsService.recalculateCurrentBalance(
          toOwnerId,
          toAccountId,
        );
      } else {
        await this.accountsService.updateBalance(fromAccountId, -amount);
        await this.accountsService.updateBalance(toAccountId, toAmount);
      }

      return { savedFromId: fromId, savedToId: toId };
    };

    const { savedFromId, savedToId } = hasForeignLeg
      ? // Cross-owner: the foreign leg insert and foreign balance update fail
        // the owner-only policies, so the (already fully authorized) atomic
        // block runs under the audited system bypass. No-op at RLS_MODE=off.
        await withSystemContext(() =>
          withScopedDb(this.dataSource, writeLegsAtomically),
        )
      : await withScopedDb(this.dataSource, writeLegsAtomically);

    this.triggerNetWorthRecalc(fromAccountId, fromOwnerId);
    this.triggerNetWorthRecalc(toAccountId, toOwnerId);

    const result = {
      fromTransaction: await findOne(fromOwnerId, savedFromId),
      toTransaction: await findOne(toOwnerId, savedToId),
    };

    await this.recordCreateTransferHistory({
      effectiveUserId: userId,
      realUserId,
      savedFromId,
      savedToId,
      fromAccount,
      toAccount,
      amount,
      currencyCode: fromCurrencyCode,
    });

    return result;
  }

  /**
   * Action history for a created transfer. Same-owner (both legs the effective
   * user's) keeps producing exactly today's single record. Cross-owner writes
   * one record per leg owner; an account name foreign to that owner is
   * replaced with the "Shared account" label -- an owner must not learn the
   * other party's account name from history. The actor's own entry may name
   * both accounts, since the actor could read both at that moment.
   */
  private async recordCreateTransferHistory(args: {
    effectiveUserId: string;
    realUserId: string;
    savedFromId: string;
    savedToId: string;
    fromAccount: Account;
    toAccount: Account;
    amount: number;
    currencyCode: string;
  }): Promise<void> {
    const {
      effectiveUserId,
      realUserId,
      savedFromId,
      savedToId,
      fromAccount,
      toAccount,
      amount,
      currencyCode,
    } = args;
    const formattedAmount = formatCurrency(amount, currencyCode);
    const afterData = {
      fromTransactionId: savedFromId,
      toTransactionId: savedToId,
      fromAccountId: fromAccount.id,
      toAccountId: toAccount.id,
    };

    if (
      fromAccount.userId === effectiveUserId &&
      toAccount.userId === effectiveUserId
    ) {
      // Same-owner: fire-and-forget, exactly today's behavior.
      void this.actionHistoryService.record(effectiveUserId, {
        entityType: "transfer",
        entityId: savedFromId,
        action: "create",
        afterData,
        description: `Created transfer ${formattedAmount} from ${fromAccount.name} to ${toAccount.name}`,
        descriptionKey: "createdTransfer",
        descriptionParams: {
          amount: formattedAmount,
          from: fromAccount.name,
          to: toAccount.name,
        },
      });
      return;
    }

    const sharedLabel = tr("common.sharedAccountLabel", "Shared account");
    for (const ownerId of new Set([fromAccount.userId, toAccount.userId])) {
      const nameFor = (account: Account) =>
        ownerId === realUserId || account.userId === ownerId
          ? account.name
          : sharedLabel;
      const record = () =>
        this.actionHistoryService.record(ownerId, {
          entityType: "transfer",
          entityId: ownerId === fromAccount.userId ? savedFromId : savedToId,
          action: "create",
          afterData,
          description: `Created transfer ${formattedAmount} from ${nameFor(fromAccount)} to ${nameFor(toAccount)}`,
          descriptionKey: "createdTransfer",
          descriptionParams: {
            amount: formattedAmount,
            from: nameFor(fromAccount),
            to: nameFor(toAccount),
          },
        });
      if (ownerId === effectiveUserId) {
        await record();
      } else {
        // The counterpart owner's history row carries THEIR user_id; writing
        // it from this request's identity needs the audited bypass under RLS.
        await withSystemContext(record);
      }
    }
  }

  async getLinkedTransaction(
    userId: string,
    transactionId: string,
    findOne: (userId: string, id: string) => Promise<Transaction>,
    actor?: TransferActor,
  ): Promise<Transaction | null> {
    const realUserId = actor?.realUserId ?? userId;
    const transaction = await findOne(userId, transactionId);

    if (!transaction.isTransfer || !transaction.linkedTransactionId) {
      return null;
    }

    try {
      return await findOne(userId, transaction.linkedTransactionId);
    } catch (err) {
      if (!(err instanceof NotFoundException)) {
        this.logger.warn(
          `Failed to load linked transaction ${transaction.linkedTransactionId}: ${err instanceof Error ? err.message : err}`,
        );
        return null;
      }
      // Cross-owner counterpart: return it when the real user can read its
      // account; anything unreadable stays null (never confirm existence).
      const counterpart = await this.loadLegById(
        transaction.linkedTransactionId,
      );
      if (!counterpart) return null;
      try {
        await this.crossOwnerAccess.accountAccessFor(
          realUserId,
          counterpart.accountId,
          "read",
        );
        return counterpart;
      } catch {
        return null;
      }
    }
  }

  /**
   * Load a transfer leg by id with NO user filter. Used only after the
   * owner-scoped findOne misses (a cross-owner counterpart); the caller then
   * decides access via accountAccessFor before anything derived from the row
   * reaches a response. Authorization-decision read under the audited bypass.
   */
  private loadLegById(id: string): Promise<Transaction | null> {
    return withSystemContext(() =>
      withScopedDb(this.dataSource, (m) =>
        m.getRepository(Transaction).findOne({
          where: { id },
          relations: ["account"],
        }),
      ),
    );
  }

  /**
   * Route a transfer mutation whose counterpart the effective user cannot see:
   * connected (real user holds `op` on the counterpart account) -> full
   * cross-leg behavior; readable but not granted `op` -> 403; unreadable ->
   * frozen (null), where only presentational own-leg edits are allowed.
   */
  private async resolveCounterpartAccess(
    realUserId: string,
    counterpart: Transaction,
    op: "edit" | "delete",
  ): Promise<"connected" | "frozen"> {
    try {
      await this.crossOwnerAccess.accountAccessFor(
        realUserId,
        counterpart.accountId,
        op,
      );
      return "connected";
    } catch (err) {
      if (err instanceof NotFoundException) return "frozen";
      throw err; // ForbiddenException: readable but the op is not granted
    }
  }

  /**
   * Detect whether a loaded transaction is a transfer leg. Usable by the prep
   * service to route an update/delete to the transfer-aware flow.
   */
  isTransfer(transaction: Transaction): boolean {
    return transaction.isTransfer === true;
  }

  /**
   * Validate and resolve a proposed transfer WITHOUT persisting it. Resolves the
   * from/to accounts (by id), derives their currencies, computes the destination
   * amount from an explicit toAmount or the exchange rate (via roundMoney), and
   * sanitizes the description. Mirrors the resulting state createTransfer writes.
   */
  async previewCreateTransfer(
    userId: string,
    input: {
      fromAccountId: string;
      toAccountId: string;
      amount: number;
      transactionDate: string;
      exchangeRate?: number;
      toAmount?: number;
      description?: string;
      payeeName?: string;
      /** Auto-create a payee for an unmatched custom label. Defaults to true. */
      createPayeeIfMissing?: boolean;
      /** Spending category id applied to both legs (null/undefined = none). */
      categoryId?: string | null;
    },
  ): Promise<CreateTransferPreview> {
    if (input.fromAccountId === input.toAccountId) {
      throw new BadRequestException(
        tr(
          "errors.transactions.transferSameAccount",
          "Source and destination accounts must be different",
        ),
      );
    }
    if (input.amount < 0) {
      throw new BadRequestException(
        tr(
          "errors.transactions.transferAmountNegative",
          "Transfer amount must not be negative",
        ),
      );
    }

    const fromAccount = await this.accountsService.findOne(
      userId,
      input.fromAccountId,
    );
    const toAccount = await this.accountsService.findOne(
      userId,
      input.toAccountId,
    );

    const exchangeRate = input.exchangeRate ?? 1;
    const toAmount =
      input.toAmount !== undefined
        ? roundMoney(input.toAmount)
        : roundMoney(input.amount * exchangeRate);

    // Resolve the custom label to an existing payee exactly like a normal cash
    // transaction (previewCreate): on a match link the payee and adopt its
    // canonical name; an unmatched name becomes a new payee on confirm unless
    // the caller opted out. Transfers have no category, so the matched payee's
    // default category is deliberately NOT inherited (a transfer's optional
    // spending category is set explicitly by the caller).
    const inputPayeeName = stripHtml(input.payeeName) || null;
    let payeeId: string | null = null;
    let payeeName: string | null = inputPayeeName;
    let payeeMatched = false;
    if (inputPayeeName) {
      const payee = await this.payeesService.resolveByName(
        userId,
        inputPayeeName,
      );
      if (payee) {
        payeeId = payee.id;
        payeeMatched = true;
        payeeName = payee.name;
      }
    }
    const payeeWillBeCreated =
      !!payeeName && !payeeMatched && input.createPayeeIfMissing !== false;

    // Resolve an optional spending category to apply to both legs, validating
    // ownership so the confirm step re-applies the same id (mirrors
    // previewUpdateTransfer and the standard create path).
    let categoryId: string | null = null;
    let categoryName: string | null = null;
    if (input.categoryId) {
      const inputCategoryId = input.categoryId;
      const category = await withScopedDb(this.dataSource, (m) =>
        m.getRepository(Category).findOne({
          where: { id: inputCategoryId, userId },
        }),
      );
      if (!category) {
        throw new BadRequestException(
          tr("errors.transactions.categoryNotFound", "Category not found"),
        );
      }
      categoryId = category.id;
      categoryName = category.name;
    }

    return {
      fromAccountId: fromAccount.id,
      fromAccountName: fromAccount.name,
      fromCurrencyCode: fromAccount.currencyCode,
      toAccountId: toAccount.id,
      toAccountName: toAccount.name,
      toCurrencyCode: toAccount.currencyCode,
      amount: roundMoney(input.amount),
      toAmount,
      exchangeRate,
      transactionDate: input.transactionDate,
      description: stripHtml(input.description) || null,
      payeeId,
      payeeName,
      payeeMatched,
      payeeWillBeCreated,
      categoryId,
      categoryName,
    };
  }

  /**
   * Validate and resolve a proposed edit to an existing transfer WITHOUT
   * persisting it. Loads the transaction (requiring it to be a transfer),
   * determines the canonical from/to legs (the from leg has the negative
   * amount, mirroring updateTransfer), and returns the resulting state.
   */
  async previewUpdateTransfer(
    userId: string,
    transactionId: string,
    input: {
      amount?: number;
      transactionDate?: string;
      description?: string;
      payeeName?: string;
      /** Auto-create a payee for an unmatched custom label. Defaults to true. */
      createPayeeIfMissing?: boolean;
      /**
       * Resolved spending category id to apply to both legs. Undefined keeps the
       * existing category; null clears it; a string sets it (ownership checked).
       */
      categoryId?: string | null;
    },
    findOne: (userId: string, id: string) => Promise<Transaction>,
  ): Promise<UpdateTransferPreview> {
    const transaction = await findOne(userId, transactionId);

    if (!transaction.isTransfer || !transaction.linkedTransactionId) {
      throw new BadRequestException(
        tr("errors.transactions.notATransfer", "Transaction is not a transfer"),
      );
    }

    const linkedTransaction = await findOne(
      userId,
      transaction.linkedTransactionId,
    );

    const isFromTransaction = Number(transaction.amount) < 0;
    const fromTransaction = isFromTransaction ? transaction : linkedTransaction;
    const toTransaction = isFromTransaction ? linkedTransaction : transaction;

    const oldFromAmount = Math.abs(Number(fromTransaction.amount));
    const oldToAmount = Number(toTransaction.amount);
    const exchangeRate = Number(toTransaction.exchangeRate) || 1;

    const newAmount =
      input.amount !== undefined ? roundMoney(input.amount) : oldFromAmount;
    // When only the amount changes, scale the destination leg by the stored
    // exchange rate; when nothing money-related changes, keep the stored toAmount.
    const newToAmount =
      input.amount !== undefined
        ? roundMoney(newAmount * exchangeRate)
        : roundMoney(oldToAmount);

    const newDate = input.transactionDate ?? fromTransaction.transactionDate;
    const description =
      input.description !== undefined
        ? stripHtml(input.description) || null
        : (fromTransaction.description ?? null);

    // Re-resolve the payee only when a new label is provided, mirroring
    // previewUpdate for a normal transaction. When the label is unchanged, keep
    // the canonical from-leg payee link untouched (matched, no new creation).
    let payeeId: string | null = fromTransaction.payeeId ?? null;
    let payeeName: string | null = fromTransaction.payeeName ?? null;
    let payeeMatched = true;
    let payeeWillBeCreated = false;
    if (input.payeeName !== undefined) {
      const inputPayeeName = stripHtml(input.payeeName) || null;
      payeeId = null;
      payeeName = inputPayeeName;
      payeeMatched = false;
      if (inputPayeeName) {
        const payee = await this.payeesService.resolveByName(
          userId,
          inputPayeeName,
        );
        if (payee) {
          payeeId = payee.id;
          payeeMatched = true;
          payeeName = payee.name;
        }
      }
      payeeWillBeCreated =
        !!payeeName && !payeeMatched && input.createPayeeIfMissing !== false;
    }

    // Category: validate ownership of a changed category; otherwise keep the
    // transfer's existing (from-leg) category. Mirrors previewUpdate so the
    // confirm step re-applies the resolved id to both legs.
    let categoryId: string | null = fromTransaction.categoryId ?? null;
    let categoryName: string | null = fromTransaction.category?.name ?? null;
    if (input.categoryId !== undefined) {
      if (input.categoryId) {
        const inputCategoryId = input.categoryId;
        const category = await withScopedDb(this.dataSource, (m) =>
          m.getRepository(Category).findOne({
            where: { id: inputCategoryId, userId },
          }),
        );
        if (!category) {
          throw new BadRequestException(
            tr("errors.transactions.categoryNotFound", "Category not found"),
          );
        }
        categoryId = category.id;
        categoryName = category.name;
      } else {
        categoryId = null;
        categoryName = null;
      }
    }

    return {
      transactionId,
      fromAccountId: fromTransaction.accountId,
      fromAccountName: fromTransaction.account?.name ?? "",
      fromCurrencyCode: fromTransaction.currencyCode,
      toAccountId: toTransaction.accountId,
      toAccountName: toTransaction.account?.name ?? "",
      toCurrencyCode: toTransaction.currencyCode,
      amount: newAmount,
      toAmount: newToAmount,
      exchangeRate,
      transactionDate: newDate,
      description,
      payeeId,
      payeeName,
      payeeMatched,
      payeeWillBeCreated,
      categoryId,
      categoryName,
    };
  }

  async removeTransfer(
    userId: string,
    transactionId: string,
    findOne: (userId: string, id: string) => Promise<Transaction>,
    actor?: TransferActor,
  ): Promise<void> {
    const realUserId = actor?.realUserId ?? userId;
    const transaction = await findOne(userId, transactionId);

    if (!transaction.isTransfer) {
      throw new BadRequestException(
        tr("errors.transactions.notATransfer", "Transaction is not a transfer"),
      );
    }

    const parentSplit = await withScopedDb(this.dataSource, (m) =>
      m.getRepository(TransactionSplit).findOne({
        where: { linkedTransactionId: transactionId },
      }),
    );

    // Cross-owner pair: the owner-scoped read of the linked leg misses. Route
    // to connected (delete both) / frozen (own leg only) / 403 before any
    // deletion; the same-owner path below is untouched.
    if (!parentSplit && transaction.linkedTransactionId) {
      let scopedLinked: Transaction | null = null;
      try {
        scopedLinked = await findOne(userId, transaction.linkedTransactionId);
      } catch (err) {
        if (!(err instanceof NotFoundException)) throw err;
      }
      if (!scopedLinked) {
        return this.removeCrossOwnerTransfer(realUserId, transaction);
      }
    }

    const affectedAccountIds = new Set<string>();

    // Both legs (or the whole split parent) and their balance adjustments are
    // removed atomically.
    await withScopedDb(this.dataSource, async (m) => {
      if (parentSplit) {
        await this.removeTransferFromSplitInTransaction(
          m,
          parentSplit,
          transaction,
          transactionId,
          affectedAccountIds,
        );
      } else {
        // Both legs are locked here, in ascending id order, and their amounts
        // re-read: the delta each leg reverses must be the version the delete
        // actually removes, and a fixed lock order is what keeps two concurrent
        // transfer deletions from holding one another's second leg. A snapshot
        // taken before the transaction let two deletions each reverse the same
        // pair of amounts while only one pair of rows went away (P4-003).
        const legIds = [transactionId];
        if (transaction.linkedTransactionId) {
          legIds.push(transaction.linkedTransactionId);
        }
        const locked = await lockTransactionRows(m, legIds, userId);

        const ownLeg = locked.get(transactionId);
        if (!ownLeg) {
          throw new NotFoundException(
            tr(
              "errors.transactions.notFoundById",
              `Transaction with ID ${transactionId} not found`,
              { id: transactionId },
            ),
          );
        }
        const linkedLeg = transaction.linkedTransactionId
          ? locked.get(transaction.linkedTransactionId)
          : undefined;

        for (const leg of [linkedLeg, ownLeg]) {
          if (!leg) continue;
          affectedAccountIds.add(leg.accountId);
          // Conditional delete, reverse only what this call removed, VOID rows
          // reverse nothing, future-dated rows recompute. Shared with split
          // removal so the sequence exists once (see remove-transaction-leg.ts).
          await removeLockedTransactionLeg(
            m,
            leg,
            userId,
            this.accountsService,
          );
        }
      }
    });

    for (const accId of affectedAccountIds) {
      this.triggerNetWorthRecalc(accId, userId);
    }
  }

  /**
   * Delete a transfer whose counterpart belongs to another owner. Connected
   * (delete grant on the counterpart account): both legs and both balances,
   * atomically, under the audited system context. Frozen (no read on the
   * counterpart): the own leg only -- the FK's ON DELETE SET NULL detaches the
   * counterpart, which survives as a one-sided transfer and correctly does not
   * reconnect on reshare. Readable but no delete grant: 403 from
   * resolveCounterpartAccess.
   */
  private async removeCrossOwnerTransfer(
    realUserId: string,
    ownLeg: Transaction,
  ): Promise<void> {
    const counterpart = ownLeg.linkedTransactionId
      ? await this.loadLegById(ownLeg.linkedTransactionId)
      : null;
    const access = counterpart
      ? await this.resolveCounterpartAccess(realUserId, counterpart, "delete")
      : "frozen";

    // Both legs were loaded before this transaction opened, so the amount each
    // reversal subtracts is re-read under the row's own lock and the reversal is
    // gated on this call being the one that removed the row (audit FV4-002).
    const removeLeg = async (m: EntityManager, leg: Transaction) => {
      const locked = await lockTransactionRow(m, leg.id, leg.userId);
      if (!locked) return;
      await removeLockedTransactionLeg(
        m,
        locked,
        leg.userId,
        this.accountsService,
      );
    };

    if (access === "connected" && counterpart) {
      // Ascending id order, not "counterpart then mine".
      //
      // Either owner can start this, and each request names its *own* leg -- so
      // taking the counterpart first meant the two sides locked the same pair in
      // opposite orders, which is a PostgreSQL 40P01 for both (audit RV4-005).
      // Sorting by id is what makes the order the same whoever asks.
      const ordered = [counterpart, ownLeg].sort((a, b) =>
        a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
      );
      await withSystemContext(() =>
        withScopedDb(this.dataSource, async (m) => {
          for (const leg of ordered) {
            await removeLeg(m, leg);
          }
        }),
      );
      this.triggerNetWorthRecalc(counterpart.accountId, counterpart.userId);
    } else {
      await withScopedDb(this.dataSource, (m) => removeLeg(m, ownLeg));
    }
    this.triggerNetWorthRecalc(ownLeg.accountId, ownLeg.userId);
  }

  private async removeTransferFromSplitInTransaction(
    m: EntityManager,
    parentSplit: TransactionSplit,
    transaction: Transaction,
    transactionId: string,
    affectedAccountIds: Set<string>,
  ): Promise<void> {
    const userId = transaction.userId;
    const parentTransactionId = parentSplit.transactionId;

    // The split parent first, on its own, and only then its legs.
    //
    // A single sorted batch over parent-plus-legs looks tidier and deadlocks:
    // `TransactionSplitService.removeSplit` cannot know a leg id before it has
    // read the split, so it necessarily locks the parent and *then* the leg. A
    // batch that sorts the two together takes them in id order instead, which is
    // the opposite order whenever the leg's UUID sorts first -- and two requests
    // in opposite orders is a PostgreSQL 40P01 for both (audit RV4-005).
    //
    // So the ordering rule is by *role*, not by id: parent before legs, legs
    // among themselves ascending. The parent lock is then the serialization
    // point -- any two paths touching the same parent's legs have already
    // queued behind it, so their leg order cannot matter. See common/db/locks.ts.
    const parent = await lockTransactionRow(m, parentTransactionId, userId);

    const allSplits = await m.find(TransactionSplit, {
      where: { transactionId: parentTransactionId },
    });
    const siblingLegIds = allSplits
      .map((split) => split.linkedTransactionId)
      .filter((id): id is string => Boolean(id) && id !== transactionId);

    // Now the legs, in one ascending batch. Locking each as it is reached is what
    // let two removals interleave and each reverse the same amount; every reversal
    // below derives its amount from the locked row and only fires when this call
    // is the one that removed it (audit FV4-002).
    const locked = await lockTransactionRows(
      m,
      [...siblingLegIds, transaction.id],
      userId,
    );

    if (parent) {
      for (const legId of siblingLegIds) {
        const leg = locked.get(legId);
        if (!leg) continue;
        affectedAccountIds.add(leg.accountId);
        await removeLockedTransactionLeg(m, leg, userId, this.accountsService);
      }

      await m.remove(allSplits);

      affectedAccountIds.add(parent.accountId);
      await removeLockedTransactionLeg(m, parent, userId, this.accountsService);
    }

    affectedAccountIds.add(transaction.accountId);
    const ownLeg = locked.get(transaction.id);
    if (ownLeg) {
      await removeLockedTransactionLeg(m, ownLeg, userId, this.accountsService);
    }
  }

  async updateTransfer(
    userId: string,
    transactionId: string,
    updateDto: Partial<UpdateTransferDto>,
    findOne: (userId: string, id: string) => Promise<Transaction>,
    actor?: TransferActor,
  ): Promise<TransferResult> {
    const realUserId = actor?.realUserId ?? userId;
    const transaction = await findOne(userId, transactionId);

    if (!transaction.isTransfer || !transaction.linkedTransactionId) {
      throw new BadRequestException(
        tr("errors.transactions.notATransfer", "Transaction is not a transfer"),
      );
    }

    // When this leg is the counterpart of a SPLIT transfer, its
    // linkedTransactionId points at the split PARENT (whose amount is the sum of
    // all its splits), not at a mirror leg. Routing it through the two-leg
    // update below would overwrite the parent's aggregate amount and fields with
    // this single leg's values. Handle it separately instead.
    const parentSplit = await withScopedDb(this.dataSource, (m) =>
      m.getRepository(TransactionSplit).findOne({
        where: { linkedTransactionId: transactionId },
      }),
    );
    if (parentSplit) {
      return this.updateSplitTransferLeg(
        userId,
        transaction,
        parentSplit,
        updateDto,
        findOne,
      );
    }

    let linkedTransaction: Transaction;
    try {
      linkedTransaction = await findOne(
        userId,
        transaction.linkedTransactionId,
      );
    } catch (err) {
      if (!(err instanceof NotFoundException)) throw err;
      // Cross-owner pair: the counterpart is not the effective user's row.
      return this.updateCrossOwnerTransfer(
        userId,
        realUserId,
        transaction,
        updateDto,
        findOne,
      );
    }

    const isFromTransaction = Number(transaction.amount) < 0;
    const fromTransaction = isFromTransaction ? transaction : linkedTransaction;
    const toTransaction = isFromTransaction ? linkedTransaction : transaction;

    const oldFromAccountId = fromTransaction.accountId;
    const oldToAccountId = toTransaction.accountId;
    const oldFromAmount = Math.abs(Number(fromTransaction.amount));
    const oldToAmount = Number(toTransaction.amount);

    const newFromAccountId = updateDto.fromAccountId ?? oldFromAccountId;
    const newToAccountId = updateDto.toAccountId ?? oldToAccountId;

    if (newFromAccountId === newToAccountId) {
      throw new BadRequestException(
        tr(
          "errors.transactions.transferSameAccount",
          "Source and destination accounts must be different",
        ),
      );
    }

    let newFromAccount = fromTransaction.account;
    let newToAccount = toTransaction.account;

    if (
      updateDto.fromAccountId &&
      updateDto.fromAccountId !== oldFromAccountId
    ) {
      newFromAccount = await this.accountsService.findOne(
        userId,
        updateDto.fromAccountId,
      );
    }
    if (updateDto.toAccountId && updateDto.toAccountId !== oldToAccountId) {
      newToAccount = await this.accountsService.findOne(
        userId,
        updateDto.toAccountId,
      );
    }

    const newAmount = updateDto.amount ?? oldFromAmount;
    const newExchangeRate =
      updateDto.exchangeRate ?? toTransaction.exchangeRate;
    const newToAmount =
      updateDto.toAmount !== undefined
        ? roundMoney(updateDto.toAmount)
        : roundMoney(newAmount * newExchangeRate);

    const accountsOrAmountsChanged =
      updateDto.fromAccountId ||
      updateDto.toAccountId ||
      updateDto.amount !== undefined ||
      updateDto.exchangeRate !== undefined ||
      updateDto.toAmount !== undefined;

    const oldDate = fromTransaction.transactionDate;
    const newDate = updateDto.transactionDate ?? oldDate;
    const oldIsFuture = isTransactionInFuture(oldDate);
    const newIsFuture = isTransactionInFuture(newDate);
    const dateChanged = oldDate !== newDate;
    const anyFuture = oldIsFuture || newIsFuture;

    await this.assertCategoryOwned(userId, updateDto.categoryId);

    const fromUpdateData = this.buildFromUpdateData(
      updateDto,
      newAmount,
      oldFromAccountId,
      oldToAccountId,
      toTransaction.account?.name ?? "",
      fromTransaction.payeeId,
      fromTransaction.payeeName,
      newToAccount,
    );

    const toUpdateData = this.buildToUpdateData(
      updateDto,
      newToAmount,
      newExchangeRate,
      oldFromAccountId,
      oldToAccountId,
      fromTransaction.account?.name ?? "",
      toTransaction.payeeId,
      toTransaction.payeeName,
      newFromAccount,
    );

    // Both legs' field updates and the four possible balance adjustments
    // commit atomically.
    await withScopedDb(this.dataSource, async (m) => {
      // The four balance adjustments below reverse `oldFromAmount` /
      // `oldToAmount` and re-apply the new ones. Those old values were read
      // before this transaction opened, so a concurrent edit of either leg
      // would make them describe a version this write is not replacing -- two
      // updates each reversing the same pair and corrupting both accounts
      // (audit P4-003).
      //
      // Lock both legs in ascending id order and refuse if the committed row no
      // longer matches what was read. A 409 the client can retry is the honest
      // answer; silently applying a delta derived from a superseded snapshot is
      // not.
      const locked = await lockTransactionRows(
        m,
        [fromTransaction.id, toTransaction.id],
        userId,
      );
      const lockedFrom = locked.get(fromTransaction.id);
      const lockedTo = locked.get(toTransaction.id);
      if (!lockedFrom || !lockedTo) {
        throw new NotFoundException(
          tr(
            "errors.transactions.notFoundById",
            `Transaction with ID ${transactionId} not found`,
            { id: transactionId },
          ),
        );
      }
      const unchanged =
        Math.abs(lockedFrom.amount) === oldFromAmount &&
        lockedTo.amount === oldToAmount &&
        lockedFrom.accountId === oldFromAccountId &&
        lockedTo.accountId === oldToAccountId &&
        lockedFrom.transactionDate === oldDate;
      if (!unchanged) {
        throw new ConflictException(
          tr(
            "errors.transactions.transferChangedConcurrently",
            "This transfer was changed by another request. Reload it and try again.",
          ),
        );
      }

      if ((accountsOrAmountsChanged || dateChanged) && !anyFuture) {
        await this.accountsService.updateBalance(
          oldFromAccountId,
          oldFromAmount,
        );
        await this.accountsService.updateBalance(oldToAccountId, -oldToAmount);
      }

      if (Object.keys(fromUpdateData).length > 0) {
        await m.update(Transaction, fromTransaction.id, fromUpdateData);
      }

      if (Object.keys(toUpdateData).length > 0) {
        await m.update(Transaction, toTransaction.id, toUpdateData);
      }

      // Update createdAt via raw query to bypass pg's local-timezone
      // Date serialisation (same approach as transactions.service.ts).
      if ((updateDto as any).createdAt !== undefined) {
        const d = new Date((updateDto as any).createdAt);
        const utc = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}:${String(d.getUTCSeconds()).padStart(2, "0")}.${String(d.getUTCMilliseconds()).padStart(3, "0")}`;
        await m.query(`UPDATE transactions SET created_at = $1 WHERE id = $2`, [
          utc,
          fromTransaction.id,
        ]);
        await m.query(`UPDATE transactions SET created_at = $1 WHERE id = $2`, [
          utc,
          toTransaction.id,
        ]);
      }

      if (accountsOrAmountsChanged || dateChanged) {
        if (anyFuture) {
          // Sorted: the same fixed lock order every other account-balance
          // writer uses, so two transfers touching the same pair cannot
          // deadlock on each other's second account.
          const allAccounts = [
            ...new Set([
              oldFromAccountId,
              oldToAccountId,
              newFromAccountId,
              newToAccountId,
            ]),
          ].sort();
          for (const accId of allAccounts) {
            await this.accountsService.recalculateCurrentBalance(userId, accId);
          }
        } else {
          await this.accountsService.updateBalance(
            newFromAccountId,
            -newAmount,
          );
          await this.accountsService.updateBalance(newToAccountId, newToAmount);
        }
      }
    });

    const affectedAccounts = new Set([
      oldFromAccountId,
      oldToAccountId,
      newFromAccountId,
      newToAccountId,
    ]);
    for (const accId of affectedAccounts) {
      this.triggerNetWorthRecalc(accId, userId);
    }

    return {
      fromTransaction: await findOne(userId, fromTransaction.id),
      toTransaction: await findOne(userId, toTransaction.id),
    };
  }

  /**
   * Update a transfer whose counterpart belongs to another owner. Routes to
   * the connected flow (real user holds the edit grant on the counterpart
   * account), the frozen own-leg flow (counterpart unreadable after unshare),
   * or 403 (readable but edit not granted).
   */
  private async updateCrossOwnerTransfer(
    effectiveUserId: string,
    realUserId: string,
    ownLeg: Transaction,
    updateDto: Partial<UpdateTransferDto>,
    findOne: (userId: string, id: string) => Promise<Transaction>,
  ): Promise<TransferResult> {
    const counterpart = await this.loadLegById(ownLeg.linkedTransactionId!);
    if (!counterpart) {
      // The pointer FK is ON DELETE SET NULL, so a live id with no row should
      // not happen; fail like the not-a-transfer guard rather than guessing.
      throw new BadRequestException(
        tr("errors.transactions.notATransfer", "Transaction is not a transfer"),
      );
    }

    const access = await this.resolveCounterpartAccess(
      realUserId,
      counterpart,
      "edit",
    );
    if (access === "frozen") {
      return this.updateFrozenTransferLeg(
        effectiveUserId,
        ownLeg,
        counterpart,
        updateDto,
        findOne,
      );
    }
    return this.updateConnectedCrossOwnerTransfer(
      effectiveUserId,
      ownLeg,
      counterpart,
      updateDto,
      findOne,
    );
  }

  /**
   * Frozen link (real user lost READ on the counterpart account): only
   * presentational own-leg fields may change -- description, reference,
   * status, category, payee -- with no mirroring onto the counterpart.
   * Amount, date, exchange-rate and account changes are rejected: unmirrored
   * they would silently break the two-ledger agreement that makes the pair a
   * transfer. Modeled on the split-transfer-leg lock.
   */
  private async updateFrozenTransferLeg(
    effectiveUserId: string,
    ownLeg: Transaction,
    counterpart: Transaction,
    updateDto: Partial<UpdateTransferDto>,
    findOne: (userId: string, id: string) => Promise<Transaction>,
  ): Promise<TransferResult> {
    const isFromLeg = Number(ownLeg.amount) < 0;
    const fromLeg = isFromLeg ? ownLeg : counterpart;
    const toLeg = isFromLeg ? counterpart : ownLeg;

    // The form resends current values on every edit; only a genuine change is
    // structural.
    const structuralChange =
      (updateDto.amount !== undefined &&
        roundMoney(updateDto.amount) !== Math.abs(Number(fromLeg.amount))) ||
      (updateDto.toAmount !== undefined &&
        roundMoney(updateDto.toAmount) !== roundMoney(Number(toLeg.amount))) ||
      (updateDto.exchangeRate !== undefined &&
        Number(updateDto.exchangeRate) !== Number(toLeg.exchangeRate)) ||
      (!!updateDto.transactionDate &&
        updateDto.transactionDate !== ownLeg.transactionDate) ||
      (!!updateDto.fromAccountId &&
        updateDto.fromAccountId !== fromLeg.accountId) ||
      (!!updateDto.toAccountId && updateDto.toAccountId !== toLeg.accountId);
    if (structuralChange) {
      throw new BadRequestException(
        tr(
          "errors.transactions.crossOwnerTransferLocked",
          "The other side of this transfer is in an account you no longer have access to. You can edit this transaction's own details, but its amount, date, and accounts are locked.",
        ),
      );
    }

    await this.assertCategoryOwned(effectiveUserId, updateDto.categoryId);

    const legData: Partial<Transaction> = {};
    if (updateDto.description !== undefined)
      legData.description = updateDto.description ?? null;
    if (updateDto.referenceNumber !== undefined)
      legData.referenceNumber = updateDto.referenceNumber ?? null;
    if (updateDto.status !== undefined) legData.status = updateDto.status;
    if (updateDto.categoryId !== undefined)
      legData.categoryId = updateDto.categoryId || null;
    if (updateDto.payeeId !== undefined)
      legData.payeeId = updateDto.payeeId || null;
    if (updateDto.payeeName !== undefined)
      legData.payeeName = updateDto.payeeName || null;

    if (Object.keys(legData).length > 0) {
      await withScopedDb(this.dataSource, (m) =>
        m.update(Transaction, ownLeg.id, legData),
      );
    }

    // Return the edited leg in both slots (the split-leg pattern) so wrapper
    // tag-sync touches only this leg and nothing is mirrored.
    const refreshed = await findOne(effectiveUserId, ownLeg.id);
    return { fromTransaction: refreshed, toTransaction: refreshed };
  }

  /**
   * Connected cross-owner edit: structural fields (date, amounts, exchange
   * rate, description, reference, custom payee label) mirror across both legs
   * exactly like a same-owner transfer; per-user reference data (category,
   * payee link) and per-ledger status stay on effective-user legs only.
   * Account moves are rejected in v1 -- moving a leg between owners changes
   * user_id semantics. The atomic block runs under the audited system context
   * (foreign-leg writes are owner-only under RLS); authorization was fully
   * decided before entry.
   */
  private async updateConnectedCrossOwnerTransfer(
    effectiveUserId: string,
    ownLeg: Transaction,
    counterpart: Transaction,
    updateDto: Partial<UpdateTransferDto>,
    findOne: (userId: string, id: string) => Promise<Transaction>,
  ): Promise<TransferResult> {
    const isFromTransaction = Number(ownLeg.amount) < 0;
    const fromTransaction = isFromTransaction ? ownLeg : counterpart;
    const toTransaction = isFromTransaction ? counterpart : ownLeg;

    const movesFrom =
      !!updateDto.fromAccountId &&
      updateDto.fromAccountId !== fromTransaction.accountId;
    const movesTo =
      !!updateDto.toAccountId &&
      updateDto.toAccountId !== toTransaction.accountId;
    if (movesFrom || movesTo) {
      throw new BadRequestException(
        tr(
          "errors.transactions.crossOwnerAccountMoveLocked",
          "This transfer involves another user's account, so it cannot be moved to different accounts.",
        ),
      );
    }

    await this.assertCategoryOwned(effectiveUserId, updateDto.categoryId);

    const oldFromAmount = Math.abs(Number(fromTransaction.amount));
    const oldToAmount = Number(toTransaction.amount);
    const newAmount = updateDto.amount ?? oldFromAmount;
    const newExchangeRate =
      updateDto.exchangeRate ?? toTransaction.exchangeRate;
    const newToAmount =
      updateDto.toAmount !== undefined
        ? roundMoney(updateDto.toAmount)
        : roundMoney(newAmount * newExchangeRate);
    const amountsChanged =
      updateDto.amount !== undefined ||
      updateDto.exchangeRate !== undefined ||
      updateDto.toAmount !== undefined;

    const oldDate = fromTransaction.transactionDate;
    const newDate = updateDto.transactionDate ?? oldDate;
    const dateChanged = oldDate !== newDate;
    const anyFuture =
      isTransactionInFuture(oldDate) || isTransactionInFuture(newDate);

    const fromUpdateData = this.buildFromUpdateData(
      updateDto,
      newAmount,
      fromTransaction.accountId,
      toTransaction.accountId,
      toTransaction.account?.name ?? "",
      fromTransaction.payeeId,
      fromTransaction.payeeName,
      toTransaction.account,
    );
    const toUpdateData = this.buildToUpdateData(
      updateDto,
      newToAmount,
      newExchangeRate,
      fromTransaction.accountId,
      toTransaction.accountId,
      fromTransaction.account?.name ?? "",
      toTransaction.payeeId,
      toTransaction.payeeName,
      fromTransaction.account,
    );

    // Per-user reference data and per-ledger reconciliation state never cross
    // an ownership boundary.
    for (const [leg, data] of [
      [fromTransaction, fromUpdateData],
      [toTransaction, toUpdateData],
    ] as const) {
      if (leg.userId !== effectiveUserId) {
        delete data.categoryId;
        delete data.payeeId;
        delete data.status;
      }
    }

    await withSystemContext(() =>
      withScopedDb(this.dataSource, async (m) => {
        if ((amountsChanged || dateChanged) && !anyFuture) {
          await this.accountsService.updateBalance(
            fromTransaction.accountId,
            oldFromAmount,
          );
          await this.accountsService.updateBalance(
            toTransaction.accountId,
            -oldToAmount,
          );
        }

        if (Object.keys(fromUpdateData).length > 0) {
          await m.update(Transaction, fromTransaction.id, fromUpdateData);
        }
        if (Object.keys(toUpdateData).length > 0) {
          await m.update(Transaction, toTransaction.id, toUpdateData);
        }

        if (amountsChanged || dateChanged) {
          if (anyFuture) {
            // Cross-owner transfer: the two legs belong to different owners, so
            // each account's balance-write lock is scoped to ITS own leg's
            // owner, never to the acting user (maintainer review, PR #1095).
            // Keyed by account id so a degenerate same-account pair still folds
            // to one recalculation, as the previous Set did.
            const legsByAccount = new Map<string, string>([
              [fromTransaction.accountId, fromTransaction.userId],
              [toTransaction.accountId, toTransaction.userId],
            ]);
            for (const [accId, ownerId] of legsByAccount) {
              await this.accountsService.recalculateCurrentBalance(
                ownerId,
                accId,
              );
            }
          } else {
            await this.accountsService.updateBalance(
              fromTransaction.accountId,
              -newAmount,
            );
            await this.accountsService.updateBalance(
              toTransaction.accountId,
              newToAmount,
            );
          }
        }
      }),
    );

    this.triggerNetWorthRecalc(
      fromTransaction.accountId,
      fromTransaction.userId,
    );
    this.triggerNetWorthRecalc(toTransaction.accountId, toTransaction.userId);

    return {
      fromTransaction: await findOne(
        fromTransaction.userId,
        fromTransaction.id,
      ),
      toTransaction: await findOne(toTransaction.userId, toTransaction.id),
    };
  }

  /**
   * Update a single leg of a SPLIT transfer (the counterpart living in the
   * target account) without disturbing the split parent's aggregate amount.
   *
   * Only the counterpart's own presentational fields are edited in place. When
   * the amount changes, the matching split row and the parent's total (sum of
   * all splits) are kept in sync and both accounts rebalanced, so the split set
   * never drifts out of agreement with the parent. Structural edits (moving the
   * transfer to different accounts) are rejected -- those belong to the split
   * editor on the source transaction.
   */
  private async updateSplitTransferLeg(
    userId: string,
    counterpart: Transaction,
    parentSplit: TransactionSplit,
    updateDto: Partial<UpdateTransferDto>,
    findOne: (userId: string, id: string) => Promise<Transaction>,
  ): Promise<TransferResult> {
    const parentTransaction = await findOne(userId, parentSplit.transactionId);

    // Reject account restructuring from the target side. The form always resends
    // the current accounts (from = source/parent account, to = this leg's
    // account); only a genuine change is blocked.
    const movesSource =
      !!updateDto.fromAccountId &&
      updateDto.fromAccountId !== parentTransaction.accountId;
    const movesTarget =
      !!updateDto.toAccountId &&
      updateDto.toAccountId !== counterpart.accountId;
    if (movesSource || movesTarget) {
      throw new BadRequestException(
        tr(
          "errors.transactions.splitTransferLegAccountLocked",
          "This transfer is part of a split transaction. Change its accounts by editing the split on the source transaction instead.",
        ),
      );
    }

    await this.assertCategoryOwned(userId, updateDto.categoryId);

    const oldCounterpartAmount = Number(counterpart.amount);
    const sign = oldCounterpartAmount < 0 ? -1 : 1;
    const newCounterpartAmount =
      updateDto.amount !== undefined
        ? roundMoney(sign * Math.abs(updateDto.amount))
        : oldCounterpartAmount;
    const amountChanged = newCounterpartAmount !== oldCounterpartAmount;

    const oldDate = counterpart.transactionDate;
    const newDate = updateDto.transactionDate ?? oldDate;
    const dateChanged = oldDate !== newDate;

    // The counterpart's own editable fields. Currency / exchange-rate / toAmount
    // are intentionally ignored: split transfers are 1:1 same-currency, and the
    // form resends the current currency on every edit.
    const legData: Partial<Transaction> = {};
    if (updateDto.transactionDate)
      legData.transactionDate = updateDto.transactionDate as any;
    if (updateDto.description !== undefined)
      legData.description = updateDto.description ?? null;
    if (updateDto.referenceNumber !== undefined)
      legData.referenceNumber = updateDto.referenceNumber ?? null;
    if (updateDto.status !== undefined) legData.status = updateDto.status;
    if (updateDto.categoryId !== undefined)
      legData.categoryId = updateDto.categoryId || null;
    if (updateDto.payeeId !== undefined)
      legData.payeeId = updateDto.payeeId || null;
    if (updateDto.payeeName !== undefined)
      legData.payeeName = updateDto.payeeName || null;
    if (amountChanged) legData.amount = newCounterpartAmount;

    // The split row on the source transaction is kept in step with the leg: its
    // memo mirrors the leg's description (they are seeded from each other on
    // create), and its amount mirrors the leg's negated amount.
    const newSplitAmount = amountChanged
      ? roundMoney(-newCounterpartAmount)
      : undefined;
    const splitData: Partial<TransactionSplit> = {};
    if (updateDto.description !== undefined)
      splitData.memo = updateDto.description ?? null;
    if (newSplitAmount !== undefined) splitData.amount = newSplitAmount as any;

    // The leg edit, split-row mirror, parent re-total, and balance updates
    // commit atomically.
    await withScopedDb(this.dataSource, async (m) => {
      if (Object.keys(legData).length > 0) {
        await m.update(Transaction, counterpart.id, legData);
      }

      // Rebalance the counterpart's own account for an amount and/or date change.
      if (amountChanged || dateChanged) {
        if (isTransactionInFuture(oldDate) || isTransactionInFuture(newDate)) {
          await this.accountsService.recalculateCurrentBalance(
            userId,
            counterpart.accountId,
          );
        } else {
          await this.accountsService.updateBalance(
            counterpart.accountId,
            newCounterpartAmount - oldCounterpartAmount,
          );
        }
      }

      // Write the split row (memo mirror and/or amount) in one update.
      if (Object.keys(splitData).length > 0) {
        await m.update(TransactionSplit, parentSplit.id, splitData);
      }

      // When the amount changed, re-total the parent and rebalance the source.
      if (amountChanged && newSplitAmount !== undefined) {
        const siblingSplits = await m.find(TransactionSplit, {
          where: { transactionId: parentTransaction.id },
        });
        const sumCents = siblingSplits.reduce((acc, s) => {
          const amt =
            s.id === parentSplit.id ? newSplitAmount : Number(s.amount);
          return acc + Math.round(amt * 10000);
        }, 0);
        const newParentAmount = sumCents / 10000;
        const oldParentAmount = Number(parentTransaction.amount);

        await m.update(Transaction, parentTransaction.id, {
          amount: newParentAmount,
        });

        if (isTransactionInFuture(parentTransaction.transactionDate)) {
          await this.accountsService.recalculateCurrentBalance(
            userId,
            parentTransaction.accountId,
          );
        } else {
          await this.accountsService.updateBalance(
            parentTransaction.accountId,
            newParentAmount - oldParentAmount,
          );
        }
      }
    });

    this.triggerNetWorthRecalc(counterpart.accountId, userId);
    this.triggerNetWorthRecalc(parentTransaction.accountId, userId);

    // Return the edited leg as both slots so the wrapper's tag-sync touches only
    // this leg, never the split parent's tags.
    const refreshedLeg = await findOne(userId, counterpart.id);
    return {
      fromTransaction: refreshedLeg,
      toTransaction: refreshedLeg,
    };
  }

  private buildFromUpdateData(
    updateDto: Partial<UpdateTransferDto>,
    newAmount: number,
    oldFromAccountId: string,
    oldToAccountId: string,
    oldToAccountName: string,
    existingPayeeId: string | null,
    existingPayeeName: string | null,
    newToAccount: any,
  ): Partial<Transaction> {
    const data: Partial<Transaction> = {};
    if (updateDto.transactionDate)
      data.transactionDate = updateDto.transactionDate as any;
    if (updateDto.amount !== undefined) data.amount = -newAmount;
    if (updateDto.description !== undefined)
      data.description = updateDto.description ?? null;
    if (updateDto.referenceNumber !== undefined)
      data.referenceNumber = updateDto.referenceNumber ?? null;
    if (updateDto.status !== undefined) data.status = updateDto.status;
    if (updateDto.categoryId !== undefined)
      data.categoryId = updateDto.categoryId || null;
    if (updateDto.fromCurrencyCode)
      data.currencyCode = updateDto.fromCurrencyCode;
    if (updateDto.payeeId !== undefined)
      data.payeeId = updateDto.payeeId || null;
    if (updateDto.payeeName !== undefined)
      data.payeeName = updateDto.payeeName || null;
    if (
      updateDto.fromAccountId &&
      updateDto.fromAccountId !== oldFromAccountId
    ) {
      data.accountId = updateDto.fromAccountId;
    }

    const payeeNameCleared =
      updateDto.payeeName !== undefined && !updateDto.payeeName;
    const toAccountChanged =
      !!updateDto.toAccountId && updateDto.toAccountId !== oldToAccountId;
    // Detect auto-generated payee: matches "Transfer to <oldToAccount>" with no
    // linked Payee entity. The frontend re-sends the existing payeeName on edit,
    // so we can't rely on `payeeName === undefined` alone.
    const effectivePayeeName =
      updateDto.payeeName !== undefined
        ? updateDto.payeeName
        : existingPayeeName;
    const effectivePayeeId =
      updateDto.payeeId !== undefined ? updateDto.payeeId : existingPayeeId;
    const payeeWasAutoGenerated =
      !effectivePayeeId &&
      effectivePayeeName === `Transfer to ${oldToAccountName}`;
    const shouldRegenerateDefault =
      payeeNameCleared ||
      (toAccountChanged &&
        (updateDto.payeeName === undefined || payeeWasAutoGenerated));

    if (shouldRegenerateDefault) {
      data.payeeName = `Transfer to ${newToAccount.name}`;
    }

    return data;
  }

  private buildToUpdateData(
    updateDto: Partial<UpdateTransferDto>,
    newToAmount: number,
    newExchangeRate: number,
    oldFromAccountId: string,
    oldToAccountId: string,
    oldFromAccountName: string,
    existingPayeeId: string | null,
    existingPayeeName: string | null,
    newFromAccount: any,
  ): Partial<Transaction> {
    const data: Partial<Transaction> = {};
    if (updateDto.transactionDate)
      data.transactionDate = updateDto.transactionDate as any;
    if (
      updateDto.amount !== undefined ||
      updateDto.exchangeRate !== undefined ||
      updateDto.toAmount !== undefined
    )
      data.amount = newToAmount;
    if (updateDto.description !== undefined)
      data.description = updateDto.description ?? null;
    if (updateDto.referenceNumber !== undefined)
      data.referenceNumber = updateDto.referenceNumber ?? null;
    if (updateDto.status !== undefined) data.status = updateDto.status;
    if (updateDto.categoryId !== undefined)
      data.categoryId = updateDto.categoryId || null;
    if (updateDto.toCurrencyCode) data.currencyCode = updateDto.toCurrencyCode;
    if (updateDto.exchangeRate) data.exchangeRate = updateDto.exchangeRate;
    if (updateDto.payeeId !== undefined)
      data.payeeId = updateDto.payeeId || null;
    if (updateDto.payeeName !== undefined)
      data.payeeName = updateDto.payeeName || null;
    if (updateDto.toAccountId && updateDto.toAccountId !== oldToAccountId) {
      data.accountId = updateDto.toAccountId;
    }

    const payeeNameCleared =
      updateDto.payeeName !== undefined && !updateDto.payeeName;
    const fromAccountChanged =
      !!updateDto.fromAccountId && updateDto.fromAccountId !== oldFromAccountId;
    const effectivePayeeName =
      updateDto.payeeName !== undefined
        ? updateDto.payeeName
        : existingPayeeName;
    const effectivePayeeId =
      updateDto.payeeId !== undefined ? updateDto.payeeId : existingPayeeId;
    const payeeWasAutoGenerated =
      !effectivePayeeId &&
      effectivePayeeName === `Transfer from ${oldFromAccountName}`;
    const shouldRegenerateDefault =
      payeeNameCleared ||
      (fromAccountChanged &&
        (updateDto.payeeName === undefined || payeeWasAutoGenerated));

    if (shouldRegenerateDefault) {
      data.payeeName = `Transfer from ${newFromAccount.name}`;
    }

    return data;
  }
}
