import { ConflictException, Injectable } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { Account } from "../accounts/entities/account.entity";
import { withScopedDb } from "../common/db/scoped-db";
import { tr } from "../i18n/translate";
import { PayeesService } from "../payees/payees.service";
import { TransactionRulesApplierService } from "../transaction-rules/transaction-rules-applier.service";
import type { RuleEffectsPreview } from "../transaction-rules/transaction-rules-applier.service";
import { TransactionStatus } from "../transactions/entities/transaction.entity";
import {
  findExistingPayee,
  NO_PAYEE,
  type ResolvedPayee,
} from "./bank-sync-payee-lookup";
import {
  findLedgerKeys,
  newPlannedRows,
  planFingerprint,
} from "./bank-sync-plan-fingerprint";
import type { NormalizedBankBalance } from "./bank-sync-writer.service";
import type {
  BankSyncPreviewRowView,
  BankSyncPreviewView,
} from "./bank-sync.types";
import type {
  ExplainedBankImport,
  PlanEntry,
} from "./bank-transaction-planner";
import { BankSyncAccount } from "./entities/bank-sync-account.entity";

export interface BuildBankSyncPreviewInput {
  userId: string;
  bankAccountId: string;
  /** The Monize account the sync read for. */
  accountId: string;
  /** The cut-off the plan was made against (as read at step 1); null when none. */
  plannedSyncFromDate: string | null;
  /** The account currency the plan was made against. */
  plannedCurrencyCode: string;
  explained: ExplainedBankImport;
  balance: NormalizedBankBalance | null;
}

/** Scaled integer of a money value at the column's four decimals. */
const toUnits = (value: number): number => Math.round(value * 10000);
const fromUnits = (units: number): string => (units / 10000).toFixed(4);

/**
 * The read-only half of step 5 of a sync (docs/specs/bank-sync.md section 7a).
 *
 * It is handed the same `ExplainedBankImport` a sync plans from, so the rows,
 * keys and amounts are the planner's own; it asks the ledger which keys exist
 * (`findLedgerKeys`, the question the sync's fingerprint check asks), resolves the
 * payee through the lookup the writer uses (`findExistingPayee`) and plans the
 * `import` rules through `TransactionRulesApplierService.previewForRow`, the
 * planning path `applyToNew` shares. Nothing is inserted, updated or locked: a
 * preview that wrote would not be a preview.
 *
 * The balance after the import is the current balance plus the sum of the `new`
 * rows, added as scaled integers.
 */
@Injectable()
export class BankSyncPreviewService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly rulesApplier: TransactionRulesApplierService,
    private readonly payeesService: PayeesService,
  ) {}

  async build(input: BuildBankSyncPreviewInput): Promise<BankSyncPreviewView> {
    const { userId, bankAccountId, accountId, explained } = input;
    const { plan, entries } = explained;

    return withScopedDb(this.dataSource, async (m) => {
      // The read the plan stands on must still describe the link: a re-link or a
      // new cut-off during the fetch makes the listing someone else's.
      const link = await m
        .getRepository(BankSyncAccount)
        .findOne({ where: { id: bankAccountId, userId } });
      const account = await m
        .getRepository(Account)
        .findOne({ where: { id: accountId, userId } });
      if (!link || link.accountId !== accountId || !account) {
        throw new ConflictException(
          tr(
            "errors.bankSync.linkChanged",
            "The bank account was linked to a different account while it was being read. Nothing was imported; sync again.",
          ),
        );
      }
      if (link.syncFromDate !== input.plannedSyncFromDate) {
        throw new ConflictException(
          tr(
            "errors.bankSync.cutoffChanged",
            "The cut-off date of the bank account changed while it was being read. Nothing was imported; sync again.",
          ),
        );
      }
      const currencyCode = account.currencyCode.trim().toUpperCase();
      if (currencyCode !== input.plannedCurrencyCode.trim().toUpperCase()) {
        throw new ConflictException(
          tr(
            "errors.bankSync.accountCurrencyChanged",
            "The currency of the linked account changed while it was being read. Nothing was imported; sync again.",
          ),
        );
      }

      const ledgerKeys = await findLedgerKeys(
        m,
        userId,
        accountId,
        plan.planned.map((row) => row.externalKey),
      );
      const newRows = newPlannedRows(plan.planned, ledgerKeys);

      // Rules are read once; a user with none skips the per-row planning, which
      // is what `previewForRow` answers for them too (null).
      const hasImportRules =
        (await this.rulesApplier.loadRulesFor(m, userId, "import")).length > 0;
      const payeeCache = new Map<string, ResolvedPayee | null>();

      const rows: BankSyncPreviewRowView[] = [];
      for (const entry of entries) {
        if (entry.outcome !== "planned") {
          rows.push(this.plainRow(entry, entry.outcome));
        } else if (ledgerKeys.has(entry.externalKey as string)) {
          rows.push(this.plainRow(entry, "duplicate"));
        } else {
          rows.push(
            await this.newRow(
              m,
              userId,
              account,
              entry,
              hasImportRules,
              payeeCache,
            ),
          );
        }
      }

      const refused = Object.values(plan.refused).reduce(
        (sum, count) => sum + count,
        0,
      );
      const newUnits = newRows.reduce(
        (sum, row) => sum + toUnits(row.amount),
        0,
      );
      const monizeUnits = toUnits(Number(account.currentBalance));
      const afterUnits = monizeUnits + newUnits;
      const bank = input.balance;
      const comparable =
        bank !== null && bank.currencyCode.toUpperCase() === currencyCode;

      return {
        bankAccountId,
        currencyCode,
        rows,
        summary: {
          new: newRows.length,
          duplicate: plan.planned.length - newRows.length,
          refused,
          refusedByReason: plan.refused,
          pending: plan.pending,
          beforeCutoff: plan.beforeCutoff,
        },
        monizeBalance: fromUnits(monizeUnits),
        balanceAfter: fromUnits(afterUnits),
        bankBalance:
          bank === null
            ? null
            : {
                amount: bank.amount.toFixed(4),
                currencyCode: bank.currencyCode,
                referenceDate: bank.referenceDate,
              },
        difference: comparable
          ? fromUnits(toUnits(bank.amount) - afterUnits)
          : null,
        planFingerprint: planFingerprint(newRows),
      };
    });
  }

  /** A row with nothing resolved: duplicate, refused, pending or before the cut-off. */
  private plainRow(
    entry: PlanEntry,
    outcome: BankSyncPreviewRowView["outcome"],
  ): BankSyncPreviewRowView {
    return {
      outcome,
      refusalReason: entry.reason,
      transactionDate: entry.transactionDate,
      amount: entry.amount === null ? null : entry.amount.toFixed(4),
      currencyCode: entry.currencyCode,
      payeeText: entry.payeeText,
      description: entry.description,
      referenceNumber: entry.referenceNumber,
      payeeName: null,
      categoryName: null,
      tagNames: [],
    };
  }

  /**
   * A row the sync would write: the payee its counterparty resolves to (or the
   * counterparty's own text when the payee would be created), the payee's
   * default category, and what the `import` rules change on top.
   */
  private async newRow(
    m: EntityManager,
    userId: string,
    account: Account,
    entry: PlanEntry,
    hasImportRules: boolean,
    payeeCache: Map<string, ResolvedPayee | null>,
  ): Promise<BankSyncPreviewRowView> {
    const payee = await this.lookUpPayee(userId, entry.payeeText, payeeCache);
    let payeeName = payee?.payeeName ?? entry.payeeText;
    let categoryId = payee?.defaultCategoryId ?? null;
    let categoryName = payee?.defaultCategoryName ?? null;
    let tagNames: string[] = [];

    const effects: RuleEffectsPreview | null = hasImportRules
      ? await this.rulesApplier.previewForRow(
          m,
          userId,
          {
            accountId: account.id,
            currencyCode: account.currencyCode,
            amount: entry.amount,
            isTransfer: false,
            payeeId: payee?.payeeId ?? null,
            payeeText: entry.payeeText,
            payeeName,
            categoryId,
            description: entry.description,
            tagIds: [],
            hasSplits: false,
            referenceNumber: entry.referenceNumber,
            transactionDate: entry.transactionDate,
            status: TransactionStatus.CLEARED,
            hasAttachment: false,
          },
          "import",
        )
      : null;

    if (effects !== null) {
      const { changes, labels } = effects;
      if (changes.createPayee !== undefined) {
        payeeName = changes.createPayee;
      } else if (changes.payeeId !== undefined) {
        payeeName =
          changes.payeeId === null
            ? null
            : (changes.payeeName ??
              labels.payees[changes.payeeId] ??
              payeeName);
      }
      if (changes.categoryId !== undefined) {
        categoryId = changes.categoryId;
        categoryName =
          changes.categoryId === null
            ? null
            : (labels.categories[changes.categoryId] ?? null);
      }
      const removed = new Set(changes.removeTagIds);
      tagNames = changes.addTagIds
        .filter((id) => !removed.has(id))
        .map((id) => labels.tags[id])
        .filter((name): name is string => name !== undefined);
    }

    return {
      ...this.plainRow(entry, "new"),
      payeeName,
      categoryName: categoryId === null ? null : categoryName,
      tagNames,
    };
  }

  private async lookUpPayee(
    userId: string,
    text: string | null,
    cache: Map<string, ResolvedPayee | null>,
  ): Promise<ResolvedPayee | null> {
    if (text === null) return NO_PAYEE;
    if (cache.has(text)) return cache.get(text) ?? null;
    const found = await findExistingPayee(this.payeesService, userId, text);
    cache.set(text, found);
    return found;
  }
}
