# S02 Prior HIGH and Verification-Defect Triage

## 1. Metadata

| Field | Value |
| --- | --- |
| Session | S02 (parallel wave; S01 dependency waived by the orchestrator) |
| `AUDIT_BASELINE_SHA` | `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86` |
| `git rev-parse HEAD` at start | `becd00facf022d3e52e3d6efa8019a486c68b1de` (pin check of plan step 2: empty diff outside `docs/audits/`) |
| Date | 2026-10-21 |
| Primary path | `docs/audits/2026-08-upstream/08-final-report.md` sections 7.1 and 13 |
| Hint line used | `for each of MON-H01..H16 and MON-M39..M45, independently reconstruct the scenario at AUDIT_BASELINE_SHA and dispose it FIXED_VERIFIED (name the mechanism and the test), STILL_OPEN, SUPERSEDED, NOT_LOCATED or HANDED_TO_Sxx; never accept the upstream fix narrative in docs/ as proof` |
| Status | complete |
| Runtime executed | Node 24.22.1 (`nvm use 24`); `npm ci` OK in `backend/` and `frontend/`. PostgreSQL 16 from the container's `/usr/lib/postgresql/16` (no Docker daemon in this container; see section 12, deviations). Backend unit: 28 suites, 2 065 tests passed, 2 skipped. Frontend unit: 15 files, 454 tests passed. Backend integration: 13 suites, 204 tests passed. Mutations: 11 run in a scratch worktree, 9 detected, 2 undetected. One scratch two-connection race spec (two variants), both reproduce MON-H05 on the split-transfer-leg path 10 of 10 times. Full per-run table in section 12. |

Method. Seven read-only sub-agents reconstructed the findings in parallel from the code (backup; cash
ledger; scheduler and transfers; MNY import; claim tokens and holdings; FX and splits; frontend
figures). Their reports are hypotheses. Every disposition below was checked by this session: the
mechanism re-read at the cited lines, the named test run, and for every `FIXED_VERIFIED` whose
mechanism is a guard or a lock, a break-on-purpose mutation run against it (section 6). Every
`STILL_OPEN` residual was confirmed by reading the code path in this session; the two HIGH ones by
execution.

## 2. Invariant map

| ID | Statement (short) | Mechanism named at the baseline | Path |
| --- | --- | --- | --- |
| INV-BACKUP-* (MON-H01) | Each backup key and retention pass is isolated by owner and instance | Per-user sharded folder `<root>/<ab>/<cd>/<userId>/` (`backend/src/backup/storage/local-backup-storage.target.ts:130-160`, `s3-backup-storage.target.ts:443-457`); no instance component | scheduler -> per-user target -> write -> promote -> retention `deleteExcess` (`auto-backup.service.ts:2254-2316`) -> legacy flat root |
| INV-BACKUP-* (MON-H02) | A restored attachment is retrievable or reported skipped | Export carries external bytes with size and SHA-256 (`export-attachments.ts`), staging before the destructive delete (`backup-attachment-transfer.service.ts:215-423`), `skippedAttachments` (`backup-restore.service.ts:387`) | export -> remap -> stage + verify -> commit -> delete displaced after commit |
| INV-IMPORT-001 (MON-H03) | One active MNY job per user | Partial unique index `idx_import_jobs_one_active_per_user` (`database/schema.sql:2719-2721`, migrations 135 and 140, entity `import-job.entity.ts:45-47`), advisory lock `UserImport`, 23505 mapped to 409 (`mny-import-job.service.ts:176-186, 263-321`) | start -> create (lock, insert) -> wipe -> claim (CAS) |
| INV-IMPORT-002 (MON-H04) | A committed run is never replayed | `markDataCommitted` CAS on `attempt_token` in the write transaction (`mny-import-job.service.ts:525-545`), trigger `trg_import_job_fenced_checkpoint`, `retryable = (data_committed = false)` | writeAll commit -> post-processing -> verify -> staging.remove -> complete |
| INV-BALANCE-* (MON-H05) | A balance delta comes from the row version the write replaces | `lockTransactionRow(s)` FOR UPDATE inside the write transaction (`common/db/locks.ts:256-388`), affected-row check on delete | request -> lock -> delta -> `updateBalance` (atomic `+ $1`) |
| INV-OCCURRENCE (MON-H06) | One occurrence, one financial effect | `scheduled_transaction_postings` unique `(scheduled_transaction_id, original_due_date)` (`schema.sql:1201-1231`), schedule row `pessimistic_write`, `expectedDueDate` pin (cron only) | cron/manual -> lock schedule -> claim occurrence -> money -> advance |
| INV-BALANCE-* (MON-H07) | Absolute recompute and deltas share one serialization | `lockAccountsForBalanceWrite` before the ledger read (`accounts.service.ts:1520`, `import-post-processing.service.ts:72`, `:2217`, `action-history.service.ts:1828`) | lock -> SUM -> absolute write |
| INV-HOLDING-* (MON-H08) | Holding = replay of committed ledger | Advisory `lockHoldingScope` (`locks.ts:161`) taken by every trade and every rebuild, holdings written only by replay | trade -> lock -> ledger row -> `rebuildScopesFromTransactions` |
| INV-CLAIM-001 (MON-H09) | A claim token is consumed once | Conditional `UPDATE ... WHERE claim_token_used_at IS NULL ... RETURNING` first in the transaction (`emergency-access-claim.controller.ts:220-242`) | consume -> password -> revoke -> issue |
| INV-TRANSFER-001 (MON-H10) | VOID moves no balance, on both legs | `assertVoidTransitionAllowedOnRow` / `applyVoidTransitionToMirrorLeg`, `expandTransferCounterparts` in bulk | status write -> mirror leg -> both deltas |
| INV-CURRENCY-001, INV-FX-002 (MON-H11) | Transfer currencies and rate are server-authoritative | `prepareTransfer` -> `resolveTransferFx` (`transaction-transfer.service.ts:228-382, 645-749`), `normalizeFxEntry` | DTO -> accounts -> rate resolve -> legs |
| INV-FX-001 (MON-H12) | Missing FX is unknown, never 1 | `null` from frontend hook and portfolio resolver; `FxAggregate`; `fx-fallback.guard.spec.ts` with allowlist `RETURNS_ITS_INPUT_UNCONVERTED` | rate lookup -> convert -> aggregate -> flag -> UI |
| INV-HOLDING-002 (MON-H13) | SPLIT multiplies by its ratio on every replay | `applyActionToQuantity` (`investment-replay.util.ts:88-108`), `investment-replay.guard.spec.ts` | ledger -> reducer -> quantity -> valuation |
| Preview = commit (MON-H14) | The trade preview uses the committed rate | Form blocks an unresolved rate and sends the previewed rate (`InvestmentTransactionForm.tsx:651-683, 1147-1151, 1192-1195`); server refuses unresolvable rate | form -> rate -> preview -> payload -> server |
| Override intent (MON-H15) | Opening an override does not reprice it | Auto-fill only when `!hasStoredPrice && price === ''` (`OverrideEditorDialog.tsx:419-431`) | stored override -> dialog -> quote -> save |
| Completeness (MON-H16) | A partial valuation is never shown as a complete total | `valuationComplete` / `fxComplete` / `pricesComplete` on summary and per-account totals; `PartialTotal` | portfolio service -> type -> accounts page / dashboard / investments page |
| INV-RELEASE-001 (MON-M44, MON-M45) | Zero discovered tests fails; tested, imaged and pushed revision are one | No `--passWithNoTests`, `jest-config.guard.spec.ts`; release job pushes a `[skip ci]` commit (`.github/workflows/ci.yml:1101-1152`) | CI -> build -> bump commit -> push -> release |

## 3. Lens ledger

| Lens | Status |
| --- | --- |
| Repository instructions first | ran: `AGENTS.md`, root, `backend/`, `database/` `CLAUDE.md`, `.claude/commands/audit.md` (via `/audit`), `docs/system-invariants.md` entries named above |
| Summaries as hypotheses | ran: every upstream claim and every `docs/` fix narrative re-derived from code; sub-agent output re-checked |
| Invariant model | ran (section 2) |
| Change surface / producers-consumers | ran per finding: transfer write paths (single, bulk, split leg, AI, MCP, import), FX conversion sites (backend reports, portfolio, frontend hook consumers), completeness-flag consumers (accounts page, `AccountList`, `logical-accounts`, dashboard widgets, investments page) |
| Cross-layer verification | ran for MON-H06 (dialog -> DTO -> controller -> service), MON-H14, MON-H15, MON-H16 |
| Representation boundary | ran: `null` vs `0` vs `1` for rates (H12), absent `fxComplete` vs `false` (H16), empty currency code (handed on, section 9) |
| Browser/UI round trip | ran for H14, H15 (component tests plus mutations), H06 dialog sending the stale `nextDueDate` |
| Server-authoritative metadata | ran for H11 (currencies, rate, `toAmount`), QIF import split leg |
| Identity versus value | ran for H06 (occurrence identity), H02 (attachment id remap) |
| State machine | ran for H04 (import job states), H10 (VOID), H06 (schedule advance) |
| Concurrency and idempotency | ran; executed for H05 (race spec), H07, H08, H03, H04, H09 (integration suites and mutations) |
| Partial failure and compensation | ran for H02, H04 |
| External provider lookup | not applicable as a lens of its own because none of the 23 findings is a provider-call amplification; provider-derived rates were covered under H12/H14 |
| Database and migration | ran for H03 (index in schema, migration and entity), H06 (postings table); no migration is changed by this audit |
| Backup/restore lens | ran for H01, H02, M43 |
| Financial lens | ran with numerical examples for every financial finding |
| Authorization/RLS lens | ran for H09 and the cross-owner exclusions in H10/H11; RLS itself is S04's |
| Tests are evidence | ran: mutation table, plus two tests that assert defects (section 10) |
| Mutation | ran (section 6), executed, 13 mutations |
| Counterexamples and interaction | ran (section 7) |
| Rejected hypotheses | ran (section 8) |
| Suggested diffs | written for every confirmed finding |
| Adversarial approval challenge | ran (section 13) |

## 4. Confirmed findings

Severity order. Every finding is triage evidence; the owning session named in each makes the final
call (plan section 4 step 8). Causality classes are plan section 3.

### A26-S02-01 - A split-transfer leg's edit derives both balance deltas from pre-transaction snapshots (MON-H05 still open on this path)

1. **Severity:** HIGH
2. **Confidence:** high (executed)
3. **Location:** `backend/src/transactions/transaction-transfer.service.ts:1717-1735` (dispatch), `:2561-2758` (`updateSplitTransferLeg`); caller `transactions.service.ts:3703-3715`.
4. **Violated invariant:** a balance adjustment is derived from the exact row version the write replaces (MON-H05; `docs/concurrency-and-idempotency.md`; AGENTS.md "Transactions (CRITICAL)").
5. **Reproduction:** checking (opening 5 000.00) holds split parent P = -100.00 (category -60.00, transfer -40.00); savings (opening 2 000.00) holds leg L = +40.00. Stored balances 4 900.00 and 2 040.00. Two `PATCH /transactions/L/transfer` with `{amount: 50}` arrive together (a double click, a retry after a lost response, two tabs).
6. **Observed:** `counterpart` is the row `findOne` loaded before any transaction (`:1708`), `parentTransaction` is a second unlocked `findOne` (`:2569`), and `oldCounterpartAmount`/`oldParentAmount` come from those snapshots (`:2627`, `:2721`). No lock, no compare-and-set. Executed (scratch spec, section 12): both requests succeed and move savings by `50 - 40` each and checking by `-110 - -100` each. Result: savings stored 2 060.00, ledger 2 050.00; checking stored 4 880.00, ledger 4 890.00, in 10 of 10 iterations. With 50 and 70 concurrently: savings stored 2 080.00 vs ledger 2 070.00 or 2 050.00, 10 of 10.
7. **Expected:** savings 2 050.00 and checking 4 890.00 (stored = opening + ledger) for the double submit; one of the two edits winning cleanly for 50/70.
8. **Impact:** persistent divergence of two account balances from their ledgers through ordinary double-submit; reconciliation, net worth, reports and the next balance recompute disagree. Absolute difference +10.00 / -10.00 per duplicate edit of 10.00 (100 % of the edit's delta duplicated); grows with the edit.
9. **Root cause:** the split-leg branch was not migrated when the other transfer paths moved their reads behind `lockTransactionRow(s)` (`:1870`, `:1888-1901`). `derived-state-writers.guard.spec.ts` matches per file, so the other functions' locks satisfy it for this one.
10. **Recommended correction:** inside the `withScopedDb` callback, lock the parent first, then the leg (the order `locks.ts:370-384` requires), re-derive old amounts, statuses and dates from the locked rows, and refuse with 409 when the leg moved under the caller as `updateTransfer` does.
11. **Suggested remediation diff (illustrative, not applied)**

```diff
--- a/backend/src/transactions/transaction-transfer.service.ts
+++ b/backend/src/transactions/transaction-transfer.service.ts
@@ updateSplitTransferLeg
-    const oldCounterpartAmount = Number(counterpart.amount);
+    // Read again under the lock below; this snapshot only shapes the request.
+    const snapshotCounterpartAmount = Number(counterpart.amount);
@@
-    await withScopedDb(this.dataSource, async (m) => {
+    await withScopedDb(this.dataSource, async (m) => {
+      // Parent first, then the leg: the order locks.ts requires for a split
+      // parent and its own leg (RV4-005).
+      const lockedParent = await lockTransactionRow(m, parentTransaction.id, userId);
+      const lockedLeg = await lockTransactionRow(m, counterpart.id, userId);
+      if (!lockedParent || !lockedLeg) {
+        throw new NotFoundException(tr("errors.transactions.notFound", "Transaction not found"));
+      }
+      await assertReconciledRowsMutable(m, userId, [lockedLeg]);
+      const oldCounterpartAmount = Number(lockedLeg.amount);
+      const oldParentAmount = Number(lockedParent.amount);
+      const counterpartIsVoid = lockedLeg.status === TransactionStatus.VOID;
+      const parentIsVoid = lockedParent.status === TransactionStatus.VOID;
+      // amountChanged, the leg delta and the parent delta are computed from
+      // these four values, never from `counterpart` / `parentTransaction`.
```

12. **Recommended regression test:** two real connections, same-value and different-value concurrent edits of one split leg, asserting stored = opening + ledger on both accounts.
13. **Suggested regression-test diff (illustrative, not applied):** the scratch spec used here, `test/integration/split-leg-race.integration.spec.ts` (kept under the session scratchpad, `race/split-leg-race.integration.spec.ts` and `race/split-leg-double.integration.spec.ts`): raw-SQL fixture as in `transfers.integration.spec.ts:186-221`, `Promise.allSettled` of two `service.updateTransfer(userId, legId, {amount})`, then `SELECT current_balance, opening_balance + SUM(non-VOID amount)` per account and `expect(diverged).toBe(0)`.
14. **Verification:** the spec above passes after the fix; `npm run test:unit -- transaction-transfer.service`; the derived-state guard extended to per-function matching.
15. **Residual risks:** the diff does not address A26-S02-07 (bulk) or the snapshot-currency hypothesis in `update()` (section 9); type-check and the reconciled-lock interaction (A26-S02-08) need verification.

Causality: `PRIOR_REPORTED`, `CONFIRMED` (MON-H05, residual path). Owner: S07.

### A26-S02-02 - Built-in reports convert a missing exchange rate 1:1 and label it in the reporting currency (MON-H12 still open on the reports surface; MON-M39's wrong test relocated)

1. **Severity:** HIGH
2. **Confidence:** high for the behaviour (an existing passing test asserts it); medium for the severity, which depends on how often a pair is missing (custom currencies, unsupported provider pairs).
3. **Location:** `backend/src/built-in-reports/report-currency.service.ts:99-121`; about 22 call sites in seven report services, among them `spending-reports.service.ts:329, 431`, `income-reports.service.ts:206`, `comparison-reports.service.ts:100, 106`, `data-quality-reports.service.ts:117, 197, 204`, and the anomaly, monthly-breakdown and tax reports. Allowlisted in `backend/src/common/fx-fallback.guard.spec.ts:84-100`.
4. **Violated invariant:** INV-FX-001 (rate 1 means same currency, a failed lookup is unknown); AGENTS.md "Convert before summing", "A subtotal is not a total".
5. **Reproduction:** default currency USD; a JPY account with 100 000 JPY of expenses; no JPY rate in the rate map. Open year-over-year, spending-by-payee, or the data-quality report.
6. **Observed:** `convertAmount` logs a warning and `return amount` (`:113-118`); the report sums 100 000 into a USD total with no completeness flag; the data-quality report labels it `currencyCode: defaultCurrency`. Executed evidence: `report-currency.service.spec.ts:213` "returns original amount when no rate is available" (`expect(result).toBe(1000)`) passes at the baseline (unit batch 2, section 12).
7. **Expected:** the converted figure (about 670 USD at 0.0067) or a total withheld with the missing pair named.
8. **Impact:** false spending, income, comparison and tax figures; difference about +99 330 USD (about 14 800 %) in the example. No warning reaches the reader.
9. **Root cause:** `convertAmount` has a `number` signature shared by ten services, so the null branch cannot be expressed; the guard allowlists it rather than failing.
10. **Recommended correction:** return `number | null`, aggregate through `FxAggregate`, give each report DTO a completeness field and missing pairs, and remove the allowlist entry.
11. **Suggested remediation diff: incomplete.** Supported part:

```diff
--- a/backend/src/built-in-reports/report-currency.service.ts
+++ b/backend/src/built-in-reports/report-currency.service.ts
-  ): number {
+  ): number | null {
@@
     if (result == null) {
-      this.logger.warn(`No exchange rate found for ${fromCurrency} -> ${defaultCurrency}, returning unconverted amount`);
-      return amount;
+      return null;
     }
     return result;
--- a/backend/src/common/fx-fallback.guard.spec.ts
+++ b/backend/src/common/fx-fallback.guard.spec.ts
-  const RETURNS_ITS_INPUT_UNCONVERTED = [ { file: "built-in-reports/report-currency.service.ts", ... } ];
+  const RETURNS_ITS_INPUT_UNCONVERTED: ReadonlyArray<{ file: string; reason: string }> = [];
```

   Missing: each of the ~22 call sites must switch to `FxAggregate` and each report DTO needs `fxComplete` plus `missingRatePairs`; the frontend report views must render the partial state. The per-report missing-data policy is the maintainer's decision (the guard's own comment says so).
12. **Recommended regression test:** per report service, one account in a currency with no rate: total `null`, `knownSubtotal` set, missing pair named.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
--- a/backend/src/built-in-reports/report-currency.service.spec.ts
+++ b/backend/src/built-in-reports/report-currency.service.spec.ts
-    it("returns original amount when no rate is available", () => {
+    it("returns null, not the input, when no rate is available (INV-FX-001)", () => {
       ...
-      expect(result).toBe(1000);
+      expect(result).toBeNull();
```

14. **Verification:** `npm run test:unit -- report-currency built-in-reports fx-fallback.guard`; frontend report views.
15. **Residual risks:** the AI and MCP tools that call the same report services inherit the change; S13/S17 verify them.

Causality: `PRIOR_REPORTED`, `CONFIRMED` (MON-H12, MON-M39). Owner: S13 (S16 for the report DTOs).

### A26-S02-03 - Completeness flags are not read on the accounts page, the account list, logical accounts and the dashboard portfolio widget (MON-H16 residual)

1. **Severity:** MEDIUM
2. **Confidence:** high for (b); medium-high for (a) (static, not executed)
3. **Location:** (a) `frontend/src/app/accounts/page.tsx:115-122, 140`, `frontend/src/components/accounts/AccountList.tsx:539`, `frontend/src/lib/logical-accounts.ts:118, 225-240`; (b) `frontend/src/components/dashboard/PortfolioValueWidget.tsx:149, 287-291`.
4. **Violated invariant:** AGENTS.md "A completeness flag is read where the numbers are shown"; MON-H16.
5. **Reproduction:** (a) a CAD brokerage holding a USD position worth USD 100 000 and a CAD position worth CAD 50 000, no USD->CAD rate: per-account `totalMarketValue` is the 50 000 known subtotal, `unpricedHoldingsCount` 0, `valuationComplete` false. (b) one unpriced holding: `totalPortfolioValue` 100 000 known, 50 000 omitted, `valuationComplete` false.
6. **Observed:** (a) the accounts page counts only `unpricedHoldingsCount`, so Net Worth, Total Assets, the account row and the favourite-accounts widget show 50 000 plus cash as complete. (b) the widget renders `formatCurrency(totalPortfolioValue)` with no flag check.
7. **Expected:** a partial marker or no total, as `PortfolioSummaryCard.tsx:109-140` already does.
8. **Impact:** about USD 100 000 (roughly CAD 135 000) omitted silently in (a); 50 000 (33 %) in (b).
9. **Root cause:** the request-failure and unpriced-holding fixes keyed on `unpricedHoldingsCount` instead of the per-account `valuationComplete`.
10. **Recommended correction:** read `valuationComplete === false` per account and on the summary at every listed surface.
11. **Suggested remediation diff (illustrative, not applied)**

```diff
--- a/frontend/src/app/accounts/page.tsx
+++ b/frontend/src/app/accounts/page.tsx
-      if (portfolioFailed || (unpricedHoldingCounts.get(a.id) ?? 0) > 0) return null;
+      if (portfolioFailed || incompleteValuations.has(a.id)) return null;
@@
+  // valuationComplete covers prices AND exchange rates; unpricedHoldingsCount only the first.
+  const incompleteValuations = useMemo(() => new Set(
+    (portfolioSummary?.holdingsByAccount ?? [])
+      .filter((h) => h.valuationComplete === false || (h.unpricedHoldingsCount ?? 0) > 0)
+      .map((h) => h.accountId)), [portfolioSummary]);
--- a/frontend/src/components/dashboard/PortfolioValueWidget.tsx
+++ b/frontend/src/components/dashboard/PortfolioValueWidget.tsx
-          {totalPortfolioValue !== null && (
+          {totalPortfolioValue !== null && summary?.valuationComplete !== false && (
```

   The same predicate goes into `AccountList.tsx:539` and `logical-accounts.ts:118`; the widget needs the partial label the investments page uses.
12. **Recommended regression test:** accounts page and widget fed `valuationComplete: false` with `unpricedHoldingsCount: 0`.
13. **Suggested regression-test diff (illustrative, not applied):** in `app/accounts/page.test.tsx`, a case beside "excludes an account with no exchange rate and marks the total partial" (`:539`) with `holdingsByAccount: [{ accountId: 'broker-1', totalMarketValue: 50000, unpricedHoldingsCount: 0, fxComplete: false, valuationComplete: false }]` asserting the Total Assets card is partial; in `PortfolioValueWidget.test.tsx`, `{ totalPortfolioValue: 100000, valuationComplete: false }` asserting no plain `$100,000.00`.
14. **Verification:** `npm run test -- accounts/page.test PortfolioValueWidget logical-accounts AccountList`.
15. **Residual risks:** the backend `total*` fields stay non-null when incomplete (design risk, section 9).

Causality: `PRIOR_REPORTED`, `CONFIRMED_WITH_DIFFERENT_ROOT_CAUSE` (MON-H16). Owner: S20.

### A26-S02-04 - Manual "post" of a scheduled transaction is not pinned to the occurrence the user saw (MON-H06 residual)

1. **Severity:** MEDIUM
2. **Confidence:** high (static)
3. **Location:** `backend/src/scheduled-transactions/scheduled-transactions.controller.ts:342-351`; `dto/post-scheduled-transaction.dto.ts:85-124` (no `expectedDueDate`); service `scheduled-transactions.service.ts:2873, 2922-2923`; client `frontend/src/components/scheduled-transactions/PostTransactionDialog.tsx:453-454, 770`, `ScheduledTransactionListParts.tsx:210`.
4. **Violated invariant:** one logical occurrence produces at most one financial effect across manual posting and retries (MON-H06, issue #1452 pin).
5. **Reproduction:** a monthly bill -50.00 due D1, balance 100.00. Tab A opens the post dialog (pre-filled `transactionDate = D1`). Tab B (or the cron, or a retried request whose response was lost) posts D1 and advances to D2. Tab A clicks Post.
6. **Observed:** the second request carries no occurrence pin; `post()` re-reads `next_due_date = D2`, claims (id, D2) and posts it dated D1. Balance 0.00; D2 is consumed early.
7. **Expected:** 409, as the cron, AI-action and email-receipt paths get (`expectedDueDate` at `:622-625`, `ai-actions.service.ts:1147`, `email-receipt-trade-link.service.ts:296`).
8. **Impact:** a bill paid twice on D1 (-50.00, 100 % of one occurrence) until the user notices; next month's occurrence silently missing.
9. **Root cause:** the pin was added to internal callers only; the HTTP DTO and both client calls never send it.
10. **Recommended correction:** add optional `expectedDueDate` to the DTO, send it from both clients, pass it to `post()`.
11. **Suggested remediation diff (illustrative, not applied)**

```diff
--- a/backend/src/scheduled-transactions/dto/post-scheduled-transaction.dto.ts
+++ b/backend/src/scheduled-transactions/dto/post-scheduled-transaction.dto.ts
+  @ApiPropertyOptional({ description: "The due date the client is posting; refused once it is no longer the due one" })
+  @IsOptional()
+  @ValidateIf((_o, v) => v !== null && v !== "")
+  @IsDateString()
+  expectedDueDate?: string;
--- a/backend/src/scheduled-transactions/scheduled-transactions.controller.ts
+++ b/backend/src/scheduled-transactions/scheduled-transactions.controller.ts
     return this.scheduledTransactionsService.post(req.user.id, id, postDto, {
       actorIsNotOwner: req.user.isActing === true,
+      expectedDueDate: postDto.expectedDueDate,
     });
--- a/frontend/src/components/scheduled-transactions/PostTransactionDialog.tsx
+++ b/frontend/src/components/scheduled-transactions/PostTransactionDialog.tsx
-      await scheduledTransactionsApi.post(scheduledTransaction.id, postData);
+      await scheduledTransactionsApi.post(scheduledTransaction.id, {
+        ...postData,
+        expectedDueDate: scheduledTransaction.nextDueDate.split('T')[0],
+      });
```

   `ScheduledTransactionListParts.tsx:210` sends the row's `nextDueDate` the same way. Decision for the maintainer: whether an absent pin stays accepted (old clients) or becomes required after one release.
12. **Recommended regression test:** controller passes the pin; service refuses a stale pin; dialog sends it.
13. **Suggested regression-test diff (illustrative, not applied):** in `scheduled-transactions.controller.spec.ts`, `expect(service.post).toHaveBeenCalledWith(userId, id, dto, expect.objectContaining({ expectedDueDate: "2026-01-01" }))`; in `PostTransactionDialog.test.tsx`, assert the payload carries `expectedDueDate`.
14. **Verification:** `npm run test:unit -- scheduled-transactions`; `npm run test -- PostTransactionDialog ScheduledTransactionList`.
15. **Residual risks:** `skip()` has the same stale read (section 9).

Causality: `PRIOR_REPORTED`, `CONFIRMED` (MON-H06, residual path). Owner: S08.

### A26-S02-05 - A committed MNY import can be replayed by a new start on the same staged file (MON-H04 residual)

1. **Severity:** MEDIUM
2. **Confidence:** medium-high (static; the mechanism under it executed green)
3. **Location:** `backend/src/import/mny/mny-import.service.ts:140-163` (start), `:294-320` (post-commit steps before `staging.remove`); `mny-import-job.service.ts:263-321`.
4. **Violated invariant:** INV-IMPORT-002, a committed run is never replayed.
5. **Reproduction:** `writeAll` commits (`data_committed = true`); `postProcessing.run` or `verify` throws, or the pod dies before `staging.remove` (`:320`). The job ends `failed`, `retryable = false`, the staged file remains. `POST /import/mny/start` with the same `stagedFileId` (direct API call, second tab, old client).
6. **Observed:** `start` checks only that the staged file exists and that no job is active; it creates a new job and imports the file again with fresh UUIDs. One source expense -25.00 becomes -50.00.
7. **Expected:** refusal (409/410) when a job with `data_committed = true` already references the staged file, or removal of the staged bytes in the committing transaction's aftermath regardless of later failure.
8. **Impact:** doubled financial history; only the frontend hides the retry (`MnyImportProgress.tsx:60`). Also INV-IMPORT-002's "finalize the committed run" has no executor: the post-processing recompute never re-runs after a post-commit failure.
9. **Root cause:** the fence protects the old job's state, not the staged file's; there are no deterministic source keys.
10. **Recommended correction:** refuse in `create` under the same advisory lock when a committed job references the staged file.
11. **Suggested remediation diff (illustrative, not applied)**

```diff
--- a/backend/src/import/mny/mny-import-job.service.ts
+++ b/backend/src/import/mny/mny-import-job.service.ts
       await acquireAdvisoryLock(m, LockScope.UserImport, userId);
+      const committed = await m.query(
+        `SELECT 1 FROM import_jobs WHERE user_id = $1 AND staged_file_id = $2 AND data_committed LIMIT 1`,
+        [userId, stagedFileId],
+      );
+      if (returnedRows(committed).length > 0) {
+        throw new ConflictException(tr("errors.import.mnyAlreadyImported",
+          "This file has already been imported. Upload it again only if you want a second copy."));
+      }
```

12. **Recommended regression test:** failpoint after commit, then a second start on the same staged file is refused and the transaction count is unchanged.
13. **Suggested regression-test diff (illustrative, not applied):** in `mny-import.integration.spec.ts`, wrap `postProcessing.run` to throw once, start, await `failed` with `dataCommitted = true`, then `await expect(importService.start(userId, { stagedFileId })).rejects.toThrow(ConflictException)` and assert `COUNT(transactions)` equals `transactionsCreated`.
14. **Verification:** `npm run test:integration -- mny-import`.
15. **Residual risks:** a re-upload of the same bytes under a new staged id is still a second import by design.

Causality: `PRIOR_REPORTED`, `CONFIRMED_WITH_DIFFERENT_ROOT_CAUSE` (MON-H04). Owner: S09.

### A26-S02-06 - Automatic-backup retention deletes legacy flat-root artifacts of other owners; keys carry no instance namespace (MON-H01 residual; MON-M43 narrowed)

1. **Severity:** MEDIUM
2. **Confidence:** high for the legacy sweep (an existing passing test asserts it); medium for the instance half
3. **Location:** `backend/src/backup/auto-backup.service.ts:2254-2316` (tie-break `:2297`, comment `:2256-2263`); `storage/local-backup-storage.target.ts:335-341, 427-433`; spec `auto-backup.service.spec.ts:3871, 3907`; S3 overwrite intended (`s3-backup-storage.target.spec.ts:158`).
4. **Violated invariant:** a backup job for one owner never deletes another owner's artifacts (MON-H01).
5. **Reproduction:** after an upgrade the flat root holds `monize-backup-daily-*` files left by the pre-sharding version (any owner). User A runs a backup with `retentionDaily = 1`.
6. **Observed:** A's retention lists the legacy files as A's own and deletes them, including another owner's last pre-upgrade recovery point. The spec "counts files left flat in the base folder by an older version" (`:3871`) asserts this and passes (unit batch 1). Separately, two instances with the same user ids (a staging copy of a production dump) sharing a bucket or directory compute the same keys and retain each other's artifacts.
7. **Expected:** legacy entries are never deleted by a per-user retention pass; an instance identifier in the key prefix.
8. **Impact:** loss of the only pre-upgrade backups of other users; cross-instance overwrite in the clone topology.
9. **Root cause:** a legacy entry's owner is not recoverable from its name, and the code resolves the ambiguity by sweeping rather than refusing.
10. **Recommended correction:** exclude `legacy` entries from `deleteExcess`; offer an explicit operator migration; add a configured instance id to the prefix.
11. **Suggested remediation diff (illustrative, not applied)**

```diff
--- a/backend/src/backup/auto-backup.service.ts
+++ b/backend/src/backup/auto-backup.service.ts
-    const candidates = entries.filter((e) => matchesTier(e, tier));
+    // A legacy flat-root file has no recoverable owner: never this user's to delete.
+    const candidates = entries.filter((e) => !e.legacy && matchesTier(e, tier));
```

   The instance half needs a design decision (a new env var or a database-persisted instance id, and a key migration), so no diff is given for it.
12. **Recommended regression test:** invert `:3871` and `:3907`: legacy files survive another user's retention.
13. **Suggested regression-test diff (illustrative, not applied):** `expect(existsSync(join(root, "monize-backup-daily-2026-04-01.json.gz"))).toBe(true)` after `runManualBackup(userA)` with `retentionDaily: 1`.
14. **Verification:** `npm run test:unit -- auto-backup`.
15. **Residual risks:** legacy files then accumulate until an operator removes them.

Causality: `PRIOR_REPORTED`, `CONFIRMED_WITH_DIFFERENT_ROOT_CAUSE` (MON-H01, MON-M43). Owner: S06.

### A26-S02-07 - Bulk VOID decides the mirror-leg expansion from statuses read before the row lock (MON-H10 residual race)

1. **Severity:** MEDIUM
2. **Confidence:** medium (static; not executed)
3. **Location:** `backend/src/transactions/transaction-bulk-update.service.ts:723-859` (`classifyTargets`, own transaction), `:1184-1245` (`expandTransferCounterparts`), lock at `:255`.
4. **Violated invariant:** INV-TRANSFER-001, both legs of a transfer enter or leave balances together.
5. **Reproduction:** transfer pair A/B is VOID. Request 1: bulk `{ids: [A], status: VOID}`; expansion reads A as VOID (no crossing), so B is not added. Request 2 un-voids the pair via `updateTransfer` and commits. Request 1 then locks only A, sees it active and voids A alone.
6. **Observed (by reading):** A VOID, B active; source balance restored by 100.00 while destination keeps +100.00.
7. **Expected:** expansion decided on locked statuses, or a refusal.
8. **Impact:** one-sided money creation of the transfer amount.
9. **Root cause:** check-then-act across two transactions.
10. **Recommended correction:** lock the selected rows, then expand on the locked statuses and lock the added mirrors in the same ascending batch.
11. **Suggested remediation diff: incomplete.** Supported part: move `expandTransferCounterparts` after `lockTransactionRows` at `:255` and pass it the locked map; the classification in `classifyTargets` must also read the locked rows. Missing: the exact refactor of `classifyTargets`, which runs in its own transaction today.
12. **Recommended regression test:** two connections with a pause after expansion.
13. **Suggested regression-test diff:** not given; it needs a hook in the bulk path to pause between expansion and lock, which the owning session must design.
14. **Verification:** integration race as in item 12.
15. **Residual risks:** to be executed by S07 before the final disposition.

Causality: `PRIOR_REPORTED`, `CONFIRMED_WITH_DIFFERENT_ROOT_CAUSE` (MON-H10). Owner: S07.

### A26-S02-08 - Editing a split-transfer leg bypasses the strict reconciled lock

1. **Severity:** MEDIUM
2. **Confidence:** high (static)
3. **Location:** `backend/src/transactions/transaction-transfer.service.ts:1717-1735` returns into `updateSplitTransferLeg` before the `assertReconciledRowsMutable` call at `:1888`; `reconciled-lock.util.ts:168`.
4. **Violated invariant:** with `lock_reconciled_transactions` on, a RECONCILED row may not be altered on any path (`reconciled-lock.util.ts:1-27`).
5. **Reproduction:** lock on; a RECONCILED split-transfer leg; `PATCH /transactions/<leg>/transfer {amount: 50}`.
6. **Observed:** the amount, the parent's split row, the parent total and both balances change.
7. **Expected:** refusal, as every other transfer edit gets.
8. **Impact:** an explicit user setting silently ignored on reconciled history.
9. **Root cause:** the early return precedes the check; `reconciled-lock.guard.spec.ts` scans `updateTransfer` as a whole.
10. **Recommended correction:** call `assertReconciledRowsMutable` on the locked leg (and parent) inside the split-leg transaction (included in the A26-S02-01 diff).
11. **Suggested remediation diff:** see A26-S02-01, line `await assertReconciledRowsMutable(m, userId, [lockedLeg]);`.
12. **Recommended regression test:** unit case under `updateTransfer` for a split leg with the lock on.
13. **Suggested regression-test diff (illustrative, not applied):** in `transaction-transfer.service.spec.ts`, a RECONCILED counterpart with a `TransactionSplit` parent and `lockReconciledTransactions: true`, expecting `ForbiddenException` (or the util's error) and no `updateBalance` call.
14. **Verification:** `npm run test:unit -- transaction-transfer reconciled-lock`.
15. **Residual risks:** the guard should be made per-path.

Causality: `PRE_EXISTING_UNREPORTED` or `NEW_SINCE_UPSTREAM_AUDIT` (the lock's introduction date is outside the shallow clone; S07 settles it). Owner: S07.

### A26-S02-09 - A QIF split-transfer leg is written in the source account's currency, unconverted (MON-H11 residual)

1. **Severity:** MEDIUM
2. **Confidence:** medium (static)
3. **Location:** `backend/src/import/import-regular-processor.service.ts:589-605` (`currencyCode: ctx.account.currencyCode`, `amount: linkedAmount`); compare the plain-transfer path `:765-790`, which uses the target account's currency and flags cross-currency.
4. **Violated invariant:** INV-CURRENCY-001, a currency code is derived from the account that holds the row.
5. **Reproduction:** QIF for a USD account with a split line `S[CAD account]` of 100.00.
6. **Observed:** a CAD-account row labelled USD, amount 100.00; the CAD balance moves by 100.
7. **Expected:** the CAD currency with a converted amount, or the pending-import note the plain path uses.
8. **Impact:** a mislabelled row in every report and backup; CAD balance off by the FX difference (at 1.35, 35.00 CAD per 100 USD).
9. **Root cause:** the split path was not given the plain path's cross-currency handling.
10. **Recommended correction:** use the target account's currency and the plain path's cross-currency branch.
11. **Suggested remediation diff (illustrative, not applied)**

```diff
--- a/backend/src/import/import-regular-processor.service.ts
+++ b/backend/src/import/import-regular-processor.service.ts
-      currencyCode: ctx.account.currencyCode,
+      currencyCode: splitTargetAccount?.currencyCode ?? ctx.account.currencyCode,
```

   plus the `isCrossCurrency` note and refusal of a silent 1:1 amount, mirroring `:765-772`; `splitTargetAccount` must be loaded where `splitTransferAccountId` is resolved.
12. **Recommended regression test:** QIF cross-currency split import.
13. **Suggested regression-test diff:** in the import processor spec, a USD parent with a CAD split target, expecting the leg's `currencyCode` to be `CAD`.
14. **Verification:** `npm run test:unit -- import-regular-processor`.
15. **Residual risks:** S10 to check the OFX/CSV paths for the same shape.

Causality: `PRE_EXISTING_UNREPORTED`. Owner: S10.

### A26-S02-10 - The release job pushes an untested `[skip ci]` version-bump commit with an admin token (MON-M45 still open)

1. **Severity:** MEDIUM
2. **Confidence:** high (static; the audited baseline itself is such a commit: `72c59ec4 chore: bump version to 1.19.0 [skip ci]`)
3. **Location:** `.github/workflows/ci.yml:1101-1152`.
4. **Violated invariant:** INV-RELEASE-001 (index status `partial`, `docs/system-invariants.md:6627-6640`, which records this gap).
5. **Reproduction:** run the manual release.
6. **Observed:** the job edits `package.json` and both lock files, commits with `[skip ci]`, runs `git pull --rebase` (which can incorporate commits merged after the tested SHA) and pushes to protected main with `RELEASE_TOKEN`; no gate runs on the pushed commit.
7. **Expected:** the pushed commit is the tested commit, or a full gate runs on it before the push.
8. **Impact:** release provenance and protected main point at an unverified revision; the `pull --rebase` can ship untested code under the release tag.
9. **Root cause:** the version commit is created after verification.
10. **Recommended correction:** create the version bump before the gate (release branch or PR), or refuse the push when `git rev-parse HEAD^` is not the tested SHA after the rebase.
11. **Suggested remediation diff (illustrative, not applied)**

```diff
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
           git commit -m "chore: bump version to ${VERSION} [skip ci]"
-          git pull --rebase
-          git push
+          # Refuse to publish anything but the tested revision plus this bump.
+          git fetch origin main
+          if [ "$(git rev-parse origin/main)" != "${{ needs.prepare-release.outputs.sha }}" ]; then
+            echo "main moved after the tested revision; re-run the release" >&2; exit 1
+          fi
+          git push origin HEAD:main
```

   (`prepare-release.outputs.sha` must exist; changes under `.github/` need the maintainer's agreement per AGENTS.md.)
12. **Recommended regression test:** a dry-run comparing tested, pushed, image and tag SHAs.
13. **Suggested regression-test diff:** not given; it belongs in S21's release-integrity check.
14. **Verification:** release dry-run.
15. **Residual risks:** the admin bypass remains a policy decision.

Causality: `PRIOR_REPORTED`, `CONFIRMED` (MON-M45). Owner: S21.

### A26-S02-11 - `fx-fallback.guard.spec.ts` cannot see a rate variable whose name does not start with "rate"; a rate-1 fallback in the portfolio resolver goes undetected

1. **Severity:** LOW
2. **Confidence:** high (executed mutation M1)
3. **Location:** `backend/src/common/fx-fallback.guard.spec.ts:174-175` (`\brate\w*`); `backend/src/securities/portfolio.service.ts:2147`.
4. **Violated invariant:** INV-FX-001's guard; AGENTS.md "Prefer the rule the machine can check".
5. **Reproduction:** change `portfolio.service.ts:2147` `?? null` to `?? 1`.
6. **Observed:** `fx-fallback.guard.spec.ts` and `portfolio.service.spec.ts` stay green (187 passed). The regex misses `exchangeRate`, `spotRate`, `directRate`; current hits it cannot see: `portfolio-calculation.service.ts:1299, 1615`, `transaction-transfer.service.ts:1382`, `transactions.service.ts:593`, `action-history.service.ts:931, 1066, 1324, 1415, 1470` (stored-rate reads of a `NOT NULL DEFAULT 1` column, so not lookup failures today).
7. **Expected:** the guard or the portfolio spec fails.
8. **Impact:** the next lookup-fallback-to-1 passes CI.
9. **Root cause:** word-boundary regex on a camelCase name; no portfolio test for a missing spot rate without a time series.
10. **Recommended correction:** match `[A-Za-z]*[Rr]ate\w*`; add a spec for the `!fx` branch.
11. **Suggested remediation diff (illustrative, not applied)**

```diff
--- a/backend/src/common/fx-fallback.guard.spec.ts
+++ b/backend/src/common/fx-fallback.guard.spec.ts
-          /\brate\w*\s*=\s*[^;]*[?:]\s*1\s*;/i.test(line) ||
-          /\brate\w*\s*(\?\?|\|\|)\s*1\b/i.test(line);
+          /\b\w*rate\w*\s*=\s*[^;]*[?:]\s*1\s*;/i.test(line) ||
+          /\b\w*rate\w*\s*(\?\?|\|\|)\s*1\b/i.test(line);
```

   The stored-rate reads it then flags need a reviewed allowlist entry each, or a `storedRateOrOne` helper.
12. **Recommended regression test:** portfolio summary with a currency that has neither a time series nor a spot rate.
13. **Suggested regression-test diff:** in `portfolio.service.spec.ts`, `expect(summary.fxComplete).toBe(false)` and the pair in `missingRatePairs` for that case.
14. **Verification:** re-run mutation M1; it must fail.
15. **Residual risks:** the guard is backend-only; the frontend has none.

Causality: `PRE_EXISTING_UNREPORTED` (test coverage). Owner: S13 (guard), S21 (register).

### A26-S02-12 - The emergency-access integration race exercises a copy of the consume SQL, not the controller

1. **Severity:** LOW
2. **Confidence:** high (executed mutation M3i)
3. **Location:** `backend/test/integration/emergency-access-grant-cycles.integration.spec.ts:484` "honours a delivered claim token exactly once".
4. **Violated invariant:** `docs/verification-contract.md`: a concurrency claim is proven at the production boundary.
5. **Reproduction:** remove `AND claim_token_used_at IS NULL` from the controller's consume (`emergency-access-claim.controller.ts:224-225`).
6. **Observed:** the integration suite stays green (15 passed); only the unit SQL-text assertion fails (M3).
7. **Expected:** the integration race fails.
8. **Impact:** a refactor that keeps the SQL text check happy but changes the call (for example to an ORM `update`) reopens MON-H09 with green integration.
9. **Root cause:** the test races two `dataSource.query` calls on hard-coded SQL.
10. **Recommended correction:** race two real `controller.complete` (or the service method) calls.
11. **Suggested remediation diff:** test-only change (this finding is a test defect): replace the two `dataSource.query(CONSUME_SQL)` calls with two `controller.complete({ token, newPassword })` calls built from the testing module.
12. **Recommended regression test:** as item 11, asserting one success, one 404, one password.
13. **Suggested regression-test diff:** as item 11.
14. **Verification:** re-run mutation M3i; it must fail.
15. **Residual risks:** none beyond the test.

Causality: `PRE_EXISTING_UNREPORTED` (test coverage). Owner: S03.

## 5. Prior-finding dispositions

`S02 triage` uses the register's vocabulary for what this session proved; `Disposition` is the
register column, `HANDED_TO_Sxx` for every row because the owning session makes the final call.

| ID | S02 triage | Disposition | Mechanism and test run in this session |
| --- | --- | --- | --- |
| MON-H01 | STILL_OPEN (residual) | HANDED_TO_S06 | Owner collision FIXED: per-user sharded folder; `auto-backup.service.spec.ts` "writes two users' same-day backups to different files", "applies one user's retention only to their own artifacts" (real temp dir) passed. Residual legacy sweep and missing instance id: A26-S02-06. |
| MON-H02 | FIXED_VERIFIED | HANDED_TO_S06 | Export carries external bytes with size and SHA-256; staging and verification before the destructive delete; `skippedAttachments`. `backup.service.spec.ts` "copies the bytes to the remapped key before restoring the metadata", "drops the metadata and reports it when the object is missing" (mocked storage) and `backup-restore.integration.spec.ts` (25 passed, database provider only) run. Real local/S3 round trip still missing (MON-M47, S06). Latent: staged-object cleanup chained after the post-commit `.then` (section 9). |
| MON-H03 | FIXED_VERIFIED | HANDED_TO_S09 | Partial unique index in schema, migrations 135/140 and entity; advisory `UserImport` lock; 23505 -> 409; wipe after the slot. `mny-import-job.integration.spec.ts` (55 passed: "has exactly one winner when two starts race over the same staged file", "has one winner across four concurrent starts") and `mny-import.integration.spec.ts` (42 passed: "wipes at most once, because the wipe is behind the same lock"). |
| MON-H04 | STILL_OPEN (residual) | HANDED_TO_S09 | Fencing FIXED: `markDataCommitted` CAS on `attempt_token` in the write transaction; mutation M6 detected (3 tests fail). Replay through a new start on the same staged file: A26-S02-05. |
| MON-H05 | STILL_OPEN | HANDED_TO_S07 | Row locks on update, remove, transfer, reconciliation and bulk paths (unit specs passed; single-connection integration passed). Split-transfer-leg path executed: 10/10 divergence, A26-S02-01. |
| MON-H06 | STILL_OPEN (residual) | HANDED_TO_S08 | Occurrence key `idx_stp_occurrence`, schedule row lock, claim before money, all in one transaction; `scheduled-transactions.service.spec.ts` "claims the occurrence before creating any money", "posts nothing when another replica claimed the occurrence" passed; `loan-settlement-claim.integration.spec.ts` 11 passed. No integration test calls the real `post()`. Manual path unpinned: A26-S02-04. |
| MON-H07 | FIXED_VERIFIED | HANDED_TO_S07 | `lockAccountsForBalanceWrite` before the ledger read in every absolute writer; `balance-delta-recompute.integration.spec.ts` "keeps the delta" (two connections) passed, and fails under mutation M10. Residual hypothesis `applyOpeningBalance` handed to S10 (section 9). |
| MON-H08 | FIXED_VERIFIED | HANDED_TO_S12 | Advisory `lockHoldingScope` on every trade and rebuild, holdings written only by replay; `holding-concurrent-trades.integration.spec.ts` "does not lose an update" passed, fails under mutation M4. |
| MON-H09 | FIXED_VERIFIED | HANDED_TO_S03 | Conditional consume `UPDATE ... WHERE claim_token_used_at IS NULL ... RETURNING` first in the transaction; unit "refuses the second consumer and writes nothing" fails under mutation M3; integration does not (A26-S02-12). |
| MON-H10 | STILL_OPEN (residual) | HANDED_TO_S07 | Sequential VOID paths FIXED (mirror leg, `updateTransfer`, bulk expansion; unit specs passed). Bulk expansion race: A26-S02-07 (static). |
| MON-H11 | STILL_OPEN (residual) | HANDED_TO_S07 (QIF half S10, client half S19) | Transfer paths FIXED: currencies from accounts, server rate or refusal, split counterpart at market rate (unit specs passed; `transfers.integration.spec.ts` 15 passed). QIF split leg: A26-S02-09. Unbounded `toAmount` is a policy decision (section 9). |
| MON-H12 | STILL_OPEN | HANDED_TO_S13 | Frontend hook and portfolio resolver return `null` (useExchangeRates and portfolio specs passed). Built-in reports still 1:1: A26-S02-02. Guard blind spot: A26-S02-11. |
| MON-H13 | FIXED_VERIFIED | HANDED_TO_S13 | Every replay goes through `applyActionToQuantity`; `investment-replay.guard.spec.ts`; mutation M2 (`*` to `+`) fails 9 tests in `investment-replay.util.spec.ts` and `net-worth.service.spec.ts` ("multiplies by the split ratio rather than adding it (P5-011)"). |
| MON-H14 | FIXED_VERIFIED | HANDED_TO_S12 (client S19) | Preview null and submit blocked on an unresolved rate; previewed rate sent; server refuses unresolvable rate. Mutation M9 fails "does not preview the trade at one to one", "blocks the commit". Residual hypothesis: latest rate used for a back-dated trade (section 9). |
| MON-H15 | FIXED_VERIFIED | HANDED_TO_S19 | Auto-fill only with no stored price; quote shown as an explicit action. Mutation M7 fails 6 tests incl. "keeps an existing override price when a latest close arrives", "saves the stored price when only the date is changed". |
| MON-H16 | STILL_OPEN (residual) | HANDED_TO_S20 | Request failure and unpriced holdings FIXED (accounts page, dashboard, investments page tests passed). FX-incomplete account and dashboard widget: A26-S02-03. |
| MON-M39 | STILL_OPEN (relocated) | HANDED_TO_S13 | The two named tests now assert `null`/incomplete. The same wrong expectation lives in `report-currency.service.spec.ts:213` and the inverse-zero case (passing): folded into A26-S02-02. |
| MON-M40 | FIXED_VERIFIED | HANDED_TO_S19 | Tests now assert the stored price is kept; mutation M7 detected. |
| MON-M41 | FIXED_VERIFIED | HANDED_TO_S13 | Fixtures use ratio 2 (`net-worth.service.spec.ts:797-822`, `:4001-4002`); mutation M2 detected. No reverse-split case in the net-worth spec (the reducer spec has 0.5). |
| MON-M42 | FIXED_VERIFIED | HANDED_TO_S18 | Failed logout sets the incomplete-logout flag and shows an error toast; mutation M8 fails "does not claim success when authApi.logout fails". |
| MON-M43 | STILL_OPEN (narrowed) | HANDED_TO_S06 | Owner keys asserted per user (`folderFor(id)`); but `:3871`, `:3907` assert the cross-owner legacy sweep as correct: A26-S02-06. |
| MON-M44 | FIXED_VERIFIED | HANDED_TO_S21 | No `--passWithNoTests` in any layer's scripts or workflow; Jest exits 1 on zero matches (executed: `zz-no-such-suite-a26`, exit 1); `jest-config.guard.spec.ts` fails when the flag is added (mutation M11). |
| MON-M45 | STILL_OPEN | HANDED_TO_S21 | `ci.yml:1101-1152`: A26-S02-10. |

Totals: 12 FIXED_VERIFIED, 11 STILL_OPEN in whole or in part (of which 4 STILL_OPEN in full: H05,
H12, M39, M45), 0 SUPERSEDED, 0 NOT_LOCATED, 0 REJECTED.

## 6. Mutation table

All in the scratch worktree `<scratchpad>/mut` at `AUDIT_BASELINE_SHA`, reverted after each run.

| ID | Invariant | Mutation (file:line, what) | Test that fails | Verdict |
| --- | --- | --- | --- | --- |
| M1 | INV-FX-001 | `backend/src/securities/portfolio.service.ts:2147` `?? null` -> `?? 1` | none (`fx-fallback.guard`, `portfolio.service` 187 passed) | undetected (A26-S02-11) |
| M2 | INV-HOLDING-002 | `investment-replay.util.ts:104` `currentQuantity * quantity` -> `+` | 9 tests in `investment-replay.util.spec.ts`, `net-worth.service.spec.ts` | covered |
| M3 | INV-CLAIM-001 | `emergency-access-claim.controller.ts:224-225` drop `AND claim_token_used_at IS NULL` | 1 unit test (`emergency-access-claim.controller.spec.ts`) | covered (unit) |
| M3i | INV-CLAIM-001 | same as M3 | none in `emergency-access-grant-cycles.integration.spec.ts` (15 passed) | undetected at integration (A26-S02-12) |
| M4 | INV-HOLDING-* | `common/db/locks.ts:165` `lockHoldingScope` returns without locking | `holding-concurrent-trades.integration.spec.ts` | covered |
| M6 | INV-IMPORT-002 | `mny-import-job.service.ts:532-533` drop `status = 'running' AND attempt_token = $2` | 3 tests in `mny-import-job.integration.spec.ts` | covered |
| M7 | MON-H15 | `OverrideEditorDialog.tsx:423, 425` drop `!hasStoredPrice` and `investmentPrice === ''` | 6 tests in `OverrideEditorDialog.test.tsx` | covered |
| M8 | MON-M36/M42 | `AppHeader.tsx:271` `toast.error` -> `toast.success` | "does not claim success when authApi.logout fails" | covered |
| M9 | MON-H14 | `InvestmentTransactionForm.tsx:678` return the unconverted total | 3 tests "when no rate can be resolved" | covered |
| M10 | INV-BALANCE (H07) | `accounts.service.ts:1519-1520` remove `lockAccountsForBalanceWrite` | `balance-delta-recompute.integration.spec.ts` | covered |
| M11 | INV-RELEASE-001 (M44) | `backend/package.json` add `--passWithNoTests` to `test:integration` | `jest-config.guard.spec.ts` | covered |
| R1 | MON-H05 | none (baseline code); race spec, two concurrent leg edits 50/70 | scratch spec fails 10/10 | defect demonstrated (A26-S02-01) |
| R2 | MON-H05 | none (baseline code); race spec, double submit 50/50 | scratch spec fails 10/10 | defect demonstrated (A26-S02-01) |

Conceptual, not executed: removing `lockTransactionRow` at `transactions.service.ts:2666` would be
caught only by the mocked unit test "derives the balance delta from the locked row"; no integration
race exists for `update()` / `remove()` (handed to S07 and S21 as MON-M46 evidence).

## 7. Counterexamples and the interaction scenario

| Invariant | Counterexample (not copied from the tests) | Result |
| --- | --- | --- |
| MON-H05 | Same value submitted twice to a split leg (not two different values) | Reproduced: +10.00 / -10.00 drift |
| MON-H06 | A stale tab posting after the cron advanced the schedule | Reachable (A26-S02-04) |
| MON-H04 | A failure after commit followed by a start on the same staged id | Reachable (A26-S02-05) |
| MON-H12 | A custom currency with no provider rate in a built-in report | 1:1 total (A26-S02-02) |
| MON-H16 | FX missing inside one brokerage, all prices present | Complete-looking total (A26-S02-03) |
| MON-H01 | Legacy flat-root file of user B, retention of user A | Deleted (A26-S02-06) |
| MON-H09 | Expired token raced with a valid one | Refused by `claim_token_expires_at >= CURRENT_TIMESTAMP` before any write |
| MON-H08 | Rebuild racing a trade | Both take `lockHoldingScope` before the ledger read; no integration test (section 10) |
| MON-H15 | Delayed quote arriving after a date-only edit | Stored price kept (test passes; mutation detected) |

Interaction scenario. A26-S02-01 meets A26-S02-08 and INV-TRANSFER-001: with the strict
reconciled lock on, a user double-submits an amount edit on a RECONCILED split leg whose parent a
second tab is voiding. The edit is not refused (lock bypassed), both requests read the leg as
active (`counterpartIsVoid` from the snapshot), and each moves both balances by the delta while
the void reverses the parent once: the reconciled leg changes, and both accounts drift by twice the
edit's delta while the parent's balance effect is reversed. Each mechanism alone (reconciled lock,
VOID refusal, row locks elsewhere) is correct; the split-leg early return skips all three.

## 8. Rejected hypotheses

| Candidate | Evidence considered | Why rejected or downgraded | Final classification |
| --- | --- | --- | --- |
| MON-H11 tampered `toAmount` (100 USD -> 999.99 CAD accepted) | `transaction-transfer.service.ts:219-220, 289-334` | A deliberate contract (the bank's settlement figure wins), within the owner's own accounts or with the counterpart's create grant; no privilege change | DESIGN_RISK (section 9) |
| MON-H03 pending row reaped after 5 minutes while the wipe runs | `mny-import-job.service.ts:111-114` | Requires re-authentication plus wipe longer than 5 minutes; the first job's claim then returns null, so only one job imports | DESIGN_RISK, handed to S09 |
| MON-H02 dangling keys from a successful restore | `backup-restore.service.ts:415-447` | Every callee in the post-commit `.then` swallows its errors today; not reachable now | DESIGN_RISK, handed to S06 |
| MON-H07 unlocked `applyOpeningBalance` (2 dp rounding) | `import-entity-creator.service.ts:379-398` | Healed by the locked post-processing recompute unless that fails (logged); narrow | open hypothesis, handed to S10 |
| Transfer-pair link deadlock (row locks before advisory) | `transfer-pair-link.service.ts:108-112, 143` | Availability only (40P01 rollback), not executed | LOW candidate, handed to S12 |
| `skip()` lost update against `post()` | `scheduled-transactions.service.ts:2662-2700` | Loses a skip, duplicates no money; not executed | LOW candidate, handed to S08 |
| MON-H12 frontend `getRate(...) ?? 0` on the currencies page | `app/currencies/page.tsx:226-227` | A sort key, not a figure | REJECTED |
| MON-H13 frontend split replay | searched `frontend/src` for SPLIT quantity arithmetic | None computes split quantity | REJECTED |

## 9. Design risks

- Portfolio `total*` fields stay numeric (the known subtotal) when `valuationComplete` is false (`portfolio-calculation.service.ts:2184-2185`); AGENTS.md says `null` plus a separate subtotal field. Consumers must read the flag, which A26-S02-03 shows they do not everywhere. Owner S13/S20.
- Cross-currency transfer `toAmount` / `exchangeRate` accepted without a tolerance against the market rate (MON-H11). Maintainer policy decision.
- No instance namespace in backup keys (A26-S02-06 second half).
- `currency-conversion.util.ts:20` treats an empty source currency code as "same currency"; protected by a report spec. Hypothesis for S13.
- `investment-transactions.service.ts:782-792` falls back to `getLatestRate` with no age bound when the trade date has no rate (INV-FX-001 "never one struck after it"). Hypothesis for S12/S13.
- `update()` takes `effectiveAccount` / currency from the pre-lock snapshot (`transactions.service.ts:2575-2579, 2799`); `PATCH /transactions/:id` with `amount` on a mirror transfer leg may change one leg only; `update()` vs `updateTransfer` lock order can deadlock. Hypotheses for S07.
- A scheduled transfer into another owner's account can never post (`writeTransferLegs` refuses cross-owner on a caller's manager, `:751-760`). Functional gap, S08.

## 10. Missing tests and known-wrong tests

Known-wrong (assert a defect and pass):
- `backend/src/built-in-reports/report-currency.service.spec.ts:213` "returns original amount when no rate is available" and the inverse-zero case `:247` (A26-S02-02, MON-M39).
- `backend/src/backup/auto-backup.service.spec.ts:3871`, `:3907` (cross-owner legacy sweep, A26-S02-06, MON-M43).

Missing:
- No two-connection test for `transactions.service.update()` / `remove()`, `updateTransfer`, bulk VOID, or the split-leg path (MON-M46 evidence; S07, S21).
- No integration test calls the real scheduled `post()`; nothing races two cash, transfer or investment posts (S08).
- No real-filesystem or real-S3 attachment backup round trip (MON-M47, S06).
- No rebuild-versus-trade, first-buy, buy/sell, split or edit/delete holding race (S12).
- No test of a second MNY start on a committed job's staged file (A26-S02-05).
- `transfers.integration.spec.ts:103` proves only a client-supplied 1.35 rate; no server-resolved or tampered case (S07).
- No portfolio test for a missing spot rate without a time series (A26-S02-11).
- No reverse-split case in `net-worth.service.spec.ts` (S13).

## 11. Documentation inconsistencies

- `docs/concurrency-and-idempotency.md:470-476` says manual posting is covered by the occurrence pin; the HTTP path is not (A26-S02-04).
- `docs/system-invariants.md:219-221` (INV-IMPORT-001) says the reaper fails a crashed job "retryably"; it does so only when `data_committed = false`, and the index is credited to migration 135 only (140 re-creates it).
- `docs/system-invariants.md` INV-IMPORT-002 says the committed run is finalized; nothing re-runs post-processing after a post-commit failure (A26-S02-05).
- `auto-backup.service.ts:2256-2263` documents the legacy sweep as intended, against the upstream remediation (A26-S02-06).
- `net-worth.service.spec.ts` around `:4025`: comment "100 - 30 - 20 + 50 = 100" no longer describes the asserted ratio fixture (cosmetic).

## 12. Review ledger

**Revision.** `AUDIT_BASELINE_SHA` `72c59ec4`; HEAD at start `becd00f`; pin check empty. Not a PR,
so no base, merge base or hosted CI was consulted (hosted CI not checked).

**Suites run (all at the baseline code):**

| Layer | Command | Result |
| --- | --- | --- |
| backend unit | `npx jest emergency-access-claim.controller holdings.service mny-import auto-backup backup.service s3-backup-storage local-backup-storage` | 16 suites, 734 passed, 2 skipped |
| backend unit | `npx jest report-currency.service jest-config.guard transaction-transfer.service transaction-bulk-update scheduled-transactions.service transactions.service.spec reconciled-lock derived-state-writers fx-fallback.guard investment-replay.guard` | 12 suites, 1 331 passed |
| backend integration | `emergency-access-grant-cycles` 15, `holding-concurrent-trades` 1, `mny-import-job` 55, `mny-import.integration` 42, `mny-staging` 13, `backup-restore` 25, `balance-delta-recompute` 1, `transfers.integration` 15, `transactions.integration` 8, `loan-settlement-claim` 11, `cross-owner-transfers` 10, `import-balance-delta` 2, `login-lockout` 6 | 13 suites, 204 passed, 0 failed |
| frontend unit | `npx vitest run useExchangeRates OverrideEditorDialog AppHeader InvestmentTransactionForm PortfolioValueWidget accounts/page logical-accounts PortfolioSummaryCard` | 15 files, 454 passed |
| zero-test check | `npx jest --config ./test/jest-integration.json --runInBand zz-no-such-suite-a26` | exit 1 ("0 matches"), as required |
| mutations | section 6 | 9 covered, 2 undetected |
| race | scratch split-leg specs R1, R2 | defect reproduced 10/10 each |

Integration runs were serial, one at a time, against a local PostgreSQL 16 (`initdb` under
`/var/lib/pgaudit`, role and database `monize_test`, the CI environment variables), never in
parallel with each other.

**Files read in full or by range (this session):** `transaction-transfer.service.ts:1660-1735, 2555-2760`; `report-currency.service.ts:95-125`; `fx-fallback.guard.spec.ts:80-105, 170-176`; `mny-import.service.ts:135-215, 280-335`; `scheduled-transactions.controller.ts:335-360`; `post-scheduled-transaction.dto.ts:85-124`; `PostTransactionDialog.tsx` (post call and date initialization); `ScheduledTransactionListParts.tsx:205-222`; `accounts/page.tsx:110-145`; `PortfolioValueWidget.tsx` (flag search); `import-regular-processor.service.ts:575-612, 765-790`; `reconciled-lock.util.ts:1-60, 168-200`; `locks.ts:155-175, 245-390`; `.github/workflows/ci.yml:120-175, 1095-1215`; `backend/test/jest-integration.json`; `transfers.integration.spec.ts:1-245`; `database/schema.sql:380-425`. Sub-agent reads (cited per finding) were spot-checked at the lines used here.

**Searches:** `passWithNoTests` across scripts and workflows; `expectedDueDate` in the scheduler; `staging.remove|stagedFileId|data_committed` in `import/mny`; `assertReconciledRowsMutable` in the transfer service; `valuationComplete|fxComplete` in the widget; `\brate\w*` guard pattern; split-quantity arithmetic in `frontend/src`.

**Reviewed without a finding:** H02 export/stage/restore ordering; H03 start/create/wipe ordering; H07 absolute writers; H08 holding lock namespace; H09 consume; H13 replay sites; H14 form; H15 dialog; M42 logout; M44 discovery.

**Finding counts:** BLOCKER 0, HIGH 2, MEDIUM 8, LOW 2.

**Text for the ledger (orchestrator merges):**
- Session status: S02 done; commit: the final commit of this file; findings B/H/M/L 0/2/8/2.
- Toolchain: Node 24.22.1; `npm ci` OK both layers; no Docker daemon in this container, PostgreSQL 16 started from `/usr/lib/postgresql/16/bin` with `initdb` (trust auth on 127.0.0.1) and role/db `monize_test`; `npm run build` OK; Jest on zero integration matches exits 1.
- Prior findings disposed (triage): 23 of 70 triaged, all `HANDED_TO_<owner>`; 12 FIXED_VERIFIED, 11 STILL_OPEN in whole or part.
- Undetected mutations: `INV-FX-001 | portfolio.service.ts:2147 ?? null -> ?? 1 | fx-fallback.guard.spec.ts or portfolio.service.spec.ts | S02`; `INV-CLAIM-001 | emergency-access-claim.controller.ts:224-225 drop used_at predicate | emergency-access-grant-cycles.integration.spec.ts | S02`.
- Open hypotheses handed on:
  - from S02 to S07: A26-S02-01, -07, -08; `update()` currency from snapshot; mirror-leg amount-only PATCH; `update()` vs `updateTransfer` lock order; execute the bulk VOID race.
  - from S02 to S08: A26-S02-04; `skip()` lost update; cross-owner scheduled transfer cannot post.
  - from S02 to S09: A26-S02-05; pending row reaped during a long wipe.
  - from S02 to S06: A26-S02-06; staged-object cleanup chained after the post-commit `.then`; MON-M47 round trip.
  - from S02 to S10: A26-S02-09; `applyOpeningBalance` unlocked and 2 dp.
  - from S02 to S12: transfer-pair-link lock order deadlock; latest-rate fallback for back-dated trades; holding race coverage gaps.
  - from S02 to S13: A26-S02-02, -11; empty currency code treated as same currency.
  - from S02 to S20: A26-S02-03; non-null partial `total*` fields.
  - from S02 to S21: A26-S02-10; MON-M46 evidence (no two-connection tests for the ledger paths).
  - from S02 to S03: A26-S02-12.
- Deviations: S01 not waited for (orchestrator override); PostgreSQL from the container's binaries instead of Docker (no daemon); report written by S02 only, ledger/sessions/register left to the orchestrator (override); dispositions are triage, final call with owners.

## 13. Adversarial approval challenge

Assumption: "most of the upstream HIGHs are fixed" is wrong. Started from the abstractions the
fixes introduced, not from the findings:

- `lockTransactionRow(s)`: searched for transfer and split write paths that return before reaching
  a lock. Found the split-leg early return (A26-S02-01) and executed it; it also skips the
  reconciled lock (A26-S02-08).
- The occurrence pin `expectedDueDate`: searched every caller of `post()`; the HTTP route is the
  one without it (A26-S02-04).
- `data_committed`: asked what else can start a job over the same bytes; `start` can (A26-S02-05).
- `valuationComplete`: searched every consumer of `totalMarketValue` / `totalPortfolioValue`; two
  surfaces read a narrower proxy or nothing (A26-S02-03).
- `RETURNS_ITS_INPUT_UNCONVERTED`: an allowlist is the gap stated as data; the reports remain 1:1
  (A26-S02-02); the guard's regex itself was then mutation-tested (A26-S02-11).
- Each `FIXED_VERIFIED` was attacked with a mutation; the one whose proof sat in a copied SQL
  string was found (A26-S02-12).
- Per-user backup folders: asked who else writes into the root; legacy files and same-id instances
  (A26-S02-06).

Not challenged in this session: RLS behaviour under the unprivileged role (S04), real S3, the E2E
layer, and the races marked static (A26-S02-07).

## 14. Verdict

**REQUEST CHANGES** for the slice. Two HIGH findings survived the challenge: A26-S02-01 (executed,
10/10) and A26-S02-02 (asserted by a passing test). Of the 16 upstream HIGHs, 8 are fixed and proven
by a passing test (H02 by unit and database-provider integration only; H03 by its integration race
tests; H07, H08, H09, H13, H14 and H15 also by a mutation the test catches), and 8 remain open in whole or in part. Every disposition is triage evidence for the owning session
and needs a specialist's review before it reaches a maintainer decision.
