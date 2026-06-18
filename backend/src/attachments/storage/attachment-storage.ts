import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Attachment } from "../entities/attachment.entity";

/**
 * Pluggable storage backend for attachment bytes.
 *
 * The default 'db' driver keeps bytes inline in the attachment row (Postgres
 * BYTEA), matching how institution logos are stored. 'local' (filesystem) and
 * 's3' are intentionally not implemented yet -- this interface and the factory
 * below are the seam the maintainer can fill in (see kenlasko/monize #687,
 * which plans DB first, then optional local/S3) without touching the service or
 * controller.
 */
export interface AttachmentStorageProvider {
  readonly driver: string;

  /**
   * Persist the bytes for a new attachment. Returns what the entity should
   * record: `inlineData` for the BYTEA column (db driver) and/or a
   * `storageKey` locating the bytes in an external store.
   */
  save(
    id: string,
    data: Buffer,
  ): Promise<{ inlineData: Buffer | null; storageKey: string | null }>;

  /** Read the bytes back for download. */
  load(attachment: Attachment): Promise<Buffer>;

  /** Remove any externally held bytes. Inline (db) bytes vanish with the row. */
  remove(attachment: Attachment): Promise<void>;
}

/** DI token for the active storage provider. */
export const ATTACHMENT_STORAGE = Symbol("ATTACHMENT_STORAGE");

/**
 * Default backend: bytes live in the attachment row's BYTEA column. `load`
 * relies on the service having selected `data` (which is `select: false`).
 */
export class DbAttachmentStorage implements AttachmentStorageProvider {
  readonly driver = "db";

  save(
    _id: string,
    data: Buffer,
  ): Promise<{ inlineData: Buffer | null; storageKey: string | null }> {
    return Promise.resolve({ inlineData: data, storageKey: null });
  }

  async load(attachment: Attachment): Promise<Buffer> {
    if (!attachment.data) {
      throw new Error(`Attachment ${attachment.id} has no inline data`);
    }
    return attachment.data;
  }

  remove(): Promise<void> {
    // Inline bytes are removed when the row is deleted.
    return Promise.resolve();
  }
}

/**
 * Selects the storage provider from `ATTACHMENT_STORAGE_DRIVER` (default 'db').
 * Adding a real local/S3 backend means implementing AttachmentStorageProvider
 * and returning it from the matching case here -- nothing else changes.
 */
export function attachmentStorageFactory(
  config: ConfigService,
): AttachmentStorageProvider {
  const logger = new Logger("AttachmentStorage");
  const driver = config.get<string>("ATTACHMENT_STORAGE_DRIVER") ?? "db";
  switch (driver) {
    case "db":
      return new DbAttachmentStorage();
    case "local":
    case "s3":
      logger.warn(
        `ATTACHMENT_STORAGE_DRIVER='${driver}' is not implemented yet; falling back to 'db'. Implement an AttachmentStorageProvider for '${driver}'.`,
      );
      return new DbAttachmentStorage();
    default:
      logger.warn(
        `Unknown ATTACHMENT_STORAGE_DRIVER='${driver}'; falling back to 'db'.`,
      );
      return new DbAttachmentStorage();
  }
}
