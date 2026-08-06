import {
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import {
  DataSource,
  EntityManager,
  EntityTarget,
  ObjectLiteral,
  Repository,
} from "typeorm";
import { withScopedDb } from "../common/db/scoped-db";
import { withPreserveTimestamps } from "../common/db/with-context";
import * as bcrypt from "bcryptjs";
import { createHash, randomUUID } from "crypto";
import { createGzip, gunzip, gzipSync } from "zlib";
import { promisify } from "util";
import {
  deriveDefaultLimitBytes,
  warnIfLimitExceedsMemory,
  resolveByteLimit,
} from "./backup-limits";
import { restoreProcessingGate } from "./restore-processing-gate";

const gunzipAsync = promisify(gunzip);
import {
  ATTACHMENT_STORAGE_PROVIDER,
  AttachmentStorageProvider,
} from "../attachments/storage/attachment-storage.interface";
import { User } from "../users/entities/user.entity";
import { AiEncryptionService } from "../ai/ai-encryption.service";
import { OidcReauthService } from "../auth/oidc/oidc-reauth.service";
import {
  encryptBackup,
  decryptBackup,
  isEncryptedBackup,
  BackupDecryptionError,
} from "./backup-crypto.util";
import { collectRowIdRemap, deepRemapIds } from "./backup-id-remap.util";
import {
  DEFERRED_FK_COLUMNS,
  DEFERRED_FK_REPAIRS,
  RESTORABLE_TABLES,
  RESTORE_PLAN,
} from "./restore-plan";
import { resolveCurrencyMetadata } from "../currencies/currency-metadata";
import { tr } from "../i18n/translate";
import { UserMaintenanceService } from "../common/jobs/user-maintenance.service";
import { gemConfigFingerprint } from "../strategies/gem-signal.service";
import { GemStrategy } from "../strategies/entities/gem-strategy.entity";
import { GemStrategyAsset } from "../strategies/entities/gem-strategy-asset.entity";

export interface RestoreBackupInput {
  compressedData: Buffer;
  password?: string;
  oidcIdToken?: string;
  // Password used to encrypt the backup file. For local users this is usually
  // the same as `password`; if the user rotated their login password since the
  // backup was made, the frontend re-prompts and sends the old one here.
  backupPassword?: string;
}

export interface RestoreResult {
  message: string;
  /** Rows written, keyed by `RestoreStep.countKey`. The client sums these. */
  restored: Record<string, number>;
  /**
   * Attachments whose metadata was deliberately not written because their bytes
   * could not be made reachable -- absent from the sidecar store, failing their
   * recorded checksum, or exported from an instance using a different storage
   * provider. Kept out of `restored` so it is never added into a row total.
   * Omitted when nothing was skipped, so "no field" and "zero" agree.
   */
  skippedAttachments?: number;
}

export class BackupPasswordRequiredError extends BadRequestException {
  constructor(message: string) {
    super({ message, code: "BACKUP_PASSWORD_REQUIRED" });
  }
}

const BACKUP_VERSION = 1;

/**
 * How long an export may sit idle inside its snapshot transaction before the
 * database aborts it.
 *
 * The plain streaming export writes to the client between table reads, so a
 * client that stops draining holds the snapshot open -- and a long-lived
 * `REPEATABLE READ` transaction blocks vacuum from reclaiming dead tuples for
 * the whole database, not just this user's tables. Bounding the idle time turns
 * that from an operational problem into a failed download the user can retry.
 */
const EXPORT_IDLE_TIMEOUT_MS = 60_000;

/**
 * Re-exported from the restore plan, which derives it from the insertion order
 * so the allowlist and the order cannot disagree. Consumed by the coverage guard
 * test (backup-restore.integration.spec.ts), which asserts every live table is
 * either exported or in INTENTIONALLY_EXCLUDED_TABLES.
 */
export { RESTORABLE_TABLES };

/**
 * User-owned tables that are deliberately NOT part of a backup, each with the
 * reason. The coverage guard test asserts every table in the database is either
 * exported (see `getBackedUpTableNames`) or listed here, so adding a new entity
 * forces an explicit decision instead of silently dropping data on restore.
 */
const INTENTIONALLY_EXCLUDED_TABLES: ReadonlySet<string> = new Set([
  "users", // the account row itself; a restore targets an existing user
  "action_history", // undo/redo log, wiped on restore (not undoable to prior state)
  "ai_insights", // regenerable AI cache
  "ai_usage_logs", // usage telemetry, not user content
  "exchange_rates", // global shared reference data, not per-user
  "account_delegates", // cross-user sharing relationship
  "account_delegate_grants", // cross-user sharing relationship
  "delegate_account_favourites", // cross-user sharing state
  "delegate_net_worth_exclusions", // cross-user sharing state (joint accounts)
  "emergency_access_contacts", // cross-user emergency-access config
  "emergency_access_settings", // cross-user emergency-access config
  "oauth_payloads", // transient OIDC state
  // Import working state, not user content: the staged bytes are a decrypted
  // upload with a 24 h TTL, and a job row describes one in-flight import. Both
  // are meaningless after the fact, and the staged file would multiply a
  // backup's size by the size of whatever was last uploaded.
  "import_staged_files",
  "import_jobs",
  // Cron bookkeeping, not user content: one row per already-claimed delivery or
  // lease. Restoring them would re-suppress a reminder the restored account has
  // not been sent, and the sweep drops them after 30 days anyway.
  "job_claims",
  // Deletion bookkeeping for bytes that live outside PostgreSQL. A restore
  // replaces the attachment metadata wholesale, so a tombstone from before it
  // describes an object no restored row references -- and the sweeper will have
  // deleted it long before a restore lands anyway.
  "attachment_blob_tombstones",
  // The occurrence-claim ledger guards *concurrent* posting of the occurrence a
  // schedule is currently due for -- two replicas, or a manual post racing the
  // cron. A restore has no in-flight posting, and the restored schedules get new
  // ids, so their old claims are gone by cascade and no stale row can shadow a
  // live occurrence. What a restore does bring back is next_due_date, which
  // already points past everything the backup had posted.
  "scheduled_transaction_postings",
  "personal_access_tokens", // auth credentials -- never exported
  "refresh_tokens", // auth session tokens -- never exported
  "trusted_devices", // 2FA device registrations -- never exported
  "schema_migrations", // migration bookkeeping (no entity; system table)
]);

/** A reader bound to one export snapshot and one user id (`$1`). */
type ExportRead = (sql: string) => Promise<Record<string, unknown>[]>;

/**
 * One table in the export.
 *
 * `augment` exists for the one table whose contents are not entirely in the
 * database: `attachment_blobs` carries the `database` provider's bytes as rows,
 * and the `local`/`s3` providers' bytes have to be read from the object store and
 * added. Every export path runs it, so no path can quietly produce an artifact
 * missing the bytes.
 */
interface ExportTableQuery {
  key: string;
  sql: string;
  augment?: (
    rows: Record<string, unknown>[],
    read: ExportRead,
  ) => Promise<Record<string, unknown>[]>;
}

/**
 * Whether a produced artifact backs up every attachment it names.
 *
 * A backup that carries an attachment's metadata row but not its bytes is not a
 * backup of that attachment (`docs/backup-restore-contract.md` §4). External
 * bytes can be unreadable or inconsistent at export time (a truncated or replaced
 * object), and a database-provider blob can be missing or wrong for its metadata.
 * The export omits those bytes rather than packaging a lie -- but then the
 * *artifact* is incomplete, and the caller has to know, because an incomplete
 * backup must never be promoted or retained as if it were a complete one.
 */
export interface BackupCompletenessReport {
  complete: boolean;
  /** Attachment metadata rows in the artifact. */
  expectedAttachments: number;
  /** Rows whose bytes are present and consistent. */
  includedAttachments: number;
  /** Rows whose bytes could not be included at all. */
  missingAttachments: number;
  /** Rows whose (database-provider) bytes contradict their own metadata. */
  inconsistentAttachments: number;
}

interface BackupData {
  version: number;
  exportedAt: string;
  currencies: Record<string, unknown>[];
  user_preferences: Record<string, unknown>[];
  user_currency_preferences: Record<string, unknown>[];
  categories: Record<string, unknown>[];
  payees: Record<string, unknown>[];
  payee_aliases: Record<string, unknown>[];
  institutions: Record<string, unknown>[];
  accounts: Record<string, unknown>[];
  tags: Record<string, unknown>[];
  transactions: Record<string, unknown>[];
  transaction_splits: Record<string, unknown>[];
  transaction_attachments: Record<string, unknown>[];
  attachment_blobs: Record<string, unknown>[];
  transaction_tags: Record<string, unknown>[];
  transaction_split_tags: Record<string, unknown>[];
  scheduled_transactions: Record<string, unknown>[];
  scheduled_transaction_splits: Record<string, unknown>[];
  scheduled_transaction_overrides: Record<string, unknown>[];
  securities: Record<string, unknown>[];
  security_prices: Record<string, unknown>[];
  security_documents: Record<string, unknown>[];
  holdings: Record<string, unknown>[];
  investment_transactions: Record<string, unknown>[];
  loan_rate_changes: Record<string, unknown>[];
  loan_scenarios: Record<string, unknown>[];
  security_tags: Record<string, unknown>[];
  budgets: Record<string, unknown>[];
  budget_categories: Record<string, unknown>[];
  budget_periods: Record<string, unknown>[];
  budget_period_categories: Record<string, unknown>[];
  budget_alerts: Record<string, unknown>[];
  custom_reports: Record<string, unknown>[];
  investment_reports: Record<string, unknown>[];
  import_column_mappings: Record<string, unknown>[];
  monthly_account_balances: Record<string, unknown>[];
  auto_backup_settings: Record<string, unknown>[];
  scheduled_transaction_split_tags: Record<string, unknown>[];
  monte_carlo_scenarios: Record<string, unknown>[];
  monte_carlo_cash_flows: Record<string, unknown>[];
  ai_provider_configs: Record<string, unknown>[];
  gem_strategies: Record<string, unknown>[];
  gem_strategy_accounts: Record<string, unknown>[];
  gem_strategy_assets: Record<string, unknown>[];
  gem_strategy_signals: Record<string, unknown>[];
}

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly aiEncryption: AiEncryptionService,
    private readonly oidcReauth: OidcReauthService,
    @Inject(ATTACHMENT_STORAGE_PROVIDER)
    private readonly attachmentStorage: AttachmentStorageProvider,
    private readonly maintenance: UserMaintenanceService,
  ) {}

  /**
   * Ceiling on a restore's decompressed payload (see backup-limits.ts).
   * Read per call rather than cached in the constructor: it is consulted once
   * per restore, so the cost is nothing, and a limit that can only be observed
   * at construction time is a limit no test can vary.
   *
   * The default is derived from this container's memory limit, not fixed. A
   * ceiling larger than the process it protects cannot fire -- the pod is killed
   * first -- and that is exactly what a hardcoded 1 GiB default was on the
   * chart's 400 MiB backend.
   */
  get restoreExpandedLimitBytes(): number {
    return this.resolveBackupLimit(
      "BACKUP_RESTORE_EXPANDED_LIMIT",
      process.env.BACKUP_RESTORE_EXPANDED_LIMIT,
    );
  }

  /** Ceiling on the JSON a buffered export may accumulate. */
  get exportBufferLimitBytes(): number {
    return this.resolveBackupLimit(
      "BACKUP_EXPORT_BUFFER_LIMIT",
      process.env.BACKUP_EXPORT_BUFFER_LIMIT,
    );
  }

  /**
   * One resolution path for both ceilings: the operator's value if they set one,
   * otherwise a share of the container's memory limit, and a warning either way
   * when the number cannot protect the process it is meant to protect.
   */
  private resolveBackupLimit(name: string, raw: string | undefined): number {
    const limit = resolveByteLimit(raw, deriveDefaultLimitBytes(), (message) =>
      this.logger.warn(message),
    );
    warnIfLimitExceedsMemory(name, limit, (message) =>
      this.logger.warn(message),
    );
    return limit;
  }

  /**
   * One repository call in its own short scoped transaction -- the RLS-era
   * replacement for the injected repositories this class used to hold, with the
   * same autocommit boundary each of those calls had. Multi-statement units use
   * an explicit `withScopedDb` block so their statements share one transaction.
   */
  private scoped<E extends ObjectLiteral, T>(
    entity: EntityTarget<E>,
    fn: (repo: Repository<E>) => Promise<T>,
  ): Promise<T> {
    return withScopedDb(this.dataSource, (manager) =>
      fn(manager.getRepository(entity)),
    );
  }

  /**
   * Resolves the password the auto-backup cron should use for encryption.
   * Returns null when encryption is disabled or no password is stored.
   */
  resolveStoredBackupPassword(user: User): string | null {
    if (!user.backupEncryptionEnabled || !user.backupPasswordEnc) {
      return null;
    }
    try {
      return this.aiEncryption.decrypt(user.backupPasswordEnc);
    } catch (err) {
      this.logger.error(
        `Failed to decrypt stored backup password for user ${user.id}: ${err.message}`,
      );
      return null;
    }
  }

  /**
   * Produces the full backup file as a Buffer -- gzipped JSON, optionally
   * encrypted -- alongside a report of whether every attachment's bytes made it
   * in. Used by the auto-backup path, which must not promote or retain an
   * incomplete artifact as if it were complete.
   */
  async exportToBuffer(
    userId: string,
    encryptionPassword?: string,
  ): Promise<{ buffer: Buffer; report: BackupCompletenessReport }> {
    const { buffer, report } = await this.collectGzippedExport(userId);
    return {
      buffer: encryptionPassword
        ? await encryptBackup(buffer, encryptionPassword)
        : buffer,
      report,
    };
  }

  async streamExport(
    userId: string,
    res: import("express").Response,
    encryptionPassword?: string,
  ): Promise<void> {
    this.logger.log(
      `Starting backup export for user ${userId}${encryptionPassword ? " (encrypted)" : ""}`,
    );

    // Encrypted exports require the full payload up-front to compute the GCM
    // auth tag, so we buffer JSON in memory before encrypting. Plain exports
    // pipe through gzip instead, which avoids holding the whole *compressed*
    // artifact -- but not the whole dataset: each table is still read into an
    // array and serialised with one `JSON.stringify`, and every carried
    // attachment is base64-encoded into one array before that. Peak memory
    // therefore tracks dataset size, not chunk size (F3RB-006, issue #1070, whose
    // closure needs a cursor inside the snapshot and per-attachment
    // encoding). Do not read this path as bounded.
    if (encryptionPassword) {
      const { buffer, report } = await this.collectGzippedExport(userId);
      // Nothing has been sent yet, so the incompleteness can be *in the
      // response* rather than only in the log (F3RB-004).
      this.warnIfIncompleteExport(userId, report);
      this.markIncompleteExport(res, report);
      const encrypted = await encryptBackup(buffer, encryptionPassword);
      res.write(encrypted);
      res.end();
      this.logger.log(`Backup export completed for user ${userId} (encrypted)`);
      return;
    }

    const tableQueries = this.getTableQueries();

    // Write JSON through gzip to the response one table at a time. This bounds
    // the compressed output and the number of tables held at once -- it does NOT
    // bound one table, or the carried attachment set (F3RB-006).
    const gzip = createGzip();
    let responseAbort: Error | null = null;
    const abortResponse = (error: Error): void => {
      if (responseAbort === null) responseAbort = error;
      // Rejecting the pending operation releases the snapshot transaction; the
      // transform is destroyed separately so it cannot retain buffered output.
      if (!gzip.destroyed) gzip.destroy();
    };
    const onResponseClose = (): void => {
      if (!res.writableFinished) {
        abortResponse(
          new Error("Backup export response closed before completion"),
        );
      }
    };
    const onResponseError = (error: Error): void => abortResponse(error);
    res.once("close", onResponseClose);
    res.once("error", onResponseError);

    /**
     * One gzip operation that cannot wait forever after the response disappears.
     * The write callback replaces a naked `drain` wait: `close` and `error` reject
     * it, so `inExportSnapshot` unwinds and withScopedDb releases the transaction.
     */
    const gzipOperation = (
      start: (done: (error?: Error | null) => void) => void,
    ): Promise<void> =>
      new Promise((resolve, reject) => {
        if (responseAbort !== null) {
          reject(responseAbort);
          return;
        }
        let settled = false;
        const cleanup = (): void => {
          res.off("close", onClose);
          res.off("error", onError);
          gzip.off("error", onError);
        };
        const done = (error?: Error | null): void => {
          if (settled) return;
          settled = true;
          cleanup();
          if (error) reject(error);
          else resolve();
        };
        const onClose = (): void =>
          done(
            responseAbort ??
              new Error("Backup export response closed before completion"),
          );
        const onError = (error: Error): void => done(error);
        res.once("close", onClose);
        res.once("error", onError);
        gzip.once("error", onError);
        try {
          start(done);
        } catch (error) {
          done(error instanceof Error ? error : new Error(String(error)));
        }
      });

    const write = (chunk: string): Promise<void> =>
      gzipOperation((done) => {
        gzip.write(chunk, done);
      });

    let completed = false;
    try {
      const preRead = new Map<string, Record<string, unknown>[]>();
      await this.inExportSnapshot(userId, async (read) => {
        // Read the two attachment tables BEFORE the first byte goes out, so
        // completeness can be signalled in the response headers rather than only
        // in the log (F3RB-004). This costs no extra memory: both arrays were
        // already retained for the end-of-stream assessment, so the only change
        // is the order in which they are read inside the same snapshot.
        for (const entry of tableQueries) {
          if (
            entry.key === "transaction_attachments" ||
            entry.key === "attachment_blobs"
          ) {
            preRead.set(entry.key, await this.readTable(read, entry));
          }
        }
        const attachments = preRead.get("transaction_attachments") ?? [];
        const blobs = preRead.get("attachment_blobs") ?? [];
        const report = this.assessAttachmentCompleteness(attachments, blobs);
        this.warnIfIncompleteExport(userId, report);
        this.markIncompleteExport(res, report);

        // Only now does anything reach the socket, so the headers above are still
        // mutable.
        gzip.pipe(res);
        await write(
          `{"version":${BACKUP_VERSION},"exportedAt":"${new Date().toISOString()}"`,
        );

        for (const entry of tableQueries) {
          const rows =
            preRead.get(entry.key) ?? (await this.readTable(read, entry));
          await write(`,"${entry.key}":${JSON.stringify(rows)}`);
        }

        await write("}");
      });

      await gzipOperation((done) => {
        gzip.end(() => done());
      });
      completed = true;
    } finally {
      res.off("close", onResponseClose);
      res.off("error", onResponseError);
      if (!completed && !gzip.destroyed) gzip.destroy();
    }

    this.logger.log(`Backup export completed for user ${userId}`);
  }

  /**
   * Tell the client, in the response itself, that this artifact is incomplete
   * (F3RB-004).
   *
   * A download that the backend knows cannot restore everything it names used to
   * arrive as an ordinary 200 with the ordinary filename and an ordinary success
   * toast -- so a user could delete the source system on the strength of it. The
   * bytes are still sent, deliberately: a partial artifact is worth more than no
   * artifact when the alternative is losing the rest too. What changes is that it
   * cannot be mistaken for a complete one.
   *
   * Headers rather than the body because the body is a gzip/encrypted stream with
   * no place to put a status, and because this must work for the streaming path
   * where nothing can be added afterwards. `Content-Disposition` is rewritten so
   * the file on disk carries the warning too -- a header is invisible six months
   * later, a filename is not. Called before the first byte on both paths.
   */
  private markIncompleteExport(
    res: import("express").Response,
    report: BackupCompletenessReport,
  ): void {
    if (report.complete) return;
    res.setHeader("X-Backup-Complete", "false");
    res.setHeader(
      "X-Backup-Attachments-Expected",
      String(report.expectedAttachments),
    );
    res.setHeader(
      "X-Backup-Attachments-Included",
      String(report.includedAttachments),
    );
    res.setHeader(
      "X-Backup-Attachments-Missing",
      String(report.missingAttachments),
    );
    res.setHeader(
      "X-Backup-Attachments-Inconsistent",
      String(report.inconsistentAttachments),
    );
    // CORS: a browser cannot read a custom response header unless it is exposed.
    res.setHeader(
      "Access-Control-Expose-Headers",
      [
        "Content-Disposition",
        "X-Backup-Complete",
        "X-Backup-Attachments-Expected",
        "X-Backup-Attachments-Included",
        "X-Backup-Attachments-Missing",
        "X-Backup-Attachments-Inconsistent",
      ].join(", "),
    );

    const disposition = res.getHeader("Content-Disposition");
    if (typeof disposition === "string") {
      res.setHeader(
        "Content-Disposition",
        disposition.replace(
          /filename="([^"]+?)(\.json\.gz|\.mzbe)"/,
          'filename="$1-INCOMPLETE$2"',
        ),
      );
    }
  }

  /** Logs an incomplete manual export; the auto-backup path acts on it instead. */
  private warnIfIncompleteExport(
    userId: string,
    report: BackupCompletenessReport,
  ): void {
    if (report.complete) return;
    this.logger.warn(
      `Backup export for user ${userId} is incomplete: ` +
        `${report.missingAttachments} attachment(s) could not be included and ` +
        `${report.inconsistentAttachments} did not match their metadata, of ` +
        `${report.expectedAttachments} total. The artifact is not a complete ` +
        `backup of those attachments.`,
    );
  }

  /**
   * Runs `fn` with a reader bound to one consistent database snapshot.
   *
   * Every table query used to open its own short transaction, so the export saw
   * a different committed state per table -- and a backup taken while the user
   * was active could contain a child without its parent. Add an account and a
   * transaction for it between the `accounts` query and the `transactions`
   * query, and the artifact holds the transaction alone: valid gzip, valid
   * envelope, and a restore that fails on `transactions.account_id`. Other
   * interleavings drop dependent rows with no error at all.
   *
   * `REPEATABLE READ` fixes the snapshot at the transaction's first statement,
   * so every table is read as of one instant. READ COMMITTED would not do, even
   * inside a single transaction: it takes a fresh snapshot per statement, which
   * is the same problem with fewer transactions.
   *
   * The cost is a transaction held for the length of the export -- for the
   * streaming path, for the length of the download. That is one pooled
   * connection and a held xmin, which is the price of a backup that restores.
   */
  private inExportSnapshot<T>(
    userId: string,
    fn: (
      read: (sql: string) => Promise<Record<string, unknown>[]>,
    ) => Promise<T>,
  ): Promise<T> {
    return withScopedDb(
      this.dataSource,
      async (manager) => {
        // Bound how long this REPEATABLE READ snapshot may sit idle. The
        // streaming export holds the transaction open for as long as the client
        // takes to drain, and a long-lived transaction blocks vacuum from
        // reclaiming dead tuples across the whole database, not just this user's
        // tables. EXPORT_IDLE_TIMEOUT_MS turns a stalled download into an aborted
        // transaction the user can retry rather than an operational problem
        // (audit DR-04). `true` scopes the setting to this transaction.
        await manager.query(
          "SELECT set_config('idle_in_transaction_session_timeout', $1, true)",
          [String(EXPORT_IDLE_TIMEOUT_MS)],
        );
        return fn((sql) => manager.query(sql, [userId]));
      },
      "REPEATABLE READ",
    );
  }

  /**
   * The set of tables the export writes (and the restore repopulates). Exposed
   * so the coverage guard test can assert every database table is either backed
   * up or explicitly excluded (see INTENTIONALLY_EXCLUDED_TABLES).
   */
  getBackedUpTableNames(): string[] {
    return this.getTableQueries().map((q) => q.key);
  }

  /** The tables deliberately omitted from backups, exposed for the guard test. */
  getIntentionallyExcludedTableNames(): string[] {
    return Array.from(INTENTIONALLY_EXCLUDED_TABLES);
  }

  /**
   * Collects the full export as an in-memory map of table -> rows, using the
   * same queries as the streamed/gzipped export. Consumed by the support
   * (de-identified) backup, which must hold every table at once to reconcile
   * scaled balances before serializing. Returns the same version/exportedAt
   * envelope fields the file format uses.
   */
  async collectRawExport(
    userId: string,
    options: { skipTables?: ReadonlySet<string> } = {},
  ): Promise<{
    version: number;
    exportedAt: string;
    tables: Record<string, Record<string, unknown>[]>;
  }> {
    const tables: Record<string, Record<string, unknown>[]> = {};
    await this.inExportSnapshot(userId, async (read) => {
      for (const entry of this.getTableQueries()) {
        const key = entry.key;
        // A caller that will discard a table must not pay to load it. The
        // support backup always excludes `attachment_blobs`, which is base64 --
        // thirty 10 MiB receipts are ~400 MiB of text, the whole of the chart's
        // default backend limit, fetched and thrown away before any ceiling was
        // consulted. Skipping the query is the only fix that helps: a budget
        // checked after the allocation is a budget checked too late.
        if (options.skipTables?.has(key)) continue;
        tables[key] = await this.readTable(read, entry);
      }
    });
    return {
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      tables,
    };
  }

  /** Reads one export table, applying its augmentation if it has one. */
  private async readTable(
    read: ExportRead,
    entry: ExportTableQuery,
  ): Promise<Record<string, unknown>[]> {
    const rows = await read(entry.sql);
    return entry.augment ? await entry.augment(rows, read) : rows;
  }

  /**
   * Adds the `local` and `s3` providers' attachment bytes to `attachment_blobs`.
   *
   * **A backup that cannot restore an attachment is not a backup of it.** Only
   * `database`-provider bytes used to travel; for `local` and `s3` the artifact
   * carried metadata and the operator was told to restore the sidecar volume or
   * bucket alongside it. That works only while the *target* database still holds
   * the matching row, because the restore has to prove the caller is entitled to
   * read the object before it reads it -- and after the ownership fix, the proof
   * is a current `transaction_attachments` row. So the two cases backups exist for
   * both failed: a fresh instance has no such row, and an account whose
   * attachment was deleted has no such row either. The restore reported success
   * and counted the attachment as skipped.
   *
   * There is no way to fix that with a better ownership check. An identifier, a
   * size and a hash in an uploaded document cannot establish a right to read an
   * object, however they are combined -- that is what the last two rounds
   * established. The only thing that can is the bytes being *in* the artifact the
   * user downloaded, which is what this does.
   *
   * What it costs: the artifact grows by the size of the attachments, and this
   * method accumulates every carried object in memory before serialization. On the
   * encrypted, automatic and support paths that is bounded by
   * `BACKUP_EXPORT_BUFFER_LIMIT`, so a large attachment set is refused with the
   * readable error rather than silently producing a file whose attachments cannot
   * come back. **The plain export is *not* bounded** -- it was the streaming path,
   * and this accumulation is a real hole in that claim (F3R6-001). Fixing it is the
   * same cursor/one-object-at-a-time work as bounding the large-table reads
   * (`docs/backup-restore-contract.md`, still open); until then, a plain export of
   * a very large attachment set can exceed the pod. The bytes must travel for the
   * backup to be a backup, so the accumulation is a known cost, not a regression to
   * revert.
   *
   * Two things are checked, not just loaded. An object the store cannot produce is
   * logged and omitted -- the ledger is the point of a backup, and refusing the
   * whole file over one unreadable receipt would leave the user with nothing. And
   * an object whose bytes no longer match the size and SHA-256 the server recorded
   * for it is also omitted (`storedBytesMatchMetadata`): export is the last moment
   * to notice the source is already corrupt, and packaging bytes the restore will
   * refuse would report a success the artifact cannot honour.
   */
  private async appendExternalAttachmentBytes(
    rows: Record<string, unknown>[],
    read: ExportRead,
  ): Promise<Record<string, unknown>[]> {
    const provider = this.attachmentStorage.name;
    // The `database` provider's bytes are already in the rows the query returned.
    if (provider === "database") return rows;

    const metadata = await read(
      `SELECT id, storage_provider, byte_size, sha256
         FROM transaction_attachments
        WHERE user_id = $1
        ORDER BY id`,
    );

    const carried: Record<string, unknown>[] = [];
    let unreadable = 0;
    let inconsistent = 0;
    for (const row of metadata) {
      // Rows written by a different backend than this runtime configures cannot
      // be read from here at all; they keep travelling as metadata only.
      if (String(row.storage_provider ?? "") !== provider) continue;
      const id = String(row.id ?? "");
      let bytes: Buffer;
      try {
        bytes = await this.attachmentStorage.load(id);
      } catch {
        unreadable += 1;
        continue;
      }
      // The object must match the size and hash the server recorded for it. This
      // is the last moment the discrepancy can be seen: the restore checks the
      // same thing (`carriedBytesMatchMetadata`) and would drop the row, but by
      // then the export has reported success and the user believes the receipt is
      // safe. So a source object that no longer matches its metadata -- truncated,
      // replaced, silently corrupted in the volume or bucket -- is omitted here
      // and never packaged. The metadata is the server's own record; the bytes
      // are what the store returned, so this compares the store against the
      // database rather than the file against itself.
      if (!this.storedBytesMatchMetadata(bytes, row)) {
        inconsistent += 1;
        continue;
      }
      carried.push({ attachment_id: id, data: bytes.toString("base64") });
    }

    if (unreadable > 0) {
      this.logger.warn(
        `Backup export could not read ${unreadable} attachment object(s) from the ` +
          `${provider} store; their metadata travels without bytes and they will ` +
          `not be restorable.`,
      );
    }
    if (inconsistent > 0) {
      this.logger.warn(
        `Backup export found ${inconsistent} attachment object(s) in the ${provider} ` +
          `store whose bytes no longer match their recorded size or checksum; they ` +
          `are omitted and will not be restorable from this artifact.`,
      );
    }
    if (carried.length > 0) {
      this.logger.log(
        `Backup export carried ${carried.length} external attachment object(s) ` +
          `from the ${provider} store.`,
      );
    }
    // Immutability: a new array rather than pushing into the caller's.
    return [...rows, ...carried];
  }

  private getTableQueries(): Array<ExportTableQuery> {
    return [
      {
        // Every currency this user's data depends on, not just the ones they
        // created. Currencies are shared: any user may activate a code another
        // user defined, so `created_by_user_id = $1` exported the references
        // without the definition. On a fresh instance the restore then
        // synthesised name, symbol and decimal places from a fallback -- `PTS /
        // Family Points / * / 0 decimals` came back as `PTS / PTS / PTS / 2
        // decimals`, so a balance of 7 rendered `PTS 7.00` instead of `*7`. The
        // amounts were right; what they meant was not.
        //
        // Canonical currencies are included too. Their metadata usually resolves
        // from the curated catalog anyway, but exporting the row costs one line
        // and makes the restore reproduce what the source instance actually had
        // rather than what this instance would guess. `ON CONFLICT (code) DO
        // NOTHING` means an existing row on the target always wins, so this can
        // never overwrite a definition the target already holds.
        //
        // The referencing columns live in `currency_codes_referenced_by_user`
        // (migration 137) rather than being spelled out here: this list has
        // drifted before, and currency-references.spec.ts checks the function
        // against the schema.
        key: "currencies",
        sql: `SELECT * FROM currencies
               WHERE created_by_user_id = $1
                  OR code IN (SELECT currency_codes_referenced_by_user($1))
               ORDER BY code`,
      },
      {
        key: "user_preferences",
        sql: "SELECT * FROM user_preferences WHERE user_id = $1",
      },
      {
        key: "user_currency_preferences",
        sql: "SELECT * FROM user_currency_preferences WHERE user_id = $1",
      },
      {
        key: "categories",
        sql: "SELECT * FROM categories WHERE user_id = $1 ORDER BY parent_id NULLS FIRST, name",
      },
      {
        key: "payees",
        sql: "SELECT * FROM payees WHERE user_id = $1 ORDER BY name",
      },
      {
        key: "payee_aliases",
        sql: "SELECT * FROM payee_aliases WHERE user_id = $1",
      },
      {
        // Institutions must be exported (and restored) before accounts because
        // accounts.institution_id has an FK to institutions(id). The logo_data
        // BYTEA column is base64-encoded so it survives JSON serialization;
        // insertRows decodes it back to bytea on restore.
        key: "institutions",
        sql: `SELECT id, user_id, name, website, country,
                     encode(logo_data, 'base64') AS logo_data,
                     logo_content_type, has_logo, logo_fetched_at,
                     created_at, updated_at
              FROM institutions WHERE user_id = $1 ORDER BY name`,
      },
      {
        key: "accounts",
        sql: "SELECT * FROM accounts WHERE user_id = $1 ORDER BY name",
      },
      {
        key: "tags",
        sql: "SELECT * FROM tags WHERE user_id = $1 ORDER BY name",
      },
      {
        key: "transactions",
        sql: "SELECT * FROM transactions WHERE user_id = $1 ORDER BY transaction_date, created_at",
      },
      {
        key: "transaction_splits",
        sql: `SELECT ts.* FROM transaction_splits ts
              JOIN transactions t ON ts.transaction_id = t.id
              WHERE t.user_id = $1`,
      },
      {
        // Attachment metadata. Restored after transactions (FK) and before
        // attachment_blobs (which references transaction_attachments).
        key: "transaction_attachments",
        sql: "SELECT * FROM transaction_attachments WHERE user_id = $1",
      },
      {
        // Attachment bytes, base64-encoded so they survive JSON; insertRows
        // decodes them back to bytea on restore (auto-detected via
        // information_schema).
        //
        // The query covers the `database` provider, whose bytes are in this
        // table. `augment` adds the `local` and `s3` providers', which are not --
        // see `appendExternalAttachmentBytes` for why they have to travel too.
        key: "attachment_blobs",
        sql: `SELECT ab.attachment_id, encode(ab.data, 'base64') AS data
              FROM attachment_blobs ab
              JOIN transaction_attachments ta ON ab.attachment_id = ta.id
              WHERE ta.user_id = $1`,
        augment: (rows, read) => this.appendExternalAttachmentBytes(rows, read),
      },
      {
        key: "transaction_tags",
        sql: `SELECT tt.* FROM transaction_tags tt
              JOIN transactions t ON tt.transaction_id = t.id
              WHERE t.user_id = $1`,
      },
      {
        key: "transaction_split_tags",
        sql: `SELECT tst.* FROM transaction_split_tags tst
              JOIN transaction_splits ts ON tst.transaction_split_id = ts.id
              JOIN transactions t ON ts.transaction_id = t.id
              WHERE t.user_id = $1`,
      },
      {
        key: "scheduled_transactions",
        sql: "SELECT * FROM scheduled_transactions WHERE user_id = $1",
      },
      {
        key: "scheduled_transaction_splits",
        sql: `SELECT sts.* FROM scheduled_transaction_splits sts
              JOIN scheduled_transactions st ON sts.scheduled_transaction_id = st.id
              WHERE st.user_id = $1`,
      },
      {
        key: "scheduled_transaction_overrides",
        sql: `SELECT sto.* FROM scheduled_transaction_overrides sto
              JOIN scheduled_transactions st ON sto.scheduled_transaction_id = st.id
              WHERE st.user_id = $1`,
      },
      {
        key: "scheduled_transaction_split_tags",
        sql: `SELECT stst.* FROM scheduled_transaction_split_tags stst
              JOIN scheduled_transaction_splits sts ON stst.scheduled_transaction_split_id = sts.id
              JOIN scheduled_transactions st ON sts.scheduled_transaction_id = st.id
              WHERE st.user_id = $1`,
      },
      { key: "securities", sql: "SELECT * FROM securities WHERE user_id = $1" },
      {
        key: "security_prices",
        sql: `SELECT sp.* FROM security_prices sp
              JOIN securities s ON sp.security_id = s.id
              WHERE s.user_id = $1`,
      },
      {
        key: "security_documents",
        sql: "SELECT * FROM security_documents WHERE user_id = $1",
      },
      {
        key: "holdings",
        sql: `SELECT h.* FROM holdings h
              JOIN accounts a ON h.account_id = a.id
              WHERE a.user_id = $1`,
      },
      {
        key: "investment_transactions",
        sql: "SELECT * FROM investment_transactions WHERE user_id = $1",
      },
      {
        // Join tags between securities and tags. Owned transitively via the
        // securities/tags rows, so scope by the security's owner.
        key: "security_tags",
        sql: `SELECT st.* FROM security_tags st
              JOIN securities s ON st.security_id = s.id
              WHERE s.user_id = $1`,
      },
      {
        key: "loan_rate_changes",
        sql: "SELECT * FROM loan_rate_changes WHERE user_id = $1",
      },
      {
        key: "loan_scenarios",
        sql: "SELECT * FROM loan_scenarios WHERE user_id = $1",
      },
      { key: "budgets", sql: "SELECT * FROM budgets WHERE user_id = $1" },
      {
        key: "budget_categories",
        sql: `SELECT bc.* FROM budget_categories bc
              JOIN budgets b ON bc.budget_id = b.id
              WHERE b.user_id = $1`,
      },
      {
        key: "budget_periods",
        sql: `SELECT bp.* FROM budget_periods bp
              JOIN budgets b ON bp.budget_id = b.id
              WHERE b.user_id = $1`,
      },
      {
        key: "budget_period_categories",
        sql: `SELECT bpc.* FROM budget_period_categories bpc
              JOIN budget_periods bp ON bpc.budget_period_id = bp.id
              JOIN budgets b ON bp.budget_id = b.id
              WHERE b.user_id = $1`,
      },
      {
        key: "budget_alerts",
        sql: "SELECT * FROM budget_alerts WHERE user_id = $1",
      },
      {
        key: "custom_reports",
        sql: "SELECT * FROM custom_reports WHERE user_id = $1",
      },
      {
        key: "investment_reports",
        sql: "SELECT * FROM investment_reports WHERE user_id = $1",
      },
      {
        key: "import_column_mappings",
        sql: "SELECT * FROM import_column_mappings WHERE user_id = $1",
      },
      {
        key: "monthly_account_balances",
        sql: "SELECT * FROM monthly_account_balances WHERE user_id = $1",
      },
      {
        key: "auto_backup_settings",
        sql: "SELECT * FROM auto_backup_settings WHERE user_id = $1",
      },
      {
        key: "ai_provider_configs",
        sql: "SELECT * FROM ai_provider_configs WHERE user_id = $1",
      },
      {
        key: "monte_carlo_scenarios",
        sql: "SELECT * FROM monte_carlo_scenarios WHERE user_id = $1",
      },
      {
        key: "monte_carlo_cash_flows",
        sql: `SELECT mccf.* FROM monte_carlo_cash_flows mccf
              JOIN monte_carlo_scenarios mcs ON mccf.scenario_id = mcs.id
              WHERE mcs.user_id = $1`,
      },
      {
        key: "gem_strategies",
        sql: "SELECT * FROM gem_strategies WHERE user_id = $1",
      },
      {
        key: "gem_strategy_accounts",
        sql: "SELECT * FROM gem_strategy_accounts WHERE user_id = $1",
      },
      {
        key: "gem_strategy_assets",
        sql: "SELECT * FROM gem_strategy_assets WHERE user_id = $1",
      },
      {
        key: "gem_strategy_signals",
        sql: "SELECT * FROM gem_strategy_signals WHERE user_id = $1",
      },
    ];
  }

  /**
   * Builds the gzipped JSON backup payload as a single Buffer in memory.
   * Used by the encryption path (which needs the whole payload to compute
   * the GCM auth tag) and the auto-backup writer.
   *
   * Buffers rather than strings, concatenated once: `parts.join("")` followed by
   * `Buffer.from(..., "utf-8")` held the whole payload twice at the moment of
   * conversion -- once as a JS string, once as bytes -- on top of the per-table
   * strings and the gzip output. On the chart's default 400 MiB backend that is
   * the difference between a backup and an OOM kill.
   *
   * The running total is checked against `exportBufferLimitBytes` as it grows, so
   * a dataset too large for this path is refused with an error the user can read
   * rather than by the pod dying mid-write. The unencrypted HTTP export is
   * unaffected: it streams, and has no total to bound.
   */
  private async collectGzippedExport(
    userId: string,
  ): Promise<{ buffer: Buffer; report: BackupCompletenessReport }> {
    const tableQueries = this.getTableQueries();
    const parts: Buffer[] = [
      Buffer.from(
        `{"version":${BACKUP_VERSION},"exportedAt":"${new Date().toISOString()}"`,
        "utf-8",
      ),
    ];
    let total = parts[0].length;
    // Captured to judge completeness after assembly: the metadata rows and the
    // blob rows the augment actually included.
    let attachments: Record<string, unknown>[] = [];
    let blobs: Record<string, unknown>[] = [];
    await this.inExportSnapshot(userId, async (read) => {
      for (const entry of tableQueries) {
        const key = entry.key;
        const rows = await this.readTable(read, entry);
        if (key === "transaction_attachments") attachments = rows;
        else if (key === "attachment_blobs") blobs = rows;
        const chunk = Buffer.from(`,"${key}":${JSON.stringify(rows)}`, "utf-8");
        total += chunk.length;
        if (total > this.exportBufferLimitBytes) {
          throw new BadRequestException(
            tr(
              "errors.backup.exportTooLarge",
              `This backup is too large to produce in one piece (past ${this.exportBufferLimitBytes} bytes at table "${key}"). Encrypted, automatic and support backups have to be assembled in memory; use the plain export, which streams, or raise BACKUP_EXPORT_BUFFER_LIMIT.`,
              { limit: this.exportBufferLimitBytes, table: key },
            ),
          );
        }
        parts.push(chunk);
      }
    });
    parts.push(Buffer.from("}", "utf-8"));
    return {
      buffer: gzipSync(Buffer.concat(parts)),
      report: this.assessAttachmentCompleteness(attachments, blobs),
    };
  }

  /**
   * Judges whether every attachment metadata row in the artifact has its bytes.
   *
   * Runs after assembly, over the two arrays actually written. A metadata row
   * with no matching blob is *missing* -- the augment dropped an external object
   * it could not read or that failed its checksum, or a database blob simply is
   * not there. A database-provider blob that is present but contradicts its own
   * metadata is *inconsistent*; external blobs were already validated when the
   * augment carried them, so their presence is proof enough and they are not
   * re-hashed here. Support backups exclude the attachment tables, so there are no
   * rows and the report is trivially complete.
   */
  private assessAttachmentCompleteness(
    attachments: Record<string, unknown>[],
    blobs: Record<string, unknown>[],
  ): BackupCompletenessReport {
    const blobById = new Map<string, string>();
    for (const blob of blobs ?? []) {
      const id = String(blob.attachment_id ?? "");
      if (id.length > 0 && typeof blob.data === "string") {
        blobById.set(id, blob.data);
      }
    }

    let missing = 0;
    let inconsistent = 0;
    for (const row of attachments ?? []) {
      const id = String(row.id ?? "");
      const encoded = blobById.get(id);
      if (encoded === undefined) {
        missing += 1;
        continue;
      }
      // Only the database provider's bytes arrive here unvalidated; external ones
      // passed `storedBytesMatchMetadata` before the augment included them.
      if (String(row.storage_provider ?? "database") === "database") {
        const bytes = Buffer.from(encoded, "base64");
        if (!this.attachmentBytesConsistent(bytes, row)) inconsistent += 1;
      }
    }

    const expected = attachments?.length ?? 0;
    const included = expected - missing - inconsistent;
    return {
      complete: missing === 0 && inconsistent === 0,
      expectedAttachments: expected,
      includedAttachments: included,
      missingAttachments: missing,
      inconsistentAttachments: inconsistent,
    };
  }

  async restoreData(
    userId: string,
    input: RestoreBackupInput,
  ): Promise<RestoreResult> {
    const user = await this.scoped(User, (repo) =>
      repo.findOne({ where: { id: userId } }),
    );
    if (!user) {
      throw new NotFoundException(
        tr("errors.backup.userNotFoundRestore", "User not found"),
      );
    }

    // Two orderings had to be reconciled here, and both properties survive.
    //
    // #1060 moved file validation BEFORE the re-authentication: the OIDC artifact
    // is single-use and the round trip that mints it loses the user's file
    // selection, so consuming it and only then finding a wrong backup password
    // charged a full identity-provider round trip for a mistake that has nothing
    // to do with identity -- and the honest failure then looks like a spent
    // artifact on the retry.
    //
    // The audit-03 work put the whole of it inside the processing gate: the peak
    // is dominated by the *expanded* payload, which a small compressed upload
    // reaches just as easily as a large one, so upload admission cannot bound it.
    // The gate caps how many restores decompress at once (one, on the default pod)
    // and refuses with a 503 when the model leaves no room for even one
    // (F3RB-005), rather than letting the request walk into an OOM kill.
    //
    // Keeping the gate outside and #1060's ordering inside satisfies both: nothing
    // decompresses unbudgeted, and no artifact is spent on a file that was never
    // going to restore.
    return restoreProcessingGate.run(async () => {
      const gzippedPayload = await this.maybeDecrypt(input, user);
      const rawData = await this.decompressAndParse(gzippedPayload);
      this.validateBackupFormat(rawData);

      await this.verifyAuthentication(user, input);

      // A support (de-identified) backup restores like any other, but the data
      // is synthetic -- masked names, amounts scaled by a hidden factor. Log it
      // so scaled balances aren't mistaken for corruption later.
      if ((rawData as { supportBackup?: unknown }).supportBackup === true) {
        this.logger.log(
          `Restoring a de-identified support backup for user ${userId} (names masked, amounts scaled)`,
        );
      }

      // Remap every primary key in the backup to a fresh UUID (and rewrite all
      // references to those keys, including ids embedded in JSONB columns) so the
      // restore behaves as if the backup came from an entirely separate system.
      // Without this, restoring one user's backup into another user's account on
      // the SAME system would collide on the original UUIDs: the inserts would be
      // silently skipped by ON CONFLICT DO NOTHING, and the Phase-3 deferred-FK
      // UPDATEs (keyed only by id) would mutate the OTHER user's rows.
      const idRemap = this.buildBackupIdRemap(rawData);
      const data = this.remapBackupIds(rawData, idRemap);
      this.rehashGemSignalFingerprints(data, idRemap);

      this.logger.log(`Starting backup restore for user ${userId}`);

      // Attachment bytes are staged before anything is deleted: an object that is
      // missing or fails its checksum has to be discovered while the user's
      // current data is still there, not halfway through replacing it.
      const {
        stagedKeys,
        sourceKeys,
        skipped: skippedAttachments,
      } = await this.stageAttachmentObjects(userId, data, idRemap);

      // The keys this user's *current* attachments occupy, read before the delete
      // because afterwards there is nothing left to read them from. They are
      // deleted after a successful commit -- see `deleteDisplacedAttachmentObjects`
      // for why that is the only safe moment and why the backup's own old keys are
      // not in this set.
      const displacedKeys = await this.collectExternalAttachmentKeys(userId);

      const restored: Record<string, number> = {};

      // A restore deletes everything the user owns and rewrites it, and it is not
      // the only operation that does: a `.mny` import with "start fresh" and the
      // self-service delete-my-data do too. Each is internally atomic, but two of
      // them overlapping is not -- and the `.mny` import is not one transaction at
      // all, so a restore landing mid-import wipes the rows its worker is still
      // writing and the worker then writes them into the restored dataset. The
      // lease refuses with a 409 before anything is deleted (audit DR-04-02).
      return this.maintenance.withMaintenanceLease(
        userId,
        "backup restore",
        () =>
          // One transaction for the whole restore, exactly as the QueryRunner block
          // was: a half-applied restore would leave the account in a state that is
          // neither the backup nor what was there before. `preserveTimestamps` makes
          // withScopedDb emit `app.preserve_timestamps` for this transaction (in
          // every RLS mode), so the GUC-aware `updated_at` trigger keeps the backup's
          // timestamps through the Phase-3 deferred-FK UPDATEs -- replacing the old
          // trigger-disabling ALTER TABLE DDL, which the unprivileged runtime role
          // cannot execute under enforcement (task C5).
          withPreserveTimestamps(() =>
            withScopedDb(this.dataSource, async (manager) => {
              // Phase 1: Delete all existing user data (same order as deleteData in users.service)
              await this.deleteAllUserData(userId, manager);

              // Phase 2a: ensure every referenced currency code exists before
              // restoring the tables with FK references to currencies(code).
              await this.ensureCurrenciesExist(manager, data, userId);

              // Phase 2b: insert every backed-up table in FK-safe order. The order,
              // the row-count key and whether user_id is forced live in
              // RESTORE_PLAN, which restore-plan.spec.ts checks against the schema's
              // foreign keys -- so a new table or a new FK cannot quietly land in the
              // wrong position.
              for (const { table, countKey, scopeToUser } of RESTORE_PLAN) {
                restored[countKey] = await this.insertRows(
                  manager,
                  table,
                  (
                    data as unknown as Record<string, Record<string, unknown>[]>
                  )[table],
                  scopeToUser ? userId : null,
                );
              }

              // Phase 3: Restore deferred FK columns that were stripped during insert
              // to avoid circular/forward reference violations.
              await this.restoreDeferredFkColumns(manager, data);

              this.logger.log(`Backup restore completed for user ${userId}`);
              // `skippedAttachments` is reported beside `restored`, never inside it:
              // the client sums `restored`'s values to show a row total, and a count
              // of rows that were deliberately not written does not belong in that
              // sum.
              return skippedAttachments > 0
                ? {
                    message: "Backup restored successfully",
                    restored,
                    skippedAttachments,
                  }
                : { message: "Backup restored successfully", restored };
            }),
          )
            .then(async (result) => {
              // After the commit, never before: until it lands, the metadata that
              // references these objects may come back with a rollback.
              await this.deleteDisplacedAttachmentObjects(displacedKeys, [
                ...stagedKeys,
                ...sourceKeys,
              ]);
              return result;
            })
            .catch(async (error) => {
              this.logger.error(
                `Backup restore failed for user ${userId}: ${error.message}`,
              );
              // The database rolled back; the objects staged for it did not, so remove
              // them rather than leaving bytes nothing references. The user's own old
              // objects stay exactly where they are -- their metadata rolled back with
              // everything else, so those bytes are still referenced.
              await this.discardStagedAttachmentObjects(stagedKeys);
              throw error;
            }),
      );
    });
  }

  /**
   * Every external object key this user's attachments currently occupy.
   *
   * Empty for the `database` provider: its bytes live in `attachment_blobs` and
   * go with the rows, inside the transaction.
   */
  private async collectExternalAttachmentKeys(
    userId: string,
  ): Promise<string[]> {
    if (this.attachmentStorage.name === "database") return [];
    const rows: Array<{ storage_key: string }> = await withScopedDb(
      this.dataSource,
      (manager) =>
        manager.query(
          `SELECT storage_key FROM transaction_attachments
            WHERE user_id = $1 AND storage_provider = $2`,
          [userId, this.attachmentStorage.name],
        ),
    );
    return rows.map((row) => row.storage_key).filter(Boolean);
  }

  /**
   * Remove the objects the restore displaced, after it has committed.
   *
   * A destructive restore deletes every `transaction_attachments` row the user
   * had. For `local` and `s3` the bytes are not in those rows, so they used to
   * stay in the volume or the bucket forever, referenced by nothing -- a receipt
   * or a medical document surviving the replacement of the account it belonged
   * to, and still present in whatever backs that storage up. The metadata was
   * gone, so nothing could ever find them again to clean them up either.
   *
   * Three constraints decide when and what:
   *
   * - **After the commit.** Bytes deleted before it that the transaction then
   *   rolls back leave a metadata row promising a download that does not exist,
   *   which the user cannot distinguish from a working attachment. Orphaned bytes
   *   cost storage; a row pointing at nothing costs trust. That is the same rule
   *   `AttachmentsService.remove` follows.
   * - **Only keys the target user held.** Not the old keys named by the uploaded
   *   file: a cross-user restore on the same instance legitimately reads another
   *   user's objects as its source, and the same backup may be restored more than
   *   once. Deleting those would break both.
   * - **Never a key just staged.** Restoring a backup taken from this same
   *   account re-uses ids, so a displaced key and a newly written key can be the
   *   same string. Deleting it would remove the bytes the restore just committed
   *   metadata for.
   * - **Never a key the backup reads as its source.** This is the one that bit:
   *   a backup taken from this account names the keys this account currently
   *   holds, so its source objects *are* its displaced objects. Deleting them
   *   left the artifact naming bytes that no longer existed -- the first restore
   *   worked, and a second restore of the same file skipped every attachment and
   *   then deleted the copy the first restore had made, losing the content
   *   entirely while still reporting success.
   *
   *   So when a key is both an orphan and a source, the source wins. That keeps
   *   an object nothing in the database references, which is exactly what this
   *   method exists to remove -- and it is the right way round: an orphaned copy
   *   of the user's own receipt costs storage, while a backup that can only be
   *   restored once costs the receipt. `stageAttachmentObjects` says the same
   *   thing from the other side, and the two used to contradict each other.
   *
   * Best-effort per key: a storage error here must not turn a completed restore
   * into a failure, since the database is already the backup's. It is logged.
   */
  private async deleteDisplacedAttachmentObjects(
    displacedKeys: string[],
    retainedKeys: string[],
  ): Promise<void> {
    if (displacedKeys.length === 0) return;
    const retained = new Set(retainedKeys);
    const removable = displacedKeys.filter((key) => !retained.has(key));
    if (removable.length === 0) return;

    let failures = 0;
    for (const key of removable) {
      try {
        await this.attachmentStorage.delete(key);
      } catch (error) {
        failures += 1;
        this.logger.warn(
          `Could not remove displaced attachment object ${key}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    this.logger.log(
      `Removed ${removable.length - failures} displaced attachment object(s) after restore` +
        (failures > 0 ? ` (${failures} could not be removed)` : ""),
    );
  }

  /**
   * Runs every table read of one export inside a single `REPEATABLE READ`
   * transaction.
   *
   * A backup is a graph, not a bag of tables: `transactions` reference
   * `accounts`, `transaction_splits` reference `transactions`, and the restore
   * inserts with `ON CONFLICT DO NOTHING`. Reading each table in its own
   * autocommit transaction -- which is what a per-call `withScopedDb` gives --
   * lets a concurrent write land between two of those reads, so the file can
   * hold a split whose parent transaction is absent, or a transaction whose
   * account is absent. Restoring it does not fail: the orphan's insert is
   * skipped and the row is silently gone, which is the worst way for a backup to
   * be wrong.
   *
   * `REPEATABLE READ` takes one snapshot for the whole transaction, so every
   * read sees the same committed state and the export is a point in time. It is
   * read-only, so there is no serialization failure to retry.
   */
  private async withExportSnapshot<T>(
    run: (
      read: (
        sql: string,
        params: unknown[],
      ) => Promise<Record<string, unknown>[]>,
    ) => Promise<T>,
  ): Promise<T> {
    return withScopedDb(
      this.dataSource,
      async (manager) => {
        await manager.query(
          "SELECT set_config('idle_in_transaction_session_timeout', $1, true)",
          [String(EXPORT_IDLE_TIMEOUT_MS)],
        );
        return run((sql, params) => manager.query(sql, params));
      },
      "REPEATABLE READ",
    );
  }

  /**
   * If the upload is encrypted, decrypt it using (in order of preference):
   * 1) the explicit backupPassword the frontend sent for this restore,
   * 2) the user's auth password (most backups encrypt with this),
   * 3) the user's currently stored backup password.
   *
   * Returns the inner gzipped JSON payload, or the input unchanged if it's
   * not encrypted. Throws BackupPasswordRequiredError when we know it's
   * encrypted but every available password failed -- the frontend uses that
   * to prompt the user for the password the backup was made with.
   */
  private async maybeDecrypt(
    input: RestoreBackupInput,
    user: User,
  ): Promise<Buffer> {
    if (!isEncryptedBackup(input.compressedData)) {
      return input.compressedData;
    }

    const candidates: string[] = [];
    if (input.backupPassword) candidates.push(input.backupPassword);
    if (input.password) candidates.push(input.password);
    const stored = this.resolveStoredBackupPassword(user);
    if (stored) candidates.push(stored);

    for (const pw of candidates) {
      try {
        return await decryptBackup(input.compressedData, pw);
      } catch (err) {
        if (!(err instanceof BackupDecryptionError)) throw err;
        // try next candidate
      }
    }

    throw new BackupPasswordRequiredError(
      input.backupPassword
        ? tr(
            "errors.backup.backupPasswordWrong",
            "The password you entered cannot decrypt this backup. Try the password that was set when the backup was created.",
          )
        : tr(
            "errors.backup.backupPasswordRequired",
            "This backup is encrypted. Provide the password that was used when the backup was created.",
          ),
    );
  }

  /**
   * Decompress and parse the uploaded backup, under a hard ceiling on the
   * decompressed size.
   *
   * Express caps the *compressed* body, which bounds nothing about what comes
   * out of gzip. `gunzipSync` with no `maxOutputLength` allocated whatever the
   * stream expanded to -- so a few hundred kilobytes of repeated text became
   * gigabytes of buffer, allocated before the version check, the format check,
   * or anything else that could refuse the request. `maxOutputLength` makes zlib
   * stop and raise instead of allocating past the limit.
   *
   * Asynchronous for the second half of the same problem: `gunzipSync` inflated
   * on the event loop, so a large payload froze every other request in the
   * process for the duration. The async form runs on the libuv threadpool. The
   * `JSON.parse` below still blocks, unavoidably -- a JSON document has to be
   * whole to be parsed -- but it now blocks on a string of bounded length.
   */
  private async decompressAndParse(
    compressedData: Buffer,
  ): Promise<BackupData> {
    let json: string;
    try {
      const decompressed = await gunzipAsync(compressedData, {
        maxOutputLength: this.restoreExpandedLimitBytes,
      });
      json = decompressed.toString("utf-8");
    } catch (error) {
      // zlib reports the ceiling as ERR_BUFFER_TOO_LARGE / RangeError. Say so:
      // "not valid gzip" would send the user looking for a corrupt file.
      if (
        error instanceof RangeError ||
        (error as { code?: string })?.code === "ERR_BUFFER_TOO_LARGE"
      ) {
        this.logger.warn(
          `Rejected a backup restore whose decompressed size exceeded ${this.restoreExpandedLimitBytes} bytes`,
        );
        throw new BadRequestException(
          tr(
            "errors.backup.decompressTooLarge",
            `Backup is too large to restore: it expands past the configured limit of ${this.restoreExpandedLimitBytes} bytes. Raise BACKUP_RESTORE_EXPANDED_LIMIT if this is a genuine backup.`,
            { limit: this.restoreExpandedLimitBytes },
          ),
        );
      }
      throw new BadRequestException(
        tr(
          "errors.backup.decompressFailed",
          "Failed to decompress backup file. Ensure the file is gzip-compressed.",
        ),
      );
    }

    try {
      return JSON.parse(json) as BackupData;
    } catch {
      throw new BadRequestException(
        tr(
          "errors.backup.invalidJsonBackup",
          "Invalid backup file: decompressed content is not valid JSON",
        ),
      );
    }
  }

  private async verifyAuthentication(
    user: User,
    input: RestoreBackupInput,
  ): Promise<void> {
    if (user.authProvider === "oidc") {
      // A signed, action-bound, one-time artifact minted by the OIDC callback
      // after a prompt=login round trip. This used to accept any non-empty
      // string -- the client sent the literal "oidc-session-confirmed" -- so the
      // second proof for the single most destructive action in the product was
      // possession of the session that was already required (P2-005). Bound to
      // "restore-backup" specifically: an artifact minted to delete data must not
      // authorize overwriting everything instead.
      this.oidcReauth.consume(user.id, "restore-backup", input.oidcIdToken);
    } else if (!user.passwordHash) {
      // Local account with no password (admin-provisioned, reset not completed).
      // This fell off the end of the else-if chain and proved nothing at all.
      throw new UnauthorizedException(
        tr(
          "errors.backup.reauthUnavailable",
          "Finish setting up your account password before restoring a backup.",
        ),
      );
    } else {
      if (!input.password) {
        throw new UnauthorizedException(
          tr(
            "errors.backup.passwordRequiredForRestore",
            "Password is required to confirm restore",
          ),
        );
      }
      const isValid = await bcrypt.compare(input.password, user.passwordHash);
      if (!isValid) {
        throw new UnauthorizedException(
          tr("errors.backup.invalidPassword", "Invalid password"),
        );
      }
    }
  }

  private validateBackupFormat(data: BackupData): void {
    if (!data || typeof data !== "object") {
      throw new BadRequestException(
        tr(
          "errors.backup.invalidBackupFormat",
          "Invalid backup format: data must be an object",
        ),
      );
    }
    if (data.version !== BACKUP_VERSION) {
      throw new BadRequestException(
        tr(
          "errors.backup.unsupportedBackupVersion",
          `Unsupported backup version: ${data.version}. Expected ${BACKUP_VERSION}`,
          { version: data.version, expected: BACKUP_VERSION },
        ),
      );
    }
    if (!data.exportedAt) {
      throw new BadRequestException(
        tr(
          "errors.backup.missingExportedAt",
          "Invalid backup format: missing exportedAt",
        ),
      );
    }
  }

  /**
   * Builds a map from every primary-key UUID in the backup to a freshly
   * generated UUID. Currencies are intentionally excluded: they are shared,
   * global rows keyed by `code` (not by a per-user UUID) and are referenced by
   * code, so they must keep their original identifiers. Non-UUID ids (e.g.
   * `security_prices.id` is BIGSERIAL) are also excluded -- they get a fresh
   * value assigned by the DB on insert (see insertRows), and remapping them
   * to UUIDs here would (a) corrupt them and (b) clobber unrelated bigint
   * values in other columns that happen to share the same string form.
   */
  /**
   * Re-hash each GEM signal's `config_fingerprint` onto the remapped security
   * ids.
   *
   * The fingerprint is a hash of the strategy's cadence, lookback and the
   * security assigned to every role -- so it contains ids, but as hashed
   * *material*, not as a value `deepRemapIds` can rewrite. A restore mints new
   * UUIDs for every security, and the stored hashes went on describing the old
   * ones. The report reads a mismatch as "the user changed the settings", so
   * the first read after a restore would recompute the whole history where it
   * could, and hide the periods it could not -- the user's own past decisions,
   * and the `executed` flags on them, gone or rewritten by an import that
   * changed nothing they can see.
   *
   * The relation is translated, not overwritten. Only signals whose hash
   * matches the configuration *as it was* are moved to the configuration *as
   * it now is*; a signal that was already stale before the backup stays stale,
   * because it answered a different question then and still does. Blanket
   * re-stamping would promote retired history into the current run.
   */
  private rehashGemSignalFingerprints(
    data: BackupData,
    idRemap: Map<string, string>,
  ): void {
    const signals = data.gem_strategy_signals;
    if (!signals?.length) return;

    const toOldId = new Map(
      [...idRemap].map(([oldId, newId]) => [newId, oldId] as const),
    );
    const assetsByStrategy = new Map<string, Record<string, unknown>[]>();
    for (const asset of data.gem_strategy_assets ?? []) {
      const key = String(asset.strategy_id ?? "");
      const group = assetsByStrategy.get(key);
      if (group) group.push(asset);
      else assetsByStrategy.set(key, [asset]);
    }

    /** The backup's snake_case rows in the shape the hash function wants. */
    const fingerprintOf = (
      strategy: Record<string, unknown>,
      assets: Record<string, unknown>[],
      securityIdOf: (asset: Record<string, unknown>) => string | null,
    ): string =>
      gemConfigFingerprint(
        {
          cadence: strategy.cadence as GemStrategy["cadence"],
          lookbackMonths: Number(strategy.lookback_months),
        },
        assets.map(
          (asset) =>
            ({
              role: asset.role,
              securityId: securityIdOf(asset),
            }) as GemStrategyAsset,
        ),
      );

    for (const strategy of data.gem_strategies ?? []) {
      const strategyId = String(strategy.id ?? "");
      const assets = assetsByStrategy.get(strategyId) ?? [];
      const asNow = fingerprintOf(strategy, assets, (asset) =>
        asset.security_id === null || asset.security_id === undefined
          ? null
          : String(asset.security_id),
      );
      const asBackedUp = fingerprintOf(strategy, assets, (asset) => {
        if (asset.security_id === null || asset.security_id === undefined) {
          return null;
        }
        const remapped = String(asset.security_id);
        return toOldId.get(remapped) ?? remapped;
      });
      if (asNow === asBackedUp) continue;

      for (const signal of signals) {
        if (String(signal.strategy_id ?? "") !== strategyId) continue;
        if (signal.config_fingerprint === asBackedUp) {
          signal.config_fingerprint = asNow;
        }
      }
    }
  }

  /**
   * Makes every restored attachment's bytes reachable under the key its
   * restored metadata will name -- or drops the metadata row and says so.
   *
   * **Two paths, and the first is the one new artifacts take.** A backup now
   * carries attachment bytes for *every* provider, base64 in `attachment_blobs`
   * (see `appendExternalAttachmentBytes`). When the bytes are in the artifact the
   * restore uses them directly -- validates them against their own metadata, and
   * places them where this runtime keeps its attachments (in the blob rows for the
   * `database` provider, in the object store for `local`/`s3`, whichever the target
   * runs, rewriting `storage_provider` to match). No object outside the file is
   * read, so no ownership question arises: the bytes are the user's own download.
   * This is what makes a fresh instance and a deleted-metadata account recoverable
   * (F3R5-001).
   *
   * **The second path is the legacy one**, for an artifact produced before bytes
   * travelled. Those carried only metadata for `local`/`s3`, whose objects live
   * outside Postgres under a `storage_key` that equals the attachment's UUID. The
   * restore mints a fresh UUID per row, so the metadata came back pointing at
   * `<new-uuid>` while the object was still at `<old-uuid>`: unreachable after a
   * restore that reported success. So for those the bytes are *copied* from the old
   * key to the new -- and only after the restoring user is shown to own a matching
   * row, because an uploaded id cannot authorize reading a deployment-wide object
   * (F3RRR-001). On a fresh instance that ownership row does not exist and the
   * attachment is skipped, which is exactly why the bytes now travel.
   *
   * Preserving the old key instead of copying would be worse than the original
   * bug: the bytes were not in those older backups, so a restore into a different
   * user on the same instance would hand that user working links to attachments
   * whose contents they were never sent.
   *
   * Either way, a carried or copied object is checked against the size and SHA-256
   * its metadata claims, all before the destructive delete, so a missing or corrupt
   * object cannot be discovered halfway through.
   *
   * An object that cannot be staged is not restorable, and a metadata row
   * pointing at nothing is a broken attachment the user cannot tell from a
   * working one. Refusing the whole restore over a receipt image would be the
   * wrong trade -- the ledger is the point -- so the row is dropped and
   * counted, and the count is reported separately from `restored` rather than
   * added to it.
   *
   * **The right to read a source object comes from the database, not the file.**
   * Before any external object is read, the restoring user must currently own an
   * attachment with that original id, on this provider, with the same byte size
   * and SHA-256 *as stored* -- checked against `transaction_attachments`, which is
   * still intact because staging runs before the destructive delete. A row that
   * fails is unrestorable and is dropped and counted.
   *
   * Two earlier versions of this got it wrong in the same way, and the second was
   * a fix for the first:
   *
   *  1. The destination came from `row.storage_key`, and a key not recognised as a
   *     remapped id was treated as legacy or operator-chosen -- skip the load, the
   *     checksum and the copy, because the object supposedly already sat where the
   *     metadata pointed. A crafted backup could name any valid key, including
   *     another tenant's, and the row was inserted under the uploader's `user_id`.
   *  2. So the keys were derived from the id remap instead, with "a row whose id is
   *     not in the map did not come from this backup's graph" as the boundary. But
   *     the graph is the *uploaded* graph: `collectRowIdRemap` admits every
   *     UUID-shaped `row.id` in the file, so the check could never fire for a
   *     well-formed crafted row. Put the victim's attachment id in `row.id` --
   *     along with the size and hash from any standard backup, which carries
   *     external attachment metadata -- and the restore read their object and
   *     copied it under the attacker's ownership. The uploaded document was
   *     authorizing itself.
   *
   * Which field is trusted was never the question. **No unsigned value from the
   * file can establish ownership** -- not a key, not an id, not a checksum, not a
   * byte count. Only a record the server already holds can.
   *
   * The consequence is deliberate: restoring one user's backup into a *different*
   * user on the same instance now skips external attachments rather than
   * disclosing them, and a fresh instance skips them because the objects are not
   * there. That is the same conclusion the original analysis reached about
   * preserving the old key, applied to reading it.
   *
   * Returns the keys written and the source keys consumed, so a failed database
   * transaction can remove the former and the post-commit cleanup can spare the
   * latter -- see `deleteDisplacedAttachmentObjects`.
   */
  private async stageAttachmentObjects(
    userId: string,
    data: BackupData,
    idRemap: Map<string, string>,
  ): Promise<{ stagedKeys: string[]; sourceKeys: string[]; skipped: number }> {
    const rows = data.transaction_attachments;
    if (!rows?.length) return { stagedKeys: [], sourceKeys: [], skipped: 0 };

    // `idRemap` contains every UUID-keyed row in the uploaded graph. Reversing
    // the whole map allocated another graph-sized array just to authorize legacy
    // attachment reads. Keep only the remapped attachment ids this method can use.
    const attachmentIds = new Set(
      rows.map((row) => String(row.id ?? "")).filter(Boolean),
    );
    const oldIdOf = new Map<string, string>();
    for (const [oldId, newId] of idRemap) {
      if (attachmentIds.has(newId)) oldIdOf.set(newId, oldId);
    }
    // Last row wins for a duplicated id -- and, critically, the row that is
    // *validated* below must be the row that is *inserted*. `attachment_blobs`
    // has `attachment_id` as its primary key, and Phase-2 inserts with
    // `ON CONFLICT DO NOTHING`, so a raw uploaded array with two rows for one id
    // would validate the last and commit the first. A crafted backup could pair
    // valid bytes (checked, accepted) with corrupt bytes (inserted). So the
    // canonical encoded string is kept here beside the decoded Buffer, and
    // `data.attachment_blobs` is rebuilt from it below -- one row per id, exactly
    // the bytes that passed the check.
    const carriedBytes = new Map<string, Buffer>();
    const canonicalEncoded = new Map<string, string>();
    for (const blob of data.attachment_blobs ?? []) {
      const id = String(blob.attachment_id ?? "");
      if (id.length === 0) continue;
      const encoded = blob.data;
      if (typeof encoded !== "string") continue;
      carriedBytes.set(id, Buffer.from(encoded, "base64"));
      canonicalEncoded.set(id, encoded);
    }

    const runtimeProvider = this.attachmentStorage.name;

    // Only legacy external rows need a database ownership proof. Current-format
    // rows carry their bytes and never read a source object; database-provider or
    // cross-provider legacy rows cannot use this runtime's object store either.
    const legacySourceIds = new Set<string>();
    for (const row of rows) {
      const attachmentId = String(row.id ?? "");
      if (carriedBytes.has(attachmentId)) continue;
      const provider = String(row.storage_provider ?? "database");
      if (provider === "database" || provider !== runtimeProvider) continue;
      const oldId = oldIdOf.get(attachmentId);
      if (oldId !== undefined) legacySourceIds.add(oldId);
    }

    // `loadOwnedAttachmentSources` returns before querying for an empty list, so
    // a fully self-contained backup performs no legacy ownership read at all.
    const ownedSources = await this.loadOwnedAttachmentSources(userId, [
      ...legacySourceIds,
    ]);

    const stagedKeys: string[] = [];
    const sourceKeys: string[] = [];
    const unrestorable = new Set<string>();
    /** Blob rows for attachments whose bytes are going to the object store. */
    const externallyPlaced = new Set<string>();

    for (const row of rows) {
      const attachmentId = String(row.id ?? "");
      const provider = String(row.storage_provider ?? "database");

      // Whatever the file said, the key is the attachment id. Every provider
      // addresses by it (the database provider by primary key, local and s3 by
      // object name), and normalising here means no uploaded value reaches a
      // provider from any path.
      row.storage_key = attachmentId;

      const carried = carriedBytes.get(attachmentId);
      if (carried !== undefined) {
        // The bytes are in the artifact, so nothing outside it is consulted and no
        // ownership question arises: this is the user's own download, and it can
        // only ever grant them their own files. This is the path that makes a
        // fresh instance and a deleted-metadata account recoverable.
        if (!this.carriedBytesMatchMetadata(carried, row)) {
          unrestorable.add(attachmentId);
          continue;
        }

        // Where the bytes land is this runtime's decision, not the source
        // instance's -- so a backup taken under one provider restores under
        // another, which used to be a skip.
        row.storage_provider = runtimeProvider;
        if (runtimeProvider === "database") {
          // The blob row stays and is inserted with everything else.
          continue;
        }
        await this.attachmentStorage.save(attachmentId, carried);
        stagedKeys.push(attachmentId);
        // ...and its blob row must not be inserted: `attachment_blobs` is the
        // database provider's storage, and a row there for an externally stored
        // attachment is a second copy nothing reads.
        externallyPlaced.add(attachmentId);
        continue;
      }

      if (provider === "database") {
        // Bytes should have travelled and did not. The metadata row describes a
        // download that will 404, which the user cannot tell from a working
        // attachment.
        unrestorable.add(attachmentId);
        continue;
      }

      if (provider !== runtimeProvider) {
        // An artifact from before external bytes travelled, taken on a different
        // backend. There is nothing here to read and nothing in the file.
        unrestorable.add(attachmentId);
        continue;
      }

      const oldKey = oldIdOf.get(attachmentId);
      if (oldKey === undefined) {
        // Not a remapped id at all, so there is no original to read from.
        unrestorable.add(attachmentId);
        continue;
      }

      // The authorization check. `owned` comes from the database; every field of
      // `row` comes from the uploaded file, so the two are compared and the file
      // never gets the last word. A mismatch means this user is not entitled to
      // these bytes -- whether the file is crafted or merely stale.
      const owned = ownedSources.get(oldKey);
      if (
        owned === undefined ||
        owned.provider !== provider ||
        owned.byteSize !== Number(row.byte_size) ||
        (typeof row.sha256 === "string" && owned.sha256 !== row.sha256)
      ) {
        unrestorable.add(attachmentId);
        continue;
      }

      let bytes: Buffer;
      try {
        bytes = await this.attachmentStorage.load(oldKey);
      } catch {
        unrestorable.add(attachmentId);
        continue;
      }

      // Integrity, against the *stored* size and hash rather than the file's.
      // The file's values were already required to equal these, so this catches
      // an object that has changed under the row since -- corruption, a partial
      // write, an operator replacing bytes by hand.
      if (bytes.length !== owned.byteSize) {
        unrestorable.add(attachmentId);
        continue;
      }
      if (owned.sha256.length > 0) {
        const actual = createHash("sha256").update(bytes).digest("hex");
        if (actual !== owned.sha256) {
          unrestorable.add(attachmentId);
          continue;
        }
      }

      await this.attachmentStorage.save(attachmentId, bytes);
      stagedKeys.push(attachmentId);
      sourceKeys.push(oldKey);
    }

    if (unrestorable.size > 0) {
      // Immutability: the caller's arrays are replaced, not spliced.
      data.transaction_attachments = rows.filter(
        (row) => !unrestorable.has(String(row.id ?? "")),
      );
      this.logger.warn(
        `Restore is dropping ${unrestorable.size} attachment(s) whose bytes could not be staged ` +
          `(provider ${runtimeProvider}); their metadata would point at nothing.`,
      );
    }

    // Rebuild `attachment_blobs` from the canonical, validated bytes rather than
    // filtering the uploaded array. This does three things at once, and the third
    // is why filtering was not enough:
    //  - drops rows whose attachment was unrestorable;
    //  - drops rows whose bytes went to the object store instead (a row in
    //    `attachment_blobs` for an externally stored attachment is a second copy
    //    nothing reads);
    //  - collapses any duplicate `attachment_id` to the single row whose bytes
    //    were checked, so the primary-key conflict can no longer commit a
    //    different, unverified copy than the one staging validated.
    // Every id here was decoded and (for database-provider rows that stayed)
    // checked against its metadata; a malformed row with no usable id or data was
    // never admitted to the map.
    const rebuiltBlobs: Record<string, unknown>[] = [];
    for (const [id, encoded] of canonicalEncoded) {
      if (unrestorable.has(id) || externallyPlaced.has(id)) continue;
      rebuiltBlobs.push({ attachment_id: id, data: encoded });
    }
    data.attachment_blobs = rebuiltBlobs;

    return { stagedKeys, sourceKeys, skipped: unrestorable.size };
  }

  /**
   * Whether bytes carried inside the artifact match the metadata beside them.
   *
   * Both sides come from the same file, so this proves consistency rather than
   * authority -- it cannot and does not need to establish ownership, because the
   * bytes are already in the user's own download. What it catches is a corrupted
   * or truncated artifact: restoring a row whose recorded `sha256` does not
   * describe its own bytes would publish a checksum the download cannot satisfy,
   * and the user would find that out when they opened the file rather than when
   * they restored it.
   *
   * Both columns are `NOT NULL` in the schema, so on any artifact this codebase
   * produced both checks run and the base64 decode is validated by them -- which
   * matters, because `Buffer.from(value, "base64")` discards characters outside the
   * alphabet instead of failing. A row missing either field is accepted rather than
   * refused: it can only come from a hand-edited or foreign document, and losing
   * bytes that travelled is worse than restoring a row that describes itself less
   * completely than it should.
   */
  private carriedBytesMatchMetadata(
    bytes: Buffer,
    row: Record<string, unknown>,
  ): boolean {
    return this.attachmentBytesConsistent(bytes, row);
  }

  /**
   * Whether a stored external object matches the metadata the server recorded for
   * it, checked at **export** time.
   *
   * Same comparison as `carriedBytesMatchMetadata`, opposite provenance: here the
   * bytes come from the object store and the size/hash from `transaction_attachments`,
   * so it compares the store against the database rather than a file against
   * itself. A mismatch means the source object was truncated, replaced or corrupted
   * out from under its row -- the export omits it rather than packaging bytes it
   * knows the restore will refuse.
   */
  private storedBytesMatchMetadata(
    bytes: Buffer,
    row: Record<string, unknown>,
  ): boolean {
    return this.attachmentBytesConsistent(bytes, row);
  }

  /** Bytes vs. the `byte_size`/`sha256` recorded beside them. Shared core. */
  private attachmentBytesConsistent(
    bytes: Buffer,
    row: Record<string, unknown>,
  ): boolean {
    const declaredSize = Number(row.byte_size);
    if (Number.isFinite(declaredSize) && declaredSize !== bytes.length) {
      return false;
    }
    if (typeof row.sha256 === "string" && row.sha256.length > 0) {
      const actual = createHash("sha256").update(bytes).digest("hex");
      if (actual !== row.sha256) return false;
    }
    return true;
  }

  /**
   * The attachments this user owns among `candidateIds`, by id.
   *
   * Scoped to the user in the query, so the answer cannot include somebody
   * else's row however the ids were chosen. `byte_size` and `sha256` come back so
   * the caller can require the uploaded row to agree with the stored one -- an
   * uploaded field that has to match a stored field is no longer a field the
   * uploader controls.
   */
  private async loadOwnedAttachmentSources(
    userId: string,
    candidateIds: string[],
  ): Promise<
    Map<string, { provider: string; byteSize: number; sha256: string }>
  > {
    const owned = new Map<
      string,
      { provider: string; byteSize: number; sha256: string }
    >();
    if (candidateIds.length === 0) return owned;

    const rows: Array<{
      id: string;
      storage_provider: string;
      byte_size: string | number;
      sha256: string | null;
    }> = await withScopedDb(this.dataSource, (manager) =>
      manager.query(
        `SELECT id, storage_provider, byte_size, sha256
           FROM transaction_attachments
          WHERE user_id = $1 AND id = ANY($2::uuid[])`,
        [userId, candidateIds],
      ),
    );
    for (const row of rows) {
      owned.set(String(row.id), {
        provider: String(row.storage_provider),
        byteSize: Number(row.byte_size),
        sha256: String(row.sha256 ?? ""),
      });
    }
    return owned;
  }

  /** Best-effort removal of objects staged for a restore that then failed. */
  private async discardStagedAttachmentObjects(
    stagedKeys: string[],
  ): Promise<void> {
    for (const key of stagedKeys) {
      try {
        await this.attachmentStorage.delete(key);
      } catch (error) {
        this.logger.warn(
          `Could not remove staged attachment object ${key} after a failed restore: ${error.message}`,
        );
      }
    }
  }

  private buildBackupIdRemap(data: BackupData): Map<string, string> {
    const remap = new Map<string, string>();
    for (const [table, rows] of Object.entries(data)) {
      if (table === "currencies" || !Array.isArray(rows)) continue;
      collectRowIdRemap(rows, remap, randomUUID);
    }
    return remap;
  }

  /**
   * Returns a deep copy of the backup with every id and every reference to an
   * id (FK columns plus ids embedded in JSONB values such as scheduled
   * transaction `tag_ids` or override `splits`) rewritten via the remap. The
   * `user_id` columns are never remapped here -- they are not backup row ids,
   * and insertRows() forces them to the restoring user. Currencies are passed
   * through unchanged.
   */
  private remapBackupIds(
    data: BackupData,
    remap: Map<string, string>,
  ): BackupData {
    if (remap.size === 0) return data;
    const result: Record<string, unknown> = { ...data };
    for (const [table, rows] of Object.entries(data)) {
      if (table === "currencies" || !Array.isArray(rows)) continue;
      result[table] = rows.map((row) => this.deepRemapIds(row, remap));
    }
    return result as unknown as BackupData;
  }

  /** See backup-id-remap.util.ts -- shared with the support (de-identified)
   *  export so the two walkers cannot drift. */
  private deepRemapIds(value: unknown, remap: Map<string, string>): unknown {
    return deepRemapIds(value, remap);
  }

  private async deleteAllUserData(
    userId: string,
    manager: EntityManager,
  ): Promise<void> {
    // Delete in FK-safe order (reverse of insert order)

    // Action history (undo/redo log) -- not included in backups, so wipe it
    // outright; restored data should not be undoable to the prior state.
    await manager.query("DELETE FROM action_history WHERE user_id = $1", [
      userId,
    ]);

    // GEM strategies (accounts, assets and signals cascade on strategy delete,
    // but are deleted explicitly first so the order is self-documenting)
    await manager.query("DELETE FROM gem_strategy_signals WHERE user_id = $1", [
      userId,
    ]);
    await manager.query("DELETE FROM gem_strategy_assets WHERE user_id = $1", [
      userId,
    ]);
    await manager.query(
      "DELETE FROM gem_strategy_accounts WHERE user_id = $1",
      [userId],
    );
    await manager.query("DELETE FROM gem_strategies WHERE user_id = $1", [
      userId,
    ]);

    // Monte Carlo scenarios (cash flows cascade on scenario delete)
    await manager.query(
      `DELETE FROM monte_carlo_cash_flows WHERE scenario_id IN
       (SELECT id FROM monte_carlo_scenarios WHERE user_id = $1)`,
      [userId],
    );
    await manager.query(
      "DELETE FROM monte_carlo_scenarios WHERE user_id = $1",
      [userId],
    );

    // AI provider configs
    await manager.query("DELETE FROM ai_provider_configs WHERE user_id = $1", [
      userId,
    ]);

    // Investment data
    await manager.query(
      "DELETE FROM investment_transactions WHERE user_id = $1",
      [userId],
    );
    // Security tags (join rows cascade from securities/tags, deleted here
    // explicitly before securities so the delete order is self-documenting)
    await manager.query(
      `DELETE FROM security_tags WHERE security_id IN
       (SELECT id FROM securities WHERE user_id = $1)`,
      [userId],
    );
    await manager.query(
      `DELETE FROM holdings WHERE account_id IN
       (SELECT id FROM accounts WHERE user_id = $1)`,
      [userId],
    );
    await manager.query(
      `DELETE FROM security_prices WHERE security_id IN
       (SELECT id FROM securities WHERE user_id = $1)`,
      [userId],
    );
    await manager.query("DELETE FROM security_documents WHERE user_id = $1", [
      userId,
    ]);
    // Scheduled transactions and their splits reference securities via
    // investment_security_id. Clear those FKs before deleting securities; the
    // rows themselves are removed in the scheduled-transactions block below.
    await manager.query(
      `UPDATE scheduled_transaction_splits SET investment_security_id = NULL
       WHERE scheduled_transaction_id IN
       (SELECT id FROM scheduled_transactions WHERE user_id = $1)`,
      [userId],
    );
    await manager.query(
      "UPDATE scheduled_transactions SET investment_security_id = NULL WHERE user_id = $1",
      [userId],
    );
    await manager.query("DELETE FROM securities WHERE user_id = $1", [userId]);

    // Budget data
    await manager.query("DELETE FROM budget_alerts WHERE user_id = $1", [
      userId,
    ]);
    await manager.query(
      `DELETE FROM budget_period_categories WHERE budget_period_id IN
       (SELECT bp.id FROM budget_periods bp
        JOIN budgets b ON bp.budget_id = b.id
        WHERE b.user_id = $1)`,
      [userId],
    );
    await manager.query(
      `DELETE FROM budget_periods WHERE budget_id IN
       (SELECT id FROM budgets WHERE user_id = $1)`,
      [userId],
    );
    await manager.query(
      `DELETE FROM budget_categories WHERE budget_id IN
       (SELECT id FROM budgets WHERE user_id = $1)`,
      [userId],
    );
    await manager.query("DELETE FROM budgets WHERE user_id = $1", [userId]);

    // Transaction tags
    await manager.query(
      `DELETE FROM transaction_split_tags WHERE transaction_split_id IN
       (SELECT ts.id FROM transaction_splits ts
        JOIN transactions t ON ts.transaction_id = t.id
        WHERE t.user_id = $1)`,
      [userId],
    );
    await manager.query(
      `DELETE FROM transaction_tags WHERE transaction_id IN
       (SELECT id FROM transactions WHERE user_id = $1)`,
      [userId],
    );

    // Transaction splits
    await manager.query(
      `DELETE FROM transaction_splits WHERE transaction_id IN
       (SELECT id FROM transactions WHERE user_id = $1)`,
      [userId],
    );

    // Transaction attachments (bytes first, then metadata). Both would cascade
    // from the transactions delete below, but we clear them explicitly to match
    // the rest of this FK-ordered teardown.
    await manager.query(
      `DELETE FROM attachment_blobs WHERE attachment_id IN
       (SELECT id FROM transaction_attachments WHERE user_id = $1)`,
      [userId],
    );
    await manager.query(
      "DELETE FROM transaction_attachments WHERE user_id = $1",
      [userId],
    );

    // Transactions
    await manager.query("DELETE FROM transactions WHERE user_id = $1", [
      userId,
    ]);

    // Tags
    await manager.query("DELETE FROM tags WHERE user_id = $1", [userId]);

    // Scheduled transactions
    await manager.query(
      `DELETE FROM scheduled_transaction_overrides WHERE scheduled_transaction_id IN
       (SELECT id FROM scheduled_transactions WHERE user_id = $1)`,
      [userId],
    );
    await manager.query(
      `DELETE FROM scheduled_transaction_split_tags WHERE scheduled_transaction_split_id IN
       (SELECT sts.id FROM scheduled_transaction_splits sts
        JOIN scheduled_transactions st ON sts.scheduled_transaction_id = st.id
        WHERE st.user_id = $1)`,
      [userId],
    );
    await manager.query(
      `DELETE FROM scheduled_transaction_splits WHERE scheduled_transaction_id IN
       (SELECT id FROM scheduled_transactions WHERE user_id = $1)`,
      [userId],
    );
    // Clear account FK references to scheduled_transactions before deleting them
    await manager.query(
      "UPDATE accounts SET scheduled_transaction_id = NULL WHERE user_id = $1",
      [userId],
    );
    await manager.query(
      "DELETE FROM scheduled_transactions WHERE user_id = $1",
      [userId],
    );

    // Monthly account balances
    await manager.query(
      "DELETE FROM monthly_account_balances WHERE user_id = $1",
      [userId],
    );

    // Custom reports, import mappings
    await manager.query("DELETE FROM custom_reports WHERE user_id = $1", [
      userId,
    ]);
    await manager.query("DELETE FROM investment_reports WHERE user_id = $1", [
      userId,
    ]);
    await manager.query(
      "DELETE FROM import_column_mappings WHERE user_id = $1",
      [userId],
    );

    // AI data
    await manager.query("DELETE FROM ai_insights WHERE user_id = $1", [userId]);

    // Payees
    await manager.query("DELETE FROM payee_aliases WHERE user_id = $1", [
      userId,
    ]);
    await manager.query("DELETE FROM payees WHERE user_id = $1", [userId]);

    // Loan rate-change history and saved overpayment scenarios (both cascade
    // from accounts, deleted here explicitly before accounts)
    await manager.query("DELETE FROM loan_rate_changes WHERE user_id = $1", [
      userId,
    ]);
    await manager.query("DELETE FROM loan_scenarios WHERE user_id = $1", [
      userId,
    ]);

    // Clear account FK references to categories before deleting accounts
    await manager.query(
      "UPDATE accounts SET principal_category_id = NULL, interest_category_id = NULL, asset_category_id = NULL WHERE user_id = $1",
      [userId],
    );

    // Accounts
    await manager.query("DELETE FROM accounts WHERE user_id = $1", [userId]);

    // Institutions (accounts reference these via institution_id; deleted after
    // accounts so no rows still point at them)
    await manager.query("DELETE FROM institutions WHERE user_id = $1", [
      userId,
    ]);

    // Categories
    await manager.query("DELETE FROM categories WHERE user_id = $1", [userId]);

    // User preferences and auto-backup settings
    await manager.query("DELETE FROM auto_backup_settings WHERE user_id = $1", [
      userId,
    ]);
    await manager.query(
      "DELETE FROM user_currency_preferences WHERE user_id = $1",
      [userId],
    );
    await manager.query("DELETE FROM user_preferences WHERE user_id = $1", [
      userId,
    ]);

    // User-created currencies, but only ones nothing else still points at.
    //
    // Columns across most of the financial tables reference `currencies(code)`.
    // Deleting a row any of them still holds aborts the whole restore with
    // "violates foreign key constraint" -- except `user_currency_preferences`,
    // whose FK cascades and would silently remove another user's activation.
    //
    // This user's own accounts/transactions/securities/scheduled/budgets/prefs
    // are already deleted above, so a surviving reference is another user's (or
    // the global `exchange_rates`, which a restore never clears and which gets a
    // row for every currency the FX backfill has ever seen). That is exactly
    // what must block the delete.
    //
    // The `NOT EXISTS` chain this replaced listed every column but ran
    // inside this restore's transaction, where RLS filters every table to the
    // restoring user -- so the clauses looking for *other* users' rows could not
    // see them, and the cascade fired. `currency_code_in_use_globally`
    // (migration 136) is SECURITY DEFINER, so the answer is global, and it runs
    // in this transaction, so it stays atomic with the delete.
    await manager.query(
      `DELETE FROM currencies c
        WHERE c.created_by_user_id = $1
          AND NOT currency_code_in_use_globally(c.code)`,
      [userId],
    );
  }

  private async restoreDeferredFkColumns(
    manager: EntityManager,
    data: BackupData,
  ): Promise<void> {
    const byTable = data as unknown as Record<
      string,
      Record<string, unknown>[] | undefined
    >;

    // These UPDATEs run inside the restore's preserveTimestamps scope
    // (restoreData), so the `updated_at` BEFORE UPDATE triggers see
    // `app.preserve_timestamps = 'on'` and keep the values Phase 2 inserted
    // from the backup instead of stamping. No trigger DDL: the old
    // DISABLE/ENABLE pair required table ownership, which the runtime role
    // does not have under RLS enforcement.
    for (const {
      table,
      column,
      requireReferencedTable,
    } of DEFERRED_FK_REPAIRS) {
      const rows = byTable[table];
      if (!rows) continue;
      const sql = requireReferencedTable
        ? `UPDATE "${table}" SET "${column}" = $1 WHERE id = $2
           AND EXISTS (SELECT 1 FROM "${requireReferencedTable}" WHERE id = $1)`
        : `UPDATE "${table}" SET "${column}" = $1 WHERE id = $2`;
      for (const row of rows) {
        if (row[column] != null && row.id != null) {
          await manager.query(sql, [row[column], row.id]);
        }
      }
    }
  }

  private async ensureCurrenciesExist(
    manager: EntityManager,
    data: BackupData,
    userId: string,
  ): Promise<void> {
    // Collect all currency codes referenced across backup tables
    const referencedCodes = new Set<string>();
    const tablesWithCurrency: Array<{
      rows: Record<string, unknown>[] | undefined;
      column: string;
    }> = [
      { rows: data.user_currency_preferences, column: "currency_code" },
      { rows: data.user_preferences, column: "default_currency" },
      { rows: data.accounts, column: "currency_code" },
      { rows: data.transactions, column: "currency_code" },
      { rows: data.scheduled_transactions, column: "currency_code" },
      { rows: data.securities, column: "currency_code" },
      { rows: data.budgets, column: "currency_code" },
    ];

    for (const { rows, column } of tablesWithCurrency) {
      if (!rows) continue;
      for (const row of rows) {
        const code = row[column];
        if (typeof code === "string" && code.length > 0) {
          referencedCodes.add(code);
        }
      }
    }

    if (referencedCodes.size === 0) return;

    // First, restore user-created currencies from the backup (ON CONFLICT DO NOTHING)
    if (data.currencies) {
      // Validate column names against the actual currencies table schema to
      // prevent SQL injection via crafted backup data with malicious keys.
      const currencySchemaResult = await manager.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'currencies' AND table_schema = 'public'`,
      );
      const validCurrencyColumns = new Set<string>(
        currencySchemaResult.map((r: { column_name: string }) => r.column_name),
      );

      for (const row of data.currencies) {
        const filteredRow = { ...row };
        filteredRow.created_by_user_id = userId;

        // Strip column names not in the actual table schema
        for (const key of Object.keys(filteredRow)) {
          if (!validCurrencyColumns.has(key)) {
            delete filteredRow[key];
          }
        }

        const columns = Object.keys(filteredRow);
        const values = Object.values(filteredRow).map((v) =>
          v !== null && typeof v === "object" && !(v instanceof Date)
            ? JSON.stringify(v)
            : v,
        );
        if (columns.length === 0) continue;

        const columnList = columns.map((c) => `"${c}"`).join(", ");
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
        await manager.query(
          `INSERT INTO "currencies" (${columnList}) VALUES (${placeholders})
           ON CONFLICT (code) DO NOTHING`,
          values,
        );
      }
    }

    // Check which codes are still missing from the currencies table
    const codeArray = Array.from(referencedCodes);
    const existing: Array<{ code: string }> = await manager.query(
      `SELECT code FROM currencies WHERE code = ANY($1)`,
      [codeArray],
    );
    const existingSet = new Set(existing.map((r) => r.code));
    const missing = codeArray.filter((c) => !existingSet.has(c));

    // Auto-create entries for any still-missing currencies. System currencies
    // (USD, EUR, ...) are not part of a user backup, so on a fresh instance the
    // codes referenced by restored accounts/transactions land here. Resolve a
    // proper name/symbol/decimal-places from the currency metadata rather than
    // defaulting the symbol to the bare code.
    for (const code of missing) {
      const meta = resolveCurrencyMetadata(code);
      await manager.query(
        `INSERT INTO "currencies" ("code", "name", "symbol", "decimal_places", "is_active", "created_by_user_id")
         VALUES ($1, $2, $3, $4, true, $5)
         ON CONFLICT (code) DO NOTHING`,
        [code, meta.name, meta.symbol, meta.decimalPlaces, userId],
      );
      this.logger.log(
        `Auto-created missing currency ${code} during backup restore`,
      );
    }
  }

  private async insertRows(
    manager: EntityManager,
    table: string,
    rows: Record<string, unknown>[] | undefined,
    userId: string | null,
  ): Promise<number> {
    if (!rows || rows.length === 0) {
      return 0;
    }

    // Allowlist of tables that can be restored (single source of truth defined
    // at module scope and cross-checked by the coverage guard test).
    if (!RESTORABLE_TABLES.has(table)) {
      throw new BadRequestException(
        tr(
          "errors.backup.tableNotAllowed",
          `Table ${table} is not allowed in backup restore`,
          { table },
        ),
      );
    }

    // Columns that create circular or forward FK references and must be
    // deferred until all tables are populated (restored via UPDATE in Phase 3).
    // See restore-plan.ts; restore-plan.spec.ts proves the list covers every
    // such foreign key in database/schema.sql.
    const columnsToDefer = DEFERRED_FK_COLUMNS[table] ?? [];

    // Fetch all valid column names for this table from the schema. This serves
    // three purposes: (1) detect native PostgreSQL array columns so we can pass
    // JS arrays directly to the pg driver, (2) validate that column names from
    // the user-uploaded backup are real columns, preventing SQL injection via
    // crafted column names with embedded double-quote characters, and (3)
    // detect sequence-backed columns (e.g. BIGSERIAL `id`) that must be stripped
    // from the INSERT so PostgreSQL assigns a fresh value -- otherwise the
    // backup's bigint ids would collide with other users' rows on the shared
    // sequence and be silently skipped by ON CONFLICT DO NOTHING.
    const schemaColResult: Array<{
      column_name: string;
      data_type: string;
      column_default: string | null;
    }> = await manager.query(
      `SELECT column_name, data_type, column_default FROM information_schema.columns
       WHERE table_name = $1 AND table_schema = 'public'`,
      [table],
    );
    const validColumns = new Set<string>(
      schemaColResult.map((r) => r.column_name),
    );
    const pgArrayColumns = new Set<string>(
      schemaColResult
        .filter((r) => r.data_type === "ARRAY")
        .map((r) => r.column_name),
    );
    const sequenceBackedColumns = new Set<string>(
      schemaColResult
        .filter(
          (r) =>
            typeof r.column_default === "string" &&
            r.column_default.includes("nextval"),
        )
        .map((r) => r.column_name),
    );
    // BYTEA columns (e.g. institutions.logo_data) are base64-encoded in the
    // backup; their placeholders are wrapped in decode(..., 'base64') so the
    // bytes are restored correctly.
    const byteaColumns = new Set<string>(
      schemaColResult
        .filter((r) => r.data_type === "bytea")
        .map((r) => r.column_name),
    );

    let count = 0;
    for (const row of rows) {
      const filteredRow = { ...row };

      // Override user_id to ensure data stays scoped to the restoring user
      if (userId !== null && "user_id" in filteredRow) {
        filteredRow.user_id = userId;
      }

      // Preserve created_at and updated_at from the backup so that
      // restored records retain their original timestamps.

      // Strip deferred FK columns to avoid circular reference violations
      for (const col of columnsToDefer) {
        delete filteredRow[col];
      }

      // Strip sequence-backed columns (e.g. BIGSERIAL `id`) so the DB assigns
      // a fresh value. Reusing the backup's value would collide with other
      // users' rows on the shared sequence and be silently dropped by
      // ON CONFLICT DO NOTHING.
      for (const col of sequenceBackedColumns) {
        delete filteredRow[col];
      }

      // Strip any column names not present in the actual table schema to
      // prevent SQL injection via crafted backup data with malicious keys.
      for (const key of Object.keys(filteredRow)) {
        if (!validColumns.has(key)) {
          delete filteredRow[key];
        }
      }

      const columns = Object.keys(filteredRow);
      // Stringify object/array values for JSONB columns -- PostgreSQL requires
      // JSON text, not native JS objects, in parameterised queries. Native
      // PostgreSQL array columns (TEXT[], etc.) are left as JS arrays so the
      // pg driver serialises them in the correct {val1,val2} format.
      const values = Object.values(filteredRow).map((v, idx) =>
        v !== null && typeof v === "object" && !(v instanceof Date)
          ? Array.isArray(v) && pgArrayColumns.has(columns[idx])
            ? v
            : JSON.stringify(v)
          : v,
      );

      if (columns.length === 0) {
        continue;
      }

      const columnList = columns.map((c) => `"${c}"`).join(", ");
      const placeholders = columns
        .map((c, i) =>
          byteaColumns.has(c) ? `decode($${i + 1}, 'base64')` : `$${i + 1}`,
        )
        .join(", ");

      await manager.query(
        `INSERT INTO "${table}" (${columnList}) VALUES (${placeholders})
         ON CONFLICT DO NOTHING`,
        values,
      );
      count++;
    }

    return count;
  }
}
