# S22 Delta review: `AUDIT_BASELINE_SHA` to `main`

## 1. Metadata

| Field | Value |
| --- | --- |
| Session | S22 (child session_014uWBGZjh8U2E8eYrTBBQUi) |
| `AUDIT_BASELINE_SHA` (delta base) | `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86` (`chore: bump version to 1.19.0 [skip ci]`, committed 2026-10-21 18:05:37 UTC) |
| `MAIN_SHA` (delta head, `PR_REVIEW_SHA` for this session) | `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86` -- **equal to the baseline** |
| How `MAIN_SHA` was established | `git fetch origin main` then `git rev-parse origin/main`; `git ls-remote origin main` at start and again before the final commit; GitHub API `list_commits(sha=main)` first entry. All three give `72c59ec4...`. |
| Merge base, ahead/behind | `git merge-base 72c59ec4 origin/main` = `72c59ec4`; `git rev-list --left-right --count 72c59ec4...origin/main` = `0 0` |
| Tree identity | `git rev-parse 72c59ec4^{tree}` = `git rev-parse origin/main^{tree}` = `7da5b2da879ff9bc0498d2b5c6831ae8ac2b7e2d` |
| Delta | `git diff 72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86...origin/main`: 0 bytes, 0 files |
| Audit branch HEAD at start | `f7690b349e882c2b652246c4b14712e57cb51610` (after `git pull --rebase`); `0e45036ff5fec68a532576befe24824d0a97ae31` after the second pull (S19 final and an S21 partial landed) |
| Pin check (plan step 2) | `git diff --stat 72c59ec4 HEAD -- . ':!docs/audits/2026-10' ':!docs/audits/2026-08-upstream'` run from the repository root: empty |
| Date | 2026-10-21 / 2026-10-22 UTC |
| Primary path | `git diff 72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86...origin/main` |
| Hint line | `treat the delta as a PR whose base is AUDIT_BASELINE_SHA: re-pin to the current main SHA for this session only, inspect the delta, re-run every invariant a session marked material that the delta touches, classify every change against the open A26 findings (fixed, unchanged, reopened, new), and run the adversarial approval challenge on the delta's new abstractions` (verbatim from `sessions.md` S22) |
| Worktree | `git worktree add --detach <scratchpad>/main origin/main` (HEAD `72c59ec4`), Node 24.22.1, `npm ci` in `backend/` and `frontend/`: both exit 0 |
| Runtime executed | 8 runs at `MAIN_SHA`, all green; see section 12.4. PostgreSQL 16 (`mirror.gcr.io/library/postgres:16-alpine`) in a container; `dockerd` started by hand. |
| Hosted CI for `MAIN_SHA` | none: no `ci.yml` run exists for `72c59ec4` in `WMP/monize` (the commit carries `[skip ci]`). See section 12.5. |

**Consequence.** `main` has not moved since the program pinned it. The delta is empty, so no
change can fix, reopen, or add a finding. Per the orchestrator's override, this report gives the
empty-delta classification and re-checks every A26 HIGH and every `STILL_OPEN` prior finding
against the baseline test suites, at `MAIN_SHA`, in a separate worktree.

## 2. Invariant map

The delta introduces no field, state, helper, migration, or consumer. Thus no invariant is
touched by the delta. The material invariants that the 21 session reports mark, and that the
delta could have changed, are the ones behind the open HIGH findings. The table names them with
the mechanism the session found missing or bypassed; the full
`producer -> transformations -> storage -> consumers -> side effects` chain of each is in the owning
report's section 2 and is not repeated here, because no link in any chain changed.

| Invariant | Statement (short) | Mechanism (as found at the baseline) | Open HIGH findings on it | Delta touches it |
| --- | --- | --- | --- | --- |
| INV-BALANCE-001 | A stored balance equals its ledger | atomic deltas; `lockAccountsForBalanceWrite`; derivation from the locked row | S02-01/S07-01, S07-02, S12-01, S13-03, S19-01, S19-02 | no |
| INV-FX-001 / INV-FX-003 | A failed rate lookup is unknown, never 1 or the unconverted amount; a rate has an age bound | `resolveFxRate`, `FxAggregate` | S02-02/S13-01, S13-02, S16-01 | no |
| INV-AUTH-001 | A second presentation of a refresh token revokes the family | reuse branch in `token.service.ts` | S03-01 | no |
| INV-OCCURRENCE-001 | One occurrence, one financial effect, on every entry point | occurrence pin (`expectedDueDate`) on cron, AI, receipt paths | S08-01 | no |
| INV-IMPORT-002 | A committed import run is never replayed | `data_committed` flag, `fail()` | S09-01 | no |
| INV-BANKSYNC-001 | One provider transaction gives at most one row across syncs | entry-reference keying in the planner | S10-01 | no |
| INV-RECEIPT-008 / -003 | A forwarded block cannot change who sent the email | `resolveForwardedIdentity` | S11-04 | no |
| INV-LOAN-007 / -010 | A mortgage-type change reprices the template; a managed template stays managed | update-time reprice; undo restores columns only | S15-01 | no |
| Completeness flags (`valuationComplete`, `fxComplete`) | A subtotal is never shown under a total's caption | flags in the backend response; frontend readers | S20-01 | no |

## 3. Lens ledger

| Lens | Status |
| --- | --- |
| Pin the exact review revision | ran: section 1; re-fetched before the final commit |
| Read repository instructions first | ran: `AGENTS.md`, root `CLAUDE.md`, `plan.md`, `sessions.md` (S22 block), `ledger.md`, `prior-findings-register.md`, `.claude/commands/audit.md` (the protocol) |
| Summaries as hypotheses | ran: no session conclusion is accepted here as a disposition of the delta; each HIGH is re-checked by its baseline tests at `MAIN_SHA` (section 5, section 12.4) |
| Invariant model | ran: section 2 |
| Complete change surface | ran: the change surface is empty (0 files, identical tree hash); there is no producer or consumer to search |
| Cross-layer verification | not applicable because no layer changed; the cross-layer evidence of each HIGH is in its owning report and stays valid on an identical tree |
| Representation boundary | not applicable because no value, DTO, column, or type changed |
| Browser/UI round trip | not applicable because no frontend file changed; the frontend suites of A26-S19-01/-02 and A26-S20-01 were re-run at `MAIN_SHA` (green, i.e. the defects stay undetected) |
| Server-authoritative metadata | not applicable because no request path changed |
| Identity versus value | not applicable because no identifier or correlation changed |
| State machine | not applicable because no lifecycle code changed |
| Concurrency and idempotency | not applicable for the delta; the two-connection suites that exist for the HIGH paths (`transfers`, `cross-owner-transfers`, `scheduled-loan-pricing-concurrency`, `mny-import-job`) were re-run at `MAIN_SHA`: green |
| Partial failure and compensation | not applicable because no side-effect ordering changed |
| External provider lookup | not applicable because no provider adapter changed |
| Database and migration | ran: 0 migrations and no `database/schema.sql` change in the delta; schema parity is the baseline's (S05: `scripts/verify-schema.sh` OK) |
| Backup/restore | not applicable for the delta; the backup suites behind MON-H01, M22, M43, M47 were re-run (section 12.4) |
| Financial and loan | not applicable because no calculation changed; no new numerical example is possible |
| Authorization, authentication, RLS | not applicable because no guard, policy, or context call changed |
| Tests are evidence, not proof | ran: the re-run suites are green, which on an unchanged tree means the HIGH defects stay undetected by the baseline tests; the known-wrong test of MON-M39 still passes (`report-currency.service.spec.ts:212-217`) |
| Mutation / break-on-purpose | not applicable for the delta (nothing to mutate); section 6 |
| Counterexample | ran in the form the empty delta allows: section 7 |
| Interaction testing | ran: section 7 |
| Rejected hypotheses | ran: section 8 |
| Adversarial approval challenge | ran: section 13 |
| Final merge gate | ran: section 14 (hosted CI unavailable for `MAIN_SHA`, stated) |

## 4. Confirmed findings

None in the delta. The delta has no hunk, so no candidate can be `INTRODUCED_BY_PR` or
`EXPOSED_OR_AMPLIFIED_BY_PR`. Every open A26 finding stays open, unchanged, at `MAIN_SHA`.

### 4.1 Classification of every delta change

| Delta change | Class (fixed / unchanged / reopened / new) | Findings affected |
| --- | --- | --- |
| (none: 0 files) | -- | -- |

### 4.2 Every A26 HIGH at `MAIN_SHA`

18 HIGH findings are confirmed at the time of this report (ledger running count, S19 final at
`a9f53b1`). For each, the delta has no hunk at the location. The "baseline tests" column names
the suites re-run at `MAIN_SHA`; green means the defect is still not detected by any of them.

| Finding | Location (owning report) | Delta changes it | Baseline tests re-run at `MAIN_SHA` |
| --- | --- | --- | --- |
| A26-S02-01 (carried by A26-S07-01) | `backend/src/transactions/transaction-transfer.service.ts:1717-1735`, `:2561-2758` | untouched | `transaction-transfer.service.spec.ts`; integration `transfers`, `cross-owner-transfers`: green |
| A26-S02-02 (superseded by A26-S13-01) | `backend/src/built-in-reports/report-currency.service.ts:99-121` | untouched | `report-currency.service.spec.ts`: green, including the known-wrong case at `:212-217` |
| A26-S03-01 | `backend/src/auth/token.service.ts:164-177` | untouched | `token.service.spec.ts`; integration `auth-state-tables`: green |
| A26-S07-01 | `backend/src/transactions/transaction-transfer.service.ts:2561-2758` | untouched | as A26-S02-01 |
| A26-S07-02 | `backend/src/action-history/action-history.service.ts:1742-1764`, `:172-195` | untouched | `action-history.service.spec.ts`: green |
| A26-S08-01 | `backend/src/scheduled-transactions/scheduled-transactions.controller.ts:329-368`; `dto/post-scheduled-transaction.dto.ts` | untouched | `scheduled-transactions.controller.spec.ts`, `scheduled-transactions.service.spec.ts`; integration `scheduled-loan-pricing-concurrency`: green |
| A26-S09-01 | `backend/src/import/mny/mny-import-job.service.ts:604-631`, `:679-691` | untouched | `mny-import-job.service.spec.ts`; integration `mny-import-job`: green |
| A26-S10-01 | `backend/src/bank-sync/bank-transaction-planner.ts:381-413`, `:544-551` | untouched | `bank-transaction-planner.spec.ts`; integration `bank-sync`: green |
| A26-S11-04 | `backend/src/email-receipts/imap/forwarded-receipt.ts:33-71` | untouched | `forwarded-receipt.spec.ts`; integration `email-receipts-pipeline`: green |
| A26-S12-01 | `backend/src/securities/investment-transactions.service.ts:4321`, `:4473-4480` | untouched | `investment-transactions.service.spec.ts`; integration `investment-transactions`: green |
| A26-S13-01 | `backend/src/built-in-reports/report-currency.service.ts:99-121`; `backend/src/common/currency-conversion.util.ts:20-22` | untouched | `report-currency.service.spec.ts`, `fx-fallback.guard.spec.ts`: green |
| A26-S13-02 | `backend/src/currencies/exchange-rate.service.ts:916-927`; `currencies.controller.ts:137-147` | untouched | `exchange-rate.service.spec.ts`; integration `fx-rate-coverage`: green |
| A26-S13-03 | `backend/src/transactions/transaction-bulk-update.service.ts:556-572` | untouched | `transaction-bulk-update.service.spec.ts`: green |
| A26-S15-01 | `backend/src/action-history/action-history.service.ts:1741-1764`, `:172-212` | untouched | `action-history.service.spec.ts`: green |
| A26-S16-01 | `backend/src/budgets/budget-spending.util.ts:124-155`, `:179-192` | untouched | `budget-spending.util.spec.ts`; integration `budget-split-transfer-spending`: green |
| A26-S19-01 | `frontend/src/components/transactions/TransactionForm.tsx:341-343`, `:1256-1277` | untouched | `TransactionForm*` tests (7 files with the three below): green |
| A26-S19-02 | `frontend/src/components/transactions/TransactionForm.tsx:495-517`, `:1279-1293`, `:1520-1567` | untouched | as A26-S19-01 |
| A26-S20-01 | `frontend/src/types/net-worth.ts:3-15`; `app/accounts/page.tsx:115-141`; `components/dashboard/PortfolioValueWidget.tsx:149, 287-291`; `lib/logical-accounts.ts:225-240` | untouched | 11 files (`PortfolioValueWidget`, `AccountList`, `logical-accounts`, `net-worth`, `NetWorthReport`, `NetWorthChart`, `InvestmentValueChart`, ...): green |

S21 was still in progress when this report was written (partial at `0e45036`); its findings so
far are MEDIUM and LOW (A26-S21-01..06). An S21 HIGH confirmed later is also "untouched": the
delta is empty, so the statement holds for any finding against the baseline.

## 5. Prior-finding dispositions: the delta's effect on every `STILL_OPEN` row

Register read at `0e45036`. S22 makes no new disposition; it states that `MAIN_SHA` leaves each
row as the owning session left it.

| Prior finding | Register disposition | A26 carrier | Delta changes it | Re-check at `MAIN_SHA` |
| --- | --- | --- | --- | --- |
| MON-H01 | STILL_OPEN | A26-S06-01 (`auto-backup.service.ts:2253-2311`, `local-backup-storage.target.ts:335-341, 427-434`) | untouched | `auto-backup.service.spec.ts`, `local-backup-storage.target.spec.ts`: green (2 root-only skips, as S01) |
| MON-H04 | STILL_OPEN | A26-S09-01 | untouched | as A26-S09-01 (section 4.2) |
| MON-H05 | STILL_OPEN | A26-S07-01 | untouched | as A26-S07-01 |
| MON-H06 | STILL_OPEN (residual) | A26-S08-01 | untouched | as A26-S08-01 |
| MON-H10 | STILL_OPEN (residual) | A26-S07-03 (`transaction-bulk-update.service.ts:204-211, 1184-1245`; `transaction-split.service.ts:1197-1226`) | untouched | `transaction-bulk-update.service.spec.ts`, `transaction-split.service.spec.ts`: green |
| MON-H11 | STILL_OPEN (server, QIF and client halves) | A26-S07-04 (`transactions.service.ts:2534-2984`), A26-S10-02 (`import-regular-processor.service.ts:589-623`), A26-S19-01 | untouched | `transactions.service.spec.ts`, `import-regular-processor.service.spec.ts`, `TransactionForm*`: green |
| MON-H12 | STILL_OPEN | A26-S13-01, A26-S13-02 | untouched | as section 4.2 |
| MON-H14 | STILL_OPEN (server and client halves) | A26-S12-02 (`investment-transactions.service.ts:780-793`), A26-S19-04 (`InvestmentTransactionForm.tsx:613-664`, `InvestmentSplitFields.tsx:118-140`) | untouched | `investment-transactions.service.spec.ts`, `InvestmentTransactionForm*`, `InvestmentSplitFields*`: green |
| MON-H16 | STILL_OPEN | A26-S20-01 | untouched | as A26-S20-01 |
| MON-M20 | STILL_OPEN (residual) | A26-S07-06 (`accounts.service.ts:1264-1349, 2178-2260`) | untouched | `accounts.service.spec.ts`: green |
| MON-M22 | STILL_OPEN | A26-S06-03 (`backup-attachment-transfer.service.ts:503-542`) | untouched | `backup.service.spec.ts`; integration `backup-restore`: green |
| MON-M35 | STILL_OPEN | A26-S12-04 (`portfolio-calculation.service.ts:1302-1310, 293-311`) | untouched | `portfolio-calculation.service.spec.ts`; integration `security-transfer`: green |
| MON-M37 | STILL_OPEN (different root cause) | A26-S19-03 (`CurrencyInput.tsx:118-124, 190-193, 209-239`) | untouched | `CurrencyInput*` tests: green |
| MON-M38 | STILL_OPEN (narrowed) | A26-S18-01 (`frontend/src/lib/categories.ts:69-78`, `payees.ts:187-204`) | untouched | `categories.test.ts`, `payees.test.ts`, `apiCache` tests: green |
| MON-M39 | STILL_OPEN (relocated) | A26-S13-01 | untouched | the known-wrong test `report-currency.service.spec.ts:212-217` ("returns original amount when no rate is available", `expect(result).toBe(1000)`) is still present and passes |
| MON-M43 | STILL_OPEN | A26-S06-01 | untouched | as MON-H01 |
| MON-M47 | STILL_OPEN (missing test) | A26-S06-05 | untouched | the gap stays: `backup-restore.integration.spec.ts` still runs the database provider only |
| MON-L04 | STILL_OPEN (narrowed) | A26-S09-04 (`mny-staging.service.ts:160-216`, `mny-import.controller.ts:213-226`) | untouched | `mny-staging.service.spec.ts`; integration `mny-staging`: green |
| MON-M11 (Helm half) | open, S21 | -- | untouched | not re-run (no Helm render in this session) |
| MON-M45 | open, S21 (S02 triage STILL_OPEN, A26-S02-10) | A26-S02-10 | untouched; note that `MAIN_SHA` itself is a `[skip ci]` version-bump commit with no hosted CI run (section 12.5), which is the scenario the finding describes | -- |
| MON-M01, M44, M46, L07 | open, S21 | -- | untouched | -- |

## 6. Mutation table

The delta has no line to mutate, so this session adds no row. Because the tree at `MAIN_SHA` is
byte-identical to the baseline (same tree hash), every `covered` and `undetected` row of the
program-wide table in `ledger.md` holds at `MAIN_SHA` without re-execution.

| Invariant | Mutation | Test that fails | Verdict |
| --- | --- | --- | --- |
| (none: empty delta) | -- | -- | -- |

## 7. Counterexamples and the interaction scenario

- **Counterexample to "the delta is empty".** A shallow clone can hide history, and a fetched ref
  can be stale. Checked against three sources (`git fetch`, `git ls-remote`, GitHub API) at start
  and before the final commit; all give `72c59ec4`. Tree hashes are equal, so even a different
  commit with the same tree would carry no code change. Not reproduced.
- **Counterexample to "a re-run green suite means nothing changed".** On an identical tree, a
  green run proves only that the environment reproduces the baseline result; it is not evidence
  that a HIGH is fixed. Every green run in section 4.2 is read as "still undetected", in line with
  the owning session's mutation rows.
- **Interaction scenario.** `MAIN_SHA` is a `[skip ci]` bump on top of `bfb57ca` (`[skip ci]`)
  and `3519269` (`fix(deps)`, lock files only: `backend/package-lock.json`, `frontend/package-lock.json`).
  No `ci.yml` push run on `main` exists for any of the three (section 12.5); whether `3519269` was
  tested on a pull-request branch was not established. The lock-file change and the release bump
  thus reached `main` with no hosted push run on `main` in this repository.
  This is A26-S02-10 / MON-M45 (S21) interacting with a dependency change: the revision that
  `main` and any image built from it carry is a revision that no hosted pipeline tested. The
  local runs of this session (and S01's full baseline run) are the only test evidence for
  `72c59ec4`; they are green on the suites named. No new finding: the root cause is A26-S02-10,
  already open with S21.

## 8. Rejected hypotheses

| Candidate | Evidence considered | Why rejected or downgraded | Final classification |
| --- | --- | --- | --- |
| `main` moved after the program pinned it | `git ls-remote`, `git fetch`, GitHub `list_commits`; tree hash | all equal to the baseline | REJECTED |
| The audit branch carries a code change beyond `docs/audits/` | pin check from the repository root: empty | a first run from `docs/audits/2026-10/` listed the audit reports only because the exclusion pathspecs resolve against the working directory; re-run from the root is empty | REJECTED (operator error, recorded) |
| A HIGH could be fixed or worsened by the delta | 0-byte delta | no hunk exists | REJECTED for all 18 HIGH |
| Integration suites skip silently against the container database | 238 + 60 integration tests reported passed, 0 skipped; the `pretest:integration` hook created `monize_test` | the suites ran against PostgreSQL | REJECTED |
| The fork's last hosted `ci.yml` run on `main` (run 253 on `0d99f8f`, 2026-10-16, conclusion `failure`) means `main` is red | job list: every test job `success`; only `Build & Push Preview (backend/frontend)` failed; `0d99f8f` is not in the local clone of `main`'s history (ancestry not established) | a preview-image push failure on an older, possibly non-ancestor commit says nothing about `72c59ec4`'s tests | DESIGN_RISK for S21 (hosted CI on this fork does not track `main`); not a delta finding |

## 9. Design risks

- **No hosted CI evidence for `MAIN_SHA`.** The head of `main` and the two commits below it are
  `[skip ci]`; the newest hosted `ci.yml` push run on `main` in `WMP/monize` is from 2026-10-16
  on a commit not present in the fetched history. The program's only test evidence for the
  audited revision is local (S01's full run and this session's focused runs). This joins
  A26-S02-10 / MON-M45 and INV-RELEASE-001 (`partial`) with S21; S23 should state it in the
  final report's limitations.

## 10. Missing tests and known-wrong tests

No new item: the delta adds or removes no test. Confirmed still present at `MAIN_SHA`: the
known-wrong test of MON-M39 (`backend/src/built-in-reports/report-currency.service.spec.ts:212-217`).

## 11. Documentation inconsistencies

None introduced by the delta. One note for the plan: `plan.md` section 4 step 2's pin-check
command uses pathspecs that resolve against the working directory, so it must be run from the
repository root; run from `docs/audits/2026-10/` it reports the audit reports as a code change.

## 12. Review ledger

### 12.1 Revisions

- `AUDIT_BASELINE_SHA` = `MAIN_SHA` = `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86`; merge base the
  same; ahead/behind `0/0`; tree `7da5b2da879ff9bc0498d2b5c6831ae8ac2b7e2d`.
- Audit branch HEAD: `f7690b3` at start, `0e45036` after the second pull; this report's final
  commit is on top of the latest remote head at push time.

### 12.2 Reports read, and at which commit

| Report | Commit read at | Read |
| --- | --- | --- |
| `01`..`18`, `20` | `f7690b3` | finding headings, severity and Location of every A26 finding in section 4; HIGH findings' fields 3-6; section 5 through the register |
| `19-frontend-forms.md` | `09905c2` (draft) then `0e45036` (final, `a9f53b1`) | headings, severity and Location of A26-S19-01..07; section 5 rows for MON-H11/H14/M28/H15/M40; section 14 |
| `21-tests-ci-release.md` | `f7690b3` (partial) then `0e45036` (partial) | headings and severity of A26-S21-01..06; inventory |
| `plan.md`, `sessions.md` (S22 block), `ledger.md`, `prior-findings-register.md` | `f7690b3`; register and ledger re-read at `0e45036` | in full |

Deviation: sections 4 and 5 of the reports were read by heading, severity, location and
disposition, not line by line. With an empty delta, the classification needs only the location of
each finding and its disposition; no finding text needed re-judgment.

### 12.3 Searches and call sites

- `git diff` / `git diff --stat` / `git rev-list` / tree hashes between `72c59ec4` and `origin/main`.
- Severity extraction over every `NN-*.md` (`### A26-*` headings and the next "Severity" line).
- GitHub API: `list_commits(main)`, `actions_list` (all runs on `main`; `ci.yml` runs on `main`;
  jobs of run 38943045470), `get_commit(0d99f8f)`.
- No source call site was inspected: no source file changed.

### 12.4 Suites run at `MAIN_SHA` (worktree, Node 24.22.1, `TZ=UTC`)

| Run | Command (from the layer directory) | Result |
| --- | --- | --- |
| Backend unit, HIGH set | `npx jest` over 14 specs: `transaction-transfer.service`, `report-currency.service`, `token.service`, `action-history.service`, `scheduled-transactions.controller`, `scheduled-transactions.service`, `mny-import-job.service`, `bank-transaction-planner`, `forwarded-receipt`, `investment-transactions.service`, `exchange-rate.service`, `transaction-bulk-update.service`, `budget-spending.util`, `fx-fallback.guard` | 14/14 suites, 1 398/1 398 tests passed |
| Backend integration, HIGH set | `npm run test:integration -- '<pattern>'`: `bank-sync`, `email-receipts-pipeline`, `fx-rate-coverage`, `cross-owner-transfers`, `mny-import-job`, `transfers`, `investment-transactions`, `budget-split-transfer-spending`, `scheduled-loan-pricing-concurrency`, `auth-state-tables` | 10/10 suites, 238/238 tests passed |
| Backend unit, STILL_OPEN set | `npx jest` over 9 specs: `accounts.service`, `auto-backup.service`, `backup.service`, `local-backup-storage.target`, `import-regular-processor.service`, `mny-staging.service`, `portfolio-calculation.service`, `transaction-split.service`, `transactions.service` | 9/9 suites; 1 247 passed, 2 skipped (the root-only backup permission tests, as S01) |
| Backend integration, STILL_OPEN set | `npm run test:integration -- '<pattern>'`: `backup-restore`, `security-transfer`, `ofx-import-fitid`, `mny-staging` | 4/4 suites, 60/60 tests passed |
| Frontend, A26-S20-01 set | `npx vitest run` over 11 files (`PortfolioValueWidget`, `AccountList` x2, `logical-accounts`, `net-worth`, `net-worth-account-types`, `NetWorthChart`, `NetWorthReport` x2, `NetWorthByAccountTypeChart`, `InvestmentValueChart`) | 11/11 files, 333/333 tests passed |
| Frontend, A26-S18-01 set | `npx vitest run` over `categories.test.ts`, `payees.test.ts`, `apiCache` | 3/3 files, 64/64 tests passed |
| Frontend, A26-S19 set | `npx vitest run` over `TransactionForm*`, `CurrencyInput*`, `InvestmentTransactionForm*`, `InvestmentSplitFields*` | 7/7 files, 426/426 tests passed |

Integration suites ran one at a time (`--runInBand`, never in parallel with each other). Logs are
in the session scratchpad (`unit-high.log`, `integ-high.log`, `unit-open.log`, `integ-open.log`,
`fe-high.log`, `fe-open.log`, `fe-s19.log`).

### 12.5 Hosted CI

- No `ci.yml` run exists for `72c59ec4` in `WMP/monize`; it, `bfb57ca` and several commits below
  carry `[skip ci]`. The lock-file commit `3519269` (`fix(deps): bump vite to 8.3.5 and hono to
  4.13.13`) has no `ci.yml` push run on `main` either; a pull-request run for it was not searched.
- Newest `ci.yml` push run on `main`: run 253 (id 38943045470), head `0d99f8f`, 2026-10-16,
  conclusion `failure`: all test, lint, schema-drift, E2E and audit jobs `success`; `Build & Push
  Preview (backend)` and `(frontend)` `failure`; release jobs skipped. `0d99f8f` exists on GitHub
  but not in the local (shallow) history of `main`; ancestry not established.
- Hosted CI was not converted into a result for `MAIN_SHA`. The local runs above are the evidence.

### 12.6 Text for the ledger (orchestrator merges it)

- `main` at last delta check: `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86` (2026-10-22), equal to
  `AUDIT_BASELINE_SHA`; delta empty (0 files, same tree hash).
- S22: done; findings 0/0/0/0; verdict for the delta APPROVE (empty delta), see section 14.
- Reports read and their commits: section 12.2.
- Suites run: section 12.4, all green; hosted CI none for `MAIN_SHA` (section 12.5).
- Every A26 HIGH (18) and every STILL_OPEN prior finding: untouched by the delta (sections 4.2, 5).
- Open hypotheses handed on:
  - to S23: state in the final report that the audited revision has no hosted CI run (`[skip ci]`
    head, lock-file change `3519269` beneath it); join to A26-S02-10 / MON-M45 and INV-RELEASE-001.
  - to S23: re-fetch `main` before writing the final report; if it moved, a second delta review is
    needed (this report covers `72c59ec4` only).
  - to S21: the fork's hosted CI has no push run on `main` after 2026-10-16, and that run's head
    is not in `main`'s fetched history.
- Deviations: sections 4/5 of the session reports read by heading, severity, location and
  disposition (section 12.2); `dockerd` started by hand; the plan's pin-check command must be run
  from the repository root (section 11).

## 13. Adversarial approval challenge

Assumption: "the empty-delta APPROVE is wrong". Started from the delta's own abstractions: there
are none (no new field, state, helper, migration, endpoint or component). So the challenge
attacked the premises of the conclusion instead.

1. **Is the delta really empty?** Three independent sources for `main`'s head, the merge base,
   `0/0` ahead/behind and identical tree hashes. Re-checked before the final commit. Holds.
2. **Could a later push to `main` during the session invalidate it?** `git ls-remote origin main`
   before the final commit: `72c59ec4`. The report names the SHA it covers; S23 is told to
   re-fetch (section 12.6).
3. **Could the worktree differ from `MAIN_SHA`?** `git -C <worktree> rev-parse HEAD` =
   `72c59ec4`; `npm ci` from the committed lock files; no file edited.
4. **Could "green" be a false green?** Discovered counts are non-zero on every run (1 398, 238,
   1 247, 60, 333, 64, 426); the 2 skips are the documented root-only cases; the integration
   suites ran against a real PostgreSQL 16. Green here is read as "the HIGH defects remain
   undetected", which is what the owning sessions' mutation rows predict.
5. **Is there a path by which an unchanged tree still changes behaviour?** Run-time inputs only:
   environment, dependencies, provider data. Dependencies come from the same lock files; no
   environment default changed (no `.env.example`, Helm or Compose hunk). Not found.
6. **Is APPROVE of the delta read as APPROVE of `main`?** It must not be. `main` carries every open
   finding of the program, including 18 HIGH; section 14 says so.

Result: nothing invalidates the empty-delta conclusion.

## 14. Verdict

- Reviewed SHA: `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86` (`MAIN_SHA` = `AUDIT_BASELINE_SHA`).
- **Delta verdict: APPROVE** -- the delta is empty, so it introduces, fixes and reopens nothing.
  Confirmed findings in the delta: BLOCKER 0, HIGH 0, MEDIUM 0, LOW 0.
- **This is not an approval of `main`.** `main` is the audited baseline and carries every open
  A26 finding, among them 18 HIGH (section 4.2) and every `STILL_OPEN` prior finding (section 5);
  the program verdict stays with S23 and is REQUEST CHANGES on the strength of the session
  verdicts already recorded.
- Independently verified: the delta is empty (three sources, tree hash); the baseline suites for
  every HIGH and every STILL_OPEN row run green at `MAIN_SHA`; the MON-M39 known-wrong test is
  still present and passing.
- Limitations: hosted CI has no run for `MAIN_SHA`; Playwright and the full unit and integration
  suites were not re-run (S01's full run covers the identical tree); S21 was still in progress.
- The mandatory adversarial close-out pass was completed (section 13).
