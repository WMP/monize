-- 139: an attachment upload intent gets a lease and a fence, not just an age.
--
-- Migration 136 gave external attachment bytes a tombstone so a deletion could
-- happen after its metadata transaction committed, and the FV4-003 fix reused the
-- same row as an **upload intent** written before the object is put -- which is
-- what made bytes from a crashed upload discoverable at all.
--
-- One row shape now means two things, and the sweeper told them apart only by age
-- (audit RV4-002). Nothing bounds an upload to that window: the object store call
-- or the metadata commit can stall for longer, and then the hourly sweep deletes
-- the bytes a transaction is about to commit metadata for. The API answers 201 and
-- the attachment cannot be downloaded -- worse than the orphan the intent prevents,
-- because an orphan wastes space while this loses the user's receipt.
--
-- A wall-clock grace period cannot fix that, because it is a guess about how long
-- an upload takes. Two columns, with two different jobs:
--
--   upload_lease_expires_at -- non-NULL marks the row as an upload in flight and
--                              says until when. The sweeper skips a live lease.
--                              This is a *latency* mechanism: it exists so the
--                              sweeper does not cause avoidable upload failures.
--                              NULL means the row is an ordinary deletion record,
--                              swept immediately as before.
--
--   swept_at                -- the sweeper's claim. Set by a conditional UPDATE
--                              *before* the external delete, so the uploader can
--                              be refused. This is the *correctness* mechanism.
--
-- The uploader's "clear the intent" step becomes a conditional delete requiring
-- `swept_at IS NULL`, inside the transaction that commits the metadata row. Zero
-- rows means the sweeper has taken the object, so the uploader throws and rolls
-- back. Both statements contend on the same tombstone row, so PostgreSQL decides
-- the order and only one of the two outcomes is possible:
--
--   * uploader first  -- the row is gone, the sweeper's claim matches nothing, the
--                        object is kept, and the metadata row that references it
--                        commits;
--   * sweeper first   -- `swept_at` is set, the uploader's clear matches nothing,
--                        it rolls back, and the object is deleted with no metadata
--                        left pointing at it.
--
-- Metadata pointing at deleted bytes is not among them, which is the property the
-- age check could not provide.
--
-- Backfill: every existing row is a deletion record written by the trigger, so a
-- NULL lease and a NULL `swept_at` are correct for all of them -- exactly the
-- behaviour they have today.

ALTER TABLE attachment_blob_tombstones
    ADD COLUMN IF NOT EXISTS upload_lease_expires_at TIMESTAMP;

ALTER TABLE attachment_blob_tombstones
    ADD COLUMN IF NOT EXISTS swept_at TIMESTAMP;

-- The sweeper's candidate predicate: rows with no live upload lease. Partial, so
-- an in-flight upload costs nothing to skip.
CREATE INDEX IF NOT EXISTS idx_abt_sweepable
    ON attachment_blob_tombstones(storage_provider, deleted_at)
    WHERE upload_lease_expires_at IS NULL;
