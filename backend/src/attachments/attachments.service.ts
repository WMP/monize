import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { createHash, randomUUID } from "crypto";
import { DataSource, EntityManager } from "typeorm";
import {
  runOutsideActiveScopedManager,
  withScopedDb,
} from "../common/db/scoped-db";
import { lockTransactionRow } from "../common/db/locks";
import { affectedRowCount, returnedRows } from "../common/db/query-result";
import { AttachmentOrphanSweeper } from "./attachment-orphan-sweeper.service";
import { AttachmentBlobTombstone } from "./entities/attachment-blob-tombstone.entity";
import { tr } from "../i18n/translate";
import { TransactionAttachment } from "./entities/transaction-attachment.entity";
import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  sniffAttachmentMime,
} from "./attachment-mime.util";
import {
  ATTACHMENT_STORAGE_PROVIDER,
  AttachmentStorageProvider,
} from "./storage/attachment-storage.interface";

/**
 * How long an upload owns the key it is about to write.
 *
 * A *latency* mechanism, not the safety one: it keeps the orphan sweep away from
 * an upload that is probably still running, so the fence in `clearUploadIntent`
 * stays a safety net rather than a routine source of failed uploads. Correctness
 * does not depend on the value being right, which is the whole difference from the
 * age check it replaced (audit RV4-002).
 */
export const UPLOAD_INTENT_LEASE_MS = 15 * 60 * 1000;

/**
 * The sweeper claimed this upload's object before the metadata could commit.
 *
 * Thrown inside that transaction, so it rolls back -- the alternative is a
 * committed attachment row whose bytes have been deleted, which a successful 201
 * makes invisible until someone tries to download their receipt.
 */
export class AttachmentObjectSweptError extends Error {
  constructor(storageKey: string) {
    super(
      `Attachment object ${storageKey} was swept as an orphan before its metadata committed`,
    );
    this.name = "AttachmentObjectSweptError";
  }
}

/** Largest single attachment we accept (also enforced by the upload interceptor). */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB
/** Maximum attachments per transaction. */
export const MAX_ATTACHMENTS_PER_TRANSACTION = 10;

export interface AttachmentDownload {
  data: Buffer;
  contentType: string;
  filename: string;
  byteSize: number;
}

/**
 * Uploaded file shape we depend on -- a subset of Express.Multer.File so callers
 * (and tests) need not construct the full multer object.
 */
export interface UploadedAttachmentFile {
  originalname: string;
  buffer: Buffer;
  size: number;
}

@Injectable()
export class AttachmentsService {
  private readonly logger = new Logger(AttachmentsService.name);

  constructor(
    private readonly dataSource: DataSource,
    @Inject(ATTACHMENT_STORAGE_PROVIDER)
    private readonly storage: AttachmentStorageProvider,
    private readonly orphanSweeper: AttachmentOrphanSweeper,
  ) {}

  /**
   * Store an uploaded file against a transaction. Validates size, sniffs the
   * real MIME type (never trusting the client), enforces the per-transaction
   * cap, and writes metadata + bytes together.
   *
   * "Together" means different things per provider, and the difference matters:
   * the database provider's blob write joins this transaction and genuinely
   * commits or rolls back with the metadata row, while a local filesystem write
   * or an S3 put cannot. For those, a commit failure after the object is written
   * leaves bytes nothing references.
   *
   * The catch below deletes them, but a catch is not a guarantee: it runs only if
   * this process is still alive. Killed between the put and the commit, the bytes
   * survived with no metadata row -- and therefore no tombstone, so the orphan
   * sweep could not find them either. Undiscoverable is the part that matters:
   * unreferenced bytes nobody can enumerate accumulate forever and no operator
   * can tell they are there (audit FV4-003).
   *
   * So an **upload intent** is committed before a single byte is written: a
   * tombstone for the key this upload is about to use, in its own transaction, so
   * it is durable independently of what happens next. Success deletes it *inside*
   * the metadata transaction, which is what makes the pair atomic -- a commit
   * drops the intent with the row that now owns the bytes, and a rollback keeps
   * it, so the sweeper finds the object whether this process survives or not.
   *
   * That delete is also a **fence**. The intent and the deletion record are the
   * same row shape, and the sweeper cannot tell them apart by age -- nothing bounds
   * an upload to any window, so a stalled put or commit outlives one and the sweep
   * deletes bytes this transaction is about to reference. So the sweeper claims the
   * row before deleting the object, and the clear requires the claim to be absent:
   * one of the two loses, and it is never the case that metadata commits pointing
   * at bytes that are gone (audit RV4-002).
   *
   * The fence settles what *metadata* may commit. It cannot settle what bytes
   * exist, because a put that stalled past its lease can land *after* the sweep
   * deleted the key -- and if this process is then killed before the `catch` below,
   * those bytes are unreferenced with no row left to enumerate them. That is why the
   * sweeper keeps a claimed upload intent for `LATE_WRITE_QUARANTINE_MS` instead of
   * dropping the row with the object: the record outlives the writer, so the next
   * pass deletes the late object and only then retires the row (audit RRV4-002).
   */
  async create(
    userId: string,
    transactionId: string,
    file: UploadedAttachmentFile | undefined,
  ): Promise<TransactionAttachment> {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException(
        tr("errors.attachments.empty", "Uploaded file is empty"),
      );
    }
    if (file.buffer.length > MAX_ATTACHMENT_BYTES) {
      throw new PayloadTooLargeException(
        tr(
          "errors.attachments.fileTooLarge",
          `File exceeds the maximum size of ${MAX_ATTACHMENT_BYTES} bytes`,
          { max: MAX_ATTACHMENT_BYTES },
        ),
      );
    }

    const contentType = sniffAttachmentMime(file.buffer);
    if (!contentType) {
      const types = ALLOWED_ATTACHMENT_MIME_TYPES.join(", ");
      throw new UnsupportedMediaTypeException(
        tr(
          "errors.attachments.unsupportedType",
          `Unsupported file type. Allowed types: ${types}`,
          { types },
        ),
      );
    }

    const filename = sanitizeFilename(file.originalname);
    const sha256 = createHash("sha256").update(file.buffer).digest("hex");
    const id = randomUUID();

    // Committed before the put, on its own connection: an intent that shares the
    // metadata transaction would roll back with it and record nothing, which is
    // the whole failure being fixed here.
    await this.recordUploadIntent(userId, id);

    let objectWritten = false;
    try {
      return await withScopedDb(this.dataSource, async (m) => {
        // Lock the parent transaction before counting. The cap is a refusal, and
        // a count taken without the lock is a check-then-act: at 9 attachments
        // two uploads both counted 9, both passed `< 10`, and the transaction
        // ended with 11 (audit P4-017). Every uploader now queues behind the
        // same row, so the count each one sees includes its predecessor.
        const locked = await lockTransactionRow(m, transactionId, userId);
        if (!locked) {
          throw new NotFoundException(
            tr(
              "errors.attachments.transactionNotFound",
              "Transaction not found",
            ),
          );
        }

        const existing = await m
          .getRepository(TransactionAttachment)
          .count({ where: { transactionId, userId } });
        if (existing >= MAX_ATTACHMENTS_PER_TRANSACTION) {
          throw new BadRequestException(
            tr(
              "errors.attachments.tooMany",
              `This transaction already has the maximum of ${MAX_ATTACHMENTS_PER_TRANSACTION} attachments`,
              { max: MAX_ATTACHMENTS_PER_TRANSACTION },
            ),
          );
        }

        const repo = m.getRepository(TransactionAttachment);
        const attachment = repo.create({
          id,
          userId,
          transactionId,
          filename,
          contentType,
          byteSize: file.buffer.length,
          sha256,
          storageProvider: this.storage.name,
          storageKey: id,
        });
        const saved = await repo.save(attachment);

        // The database provider's nested withScopedDb joins this transaction, so
        // its blob commits with the metadata row. An external provider does not,
        // which is what `objectWritten` records.
        await this.storage.save(id, file.buffer);
        objectWritten = this.storage.name !== "database";

        // Clearing the intent joins this transaction on purpose: it commits with
        // the metadata row that now owns the bytes, and a rollback after this
        // point keeps the intent, so the sweeper still finds the object.
        await this.clearUploadIntent(m, id);

        return saved;
      });
    } catch (error) {
      if (objectWritten) {
        // The transaction rolled back after the object was written, so nothing
        // references those bytes. Remove them now for promptness; the intent
        // committed above is what makes this optional rather than the only
        // chance, so a failure here is a warning and not a leak.
        await this.storage
          .delete(id)
          .then(() => this.clearCommittedUploadIntent(id))
          .catch((cleanupError: unknown) =>
            this.logger.warn(
              `Attachment ${id} rolled back but its stored object could not be ` +
                `removed; left to the orphan sweep: ` +
                `${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
            ),
          );
      } else {
        // Refused before anything was written -- the cap, a missing parent. There
        // are no bytes at this key, so drop the intent rather than leaving the
        // sweeper a no-op delete to discover.
        await this.clearCommittedUploadIntent(id);
      }
      throw error;
    }
  }

  /**
   * Record that bytes are about to be written at `storageKey`, and commit it.
   *
   * A tombstone means "these bytes may exist and nothing references them", which
   * is exactly true of an upload in flight -- so the intent and the deletion
   * record are the same row shape and the same sweeper handles both. The sweeper
   * skips rows younger than its grace period, which is what stops it deleting an
   * upload that is still in progress.
   *
   * `runOutsideActiveScopedManager` because `create` may itself be called inside
   * a caller's transaction: joining it would make the intent roll back with the
   * work it exists to outlive.
   *
   * The conflict arm deliberately does **not** clear `swept_at`. Storage keys are
   * per-upload UUIDs so a conflict with a swept row is not reachable today, but
   * resurrecting one would un-fence the sweeper's claim -- and a claimed row may be
   * inside its late-write quarantine, in which case bytes are pending deletion at
   * that key. Refusing is the only answer that stays true if a provider ever hands
   * out reusable keys.
   */
  private async recordUploadIntent(
    userId: string,
    storageKey: string,
  ): Promise<void> {
    if (this.storage.name === "database") return;
    const claimed = await runOutsideActiveScopedManager(() =>
      withScopedDb(this.dataSource, (m) =>
        m.query(
          `INSERT INTO attachment_blob_tombstones
             (user_id, storage_provider, storage_key, upload_lease_expires_at)
           VALUES ($1, $2, $3,
                   CURRENT_TIMESTAMP + ($4::text || ' milliseconds')::interval)
           ON CONFLICT (storage_provider, storage_key)
           DO UPDATE SET upload_lease_expires_at = EXCLUDED.upload_lease_expires_at
             WHERE attachment_blob_tombstones.swept_at IS NULL
           RETURNING id`,
          [
            userId,
            this.storage.name,
            storageKey,
            String(UPLOAD_INTENT_LEASE_MS),
          ],
        ),
      ),
    );
    // An `INSERT` comes back as bare rows whatever the RETURNING, so this is
    // `returnedRows` and not a length check on a shape nobody confirmed.
    if (returnedRows<{ id: string }>(claimed).length === 0) {
      throw new AttachmentObjectSweptError(storageKey);
    }
  }

  /**
   * Drop the intent inside the caller's transaction, so it commits with the row --
   * and refuse if the sweeper has already claimed the object.
   *
   * `swept_at IS NULL` is the fence. The sweeper sets it before deleting the
   * bytes, and this statement contends for the same row, so PostgreSQL admits only
   * two outcomes: this transaction clears the intent and commits metadata for
   * bytes that are still there, or the sweeper claimed first and this throws and
   * rolls back. A committed metadata row pointing at deleted bytes -- which the
   * previous age-only check permitted whenever an upload outlived the grace window
   * -- is not reachable (audit RV4-002).
   */
  private async clearUploadIntent(
    m: EntityManager,
    storageKey: string,
  ): Promise<void> {
    if (this.storage.name === "database") return;
    const cleared = await m.query(
      `DELETE FROM attachment_blob_tombstones
        WHERE storage_provider = $1 AND storage_key = $2 AND swept_at IS NULL
        RETURNING id`,
      [this.storage.name, storageKey],
    );
    if (affectedRowCount(cleared) === 0) {
      throw new AttachmentObjectSweptError(storageKey);
    }
  }

  /** Drop the intent in its own transaction, when there is no work to bind it to. */
  private async clearCommittedUploadIntent(storageKey: string): Promise<void> {
    if (this.storage.name === "database") return;
    await runOutsideActiveScopedManager(() =>
      withScopedDb(this.dataSource, (m) =>
        m.getRepository(AttachmentBlobTombstone).delete({
          storageProvider: this.storage.name,
          storageKey,
        }),
      ),
    ).catch((error: unknown) =>
      this.logger.warn(
        `Could not clear the upload intent for ${storageKey}; the orphan sweep ` +
          `will retry a no-op delete: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }

  /** List attachment metadata for one of the user's transactions (no bytes). */
  async findAllForTransaction(
    userId: string,
    transactionId: string,
  ): Promise<TransactionAttachment[]> {
    return withScopedDb(this.dataSource, (m) =>
      m.getRepository(TransactionAttachment).find({
        where: { transactionId, userId },
        order: { createdAt: "ASC" },
      }),
    );
  }

  /** Load one attachment's bytes and headers for streaming download. */
  async getForDownload(
    userId: string,
    id: string,
  ): Promise<AttachmentDownload> {
    const attachment = await withScopedDb(this.dataSource, (m) =>
      m.getRepository(TransactionAttachment).findOne({ where: { id, userId } }),
    );
    if (!attachment) {
      throw new NotFoundException(
        tr("errors.attachments.notFound", "Attachment not found"),
      );
    }

    const data = await this.storage.load(attachment.storageKey);
    return {
      data,
      contentType: attachment.contentType,
      filename: attachment.filename,
      byteSize: attachment.byteSize,
    };
  }

  /**
   * Delete an attachment (metadata + bytes) the user owns.
   *
   * The metadata delete commits first and the object goes afterwards. That order
   * is deliberate and was previously the other way round: deleting the object
   * inside the transaction meant a commit failure left metadata pointing at bytes
   * that no longer existed -- a download that can only fail, with nothing to
   * retry (audit P4-010).
   *
   * The `AFTER DELETE` trigger records a tombstone in the same transaction, so
   * the object is deleted even if this process dies here, and even when the row
   * goes away through a path with no application code at all: a parent
   * transaction's ON DELETE CASCADE, a restore wipe, an account deletion.
   */
  async remove(userId: string, id: string): Promise<void> {
    const storageKey = await withScopedDb(this.dataSource, async (m) => {
      const deleted: unknown = await m.query(
        `DELETE FROM transaction_attachments
          WHERE id = $1 AND user_id = $2
          RETURNING storage_key`,
        [id, userId],
      );
      const rows = returnedRows<{ storage_key: string }>(deleted);
      if (rows.length === 0) {
        // "Not found" covers both never-existed and already-deleted-by-a-
        // concurrent-request. Either way there is nothing left to sweep.
        throw new NotFoundException(
          tr("errors.attachments.notFound", "Attachment not found"),
        );
      }
      return rows[0].storage_key;
    });

    // Committed. Now the part PostgreSQL could not have rolled back.
    await this.orphanSweeper.sweepKey(storageKey);
  }
}

/**
 * Reduce a client-supplied filename to a safe display name: strip any path
 * components and control characters, collapse to a fallback when empty, and cap
 * at the column length.
 */
export function sanitizeFilename(raw: string | undefined): string {
  const base = (raw ?? "").split(/[\\/]/).pop() ?? "";
  // Remove control chars (including CR/LF) that could break Content-Disposition.
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\x00-\x1f\x7f]/g, "").trim();
  const safe = cleaned.length > 0 ? cleaned : "attachment";
  return safe.slice(0, 255);
}
