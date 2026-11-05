# Audit 2026-10 Remediation: Agent Task List

> Companion to [`23-final-report.md`](./23-final-report.md) (the findings, their evidence and the
> suggested diffs). One task per session/PR, in dependency order, P0 first. Mark a task done by
> checking its box and noting the PR. The remediation is a separate program: it starts from a
> Discussion that links this list and gets the `approved-to-build` label (`CONTRIBUTING.md`).

## How to use this list (read first, every session)

- **One task per session/PR.** Each task names the canonical findings it closes, every surface
  of each (Rule 7: a task that fixes the primary surface and not the merged ones leaves the
  finding open), the invariants, the files and the regression tests. Touching files outside the
  task's scope is a scope violation: stop and leave a note instead.
- **Red test first.** Every finding's section in the final report has a suggested regression-test
  diff (field 13) and a verification method (field 14). Land the test failing against the
  unfixed code in the PR's first commit, then the fix. Where the final report names a mutation
  family of `21-tests-ci-release.md` section 6.2, re-run that mutation after the fix: the row must
  turn `covered`.
- **The suggested diffs are illustrative**, written against `72c59ec4`. Re-locate code by symbol,
  never by line; re-read the finding's field 15 (residual risks) before relying on its diff.
- **Severity is the group's.** A canonical finding's severity is set in the final report, section
  6.2; a merged surface is fixed in the same PR as its primary.
- **Definition of done for every task** (in addition to its gate):
  - the gate commands of the layers it touches (each block names them), run once and quoted in
    the PR;
  - stage new files before running a guard (`git add -N` is enough);
  - new user-facing strings: English catalogs first, then `npm run i18n:pseudo`; the full-locale
    pass is the PR's final commit (`AGENTS.md`);
  - the `docs/system-invariants.md` entry the task touches states the mechanism after the fix,
    and its status is changed only when the mechanism and its test exist;
  - the PR names the invariant IDs and the canonical finding IDs it closes.
- **Ask first** (per `AGENTS.md`): T20 (migration), T22, T45, T46, T48, T58 (`.github/` or
  Compose), and any task whose fix would weaken a guard, an allowlist or a baseline.

## Deployment safety

| Class | Meaning |
|-------|---------|
| **none** | Tests, harness, docs or CI checks only; nothing a user runs changes. |
| **neutral** | Rewrites a live path (a lock, a transaction boundary, a targeted update) and is designed behaviour-preserving for a single request; the concurrent case changes from a silent wrong write to a 409 or a wait. |
| **live** | Changes what a user sees or what is written on an existing surface (a refusal, a figure marked partial, a corrected amount, a new error state). |
| **migration** | Ships a migration and `schema.sql`; expand/contract rules of `docs/database-migrations.md` apply. |
| **release** | Changes the release workflow or the documented deployments; verified on a branch run before merge. |

## Task graph

| ID | Task | Closes | Depends on | Deploy impact | Status |
|----|------|--------|-----------|---------------|--------|
| T01 | P0: Refresh-token family: commit the reuse revocation, and stop two tabs reading as theft | A26-H01, A26-M03 | -- | live | [ ] |
| T02 | P0: Email receipts: authenticate the forwarder, not the pasted header | A26-H02 | -- | live | [ ] |
| T03 | P0: Bulk delete of a split-transfer leg removes every leg it orphans | A26-H05 | -- | live | [ ] |
| T04 | P0: MNY import: a failure after the data commit is reported as committed, and the same file cannot be imported twice | A26-H08 | -- | live | [ ] |
| T05 | P0: Bank sync: an entry reference repeated on a later day is neither duplicated nor dropped | A26-H09 | -- | live | [ ] |
| T06 | P0: Transfer edit contract: the form opened from the receiving leg, and `PATCH /transactions/:id` on a leg | A26-H13, A26-M10 | -- | live | [ ] |
| T07 | P0: Switching an existing row to Transfer mode converts it instead of creating a second transfer | A26-H14 | T06 | live | [ ] |
| T08 | P1: Integration harness at the production boundary | A26-M42 | -- | none | [ ] |
| T09 | P1: Transfer edits lock both legs and refuse a change made under them; the reconciled lock on the same branches | A26-H03, A26-M11 | T08 | neutral | [ ] |
| T10 | P1: Investment transaction edit and delete serialize on the row and its cash leg | A26-H04 | T08 | neutral | [ ] |
| T11 | P1: Undo and redo of an account edit restore intent, not a snapshot | A26-H06 | -- | live | [ ] |
| T12 | P1: Scheduled post and skip are pinned to the occurrence the user saw; the cursor advances past every claimed slot | A26-H07, A26-M15 | T08 | live | [ ] |
| T13 | P1: A failure after a single-use write commits is reported as committed (scheduled post, cron alert, AI action) | A26-M14 | T12 | live | [ ] |
| T14 | P1: A missing rate is unknown in every built-in report, never 1:1 | A26-H10, A26-L05 | -- | live | [ ] |
| T15 | P1: A rate for a date: every reader goes through `resolveFxRate` | A26-H11 | T14 | live | [ ] |
| T16 | P1: Convert before summing: budgets, the custom report engine, AI/MCP analytics | A26-H12 | T14 | live | [ ] |
| T17 | P1: Completeness flags are carried to and read on every surface that shows a total | A26-H15 | -- | live | [ ] |
| T18 | P2: Credential writes are atomic with the state they change | A26-M01, A26-M02, A26-L07 | T01 | neutral | [ ] |
| T19 | P2: Delegated and cross-owner writes re-check authority inside the writing transaction | A26-M04, A26-M05 | T08 | live | [ ] |
| T20 | P2: Delegation policies: a delegate-side session cannot issue itself a delegation | A26-M06 | -- | migration | [ ] |
| T21 | P2: Backup retention never deletes another owner's legacy artifacts | A26-M07 | -- | live | [ ] |
| T22 | P2: The S3 backup suite runs in CI and a local/S3 attachment round trip exists | A26-M08 | -- | none | [ ] |
| T23 | P2: VOID crossings are decided under the row lock (bulk VOID expansion, `addSplit`) | A26-M09 | T08, T09 | neutral | [ ] |
| T24 | P2: An account cannot close over a pending future-dated row | A26-M12 | -- | live | [ ] |
| T25 | P2: No whole-entity or absolute write of `current_balance` outside the recompute | A26-M13 | -- | neutral | [ ] |
| T26 | P2: MNY writers: sleeve transfers and foreign-quoted trades in their own currencies | A26-M16, A26-M24 | T04 | live | [ ] |
| T27 | P2: Currencies: no global row from a user action; default currency created before it is referenced | A26-M17, A26-M25 | -- | live | [ ] |
| T28 | P2: QIF split-transfer legs are written in the target account's currency | A26-M18 | -- | live | [ ] |
| T29 | P2: Account delete checks and deletes in one locked transaction | A26-M19 | T08 | neutral | [ ] |
| T30 | P2: AI and MCP edits keep the row's own exchange rate unless one is named | A26-M20 | T15 | live | [ ] |
| T31 | P2: Security transfers: basis and realized gains from the source lots at the transfer's rate | A26-M21, A26-M22 | -- | live | [ ] |
| T32 | P2: The holdings fold keeps small fractional positions | A26-M23 | -- | live | [ ] |
| T33 | P2: Bond holdings are not valued on a day the engine refuses to price | A26-M26 | -- | live | [ ] |
| T34 | P2: GEM: momentum at the boundary's own close; the signal alert bound to its period | A26-M27, A26-L24 | -- | live | [ ] |
| T35 | P2: Loan postings: an installment below the interest, and a source account in another currency | A26-M29, A26-M30 | T12 | live | [ ] |
| T36 | P2: Loan history and report: VOID and future rows, Original Amount, interest saved | A26-M28, A26-L25, A26-L34 | -- | live | [ ] |
| T37 | P2: Budgets: exclusions applied, rollover written, periods and alerts | A26-M31, A26-M32, A26-L38, A26-L39 | T16 | live | [ ] |
| T38 | P2: Custom report engine: signed category sums and escaped search | A26-M33, A26-L12 | T16 | live | [ ] |
| T39 | P2: AI/MCP spending anomalies receive months and threshold in the right places | A26-M34 | -- | live | [ ] |
| T40 | P2: Client caches: invalidation for recategorising, valuation inputs and imports; generation-aware reads | A26-M35 | -- | live | [ ] |
| T41 | P2: Intraday portfolio cache keyed by user and acting context, cleared on sign-out and switch | A26-M36 | -- | live | [ ] |
| T42 | P2: Amounts keep four decimals through load, blur and save | A26-M37 | T06, T07 | live | [ ] |
| T43 | P2: Portfolio gain over priced holdings only, marked partial | A26-M38 | T17 | live | [ ] |
| T44 | P2: A failed or pending request is never shown as data | A26-M39 | T17 | live | [ ] |
| T45 | P2: The production image is booted by a gate, and the documented Compose volumes are writable | A26-M40 | -- | release | [ ] |
| T46 | P2: Release publishes after its gates and pushes no untested bump | A26-M41 | T45 | release | [ ] |
| T47 | P2: One red test per remaining family row of the program mutation table | A26-M42 | T08, T09, T10, T12 | none | [ ] |
| T48 | P3: CI lint without `--fix`, the allowlist fence, and the instruction-file contradictions | A26-L01, A26-L02, A26-L03, A26-L04 | -- | none | [ ] |
| T49 | P3: Access-token type check and atomic attempt budgets | A26-L06, A26-L08 | T18 | neutral | [ ] |
| T50 | P3: Migration contract step, restore staging intents, restore backfills | A26-L09, A26-L10, A26-L11 | -- | neutral | [ ] |
| T51 | P3: Leases outlast the provider calls they guard and fence their saves | A26-L13 | -- | neutral | [ ] |
| T52 | P3: MNY staged-file deletion and INV-IMPORT-003 on the MNY and QIF writers | A26-L14, A26-L15 | T04 | neutral | [ ] |
| T53 | P3: Rule deletion, trade-email totals, FX inside the receipt transaction | A26-L16, A26-L17, A26-L18 | T02 | live | [ ] |
| T54 | P3: Securities LOWs: transfer edit lock order, price-window memory, undo fold, benchmark recompute | A26-L19, A26-L20, A26-L21, A26-L22 | T10 | neutral | [ ] |
| T55 | P3: Loan LOWs: the one-minor-unit payoff, the Post dialog split preview | A26-L23, A26-L26 | T12 | live | [ ] |
| T56 | P3: Notification LOWs: chart token TTL, alert baseline order, month start | A26-L27, A26-L28, A26-L29 | -- | neutral | [ ] |
| T57 | P3: Frontend LOWs: locale and catalog, forecast floats, response types, 0 % loans | A26-L30, A26-L31, A26-L32, A26-L33 | -- | live | [ ] |
| T58 | P3: Release-gate LOWs: E2E flakes, zero-test runners, DTO coverage | A26-L35, A26-L36, A26-L37 | T46 | none | [ ] |

---

## Task details

### T01 -- Refresh-token family: commit the reuse revocation, and stop two tabs reading as theft

**Priority:** P0. **Depends on:** --. **Deploy impact:** live. **PR size:** M.

**Closes:**

- A26-H01 (HIGH) Refresh-token reuse detection does not revoke the family: the revocation is rolled back by the exception that reports it. Surfaces and session findings: A26-S03-01 (primary).
- A26-M03 (MEDIUM) Two tabs refreshing at once read as token theft: the family is revoked and every session ends with no explanation. Surfaces and session findings: A26-S18-06 (primary).

**Invariants and prior findings:** INV-AUTH-001.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `backend/src/auth/token.service.ts`, `backend/src/common/db/scoped-db.ts`, `backend/src/auth/auth.service.ts`, `backend/src/auth/auth.controller.ts`, `frontend/src/lib/api.ts`.

**Regression tests it must land with:**

- A26-S03-01: a real-database test that rotates `t0`, presents `t0` again, and asserts the successor is revoked and refused. The unit test cannot catch this class: it mocks `withScopedDb`'s transaction, so a call to `update` is indistinguishable from a committed update.
- A26-S18-06: a Playwright two-page test in one context that expires the access cookie and fires a request from both pages; both pages must stay signed in.
- Mutation families that must turn `covered` (`21-tests-ci-release.md` section 6.2): F6.

**Notes and decisions:** Commit the revocation before the 401 (a separate committed write, or return a result and throw after `withScopedDb` returns); fix the three known-wrong `token.service.spec.ts` cases. In the same PR give concurrent refreshes from one browser a single-flight on the client and a short grace window for the immediate predecessor on the server, or A26-M03 turns every double tab into a logout. D-S03-04 (the nightly purge deletes the evidence) goes in the PR description as a known limit.

**Gate:**

- `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`, and `npm run build && npm run test:integration` (a query, a lock, an entity or an RLS context changes)
- `frontend/`: `npm run lint && npm run type-check && npm run i18n:check`, `npm run test:changed`, `npm run build`; grep `e2e/` for any renamed control's accessible name

### T02 -- Email receipts: authenticate the forwarder, not the pasted header

**Priority:** P0. **Depends on:** --. **Deploy impact:** live. **PR size:** M.

**Closes:**

- A26-H02 (HIGH) Any sender can make an email read as the broker's by pasting a forwarded-message header block; with auto-apply the trade it states is booked. Surfaces and session findings: A26-S11-04 (primary).

**Invariants and prior findings:** INV-RECEIPT-008, INV-RECEIPT-003.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `backend/src/email-receipts/imap/forwarded-receipt.ts`, `backend/src/email-receipts/pipeline/email-receipt-trade.service.ts`, `backend/src/email-receipts/pipeline/auto-apply-gate.ts`.

**Regression tests it must land with:**

- A26-S11-04: P3 as `test/integration/email-receipts-forwarded-sender.integration.spec.ts`: the outside sender's email is stored as `evil.example`, no trade is created, the cash balance stays 10 000; and the owner's own forward (outer `From` = the mailbox login) is still re-identified and proposed, never auto-applied.
- Suggested test files (field 13 diffs): `backend/test/integration/email-receipts-forwarded-sender.integration.spec.ts`.
- Mutation families that must turn `covered` (`21-tests-ci-release.md` section 6.2): F6.

**Notes and decisions:** Attribute a forwarded email to the envelope sender unless the envelope sender is the owner's verified forwarding address; never auto-apply a trade whose broker identity comes from the body. Add the non-owner forward test (S11 mutation row INV-RECEIPT-008).

**Gate:**

- `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`, and `npm run build && npm run test:integration` (a query, a lock, an entity or an RLS context changes)

### T03 -- Bulk delete of a split-transfer leg removes every leg it orphans

**Priority:** P0. **Depends on:** --. **Deploy impact:** live. **PR size:** S.

**Closes:**

- A26-H05 (HIGH) Bulk-deleting one leg of a split transfer deletes the parent but leaves the other legs, creating their money. Surfaces and session findings: A26-S13-03 (primary).

**Invariants and prior findings:** INV-BALANCE-001, MON-M34.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `backend/src/transactions/transaction-bulk-update.service.ts`, `database/schema.sql`.

**Regression tests it must land with:**

- A26-S13-03: integration (schema-faithful FKs): bulk-delete a split-transfer leg, assert all three balances return to their pre-transfer values and no orphan leg remains; also the parent selected, both legs selected, and a cross-owner leg.

**Notes and decisions:** Route the bulk path through the single-delete leg removal (`removeLockedTransactionLeg` / `deletionBalanceEffect`) so the sibling legs and their balances go with the parent; replace the known-wrong `transaction-bulk-update.service.spec.ts:2592-2643` assertion.

**Gate:**

- `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`, and `npm run build && npm run test:integration` (a query, a lock, an entity or an RLS context changes)

### T04 -- MNY import: a failure after the data commit is reported as committed, and the same file cannot be imported twice

**Priority:** P0. **Depends on:** --. **Deploy impact:** live. **PR size:** M.

**Closes:**

- A26-H08 (HIGH) A failure after the MNY import's data commit is reported as "Nothing was saved", and the same file can then be imported again. Surfaces and session findings: A26-S09-01 (primary); A26-S02-05 (superseded); A26-S18-05 (merged surface).

**Invariants and prior findings:** INV-IMPORT-002, MON-H04.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `backend/src/import/mny/mny-import-job.service.ts`, `frontend/src/components/import/MnyImportProgress.tsx`, `frontend/src/i18n/messages/en/import.json`, `backend/src/import/mny/mny-import.controller.ts`, `frontend/src/lib/import-mny.ts`, `backend/src/import/mny/mny-import.service.ts`, `backend/src/import/mny/dto/mny-import.dto.ts`.

**Regression tests it must land with:**

- A26-S09-01: failpoint after commit; assert the job's `errorKey` is the committed key, a second `start` on the same staged id is refused, and transaction count and balances are unchanged.
- A26-S18-05: `MnyImportProgress` with `{status: 'failed', errorKey: 'mnyImportFailed', dataCommitted: true}` must not contain "Nothing was saved"; a backend job test that throws in `verifyHoldings` and asserts `dataCommitted: true` on `GET /import/mny/jobs/:id`.
- Suggested test files (field 13 diffs): `frontend/src/components/import/MnyImportProgress.test.tsx`.
- Mutation families that must turn `covered` (`21-tests-ci-release.md` section 6.2): F8.

**Notes and decisions:** Classify by `markDataCommitted`: after it, the job is `completed_with_errors` (or equivalent), never `failed` with `retryable`; the wizard copy follows the server state (A26-S18-05). Refuse a start on a staged file whose committed job exists (A26-S02-05 surface). Land the S09 failpoint test and the `fail()` `retryable` test (A26-S09-02, merged into A26-M42) in this PR.

**Gate:**

- `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`, and `npm run build && npm run test:integration` (a query, a lock, an entity or an RLS context changes)
- `frontend/`: `npm run lint && npm run type-check && npm run i18n:check`, `npm run test:changed`, `npm run build`; grep `e2e/` for any renamed control's accessible name

### T05 -- Bank sync: an entry reference repeated on a later day is neither duplicated nor dropped

**Priority:** P0. **Depends on:** --. **Deploy impact:** live. **PR size:** M.

**Closes:**

- A26-H09 (HIGH) A bank transaction whose entry reference the bank repeats on a later day is imported twice, or a later one is silently dropped (INV-BANKSYNC-001). Surfaces and session findings: A26-S10-01 (primary).

**Invariants and prior findings:** INV-BANKSYNC-001.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `backend/src/bank-sync/bank-transaction-planner.ts`, `backend/src/bank-sync/bank-sync-writer.service.ts`, `docs/specs/bank-sync.md`, `database/migrations/<UTC>_bank_sync_ledger_content_signature.sql`.

**Regression tests it must land with:**

- A26-S10-01: two syncs on real PostgreSQL: a lone reference, then the same row beside a second row under that reference; and the reverse, a reuse outside the window.
- Suggested test files (field 13 diffs): `backend/test/integration/bank-sync.integration.spec.ts`.
- Mutation families that must turn `covered` (`21-tests-ci-release.md` section 6.2): F6.

**Notes and decisions:** Key the dedup ledger on the reference plus the booking date and amount (or the bank's transaction id where present), in the writer, the preview duplicate column and the exception rows (all three surfaces); correct the INV-BANKSYNC-001 index entry.

**Gate:**

- `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`, and `npm run build && npm run test:integration` (a query, a lock, an entity or an RLS context changes)

### T06 -- Transfer edit contract: the form opened from the receiving leg, and `PATCH /transactions/:id` on a leg

**Priority:** P0. **Depends on:** --. **Deploy impact:** live. **PR size:** M.

**Closes:**

- A26-H13 (HIGH) A cross-currency transfer opened from its receiving leg loads the received amount into the source-amount field, and an unedited save re-prices the transfer (MON-H11 client half). Surfaces and session findings: A26-S19-01 (primary).
- A26-M10 (MEDIUM) `PATCH /transactions/:id` changes the amount, rate or account of one transfer leg only (MON-H11 server residual). Surfaces and session findings: A26-S07-04 (primary).

**Invariants and prior findings:** MON-H11.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `frontend/src/components/transactions/TransactionForm.tsx`, `backend/src/transactions/transactions.service.ts`.

**Regression tests it must land with:**

- A26-S19-01: open the CAD (receiving) leg of a USD 100 -> CAD 135 transfer, save unedited, assert `amount: 100` and `toAmount: 135`; the same for `duplicateFrom`; a reconciled receiving leg whose source amount is edited raises the confirmation.
- A26-S07-04: PATCH amount on each leg of a plain pair and on a split-transfer leg; expect 400 and unchanged rows.
- Suggested test files (field 13 diffs): `frontend/src/components/transactions/TransactionForm.test.tsx`.

**Notes and decisions:** Client: load the source amount from the source leg whatever leg the form opens from, and send the leg id the form treated as the source. Server: `update()` refuses an amount, rate or account change on a transfer leg (or routes to `updateTransfer`; maintainer choice, section 17.2 item 2) on every entry point: PATCH, PAT, joint register, a rule's `convert_to_transfer` between card and confirm.

**Gate:**

- `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`, and `npm run build && npm run test:integration` (a query, a lock, an entity or an RLS context changes)
- `frontend/`: `npm run lint && npm run type-check && npm run i18n:check`, `npm run test:changed`, `npm run build`; grep `e2e/` for any renamed control's accessible name

### T07 -- Switching an existing row to Transfer mode converts it instead of creating a second transfer

**Priority:** P0. **Depends on:** T06. **Deploy impact:** live. **PR size:** S.

**Closes:**

- A26-H14 (HIGH) Switching an existing income, expense or split to Transfer mode creates a second, new transfer and leaves the original row in place. Surfaces and session findings: A26-S19-02 (primary).

**Invariants and prior findings:** none indexed; see field 4 of each finding.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `frontend/src/components/transactions/TransactionForm.tsx`, `backend/src/transactions/convert-to-transfer.ts`.

**Regression tests it must land with:**

- A26-S19-02: open an existing expense, assert there is no Transfer mode button; a forced transfer-mode submit calls neither `createTransfer` nor `update`.
- Suggested test files (field 13 diffs): `frontend/src/components/transactions/TransactionForm.test.tsx`.

**Notes and decisions:** Edit mode must call a conversion (or refuse the switch); create mode keeps today's behaviour (Rule 10 in the finding).

**Gate:**

- `frontend/`: `npm run lint && npm run type-check && npm run i18n:check`, `npm run test:changed`, `npm run build`; grep `e2e/` for any renamed control's accessible name

### T08 -- Integration harness at the production boundary

**Priority:** P1. **Depends on:** --. **Deploy impact:** none. **PR size:** L.

**Closes:**

- A26-M42 (MEDIUM) The concurrency, post-commit and database-boundary invariants behind the program's HIGH and MEDIUM findings have no test at the production boundary (MON-M46). Surfaces and session findings: A26-S21-04 (primary); A26-S03-04 (merged surface); A26-S04-04 (merged surface); A26-S05-01 (merged surface); A26-S07-09 (merged surface); A26-S08-05 (merged surface); A26-S16-09 (merged surface); A26-S17-05 (merged surface); A26-S02-12 (merged surface); A26-S06-06 (merged surface); A26-S09-02 (merged surface).

**Invariants and prior findings:** INV-AUTH-001, INV-CLAIM-001, INV-OCCURRENCE-001, INV-CRON-001, INV-MCP-001, INV-BACKUP-009, INV-IMPORT-002, MON-M46, MON-M04.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `backend/test/helpers/integration-setup.ts`, `backend/src/auth/token.service.ts`, `backend/src/emergency-access/emergency-access-claim.controller.ts`, `backend/src/auth/token.service.spec.ts`, `backend/test/integration/logout-revoke-failpoint.integration.spec.ts`, `backend/test/integration/emergency-access-grant-cycles.integration.spec.ts`, `backend/src/emergency-access/emergency-access-claim.controller.spec.ts`, `backend/test/integration/joint-accounts.integration.spec.ts`, `backend/test/integration/schema-entity-parity.integration.spec.ts`, `backend/test/helpers/rls-setup.ts`, `backend/src/budgets/entities/budget-period.entity.ts`, `database/schema.sql`, `backend/src/budgets/budget-period.service.ts`, `backend/src/transactions/transaction-split.service.ts`, `backend/src/accounts/accounts.service.ts`, `backend/src/transactions/transaction-transfer.service.ts`, and 6 more named in the findings.

**Regression tests it must land with:**

- A26-S21-04: per family, the first test listed in section 6.2's "first red test" column.
- A26-S03-04: as above; each must be shown failing on its mutation before it is merged.
- A26-S04-04: the case above (fails under mutation MA).
- A26-S05-01: the extended parity guard above, plus a two-connection integration test of `createPeriodForBudget` for one budget and one month.
- A26-S07-09: (recommended correction) add two-connection cases: concurrent `addSplit`; close versus an un-void; two concurrent `updateTransfer` with different amounts.
- A26-S08-05: (recommended correction) add `scheduled-posting.integration.spec.ts` built as `<scratchpad>/mut/backend/test/integration/zz-s08-probe.integration.spec.ts` is built, and `job-claim-lease.integration.spec.ts`.
- A26-S16-09: P4 (two `pg` clients, barrier, one row) and P2/P3 as committed integration specs; a VOID expense in `budget-split-transfer-spending` asserting it is not in `spent`.
- A26-S17-05: ```diff +++ b/backend/src/mcp/mcp-http.controller.spec.ts +it("serves an existing session's tool the scopes of the token presented now", async () => { + // initialize with oauth grant g1 scopes "read,write"; then call a tool with + // the same grant (credentialId oauth:g1) whose current scope is "read". + validateAccessToken.mockResolvedValueOnce({ userId: "u1", scopes: "read,write", grantId: "g1" }); + const sid = ...
- A26-S02-12: as item 11, asserting one success, one 404, one password.
- A26-S06-06: as 7.
- A26-S09-02: (verification method) re-run M1 and M2; both must turn the integration suite red.
- Suggested test files (field 13 diffs): `backend/test/integration/budget-period-create-race.integration.spec.ts`.
- Mutation families that must turn `covered` (`21-tests-ci-release.md` section 6.2): F1, F2, F3, F4, F5, F8, F9.

**Notes and decisions:** Three harness changes before any P1 regression test: a `raceTwo` two-connection barrier helper under `backend/test/helpers/`; `createIntegrationModule` builds the real `ScheduledTransactionsModule` (delete the stub override); the schema built from `database/schema.sql` or a parity guard against it (A26-S05-01). Closes the harness half of A26-M42; T47 closes the family rows.

**Gate:**

- `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`, and `npm run build && npm run test:integration` (a query, a lock, an entity or an RLS context changes)

### T09 -- Transfer edits lock both legs and refuse a change made under them; the reconciled lock on the same branches

**Priority:** P1. **Depends on:** T08. **Deploy impact:** neutral. **PR size:** M.

**Closes:**

- A26-H03 (HIGH) Transfer edit paths derive both balance deltas from pre-transaction snapshots (split-transfer leg, connected cross-owner transfer). Surfaces and session findings: A26-S07-01 (primary); A26-S02-01 (superseded).
- A26-M11 (MEDIUM) The strict reconciled lock is skipped on split-transfer leg and cross-owner transfer edits and deletes. Surfaces and session findings: A26-S07-05 (primary); A26-S02-08 (superseded).

**Invariants and prior findings:** INV-BALANCE-001, MON-H05, INV-RECONCILE-001.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `backend/src/transactions/transaction-transfer.service.ts`.

**Regression tests it must land with:**

- A26-S07-01: two real connections per surface, same-value and different-value concurrent edits, asserting stored = opening + ledger on every account.
- A26-S07-05: one unit case per branch with `lockReconciledTransactions: true`; make the guard enumerate the private branch methods.
- Suggested test files (field 13 diffs): `backend/test/integration/transfer-edit-race.integration.spec.ts`.

**Notes and decisions:** Split leg: lock parent then leg (role order of `common/db/locks.ts`); cross-owner: both legs ascending by id; compare against the locked rows and refuse with 409; apply `assertReconciledRowsMutable` on both branches. Extend `derived-state-writers.guard.spec.ts` and `reconciled-lock.guard.spec.ts` to per-function matching.

**Gate:**

- `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`, and `npm run build && npm run test:integration` (a query, a lock, an entity or an RLS context changes)

### T10 -- Investment transaction edit and delete serialize on the row and its cash leg

**Priority:** P1. **Depends on:** T08. **Deploy impact:** neutral. **PR size:** M.

**Closes:**

- A26-H04 (HIGH) Editing an investment transaction twice at once, or while it is deleted, duplicates or orphans its cash leg. Surfaces and session findings: A26-S12-01 (primary).

**Invariants and prior findings:** INV-BALANCE-001, INV-HOLDING-001.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `backend/src/securities/investment-transactions.service.ts`.

**Regression tests it must land with:**

- A26-S12-01: two-connection R1 and R2 at integration level, barrier on `lockHoldingScope`, asserting the funding account's cash rows and balance against the ledger.
- Suggested test files (field 13 diffs): `backend/test/integration/investment-edit-race.integration.spec.ts`.
- Mutation families that must turn `covered` (`21-tests-ci-release.md` section 6.2): F1.

**Notes and decisions:** Lock the investment row and its cash leg before deriving anything; refuse a concurrent edit; an edit of a deleted row is a 404, not an orphan.

**Gate:**

- `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`, and `npm run build && npm run test:integration` (a query, a lock, an entity or an RLS context changes)

### T11 -- Undo and redo of an account edit restore intent, not a snapshot

**Priority:** P1. **Depends on:** --. **Deploy impact:** live. **PR size:** M.

**Closes:**

- A26-H06 (HIGH) Undo or redo of an account edit restores a whole-entity snapshot: the edit-time balance is written back absolutely and a loan's coupled template is left unrepriced or unlinked. Surfaces and session findings: A26-S07-02 (primary); A26-S15-01 (merged surface).

**Invariants and prior findings:** INV-BALANCE-001, INV-LOAN-007, INV-LOAN-010, MON-H07.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `backend/src/action-history/action-history.service.ts`, `backend/src/accounts/accounts.service.ts`.

**Regression tests it must land with:**

- A26-S07-02: rename, then a balance movement that records no action, then undo; assert stored = ledger and the name reverted.
- A26-S15-01: the two probes: change type / category through `AccountsService.update`, undo, assert the template is either repriced to the annuity payment and still managed, or the undo was refused with nothing written.
- Mutation families that must turn `covered` (`21-tests-ci-release.md` section 6.2): F6.

**Notes and decisions:** `undoSimpleEntity` must not restore `current_balance` (derived) and must replay the loan template reprice and relink the edit performed (or refuse undo of a coupled loan edit). Both surfaces in one PR: cash account (A26-S07-02) and loan/mortgage (A26-S15-01).

**Gate:**

- `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`, and `npm run build && npm run test:integration` (a query, a lock, an entity or an RLS context changes)

### T12 -- Scheduled post and skip are pinned to the occurrence the user saw; the cursor advances past every claimed slot

**Priority:** P1. **Depends on:** T08. **Deploy impact:** live. **PR size:** M.

**Closes:**

- A26-H07 (HIGH) Manual post and skip of a scheduled transaction are not pinned to the occurrence the user saw; a stale view pays a bill twice or consumes the next occurrence. Surfaces and session findings: A26-S08-01 (primary); A26-S02-04 (superseded).
- A26-M15 (MEDIUM) `post()` advances the cursor past its own slot only, so a slot a settlement rule claimed ahead of the cursor becomes `next_due_date` and the schedule stalls. Surfaces and session findings: A26-S08-03 (primary).

**Invariants and prior findings:** INV-OCCURRENCE-001, MON-H06, INV-CRON-001.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `backend/src/scheduled-transactions/scheduled-transactions.controller.ts`, `frontend/src/components/scheduled-transactions/PostTransactionDialog.tsx`, `frontend/src/lib/scheduled-transactions.ts`, `backend/src/scheduled-transactions/dto/post-scheduled-transaction.dto.ts`, `backend/src/scheduled-transactions/dto/skip-scheduled-transaction.dto.ts`, `backend/src/scheduled-transactions/scheduled-transactions.service.ts`, `frontend/src/components/scheduled-transactions/ScheduledTransactionListParts.tsx`.

**Regression tests it must land with:**

- A26-S08-01: the P2/P7/P3 probes as an integration spec against the real `post()`/`skip()` (the harness change of A26-S08-05), asserting 409 and an unchanged ledger; a controller spec asserting the pin is forwarded; a dialog test asserting the payload carries `expectedDueDate`.
- A26-S08-03: P4 against the real `post()`.
- Suggested test files (field 13 diffs): `backend/test/integration/scheduled-post-occurrence-pin.integration.spec.ts`.
- Mutation families that must turn `covered` (`21-tests-ci-release.md` section 6.2): F4.

**Notes and decisions:** The dialog and row menu send the occurrence date they showed; `post()` and `skip()` refuse a mismatch with 409 and refuse an exhausted schedule. `post()` advances the cursor past every claim on or after it (A26-M15), as the rule's advance does. Tests run the real `post()` (needs T08).

**Gate:**

- `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`, and `npm run build && npm run test:integration` (a query, a lock, an entity or an RLS context changes)
- `frontend/`: `npm run lint && npm run type-check && npm run i18n:check`, `npm run test:changed`, `npm run build`; grep `e2e/` for any renamed control's accessible name

### T13 -- A failure after a single-use write commits is reported as committed (scheduled post, cron alert, AI action)

**Priority:** P1. **Depends on:** T12. **Deploy impact:** live. **PR size:** M.

**Closes:**

- A26-M14 (MEDIUM) An error after a single-use write commits is reported as a failure, so the offered retry writes again (scheduled post and its cron alert, AI action confirm). Surfaces and session findings: A26-S08-02 (primary); A26-S17-02 (merged surface).

**Invariants and prior findings:** INV-OCCURRENCE-001, INV-MCP-004.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `backend/src/scheduled-transactions/scheduled-transactions.service.ts`, `backend/src/ai/actions/ai-actions.service.ts`, `frontend/src/store/aiChatStore.ts`, `frontend/src/components/ai/ConfirmationCardShell.tsx`, `backend/src/mcp/tools/transactions.tool.ts`.

**Regression tests it must land with:**

- A26-S08-02: inject a failure into the post-commit recalculation; assert the cron raises no `SCHEDULED_POST_FAILED`, `post()` resolves, and a manual retry with the pin of A26-S08-01 is refused.
- A26-S17-02: `ai-actions.service.spec.ts`: `attachments.create` rejects once; the first confirm resolves with `attachmentsFailed`; a second confirm with the same dto is refused by the claim and `transactions.create` was called once. An integration variant against `single_use_tokens` (`ai-action-replay.integration.spec.ts` is the harness).
- Mutation families that must turn `covered` (`21-tests-ci-release.md` section 6.2): F8.

**Notes and decisions:** The post-commit-failure pair: classify errors by whether the commit happened; the cron raises no 'could not be posted' alert for a committed occurrence; the AI action keeps its claim consumed after a committed write and reports the partial failure (attachment) as such.

**Gate:**

- `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`, and `npm run build && npm run test:integration` (a query, a lock, an entity or an RLS context changes)
- `frontend/`: `npm run lint && npm run type-check && npm run i18n:check`, `npm run test:changed`, `npm run build`; grep `e2e/` for any renamed control's accessible name

### T14 -- A missing rate is unknown in every built-in report, never 1:1

**Priority:** P1. **Depends on:** --. **Deploy impact:** live. **PR size:** M.

**Closes:**

- A26-H10 (HIGH) Built-in reports convert a missing exchange rate 1:1 and label the result in the reporting currency (MON-H12, MON-M39). Surfaces and session findings: A26-S13-01 (primary); A26-S02-02 (superseded).
- A26-L05 (LOW) `fx-fallback.guard.spec.ts` cannot see a camelCase rate fallback. Surfaces and session findings: A26-S02-11 (primary).

**Invariants and prior findings:** INV-FX-001, MON-H12, MON-M39.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `backend/src/built-in-reports/report-currency.service.ts`, `backend/src/common/currency-conversion.util.ts`, `backend/src/common/fx-fallback.guard.spec.ts`, `backend/src/securities/portfolio.service.ts`.

**Regression tests it must land with:**

- A26-S13-01: per report family, one account in a currency with no rate: total `null`, known subtotal set, `missingCurrencies` names it; a source scan that no file under `built-in-reports/` calls `convertAmount`.
- A26-S02-11: portfolio summary with a currency that has neither a time series nor a spot rate.
- Suggested test files (field 13 diffs): `backend/src/built-in-reports/report-currency.service.spec.ts`.
- Mutation families that must turn `covered` (`21-tests-ci-release.md` section 6.2): F9.

**Notes and decisions:** `convertAmount` returns `null` for no rate; the report DTOs carry the unconverted total and the missing pair, and the UI names it (AGENTS.md: withholding a figure names what is missing). Replace the known-wrong `report-currency.service.spec.ts:213` case; widen `fx-fallback.guard.spec.ts` to camelCase rate variables (A26-L05). All eleven endpoints S16 listed and the AI/MCP report tools.

**Gate:**

- `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`, and `npm run build && npm run test:integration` (a query, a lock, an entity or an RLS context changes)
- `frontend/`: `npm run lint && npm run type-check && npm run i18n:check`, `npm run test:changed`, `npm run build`; grep `e2e/` for any renamed control's accessible name

### T15 -- A rate for a date: every reader goes through `resolveFxRate`

**Priority:** P1. **Depends on:** T14. **Deploy impact:** live. **PR size:** L.

**Closes:**

- A26-H11 (HIGH) A rate for a date is not the resolver's: the latest-rate readers use a frozen pre-1.17 mirror row and a rate of any age, and back-dated trades settle or prefill at the newest rate (INV-FX-001, INV-FX-003). Surfaces and session findings: A26-S13-02 (primary); A26-S12-02 (merged surface); A26-S19-04 (merged surface); A26-S18-04 (merged surface).

**Invariants and prior findings:** INV-FX-003, INV-FX-001, MON-H14.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `backend/src/currencies/exchange-rate.service.ts`, `frontend/src/hooks/useExchangeRates.ts`, `backend/src/built-in-reports/report-currency.service.ts`, `backend/src/securities/investment-transactions.service.ts`, `frontend/src/components/investments/InvestmentTransactionForm.tsx`, `frontend/src/components/transactions/InvestmentSplitFields.tsx`, `backend/src/common/time-series/fx-rate-resolver.ts`.

**Regression tests it must land with:**

- A26-S13-02: an integration case with a stale mirror row and a fresh canonical row asserting one row per pair carrying the fresh rate; a report case asserting 1,400.00; a row older than 45 days absent from the payload.
- A26-S12-02: an integration case with only a current stored rate and a trade dated outside the 45-day window, asserting a 400 and no row written; a unit case asserting `getLatestRate` is never called by the posting path.
- A26-S19-04: a BUY dated 2025-01-02 asks `getRateForDate('USD', 'CAD', '2025-01-02')` and sends its answer; a date change asks again unless the user typed a rate.
- A26-S18-04: `useExchangeRates` fed a 2020 row returns `null`; a 10-day-old row converts.
- Suggested test files (field 13 diffs): `frontend/src/components/investments/InvestmentTransactionForm.test.tsx`, `frontend/src/hooks/useExchangeRates.test.ts`.
- Mutation families that must turn `covered` (`21-tests-ci-release.md` section 6.2): F11.

**Notes and decisions:** Latest-rate readers stop using the frozen pre-1.17 mirror row and apply the age bound; back-dated trades settle at the dated rate or refuse (server, A26-S12-02); the investment form and embedded split prefill a dated rate (A26-S19-04); the client converter applies the age bound (A26-S18-04). Replace the known-wrong `investment-transactions.service.spec.ts:5120` family. Correct INV-FX-001 / INV-FX-003 entries.

**Gate:**

- `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`, and `npm run build && npm run test:integration` (a query, a lock, an entity or an RLS context changes)
- `frontend/`: `npm run lint && npm run type-check && npm run i18n:check`, `npm run test:changed`, `npm run build`; grep `e2e/` for any renamed control's accessible name

### T16 -- Convert before summing: budgets, the custom report engine, AI/MCP analytics

**Priority:** P1. **Depends on:** T14. **Deploy impact:** live. **PR size:** L.

**Closes:**

- A26-H12 (HIGH) Totals sum amounts of different currencies without conversion: budget actuals, the custom report engine and the AI/MCP transaction analytics. Surfaces and session findings: A26-S16-01 (primary); A26-S16-06 (merged surface); A26-S17-01 (merged surface).

**Invariants and prior findings:** INV-FX-001.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `backend/src/budgets/budget-spending.util.ts`, `backend/src/reports/reports.service.ts`, `backend/src/transactions/transaction-analytics.service.ts`, `backend/src/securities/investment-transactions.service.ts`, `backend/src/ai/query/tool-executor.service.ts`.

**Regression tests it must land with:**

- A26-S16-01: the P1 scenario against PostgreSQL with a stored JPY->CAD rate (spent 290.00) and without one (spent `null`, `missingCurrencies: ["JPY"]`, no OVER_BUDGET alert).
- A26-S16-06: two currencies, one with a rate (converted) and one without (`null` total, missing currency named).
- A26-S17-01: an integration case with two currencies and a stored rate asserting the converted totals, and a missing-rate case asserting `fxComplete: false` with `null` totals; a unit case asserting the summary line names the currency.
- Suggested test files (field 13 diffs): `backend/test/integration/budget-multi-currency-actuals.integration.spec.ts`, `backend/test/integration/llm-analytics-currency.integration.spec.ts`.
- Mutation families that must turn `covered` (`21-tests-ci-release.md` section 6.2): F6.

**Notes and decisions:** Every surface of the group: budget page, dashboard widget, category status, AI, MCP, alerts and emails, period close, budget reports, generator (A26-S16-01); the custom report engine (A26-S16-06); AI/MCP `list_transactions`, `compare_periods`, `list_investment_transactions`, `monize://financial-summary` (A26-S17-01); `getLlmBudgetStatus`. Use `FxAggregate`; a missing rate makes the total unknown with a `knownSubtotal`.

**Gate:**

- `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`, and `npm run build && npm run test:integration` (a query, a lock, an entity or an RLS context changes)
- `frontend/`: `npm run lint && npm run type-check && npm run i18n:check`, `npm run test:changed`, `npm run build`; grep `e2e/` for any renamed control's accessible name

### T17 -- Completeness flags are carried to and read on every surface that shows a total

**Priority:** P1. **Depends on:** --. **Deploy impact:** live. **PR size:** L.

**Closes:**

- A26-H15 (HIGH) Completeness flags are not carried or read where totals are shown: net worth, accounts, portfolio widget and history, the AI/MCP account tools, report exports and Cash Flow. Surfaces and session findings: A26-S20-01 (primary); A26-S02-03 (superseded); A26-S13-04 (merged surface); A26-S16-04 (merged surface).

**Invariants and prior findings:** INV-REPORT-002, MON-H16.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `frontend/src/types/net-worth.ts`, `backend/src/net-worth/net-worth.service.ts`, `frontend/src/components/reports/NetWorthReport.tsx`, `frontend/src/app/accounts/page.tsx`, `frontend/src/components/dashboard/PortfolioValueWidget.tsx`, `frontend/src/components/investments/InvestmentValueChart.tsx`, `backend/src/accounts/accounts.service.ts`, `frontend/src/components/reports/CashFlowReport.tsx`, `frontend/src/lib/pdf-export.ts`.

**Regression tests it must land with:**

- A26-S20-01: one component case per surface fed `valuationComplete:false` (or `fxComplete:false` on a month, `pricesComplete:false` on a point) with every other field complete.
- A26-S13-04: P5 as an integration case asserting `fxComplete: false` and the pair on both the summary and the LLM shape; a unit case for `getAccountMarketValues` with one unpriced holding.
- A26-S16-04: component tests rendering a response with `income: null, knownIncome: 5000, missingCurrencies: ["EUR"]`: no "0.00" for income, PDF called with the partial note; a failed load leaves the export disabled.

**Notes and decisions:** Server: latest net worth, account market values and the month comparison keep `fxComplete`/`pricesComplete`/`valuationComplete` (A26-S13-04), including the AI/MCP account tools. Client: net-worth report and dashboard, accounts page and list, logical accounts, portfolio widget and history (A26-S20-01), report exports and Cash Flow (A26-S16-04). Check the open surfaces of section 15: sector weightings, country look-through, intraday dropped bonds.

**Gate:**

- `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`, and `npm run build && npm run test:integration` (a query, a lock, an entity or an RLS context changes)
- `frontend/`: `npm run lint && npm run type-check && npm run i18n:check`, `npm run test:changed`, `npm run build`; grep `e2e/` for any renamed control's accessible name

### T18 -- Credential writes are atomic with the state they change

**Priority:** P2. **Depends on:** T01. **Deploy impact:** neutral. **PR size:** M.

**Closes:**

- A26-M01 (MEDIUM) A successful password login writes the pre-bcrypt snapshot back and restores the failed-login counter it just reset. Surfaces and session findings: A26-S03-02 (primary).
- A26-M02 (MEDIUM) Change-password, admin reset/disable and owner-of-delegate reset end refresh sessions with one blanket UPDATE that misses a concurrently inserted successor. Surfaces and session findings: A26-S03-07 (primary).
- A26-L07 (LOW) Admin and owner-of-delegate password resets revoke PATs and trusted devices in a separate transaction from the password write. Surfaces and session findings: A26-S03-05 (primary).

**Invariants and prior findings:** INV-AUTH-002, INV-AUTH-005, INV-AUTH-004.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `backend/src/auth/auth.service.ts`, `backend/src/auth/login-lockout.ts`, `backend/src/users/users.service.ts`, `backend/src/admin/admin.service.ts`, `backend/src/delegation/delegation.service.ts`, `backend/src/auth/token.service.ts`.

**Regression tests it must land with:**

- A26-S03-02: an integration test that seeds `failed_login_attempts = 4`, logs in successfully through `AuthService.login`, and asserts 0; plus one failed attempt afterwards asserts `locked_until IS NULL`.
- A26-S03-07: the probe as a permanent integration test against each service method, not against the bare statement.
- A26-S03-05: a failpoint test in the style of `logout-revoke-failpoint.integration.spec.ts`: a `BEFORE UPDATE` trigger on `personal_access_tokens` that raises; assert the reset rejects and the password hash is unchanged.

**Notes and decisions:** Login success: targeted UPDATE, not a snapshot save; session revocation on password change, admin reset/disable and owner-of-delegate reset under the family lock; PAT and trusted-device revocation in the password write's transaction.

**Gate:**

- `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`, and `npm run build && npm run test:integration` (a query, a lock, an entity or an RLS context changes)

### T19 -- Delegated and cross-owner writes re-check authority inside the writing transaction

**Priority:** P2. **Depends on:** T08. **Deploy impact:** live. **PR size:** M.

**Closes:**

- A26-M04 (MEDIUM) Grantee and cross-owner writes are authorized in earlier transactions and written under the system bypass without a re-check. Surfaces and session findings: A26-S04-01 (primary).
- A26-M05 (MEDIUM) Delegation management reads in one transaction and writes back the stale entity in another: a revoked delegation is re-instated. Surfaces and session findings: A26-S04-02 (primary).

**Invariants and prior findings:** none indexed; see field 4 of each finding.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `backend/src/transactions/transaction-transfer.service.ts`, `backend/src/delegation/cross-owner-access.service.ts`, `backend/src/transactions/joint-register.service.ts`, `backend/src/categories/joint-categories.service.ts`, `backend/src/delegation/delegation.service.ts`.

**Regression tests it must land with:**

- A26-S04-01: under `createEnforcedIntegrationModule`, a barrier between authorization and write (as in the probe), revoke in the gap, assert no leg in the owner's account and the owner's balance unchanged; the same for a joint-register update after the owner moves the row out of the joint account.
- A26-S04-02: under `createEnforcedIntegrationModule([DelegationModule])`, the two probe cases: revoke between the capability read and write (expect zero rows after), and a second owner's link between the reset's check and write (expect the hash unchanged or a 403).
- Mutation families that must turn `covered` (`21-tests-ci-release.md` section 6.2): F1.

**Notes and decisions:** Re-read the delegation (or grant) under lock inside the bypass transaction and refuse if revoked; delegation management writes targeted updates. Correct `docs/backend/database-access-and-tenancy.md:31, 35` and `rls-context-smoke.spec.ts` (D-S04-05).

**Gate:**

- `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`, and `npm run build && npm run test:integration` (a query, a lock, an entity or an RLS context changes)
- docs: `node scripts/check-docs-manifests.mjs`; the `docs/system-invariants.md` entry the task corrects lands in the same PR

### T20 -- Delegation policies: a delegate-side session cannot issue itself a delegation

**Priority:** P2. **Depends on:** --. **Deploy impact:** migration. **PR size:** S.

**Closes:**

- A26-M06 (MEDIUM) The `account_delegates` and `account_delegate_grants` policies let a delegate-side session issue itself a delegation from any owner. Surfaces and session findings: A26-S04-03 (primary).

**Invariants and prior findings:** none indexed; see field 4 of each finding.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `database/schema.sql`, `database/migrations/114_rls_policies_special.sql`, `database/migrations/20261021120000_delegation_policies_owner_only_check.sql`.

**Regression tests it must land with:**

- A26-S04-03: in `rls-enforcement.integration.spec.ts`, as a delegate session: INSERT `account_delegates` naming another owner -> `42501`; INSERT a grant on a delegation the session is only the delegate of -> `42501`; as the owner, a grant on another owner's account -> `42501`.
- Mutation families that must turn `covered` (`21-tests-ci-release.md` section 6.2): F5.

**Notes and decisions:** Tighten the WITH CHECK of `account_delegates` and `account_delegate_grants` to the owner's identity; migration plus `schema.sql` in the same commit; an unprivileged-role test (S21 family F5).

**Gate:**

- `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`, and `npm run build && npm run test:integration` (a query, a lock, an entity or an RLS context changes)
- migration: `npm run migration:lint` (from `backend/`), `scripts/verify-schema.sh`, `node scripts/check-migration-prefixes.mjs`; `database/schema.sql` in the same commit
- docs: `node scripts/check-docs-manifests.mjs`; the `docs/system-invariants.md` entry the task corrects lands in the same PR

### T21 -- Backup retention never deletes another owner's legacy artifacts

**Priority:** P2. **Depends on:** --. **Deploy impact:** live. **PR size:** S.

**Closes:**

- A26-M07 (MEDIUM) Automatic-backup retention deletes legacy flat-root artifacts of other owners (MON-H01 residual, MON-M43). Surfaces and session findings: A26-S06-01 (primary); A26-S02-06 (superseded).

**Invariants and prior findings:** INV-BACKUP-001, MON-H01, MON-M43.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `backend/src/backup/auto-backup.service.ts`, `backend/src/backup/storage/local-backup-storage.target.ts`.

**Regression tests it must land with:**

- A26-S06-01: invert `auto-backup.service.spec.ts:3870` and `:3907`: legacy files survive any user's retention, and a sharded file is still pruned to the limit.

**Notes and decisions:** Exclude flat-root legacy files from per-user retention (or attribute them by decrypting the owner marker); replace the known-wrong `auto-backup.service.spec.ts:3870/3871, 3907` cases.

**Gate:**

- `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`, and `npm run build && npm run test:integration` (a query, a lock, an entity or an RLS context changes)

### T22 -- The S3 backup suite runs in CI and a local/S3 attachment round trip exists

**Priority:** P2. **Depends on:** --. **Deploy impact:** none. **PR size:** M.

**Closes:**

- A26-M08 (MEDIUM) The S3 half of INV-BACKUP-006 rests on a suite that never runs in CI and fails when it does; no local/S3 attachment round trip exists (MON-M47). Surfaces and session findings: A26-S06-02 (primary); A26-S06-05 (merged surface).

**Invariants and prior findings:** INV-BACKUP-006, INV-ATTACHMENT-001, MON-H02, MON-M47.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `backend/test/integration/backup-store-s3.integration.spec.ts`, `.github/workflows/ci.yml`, `docs/system-invariants.md`, `backend/test/integration/backup-restore.integration.spec.ts`, `backend/src/backup/backup.service.spec.ts`.

**Regression tests it must land with:**

- A26-S06-02: the existing suite, run in CI with the endpoint set.
- A26-S06-05: as 10.

**Notes and decisions:** Fix the suite's unpadded day names; add an S3-compatible service and `BACKUP_STORE_S3_TEST_ENDPOINT` to the integration job (a `.github/` change: Ask first); add the MON-M47 round trip; correct the INV-BACKUP-006 checksum sentence.

**Gate:**

- `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`, and `npm run build && npm run test:integration` (a query, a lock, an entity or an RLS context changes)
- CI/deployment: the workflow or Compose change exercised on a branch run; `node scripts/check-docs-manifests.mjs` and `node scripts/check-env-docs.mjs`

### T23 -- VOID crossings are decided under the row lock (bulk VOID expansion, `addSplit`)

**Priority:** P2. **Depends on:** T08, T09. **Deploy impact:** neutral. **PR size:** S.

**Closes:**

- A26-M09 (MEDIUM) VOID crossings are decided from a status read before the row lock (bulk VOID expansion and `addSplit`; MON-H10 residual). Surfaces and session findings: A26-S07-03 (primary); A26-S02-07 (superseded).

**Invariants and prior findings:** INV-TRANSFER-001, MON-H10.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `backend/src/transactions/transaction-bulk-update.service.ts`, `backend/src/transactions/transaction-split.service.ts`.

**Regression tests it must land with:**

- A26-S07-03: both interleavings with two connections and a barrier.

**Notes and decisions:** Read the status after `FOR UPDATE`; the split parent lock in `addSplit` gets its two-connection test (A26-S07-09 row).

**Gate:**

- `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`, and `npm run build && npm run test:integration` (a query, a lock, an entity or an RLS context changes)

### T24 -- An account cannot close over a pending future-dated row

**Priority:** P2. **Depends on:** --. **Deploy impact:** live. **PR size:** S.

**Closes:**

- A26-M12 (MEDIUM) An account closes over a pending future-dated row, which the due-balance cron later applies to the closed account (MON-M20 residual). Surfaces and session findings: A26-S07-06 (primary).

**Invariants and prior findings:** MON-M20.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `backend/src/accounts/accounts.service.ts`.

**Regression tests it must land with:**

- A26-S07-06: P7 as an integration case.

**Notes and decisions:** Refuse the close (or require the pending rows to be voided) and make the due-balance cron skip closed accounts.

**Gate:**

- `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`, and `npm run build && npm run test:integration` (a query, a lock, an entity or an RLS context changes)

### T25 -- No whole-entity or absolute write of `current_balance` outside the recompute

**Priority:** P2. **Depends on:** --. **Deploy impact:** neutral. **PR size:** S.

**Closes:**

- A26-M13 (MEDIUM) A whole-entity save or an absolute write puts a snapshot's `current_balance` back: investment-pair rename or re-currency, QIF/CSV opening balance. Surfaces and session findings: A26-S07-07 (primary); A26-S10-05 (merged surface).

**Invariants and prior findings:** INV-BALANCE-001, MON-H07.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `backend/src/accounts/accounts.service.ts`, `backend/src/import/import-entity-creator.service.ts`, `backend/src/import/import.service.ts`.

**Regression tests it must land with:**

- A26-S07-07: P8 as an integration case.
- A26-S10-05: `import-balance-delta.integration.spec.ts`: an opening balance of `100.1234` and a concurrent delta on a second connection; expect opening `100.1234` and current equal to the ledger.

**Notes and decisions:** Investment-pair rename/re-currency saves only the changed columns; the QIF/CSV opening balance becomes an atomic delta inside the import transaction, at full precision.

**Gate:**

- `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`, and `npm run build && npm run test:integration` (a query, a lock, an entity or an RLS context changes)

### T26 -- MNY writers: sleeve transfers and foreign-quoted trades in their own currencies

**Priority:** P2. **Depends on:** T04. **Deploy impact:** live. **PR size:** M.

**Closes:**

- A26-M16 (MEDIUM) A cross-currency transfer into an investment sleeve credits the bank account's amount under the sleeve's currency (MNY import). Surfaces and session findings: A26-S09-03 (primary).
- A26-M24 (MEDIUM) A Money-imported trade of a security quoted in another currency stores its price and total in the account's currency, read as the security's. Surfaces and session findings: A26-S12-09 (primary).

**Invariants and prior findings:** INV-PRICE-001, INV-HOLDING-001.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `backend/src/import/mny/map/map-transactions.ts`, `backend/src/import/mny/map/map-investments.ts`, `backend/src/securities/security-price.service.ts`.

**Regression tests it must land with:**

- A26-S09-03: a cross-currency variant of "pairs the bank row with a cash-sleeve row that funds the trade" asserting the sleeve amount 2640 and, at writer level, a sleeve balance of 0.00 after the trade.
- A26-S12-09: an MNY writer case with a CAD account and a USD security asserting the stored price and rate, and a transaction-price case asserting no `security_prices` row from a rate-1 cross-currency trade.
- Mutation families that must turn `covered` (`21-tests-ci-release.md` section 6.2): F6.

**Notes and decisions:** Synthesized counterparts carry the sleeve currency amount through the file's rate; imported trade price and total are stored in the security's currency (or converted with the row's rate); verification compares mapping, not only writes (DR-S09-01).

**Gate:**

- `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`, and `npm run build && npm run test:integration` (a query, a lock, an entity or an RLS context changes)

### T27 -- Currencies: no global row from a user action; default currency created before it is referenced

**Priority:** P2. **Depends on:** --. **Deploy impact:** live. **PR size:** M.

**Closes:**

- A26-M17 (MEDIUM) User actions create or leave global, active currencies offered to every user (MNY import, preferences, deleted users' custom currencies). Surfaces and session findings: A26-S09-06 (primary); A26-S13-06 (merged surface).
- A26-M25 (MEDIUM) Choosing a default currency that is not yet in the table fails on the foreign key: onboarding on a fresh instance accepts only USD. Surfaces and session findings: A26-S13-05 (primary).

**Invariants and prior findings:** none indexed; see field 4 of each finding.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `backend/src/import/mny/dto/mny-import.dto.ts`, `backend/src/currencies/currencies.service.ts`, `backend/src/import/mny/mny-import.service.ts`, `database/schema.sql`, `backend/src/users/users.service.ts`, `backend/src/currencies/entities/currency.entity.ts`, `frontend/src/components/auth/OnboardingPreferences.tsx`, `backend/src/users/dto/update-preferences.dto.ts`.

**Regression tests it must land with:**

- A26-S09-06: DTO test refusing `"q#!"`; integration test asserting that an import with a foreign-currency account leaves `currencies.is_active = false` for a code not previously present and that a second user's `findAll` does not list it.
- A26-S13-06: integration: user A creates and deletes; user B's `findAll` does not list A's code.
- A26-S13-05: an integration case on a database carrying the schema's FK: a fresh user sets `defaultCurrency: "PLN"`, the row is saved and `currencies` holds PLN.
- Mutation families that must turn `covered` (`21-tests-ci-release.md` section 6.2): F6.

**Notes and decisions:** Validate codes (ISO 4217 or the user's own custom table) on MNY `currencyOverride`, the MNY currency table and `UpdatePreferencesDto.defaultCurrency`; a deleted user's custom currencies are removed, not promoted; `ensureSystemCurrency` before the preference write (replace the mock in `users.service.spec.ts:148`).

**Gate:**

- `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`, and `npm run build && npm run test:integration` (a query, a lock, an entity or an RLS context changes)

### T28 -- QIF split-transfer legs are written in the target account's currency

**Priority:** P2. **Depends on:** --. **Deploy impact:** live. **PR size:** S.

**Closes:**

- A26-M18 (MEDIUM) A QIF split-transfer leg into another account is written in the source account's currency and amount (MON-H11 QIF half). Surfaces and session findings: A26-S10-02 (primary); A26-S02-09 (superseded).

**Invariants and prior findings:** INV-CURRENCY-001, MON-M27, MON-H11.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `backend/src/import/import-regular-processor.service.ts`.

**Regression tests it must land with:**

- A26-S10-02: the executed case, asserting the leg's currency is CAD and the row carries the pending note.
- Mutation families that must turn `covered` (`21-tests-ci-release.md` section 6.2): F6.

**Notes and decisions:** Convert the leg with the transfer's rate or refuse a cross-currency split transfer without one.

**Gate:**

- `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`, and `npm run build && npm run test:integration` (a query, a lock, an entity or an RLS context changes)

### T29 -- Account delete checks and deletes in one locked transaction

**Priority:** P2. **Depends on:** T08. **Deploy impact:** neutral. **PR size:** S.

**Closes:**

- A26-M19 (MEDIUM) Deleting an account checks "no transactions" in one transaction and deletes in another: a concurrent sync or import is cascaded away. Surfaces and session findings: A26-S10-03 (primary).

**Invariants and prior findings:** INV-TRANSFER-001.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `backend/src/accounts/accounts.service.ts`, `database/schema.sql`.

**Regression tests it must land with:**

- A26-S10-03: two connections: connection 1 holds A's row lock and inserts a row (as the writer does), connection 2 calls `delete`; release; expect `BadRequestException` and the row present.
- Mutation families that must turn `covered` (`21-tests-ci-release.md` section 6.2): F1.

**Notes and decisions:** Lock the account row, count, delete; a concurrent sync or import either waits or is refused.

**Gate:**

- `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`, and `npm run build && npm run test:integration` (a query, a lock, an entity or an RLS context changes)

### T30 -- AI and MCP edits keep the row's own exchange rate unless one is named

**Priority:** P2. **Depends on:** T15. **Deploy impact:** live. **PR size:** S.

**Closes:**

- A26-M20 (MEDIUM) An AI or MCP edit that names no rate replaces the row's own exchange rate with a freshly resolved market rate (INV-FX-002). Surfaces and session findings: A26-S12-03 (primary).

**Invariants and prior findings:** INV-FX-002.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `backend/src/securities/investment-transactions.service.ts`.

**Regression tests it must land with:**

- A26-S12-03: preview a description-only edit of a cross-currency row with a stored rate different from the market and assert `preview.exchangeRate` equals the stored rate; at integration level, P4 asserting the cash leg.

**Notes and decisions:** MCP single, MCP bulk and the assistant confirmation (three surfaces).

**Gate:**

- `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`, and `npm run build && npm run test:integration` (a query, a lock, an entity or an RLS context changes)

### T31 -- Security transfers: basis and realized gains from the source lots at the transfer's rate

**Priority:** P2. **Depends on:** --. **Deploy impact:** live. **PR size:** M.

**Closes:**

- A26-M21 (MEDIUM) Realized gains and capital-gains replays price a transferred-in lot at the carried per-share figure and rate 1 (MON-M35 residual). Surfaces and session findings: A26-S12-04 (primary).
- A26-M22 (MEDIUM) A security transfer's basis is the leg's stored price (today's average on create, the client's figure on edit); the form shows an editable cost the server replaces. Surfaces and session findings: A26-S12-05 (primary); A26-S19-05 (merged surface).

**Invariants and prior findings:** MON-M35, INV-HOLDING-001.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `backend/src/securities/portfolio-calculation.service.ts`, `backend/src/securities/investment-transactions.service.ts`, `backend/src/securities/holdings.service.ts`, `frontend/src/components/investments/InvestmentTransactionForm.tsx`, `frontend/src/i18n/messages/en/investments.json`.

**Regression tests it must land with:**

- A26-S12-04: P5 at integration level asserting 548.00 from `calculateRealizedGains` and equality with the lots surface; a source scan that no replay folds `TRANSFER_IN` through `acquisitionCost`.
- A26-S12-05: P1 at integration level (basis sum 3,000), and an edit case that changes the transfer's date and asserts the destination's basis follows.
- A26-S19-05: a new transfer from a holding renders the cost field disabled, showing the source average.

**Notes and decisions:** The transfer basis is the source lots' cost (back-dated: as of the transfer date), never today's average or a client figure; realized-gain and capital-gains replays use it with the row's rate (three of four replays); the form shows the server's basis read-only (A26-S19-05).

**Gate:**

- `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`, and `npm run build && npm run test:integration` (a query, a lock, an entity or an RLS context changes)
- `frontend/`: `npm run lint && npm run type-check && npm run i18n:check`, `npm run test:changed`, `npm run build`; grep `e2e/` for any renamed control's accessible name

### T32 -- The holdings fold keeps small fractional positions

**Priority:** P2. **Depends on:** --. **Deploy impact:** live. **PR size:** S.

**Closes:**

- A26-M23 (MEDIUM) The holdings fold snaps every intermediate position under 0.0001 shares to zero. Surfaces and session findings: A26-S12-06 (primary).

**Invariants and prior findings:** INV-HOLDING-001, INV-HOLDING-002.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `backend/src/securities/holdings.service.ts`.

**Regression tests it must land with:**

- A26-S12-06: P2 at integration level, and a unit case in `holdings.service.spec.ts` folding 10 BUYs of 0.00009.
- Mutation families that must turn `covered` (`21-tests-ci-release.md` section 6.2): F7.

**Notes and decisions:** Snap to zero only the final position within tolerance, not every intermediate one; pin both sides of the 0.0001 boundary (S21 family F7).

**Gate:**

- `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`, and `npm run build && npm run test:integration` (a query, a lock, an entity or an RLS context changes)

### T33 -- Bond holdings are not valued on a day the engine refuses to price

**Priority:** P2. **Depends on:** --. **Deploy impact:** live. **PR size:** M.

**Closes:**

- A26-M26 (MEDIUM) On a day the bond engine refuses to price, the blend readers still value the holding; current per-account surfaces use the blended price (INV-BOND-010). Surfaces and session findings: A26-S14-01 (primary); A26-S14-02 (merged surface).

**Invariants and prior findings:** INV-BOND-010, INV-BOND-002, INV-BOND-005.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `backend/src/net-worth/net-worth.service.ts`, `backend/src/net-worth/position-price.util.ts`, `backend/src/bonds/bond-price.service.ts`, `backend/src/monte-carlo/monte-carlo.service.ts`, `backend/src/investment-reports/investment-report-data.service.ts`, `docs/system-invariants.md`.

**Regression tests it must land with:**

- A26-S14-01: an integration test with one linked security, two derivable lots and a third BUY stored with a NULL series: `getDailyInvestments` (and `getLatestNetWorth`) on a day after the NULL row reports the security unknown, never `quantity x` the trade price or the carried engine close.
- A26-S14-02: a Monte Carlo `getHoldingStats` unit test with two accounts holding different series of one program, asserting each account's `marketValue` equals its lots' value.
- Suggested test files (field 13 diffs): `backend/test/integration/bond-holding-value.integration.spec.ts`, `backend/src/monte-carlo/monte-carlo.service.spec.ts`.

**Notes and decisions:** Blend readers (net worth daily and monthly, latest net worth, period figures) honour the engine's refusal; current per-account surfaces use the engine price; correct INV-BOND-010's entry. Check the Monte Carlo bond surfaces S13/S14 handed on.

**Gate:**

- `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`, and `npm run build && npm run test:integration` (a query, a lock, an entity or an RLS context changes)

### T34 -- GEM: momentum at the boundary's own close; the signal alert bound to its period

**Priority:** P2. **Depends on:** --. **Deploy impact:** live. **PR size:** S.

**Closes:**

- A26-M27 (MEDIUM) GEM momentum prices one role from a close up to 14 days before the boundary while its series holds a later close. Surfaces and session findings: A26-S15-02 (primary).
- A26-L24 (LOW) The GEM signal-change alert is not bound to the current period and its dedupe memory is purged after the retention window. Surfaces and session findings: A26-S15-07 (primary).

**Invariants and prior findings:** INV-GEM-NOTIFY-002, INV-GEM-NOTIFY-003.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `backend/src/strategies/gem-momentum.util.ts`, `backend/src/common/time-series/price-boundary.util.ts`, `backend/src/strategies/gem-signal-change-alert.service.ts`, `backend/src/notification-center/notification.service.ts`, `backend/src/notification-center/notification-bounds.ts`.

**Regression tests it must land with:**

- A26-S15-02: the counterexample above as a `gem-momentum.util.spec.ts` case asserting the ex-US role is not `PRICED` (or the snapshot refuses) for 2026-09-30.
- A26-S15-07: spec test-matrix items 5-8 (`gem-signal-change-alert.service.spec.ts`): no current signal plus two differing history rows -> no notify; a purge then a re-run -> no second notify.

**Notes and decisions:** Both roles priced from the same session; the alert keyed by period and not re-announced after the retention purge.

**Gate:**

- `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`, and `npm run build && npm run test:integration` (a query, a lock, an entity or an RLS context changes)

### T35 -- Loan postings: an installment below the interest, and a source account in another currency

**Priority:** P2. **Depends on:** T12. **Deploy impact:** live. **PR size:** M.

**Closes:**

- A26-M29 (MEDIUM) An installment below the period's interest is booked as settling the period; the unpaid interest is recorded nowhere. Surfaces and session findings: A26-S15-04 (primary).
- A26-M30 (MEDIUM) Loan payment setup accepts a source account in another currency; every posting of the bill is then refused. Surfaces and session findings: A26-S15-10 (primary).

**Invariants and prior findings:** INV-LOAN-006.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `backend/src/accounts/loan-payment-waterfall.util.ts`, `backend/src/accounts/loan-payment-setup.service.ts`.

**Regression tests it must land with:**

- A26-S15-04: R3 with an assert on the chosen behaviour (`unpaidInterest === 500` on the allocation and on the projection).
- A26-S15-10: (recommended correction) refuse in `setupLoanPayments` (and the account-create paths) when `sourceAccount.currencyCode !== account.currencyCode`, before any write; independently, make `ScheduledTransactionsService.create` derive or verify `currencyCode` against the schedule's account.
- Mutation families that must turn `covered` (`21-tests-ci-release.md` section 6.2): F6.

**Notes and decisions:** Record unpaid interest (or refuse the installment) per `docs/specs/loan-installment-settlement.md`; setup refuses a source account in another currency or converts by rule.

**Gate:**

- `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`, and `npm run build && npm run test:integration` (a query, a lock, an entity or an RLS context changes)
- `frontend/`: `npm run lint && npm run type-check && npm run i18n:check`, `npm run test:changed`, `npm run build`; grep `e2e/` for any renamed control's accessible name

### T36 -- Loan history and report: VOID and future rows, Original Amount, interest saved

**Priority:** P2. **Depends on:** --. **Deploy impact:** live. **PR size:** S.

**Closes:**

- A26-M28 (MEDIUM) The loan payment history counts VOID payments, VOID interest expenses and future-dated payments as paid. Surfaces and session findings: A26-S15-03 (primary).
- A26-L25 (LOW) Loan Amortization Report: "Original Amount" double-counts projected principal when the opening balance is unset; exports run while loading. Surfaces and session findings: A26-S15-08 (primary).
- A26-L34 (LOW) "Interest already saved" counts unrecorded interest as saved for a loan that books interest outside the app. Surfaces and session findings: A26-S20-06 (primary).

**Invariants and prior findings:** INV-TRANSFER-001, INV-LOAN-HISTORY-001.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `frontend/src/lib/loan-history.ts`, `frontend/src/components/reports/LoanAmortizationReport.tsx`, `frontend/src/lib/loan-past-impact.ts`.

**Regression tests it must land with:**

- A26-S15-03: the three probe cases in `loan-history.test.ts` with monetary asserts.
- A26-S15-08: (recommended correction) `originalBalance = history.startingBalance` when the opening balance is unset; disable both exports while the history is in error.
- A26-S20-06: (recommended correction) return `interestAlreadySaved: null` when no repayment recorded interest and the loan's rate is not zero (the `observedInstallment(...).complete === false` test).

**Notes and decisions:** History excludes VOID payments and interest and future-dated payments; the amortization report's Original Amount and its export gate; 'interest already saved' only for recorded interest.

**Gate:**

- `frontend/`: `npm run lint && npm run type-check && npm run i18n:check`, `npm run test:changed`, `npm run build`; grep `e2e/` for any renamed control's accessible name

### T37 -- Budgets: exclusions applied, rollover written, periods and alerts

**Priority:** P2. **Depends on:** T16. **Deploy impact:** live. **PR size:** M.

**Closes:**

- A26-M31 (MEDIUM) The account exclusions chosen in the budget wizard are stored and never applied. Surfaces and session findings: A26-S16-02 (primary).
- A26-M32 (MEDIUM) Closing a budget period never writes a rollover: `closePeriod` does not load the relation `computeRollover` reads. Surfaces and session findings: A26-S16-03 (primary).
- A26-L38 (LOW) A manual close in the middle of a budget period leaves the budget with no OPEN period for good. Surfaces and session findings: A26-S16-07 (primary).
- A26-L39 (LOW) Two flex groups over 90 percent share one alert fingerprint, so the second is never raised in the period. Surfaces and session findings: A26-S16-08 (primary).

**Invariants and prior findings:** MON-L03.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `frontend/src/components/budgets/BudgetWizardStrategy.tsx`, `backend/src`, `backend/src/budgets/budget-spending.util.ts`, `backend/src/budgets/budget-period.service.ts`, `database/schema.sql`.

**Regression tests it must land with:**

- A26-S16-02: an integration case with one excluded account: its expense is not in `spent`.
- A26-S16-03: the P2 scenario against PostgreSQL.
- A26-S16-07: the P3 scenario: after a close dated inside the period, exactly one OPEN period exists and it starts the next month (or the close is refused with 400).
- A26-S16-08: two groups at 95 percent produce two rows.
- Mutation families that must turn `covered` (`21-tests-ci-release.md` section 6.2): F6.

**Notes and decisions:** Apply the wizard's account exclusions in both actuals copies (`computePeriodActuals` and `queryCategorySpending`, section 15); load the relation `computeRollover` reads; a mid-period close opens the next period; flex-group alert fingerprints include the group.

**Gate:**

- `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`, and `npm run build && npm run test:integration` (a query, a lock, an entity or an RLS context changes)

### T38 -- Custom report engine: signed category sums and escaped search

**Priority:** P2. **Depends on:** T16. **Deploy impact:** live. **PR size:** S.

**Closes:**

- A26-M33 (MEDIUM) A category's cost is not its signed sum: the custom report engine sums absolute values, the loan summary adds an interest refund to "Interest Paid". Surfaces and session findings: A26-S16-05 (primary); A26-S15-05 (merged surface).
- A26-L12 (LOW) The custom-report text filter is a second search door with unescaped LIKE wildcards (INV-SEARCH-001). Surfaces and session findings: A26-S07-08 (primary).

**Invariants and prior findings:** INV-SEARCH-001.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `backend/src/reports/reports.service.ts`, `frontend/src/lib/loan-history.ts`.

**Regression tests it must land with:**

- A26-S16-05: the -100 / +30 case through `executeReport`, asserting 70.
- A26-S15-05: `it("nets an interest refund", () => { ... intx({ amount: -200 }), intx({ amount: 50 }) ...; expect(h.cumulativeInterest).toBe(150); })`.
- A26-S07-08: a report over payees `50 Shop` and `5000 Mart` filtered on `50%`: with `%` literal it returns neither (no payee contains `50%`); today it returns both.

**Notes and decisions:** Net within one category (`isNetSpending` / `NET_SPEND_AMOUNT`) in the engine and in the loan summary's 'Interest Paid'; route the text filter through the search door with escaped wildcards (INV-SEARCH-001).

**Gate:**

- `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`, and `npm run build && npm run test:integration` (a query, a lock, an entity or an RLS context changes)

### T39 -- AI/MCP spending anomalies receive months and threshold in the right places

**Priority:** P2. **Depends on:** --. **Deploy impact:** live. **PR size:** S.

**Closes:**

- A26-M34 (MEDIUM) The AI and MCP `spending_anomalies` report passes the requested number of months as the z-score threshold. Surfaces and session findings: A26-S17-03 (primary).

**Invariants and prior findings:** none indexed; see field 4 of each finding.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `backend/src/ai/query/tool-executor.service.ts`, `backend/src/mcp/tools/reports.tool.ts`, `backend/src/built-in-reports/anomaly-reports.service.ts`.

**Regression tests it must land with:**

- A26-S17-03: both adapter specs assert `getSpendingAnomalies` is called with the user id only (or with the documented threshold), replacing the two known-wrong assertions.
- Suggested test files (field 13 diffs): `backend/src/ai/query/tool-executor.service.spec.ts`.

**Notes and decisions:** Fix the argument order; replace the two known-wrong specs (`tool-executor.service.spec.ts:1345-1351`, `reports.tool.spec.ts:220-246`).

**Gate:**

- `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`, and `npm run build && npm run test:integration` (a query, a lock, an entity or an RLS context changes)

### T40 -- Client caches: invalidation for recategorising, valuation inputs and imports; generation-aware reads

**Priority:** P2. **Depends on:** --. **Deploy impact:** live. **PR size:** M.

**Closes:**

- A26-M35 (MEDIUM) Client caches outlive the data they derive from: recategorising writes, non-ledger valuation inputs and MNY imports invalidate nothing, and hand-rolled reads are not generation-aware (INV-CACHE-001 client half). Surfaces and session findings: A26-S18-01 (primary); A26-S18-02 (merged surface); A26-S18-03 (merged surface); A26-S18-07 (merged surface).

**Invariants and prior findings:** INV-CACHE-001, MON-M38.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `frontend/src/lib/categories.ts`, `frontend/src/lib/payees.ts`, `frontend/src/lib/balance-cache.guard.test.ts`, `frontend/src/lib/investments.ts`, `frontend/src/lib/budgets.ts`, `frontend/src/lib/user-settings.ts`, `frontend/src/lib/import-mny.ts`.

**Regression tests it must land with:**

- A26-S18-01: prime `budgets:dashboard`, run each write, assert the next read goes to the network.
- A26-S18-02: a source scan in `cache-prefix-classification.guard.test.ts` that fails a `setCache(` outside `apiCache.ts` and the two list-rewrite sites, plus one behavioural case per family.
- A26-S18-03: one lib case per channel asserting the summary key is dropped; a guard row classifying `/securities/:id/prices` as transaction-derived.
- A26-S18-07: extend `import-mny.test.ts` with `setCache('categories:all', [...])` then a completed `getJob`, asserting the key is gone.
- Suggested test files (field 13 diffs): `frontend/src/lib/categories.test.ts`, `frontend/src/lib/investments.test.ts`, `frontend/src/lib/user-settings.test.ts`.
- Mutation families that must turn `covered` (`21-tests-ci-release.md` section 6.2): F11.

**Notes and decisions:** All four surfaces; add the `setCache(` outside `apiCache.ts` guard S18 proposed so new hand-rolled reads cannot appear.

**Gate:**

- `frontend/`: `npm run lint && npm run type-check && npm run i18n:check`, `npm run test:changed`, `npm run build`; grep `e2e/` for any renamed control's accessible name

### T41 -- Intraday portfolio cache keyed by user and acting context, cleared on sign-out and switch

**Priority:** P2. **Depends on:** --. **Deploy impact:** live. **PR size:** S.

**Closes:**

- A26-M36 (MEDIUM) The intraday portfolio series is cached in sessionStorage with no user or acting-context key and survives sign-out and context switches. Surfaces and session findings: A26-S20-04 (primary); A26-S18-08 (merged surface).

**Invariants and prior findings:** INV-SHARE-003.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `frontend/src/components/investments/portfolio-chart-utils.tsx`, `frontend/src/store/authStore.ts`, `frontend/src/components/layout/DelegationBanner.tsx`.

**Regression tests it must land with:**

- A26-S20-04: the probe below, plus a key test asserting two identities never share a key.
- A26-S18-08: in `authStore.test.ts`, write an `INTRADAY_CACHE_PREFIX` key, call `logout()`, await the dynamic import, assert it is gone; extend the persisted-storage guard to scan `sessionStorage.setItem` writers.

**Notes and decisions:** One key shape for both S18 and S20 surfaces.

**Gate:**

- `frontend/`: `npm run lint && npm run type-check && npm run i18n:check`, `npm run test:changed`, `npm run build`; grep `e2e/` for any renamed control's accessible name

### T42 -- Amounts keep four decimals through load, blur and save

**Priority:** P2. **Depends on:** T06, T07. **Deploy impact:** live. **PR size:** M.

**Closes:**

- A26-M37 (MEDIUM) Four-decimal amounts are loaded and blurred at two decimals, so an unedited save re-amounts a row or is refused (MON-M37). Surfaces and session findings: A26-S19-03 (primary).

**Invariants and prior findings:** MON-M37.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `frontend/src/components/ui/CurrencyInput.tsx`, `backend/src/common/split-amount.util.ts`, `frontend/src/components/transactions/TransactionForm.tsx`.

**Regression tests it must land with:**

- A26-S19-03: `CurrencyInput` with `value={-3.3333}` focused and blurred reports nothing; `TransactionForm` reopening -3.3333 sends -3.3333; a -12.3457 split parent saves unedited.
- Suggested test files (field 13 diffs): `frontend/src/components/ui/CurrencyInput.test.tsx`.

**Notes and decisions:** Transaction, split parent, account opening balance and the other surfaces S19 lists; the tolerance compares at the server's precision.

**Gate:**

- `frontend/`: `npm run lint && npm run type-check && npm run i18n:check`, `npm run test:changed`, `npm run build`; grep `e2e/` for any renamed control's accessible name

### T43 -- Portfolio gain over priced holdings only, marked partial

**Priority:** P2. **Depends on:** T17. **Deploy impact:** live. **PR size:** S.

**Closes:**

- A26-M38 (MEDIUM) Portfolio gain is the priced market value less the cost of every holding, so an unpriced holding reads as a loss of its whole cost. Surfaces and session findings: A26-S20-02 (primary).

**Invariants and prior findings:** none indexed; see field 4 of each finding.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `backend/src/securities/portfolio-calculation.service.ts`, `backend/src/securities/portfolio.service.ts`, `frontend/src/components/reports/InvestmentPerformanceReport.tsx`.

**Regression tests it must land with:**

- A26-S20-02: a backend unit case with one priced and one unpriced holding asserting the gain is over the priced holding (or null), and the frontend probe below.

**Notes and decisions:** Gain = priced value less the cost of priced holdings; the unpriced cost is reported separately; the AI and MCP portfolio tools quote the same fields.

**Gate:**

- `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`, and `npm run build && npm run test:integration` (a query, a lock, an entity or an RLS context changes)
- `frontend/`: `npm run lint && npm run type-check && npm run i18n:check`, `npm run test:changed`, `npm run build`; grep `e2e/` for any renamed control's accessible name

### T44 -- A failed or pending request is never shown as data

**Priority:** P2. **Depends on:** T17. **Deploy impact:** live. **PR size:** S.

**Closes:**

- A26-M39 (MEDIUM) A failed or pending request is shown as data: reports keep the previous window through a failed reload, the country view and the dashboard render a failure as empty or zero. Surfaces and session findings: A26-S20-03 (primary); A26-S20-05 (merged surface); A26-S20-08 (merged surface).

**Invariants and prior findings:** INV-REPORT-002.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `frontend/src/hooks/useReportData.ts`, `frontend/src/components/reports/CashFlowSankeyReport.tsx`, `frontend/src/components/reports/NetWorthReport.tsx`, `frontend/src/components/reports/GeographicAllocationReport.tsx`, `frontend/src/app/dashboard/page.tsx`.

**Regression tests it must land with:**

- A26-S20-03: per report, load once, fail the second request, assert the export is disabled (and on Sankey that no card renders).
- A26-S20-05: (verification method) `npm run test -- GeographicAllocationReport`.
- A26-S20-08: (recommended correction) see the finding in the final report

**Notes and decisions:** Reports drop the previous answer on a failed reload and gate exports; the country view and the dashboard render an error state.

**Gate:**

- `frontend/`: `npm run lint && npm run type-check && npm run i18n:check`, `npm run test:changed`, `npm run build`; grep `e2e/` for any renamed control's accessible name

### T45 -- The production image is booted by a gate, and the documented Compose volumes are writable

**Priority:** P2. **Depends on:** --. **Deploy impact:** release. **PR size:** M.

**Closes:**

- A26-M40 (MEDIUM) The production image is never exercised: no CI gate boots the published target, and both documented Compose deployments mount backup and attachment directories the backend user cannot write. Surfaces and session findings: A26-S21-01 (primary); A26-S21-03 (merged surface).

**Invariants and prior findings:** INV-RELEASE-001, MON-M01.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `.github/workflows/ci.yml`, `backend/Dockerfile`, `frontend/Dockerfile`, `README.md`.

**Regression tests it must land with:**

- A26-S21-01: the smoke job itself; plus a guard that every image the publish jobs build (`target: production`) is also built by a job in their `needs:`.
- A26-S21-03: a production-image boot smoke (A26-S21-01) that mounts a fresh named volume at `/data/backups` and asserts the backup store reports `available: true`.

**Notes and decisions:** A CI job builds the production target and starts it against PostgreSQL (`docker-entrypoint.sh`, `node dist/main.js`); the Compose files create the backup and attachment directories owned by uid 1001 (or document the `chown`). `.github/` and `docker-compose*.yml`: Ask first.

**Gate:**

- CI/deployment: the workflow or Compose change exercised on a branch run; `node scripts/check-docs-manifests.mjs` and `node scripts/check-env-docs.mjs`

### T46 -- Release publishes after its gates and pushes no untested bump

**Priority:** P2. **Depends on:** T45. **Deploy impact:** release. **PR size:** M.

**Closes:**

- A26-M41 (MEDIUM) Release publication precedes the gates: images reach `:latest` before the CVE gate, and the release job pushes an untested `[skip ci]` bump with an admin token (MON-M45). Surfaces and session findings: A26-S21-02 (primary); A26-S02-10 (merged surface).

**Invariants and prior findings:** INV-RELEASE-001, MON-M45.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `.github/workflows/ci.yml`, `backend/package.json`, `docs/release-integrity.md`, `docs/system-invariants.md`.

**Regression tests it must land with:**

- A26-S21-02: a workflow self-test (the INV-RELEASE-001 "Required tests" row) asserting, by parsing `ci.yml`, that no step with `push: true` in `build-and-push` carries a non-digest tag before the step named "Fail on critical CVEs", and that `workflow_dispatch` runs are not in a cancelling group.
- A26-S02-10: a dry-run comparing tested, pushed, image and tag SHAs.

**Notes and decisions:** Push images to `:X.Y.Z` and `:latest` only after the CVE gate passes; tag the tested SHA and bump in a PR (or re-run CI on the bump); correct INV-RELEASE-001's retry semantics. `.github/`: Ask first.

**Gate:**

- CI/deployment: the workflow or Compose change exercised on a branch run; `node scripts/check-docs-manifests.mjs` and `node scripts/check-env-docs.mjs`

### T47 -- One red test per remaining family row of the program mutation table

**Priority:** P2. **Depends on:** T08, T09, T10, T12. **Deploy impact:** none. **PR size:** L.

**Closes:**

- A26-M42 (MEDIUM) The concurrency, post-commit and database-boundary invariants behind the program's HIGH and MEDIUM findings have no test at the production boundary (MON-M46). Surfaces and session findings: A26-S21-04 (primary); A26-S03-04 (merged surface); A26-S04-04 (merged surface); A26-S05-01 (merged surface); A26-S07-09 (merged surface); A26-S08-05 (merged surface); A26-S16-09 (merged surface); A26-S17-05 (merged surface); A26-S02-12 (merged surface); A26-S06-06 (merged surface); A26-S09-02 (merged surface).

**Invariants and prior findings:** INV-AUTH-001, INV-CLAIM-001, INV-OCCURRENCE-001, INV-CRON-001, INV-MCP-001, INV-BACKUP-009, INV-IMPORT-002, MON-M46, MON-M04.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `backend/test/helpers/integration-setup.ts`, `backend/src/auth/token.service.ts`, `backend/src/emergency-access/emergency-access-claim.controller.ts`, `backend/src/auth/token.service.spec.ts`, `backend/test/integration/logout-revoke-failpoint.integration.spec.ts`, `backend/test/integration/emergency-access-grant-cycles.integration.spec.ts`, `backend/src/emergency-access/emergency-access-claim.controller.spec.ts`, `backend/test/integration/joint-accounts.integration.spec.ts`, `backend/test/integration/schema-entity-parity.integration.spec.ts`, `backend/test/helpers/rls-setup.ts`, `backend/src/budgets/entities/budget-period.entity.ts`, `database/schema.sql`, `backend/src/budgets/budget-period.service.ts`, `backend/src/transactions/transaction-split.service.ts`, `backend/src/accounts/accounts.service.ts`, `backend/src/transactions/transaction-transfer.service.ts`, and 6 more named in the findings.

**Regression tests it must land with:**

- A26-S21-04: per family, the first test listed in section 6.2's "first red test" column.
- A26-S03-04: as above; each must be shown failing on its mutation before it is merged.
- A26-S04-04: the case above (fails under mutation MA).
- A26-S05-01: the extended parity guard above, plus a two-connection integration test of `createPeriodForBudget` for one budget and one month.
- A26-S07-09: (recommended correction) add two-connection cases: concurrent `addSplit`; close versus an un-void; two concurrent `updateTransfer` with different amounts.
- A26-S08-05: (recommended correction) add `scheduled-posting.integration.spec.ts` built as `<scratchpad>/mut/backend/test/integration/zz-s08-probe.integration.spec.ts` is built, and `job-claim-lease.integration.spec.ts`.
- A26-S16-09: P4 (two `pg` clients, barrier, one row) and P2/P3 as committed integration specs; a VOID expense in `budget-split-transfer-spending` asserting it is not in `spent`.
- A26-S17-05: ```diff +++ b/backend/src/mcp/mcp-http.controller.spec.ts +it("serves an existing session's tool the scopes of the token presented now", async () => { + // initialize with oauth grant g1 scopes "read,write"; then call a tool with + // the same grant (credentialId oauth:g1) whose current scope is "read". + validateAccessToken.mockResolvedValueOnce({ userId: "u1", scopes: "read,write", grantId: "g1" }); + const sid = ...
- A26-S02-12: as item 11, asserting one success, one 404, one password.
- A26-S06-06: as 7.
- A26-S09-02: (verification method) re-run M1 and M2; both must turn the integration suite red.
- Suggested test files (field 13 diffs): `backend/test/integration/budget-period-create-race.integration.spec.ts`.
- Mutation families that must turn `covered` (`21-tests-ci-release.md` section 6.2): F1, F2, F3, F4, F5, F8, F9.

**Notes and decisions:** Every row of `21-tests-ci-release.md` section 6.2 not already turned `covered` by its finding's task: F2 lease expiry on a real database, F3 parity cases, F5 unprivileged-role cases, F9 negative cases, F11 cache freshness. Re-run each mutation; every row must turn `covered`.

**Gate:**

- `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`, and `npm run build && npm run test:integration` (a query, a lock, an entity or an RLS context changes)
- `frontend/`: `npm run lint && npm run type-check && npm run i18n:check`, `npm run test:changed`, `npm run build`; grep `e2e/` for any renamed control's accessible name

### T48 -- CI lint without `--fix`, the allowlist fence, and the instruction-file contradictions

**Priority:** P3. **Depends on:** --. **Deploy impact:** none. **PR size:** S.

**Closes:**

- A26-L01 (LOW) CI's backend lint step runs `eslint --fix`, so a fixable lint error never fails CI. Surfaces and session findings: A26-S01-01 (primary).
- A26-L02 (LOW) The `WITH_CONTEXT_ALLOWLIST` lint fence misses several import forms. Surfaces and session findings: A26-S01-02 (primary).
- A26-L03 (LOW) The layer instruction files order a local coverage run that `AGENTS.md` and the verification contract say is CI's. Surfaces and session findings: A26-S01-03 (primary).
- A26-L04 (LOW) `.claude/settings.json` pre-approves `npm install*`, an action `AGENTS.md` lists under "Ask first". Surfaces and session findings: A26-S01-04 (primary).

**Invariants and prior findings:** none indexed; see field 4 of each finding.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `backend/package.json`, `.github/workflows/ci.yml`, `docs/verification-contract.md`, `backend/eslint.config.mjs`, `backend/src/common/request-context.ts`, `backend/CLAUDE.md`, `frontend/CLAUDE.md`.

**Regression tests it must land with:**

- A26-S01-01: A source-scanning guard over `ci.yml` that fails when a lint step in any job resolves to a script carrying `--fix`.
- A26-S01-02: Extend `lint-bans.spec.ts` (it already loads the config) with a case that lints each bypass spelling through the ESLint Node API from a non-allowlisted path and expects one error each.
- A26-S01-03: Extend `test-changed.guard.spec.ts` to scan every `CLAUDE.md` "Before you finish" block and fail on `--coverage` or `test:cov` there.
- A26-S01-04: A guard that reads `.claude/settings.json` and fails on an allow entry matching `npm install`, `npm i `, `npm update`, `git push`, `git reset`, `git rebase`.
- Mutation families that must turn `covered` (`21-tests-ci-release.md` section 6.2): F10.

**Notes and decisions:** CI runs lint in check form; the `WITH_CONTEXT_ALLOWLIST` fence matches every import form; the layer files defer coverage to CI; `.claude/settings.json` drops `npm install*`. `.github/`: Ask first.

**Gate:**

- CI/deployment: the workflow or Compose change exercised on a branch run; `node scripts/check-docs-manifests.mjs` and `node scripts/check-env-docs.mjs`
- docs: `node scripts/check-docs-manifests.mjs`; the `docs/system-invariants.md` entry the task corrects lands in the same PR

### T49 -- Access-token type check and atomic attempt budgets

**Priority:** P3. **Depends on:** T18. **Deploy impact:** neutral. **PR size:** S.

**Closes:**

- A26-L06 (LOW) `JwtStrategy` accepts every `JWT_SECRET`-signed token except `2fa_pending` as an access token. Surfaces and session findings: A26-S03-03 (primary).
- A26-L08 (LOW) Per-user TOTP and step-up attempt budgets are enforced by peek-then-verify. Surfaces and session findings: A26-S03-06 (primary).

**Invariants and prior findings:** none indexed; see field 4 of each finding.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `backend/src/auth/strategies/jwt.strategy.ts`, `backend/src/auth/step-up/step-up.service.ts`, `backend/src/auth/oidc/oidc-reauth.service.ts`, `backend/src/auth/two-factor.service.ts`.

**Regression tests it must land with:**

- A26-S03-03: `jwt.strategy.spec.ts`: `validate({ sub, type: "step_up" })`, `oidc_reauth` and `oidc_reauth_pending` all reject.
- A26-S03-06: integration: 20 concurrent wrong codes against one user; assert at most `MAX` reached the verifier (spy on `verifyTotpForUser` call count, real counter table).

**Notes and decisions:** `JwtStrategy` accepts only the access type; TOTP and step-up budgets reserve before verifying.

**Gate:**

- `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`, and `npm run build && npm run test:integration` (a query, a lock, an entity or an RLS context changes)

### T50 -- Migration contract step, restore staging intents, restore backfills

**Priority:** P3. **Depends on:** --. **Deploy impact:** neutral. **PR size:** M.

**Closes:**

- A26-L09 (LOW) `20260908120000_remove_notification_browser.sql` drops a column the previous release still selects. Surfaces and session findings: A26-S05-02 (primary).
- A26-L10 (LOW) Restore staging writes external attachment objects without an upload intent (MON-M22 residual). Surfaces and session findings: A26-S06-03 (primary).
- A26-L11 (LOW) A restore applies no semantic backfill to rows from an older artifact (`skip_price_updates`). Surfaces and session findings: A26-S06-04 (primary); A26-S05-03 (superseded).

**Invariants and prior findings:** INV-ATTACHMENT-001, MON-M22.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `database/migrations/20260908120000_remove_notification_browser.sql`, `backend/src/users/entities/user-preference.entity.ts`, `backend/scripts/migration-lint.mjs`, `backend/src/backup/backup-attachment-transfer.service.ts`, `backend/src/backup/backup-restore.service.ts`, `backend/src/attachments/attachments.service.ts`, `database/migrations/20261012131846_securities_skip_price_updates_user_switch.sql`, `backend/src/backup/backup-format.ts`, `backend/src/backup/`, `backend/src/backup/backup-restore-database.service.ts`.

**Regression tests it must land with:**

- A26-S05-02: a `migration-lint` self-test fixture with a bare `DROP COLUMN` that must be refused, and one with the marker that passes.
- A26-S06-03: R4 of the scratch spec, asserting the tombstone count rises by the number of staged keys and the sweeper then removes them.
- A26-S06-04: restore a fixture without `producedBy` holding `{ skip_price_updates: true, quote_provider: "yahoo" }` and assert `false`; one with `producedBy` at or after the migration keeps `true`.
- Mutation families that must turn `covered` (`21-tests-ci-release.md` section 6.2): F8, F10.

**Notes and decisions:** Future contracts follow expand/contract (document the missed one); restore staging writes upload intents; a restore applies the semantic backfills for its artifact's release (a producing-release marker).

**Gate:**

- `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`, and `npm run build && npm run test:integration` (a query, a lock, an entity or an RLS context changes)
- migration: `npm run migration:lint` (from `backend/`), `scripts/verify-schema.sh`, `node scripts/check-migration-prefixes.mjs`; `database/schema.sql` in the same commit
- docs: `node scripts/check-docs-manifests.mjs`; the `docs/system-invariants.md` entry the task corrects lands in the same PR

### T51 -- Leases outlast the provider calls they guard and fence their saves

**Priority:** P3. **Depends on:** --. **Deploy impact:** neutral. **PR size:** S.

**Closes:**

- A26-L13 (LOW) Job leases are shorter than the provider calls they guard and the saves are not fenced by the lease token (AI insights, email-receipt poll). Surfaces and session findings: A26-S08-04 (primary); A26-S11-01 (merged surface).

**Invariants and prior findings:** INV-CRON-001, INV-RECEIPT-006, MON-M25.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `backend/src/ai/insights/ai-insights.service.ts`, `backend/src/email-receipts/poll/email-receipt-poll.service.ts`, `backend/src/email-receipts/ai/email-receipt-ai.service.ts`.

**Regression tests it must land with:**

- A26-S08-04: R2.
- A26-S11-01: P2 (lease expired by its holder's token during the first provider call, a second `pollMailbox`), asserting one provider call for the draft and one draft row.
- Mutation families that must turn `covered` (`21-tests-ci-release.md` section 6.2): F1.

**Notes and decisions:** The lease-TTL pair: AI insights and the email-receipt poll; the parser-draft step gets its own claim.

**Gate:**

- `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`, and `npm run build && npm run test:integration` (a query, a lock, an entity or an RLS context changes)

### T52 -- MNY staged-file deletion and INV-IMPORT-003 on the MNY and QIF writers

**Priority:** P3. **Depends on:** T04. **Deploy impact:** neutral. **PR size:** S.

**Closes:**

- A26-L14 (LOW) A staged MNY file can still be deleted under a job that was just created (MON-L04 residual). Surfaces and session findings: A26-S09-04 (primary).
- A26-L15 (LOW) INV-IMPORT-003 is still unenforced on the MNY and QIF writers, and its index entry names one path of three. Surfaces and session findings: A26-S09-05 (primary).

**Invariants and prior findings:** MON-L04, INV-IMPORT-003.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `backend/src/import/mny/mny-staging.service.ts`, `backend/src/import/mny/writers/write-reference.ts`, `backend/src/import/import.service.ts`, `database/schema.sql`, `docs/system-invariants.md`.

**Regression tests it must land with:**

- A26-S09-04: a two-connection integration case: open a transaction that inserts a pending job for an expired staged file, run the sweep from a second connection, commit the first, assert the staged row survives.
- A26-S09-05: (verification method) `npm run test:integration -- mny-import`.

**Notes and decisions:** Lock the staged file against a just-created job; enforce INV-IMPORT-003 and correct its index entry.

**Gate:**

- `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`, and `npm run build && npm run test:integration` (a query, a lock, an entity or an RLS context changes)
- docs: `node scripts/check-docs-manifests.mjs`; the `docs/system-invariants.md` entry the task corrects lands in the same PR

### T53 -- Rule deletion, trade-email totals, FX inside the receipt transaction

**Priority:** P3. **Depends on:** T02. **Deploy impact:** live. **PR size:** S.

**Closes:**

- A26-L16 (LOW) Deleting a rule leaves its open AI review requests rule-less, and they block the email-receipt review of the same transaction. Surfaces and session findings: A26-S10-04 (primary).
- A26-L17 (LOW) A trade email that states only a price books a total derived from the price rounded to 4 decimals (INV-TRADE-001). Surfaces and session findings: A26-S11-02 (primary).
- A26-L18 (LOW) The trade card's preview can call the FX provider inside the pipeline's receipt transaction. Surfaces and session findings: A26-S11-03 (primary).

**Invariants and prior findings:** INV-TRADE-001, INV-FX-001.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `database/schema.sql`, `backend/src/transaction-rules/transaction-rules.service.ts`, `backend/src/ai-review/ai-review-requests.service.ts`, `backend/src/email-receipts/pipeline/receipt-candidates.ts`, `backend/src/email-receipts/parsing/parse-trade.ts`, `backend/src/email-receipts/parsing/receipt-parser.types.ts`, `backend/src/securities/investment-transactions.service.ts`.

**Regression tests it must land with:**

- A26-S10-04: integration: queue a rule review, delete the rule, enqueue a receipt review for the same transaction, expect a row.
- A26-S11-02: P1's three rows in `parse-trade.spec.ts`, asserting the totals 123 456 789 / 263 201 250 / 20 000 019 (1/10000 units).
- A26-S11-03: a pipeline integration case with a cross-currency trade profile and a provider stub that blocks, asserting that a concurrent `ignore` on the email is not blocked and that the provider was not called inside the pass.
- Suggested test files (field 13 diffs): `backend/src/email-receipts/parsing/parse-trade.spec.ts`.
- Mutation families that must turn `covered` (`21-tests-ci-release.md` section 6.2): F6, F7, F8.

**Notes and decisions:** Close a deleted rule's open reviews; a price-only trade keeps the stated price's precision (INV-TRADE-001); fetch FX outside the receipt transaction.

**Gate:**

- `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`, and `npm run build && npm run test:integration` (a query, a lock, an entity or an RLS context changes)

### T54 -- Securities LOWs: transfer edit lock order, price-window memory, undo fold, benchmark recompute

**Priority:** P3. **Depends on:** T10. **Deploy impact:** neutral. **PR size:** M.

**Closes:**

- A26-L19 (LOW) The security-transfer edit writes and validates before taking the holdings lock, from snapshots of both legs. Surfaces and session findings: A26-S12-07 (primary).
- A26-L20 (LOW) The price-window fill remembers a month as empty when one provider answered nothing and another failed. Surfaces and session findings: A26-S12-08 (primary).
- A26-L21 (LOW) The undo/redo holdings fold adds a dividend's total to the basis and stores the average at 6 decimals. Surfaces and session findings: A26-S12-10 (primary).
- A26-L22 (LOW) A benchmark observation stored outside the 06:25 run is not followed by a price recompute. Surfaces and session findings: A26-S14-03 (primary).

**Invariants and prior findings:** INV-HOLDING-001, INV-CACHE-001, INV-BOND-005.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `backend/src/securities/investment-transactions.service.ts`, `backend/src/securities/security-price.service.ts`, `backend/src/action-history/action-history.service.ts`, `backend/src/bonds/benchmark-refresh.service.ts`, `backend/src/bonds/bond-series.service.ts`, `backend/src/bonds/bond-price.service.ts`.

**Regression tests it must land with:**

- A26-S12-07: a two-connection SELL versus transfer edit with a barrier on the lock.
- A26-S12-08: a unit case with provider 1 returning an empty series and provider 2 throwing, asserting nothing is remembered.
- A26-S12-10: undo after a DIVIDEND with quantity, asserting the stored average equals `findLedgerDiscrepancies`'s replay (no discrepancy).
- A26-S14-03: a unit test of the refresh: a store that inserts a new observation triggers one recompute dispatch for the series reading that code, after the store resolved; an unchanged store triggers none.

**Notes and decisions:** One PR per file group if the reviewer prefers; each has its own regression case in its finding.

**Gate:**

- `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`, and `npm run build && npm run test:integration` (a query, a lock, an entity or an RLS context changes)

### T55 -- Loan LOWs: the one-minor-unit payoff, the Post dialog split preview

**Priority:** P3. **Depends on:** T12. **Deploy impact:** live. **PR size:** S.

**Closes:**

- A26-L23 (LOW) A loan owing exactly one minor unit is treated as paid off on both layers. Surfaces and session findings: A26-S15-06 (primary).
- A26-L26 (LOW) The Post dialog previews the stored template's principal/interest split while the post re-prices the bill from the ledger. Surfaces and session findings: A26-S15-09 (primary).

**Invariants and prior findings:** INV-LOAN-004, INV-LOAN-009.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `backend/src/loan-installments/price-installment.ts`, `frontend/src/lib/loan-schedule.ts`, `frontend/src/components/scheduled-transactions/PostTransactionDialog.tsx`.

**Regression tests it must land with:**

- A26-S15-06: R6 as an integration case asserting a 0.01 posting and a zero ledger; `loan-schedule.test.ts` 1,000 / 999.99 asserting two rows.
- A26-S15-09: (recommended correction) pre-fill a loan bill's lines from `loan-occurrences` (count 1) as the picker does; keep the server's echo re-pricing as the backstop.
- Mutation families that must turn `covered` (`21-tests-ci-release.md` section 6.2): F7.

**Notes and decisions:** Pin both sides of 0.01 (S21 family F7); the dialog previews the re-priced split through the same code as the post.

**Gate:**

- `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`, and `npm run build && npm run test:integration` (a query, a lock, an entity or an RLS context changes)
- `frontend/`: `npm run lint && npm run type-check && npm run i18n:check`, `npm run test:changed`, `npm run build`; grep `e2e/` for any renamed control's accessible name

### T56 -- Notification LOWs: chart token TTL, alert baseline order, month start

**Priority:** P3. **Depends on:** --. **Deploy impact:** neutral. **PR size:** S.

**Closes:**

- A26-L27 (LOW) A price push's chart token lives five minutes, the push it rides on four hours. Surfaces and session findings: A26-S17-04 (primary).
- A26-L28 (LOW) The portfolio-movement alert commits its new baseline before it writes the notification. Surfaces and session findings: A26-S17-06 (primary).
- A26-L29 (LOW) The insights aggregator computes the month start as a local-midnight date read back in UTC. Surfaces and session findings: A26-S17-07 (primary).

**Invariants and prior findings:** none indexed; see field 4 of each finding.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `backend/src/push/push-chart-artifact.service.ts`, `backend/src/push/web-push-sender.service.ts`, `frontend/public/sw.js`, `backend/src/notification-center/portfolio-movement-alert.service.ts`, `backend/src/ai/insights/insights-aggregator.service.ts`.

**Regression tests it must land with:**

- A26-S17-04: a unit spec asserting `CHART_TOKEN_TTL_MS >= PUSH_TTL_SECONDS * 1000` (a source-level pin of the relation, the `CONFIRM_TIMEOUT_MS` pattern in `mcp-confirm.spec.ts`).
- A26-S17-06: ```diff +it("keeps the baseline when the alert could not be written", async () => { + dispatch.notify.mockRejectedValueOnce(new Error("connection reset")); + await expect(service.evaluateUser(USER)).rejects.toThrow(); + expect(storeBaselineSpy).not.toHaveBeenCalled(); +}); ```
- A26-S17-07: a spec run under a fixed non-UTC zone (`process.env.TZ` set before the module loads, or the jest config's per-file environment) asserting `currentMonthStart` is the first of the month.

**Notes and decisions:** Token lives as long as the push; write the notification before the new baseline; month start in UTC.

**Gate:**

- `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`, and `npm run build && npm run test:integration` (a query, a lock, an entity or an RLS context changes)

### T57 -- Frontend LOWs: locale and catalog, forecast floats, response types, 0 % loans

**Priority:** P3. **Depends on:** --. **Deploy impact:** live. **PR size:** M.

**Closes:**

- A26-L30 (LOW) Figures and labels bypass the reader's number locale and the message catalog (lib formatters, form readouts, figure surfaces). Surfaces and session findings: A26-S18-09 (primary); A26-S19-07 (merged surface); A26-S20-07 (merged surface).
- A26-L31 (LOW) The client forecast accumulates floats and rounds the projected balance with `Math.round(x * 100) / 100`. Surfaces and session findings: A26-S18-10 (primary).
- A26-L32 (LOW) Frontend response types drop signals the backend sends (contract drift). Surfaces and session findings: A26-S18-11 (primary).
- A26-L33 (LOW) A loan stored at 0 % interest opens with an empty rate and every edit is refused. Surfaces and session findings: A26-S19-06 (primary).

**Invariants and prior findings:** INV-DISPLAY-001.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `frontend/src/lib/format.ts`, `frontend/src/lib/pdf-export.ts`, `frontend/src/components/investments/InvestmentTransactionForm.tsx`, `frontend/src/components/accounts/LoanPaymentSetupDialog.tsx`, `frontend/src/test/number-locale.guard.test.ts`, `frontend/src/components/reports/SavingsRateReport.tsx`, `frontend/src/lib/forecast.ts`, `frontend/src/types/transaction-rule-explain.ts`, `backend/src/transaction-rules/rule-effects.ts`, `backend/src/import/dto/import.dto.ts`, `frontend/src/components/accounts/AccountForm.tsx`.

**Regression tests it must land with:**

- A26-S18-09: a `ui-conventions.test.ts` rule banning imports of `formatRelativeTime` from components, and a `pdf-export` case that passes a locale.
- A26-S19-07: a guard case matching `.toFixed(` inside JSX braces or a `t(` argument object under `src/components/`.
- A26-S20-07: (recommended correction) see the finding in the final report
- A26-S18-10: `forecast.test.ts` with a 1.0050 starting balance asserting 1.01. 14. **Verification:** `npm run test -- forecast`. 15. **Residual risks:** none. Causality: `PRE_EXISTING_UNREPORTED`.
- A26-S18-11: a contract test (the `budget-trend.contract.test.ts` pattern) holding `ExplainedRuleSkip` equal to the backend union.
- A26-S19-06: a LOAN with `interestRate: 0` renames and saves; the payload carries `interestRate: 0`.

**Notes and decisions:** `useNumberFormat` and the catalog on every surface S18, S19, S20 list, with a guard; integer-minor-unit forecast; types carry the backend's signals; 0 % opens as 0.

**Gate:**

- `frontend/`: `npm run lint && npm run type-check && npm run i18n:check`, `npm run test:changed`, `npm run build`; grep `e2e/` for any renamed control's accessible name

### T58 -- Release-gate LOWs: E2E flakes, zero-test runners, DTO coverage

**Priority:** P3. **Depends on:** T46. **Deploy impact:** none. **PR size:** S.

**Closes:**

- A26-L35 (LOW) The E2E release gate passes a test that failed twice out of three, never runs one of its tests, and swaps a shard for the cluster run. Surfaces and session findings: A26-S21-05 (primary).
- A26-L36 (LOW) `push:client:test` passes with zero discovered tests (MON-L07 residual). Surfaces and session findings: A26-S21-06 (primary).
- A26-L37 (LOW) Coverage excludes every DTO; two cross-field or privacy constraints there are held by no test. Surfaces and session findings: A26-S21-07 (primary).

**Invariants and prior findings:** none indexed; see field 4 of each finding.

**Files (from the findings' locations and suggested diffs; re-locate by symbol):** `e2e/playwright.config.ts`, `e2e/tests/backup.spec.ts`, `e2e/tsconfig.json`, `backend/package.json`, `docs/release-integrity.md`, `backend/src/common/jest-config.guard.spec.ts`, `backend/src/emergency-access/dto/upsert-settings.dto.ts`, `backend/src/backup/support-backup/dto/create-support-backup.dto.ts`.

**Regression tests it must land with:**

- A26-S21-05: a guard asserting `failOnFlakyTests` is set when `CI` is, beside `ci-images.guard.spec.ts`.
- A26-S21-06: the guard case above (`expect(script).not.toMatch(/node --test[^&|]*\*/)` over every `package.json` script and workflow `run:`).
- A26-S21-07: ```ts // backend/src/emergency-access/dto/upsert-settings.dto.spec.ts import { plainToInstance } from "class-transformer"; import { validateSync } from "class-validator"; import { UpsertSettingsDto } from "./upsert-settings.dto"; it("refuses a reminder that does not come before the grant", () => { const dto = plainToInstance(UpsertSettingsDto, { enabled: true, grantAfterDays: 7, reminderAfterDays: 7 }); ...

**Notes and decisions:** `failOnFlakyTests` (or retries 0) in the release gate; every runner fails on zero tests (`node --test` glob guard); measure DTO coverage or test the two DTO constraints. `.github/`: Ask first.

**Gate:**

- `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`, and `npm run build && npm run test:integration` (a query, a lock, an entity or an RLS context changes)
- CI/deployment: the workflow or Compose change exercised on a branch run; `node scripts/check-docs-manifests.mjs` and `node scripts/check-env-docs.mjs`

