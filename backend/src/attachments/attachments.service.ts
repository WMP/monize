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
import { DataSource } from "typeorm";
import { withScopedDb } from "../common/db/scoped-db";
import { lockTransactionRow } from "../common/db/locks";
import { returnedRows } from "../common/db/query-result";
import { AttachmentOrphanSweeper } from "./attachment-orphan-sweeper.service";
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
   * leaves bytes nothing references, so the catch below deletes them -- and the
   * hourly orphan sweep is the backstop for a process that dies before it can.
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

        return saved;
      });
    } catch (error) {
      if (objectWritten) {
        // The transaction rolled back after the object was written. Nothing
        // references those bytes now, so remove them; the orphan sweep cannot
        // find them either, because there is no metadata row and therefore no
        // tombstone.
        await this.storage
          .delete(id)
          .catch((cleanupError: unknown) =>
            this.logger.warn(
              `Attachment ${id} rolled back but its stored object could not be ` +
                `removed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
            ),
          );
      }
      throw error;
    }
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
