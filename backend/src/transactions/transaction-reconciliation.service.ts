import {
  Injectable,
  BadRequestException,
  Inject,
  forwardRef,
} from "@nestjs/common";
import { DataSource, In } from "typeorm";
import { Transaction, TransactionStatus } from "./entities/transaction.entity";
import { AccountsService } from "../accounts/accounts.service";
import {
  isTransactionInFuture,
  formatDateYMDLocal,
} from "../common/date-utils";
import { tr } from "../i18n/translate";
import { withScopedDb } from "../common/db/scoped-db";
import { expandTransferLegsForStatus } from "./transfer-status-pairing.util";

@Injectable()
export class TransactionReconciliationService {
  constructor(
    @Inject(forwardRef(() => AccountsService))
    private accountsService: AccountsService,
    private dataSource: DataSource,
  ) {}

  /**
   * Set a transaction's status, carrying a transfer's counterpart leg with it
   * **only when the transition crosses `VOID`**.
   *
   * Entering or leaving `VOID` moves a balance, so on a transfer it is one
   * economic event and has to land on both legs. This endpoint used to write and
   * rebalance only the row it was handed, so voiding the source leg of a 100.00
   * transfer restored 100.00 to the source account while the destination leg
   * stayed active and kept its 100.00.
   *
   * `CLEARED` and `RECONCILED` are the opposite: they record whether *this*
   * account's statement has recognised *this* leg, and the two statements arrive
   * separately. Pairing them would remove a transfer from the counterpart
   * account's reconciliation candidates before its statement contained it, and
   * stamp the source account's statement date on the destination leg -- so those
   * stay on the row the caller named, matching `unreconcile`, `bulkReconcile` and
   * the cross-owner path, which are all account-scoped already.
   *
   * The pair is resolved by `expandTransferLegsForStatus`, the same rule the bulk
   * path uses. A leg it refuses (a split-transfer leg, or a cross-owner
   * counterpart this caller cannot write) is rejected rather than half-applied:
   * an HTTP error the client can act on beats a silently inconsistent pair.
   */
  async updateStatus(
    transaction: Transaction,
    status: TransactionStatus,
    userId: string,
    triggerNetWorthRecalc: (accountId: string, userId: string) => void,
    findOne: (userId: string, id: string) => Promise<Transaction>,
  ): Promise<Transaction> {
    const oldStatus = transaction.status;
    const wasVoid = oldStatus === TransactionStatus.VOID;
    const isVoid = status === TransactionStatus.VOID;
    const voidnessChanged = wasVoid !== isVoid;

    // The status change and the matching balance adjustment touch two tables
    // (transactions + accounts) and must commit atomically, otherwise a failure
    // between the two leaves the account balance out of sync with the status.
    // The pair expansion runs inside the same transaction, so the refusal below
    // happens before anything is written.
    // Only a VOID boundary is pair-wide, and only a transfer leg or split parent
    // has a pair at all. Marking a leg CLEARED or RECONCILED is this account's own
    // statement state and stays on the row the caller named, so the common case
    // also costs no extra query.
    const mayHavePair =
      voidnessChanged &&
      ((transaction.isTransfer && !!transaction.linkedTransactionId) ||
        transaction.isSplit === true);

    const affected = await withScopedDb(this.dataSource, async (m) => {
      const expansion = mayHavePair
        ? await expandTransferLegsForStatus(m, userId, [transaction.id], status)
        : { ids: [transaction.id], refusedIds: [], reasons: [] };

      if (expansion.refusedIds.includes(transaction.id)) {
        throw new BadRequestException(
          tr(
            "errors.transactions.statusChangeNeedsBothLegs",
            "This transfer's status has to change on both legs. Edit the transfer itself, or change the status on the split that owns it.",
          ),
        );
      }

      // The legs to write. Loaded fresh inside the transaction: the counterpart's
      // own amount, date and status decide its balance adjustment, and the
      // caller only handed us one row.
      const legs =
        expansion.ids.length === 1
          ? [transaction]
          : await m.getRepository(Transaction).find({
              where: { id: In(expansion.ids), userId },
            });

      for (const leg of legs) {
        const legWasVoid = leg.status === TransactionStatus.VOID;
        // Both legs of a transfer enter and leave VOID together -- that is the
        // only reason a counterpart is in this list. A leg already in the target
        // state simply moves nothing.
        const legVoidnessChanged = legWasVoid !== isVoid;

        if (isTransactionInFuture(leg.transactionDate)) {
          await m.update(Transaction, leg.id, { status });
          if (legVoidnessChanged) {
            await this.accountsService.recalculateCurrentBalance(leg.accountId);
          }
        } else {
          if (legWasVoid && !isVoid) {
            await this.accountsService.updateBalance(
              leg.accountId,
              Number(leg.amount),
            );
          } else if (!legWasVoid && isVoid) {
            await this.accountsService.updateBalance(
              leg.accountId,
              -Number(leg.amount),
            );
          }
          await m.update(Transaction, leg.id, { status });
        }

        // Strictly the row the caller named. A reconciliation date says "this
        // account's statement of this date recognised this leg", which is never
        // true of a counterpart in another account -- and RECONCILED is not a
        // pair-wide transition anyway, so `legs` holds one row here.
        if (
          leg.id === transaction.id &&
          status === TransactionStatus.RECONCILED &&
          leg.status !== TransactionStatus.RECONCILED
        ) {
          const reconciledDate = formatDateYMDLocal(new Date());
          await m.update(Transaction, leg.id, { reconciledDate });
        }
      }

      return legs;
    });

    if (voidnessChanged) {
      for (const accountId of new Set(affected.map((leg) => leg.accountId))) {
        triggerNetWorthRecalc(accountId, userId);
      }
    }

    return findOne(userId, transaction.id);
  }

  async markCleared(
    transaction: Transaction,
    isCleared: boolean,
    userId: string,
    triggerNetWorthRecalc: (accountId: string, userId: string) => void,
    findOne: (userId: string, id: string) => Promise<Transaction>,
  ): Promise<Transaction> {
    if (
      transaction.status === TransactionStatus.RECONCILED ||
      transaction.status === TransactionStatus.VOID
    ) {
      throw new BadRequestException(
        tr(
          "errors.transactions.cannotChangeClearedStatusOfReconciledOrVoid",
          "Cannot change cleared status of reconciled or void transactions",
        ),
      );
    }

    const newStatus = isCleared
      ? TransactionStatus.CLEARED
      : TransactionStatus.UNRECONCILED;
    return this.updateStatus(
      transaction,
      newStatus,
      userId,
      triggerNetWorthRecalc,
      findOne,
    );
  }

  async reconcile(
    transaction: Transaction,
    userId: string,
    triggerNetWorthRecalc: (accountId: string, userId: string) => void,
    findOne: (userId: string, id: string) => Promise<Transaction>,
  ): Promise<Transaction> {
    if (transaction.status === TransactionStatus.RECONCILED) {
      throw new BadRequestException(
        tr(
          "errors.transactions.alreadyReconciled",
          "Transaction is already reconciled",
        ),
      );
    }

    if (transaction.status === TransactionStatus.VOID) {
      throw new BadRequestException(
        tr(
          "errors.transactions.cannotReconcileVoid",
          "Cannot reconcile a void transaction",
        ),
      );
    }

    return this.updateStatus(
      transaction,
      TransactionStatus.RECONCILED,
      userId,
      triggerNetWorthRecalc,
      findOne,
    );
  }

  async unreconcile(
    transaction: Transaction,
    userId: string,
    findOne: (userId: string, id: string) => Promise<Transaction>,
  ): Promise<Transaction> {
    if (transaction.status !== TransactionStatus.RECONCILED) {
      throw new BadRequestException(
        tr(
          "errors.transactions.notReconciled",
          "Transaction is not reconciled",
        ),
      );
    }

    await withScopedDb(this.dataSource, (m) =>
      m.getRepository(Transaction).update(transaction.id, {
        status: TransactionStatus.CLEARED,
        reconciledDate: null,
      }),
    );

    return findOne(userId, transaction.id);
  }

  async getReconciliationData(
    userId: string,
    accountId: string,
    statementDate: string,
    statementBalance: number,
  ): Promise<{
    transactions: Transaction[];
    reconciledBalance: number;
    clearedBalance: number;
    difference: number;
  }> {
    const [account, transactions, reconciledResult, clearedResult] =
      await withScopedDb(this.dataSource, (m) =>
        Promise.all([
          this.accountsService.findOne(userId, accountId),
          m
            .getRepository(Transaction)
            .createQueryBuilder("transaction")
            .leftJoinAndSelect("transaction.payee", "payee")
            .leftJoinAndSelect("transaction.category", "category")
            .where("transaction.userId = :userId", { userId })
            .andWhere("transaction.accountId = :accountId", { accountId })
            .andWhere("transaction.parentTransactionId IS NULL")
            .andWhere("transaction.status IN (:...statuses)", {
              statuses: [
                TransactionStatus.UNRECONCILED,
                TransactionStatus.CLEARED,
              ],
            })
            .andWhere("transaction.transactionDate <= :statementDate", {
              statementDate,
            })
            .orderBy("transaction.transactionDate", "ASC")
            .addOrderBy("transaction.createdAt", "ASC")
            .getMany(),
          m
            .getRepository(Transaction)
            .createQueryBuilder("transaction")
            .select("SUM(transaction.amount)", "sum")
            .where("transaction.userId = :userId", { userId })
            .andWhere("transaction.accountId = :accountId", { accountId })
            .andWhere("transaction.parentTransactionId IS NULL")
            .andWhere("transaction.status = :status", {
              status: TransactionStatus.RECONCILED,
            })
            .getRawOne(),
          m
            .getRepository(Transaction)
            .createQueryBuilder("transaction")
            .select("SUM(transaction.amount)", "sum")
            .where("transaction.userId = :userId", { userId })
            .andWhere("transaction.accountId = :accountId", { accountId })
            .andWhere("transaction.parentTransactionId IS NULL")
            .andWhere("transaction.status = :status", {
              status: TransactionStatus.CLEARED,
            })
            .andWhere("transaction.transactionDate <= :statementDate", {
              statementDate,
            })
            .getRawOne(),
        ]),
      );

    const reconciledSum = Number(reconciledResult?.sum) || 0;
    const reconciledBalance = Number(account.openingBalance) + reconciledSum;

    const clearedSum = Number(clearedResult?.sum) || 0;
    const clearedBalance = reconciledBalance + clearedSum;

    const difference = statementBalance - clearedBalance;

    return {
      transactions,
      reconciledBalance,
      clearedBalance,
      difference,
    };
  }

  async bulkReconcile(
    userId: string,
    accountId: string,
    transactionIds: string[],
    reconciledDate: string,
  ): Promise<{ reconciled: number }> {
    await this.accountsService.findOne(userId, accountId);

    if (transactionIds.length === 0) {
      return { reconciled: 0 };
    }

    return withScopedDb(this.dataSource, async (m) => {
      const transactions = await m
        .getRepository(Transaction)
        .createQueryBuilder("transaction")
        .where("transaction.id IN (:...ids)", { ids: transactionIds })
        .andWhere("transaction.userId = :userId", { userId })
        .andWhere("transaction.accountId = :accountId", { accountId })
        .getMany();

      if (transactions.length !== transactionIds.length) {
        throw new BadRequestException(
          tr(
            "errors.transactions.bulkReconcileNotFound",
            "Some transactions were not found or do not belong to the specified account",
          ),
        );
      }

      const voidTransactions = transactions.filter(
        (t) => t.status === TransactionStatus.VOID,
      );
      if (voidTransactions.length > 0) {
        throw new BadRequestException(
          tr(
            "errors.transactions.cannotReconcileVoidPlural",
            "Cannot reconcile void transactions",
          ),
        );
      }

      await m
        .getRepository(Transaction)
        .createQueryBuilder()
        .update(Transaction)
        .set({
          status: TransactionStatus.RECONCILED,
          reconciledDate: reconciledDate,
        })
        .where("id IN (:...ids)", { ids: transactionIds })
        .andWhere("userId = :userId", { userId })
        .execute();

      return { reconciled: transactions.length };
    });
  }
}
