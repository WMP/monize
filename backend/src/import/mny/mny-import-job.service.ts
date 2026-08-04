import { ConflictException, Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { DataSource, QueryFailedError } from "typeorm";
import { tr } from "../../i18n/translate";
import {
  runOutsideActiveScopedManager,
  withScopedDb,
} from "../../common/db/scoped-db";
import {
  withSystemContext,
  withUserContext,
} from "../../common/db/with-context";
import { ImportJob, ONE_ACTIVE_JOB_INDEX } from "./entities/import-job.entity";
import { MnyImportError } from "./mny-errors";
import { MnyImportProgress, MnyImportResult } from "./model/mny-import-job";
import { MnyImportOptions } from "./model/mny-import-options";

/**
 * Lifecycle of a background `.mny` import (design ADR-3).
 *
 * No queue, no Redis, no second process: `POST /import/mny/start` inserts a
 * `pending` row, exactly one worker claims it with a conditional UPDATE, and the
 * body runs as an unawaited in-process task under `withUserContext`. The wizard
 * polls the row.
 *
 * Three things make that safe on Kubernetes, where every replica runs the same
 * code: the insert is guarded by a partial unique index, so two *requests*
 * racing to start an import produce one job; the claim is atomic, so two pods
 * racing over that one job produce one winner; and a running job heartbeats, so
 * a job whose pod died is reaped into `failed` + retryable instead of appearing
 * to run forever.
 */

/** A job with no heartbeat for this long is presumed dead. */
export const JOB_STALE_AFTER_MS = 5 * 60 * 1000;

/** How often a running job proves it is alive. */
export const JOB_HEARTBEAT_INTERVAL_MS = 60 * 1000;

/** i18n key for a job the reaper gave up on. */
export const JOB_STALLED_ERROR_KEY = "mnyJobStalled";

/** i18n key for a failure with no more specific parse error. */
export const JOB_FAILED_ERROR_KEY = "mnyImportFailed";

/** PostgreSQL SQLSTATE for a unique violation. */
const UNIQUE_VIOLATION = "23505";

/**
 * True when this error is the one-active-import-per-user index refusing an
 * INSERT, rather than any other unique constraint on the table.
 *
 * Matching on the constraint name and not merely on the SQLSTATE matters: a
 * different violation means something the caller has no business reporting as
 * "an import is already running".
 */
export function isActiveJobConflict(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) {
    return false;
  }
  const driver = error.driverError as
    | { code?: string; constraint?: string }
    | undefined;
  return (
    driver?.code === UNIQUE_VIOLATION &&
    driver?.constraint === ONE_ACTIVE_JOB_INDEX
  );
}

/** The 409 the wizard already renders when a second import is refused. */
export function importAlreadyRunningException(): ConflictException {
  return new ConflictException(
    tr(
      "errors.import.mnyImportAlreadyRunning",
      "An import is already running. Wait for it to finish before starting another.",
    ),
  );
}

/** What a job body can report while it runs. */
export interface JobRunContext {
  readonly jobId: string;
  readonly userId: string;
  /** Publishes progress the poller can see immediately. */
  reportProgress(progress: MnyImportProgress): Promise<void>;
}

export type JobBody = (context: JobRunContext) => Promise<MnyImportResult>;

/**
 * The rows a `query()` returned, whichever shape TypeORM chose.
 *
 * A data-modifying statement with `RETURNING` comes back as `[rows, rowCount]`,
 * while a `SELECT` comes back as bare rows. Reading that wrong fails silently in
 * the worst possible direction: `result.length > 0` on the tuple is always true,
 * so every conditional claim would look like a winner and two workers would
 * import the same file. Found by the concurrency spec, kept honest by it.
 */
export function returnedRows<T>(result: unknown): T[] {
  if (!Array.isArray(result)) {
    return [];
  }
  return Array.isArray(result[0]) ? (result[0] as T[]) : (result as T[]);
}

@Injectable()
export class MnyImportJobService {
  private readonly logger = new Logger(MnyImportJobService.name);

  constructor(private dataSource: DataSource) {}

  /**
   * Creates a `pending` job, or throws 409 when this user already has one in
   * flight. Returns the row the wizard will poll.
   *
   * The refusal is the INSERT itself, not a preceding count: `hasActiveJob`
   * followed by `create` is two transactions, and two concurrent starts can
   * both read zero before either writes -- which imported the same staged file
   * twice, with fresh transaction UUIDs each time so nothing deduplicated the
   * second run. The partial unique index makes the loser block on the winner
   * and then fail, so the check and the write are one atomic act.
   */
  async create(
    userId: string,
    stagedFileId: string,
    options: MnyImportOptions,
  ): Promise<ImportJob> {
    try {
      return await withScopedDb(this.dataSource, async (manager) => {
        const repo = manager.getRepository(ImportJob);
        return repo.save(
          repo.create({
            userId,
            stagedFileId,
            sourceFormat: "mny",
            status: "pending",
            options,
            retryable: false,
          }),
        );
      });
    } catch (error) {
      if (isActiveJobConflict(error)) {
        throw importAlreadyRunningException();
      }
      throw error;
    }
  }

  /**
   * Deletes a job that never started, releasing this user's import slot.
   *
   * `start` creates the row *before* the optional destructive wipe, so the wipe
   * runs under the same lock the import does -- but a wipe that fails
   * re-authentication must not leave the user holding a slot for a job that
   * will never run. Restricted to `pending`: a claimed job belongs to its
   * worker, which reports its own outcome.
   */
  async discard(userId: string, jobId: string): Promise<void> {
    await withScopedDb(this.dataSource, (manager) =>
      manager.query(
        `DELETE FROM import_jobs
          WHERE id = $1 AND user_id = $2 AND status = 'pending'`,
        [jobId, userId],
      ),
    );
  }

  /** The job, or null when it never existed or belongs to another user. */
  async findOne(userId: string, jobId: string): Promise<ImportJob | null> {
    return withScopedDb(this.dataSource, (manager) =>
      manager
        .getRepository(ImportJob)
        .findOne({ where: { id: jobId, userId } }),
    );
  }

  /**
   * True when this user already has an import in flight.
   *
   * Advisory only: it answers the question a moment before the answer can
   * change, so it buys a friendly 409 without an INSERT attempt and nothing
   * more. The guarantee lives in `create`'s unique index.
   */
  async hasActiveJob(userId: string): Promise<boolean> {
    const count = await withScopedDb(this.dataSource, (manager) =>
      manager.getRepository(ImportJob).count({
        where: [
          { userId, status: "pending" },
          { userId, status: "running" },
        ],
      }),
    );
    return count > 0;
  }

  /**
   * Moves a job from `pending` to `running`, atomically.
   *
   * The `WHERE status = 'pending'` is the whole concurrency control: whichever
   * statement commits first updates one row, the other updates none.
   */
  async claim(jobId: string): Promise<boolean> {
    const result = await withScopedDb(this.dataSource, (manager) =>
      manager.query(
        `UPDATE import_jobs
            SET status = 'running',
                started_at = CURRENT_TIMESTAMP,
                heartbeat_at = CURRENT_TIMESTAMP,
                error_key = NULL,
                error_detail = NULL,
                retryable = false
          WHERE id = $1 AND status = 'pending'
          RETURNING id`,
        [jobId],
      ),
    );
    return returnedRows<{ id: string }>(result).length > 0;
  }

  /**
   * Publishes progress in its own transaction, so a wizard polling mid-import
   * sees it. A write inside the import's transaction would stay invisible until
   * commit -- a frozen progress bar for the whole run.
   */
  async reportProgress(
    jobId: string,
    progress: MnyImportProgress,
  ): Promise<void> {
    await runOutsideActiveScopedManager(() =>
      withScopedDb(this.dataSource, (manager) =>
        manager.query(
          `UPDATE import_jobs
              SET progress = $2::jsonb, heartbeat_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND status = 'running'`,
          [jobId, JSON.stringify(progress)],
        ),
      ),
    );
  }

  /** Proof of life for the reaper, on the same escape hatch as progress. */
  async heartbeat(jobId: string): Promise<void> {
    await runOutsideActiveScopedManager(() =>
      withScopedDb(this.dataSource, (manager) =>
        manager.query(
          `UPDATE import_jobs
              SET heartbeat_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND status = 'running'`,
          [jobId],
        ),
      ),
    );
  }

  async complete(jobId: string, result: MnyImportResult): Promise<void> {
    await runOutsideActiveScopedManager(() =>
      withScopedDb(this.dataSource, (manager) =>
        manager.query(
          `UPDATE import_jobs
              SET status = 'completed',
                  result = $2::jsonb,
                  progress = NULL,
                  completed_at = CURRENT_TIMESTAMP,
                  retryable = false
            WHERE id = $1`,
          [jobId, JSON.stringify(result)],
        ),
      ),
    );
  }

  async fail(
    jobId: string,
    errorKey: string,
    errorDetail: string,
    retryable: boolean,
  ): Promise<void> {
    await runOutsideActiveScopedManager(() =>
      withScopedDb(this.dataSource, (manager) =>
        manager.query(
          `UPDATE import_jobs
              SET status = 'failed',
                  error_key = $2,
                  error_detail = $3,
                  retryable = $4,
                  progress = NULL,
                  completed_at = CURRENT_TIMESTAMP
            WHERE id = $1`,
          [jobId, errorKey, errorDetail, retryable],
        ),
      ),
    );
  }

  /**
   * Claims the job and runs `body`, keeping the row's status honest whatever
   * happens. Returns false when another worker already had it.
   *
   * A parse failure (bad file, wrong Money version) is not retryable -- retrying
   * the same bytes cannot help. Anything else is: the staged file survives, so
   * Retry is a new job over the same file.
   */
  async runClaimed(
    userId: string,
    jobId: string,
    body: JobBody,
  ): Promise<boolean> {
    if (!(await this.claim(jobId))) {
      return false;
    }

    // unref: a pending heartbeat must never keep the process alive at shutdown.
    const beat = setInterval(() => {
      void withUserContext(userId, () => this.heartbeat(jobId)).catch(
        () => undefined,
      );
    }, JOB_HEARTBEAT_INTERVAL_MS);
    beat.unref();

    try {
      const result = await body({
        jobId,
        userId,
        reportProgress: (progress) => this.reportProgress(jobId, progress),
      });
      await this.complete(jobId, result);
      this.logger.log(`Import job ${jobId} completed`);
    } catch (error) {
      const isParseFailure = error instanceof MnyImportError;
      const detail = error instanceof Error ? error.message : String(error);
      await this.fail(
        jobId,
        isParseFailure ? error.code : JOB_FAILED_ERROR_KEY,
        detail,
        !isParseFailure,
      );
      this.logger.error(`Import job ${jobId} failed: ${detail}`);
    } finally {
      clearInterval(beat);
    }

    return true;
  }

  /**
   * Fails jobs whose worker stopped heartbeating -- a killed pod, an OOM, a
   * rolling restart mid-import.
   *
   * A `pending` job is reaped on the same rule, measured from creation. Nothing
   * else would ever clear one: `start` inserts the row and then claims it from an
   * unawaited task, so a pod that dies in between -- or a claim that throws --
   * leaves the row pending forever. `hasActiveJob` counts pending, so that one
   * row would refuse every future import this user ever starts, with no way back
   * short of a DBA. Five minutes is far longer than the microseconds the real
   * gap takes.
   *
   * Marked retryable: the staged file is untouched, so the wizard can offer Retry
   * rather than making the user upload 200 MB again. Idempotent across replicas,
   * because the predicate only matches rows still in the state being reaped.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async reapStaleJobs(): Promise<void> {
    try {
      const reaped = await withSystemContext(() =>
        withScopedDb(this.dataSource, async (manager) => {
          const result = await manager.query(
            `UPDATE import_jobs
                SET status = 'failed',
                    error_key = $2,
                    error_detail = CASE
                      WHEN status = 'running'
                        THEN 'Import worker stopped reporting progress'
                      ELSE 'Import was never picked up by a worker'
                    END,
                    retryable = true,
                    progress = NULL,
                    completed_at = CURRENT_TIMESTAMP
              WHERE (
                      status = 'running'
                  AND heartbeat_at < CURRENT_TIMESTAMP - ($1::text || ' milliseconds')::interval
                    )
                 OR (
                      status = 'pending'
                  AND created_at < CURRENT_TIMESTAMP - ($1::text || ' milliseconds')::interval
                    )
              RETURNING id`,
            [String(JOB_STALE_AFTER_MS), JOB_STALLED_ERROR_KEY],
          );
          return returnedRows<{ id: string }>(result).map((row) => row.id);
        }),
      );

      if (reaped.length > 0) {
        this.logger.warn(
          `Reaped ${reaped.length} stalled import job(s): ${reaped.join(", ")}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Import job reaper failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
