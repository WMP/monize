-- One in-flight import per user, enforced by the database rather than by a
-- read-then-insert in the service.
--
-- `MnyImportService.start` counted the user's active jobs and then inserted a
-- row in a *second* transaction. Two overlapping start requests could both see
-- zero and both insert, so the same staged file was imported twice: each parse
-- pre-generates fresh transaction UUIDs, so nothing downstream deduplicates the
-- second run's rows and the user ends up with doubled history and balances.
-- With `wipeExistingData` both requests could also reach the destructive wipe.
--
-- The partial unique index is the whole fix: the second INSERT waits on the
-- first and then fails with 23505, which the job service translates into the
-- 409 the wizard already renders. `claim(jobId)` stays as it was -- it protects
-- one row against two workers, which is a different race.

-- Any database that already ran two starts concurrently carries rows the index
-- would reject, and a migration that fails aborts backend start-up. Keep the
-- newest active job per user and fail the rest retryably: the staged bytes are
-- untouched, so the wizard can offer Retry. A no-op on a database that never
-- raced, and on every re-apply.
UPDATE import_jobs AS job
   SET status = 'failed',
       error_key = 'mnyJobStalled',
       error_detail = 'Superseded by a concurrent import start',
       retryable = true,
       progress = NULL,
       completed_at = CURRENT_TIMESTAMP
 WHERE job.status IN ('pending', 'running')
   AND EXISTS (
     SELECT 1
       FROM import_jobs AS newer
      WHERE newer.user_id = job.user_id
        AND newer.status IN ('pending', 'running')
        AND (newer.created_at, newer.id) > (job.created_at, job.id)
   );

CREATE UNIQUE INDEX IF NOT EXISTS idx_import_jobs_one_active_per_user
    ON import_jobs(user_id)
    WHERE status IN ('pending', 'running');
