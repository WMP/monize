import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { User } from "../../users/entities/user.entity";

/**
 * One attachment object whose metadata is gone and whose bytes still need
 * deleting.
 *
 * Only the database storage provider keeps bytes where PostgreSQL can roll them
 * back. A local filesystem write and an S3 put cannot participate in the
 * transaction, so the old order -- delete the object, then commit the metadata
 * delete -- left the bytes gone and the metadata intact whenever the commit
 * failed. And deleting a *transaction* removes its attachment metadata by
 * `ON DELETE CASCADE`, with no application code running at all, so those objects
 * were never deleted and accumulated with nothing able to find them (P4-010).
 *
 * A row here is written by an `AFTER DELETE` trigger, which is why it covers
 * every path the application does not control: the cascade, a restore wipe, an
 * account deletion. `AttachmentOrphanSweeper` then deletes the object and drops
 * the row, so a crash between the two costs a retry instead of an orphan.
 */
@Entity("attachment_blob_tombstones")
@Index(["storageProvider", "storageKey"], { unique: true })
export class AttachmentBlobTombstone {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  /**
   * Who owned the attachment. Nullable and `ON DELETE SET NULL`, not CASCADE:
   * deleting a user is exactly when their bytes most need removing, so the
   * tombstone has to outlive them.
   */
  @Column({ type: "uuid", name: "user_id", nullable: true })
  userId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "user_id" })
  user?: User | null;

  /** Which backend holds the bytes, e.g. `local` or `s3`. */
  @Column({ type: "varchar", name: "storage_provider", length: 20 })
  storageProvider: string;

  /** The provider-opaque key the bytes are addressed by. */
  @Column({ type: "varchar", name: "storage_key", length: 255 })
  storageKey: string;

  @CreateDateColumn({ name: "deleted_at" })
  deletedAt: Date;

  /**
   * Non-NULL marks this row as an **upload intent** -- bytes about to be written,
   * with nothing referencing them yet -- and says until when the uploader owns it.
   *
   * The sweeper skips a live lease, which is a *latency* mechanism and not the
   * safety one: it exists so a sweep does not cause upload failures it could have
   * avoided. Correctness comes from `sweptAt`. NULL means an ordinary deletion
   * record, written by the trigger, swept as soon as it is seen.
   */
  @Column({
    type: "timestamp",
    name: "upload_lease_expires_at",
    nullable: true,
  })
  uploadLeaseExpiresAt: Date | null;

  /**
   * The sweeper's claim on this object, taken *before* the external delete.
   *
   * This is what makes an age check unnecessary for correctness. The uploader's
   * "clear the intent" step requires `swept_at IS NULL` and runs inside the
   * transaction that commits the metadata row, so the two contend on this row and
   * only two outcomes exist: the uploader wins and the object is kept, or the
   * sweeper wins and the uploader rolls back. Metadata pointing at deleted bytes
   * is not one of them (audit RV4-002).
   */
  @Column({ type: "timestamp", name: "swept_at", nullable: true })
  sweptAt: Date | null;

  /** Failed sweep attempts, for diagnosing a provider that keeps refusing. */
  @Column({ type: "int", name: "attempts", default: 0 })
  attempts: number;

  @Column({ type: "text", name: "last_error", nullable: true })
  lastError: string | null;
}
