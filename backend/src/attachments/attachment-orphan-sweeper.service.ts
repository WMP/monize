import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { DataSource, IsNull, LessThan } from "typeorm";
import { withScopedDb } from "../common/db/scoped-db";
import { returnedRows } from "../common/db/query-result";
import { withSystemContext } from "../common/db/with-context";
import { AttachmentBlobTombstone } from "./entities/attachment-blob-tombstone.entity";
import {
  ATTACHMENT_STORAGE_PROVIDER,
  AttachmentStorageProvider,
} from "./storage/attachment-storage.interface";

/** How many tombstones one sweep pass handles, so a large backlog is paced. */
export const ORPHAN_SWEEP_BATCH = 200;

/**
 * The sweeper takes an object by claiming its tombstone first.
 *
 * A tombstone is also written as an **upload intent** before an object is put
 * (`AttachmentsService.create`), so the same row shape means two things, and an
 * age check cannot tell them apart safely: nothing bounds an upload to any
 * particular window, so a stalled object-store call or commit outlives it and the
 * sweep deletes bytes a transaction is about to reference. That is worse than the
 * orphan the intent prevents -- an orphan wastes space, this loses the user's
 * receipt behind a 201.
 *
 * So `swept_at` is set by a conditional UPDATE *before* the external delete, and
 * `AttachmentsService`'s "clear the intent" step requires it to still be NULL
 * inside the transaction that commits the metadata row. Both contend on one row,
 * so PostgreSQL picks a winner and only two outcomes exist: the uploader clears the
 * intent and its metadata commits with the bytes present, or the sweeper claims
 * first and the uploader rolls back. Metadata pointing at deleted bytes is not
 * among them (audit RV4-002).
 *
 * The upload lease (`upload_lease_expires_at`) is a separate, weaker thing: it
 * keeps the sweeper away from an upload that is probably still running, so the
 * fence above stays a safety net rather than a routine source of failed uploads.
 */
export const SWEEP_CLAIM_NOTE = "see AttachmentsService.clearUploadIntent";

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
 * sweeper (audit FV4-003) -- and, because those two meanings cannot be told apart
 * by age, one conditional claim that the uploader is fenced against
 * (audit RV4-002). See `SWEEP_CLAIM_NOTE` above.
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
    // Candidates: no live upload lease. A row the trigger wrote has none at all;
    // an upload intent has one until its request is done with it.
    const pending = await withScopedDb(this.dataSource, (m) =>
      m.getRepository(AttachmentBlobTombstone).find({
        where: [
          {
            storageProvider: this.storage.name,
            uploadLeaseExpiresAt: IsNull(),
          },
          {
            storageProvider: this.storage.name,
            uploadLeaseExpiresAt: LessThan(new Date()),
          },
        ],
        order: { deletedAt: "ASC" },
        take: ORPHAN_SWEEP_BATCH,
      }),
    );

    let removed = 0;
    for (const tombstone of pending) {
      try {
        if (!(await this.claim(tombstone.id))) {
          // An upload renewed its lease, or another replica got here first.
          continue;
        }
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
      // Through the same claim as the cron, so there is one place that decides an
      // object may be deleted. This caller has already committed the metadata
      // delete, so there is no upload to lose -- but a *different* upload could
      // have reused the key, and the claim is what refuses that rather than
      // reasoning about whether it can happen.
      if (!(await this.claimKey(storageKey))) return;
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

  /**
   * Take ownership of one tombstone, or refuse.
   *
   * Conditional on there being no live upload lease and on nobody having claimed
   * it already. Committed *before* the external delete, which is what lets the
   * uploader's `clearUploadIntent` be refused: the two statements contend on this
   * row, so exactly one of "the object survives with metadata" and "the object is
   * deleted with none" happens.
   */
  private async claim(id: string): Promise<boolean> {
    const claimed = await withScopedDb(this.dataSource, (m) =>
      m.query(
        `UPDATE attachment_blob_tombstones
            SET swept_at = CURRENT_TIMESTAMP,
                upload_lease_expires_at = NULL
          WHERE id = $1
            AND (upload_lease_expires_at IS NULL
                 OR upload_lease_expires_at < CURRENT_TIMESTAMP)
          RETURNING id`,
        [id],
      ),
    );
    return returnedRows<{ id: string }>(claimed).length > 0;
  }

  /** The same claim, addressed by key, for the interactive path. */
  private async claimKey(storageKey: string): Promise<boolean> {
    const claimed = await withScopedDb(this.dataSource, (m) =>
      m.query(
        `UPDATE attachment_blob_tombstones
            SET swept_at = CURRENT_TIMESTAMP,
                upload_lease_expires_at = NULL
          WHERE storage_provider = $1
            AND storage_key = $2
            AND (upload_lease_expires_at IS NULL
                 OR upload_lease_expires_at < CURRENT_TIMESTAMP)
          RETURNING id`,
        [this.storage.name, storageKey],
      ),
    );
    return returnedRows<{ id: string }>(claimed).length > 0;
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
