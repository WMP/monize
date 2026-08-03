import { ConflictException, Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { DataSource, EntityManager, QueryFailedError } from "typeorm";
import { tr } from "../../i18n/translate";
import {
  runOutsideActiveScopedManager,
  withScopedDb,
} from "../../common/db/scoped-db";
import { returnedRows } from "../../common/db/query-result";
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

/**
 * Thrown when a job discovers, inside its own write transaction, that it no
 * longer holds its user's import slot. Not a parse failure: retrying is exactly
 * the right thing to offer, since the staged bytes are untouched.
 */
export class MnyImportSlotLostError extends Error {
  constructor(jobId: string, status: string) {
    super(
      `Import job ${jobId} no longer holds the import slot (status ${status})`,
    );
    this.name = "MnyImportSlotLostError";
  }
}

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
 * Re-exported from `common/db/query-result` for the concurrency spec and the
 * callers below: this used to be defined here, and every other guarded statement
 * in the codebase now needs the same reading, so it lives in one place.
 */
export { returnedRows };

@Injectable()
export class MnyImportJobService {
  private readonly logger = new Logger(MnyImportJobService.name);

  constructor(private dataSource: DataSource) {}

  /**
   * Creates a `pending` job, or throws `ConflictException` when this user
   * already has one active. Returns the row the wizard will poll.
   *
   * The insert **is** the active-job check. A `count()` before an unconditional
   * insert is a check-then-act: two simultaneous starts both counted zero, both
   * inserted, and both were legitimately claimable -- one file imported twice,
   * or with `wipeExistingData` one wipe landing mid-import (audit P4-001). The
   * partial unique index on `(user_id) WHERE status IN ('pending','running')`
   * arbitrates instead, and the loser's 23505 becomes the 409 the API already
   * documented.
   *
   * Inserted through the user-scoped manager, so RLS still applies; database
   * uniqueness arbitrates across transactions regardless.
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
            dataCommitted: false,
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
   * A hint for the UI -- it greys out the Start button -- and nothing more.
   * The guarantee lives in the partial unique index the insert in `create()`
   * hits; this read cannot provide one, because anything decided here can be
   * invalidated before the insert lands.
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
   * Verifies this job still holds its user's import slot, **inside the caller's
   * transaction**, and locks the row so the answer cannot change before commit.
   *
   * `claim` protects the start of a job; this protects the end of one. A job can
   * lose its slot after claiming it, and in both cases the row is rewritten by
   * something that cannot stop the worker:
   *
   *  - the one-active-job migration retires older duplicates on a database that
   *    raced before the index existed. Every backend container runs migrations at
   *    start-up and the Helm StatefulSet rolls pods one at a time, so a new pod
   *    can retire a job an *old* pod is still importing;
   *  - `reapStaleJobs` fails a `running` job whose heartbeat lapsed -- a real
   *    possibility for a slow import on a loaded pod, not only for a dead one.
   *
   * Neither changes what the worker does. Status alone therefore cannot protect
   * the data: by the time a terminal write happens the financial rows are already
   * committed. Calling this as the last statement of the transaction that writes
   * them makes the refusal roll them back instead, which is the repository's
   * standing rule -- a rejected command must not already have written.
   *
   * `FOR UPDATE` matters as much as the predicate: it serializes this check
   * against a concurrent retirement, so the loser of that race sees the committed
   * outcome rather than a snapshot taken before it.
   *
   * @param manager the EntityManager of the ACTIVE transaction whose writes this
   *   is guarding -- checked in a separate transaction it guarantees nothing.
   */
  async assertStillHoldsSlot(
    manager: EntityManager,
    jobId: string,
  ): Promise<void> {
    const rows: Array<{ status: string }> = await manager.query(
      `SELECT status FROM import_jobs WHERE id = $1 FOR UPDATE`,
      [jobId],
    );
    const status = rows[0]?.status ?? "missing";
    if (status !== "running") {
      throw new MnyImportSlotLostError(jobId, status);
    }
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

  /**
   * Record that the import transaction committed its rows.
   *
   * Written **inside** that transaction, so it lands with the data it describes.
   * That is the whole point: `retryable` alone could not tell "failed before
   * writing anything" from "the ledger is written and only the completion
   * metadata is missing", so both were offered as an ordinary retry and the
   * second one imported the file again (audit P4-002).
   */
  async markDataCommitted(
    manager: EntityManager,
    jobId: string,
  ): Promise<void> {
    await manager.query(
      `UPDATE import_jobs SET data_committed = true WHERE id = $1`,
      [jobId],
    );
  }

  /**
   * Move a running job to `completed`. Returns false when it was not running.
   *
   * `status = 'running'` is a compare-and-set, not decoration: a worker that
   * stalled long enough for the reaper to fail its job would otherwise wake up
   * and overwrite that terminal state with `completed`, so the row would claim
   * success for a run nobody supervised. Terminal states are monotonic.
   */
  async complete(jobId: string, result: MnyImportResult): Promise<boolean> {
    const updated = await runOutsideActiveScopedManager(() =>
      withScopedDb(this.dataSource, (manager) =>
        manager.query(
          // `AND status = 'running'`: a job retired while its body ran must not
          // be flipped back to completed. `assertStillHoldsSlot` normally makes
          // this unreachable by rolling the body back first; this is the second
          // line of defence, and it keeps the audit trail honest either way.
          `UPDATE import_jobs
              SET status = 'completed',
                  result = $2::jsonb,
                  progress = NULL,
                  completed_at = CURRENT_TIMESTAMP,
                  retryable = false
            WHERE id = $1 AND status = 'running'
            RETURNING id`,
          [jobId, JSON.stringify(result)],
        ),
      ),
    );
    if (returnedRows<{ id: string }>(updated).length === 0) {
      this.logger.warn(
        `Import job ${jobId} finished but was no longer running; leaving its terminal state alone`,
      );
      return false;
    }
    return true;
  }

  /**
   * Move a job to `failed`. Returns false when it had already left `running`
   * or `pending` -- the same monotonicity rule as `complete`.
   *
   * `retryable` is ANDed with `data_committed = false`: a run whose import
   * transaction committed must never be advertised as retryable, whatever the
   * caller believes, because retrying it inserts every source row a second time
   * under fresh UUIDs. The caller cannot know this -- the checkpoint can be set
   * after the caller's own decision -- so the predicate lives in the statement.
   */
  async fail(
    jobId: string,
    errorKey: string,
    errorDetail: string,
    retryable: boolean,
  ): Promise<boolean> {
    const updated = await runOutsideActiveScopedManager(() =>
      withScopedDb(this.dataSource, (manager) =>
        manager.query(
          `UPDATE import_jobs
              SET status = 'failed',
                  error_key = $2,
                  error_detail = $3,
                  retryable = ($4 AND data_committed = false),
                  progress = NULL,
                  completed_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND status IN ('pending', 'running')
            RETURNING id`,
          [jobId, errorKey, errorDetail, retryable],
        ),
      ),
    );
    return returnedRows<{ id: string }>(updated).length > 0;
  }

  /**
   * Claims the job and runs `body`, keeping the row's status honest whatever
   * happens. Returns false when another worker already had it.
   *
   * A parse failure (bad file, wrong Money version) is not retryable -- retrying
   * the same bytes cannot help. Anything else is, *provided the import
   * transaction never committed*: `fail()` ANDs the caller's `retryable` with
   * `data_committed = false`, so a failure after the ledger was written is
   * reported as non-retryable rather than inviting a second import of the same
   * file. The staged file survives either way, for diagnosis.
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
      if (error instanceof MnyImportSlotLostError) {
        // The row already says why, written by whatever retired it. Overwriting
        // it here would replace that explanation with a generic failure.
        this.logger.warn(detail);
        return true;
      }
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
