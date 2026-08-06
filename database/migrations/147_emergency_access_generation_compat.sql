-- 147: make emergency-access delivery generations survive a rolling deployment.
--
-- Migration 146 scoped a contact's delivery state to a grant generation:
-- `emergency_access_contacts.notified_grant_generation` is compared against the
-- owner's `emergency_access_settings.grant_generation`, and a contact is owed a
-- link whenever they differ. The new code writes both columns together.
--
-- The previous release does not know `notified_grant_generation` exists. Its
-- acknowledgement of a delivered link is:
--
--     UPDATE emergency_access_contacts
--        SET claim_notified_at = <now>, claim_token_ciphertext = NULL
--      WHERE id = $1
--
-- During a Kubernetes rolling deploy both binaries are alive. An old pod delivers
-- token A and writes that acknowledgement, leaving `notified_grant_generation`
-- NULL. A new pod then reads the same granted owner, sees a NULL generation, treats
-- the contact as still owed, mints token B and overwrites the hash -- so token A,
-- already in the recipient's inbox, is now dead. That is the exact P4-014 dead-link
-- outcome the generation was meant to end, reachable by an ordinary deploy
-- (audit V4R3-001).
--
-- The rule has to live where both versions meet. A BEFORE UPDATE trigger translates
-- the old-binary acknowledgement into the current generation: whenever
-- `claim_notified_at` goes NULL -> non-NULL and the row was left without a
-- generation, it stamps the owner's current `grant_generation` in the same update.
-- The new code sets the generation itself, so the trigger's WHEN is false for it
-- and it is a no-op there.
--
-- SECURITY DEFINER with a pinned search_path: it reads `emergency_access_settings`,
-- and under RLS enforcement the invoking role might not see that row (the acking
-- session is system-context today, but the trigger must not depend on that).
--
-- Idempotent: CREATE OR REPLACE FUNCTION, and the trigger is dropped first.

CREATE OR REPLACE FUNCTION backfill_notified_grant_generation()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
AS $$
BEGIN
    SELECT s.grant_generation
      INTO NEW.notified_grant_generation
      FROM emergency_access_settings s
     WHERE s.owner_user_id = NEW.owner_user_id;
    -- No settings row (should not happen for a contact) leaves it NULL, which is
    -- the pre-migration behaviour rather than a spurious generation.
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_eac_backfill_notified_generation
    ON emergency_access_contacts;
CREATE TRIGGER trg_eac_backfill_notified_generation
    BEFORE UPDATE ON emergency_access_contacts
    FOR EACH ROW
    WHEN (
      NEW.claim_notified_at IS NOT NULL
      AND OLD.claim_notified_at IS NULL
      AND NEW.notified_grant_generation IS NULL
    )
    EXECUTE FUNCTION backfill_notified_grant_generation();
