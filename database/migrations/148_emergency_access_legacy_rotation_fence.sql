-- 148: refuse a generation-blind token rotation that would kill a delivered link.
--
-- Migration 147 translates the *acknowledgement* the previous release writes into
-- the current grant generation. That covers the binary that knows about
-- `claim_notified_at` -- but the release actually running in production today
-- (pre-145) never writes that column at all. Its grant loop is:
--
--     UPDATE emergency_access_contacts
--        SET claim_token_hash = $1, claim_token_expires_at = $2,
--            claim_token_used_at = NULL, claim_voided_reason = NULL
--      WHERE id = $3
--
-- guarded only by a snapshot read of `emergency_access_settings.granted_at`. During
-- a rolling deploy a stale old pod can take that snapshot before the new pod's
-- grant commits, then rotate the hash *after* the new pod has minted, delivered and
-- recorded a link -- so the link already in the recipient's inbox dies silently,
-- which is exactly the P4-014 outcome the generation machinery exists to end. No
-- trigger that waits for an acknowledgement ever sees this write, because the old
-- binary acknowledges nothing.
--
-- The rule has to live where both binaries meet, so it is a BEFORE UPDATE trigger.
-- What separates the binaries at the SQL level is the credential protocol: the
-- current code never writes a new `claim_token_hash` without writing the matching
-- `claim_token_ciphertext` in the same statement (`credentialFor` commits the pair
-- together, and `markContactNotified` clears the ciphertext only alongside the
-- generation). The legacy binary predates both columns, so its rotation changes
-- neither. A "legacy-shaped rotation" is therefore: a new non-NULL hash, with the
-- ciphertext and the notified generation both left untouched.
--
-- Such a rotation is refused only when it would destroy new-protocol state:
--
--   1. `claim_token_ciphertext IS NOT NULL` -- an undelivered credential is in
--      flight. Overwriting the hash desyncs the pair, so the retry would either
--      re-send a link whose hash is gone (a dead link recorded as delivered) or
--      rotate again and kill whichever link the old pod just emailed.
--   2. a live, unconsumed, unexpired link whose delivery the new protocol has
--      recorded (`notified_grant_generation IS NOT NULL`) -- the exact race above:
--      the recipient is holding this link, and the blind rotation kills it.
--
-- Everything else passes. Setting the hash to NULL (revocation, disable, claim
-- consumption) is never a rotation; a rotation over a row with no new-protocol
-- state is the legacy binary retrying its own legacy grant, which stays exactly as
-- correct or incorrect as it is on current main; and a rotation over an expired or
-- consumed link destroys nothing anyone can use. In particular a pure rollback to
-- the old binary keeps working, except in the two states above -- where the old
-- pod's per-contact try/catch logs the refusal and retries daily, which is loud,
-- while the alternative is a silently dead link during an account recovery. The
-- rollout/drain trade-off is documented in docs/cron-jobs.md.
--
-- No SECURITY DEFINER: the decision reads only OLD and NEW, no other table.
--
-- Idempotent: CREATE OR REPLACE FUNCTION, and the trigger is dropped first.

CREATE OR REPLACE FUNCTION reject_legacy_emergency_token_rotation()
    RETURNS TRIGGER
    LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.claim_token_ciphertext IS NOT NULL THEN
        RAISE EXCEPTION
            'emergency-access contact % has an undelivered credential; a generation-blind token rotation would desync it (a newer release owns this credential cycle)',
            OLD.id;
    END IF;
    IF OLD.notified_grant_generation IS NOT NULL
       AND OLD.claim_token_hash IS NOT NULL
       AND OLD.claim_token_used_at IS NULL
       AND OLD.claim_token_expires_at IS NOT NULL
       AND OLD.claim_token_expires_at >= CURRENT_TIMESTAMP THEN
        RAISE EXCEPTION
            'emergency-access contact % holds a live delivered link; a generation-blind token rotation would kill it (a newer release owns this credential cycle)',
            OLD.id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_eac_reject_legacy_token_rotation
    ON emergency_access_contacts;
CREATE TRIGGER trg_eac_reject_legacy_token_rotation
    BEFORE UPDATE ON emergency_access_contacts
    FOR EACH ROW
    WHEN (
      NEW.claim_token_hash IS NOT NULL
      AND NEW.claim_token_hash IS DISTINCT FROM OLD.claim_token_hash
      AND NEW.claim_token_ciphertext IS NOT DISTINCT FROM OLD.claim_token_ciphertext
      AND NEW.notified_grant_generation IS NOT DISTINCT FROM OLD.notified_grant_generation
    )
    EXECUTE FUNCTION reject_legacy_emergency_token_rotation();
