-- 146: enforce the attachment late-write quarantine in the database, so a
-- previous-release sweeper cannot bypass it during a rolling deployment.
--
-- Migration 144 added `late_write_quarantine_until` and the new sweeper retains a
-- swept upload intent until it passes, re-deleting the key each hour. That closed
-- the process-death window for the *new* code. It did nothing for a previous-release
-- pod, whose sweeper is (audit V4R3-003):
--
--     1. claim:  UPDATE ... SET swept_at = now(), upload_lease_expires_at = NULL ...
--     2. delete the object
--     3. DELETE FROM attachment_blob_tombstones WHERE storage_provider=.. AND storage_key=..
--
-- Step 3 is unconditional. During a rollout the old pod can therefore claim a row,
-- delete the object, and drop the tombstone -- and a put that stalled past its lease
-- can still land afterwards, leaving bytes nothing references and no row names. The
-- new column alone does not stop that, exactly as migration 138's nullable column
-- did not stop the old MNY checkpoint; the fix has to live where both binaries meet.
--
-- Two triggers do that:
--
--   * BEFORE UPDATE: when any sweeper's claim turns a row that *was* an upload
--     intent (it had a lease) into a swept row, stamp `late_write_quarantine_until`
--     if it is not already set. The old sweeper's claim in step 1 fires this, so the
--     old pod stamps the quarantine it does not know about. `COALESCE` means the new
--     code's own value wins and a re-claim never pushes the deadline forward.
--
--   * BEFORE DELETE: reject deletion of a row whose quarantine has not passed. The
--     old sweeper's unconditional step-3 DELETE is refused, its transaction aborts,
--     and the tombstone survives -- so the next sweep (old or new) re-deletes the key
--     and only retires the row once nothing can still be written at it. The new
--     sweeper's `retire()` already deletes only past-quarantine rows, so it never
--     trips this; the uploader's intent-clear deletes only un-swept rows
--     (quarantine still NULL), so it does not either.
--
-- The wall-clock window remains a latency choice, not the correctness mechanism:
-- correctness is that the record outlives the writer and the key is re-deleted every
-- pass. See `LATE_WRITE_QUARANTINE_MS` and the storage provider's request timeout,
-- which is set below the window so a put cannot ordinarily complete after it.
--
-- Idempotent: CREATE OR REPLACE FUNCTION, triggers dropped first.

-- Six hours, matching AttachmentOrphanSweeper.LATE_WRITE_QUARANTINE_MS. The app
-- also sets this column on its own claim; the trigger is the mixed-version backstop
-- and the single writer that covers the previous binary.
CREATE OR REPLACE FUNCTION stamp_attachment_quarantine()
    RETURNS TRIGGER
    LANGUAGE plpgsql
AS $$
BEGIN
    NEW.late_write_quarantine_until := COALESCE(
        NEW.late_write_quarantine_until,
        OLD.late_write_quarantine_until,
        CURRENT_TIMESTAMP + INTERVAL '6 hours'
    );
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_abt_stamp_quarantine ON attachment_blob_tombstones;
CREATE TRIGGER trg_abt_stamp_quarantine
    BEFORE UPDATE ON attachment_blob_tombstones
    FOR EACH ROW
    WHEN (
      NEW.swept_at IS NOT NULL
      AND OLD.swept_at IS NULL
      AND OLD.upload_lease_expires_at IS NOT NULL
    )
    EXECUTE FUNCTION stamp_attachment_quarantine();

CREATE OR REPLACE FUNCTION reject_quarantined_tombstone_delete()
    RETURNS TRIGGER
    LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
      'attachment tombstone % is under late-write quarantine until %; a stalled upload may still write to this key',
      OLD.storage_key, OLD.late_write_quarantine_until
      USING ERRCODE = 'raise_exception';
END;
$$;

DROP TRIGGER IF EXISTS trg_abt_reject_quarantined_delete ON attachment_blob_tombstones;
CREATE TRIGGER trg_abt_reject_quarantined_delete
    BEFORE DELETE ON attachment_blob_tombstones
    FOR EACH ROW
    WHEN (
      OLD.late_write_quarantine_until IS NOT NULL
      AND OLD.late_write_quarantine_until > CURRENT_TIMESTAMP
    )
    EXECUTE FUNCTION reject_quarantined_tombstone_delete();
