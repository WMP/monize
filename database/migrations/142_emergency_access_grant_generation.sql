-- 142: emergency-access delivery state belongs to one grant cycle, not to the row.
--
-- Migration 137 added `claim_notified_at` so a resumed grant could tell a contact
-- who already holds a working link from one still owed a notice. That fixed the
-- resume, and made the marker permanent: `contactsAwaitingNotice` selected
-- `claim_notified_at IS NULL`, and nothing ever set it back to NULL (audit
-- RRV4-004).
--
-- So emergency access fired at most once per contact row, for the lifetime of the
-- row. The owner returns, `revokeAfterReturn` voids the links and clears
-- `granted_at` -- logging that monitoring is re-armed -- and the next time the
-- owner goes quiet past `grant_after_days` the pending query finds nobody and the
-- cron skips the grant. Silently, with the settings page still showing the feature
-- as armed. The same happens after a disable/re-enable, after a manual reset, and
-- for a contact whose address was corrected after they were notified.
--
-- Clearing the marker in each of those paths is the obvious fix and the wrong one:
-- there are five of them today, they live in three files, and the failure of a
-- missed one is invisible. The state is therefore *generational* instead:
--
--   emergency_access_settings.grant_generation        -- which grant cycle this
--                                                       owner is on. Advanced by
--                                                       the one statement that
--                                                       transitions ungranted ->
--                                                       granted, so no re-arm path
--                                                       has to remember anything.
--
--   emergency_access_contacts.notified_grant_generation
--                                                    -- the cycle whose notice this
--                                                       contact received. Owed a
--                                                       link whenever it differs
--                                                       from the owner's current
--                                                       generation.
--
-- `claim_notified_at` stays, demoted to "when the notice for
-- `notified_grant_generation` went out" -- a timestamp for operators, no longer a
-- predicate. The pair is written by one statement (`markContactNotified`) and read
-- by one query (`contactsAwaitingNotice`), which is what keeps them from drifting.
--
-- Backfill: every existing installation is on generation 1 (the column default),
-- and a contact with a non-NULL `claim_notified_at` was notified in the cycle that
-- is current now -- so `notified_grant_generation = 1` preserves exactly today's
-- behaviour for an in-flight grant. The next grant advances to 2 and owes them a
-- link again, which is the whole point.
--
-- Note what is deliberately *not* inferred: a contact with a token hash but no
-- `claim_notified_at` stays NULL here, for the same reason migration 137 refused to
-- treat a hash as evidence of delivery.

ALTER TABLE emergency_access_settings
    ADD COLUMN IF NOT EXISTS grant_generation INTEGER NOT NULL DEFAULT 1;

ALTER TABLE emergency_access_contacts
    ADD COLUMN IF NOT EXISTS notified_grant_generation INTEGER;

UPDATE emergency_access_contacts
   SET notified_grant_generation = 1
 WHERE claim_notified_at IS NOT NULL
   AND notified_grant_generation IS NULL;

-- The pending-contact query is `owner_user_id = $1 AND
-- (notified_grant_generation IS NULL OR notified_grant_generation <> $2)`, which
-- is served by the owner index the table already has; this partial index keeps the
-- never-notified case -- every contact of a brand-new grant -- off the row filter.
CREATE INDEX IF NOT EXISTS idx_eac_awaiting_notice
    ON emergency_access_contacts(owner_user_id)
    WHERE notified_grant_generation IS NULL;

-- And the index built for the predicate this replaces goes with it: no query reads
-- `claim_notified_at IS NULL` any more, so keeping the index would leave a
-- statement of intent in the schema that the code has stopped meaning.
DROP INDEX IF EXISTS idx_eac_pending_notify;
