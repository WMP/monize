import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { createHash } from "node:crypto";
import { DataSource, EntityManager } from "typeorm";
import { withScopedDb } from "../../common/db/scoped-db";
import { withSystemContext } from "../../common/db/with-context";
import { ImportStagedFile } from "./entities/import-staged-file.entity";

/**
 * Server-side staging for a binary import file (design ADR-2).
 *
 * The wizard uploads once, previews, and only then starts the import. With more
 * than one backend replica the start call can land on a different pod than the
 * upload, so the bytes have to live somewhere both can reach: the database.
 *
 * What is staged is the **decrypted** file, so the Money password is spent on
 * the parse request and never persisted. The import re-parses these bytes rather
 * than a serialized intermediate representation, which is what makes the preview
 * and the import provably agree.
 */

/** How long a staged file survives an abandoned wizard. */
export const STAGED_FILE_TTL_HOURS = 24;

/** Metadata for a staged file. Never carries the bytes. */
export interface StagedFileInfo {
  readonly id: string;
  readonly filename: string;
  readonly sourceFormat: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly expiresAt: Date;
}

export interface StageFileInput {
  readonly filename: string;
  readonly data: Buffer;
  readonly sourceFormat?: string;
}

function toInfo(row: ImportStagedFile): StagedFileInfo {
  return {
    id: row.id,
    filename: row.filename,
    sourceFormat: row.sourceFormat,
    sizeBytes: Number(row.sizeBytes),
    sha256: row.sha256,
    expiresAt: row.expiresAt,
  };
}

@Injectable()
export class MnyStagingService {
  private readonly logger = new Logger(MnyStagingService.name);

  constructor(private dataSource: DataSource) {}

  /**
   * Stores `data` for this user and returns its metadata.
   *
   * Previous staged files of the same format are dropped in the same
   * transaction unless a job still needs them, so a user who re-uploads after a
   * failed preview does not leave 200 MB rows behind for the sweep to find a day
   * later.
   */
  async stage(userId: string, input: StageFileInput): Promise<StagedFileInfo> {
    const sourceFormat = input.sourceFormat ?? "mny";
    const expiresAt = new Date(
      Date.now() + STAGED_FILE_TTL_HOURS * 60 * 60 * 1000,
    );

    return withScopedDb(this.dataSource, async (manager) => {
      await this.dropSupersededFiles(manager, userId, sourceFormat);

      const repo = manager.getRepository(ImportStagedFile);
      const saved = await repo.save(
        repo.create({
          userId,
          filename: input.filename,
          sourceFormat,
          sizeBytes: input.data.length,
          sha256: createHash("sha256").update(input.data).digest("hex"),
          data: input.data,
          expiresAt,
        }),
      );

      return toInfo(saved);
    });
  }

  /**
   * Metadata only. Null when the file never existed, expired, or is another
   * user's.
   *
   * The expiry predicate is in the **query**, not only in the doc comment.
   * Without it an already-expired row could still start an import -- the sweep
   * runs hourly, so a file could sit past its TTL for the best part of an hour
   * looking perfectly startable -- and then be deleted before the worker loaded
   * its bytes (audit P4-016, DOC-04-03).
   */
  async findInfo(userId: string, id: string): Promise<StagedFileInfo | null> {
    const row = await withScopedDb(this.dataSource, (manager) =>
      manager
        .getRepository(ImportStagedFile)
        .createQueryBuilder("file")
        .where("file.id = :id", { id })
        .andWhere("file.user_id = :userId", { userId })
        .andWhere("file.expires_at >= CURRENT_TIMESTAMP")
        .getOne(),
    );
    return row ? toInfo(row) : null;
  }

  /**
   * The staged bytes, or null when the row is gone or expired. `data` is
   * `select: false`, so it takes an explicit `addSelect` -- which is the point:
   * every other query in this service stays off the BYTEA column.
   *
   * Same expiry predicate as `findInfo`, so start eligibility and load
   * eligibility cannot disagree.
   */
  async loadBytes(userId: string, id: string): Promise<Buffer | null> {
    const row = await withScopedDb(this.dataSource, (manager) =>
      manager
        .getRepository(ImportStagedFile)
        .createQueryBuilder("file")
        .addSelect("file.data")
        .where("file.id = :id", { id })
        .andWhere("file.user_id = :userId", { userId })
        .andWhere("file.expires_at >= CURRENT_TIMESTAMP")
        .getOne(),
    );

    return row?.data ?? null;
  }

  /** Deletes a staged file. Returns false when there was nothing to delete. */
  async remove(userId: string, id: string): Promise<boolean> {
    const result = await withScopedDb(this.dataSource, (manager) =>
      manager.getRepository(ImportStagedFile).delete({ id, userId }),
    );
    return (result.affected ?? 0) > 0;
  }

  /**
   * Deletes every expired staged file that no active job still needs.
   *
   * Idempotent by construction -- the predicate is "already expired", so two
   * replicas running the sweep at the same time simply race to delete the same
   * rows and the loser deletes nothing. Runs hourly rather than daily so a
   * cluster with one long-lived pod does not sit on a day's worth of uploads.
   *
   * The active-job exclusion mirrors `dropSupersededFiles`. Expiry alone would
   * delete the bytes out from under a pending or running import -- the foreign
   * key is ON DELETE SET NULL, so the job survives and simply fails with a
   * missing-file error partway through a 200 MB import (audit P4-016). An import
   * that outlives its own TTL is exactly the long one worth not restarting.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async sweepExpiredFiles(): Promise<void> {
    try {
      const removed = await withSystemContext(() =>
        withScopedDb(this.dataSource, async (manager) => {
          const result = await manager
            .getRepository(ImportStagedFile)
            .createQueryBuilder()
            .delete()
            .where("expires_at < CURRENT_TIMESTAMP")
            .andWhere(
              `NOT EXISTS (
                 SELECT 1 FROM import_jobs job
                  WHERE job.staged_file_id = import_staged_files.id
                    AND job.status IN ('pending', 'running')
               )`,
            )
            .execute();
          return result.affected ?? 0;
        }),
      );

      if (removed > 0) {
        this.logger.log(`Swept ${removed} expired staged import file(s)`);
      }
    } catch (error) {
      this.logger.warn(
        `Staged import file sweep failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Removes this user's other staged files of the same format, except any a
   * pending or running job still needs -- deleting one of those would strand an
   * import that is about to read it.
   */
  private async dropSupersededFiles(
    manager: EntityManager,
    userId: string,
    sourceFormat: string,
  ): Promise<void> {
    await manager
      .getRepository(ImportStagedFile)
      .createQueryBuilder()
      .delete()
      .where("user_id = :userId", { userId })
      .andWhere("source_format = :sourceFormat", { sourceFormat })
      .andWhere(
        `NOT EXISTS (
           SELECT 1 FROM import_jobs job
            WHERE job.staged_file_id = import_staged_files.id
              AND job.status IN ('pending', 'running')
         )`,
      )
      .execute();
  }
}
