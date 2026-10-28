-- An SSO-linked account keeps no local password (kenlasko/monize#1858,
-- option 1). Linking used to leave password_hash in place while the OIDC login
-- dropped the TOTP secret, so the email-change, password-change and reset
-- paths still accepted the old password as a single factor. The code now
-- clears it on every link; this clears it on the accounts linked before.
--
-- A stored backup key wrapped under that password goes stale with it and is
-- dropped by the next backup run (backup-encryption.service.ts,
-- resolveBackupKey); the account sets a dedicated backup password instead.
-- Re-runs match nothing: the WHERE reads the pre-migration state.
UPDATE users
   SET password_hash = NULL,
       must_change_password = FALSE,
       reset_token = NULL,
       reset_token_expiry = NULL
 WHERE auth_provider = 'oidc'
   AND (password_hash IS NOT NULL OR reset_token IS NOT NULL);
