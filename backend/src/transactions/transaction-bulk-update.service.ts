import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Inject,
  forwardRef,
  Logger,
} from "@nestjs/common";
import {
  Brackets,
  EntityManager,
  In,
  SelectQueryBuilder,
  DataSource,
} from "typeorm";
import { Transaction, TransactionStatus } from "./entities/transaction.entity";
import { TransactionSplit } from "./entities/transaction-split.entity";
import { Category } from "../categories/entities/category.entity";
import { Payee } from "../payees/entities/payee.entity";
import { UserPreference } from "../users/entities/user-preference.entity";
import { AccountsService } from "../accounts/accounts.service";
import { NetWorthService } from "../net-worth/net-worth.service";
import { TagsService } from "../tags/tags.service";
import {
  BulkUpdateDto,
  BulkDeleteDto,
  BulkUpdateFilterDto,
} from "./dto/bulk-update.dto";
import { getAllCategoryIdsWithChildren } from "../common/category-tree.util";
import {
  isTransactionInFuture,
  formatDateYMDLocal,
} from "../common/date-utils";
import {
  buildTransactionSearchClause,
  escapeLikePattern,
} from "./transaction-search.util";
import {
  parseSearchTerm,
  ParsedSearchTerm,
} from "./transaction-search-parse.util";
import { expandTransferLegsForStatus } from "./transfer-status-pairing.util";
import { tr } from "../i18n/translate";
import { withScopedDb } from "../common/db/scoped-db";

export interface BulkDeleteResult {
  deleted: number;
}

export interface BulkUpdateResult {
  updated: number;
  skipped: number;
  skippedReasons: string[];
}

@Injectable()
export class TransactionBulkUpdateService {
  private readonly logger = new Logger(TransactionBulkUpdateService.name);

  constructor(
    @Inject(forwardRef(() => AccountsService))
    private accountsService: AccountsService,
    @Inject(forwardRef(() => NetWorthService))
    private netWorthService: NetWorthService,
    private tagsService: TagsService,
    private dataSource: DataSource,
  ) {}

  /**
   * Interprets the search term as an exact amount and/or date using the user's
   * number/date-format preferences, so locale-formatted values also match.
   */
  private async resolveSearchTerm(
    userId: string,
    term?: string,
  ): Promise<ParsedSearchTerm> {
    if (!term || !term.trim()) return { amount: null, date: null };
    const prefs = await withScopedDb(this.dataSource, (m) =>
      m.getRepository(UserPreference).findOne({
        where: { userId },
      }),
    );
    return parseSearchTerm(term, {
      numberFormat: prefs?.numberFormat,
      dateFormat: prefs?.dateFormat,
    });
  }

  async bulkUpdate(
    userId: string,
    dto: BulkUpdateDto,
  ): Promise<BulkUpdateResult> {
    const updateFields = this.extractUpdateFields(dto);
    const isUpdatingTags = "tagIds" in dto;
    if (Object.keys(updateFields).length === 0 && !isUpdatingTags) {
      throw new BadRequestException(
        tr(
          "errors.transactions.bulkUpdateNoFields",
          "At least one update field must be provided",
        ),
      );
    }

    // H4: Validate ownership of categoryId and payeeId before applying
    if ("categoryId" in dto && dto.categoryId) {
      const categoryId = dto.categoryId;
      const cat = await withScopedDb(this.dataSource, (m) =>
        m.getRepository(Category).findOne({
          where: { id: categoryId, userId },
        }),
      );
      if (!cat) {
        throw new NotFoundException(
          tr("errors.transactions.categoryNotFound", "Category not found"),
        );
      }
    }
    if ("payeeId" in dto && dto.payeeId) {
      const payeeId = dto.payeeId;
      const payee = await withScopedDb(this.dataSource, (m) =>
        m.getRepository(Payee).findOne({
          where: { id: payeeId, userId },
        }),
      );
      if (!payee) {
        throw new NotFoundException(
          tr("errors.transactions.payeeNotFound", "Payee not found"),
        );
      }
    }

    const isUpdatingPayee = "payeeId" in dto || "payeeName" in dto;
    const isUpdatingCategory = "categoryId" in dto;
    const isUpdatingStatus = "status" in dto;

    // Step 1: Get eligible transaction IDs
    const allIds = await this.resolveTransactionIds(userId, dto);
    if (allIds.length === 0) {
      return { updated: 0, skipped: 0, skippedReasons: [] };
    }

    // Step 2: Apply exclusions and compute skip counts
    const { eligibleIds, skipped, skippedReasons } = await this.applyExclusions(
      userId,
      allIds,
      isUpdatingPayee,
      isUpdatingCategory,
    );

    if (eligibleIds.length === 0) {
      return { updated: 0, skipped, skippedReasons };
    }

    // A status change is balance-affecting, so it may not land on one leg of a
    // linked transfer alone. Resolve the pair-safe id set before anything is
    // written, and inside the same transaction that adjusts the balances.
    let statusIds: string[] = [];
    let statusSkipped = 0;
    const statusSkippedReasons: string[] = [];

    // Every field except the status applies to the selection itself; the status
    // applies to the transfer-pair expansion of it.
    const nonStatusFields = { ...updateFields };
    delete nonStatusFields.status;
    const appliesNonStatusFields =
      Object.keys(nonStatusFields).length > 0 || isUpdatingTags;

    // Balance changes and the batch update commit in a single transaction.
    await withScopedDb(this.dataSource, async (m) => {
      // Step 3: Handle balance adjustments for VOID status changes
      if (isUpdatingStatus) {
        const expanded = await expandTransferLegsForStatus(
          m,
          userId,
          eligibleIds,
        );
        statusIds = expanded.ids;
        statusSkipped = expanded.refusedIds.length;
        statusSkippedReasons.push(...expanded.reasons);

        if (statusIds.length > 0) {
          await this.handleStatusBalanceChanges(
            m,
            userId,
            statusIds,
            dto.status!,
          );
        }
      }

      // Step 4: Execute batch update for column fields.
      if (Object.keys(nonStatusFields).length > 0) {
        await m
          .createQueryBuilder()
          .update(Transaction)
          .set(nonStatusFields)
          .where("id IN (:...ids)", { ids: eligibleIds })
          .andWhere("userId = :userId", { userId })
          .execute();

        // Step 4b: Sync payee/description to linked transfer transactions
        await this.syncLinkedTransfers(m, userId, eligibleIds, nonStatusFields);
      }

      if (isUpdatingStatus && statusIds.length > 0) {
        await m
          .createQueryBuilder()
          .update(Transaction)
          .set({ status: dto.status })
          .where("id IN (:...ids)", { ids: statusIds })
          .andWhere("userId = :userId", { userId })
          .execute();
      }

      // Step 4c: Update tags (many-to-many relation). Validates the tag set
      // once and replaces tags with a single bulk delete + insert across all
      // eligible transactions.
      if (isUpdatingTags) {
        await this.tagsService.setTransactionTagsBulk(
          eligibleIds,
          dto.tagIds ?? [],
          userId,
        );

        // Keep transfer counterparts in step, mirroring the single-edit flow
        // (updateTransfer wrapper): plain transfer legs share tags with their
        // mirror leg; split-transfer legs mirror tags onto the owning split.
        await this.syncTransferTags(m, userId, eligibleIds, dto.tagIds ?? []);
      }
    });

    // Step 5: Trigger net worth recalc for affected accounts (after commit)
    if (isUpdatingStatus && statusIds.length > 0) {
      await this.triggerNetWorthRecalcForTransactions(userId, statusIds);
    }

    // A refused transfer leg still received every other field it was selected
    // for, so it counts as both updated and skipped in a mixed request; the
    // reason string says which half was refused.
    const updatedIds = new Set<string>(
      appliesNonStatusFields ? eligibleIds : [],
    );
    for (const id of statusIds) updatedIds.add(id);

    return {
      updated: updatedIds.size,
      skipped: skipped + statusSkipped,
      skippedReasons: [...skippedReasons, ...statusSkippedReasons],
    };
  }

  async bulkDelete(
    userId: string,
    dto: BulkDeleteDto,
  ): Promise<BulkDeleteResult> {
    const allIds = await this.resolveTransactionIds(userId, dto);
    if (allIds.length === 0) {
      return { deleted: 0 };
    }

    // Load transaction details needed for balance adjustments and linked transfers
    const transactions = await withScopedDb(this.dataSource, (m) =>
      m
        .getRepository(Transaction)
        .createQueryBuilder("transaction")
        .select([
          "transaction.id",
          "transaction.accountId",
          "transaction.amount",
          "transaction.status",
          "transaction.transactionDate",
          "transaction.isTransfer",
          "transaction.linkedTransactionId",
          "transaction.isSplit",
        ])
        .leftJoinAndSelect("transaction.splits", "splits")
        .where("transaction.id IN (:...ids)", { ids: allIds })
        .andWhere("transaction.userId = :userId", { userId })
        .getMany(),
    );

    if (transactions.length === 0) {
      return { deleted: 0 };
    }

    // Balance adjustments and both delete passes commit atomically.
    await withScopedDb(this.dataSource, async (m) => {
      // Collect linked transaction IDs from transfers and split transfers
      const linkedIdsToDelete = new Set<string>();
      const transactionIdsSet = new Set(transactions.map((t) => t.id));

      for (const tx of transactions) {
        if (
          tx.linkedTransactionId &&
          !transactionIdsSet.has(tx.linkedTransactionId)
        ) {
          linkedIdsToDelete.add(tx.linkedTransactionId);
        }
        if (tx.isSplit && tx.splits) {
          for (const split of tx.splits) {
            if (
              split.linkedTransactionId &&
              !transactionIdsSet.has(split.linkedTransactionId)
            ) {
              linkedIdsToDelete.add(split.linkedTransactionId);
            }
          }
        }
      }

      // Load linked transactions for balance adjustments
      let linkedTransactions: Transaction[] = [];
      if (linkedIdsToDelete.size > 0) {
        linkedTransactions = await m
          .createQueryBuilder(Transaction, "transaction")
          .select([
            "transaction.id",
            "transaction.accountId",
            "transaction.amount",
            "transaction.status",
            "transaction.transactionDate",
          ])
          .where("transaction.id IN (:...ids)", {
            ids: [...linkedIdsToDelete],
          })
          .andWhere("transaction.userId = :userId", { userId })
          .getMany();
      }

      // Adjust balances for all transactions being deleted (primary + linked)
      const allTransactionsToDelete = [...transactions, ...linkedTransactions];
      const balanceAdjustments = new Map<string, number>();

      for (const tx of allTransactionsToDelete) {
        if (
          tx.status !== TransactionStatus.VOID &&
          !isTransactionInFuture(tx.transactionDate)
        ) {
          const current = balanceAdjustments.get(tx.accountId) || 0;
          balanceAdjustments.set(tx.accountId, current - Number(tx.amount));
        }
      }

      for (const [accountId, adjustment] of balanceAdjustments) {
        if (adjustment !== 0) {
          await this.accountsService.updateBalance(accountId, adjustment);
        }
      }

      // Delete linked transactions first (foreign key order)
      if (linkedIdsToDelete.size > 0) {
        await m
          .createQueryBuilder()
          .delete()
          .from(Transaction)
          .where("id IN (:...ids)", { ids: [...linkedIdsToDelete] })
          .andWhere("userId = :userId", { userId })
          .execute();
      }

      // Delete the primary transactions
      await m
        .createQueryBuilder()
        .delete()
        .from(Transaction)
        .where("id IN (:...ids)", { ids: allIds })
        .andWhere("userId = :userId", { userId })
        .execute();
    });

    // Trigger net worth recalc for all affected accounts
    const affectedAccountIds = new Set(transactions.map((t) => t.accountId));
    for (const accountId of affectedAccountIds) {
      this.netWorthService.triggerDebouncedRecalc(accountId, userId);
    }

    return { deleted: transactions.length };
  }

  private extractUpdateFields(dto: BulkUpdateDto): Partial<Transaction> {
    const fields: Record<string, unknown> = {};

    if ("payeeId" in dto) {
      fields.payeeId = dto.payeeId ?? null;
    }
    if ("payeeName" in dto) {
      fields.payeeName = dto.payeeName ?? null;
    }
    if ("categoryId" in dto) {
      fields.categoryId = dto.categoryId ?? null;
    }
    if ("description" in dto) {
      fields.description = dto.description ?? null;
    }
    if ("status" in dto) {
      fields.status = dto.status;
    }

    return fields as Partial<Transaction>;
  }

  private async resolveTransactionIds(
    userId: string,
    dto: BulkUpdateDto | BulkDeleteDto,
  ): Promise<string[]> {
    if (dto.mode === "ids") {
      if (!dto.transactionIds || dto.transactionIds.length === 0) {
        return [];
      }

      const transactions = await withScopedDb(this.dataSource, (m) =>
        m
          .getRepository(Transaction)
          .createQueryBuilder("transaction")
          .select("transaction.id")
          .where("transaction.id IN (:...ids)", { ids: dto.transactionIds })
          .andWhere("transaction.userId = :userId", { userId })
          .getMany(),
      );

      return transactions.map((t) => t.id);
    }

    // Filter mode
    const transactions = await withScopedDb(this.dataSource, async (m) => {
      const queryBuilder = m
        .getRepository(Transaction)
        .createQueryBuilder("transaction")
        .select("transaction.id")
        .where("transaction.userId = :userId", { userId });

      await this.applyFilters(m, queryBuilder, userId, dto.filters || {});

      if (dto.excludedIds && dto.excludedIds.length > 0) {
        queryBuilder.andWhere("transaction.id NOT IN (:...excludedIds)", {
          excludedIds: dto.excludedIds,
        });
      }

      return queryBuilder.getMany();
    });
    return transactions.map((t) => t.id);
  }

  private async applyExclusions(
    userId: string,
    allIds: string[],
    _isUpdatingPayee: boolean,
    isUpdatingCategory: boolean,
  ): Promise<{
    eligibleIds: string[];
    skipped: number;
    skippedReasons: string[];
  }> {
    // Fetch transaction details needed for exclusion logic
    const transactions = await withScopedDb(this.dataSource, (m) =>
      m
        .getRepository(Transaction)
        .createQueryBuilder("transaction")
        .select([
          "transaction.id",
          "transaction.isTransfer",
          "transaction.isSplit",
        ])
        .where("transaction.id IN (:...ids)", { ids: allIds })
        .andWhere("transaction.userId = :userId", { userId })
        .getMany(),
    );

    const skippedReasons: string[] = [];
    let splitCount = 0;

    const eligibleIds = transactions
      .filter((t) => {
        if (isUpdatingCategory && t.isSplit) {
          splitCount++;
          return false;
        }
        return true;
      })
      .map((t) => t.id);

    if (splitCount > 0) {
      const plural = splitCount !== 1 ? "s" : "";
      skippedReasons.push(
        `${splitCount} split transaction${plural} skipped (split categories must be updated individually)`,
      );
    }

    return {
      eligibleIds,
      skipped: splitCount,
      skippedReasons,
    };
  }

  /**
   * For transfer transactions in the batch, apply payee and description
   * updates to their linked counterparts so both sides stay in sync.
   * Category is NOT synced because each side of a transfer may use
   * different categories (e.g. "Transfer In" vs "Transfer Out").
   */
  private async syncLinkedTransfers(
    m: EntityManager,
    userId: string,
    eligibleIds: string[],
    updateFields: Partial<Transaction>,
  ): Promise<void> {
    // Build the subset of fields that should sync to the linked side
    const syncFields: Record<string, unknown> = {};
    if ("payeeId" in updateFields) syncFields.payeeId = updateFields.payeeId;
    if ("payeeName" in updateFields)
      syncFields.payeeName = updateFields.payeeName;
    if ("description" in updateFields)
      syncFields.description = updateFields.description;

    if (Object.keys(syncFields).length === 0) return;

    const { plainLinkedIds, owningSplitIds } = await this.classifyTransferLegs(
      m,
      userId,
      eligibleIds,
    );

    if (plainLinkedIds.length > 0) {
      await m
        .createQueryBuilder()
        .update(Transaction)
        .set(syncFields as Partial<Transaction>)
        .where("id IN (:...ids)", { ids: plainLinkedIds })
        .andWhere("userId = :userId", { userId })
        .execute();
    }

    // Split-transfer legs mirror the description onto the owning split's memo
    // instead (matching updateSplitTransferLeg); payee changes stay on the leg.
    if ("description" in syncFields && owningSplitIds.length > 0) {
      await m
        .createQueryBuilder()
        .update(TransactionSplit)
        .set({ memo: (syncFields.description as string | null) ?? null })
        .where("id IN (:...ids)", { ids: owningSplitIds })
        .execute();
    }
  }

  /**
   * Mirror a bulk tag change onto transfer counterparts, matching the
   * single-edit flow (the updateTransfer wrapper): plain transfer legs share
   * one tag set with their mirror leg; split-transfer legs mirror the tags
   * onto the owning split's split-level tags (never the split parent).
   */
  private async syncTransferTags(
    m: EntityManager,
    userId: string,
    eligibleIds: string[],
    tagIds: string[],
  ): Promise<void> {
    const { plainLinkedIds, owningSplitIds } = await this.classifyTransferLegs(
      m,
      userId,
      eligibleIds,
    );

    // Mirror legs not already covered by the batch itself.
    const eligibleSet = new Set(eligibleIds);
    const linkedToUpdate = plainLinkedIds.filter((id) => !eligibleSet.has(id));
    if (linkedToUpdate.length > 0) {
      await this.tagsService.setTransactionTagsBulk(
        linkedToUpdate,
        tagIds,
        userId,
      );
    }

    if (owningSplitIds.length > 0) {
      await this.tagsService.setSplitTagsBulk(owningSplitIds, tagIds, userId);
    }
  }

  /**
   * Classify the transfer legs among a batch. A split-transfer leg is owned by
   * a transaction_splits row and its linkedTransactionId points at the split
   * PARENT (whose fields aggregate the whole split) -- syncing there would
   * clobber the parent. A plain transfer leg's linkedTransactionId is its
   * mirror leg, which is safe to sync.
   */
  private async classifyTransferLegs(
    m: EntityManager,
    userId: string,
    eligibleIds: string[],
  ): Promise<{ plainLinkedIds: string[]; owningSplitIds: string[] }> {
    const repo = m.getRepository(Transaction);
    const transfers = await repo
      .createQueryBuilder("t")
      .select(["t.id", "t.linkedTransactionId"])
      .where("t.id IN (:...ids)", { ids: eligibleIds })
      .andWhere("t.userId = :userId", { userId })
      .andWhere("t.isTransfer = true")
      .andWhere("t.linkedTransactionId IS NOT NULL")
      .getMany();

    if (transfers.length === 0) {
      return { plainLinkedIds: [], owningSplitIds: [] };
    }

    const owningSplits = await m.find(TransactionSplit, {
      where: { linkedTransactionId: In(transfers.map((t) => t.id)) },
      select: ["id", "linkedTransactionId"],
    });
    const splitLegIds = new Set(owningSplits.map((s) => s.linkedTransactionId));

    const candidateLinkedIds = transfers
      .filter((t) => !splitLegIds.has(t.id))
      .map((t) => t.linkedTransactionId)
      .filter((id): id is string => id !== null);

    // A cross-owner counterpart belongs to another user; tag ids are per-user
    // reference data, so only same-user linked legs may be synced. (The
    // field sync in syncLinkedTransfers is additionally user-filtered in its
    // UPDATE, but the tag path hands these ids straight to the bulk tag
    // writer.)
    const plainLinkedIds =
      candidateLinkedIds.length === 0
        ? candidateLinkedIds
        : (
            await repo
              .createQueryBuilder("t")
              .select(["t.id"])
              .where("t.id IN (:...ids)", { ids: candidateLinkedIds })
              .andWhere("t.userId = :userId", { userId })
              .getMany()
          ).map((t) => t.id);

    return {
      plainLinkedIds,
      owningSplitIds: owningSplits.map((s) => s.id),
    };
  }

  private async handleStatusBalanceChanges(
    m: EntityManager,
    userId: string,
    eligibleIds: string[],
    newStatus: TransactionStatus,
  ): Promise<void> {
    const isNewVoid = newStatus === TransactionStatus.VOID;

    // Query transactions that will actually change to/from VOID
    const statusCondition = isNewVoid
      ? "transaction.status != :voidStatus"
      : "transaction.status = :voidStatus";

    // Only include non-future transactions in balance changes
    const today = formatDateYMDLocal(new Date());

    const balanceDeltas = await m
      .getRepository(Transaction)
      .createQueryBuilder("transaction")
      .select("transaction.accountId", "accountId")
      .addSelect("SUM(transaction.amount)", "totalAmount")
      .where("transaction.id IN (:...ids)", { ids: eligibleIds })
      .andWhere("transaction.userId = :userId", { userId })
      .andWhere(statusCondition, { voidStatus: TransactionStatus.VOID })
      .andWhere("transaction.transactionDate <= :today", { today })
      .groupBy("transaction.accountId")
      .getRawMany();

    for (const row of balanceDeltas) {
      const amount = Number(row.totalAmount) || 0;
      if (amount === 0) continue;

      if (isNewVoid) {
        // Becoming VOID: subtract amounts from balances
        await this.accountsService.updateBalance(row.accountId, -amount);
      } else {
        // Leaving VOID: add amounts to balances
        await this.accountsService.updateBalance(row.accountId, amount);
      }
    }
  }

  private async triggerNetWorthRecalcForTransactions(
    userId: string,
    transactionIds: string[],
  ): Promise<void> {
    const accountIds = await withScopedDb(this.dataSource, (m) =>
      m
        .getRepository(Transaction)
        .createQueryBuilder("transaction")
        .select("DISTINCT transaction.accountId", "accountId")
        .where("transaction.id IN (:...ids)", { ids: transactionIds })
        .getRawMany(),
    );

    for (const row of accountIds) {
      this.netWorthService.triggerDebouncedRecalc(row.accountId, userId);
    }
  }

  private async applyFilters(
    m: EntityManager,
    queryBuilder: SelectQueryBuilder<Transaction>,
    userId: string,
    filters: BulkUpdateFilterDto,
  ): Promise<void> {
    if (filters.accountIds && filters.accountIds.length > 0) {
      queryBuilder.andWhere("transaction.accountId IN (:...accountIds)", {
        accountIds: filters.accountIds,
      });
    }

    if (filters.startDate) {
      queryBuilder.andWhere("transaction.transactionDate >= :startDate", {
        startDate: filters.startDate,
      });
    }

    if (filters.endDate) {
      queryBuilder.andWhere("transaction.transactionDate <= :endDate", {
        endDate: filters.endDate,
      });
    }

    if (filters.categoryIds && filters.categoryIds.length > 0) {
      await this.applyCategoryFilters(
        m,
        queryBuilder,
        userId,
        filters.categoryIds,
      );
    }

    if (filters.payeeIds && filters.payeeIds.length > 0) {
      queryBuilder.andWhere("transaction.payeeId IN (:...payeeIds)", {
        payeeIds: filters.payeeIds,
      });
    }

    if (filters.search && filters.search.trim()) {
      const searchPattern = `%${escapeLikePattern(filters.search.trim())}%`;
      const parsedSearch = await this.resolveSearchTerm(userId, filters.search);
      if (!filters.categoryIds || filters.categoryIds.length === 0) {
        queryBuilder.leftJoin("transaction.splits", "searchSplits");
        queryBuilder.andWhere(
          buildTransactionSearchClause({
            transaction: "transaction",
            splits: "searchSplits",
          }),
          {
            search: searchPattern,
            searchAmount: parsedSearch.amount,
            searchDate: parsedSearch.date,
          },
        );
      } else {
        queryBuilder.andWhere(
          buildTransactionSearchClause({
            transaction: "transaction",
            splits: "filterSplits",
          }),
          {
            search: searchPattern,
            searchAmount: parsedSearch.amount,
            searchDate: parsedSearch.date,
          },
        );
      }
    }
  }

  private async applyCategoryFilters(
    m: EntityManager,
    queryBuilder: SelectQueryBuilder<Transaction>,
    userId: string,
    categoryIds: string[],
  ): Promise<void> {
    const hasUncategorized = categoryIds.includes("uncategorized");
    const hasTransfer = categoryIds.includes("transfer");
    const regularCategoryIds = categoryIds.filter(
      (id) => id !== "uncategorized" && id !== "transfer",
    );

    let hasCondition = false;

    if (hasUncategorized || hasTransfer || regularCategoryIds.length > 0) {
      if (hasUncategorized) {
        queryBuilder.leftJoin("transaction.account", "filterAccount");
      }

      const uniqueCategoryIds =
        regularCategoryIds.length > 0
          ? await getAllCategoryIdsWithChildren(
              m.getRepository(Category),
              userId,
              regularCategoryIds,
            )
          : [];

      if (uniqueCategoryIds.length > 0) {
        queryBuilder.leftJoin("transaction.splits", "filterSplits");
      }

      queryBuilder.andWhere(
        new Brackets((qb) => {
          if (hasUncategorized) {
            const method = hasCondition ? "orWhere" : "where";
            hasCondition = true;
            qb[method](
              "transaction.categoryId IS NULL AND transaction.isSplit = false AND transaction.isTransfer = false AND filterAccount.accountType != 'INVESTMENT'",
            );
          }
          if (hasTransfer) {
            const method = hasCondition ? "orWhere" : "where";
            hasCondition = true;
            qb[method]("transaction.isTransfer = true");
          }
          if (uniqueCategoryIds.length > 0) {
            const method = hasCondition ? "orWhere" : "where";
            hasCondition = true;
            qb[method](
              new Brackets((inner) => {
                inner
                  .where("transaction.categoryId IN (:...filterCategoryIds)", {
                    filterCategoryIds: uniqueCategoryIds,
                  })
                  .orWhere(
                    "filterSplits.categoryId IN (:...filterCategoryIds)",
                    { filterCategoryIds: uniqueCategoryIds },
                  );
              }),
            );
          }
        }),
      );
    }
  }
}
