-- 134: separate an emergency-access delivery from the claim that coordinates it.
--
-- Migration 133 gave the two multi-replica emergency-access jobs a claim each,
-- which stopped two replicas doing the work twice. It did not make either one
-- *recoverable*, because in both cases the claim was taken before the send and
-- was the only record that the send was owed (audit FV4-004, FV4-005):
--
--   - The grant used `emergency_access_settings.granted_at` as both the claim and
--     the grant state. A replica killed between the conditional transition and
--     the emails left an account permanently marked granted with no contact
--     holding a link -- the safeguard silently disarmed, at exactly the moment it
--     is supposed to fire.
--   - The reminder used a permanent `job_claims` row keyed on the local date. A
--     replica killed between the claim and the send consumed the day and sent
--     nothing; only a handled SMTP error released it.
--
-- A claim answers "may I do this now". It cannot also answer "has this been
-- done", because the second question has to survive the process that asked the
-- first. So delivery gets its own durable column, per contact:
--
--   `claim_notified_at` -- when this contact's link was actually sent.
--
-- Per contact, not per owner, because the alternative is worse than the bug: a
-- retry that re-issues a token for a contact who already received one
-- invalidates the link in their inbox, and a dead emergency-access link during a
-- recovery is indistinguishable from a revoked one (the P4-014 failure). With
-- this column the retry sends only to contacts still owed a link.
--
-- The recovery is *derived* rather than scheduled: a grant with a contact whose
-- `claim_notified_at` is NULL is a grant that has not been delivered, and the
-- daily check re-runs the notification for exactly those contacts. Nothing has
-- to remember to enqueue anything, which is the point (see docs/cron-jobs.md).
--
-- Backfill: every existing row is set to `updated_at`, not left NULL. A NULL on
-- an already-delivered contact would make the recovery path re-issue a token and
-- kill a link that is currently in somebody's inbox -- turning this fix into the
-- bug it exists to prevent. `updated_at` is the closest honest timestamp: the
-- grant's own `repo.save(contact)` moved it.

ALTER TABLE emergency_access_contacts
    ADD COLUMN IF NOT EXISTS claim_notified_at TIMESTAMP;

-- Only contacts that were actually issued a token can have been notified; one
-- added while a grant was outstanding was never sent anything and must stay NULL
-- so the recovery reaches it.
UPDATE emergency_access_contacts
   SET claim_notified_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)
 WHERE claim_notified_at IS NULL
   AND claim_token_hash IS NOT NULL;

-- The recovery predicate's index: "granted owners with a contact still owed a
-- link" is read on every daily sweep.
CREATE INDEX IF NOT EXISTS idx_eac_pending_notify
    ON emergency_access_contacts(owner_user_id)
    WHERE claim_notified_at IS NULL;
