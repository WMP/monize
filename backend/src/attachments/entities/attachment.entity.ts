import { Exclude } from "class-transformer";
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

/**
 * Generic file attachment (receipts, invoices, screenshots, PDFs).
 *
 * Polymorphic by (entityType, entityId) so the same table backs AI-chat
 * uploads today and transaction attachments later without a schema change.
 * Bytes default to Postgres BYTEA (storageDriver='db', mirroring institution
 * logo storage); storageDriver/storageKey leave room for local-file or S3
 * backends where the bytes live elsewhere and `data` is null.
 */
@Entity("attachments")
@Index("idx_attachments_user", ["userId"])
@Index("idx_attachments_entity", ["entityType", "entityId"])
export class Attachment {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "user_id", type: "uuid" })
  userId: string;

  /** What the file is attached to, e.g. 'ai_chat' or 'transaction'. */
  @Column({ name: "entity_type", type: "varchar", length: 40 })
  entityType: string;

  /** The linked record, when applicable. Null for standalone uploads. */
  @Column({ name: "entity_id", type: "uuid", nullable: true })
  entityId: string | null;

  @Column({ name: "file_name", type: "varchar", length: 255 })
  fileName: string;

  @Column({ name: "mime_type", type: "varchar", length: 150 })
  mimeType: string;

  @Column({ name: "size_bytes", type: "int" })
  sizeBytes: number;

  /** Which backend holds the bytes: 'db' | 'local' | 's3'. */
  @Column({
    name: "storage_driver",
    type: "varchar",
    length: 20,
    default: "db",
  })
  storageDriver: string;

  /** Path/key for external stores; null when bytes are inline ('db'). */
  @Column({ name: "storage_key", type: "varchar", length: 500, nullable: true })
  storageKey: string | null;

  /** Inline bytes when storageDriver = 'db'. Excluded from default selects. */
  @Exclude()
  @Column({ type: "bytea", name: "data", nullable: true, select: false })
  data: Buffer | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;
}
