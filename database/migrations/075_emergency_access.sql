-- Emergency Access feature: lets an account owner pre-designate one or more
-- emergency contacts who automatically receive a magic link to take over the
-- account after a configurable period of inactivity (default 14 days). The
-- owner is reminded daily once a shorter threshold (default 7 days) is hit.
--
-- The free-form message body is encrypted at rest via AiEncryptionService
-- (AES-256-GCM keyed by AI_ENCRYPTION_KEY env var) so a database dump alone
-- cannot leak it; the running app retains the key and can decrypt for
-- editing and for inclusion in the contact's grant email.

CREATE TABLE IF NOT EXISTS emergency_access_settings (
    owner_user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    enabled               BOOLEAN NOT NULL DEFAULT false,
    grant_after_days      INTEGER NOT NULL DEFAULT 14 CHECK (grant_after_days > 0),
    reminder_after_days   INTEGER NOT NULL DEFAULT 7  CHECK (reminder_after_days > 0),
    message_ciphertext    TEXT,
    last_reminder_sent_at TIMESTAMP,
    granted_at            TIMESTAMP,
    created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT emergency_access_settings_reminder_lt_grant
        CHECK (reminder_after_days < grant_after_days)
);

CREATE TABLE IF NOT EXISTS emergency_access_contacts (
    id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    first_name             VARCHAR(100) NOT NULL,
    email                  VARCHAR(255) NOT NULL,
    claim_token_hash       VARCHAR(128),
    claim_token_expires_at TIMESTAMP,
    claim_token_used_at    TIMESTAMP,
    claim_voided_reason    VARCHAR(20),
    created_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_emergency_access_contacts_owner_email
    ON emergency_access_contacts(owner_user_id, lower(email));

CREATE INDEX IF NOT EXISTS idx_emergency_access_contacts_token_hash
    ON emergency_access_contacts(claim_token_hash)
    WHERE claim_token_hash IS NOT NULL;
