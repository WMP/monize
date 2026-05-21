-- Backup encryption opt-in toggle and stored backup password (encrypted with
-- AI_ENCRYPTION_KEY so the auto-backup cron can read it).
--
-- For local-auth users, backup_password_enc holds their login password
-- (re-stored on enable and on every password change). For OIDC users it holds
-- a dedicated "backup password" they set in Security since they have no login
-- password to draw from.
--
-- The backup file format itself is independent of AI_ENCRYPTION_KEY -- restore
-- only requires the user's password. AI_ENCRYPTION_KEY is solely for at-rest
-- DB confidentiality of this stored copy.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS backup_encryption_enabled BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS backup_password_enc TEXT;
