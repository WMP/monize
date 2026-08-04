# Response to Monize audit phase 2 -- Security, Authorization, PostgreSQL RLS

| Field | Value |
| --- | --- |
| Responds to | `monize-audit-02-security-rls.md` (report date 2026-08-01) |
| Audited baseline | `d5cea9bfa995885ba5198f9843359362927c0fd4` |
| Work branch | `claude/detailed-error-review-wq2hjo` |
| Branch base | `4e48a767` (main after the audit baseline) |
| Commits | 23 |
| Diff | 138 files, +7678 / -2036 |
| Audit items answered | 9 confirmed findings, 4 design risks, 16 missing tests, 6 documentation issues |
| Additional defects found and fixed | 19, none of them in the report |
| Response date | 2026-08-03; revised 2026-08-04 after three verification rounds and a live-database run (sections 5A-5D) |

The brief for this branch was explicitly *not* "do what the file says". The report
was treated as a rough pass over the ground, and the work was asked to be a detailed
one. So this document has two halves: sections 1 to 4 answer the report item by item,
and section 5 is what a full re-read of the 117 files the report names turned up that
the report did not -- three passes over that file list, each finding defects the
previous pass had missed. Sections 5A and 5B answer two rounds of independent
verification of this branch: the first found four residual defects, the second found
one that the first round's own fix introduced. All five are fixed. Section 5C is what
running the integration suites -- previously reported as unrunnable here -- found
once a local PostgreSQL turned out to be available, and section 5D answers a third
review round, whose one HIGH finding is fixed.

## How to read the status column

| Status | Meaning |
| --- | --- |
| Fixed | The defect is closed in code, with a test that fails against the pre-fix code. |
| Fixed + hardened | Closed, and an adjacent defect the report did not name was closed with it. |
| Partly fixed | Closed at the unit level; the remaining assertion needs a live PostgreSQL and is listed in section 7. |
| Answered | No code change was correct; the reasoning is given. |
| Not accepted | Investigated and deliberately not changed, with the reason. |

Every "fails against the pre-fix code" claim in this document was established the
same way: the fix was temporarily reverted, the new test was run, and its failure
was observed. A test that passes both before and after a behaviour change is not
evidence, and this branch treats that as a finding rather than a formality.

## 1. Confirmed findings

### P2-001 -- Automatic backups share a tenant-agnostic file namespace (HIGH)

**Status: Fixed.** Commits `b2110add`, and `FV-004` in the verification round
(section 5A) -- the atomic write this fix introduced named its temporary file per
process rather than per write.

The report is correct and the impact is slightly wider than stated: the collision
was not only overwrite. Two users with unencrypted daily backups due on the same
date both resolved to
`<root>/monize-backup-daily-<date>.json.gz`, so `fs.writeFile` replaced the first
user's artifact and the second job reported success -- the first user kept seeing
"last backup: success" for a file containing somebody else's data. The retention
scan had no tenant discriminator either, so either user's retention pass
enumerated, counted and *deleted* the other's files, and the promotion to weekly
and monthly repeated the collision.

Fix: the storage root is operator configuration (`BACKUP_CONTAINER_DIR`) and every
artifact goes to `<root>/<user id>/`, a subdirectory derived by the server from the
authenticated user's id, validated as a UUID and asserted to be a strict descendant
of the root. Retention is scoped by construction, because it scans that directory
only. Writes became atomic (temp name plus rename), so a crash mid-write leaves the
previous good backup rather than a truncated file that looks successful. A stored
legacy folder is reported once per process, naming both locations, and its files are
left untouched -- relocating another deployment's data is not this code's decision.

Nineteen of the service's assertions fail against the old path resolution.

Files: `backend/src/backup/auto-backup.service.ts`,
`backend/src/backup/dto/update-auto-backup-settings.dto.ts`.

### P2-002 -- Any authenticated user can browse container directories and choose an absolute write path

**Status: Fixed.** Commit `b2110add`.

Confirmed as described. `POST /backup/validate-folder` and
`POST /backup/browse-folders` were reachable by every JWT-authenticated non-demo
user with no admin or host-operator guard. The validation rejected relative paths,
`..`, NUL bytes and non-normalized paths, but nothing confined the result to an
approved root -- and the existing test suite treated `browseFolders("/")` as a
supported case, which is how the surface survived review.

Fix: both endpoints are deleted, together with the client methods, the folder input,
the Browse dialog and the catalog strings that served them. The effective path is
displayed read-only so an operator can still find the files. `folderPath` remains in
the DTO, accepted and ignored, so a client on an older bundle still saves its other
settings instead of failing the whole PATCH under `forbidNonWhitelisted`.

A tenant no longer names a server-side path anywhere in this feature. Guard tests
assert that neither the service nor the controller exposes a folder-validation or
browsing surface at all, which is stronger than asserting that specific paths are
denied.

### P2-003 -- Delegated `GET /users/me` leaks security fields

**Status: Fixed + hardened.** Commit `29dcdcfd`.

Confirmed. `GET /users/me` is `@AllowDelegate()` and resolves `req.user.id`, which
is the *owner* while a delegate acts. It built its response by spreading the `User`
entity and deleting four fields by name -- and spreading strips the class metadata
`@Exclude()` needs, so the global `ClassSerializerInterceptor` could not save it. A
finance delegate received the owner's pending 2FA secret, backup codes, email
verification token, OIDC link token and pending OIDC subject.

**Beyond the report:** the short list was not the defect. Five call sites each wrote
their own removal list (`users.controller`, `users.service`, `admin.service`,
`auth.service`, `two-factor.service`) and the shortest one decided what leaked. Not
one of the five dropped `backupPasswordEnc`, so `GET /admin/users` returned **every**
user's encrypted backup password to any administrator. The report reached one of the
five sites.

Fix: one allowlist, `toUserProfile` (`backend/src/users/user-profile.ts`), plus a
delegated variant that withholds the owner's credential state. Three guards, in
decreasing reliance on an author remembering anything:

- the allowlist is `as const satisfies readonly (keyof User)[]`, so a renamed column
  is a compile error;
- `user-profile.spec.ts` reads `@Exclude()` off class-transformer's metadata store
  rather than a copied list, and asserts that no `LEAK-`prefixed fixture value
  appears anywhere in the serialized JSON -- which also catches a secret copied into
  a differently named field;
- a source scan fails for any new `{ passwordHash, ... } = user` sanitizer anywhere
  in `src/`, verified to match both of the removed forms.

### P2-004 -- An MCP session can borrow cached `write` scope from an earlier same-user token

**Status: Fixed.** Commit `589f3ef6`.

Confirmed. Every request validated its bearer token, but an existing session was
accepted whenever the presented token's `userId` matched the cached one, and the
scopes the tools authorized against were the ones captured at session creation.
"Same user" is not "same authorization": one user holds many tokens. A read-only PAT
presenting the session id of a write session was authorized for
`manage_transactions` and every other mutating tool, and revoking the creating token
left the session usable for its full one-hour TTL as long as the user still held any
valid token.

Fix: a session carries a credential fingerprint -- the PAT row's id, or the OAuth
*grant* behind the access token -- and a request must present the same one. The grant
rather than the individual access token, so a client refreshing its access token
keeps its session while staying bound to the authorization the resource owner
consented to. On every accepted request the session's scopes are replaced by the
presented token's current scopes, so a narrowing takes effect immediately and can
never widen back. A context with no fingerprint (a session from the previous build,
an OAuth token whose grant cannot be identified) is refused rather than falling back
to the user-only comparison.

Five of the eight new assertions fail against the previous comparison.

### P2-005 -- OIDC destructive actions accept any non-empty string as re-authentication

**Status: Fixed + hardened.** Commits `eb68eda1`, and `FV-001` in the verification
round (section 5A) -- the first version replaced the sentinel with a real signed
artifact but did not bind the pending marker to the round trip that requested the
challenge.

Confirmed, and worse than the report states in three ways.

The report names restore, data deletion and account deletion. The same sentinel check
also sat in the **`.mny` import's wipe-first mode** and in the **step-up service** --
whose OIDC branch accepted `oidcConfirmed: true`, a boolean the client asserted. So
the token whose entire purpose is to be a second proof was issued on the strength of
the session that already existed. And in all four places a **local account with no
password** (admin-provisioned, reset never completed) fell off the end of the
`else if` chain and was required to prove nothing at all. The existing specs pinned
the sentinel as expected behaviour, so the suite defended the hole.

Fix: `GET /auth/oidc/reauth?purpose=X` sends the user to the identity provider with
`prompt=login` and `max_age=0` -- without those the round trip is a redirect nobody
notices and proves nothing. The OIDC callback, which already verifies state, nonce,
issuer, audience and signature through `openid-client`, mints a five-minute artifact
signed with `JWT_SECRET` and bound to the user id, the action and a one-time id, and
returns it in the URL **fragment** so it never reaches a proxy or an access log. The
destructive handler consumes it: signature, type, subject, action, freshness, single
use. Which check failed goes to the log, not the response.

Details that carry security weight on their own:

- the pending-purpose cookie is signed, because the callback trusts it to decide
  which action the artifact unlocks;
- the callback mints only when the account the provider authenticated is the one that
  started the flow;
- `GET /auth/oidc/reauth` resolves the **real** user, so a delegate cannot prove the
  owner's identity;
- the import wipe carries its own purpose, so an artifact obtained for the Settings
  "delete my data" button cannot silently drive an import;
- the OIDC delete-data flow was also *unusable* before this -- its button redirected
  unconditionally and nothing resumed on return, so the user was redirected forever.
  Both paths now go through one handler.

**Known residual, deliberate and documented at the call site:** spent ids live in
memory, so single use is exact on one replica and best-effort across several within
the five-minute window. Spending an artifact requires the session it was minted for,
whose holder can simply run the flow again, so the guarantee doing the work is the
IdP challenge rather than the counter. Closing it properly needs shared state, which
is a schema decision and therefore out of scope for a fix branch.

New files: `backend/src/auth/oidc/oidc-reauth.service.ts` (+ spec, 21 cases).

### P2-006 -- `RLS_MODE=enforce` can start on a database owner, superuser or `BYPASSRLS` role

**Status: Fixed.** Commit `aedc012a`.

Confirmed. Enforce mode required `DATABASE_APP_PASSWORD` and selected the configured
username, then connected and started serving without ever asking what that role is.
PostgreSQL exempts three things from every policy: a superuser, a role holding
`BYPASSRLS`, and the table's owner (absent `FORCE ROW LEVEL SECURITY`, which this
schema deliberately does not use). An operator who pointed `DATABASE_APP_USER` at the
database owner got a clean boot, a log line saying `enforce`, and no database-level
tenant boundary at all.

Fix, in two parts because neither alone is sufficient:

- provisioning converges the whole attribute set rather than `LOGIN PASSWORD` only.
  `ALTER ROLE` is not additive, so naming `NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOBYPASSRLS` actually strips them from a role that already existed. This cannot be
  the whole answer -- the deployment may provision the role declaratively (CNPG
  `managed.roles`) where this SQL never runs, the `ALTER` can degrade to a warning on
  insufficient privilege, and an attribute granted after startup is invisible to it;
- at `enforce`, bootstrap interrogates the connection it will actually serve requests
  on -- `current_user`, `rolsuper`, `rolbypassrls`, database ownership, and how many
  RLS-enabled tables the role owns -- and exits before `app.listen()` on a wrong
  answer. Every violation is reported at once, so fixing one attribute does not
  reveal the next one on the next restart. Skipped at `off`/`shadow`, where
  connecting as the owner is the point.

New file: `backend/src/common/db/runtime-role-check.ts` (+ spec, 16 cases).

### P2-007 -- Owner-managed delegation cannot read or create the delegate's `users` row under enforcement

**Status: Fixed + hardened.** Commits `1584ea95`, and `FV-002` in the verification
round (section 5A) -- the creation path was elevated first and the listing and password
reset were left behind.

Confirmed, and the report understates the direction of the failure.

`users_self` reaches only `id = current_user OR id = real_user`, deliberately. Three
owner-facing workflows ignored that:

1. **Delegation creation was unusable.** The lookup by email found no existing user
   so a real account was treated as new; the counts deciding whether the owner may
   set that user's password ran on policied tables and returned zero; and the INSERT
   of a delegate-shaped `users` row was refused by `users_self`'s `WITH CHECK`.

   **Note which way those zero counts point.** `mayManageCredentials` starts `true`
   and the counts are the only thing that clears it, so with the counts blind it
   stayed `true` for a full account with its own password -- the exact case the guard
   exists to protect. Today the `WITH CHECK` stops the write anyway, so this is a
   latent account-takeover path rather than a live one. The counts are elevated
   together with the lookup because a check that cannot see the rows it is about is
   not a check.

2. **Revocation could go wrong in either direction (not in the report).** The cleanup
   guard read `delegateUser?.isDelegateOnly !== false`, and `undefined !== false` is
   `true` -- so a lookup that returned nothing voted **for** deleting the row, and
   under enforcement a returned-nothing lookup was the normal case. Had the DELETE
   been permitted it would have removed a self-registered user and cascaded their data
   away. A row we cannot find is not a row we may delete; a missing user is now
   "still needed".

3. **An administrator could never delete their own account (not in the report).** The
   last-admin guard counted administrators in the caller's own scope, where the answer
   is always 1.

All three use `withElevatedDb` inside the caller's transaction rather than a separate
system one: the identity row, the `account_delegates` row and the grants must commit
or roll back together. Each window is as narrow as the operation allows, and the
delegation and grant writes stay under the owner's own identity -- elevating those
would stop the database from checking the one thing it can check here.

### P2-008 -- Delegated requests update the owner's activity timestamp and can suppress emergency access

**Status: Fixed.** Commit `52320a2d`.

Confirmed. The request-context interceptor stamped `users.last_activity_at` with the
*effective* user, which is the owner while a delegate acts. Emergency access measures
exactly that timestamp, so an owner who configured a 30-day waiting period and
stopped signing in never became eligible as long as a delegate made any allowed
request every few days. One delegate could suppress the owner's safety mechanism
indefinitely.

Fix: the subject is `realUserId`, the authenticated identity. The delegate's own row
is stamped, the owner's is not, and the throttle is keyed per authenticated user so
two delegates of one owner cannot silence each other's record. Tracking "somebody
accessed this owner's data" is a different question needing its own column, and the
comment says so, because the emergency timer must never read it as an owner sign-in.

Both new assertions fail against the previous line.

### P2-009 -- RLS-hidden reference counts allow deleting another user's custom-currency preference

**Status: Fixed + hardened.** Commits `a8728097`, and `FV-003` in the verification
round (section 5A) -- authorization and global visibility were fixed first, the row
lock and two missing foreign keys after.

Confirmed, with a second defect in the same decision that the report does not name.

- **No authorization at all.** `currencies` is global reference data and
  `created_by_user_id` is attribution -- but attribution is the right authority for
  retiring a code, and there was no check. Any user who had merely *activated*
  somebody else's custom currency could trigger its deletion.
- **A global decision made from a tenant-filtered read**, as reported. The remaining-
  preferences count and the account/security/transaction probes ran in the caller's
  scoped transaction, reported zero while another tenant was still using the code, and
  the shared row was deleted -- taking the other tenant's preference with it through
  `ON DELETE CASCADE`.

Fix: deletion of the shared row is restricted to its creator (a system currency is
never removed by a request), and the reference count runs elevated so it counts every
tenant. `user_currency_preferences` is part of that union rather than a separate
count -- it is the table the FK cascades into, so another tenant's preference row is
precisely the reference that must block the delete.

The count and the DELETE stay in one transaction, which is what the new
`withElevatedDb` exists for. A second transaction would work but is wrong for a
different reason: a concurrent user could activate the code between the count and the
delete.

## 2. Design risks

### DR-01 -- Nested scoped calls do not verify the ambient identity against the active transaction

**Status: Fixed.** Commit `289cb77f`.

Accepted and implemented as recommended. The transaction now carries the identity its
GUCs were set from, and a join under a different one throws. The comparison is over
precisely the fields that become `set_config` calls, normalized so contexts producing
identical GUCs still join: an omitted `realUserId` equals a spelled-out one, a
differing timezone is irrelevant, and a stray `userId` beside `system` does not matter
because a system transaction emits only the bypass GUC. The error names both
identities.

Rejected in every `RLS_MODE` including `off`, where the GUCs are not emitted and the
mistake therefore has no database symptom at all -- the same reasoning that makes the
missing-context check unconditional. The deliberate escape (`runOutsideActiveScopedManager`)
is unchanged.

What makes this worth more than its risk rating: a nested `withSystemContext` reads at
the call site as an escape hatch and is not one. Two of the fixes on this branch need
exactly that access, which is how the shape was found -- and why `withElevatedDb`
exists rather than a comment telling the next author not to try.

Every backend unit suite (401 at that commit) passed unchanged afterwards, so no
existing path was relying on the old behaviour.

### DR-02 -- The runtime role receives blanket DML on every public table and sequence

**Status: Partly accepted, fixed where it is safe to fix.** Commit `aedc012a`.

The recommendation was an explicit runtime grant allowlist. That is **not accepted**:
a new user-owned table must be reachable the moment a migration creates it, and a
per-table allowlist would be forgotten in exactly the PRs that add tables and would
then break enforce mode only -- the mode with the least local testing. The blanket
`ALL TABLES IN SCHEMA public` grant stays.

The migration-infrastructure half **is** fixed: `INSERT`/`UPDATE`/`DELETE` on
`schema_migrations` is revoked after the grant. No request writes the migration
ledger, no policy protects it, and `db-migrate` connects as the owner. A forged row
there silently skips a migration; a deleted one replays a migration onto itself.
`SELECT` is kept so nothing that reads the ledger breaks. The revoke is guarded on the
table existing and asserted to run after the grant, not before.

### DR-03 -- The OAuth adapter exception is not represented in the instruction hierarchy

**Status: Fixed (documentation).** Commit `881a161f`.

Accepted. `backend/CLAUDE.md` now carries a section stating that
`src/oauth/postgres.adapter.ts` accessing `oauth_payloads` outside `withScopedDb` is
an exemption for **that adapter and that table only**, why the table qualifies (no
end-user owner column, rows keyed by opaque provider ids, all access pre-session), and
that a new infrastructure table needing the same treatment needs the same review --
an exemption entry in the policy migration, the catalog test's exemption list, and a
note there. Previously this lived only inside a migration comment, which is not where
anyone looks before adding the second one.

### DR-04 -- RLS remains operationally opt-in

**Status: Partly fixed.** Commit `881a161f`, plus the startup check from `aedc012a`.

The recommendation was a deployment assertion or metric plus alerting. The startup
role verification is the assertion half and it is now in place: at `enforce` the
process refuses to serve on a wrong role, so "mode says enforce" can no longer coexist
with "no boundary". `docs/future-plans/row-level-security-tasks.md` now separates five
states -- code complete, policies installed, tables enabled, runtime role active,
production verified -- with the query or log line that confirms each.

The metric and the alert are **not implemented**: they belong to the deployment's
observability stack rather than to this branch, and inventing a metric name without
the dashboard that consumes it would be documentation pretending to be a control.
This remains open and is listed in section 8.

## 3. Missing tests

| ID | Status | Where it now lives |
| --- | --- | --- |
| MT-01 | Done | `auto-backup.service.spec.ts`: "gives two users due on the same day distinct paths", "scopes each user's retention scan to their own directory", "creates the per-user directory on demand". |
| MT-02 | Done, differently | The endpoints no longer exist, so the assertion is stronger than "denies `/`": "exposes no folder validation or browsing method" (service) and "exposes no folder validation or browsing route" (controller). A symlink-escape case would test code that has been deleted. |
| MT-03 | Done | `user-profile.spec.ts` (9 cases) + `users.controller.spec.ts`. Reads `@Exclude()` off class-transformer metadata and scans `src/` for ad-hoc sanitizers. |
| MT-04 | Done | `mcp-http.controller.spec.ts`: read-only token reusing a write session, replacement token after revocation, scopes re-derived per request, unbindable context refused, OAuth refresh within one grant kept alive. |
| MT-05 | Done | `oidc-reauth.service.spec.ts` (21 cases: sentinel, `alg=none`, foreign key, wrong user, wrong action, expired, replayed, access token, step-up token, missing jti) + `backup.service.spec.ts`, `users.service.spec.ts`, `step-up.service.spec.ts`. |
| MT-06 | Done | `runtime-role-check.spec.ts` (16 cases) + `app-role.spec.ts`. Each disqualifying attribute separately and together, both driver result shapes, the bigint-as-string count, the no-row case, and `off`/`shadow` skipping the query. |
| MT-07 | Partly done | `delegation.service.spec.ts` asserts the bypass brackets at `RLS_MODE=enforce`, that every count lands inside the window, that the delegation writes fall outside it, and that a failed identity lookup no longer votes for deletion. The integration half needs a live database (section 7). |
| MT-08 | Done | `request-context.interceptor.spec.ts`: "stamps the delegate's own row, never the owner's, while acting", "still resets the owner's own clock on the owner's own request", "throttles per authenticated user, not per acted-on owner". |
| MT-09 | Done | `currencies.service.spec.ts`: creator and non-creator paths, system-currency path, another tenant's preference blocking the delete, and that the global probe carries no user predicate while the per-user probe still does. |
| MT-10 | Done | `rls-enforcement.integration.spec.ts` sweeps every covered table under a real unprivileged role; verified to run in section 5C. |
| MT-11 | Done | `rls-enforcement.integration.spec.ts`'s GUC-scope block, on a one-connection pool; verified to run in section 5C. |
| MT-12 | Done | `scoped-db.spec.ts` (31 cases): same-identity join, four rejected changes, both identities named in the error, identical-identity-spelled-differently joins, and the deliberate second transaction. |
| MT-13 | Done | `app-role.spec.ts` for the SQL, and `rls-elevation-and-role.integration.spec.ts` for the actual denial under the real role (section 5C). |
| MT-14 | Answered | Cookie-only access to `/mcp` cannot succeed: the transport reads the bearer itself and there is no `AuthGuard('jwt')` on the route, so no cookie authority exists to borrow. `mcp-http.controller.spec.ts` covers "reject requests without PAT" on each verb; the new fingerprint cases make the credential the only authority. |
| MT-15 | Not done | Two-user backup/restore isolation with relationship closure is an integration scenario. Section 7. |
| MT-16 | Not done | MNY raw-SQL isolation across stage/job/import under the app role is an integration scenario. Section 7. |

## 4. Documentation issues

All six are addressed in commit `881a161f`.

- **DOC-01 -- Fixed, partly before this branch.** Two of the three artifacts the report
  names were already dealt with on `main` after the audited SHA: commit `da8fa279`
  deleted `.claude/skills/backend.md` (together with the frontend and infrastructure
  siblings) for exactly the reason the report gives, and rewrote `CONTRIBUTING.md` to
  describe `withScopedDb` instead of the banned `QueryRunner` pattern. Both were
  correct by the time this branch started, so no change was needed here. The one that
  survived was `docs/future-plans/vat-support.md`, which still taught single-default
  enforcement "via QueryRunner"; this branch fixed it.
- **DOC-02 -- Fixed.** `database/schema.sql` advertised a PAT `reports` scope that no
  issuance or enforcement path accepts. The vocabulary is `read`/`write`.
- **DOC-03 -- Answered, no copy change.** The UI says emergency access triggers when
  the owner "does not sign in for an extended period". That was false at the audited
  SHA and is now true, because the activity timestamp records the authenticated user
  (P2-008). The contract was right and the implementation was wrong, so the correct
  edit was to the code. No product decision is needed.
- **DOC-04 -- Fixed.** `.env.example` and `README.md` described
  `BACKUP_CONTAINER_DIR` as a default users could change. It is an operator-controlled
  root with a server-chosen per-user subdirectory; the entry now says what that
  protects against and what happens to artifacts written under the old layout.
- **DOC-05 -- Fixed.** See DR-03.
- **DOC-06 -- Fixed.** The RLS task list's checked boxes read as "production is
  enforcing". Five separate states now, each with the query or log line that confirms
  it, and a note that the runtime-role state is checked at startup rather than
  assumed.

## 5. Defects found beyond the report

Three re-reads of the audit's own 117-path file list. Each pass targeted files the
previous passes had not opened; each found defects. This is the part of the work the
report did not cover, and it is the larger half.

### 5.1 Emergency-access configuration was not step-up gated

Commit `84f1199a`. The *message* inside the feature was gated -- the least sensitive
thing in it -- while **who receives emergency access and after how long** could be
changed with nothing but a session. An attacker holding a stolen session adds their
own address as a contact and sets the waiting period to its two-day minimum. Nothing
emails the owner when a contact is added. Rotating the password does not help:
`changePassword` revokes sessions, tokens and trusted devices but never touches
emergency contacts. Two days of owner inactivity later the claim flow hands over the
account with 2FA cleared and trusted devices deleted -- a durable backdoor that
survives the one remediation a user would think of.

Settings and all three contact routes now require the same factor the message always
did. `reset` stays ungated on purpose and says why: it only ever takes access away,
and an owner who has just realized a grant is in flight needs the fastest path to
killing it. `emergency-access.controller.spec.ts` asserts the gating **per route** off
the decorator metadata, so the next route added to this controller is compared against
an explicit list rather than against nobody's memory.

### 5.2 The claim flow's "single-claim wins" was not enforced

Commit `84f1199a`. The in-transaction re-validation's comment said it ran "under
lock". There was no lock. Under READ COMMITTED two contacts could each read a row that
still looked unused, each rewrite the owner's password, each void the other's link,
and each walk away with an authenticated session on the owner's account.

The invariant is per owner, not per link, so the fix locks all of that owner's contact
rows (`SELECT ... WHERE owner_user_id = $1 FOR UPDATE`) before deciding anything.
Locking only the row being claimed would let a sibling proceed beside it.

### 5.3 The email-existence oracle had only the global rate limit

Commit `84f1199a`. And the P2-007 fix **on this branch** is what made it reliable:
under enforcement the probe used to answer "no" for everyone, because `users_self`
reaches only the caller's own row. Restoring the answer without bounding it would have
shipped a working enumerator as a side effect of a correctness fix.

`POST /delegation/lookup` is now throttled at 30 per hour, which covers a user typing
a handful of delegate addresses through a debounced field and cuts the enumeration
ceiling by two orders of magnitude. This repo already takes enumeration seriously --
forgot-password always reports success -- so the inconsistency was the defect.

### 5.4 Two maintenance refreshes took their tenant scope from the call site

Commit `84f1199a`. The system context lived in the cron, so `refreshAllPrices` and
`refreshAllRates` read `securities` and the account-and-currency sweep in the
*requesting user's* scope when reached from their endpoints: identical to global at
`RLS_MODE=off`, silently narrowed to the caller at `enforce`. A maintenance endpoint
that stops doing maintenance the moment enforcement is switched on.

Both now seed their own system context, so the reach is a property of the operation
rather than of whoever called it. The negative control in
`securities/rls-context-smoke.spec.ts` was rewritten accordingly: once
`refreshAllPrices` seeds its own context it can no longer serve as the "fails without a
context" case, so that role moved to the genuinely per-user
`refreshPricesForSecurities`. Without that move the spec would have kept its name and
asserted nothing.

### 5.5 The FX refresh response enumerated every tenant's currency pairs

Commit `84f1199a`. `POST /currencies/exchange-rates/refresh` is callable by any
authenticated user and returned the per-pair results: the set of currencies everybody
else on the deployment transacts in, which on a small self-hosted instance is an
inference about named people's finances. It returns counts now, which is all the UI
ever read; the per-pair detail stays in the operator's log.

### 5.6 A dead `verify*` helper that verified nothing

Commit `6289e818`. `OidcService.verifyIdTokenClaims` decoded a JWT's payload and
compared issuer, audience, expiry and subject **without verifying the signature** --
its own comment said so. Nothing in the tree called it; the tests were the only
callers. A dead helper named `verify*` is worse than no helper: its nine tests make it
look load-bearing, and a future author reaching for OIDC verification would find a
function that accepts any attacker-authored payload with the right four claims.
Deleted, with a note that per-token claim verification would need JWKS verification
and that writing that is not the same as reviving this.

### 5.7 The OAuth consent screen adopted a grant without checking whose it was

Commit `141836af`. `confirm` loaded `interaction.grantId` and added the requested
scopes to whatever came back. The session check above it authorizes the
*interaction*; `grantId` is a separate field naming a row by opaque id, so a grant
belonging to another account or another client would have been widened on this user's
click. The grant is adopted only when `accountId` **and** `clientId` both match; a
mismatch starts a fresh grant and logs the one it ignored.

### 5.8 Backup restore spent its single-use credential before validating the file

Commit `141836af`. `verifyAuthentication` -- which consumes the one-time OIDC
artifact -- ran before the file was decrypted, decompressed and format-checked. A
mistyped backup password or a non-Monize file therefore cost a full identity-provider
round trip, and because that round trip also loses the file selection, the honest
failure and a spent artifact were indistinguishable on the retry.

This one was introduced by **this branch's own P2-005 change**, so it is a regression
fixed in place rather than a pre-existing defect. It is recorded here because the
ordering rule it produced applies to every step-up surface: cheap non-destructive
checks first, then the step-up, then the write.

### 5.9 Six defects folded into the findings above

Listed here so the count is honest; each is described in its section.

| Defect | Folded into |
| --- | --- |
| `admin.service` returned every user's `backupPasswordEnc` and pending 2FA secret | P2-003 |
| The step-up service accepted `oidcConfirmed: true`, a client-asserted boolean | P2-005 |
| The `.mny` import's wipe mode used the same sentinel check | P2-005 |
| A local account with no password had to prove nothing, in all four destructive paths | P2-005 |
| `revokeDelegate` read `undefined !== false` and voted to delete a row it could not find | P2-007 |
| The last-administrator count was answered from a tenant-scoped read | P2-007 |

### 5.10 Checked and cleared

Recorded so a later pass does not re-derive them: `PatController` is reachable only by
the owner (the global delegate guard is fail-closed); `reconcile/:accountId` does pass
the caller; `POST /securities/prices/refresh` is admin-gated; all four GEM tables ship
policies and their own `ENABLE`; every `:id` route parses as a UUID except a
provider-supplied news-item id that only indexes a server-built cache; no cron
`withSystemContext` body is reachable from a controller; MCP attachments, the
support-backup classification allowlist, the OAuth PostgreSQL adapter, the demo reset,
the MNY job service and the frontend 401/403 retry interceptor are sound.

Two of my own false alarms, rejected before reporting: `gem_strategy_scenarios` does
not exist (migration 127 only adds a column), and `schema.sql` enables RLS through a
`DO` block over `pg_policies` rather than a literal table list.

## 5A. Answer to the independent verification review

A second read-only review (`monize-phase-2-fix-verification.md`, reviewed head
`a39a837b`) checked this branch against the original report rather than against this
document, and found four things. **All four are real, all four are now fixed**, and
the review was right to call P2-005, P2-007 and P2-009 only partly closed at that
SHA. Its recommendation not to declare Phase 2 complete at `a39a837b` was correct.

One correction to its framing, and it makes the FV-002 case worse rather than better:
the review lists FV-002 as "owner-managed recovery works in mocked/off-mode paths but
fails under enforcement". That is the *listing* half. The reset half also could not
have worked if the read were fixed alone, because the `save` and the refresh-token
revocation are writes to the same invisible row -- so elevating only the lookup would
have moved the failure rather than removed it.

### FV-001 -- the re-authentication marker was not bound to its round trip

**Status: Fixed.** Confirmed exactly as described. `GET /auth/oidc` overwrote
`oidc_state` and `oidc_nonce` but left `oidc_reauth` in place, and the marker carried
no flow identity, so the callback minted the artifact whenever the marker's subject
matched the account that came back. The reachable path is the review's: start
`?purpose=delete-account`, do not follow the redirect, then complete an ordinary login
-- which sends no `prompt=login`, so a live SSO session answers it silently. The
artifact was cryptographically valid and certified an event that never happened.

The marker now carries `sth`, a SHA-256 of the `state` it was issued with, and
`readPendingMarker` takes the state the callback actually validated. A marker with no
`sth` is refused rather than accepted on the older checks -- same reasoning as the MCP
credential fingerprint, where an unbindable artifact is the case the binding exists to
close. `GET /auth/oidc` also clears any pending marker, so an ordinary login is a
login rather than one that silently discards a re-auth in flight.

Four assertions fail against the pre-fix code, including the review's own
reproduction as a controller-level test.

### FV-002 -- delegate listing and password reset were still unelevated

**Status: Fixed.** Confirmed. `isFullAccount`, `canOwnerResetDelegatePassword`, the
`relations: ["delegate"]` join in `listDelegates`, and every statement of
`resetDelegatePassword` read or wrote the delegate's rows in the owner's ordinary
scope.

Note which way each failed, because they are not the same defect:

- the listing failed **open in appearance**: the join yielded null, so the page
  rendered a delegate with no name, no email and `canResetPassword: false`, and
  nothing errored;
- `canOwnerResetDelegatePassword` failed **closed** (`!user` returns false), so the
  owner merely lost a working recovery path;
- the reset failed **loudly but wrongly**: a 404 for a row that exists.

All four are now inside `withElevatedDb`, keyed off ids that come from the owner's own
delegation rows -- the owner-scoped delegation read stays unelevated on purpose,
because the policy confirming those rows are this owner's *is* the authorization for
everything elevated afterwards. `resetDelegatePassword` is also now a single
transaction: the credential replacement and the revocation of the sessions it
invalidates were five separate transactions, so a failure between them left a delegate
with a new password and their old sessions still live.

**And a hazard the review did not name, which this fix would otherwise have walked
into:** `withElevatedDb` was not re-entrant. Its `finally` turned the bypass off
unconditionally, so `listDelegates` calling `canOwnerResetDelegatePassword` per row
would have returned the outer window to tenant-filtered reads after the first inner
call -- an elevated sequence that half works, silently. Only the outermost window
restores now, decided by reading the GUC rather than by a flag, because the outer
window may be opened by code the inner call cannot see. `elevated-db.spec.ts` covers
nesting, throw-inside-nesting, and both driver result shapes, and
`bypassAwareQueryMock` exists so a caller's spec models the connection state instead
of asserting a bracket shape that the real helper does not produce.

### FV-003 -- the currency delete was still racy, and its probe was incomplete

**Status: Fixed.** Confirmed, and the review's analysis of the lock interaction is
right: one `READ COMMITTED` transaction is not enough because a concurrent activation
takes only an FK `KEY SHARE` lock, which the reference check cannot see and the
`DELETE` waits for rather than being refused by. `SELECT code FROM currencies WHERE
code = $1 FOR UPDATE` now runs before anything is read or written, which conflicts
with that lock in both directions: an activation already in flight makes the delete
wait and then *see* its row, and one arriving later waits and is then correctly refused
by the foreign key.

The review was also right that the union was missing references. It named budgets and
exchange-rate pairs; both are real, both are `NO ACTION`, so another tenant's budget in
that currency turned a clean "still in use" into a raw constraint error. Rather than
add two lines, the test now derives the list of tables with a foreign key to
`currencies(code)` from `database/schema.sql` and asserts the probe mentions every one
-- so the next column that references it fails a test instead of production. The
per-user probe gained `budgets` for the same reason.

### FV-004 -- the atomic write's temporary filename was per process, not per write

**Status: Fixed.** Confirmed, including the cross-replica case the review adds:
`process.pid` is not unique across containers sharing a volume. `randomUUID()` added.
The final path is deliberately unchanged -- replacing our own same-day backup is
intended; it is only the intermediate name that has to be private.

### DR-V1 -- process-local replay state

**Unchanged, and still documented as a residual.** The review agrees with the
disposition. Shared transactional state is a schema decision, and remains listed in
section 8.

### DR-V2 -- role-membership escalation was not checked

**Status: Fixed** (direct grants first, then transitive reachability -- see DR-R1 in
section 5B), though the review classed it as unverified hardening rather than a
defect. It was worth closing on the check's own terms: the whole point of
`runtime-role-check.ts` is that an unprivileged mode is *verified* rather than
configured, and it verified the login role's own attributes while saying nothing about
what that role can `SET ROLE` into. `pg_auth_members` is now part of the same single
round trip, and membership in any role that is itself exempt -- superuser, `BYPASSRLS`,
the database owner, or the owner of a policied table -- is reported by name so the
operator can see which grant to revoke. Ordinary group memberships are not reported,
because a check that cries wolf gets ignored.

## 5B. Answer to the second verification re-review

A second re-review (`monize-phase2-fix-verification-re-review.md`, reviewed head
`3af6da53`) confirmed FV-001, FV-003 and FV-004 closed, and found that the FV-002
remediation introduced a new defect. **It is right, it was mine, and it is fixed.**

### RV-001 -- concurrent sibling elevation windows

**Status: Fixed.** Confirmed by independent reproduction before changing anything:
a serialized one-connection model of the shipped algorithm produces exactly the
trace the review reports (`READ:off, READ:off, ON, ON, A1:on, B1:on, OFF, B2:off,
OFF`). The second sibling's last query ran tenant-filtered while its own window was
still open.

The cause is worth stating precisely, because the first fix looked like the whole
answer and was half of it: **deciding ownership by reading the state you are about
to set cannot distinguish two overlapping outer windows.** Reading the GUC fixed
sequential nesting -- which is what FV-002 needed -- and said nothing about
concurrency, and `listDelegates` mapping every delegate to an eligibility check
created precisely the concurrent shape.

Fixed at both levels, deliberately:

- **The helper.** The window is reference-counted per connection (keyed on the
  `QueryRunner`, since the GUC is transaction-local), the claim is taken
  *synchronously* before any `await` so two entrants can never both observe zero,
  and it closes when the last participant leaves. A joiner awaits the opener's flip
  rather than assuming it landed, and a failed open rejects that promise so a
  sibling cannot proceed believing the window exists. The GUC probe is kept for the
  one thing only it can answer -- an outer window opened by code the counter cannot
  see -- and in that case the helper records that it did not set the GUC, so it
  never restores somebody else's.
- **The call site**, as the review recommends: `listDelegates` now opens one
  explicit window around the whole enrichment phase, entered after the owner-scoped
  delegation rows are authorized. Not because the helper still needs it, but because
  a call site should be correct without depending on that guarantee -- and one
  elevated read of one page is the honest shape of the operation.

The review's recommended regression test is implemented as specified: two delegates,
one returning early, the other shared with a second owner; every query for the
second delegate asserted to observe bypass `on`; `canResetPassword: false` for the
shared delegate; and exactly one `ON` and one `OFF` for the enrichment phase. Both
that test and the helper's sibling test fail against the previous algorithm
(verified by reverting it). Four more helper cases came out of thinking the fix
through rather than from the report: joiner-ordering, a failed open not stranding the
count, a failed open propagating to the sibling, and two connections not sharing a
window.

The review's judgement on severity is also right and worth keeping in the record:
this was **not** a cross-tenant password takeover, because `resetDelegatePassword`
re-checks eligibility inside its own sequential elevated transaction and would have
refused. What it was is an access-management API that could claim an authority the
enforcing endpoint denies -- or hide a legitimate recovery action under another
interleaving.

### DR-R1 -- membership hardening saw only direct grants

**Status: Fixed.** Accepted in full. `pg_auth_members.member = r.oid` answers about
the first hop, so `monize_app -> platform_runtime -> database_owner` passed whenever
the intermediate role was unremarkable, and the join ignored `set_option` entirely.
Replaced with `pg_has_role(r.oid, g.oid, 'SET')`, which is transitive and evaluates
each edge's SET option -- one predicate instead of a recursive query, and the direct
join is removed rather than supplemented so the query holds one answer rather than
two of differing strength. `g.oid <> r.oid` excludes the role itself, which is always
reachable from itself.

The review is right that the previous document overstated DR-V2 as fully closed. It
was closed for direct grants only; the claim now matches the check.

### On this re-review's own limits

Its section 8 is accurate, and one line in it deserves an explicit answer: the test
counts in section 7 are branch-author claims it could not reproduce, because DNS for
GitHub was unavailable in its environment and no PostgreSQL was. That is true, and it
cuts the same way as the Docker gap on this side -- neither party has executed the
integration scenarios that would settle RV-001 under a real unprivileged role. Both
its first and second recommendations are now met in unit form; the third (the same
scenario against real PostgreSQL) remains open and is listed in section 8.

### DR-V3, DR-V4 -- unchanged

DR-V3 restates DR-02's accepted tradeoff, and its condition ("any future
infrastructure table without RLS must be added to an explicit revoke list and guard
test") is the rule `app-role.ts` and its spec already encode via
`RUNTIME_READ_ONLY_TABLES`. DR-V4 is DR-04 and stays open for the same reason.

### On the review's evidence limits

Its section 8 is accurate: it executed nothing, and it observed no CI statuses or
workflow runs for the reviewed head. Both are properties of the environment rather
than of the branch -- this session has no Docker and no CI runner, so the numbers in
section 7 are local runs. The seven runtime scenarios it prioritizes are the same set
section 7 lists as unrunnable here, plus the two new ones its own findings created
(overlapping OIDC flows, and same-user concurrent backup writes); the first of those
is now covered at the unit level, and the second is asserted through the temp-path
uniqueness rather than through real filesystem interleaving.

## 5C. What running the integration suites found

The two previous sections both end with the same open item: the scenarios that need
a live PostgreSQL. A server turned out to be installed in this environment even
though Docker is not, so they were run. Four findings, two of them defects in code
this branch had already shipped.

### Two integration suites had been broken since `eb68eda1`

`backup-restore` and `support-backup` failed dependency injection on every run from
the moment `OidcReauthService` joined `BackupService`'s constructor: the 16 unit
specs were patched, the two integration ones were not, and they could not be run to
find out. Both now provide the **real** service, for the same reason the unit specs
do. Neither read-only review round could have seen this -- static reading confirms
that a provider list is a provider list.

### `readRuntimeRoleFacts` would have refused every enforce-mode boot

The worst of the four, and the shortest-lived: `array_agg(g.rolname)` produces
`name[]`, an OID node-postgres has no parser for, so the field arrived as the
literal string `"{}"`. `"{}".length > 0` is `true`, so the DR-V2 membership check
reported a violation that did not exist and exited before `app.listen()`. Any
deployment moving to `RLS_MODE=enforce` on the previous commit would have
crash-looped, and the message would have blamed a role grant that was not there.

Fixed by casting to `text[]`, a normalizer that accepts both shapes, and a unit
test using the string the driver actually sends. The original unit test could not
have failed: its mock returned the array the code wanted. That is precisely the
"a mock must return what the real collaborator returns" rule, in the one place
where the collaborator is the driver rather than one of our services.

### 56 of 113 foreign keys disagree with `schema.sql` on their delete rule

Pre-existing, systemic, and it explains something about P2-009. The integration
harness synchronizes its schema from entity metadata; production applies
`schema.sql`. Where an entity omits an `onDelete` that `schema.sql` declares, the
two databases behave differently -- and
`user_currency_preferences.currency_code` is exactly such a case: `CASCADE` in
production, `NO ACTION` here. So the silent cross-tenant deletion at the heart of
P2-009 was **not reproducible in an integration test at all**; the same DELETE
could only ever have raised a foreign-key error.

That one entity is corrected and the other 55 are baselined shrink-only in
`schema-entity-parity.integration.spec.ts`. Correcting them all is an entity-wide
change with its own review, and this is a security branch.

### The requested scenarios now exist and run

`rls-elevation-and-role.integration.spec.ts`, 11 cases against the real
unprivileged role:

| Scenario | What it establishes |
| --- | --- |
| RV-001, measured in rows | Two sibling windows: the survivor counts 2 with the fix and **1** without it -- the cross-tenant miscount the re-review predicted, observed. |
| FV-003, two connections | Locked: the activation waits and is then refused by the foreign key. Unlocked control: the other tenant's committed row is cascaded away, no error anywhere. |
| MT-13 | The runtime role reads `schema_migrations` and is denied INSERT/UPDATE/DELETE, with an ordinary application write as the negative control. |
| DR-R1 | A two-hop grant chain through an unremarkable intermediate role **is** reported; a `WITH SET FALSE` grant is **not**. The only real evidence that `pg_has_role(..., 'SET')` behaves as documented. |

Worth recording how the RV-001 test went: the first version **passed against the
pre-fix helper**. Its synchronization let the late read land before the early
sibling's restore, so it measured nothing. Awaiting the sibling's whole promise is
what makes it discriminate. A regression test for a concurrency defect is not
evidence until it has been seen to fail.

Also verified locally for the first time on this branch: all 122 migrations replay
clean on top of `schema.sql` (the drift job's property), and the whole integration
directory -- 21 suites, 240 tests.

### Noted, not fixed

`test/auth.e2e-spec.ts`, `test/payees.e2e-spec.ts` and
`test/transactions.e2e-spec.ts` do not compile (`import * as cookieParser` under
this tsconfig), and CI never notices because `test:integration` globs only
`test/integration`. Pre-existing, untouched by this branch, and a test-infrastructure
concern rather than a security one -- but three spec files that cannot run are not
coverage, so it belongs on somebody's list.

## 5D. Answer to the third verification review

A third read-only review (`monize-phase2-fix-verification-re-review-3.md`, head
`e0b64635`) confirmed RV-001 closed and raised one HIGH finding against the
membership check I had added the round before. **It is correct, it was mine, and it
is fixed.** Its recommended predicate split, its reproduction, its regression matrix
and its reading of the PostgreSQL source were all right.

### RR3-001 -- an inherited owner grant bypassed RLS and passed the check

**Status: Fixed.** Measured on a live PostgreSQL 16.13 before changing anything,
because the claim turns on how PostgreSQL resolves ownership rather than on how the
code reads:

| Grant | `SET` | `USAGE` | `row_security_active` | rows visible |
| --- | --- | --- | --- | ---: |
| `WITH INHERIT TRUE, SET FALSE` | false | **true** | **false** | **2** |
| `WITH INHERIT FALSE, SET TRUE` | true | false | true | 1 |
| `WITH INHERIT FALSE, SET FALSE` | false | false | true | 1 |

The first row is the finding, exactly as reported: `pg_has_role(..., 'SET')` is
`false`, so the check I shipped said "safe", while the connection saw both tenants'
rows and `row_security_active` was `false`. `object_ownercheck` ->
`has_privs_of_role` walks inheritable memberships, so an inherited owner **is** the
owner for the RLS decision -- and unlike the `SET` case there is no statement to
detect, because nothing has to happen.

Note also what the second row says, and what it corrects in my own earlier
reasoning: `SET TRUE` alone does **not** bypass anything until a `SET ROLE` is
actually executed. The original DR-V2 justification ("one SET ROLE reaches them")
was therefore right to refuse but wrong about the mechanism -- it is a reachability
risk, not an active exemption. The genuinely active exemption is the one the check
could not see.

The fix is the review's split, with the empirical basis now recorded beside it:

| Exemption class | Predicate | Why |
| --- | --- | --- |
| `rolsuper`, `rolbypassrls` | `SET` only | Attributes are not inherited. Verified: a member of a `BYPASSRLS` role with `INHERIT TRUE` still has `row_security_active = true`. Putting these in the `USAGE` arm would refuse to start on a harmless group membership. |
| database owner, owner of a policied table | `SET` **or** `USAGE` | Ownership is a privilege and it is inherited, so `USAGE` is an immediate bypass. |

`inheritedOwnerRoles` is a separate field from `exemptRoleMemberships` rather than
merged into it, because the remedies differ -- revoke, or re-grant
`WITH INHERIT FALSE` -- and the message says which. The inherited violation is
reported first, since it is the one that is already true.

`NOINHERIT` was added to the provisioned attributes as defence in depth, with the
review's caveat written at the declaration: it is not the fix, because a
per-membership `WITH INHERIT TRUE` overrides the role default, declarative
provisioning (CNPG `managed.roles`) never runs our SQL, and the `ALTER` degrades to
a warning without `CREATEROLE`.

**The test that asserted the unsafe disposition is deleted**, not amended. It was
the worst artifact of the whole round: a real-database test pinning the defect as
correct behaviour. In its place is the matrix the review specified -- three grant
combinations, each asserting the database's own `row_security_active`, the
cross-tenant row count, *and* the check's verdict, so the check is required to agree
with the boundary rather than with its author. Plus a two-hop inherited chain (both
defects at once), an ordinary-group negative control, and the `BYPASSRLS`
non-inheritance case that the split rests on.

Two of those fail against the `SET`-only check, and five unit cases with them
(verified by neutralizing the inherited arm).

### DOC-RR3-001 -- the open-items table contradicted section 5C

**Status: Fixed.** Fair, and worse than described: section 7 recorded the
integration run and section 8 still asked for a live PostgreSQL, MT-15/MT-16
appeared twice, and a request for the FV-003 two-connection test survived next to
the section describing that exact test. The table is rewritten below to hold only
what is actually open. A completion record that contradicts itself is worse than a
shorter one.

### On this review's limitations

Its section 8 is accurate again: it executed nothing, and GitHub returned no
statuses or workflow runs for the head. The numbers in section 7 remain local runs.
Its one substantive limitation note -- that the integration result for RV-001 is a
branch-author claim -- is the right way round: the test's *source* is verifiable by
reading, and its *result* is not.

## 6. Rules added, so the next agent inherits the correction

Twenty-one rules in the root `CLAUDE.md` (nine, five, two, then five -- one set per
pass),
each naming its machine-checkable guard where one exists, plus two operational sections
in `backend/CLAUDE.md`. The prose exists only
for the part that genuinely needs judgement; where the mistake is mechanical, the guard
is a scanning test.

| Rule | Guard |
| --- | --- |
| A response is built from an allowlist, never from an entity | `user-profile.spec.ts` source scan |
| A second factor the client can assert is not a second factor | `OIDC_REAUTH_PURPOSES` + `oidc-reauth.service.spec.ts` |
| A tenant never names a server-side path | `auto-backup.service.spec.ts` no-browsing assertions |
| A global decision cannot be made from a tenant-scoped read | `ELEVATED_DB_ALLOWLIST` lint gate |
| A failed lookup is not an answer about the thing you looked for | `delegation.service.spec.ts` |
| Cached authorization is not authorization | `mcp-http.controller.spec.ts` fingerprint cases |
| An unprivileged mode is verified, and reachability is two questions (`SET` and `USAGE`) | `runtime-role-check.spec.ts` + the integration membership matrix |
| Activity belongs to the person, not to the data | `request-context.interceptor.spec.ts` |
| Gate the routes that grant access, not the ones that describe it | `emergency-access.controller.spec.ts` decorator metadata |
| A comment claiming a lock is not a lock | `emergency-access-claim.controller.spec.ts` |
| A maintenance operation's reach belongs in its own signature | `security-price.service.spec.ts`, `exchange-rate.service.spec.ts`, `securities/rls-context-smoke.spec.ts` |
| A response from a global sweep must not enumerate other tenants | `currencies.controller.spec.ts` |
| Making a blind check work makes its oracle real | `delegation.controller.spec.ts` throttle metadata |
| An identity change inside an open transaction is refused, not honoured | `scoped-db.spec.ts` |
| An id in a protocol artifact is still checked against the caller | `oauth-interaction.controller.spec.ts` |
| Validate everything free before spending a single-use credential | `backup.service.spec.ts` |
| A driver's array is a string until something parses it | `runtime-role-check.spec.ts` + the integration role cases |
| An entity that omits `onDelete` is a claim that schema.sql does too | `schema-entity-parity.integration.spec.ts` |
| A proof of a round trip names the round trip | `oidc-reauth.service.spec.ts`, `auth.controller.spec.ts` |
| Fix the read and the write, or you have moved the failure | `delegation.service.spec.ts` |
| A helper that brackets state is re-entrant, and its ownership test is not a read of that state | `elevated-db.spec.ts` nesting + sibling cases |
| Two statements deciding one row's fate need the row locked | `currencies.service.spec.ts` |
| A temporary filename is unique per write, not per process | `auto-backup.service.spec.ts` |

`backend/eslint.config.mjs` gained `ELEVATED_DB_ALLOWLIST`, the same reviewed-decision
gate `with-context` already had: importing `withElevatedDb` outside the three named
files fails the lint job.

## 7. Verification performed, and what could not run here

Performed and green:

- `TZ=UTC npm run test:unit` (backend): 403 suites, 10842 tests, at branch tip.
- Frontend `vitest`: 627 files, 12279 tests, at branch tip.
- ESLint and `tsc --noEmit` on both sides. The backend was additionally type-checked
  with `src` and `test` in one program (via a scratch tsconfig, not committed) so a
  spec cannot drift from the code it tests -- clean.
- Backend and frontend production builds.
- `npm run migration:lint`, `npm run i18n:check` on both sides.

**Now also run** (see sections 5C and 5D): 21 integration suites / 245 tests against
a local PostgreSQL 16.13, and all 122 migrations replayed on top of `schema.sql`. That closes
MT-10, MT-11 and MT-13, and adds the RV-001, FV-003 and DR-R1 scenarios both review
rounds asked for. `scripts/verify-schema.sh` itself still needs Docker, but the
property it checks -- every migration a no-op replayed over `schema.sql` -- was
verified directly.

**Still not run:** the Playwright E2E suite (needs the full stack) and
`scripts/verify-schema.sh` as a script. MT-15 and MT-16 remain open as written: the
existing `backup-restore` and `mny-*` integration suites cover much of their ground,
but neither is the two-user isolation sweep the report specified.

The localization pass ran as a single commit (`1078c3cd`) once the copy was settled, as
`CLAUDE.md` prescribes: backend `errors.json` and frontend `settings.json` across all
18 full locales, the lean `en-*` variants touched only where they already carried the
key, ten now-unused keys removed everywhere, and both pseudo-locales regenerated.

## 8. Open items

Rewritten after DOC-RR3-001: the previous version of this table contradicted section
7, listed MT-15/MT-16 twice, and still asked for a test section 5C describes. Every
row below is open at the current head, and nothing closed appears.

| Item | Why it is open |
| --- | --- |
| DR-04's metric and alert | Belongs to the deployment's observability stack; a metric name without a dashboard is documentation pretending to be a control. The startup assertion half is done. |
| MT-15 and MT-16 as originally specified | The existing `backup-restore` and `mny-*` integration suites cover much of their ground, but neither is the two-user isolation sweep the report asked for. |
| Cross-replica single use of the OIDC re-authentication artifact | Needs shared state, which is a schema decision. Documented at the call site with the reason the residual risk is bounded. |
| An owner notification when an emergency-access contact is added | Would have made 5.1 visible to the victim. A product change (new email, copy, locale keys), not a security fix. |
| The remaining 55 entity/schema FK delete-rule drifts | Baselined shrink-only (section 5C). Correcting them is an entity-wide change with its own review. |
| Three `test/*.e2e-spec.ts` files that do not compile | Pre-existing, never run by CI, and test infrastructure rather than security (section 5C). |
| A filesystem-interleaving test for FV-004 | The uniqueness of the temporary path is asserted; observing the ENOENT race itself needs controlled filesystem timing. |
| Observable CI evidence on the merge candidate | Every number in section 7 is a local run. No workflow has executed against any SHA on this branch, which all three review rounds noted. |

Closed since the earlier versions of this table, recorded here so the change is not
mistaken for an omission: MT-10, MT-11 and MT-13 (section 5C), and the FV-003
two-connection scenario, which exists in
`rls-elevation-and-role.integration.spec.ts`.

## 9. Commit index

| Commit | Subject | Audit items |
| --- | --- | --- |
| `29dcdcfd` | One audited allowlist for every user-profile response | P2-003, MT-03 |
| `52320a2d` | Attribute interactive activity to the authenticated user | P2-008, MT-08, DOC-03 |
| `589f3ef6` | Bind an MCP session to the credential that opened it | P2-004, MT-04, MT-14 |
| `aedc012a` | Refuse to serve enforced traffic on a privileged DB role | P2-006, DR-02, MT-06, MT-13 |
| `289cb77f` | Refuse a nested identity change on a joined transaction | DR-01, MT-12 |
| `a8728097` | Authorize and globally verify shared-currency deletion | P2-009, MT-09 |
| `1584ea95` | Give owner-managed delegation the cross-user access it needs | P2-007, MT-07 |
| `b2110add` | Give each user their own backup directory | P2-001, P2-002, MT-01, MT-02 |
| `58632e27` | Drop the Input import the folder picker left behind | -- |
| `eb68eda1` | Require real re-authentication for destructive OIDC actions | P2-005, MT-05 |
| `881a161f` | Write down the rule behind each fixed defect | DOC-01..DOC-06, DR-03, DR-04 |
| `6289e818` | Delete the ID-token claim check nothing called | beyond report (5.6) |
| `1078c3cd` | Localize every string this branch added or reworded | -- |
| `84f1199a` | Close four defects the audit's own file list still hid | beyond report (5.1-5.5) |
| `7f321c57` | Write down the five rules from the second pass | -- |
| `141836af` | Verify grant ownership on consent, validate a restore before its step-up | beyond report (5.7, 5.8) |
| `d9ed31e9` | Answer the phase 2 audit item by item, and record what it missed | this document |
| `a39a837b` | Record the frontend suite measured at the branch tip | -- |
| `a0a8a4b0` | Close the four residual defects an independent verification found | FV-001..FV-004, DR-V2 |
| `eaccf1d6` | Reference-count the elevation window, and ask about SET ROLE reachability | RV-001, DR-R1 |
| `b326ea96` | Run the integration suites for the first time, and fix what they caught | MT-10, MT-11, MT-13 |
| `e0b64635` | Record the live-database run, and the two rules it produced | section 5C |
