# S09 MNY Import State Machine

## 1. Metadata

| Field | Value |
| --- | --- |
| Session | S09 (child session_01KxbrJgNzbFhpqTXYbkj5SV, orchestrator session_018Nx7aian3f7dpRX5msjFBg) |
| Status | in-progress, remaining: mapper sampling of splits, loans and bills; e2e spec read; final adversarial challenge |
| `AUDIT_BASELINE_SHA` | `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86` |
| `git rev-parse HEAD` | at start `62ce999ee53b438d917eb3b3c226cfb7c748a55c`; at the final commit, the commit carrying this file. Pin check (`git diff --stat <baseline> HEAD -- . ':!docs/audits/2026-10' ':!docs/audits/2026-08-upstream'`) empty. |
| Date | 2026-10-21 |
| Primary path | `backend/src/import/mny/` (XL, sampled by the job state machine, section 12) |
| Secondary paths | `backend/src/import/import-post-processing.service.ts`, `import-entity-creator.service.ts`, `import.service.ts` (INV-IMPORT-003 only), `database/schema.sql:2687-2721`, migrations 117, 135, 140, 144, 145, `frontend/src/hooks/useMnyImport.ts`, `frontend/src/lib/import-mny.ts`, `frontend/src/components/import/MnyImportProgress.tsx`, `frontend/src/i18n/messages/en/import.json` |
| Hint line | `prioritize the job state machine (every state, transition, retry, crash, heartbeat, reap, stale request), the one-active-job index and its three-place declaration, retry after the data commit, wipe-before-claim ordering, staged-file expiry versus a running job, a retired job whose worker still commits, category collisions, and the monetary mapping of transfers, splits, investments and currencies from the MNY model` |
| Runtime executed | Node 24.22.1 (`nvm use 24`), `npm ci` OK in `backend/`. PostgreSQL 16 in Docker (`mirror.gcr.io/library/postgres:16-alpine`; `dockerd` started by hand). Baseline integration `npm run test:integration -- "mny\|import"`: **8 suites, 137 tests, all passed** (`bond-import`, `import-balance-delta`, `imported-settlement-flow`, `mny-import-job`, `mny-import`, `mny-staging`, `ofx-import-fitid`, `transaction-rules-import`). Scratch worktree at the baseline (`<scratchpad>/mut`): a post-commit failpoint spec over three fixtures and a re-upload variant (section 4), a mapper probe (A26-S09-03), seven mutations at integration and unit level (section 6), and a two-connection SQL race (A26-S09-04). Every integration run was serial (`--runInBand`), never in parallel with another. |

## 2. Invariant map

| ID | Statement | Mechanism named | Holds? |
| --- | --- | --- | --- |
| INV-IMPORT-001 | At most one pending or running MNY job per user | Partial unique index `idx_import_jobs_one_active_per_user` declared in `schema.sql:2719-2721`, migrations 135 and 140 (`IF NOT EXISTS`), and the entity (`import-job.entity.ts`, `ONE_ACTIVE_JOB_INDEX`); `LockScope.UserImport` advisory lock in `create` (`mny-import-job.service.ts:279`); 23505 on that constraint name only mapped to 409 (`:176-186, 315-320`) | Yes. Two-connection tests present and green (S02 executed them; this session re-ran the suite green). |
| INV-IMPORT-002 | A committed run is never replayed | `markDataCommitted` CAS `WHERE status='running' AND attempt_token=$2` as the last statement of `writeAll` (`mny-import.service.ts:680`, `mny-import-job.service.ts:525-545`); trigger `trg_import_job_fenced_checkpoint` (`schema.sql:2687-2705`, migration 145); `fail()` ANDs `retryable` with `data_committed = false` (`:618`); reaper derives `retryable` and `error_key` from `data_committed` (`:145-166`) | **Partly.** The fence holds (mutation M3 detected). A committed run that fails in-process is reported to the user as "Nothing was saved -- you can try again", and nothing refuses a second start on the same bytes (A26-S09-01, executed). The `fail()` guard is held by no test (A26-S09-02). |
| INV-IMPORT-003 | A category collision does not abort an import | None on the MNY writers (`writers/write-reference.ts:159-246`: read all, then plain `insert`) or on QIF (`import.service.ts:664-680`); the CSV creator was fixed (`import-entity-creator.service.ts:165-210`, `ON CONFLICT DO NOTHING`) | **No** on MNY and QIF; status `unenforced` remains correct but names one path of three (A26-S09-05). |
| (staged bytes vs a live job, MON-L04) | A pending or running job's staged bytes are not deleted | `NOT EXISTS (... status IN ('pending','running'))` in `sweepExpiredFiles` (`mny-staging.service.ts:160-190`) and `dropSupersededFiles` (`:197-216`); FK `ON DELETE SET NULL` | **Partly.** Both deleters evaluate the exclusion on a statement snapshot taken before the job INSERT commits, and `DELETE /import/mny/staged/:id` has no exclusion at all (A26-S09-04, race executed). |
| (wipe after the slot) | A destructive wipe runs only after this request holds the import slot | `start` orders `create` (job row) before `usersService.deleteData(..., "import-wipe", "mny-import")` (`mny-import.service.ts:163-207`); `discard` on a refused wipe | Yes (integration "wipes at most once"). Design risk if the wipe outlives `JOB_STALE_AFTER_MS` (section 9). |
| (reaper vs a live worker) | A reaped worker cannot commit, complete, heartbeat or fail over the reaper's decision | `attempt_token = NULL` in the reap; every worker write names the token (`:480-631`); `status='running'` predicates | Yes. Job rows never return to `pending`, so `status` alone already fences; the token is defence in depth (section 8). |
| (monetary mapping: transfers into an investment sleeve) | A bank-to-brokerage transfer moves the same money on both sides, each in its own currency | `buildCashCounterparts` mirrors the bank row (`map/map-transactions.ts:445-461`); expected balances computed from the same mapped rows (`mny-parser.service.ts:194-250`) | **No** across currencies (A26-S09-03, mapper probe executed); same-currency correct. |
| INV-CACHE-001 | Derived state is invalidated after a balance-moving commit | `ImportPostProcessingService.run` after `writeAll` (`mny-import.service.ts:294-299`) | Yes on the success path; never re-run after a post-commit failure (part of A26-S09-01). |

Material flows:

- Start: `POST /import/mny/start` -> `StartMnyImportDto` -> `MnyImportService.start` -> `staging.findInfo` (own transaction) -> `jobs.hasActiveJob` (advisory, own transaction) -> `jobs.create` (advisory lock `UserImport`, maintenance-lease read, per-user reap, INSERT under the partial unique index; one transaction) -> optional `deleteData` wipe (own transaction) -> unawaited `withUserContext(runClaimed)`.
- Run: `claim` (CAS `pending -> running`, mints `attempt_token`) -> heartbeat every 60 s on its own connection -> `runImport`: `loadBytes` -> synchronous `parser.parse` -> `ensureSystemCurrency` per code -> `writeAll` (one transaction: accounts, categories, payees, transactions, rules, securities, investments, holdings rebuild, bills, prices, rates, loans, balances, closures, `markDataCommitted`) -> **commit** -> `postProcessing.run` -> `verify` -> `verifyHoldings` -> `staging.remove` -> return -> `complete` (CAS on token).
- Failure: any throw in the body -> `fail(jobId, key, detail, retryable, token)`; the key is the caller's (`mnyImportFailed` or the parse code) whatever `data_committed` says.
- Reap: `create` and `findOne` (per user, request path) and `reapStaleJobs` (hourly, system context): `running` with stale or null heartbeat, or `pending` older than 5 minutes -> `failed`, token cleared, key and `retryable` from `data_committed`.
- Poll: `GET /import/mny/jobs/:id` -> `findOne` -> `toJobDto` (`id, status, progress, result, errorKey, retryable, startedAt, completedAt`; `dataCommitted` is not exposed) -> `useMnyImport` -> `MnyImportProgress`.

State machine (`import_jobs.status`):

| From | To | Trigger | Guard |
| --- | --- | --- | --- |
| (none) | pending | `create` | unique index, advisory lock, maintenance lease |
| pending | (deleted) | `discard` after a refused wipe | `status='pending'` |
| pending | running | `claim` | `status='pending'` CAS, new token |
| pending | failed | per-user or hourly reap after 5 min; `start`'s `.catch` (no token) | condition / `status IN (pending, running)` |
| running | completed | `complete` | `status='running' AND attempt_token` |
| running | failed | `fail` with token; reap on stale heartbeat | token; staleness condition |
| completed, failed | anything | none | every writer filters on `pending`/`running` |

## 3. Lens ledger

| Lens | Status |
| --- | --- |
| Pin revision | ran (section 1) |
| Instructions first | ran: `AGENTS.md`, `CLAUDE.md`, `backend/CLAUDE.md`, `frontend/CLAUDE.md`, `database/CLAUDE.md`, `docs/system-invariants.md` INV-IMPORT-001..003 and INV-FX-002, `docs/financial-semantics.md` sections 2-3, `.claude/commands/audit.md` (loaded through `/audit`), `docs/audits/monize-audit-01-remediation-review-response.md` RFR-001 |
| Summaries as hypotheses | ran: S02's A26-S02-05 re-executed (superseded by A26-S09-01); the code comments "a committed run is finalized rather than replayed" and "a started import can never have its bytes swept out from under it" tested by failpoint and race |
| Invariant model | ran (section 2) |
| Change surface / producer-consumer | ran: every writer of `import_jobs.status`, `retryable`, `data_committed`, `error_key`, `attempt_token` (all in `mny-import-job.service.ts`, migrations 135/140/145); every deleter of `import_staged_files` (sweep, superseded drop, `remove` from the job and from the controller); consumers of `retryable`/`errorKey` in the frontend |
| Cross-layer | ran for start, poll and failure display (backend service -> DTO -> `useMnyImport` -> `MnyImportProgress` -> i18n copy) |
| Representation boundary | ran: `retryable` versus `data_committed` versus `error_key` (three columns, one decision), `staged_file_id` NULL after `SET NULL`, `heartbeat_at` NULL (handled by the null arm), job DTO omitting `dataCommitted` |
| Browser/UI round trip | ran: failed-job screen copy and buttons (`MnyImportProgress.tsx:43-67`), Retry gating, `wipePerformed` suppression of a second wipe (`useMnyImport.ts:277-283`), `discardStagedFile` never called by the client |
| Server-authoritative metadata | ran: `userId` from the JWT on all four routes; `stagedFileId` is scoped by `user_id` in every staging read; `options` are resolved server-side (`resolveImportOptions`) |
| Identity versus value | ran: a staged file is identified by id, not by `sha256`, so the same bytes under two ids are two imports (A26-S09-01); source rows get fresh UUIDs per parse |
| State machine | ran (section 2 table; transitions tested by the existing suites and the failpoint) |
| Concurrency and idempotency | ran and executed: start race (existing suites), sweep versus INSERT (A26-S09-04), reaper versus live worker (mutation M3) |
| Partial failure / compensation | ran and executed: failure after the data commit (A26-S09-01); staged bytes deleted after the commit, kept on failure |
| External provider lookup | ran (narrow): post-processing backfills prices and rates after the commit with errors swallowed; no provider call inside the import transaction |
| Database / migration | ran: index three-place declaration, trigger in schema and migration 145 (installed by the spec harness, `mny-import-job.integration.spec.ts:85`), FK `ON DELETE SET NULL` |
| Backup/restore | ran (narrow): `import_staged_files` and `import_jobs` are classified in `backup/export-table-queries.ts:135-136`; restore semantics are S06's |
| Financial | ran: numerical examples in A26-S09-01 and A26-S09-03 |
| Authorization / RLS | ran (narrow): per-user reap scoped by `user_id = $3`; hourly reap and sweep under `withSystemContext`; RLS policy behaviour is S04's |
| Tests as evidence | ran (sections 6 and 10) |

## 4. Confirmed findings

### A26-S09-01 - A failure after the data commit is reported as "Nothing was saved", and the same file can then be imported again (MON-H04 residual; supersedes A26-S02-05)

1. **Severity:** HIGH
2. **Confidence:** high (executed: failpoint over three fixtures plus a re-upload variant)
3. **Location:** `backend/src/import/mny/mny-import-job.service.ts:679-691` (`runClaimed` passes the caller's key to `fail`), `:604-631` (`fail` keeps `error_key = $2` whatever `data_committed` says); `mny-import.service.ts:140-163` (`start` refuses nothing about a committed file), `:294-320` (post-commit steps); `mny-import.controller.ts:68-79` (`toJobDto` omits `dataCommitted`); `frontend/src/components/import/MnyImportProgress.tsx:51-53`; `frontend/src/i18n/messages/en/import.json:548`.
4. **Violated invariant:** INV-IMPORT-002, a committed run is never replayed and is finalized, not re-run.
5. **Reproduction:** any throw after `writeAll` commits and before `runImport` returns: `verify`/`verifyHoldings` (two reads), `staging.remove`, `repriceSettledLoanTemplates` (not wrapped by post-processing's own `try`), or `complete` itself. The job ends `failed`, `data_committed = true`, `retryable = false`, `error_key = 'mnyImportFailed'`. The wizard renders "Something went wrong while importing. Nothing was saved -- you can try again." with only "Start over". The user starts over and uploads the same file (UI path), or a client posts `/start` with the same `stagedFileId`, which survived (API path). Executed in a scratch worktree (`mny-import.integration.spec.ts`, `jest.spyOn(ImportPostProcessingService.prototype-instance, "run").mockRejectedValueOnce(...)`): fixture `sampleCdRedemption`, first run `status=failed dataCommitted=true retryable=false errorKey=mnyImportFailed`, 6 transactions; re-upload under a new staged id and start: `job2 status=completed`, 12 transactions, 20 investment rows.
6. **Observed:** Sample Deposit Account 5000.00 -> 10000.00; investment cash 4061.00 -> 8122.00; holding 1000 -> 2000 shares; job 2 reports `completed` with two `balanceMismatch` warnings. Same-staged-id path: identical result (`money2002`: 60 -> 120 investment rows, every holding 0.02 -> 0.04).
7. **Expected:** the failed job says the data is in the ledger (the reaper already has that copy, `mnyJobStalledAfterCommit`); a start over a staged file a committed job used is refused; the post-commit recompute is re-dispatched rather than lost.
8. **Impact:** financial: the whole imported history doubled, every balance and holding twice the file's (+5000.00 and +4061.00 on the fixture, +100 percent), with user-facing copy that invites the duplication. Integrity: only the job's warning list records the mismatch. Recovery: manual deletion of thousands of rows or a restore.
9. **Root cause:** the committed-failure state lives in `data_committed` alone. `fail()` derives `retryable` from it but not `error_key`, the DTO does not carry it, and `start` keys on the staged id, not on whether a committed job already consumed it. The reaper path got this right (`reapStatement`), the in-process path did not.
10. **Recommended correction:** in `fail()`, switch `error_key`/`error_detail` on `data_committed` the way the reaper does; in `create`, under the existing `UserImport` lock, refuse a staged file a committed job references; expose `dataCommitted` on the DTO. A re-upload of the same bytes remains a deliberate second import once the copy says so.
11. **Suggested remediation diff (illustrative, not applied)**

```diff
--- a/backend/src/import/mny/mny-import-job.service.ts
+++ b/backend/src/import/mny/mny-import-job.service.ts
@@ -614,8 +614,14 @@ export class MnyImportJobService {
           `UPDATE import_jobs
               SET status = 'failed',
-                  error_key = $2,
-                  error_detail = $3,
+                  error_key = CASE
+                    WHEN data_committed THEN '${JOB_COMMITTED_FAILED_ERROR_KEY}'
+                    ELSE $2
+                  END,
+                  error_detail = CASE
+                    WHEN data_committed THEN 'Import failed after its data was written; ' || $3
+                    ELSE $3
+                  END,
                   retryable = ($4 AND data_committed = false),
@@ -279,6 +285,18 @@ export class MnyImportJobService {
         await acquireAdvisoryLock(manager, LockScope.UserImport, userId);
+        const consumed = returnedRows<{ present: boolean }>(
+          await manager.query(
+            `SELECT EXISTS (SELECT 1 FROM import_jobs
+                WHERE user_id = $1 AND staged_file_id = $2 AND data_committed) AS present`,
+            [userId, stagedFileId],
+          ),
+        );
+        if (consumed[0]?.present === true) {
+          throw new ConflictException(tr("errors.import.mnyAlreadyImported",
+            "This file has already been imported. Upload it again only to import a second copy."));
+        }
--- a/backend/src/import/mny/mny-import.controller.ts
+++ b/backend/src/import/mny/mny-import.controller.ts
@@ -74,4 +74,5 @@ function toJobDto(job: ImportJob): MnyImportJobDto {
     retryable: job.retryable,
+    dataCommitted: job.dataCommitted,
```

with `JOB_COMMITTED_FAILED_ERROR_KEY = "mnyImportFailedAfterCommit"` and its copy in `frontend/src/i18n/messages/en/import.json` (`mnyErrors`) stating that the records are in the account and importing the file again would duplicate them; pseudo-locale regenerated. Maintainer decision: whether a committed failure should re-dispatch `postProcessing.run` (an idempotent recompute) from the reap/fail path rather than only report.

12. **Recommended regression test:** failpoint after commit; assert the job's `errorKey` is the committed key, a second `start` on the same staged id is refused, and transaction count and balances are unchanged.
13. **Suggested regression-test diff (illustrative, not applied):** the scratch spec (saved as `failpoint-test.diff` in the session scratchpad) reduced to:

```diff
+    it("finalizes a run that failed after its data commit", async () => {
+      const post = module.get(ImportPostProcessingService);
+      jest.spyOn(post, "run").mockRejectedValueOnce(new Error("failpoint"));
+      const staged = await withUserContext(userId, () =>
+        staging.stage(userId, { filename: "x.mny", data: stagedBytes("sampleCdRedemption") }));
+      const job = await awaitJob((await withUserContext(userId, () =>
+        importService.start(userId, { stagedFileId: staged.id }))).id);
+      expect(job).toMatchObject({ status: "failed", dataCommitted: true, retryable: false,
+        errorKey: "mnyImportFailedAfterCommit" });
+      const before = await dataSource.getRepository(Transaction).count({ where: { userId } });
+      await expect(withUserContext(userId, () =>
+        importService.start(userId, { stagedFileId: staged.id }))).rejects.toThrow(ConflictException);
+      expect(await dataSource.getRepository(Transaction).count({ where: { userId } })).toBe(before);
+    });
```

14. **Verification:** `npm run test:integration -- mny-import`; `npm run test:unit -- mny-import-job`; frontend `npm run test -- MnyImportProgress`; `npm run i18n:check` in both layers.
15. **Residual risks:** a re-upload of the same bytes under a new staged id is still allowed (by design, now with truthful copy); a `sha256`-keyed warning at preview time would close it. A crash after commit is handled by the reaper's committed key already.

Causality: `PRIOR_REPORTED`, `CONFIRMED_WITH_DIFFERENT_ROOT_CAUSE` (MON-H04). The false copy is `PRE_EXISTING_UNREPORTED`; consolidated per Rule 7 (one invariant, two surfaces: the UI re-upload and the API same-id start).

### A26-S09-02 - The guard that stops a committed run being offered Retry is held by no test

1. **Severity:** MEDIUM (test coverage of a HIGH-impact invariant)
2. **Confidence:** high (mutations executed)
3. **Location:** `backend/src/import/mny/mny-import-job.service.ts:618` (`retryable = ($4 AND data_committed = false)`), `:159` (reaper); `backend/test/integration/mny-import-job.integration.spec.ts`, `mny-import.integration.spec.ts`; `src/import/mny/mny-import-job.service.spec.ts`.
4. **Violated invariant:** INV-IMPORT-002; `docs/system-invariants.md` claims a failpoint that "commits writeAll then fails before terminal completion".
5. **Reproduction:** mutation M2, `retryable = $4`: `mny-import-job|mny-staging|mny-import.integration` 110/110 green; every unit spec under `src/import` 1848/1848 green. With M2 the failpoint run of A26-S09-01 ends `retryable = true` and the wizard's own Retry button re-imports the file. Mutation M1 (reaper `retryable = true`) is detected only by three unit tests that assert the SQL text of a mocked query; the integration suites stay 110/110 green.
6. **Observed:** no test enters the production path at "a body that throws after `markDataCommitted` committed" and asserts the row's `retryable`.
7. **Expected:** a real-database test per guard.
8. **Impact:** a one-token regression re-opens UI-driven double import with the suite green.
9. **Root cause:** the failpoint tests in `mny-import-job.integration.spec.ts:517-765` fail the job by reaping it (token cleared) or by refusing the checkpoint; none commits and then throws from the body.
10. **Recommended correction:** add the test of A26-S09-01 item 13 (it fails under M2) and one reaper case on a real row with `data_committed = true`.
11. **Suggested remediation diff (illustrative, not applied):** test-only by nature (the defect is the missing test):

```diff
+    it("reaps a committed stale job non-retryable", async () => {
+      const job = await createRunning(userId);            // existing helper pattern
+      await dataSource.query(`UPDATE import_jobs SET data_committed = true,
+        heartbeat_at = now() - interval '10 minutes' WHERE id = $1`, [job.id]);
+      await service.reapStaleJobs();
+      const row = await dataSource.getRepository(ImportJob).findOneByOrFail({ id: job.id });
+      expect(row).toMatchObject({ status: "failed", retryable: false,
+        errorKey: "mnyJobStalledAfterCommit" });
+    });
```

12-13. As above, plus the A26-S09-01 test.
14. **Verification:** re-run M1 and M2; both must turn the integration suite red.
15. **Residual risks:** none beyond A26-S09-01.

Causality: `PRE_EXISTING_UNREPORTED` (verification defect).

### A26-S09-03 - A cross-currency transfer into an investment sleeve credits the bank account's amount under the sleeve's currency, and verification cannot see it

1. **Severity:** MEDIUM
2. **Confidence:** medium-high (mapper probe executed; the amount convention for the far row is the one the repository already relies on for cross-currency banking pairs, `map-transactions.spec.ts:457`)
3. **Location:** `backend/src/import/mny/map/map-transactions.ts:445-461` (`amount: roundMoney(-row.amount)`, `currencyCode: input.currencyByHandle.get(far.account)`); trade cash leg `map/map-investments.ts:203-206, 281` (`|far.amount|`); expected balances `mny-parser.service.ts:194-250`.
4. **Violated invariant:** each side of a transfer carries its own account's amount in its own currency (`docs/financial-semantics.md` section 2; the banking pair already does this).
5. **Reproduction:** Money file with a EUR chequing account and a USD investment account; a transfer of EUR 2,400.00 that buys shares, stored by Money as bank row `-2400` (EUR) and far row `+2640` with `hsec` (USD). Probe (`mapTransactions`, scratch spec): output `[{acct-1, -2400, EUR}, {acct-5-cash, 2400, USD}]`, no warning.
6. **Observed:** the sleeve is credited USD 2,400.00; the trade's cash leg takes USD 2,640.00 out (`totalAmountOf` uses `|row.amount|` of the far row). Sleeve: -240.00 USD per such transfer, 9.1 percent of the transfer, cumulative over every cross-currency funded buy.
7. **Expected:** sleeve credited USD 2,640.00 (the far row's own amount); sleeve nets 0.00.
8. **Impact:** a negative cash balance in the brokerage sleeve and a wrong net worth; silent, because `computeExpectedBalances` sums the same mapped rows, so the verification report shows `matches: true`.
9. **Root cause:** the synthesized counterpart mirrors the near side's amount instead of reading the far row's own amount; correct only when the two accounts share a currency.
10. **Recommended correction:** use the far row's amount (sign from the near side), and warn when the two currencies differ and the far amount is zero.
11. **Suggested remediation diff (illustrative, not applied)**

```diff
--- a/backend/src/import/mny/map/map-transactions.ts
+++ b/backend/src/import/mny/map/map-transactions.ts
@@ -449,7 +449,13 @@ function buildCashCounterparts(
       transactionDate: (far.date ?? row.date) as string,
-      // The mirror of the bank side, so the pair sums to zero.
-      amount: roundMoney(-row.amount),
+      // Each side in its own currency: the far row records what arrived in the
+      // sleeve. The mirror is only a fallback when Money stored no amount there.
+      amount:
+        far.amount !== 0
+          ? roundMoney(Math.sign(-row.amount) * Math.abs(far.amount))
+          : roundMoney(-row.amount),
       currencyCode: input.currencyByHandle.get(far.account) ?? "",
```

Needs verification on a real multi-currency Money file that the far row's `amt` is in the investment account's currency for this pairing (the maintainer's file; no committed fixture has two currencies here).

12. **Recommended regression test:** a cross-currency variant of "pairs the bank row with a cash-sleeve row that funds the trade" asserting the sleeve amount 2640 and, at writer level, a sleeve balance of 0.00 after the trade.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+      it("credits the sleeve in its own currency for a cross-currency transfer", () => {
+        const result = mapTransactions(investmentInput({
+          currencyByHandle: new Map([...CURRENCIES, [1, "EUR"], [5, "USD"]]),
+          transactions: transactionData({
+            transactions: [
+              mnyTransaction({ handle: 1, account: 1, amount: -2400 }),
+              mnyTransaction({ handle: 2, account: 5, amount: 2640, security: 9 }),
+            ],
+            transfers: [mnyTransfer({ from: 1, to: 2 })],
+          }),
+        }));
+        expect(result.transactions[1]).toMatchObject({ amount: 2640, currencyCode: "USD" });
+      });
```

14. **Verification:** `npm run test:unit -- map-transactions`; a writer-level integration case asserting the sleeve balance.
15. **Residual risks:** the verification report remains self-referential for every mapping defect (section 9).

Causality: `NEW_SINCE_UPSTREAM_AUDIT` (the synthesized counterpart, issues #1175/#1211/#1212 era).

### A26-S09-04 - A staged file can still be deleted under a job that was just created (MON-L04 residual)

1. **Severity:** LOW
2. **Confidence:** high (the PostgreSQL behaviour executed with two connections)
3. **Location:** `backend/src/import/mny/mny-staging.service.ts:160-190` (sweep), `:197-216` (`dropSupersededFiles`), `mny-import.controller.ts:213-226` (`DELETE staged/:id`, no exclusion); `mny-import.service.ts:141, 163, 257`.
4. **Violated invariant:** a pending or running job's staged bytes are not deleted (the comment at `:96-103` says "a started import can never have its bytes swept out from under it").
5. **Reproduction:** connection A runs `create` (INSERT of the job referencing the staged row; holds `FOR KEY SHARE` until commit). Connection B runs the sweep (expired file) or `dropSupersededFiles` (a second upload in another tab). B's `NOT EXISTS` sees no job in its snapshot, waits on A's key-share lock, and once A commits, deletes the row without re-checking. Executed on PostgreSQL 16 with a two-table replica of the schema (`s09_sf`, `s09_jb ... ON DELETE SET NULL`): output `deleted staged row 1`, then `job 1 status=pending sf_id=NULL`.
6. **Observed:** the job runs, `loadBytes` returns null, `MnyStagedFileMissingError` (a parse code, so non-retryable); with `wipeExistingData` the wipe has already run. `DELETE /import/mny/staged/:id` deletes a pending job's bytes unconditionally (the client never calls it; `discardStagedFile` is dead code, `frontend/src/lib/import-mny.ts:335`).
7. **Expected:** the deleter re-checks the exclusion after acquiring the row lock, or the job creation refreshes the staged row so the deleter re-evaluates it.
8. **Impact:** a failed import and a forced re-upload; no ledger damage (nothing was written). Window: the job INSERT's transaction versus an hourly sweep of an expired (24 h) file or a concurrent upload.
9. **Root cause:** a single-statement `DELETE ... WHERE NOT EXISTS (job)` under READ COMMITTED does not re-evaluate the sub-select after waiting on a row lock that was not an update.
10. **Recommended correction:** lock first, decide second, in two statements.
11. **Suggested remediation diff (illustrative, not applied)**

```diff
--- a/backend/src/import/mny/mny-staging.service.ts
+++ b/backend/src/import/mny/mny-staging.service.ts
@@ -163,17 +163,22 @@ export class MnyStagingService {
         withScopedDb(this.dataSource, async (manager) => {
-          const result = await manager
-            .getRepository(ImportStagedFile)
-            .createQueryBuilder()
-            .delete()
-            .where("expires_at < CURRENT_TIMESTAMP")
-            .andWhere(`NOT EXISTS (...)`)
-            .execute();
-          return result.affected ?? 0;
+          // Statement 1 waits for any job INSERT holding a key-share lock;
+          // statement 2 then decides on a fresh snapshot that sees it.
+          const locked = returnedRows<{ id: string }>(await manager.query(
+            `SELECT id FROM import_staged_files
+              WHERE expires_at < CURRENT_TIMESTAMP FOR UPDATE SKIP LOCKED`));
+          if (locked.length === 0) return 0;
+          const deleted = await manager.query(
+            `DELETE FROM import_staged_files f WHERE f.id = ANY($1::uuid[])
+               AND NOT EXISTS (SELECT 1 FROM import_jobs j
+                 WHERE j.staged_file_id = f.id AND j.status IN ('pending','running'))
+             RETURNING id`, [locked.map((r) => r.id)]);
+          return returnedRows(deleted).length;
```

the same shape for `dropSupersededFiles`, and the controller's `remove` gains the same `NOT EXISTS` (a 409 when a job still needs the file). `SKIP LOCKED` is a choice: the sweep then defers a file whose job is being created to the next hour.

12. **Recommended regression test:** a two-connection integration case: open a transaction that inserts a pending job for an expired staged file, run the sweep from a second connection, commit the first, assert the staged row survives.
13. **Suggested regression-test diff:** `Suggested remediation diff: incomplete` for the test harness: the existing staging spec has no two-connection helper; the race needs a `QueryRunner` held open in the test (allowed in `test/`), which this session reproduced only in raw SQL.
14. **Verification:** the race test above; `mny-staging.integration` green.
15. **Residual risks:** none material.

Causality: `PRIOR_REPORTED`, `CONFIRMED_WITH_DIFFERENT_ROOT_CAUSE` (MON-L04: the expiry exclusion exists; the residual is the snapshot race and the unguarded discard route).

### A26-S09-05 - INV-IMPORT-003 is still unenforced on the MNY and QIF writers, and its index entry names one path of three

1. **Severity:** LOW
2. **Confidence:** high (static; the constraint and the writers read)
3. **Location:** `backend/src/import/mny/writers/write-reference.ts:159-206` (categories), `:214-246` (payees); `backend/src/import/import.service.ts:664-680` (QIF); fixed path for contrast `import-entity-creator.service.ts:165-210`; `database/schema.sql:268` (`UNIQUE(user_id, name, parent_id)`), `:313` (`UNIQUE(user_id, name)` on payees); `docs/system-invariants.md:287-305`.
4. **Violated invariant:** INV-IMPORT-003.
5. **Reproduction:** while a long MNY import's transaction is open, the user (or a rule, bank sync, or auto-post creating a payee) creates subcategory "Fuel" under an existing "Auto" or payee "ACME" that the file also needs. Whichever insert commits second gets 23505: if the import is second, its whole transaction aborts (job `failed`, retryable); if the manual create is second, it blocks for the remainder of the import and then fails.
6. **Observed:** a plain `repo.insert` after a read taken at the start of the transaction.
7. **Expected:** `INSERT ... ON CONFLICT DO NOTHING RETURNING id` and adopt the winner, as the CSV creator does.
8. **Impact:** a lost multi-minute import (retryable, nothing written) or a blocked UI request; top-level categories are not constrained at all (NULL parent), so a concurrent duplicate is silently created.
9. **Root cause:** the CSV fix was not carried to the other two writers; the index entry describes only `import.service.ts`.
10. **Recommended correction:** use the `insertCategoryIfAbsent` shape in `writeCategories` and an equivalent for `writePayees`; update the invariant's enforcement text to list the three paths.
11. **Suggested remediation diff (illustrative, not applied)**

```diff
--- a/backend/src/import/mny/writers/write-reference.ts
+++ b/backend/src/import/mny/writers/write-reference.ts
@@ -191,12 +191,22 @@ export async function writeCategories(
-    const id = randomUUID();
-    await repo.insert({
-      id,
-      userId,
-      name: category.name,
-      parentId,
-      isIncome: category.isIncome,
-    });
+    const inserted = returnedRows<{ id: string }>(await manager.query(
+      `INSERT INTO categories (id, user_id, name, parent_id, is_income)
+       VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING RETURNING id`,
+      [randomUUID(), userId, category.name, parentId, category.isIncome]));
+    const id = inserted[0]?.id ?? (await repo.findOneOrFail({
+      where: { userId, name: category.name, parentId: parentId ?? IsNull() },
+      select: ["id"],
+    })).id;
+    if (inserted.length > 0) created += 1;
```

(and the `created += 1` below removed). Note that the ON CONFLICT insert still waits on a concurrent uncommitted insert; it only removes the abort.

12-13. A two-connection integration case: hold a transaction that inserts subcategory X, run `writeCategories` needing X in a second, commit the first, assert the import adopts X.
14. **Verification:** `npm run test:integration -- mny-import`.
15. **Residual risks:** the top-level gap needs a `COALESCE`-style unique index (a migration; separate proposal).

Causality: `PRE_EXISTING_UNREPORTED` for the MNY writer; the QIF half is the documented `unenforced` gap.

## 5. Prior-finding dispositions

| ID | Disposition | Evidence |
| --- | --- | --- |
| MON-H03 | FIXED_VERIFIED | Partial unique index in `schema.sql:2719-2721`, migrations 135 and 140, entity `ONE_ACTIVE_JOB_INDEX`; `create` takes `LockScope.UserImport`, reaps in the same transaction, maps only that constraint's 23505 to 409. Tests: `mny-import-job.integration.spec.ts` "has exactly one winner when two starts race over the same staged file", "has one winner across four concurrent starts", "has exactly one winner when two starts race over a stale row"; `mny-import.integration.spec.ts` "imports the file's rows once, not twice", "wipes at most once". 137/137 green this session. |
| MON-H04 | STILL_OPEN (residual) -> A26-S09-01 | The fence is FIXED_VERIFIED: `markDataCommitted` CAS plus trigger 145; mutation M3 (drop both predicates) fails 3 integration tests. The residual: an in-process post-commit failure is shown as "Nothing was saved" and a second start on the same file is accepted (executed, balances doubled). A26-S09-01 supersedes A26-S02-05. |
| MON-L04 | STILL_OPEN (narrowed) -> A26-S09-04 | Sweep and superseded-drop exclude pending/running jobs (unit test "excludes staged files an active job still needs"; integration "keeps a file a pending job still needs"). Residual: snapshot race with the job INSERT (executed) and the unguarded `DELETE staged/:id`. |

## 6. Mutation table

All mutations in the scratch worktree at the baseline; integration runs use `mny-import-job|mny-staging|mny-import.integration` (110 tests), unit runs the named spec.

| ID | Invariant | Mutation | Test that fails | Verdict |
| --- | --- | --- | --- | --- |
| M1 | INV-IMPORT-002 | `mny-import-job.service.ts:159` reaper `retryable = true` | integration: none (110/110); unit: 3 SQL-text assertions in `mny-import-job.service.spec.ts` | undetected at integration level (unit-only, mocked SQL) |
| M2 | INV-IMPORT-002 | `:618` `retryable = $4` (drop `AND data_committed = false`) | none: integration 110/110, unit `src/import` 1848/1848 | **undetected** (A26-S09-02) |
| M3 | INV-IMPORT-002 | `:533` `WHERE id = $1 AND $2::uuid IS NOT NULL` (drop status and token) | "refuses the commit checkpoint once the job has been reaped", "rolls back the whole import transaction when the checkpoint is refused", "lets a retry claim the job and mint a token the old worker does not have" | covered |
| M4 | MON-L04 | `mny-staging.service.ts:174` sweep exclusion `AND false` | integration: none (68/68); unit: "excludes staged files an active job still needs" (SQL text) | undetected at integration level (unit-only) |
| M5 | MON-L04 | `:212` superseded-drop exclusion `AND false` | "keeps a file a pending job still needs", "marks what it reaped retryable, with the stalled key and its bytes" | covered |
| M6 | INV-IMPORT-002 | failpoint (not a mutation): `postProcessing.run` rejects once after commit | the new A26-S09-01 assertions (scratch) fail at the baseline | baseline defect |
| M7 | A26-S09-03 | probe (not a mutation): cross-currency sleeve | no existing test covers two currencies on this path | missing case |

## 7. Counterexamples and the interaction scenario

| Invariant | Counterexample (not from the existing tests) | Result |
| --- | --- | --- |
| INV-IMPORT-001 | stale running row plus two starts | holds (existing test re-run) |
| INV-IMPORT-002 | body throws after commit, user follows the on-screen copy and re-uploads | doubled ledger (A26-S09-01) |
| INV-IMPORT-002 | worker blocked past 5 min (synchronous parse of a large file), poller on another replica reaps, user retries, old worker wakes | old worker fenced at `markDataCommitted`, rolled back; second job imports once (traced; the fence executed as M3) |
| MON-L04 | expired staged file swept in the same second a start inserts its job | bytes deleted, job fails non-retryable (A26-S09-04) |
| sleeve transfer | EUR bank funds a USD buy | sleeve -240.00 USD per transfer, verification green (A26-S09-03) |
| INV-IMPORT-003 | subcategory created by hand during the import | whole import aborted (A26-S09-05) |

Interaction scenario: **wipe + post-commit failure.** A user selects "start fresh" (`wipeExistingData`), the wipe deletes their accounts, the import commits, `verify` hits a transient connection error. The job shows "Nothing was saved -- you can try again"; Retry is hidden, so the user starts over and re-uploads; Start over resets both `wipePerformed` and the options (`useMnyImport.ts:347-360`), so "start fresh" is unticked again. If the user ticks it again, the second wipe deletes the first import and the second import lands once: the false copy is harmless by accident. If not, the ledger is doubled. Without "start fresh" the same sequence doubles the ledger. The two mechanisms (wipe suppression on Retry, committed-failure reporting) do not know about each other; the outcome depends on which option the user picked the first time.

## 8. Rejected hypotheses

| Candidate | Evidence considered | Why rejected or downgraded | Final classification |
| --- | --- | --- | --- |
| A retired (reaped) worker commits its rows | `markDataCommitted` CAS, trigger 145, M3 detected; jobs never return to `pending`, so a reaped row can never be re-claimed | fence holds; the token is redundant with `status` but harmless | REJECTED |
| A reaper UPDATE racing the checkpoint loses the committed flag | the checkpoint UPDATE row-locks the job; the reaper waits, re-evaluates its WHERE on the new version (EvalPlanQual), and its `CASE WHEN data_committed` sees `true` | committed key and `retryable=false` written | REJECTED |
| The unawaited job body joins the request's ambient transaction | `start` has returned from `create`'s `withScopedDb` before the `void withUserContext(...)`; the ambient manager lives only inside `withScopedDb` (`scoped-db.ts:131`) | no ambient manager at that point | REJECTED |
| `start`'s `.catch` fails a live worker's job without a token | it runs only when `runClaimed` itself rejects, i.e. after the body finished or never ran | no live body at that point | REJECTED |
| `deleteData` (wipe) deletes the pending job or its staged file | `import_jobs`/`import_staged_files` are referenced only by maintenance, backup and the MNY module | not reachable | REJECTED |
| `exchangeRate: 1` on every MNY row misstates a cross-currency transfer | rows carry their own account's currency and no `originalCurrencyCode`; the rate is relative to the original currency (`financial-semantics.md` section 3) | rate 1 means "same currency" here, consistently | REJECTED |
| Old-binary worker during a 1.18 -> 1.19 rolling deploy bypasses the fence | both releases carry the token fence; the pre-140 binaries no longer exist on a supported upgrade path | historical only | REJECTED |
| Verification compares against Money's own balances | it compares the database against `computeExpectedBalances`, which sums the mapped rows | mapping defects are invisible to it | DESIGN_RISK (section 9) |

## 9. Design risks

- **DR-S09-01 Verification is self-referential.** `verify` checks write fidelity (database versus mapper), not mapping fidelity (mapper versus Money). A26-S09-03 is invisible to it. Money stores no per-account balance in the tables read, so a stronger check would need Money's own computed balance or a second, independent fold.
- **DR-S09-02 Synchronous parse versus the 5-minute stale threshold.** `parser.parse` is synchronous (`mny-import.service.ts:265`); the heartbeat timer cannot fire while it runs. A parse longer than about 5 minutes on a loaded pod lets another replica's poll reap a healthy job; the fence then rolls the import back and the retry repeats the same parse. Bounded by the documented 3-minute target for 37,000 transactions; no measurement in the repository.
- **DR-S09-03 Wipe longer than `JOB_STALE_AFTER_MS`.** The pending row created before the wipe is reaped after 5 minutes (S02 item); the claim then returns null and the import never runs after a completed wipe; Retry (no second wipe) recovers. The slot is free during the remainder of the wipe, so a restore could start alongside it.
- **DR-S09-04 Fresh UUIDs per parse.** Nothing on an imported row identifies its Money source record, so every duplicate-prevention rule has to live in the job state machine; a source key (`htrn`) would make replay idempotent at the row level.

## 10. Missing tests and known-wrong tests

- No test throws from the job body after `markDataCommitted` committed (A26-S09-02; M2 undetected).
- The reaper's committed branch is held only by SQL-text assertions on a mocked `manager.query` (M1).
- The sweep's active-job exclusion is held only by a SQL-text unit assertion (M4).
- No two-connection test of sweep or superseded-drop versus job creation (A26-S09-04).
- No cross-currency case for the synthesized sleeve counterpart (A26-S09-03).
- `mny-import.integration.spec.ts` "imports the file's rows once, not twice" runs on `money2008`, which writes 0 rows to `transactions` (3 investment rows): its `transactions` count assertion is `0 === 0` and cannot see a duplicate; the balance loop checks two zero-balance accounts. The race is in fact held by the job-count test beside it; this one is weaker than its name.
- No test for a category or payee collision on the MNY writers (A26-S09-05).

## 11. Documentation inconsistencies

- `docs/system-invariants.md` INV-IMPORT-002: "a committed run is finalized rather than replayed" and "Failpoint present ... commits writeAll then fails before terminal completion": no such failpoint exists; the committed in-process failure is neither finalized nor protected from a second start (A26-S09-01/-02).
- `docs/system-invariants.md` INV-IMPORT-003 names only `import.service.ts`; the CSV path was fixed, the MNY writers have the same gap.
- `mny-staging.service.ts:96-103`: "a started import can never have its bytes swept out from under it" overstates the mechanism (A26-S09-04).
- `frontend/src/i18n/messages/*/import.json` `mnyErrors.mnyImportFailed`: "Nothing was saved" is false whenever `data_committed` is true.
- `docs/audits/monize-audit-01-remediation-review-response.md` RFR-001 describes `assertStillHoldsSlot` / `MnyImportSlotLostError`, since replaced by `markDataCommitted`; it is a shipped record (not to be edited) and no live document repeats it.

## 12. Review ledger

- Directories inspected: `backend/src/import/mny/` (root files, `entities/`, `writers/`, `map/` sampled), `backend/src/import/` (post-processing, entity creator, QIF category path), `backend/test/integration/mny-*`, `frontend/src/hooks/useMnyImport.ts`, `frontend/src/lib/import-mny.ts`, `frontend/src/components/import/MnyImportProgress.tsx`, `frontend/src/app/import/page.tsx`, `database/schema.sql`, `database/migrations/135, 140, 144, 145`.
- Files in full: `mny-import-job.service.ts`, `mny-import.service.ts`, `mny-staging.service.ts`, `mny-import.controller.ts`, both entities.
- Files sampled: `map/map-transactions.ts:360-470, 630-725`; `map/map-transfers.ts` (all 84 lines); `map/map-investments.ts:195-320`; `writers/write-reference.ts:159-246`; `writers/write-transactions.ts` (currency columns); `mny-parser.service.ts:194-250`; `import-post-processing.service.ts:44-200`; `import-entity-creator.service.ts:165-210`; `import.service.ts:650-680`; `map-transactions.spec.ts:457-566`; `mny-import.integration.spec.ts:1347-1630`; `mny-import-job.integration.spec.ts` (test list, `:85`, `:517-765`).
- Searches: writers of `import_jobs`/`import_staged_files`; `discardStagedFile`; error-key consumers; `assertStillHoldsSlot`; `exchange_rate` semantics; category/payee unique constraints.
- Suites run: integration `mny|import` 8 suites 137/137 green (baseline); scratch failpoint 3 fixtures (3 fail = defect reproduced) and re-upload variant (1 fail = defect reproduced); mutation runs as in section 6; unit `src/import` 1848/1848 under M2.
- Areas reviewed without a finding: one-active-job index and its 409 mapping; claim CAS; token-scoped progress, heartbeat, complete and fail; reaper grouping (`reapStatement` parenthesis); wipe-after-slot ordering; maintenance-lease interlock in `create`; `userId` from the JWT on all routes.
- Counts for the ledger: findings 0 BLOCKER / 1 HIGH / 2 MEDIUM / 2 LOW (A26-S09-01 supersedes A26-S02-05).
- Undetected mutation rows for the program table: `INV-IMPORT-002 | mny-import-job.service.ts:618 retryable = $4 | a body-throws-after-commit test | S09`; `INV-IMPORT-002 | :159 reaper retryable = true | integration (unit SQL-text only) | S09`; `MON-L04 | mny-staging.service.ts:174 sweep exclusion removed | integration (unit SQL-text only) | S09`.
- Open hypotheses handed on: to S10, INV-IMPORT-003 QIF half (`import.service.ts:664-680`) and the top-level category unique gap; to S18/S19, the job DTO lacks `dataCommitted` and the wizard has no committed-failure state; to S21, A26-S09-02 and the weak "imports the file's rows once" test join the program mutation table.
- Deviations: none from the overrides; the toolchain was brought up in-session (Node 24, `dockerd` by hand).

## 13. Adversarial approval challenge

Pending (session in progress).

## 14. Verdict

Pending; on the findings so far: REQUEST CHANGES (A26-S09-01, HIGH).
