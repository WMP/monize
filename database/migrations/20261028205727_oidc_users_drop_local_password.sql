-- An SSO-linked account keeps no local password (kenlasko/monize#1858,
-- option 1). Linking used to leave password_hash in place while the OIDC login
-- dropped the TOTP secret, so the email-change, password-change and reset
-- paths still accepted the old password as a single factor. The code now
-- clears it on every link (adoptOidcIdentity, auth.service.ts); this clears it
-- on the accounts linked before.
--
-- 1. A backup key wrapped under the CURRENT login password is kept as the
--    account's dedicated backup key (its password ref cleared): the person
--    knows that password. A wrap whose ref does not match the hash (made
--    under an older password, or with no hash left) is dropped, as
--    resolveBackupKey would have dropped it, rather than turned into a live
--    key nobody may be able to open. Runs first: it reads password_hash.
-- 2. The password, the forced-change flag and any reset token are cleared.
-- Re-runs match nothing: each WHERE reads the pre-migration state.
UPDATE users
   SET backup_key_password_ref = NULL
 WHERE auth_provider = 'oidc'
   AND backup_key_password_ref IS NOT NULL
   AND password_hash IS NOT NULL
   AND backup_key_password_ref =
       encode(sha256(convert_to(password_hash, 'UTF8')), 'hex');

UPDATE users
   SET backup_encryption_enabled = FALSE,
       backup_password_enc = NULL,
       backup_key_enc = NULL,
       backup_key_wrap = NULL,
       backup_key_password_ref = NULL
 WHERE auth_provider = 'oidc'
   AND backup_key_password_ref IS NOT NULL;

UPDATE users
   SET password_hash = NULL,
       must_change_password = FALSE,
       reset_token = NULL,
       reset_token_expiry = NULL
 WHERE auth_provider = 'oidc'
   AND (password_hash IS NOT NULL OR reset_token IS NOT NULL);
