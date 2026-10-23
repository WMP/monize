
# Monize Full Read-Only Audit — Phase 2: Security, Authorization, and PostgreSQL RLS

| Field | Value |
| --- | --- |
| Audit phase | Phase 2 — Security, Authorization, and PostgreSQL RLS |
| Worker chat | Phase 2 Security/RLS worker chat |
| Repository | `kenlasko/monize` |
| Audited baseline | `d5cea9bfa995885ba5198f9843359362927c0fd4` |
| Report filename | `monize-audit-02-security-rls.md` |
| Review mode | Read-only, SHA-pinned GitHub connector inspection |
| Completion status | Complete with the limitations in Sections 9 and 11 |
| Report date | 2026-08-01 |

## Executive finding summary

The audit confirmed **9 defects**: **0 BLOCKER, 1 HIGH, 8 MEDIUM, and 0 LOW**. The highest-severity defect is outside PostgreSQL itself: automatic backups from different tenants share the same default directory and date-based filenames, so later jobs can overwrite or delete another tenant's recovery artifacts. Eight additional defects affect filesystem authorization, delegated profile serialization, MCP scope binding, OIDC step-up verification, runtime-role validation, delegation behavior under enforced RLS, emergency-access activity attribution, and global currency cleanup performed through RLS-filtered counts.

The underlying RLS framework is materially stronger than a generic application-only tenant filter: identity GUCs are transaction-local, the application has an explicit non-owner role design, 53 user/security tables are covered by catalog-driven policies, four exemptions are documented, and integration tests exercise a real unprivileged role, fail-closed behavior, cross-user inserts, delegation semantics, bypass, and commit-time GUC cleanup. The confirmed defects are concentrated at cross-layer transitions where the database policy is correct but application code uses the wrong identity, relies on an RLS-filtered result for a global decision, leaves the database for a shared filesystem namespace, or caches authorization state outside the bearer token.

| Severity | Confirmed findings |
| --- | ---: |
| BLOCKER | 0 |
| HIGH | 1 |
| MEDIUM | 8 |
| LOW | 0 |
| **Total** | **9** |

## 1. Phase scope

This phase reviewed authenticated identity propagation, effective-versus-real-user semantics, delegation, emergency access, PostgreSQL RLS policies and enablement, runtime-role provisioning and grants, system-context bypasses, JWT/cookie/CSRF/PAT/OAuth/MCP boundaries, raw SQL and query-builder access, backup/restore/support-backup/import/cron/admin/bootstrap context transitions, deployment configuration, and relevant tests/documentation.

The review followed material behavior across controller/transport -> authentication/guard -> request context -> AsyncLocalStorage -> `withScopedDb` -> GUCs -> service/query -> migration/schema policy -> tests, and extended beyond PostgreSQL when the protected data crossed into backup files or MCP session state.

This was not a generic checklist. Items were reported only when a realistic failure path was supported at the audited SHA. Phase 1 findings were independently rechecked only for their assigned security/RLS implications.

## 2. Audited baseline SHA

`AUDIT_BASELINE_SHA=d5cea9bfa995885ba5198f9843359362927c0fd4`

Every repository file used as evidence was fetched with `ref=d5cea9bfa995885ba5198f9843359362927c0fd4`. The default branch was not resolved again and no later commit was substituted. GitHub code search was used only to discover candidate paths because the connector's search result URLs can point at the current branch; every evidentiary file was re-fetched through the SHA-pinned file action before it was relied upon.

## 3. Method

### 3.1 Repository instruction hierarchy applied

1. Root `CLAUDE.md` applied repository-wide.
2. `backend/CLAUDE.md` applied to backend code and tests.
3. `database/CLAUDE.md` applied to schema and migration work.
4. `backend/src/mcp/CLAUDE.md` applied to MCP transport, tools, resources, prompts, and scope behavior.
5. `frontend/CLAUDE.md` applied where browser proxy, cookie, CSRF, delegation, and API boundaries were traced.
6. `.claude/settings.json`, `.claude/skills/*.md`, `CONTRIBUTING.md`, `SECURITY.md`, and feature documentation were treated as auxiliary guidance. Where they conflict with the root or nearest scoped `CLAUDE.md`, the scoped instruction wins.

No `AGENTS.md` was located by the available capped search. Because a recursive SHA-pinned tree listing was not available, this is **not** treated as proof that no `AGENTS.md` exists.

### 3.2 Static audit procedure

- Read the instruction and security/RLS documentation before implementation code.
- Enumerated RLS policy groups from migrations 112, 113, 114, 117, and 118; compared enablement in migration 123 and the fresh schema representation.
- Compared the table catalog used by integration tests with policy and exemption lists.
- Traced the application role from environment resolution through provisioning/grants and the runtime TypeORM connection.
- Inspected every production path in the ESLint `WITH_CONTEXT_ALLOWLIST`; each is represented in the bypass/context ledger below.
- Traced representative ordinary reads and writes, delegated requests, PAT requests, OAuth/MCP requests, scheduled jobs, backup export, support backup, and destructive restore.
- Inspected relevant unit/integration tests and queried commit-associated CI status through the connector.
- Classified unresolved concerns as design risks or missing tests instead of confirmed defects.

### 3.3 Cross-layer traces performed

**Ordinary authenticated read:** browser/Next proxy -> access cookie -> JWT strategy -> global guards -> request-context interceptor -> `current=real=user` -> `withScopedDb` -> transaction-local GUCs -> account/service query -> direct or indirect policy -> serialization.

**Ordinary authenticated write:** browser mutation -> CSRF double-submit check -> JWT/role/delegate guards -> request context -> scoped transaction -> repository/raw SQL using the transaction manager -> `WITH CHECK` -> response.

**Delegated request:** authenticated delegate -> acting token revalidation -> owner/delegate relationship -> effective owner in `app.current_user_id`, authenticated delegate in `app.real_user_id` -> account grants -> owner finance policies plus real-user security policies. User A (owner), User B (unrelated tenant), and Delegate D were used in the reasoning and proposed tests.

**PAT request:** JWT-protected PAT creation -> random token returned once -> stored hash -> bearer extraction/validation -> read/write scope string -> MCP user context -> tool scope check -> domain service -> RLS.

**OAuth/MCP request:** client/grant/token state -> opaque access-token validation and `monize:read`/`monize:write` normalization -> MCP transport -> session -> tool registration -> domain service -> owner-scoped database work. This trace produced P2-004.

**System/scheduled operation:** cron/bootstrap/admin caller -> explicit `withSystemContext` -> bypass GUC in a scoped transaction -> global enumeration or maintenance -> where applicable, exit bypass and enter `withUserContext` per tenant -> audit log and transaction cleanup.

**Backup/restore:** JWT owner -> CSRF and destructive confirmation -> owner export or one destructive transaction -> relationship closure, ID remapping and timestamp-preservation GUC -> RLS predicates -> filesystem write or commit. The database portion remained owner-scoped; P2-001/P2-002 occur at the filesystem boundary and P2-005 at reauthentication.

### 3.4 Test and CI evidence

The integration harness applies real migrations, provisions an unprivileged test role, and exercises RLS with that role. Tests/checks were inspected but **not executed** in this environment. Connector queries for combined status and pull-request-triggered workflow runs associated with `d5cea9bfa995885ba5198f9843359362927c0fd4` returned no entries. This is recorded as **no status observed**, not as a CI failure.

### 3.5 Evidence standards and line-number note

Confirmed findings use exact repository paths and source ranges from targeted SHA-pinned fetches. For some full-file connector reads used only in the bypass ledger, the connector returned the entire file as a JSON string without stable per-source-line offsets. Those entries identify the exact method/handler and are marked by method name; this limitation is not used to weaken or inflate any confirmed finding.


## 4. Confirmed findings

### P2-001 — Automatic backups use a shared tenant-agnostic file namespace and overwrite or delete other users' recovery artifacts

- **Classification:** confirmed defect
- **Severity:** HIGH
- **Confidence:** high
- **Relevant paths and lines:**
  - `backend/src/backup/auto-backup.service.ts:25-46`
  - `backend/src/backup/auto-backup.service.ts:126-145`
  - `backend/src/backup/auto-backup.service.ts:276-424`
  - `backend/src/backup/auto-backup.service.ts:426-536`
  - `docker-compose.prod.yml:31-82`
  - `backend/src/backup/auto-backup.service.spec.ts:260-700`
- **Violated invariant:** a tenant-scoped backup job must not overwrite, rename, retain, or delete another tenant's backup artifacts. System fan-out must return to a tenant-specific storage namespace before writing.
- **Evidence:** every user without a custom path resolves to the same deployment-wide folder, normally `/data/backups`. Daily, weekly, and monthly filenames contain only the tier, date, and extension. The production Compose file mounts one shared volume at that path. `fs.writeFile` replaces an existing same-name file, and retention scans every matching filename in the shared folder without a user discriminator.
- **Realistic reproduction:** User A and User B both keep the default backup folder and both have unencrypted automatic backups due on 2026-08-01. A's job writes `monize-backup-daily-2026-08-01.json.gz`; B's later job writes the same path and replaces A's backup. On a weekly/monthly boundary the same collision repeats for promoted copies. A retention run for either user can also delete matching files produced for the other user because the retention scan has no tenant namespace.
- **Impact:** reliable cross-tenant write/delete of recovery artifacts, silent loss of backup history, false success status for the user whose artifact was replaced, and operational inability to restore the expected tenant. The database query path remains user-scoped, but the filesystem side effect breaks tenant isolation after the export leaves PostgreSQL.
- **Recommended correction:** write each user's automatic backups below an operator-controlled tenant directory such as `<root>/<stable-user-id>/`, or include an unambiguous tenant component in every filename and retention filter. Use an atomic temporary file plus rename, refuse collisions, scope retention to the tenant directory, and migrate or quarantine legacy shared-folder files.
- **Recommended regression test:** create due settings for User A and User B using the same default root and same date/extension; assert distinct final paths and independent file contents. Run retention for A and assert no B file is enumerated, copied, replaced, or deleted. Add a concurrent-write variant.
- **Verification method:** static cross-layer trace from cron fan-out through `withUserContext`, export buffer creation, filename construction, filesystem write, retention patterns, production volume mount, and unit-test expectations. No filesystem runtime was executed.

### P2-002 — Any authenticated user can enumerate container directories and direct backups to arbitrary writable absolute paths

- **Classification:** confirmed defect
- **Severity:** MEDIUM
- **Confidence:** high
- **Relevant paths and lines:**
  - `backend/src/backup/backup.controller.ts:230-275`
  - `backend/src/backup/auto-backup.service.ts:220-274`
  - `backend/src/backup/auto-backup.service.ts:636-738`
  - `backend/src/backup/auto-backup.service.spec.ts:330-500`
  - `docker-compose.prod.yml:20-82`
- **Violated invariant:** a normal tenant must not choose arbitrary server-side filesystem locations or enumerate server directory structure. User-controlled paths must remain within an operator-approved root and a tenant-specific subdirectory.
- **Evidence:** `validate-folder` and `browse-folders` are exposed to every JWT-authenticated non-demo user without an admin/host-operator guard. Validation rejects relative paths, `..`, NUL bytes, and non-normalized paths, but it does not enforce an allowed root or canonical `realpath` descendant. The test suite explicitly treats `browseFolders("/")` as valid. A selected existing writable path is persisted and used by manual and scheduled backup writes.
- **Realistic reproduction:** a normal user posts `/` to `POST /backup/browse-folders` and receives visible top-level directory names, then walks readable directories. The user selects a writable mount or `/tmp`, saves it as the backup folder, and triggers repeated backups. In deployments with broader mounts or permissions, the same primitive reaches those paths.
- **Impact:** server/container filesystem metadata disclosure; user-controlled writes of predictable backup filenames outside the approved backup volume; disk-consumption abuse; and possible replacement/deletion of other files matching Monize's retention filename patterns. The production read-only root reduces but does not eliminate the issue because tmpfs and mounted volumes remain writable, and other deployment modes may expose more.
- **Recommended correction:** make the storage root operator-only configuration. Resolve the canonical path with `realpath`, enforce that it is a strict descendant of the configured root, allocate a server-chosen tenant subdirectory, and remove arbitrary browsing from normal users. If host path selection is required for a single-user appliance mode, gate it behind an explicit admin/appliance capability that cannot coexist silently with multi-user tenancy.
- **Recommended regression test:** assert a normal user cannot browse `/`, `/tmp`, the attachments mount, or a sibling tenant directory; assert symlink/canonicalization escapes fail; assert only the server-assigned tenant directory is writable; and assert an admin-only appliance mode is explicit.
- **Verification method:** static controller-to-service-to-filesystem trace and review of the pinned unit tests. No container filesystem was probed.

### P2-003 — Delegated `GET /users/me` converts the owner's `User` entity to a plain object and leaks security fields

- **Classification:** confirmed defect
- **Severity:** MEDIUM
- **Confidence:** high
- **Relevant paths and lines:**
  - `backend/src/users/users.controller.ts:30-64`
  - `backend/src/users/entities/user.entity.ts:17-174`
  - `backend/src/users/users.controller.spec.ts:31-72`
- **Violated invariant:** delegation may expose permitted finance/profile data, but it must not transfer credentials, authentication setup secrets, reset/link tokens, encrypted backup secrets, or security-only state belonging to the owner.
- **Evidence:** the route is `@AllowDelegate()` and resolves `req.user.id`, which is the effective owner while acting. It removes only `passwordHash`, `resetToken`, `resetTokenExpiry`, and `twoFactorSecret`, then spreads the entity into a plain object. The entity has additional default-selected `@Exclude()` fields: email verification token/expiry, pending 2FA secret, backup codes, OIDC link token/expiry, pending OIDC subject, and encrypted backup password. Spreading removes class-transformer metadata, so the global serializer cannot apply those exclusions to the resulting plain object. The unit test asserts only the four manually removed fields.
- **Realistic reproduction:** Owner A begins 2FA setup or OIDC linking, or has backup encryption enabled. Delegate B switches into A's acting context and calls `GET /users/me`. The response is built from A's row and includes the remaining excluded security fields.
- **Impact:** disclosure of authentication workflow material and encrypted/hashed security data to a finance delegate. Some values require additional conditions to exploit, but the disclosure violates the documented delegation boundary and can materially reduce the security of pending verification/linking workflows.
- **Recommended correction:** return an explicit profile response DTO/allowlist and never spread the persistence entity. Reuse one audited sanitizer for login/profile responses, and make owner-versus-real-user semantics explicit for every field.
- **Recommended regression test:** with User A as owner and User B as delegate, populate every excluded field on A; call the real HTTP route while acting; assert none is serialized and only the documented profile allowlist remains. Include a non-delegated control.
- **Verification method:** static controller/entity/serializer/test trace at the pinned SHA.

### P2-004 — An MCP session can borrow cached `write` scope from an earlier same-user token

- **Classification:** confirmed defect
- **Severity:** MEDIUM
- **Confidence:** high
- **Relevant paths and lines:**
  - `backend/src/mcp/mcp-http.controller.ts:90-215`
  - `backend/src/mcp/tools/transactions.tool.ts:535-660`
  - `backend/src/mcp/mcp-http.controller.spec.ts:1-340`
- **Violated invariant:** every bearer-authorized MCP request must be authorized by the currently presented token, and a session must not retain capabilities after token narrowing, replacement, or revocation.
- **Evidence:** every request validates the presented PAT/OAuth bearer, but an existing session is accepted when the current token's `userId` equals the cached session user. The session's scopes are stored at creation and are not compared with, replaced by, or intersected with the current token's scopes. Tool authorization reads the cached session scopes; `manage_transactions` requires cached `write`.
- **Realistic reproduction:** User A creates an MCP session with a `write` PAT. A later sends a request for that session using a different valid `read`-only PAT for the same user. The user-id check passes, the server retains the original cached `write`, and a mutating transaction tool is authorized. The same pattern lets a replacement same-user token keep a session alive after the original write token is revoked until the session expires.
- **Impact:** constrained privilege escalation within one user's token set and failure of revocation/scope reduction semantics. A read-only integration credential can perform writes when it obtains or reuses a session id created under a broader credential.
- **Recommended correction:** bind each session to a credential fingerprint/token id/client grant and its current authorization state. On every request, either require the same credential and revalidate revocation, or replace/intersect cached scopes with the currently validated token and destroy the session when the original grant is revoked or narrowed.
- **Recommended regression test:** create a session with write, then reuse it with read-only same-user PAT and OAuth tokens; every write tool must fail. Revoke the creating token and assert subsequent calls fail even with another same-user token. Add positive same-token and explicit reauthorization cases.
- **Verification method:** static bearer-auth -> session cache -> tool-scope trace and test inventory review.

### P2-005 — OIDC restore, data deletion, and account deletion accept any non-empty string as reauthentication

- **Classification:** confirmed defect
- **Severity:** MEDIUM
- **Confidence:** high
- **Relevant paths and lines:**
  - `backend/src/users/users.service.ts:383-408`
  - `backend/src/users/users.service.ts:493-523`
  - `backend/src/backup/backup.service.ts:945-979`
  - `backend/src/backup/backup.controller.ts:120-174`
- **Violated invariant:** destructive actions must require a fresh, cryptographically verifiable proof of the real user's identity, not merely an active session plus an attacker-controlled non-empty field.
- **Evidence:** all three OIDC branches test only whether `oidcIdToken` is non-empty. The restore implementation explicitly documents the value as a client-supplied “session confirmed” sentinel and performs no signature, issuer, audience, nonce, subject, action binding, or freshness validation. Tests use a literal sentinel value and therefore preserve the bypass as expected behavior.
- **Realistic reproduction:** an attacker who can use a stolen but still-valid OIDC-backed Monize session and satisfy the route's CSRF requirement sends `x-restore-oidc-token: x` or `{ "oidcIdToken": "x" }`. The backend treats the string as reauthentication and allows destructive restore, delete-data, or account-deletion logic.
- **Impact:** the intended second proof for the highest-impact user actions collapses to possession of the existing session. This increases the damage of session theft and defeats the explicit reauthentication contract.
- **Recommended correction:** issue a short-lived signed step-up artifact after an OIDC reauthentication flow using `prompt=login` or an appropriate `max_age`. Bind it to user id, session id, intended action, nonce, and short expiry; consume it once. Reuse the existing signed step-up architecture where possible.
- **Recommended regression test:** reject arbitrary strings, stale/replayed artifacts, wrong user/session/action/audience, and ordinary access tokens; accept only a fresh action-bound proof. Cover restore, delete-data, and delete-account independently.
- **Verification method:** static controller/service/test trace. The external identity provider was not invoked.

### P2-006 — `RLS_MODE=enforce` can start with a database owner, superuser, or `BYPASSRLS` runtime role

- **Classification:** confirmed defect
- **Severity:** MEDIUM
- **Confidence:** high
- **Relevant paths and lines:**
  - `backend/src/common/db/rls-config.ts:65-96`
  - `backend/src/common/db/app-role.ts:44-109`
  - `backend/src/common/db/app-role.ts:122-165`
  - `backend/src/app.module.ts:100-185`
- **Violated invariant:** the enforce-mode runtime role must be non-owner, non-superuser, and must not have `BYPASSRLS`; owner credentials must not silently serve ordinary requests.
- **Evidence:** enforce mode requires an application password and selects the configured application username, but it does not query role attributes or database ownership. Provisioning creates a safe role when absent, but an existing role is only altered to `LOGIN PASSWORD`; it is not converged to `NOSUPERUSER NOBYPASSRLS`, and startup does not refuse a role that owns the database/tables. The application then connects using that role.
- **Realistic reproduction:** an operator sets `DATABASE_APP_USER` to the existing database owner or another pre-provisioned role with `BYPASSRLS`, supplies a valid `DATABASE_APP_PASSWORD`, and sets `RLS_MODE=enforce`. Startup succeeds and ordinary requests run through a role PostgreSQL exempts from the intended policies.
- **Impact:** deployment-level failure of the RLS defense while the application reports enforce mode. Application predicates may still limit many routes, but the database no longer provides the promised tenant boundary, and raw/mistaken queries can expose or mutate cross-tenant data.
- **Recommended correction:** at startup, connect as the selected runtime role and fail closed unless `current_user` is exactly the configured role and `pg_roles` reports `rolsuper=false` and `rolbypassrls=false`; also reject the current database owner and relevant object owners. Provision roles through a controlled owner/CNPG path with explicit `NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`, then verify rather than assuming convergence.
- **Recommended regression test:** provision roles representing safe, superuser, BYPASSRLS, database owner, table owner, missing, and wrong-password cases; enforce mode must start only with the safe role. Include managed-Postgres insufficient-privilege behavior.
- **Verification method:** static configuration/provisioning/connection trace. Deployed role catalogs and secrets were not accessible.

### P2-007 — Owner-managed delegation workflows cannot read or create the delegate's `users` row under RLS enforcement

- **Classification:** confirmed defect
- **Severity:** MEDIUM
- **Confidence:** high
- **Relevant paths and lines:**
  - `database/migrations/114_rls_policies_special.sql:20-39`
  - `backend/src/delegation/delegation.service.ts:790-1035`
  - `backend/src/delegation/delegation.service.ts:1037-1080`
  - `backend/test/integration/rls-enforcement.integration.spec.ts:420-555`
- **Violated invariant:** a supported owner workflow must execute under a context whose RLS policy can reach exactly the required cross-user identity records, and must fail closed without making the feature unusable.
- **Evidence:** `users_self` permits only `id=current_user`, `id=real_user`, or bypass. Its own migration comment says legitimate arbitrary cross-user lookups must use system context. In an owner's normal session, current and real both equal the owner. `delegateEmailExists`, `createDelegate`, and revoke cleanup query or create another user's row without system context. Existing delegates are invisible; new delegate inserts fail `WITH CHECK`; later user cleanup/lookups can silently return no row. The integration suite verifies pre-seeded policy visibility but not the owner-facing service workflow.
- **Realistic reproduction:** enable RLS and connect as the application role. Owner A adds existing User B by email: the lookup returns no user, then insertion of a new B-shaped row is rejected by `users_self`. Adding a brand-new delegate also fails on the user insert. Revoking an owner-managed delegate can fail to find/delete the delegate identity row.
- **Impact:** delegation creation/linking and parts of revocation/reset become unavailable in enforce mode. This is a security-critical availability failure in the authorization subsystem and can leave stale delegate identities or sessions when cleanup silently misses the user row.
- **Recommended correction:** perform only the identity-directory lookup/create/cleanup portion inside a narrow, reviewed system transaction or security-definer function, with normalized email, explicit expected row state, and audit logging. Keep the `account_delegates` and grant writes in the owner's ordinary scoped transaction. Do not widen `users_self` to arbitrary cross-user reads.
- **Recommended regression test:** under the unprivileged app role, have Owner A add existing full User B, add a new delegate-only User C, reject self/duplicate/race cases, set grants, revoke C, and verify A cannot read arbitrary unrelated user rows. Exercise rollback and concurrent email creation.
- **Verification method:** static policy-to-service-to-test trace; no live database execution.

### P2-008 — Delegated requests update the owner's activity timestamp and can indefinitely suppress emergency access

- **Classification:** confirmed defect
- **Severity:** MEDIUM
- **Confidence:** high
- **Relevant paths and lines:**
  - `backend/src/auth/strategies/jwt.strategy.ts:70-190`
  - `backend/src/common/interceptors/request-context.interceptor.ts:55-112`
  - `backend/src/emergency-access/emergency-access-monitor.service.ts:40-180`
  - `frontend/src/i18n/messages/en/settings.json` (`emergencyAccessCard` and `emergencyAccess.subtitle`)
- **Violated invariant:** `app.current_user_id` is the effective finance owner, while security-sensitive human activity must be attributed to `app.real_user_id`. A delegate must not impersonate owner sign-in/activity for emergency-access timing.
- **Evidence:** an acting JWT resolves `id` to the owner and `realUserId` to the delegate. The interceptor seeds that context but calls `touchLastActivity` with the effective `userId`, updating the owner. The emergency monitor computes waiting periods from the owner's `lastActivityAt`/`lastLogin`. The UI describes the trigger as the owner not signing in for an extended period.
- **Realistic reproduction:** Owner A configures emergency access with a 30-day waiting period and stops signing in. Delegate B has legitimate shared access and makes any allowed request every few days. Each request updates A's activity timestamp, so the monitor never reaches 30 days and the emergency contact is never granted access.
- **Impact:** a delegate can intentionally or unintentionally block the owner's emergency-access safety mechanism indefinitely. Audit/activity data also falsely attributes the delegate's session to the owner.
- **Recommended correction:** record interactive activity against the real authenticated user. If owner-data activity must also be tracked, store it in a separate explicitly delegated field/event that the emergency timer never treats as owner sign-in. Preserve both ids in audit events.
- **Recommended regression test:** with Owner A, Delegate B, and Emergency Contact C, advance time beyond the threshold while B continues acting for A; assert A's owner-sign-in clock is unchanged and C becomes eligible. Verify B's own activity is updated and ordinary A requests reset A's timer.
- **Verification method:** static JWT -> interceptor -> user timestamp -> emergency monitor -> UI contract trace.

### P2-009 — RLS-hidden reference counts allow one user to delete another user's custom-currency preference

- **Classification:** confirmed defect
- **Severity:** MEDIUM
- **Confidence:** high
- **Relevant paths and lines:**
  - `backend/src/currencies/currencies.controller.ts:269-289`
  - `backend/src/currencies/currencies.service.ts:338-402`
  - `backend/src/currencies/currencies.service.ts:520-537`
  - `database/migrations/018_user_currency_preferences.sql:7-18`
  - `database/migrations/112_rls_policies_direct.sql:33-79`
- **Violated invariant:** a user-scoped query must not be used as a global liveness/reference check whose result authorizes deletion of shared rows; deleting a shared global row must not cascade into another tenant's data.
- **Evidence:** `removeWithin` deletes the caller's preference, then counts “remaining” preferences and performs “global” account/security/transaction/preference probes through the caller's ordinary `withScopedDb` context. RLS hides every other user's direct-owned rows, so those counts can report zero even when another tenant still uses the code. The currency delete has no creator authorization check. `user_currency_preferences.currency_code` references `currencies(code) ON DELETE CASCADE`.
- **Realistic reproduction:** User A creates custom currency `XYZ`. User B activates `XYZ`, creating only a preference row and no account/security FK. A (or B) removes their own preference. The other user's preference is invisible to the count, the global probes return false, the shared `currencies` row is deleted, and PostgreSQL cascades deletion of the other tenant's preference. If another non-cascading reference exists, the operation instead fails with an FK error, demonstrating the same incorrect global decision.
- **Impact:** cross-tenant deletion of another user's configuration and unpredictable failures for a global reference object. A non-creator can also trigger global cleanup because deletion is not restricted to `created_by_user_id`.
- **Recommended correction:** separate per-user preference removal from global currency lifecycle. Restrict global deletion to the creator or an administrator, perform the reference decision under a narrowly audited system context (or enforce it with database constraints/state), and never depend on RLS-filtered counts for global liveness. Prefer soft retirement/tombstoning for shared codes.
- **Recommended regression test:** A creates `XYZ`; B activates it; A and B independently remove their own preference; assert the other preference and global code remain until an authorized cleanup sees zero references across all tenants. Add account/security/default-currency references and creator/non-creator cases under the app role.
- **Verification method:** static controller -> transaction -> RLS count -> FK cascade trace at the pinned SHA.


## 5. Design risks

### DR-01 — Nested scoped calls do not verify that the ambient identity matches the active transaction

- **Risk rating:** MEDIUM
- **Confidence:** high that the behavior exists; medium that a production exploit path exists
- **Paths:** `backend/src/common/db/scoped-db.ts:85-111`; `backend/src/common/db/with-context.ts:28-105`
- When `withScopedDb` detects an active manager, it immediately joins it and does not compare the new ambient context with the identity/bypass state that opened the transaction. A nested `withUserContext(B)` or `withSystemContext()` can therefore make application code believe it changed identity while PostgreSQL remains scoped to A. This usually fails closed or writes to A, but it can become a wrong-tenant logic defect if a future caller uses the nested identity for non-database decisions.
- **Recommendation:** store immutable transaction identity metadata beside the active manager. Allow exact same-identity re-entry; reject current/real/system/preserve-timestamp changes unless a narrowly reviewed API explicitly starts a separate transaction. Add positive same-context and negative changed-context tests.

### DR-02 — The runtime role receives blanket DML on every public table and sequence

- **Risk rating:** MEDIUM
- **Confidence:** high
- **Path:** `backend/src/common/db/app-role.ts:78-109`
- The grants include all current and future public tables, including intentionally exempt global/infrastructure tables such as `schema_migrations` and `oauth_payloads`. RLS protects the policied tables, but the grant surface is broader than ordinary request requirements and expands the impact of an application SQL injection or mistaken raw query.
- **Recommendation:** maintain an explicit runtime grant allowlist, revoke migration-infrastructure writes, document why each exempt table is reachable, and test denial of owner-only infrastructure operations under the app role.

### DR-03 — The OAuth adapter is a deliberate direct-DataSource exception but is not clearly represented in the instruction hierarchy

- **Risk rating:** LOW
- **Confidence:** high
- **Path:** `backend/src/oauth/postgres.adapter.ts`
- The adapter accesses the intentionally exempt `oauth_payloads` table outside `withScopedDb`. The exemption is documented in migration 114 and no end-user ownership column exists, so this was not classified as an active RLS bypass. It nevertheless contradicts a literal reading of “every production query uses `withScopedDb`.”
- **Recommendation:** document this exact adapter/table exception in the nearest scoped instruction and lint configuration, or wrap it in a named infrastructure data-access abstraction so future direct queries cannot hide behind the same precedent.

### DR-04 — RLS remains operationally opt-in and therefore depends on disciplined rollout state

- **Risk rating:** MEDIUM operational risk
- **Confidence:** high
- Compose and Helm defaults keep `RLS_MODE=off` until the documented rollout is completed. This is intentional and was not reported as a defect, but it means the policy code can be correct while production receives no database enforcement.
- **Recommendation:** expose an immutable deployment assertion/metric showing runtime role, mode, role attributes, enabled-table count, and policy count; alert when a production-class environment is not in the approved state.

## 6. Missing tests

| ID | Status | Missing or not-located scenario | Relevant inspected test inventory | Recommended assertion |
| --- | --- | --- | --- | --- |
| MT-01 | Confirmed missing | Two users writing/retaining automatic backups in the same default root | `backend/src/backup/auto-backup.service.spec.ts` | Distinct tenant paths; no cross-tenant overwrite, copy, or retention delete; concurrent variant. |
| MT-02 | Confirmed missing | Non-admin filesystem browsing and allowed-root enforcement | `backend/src/backup/auto-backup.service.spec.ts`; `backup.controller.spec.ts` | `/`, sibling mounts, symlink escapes, and arbitrary writable paths are denied. |
| MT-03 | Confirmed missing | Delegated profile serialization of every excluded `User` field | `backend/src/users/users.controller.spec.ts` | Acting delegate receives only an explicit profile allowlist. |
| MT-04 | Confirmed missing | Existing MCP session reused with a narrower/replacement/revoked same-user token | `backend/src/mcp/mcp-http.controller.spec.ts`; MCP tool specs | Current bearer governs every request; cached broader scope cannot survive. |
| MT-05 | Confirmed missing | Cryptographic OIDC step-up for restore/delete-data/delete-account | `backup.service.spec.ts`; `users.service.spec.ts` | Reject sentinel, replay, stale, wrong-action, wrong-user, and wrong-session artifacts. |
| MT-06 | Confirmed missing | Runtime app-role attribute and ownership validation | `rls-config.spec.ts`; `app-role.spec.ts` | Reject superuser, BYPASSRLS, DB owner, table owner, wrong current_user, and unsafe pre-existing roles. |
| MT-07 | Confirmed missing | Owner-facing delegation create/link/revoke workflow under the unprivileged app role | RLS enforcement integration suite; delegation controller unit tests | Existing/new delegate paths succeed without opening arbitrary users access. |
| MT-08 | Confirmed missing | Delegate activity versus owner emergency-access timer | JWT/interceptor and emergency monitor unit tests | Delegate activity updates only the real user and cannot reset owner inactivity. |
| MT-09 | Confirmed missing | Two-user custom-currency delete/creator/global-reference behavior under RLS | `currencies.service.spec.ts`; RLS integration tests | Other tenant preference survives; only authorized global cleanup can remove a code. |
| MT-10 | Confirmed missing | Generic cross-user UPDATE and DELETE on every covered table | `rls-enforcement.integration.spec.ts` | User A cannot update/delete B; ownership reassignment fails through `WITH CHECK`. |
| MT-11 | Confirmed missing | Pool reuse after rollback and thrown error | RLS enforcement integration suite | GUCs and bypass are empty after commit, rollback, and exception on a one-connection pool. |
| MT-12 | Confirmed missing | Nested scoped calls with same and changed current/real/system identities | `scoped-db.spec.ts` | Same identity joins; identity/bypass change is explicitly rejected. |
| MT-13 | Confirmed missing | Runtime role denial of migration/owner infrastructure | RLS harness/app-role tests | Intended DML works; writes to `schema_migrations` and owner-only operations fail. |
| MT-14 | Test not located | Cookie-only request to bearer-only MCP routes | MCP controller tests were inspected; search limitations remain | Cookie without bearer is rejected; bearer route ignores ambient browser cookie authority. |
| MT-15 | Test not located | Full two-user backup/restore/support-backup isolation with relationship closure | Backup/support-backup tests were sampled | A's artifact cannot contain/restore B; support backup remains encrypted and de-identified. |
| MT-16 | Test not located | Full MNY raw-SQL isolation across stage/job/import under app role | RLS generic tests and MNY services were inspected | A cannot poll/update/import B's stage or job; sweeper returns no request data. |

## 7. Documentation issues

### DOC-01 — Contributor and auxiliary instructions still teach database APIs forbidden by the scoped RLS architecture

`CONTRIBUTING.md`, `.claude/skills/backend.md`, and `docs/future-plans/vat-support.md` contain examples or guidance using direct `DataSource.transaction`/repository patterns that conflict with `backend/CLAUDE.md`, the root instruction, and the ESLint architecture. No active production manual `QueryRunner` was established, but the stale guidance creates a realistic regression path.

### DOC-02 — `database/schema.sql` still advertises a PAT `reports` scope that no active issuance or enforcement path accepts

The active PAT contract is `read`/`write`; OAuth exposes `monize:read`/`monize:write` and normalizes them for MCP. The `reports` text is stale documentation, not a granted privilege.

### DOC-03 — Emergency-access wording says “you do not sign in,” while implementation counts delegated owner-context traffic as owner activity

The user-facing contract supports P2-008 and should be preserved by fixing identity attribution. If the intended product rule is “no one accesses the owner's data,” the UI, security model, and audit semantics require an explicit product decision instead.

### DOC-04 — Automatic-backup documentation does not state that the configured folder is a shared multi-user namespace

Code, tests, and production Compose all use one default root with non-tenant filenames. Documentation should instead describe the corrected tenant directory model, ownership/permissions, retention boundaries, and migration of existing artifacts.

### DOC-05 — The direct OAuth adapter exception is documented only indirectly in an RLS migration comment

The nearest backend/MCP instructions should identify `oauth_payloads` as the single infrastructure exception and prohibit extending the exception to user-owned tables.

### DOC-06 — RLS implementation-complete task status is easy to confuse with production enforcement state

The task list marks implementation work complete, while Compose/Helm remain off by default pending the runbook sequence. Documentation should prominently separate “code complete,” “policies installed,” “tables enabled,” “runtime role active,” and “production verified.”


## 8. Reviewed scope

### 8.1 RLS policy legend

Let `CU = app_current_user_id()`, `RU = app_real_user_id()`, and `BR = app_bypass_rls()`.

- **DE:** `user_id = CU OR BR`.
- **DR:** `user_id = CU OR user_id = RU OR BR`.
- **RT:** `user_id = CU OR user_id = RU OR acting_as_user_id = CU OR BR`.
- **US:** `id = CU OR id = RU OR BR`.
- **AD:** `owner_user_id = CU OR delegate_user_id = RU OR BR`.
- **DF:** `delegate_user_id = RU OR BR`.
- **EA:** `owner_user_id = CU OR BR`.
- **IE[parent]:** `BR OR EXISTS(parent relationship ending in parent.user_id = CU)`.
- **IDG:** `BR OR EXISTS(account_delegates parent where owner_user_id = CU OR delegate_user_id = RU)`.
- **EX:** intentionally no policy and no RLS enablement.

Each listed policy is one permissive policy without a command restriction, so its `USING` expression governs SELECT/UPDATE/DELETE and its identical `WITH CHECK` governs INSERT/UPDATE. `DML*` means the runtime role is granted `SELECT, INSERT, UPDATE, DELETE` on all public tables and `USAGE, SELECT` on all public sequences by `app-role.ts`; this is complete but intentionally flagged as over-broad in DR-02.

### 8.2 Complete RLS table matrix

| Table | Classification | Ownership path | Effective / real user | SELECT policy | INSERT WITH CHECK | UPDATE USING / CHECK | DELETE policy | RLS fresh / migrated | Runtime grants | Fresh-schema parity | Migrated-schema parity | Test coverage | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| public.accounts | User-owned direct | user_id | Effective owner | DE | DE | DE / DE | DE | Yes / Yes | DML* | Present | Present | T2 generic |  |
| public.action_history | User-owned direct | user_id | Effective owner | DE | DE | DE / DE | DE | Yes / Yes | DML* | Present | Present | T2 generic |  |
| public.ai_insights | User-owned direct | user_id | Effective owner | DE | DE | DE / DE | DE | Yes / Yes | DML* | Present | Present | T2 generic |  |
| public.ai_provider_configs | User-owned direct | user_id | Effective owner | DE | DE | DE / DE | DE | Yes / Yes | DML* | Present | Present | T2 generic |  |
| public.ai_usage_logs | User-owned direct | user_id | Effective owner | DE | DE | DE / DE | DE | Yes / Yes | DML* | Present | Present | T2 generic |  |
| public.auto_backup_settings | User-owned direct | user_id | Effective owner | DE | DE | DE / DE | DE | Yes / Yes | DML* | Present | Present | T2 generic |  |
| public.budget_alerts | User-owned direct | user_id | Effective owner | DE | DE | DE / DE | DE | Yes / Yes | DML* | Present | Present | T2 generic |  |
| public.budgets | User-owned direct | user_id | Effective owner | DE | DE | DE / DE | DE | Yes / Yes | DML* | Present | Present | T2 generic |  |
| public.categories | User-owned direct | user_id | Effective owner | DE | DE | DE / DE | DE | Yes / Yes | DML* | Present | Present | T2 generic |  |
| public.custom_reports | User-owned direct | user_id | Effective owner | DE | DE | DE / DE | DE | Yes / Yes | DML* | Present | Present | T2 generic |  |
| public.import_column_mappings | User-owned direct | user_id | Effective owner | DE | DE | DE / DE | DE | Yes / Yes | DML* | Present | Present | T2 generic |  |
| public.institutions | User-owned direct | user_id | Effective owner | DE | DE | DE / DE | DE | Yes / Yes | DML* | Present | Present | T2 generic |  |
| public.investment_reports | User-owned direct | user_id | Effective owner | DE | DE | DE / DE | DE | Yes / Yes | DML* | Present | Present | T2 generic |  |
| public.investment_transactions | User-owned direct | user_id | Effective owner | DE | DE | DE / DE | DE | Yes / Yes | DML* | Present | Present | T2 generic |  |
| public.loan_rate_changes | User-owned direct | user_id | Effective owner | DE | DE | DE / DE | DE | Yes / Yes | DML* | Present | Present | T2 generic |  |
| public.loan_scenarios | User-owned direct | user_id | Effective owner | DE | DE | DE / DE | DE | Yes / Yes | DML* | Present | Present | T2 generic |  |
| public.monte_carlo_scenarios | User-owned direct | user_id | Effective owner | DE | DE | DE / DE | DE | Yes / Yes | DML* | Present | Present | T2 generic |  |
| public.monthly_account_balances | User-owned direct | user_id | Effective owner | DE | DE | DE / DE | DE | Yes / Yes | DML* | Present | Present | T2 generic |  |
| public.payee_aliases | User-owned direct | user_id | Effective owner | DE | DE | DE / DE | DE | Yes / Yes | DML* | Present | Present | T2 generic |  |
| public.payees | User-owned direct | user_id | Effective owner | DE | DE | DE / DE | DE | Yes / Yes | DML* | Present | Present | T2 generic |  |
| public.scheduled_transactions | User-owned direct | user_id | Effective owner | DE | DE | DE / DE | DE | Yes / Yes | DML* | Present | Present | T2 generic |  |
| public.securities | User-owned direct | user_id | Effective owner | DE | DE | DE / DE | DE | Yes / Yes | DML* | Present | Present | T2 generic |  |
| public.tags | User-owned direct | user_id | Effective owner | DE | DE | DE / DE | DE | Yes / Yes | DML* | Present | Present | T2 generic |  |
| public.transaction_attachments | User-owned direct | user_id | Effective owner | DE | DE | DE / DE | DE | Yes / Yes | DML* | Present | Present | T2 generic |  |
| public.transactions | User-owned direct | user_id | Effective owner | DE | DE | DE / DE | DE | Yes / Yes | DML* | Present | Present | T2 generic |  |
| public.user_currency_preferences | User-owned direct | user_id | Effective owner | DE | DE | DE / DE | DE | Yes / Yes | DML* | Present | Present | T2 generic | Policy is correct; P2-009 is a cross-tenant cleanup decision made after RLS-hidden counts. |
| public.refresh_tokens | Direct real-user security | refresh_tokens.user_id; acting_as_user_id | Effective + real + owner-session arm | RT | RT | RT / RT | RT | Yes / Yes | DML* | Present | Present | T2 generic + delegation cases | Refresh sessions remain bound to the authenticated user; owner deletion may match acting_as_user_id. |
| public.trusted_devices | Direct real-user security | trusted_devices.user_id | Effective + real | DR | DR | DR / DR | DR | Yes / Yes | DML* | Present | Present | T2 generic + delegation cases | Delegate security operations target the authenticated delegate. |
| public.personal_access_tokens | Direct real-user security | personal_access_tokens.user_id | Effective + real | DR | DR | DR / DR | DR | Yes / Yes | DML* | Present | Present | T2 generic + delegation cases | PAT CRUD is owner-only today; real-user arm is defensive for future delegate allowance. |
| public.user_preferences | Direct mixed ownership | user_preferences.user_id | Effective + real | DR | DR | DR / DR | DR | Yes / Yes | DML* | Present | Present | T2 generic + delegation cases | Owner preferences are effective-user data; 2FA preference operations target the real user. |
| public.import_staged_files | Direct effective-user data | import_staged_files.user_id | Effective | DE | DE | DE / DE | DE | Yes / Yes | DML* | Present | Present | T2 generic | Created by migration 117; decrypted staged bytes are tenant-scoped. |
| public.import_jobs | Direct effective-user data | import_jobs.user_id | Effective | DE | DE | DE / DE | DE | Yes / Yes | DML* | Present | Present | T2 generic | Created by migration 117; background status/progress remains tenant-scoped. |
| public.security_documents | Direct effective-user data | security_documents.user_id | Effective | DE | DE | DE / DE | DE | Yes / Yes | DML* | Present | Present | T2 generic | Policy added by migration 118. |
| public.transaction_splits | Indirect effective-user data | transaction_splits.transaction_id -> transactions.user_id | Effective owner | IE[transactions] | IE[transactions] | IE[transactions] / IE[transactions] | IE[transactions] | Yes / Yes | DML* | Present | Present | T2 generic + parent-negative insert | One-hop parent ownership. |
| public.transaction_tags | Indirect effective-user data | transaction_tags.transaction_id -> transactions.user_id | Effective owner | IE[transactions] | IE[transactions] | IE[transactions] / IE[transactions] | IE[transactions] | Yes / Yes | DML* | Present | Present | T2 generic + parent-negative insert | Owning side is the transaction. |
| public.transaction_split_tags | Indirect effective-user data | transaction_split_tags.transaction_split_id -> transaction_splits -> transactions.user_id | Effective owner | IE[transaction_splits/transactions] | IE[transaction_splits/transactions] | IE[transaction_splits/transactions] / IE[transaction_splits/transactions] | IE[transaction_splits/transactions] | Yes / Yes | DML* | Present | Present | T2 generic + parent-negative insert | Two-hop ownership. |
| public.attachment_blobs | Indirect effective-user data | attachment_blobs.attachment_id -> transaction_attachments.user_id | Effective owner | IE[transaction_attachments] | IE[transaction_attachments] | IE[transaction_attachments] / IE[transaction_attachments] | IE[transaction_attachments] | Yes / Yes | DML* | Present | Present | T2 generic + parent-negative insert | BYTEA row follows attachment metadata ownership. |
| public.scheduled_transaction_splits | Indirect effective-user data | scheduled_transaction_splits.scheduled_transaction_id -> scheduled_transactions.user_id | Effective owner | IE[scheduled_transactions] | IE[scheduled_transactions] | IE[scheduled_transactions] / IE[scheduled_transactions] | IE[scheduled_transactions] | Yes / Yes | DML* | Present | Present | T2 generic + parent-negative insert | One-hop parent ownership. |
| public.scheduled_transaction_split_tags | Indirect effective-user data | scheduled_transaction_split_tags.scheduled_transaction_split_id -> split -> scheduled_transactions.user_id | Effective owner | IE[scheduled_transaction_splits/scheduled_transactions] | IE[scheduled_transaction_splits/scheduled_transactions] | IE[scheduled_transaction_splits/scheduled_transactions] / IE[scheduled_transaction_splits/scheduled_transactions] | IE[scheduled_transaction_splits/scheduled_transactions] | Yes / Yes | DML* | Present | Present | T2 generic + parent-negative insert | Two-hop ownership. |
| public.scheduled_transaction_overrides | Indirect effective-user data | scheduled_transaction_overrides.scheduled_transaction_id -> scheduled_transactions.user_id | Effective owner | IE[scheduled_transactions] | IE[scheduled_transactions] | IE[scheduled_transactions] / IE[scheduled_transactions] | IE[scheduled_transactions] | Yes / Yes | DML* | Present | Present | T2 generic + parent-negative insert | One-hop parent ownership. |
| public.security_prices | Indirect effective-user data | security_prices.security_id -> securities.user_id | Effective owner | IE[securities] | IE[securities] | IE[securities] / IE[securities] | IE[securities] | Yes / Yes | DML* | Present | Present | T2 generic + parent-negative insert | Per-user security price history, not global FX reference data. |
| public.security_tags | Indirect effective-user data | security_tags.security_id -> securities.user_id | Effective owner | IE[securities] | IE[securities] | IE[securities] / IE[securities] | IE[securities] | Yes / Yes | DML* | Present | Present | T2 generic + parent-negative insert | Owning side is the security. |
| public.holdings | Indirect effective-user data | holdings.account_id -> accounts.user_id | Effective owner | IE[accounts] | IE[accounts] | IE[accounts] / IE[accounts] | IE[accounts] | Yes / Yes | DML* | Present | Present | T2 generic + parent-negative insert | Ownership follows the account. |
| public.budget_categories | Indirect effective-user data | budget_categories.budget_id -> budgets.user_id | Effective owner | IE[budgets] | IE[budgets] | IE[budgets] / IE[budgets] | IE[budgets] | Yes / Yes | DML* | Present | Present | T2 generic + parent-negative insert | One-hop parent ownership. |
| public.budget_periods | Indirect effective-user data | budget_periods.budget_id -> budgets.user_id | Effective owner | IE[budgets] | IE[budgets] | IE[budgets] / IE[budgets] | IE[budgets] | Yes / Yes | DML* | Present | Present | T2 generic + parent-negative insert | One-hop parent ownership. |
| public.budget_period_categories | Indirect effective-user data | budget_period_categories.budget_period_id -> budget_periods -> budgets.user_id | Effective owner | IE[budget_periods/budgets] | IE[budget_periods/budgets] | IE[budget_periods/budgets] / IE[budget_periods/budgets] | IE[budget_periods/budgets] | Yes / Yes | DML* | Present | Present | T2 generic + parent-negative insert | Two-hop ownership. |
| public.monte_carlo_cash_flows | Indirect effective-user data | monte_carlo_cash_flows.scenario_id -> monte_carlo_scenarios.user_id | Effective owner | IE[monte_carlo_scenarios] | IE[monte_carlo_scenarios] | IE[monte_carlo_scenarios] / IE[monte_carlo_scenarios] | IE[monte_carlo_scenarios] | Yes / Yes | DML* | Present | Present | T2 generic + parent-negative insert | One-hop parent ownership. |
| public.account_delegate_grants | Indirect delegation data | account_delegate_grants.delegation_id -> account_delegates(owner_user_id, delegate_user_id) | Effective owner + real delegate | IDG | IDG | IDG / IDG | IDG | Yes / Yes | DML* | Present | Present | T2 generic + parent-negative insert | Parent policy mirrors both owner and delegate arms. |
| public.users | Real-user security / effective identity | users.id | Effective + real | US | US | US / US | US | Yes / Yes | DML* | Present | Present | T2 generic + special delegation tests | Acting delegate may see owner and own user rows; arbitrary cross-user lookup requires bypass. |
| public.account_delegates | Delegation relationship | account_delegates.owner_user_id / delegate_user_id | Effective owner + real delegate | AD | AD | AD / AD | AD | Yes / Yes | DML* | Present | Present | T2 generic + special delegation tests | Visible from both sides of the relationship. |
| public.delegate_account_favourites | Real-user private data | delegate_account_favourites.delegate_user_id | Real only | DF | DF | DF / DF | DF | Yes / Yes | DML* | Present | Present | T2 generic + special delegation tests | Owner must not see a delegate's private favourites. |
| public.emergency_access_settings | Owner security data | emergency_access_settings.owner_user_id | Effective owner | EA | EA | EA / EA | EA | Yes / Yes | DML* | Present | Present | T2 generic + special delegation tests | Public claim side uses explicit system context. |
| public.emergency_access_contacts | Owner security data | emergency_access_contacts.owner_user_id | Effective owner | EA | EA | EA / EA | EA | Yes / Yes | DML* | Present | Present | T2 generic + special delegation tests | Public claim side uses explicit system context. |
| public.currencies | Shared global reference | Global code; created_by_user_id is attribution, not row ownership | Global | None | None | None | None | No / No | DML* | Present | Present | T2 exact exemption-list assertion | Intentional exemption; per-user visibility is represented by user_currency_preferences. P2-009 concerns cleanup logic, not the exemption itself. |
| public.exchange_rates | Shared global reference | Global currency pair/date | Global | None | None | None | None | No / No | DML* | Present | Present | T2 exact exemption-list assertion | Intentional globally readable/writable reference table. |
| public.oauth_payloads | Infrastructure / exempt | Opaque OAuth adapter ids; no end-user owner column | Infrastructure | None | None | None | None | No / No | DML* | Present | Present | T2 exact exemption-list assertion | Intentionally exempt token-store table; adapter accesses it directly. |
| public.schema_migrations | Migration infrastructure / exempt | Migration id | Owner/migration | None | None | None | None | No / No | DML* | Present | Present | T2 exact exemption-list assertion | Ordinary runtime access is not required, but blanket grants currently include it. |


**Matrix totals:** 53 policied tables and 4 intentional exemptions, 57 relevant tables total. The policy migrations and catalog-driven test agree on this partition at the audited SHA. The matrix does not claim runtime production enablement; that depends on the operator completing migration 123/role rollout and selecting enforce mode.

### 8.3 Complete bypass/context-callsite ledger

The ledger covers all 36 production importers in `WITH_CONTEXT_ALLOWLIST`. “System-wide by design” means the operation intentionally spans tenants and returns no tenant-selected result to an ordinary request unless the row is subsequently processed in a user context. Every `withSystemContext` invocation emits a rate-limited call-site log; PostgreSQL bypass and identity GUCs are transaction-local.

| Path and entry function | Trigger | Context type | Effective user | Real user | Tables accessed | Tenant predicate | Justification | Auditability | Failure cleanup | Finding status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| backend/src/accounts/accounts.service.ts — applyDueTransactionBalances | Cron | System bypass | System-wide | System-wide | accounts; scheduled transaction balance inputs | System-wide by design | Timezone-bucketed multi-user balance application | Bypass entry log + service logs | Transaction-local GUC/rollback | Safe reviewed exception |
| backend/src/accounts/mortgage-reminder.service.ts — checkMortgageRenewals | Cron | System fan-out -> user | Owner per item | Owner per item | accounts; users; preferences | Per-user after fan-out | Enumerate upcoming renewals, then send per-owner reminders | Bypass log + reminder logs | Separate transactions; user scope per item | Safe reviewed exception |
| backend/src/action-history/action-history.service.ts — cleanupOldHistory | Cron | System bypass | System-wide | System-wide | action_history | Age predicate; system-wide by design | Cross-user retention cleanup | Bypass log + cleanup log | Transaction-local GUC/rollback | Safe reviewed exception |
| backend/src/admin/admin.service.ts — admin user/statistics operations | Admin request | System bypass | System-wide | Authenticated admin | users and administrative aggregates | Admin-selected ids / system-wide by design | Admin management requires cross-user visibility | Bypass log; admin route logs where present | Transaction-local GUC/rollback | Safe subject to RolesGuard |
| backend/src/ai/ai-usage.service.ts — scheduled usage aggregation/cleanup | Cron | System fan-out / bypass | System-wide then owner | System-wide then owner | ai_usage_logs; users | System-wide aggregate or per-user | Cross-user usage accounting and retention | Bypass log + service logs | Transaction-local GUC/rollback | Safe reviewed exception |
| backend/src/ai/insights/ai-insights.service.ts — scheduled insight fan-out | Cron | System fan-out -> user | Owner per item | Owner per item | users; ai_insights and owner finance inputs | Per-user after fan-out | Discover due users, generate insights in owner scope | Bypass log + job logs | User transaction per item | Safe reviewed exception |
| backend/src/auth/auth.controller.ts — out-of-request auth callbacks | Authentication request | User/system bootstrap | Resolved account | Authenticated principal when known | users; refresh_tokens; trusted devices as applicable | Identity predicates after resolution | Seed request-independent auth context | Auth logs + bypass log | Transaction-local GUC/rollback | Safe reviewed exception |
| backend/src/auth/auth.service.ts — login/register/OIDC/pre-session lookup | Authentication request | System lookup -> user | Resolved account | Authenticated account | users; preferences; refresh_tokens; delegation bootstrap | System only before identity exists; user thereafter | Email/OIDC lookup necessarily precedes user context | Auth logs + bypass log | Scoped transactions; errors roll back | Safe reviewed exception |
| backend/src/auth/pat.service.ts — validateToken/create/revoke | Bearer auth / JWT API | System lookup -> user | Token owner | Token owner | personal_access_tokens; users | Token hash and owner predicates | PAT validation occurs before request context exists | Bypass log; last-used metadata | Scoped transaction/rollback | Safe; active scope contract is read/write |
| backend/src/auth/strategies/jwt.strategy.ts:70-190 — validate | Browser auth | User or delegate context | Owner when acting | Authenticated user/delegate | users; refresh_tokens; account_delegates | Token subject / acting relationship | Revalidate JWT and acting relationship before request scope | Auth logs; guard failures | Scoped transaction/rollback | Safe; feeds P2-008 activity bug downstream |
| backend/src/auth/token.service.ts — refresh/switch/revoke | Refresh / context switch | System lookup -> user/delegate | Owner when acting | Authenticated user | refresh_tokens; users; account_delegates | Token id/user/acting predicates | Refresh token lookup precedes reconstructed context | Token/audit logs where present | Scoped transaction/rollback | Safe reviewed exception |
| backend/src/backup/auto-backup.service.ts:276-424 — manual/cron/exportToFile | Request + cron | System fan-out -> user | Owner per backup | Owner per backup | auto_backup_settings; users; all exported owner tables; filesystem | Per-user DB reads; shared filesystem namespace | Enumerate due settings and export each owner | Bypass log + backup logs | DB scope cleaned; filesystem writes are not transactional | Confirmed defects P2-001 and P2-002 |
| backend/src/backup/backup.service.ts — export/restore | Request / cron helper | User + timestamp preservation | Authenticated owner | Authenticated owner | all backup allowlisted owner tables | Explicit user_id/relationship closure | Export and destructive restore in owner scope; preserve timestamps without RLS bypass | Backup logs | Single restore transaction; rollback on error | Safe tenant scope; P2-005 reauthentication defect |
| backend/src/budgets/budget-alert.service.ts — scheduled alerts | Cron | System fan-out -> user | Owner per item | Owner per item | budgets; budget_alerts; transactions | Per-user after fan-out | Discover due alerts across users | Bypass log + alert logs | User transactions per item | Safe reviewed exception |
| backend/src/budgets/budget-period-cron.service.ts — scheduled period creation | Cron | System fan-out -> user | Owner per budget | Owner per budget | budgets; budget_periods; budget_period_categories | Per-user after fan-out | Discover budgets needing a new period | Bypass log + cron logs | User transaction per item | Safe reviewed exception |
| backend/src/common/interceptors/request-context.interceptor.ts:1-150 — intercept/touchLastActivity | Every authenticated request | User/delegate context | Effective owner | Real authenticated principal | users.last_activity_at plus downstream tables | Request identity from JWT | Initialize ALS before controller/service access | Request logs; no dedicated activity audit | ALS scope ends with request; DB transaction local | Confirmed defect P2-008 |
| backend/src/currencies/currencies.service.ts:1-560 — bootstrap/remove | Bootstrap + request | System bootstrap; ordinary user for CRUD | System or owner | System or owner | currencies; user_currency_preferences; accounts; securities; transactions; user_preferences | Bootstrap system-wide; request reads RLS-filtered | Ensure default global currency; user currency lifecycle | Bypass log on bootstrap | Scoped transaction/rollback | Confirmed defect P2-009 in request cleanup |
| backend/src/currencies/exchange-rate.service.ts:1-330 — startup/cron refresh | Bootstrap + cron + request | System global refresh; user on manual request | System or caller | System or caller | exchange_rates; currencies; cross-user usage inputs | Global refresh by design; manual call remains caller-scoped | Maintain shared FX reference data | Bypass log + refresh logs | Scoped transaction/rollback | Safe reviewed exception |
| backend/src/database/demo-reset.service.ts — reset demo state | Demo administration | System bypass | Configured demo user / system | System | demo user-owned tables | Configured demo target and reset allowlist | Reset shared demo environment | Bypass log + reset logs | Scoped transaction/rollback | Safe if DEMO_MODE gate remains authoritative |
| backend/src/database/demo-seed.service.ts — demo bootstrap | Bootstrap | System bypass | Configured demo identity | System | users plus seeded finance tables | Seed allowlist / known demo id | Create deterministic demo dataset before request context | Bypass log + seed logs | Scoped transaction/rollback | Safe reviewed exception |
| backend/src/database/seed.service.ts — application seed | Bootstrap | System bypass | System / created users | System | currencies; users; seed tables | Seed allowlist | Initial data creation before any user session exists | Bypass log + bootstrap logs | Scoped transaction/rollback | Safe reviewed exception |
| backend/src/delegation/guards/account-delegate.guard.ts — canActivate | Request guard | Delegate context, not bypass | Owner | Delegate | account_delegates; grants | Relationship and grant predicates | Authorize acting request before controller | Guard denial; no bypass unless lookup bootstrap requires it | ALS/request cleanup; DB rollback | Safe guard; service workflow defect P2-007 |
| backend/src/emergency-access/emergency-access-claim.controller.ts — public claim flow | Public token request | System bypass | Claim owner resolved by token | Claim token principal | emergency_access_contacts/settings; owner export path | Opaque claim token + state predicates | Claim has no logged-in user id and must resolve target | Bypass log + claim logs | Scoped transaction/rollback | Safe reviewed exception |
| backend/src/emergency-access/emergency-access-monitor.service.ts:40-180 — monitor | Cron | System bypass/fan-out | Owners discovered globally | System | users; emergency_access_settings; emergency_access_contacts | Waiting-period/status predicates | Evaluate inactivity and issue grants globally | Bypass log + monitor logs | Scoped transaction/rollback | Safe context use; input corrupted by P2-008 |
| backend/src/import/mny/mny-import-job.service.ts — start/progress/reaper | Request + worker + cron | User; system only for stale-job sweep | Owner | Owner/system | import_jobs; staged file relationship | user_id in request; status/heartbeat in sweep | Background lifecycle and stale-job recovery | Bypass log for sweep + job logs | Short progress transactions; rollback | Safe tenant isolation; Phase 1 concurrency remains separate |
| backend/src/import/mny/mny-import.service.ts — execute import | Background user job | User context | Job owner | Job owner | owner finance tables; import_jobs | Owner ids and RLS policies | Import parsed data for one owner | Job logs/history | Long owner transaction; rollback | Safe tenant isolation in inspected path |
| backend/src/import/mny/mny-staging.service.ts — upload/TTL sweep | Request + cron | User; system for expiry sweep | Owner/system | Owner/system | import_staged_files | user_id on request; expires_at globally for sweep | Store and expire decrypted staged files | Bypass log for sweep + staging logs | Scoped transaction/rollback | Safe tenant isolation |
| backend/src/mcp/mcp-http.controller.ts:90-215 — handlePost/authenticate | Bearer request | System token validation -> user | Token owner | Token owner | PAT/OAuth stores; downstream owner data | Bearer token and session owner check | Establish MCP identity before tool execution | Auth errors; session maps; bypass log | ALS scope per request; DB transaction local | Confirmed defect P2-004: scopes not rebound |
| backend/src/mcp/tools/transactions.tool.ts:535-660 — manage_transactions | MCP tool | User context | Session user | Session user | transactions and related owner data | Tool inputs + RLS | Execute approved MCP mutation through domain services | MCP request/approval logs | Scoped transactions/rollback | Safe DB scope; affected by P2-004 cached scopes |
| backend/src/notifications/bill-reminder.service.ts — scheduled reminders | Cron | System fan-out -> user | Owner per item | Owner per item | scheduled_transactions; users/preferences | Per-user after fan-out | Discover reminders across users | Bypass log + reminder logs | User transaction per item | Safe reviewed exception |
| backend/src/oauth/oauth-interaction.controller.ts — authorize/consent | OAuth browser flow | System pre-session + user | Authenticated resource owner | Authenticated resource owner | oauth_payloads; users; client/grant state | Interaction uid, client and user checks | OAuth interaction begins before normal API context | OAuth logs + bypass log | Scoped transaction/adapter lifecycle | Safe reviewed exception |
| backend/src/oauth/oauth-provider.service.ts — token/grant validation | OAuth endpoints + MCP auth | System lookup -> user | Resource owner | Resource owner/client | oauth_payloads; users; grants/tokens | Client, grant, audience and scope checks | Validate opaque OAuth artifacts outside normal JWT request | OAuth logs + bypass log | Scoped transaction/adapter cleanup | Safe; reports scope is stale documentation only |
| backend/src/scheduled-transactions/scheduled-transactions.service.ts — due posting cron | Cron | System fan-out -> user | Owner per schedule | Owner per schedule | scheduled_transactions; transactions; accounts; splits/tags | Per-user after fan-out | Post due entries across tenants | Bypass log + posting history | User transaction per schedule | Safe reviewed exception |
| backend/src/securities/holdings.service.ts — portfolio maintenance fan-out | Cron/maintenance | System fan-out -> user | Owner per item | Owner per item | accounts; holdings; securities; investment transactions | Per-user after fan-out | Refresh/repair owner portfolios | Bypass log + service logs | User transaction per item | Safe reviewed exception |
| backend/src/securities/securities.controller.ts — maintenance endpoints | Admin/maintenance request | System context for global maintenance | System | Authenticated caller/admin where guarded | securities; security_prices; provider metadata | Endpoint-specific authorization | Run controlled price/security maintenance | Bypass log + controller/service logs | Scoped transaction/rollback | No material authorization defect established |
| backend/src/securities/security-price.service.ts — scheduled price update | Cron/maintenance | System fan-out/global update | System or owner batch | System | securities; security_prices | Provider/update predicates; global maintenance by design | Maintain price data across owners | Bypass log + update logs | Scoped transaction/rollback | Safe reviewed exception |


### 8.4 Authentication-surface matrix

| Surface | Accepted credential | Cookie use | Bearer use | CSRF | Scope / role | Effective and real user | Request/RLS context | Relevant tests/evidence | Assessment |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Ordinary browser API | JWT access cookie (and Passport bearer support where configured) | Yes | JWT bearer may be accepted by strategy; browser uses cookie | Required for unsafe methods by global double-submit guard | Route guards/decorators | Normal: current=real=user; acting: current=owner, real=delegate | RequestContextInterceptor -> withScopedDb -> table policy | JWT/CSRF/controller and RLS tests inspected | Generally sound |
| Login / local registration | Credentials or OIDC initiation | May set auth cookies | No existing bearer required | Public auth route; CSRF exemption appropriate because no ambient authenticated authority is required | Registration/config gates; throttling | Resolved user becomes both identities | Pre-identity system lookup, then user context | Auth service/controller tests sampled | No material defect established |
| Refresh | Refresh-token cookie | Yes | Not the normal browser path | Route-specific CSRF/refresh handling; token rotation is authoritative | Refresh token state, expiry, revocation | Token subject is always real user; acting owner stored separately | System token lookup -> reconstructed user/delegate context -> RLS | Token tests sampled | No material defect established |
| Logout | Access/refresh cookies | Yes | Not required for browser logout | Unsafe method follows CSRF model | Authenticated session | Real user token/session rows; acting context handled explicitly | User/delegate context; refresh-token policy includes both arms | Auth tests sampled | No material defect established |
| Destructive user actions | JWT plus password or OIDC confirmation field | Yes | JWT possible | CSRF required | Owner-only / no delegate; reauthentication expected | Targets real owner identity | Owner context -> scoped destructive transaction | Users/backup tests inspected | P2-005 for OIDC |
| Backup export | JWT | Yes | JWT possible | CSRF required for POST | Owner-only; DemoRestricted | Effective=real owner; acting delegates rejected by default guard | Owner RLS context; no bypass | Backup controller/service tests inspected | Tenant boundary sound |
| Restore | JWT + password/backup password/OIDC confirmation | Yes | JWT possible | CSRF required | Owner-only; destructive reauthentication intended | Effective=real owner | Owner + preserve-timestamps GUC in one destructive transaction | Backup restore tests inspected | P2-005; tenant predicates otherwise sound |
| Support backup | JWT + mandatory encryption DTO | Yes | JWT possible | CSRF required | Owner-only; DemoRestricted | Effective=real owner | Owner RLS context; de-identification allowlist | Support-backup service/DTO/docs inspected | No unencrypted request path established |
| PAT management API | JWT | Yes | JWT possible | CSRF required for create/revoke | Owner; accepted scopes read/write | Effective=real owner | Owner RLS context on personal_access_tokens | PAT service/controller tests inspected | Active scope contract consistent |
| OAuth authorization / interaction | Browser JWT plus OAuth interaction cookie/state | Yes | OAuth access token is not used to authorize consent | CSRF/state/interaction controls are route-specific | Registered client, redirect URI, requested monize scopes, consent | Authenticated resource owner | System pre-session lookup then user context; oauth_payloads exempt | OAuth provider/interaction tests inspected | No material defect established |
| OAuth token endpoint | Client credentials/grant/token exchange | No browser JWT required | OAuth client authentication / grant artifact | Not cookie-CSRF based | Client, grant, audience, token status; monize:read/write | Resource owner encoded in grant/token | System lookup; downstream MCP enters user context | OAuth provider tests inspected | No material defect established |
| MCP transport | PAT `pat_...` or opaque OAuth access token | Cookies ignored | Required | Explicitly bearer-only / CSRF skipped | PAT read/write or normalized OAuth monize:read/write; per-tool check | Token owner only; no delegation | System token lookup -> user context -> domain service -> RLS | MCP controller/tool tests inspected | P2-004 stale/elevated session scopes |
| Admin API | JWT | Yes | JWT possible | CSRF required for unsafe methods | RolesGuard/admin role | Authenticated admin remains real user; service may enter system context | Explicit system bypass for cross-user admin work | Admin controller/service sampled | No material defect established |
| Delegation owner management | JWT | Yes | JWT possible | CSRF required | Owner routes; StepUp where configured; delegates denied unless allowed | current=real=owner | Owner RLS context | Delegation controller/unit and RLS policy tests inspected | P2-007 under enforce |
| Delegated finance request | Acting JWT/refresh token | Yes | JWT possible | CSRF required for unsafe methods | AccountDelegateGuard plus grants and @AllowDelegate | current=owner; real=delegate | Delegate ALS -> effective/real GUCs -> direct/indirect policies | RLS delegation tests inspected | Finance visibility sound; P2-003/P2-008 at adjacent surfaces |
| Emergency access owner management | JWT + StepUpGuard | Yes | JWT possible | CSRF required | Owner only; delegates rejected | current=real=owner | Owner policies on settings/contacts | Emergency access tests inspected | No policy bypass defect established |
| Emergency access public claim | Opaque emailed claim token | No | Token in claim flow | Not cookie-authority based | Token hash, status and waiting-period state | Owner resolved from claim; claimant represented by token | Explicit system context with narrow claim workflow | Claim/monitor tests sampled | Context use sound; P2-008 can suppress eligibility |
| Demo mode | JWT as configured demo user | Yes | JWT possible | Normal CSRF | Demo guards restrict sensitive actions | Configured demo identity | User context; reset/seed may use explicit system context | Demo services sampled | No material RLS defect established |
| Health/public metadata | None | No | No | Not applicable | Public route allowlist | No user identity | No user-data access expected | Main/bootstrap routes sampled | No material defect established |


### 8.5 Phase 1 finding verification and disposition

| Phase 1 item | Phase 2 verification | Disposition |
| --- | --- | --- |
| P1-003 — stale transaction/repository guidance | Production search and inspected code did not establish an active manual `QueryRunner`. ESLint bans repository injection and `createQueryRunner`, restricts context-helper imports, but does not syntactically ban every `DataSource.transaction/query` variant. Scoped instructions conflict with auxiliary examples. | **Strengthened as documentation/test risk, not duplicated as an active authorization defect.** DR-01 and DOC-01 preserve the remaining concerns. |
| P1-004 — PAT `reports` scope comment | PAT DTO/entity/service accept `read`/`write`; MCP tools check those; OAuth uses `monize:read`/`monize:write` and normalizes them. No active endpoint/tool requiring `reports` was established. | **Documentation-only at this SHA.** DOC-02; no active privilege finding. |
| P1-001 — concurrent MNY start jobs | `import_staged_files` and `import_jobs` are direct effective-user tables with policies and enablement. Request work uses user context; expiry/reaper sweeps are explicit system operations and do not return unfiltered data to callers. A per-user partial uniqueness/locking fix would remain tenant-safe. | **No distinct Phase 2 authorization defect.** Concurrency remains for Phase 4. |
| P1-002 — deployment/bootstrap documentation mismatch | RLS defaults remain off, app credentials are optional outside enforce, and role provisioning is split between application startup and managed-Postgres deployment. Phase 2 independently found that enforce does not validate role attributes/ownership. | **P2-006 strengthens only the security-specific runtime-role aspect; general documentation mismatch is not duplicated.** |

### 8.6 Contradictions and supersession register

| Source A | Source B | Contradiction / resolution |
| --- | --- | --- |
| Root/scoped `CLAUDE.md` and RLS design | `CONTRIBUTING.md` / auxiliary skills / VAT plan | Scoped architecture requires `withScopedDb`; auxiliary examples still recommend APIs that can escape it. Scoped instruction wins; DOC-01. |
| `users_self` migration comment | Owner-facing delegation service | Migration says arbitrary user lookup needs system context; service performs it in owner context. P2-007. |
| Emergency-access UI copy | Request-context activity update | UI says owner sign-in controls waiting period; code records delegate traffic as owner activity. P2-008. |
| MCP bearer validation on every request | MCP session authorization cache | Current token is validated, but cached initial scopes remain authoritative for tools. P2-004. |
| “Global” currency liveness check | RLS direct policies | The check runs in a tenant scope and therefore cannot be global. P2-009. |
| Automatic-backup multi-user database fan-out | Shared filesystem naming/retention | DB export returns to user context, but the final filesystem namespace is global. P2-001. |
| RLS implementation-complete task list | Compose/Helm defaults and rollout runbook | Code/policies may be complete while production enforcement remains off. This is an operational-state distinction, not proof of outage. |
| Literal “all production queries through withScopedDb” | OAuth Postgres adapter | Adapter directly accesses intentionally exempt `oauth_payloads`. Classified DR-03, not a user-table bypass. |

### 8.7 Areas reviewed without a material finding

- Transaction-local GUC setup: `withScopedDb` sets identity or bypass before protected access, and the integration test demonstrates cleanup after commit on a one-connection pool.
- Fail-closed policy behavior: unset/empty identity returns zero rows; malformed UUID GUCs raise rather than silently widening access.
- Cross-user INSERT protection: the catalog-driven suite exercises `WITH CHECK` for every policied table, including indirect parents.
- Delegated finance visibility: owner finance rows are effective-user scoped; real-user security rows have explicit real-user arms; an unrelated delegate session cannot see owner finance data without acting context.
- MNY stage/job isolation: both new tables are direct user-owned and included in enablement/tests; global sweeps use explicit system context.
- Restore tenant predicates: the inspected destructive transaction targets the authenticated owner and uses timestamp preservation rather than system bypass. P2-005 is about reauthentication, not cross-tenant SQL.
- Support backup request path: the inspected DTO/controller/service path requires encryption and uses owner-scoped export/de-identification. No public unencrypted support-export path was established.
- PAT storage: raw tokens are returned once and stored as hashes; active scope vocabulary is read/write.
- OAuth scope contract: active scopes are `monize:read`/`monize:write`, normalized for MCP; no active `reports` scope exists.
- Cookie/CSRF separation: browser mutations use the intended CSRF model; MCP is bearer-only and does not inherit cookie authority.
- Cron fan-out pattern: most jobs end system enumeration before entering per-owner processing. No request-driven unfiltered all-tenant return was found in the reviewed jobs.
- Global currency and exchange-rate exemptions are intentional. P2-009 is a global-deletion decision made through tenant-filtered counts, not evidence that the exemption itself is wrong.


## 9. Unreviewed or inaccessible scope

- Repository cloning and local checkout were unavailable because DNS blocked cloning in the audit environment.
- A recursive SHA-pinned tree/directory listing was not available through the connector. The absence of `AGENTS.md` therefore could not be proven.
- No PostgreSQL instance, application container, Helm release, browser, OIDC provider, SMTP service, MCP client, backup volume, or object store was available for runtime verification.
- No migrations, test suites, lint, type-check, build, restore, backup, cron, or concurrency scenario was executed.
- Deployed database role attributes, object ownership, grants after operator changes, secret values, RLS mode, policy catalog, and production data were inaccessible.
- GitHub code-search results are not immutable and were capped; they were used only for path discovery. One broad `DATABASE_APP_PASSWORD` search response was truncated. Evidentiary files were re-fetched at the baseline SHA.
- Several very large files were inspected through targeted ranges rather than claimed as fully reviewed, including `database/schema.sql`, `backend/src/backup/backup.service.ts`, `backend/src/users/users.service.ts`, `backend/src/auth/auth.service.ts`, and large MCP/securities services.
- Connector CI queries returned no status/check entries and no pull-request-triggered workflow runs for the SHA. Other workflow/event types or external CI may exist but were not visible through the queried actions.
- The bypass ledger is complete against the lint allowlist, but stable source line offsets were not retained for every full-file fetch; exact method names are supplied and material findings have exact ranges.
- Phase 3 must independently verify backup relationship closure, de-identification rules, ID remapping, timestamp preservation, and fresh-versus-migrated database parity with executable database tests if an environment becomes available.

## 10. False positives investigated and rejected

1. **Migration 123 alone proves a production outage — rejected.** The file is an enablement step; actual rollout state and runtime role determine impact.
2. **Broad CORS on bearer/OAuth/MCP routes is automatically a cookie-origin or CSRF bypass — rejected.** The inspected MCP path requires bearer authorization and ignores cookie-only authority.
3. **No `FORCE ROW LEVEL SECURITY` is automatically a defect — rejected.** The documented owner/runtime-role model intentionally leaves owner/migration operations outside normal runtime enforcement.
4. **Global `currencies` and `exchange_rates` exemptions are automatically cross-tenant leaks — rejected.** They are shared reference tables. P2-009 is a separate deletion-control defect.
5. **The stale PAT `reports` comment grants a privilege — rejected.** Active issuance and enforcement accept read/write only.
6. **Active production manual `QueryRunner` use exists — rejected at this SHA.** No new evidence contradicted Phase 1.
7. **Public support backups can be requested unencrypted — rejected for the inspected DTO/controller path.** Encryption is required.
8. **Frontend redirects are authorization controls — rejected.** Backend guards and RLS remain authoritative.
9. **No CI status means CI failed — rejected.** The connector exposed no status; no outcome is inferred.
10. **Every-replica cron execution is automatically a security defect — rejected.** Job-specific duplicate/concurrency effects require separate evidence.
11. **System-context fan-out necessarily leaks all tenants — rejected.** Most inspected jobs exit bypass before per-user work or perform a controlled system-wide maintenance action without returning all-tenant data to a user request.
12. **OAuth's direct adapter proves a user-table RLS bypass — rejected.** The adapter targets the explicitly exempt `oauth_payloads` infrastructure table; DR-03 records the architectural exception.
13. **MNY job updates by job id are automatically cross-tenant — rejected.** The app-role policy still filters the target row by the active user GUC; global sweeps are explicit system workflows.
14. **Automatic-backup collision is merely the already-rejected every-replica cron concern — rejected.** P2-001 reproduces with one replica and two users because the path/filename namespace itself is shared.


## 11. Audit ledger

| Ledger field | Record |
| --- | --- |
| Audit phase | Phase 2 — Security, Authorization, and PostgreSQL RLS |
| Worker-chat name | Phase 2 Security/RLS worker chat |
| Audited SHA | `d5cea9bfa995885ba5198f9843359362927c0fd4` |
| Assigned scope | Identity propagation, authorization, delegation, emergency access, RLS policy/role/deployment, bypass contexts, JWT/cookie/CSRF/PAT/OAuth/MCP, backup/restore/import/cron/admin transitions, and relevant tests/docs |
| Directories inspected | Repository root; `.claude`; `docs`; `backend/src/common`; `auth`; `users`; `delegation`; `emergency-access`; `mcp`; `oauth`; `backup`; `import/mny`; `currencies`; `accounts`; `budgets`; `ai`; `admin`; `notifications`; `scheduled-transactions`; `securities`; `database`; `backend/test`; `frontend`; `helm` |
| Confirmed findings | 9 total — 0 BLOCKER, 1 HIGH, 8 MEDIUM, 0 LOW |
| Design risks | 4 |
| Documentation issues | 6 |
| Report filename | `monize-audit-02-security-rls.md` |
| Report completion status | Complete with stated static-analysis and connector limitations |
| Next required action | Phase 3 database/migration/backup audit at the same SHA; independently reproduce P2-001, P2-002, P2-005, P2-006, and P2-009 where runtime access exists |

### 11.1 Files inspected in full


- `CLAUDE.md`
- `backend/CLAUDE.md`
- `database/CLAUDE.md`
- `backend/src/mcp/CLAUDE.md`
- `frontend/CLAUDE.md`
- `.claude/settings.json`
- `.claude/skills/backend.md`
- `.claude/skills/frontend.md`
- `.claude/skills/infrastructure.md`
- `CONTRIBUTING.md`
- `SECURITY.md`
- `README.md`
- `docs/future-plans/row-level-security.md`
- `docs/future-plans/row-level-security-tasks.md`
- `docs/future-plans/row-level-security-runbook.md`
- `docs/database-migrations.md`
- `docs/support-backup.md`
- `docs/cron-jobs.md`
- `docs/future-plans/vat-support.md`
- `docker-compose.dev.yml`
- `docker-compose.prod.yml`
- `helm/values.yaml`
- `helm/README.md`
- `helm/templates/configmap-backend.yaml`
- `helm/templates/statefulset-backend.yaml`
- `backend/src/common/request-context.ts`
- `backend/src/common/interceptors/request-context.interceptor.ts`
- `backend/src/common/db/with-context.ts`
- `backend/src/common/db/scoped-db.ts`
- `backend/src/common/db/rls-config.ts`
- `backend/src/common/db/app-role.ts`
- `backend/src/db-init.ts`
- `backend/src/db-migrate.ts`
- `backend/eslint.config.mjs`
- `backend/src/auth/strategies/jwt.strategy.ts`
- `backend/src/auth/dto/create-pat.dto.ts`
- `backend/src/auth/entities/personal-access-token.entity.ts`
- `backend/src/auth/guards/pat-scope.guard.ts`
- `backend/src/auth/pat.service.ts`
- `backend/src/auth/pat.controller.ts`
- `backend/src/auth/token.service.ts`
- `backend/src/delegation/guards/account-delegate.guard.ts`
- `backend/src/delegation/delegation.controller.ts`
- `backend/src/delegation/delegation.service.ts`
- `backend/src/emergency-access/emergency-access-claim.controller.ts`
- `backend/src/emergency-access/emergency-access-monitor.service.ts`
- `backend/src/emergency-access/emergency-access.controller.ts`
- `backend/src/auth/step-up/step-up.guard.ts`
- `backend/src/mcp/mcp-context.ts`
- `backend/src/mcp/mcp-http.controller.ts`
- `backend/src/mcp/mcp-server.service.ts`
- `backend/src/oauth/oauth-provider.service.ts`
- `backend/src/oauth/oauth-interaction.controller.ts`
- `backend/src/oauth/postgres.adapter.ts`
- `backend/src/backup/backup.controller.ts`
- `backend/src/backup/auto-backup.service.ts`
- `backend/src/backup/support-backup/support-backup.service.ts`
- `backend/src/backup/support-backup/dto/create-support-backup.dto.ts`
- `backend/src/import/mny/mny-staging.service.ts`
- `backend/src/import/mny/mny-import-job.service.ts`
- `backend/src/import/mny/mny-import.service.ts`
- `backend/src/currencies/currencies.service.ts`
- `backend/src/currencies/currencies.controller.ts`
- `backend/src/currencies/exchange-rate.service.ts`
- `database/migrations/018_user_currency_preferences.sql`
- `database/migrations/111_rls_helpers_and_trigger.sql`
- `database/migrations/112_rls_policies_direct.sql`
- `database/migrations/113_rls_policies_indirect.sql`
- `database/migrations/114_rls_policies_special.sql`
- `database/migrations/117_mny_import_staging_and_jobs.sql`
- `database/migrations/118_security_documents_rls.sql`
- `database/migrations/123_rls_enable.sql`
- `backend/test/helpers/rls-setup.ts`
- `backend/test/helpers/rls-catalog.ts`
- `backend/test/integration/rls-helpers-and-trigger.integration.spec.ts`
- `backend/test/integration/rls-harness.integration.spec.ts`
- `backend/test/integration/rls-enable.integration.spec.ts`
- `backend/test/integration/rls-enforcement.integration.spec.ts`
- `backend/src/common/db/scoped-db.spec.ts`
- `backend/src/common/db/rls-config.spec.ts`
- `backend/src/common/db/app-role.spec.ts`
- `backend/src/auth/rls-context-smoke.spec.ts`
- `backend/src/auth/pat.service.spec.ts`
- `backend/src/oauth/oauth-provider.service.spec.ts`
- `backend/src/mcp/mcp-http.controller.spec.ts`
- `backend/src/users/users.controller.spec.ts`
- `backend/src/backup/auto-backup.service.spec.ts`
- `backend/src/delegation/delegation.controller.spec.ts`
- `backend/src/emergency-access/emergency-access.service.spec.ts`
- `backend/src/emergency-access/emergency-access-monitor.service.spec.ts`


### 11.2 Files sampled or inspected through targeted ranges


- `database/schema.sql`
- `backend/src/app.module.ts`
- `backend/src/main.ts`
- `backend/src/auth/auth.controller.ts`
- `backend/src/auth/auth.service.ts`
- `backend/src/users/users.service.ts`
- `backend/src/users/users.service.spec.ts`
- `backend/src/users/users.controller.ts`
- `backend/src/users/entities/user.entity.ts`
- `backend/src/backup/backup.service.ts`
- `backend/src/backup/backup.service.spec.ts`
- `backend/src/mcp/tools/transactions.tool.ts`
- `backend/src/accounts/accounts.service.ts`
- `backend/src/accounts/mortgage-reminder.service.ts`
- `backend/src/action-history/action-history.service.ts`
- `backend/src/admin/admin.service.ts`
- `backend/src/ai/ai-usage.service.ts`
- `backend/src/ai/insights/ai-insights.service.ts`
- `backend/src/budgets/budget-alert.service.ts`
- `backend/src/budgets/budget-period-cron.service.ts`
- `backend/src/database/demo-reset.service.ts`
- `backend/src/database/demo-seed.service.ts`
- `backend/src/database/seed.service.ts`
- `backend/src/notifications/bill-reminder.service.ts`
- `backend/src/scheduled-transactions/scheduled-transactions.service.ts`
- `backend/src/securities/holdings.service.ts`
- `backend/src/securities/securities.controller.ts`
- `backend/src/securities/security-price.service.ts`
- `frontend/src/proxy.ts`
- `frontend/src/lib/api.ts`
- `frontend/src/i18n/messages/en/settings.json`


### 11.3 Inaccessible files/resources and search limitations

- No clone/local repository tree.
- No recursive immutable tree listing; `AGENTS.md` absence is unconfirmed.
- No deployed secrets, database catalogs, role attributes, volumes, logs, or runtime services.
- GitHub search was capped and unpinned; broad outputs were sometimes truncated. All evidentiary content was re-fetched with `ref=d5cea9bfa995885ba5198f9843359362927c0fd4`.
- No CI log/artifact was available from the baseline status queries.

### 11.4 Commands, tests, checks, and CI results examined

- SHA-pinned GitHub file reads and targeted ranges only.
- Read-only GitHub combined-status query: no statuses returned.
- Read-only GitHub workflow-run query for the commit: no pull-request-triggered runs returned.
- RLS migration SQL, schema representation, app-role SQL, lint rules, unit tests, and integration-test source were examined.
- **Executed tests/checks:** none.
- **Executed migrations/containers/Helm/runtime scenarios:** none.

### 11.5 Open hypotheses

1. The production deployment may already provision a safe role through external CNPG/operator configuration, which would mitigate P2-006 operationally; the application still does not verify it.
2. Single-user appliance deployments may intentionally expose host folder selection, but no explicit capability boundary was found that makes P2-002 safe in multi-user mode.
3. Existing automatic-backup files may already be separated by operator-selected per-user folders; the default and documented production path remain shared and vulnerable.
4. External CI may exist outside the connector-visible commit status surface.

### 11.6 Dependencies on Phase 1 and later phases

- Phase 1 supplied the immutable baseline and architectural map.
- P1-003/P1-004 were independently checked and not duplicated as active privilege defects.
- P1-001 remains a Phase 4 concurrency issue; Phase 2 verified tenant isolation of import rows and workers.
- Phase 3 must deepen database parity, grants, backup/restore/support-backup, ID remapping, de-identification, timestamp preservation, and filesystem backup behavior.
- Phase 4 should consider DR-01 when reviewing nested transactions/concurrency.
- Phase 6 should verify the delegated `/users/me` frontend contract and emergency-access wording after backend fixes.
- Phase 7 should convert MT-01 through MT-16 into executable regression coverage and verify CI wiring.

### 11.7 Contradictions with Phase 1

No Phase 1 conclusion was disproved. P2-006 strengthens the RLS-specific deployment concern without claiming that migration 123 itself caused an outage. P2-001 is distinct from the rejected generic every-replica-cron concern because it reproduces on one replica. P2-009 does not challenge the intentional global currency exemption; it challenges a global deletion decision made from tenant-filtered evidence.


## 12. Handoff to Phase 3

### 12.1 Immutable baseline

Continue to audit exactly:

`d5cea9bfa995885ba5198f9843359362927c0fd4`

Do not resolve `main` again. If this SHA cannot be fetched reliably, stop rather than substitute another revision.

### 12.2 Schema and migration paths requiring deeper database verification

- `database/schema.sql`
- `database/migrations/018_user_currency_preferences.sql`
- `database/migrations/111_rls_helpers_and_trigger.sql`
- `database/migrations/112_rls_policies_direct.sql`
- `database/migrations/113_rls_policies_indirect.sql`
- `database/migrations/114_rls_policies_special.sql`
- `database/migrations/117_mny_import_staging_and_jobs.sql`
- `database/migrations/118_security_documents_rls.sql`
- `database/migrations/123_rls_enable.sql`
- Every later migration that changes table ownership, policies, grants, backup/import/security tables, or FK delete behavior.

Recreate both a fresh schema and a sequentially migrated schema, then compare tables, columns, defaults, constraints, FKs, indexes, policies, `relrowsecurity`, functions, triggers, grants, sequence privileges, and ownership.

### 12.3 Tables/policies requiring explicit Phase 3 attention

- `users`: verify `users_self` parity and demonstrate the safe, narrow mechanism needed by owner-managed delegation (P2-007) without widening arbitrary reads.
- `user_currency_preferences` and `currencies`: reproduce P2-009, including `ON DELETE CASCADE`, creator authorization, other-user preferences, and every non-cascading global reference.
- `auto_backup_settings`: confirm tenant DB isolation while separately reproducing the shared filesystem collision in P2-001.
- `import_staged_files` and `import_jobs`: confirm fresh/migrated enablement, app-role privileges, stage/job parent integrity, and sweeper behavior.
- `security_documents`: verify late-created-table parity in fresh and migrated databases.
- `oauth_payloads` and `schema_migrations`: verify whether the runtime role truly needs all current grants; attempt denied owner-only operations.
- All 15 indirect tables: test orphaned/reassigned/cross-owner parents, especially two-hop junctions and `account_delegate_grants`.

### 12.4 Application-role and privilege questions

Independently verify P2-006 against a real catalog:

- Who owns the database, tables, sequences, and RLS helper functions?
- What are `rolsuper`, `rolbypassrls`, `rolinherit`, `rolcreaterole`, and membership attributes for the configured runtime role?
- Does enforce mode ever connect as the owner after missing/invalid app credentials or managed-role provisioning failure?
- Are helper functions executable by the runtime role and hardened against search-path/ownership abuse?
- Can the runtime role write `schema_migrations`, alter objects, disable triggers/RLS, or call owner-only functions?
- Do default privileges apply to the actual migration owner in every deployment model?

### 12.5 Backup and restore authorization boundaries

Independently reproduce and quantify:

1. **P2-001:** two users, same default root/date/extension; daily, weekly, monthly, and retention collisions; concurrent writers; multi-replica behavior; atomicity on crash.
2. **P2-002:** path browsing from `/`, canonical/symlink escape, writable tmpfs/mounts, tenant sibling directories, and file-permission behavior in Compose and Helm.
3. **P2-005:** destructive OIDC restore step-up; distinguish backup decryption password from identity confirmation.
4. Owner-only export/restore across every relationship, including indirect rows and attachments.
5. Restore rollback after mid-stream FK/validation failure, and whether any external side effect escapes the transaction.

### 12.6 Support-backup concerns

- Re-enumerate the support-backup allowlist against all baseline tables.
- Verify every included field's masking/scaling rule, including JSON, attachments/documents, security metadata, free text, dates, provider identifiers, and audit history.
- Confirm encrypted output is mandatory in controller, DTO, service, preview, and any automatic/support command path.
- Test relationship closure after de-identification and ensure no excluded parent causes orphaned child data.
- Verify that support preview cannot expose raw values from another user or from fields excluded in the final artifact.

### 12.7 Timestamp preservation, ID remapping, and relationship closure

- Verify `app.preserve_timestamps` affects only intended updated-at triggers and is transaction-local after commit, rollback, and error.
- Compare every UUID primary key and foreign key against the restore remapping map; include delegation, emergency access, imports, attachments, security documents, scheduled transactions, tags, budgets, AI, and history tables.
- Confirm non-UUID identifiers and global currency codes are intentionally preserved.
- Test collision, duplicate, missing-parent, cross-user-id, and malicious backup inputs.
- Confirm restore never uses `DISABLE TRIGGER`, `session_replication_role`, owner credentials, or system bypass for ordinary user data.

### 12.8 Confirmed findings Phase 3 must independently verify

- **P2-001 HIGH:** shared automatic-backup filename/retention namespace.
- **P2-002 MEDIUM:** arbitrary authenticated filesystem browsing/path selection.
- **P2-005 MEDIUM:** OIDC sentinel on restore, as part of destructive backup authorization.
- **P2-006 MEDIUM:** enforce-mode runtime role attribute/ownership validation.
- **P2-009 MEDIUM:** RLS-hidden global currency liveness and cascade.

P2-003, P2-004, P2-007, and P2-008 are primarily backend/auth phases but may affect backup/security-table classification and should be preserved in the final cross-phase register.

### 12.9 Rejected false positives not to reopen without new evidence

- No `FORCE ROW LEVEL SECURITY` is not itself a defect in the documented owner/runtime model.
- The global currency and exchange-rate exemptions are intentional.
- Migration 123's existence does not prove outage.
- No active production manual `QueryRunner` was established.
- Support-export encryption was mandatory in the inspected request path.
- Missing baseline CI status is not evidence of failed CI.
- Every-replica cron execution is not automatically a security defect.

### 12.10 Required Phase 3 runtime scenarios

Use User A, User B, Delegate D, the unprivileged application role, and owner/migration credentials only where explicitly required. Run fresh-schema and migrated-schema variants. At minimum execute cross-user SELECT/INSERT/UPDATE/DELETE, ownership reassignment, orphan parent, GUC commit/rollback/error reuse, nested identity changes, role-attribute denial, backup collision/retention, full export/restore isolation, malicious remapping, support-backup de-identification, and MNY stage/job isolation.

### 12.11 Evidence limitations carried forward

- No local clone or runtime was available in Phase 2.
- No deployed role/secret/catalog/volume state was observed.
- Search results were capped/unpinned and only used for discovery.
- Large schema/service files were partly inspected through targeted ranges.
- No CI outcome was visible for the baseline SHA.

The next report must be named `monize-audit-03-database-backup.md` and remain pinned to the same baseline.
