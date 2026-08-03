# Cross-Owner Transfers: Agent Task List

> Companion to [`cross-owner-transfers.md`](./cross-owner-transfers.md) (the design). This file breaks the plan into tasks sized for one AI-agent session each. Do the tasks in dependency order; never start a task whose dependencies are unmerged. Mark a task done by checking its box and noting the PR.

## How to use this list (read first, every session)

- **One task per session/PR.** Each task lists its files. Touching files outside the task's scope is a scope violation -- stop and leave a note instead.
- **The governing invariant applies to every task:** same-owner transfers behave byte-identically after your change. Every new branch is entered only when the two accounts (or legs) have different owners. If your change alters same-owner behavior, the task is wrong -- stop.
- **Definition of done for every task** (in addition to per-task acceptance):
  - `cd backend && npm run build && npm run lint` clean (lint bans `@InjectRepository(` and `createQueryRunner(` outright and restricts `common/db/with-context` imports to `WITH_CONTEXT_ALLOWLIST` in `eslint.config.mjs` -- new DB access uses `withScopedDb`, and a new `withSystemContext` call site means an allowlist entry in the same PR, as a reviewed decision).
  - `TZ=UTC npm run test:unit` green; new code covered (95% global / 85% per-file thresholds).
  - Any migration mirrored into `database/schema.sql` in the same PR; `npm run migration:lint` and `scripts/verify-schema.sh` clean.
  - New user-facing strings: English catalogs only (`en/*`), then `npm run i18n:pseudo`. The full-locale pass is task Q3, once, at acceptance -- do not translate early. Parity-test failures on a WIP branch are expected until Q3.
- **Terminology:** "the design doc" = `cross-owner-transfers.md`. Phase references point there. The migration number in D1 was unassigned when this was written (max was `123_rls_enable.sql` at the last review) -- **verify with `ls database/migrations` and use the actual next number**, keeping the numeric prefix unique. Line numbers cited in the design doc were accurate at writing time; re-locate by symbol, not line.

## Deployment safety

Every task is safe to merge and deploy in any order that respects the dependency column: the feature only activates when a user actually holds accounts on both sides of a transfer, and the new authorization rule reduces to today's ownership check for everyone else. "Deploy impact" classes (same meaning as in `row-level-security-tasks.md`):

| Class | Meaning |
|-------|---------|
| **none** | Tests, docs, or code nothing calls yet. Byte-for-byte behaviorally identical. |
| **inert** | Ships real code or DB objects designed to change nothing until a later task (or a cross-owner situation) activates them. Verify the per-task acceptance that proves inertness. |
| **neutral** | Rewrites live code paths (interceptor generalization, actor plumbing). Designed behavior-preserving for same-owner traffic; full unit + integration suites are the gate, not optional. |

## Task graph

| ID | Task | Depends on | Deploy impact | Status |
|----|------|-----------|---------------|--------|
| A1 | `CrossOwnerAccessService`: `accountAccessFor`, `readableAccountIdSetFor`, `isAccountOwnedBy` | -- | inert | [x] (branch `claude/cross-owner-transfers-5ig0bn`) |
| A2 | Guard relaxation (transfer/scheduled decorator blocks only) + actor plumbing through transfer endpoints | A1 | neutral | [x] (branch `claude/cross-owner-transfers-5ig0bn`) |
| T1 | `createTransfer` cross-owner: per-leg `user_id`, per-owner balances/net-worth/action-history, reference-data gating | A1, A2 | inert | [x] (branch `claude/cross-owner-transfers-5ig0bn`) |
| T2 | `updateTransfer` / `removeTransfer` / `getLinkedTransaction` cross-owner: `loadLegById`, sync-policy matrix, frozen-link lock, own-leg delete | T1 | inert | [x] (branch `claude/cross-owner-transfers-5ig0bn`) |
| T3 | Wrappers + bulk + AI prep: tag-sync gating, `syncTransferTags` filter, AI/MCP cross-owner edit block | T2 | neutral | [x] (branch `claude/cross-owner-transfers-5ig0bn`) |
| M1 | Mask util extraction + interceptor generalized to all users (fast path) + `/linked` endpoint | A1, T2 | neutral | [x] (branch `claude/cross-owner-transfers-5ig0bn`) |
| M2 | CSV export masking + AI/MCP read masking | M1 | neutral | [x] (branch `claude/cross-owner-transfers-5ig0bn`) |
| F1 | `GET /accounts/transfer-candidates` endpoint | A1 | inert | [x] (branch `claude/cross-owner-transfers-5ig0bn`) |
| F2 | Frontend: transfer form candidate groups, grant-filtered options, frozen-lock UI | F1, T1, T2 | inert | [x] (branch `claude/cross-owner-transfers-5ig0bn`) |
| D1 | Migration: delegate-read policy arm on `transactions` + `idx_adg_account` index | -- | inert* | [x] (branch `claude/cross-owner-transfers-5ig0bn`) |
| Q1 | Integration suite: `cross-owner-transfers.integration.spec.ts` (incl. stateless reshare-reconnect proof) | T1-T3, M1-M2 | none | [x] (branch `claude/cross-owner-transfers-5ig0bn`) |
| Q2 | Playwright e2e journey in `delegation.spec.ts` (share -> transfer -> unshare -> mask -> reshare -> reconnect) | F2, Q1 | none | [x] (branch `claude/cross-owner-transfers-5ig0bn`) |
| Q3 | Full-locale i18n pass (acceptance, final commit) | all above | none | [x] (branch `claude/cross-owner-transfers-5ig0bn`) |

*D1 is inert at `RLS_MODE=off`/`shadow` (the app connects as the table owner, so policies are not consulted); on an enforcing deployment its read arm is live on deploy -- read-only widening gated on an active `can_read` grant, matching the delegated access the app layer already grants. See the D1 task details.

**Why A2 (guard + plumbing) precedes the T tasks:** the transfer service methods gain an optional actor parameter with a same-owner default; landing the plumbing first means each T task changes service internals against an already-stable signature, and the guard relaxation is inert until a service accepts a cross-owner request (which only T1/T2 introduce).

---

## Task details

### A1 -- CrossOwnerAccessService

**Files:** `backend/src/delegation/cross-owner-access.service.ts` (new), `cross-owner-access.service.spec.ts` (new), `backend/src/delegation/delegation.module.ts` (provider + export), `backend/eslint.config.mjs` (`WITH_CONTEXT_ALLOWLIST` entry for the new service).

Implement per Phase 1 of the design doc. Inject `DataSource` only; all reads via `withScopedDb`; cross-tenant owner lookups (reading a foreign `accounts` row to learn its owner) wrapped in `withSystemContext` with a comment marking them authorization-decision reads. Importing `common/db/with-context` is lint-restricted (RLS task L1), so the allowlist entry is part of this task, not an afterthought.

- `accountAccessFor(realUserId, accountId, op: 'read'|'create'|'edit'|'delete')` -> `{ account, ownerUserId, via: 'own'|'delegation' }`. Order of decisions: account exists -> owned by realUserId -> `via: 'own'`; else active delegation from account owner to realUserId with `can_read` grant row -> op flag check -> `via: 'delegation'` or Forbidden (`errors.delegation.accountOperationNotGranted`); else NotFound (never confirm existence).
- `readableAccountIdSetFor(realUserId)` -> `Set<string>`: own account ids + `can_read`-granted ids across all active delegations where realUserId is the delegate.
- `isAccountOwnedBy(accountId, userId)`.

**Acceptance:** unit spec covers the full grant matrix (own / granted-with-op / granted-read-only -> 403 / no-grant -> 404 / nonexistent -> 404 / revoked delegation -> 404 / pending delegation -> 404). Nothing calls the service yet (inert). Lint clean, with the allowlist entry as the only eslint change.

### A2 -- Guard relaxation + actor plumbing

**Files:** `backend/src/delegation/guards/account-delegate.guard.ts` + spec, `backend/src/transactions/transactions.controller.ts`, `backend/src/transactions/transactions.service.ts`, `backend/src/transactions/transaction-transfer.service.ts` (signatures only).

- Guard: in the transfer-body, transfer-param, and scheduled-write blocks **only**, skip `assertPermission` when the account is owned by `payload.sub`. (Needs an ownership probe -- use A1's `isAccountOwnedBy`.) Do **not** touch the `@DelegatedAccountParam` / `@DelegatedTransactionParam` blocks.
- Plumbing: transfer endpoints pass `{ effectiveUserId: req.user.id, realUserId: req.user.realUserId ?? req.user.id }` into the service wrappers; `TransactionTransferService` methods accept an optional actor defaulting to `{ effectiveUserId: userId, realUserId: userId }`. No behavior change yet.

**Acceptance:** guard spec proves (a) own-account bypass works in the three relaxed blocks, (b) `@DelegatedAccountParam` still blocks a delegate's own account, (c) same-owner delegate checks unchanged. All existing transfer tests green untouched.

### T1 -- createTransfer cross-owner

**Files:** `backend/src/transactions/transaction-transfer.service.ts` + spec.

Per Phase 2: `accountAccessFor(realUserId, ..., 'create')` for both accounts; each leg written with `userId: account.userId`; cross-owner atomic block under `withSystemContext(() => withScopedDb(...))`; category/payee applied to effective-user legs only; per-owner `triggerNetWorthRecalc`; per-owner action history with the i18n "Shared account" label on the counterpart owner's entry. Authorization is fully decided **before** the system-context window; nothing user-controlled selects rows inside it beyond the validated leg ids.

**Acceptance:** unit spec: cross-owner create writes correct per-leg `user_id` and balances; category/payee land only on effective-user legs; two history records with masked counterpart name; same-owner path produces byte-identical writes to before (snapshot the manager calls).

### T2 -- update/remove/linked cross-owner + frozen link

**Files:** `transaction-transfer.service.ts` + spec, `transactions.service.ts` (`loadLegById` callback), i18n `backend/src/i18n/locales/en/errors.json` (`errors.transactions.crossOwnerTransferLocked`).

Per Phase 2 and the frozen-link spec: `loadLegById` fallback when the scoped `findOne` misses; connected cross-owner edits mirror per the sync-semantics table (status NOT mirrored, category/payee/tags effective-user legs only); frozen links allow presentational own-leg edits, reject amount/date/account-move with `crossOwnerTransferLocked`; account moves on cross-owner transfers always rejected; frozen delete removes own leg only and reverses own balance; `getLinkedTransaction` returns the connected counterpart via `loadLegById`, `null` when unreadable.

**Acceptance:** unit spec covers the full sync-policy matrix, the frozen lock, own-leg delete (counterpart detached, balance untouched), and 403-vs-404 routing. Pseudo-locale regenerated.

### T3 -- Wrappers, bulk, AI prep

**Files:** `transactions.service.ts` (create/update wrappers), `transaction-bulk-update.service.ts` + spec, `backend/src/transactions/transaction-tool-prep.service.ts` + spec, i18n `en/errors.json`.

- Wrappers: skip `setTransactionTags` for legs whose `userId !== effectiveUserId`.
- Bulk: filter linked ids to same-user legs in `classifyTransferLegs` so `syncTransferTags` never writes tags onto a foreign leg (`syncLinkedTransfers` is already user-filtered -- verify, don't change).
- AI prep: detect an existing cross-owner transfer in preview-update/delete (scoped counterpart `findOne` miss + `linkedTransactionId` present) -> i18n error. One change covers AI executor and MCP (shared prep service, per the `CLAUDE.md` shared-AI-tools rule).

**Acceptance:** unit specs for all three; bulk spec proves a mixed batch updates own legs and skips foreign tag writes; AI spec proves both surfaces get the same refusal.

### M1 -- Mask util + generalized interceptor + /linked

**Files:** `backend/src/delegation/transfer-mask.util.ts` (new) + spec, `delegate-transfer-mask.interceptor.ts` + spec, `transactions.controller.ts` (`/linked` route wiring only if needed).

Per Phase 3: extract `maskTransactionsAgainst(readableSet, payload)`; interceptor runs for all authenticated users with the load-bearing fast path (no DB hit unless acting OR a row has `isTransfer && linkedTransaction && linkedTransaction.userId !== row.userId`); `readableAccountIdSetFor(realUserId)` as the readable set (delegates keep seeing their own counterpart accounts).

**Acceptance:** interceptor spec proves (a) non-acting user with no cross-owner rows -> zero delegation-service calls (fast path), (b) post-unshare `findOne` masks account name, balance and auto payee, (c) acting-delegate behavior unchanged. `/linked` returns connected counterpart, `null` when unreadable.

### M2 -- Export + AI/MCP read masking

**Files:** `backend/src/accounts/account-export.service.ts` + spec, AI/MCP shared read path (locate the transaction read used by AI tools; apply the mask helper there) + spec.

**Acceptance:** export spec proves `transferAccountName` and auto payee are masked post-unshare and unchanged for readable counterparts; AI read spec ditto. No masking applied to same-owner rows (fast path).

### F1 -- transfer-candidates endpoint

**Files:** `backend/src/accounts/accounts.controller.ts` + spec, `cross-owner-access.service.ts` (`transferCandidatesFor`), DTO/response type.

`GET /accounts/transfer-candidates`, `@AllowDelegate`: own context -> accounts shared to the real user (active, `can_read`) with `{ id, name, currencyCode, accountType, accountSubType, isClosed, ownerLabel, canCreate, canEdit, canDelete }`; acting context -> the real user's own accounts, flags all true. Static route declared before `:id` routes (existing controller convention).

**Acceptance:** controller spec covers both contexts + empty results; endpoint leaks nothing beyond the listed fields (no balances).

### F2 -- Frontend transfer form

**Files:** `frontend/src/lib/accounts.ts`, `frontend/src/components/transactions/TransactionForm.tsx`, `TransferTransactionFields.tsx` + `TransferTransactionFields.test.tsx`, `frontend/src/i18n/messages/en/transactions.json`.

Per Phase 4: fetch candidates alongside the account list; grouped dropdown entries via the existing `__separator__` pattern; filter by `canCreate` / `canEdit` per mode; frozen counterpart (hiddenAccountOption) disables From/To/Amount/Date. English catalog + `npm run i18n:pseudo`.

**Acceptance:** component tests (grouped options render, grant filtering, disabled frozen state); `npm run test` green incl. ui-conventions guard; `npm run i18n:check` clean.

### D1 -- Migration + index

**Files:** `database/migrations/<next>_cross_owner_transfer_rls.sql` (new), `database/schema.sql`, `backend/test/integration/rls-enforcement.integration.spec.ts`.

Per Phase 5: dedicated `transactions_isolation` policy with the delegate-read arm (WITH CHECK stays owner-only); `idx_adg_account` on `account_delegate_grants(account_id)`; `transactions` removed from the direct-ownership policy loop in `schema.sql`. Fully idempotent (`DROP POLICY IF EXISTS`, `CREATE INDEX IF NOT EXISTS`). Ship an idempotent `ALTER TABLE transactions ENABLE ROW LEVEL SECURITY` even though `transactions` is already enabled (`123_rls_enable.sql` on migrated databases, `schema.sql`'s dynamic enable loop on fresh installs): the post-`123` "ship your own ENABLE" convention applies to every post-`123` policy migration, and `rls-harness.integration.spec.ts` derives that expectation from disk and fails without it. Extend the enforcement spec for the new arm: positive case (active `can_read` grant exposes the granted account's transactions to the delegate's own session), negative case (absent or revoked grant hides them), and keep the per-table sweep + delegation-semantics block green. The T1 integration harness needs no registration -- its content-based selector picks up any migration referencing the policy helper functions.

**Acceptance:** `npm run migration:lint` + `scripts/verify-schema.sh` + `rls-enforcement.integration.spec.ts` clean. Behavior-neutral at `RLS_MODE=off`/`shadow` (app connects as the table owner); under `enforce` the read arm is live on deploy -- read-only widening gated on an active `can_read` grant, matching the app-layer delegated access that already exists.

### Q1 -- Integration suite

**Files:** `backend/test/integration/cross-owner-transfers.integration.spec.ts` (new); extend `transfers.integration.spec.ts` only if a same-owner regression case is missing.

Scenarios (two real users + delegation fixtures): create from own context and acting context with correct per-leg `user_id` and balances; missing grant -> 403, no read -> 404; unshare -> both users keep legs, `findOne`/export masked, structural edit blocked, presentational edit works; **reshare -> full cross-leg edit works with no writes in between** (the stateless reconnect proof); frozen delete detaches counterpart; revoke never deletes a delegate who owns accounts; cross-owner split/scheduled/bulk attempts fail closed.

### Q2 -- Playwright e2e

**Files:** `e2e/tests/delegation.spec.ts`.

One journey: A shares with B (create+edit) -> B transfers B -> A from own context -> balances verified both sides -> A revokes -> B sees "Hidden account" + frozen lock -> A re-shares -> B edits amount, both legs update. Respect CI conventions (`--workers=1` for full-suite runs).

### Q3 -- Full-locale i18n pass

**Files:** all locale catalogs touched by T2/T3/F2 strings, frontend + backend.

Single localization pass filling every supported locale for the keys added on this branch; parity tests green; `npm run i18n:pseudo` regenerated. Final commit before acceptance.
