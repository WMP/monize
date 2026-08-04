import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { DataSource, LessThan } from "typeorm";
import { withScopedDb } from "../common/db/scoped-db";
import { withSystemContext } from "../common/db/with-context";
import { AttachmentBlobTombstone } from "./entities/attachment-blob-tombstone.entity";
import {
  ATTACHMENT_STORAGE_PROVIDER,
  AttachmentStorageProvider,
} from "./storage/attachment-storage.interface";

/** How many tombstones one sweep pass handles, so a large backlog is paced. */
export const ORPHAN_SWEEP_BATCH = 200;

/**
 * How old a tombstone must be before the cron sweep acts on it.
 *
 * Load-bearing, not a politeness. A tombstone is also written as an **upload
 * intent** before an object is put (`AttachmentsService.create`), and that row
 * exists for as long as the upload takes. Sweeping it while the upload is still
 * in flight would delete the bytes a metadata row is about to reference -- a
 * committed attachment pointing at nothing, which is worse than the orphan the
 * intent exists to prevent. The window only has to outlast one HTTP upload.
 *
 * The interactive path (`sweepKey`) is deliberately not delayed: its caller has
 * already committed the metadata delete, so there is nothing left to protect.
 */
export const ORPHAN_SWEEP_MIN_AGE_MS = 15 * 60 * 1000;

/**
 * Deletes attachment bytes whose metadata is already gone.
 *
 * This is the compensating half of the attachment lifecycle. Metadata deletion
 * is transactional and a trigger records a tombstone with it; this service then
 * performs the one operation PostgreSQL cannot roll back, *after* that
 * transaction has committed. Ordering it that way is the point: an external
 * delete before the commit is unrecoverable if the commit then fails, while an
 * external delete after it is merely pending until the next sweep.
 *
 * A tombstone is also how an upload records its **intent** before writing bytes,
 * because "these bytes may exist and nothing references them" is equally true of
 * an upload in flight and of a metadata row that is gone. One row shape, one
 * sweeper -- with a grace period so an upload still running is not swept out from
 * under itself (audit FV4-003).
 *
 * A tombstone for another provider is left alone rather than deleted. Its bytes
 * are unreachable through the currently bound provider, so dropping the record
 * would be throwing away the only remaining pointer to the object -- an operator
 * who switches the provider back can still clean up.
 */
@Injectable()
export class AttachmentOrphanSweeper {
  private readonly logger = new Logger(AttachmentOrphanSweeper.name);

  constructor(
    private readonly dataSource: DataSource,
    @Inject(ATTACHMENT_STORAGE_PROVIDER)
    private readonly storage: AttachmentStorageProvider,
  ) {}

  /**
   * Delete the objects for up to `ORPHAN_SWEEP_BATCH` tombstones belonging to
   * the active provider. Returns how many objects were removed.
   *
   * Each object is deleted and its tombstone dropped in that order: the provider
   * contract makes `delete` idempotent, so a crash between the two leaves a
   * tombstone whose retry is a no-op at the provider and a row removal here.
   * The reverse order would drop the only record of an object still present.
   */
  async sweep(): Promise<number> {
    const pending = await withScopedDb(this.dataSource, (m) =>
      m.getRepository(AttachmentBlobTombstone).find({
        where: {
          storageProvider: this.storage.name,
          // Older than the grace period: a young row may be an upload still in
          // flight, whose bytes a metadata row is about to reference. See
          // ORPHAN_SWEEP_MIN_AGE_MS.
          deletedAt: LessThan(new Date(Date.now() - ORPHAN_SWEEP_MIN_AGE_MS)),
        },
        order: { deletedAt: "ASC" },
        take: ORPHAN_SWEEP_BATCH,
      }),
    );

    let removed = 0;
    for (const tombstone of pending) {
      try {
        await this.storage.delete(tombstone.storageKey);
        await withScopedDb(this.dataSource, (m) =>
          m.getRepository(AttachmentBlobTombstone).delete({ id: tombstone.id }),
        );
        removed += 1;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        // Recorded on the row rather than only logged: a provider that keeps
        // refusing one key needs to be diagnosable from the database, and the
        // attempt count is what distinguishes a transient outage from a key the
        // provider will never accept.
        await withScopedDb(this.dataSource, (m) =>
          m.query(
            `UPDATE attachment_blob_tombstones
                SET attempts = attempts + 1, last_error = $2
              WHERE id = $1`,
            [tombstone.id, detail],
          ),
        ).catch(() => undefined);
        this.logger.warn(
          `Failed to delete orphaned attachment object ${tombstone.storageKey}: ${detail}`,
        );
      }
    }

    return removed;
  }

  /**
   * Sweep the tombstone for one key, right after its metadata delete committed,
   * so an interactive delete removes the bytes promptly instead of waiting for
   * the cron. Best effort: the cron below is the guarantee.
   */
  async sweepKey(storageKey: string): Promise<void> {
    if (this.storage.name === "database") return;
    try {
      await this.storage.delete(storageKey);
      await withScopedDb(this.dataSource, (m) =>
        m
          .getRepository(AttachmentBlobTombstone)
          .delete({ storageProvider: this.storage.name, storageKey }),
      );
    } catch (error) {
      this.logger.warn(
        `Deferred deletion of attachment object ${storageKey} to the sweeper: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async sweepOrphanedObjects(): Promise<void> {
    if (this.storage.name === "database") return;
    try {
      // Cross-user by construction -- a tombstone may have outlived its owner,
      // and its user_id is then NULL.
      const removed = await withSystemContext(() => this.sweep());
      if (removed > 0) {
        this.logger.log(`Deleted ${removed} orphaned attachment object(s)`);
      }
    } catch (error) {
      this.logger.warn(
        `Attachment orphan sweep failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
