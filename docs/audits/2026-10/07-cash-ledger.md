# S07 Cash Ledger: Transactions, Accounts, Transfers, Splits, Reconciliation

## 1. Metadata

| Field | Value |
| --- | --- |
| Session | S07 (child session_01XfUxS4dgiSNkonPgLiFnwC, orchestrator session_018Nx7aian3f7dpRX5msjFBg) |
| `AUDIT_BASELINE_SHA` | `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86` |
| `git rev-parse HEAD` | at start `7bc633477c6ffb32bd724f403dab5a541e15d923`; at the final commit, the commit carrying this file. Pin check (`git diff --stat <baseline> HEAD -- . ':!docs/audits/2026-10' ':!docs/audits/2026-08-upstream'`) empty. |
| Date | 2026-10-21 |
| Primary path | `backend/src/transactions/` |
| Secondary paths | `backend/src/accounts/`, `common/deletion-balance.util.ts`, `common/investment-filter.util.ts`, `transactions/register-order.ts`, `action-history/`, `ai/actions/ai-actions.service.ts`, `ai/query/tool-executor.service.ts`, `mcp/tools/transactions.tool.ts`, `transactions/transaction-tool-prep.service.ts`, `common/db/locks.ts` |
| Hint line | `prioritize stale-snapshot balance deltas versus atomic SQL on every mutation path (single, bulk, undo, AI, MCP, scheduled), the four-state VOID matrix on transfer legs, server-derived currency and rate on transfers, split sum and sign rules at four decimals, account closure versus a concurrent mutation, absolute recompute versus a concurrent delta, rejection before write, derived-state invalidation after commit, and the one search parser` |
| Runtime executed | Node 24.22.1 (`nvm use 24`), `npm ci` OK in `backend/`. PostgreSQL 16 in Docker (`mirror.gcr.io/library/postgres:16-alpine`; `dockerd` started by hand). Baseline integration: `transfers|transactions.integration|balance-delta-recompute|cross-owner-transfers|joint-accounts|budget-split-transfer|transaction-search|import-balance-delta`: **9 suites, 104 tests passed**. Three scratch probe specs (13 cases) in a worktree at the baseline: 10 reproduce a defect, 3 show a mechanism holding. Four mutations (section 6). Every integration run was serial (`--runInBand`), never in parallel with another. |

## 2. Invariant map

| ID | Statement | Mechanism named | Holds? |
| --- | --- | --- | --- |
| INV-BALANCE-001 | `current_balance` = opening balance + included, non-VOID, non-child, non-future ledger rows | Deltas: `applyAccountBalanceDelta` (`accounts.service.ts:166-181`, one `UPDATE ... + $1`), called through `updateBalance` (`:1425`) with `is_closed = false` in the WHERE. Old values: `lockTransactionRow(s)` (`common/db/locks.ts:265`) inside the write. Absolute: `recalculateCurrentBalance` / `applyDueTransactionBalances` take `lockAccountsForBalanceWrite` before the SUM. | **No** on four paths: split-leg and cross-owner transfer edits (A26-S07-01), account-edit undo (A26-S07-02), linked-half whole-entity save (A26-S07-07). |
| INV-TRANSFER-001 | Both legs share the VOID boundary; one balance decision per pair; reconcile states per ledger | `applyVoidTransitionToMirrorLeg`, `applyParentStatusToTransferCounterparts`, `expandTransferCounterparts`, per-leg `legVoidState` on cross-owner | **No** where the crossing is decided from a status read before the lock (A26-S07-03). Four-state matrix on cross-owner: per-leg logic correct on the reprice branch (`transaction-transfer.service.ts:2339-2348`), but the `wasVoid` inputs are snapshot reads (A26-S07-01). |
| (FIN-001 / transfer conservation) | A same-currency pair moves the same amount on both legs; a cross-currency pair carries a server-resolved rate | `resolveTransferFx` / `resolveTransferFxForUpdate` (`:228-414`) on the transfer routes | **No** on `PATCH /transactions/:id` (A26-S07-04). |
| INV-RECONCILE-001 | With the strict lock on, a RECONCILED row is not altered on any path | `assertReconciledRowsMutable` inside the write; `reconciled-lock.guard.spec.ts` lists 13 entry points | **No** on split-leg edit/delete and cross-owner edit/delete (A26-S07-05). |
| (closure) | A closed account holds zero and moves no balance | `close()` locks the row and requires zero (`accounts.service.ts:1264-1349`); `updateBalance` predicate `is_closed = false` | **No** for a pending future-dated row (A26-S07-06); the delta race MON-M20 described is fixed. |
| (split sum) | Splits of a parent sum to it at 4 dp; additions serialize | `validateSplitAmountSum`; `addSplit` locks the parent (`transaction-split.service.ts:1116`) before reading the set | Yes (Q3 executed); unit tests do not detect removing the lock (section 6). |
| INV-REGISTER-001 | One running balance per row under either direction | `applyRegisterOrder` (`register-order.ts`), `restrictToRowsNewerThanPage` | Yes (read; no finding). |
| INV-SEARCH-001..005 | One search door | `applyTransactionSearch`; `transaction-search.guard.spec.ts` | `partial` as indexed; one more door outside the guard's scope (A26-S07-08). |
| INV-CACHE-001 | A money-moving write invalidates derived state after commit | `triggerNetWorthRecalc` / `triggerDebouncedRecalc` after `withScopedDb` returns, helpers return moved accounts | Yes on the paths read; the account-undo path moves a balance with no recalc (part of A26-S07-02). |
| INV-API-001 | An API create with an `externalId` makes at most one row | unique index + `findByExternalId` | Not re-tested (S10 owns API import paths); baseline `transaction-external-id` suite not in this slice's run. |
| (authorization in the write, A26-S04-01) | A refusal runs in the writing transaction | none on cross-owner update/delete: `resolveCounterpartAccess` runs before `withSystemContext(withScopedDb(...))` (`:1597-1631`, `:2060-2457`) | **No** (S04's finding extends to update and delete, section 5). |

Material flows:

- Transfer edit: `PATCH /transactions/:id/transfer` -> `TransactionsService.updateTransfer` -> `TransactionTransferService.updateTransfer` -> dispatch on `TransactionSplit.linkedTransactionId` (split leg) / scoped `findOne` of the mirror (same owner) / `NotFoundException` (cross owner) -> `resolveTransferFxForUpdate` -> one `withScopedDb` -> `updateBalance` x2-4 -> post-commit `triggerNetWorthRecalc`. Also reached from MCP `manage_transactions` (`mcp/tools/transactions.tool.ts:1446, 1849`) and AI actions (`ai/actions/ai-actions.service.ts:505`).
- Generic edit: `PATCH /transactions/:id` (and the joint-register bypass) -> `TransactionsService.update` -> locked row -> field write -> VOID mirror if crossing -> delta on this row's account only. MCP/AI single edits refuse a transfer in `previewUpdate` (`transactions.service.ts:954`) and `transaction-tool-prep.service.ts:511`.
- Undo: `POST /action-history/undo` -> latest non-undone action -> `undoSimpleEntity` for `account` writes `beforeData` columns, `current_balance` included (`action-history.service.ts:1742-1764`, `ALLOWED_COLUMNS.accounts`).

## 3. Lens ledger

| Lens | Status |
| --- | --- |
| Pin revision | ran (section 1) |
| Instructions first | ran: `AGENTS.md`, `CLAUDE.md`, `backend/CLAUDE.md`, `backend/src/mcp/CLAUDE.md`, `docs/financial-semantics.md` sections 2 and 10-11, `docs/system-invariants.md` entries of section 2, `.claude/commands/audit.md` (loaded through `/audit`) |
| Summaries as hypotheses | ran: S02's A26-S02-01/-07/-08 and S04's A26-S04-01 and sweep were re-executed or re-traced, not accepted; code comments claiming "authorization was fully decided before entry" (`:2217`) and "safe to run before the lock" (`transaction-bulk-update.service.ts:199-203`) were tested against concurrent writes |
| Invariant model | ran (section 2) |
| Change surface / producer-consumer | ran: every caller of `updateBalance`, `recalculateCurrentBalance` and absolute `current_balance` writers (subagent sweep, spot-checked at the lines cited); routes from HTTP, bulk, undo, MCP, AI actions, scheduled post, joint register |
| Cross-layer | ran for the transfer edit, generic edit and undo flows; the frontend half (`frontend/src/types/transaction*.ts`, forms) is S19's and was read only to decide reachability (`TransactionForm.tsx:1369`) |
| Representation boundary | ran: amount presence versus value change on split-leg (`roundMoney(sign * abs)`), `wasVoid` from locked versus snapshot rows, `beforeData` as a full entity snapshot, `exchangeRate` absent versus 1 on the generic edit |
| Browser/UI round trip | not applicable as a primary lens in this slice: the forms are S19's; reachability of A26-S07-04 from the UI was checked (the transfer form uses `/transfer`) |
| Server-authoritative metadata | ran: transfer currencies from accounts (`resolveTransferFx` `:228-340`), conservation rule bypassed by the generic edit (A26-S07-04) |
| Identity versus value | ran: split leg to parent split by `linkedTransactionId`; double submit of the same value (A26-S07-01) |
| State machine | ran: VOID four-state matrix per path (section 7), close/reopen versus future rows (A26-S07-06) |
| Concurrency and idempotency | ran and executed (sections 4, 6, 12) |
| Partial failure / compensation | ran: every path read keeps the ledger write and the balance write in one `withScopedDb`; post-commit dispatch only for net-worth; the undo path records nothing it cannot reverse; no external side effect in the slice |
| External provider lookup | ran (narrow): `resolveTransferFxForUpdate` and `prewarmSplitTransferRates` call providers before the write transaction; the provider latency widens A26-S07-01/-03 windows; positive/negative caching is S13's |
| Database / migration | ran (narrow): FKs `transactions.account_id ON DELETE CASCADE`, `linked_transaction_id ON DELETE SET NULL`; no aggregate split constraint (parent lock instead); no schema change in scope |
| Backup/restore | not applicable: no backup path in the slice (S06) |
| Financial | ran: every finding carries a numerical example |
| Authorization / RLS | ran (narrow): cross-owner update/delete authorize outside the write (section 5, A26-S04-01 extension); RLS policy behaviour is S04's |
| Tests as evidence | ran (section 10) |
| Mutation | ran: 4 executed (section 6) |
| Counterexamples, interaction | ran (section 7) |
| Rejected hypotheses | ran (section 8) |
| Adversarial approval challenge | ran (section 13) |

## 4. Confirmed findings

### A26-S07-01 - Two transfer edit paths derive both balance deltas from pre-transaction snapshots (MON-H05 residual: split-transfer leg and connected cross-owner transfer)

1. **Severity:** HIGH
2. **Confidence:** high (executed, both surfaces)
3. **Location:** `backend/src/transactions/transaction-transfer.service.ts:2561-2758` (`updateSplitTransferLeg`: `counterpart` and `parentTransaction` from unlocked `findOne` at `:1710`, `:2568`; deltas at `:2702`, `:2741`; statuses at `:2594-2595`), `:2219-2472` (`updateConnectedCrossOwnerTransfer`: `oldFromAmount`/`oldToAmount` at `:2247-2248`, `fromVoid`/`toVoid` at `:2339-2348` from the rows loaded before the transaction; a row lock only when `status` is sent, `:2359`, and only on the own leg). Callers: `PATCH /transactions/:id/transfer`, MCP `manage_transactions` (`mcp/tools/transactions.tool.ts:1446, 1849`), AI actions (`ai/actions/ai-actions.service.ts:505`). Rule 7 surfaces: same-owner split leg; connected cross-owner pair (owner or grantee).
4. **Violated invariant:** INV-BALANCE-001; MON-H05 (a delta derives from the row version the write replaces); AGENTS.md "Transactions (CRITICAL)".
5. **Reproduction:** (a) chequing opening 5 000.00 holds split parent -100.00 (category -60.00, transfer -40.00), savings opening 2 000.00 holds leg +40.00; two `PATCH .../transfer {amount: 50}` together (double click, retry, two tabs). (b) Bob (grantee, edit grant) transferred 500.00 from his savings (2 000.00) to Alice's chequing (5 000.00); two `PATCH .../transfer {amount: 600}` together.
6. **Observed (executed, `zz-s07-probe` P1 and `zz-s07-probe2` Q1):** (a) both 200; chequing stored 4 880.00 vs ledger 4 890.00, savings stored 2 060.00 vs ledger 2 050.00, 5 of 5 iterations. (b) both 200; Bob's savings stored 1 300.00 vs ledger 1 400.00; Alice's chequing stored 5 700.00 vs ledger 5 600.00.
7. **Expected:** (a) 4 890.00 / 2 050.00; (b) 1 400.00 / 5 600.00 (the second request a 409 or a no-op).
8. **Impact:** persistent stored-versus-ledger divergence on two accounts, in (b) across two tenants (Alice's ledger moved by a grantee's duplicate request). Difference equals the edit's delta per duplicate: 10.00 (25 % of the leg) in (a), 100.00 (20 %) in (b). Every later delta composes on the wrong base until a recompute of that account runs.
9. **Root cause:** both branches were left out when `updateTransfer`'s same-owner path moved to "lock both legs and refuse on change" (`:1858-1903`); `derived-state-writers.guard.spec.ts` matches per file, so the same file's other locks satisfy it.
10. **Recommended correction:** inside each write transaction, lock the rows (split leg: parent then leg, the role order `locks.ts` requires; cross-owner: both legs ascending by id), derive old amounts, dates and VOID states from the locked rows, and refuse with 409 when they differ from what the request was built on, as `updateTransfer` does.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/transactions/transaction-transfer.service.ts
+++ b/backend/src/transactions/transaction-transfer.service.ts
@@ private async updateSplitTransferLeg(
     await withScopedDb(this.dataSource, async (m) => {
+      // Parent first, then the leg (role order, common/db/locks.ts).
+      const lockedParent = await lockTransactionRow(m, parentTransaction.id, userId);
+      const lockedLeg = await lockTransactionRow(m, counterpart.id, userId);
+      if (!lockedParent || !lockedLeg) {
+        throw new NotFoundException(tr("errors.transactions.notFound", "Transaction not found"));
+      }
+      await assertReconciledRowsMutable(m, userId, [lockedLeg]);
+      if (
+        lockedLeg.amount !== oldCounterpartAmount ||
+        lockedLeg.transactionDate !== oldDate ||
+        lockedLeg.status !== counterpart.status ||
+        lockedParent.amount !== Number(parentTransaction.amount) ||
+        lockedParent.status !== parentTransaction.status
+      ) {
+        throw new ConflictException(
+          tr("errors.transactions.transferChangedConcurrently",
+             "This transfer was changed by another request. Reload it and try again."),
+        );
+      }
       if (Object.keys(legData).length > 0) {
@@ private async updateConnectedCrossOwnerTransfer(
     await withSystemContext(() =>
       withScopedDb(this.dataSource, async (m) => {
-        let lockedOwnLegVoidState: { wasVoid: boolean; amount: number } | null =
-          null;
-        if (updateDto.status !== undefined) {
-          const lockedOwn = await lockTransactionRow(
+        const [firstId, secondId] = [fromTransaction.id, toTransaction.id].sort();
+        const byId = new Map<string, LockedTransactionRow | null>();
+        for (const legId of [firstId, secondId]) {
+          const leg = legId === fromTransaction.id ? fromTransaction : toTransaction;
+          byId.set(legId, await lockTransactionRow(m, legId, leg.userId));
+        }
+        const lockedFrom = byId.get(fromTransaction.id);
+        const lockedTo = byId.get(toTransaction.id);
+        if (
+          !lockedFrom || !lockedTo ||
+          Math.abs(lockedFrom.amount) !== oldFromAmount ||
+          lockedTo.amount !== oldToAmount ||
+          lockedFrom.transactionDate !== oldDate ||
+          lockedFrom.status !== fromTransaction.status ||
+          lockedTo.status !== toTransaction.status
+        ) {
+          throw new ConflictException(/* same tr(...) as above */);
+        }
```

12. **Recommended regression test:** two real connections per surface, same-value and different-value concurrent edits, asserting stored = opening + ledger on every account.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
--- /dev/null
+++ b/backend/test/integration/transfer-edit-race.integration.spec.ts
@@
+it("a duplicate split-leg edit moves each balance once", async () => {
+  const { legId } = await splitWithTransfer(); // -100 = -60 category, -40 transfer
+  await Promise.allSettled([
+    withUserContext(userId, () => service.updateTransfer(userId, legId, { amount: 50 })),
+    withUserContext(userId, () => service.updateTransfer(userId, legId, { amount: 50 })),
+  ]);
+  expect(await balances()).toEqual({ chequing: 4890, savings: 2050 });
+});
+it("a duplicate connected cross-owner edit moves each owner's balance once", async () => {
+  const { fromTransaction } = await crossOwnerTransfer(500);
+  await Promise.allSettled([edit(fromTransaction.id, 600), edit(fromTransaction.id, 600)]);
+  expect(await balances()).toEqual({ ownerChequing: 5600, delegateSavings: 1400 });
+});
```

14. **Verification:** the spec above fails at the baseline (it is P1/Q1) and passes after the fix; `npm run test:unit -- transaction-transfer.service`; extend `derived-state-writers.guard.spec.ts` to per-function matching.
15. **Residual risks:** the diff does not cover `updateFrozenTransferLeg`, which locks the leg but moves `ownLeg.accountId` from the snapshot (`:2184-2191`; the account of a leg cannot change on that path, so not a present-day failure); the 409 needs a translation key check; lock order against `updateEmbeddedSplitParent` must be re-verified for a split parent carrying investment rows.

Causality: `PRIOR_REPORTED`, `CONFIRMED` (MON-H05; the cross-owner surface is `NEW_SINCE_UPSTREAM_AUDIT` code). Supersedes A26-S02-01 (same root cause, one more surface).

### A26-S07-02 - Undo or redo of an account edit writes the edit-time `current_balance` back as an absolute value

1. **Severity:** HIGH
2. **Confidence:** high (executed)
3. **Location:** `backend/src/action-history/action-history.service.ts:1742-1764` (`undoSimpleEntity`, `update` case: `manager.update(entityClass, id, beforeData)` filtered only by `ALLOWED_COLUMNS`), `:172-195` (`ALLOWED_COLUMNS.accounts` contains `current_balance`, `is_closed`, `closed_date`); producer `backend/src/accounts/accounts.service.ts:913, 1204-1217` (`beforeData = { ...account }`, `afterData = { ...savedAccount }`). Redo swaps before/after through the same function.
4. **Violated invariant:** INV-BALANCE-001; MON-H07 family (an absolute balance write must be the ledger sum taken under `lockAccountsForBalanceWrite`, never a stored figure).
5. **Reproduction:** chequing opening 5 000.00 with a -200.00 row dated in the future. The user renames the account (action recorded with `currentBalance: 5000`). The row falls due and the hourly `applyDueTransactionBalances` cron moves the balance to 4 800.00 (no action recorded). The user presses Undo (the rename is the latest action).
6. **Observed (executed, `zz-s07-probe3` R1):** `"Undone: Updated account \"Chequing renamed\""`; chequing stored 5 000.00, ledger 4 800.00.
7. **Expected:** the name reverts; `current_balance` stays 4 800.00.
8. **Impact:** persistent divergence equal to every balance movement since the edit that did not itself record an action under this user (the due-balance cron, bank sync, imports, a joint grantee's or delegate's postings recorded under their own id, scheduled postings by cron). 200.00 here (4.2 % of the balance); unbounded in general. The same restore can also reopen or close the account (`is_closed` is restored) with no zero-balance check, and no net-worth invalidation runs.
9. **Root cause:** the generic entity undo treats `current_balance` (a derived column) as user-edited data; `derived-state-writers.guard.spec.ts` looks for SQL writes of `current_balance`, not an entity `update` whose field list comes from data.
10. **Recommended correction:** remove derived and lifecycle columns (`current_balance`, `is_closed`, `closed_date`, `linked_account_id`) from the account undo set; when `opening_balance` is restored, recompute `current_balance` from the ledger under `lockAccountsForBalanceWrite`, and dispatch the net-worth recalc after commit.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/action-history/action-history.service.ts
+++ b/backend/src/action-history/action-history.service.ts
@@ ALLOWED_COLUMNS
   accounts: new Set([
@@
     "opening_balance",
-    "current_balance",
@@
-    "is_closed",
-    "closed_date",
@@ case "update":
           if (Object.keys(updateFields).length > 0) {
             await manager.update(entityClass, action.entityId, updateFields);
+            // A restored opening balance moves the balance by the ledger, not
+            // by the stored figure the snapshot carried.
+            if (tableName === "accounts" && "openingBalance" in updateFields) {
+              await this.recalculateBalance(manager, action.userId, action.entityId);
+            }
           }
```

12. **Recommended regression test:** rename, then a balance movement that records no action, then undo; assert stored = ledger and the name reverted.
13. **Suggested regression-test diff (illustrative, not applied):** the probe R1 as `backend/test/integration/action-history-account-undo.integration.spec.ts`: create a future-dated -200.00 row, `accounts.update(name)`, move the row's date to `CURRENT_DATE`, `accounts.applyDueTransactionBalances()`, `history.undo(userId)`, `expect(stored).toBe(ledger)`.
14. **Verification:** that spec; `npm run test:unit -- action-history`; a second case restoring `openingBalance` from 1 000.00 to 0.00 with rows in between.
15. **Residual risks:** the delete undo (`reinsertEntity`, `:1962-2006`) re-inserts the stored balance of a deleted account; an account can only be deleted with zero transactions, so the inserted figure equals the opening balance unless a row arrives concurrently (not shown). `recalculateBalance` in this service uses `CURRENT_DATE`, not the user's day (section 9).

Causality: `PRE_EXISTING_UNREPORTED` (MON-H07 family; the generic entity undo predates the upstream baseline by its numbered migrations; not proven from the shallow clone).

### A26-S07-03 - VOID crossings decided from a status read before the row lock (bulk VOID expansion and `addSplit`; MON-H10 residual)

1. **Severity:** MEDIUM
2. **Confidence:** high (executed, both surfaces)
3. **Location:** `backend/src/transactions/transaction-bulk-update.service.ts:204-211` (`expandTransferCounterparts`, `:1184-1245`, reads `status` unlocked) before the lock at `:255`; `backend/src/transactions/transaction-split.service.ts:1197-1226` (`addSplit` writes the new counterpart with `status: transaction.status`, the caller's snapshot, while `parent` is the locked row at `:1116`); same shape, static: `updateSplits` passes `parentStatus: transaction.status` (`:1023`).
4. **Violated invariant:** INV-TRANSFER-001; FIN-001.
5. **Reproduction:** (a) transfer pair A (-100.00 chequing) / B (+100.00 savings), both VOID. Request 1 `POST /transactions/bulk-update {ids:[A], status: VOID}`; Request 2 `PATCH /transactions/A/transfer {status: CLEARED}` commits between Request 1's expansion and its lock. (b) split parent -100.00 with a -60.00 category line; `POST /transactions/:id/splits {amount: -30, transferAccountId: savings}` while `PATCH /transactions/:id {status: VOID}` commits between the caller's `findOne` and the parent lock.
6. **Observed (executed, P4 and R2; the interleaving forced by a spy that awaits a barrier after the unlocked read, timing only):** (a) A VOID, B CLEARED; chequing 5 000.00, savings 2 100.00 (stored = ledger). (b) parent VOID, new leg +30.00 UNRECONCILED; savings 2 030.00.
7. **Expected:** (a) both legs VOID (or the second request refused); (b) the new leg VOID and savings 2 000.00, or a refusal.
8. **Impact:** 100.00 (a) and 30.00 (b) exist in one account with no matching outflow; every report and net worth carry it. Window: one request's latency (a provider rate lookup in (b)).
9. **Root cause:** the crossing set and the counterpart status are decided on unlocked reads; the comment at `:199-203` calls the expansion "a structural read", but its filter is the status.
10. **Recommended correction:** (a) lock the selected rows first, then expand on their locked statuses and lock the added mirrors (one ascending batch is safe: both legs are mirror legs); (b) use `parent.status` from the locked row.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/transactions/transaction-split.service.ts
+++ b/backend/src/transactions/transaction-split.service.ts
@@ addSplit
-          status: transaction.status,
+          status: parent.status as TransactionStatus,
@@
-        if (transaction.status === TransactionStatus.VOID) {
+        if (parent.status === TransactionStatus.VOID) {
--- a/backend/src/transactions/transaction-bulk-update.service.ts
+++ b/backend/src/transactions/transaction-bulk-update.service.ts
@@
-      statusIds = isUpdatingStatus
-        ? await this.expandTransferCounterparts(m, userId, eligibleIds, dto.status!)
-        : eligibleIds;
+      if (isUpdatingStatus) {
+        // Statuses decide the crossing, so read them under the lock.
+        await lockTransactionRows(m, eligibleIds, userId);
+      }
+      statusIds = isUpdatingStatus
+        ? await this.expandTransferCounterparts(m, userId, eligibleIds, dto.status!)
+        : eligibleIds;
```

**Suggested remediation diff: incomplete** for (a): the second `lockTransactionRows` at `:255` then locks the added mirrors after the selection, which is not one ascending batch; whether that order can deadlock against `updateTransfer` (which locks both legs ascending) needs a decision: lock the pair's union ascending after a first unlocked discovery and re-check, or refuse when the locked statuses no longer match the expansion.
12. **Recommended regression test:** both interleavings with two connections and a barrier.
13. **Suggested regression-test diff (illustrative, not applied):** probes P4 and R2 as integration specs; assert both legs share VOID and stored = ledger.
14. **Verification:** those specs; `npm run test:unit -- transaction-bulk-update transaction-split`.
15. **Residual risks:** `updateSplits` (`:1023`) not executed; the bulk lock-order decision above.

Causality: `PRIOR_REPORTED`, `CONFIRMED_WITH_DIFFERENT_ROOT_CAUSE` (MON-H10). Supersedes A26-S02-07 (now executed).

### A26-S07-04 - `PATCH /transactions/:id` changes the amount, rate or account of one transfer leg only (MON-H11 residual)

1. **Severity:** MEDIUM
2. **Confidence:** high (executed)
3. **Location:** `backend/src/transactions/transactions.service.ts:2534-2984` (`update`: no `isTransfer` refusal; writes `amount`, `exchangeRate`, `accountId` onto the row; the mirror is touched only on a VOID crossing at `:2919-2936`); controller `transactions.controller.ts:1527-1569` (also the joint-register bypass). The MCP and AI single edits refuse transfers in their previews (`transactions.service.ts:954`, `transaction-tool-prep.service.ts:511`); the AI batch row path was not traced to its preview (section 12).
4. **Violated invariant:** FIN-001 and the conservation rule `resolveTransferFx` enforces on the transfer routes ("A transfer between two USD accounts must move the same amount on both sides", `transaction-transfer.service.ts:257-268`).
5. **Reproduction:** transfer 100.00 chequing -> savings (same currency). `PATCH /transactions/<savings leg> {amount: 150}` from a REST client, a personal access token or a joint grantee's register.
6. **Observed (executed, P3):** 200; legs -100.00 / +150.00, both still `isTransfer` and linked; savings 2 150.00.
7. **Expected:** refusal pointing at `/transfer` (as the MCP/AI previews do), or routing to `updateTransfer`.
8. **Impact:** 50.00 created (50 % of the transfer); balances agree with their ledgers, so no recompute repairs it, while every transfer-aware report pairs two different amounts. An `accountId` move re-denominates `currencyCode` to the new account but keeps the number, and `exchangeRate` is written as sent.
9. **Root cause:** the transfer refusal lives in the MCP/AI preview helpers, not in the write.
10. **Recommended correction:** inside `update()`'s transaction, after the row lock, refuse a structural change (amount, account, date, rate) to a row with `isTransfer` or a split-transfer leg; keep presentational fields allowed.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/transactions/transactions.service.ts
+++ b/backend/src/transactions/transactions.service.ts
@@ async update(
       await assertReconciledRowsMutable(m, userId, [locked]);
+      const structural =
+        ("amount" in updateData && roundMoney(Number(updateData.amount)) !== locked.amount) ||
+        ("accountId" in updateData && updateData.accountId !== locked.accountId) ||
+        ("transactionDate" in updateData && updateData.transactionDate !== locked.transactionDate) ||
+        "exchangeRate" in updateData;
+      if (locked.linkedTransactionId && structural) {
+        throw new BadRequestException(
+          tr("errors.transactions.cannotEditTransfer",
+             "Transfers can't be edited here. Edit the transfer from the Transactions screen."),
+        );
+      }
```

12. **Recommended regression test:** PATCH amount on each leg of a plain pair and on a split-transfer leg; expect 400 and unchanged rows.
13. **Suggested regression-test diff:** probe P3 with `rejects.toThrow(/Transfers can't be edited here/)` and both legs still -100.00/+100.00.
14. **Verification:** that spec; `npm run test:unit -- transactions.service`; grep `e2e/` for a spec editing a transfer through the generic form.
15. **Residual risks:** a date-only change is structural for a pair too; the diff refuses it (the transfer route handles it); confirm no frontend path relies on PATCH for transfer descriptions with a resent amount (the value comparison keeps an unchanged resend allowed, but `exchangeRate` presence would refuse it: use a value comparison there too).

Causality: `PRIOR_REPORTED`, `CONFIRMED_WITH_DIFFERENT_ROOT_CAUSE` (MON-H11 server half: the transfer routes are fixed; this route bypasses them).

### A26-S07-05 - The strict reconciled lock is skipped on split-transfer leg and cross-owner transfer edits and deletes

1. **Severity:** MEDIUM
2. **Confidence:** high (executed)
3. **Location:** `transaction-transfer.service.ts:1728-1736` (early return into `updateSplitTransferLeg`), `:1515-1522` (`removeTransferFromSplitInTransaction`; the assertion at `:1554` is in the `else` branch only), `:1747-1753` -> `:2091-2207` and `:2219-2472` (cross-owner frozen and connected edits), `:1506` -> `:1590-1637` (`removeCrossOwnerTransfer`). `reconciled-lock.guard.spec.ts:55-63` scans `updateTransfer` and `removeTransfer` as whole bodies, so the assertion in one branch satisfies it.
4. **Violated invariant:** INV-RECONCILE-001.
5. **Reproduction:** lock on; (a) a RECONCILED split-transfer leg: `PATCH .../transfer {amount: 55}` then `DELETE .../transfer`; (b) Bob's RECONCILED own leg of a connected cross-owner transfer, Bob's lock on: same two requests.
6. **Observed (executed, P2 and Q2):** all four accepted. (a) leg 55.00 still RECONCILED, parent re-totalled to -115.00; the delete then removed the leg, the parent and its category line. (b) amount changed, then both legs deleted.
7. **Expected:** `ConflictException` from `assertReconciledRowsMutable` and nothing written.
8. **Impact:** the user's explicit setting ignored on reconciled history; in (a) the delete also removes an unreconciled parent's whole split.
9. **Root cause:** the assertion was placed per branch, and the guard checks per method.
10. **Recommended correction:** assert on the locked rows inside each branch's transaction (split leg and parent; own leg for cross-owner, under the acting owner's preference; the counterpart under its owner's preference for connected edits).
11. **Suggested remediation diff:** A26-S07-01's diff adds the split-leg edit assertion; for the rest:

```diff
@@ private async removeTransferFromSplitInTransaction(
     const parent = await lockTransactionRow(m, parentTransactionId, userId);
@@
     const locked = await lockTransactionRows(m, [...siblingLegIds, transaction.id], userId);
+    await assertReconciledRowsMutable(m, userId, [parent, ...locked.values()].filter(Boolean));
@@ const removeLeg = async (m: EntityManager, leg: Transaction) => {
       const locked = await lockTransactionRow(m, leg.id, leg.userId);
       if (!locked) return;
+      await assertReconciledRowsMutable(m, leg.userId, [locked]);
@@ updateFrozenTransferLeg / updateConnectedCrossOwnerTransfer, after the lock
+      await assertReconciledRowsMutable(m, effectiveUserId, [lockedOwnLeg]);
```

12. **Recommended regression test:** one unit case per branch with `lockReconciledTransactions: true`; make the guard enumerate the private branch methods.
13. **Suggested regression-test diff (illustrative, not applied):** add `updateSplitTransferLeg`, `removeTransferFromSplitInTransaction`, `updateFrozenTransferLeg`, `updateConnectedCrossOwnerTransfer`, `removeCrossOwnerTransfer` to `ENFORCEMENT_SITES` in `reconciled-lock.guard.spec.ts`, plus P2/Q2 as integration cases.
14. **Verification:** `npm run test:unit -- reconciled-lock transaction-transfer`.
15. **Residual risks:** whose preference governs a counterpart in another owner's ledger is a policy decision (per-ledger reading proposed).

Causality: `PRE_EXISTING_UNREPORTED` for the split-leg branch; `NEW_SINCE_UPSTREAM_AUDIT` for the cross-owner branches. Supersedes A26-S02-08.

### A26-S07-06 - An account closes over a pending future-dated row, which the due-balance cron later applies to the closed account (MON-M20 residual)

1. **Severity:** MEDIUM
2. **Confidence:** high (executed)
3. **Location:** `backend/src/accounts/accounts.service.ts:1264-1349` (`close`: checks `current_balance = 0` and holdings, not future rows), `:2178-2260` (`applyDueTransactionBalances`: absolute recompute with no `is_closed` predicate); `recalculateCurrentBalance` (`:1504-1545`) likewise.
4. **Violated invariant:** a closed account holds zero and moves no balance (MON-M20's invariant).
5. **Reproduction:** empty account (0.00) with a -25.00 row dated in the future; close it; the row's date arrives.
6. **Observed (executed, P7; the row's date moved to `CURRENT_DATE` and the cron method called directly):** close succeeds; after the cron the account is `is_closed = true`, `current_balance = -25.00`.
7. **Expected:** close refused while the account carries a non-VOID future row (or the row refused).
8. **Impact:** a closed account with a balance the user cannot touch without reopening; 25.00 here, any amount in general (a scheduled bill posted into the future, an import of post-dated cheques).
9. **Root cause:** "zero now" is checked, "zero including what is already booked" is not; the absolute writers do not carry the `is_closed` predicate the delta path has.
10. **Recommended correction:** in `close()`, under the same lock, refuse when a non-VOID row dated after today exists (both halves of a pair).
11. **Suggested remediation diff (illustrative, not applied):**

```diff
@@ async close(userId: string, id: string): Promise<Account> {
+      const [pending] = await m.query(
+        `SELECT COUNT(*)::int AS n FROM transactions
+          WHERE account_id = ANY($1) AND status <> 'VOID'
+            AND parent_transaction_id IS NULL AND transaction_date > $2`,
+        [halves.map((h) => h.id), todayYMD()],
+      );
+      if (pending.n > 0) {
+        throw new BadRequestException(tr("errors.accounts.closeWithFutureTransactions",
+          "Cannot close an account with future-dated transactions."));
+      }
```

12. **Recommended regression test:** P7 as an integration case.
13. **Suggested regression-test diff:** P7 with `expect(close).rejects.toThrow()`.
14. **Verification:** that spec; i18n key added and pseudo-locale regenerated.
15. **Residual risks:** a future row inserted after close by a path that does not refuse closed accounts (the create path's closed check was not traced in full).

Causality: `PRIOR_REPORTED`, `CONFIRMED_WITH_DIFFERENT_ROOT_CAUSE` (MON-M20; the delta race it described is fixed by the `is_closed` predicate).

### A26-S07-07 - Renaming or re-currencying an investment pair writes back the linked half's stale `current_balance`

1. **Severity:** MEDIUM
2. **Confidence:** high (executed)
3. **Location:** `backend/src/accounts/accounts.service.ts:1138-1145` (linked half read without a lock), `:1190-1201` (`m.save(linkedAccount)`); same shape at `:1937-1942` (`delete`: unlocked read, `m.save` of the linked half to null its link).
4. **Violated invariant:** INV-BALANCE-001 (a balance changes only by an atomic delta or a locked recompute).
5. **Reproduction:** investment pair, cash half 1 000.00. The user renames the brokerage; while that request is between reading the cash half and saving it, a posting moves the cash half by +10.00.
6. **Observed (executed, P8; a `BEFORE UPDATE` trigger sleeping 1 s on the brokerage row widens the window, timing only):** cash half 1 010.00 after the posting, 1 000.00 after the rename commits; ledger 1 010.00.
7. **Expected:** 1 010.00.
8. **Impact:** 10.00 lost here; any concurrent posting in general (a trade settling into the cash half, an import, the due-balance cron).
9. **Root cause:** TypeORM `save` diffs the in-memory entity against a fresh `SELECT` and writes every differing column, so the stale `currentBalance` becomes an absolute write.
10. **Recommended correction:** lock the linked half (`pessimistic_write`, ascending id order with the addressed half) or write only the changed columns with `m.update(Account, id, { name, currencyCode, institutionId })`.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
-          if (linkedChanged) {
-            await m.save(linkedAccount);
-          }
+          if (linkedChanged) {
+            await m.update(Account, linkedAccount.id, {
+              name: linkedAccount.name,
+              currencyCode: linkedAccount.currencyCode,
+              institutionId: linkedAccount.institutionId,
+            });
+          }
@@ delete
-        if (linkedAccount) {
-          linkedAccount.linkedAccountId = null;
-          await m.save(linkedAccount);
-        }
+        await m.update(Account, account.linkedAccountId, { linkedAccountId: null });
```

12. **Recommended regression test:** P8 as an integration case.
13. **Suggested regression-test diff:** P8 (trigger widening the window), asserting 1 010.00.
14. **Verification:** that spec; `npm run test:unit -- accounts.service`.
15. **Residual risks:** the addressed account's own `m.save(account)` is safe only because that row is locked at `:867`.

Causality: `PRE_EXISTING_UNREPORTED` (S04 sweep item, D-S03-01 family).

### A26-S07-08 - The custom-report text filter is a second search door with unescaped LIKE wildcards (INV-SEARCH-001)

1. **Severity:** LOW
2. **Confidence:** high (static; a two-line input, not executed)
3. **Location:** `backend/src/reports/reports.service.ts:572-578` (`searchText`) and `:719-735` (`text` condition): `%${value.trim().toLowerCase()}%` with no `escapeLikePattern`, outside `applyTransactionSearch`; the guard scans only `src/transactions/`.
4. **Violated invariant:** INV-SEARCH-001 (one parser, escaped once).
5. **Reproduction:** a custom report filtered on `50%` or `a_b`.
6. **Observed (by reading):** `%` and `_` act as wildcards: `50%` matches every payee or description containing `50`.
7. **Expected:** literal match, or the shared door.
8. **Impact:** a report total over more rows than the filter names; narrow.
9. **Root cause:** the guard's scope is the transactions module.
10. **Recommended correction:** route through `resolveTransactionSearch` / `applyParsedSearch`, or at least `escapeLikePattern`.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
-          const searchTerm = `%${filters.searchText.trim().toLowerCase()}%`;
+          const searchTerm = `%${escapeLikePattern(filters.searchText.trim().toLowerCase())}%`;
```

12. **Recommended regression test:** a report over payees `50 Shop` and `5000 Mart` filtered on `50%`: with `%` literal it returns neither (no payee contains `50%`); today it returns both.
13. **Suggested regression-test diff:** a `reports.service.spec.ts` case asserting the bound parameter is `%50\%%`.
14. **Verification:** `npm run test:unit -- reports.service`; widen `transaction-search.guard.spec.ts` to `src/reports/`.
15. **Residual risks:** S16 owns custom reports; the semantics (one parser versus substring) are a product decision.

Causality: `PRE_EXISTING_UNREPORTED`.

### A26-S07-09 - No suite detects removal of the split-parent lock, the closed-account predicate or the transfer compare-and-set at the database level (test coverage; joins MON-M46)

1. **Severity:** LOW
2. **Confidence:** high (executed mutations M1-M3, section 6)
3. **Location:** `backend/src/transactions/transaction-split.service.ts:1116`; `backend/src/accounts/accounts.service.ts:173`; `backend/src/transactions/transaction-transfer.service.ts:1890-1903`; tests: `transaction-split.service.spec.ts`, `test/integration/transactions.integration.spec.ts`, `transfers.integration.spec.ts`.
4. **Violated invariant:** `docs/verification-contract.md` (a lock, a predicate or a CAS needs a two-connection test).
5. **Reproduction:** apply M1 (`addSplit` reads the parent without `FOR UPDATE`): unit 93/93 green, integration green. M2 and M3 are caught only by mocked unit specs that assert the SQL text or the thrown 409.
6. **Observed:** section 6.
7. **Expected:** a two-connection integration case per mechanism fails.
8. **Impact:** a refactor that drops one of these can ship green.
9. **Root cause:** the race suites cover `balance-delta-recompute` only.
10. **Recommended correction:** add two-connection cases: concurrent `addSplit`; close versus an un-void; two concurrent `updateTransfer` with different amounts.
11. **Suggested remediation diff:** test-only, by design (the defect is the missing test): the A26-S07-01 regression spec plus

```diff
+it("two concurrent addSplit calls never exceed the parent", async () => {
+  // parent -100.00 with a -60.00 line; two -30.00 additions, a barrier after the
+  // prewarm hook so both have read the snapshot before either locks
+  ...
+  expect(sum).toBeGreaterThanOrEqual(-100);
+});
```

12-14. **Regression test / verification:** each case must fail under its mutation (M1-M3) and pass at the baseline. Note: the session's own concurrent `addSplit` probe (Q3) did not interleave under M1 either, so the case needs a barrier, not `Promise.all` alone.
15. **Residual risks:** none beyond coverage.

Causality: `PRE_EXISTING_UNREPORTED` (handed to S21 with MON-M46).

## 5. Prior-finding dispositions

| ID | Disposition | Evidence |
| --- | --- | --- |
| MON-H05 | STILL_OPEN -> A26-S07-01 | Fixed on `update()` (`transactions.service.ts:2666`), `remove()` (`:3074`), same-owner `updateTransfer` (`transaction-transfer.service.ts:1870-1903`, CAS; mutation M3 caught by `transaction-transfer.service.spec.ts`), `removeTransfer`, split removal, bulk (`:255`), reconciliation. Open on the split-transfer leg (P1, 5/5) and the connected cross-owner edit (Q1). |
| MON-H07 | FIXED_VERIFIED for recompute versus delta; related open defect A26-S07-02 | Every ledger-sum writer takes `lockAccountsForBalanceWrite` first (`accounts.service.ts:1520`, `:2217`; import post-processing; action-history `recalculateBalance`); `balance-delta-recompute.integration.spec.ts` passed and failed under M4. The account-edit undo writes a stored absolute figure (A26-S07-02, not a recompute). `applyOpeningBalance` stays with S10. |
| MON-H10 | STILL_OPEN (residual) -> A26-S07-03 | Sequential VOID paths hold (mirror leg, `updateTransfer`, bulk expansion, split parent propagation; P4 `before` state and unit specs). Executed residual: bulk expansion and `addSplit` decide on unlocked statuses. |
| MON-H11 (server half) | STILL_OPEN (residual) -> A26-S07-04 | Transfer routes: currencies from accounts, same-currency conservation and rate 1, implied rate from `toAmount`, refusal without a rate (`resolveTransferFx` `:228-340`); `transfers.integration.spec.ts` passed. The generic `PATCH /transactions/:id` writes one leg's amount, rate or account (P3). QIF half S10, client half S19. |
| MON-M20 | STILL_OPEN (residual) -> A26-S07-06 | The described delta race is FIXED: `is_closed = false` in the `UPDATE` (`accounts.service.ts:173`), M2 caught by a unit spec. Residual executed: close over a pending future row, then the cron writes the closed account (P7). |
| MON-M21 | FIXED_VERIFIED (by mechanism; test gap) | `addSplit` locks the parent row (`transaction-split.service.ts:1116`) before reading the split set (`:1130`); Q3 at the baseline: one of two concurrent -30.00 additions refused, set -90.00. Mutation M1 undetected by every suite (A26-S07-09). |
| MON-M27 | FIXED_VERIFIED | `assertTransactionCurrencyMatchesAccount` on create (`transactions.service.ts:488`), update (`:2579`, and `currencyCode` always rewritten from the account, `:2789`) and both transfer legs (`:243-250`). P6: `currencyCode: EUR` on a USD account refused with the foreign-entry hint. Import and bank-sync creation cross-checked by S10. |
| MON-M28 (server half) | REJECTED | Mixed-sign split lines are a documented shape: categories net within one category (AGENTS.md "A category's cost is its signed sum over rows of both signs", `isNetSpending`), and `docs/financial-semantics.md` section 11 reasons about mixed-sign split parents explicitly. P6: `-150.00 + 50.00 = -100.00` accepted, which is the contract. No document states the sign policy of split lines in one place (section 11). Client half S19. |
| Hand-off A26-S02-01 | superseded by A26-S07-01 | executed again (5/5) and widened |
| Hand-off A26-S02-07 | superseded by A26-S07-03 | executed |
| Hand-off A26-S02-08 | superseded by A26-S07-05 | executed, widened to deletes and cross-owner |
| Hand-off A26-S04-01 (cross-owner update and delete) | CONFIRMED (static) as part of A26-S04-01 | `removeCrossOwnerTransfer` and `updateCrossOwnerTransfer` call `resolveCounterpartAccess` (`:1597-1599`, `:2060-2064`) in their own reads, then write under `withSystemContext(withScopedDb(...))` (`:1625-1631`, `:2350-2457`) with no grant re-check. Not separately executed; S04's create-path execution demonstrates the mechanism. No new ID (Rule 7). |
| Hand-off S04 sweep, accounts rows | `:1142 -> :1200` CONFIRMED (A26-S07-07, executed); `:1937 -> :1942` CONFIRMED by reading (same shape, same finding) | |

## 6. Mutation table

All in the scratch worktree `<scratchpad>/mut` at the baseline, reverted after each run (`git checkout -- src`, `git status` clean).

| ID | Invariant | Mutation (file:line, what) | Test that fails | Verdict |
| --- | --- | --- | --- | --- |
| M1 | split sum (MON-M21) | `transaction-split.service.ts:1116` read the parent without `FOR UPDATE` | none: `transaction-split.service.spec.ts` 93/93; integration `transactions`, `transfers`, `cross-owner-transfers` green; the 2 failures in that run were the probe's baseline failures Q1/Q2, Q3 passed (did not interleave) | **undetected** |
| M2 | closure (MON-M20) | `accounts.service.ts:173` drop `AND is_closed = false` | 1 unit test (`accounts.service.spec.ts` / `transactions.service.spec.ts` set); integration 6 suites green | covered (unit only) |
| M3 | MON-H05 CAS | `transaction-transfer.service.ts:1896` `if (!unchanged && false)` | 1 unit test in `transaction-transfer.service.spec.ts`; `transfers`, `cross-owner-transfers`, `joint-accounts` integration green | covered (unit only) |
| M4 | INV-BALANCE-001 atomic delta | `accounts.service.ts:173-178` read `current_balance`, then write the absolute sum | 3 unit tests; `balance-delta-recompute.integration.spec.ts` (1) | covered |
| R1-R10 | various | none (baseline code); probes P1-P8, Q1-Q3, R1-R2 | see section 12 | defects demonstrated where marked in section 4 |

## 7. Counterexamples and the interaction scenario

| Invariant | Counterexample (not copied from the tests) | Result |
| --- | --- | --- |
| MON-H05 | The same value submitted twice to a split leg, and twice to a cross-owner leg by a grantee | Drift 10.00 and 100.00 (A26-S07-01) |
| INV-BALANCE-001 | A cosmetic account edit undone after an unrecorded posting | Stored 5 000.00 over ledger 4 800.00 (A26-S07-02) |
| INV-TRANSFER-001, four states | Same-owner pair: VOID/VOID -> bulk VOID raced by un-void | VOID/CLEARED (A26-S07-03) |
| INV-TRANSFER-001, cross-owner four states | own active / foreign VOID amount edit: own reversed and re-applied, foreign untouched; own VOID / foreign active: foreign reversed and re-applied (`legVoidState`, `:2339-2348`) | correct by reading on the reprice branch; inputs are snapshots (A26-S07-01) |
| FIN-001 conservation | Amount edit on one leg through the generic route | -100.00 / +150.00 (A26-S07-04) |
| Closure | Future-dated row plus close | Closed at -25.00 (A26-S07-06) |
| INV-RECONCILE-001 | Delete a reconciled split-transfer leg from the target register | Whole split removed (A26-S07-05) |
| Split sum | Two concurrent additions, -30.00 each, against -60.00 of -100.00 | One refused (holds) |
| MON-M27 | `EUR` label on a USD account | Refused (holds) |

Interaction scenario (A26-S07-01 x A26-S07-05 x A26-S04-01): Alice shares her chequing with Bob (edit grant) and has the strict lock on; she reconciles her leg of Bob's 500.00 transfer and then revokes Bob. Bob's tab, opened before the revoke, double-submits an amount edit of 600.00. Each request authorizes in its own read before the system-context write (A26-S04-01), so both pass after the revoke; neither asks Alice's reconciled lock (A26-S07-05); and each reverses 500.00 and applies 600.00 from the snapshot (A26-S07-01). Alice's reconciled ledger moves by 200.00 instead of 100.00, after she withdrew consent, on a row she locked. Each mechanism alone (revocation, reconciled lock, CAS) exists elsewhere in the same file; the cross-owner branch skips all three. Not executed as one combined run; its three parts were each executed (S04's create-path probe, Q1, Q2).

## 8. Rejected hypotheses

| Candidate | Evidence considered | Why rejected or downgraded | Final classification |
| --- | --- | --- | --- |
| MON-M28 mixed-sign split lines | P6; AGENTS.md netting rule; `financial-semantics.md` section 11 | Documented, supported shape; netting reports it correctly | REJECTED |
| Concurrent `addSplit` exceeds the parent (MON-M21) | Q3; parent lock at `:1116` | Serialized by the parent lock | REJECTED as a present defect (test gap A26-S07-09) |
| `updateTransfer` takes `wasVoid` from the from-leg only | `:1914`; same-owner legs share VOID by every writer except A26-S07-03's race | Only wrong after A26-S07-03 has already split the pair | DESIGN_RISK (section 9) |
| `updateFrozenTransferLeg` moves `ownLeg.accountId` from the snapshot | `:2184-2191`; the frozen path refuses account changes | The leg's account cannot change on this path, and the amount and status come from the lock | REJECTED |
| `users.service.ts:914-917` absolute reset without a lock | The data wipe deletes the user's transactions in the same transaction | A destructive, confirmed, user-wide wipe; a concurrent posting races the delete itself | REJECTED |
| `resetBrokerageBalances` absolute 0 without a lock | `accounts.service.ts:1964-1977`; brokerage balances are 0 by design | Writes the value the design holds | REJECTED |
| Account `delete` races a concurrent create (count in one transaction, `remove` in another; `ON DELETE CASCADE`) | `accounts.service.ts:1868-1945` | Reachable in principle, a transfer leg would be cascaded away; needs a posting into an account with zero rows during its deletion; not executed | LOW candidate, open hypothesis (section 12) |
| Bulk VOID "today" from server-local date | `transaction-bulk-update.service.ts:1340` (`formatDateYMDLocal(new Date())`) versus `todayYMD()` / `CURRENT_DATE` elsewhere | Near midnight a row dated today is treated differently by two writers; balances are healed by the next recompute; not executed | DESIGN_RISK (section 9), handed to S08 |
| MCP/AI single edit of a transfer leg reaches `update()` | `previewUpdate` `:954`, `transaction-tool-prep.service.ts:511` | Refused in the preview; only the REST route remains (A26-S07-04) | REJECTED for MCP/AI single edits |

## 9. Design risks

- Writers disagree on "today": `recalculateCurrentBalance` (`todayYMD()`), action-history `recalculateBalance` and import post-processing (`CURRENT_DATE`), bulk VOID (`formatDateYMDLocal(new Date())`), the due-balance cron (user timezone). Handed to S08.
- The action-history delta writer (`action-history.service.ts:1799-1805`) has no `is_closed = false` predicate, so an undo can move a closed account's balance (not executed).
- `updateTransfer`'s CAS compares amount, account and date but not status; the VOID decision reads `lockedFrom.status` only (`:1914`).
- Cross-owner authorization outside the write transaction (A26-S04-01) also covers update and delete; the fix is S04's helper.
- `derived-state-writers.guard.spec.ts` and `reconciled-lock.guard.spec.ts` match per file or per public method, so a private branch method escapes both (A26-S07-01, -05).

## 10. Missing tests and known-wrong tests

Known-wrong: none found in the slice.

Missing:
- Two-connection tests for the split-leg and cross-owner transfer edits, bulk VOID expansion, `addSplit`, close versus un-void, `updateTransfer` with different amounts (A26-S07-01, -03, -09).
- An undo-after-unrecorded-posting test for account edits (A26-S07-02).
- A refusal test for `PATCH /transactions/:id` on a transfer leg (A26-S07-04).
- Reconciled-lock cases for the split-leg and cross-owner branches (A26-S07-05).
- Close with a pending future-dated row (A26-S07-06); linked-half save race (A26-S07-07).
- `transfers.integration.spec.ts` still proves only a client-supplied rate (S02's item, unchanged).

## 11. Documentation inconsistencies

- `docs/financial-semantics.md` section 10 (gap register) still lists "Does a cross-currency transfer need a real rate? `exchangeRate` defaults to `1` ... a transfer created as `VOID` still moves both balances" and "`PATCH /transactions/:id/status` ... touch only the row given ... Breaches FIN-001"; the transfer routes now resolve or refuse a rate and VOID creates move nothing (`docs/system-invariants.md` INV-BALANCE-001 says so), and a VOID crossing on the generic route mirrors the counterpart. The register describes fixed behaviour as open.
- `docs/system-invariants.md` INV-BALANCE-001 says "only sanctioned services write current_balance, and each reads under a lock"; the account-edit undo writes it from a snapshot (A26-S07-02).
- INV-RECONCILE-001 lists `removeTransfer` / `updateTransfer` as covered; their split-leg and cross-owner branches are not (A26-S07-05).
- INV-TRANSFER-001 status `enforced` with "both legs' balances stay consistent across a VOID transition" on every path; A26-S07-03 is a concurrent counterexample.
- The comment at `transaction-bulk-update.service.ts:199-203` ("it does not read the statuses ... safe to run before the lock") is false.
- The comment at `transaction-transfer.service.ts:2215-2217` ("authorization was fully decided before entry") describes A26-S04-01's gap as a design.
- No document states the sign policy of split lines (mixed-sign is supported in practice; MON-M28 rejected on that basis).

## 12. Review ledger

**Revision.** `AUDIT_BASELINE_SHA` `72c59ec4`; HEAD at start `7bc6334`; pin check empty. Not a PR: no base, merge base, or hosted CI consulted.

**Files read in full:** `transaction-transfer.service.ts` ranges `:228-340`, `:645-760`, `:1474-2760` (the whole update/remove family), `transactions.service.ts:2534-3160`, `:3660-3712`, `accounts.service.ts:858-1557`, `:1868-2260`, `common/deletion-balance.util.ts`, `transactions/register-order.ts`, `transactions/remove-transaction-leg.ts`, `transactions/reconciled-lock.util.ts:1-60, 150-211`, `reconciled-lock.guard.spec.ts:1-140`, `transaction-bulk-update.service.ts:160-499, 1184-1368`.
**Sampled:** `transaction-split.service.ts:1075-1235`, `:170-210`; `common/db/locks.ts:215-295`; `action-history.service.ts:170-195, 486-546, 1730-1770`; `mcp/tools/transactions.tool.ts:695-715, 1480-1515, 1810-1835`; `ai/actions/ai-actions.service.ts:570-600`; `transaction-tool-prep.service.ts:505-610`; `reports/reports.service.ts:560-590, 715-735`; `users/users.service.ts:895-920`; `transactions.controller.ts:1520-1595`; `frontend/.../TransactionForm.tsx:1300-1370`; `docs/financial-semantics.md:60-130, 920-1000`; `docs/system-invariants.md` INV-BALANCE-001, INV-REGISTER-001, INV-TRANSFER-001, INV-RECONCILE-001, INV-SEARCH-001. Not read in full despite the size-L instruction: `transactions.service.ts` outside the ranges above (reads, register, LLM shapes), `transaction-split.service.ts` outside the ranges above, `investment-filter.util.ts` (sampled by the guard's existence only), `transaction-search*.ts` (sampled by grep). Recorded as sampled, never as clean.
**Searches:** every caller of `updateBalance` / `recalculateCurrentBalance` and every absolute `current_balance` write (subagent sweep, about 40 sites, spot-checked at the lines cited); `assertReconciled*` call sites; `isTransfer` refusals on MCP/AI; hand-built `%...%` LIKE patterns in `backend/src`; `lock_reconciled_transactions` migration.
**Suites run (all at the baseline code, serial):**

| Layer | Command | Result |
| --- | --- | --- |
| backend integration | `npm run test:integration -- 'transfers\|transactions.integration\|balance-delta-recompute\|cross-owner-transfers\|joint-accounts\|budget-split-transfer\|transaction-search\|import-balance-delta'` | 9 suites, 104 passed |
| probe 1 | `zz-s07-probe.integration.spec.ts` P1-P8 | 6 failed by design (P1, P2, P3, P4, P7, P8 reproduce), 2 passed (P5 fixture refused both, P6 currency refused) |
| probe 2 | `zz-s07-probe2` Q1-Q3 | Q1, Q2 reproduce; Q3 holds |
| probe 3 | `zz-s07-probe3` R1-R2 | both reproduce |
| mutations | M1-M4 with `transaction-split.service`, `accounts.service.spec\|transactions.service.spec`, `transaction-transfer.service`, and the integration sets in section 6 | 1 undetected, 2 unit-only, 1 covered |

Probe specs are kept under the session scratchpad (`mut/backend/test/integration/zz-s07-probe*.integration.spec.ts`), never committed.

**Reviewed without a finding:** `deletionBalanceEffect` and its single caller pattern (`removeLockedTransactionLeg`); `applyRegisterOrder` total order and the page window; same-owner `updateTransfer` and `removeTransfer`; `update()` and `remove()` lock placement; MCP/AI transfer routing; the `is_closed` predicate; currency derivation on create/update/transfer.

**Finding counts:** BLOCKER 0, HIGH 2 (A26-S07-01, -02), MEDIUM 5 (-03, -04, -05, -06, -07), LOW 2 (-08, -09).

**Text for the ledger (orchestrator merges):**
- Session status: S07 done; commit: the commit carrying this file; findings B/H/M/L 0/2/5/2; verdict REQUEST CHANGES.
- Prior findings disposed (final): MON-H05 STILL_OPEN (A26-S07-01); MON-H07 FIXED_VERIFIED (related A26-S07-02); MON-H10 STILL_OPEN residual (A26-S07-03); MON-H11 server half STILL_OPEN residual (A26-S07-04); MON-M20 STILL_OPEN residual (A26-S07-06); MON-M21 FIXED_VERIFIED (test gap A26-S07-09); MON-M27 FIXED_VERIFIED; MON-M28 server half REJECTED. A26-S02-01/-07/-08 superseded by A26-S07-01/-03/-05.
- Suites: 9 integration suites 104 passed at the baseline; probes and mutations as above.
- Undetected mutations: `split sum | transaction-split.service.ts:1116 parent read without FOR UPDATE | a two-connection addSplit test with a barrier | S07`; unit-only: `closure | accounts.service.ts:173 drop is_closed predicate | integration close-vs-unvoid | S07`; `MON-H05 | transaction-transfer.service.ts:1896 CAS disabled | integration concurrent updateTransfer | S07`.
- Open hypotheses handed on:
  - from S07 to S08: writers disagree on "today" (section 9); scheduled transfer/split posting into an account closed after the schedule was created.
  - from S07 to S10: account `delete` count-then-remove versus a concurrent import or bank-sync posting (cascade removes one transfer leg); MON-M27 on import and bank-sync creation paths.
  - from S07 to S16: A26-S07-08 (custom-report text filter) and whether report totals over transfer legs assume equal legs (A26-S07-04 makes them unequal).
  - from S07 to S17: the AI batch-update row path (`ai-actions.service.ts:570-600`) was not traced to a transfer refusal; confirm it cannot write one leg.
  - from S07 to S19: A26-S07-04 client half (no form should PATCH a transfer leg); MON-M28 client half.
  - from S07 to S21: A26-S07-09 joins MON-M46; per-function scope of `derived-state-writers.guard` and `reconciled-lock.guard`.
  - from S07 to S04/S03 (orchestrator): A26-S04-01 confirmed statically on cross-owner update and delete.
- Deviations: `dockerd` started by hand; the size-L "read in full" list was met for the transfer, accounts mutation and bulk status paths but `transactions.service.ts` read paths, `transaction-split.service.ts` and the search utilities were sampled (recorded above); report written by S07 only, ledger/sessions/register left to the orchestrator; probe interleavings forced by a spy barrier or a sleeping trigger (timing only, semantics untouched).

## 13. Adversarial approval challenge

Assumption: "the ledger's lock-and-CAS discipline is complete" is wrong. Started from the slice's abstractions, not from the findings:

- `lockTransactionRow(s)` and the CAS in `updateTransfer`: listed every private branch the public transfer methods dispatch to and asked which reaches a balance write without them. Found the cross-owner connected edit (A26-S07-01, executed Q1) beside S02's split leg.
- `assertReconciledRowsMutable`: asked the same question of the guard's method-level scan; four branches escape (A26-S07-05, executed).
- "VOID inclusion is decided on the locked row": searched every place a status chooses a counterpart or a crossing; two read it before the lock (A26-S07-03, executed).
- `lockAccountsForBalanceWrite` as the only absolute door: searched for absolute `current_balance` writes that are not a SQL string; the entity-level undo restore (A26-S07-02, executed) and TypeORM `save` of an unlocked entity (A26-S07-07, executed).
- Conservation in `resolveTransferFx`: asked which route writes a transfer leg's amount without it (A26-S07-04, executed).
- `is_closed = false`: asked what moves a balance without the delta path (A26-S07-06, executed).
- The search door: asked where else text is matched with LIKE (A26-S07-08).

Not challenged: RLS under `monize_app` for these paths (S04), scheduled posting (S08), import writers (S09/S10), investment cash legs (S12), the frontend round trip (S19), E2E.

## 14. Verdict

**REQUEST CHANGES** for the slice. Two HIGH findings survived the challenge, both executed against the baseline on a real PostgreSQL: A26-S07-01 (transfer edits deriving deltas from snapshots; split leg 5/5 and a cross-tenant 100.00 drift) and A26-S07-02 (account-edit undo restoring a stale absolute balance; 200.00 drift with no race). Five MEDIUM and two LOW findings follow. Of the eight owned prior findings, three are fixed and verified (MON-H07, MON-M21 with a test gap, MON-M27), one is rejected (MON-M28 server half), and four remain open in part (MON-H05, MON-H10, MON-H11 server half, MON-M20). Every result is a local run; hosted CI was not consulted. Every finding is review material and needs a specialist's verification before a maintainer decision.
