# PR draft — feat(auth): OIDC_REQUIRE_VERIFIED_EMAIL

> Draft only. Open when ready:
> base `kenlasko/monize:main` ← head `WMP:feat/oidc-require-verified-email`
> Branch: 1 commit, based on current `main`. Do NOT auto-send.

**Title:** `feat(auth): add OIDC_REQUIRE_VERIFIED_EMAIL to merge by IdP email without verification/SMTP`

---

## Problem

Monize is stricter than typical OIDC apps in two places, which together block some self-hosted setups:

1. It only trusts the OIDC provider's email when the provider asserts `email_verified: true`.
2. Merging an OIDC identity into an existing **local (password)** account requires an email-confirmation step, which needs **SMTP**.

So if your IdP does not send `email_verified` (e.g. a default Authentik OAuth2 provider) and you have no SMTP configured, an OIDC login for a user who already has a local account fails: the email isn't trusted, it falls through to user creation, and either hits the disabled-registration guard or a duplicate-email error. There is no way to link/merge that account without standing up SMTP.

## Change

Add a single environment variable, **`OIDC_REQUIRE_VERIFIED_EMAIL`** (default `true` — **no behavior change**).

Set it to `false` to:
- trust the IdP-provided email even without an `email_verified` claim, and
- merge the OIDC identity **directly** into an existing account matching that email — including a local password account — skipping the confirmation email (so it works without SMTP).

Local password login keeps working afterwards (the merge sets `oidcSubject`/`authProvider` but preserves the password; `login()` gates only on the password, not `authProvider`).

## Security

This intentionally lowers security: with it disabled, anyone who can get the IdP to issue a token for an email owns the matching Monize account. Only disable it when you trust your IdP to verify email ownership. Documented as such in `.env.example`, and the default keeps the strict, confirmation-based behavior.

## Scope / testing

- No DB or schema changes — pure config + logic in `findOrCreateOidcUser`.
- `backend/.env.example` documents the variable.
- Added unit tests: default still requires verification; `false` merges a password account directly without sending a confirmation email.
- `tsc` clean; full `auth.service`/`auth.controller` suites pass (219 tests).

Files: `backend/src/auth/auth.service.ts`, `backend/src/auth/auth.service.spec.ts`, `.env.example`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
