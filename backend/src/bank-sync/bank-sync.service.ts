import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { Account, AccountSubType } from "../accounts/entities/account.entity";
import { addDaysYMD, todayYMD } from "../common/date-utils";
import { ledgerMovementPredicate } from "../common/ledger-balance.sql";
import { withScopedDb } from "../common/db/scoped-db";
import {
  JobClaimService,
  JobClaimType,
} from "../common/jobs/job-claim.service";
import { roundMoney } from "../common/round.util";
import { isCalendarDate } from "../common/validators/is-calendar-date.validator";
import { tr } from "../i18n/translate";
import { NetWorthService } from "../net-worth/net-worth.service";
import {
  DEFAULT_CUTOFF_LOOKBACK_DAYS,
  SYNC_LEASE_TTL_MS,
  SYNC_OVERLAP_DAYS,
} from "./bank-sync.constants";
import type { BankSyncConnectionStatus } from "./bank-sync.constants";
import { BankSyncCredentialsService } from "./bank-sync-credentials.service";
import {
  describeFailureForClient,
  describeSyncFailure,
  storedFailureMessage,
  toBankSyncException,
} from "./bank-sync-errors";
import { toBankSyncAccountView } from "./bank-sync-views";
import { BankSyncWriterService } from "./bank-sync-writer.service";
import type { NormalizedBankBalance } from "./bank-sync-writer.service";
import type {
  BankSyncAccountView,
  BankSyncConnectionSyncEntry,
  BankSyncResult,
} from "./bank-sync.types";
import { planBankImport } from "./bank-transaction-planner";
import type { LinkBankSyncAccountDto } from "./dto/link-bank-sync-account.dto";
import { BankSyncAccount } from "./entities/bank-sync-account.entity";
import { BankSyncConnection } from "./entities/bank-sync-connection.entity";
import type {
  BankBalance,
  BankSyncCredentials,
  PsuContext,
} from "./providers/bank-sync-provider.interface";
import { isBankSyncProviderError } from "./providers/bank-sync-provider.errors";
import { BankSyncProviderRegistry } from "./providers/bank-sync-provider.registry";

/** A signed decimal as a bank reports a balance. */
const BALANCE_AMOUNT_PATTERN = /^-?\d{1,16}(\.\d{1,8})?$/;

/**
 * The window one sync asks the bank for (spec section 7): from the cut-off, or
 * from a week before the last success when that is later, to today. A cut-off in
 * the future is clamped to today, so the request is never inverted and every row
 * it returns is counted as before the cut-off rather than imported.
 */
export function syncWindow(
  link: Pick<BankSyncAccount, "syncFromDate" | "lastSuccessAt">,
  today: string,
): { dateFrom: string; dateTo: string } {
  let dateFrom = link.syncFromDate ?? today;
  if (link.lastSuccessAt) {
    const overlapStart = addDaysYMD(
      link.lastSuccessAt.toISOString().slice(0, 10),
      -SYNC_OVERLAP_DAYS,
    );
    if (overlapStart > dateFrom) dateFrom = overlapStart;
  }
  if (dateFrom > today) dateFrom = today;
  return { dateFrom, dateTo: today };
}

/**
 * A balance from the provider as the value that will be stored, or null when it
 * cannot be trusted: an amount that is not a decimal, or a currency that is not
 * three letters, is "not reported", never a zero.
 */
export function normalizeBankBalance(
  balance: BankBalance | null,
): NormalizedBankBalance | null {
  if (balance === null) return null;
  const amountText = balance.amount.trim();
  const currencyCode = balance.currencyCode.trim().toUpperCase();
  if (
    !BALANCE_AMOUNT_PATTERN.test(amountText) ||
    !/^[A-Z]{3}$/.test(currencyCode)
  ) {
    return null;
  }
  const referenceDate = balance.referenceDate?.trim();
  return {
    amount: roundMoney(Number(amountText)),
    currencyCode,
    referenceDate: isCalendarDate(referenceDate) ? referenceDate : null,
  };
}

function isUniqueViolation(error: unknown): boolean {
  const candidate = error as
    | { code?: unknown; driverError?: { code?: unknown } }
    | null
    | undefined;
  return (candidate?.driverError?.code ?? candidate?.code) === "23505";
}

/** Everything step 1 of a sync reads (spec section 7). */
interface SyncContext {
  link: BankSyncAccount;
  connection: BankSyncConnection;
  account: Account;
  usable: "ok" | "inactive" | "expired";
}

/**
 * Linking a bank account to a Monize account, and syncing one or every linked
 * account of a connection (docs/specs/bank-sync.md sections 7 and 9).
 *
 * **Every refusal precedes the write it would have contradicted.** Linking
 * locks the bank-account row and checks ownership, closure, brokerage,
 * currency and "already linked" inside the transaction that writes the link.
 * A sync reads the connection, the account and the credentials, takes the
 * lease, and only then talks to the bank; the write transaction
 * (`BankSyncWriterService`) re-checks the link under its lock.
 *
 * **The bank is read outside every transaction.** A slow bank holds no
 * connection and no lock; what makes a race correct is the ledger's unique key,
 * and the lease only saves the provider's quota.
 *
 * **A failure is recorded on the bank account**, in its own transaction, and
 * the caller still gets the mapped HTTP error. A provider that says the consent
 * is gone marks the connection `expired`.
 */
@Injectable()
export class BankSyncService {
  private readonly logger = new Logger(BankSyncService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly credentials: BankSyncCredentialsService,
    private readonly registry: BankSyncProviderRegistry,
    private readonly writer: BankSyncWriterService,
    private readonly jobClaims: JobClaimService,
    private readonly netWorth: NetWorthService,
  ) {}

  /**
   * Map a bank account to a Monize account, or (with `accountId: null`) unmap
   * it. Returns the bank account.
   *
   * The cut-off defaults to the day after the newest transaction in the account
   * (capped at today), or today minus DEFAULT_CUTOFF_LOOKBACK_DAYS for an empty one. Changing the
   * account or the cut-off forgets the last success: the window would otherwise
   * start after the old mapping's last read and skip history the new one is
   * owed. The ledger makes the re-read free.
   */
  async linkAccount(
    userId: string,
    bankAccountId: string,
    dto: LinkBankSyncAccountDto,
  ): Promise<BankSyncAccountView> {
    return withScopedDb(this.dataSource, async (m) => {
      const repo = m.getRepository(BankSyncAccount);
      const row = await repo.findOne({
        where: { id: bankAccountId, userId },
        lock: { mode: "pessimistic_write" },
      });
      if (!row) throw this.bankAccountNotFound(bankAccountId);

      if (dto.accountId === null) {
        row.accountId = null;
        return toBankSyncAccountView(await repo.save(row));
      }

      const account = await m
        .getRepository(Account)
        .findOne({ where: { id: dto.accountId, userId } });
      if (!account) {
        throw new BadRequestException(
          tr("errors.bankSync.accountNotFound", "That account was not found."),
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
      if (
        row.currencyCode !== null &&
        row.currencyCode.toUpperCase() !== account.currencyCode.toUpperCase()
      ) {
        throw new BadRequestException(
          tr(
            "errors.bankSync.accountCurrencyMismatch",
            `The bank account is in ${row.currencyCode} but the account is in ${account.currencyCode}. Link an account in the same currency.`,
            {
              bankCurrency: row.currencyCode,
              accountCurrency: account.currencyCode,
            },
          ),
        );
      }
      const taken: unknown[] = await m.query(
        `SELECT 1 FROM bank_sync_accounts WHERE account_id = $1 AND id <> $2`,
        [account.id, row.id],
      );
      if (taken.length > 0) throw this.alreadyLinked();

      const accountChanged = row.accountId !== account.id;
      const requested = dto.syncFromDate?.trim()
        ? dto.syncFromDate.trim()
        : null;
      const cutoff =
        requested ??
        (accountChanged || row.syncFromDate === null
          ? await this.defaultCutoff(m, userId, account.id)
          : row.syncFromDate);

      if (accountChanged || cutoff !== row.syncFromDate) {
        row.lastSuccessAt = null;
        row.lastSyncedAt = null;
        row.lastSyncStatus = null;
        row.lastSyncError = null;
        row.lastImportedCount = 0;
        row.lastSkippedCount = 0;
        row.lastRefusedCount = 0;
      }
      row.accountId = account.id;
      row.syncFromDate = cutoff;
      try {
        return toBankSyncAccountView(await repo.save(row));
      } catch (error) {
        // The partial unique index on account_id: a link that raced this one.
        if (isUniqueViolation(error)) throw this.alreadyLinked();
        throw error;
      }
    });
  }

  /**
   * Sync one bank account (spec section 7). `psu` is the person at the keyboard
   * for a user-present sync and `null` for the daily one. A provider failure is
   * answered with the HTTP exception it maps to.
   */
  async syncAccount(
    userId: string,
    bankAccountId: string,
    psu: PsuContext | null,
  ): Promise<BankSyncResult> {
    try {
      return await this.attemptAccountSync(userId, bankAccountId, psu);
    } catch (error) {
      throw toBankSyncException(error);
    }
  }

  /**
   * The sync itself. A failure is recorded on the bank account and rethrown
   * as it happened, a provider failure still a `BankSyncProviderError`, so a
   * caller that reports failures as data (`syncConnection`) keeps the provider's
   * error kind and `syncAccount` maps it to HTTP.
   */
  private async attemptAccountSync(
    userId: string,
    bankAccountId: string,
    psu: PsuContext | null,
  ): Promise<BankSyncResult> {
    const ctx = await this.loadContext(userId, bankAccountId);
    const { link, connection, account } = ctx;

    // Step 1's refusals, and the credentials, before the lease: nothing has been
    // asked of the bank yet. Each is recorded on the bank account, so the daily
    // sync's failures are visible where the user looks.
    let credentials: BankSyncCredentials;
    try {
      this.assertSyncable(ctx);
      credentials = await this.credentials.resolveCredentials(
        userId,
        connection.provider,
      );
    } catch (error) {
      await this.recordFailure(userId, link, error, false);
      throw error;
    }

    // Step 2: the lease. Losing it is not a failure of the account, so it is not
    // recorded.
    const leaseToken = await this.jobClaims.claimLease(
      JobClaimType.BankSyncAccount,
      userId,
      bankAccountId,
      SYNC_LEASE_TTL_MS,
    );
    if (leaseToken === null) {
      throw new ConflictException(
        tr(
          "errors.bankSync.syncRunning",
          "A sync of this account is already running. Try again in a moment.",
        ),
      );
    }

    try {
      const provider = this.registry.getByName(connection.provider);
      const today = todayYMD();
      const window = syncWindow(link, today);

      // Step 3: read the bank, outside any transaction.
      const rows = await provider.fetchTransactions(
        credentials,
        link.externalAccountId,
        window,
        psu,
      );
      let balance: NormalizedBankBalance | null = null;
      try {
        balance = normalizeBankBalance(
          await provider.fetchBalance(credentials, link.externalAccountId, psu),
        );
      } catch (error) {
        // A balance failure leaves the stored balance as it was.
        this.logger.warn(
          `Bank balance of bank account ${bankAccountId} could not be read: ${describeSyncFailure(error)}`,
        );
      }

      // Step 4: plan.
      const plan = planBankImport(rows, {
        accountCurrencyCode: account.currencyCode,
        syncFromDate: link.syncFromDate ?? today,
        today,
      });

      // Step 5: the one write transaction.
      const written = await this.writer.write({
        userId,
        bankAccountId,
        accountId: account.id,
        plannedSyncFromDate: link.syncFromDate,
        plannedCurrencyCode: account.currencyCode,
        plan,
        balance,
      });

      // Step 6: after the commit, drop what depends on the balance.
      if (written.imported > 0) {
        this.netWorth.triggerDebouncedRecalc(account.id, userId);
      }
      this.logger.log(
        `Bank account ${bankAccountId} synced: ${written.imported} imported, ${written.skipped} already imported`,
      );
      return {
        bankAccountId,
        imported: written.imported,
        skipped: written.skipped,
        refused: plan.refused,
        pending: plan.pending,
        beforeCutoff: plan.beforeCutoff,
        bankBalance:
          balance === null
            ? null
            : {
                amount: balance.amount.toFixed(4),
                currencyCode: balance.currencyCode,
                referenceDate: balance.referenceDate,
              },
      };
    } catch (error) {
      // Step 7.
      const consentGone =
        isBankSyncProviderError(error) && error.kind === "session_expired";
      await this.recordFailure(userId, link, error, consentGone);
      throw error;
    } finally {
      await this.releaseLease(userId, bankAccountId, leaseToken);
    }
  }

  /**
   * Sync every linked bank account of one connection, in turn, and answer with
   * one entry per linked account, in the order they were synced: the result of
   * an account that synced, `{ bankAccountId, error: { code, message } }` for
   * one that did not. One account's failure is recorded on it and the loop goes
   * on, so a partial failure is reported as one instead of as the failure of
   * the whole call (the accounts that did import already moved their balances).
   *
   * It throws only when the connection itself is unusable before any account
   * is attempted: not found, not `active`, its consent lapsed, or no readable
   * credentials. A connection with no linked account answers `[]`.
   */
  async syncConnection(
    userId: string,
    connectionId: string,
    psu: PsuContext | null,
  ): Promise<BankSyncConnectionSyncEntry[]> {
    const { connection, usable, bankAccountIds } = await withScopedDb(
      this.dataSource,
      async (m) => {
        const found = await m
          .getRepository(BankSyncConnection)
          .findOne({ where: { id: connectionId, userId } });
        if (!found) {
          throw new NotFoundException(
            tr(
              "errors.bankSync.connectionNotFound",
              `Bank connection with ID ${connectionId} not found`,
              { id: connectionId },
            ),
          );
        }
        const usable = await this.connectionUsability(m, userId, found);
        const rows = await m.getRepository(BankSyncAccount).find({
          where: { userId, connectionId },
          order: { createdAt: "ASC", id: "ASC" },
        });
        return {
          connection: found,
          usable,
          bankAccountIds: rows
            .filter((row) => row.accountId !== null)
            .map((row) => row.id),
        };
      },
    );
    // Outside the transaction, so a lapse it just recorded is kept.
    this.assertConnectionUsable(connection.status, usable);
    if (bankAccountIds.length === 0) return [];
    // Unreadable credentials fail every account the same way: say so once.
    await this.credentials.resolveCredentials(userId, connection.provider);

    const entries: BankSyncConnectionSyncEntry[] = [];
    for (const bankAccountId of bankAccountIds) {
      try {
        entries.push(await this.attemptAccountSync(userId, bankAccountId, psu));
      } catch (error) {
        entries.push({
          bankAccountId,
          error: describeFailureForClient(error),
        });
        this.logger.warn(
          `Sync of bank account ${bankAccountId} failed: ${describeSyncFailure(error)}`,
        );
      }
    }
    return entries;
  }

  // ---------------------------------------------------------------------------

  /** Step 1: the link, its connection and the Monize account, in one transaction. */
  private async loadContext(
    userId: string,
    bankAccountId: string,
  ): Promise<SyncContext> {
    return withScopedDb(this.dataSource, async (m) => {
      const link = await m
        .getRepository(BankSyncAccount)
        .findOne({ where: { id: bankAccountId, userId } });
      if (!link) throw this.bankAccountNotFound(bankAccountId);
      const account =
        link.accountId === null
          ? null
          : await m
              .getRepository(Account)
              .findOne({ where: { id: link.accountId, userId } });
      if (!account) {
        throw new ConflictException(
          tr(
            "errors.bankSync.notLinked",
            "This bank account is not linked to an account. Link it first.",
          ),
        );
      }
      const connection = await m
        .getRepository(BankSyncConnection)
        .findOne({ where: { id: link.connectionId, userId } });
      if (!connection) throw this.bankAccountNotFound(bankAccountId);

      const usable = await this.connectionUsability(m, userId, connection);
      return { link, connection, account, usable };
    });
  }

  /**
   * Whether a connection can be read now. A lapsed consent is recorded as
   * `expired` in the caller's transaction, so the refusal that follows is backed
   * by the state it names; the UPDATE is conditional, so a re-authorization that
   * started meanwhile is not overwritten.
   */
  private async connectionUsability(
    m: EntityManager,
    userId: string,
    connection: BankSyncConnection,
  ): Promise<SyncContext["usable"]> {
    if (connection.status !== "active") return "inactive";
    if (
      connection.validUntil !== null &&
      connection.validUntil.getTime() <= Date.now()
    ) {
      await m.query(
        `UPDATE bank_sync_connections
            SET status = 'expired'
          WHERE id = $1 AND user_id = $2 AND status = 'active'`,
        [connection.id, userId],
      );
      return "expired";
    }
    return "ok";
  }

  /** Refuse a connection that cannot be read; the message says what to do. */
  private assertConnectionUsable(
    status: BankSyncConnectionStatus,
    usable: SyncContext["usable"],
  ): void {
    if (usable === "expired") {
      throw new ConflictException(
        tr(
          "errors.bankSync.consentExpired",
          "Your consent at the bank has expired or was withdrawn. Renew the connection to keep syncing.",
        ),
      );
    }
    if (usable === "inactive") {
      throw new ConflictException(
        tr(
          "errors.bankSync.connectionNotActive",
          `This bank connection is ${status}. Renew or reconnect it before syncing.`,
          { status },
        ),
      );
    }
  }

  /** Refuse a sync that cannot start; the message says what to do. */
  private assertSyncable(ctx: SyncContext): void {
    this.assertConnectionUsable(ctx.connection.status, ctx.usable);
    if (ctx.account.isClosed) {
      throw new BadRequestException(
        tr(
          "errors.bankSync.accountClosed",
          "The linked account is closed. Reopen it or link another account.",
        ),
      );
    }
    if (ctx.account.accountSubType === AccountSubType.INVESTMENT_BROKERAGE) {
      throw new BadRequestException(
        tr(
          "errors.bankSync.accountBrokerage",
          "An investment brokerage account cannot receive bank transactions. Link its cash account instead.",
        ),
      );
    }
  }

  /** The cut-off for a newly linked account (spec section 7). */
  private async defaultCutoff(
    m: EntityManager,
    userId: string,
    accountId: string,
  ): Promise<string> {
    const today = todayYMD();
    const rows: { newest: string | null }[] = await m.query(
      `SELECT TO_CHAR(MAX(t.transaction_date), 'YYYY-MM-DD') AS newest
         FROM transactions t
        WHERE t.account_id = $1
          AND t.user_id = $2
          AND ${ledgerMovementPredicate("t")}`,
      [accountId, userId],
    );
    const newest = rows[0]?.newest ?? null;
    if (newest === null) {
      return addDaysYMD(today, -DEFAULT_CUTOFF_LOOKBACK_DAYS);
    }
    const dayAfter = addDaysYMD(newest, 1);
    // A future-dated newest row must not push the cut-off past today: the bank's
    // booked rows up to now would all be "before the cut-off".
    return dayAfter > today ? today : dayAfter;
  }

  /**
   * Record a failed sync on the bank account, and (when the provider says the
   * consent is gone) mark the connection `expired`, in one transaction of its
   * own. Never throws: it runs on the way out of a failure and must not replace
   * it.
   */
  private async recordFailure(
    userId: string,
    link: Pick<BankSyncAccount, "id" | "connectionId">,
    error: unknown,
    consentGone: boolean,
  ): Promise<void> {
    const message = storedFailureMessage(error);
    if (!(error instanceof HttpException) && !isBankSyncProviderError(error)) {
      this.logger.error(
        `Bank account ${link.id} sync failed unexpectedly: ${describeSyncFailure(error)}`,
      );
    }
    try {
      await withScopedDb(this.dataSource, async (m) => {
        await m.query(
          `UPDATE bank_sync_accounts
              SET last_synced_at = CURRENT_TIMESTAMP,
                  last_sync_status = 'failed',
                  last_sync_error = $3
            WHERE id = $1 AND user_id = $2`,
          [link.id, userId, message],
        );
        if (consentGone) {
          await m.query(
            `UPDATE bank_sync_connections
                SET status = 'expired', last_error = $3
              WHERE id = $1 AND user_id = $2 AND status = 'active'`,
            [link.connectionId, userId, message],
          );
        }
      });
    } catch (recordError) {
      this.logger.error(
        `Could not record the failed sync of bank account ${link.id}: ${describeSyncFailure(recordError)}`,
      );
    }
  }

  private async releaseLease(
    userId: string,
    bankAccountId: string,
    leaseToken: string,
  ): Promise<void> {
    try {
      await this.jobClaims.releaseLease(
        JobClaimType.BankSyncAccount,
        userId,
        bankAccountId,
        leaseToken,
      );
    } catch (error) {
      // The lease lapses by itself after its TTL; a failed release costs a wait.
      this.logger.warn(
        `Could not release the sync lease of bank account ${bankAccountId}: ${describeSyncFailure(error)}`,
      );
    }
  }

  private bankAccountNotFound(bankAccountId: string): NotFoundException {
    return new NotFoundException(
      tr(
        "errors.bankSync.bankAccountNotFound",
        `Bank account with ID ${bankAccountId} not found`,
        { id: bankAccountId },
      ),
    );
  }

  private alreadyLinked(): BadRequestException {
    return new BadRequestException(
      tr(
        "errors.bankSync.accountAlreadyLinked",
        "That account is already linked to another bank account.",
      ),
    );
  }
}
