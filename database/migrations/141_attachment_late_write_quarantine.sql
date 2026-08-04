-- 141: a swept upload intent is kept until a late put can no longer land.
--
-- Migration 136 gave the sweeper a claim (`swept_at`) that the uploader's "clear
-- the intent" step is fenced against, so metadata can never commit for bytes that
-- have been deleted. That is a statement about *metadata*, and RRV4-002 is about
-- *bytes*:
--
--   1. the upload commits its intent and starts an object-store put;
--   2. the put or the request stalls for longer than the 15-minute lease;
--   3. the sweep claims the row, deletes a key where nothing is yet visible, and
--      deletes the tombstone;
--   4. the put finally lands, creating the object;
--   5. the process is killed before `clearUploadIntent` -- so the metadata
--      transaction rolls back, correctly, and the compensating delete in the
--      `catch` never runs either.
--
-- The object exists, nothing references it, and no tombstone remains to enumerate
-- it. Undiscoverable is the part that matters: unreferenced bytes an operator
-- cannot list accumulate forever, and for attachments they are receipts and
-- statements, so this is a retention problem and not only a space one.
--
-- The fence cannot fix that, because step 3 has already happened by the time the
-- bytes appear. What is needed is for the *record* to outlive the writer:
--
--   late_write_quarantine_until -- set on the first claim of a row that was an
--                                 upload intent (it had a lease). Until it passes,
--                                 the tombstone is kept after the object delete, so
--                                 the hourly sweep re-deletes the key and finally
--                                 drops the row. A put that lands at step 4 is
--                                 therefore removed by the next sweep rather than
--                                 surviving forever, and a process killed anywhere
--                                 in the sequence leaves the row in place.
--
-- An ordinary deletion record -- written by the AFTER DELETE trigger, never
-- carrying a lease -- gets no quarantine and is dropped immediately as before:
-- its metadata row is already gone, so nothing can write those bytes again.
--
-- Re-sweeping is safe rather than merely tolerable: the provider contract makes
-- `delete` idempotent, and once `swept_at` is set the uploader's conditional clear
-- can never succeed for that row, so no transaction is waiting to claim the key.
--
-- Backfill: NULL for every existing row, which is exactly the deletion-record
-- behaviour they already have.

ALTER TABLE attachment_blob_tombstones
    ADD COLUMN IF NOT EXISTS late_write_quarantine_until TIMESTAMP;

-- The sweeper's candidate read has to keep finding a quarantined row so it can be
-- re-deleted and retired, and `swept_at` alone does not order that work. The
-- existing `idx_abt_sweepable` covers the un-swept arm (no live lease); this covers
-- the quarantined one.
CREATE INDEX IF NOT EXISTS idx_abt_quarantined
    ON attachment_blob_tombstones(storage_provider, late_write_quarantine_until)
    WHERE late_write_quarantine_until IS NOT NULL;
