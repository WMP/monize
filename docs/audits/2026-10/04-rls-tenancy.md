# S04 RLS and tenancy: policies, contexts, joint accounts, cross-owner transfers

## 1. Metadata

| Field | Value |
| --- | --- |
| Session | S04 (parallel wave, run by orchestrator session `session_018Nx7aian3f7dpRX5msjFBg`) |
| `AUDIT_BASELINE_SHA` / `PR_REVIEW_SHA` | `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86` |
| Audit branch head at start | `4adfd72f5dd74d4fa04937dd766c0d51e264bb1c` (pin check of plan step 2: empty diff outside `docs/audits/`) |
| Date | 2026-10-21 |
| Primary path | `backend/src/common/db/` |
| Secondary paths | `database/migrations/*rls*` (111-114, 118, 123, 132, 134), `database/schema.sql` (RLS section, lines 3555-4200), `backend/eslint.config.mjs` (`WITH_CONTEXT_ALLOWLIST`), `backend/src/mcp/` (bearer context seeding), every `withSystemContext` / `withDelegateContext` call site, `backend/src/delegation/`, `backend/src/transactions/transaction-transfer.service.ts`, `backend/src/transactions/joint-register.service.ts`, `backend/test/integration/rls-*.spec.ts`, `docs/row-level-security-contract.md`, `docs/backend/database-access-and-tenancy.md`, `docs/specs/joint-accounts.md`, `docs/specs/cross-owner-transfers.md` |
| Hint line | `prioritize the runtime role and enforce mode, every exempt table with its reason, system-context call sites that read cross-user data and then write under one user, joint-account grants and revocation, the per-ledger status of a cross-owner transfer, the single sanctioned direct-DataSource exception, and whether the integration suites run under the unprivileged role` |
| Protocol | `.claude/commands/audit.md`, read in full with the Read tool (1637 lines) and applied as `/audit backend/src/common/db/ -- <hint line>`; not re-loaded through the Skill tool to avoid a second copy of the same text in the context |
| Toolchain | Node 24.22.1 (`nvm use 24`); `backend/` `npm ci` OK; `dockerd` started by hand (not running in the container); PostgreSQL 16 `mirror.gcr.io/library/postgres:16-alpine` as `monize-pg` |
| Status | in-progress, remaining: mutation results, sections 6-14 final text |

Runtime executed (results quoted, full list in section 12):

- Integration, existing suites, one worker: `npm run test:integration -- 'rls-|runtime-role|joint-accounts|cross-owner-transfers|security-cross-user-isolation|schema-entity-parity'` -> `Test Suites: 9 passed, 9 total; Tests: 180 passed, 180 total`.
- Probes in the scratch worktree `<scratchpad>/mut` at `AUDIT_BASELINE_SHA` (never on the audit branch), all through `createEnforcedIntegrationModule`, so the services run on the unprivileged `monize_app` role with `RLS_MODE=enforce` (the probe logs `{"u":"monize_app"}`): `zz-audit-s04-probe.integration.spec.ts` (4 cases) and `zz-audit-s04-transfer-probe.integration.spec.ts` (1 case). Output quoted in each finding.

## 2. Invariant map

| ID | Statement | Mechanism named in code | Path |
| --- | --- | --- | --- |
| INV-RLS-001 | Enforce mode refuses a role that can bypass RLS | `assertRuntimeRoleSafe` on the serving connection (`main.ts:276-287`, exit on violation) and `assertRuntimeRoleSafeByName` in `db-init.ts:147-150`; one SQL template (`runtime-role-check.ts:255-346`) for both; `resolveRlsDatabaseAuth` throws on enforce without `DATABASE_APP_PASSWORD` (`rls-config.ts:73-89`) | env `RLS_MODE` -> `app.module.ts:100-107` credentials -> pool -> startup check -> serve. Holds (MON-M14, section 5). |
| (unnamed) tenant GUC | Every policied statement runs with the identity of the caller | `withScopedDb` sets `app.current_user_id` / `app.real_user_id` or `app.bypass_rls` as the first statements of its own transaction (`scoped-db.ts:195-231`), throws without a context (`:160-163`), refuses a nested call under a different identity (`:165-189`) | ALS context (interceptor / `withUserContext` / `withDelegateContext` / `withSystemContext`) -> `withScopedDb` -> `set_config(..., true)` -> policies `app_current_user_id()` / `app_real_user_id()` / `app_bypass_rls()` (`schema.sql:1979-1995`) |
| (unnamed) bucket completeness | Every table is direct, owner-column, indirect or exempt, exactly once | `rls-enforcement.integration.spec.ts` (catalog-driven), `rls-exempt-tables.spec.ts` (constant vs schema markers), `rls-enable.integration.spec.ts` | migration -> `pg_policies` / `relrowsecurity` -> spec |
| (unnamed) exemption | An exempt table has no owner to policy on, and its reason is written down | `RLS_EXEMPT_TABLES` (24 entries) mirrored by `-- rls-exempt:` markers; contract section 2 table | All 24 reviewed in section 12; one documentation gap (section 11) |
| (unnamed) bypass fence | A new `withSystemContext` / `withUserContext` importer is a reviewed decision | ESLint `WITH_CONTEXT_ALLOWLIST` (81 files) | 81 importing files, 81 entries, none stale, none missing (section 12) |
| (unnamed) authorization in the write | A refusal (grant, ownership) is decided in the transaction that writes, under the same lock (AGENTS.md "Transactions (CRITICAL)") | None for the system-context writes of joint accounts and cross-owner transfers: authorization is read in earlier transactions (`prepareTransfer`, `jointAccessFor`) and the bypass write does not re-check. **A26-S04-01.** | grantee request -> `accountAccessFor` / `jointAccessFor` (own tx) -> FX / payee policy (own tx, may call a provider) -> `withSystemContext(withScopedDb(write))` |
| (unnamed) revocation is final | A revoked delegation and the authority it carried stay revoked | `revokeDelegate` hard-deletes `account_delegates` (cascade to grants and acting refresh tokens) in one system transaction | **Not held against a concurrent stale `save`: A26-S04-02** (re-INSERT of the deleted row) and A26-S04-01 (write after revoke) |
| (unnamed) owner may rotate only its own pure delegate | `resetDelegatePassword` refuses once another owner has a delegation to the login | `canOwnerResetDelegatePassword` in its own transaction, then bcrypt, then whole-entity `save` in a third | **Check and write in different transactions: A26-S04-02** |
| (unnamed) delegation rows are owner-issued | Only an owner can create the delegation that grants access to its data | `account_delegates_isolation` / `account_delegate_grants_isolation` WITH CHECK | **The WITH CHECK admits `delegate_user_id = app_real_user_id()` on INSERT, so a delegate-side session can issue itself a delegation from any owner: A26-S04-03** |
| INV-TRANSFER-001 (cross-owner half) | Both legs share the VOID boundary; reconcile states are per ledger | Locked per-leg VOID transition in `updateCrossOwnerTransfer` (`transaction-transfer.service.ts:2142-2200, 2320-2390`) | Suite `cross-owner-transfers` green (owner role only; section 10). Depth with S07. |
| MON-M06 scope | Owner-managed delegation works under enforcement without widening `users_self` | `systemScoped` for the cross-user halves (`delegation.service.ts:178-183, 1053, 1077-1081, 1335-1372, 1484, 1523`), authorization first under `scoped()` | Executed under `monize_app` (section 5) |

The invariants the session block names as INV-SHARE-001..005 are not about joint accounts: in `docs/system-invariants.md:139-143` they are the PWA share-target ("a shared file reaches the server ..."). They are out of this slice's code and are handed to S18 (section 12); the joint-account invariants above are unnamed in the index (section 11).

## 3. Lens ledger

| Lens | Status |
| --- | --- |
| Pin the revision | ran: plan step 2 diff empty |
| Instructions before implementation | ran: `AGENTS.md`, root, `backend/` and `database/` `CLAUDE.md`, `docs/row-level-security-contract.md` in full, INV-RLS-001 and INV-TRANSFER-001 entries, upstream MON-M06 / MON-M14 / P2-007 / P3-010 sections, S03 report sections 1-3 and 5-14 |
| Summaries as hypotheses | ran: the comments in `prepareTransfer` ("grants are not written by the posting that follows"), `JointRegisterService` ("every check that can refuse runs before the system-context window opens") and `revokeDelegate` were each tested against a concurrent write rather than accepted (A26-S04-01, -02) |
| Invariant model | ran (section 2) |
| Change surface (producers/consumers) | ran for identity GUCs (all four helpers, 94 files mention them, 81 import them), `account_delegates` / grants writers (every `save`/`update`/`delete`/raw SQL in `src/`), `withSystemContext` write sites in delegation, transfer and joint-register services |
| Rule 4 / Rule 5 | not applicable because the slice holds no cached derived financial value; the only cached identity value (per-process `lastActivityWrite`) was covered by S03 |
| Cross-layer verification | ran: controller-level shape -> service -> transaction boundary -> policy -> role for delegation create/link/reset/revoke, cross-owner transfer create, joint register writes; frontend not in scope |
| Representation boundaries | ran: GUC unset vs empty vs non-UUID (`NULLIF(...)::uuid`, `COALESCE(... = 'on', false)`), `realUserId` absent (defaults to `userId`, `scoped-db.ts:75, 208`), system context carrying a stray `userId` (ignored, `:65-69`) |
| Browser/UI round trip | not applicable because no slice value is entered in a form; the delegate toggles and revoke are plain booleans and an id |
| Server-authoritative metadata | ran: `ownerUserId` always from the JWT (delegation controller), MCP `userId` from the bearer result (`mcp-http.controller.ts:288-460`), cross-owner leg owner from the account row, never the body |
| Identity versus value | ran: delegation id vs (owner, delegate) pair; a resurrected delegation keeps its id (A26-S04-02) |
| State machine | ran for a delegation: absent -> active -> (capabilities edited) -> deleted; re-activation in `createDelegate`; the forbidden transition deleted -> active through `save` is reachable (A26-S04-02) |
| Concurrency and idempotency | ran with execution: revoke vs capability save, reset vs second owner's link, revoke vs cross-owner transfer |
| Partial failure and compensation | ran: cross-owner create commits the money and then fails the read-back with 404 ("Transaction ... not found"), so the caller is told it failed (A26-S04-01); `resetDelegatePassword`'s post-commit OAuth revoke is S03's A26-S03-05 |
| External/provider lookup | ran (narrow): `prepareTransfer` -> `resolveTransferFx` can fetch a rate from a provider before the write; that latency is part of A26-S04-01's window |
| Database and migration | ran: every `CREATE POLICY` in `schema.sql` read against migrations 112-114, 132, 134; the harness applies the migrations, not `schema.sql` (`test/helpers/rls-setup.ts:27-160`); schema parity is S05's |
| Backup/restore | not applicable except `withPreserveTimestamps` (5 calls, 1 file, backup restore), which carries the caller's identity and no bypass (`with-context.ts:83-88`); S06 owns restore |
| Financial / loan | ran only as needed for A26-S04-01's numeric example; no calculation is in the slice |
| Authorization, authentication, RLS | ran: every hint item (sections 2, 4, 5, 12) |
| Tests are evidence | ran: which suites run as `monize_app` (23 of 101 integration files use `createEnforcedIntegrationModule`; none of `joint-accounts`, `cross-owner-transfers` or any delegation-management test does) |
| Mutation | in progress (section 6) |
| Counterexamples | ran (section 7) |
| Interaction | ran (section 7) |
| Rules 1, 2, 3, 7, 8 | ran (each finding; section 8) |
| Suggested diff + Rule 10 | ran (each finding) |
| Adversarial approval challenge | pending (section 13) |
| Final merge gate | not applicable as a PR gate (no PR); hosted CI not consulted |

## 4. Confirmed findings

(Being written; see the next commit.)

## 5. Prior-finding dispositions

| ID | Disposition | Evidence |
| --- | --- | --- |
| MON-M06 | `FIXED_VERIFIED` | Mechanism: the cross-user halves of owner-managed delegation run under `systemScoped` / `withSystemContext` after authorization under the owner's own scope -- `delegateEmailExists` (`delegation.service.ts:1041-1060`), `createDelegate` whole (`:1077-1307`, lookup and insert in one system transaction so the unique index on `users.email` arbitrates), `revokeDelegate` (`:1309-1373`, owner-scoped lookup then one system transaction), `resetDelegatePassword` (`:1465-1544`); `users_self` is unchanged (`schema.sql` owner-column block), so arbitrary user rows stay invisible to an owner. Executed under `monize_app` with `RLS_MODE=enforce`: `{"exists":true,"linkedBob":true,"carolCreated":true,"resetOk":true,"aliceSeesBob":false,"carolDeletedOnRevoke":true,"bobKept":true,"bobPasswordUnchanged":true}`. No repository test runs these paths under the unprivileged role (section 10); the new concurrency defects in the same code are A26-S04-02. |
| MON-M14 | `FIXED_VERIFIED` | Mechanism: `runtime-role-check.ts` interrogates the serving connection (`current_user`) for `rolsuper`, `rolbypassrls`, `rolreplication`, `rolcreaterole`, `rolcreatedb`, database ownership, owned policied tables, SET-reachable exempt contexts, inherited owner roles and ten forbidden predefined roles (transitive `pg_has_role`), and `main.ts:276-287` exits on any violation before `app.listen`; `db-init.ts:147-150` runs the same template by name. Credentials and GUC emission read the same `RLS_MODE` (`app.module.ts:100`, `rls-config.ts:46`). Executed: `test/integration/runtime-role.integration.spec.ts` green in this session's run (part of the 9 suites / 180 tests), including "refuses the owner connection", the two-hop SET ROLE chain, inherited owner, REPLICATION, server-program and the catalog classification of every predefined role. Residual by design, documented in the code: the check runs at startup only, so an attribute granted to the role after boot is not seen until the next restart. |
