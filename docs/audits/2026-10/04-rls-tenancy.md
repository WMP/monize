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

### A26-S04-01 -- Grantee and cross-owner writes are authorized in earlier transactions and written under the system bypass without a re-check, so a write lands in the owner's ledger after the owner's revoke has committed

1. **Severity:** MEDIUM. A cross-tenant write by a principal whose authority was withdrawn and committed before the write; the window is one request's latency (it includes an FX provider call on a cross-currency transfer), and the owner, not the grantee, chooses when to revoke. Not HIGH because nobody can widen or time the window against the owner.
2. **Confidence:** high (executed).
3. **Location:** `backend/src/transactions/transaction-transfer.service.ts:516-545` (`createTransfer`: `prepareTransfer` then `writeTransferLegs`), `:645-749` (`prepareTransfer`, authorization at `:689-702` through `CrossOwnerAccessService.accountAccessFor`, each in its own `withScopedDb`, `backend/src/delegation/cross-owner-access.service.ts:66-110`), `:761-940` (`writeTransferLegs`, `withSystemContext(withScopedDb(writeLegsAtomically))` at `:911-920`, no authorization inside), `:641-643` (the comment that rationalises it). Same shape: `backend/src/transactions/joint-register.service.ts:58-153` (`create` / `update` / `remove` / `markCleared`: `jointAccessFor` then `withSystemContext(transactionsService.*)`), `backend/src/categories/joint-categories.service.ts:51-72`, and the cross-owner update / delete branches `transaction-transfer.service.ts:1590-1637, 2044-...` (authorization before the system transaction; to be traced by S07).
4. **Violated invariant:** AGENTS.md "Transactions (CRITICAL)": every check that can refuse (ownership, tenant identity, precondition) runs inside the same transaction as the mutation, under the same lock where concurrency matters. For a grantee, "the grant is active" is that check; `docs/specs/joint-accounts.md` W2 ("freeze on revoke") assumes it.
5. **Realistic reproduction scenario:** Alice shares "A chequing" with Bob (joint, `can_create`). Bob submits a 700.00 transfer from his "B savings" to "A chequing". While Bob's request is between `prepareTransfer` and `writeTransferLegs` (for a cross-currency pair this includes the rate lookup), Alice revokes Bob. Executed under `monize_app` with `RLS_MODE=enforce` (barrier between the two calls, timing only): `{"delegationsAfterRevoke":0,"err":"Transaction with ID 85eb2589-... not found","legsInA":[{"amount":700,"owned_by_a":true}],"aBalance":5700}`.
6. **Observed:** the delegation is gone, then both legs commit under the bypass; Alice's balance moves from 5000.00 to 5700.00; Bob's request then fails in the post-commit read-back (`completeTransfer` -> `findOne(toOwnerId, ...)` under Bob's own scope can no longer see Alice's leg), so Bob is told the transfer failed although it is in both ledgers.
7. **Expected:** once the revoke commits, Bob's write is refused and nothing is written; if the write commits first, the revoke follows it and Bob is told it succeeded.
8. **Impact:** data integrity and security: a 700.00 movement (100 percent of the transfer) in another tenant's ledger after the owner withdrew consent, attributed to a delegate who no longer exists in the owner's list; the actor receives an error for a committed write and may re-enter it by another route. Same for a joint-register edit or delete racing an owner's revoke or the owner moving the row to an unshared account (`update` authorizes on the row's account read in `loadRowById`, then updates by id under the bypass).
9. **Root cause:** the write identity (system bypass) is a different identity from the authorization identity (the grantee), and `withScopedDb` refuses to join across identities (`scoped-db.ts:165-180`), so the code decides first and writes later, in two transactions, and never re-reads the grant inside the bypass transaction; nothing locks the `account_delegates` row against the revoke's `DELETE`.
10. **Recommended correction:** inside the system-context write transaction, re-read the delegation and grant that authorized the request with `FOR SHARE` (the revoke's `DELETE` then waits for the write or the write sees the row gone), refuse with the same 404/403 when it is absent or no longer grants the operation, and only then write. Apply it once in a helper on `CrossOwnerAccessService` taking the transaction's `EntityManager`, called from `writeLegsAtomically`, the cross-owner update/delete transactions, and the joint-register / joint-categories bypass bodies.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/delegation/cross-owner-access.service.ts
+++ b/backend/src/delegation/cross-owner-access.service.ts
@@
+  /**
+   * Re-assert, inside the write's own transaction, the grant `accountAccessFor`
+   * found earlier. FOR SHARE on the delegation row makes a concurrent revoke
+   * (a DELETE) wait for this transaction, or makes this read see it gone.
+   * Runs on the caller's manager, so under the system bypass of the write.
+   */
+  async assertGrantStillHeld(
+    m: EntityManager,
+    realUserId: string,
+    accountId: string,
+    op: DelegateOperation,
+  ): Promise<void> {
+    const rows: Array<GrantFlags> = await m.query(
+      `SELECT g.can_create AS "canCreate", g.can_edit AS "canEdit",
+              g.can_delete AS "canDelete"
+         FROM account_delegates d
+         JOIN account_delegate_grants g ON g.delegation_id = d.id
+         JOIN accounts a ON a.id = g.account_id AND a.user_id = d.owner_user_id
+        WHERE d.delegate_user_id = $1 AND g.account_id = $2
+          AND d.status = 'active' AND g.can_read
+          FOR SHARE OF d, g`,
+      [realUserId, accountId],
+    );
+    if (rows.length === 0) throw this.accountNotFound(accountId);
+    if (!this.grantAllows(rows[0], op)) {
+      throw new ForbiddenException(/* same tr(...) as accountAccessFor */);
+    }
+  }
--- a/backend/src/transactions/transaction-transfer.service.ts
+++ b/backend/src/transactions/transaction-transfer.service.ts
@@ const writeLegsAtomically = async (m: EntityManager): Promise<WrittenTransfer> => {
+      if (hasForeignLeg) {
+        for (const [accountId, ownerId] of [
+          [fromAccountId, fromOwnerId],
+          [toAccountId, toOwnerId],
+        ] as const) {
+          if (ownerId !== prepared.realUserId) {
+            await this.crossOwnerAccess.assertGrantStillHeld(
+              m, prepared.realUserId, accountId, "create",
+            );
+          }
+        }
+      }
       if (externalId) {
--- a/backend/src/transactions/joint-register.service.ts
+++ b/backend/src/transactions/joint-register.service.ts
@@ (create / update / remove / markCleared)
-    return withSystemContext(() =>
-      this.transactionsService.update(access.ownerUserId, transactionId, dto, {
+    return withSystemContext(() =>
+      withScopedDb(this.dataSource, async (m) => {
+        await this.crossOwnerAccess.assertGrantStillHeld(m, realUserId, row.accountId, "edit");
+        // and re-read the row's account inside m (an owner move to an
+        // unshared account must refuse), then:
+        return this.transactionsService.update(access.ownerUserId, transactionId, dto, {
```

    The joint-register half joins `TransactionsService`'s own `withScopedDb` (same system identity, so the nested call joins), which keeps the re-check and the write in one transaction.
12. **Recommended regression test:** under `createEnforcedIntegrationModule`, a barrier between authorization and write (as in the probe), revoke in the gap, assert no leg in the owner's account and the owner's balance unchanged; the same for a joint-register update after the owner moves the row out of the joint account.
13. **Suggested regression-test diff (illustrative, not applied):** add to `test/integration/cross-owner-transfers.integration.spec.ts` a `describe("under enforcement")` block on `createEnforcedIntegrationModule([TransactionsModule])` with the probe's case: `jest.spyOn(transfers, "writeTransferLegs")` gated on a promise, `revokeDelegate` in the gap, then `expect(legsInA).toEqual([])` and `expect(balance).toBe(5000)`; it fails at the baseline with `legsInA.length === 1` and balance 5700.
14. **Verification method:** the regression test above (fails on the baseline, as executed); `cross-owner-transfers` and `joint-accounts` suites green; a second variant where the write commits first and the revoke follows (expect success and a revoked delegation).
15. **Residual risks / patch limitations:** `FOR SHARE` makes revoke wait for in-flight writes (bounded by one request); `revokeDelegate` must keep taking its `DELETE` lock in the same order (delegation row first) to avoid a new deadlock; the cross-owner update/delete paths were sampled, not traced line by line (S07).

Causality: `NEW_SINCE_UPSTREAM_AUDIT` (joint accounts and cross-owner transfers, plan section 5). Surfaces (Rule 7): cross-owner transfer create, update, delete; joint-register create, update, remove, mark-cleared; joint category create. Invariant ID: none in the index (section 11).

### A26-S04-02 -- Delegation management reads in one transaction and writes back the stale entity with a whole-entity `save` in another: a revoked delegation is re-inserted, and an owner rotates a login another owner has just linked

1. **Severity:** MEDIUM. Two security decisions (revocation is final; an owner may rotate only its own pure delegate's credentials) are undone by an ordinary race, executed under the unprivileged role; each needs two requests inside a short window.
2. **Confidence:** high (executed, both instances).
3. **Location:** `backend/src/delegation/delegation.service.ts:940-970` (`setSectionGrants`: `scoped(findOne)` then `scoped(save)`), `:972-1006` (`setCapabilities`, same), `:1465-1544` (`resetDelegatePassword`: `systemScoped(findOne)` at `:1484`, `canOwnerResetDelegatePassword` in its own system transaction at `:1502` / `:763-787`, bcrypt, `systemScoped(save)` at `:1523`); the racing writers `:1309-1373` (`revokeDelegate`, hard `DELETE`) and `:1110-1261` (`createDelegate` link, no lock on the `users` row it reads by email).
4. **Violated invariant:** a revoked delegation stays revoked; `resetDelegatePassword` refuses once any other owner has a delegation to the login (the rule its own comment and `createDelegate`'s `delegateOfAnotherOwner` state); AGENTS.md "a rejected command must not already have written ... under the same lock".
5. **Realistic reproduction scenario:** (a) Alice toggles "may create categories" for delegate Bob and, before that request finishes, clicks Revoke in another tab. (b) Alice resets the password of Dave, her pure delegate, while Bob (another owner) adds `dave@...` as his delegate. Both executed under `monize_app` with a barrier between the read and the write (timing only, the spies call through):
   - (a) `{"afterRevoke":[],"afterSave":[{"id":"ded6fbf1-...","status":"active","categories_can_create":true}],"err":null,"sameId":true}`
   - (b) `{"checkAfterLink":false,"resetReturnedPassword":true,"err":null,"passwordChanged":true,"activeOwners":2}`
6. **Observed:** (a) the revoke deletes the row, then TypeORM's `save` finds no row by id and INSERTs the snapshot, so the same delegation id is back with `status = 'active'` and its capability flags (its account grants stay deleted, by cascade); Bob can switch into Alice's context again, read her categories, payees and tags (the policy arm needs only an active delegation, `schema.sql:3696-3724`) and use any section flags that were on. (b) the check passed before Bob's link, the write landed after it, and Alice now holds a temporary password for a login that also opens Bob's shared data; the check, rerun after the link, answers `false`.
7. **Expected:** (a) the capability update affects zero rows and returns 404 after a revoke; (b) the reset is refused, or Bob's link waits for the reset and then makes the next reset refuse.
8. **Impact:** security: revoked access silently restored (a); a cross-owner credential takeover by the first owner (b). Also, from the same root cause, two settings saves on one delegation overwrite each other's columns.
9. **Root cause:** whole-entity `save` of an entity read in an earlier transaction, with no row lock and no predicate on the expected state; TypeORM reloads by id, writes every differing column and inserts when the row is gone. This is the concurrent instance of S03's D-S03-01 (handed to this session).
10. **Recommended correction:** for the flag setters, one conditional `UPDATE ... WHERE id = $1 AND owner_user_id = $2` of only the changed columns, refusing on zero affected rows; for the reset, one system transaction that locks the delegate's `users` row `FOR UPDATE` and the delegate's `account_delegates` rows `FOR SHARE`, runs the "no other owner" check, and writes the credential columns with `update`, not `save`; `createDelegate`'s link reads the existing user `FOR UPDATE` so the two serialize.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/delegation/delegation.service.ts
+++ b/backend/src/delegation/delegation.service.ts
@@ async setCapabilities(ownerUserId, delegationId, caps) {
-    const delegation = await this.scoped(AccountDelegate, (repo) =>
-      repo.findOne({ where: { id: delegationId, ownerUserId } }),
-    );
-    if (!delegation) { throw new NotFoundException(...); }
-    for (const [key, value] of Object.entries(caps)) {
-      if (value !== undefined) { (delegation as ...)[key] = value; }
-    }
-    await this.scoped(AccountDelegate, (repo) => repo.save(delegation));
+    const patch = Object.fromEntries(
+      Object.entries(caps).filter(([, v]) => v !== undefined),
+    );
+    const result = await this.scoped(AccountDelegate, (repo) =>
+      repo.update({ id: delegationId, ownerUserId }, patch),
+    );
+    if (!result.affected) { throw new NotFoundException(...); }
   }
   // setSectionGrants: the same change.
@@ async resetDelegatePassword(ownerUserId, delegationId) {
-    const delegate = await this.systemScoped(User, (repo) => repo.findOne(...));
-    ...
-    if (!(await this.canOwnerResetDelegatePassword(delegate.id))) { throw ... }
-    ...
-    await this.systemScoped(User, (repo) => repo.save(delegate));
+    const temporaryPassword = generateReadablePassword();
+    const hash = await bcrypt.hash(temporaryPassword, this.BCRYPT_ROUNDS);
+    await withSystemContext(() => withScopedDb(this.dataSource, async (m) => {
+      const [d] = await m.query(
+        `SELECT u.id, u.oidc_subject FROM users u WHERE u.id = $1 FOR UPDATE`,
+        [delegation.delegateUserId]);
+      if (!d) throw new NotFoundException(...);
+      if (d.oidc_subject) throw new BadRequestException(...);
+      await m.query(
+        `SELECT 1 FROM account_delegates WHERE delegate_user_id = $1 FOR SHARE`,
+        [d.id]);
+      // canOwnerResetDelegatePassword's predicates, evaluated on m
+      if (!(await this.ownerMayResetOn(m, d.id))) throw new ForbiddenException(...);
+      await m.getRepository(User).update({ id: d.id }, {
+        passwordHash: hash, mustChangePassword: true, resetToken: null,
+        resetTokenExpiry: null, failedLoginAttempts: 0, lockedUntil: null,
+      });
+      await m.getRepository(RefreshToken).update({ userId: d.id, isRevoked: false }, { isRevoked: true });
+      await revokeStandingCredentials(m, d.id);
+    }));
@@ createDelegateWithinContext: inside the transaction
-      let delegateUser = await manager.findOne(User, { where: { email } });
+      let delegateUser = await manager.findOne(User, {
+        where: { email }, lock: { mode: "pessimistic_write" },
+      });
```

    `ownerMayResetOn(m, id)` is `canOwnerResetDelegatePassword`'s body taking the manager; bcrypt moves before the transaction so the lock is not held across it. The same "update, not save" change applies to the other D-S03-01 rows listed in section 12.
12. **Recommended regression test:** under `createEnforcedIntegrationModule([DelegationModule])`, the two probe cases: revoke between the capability read and write (expect zero rows after), and a second owner's link between the reset's check and write (expect the hash unchanged or a 403).
13. **Suggested regression-test diff (illustrative, not applied):** a new `test/integration/delegation-management.integration.spec.ts` with the probe's cases (the spy on the private `scoped` is replaced, after the fix, by a two-pool barrier: pool 1 opens the reset transaction and holds the `users` lock; pool 2's `createDelegate` must block until pool 1 commits). Both fail at the baseline as quoted in field 5.
14. **Verification method:** the two tests; `delegation.service.spec.ts` updated for `update` instead of `save`; `joint-accounts`, `cross-owner-transfers` green.
15. **Residual risks / patch limitations:** the sweep in section 12 lists 32 read-then-`save` sites, 26 across transactions, most on `users`; this finding covers the delegation ones only, the auth and admin ones are handed back (section 12); a lock on `users` rows during reset adds contention with login for the same user only.

Causality: `PRE_EXISTING_UNREPORTED` for `resetDelegatePassword` (the upstream audit cites `delegation.service.ts` management paths, P2-007) and, for the capability setters, not determinable in this shallow clone (plan ledger: `d5cea9bf` is unreachable); classified `PRE_EXISTING_UNREPORTED` with that caveat. Disposes of D-S03-01 for the delegation and RLS paths (section 5).

### A26-S04-03 -- The `account_delegates` and `account_delegate_grants` policies let a delegate-side session issue itself a delegation from any owner, which the joint read arms then turn into a read of that owner's accounts and transactions

1. **Severity:** MEDIUM. RLS is the documented containment for "the query that forgets to" filter (`docs/row-level-security-contract.md` section 1); this policy does not contain one, and the escalation is cross-tenant. Not HIGH because no current application path inserts into either table under a delegate's own identity with a request-chosen owner (all writers listed in section 12), so it needs a second defect (an injection or a mistaken query) to be reached.
2. **Confidence:** high (executed at the policy level).
3. **Location:** `database/schema.sql:4111-4118` (`account_delegates_isolation`, mirrored from `database/migrations/114_rls_policies_special.sql:51`), `database/schema.sql:4076-4086` (`account_delegate_grants_isolation`, from `113_rls_policies_indirect.sql:238`); the read arms that consume them, `schema.sql:3651-3724` (`transactions`, `accounts`, `monthly_account_balances`, `categories`, `payees`, `tags`) and the indirect splits/tags arms.
4. **Violated invariant:** only an owner (current identity) can create a delegation that grants access to its own data; a policy's WITH CHECK must not admit a row the caller could not legitimately create.
5. **Realistic reproduction scenario:** any statement run in Mallory's own session (current = real = Mallory) that inserts into `account_delegates` with a chosen `owner_user_id`. Executed as `monize_app` with Mallory's GUCs, inside `withScopedDb`, rolled back afterwards: `{"before":0,"insertedDelegation":true,"insertedGrant":true,"victimAccountsVisible":["Victim savings"]}`.
6. **Observed:** the INSERT passes WITH CHECK through the `delegate_user_id = app_real_user_id()` arm; the grant INSERT passes through `ad.delegate_user_id = app_real_user_id()` (the FK to `accounts` is checked without RLS, so any account id works); the next SELECT shows the victim's account through the `accounts` joint read arm, and the same arms expose `transactions`, `monthly_account_balances`, `categories`, `payees`, `tags`, splits and transaction tags.
7. **Expected:** `new row violates row-level security policy` on the first INSERT.
8. **Impact:** security: one statement turns any database-reachable defect in a delegate-side code path into a read of any tenant's ledger, defeating the layer whose purpose is to contain such a defect. Also an application-level escalation if a row so written is later trusted by `validateActingContext` (it reads `account_delegates` by id and checks only status, delegate and owner, `delegation.service.ts:192-238`).
9. **Root cause:** one policy (USING and WITH CHECK identical) for every command; the delegate arm is needed for SELECT (the delegate lists its own delegations) and DELETE-side reads, but was also given to INSERT and UPDATE.
10. **Recommended correction:** keep the delegate arm in USING; make WITH CHECK owner-only (`owner_user_id = app_current_user_id() OR app_bypass_rls()`) on `account_delegates`, and `ad.owner_user_id = app_current_user_id()` only on `account_delegate_grants`. Every current writer is an owner-scoped or system transaction (section 12), so nothing legitimate is refused.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- /dev/null
+++ b/database/migrations/20261021120000_delegation_policies_owner_only_check.sql
+-- Delegation rows are issued by their owner only: keep the delegate's read
+-- arm in USING, drop it from WITH CHECK (A26-S04-03).
+DROP POLICY IF EXISTS account_delegates_isolation ON account_delegates;
+CREATE POLICY account_delegates_isolation ON account_delegates
+  USING (owner_user_id = (SELECT app_current_user_id())
+      OR delegate_user_id = (SELECT app_real_user_id())
+      OR (SELECT app_bypass_rls()))
+  WITH CHECK (owner_user_id = (SELECT app_current_user_id())
+      OR (SELECT app_bypass_rls()));
+
+DROP POLICY IF EXISTS account_delegate_grants_isolation ON account_delegate_grants;
+CREATE POLICY account_delegate_grants_isolation ON account_delegate_grants
+  USING ((SELECT app_bypass_rls()) OR EXISTS (
+    SELECT 1 FROM account_delegates ad
+    WHERE ad.id = account_delegate_grants.delegation_id
+      AND (ad.owner_user_id = (SELECT app_current_user_id())
+        OR ad.delegate_user_id = (SELECT app_real_user_id()))))
+  WITH CHECK ((SELECT app_bypass_rls()) OR EXISTS (
+    SELECT 1 FROM account_delegates ad
+    JOIN accounts a ON a.id = account_delegate_grants.account_id
+                   AND a.user_id = ad.owner_user_id
+    WHERE ad.id = account_delegate_grants.delegation_id
+      AND ad.owner_user_id = (SELECT app_current_user_id())));
--- a/database/schema.sql
+++ b/database/schema.sql
@@ (the same two policies, lines 4076-4086 and 4111-4118)
```

    The grants WITH CHECK also requires the account to belong to the delegation's owner, which the FK cannot express.
12. **Recommended regression test:** in `rls-enforcement.integration.spec.ts`, as a delegate session: INSERT `account_delegates` naming another owner -> `42501`; INSERT a grant on a delegation the session is only the delegate of -> `42501`; as the owner, a grant on another owner's account -> `42501`.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+  it("a delegate cannot issue itself a delegation or a grant", async () => {
+    await expect(asUser(mallory, (m) => m.query(
+      `INSERT INTO account_delegates (owner_user_id, delegate_user_id, status)
+       VALUES ($1, $2, 'active')`, [victim, mallory]))).rejects.toThrow(/row-level security/);
+  });
```

14. **Verification method:** the test above fails at the baseline (executed equivalent quoted in field 5) and passes after; `scripts/verify-schema.sh`; `migration:lint`; the enforced suites (`calendar-*`, `push-hold`, `email-receipts-*`) green.
15. **Residual risks / patch limitations:** the read arms themselves still trust any active delegation whose `delegate_user_id` is the real user, including while the delegate acts for a different owner (D-S04-01); this diff closes only the issuing of such rows.

Causality: `PRE_EXISTING_UNREPORTED` (the WITH CHECK is migration 114's); amplified by the read arms of migrations 132 and 134 (`EXPOSED_OR_AMPLIFIED` in Rule 3's terms).

### A26-S04-04 -- No test runs delegation management, joint-account writes or cross-owner transfers on the unprivileged role, and a policy mutation that exposes every granted account to every user is undetected

1. **Severity:** MEDIUM (missing test on a security mechanism; A26-S04-01 to -03 are all invisible to the current suites for this reason).
2. **Confidence:** high (executed mutation, section 6).
3. **Location:** `backend/test/integration/joint-accounts.integration.spec.ts:138`, `cross-owner-transfers.integration.spec.ts:122` (both `createIntegrationModule`, the owner role, RLS not applied to the module's connection); no integration spec calls `createDelegate`, `delegateEmailExists`, `resetDelegatePassword`, `setCapabilities` or `setSectionGrants` (the only callers are `revokeDelegate` in the two owner-role suites); `rls-enforcement.integration.spec.ts` checks the catalog and sampled reads, not the delegate arms.
4. **Violated invariant:** `docs/verification-contract.md`: a mock proves the call, not the property; the RLS contract's guarantee needs a test on the role it is about.
5. **Realistic reproduction scenario:** mutation MA (section 6): drop `AND d.delegate_user_id = (SELECT app_real_user_id())` from the `accounts` read arm in `134_joint_native_read_rls.sql:47`, so every account carrying any active grant is readable by every user; result `Tests: 175 passed, 175 total` over `rls-*`, `security-cross-user-isolation`, `joint-accounts`, `cross-owner-transfers`, `calendar-day-notes`, `calendar-read-models`.
6. **Observed:** green.
7. **Expected:** at least one failure.
8. **Impact:** a regression of the tenant boundary on the shared-account surface ships green.
9. **Root cause:** the two feature suites predate or bypass `createEnforcedIntegrationModule`; `rls-enforcement` is catalog-driven and has no case for the joint arms.
10. **Recommended correction:** run `joint-accounts` and `cross-owner-transfers` (or a second describe block of each) on `createEnforcedIntegrationModule`, add a delegation-management suite on it, and add cross-tenant negative reads for the joint arms to `rls-enforcement`.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/test/integration/joint-accounts.integration.spec.ts
+++ b/backend/test/integration/joint-accounts.integration.spec.ts
-    module = await createIntegrationModule([
+    harness = await createEnforcedIntegrationModule([
       TransactionsModule, TransactionRulesModule, CategoriesModule, ...
     ]);
+    module = harness.module;
+    dataSource = harness.owner; // seeds and inspects; the module runs as monize_app
+  it("a third user sees none of the joint account under enforcement", async () => {
+    const carol = await createTestUserDirect(dataSource, { firstName: "Carol" });
+    const seen = await withUserContext(carol.id, () =>
+      withScopedDb(harness.app, (m) => m.query("SELECT id FROM accounts WHERE id = $1", [jointAccountId])));
+    expect(seen).toEqual([]);
+  });
```

12. **Recommended regression test:** the case above (fails under mutation MA).
13. **Suggested regression-test diff:** field 11.
14. **Verification method:** rerun mutation MA after the change: expect the new case to fail.
15. **Residual risks / patch limitations:** moving the suites to the enforced harness will surface any other enforce-only defects in those paths at once; that is the purpose, but it may not be one PR.

Causality: `NEW_SINCE_UPSTREAM_AUDIT` (the joint and cross-owner suites are new). Joins MON-M46 for S21.

## 5. Prior-finding dispositions

| ID | Disposition | Evidence |
| --- | --- | --- |
| MON-M06 | `FIXED_VERIFIED` | Mechanism: the cross-user halves of owner-managed delegation run under `systemScoped` / `withSystemContext` after authorization under the owner's own scope -- `delegateEmailExists` (`delegation.service.ts:1041-1060`), `createDelegate` whole (`:1077-1307`, lookup and insert in one system transaction so the unique index on `users.email` arbitrates), `revokeDelegate` (`:1309-1373`, owner-scoped lookup then one system transaction), `resetDelegatePassword` (`:1465-1544`); `users_self` is unchanged (`schema.sql` owner-column block), so arbitrary user rows stay invisible to an owner. Executed under `monize_app` with `RLS_MODE=enforce`: `{"exists":true,"linkedBob":true,"carolCreated":true,"resetOk":true,"aliceSeesBob":false,"carolDeletedOnRevoke":true,"bobKept":true,"bobPasswordUnchanged":true}`. No repository test runs these paths under the unprivileged role (section 10); the new concurrency defects in the same code are A26-S04-02. |
| MON-M14 | `FIXED_VERIFIED` | Mechanism: `runtime-role-check.ts` interrogates the serving connection (`current_user`) for `rolsuper`, `rolbypassrls`, `rolreplication`, `rolcreaterole`, `rolcreatedb`, database ownership, owned policied tables, SET-reachable exempt contexts, inherited owner roles and ten forbidden predefined roles (transitive `pg_has_role`), and `main.ts:276-287` exits on any violation before `app.listen`; `db-init.ts:147-150` runs the same template by name. Credentials and GUC emission read the same `RLS_MODE` (`app.module.ts:100`, `rls-config.ts:46`). Executed: `test/integration/runtime-role.integration.spec.ts` green in this session's run (part of the 9 suites / 180 tests), including "refuses the owner connection", the two-hop SET ROLE chain, inherited owner, REPLICATION, server-program and the catalog classification of every predefined role. Residual by design, documented in the code: the check runs at startup only, so an attribute granted to the role after boot is not seen until the next restart. |
