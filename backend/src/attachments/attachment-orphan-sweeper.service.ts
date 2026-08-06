import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { DataSource, IsNull, LessThan } from "typeorm";
import { withScopedDb } from "../common/db/scoped-db";
import { affectedRowCount, returnedRows } from "../common/db/query-result";
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
 * How long a swept upload intent is kept after its object was deleted.
 *
 * The claim settles what *metadata* may commit; it cannot settle what bytes exist.
 * A put that stalled past its lease can land after the sweep has already deleted
 * the key, and a process killed before its own compensating delete leaves those
 * bytes with nothing referencing them and no tombstone to enumerate them
 * (audit RRV4-002). So the row outlives the writer: it is retained until this has
 * passed, and each hourly pass re-deletes the key -- `delete` is idempotent by
 * provider contract -- before finally retiring the row.
 *
 * Sized to outlast a stalled object-store call rather than to be exactly right;
 * being generous costs one row and one no-op delete per hour.
 */
export const LATE_WRITE_QUARANTINE_MS = 6 * 60 * 60 * 1000;

/**
 * The `SET late_write_quarantine_until = ...` fragment used by both claims.
 *
 * Two properties are load-bearing, and both come from where this sits. In an
 * UPDATE's SET list, `upload_lease_expires_at` reads the row's *old* value, so it
 * still says whether this row was an upload intent -- which is the only thing that
 * distinguishes it from a deletion record whose bytes nothing can write again. And
 * `COALESCE` makes the window set once and never extended: a quarantined row is
 * re-claimed on every pass until it is retired, and pushing the deadline forward
 * each time would keep it forever.
 *
 * `msParam` is the positional index of the window length; nothing interpolated here
 * comes from a request.
 */
const quarantineOnClaim = (msParam: number): string =>
  `COALESCE(
                  late_write_quarantine_until,
                  CASE WHEN upload_lease_expires_at IS NOT NULL
                       THEN CURRENT_TIMESTAMP
                            + ($${msParam}::text || ' milliseconds')::interval
                  END)`;

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
    // an upload intent has one until its request is done with it. A row already
    // swept has its lease cleared, so it falls into the first arm again -- which is
    // how a quarantined intent is revisited until its window passes.
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
    let quarantined = 0;
    for (const tombstone of pending) {
      try {
        if (!(await this.claim(tombstone.id))) {
          // An upload renewed its lease, or another replica got here first.
          continue;
        }
        await this.storage.delete(tombstone.storageKey);
        if (await this.retire(tombstone.id)) {
          removed += 1;
        } else {
          // An upload intent still inside its late-write window. The object is
          // gone, but the *record* has to outlive a put that may yet land, so the
          // row stays and the next pass deletes the key again before dropping it.
          quarantined += 1;
        }
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

    if (quarantined > 0) {
      // Said out loud rather than folded into `removed`: an operator reading
      // "deleted 3" while 5 rows remain in the table needs the difference to be
      // explicable from the log, not from reading this file.
      this.logger.debug(
        `${quarantined} swept upload intent(s) retained until their late-write window passes`,
      );
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
      // Conditional, like the cron's: this path normally holds a deletion record
      // and retires it at once, but the same key can carry a swept upload intent
      // whose late-write window has not passed, and that row has to survive the
      // put that may still land (audit RRV4-002).
      await this.retireKey(storageKey);
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
                upload_lease_expires_at = NULL,
                late_write_quarantine_until = ${quarantineOnClaim(2)}
          WHERE id = $1
            AND (upload_lease_expires_at IS NULL
                 OR upload_lease_expires_at < CURRENT_TIMESTAMP)
          RETURNING id`,
        [id, String(LATE_WRITE_QUARANTINE_MS)],
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
                upload_lease_expires_at = NULL,
                late_write_quarantine_until = ${quarantineOnClaim(3)}
          WHERE storage_provider = $1
            AND storage_key = $2
            AND (upload_lease_expires_at IS NULL
                 OR upload_lease_expires_at < CURRENT_TIMESTAMP)
          RETURNING id`,
        [this.storage.name, storageKey, String(LATE_WRITE_QUARANTINE_MS)],
      ),
    );
    return returnedRows<{ id: string }>(claimed).length > 0;
  }

  /**
   * Drop the tombstone now that its object is gone -- unless it is a swept upload
   * intent still inside its late-write window.
   *
   * A conditional DELETE rather than a read followed by one: the quarantine is the
   * reason the row exists at this point, so whether it may go is a predicate of the
   * statement that removes it. `false` means "kept", and the next hourly pass will
   * re-delete the key and try again.
   */
  private async retire(id: string): Promise<boolean> {
    const gone = await withScopedDb(this.dataSource, (m) =>
      m.query(
        `DELETE FROM attachment_blob_tombstones
          WHERE id = $1
            AND (late_write_quarantine_until IS NULL
                 OR late_write_quarantine_until < CURRENT_TIMESTAMP)
          RETURNING id`,
        [id],
      ),
    );
    return affectedRowCount(gone) > 0;
  }

  /** The same conditional retirement, addressed by key. */
  private async retireKey(storageKey: string): Promise<boolean> {
    const gone = await withScopedDb(this.dataSource, (m) =>
      m.query(
        `DELETE FROM attachment_blob_tombstones
          WHERE storage_provider = $1
            AND storage_key = $2
            AND (late_write_quarantine_until IS NULL
                 OR late_write_quarantine_until < CURRENT_TIMESTAMP)
          RETURNING id`,
        [this.storage.name, storageKey],
      ),
    );
    return affectedRowCount(gone) > 0;
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
