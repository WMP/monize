-- 141: the import fence, enforced by the database rather than only by the code.
--
-- Migration 140 added `attempt_token` and the new worker's checkpoint requires it.
-- That fences a worker running *this* code. It does not fence a worker running the
-- code from the previous release, and a Kubernetes rolling deployment has both
-- alive at once (audit RRV4-001).
--
-- The previous checkpoint is:
--
--     UPDATE import_jobs SET data_committed = true WHERE id = $1
--
-- It names no token, because its code does not know the column exists, and adding
-- a nullable column does not make that statement fail. So during the rollout: the
-- new pod's reaper fails a stalled old attempt and advertises a retry, the old pod
-- resumes and commits the whole file anyway, and the retry imports it again. One
-- -25.00 row in the file becomes -50.00 in the ledger. That is the exact window the
-- fence exists to close, reachable by an ordinary deploy.
--
-- A comment cannot fix it and neither can the application, because the offending
-- statement comes from a binary that is already running. The rule has to live where
-- both versions meet:
--
--     `data_committed` may only go false -> true while the job is `running`.
--
-- The reaper's whole action is `status = 'failed'`, so this refuses precisely the
-- commit that must not happen -- to either version -- and refuses it as a statement
-- error, which aborts the surrounding import transaction and rolls its rows back.
--
-- Note what the rule deliberately does *not* say: it does not require a non-null
-- `attempt_token`. An old-version worker's normal, unreaped state is `running` with
-- a NULL token, and refusing that would break every import in flight during the
-- rollout -- turning a correctness fix into an outage. Token *equality* stays in
-- the application (`markDataCommitted`), where it additionally covers the case this
-- trigger cannot see: a job reaped and then re-claimed, so `running` again but
-- belonging to a different attempt.
--
-- Idempotent: `CREATE OR REPLACE FUNCTION`, and the trigger is dropped first.

CREATE OR REPLACE FUNCTION reject_unfenced_import_checkpoint() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION
      'import job % may not record a data commit while status is %; the attempt was reaped',
      OLD.id, NEW.status
      USING ERRCODE = 'raise_exception';
END;
$$;

DROP TRIGGER IF EXISTS trg_import_job_fenced_checkpoint ON import_jobs;
CREATE TRIGGER trg_import_job_fenced_checkpoint
    BEFORE UPDATE ON import_jobs
    FOR EACH ROW
    WHEN (
      NEW.data_committed
      AND NOT OLD.data_committed
      AND NEW.status <> 'running'
    )
    EXECUTE FUNCTION reject_unfenced_import_checkpoint();
