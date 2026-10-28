-- An SSO-linked account keeps no local password (kenlasko/monize#1858,
-- option 1). Linking used to leave password_hash in place while the OIDC login
-- dropped the TOTP secret, so the email-change, password-change and reset
-- paths still accepted the old password as a single factor. The code now
-- clears it on every link; this clears it on the accounts linked before.
--
-- A stored backup key wrapped under that password is kept: clearing its
-- password ref makes it the account's dedicated backup key (still opened by
-- the password it was made with), where a ref to a vanished hash would have
-- resolveBackupKey drop it and write every later backup unencrypted.
-- Re-runs match nothing: the WHERE reads the pre-migration state.
UPDATE users
   SET password_hash = NULL,
       must_change_password = FALSE,
       reset_token = NULL,
       reset_token_expiry = NULL,
       backup_key_password_ref = NULL
 WHERE auth_provider = 'oidc'
   AND (password_hash IS NOT NULL
        OR reset_token IS NOT NULL
        OR backup_key_password_ref IS NOT NULL);
