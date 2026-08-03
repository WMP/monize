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
import { tr } from "../i18n/translate";
import { Transaction } from "../transactions/entities/transaction.entity";
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
  ) {}

  /**
   * Store an uploaded file against a transaction. Validates size, sniffs the
   * real MIME type (never trusting the client), and enforces the per-transaction
   * cap.
   *
   * Only the `database` provider's bytes are transactional -- its `save` is a
   * nested `withScopedDb` that joins this transaction. `local` and `s3` write
   * outside it, so the ordering of the object write against the commit is a
   * decision rather than an accident; see the comment at the write.
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

    return withScopedDb(this.dataSource, async (m) => {
      const transaction = await m
        .getRepository(Transaction)
        .findOne({ where: { id: transactionId, userId } });
      if (!transaction) {
        throw new NotFoundException(
          tr("errors.attachments.transactionNotFound", "Transaction not found"),
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

      // The database provider's `save` is a nested withScopedDb, so it joins this
      // transaction and the bytes commit with the metadata row -- or roll back
      // with it. For `local` and `s3` there is no such guarantee: the object
      // write is not part of any transaction.
      //
      // Bytes first, deliberately. If the commit then fails the object is
      // orphaned, which costs storage and nothing else; writing after the commit
      // would instead leave a metadata row promising a download that does not
      // exist, and the user cannot tell that apart from a working attachment.
      // The orphan is cleaned up below on the paths we can see.
      await this.storage.save(id, file.buffer);

      return saved;
    }).catch(async (error) => {
      if (!this.storageIsTransactional) {
        await this.discardOrphanedBytes(id);
      }
      throw error;
    });
  }

  /** Whether the active provider's writes participate in the DB transaction. */
  private get storageIsTransactional(): boolean {
    return this.storage.name === "database";
  }

  /**
   * Best-effort removal of bytes written for a row that did not commit. Failing
   * here must not replace the caller's error, which is the one that explains
   * what went wrong.
   */
  private async discardOrphanedBytes(key: string): Promise<void> {
    try {
      await this.storage.delete(key);
    } catch {
      // Left orphaned. Storage cost, not a correctness problem -- unlike the
      // reverse ordering, which would leave a broken attachment.
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

  /** Delete an attachment (metadata + bytes) the user owns. */
  async remove(userId: string, id: string): Promise<void> {
    const attachment = await withScopedDb(this.dataSource, (m) =>
      m.getRepository(TransactionAttachment).findOne({ where: { id, userId } }),
    );
    if (!attachment) {
      throw new NotFoundException(
        tr("errors.attachments.notFound", "Attachment not found"),
      );
    }

    await withScopedDb(this.dataSource, async (m) => {
      // Removing the metadata row cascades to attachment_blobs, so the database
      // provider's bytes go with it inside this transaction.
      await m.getRepository(TransactionAttachment).delete({ id, userId });
      if (this.storageIsTransactional) {
        await this.storage.delete(attachment.storageKey);
      }
    });

    // External bytes are deleted only after the metadata row is committed gone.
    //
    // This used to happen inside the transaction, which had the ordering exactly
    // backwards: a commit failure after the object was deleted left the metadata
    // row in place, pointing at bytes that no longer existed. The user saw an
    // attachment they could not download and could not tell from a working one.
    //
    // After the commit, a failure here leaves an orphaned object instead -- a
    // storage cost with nothing referencing it. `delete` is idempotent, so a
    // retry is harmless.
    if (!this.storageIsTransactional) {
      try {
        await this.storage.delete(attachment.storageKey);
      } catch (error) {
        this.logger.warn(
          `Attachment ${id} was deleted but its bytes could not be removed from ` +
            `${this.storage.name} storage (key ${attachment.storageKey}): ${error.message}`,
        );
      }
    }
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
