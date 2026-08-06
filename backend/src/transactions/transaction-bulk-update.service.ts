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
import { TransactionSplitService } from "./transaction-split.service";
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
import { tr } from "../i18n/translate";
import { withScopedDb } from "../common/db/scoped-db";
import { lockTransactionRows } from "../common/db/locks";

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
    @Inject(forwardRef(() => TransactionSplitService))
    private splitService: TransactionSplitService,
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
      isUpdatingStatus ? dto.status : undefined,
    );

    if (eligibleIds.length === 0) {
      return { updated: 0, skipped, skippedReasons };
    }

    // Rows whose status is being changed: the selection plus any transfer
    // counterpart pulled in with it. Declared out here so the post-commit
    // net-worth recalculation covers the counterpart's account as well.
    let statusIds: string[] = eligibleIds;
    // Accounts moved by split-parent counterpart propagation, which only the
    // propagation helper can name.
    const counterpartAccountIds = new Set<string>();

    // Balance changes and the batch update commit in a single transaction.
    await withScopedDb(this.dataSource, async (m) => {
      // A transfer's two legs are one movement of money and must share a
      // status. Selecting one leg and voiding it used to leave the counterpart
      // active: the source's balance was restored and the destination kept the
      // money, so the pair created it outright (audit P5-001, scenario B).
      //
      // The counterpart is folded into the batch BEFORE the balance pass so
      // both legs are voided and both balances adjusted in the same
      // transaction. This is a structural read (which rows are transfer legs,
      // whose counterparts) -- it does not read the statuses the balance pass
      // derives from, so it is safe to run before the lock below.
      statusIds = isUpdatingStatus
        ? await this.expandTransferCounterparts(m, userId, eligibleIds)
        : eligibleIds;

      // Lock every row this batch will write, ascending by id, before anything
      // reads the statuses the VOID adjustment is derived from. One transaction
      // was not enough: handleStatusBalanceChanges aggregates the *current*
      // statuses and the UPDATE that changes them runs afterwards, so without
      // the lock a concurrent single-transaction edit lands in between and the
      // batch applies a delta for a transition that no longer happened. The
      // lock covers the expanded set, not just the selection: both legs of a
      // transfer are written, so both must be frozen or the counterpart reopens
      // the same race.
      if (isUpdatingStatus) {
        await lockTransactionRows(m, statusIds, userId);
      }

      // Step 3: Handle balance adjustments for VOID status changes
      if (isUpdatingStatus) {
        await this.handleStatusBalanceChanges(
          m,
          userId,
          statusIds,
          dto.status!,
        );

        // A selected split PARENT crossing the VOID boundary has to take the
        // counterparts its transfer children created with it.
        // `expandTransferCounterparts` cannot do this: a parent is
        // `isSplit = true, isTransfer = false`, so it finds nothing, and the
        // batch then voided the parent, restored its source balance and left
        // every child-created leg active with the money (recheck RR3-001). The
        // single-update route already goes through this helper, so both now call
        // the same one rather than growing a second copy of the rule.
        for (const affected of await this.propagateSplitParentStatus(
          m,
          userId,
          statusIds,
          dto.status!,
        )) {
          counterpartAccountIds.add(affected);
        }
      }

      // Step 4: Execute batch update for column fields
      if (Object.keys(updateFields).length > 0) {
        // The status column applies to the expanded set; every other field
        // stays on the explicitly selected rows (payee/description mirroring is
        // handled separately by syncLinkedTransfers, and a category or payee
        // belongs to the leg the user picked).
        const { status: statusField, ...nonStatusFields } =
          updateFields as Record<string, unknown>;

        if (Object.keys(nonStatusFields).length > 0) {
          await m
            .createQueryBuilder()
            .update(Transaction)
            .set(nonStatusFields as Partial<Transaction>)
            .where("id IN (:...ids)", { ids: eligibleIds })
            .andWhere("userId = :userId", { userId })
            .execute();
        }

        if (statusField !== undefined) {
          await m
            .createQueryBuilder()
            .update(Transaction)
            .set({ status: statusField } as Partial<Transaction>)
            .where("id IN (:...ids)", { ids: statusIds })
            .andWhere("userId = :userId", { userId })
            .execute();
        }

        // Step 4b: Sync payee/description to linked transfer transactions
        await this.syncLinkedTransfers(m, userId, eligibleIds, updateFields);
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

    // Step 5: Trigger net worth recalc for affected accounts (after commit).
    // Uses the expanded set: a counterpart in another account had its status
    // and balance changed too, so that account's snapshots are stale as well.
    if (isUpdatingStatus) {
      await this.triggerNetWorthRecalcForTransactions(
        userId,
        statusIds,
        // Accounts the split-parent propagation moved. They are not in
        // `statusIds` -- the helper discovered them -- so without this the child's
        // account kept a stale net-worth snapshot beside its corrected balance.
        counterpartAccountIds,
      );
    }

    return {
      updated: eligibleIds.length,
      skipped,
      skippedReasons,
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

    // Every account whose balance this delete touches, including accounts
    // reached only through a linked transfer leg or a split counterpart.
    //
    // The recalculation set used to be built from `transactions` alone, after
    // the commit -- so bulk-deleting one leg of a transfer reversed both live
    // balances correctly but left the counterpart account's monthly net-worth
    // snapshot carrying the deleted amount (audit P5-012). The single-transfer
    // delete path already tracked all affected accounts, which is what showed
    // the intended coverage. Collected inside the transaction, where the linked
    // rows are loaded, and consumed after it commits.
    const affectedAccountIds = new Set<string>(
      transactions.map((t) => t.accountId),
    );

    // Balance adjustments and both delete passes commit atomically.
    let deleted = 0;
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

      // Lock every row about to be deleted -- primary and linked alike --
      // ascending by id, and derive the reversals from the locked values.
      //
      // The `transactions` read above happened before this transaction opened,
      // so its amounts and statuses are a claim about the past. A row another
      // request deleted in the meantime is simply absent from `locked`, and gets
      // no reversal: reversing an amount whose row is already gone is how a
      // double delete leaves the balance 10.00 above the ledger (P4-003).
      const locked = await lockTransactionRows(
        m,
        [...allIds, ...linkedIdsToDelete],
        userId,
      );

      // Every linked leg and split counterpart this delete removes was locked
      // above and lives in `locked`, so its account joins the net-worth
      // fan-out beside the primary rows. The recalculation set used to be the
      // selected rows alone, which left the counterpart account -- reached only
      // through the linked leg -- carrying the deleted amount in its monthly
      // net-worth snapshot beside a corrected live balance (audit P5-012).
      for (const tx of locked.values()) {
        affectedAccountIds.add(tx.accountId);
      }

      const balanceAdjustments = new Map<string, number>();
      for (const tx of locked.values()) {
        if (
          tx.status !== TransactionStatus.VOID &&
          !isTransactionInFuture(tx.transactionDate)
        ) {
          const current = balanceAdjustments.get(tx.accountId) || 0;
          balanceAdjustments.set(tx.accountId, current - tx.amount);
        }
      }

      for (const accountId of [...balanceAdjustments.keys()].sort()) {
        const adjustment = balanceAdjustments.get(accountId)!;
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
      const primaryDeleted = await m
        .createQueryBuilder()
        .delete()
        .from(Transaction)
        .where("id IN (:...ids)", { ids: allIds })
        .andWhere("userId = :userId", { userId })
        .execute();
      // What the database removed, not what the pre-read hoped to remove: a row
      // a concurrent request already deleted must not be counted twice.
      deleted = primaryDeleted.affected ?? 0;
    });

    // Trigger net worth recalc for every affected account, deduplicated.
    for (const accountId of affectedAccountIds) {
      this.netWorthService.triggerDebouncedRecalc(accountId, userId);
    }

    return { deleted };
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
    /**
     * The status being applied, when this is a status update.
     *
     * Needed because a split-transfer leg cannot cross the VOID boundary on its
     * own: `expandTransferCounterparts` deliberately refuses to drag the split
     * PARENT along (that would void unrelated category children), so voiding the
     * leg alone left the parent's split row and total still recording money that
     * left the source and never arrived -- the same inconsistency the single-edit
     * path refuses in `updateSplitTransferLeg`, reached through the bulk path
     * instead. Skipped and reported, matching the split-category skip below.
     */
    newStatus?: TransactionStatus,
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
          "transaction.status",
        ])
        .where("transaction.id IN (:...ids)", { ids: allIds })
        .andWhere("transaction.userId = :userId", { userId })
        .getMany(),
    );

    // Which of the selected rows are a split's transfer counterpart. Only asked
    // when a status change could cross the VOID boundary.
    const transferLegIds = transactions
      .filter((t) => t.isTransfer)
      .map((t) => t.id);
    const splitLegIds = new Set<string>();
    if (newStatus !== undefined && transferLegIds.length > 0) {
      const owningSplits = await withScopedDb(this.dataSource, (m) =>
        m.find(TransactionSplit, {
          where: { linkedTransactionId: In(transferLegIds) },
          select: ["id", "linkedTransactionId"],
        }),
      );
      for (const split of owningSplits) {
        if (split.linkedTransactionId) {
          splitLegIds.add(split.linkedTransactionId);
        }
      }
    }

    const skippedReasons: string[] = [];
    let splitCount = 0;
    let splitLegVoidCount = 0;

    const eligibleIds = transactions
      .filter((t) => {
        if (isUpdatingCategory && t.isSplit) {
          splitCount++;
          return false;
        }
        if (
          newStatus !== undefined &&
          splitLegIds.has(t.id) &&
          (t.status === TransactionStatus.VOID) !==
            (newStatus === TransactionStatus.VOID)
        ) {
          splitLegVoidCount++;
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

    if (splitLegVoidCount > 0) {
      const plural = splitLegVoidCount !== 1 ? "s" : "";
      skippedReasons.push(
        `${splitLegVoidCount} split transfer${plural} skipped (void or restore them from the split transaction they belong to, so both sides change together)`,
      );
    }

    return {
      eligibleIds,
      skipped: splitCount + splitLegVoidCount,
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

  /**
   * The selected ids plus the transfer counterpart of every transfer leg among
   * them, so a status change applies to both halves of one movement of money.
   *
   * A transfer is two rows that must agree: `recalculateCurrentBalance` and
   * every report exclude a VOID row, so a void source with an active
   * destination is money in one account that came from nowhere. Selecting only
   * one leg is the normal case (a filter or a single click in the list), which
   * is why the expansion belongs here rather than in the caller.
   *
   * Split-transfer legs are included too: the leg is a real transaction row in
   * the target account whose balance contribution has to stop with its
   * counterpart's. Only same-user rows are returned -- a cross-owner
   * counterpart is another user's ledger and is not ours to void, and the
   * UPDATE is user-filtered besides.
   */
  private async expandTransferCounterparts(
    m: EntityManager,
    userId: string,
    eligibleIds: string[],
  ): Promise<string[]> {
    const repo = m.getRepository(Transaction);
    const legs = await repo
      .createQueryBuilder("t")
      .select(["t.id", "t.linkedTransactionId"])
      .where("t.id IN (:...ids)", { ids: eligibleIds })
      .andWhere("t.userId = :userId", { userId })
      .andWhere("t.isTransfer = true")
      .andWhere("t.linkedTransactionId IS NOT NULL")
      .getMany();

    if (legs.length === 0) return eligibleIds;

    const selected = new Set(eligibleIds);
    const candidates = legs
      .map((t) => t.linkedTransactionId)
      .filter((id): id is string => id !== null && !selected.has(id));

    if (candidates.length === 0) return eligibleIds;

    // A split-transfer leg's linkedTransactionId points at the split PARENT,
    // whose fields aggregate the whole split -- voiding that would void
    // unrelated category children. Keep the counterpart only when it is a
    // mirror leg, matching how classifyTransferLegs draws the same distinction
    // for field and tag syncing.
    const owningSplits = await m.find(TransactionSplit, {
      where: { linkedTransactionId: In(legs.map((t) => t.id)) },
      select: ["id", "linkedTransactionId"],
    });
    const splitLegIds = new Set(owningSplits.map((s) => s.linkedTransactionId));
    const mirrorIds = legs
      .filter((t) => !splitLegIds.has(t.id))
      .map((t) => t.linkedTransactionId)
      .filter((id): id is string => id !== null && !selected.has(id));

    if (mirrorIds.length === 0) return eligibleIds;

    const sameUser = await repo
      .createQueryBuilder("t")
      .select(["t.id"])
      .where("t.id IN (:...ids)", { ids: mirrorIds })
      .andWhere("t.userId = :userId", { userId })
      .getMany();

    return [...eligibleIds, ...sameUser.map((t) => t.id)];
  }

  /**
   * For every selected split parent whose status crosses the VOID boundary, apply
   * that status to the transfer counterparts its children created, moving each
   * counterpart's balance exactly once.
   *
   * Delegates to `TransactionSplitService.applyParentStatusToTransferCounterparts`
   * -- the same helper the single-transaction update path uses -- inside this
   * batch's transaction, so a bulk void and a single void cannot diverge.
   */
  private async propagateSplitParentStatus(
    m: EntityManager,
    userId: string,
    statusIds: string[],
    newStatus: TransactionStatus,
  ): Promise<Set<string>> {
    const affectedAccountIds = new Set<string>();
    if (statusIds.length === 0) return affectedAccountIds;

    const parents = await m
      .getRepository(Transaction)
      .createQueryBuilder("t")
      .select(["t.id", "t.status"])
      .where("t.id IN (:...ids)", { ids: statusIds })
      .andWhere("t.userId = :userId", { userId })
      .andWhere("t.isSplit = true")
      .getMany();

    const isNewVoid = newStatus === TransactionStatus.VOID;
    for (const parent of parents) {
      if ((parent.status === TransactionStatus.VOID) === isNewVoid) continue;
      // The counterpart accounts are not in `statusIds` -- they are discovered in
      // here -- so they have to be reported back or the batch's net-worth
      // invalidation misses them entirely (recheck RR4-003).
      for (const affected of await this.splitService.applyParentStatusToTransferCounterparts(
        m,
        parent.id,
        userId,
        newStatus,
      )) {
        affectedAccountIds.add(affected);
      }
    }

    return affectedAccountIds;
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
    extraAccountIds: Set<string> = new Set(),
  ): Promise<void> {
    const accountIds = await withScopedDb(this.dataSource, (m) =>
      m
        .getRepository(Transaction)
        .createQueryBuilder("transaction")
        .select("DISTINCT transaction.accountId", "accountId")
        .where("transaction.id IN (:...ids)", { ids: transactionIds })
        .getRawMany(),
    );

    const targets = new Set<string>(extraAccountIds);
    for (const row of accountIds) targets.add(row.accountId);

    for (const accountId of targets) {
      this.netWorthService.triggerDebouncedRecalc(accountId, userId);
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
