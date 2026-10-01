import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { Account, AccountSubType } from "../accounts/entities/account.entity";
import { AccountsService } from "../accounts/accounts.service";
import { lockAccountsForBalanceWrite } from "../common/db/locks";
import { returnedRows } from "../common/db/query-result";
import { withScopedDb } from "../common/db/scoped-db";
import { assertTransactionCurrencyMatchesAccount } from "../common/fx-entry.util";
import { tr } from "../i18n/translate";
import { PayeesService } from "../payees/payees.service";
import { TransactionRulesApplierService } from "../transaction-rules/transaction-rules-applier.service";
import {
  Transaction,
  TransactionStatus,
} from "../transactions/entities/transaction.entity";
import { RULES_BATCH_SIZE } from "./bank-sync.constants";
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
import type { BankImportPlan } from "./bank-transaction-planner";
import { BankSyncAccount } from "./entities/bank-sync-account.entity";

/** A bank balance that passed validation, at the column's money precision. */
export interface NormalizedBankBalance {
  amount: number;
  currencyCode: string;
  referenceDate: string | null;
}

/**
 * The preview the user confirmed no longer describes what the bank says (spec
 * section 7a). A 409 raised before the first write; its own class so the sync
 * that raised it does not record itself as failed: nothing was attempted.
 */
export class BankSyncPlanChangedException extends ConflictException {}

export interface BankSyncWriteInput {
  userId: string;
  bankAccountId: string;
  /** The Monize account the sync read for; the write refuses when the link moved. */
  accountId: string;
  /**
   * The cut-off date (`sync_from_date`) the plan was made against, as read at
   * step 1 of the sync; null when the link had none. The write refuses when the
   * locked row holds another one: rows dated between the two would be planned
   * or dropped by a cut-off the user has since replaced.
   */
  plannedSyncFromDate: string | null;
  /** The account currency the plan was made against; the write refuses when it moved. */
  plannedCurrencyCode: string;
  plan: BankImportPlan;
  /** Null when the bank reported none: the stored balance is left alone. */
  balance: NormalizedBankBalance | null;
  /**
   * The fingerprint of the preview the user confirmed (`planFingerprint`). When
   * set, the write recomputes it from the rows it is about to write, under the
   * row lock, and refuses with `BankSyncPlanChangedException` when it differs.
   */
  expectedFingerprint?: string;
}

export interface BankSyncWriteOutcome {
  imported: number;
  skipped: number;
}

/**
 * The single write transaction of a bank sync (docs/specs/bank-sync.md section 7
 * step 5): the ledger rows, the payees, the transactions, the import rules, the
 * balance and the sync outcome commit together or not at all.
 *
 * **INV-BANKSYNC-001, the mechanism.** Each planned row first claims its ledger
 * row with `INSERT ... ON CONFLICT (account_id, external_key) DO NOTHING
 * RETURNING id`; nothing returned means the bank transaction was imported
 * before, and nothing else is written for it. The ledger is keyed on the Monize
 * account, so the claim holds across reconnects, and the unique index is what
 * makes two concurrent syncs converge.
 *
 * **INV-BANKSYNC-003.** Every row is written in the account's own currency,
 * through `assertTransactionCurrencyMatchesAccount`; the plan already refused a
 * row whose currency differs, and the write refuses the whole batch if the
 * account's currency changed while the bank was being read.
 *
 * **INV-BALANCE-001.** The balance is `AccountsService.recalculateCurrentBalance`
 * over the ledger, in this same transaction and under the account's row lock,
 * so it is right for a row of any date and there is no delta to get wrong. The
 * writer never writes `current_balance` itself.
 *
 * **A rejected sync has not already written.** The link and the account are
 * locked and re-checked before the first insert: a re-link, a new cut-off
 * date, a close or a currency change during the fetch refuses the whole write
 * (409, and `last_success_at` does not move).
 */
@Injectable()
export class BankSyncWriterService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly accountsService: AccountsService,
    private readonly rulesApplier: TransactionRulesApplierService,
    private readonly payeesService: PayeesService,
  ) {}

  async write(input: BankSyncWriteInput): Promise<BankSyncWriteOutcome> {
    const { userId, bankAccountId, accountId, plan } = input;

    return withScopedDb(this.dataSource, async (m) => {
      // 1. The link, under its row lock: a concurrent sync of the same bank
      //    account queues here, and a re-link is refused rather than written
      //    through.
      const link = await m.getRepository(BankSyncAccount).findOne({
        where: { id: bankAccountId, userId },
        lock: { mode: "pessimistic_write" },
      });
      if (!link) {
        throw new NotFoundException(
          tr(
            "errors.bankSync.bankAccountNotFound",
            `Bank account with ID ${bankAccountId} not found`,
            { id: bankAccountId },
          ),
        );
      }
      if (link.accountId !== accountId) {
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

      // 2. The Monize account, locked for a balance write before it is read.
      await lockAccountsForBalanceWrite(m, [accountId], userId);
      const account = await m
        .getRepository(Account)
        .findOne({ where: { id: accountId, userId } });
      if (!account) {
        throw new ConflictException(
          tr(
            "errors.bankSync.linkChanged",
            "The bank account was linked to a different account while it was being read. Nothing was imported; sync again.",
          ),
        );
      }
      if (account.isClosed) {
        throw new BadRequestException(
          tr(
            "errors.bankSync.accountClosed",
            "The linked account is closed. Reopen it or link another account.",
          ),
        );
      }
      if (account.accountSubType === AccountSubType.INVESTMENT_BROKERAGE) {
        throw new BadRequestException(
          tr(
            "errors.bankSync.accountBrokerage",
            "An investment brokerage account cannot receive bank transactions. Link its cash account instead.",
          ),
        );
      }

      // 3. INV-BANKSYNC-003: the account's currency is the row's currency, and
      //    it is still the one the plan was made against.
      const currencyCode = assertTransactionCurrencyMatchesAccount(
        null,
        account.currencyCode,
      );
      if (currencyCode !== input.plannedCurrencyCode.trim().toUpperCase()) {
        throw new ConflictException(
          tr(
            "errors.bankSync.accountCurrencyChanged",
            "The currency of the linked account changed while it was being read. Nothing was imported; sync again.",
          ),
        );
      }

      // 3b. A confirmed preview: what is about to be written is what was shown.
      //     The rows are the planned ones the ledger does not hold yet, read
      //     under the row lock this transaction holds, so a concurrent sync of
      //     the same account has either committed (and its rows are duplicates
      //     now) or waits behind it.
      if (input.expectedFingerprint !== undefined) {
        const ledgerKeys = await findLedgerKeys(
          m,
          userId,
          accountId,
          plan.planned.map((row) => row.externalKey),
        );
        const actual = planFingerprint(
          newPlannedRows(plan.planned, ledgerKeys),
        );
        if (actual !== input.expectedFingerprint) {
          throw new BankSyncPlanChangedException(
            tr(
              "errors.bankSync.planChanged",
              "The bank's data changed since the preview. Nothing was imported; preview again.",
            ),
          );
        }
      }

      // 4. The user's import rules, loaded once for the batch.
      const rules = await this.rulesApplier.loadRulesFor(m, userId, "import");

      // 5. Row by row: claim the ledger row, then write what it promises.
      const created: string[] = [];
      const payeeTextById = new Map<string, string | null>();
      const payeeCache = new Map<string, ResolvedPayee>();
      const dateCounters = new Map<string, number>();
      const baseTime = Date.now();
      let skipped = 0;

      for (const row of plan.planned) {
        const claimed = returnedRows<{ id: string }>(
          await m.query(
            `INSERT INTO bank_sync_imported_transactions
               (user_id, account_id, external_key, booking_date)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (account_id, external_key) DO NOTHING
             RETURNING id`,
            [userId, accountId, row.externalKey, row.transactionDate],
          ),
        );
        if (claimed.length === 0) {
          skipped += 1;
          continue;
        }

        const payee = await this.resolvePayee(
          m,
          userId,
          row.payeeText,
          payeeCache,
        );
        // One millisecond apart per date, as the file import does, so rows of
        // one day keep the order the bank listed them in.
        const counter = dateCounters.get(row.transactionDate) ?? 0;
        dateCounters.set(row.transactionDate, counter + 1);

        const saved = await m.save(
          m.create(Transaction, {
            userId,
            accountId,
            transactionDate: row.transactionDate,
            amount: row.amount,
            currencyCode,
            payeeId: payee.payeeId,
            payeeName: payee.payeeName ?? row.payeeText,
            categoryId: payee.defaultCategoryId,
            description: row.description,
            referenceNumber: row.referenceNumber,
            status: TransactionStatus.CLEARED,
            isSplit: false,
            isTransfer: false,
            createdAt: new Date(baseTime + counter),
          }),
        );
        await m.query(
          `UPDATE bank_sync_imported_transactions
              SET transaction_id = $1
            WHERE id = $2`,
          [saved.id, claimed[0].id],
        );
        created.push(saved.id);
        payeeTextById.set(saved.id, row.payeeText);
      }

      // 6. The import rules over what was created, with the bank's raw payee text.
      for (let start = 0; start < created.length; start += RULES_BATCH_SIZE) {
        await this.rulesApplier.applyToNew(
          m,
          userId,
          created.slice(start, start + RULES_BATCH_SIZE),
          "import",
          { rules, payeeTextById },
        );
      }

      // 7. The balance, from the ledger, in this transaction.
      if (created.length > 0) {
        await this.accountsService.recalculateCurrentBalance(userId, accountId);
      }

      // 8. The outcome, on the row this transaction holds locked.
      await this.recordOutcome(m, input, created.length, skipped);

      return { imported: created.length, skipped };
    });
  }

  /**
   * The payee for a bank counterparty, the way the file import resolves one: an
   * exact name, then an alias pattern (the `PayeesService` lookups the importer
   * shares), else a new payee. An empty counterparty is no payee.
   *
   * The create is one `INSERT ... ON CONFLICT (user_id, name)` so two syncs that
   * meet the same new counterparty converge on one payee rather than one of them
   * failing on the unique key. No action-history entry is written: it is
   * recorded outside a transaction by contract, and the file import records
   * none either.
   */
  private async resolvePayee(
    m: EntityManager,
    userId: string,
    text: string | null,
    cache: Map<string, ResolvedPayee>,
  ): Promise<ResolvedPayee> {
    if (text === null) return NO_PAYEE;
    const cached = cache.get(text);
    if (cached) return cached;

    let resolved = await findExistingPayee(this.payeesService, userId, text);
    if (resolved === null) {
      const rows = returnedRows<{
        id: string;
        name: string;
        default_category_id: string | null;
      }>(
        await m.query(
          `INSERT INTO payees (user_id, name)
           VALUES ($1, $2)
           ON CONFLICT (user_id, name) DO UPDATE SET name = payees.name
           RETURNING id, name, default_category_id`,
          [userId, text],
        ),
      );
      resolved = {
        payeeId: rows[0].id,
        payeeName: rows[0].name,
        defaultCategoryId: rows[0].default_category_id,
        defaultCategoryName: null,
      };
    }
    cache.set(text, resolved);
    return resolved;
  }

  private async recordOutcome(
    m: EntityManager,
    input: BankSyncWriteInput,
    imported: number,
    skipped: number,
  ): Promise<void> {
    const refused = Object.values(input.plan.refused).reduce(
      (sum, count) => sum + count,
      0,
    );
    await m.query(
      `UPDATE bank_sync_accounts
          SET last_synced_at = CURRENT_TIMESTAMP,
              last_success_at = CURRENT_TIMESTAMP,
              last_sync_status = 'succeeded',
              last_sync_error = NULL,
              last_imported_count = $3,
              last_skipped_count = $4,
              last_refused_count = $5
        WHERE id = $1 AND user_id = $2`,
      [input.bankAccountId, input.userId, imported, skipped, refused],
    );
    // A balance the bank did not report leaves the stored one as it was: null is
    // "not reported", never a reason to blank what an earlier sync learned.
    if (input.balance !== null) {
      await m.query(
        `UPDATE bank_sync_accounts
            SET bank_balance = $3,
                bank_balance_currency = $4,
                bank_balance_date = $5
          WHERE id = $1 AND user_id = $2`,
        [
          input.bankAccountId,
          input.userId,
          input.balance.amount,
          input.balance.currencyCode,
          input.balance.referenceDate,
        ],
      );
    }
  }
}
