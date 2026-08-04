-- One in-flight import per owner, enforced by the database.
--
-- `POST /import/mny/start` refused a second import by counting the owner's
-- pending/running jobs and then, in a separate transaction, inserting the new
-- row. Two requests arriving together both counted zero and both inserted: two
-- workers then parsed the same file into the same account set, and every
-- transaction in it was imported twice.
--
-- The check could have been moved inside the insert's transaction under a lock,
-- and that would have closed this particular window. A partial unique index is
-- better: it states the invariant once, in the place that cannot be bypassed by
-- a new caller, and it keeps holding when a second replica, a retry endpoint or
-- a future queue worker inserts a job without remembering to take the lock.
-- Application code still pre-checks so the ordinary case gets a clean 409
-- instead of a constraint error.
--
-- `WHERE status IN ('pending', 'running')` is exactly the set `hasActiveJob`
-- counts, so completed and failed jobs accumulate freely -- the history a Retry
-- button reads. The reaper moves an abandoned job to `failed`, which is what
-- releases the slot, so a dead pod cannot lock an owner out of importing.

DROP INDEX IF EXISTS idx_import_jobs_one_active_per_user;

-- A pre-existing duplicate would make the index creation fail and abort
-- container start-up, so retire the older of any such pair first. Only the
-- newest active job per owner can be the real one: an older sibling is by
-- definition the loser of a race whose worker either died or is writing the same
-- rows twice.
UPDATE import_jobs AS stale
   SET status = 'failed',
       error_key = 'mnyJobStalled',
       retryable = true,
       completed_at = COALESCE(stale.completed_at, CURRENT_TIMESTAMP)
 WHERE stale.status IN ('pending', 'running')
   AND EXISTS (
     SELECT 1
       FROM import_jobs AS newer
      WHERE newer.user_id = stale.user_id
        AND newer.status IN ('pending', 'running')
        AND (newer.created_at, newer.id) > (stale.created_at, stale.id)
   );

CREATE UNIQUE INDEX IF NOT EXISTS idx_import_jobs_one_active_per_user
    ON import_jobs (user_id)
    WHERE status IN ('pending', 'running');
