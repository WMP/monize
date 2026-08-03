# RLS Implementation: Agent Task List

> Companion to [`row-level-security.md`](./row-level-security.md) (the design) and
> [`row-level-security-runbook.md`](./row-level-security-runbook.md) (operations). This file breaks the
> plan into tasks sized for one AI-agent session each. Do the tasks in dependency order; never start a
> task whose dependencies are unmerged. Mark a task done by checking its box and noting the PR.

## How to use this list (read first, every session)

- **One task per session/PR.** Each task lists its files. Touching files outside the task's scope is a
  scope violation — stop and leave a note instead.
- **Every task lands behind `RLS_MODE=off`** and must leave observable behavior at `off` unchanged
  (mechanism may change — see the "Deployment safety" classes below). If your change alters observable
  behavior at `off`, the task is wrong — stop.
- **Definition of done for every task** (in addition to per-task acceptance):
  - `cd backend && npm run build && npm run lint` clean.
  - `npm run test:unit` green; new code covered (95% global / 85% per-file thresholds).
  - Migrations mirrored into `database/schema.sql` in the same PR.
  - No new user-facing strings (RLS is backend-only; if an exception message becomes user-visible, it
    must go through `tr()` + English catalogs, then `npm run i18n:pseudo`).
- **Terminology:** "the design doc" = `row-level-security.md`. Section references (e.g. "Phase 2b")
  point there. Migration numbers below were written when the max was `102_*` and are now stale:
  M1/M2 actually shipped as `111`–`114`, and unrelated feature migrations have since carried the max
  to `122`. **Verify with `ls database/migrations` and renumber from the actual max before writing
  files** — do not trust any number in this document. Note that `116_*` and `117_*` each have two
  files: the directory is applied in **filename sort order**, not by numeric prefix, which is what
  keeps `117_security_documents` ahead of `118_security_documents_rls`.

## Deployment safety

**Every task except M3 is safe to merge and deploy to existing deployments as soon as it is done, in
any order that respects the dependency column.** Existing deployments stay on `RLS_MODE=off` (the
default; unset env = `off`) throughout; nothing in F/M1/M2/T/R/C/L/D changes their behavior. Behavior
changes only when an operator deliberately flips modes per the runbook. The "Deploy impact" column
uses four classes:

| Class | Meaning |
|-------|---------|
| **none** | CI, tests, lint, or docs only — or code that ships but nothing calls yet. The running app is byte-for-byte behaviorally identical. |
| **inert** | Ships real code or DB objects to prod, designed to change nothing at `RLS_MODE=off`: a role nothing connects as, policies without `ENABLE`, a GUC-aware trigger that behaves identically while the GUC is unset, context wrappers that only seed ALS. Safe, but verify the per-task acceptance that proves inertness. |
| **neutral** | Rewrites live code paths (the `withScopedDb` refactor, the restore swap). Designed behavior-preserving — same queries, same transaction boundaries — but carries normal regression risk. Full unit + module integration/e2e suites are the gate, not optional. |
| **DO NOT DEPLOY** | M3 only. Merging to a branch is fine; deploying it to prod is flip B, an operator decision after flip A has soaked. |

## Task graph

| ID | Task | Depends on | Deploy impact | Status |
|----|------|-----------|---------------|--------|
| F1 | RLS_MODE flag, role creation + grants in db-init, env plumbing (compose + helm/k8s) | — | inert | done |
| F2 | Request context extension (incl. `realUserId`) + `withScopedDb` (re-entrant, both identity GUCs) + `with-context` helpers + exception-filter mapping | F1 | none | done |
| F3 | CI ratchet on `@InjectRepository` / `createQueryRunner` counts | F2 | none | done |
| M1 | Migration: helper functions + GUC-aware trigger (**no grants — they live in db-init, F1**) | — | inert | done |
| M2 | Migrations: direct + indirect + special (users/delegation/emergency) policies (no enable) | M1 | inert | done |
| M3 | Migration: `ENABLE ROW LEVEL SECURITY` (authored, **not deployed**) | M2 | **DO NOT DEPLOY** | done (authored; ships only after flip A soaks) |
| T1 | Integration harness applies real RLS migrations + role/grants + `updated_at` triggers | M2, F1 | none | done |
| T2 | Catalog-driven `rls-enforcement` integration spec (4 buckets) | T1, M3 | none | done |
| C1 | Auth wrapping: `jwt.strategy` under `withUserContext(sub)`; PAT + password-reset + OAuth under `withSystemContext`; public-route audit | F2 | inert | done |
| C2 | Cron jobs: system fan-out + per-user bodies wrapped | F2 | inert | done |
| C3 | Seeders + demo reset under `withSystemContext` | F2 | inert | done |
| C4 | Emergency-access claim + expiry monitor under `withSystemContext`; grantee-side read audit | F2 | inert | done |
| C6 | Interceptor restructure: fire-and-forget writes moved inside the ALS scope | F2 | neutral | done |
| R1 | Refactor: accounts, categories, payees, tags, institutions | F3, C1–C4, C6 | neutral | done |
| R2 | Refactor: transactions, scheduled-transactions | F3, C1–C4, C6 | neutral | done |
| R3 | Refactor: securities, investment-reports, net-worth, monte-carlo, loan-* | F3, C1–C4, C6 | neutral | done |
| R4 | Refactor: budgets | F3, C1–C4, C6 | neutral | done |
| R5 | Refactor: built-in-reports, reports | F3, C1–C4, C6 | neutral | done |
| R6 | Refactor: ai, mcp, import, action-history, currencies, updates, notifications | F3, C1–C4, C6 | neutral | done |
| R7 | Refactor: auth, users, delegation, admin, emergency-access, backup, database | F3, C1–C4, C6 | neutral | done |
| C5 | Backup restore: `preserveTimestamps` flag replaces `DISABLE TRIGGER` DDL | F2, M1, R7 | neutral | done |
| L1 | Lint bans: `with-context.ts` import allowlist; `@InjectRepository`/`createQueryRunner` ban | R1–R7 | none | done |
| D1 | Docs: CLAUDE.md updates (incl. stale scheduler claim), `.env.example` + helm/k8s finalization, runbook promotion prep | all above | none | done — **every task in this list is complete**; what remains is operator-only (runbook flips) |

**Why context wrapping (C1–C4, C6) comes BEFORE the refactors (R1–R7), not after.** `withScopedDb` throws
on missing ambient context in every mode, including `off`. `jwt.strategy` runs in the guard phase —
before the interceptor's ALS scope exists — and `@Cron` handlers have no scope at all. If an R task
converted those code paths to `withScopedDb` while the wrapping was still a later task, every login (and
every cron firing) would throw at `RLS_MODE=off` from the moment the R task deployed until the C task
landed — a broken window the old ordering (C depends on R) guaranteed. The fix is directional:
wrapping call paths in `withUserContext`/`withSystemContext` *before* any refactor is **inert** (the
helpers only seed AsyncLocalStorage; repositories keep working), so all wrapping lands first and every
R task converts code whose context already exists. An R task must never convert a call path whose
wrapping has not landed — if one is found mid-task, stop and note it.

Notes on the subtle rows:
- **M1 is a prod DB change on next deploy** (migrations run at startup): it replaces
  `update_updated_at_column()`. Inert because the new function is exactly the old one while
  `app.preserve_timestamps` is unset — and M1's acceptance test proves that. M1 contains **no role or
  grant statements** — a migration referencing `monize_app` would crash-loop any deployment where the
  role does not exist (role and grants are db-init's job, F1).
- **C5 is neutral, not inert:** it swaps the restore mechanism itself. It must work at `RLS_MODE=off`,
  which is why `withScopedDb` emits `app.preserve_timestamps` in **every** mode (see F2) and why C5
  requires M1's trigger to already be in the deployed DB (guaranteed: M1 ships earlier and migrations
  run before the app serves traffic).
- **C6 is neutral, not inert:** it moves the interceptor's `touchLastActivity` / timezone-cache calls,
  which today run **before** `requestContextStorage.run()` is entered, into (or under a
  `withUserContext` wrapper matching) the request scope. Behavior-preserving by design, but it edits a
  hot code path on every authenticated request.

Operator-only steps (not agent tasks — see runbook): shadow flip, staging enforce, prod flip A
(privilege drop), prod flip B (deploy M3), monitoring during soaks.

### Open findings from M2's ownership audit — **all three closed in R6/R7**

M2 audited how every candidate table is actually keyed at its call sites (rather than trusting the
design doc's lists). That audit surfaced three call paths that **no policy can fix** — they will
return zero rows under enforcement because the ambient context does not name the right user. They are
context-wrapping bugs, out of M2's file scope, and are recorded here rather than papered over with a
policy arm. None of them affected anything at `RLS_MODE=off`. **All three are now fixed** -- see R7's status note;
findings 1 and 2 share the new `withDelegateContext` helper, and finding 3 wrapped every
`AdminService` method in `withSystemContext`. The original text is kept below for the audit trail.

1. **`delegation.service.ts` `delegateMustEnrollOwn2FA` reads the *owner's* `user_preferences` under
   `withUserContext(delegate)`.** Reached from `jwt.strategy`'s `validateActingContext`, i.e. on
   **every delegate-token request**. `withUserContext(sub)` seeds only `userId`, so both GUCs collapse
   to the delegate and the owner's preferences row matches neither arm. The fix belongs with the
   delegation wrapping work: seed **both** identities (current = owner, real = delegate) for delegate
   tokens instead of a single-id context. Blocks R7 as well as flip B.
2. **`AccountDelegateGuard` needs the same two-GUC seeding** — already flagged in C1 as out of its
   scope, repeated here because it has the same root cause and the same fix. It must land **before**
   R2/R7 convert `DelegationService` to `withScopedDb`, or delegate requests throw at `off`.
3. **`backend/src/admin/` contains no `withSystemContext` at all.** Admin cross-user writes to
   `refresh_tokens`, `personal_access_tokens` and `user_preferences` run under the admin's own user
   context and would silently affect zero rows under enforcement. The design doc (Phase 4) assumes
   admin is wrapped; no task currently owns it. R7 lists the admin module but R-task rules forbid
   adding new wrapping — this needs its own C-task (or an explicit extension of R7's scope).

A fourth, milder case is already covered by policy and needs no follow-up:
`users.service.ts` deleting refresh tokens by `actingAsUserId` works because M2 gave
`refresh_tokens` an `acting_as_user_id = current` arm.

---

## Foundation tasks

### F1. RLS_MODE flag, role creation, env plumbing

- [x] Status: done (branch `claude/rls-foundation-tasks-s8vgu4`)

**Scope:** `backend/src/db-init.ts`, `backend/src/app.module.ts`, `.env.example`, all
`docker-compose*.yml`, `helm/values.yaml`, `helm/templates/configmap-backend.yaml` (+ document the
CNPG `managed.roles` requirement and the kustomize-overlay ConfigMap/Secret keys).

**Do:**
1. `db-init.ts`: role **and grants** per design Phase 1, running on every startup **before the
   existing "tables already exist" early return** (`db-init.ts:44-56` — placed after it, the logic
   never runs on an initialized DB and rotation silently breaks):
   - When `DATABASE_APP_PASSWORD` is set: create/rotate `monize_app` — password via **parameterized**
     `set_config('monize.app_password', $1, false)`, then the `DO $$` block from the design doc
     (CREATE if absent, ALTER PASSWORD if present). Catch `insufficient_privilege` (42501) and
     continue with a warning naming CNPG `managed.roles` as the provisioning path. If unset, skip
     with a logged warning.
   - Whenever the role **exists** (however provisioned): idempotently apply the DML grants and
     `ALTER DEFAULT PRIVILEGES` (**no `FOR ROLE` clause** — the owner-role name is operator-chosen;
     see design Phase 1). **No migration may contain a role or grant statement.**
2. `app.module.ts` TypeORM factory: read `RLS_MODE` (`off`|`shadow`|`enforce`, default `off`); at
   `enforce` connect as `DATABASE_APP_USER`/`DATABASE_APP_PASSWORD`, else `DATABASE_USER`. Startup
   validation: `enforce` without `DATABASE_APP_PASSWORD` refuses to boot with a clear error. Invalid
   `RLS_MODE` value also refuses to boot. Expose the parsed mode via a small config provider (F2's
   `withScopedDb` reads it).
3. Env: add `RLS_MODE`, `DATABASE_APP_USER`, `DATABASE_APP_PASSWORD` to `.env.example` (documented,
   including the `log_statement` password-visibility caveat) and to every `docker-compose*.yml` with
   empty-safe defaults (`${DATABASE_APP_PASSWORD:-}`); add the same keys to the helm chart
   (ConfigMap for mode/user, existing DB Secret for the password).

**Accept:** unit tests for mode parsing/validation (all 3 valid values, invalid value, enforce-without-
password). `docker compose -f docker-compose.dev.yml up` boots unchanged with an untouched `.env`
(no `DATABASE_APP_PASSWORD`): fresh init succeeds and no role is created. With the var set: role
exists with grants after boot; changing the var and restarting rotates the password **on an
already-initialized DB** (proves placement before the early return); revoking a grant and restarting
restores it (proves idempotent re-apply). No pool-size configuration added.

### F2. Request context extension + `withScopedDb` + `with-context` helpers

- [x] Status: done (branch `claude/rls-foundation-tasks-s8vgu4`)

**Scope:** `backend/src/common/request-context.ts`, new `backend/src/common/db/scoped-db.ts`, new
`backend/src/common/db/with-context.ts`, their unit tests. **Do not refactor any service in this task.**

**Do:**
1. Extend `RequestContext` with `realUserId?: string; system?: boolean; preserveTimestamps?: boolean`.
   No `qr` field — the design has no pinned connection.
2. `withScopedDb(dataSource, fn)` exactly per design Phase 2b: throw
   `"DB access outside request/user/system context -- wrap the call path in withUserContext/withSystemContext"`
   when no ambient `userId`/`system`. **Re-entrancy first:** if the ALS scope already carries an active
   `EntityManager`, call `fn` with it directly — join the ambient transaction, never open a second one
   (a nested `dataSource.transaction` takes a second pooled connection and deadlocks the pool under
   load; see design Phase 2b). Otherwise open `dataSource.transaction`; when mode is not `off`, first
   emit `set_config('app.bypass_rls', 'on', true)` (system) or **both**
   `set_config('app.current_user_id', $1, true)` and
   `set_config('app.real_user_id', $1, true)` (user; real defaults to `ctx.realUserId ?? ctx.userId`);
   record the manager in the ALS scope; then run `fn(m)`. Additionally emit
   `set_config('app.preserve_timestamps', 'on', true)` whenever the context flag is set — **in every
   mode, including `off`, NOT gated on `RLS_MODE`**: it functionally replaces the restore path's
   `DISABLE TRIGGER` DDL (C5 breaks at `off` if this is mode-gated). All emissions transaction-local
   (`true` third arg) — never `false`.
3. `withUserContext(userId, fn)` / `withSystemContext(fn)`: seed the ALS scope (`{ userId }` /
   `{ system: true }`) and run `fn`. `withUserContext` validates `userId` is a UUID (a garbage value
   would make every policied statement raise 22P02). No connection handling, no cleanup.
   `withSystemContext` logs each invocation with its call site, rate-limited.
4. `RequestContextInterceptor` seeds `{ userId, realUserId, timezone }` for all authenticated routes
   (delegation already resolved by `jwt.strategy`; `realUserId` from `req.user.realUserId`). Do NOT
   move the fire-and-forget calls in this task — that is C6.
5. `GlobalExceptionFilter`: map Postgres `new row violates row-level security policy` (and the 22P02
   helper-cast error) to a generic 403/404 — these must never surface raw to users (design Phase 6
   i18n note).

**Accept:** unit tests assert — exact `set_config(..., true)` SQL per branch including both identity
GUCs and the `realUserId ?? userId` default; throw on missing context in every mode including `off`;
**nested `withScopedDb` reuses the ambient manager and opens no second transaction**; no **identity**-GUC
emission at `off`; `preserveTimestamps` emission in **every** mode including `off`; system-vs-user
branch selection; UUID validation in `withUserContext`; filter mapping. LSP diagnostics clean.

### F3. CI ratchet

- [x] Status: done (branch `claude/rls-foundation-tasks-s8vgu4`). Baselines measured
  at implementation time: **251** `@InjectRepository(` call sites, **61**
  `createQueryRunner(` call sites (script counts occurrences, not files). Script:
  `backend/scripts/rls-ratchet.mjs` (+ `--update`), self-test
  `rls-ratchet.test.mjs`, committed baseline `rls-ratchet-baseline.json`; wired
  into the `backend-lint` CI job (`npm run rls:ratchet:test` then
  `npm run rls:ratchet`). Exact-match ratchet: a count above baseline fails
  (banned new site), below baseline fails (lower the baseline in the same PR).

  **Superseded (see L1).** The counts reached zero, so the script, its self-test,
  its baseline and both npm scripts were removed and replaced by outright ESLint
  bans. Nothing named in the paragraph above still exists -- it is kept as the
  record of how the sites were driven down, not as a gate you can run.

**Scope:** a script under `backend/scripts/` (or repo `scripts/`), CI workflow wiring, a committed
baseline file.

**Do:** count `@InjectRepository(` and `createQueryRunner(` occurrences in `backend/src` (exclude
`scoped-db.ts`, tests, test helpers). Fail CI if either count exceeds the committed baseline; passing
runs update instructions tell the agent to lower the baseline in the same PR as a refactor. Baselines
start at current counts (measured 2026-07: 86 files with `@InjectRepository` / 61 `createQueryRunner`
call sites — script counts call sites, measure
at implementation time).

**Accept:** script runs in CI; artificially adding one `@InjectRepository` fails it; lowering baseline
below actual also fails (prevents over-claiming).

---

## Migration tasks

### M1. Helper functions + GUC-aware trigger (no grants)

- [x] Status: done (branch `claude/rls-migration-m1-m2-gyj3w6`). Shipped as
  `database/migrations/111_rls_helpers_and_trigger.sql` (actual max at authoring time was `110`,
  not the `102` the plan assumed), mirrored into `database/schema.sql`. Acceptance spec:
  `backend/test/integration/rls-helpers-and-trigger.integration.spec.ts` (11 tests), which executes
  the migration file **read from disk** so it cannot drift from what ships.

  **One deliberate deviation from the design doc's SQL.** `app_bypass_rls()` is
  `COALESCE(current_setting('app.bypass_rls', true) = 'on', false)`, not the doc's bare comparison.
  With the GUC unset the bare form returns **NULL**, not `false`. In the OR-ed policy predicates
  that is still fail-closed (`false OR NULL` is NULL, so the row is filtered out — verified), but a
  boolean helper that can return NULL is a trap for any future caller writing `NOT app_bypass_rls()`,
  which would also be NULL and silently match nothing. `app_current_user_id()` /
  `app_real_user_id()` keep returning NULL by design — that is what makes the policies deny.

  **Verified against a real PostgreSQL 16** (not just review): applies and re-applies cleanly on a
  fresh `schema.sql` install *and* on the pre-M1 schema; **no `monize_app` role existed in the
  cluster** for either run; helpers return NULL/false unset, read both GUCs independently, revert at
  COMMIT on the same physical connection, treat empty string as unset, and raise 22P02 (not zero
  rows) on a non-UUID value; the `updated_at` trigger stamps `CURRENT_TIMESTAMP` exactly as before
  while `app.preserve_timestamps` is unset, preserves the supplied value when it is `'on'`, and
  resumes stamping after that transaction commits.

**Scope:** new `database/migrations/103_rls_helpers_and_trigger.sql` (renumber from actual max),
`database/schema.sql`.

**Do:** per design Phase 3 — `app_current_user_id()`, `app_real_user_id()`, and `app_bypass_rls()`
helper functions; `CREATE OR REPLACE` of `update_updated_at_column()` with the
`app.preserve_timestamps` check. Idempotent. Behavior-inert (no policy, no enable).
**This migration must contain NO role or grant statements** — `GRANT ... TO monize_app` in a
migration crash-loops every deployment where the role does not exist (role + grants are db-init's
job, F1). Reject the task if any SQL here mentions `monize_app` or an owner-role name.

**Accept:** migration applies cleanly on a fresh dev DB **with and without `DATABASE_APP_PASSWORD`
set** and re-applies idempotently; `updated_at` trigger behavior unchanged when the GUC is unset
(add/extend a unit or integration test); schema.sql mirrored; `grep -i 'grant\|role' 103_*.sql`
returns nothing.

### M2. Policy migrations (direct, indirect, special) — no enable

- [x] Status: done (branch `claude/rls-migration-m1-m2-gyj3w6`). Shipped as
  `112_rls_policies_direct.sql`, `113_rls_policies_indirect.sql`, `114_rls_policies_special.sql`,
  all mirrored into `database/schema.sql`. **50 policies over 54 tables** (4 exempt), one policy per
  table, no `ENABLE`, no role or grant statement anywhere.

  **The design doc's table lists were re-derived from `schema.sql`, as the task instructed — and
  they had drifted.** Final buckets:

  | Bucket | Count | Change vs. design doc |
  |--------|-------|------------------------|
  | Direct, effective-user keyed (`user_id = current`) | 26 | — |
  | Direct, **authenticated**-user keyed (`current OR real`) | 4 | **new sub-bucket** (see below) |
  | Indirect (`EXISTS` to parent) | 15 | +1: `attachment_blobs` |
  | Special (bespoke owner columns) | 5 | — |
  | Exempt | 4 | — |

  - `transaction_attachments` (direct) and `attachment_blobs` (indirect → `transaction_attachments`)
    postdate the design doc (migration 109) and were missing from every list in it.
  - **Four tables the doc filed under a uniform `user_id = current` policy are keyed by the
    *authenticated* user, not the effective one**, so that policy would have returned zero rows for
    an acting delegate — inside normal request scope, where nothing throws and nothing logs. Each was
    confirmed at the call sites, not assumed: `refresh_tokens` (entity comment and
    `token.service.ts` are explicit that `user_id` is always the real user, with the owner in
    `acting_as_user_id`; `POST /auth/switch-context` is `@AllowDelegate` and both revokes and inserts
    delegate-keyed rows), `trusted_devices` (every authenticated route passes `req.user.realUserId`
    and those routes *are* `@AllowDelegate`), `user_preferences` (mostly effective-keyed, but the
    three `@AllowDelegate` 2FA endpoints read/write the delegate's own row), and
    `personal_access_tokens` (real-keyed in effect — `PatController` has no `@AllowDelegate`, so the
    two ids coincide today; the real arm makes adding one later a non-event instead of a silent
    zero-rows bug). These get `user_id = current OR user_id = real`. The arm cannot widen isolation:
    `app.real_user_id` only ever holds the id the JWT layer authenticated, so it exposes the caller's
    own rows and never a third party's.
  - `refresh_tokens` also gets an `acting_as_user_id = current` arm so that an owner deleting their
    account still purges the delegate sessions opened against their data (`users.service.ts` deletes
    by `actingAsUserId`; those rows carry another user's `user_id` and would otherwise be invisible,
    leaving live sessions pointing at deleted data).
  - **`currencies` exemption rationale corrected.** The doc justified it as having "no owner"; it
    does have `created_by_user_id`. It stays exempt for a better reason, now documented in the
    migration: that column is attribution (NULL = system currency), not ownership — any user may
    reference a custom code through `accounts.currency_code`, and a `created_by_user_id` policy would
    hide every system currency and break those foreign keys. Per-user visibility is already carried
    by `user_currency_preferences`, which *is* policied.
  - Junction tables are scoped through their **owning parent only**, not both FKs — matching the
    indirect-ownership map shape T2 expects. Rationale in `113`: the owning-side predicate is what
    enforces isolation, and the residual case (linking one's own row to another user's tag) exposes
    nothing readable, since the tag row is protected by the `tags` policy.

  **Verified under actual enforcement, not just by review.** The policies are inert as shipped, so
  correctness was proved in a scratch PostgreSQL 16 database by enabling RLS on all 50 policied
  tables, creating a non-owner `monize_app` role with the F1 grants, and seeding an owner, a
  delegate, and an unrelated third user: no GUC → zero rows on direct *and* indirect tables; per-user
  GUC → only that user's rows; `WITH CHECK` rejects a cross-user INSERT and a UPDATE that reassigns
  `user_id`, on both direct and indirect tables; a cross-user UPDATE affects 0 rows; a non-UUID GUC
  raises 22P02; `app.bypass_rls` sees everything; the app role cannot `ALTER TABLE ... DISABLE ROW
  LEVEL SECURITY` or `DROP POLICY` (`must be owner of table`). Delegation, all four cases: acting
  (current=owner, real=delegate) sees the owner's accounts/transactions, both `users` rows, the
  delegation from both sides, its grants, and its own favourites/devices/refresh tokens; the delegate
  can INSERT a favourite while acting; the **owner alone cannot see the delegate's private
  favourites or trusted devices**; the delegate in their own session sees none of the owner's data
  but still sees the delegation row. Removing the `real` arm from any of the three special policies
  breaks the corresponding case.

  **Zero schema drift:** a fresh `schema.sql` install and a pre-RLS schema + migrations 111–114 were
  diffed on `pg_policies` (qual + with_check text) and on `pg_get_functiondef` for all four
  functions — identical.

  **T2 note:** the four-bucket map in the catalog spec must include the new authenticated-user
  sub-bucket and `attachment_blobs`, or it will fail against these migrations.

**Scope:** new `database/migrations/104_rls_policies_direct.sql`, `105_rls_policies_indirect.sql`,
`106_rls_policies_special.sql`, `database/schema.sql`.

**Do:** per design Phase 3. Every policy in the `(SELECT app_current_user_id())` initplan form with the
`OR (SELECT app_bypass_rls())` escape. **Enumerate every table's owner column from
`database/schema.sql` — do not trust any list, including the design doc's** (an earlier draft listed
tables under `user_id` policies that have no such column; `CREATE POLICY` validates its expression, so
a wrong column name crash-loops the deploy):
- **Direct** (`user_id`): the 29 tables verified in the design doc.
- **Indirect** (`EXISTS` to parent): `holdings`, `transaction_splits`, `transaction_tags`,
  `transaction_split_tags` (two-hop), `security_tags`, `security_prices`,
  `scheduled_transaction_splits`, `scheduled_transaction_split_tags` (two-hop),
  `scheduled_transaction_overrides`, `monte_carlo_cash_flows`, `budget_categories`, `budget_periods`,
  `budget_period_categories` (two-hop), `account_delegate_grants`.
- **Special** (bespoke owner columns, both GUCs — design Phase 3): `users`
  (`id = current OR id = real`), `account_delegates` (`owner_user_id = current OR
  delegate_user_id = real`), `delegate_account_favourites` (`delegate_user_id = real`),
  `emergency_access_settings` / `emergency_access_contacts` (`owner_user_id = current`).
`DROP POLICY IF EXISTS` before each `CREATE`. `currencies`, `exchange_rates`, `oauth_payloads`,
`schema_migrations` deliberately excluded — say so, with rationale, in a comment.
**No `ENABLE ROW LEVEL SECURITY` and no role/grant statements anywhere in these files.**

**Accept:** migrations apply + re-apply cleanly **on a DB without the `monize_app` role**;
`SELECT count(*) FROM pg_policies` matches the enumerated table count; every policied table's owner
column verified against schema.sql in the PR description; app behavior unchanged (policies inert
without enable); schema.sql mirrored.

### M3. Enable migration — authored, not deployed

- [x] Status: **authored, NOT deployed** (branch `claude/rls-task-list-next-72ikal`). Shipped as
  `database/migrations/123_rls_enable.sql` (the max was `122`; the `115` and `107` earlier revisions
  of this note assumed were both stale), mirrored into `database/schema.sql`. Acceptance spec
  `backend/test/integration/rls-enable.integration.spec.ts` (16 tests). **This file is flip B — it
  must not reach production until flip A has soaked. Tag the PR `do-not-deploy-before-flip-A`.**

  **53 tables enabled, derived from `pg_policies` rather than a hard-coded list.** A `DO` loop over
  `SELECT DISTINCT tablename FROM pg_policies WHERE schemaname = 'public'` closes both failure modes
  a static list has: it cannot go stale between authoring and flip B (three tables already postdate
  M2 — `import_staged_files`, `import_jobs`, `security_documents`), and it cannot enable a table
  that has no policy, which would be a deny-all outage rather than a safe default. Both are asserted
  as tests, in both directions.

  **Why mirroring it into `schema.sql` does not make flip B happen on fresh installs.** Enabling RLS
  does not affect the table **owner**, and at `RLS_MODE=off` — the default, and where every
  deployment starts — the app connects as the owner. So a fresh install gets the enable and observes
  nothing. `FORCE ROW LEVEL SECURITY` is deliberately not used anywhere: it would apply policies to
  the owner too, break db-init/db-migrate/backup-restore, and turn this file into a live behaviour
  change at `off`. A test asserts `relforcerowsecurity` is false everywhere. The "do not deploy"
  constraint is therefore about *release sequencing on existing deployments*, not about the SQL
  being unsafe on its own.

  **Verified against a real PostgreSQL 16, not by review.** The "Schema vs Migrations Drift" job was
  reproduced locally (Docker is unavailable in the agent container, so the same steps were run
  against a local PG16 cluster): `schema.sql` applied to one database, `schema.sql` + all 112
  migrations replayed **twice** to another, `pg_dump` normalized and diffed — identical, 53 tables
  with RLS enabled on both sides. `npm run migration:lint` clean. Behaviour under enforcement,
  proved with a real non-owner role: owner sees both users' rows (this is `RLS_MODE=off` and it is
  unchanged); `monize_app` with no GUC sees **zero**; with `app.current_user_id` sees only that
  user's rows, on a direct table *and* through an indirect `EXISTS`-to-parent policy; with
  `app.bypass_rls` sees everything; a cross-user INSERT is rejected by `WITH CHECK`; and
  `monize_app` cannot `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` (`must be owner of table`).

  **The D1 convention now has a test, not just a rule.** T1's harness applies the enable **in its
  filename position** rather than last (`applyRlsPolicies(ds, { includeEnable: true })`), which
  reproduces a deployed database where `123` is already recorded in `schema_migrations`. A later
  migration that adds a policy without its own `ENABLE` therefore leaves that table unenforced and
  fails the "enables RLS on every policied table" assertion. A negative-control test policies a
  table after the fact and confirms the guard reports it.

  **One bug found in T1's helper while wiring this up**, caught by the full suite and not by the
  spec in isolation: the enable-marker regex matched the phrase `ENABLE ROW LEVEL SECURITY` where
  the *policy* migrations discuss it **in comments**, so `112`–`118` were classified as enable
  migrations and their policies silently went unapplied. Marker detection now strips SQL comments
  first. The lesson generalizes — content markers over SQL must ignore comments, because these files
  document the thing they are being matched for.

**Scope:** `database/migrations/123_rls_enable.sql`, `database/schema.sql`.

**Do:** `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` for every policied table, derived dynamically as
above. **This file is flip B.** It ships to prod only in its own release after flip A soaks (runbook).
Land it on a branch CI can validate but tag the PR clearly: `do-not-deploy-before-flip-A`.

**Accept:** applies cleanly in a scratch DB; `pg_class.relrowsecurity` true for every policied table
and false for the four exempt ones; a table policied but not enabled fails the check; integration
suite (T2) passes against it.

---

## Test tasks

### T1. Integration harness applies real migrations

- [x] Status: done (branch `claude/rls-task-list-next-72ikal`). New helper
  `backend/test/helpers/rls-setup.ts` exporting `applyRlsPolicies(dataSource)`, called from
  `createIntegrationModule` after compile. Acceptance spec
  `backend/test/integration/rls-harness.integration.spec.ts` (12 tests). Full integration run against
  a real PostgreSQL 16: **16 suites / 172 tests green** (was 15/160 before the task), build + lint +
  ratchet clean.

  **The migration selector is content-based, and that is the whole point of the task.** It selects
  files whose SQL references `app_current_user_id` / `app_bypass_rls`, which today is
  `111`–`114`, `117_mny_import_staging_and_jobs.sql` and `118_security_documents_rls.sql`. The
  `*_rls_*` glob the task text originally specified silently drops `117`, so `import_staged_files`
  and `import_jobs` would have looked unpolicied to T2 — a green, meaningless suite. Every policy
  predicate calls one of the helpers, so the marker cannot miss a policy file no matter what it is
  named, and it picks up future feature migrations that policy their own new table (the correct
  pattern) with nothing to register by hand.

  **Every assertion has a verified negative control** — each was run against a deliberately broken
  harness, not just reviewed:
  - Narrowing the selector back to the `*_rls_*` glob fails 3 tests, including the guard test
    "selects every migration file that declares a policy", which calls the **real** selector and
    compares it against every file containing a `CREATE POLICY`. That guard fails for any future
    policy file the selector would miss, wherever it appears — the `ui-conventions.test.ts` pattern.
  - Skipping trigger creation fails all 3 trigger tests. The `app.preserve_timestamps` test
    initially passed without triggers (with nothing to overwrite the supplied timestamp, preserving
    it is trivially true), so it now asserts the trigger is attached before exercising the GUC.

  **Boundary decisions:**
  - `applyRlsPolicies` applies policies but **not** `ENABLE ROW LEVEL SECURITY`. Policies ship inert
    (M2) and the enable is M3/flip B, so the other 15 suites see exactly what they saw before — a
    policy on a table without enable is never consulted by the planner. A test asserts zero tables
    have `relrowsecurity`, so an accidental enable here would surface as a failure rather than as a
    baffling regression elsewhere. T2 opts into enforcement itself.
  - Role and grants come from `provisionAppRole` in `src/common/db/app-role.ts` (F1 exported the SQL
    for exactly this), not from duplicated grant SQL. Note the task text says the grants live in
    `db-init.ts`; F1 actually put them in `app-role.ts`, which db-init calls.
  - The `updated_at` trigger DDL is extracted from `schema.sql` with a whitespace-tolerant pattern
    (the file has both one-line and multi-line forms) and applied only for tables `synchronize`
    actually built, so schema.sql being ahead of the entities is not a failure. 24 triggers today.
  - A post-condition compares the policies the applied files *declare* (both shapes: explicit
    `CREATE POLICY`, and `112`'s `text[]` looped through `EXECUTE format`) against `pg_policies`
    after apply, so a file that applies without error but takes a branch skipping its policies fails
    loudly instead of silently under-applying.
  - **The four suites that build their own `DataSource`** (`mny-import`, `mny-import-job`,
    `mny-staging`, `support-backup`) are **not** wired to the harness — they opt in by calling
    `applyRlsPolicies` themselves, as the T1 acceptance spec does. None of them tests RLS, and
    attaching triggers under `support-backup`'s golden comparison is a change T1 has no reason to
    make. T2 will call it explicitly.

**Scope:** `backend/test/helpers/integration-setup.ts` (+ a new helper file if cleaner).

**Do:** after `synchronize`, run `applyRlsPolicies(dataSource)`:
1. Create `monize_app` in the test DB **before** anything references it, and apply the F1 grants
   (reuse/share db-init's grant SQL — the migrations no longer contain grants).
2. Execute the actual RLS migration files read from disk (never duplicated SQL). **A `*_rls_*` glob
   is wrong and will silently under-apply.** It matches `111`–`114` and `118_security_documents_rls`
   but misses the `CREATE POLICY` statements for `import_staged_files` and `import_jobs`, which live
   inside `117_mny_import_staging_and_jobs.sql` — a feature migration that creates the tables and
   policies them in the same file (the right pattern; see M3). Two tables would then look unpolicied
   to T2. Apply the whole migrations directory in **filename sort order**, or enumerate the policy
   sources explicitly and assert the enumerated set still covers every table T2 buckets.
3. Create the `update_updated_at_column()` **triggers** for the tables the trigger tests touch,
   extracting their `CREATE TRIGGER` DDL from `database/schema.sql` — `synchronize` builds from
   entities and creates **no** DB triggers (`@UpdateDateColumn` stamps app-side), and the RLS
   migrations only replace the trigger *function*. Without this step, T2's trigger assertions and
   C5's restore acceptance pass vacuously.
Keep existing suites green — notably `security-cross-user-isolation.integration.spec.ts`.

**Accept:** all existing integration suites pass; harness fails loudly if a migration file is missing
or unreadable (no silent skip); a raw `UPDATE` on a trigger-covered table in the test DB stamps
`updated_at` (proves the triggers actually exist in the harness).

### T2. Catalog-driven `rls-enforcement` spec

- [x] Status: done (branch `claude/rls-tasks-next-steps-2ra6rr`). Shipped as
  `backend/test/integration/rls-enforcement.integration.spec.ts` (18 tests) plus
  `backend/test/helpers/rls-catalog.ts`, a catalog loader + **generic row seeder** driven by the live
  database (`information_schema` + `pg_catalog`): one row per (table, owner) is generated from column
  metadata, with ownership expressed through foreign keys (any `users(id)` reference gets the owner,
  any other NOT NULL FK gets the owner's already-seeded parent via topological order, `currencies`
  resolves to USD). A future table is therefore seeded, bucketed and asserted on with **no
  registration step**; a column type the generator does not understand throws naming the column.

  - **Buckets are exactly as specced** — `user_id` column (detected from the schema, so
    `import_staged_files`/`import_jobs`/`security_documents` needed no map entry), the owner-column
    map, the indirect map (15 tables), and the 4-entry exemption list. A table in none or several
    buckets fails, as does a covered table missing its policy or its `ENABLE`.
  - **Per-table sweeps as the runtime role** (via `asAppRole` + both identity GUCs, matching what
    `withUserContext` emits): exact per-user visibility compared **by primary key against the seeded
    rows** (not counts), zero rows on unset *and* empty-string GUCs, 22P02 on a garbage GUC asserted
    as an error, `WITH CHECK` rejection of a freshly generated cross-user row, bypass parity with the
    owner's row count.
  - **Delegation semantics** (current=owner, real=delegate): owner's accounts visible while acting;
    both `users` rows; the delegation row from all three perspectives; grants through the parent's
    real arm in the delegate's own session; favourites readable/insertable via the real arm only;
    owner-alone blindness to the delegate's favourites; delegate-own-session blindness to owner data.
  - **GUC scope**: a real `withUserContext` + `withScopedDb` (`RLS_MODE=enforce`) on a
    single-connection pool connected as `monize_app`; after commit both identity GUCs read empty on
    the same connection and a raw `SELECT` returns zero rows.
  - **Two seeder facts worth knowing:** several ownership/parent columns have **no FK constraint** in
    the synchronize-built schema (`auto_backup_settings.user_id`, `security_documents.user_id`,
    `user_currency_preferences.user_id`, `delegate_account_favourites.{delegate_user_id,account_id}`,
    `attachment_blobs.attachment_id`, `account_delegate_grants.account_id`) — the seeder resolves
    them by naming convention plus a small explicit map, and a future FK-less column fails loudly
    (random uuid → policy hides the row → visibility sweep names the table). And TypeORM's raw
    `query()` returns `[records, affectedCount]` for UPDATE, unlike INSERT.
  - **Negative controls verified in scratch runs:** dropping one policy fails 7 tests; an unbucketed
    fake table fails 6, named; stripping the real arms from the three special policies fails 4
    delegation tests.

  Full integration run against a real PostgreSQL 16: 18 suites / 206 tests green.

**Scope:** new `backend/test/integration/rls-enforcement.integration.spec.ts`.

**Do:** per design Phase 5. Enumerate every table from the DB; each must be in exactly one of **four**
buckets — `user_id` column / explicit **owner-column map** (`users → id`,
`account_delegates → owner_user_id + delegate_user_id`, `delegate_account_favourites →
delegate_user_id`, `emergency_access_settings|contacts → owner_user_id`) / explicit
indirect-ownership map / explicit exemption list (`currencies`, `exchange_rates`, `oauth_payloads`,
`schema_migrations`) — anything else **fails**. Missing `pg_policies` entry for a bucketed table
fails. Then, per covered table, inside a transaction with `SET LOCAL ROLE monize_app`: userA/userB
visibility; unset/empty GUC → **zero rows**; **non-UUID garbage GUC → the statement raises
`invalid input syntax for type uuid` (22P02), asserted as an error, not as empty results**;
`WITH CHECK` cross-user insert rejection; `app.bypass_rls` cross-user read;
`app.preserve_timestamps` trigger behavior; **delegation semantics** — with `current` = owner and
`real` = delegate: the delegate's `users` row is visible, `delegate_account_favourites` rows are
visible and insertable, `account_delegates` visible from both sides; and the **GUC scope test** —
after a committed `withScopedDb`, `current_setting('app.current_user_id', true)` on the same connection
is empty and a raw `SELECT` returns zero rows.

**Accept:** suite green against M1–M3; deliberately dropping one policy in a scratch run makes it fail;
adding a fake unbucketed table makes it fail; the delegation assertions fail if the `real` GUC arm is
removed from any of the three special policies.

---

## Service refactor tasks (R1–R7)

Shared instructions for every R task — the per-task list only names the modules:

- Replace injected-repository data access with `withScopedDb(this.dataSource, (m) => ...)`; replace manual
  `createQueryRunner()`/`startTransaction()`/`release()` blocks with
  `withScopedDb(this.dataSource, async (m) => { ... })`. Helpers that took a `QueryRunner` take an
  `EntityManager`. Scope each `withScopedDb` to the unit the code transacts **today** — one read or one
  read-modify-write block; never a whole request handler. Cross-service calls need no special
  handling: a nested `withScopedDb` joins the ambient transaction (F2's re-entrancy).
- **Context precondition:** C1–C4 and C6 have already wrapped every out-of-request entry point
  (guards/strategies, crons, seeders, interceptor writes) — an R task only converts data access whose
  ambient context exists. If you find a call path reaching the module's services with no wrapping
  (`withScopedDb` would throw at `off`), **stop and note it** — do not add `withSystemContext` yourself
  and do not convert that path.
- Keep the existing per-module unit tests green by mocking `withScopedDb`/`DataSource.transaction` instead
  of repositories; update test helpers once, reuse across the batch.
- Lower the F3 ratchet baselines in the same PR.
- Out of scope: any *new* `withSystemContext`/`withUserContext` wrapping, any module not listed.
- Accept (every R task): build/lint/unit green; module's integration + e2e specs green; **a dev smoke
  of the module's cron/bootstrap paths at `RLS_MODE=off` shows no context throws**; ratchet lowered;
  zero `@InjectRepository`/`createQueryRunner` left in the listed modules.

### R1. accounts, categories, payees, tags, institutions
- [x] Status: done (branch `claude/row-level-security-r1-d6onbm`). All 13 service files converted
  (accounts ×8, categories, payees ×2 + `insert-payee-alias.util`, tags, institutions); ratchet
  lowered **251 → 214** `@InjectRepository` / **61 → 47** `createQueryRunner` (−51 sites, zero left
  in the five modules). Raw SQL (balance updates, daily balances, statement figures, forecast,
  favourite reorder, the due-balance cron's bulk UPDATE) stayed raw and moved inside `withScopedDb`
  (`m.query`). Full `npm run test:unit` green (9153), build + lint clean.

  **Boundary decisions (for R2/R6 and L1):**
  - Helpers still called from unrefactored modules **keep their optional `queryRunner` parameter**
    with today's semantics; only the no-runner fallback became `withScopedDb`:
    `TagsService.setTransactionTags/setSplitTags/+Bulk` (callers: transactions, R2) and
    `AccountsService.updateBalance/recalculateCurrentBalance` (callers: transactions/securities/
    import). After R2 converts those callers, the parameters can be dropped -- a nested `withScopedDb`
    joins the ambient transaction. `insertPayeeAliasIgnoringDuplicate` and the auto-merge private
    helpers now take an `EntityManager` (all callers in-module);
    `PayeesService.findPayeeByAlias` dropped its never-passed `queryRunner` param.
  - **`getUsersByEffectiveTimezone` (`common/users-by-timezone.util.ts`) still queries the
    DataSource directly** -- it is shared by other modules' crons (budgets, scheduled-transactions,
    notifications), so converting it belongs with a later R task; the accounts cron's own reads and
    the bulk UPDATE do run through `withScopedDb` (one transaction per timezone bucket).
  - Module files keep their `TypeOrmModule.forFeature` registrations (inert unused providers);
    dropping them can ride along with L1.

  **Tests:** shared harness `backend/src/test-helpers/scoped-db-testing.ts` (+ its own spec):
  specs `jest.mock` the scoped-db module so `withScopedDb(ds, fn)` delegates to the mock
  `dataSource.transaction`, and `manager.getRepository(Entity)` routes to the same per-entity
  repository mocks the specs already assert against (the directory is excluded from the F3 ratchet
  by its existing `test-helpers/` rule). The cron/bootstrap smoke is encoded as
  `src/accounts/rls-context-smoke.spec.ts`, which runs the two accounts crons under the **real**
  `withScopedDb` + C2 wrappers at `RLS_MODE=off` (plus a negative control proving an unwrapped call
  still throws), so the no-context-throw acceptance is CI-checked rather than a one-off dev run.

### R2. transactions, scheduled-transactions
- [x] Status: done (branch `claude/row-level-security-r1-d6onbm`). All 9 service files converted
  (transactions ×6: `transactions`, `transaction-split`, `transaction-transfer`,
  `transaction-bulk-update`, `transaction-reconciliation`, `transaction-analytics`;
  scheduled-transactions ×3: `scheduled-transactions`, `scheduled-transaction-loan`,
  `scheduled-transaction-override`). Ratchet lowered **214 → 187** `@InjectRepository` /
  **47 → 31** `createQueryRunner` (−43 sites, zero left in the two modules). Full
  `npm run test:unit` green (9154), build + lint + `i18n:check` clean.

  **Transaction boundaries preserved exactly.** Each former `createQueryRunner()` block became one
  `withScopedDb`; each former autocommit read became its own short `withScopedDb`. So `removeTransfer` /
  `updateTransfer` legitimately open **two** transactions (the split-parent lookup, then the write
  block) — matching what they did pre-RLS, not a regression. Two boundaries that needed care:
  - `findAll` wraps its whole read block in a single `withScopedDb` and threads the `EntityManager`
    through every helper (`calculateStartingBalance`, `buildFilteredIdsSubquery`,
    `computeSplitAwareSum`, `enrichWithInvestmentLinks`, …), so the page query, its balance
    sub-queries and the attachment-count roll-up share one snapshot as before.
  - The auto-post cron's per-timezone read `withScopedDb` **must commit before** the per-user posting
    loop: each `post()` runs its own `withUserContext` transactions, which would otherwise join the
    system-context one via F2 re-entrancy.

  **Boundary decisions (for R3/R6 and L1):**
  - The R1 helpers that kept an optional `queryRunner` for unrefactored callers **dropped it**:
    `TagsService.setTransactionTags/setSplitTags/+Bulk` and
    `AccountsService.updateBalance/recalculateCurrentBalance` are now called with no runner from
    both modules — a nested `withScopedDb` joins the ambient transaction. Same for the in-module
    helpers: `TransactionSplitService.createSplits`/`deleteSplitSideEffects` lost their
    `externalQueryRunner` parameter, and `applySplitTags`/`removeParentTransaction`/
    `ScheduledTransactionsService.createSplits` take an `EntityManager` (or nothing) instead.
  - `InvestmentTransactionsService.createEmbeddedForSplit` / `reverseAndRemoveEmbedded` accept
    `QueryRunner | EntityManager` for now (a two-line shim at the top of each): the split service
    passes an `EntityManager` while securities-internal callers still pass a `QueryRunner`. **R3
    should delete the shim** once those callers convert.
  - `TransactionSplitService.deleteTransferSplitLinkedTransactions` was **removed** — dead
    production code (a strict subset of `deleteSplitSideEffects`, which handles investment splits
    too); its specs were re-pointed at `deleteSplitSideEffects`, so the transfer-leg reversal
    coverage is unchanged.
  - `getUsersByEffectiveTimezone` still queries the DataSource directly (unchanged from R1).

  **Tests:** the R1 harness (`src/test-helpers/scoped-db-testing.ts`) carried the whole batch — the
  specs `jest.mock` the scoped-db module and route `manager.getRepository(Entity)` to the same
  per-entity mocks. Where a spec previously distinguished "injected repo" from "queryRunner.manager"
  (bulk-update, transactions), those now resolve to one mock, so the per-phase overrides collapsed
  into a single ordered `createQueryBuilder` chain. QueryRunner-lifecycle assertions
  (`commitTransaction`/`release`) became `dataSource.transaction` grouping assertions. The
  cron smoke is `src/scheduled-transactions/rls-context-smoke.spec.ts`, which runs the auto-post
  cron end to end under the **real** `withScopedDb` + C2 wrappers at `RLS_MODE=off` (plus a negative
  control proving an unwrapped call still throws).

### R3. securities, investment-reports, net-worth, monte-carlo, loan-rate-changes, loan-scenarios
- [x] Status: done (branch `claude/rls-tasks-r3-r5-hcxbst`). All 14 service files converted
  (securities ×7: `securities`, `holdings`, `investment-transactions`, `portfolio`,
  `portfolio-calculation`, `security-price`, `sector-weighting`; `investment-reports` ×2;
  `net-worth`; `monte-carlo`; `loan-rate-changes` ×2; `loan-scenarios`). Ratchet lowered
  **187 → 137** `@InjectRepository` / **31 → 15** `createQueryRunner` (−66 sites, zero left in the
  six modules). Full `npm run test:unit` green (10154), build + lint clean.

  **One real bug found and fixed, not just a mechanical conversion.**
  `NetWorthService.triggerDebouncedRecalc` schedules a `setTimeout`, and several callers trigger it
  from *inside* a `withScopedDb` block (`TransactionSplitService.createSplits` is the clearest).
  AsyncLocalStorage propagates into a real timer, so the debounced body would have inherited that
  block's `EntityManager` through F2's scoped-manager ALS and fired ~2s later — after the
  transaction had committed and its connection had gone back to the pool. Every query in the recalc
  would then have run on a dead manager. The timer is now registered inside
  `runOutsideActiveScopedManager`, so the recalc opens its own transaction (which is what a
  background job wants anyway); the *identity* context lives in a different ALS and is preserved.
  Regression test: `src/net-worth/rls-context-smoke.spec.ts`, which fails on the original mistake.

  **Boundary decisions (for R6/R7 and L1):**
  - Helpers that took an optional `QueryRunner` now take an optional `EntityManager`:
    `HoldingsService.{findByAccountAndSecurity,createOrUpdate,updateHolding,applySplit,reverseSplit,adjustQuantity,validateNoNegativeHoldingsHistory}`
    and `SecuritiesService.setSecurityTags`. A private `inScope(manager, fn)` on `HoldingsService`
    is the one-liner for "use the caller's manager, else open a scoped one".
  - **R2's `QueryRunner | EntityManager` shim is gone.**
    `InvestmentTransactionsService.createEmbeddedForSplit` / `reverseAndRemoveEmbedded` now take a
    plain `EntityManager`, as R2 anticipated.
  - **`AccountsService.updateBalance` / `recalculateCurrentBalance` dropped their `queryRunner`
    parameter** — securities was the last caller passing one (R1 deferred this until "after those
    callers convert"). Their QueryRunner branches are deleted; a caller already inside a scoped
    transaction joins it via F2 re-entrancy.
  - `HoldingsService.rebuildAccountsFromTransactions` **keeps** a `QueryRunner | EntityManager`
    union: the `.mny` importer (R6) still passes a `{ manager }` shim. **R6 should drop the union**
    when it converts, passing the manager directly.
  - `getUsersByEffectiveTimezone` still queries the DataSource directly (unchanged from R1/R2).
  - Read-heavy report reads stayed one statement per short `withScopedDb`, matching the autocommit
    boundaries they had. Two exceptions wrap a whole read block in one transaction because the
    statements are a single logical snapshot: `InvestmentTransactionsService.findAll` (count + page)
    and `getLlmInvestmentTransactions` / `getSummary` (filter build + execute).
  - `NetWorthService` gained a private `scopedQuery(sql, params)` — one raw statement in its own
    short scoped transaction — because ~20 call sites there were bare `dataSource.query`.
  - `SecuritiesService.remove` now deletes the zero-quantity holdings and the security in **one**
    transaction; they were two autocommit statements before, which could strand holdings.

  **Flagged, NOT fixed (out of R3's scope):** `securities.controller.ts`'s fire-and-forget
  `netWorthService.recalculateAllInvestmentSnapshots()` after a manual price refresh is a
  cross-user sweep running under the *requesting user's* context. Harmless at `RLS_MODE=off`; under
  enforcement it would silently recalculate only that user's accounts. It needs a `withSystemContext`
  wrap, which R-task rules forbid adding here — it belongs with R6 (the controller is not in any R
  task's file list) or a follow-up C-task, and must land before flip B.

  **Tests:** the R1 harness (`src/test-helpers/scoped-db-testing.ts`, extended with a `merge` mock)
  carried the batch. Where a spec previously separated "reporting reads" (`dataSource.query`) from
  "writes" (`queryRunner.query`), the two now share `manager.query`, so those specs route it back to
  the same two mocks by statement text (`net-worth.service.spec.ts`, `portfolio.service.spec.ts`,
  `security-price.service.spec.ts`) rather than collapsing the fixtures. QueryRunner-lifecycle
  assertions became `dataSource.transaction` grouping assertions. Cron smokes:
  `src/securities/rls-context-smoke.spec.ts` (matured-holdings + price-refresh crons under the real
  `withScopedDb` + C2 wrappers, plus a negative control) and `src/net-worth/rls-context-smoke.spec.ts`
  (the debounce regression above; real timers, because jest's fake timers invoke the callback
  directly and would make the ALS-propagation assertion vacuous).

### R4. budgets
- [x] Status: done (branch `claude/rls-tasks-r3-r5-hcxbst`). All 8 service files converted
  (`budgets`, `budget-period`, `budget-period-cron`, `budget-alert`, `budget-generator`,
  `budget-activity-reports`, `budget-health-reports`, `budget-trend-reports`). Ratchet lowered
  **137 → 98** `@InjectRepository` / **15 → 13** `createQueryRunner` (zero of either left in the
  module). Full `npm run test:unit` green, build + lint clean.

  **Boundary decisions:**
  - `BudgetPeriodService.createPeriodForBudget` swapped its optional `QueryRunner` for an optional
    `EntityManager`, so the next period still commits with the close that produced it
    (`closePeriod` is one `withScopedDb`; `createNextPeriod` threads its manager through).
  - `bulkUpdateCategories` keeps its single-transaction guarantee — one `withScopedDb` around the
    loop, not one per row.
  - **The two-query category-spending helper now shares one transaction.** `queryCategorySpending`
    takes a Transaction repo and a TransactionSplit repo; both come from the same `EntityManager`
    now, so a category's direct and split halves are read from one snapshot instead of two
    autocommit statements. Same in `BudgetsService.getCachedCategoryActuals` and
    `BudgetAlertService.computeCategoryActuals`.
  - **Two dead injections dropped:** `budget-generator`'s `Account` repository and
    `budget-trend-reports`' `BudgetPeriodCategory` repository were injected and never used.

  **Tests:** the specs keep their `Test.createTestingModule` wiring and simply provide `DataSource`
  from `createScopedDbMocks`, with the per-entity repository mocks routed through
  `manager.getRepository`. (The leftover `getRepositoryToken` providers are harmless — nothing
  injects them any more — and dropping them can ride along with L1.) Cron smoke:
  `src/budgets/rls-context-smoke.spec.ts` runs `checkBudgetAlerts` and `closeExpiredPeriods` under
  the **real** `withScopedDb` + C2 wrappers at `RLS_MODE=off`, plus a negative control proving an
  unwrapped call still throws.

### R5. built-in-reports, reports
- [x] Status: done (branch `claude/rls-tasks-r3-r5-hcxbst`). All 10 service files converted
  (built-in-reports ×9: `spending`, `income`, `comparison`, `anomaly`, `tax-recurring`,
  `data-quality`, `monthly-comparison`, `monthly-category-breakdown`, `report-currency`; plus
  `reports`). Ratchet lowered **98 → 78** `@InjectRepository` (`createQueryRunner` unchanged at 13 —
  neither module had one). Full `npm run test:unit` green, build + lint clean.

  **Read-heavy, as the task warned — checked explicitly.** Every report statement is a single
  short `withScopedDb`, matching the autocommit boundary it had; a sweep for a `withScopedDb`
  nested inside a `for`/`while` found none, so there are no per-row transactions. The one method
  that needed more than a mechanical rewrite is `ReportsService.buildTransactionQuery`: it builds a
  QueryBuilder, mutates it through the filter branches, then executes it. Wrapping only the
  builder's construction would have executed it on a committed transaction's manager, so the whole
  method body is one `withScopedDb`.

  **No cron entry points in either module** (`grep @Cron` is empty), so there is no cron smoke spec
  here; every path is request-scoped and the interceptor already seeds its context.

  **Tests:** same approach as R4 — `DataSource` provided from `createScopedDbMocks`, per-entity
  repository mocks routed through `manager.getRepository`, and the raw-SQL assertions re-pointed
  from `transactionsRepository.query` to the transaction manager's `query` (with the same
  default-empty behaviour the repository mock had).

**Verified against a real PostgreSQL 16, not just unit mocks.** The full integration suite
(`test/integration/*`, 15 suites / 160 tests) was run against a live PG16 instance and is green.
It caught two things unit tests could not:
1. `security-transfer.integration.spec.ts` called `HoldingsService.findByAccountAndSecurity`
   straight from the test body with no ambient context — that read is now wrapped in
   `withUserContext`, matching how the rest of that suite already calls services.
2. `mny-import.integration.spec.ts` constructs `HoldingsService` by hand; its argument list was
   updated for the shrunken constructor.
(The three `test/*.e2e-spec.ts` suites fail to compile in this environment on a pre-existing
`cookie-parser` typing issue in `test/helpers/test-database.ts`, unrelated to these tasks —
verified by reproducing it with the branch's changes stashed.)

### R6. ai, mcp, import, action-history, currencies, updates, notifications
- [x] Status: done (branch `claude/rls-task-list-r6-r7-usodqx`). All 14 service files converted
  (ai ×7: `ai`, `ai-usage`, `insights-aggregator`, `ai-insights`, `forecast-aggregator`,
  `ai-forecast`, `financial-context.builder`; import ×2 + the 3 processor/context files;
  `action-history`; currencies ×2; `updates`; notifications ×2). Ratchet lowered **78 → 50**
  `@InjectRepository` / **13 → 9** `createQueryRunner` (zero left in the listed modules). Full
  `npm run test:unit` green, build + lint clean.

  **The MCP transport was broken at `RLS_MODE=off` before this task — that is the significant
  finding.** `/mcp` is bearer-authenticated with `@SkipCsrf()` and no `AuthGuard('jwt')`, so
  `req.user` is never set and `RequestContextInterceptor` enters its ALS scope with an **undefined**
  userId. The moment R1–R5 moved the domain services onto `withScopedDb`, every MCP tool handler
  reached them with no ambient identity and threw the missing-context error — a live regression, not
  a latent one, and exactly the class of break the C-before-R ordering exists to prevent (C1 had
  flagged `mcp-http.controller` as "R6's file scope"). Each of the four `transport.handleRequest`
  calls now runs under `withUserContext(session user)` — the MCP counterpart of what the interceptor
  does for cookie/JWT routes, with the id from `validatePat` (PAT or OAuth token), never from tool
  arguments. Regression spec `src/mcp/rls-context-smoke.spec.ts` runs the **real** `withScopedDb`
  from inside a fake transport's `handleRequest` and fails if the wrapper is removed.

  **SSE / streaming verified, as the task required.** `ai/query`, `ai/relay`, `ai/actions` and
  `mcp/**` hold no `DataSource` at all — they delegate to domain services, each of which opens its
  own short `withScopedDb` per operation. No connection is held across a stream.

  **Boundary decisions (for R7 and L1):**
  - **R3's `QueryRunner | EntityManager` union is gone.**
    `HoldingsService.rebuildAccountsFromTransactions` takes a plain `EntityManager`; the `.mny`
    importer passes the import transaction's own manager instead of a `{ manager }` shim.
  - **`getUsersByEffectiveTimezone` (`common/users-by-timezone.util.ts`) is converted**, closing the
    deferral R1/R2/R3 each carried. Its three callers (accounts, scheduled-transactions, securities
    crons) are already inside `withSystemContext`, so it needs no identity of its own.
  - `securities.controller.ts`'s fire-and-forget `recalculateAllInvestmentSnapshots()` now runs under
    `withSystemContext` (the R3 finding): prices are global, so a manual refresh moves every user's
    snapshots, and the requesting user's context would have silently narrowed it to their own.
  - `AiUsageService.getUsageSummary` keeps its five reads **independent** (a private `usageLogs()`
    helper, one short transaction each) rather than sharing one manager, so they still run
    concurrently instead of serializing on a single connection.
  - The QIF/CSV importer's two `createQueryRunner` blocks became one `withScopedDb` each, keeping the
    per-transaction `SAVEPOINT`s inside them — a single bad row still rolls back alone.
  - **`CurrenciesService.onApplicationBootstrap` and `ExchangeRateService.onModuleInit` gained
    `withSystemContext` wraps.** Bootstrap hooks are out-of-request entry points that no C-task
    covered; without them the converted reads throw at `off` on every boot. The startup backfill
    fan-out re-wraps each user in `withUserContext`. Enumerated under "scope extensions" below.

  **Tests:** the R1 harness (`src/test-helpers/scoped-db-testing.ts`) carried the batch. Cron and
  bootstrap smokes run the **real** `withScopedDb` at `RLS_MODE=off`, each with a negative control:
  `src/currencies/rls-context-smoke.spec.ts` (both bootstrap hooks + the FX cron),
  `src/ai/rls-context-smoke.spec.ts` (usage purge + daily insight fan-out) and
  `src/mcp/rls-context-smoke.spec.ts` (above).

### R7. auth, users, delegation, admin, emergency-access, backup, database
- [x] Status: done (branch `claude/rls-task-list-r6-r7-usodqx`). All 17 service/controller files
  converted. Ratchet lowered **50 → 0** `@InjectRepository` / **9 → 0** `createQueryRunner`:
  **the ratchet is now at zero, so R1–R7 are complete and L1 is unblocked.** Full
  `npm run test:unit` green (10,165), build + lint clean, and the 15 integration suites (160 tests)
  green against a real PostgreSQL 16.

  **All three of M2's open ownership findings are closed.**
  1. **`delegateMustEnrollOwn2FA` reading the owner's rows under the delegate's context** — fixed by
     a new `withDelegateContext(owner, delegate, fn)` helper (`common/db/with-context.ts`), which
     seeds `current = owner` and `real = delegate`. `jwt.strategy` re-seeds the acting-context
     re-validation with it; `withUserContext` alone collapses both GUCs onto one id, and the
     owner's `users`/`user_preferences` half then matches neither policy arm.
  2. **`AccountDelegateGuard` needed the same two-GUC seeding** — it runs before `AuthGuard('jwt')`
     and before the interceptor's scope, so its `DelegationService` reads had no identity at all.
     Its whole delegate branch now runs under `withDelegateContext(payload.actingAsUserId,
     payload.sub)`, using the ids the guard already verifies itself.
  3. **`admin/` had no `withSystemContext` anywhere** — every public `AdminService` method now wraps
     its body (the `*WithinContext` shape C1/C3 used). Every one of them is cross-user by
     definition (they act on `targetUserId`), so under enforcement they would have affected zero
     rows. Authorization is unchanged: `AdminController` is still class-guarded by
     `AuthGuard('jwt') + RolesGuard + @Roles("admin")`.

  **`withScopedDb` gained an optional isolation level.** Registration and OIDC first-user creation
  used `dataSource.transaction("SERIALIZABLE", ...)` to close the first-user-admin race; the door had
  no way to express that, so converting them would have silently downgraded the isolation and
  reopened the race. The third parameter is passed straight through, and a request for an isolation
  level while *joining* an ambient transaction throws rather than being silently ignored.

  **Boundary decisions:**
  - Services with many one-statement reads (`delegation`, `auth`, `users`, `emergency-access`,
    `backup`, `admin`) grew a private `scoped(Entity, fn)` helper: one repository call in one short
    transaction, the same autocommit boundary each injected-repository call had. Multi-statement
    units use an explicit `withScopedDb` block instead.
  - Read-modify-writes that were split across autocommit statements now share one transaction where
    a concurrent writer could slip between them: the admin last-admin check + demotion, the admin
    account wipe, `AdminService.revokeSessionsAndTokens`, the delegate-favourite upsert, and
    `AiService.createConfig`'s per-user provider cap.
  - `DelegationService.accountIdsForTransfer` reads both transfer legs from one snapshot — the guard
    gates a write on holding the permission for *every* account the transfer touches.
  - Backup restore's whole block is one `withScopedDb`, as the QueryRunner was. The
    `preserveTimestamps` swap stays out of scope (C5), so the `DISABLE TRIGGER` pair is untouched.
  - `DemoResetService` had to be restructured, not just renamed: the clear must **COMMIT** before the
    re-seed (which opens its own scoped transactions), so the transaction now returns the demo user
    id and the re-seed runs after it.

  **Fixed while here (reported bug, `backup.service.ts`):** the restore wipe's user-created-currency
  delete guarded only `user_currency_preferences` and `accounts`, but `currencies.code` is
  referenced by nine columns across eight tables and only the preferences FK cascades. The one that
  bit was `exchange_rates` — global, never cleared by a restore, and populated for every currency the
  FX backfill has seen — so any user who added a custom currency and let the daily rate refresh run
  could not restore a backup at all (`violates foreign key constraint
  exchange_rates_to_currency_fkey`). The guard now covers every referencing table. Verified against a
  real PostgreSQL 16: the old query reproduces the reported error, the new one succeeds and correctly
  keeps a currency that exchange rates still reference. Regression test in
  `backup.service.spec.ts` fails on the original query.

  **Tests:** the R1 harness carried the batch; QueryRunner-lifecycle assertions became
  `dataSource.transaction` grouping assertions, and specs that stub the transaction body directly got
  a shared `installTransactionMock` that accepts both call shapes and routes `getRepository` at the
  same per-entity mocks. `scopedDbMockModule` now forwards an explicit isolation level so the
  SERIALIZABLE assertion stays writable. Cron/guard smoke: `src/auth/rls-context-smoke.spec.ts` runs
  the token purge, auto-backup cron, emergency-access sweep and the delegate guard under the **real**
  `withScopedDb`, plus a negative control.

### Scope extensions taken in R6/R7 (deviations from the R-task rules, enumerated)

R-task rules say "Out of scope: any *new* `withSystemContext`/`withUserContext` wrapping" and "if you
find a call path with no wrapping, stop and note it". Six paths needed wrapping that no C-task owned.
Each was added **in the same commit as the conversion that needs it**, so the ordering hazard the rule
guards against (wrapping landing in a later PR than the conversion) never existed. They are:

| Path | Wrapper | Why no C-task covered it |
|------|---------|--------------------------|
| `mcp-http.controller` ×4 `handleRequest` | `withUserContext(session user)` | C1 explicitly deferred this file to R6; the break was already live |
| `CurrenciesService.onApplicationBootstrap` | `withSystemContext` | bootstrap hooks are not crons, seeders, guards or interceptors |
| `ExchangeRateService.onModuleInit` | `withSystemContext` + per-user `withUserContext` | same |
| `securities.controller` snapshot recalc | `withSystemContext` | flagged by R3, assigned to R6 |
| `AccountDelegateGuard` delegate branch | `withDelegateContext` | M2 finding #2, "must land before R7 converts DelegationService" |
| `AdminService` public methods | `withSystemContext` | M2 finding #3, "needs its own C-task or an explicit extension of R7's scope" |
| `auth.controller` email-locale reads ×2 | `withSystemContext` | public routes; C1 wrapped the service, not the controller's own reads |

---

## Context-wrapping tasks (C1–C6)

### C1. Auth wrapping + public-route audit (lands BEFORE the refactors)

- [x] Status: done (branch `claude/rls-task-status-column-8qqlbm`). Wrapping applied:
  `jwt.strategy.validate` runs both lookups under `withUserContext(payload.sub)`;
  `AuthService.{register,login,refreshTokens,verify2FA,findOrCreateOidcUser,confirmOidcLink,generateResetToken,resetPassword,generateVerificationToken,verifyEmail}`
  under `withSystemContext` (the large bodies extracted to `*WithinContext` privates to keep the
  wrapper a one-liner); `PatService.validateToken` under `withSystemContext`; the two shared methods
  reachable on public routes wrapped at their call sites (`generateTokenPair` in the OIDC callback,
  `revokeRefreshToken` in `logout`, both `withSystemContext`); `OAuthProviderService.findAccount` and
  `validateAccessToken` read `getUserStateById` under `withUserContext(sub)`;
  `OAuthInteractionController.resolveCookieUser` reads `getUserById` under
  `withUserContext(payload.sub)`. Context-assertion unit tests added to the jwt.strategy, auth.service,
  pat.service, oauth-provider, and oauth-interaction specs; existing specs updated to UUID fixtures
  (jwt/OAuth subs now flow through `withUserContext`'s UUID validation). Full `npm run test:unit` green
  (8917), build + lint clean, F3 ratchet unchanged.

**Public-route audit (findings):**
- **Wrapped in C1 (touch user tables, no `req.user`):** every public `auth.controller` route
  (`register`, `login`, `oidc/callback`, `forgot/reset-password`, `verify/resend-verification`,
  `2fa/verify`, `refresh`, `oidc/confirm-link`, `logout`) via the `AuthService` / call-site wraps
  above; PAT auth (`PatService.validateToken`) and OAuth access-token auth
  (`OAuthProviderService.validateAccessToken`), both entered from `mcp-http.controller`'s
  `validatePat` (that controller is R6's file scope — wrapping the two services it calls covers the
  auth phase); the node-oidc-provider Express mount's one user-table touch (`findAccount`); the OAuth
  consent pages (`oauth-interaction.controller`).
- **`jwt.strategy` uses `withUserContext`, never `withSystemContext`** (verified by grep + a unit
  test) — it is the highest-QPS query in the system, so bypass must never be its steady state.
- **Exempt (no user data — note only):** `health.controller` (`SELECT 1` connectivity probe only);
  `oauth-metadata.controller` and the OIDC discovery documents (static config); the node-oidc-provider
  Express mount's `oauth_payloads` reads/writes (that table is deliberately **RLS-exempt**, see M2).
- **`oauth_payloads` hardening decision:** keep the `monize_app` DML grants and leave the table
  RLS-exempt (matches M2's exclusion list) — no owner-DataSource split. `oauth_payloads` is a
  short-lived opaque token/grant store keyed by random id, never queried per end-user, so an owner
  policy would add no isolation.
- **Flagged, NOT wrapped (out of C1's file scope):**
  - `AccountDelegateGuard` (`backend/src/delegation/guards/account-delegate.guard.ts`) runs in the
    guard phase *before* `AuthGuard('jwt')` and, **for delegate tokens only**, calls
    `DelegationService` methods that read `account_delegates` / `account_delegate_grants` / `accounts`
    / `transactions` / `scheduled_transactions`. It knows the identity (it verifies the token itself:
    `payload.sub` = delegate, `payload.actingAsUserId` = owner), but correct wrapping needs **both**
    GUCs (`current` = owner, `real` = delegate), which `withUserContext(userId)` alone cannot seed. It
    lives in the delegation module (outside C1's `auth/**` + `oauth/**` scope), so it is left for the
    delegation wrapping/refactor — **must land before R2/R7 convert `DelegationService` to
    `withScopedDb`**, or delegate requests throw at `off`.
  - `emergency-access-claim.controller` public routes → **C4**.
  - `RequestContextInterceptor`'s `touchLastActivity` / timezone reads run outside its own scope →
    **C6**.
- **L1 note:** the `with-context.ts` import allowlist must include `backend/src/oauth/**` (this task
  added `withUserContext` imports to `oauth-provider.service.ts` and `oauth-interaction.controller.ts`)
  in addition to the auth module.

**Scope:** `backend/src/auth/**`, `backend/src/oauth/**`, PAT validation path, password-reset +
email-verification lookups, plus the audit. Wrapping only — no repository-to-`withScopedDb` conversion
(that is R7). Wrapping before refactoring is inert: the helpers only seed ALS.

**Do:** per design Phase 4:
- `jwt.strategy` validate (user + delegation lookups): **`withUserContext(payload.sub)`**, NOT
  `withSystemContext` — the verified token already names the user, and this is the highest-QPS query
  in the system; bypass must not be its steady state.
- `withSystemContext` for the genuinely pre-identity paths: login-by-email / register / refresh, PAT
  token-hash lookup (all MCP traffic), password-reset / email-verification token lookups, OIDC/OAuth
  callback and the MCP-connector OAuth flow's `oauth_payloads` access. While here, record the
  `oauth_payloads` hardening decision (design Phase 3: keep grants + RLS-exempt, or revoke
  `monize_app` grants and use an owner DataSource for the OAuth module) in the PR.
- Then **audit every route reachable without `req.user`** (guard-less controllers, public decorators,
  every Passport strategy) and list the findings in the PR — each either wrapped, or explicitly
  justified as touching no user table.

**Accept:** integration/e2e auth suites green (wrapping is behavior-neutral pre-refactor); audit list
in PR description; grep shows no `withSystemContext` import in `jwt.strategy`.

### C2. Cron jobs

- [x] Status: done (branch `claude/rls-task-status-column-8qqlbm`). All 20 `@Cron` decorators
  enumerated; the two demo-reset crons are C3's scope and the emergency-access expiry monitor is C4's,
  leaving 17 wrapped here. Auto-post wrapper-usage test added
  (`scheduled-transactions.service.spec.ts`) asserting the fan-out runs under `{ system: true }` and
  each `post()` under `{ userId }`. Non-UUID user-id fixtures across the touched cron specs moved to
  UUIDs (the per-user wrap validates the id). Full `npm run test:unit` green (8921), build + lint
  clean, F3 ratchet unchanged.

  **Per-handler wrapping (17 of 20; demo-reset ×2 → C3, emergency-access-monitor → C4):**

  | Handler | File | Wrapping |
  |---------|------|----------|
  | `purgeOldUsageLogs` | `ai/ai-usage.service.ts` | system (bulk delete) |
  | `handleDailyInsightGeneration` | `ai/insights/ai-insights.service.ts` | system (cleanup + active-user fan-out) + `withUserContext` per `generateInsights` |
  | `purgeExpiredRefreshTokens` | `auth/token.service.ts` | system (bulk delete) |
  | `scheduledPriceRefresh` | `securities/security-price.service.ts` | system (symbol-grouped refresh + snapshot recalc, irreducibly cross-user) |
  | `applyMaturedInvestmentHoldings` | `securities/holdings.service.ts` | system (tz + matured-user fan-out) + `withUserContext` per `rebuildFromTransactions` |
  | `scheduledRefresh` | `updates/updates.service.ts` | **none** — no DB access (GitHub fetch + in-memory cache) |
  | `cleanupExpiredHistory` | `action-history/action-history.service.ts` | system (bulk delete) |
  | `sendBillReminders` | `notifications/bill-reminder.service.ts` | system (manual-bill fan-out) + `withUserContext` per user's prefs/user reads |
  | `processAutoPostTransactions` | `scheduled-transactions/scheduled-transactions.service.ts` | system (tz/candidate fan-out) + `withUserContext` per `post` |
  | `closeExpiredPeriods` | `budgets/budget-period-cron.service.ts` | system (active-budget fan-out) + `withUserContext` per budget (open-period read + `closePeriod`) and per user (`sendMonthlySummaryForUser`) |
  | `checkBudgetAlerts` | `budgets/budget-alert.service.ts` | system (fan-out) + `withUserContext` per `processAlerts` |
  | `sendWeeklyDigest` | `budgets/budget-alert.service.ts` | system (fan-out) + `withUserContext` per `sendDigestForUser` |
  | `purgeOldAlerts` | `budgets/budget-alert.service.ts` | system (bulk deletes) |
  | `handleAutoBackupCron` | `backup/auto-backup.service.ts` | system (due-settings fan-out) + `withUserContext` per `exportToFile` + settings save |
  | `checkMortgageRenewals` | `accounts/mortgage-reminder.service.ts` | system (renewal fan-out) + `withUserContext` per user's prefs/user reads |
  | `applyDueTransactionBalances` | `accounts/accounts.service.ts` | system (fully cross-user: tz-bucketed bulk reads + single multi-user UPDATE) |
  | `scheduledRateRefresh` | `currencies/exchange-rate.service.ts` | system (currency-detection read spans all users' policied tables; writes global `exchange_rates`) |

**Scope:** every `@Cron` handler (~17 files / ~20 decorators; grep `@Cron` across `backend/src`).
Wrapping only, before any R task refactors these services — wrapping is inert pre-refactor.

**Do:** cross-user fan-out queries under `withSystemContext`; per-user bodies under
`withUserContext(userId)` so they keep the RLS net. Pattern per design Phase 4
(`processAutoPostTransactions`, `getUsersByEffectiveTimezone` are the named examples). Enumerate all
handlers in the PR description with which wrapper each got. (Note: crons verifiably run in the API
process — `ScheduleModule.forRoot()` in `app.module.ts`, no scheduler entrypoint exists; on k8s every
replica fires every cron, pre-existing.)

**Accept:** unit tests for at least the auto-post and demo-reset paths proving wrapper usage; full list
in PR; no handler left unwrapped (grep `@Cron` count == enumerated count).

### C3. Seeders + demo reset

- [x] Status: done (branch `claude/rls-task-status-column-8qqlbm`). Whole flows wrapped in
  `withSystemContext` (bodies extracted to `*WithinContext` privates): `SeedService.seedAll`,
  `DemoSeedService.seedAll` + `seedDemoData` (the latter also called directly by the daily reset), and
  both `DemoResetService` crons (`resetDemoData`, `generateIntradayTransactions` -- the two `@Cron`
  handlers deferred from C2). The `if (!isDemo) return` guards and the opening log lines stay outside
  the wrapper. A wrapper-usage test asserts `resetDemoData`'s raw SQL runs under `{ system: true }`.
  Seed/demo-seed/demo-reset specs green (56 + the new assertion), build + lint clean.

**Scope:** `database/seed.service.ts`, `demo-seed.service.ts`, daily demo reset entry. Wrapping only,
before R7 refactors the database module.

**Do:** wrap whole seed/reset flows in `withSystemContext` (raw cross-user SQL keeps working under
bypass).

**Accept:** seed + demo reset run green locally at `RLS_MODE=off`.

### C4. Emergency access

- [x] Status: done (branch `claude/rls-task-status-column-8qqlbm`). Both public claim handlers
  (`EmergencyAccessClaimController.preview` / `complete`) wrapped in `withSystemContext` (bodies
  extracted to `*WithinContext` privates) -- the requester is the grantee/bare token, so every
  owner-keyed read/write (the token-hash contact lookup, the owner's `users`/`user_preferences`/
  `trusted_devices`/`refresh_tokens` and the emergency-access tables, in a raw `queryRunner`
  transaction) runs under bypass. The expiry-monitor cron
  (`EmergencyAccessMonitorService.runDailyCheck` -- the `@Cron` deferred from C2) wraps its whole
  cross-user sweep in `withSystemContext` (the SMTP guard stays outside). Wrapper-usage tests assert
  both `preview` and the sweep run under `{ system: true }`; all emergency-access specs green (82).

  **Grantee-side read audit (result):** **no in-session grantee-side reads exist.** The authenticated
  surface (`emergency-access.controller.ts`, class-guarded by `AuthGuard('jwt') + StepUpGuard`) is
  entirely owner-keyed -- every `EmergencyAccessService` call passes `req.user.id` as the owner and
  every query filters `owner_user_id = :userId` (the `email` filters are duplicate-contact checks
  *within the owner's own* contact list, still owner-scoped). There is no "who named me as an
  emergency contact" lookup. So under the owner-only special policies
  (`emergency_access_settings|contacts → owner_user_id = current`) the authenticated reads work with
  the normal request context, and **no `withSystemContext` wrapping and no email-match policy arm are
  required** on that surface. The only grantee-facing path is the public claim controller, wrapped
  above.

**Scope:** `backend/src/emergency-access/emergency-access-claim.controller.ts` + claim service path,
expiry monitor. Wrapping only, before R7 refactors these services.

**Do:** claim flow (grantor's `users`/`trusted_devices`/`refresh_tokens` rows while requester is
grantee or bare token) and the expiry monitor's cross-user sweep under `withSystemContext`. Also
**audit for in-session grantee-side reads** of the emergency-access tables (a logged-in user listing
grants naming their email — the tables are owner-keyed with email/token grantee identification, so
such reads see zero rows under the owner-only policy): wrap any found in `withSystemContext` with
app-level filtering, or record a reviewed decision to extend the policy with an email-match arm.

**Accept:** emergency-access integration/e2e specs green; claim exercised end-to-end in the spec;
grantee-side audit result in the PR description.

### C5. Backup restore

- [x] Status: done (branch `claude/rls-tasks-next-steps-2ra6rr`). The trigger DDL pair and its
  table bookkeeping are deleted from `restoreDeferredFkColumns`; the whole restore transaction now
  runs under a new **`withPreserveTimestamps(fn)`** helper (`common/db/with-context.ts`) that extends
  the ambient context with the flag — identity is inherited, not granted, so an unwrapped call path
  still throws and the restore keeps running as the requesting user (no system bypass).
  - The wrapper-usage unit test asserts the user lookup runs unflagged, the restore transaction
    flagged, and the deferred UPDATE runs with **no trigger DDL**; a source-scan guard test fails if
    `DISABLE TRIGGER`/`ENABLE TRIGGER` ever reappear in `backup.service.ts` (the
    `ui-conventions.test.ts` pattern).
  - `backup-restore.integration.spec.ts` previously **recreated the pre-M1 trigger function by
    hand**, which would have made every timestamp assertion test a function that no longer ships. It
    now applies the real RLS migrations via T1's `applyRlsPolicies`, and the round-trip asserts a
    backdated `updated_at` survives export → restore → Phase-3 deferred-FK UPDATE **at
    `RLS_MODE=off`** (the acceptance case: the GUC path is now the only preservation mechanism).
    Negative control verified: removing the wrapper fails that assertion with a freshly stamped
    timestamp.
  - Full unit suite (10,176) + integration suite (18/206) green against a real PostgreSQL 16.

**Scope:** `backend/src/backup/backup.service.ts` (restore path, ~line 1317).

**Do:** delete the `ALTER TABLE ... DISABLE TRIGGER` / `ENABLE TRIGGER` pair; run restore transactions
with `preserveTimestamps: true` in the ambient context so `withScopedDb` emits the GUC per transaction.
Restore runs under the requesting user's normal context — no system bypass, no DDL.

**Deploy note (why this is "neutral", not "inert"):** this task changes how restore works **at
`RLS_MODE=off`** — the GUC path becomes the only thing preserving restored timestamps. Two
preconditions, both guaranteed by task order but verify anyway: M1's GUC-aware trigger is in the
deployed DB (migrations run at startup, M1 ships earlier), and F2's `withScopedDb` emits
`app.preserve_timestamps` unconditionally (not mode-gated).

**Accept:** backup export + restore integration test **at `RLS_MODE=off`** proves restored
`updated_at` values preserved and no `must be owner of table` error path remains; no `DISABLE TRIGGER`
string left in `backup.service.ts`.

### C6. Interceptor restructure: fire-and-forget writes into the ALS scope

- [x] Status: done (branch `claude/rls-task-status-column-8qqlbm`). Both DB-touching helpers now run
  under `withUserContext(userId)`: `touchLastActivity`'s `users.update` and `resolveTimezone`'s
  `user_preferences` read + `lastClientTimezone` write. They run before the interceptor enters its
  `requestContextStorage.run({ userId, realUserId, timezone })` scope (that scope needs the resolved
  timezone), and all three accesses are owner-keyed (`users.id` / `user_preferences.userId` = the
  effective user), so `withUserContext(userId)` is the correct seed. Grep confirmed `request-context`
  is the only interceptor with DB writes (csrf-refresh sets cookies; the two delegate-mask
  interceptors only transform response payloads). Unit tests assert each of the three DB calls fires
  under `{ userId }`; the existing suite's non-UUID fixtures were moved to UUIDs (the wrap validates
  the id). Behavior at `RLS_MODE=off` unchanged (same rows, same fire-and-forget semantics).

**Scope:** `backend/src/common/interceptors/request-context.interceptor.ts`, any other post-response
writes found by grep.

**Do:** the interceptor's own DB calls currently run **outside** the scope it creates:
`touchLastActivity` fires and `resolveTimezone` reads/writes `user_preferences` *before*
`requestContextStorage.run()` is entered (`request-context.interceptor.ts:78-99` — the scope wraps
only `next.handle()`). Converted naively in R7, all three sites would throw on every authenticated
request. Restructure: move these calls inside the scope the interceptor establishes, or wrap each in
`withUserContext(userId)`. Behavior at `off` must be preserved (same writes, same fire-and-forget
semantics). Do not convert the repository calls to `withScopedDb` here — R7 does that; this task only
guarantees ambient context exists when it happens.

**Accept:** unit tests cover both writes running inside a context scope; interceptor e2e/integration
behavior unchanged; no context-throw in dev smoke once R7 lands (verified again there).

---

## Finalization tasks

### L1. Lint bans

- [x] Status: done (branch `claude/rls-tasks-next-steps-2ra6rr`). All three rules live in
  `backend/eslint.config.mjs`:
  - `no-restricted-imports` bans `InjectRepository` from `@nestjs/typeorm` and
    `no-restricted-syntax` bans any `.createQueryRunner()` call across `src/`, excluding specs,
    `src/test-helpers/**` and `scoped-db.ts`.
  - `common/db/with-context` imports are allowed only from `WITH_CONTEXT_ALLOWLIST` — **36 files,
    derived from the tree as instructed** (C5 added `backup/backup.service.ts` for
    `withPreserveTimestamps` on top of the 35 the note below counted). Flat-config subtlety: the
    allowlist override must **restate** the `InjectRepository` paths ban, because a later block
    replaces a rule's whole options object — verified by injecting `InjectRepository` into an
    allowlisted file and watching it still fail.
  - The F3 ratchet is removed (script, self-test, baseline, npm scripts, both CI steps); the lint
    rules are the permanent replacement, still enforced by the same "Backend Lint & Type Check" job
    via `npm run lint`.
  - Verified: clean on the real tree; a synthetic file violating all three bans produces all three
    errors.

  The original unblock note is kept for the audit trail: as of 2026-08 (pre-C5), **35 non-spec
  files** imported `common/db/with-context` — more than the C1 note or the R6/R7 additions describe,
  including `backend/src/import/mny/**` (3 files) and `backend/src/mcp/tools/transactions.tool.ts`,
  which postdate R7. The allowlist was derived with
  `grep -rl "db/with-context" backend/src --include=*.ts | grep -v spec`, not from any enumeration
  in this document.

**Do:** ESLint `no-restricted-imports`: `with-context.ts` importable only from the allowlist (admin,
auth bootstrap, emergency access, cron/jobs, seeders, backup). Ban `@InjectRepository` and
`createQueryRunner` outside `scoped-db.ts` + test helpers. Remove the F3 ratchet script (superseded).

**Accept:** lint fails on a synthetic violation of each rule; clean on the real tree.

### D1. Docs

- [x] Status: done (branch `claude/rls-tasks-next-steps-2ra6rr`). **This closes the task list** —
  everything left in the RLS effort is operator-only (the runbook's shadow soak, staging enforce,
  flip A, flip B).
  - **Root `CLAUDE.md`:** the QueryRunner/ratchet sections were already current (L1 corrected the
    ratchet paragraph when it removed the script); added `withPreserveTimestamps` to the context-
    helper list, including the "trigger DDL must never come back" guard-test pointer.
  - **`database/CLAUDE.md`:** new "Row-Level Security conventions (hard rules)" section — the
    new-table rule (policy ships in the same migration; any migration numbered after `123` also
    ships its own `ENABLE`, because `123` derives from `pg_policies` at the moment it runs and
    never runs again on a deployed DB), the four buckets with their spec-map obligations, the
    initplan form, and the no-role/no-grant rule with db-init/CNPG as the provisioning paths. The
    new-migration checklist gained the policy step, and its hard-coded "current latest" migration
    number (stale at `079`) was replaced with "read the max from the directory".
  - **`backend/CLAUDE.md` + `docs/cron-jobs.md`:** the stale separate-scheduler claim is gone —
    crons run in the API process (`ScheduleModule.forRoot()`), every k8s replica fires every cron,
    and new `@Cron` handlers must seed their own context (C2 pattern, `rls-context-smoke.spec.ts`
    as the proof shape). The dead `start:scheduler` script was deleted from `package.json`.
    Also fixed backend/CLAUDE.md's stale 13-locale list to point at `SUPPORTED_LOCALE_CODES`.
  - **`.env.example` / helm / CNPG:** verified already final from F1 — `RLS_MODE` tri-state,
    `DATABASE_APP_USER`/`DATABASE_APP_PASSWORD` (incl. the `log_statement` caveat) are documented
    in `.env.example`; `helm/values.yaml` + `configmap-backend.yaml` carry the keys and
    `helm/README.md` documents the CNPG `DatabaseRole`/`managed.roles` requirement. No changes
    needed.
  - **Runbook:** verified against the implemented reality and corrected where it had drifted —
    status header now says implemented-not-enforced with the flip-B warning, the enable migration
    is named concretely (`123_rls_enable.sql`, pg_policies-derived), the allowlist paragraph points
    at `WITH_CONTEXT_ALLOWLIST` in `eslint.config.mjs`, the ambient-manager wording matches
    `scoped-db.ts` (own ALS scope, not the request context), and the policy count in the removal
    section is exact (53). The move-to-`docs/rls.md`-at-ship-time note was already present.
  - **Acceptance:** `npm run i18n:check` clean (no strings changed); design doc Verification items
    1–2 are runnable as written and were run green in this session (build + lint clean; unit
    10,176 and integration 206 tests green, including the `rls-enforcement` spec).

**Do:** update root `CLAUDE.md` (QueryRunner section now points at `withScopedDb` as the required pattern)
and `database/CLAUDE.md` (RLS migration conventions, "adding a new table" policy step — four buckets,
no role/grants in migrations). **Write the new-table rule as a hard convention:** a migration creating
a user-owned table ships its `CREATE POLICY` in the same file, and — once M3 has shipped — its
`ENABLE ROW LEVEL SECURITY` too. `117_mny_import_staging_and_jobs.sql` and
`118_security_documents_rls.sql` already do the policy half by hand; the rule is what keeps the next
one from being the single unprotected table under enforcement. Then fix `backend/CLAUDE.md`'s **stale scheduler claim** (crons run in the
API process; there is no separate scheduler — delete or fix the dead `start:scheduler` script
reference); finalize `.env.example` comments; verify the helm chart values/ConfigMap and the CNPG
`managed.roles` requirement are documented for k8s operators; verify the runbook matches the
implemented reality and note it moves to `docs/rls.md` at ship time.

**Accept:** docs match code; `npm run i18n:check` clean; design doc's Verification section items 1–2
runnable as written.
