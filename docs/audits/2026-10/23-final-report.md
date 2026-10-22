# Monize Full Read-Only Audit 2026-10 - Final Maintainer Report

**Repository:** `WMP/monize` (fork of `kenlasko/monize`)
**Audited baseline:** `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86` (`AUDIT_BASELINE_SHA`, `chore: bump version to 1.19.0 [skip ci]`, 2026-10-21)
**`main` at closure:** `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86` (re-fetched by S23 on 2026-10-22; equal to the baseline, no second delta review needed)
**Audit mode:** read-only, fixed revision, executed: every HIGH candidate was run against the baseline (suite, mutation, probe or failpoint) or says why not
**Sessions consumed:** S01-S22 (22 reports, `01-baseline.md` .. `22-delta-review.md`), the ledger, the prior-findings register
**Companion:** [`remediation-tasks.md`](./remediation-tasks.md) (one task per PR, dependency-ordered)
**Report status:** in-progress, remaining: remediation-tasks.md

Reading guide. Sections 1 to 6 and 17 to 24 are the maintainer's summary. Section 7 carries every
session finding in the protocol's 15-field format, verbatim from its session report under the
canonical heading that absorbs it (a superseded finding is a pointer to the report, because its
scenario is a surface of the primary's text). Headings inside section 7 are demoted one level;
everything else in a session block is the session's own text. Where a suggested diff is longer
than a page it is replaced by a pointer to the session report's field. The report is large by
design (plan section 9: "do not shorten the reproduction"); the index in section 6 is the entry point.

## 1. Executive summary

This program audited Monize at one pinned revision in 22 working sessions plus this
consolidation, under the protocol of `.claude/commands/audit.md` adapted to a baseline (plan
section 3). Unlike the upstream audit of 2026-08, which could not run anything, every session had
Node 24, PostgreSQL 16 and Docker: the baseline suites ran green in S01 (backend unit 27 481 tests,
integration 1 479 with one deadlock-induced failure later root-caused by S21, frontend 22 249,
E2E 191 with 6 retried flakes), and every HIGH finding below carries execution evidence from a
scratch worktree (section 18).

The codebase has strong, real controls, and many of the upstream findings are closed by them:
47 of the 70 upstream findings are `FIXED_VERIFIED` at this baseline (section 19), including the
two MNY-import starts race, the emergency-claim double consume, the split-additive stock-split
replay, the restore byte verification and the absolute balance recompute. `withScopedDb`, the
unprivileged-role RLS suites, the claim and lease tables, the occurrence claims, `FxAggregate`,
the completeness flags and the guard tests hold where they are used.

The program's 143 session findings consolidate, by root cause (Rule 7), into **96 canonical
findings: 0 BLOCKER, 15 HIGH, 42 MEDIUM, 39 LOW**. The HIGH findings fall into five groups:

1. **Two security boundaries open now.** Refresh-token reuse is detected but the family
   revocation is rolled back by the exception that reports it, so the thief keeps rotating
   (A26-H01); and an email body that pastes a "Forwarded message" block is read as the broker's
   and, with auto-apply, books the trade it states (A26-H02).
2. **Balance-moving writes outside the lock that guards them.** Transfer leg edits (A26-H03),
   investment edits (A26-H04), the account-edit undo (A26-H06) and the manual post of a scheduled
   occurrence (A26-H07) derive a delta or a whole row from a snapshot read before the write
   transaction, or from no occurrence identity at all; duplicates and stored-versus-ledger
   divergence follow, executed in each case.
3. **Writers that create or duplicate money deterministically.** Bulk delete of one split-transfer
   leg (A26-H05), a failure after the MNY data commit reported as "Nothing was saved" (A26-H08),
   a repeated bank `entry_reference` (A26-H09), and two transfer-form defects (A26-H13, A26-H14).
4. **Currency arithmetic.** A missing rate is still 1:1 in the built-in reports (A26-H10, the
   upstream MON-H12 on its last surface); the latest-rate readers use a frozen pre-1.17 mirror
   row and a rate of any age (A26-H11); budget actuals, the custom report engine and the AI/MCP
   analytics sum currencies without conversion (A26-H12).
5. **Partial figures shown as totals** on the net-worth, accounts, portfolio and export surfaces,
   and dropped by the server before the AI/MCP tools see them (A26-H15, the upstream MON-H16).

None of the HIGH findings is a regression of an upstream fix; three are in code written after the
upstream audit (A26-H02, A26-H09 and the loan surface of A26-H06), five are upstream findings still
open on a residual path, and seven were missed upstream. The MEDIUM register is dominated by the
same two shapes on narrower surfaces (check in one transaction and write in another; a figure
computed without its completeness or its currency), plus the release path: the published image
is never booted by a gate and is pushed before the CVE gate, and the audited revision itself has
no hosted CI run (section 2).

**Program verdict: REQUEST CHANGES.** Fifteen HIGH findings survived the adversarial challenge of
their sessions and this consolidation. The remediation plan (section 21) and the task list put the
two security fixes and the money-creating writers first (P0), then the snapshot and currency
roots (P1), then the MEDIUM register (P2) and the LOW and documentation items (P3). Every fix lands
with the red test its finding names; A26-M42's harness half (a two-connection helper, the real scheduled module, schema parity)
is the first P1 task because most P1 regression tests need it.

### Final count

| Severity | Canonical findings | Session findings absorbed |
| --- | --- | --- |
| BLOCKER | 0 | 0 |
| HIGH | 15 | 29 (18 rated HIGH by their session, 11 rated MEDIUM; section 6.2) |
| MEDIUM | 42 | 71 (55 MEDIUM, 16 LOW) |
| LOW | 39 | 43 (43 LOW) |
| Total | 96 | 143 |

### Separate consolidated registers

| Register | Where | Counting rule |
| --- | --- | --- |
| Design risks and open hypotheses | section 15 | Rule 1 outcomes, not counted in the 96 |
| Missing and known-wrong tests | section 13, appendix B | A26-M42 and A26-M08 are the canonical missing-test findings; 10 known-wrong tests |
| Documentation inconsistencies | section 14 | per-session register; the instruction-file roots are A26-L03, A26-L04, A26-L15 |
| Rejected hypotheses | appendix A | every session's Rule 8 table, plus S23's merges and downgrades |
| Deduplication and supersession | section 17 | every one of the 143 session findings exactly once |

## 2. Audited SHA

| Fact | Value |
| --- | --- |
| `AUDIT_BASELINE_SHA` | `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86` |
| `MAIN_SHA` at S22 | `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86` (empty delta; S22 re-ran 8 focused checks, green) |
| `MAIN_SHA` at S23 | `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86` (`git fetch origin main && git rev-parse origin/main`, 2026-10-22); unchanged, so no second delta review is handed to the orchestrator |
| Audit branch | `ccr-1f689e5c-onia07`; its code equals the baseline, only `docs/audits/2026-10/` grows (plan section 4 step 2, checked by every session) |
| Upstream audit | `kenlasko/monize` at `d5cea9bfa995885ba5198f9843359362927c0fd4` (2026-08-01), 70 canonical findings, copied to `docs/audits/2026-08-upstream/` |

**No hosted CI run exists for the audited revision** (S22, section 12.5 of `22-delta-review.md`).
The baseline commit and the two commits below it carry `[skip ci]`; the newest hosted `ci.yml`
push run on `main` of `WMP/monize` is from 2026-10-16, on a commit not present in the fetched
history. The program's test evidence for this revision is local: S01's full run of every layer
and the sessions' focused runs (section 20). This is the concrete instance of A26-M41 (the
release job pushes an untested `[skip ci]` bump, MON-M45) and of INV-RELEASE-001's `partial`
status.

## 3. Method and limitations

### Method

1. S00 pinned the revision and wrote `plan.md`, `sessions.md` and `prior-findings-register.md`;
   every session pinned to the audit branch and checked that its code equals the baseline.
2. Each session ran `/audit` on its slice: instructions first, the invariant map, every
   mandatory lens (section 3 of each report), the mutation table, counterexamples, the
   rejected-hypothesis table, suggested remediation and regression-test diffs, and the
   adversarial approval challenge, then disposed of the upstream findings it owned.
3. Every HIGH candidate was executed (plan section 1): a two-connection probe with a barrier, a
   failpoint after a commit, a mutation in a scratch worktree, a component probe, or a real
   PostgreSQL integration case under the enforced RLS harness. Section 18 lists the evidence.
4. S21 merged every session's undetected mutation rows into one program table (59 rows, eleven
   families, `21-tests-ci-release.md` section 6.2) and the known-wrong tests (its section 10.1).
5. S22 reviewed the delta to `main` (empty) and re-ran eight checks.
6. S23 (this report) consolidated the 143 session findings by root cause (Rule 7), re-assessed
   every severity against the protocol's calibration, recorded where two sessions disagree and
   which reading it takes (section 17.2), and wrote the remediation plan and task list. S23 did
   not re-audit code and ran no suite; it ran `node scripts/check-docs-manifests.mjs` before each
   commit.

### Limitations

- **Parallel waves instead of a serial program.** S01-S03 ran concurrently as three child
  sessions (the S02/S03 dependency on S01 waived), and later sessions ran in parallel waves under
  an orchestrator; hand-offs between sessions went through the ledger, and a session that
  finished before its hand-off arrived could not act on it (the late hand-offs are disposed of in
  this report, section 17.2).
- **Usage-limit interruption.** On 2026-10-21 at 21:00 UTC the usage window was exhausted while
  S13, S14 and S16 were running; all three were resumed at 23:12 UTC (S13 from its pushed
  partial report, S14 and S16 from their session context). S16's sweep subagents were lost to the
  limit, so its categories, payees, tags and calendar coverage is through their integration suites
  only.
- **Sampled XL slices.** MNY import (S09), securities (S12), frontend reports (S20) and frontend
  lib (S18) were sampled by invariant with recorded ranges, never read end to end. S19 sampled
  the five largest forms and did not run Playwright. S20 covered budgets, strategies, bonds,
  receipts and tours UI by grep only.
- **Not audited this program.** INV-SHARE-001..005 (the PWA share target) were audited by
  neither S18 nor S20 (`sessions.md` mislabelled them as joint accounts until S04 corrected it);
  INV-PAYEE-001/002 and INV-DAYNOTE-001 mechanisms were not re-read (S16); the bank-sync preview
  UI and the rules editor were not read (S10/S20 hand-off). These are reported as not audited,
  never as clean.
- **Shallow clone.** The clone starts at 2026-10-11 (276 commits); the upstream baseline
  `d5cea9bf` is unreachable, so causality between `PRE_EXISTING_UNREPORTED` and
  `NEW_SINCE_UPSTREAM_AUDIT` could not be dated for code at the clone boundary. Each finding
  says so where it applies.
- **Environment.** The container's default Node 22.22.0 cannot `npm ci` either layer (engines in
  the lock files); every session switched to Node 24 as CI does. S03 had to start `dockerd` by
  hand. E2E ran Chromium only, with images built in a scratch worktree carrying the proxy CA.
- **What could not be observed.** Branch protection and required checks (no admin API access,
  DR-S21-5); production database roles and volumes; real provider behaviour beyond recorded
  fixtures; a real S3 service (S06 used an S3-compatible emulator that ignores checksums).

## 4. Repository instruction hierarchy

| Precedence | Source | Applied scope and notes |
| --- | --- | --- |
| 1 | Program instructions: `plan.md`, `sessions.md`, `.claude/commands/audit.md` | Fixed revision, read-only, finding standard, severity calibration, Rules 1-3, 7, 8 |
| 2 | `AGENTS.md` (imported by the root `CLAUDE.md`) | Canonical repo-wide rules: `withScopedDb`, transactions, financial math, i18n, guard tests, "Ask first" |
| 3 | Root `CLAUDE.md` | Claude Code specifics only (LSP, safe local actions, scope, verification) |
| 4 | `backend/CLAUDE.md`, `frontend/CLAUDE.md`, `database/CLAUDE.md`, `e2e/CLAUDE.md` | Layer indexes over `docs/backend/` and `docs/frontend/` |
| 5 | `docs/system-invariants.md` and the contract documents | 145 invariants at the baseline (126 `enforced`, 19 `partial`, 1 `unenforced`); the program tested the mechanism each entry names, not its status word |
| 6 | `docs/specs/*.md`, `docs/adr/` | Feature contracts; a deliberate exception in a spec beats structural similarity (Rule 2) |
| 7 | `.claude/settings.json`, `README.md`, `CONTRIBUTING.md` | Auxiliary; where they contradict 2-4 the contradiction is a finding (A26-L03, A26-L04) |

Contradictions recorded rather than reconciled: the layer files order a local coverage run that
`AGENTS.md` assigns to CI (A26-L03); `.claude/settings.json` pre-approves `npm install*`, an
"Ask first" action (A26-L04); `docs/backend/database-access-and-tenancy.md` prescribes the
"authorize under the caller, then open the bypass" two-transaction shape behind A26-M04 and
A26-M05 while the same document requires rejection inside the writing transaction (D-S04-05).

## 5. Architecture overview

| Area | Observed architecture at the baseline | Sessions |
| --- | --- | --- |
| Layers | `backend/` NestJS + TypeORM (411k non-test lines, 1 429 files), `frontend/` Next.js App Router + Zustand (279k, 1 264 files), `database/` (`schema.sql` + 233 migrations, PostgreSQL 16), `e2e/` Playwright (40 specs) | S01 |
| Database door | `withScopedDb` is the only RLS-compliant entry; identity is seeded by the request interceptor or by `withUserContext` / `withSystemContext` / `withDelegateContext`, each new call site on `WITH_CONTEXT_ALLOWLIST`; nested calls join the ambient transaction | S01, S04 |
| RLS and tenancy | Policies keyed on the current and real user GUCs, a system bypass, joint accounts and cross-owner transfers written under the bypass after an authorization read | S04 |
| Auth | JWT access tokens, refresh-token families with rotation and reuse detection, local and OIDC login, TOTP, purpose-bound step-up tokens, PATs and the MCP bearer, delegations and emergency access | S03 |
| Cash ledger | Signed transactions are the source; `accounts.current_balance` is derived and moved by atomic SQL deltas; transfers are paired legs, splits can carry transfer legs, VOID decides inclusion per row, a reconciled lock refuses edits | S07 |
| Scheduler | 49 cron handlers in 46 services (S01's count; the plan said 40), replica safety by job claims with leases, occurrence claims for scheduled posts and loan installments | S08 |
| Imports and sync | MNY import with staged files and a job state machine; QIF/OFX/CSV; bank sync (new since August) with a dedup ledger; transaction rules with structural actions; email receipts and trade parsing (new) | S09, S10, S11 |
| Investments | Investment transactions with cash legs, a materialized holdings fold, provider prices, FX through `resolveFxRate`, Polish and sovereign bonds priced by an engine (new), loan scenarios and GEM strategies (new) | S12, S13, S14, S15 |
| Reporting | Built-in report services, a custom report engine, budgets with periods, rollover and alerts, net-worth series with completeness flags | S13, S16 |
| AI, MCP, notifications | An assistant with confirmation cards and single-use claims, an MCP server with scoped bearer tokens, push (new), a notification centre, system and provider alerts | S17 |
| Frontend | API modules over a hand-rolled cache with generations and invalidation lists, forms per entity, figure surfaces reading the server's completeness flags | S18, S19, S20 |
| Backup and restore | JSON export and restore with id remapping, automatic local/S3 artifacts sharded by owner, attachment bytes through upload intents | S06 |
| Tests, CI and release | Jest and Vitest unit suites with coverage gates, 118 real-PostgreSQL integration suites, Playwright E2E on a development image, a release workflow that publishes signed images and pushes a `[skip ci]` bump | S21 |

## 6. Final finding-count summary

| Severity | Canonical | Interpretation |
| --- | --- | --- |
| BLOCKER | 0 | No deployment-stopping or broadly destructive root survived. |
| HIGH | 15 | Security boundaries open now, money created or duplicated, broad wrong financial figures. |
| MEDIUM | 42 | The same shapes on narrower surfaces; workflow failures; release-path gaps; the missing-test roots. |
| LOW | 39 | Narrow defects, guard and documentation gaps with a concrete future failure. |
| Total | 96 | Unique register after Rule 7 consolidation of 143 session findings. |

### 6.1 Classification (Rule 3, by each canonical finding's primary)

| Severity | `PRE_EXISTING_UNREPORTED` | `PRIOR_REPORTED` | `NEW_SINCE_UPSTREAM_AUDIT` | `REGRESSION_OF_PRIOR_FIX` |
| --- | --- | --- | --- | --- |
| HIGH | 7 | 5 | 3 | 0 |
| MEDIUM | 25 | 9 | 8 | 0 |
| LOW | 21 | 3 | 15 | 0 |
| Total | 53 | 17 | 26 | 0 |

A merged surface keeps its own class in its session block (for example A26-H06's loan surface is
`NEW_SINCE_UPSTREAM_AUDIT` while its primary is `PRE_EXISTING_UNREPORTED`).

### 6.2 Severity changes made by S23

| Session finding | Session severity | Canonical | Canonical severity | Why |
| --- | --- | --- | --- | --- |
| A26-S02-03 | MEDIUM | A26-H15 | HIGH | S20 raised it on execution (A26-S20-01); S23 agrees: AGENTS.md classes "a subtotal is not a total" as CRITICAL, four surfaces executed, the upstream root MON-H16 was HIGH. |
| A26-S12-02, A26-S19-04, A26-S18-04 | MEDIUM | A26-H11 | HIGH | Same invariant (INV-FX-001) and the same missing `resolveFxRate` call as A26-S13-02 (HIGH, executed 30 % wrong total). |
| A26-S16-06, A26-S17-01 | MEDIUM | A26-H12 | HIGH | "Convert before summing"; one root with A26-S16-01 (executed budget at 2 040 %). |
| A26-S13-04, A26-S16-04 | MEDIUM | A26-H15 | HIGH | Producer and export surfaces of the completeness-flag invariant. |
| A26-S18-05 | MEDIUM | A26-H08 | HIGH | The client copy of the false "Nothing was saved" whose server half is HIGH. |
| A26-S02-04, A26-S02-05 | MEDIUM | A26-H07, A26-H08 | HIGH | Superseded by the owning session's executed HIGH (S08 raised A26-S02-04 on execution; S09 executed the duplicate import). |
| A26-S18-08 | LOW | A26-M36 | MEDIUM | Same defect as A26-S20-04; S20's delegate-context surface decides the rating. |
| A26-S10-05, A26-S15-05, A26-S14-02, A26-S13-06, A26-S06-05, A26-S18-07, A26-S19-05, A26-S20-05, A26-S20-08, A26-S02-12, A26-S06-06, A26-S17-05, A26-S07-09, A26-S08-05, A26-S16-09 | LOW | the MEDIUM canonical named in section 17 | MEDIUM | Merged as surfaces of a MEDIUM root (Rule 7); their own impact is unchanged. |
| A26-S21-01, -02, -03, A26-S02-10 | MEDIUM | A26-M40, A26-M41 | MEDIUM (kept) | Release integrity: the impact needs a boot failure or a CRITICAL CVE at release time, and the Compose failure is reported by `describeStore`; S21's rating stands. |
| A26-S08-02, A26-S17-02 | MEDIUM | A26-M14 | MEDIUM (kept) | Needs a post-commit failure; each duplicate is one visible row. Not merged into A26-H08 (whole-file duplicate) although the class is the same; one remediation pattern covers both (tasks T13 and T04). |

No canonical finding was lowered below its primary's session severity.

### 6.3 Canonical index


| ID | Severity | Title | Session findings (relation) |
| --- | --- | --- | --- |
| A26-H01 | HIGH | Refresh-token reuse detection does not revoke the family: the revocation is rolled back by the exception that reports it | A26-S03-01 (primary) |
| A26-H02 | HIGH | Any sender can make an email read as the broker's by pasting a forwarded-message header block; with auto-apply the trade it states is booked | A26-S11-04 (primary) |
| A26-H03 | HIGH | Transfer edit paths derive both balance deltas from pre-transaction snapshots (split-transfer leg, connected cross-owner transfer) | A26-S07-01 (primary); A26-S02-01 (superseded) |
| A26-H04 | HIGH | Editing an investment transaction twice at once, or while it is deleted, duplicates or orphans its cash leg | A26-S12-01 (primary) |
| A26-H05 | HIGH | Bulk-deleting one leg of a split transfer deletes the parent but leaves the other legs, creating their money | A26-S13-03 (primary) |
| A26-H06 | HIGH | Undo or redo of an account edit restores a whole-entity snapshot: the edit-time balance is written back absolutely and a loan's coupled template is left unrepriced or unlinked | A26-S07-02 (primary); A26-S15-01 (merged surface) |
| A26-H07 | HIGH | Manual post and skip of a scheduled transaction are not pinned to the occurrence the user saw; a stale view pays a bill twice or consumes the next occurrence | A26-S08-01 (primary); A26-S02-04 (superseded) |
| A26-H08 | HIGH | A failure after the MNY import's data commit is reported as "Nothing was saved", and the same file can then be imported again | A26-S09-01 (primary); A26-S02-05 (superseded); A26-S18-05 (merged surface) |
| A26-H09 | HIGH | A bank transaction whose entry reference the bank repeats on a later day is imported twice, or a later one is silently dropped (INV-BANKSYNC-001) | A26-S10-01 (primary) |
| A26-H10 | HIGH | Built-in reports convert a missing exchange rate 1:1 and label the result in the reporting currency (MON-H12, MON-M39) | A26-S13-01 (primary); A26-S02-02 (superseded) |
| A26-H11 | HIGH | A rate for a date is not the resolver's: the latest-rate readers use a frozen pre-1.17 mirror row and a rate of any age, and back-dated trades settle or prefill at the newest rate (INV-FX-001, INV-FX-003) | A26-S13-02 (primary); A26-S12-02 (merged surface); A26-S19-04 (merged surface); A26-S18-04 (merged surface) |
| A26-H12 | HIGH | Totals sum amounts of different currencies without conversion: budget actuals, the custom report engine and the AI/MCP transaction analytics | A26-S16-01 (primary); A26-S16-06 (merged surface); A26-S17-01 (merged surface) |
| A26-H13 | HIGH | A cross-currency transfer opened from its receiving leg loads the received amount into the source-amount field, and an unedited save re-prices the transfer (MON-H11 client half) | A26-S19-01 (primary) |
| A26-H14 | HIGH | Switching an existing income, expense or split to Transfer mode creates a second, new transfer and leaves the original row in place | A26-S19-02 (primary) |
| A26-H15 | HIGH | Completeness flags are not carried or read where totals are shown: net worth, accounts, portfolio widget and history, the AI/MCP account tools, report exports and Cash Flow | A26-S20-01 (primary); A26-S02-03 (superseded); A26-S13-04 (merged surface); A26-S16-04 (merged surface) |
| A26-M01 | MEDIUM | A successful password login writes the pre-bcrypt snapshot back and restores the failed-login counter it just reset | A26-S03-02 (primary) |
| A26-M02 | MEDIUM | Change-password, admin reset/disable and owner-of-delegate reset end refresh sessions with one blanket UPDATE that misses a concurrently inserted successor | A26-S03-07 (primary) |
| A26-M03 | MEDIUM | Two tabs refreshing at once read as token theft: the family is revoked and every session ends with no explanation | A26-S18-06 (primary) |
| A26-M04 | MEDIUM | Grantee and cross-owner writes are authorized in earlier transactions and written under the system bypass without a re-check | A26-S04-01 (primary) |
| A26-M05 | MEDIUM | Delegation management reads in one transaction and writes back the stale entity in another: a revoked delegation is re-instated | A26-S04-02 (primary) |
| A26-M06 | MEDIUM | The `account_delegates` and `account_delegate_grants` policies let a delegate-side session issue itself a delegation from any owner | A26-S04-03 (primary) |
| A26-M07 | MEDIUM | Automatic-backup retention deletes legacy flat-root artifacts of other owners (MON-H01 residual, MON-M43) | A26-S06-01 (primary); A26-S02-06 (superseded) |
| A26-M08 | MEDIUM | The S3 half of INV-BACKUP-006 rests on a suite that never runs in CI and fails when it does; no local/S3 attachment round trip exists (MON-M47) | A26-S06-02 (primary); A26-S06-05 (merged surface) |
| A26-M09 | MEDIUM | VOID crossings are decided from a status read before the row lock (bulk VOID expansion and `addSplit`; MON-H10 residual) | A26-S07-03 (primary); A26-S02-07 (superseded) |
| A26-M10 | MEDIUM | `PATCH /transactions/:id` changes the amount, rate or account of one transfer leg only (MON-H11 server residual) | A26-S07-04 (primary) |
| A26-M11 | MEDIUM | The strict reconciled lock is skipped on split-transfer leg and cross-owner transfer edits and deletes | A26-S07-05 (primary); A26-S02-08 (superseded) |
| A26-M12 | MEDIUM | An account closes over a pending future-dated row, which the due-balance cron later applies to the closed account (MON-M20 residual) | A26-S07-06 (primary) |
| A26-M13 | MEDIUM | A whole-entity save or an absolute write puts a snapshot's `current_balance` back: investment-pair rename or re-currency, QIF/CSV opening balance | A26-S07-07 (primary); A26-S10-05 (merged surface) |
| A26-M14 | MEDIUM | An error after a single-use write commits is reported as a failure, so the offered retry writes again (scheduled post and its cron alert, AI action confirm) | A26-S08-02 (primary); A26-S17-02 (merged surface) |
| A26-M15 | MEDIUM | `post()` advances the cursor past its own slot only, so a slot a settlement rule claimed ahead of the cursor becomes `next_due_date` and the schedule stalls | A26-S08-03 (primary) |
| A26-M16 | MEDIUM | A cross-currency transfer into an investment sleeve credits the bank account's amount under the sleeve's currency (MNY import) | A26-S09-03 (primary) |
| A26-M17 | MEDIUM | User actions create or leave global, active currencies offered to every user (MNY import, preferences, deleted users' custom currencies) | A26-S09-06 (primary); A26-S13-06 (merged surface) |
| A26-M18 | MEDIUM | A QIF split-transfer leg into another account is written in the source account's currency and amount (MON-H11 QIF half) | A26-S10-02 (primary); A26-S02-09 (superseded) |
| A26-M19 | MEDIUM | Deleting an account checks "no transactions" in one transaction and deletes in another: a concurrent sync or import is cascaded away | A26-S10-03 (primary) |
| A26-M20 | MEDIUM | An AI or MCP edit that names no rate replaces the row's own exchange rate with a freshly resolved market rate (INV-FX-002) | A26-S12-03 (primary) |
| A26-M21 | MEDIUM | Realized gains and capital-gains replays price a transferred-in lot at the carried per-share figure and rate 1 (MON-M35 residual) | A26-S12-04 (primary) |
| A26-M22 | MEDIUM | A security transfer's basis is the leg's stored price (today's average on create, the client's figure on edit); the form shows an editable cost the server replaces | A26-S12-05 (primary); A26-S19-05 (merged surface) |
| A26-M23 | MEDIUM | The holdings fold snaps every intermediate position under 0.0001 shares to zero | A26-S12-06 (primary) |
| A26-M24 | MEDIUM | A Money-imported trade of a security quoted in another currency stores its price and total in the account's currency, read as the security's | A26-S12-09 (primary) |
| A26-M25 | MEDIUM | Choosing a default currency that is not yet in the table fails on the foreign key: onboarding on a fresh instance accepts only USD | A26-S13-05 (primary) |
| A26-M26 | MEDIUM | On a day the bond engine refuses to price, the blend readers still value the holding; current per-account surfaces use the blended price (INV-BOND-010) | A26-S14-01 (primary); A26-S14-02 (merged surface) |
| A26-M27 | MEDIUM | GEM momentum prices one role from a close up to 14 days before the boundary while its series holds a later close | A26-S15-02 (primary) |
| A26-M28 | MEDIUM | The loan payment history counts VOID payments, VOID interest expenses and future-dated payments as paid | A26-S15-03 (primary) |
| A26-M29 | MEDIUM | An installment below the period's interest is booked as settling the period; the unpaid interest is recorded nowhere | A26-S15-04 (primary) |
| A26-M30 | MEDIUM | Loan payment setup accepts a source account in another currency; every posting of the bill is then refused | A26-S15-10 (primary) |
| A26-M31 | MEDIUM | The account exclusions chosen in the budget wizard are stored and never applied | A26-S16-02 (primary) |
| A26-M32 | MEDIUM | Closing a budget period never writes a rollover: `closePeriod` does not load the relation `computeRollover` reads | A26-S16-03 (primary) |
| A26-M33 | MEDIUM | A category's cost is not its signed sum: the custom report engine sums absolute values, the loan summary adds an interest refund to "Interest Paid" | A26-S16-05 (primary); A26-S15-05 (merged surface) |
| A26-M34 | MEDIUM | The AI and MCP `spending_anomalies` report passes the requested number of months as the z-score threshold | A26-S17-03 (primary) |
| A26-M35 | MEDIUM | Client caches outlive the data they derive from: recategorising writes, non-ledger valuation inputs and MNY imports invalidate nothing, and hand-rolled reads are not generation-aware (INV-CACHE-001 client half) | A26-S18-01 (primary); A26-S18-02 (merged surface); A26-S18-03 (merged surface); A26-S18-07 (merged surface) |
| A26-M36 | MEDIUM | The intraday portfolio series is cached in sessionStorage with no user or acting-context key and survives sign-out and context switches | A26-S20-04 (primary); A26-S18-08 (merged surface) |
| A26-M37 | MEDIUM | Four-decimal amounts are loaded and blurred at two decimals, so an unedited save re-amounts a row or is refused (MON-M37) | A26-S19-03 (primary) |
| A26-M38 | MEDIUM | Portfolio gain is the priced market value less the cost of every holding, so an unpriced holding reads as a loss of its whole cost | A26-S20-02 (primary) |
| A26-M39 | MEDIUM | A failed or pending request is shown as data: reports keep the previous window through a failed reload, the country view and the dashboard render a failure as empty or zero | A26-S20-03 (primary); A26-S20-05 (merged surface); A26-S20-08 (merged surface) |
| A26-M40 | MEDIUM | The production image is never exercised: no CI gate boots the published target, and both documented Compose deployments mount backup and attachment directories the backend user cannot write | A26-S21-01 (primary); A26-S21-03 (merged surface) |
| A26-M41 | MEDIUM | Release publication precedes the gates: images reach `:latest` before the CVE gate, and the release job pushes an untested `[skip ci]` bump with an admin token (MON-M45) | A26-S21-02 (primary); A26-S02-10 (merged surface) |
| A26-M42 | MEDIUM | The concurrency, post-commit and database-boundary invariants behind the program's HIGH and MEDIUM findings have no test at the production boundary (MON-M46) | A26-S21-04 (primary); A26-S03-04 (merged surface); A26-S04-04 (merged surface); A26-S05-01 (merged surface); A26-S07-09 (merged surface); A26-S08-05 (merged surface); A26-S16-09 (merged surface); A26-S17-05 (merged surface); A26-S02-12 (merged surface); A26-S06-06 (merged surface); A26-S09-02 (merged surface) |
| A26-L01 | LOW | CI's backend lint step runs `eslint --fix`, so a fixable lint error never fails CI | A26-S01-01 (primary) |
| A26-L02 | LOW | The `WITH_CONTEXT_ALLOWLIST` lint fence misses several import forms | A26-S01-02 (primary) |
| A26-L03 | LOW | The layer instruction files order a local coverage run that `AGENTS.md` and the verification contract say is CI's | A26-S01-03 (primary) |
| A26-L04 | LOW | `.claude/settings.json` pre-approves `npm install*`, an action `AGENTS.md` lists under "Ask first" | A26-S01-04 (primary) |
| A26-L05 | LOW | `fx-fallback.guard.spec.ts` cannot see a camelCase rate fallback | A26-S02-11 (primary) |
| A26-L06 | LOW | `JwtStrategy` accepts every `JWT_SECRET`-signed token except `2fa_pending` as an access token | A26-S03-03 (primary) |
| A26-L07 | LOW | Admin and owner-of-delegate password resets revoke PATs and trusted devices in a separate transaction from the password write | A26-S03-05 (primary) |
| A26-L08 | LOW | Per-user TOTP and step-up attempt budgets are enforced by peek-then-verify | A26-S03-06 (primary) |
| A26-L09 | LOW | `20260908120000_remove_notification_browser.sql` drops a column the previous release still selects | A26-S05-02 (primary) |
| A26-L10 | LOW | Restore staging writes external attachment objects without an upload intent (MON-M22 residual) | A26-S06-03 (primary) |
| A26-L11 | LOW | A restore applies no semantic backfill to rows from an older artifact (`skip_price_updates`) | A26-S06-04 (primary); A26-S05-03 (superseded) |
| A26-L12 | LOW | The custom-report text filter is a second search door with unescaped LIKE wildcards (INV-SEARCH-001) | A26-S07-08 (primary) |
| A26-L13 | LOW | Job leases are shorter than the provider calls they guard and the saves are not fenced by the lease token (AI insights, email-receipt poll) | A26-S08-04 (primary); A26-S11-01 (merged surface) |
| A26-L14 | LOW | A staged MNY file can still be deleted under a job that was just created (MON-L04 residual) | A26-S09-04 (primary) |
| A26-L15 | LOW | INV-IMPORT-003 is still unenforced on the MNY and QIF writers, and its index entry names one path of three | A26-S09-05 (primary) |
| A26-L16 | LOW | Deleting a rule leaves its open AI review requests rule-less, and they block the email-receipt review of the same transaction | A26-S10-04 (primary) |
| A26-L17 | LOW | A trade email that states only a price books a total derived from the price rounded to 4 decimals (INV-TRADE-001) | A26-S11-02 (primary) |
| A26-L18 | LOW | The trade card's preview can call the FX provider inside the pipeline's receipt transaction | A26-S11-03 (primary) |
| A26-L19 | LOW | The security-transfer edit writes and validates before taking the holdings lock, from snapshots of both legs | A26-S12-07 (primary) |
| A26-L20 | LOW | The price-window fill remembers a month as empty when one provider answered nothing and another failed | A26-S12-08 (primary) |
| A26-L21 | LOW | The undo/redo holdings fold adds a dividend's total to the basis and stores the average at 6 decimals | A26-S12-10 (primary) |
| A26-L22 | LOW | A benchmark observation stored outside the 06:25 run is not followed by a price recompute | A26-S14-03 (primary) |
| A26-L23 | LOW | A loan owing exactly one minor unit is treated as paid off on both layers | A26-S15-06 (primary) |
| A26-L24 | LOW | The GEM signal-change alert is not bound to the current period and its dedupe memory is purged after the retention window | A26-S15-07 (primary) |
| A26-L25 | LOW | Loan Amortization Report: "Original Amount" double-counts projected principal when the opening balance is unset; exports run while loading | A26-S15-08 (primary) |
| A26-L26 | LOW | The Post dialog previews the stored template's principal/interest split while the post re-prices the bill from the ledger | A26-S15-09 (primary) |
| A26-L27 | LOW | A price push's chart token lives five minutes, the push it rides on four hours | A26-S17-04 (primary) |
| A26-L28 | LOW | The portfolio-movement alert commits its new baseline before it writes the notification | A26-S17-06 (primary) |
| A26-L29 | LOW | The insights aggregator computes the month start as a local-midnight date read back in UTC | A26-S17-07 (primary) |
| A26-L30 | LOW | Figures and labels bypass the reader's number locale and the message catalog (lib formatters, form readouts, figure surfaces) | A26-S18-09 (primary); A26-S19-07 (merged surface); A26-S20-07 (merged surface) |
| A26-L31 | LOW | The client forecast accumulates floats and rounds the projected balance with `Math.round(x * 100) / 100` | A26-S18-10 (primary) |
| A26-L32 | LOW | Frontend response types drop signals the backend sends (contract drift) | A26-S18-11 (primary) |
| A26-L33 | LOW | A loan stored at 0 % interest opens with an empty rate and every edit is refused | A26-S19-06 (primary) |
| A26-L34 | LOW | "Interest already saved" counts unrecorded interest as saved for a loan that books interest outside the app | A26-S20-06 (primary) |
| A26-L35 | LOW | The E2E release gate passes a test that failed twice out of three, never runs one of its tests, and swaps a shard for the cluster run | A26-S21-05 (primary) |
| A26-L36 | LOW | `push:client:test` passes with zero discovered tests (MON-L07 residual) | A26-S21-06 (primary) |
| A26-L37 | LOW | Coverage excludes every DTO; two cross-field or privacy constraints there are held by no test | A26-S21-07 (primary) |
| A26-L38 | LOW | A manual close in the middle of a budget period leaves the budget with no OPEN period for good | A26-S16-07 (primary) |
| A26-L39 | LOW | Two flex groups over 90 percent share one alert fingerprint, so the second is never raised in the period | A26-S16-08 (primary) |


## 7. Canonical findings ordered by severity

### 7.1 HIGH findings


### A26-H01 - Refresh-token reuse detection does not revoke the family: the revocation is rolled back by the exception that reports it

- **Canonical severity:** HIGH. kept HIGH: an attacker holding a stolen refresh token keeps a rotating session after the victim's reuse is detected (executed).
- **Absorbs:** A26-S03-01 (primary, 03-security-auth.md, session severity HIGH).
- **Invariants and prior findings named:** INV-AUTH-001.
- **Lens:** security.

#### A26-S03-01 (primary) - Refresh-token reuse detection does not revoke the family: the revocation is rolled back by the exception that reports it

1. **Severity:** HIGH
2. **Confidence:** high (executed against PostgreSQL 16)
3. **Location:** `backend/src/auth/token.service.ts:164-177` (reuse branch), same pattern at `:179-185` (expired) and `:191-203` (inactive user); transaction boundary `backend/src/common/db/scoped-db.ts:230-231` (`dataSource.transaction`, rolls back on throw); caller `backend/src/auth/auth.service.ts:945-950`, `backend/src/auth/auth.controller.ts:1265-1287`.
4. **Violated invariant:** INV-AUTH-001, "a second presentation revokes the family" (`docs/system-invariants.md`, status `enforced`). Rotation-with-reuse-detection exists so that, when a refresh token is stolen and both parties present it, the family dies and the thief's successor stops working.
5. **Reproduction:** user signs in (token `t0`, family F). An attacker who copied `t0` presents it first: rotation revokes `t0` and inserts `t1` (live, family F). The victim's browser then presents `t0`. `refreshTokens` takes the family lock, reads `t0` with `isRevoked = true`, runs `UPDATE refresh_tokens SET is_revoked = true WHERE family_id = F`, and throws `UnauthorizedException("Refresh token reuse detected")` inside the same `withScopedDb` callback. `dataSource.transaction` rolls the UPDATE back. `t1` stays live; the attacker keeps rotating it indefinitely (each rotation resets the expiry).
6. **Observed:** probe `AUDIT S03 probe: refresh reuse` (scratch worktree, real `TokenService`, real PostgreSQL):
   ```text
   AUDIT-PROBE rows after reuse [{"is_revoked":true,"replaced_by_hash":"05a7e8ca..."},{"is_revoked":false,"replaced_by_hash":null}]
   AUDIT-PROBE successorStillRotates true
   Expected: false / Received: true
   ```
   The reuse is reported (401 to the victim, cookies cleared) while the attacker's successor rotates successfully afterwards.
7. **Expected:** after a reuse is detected every member of family F is `is_revoked = true` and committed, and presenting `t1` yields 401.
8. **Impact:** security. The one control that turns refresh-token theft into a detected, self-healing event is inert: the thief retains a session for as long as they keep rotating; the legitimate user is logged out (their `t0` is dead) and signing in again creates a new family without touching F. Only a password change, an admin action or an emergency claim (`revokeAllUserRefreshTokens`) ends F. The same rollback makes the expired-token mark (`:179-185`) and the inactive-user family revoke (`:191-203`) no-ops; those two are harmless today because the conditions are re-checked on every presentation.
9. **Root cause:** a refusal that must leave a durable side effect is raised inside the transaction that holds the side effect. The repository rule "a rejected command must not already have written" was applied in the wrong direction here: this refusal is *required* to write.
10. **Recommended correction:** decide inside the transaction, commit the revocation, then raise outside it. Return a discriminated result from the `withScopedDb` callback and throw after it resolves.
11. **Suggested remediation diff (illustrative, not applied):**
    ```diff
    --- a/backend/src/auth/token.service.ts
    +++ b/backend/src/auth/token.service.ts
    @@ async refreshTokens(
    -    return withScopedDb(this.dataSource, async (manager) => {
    +    type Outcome =
    +      | { kind: "ok"; accessToken: string; refreshToken: string; userId: string }
    +      | { kind: "refused"; key: string; fallback: string };
    +    const outcome = await withScopedDb<Outcome>(this.dataSource, async (manager) => {
    @@
           if (existingToken.isRevoked) {
             await manager.update(
               RefreshToken,
               { familyId: existingToken.familyId },
               { isRevoked: true },
             );
    -        throw new UnauthorizedException(
    -          tr("errors.auth.refreshTokenReuseDetected", "Refresh token reuse detected"),
    -        );
    +        // Committed, then refused: the revocation IS the point of this branch.
    +        return {
    +          kind: "refused",
    +          key: "errors.auth.refreshTokenReuseDetected",
    +          fallback: "Refresh token reuse detected",
    +        };
           }
           if (existingToken.expiresAt < new Date()) {
             existingToken.isRevoked = true;
             await manager.save(existingToken);
    -        throw new UnauthorizedException(tr("errors.auth.refreshTokenExpired", "Refresh token expired"));
    +        return { kind: "refused", key: "errors.auth.refreshTokenExpired", fallback: "Refresh token expired" };
           }
    @@ (inactive user branch: same shape)
    -      return { accessToken, refreshToken: newRawRefreshToken, userId: user.id };
    +      return { kind: "ok", accessToken, refreshToken: newRawRefreshToken, userId: user.id };
         });
    +    if (outcome.kind === "refused") {
    +      throw new UnauthorizedException(tr(outcome.key, outcome.fallback));
    +    }
    +    return { accessToken: outcome.accessToken, refreshToken: outcome.refreshToken, userId: outcome.userId };
       }
    ```
    The unknown-token branch (no row) writes nothing and may keep throwing inside the callback. Still to verify: type-check, `token.service.spec.ts` (its replay case asserts `manager.update` was *called*, which is why it is green today), the new integration test below, and that `auth.controller.ts` refresh still clears cookies on the 401.
12. **Recommended regression test:** a real-database test that rotates `t0`, presents `t0` again, and asserts the successor is revoked and refused. The unit test cannot catch this class: it mocks `withScopedDb`'s transaction, so a call to `update` is indistinguishable from a committed update.
13. **Suggested regression-test diff (illustrative, not applied):**
    ```diff
    --- /dev/null
    +++ b/backend/test/integration/refresh-reuse-revokes-family.integration.spec.ts
    @@
    +it("a reused token revokes the successor durably (INV-AUTH-001)", async () => {
    +  const user = await createTestUserDirect(dataSource);
    +  const { refreshToken: t0 } = await withSystemContext(() => tokens.generateTokenPair(user, false));
    +  const { refreshToken: t1 } = await withSystemContext(() => tokens.refreshTokens(t0));
    +  await expect(withSystemContext(() => tokens.refreshTokens(t0))).rejects.toThrow("reuse");
    +  const live = await dataSource.query(
    +    `SELECT count(*)::int AS n FROM refresh_tokens WHERE user_id = $1 AND is_revoked = false`, [user.id]);
    +  expect(live[0].n).toBe(0);
    +  await expect(withSystemContext(() => tokens.refreshTokens(t1))).rejects.toThrow();
    +});
    ```
    It fails on the baseline (probe output above) and passes with the diff.
14. **Verification method:** the integration test above; the existing two-connection rotation test that INV-AUTH-001 lists as required is also missing (section 10) and belongs beside it; `token.service.spec.ts` updated to assert the throw happens after the transaction resolves.
15. **Residual risks:** the diff does not bound how long a thief who is never raced by the victim keeps a family (absolute family lifetime is a separate design choice); the nightly purge (`token.service.ts:363-389`) deletes revoked rows, after which a reused `t0` is "Invalid refresh token" and revokes nothing -- the detection window is therefore at most one day for non-remember-me sessions.

- **Causality class:** `PRE_EXISTING_UNREPORTED` (the reuse branch predates the upstream audit; MON-M23 looked at logout, not at the reuse branch's commit).
- **Rule 7 surfaces:** the three refusal branches of `refreshTokens`.


### A26-H02 - Any sender can make an email read as the broker's by pasting a forwarded-message header block; with auto-apply the trade it states is booked

- **Canonical severity:** HIGH. kept HIGH: unauthenticated input books a trade and moves a cash balance under RLS (executed).
- **Absorbs:** A26-S11-04 (primary, 11-email-receipts.md, session severity HIGH).
- **Invariants and prior findings named:** INV-RECEIPT-008, INV-RECEIPT-003.
- **Lens:** security.

#### A26-S11-04 (primary) - Any sender can make its email read as the broker's by pasting a "Forwarded message" header block, and with auto-apply on the trade it states is booked with no person

1. **Severity:** HIGH
2. **Confidence:** high (executed, P3, real PostgreSQL under RLS, the real poll, pipeline, card, auto-apply and `confirm`)
3. **Location:** `backend/src/email-receipts/imap/forwarded-receipt.ts:33-71` (`resolveForwardedIdentity`: any text with a forwarded header block replaces `from_address` / `from_domain` / `subject`; the outer sender is not compared with anything); `poll/receipt-rows.ts:85-104` (applied at ingestion, comment "A forward from the user's own address", not enforced); `pipeline/email-receipt-pipeline.service.ts:475, :1187-1216` (re-applied on every pass); `pipeline/choose-receipt-parser.ts` (the parser is chosen by `from_domain`); `pipeline/email-receipt-trade.service.ts:145-150` (the trade auto-apply gate: mailbox switch, approved profile, consistent reading, no ledger match; nothing about the sender); `pipeline/auto-apply-gate.ts:39-58` (the purchase gate, same gap); `pipeline/email-receipt-pipeline.service.ts:312-315, :1318-1335` (`confirm` with the built card).
4. **Violated invariant:** INV-RECEIPT-008 and INV-RECEIPT-003 as the design argues them: decision 12 of `docs/future-plans/email-receipts.md` says the forwarded block "can only choose which approved parser reads the email and which days to look at: it never reaches the ledger except through the same card and approval". Under auto-apply the approval is the gate, and the gate trusts the claimed sender. The server-authoritative rule of the protocol: the identity that decides which of the user's approved profiles may write the ledger is taken from attacker-controlled text.
5. **Realistic reproduction scenario:** the owner connects their inbox, has an approved trade profile for their broker (`fromDomains: ["wealthsimple.com"]`, account rule `RRSP`) and turned the mailbox's auto-apply on. Anyone who knows the address sends, from a domain of their own (so SPF, DKIM and DMARC all pass and the provider files it in INBOX), an email whose text starts with a Gmail-style `---------- Forwarded message ---------` block naming `notifications@wealthsimple.com`, followed by the broker's public template: `Account: RRSP`, `Type: Buy`, `Symbol: <a ticker the owner holds>`, `Shares: 10`, `Average price: $200.00`, `Total cost: $2,000.00`. The next poll reads it.
6. **Observed implementation behavior (executed, P3):** `email_receipts` row `from_address = notifications@wealthsimple.com`, `from_domain = wealthsimple.com`, `forwarded_by = someone@evil.example`, status `review`; `ai_review_requests` one `email_trade`, status `applied`; `investment_transactions` one `BUY`, quantity 10, `total_amount` 2000.0000; the linked cash account's `current_balance` 10 000.0000 -> 8 000.0000. Control (P3b, the same body without the block): `from_domain = evil.example`, status `no_parser`, no trade, balance unchanged. Without auto-apply the same email produces a signed card labelled with the broker's identity that waits for approval.
7. **Expected behavior:** a forwarded header block is honoured only for a forward the mailbox owner made (the outer sender is one of the owner's own addresses), and a reading whose sender identity is a claim of the text (a forward) or unauthenticated never auto-applies; a person approves it, seeing who actually sent it.
8. **Impact:** an outside party writes an investment transaction into the ledger: cash leaves the account, a holding and its cost basis change, and every consumer of holdings, balances, net worth and reports reads the forged trade. Amount, ticker (any security the owner holds), account (any the profile's rules name) and date are the sender's choice, bounded only by the preview's oversell refusal. The purchase path is the same gap with a smaller effect (auto-apply re-categorizes, re-describes and tags an existing transaction; it needs an amount and a payee or order id that match one). Preconditions that bound realism: auto-apply is opt-in and off by default; the sender must know the receipts address, the broker, the account label the profile maps and a ticker the owner holds. The broker's own DMARC policy does not help: the attacker never spoofs the broker's domain.
9. **Root cause:** the forwarded-identity heal was designed for the owner's own forwards (decision 12) but is applied to every message, and the auto-apply gates were designed on the assumption that the parser chosen for the sender implies a trusted sender.
10. **Recommended correction:** (a) honour a forwarded header block only when the outer `From` is the mailbox's own login (`email_receipt_mailboxes.username`), the user's account email, or an address the owner lists as their own; (b) refuse auto-apply for any reading whose identity came from a forward (`forwarded_by IS NOT NULL`), in both gates; (c) maintainer decision: whether a directly received email may auto-apply without an `Authentication-Results: ... dmarc=pass header.from=<domain>` added by the mailbox's own provider.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/email-receipts/imap/forwarded-receipt.ts
+++ b/backend/src/email-receipts/imap/forwarded-receipt.ts
 export function resolveForwardedIdentity(
   current: ReceiptIdentity,
   bodyText: string,
   receivedAt: Date,
+  /** The owner's own addresses, lower-case: only their forwards are re-identified. */
+  ownAddresses: ReadonlySet<string>,
 ): ReceiptIdentity | null {
+  // A forward is the owner's when the message came from the owner (or was
+  // healed already, which records the owner as `forwardedBy`). Anyone else's
+  // pasted header block is text, not an identity (A26-S11-04).
+  const sender = (current.forwardedBy ?? current.fromAddress).toLowerCase();
+  if (!ownAddresses.has(sender)) return null;
   const original = detectForwardedOriginal(bodyText);
--- a/backend/src/email-receipts/pipeline/email-receipt-trade.service.ts
+++ b/backend/src/email-receipts/pipeline/email-receipt-trade.service.ts
       const gate =
         context.mailboxAutoApply &&
         context.parser.status === "approved" &&
         tradeMayAutoApply(trade) &&
-        !ledger.anyMatch;
+        !ledger.anyMatch &&
+        // The sender of a forward is a claim of the email's text: a person looks.
+        receipt.forwardedBy === null;
--- a/backend/src/email-receipts/pipeline/auto-apply-gate.ts
+++ b/backend/src/email-receipts/pipeline/auto-apply-gate.ts
 export interface AutoApplyFacts {
+  /** The email's sender identity came from a forwarded header block. */
+  forwarded: boolean;
@@
     facts.cardBuilt &&
-    !facts.linked
+    !facts.linked &&
+    !facts.forwarded
   );
```

   (The callers pass `ownAddresses` = `{ mailbox.username, user.email }` plus any configured forwarder addresses, read from the server's rows: `buildReceiptRow` gains the parameter from the poll and the import, `healForwardedIdentity` from the mailbox it already loads; a row healed before the fix keeps its stored identity until reprocessed, so the heal must also be able to UN-heal a row whose `forwarded_by` is not an own address. The pipeline passes `forwarded: receipt.forwardedBy !== null` into `AutoApplyFacts`.) Needs: unit tests of both gates and of the heal, P3 as an integration case, a migration-free check that existing forwarded rows still match, and the maintainer's decision (c).
12. **Recommended regression test:** P3 as `test/integration/email-receipts-forwarded-sender.integration.spec.ts`: the outside sender's email is stored as `evil.example`, no trade is created, the cash balance stays 10 000; and the owner's own forward (outer `From` = the mailbox login) is still re-identified and proposed, never auto-applied.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
--- /dev/null
+++ b/backend/test/integration/email-receipts-forwarded-sender.integration.spec.ts
+  it("an outside sender's pasted forward block chooses no profile and books nothing", async () => {
+    const r = await pollWith(crafted("Someone <someone@evil.example>", true));
+    expect(r.receipt).toMatchObject({ from_domain: "evil.example", forwarded_by: null });
+    expect(r.trades).toHaveLength(0);
+    expect(Number(r.cash.current_balance)).toBe(10000);
+  });
+  it("the owner's own forward is read as the broker's and waits for a person", async () => {
+    const r = await pollWith(crafted("Alice <receipts@example.com>", true));
+    expect(r.receipt.from_domain).toBe("wealthsimple.com");
+    expect(r.requests).toEqual([{ kind: "email_trade", status: "proposed" }]);
+    expect(r.trades).toHaveLength(0);
+  });
```

   (`pollWith` and `crafted` as in the P3 probe, section 12; the harness's `ScheduledTransactionsService` stub needs `findInvestmentOccurrenceForTrade` set, which is also why no trade integration test exists today.)
14. **Verification method:** `npm run test:unit -- forwarded-receipt auto-apply-gate email-receipt-trade email-receipt-pipeline`; the regression spec above; `npm run test:integration -- email-receipts`.
15. **Residual risks / patch limitations:** a spoofed outer `From` equal to the owner's address still passes (a) where the owner's domain publishes no enforcing DMARC policy (`p=none`), which is why (b) refuses auto-apply for every forward rather than trusting (a) alone; a directly received email that spoofs a broker without enforcing DMARC is not covered until decision (c). Manual approval of a forged card remains possible and is a social-engineering risk the card's display of the true sender would reduce (frontend: the AI review card does not show `forwarded_by`; the email detail dialog does, `EmailReceiptDetailDialog.tsx:199-203`).

Causality: `NEW_SINCE_UPSTREAM_AUDIT`. Execution evidence: P3 (plan step 7), section 12. Mutation evidence: no existing test sends a forward from a non-owner address, so restoring the defect after a fix would be caught only by the new regression test.


### A26-H03 - Transfer edit paths derive both balance deltas from pre-transaction snapshots (split-transfer leg, connected cross-owner transfer)

- **Canonical severity:** HIGH. kept HIGH: persistent stored-versus-ledger divergence on two accounts, across two tenants on the cross-owner surface (executed 5/5).
- **Absorbs:** A26-S07-01 (primary, 07-cash-ledger.md, session severity HIGH); A26-S02-01 (superseded, 02-prior-high-triage.md, session severity HIGH).
- **Invariants and prior findings named:** INV-BALANCE-001, MON-H05.
- **Lens:** concurrency.

#### A26-S07-01 (primary) - Two transfer edit paths derive both balance deltas from pre-transaction snapshots (MON-H05 residual: split-transfer leg and connected cross-owner transfer)

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

#### A26-S02-01 (superseded) - A split-transfer leg's edit derives both balance deltas from pre-transaction snapshots (MON-H05 still open on this path)

Superseded by the primary above: same root cause, and its scenario is one surface of the primary's reproduction. Full text: `02-prior-high-triage.md` section 4.


### A26-H04 - Editing an investment transaction twice at once, or while it is deleted, duplicates or orphans its cash leg

- **Canonical severity:** HIGH. kept HIGH: duplicated or orphaned cash rows of the full trade amount (executed, forced interleaving).
- **Absorbs:** A26-S12-01 (primary, 12-securities-holdings.md, session severity HIGH).
- **Invariants and prior findings named:** INV-BALANCE-001, INV-HOLDING-001.
- **Lens:** concurrency.

#### A26-S12-01 (primary) - Editing an investment transaction twice at once, or editing it while it is deleted, duplicates or orphans its cash leg

1. **Severity:** HIGH
2. **Confidence:** high (executed, forced interleaving, R1 and R2)
3. **Location:** `backend/src/securities/investment-transactions.service.ts:4321` (`update()` reads the row with `findOne` before its transaction), `:4473-4480` (the transaction takes only the account-level advisory lock), `:4536-4540` -> `:4905-4936` (`reverseTransactionEffectsInTransaction` deletes the cash row named by the **snapshot's** `transactionId` and nulls the column on the live row), `:4731` (`manager.save(transaction)` writes the whole stale entity), `:4750-4756` (a new cash row is created unconditionally); same shape in `remove()` `:4939`, `:5016-5019`; `updateLinkedTransfer` `:3853-4005` (no cash, see A26-S12-07).
4. **Violated invariant:** INV-BALANCE-001 for the investment cash leg; the rule in `AGENTS.md` "every check that can refuse a request ... runs inside the same transaction as the mutation, under the same lock"; INV-HOLDING-001 known gap ("update() and remove() derive the scopes ... from a snapshot loaded before the transaction, without lockInvestmentTransactionRow") is narrower than the defect.
5. **Reproduction:** funding account 100,000.00; BUY 10 @ 100.00 posts cash row C1 -1,000.00 (balance 99,000.00). Two `PATCH /investment-transactions/:id {price: 110}` arrive together (double submit, two tabs, or the form plus an AI edit). Both read the row (transactionId C1) before either takes `lockHoldingScope`. A runs: deletes C1 (+1,000.00), saves, creates C2 (-1,100.00), commits. B then runs with its snapshot: `manager.update(..., {transactionId: null})` unlinks C2, `lockTransactionRow(C1)` finds nothing so nothing is reversed, B saves its stale entity and creates C3 (-1,100.00). R2: the same with A an edit and B a `DELETE`: B deletes the investment row but reverses only C1 (already gone), so C2 survives with no owner.
6. **Observed (executed):** R1 -- two cash rows, ledger -2,200.00, balance 97,800.00; the investment row names C3 only. R2 -- investment row gone, one cash row -1,100.00 left, balance 98,900.00.
7. **Expected:** R1 -- one cash row -1,100.00, balance 98,900.00 (the second edit is a no-op or a 409). R2 -- no investment row, no cash row, balance 100,000.00.
8. **Impact:** money created or destroyed in a cash account with no investment row behind it: -1,100.00 per duplicated edit (100 percent of the trade); the orphan cash row cannot be removed through the investment register and survives every holdings rebuild (holdings are re-derived, the cash row is not). Reachable from the form, `PATCH`, the AI assistant and MCP (`update()` is the one door), and from the bulk update path, which loops `update()`.
9. **Root cause:** the advisory lock serializes the two writers but neither re-reads the row after acquiring it; every decision after the lock (which cash row to delete, which fields to save) is taken from a snapshot read outside the transaction. `updateStatus` (`:4109-4289`) shows the correct shape: `lockInvestmentTransactionRow` inside the transaction after the advisory lock.
10. **Recommended correction:** inside the transaction, after `lockHoldingScope`, take `lockInvestmentTransactionRow(manager, id, userId)`, refuse with 404 when it is gone, refuse with 409 when its account no longer matches the locked scope, and reload the entity from the manager before applying the DTO; the same in `remove()` (and in `updateLinkedTransfer` for both legs).
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/securities/investment-transactions.service.ts
+++ b/backend/src/securities/investment-transactions.service.ts
@@ -4477,6 +4477,27 @@ export class InvestmentTransactionsService {
       await lockHoldingScope(
         manager,
         [accountId, updateDto.accountId].filter((id): id is string => !!id),
       );
+      // The row as it is now, under its own lock: a concurrent edit or delete
+      // may have replaced its cash leg (or removed it) since the read above.
+      const locked = await lockInvestmentTransactionRow(manager, id, userId);
+      if (!locked) {
+        throw new NotFoundException(
+          tr(
+            "errors.securities.investmentTransactionNotFound",
+            `Investment transaction with ID ${id} not found`,
+            { id },
+          ),
+        );
+      }
+      if (locked.accountId !== accountId) {
+        throw new ConflictException(
+          tr(
+            "errors.securities.investmentTransactionChanged",
+            "This transaction was changed by another request; reload it and try again.",
+          ),
+        );
+      }
+      Object.assign(
+        transaction,
+        await manager
+          .getRepository(InvestmentTransaction)
+          .findOneOrFail({ where: { id, userId }, relations: ["account", "security", "fundingAccount"] }),
+      );
@@ -4991,6 +5012,14 @@ export class InvestmentTransactionsService {
     await withScopedDb(this.dataSource, async (manager) => {
       await lockHoldingScope(manager, affectedAccountIds);
+      for (const leg of legsToRemove) {
+        const locked = await lockInvestmentTransactionRow(manager, leg.id, userId);
+        if (!locked) {
+          throw new NotFoundException(/* as above */);
+        }
+        // Reverse what the row carries now, not what it carried at the read.
+        leg.transactionId = locked.transactionId;
+      }
```

The prior* values (`priorPrice`, `priorQuantity`, ...) and `beforeData` must then be taken from the reloaded entity, not the outer read. Needs: type-check, the unit suite (the mocked `lockInvestmentTransactionRow` returns null by default in `test-helpers/locks-testing.ts:64`, so mocks need a row), and the R1/R2 race below at integration level. Decision for the maintainer: 409 versus "apply on top of the current row" for the second of two edits.

12. **Recommended regression test:** two-connection R1 and R2 at integration level, barrier on `lockHoldingScope`, asserting the funding account's cash rows and balance against the ledger.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+++ b/backend/test/integration/investment-edit-race.integration.spec.ts
+  it("a double-submitted edit of one BUY moves the cash once", async () => {
+    const tx = await buy(10, 100, "2026-01-15");          // cash -1,000.00
+    const barrier = holdBarrier([brokerageId]);           // lockHoldingScope held
+    await barrier.isHeld;
+    const a = as(() => investments.update(userId, tx.id, { price: 110 }));
+    const b = as(() => investments.update(userId, tx.id, { price: 110 }));
+    await waitForBlockedBackends(2);
+    barrier.release();
+    await Promise.allSettled([barrier.done, a, b]);
+    const rows = await cashRows(fundingId);
+    expect(rows).toHaveLength(1);
+    expect(await balance(fundingId)).toBe(98900);
+  });
```

14. **Verification:** the scratch spec R1/R2 green after the fix and red with the lock call removed; `npm run test:unit -- investment-transactions`; `npm run test:integration -- investment`.
15. **Residual risks:** the patch closes the investment row; `transactions.service` edits of a linked cash leg are S07's (A26-S07-01). The same snapshot shape in `updateLinkedTransfer` moves no cash and is A26-S12-07.

- Causality: `PRE_EXISTING_UNREPORTED` (the investment-ledger sibling of MON-H05 / A26-S07-01; the INV-HOLDING-001 known-gap text names the snapshot but not the cash duplication).


### A26-H05 - Bulk-deleting one leg of a split transfer deletes the parent but leaves the other legs, creating their money

- **Canonical severity:** HIGH. kept HIGH: deterministic, no race needed; money created on the surviving leg's account (executed).
- **Absorbs:** A26-S13-03 (primary, 13-valuation-fx-networth.md, session severity HIGH).
- **Invariants and prior findings named:** INV-BALANCE-001, MON-M34.
- **Lens:** financial.

#### A26-S13-03 (primary) - Bulk-deleting one leg of a split transfer deletes the parent but leaves the other legs, creating their money (MON-M34 residual on the bulk path)

1. **Severity:** HIGH
2. **Confidence:** high (executed, P4, against the schema's `ON DELETE` actions)
3. **Location:** `backend/src/transactions/transaction-bulk-update.service.ts:556-572` (a selected row's `linkedTransactionId` is queued; a split-transfer leg links to the split **parent**, whose own splits are never loaded, so its other legs are not collected), `:604-612` (reversal only of locked rows), `:621-639` (parent deleted; `transaction_splits` cascade, `database/schema.sql:404`; the surviving legs' `linked_transaction_id` set NULL, `:378`). The single path removes the sibling legs explicitly (`transaction-transfer.service.ts:1664-1692`).
4. **Violated invariant:** INV-BALANCE-001 (a balance equals its ledger and a transfer moves no money in total); `AGENTS.md` "A deletion reverses only what the row contributed" and "A refusal is only worth as much as its least-guarded entry point".
5. **Reproduction:** account A (1,000.00), B and C (0.00). A split withdrawal of -100.00 in A with two transfer lines: 60.00 to B and 40.00 to C. In B's register, select the 60.00 leg and bulk-delete it (`POST /transactions/bulk-delete`, `mode: "ids"`).
6. **Observed (executed, P4):** `{"deleted":1}`; balances A 1,000.00, B 0.00, C 40.00; the ledger holds one row, C's +40.00 transfer, with `linked_transaction_id: null`. The sum of the three balances is 1,040.00.
7. **Expected:** either the whole split transfer is removed (A 1,000.00, B 0.00, C 0.00, total 1,000.00), as the single-delete path does, or the selected leg is refused with the reason (a split leg is edited through its parent).
8. **Impact:** 40.00 created (40 percent of the transfer, 4 percent of the total held) per occurrence; C's balance agrees with C's ledger, so neither `recalculateCurrentBalance` nor the net-worth sweep repairs it, and every report and net-worth figure carries the orphan leg as a transfer with no source. The deletion of a split parent selected in bulk is handled (its legs are collected); the defect is only on the leg selection.
9. **Root cause:** the bulk path treats `linkedTransactionId` as "the other leg" for every row, which is true for a plain transfer and false for a split-transfer leg, whose link names the parent; the sibling expansion the single path performs was not ported (the P5-012 fix added accounts, not rows).
10. **Recommended correction:** inside the bulk transaction, after locking, expand a selected split-transfer leg to its parent's full set (parent, every split's linked leg), exactly as `removeParentTransaction` does, or refuse a leg whose parent is not also selected.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/transactions/transaction-bulk-update.service.ts
+++ b/backend/src/transactions/transaction-bulk-update.service.ts
@@ -556,6 +556,24 @@
       for (const tx of transactions) {
+        // A split-transfer leg links to the split PARENT, not to a mirror leg:
+        // deleting the parent cascades its split rows and leaves every other
+        // leg standing with its money. Expand to the parent's whole set, the
+        // way the single delete does (removeParentTransaction).
+        if (tx.linkedTransactionId) {
+          const parentSplits = await m.getRepository(TransactionSplit).find({
+            where: { transactionId: tx.linkedTransactionId },
+          });
+          for (const s of parentSplits) {
+            if (
+              s.linkedTransactionId &&
+              !transactionIdsSet.has(s.linkedTransactionId)
+            ) {
+              linkedIdsToDelete.add(s.linkedTransactionId);
+            }
+          }
+        }
         if (
           tx.linkedTransactionId &&
           !transactionIdsSet.has(tx.linkedTransactionId)
```

   Needs: the `TransactionSplit` import, the reconciled-lock check over the expanded set (it runs after the lock, so it covers them), and a decision whether a leg selected without its parent should rather be refused.
12. **Recommended regression test:** integration (schema-faithful FKs): bulk-delete a split-transfer leg, assert all three balances return to their pre-transfer values and no orphan leg remains; also the parent selected, both legs selected, and a cross-owner leg.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+  it("bulk-deleting one split-transfer leg removes the whole split transfer", async () => {
+    // A 1000, split -100 -> B 60 / C 40, then bulk-delete B's leg
+    await bulk.bulkDelete(userId, { mode: "ids", transactionIds: [bLeg.id] });
+    expect(await balanceOf(a.id)).toBe(1000);
+    expect(await balanceOf(b.id)).toBe(0);
+    expect(await balanceOf(c.id)).toBe(0);
+    expect(await countRows(userId)).toBe(0);
+  });
```

14. **Verification:** P4 green; the case must run on a database whose `transaction_splits` and `transactions` FKs carry the schema's `ON DELETE` actions (the entity harness does not, section 10).
15. **Residual risks:** a bulk delete of a split parent with embedded investment lines does not call `deleteSplitSideEffects` (investment rows cascade with no holdings rebuild; agent sweep, not executed) and a cross-owner counterpart is never removed (`lockTransactionRows` filters on `user_id`); both handed to S07/S12 (section 12).

- Causality: `PRE_EXISTING_UNREPORTED` (MON-M34 covered the counterpart account's snapshot; the sibling-leg rows were not in it).


### A26-H06 - Undo or redo of an account edit restores a whole-entity snapshot: the edit-time balance is written back absolutely and a loan's coupled template is left unrepriced or unlinked

- **Canonical severity:** HIGH. kept HIGH for both surfaces: one root (`undoSimpleEntity` restores every column of the snapshot); balance divergence on the cash surface, a wrong installment or an unmanaged loan template on the loan surface (both executed).
- **Absorbs:** A26-S07-02 (primary, 07-cash-ledger.md, session severity HIGH); A26-S15-01 (merged surface, 15-loans-strategies.md, session severity HIGH).
- **Invariants and prior findings named:** INV-BALANCE-001, INV-LOAN-007, INV-LOAN-010, MON-H07.
- **Lens:** financial.

#### A26-S07-02 (primary) - Undo or redo of an account edit writes the edit-time `current_balance` back as an absolute value

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

#### A26-S15-01 (merged surface) - Undo (and redo) of a loan or mortgage account edit restores the loan's coupled columns without the template reprice or relink the edit performed: the bill keeps the previous method's installment for the life of the loan, or the template stops being managed

1. **Severity:** HIGH
2. **Confidence:** high (executed, both halves)
3. **Location:** `backend/src/action-history/action-history.service.ts:1741-1764` (`undoSimpleEntity`, `update`: `manager.update(entityClass, id, beforeData)`), `:172-212` (`ALLOWED_COLUMNS.accounts` includes `mortgage_type`, `payment_amount`, `interest_category_id`, `prepayment_mode`, `amortization_months`, `original_principal`, `source_account_id`, `scheduled_transaction_id`, `payment_matching_rule_id`); dispatch `:577-578`; producer `backend/src/accounts/accounts.service.ts:1022-1042, 1126-1130, 1169-1187, 1208-1217`. Redo uses the same function with before/after swapped.
4. **Violated invariant:** INV-LOAN-007 (one method per mortgage type, from preview to pricing; a method change reprices the template, `docs/specs/mortgage-types.md` 5.6) and INV-LOAN-010 (a template managed before a successful update is managed after it).
5. **Reproduction:** (a) an ANNUITY mortgage, EUR 300,000, 360 months, 2.00 %, payment 1,108.86, template 608.86 + 500.00. The user changes the type to LINEAR (the update reprices the template to 833.3333 + 500.00 = 1,333.3333 and nulls `payment_amount`), then presses Undo. (b) a LOAN with interest category A; the user changes it to B (the update relinks the template line to B), then presses Undo.
6. **Observed (executed, `zz-s15-undo2`, `zz-s15-undo`):** (a) after the undo the account is ANNUITY with `payment_amount` 1,108.86 and the template still holds 1,333.3333; the next advancement (`rewriteLoanTemplate`, purpose `template`) leaves it at 1,333.3333 (`max(template, dated payment)`), and the posting purpose prices principal 833.3333 + interest 500.00 = **1,333.3333**. (b) after the undo the account's category is A and the template line is B: `identifyLoanTemplate(...).managed === false`, so every later posting declines to re-price (posts the stored split), the template never advances, and a `settle_loan_installment` rule refuses `loan_not_configured` (`managedTemplate`).
7. **Expected:** an undo is an edit like any other: it reprices the template to the restored method (1,108.86) and relinks the interest line to the restored category, in the same transaction, or the undo is refused.
8. **Impact:** (a) EUR 1,333.33 instead of 1,108.86 every month: **+224.47 per installment (+20.2 %)** moved from chequing to the mortgage that the bank never debited, cumulative and silent until reconciliation (2,693.64 after a year). (b) the split stays at the last period's figures (interest overstated by a growing amount, principal understated), and the final installment posts its stored principal past the debt; payment matching stops working. Both reachable by one Undo click after an ordinary edit.
9. **Root cause:** the generic entity undo treats the account's loan configuration as independent columns; the side effects `AccountsService.update` performs on the schedule (relink, reprice) are not part of the action record and nothing replays them. Same function as A26-S07-02 (S07, `current_balance`), different invariants.
10. **Recommended correction:** route an account `update` undo/redo through `AccountsService.update` with the restored values (so relink, reprice and their refusals run), or remove the loan-coupled columns from `ALLOWED_COLUMNS.accounts` and refuse the undo of an edit that changed any of them while a schedule exists.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/action-history/action-history.service.ts
+++ b/backend/src/action-history/action-history.service.ts
@@ case "account":
-        await this.undoSimpleEntity(action, manager, Account, "accounts");
+        if (action.action === "update" && touchesLoanTemplate(action)) {
+          // A loan's method and interest category are coupled to its payment
+          // template (INV-LOAN-007, INV-LOAN-010); restoring the columns alone
+          // leaves the template priced for the other configuration.
+          throw new ConflictException(
+            tr(
+              "errors.actionHistory.loanEditNotUndoable",
+              "This loan change cannot be undone automatically. Edit the loan to change it back.",
+            ),
+          );
+        }
+        await this.undoSimpleEntity(action, manager, Account, "accounts");
@@
+const LOAN_TEMPLATE_COLUMNS = [
+  "mortgageType", "prepaymentMode", "amortizationMonths", "originalPrincipal",
+  "paymentAmount", "interestCategoryId", "sourceAccountId", "paymentFrequency",
+] as const;
+function touchesLoanTemplate(action: ActionHistory): boolean {
+  const before = action.beforeData ?? {};
+  const after = action.afterData ?? {};
+  return (
+    !!(before.scheduledTransactionId ?? after.scheduledTransactionId) &&
+    LOAN_TEMPLATE_COLUMNS.some((k) => (before[k] ?? null) !== (after[k] ?? null))
+  );
+}
```

   Decision for the maintainer: refuse (above, smallest safe change) or replay through `AccountsService.update` (keeps Undo working, needs the service in the action-history module without a cycle). The refusal must run before any write; `undo()` already runs in one transaction. Needs: a new i18n key, unit cases, the two probes as integration cases.
12. **Recommended regression test:** the two probes: change type / category through `AccountsService.update`, undo, assert the template is either repriced to the annuity payment and still managed, or the undo was refused with nothing written.
13. **Suggested regression-test diff (illustrative, not applied):** `backend/test/integration/loan-account-undo.integration.spec.ts`, built as `zz-s15-undo2` (the harness's scheduled-module stub gets the real `rewriteLoanTemplate(m, id, "reconfigure")` as `repriceLoanTemplate`): `await accounts.update(userId, loanId, { mortgageType: "LINEAR", prepaymentMode: "SHORTEN_TERM" }); await history.undo(userId).catch(() => undefined); const st = await db.manager.findOneByOrFail(ScheduledTransaction, { id }); expect(Math.abs(Number(st.amount))).toBe(1108.86);` and the category case `expect(identifyLoanTemplate(lines, loan).managed).toBe(true)`.
14. **Verification:** those specs; `npm run test:unit -- action-history`; the redo direction (LINEAR restored with the annuity template: heals at the next advancement, since LINEAR derives its installment, but the posting before it re-divides the annuity bill).
15. **Residual risks:** `source_account_id` restored without `reassignLoanSourceAccount` moves the loan's payments to another account only in the account row (not executed); `payment_matching_rule_id` and `scheduled_transaction_id` restored to ids that may since have been deleted (not executed). The refusal blocks Undo for legitimate non-loan edits made in the same action (name plus type): acceptable, the message says what to do.

- Causality: `NEW_SINCE_UPSTREAM_AUDIT` (mortgage types, the relink and the reprice are post-August; the generic undo is older and was correct before the coupling existed).


### A26-H07 - Manual post and skip of a scheduled transaction are not pinned to the occurrence the user saw; a stale view pays a bill twice or consumes the next occurrence

- **Canonical severity:** HIGH. kept HIGH (S08 raised S02's MEDIUM on execution): a duplicate bill payment of 100 % of the amount from an ordinary stale tab or retry (executed P2, P3, P7).
- **Absorbs:** A26-S08-01 (primary, 08-scheduler-cron.md, session severity HIGH); A26-S02-04 (superseded, 02-prior-high-triage.md, session severity MEDIUM).
- **Invariants and prior findings named:** INV-OCCURRENCE-001, MON-H06.
- **Lens:** concurrency.

#### A26-S08-01 (primary) - Manual post and skip are not pinned to the occurrence the user saw; a stale view pays a bill twice or consumes the next occurrence (MON-H06 residual; supersedes A26-S02-04)

1. **Severity:** HIGH
2. **Confidence:** high (executed, P2, P3, P7)
3. **Location:** `backend/src/scheduled-transactions/scheduled-transactions.controller.ts:329-368` (post and skip routes pass no occurrence); `dto/post-scheduled-transaction.dto.ts` (no `expectedDueDate`); `scheduled-transactions.service.ts:2908-2931` (pin optional), `:2662-2699` (`skip()`: unlocked read, unconditional update); client `frontend/src/components/scheduled-transactions/PostTransactionDialog.tsx:453-454, 770`, `ScheduledTransactionListParts.tsx:210, 214`, `frontend/src/lib/scheduled-transactions.ts:154`.
4. **Violated invariant:** INV-OCCURRENCE-001 -- one logical occurrence, one financial effect, on every entry point; the cron, AI-action and email-receipt paths carry the pin (`:624`, `ai-actions.service.ts:1147`, `email-receipt-trade-link.service.ts:296`), the two human ones do not.
5. **Realistic reproduction scenario:** (a) Monthly "Rent" -50.00 due 2026-09-01, balance 100.00. The Bills tab was loaded before 00:05; the cron posts 2026-09-01 and advances to 2026-10-01; the user opens Post on the stale row (dialog date 2026-09-01) and confirms. (b) Same, with a schedule of one remaining occurrence (`occurrences_remaining = 1`): the cron posts it and deactivates the schedule; the stale tab posts it again. (c) Same as (a), the user presses Skip on the stale row instead. A lost HTTP response retried by the client, and the false failure alert of A26-S08-02, are two more ways to reach (a)/(b) without a second tab.
6. **Observed implementation behavior (executed):** (a) P2: two rows dated 2026-09-01, balance 0.00, claims `[2026-09-01, 2026-10-01]`, cursor 2026-11-01 -- October was consumed early under September's date. (b) P7: the deactivated schedule posts again: two rows dated 2026-09-01, balance 0.00 instead of 50.00, a claim on 2026-10-01 for a schedule that had no occurrence left. (c) P3: cursor 2026-10-01 -> 2026-11-01; October is skipped although the user skipped September (already paid), and October's override, if any, is deleted with it.
7. **Expected behavior:** 409 "already posted" (or "already skipped"), nothing written, as the cron gets.
8. **Impact:** (a) a payment booked a month early under the wrong date; the register shows the bill paid twice in one month and the next month's bill silently missing. (b) a genuine extra payment: -50.00 on a 50.00 bill, 100 % of the occurrence, on an exhausted schedule (the last installment of a loan, a fixed-count plan, any schedule past `end_date`). (c) a real occurrence never booked, with no record that it was owed. All three are user-visible only by reading the register.
9. **Root cause:** the occurrence identity is the cursor the server reads at request time; the client knows which occurrence it means but the API has no field to say it, and `post()` accepts an inactive or exhausted schedule for a manual post (`:3357-3371` checks activity only for the cron).
10. **Recommended correction:** carry the occurrence the client displays on both routes, refuse a mismatch inside the locked transaction (the existing pre-lock check plus the CAS already do this when `expectedDueDate` is set), and do the same in `skip()` under a lock. Decision for the maintainer: whether an absent pin remains accepted for one release (old clients) or is required at once; the safer default is to require it for the dialog and the row menu, both of which have the date.
11. **Suggested remediation diff (illustrative, not applied):**

> Diff of 70 lines not repeated here: see `08-scheduler-cron.md` section 4, A26-S08-01, field 11.

   `dueSlot` is the row's `nextDueDate` (the slot), which the list already holds; `scheduledTransactionsApi.skip` gains the optional body. Self-check: the pin names the slot, not the override date, so an override that moves the posting date does not trip it; a user who deliberately posts a not-yet-due occurrence still can (the slot they see is the cursor); the cron path is unchanged. Needs: i18n key reuse check, controller and DTO unit tests, the client tests, and `e2e/` grep for the Post/Skip controls (names unchanged).
12. **Recommended regression test:** the P2/P7/P3 probes as an integration spec against the real `post()`/`skip()` (the harness change of A26-S08-05), asserting 409 and an unchanged ledger; a controller spec asserting the pin is forwarded; a dialog test asserting the payload carries `expectedDueDate`.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+++ b/backend/test/integration/scheduled-post-occurrence-pin.integration.spec.ts
+  it("refuses a manual post of an occurrence the cron already posted", async () => {
+    const s = await makeSchedule({ nextDueDate: "2026-09-01", amount: -50 });
+    await service.processAutoPostTransactions();          // posts 2026-09-01
+    await expect(
+      withUserContext(userId, () =>
+        service.post(userId, s.id, { transactionDate: "2026-09-01" } as any, {
+          expectedDueDate: "2026-09-01",
+        }),
+      ),
+    ).rejects.toBeInstanceOf(ConflictException);
+    expect(await balance()).toBe(50);                      // 100.00 - 50.00, once
+    expect(await claims(s.id)).toEqual(["2026-09-01"]);
+  });
+  it("refuses a stale skip", async () => { /* same, skip(userId, id, "2026-09-01") -> 409, cursor stays 2026-10-01 */ });
+  it("refuses a manual post of an exhausted schedule's consumed slot", async () => { /* occurrences_remaining 1, P7 */ });
```

14. **Verification method:** that spec; `npm run test:unit -- scheduled-transactions`; `npm run test -- PostTransactionDialog ScheduledTransactionList scheduled-transactions` in `frontend/`; manual check that a deliberate early post (pin = current cursor) still works.
15. **Residual risks / patch limitations:** old clients that omit the pin keep today's behaviour until it is required; `post()` still accepts an inactive schedule manually by design (the pin is what refuses the consumed slot, not the activity flag).

Causality: `PRIOR_REPORTED`, `CONFIRMED` (MON-H06 residual path; A26-S02-04 superseded, with the skip surface and the exhausted-schedule case added). Rule 7 surfaces: dialog post, row-menu post, row-menu skip, any retry of either. Severity raised from S02's MEDIUM on execution: case (b) is an outright extra payment, and A26-S08-02 gives a server-induced trigger.

#### A26-S02-04 (superseded) - Manual "post" of a scheduled transaction is not pinned to the occurrence the user saw (MON-H06 residual)

Superseded by the primary above: same root cause, and its scenario is one surface of the primary's reproduction. Full text: `02-prior-high-triage.md` section 4.


### A26-H08 - A failure after the MNY import's data commit is reported as "Nothing was saved", and the same file can then be imported again

- **Canonical severity:** HIGH. kept HIGH: a second import duplicates every row and balance of the file (executed over three fixtures); A26-S18-05 is the client copy of the same false report and is merged as a surface (its MEDIUM is absorbed).
- **Absorbs:** A26-S09-01 (primary, 09-import-mny.md, session severity HIGH); A26-S02-05 (superseded, 02-prior-high-triage.md, session severity MEDIUM); A26-S18-05 (merged surface, 18-frontend-core.md, session severity MEDIUM).
- **Invariants and prior findings named:** INV-IMPORT-002, MON-H04.
- **Lens:** data.

#### A26-S09-01 (primary) - A failure after the data commit is reported as "Nothing was saved", and the same file can then be imported again (MON-H04 residual; supersedes A26-S02-05)

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

#### A26-S02-05 (superseded) - A committed MNY import can be replayed by a new start on the same staged file (MON-H04 residual)

Superseded by the primary above: same root cause, and its scenario is one surface of the primary's reproduction. Full text: `02-prior-high-triage.md` section 4.

#### A26-S18-05 (merged surface) - A failed MNY job whose rows committed tells the user "Nothing was saved -- you can try again"

1. **Severity:** MEDIUM
2. **Confidence:** high (static, every link cited; the copy is asserted by the existing test `MnyImportProgress.test.tsx:160-167`)
3. **Location:** `frontend/src/components/import/MnyImportProgress.tsx:43-55` (renders `mnyErrors.mnyImportFailed` when `errorKey` is the generic key or empty); copy `frontend/src/i18n/messages/en/import.json:548`; type `frontend/src/lib/import-mny.ts:254-265` (`MnyImportJob` has no committed flag); backend `backend/src/import/mny/mny-import.service.ts:296-324` (finalizing, verify, verifyHoldings and `staging.remove` run after the commit at `:680`), `mny-import-job.service.ts:678-692` (any throw -> `fail(..., 'mnyImportFailed', ...)`), `:611-625` (`retryable = ($4 AND data_committed = false)`, `error_key` left generic), `dto/mny-import.dto.ts:145-175` and `mny-import.controller.ts:68-78` (`dataCommitted` not in the DTO).
4. **Violated invariant:** "a request that failed is said to be one" and the state-machine rule that a terminal state's copy describes what was written (`docs/financial-calculation-contract.md` 1.3; S09 hand-off "the wizard has no committed-failure state").
5. **Reproduction:** import a `.mny`; the write transaction commits (accounts, 37 000 transactions); `verifyHoldings` or `staging.remove` then throws (a filesystem error on the staged file, a database error during verification).
6. **Observed:** the job is `failed`, `errorKey: 'mnyImportFailed'`, `retryable: false`; the wizard shows "Something went wrong while importing. Nothing was saved -- you can try again." with only "Start over".
7. **Expected:** a committed-failure copy ("Your data was imported, but a final check failed; do not import this file again") driven by a `dataCommitted` field on the job DTO.
8. **Impact:** the user believes the ledger is unchanged and re-imports; a second import of the same file duplicates every row (the entity says so, `import-job.entity.ts:105-112`). After a wipe-and-import the same copy hides that the wipe already ran.
9. **Root cause:** the job DTO omits `data_committed`, and `fail()` keeps the generic error key after commit, so the client has no signal to choose a different message.
10. **Recommended correction:** expose `dataCommitted` on the DTO and the client type; render a distinct message when `status === 'failed' && dataCommitted === true`; on the server, switch the error key to `mnyJobFailedAfterCommit` when `data_committed` is true.
11. **Suggested remediation diff (illustrative, not applied)**

```diff
--- a/backend/src/import/mny/dto/mny-import.dto.ts
+++ b/backend/src/import/mny/dto/mny-import.dto.ts
@@ class MnyImportJobDto
+  /** True once the import's write transaction committed; a failure after it is not "nothing saved". */
+  dataCommitted: boolean;
--- a/backend/src/import/mny/mny-import.controller.ts
+++ b/backend/src/import/mny/mny-import.controller.ts
@@ toJobDto
+    dataCommitted: job.dataCommitted,
--- a/frontend/src/lib/import-mny.ts
+++ b/frontend/src/lib/import-mny.ts
@@ export interface MnyImportJob {
+  /** Absent on an older backend: no information, so read `=== true`. */
+  dataCommitted?: boolean;
--- a/frontend/src/components/import/MnyImportProgress.tsx
+++ b/frontend/src/components/import/MnyImportProgress.tsx
@@ -50,5 +50,7 @@
           <p className="mt-1 text-sm text-red-700 dark:text-red-300">
-            {job.errorKey
+            {job.dataCommitted === true
+              ? t('mnyErrors.mnyImportFailedAfterCommit')
+              : job.errorKey
               ? t(`mnyErrors.${job.errorKey}`)
               : t('mnyErrors.mnyImportFailed')}
```

   (plus the new catalog key in every locale and the pseudo-locale regenerated).
12. **Recommended regression test:** `MnyImportProgress` with `{status: 'failed', errorKey: 'mnyImportFailed', dataCommitted: true}` must not contain "Nothing was saved"; a backend job test that throws in `verifyHoldings` and asserts `dataCommitted: true` on `GET /import/mny/jobs/:id`.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
--- a/frontend/src/components/import/MnyImportProgress.test.tsx
+++ b/frontend/src/components/import/MnyImportProgress.test.tsx
+    it('does not say nothing was saved once the rows committed', () => {
+      render(<MnyImportProgress {...defaultProps}
+        job={job({ status: 'failed', errorKey: 'mnyImportFailed', dataCommitted: true })} />);
+      expect(screen.queryByText(/Nothing was saved/)).not.toBeInTheDocument();
+    });
```

14. **Verification:** frontend `npm run test -- MnyImportProgress useMnyImport`; backend `npm run test:integration -- mny-import-job`.
15. **Residual risks:** the existing test at `:160-167` asserts the copy for `errorKey: null`, a state the backend cannot produce for a failed job; it is weak rather than wrong. Causality: `PRE_EXISTING_UNREPORTED`; client surface of the S09 hypothesis, distinct from A26-S09-01 (the replay), consolidate in S23 if the remediation lands in one PR.


### A26-H09 - A bank transaction whose entry reference the bank repeats on a later day is imported twice, or a later one is silently dropped (INV-BANKSYNC-001)

- **Canonical severity:** HIGH. kept HIGH: duplicate or missing ledger rows on an unattended sync path (executed on real PostgreSQL); confidence on frequency is medium and is stated.
- **Absorbs:** A26-S10-01 (primary, 10-rules-banksync-csv.md, session severity HIGH).
- **Invariants and prior findings named:** INV-BANKSYNC-001.
- **Lens:** financial.

#### A26-S10-01 (primary) - A bank transaction whose entry reference the bank repeats on a later day is imported twice, or a later one is silently dropped (INV-BANKSYNC-001)

1. **Severity:** HIGH
2. **Confidence:** high for the mechanism (executed); medium for frequency (it needs a bank that repeats `entry_reference`, which the spec and the code both say happens: Enable Banking FAQ, `bank-transaction-planner.ts:363-366`, `docs/specs/bank-sync.md` section 6).
3. **Location:** `backend/src/bank-sync/bank-transaction-planner.ts:381-413` (`resolveEntryReferences`: `contested` decided from the rows of this fetch only), `:544-551` (`keyFor`); `backend/src/bank-sync/bank-sync-writer.service.ts:355-370` (the claim keyed on that key); window overlap `docs/specs/bank-sync.md` section 7 (`last_success_at - 7 days`).
4. **Violated invariant:** INV-BANKSYNC-001: one provider transaction produces at most one row, across every sync; and its converse, a provider transaction is not lost.
5. **Reproduction (executed):** sync 1 fetches one booked row, reference `dup-9`, 5.00 debit; it is keyed `ref:dup-9` and imported. Three days later the bank books a second transaction (7.00, another counterparty) under the same reference; sync 2's window re-reads the week, so the fetch holds both rows. Both are now "contested" and keyed `ref:dup-9#<sha of content>`; neither equals `ref:dup-9`.
6. **Observed:** scratch integration case on real PostgreSQL (enforced RLS harness of `bank-sync.integration.spec.ts`): sync 2 returns `imported: 2, skipped: 0`; the account holds 3 rows; balance `983` = 1000 - 5 - 5 - 7. The planner probe gives `first=ref:R-1`, `second=["ref:R-1#638be0ba...","ref:R-1#6e56756a..."]`. The other direction: when the reuse arrives after the first row has left the window, the new row is alone in its fetch, keyed `ref:<reference>`, hits the first row's ledger entry, and is counted as `skipped` ("already imported"): a real bank transaction is never imported and nothing says so.
7. **Expected:** sync 2 `imported: 1, skipped: 1`, balance 988; a reused reference far apart in time imports as a new row.
8. **Impact:** financial: a duplicate expense or income of the full amount (here 5.00, 0.5 percent of the balance; any amount in practice), silently, in the account and in every report; or a missing transaction. An import rule then acts on the duplicate (a `convert_to_transfer` duplicates the counterpart in a second account; a `settle_loan_installment` settles a second slot, section 7). Recovery needs the user to notice and delete the row; deletion keeps the ledger row, so the duplicate does not come back.
9. **Root cause:** the key of a row depends on what else is in the same fetch. The discriminator is right for "two rows in one fetch", but the ledger keys earlier rows by the bare reference, and nothing relates the two forms across fetches.
10. **Recommended correction:** make a row's key a function of the row (and the ledger), never of its neighbours in the fetch: record the content signature with the ledger row and, when claiming a reference, compare against what the ledger already holds for that reference. A reference already held with the same signature is that row (skip); a reference held with another signature is a reuse (key the new row with its discriminator). Rows of the same reference within one fetch keep today's rule.
11. **Suggested remediation diff: incomplete** (illustrative, not applied). Supported part, against the baseline:

```diff
--- a/database/migrations/<UTC>_bank_sync_ledger_content_signature.sql
+++ b/database/migrations/<UTC>_bank_sync_ledger_content_signature.sql
+-- The content signature of the bank row a ledger entry claimed, so a repeated
+-- entry reference can be told apart from the row that first carried it.
+ALTER TABLE bank_sync_imported_transactions
+  ADD COLUMN IF NOT EXISTS content_signature VARCHAR(64);
--- a/backend/src/bank-sync/bank-transaction-planner.ts
+++ b/backend/src/bank-sync/bank-transaction-planner.ts
 export interface PlannedBankRow {
   externalKey: string;
+  /** `ref:<reference>` when the key is reference-based, else null. */
+  referenceKey: string | null;
+  /** SHA-256 of `contentSignature(row)`. */
+  contentSignature: string;
--- a/backend/src/bank-sync/bank-sync-writer.service.ts
+++ b/backend/src/bank-sync/bank-sync-writer.service.ts
       for (const row of plan.planned) {
         if (importKeys !== null && !importKeys.has(row.externalKey)) continue;
+        // A reference the ledger already holds for this very content is that
+        // row, whatever key the current fetch gives it (INV-BANKSYNC-001).
+        let key = row.externalKey;
+        if (row.referenceKey !== null) {
+          const held = returnedRows<{ content_signature: string | null }>(
+            await m.query(
+              `SELECT content_signature FROM bank_sync_imported_transactions
+                WHERE account_id = $1 AND external_key = $2`,
+              [accountId, row.referenceKey],
+            ),
+          );
+          if (held.length > 0) {
+            if (held[0].content_signature === row.contentSignature) {
+              skipped += 1;
+              continue;
+            }
+            key = `${row.referenceKey}#${row.contentSignature}`;
+          }
+        }
         const claimed = returnedRows<{ id: string }>(
           await m.query(
             `INSERT INTO bank_sync_imported_transactions
-               (user_id, account_id, external_key, booking_date)
-             VALUES ($1, $2, $3, $4)
+               (user_id, account_id, external_key, booking_date, content_signature)
+             VALUES ($1, $2, $3, $4, $5)
              ON CONFLICT (account_id, external_key) DO NOTHING
              RETURNING id`,
-            [userId, accountId, row.externalKey, row.transactionDate],
+            [userId, accountId, key, row.transactionDate, row.contentSignature],
           ),
         );
```

   Missing: the legacy ledger rows have `content_signature` NULL (a NULL held row must be treated as "same row" to stay safe against duplicates, which keeps the silent-loss direction for those rows until a backfill exists, and no backfill is possible without the bank's content); `schema.sql` and the entity must carry the column; the preview's `findLedgerKeys`/`newPlannedRows` and `planFingerprint` must apply the same rule, or the preview and the commit disagree; the exception path (`excluded_at`) needs the same comparison. Decision for the maintainer: whether the signature is the full `contentSignature` (dates included, so a bank that rewrites a booked row's value date re-keys it) or a narrower one (amount, currency, direction, booking date).
12. **Recommended regression test:** two syncs on real PostgreSQL: a lone reference, then the same row beside a second row under that reference; and the reverse, a reuse outside the window.
13. **Suggested regression-test diff (illustrative, not applied)**

```diff
--- a/backend/test/integration/bank-sync.integration.spec.ts
+++ b/backend/test/integration/bank-sync.integration.spec.ts
@@ describe("a second sync of the same rows (INV-BANKSYNC-001)", () => {
+    it("does not re-import a row when a later fetch repeats its entry reference", async () => {
+      const a = row({ entryReference: "dup-9", amount: "5.00" });
+      bankReturns([a]);
+      await sync();
+      const later = row({
+        entryReference: "dup-9",
+        amount: "7.00",
+        counterpartyName: "Kiosk",
+        bookingDate: daysAgo(1),
+      });
+      bankReturns([a, later]);
+      expect(await sync()).toMatchObject({ imported: 1, skipped: 1 });
+      expect(await count("transactions")).toBe(2);
+      expect(await storedBalance()).toBe(OPENING - 12);
+    });
+
+    it("imports a later transaction that reuses a reference no longer in the window", async () => {
+      bankReturns([row({ entryReference: "dup-8", amount: "5.00" })]);
+      await sync();
+      bankReturns([
+        row({ entryReference: "dup-8", amount: "7.00", counterpartyName: "Kiosk" }),
+      ]);
+      expect(await sync()).toMatchObject({ imported: 1, skipped: 0 });
+      expect(await storedBalance()).toBe(OPENING - 12);
+    });
```

   The first case fails at the baseline (`imported: 2`, executed); the second fails at the baseline by reading the code (the key is `ref:dup-8` in both fetches).
14. **Verification:** `npm run test:integration -- bank-sync`; `npm run test:unit -- bank-transaction-planner bank-sync-writer bank-sync-preview`; `scripts/verify-schema.sh` and `migration:lint` for the column.
15. **Residual risks:** the `hash:` form has its own documented flip (index Status); a bank that changes a booked row's content and reuses its reference at once defeats any signature.

Causality: `NEW_SINCE_UPSTREAM_AUDIT` (bank sync is new). Surfaces (Rule 7): the sync writer, the preview's duplicate column (`bank-sync-preview.service.ts`, `findLedgerKeys`), the exception ledger rows (`:328-343`). Execution evidence: `<scratchpad>/mut/backend/test/integration/bank-sync.integration.spec.ts` case "AUDIT-S10 probe" (failed as described), `<scratchpad>/mut/backend/src/bank-sync/audit-s10-key-probe.spec.ts`.


### A26-H10 - Built-in reports convert a missing exchange rate 1:1 and label the result in the reporting currency (MON-H12, MON-M39)

- **Canonical severity:** HIGH. kept HIGH: a foreign amount is reported as the same number in the reporting currency with no marker (executed); same class as upstream MON-H12.
- **Absorbs:** A26-S13-01 (primary, 13-valuation-fx-networth.md, session severity HIGH); A26-S02-02 (superseded, 02-prior-high-triage.md, session severity HIGH).
- **Invariants and prior findings named:** INV-FX-001, MON-H12, MON-M39.
- **Lens:** financial.

#### A26-S13-01 (primary) - Built-in reports convert a missing exchange rate 1:1 and label the result in the reporting currency (MON-H12 and MON-M39 still open; supersedes A26-S02-02)

1. **Severity:** HIGH
2. **Confidence:** high (executed, P2; the known-wrong unit test passes)
3. **Location:** `backend/src/built-in-reports/report-currency.service.ts:99-121` (`convertAmount` returns `amount` when `convertWithRateLookup` is null); `backend/src/common/currency-conversion.util.ts:20-22` (`!from` returns the amount as if same-currency). Call sites (20 in 13 methods, 7 services): `income-reports.service.ts:206`; `anomaly-reports.service.ts:111, 128, 221, 307, 317`; `monthly-category-breakdown.service.ts:167, 173, 315, 321`; `comparison-reports.service.ts:100, 106, 204`; `spending-reports.service.ts:329, 431`; `tax-recurring-reports.service.ts:202, 360, 555`; `data-quality-reports.service.ts:117, 197, 204` (row and summary labelled `currencyCode: defaultCurrency`, `:123`, `:219`). Allowlisted at `common/fx-fallback.guard.spec.ts:84-101`.
4. **Violated invariant:** INV-FX-001 (both clauses: no 1:1 value, no unconverted amount under the target label); `AGENTS.md` "Convert before summing", "A subtotal is not a total".
5. **Reproduction:** default currency USD, a JPY card with one expense of -100,000 JPY on 2026-09-15, no JPY rate stored. Call Spending by Payee and Uncategorized Transactions for September 2026 (HTTP, AI `generate_report`, MCP `generate_report`).
6. **Observed (executed, P2):** `{"data":[{"payeeName":"Shop","total":100000}],"totalSpending":100000}` and the data-quality row `{"amount":-100000,"currencyCode":"USD", ...}` with `summary.expenseTotal: 100000, currencyCode: "USD"`. No field says a currency was not converted. `report-currency.service.spec.ts:213` "returns original amount when no rate is available" asserts the defect and passes (S02 batch; re-run in section 12).
7. **Expected:** the figure converted (about 670 USD at 0.0067), or the total `null` with `knownSubtotal`, `missingCurrencies: ["JPY"]` and `excludedCount: 1`, as Spending by Category and Income vs Expenses already answer (`spending-reports.service.ts:196-263`).
8. **Impact:** +99,330 USD (about 14,800 percent) in the example; every report family named above, including the tax summary (`getTaxSummary`), year-over-year comparison and anomaly detection (a JPY row is a z-score outlier by the currency's unit), reaches the reader, the assistant and an MCP client as a settled figure. Spending anomalies are also called with `months` where the signature expects the z-score threshold (`ai/query/tool-executor.service.ts:2910-2913`, `mcp/tools/reports.tool.ts:86-89` versus `anomaly-reports.service.ts:37-39`); handed to S16/S17, not part of this finding.
9. **Root cause:** `convertAmount` has a `number` signature shared by seven services, so the null branch cannot be expressed; the guard allowlists the pass-through instead of failing it; `convertWithRateLookup` treats an empty source code as the reporting currency.
10. **Recommended correction:** return `number | null` from `convertAmount` (or delete it in favour of `tryConvertAmount`), accumulate every report total through `FxAggregate`, give each report DTO `missingCurrencies` and `excludedCount` as the two converted families do, drop the allowlist entry, and make `!from` unknown.
11. **Suggested remediation diff: incomplete.** Supported part:

```diff
--- a/backend/src/built-in-reports/report-currency.service.ts
+++ b/backend/src/built-in-reports/report-currency.service.ts
@@ -99,23 +99,11 @@
-  convertAmount(
-    amount: number,
-    fromCurrency: string,
-    defaultCurrency: string,
-    rateMap: RateMap,
-  ): number {
-    // Flat latest-rate lookup; the direct/inverse decision is shared with
-    // net worth via convertWithRateLookup so the two surfaces stay consistent.
-    const result = convertWithRateLookup(
-      amount,
-      fromCurrency,
-      defaultCurrency,
-      (f, t) => rateMap.get(`${f}->${t}`),
-    );
-    if (result == null) {
-      // M30: Log warning when no conversion rate is found instead of silently returning unconverted amount
-      this.logger.warn(
-        `No exchange rate found for ${fromCurrency} -> ${defaultCurrency}, returning unconverted amount`,
-      );
-      return amount;
-    }
-    return result;
-  }
+  // convertAmount is removed: every caller takes tryConvertAmount, excludes a
+  // row it cannot convert and reports it (INV-FX-001).
--- a/backend/src/common/currency-conversion.util.ts
+++ b/backend/src/common/currency-conversion.util.ts
@@ -20,3 +20,6 @@
-  if (!from || from === to) {
+  // An empty code is not the reporting currency; it is unknown.
+  if (!from || !to) return null;
+  if (from === to) {
     return amount;
   }
--- a/backend/src/common/fx-fallback.guard.spec.ts
+++ b/backend/src/common/fx-fallback.guard.spec.ts
-  const RETURNS_ITS_INPUT_UNCONVERTED = [ { file: "built-in-reports/report-currency.service.ts", ... } ];
+  const RETURNS_ITS_INPUT_UNCONVERTED: ReadonlyArray<{ file: string; reason: string }> = [];
```

   Missing: each of the 20 call sites moves to `tryConvertAmount` plus `FxAggregate` (the pattern at `spending-reports.service.ts:196-263`), each report DTO and frontend view gains the partial state, and the MCP output schemas (`mcp/tool-output-schemas.ts:197-213`) declare the fields. The per-report policy (exclude the row, or withhold the report) is the maintainer's decision; the empty-code change needs a check that no caller passes an empty code for a real same-currency row (the `report` spec named by S02).
12. **Recommended regression test:** per report family, one account in a currency with no rate: total `null`, known subtotal set, `missingCurrencies` names it; a source scan that no file under `built-in-reports/` calls `convertAmount`.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
--- a/backend/src/built-in-reports/report-currency.service.spec.ts
+++ b/backend/src/built-in-reports/report-currency.service.spec.ts
-    it("returns original amount when no rate is available", () => {
+    it("answers null, never the input, when no rate is available (INV-FX-001)", () => {
       const result = service.tryConvertAmount(1000, "JPY", "USD", new Map());
-      expect(result).toBe(1000);
+      expect(result).toBeNull();
     });
+--- a/backend/src/built-in-reports/spending-reports.service.spec.ts
++  it("withholds Spending by Payee when a JPY row has no rate", async () => {
++    // one -100000 JPY row, default USD, empty rate map
++    const res = await service.getSpendingByPayee(userId, "2026-09-01", "2026-09-30");
++    expect(res.totalSpending).toBeNull();
++    expect(res.missingCurrencies).toEqual(["JPY"]);
++  });
```

14. **Verification:** `npm run test:unit -- report-currency built-in-reports fx-fallback.guard`; P2 re-run must show `totalSpending: null`; the report views (S20).
15. **Residual risks:** the rate the reports convert at is the unbounded latest rate in a direct-first map (A26-S13-02); fixing the 1:1 half alone leaves those figures valid-looking and wrong.

- Causality: `PRIOR_REPORTED`, `CONFIRMED` (MON-H12 on the reports surface, MON-M39's wrong test relocated). Supersedes A26-S02-02 (same root cause, surfaces extended to AI/MCP and the empty-code branch).
- Surfaces (Rule 7): HTTP built-in reports (7 services), AI `generate_report` (`tool-executor.service.ts:2910-2980`), MCP `generate_report` (`reports.tool.ts:86-143`); no email, notification or export consumer exists (searched).

#### A26-S02-02 (superseded) - Built-in reports convert a missing exchange rate 1:1 and label it in the reporting currency (MON-H12 still open on the reports surface; MON-M39's wrong test relocated)

Superseded by the primary above: same root cause, and its scenario is one surface of the primary's reproduction. Full text: `02-prior-high-triage.md` section 4.


### A26-H11 - A rate for a date is not the resolver's: the latest-rate readers use a frozen pre-1.17 mirror row and a rate of any age, and back-dated trades settle or prefill at the newest rate (INV-FX-001, INV-FX-003)

- **Canonical severity:** HIGH. HIGH for the group: S13 executed a 30 % wrong report total from the frozen mirror row; the three MEDIUM surfaces (server trade settlement, client prefill, client conversion of any age) violate the same invariant from the same missing call to `resolveFxRate` and are absorbed, their own MEDIUM ratings unchanged as surface ratings.
- **Absorbs:** A26-S13-02 (primary, 13-valuation-fx-networth.md, session severity HIGH); A26-S12-02 (merged surface, 12-securities-holdings.md, session severity MEDIUM); A26-S19-04 (merged surface, 19-frontend-forms.md, session severity MEDIUM); A26-S18-04 (merged surface, 18-frontend-core.md, session severity MEDIUM).
- **Invariants and prior findings named:** INV-FX-003, INV-FX-001, MON-H14.
- **Lens:** financial.

#### A26-S13-02 (primary) - Direct-first readers of the latest-rate table use a frozen pre-1.17 mirror row and a rate of any age (INV-FX-003 expand window, INV-FX-001 age clause)

1. **Severity:** HIGH
2. **Confidence:** high for the behaviour (executed, P3, P3b); medium for the severity, which grows with the time since a deployment upgraded to 1.17.0 and with the currency's move since.
3. **Location:** `backend/src/currencies/exchange-rate.service.ts:916-927` (`getLatestRates`: `DISTINCT ON (from, to)`, newest per stored direction, no age bound), served by `currencies.controller.ts:137-147`; readers that try the direct key first: `frontend/src/hooks/useExchangeRates.ts:79-101` (`convert`), `:111-120` (`getRate`), `:159-178` (`convertWithRateMap`), `backend/src/built-in-reports/report-currency.service.ts:64-121` through `common/currency-conversion.util.ts:28-36`.
4. **Violated invariant:** INV-FX-003 ("resolveFxRate answers with the more recently observed direction ... an old direct row must not block a fresh inverse one", `fx-rate-resolver.ts:23-25`); INV-FX-001 ("nor by one older than FX_MAX_RATE_AGE_DAYS"); `docs/time-series-contract.md` section 2.1 (a `DISTINCT ON` newest read with no lower bound used in a reported figure).
5. **Reproduction:** a deployment that ran a release before 1.17.0 stored every fetched pair twice (`docs/specs/exchange-rate-canonical-orientation.md` section 1). From 1.17.0 the refresh writes only the canonical orientation (`from < to`), so for a user whose reporting currency sorts before the foreign code (CAD with USD, EUR with USD/GBP/PLN, PLN with USD) the direction the readers ask first (`USD->CAD`) stops updating at the upgrade, while `CAD->USD` is refreshed daily. Scripted: `USD->CAD 1.3000` and `CAD->USD 0.7142857143` on 2026-08-01, `CAD->USD 0.7142857143` (1.4000) today; default CAD, a USD expense of -1,000.00 in September.
6. **Observed (executed, P3):** `getLatestRate("USD","CAD")` = 1.399999999972 (the resolver picks today's inverse row); `getLatestRates()` returns `[CAD->USD 2026-10-21, USD->CAD 2026-08-01]`; Spending by Payee answers `totalSpending: 1300`. The frontend `convert(1000, "USD", "CAD")` over the same endpoint returns 1,300.00 by the same direct-first rule (`useExchangeRates.ts:85-86`). P3b: with only a `CAD->USD 0.8` row dated 2025-12-01 (324 days old), the report answers 1,250.00 as a current figure.
7. **Expected:** one answer per pair, the one `resolveFxRate` gives (1,400.00 CAD); a pair whose newest observation is older than 45 days is unknown (P3b: `null` and the pair named).
8. **Impact:** every client-side conversion (accounts page and account-group totals, investments holdings and portfolio card rate lines, currency exposure, currency list, security summary) and every built-in report converts at the upgrade-day rate for about half the pairs, forever, until the contract migration of INV-FX-003 ships (which the spec says cannot ship until the expand release is everywhere). In the example -100.00 CAD (7.1 percent) on 1,000 USD; on a 100,000 USD portfolio a 3 percent move since the upgrade is 3,000 CAD, and the server-side portfolio summary on the same screen (resolver) shows the other figure. The embedded investment split prefills `exchangeRate` from `getRate` (`frontend/src/components/transactions/InvestmentSplitFields.tsx:118-140`), so the frozen rate can be sent as the trade's own settlement rate (persisted path handed to S19 for confirmation). P3b's stale branch also applies to a pair whose refresh silently stopped (a provider dropped the pair).
9. **Root cause:** the expand release made writers canonical and assumed every reader was inverse-aware (spec section 8: "already fall back to the inverse key, so receiving one orientation per pair needs no change"); the readers are inverse-aware only when the direct key is absent, and `getLatestRates` hands them both orientations with different dates and no age bound. The one-door guard exempts the method by design ("the plural admin listing is a list, not a value-for-a-date", `common/time-series/fx-rate.one-door.spec.ts:16-19, 242-245`), while it is the rate source of every built-in report and every client-side conversion.
10. **Recommended correction:** make `getLatestRates` answer one row per directionless pair through `resolveFxRate` in `live` mode (newest admissible direction, 45-day bound, canonical orientation in the payload), so the client and the report map receive one orientation and no stale row; give the frontend `convert` the same rule (prefer the newer of the two keys) as a defence while old clients are served.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/currencies/exchange-rate.service.ts
+++ b/backend/src/currencies/exchange-rate.service.ts
@@ -913,15 +913,38 @@
   /**
-   * Get the latest exchange rates (most recent per currency pair)
+   * The current rate per pair, one row per directionless pair, in canonical
+   * orientation: the newer of the two stored directions inside the age bound
+   * (resolveFxRate, live mode). Both orientations used to be returned with
+   * their own dates, and every direct-first reader took a mirror row frozen at
+   * the 1.17.0 upgrade over today's canonical row (INV-FX-003).
    */
   async getLatestRates(): Promise<ExchangeRate[]> {
-    return withScopedDb(this.dataSource, (manager) =>
+    const today = todayYMD();
+    const rows = await withScopedDb(this.dataSource, (manager) =>
       manager
         .getRepository(ExchangeRate)
         .createQueryBuilder("er")
         .distinctOn(["er.from_currency", "er.to_currency"])
+        .where("er.rate_date >= :floor", {
+          floor: addDaysYMD(today, -FX_MAX_RATE_AGE_DAYS),
+        })
         .orderBy("er.from_currency")
         .addOrderBy("er.to_currency")
         .addOrderBy("er.rate_date", "DESC")
         .getMany(),
     );
+    const byPair = new Map<string, ExchangeRate>();
+    for (const row of rows) {
+      const key = directionlessPairKey(row.fromCurrency, row.toCurrency);
+      const held = byPair.get(key);
+      if (!held || String(row.rateDate) > String(held.rateDate)) {
+        byPair.set(key, row);
+      }
+    }
+    return [...byPair.values()];
   }
```

   Needs: `directionlessPairKey` from `canonical-rate.util.ts`, the controller's Swagger text, a tie rule identical to the resolver's (direct wins a tie, so the canonical row should be returned when both share a date), and the frontend `convert` change for clients cached before the deploy.
12. **Recommended regression test:** an integration case with a stale mirror row and a fresh canonical row asserting one row per pair carrying the fresh rate; a report case asserting 1,400.00; a row older than 45 days absent from the payload.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+  it("returns one current row per pair, never a frozen mirror (INV-FX-003)", async () => {
+    await insertRates([
+      ["USD", "CAD", 1.3, "2026-08-01"],
+      ["CAD", "USD", 0.7142857143, "2026-08-01"],
+      ["CAD", "USD", 0.7142857143, todayYMD()],
+    ]);
+    const rows = await fx.getLatestRates();
+    expect(rows).toHaveLength(1);
+    expect(rows[0]).toMatchObject({ fromCurrency: "CAD", toCurrency: "USD" });
+  });
```

14. **Verification:** P3 and P3b re-run; `npm run test:unit -- exchange-rate useExchangeRates report-currency`; a frontend test of `convert` with both keys present.
15. **Residual risks:** the built-in reports still convert a past period at today's rate (a deliberate "flat latest-rate lookup", `report-currency.service.ts:105`), which is the look-ahead clause of INV-FX-001 for every historical bucket; that is a policy the maintainer has to state (section 9). The persisted-rate path through the investment split is S19's to confirm.

- Causality: `NEW_SINCE_UPSTREAM_AUDIT` (the canonical orientation shipped in 1.17.0, after `d5cea9bf`); the age half is `PRE_EXISTING_UNREPORTED` on the client.
- Surfaces (Rule 7): frontend `useExchangeRates` (`convert`, `getRate`, `convertWithRateMap`), built-in reports (A26-S13-01's call sites, also `tryConvertAmount` in the two converted families), `GET /currencies/exchange-rates` for any API client.

#### A26-S12-02 (merged surface) - A back-dated cross-currency trade with no rate near its date settles at the newest rate, struck after it (MON-H14 residual, server half)

1. **Severity:** MEDIUM
2. **Confidence:** high (executed, P3)
3. **Location:** `backend/src/securities/investment-transactions.service.ts:780-793` (`getRateForDate` then `getLatestRate(sourceCurrency, cashCurrency)` with no `maxAgeDays`); consumers: `create` `:1216-1223`, `previewCreateInvestmentTransaction` `:1780-1787`, `update` `:4720-4727`, the forecast through `resolveCashExchangeRateOrNull` (the scheduled path), bulk, AI and MCP through `create`.
4. **Violated invariant:** INV-FX-001 ("never one struck after it and never an unboundedly old one; null otherwise"); `backend/CLAUDE.md` "A rate for a date: `resolveFxRate` ... never `getLatestRate`".
5. **Reproduction:** CAD brokerage and CAD funding account, USD security; `exchange_rates` holds only today's USD/CAD 1.37. `create` a BUY of 100 @ 100.00 dated 1990-01-02 with no `exchangeRate` (MCP, AI, bulk paste, or an API client). `getRateForDate` finds nothing within 45 days and the provider window answers nothing (USDCAD history begins December 2003, `docs/backend/securities-and-providers.md`), so it returns null; the fallback returns today's 1.37.
6. **Observed (executed):** the row stores `exchange_rate` 1.3700000000 and the cash leg -13,700.00 CAD. The preview carries `exchangeRate` but no field saying which rate answered (trade date, latest, or supplied).
7. **Expected:** refused with `errors.securities.exchangeRateUnavailable`, as the code's own comment at `:674-677` and `:694-711` intends, so the caller supplies the settlement rate.
8. **Impact:** a cash balance off by the currency move between the trade date and today: if the trade settled at 1.16 (an illustrative 1990 rate), 13,700.00 versus 11,600.00 CAD, 2,100.00 CAD (18.1 percent), and the same error in every cost basis and realized gain read from the row's rate (INV-FX-002 makes the wrong rate authoritative everywhere). Also reachable for any date while the FX provider is down and the stored history has a gap over 45 days.
9. **Root cause:** a secondary "latest snapshot" fallback (precedence item 3 in the comment at `:666-672`) left in after `getRateForDate` gained its own age-bounded resolution and provider fill.
10. **Recommended correction:** drop the `getLatestRate` fallback in `resolveCashExchangeRateOrNull`; a null then throws in the posting variant and stays unknown in the forecast variant, which is the documented behaviour. Disclose the rate's basis in the preview (`exchangeRateSource: "supplied" | "trade_date" | "same_currency"`).
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/securities/investment-transactions.service.ts
+++ b/backend/src/securities/investment-transactions.service.ts
@@ -778,19 +778,13 @@
-    // Prefer the rate as of the transaction date (fetching from Yahoo for that
-    // date when not already stored); fall back to the latest stored snapshot.
-    let rate: number | null = null;
-    if (transactionDate) {
-      rate = await this.exchangeRateService.getRateForDate(
-        sourceCurrency,
-        cashCurrency,
-        transactionDate,
-      );
-    }
-    if (rate === null) {
-      rate = await this.exchangeRateService.getLatestRate(
-        sourceCurrency,
-        cashCurrency,
-      );
-    }
+    // The rate as of the transaction date, under INV-FX-001 (resolveFxRate's
+    // 45-day bound, with a provider window fill). Nothing newer than the date
+    // and nothing unboundedly old: unknown is refused by the posting variant.
+    const rate = await this.exchangeRateService.getRateForDate(
+      sourceCurrency,
+      cashCurrency,
+      transactionDate ?? todayYMD(),
+    );
```

Needs: the unit cases that assert the latest-rate fallback updated (`investment-transactions.service.spec.ts`, search `getLatestRate`), and a check of the scheduled-investment forecast, which then shows such an occurrence as unknown rather than at today's rate.

12. **Recommended regression test:** an integration case with only a current stored rate and a trade dated outside the 45-day window, asserting a 400 and no row written; a unit case asserting `getLatestRate` is never called by the posting path.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+  it("refuses a back-dated cross-currency trade with no admissible rate", async () => {
+    await seedRate("CAD", "USD", 1 / 1.37, today);
+    await expect(
+      as(() => investments.create(userId, { ...buyUsdInCad, transactionDate: "1990-01-02" })),
+    ).rejects.toThrow(/exchange rate/i);
+    expect(await countRows("investment_transactions")).toBe(0);
+  });
```

14. **Verification:** P3 refused after the fix; `npm run test:unit -- investment-transactions`.
15. **Residual risks:** the client half (the form's own rate field) is S19's; the preview-source disclosure is a contract decision.

- Causality: `PRIOR_REPORTED` MON-H14, `CONFIRMED_WITH_DIFFERENT_ROOT_CAUSE` (S02 found the preview/commit pair aligned; the residual is that both align on a rate INV-FX-001 forbids).

#### A26-S19-04 (merged surface) - The investment form and the embedded investment split prefill the undated latest rate and send it as explicit, so a back-dated trade commits today's rate (MON-H14 client half, A26-S13-02 persisted path)

1. **Severity:** MEDIUM
2. **Confidence:** high (executed: P4; the server half by reading)
3. **Location:** `frontend/src/components/investments/InvestmentTransactionForm.tsx:613-664` (the fill effect depends on the pair only, `getMarketRate(transactionCurrency, cashCurrency)`), `:1192-1195` (the rate is always sent); `frontend/src/components/transactions/InvestmentSplitFields.tsx:118-140` (same `getRate`, carried as `exchangeRate`); `frontend/src/hooks/useExchangeRates.ts:113-140` (`getRate(from, to)`, no date); server `backend/src/securities/investment-transactions.service.ts:772-774` (a supplied rate wins over the dated lookup at `:778-792`) and `:2744-2780` (the embedded split converts at the supplied rate).
4. **Violated invariant:** INV-FX-001: a rate for a date is the newest observation on or before the date, never one struck after it.
5. **Reproduction:** a CAD brokerage and a USD security; the user records a BUY dated 2025-01-02 today (2026-10-21).
6. **Observed (executed, P4):** the rate field fills 1.350000 from `getRate('USD', 'CAD')` (the latest; the only call recorded); the payload carries `transactionDate: '2025-01-02', exchangeRate: 1.35`; the server keeps it, so its own dated resolution never runs.
7. **Expected:** the form asks for the rate on the trade date (`exchangeRatesApi.getRateForDate`, already used by `TransactionForm.tsx:986`) and asks again when the date changes, or omits the rate and lets the server resolve and disclose it.
8. **Impact:** every back-dated cross-currency trade, every historical trade re-entered by hand, and every embedded investment split. Numerical (illustrative rates): 10 x 100.00 USD, rate on 2025-01-02 1.4389, latest 1.3700; committed 1,370.00 CAD against 1,438.90 CAD, -68.90 CAD (-4.8 %) on the cash balance and on the cost basis in CAD. With A26-S13-02's frozen upgrade-day rows the "latest" may itself be stale. The rate is visible and editable, and the help line asks the user to match the posted amount, which is why this is MEDIUM rather than HIGH.
9. **Root cause:** the only rate source the form uses has no date parameter; the server treats any supplied rate as the user's statement.
10. **Recommended correction:** fetch the dated rate in the form (keyed on pair and date, the answer kept with its request key per `docs/frontend/api-and-cache.md`) and keep a "rate edited by the user" flag, as the foreign-entry panel of `TransactionForm` does.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/frontend/src/components/investments/InvestmentTransactionForm.tsx
+++ b/frontend/src/components/investments/InvestmentTransactionForm.tsx
@@ -635,16 +635,24 @@
     if (watchedExchangeRate && watchedExchangeRate !== 1) {
       return;
     }
-    const marketRate = getMarketRate(transactionCurrency, cashCurrency);
-    if (marketRate && marketRate !== 1) {
-      setValue('exchangeRate', roundFxRate(marketRate), {
-        shouldDirty: false,
-      });
-      return;
-    }
+    let cancelled = false;
+    exchangeRatesApi
+      .getRateForDate(transactionCurrency, cashCurrency, watchedTransactionDate)
+      .then((rate) => {
+        if (cancelled) return;
+        setValue('exchangeRate', rate && rate > 0 ? roundFxRate(rate) : 0, { shouldDirty: false });
+      })
+      .catch(() => {
+        if (!cancelled) setValue('exchangeRate', 0, { shouldDirty: false });
+      });
+    return () => {
+      cancelled = true;
+    };
-  }, [securitiesLoaded, needsConversion, transactionCurrency, cashCurrency, getMarketRate, setValue, watchedExchangeRate]);
+  }, [securitiesLoaded, needsConversion, transactionCurrency, cashCurrency, watchedTransactionDate, setValue, watchedExchangeRate]);
```

(the "user edited the rate" flag must stop a date change from replacing a typed rate; the embedded split needs the parent's date passed in; `exchangeRatesApi` is imported from `@/lib/exchange-rates`).

12. **Recommended regression test:** a BUY dated 2025-01-02 asks `getRateForDate('USD', 'CAD', '2025-01-02')` and sends its answer; a date change asks again unless the user typed a rate.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
--- a/frontend/src/components/investments/InvestmentTransactionForm.test.tsx
+++ b/frontend/src/components/investments/InvestmentTransactionForm.test.tsx
@@ -1329,3 +1329,4 @@
-    it('auto-fills the exchange rate with the latest market rate', async () => {
+    it('fills the exchange rate for the trade date, not the latest', async () => {
+      getRateForDateMock.mockResolvedValue(1.4389);
       getMarketRateMock.mockReturnValue(1.365);
@@
-        expect(Number(rateInput.value)).toBeCloseTo(1.365, 3);
+        expect(getRateForDateMock).toHaveBeenCalledWith('USD', 'CAD', expect.any(String));
+        expect(Number(rateInput.value)).toBeCloseTo(1.4389, 4);
```

(`getRateForDateMock` is a new mock of `exchangeRatesApi.getRateForDate`).

14. **Verification method:** P4 re-run must show the dated rate in the payload; S12's A26-S12-02 (the server's fallback to the latest rate) is a separate fix.
15. **Residual risks:** a dated lookup can fail or find nothing; the form must then show the unresolved state (it already blocks the commit, `:1144-1151`) rather than fall back to the latest. Causality: `PRIOR_REPORTED` MON-H14 (client half), `CONFIRMED_WITH_DIFFERENT_ROOT_CAUSE`: the preview-versus-commit divergence is fixed (the previewed rate is the committed one); the rate itself is undated. Rule 7 surfaces: investment form, embedded investment split (A26-S13-02's persisted path, confirmed).

#### A26-S18-04 (merged surface) - The client converts at a rate of any age (INV-FX-001 client half)

1. **Severity:** MEDIUM
2. **Confidence:** high (executed, P7)
3. **Location:** `frontend/src/hooks/useExchangeRates.ts:66-123` (`rateMap` from `r.rate` only; `convert`/`getRate` never read `rateDate`); producer `backend/src/currencies/exchange-rate.service.ts:916-927` (`getLatestRates`, newest row per pair, no bound); `FX_MAX_RATE_AGE_DAYS = 45` (`backend/src/common/time-series/fx-rate-resolver.ts:102`); `convertWithRateMap` (`useExchangeRates.ts:162-178`) the same for the historical map.
4. **Violated invariant:** INV-FX-001 "nor by one older than FX_MAX_RATE_AGE_DAYS".
5. **Reproduction:** a CHF account of 100 000.00 CHF; the CHF->USD pair was last stored 2020-03-01 at 1.13 (provider stopped quoting it, or a manual rate); today's rate 1.25.
6. **Observed (P7):** `convert(100000, 'CHF', 'USD')` returns 113 000; `getRate` returns 1.13. Every client-side aggregate built on it (`sumConverted` on the accounts page, the foreign-account view of `PortfolioSummaryCard`, the calendar and budget conversions) reports a complete figure; the server's resolver for the same pair answers unknown.
7. **Expected:** `null` for an observation older than 45 days, so `sumConverted` reports the total partial and names the pair, as the server does.
8. **Impact:** 12 000.00 USD understated here (9.6 %), silently, and the client and server disagree on the same account's converted balance.
9. **Root cause:** the age half of INV-FX-001 was added to the server's one door (`resolveFxRate`) and to the `fx-rate.one-door.spec.ts` guard, whose scope is `backend/src`; the client is a second "newest rate" reader outside the door and was not migrated (Calibration Rule 4).
10. **Recommended correction:** the client applies the same bound: drop from `rateMap` any row whose `rateDate` is older than the bound (a shared constant mirrored from the backend and held by a contract test), and report the pair missing.
11. **Suggested remediation diff (illustrative, not applied)**

```diff
--- a/frontend/src/hooks/useExchangeRates.ts
+++ b/frontend/src/hooks/useExchangeRates.ts
@@ -64,9 +64,14 @@
   // Build a lookup map: "USD->CAD" => 1.365
+  // A rate older than the server's bound is not a rate for today
+  // (INV-FX-001, FX_MAX_RATE_AGE_DAYS); leaving it out makes convert() null.
+  const today = financialTodayYmd();
   const rateMap = useMemo(() => {
     const map = new Map<string, number>();
     rates.forEach((r) => {
+      if (daysBetweenYmd(r.rateDate, today) > FX_MAX_RATE_AGE_DAYS) return;
       map.set(`${r.fromCurrency}->${r.toCurrency}`, Number(r.rate));
     });
     return map;
-  }, [rates]);
+  }, [rates, today]);
```

   `FX_MAX_RATE_AGE_DAYS` and `daysBetweenYmd` would be new client exports; the constant needs a contract test against `fx-rate-resolver.ts`.
12. **Recommended regression test:** `useExchangeRates` fed a 2020 row returns `null`; a 10-day-old row converts.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
--- a/frontend/src/hooks/useExchangeRates.test.ts
+++ b/frontend/src/hooks/useExchangeRates.test.ts
+  it('refuses a rate older than FX_MAX_RATE_AGE_DAYS', async () => {
+    vi.mocked(exchangeRatesApi.getLatestRates).mockResolvedValue([
+      { id: 1, fromCurrency: 'CHF', toCurrency: 'USD', rate: 1.13, rateDate: '2020-03-01', source: 'manual' },
+    ]);
+    const { result } = renderHook(() => useExchangeRates());
+    await act(async () => {});
+    expect(result.current.convert(100000, 'CHF', 'USD')).toBeNull();
+  });
```

14. **Verification:** `npm run test -- useExchangeRates currency-total accounts/page`.
15. **Residual risks:** the "Currencies" screen must still show the old rate (it is a stored fact) while conversions refuse it; a missing-pair message must say "stale since 2020-03-01", not "missing" (`docs/financial-calculation-contract.md` 1.3). `docs/system-invariants.md` INV-FX-001 lists only the built-in reports as a known gap (section 11). Causality: `PRE_EXISTING_UNREPORTED` (the bound postdates the client path; the client was never migrated).


### A26-H12 - Totals sum amounts of different currencies without conversion: budget actuals, the custom report engine and the AI/MCP transaction analytics

- **Canonical severity:** HIGH. HIGH for the group (convert before summing): S16 executed a budget at 2 040 % used from one foreign row; the custom-report and AI/MCP surfaces (MEDIUM in their sessions) share the root and are absorbed.
- **Absorbs:** A26-S16-01 (primary, 16-budgets-reports.md, session severity HIGH); A26-S16-06 (merged surface, 16-budgets-reports.md, session severity MEDIUM); A26-S17-01 (merged surface, 17-ai-mcp-notifications.md, session severity MEDIUM).
- **Invariants and prior findings named:** INV-FX-001.
- **Lens:** financial.

#### A26-S16-01 (primary) - Budget actuals sum transactions of every currency into the budget's currency without conversion

1. **Severity:** HIGH
2. **Confidence:** high (executed, P1)
3. **Location:** `backend/src/budgets/budget-spending.util.ts:124-155` (category actuals), `:179-192` (transfer actuals); `budget-period.service.ts:355-397, 419-454` (period close); `budgets.service.ts:1031-1085` (`computeActualIncome`); the same raw sums in `budget-trend-reports.service.ts`, `budget-health-reports.service.ts`, `budget-activity-reports.service.ts`, `budget-generator.service.ts` (none of them reads `currency_code`). Contrast `budgets.service.ts:572-592`, where bills are converted into `budget.currencyCode`.
4. **Violated invariant:** AGENTS.md "Convert before summing"; "A subtotal is not a total"; INV-FX-001 (rate 1 means same currency).
5. **Reproduction (executed):** CAD budget, Groceries line 500.00. A CAD account with -200.00 and a JPY account with -10 000 JPY in Groceries, both in October 2026. `BudgetsService.getSummary`.
6. **Observed:** `totalSpent = 10200`, category `spent = 10200`, `percentUsed = 2040` (probe P1 output `{"totalSpent":10200,"cat":[[10200,2040]]}`).
7. **Expected:** 200.00 + 10 000 x 0.0090 = 290.00 CAD (58 percent), or the figure withheld with the missing JPY->CAD pair named.
8. **Impact:** difference +9 910.00 CAD (+3 417 percent). The same figure drives the OVER_BUDGET / THRESHOLD_CRITICAL alert and its immediate email, the weekly digest, the AI and MCP `get_budget_status` answers, the persisted closed-period `actual_amount` (never recomputed) and its rollover, the budget reports and the generator's suggested amounts. Any user with a foreign-currency card or account in a budgeted category is affected; the screen labels the figure in the budget's currency.
9. **Root cause:** the actuals queries `SUM(amount)` without `GROUP BY currency_code` and the service never consults a rate; the bill path was converted (issue #1247) and the actuals path was not.
10. **Recommended correction:** group every actuals query by `t.currency_code`, convert each (category, currency) total into `budget.currencyCode` through the same `memoizedRateResolver` the bill path uses (or a period-end `resolveFxRate`), aggregate through `FxAggregate`, and give each category line `spent: number | null` plus `missingCurrencies`; the alert path must skip a line whose `spent` is `null`.
11. **Suggested remediation diff: incomplete** (supported part; the rate date, per transaction or period end, is the maintainer's decision):

```diff
--- a/backend/src/budgets/budget-spending.util.ts
+++ b/backend/src/budgets/budget-spending.util.ts
@@ -124,7 +124,8 @@ export async function queryCategorySpending(
     const directRows = await transactionsRepository
       .createQueryBuilder("t")
       .select("t.category_id", "categoryId")
+      .addSelect("t.currency_code", "currencyCode")
       .addSelect("COALESCE(SUM(t.amount), 0)", "total")
@@
-      .groupBy("t.category_id")
+      .groupBy("t.category_id")
+      .addGroupBy("t.currency_code")
       .getRawMany();
-    for (const row of directRows) {
-      spendingMap.set(row.categoryId, parseFloat(row.total || "0"));
-    }
+    // Each (category, currency) row is converted by the caller-supplied
+    // resolver into the budget's currency through FxAggregate; a missing
+    // pair makes that category's spent null, never the raw figure.
```

   Missing: the same change in the split half, `computePeriodActuals` (better: make it call `queryCategorySpending` instead of its own copy), `computeActualIncome`, the four report services and the generator; `resolveCategorySpent` returning `number | null`; the DTOs and `frontend/src/types/budget.ts` carrying the completeness; `BudgetAlertService` skipping unknown lines.
12. **Recommended regression test:** the P1 scenario against PostgreSQL with a stored JPY->CAD rate (spent 290.00) and without one (spent `null`, `missingCurrencies: ["JPY"]`, no OVER_BUDGET alert).
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
--- /dev/null
+++ b/backend/test/integration/budget-multi-currency-actuals.integration.spec.ts
+it("converts a JPY expense into a CAD budget before summing", async () => {
+  await insertRate("JPY", "CAD", "2026-10-01", 0.009);
+  await tx(cadId, "CAD", "2026-10-05", -200);
+  await tx(jpyId, "JPY", "2026-10-06", -10000);
+  const s = await withUserContext(userId, () => budgets.getSummary(userId, budgetId));
+  expect(s.categoryBreakdown[0].spent).toBe(290);
+});
+it("withholds spent when no JPY->CAD rate exists", async () => {
+  await tx(jpyId, "JPY", "2026-10-06", -10000);
+  const s = await withUserContext(userId, () => budgets.getSummary(userId, budgetId));
+  expect(s.categoryBreakdown[0].spent).toBeNull();
+});
```

14. **Verification:** `npm run test:unit -- budget`, the new integration spec, `npm run test:integration -- budget`; frontend budget views rendering `null`.
15. **Residual risks:** the diff does not decide the rate date; closed periods already persisted keep their wrong `actual_amount` (a one-off recompute is a separate decision).

Causality: `PRE_EXISTING_UNREPORTED`. Surfaces (Rule 7): budget page, dashboard budget widget, transaction-form category status, AI, MCP, alerts and emails, period close, budget reports, generator.

#### A26-S16-06 (merged surface) - The custom report engine sums amounts of every currency with no conversion

1. **Severity:** MEDIUM
2. **Confidence:** high (static: `reports.service.ts` contains no rate, currency or conversion reference)
3. **Location:** `backend/src/reports/reports.service.ts:849-1170` (every aggregator sums `amount` regardless of `currencyCode`).
4. **Violated invariant:** "Convert before summing"; INV-FX-001.
5. **Reproduction:** the A26-S16-01 data (200.00 CAD + 10 000 JPY in Groceries) in a custom report by category.
6. **Observed (by reading):** Groceries 10 200.
7. **Expected:** 290.00 in the reporting currency, or a withheld total naming JPY.
8. **Impact:** +9 910.00 (+3 417 percent) in the example; percentages of the total are distorted for every other group.
9. **Root cause:** the engine aggregates hydrated entities in TypeScript and never consults `ReportCurrencyService`.
10. **Recommended correction:** convert each row with `ReportCurrencyService.tryConvertAmount` and aggregate through `FxAggregate`, returning `missingCurrencies` and a `null` total when incomplete.
11. **Suggested remediation diff: incomplete.** Supported part: inject `ReportCurrencyService`, build the rate map once per execution, replace each `existing.sum + x` with `agg.addConverted(tryConvertAmount(x, tx.currencyCode, defaultCurrency, rateMap))`. Missing: the response DTO fields and the frontend custom report viewer's partial rendering.
12. **Recommended regression test:** two currencies, one with a rate (converted) and one without (`null` total, missing currency named).
13. **Suggested regression-test diff:** as item 12 in `reports.service.spec.ts` with a mocked `ReportCurrencyService` typed to the real signature.
14. **Verification:** `npm run test:unit -- reports.service`.
15. **Residual risks:** shares A26-S02-02's open decision on the per-report missing-data policy.

Causality: `PRE_EXISTING_UNREPORTED`.

#### A26-S17-01 (merged surface) - The AI and MCP transaction analytics add amounts of different currencies together, with no conversion, no currency label and no completeness flag

1. **Severity:** MEDIUM
2. **Confidence:** high (executed, P3 against PostgreSQL; see section 7)
3. **Location:** `backend/src/transactions/transaction-analytics.service.ts:437-495` (`getSummary`: `totalIncome += income` over per-currency rows, `netCashFlow` from the mixed sum), `:1201-1230` (`getLlmListTransactions` returns those totals; `byCurrency` only when more than one currency), `:1430-1505` and `:1512-1580` (`getLlmPeriodComparison` / `getComparisonPeriodData`: `SUM(ABS(split amount))` over every account in every currency, no `byCurrency` at all); `backend/src/securities/investment-transactions.service.ts:5176-5190` (`getLlmInvestmentTransactions`: `totalAmountScaled` and `totalCommissionScaled` across currencies, beside a per-currency `incomeByCurrency`). Consumers: AI summary lines `ai/query/tool-executor.service.ts:516-517` (list_transactions: "Income: X, Expenses: Y, Net: Z", no currency), `:2499` (compare_periods), `:2610-2612` (list_investment_transactions); MCP `list_transactions`, `compare_periods`, `list_investment_transactions` (`mcp/tools/transactions.tool.ts`, `investments.tool.ts`) return the same objects through `toolResult`.
4. **Violated invariant:** `AGENTS.md` Financial math: "Convert before summing ... a total names its currency"; "A subtotal is not a total"; "carry it to every surface including the LLM shape". The compare-periods grouping also adds `ABS` of expense rows only, so a refund in the same category is not netted (`AGENTS.md` "A category's cost is its signed sum over rows of both signs").
5. **Realistic reproduction scenario:** a user with a PLN current account (default currency PLN) and a USD card. September: 4,000.00 PLN groceries and 1,000.00 USD groceries; August: 400.00 PLN. The user asks the assistant (or an MCP client) "how did my spending in September compare with August?" and "what did I spend in September?".
6. **Observed implementation behavior (P3):** `getLlmPeriodComparison` -> `period1.total = 400`, `period2.total = 5000`, `totalChange = 4600`, `totalChangePercent = 1150`; the summary line the model quotes is `Period 2 (...): 5000.00, Change: +4600.00 (+1150%)`. `getLlmListTransactions` -> `totalExpenses = 5000`, summary `Expenses: 5000.00`, with `byCurrency` present in the payload only.
7. **Expected behavior:** each total converted into the reporting currency at the row's date rate (or the row's own rate) through `FxAggregate`, the currency named (`totalsCurrency`), and `fxComplete: false` with a `known*Subtotal` when a rate is missing; or, at minimum, no cross-currency scalar and a per-currency breakdown only.
8. **Impact:** with a USD/PLN rate near 3.65 the September figure is 7,650.00 PLN, not 5,000.00 (understated by 2,650.00, about 35 percent) and the change is +7,250.00 PLN (+1,812 percent), not +4,600.00; the direction can flip when the foreign currency is the larger one in one period and not the other. Every multi-currency user who asks either surface about spending gets a figure in no currency, stated as settled. No stored data is changed.
9. **Root cause:** the LLM analytics reads were built as SQL sums over `amount` without the currency dimension; when the per-currency income was fixed (`incomeByCurrency`, `byCurrency`) the sibling totals were left on the mixed source.
10. **Recommended correction:** aggregate through `FxAggregate` into `resolveUserDefaultCurrency(userId)` per row date (`resolveFxRate`), return `totalsCurrency`, `fxComplete`, `missingRatePairs` and `known*Subtotal`, make the totals `null` when incomplete, and print the currency and the completeness note in the executor's summary lines; net within one category in the comparison (`NET_SPEND_AMOUNT`).
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/transactions/transaction-analytics.service.ts
+++ b/backend/src/transactions/transaction-analytics.service.ts
@@ getComparisonPeriodData
-      if (groupBy === "payee") {
-        qb.select("COALESCE(t.payeeName, 'Unknown')", "label")
-          .addSelect(`SUM(ABS(${SPLIT_AMOUNT}))`, "total")
+      // Group by currency as well; the caller converts each group at the
+      // reporting currency through FxAggregate (AGENTS.md "Convert before summing").
+      qb.addSelect("t.currencyCode", "currencyCode").addGroupBy("t.currencyCode");
+      if (groupBy === "payee") {
+        qb.select("COALESCE(t.payeeName, 'Unknown')", "label")
+          .addSelect(`SUM(${NET_SPEND_AMOUNT})`, "total")
@@ getLlmPeriodComparison
-    const p1Total = sumMoney(period1.map((i) => i.total));
-    const p2Total = sumMoney(period2.map((i) => i.total));
+    const target = await this.reportCurrency.getDefaultCurrency(userId);
+    const p1 = await this.convertPeriod(userId, period1, target, input.period1End);
+    const p2 = await this.convertPeriod(userId, period2, target, input.period2End);
+    // FxAggregate.total is null while a component is unknown.
+    const p1Total = p1.total;
+    const p2Total = p2.total;
@@ return
-      totalChange,
-      totalChangePercent,
+      totalsCurrency: target,
+      fxComplete: p1.fxComplete && p2.fxComplete,
+      missingRatePairs: [...new Set([...p1.missing, ...p2.missing])],
+      totalChange: p1Total === null || p2Total === null ? null : roundMoney(p2Total - p1Total),
+      totalChangePercent: /* null when either total is null or p1Total is 0 */ ...,
--- a/backend/src/ai/query/tool-executor.service.ts
+++ b/backend/src/ai/query/tool-executor.service.ts
@@ comparePeriods summary
-      summary: `Period 1 (${period1Start} to ${period1End}): ${data.period1.total.toFixed(2)}, ...`,
+      summary: data.fxComplete === false
+        ? `Totals withheld: no exchange rate for ${data.missingRatePairs.join(", ")}. ...`
+        : `Period 1 (${period1Start} to ${period1End}): ${data.period1.total.toFixed(2)} ${data.totalsCurrency}, ...`,
```

Suggested remediation diff: incomplete. Missing: the rate date per row (row date or the row's own `exchange_rate`, INV-FX-002), the same change in `getSummary` (also read by the transactions page, so its HTTP consumers in S07/S16/S20 must be checked first under Rule 10), `getLlmGroupedBreakdown`, `getLlmInvestmentTransactions`, and the MCP output schemas (`tool-output-schemas.ts`) for the new declared fields.
12. **Recommended regression test:** an integration case with two currencies and a stored rate asserting the converted totals, and a missing-rate case asserting `fxComplete: false` with `null` totals; a unit case asserting the summary line names the currency.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+++ b/backend/test/integration/llm-analytics-currency.integration.spec.ts
+it("converts a USD expense before comparing periods", async () => {
+  // PLN default; Aug 400 PLN; Sep 4,000 PLN + 1,000 USD; USD/PLN 3.65 on 2026-09-12
+  const cmp = await withUserContext(userId, () =>
+    analytics.getLlmPeriodComparison(userId, { period1Start: "2026-08-01", period1End: "2026-08-31", period2Start: "2026-09-01", period2End: "2026-09-30" }),
+  );
+  expect(cmp.totalsCurrency).toBe("PLN");
+  expect(cmp.period2.total).toBeCloseTo(7650, 2);
+  expect(cmp.totalChange).toBeCloseTo(7250, 2);
+});
+it("withholds the comparison when a rate is missing", async () => {
+  // same rows, no USD/PLN rate stored
+  expect(cmp.fxComplete).toBe(false);
+  expect(cmp.period2.total).toBeNull();
+});
```

14. **Verification method:** the new integration suite; `tool-executor.service.spec.ts` summary-line cases; `tool-output-schemas.spec.ts` round trip with the new fields; `tools-list-budget.spec.ts` (a schema change costs `tools/list` bytes).
15. **Residual risks / patch limitations:** the transactions page summary shares `getSummary`; changing its scalar semantics there needs the frontend consumer audit (S20). The patch does not decide whether a transfer between two currencies belongs in either total (it is excluded today by `isTransfer = false`).

Causality: `PRE_EXISTING_UNREPORTED` (the analytics LLM reads predate the 2026-08 audit; not in its register). Rule 7 surfaces: AI and MCP `list_transactions`, `compare_periods`, `list_investment_transactions`; the MCP resource `monize://financial-summary` (`mcp/resources/financial-summary.resource.ts:61-72`, `currentMonth` is `getSummary`); the AI insights prompt (`ai/insights/insights-aggregator.service.ts:149, 203`, `SUM(ABS(t.amount))` over every account, labelled with the user's currency at `:120`), found in the approval challenge. Not merged with A26-S13-01: that finding is a missing-rate fallback inside a conversion; here no conversion is attempted.


### A26-H13 - A cross-currency transfer opened from its receiving leg loads the received amount into the source-amount field, and an unedited save re-prices the transfer (MON-H11 client half)

- **Canonical severity:** HIGH. kept HIGH: an unedited save rewrites the source leg and the rate (executed component probe and PostgreSQL).
- **Absorbs:** A26-S19-01 (primary, 19-frontend-forms.md, session severity HIGH).
- **Invariants and prior findings named:** MON-H11.
- **Lens:** frontend.

#### A26-S19-01 (primary) - A cross-currency transfer opened from its receiving leg loads the received amount into the source-amount field, and an unedited save re-prices the transfer

1. **Severity:** HIGH
2. **Confidence:** high (executed: component probe P1 and a backend integration probe on PostgreSQL)
3. **Location:** `frontend/src/components/transactions/TransactionForm.tsx:341-343` (`amount` defaults to `Math.abs(initSource.amount)` whatever leg `initSource` is), `:277-285` (`transferTargetAmount` correctly taken from the to leg), `:1256-1277` (payload), `:103-116` (`reconciledEditAffectsReconciliation` mirrors the same normalization); `TransferTransactionFields.tsx:224-232` (the field is labelled with the FROM currency); backend `transaction-transfer.service.ts:1756-1819` (`newAmount = updateDto.amount`, compared with the FROM leg), `:290-333` (implied rate from a supplied `toAmount`). Secondary: the duplicate path (`duplicateFrom` uses the same defaults, `:329-343`) and the cross-owner edit (`:2098-2108`, same payload).
4. **Violated invariant:** reopening a transfer and saving it without editing its figures moves no money (AGENTS.md "A change is a value difference, not a field being present"; `docs/financial-semantics.md` transfer legs; the client half of MON-H11).
5. **Reproduction:** a USD account (balance 1,000.00) sends 100.00 USD to a CAD account, received 135.00 CAD (rate 1.35). The user opens the transfer from the CAD account's register (the clicked row is the positive CAD leg), changes only the description and clicks Update Transfer.
6. **Observed (executed):** the form shows "Transfer amount (USD) 135.00" and "Amount received (CAD) 135.00" (P1 inputs); the payload is `{ fromAccountId: <USD>, toAccountId: <CAD>, amount: 135, toAmount: 135, ... }`. On PostgreSQL the same payload through `TransactionsService.updateTransfer` on the CAD leg gives: before `usdBal 900, fromLeg -100, toLeg 135, rate 1.35`; after `usdBal 865, fromLeg -135, toLeg 135, rate 1`.
7. **Expected:** the source field shows 100.00 USD, the payload carries `amount: 100`, nothing is re-priced; the USD balance stays 900.00.
8. **Impact:** every cross-currency transfer edited (or duplicated) from its receiving account: the source account is debited by the received amount, the stored rate becomes 1 (a 1:1 cross-currency transfer, the shape INV-FX-001 forbids), net worth and every report move by the difference. Numerical: inputs 100.00 USD -> 135.00 CAD; result -135.00 USD; expected -100.00 USD; absolute difference 35.00 USD (35 % of the transfer). A reconciled USD leg is altered with no confirmation, because `reconciledEditAffectsReconciliation` compares the opened leg's own amount (135 against 135) and sees no change.
9. **Root cause:** the form normalizes "the transfer amount" from whichever leg it was given instead of from the FROM leg it treats as the source everywhere else (`getTransferAccounts` already picks the FROM leg's account, `:248-267`); the server cannot tell this false signal from a real edit, because the field is legitimately the source amount.
10. **Recommended correction:** take the source amount from the FROM (negative) leg in the defaults and in the reconciled-edit comparison; add a regression test opening the receiving leg of a cross-currency transfer.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/frontend/src/components/transactions/TransactionForm.tsx
+++ b/frontend/src/components/transactions/TransactionForm.tsx
@@ -100,13 +100,26 @@
  * precision the form loads them with, so float drift never triggers a warning.
  */
+/**
+ * The amount a transfer form shows as "Transfer amount": the FROM (negative)
+ * leg's, whichever leg the form was opened on. The receiving leg holds the
+ * amount in the destination currency.
+ */
+function transferSourceAmount(source: Transaction): number {
+  const linked = source.linkedTransaction;
+  const fromLeg =
+    Number(source.amount) >= 0 && linked ? linked : source;
+  return Math.abs(Number(fromLeg.amount));
+}
+
 function reconciledEditAffectsReconciliation(
   original: Transaction,
   data: TransactionFormData,
 ): boolean {
   const dateChanged = data.transactionDate !== original.transactionDate;
   const originalAmount = original.isTransfer
-    ? Math.abs(Math.round(Number(original.amount) * 100) / 100)
+    ? Math.round(transferSourceAmount(original) * 100) / 100
     : Math.round(Number(original.amount) * 100) / 100;
@@ -339,7 +352,7 @@
           categoryId: initSource.categoryId || '',
           // For transfers, always show absolute amount
           amount: initSource.isTransfer
-            ? Math.abs(Math.round(Number(initSource.amount) * 100) / 100)
+            ? Math.round(transferSourceAmount(initSource) * 100) / 100
             : Math.round(Number(initSource.amount) * 100) / 100,
```

12. **Recommended regression test:** open the CAD (receiving) leg of a USD 100 -> CAD 135 transfer, save unedited, assert `amount: 100` and `toAmount: 135`; the same for `duplicateFrom`; a reconciled receiving leg whose source amount is edited raises the confirmation.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
--- a/frontend/src/components/transactions/TransactionForm.test.tsx
+++ b/frontend/src/components/transactions/TransactionForm.test.tsx
@@ -3152,6 +3152,30 @@
     });
+
+    it('sends the source amount when a cross-currency transfer is opened from its receiving leg', async () => {
+      const incoming = createExistingTransaction({
+        accountId: 'acc-1', amount: 135, currencyCode: 'CAD', isTransfer: true,
+        linkedTransactionId: 'linked-usd',
+        linkedTransaction: {
+          ...createExistingTransaction({ id: 'linked-usd', accountId: 'acc-3', amount: -100, currencyCode: 'USD', isTransfer: true }),
+          account: { id: 'acc-3', name: 'USD Account' },
+        },
+        payeeId: null, payeeName: null, categoryId: null, category: null,
+      });
+      render(<TransactionForm transaction={incoming} onSuccess={mockOnSuccess} onCancel={mockOnCancel} />);
+      await waitFor(() => expect(screen.getByText('From Account')).toBeInTheDocument());
+      fireEvent.click(screen.getByRole('button', { name: /Update Transfer/i }));
+      await waitFor(() => expect(mockUpdateTransfer).toHaveBeenCalled());
+      expect(mockUpdateTransfer.mock.calls[0][1]).toEqual(
+        expect.objectContaining({ fromAccountId: 'acc-3', toAccountId: 'acc-1', amount: 100, toAmount: 135 }),
+      );
+    });
```

14. **Verification method:** the test above fails at the baseline (P1 observed `amount: 135`) and passes with the fix; re-run the backend probe with the corrected payload and assert the balances unchanged (`usdBal 900`, rate 1.35); lint and type-check in `frontend/`.
15. **Residual risks:** a transfer whose counterpart is masked (cross-owner, hidden account) may carry no usable `linkedTransaction.amount`; the form already locks the money fields there (`counterpartLocked`, `TransferTransactionFields.tsx:151-154`), but the default has to be checked against that payload shape. The server cannot detect the false signal; a defence in depth (refusing an update whose `amount` equals the opened receiving leg while differing from the FROM leg) would be a heuristic, not a fix. Causality: `PRE_EXISTING_UNREPORTED` (the lines sit at the shallow-clone boundary commit `3c1b2ff`, so their age cannot be dated; the upstream report's P6-002 does not describe the receiving leg). It is the client half of MON-H11, `CONFIRMED_WITH_DIFFERENT_ROOT_CAUSE`. Invariants: INV-TRANSFER-001 (client), FIN-001, INV-FX-001 (a 1:1 cross-currency rate is written).


### A26-H14 - Switching an existing income, expense or split to Transfer mode creates a second, new transfer and leaves the original row in place

- **Canonical severity:** HIGH. kept HIGH: an ordinary edit duplicates money movement; the UI reports success (executed component probe).
- **Absorbs:** A26-S19-02 (primary, 19-frontend-forms.md, session severity HIGH).
- **Invariants and prior findings named:** none in the index (see field 4 of each member).
- **Lens:** frontend.

#### A26-S19-02 (primary) - Switching an existing income, expense or split to Transfer mode creates a second, new transfer and leaves the original row in place

1. **Severity:** HIGH
2. **Confidence:** high (executed: component probe P5; the server half is the ordinary `createTransfer`, covered by `transfers.integration.spec.ts` "should create linked transactions and update both balances")
3. **Location:** `frontend/src/components/transactions/TransactionForm.tsx:1520-1567` (the mode selector is offered on any edit except an existing transfer), `:495-517` (`handleModeChange`), `:1279-1293` (`transaction?.isTransfer` false -> `createTransfer`; the edited row is never updated or deleted). The domain already has an in-place conversion, used only by rules: `backend/src/transactions/convert-to-transfer.ts:53-60`.
4. **Violated invariant:** saving an edit writes the edited row; one user action has at most one financial effect.
5. **Reproduction:** an imported expense of -50.00 CAD on Chequing (balance 1,000.00 before it, 950.00 after) was really a move to Savings. The user opens it, clicks Transfer, picks Savings and clicks the button labelled "Update Transfer".
6. **Observed (executed, P5):** submit label "Update Transfer"; `createTransfer` called once with `{ fromAccountId: 'acc-1', toAccountId: 'acc-2', amount: 50, categoryId: 'cat-1', ... }`; `update` and `updateTransfer` not called; the toast says the transfer was created.
7. **Expected:** the expense becomes the FROM leg of a transfer (Chequing stays at 950.00, Savings +50.00), or the form refuses the conversion.
8. **Impact:** Chequing 900.00 instead of 950.00 (difference -50.00, 100 % of the converted amount), Savings +50.00, and the expense still counts in the category reports and budgets; the button said "Update". Converting a miscategorized bank row to a transfer is a common clean-up after an import, and the duplicate stays until noticed.
9. **Root cause:** the transfer branch of `performSubmit` decides create versus update from `transaction?.isTransfer` instead of from "is there a row being edited", and no conversion endpoint is exposed to the form.
10. **Recommended correction:** until a conversion route exists, do not offer Transfer mode when editing an existing non-transfer row and refuse it in `performSubmit`; the full fix exposes `convertToTransfer` (`convert-to-transfer.ts`) behind a route the form calls, inside one transaction with the row lock. Maintainer decision: which of the two.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/frontend/src/components/transactions/TransactionForm.tsx
+++ b/frontend/src/components/transactions/TransactionForm.tsx
@@ -1235,6 +1235,14 @@
       if (mode === 'transfer') {
+        // An existing income, expense or split cannot become a transfer from
+        // here: creating one would leave the original row in place and book
+        // the money twice.
+        if (transaction && !transaction.isTransfer) {
+          toast.error(t('form.toasts.convertToTransferUnsupported'));
+          setIsLoading(false);
+          return;
+        }
         if (!transferToAccountId) {
@@ -1553,7 +1561,7 @@
           </button>
-          <button
+          {!transaction && <button
             type="button"
             onClick={() => handleModeChange('transfer')}
@@ -1565,6 +1573,6 @@
             {t('form.modeTransfer')}
-          </button>
+          </button>}
         </div>
```

(the new key goes into `en/transactions.json` and the pseudo-locale).

12. **Recommended regression test:** open an existing expense, assert there is no Transfer mode button; a forced transfer-mode submit calls neither `createTransfer` nor `update`.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
--- a/frontend/src/components/transactions/TransactionForm.test.tsx
+++ b/frontend/src/components/transactions/TransactionForm.test.tsx
@@ -2615,6 +2615,16 @@
+    it('does not offer Transfer mode when editing an existing expense', async () => {
+      const tx = createExistingTransaction({ amount: -50, accountId: 'acc-1' });
+      render(<TransactionForm transaction={tx} onSuccess={mockOnSuccess} onCancel={mockOnCancel} />);
+      await waitFor(() => expect(screen.getByRole('button', { name: /^Transaction$/ })).toBeInTheDocument());
+      expect(screen.queryByRole('button', { name: /^Transfer$/ })).not.toBeInTheDocument();
+      expect(mockCreateTransfer).not.toHaveBeenCalled();
+    });
```

14. **Verification method:** the test fails at the baseline (P5: the button exists and `createTransfer` is called) and passes with the diff; the existing "switches from normal to transfer and back to normal" test (`:1060`) runs in create mode and must stay green.
15. **Residual risks:** the guard closes the double booking but removes a workflow users may rely on; the conversion route is the real remedy and needs its own spec (category clearing, reconciled state, tags, splits). Causality: `PRE_EXISTING_UNREPORTED` (not in the upstream report; the lines are at the shallow boundary). Rule 10: the create-mode mode switch and the duplicate flow are untouched.


### A26-H15 - Completeness flags are not carried or read where totals are shown: net worth, accounts, portfolio widget and history, the AI/MCP account tools, report exports and Cash Flow

- **Canonical severity:** HIGH. HIGH (S20 raised A26-S02-03 from MEDIUM; S23 agrees): AGENTS.md classes "a subtotal is not a total" as CRITICAL, four surfaces executed, upstream MON-H16 was HIGH; the server-side drop of the flags (A26-S13-04) and the report exports (A26-S16-04) are the producer half and the export surface of the same invariant.
- **Absorbs:** A26-S20-01 (primary, 20-frontend-figures.md, session severity HIGH); A26-S02-03 (superseded, 02-prior-high-triage.md, session severity MEDIUM); A26-S13-04 (merged surface, 13-valuation-fx-networth.md, session severity MEDIUM); A26-S16-04 (merged surface, 16-budgets-reports.md, session severity MEDIUM).
- **Invariants and prior findings named:** INV-REPORT-002, MON-H16.
- **Lens:** frontend.

#### A26-S20-01 (primary) - Completeness flags are not read where the totals are shown: the net-worth report and dashboard, the accounts page, the portfolio widget and the portfolio charts print subtotals as totals (MON-H16 residual, A26-S02-03, A26-S13-04 UI half)

1. **Severity:** HIGH (re-assessed from A26-S02-03's MEDIUM: the surface list now includes the Net Worth report and both dashboard net-worth widgets, and the omitted component is a whole account of any size; S23 to confirm)
2. **Confidence:** high (four surfaces executed, the rest read)
3. **Location (Rule 7, one root, every surface):**
   - (a) net worth: `frontend/src/types/net-worth.ts:3-15` (`MonthlyNetWorth` has no `fxComplete` / `missingRatePairs`, although `backend/src/net-worth/net-worth.service.ts:830-858` sends both per month); consumers `components/reports/NetWorthReport.tsx:135-187` (cards, table, chart), `:264-283` (PDF, CSV); `components/dashboard/NetWorthChart.tsx:88-113, 206-211`; `components/dashboard/AssetsVsLiabilities.tsx:55-64`.
   - (b) accounts: `app/accounts/page.tsx:115-141` (brokerage contribution gated on `unpricedHoldingsCount` only), `components/accounts/AccountList.tsx:1074`, `lib/logical-accounts.ts:225-240`.
   - (c) portfolio headline: `components/dashboard/PortfolioValueWidget.tsx:149, 287-291` (`formatCurrency(totalPortfolioValue)` with no flag).
   - (d) portfolio series: `components/investments/InvestmentValueChart.tsx:218-241` (every daily point plotted as `investedValue(d)` whatever `pricesComplete` / `fxComplete` say), `:503-508, 656-664` (Highest / Lowest cards ranked over those points); `PortfolioValueWidget.tsx:116-118` (sparkline).
   - (e) per-account breakdown: `components/reports/PortfolioValueReport.tsx:1042-1045` (CSV), `:1770-1784` (table: holdings, total, gain with no per-account `valuationComplete`); `components/reports/SecurityTypeAllocationReport.tsx:786` (footer "Total" prints the subtotal the card above it marks partial).
4. **Violated invariant:** AGENTS.md "A completeness flag is read where the numbers are shown ... relabel a partial figure rather than leaving a total's caption over it"; MON-H16; `types/net-worth.ts:30-35` ("Read the flags before printing this under a total's caption").
5. **Reproduction:** (a) reporting currency USD; a USD chequing account of 50,000 and an account in a currency with no rate (custom `ZZZ`, 1,000,000). Open Reports -> Net Worth. (b) a CAD brokerage with a USD position and no USD->CAD rate, every price present. (c) one unpriced holding worth about 50,000 beside 100,000 priced. (d) a holding with no accepted close for part of the window.
6. **Observed (executed):** (a) "Current Net Worth $50000", no marker, nothing names `ZZZ->USD` (probe P1 fails: `expected false to be true`). (b) Total Assets `$50000.00` with no "partial total" (probe P3 fails). (c) the widget prints `$100000` (probe P2 fails). (d) "Lowest Value $100.00" for the day the holding was unpriced (probe P4 fails). (e) read only.
7. **Expected:** each figure either marked partial with the missing pair or security named (`PartialTotal` / `IncompleteDataDetails`, as `PortfolioSummaryCard` and `PortfolioValueReport`'s daily path already do), or withheld; an incomplete point plotted as `null` and the extremes withheld (as `PortfolioValueReport.tsx:436-445, 757-776` does).
8. **Impact:** the net worth headline, the accounts page Net Worth and Total Assets, the dashboard's net-worth and asset/liability widgets and the portfolio widget omit a whole component silently: 1,000,000 ZZZ in (a), about USD 100,000 in (b), 50,000 (33 percent) in (c); a chart dip in (d) is ranked as the period low. The PDF and CSV exports of (a) and (e) carry the same subtotals out of the application.
9. **Root cause:** stage 1 of `docs/specs/fx-conversion-completeness.md` kept the figures numeric and put the flags beside them; three consumer families were not migrated (Rule 4): a type that never declared the flags (a), consumers keyed on the narrower `unpricedHoldingsCount` (b), and series consumers fixed in the report for #1389 but not on the investments page or the widget (d).
10. **Recommended correction:** declare the flags on `MonthlyNetWorth` and render the months through `PartialTotal`; gate the brokerage contribution and the widget headline on `valuationComplete === false`; reuse the report's per-point completeness and extremes rule in `InvestmentValueChart` and the widget; read the per-account `valuationComplete` in the breakdown table and CSV.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/frontend/src/types/net-worth.ts
+++ b/frontend/src/types/net-worth.ts
@@ export interface MonthlyNetWorth {
   netWorth: number;
+  /** False when a component of this month could not be converted; the three
+   *  figures are then subtotals. Optional: absent is no information. */
+  fxComplete?: boolean;
+  missingRatePairs?: string[];
   byAccountType?: Partial<Record<AccountType, number>>;
--- a/frontend/src/components/reports/NetWorthReport.tsx
+++ b/frontend/src/components/reports/NetWorthReport.tsx
@@ const summary = useMemo(() => {
-    if (chartData.length === 0) return { current: 0, change: 0, changePercent: 0 };
+    if (chartData.length === 0) return { current: 0, change: 0, changePercent: 0, missing: [] as string[] };
+    const last = monthlyData[monthlyData.length - 1];
+    const first = monthlyData[0];
+    const missing = [...new Set([...(last.missingRatePairs ?? []), ...(first.missingRatePairs ?? [])])];
@@
-          <div className={`text-2xl font-bold ${gainLossColor(summary.current)}`}>
-            {formatCurrency(summary.current)}
+          <div className={`text-2xl font-bold ${gainLossColor(summary.current)}`}>
+            <PartialTotal total={{ value: summary.current, missingCurrencies: summary.missing, excludedCount: summary.missing.length }} displayCurrency={defaultCurrency}>
+              {formatCurrency(summary.current)}
+            </PartialTotal>
--- a/frontend/src/app/accounts/page.tsx
+++ b/frontend/src/app/accounts/page.tsx
@@ const contributedBalance = (a: Account): number | null => {
-      if (portfolioFailed || (unpricedHoldingCounts.get(a.id) ?? 0) > 0) return null;
+      if (portfolioFailed || incompleteAccounts.has(a.id)) return null;
@@
+  // valuationComplete covers prices AND rates; unpricedHoldingsCount only prices.
+  const incompleteAccounts = useMemo(() => new Set(
+    (portfolioSummary?.holdingsByAccount ?? [])
+      .filter((h) => h.valuationComplete === false || (h.unpricedHoldingsCount ?? 0) > 0)
+      .map((h) => h.accountId)), [portfolioSummary]);
--- a/frontend/src/components/dashboard/PortfolioValueWidget.tsx
+++ b/frontend/src/components/dashboard/PortfolioValueWidget.tsx
@@
-  const totalPortfolioValue = summary?.totalPortfolioValue ?? null;
+  const totalPortfolioValue =
+    summary && summary.valuationComplete !== false ? summary.totalPortfolioValue : null;
@@
-      .then((rows) =>
-        rows.map((r) => ({ date: r.date, value: investedValue(r) })),
+      .then((rows) =>
+        rows.map((r) => ({
+          date: r.date,
+          value: r.pricesComplete !== false && r.fxComplete !== false ? investedValue(r) : null,
+        })),
--- a/frontend/src/components/investments/InvestmentValueChart.tsx
+++ b/frontend/src/components/investments/InvestmentValueChart.tsx
@@ data.map((d) => ({
-            Value: investedValue(d),
+            Value: d.pricesComplete !== false && d.fxComplete !== false ? investedValue(d) : null,
+            complete: d.pricesComplete !== false && d.fxComplete !== false,
```

   plus: the summary `useMemo` at `:503` takes `PortfolioValueReport.tsx:757-776` verbatim (one incomplete point leaves both extremes unknown), the same predicate in `AccountList.tsx:1074` and `logical-accounts.ts:225-240`, `NetWorthChart` and `AssetsVsLiabilities` marked from the same month fields, and the breakdown table/CSV reading `acct.valuationComplete === false`. Maintainer decision: whether the widget headline shows the subtotal under `PartialTotal` (as the investments page does) or withholds it.
12. **Recommended regression test:** one component case per surface fed `valuationComplete:false` (or `fxComplete:false` on a month, `pricesComplete:false` on a point) with every other field complete.
13. **Suggested regression-test diff (illustrative, not applied):** the four probes run for this report, kept as tests:

```diff
+// NetWorthReport.test.tsx
+it('marks the current net worth partial when the latest month is fxComplete:false', async () => {
+  mockGetMonthly.mockResolvedValue([
+    { month: '2024-11-01', assets: 50000, liabilities: 0, netWorth: 50000, fxComplete: true, missingRatePairs: [] },
+    { month: '2024-12-01', assets: 50000, liabilities: 0, netWorth: 50000, fxComplete: false, missingRatePairs: ['ZZZ->USD'] },
+  ]);
+  await act(async () => { render(<NetWorthReport />); });
+  await waitFor(() => expect(screen.getAllByText('$50000').length).toBeGreaterThan(0));
+  expect(document.body.innerHTML.includes('ZZZ') || /partial/i.test(document.body.innerHTML)).toBe(true);
+});
+// app/accounts/page.test.tsx, inside 'an unknown value is not a measured zero'
+it('marks the totals partial when a brokerage is FX-incomplete with every price present', async () => {
+  mockGetAll.mockResolvedValue([{ id: 'acc-5', name: 'Brokerage', accountType: 'INVESTMENT', accountSubType: 'INVESTMENT_BROKERAGE', currencyCode: 'USD', currentBalance: 0, isClosed: false, canDelete: false }]);
+  mockGetPortfolioSummary.mockResolvedValue({ holdingsByAccount: [{ accountId: 'acc-5', totalMarketValue: 50000, cashBalance: 0, unpricedHoldingsCount: 0, fxComplete: false, missingRatePairs: ['USD->CAD'], pricesComplete: true, valuationComplete: false }] });
+  render(<AccountsPage />);
+  await waitFor(() => expect(screen.getByTestId('summary-Total Assets')).toHaveTextContent('$50000.00'));
+  expect(screen.getByTestId('summary-Total Assets')).toHaveTextContent('partial total');
+});
+// PortfolioValueWidget.test.tsx
+it('does not print a subtotal bare when valuationComplete is false', async () => {
+  getPortfolioSummary.mockResolvedValue({ totalPortfolioValue: 100000, holdings: [], holdingsByAccount: [], pricesComplete: false, fxComplete: true, valuationComplete: false, unpricedSecurityIds: ['sec-1'], missingRatePairs: [] });
+  getInvestmentsDaily.mockResolvedValue([{ date: '2026-05-28', value: 9000 }, { date: '2026-06-28', value: 10000 }]);
+  await renderWidget();
+  expect(screen.queryByText('$100000')).not.toBeInTheDocument();
+});
+// InvestmentValueChart.test.tsx
+it('does not rank a pricesComplete:false point as the Lowest Value', async () => {
+  vi.mocked(netWorthApi.getInvestmentsDaily).mockResolvedValue([
+    { date: '2023-06-01', value: 10000, securitiesValue: 10000, pricesComplete: true },
+    { date: '2023-09-01', value: 100, securitiesValue: 100, pricesComplete: false, unpricedSecurityIds: ['sec-1'] },
+    { date: '2024-01-01', value: 15000, securitiesValue: 15000, pricesComplete: true },
+  ]);
+  render(<InvestmentValueChart />);
+  await screen.findByText('Lowest Value');
+  expect(screen.queryByText('$100.00')).not.toBeInTheDocument();
+});
```

14. **Verification:** `npm run test -- NetWorthReport NetWorthChart AssetsVsLiabilities accounts/page AccountList logical-accounts PortfolioValueWidget InvestmentValueChart PortfolioValueReport SecurityTypeAllocationReport`; `npm run type-check`; a browser check of the four surfaces with a missing rate.
15. **Residual risks:** the server `total*` fields stay numeric when incomplete (design risk, A26-S02 section 9); the snapshot table behind `/net-worth/monthly` cannot see an unpriced position (A26-S13-04), so `fxComplete` on a month is itself narrower than "complete"; the intraday series carries no flag at all (section 8, S14 hand-off).

Causality: `PRIOR_REPORTED`, `CONFIRMED_WITH_DIFFERENT_ROOT_CAUSE` (MON-H16), consolidating A26-S02-03 (owner S20) and the UI half of A26-S13-04. Execution: probes P1-P4 (section 12.5), mutation M2 undetected (section 6).

#### A26-S02-03 (superseded) - Completeness flags are not read on the accounts page, the account list, logical accounts and the dashboard portfolio widget (MON-H16 residual)

Superseded by the primary above: same root cause, and its scenario is one surface of the primary's reproduction. Full text: `02-prior-high-triage.md` section 4.

#### A26-S13-04 (merged surface) - The latest net worth, the account market values and the month comparison drop the completeness flags, so the accounts summary and the AI/MCP account tools quote a subtotal as net worth

1. **Severity:** MEDIUM
2. **Confidence:** high (executed, P5)
3. **Location:** `backend/src/net-worth/net-worth.service.ts:1051-1080` (`getLatestNetWorth` returns `{assets, liabilities, netWorth}` and drops `fxComplete` / `missingRatePairs`); consumers `accounts/accounts.service.ts:1598-1606` (`getSummary`, `?? 0`), `:1817-1823` (`getLlmAccounts` totals, `?? 0`), `mcp/resources/financial-summary.resource.ts:57, 83`, AI `list_accounts` line `tool-executor.service.ts:2433`, MCP `list_accounts` schema `mcp/tool-output-schemas.ts:59-66`; `securities/portfolio.service.ts:1491-1551` (`getAccountMarketValues` skips an unpriced or unconvertible position with no flag; `accounts.service.ts:1746-1751` reads it with `?? 0`); `built-in-reports/monthly-comparison.service.ts:338-362` (month reduced to `{month, netWorth}`); the snapshot writer `net-worth.service.ts:2931, 2948-2959` stores the subtotal for a security-to-account gap and skips an unpriced position silently, so the read-time `fxComplete` cannot see either.
4. **Violated invariant:** `docs/financial-calculation-contract.md` section 1 and `AGENTS.md` "A completeness flag is read where the numbers are shown ... carry it to every surface including the LLM shape".
5. **Reproduction:** default USD; a USD chequing account of 1,000.00 and an account in a custom currency `ZZZ` holding 1,000,000 with no rate. Call `GET /accounts/summary`, the MCP resource `monize://financial-summary`, AI or MCP `list_accounts`.
6. **Observed (executed, P5):** `/accounts/summary` -> `{"totalAssets":1000,"netWorth":1000}` with no completeness field; `getLlmAccounts` -> `netWorth: 1000` with `missingRatePairs: ["ZZZ->USD"]` from its separate per-account conversion, and no total-level flag. The AI line prints `Net worth: 1000.00`.
7. **Expected:** `netWorth: null` (or the subtotal under a named field) with `fxComplete: false` and the pair, as `getMonthlyNetWorth` carries for the same month.
8. **Impact:** the assistant and an MCP client state a net worth short by the whole unconvertible account (1,000,000 ZZZ here); the account tools' brokerage `balance` is a silent subtotal or 0 when a holding's price or rate is missing; the month comparison quotes net worth deltas over subtotals. The frontend `MonthlyNetWorth` type has no flag at all (`frontend/src/types/net-worth.ts:3-15`), so the net-worth report, its PDF/CSV and the two dashboard widgets show the series' subtotals as totals (UI half handed to S20, with A26-S02-03).
9. **Root cause:** stage 1 of `docs/specs/fx-conversion-completeness.md` kept the figures numeric and added the flags beside them, but the scalar consumers (latest month, month comparison, account market values) were not migrated (Rule 4); the snapshot table has no completeness column.
10. **Recommended correction:** return the flags from `getLatestNetWorth` and carry them into `getSummary`, `getLlmAccounts`, the financial-summary resource and both `list_accounts` schemas; give `getAccountMarketValues` a per-account completeness map (or reuse the summary's per-account `valuationComplete`); keep `fxComplete` in `month_comparison`; persist a completeness bit on the snapshot (a migration, maintainer decision).
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/net-worth/net-worth.service.ts
+++ b/backend/src/net-worth/net-worth.service.ts
@@ -1051,7 +1051,13 @@
   async getLatestNetWorth(
     userId: string,
     jointScope?: JointNetWorthScope,
-  ): Promise<{ assets: number; liabilities: number; netWorth: number } | null> {
+  ): Promise<{
+    assets: number;
+    liabilities: number;
+    netWorth: number;
+    fxComplete: boolean;
+    missingRatePairs: string[];
+  } | null> {
@@ -1075,6 +1081,8 @@
     return {
       assets: latest.assets,
       liabilities: latest.liabilities,
       netWorth: latest.netWorth,
+      fxComplete: latest.fxComplete,
+      missingRatePairs: latest.missingRatePairs,
     };
--- a/backend/src/accounts/accounts.service.ts
+++ b/backend/src/accounts/accounts.service.ts
@@ -1600,8 +1600,13 @@
     return {
       totalAccounts: accounts.length,
       totalBalance,
       totalAssets: roundMoney(latest?.assets ?? 0),
       totalLiabilities: roundMoney(latest?.liabilities ?? 0),
-      netWorth: roundMoney(latest?.netWorth ?? 0),
+      // A subtotal is not a total: null when a component did not convert.
+      netWorth:
+        latest && latest.fxComplete === false ? null : roundMoney(latest?.netWorth ?? 0),
+      fxComplete: latest?.fxComplete ?? true,
+      missingRatePairs: latest?.missingRatePairs ?? [],
     };
```

   Needs: the same in `getLlmAccounts`, the MCP schemas, the AI summary line, the frontend `AccountSummary` and `MonthlyNetWorth` types; `getAccountMarketValues` completeness; the snapshot column. `Suggested remediation diff: incomplete` for the snapshot half (a migration and a decision whether a partially priced month is stored at all).
12. **Recommended regression test:** P5 as an integration case asserting `fxComplete: false` and the pair on both the summary and the LLM shape; a unit case for `getAccountMarketValues` with one unpriced holding.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+  it("does not report a subtotal as net worth (financial contract section 1)", async () => {
+    // USD 1000 + ZZZ 1,000,000 with no rate
+    const s = await accounts.getSummary(userId);
+    expect(s.fxComplete).toBe(false);
+    expect(s.missingRatePairs).toEqual(["ZZZ->USD"]);
+    expect(s.netWorth).toBeNull();
+  });
```

14. **Verification:** P5 re-run; `npm run test:unit -- accounts.service net-worth.service monthly-comparison tool-executor`; MCP schema tests.
15. **Residual risks:** the look-through and allocation `totalValue` (`sector-weighting.service.ts:420-433, 806-826`, `portfolio.service.ts:1563-1720`) also carry no flags (same root cause, listed here as surfaces); the frontend reading is S20's.

- Causality: `EXPOSED_OR_AMPLIFIED` by the stage-1 completeness change (plan class `PRE_EXISTING_UNREPORTED` for the scalar consumers; the flags themselves are new since the upstream audit).
- Surfaces (Rule 7): `/accounts/summary`, MCP `monize://financial-summary`, AI and MCP `list_accounts` (totals and brokerage balances), AI/MCP `month_comparison`, the snapshot writer, look-through and allocation totals.

#### A26-S16-04 (merged surface) - Report exports and the Cash Flow report present a partial or unknown total as a complete one

1. **Severity:** MEDIUM
2. **Confidence:** high (static; the component code is direct)
3. **Location:** `frontend/src/components/reports/CashFlowReport.tsx:142-147` (`totals.income ?? 0`, `expenses ?? 0`, `net ?? 0` over a `number | null` DTO field), rendered on screen `:226, :234` and in the PDF `:158-178`; its `ReportToolbarActions` has no `disabled` (`:284`) and `useReportData` leaves `data` null on a failed first load, so the PDF exports zeros; `IncomeVsExpensesReport.tsx:260-271` and `SpendingByCategoryReport.tsx:232-250` write `knownIncome` / `knownSpending` under "Total ..." in the PDF while the screen wraps the same figure in `PartialTotal` (`IncomeVsExpensesReport.tsx:473-479`, `SpendingByCategoryReport.tsx:442`); `frontend/src/lib/pdf-export.ts` has no partial or missing-currency field.
4. **Violated invariant:** `frontend/CLAUDE.md` "never `?? 0` on an API value"; AGENTS "A completeness flag is read where the numbers are shown"; INV-REPORT-002 (an export carries the screen's figure); the A26-S15-08 pattern (export while the request failed).
5. **Reproduction:** reporting currency CAD, income 5 000.00 CAD and 1 000.00 EUR with no EUR->CAD rate. Open Cash Flow; export PDF. Then Income vs Expenses -> PDF.
6. **Observed:** Cash Flow: `totals.income = null` renders "Total Inflows 0.00" and "Net +0.00 - expenses" on screen and in the PDF. Income vs Expenses PDF: "Total Income 5 000.00" with no caption. With the Cash Flow request failed: the PDF button stays enabled and writes three zero cards.
7. **Expected:** unknown totals rendered as unknown, partial ones captioned with the missing currency (as the screen does), exports disabled while the data is loading or failed.
8. **Impact:** a document that leaves the application carries a false total; in the Cash Flow case the reader sees zero income.
9. **Root cause:** `IncomeExpenseTotals` became `number | null` server-side without the Cash Flow consumer being migrated (Rule 4); the PDF helper cannot express a partial figure.
10. **Recommended correction:** read the nullable totals through `PartialTotal` in Cash Flow; add a `note` / `partial` option to `exportToPdf` summary cards and pass the missing currencies; `disabled={dataUnavailable}` on the Cash Flow toolbar.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/frontend/src/components/reports/CashFlowReport.tsx
+++ b/frontend/src/components/reports/CashFlowReport.tsx
@@ -142,9 +142,9 @@
   const totals = useMemo(
     () => ({
-      totalIncome: response?.cashFlowResponse.totals.income ?? 0,
-      totalExpenses: response?.cashFlowResponse.totals.expenses ?? 0,
-      netCashFlow: response?.cashFlowResponse.totals.net ?? 0,
+      totalIncome: response?.cashFlowResponse.totals.income ?? null,
+      totalExpenses: response?.cashFlowResponse.totals.expenses ?? null,
+      netCashFlow: response?.cashFlowResponse.totals.net ?? null,
     }),
@@ -284 +284 @@
-          <ReportToolbarActions onExportPdf={handleExportPdf} />
+          <ReportToolbarActions onExportPdf={handleExportPdf} disabled={dataUnavailable} />
```

   plus rendering each `null` through `PartialTotal` with `knownIncome` / `missingCurrencies`, and a `partialNote` field in `exportToPdf` used by all three reports.
12. **Recommended regression test:** component tests rendering a response with `income: null, knownIncome: 5000, missingCurrencies: ["EUR"]`: no "0.00" for income, PDF called with the partial note; a failed load leaves the export disabled.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+it("never shows an unknown total as zero", async () => {
+  mockCashFlow({ totals: { income: null, knownIncome: 5000, expenses: 3000, net: null }, missingCurrencies: ["EUR"] });
+  await act(async () => render(<CashFlowReport />));
+  expect(screen.queryByText("$0.00")).toBeNull();
+});
```

14. **Verification:** `npm run test -- CashFlowReport IncomeVsExpensesReport SpendingByCategoryReport pdf-export`; `npm run type-check`.
15. **Residual risks:** the sweep covered the 49 components that render `ReportToolbarActions` for an early error return or a `disabled` prop; reports with several requests (Debt Payoff Timeline, Cash Flow Sankey, the budget reports) were not traced request by request; handed to S20.

Causality: `PRE_EXISTING_UNREPORTED` for the PDF captions; `EXPOSED_OR_AMPLIFIED` for Cash Flow (the server field became nullable, the consumer kept `?? 0`).



### 7.2 MEDIUM findings


### A26-M01 - A successful password login writes the pre-bcrypt snapshot back and restores the failed-login counter it just reset

- **Canonical severity:** MEDIUM. kept MEDIUM.
- **Absorbs:** A26-S03-02 (primary, 03-security-auth.md, session severity MEDIUM).
- **Invariants and prior findings named:** INV-AUTH-002.
- **Lens:** security.

#### A26-S03-02 (primary) - A successful password login writes the pre-bcrypt snapshot back and restores the failed-login counter it just reset

1. **Severity:** MEDIUM
2. **Confidence:** high (executed against PostgreSQL 16)
3. **Location:** `backend/src/auth/auth.service.ts:387-391` (snapshot read), `:470-478` (SQL reset), `:537-538` (`user.lastLogin = new Date(); repo.save(user)`), same at `:509-511` (trusted-device 2FA path); `backend/src/auth/login-lockout.ts` (escalation reads the restored counter).
4. **Violated invariant:** the success-path reset described in INV-AUTH-002 ("The success-path reset writes a fixed absolute value and was always safe") and the code comment at `auth.service.ts:463-469` ("A correct password is authoritative about the attempts before it").
5. **Reproduction:** an account has `failed_login_attempts = 4` (four typos, below the threshold of 5). The owner then signs in with the correct password. `loginWithinContext` read the `User` entity before bcrypt (`failedLoginAttempts = 4`), resets the row to 0 in SQL, then `repo.save(user)` lets TypeORM diff the snapshot against the database (`4` vs `0`) and writes `failed_login_attempts = 4` back. The next single wrong password -- by the owner or by anyone who knows the address -- reaches 5 and locks the account for 30 minutes and sends the lockout email. After a past lockout the snapshot also restores the expired `locked_until`, so the escalation logic treats the next failure as a repeat offence.
6. **Observed:** probe `AUDIT S03 probe: login counter reset survives the snapshot save` drives the real `AuthService.login` (local account, no 2FA, verified email) against real PostgreSQL: `AUDIT-PROBE after successful login {"failed_login_attempts":4,"locked_until":null}`, `Expected: 0 / Received: 4`.
7. **Expected:** `failed_login_attempts = 0`, `locked_until = NULL` after a successful password check.
8. **Impact:** availability and security operations: a user who recovered from typos is one typo (or one hostile attempt) away from a 30-minute lockout and an alarming email; lockout notifications overcount. No credential is exposed.
9. **Root cause:** a whole-entity `save` of a snapshot taken before a SQL write to the same row. The reset was moved into SQL (audit P4-012) but the later `save` of the stale entity was left in place, so the two writes disagree and the later one wins.
10. **Recommended correction:** update only the column the success path owns (`last_login`) and fold the counter reset into the same statement.
11. **Suggested remediation diff (illustrative, not applied):**
    ```diff
    --- a/backend/src/auth/auth.service.ts
    +++ b/backend/src/auth/auth.service.ts
    @@
    -    await withScopedDb(this.dataSource, (manager) =>
    -      manager.query(
    -        `UPDATE users
    -            SET failed_login_attempts = 0, locked_until = NULL
    -          WHERE id = $1
    -            AND (failed_login_attempts <> 0 OR locked_until IS NOT NULL)`,
    -        [user.id],
    -      ),
    -    );
    +    await withScopedDb(this.dataSource, (manager) =>
    +      manager.query(
    +        `UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1`,
    +        [user.id],
    +      ),
    +    );
    +    user.failedLoginAttempts = 0;
    +    user.lockedUntil = null;
    @@ (trusted-device branch and final branch)
    -          user.lastLogin = new Date();
    -          await this.scoped(User, (repo) => repo.save(user));
    +          user.lastLogin = new Date();
    +          await this.scoped(User, (repo) =>
    +            repo.update({ id: user.id }, { lastLogin: user.lastLogin }),
    +          );
    ```
    Keeping the entity in step (`user.failedLoginAttempts = 0`) matters because `sanitizeUser(user)` and `generateTokenPair(user)` read it afterwards. Still to verify: `auth.service.spec.ts` (it mocks `save`), the probe as a permanent integration test, and the other whole-entity saves listed in section 9.
12. **Recommended regression test:** an integration test that seeds `failed_login_attempts = 4`, logs in successfully through `AuthService.login`, and asserts 0; plus one failed attempt afterwards asserts `locked_until IS NULL`.
13. **Suggested regression-test diff (illustrative, not applied):** the probe in section 1 (`a successful login leaves failed_login_attempts at 0`) moved into `test/integration/login-lockout.integration.spec.ts`, which already has the module set-up.
14. **Verification method:** that test, with the 2FA trusted-device variant (seed a trusted device) as a second case.
15. **Residual risks:** the same stale-snapshot `save(user)` shape exists on other credential paths (section 9, design risk D-S03-01); this diff fixes only the login path.

- **Causality class:** `PRE_EXISTING_UNREPORTED` (MON-M24 is the concurrent-failure lost increment, fixed; this is the success path overwriting the reset).


### A26-M02 - Change-password, admin reset/disable and owner-of-delegate reset end refresh sessions with one blanket UPDATE that misses a concurrently inserted successor

- **Canonical severity:** MEDIUM. kept MEDIUM.
- **Absorbs:** A26-S03-07 (primary, 03-security-auth.md, session severity MEDIUM).
- **Invariants and prior findings named:** INV-AUTH-005, INV-AUTH-004.
- **Lens:** security.

#### A26-S03-07 (primary) - Change-password, admin reset/disable and owner-of-delegate reset end refresh sessions with one blanket UPDATE, which misses a successor inserted by a concurrent rotation

1. **Severity:** MEDIUM
2. **Confidence:** high (executed against PostgreSQL 16)
3. **Location:** `backend/src/users/users.service.ts:479-485` (`update({ userId, isRevoked: false }, { isRevoked: true })` inside the password transaction); `backend/src/admin/admin.service.ts:723-733` (`revokeSessionsAndTokens`, used by reset at `:609`, and at `:445`, `:505`); `backend/src/delegation/delegation.service.ts:1530-1535`. Contrast `backend/src/auth/token.service.ts:313-361` (`revokeAllUserRefreshTokens`: capture families, lock each, re-revoke until a pass changes nothing), used by the email reset, 2FA reset, OIDC link and emergency claim.
4. **Violated invariant:** INV-AUTH-005 ("no ... refresh token ... issued before it keeps working") and the statement-snapshot rule recorded in `token.service.ts:126-131` and INV-AUTH-004: a single `UPDATE ... WHERE user_id = ? AND is_revoked = false` blocked on the row a rotation holds sees, after that rotation commits, the old row but not the replacement inserted after its snapshot.
5. **Reproduction:** an attacker holds a stolen refresh token and keeps refreshing it. The account owner changes their password from Settings (or an administrator resets it, or disables the account, or the owner of a delegate-only user resets it). If a rotation is in flight when the revoking UPDATE starts, the UPDATE waits on the rotating row, revokes it, and misses its successor. The password change reports success; the attacker's successor keeps rotating.
6. **Observed:** probe `AUDIT S03 probe: blanket per-user revoke vs rotation`, 60 rotate-versus-revoke pairs per run, two runs: the blanket statement (the exact `repo.update` these three paths issue) leaked a live token in `{"leaks":35}` and `{"leaks":34}` of 60 (an earlier run: 23); `revokeAllUserRefreshTokens` under the same harness leaked `{"leaks":0}` in both runs.
7. **Expected:** after the call resolves, no refresh token issued before it is live.
8. **Impact:** security. The remedy a user reaches for after suspecting theft -- change the password -- can leave the thief's session alive, and with A26-S03-01 the reuse alarm does not end it either. The window is the duration of one rotation, so an attacker who rotates on every allowed refresh (10 per minute) and a user who changes the password once have a small but real chance per change; the admin "disable account" path has the same gap.
9. **Root cause:** three call sites predate or bypass the converging helper and open-code the blanket statement the helper's comment explains is unsafe.
10. **Recommended correction:** after the commit, call `TokenService.revokeAllUserRefreshTokens(userId)` on all three paths (the change-password path may keep the in-transaction blanket UPDATE as a first pass; the post-commit convergence is what closes the gap). For change-password from Settings, pass the caller's refresh token as `keepSessionOf` only if the product wants the current session kept (today it is revoked too; keep that).
11. **Suggested remediation diff (illustrative, not applied):**
    ```diff
    --- a/backend/src/users/users.service.ts
    +++ b/backend/src/users/users.service.ts
    @@ changePassword
         await withScopedDb(this.dataSource, async (manager) => {
           await manager.getRepository(User).save(user);
           await manager
             .getRepository(RefreshToken)
             .update({ userId, isRevoked: false }, { isRevoked: true });
           await revokeStandingCredentials(manager, userId);
         });
    +    // The blanket UPDATE above has a statement-snapshot blind spot against a
    +    // concurrent rotation; converge after the commit (token.service.ts).
    +    await this.tokenService.revokeAllUserRefreshTokens(userId);
    --- a/backend/src/admin/admin.service.ts
    +++ b/backend/src/admin/admin.service.ts
    @@ private async revokeSessionsAndTokens(targetUserId: string)
         await withScopedDb(this.dataSource, async (manager: EntityManager) => {
    ...
         });
    +    await this.tokenService.revokeAllUserRefreshTokens(targetUserId);
         await this.oauthProviderService.revokeAllForUser(targetUserId);
    --- a/backend/src/delegation/delegation.service.ts
    +++ b/backend/src/delegation/delegation.service.ts
    @@ resetDelegatePassword
    +    await withSystemContext(() => this.tokenService.revokeAllUserRefreshTokens(delegate.id));
         await revokeOAuthGrantsAfterCommit(
    ```
    `UsersService`, `AdminService` and `DelegationService` need `TokenService` injected (check `module-graph.spec.ts` for a cycle; `forwardRef` per `backend/CLAUDE.md` if one appears). Still to verify: unit specs of the three services, the integration test below, and the context each call runs under (admin and delegation paths are under `withSystemContext` already; `users.service` runs in the caller's user context, which owns the rows).
12. **Recommended regression test:** the probe as a permanent integration test against each service method, not against the bare statement.
13. **Suggested regression-test diff (illustrative, not applied):**
    ```diff
    +it.each(["changePassword", "adminReset", "delegateReset"])(
    +  "%s leaves no live refresh token under a concurrent rotation", async (path) => {
    +    for (let i = 0; i < 40; i++) {
    +      const { refreshToken: t0 } = await withSystemContext(() => tokens.generateTokenPair(user, false));
    +      await Promise.allSettled([rotate(t0), sleep(i % 4).then(() => runPath(path))]);
    +      expect(await liveTokens(user.id)).toBe(0);
    +    }
    +  });
    ```
14. **Verification method:** that test; the probe's `revokeAllUserRefreshTokens` variant shows the expected result (0/60).
15. **Residual risks:** `revokeAllUserRefreshTokens` gives up after 10 passes with a warning; a client rotating faster than that is not realistic at a 10-per-minute throttle.

- **Causality class:** `PRE_EXISTING_UNREPORTED` (MON-M23 was raised for logout only; the same root cause on these three paths was not reported).
- **Rule 7 surfaces:** `users.service.ts` changePassword; `admin.service.ts` reset password, disable, delete (via `revokeSessionsAndTokens`); `delegation.service.ts` resetDelegatePassword.


### A26-M03 - Two tabs refreshing at once read as token theft: the family is revoked and every session ends with no explanation

- **Canonical severity:** MEDIUM. kept MEDIUM; remediated with A26-H01, whose fix makes this false positive more frequent (section 8).
- **Absorbs:** A26-S18-06 (primary, 18-frontend-core.md, session severity MEDIUM).
- **Invariants and prior findings named:** INV-AUTH-001.
- **Lens:** security.

#### A26-S18-06 (primary) - Two tabs refreshing at once read as token theft: the family is revoked and every session ends with no explanation

1. **Severity:** MEDIUM
2. **Confidence:** medium-high (static and deterministic once both requests carry the same cookie; not executed in a browser)
3. **Location:** `frontend/src/lib/api.ts:187-247` (per-tab single flight `isRefreshingToken`, no cross-tab coordination: no `BroadcastChannel`, `navigator.locks` or storage event in `lib/` or `store/`), `:109-119` (`attemptTokenRefresh` discards the response, so the 401 reason is lost); backend `backend/src/auth/token.service.ts:149-177` (rotation under `lockTokenFamily`; a revoked token is "reuse" and revokes the family, no grace for the immediately rotated token).
4. **Violated invariant:** INV-AUTH-001/004 are about theft; a legitimate concurrent refresh must not be indistinguishable from it, and a forced sign-out must say why (S03 hand-off).
5. **Reproduction:** two tabs (or the installed PWA and a tab) are open; the access token expires (laptop wakes, both tabs poll). Both tabs get 401 and each sends `POST /auth/refresh` with the same `refresh_token` cookie T1 before either response sets T2.
6. **Observed:** the first request rotates T1 -> T2 and revokes T1; the second, serialized behind the family lock, finds T1 revoked, revokes the whole family and answers 401 "Refresh token reuse detected". That tab logs out and `replace('/login')`s; the first tab's next refresh with T2 now fails too (family revoked). The login page shows the ordinary signed-out state.
7. **Expected:** one refresh per browser (a cross-tab lock, or a short server grace that answers the just-rotated token with the current one), and a distinct login-page message when the server reports reuse.
8. **Impact:** availability (every device session of the user ends, including the PWA), and the one real security signal the server has is shown to the user as a routine expiry, so an actual theft is never reported.
9. **Root cause:** refresh rotation is single-flight per tab only, and the client throws away the 401 body.
10. **Recommended correction:** serialize refresh across tabs with `navigator.locks.request('monize-refresh', ...)` (fallback: the current per-tab flight), retry the original request after another tab's refresh, and on a reuse 401 set a `sessionStorage` reason the login page renders.
11. **Suggested remediation diff (illustrative, not applied)**

```diff
--- a/frontend/src/lib/api.ts
+++ b/frontend/src/lib/api.ts
@@ -109,12 +109,26 @@
-async function attemptTokenRefresh(): Promise<boolean> {
+type RefreshOutcome = 'ok' | 'reuse' | 'failed';
+
+async function refreshOnce(): Promise<RefreshOutcome> {
   try {
     // Use raw axios to avoid interceptor recursion; refresh_token cookie sent automatically
     await axios.post('/api/v1/auth/refresh', {}, { withCredentials: true });
-    logger.info('Access token refreshed');
-    return true;
-  } catch (_) {
-    logger.warn('Token refresh failed');
-    return false;
+    return 'ok';
+  } catch (error) {
+    const message = (error as AxiosError<{ code?: string }>).response?.data?.code;
+    return message === 'REFRESH_TOKEN_REUSE' ? 'reuse' : 'failed';
   }
 }
+
+// One refresh per browser: a second tab waiting on the lock finds the cookie
+// already rotated and its own request then succeeds with it.
+async function attemptTokenRefresh(): Promise<boolean> {
+  const run = () => refreshOnce();
+  const outcome = typeof navigator !== 'undefined' && navigator.locks
+    ? await navigator.locks.request('monize-token-refresh', run)
+    : await run();
+  if (outcome === 'reuse') markSessionRevokedForReuse();
+  return outcome === 'ok';
+}
```

   A waiting tab still sends T1 after the lock is released unless it first re-tries the original request (which now carries the rotated access cookie); the diff needs that "retry before refresh" step, and the backend needs a stable error code (the message is translated). Maintainer decision: client lock, server grace window, or both.
12. **Recommended regression test:** a Playwright two-page test in one context that expires the access cookie and fires a request from both pages; both pages must stay signed in.
13. **Suggested regression-test diff:** incomplete (needs an E2E fixture that can expire the access cookie; `e2e/` has none today).
14. **Verification:** the E2E case above; a backend integration case with two concurrent refreshes of one token under a grace rule, if chosen.
15. **Residual risks:** a grace window weakens reuse detection by its width; the lock alone does not cover two browsers on one account (no shared cookie, so no collision). Causality: `PRE_EXISTING_UNREPORTED`.


### A26-M04 - Grantee and cross-owner writes are authorized in earlier transactions and written under the system bypass without a re-check

- **Canonical severity:** MEDIUM. kept MEDIUM: cross-tenant, but the owner chooses the revoke and nobody can time the window (S04's reasoning stands).
- **Absorbs:** A26-S04-01 (primary, 04-rls-tenancy.md, session severity MEDIUM).
- **Invariants and prior findings named:** none in the index (see field 4 of each member).
- **Lens:** security.

#### A26-S04-01 (primary) - Grantee and cross-owner writes are authorized in earlier transactions and written under the system bypass without a re-check, so a write lands in the owner's ledger after the owner's revoke has committed

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


### A26-M05 - Delegation management reads in one transaction and writes back the stale entity in another: a revoked delegation is re-instated

- **Canonical severity:** MEDIUM. kept MEDIUM.
- **Absorbs:** A26-S04-02 (primary, 04-rls-tenancy.md, session severity MEDIUM).
- **Invariants and prior findings named:** none in the index (see field 4 of each member).
- **Lens:** security.

#### A26-S04-02 (primary) - Delegation management reads in one transaction and writes back the stale entity with a whole-entity `save` in another: a revoked delegation is re-inserted, and an owner rotates a login another owner has just linked

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


### A26-M06 - The `account_delegates` and `account_delegate_grants` policies let a delegate-side session issue itself a delegation from any owner

- **Canonical severity:** MEDIUM. kept MEDIUM: the RLS containment fails, but no current application path reaches it without a second defect.
- **Absorbs:** A26-S04-03 (primary, 04-rls-tenancy.md, session severity MEDIUM).
- **Invariants and prior findings named:** none in the index (see field 4 of each member).
- **Lens:** security.

#### A26-S04-03 (primary) - The `account_delegates` and `account_delegate_grants` policies let a delegate-side session issue itself a delegation from any owner, which the joint read arms then turn into a read of that owner's accounts and transactions

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


### A26-M07 - Automatic-backup retention deletes legacy flat-root artifacts of other owners (MON-H01 residual, MON-M43)

- **Canonical severity:** MEDIUM. kept MEDIUM: loss of other users' pre-upgrade recovery points, a one-time population; live data and the sharded layout are unaffected. Not raised to HIGH because current recovery points keep being written.
- **Absorbs:** A26-S06-01 (primary, 06-backup-restore.md, session severity MEDIUM); A26-S02-06 (superseded, 02-prior-high-triage.md, session severity MEDIUM).
- **Invariants and prior findings named:** INV-BACKUP-001, MON-H01, MON-M43.
- **Lens:** data.

#### A26-S06-01 (primary) - Automatic-backup retention deletes legacy flat-root artifacts of other owners (MON-H01 residual, MON-M43; carries A26-S02-06)

1. **Severity:** MEDIUM
2. **Confidence:** high (executed: mutation M1)
3. **Location:** `backend/src/backup/auto-backup.service.ts:2253-2311` (sort tie-break `:2297`, comment `:2256-2263`); `backend/src/backup/storage/local-backup-storage.target.ts:335-341` (`list` returns the flat base as `legacy: true`), `:427-434` (`remove` deletes there); specs `auto-backup.service.spec.ts:3870`, `:3907`.
4. **Violated invariant:** INV-BACKUP-001 "namespaced by owner": one owner's retention pass never deletes another owner's artifact.
5. **Realistic reproduction scenario:** a deployment upgraded from the pre-sharding layout holds `monize-backup-daily-*.json.gz` files of several users directly in `BACKUP_CONTAINER_DIR`. Any user's next run (cron or the admin's "Run Backup Now" fan-out, which runs every account) lists those files as its own `legacy` entries and `deleteExcess` removes every one past that user's `retentionDaily`.
6. **Observed:** the flat files are deleted by whichever account runs first; on an equal date the legacy copy is preferred for deletion. Two tests assert this as correct.
7. **Expected:** an artifact whose owner cannot be recovered from its name is never deleted by a per-user pass; it is left for an explicit operator action.
8. **Impact:** loss of other users' only pre-upgrade recovery points (encrypted or plaintext), silently, the first hour after the upgrade. Recovery and data-integrity impact on a one-time population; no ongoing cross-owner effect on the sharded layout.
9. **Root cause:** the owner ambiguity of a legacy name is resolved by sweeping instead of refusing; `open()` already refuses legacy entries for the same reason (`:392-395`), so the two methods disagree about whether a legacy file belongs to the caller.
10. **Recommended correction:** exclude `legacy` entries from `deleteExcess`; document the flat root as operator-owned (a one-line release note and a log line counting what is left).
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/backup/auto-backup.service.ts
+++ b/backend/src/backup/auto-backup.service.ts
@@ -2290,9 +2290,11 @@
     const deleteExcess = async (tier: BackupTier, limit: number) => {
       if (!tiers.includes(tier)) return;
+      // A legacy flat-root file names no owner, so it is never this user's to
+      // delete (open() refuses it for the same reason).
       const sorted = files
-        .filter((f) => f.tier === tier)
+        .filter((f) => f.tier === tier && !f.entry.legacy)
         .sort(
           (a, b) =>
-            b.date.getTime() - a.date.getTime() ||
-            Number(a.entry.legacy) - Number(b.entry.legacy),
+            b.date.getTime() - a.date.getTime(),
         );
```

12. **Recommended regression test:** invert `auto-backup.service.spec.ts:3870` and `:3907`: legacy files survive any user's retention, and a sharded file is still pruned to the limit.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
-    it("counts files left flat in the base folder by an older version", async () => {
+    it("never deletes a file left flat in the base folder by an older version", async () => {
 ...
-      for (const name of legacyNames) {
-        await expect(fs.access(join(root, name))).rejects.toThrow();
-      }
+      for (const name of legacyNames) {
+        await expect(fs.access(join(root, name))).resolves.toBeUndefined();
+      }
```

14. **Verification method:** `TZ=UTC npm run test:unit -- auto-backup`; M1 shows exactly these two tests change verdict.
15. **Residual risks / patch limitations:** legacy files then accumulate until an operator removes them; the instance-namespace half (two deployments sharing one directory or bucket prefix with the same user ids) is a design decision, section 9.

Causality: `PRIOR_REPORTED`, `CONFIRMED_WITH_DIFFERENT_ROOT_CAUSE` (MON-H01 residual; MON-M43 narrowed to the two legacy tests). Rule 7 surfaces: cron path and manual fan-out, both through `applyBackupOutcome -> enforceRetention`.

#### A26-S02-06 (superseded) - Automatic-backup retention deletes legacy flat-root artifacts of other owners; keys carry no instance namespace (MON-H01 residual; MON-M43 narrowed)

Superseded by the primary above: same root cause, and its scenario is one surface of the primary's reproduction. Full text: `02-prior-high-triage.md` section 4.


### A26-M08 - The S3 half of INV-BACKUP-006 rests on a suite that never runs in CI and fails when it does; no local/S3 attachment round trip exists (MON-M47)

- **Canonical severity:** MEDIUM. kept MEDIUM; A26-S06-05 (LOW) is the same storage-target fidelity gap and is absorbed.
- **Absorbs:** A26-S06-02 (primary, 06-backup-restore.md, session severity MEDIUM); A26-S06-05 (merged surface, 06-backup-restore.md, session severity LOW).
- **Invariants and prior findings named:** INV-BACKUP-006, INV-ATTACHMENT-001, MON-H02, MON-M47.
- **Lens:** test.

#### A26-S06-02 (primary) - The S3 half of INV-BACKUP-006 rests on an integration suite that never runs in CI and fails when it does

1. **Severity:** MEDIUM (verification defect)
2. **Confidence:** high (executed against an S3-compatible endpoint)
3. **Location:** `backend/test/integration/backup-store-s3.integration.spec.ts:21-41` (gate on `BACKUP_STORE_S3_TEST_ENDPOINT`), `:160-185` (test defect); `.github/workflows/ci.yml` (no MinIO service, no endpoint variable: `grep -i minio` returns nothing); `docs/system-invariants.md` INV-BACKUP-006 "Required tests ... Integration against MinIO", status `enforced`.
4. **Violated invariant:** `docs/release-integrity.md` / verification contract: a property listed as enforced by a test is enforced by a test that runs and passes.
5. **Realistic reproduction scenario:** run the suite with an endpoint: `BACKUP_STORE_S3_TEST_ENDPOINT=http://127.0.0.1:9000 npm run test:integration -- backup-store-s3` (bucket `monize-store-test` created).
6. **Observed:** 7 passed, 2 failed. (a) "carries one hourly cycle end to end" names its dailies `monize-backup-daily-2026-09-${day}` with `day` unpadded (8, 9, 10..14), prunes by `localeCompare`, and so keeps `09-8` and `09-9` as "newest": the test's own pruning is wrong, independent of the emulator. The production names are zero-padded (`getLocalDateString`, `en-CA` 2-digit), so this is a test defect, not a code defect. (b) "is refused by the destination when the declared checksum does not match" resolved: moto does not validate `ChecksumSHA256`. That is an emulator limitation, but it also shows the invariant text's claim "where an S3-compatible service ignores the checksum header we learn it from a rejected put, not from a silent acceptance" is false for at least one S3-compatible implementation: an ignoring service accepts silently.
7. **Expected:** the suite runs in the `backend-integration-tests` job (the comment at `:23-27` says that is where it is meant to run) and passes; or INV-BACKUP-006 records the S3 half as `partial` until it does.
8. **Impact:** the only bucket-backed evidence for atomic publish, promotion and prune on S3 has never executed green; a regression in `s3-backup-storage.target.ts` would ship. Operations: an S3-compatible store that ignores checksums gives no integrity check on publish, contrary to the invariant text.
9. **Root cause:** an environment-gated suite with no CI job that sets the gate, plus a fixture that was never run.
10. **Recommended correction:** add the MinIO service and the variable to the integration job (an agreed `.github/` change, out of this audit's scope), fix the fixture to zero-pad, and reword the checksum sentence to "a store that ignores the header accepts silently; only AWS S3 and MinIO are known to validate".
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/test/integration/backup-store-s3.integration.spec.ts
+++ b/backend/test/integration/backup-store-s3.integration.spec.ts
-      const dailies = [8, 9, 10, 11, 12, 13, 14].map(
-        (day) => `monize-backup-daily-2026-09-${day}.mzbe`,
-      );
+      const dailies = [8, 9, 10, 11, 12, 13, 14].map(
+        (day) => `monize-backup-daily-2026-09-${String(day).padStart(2, "0")}.mzbe`,
+      );
--- a/docs/system-invariants.md
+++ b/docs/system-invariants.md
-                    S3-compatible service ignores the checksum header we learn
-                    it from a rejected put, not from a silent acceptance.
+                    S3-compatible service ignores the checksum header, the put
+                    is accepted silently; the integration suite against MinIO
+                    is what shows the configured store validates it.
```

12. **Recommended regression test:** the existing suite, run in CI with the endpoint set.
13. **Suggested regression-test diff:** the fixture fix above; the CI service block is a `.github/` change for the maintainer.
14. **Verification method:** the command in field 5 against MinIO: 9 passed.
15. **Residual risks / patch limitations:** not re-run against MinIO here (no image reachable); case (b) is expected to pass on MinIO and remains unverified in this session.

Causality: `NEW_SINCE_UPSTREAM_AUDIT` (the S3 store target and its suite postdate `d5cea9bf`). Handed to S21 for the CI half.

#### A26-S06-05 (merged surface) - The repository still has no local/S3 attachment backup-restore round trip (MON-M47)

1. **Severity:** LOW (missing test; the behaviour itself was executed and holds)
2. **Confidence:** high
3. **Location:** `backend/test/integration/backup-restore.integration.spec.ts` (database provider only, via `attachmentStorageProviders()`, `test/helpers/integration-setup.ts:502-516`); `backend/src/backup/backup.service.spec.ts` (mocked storage).
4. **Violated invariant:** INV-ATTACHMENT-001 and MON-H02's fix: a restored external attachment downloads the same bytes under its remapped key.
5. **Realistic reproduction scenario:** revert the carried-bytes branch of `stageAttachmentObjects` for external providers; every repository suite stays green because none restores onto `local` or `s3`.
6. **Observed:** no repository test uses `LocalStorageProvider` or `S3StorageProvider` in a restore.
7. **Expected:** the six cases of the scratch spec (R1..R6) in the repository, parameterized over `local` (real tmpdir) and, where an endpoint is set, `s3`.
8. **Impact:** regression risk on the path MON-H02 fixed.
9. **Root cause:** the shared harness binds the database provider because it "needs no extra config".
10. **Recommended correction:** add the parameterized spec.
11. **Suggested remediation diff:** `<scratchpad>/s06-roundtrip.integration.spec.ts` lines 1-30 (provider factory) and R1..R3, R6; R4 and R5 belong to A26-S06-03 and section 9.
12. **Recommended regression test:** as 10.
13. **Suggested regression-test diff:** as 11.
14. **Verification method:** `S06_PROVIDER=local npm run test:integration -- <spec>`: 6 passed here; `S06_PROVIDER=s3` with an endpoint: 6 passed here.
15. **Residual risks / patch limitations:** the S3 variant needs the CI endpoint of A26-S06-02.

Causality: `PRIOR_REPORTED`, `CONFIRMED` (MON-M47, still open).


### A26-M09 - VOID crossings are decided from a status read before the row lock (bulk VOID expansion and `addSplit`; MON-H10 residual)

- **Canonical severity:** MEDIUM. kept MEDIUM.
- **Absorbs:** A26-S07-03 (primary, 07-cash-ledger.md, session severity MEDIUM); A26-S02-07 (superseded, 02-prior-high-triage.md, session severity MEDIUM).
- **Invariants and prior findings named:** INV-TRANSFER-001, MON-H10.
- **Lens:** concurrency.

#### A26-S07-03 (primary) - VOID crossings decided from a status read before the row lock (bulk VOID expansion and `addSplit`; MON-H10 residual)

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

#### A26-S02-07 (superseded) - Bulk VOID decides the mirror-leg expansion from statuses read before the row lock (MON-H10 residual race)

Superseded by the primary above: same root cause, and its scenario is one surface of the primary's reproduction. Full text: `02-prior-high-triage.md` section 4.


### A26-M10 - `PATCH /transactions/:id` changes the amount, rate or account of one transfer leg only (MON-H11 server residual)

- **Canonical severity:** MEDIUM. kept MEDIUM: reached by REST, PAT and the joint register, not by the transfer form; S07 and S17 agree on the mechanism (section 17.2).
- **Absorbs:** A26-S07-04 (primary, 07-cash-ledger.md, session severity MEDIUM).
- **Invariants and prior findings named:** MON-H11.
- **Lens:** financial.

#### A26-S07-04 (primary) - `PATCH /transactions/:id` changes the amount, rate or account of one transfer leg only (MON-H11 residual)

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


### A26-M11 - The strict reconciled lock is skipped on split-transfer leg and cross-owner transfer edits and deletes

- **Canonical severity:** MEDIUM. kept MEDIUM.
- **Absorbs:** A26-S07-05 (primary, 07-cash-ledger.md, session severity MEDIUM); A26-S02-08 (superseded, 02-prior-high-triage.md, session severity MEDIUM).
- **Invariants and prior findings named:** INV-RECONCILE-001.
- **Lens:** financial.

#### A26-S07-05 (primary) - The strict reconciled lock is skipped on split-transfer leg and cross-owner transfer edits and deletes

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

#### A26-S02-08 (superseded) - Editing a split-transfer leg bypasses the strict reconciled lock

Superseded by the primary above: same root cause, and its scenario is one surface of the primary's reproduction. Full text: `02-prior-high-triage.md` section 4.


### A26-M12 - An account closes over a pending future-dated row, which the due-balance cron later applies to the closed account (MON-M20 residual)

- **Canonical severity:** MEDIUM. kept MEDIUM.
- **Absorbs:** A26-S07-06 (primary, 07-cash-ledger.md, session severity MEDIUM).
- **Invariants and prior findings named:** MON-M20.
- **Lens:** financial.

#### A26-S07-06 (primary) - An account closes over a pending future-dated row, which the due-balance cron later applies to the closed account (MON-M20 residual)

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


### A26-M13 - A whole-entity save or an absolute write puts a snapshot's `current_balance` back: investment-pair rename or re-currency, QIF/CSV opening balance

- **Canonical severity:** MEDIUM. MEDIUM for the group; A26-S10-05 (LOW) is the same "balance updates are atomic SQL" violation on the import path and is absorbed.
- **Absorbs:** A26-S07-07 (primary, 07-cash-ledger.md, session severity MEDIUM); A26-S10-05 (merged surface, 10-rules-banksync-csv.md, session severity LOW).
- **Invariants and prior findings named:** INV-BALANCE-001, MON-H07.
- **Lens:** concurrency.

#### A26-S07-07 (primary) - Renaming or re-currencying an investment pair writes back the linked half's stale `current_balance`

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

#### A26-S10-05 (merged surface) - The QIF/CSV opening balance is an absolute, unlocked balance write from a snapshot read in another transaction, rounded to 2 dp

1. **Severity:** LOW
2. **Confidence:** medium (static)
3. **Location:** `backend/src/import/import-entity-creator.service.ts:379-398`; callers `backend/src/import/import.service.ts:1251-1255` (the account read in its own `withScopedDb`), `:1407-1414`; multi-account `:404-406, 464-471` (read in the transaction, not locked).
4. **Violated invariant:** INV-BALANCE-001 / MON-H07 (an absolute balance write under the account lock from a current read); "Money is `decimal(20,4)`".
5. **Reproduction:** account with opening 0 and current 500. The import reads it; a transaction of -100 commits (current 400); the import writes `current = 500 - 0 + 1000 = 1500` instead of 1400. A file opening balance of `100.1234` is stored as `100.12`.
6. **Observed:** `current_balance` is wrong by the concurrent delta until the post-processing recompute (`import-post-processing.service.ts:68-101`, locked) rewrites it after the commit; if that recompute fails (logged as an error), it stays wrong. `opening_balance` keeps the 2 dp value permanently, and the recompute adds it, so the balance is off by up to 0.0049.
7. **Expected:** the opening balance written at 4 dp, and `current_balance` moved by `newOpening - oldOpening` as an atomic delta (or left to the recompute) under the account lock.
8. **Impact:** narrow: a transient wrong balance and a sub-cent persistent difference for files with 4 dp opening balances.
9. **Root cause:** a pre-delta-era absolute write kept in the import path.
10. **Recommended correction:** write `opening_balance` with `roundMoney`, and the current balance as an atomic delta of the opening change.
11. **Suggested remediation diff (illustrative, not applied)**

```diff
--- a/backend/src/import/import-entity-creator.service.ts
+++ b/backend/src/import/import-entity-creator.service.ts
   async applyOpeningBalance(
     manager: EntityManager,
     accountId: string,
-    account: Account,
+    userId: string,
     openingBalance: number,
   ): Promise<void> {
-    const existingOpeningBalance = Number(account.openingBalance) || 0;
-    const existingCurrentBalance = Number(account.currentBalance) || 0;
-    const newOpeningBalance = Math.round(openingBalance * 100) / 100;
-    const newCurrentBalance = ...
-    await manager.update(Account, accountId, {
-      openingBalance: newOpeningBalance,
-      currentBalance: newCurrentBalance,
-    });
+    await lockAccountsForBalanceWrite(manager, [accountId], userId);
+    const [row] = await manager.query(
+      `SELECT opening_balance FROM accounts WHERE id = $1`,
+      [accountId],
+    );
+    const newOpening = roundMoney(openingBalance);
+    const delta = roundMoney(newOpening - Number(row?.opening_balance ?? 0));
+    await manager.query(
+      `UPDATE accounts SET opening_balance = $2,
+              current_balance = current_balance + $3
+        WHERE id = $1`,
+      [accountId, newOpening, delta],
+    );
   }
```

   The lock must stay after `lockImportedHoldingScopes` (advisory first, `import.service.ts:1336-1337`).
12. **Recommended regression test:** `import-balance-delta.integration.spec.ts`: an opening balance of `100.1234` and a concurrent delta on a second connection; expect opening `100.1234` and current equal to the ledger.
13. **Suggested regression-test diff:** omitted (LOW); the case above in that suite's style.
14. **Verification:** `npm run test:integration -- import-balance-delta`.
15. **Residual risks:** none beyond the post-processing step's own failure path.

Causality: `PRE_EXISTING_UNREPORTED` (S02 hand-off `applyOpeningBalance`; MON-H07 itself is FIXED_VERIFIED by S07 for the recompute paths).


### A26-M14 - An error after a single-use write commits is reported as a failure, so the offered retry writes again (scheduled post and its cron alert, AI action confirm)

- **Canonical severity:** MEDIUM. kept MEDIUM: needs a post-commit failure to start; each duplicate is one row, visible and recoverable. Shares the class of A26-H08, which is HIGH because a whole file is duplicated.
- **Absorbs:** A26-S08-02 (primary, 08-scheduler-cron.md, session severity MEDIUM); A26-S17-02 (merged surface, 17-ai-mcp-notifications.md, session severity MEDIUM).
- **Invariants and prior findings named:** INV-OCCURRENCE-001, INV-MCP-004.
- **Lens:** concurrency.

#### A26-S08-02 (primary) - An error after the posting commit is reported as "could not be posted": the cron raises a false alert telling the user to post manually, and the HTTP caller sees a failure for a committed post

1. **Severity:** MEDIUM
2. **Confidence:** high (executed, P6)
3. **Location:** `backend/src/scheduled-transactions/scheduled-transactions.service.ts:3743-3767` (post-commit `completeTransfer`, `recalculateLoanPaymentSplits`, `findOne` inside `post()`); classification `:628-728` (only `ConflictException` and a vanished schedule are "skipped"; every other error raises `SCHEDULED_POST_FAILED` with "You can post it manually from Bills").
4. **Violated invariant:** a reported failure means nothing was written (the "rejection before write" rule read in reverse: a caller must be able to tell "not posted" from "posted, follow-up failed"); INV-OCCURRENCE-001 through its consequence.
5. **Realistic reproduction scenario:** a split schedule (any `splits.length > 0`, loan templates included) due 2026-09-01 auto-posts; the post-commit `recalculateLoanPaymentSplits` fails (a lock timeout or deadlock against a concurrent ledger writer, a connection drop). For a transfer schedule the same holds for `completeTransfer` (two `findOne` reads and the history write).
6. **Observed implementation behavior (executed, failure injected into the post-commit recalculation):** the September row is committed and the cursor advanced to 2026-10-01, yet the cron raised "Rent could not be posted" (`SCHEDULED_POST_FAILED`). On the manual path the first `post()` rejected with the injected error after committing October; the user's retry posted again: three rows (2026-09-01, 2026-10-01, 2026-10-01), claims through 2026-11-01, balance -50.00 instead of 0.00.
7. **Expected behavior:** the posting succeeds as far as the caller is concerned; the follow-up failure is logged (and, for the loan recalculation, retried by the next posting's re-resolution, which already exists) without changing the outcome reported.
8. **Impact:** the alert text instructs the exact action that books the bill a second time (A26-S08-01); the HTTP error invites a retry with the same result. -50.00 per occurrence in the example, 100 % of the bill.
9. **Root cause:** the post-commit half of `post()` propagates its errors through the same promise as the posting itself; neither the cron's classifier nor the client can distinguish them.
10. **Recommended correction:** catch and log the post-commit half inside `post()` (it is best-effort by design: the net-worth recalculation and the loan template are both re-derived later), and return the posted schedule; keep the error path only for failures before the commit.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/scheduled-transactions/scheduled-transactions.service.ts
+++ b/backend/src/scheduled-transactions/scheduled-transactions.service.ts
@@ post()
-    if (preparedTransfer && writtenTransfer) {
-      await this.transactionsService.completeTransfer(
-        preparedTransfer,
-        writtenTransfer.savedFromId,
-        writtenTransfer.savedToId,
-      );
-    }
+    // Everything below runs after the occurrence committed. A failure here must
+    // not be reported as "not posted": the cron would alert the user to post
+    // it again, and a client would retry an operation that already happened.
+    await this.afterPostCommit(id, async () => {
+      if (preparedTransfer && writtenTransfer) {
+        await this.transactionsService.completeTransfer(
+          preparedTransfer,
+          writtenTransfer.savedFromId,
+          writtenTransfer.savedToId,
+        );
+      }
+    });
@@
-    if (scheduled.splits && scheduled.splits.length > 0) {
-      await this.loanService.recalculateLoanPaymentSplits(id);
-    }
+    if (scheduled.splits && scheduled.splits.length > 0) {
+      await this.afterPostCommit(id, () =>
+        this.loanService.recalculateLoanPaymentSplits(id),
+      );
+    }
@@
+  private async afterPostCommit(id: string, fn: () => Promise<unknown>): Promise<void> {
+    try {
+      await fn();
+    } catch (error) {
+      this.logger.error(
+        `Scheduled transaction ${id} posted; a follow-up step failed and is left to the next run`,
+        error instanceof Error ? error.stack : error,
+      );
+    }
+  }
```

   Self-check: the final `return this.findOne(userId, id)` can still throw (schedule deleted concurrently); the cron already treats a vanished schedule as skipped. A failed `completeTransfer` loses the transfer's tags and history entry (pre-existing post-commit property); the money and the claim are already consistent. Needs: unit tests for both paths, the P6 probe as an integration case.
12. **Recommended regression test:** inject a failure into the post-commit recalculation; assert the cron raises no `SCHEDULED_POST_FAILED`, `post()` resolves, and a manual retry with the pin of A26-S08-01 is refused.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+  it("a failure after the commit is not reported as a failed posting", async () => {
+    loan.recalculateLoanPaymentSplits.mockRejectedValueOnce(new Error("lock timeout"));
+    await service.processAutoPostTransactions();
+    expect(alerts.raiseUserAlert).not.toHaveBeenCalled();
+    expect(await ledger()).toMatchObject({ n: 1, sum: -50 });
+  });
```

14. **Verification method:** that case in the integration spec of A26-S08-05; `npm run test:unit -- scheduled-transactions.service`.
15. **Residual risks / patch limitations:** the AI-action and email-receipt callers of `post()` also see a resolved promise afterwards, which is the intended change; a caller that relied on the throw to roll back its own outer transaction cannot (the posting already committed in its own `withScopedDb` unless nested), so the nesting of those callers should be re-checked (S17, S11).

Causality: `NEW_SINCE_UPSTREAM_AUDIT` (the single-transaction posting with a post-commit half is the MON-H06 fix).

#### A26-S17-02 (merged surface) - A failure after the write commits releases the AI action's single-use claim, so the card's "Retry" writes the same transaction a second time

1. **Severity:** MEDIUM
2. **Confidence:** high (executed, P2; mechanism read end to end)
3. **Location:** `backend/src/ai/actions/ai-actions.service.ts:224-280` (`confirm`: claim, `execute`, and on ANY throw `singleUseTokens.release`), `:921-949` (`executeCreateTransaction`: `transactionsService.create` commits in its own `withScopedDb`, then `persistAttachments`), `:754-812` (same order on update), `:909-919` (`persistAttachments` -> `attachmentsService.create`, which can throw on storage failure, the per-transaction cap under the row lock, or a refused upload); frontend `frontend/src/store/aiChatStore.ts:730-733` (an `error` action is sendable again) and `frontend/src/components/ai/ConfirmationCardShell.tsx:65-71` ("Retry" re-sends the same signed descriptor). MCP sibling: `backend/src/mcp/tools/transactions.tool.ts:1130-1153` (`create` commits, `writeLimiter.record`, then `persistAttachmentsDirect`; a throw there reaches the model as the generic `safeToolError`, `mcp-context.ts:174`).
4. **Violated invariant:** INV-MCP-004 / the single-use confirmation the claim implements ("a descriptor commits once"); `docs/external-side-effects.md` ordering (a failure must not leave the user told "not done" for a write that is done); `docs/concurrency-and-idempotency.md` retry after commit.
5. **Realistic reproduction scenario:** a user drops a receipt photo into the chat and asks the assistant to record a 245.80 PLN purchase with the photo attached. The card shows the transaction and the attachment; the user confirms. The attachment store (S3 or the local volume) refuses the put, or another upload to the same transaction fills the tenth slot between the card and the confirm (update path). The transaction has committed; the card turns red with the storage error and a "Retry" button.
6. **Observed implementation behavior (P2):** the first `confirm` creates the transaction, `attachments.create` throws, the claim is released, the error reaches the card; the second `confirm` with the same `actionId` and signature passes the claim and calls `transactionsService.create` again: `creates= 2`. On the MCP path the model is told "An error occurred while processing your request" after the row exists and the cap was charged; its documented response to an error is to retry, which asks the human again for a change that is already in the ledger.
7. **Expected behavior:** once the ledger write has committed, the descriptor is spent: the claim stays taken, the attachment failure is reported as "saved, but the file could not be attached" with the transaction id, and a retry attaches the file to that transaction rather than creating another.
8. **Impact:** a duplicate transaction of the full amount (balance moved twice: 245.80 PLN extra, 100 percent), with no daily-cap charge for the first one (`record` is skipped on the throw), on a path the UI invites the user to take. Recoverable by deleting the duplicate if noticed.
9. **Root cause:** the claim-release rule ("released when the write throws, so a transient failure leaves the descriptor confirmable") treats `execute` as atomic, but `execute` is a committed write followed by a separate external side effect.
10. **Recommended correction:** release the claim only when the failure happened before the ledger write committed: split `execute` into the write (inside which a throw releases) and the post-commit steps (whose failure keeps the claim and returns a partial result), and on MCP return a structured partial success naming the created id.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/ai/actions/ai-actions.service.ts
+++ b/backend/src/ai/actions/ai-actions.service.ts
@@ executeCreateTransaction
     const transaction = await this.transactionsService.create(userId, dto, {
       createPayeeIfMissing: descriptor.createPayee === true,
     });
-    await this.persistAttachments(userId, transaction.id, files, refIds);
-    return { type: "create_transaction", id: transaction.id };
+    // The ledger write has committed: from here a failure must not make the
+    // descriptor confirmable again (a retry would create a second transaction).
+    const attachmentError = await this.persistAttachments(
+      userId, transaction.id, files, refIds,
+    ).then(() => null, (err: unknown) => err);
+    return {
+      type: "create_transaction",
+      id: transaction.id,
+      ...(attachmentError ? { attachmentsFailed: files.length } : {}),
+    };
   }
@@ executeUpdateTransaction
-    await this.persistAttachments(userId, transaction.id, files, refIds);
-    return { type: "update_transaction", id: transaction.id };
+    const attachmentError = await this.persistAttachments(
+      userId, transaction.id, files, refIds,
+    ).then(() => null, (err: unknown) => err);
+    return {
+      type: "update_transaction",
+      id: transaction.id,
+      ...(attachmentError ? { attachmentsFailed: files.length } : {}),
+    };
--- a/backend/src/mcp/tools/transactions.tool.ts
+++ b/backend/src/mcp/tools/transactions.tool.ts
@@ manageCreateSplit (and the other direct commits that attach)
-    const attachments =
-      attachmentDtos && attachmentRefs
-        ? await this.persistAttachmentsDirect(...)
-        : undefined;
+    let attachments: { id: string; filename: string }[] | undefined;
+    let attachmentsFailed = false;
+    if (attachmentDtos && attachmentRefs) {
+      try {
+        attachments = await this.persistAttachmentsDirect(...);
+      } catch {
+        attachmentsFailed = true; // the transaction exists; do not invite a retry
+      }
+    }
     return toolResult({
       id: tx.id,
       date: tx.transactionDate,
       count: 1,
       ...(attachments ? { attachments } : {}),
+      ...(attachmentsFailed ? { attachmentsFailed: true } : {}),
     });
```

The `ConfirmActionResult` type, the card's confirmed state ("saved; the file was not attached") and the i18n key are the remaining layers; the design decision for the maintainer is whether a failed attachment should instead be retried from a stored ref (the parked bytes live until the relay store's TTL).
12. **Recommended regression test:** `ai-actions.service.spec.ts`: `attachments.create` rejects once; the first confirm resolves with `attachmentsFailed`; a second confirm with the same dto is refused by the claim and `transactions.create` was called once. An integration variant against `single_use_tokens` (`ai-action-replay.integration.spec.ts` is the harness).
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+    it("keeps the claim when the transaction committed and the attachment failed", async () => {
+      attachmentStore.get.mockResolvedValue({ data: FILE_BYTES });
+      attachments.create.mockRejectedValueOnce(new Error("S3 unavailable"));
+      const dto = dtoFor(createTxDescriptor({ attachments: [attachmentRef()] }));
+      const first = await service.confirm(USER, dto);
+      expect(first).toMatchObject({ id: "tx-new", attachmentsFailed: 1 });
+      await expect(service.confirm(USER, dto)).rejects.toThrow(BadRequestException);
+      expect(transactions.create).toHaveBeenCalledTimes(1);
+    });
```

14. **Verification method:** the unit case above (fails at the baseline: P2 shows two creates); `ai-action-replay.integration.spec.ts` extended with a post-commit failure; the frontend card test for the partial state.
15. **Residual risks / patch limitations:** a throw from the domain service AFTER its own commit (for example a post-commit recompute that rejects) has the same shape; the patch covers only the attachment step. A26-S08-02's change to `ScheduledTransactionsService.post` (resolve after a post-commit failure) closes the scheduled branch of `executeCreateInvestmentTransaction`, where the signed due date already refuses a replay.

Causality: `NEW_SINCE_UPSTREAM_AUDIT` (the single-use claim row replaced the in-memory `Map` after 2026-08; the attachment path on cards is new). Rule 7 surfaces: AI `create_transaction` and `update_transaction` confirm; MCP direct commits that attach.


### A26-M15 - `post()` advances the cursor past its own slot only, so a slot a settlement rule claimed ahead of the cursor becomes `next_due_date` and the schedule stalls

- **Canonical severity:** MEDIUM. kept MEDIUM; S15's D2 reading of slot selection is recorded in section 17.2.
- **Absorbs:** A26-S08-03 (primary, 08-scheduler-cron.md, session severity MEDIUM).
- **Invariants and prior findings named:** INV-CRON-001.
- **Lens:** financial.

#### A26-S08-03 (primary) - `post()` advances the cursor past its own slot only, so a slot a settlement rule claimed ahead of the cursor becomes `next_due_date` and the schedule is stuck: every tick is skipped silently and every manual post is refused

1. **Severity:** MEDIUM
2. **Confidence:** high (executed, P4)
3. **Location:** `backend/src/scheduled-transactions/scheduled-transactions.service.ts:3739` (`advanceScheduleCursor(m, current, new Set([nextDueDateStr]))`); contrast `loan-installments/claim-loan-occurrence.ts:150-180` (the rule's advance reads every claim on or after the cursor); slot selection `loan-installments/occurrence-slots.ts:96-140, 255-285` (the nearest free slot, cursor and later slots included); classification `scheduled-transactions.service.ts:629-636` (a `ConflictException` counts as "claimed elsewhere", no alert).
4. **Violated invariant:** `schedule-cursor.ts`'s own contract, "the cursor steps past every consecutive claimed slot so the bill never offers an occurrence whose own claim key is taken"; INV-CRON-001 (one effect per tick, here zero forever with no report).
5. **Realistic reproduction scenario:** a loan bill (manual or auto-post) whose 2026-08-01 installment is not yet posted; the bank row for the September installment arrives dated in late August and the `settle_loan_installment` rule claims slot 2026-09-01 (nearest free slot; `cursorAdvanced = false`). The August installment is then posted (cron or manual).
6. **Observed implementation behavior (executed):** after the August post the cursor is 2026-09-01, the slot the rule already holds; two further cron ticks post nothing and raise no alert (`raiseUserAlert` calls: 0); a manual post answers 409 "This occurrence has already been posted." The October, November, ... installments never post until the user presses Skip.
7. **Expected behavior:** the August post advances the cursor past every consecutive claimed slot (to 2026-10-01), exactly as the rule's own advance does.
8. **Impact:** a loan's scheduled installments stop being booked with no signal (the cron log counts them as "already claimed elsewhere"); the loan and chequing balances drift by one installment per month until noticed. The manual 409 message is misleading (the bill shown as due is reported as already posted).
9. **Root cause:** two callers of `advanceScheduleCursor` pass different consumed sets; `post()` predates rule claims ahead of the cursor and was not updated when they became possible.
10. **Recommended correction:** in `post()`, read the schedule's claims dated on or after the slot inside the locked transaction (after the insert) and pass them all, as `claim-loan-occurrence.ts` does.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/scheduled-transactions/scheduled-transactions.service.ts
+++ b/backend/src/scheduled-transactions/scheduled-transactions.service.ts
@@ post(), recurring branch
-      await advanceScheduleCursor(m, current, new Set([nextDueDateStr]));
+      // Step past every slot already claimed at or after this one -- a
+      // settlement rule may hold a later slot (INV-LOAN-008) -- so the cursor
+      // never lands on an occurrence whose claim key is taken.
+      const claimedAhead = returnedRows<{ d: string }>(
+        await m.query(
+          `SELECT TO_CHAR(original_due_date, 'YYYY-MM-DD') AS d
+             FROM scheduled_transaction_postings
+            WHERE scheduled_transaction_id = $1 AND original_due_date >= $2`,
+          [id, nextDueDateStr],
+        ),
+      ).map((r) => r.d);
+      await advanceScheduleCursor(m, current, new Set([nextDueDateStr, ...claimedAhead]));
```

   Self-check: `advanceScheduleCursor` already decrements `occurrences_remaining` once per stepped slot, so a rule-paid slot is counted as consumed (consistent with the rule's own advance). The skipped-over slot's override is pruned by the existing `original_date < next` delete. Needs: the P4 probe as an integration case; a unit case with a claim ahead.
12. **Recommended regression test:** P4 against the real `post()`.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+  it("steps past a slot a settlement rule already claimed", async () => {
+    const s = await makeSchedule({ nextDueDate: "2026-08-01" });
+    await insertRuleClaim(s.id, "2026-09-01", bankRowId);
+    await service.processAutoPostTransactions();
+    expect(await cursor(s.id)).toBe("2026-10-01");
+  });
```

14. **Verification method:** that case; `npm run test:unit -- schedule-cursor scheduled-transactions.service claim-loan-occurrence`.
15. **Residual risks / patch limitations:** a schedule already stuck in production is not repaired by the fix (its cursor already sits on the claimed slot, so every post is still refused); it needs a skip or a one-off data repair; the cron should also alert when a due occurrence is refused for many consecutive ticks (design risk, section 9).

Causality: `NEW_SINCE_UPSTREAM_AUDIT` (rule claims on the occurrence key, INV-LOAN-008).


### A26-M16 - A cross-currency transfer into an investment sleeve credits the bank account's amount under the sleeve's currency (MNY import)

- **Canonical severity:** MEDIUM. kept MEDIUM.
- **Absorbs:** A26-S09-03 (primary, 09-import-mny.md, session severity MEDIUM).
- **Invariants and prior findings named:** none in the index (see field 4 of each member).
- **Lens:** financial.

#### A26-S09-03 (primary) - A cross-currency transfer into an investment sleeve credits the bank account's amount under the sleeve's currency, and verification cannot see it

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


### A26-M17 - User actions create or leave global, active currencies offered to every user (MNY import, preferences, deleted users' custom currencies)

- **Canonical severity:** MEDIUM. MEDIUM for the group; A26-S13-06 (LOW) is the same global-list pollution through user deletion and is absorbed.
- **Absorbs:** A26-S09-06 (primary, 09-import-mny.md, session severity MEDIUM); A26-S13-06 (merged surface, 13-valuation-fx-networth.md, session severity LOW).
- **Invariants and prior findings named:** none in the index (see field 4 of each member).
- **Lens:** security.

#### A26-S09-06 (primary) - Any user's MNY import creates a global, active currency with an arbitrary code, offered to every user

1. **Severity:** MEDIUM
2. **Confidence:** high (executed)
3. **Location:** `backend/src/import/mny/dto/mny-import.dto.ts` `MnyAccountOptionDto.currencyOverride` (`@IsString() @Length(3, 3)` only); `map/map-reference.ts:154-161` (`override.toUpperCase()`, unchecked); file codes `map/map-reference.ts:61-65` (`/^[A-Za-z]{3}$/`, not ISO 4217); `mny-import.service.ts:281-283` (`ensureSystemCurrency` per code); `backend/src/currencies/currencies.service.ts:239-275` (INSERT with `is_active = true`, `created_by_user_id = NULL`), `:176-195` (`findAll` lists every active system currency to every user). Same shape outside this slice: `users/dto/update-preferences.dto.ts:50-53` (`defaultCurrency`, `@MaxLength(3)` only) into `users.service.ts:405`.
4. **Violated invariant:** server-authoritative metadata; a tenant's request must not write global reference data offered to other tenants (the bond catalog path deliberately creates its currencies inactive for this reason, `currencies.service.ts:243-252`). The repository's validator for a currency code is `IsCurrencyCode` (`common/validators/is-currency-code.validator.ts`, `^[A-Z]{3}$`).
5. **Reproduction:** authenticated user stages any readable Money file and posts `/import/mny/start` with `options.accounts = [{ handle, include: true, currencyOverride: "q#!" }]`. Executed (scratch spec on `money2008`): job `completed`; `currencies` row `{"code":"Q#!","is_active":true,"created_by_user_id":null}`; both imported accounts denominated `Q#!`.
6. **Observed:** `Q#!` is a system currency, active, and appears in every user's currency list (`findAll`'s `created_by_user_id IS NULL` arm). A crafted file does the same with any three letters (`ZZZ`), and an ordinary legacy Money file activates real but retired codes (for example `DEM`, `FRF`) for every user.
7. **Expected:** an override validated as an ISO 4217 code (`IsCurrencyCode` after upper-casing); currencies the import needs created inactive and activated only for the importing user (`user_currency_preferences`), as the bond catalog does for its own.
8. **Impact:** cross-tenant pollution of a global list (every user's currency pickers); the code becomes a primary key other rows reference, so removing it later is not a simple delete; any job that iterates active currencies may query providers for a non-currency (not bounded here; handed to S13).
9. **Root cause:** `ensureSystemCurrency` is a global, active insert used from per-user request paths with codes the user controls.
10. **Recommended correction:** validate the override with `IsCurrencyCode` (and the file's codes with the same regular expression after upper-casing); in the import, ensure the currency inactive and activate it for the importing user only.
11. **Suggested remediation diff (illustrative, not applied)**

```diff
--- a/backend/src/import/mny/dto/mny-import.dto.ts
+++ b/backend/src/import/mny/dto/mny-import.dto.ts
@@ -45,6 +45,8 @@ export class MnyAccountOptionDto {
   @IsOptional()
-  @IsString()
-  @Length(3, 3)
+  @ValidateIf((_o, v) => v !== null && v !== "")
+  @Transform(({ value }) => (typeof value === "string" ? value.toUpperCase() : value))
+  @IsCurrencyCode()
   currencyOverride?: string | null;
--- a/backend/src/import/mny/mny-import.service.ts
+++ b/backend/src/import/mny/mny-import.service.ts
@@ -281,3 +281,6 @@ export class MnyImportService {
     for (const code of parsed.currencyCodes) {
-      await this.currencies.ensureSystemCurrency(code);
+      // Reference data other users see: created inactive, offered only to
+      // the user whose accounts need it.
+      await this.currencies.ensureCatalogCurrency(code);
+      await this.currencies.activateForUser(userId, code);
     }
```

`activateForUser` does not exist: `Suggested remediation diff: incomplete` for that half. The missing piece is an upsert into `user_currency_preferences (user_id, currency_code, is_active)`; the maintainer decides whether an import may activate a currency for its user at all or should only reference an inactive one.

12. **Recommended regression test:** DTO test refusing `"q#!"`; integration test asserting that an import with a foreign-currency account leaves `currencies.is_active = false` for a code not previously present and that a second user's `findAll` does not list it.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+    it("does not offer a currency an import created to other users", async () => {
+      // stage + start with currencyOverride "ZZZ" for an included account
+      const other = await createUser();
+      const list = await withUserContext(other, () => currencies.findAll(other));
+      expect(list.map((c) => c.code)).not.toContain("ZZZ");
+    });
```

14. **Verification:** `npm run test:unit -- mny-import.dto`; `npm run test:integration -- mny-import`; the same check for `UpdatePreferencesDto.defaultCurrency`.
15. **Residual risks:** existing junk or legacy rows already in `currencies` are untouched by the fix.

Causality: `PRE_EXISTING_UNREPORTED`. Rule 7 surfaces: MNY `currencyOverride`, MNY file currency table, preferences `defaultCurrency` (the last outside S09; handed to S13 for confirmation).

#### A26-S13-06 (merged surface) - A deleted user's custom currencies become active system currencies offered to every user, and `GET /currencies/:code` exposes a currency creator's user id

1. **Severity:** LOW
2. **Confidence:** medium (reading; the FK action and the `findAll` predicate are unambiguous, not executed)
3. **Location:** `database/schema.sql:70` (`currencies.created_by_user_id REFERENCES users(id) ON DELETE SET NULL`); `backend/src/users/users.service.ts:561-645` (account deletion; no currency cleanup); `currencies/currencies.service.ts:176-195` (`findAll` lists `created_by_user_id IS NULL AND is_active` to everyone), `:314-321`, `:446` (a NULL creator can be neither edited nor deleted by anyone); `currencies.controller.ts:351-356` with `entities/currency.entity.ts:26-27` (`createdByUserId` serialized); `currencies/dto/create-currency.dto.ts:15-18` (`@Length(3, 3)` only, so `POST /currencies` accepts `"q#!"`).
4. **Violated invariant:** a tenant's data does not become reference data other tenants see (the reason `ensureCatalogCurrency` creates inactive rows, `currencies.service.ts:243-252`); identifiers of other users are not returned (`AGENTS.md` security rules).
5. **Reproduction:** user A creates `PTS / Family Points`, deletes their account; user B lists currencies.
6. **Observed (by reading):** `PTS` now has `created_by_user_id NULL`, `is_active true`, and appears in every user's picker as a system currency; no user can edit or delete it. While A exists, `GET /currencies/PTS` returns A's user UUID to any authenticated caller who knows the code.
7. **Expected:** the deleted user's unreferenced custom currencies deleted with the account (or kept inactive), and `createdByUserId` omitted from the response.
8. **Impact:** cross-tenant visibility of a user-chosen name and symbol, permanently; a user id disclosed. No financial figure changes.
9. **Root cause:** the FK action turns ownership into "system" on delete; the entity has no `@Exclude`.
10. **Recommended correction:** in the account deletion, `DELETE FROM currencies WHERE created_by_user_id = $1 AND NOT currency_code_in_use_globally(code)` before the user row goes, and set the rest inactive; exclude `createdByUserId` from serialization (the view type `UserCurrencyView` already omits it); validate `CreateCurrencyDto.code` with `IsCurrencyCode` or a three-letter pattern.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/currencies/entities/currency.entity.ts
+++ b/backend/src/currencies/entities/currency.entity.ts
@@ -24,5 +24,6 @@
+  @Exclude()
   @Column({ name: "created_by_user_id", type: "uuid", nullable: true })
   createdByUserId: string | null;
--- a/backend/src/users/users.service.ts
+++ b/backend/src/users/users.service.ts
@@ (account deletion, before the user row is removed)
+      // A custom currency nobody else references goes with its creator; one
+      // still referenced stays, inactive, rather than becoming a system
+      // currency offered to every user (created_by_user_id ON DELETE SET NULL).
+      await m.query(
+        `DELETE FROM currencies WHERE created_by_user_id = $1
+           AND NOT currency_code_in_use_globally(code)`,
+        [userId],
+      );
+      await m.query(
+        `UPDATE currencies SET is_active = false WHERE created_by_user_id = $1`,
+        [userId],
+      );
```

   Needs: the deletion's own context (it is a self-delete under the user's identity; the definer function is callable there) and a check that `ClassSerializerInterceptor` applies to `findOne`'s entity return.
12. **Recommended regression test:** integration: user A creates and deletes; user B's `findAll` does not list A's code.
13. **Suggested regression-test diff:** as 12; not written out.
14. **Verification:** the integration case; `npm run test:unit -- currencies users.service`.
15. **Residual risks:** S09-06 (MNY import) remains the active creation path for junk codes; the daily refresh then asks Yahoo for any referenced code on every run (`yahoo-fx.provider.ts:155-157` carries every code; no negative cache on the refresh), an operational cost recorded in section 9.

- Causality: `PRE_EXISTING_UNREPORTED`.


### A26-M18 - A QIF split-transfer leg into another account is written in the source account's currency and amount (MON-H11 QIF half)

- **Canonical severity:** MEDIUM. kept MEDIUM.
- **Absorbs:** A26-S10-02 (primary, 10-rules-banksync-csv.md, session severity MEDIUM); A26-S02-09 (superseded, 02-prior-high-triage.md, session severity MEDIUM).
- **Invariants and prior findings named:** INV-CURRENCY-001, MON-M27, MON-H11.
- **Lens:** financial.

#### A26-S10-02 (primary) - A QIF split-transfer leg into another account is written in the source account's currency and amount (MON-H11 QIF half; A26-S02-09 confirmed)

1. **Severity:** MEDIUM
2. **Confidence:** high (executed)
3. **Location:** `backend/src/import/import-regular-processor.service.ts:589-623` (`currencyCode: ctx.account.currencyCode` at `:604`, `amount: linkedAmount` = `-split.amount` at `:508`); the pending-placeholder branch `:548-587` writes the same unconverted amount; compare the plain transfer `:720-790`, which uses the target's currency and the `PENDING IMPORT` note.
4. **Violated invariant:** a row's currency is derived from the account that holds it (MON-M27, `assertTransactionCurrencyMatchesAccount`); a cross-currency transfer resolves its rate or is flagged (MON-H11).
5. **Reproduction (executed):** USD checking (1000), CAD savings (0). Import into checking: `D01/15/2025 T-100.00 PShop SGroceries $-40.00 S[Savings CAD] $-60.00`, mapping `Savings CAD` to the CAD account.
6. **Observed:** the CAD-account row is `{amount: 60.0000, currency_code: USD}`, no note; the CAD balance is `60.0000`.
7. **Expected:** a CAD row (at 1.35 CAD per USD, 81.00 CAD) or the plain path's flagged placeholder in CAD.
8. **Impact:** the CAD account's balance is off by 21.00 CAD (26 percent) per such split at that rate, with no flag to correct it; the row is labelled USD in a CAD account, in every report, export and backup.
9. **Root cause:** the split path was not given the plain path's target-account lookup and cross-currency branch.
10. **Recommended correction:** load the target account; same currency: as today in the target's code; different currency: the plain path's placeholder (target code, `PENDING IMPORT` note) so the other account's file corrects it, never a silent 1:1 row.
11. **Suggested remediation diff (illustrative, not applied)**

```diff
--- a/backend/src/import/import-regular-processor.service.ts
+++ b/backend/src/import/import-regular-processor.service.ts
@@ private async processSplitTransfer(
     ctx.affectedAccountIds.add(splitTransferAccountId);
     const linkedAmount = -split.amount;
+    const targetAccount = await ctx.manager.findOne(Account, {
+      where: { id: splitTransferAccountId, userId: ctx.userId },
+    });
+    const isCrossCurrency =
+      targetAccount !== null &&
+      targetAccount.currencyCode !== ctx.account.currencyCode;
@@
     const linkedSplitTx = ctx.manager.create(Transaction, {
@@
-      description: split.memo || qifTx.memo,
+      description: isCrossCurrency
+        ? `${split.memo || qifTx.memo || ""} ${PENDING_IMPORT_NOTE}`.trim()
+        : split.memo || qifTx.memo,
       status,
-      currencyCode: ctx.account.currencyCode,
+      currencyCode: targetAccount?.currencyCode ?? ctx.account.currencyCode,
```

   with `PENDING_IMPORT_NOTE` hoisted from `processTransfer` to a module constant, so both paths write the note `matchPendingTransfer` searches for.
12. **Recommended regression test:** the executed case, asserting the leg's currency is CAD and the row carries the pending note.
13. **Suggested regression-test diff (illustrative, not applied):** add to `backend/test/integration/transaction-rules-import.integration.spec.ts` (or a new `import-qif-split-transfer.integration.spec.ts`) the probe of `<scratchpad>/mut/backend/test/integration/audit-s10-qif-split.integration.spec.ts`, with `expect(cadLeg.currency_code).toBe("CAD")` and `expect(cadLeg.description).toContain("PENDING IMPORT")`.
14. **Verification:** `npm run test:integration -- import`; `npm run test:unit -- import-regular-processor`.
15. **Residual risks:** the placeholder is still an unconverted amount in the target account until the other file is imported (the plain path's documented behaviour); `matchPendingTransfer` updates a pending leg's amount without a VOID or reconciled check (section 9).

Causality: `PRIOR_REPORTED` (MON-H11, `CONFIRMED`, QIF half), first located by S02 as A26-S02-09; this finding supersedes A26-S02-09. OFX and CSV rows carry no splits on this path (only QIF has `S` lines), so the split shape is QIF-only; the plain transfer path of all three is the flagged-placeholder design.

#### A26-S02-09 (superseded) - A QIF split-transfer leg is written in the source account's currency, unconverted (MON-H11 residual)

Superseded by the primary above: same root cause, and its scenario is one surface of the primary's reproduction. Full text: `02-prior-high-triage.md` section 4.


### A26-M19 - Deleting an account checks "no transactions" in one transaction and deletes in another: a concurrent sync or import is cascaded away

- **Canonical severity:** MEDIUM. kept MEDIUM (not executed; static).
- **Absorbs:** A26-S10-03 (primary, 10-rules-banksync-csv.md, session severity MEDIUM).
- **Invariants and prior findings named:** INV-TRANSFER-001.
- **Lens:** concurrency.

#### A26-S10-03 (primary) - Deleting an account checks "no transactions" in one transaction and deletes in another: a concurrent bank sync or import is cascaded away and its legs in other accounts are orphaned

1. **Severity:** MEDIUM
2. **Confidence:** medium (static; the window is short)
3. **Location:** `backend/src/accounts/accounts.service.ts:1868-1947` (counts at `:1872-1876` and `:1889-1897` each in their own `withScopedDb`, removal at `:1935-1947`, no account lock); `database/schema.sql:358` (`transactions.account_id ... ON DELETE CASCADE`), `:378` (`linked_transaction_id ... ON DELETE SET NULL`); writers `bank-sync-writer.service.ts:231`, `import-regular-processor.service.ts:590-623, 775-796`, `convert-to-transfer.ts`.
4. **Violated invariant:** AGENTS.md "A rejected command must not already have written: every check that can refuse a request runs inside the same transaction as the mutation, under the same lock where concurrency matters"; INV-TRANSFER-001 (a transfer's legs exist together).
5. **Reproduction:** an empty linked checking account A; the daily bank-sync cron writes 20 rows into A, and an import rule converts "Savings" rows into transfers to account S (the counterpart moves S's balance). The user deletes A: the count runs before the sync commits (0), the sync commits, then `m.remove(account)` cascades A's 20 rows.
6. **Observed (by reading):** A and its rows are gone; S keeps the counterpart legs with `linked_transaction_id` NULL and their balance contribution, as one-legged "transfers" from an account that no longer exists. The writer's `FOR UPDATE` on A only makes the delete wait until the sync commits, then it proceeds.
7. **Expected:** the delete is refused with "Close the account instead", because the account has transactions when it is deleted.
8. **Impact:** money appears in S with no source (for a 300.00 transfer, S overstates by 300.00); the deleted rows are not in the action-history snapshot (`beforeData` is the account only), so undo cannot bring them back. The same shape applies to a QIF import's transfer legs.
9. **Root cause:** the guard and the delete are separate transactions, and the account row is not locked before the count.
10. **Recommended correction:** one `withScopedDb`: lock the account (`lockAccountsForBalanceWrite`, which every writer of its balance also takes), count both tables, then unlink and remove.
11. **Suggested remediation diff (illustrative, not applied)**

```diff
--- a/backend/src/accounts/accounts.service.ts
+++ b/backend/src/accounts/accounts.service.ts
@@ async delete(userId: string, id: string): Promise<void> {
-    const transactionCount = await withScopedDb(this.dataSource, (m) =>
-      m.getRepository(Transaction).count({
-        where: { accountId: id },
-      }),
-    );
-    if (transactionCount > 0) { ...throw }
-    const investmentTransactionCount = await withScopedDb(...)
-    if (investmentTransactionCount > 0) { ...throw }
+    // Refuse and delete under the account's write lock: a writer that moves its
+    // balance takes the same lock, so no row can land between the count and the
+    // removal (and the cascade).
+    const assertEmpty = async (m: EntityManager): Promise<void> => {
+      await lockAccountsForBalanceWrite(m, [id], userId);
+      const transactionCount = await m
+        .getRepository(Transaction)
+        .count({ where: { accountId: id } });
+      if (transactionCount > 0) { ...throw as today }
+      const investmentTransactionCount = await m
+        .getRepository(InvestmentTransaction)
+        .count({ where: { accountId: id } });
+      if (investmentTransactionCount > 0) { ...throw as today }
+    };
+    await withScopedDb(this.dataSource, assertEmpty); // early answer, as today
@@
     await withScopedDb(this.dataSource, async (m) => {
+      await assertEmpty(m);
       if (account.linkedAccountId) {
```

   The early check keeps today's behaviour of refusing before the loan schedule is removed; the in-transaction check is the one that holds.
12. **Recommended regression test:** two connections: connection 1 holds A's row lock and inserts a row (as the writer does), connection 2 calls `delete`; release; expect `BadRequestException` and the row present.
13. **Suggested regression-test diff (illustrative, not applied):** a new case in `backend/test/integration/accounts-*.integration.spec.ts` with a barrier on `lockAccountsForBalanceWrite`, asserting `count(transactions where account_id = A) = 1` after both finish.
14. **Verification:** the two-connection test; `npm run test:unit -- accounts.service`.
15. **Residual risks:** the loan-schedule removal before the delete stays outside the transaction (existing best-effort design).

Causality: `PRE_EXISTING_UNREPORTED` (S07 hand-off; the bank-sync writer and rule conversions make the cross-account leg reachable). Not executed: MEDIUM (plan step 7 requires execution for HIGH and BLOCKER only); the FK actions and the transaction boundaries are read directly from `schema.sql` and the method.


### A26-M20 - An AI or MCP edit that names no rate replaces the row's own exchange rate with a freshly resolved market rate (INV-FX-002)

- **Canonical severity:** MEDIUM. kept MEDIUM.
- **Absorbs:** A26-S12-03 (primary, 12-securities-holdings.md, session severity MEDIUM).
- **Invariants and prior findings named:** INV-FX-002.
- **Lens:** financial.

#### A26-S12-03 (primary) - An AI or MCP edit that names no rate replaces the row's own exchange rate with a freshly resolved market rate

1. **Severity:** MEDIUM
2. **Confidence:** high (executed, P4)
3. **Location:** `backend/src/securities/investment-transactions.service.ts:1912-1915` (`previewUpdateInvestmentTransaction` passes `exchangeRate: input.exchangeRate`, so the preview re-resolves when the edit names none); commit: `mcp/tools/investments.tool.ts:869-881` and the bulk loop after `:950` send `exchangeRate: preview.exchangeRate`; `ai/actions/ai-action-builder.service.ts:693-726` signs `exchangeRate: preview.exchangeRate` into the descriptor; `update()` writes any DTO rate (`:4706-4707`). The confirmation text (`mcp/tools/investments.tool.ts:1236-1280`, `editLines`) shows no rate.
4. **Violated invariant:** INV-FX-002 (the row's own rate is the fact); `AGENTS.md` "A presentation-only edit does not re-resolve an FX rate"; the `update()` contract at `:4700-4705` (keep the stored rate unless the pair changed).
5. **Reproduction:** a SELL of 141 shares of a USD security from a CAD brokerage, entered at its statement total 820.91 USD and the broker's settlement rate 1.40 (cash +1,149.27 CAD); today's stored USD/CAD is 1.37. Through MCP `manage_investment_transactions` (or the assistant) the user asks to change only the description.
6. **Observed (executed):** the preview resolves 1.3699999999986299 (unrounded, not `roundFxRate`) and `cashAmount` 1,124.65; after confirmation the row stores 1.37 and the cash leg +1,124.65.
7. **Expected:** the stored 1.40 kept; cash leg unchanged at +1,149.27.
8. **Impact:** -24.62 CAD (2.1 percent) on a description edit; the realized gain on the sale moves by the same amount; the user is shown no rate line, only a cash figure, so the change is not disclosed. A back-dated row combines with A26-S12-02 (today's rate).
9. **Root cause:** the preview reconstructs the edit as a create and therefore resolves a rate; the commit sends what the preview resolved as if the user had supplied it.
10. **Recommended correction:** in `previewUpdateInvestmentTransaction`, when the edit names no rate and changes neither the account, funding account nor security, carry the stored rate (`Number(existing.exchangeRate)`) into the preview; the adapters then send it back unchanged. Show the rate line in `editLines` when it differs from the stored one.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/securities/investment-transactions.service.ts
+++ b/backend/src/securities/investment-transactions.service.ts
@@ -1909,10 +1909,15 @@
-      // Only an explicit override pins the rate; otherwise the preview
-      // re-resolves it fresh (for the new currency pair if the security or
-      // account changed), matching update()'s re-resolution precedence.
-      exchangeRate: input.exchangeRate,
+      // update() keeps the stored rate unless the pair changed (INV-FX-002), and
+      // the adapters commit exactly what this preview resolved, so the preview
+      // must carry the stored rate rather than re-resolve it.
+      exchangeRate:
+        input.exchangeRate ??
+        (input.securityQuery === undefined ||
+        input.securityQuery === existing.security?.symbol
+          ? Number(existing.exchangeRate)
+          : undefined),
```

Needs: a same-currency row still resolves to 1 (the same-currency branch dominates a supplied rate, `:770-772`); unit cases for the preview; the AI executor's update path (`ai/query/tool-executor.service.ts:2189, 2226`) re-checked.

12. **Recommended regression test:** preview a description-only edit of a cross-currency row with a stored rate different from the market and assert `preview.exchangeRate` equals the stored rate; at integration level, P4 asserting the cash leg.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+  it("keeps the row's own rate when an AI edit names none", async () => {
+    const sell = await sellUsdFromCad({ totalAmount: 820.91, exchangeRate: 1.4 });
+    const preview = await svc.previewUpdateInvestmentTransaction(userId, sell.id, { description: "x" });
+    expect(preview.exchangeRate).toBe(1.4);
+    expect(preview.cashAmount).toBe(1149.27);
+  });
```

14. **Verification:** P4 green; `npm run test:unit -- investment-transactions mcp/tools/investments ai-action-builder`.
15. **Residual risks:** a security change through `securityQuery` still re-resolves, which is correct; the preview's unrounded rate (1.3699999999986299 versus the stored 1.3700000000) is a separate precision nit (section 9).

- Causality: `PRE_EXISTING_UNREPORTED`. Surfaces (Rule 7): MCP single, MCP bulk, AI assistant confirmation.


### A26-M21 - Realized gains and capital-gains replays price a transferred-in lot at the carried per-share figure and rate 1 (MON-M35 residual)

- **Canonical severity:** MEDIUM. kept MEDIUM.
- **Absorbs:** A26-S12-04 (primary, 12-securities-holdings.md, session severity MEDIUM).
- **Invariants and prior findings named:** MON-M35.
- **Lens:** financial.

#### A26-S12-04 (primary) - Realized gains and capital-gains replays price a transferred-in lot at the carried per-share figure and rate 1, so a cross-currency transfer resets the basis (MON-M35 still open off the lots surface)

1. **Severity:** MEDIUM
2. **Confidence:** high (executed, P5)
3. **Location:** `backend/src/securities/portfolio-calculation.service.ts:1302-1310` (`calculateRealizedGains`: `TRANSFER_IN` through `acquisitionCost(tx)`, rate 1 from `transferSecurity` `investment-transactions.service.ts:2414, 2439`), `:293-311` (`applyTxToState`, the capital-gains seed), `:1615-1625` (same fold); the correct fold is `calculateCostBasisLotsInAccountCurrency` `:940-963`, whose own comment (`:926-935`) describes this exact defect.
4. **Violated invariant:** basis conservation across a transfer (`portfolio-calculation.service.ts:785-791`); `AGENTS.md` "The fix for one surface is not the fix".
5. **Reproduction:** two CAD brokerages, USD security. BUY 10 @ 100.00 USD at 1.37 in A (basis 1,370.00 CAD). `transferSecurity` 10 shares A -> B. SELL 10 @ 140.00 USD at 1.37 in B (proceeds 1,918.00 CAD). `calculateRealizedGains`.
6. **Observed (executed):** realized gain 918.00 with cost basis 1,000 (the USD figure under a CAD label).
7. **Expected:** (1,400 - 1,000) x 1.37 = 548.00 CAD.
8. **Impact:** +370.00 CAD phantom gain (67.5 percent) on every sale after a cross-currency transfer, carried into the realized-gains report, the capital-gains-by-month/day charts, the AI/MCP `get_capital_gains` answer (`getLlmCapitalGains`) and any tax figure built from them; the lots surface on the same screen says 548, so two surfaces answer one sale with two figures.
9. **Root cause:** the MON-M35 fix moved only `calculateCostBasisLotsInAccountCurrency` to "the destination takes what the source released"; the three other replays still treat `TRANSFER_IN` as an acquisition.
10. **Recommended correction:** extract the carried-basis handling (the `carriedByTransferOut` map keyed on `linkedTransactionId`, with the OUT-before-IN ordering) into one helper used by all four folds, or route realized gains through the lots replay.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/securities/portfolio-calculation.service.ts
+++ b/backend/src/securities/portfolio-calculation.service.ts
@@ -1300,12 +1300,24 @@
       switch (baseInvestmentAction(tx.action)) {
+        case InvestmentAction.TRANSFER_IN: {
+          // The destination takes what the paired OUT leg released, in the
+          // source's currency -- never quantity x carried price at rate 1.
+          const carried = tx.linkedTransactionId
+            ? released.get(tx.linkedTransactionId)
+            : undefined;
+          if (carried !== undefined) entry.costBasis += carried;
+          entry.quantity += quantity;
+          break;
+        }
         case InvestmentAction.BUY:
-        case InvestmentAction.REINVEST:
-        case InvestmentAction.TRANSFER_IN: {
+        case InvestmentAction.REINVEST: {
@@ -1313,6 +1325,9 @@
         case InvestmentAction.TRANSFER_OUT: {
           const costBasisSold = sellQty * avgCostPerShare;
+          if (tx.action === InvestmentAction.TRANSFER_OUT) {
+            released.set(tx.id, costBasisSold);
+          }
```

plus the OUT-before-IN sort the lots replay uses (`:871-884`), and the same change in `applyTxToState` and `:1615-1625`. An unknown carried basis needs the lots replay's `transferred_basis_unknown` treatment, which `RealizedGainEntry` has no field for: a maintainer decision.

12. **Recommended regression test:** P5 at integration level asserting 548.00 from `calculateRealizedGains` and equality with the lots surface; a source scan that no replay folds `TRANSFER_IN` through `acquisitionCost`.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+  it("a transfer between two CAD accounts carries the CAD basis into the gain", async () => {
+    // BUY 10 @ 100 USD at 1.37 in A, transfer to B, SELL 10 @ 140 USD at 1.37 in B
+    const [gain] = await calc.calculateRealizedGains(userId, {});
+    expect(gain.realizedGain).toBeCloseTo(548, 2);
+  });
```

14. **Verification:** P5 green; `npm run test:unit -- portfolio-calculation`.
15. **Residual risks:** valuation and FX aggregation of these figures are S13's; the holdings page's average cost of a transferred lot is in the security's currency and unaffected by this finding.

- Causality: `PRIOR_REPORTED` MON-M35, `CONFIRMED` (residual on three of four replays).


### A26-M22 - A security transfer's basis is the leg's stored price (today's average on create, the client's figure on edit); the form shows an editable cost the server replaces

- **Canonical severity:** MEDIUM. MEDIUM for the group; A26-S19-05 (LOW) is the client face of the same basis decision and is absorbed.
- **Absorbs:** A26-S12-05 (primary, 12-securities-holdings.md, session severity MEDIUM); A26-S19-05 (merged surface, 19-frontend-forms.md, session severity LOW).
- **Invariants and prior findings named:** INV-HOLDING-001.
- **Lens:** financial.

#### A26-S12-05 (primary) - A security transfer's basis is the leg's stored price, which is today's average cost on create and whatever the client sends on edit, so a back-dated or edited transfer creates or destroys basis

1. **Severity:** MEDIUM
2. **Confidence:** high (executed, P1)
3. **Location:** `backend/src/securities/investment-transactions.service.ts:2365-2372` (`carriedCost` from the stored holding, read before the transaction, rounded to 6 dp), `:2412, 2436` (both legs priced at it); `updateLinkedTransfer` `:3985-3986` (`leg.price = updateDto.price`, trusted), `:3989-3990` (date and quantity change keep the old price); fold `holdings.service.ts:558-576` (the IN leg adds `acquisitionCost` = quantity x leg price, the OUT leg relieves at the running average as of its date).
4. **Violated invariant:** basis conservation across a transfer (INV-HOLDING-001 projection; `portfolio-calculation.service.ts:785-791`); server-authoritative financial metadata (`AGENTS.md`); INV-HOLDING-001 known gap names only the race.
5. **Reproduction:** BUY 10 @ 100 on 2026-01-10, BUY 10 @ 200 on 2026-03-10 (stored average 150). Record a transfer of 10 shares dated 2026-02-10 (when the source held 10 @ 100).
6. **Observed (executed):** source 10 @ 200.00 (basis 2,000), destination 10 @ 150.00 (basis 1,500); total 3,500.
7. **Expected:** source 10 @ 200 (2,000), destination 10 @ 100 (1,000); total 3,000, what was paid.
8. **Impact:** +500.00 of basis (16.7 percent) created, understating the unrealized and later realized gain on the destination; the opposite sign when later purchases were cheaper. The edit path lets any API client set the destination's basis per share outright. The lots surface (`calculateCostBasisLotsInAccountCurrency`) carries the released basis and disagrees with the holdings page.
9. **Root cause:** the destination's basis is stored as a per-share price on the IN leg and computed once, from today's projection, instead of being the basis the OUT leg releases at its own date in the replay.
10. **Recommended correction:** make the holdings fold carry the OUT leg's released basis to the linked IN leg (the lots replay's rule, one helper shared with A26-S12-04) so the IN leg's price is presentation only; at minimum compute `carriedCost` inside the transaction from `getHoldingAt(..., transactionDate)` and ignore a client `price` on transfer legs.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/securities/holdings.service.ts
+++ b/backend/src/securities/holdings.service.ts
@@ -553,7 +553,20 @@
-      if (tx.action === InvestmentAction.SPLIT) {
+      if (tx.action === InvestmentAction.TRANSFER_IN && tx.linkedTransactionId) {
+        // The destination takes what the paired OUT leg released at its own
+        // date, not quantity x the leg's stored price.
+        const carried = releasedByTransferOut.get(tx.linkedTransactionId);
+        if (carried !== undefined) holding.totalCost += carried;
+      } else if (tx.action === InvestmentAction.SPLIT) {
@@ -571,6 +584,9 @@
       } else if (holding.quantity > 0) {
         const avgCost = holding.totalCost / holding.quantity;
         const relieved = Math.min(Math.abs(quantityChange), holding.quantity);
         holding.totalCost -= relieved * avgCost;
+        if (tx.action === InvestmentAction.TRANSFER_OUT) {
+          releasedByTransferOut.set(tx.id, relieved * avgCost);
+        }
       }
```

with the replay reading both accounts of a pair (a scope rebuild of the destination alone does not see the source's OUT leg: `rebuildScopesFromTransactions` filters to the requested pairs, so the transfer paths must request both scopes, as they already do) and the OUT-before-IN tie order. Decision for the maintainer: the drift report will then flag every existing transfer whose stored price disagreed.

12. **Recommended regression test:** P1 at integration level (basis sum 3,000), and an edit case that changes the transfer's date and asserts the destination's basis follows.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+  it("a back-dated transfer carries the basis the source held on its date", async () => {
+    await buy(10, 100, "2026-01-10");
+    await buy(10, 200, "2026-03-10");
+    await transfer(10, "2026-02-10");
+    expect(await basis(brokerage2Id)).toBeCloseTo(1000, 4);
+    expect((await basis(brokerageId)) + (await basis(brokerage2Id))).toBeCloseTo(3000, 4);
+  });
```

14. **Verification:** P1 green; `npm run test:integration -- security-transfer holding-ledger-projection`.
15. **Residual risks:** the client prefilled `costPerShare` is S19's; cross-currency transfer basis is A26-S12-04.

- Causality: `PRE_EXISTING_UNREPORTED`.

#### A26-S19-05 (merged surface) - The transfer form's cost per share is editable, but the server replaces it with the source holding's average on create

1. **Severity:** LOW
2. **Confidence:** high (by reading; the server override is unit-tested per S12)
3. **Location:** `frontend/src/components/investments/InvestmentTransactionForm.tsx:905-915` (prefill), `:1591-1599` (editable `NumericInput`), `:996, :1032` (`costPerShare: Number(data.price) || 0`); `backend/src/securities/investment-transactions.service.ts:2356-2372`; copy `frontend/src/i18n/messages/en/investments.json:297` ("The cost per share ... is carried to the destination").
4. **Violated invariant:** an explicit user instruction is not silently ignored; a field that has no effect is not offered as editable.
5. **Reproduction:** transfer 10 shares whose source average is 100.00; the user types 150.00 as the cost per share.
6. **Observed:** the request carries `costPerShare: 150`; the server writes both legs at 100.00 (the source holds the security).
7. **Expected:** the field is read-only when the server will carry the source basis, or the server honours the stated cost.
8. **Impact:** narrow: the basis is conserved (the server's choice is the correct accounting), but the screen accepted a different figure without saying it would be ignored.
9. **Root cause:** the server became authoritative for the basis (to stop a stale client value poisoning it) and the field stayed editable.
10. **Recommended correction:** render the carried cost as a read-only figure for a new transfer from a holding.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/frontend/src/components/investments/InvestmentTransactionForm.tsx
+++ b/frontend/src/components/investments/InvestmentTransactionForm.tsx
@@ -1591,6 +1591,8 @@
             <NumericInput
               label={t('transactionForm.costPerShare', { currency: transactionCurrency })}
               prefix={currencySymbol}
               value={watchedPrice || undefined}
+              // The server carries the source's average cost on a new transfer.
+              disabled={isTransfer && !!selectedTransferHolding}
               onChange={(value) => setValue('price', value, { shouldValidate: true })}
```

12. **Recommended regression test:** a new transfer from a holding renders the cost field disabled, showing the source average.
13. **Suggested regression-test diff (illustrative, not applied):** in the transfer block of `InvestmentTransactionForm.test.tsx`, after selecting the source holding, `expect(screen.getByLabelText(/Cost per Share/)).toBeDisabled()`.
14. **Verification method:** the component test above.
15. **Residual risks:** the edit path sends `price` and the server's update path was not re-read for its basis rule. Causality: `NEW_SINCE_UPSTREAM_AUDIT` (the upstream P6-004 described the opposite: the client value trusted).


### A26-M23 - The holdings fold snaps every intermediate position under 0.0001 shares to zero

- **Canonical severity:** MEDIUM. kept MEDIUM.
- **Absorbs:** A26-S12-06 (primary, 12-securities-holdings.md, session severity MEDIUM).
- **Invariants and prior findings named:** INV-HOLDING-001, INV-HOLDING-002.
- **Lens:** financial.

#### A26-S12-06 (primary) - The holdings fold snaps every intermediate position under 0.0001 shares to zero, so small fractional purchases never form a holding

1. **Severity:** MEDIUM
2. **Confidence:** high (executed, P2; the sell consequence by reading)
3. **Location:** `backend/src/securities/holdings.service.ts:584-588` (per-step `if (Math.abs(holding.quantity) < 0.0001) { quantity = 0; totalCost = 0 }`); not shared with `getHoldingAt` (`:233-236`, end-only snap at 1e-8), `validateNoNegativeHoldingsHistory` (`:376-403`, no snap) or the net-worth reducers (`net-worth/net-worth.service.ts:1853, 2252, 2908`, no snap); `projectedHoldingRow` uses 1e-8 (`investment-replay.util.ts:457, 475`).
4. **Violated invariant:** INV-HOLDING-001 (the stored row equals a replay of the ledger) and INV-HOLDING-002 (one share count per position across surfaces).
5. **Reproduction:** a CRYPTO security (`security-enums.ts:53`); two BUYs of 0.00005 at 60,000.00 (DTO allows 8 dp, `dto/create-investment-transaction.dto.ts:51-53`). A daily recurring buy of 5.00 of bitcoin is 0.000083 BTC.
6. **Observed (executed):** no holding row after the two BUYs (cash -6.00 posted). By reading: each further buy starts from the snapped 0 and is snapped again, so a year of 0.00009 daily buys (0.03285 BTC, about 1,971.00 at 60,000) holds nothing; a later SELL of 0.03 passes `validateNoNegativeHoldingsHistory` (unsnapped sum 0.03285) and the fold then stores a short position of -0.03.
7. **Expected:** a holding of 0.0001 (two buys), 0.03285 (the year).
8. **Impact:** the position is absent from the holdings page and from every valuation that reads `holdings` (`portfolio.service.ts:1249, 1380, 1520`), while the net-worth replay values it; the cash left the account. Narrow in instruments (fractional crypto, fractional shares under 0.0001), unbounded in amount.
9. **Root cause:** a "ghost holding" guard written per step in the fold rather than once at projection, where `projectedHoldingRow` already applies a 1e-8 epsilon.
10. **Recommended correction:** remove the per-step snap from `computeHoldingsMap` and let `projectedHoldingRow` decide at the end; if a residue guard is still wanted mid-fold, use `HOLDING_QUANTITY_EPSILON` (1e-8), the stored scale.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/securities/holdings.service.ts
+++ b/backend/src/securities/holdings.service.ts
@@ -582,10 +582,11 @@
-      // Snap near-zero to exactly zero to prevent ghost holdings
-      if (Math.abs(holding.quantity) < 0.0001) {
+      // A rounding residue of the fold, at the stored scale (8 dp); a real
+      // fractional position of 0.00005 is not a ghost.
+      if (Math.abs(holding.quantity) <= HOLDING_QUANTITY_EPSILON) {
         holding.quantity = 0;
         holding.totalCost = 0;
       }
```

The 0.0001 "held" predicate in the valuation (`portfolio.service.ts:1249` and siblings) is a separate display threshold and a maintainer decision.

12. **Recommended regression test:** P2 at integration level, and a unit case in `holdings.service.spec.ts` folding 10 BUYs of 0.00009.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+  it("keeps a position built from purchases under 0.0001 shares", async () => {
+    for (let d = 10; d < 20; d++) await buy(0.00009, 60000, `2026-01-${d}`);
+    const h = await holdingOf(brokerageId);
+    expect(Number(h.quantity)).toBeCloseTo(0.0009, 8);
+  });
```

14. **Verification:** P2 green; `npm run test:unit -- holdings.service investment-replay`.
15. **Residual risks:** the drift report will flag existing micro positions after the fix, which is the intended repair path.

- Causality: `PRE_EXISTING_UNREPORTED`.


### A26-M24 - A Money-imported trade of a security quoted in another currency stores its price and total in the account's currency, read as the security's

- **Canonical severity:** MEDIUM. kept MEDIUM.
- **Absorbs:** A26-S12-09 (primary, 12-securities-holdings.md, session severity MEDIUM).
- **Invariants and prior findings named:** INV-PRICE-001, INV-HOLDING-001.
- **Lens:** financial.

#### A26-S12-09 (primary) - A Money-imported trade of a security quoted in another currency stores its price and total in the account's currency, and the app reads both as the security's

1. **Severity:** MEDIUM
2. **Confidence:** medium (reading across two slices; not executed, no committed two-currency Money fixture)
3. **Location:** `backend/src/import/mny/map/map-investments.ts:283-284` (`currencyCode` is the **investment account's**), `import/mny/writers/write-investments.ts:274-292` (price, total and cash amount denominated in `transaction.currencyCode`, `exchangeRate: 1`); readers that assume the security's currency: `holdings.service.ts:558-570` ("Prices here are in the security's currency, as is `averageCost`"), `security-price.service.ts:2314-2372` and `:2374-2458` (`upsertTransactionPrice` / `backfillTransactionPrices` copy the average trade price into `security_prices`, whose currency is `securities.currency_code`), `net-worth/position-price.util.ts:27-34` (`txFallback` reads trade prices as closes).
4. **Violated invariant:** INV-PRICE-001 (a row in `security_prices` is in the security's currency) through the transaction-derived writer; INV-HOLDING-001's denomination (average cost in the security's currency).
5. **Reproduction:** a Money file with a CAD investment account holding a USD security; Money records the buy of 10 shares at the account's CAD figure (S09: "trades in account currency at rate 1, prices in the security's currency"). After import, any edit or the maintenance pass (`POST` behind `securities.controller.ts:750`) writes the CAD trade price as that day's USD close; the holdings fold blends CAD totals into an average the valuation treats as USD.
6. **Observed:** (by reading) on a day with no provider bar, the position is valued at the CAD trade price read as USD and converted again (x 1.37 at USD/CAD 1.37, a 37 percent overstatement on those days); the holding's average cost is CAD under a USD label beside app-created rows in USD.
7. **Expected:** the trade row carries the security's price and an `exchange_rate` to the account (the convention every app-created row follows, `investment-transactions.service.ts:803-850`), or the transaction-derived writer refuses a row whose currency is not the security's.
8. **Impact:** wrong market values on unpriced days and a wrong average cost for imported cross-currency positions; silent, because no row records the currency it was written in (INV-PRICE-001 known gap).
9. **Root cause:** two conventions for `investment_transactions.price`: "in the security's currency, converted by `exchange_rate`" (the app) and "in the account's currency, rate 1" (the Money writer).
10. **Recommended correction:** a maintainer decision: convert at import (security-currency price, `exchange_rate` = account/security) or exclude rows whose account currency differs from the security's from `upsertTransactionPrice` and the holdings basis, reporting them as unknown.
11. **Suggested remediation diff: incomplete.** Supported by the evidence: guard the transaction-derived writer so it averages only rows denominated in the security's currency.

```diff
--- a/backend/src/securities/security-price.service.ts
+++ b/backend/src/securities/security-price.service.ts
@@ -2333,8 +2333,12 @@
        FROM investment_transactions
+       JOIN accounts a ON a.id = investment_transactions.account_id
+       JOIN securities s ON s.id = investment_transactions.security_id
        WHERE security_id = $1
          AND transaction_date = $2
          AND action = ANY($3)
          AND price IS NOT NULL
-         AND status != 'VOID'`,
+         AND status != 'VOID'
+         -- a rate-1 row in another currency is denominated in the account's
+         AND (exchange_rate <> 1 OR a.currency_code = s.currency_code)`,
```

Missing: which currency the Money writer's `price` is in for every action (S09 confirmed the total and cash amount; the price is inferred from the same writer comment), and the import-side conversion, which is S09/S10's.

12. **Recommended regression test:** an MNY writer case with a CAD account and a USD security asserting the stored price and rate, and a transaction-price case asserting no `security_prices` row from a rate-1 cross-currency trade.
13. **Suggested regression-test diff:** incomplete (needs the decision in 10).
14. **Verification:** `npm run test:integration -- mny-import`; a two-currency Money fixture.
15. **Residual risks:** valuation of such holdings (S13).

- Causality: `PRE_EXISTING_UNREPORTED` (S09 hand-off "valuation of a holding whose security currency differs from its account's", answered here for the trade-price half).


### A26-M25 - Choosing a default currency that is not yet in the table fails on the foreign key: onboarding on a fresh instance accepts only USD

- **Canonical severity:** MEDIUM. kept MEDIUM.
- **Absorbs:** A26-S13-05 (primary, 13-valuation-fx-networth.md, session severity MEDIUM).
- **Invariants and prior findings named:** none in the index (see field 4 of each member).
- **Lens:** frontend.

#### A26-S13-05 (primary) - Choosing a default currency that is not yet in the table fails on the foreign key: onboarding on a fresh instance accepts only USD

1. **Severity:** MEDIUM
2. **Confidence:** high (executed, P1, and replayed against `database/schema.sql`)
3. **Location:** `backend/src/users/users.service.ts:373-379` (the patch, including `default_currency`, is written inside the transaction), `:399-409` (`ensureSystemCurrency` runs after the transaction commits); FK `database/schema.sql:1561` (`user_preferences.default_currency REFERENCES currencies(code)`, not deferrable); `frontend/src/components/auth/OnboardingPreferences.tsx:68-70, 100-115` (the picker offers the whole catalog, "the chosen one is created when saved").
4. **Violated invariant:** the on-demand currency contract stated at `currencies.service.ts:47-53, 64-69` and `:232-238` ("Idempotent and safe to call on every default-currency change ... instead of seeding a whole list up front").
5. **Reproduction:** a fresh instance (only USD exists, `onApplicationBootstrap`); a new user picks CAD (or PLN, EUR) at onboarding and saves.
6. **Observed (executed, P1):** `updatePreferences(userId, { defaultCurrency: "PLN" })` throws `QueryFailedError: insert or update on table "user_preferences" violates foreign key constraint`; no currency row is created; the onboarding toast reports the save failed. The SQL replay on `schema.sql` gives the same violation for `PLN` and for lower-case `pln` (the DTO does not upper-case; `@MaxLength(3)` only).
7. **Expected:** the currency ensured (validated as ISO 4217, upper-cased) before the preference row is written, in the same transaction.
8. **Impact:** every non-USD user on a fresh deployment cannot finish onboarding with their currency; the work-around (keep USD, add the currency on the Currencies page, then change the default) is undiscoverable from the error. A reporting currency left at USD by mistake then converts every figure the user reads.
9. **Root cause:** the ensure was placed with the post-commit side effects (the rate refresh), after a write that depends on it; the unit spec mocks the repository (`users.service.spec.ts:148`) and the entity harness has no such FK, so no test can see the order.
10. **Recommended correction:** validate `defaultCurrency` with `IsCurrencyCode` after an upper-casing `@Transform`, and call `ensureSystemCurrency` inside the transaction before the update (it joins the ambient transaction).
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/users/dto/update-preferences.dto.ts
+++ b/backend/src/users/dto/update-preferences.dto.ts
@@ -49,6 +49,8 @@
   @IsOptional()
-  @IsString()
-  @MaxLength(3)
+  @Transform(({ value }) => (typeof value === "string" ? value.toUpperCase() : value))
+  @ValidateIf((_o, v) => v !== null && v !== "")
+  @IsCurrencyCode()
   defaultCurrency?: string;
--- a/backend/src/users/users.service.ts
+++ b/backend/src/users/users.service.ts
@@ -331,6 +331,13 @@
       async (manager) => {
         await ensureUserPreferencesRow(manager, userId);
+        // The FK to currencies(code) is checked at the UPDATE below, so the
+        // currency has to exist first; ensureSystemCurrency joins this
+        // transaction.
+        if (dto.defaultCurrency !== undefined) {
+          await this.moduleRef
+            .get(CurrenciesService, { strict: false })
+            .ensureSystemCurrency(dto.defaultCurrency);
+        }
         const repo = manager.getRepository(UserPreference);
```

   Needs: removal of the post-commit ensure at `:399-409`; a decision whether a user's default should create an active system currency (A26-S13-06 and S09-06 argue for inactive plus a preference row).
12. **Recommended regression test:** an integration case on a database carrying the schema's FK: a fresh user sets `defaultCurrency: "PLN"`, the row is saved and `currencies` holds PLN.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+  it("creates the chosen default currency before writing the preference", async () => {
+    const saved = await users.updatePreferences(userId, { defaultCurrency: "PLN" });
+    expect(saved.defaultCurrency).toBe("PLN");
+    expect(await currencyExists("PLN")).toBe(true);
+  });
```

14. **Verification:** P1 re-run on a schema-faithful database; the onboarding E2E with a non-USD currency (S20/S21).
15. **Residual risks:** the same ordering exists wherever a referenced code is written before `ensure*` (none other found: the MNY import ensures before its transaction).

- Causality: `PRE_EXISTING_UNREPORTED` (introduction date not determinable in the shallow clone).
- Disposes the S09 hand-off "A26-S09-06's preferences surface": the preferences path cannot create a currency at all (the FK refuses first), so it is not a global-creation path; it is this functional defect instead.


### A26-M26 - On a day the bond engine refuses to price, the blend readers still value the holding; current per-account surfaces use the blended price (INV-BOND-010)

- **Canonical severity:** MEDIUM. MEDIUM for the group; A26-S14-02 (LOW) is the current-surface half of the same INV-BOND-010 gap and is absorbed.
- **Absorbs:** A26-S14-01 (primary, 14-bonds.md, session severity MEDIUM); A26-S14-02 (merged surface, 14-bonds.md, session severity LOW).
- **Invariants and prior findings named:** INV-BOND-010, INV-BOND-002, INV-BOND-005.
- **Lens:** financial.

#### A26-S14-01 (primary) - On a day the bond engine refuses to price, the blend readers still value the holding, from a carried-forward engine close or one lot's trade price

1. **Severity:** MEDIUM
2. **Confidence:** medium-high (static, traced through every branch named; not executed against a database, see 14)
3. **Location:** `backend/src/net-worth/net-worth.service.ts:1891-1895` (`loadDailyInvestments`), `:2924-2928` (`recalculateBrokerageAccount`, the stored `monthly_account_balances.market_value`), `:3071-3118` (`loadTxPriceSeries`, no bond-linked exclusion); `backend/src/net-worth/position-price.util.ts:68-84` (`positionClosePointAsOf`: the newer of the stored close and the transaction price); producer of the gap `backend/src/bonds/bond-price.service.ts:435-443, 502-516` (no row for a day whose lots or rates are unknown, and its stale rows deleted). Secondary consumers (sweep, section 12): `getLatestNetWorth` (`net-worth.service.ts:1051`) and through it the dashboard net worth and `AccountsService.getSummary` / `getLlmAccounts` totals (`accounts.service.ts:1598, 1817`); `foldInvestmentBreakdown` (`:2281`); the period result end value (`portfolio-period-result.service.ts:295`, `portfolio-period-results-batch.service.ts:235`); `daily-movement.service.ts:363`; `investment-report-data.service.ts:371`; `monte-carlo.service.ts:512-539, 709-726`; `portfolio.service.ts:1466` (month-over-month movers); `portfolio-price-freshness.util.ts:215`.
4. **Violated invariant:** INV-BOND-010 "An unknown lot makes the holding unpriced (marketValue null, pricesComplete false), never the blend"; INV-BOND-002 (a started period without a rate has no value, nothing substitutes another value); INV-BOND-005 "a transaction price is one lot's trade price, not the holding's value"; AGENTS.md "A subtotal is not a total".
5. **Realistic reproduction scenario:** Account A holds 100 bonds of EDO1034 (bought 2024-10-15 at 100.00; the engine prices it daily). On 2026-10-14 the person imports an OFX/QIF file with a BUY of 10 more EDO at 100.00 dated in a month whose series is not in the catalog. Per INV-BOND-007 the import stores the row with `bond_instrument_id` NULL and counts it in `bondRowsWithoutSeries`. From 2026-10-14 `bondLotsFromTransactions` refuses with `SERIES_NOT_DETERMINED` (`bond-lots.ts:229-236`), so `dailyPrices` emits no price for 2026-10-14 onward and `deleteStalePrices` removes any engine row there. The same happens without an import whenever a started period's benchmark observation is missing (a stalled CPI feed, a benchmark never fetched), or a lot is REFUSED (`PURCHASE_OUTSIDE_SALE_WINDOW`).
6. **Observed behaviour:** The portfolio summary and account market values (routed through `valueBondHoldings`) say the holding is unpriced: `marketValue` null, `pricesComplete` false. Net worth, the account summary totals, the period result and the investment report instead value the 110 bonds at `positionCloseAsOf`: the newer of the last engine close (2026-10-13) and the import row's trade price (2026-10-14, 100.00), so 110 x 100.00 = 11,000.00, presented as a settled figure. Without a priced row on or after the gap (a missing rate, an ADD_SHARES), the last engine close is carried forward over the unknown days for every lot, the unknown ones included.
7. **Expected behaviour:** A day on which the engine refuses a linked security's lots is unknown on every surface: the figure is null (or relabelled as a known subtotal of the derivable lots) with the refusal named, as the routed surfaces already do. A transaction price of a linked security never stands for the holding's value.
8. **Impact:** Financial display integrity. Numerical example (the engine close is illustrative, the arithmetic is exact): engine close on 2026-10-13 P = 111.62; known part (the 100 derivable bonds) = 11,162.00; the 10 new bonds unknown. Net worth shows 11,000.00 as a total; the honest answer is "unknown" with a known subtotal of 11,162.00 for the 100 bonds; difference against that subtotal 162.00 (1.45 %), and the figure carries no flag. In the carry-forward variant (no newer trade price) it shows 110 x 111.62 = 12,278.20, which prices 10 bonds the engine cannot value. The dashboard net worth and the per-account list (routed) then disagree by the whole holding. The AI/MCP `list_accounts` totals inherit the same figure. No balance or ledger row is wrong; the derived figures are.
9. **Root cause:** The blend readers treat `security_prices` as "the latest accepted close on or before the day", the right rule for a quoted security. For a bond-linked security the absence of an engine row is a refusal, not a missing quote, and `loadTxPriceSeries` and `positionClosePointAsOf` know nothing of the link, so the refusal is overwritten by a carry-forward or a trade price.
10. **Recommended correction:** In the net-worth valuation series, for a security with `bond_program_id`, read only `bond_engine` (or `manual`) rows and only on their own day: no transaction-price fallback and no carry-forward past a day the engine left without a row; a missing day makes the security's value for that day unknown and the series' completeness flag false, the same `FxAggregate`/`pricesComplete` channel the series already uses for a missing rate. The decision belongs to S13 (net worth) for the flag plumbing; this slice states the bond side.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/net-worth/net-worth.service.ts
+++ b/backend/src/net-worth/net-worth.service.ts
@@ -3079,10 +3079,14 @@ export class NetWorthService {
     const rows = await this.scopedQuery<TransactionPriceRow>(
       `WITH boundary_dates AS (
          SELECT DISTINCT ON (security_id) security_id, transaction_date
            FROM investment_transactions
           WHERE security_id = ANY($1::UUID[])
+            -- A bond-linked security is valued by the engine only (INV-BOND-005,
+            -- INV-BOND-010): one lot's trade price never stands for the holding.
+            AND security_id NOT IN (
+                  SELECT id FROM securities WHERE bond_program_id IS NOT NULL)
             AND action = ANY($2)
@@ -3102,6 +3106,8 @@ export class NetWorthService {
        windowed AS (
          SELECT security_id, transaction_date,
                 ROUND(AVG(price::numeric), 6) AS price
            FROM investment_transactions
           WHERE security_id = ANY($1::UUID[])
+            AND security_id NOT IN (
+                  SELECT id FROM securities WHERE bond_program_id IS NOT NULL)
             AND action = ANY($2)
--- a/backend/src/net-worth/position-price.util.ts
+++ b/backend/src/net-worth/position-price.util.ts
@@ -51,6 +51,20 @@
+/**
+ * A bond-linked security's close on `date` itself, or null: the engine writes a
+ * row for every day it can value and none for a day it refuses (INV-BOND-002),
+ * so a carried close would price a refusal.
+ */
+export function engineCloseOn(
+  stored: PricePoint[] | undefined,
+  date: string,
+): number | null {
+  const point = stored && stored.length > 0 ? pointAsOf(stored, date) : null;
+  return point && point.date === date ? point.close : null;
+}
```

    and at `net-worth.service.ts:1891` and `:2924`, `const price = security?.bondProgramId ? engineCloseOn(pricesBySec.get(secId), dateStr) : positionCloseAsOf(...)`, with a null price recorded as an unknown component of that day's `FxAggregate` (not skipped). **Incomplete**: the month-end variant (`:2924`) needs a decision for a month whose last day falls before the user's financial today has been priced (the 06:45 cron), and the series flag that carries "unknown" to the dashboard and the LLM shape is S13's; `securities.bond_program_id` is assumed to be on the loaded `securityMap` entity.
12. **Recommended regression test:** an integration test with one linked security, two derivable lots and a third BUY stored with a NULL series: `getDailyInvestments` (and `getLatestNetWorth`) on a day after the NULL row reports the security unknown, never `quantity x` the trade price or the carried engine close.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
--- a/backend/test/integration/bond-holding-value.integration.spec.ts
+++ b/backend/test/integration/bond-holding-value.integration.spec.ts
@@
+  it("a day the engine refuses is unknown in net worth, never a trade price", async () => {
+    // 100 bonds of a stored series bought 2024-10-15; recompute writes engine rows.
+    // A BUY of 10 at 100.00 on 2026-10-14 written with bond_instrument_id NULL
+    // (the import path), then recompute: no engine row from 2026-10-14.
+    const series = await netWorth.getDailyInvestments(userId, "2026-10-13", "2026-10-15");
+    const day = series.find((p) => p.date === "2026-10-15")!;
+    expect(day.value).toBeNull();               // not 11000.00
+    expect(day.valuationComplete).toBe(false);
+  });
```

14. **Verification method:** the integration test above against PostgreSQL; `bond-prices.integration.spec.ts` and `bond-holding-value.integration.spec.ts` still green; the net-worth unit suite for the non-bond fallback (a manual or imported price still honoured for an ordinary security, #1242). Not executed in this session: the scenario needs the import writer plus the net-worth fold on a real database, and MEDIUM does not require it under plan step 7.
15. **Residual risks:** the diff does not cover the intraday path (`portfolio.service.ts:2049, 2577-2586`), which values a linked security at the ledger close of the day, nor the per-account split (A26-S14-02).

Causality: `NEW_SINCE_UPSTREAM_AUDIT` (the bond link and the engine price are new; the net-worth fallback predates them and was not adapted). Surfaces (Rule 7): net worth daily and monthly, latest net worth (dashboard, account summary totals, LLM account totals), period result, daily movement, investment report, Monte Carlo, month-over-month movers, late-price adjustment. Overlap: S13 owns the net-worth flag; consolidate there in S23 if S13 reports the same root.

#### A26-S14-02 (merged surface) - Three current per-account surfaces value a bond-linked holding at quantity x the blended price; INV-BOND-010 lists only historical series as not enforced

1. **Severity:** LOW
2. **Confidence:** high
3. **Location:** `backend/src/monte-carlo/monte-carlo.service.ts:709, 717-728` (`getHoldingStats`, per-account `marketValue`); `backend/src/investment-reports/investment-report-data.service.ts:333, 368-369` (`computeHoldings`, per account unless `mergeAccounts`, as-of defaulting to the latest market day); `backend/src/net-worth/net-worth.service.ts:2924-2935` (`recalculateBrokerageAccount`, current month's per-account `market_value`, read by net worth by account). Index: `docs/system-invariants.md:3880-3898` (INV-BOND-010 Enforcement).
4. **Violated invariant:** INV-BOND-010: the current market value of a bond-linked holding (one account, one security) is its own account's lots, never quantity x the daily blend.
5. **Realistic reproduction scenario:** One security linked to an EDO-like program; account A holds 100 bonds of an older series, account B 100 bonds of a newer one. Engine gross values today (illustrative): A 111.62 per bond, B 101.10 per bond. Blend = (11,162.00 + 10,110.00) / 200 = 106.36.
6. **Observed behaviour:** Monte Carlo's holding stats, the investment report and net worth by account show A = 10,636.00 and B = 10,636.00.
7. **Expected behaviour:** A = 11,162.00, B = 10,110.00, as the portfolio summary and the account list (`valueBondHoldings`) show; difference 526.00 per account (4.7 % of A, 5.2 % of B). Totals agree (21,272.00), so the error is the split.
8. **Impact:** per-account figures disagree across surfaces for a person holding one bond program in two accounts; the Monte Carlo per-account table and the investment report misstate each account. No total, ledger row or balance is wrong. The S01 hand-off named the Monte Carlo path; the weighting path (`:512-539`) sums over accounts and is exact (R6).
9. **Root cause:** These surfaces read `security_prices` per holding; the index's "not enforced" list names only historical per-account series, so the current surfaces were never routed.
10. **Recommended correction:** route the three current surfaces through `valueBondHoldings` (or `ownLotsGrossValue` per holding) as `calculateHoldingsWithValues` does; and widen the INV-BOND-010 Status text to name what is still unrouted, so the index states the gap honestly.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/monte-carlo/monte-carlo.service.ts
+++ b/backend/src/monte-carlo/monte-carlo.service.ts
@@ -706,6 +706,9 @@
     const currentPrices =
       await this.portfolioService.getLatestPrices(securityIds);
+    // A bond-linked holding is its own account's lots (INV-BOND-010).
+    const bondValues = await this.portfolioCalculation.valueBondHoldings(
+      userId, active);
@@ -722,8 +725,11 @@
         quantity: Number(h.quantity),
-        marketValue:
-          price == null ? null : roundMoney(Number(h.quantity) * price),
+        marketValue: h.security?.bondProgramId
+          ? bondValues.get(`${h.accountId}:${h.securityId}`) ?? null
+          : price == null
+            ? null
+            : roundMoney(Number(h.quantity) * price),
--- a/docs/system-invariants.md
+++ b/docs/system-invariants.md
@@ -3897,1 +3897,4 @@
-Status              partial (historical per-account series)
+Status              partial (historical per-account series; and three current
+                    per-account surfaces still read the blend: Monte Carlo
+                    holding stats, the investment report holdings, net worth by
+                    account for the current month)
```

    **Incomplete**: `valueBondHoldings`' exact signature and return shape (`portfolio-calculation.service.ts:1742`) must be matched, and `MonteCarloService` may not inject `PortfolioCalculationService` today; the investment report and the net-worth month need the same routing in their own idiom.
12. **Recommended regression test:** a Monte Carlo `getHoldingStats` unit test with two accounts holding different series of one program, asserting each account's `marketValue` equals its lots' value.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
--- a/backend/src/monte-carlo/monte-carlo.service.spec.ts
+++ b/backend/src/monte-carlo/monte-carlo.service.spec.ts
@@
+  it("values a bond-linked holding from its own account's lots", async () => {
+    // valueBondHoldings mock: A -> 11162.00, B -> 10110.00; getLatestPrices -> 106.36
+    const stats = await service.getHoldingStats(userId, [accountA, accountB]);
+    expect(stats.find((a) => a.accountId === accountA)!.holdings[0].marketValue).toBe(11162);
+    expect(stats.find((a) => a.accountId === accountB)!.holdings[0].marketValue).toBe(10110);
+  });
```

14. **Verification method:** the unit test above; `portfolio-calculation.service.spec.ts` unchanged; `instruction-files`/`doc-paths` specs after the doc edit.
15. **Residual risks:** the routed value is computed on the person's financial today; the investment report's as-of may be a past day, which needs `valueByAccount(userId, securityId, date)` with that date.

Causality: `NEW_SINCE_UPSTREAM_AUDIT`.


### A26-M27 - GEM momentum prices one role from a close up to 14 days before the boundary while its series holds a later close

- **Canonical severity:** MEDIUM. kept MEDIUM.
- **Absorbs:** A26-S15-02 (primary, 15-loans-strategies.md, session severity MEDIUM).
- **Invariants and prior findings named:** none in the index (see field 4 of each member).
- **Lens:** financial.

#### A26-S15-02 (primary) - GEM momentum prices one role from a close up to 14 days before the boundary while its series already holds a later close, so the signal compares different sessions and is materialized for good

1. **Severity:** MEDIUM
2. **Confidence:** high (executed)
3. **Location:** `backend/src/strategies/gem-momentum.util.ts:191-237` (`spanCloses`: each end `pointAsOf` within `BOUNDARY_LAG_DAYS`; the "settled" test is only `prices[last].date < to`), `backend/src/common/time-series/price-boundary.util.ts:44, 82-99`; materialized once: `gem-signal.service.ts:439-441, 481-486` (per the sweep, read).
4. **Violated invariant:** the AGENTS.md rule "a board of movers is one session's" applied to a ranking of returns (`keepNewestSession`): roles compared over one window must be priced at the same session; and the hint's "signal computed at one session".
5. **Reproduction:** monthly GEM, 12-month lookback, evaluation 2026-09-30. US fund 100 -> 110 (close on 09-30). Ex-US fund 100 -> its feed has no closes 2026-09-19..09-30 (a refresh outage), last close 104 on 09-18, then 113 on 10-01 when the feed resumes; its true 09-30 close was 112. Safe asset +3 %.
6. **Observed (executed, `src/zz/zz-gem.spec.ts` over the real `momentumSnapshot` and `evaluate`):** `{"US_EQUITY":10,"EX_US_EQUITY":4,"SAFE":3}` -> `RISK_ON`, target `US_EQUITY`, lead 6 pp.
7. **Expected:** the ex-US span is not settled for 09-30 (the series has a gap at the boundary while other roles have the boundary's close), so the period defers (`UNELAPSED`) or refuses naming the role and the missing session; with the true close (+12 %) the target is `EX_US_EQUITY`.
8. **Impact:** the wrong fund is recommended for the whole period and the stored signal is never re-evaluated after the gap is repaired; the user may switch the whole strategy allocation (a financially significant action) on it.
9. **Root cause:** the settled test asks whether the series has *any* close at or after the boundary, not whether its exit close is the boundary session the other roles use; the 14-day lag that tolerates exchange holidays also tolerates a feed gap.
10. **Recommended correction:** price the exit of every role at one common session: the newest date on or before the boundary on which every role has a close (or each role's exit within a small holiday tolerance of the newest exit across roles), otherwise `UNELAPSED`/refuse with the role named.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/strategies/gem-momentum.util.ts
+++ b/backend/src/strategies/gem-momentum.util.ts
@@ export function spanCloses(
   if (end === "BOUNDARY" && prices[prices.length - 1].date < to) {
     return { state: "UNELAPSED" };
   }
+  // A close exists after the boundary but none near it: the series has a gap
+  // at the boundary (a feed outage), not a holiday. Defer rather than price the
+  // span off an older session than the other roles use.
+  if (end === "BOUNDARY" && daysBetween(exit.date, to) > BOUNDARY_HOLIDAY_DAYS) {
+    return { state: "UNELAPSED" };
+  }
```

   with `BOUNDARY_HOLIDAY_DAYS` (for example 4) in `price-boundary.util.ts`. Decision for the maintainer: a per-role holiday tolerance (above) or a common-session rule across roles in `momentumSnapshot` (stronger, needs the roles' series together). Needs: unit cases, the backfill's gap test (`gem-backfill.service.ts:98-104`) aligned.
12. **Recommended regression test:** the counterexample above as a `gem-momentum.util.spec.ts` case asserting the ex-US role is not `PRICED` (or the snapshot refuses) for 2026-09-30.
13. **Suggested regression-test diff (illustrative, not applied):** `it("does not price a role across a feed gap at the boundary", () => { const m = momentumSnapshot({ US_EQUITY: us, EX_US_EQUITY: exWithGap, SAFE: safe }, "2026-09-30", 12); expect(m.EX_US_EQUITY).toBeNull(); });`
14. **Verification:** `TZ=UTC npm run test:unit -- src/strategies`; a backtest regression to confirm holiday boundaries still price.
15. **Residual risks:** a market closed for more than the tolerance (a long national holiday) would defer a period; the materialized row needs re-evaluation for periods already stored on a gap (a data repair decision).

- Causality: `NEW_SINCE_UPSTREAM_AUDIT` (`backend/src/strategies/` is new).


### A26-M28 - The loan payment history counts VOID payments, VOID interest expenses and future-dated payments as paid

- **Canonical severity:** MEDIUM. kept MEDIUM.
- **Absorbs:** A26-S15-03 (primary, 15-loans-strategies.md, session severity MEDIUM).
- **Invariants and prior findings named:** INV-TRANSFER-001, INV-LOAN-HISTORY-001.
- **Lens:** financial.

#### A26-S15-03 (primary) - The loan payment history counts VOID payments, VOID interest expenses and future-dated payments as paid

1. **Severity:** MEDIUM
2. **Confidence:** high (VOID: executed by the frontend sweep's Vitest probe over the real `deriveLoanPaymentHistory`, re-verified by reading; future-dated: executed by the same probe)
3. **Location:** `frontend/src/lib/loan-history.ts:1536-1552` (`fetchAllAccountTransactions`: no `statuses`, no date bound), the derivation (no `status` or date read anywhere in the module: `grep -n "VOID\|status" loan-history.ts` returns nothing); backend `transactions.service.ts:1403-1407` (status filtered only when `statuses` is passed). Consumers: `LoanAmortizationReport.tsx` cards, table, CSV/PDF, the projection seed (`observedInstallment`), `hooks/useLoanProjection.ts`.
4. **Violated invariant:** INV-TRANSFER-001 ("VOID means no balance moved, on every surface"), INV-LOAN-HISTORY-001 (interest counted as paid is ledger-backed), and the shared inclusion rule `LEDGER_MOVEMENT_PREDICATE` the backend balance readers use.
5. **Reproduction:** loan opening 10,000; a 1,000 payment on 2026-01-15; a second 1,000 payment on 2026-02-15 that bounced and was voided. Separately: a standalone interest expense of 50 voided. Separately: a 500 payment entered for 2026-12-15 (today 2026-10-21).
6. **Observed:** cumulative principal **2,000.00**, last history balance **8,000.00** (account balance 9,000.00); interest **50.00** from the voided expense; the future 500 is listed as paid (history principal 1,500) and the projection, which starts from the 9,000.00 current balance, pays it again (history + projection principal 10,500.02 on a 10,000 loan).
7. **Expected:** 1,000.00 / 9,000.00; 0.00; the future row either excluded from history or the projection anchored after it.
8. **Impact:** "Total Principal Paid", "Total Interest Paid", the per-row balance, the exports and the projection seed are wrong by the voided or future amount; 1,000.00 here (10 % of the loan).
9. **Root cause:** the client history re-derives row inclusion instead of applying the ledger's (non-VOID, top-level, dated through today).
10. **Recommended correction:** request only `statuses` other than VOID and bound the fetch at the user's today (`financialTodayYmd`), or filter both in `deriveLoanPaymentHistory`; add a source-scan guard that the module reads `status`.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/frontend/src/lib/loan-history.ts
+++ b/frontend/src/lib/loan-history.ts
@@ export function deriveLoanPaymentHistory(
-  const sorted = [...transactions].sort(byDate);
+  // The ledger's own inclusion: a VOID row moved nothing, and a row dated
+  // after today is not history yet (the projection pays it).
+  const counts = (t: Transaction) =>
+    t.status !== 'VOID' && t.transactionDate <= todayYmd;
+  const sorted = transactions.filter(counts).sort(byDate);
+  const interestRows = interestTransactions.filter(counts);
```

   (`todayYmd` passed in by the callers, which already hold it for the projection, INV-LOAN-006's frontend half). Needs: the call sites, the tests.
12. **Recommended regression test:** the three probe cases in `loan-history.test.ts` with monetary asserts.
13. **Suggested regression-test diff (illustrative, not applied):** `it("ignores a VOID payment", () => { const h = deriveLoanPaymentHistory(acct(), [tx({ amount: 1000, transactionDate: "2026-01-15" }), tx({ amount: 1000, transactionDate: "2026-02-15", status: "VOID" })], [], [], "2026-10-21"); expect(h.cumulativePrincipal).toBe(1000); });`
14. **Verification:** `npm run test -- loan-history LoanAmortizationReport`; `npm run type-check`.
15. **Residual risks:** a refund sign (A26-S15-05) and the shared-category merge (section 11) are separate.

- Causality: `PRE_EXISTING_UNREPORTED` for VOID (the module's history predates the upstream audit by its own comments; not provable in the shallow clone), the future-date half likewise.


### A26-M29 - An installment below the period's interest is booked as settling the period; the unpaid interest is recorded nowhere

- **Canonical severity:** MEDIUM. kept MEDIUM.
- **Absorbs:** A26-S15-04 (primary, 15-loans-strategies.md, session severity MEDIUM).
- **Invariants and prior findings named:** INV-LOAN-006.
- **Lens:** financial.

#### A26-S15-04 (primary) - An installment below the period's interest is booked as settling the period; the unpaid interest is recorded nowhere and the loan stops growing

1. **Severity:** MEDIUM
2. **Confidence:** medium (executed; the expected treatment is a product decision)
3. **Location:** `backend/src/accounts/loan-payment-waterfall.util.ts:59-71` (`interest = Math.min(interest, paymentAmount); principal = 0`), consumed by `priceInstallment` (`price-installment.ts:677-683`) for every purpose.
4. **Violated invariant:** INV-LOAN-006's statement "the interest of a scheduled loan installment is roundMoney(debt x periodic rate)", and "withholding a figure is only honest if the reader learns why" (AGENTS.md): the shortfall is neither booked nor reported.
5. **Reproduction:** LOAN 400,000 at 6 % monthly, schedule payment 1,500 (for example after a rate rise whose payment sync the user declined, INV-LOAN-006 known gap). Post 2026-08-01 and 2026-09-01.
6. **Observed (executed, R3):** each posting books interest 1,500.00 and principal 0.00; the loan ledger stays at 400,000.00; the template keeps 1,500 / 0; no log, alert or flag.
7. **Expected:** interest accrued 2,000.00 per period; either the 500.00 shortfall is capitalized onto the debt (negative amortization, debt 400,500 then 401,002.50) or the posting/template carries an explicit "does not cover interest" state the bill and the loan page show.
8. **Impact:** the loan balance understates the debt by 500.00 per period (6,000.00 after a year, 1.5 %); every forecast and payoff date read from the ledger is optimistic; the frontend projection already refuses the same loan (`coveredInterest: false`), so the two layers disagree silently.
9. **Root cause:** the cap was added so a child cannot exceed its parent (RR2-006); nothing records what the cap removed.
10. **Recommended correction:** decide the convention (capitalize, or flag); minimum: return the shortfall from `allocateLoanPayment` and surface it on the occurrence projection and the bill as a warning; capitalization would add a loan-side interest accrual row.
11. **Suggested remediation diff: incomplete.** Supported part:

```diff
--- a/backend/src/accounts/loan-payment-waterfall.util.ts
+++ b/backend/src/accounts/loan-payment-waterfall.util.ts
@@ export interface LoanPaymentAllocation {
   total: number;
+  /** Accrued interest the installment did not cover (0 when covered). */
+  unpaidInterest: number;
 }
@@
-  if (interest > basePayment) {
+  const accrued = interest;
+  if (interest > basePayment) {
     interest = Math.min(interest, paymentAmount);
     principal = 0;
   }
@@
   return {
     principal,
     interest,
     extraPrincipal,
     total: roundMoney(principal + interest + extraPrincipal),
+    unpaidInterest: roundMoney(Math.max(0, accrued - interest)),
   };
```

   Missing: the maintainer's choice between capitalizing (a ledger row on the loan, with its own invariant) and flagging (the occurrence projection's `complete`/warning field and the bill UI).
12. **Recommended regression test:** R3 with an assert on the chosen behaviour (`unpaidInterest === 500` on the allocation and on the projection).
13. **Suggested regression-test diff (illustrative, not applied):** `expect(allocateLoanPayment({ paymentAmount: 1500, extraPrincipal: 0, interest: 2000, principal: -500, currentBalance: 400000 })).toMatchObject({ interest: 1500, principal: 0, unpaidInterest: 500 });`
14. **Verification:** `npm run test:unit -- loan-payment-waterfall price-installment`; R3 through `post()`.
15. **Residual risks:** a lender that treats the shortfall as arrears (not capitalized) would want a third treatment.

- Causality: `PRE_EXISTING_UNREPORTED` (the cap predates the new modules; the exact introduction date is not provable in the shallow clone).


### A26-M30 - Loan payment setup accepts a source account in another currency; every posting of the bill is then refused

- **Canonical severity:** MEDIUM. kept MEDIUM.
- **Absorbs:** A26-S15-10 (primary, 15-loans-strategies.md, session severity MEDIUM).
- **Invariants and prior findings named:** INV-LOAN-006.
- **Lens:** financial.

#### A26-S15-10 (primary) - Loan payment setup accepts a source account in another currency and writes a bill in the loan's currency on it; every posting of that bill is refused

1. **Severity:** MEDIUM
2. **Confidence:** high for the posting refusal (executed); medium that the setup path reaches it (by reading: no currency check found)
3. **Location:** `backend/src/accounts/loan-payment-setup.service.ts:227-237` (source account checked for ownership only), `:488-505` (schedule created on `dto.sourceAccountId` with `currencyCode: account.currencyCode`, the loan's); `scheduled-transactions.service.ts:960-975` (`create` stores the DTO's `currencyCode`; `resolveScheduleFx` only reads `originalCurrencyCode`); the refusal at posting `common/fx-entry.util.ts:205` through `transactionsService.create`; the create paths in `loan-mortgage-account.service.ts:290, 533` pass the same currency (not traced to their source-account check). Frontend: no currency filter on the setup dialog's source account (`LoanPaymentSetupDialog.tsx`, searched).
4. **Violated invariant:** "a currency code is derived from the account, never accepted from the request" (`assertTransactionCurrencyMatchesAccount`); a schedule that can never post is the state INV-LOAN-006's fail-safe text calls the worst outcome ("a bill that never posts again").
5. **Reproduction:** a EUR mortgage (or a CHF one, common for Polish borrowers) paid from a PLN current account: set up payments with the PLN account as source.
6. **Observed (executed, `zz-s15-fx`, the setup's shape: schedule currency EUR on a PLN account, transfer split to the EUR loan):** `post()` answers **400 "Transaction currency EUR must match the account currency PLN. Use originalAmount and originalCurrencyCode for a foreign-currency entry."**; nothing written, no claim, cursor unchanged; every auto-post tick fails the same way (the cron raises an alert for a non-conflict error).
7. **Expected:** the setup refuses a source account in another currency with a message naming both currencies, or builds a cross-currency transfer bill the posting can convert (a decision: the settlement path already refuses `transfer_currency_mismatch`, spec section 11 row 8, so refusing is consistent).
8. **Impact:** the loan's payments are never booked by the app; the user learns it only from the posting error or the alert, after the setup reported success.
9. **Root cause:** the setup validates ownership but not currency, and the schedule create trusts the DTO's currency.
10. **Recommended correction:** refuse in `setupLoanPayments` (and the account-create paths) when `sourceAccount.currencyCode !== account.currencyCode`, before any write; independently, make `ScheduledTransactionsService.create` derive or verify `currencyCode` against the schedule's account.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/accounts/loan-payment-setup.service.ts
+++ b/backend/src/accounts/loan-payment-setup.service.ts
@@
     if (!sourceAccount) {
       throw new BadRequestException(
         tr("errors.accounts.sourceNotFound", "Source account not found"),
       );
     }
+    // The bill is booked on the source account in the loan's currency; a
+    // posting refuses a currency the account does not hold.
+    if (sourceAccount.currencyCode !== account.currencyCode) {
+      throw new BadRequestException(
+        tr(
+          "errors.accounts.loanSourceCurrencyMismatch",
+          `The payment account is in ${sourceAccount.currencyCode} and the loan in ${account.currencyCode}. Choose an account in ${account.currencyCode}.`,
+          { source: sourceAccount.currencyCode, loan: account.currencyCode },
+        ),
+      );
+    }
```

   Needs: the i18n key; the same check on the create paths; a decision whether cross-currency loan payment is a feature to build (then an FX transfer template, which INV-LOAN-006's pricing would have to price in two currencies).
12-14. **Test:** a `loan-payment-setup.service.spec.ts` case with a PLN source and a EUR loan asserting the refusal and no schedule written; the `zz-s15-fx` probe as an integration case for the posting side. `npm run test:unit -- loan-payment-setup`.
15. **Residual risks:** existing schedules already in this state stay unpostable until edited (a data question for the maintainer).

- Causality: `PRE_EXISTING_UNREPORTED` (setup predates the new modules; not provable in the shallow clone).


### A26-M31 - The account exclusions chosen in the budget wizard are stored and never applied

- **Canonical severity:** MEDIUM. kept MEDIUM.
- **Absorbs:** A26-S16-02 (primary, 16-budgets-reports.md, session severity MEDIUM).
- **Invariants and prior findings named:** none in the index (see field 4 of each member).
- **Lens:** financial.

#### A26-S16-02 (primary) - The account exclusions chosen in the budget wizard are stored and never applied

1. **Severity:** MEDIUM
2. **Confidence:** high (static; a repo-wide search finds no reader)
3. **Location:** written by `frontend/src/components/budgets/BudgetWizardStrategy.tsx:145-149` and `BudgetWizardReview.tsx:71-72` (shown back as "N accounts excluded", `:158-164`); stored in `budgets.config` (`entities/budget.entity.ts:29-30`); read nowhere in `backend/src` (no match outside the entity and two specs).
4. **Violated invariant:** an explicit user instruction is honoured (protocol MEDIUM example "explicit user instruction silently ignored").
5. **Reproduction:** create a budget through the wizard, excluding a business credit card; spend 300.00 in Groceries on that card.
6. **Observed:** Groceries `spent` includes 300.00; alerts fire on it.
7. **Expected:** the excluded account's rows are out of every actuals query and out of the generator's history analysis.
8. **Impact:** wrong budget actuals and alerts for every user who used the exclusion; the review screen tells them it was applied.
9. **Root cause:** the option was added to the wizard and the JSONB config without a backend consumer.
10. **Recommended correction:** apply `t.account_id NOT IN (:...excluded)` in `queryCategorySpending`, `computePeriodActuals`, `computeActualIncome`, the transfer builders (source side) and `BudgetGeneratorService`; or remove the option from the wizard. Product decision; the safer candidate is to honour it.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/budgets/budget-spending.util.ts
+++ b/backend/src/budgets/budget-spending.util.ts
@@ export async function queryCategorySpending(
   periodStart: string,
   periodEnd: string,
+  excludedAccountIds: readonly string[] = [],
 ): Promise<{
@@
       .andWhere("t.is_split = false")
+    if (excludedAccountIds.length > 0) {
+      directQb.andWhere("t.account_id NOT IN (:...excludedAccountIds)", {
+        excludedAccountIds,
+      });
+    }
```

   and the callers pass `budget.config?.excludedAccountIds ?? []`.
12. **Recommended regression test:** an integration case with one excluded account: its expense is not in `spent`.
13. **Suggested regression-test diff:** as A26-S16-01's spec, with `config: { excludedAccountIds: [cardId] }` and `expect(spent).toBe(200)`.
14. **Verification:** `npm run test:unit -- budget`, `npm run test:integration -- budget`.
15. **Residual risks:** a transfer line whose source is an excluded account is a semantic choice to state in the spec.

Causality: `PRE_EXISTING_UNREPORTED` (not verified whether the wizard option predates `d5cea9bf`).


### A26-M32 - Closing a budget period never writes a rollover: `closePeriod` does not load the relation `computeRollover` reads

- **Canonical severity:** MEDIUM. kept MEDIUM.
- **Absorbs:** A26-S16-03 (primary, 16-budgets-reports.md, session severity MEDIUM).
- **Invariants and prior findings named:** none in the index (see field 4 of each member).
- **Lens:** financial.

#### A26-S16-03 (primary) - Closing a period never writes a rollover: `closePeriod` does not load the relation `computeRollover` reads

1. **Severity:** MEDIUM
2. **Confidence:** high (executed, P2)
3. **Location:** `backend/src/budgets/budget-period.service.ts:130-133` (`relations: ["periodCategories"]`), `:156-157`, `:293-300` (`if (!budgetCategory || ...) return 0`).
4. **Violated invariant:** a category with `rollover_type != NONE` carries its unused budget into the next period (the feature's contract, `computeRollover`).
5. **Reproduction (executed):** budget line Groceries 500.00, `rollover_type = MONTHLY`, no cap; OPEN period September 2026 with `effective_budget 500`; -200.00 spent in September; `closePeriod`.
6. **Observed:** September `actual_amount 200, rollover_out 0`; October `rollover_in 0, effective_budget 500` (probe P2).
7. **Expected:** `rollover_out 300`; October `rollover_in 300, effective_budget 800`.
8. **Impact:** -300.00 (-37.5 percent of the expected effective budget) per category per month; the rollover setting is silently inert for every user, on the cron and the manual path alike.
9. **Root cause:** `BudgetPeriodCategory.budgetCategory` is a lazy-free `@ManyToOne` that is not hydrated; the unit fixtures hydrate it by hand (`budget-period-lifecycle.spec.ts:405, 421, 437, 453`), so the defect is invisible to every suite (fixture cleaner than production).
10. **Recommended correction:** load `periodCategories.budgetCategory` in the second read (the lock is on the first query, so the outer join is allowed there), or look the line up in `budget.categories` (already loaded, `:159-161`).
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/budgets/budget-period.service.ts
+++ b/backend/src/budgets/budget-period.service.ts
@@ -130,7 +130,7 @@
       const openPeriod = await periods.findOne({
         where: { id: locked.id },
-        relations: ["periodCategories"],
+        relations: ["periodCategories", "periodCategories.budgetCategory"],
       });
```

12. **Recommended regression test:** the P2 scenario against PostgreSQL.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+it("carries the unused budget into the next period", async () => {
+  // MONTHLY rollover, 500 budgeted, 200 spent in the closed month
+  await withUserContext(userId, () => periods.closePeriod(userId, budgetId));
+  const [closed, next] = await rowsByPeriod(budgetId);
+  expect(closed.rollover_out).toBe("300.0000");
+  expect(next.rollover_in).toBe("300.0000");
+  expect(next.effective_budget).toBe("800.0000");
+});
```

14. **Verification:** the new integration case; `npm run test:unit -- budget-period`.
15. **Residual risks:** `QUARTERLY` and `ANNUAL` are treated as `MONTHLY` by `computeRollover`; that semantics is not decided by this fix. The live budget page (`getSummary`) uses `bc.amount` and ignores `effective_budget` entirely, so even a fixed rollover reaches only the period detail view.

Causality: `PRE_EXISTING_UNREPORTED`.


### A26-M33 - A category's cost is not its signed sum: the custom report engine sums absolute values, the loan summary adds an interest refund to "Interest Paid"

- **Canonical severity:** MEDIUM. MEDIUM for the group; A26-S15-05 (LOW) violates the same netting rule and is absorbed.
- **Absorbs:** A26-S16-05 (primary, 16-budgets-reports.md, session severity MEDIUM); A26-S15-05 (merged surface, 15-loans-strategies.md, session severity LOW).
- **Invariants and prior findings named:** none in the index (see field 4 of each member).
- **Lens:** financial.

#### A26-S16-05 (primary) - The custom report engine sums the absolute value of every row, so a refund raises a category's cost

1. **Severity:** MEDIUM
2. **Confidence:** high (static; the arithmetic is direct)
3. **Location:** `backend/src/reports/reports.service.ts:817, 833, 855, 858, 896, 905, 959, 1019, 1030, 1091` (`Math.abs(...)` per row or line); direction filter `:581-596` (`EXPENSES_ONLY` default `:74`, keeps `amount < 0` only).
4. **Violated invariant:** AGENTS "A category's cost is its signed sum over rows of both signs, netted within one category" (`isNetSpending` / `NET_SPEND_AMOUNT`, issue #1125).
5. **Reproduction:** Groceries -100.00 and a +30.00 refund in the same month. Built-in Spending by Category; custom report by category with direction `EXPENSES_ONLY`, then `BOTH`.
6. **Observed:** built-in 70.00; custom `EXPENSES_ONLY` 100.00 (refund dropped, the pre-#1125 rule); custom `BOTH` 130.00 (refund added).
7. **Expected:** 70.00 for the category on every surface.
8. **Impact:** +30.00 (+42.9 percent) or +60.00 (+85.7 percent) on the example; two report surfaces disagree on one category and month.
9. **Root cause:** the engine was written before the netting rule and aggregates magnitudes.
10. **Recommended correction:** accumulate the signed amount per group and present `-sum` for expense groupings (drop a group whose net is not spending, as `isNetSpending`); keep the direction filter as a row filter only where the user asked for a cash-direction view. Product decision on `BOTH`.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/reports/reports.service.ts
+++ b/backend/src/reports/reports.service.ts
@@ -893,7 +893,7 @@
           const existing = dataMap.get(categoryId) || { sum: 0, count: 0 };
-          existing.sum = roundMoney(
-            existing.sum + Math.abs(Number(split.amount)),
-          );
+          existing.sum = roundMoney(existing.sum - Number(split.amount));
@@ -905 +905 @@
-        existing.sum = roundMoney(existing.sum + Math.abs(Number(tx.amount)));
+        existing.sum = roundMoney(existing.sum - Number(tx.amount));
```

   and the same change in the other aggregators, with the sign flipped for an `INCOME_ONLY` report.
12. **Recommended regression test:** the -100 / +30 case through `executeReport`, asserting 70.
13. **Suggested regression-test diff:** a `reports.service.spec.ts` case with two hydrated transactions, `expect(result.data[0].value).toBe(70)`.
14. **Verification:** `npm run test:unit -- reports.service`.
15. **Residual risks:** the direction filter is user configuration; whether `EXPENSES_ONLY` should mean "categories that net to spending" is the maintainer's decision.

Causality: `PRE_EXISTING_UNREPORTED`.

#### A26-S15-05 (merged surface) - An interest refund in the loan's interest category is added to "Interest Paid" instead of netted

1. **Severity:** LOW
2. **Confidence:** high (executed by the frontend sweep's probe; lines re-read)
3. **Location:** `frontend/src/lib/loan-history.ts:1313` (`Math.abs(Number(tx.amount))` for every standalone interest row), `:1244-1246` (per split line).
4. **Violated invariant:** "a category's cost is its signed sum over rows of both signs" (AGENTS.md, `netEntityTotal`).
5. **Reproduction:** a -200.00 interest expense on 2026-01-15 and a +50.00 interest refund on 2026-01-16 from the lender.
6. **Observed:** interest **250.00**; an orphan +50.00 refund becomes an interest row of +50.00.
7. **Expected:** 150.00; the orphan refund reduces cumulative interest (-50.00).
8. **Impact:** Interest Paid, the exports and the tax-relevant interest total overstated by twice the refund (100.00 here).
9. **Root cause:** magnitude taken per row before summing.
10. **Recommended correction:** sum signed amounts and negate once.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
-    const amount = Math.abs(Number(tx.amount));
+    // Signed: an expense is negative, a refund positive; interest paid is the
+    // negated net, so a refund reduces it.
+    const amount = -Number(tx.amount);
```

   and the split-line sum likewise (`-Number(s.amount)`), clamping only the displayed per-row figure if a negative row must not render. Needs: the pairing code that assumes non-negative amounts re-checked.
12. **Recommended regression test / 13. diff:** `it("nets an interest refund", () => { ... intx({ amount: -200 }), intx({ amount: 50 }) ...; expect(h.cumulativeInterest).toBe(150); })`.
14. **Verification:** `npm run test -- loan-history`.
15. **Residual risks:** a refund of interest from another year changes a past year's total (correct, but visible).

- Causality: `PRE_EXISTING_UNREPORTED`.


### A26-M34 - The AI and MCP `spending_anomalies` report passes the requested number of months as the z-score threshold

- **Canonical severity:** MEDIUM. kept MEDIUM.
- **Absorbs:** A26-S17-03 (primary, 17-ai-mcp-notifications.md, session severity MEDIUM).
- **Invariants and prior findings named:** none in the index (see field 4 of each member).
- **Lens:** financial.

#### A26-S17-03 (primary) - The AI and MCP `spending_anomalies` report passes the requested number of months as the z-score threshold

1. **Severity:** MEDIUM
2. **Confidence:** high (read; the unit tests assert the defect; M4)
3. **Location:** `backend/src/ai/query/tool-executor.service.ts:2908-2924`, `backend/src/mcp/tools/reports.tool.ts:85-90` (`getSpendingAnomalies(userId, args.months ?? 3)`); callee `backend/src/built-in-reports/anomaly-reports.service.ts:37-40` (`threshold: number = 2`, fixed six-month window at `:51-54`); HTTP route `built-in-reports.controller.ts:188-197` clamps the threshold to `[0.5, 10]`. Tool descriptions `tool-definitions.ts:1051-1056`, `reports.tool.ts:65-67` ("months of history. Default 3", bounds 1..24).
4. **Violated invariant:** the tool contract it documents (months of history), parity with the HTTP report (same data, same threshold), and "A preview computes what the commit will do, through the same code" in its read form: the same report must answer the same question on every surface.
5. **Realistic reproduction scenario:** a user asks "any unusual spending?". The model omits `months` (default 3) or passes 12.
6. **Observed implementation behavior:** the anomaly search runs with z-score threshold 3 (or 12) over the fixed six-month window; at 12 nothing can qualify and the tool description tells the model an empty list "means nothing was unusual". At `months: 1` the threshold is 1 and ordinary purchases are flagged. The AI summary also says "over the last N months", which is not the window used.
7. **Expected behavior:** the default threshold (2, as the Reports page) and either a real `months` window or no `months` input.
8. **Impact:** the assistant and MCP clients answer "nothing unusual" while the Reports page lists anomalies for the same user and data, or flag noise; an explicit user parameter is silently reinterpreted. No stored data changes.
9. **Root cause:** a positional argument of the wrong meaning; the tests mock the callee and assert the wrong value.
10. **Recommended correction:** pass the threshold explicitly (the HTTP default) and either drop `months` from both schemas or add a `months` window parameter to `getSpendingAnomalies`.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/ai/query/tool-executor.service.ts
+++ b/backend/src/ai/query/tool-executor.service.ts
@@ generateReport
-      const months = (input.months as number | undefined) ?? 3;
-      const data = await this.builtInReportsService.getSpendingAnomalies(
-        userId,
-        months,
-      );
+      // The second parameter is the z-score threshold, not a window; the
+      // window is the report's own six months, as on the Reports page.
+      const data = await this.builtInReportsService.getSpendingAnomalies(userId);
       const count = data.anomalies.length;
       return {
         data,
-        summary: `${count} spending anomal${count === 1 ? "y" : "ies"} detected over the last ${months} month${months === 1 ? "" : "s"}.`,
+        summary: `${count} spending anomal${count === 1 ? "y" : "ies"} detected over the last 6 months.`,
--- a/backend/src/mcp/tools/reports.tool.ts
+++ b/backend/src/mcp/tools/reports.tool.ts
-            const data = await this.reportsService.getSpendingAnomalies(
-              user.userId,
-              args.months ?? 3,
-            );
+            const data = await this.reportsService.getSpendingAnomalies(user.userId);
```

plus removing `months` from `tool-input-schemas.ts:329`, `tool-definitions.ts:1051-1056` and `reports.tool.ts:65-67` (a `tools/list` byte reduction).
12. **Recommended regression test:** both adapter specs assert `getSpendingAnomalies` is called with the user id only (or with the documented threshold), replacing the two known-wrong assertions.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
--- a/backend/src/ai/query/tool-executor.service.spec.ts
+++ b/backend/src/ai/query/tool-executor.service.spec.ts
@@ ~1348
-      expect(builtInReports.getSpendingAnomalies).toHaveBeenCalledWith(
-        "user-1",
-        6,
-      );
+      expect(builtInReports.getSpendingAnomalies).toHaveBeenCalledWith("user-1");
```

(same in `mcp/tools/reports.tool.spec.ts:228, 243`).
14. **Verification method:** the two specs; `tools-list-budget.spec.ts` (the caps are a ratchet: lower them); `tool-output-schemas.spec.ts`.
15. **Residual risks / patch limitations:** removing an input field breaks a client that sends it only if the schema were strict; the MCP SDK validates against the declared input schema, so a stale client sending `months` would be refused. The safer first step keeps `months` accepted and ignored.

Causality: `PRE_EXISTING_UNREPORTED`. Handed from S13 (`13-valuation-fx-networth.md` section 12). Rule 7 surfaces: AI and MCP `generate_report` `spending_anomalies`.


### A26-M35 - Client caches outlive the data they derive from: recategorising writes, non-ledger valuation inputs and MNY imports invalidate nothing, and hand-rolled reads are not generation-aware (INV-CACHE-001 client half)

- **Canonical severity:** MEDIUM. MEDIUM for the group: one invariant, four client surfaces (A26-S18-07 LOW absorbed).
- **Absorbs:** A26-S18-01 (primary, 18-frontend-core.md, session severity MEDIUM); A26-S18-02 (merged surface, 18-frontend-core.md, session severity MEDIUM); A26-S18-03 (merged surface, 18-frontend-core.md, session severity MEDIUM); A26-S18-07 (merged surface, 18-frontend-core.md, session severity LOW).
- **Invariants and prior findings named:** INV-CACHE-001, MON-M38.
- **Lens:** frontend.

#### A26-S18-01 (primary) - Recategorising writes leave cached budget progress stale (MON-M38 residual)

1. **Severity:** MEDIUM
2. **Confidence:** high (executed, P1 and P2)
3. **Location:** `frontend/src/lib/categories.ts:69-78` (`reassignTransactions`, no invalidation), `frontend/src/lib/payees.ts:187-204` (`applyCategorySuggestions` with `backfillTransactions`, drops only `payees:`); callers `components/categories/CategoryList.tsx:235-258`, `app/categories/[id]/page.tsx:532-549`, `components/payees/CategoryAutoAssignDialog.tsx:122-131`, `app/payees/page.tsx:190-203`; guard `frontend/src/lib/balance-cache.guard.test.ts:29-37` (route list).
4. **Violated invariant:** INV-CACHE-001 ("a money-moving write invalidates every derived cache"); `docs/frontend/api-and-cache.md` "any categorised amount moves the budget it falls in"; MON-M38.
5. **Reproduction:** budget "Groceries 500.00", spent 300.00, `budgets:dashboard` cached (30 s), `budgets:cat-status:*` cached (60 s), `budgets:all` (120 s). Delete category "Supermarket" (120.00 of this month's spending) choosing "Groceries" as the reassignment target, or run "Auto-assign categories" with "also update existing transactions".
6. **Observed (P1, P2):** the reassign `POST /categories/:id/reassign` and the backfill `POST /payees/category-suggestions/apply` return 2xx; the next `budgetsApi.getDashboardSummary()` is served from the pre-write cache (one network call in the probe, the second read equals the first).
7. **Expected:** both writes drop `budgets:` (and the transaction-derived prefixes generally), so the dashboard shows spent 420.00, remaining 80.00.
8. **Impact:** remaining budget overstated by 120.00 (24 % of the budget) for up to two minutes after the write, on the screen a spending decision is made from; navigation does not help (the remount is served from the cache).
9. **Root cause:** the guard's `BALANCE_WRITING_ROUTES` names routes that move balances; recategorising moves no balance but moves budget progress, so neither guard sees the omission, and the two lib methods never call `invalidateBalanceCaches()`.
10. **Recommended correction:** call `invalidateBalanceCaches()` in both methods (the budget family is the one that matters; dropping `accounts:`/`investments:` too is cheap and matches the helper's contract "three views of the same rows"), and widen the guard to "routes that write transaction rows", adding the two routes.
11. **Suggested remediation diff (illustrative, not applied)**

```diff
--- a/frontend/src/lib/categories.ts
+++ b/frontend/src/lib/categories.ts
@@ -69,10 +69,13 @@
   reassignTransactions: async (
     fromCategoryId: string,
     toCategoryId: string | null,
   ): Promise<{ transactionsUpdated: number; splitsUpdated: number }> => {
     const response = await apiClient.post<{ transactionsUpdated: number; splitsUpdated: number }>(
       `/categories/${fromCategoryId}/reassign`,
       { toCategoryId },
     );
+    // Moving rows between categories moves budget progress.
+    invalidateBalanceCaches();
+    invalidateCache('categories:');
     return response.data;
   },
--- a/frontend/src/lib/payees.ts
+++ b/frontend/src/lib/payees.ts
@@ -200,6 +200,9 @@
     invalidateCache('payees:');
+    // A backfill writes category_id onto existing transactions.
+    if (totalBackfilled > 0) invalidateBalanceCaches();
     return { updated: totalUpdated, transactionsBackfilled: totalBackfilled };
--- a/frontend/src/lib/balance-cache.guard.test.ts
+++ b/frontend/src/lib/balance-cache.guard.test.ts
@@ -29,6 +29,10 @@
 const BALANCE_WRITING_ROUTES = [
   /['`]\/transactions/,
+  // Recategorising writes category_id on transaction rows: budget progress moves.
+  /['`]\/categories\/\$\{[^}]+\}\/reassign['`]/,
+  /['`]\/payees\/category-suggestions\/apply['`]/,
```

12. **Recommended regression test:** prime `budgets:dashboard`, run each write, assert the next read goes to the network.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
--- a/frontend/src/lib/categories.test.ts
+++ b/frontend/src/lib/categories.test.ts
+  it('reassigning transactions drops cached budget progress', async () => {
+    setCache('budgets:dashboard', { remaining: 100 });
+    vi.mocked(apiClient.post).mockResolvedValue({ data: { transactionsUpdated: 1, splitsUpdated: 0 } });
+    await categoriesApi.reassignTransactions('from', 'to');
+    expect(getCached('budgets:dashboard')).toBeUndefined();
+  });
```

14. **Verification:** `npm run test -- categories payees balance-cache apiCache`; the probe P1/P2 inverted.
15. **Residual risks:** the guard stays a route list; a future recategorising route (rules run already uses `clearAllCache()`) needs adding. Causality: `PRIOR_REPORTED` (MON-M38), `CONFIRMED_WITH_DIFFERENT_ROOT_CAUSE`: the transaction create/edit/delete/VOID paths named by MON-M38 are fixed; the residual is the recategorising surfaces.

#### A26-S18-02 (merged surface) - Hand-rolled cache reads are not generation-aware, so a read in flight across a trade writes the pre-trade valuation back for 60 s

1. **Severity:** MEDIUM
2. **Confidence:** high (executed, P3, with a `dedupe` control that does not reproduce)
3. **Location:** `frontend/src/lib/investments.ts:120-129` (`getPortfolioSummary`), `:132-141`, `:146-155`, `:163-177`, `:182-202`, `:227-234` (`investments:accounts`), `:286-293` (top movers), `:585-592` (favourites), `:912-929` (prices), `:935-942` (market indexes), `:1180-1222` (three weightings); `frontend/src/lib/budgets.ts:264-278` (`budgets:cat-status:*`); `lib/custom-reports.ts:30-36`, `lib/investment-reports.ts:64-70`.
4. **Violated invariant:** INV-CACHE-001; the `apiCache.ts:10-17` contract ("a read that began before a mutation could be re-served after it ... issue #1167 close-out").
5. **Reproduction:** Investments page mounts; `GET /portfolio/summary` (seconds of server work) is in flight and reads the ledger before the trade commits. The user saves a BUY of 20 000.00 from the trade form. `invalidateBalanceCaches()` runs; the page's refetch goes out and returns first; the original read lands afterwards.
6. **Observed (P3):** the late response executes `setCache('investments:summary:all', <pre-trade>, 60_000)`; the next `getPortfolioSummary()` (any remount, the dashboard widget) returns the pre-trade summary. The same race through `dedupe` (`budgets:dashboard`, control case) keeps the fresh payload.
7. **Expected:** a response whose key was invalidated after its request started is returned to its own caller but never written to the cache.
8. **Impact:** the portfolio total, cash and holdings show the pre-trade state (here 20 000.00 of cash still present, the new position absent) for up to 60 s on every surface that reads the key, including after navigation; the per-category budget status behind the transaction form for 60 s.
9. **Root cause:** the #1167 fix moved only `dedupe` onto the generation counter; sixteen read sites (13 in `investments.ts`, one each in `budgets.ts`, `custom-reports.ts`, `investment-reports.ts`) still call `getCached`/`setCache` directly, which knows nothing about `invalidateCache`'s generation bump.
10. **Recommended correction:** route every cached read through `dedupe` (it already handles TTL, in-flight sharing and the generation); keep `getCached`/`setCache` for the two optimistic list rewrites (`custom-reports.ts:75-80`, `investment-reports.ts:110-116`) only.
11. **Suggested remediation diff (illustrative, not applied)**

```diff
--- a/frontend/src/lib/investments.ts
+++ b/frontend/src/lib/investments.ts
@@ -120,10 +120,12 @@
   getPortfolioSummary: async (accountIds?: string[]): Promise<PortfolioSummary> => {
     const cacheKey = `investments:summary:${accountIds?.join(',') || 'all'}`;
-    const cached = getCached<PortfolioSummary>(cacheKey);
-    if (cached) return cached;
-    const response = await apiClient.get<PortfolioSummary>('/portfolio/summary', {
-      params: accountIds && accountIds.length > 0 ? { accountIds: accountIds.join(',') } : undefined,
-    });
-    setCache(cacheKey, response.data, 60_000);
-    return response.data;
+    return dedupe(cacheKey, async () => {
+      const response = await apiClient.get<PortfolioSummary>('/portfolio/summary', {
+        params: accountIds && accountIds.length > 0 ? { accountIds: accountIds.join(',') } : undefined,
+      });
+      return response.data;
+    }, 60_000);
   },
```

   (the same shape for each listed site; `budgets.ts:264` becomes `dedupe(cacheKey, () => apiClient.post(...).then(r => r.data), 60_000)`).
12. **Recommended regression test:** a source scan in `cache-prefix-classification.guard.test.ts` that fails a `setCache(` outside `apiCache.ts` and the two list-rewrite sites, plus one behavioural case per family.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
--- a/frontend/src/lib/investments.test.ts
+++ b/frontend/src/lib/investments.test.ts
+  it('a summary read in flight across a trade does not resurrect the pre-trade payload', async () => {
+    let resolveOld!: (v: unknown) => void;
+    vi.mocked(apiClient.get).mockImplementationOnce(() => new Promise((r) => { resolveOld = r; }));
+    const old = investmentsApi.getPortfolioSummary();
+    vi.mocked(apiClient.post).mockResolvedValueOnce({ data: {} });
+    await investmentsApi.createTransaction({} as never);
+    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: { totalPortfolioValue: 120 } });
+    await investmentsApi.getPortfolioSummary();
+    resolveOld({ data: { totalPortfolioValue: 100 } });
+    await old;
+    expect(getCached('investments:summary:all')).toEqual({ totalPortfolioValue: 120 });
+  });
```

14. **Verification:** `npm run test -- investments budgets apiCache cache-prefix`.
15. **Residual risks:** `dedupe` shares one promise between callers, so a caller that mutates the returned object would now mutate a shared one (none found in the readers sampled). Causality: `PRE_EXISTING_UNREPORTED` (the hand-rolled sites predate the #1167 generation fix, which covered `dedupe` only).

#### A26-S18-03 (merged surface) - Valuation inputs that are not ledger rows invalidate nothing derived: a manual price, a security's currency, the reporting currency

1. **Severity:** MEDIUM
2. **Confidence:** high (executed, P4 and P5)
3. **Location:** `frontend/src/lib/investments.ts:1160-1177` (manual price create/update/delete drop only `investments:prices:`); `:652-670` (`updateSecurity` drops only `scheduled:` unless a bond program changes); `frontend/src/lib/user-settings.ts:40-43` and `components/settings/PreferencesSection.tsx:135-150` (`defaultCurrency` change, no cache drop); renderer `components/investments/PortfolioSummaryCard.tsx:43-80` (formats backend totals with the preference `defaultCurrency`; `PortfolioSummary` carries no currency code, `types/investment.ts:304-382`).
4. **Violated invariant:** INV-CACHE-001; `AGENTS.md` "a total names its currency"; Calibration Rule 5 (every channel that changes an upstream dependency of a cached derived value invalidates it).
5. **Reproduction:** (a) on a security page, enter a manual close of 200.00 for a holding of 500 shares last priced 100.00, then open Investments within 60 s; (b) change a security's currency from USD to EUR; (c) in Settings change the default currency USD -> CAD (USD->CAD 1.37), then open Investments within 60 s.
6. **Observed:** (a, P4) `investments:summary:all` survives the price write; the portfolio shows 50 000.00 for the holding instead of 100 000.00. (c, P5) the summary cached in USD survives the preference change and `PortfolioSummaryCard` renders `totalPortfolioValue` 100 000 as "CA$100,000.00".
7. **Expected:** (a) 100 000.00 after the write; (c) CA$137 000.00, or the figure withheld until the CAD payload arrives.
8. **Impact:** (a) 50 000.00 understated (50 %) for up to 60 s; (c) 37 000.00 understated (27 %) under the wrong currency label for up to 60 s on the summary, allocation, weightings, top movers and favourites, 30 s on the budget dashboard; `accounts:daily-balance-totals` keys `displayCurrency ?? ''`, so a caller that omits it is also served the old currency.
9. **Root cause:** the invalidation rule was written as "a write that moves money"; valuation also depends on prices, the security's currency and the reporting currency, and none of those writes is classified.
10. **Recommended correction:** a price write and a security currency edit drop `investments:` and `accounts:`; a preference write that changes `defaultCurrency` (or `timezone`, which moves "today") calls `clearAllCache()`.
11. **Suggested remediation diff (illustrative, not applied)**

```diff
--- a/frontend/src/lib/investments.ts
+++ b/frontend/src/lib/investments.ts
@@ -1160,19 +1160,22 @@
   createSecurityPrice: async (securityId: string, data: CreateSecurityPriceData): Promise<SecurityPrice> => {
     const response = await apiClient.post<SecurityPrice>(`/securities/${securityId}/prices`, data);
-    invalidateCache('investments:prices:');
+    // A stored close values every holding of the security.
+    invalidateBalanceCaches();
     return response.data;
   },
@@ (same for updateSecurityPrice and deleteSecurityPrice)
@@ -665,6 +668,8 @@
     invalidateScheduledFxReadModel();
+    // The security's currency decides how its holdings convert.
+    if (data.currencyCode !== undefined) invalidateBalanceCaches();
     if (data.bondProgramId !== undefined) invalidateCache('investments:');
--- a/frontend/src/lib/user-settings.ts
+++ b/frontend/src/lib/user-settings.ts
@@ -40,4 +40,8 @@
   updatePreferences: async (data: UpdatePreferencesData): Promise<UserPreferences> => {
     const response = await apiClient.patch<UserPreferences>('/users/preferences', data);
+    // Every cached figure is denominated in the reporting currency and dated by
+    // the reader's today; neither payload names which one it was computed for.
+    if (data.defaultCurrency !== undefined || data.timezone !== undefined) clearAllCache();
     return response.data;
   },
```

12. **Recommended regression test:** one lib case per channel asserting the summary key is dropped; a guard row classifying `/securities/:id/prices` as transaction-derived.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
--- a/frontend/src/lib/user-settings.test.ts
+++ b/frontend/src/lib/user-settings.test.ts
+  it('a reporting-currency change drops currency-denominated caches', async () => {
+    setCache('investments:summary:all', { totalPortfolioValue: 100000 });
+    vi.mocked(apiClient.patch).mockResolvedValue({ data: { defaultCurrency: 'CAD' } });
+    await userSettingsApi.updatePreferences({ defaultCurrency: 'CAD' });
+    expect(getCached('investments:summary:all')).toBeUndefined();
+  });
```

14. **Verification:** `npm run test -- investments user-settings PortfolioSummaryCard`.
15. **Residual risks:** the payloads still carry no currency code, so any other path that keeps one across a currency change repeats (c); the durable fix is a `currency` field on `PortfolioSummary` and an assertion in the card that it equals the rendered currency (maintainer decision). Causality: `PRE_EXISTING_UNREPORTED`.

#### A26-S18-07 (merged surface) - A finished MNY import drops only the balance caches; categories, payees, tags and schedules it created (or wiped) stay cached

1. **Severity:** LOW
2. **Confidence:** high (executed, P6)
3. **Location:** `frontend/src/lib/import-mny.ts:320-332` (`getJob` terminal state -> `invalidateBalanceCaches()` only); TTLs `categories.ts:26-34` and `payees.ts:88-95`, `tags.ts:13-20` (5 min), `scheduled-transactions.ts:30-37` (2 min). Compare `email-import/run-import.ts:308`, `transaction-rules-api.ts:144`, `backupApi.ts:499` (`clearAllCache()` for writes that touch anything).
4. **Violated invariant:** `docs/frontend/api-and-cache.md` "Where the write can touch anything ... use `clearAllCache()`".
5. **Reproduction:** with "wipe existing data", import a `.mny`; open a transaction form within five minutes.
6. **Observed (P6):** `categories:all` still holds the pre-import list; the pickers offer deleted category and payee ids and miss the imported ones; a save with a stale id is refused by the server.
7. **Expected:** the import's terminal state calls `clearAllCache()`.
8. **Impact:** confusing failures and missing choices for up to five minutes; no ledger corruption (the server refuses the stale ids).
9. **Root cause:** the MNY import writes every table, but its invalidation was modelled on the transaction-only importers.
10. **Recommended correction / 11. diff (illustrative, not applied):**

```diff
--- a/frontend/src/lib/import-mny.ts
+++ b/frontend/src/lib/import-mny.ts
@@ -328,5 +328,6 @@
     if (response.data.status === 'completed' || response.data.status === 'failed') {
-      invalidateBalanceCaches();
+      // Accounts, categories, payees, tags, securities and schedules are all written.
+      clearAllCache();
     }
```

12. **Regression test / 13. diff:** extend `import-mny.test.ts` with `setCache('categories:all', [...])` then a completed `getJob`, asserting the key is gone.
14. **Verification:** `npm run test -- import-mny useMnyImport`.
15. **Residual risks:** `clearAllCache()` on each poll of a terminal job repeats harmlessly. Causality: `PRE_EXISTING_UNREPORTED`.


### A26-M36 - The intraday portfolio series is cached in sessionStorage with no user or acting-context key and survives sign-out and context switches

- **Canonical severity:** MEDIUM. MEDIUM: S18 (LOW) and S20 (MEDIUM) found the same defect; S23 takes S20's rating because the delegate-context switch shows the owner's figures under the delegate's own session, not only on a shared device.
- **Absorbs:** A26-S20-04 (primary, 20-frontend-figures.md, session severity MEDIUM); A26-S18-08 (merged surface, 18-frontend-core.md, session severity LOW).
- **Invariants and prior findings named:** INV-SHARE-003.
- **Lens:** security.

#### A26-S20-04 (primary) - The intraday portfolio series is cached in sessionStorage under a key with no user and no acting context, and neither sign-out nor a context switch clears it, so the next user (or context) on the tab is drawn the previous one's portfolio

1. **Severity:** MEDIUM
2. **Confidence:** high (executed at unit level; hydration path read)
3. **Location:** `frontend/src/components/investments/portfolio-chart-utils.tsx:115-122` (`buildIntradayCacheKey(range, accountIds, currency)`), `:124-134` (`readIntradayCache`, no freshness check), `:147-160` (`clearAllIntradayCache`, called only on refresh in `InvestmentValueChart.tsx:407, 430`); readers `InvestmentValueChart.tsx:258-276` and `PortfolioValueReport.tsx:598-613` (hydrate before the network answers); `store/authStore.ts:97-114` (logout clears `apiCache`, two localStorage keys and the share inbox, not this); `components/layout/DelegationBanner.tsx:28-31` (context switch is a `window.location.reload()`, which keeps sessionStorage).
4. **Violated invariant:** a page never shows data fetched under another identity (the hint's delegated-session lens; `frontend/CLAUDE.md` "Asynchronous data belongs to the request that produced it"); the persisted-storage rule's intent (`store/persisted-storage.guard.test.ts` covers localStorage only).
5. **Reproduction:** user A opens Investments on 1D with all accounts in USD, signs out; user B signs in on the same tab and opens Investments on 1D, all accounts, USD. Or: a delegate acting as an owner opens 1D, then switches back to their own context.
6. **Observed (executed, probe P7):** after `useAuthStore.getState().logout()` the entry written for A is still returned for B's identical key (`expected { fetchedAt: ..., ... } to be null`). The chart sets A's points (`setLoadedPoints`) and drops the skeleton before B's request answers; it is replaced only when B's response arrives.
7. **Expected:** the cache keyed by the user and acting context, and cleared on sign-out and on a context switch.
8. **Impact:** another person's portfolio value series and its Highest / Lowest figures shown on a shared device for the length of an intraday request (which fetches every holding from the provider), and the owner's figures shown under the delegate's own context after a switch.
9. **Root cause:** the cache identity covers what the request names (range, accounts, currency) but not whose request it is (Rule 5: two dependencies of the payload, user and acting context, have no invalidation path).
10. **Recommended correction:** add the user id and `actingAsUserId` to the key and call `clearAllIntradayCache()` from `logout()` and before the context-switch reload.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/frontend/src/store/authStore.ts
+++ b/frontend/src/store/authStore.ts
       logout: () => {
         clearAllCache();
+        import('@/components/investments/portfolio-chart-utils').then(({ clearAllIntradayCache }) => clearAllIntradayCache());
--- a/frontend/src/components/layout/DelegationBanner.tsx
+++ b/frontend/src/components/layout/DelegationBanner.tsx
       await delegationApi.switchContext(targetUserId);
+      clearAllIntradayCache();
       window.location.reload();
--- a/frontend/src/components/investments/portfolio-chart-utils.tsx
+++ b/frontend/src/components/investments/portfolio-chart-utils.tsx
-export function buildIntradayCacheKey(range: string, accountIds: string[] | undefined, currency: string): string {
+export function buildIntradayCacheKey(range: string, accountIds: string[] | undefined, currency: string, identity: string): string {
   const accts = (accountIds ?? []).slice().sort().join(',');
-  return `${INTRADAY_CACHE_PREFIX}${range}|${accts}|${currency}`;
+  return `${INTRADAY_CACHE_PREFIX}${identity}|${range}|${accts}|${currency}`;
```

   (`identity` = `${user.id}:${actingAsUserId ?? 'self'}` from `useAuthStore`.) The logout import is dynamic to keep the store free of a component dependency; a `lib/` home for the cache helpers is the cleaner fix.
12. **Recommended regression test:** the probe below, plus a key test asserting two identities never share a key.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+// store/authStore.test.ts
+it('drops the intraday portfolio cache on logout', () => {
+  const key = buildIntradayCacheKey('1d', [], 'USD', 'user-a:self');
+  writeIntradayCache(key, { fetchedAt: Date.now(), points: [{ timestamp: '2026-10-21T14:30:00Z', value: 1, securitiesValue: 1 }], interval: '5m', currency: 'USD', fallbackToDaily: false, skippedSymbols: [], failedSymbols: [] });
+  useAuthStore.getState().logout();
+  expect(readIntradayCache(key)).toBeNull();
+});
```

14. **Verification:** `npm run test -- authStore portfolio-chart-utils InvestmentValueChart PortfolioValueReport DelegationBanner`; a two-user browser check on one tab.
15. **Residual risks:** other sessionStorage users (`stepUpToken`, `logout-state`, `whatsNewStore`) were not swept for identity; localStorage report settings that hold account ids are discussed in section 9 (D-S20-02).

Causality: `PRE_EXISTING_UNREPORTED` (not datable in the shallow clone).

#### A26-S18-08 (merged surface) - Logout leaves the intraday portfolio series in `sessionStorage`, keyed without a user, and the next account on the tab is shown it

1. **Severity:** LOW
2. **Confidence:** high (executed, P8)
3. **Location:** `frontend/src/components/investments/portfolio-chart-utils.tsx:97-160` (`monize-intraday|<range>|<accounts>|<currency>`, no user id); `InvestmentValueChart.tsx:262-280` (hydrates from the entry before the network answers); `frontend/src/store/authStore.ts:97-129` (`logout` clears the API cache, the share inbox, preferences, the AI chat and Monte Carlo keys, but not these); `store/persisted-storage.guard.test.ts` covers `localStorage` only.
4. **Violated invariant:** the logout sweep the store documents ("so conversations don't leak across accounts"); INV-SHARE-003's reasoning applied to the same device-sharing threat.
5. **Reproduction:** user A views Investments on 1D (all accounts, USD), signs out; user B signs in on the same tab and opens Investments on 1D.
6. **Observed (P8):** the entry survives `logout()`; B's chart is drawn from A's points (value 250 000 in the probe) until B's request answers, and stays if B's intraday request fails (the fallback loads B's daily series, which replaces it).
7. **Expected:** `logout` calls `clearAllIntradayCache()`; the key carries the user id.
8. **Impact:** another account's portfolio value series is displayed briefly on a shared device.
9. **Root cause:** the sweep in `logout` was written for `localStorage` keys; the `sessionStorage` cache was added later without a guard.
10. **Correction / 11. diff (illustrative, not applied):**

```diff
--- a/frontend/src/store/authStore.ts
+++ b/frontend/src/store/authStore.ts
@@ -108,6 +108,10 @@
         import('@/store/preferencesStore').then(({ usePreferencesStore }) => {
           usePreferencesStore.getState().clearPreferences();
         });
+        // SECURITY: the intraday chart cache is one account's portfolio series.
+        import('@/components/investments/portfolio-chart-utils').then(
+          ({ clearAllIntradayCache }) => clearAllIntradayCache(),
+        );
```

12. **Regression test / 13. diff:** in `authStore.test.ts`, write an `INTRADAY_CACHE_PREFIX` key, call `logout()`, await the dynamic import, assert it is gone; extend the persisted-storage guard to scan `sessionStorage.setItem` writers.
14. **Verification:** `npm run test -- authStore persisted-storage portfolio-chart-utils`.
15. **Residual risks:** `localStorage` filter state (account-id lists and the free-text search in `AccountList.tsx:282-316`, `useTransactionFilters.ts:631-636`) also survives logout; it holds ids and the user's own typed text, recorded as a design risk (section 9). Causality: `PRE_EXISTING_UNREPORTED`.


### A26-M37 - Four-decimal amounts are loaded and blurred at two decimals, so an unedited save re-amounts a row or is refused (MON-M37)

- **Canonical severity:** MEDIUM. kept MEDIUM.
- **Absorbs:** A26-S19-03 (primary, 19-frontend-forms.md, session severity MEDIUM).
- **Invariants and prior findings named:** MON-M37.
- **Lens:** frontend.

#### A26-S19-03 (primary) - Four-decimal amounts are loaded and blurred at two decimals, so an unedited save re-amounts a row or is refused (MON-M37)

1. **Severity:** MEDIUM
2. **Confidence:** high (executed: P2 and P3 component payloads, the `CurrencyInput` probe, and both backend probes)
3. **Location:** `frontend/src/components/ui/CurrencyInput.tsx:118-124` (parse rounds to cents), `:190-193` (`notifyIfChanged` compares the 2dp parse with the 4dp value), `:209-239` (blur); loaders: `TransactionForm.tsx:341-343`, `AccountForm.tsx:411-415` (`openingBalance`, always sent on edit; also `creditLimit`, `paymentAmount`, `originalPrincipal`), `OverrideEditorDialog.tsx:203, 223`, `ScheduledTransactionForm.tsx:271-273, 292-294`; the split check `TransactionForm.tsx:1309-1318` (cents) against `backend/src/common/split-amount.util.ts:43-54` (exact 4dp).
4. **Violated invariant:** an unchanged value re-sent by the client is not a change (AGENTS.md); money is `decimal(20,4)` and the server rounds with `roundMoney`.
5. **Reproduction:** four-decimal rows are written by the server itself: `applyFxConversion` (`fx-entry.util.ts:126-137`; a foreign entry through an import, the assistant or MCP), the implied destination of a cross-currency transfer (`roundMoney(amount * rate)`), investment cash legs. (a) A -3.3333 expense opened and saved with a description edit; (b) a -12.3457 split parent with lines -6.1728 and -6.1729 saved unedited; (c) a tab through any `CurrencyInput` holding -3.3333.
6. **Observed (executed):** (a) payload `amount: -3.33`; on PostgreSQL the balance moves 96.6667 -> 96.67 and the row becomes -3.3300. (b) payload parent `-12.35`, lines `[-6.1728, -6.1729]`; the server refuses with "Split amounts (-12.3457) must equal transaction amount (-12.35)", so the row cannot be saved from the form at all. (c) `onChange(-3.33)` fires on a bare focus and blur.
7. **Expected:** an untouched field reports nothing; the loaded value keeps its stored precision until the user types.
8. **Impact:** sub-cent balance drift on every cosmetic edit (+0.0033 in the example; a reconciled row is re-amounted with no confirmation because `reconciledEditAffectsReconciliation` compares cents), a split row that cannot be edited at all (workflow failure), and the same rounding on account opening balances and schedule templates. The per-row money is small; the refusal is the material part.
9. **Root cause:** the forms round at load, and `CurrencyInput` treats "the text on screen parses to the held value" as the no-edit test, which is false whenever the held value has more precision than the display; the client split check tolerates a cent the server does not.
10. **Recommended correction:** keep the stored value on load (no `Math.round` in the defaults) and make `notifyIfChanged` treat a 2dp parse equal to the held value at display precision as no edit; compare split sums at 4dp on the client.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/frontend/src/components/ui/CurrencyInput.tsx
+++ b/frontend/src/components/ui/CurrencyInput.tsx
@@ -190,5 +190,11 @@
     const notifyIfChanged = (next: number | undefined) => {
       if (next === value) return;
+      // The field shows two decimals; a stored 4dp value (-3.3333) re-parses
+      // as its display (-3.33). That is the same field untouched, not an edit.
+      if (next !== undefined && value !== undefined && roundToCents(value) === next) return;
       onChange(next);
     };
--- a/frontend/src/components/transactions/TransactionForm.tsx
+++ b/frontend/src/components/transactions/TransactionForm.tsx
@@ -341,3 +341,3 @@
           amount: initSource.isTransfer
             ? Math.abs(Math.round(Number(initSource.amount) * 100) / 100)
-            : Math.round(Number(initSource.amount) * 100) / 100,
+            : Number(initSource.amount),
@@ -1310,4 +1310,4 @@
         const splitsTotal = splitsData.reduce((sum, s) => sum + s.amount, 0);
-        const roundedSplitsTotal = Math.round(splitsTotal * 100) / 100;
-        const roundedAmount = Math.round(data.amount * 100) / 100;
+        const roundedSplitsTotal = roundMoney(splitsTotal);
+        const roundedAmount = roundMoney(data.amount);
```

(the same load change applies to the `AccountForm`, override editor and schedule form loaders; the transfer default is A26-S19-01's diff).

12. **Recommended regression test:** `CurrencyInput` with `value={-3.3333}` focused and blurred reports nothing; `TransactionForm` reopening -3.3333 sends -3.3333; a -12.3457 split parent saves unedited.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
--- a/frontend/src/components/ui/CurrencyInput.test.tsx
+++ b/frontend/src/components/ui/CurrencyInput.test.tsx
@@ -171,4 +171,13 @@
     });
+
+    it('stays silent when a four-decimal value is blurred untouched', () => {
+      const onChange = vi.fn();
+      render(<CurrencyInput label="Total" value={-3.3333} onChange={onChange} />);
+      const input = screen.getByLabelText('Total');
+      fireEvent.focus(input);
+      fireEvent.blur(input);
+      expect(onChange).not.toHaveBeenCalled();
+    });
```

14. **Verification method:** the tests above fail at the baseline (probe: `onChange(-3.33)`); the backend probes re-run with the corrected payloads leave the balance at 96.6667 and accept the split save.
15. **Residual risks:** the guard drops a user's deliberate entry of the rounded figure over a 4dp value (typing -3.33 over -3.3333). Currencies with three decimals (KWD, BHD) still display two; currency-aware precision is the full remedy the upstream report asked for. Causality: `PRIOR_REPORTED` MON-M37, `CONFIRMED_WITH_DIFFERENT_ROOT_CAUSE` (the loss is in load and blur, not in the split editor's redistribution; the tolerance conflict is client cents against server exact). Rule 7 surfaces: transaction, split parent, account opening balance, override editor, schedule form.


### A26-M38 - Portfolio gain is the priced market value less the cost of every holding, so an unpriced holding reads as a loss of its whole cost

- **Canonical severity:** MEDIUM. kept MEDIUM; quoted by the AI and MCP portfolio tools (S20 hand-off).
- **Absorbs:** A26-S20-02 (primary, 20-frontend-figures.md, session severity MEDIUM).
- **Invariants and prior findings named:** none in the index (see field 4 of each member).
- **Lens:** financial.

#### A26-S20-02 (primary) - Portfolio gain is the priced market value less the cost of every holding, so an unpriced holding reads as a loss of its whole cost; the Investment Performance report and the Portfolio Value account breakdown print it unflagged

1. **Severity:** MEDIUM
2. **Confidence:** high (frontend executed; server arithmetic read line by line)
3. **Location:** server `backend/src/securities/portfolio-calculation.service.ts:1976-1995` (cost added for every holding, including `marketValue === null`) versus `:2018-2025` (market value added only when priced); summary `backend/src/securities/portfolio.service.ts:902-909` (`totalGainLoss = totalHoldingsValue - totalCostBasis`); per account `portfolio-calculation.service.ts:2140-2193` (same asymmetry). Consumers: `frontend/src/components/reports/InvestmentPerformanceReport.tsx:172-195` (single-account branch recomputes the same difference client side), `:305-309` (PDF), `:380-390` (cards); `PortfolioValueReport.tsx:1045, 1783` (account gain, CSV and table). `GroupedHoldingsList.tsx:274, 292` marks the account but still prints the gain beside the mark.
4. **Violated invariant:** AGENTS "A subtotal is not a total ... a field named `gain` carries a value only when every component is known"; a gain is market value less the cost OF THE SAME holdings.
5. **Reproduction:** holding A priced, market value 100,000, cost 80,000; holding B with no price, cost 50,000. Open Reports -> Investment Performance.
6. **Observed (executed, probe P5):** "Total Gain/Loss -$30,000.00", "Return -23.08%", no marker (`{ gainShown: true, marked: false }`).
7. **Expected:** the gain withheld (unknown) or reported over the priced holdings only (+20,000, +25 percent) under a caption that says so; never -30,000.
8. **Impact:** a fabricated loss equal to the unpriced holdings' cost: 50,000 of swing on the example (-30,000 shown, +20,000 on the known part), a -23.1 percent "Return" against +25 percent. A reader sees a loss the portfolio has not made.
9. **Root cause:** the two `FxAggregate`s (cost and value) skip different components: the value aggregate skips an unpriced holding, the cost aggregate does not, so their difference is not a subtotal of anything.
10. **Recommended correction:** on the server, add a holding's cost to the gain's cost basis only when its market value joined the value total (keep the full cost under `totalCostBasis` for the basis card), or return `totalGainLoss: null` when `valuationComplete` is false (maintainer decision); on the client, read `valuationComplete === false` before printing gain, return and cost-derived figures.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/securities/portfolio-calculation.service.ts
+++ b/backend/src/securities/portfolio-calculation.service.ts
@@ (calculateHoldingsWithValues, per holding)
+      const pricedCost = marketValue === null ? null : costBasisAccountCurrency;
       if (marketValue !== null) {
         holdingsValueTotal.add(...);
+        pricedCostTotal.add(await this.convertToDefault(pricedCost, accountCurrency, defaultCurrency, rateCache), accountCurrency, defaultCurrency);
       }
@@ return
+      totalCostBasisOfPriced: pricedCostTotal.knownSubtotal,
--- a/backend/src/securities/portfolio.service.ts
+++ b/backend/src/securities/portfolio.service.ts
-    const totalGainLoss =
-      holdingsResult.totalHoldingsValue - holdingsResult.totalCostBasis;
+    const totalGainLoss =
+      holdingsResult.totalHoldingsValue - holdingsResult.totalCostBasisOfPriced;
--- a/frontend/src/components/reports/InvestmentPerformanceReport.tsx
+++ b/frontend/src/components/reports/InvestmentPerformanceReport.tsx
@@
-          {summaryValues.totalGainLoss >= 0 ? '+' : ''}{fmtSummary(summaryValues.totalGainLoss)}
+          {portfolio?.valuationComplete === false
+            ? <UnknownAmount reason="noPrice" />
+            : <>{summaryValues.totalGainLoss >= 0 ? '+' : ''}{fmtSummary(summaryValues.totalGainLoss)}</>}
```

   The same change in `buildHoldingsByAccount` (`:2140-2193`) and in the single-account branch (`InvestmentPerformanceReport.tsx:174-188`, which should read the server's per-account gain rather than recompute it). Needs verification: the AI/MCP portfolio tools that quote `totalGainLoss` (S17's surface) and the backend specs at `portfolio.service.spec.ts:1237-1256`.
12. **Recommended regression test:** a backend unit case with one priced and one unpriced holding asserting the gain is over the priced holding (or null), and the frontend probe below.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+// InvestmentPerformanceReport.test.tsx
+it('does not print the gain/return as complete when valuationComplete is false', async () => {
+  mockGetPortfolioSummary.mockResolvedValue({ ...fullPortfolio, holdingsByAccount: [],
+    totalPortfolioValue: 100000, totalCostBasis: 130000, totalGainLoss: -30000, totalGainLossPercent: -23.076923,
+    pricesComplete: false, fxComplete: true, valuationComplete: false, unpricedSecurityIds: ['sec-x'], missingRatePairs: [] });
+  mockGetInvestmentAccounts.mockResolvedValue([]);
+  render(<InvestmentPerformanceReport />);
+  await waitFor(() => expect(screen.getByText('Total Value')).toBeInTheDocument());
+  expect(document.body.textContent).not.toMatch(/-\$?30,?000/);
+});
```

14. **Verification:** backend `npm run test:unit -- portfolio-calculation portfolio.service`; frontend `npm run test -- InvestmentPerformanceReport PortfolioValueReport GroupedHoldingsList`.
15. **Residual risks:** the same asymmetry applies when a holding's market value has no rate but its historical cost does (the two aggregates use different pairs); not executed separately.

Causality: `PRE_EXISTING_UNREPORTED` (not in the upstream report or S02/S12/S13; the shallow clone cannot date it).


### A26-M39 - A failed or pending request is shown as data: reports keep the previous window through a failed reload, the country view and the dashboard render a failure as empty or zero

- **Canonical severity:** MEDIUM. MEDIUM for the group; A26-S20-05 and -08 (LOW) are the same failure-as-data rule on two more surfaces and are absorbed.
- **Absorbs:** A26-S20-03 (primary, 20-frontend-figures.md, session severity MEDIUM); A26-S20-05 (merged surface, 20-frontend-figures.md, session severity LOW); A26-S20-08 (merged surface, 20-frontend-figures.md, session severity LOW).
- **Invariants and prior findings named:** INV-REPORT-002.
- **Lens:** frontend.

#### A26-S20-03 (primary) - A report keeps the previous request's answer through a failed or pending reload, so its cards (Sankey) and its exports present the old window under the new one

1. **Severity:** MEDIUM
2. **Confidence:** high (Sankey executed; the other reports read)
3. **Location:** `frontend/src/hooks/useReportData.ts:207-216` (a failure keeps `data`, by design for `dataKey`); consumers that render the toolbar during an error and gate the export on the data being non-empty: `CashFlowSankeyReport.tsx:130, 299, 304-315` (cards shown from `response` above the error), `NetWorthReport.tsx:398-402`, `SpendingByCategoryReport.tsx:296-299`, `IncomeBySourceReport.tsx:270-273`, `SpendingByPayeeReport.tsx:171-174`, `MonthlyCategoryBreakdownReport.tsx:1294`, `CashFlowReport.tsx:284` (no gate; A26-S16-04), `SecurityPerformanceReport.tsx:680-683`. Not affected: reports that return early on `error` or `isLoading` (Debt Payoff Timeline `:636-640`, Budget reports `BudgetVsActualReport.tsx:320-324` and siblings, Geographic `:497`).
4. **Violated invariant:** `frontend/CLAUDE.md` "Asynchronous data belongs to the request that produced it ... never render a failed lookup as" a result; INV-REPORT-002 (an export carries the screen's figure).
5. **Reproduction:** open Cash Flow Sankey (month to date), let it load; switch to Subcategories (or another range) while the server fails the request.
6. **Observed (executed, probe P6):** the five cards still show the previous request's totals above the error panel, and the PDF and CSV buttons stay enabled over the previous answer (`{ staleCard: true, exportEnabled: true }`). On Spending by Category, Income by Source and Spending by Payee the PDF has no subtitle naming the period, so an export taken after a range change carries the previous range unlabelled.
7. **Expected:** cards and exports only for the data whose request key matches the current selection; the export disabled while loading or failed.
8. **Impact:** a document leaves the application with the figures of a different window or depth from the one selected; on Sankey the screen itself shows the old totals under the new selection.
9. **Root cause:** `useReportData` deliberately keeps the last payload and exposes `dataKey`, but these consumers gate on `data` (or its length) instead of `dataKey === requestKey && !error && !isLoading`.
10. **Recommended correction:** a `dataUnavailable = isLoading || !!error` gate on every inside-tree report's `ReportToolbarActions` and on Sankey's cards (the pattern `NetWorthReport.tsx:316` already defines for its cards and then does not apply to its toolbar).
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/frontend/src/components/reports/CashFlowSankeyReport.tsx
+++ b/frontend/src/components/reports/CashFlowSankeyReport.tsx
-  const data = response && response.nodes.length > 0 ? response : null;
+  // The previous answer is not this selection's answer while the new request
+  // is pending or failed.
+  const data = !isLoading && !error && response && response.nodes.length > 0 ? response : null;
--- a/frontend/src/components/reports/NetWorthReport.tsx
+++ b/frontend/src/components/reports/NetWorthReport.tsx
-            disabled={chartData.length === 0}
+            disabled={dataUnavailable || chartData.length === 0}
```

   and the same `disabled` in the five other reports listed. Needs: the Sankey drill-down (`open`) and the legend read `data` too; verify a background refresh does not blank the diagram if that is wanted (a maintainer choice between hiding and dimming).
12. **Recommended regression test:** per report, load once, fail the second request, assert the export is disabled (and on Sankey that no card renders).
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+// CashFlowSankeyReport.test.tsx
+it('does not keep the previous answer on screen, or exportable, when the new request fails', async () => {
+  await renderReport();
+  mockGetSankey.mockRejectedValue(new Error('500'));
+  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Subcategories' })); });
+  await waitFor(() => expect(mockGetSankey).toHaveBeenLastCalledWith(expect.objectContaining({ depth: 2 })));
+  expect(screen.queryByTestId('sankey-card-income')).not.toBeInTheDocument();
+  expect(screen.getByTestId('export-pdf')).toBeDisabled();
+});
```

14. **Verification:** `npm run test -- CashFlowSankeyReport NetWorthReport SpendingByCategoryReport IncomeBySourceReport SpendingByPayeeReport MonthlyCategoryBreakdownReport SecurityPerformanceReport`.
15. **Residual risks:** the request-by-request trace covered the 49 `ReportToolbarActions` call sites by their gating expression and the multi-request reports named by S16; reports that early-return were not exercised for a failure of a secondary request (Geographic's country request is A26-S20-05).

Causality: `PRE_EXISTING_UNREPORTED` (extends the export-on-error pattern of A26-S16-04 and A26-S15-08, which name the first-load case only). Mutation M8 (export gate removed, undetected) shows the gate is untested.

#### A26-S20-05 (merged surface) - Geographic Allocation's country view renders a failed country request as an empty table totalling 0, and its PDF prints a different aggregate under the screen card's caption

1. **Severity:** LOW
2. **Confidence:** high (read)
3. **Location:** `frontend/src/components/reports/GeographicAllocationReport.tsx:267-273` (country request, error not destructured), `:345-365` (`if (!countryResp) return []`, `countryResp?.totalPortfolioValue ?? 0`), `:780-812` (footer "Total" with the server look-through total and "100%"), `:416-424` (PDF card "Total Portfolio" = `countryTotalValue`, while the screen card `:583-597` prints the client `totalValue` under the same caption).
4. **Violated invariant:** "never render a failed lookup as an empty result ... a total of zero"; "never `?? 0` on an API value"; one caption, one figure.
5. **Reproduction:** open Geographic Allocation, choose By country; the country request fails (or is slow) while the summary succeeds.
6. **Observed:** no error, an empty country table with a footer "Total 0.00 / 100%"; the PDF exports "Total Portfolio 0.00". When both succeed the PDF's "Total Portfolio" is the look-through total, not the figure the screen card shows (the code's own comment at `:788-806` records that this aggregate has no completeness).
7. **Expected:** the country view in its error state with a retry; the PDF card the same figure and marker as the screen card, or captioned as the look-through total.
8. **Impact:** a zero portfolio in the country view and its PDF; two different "Total Portfolio" figures for one report.
9. **Root cause:** the secondary request was added without an error branch; the PDF took the view's own aggregate.
10. **Recommended correction:** destructure `error` and `isLoading` from the country request and render `ReportError` in the country view; `countryTotalValue: number | null`; caption the PDF card from the view.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
-  const { data: countryResp, reload: reloadCountry } = useReportData(
+  const { data: countryResp, error: countryError, reload: reloadCountry } = useReportData(
@@
-  const countryTotalValue = countryResp?.totalPortfolioValue ?? 0;
+  const countryTotalValue = countryResp ? countryResp.totalPortfolioValue : null;
@@
-      {viewType === 'country' ? (
+      {viewType === 'country' && countryError ? (
+        <ReportError onRetry={reloadCountry} />
+      ) : viewType === 'country' ? (
```

12-13. **Regression test:** reject `getCountryWeightings` with the summary resolved, select By country, assert the error and no "0.00" total; mutation M6 (the card's partial marker removed, undetected) is the same file's missing test.
14. **Verification:** `npm run test -- GeographicAllocationReport`.
15. **Residual risks:** the look-through aggregate's own completeness is a backend gap (`sector-weighting.service.ts`), handed to S23 (section 12.6).

Causality: `PRE_EXISTING_UNREPORTED`.

#### A26-S20-08 (merged surface) - The dashboard turns a failed net-worth request into "No net worth data available yet"

1. **Severity:** LOW
2. **Confidence:** high (read)
3. **Location:** `frontend/src/app/dashboard/page.tsx:159` (`netWorthApi.getMonthly(...).catch(() => [] as MonthlyNetWorth[])`), rendered by `components/dashboard/AssetsVsLiabilities.tsx:103-104` with `assetsVsLiabilities.empty`.
4. **Violated invariant:** "never render a failed lookup as an empty result".
5-8. **Observed / expected / impact:** a 500 from `/net-worth/monthly` shows the empty-state copy instead of a failure the reader can retry; the sibling `NetWorthChart` fetches for itself and does show `netWorth.loadFailed`, so the two widgets disagree on one outage.
9-11. **Root cause / correction / diff (illustrative):** carry `netWorthError` from the page into the widget context and render the same `loadFailed` message: `.catch((e) => { setNetWorthError(true); return [] })` and `ctx.netWorthError ? <WidgetMessage>{t('netWorth.loadFailed')}</WidgetMessage> : ...`.
12-15. **Test / verification / residual:** reject `getMonthly` in the dashboard page test and assert no empty-state copy; `npm run test -- dashboard/page AssetsVsLiabilities`.

Causality: `PRE_EXISTING_UNREPORTED`.


### A26-M40 - The production image is never exercised: no CI gate boots the published target, and both documented Compose deployments mount backup and attachment directories the backend user cannot write

- **Canonical severity:** MEDIUM. kept MEDIUM (S21's rating confirmed): the Compose failure is reported by `describeStore`, not silent, and a boot failure of `:latest` is an availability risk caught at the first pull, not data loss.
- **Absorbs:** A26-S21-01 (primary, 21-tests-ci-release.md, session severity MEDIUM); A26-S21-03 (merged surface, 21-tests-ci-release.md, session severity MEDIUM).
- **Invariants and prior findings named:** INV-RELEASE-001, MON-M01.
- **Lens:** ci.

#### A26-S21-01 (primary) - No CI gate boots the published images: every job that runs the application builds the `development` target

1. **Severity:** MEDIUM
2. **Confidence:** high
3. **Location:** `docker-compose.e2e.yml:67-71`, `:164-172` (`target: development`, `NODE_ENV: development`); `.github/workflows/ci.yml:1501-1510` (E2E), `lighthouse.yml` (same compose file); published targets `ci.yml:1004`, `:1369`; `backend/Dockerfile:1-23` (dev stage: full `npm ci`, `npm run start:dev`, root user) versus `:58-125` (production: `npm ci --omit=dev --libc=musl`, `dist/`, `docker-entrypoint.sh`, user `nestjs` 1001); `frontend/Dockerfile:1-19` versus `:35-93` (`next dev` versus the standalone `server.js`).
4. **Violated invariant:** S21-I7, and the purpose of INV-RELEASE-001: a release gate's result is evidence about the artifact it ships, not only about the source revision.
5. **Reproduction scenario:** a change makes the production artifact fail while the development one works. Concrete, reachable classes: (a) a runtime `import` of a package listed only in `devDependencies` (no lint rule forbids it: `backend/eslint.config.mjs` has no `import/no-extraneous-dependencies`); (b) a file the production stage forgets to copy (`backend/Dockerfile:93-110` copies `dist`, `schema.sql`, `migrations`, `release-notes`, the entrypoint, and nothing else); (c) a write to a path the non-root user 1001 cannot write (A26-S21-03 is a live instance: the E2E backend runs as root and never sees it); (d) a `NODE_ENV === "production"` branch (7 backend source files) or the production CSP without `'unsafe-eval'` (`frontend/src/proxy.ts:67`); (e) the `db-init` / `db-migrate` / `main` sequence of `backend/docker-entrypoint.sh`, which the development image replaces with `nest start --watch`. Every one of these passes `backend-unit-tests`, `backend-integration-tests` (no image), `frontend-unit-tests`, `e2e-tests` (development image) and `helm-chart` (render only), and `build-and-push` then pushes, signs and tags the broken image as `:latest` and `:X.Y.Z`; `build-preview` pushes it as `:beta` on every merge.
6. **Observed:** the only workflow that builds a production target and starts it is `zap.yml` (scheduled nightly, frontend only, `fail_action: false`, not in any `needs:`). No job runs `docker-entrypoint.sh` or `node dist/main.js`.
7. **Expected:** at least one gate in the `needs:` of `prepare-release` and `prepare-preview` builds the `production` targets the publish jobs build and boots them to `/api/v1/health/ready` (backend, after `db-init` and `db-migrate`) and to a page load (frontend standalone server), as the non-root user.
8. **Impact:** availability of every installation that pulls `:latest` (the README's production Compose file pins `:latest`, `docker-compose.prod.yml:23`, `:120`): a boot failure ships signed, attested and Trivy-scanned. Also hides security behaviour that exists only in production mode (CSP, `Secure` cookies).
9. **Root cause:** the E2E stack was built for developer speed (hot reload) and reused as the release gate; `docs/release-integrity.md` section 2 defines "one revision" by commit SHA only, so the artifact gap is not named anywhere.
10. **Recommended correction:** run the E2E stack (or at least a boot smoke) from the `production` targets in CI, and keep the development targets for local use.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ jobs:
+  image-boot-smoke:
+    name: Production image boot
+    runs-on: ubuntu-latest
+    steps:
+      - uses: actions/checkout@9f698171ed81b15d1823a05fc7211befd50c8ae0 # v6.0.3
+        with:
+          persist-credentials: false
+      - name: Build the published targets
+        run: |
+          docker build --target production -f backend/Dockerfile -t monize-backend:smoke .
+          docker build --target production -f frontend/Dockerfile -t monize-frontend:smoke frontend
+      - name: Boot them as published
+        run: docker compose -f docker-compose.e2e.yml -f docker-compose.smoke.yml up -d --wait --wait-timeout 600
@@ prepare-release:
-        helm-chart,
+        helm-chart,
+        image-boot-smoke,
       ]
@@ prepare-preview:
-        helm-chart,
+        helm-chart,
+        image-boot-smoke,
       ]
```

    with a `docker-compose.smoke.yml` overlay setting `image: monize-backend:smoke` / `monize-frontend:smoke`, `NODE_ENV: production` and a named volume at `/data/backups`. Maintainer decision: run the whole E2E suite on production images (stronger, slower) or keep a boot smoke beside the development-image E2E.
12. **Recommended regression test:** the smoke job itself; plus a guard that every image the publish jobs build (`target: production`) is also built by a job in their `needs:`.
13. **Suggested regression-test diff:** a case in `backend/src/common/ci-images.guard.spec.ts` (it already reads the workflow and compose text) asserting that the set of `target:` values pushed by `build-and-push` / `build-preview` is a subset of the targets built by a gate listed in `needs:`.
14. **Verification method:** mutation: add `import "supertest";` to `backend/src/main.ts` (a devDependency) and confirm the new job fails while the other gates stay green.
15. **Residual risks:** a boot smoke does not exercise the production paths of individual features; only running E2E on the production images does. The workflow change itself is under `.github/` and needs maintainer agreement (`AGENTS.md`).

Causality: `PRE_EXISTING_UNREPORTED` (the upstream audit lists "E2E development targets" in its tool table, `docs/audits/2026-08-upstream/07-tests-ci.md:478`, without a finding). Execution evidence: the trace above at the baseline SHA (every `target:` in every compose file and workflow listed in section 12); the bind-mount probe of A26-S21-03 shows one concrete production-only failure the development image hides. The devDependency mutation was not built into an image in this session (needs a production image build through the proxy).

#### A26-S21-03 (merged surface) - Both documented Compose deployments mount `/data/backups` (and `/data/attachments`) root-owned, so the backend's user 1001 cannot write them (MON-M01 still open, narrowed)

1. **Severity:** MEDIUM
2. **Confidence:** high (executed)
3. **Location:** `docker-compose.prod.yml:103-108` (bind mounts `./monize/backups`, `./monize/attachments`); `docker-compose.ha.yml:159-163`, `:229-237` (named volume `backups`, `BACKUP_SHARED_VOLUME: "true"` at `:112`); `backend/Dockerfile:111-115` (`adduser -S nestjs -u 1001`, no `/data` directory, no `chown` of it); `README.md:645-658` (production steps: copy `.env`, `up -d`; no directory or ownership step), `README.md:634` (`BACKUP_HOST_DIR` default `./monize/backups`).
4. **Violated invariant:** S21-I6: a documented default deployment provides a writable durable mount for the features it enables, or the documentation says what the operator must do.
5. **Reproduction scenario:** on a Linux Docker Engine host, follow `README.md` "Docker Compose (Production)". Docker creates the missing bind source `./monize/backups` as `root:root 0755`; the backend runs as uid 1001; every write under `/data/backups` fails with `EACCES`. Same for the HA stack's named volume, which Docker creates root-owned because the image has no `/data/backups` to copy ownership from.
6. **Observed (executed):** `docker run -u 1001:1001 -v <new dir>/monize/backups:/data/backups node:24-alpine touch /data/backups/probe` -> `drwxr-xr-x root root /data/backups`, `Permission denied`; the same with a fresh named volume -> `Permission denied`. The Helm chart does not have this defect: it sets `fsGroup: 100` with `runAsGroup: 100` on an opt-in claim (`helm/templates/deployment-backend.yaml:230`, rendered with `backend.persistence.backups.enabled=true` in this session).
7. **Expected:** the image creates `/data/backups` and `/data/attachments` owned by 1001 (so a named volume inherits it), and the README tells bind-mount users to create the host directory owned by uid 1001 (or the compose file sets `user:` to match the host).
8. **Impact:** automatic backups (and `ATTACHMENT_STORAGE_PROVIDER=local`) do not work on either documented Compose deployment; S06 established that the service reports the store as unavailable with a reason (`describeStore`), so the failure is visible, not silent -- which is why this is MEDIUM, not HIGH. On the HA stack the operator has asserted `BACKUP_SHARED_VOLUME=true`, so the boot check passes and the feature is unavailable at the point of use. The E2E cluster shard cannot see it: its development image runs as root (A26-S21-01).
9. **Root cause:** the production image switched to a non-root user without creating the data directories it expects mounts on; the Compose files and README were not updated to match.
10. **Recommended correction:** create and own the mount points in the image; document the bind-mount ownership.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/Dockerfile
+++ b/backend/Dockerfile
@@ RUN addgroup -g 1001 -S nodejs && \
     adduser -S nestjs -u 1001 && \
+    mkdir -p /data/backups /data/attachments && \
+    chown -R nestjs:nodejs /data && \
     chmod +x ./docker-entrypoint.sh && \
--- a/README.md
+++ b/README.md
@@ ### Docker Compose (Production)
+2. Create the host folders the backend writes to, owned by the container user (uid 1001):
+```bash
+mkdir -p monize/backups monize/attachments && sudo chown -R 1001:1001 monize
+```
```

12. **Recommended regression test:** a production-image boot smoke (A26-S21-01) that mounts a fresh named volume at `/data/backups` and asserts the backup store reports `available: true`.
13. **Suggested regression-test diff:** in the smoke overlay of A26-S21-01, `volumes: [smoke_backups:/data/backups]` and a step `curl -fsS .../api/v1/...` against the store status (endpoint name to be taken from `backend/src/backup/auto-backup.controller.ts`; not verified here).
14. **Verification method:** the two `docker run` probes above against the rebuilt image must print `WRITE_OK`.
15. **Residual risks:** a pre-existing host directory owned by another uid still fails; rootless Docker and Docker Desktop map ownership differently and were not probed.

Causality: `PRIOR_REPORTED` (MON-M01), `CONFIRMED_WITH_DIFFERENT_ROOT_CAUSE`: the upstream finding's Helm persistence half is fixed (section 5), the Compose half is the uid mismatch above. `scripts/check-docs-manifests.mjs` (run: OK, 119 Helm values, 33 documents) checks paths and Helm defaults, not mount ownership.


### A26-M41 - Release publication precedes the gates: images reach `:latest` before the CVE gate, and the release job pushes an untested `[skip ci]` bump with an admin token (MON-M45)

- **Canonical severity:** MEDIUM. kept MEDIUM (S21's rating confirmed): the security impact needs a CRITICAL CVE in the image at release time, and the audited revision itself is such an untested bump (section 2).
- **Absorbs:** A26-S21-02 (primary, 21-tests-ci-release.md, session severity MEDIUM); A26-S02-10 (merged surface, 02-prior-high-triage.md, session severity MEDIUM).
- **Invariants and prior findings named:** INV-RELEASE-001, MON-M45.
- **Lens:** ci.

#### A26-S21-02 (primary) - Release images are pushed to `:latest` and `:X.Y.Z` before the CVE gate and before the release decision; any later failure or cancellation leaves them published, and the next dispatch reuses the version

1. **Severity:** MEDIUM
2. **Confidence:** high
3. **Location:** `.github/workflows/ci.yml:998-1027` (`push: true`, tags `:latest` and `:X.Y.Z`), `:1035-1044` (cosign on all three references), `:1072-1080` (Trivy report, `exit-code: '0'`), `:1089-1096` (the CVE gate, `exit-code: '1'`, after the push), `:1098-1100` (comment: "so a failed or vulnerable build never leaves a dangling version commit"), `:41-43` (one concurrency group per workflow and ref, `cancel-in-progress: true`), `:896-918` (version derived from `backend/package.json` at `github.sha`); `docs/release-integrity.md:207` ("CVE gate fails the build ... The scan is a gate, not a report"); `docs/system-invariants.md` INV-RELEASE-001 "Retry semantics".
4. **Violated invariant:** INV-RELEASE-001 and REL-003: what a consumer pulls under a release tag is a verified, released revision; and the CVE gate keeps a CRITICAL-CVE image from being published.
5. **Reproduction scenario (three entry points, one root):**
   - (a) A base-image or dependency CVE rated CRITICAL with a fix available: `build-and-push` pushes `ghcr.io/kenlasko/monize-backend:latest` and `:1.19.1`, signs them, then "Fail on critical CVEs" exits 1. The job is red, `release` does not run -- and `:latest` already points at the vulnerable digest. Every `docker compose -f docker-compose.prod.yml pull` (`:latest`, `docker-compose.prod.yml:23`) installs it.
   - (b) The maintainer merges a PR while a release dispatch on `main` is in `build-and-push` or later. The push to `main` starts a run in the group `CI Pipeline-refs/heads/main`, the same group as the dispatch (`github.ref` is `refs/heads/main` for both), and `cancel-in-progress` cancels the release. Images already pushed stay published; no bump, no tag. Hosted evidence for the mechanism: runs 270 to 329 of this repository's `CI Pipeline` on PR #31 all ended `cancelled` by the next push of the same ref.
   - (c) After (a) or (b), the next dispatch reads `backend/package.json` (still the old version, the bump never landed), resolves the same `1.19.1`, and pushes a different digest under `:1.19.1`. An operator who pinned `:1.19.1` between the two runs now runs a different image under the same version tag, and both digests carry a valid cosign signature for `:1.19.1`.
6. **Observed:** publication to the consumer-facing tags is the first side effect of the release path; every gate after it (CVE gate, git bump, tag) can fail without unpublishing. INV-RELEASE-001's "Retry semantics" says "A re-run after a partial release may bump the version twice"; the more likely outcome of a re-dispatch after an image-stage failure is the opposite: the same version is reused for a different digest.
7. **Expected:** push by digest (or to a staging tag) first, run the CVE gate on that digest, and move `:latest` / `:X.Y.Z` only after the gate and, ideally, after the git half succeeded; refuse a dispatch whose version tag already exists in the registry; exclude release runs from cancellation.
8. **Impact:** security (a CRITICAL-CVE image reaches every `:latest` consumer despite the gate the docs describe), integrity of version identity (one version string, two images), operations (a half-published release no tag refers to, as the invariant's own crash semantics say).
9. **Root cause:** `docker/build-push-action` is configured with the final tags and `push: true` in the same step that builds, so the scan can only report on something already published; the concurrency group does not distinguish a release from a push.
10. **Recommended correction:** build and push by digest only (no tags), scan and sign the digest, then a final step (after the CVE gate, and in the `release` job if the maintainer wants tag-after-commit) adds `:X.Y.Z` and `:latest` with `docker buildx imagetools create`; give `workflow_dispatch` runs their own non-cancelling group; refuse when `:X.Y.Z` already exists.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@
 concurrency:
-  group: ${{ github.workflow }}-${{ github.ref }}
-  cancel-in-progress: true
+  group: ${{ github.workflow }}-${{ github.event_name == 'workflow_dispatch' && 'release' || github.ref }}
+  cancel-in-progress: ${{ github.event_name != 'workflow_dispatch' }}
@@ build-and-push:
-          push: true
+          # Digest only: no consumer-facing tag exists until the CVE gate passed.
+          outputs: type=image,name=${{ matrix.image }},push-by-digest=true,name-canonical=true,push=true
           platforms: linux/amd64,linux/arm64
           provenance: true
           sbom: true
-          tags: |
-            ${{ matrix.image }}:latest
-            ${{ matrix.image }}:${{ needs.prepare-release.outputs.version }}
@@
       - name: Fail on critical CVEs
         ...
+      - name: Refuse a version that is already published
+        env:
+          IMAGE: ${{ matrix.image }}
+          VERSION: ${{ needs.prepare-release.outputs.version }}
+        run: |
+          if docker buildx imagetools inspect "${IMAGE}:${VERSION}" >/dev/null 2>&1; then
+            echo "::error::${IMAGE}:${VERSION} already exists"; exit 1
+          fi
+      - name: Publish the gated digest under its tags
+        env:
+          IMAGE: ${{ matrix.image }}
+          DIGEST: ${{ steps.build.outputs.digest }}
+          VERSION: ${{ needs.prepare-release.outputs.version }}
+        run: docker buildx imagetools create -t "${IMAGE}:${VERSION}" -t "${IMAGE}:latest" "${IMAGE}@${DIGEST}"
```

    The cosign step then signs `${IMAGE}@${DIGEST}` only (a signature is per digest; the tag references are redundant). Maintainer decision: whether `:latest` moves before or after the `release` job's git half.
12. **Recommended regression test:** a workflow self-test (the INV-RELEASE-001 "Required tests" row) asserting, by parsing `ci.yml`, that no step with `push: true` in `build-and-push` carries a non-digest tag before the step named "Fail on critical CVEs", and that `workflow_dispatch` runs are not in a cancelling group.
13. **Suggested regression-test diff:** add to `backend/src/common/ci-images.guard.spec.ts`:

```ts
// The spec reads workflow text (it has no YAML parser); keep it textual.
it("publishes no consumer-facing tag before the CVE gate", () => {
  const ci = readFileSync(join(requireRepoRoot(), ".github/workflows/ci.yml"), "utf8");
  const job = ci.slice(ci.indexOf("\n  build-and-push:"), ci.indexOf("\n  release:"));
  const gate = job.indexOf("name: Fail on critical CVEs");
  const tagged = job.search(/\$\{\{ matrix\.image \}\}:(latest|\$\{\{ needs\.prepare-release\.outputs\.version)/);
  expect(gate).toBeGreaterThan(-1);
  expect(tagged === -1 || tagged > gate).toBe(true);
});
```

14. **Verification method:** a dispatch in a fork with a deliberately vulnerable base image: the registry must show no new `:latest`; a push to `main` during a dispatch must not cancel it.
15. **Residual risks:** the preview path pushes `:beta` with no CVE scan at all, by design (`ci.yml:1300-1304`); that is a documented choice, recorded as DR-S21-1, not part of this finding.

Causality: `PRE_EXISTING_UNREPORTED` (MON-M45 covers the git half only; S01 recorded the shared concurrency group as DR-S01-6, not executed). Rule 7: one root (publication precedes the gates), three entry points. Execution evidence: the step order traced at the baseline SHA, and the hosted cancellation of every superseded run on PR #31.

#### A26-S02-10 (merged surface) - The release job pushes an untested `[skip ci]` version-bump commit with an admin token (MON-M45 still open)

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


### A26-M42 - The concurrency, post-commit and database-boundary invariants behind the program's HIGH and MEDIUM findings have no test at the production boundary (MON-M46)

- **Canonical severity:** MEDIUM. kept MEDIUM: missing tests; each defect they fail to catch is counted in its own finding.
- **Absorbs:** A26-S21-04 (primary, 21-tests-ci-release.md, session severity MEDIUM); A26-S03-04 (merged surface, 03-security-auth.md, session severity MEDIUM); A26-S04-04 (merged surface, 04-rls-tenancy.md, session severity MEDIUM); A26-S05-01 (merged surface, 05-migrations-schema.md, session severity MEDIUM); A26-S07-09 (merged surface, 07-cash-ledger.md, session severity LOW); A26-S08-05 (merged surface, 08-scheduler-cron.md, session severity LOW); A26-S16-09 (merged surface, 16-budgets-reports.md, session severity LOW); A26-S17-05 (merged surface, 17-ai-mcp-notifications.md, session severity LOW); A26-S02-12 (merged surface, 02-prior-high-triage.md, session severity LOW); A26-S06-06 (merged surface, 06-backup-restore.md, session severity LOW); A26-S09-02 (merged surface, 09-import-mny.md, session severity MEDIUM).
- **Invariants and prior findings named:** INV-AUTH-001, INV-CLAIM-001, INV-OCCURRENCE-001, INV-CRON-001, INV-MCP-001, INV-BACKUP-009, INV-IMPORT-002, MON-M46, MON-M04.
- **Lens:** test.

#### A26-S21-04 (primary) - Program-wide: the concurrency, post-commit and database-boundary invariants behind 15 HIGH and MEDIUM findings have no test at the production boundary (MON-M46 still open; consolidation of every session's undetected rows)

1. **Severity:** MEDIUM (missing test; the defects it fails to catch are counted in their own findings)
2. **Confidence:** high (59 undetected mutation rows across 17 sessions, each executed or traced by its session; four re-checked against source here)
3. **Location:** the family table in section 6.2; harness roots in `backend/test/helpers/integration-setup.ts:160-215` (`ScheduledTransactionsModule` replaced by `{}` stubs for its three exports and internals in every suite built through `createIntegrationModule`), `INTEGRATION_TYPEORM_OPTIONS` (schema from entities, A26-S05-01).
4. **Violated invariant:** S21-I4 (`docs/verification-contract.md` sections 2-3: a lock, a lease, a CAS or a post-commit ordering is proved only by a test with independent connections or a failpoint at the same boundary as production).
5. **Reproduction scenario:** per row of section 6.2: delete the lock, predicate or ordering; every committed suite stays green. Examples executed by their sessions: `token.service.ts:149`/`:261` `lockTokenFamily` removed (S03, `token.service.spec.ts` 33/33 green, probe 59/60 leaks); `transaction-split.service.ts:1116` parent read without `FOR UPDATE` (S07, all suites green); `job-claim.service.ts:144/146/281` lease predicates (S08, only SQL-text unit assertions fail); `134_joint_native_read_rls.sql:47` delegate predicate (S04, 175/175 integration green); `budget-spending.util.ts:132` VOID filter (S16, 510 unit and 3 integration green).
6. **Observed:** eleven root-cause families (section 6.2), of which three are harness properties rather than missing cases: no reusable two-connection harness (F1), an entity-built schema without the production keys and CHECKs (F3, A26-S05-01), and the scheduled module stubbed for every integration suite (F4: 22 production files outside `src/scheduled-transactions/` consume the stubbed services; `scheduled-loan-pricing-concurrency.integration.spec.ts:40` and `loan-settlement-claim.integration.spec.ts:53` both state the real `post()` "cannot be constructed here").
7. **Expected:** the harness builds the schema from `database/schema.sql` (or a parity guard holds the entities to it), constructs the real scheduled module, and offers a two-connection barrier helper; each HIGH finding of the program has a red test before its fix.
8. **Impact:** every HIGH concurrency or post-commit fix of the remediation program can regress silently; the suites the docs name as the owners (`Backend Integration Tests` "owns six test kinds", `docs/verification-contract.md:358-362`) cannot currently host the tests for F3 and F4 at all.
9. **Root cause:** the integration harness trades fidelity for construction convenience (entity `synchronize`, module stubs to break a forwardRef cycle), and no harness primitive exists for two connections with a barrier, so each session that needed one wrote a throwaway probe.
10. **Recommended correction:** three harness tasks before the per-finding tests: (1) `createIntegrationModule` builds the real `ScheduledTransactionsModule` (resolve the cycle with `forwardRef` in the test module, as production does); (2) build the test schema by applying `schema.sql`, or add the parity guard S05 proposed; (3) a `raceTwo(dataSource, a, b, barrier)` helper under `test/helpers/`. Then one red test per family row.
11. **Suggested remediation diff:** incomplete -- the harness change is supported by the evidence (`integration-setup.ts:200-212`, delete the `overrideModule(ScheduledTransactionsModule)` block and import the real module), but whether the cycle resolves in a `TestingModule` without the stub was not tried in this session; that is the missing information.
12. **Recommended regression test:** per family, the first test listed in section 6.2's "first red test" column.
13. **Suggested regression-test diff:** the two-connection pattern S03 used for its probe (two `DataSource`s, a `pg_advisory_lock` barrier) promoted to `test/helpers/race.ts`; not written here.
14. **Verification method:** re-run each section 6.2 mutation after the harness change; every row must turn `covered`.
15. **Residual risks:** frontend cache rows (F11) need a browser or a component harness, not the database helper.

Causality: `PRIOR_REPORTED` (MON-M46), `CONFIRMED`, and widened: the upstream finding named seven race classes; the program found 59 undetected rows in eleven families. Joins, by Rule 7, the session test-coverage findings A26-S03-04, A26-S04-04, A26-S05-01 (harness half), A26-S07-09, A26-S08-05, A26-S16-09, A26-S17-05 (S23 keeps each defect finding separate and merges these test findings here or keeps them as surfaces of this one).

#### A26-S03-04 (merged surface) - The concurrency mechanisms behind INV-AUTH-001/004 and INV-CLAIM-001 have no behavioural test: removing them leaves every existing suite green

1. **Severity:** MEDIUM (test coverage; the mutations reintroduce MON-M23 and MON-H09)
2. **Confidence:** high (mutations executed, section 6)
3. **Location:** `backend/src/auth/token.service.ts:149` (family lock in `refreshTokens`), `:261` (family lock in `revokeTokenFamily`), `:164-177` (reuse branch); `backend/src/emergency-access/emergency-access-claim.controller.ts:219-231` (conditional consume); tests `backend/src/auth/token.service.spec.ts`, `backend/test/integration/logout-revoke-failpoint.integration.spec.ts`, `backend/test/integration/emergency-access-grant-cycles.integration.spec.ts`, `backend/src/emergency-access/emergency-access-claim.controller.spec.ts`.
4. **Violated invariant:** `docs/verification-contract.md` -- a concurrency claim needs a real two-connection test; INV-AUTH-001 and INV-CLAIM-001 each list that test as "required" / "still owed".
5. **Reproduction (mutation):** delete `await lockTokenFamily(manager, familyId)` from `revokeTokenFamily`: `token.service.spec.ts` 33/33 pass, `logout-revoke-failpoint` 2/2 pass; the session's race probe (60 rotate-versus-logout pairs) reports `{"leaks":48,"rotationsWon":49}` -- 48 logouts returned success with a live token in the family. Deleting the family lock from `refreshTokens` instead: same suites green, probe `{"leaks":59,"rotationsWon":60}`. Removing both claim guards (`claim_token_used_at IS NULL` and `claim_token_hash = NULL`): the integration suite `emergency` 15/15 pass; only the unit spec fails, and only because it matches the SQL text; the probe shows both concurrent claims succeed in 5/5 rounds (`{"ok":2,"statuses":["ok","ok"]}`), the exact MON-H09 takeover race.
6. **Observed:** the mechanisms work at the baseline (probe: 0/60 leaks; 5/5 claim rounds with one winner) but nothing in the repository's suites would notice their removal; A26-S03-01 is a defect of exactly this blind spot.
7. **Expected:** one integration test per mechanism that fails on the mutation.
8. **Impact:** regression risk on three security-critical properties; the invariant index marks them `enforced` on the strength of mechanisms no test protects.
9. **Root cause:** unit tests with a mocked transaction stand in for concurrency proofs.
10. **Recommended correction:** add the three two-connection tests below to `test/integration/` (the session's probe is a working draft of each).
11. **Suggested remediation diff (illustrative, not applied):** this finding is the test itself (protocol item 12 exception: the defect is the missing test).
    ```diff
    --- /dev/null
    +++ b/backend/test/integration/auth-concurrency.integration.spec.ts
    @@
    +// INV-AUTH-004: logout racing a rotation of the same token leaves no live member.
    +it("logout covers a replacement inserted by a concurrent rotation", async () => {
    +  for (let i = 0; i < 40; i++) {
    +    const { refreshToken: t0 } = await withSystemContext(() => tokens.generateTokenPair(user, false));
    +    const familyId = await familyOf(t0);
    +    await Promise.allSettled([
    +      withSystemContext(() => tokens.refreshTokens(t0)),
    +      sleep(i % 4).then(() => withSystemContext(() => tokens.revokeRefreshToken(t0))),
    +    ]);
    +    expect(await liveMembers(familyId)).toBe(0);
    +  }
    +});
    +// INV-AUTH-001: two concurrent rotations of one token yield one successor.
    +it("two concurrent rotations produce exactly one live successor", async () => { /* allSettled x2, count fulfilled === 1 */ });
    +// INV-CLAIM-001: two concurrent completes with different passwords -> one 200, one 404, one password.
    +it("a claim token is consumed once under concurrency", async () => { /* see probe */ });
    ```
12. **Recommended regression test:** as above; each must be shown failing on its mutation before it is merged.
13. **Suggested regression-test diff:** above.
14. **Verification method:** run each test on the baseline (green) and on the mutations of section 6 (red).
15. **Residual risks:** timing-based races are probabilistic; the logout test hit the window 48-59 times in 60 here, which is ample, but a slower CI runner should keep the iteration count rather than lower it.

- **Causality class:** `PRE_EXISTING_UNREPORTED` (slice-specific instance of MON-M46, which S21 owns).

#### A26-S04-04 (merged surface) - No test runs delegation management, joint-account writes or cross-owner transfers on the unprivileged role, and a policy mutation that exposes every granted account to every user is undetected

1. **Severity:** MEDIUM (missing test on a security mechanism; A26-S04-01 to -03 are all invisible to the current suites for this reason).
2. **Confidence:** high (executed mutation, section 6).
3. **Location:** `backend/test/integration/joint-accounts.integration.spec.ts:138`, `cross-owner-transfers.integration.spec.ts:122` (both `createIntegrationModule`, the owner role, RLS not applied to the module's connection); no integration spec calls `createDelegate`, `delegateEmailExists`, `resetDelegatePassword`, `setCapabilities` or `setSectionGrants` (the only callers are `revokeDelegate` in the two owner-role suites); `rls-enforcement.integration.spec.ts` has positive cases for the delegate arms (`:420-730`) and per-user exact-set reads, but none that a third user cannot see an account carrying a grant to somebody else (mutation MA stays green).
4. **Violated invariant:** `docs/verification-contract.md`: a mock proves the call, not the property; the RLS contract's guarantee needs a test on the role it is about.
5. **Realistic reproduction scenario:** mutation MA (section 6): drop `AND d.delegate_user_id = (SELECT app_real_user_id())` from the `accounts` read arm in `134_joint_native_read_rls.sql:47`, so every account carrying any active grant is readable by every user; result `Tests: 175 passed, 175 total` over `rls-*`, `security-cross-user-isolation`, `joint-accounts`, `cross-owner-transfers`, `calendar-day-notes`, `calendar-read-models`, and `35 passed` on `rls-enforcement` alone. Mutation MD (the real-user GUC collapsed onto the current one in `scoped-db.ts:208`) is also green on every integration suite of that set and is caught only by mocked unit specs.
6. **Observed:** green.
7. **Expected:** at least one failure.
8. **Impact:** a regression of the tenant boundary on the shared-account surface ships green.
9. **Root cause:** the two feature suites predate or bypass `createEnforcedIntegrationModule`; `rls-enforcement` tests that the delegate sees the granted rows, not that nobody else does.
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

#### A26-S05-01 (merged surface) - The integration harness lacks 15 production unique keys and 82 production CHECK constraints, and no guard compares them

1. **Severity:** MEDIUM
2. **Confidence:** high
3. **Location:** `backend/test/integration/schema-entity-parity.integration.spec.ts:29-160` (the only schema/entity parity guard; FK delete rules only); `backend/test/helpers/integration-setup.ts:52-70` (`synchronize: true`); `backend/test/helpers/rls-setup.ts:335-476` (`applyRlsPolicies`, which restores policies, triggers, functions and exclusion constraints but no unique key or CHECK); `backend/src/budgets/entities/budget-period.entity.ts:32` vs `database/schema.sql:2407` and `backend/src/budgets/budget-period.service.ts:237-243`; the 15 keys listed below.
4. **Violated invariant:** S05-B, the `AGENTS.md` rule that an index or constraint is declared in the migration, `schema.sql` and an entity decorator, "because the integration suite builds from entities, so a missing decorator lets race tests pass against a database with no constraint to contend over"; and `docs/verification-contract.md` VER-001's premise that a two-connection integration test is evidence about production.
5. **Realistic reproduction scenario:** Build the harness exactly as every integration suite does (`INTEGRATION_TYPEORM_OPTIONS` + `applyRlsPolicies`), build a second database from `schema.sql`, and diff `pg_index`/`pg_constraint`. Executed in the scratch worktree: the harness has no unique arbiter for these 15 production keys:
   - `budget_periods (budget_id, period_start)`, `budget_period_categories (budget_period_id, budget_category_id)`, `categories (user_id, name, parent_id)`, `import_column_mappings (user_id, name)`, `ai_provider_configs (user_id, provider, priority)`, `loan_rate_changes (account_id, effective_date)`, `account_delegates (owner_user_id, delegate_user_id)`, `account_delegate_grants (delegation_id, account_id)`;
   - expression or token indexes: `tags (user_id, lower(name))`, `payee_aliases (user_id, lower(alias))`, `loan_scenarios (user_id, account_id, lower(name))`, `emergency_access_contacts (owner_user_id, lower(email))`, `refresh_tokens (token_hash)`, `personal_access_tokens (token_hash)`, `trusted_devices (token_hash)`.

   And 82 production CHECK constraints are absent from the harness (61 of them on tables created or changed by the 56 migrations since 2026-08), among them `ck_ai_review_requests_parser_draft_shape`, `ck_ai_review_requests_trade_shape`, `ck_email_receipt_mailboxes_credentials`, `ck_bank_sync_accounts_linked_has_cutoff`, `accounts_prepayment_mode_linear_only`, `accounts_payment_amount_method_check`, `ck_calendar_day_notes_span`, `ck_backup_offsite_uploads_status`. The harness has no CHECK that production lacks.

   Concrete consequence, executed: `INSERT INTO budget_periods ... ON CONFLICT (budget_id, period_start) DO NOTHING` (the statement `BudgetPeriodService.createPeriodForBudget` issues) returns `INSERT 0 0` on the `schema.sql` database and `ERROR: there is no unique or exclusion constraint matching the ON CONFLICT specification` on the harness database. The production write path that decides "who creates this month's period" therefore cannot run in any integration suite; no integration suite calls it (`budget-period-rollover.integration.spec.ts:24-26` tests only the job claim in front of it and says "the rollover's own writes ... have their own specs", which are unit specs with mocks).
6. **Observed implementation behavior:** Each suite that needs a production key re-creates it by hand (`bank-sync.integration.spec.ts:2268-2280` creates and drops `idx_tags_user_name`; `email-receipts-schema.integration.spec.ts` builds a separate `schema.sql` database because "every other integration suite builds its schema from entity metadata, which creates none of the CHECK constraints"). Every other suite runs without them. The parity guard asserts only `ON DELETE` rules, with a 55-entry shrink-only baseline.
7. **Expected behavior:** The harness carries every unique key, exclusion constraint and CHECK `schema.sql` declares, or a guard fails the build when an entity omits one, the way the FK guard does for delete rules.
8. **Impact:** Data integrity and verification. A race or duplicate-write test over any of the 15 keys passes against a database with no constraint to contend over (`refresh_tokens.token_hash`, `personal_access_tokens.token_hash` and `trusted_devices.token_hash` are the token lookup keys; `account_delegates`/`account_delegate_grants` are the delegation keys; `categories`, `tags`, `payee_aliases` decide find-or-create convergence). A write that a production CHECK rejects (a parser-draft row of the wrong shape, an OAuth mailbox carrying a password) passes every integration suite and fails only in production, as a 500. No present-day production corruption was established: production has the constraints. The defect is that the suite the repository names as its evidence for these properties cannot observe them, and `ON CONFLICT` paths on missing keys are untestable at the integration level.
9. **Root cause:** The rule "declare it in all three places" has no machine check for unique keys or CHECKs; `schema-entity-parity` was written for the P2-009 FK case only, and `applyRlsPolicies` restores the categories TypeORM "cannot express" (exclusion constraints) but not the ones the entities simply omit.
10. **Recommended correction:** Extend the parity guard to unique keys (including partial and expression indexes) and CHECK constraints, with the same shrink-only baseline shape; then shrink the baseline by declaring the keys on the entities (`@Unique`, `@Index(..., { unique: true, where })`, `@Check`) or, for expression indexes TypeORM cannot express, by having `applyRlsPolicies` apply them from `schema.sql` the way it applies exclusion constraints.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/test/integration/schema-entity-parity.integration.spec.ts
+++ b/backend/test/integration/schema-entity-parity.integration.spec.ts
@@
+  /**
+   * Unique keys and CHECKs schema.sql declares that the entity-built harness
+   * lacks. Shrink-only, like KNOWN_DRIFT: a race test over a key that is not
+   * here runs against a database with nothing to contend over.
+   */
+  const KNOWN_MISSING_KEYS: string[] = [
+    "account_delegate_grants|UNIQUE (delegation_id, account_id)",
+    // ... the 15 unique keys and 82 CHECKs found at 72c59ec4, sorted
+  ];
+
+  it("carries every unique key and CHECK schema.sql declares", async () => {
+    const prod = await catalogOf(await schemaSqlDatabase());
+    const harness = await catalogOf(dataSource);
+    const missing = prod.filter((k) => !harness.has(k)).sort();
+    expect(missing.filter((k) => !KNOWN_MISSING_KEYS.includes(k))).toEqual([]);
+    expect(KNOWN_MISSING_KEYS.filter((k) => !missing.includes(k))).toEqual([]);
+  });
--- a/backend/src/budgets/entities/budget-period.entity.ts
+++ b/backend/src/budgets/entities/budget-period.entity.ts
@@
-@Entity("budget_periods")
+@Entity("budget_periods")
+@Unique("budget_periods_budget_id_period_start_key", ["budgetId", "periodStart"])
```

12. **Recommended regression test:** the extended parity guard above, plus a two-connection integration test of `createPeriodForBudget` for one budget and one month.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+++ b/backend/test/integration/budget-period-create-race.integration.spec.ts
+it("two concurrent creations of one month's period leave one row and both succeed", async () => {
+  const [a, b] = await Promise.all([
+    withUserContext(ownerId, () => periodsA.createPeriodForBudget(ownerId, budget, monthStart)),
+    withUserContext(ownerId, () => periodsB.createPeriodForBudget(ownerId, budget, monthStart)),
+  ]);
+  expect(a.id).toBe(b.id);
+  expect(await count("budget_periods", { budget_id: budget.id })).toBe(1);
+});
```

    Fails today with 42P10 in the harness, which is the point: it cannot pass until the key is in the harness.
14. **Verification method:** run the extended guard on the baseline (expect the baseline list), add the `@Unique`, re-run (expect the entry to leave the list), run the race test.
15. **Residual risks / patch limitations:** declaring a key on an entity changes nothing in production (no `synchronize` there), so the fix is test-only; expression indexes need the `schema.sql`-extraction route; the baseline approach keeps the gap visible but does not close it.

Causality: `PRE_EXISTING_UNREPORTED` for the 15 unique keys (all on tables older than `d5cea9bf`; the upstream phase 7 inventory row for `integration-setup.ts` says the harness "can hide ... migration differences" without naming one); `NEW_SINCE_UPSTREAM_AUDIT` for the 61 CHECKs on tables from the 56 new migrations. One finding per Rule 7: one violated rule, one root cause. Execution evidence: `<scratchpad>/three-place.json` (catalog diff) and the arbiter probe in section 7.

#### A26-S07-09 (merged surface) - No suite detects removal of the split-parent lock, the closed-account predicate or the transfer compare-and-set at the database level (test coverage; joins MON-M46)

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

#### A26-S08-05 (merged surface) - No integration test runs the real `post()`, the auto-post cron, or the lease semantics against PostgreSQL

1. **Severity:** LOW
2. **Confidence:** high
3. **Location:** `backend/test/helpers/integration-setup.ts:117-150` (the module is stubbed); `scheduled-loan-pricing-concurrency.integration.spec.ts:38-45` and `loan-settlement-claim.integration.spec.ts:53` say so; `src/common/jobs/job-claim.service.spec.ts:62-195` (asserts SQL text); `job-claim-lease-rollout.integration.spec.ts` (migration-143 trigger only).
4. **Violated invariant:** INV-OCCURRENCE-001 "a two-instance integration test is still owed"; INV-CRON-001 "two-instance per job"; `docs/verification-contract.md` (a mock proves the call, not the property).
5. **Reproduction:** mutations M1-M3 and M5-M7 (section 6) leave every integration suite green; A26-S08-01..03 are invisible to the suite.
6. **Observed:** the probes in this report are the first runs of the real posting path against PostgreSQL in the program.
7. **Expected:** the probe harness (construct `ScheduledTransactionsService` by hand over the real `TransactionsService`, stub only the loan and FX collaborators) in the suite, plus a real-database lease test (retake after expiry, no retake once delivered, stale holder's `markDelivered` refused).
8. **Impact:** regressions of the occurrence protocol reach `main` with green CI as long as the unit mocks are unchanged.
9. **Root cause:** the module cycle the stub breaks, and no hand-constructed alternative.
10. **Recommended correction:** add `scheduled-posting.integration.spec.ts` built as `<scratchpad>/mut/backend/test/integration/zz-s08-probe.integration.spec.ts` is built, and `job-claim-lease.integration.spec.ts`.
11. **Suggested remediation diff (illustrative, not applied):** a test-only change, acceptable here because the defect is the missing test:

```diff
+++ b/backend/test/integration/scheduled-posting.integration.spec.ts
+  function replica(): ScheduledTransactionsService {
+    return new ScheduledTransactionsService(
+      accounts, transactions, {} as any, {} as any, {} as any, {} as any,
+      loanStub as any, dataSource, history, {} as any, alerts as any,
+    );
+  }
+  it("two replicas, one tick: one posting", async () => { /* P1 with a two-party barrier after selection */ });
+  it("a replica that selected before the winner committed posts nothing", async () => { /* P1b */ });
+  it("a failure between claim and money leaves no claim", async () => { /* P5 */ });
```

12-14. **Regression test / diff / verification:** as above; `npm run test:integration -- scheduled-posting job-claim-lease`.
15. **Residual risks:** the hand-built service stubs the FX and investment collaborators, so FX and investment postings still need their own cases.

Causality: `PRE_EXISTING_UNREPORTED` as a test gap (S02 noted it; joins MON-M46 in S21).

#### A26-S16-09 (merged surface) - No committed test can exercise the two unique keys budgets rely on, and VOID removal from budget spending is undetected (test coverage)

1. **Severity:** LOW
2. **Confidence:** high (executed)
3. **Location:** `idx_notifications_fingerprint` and `budget_periods UNIQUE(budget_id, period_start)` exist in `database/schema.sql` (`:2483`, `:2407`) but on neither entity (`notification-center/entities/notification.entity.ts`, `budgets/entities/budget-period.entity.ts`); the integration harness builds from entities (`test/helpers/integration-setup.ts:60`).
4. **Violated invariant:** the protocol's "declared in all three"; docs/verification-contract.md (a race claim needs a real two-connection test).
5. **Reproduction (executed):** `closePeriod` in the integration schema fails with "there is no unique or exclusion constraint matching the ON CONFLICT specification" until the constraint is added by hand (probe first run); no integration spec touches the fingerprint (`grep` finds only `migration-140-preflight`, which tests the preflight, not the race). Mutation M5 (VOID kept in budget category spending) passes both `budget*` unit suites and the budget integration suite.
6. **Observed:** the period close and both race arbiters are untestable in the committed harness; three mutations survive (section 6).
7. **Expected:** entity decorators matching `schema.sql`; a two-connection race test for alerts and for the period insert; a VOID case for category actuals.
8. **Impact:** a regression in MON-L03's fix, in period creation or in the VOID filter would ship green.
9. **Root cause:** the keys were added by migration only.
10. **Recommended correction:** `@Index("idx_notifications_fingerprint", ...)` is not expressible with `COALESCE` in a decorator, so the harness should apply the expression index after synchronize (beside `applyRlsPolicies`); `@Unique(["budgetId", "periodStart"])` on `BudgetPeriod`.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/budgets/entities/budget-period.entity.ts
+++ b/backend/src/budgets/entities/budget-period.entity.ts
-@Entity("budget_periods")
+@Entity("budget_periods")
+@Unique(["budgetId", "periodStart"])
 export class BudgetPeriod {
```

12. **Recommended regression test:** P4 (two `pg` clients, barrier, one row) and P2/P3 as committed integration specs; a VOID expense in `budget-split-transfer-spending` asserting it is not in `spent`.
13. **Suggested regression-test diff:** the probe in section 7, minus the hand-made constraint.
14. **Verification:** `npm run test:integration -- budget`.
15. **Residual risks:** the harness change touches every suite's schema; run the whole integration job once.

Causality: `PRE_EXISTING_UNREPORTED`.

#### Confirmed hand-off: A26-S07-08 (custom-report text filter)

Confirmed at `reports.service.ts:571-577` (`searchText`) and `:719-735` (`text` condition): `%${value.trim().toLowerCase()}%`, no escape, outside `applyTransactionSearch`. Keeps S07's ID and severity (LOW); no new finding.

#### A26-S17-05 (merged surface) - No test pins that a 2025-era session's tools see the presenting token's scopes (the MON-M04 fix is undetected by every suite)

1. **Severity:** LOW
2. **Confidence:** high (executed, M2)
3. **Location:** `backend/src/mcp/mcp-http.controller.ts:235-257` (`authorize` sets `req.auth` per request), `:298-325` (existing-session POST); tests `mcp-http.controller.spec.ts`, `mcp-eras.spec.ts`.
4. **Violated invariant:** INV-MCP-001 ("with that credential's current scopes"); `docs/verification-contract.md` (a material invariant needs a test that fails when it is broken).
5. **Realistic reproduction scenario:** an OAuth MCP client refreshes its access token with a narrower `scope` (`monize:read` only) on the same grant; the 2025-era session continues.
6. **Observed implementation behavior:** correct today (the tool sees `read`). Mutation M2, which serves the tools the scopes stored at session creation (the exact MON-M04 defect), passes all 802 MCP unit tests.
7. **Expected behavior:** a test fails when a tool on an existing 2025-era session is served anything but the presenting request's scopes.
8. **Impact:** a regression of MON-M04 (a narrowed token keeping write scope for up to the 1-hour session TTL) would ship green.
9. **Root cause:** the controller spec asserts the 403 on a credential mismatch and the modern request's own `authInfo`, but no case drives a same-credential, narrowed-scope request through an existing session to a tool.
10. **Recommended correction:** add that case (and, separately, the documentation line in INV-MCP-001's "Required tests").
11. **Suggested remediation diff (illustrative, not applied):** test-only by nature; the production code is correct (the defect is the missing test, protocol item 12).
12. **Recommended regression test / 13. Suggested regression-test diff (illustrative, not applied):**

```diff
+++ b/backend/src/mcp/mcp-http.controller.spec.ts
+it("serves an existing session's tool the scopes of the token presented now", async () => {
+  // initialize with oauth grant g1 scopes "read,write"; then call a tool with
+  // the same grant (credentialId oauth:g1) whose current scope is "read".
+  validateAccessToken.mockResolvedValueOnce({ userId: "u1", scopes: "read,write", grantId: "g1" });
+  const sid = await initializeSession();
+  validateAccessToken.mockResolvedValueOnce({ userId: "u1", scopes: "read", grantId: "g1" });
+  const req = toolCallRequest(sid);
+  await controller.handlePost(req, res);
+  expect((req as { auth?: AuthInfo }).auth?.scopes).toEqual(["read"]);
+});
```

14. **Verification method:** re-run M2 with the new case: it must fail.
15. **Residual risks / patch limitations:** the assertion is on `req.auth`; the end-to-end property also depends on the SDK forwarding `req.auth` per request (`@modelcontextprotocol/node` `index.cjs:238`), which an SDK upgrade could change; `mcp-eras.spec.ts` is the place for a real-SDK variant.

Causality: `PRIOR_REPORTED` (MON-M04, test half; the defect itself is `FIXED_VERIFIED`, section 5).

#### A26-S02-12 (merged surface) - The emergency-access integration race exercises a copy of the consume SQL, not the controller

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

#### A26-S06-06 (merged surface) - The Phase-3 owner predicate of the restore has no test that fails without it (M4 undetected)

1. **Severity:** LOW (missing test on a defence-in-depth layer)
2. **Confidence:** high (executed: mutation M4)
3. **Location:** `backend/src/backup/backup-restore-database.service.ts` `restoreDeferredFkColumns` (the `"user_id = $3"` / `ownedThrough` predicate); `backend/src/backup/restore-plan.spec.ts:141-169` (checks the `DEFERRED_FK_REPAIRS` declarations, not the SQL); INV-BACKUP-009 lists that spec as the test of the confinement.
4. **Violated invariant:** INV-BACKUP-009 "Phase-3 repair UPDATEs carry user_id = $3", as a tested property.
5. **Realistic reproduction scenario:** replace the predicate with `(user_id = $3 OR true)`.
6. **Observed:** 208 unit tests in `restore-plan`, `backup-restore-database`, `backup.service` and 25 integration tests pass.
7. **Expected:** a test seeds a second user's row and calls `restoreDeferredFkColumns` with a `data` row whose id is that row's id, and asserts the other row is unchanged.
8. **Impact:** today unreachable (resolveRestoreReferences and the remap make every id fresh); the predicate is the layer that must hold if either regresses, and nothing would notice its removal.
9. **Root cause:** the spec proves the plan is declared confined, not that the SQL is.
10. **Recommended correction:** add the direct test; reword INV-BACKUP-009's required-tests line.
11. **Suggested remediation diff:** none to production code.
12. **Recommended regression test:** as 7.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+  it("a Phase-3 repair never updates another user's row, whatever id the data names", async () => {
+    const victim = await createTestUserDirect(dataSource);
+    const v = await seedUserData(victim.id);
+    const restorer = await createTestUserDirect(dataSource);
+    await withScopedDb(dataSource, (m) =>
+      module.get(BackupRestoreDatabaseService).restoreDeferredFkColumns(
+        m, { categories: [{ id: v.childCategoryId, parent_id: null as never, }],
+             payees: [{ id: v.payeeId, default_category_id: v.childCategoryId }] } as never,
+        restorer.id));
+    const [row] = await dataSource.query(`SELECT default_category_id FROM payees WHERE id = $1`, [v.payeeId]);
+    expect(row.default_category_id).toBe(v.childCategoryId); // unchanged
+  });
```

14. **Verification method:** M4 must turn this case red.
15. **Residual risks / patch limitations:** none beyond the test's own fixture.

Causality: `NEW_SINCE_UPSTREAM_AUDIT` (the predicate and the spec postdate the upstream audit).

#### A26-S09-02 (merged surface) - The guard that stops a committed run being offered Retry is held by no test

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



### 7.3 LOW findings


### A26-L01 - CI's backend lint step runs `eslint --fix`, so a fixable lint error never fails CI

- **Canonical severity:** LOW. kept LOW.
- **Absorbs:** A26-S01-01 (primary, 01-baseline.md, session severity LOW).
- **Invariants and prior findings named:** none in the index (see field 4 of each member).
- **Lens:** ci.

#### A26-S01-01 (primary) - CI's backend lint step runs `eslint --fix`, so a fixable lint error never fails CI

1. **Severity:** LOW
2. **Confidence:** high
3. **Location:** `backend/package.json` script `lint` (`eslint "{src,apps,libs,test}/**/*.ts" --fix`); `.github/workflows/ci.yml:66` (`- run: npm run lint` in `backend-lint`). Secondary: `AGENTS.md` "Required before you push" (names `npm run lint` as the gate), `docs/verification-contract.md:347` (says the job owns "eslint").
4. **Violated invariant:** S01-I4. A lint error in `backend/` fails the `Backend Lint & Type Check` job. Causality: `PRE_EXISTING_UNREPORTED`.
5. **Reproduction:** At `AUDIT_BASELINE_SHA`, three files carry `prettier/prettier` errors: `backend/src/ai-review/ai-review-work.service.ts:1049`, `backend/src/email-receipts/parsing/receipt-parser.types.ts:157`, `backend/src/email-receipts/pipeline/receipt-instructions.ts:85`. In a scratch worktree at the baseline: `npx eslint <the three files> --max-warnings=0` exits 1 with "3 problems (3 errors)"; `npx eslint <the three files> --fix` (what `npm run lint` does) exits 0 and rewrites the files. CI's checkout is ephemeral, so the rewrite is discarded and the job is green.
6. **Observed:** The job passes with three lint errors on `main`. Any rule ESLint can auto-fix is never enforced by CI for the backend.
7. **Expected:** The job fails on any lint error, as the frontend job does (`frontend` `lint` is `eslint .`, no `--fix`).
8. **Impact:** Operations and code quality only. The RLS bans (`no-restricted-imports`, `no-restricted-syntax`) are not auto-fixable, so they still fail CI; this was checked by mutation (section 6, M2). The defect makes the gate weaker than `AGENTS.md` and `verification-contract.md` state, and the pre-commit hook (`.lintstagedrc.cjs`, also `--fix`) is the only formatting enforcement. A commit that bypasses the hook (web edit, `--no-verify`, squash of an unformatted branch) reaches `main` unformatted, as the three files show.
9. **Root cause:** One script serves two purposes: a developer's auto-format (`--fix`) and the CI check. CI calls the developer script.
10. **Recommended correction:** Add a check-only script and call it from CI.
11. **Suggested remediation diff (illustrative, not applied):**
    ```diff
    --- a/.github/workflows/ci.yml
    +++ b/.github/workflows/ci.yml
    @@ backend-lint
           - run: npm ci
    -      - run: npm run lint
    +      # `npm run lint` is the developer's formatter (--fix); CI checks only.
    +      - run: npx eslint "{src,apps,libs,test}/**/*.ts" --max-warnings=0
    ```
    A check-only script in `backend/package.json` called from CI is the alternative; it was not written out here because `scripts/check-docs-manifests.mjs` fails a document naming an npm script that does not exist yet.
    The same commit must format the three files, or the job turns red. `.github/` is an "Ask first" area (`AGENTS.md`), so the CI half needs the maintainer's agreement. `--max-warnings=0` is a decision: CI currently tolerates warnings; leave it out to change only the `--fix` half.
12. **Recommended regression test:** A source-scanning guard over `ci.yml` that fails when a lint step in any job resolves to a script carrying `--fix`.
13. **Suggested regression-test diff (illustrative, not applied):**
    ```diff
    --- /dev/null
    +++ b/backend/src/common/ci-lint-no-fix.guard.spec.ts
    @@
    +import * as fs from "fs";
    +import * as path from "path";
    +
    +const ROOT = path.resolve(__dirname, "../../..");
    +
    +describe("CI lint steps check, never fix", () => {
    +  it("the backend-lint job runs a script without --fix", () => {
    +    const ci = fs.readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
    +    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "backend/package.json"), "utf8"));
    +    const job = ci.slice(ci.indexOf("  backend-lint:"), ci.indexOf("  backend-unit-tests:"));
    +    const scripts = [...job.matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1]);
    +    for (const s of scripts) expect(pkg.scripts[s] ?? "").not.toMatch(/--fix\b/);
    +    expect(job).not.toMatch(/eslint[^\n]*--fix\b/);
    +  });
    +});
    ```
14. **Verification method:** Re-run the M1 mutation of section 6 (introduce a `prettier/prettier` violation); the job must fail. Run the guard against the unfixed `ci.yml`; it must fail.
15. **Residual risks:** `ci.yml:66` is the only workflow step that calls the backend `lint` script (searched all of `.github/workflows/`). The guard parses YAML textually. `e2e/` has no lint and no type-check step in CI at all (handed to S21).


### A26-L02 - The `WITH_CONTEXT_ALLOWLIST` lint fence misses several import forms

- **Canonical severity:** LOW. kept LOW.
- **Absorbs:** A26-S01-02 (primary, 01-baseline.md, session severity LOW).
- **Invariants and prior findings named:** none in the index (see field 4 of each member).
- **Lens:** ci.

#### A26-S01-02 (primary) - The `WITH_CONTEXT_ALLOWLIST` lint fence does not match an import specifier with a file extension, a `./` segment, a dynamic `import()`, or a direct `requestContextStorage.run`

1. **Severity:** LOW
2. **Confidence:** high
3. **Location:** `backend/eslint.config.mjs:283-289` (`BAN_WITH_CONTEXT.group = ["**/db/with-context", "./with-context"]`). Secondary: `backend/src/common/request-context.ts` (exports `requestContextStorage`, not restricted); the `BAN_OAUTH_PAYLOAD_ENTITY` pattern in the same file has the same form and was not tested.
4. **Violated invariant:** S01-I3 (`AGENTS.md`, "Database access": "A new call site of any of these is added to `WITH_CONTEXT_ALLOWLIST` in the same PR, as a reviewed decision"). The rule has no entry in `docs/system-invariants.md`. Causality: `PRE_EXISTING_UNREPORTED` (the allowlist existed at `d5cea9bf`, `docs/audits/2026-08-upstream/01-baseline-architecture.md:171,896`).
5. **Reproduction (executed, section 6 M3):** In a scratch worktree at the baseline, a new non-allowlisted file `src/zz/a.ts` with `import { withSystemContext } from "../common/db/with-context.js";` and a call to it. `npx eslint src/zz/a.ts` reports nothing; the control file `src/zz/b.ts` with the extensionless specifier is flagged. `npx tsc --noEmit` reports no error for `src/zz/a.ts` (`moduleResolution: nodenext` resolves `.js` to the `.ts` source). A separate `eslint --stdin` sweep found the same miss for `.ts` suffixes, a `../common/db/./with-context` segment and dynamic `import()`; `requestContextStorage.run({ system: true }, fn)` is not restricted by any rule.
6. **Observed:** A file outside the allowlist can seed system context (RLS bypass) and pass lint and type-check.
7. **Expected:** Every importer of `with-context`, in any spelling, and every direct seeding of the context store, fails lint unless allowlisted.
8. **Impact:** Security process. No present-day bypass exists: all 81 importers are allowlisted and none uses these forms (section 12.2). The fence is the mechanism the repository names for reviewing every RLS-bypass call site, and it can be passed by accident (an editor auto-import that adds `.js`) without review.
9. **Root cause:** The ban matches the import string by glob, not the resolved module; the glob enumerates two spellings.
10. **Recommended correction:** Match by regular expression on the specifier, ban the dynamic form, and restrict `requestContextStorage.run` to `with-context.ts` and the interceptor.
11. **Suggested remediation diff (illustrative, not applied):**
    ```diff
    --- a/backend/eslint.config.mjs
    +++ b/backend/eslint.config.mjs
    @@
     const BAN_WITH_CONTEXT = {
    -  group: ["**/db/with-context", "./with-context"],
    +  // Matched by regex on the specifier: the glob form missed "with-context.js"
    +  // (legal under moduleResolution nodenext), ".ts" and a "./" segment.
    +  regex: "(^|/)with-context(\\.[cm]?[jt]s)?$",
       message:
    @@ no-restricted-syntax (src/**/*.ts block)
    +        {
    +          selector: "ImportExpression[source.value=/with-context/]",
    +          message: "Dynamic import of common/db/with-context bypasses WITH_CONTEXT_ALLOWLIST.",
    +        },
    +        {
    +          selector:
    +            'CallExpression[callee.object.name="requestContextStorage"][callee.property.name="run"]',
    +          message: "Seed identity through common/db/with-context (WITH_CONTEXT_ALLOWLIST), never the store directly.",
    +        },
    ```
    The `requestContextStorage.run` selector needs `src/common/db/with-context.ts` and `src/common/interceptors/request-context.interceptor.ts` exempted in a separate block. Needs verification: `npx eslint src` stays green; `regex` support in the installed ESLint 10 `no-restricted-imports` (documented since ESLint 9).
12. **Recommended regression test:** Extend `lint-bans.spec.ts` (it already loads the config) with a case that lints each bypass spelling through the ESLint Node API from a non-allowlisted path and expects one error each.
13. **Suggested regression-test diff (illustrative, not applied):**
    ```diff
    --- a/backend/src/common/db/lint-bans.spec.ts
    +++ b/backend/src/common/db/lint-bans.spec.ts
    @@
    +import { ESLint } from "eslint";
    +
    +describe("with-context fence matches every spelling", () => {
    +  const eslint = new ESLint({ cwd: path.join(REPO_ROOT, "backend") });
    +  it.each([
    +    'import { withSystemContext } from "../common/db/with-context";',
    +    'import { withSystemContext } from "../common/db/with-context.js";',
    +    'import { withSystemContext } from "../common/db/./with-context";',
    +    'export const m = () => import("../common/db/with-context");',
    +    'import { requestContextStorage } from "../common/request-context";\nrequestContextStorage.run({ system: true } as never, () => 1);',
    +  ])("flags %s", async (code) => {
    +    const [r] = await eslint.lintText(code, { filePath: "src/zz/not-allowlisted.ts" });
    +    expect(r.messages.some((m) => /with-context|identity/.test(m.message))).toBe(true);
    +  });
    +});
    ```
14. **Verification method:** The new cases fail on the baseline config (M3 shows it for `.js`) and pass after the fix; `npm run lint` over `src` stays green.
15. **Residual risks:** A wrapper that receives a callback and calls `withSystemContext` on behalf of arbitrary callers is not caught by any lint rule; the sweep found only file-private wrappers (`delegation.service.ts:178`, `transaction-transfer.service.ts:914`). The same gap probably exists for `BAN_OAUTH_PAYLOAD_ENTITY` and `BAN_INJECT_REPOSITORY` path forms; not tested.


### A26-L03 - The layer instruction files order a local coverage run that `AGENTS.md` and the verification contract say is CI's

- **Canonical severity:** LOW. kept LOW.
- **Absorbs:** A26-S01-03 (primary, 01-baseline.md, session severity LOW).
- **Invariants and prior findings named:** none in the index (see field 4 of each member).
- **Lens:** docs.

#### A26-S01-03 (primary) - The layer instruction files order a local coverage run that `AGENTS.md`, the root `CLAUDE.md` and the verification contract say is CI's

1. **Severity:** LOW
2. **Confidence:** high
3. **Location:** `backend/CLAUDE.md:121` ("2. `TZ=UTC npm run test:unit -- --coverage`" under "Before you finish"); `frontend/CLAUDE.md:113` ("2. `npm run test:cov` (CI runs the coverage thresholds, not a bare `npm run test`)"). Contradicted by `AGENTS.md` "Required before you push" ("While developing run `npm run test:changed` ...; the coverage gate is CI's, run it locally only when asked"), root `CLAUDE.md` ("`test:changed` for tests; CI owns the coverage gate"), and `docs/verification-contract.md` s7 ("The full `test:cov` gate stays CI's").
4. **Violated invariant:** S01-I1. Causality: `PRE_EXISTING_UNREPORTED` (not verifiable against `d5cea9bf` in the shallow clone; the `test:changed` rule postdates the upstream audit, so it may be `NEW_SINCE_UPSTREAM_AUDIT`).
5. **Reproduction:** An agent working in `backend/` reads `backend/CLAUDE.md` (the protocol and `AGENTS.md` both say the more specific file applies to its subtree) and runs the full coverage suite before finishing; an agent reading `AGENTS.md` runs `test:changed` and skips coverage. The measured cost of the backend coverage run at the baseline is in section 12.1.
6. **Observed:** Two opposite instructions for the same step.
7. **Expected:** One rule. The guard `backend/src/common/test-changed.guard.spec.ts` holds the `AGENTS.md` version, so the layer files should match it.
8. **Impact:** Agent and contributor workflow only: either a long redundant run per task, or a contributor who reads only `AGENTS.md` believing the layer file is stale. No code impact.
9. **Root cause:** `AGENTS.md` and the root `CLAUDE.md` were updated to the `test:changed` rule; the two layer "Before you finish" lists were not.
10. **Recommended correction:** Change both layer lists to `npm run test:changed`, with the coverage run "only when asked".
11. **Suggested remediation diff (illustrative, not applied):**
    ```diff
    --- a/backend/CLAUDE.md
    +++ b/backend/CLAUDE.md
    @@
    -2. `TZ=UTC npm run test:unit -- --coverage` (and `npm run build && npm run test:integration` when a query, an entity, a migration or an RLS context changed)
    +2. `npm run test:changed` (the coverage gate is CI's; run `TZ=UTC npm run test:unit -- --coverage` only when asked), and `npm run build && npm run test:integration` when a query, an entity, a migration or an RLS context changed
    --- a/frontend/CLAUDE.md
    +++ b/frontend/CLAUDE.md
    @@
    -2. `npm run test:cov` (CI runs the coverage thresholds, not a bare `npm run test`)
    +2. `npm run test:changed` (CI runs `test:cov` and its thresholds; run it locally only when asked)
    ```
12. **Recommended regression test:** Extend `test-changed.guard.spec.ts` to scan every `CLAUDE.md` "Before you finish" block and fail on `--coverage` or `test:cov` there.
13. **Suggested regression-test diff:** incomplete. The guard's present scope was not read in full; the missing information is whether it already reads the layer files. The decision is the maintainer's: a scanning guard, or a single sentence in `AGENTS.md` that layer files never restate the gate.
14. **Verification method:** `instruction-files.spec.ts` (size ceilings) after the edit; the extended guard fails on the current text.
15. **Residual risks:** None material.


### A26-L04 - `.claude/settings.json` pre-approves `npm install*`, an action `AGENTS.md` lists under "Ask first"

- **Canonical severity:** LOW. kept LOW.
- **Absorbs:** A26-S01-04 (primary, 01-baseline.md, session severity LOW).
- **Invariants and prior findings named:** none in the index (see field 4 of each member).
- **Lens:** docs.

#### A26-S01-04 (primary) - `.claude/settings.json` pre-approves `npm install*`, an action `AGENTS.md` lists under "Ask first"

1. **Severity:** LOW
2. **Confidence:** high
3. **Location:** `.claude/settings.json` (`"Bash(npm install*)"`, also `"Bash(git add*)"`, `"Bash(git checkout -b*)"`). Secondary: root `CLAUDE.md` ("`.claude/settings.json` pre-approves lint, type-check, unit tests, the repo-level check scripts and read-only git. Ask before anything `AGENTS.md` lists under 'Ask first'"); `AGENTS.md` "Ask first: ... adding or upgrading a dependency" and "Do not change these casually: ... any `package-lock.json` (only as the product of an agreed dependency change)".
4. **Violated invariant:** S01-I1 (the permission layer matches the instruction layer). Causality: `PRE_EXISTING_UNREPORTED`.
5. **Reproduction:** A Claude Code agent asked to fix a build runs `npm install some-package` in `backend/`; the harness does not prompt, because the allow-list matches; `package.json` and `package-lock.json` change without the maintainer's agreement.
6. **Observed:** The machine-held permission layer allows, silently, what the prose layer forbids without asking. The root `CLAUDE.md` describes the allow-list as covering checks and "read-only git", which `npm install*`, `git add*` and `git checkout -b*` are not (the last two are permitted by `AGENTS.md` "Autonomous work" and are not a contradiction in effect).
7. **Expected:** The allow-list holds `npm ci*` (lock-file faithful) and not `npm install*`, or the root `CLAUDE.md` names the exception.
8. **Impact:** Process: a dependency change bypasses "Ask first". The pull-request review is still a backstop.
9. **Root cause:** `npm install` was allowed beside `npm ci` for convenience; the allow-list is not checked against `AGENTS.md`.
10. **Recommended correction:** Drop `Bash(npm install*)`; describe the list accurately in the root `CLAUDE.md`.
11. **Suggested remediation diff (illustrative, not applied):**
    ```diff
    --- a/.claude/settings.json
    +++ b/.claude/settings.json
    @@
           "Bash(npm ci*)",
    -      "Bash(npm install*)",
    --- a/CLAUDE.md
    +++ b/CLAUDE.md
    @@
    -- **Run the safe local actions yourself**: `.claude/settings.json` pre-approves lint, type-check, unit tests, the repo-level check scripts and read-only git.
    +- **Run the safe local actions yourself**: `.claude/settings.json` pre-approves `npm ci`, lint, type-check, unit tests, the repo-level check scripts, read-only git, staging and creating a branch.
    ```
12. **Recommended regression test:** A guard that reads `.claude/settings.json` and fails on an allow entry matching `npm install`, `npm i `, `npm update`, `git push`, `git reset`, `git rebase`.
13. **Suggested regression-test diff (illustrative, not applied):**
    ```diff
    --- a/backend/src/common/instruction-files.spec.ts
    +++ b/backend/src/common/instruction-files.spec.ts
    @@
    +  it("the Claude Code allow-list pre-approves nothing AGENTS.md lists under Ask first", () => {
    +    const s = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, ".claude/settings.json"), "utf8"));
    +    const allow: string[] = s.permissions?.allow ?? [];
    +    for (const a of allow) expect(a).not.toMatch(/npm (install|i |update|uninstall)|git (push|reset|rebase|branch -[dD])/);
    +  });
    ```
14. **Verification method:** The new case fails on the baseline file and passes after removal.
15. **Residual risks:** `npm run lint*` in `backend/` rewrites files (`--fix`, A26-S01-01); that is a local write the allow-list also permits, and is benign.


### A26-L05 - `fx-fallback.guard.spec.ts` cannot see a camelCase rate fallback

- **Canonical severity:** LOW. kept LOW.
- **Absorbs:** A26-S02-11 (primary, 02-prior-high-triage.md, session severity LOW).
- **Invariants and prior findings named:** INV-FX-001.
- **Lens:** test.

#### A26-S02-11 (primary) - `fx-fallback.guard.spec.ts` cannot see a rate variable whose name does not start with "rate"; a rate-1 fallback in the portfolio resolver goes undetected

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


### A26-L06 - `JwtStrategy` accepts every `JWT_SECRET`-signed token except `2fa_pending` as an access token

- **Canonical severity:** LOW. kept LOW.
- **Absorbs:** A26-S03-03 (primary, 03-security-auth.md, session severity LOW).
- **Invariants and prior findings named:** none in the index (see field 4 of each member).
- **Lens:** security.

#### A26-S03-03 (primary) - `JwtStrategy` accepts every `JWT_SECRET`-signed token except `2fa_pending` as an access token

1. **Severity:** LOW
2. **Confidence:** high (static; every verifier read)
3. **Location:** `backend/src/auth/strategies/jwt.strategy.ts` `validate()` (deny-lists only `type === "2fa_pending"`); mint sites `backend/src/auth/step-up/step-up.service.ts:210-214` (`type: "step_up"`, 5 min, returned in the JSON body), `backend/src/auth/oidc/oidc-reauth.service.ts:277-284` (pending marker, `oidc_reauth_pending`) and `:362` (artifact, `oidc_reauth`, delivered in the URL fragment `#reauth_token=` by `auth.controller.ts:668-678`), all HS256 with `JWT_SECRET` and `sub = userId`. Same deny-list shape at `delegation/guards/account-delegate.guard.ts:104-111` and `oauth/oauth-interaction.controller.ts:382-388`.
4. **Violated invariant:** a credential minted for one verifier is not accepted by another (purpose binding, hint line).
5. **Reproduction:** a signed-in user obtains a step-up token (`POST /auth/step-up`) or completes an OIDC re-auth; the token is readable by page script. Sending it as `Authorization: Bearer <token>` to any `AuthGuard('jwt')` route passes `JwtStrategy.validate` (no `type` check beyond `2fa_pending`), so it acts as a 5-minute access token. Bearer-header requests are outside the cookie/CSRF path.
6. **Observed:** the access-token payload has no `type`, and validation accepts any payload whose `sub` resolves to an active user.
7. **Expected:** access tokens carry a positive type (`type: "access"`) and `JwtStrategy` accepts only that type (an allowlist); the other verifiers check their own positive type, as `StepUpGuard` and `two-factor.service.ts` already do.
8. **Impact:** narrow. The token belongs to the same user who requested it, so there is no cross-user escalation. It converts a script-readable step-up or re-auth artifact into a bearer access credential usable off-origin for up to 5 minutes, which an XSS could otherwise not obtain (the access and refresh tokens are httpOnly cookies).
9. **Root cause:** one HS256 secret for several token types with deny-list typing.
10. **Recommended correction:** add `type: "access"` to the two access-token mint sites, accept only that type in `JwtStrategy`, `AccountDelegateGuard` and `resolveCookieUser`, with a one-release grace for type-less tokens (15-minute lifetime makes the grace short).
11. **Suggested remediation diff (illustrative, not applied):**
    ```diff
    --- a/backend/src/auth/token.service.ts
    +++ b/backend/src/auth/token.service.ts
    @@ generateTokenPair / refreshTokens
         const payload: Record<string, unknown> = {
           sub: user.id,
    +      type: "access",
    --- a/backend/src/auth/strategies/jwt.strategy.ts
    +++ b/backend/src/auth/strategies/jwt.strategy.ts
    @@ async validate(payload: any) {
    -    if (payload.type === "2fa_pending") {
    +    // Allowlist: an access token is typed "access"; a type-less token is a
    +    // pre-upgrade access token (<= 15 min old) and is accepted until the next release.
    +    if (payload.type !== undefined && payload.type !== "access") {
           throw new UnauthorizedException(
    ```
    Still to verify: every test fixture that signs an access token without `type`; the MCP/OAuth bearer paths, which use their own verifiers.
12. **Recommended regression test:** `jwt.strategy.spec.ts`: `validate({ sub, type: "step_up" })`, `oidc_reauth` and `oidc_reauth_pending` all reject.
13. **Suggested regression-test diff (illustrative, not applied):**
    ```diff
    +it.each(["step_up", "oidc_reauth", "oidc_reauth_pending", "2fa_pending"])(
    +  "refuses a %s token as an access token", async (type) => {
    +    await expect(strategy.validate({ sub: "u1", type })).rejects.toThrow(UnauthorizedException);
    +  });
    ```
14. **Verification method:** the unit test; an HTTP-level check that a step-up token in `Authorization` gets 401.
15. **Residual risks:** separate secrets per token type would be stronger; not proposed here.

- **Causality class:** `PRE_EXISTING_UNREPORTED` for the step-up token; `NEW_SINCE_UPSTREAM_AUDIT` for the OIDC re-auth artifact and marker (INV-AUTH-003 machinery postdates `d5cea9bf`).


### A26-L07 - Admin and owner-of-delegate password resets revoke PATs and trusted devices in a separate transaction from the password write

- **Canonical severity:** LOW. kept LOW.
- **Absorbs:** A26-S03-05 (primary, 03-security-auth.md, session severity LOW).
- **Invariants and prior findings named:** INV-AUTH-005.
- **Lens:** security.

#### A26-S03-05 (primary) - Admin and owner-of-delegate password resets revoke PATs and trusted devices in a separate transaction from the password write

1. **Severity:** LOW
2. **Confidence:** high (static)
3. **Location:** `backend/src/admin/admin.service.ts:603-609` (`save(targetUser)` in one `withScopedDb`, then `revokeSessionsAndTokens` at `:723-731` in another; same split at `:445` and `:505`); `backend/src/delegation/delegation.service.ts:1512-1538` (`repo.save(delegate)` in one `systemScoped` call, `revokeStandingCredentials` in the next).
4. **Violated invariant:** INV-AUTH-005, whose stated mechanism is that `revokeStandingCredentials` "revokes PATs and deletes trusted devices inside the password write's own withScopedDb transaction, so a refused reset revokes nothing and a committed one leaves neither live". The user, email-reset, OIDC-link and emergency-claim paths do this; these two do not.
5. **Reproduction:** an administrator resets a user's password (or an owner resets a delegate-only user's password); the password write commits; the second transaction fails (connection loss, statement timeout, deploy). The new password is live and the old password's PATs and trusted devices are too. The caller gets a 500.
6. **Observed:** two commits where the contract promises one.
7. **Expected:** password, PATs and trusted devices change in one transaction; refresh families and OAuth grants after the commit, as elsewhere.
8. **Impact:** narrow: it needs a failure in a millisecond window, and the admin sees an error. When it happens the credentials the reset existed to end keep working with no log line naming them (the admin path has no equivalent of the claim controller's account-naming error log).
9. **Root cause:** `revokeSessionsAndTokens` bundles the in-transaction half and the refresh-token half, so callers invoke it after their own write's transaction instead of passing their manager.
10. **Recommended correction:** take the manager: call `revokeStandingCredentials(manager, id)` inside the `save`'s transaction; keep the refresh-token and OAuth halves after the commit.
11. **Suggested remediation diff (illustrative, not applied):**
    ```diff
    --- a/backend/src/admin/admin.service.ts
    +++ b/backend/src/admin/admin.service.ts
    @@ resetUserPasswordWithinContext
    -    await withScopedDb(this.dataSource, (manager) =>
    -      manager.getRepository(User).save(targetUser),
    -    );
    +    await withScopedDb(this.dataSource, async (manager) => {
    +      await manager.getRepository(User).save(targetUser);
    +      await revokeStandingCredentials(manager, targetUserId);
    +    });
    --- a/backend/src/delegation/delegation.service.ts
    +++ b/backend/src/delegation/delegation.service.ts
    @@ resetDelegatePassword
    -    await this.systemScoped(User, (repo) => repo.save(delegate));
    -    await this.systemScoped(RefreshToken, async (repo) => {
    -      await repo.update({ userId: delegate.id, isRevoked: false }, { isRevoked: true });
    -      await revokeStandingCredentials(repo.manager, delegate.id);
    -    });
    +    await this.systemScoped(User, async (repo) => {
    +      await repo.save(delegate);
    +      await revokeStandingCredentials(repo.manager, delegate.id);
    +      await repo.manager.getRepository(RefreshToken).update(
    +        { userId: delegate.id, isRevoked: false }, { isRevoked: true });
    +    });
    ```
    `revokeSessionsAndTokens` then drops its `revokeStandingCredentials` call for the reset path only (the disable/delete paths at `:445` and `:505` should be checked the same way). Still to verify: `admin.service.spec.ts`, `delegation.service.spec.ts`, and that a refusal after the `save` now rolls the revocation back too.
12. **Recommended regression test:** a failpoint test in the style of `logout-revoke-failpoint.integration.spec.ts`: a `BEFORE UPDATE` trigger on `personal_access_tokens` that raises; assert the reset rejects and the password hash is unchanged.
13. **Suggested regression-test diff:** as described; not drafted further this session.
14. **Verification method:** that failpoint test for both paths.
15. **Residual risks:** the delegate path's whole-entity `save(delegate)` is also an instance of D-S03-01.

- **Causality class:** `PRE_EXISTING_UNREPORTED` (INV-AUTH-005 postdates the upstream audit; these two paths were not brought into line with its mechanism).


### A26-L08 - Per-user TOTP and step-up attempt budgets are enforced by peek-then-verify

- **Canonical severity:** LOW. kept LOW.
- **Absorbs:** A26-S03-06 (primary, 03-security-auth.md, session severity LOW).
- **Invariants and prior findings named:** none in the index (see field 4 of each member).
- **Lens:** security.

#### A26-S03-06 (primary) - Per-user TOTP and step-up attempt budgets are enforced by peek-then-verify, so concurrent guesses exceed the cap

1. **Severity:** LOW
2. **Confidence:** medium (static; not executed)
3. **Location:** `backend/src/auth/two-factor.service.ts:237-245` (per-token peek), `:274` and `:414-420` (`userTotpBudgetSpent` peek), `:430` (increment after the failed check); `backend/src/auth/step-up/step-up.service.ts` `verifyAndIssue` (peek at the top, `recordFailure` after bcrypt/TOTP).
4. **Violated invariant:** the per-user budget "keyed by user rather than by client address, so no forwarded header moves it" (comment at `two-factor.service.ts:405-413`) bounds how many codes are checked per window. The increment is atomic (`AuthAttemptCounterService.increment`), but the decision to check a code is taken on a value read before any of the concurrent failures are counted.
5. **Reproduction:** an attacker who has the password (2FA login) or a stolen session (step-up) sends K requests at once, each with a different code, from K client addresses so the per-IP `@Throttle` (5 per 15 minutes on `/auth/2fa/verify`, 10 per minute on `/auth/step-up`) does not bind. All K `peek` calls read the same count below `MAX_USER_2FA_ATTEMPTS` / `MAX_ATTEMPTS = 10`, so all K codes are checked; the counter afterwards equals K and the lock follows, but K guesses were evaluated instead of at most the cap.
6. **Observed:** cap enforced only for sequential attempts.
7. **Expected:** reserve an attempt before checking the code (`increment` first, compare the returned count with the cap, then refund on success via `reset`), the same "decide from what the database committed" rule `recordFailedLogin` follows.
8. **Impact:** narrows the second-factor guessing budget only by the attacker's address count; a 6-digit TOTP with replay protection (`claimTotpCode`) keeps the per-burst success probability at K / 10^6 (or K * 3 / 10^6 with a ±1 step window). Low.
9. **Root cause:** read-then-act on a counter whose write is atomic.
10. **Recommended correction:** increment-then-check.
11. **Suggested remediation diff (illustrative, not applied):**
    ```diff
    --- a/backend/src/auth/step-up/step-up.service.ts
    +++ b/backend/src/auth/step-up/step-up.service.ts
    @@ verifyAndIssue
    -    const attempts = await this.attemptCounters.peek(STEP_UP_ATTEMPT_SCOPE, attemptKey);
    -    if (attempts >= this.MAX_ATTEMPTS) {
    +    // Reserve the attempt first: the count we compare is the one the database committed.
    +    const { count } = await this.attemptCounters.increment(
    +      STEP_UP_ATTEMPT_SCOPE, attemptKey, this.LOCKOUT_WINDOW_MS, "sliding");
    +    if (count > this.MAX_ATTEMPTS) {
    @@
    -    if (!verified) {
    -      await this.recordFailure(attemptKey);
    +    if (!verified) {
    ```
    The success path keeps its `reset`. Same shape for `userTotpBudgetSpent` / `recordUserTotpFailure`. Still to verify: `step-up.service.spec.ts`, `two-factor.service.spec.ts`, and that a correct code after nine failures still passes (`count` 10 is not `> 10`).
12. **Recommended regression test:** integration: 20 concurrent wrong codes against one user; assert at most `MAX` reached the verifier (spy on `verifyTotpForUser` call count, real counter table).
13. **Suggested regression-test diff:** not drafted this session.
14. **Verification method:** that test.
15. **Residual risks:** none beyond the throttler's own per-address semantics.

- **Causality class:** `PRE_EXISTING_UNREPORTED` (MON-M24 covered the login counter only).


### A26-L09 - `20260908120000_remove_notification_browser.sql` drops a column the previous release still selects

- **Canonical severity:** LOW. kept LOW.
- **Absorbs:** A26-S05-02 (primary, 05-migrations-schema.md, session severity LOW).
- **Invariants and prior findings named:** none in the index (see field 4 of each member).
- **Lens:** data.

#### A26-S05-02 (primary) - `20260908120000_remove_notification_browser.sql` drops a column the previous release still selects

1. **Severity:** LOW
2. **Confidence:** high
3. **Location:** `database/migrations/20260908120000_remove_notification_browser.sql:5`; commit `8e2f78bc5` (2026-09-06) removed the entity property and added the `DROP COLUMN` in one change (the file was later renamed from `188_` to its timestamp); 1.15.1 (`f20c561f6`) `backend/src/users/entities/user-preference.entity.ts:49-50` maps `notification_browser`.
4. **Violated invariant:** S05-C, `docs/database-migrations.md` "Two versions of the code run against one database during a rollout": `DROP COLUMN` is forbidden in the release that stops writing the column.
5. **Realistic reproduction scenario:** An install on 1.15.x upgrades to any release from 1.16.0 to 1.19.0 with the chart's default `RollingUpdate` (`maxSurge: 1`, `maxUnavailable: 0`). The new pod runs `db-migrate` and commits the drop while the 1.15.x pod still serves. Every TypeORM read of `UserPreference` on the old pod selects `"UserPreference"."notification_browser"`. Executed on the `schema.sql` database: `SELECT "UserPreference"."notification_browser" FROM user_preferences "UserPreference"` fails `column UserPreference.notification_browser does not exist`.
6. **Observed implementation behavior:** contract shipped in the same release as the writer's removal.
7. **Expected behavior:** 1.16.0 stops mapping the column; a later release drops it.
8. **Impact:** availability for the length of the rollout (every request on the old pod that reads preferences fails), longer if the new pod's readiness stalls with both generations live. Self-heals when the old pod is gone. No data loss (the column was dormant).
9. **Root cause:** no guard for expand/contract; the documentation says so ("the only thing that catches a contract shipped too early is somebody asking").
10. **Recommended correction:** the migration is merged and shipped, so it is never edited. Release notes for upgrades from 1.15.x or earlier should name the transient failure, or say to upgrade through 1.15.x -> 1.16.x with a `Recreate` rollout. For the future, a lint rule: a migration whose body contains `DROP COLUMN`, `RENAME`, `SET NOT NULL`, or a narrowing `ALTER TYPE` on a table that exists in the previous release's `schema.sql` must name, in a marked comment, the release in which the writer stopped, and `migration-lint.mjs` refuses one that does not.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/scripts/migration-lint.mjs
+++ b/backend/scripts/migration-lint.mjs
@@
+// contract-without-expand: DROP COLUMN / RENAME / SET NOT NULL must carry
+//   -- contract-after: <version>
+// naming the release that stopped using the old shape.
+const CONTRACT = /\b(DROP\s+COLUMN|RENAME\s+(COLUMN|TO)|SET\s+NOT\s+NULL)\b/i;
+if (CONTRACT.test(body) && !/^--\s*contract-after:\s*\d+\.\d+\.\d+/m.test(raw)) {
+  report(file, "contract-without-expand", "a contract statement needs -- contract-after: <version>");
+}
```

12. **Recommended regression test:** a `migration-lint` self-test fixture with a bare `DROP COLUMN` that must be refused, and one with the marker that passes.
13. **Suggested regression-test diff (illustrative, not applied):** one fixture pair under `backend/scripts/migration-lint.test.mjs` asserting the rule id `contract-without-expand`.
14. **Verification method:** `npm run migration:lint:test && npm run migration:lint` (the existing migrations need markers or a grandfather list).
15. **Residual risks / patch limitations:** a marker is a claim, not a proof; only a test that runs the previous release's image against the new schema proves it.

Causality: `NEW_SINCE_UPSTREAM_AUDIT`. It is the only contract-in-one-step among the 56: the other drops (`provider_missing_*` in `20260920163144`) remove columns no release ever shipped; the type change in `20260908130000` and the `NOT NULL`/constraint drop in `20260912200152` act on objects created in the same release.


### A26-L10 - Restore staging writes external attachment objects without an upload intent (MON-M22 residual)

- **Canonical severity:** LOW. kept LOW.
- **Absorbs:** A26-S06-03 (primary, 06-backup-restore.md, session severity LOW).
- **Invariants and prior findings named:** INV-ATTACHMENT-001, MON-M22.
- **Lens:** data.

#### A26-S06-03 (primary) - Restore staging writes external attachment objects without an upload intent; a process death or a failed discard leaves bytes nothing can find (MON-M22 residual)

1. **Severity:** LOW
2. **Confidence:** high (executed: R4 on local and S3)
3. **Location:** `backend/src/backup/backup-attachment-transfer.service.ts:503-529` (`tryStageAttachmentObject`, a bare `attachmentStorage.save`), `:532-542` (`discardStagedAttachmentObjects`, failures only logged); `backend/src/backup/backup-restore.service.ts:244-283, 438-448`. Contrast `backend/src/attachments/attachments.service.ts` create path (intent committed before the put).
4. **Violated invariant:** INV-ATTACHMENT-001 "no bytes exist without metadata", eventually, which the create path achieves through an upload-intent tombstone the sweeper can enumerate.
5. **Realistic reproduction scenario:** a restore of an artifact carrying attachments on a `local` or `s3` deployment; the pod is killed (OOM, rollout) after staging and before the commit, or the commit fails and the discard `DeleteObject` fails transiently.
6. **Observed:** R4 (injected failure in `restoreDeferredFkColumns`, discard suppressed to model process death): both staged keys hold bytes, no `transaction_attachments` row names them, and `attachment_blob_tombstones` gained 0 rows. The sweeper works only from tombstones, so the objects are permanent.
7. **Expected:** staging follows the create path's protocol: an intent tombstone per staged key committed before the put, cleared inside the restore transaction (or left for the sweeper on any failure).
8. **Impact:** storage leak of copies of the user's own receipts in the volume or bucket, outside any metadata, surviving later account deletion. No exposure to another tenant; no incorrect figure.
9. **Root cause:** the restore was given its own object-write path instead of reusing the intent/compensation protocol of INV-ATTACHMENT-001.
10. **Recommended correction:** write `attachment_blob_tombstones` intents (`upload_lease_expires_at` set) for the staged keys in a short transaction before staging; in the restore transaction, clear them fenced on `swept_at IS NULL` exactly as `AttachmentsService.create` does; on failure leave them.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/backup/backup-attachment-transfer.service.ts
+++ b/backend/src/backup/backup-attachment-transfer.service.ts
   private async tryStageAttachmentObject(key: string, bytes: Buffer): Promise<boolean> {
     try {
+      // Same protocol as AttachmentsService.create: the intent outlives the
+      // process, so a death before the commit leaves a key the sweeper finds.
+      await this.objectIntents.record(this.attachmentStorage.name, key);
       await this.attachmentStorage.save(key, bytes);
       return true;
--- a/backend/src/backup/backup-restore.service.ts
+++ b/backend/src/backup/backup-restore.service.ts
                 await clearForeignSeriesOfUser(manager, userId);
+                await this.attachments.clearStagingIntents(manager, stagedKeys);
```

   (`objectIntents` stands for the helper in `attachments/storage/object-intent.ts`; its exact API was not read in this session.)
12. **Recommended regression test:** R4 of the scratch spec, asserting the tombstone count rises by the number of staged keys and the sweeper then removes them.
13. **Suggested regression-test diff:** R4 in `<scratchpad>/s06-roundtrip.integration.spec.ts`, with `expect(await tombstones()).toBe(before + staged.length)`.
14. **Verification method:** the integration case on `local` with a real tmpdir, then one sweeper pass.
15. **Residual risks / patch limitations:** the intent must not be swept while a long restore is still staging; the lease length has to cover the gate's queue time.

Causality: `PRIOR_REPORTED`, `CONFIRMED_WITH_DIFFERENT_ROOT_CAUSE` (MON-M22: the upload and delete paths are fixed; the restore staging path is the remaining uncoupled writer).


### A26-L11 - A restore applies no semantic backfill to rows from an older artifact (`skip_price_updates`)

- **Canonical severity:** LOW. kept LOW; A26-S05-03 is the migration face that S06 carried.
- **Absorbs:** A26-S06-04 (primary, 06-backup-restore.md, session severity LOW); A26-S05-03 (superseded, 05-migrations-schema.md, session severity LOW).
- **Invariants and prior findings named:** none in the index (see field 4 of each member).
- **Lens:** data.

#### A26-S06-04 (primary) - A restore applies no semantic backfill to rows from an older artifact (`skip_price_updates`; carries A26-S05-03)

1. **Severity:** LOW
2. **Confidence:** medium (static; LOW does not require execution)
3. **Location:** `database/migrations/20261012131846_securities_skip_price_updates_user_switch.sql` (one-time `UPDATE`); `backend/src/backup/backup-format.ts:13` (`BACKUP_VERSION = 1`, compared for equality at `backup-restore.service.ts:720`); no reference to `skip_price_updates` anywhere in `backend/src/backup/` except `support-backup/support-backup-rules.ts:439`.
4. **Violated invariant:** S05-D: a migration that changes what a stored value means reaches every row that will carry the old meaning.
5. **Realistic reproduction scenario:** as A26-S05-03: a 1.18 backup holding a security with `skip_price_updates = true` and a provider override, restored on 1.19.
6. **Observed:** the row is inserted as stored; the security never refreshes under 1.19 semantics.
7. **Expected:** the restore normalizes rows from artifacts older than the change.
8. **Impact:** stale prices for the affected securities until the user flips the switch; visible in the UI; no money moves.
9. **Root cause:** the artifact carries no producing release or schema marker, so the restore cannot tell an old meaning from a deliberate new value; every future semantic backfill has the same gap.
10. **Recommended correction:** add `producedBy` (application version or the newest applied migration name) to the envelope, and a restore-side table of normalizations keyed by the migration that introduced them; apply `skip_price_updates` normalization when the artifact predates `20261012131846` or carries no marker.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/backup/backup-restore-database.service.ts
+++ b/backend/src/backup/backup-restore-database.service.ts
+  /** Semantic backfills a restored row must pass through, keyed by migration. */
+  async applyLegacyNormalizations(m: EntityManager, userId: string, producedBy: string | null) {
+    if (producedBy === null || producedBy < "20261012131846") {
+      await m.query(
+        `UPDATE securities SET skip_price_updates = false
+          WHERE user_id = $1 AND skip_price_updates
+            AND (quote_provider IS NOT NULL OR msn_instrument_id IS NOT NULL)`,
+        [userId],
+      );
+    }
+  }
```

12. **Recommended regression test:** restore a fixture without `producedBy` holding `{ skip_price_updates: true, quote_provider: "yahoo" }` and assert `false`; one with `producedBy` at or after the migration keeps `true`.
13. **Suggested regression-test diff:** a case in `backup-restore.integration.spec.ts` built from `seedUserData` plus one `UPDATE securities`.
14. **Verification method:** the integration case.
15. **Residual risks / patch limitations:** artifacts written by 1.19.0 itself carry no marker and would be normalized too, clearing a deliberate switch on a security with a provider; the marker has to ship before the normalization is keyed on it, or the predicate accepted as safe.

Causality: `NEW_SINCE_UPSTREAM_AUDIT`.

#### A26-S05-03 (superseded) - The `skip_price_updates` meaning change is a one-time backfill that a restore of an older backup bypasses

Superseded by the primary above: same root cause, and its scenario is one surface of the primary's reproduction. Full text: `05-migrations-schema.md` section 4.


### A26-L12 - The custom-report text filter is a second search door with unescaped LIKE wildcards (INV-SEARCH-001)

- **Canonical severity:** LOW. kept LOW.
- **Absorbs:** A26-S07-08 (primary, 07-cash-ledger.md, session severity LOW).
- **Invariants and prior findings named:** INV-SEARCH-001.
- **Lens:** financial.

#### A26-S07-08 (primary) - The custom-report text filter is a second search door with unescaped LIKE wildcards (INV-SEARCH-001)

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


### A26-L13 - Job leases are shorter than the provider calls they guard and the saves are not fenced by the lease token (AI insights, email-receipt poll)

- **Canonical severity:** LOW. kept LOW for the pair: duplicate provider work and a duplicate draft, no money moved.
- **Absorbs:** A26-S08-04 (primary, 08-scheduler-cron.md, session severity LOW); A26-S11-01 (merged surface, 11-email-receipts.md, session severity LOW).
- **Invariants and prior findings named:** INV-CRON-001, INV-RECEIPT-006, MON-M25.
- **Lens:** concurrency.

#### A26-S08-04 (primary) - The AI insight lease (15 min) is shorter than the provider call it guards (Ollama aborts at 20 min), and the save is not fenced by the lease token: a second generation runs and both sets are saved (MON-M25 residual)

1. **Severity:** LOW
2. **Confidence:** high (executed, R2)
3. **Location:** `backend/src/ai/insights/ai-insights.service.ts:52` (`INSIGHT_GENERATION_LEASE_MS = 15 min`), `:184-238` (lease, cooldown re-read), `:741-790` (`saveInsights`, no token check); `ai/providers/ollama.provider.ts:160` (20-minute abort "for CPU inference"); `ai/providers/long-running-fetch.ts` (undici timeouts disabled).
4. **Violated invariant:** INV-CRON-001 / the lease contract in `job-claim.service.ts` ("only one replica may do this now").
5. **Realistic reproduction scenario:** a self-hosted deployment on CPU inference; the 6 AM cron's generation for a user takes 16 minutes; the user presses "Generate insights" (or a second replica's request arrives) after minute 15.
6. **Observed implementation behavior (executed, the holder's lease expired by its own token while its provider call was in flight):** two provider calls, two insight rows saved for one generation window (`providerCalls: 2, rows: 2`).
7. **Expected behavior:** the second caller stands down while the first is still running; or the first's save is refused once its lease is gone.
8. **Impact:** duplicate insight cards (bounded by `MAX_INSIGHTS_PER_USER` pruning) and a second full CPU inference on the hardware the 20-minute budget exists for.
9. **Root cause:** a TTL chosen independently of the work's own upper bound, with no renewal and an unfenced final write.
10. **Recommended correction:** make the lease outlast the provider budget (derive it from the largest provider timeout plus margin), and fence the save: re-check under the lease token inside the save transaction.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/ai/insights/ai-insights.service.ts
+++ b/backend/src/ai/insights/ai-insights.service.ts
-const INSIGHT_GENERATION_LEASE_MS = 15 * 60 * 1000;
+// Longer than the slowest provider call it guards (Ollama aborts at 20 min,
+// ollama.provider.ts) plus aggregation and save, so a live generation is never
+// retaken by a second one.
+const INSIGHT_GENERATION_LEASE_MS = 25 * 60 * 1000;
@@ saveInsights
-    await withScopedDb(this.dataSource, async (manager) => {
+    await withScopedDb(this.dataSource, async (manager) => {
+      const held = await manager.query(
+        `SELECT 1 FROM job_claims
+          WHERE claim_type = $1 AND user_id = $2 AND claim_key = $3
+            AND lease_token = $4::uuid FOR UPDATE`,
+        [JobClaimType.AiInsightGeneration, userId, INSIGHT_GENERATION_CLAIM_KEY, leaseToken],
+      );
+      if (returnedRows(held).length === 0) return; // retaken: the holder saves
```

   (`saveInsights` gains the `leaseToken` parameter.) Needs: unit tests, the R2 probe as an integration case.
12. **Recommended regression test:** R2.
13. **Suggested regression-test diff (illustrative, not applied):** the R2 probe asserting `rows === 1`.
14. **Verification method:** `npm run test:unit -- ai-insights`; R2 as an integration spec.
15. **Residual risks / patch limitations:** the provider is still paid twice when the lease is outrun; only a longer TTL (or renewal) prevents the call.

Causality: `PRIOR_REPORTED`, MON-M25 residual with a different root cause (the process-local guard is gone; the lease replacing it is outrun). Related, not executed, same class (section 9): `email-receipt-poll` (10-min lease, provider steps up to the same 20-min budget), `bond-series` (`withLease` 90 min vs a worst case of hours; writes converge), `backup-offsite-retry` (outcome write not fenced by attempt).

#### A26-S11-01 (merged surface) - The receipt poll's 10-minute lease is outrun by the provider calls it starts, and the parser-draft step has no claim of its own: two polls draft the same sender twice

1. **Severity:** LOW
2. **Confidence:** high (executed, P2)
3. **Location:** `backend/src/email-receipts/poll/email-receipt-poll.service.ts:42-44` (`POLL_LEASE_MS = 10 min`, `LEASE_WORK_BUDGET_MS = 8 min`), `:355-382` (the deadline is checked only between emails and once before the AI step); `ai/email-receipt-ai.service.ts:654-685` (`runAutomaticStep`: up to 2 drafts + 3 requests, no deadline), `:687-725` (`receiptsNeedingDraft`: a plain `SELECT`, no claim), `:250-282` (the draft saved with no re-check under a lock); `pipeline/email-receipt-pipeline.service.ts:295-310, :368-397` (up to `AI_CATEGORY_CALLS_PER_POLL = 10` category calls inside the deadline loop); `ai/providers/ollama.provider.ts:160` (20-minute abort); `ai/providers/anthropic.provider.ts:299` (2-minute abort).
4. **Violated invariant:** INV-RECEIPT-006 ("two replicas, or the cron and Poll now, never read one mailbox at the same time"), and the lease contract of `job-claim.service.ts` (only one holder does the work).
5. **Realistic reproduction scenario:** a self-hosted deployment with an Ollama provider on CPU, mailbox AI mode `automatic`, a new sender with no parser. The tick's pipeline loop finishes at minute 7 and the automatic step starts the first parser-draft call, which takes 12 minutes. The lease expires at minute 10. The next 15-minute tick (another replica, or the same one once its tick ends; or the user's "Poll now") claims the lease, and its automatic step selects the same `no_parser` email, because nothing marks a draft as in flight.
6. **Observed implementation behavior (executed, P2, scratch worktree, real PostgreSQL under RLS; the holder's lease was expired by its own token during its provider call, the second poll then started):** `first.busy=false`, `second.busy=false`, `providerCalls=2`, `drafts=2` (two `draft` parsers for `newshop.example.com`). The same overlap repeats an AI category question for a `pending` email the first poll is still asking about (the second pass of the first poll then finds the row no longer `pending` and leaves it unchanged, so only the call is doubled); AI review requests are protected by `claimById` and are not doubled.
7. **Expected behavior:** the lease covers every provider call started under it, or no provider call starts once the remaining lease cannot cover it; a second poll does not draft a sender the first is drafting.
8. **Impact:** a duplicate draft parser per affected sender (it counts toward `MAX_PARSERS_PER_USER = 200` and the person must delete one), and doubled provider spend on the hardware the 20-minute timeout exists for. No ledger effect: drafts read nothing until approved, and every card still needs `confirm`.
9. **Root cause:** a lease TTL chosen independently of the provider budget it guards (the work budget is enforced between emails, not between provider calls), with no renewal API in `JobClaimService` and no claim on the per-sender draft. Same class as A26-S08-04 (AI insights lease); S23 may consolidate them under one root cause.
10. **Recommended correction:** pass the poll's deadline into the AI category question and `runAutomaticStep` and stop starting provider calls once `deadline` is passed; size `POLL_LEASE_MS` as work budget plus the largest single provider call plus margin; and make the draft save idempotent per sender (under an advisory lock on `user:domain`, skip the save when a parser covering the domain now exists).
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/email-receipts/poll/email-receipt-poll.service.ts
+++ b/backend/src/email-receipts/poll/email-receipt-poll.service.ts
-/** One poll of one mailbox holds its lease this long at most (design INV-RECEIPT-006). */
-export const POLL_LEASE_MS = 10 * 60_000;
-/** No new work is started once this much of the lease is spent. */
-const LEASE_WORK_BUDGET_MS = 8 * 60_000;
+/** No new work, provider calls included, is started once this much of the lease is spent. */
+const LEASE_WORK_BUDGET_MS = 8 * 60_000;
+/**
+ * The lease outlasts the work budget by the slowest single provider call that
+ * may start just before it ends (Ollama aborts at 20 minutes, ollama.provider.ts),
+ * so a call started under the lease never runs beside a second poll (INV-RECEIPT-006).
+ */
+export const POLL_LEASE_MS = LEASE_WORK_BUDGET_MS + 22 * 60_000;
@@ processStored
-      await this.processOne(userId, id, ["pending"], outcome, budget);
+      await this.processOne(userId, id, ["pending"], outcome, budget, deadline);
@@
     if (aiMode === "automatic" && Date.now() <= deadline) {
       try {
-        await this.ai.runAutomaticStep(userId);
+        await this.ai.runAutomaticStep(userId, { deadline });
--- a/backend/src/email-receipts/ai/email-receipt-ai.service.ts
+++ b/backend/src/email-receipts/ai/email-receipt-ai.service.ts
-  async runAutomaticStep(userId: string): Promise<AutomaticAiStepResult> {
+  async runAutomaticStep(
+    userId: string,
+    options: { deadline?: number } = {},
+  ): Promise<AutomaticAiStepResult> {
+    const timeLeft = () =>
+      options.deadline === undefined || Date.now() <= options.deadline;
@@
     for (const receiptId of drafts) {
+      if (!timeLeft()) break;
       budget--;
@@
     for (const requestId of await this.pendingRequests(userId, budget)) {
+      if (!timeLeft()) break;
       const outcome = await this.processAiRequest(userId, requestId);
@@ draftParser, inside the save transaction
       const created = await withScopedDb(this.dataSource, async (m) => {
         const repo = m.getRepository(EmailReceiptParser);
+        await acquireAdvisoryLock(
+          m,
+          LockScope.EmailReceiptParserDraft,
+          `${userId}:${receipt.fromDomain}`,
+        );
+        // A draft saved by a concurrent run for this sender since the select:
+        // that one stands, and this answer is not stored twice.
+        const covering = await coveringParser(m, userId, receipt.fromDomain);
+        if (covering) return covering;
```

   (`coveringParser` is the `receiptsNeedingDraft` `NOT EXISTS` predicate as a function; `LockScope.EmailReceiptParserDraft` is new, or reuse the `<user>:<domain>` advisory lock `requestAiDraft` already takes. The pipeline's `askCategories` gets the same deadline check.) Needs: unit tests for the deadline, P2 as an integration case, a check that `MAX_PARSERS_PER_USER` handling is unchanged.
12. **Recommended regression test:** P2 (lease expired by its holder's token during the first provider call, a second `pollMailbox`), asserting one provider call for the draft and one draft row.
13. **Suggested regression-test diff (illustrative, not applied):** the P2 probe in section 12 with its final assertions changed to `expect(calls).toBe(1); expect(drafts).toHaveLength(1);` (it now asserts `calls === 2` to record the baseline).
14. **Verification method:** `npm run test:unit -- email-receipt-poll email-receipt-ai`; P2 as `test/integration/email-receipts-poll-lease.integration.spec.ts`.
15. **Residual risks / patch limitations:** a longer lease delays recovery after a crashed holder by the same amount (30 minutes instead of 10); the deadline makes a slow provider leave work for the next tick, which the existing "a released request carries a note" path already handles. The doubled call is prevented only for calls started under one lease; a person's own "Draft with AI" beside the automatic step can still draft a sender twice (the advisory lock fences the second row, not the second call).

Causality: `NEW_SINCE_UPSTREAM_AUDIT` (the module is new). Hand-off from S08 (section 12 of `08-scheduler-cron.md`) disposed here.


### A26-L14 - A staged MNY file can still be deleted under a job that was just created (MON-L04 residual)

- **Canonical severity:** LOW. kept LOW.
- **Absorbs:** A26-S09-04 (primary, 09-import-mny.md, session severity LOW).
- **Invariants and prior findings named:** MON-L04.
- **Lens:** data.

#### A26-S09-04 (primary) - A staged file can still be deleted under a job that was just created (MON-L04 residual)

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


### A26-L15 - INV-IMPORT-003 is still unenforced on the MNY and QIF writers, and its index entry names one path of three

- **Canonical severity:** LOW. kept LOW.
- **Absorbs:** A26-S09-05 (primary, 09-import-mny.md, session severity LOW).
- **Invariants and prior findings named:** INV-IMPORT-003.
- **Lens:** docs.

#### A26-S09-05 (primary) - INV-IMPORT-003 is still unenforced on the MNY and QIF writers, and its index entry names one path of three

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


### A26-L16 - Deleting a rule leaves its open AI review requests rule-less, and they block the email-receipt review of the same transaction

- **Canonical severity:** LOW. kept LOW.
- **Absorbs:** A26-S10-04 (primary, 10-rules-banksync-csv.md, session severity LOW).
- **Invariants and prior findings named:** none in the index (see field 4 of each member).
- **Lens:** data.

#### A26-S10-04 (primary) - Deleting a rule leaves its open AI review requests rule-less, and they then block the email-receipt review of the same transaction

1. **Severity:** LOW
2. **Confidence:** high (static; the SQL is explicit)
3. **Location:** `database/schema.sql:914` (`rule_id ... ON DELETE SET NULL`); `backend/src/transaction-rules/transaction-rules.service.ts:189-222` (`remove` does not close the rule's open requests); `backend/src/ai-review/ai-review-requests.service.ts:300-308` (`NOT EXISTS ... rule_id IS NULL AND status IN open`, no `kind`); `backend/src/email-receipts/pipeline/receipt-candidates.ts:115` (same predicate when choosing candidate transactions).
4. **Violated invariant:** a receipt review is refused only by another open receipt review of that transaction (`ai-review-requests.service.ts:239`, "never a second one").
5. **Reproduction:** rule R (`request_ai_review`) queues a `transaction_review` on T (`rule_id = R`, pending, 30-day expiry). The user deletes R; the request becomes `rule_id NULL`, still pending. A receipt email for T arrives.
6. **Observed:** the insert's `NOT EXISTS` sees the orphaned request as an open receipt review; the receipt ends `review_conflict` (or T is dropped from the candidates), for up to 30 days; the orphaned request is still offered to the AI reviewer although its rule is gone.
7. **Expected:** the receipt is queued; a deleted rule's open requests are expired with it.
8. **Impact:** a receipt is not attached automatically; the user resolves a conflict that has no visible cause.
9. **Root cause:** `rule_id IS NULL` is used as "receipt request", which stopped being true when `ON DELETE SET NULL` was chosen.
10. **Recommended correction:** expire the rule's open requests in `remove`, and key the dedupe on `kind`.
11. **Suggested remediation diff (illustrative, not applied)**

```diff
--- a/backend/src/transaction-rules/transaction-rules.service.ts
+++ b/backend/src/transaction-rules/transaction-rules.service.ts
@@ async remove(
+      // Its open review requests go with it; left behind they would read as
+      // rule-less (ON DELETE SET NULL) receipt reviews.
+      await m.query(
+        `UPDATE ai_review_requests
+            SET status = 'expired', updated_at = CURRENT_TIMESTAMP
+          WHERE user_id = $1 AND rule_id = $2
+            AND status IN ('pending', 'claimed', 'proposed')`,
+        [userId, id],
+      );
       const result = await m
         .getRepository(TransactionRule)
         .delete({ id, userId });
--- a/backend/src/ai-review/ai-review-requests.service.ts
+++ b/backend/src/ai-review/ai-review-requests.service.ts
                    WHERE open_request.user_id = $1::uuid
                      AND open_request.transaction_id = $2::uuid
-                     AND open_request.rule_id IS NULL
+                     AND open_request.kind = 'email_receipt'
```

   and the same `kind` predicate in `receipt-candidates.ts:115`.
12. **Recommended regression test:** integration: queue a rule review, delete the rule, enqueue a receipt review for the same transaction, expect a row.
13. **Suggested regression-test diff:** a case in `backend/test/integration/transaction-rules.integration.spec.ts` asserting the request's status is `expired` after `rules.remove` and that `enqueueForReceipt` returns a request.
14. **Verification:** `npm run test:integration -- "transaction-rules|email-receipt"`.
15. **Residual risks:** a request already rule-less in a deployed database needs the same `UPDATE` once (a data migration, not shown).

Causality: `NEW_SINCE_UPSTREAM_AUDIT` (AI review requests and receipts are new). Shared with S11 (receipt surface).


### A26-L17 - A trade email that states only a price books a total derived from the price rounded to 4 decimals (INV-TRADE-001)

- **Canonical severity:** LOW. kept LOW.
- **Absorbs:** A26-S11-02 (primary, 11-email-receipts.md, session severity LOW).
- **Invariants and prior findings named:** INV-TRADE-001.
- **Lens:** financial.

#### A26-S11-02 (primary) - A trade email that states only a price books a total derived from that price rounded to 4 decimals, not from the price as written

1. **Severity:** LOW
2. **Confidence:** high (executed, P1)
3. **Location:** `backend/src/email-receipts/parsing/parse-trade.ts:35-36` (price read to 8 decimals, "stored to 4 for the card"), `:424-436` (`price.value = (units8 + 5_000) / 10_000`), `:559-571` (`tradeExecutedTotalUnits` multiplies `trade.price`, the 4-decimal value); `pipeline/email-receipt-trade.service.ts:177-185` (`toInput` signs that total on the card); the preview derives the stored price from it (`securities/investment-amount.util.ts`).
4. **Violated invariant:** INV-TRADE-001 ("a caller that supplies only a price has the total derived from the price"; the price column holds 10 decimals) and the hint's executed-total rule: the email's own figure, not a rounded one, is the fact.
5. **Realistic reproduction scenario:** a fund or fractional-share confirmation that states units and a NAV with 5 to 8 decimals and no total (the profile's `total` field reads nothing), parsed by an approved trade profile; the person approves the card as shown.
6. **Observed implementation behavior (executed, P1, the Wealthsimple fixture with the total line removed):**

   | Shares | Price written | Price kept | Total proposed | Exact | Difference |
   | --- | --- | --- | --- | --- | --- |
   | 10 000 | 1.23456789 | 1.2346 | 12 346.0000 | 12 345.6789 | +0.3211 (0.0026 %) |
   | 1 000 | 26.320125 | 26.3201 | 26 320.1000 | 26 320.1250 | -0.0250 |
   | 75.9878 | 26.32005 | 26.3201 | 2 000.0065 | 2 000.0019 | +0.0046 |

7. **Expected behavior:** 12 345.6789, 26 320.1250 and 2 000.0019 (`quantity * price` from the 1e-8 units already read, rounded once to money precision), and the stored price is the price written.
8. **Impact:** the investment transaction's cost basis and the cash it moves are off by up to `quantity * 0.00005` (0.32 on a 12 346 purchase in the example); the card shows the wrong figure as the fact. The auto-apply gate never books such a reading by itself (`tradeMayAutoApply` is false for a share-moving action that cannot be cross-checked), so a person approves it; the error is small enough not to be noticed.
9. **Root cause:** the card's 4-decimal price (a display and storage rounding) is reused as the input of the total, instead of the exact `units8` the reader already holds.
10. **Recommended correction:** keep `priceUnits8` on `ParsedTrade` (or compute the total in `parseTradeLinesTraced`, where `units8` is in scope) and derive the total from it; keep `price` as the 4-decimal display value.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/email-receipts/parsing/parse-trade.ts
+++ b/backend/src/email-receipts/parsing/parse-trade.ts
@@ parseTradeLinesTraced
   const read: ParsedTrade = {
@@
     price: price?.value ?? null,
+    // The price as written, in 1e-8 units: the total a price-only email
+    // implies is derived from this, never from the 4-decimal `price`.
+    priceUnits8: price ? price.units8.toString() : null,
@@ export function tradeExecutedTotalUnits(trade: ParsedTrade): number | null {
   if (trade.total !== null) return trade.total;
   if (trade.price === null || trade.quantity === null) return null;
   const quantity8 = BigInt(Math.round(trade.quantity * 1e8));
-  const gross =
-    (quantity8 * BigInt(trade.price) + 50_000_000n) / QUANTITY_UNITS;
+  // quantity (1e-8) * price (1e-8) = 1e-16; money is 1e-4: divide by 1e12, half up.
+  const gross =
+    trade.priceUnits8 !== undefined && trade.priceUnits8 !== null
+      ? (quantity8 * BigInt(trade.priceUnits8) + 500_000_000_000n) /
+        1_000_000_000_000n
+      : (quantity8 * BigInt(trade.price) + 50_000_000n) / QUANTITY_UNITS;
--- a/backend/src/email-receipts/parsing/receipt-parser.types.ts
+++ b/backend/src/email-receipts/parsing/receipt-parser.types.ts
   price: number | null;
+  /** The price as written, in 1e-8 units (a decimal string); absent on a reading stored before it existed. */
+  priceUnits8?: string | null;
```

   (`trade` is stored as JSON on `email_receipts.trade`; a stored reading without `priceUnits8` keeps today's arithmetic. The card's price passed to the preview should be the same exact value so `resolveInvestmentAmounts` derives the 10-decimal price from the total.) Needs: unit tests, the preview/commit parity check in `ai-review-work.service.spec.ts`, a numerical case per row above.
12. **Recommended regression test:** P1's three rows in `parse-trade.spec.ts`, asserting the totals 123 456 789 / 263 201 250 / 20 000 019 (1/10000 units).
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
--- a/backend/src/email-receipts/parsing/parse-trade.spec.ts
+++ b/backend/src/email-receipts/parsing/parse-trade.spec.ts
+  it("derives a price-only total from the price as written, not the 4-decimal one", () => {
+    const body = WEALTHSIMPLE_BUY_BODY.replace("Total cost: $2,000.00\n", "")
+      .replace("$26.32", "$1.23456789")
+      .replace("Shares: 75.9878", "Shares: 10000");
+    const parsed = parseTradeLines(trade, lines(body));
+    expect(tradeExecutedTotalUnits(parsed)).toBe(123_456_789); // 12 345.6789
+  });
```

14. **Verification method:** `npm run test:unit -- parse-trade email-receipt-trade ai-review-work`.
15. **Residual risks / patch limitations:** the cross-check `tradeIsConsistent` already uses `units8`, so it is unaffected; a total stated in the email is unaffected. Not checked: whether the frontend preview (`frontend/src/lib/receipt-parser-form.ts` and the dry run) shows the same derived total (the comment at `:557` says the preview calls this one function).

Causality: `NEW_SINCE_UPSTREAM_AUDIT`.


### A26-L18 - The trade card's preview can call the FX provider inside the pipeline's receipt transaction

- **Canonical severity:** LOW. kept LOW.
- **Absorbs:** A26-S11-03 (primary, 11-email-receipts.md, session severity LOW).
- **Invariants and prior findings named:** INV-FX-001.
- **Lens:** data.

#### A26-S11-03 (primary) - The trade card's preview can call the FX provider inside the pipeline's receipt transaction

1. **Severity:** LOW
2. **Confidence:** medium (static; the path is traced call by call, not executed)
3. **Location:** `pipeline/email-receipt-pipeline.service.ts:292-294, :610-615` (the trade branch runs in the receipt's `withScopedDb`, row lock held); `pipeline/email-receipt-trade.service.ts:139-144` (`submitTrade`, a nested `withScopedDb` that joins it); `ai-review/ai-review-work.service.ts:667-682` (`previewCreateInvestmentTransaction`); `securities/investment-transactions.service.ts:778-792` (`getRateForDate`, default `fetchMissing`, then `getLatestRate`); `currencies/exchange-rate.service.ts:1160-1190` (`fxProviders.dailySeries` HTTP call and `persistRateSeries` inside the ambient transaction).
4. **Violated invariant:** the pipeline's own rule ("a provider call must not hold a row lock", `email-receipt-pipeline.service.ts:295-297`) and `docs/external-side-effects.md` (provider calls outside the transaction); secondary: AGENTS.md "a rate for a date is `resolveFxRate`, never `getLatestRate`" (INV-FX-001) on the fallback.
5. **Realistic reproduction scenario:** a trade profile reads a USD security bought in an account whose cash is CAD (or a scheduled deposit funds it from a CAD account); the trade date's USD/CAD rate is not stored. The poll's pipeline, holding the email's row lock and one pooled connection in an open transaction, waits for the provider's daily series.
6. **Observed implementation behavior:** the transaction stays open for the provider's response time; the fetched window is inserted into `exchange_rates` in the user's transaction (rolled back with it if the pass fails later); if the provider answers nothing, the card is previewed at the latest stored rate, whatever its age.
7. **Expected behavior:** the rate is resolved before the receipt's transaction (or `fetchMissing: false` inside it, with the missing rate reported), and a rate older than `FX_MAX_RATE_AGE_DAYS` is unknown, not the latest.
8. **Impact:** a person's "Ignore" or "Link" on that email waits on the lock for the provider's timeout; a pool connection is held across an HTTP call per such email per tick. The latest-rate fallback can sign a card whose cash figure uses a stale rate (S13's INV-FX-001 surface).
9. **Root cause:** `buildTradeCard` reuses the chat tool's preview, which is written for a request context with no outer transaction, from inside the pipeline's transaction.
10. **Recommended correction:** resolve the settlement rate for the card before the pipeline's transaction, or call the preview with `fetchMissing: false` from the pipeline and let a missing rate make the email wait (`unmatched`-like) until the rate cron stores it; S13 decides the `getLatestRate` fallback.
11. **Suggested remediation diff: incomplete.** Supported by the evidence:

```diff
--- a/backend/src/securities/investment-transactions.service.ts
+++ b/backend/src/securities/investment-transactions.service.ts
@@ resolveCashExchangeRateOrNull
-      rate = await this.exchangeRateService.getRateForDate(
-        sourceCurrency,
-        cashCurrency,
-        transactionDate,
-      );
+      rate = await this.exchangeRateService.getRateForDate(
+        sourceCurrency,
+        cashCurrency,
+        transactionDate,
+        // Inside a caller's transaction (the receipt pipeline) no provider is
+        // called: a missing rate is unknown until the rate cron stores it.
+        { fetchMissing: !isInScopedTransaction() },
+      );
```

   Missing: whether an `isInScopedTransaction()` helper exists (`common/db/scoped-db.ts` holds the ambient manager), and the maintainer's decision on the `getLatestRate` fallback (S13). Needs: unit test, an integration case with a stubbed provider.
12. **Recommended regression test:** a pipeline integration case with a cross-currency trade profile and a provider stub that blocks, asserting that a concurrent `ignore` on the email is not blocked and that the provider was not called inside the pass.
13. **Suggested regression-test diff:** not written; it depends on the decision in 11.
14. **Verification method:** as 12, plus `npm run test:unit -- investment-transactions email-receipt-trade`.
15. **Residual risks / patch limitations:** the chat tool's own preview keeps fetching, which is correct there.

Causality: `NEW_SINCE_UPSTREAM_AUDIT` (the trade pipeline is new; the preview's fetch is older and S12/S13's).


### A26-L19 - The security-transfer edit writes and validates before taking the holdings lock, from snapshots of both legs

- **Canonical severity:** LOW. kept LOW.
- **Absorbs:** A26-S12-07 (primary, 12-securities-holdings.md, session severity LOW).
- **Invariants and prior findings named:** none in the index (see field 4 of each member).
- **Lens:** concurrency.

#### A26-S12-07 (primary) - The security-transfer edit writes and validates before taking the holdings lock, from snapshots of both legs

1. **Severity:** LOW
2. **Confidence:** medium (reading; not executed)
3. **Location:** `backend/src/securities/investment-transactions.service.ts:4330-4336` (linked leg read outside the transaction), `:3853-4027` (no `lockHoldingScope` before the reversal, the two whole-entity `save`s and `validateNoNegativeHoldingsHistory`), `:4036-4040` (the lock is first taken inside `rebuildAccountsFromTransactions`).
4. **Violated invariant:** "a refusal runs inside the same transaction under the same lock" (`AGENTS.md`); the lock-first order every other investment writer follows (`common/db/locks.ts`).
5. **Reproduction:** account X holds 10; a SELL of 10 on X and an edit raising a transfer-out of X from 0 to 10 run together. The SELL holds the lock and validates without seeing the edit; the edit validates without the lock and without seeing the uncommitted SELL. Both commit.
6. **Observed:** (by reading) X's history goes to -10; two concurrent edits of one transfer also overwrite each other's fields (no cash, so no money moves).
7. **Expected:** the second writer waits on `lockHoldingScope` and is refused.
8. **Impact:** a negative position the oversell guard exists to refuse; lost edits of a transfer's fields.
9. **Root cause:** `updateLinkedTransfer` predates the lock-first rule and relies on the rebuild's lock.
10. **Recommended correction:** take `lockHoldingScope` on both legs' old and new accounts as the first statement, then `lockInvestmentTransactionRow` on both legs and reload them.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
@@ -3853,4 +3853,12 @@
     await withScopedDb(this.dataSource, async (manager) => {
+      await lockHoldingScope(manager, [
+        editedLeg.accountId,
+        linkedLeg.accountId,
+        ...[updateDto.accountId, updateDto.destinationAccountId].filter(
+          (id): id is string => !!id,
+        ),
+      ]);
+      // then lockInvestmentTransactionRow on both legs and reload them (A26-S12-01)
       const bondGuard = await beginBondWriteGuard(manager, userId, [
```

12. **Recommended regression test:** a two-connection SELL versus transfer edit with a barrier on the lock.
13. **Suggested regression-test diff:** incomplete: the barrier must hold `lockHoldingScope` while the edit is shown to block on it, which needs the patch above to exist first; same harness as A26-S12-01.
14. **Verification:** `npm run test:integration -- security-transfer`.
15. **Residual risks:** none beyond A26-S12-01's.

- Causality: `PRE_EXISTING_UNREPORTED`.


### A26-L20 - The price-window fill remembers a month as empty when one provider answered nothing and another failed

- **Canonical severity:** LOW. kept LOW.
- **Absorbs:** A26-S12-08 (primary, 12-securities-holdings.md, session severity LOW).
- **Invariants and prior findings named:** none in the index (see field 4 of each member).
- **Lens:** financial.

#### A26-S12-08 (primary) - The price-window fill remembers a month as empty when one provider answered nothing and another failed

1. **Severity:** LOW
2. **Confidence:** medium (reading)
3. **Location:** `backend/src/securities/security-price.service.ts:2058, 2091` (`answered = true` on any non-null series), `:1999-2013` (`emptyPriceWindows.remember` when `stored === 0 && answered`).
4. **Violated invariant:** `docs/backend/securities-and-providers.md` "a null from a refusal or from a transport failure ... means we did not get an answer"; the FX chain's rule that a window is `answered: false` as soon as a carrying provider returned null (`fx-provider-chain`), which the price fill does not follow.
5. **Reproduction:** a security routed Yahoo then MSN; Yahoo answers `[]` for the month (a window it lacks), MSN times out. `ensurePricesForDate` stores nothing and remembers the month empty for 30 minutes.
6. **Observed:** (by reading) the report shows the position unpriced and does not re-ask MSN for 30 minutes after MSN recovers.
7. **Expected:** not remembered while a routed provider failed to answer.
8. **Impact:** a report unpriced for up to 30 minutes after a partial outage; no wrong figure (the position is reported unpriced).
9. **Root cause:** a single `answered` flag for the chain instead of "every routed provider answered".
10. **Recommended correction:** track `allAnswered` and remember only when it holds.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
-      if (series !== null) answered = true;
+      if (series === null) allAnswered = false;
+      else answered = true;
...
-    return { stored: 0, answered };
+    return { stored: 0, answered: answered && allAnswered };
```

(`allAnswered` initialised true, set false in the `catch` too.)

12. **Recommended regression test:** a unit case with provider 1 returning an empty series and provider 2 throwing, asserting nothing is remembered.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+  it("does not remember a window empty while a routed provider failed", async () => {
+    yahoo.fetchHistoricalWindowSeries.mockResolvedValue({ prices: [], currencyCode: "USD" });
+    msn.fetchHistoricalSeries.mockRejectedValue(new Error("timeout"));
+    await service.ensurePricesForDate([sec.id], "2017-03-15");
+    await service.ensurePricesForDate([sec.id], "2017-03-15");
+    expect(msn.fetchHistoricalSeries).toHaveBeenCalledTimes(2);
+  });
```

14. **Verification:** `npm run test:unit -- security-price.service`.
15. **Residual risks:** none.

- Causality: `PRE_EXISTING_UNREPORTED`.


### A26-L21 - The undo/redo holdings fold adds a dividend's total to the basis and stores the average at 6 decimals

- **Canonical severity:** LOW. kept LOW.
- **Absorbs:** A26-S12-10 (primary, 12-securities-holdings.md, session severity LOW).
- **Invariants and prior findings named:** INV-HOLDING-001.
- **Lens:** financial.

#### A26-S12-10 (primary) - The undo/redo holdings fold adds a dividend's total to the basis and stores the average at 6 decimals

1. **Severity:** LOW
2. **Confidence:** medium (reading)
3. **Location:** `backend/src/action-history/action-history.service.ts:1873-1880` (reads every non-VOID row, no `SHARE_MOVING_ACTIONS` filter), `:1902-1916` (`quantityChange > 0` -> `acquisitionCost` with `total_amount`), `:1942-1947` (average rounded to 6 dp; the canonical writers store 10 dp, `holdings.service.ts:712-724`).
4. **Violated invariant:** INV-HOLDING-001 (one fold; the drift report compares at 1e-10).
5. **Reproduction:** 100 shares bought at 10.00 (basis 1,000.00) and a DIVIDEND entered with quantity 100 and price 0.50 (total 50.00, `deriveInvestmentTotal` uses `quantity || 1`). Undo any action on that account.
6. **Observed:** (by reading) the undo rebuild stores an average of 10.50 instead of 10.00; any average that does not terminate in 6 dp (300.00 / 9 = 33.3333333333) is stored as 33.333333 and reported by the boot-time drift report as a discrepancy (difference 3.3e-7 > 1e-10).
7. **Expected:** the canonical fold's result (10.00; 33.3333333333).
8. **Impact:** a wrong average cost until the next canonical rebuild of that scope; drift reports that a rebuild then "repairs".
9. **Root cause:** a second fold kept beside `computeHoldingsMap` (recorded as an open risk in INV-HOLDING-001's known gap, without the dividend arithmetic or the precision).
10. **Recommended correction:** call `HoldingsService.rebuildAccountsFromTransactions(userId, [accountId], manager)` from the undo path and delete the copy.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/action-history/action-history.service.ts
+++ b/backend/src/action-history/action-history.service.ts
@@ private async rebuildHoldings(
-    await lockHoldingScope(manager, [accountId]);
-    await manager.query(`DELETE FROM holdings WHERE account_id = $1`, [accountId]);
-    ... (the hand-written fold and INSERT loop)
+    await this.holdingsService.rebuildAccountsFromTransactions(
+      userId,
+      [accountId],
+      manager,
+    );
```

Needs a `forwardRef` to `HoldingsService` (`src/module-graph.spec.ts`) and the undo specs updated.

12. **Recommended regression test:** undo after a DIVIDEND with quantity, asserting the stored average equals `findLedgerDiscrepancies`'s replay (no discrepancy).
13. **Suggested regression-test diff:** `expect(await holdings.findLedgerDiscrepancies(userId, m)).toEqual([])` after `actionHistory.undo(...)` on the fixture above.
14. **Verification:** `npm run test:unit -- action-history`.
15. **Residual risks:** none.

- Causality: `PRE_EXISTING_UNREPORTED` (partly recorded as an INV-HOLDING-001 known gap).


### A26-L22 - A benchmark observation stored outside the 06:25 run is not followed by a price recompute

- **Canonical severity:** LOW. kept LOW.
- **Absorbs:** A26-S14-03 (primary, 14-bonds.md, session severity LOW).
- **Invariants and prior findings named:** INV-CACHE-001, INV-BOND-005.
- **Lens:** financial.

#### A26-S14-03 (primary) - A benchmark observation stored outside the 06:25 run is not followed by a price recompute

1. **Severity:** LOW
2. **Confidence:** high (static)
3. **Location:** `backend/src/bonds/benchmark-refresh.service.ts:79-90` (boot warm-up), `:127-148` (`refreshNeverFetched`), `:351-414` (`store`, no recompute); `backend/src/bonds/bond-series.service.ts:316-322` (`afterStored`); `backend/src/bonds/bond-price.service.ts:103-119` (the only scheduled recompute, 06:45 Warsaw).
4. **Violated invariant:** INV-CACHE-001 (derived state is invalidated after the commit that changed its input) applied to INV-BOND-005's engine price, whose inputs include the benchmark observations.
5. **Realistic reproduction scenario:** (a) A deploy rolls at 11:00 on the day GUS publishes a CPI value that an EDO lot's new period needs; the boot warm-up (`onlyStale`) stores it. (b) A person fetches a new series whose benchmark was never fetched while another replica holds the `bond-benchmarks` lease for a run that computed its `needed` set before the series existed: `refreshNeverFetched` loses the lease and returns, then `recomputeLinkedSecuritiesOfSeries` recomputes without the observation.
6. **Observed behaviour:** (a) The engine rows for the days the new value makes derivable are written only at the next 06:45 run, up to about 20 hours later; (b) the benchmark is fetched at the next weekday 06:25 run, so a Friday-morning series store waits until Monday 06:25/06:45, about 3 days.
7. **Expected behaviour:** a store that changed or added observations, or a correction (`benchmark-refresh.service.ts:400-404` logs it), recomputes the engine prices of the securities whose series read that benchmark, after its commit.
8. **Impact:** for those hours or days the stored price history lacks the days in question, and the blend surfaces fall back per A26-S14-01. Live valuations (`valueByAccount`, the security page) read the observations directly and are correct. Narrow, self-healing.
9. **Root cause:** `BenchmarkRefreshService` has no post-store dispatch, and the only consumer link is the wall-clock gap of 20 minutes between the two crons (DR2).
10. **Recommended correction:** have `store` report whether any row was inserted or changed, and after `refreshAll` commits dispatch `recomputeLinkedSecuritiesOfSeries` for the instruments whose newest terms read a changed code, outside the lease call. This inverts no module edge if the dispatch lives in `BondSeriesService` or a small coordinator; `BenchmarkRefreshService` cannot inject `BondPriceService` without checking `src/module-graph.spec.ts`.
11. **Suggested remediation diff:** incomplete. Supported part:

```diff
--- a/backend/src/bonds/benchmark-refresh.service.ts
+++ b/backend/src/bonds/benchmark-refresh.service.ts
@@ -351,7 +351,7 @@
   private async store(
     code: string,
     result: BenchmarkFetchResult,
-  ): Promise<void> {
+  ): Promise<boolean> {
+    let changed = false;
@@ -399,6 +400,7 @@
         );
+        changed = (corrections?.length ?? 0) > 0 || /* inserted rows */ false;
```

    Missing: the upsert's `RETURNING` already yields inserted and changed rows (`upserted`), but the outer `SELECT` joins `old` and drops insertions, so a second count of `upserted` is needed; and the caller that owns the recompute (a module-graph decision for the maintainer).
12. **Recommended regression test:** a unit test of the refresh: a store that inserts a new observation triggers one recompute dispatch for the series reading that code, after the store resolved; an unchanged store triggers none.
13. **Suggested regression-test diff:** omitted, depends on where the dispatch lives (item 11).
14. **Verification method:** the unit test; `benchmark-refresh.service.spec.ts`; `no-automatic-bonds.integration.spec.ts` (a recompute must not fetch).
15. **Residual risks:** a recompute of every linked security of every user after each correction may be costly; bounding it to the programs reading the code is required.

Causality: `NEW_SINCE_UPSTREAM_AUDIT`.


### A26-L23 - A loan owing exactly one minor unit is treated as paid off on both layers

- **Canonical severity:** LOW. kept LOW.
- **Absorbs:** A26-S15-06 (primary, 15-loans-strategies.md, session severity LOW).
- **Invariants and prior findings named:** INV-LOAN-004.
- **Lens:** financial.

#### A26-S15-06 (primary) - A loan owing exactly one minor unit is treated as paid off on both layers: the posting writes nothing, the schedule deactivates, the 0.01 stays owed and the account cannot be closed

1. **Severity:** LOW
2. **Confidence:** high (backend executed, R6; frontend executed by the sweep's probe H)
3. **Location:** `backend/src/loan-installments/price-installment.ts:769` (`debt <= 0.01` -> `paid-off`), `reprice-template.ts:154-178` (deactivates), settlement `debtBefore <= 0.01` -> `loan_debt_retired` (spec 7.2, `plan-loan-settlement.ts`); close refusal `accounts.service.ts:1300-1306`; frontend `frontend/src/lib/loan-schedule.ts:408, 539` with `PAYOFF_EPSILON = 0.01` (`loan-frequency.ts:83`).
4. **Violated invariant:** INV-LOAN-004 (the final payment retires the balance); the code's own comment in `bookLoanAllocation` says the threshold absorbs "a residue of less than one unit", and 0.01 is one whole unit.
5. **Reproduction:** a loan whose ledger owes 0.01 (a manual payment one cent short of the payoff) with an active bill.
6. **Observed (executed, R6):** the post claims 2026-08-01 with no transaction (`transaction_id` NULL), the schedule becomes inactive, the loan ledger stays **-0.01**; closing the account is refused (`closeNonZeroBalance`). A debt of 0.02 posts 0.02 (R6b). Frontend: balance 1,000 at 0 %, payment 999.99 -> one row, `paidOff: true`, `totalPaid` 999.99, balance 0.01.
7. **Expected:** a debt of 0.01 is owed: post 0.01 (+0.00 interest) and retire it; the projection adds a 0.01 row.
8. **Impact:** a loan that can never reach zero through the app without a hand-entered cent; the bill silently disappears.
9. **Root cause:** `<=` where the documented intent is `<` one minor unit; the frontend epsilon mirrors it.
10. **Recommended correction:** `debt < minorUnit / 2` (or `< 0.01`) on both layers and in the planner's `loan_debt_retired`.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/loan-installments/price-installment.ts
+++ b/backend/src/loan-installments/price-installment.ts
-  if (debt <= 0.01) {
+  // Less than one cent is a rounding residue; one whole cent is still owed.
+  if (debt < 0.01) {
--- a/frontend/src/lib/loan-schedule.ts
+++ b/frontend/src/lib/loan-schedule.ts
-  while (balance > PAYOFF_EPSILON && paymentNumber < maxPayments) {
+  while (balance >= PAYOFF_EPSILON && paymentNumber < maxPayments) {
```

   plus the planner's threshold and spec 7.2/E15 updated together (the spec states `<= 0.01`; Rule 2: the spec must change with the code). Needs: the 4dp-ledger residue case (`bookLoanAllocation` leaves < 0.01) still reading as paid off.
12. **Recommended regression test / 13. diff:** R6 as an integration case asserting a 0.01 posting and a zero ledger; `loan-schedule.test.ts` 1,000 / 999.99 asserting two rows.
14. **Verification:** the probe; `npm run test:unit -- price-installment plan-loan-settlement`; `npm run test -- loan-schedule`.
15. **Residual risks:** a JPY loan (0 decimals) needs the threshold in its own minor unit.

- Causality: `NEW_SINCE_UPSTREAM_AUDIT` for the posting `retired` decision; the frontend epsilon `PRE_EXISTING_UNREPORTED`.


### A26-L24 - The GEM signal-change alert is not bound to the current period and its dedupe memory is purged after the retention window

- **Canonical severity:** LOW. kept LOW.
- **Absorbs:** A26-S15-07 (primary, 15-loans-strategies.md, session severity LOW).
- **Invariants and prior findings named:** INV-GEM-NOTIFY-002, INV-GEM-NOTIFY-003.
- **Lens:** financial.

#### A26-S15-07 (primary) - The GEM signal-change alert is not bound to the current period and its dedupe memory is purged after the retention window, so an old change is announced, and announced again

1. **Severity:** LOW
2. **Confidence:** high (period: executed by the GEM sweep's `cx2` over the real `detectSignalChange`, re-read; purge: by reading)
3. **Location:** `backend/src/strategies/gem-signal-change-alert.service.ts:202-218` (`detectSignalChange` compares the two newest history entries whatever the current period's state), `:176` (dedupe key); `backend/src/notification-center/notification.service.ts:325-366` (`purgeOld` deletes read rows older than the retention window and dismissed ones; `gem:` is not in `STATE_KEYED_DEDUPE_PREFIXES`, `notification-bounds.ts:29-32`).
4. **Violated invariant:** INV-GEM-NOTIFY-002 (re-running the cron is a no-op per period) and INV-GEM-NOTIFY-003 (a non-evaluable current period is a no-op) of `docs/specs/gem-signal-change-notifications.md`.
5. **Reproduction:** (a) a strategy configured in October whose current period is not yet evaluable and whose two newest history rows differ (2026-08-31 RISK_OFF, 2026-07-31 RISK_ON). (b) a quarterly strategy: the 2026-09-30 risk alert is read on 10-01; about 11-01 the purge deletes it; the 09-30/06-30 pair is still the newest, so the next run inserts and sends it again (WARNING, push/email), and again a month later.
6. **Observed:** (a) `kind: "risk"`, key `gem:S:2026-08-31:risk` for a change two months old; (b) by reading, the insert succeeds once the row is purged.
7. **Expected:** silence in both cases.
8. **Impact:** repeated or stale "moved to risk-off" warnings; the recommendation shown is still the latest, so the harm is noise and a prompt to trade on a change already acted on.
9. **Root cause:** the producer reads "two newest rows" instead of "the current period and the one before it", and relies on a dedupe row the retention policy deletes.
10. **Recommended correction:** fire only when `current.evaluatedOn` is the report's current evaluable period (`report.signal?.evaluatedOn`), and keep `gem:` rows past retention like the bond state keys (or record the last notified period on the strategy row).
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/strategies/gem-signal-change-alert.service.ts
+++ b/backend/src/strategies/gem-signal-change-alert.service.ts
@@ export function detectSignalChange(
   if (periods.length < 2) return null;
   const [current, previous] = periods;
+  // INV-GEM-NOTIFY-003: only the current period's change, never an old one.
+  if (!report.signal || report.signal.evaluatedOn !== current.evaluatedOn) {
+    return null;
+  }
--- a/backend/src/notification-center/notification-bounds.ts
+++ b/backend/src/notification-center/notification-bounds.ts
 export const STATE_KEYED_DEDUPE_PREFIXES: readonly string[] = [
   "bond:unbooked:",
   "bond:missing:",
+  "gem:",
 ];
```

   Needs: the field name of the report's current signal checked against `GemStrategyReportView`; `bond-notification-events.ts:128` destructures the first two prefixes positionally and must not shift.
12. **Recommended regression test / 13. diff:** spec test-matrix items 5-8 (`gem-signal-change-alert.service.spec.ts`): no current signal plus two differing history rows -> no notify; a purge then a re-run -> no second notify.
14. **Verification:** `npm run test:unit -- gem-signal-change-alert notification`.
15. **Residual risks:** the spec's own pseudo-code reads "two latest" too (section 11).

- Causality: `NEW_SINCE_UPSTREAM_AUDIT`.


### A26-L25 - Loan Amortization Report: "Original Amount" double-counts projected principal when the opening balance is unset; exports run while loading

- **Canonical severity:** LOW. kept LOW.
- **Absorbs:** A26-S15-08 (primary, 15-loans-strategies.md, session severity LOW).
- **Invariants and prior findings named:** INV-LOAN-HISTORY-001.
- **Lens:** frontend.

#### A26-S15-08 (primary) - Loan Amortization Report: "Original Amount" double-counts projected principal when the opening balance is unset, and the CSV/PDF exports run while the history request has failed

1. **Severity:** LOW
2. **Confidence:** medium (Original Amount executed by the frontend sweep's probe N; exports by reading only)
3. **Location:** `frontend/src/components/reports/LoanAmortizationReport.tsx:290-295` (`Math.abs(openingBalance) || (totalPrincipal + currentBalance)`, where `totalPrincipal` already includes projected rows); exports `:340-387` with `ReportToolbarActions` given no `disabled` (`:497-501`).
4. **Violated invariant:** a figure is from one source (the history's `startingBalance`); INV-LOAN-HISTORY-001's failure response ("a FAILED read is unknown, not zero, and must not be rendered as a schedule").
5. **Reproduction:** opening balance unset, current 9,000, 1,000 paid: card shows **19,000.02**, expected 10,000.00. History fetch rejected: the CSV still writes a schedule of "Projected" rows from the account's own rate and payment and the PDF says "Payments Made 0".
6-8. **Observed / expected / impact:** as above; a wrong headline figure, and an export presenting a schedule the screen withholds.
9. **Root cause:** the fallback sums the whole table; the export handlers do not read `historyError`.
10. **Recommended correction:** `originalBalance = history.startingBalance` when the opening balance is unset; disable both exports while the history is in error.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
-    const originalBalance = Math.abs(selectedAccount.openingBalance) || (totalPrincipal + currentBalance);
+    const originalBalance =
+      Math.abs(selectedAccount.openingBalance) || history.startingBalance;
@@
-        <ReportToolbarActions onExportCsv={handleExportCsv} onExportPdf={handleExportPdf} />
+        <ReportToolbarActions
+          onExportCsv={handleExportCsv}
+          onExportPdf={handleExportPdf}
+          disabled={!!historyError}
+        />
```

   (names to be checked against the component's props.)
12-14. **Test:** `LoanAmortizationReport.test.tsx`: the probe-N fixture asserting 10,000.00; a rejected history asserting both exports disabled. `npm run test -- LoanAmortizationReport`.
15. **Residual risks:** none beyond the prop names.

- Causality: `PRE_EXISTING_UNREPORTED`.


### A26-L26 - The Post dialog previews the stored template's principal/interest split while the post re-prices the bill from the ledger

- **Canonical severity:** LOW. kept LOW.
- **Absorbs:** A26-S15-09 (primary, 15-loans-strategies.md, session severity LOW).
- **Invariants and prior findings named:** INV-LOAN-009.
- **Lens:** frontend.

#### A26-S15-09 (primary) - The Post dialog previews the stored template's principal/interest split, while the post re-prices the same bill from the ledger and books a different split

1. **Severity:** LOW
2. **Confidence:** high (backend half executed, R2; frontend half by reading)
3. **Location:** `frontend/src/components/scheduled-transactions/PostTransactionDialog.tsx:456-474` (split rows pre-filled from `scheduledTransaction.splits`, the stored template), rendered at `:1182`; backend `scheduled-transactions.service.ts:3546-3636` (an unchanged echo re-prices through `resolvePostingAllocation`). The projection that prices the occurrence from the ledger exists (`GET /scheduled-transactions/:id/loan-occurrences`) and is read only by `OccurrenceDatePicker` and the override editor.
4. **Violated invariant:** "a preview computes what the commit will do, through the same code" (AGENTS.md); INV-LOAN-009's F2 reads the projection for a loan bill on the picker and the editor but not on the dialog that commits.
5. **Reproduction:** the R2 ledger: LOAN 200,000 at 6 %, the August installment posted (template rewritten for September to 997.50 interest / 502.50 principal), then a 10,000 principal-only payment on 2026-08-15. Open Post for 2026-09-01 and press Post without editing.
6. **Observed:** the dialog shows interest 997.50, principal 502.50; the ledger receives interest **947.50**, principal **552.50** (executed through the real `post()`, R2). The total (1,500.00) is the same.
7. **Expected:** the dialog shows 947.50 / 552.50 (the projection's first occurrence), or labels the lines as re-priced at posting.
8. **Impact:** the split the user confirms is not the split written (50.00 moved between interest and principal here); a user who types the shown figures back (a non-echo) posts the stale split deliberately.
9. **Root cause:** the dialog pre-fills from the template snapshot; the server's echo detection then replaces what was shown.
10. **Recommended correction:** pre-fill a loan bill's lines from `loan-occurrences` (count 1) as the picker does; keep the server's echo re-pricing as the backstop.
11. **Suggested remediation diff (illustrative, not applied):** in `PostTransactionDialog.tsx`, when `scheduledTransaction` pays a loan (the client already knows from `loanOccurrences` status `priced`), map the first occurrence's `lines` onto the split rows by `sourceSplitId` before `bookSplitRowsAtMinorUnit`; names to be checked against `types/scheduled-transaction.ts`.
12-14. **Test:** a dialog test with a template 997.50/502.50 and a projection 947.50/552.50 asserting the rows show the projection; `npm run test -- PostTransactionDialog`.
15. **Residual risks:** the projection is a read without the posting's lock; a payment committed between the dialog's read and the post still re-prices (server backstop).

- Causality: `NEW_SINCE_UPSTREAM_AUDIT` (the projection and the echo re-pricing are new). Overlap: S08 handed S19 the same dialog's amount pre-fill (`:433`); this finding is the loan-split half, for S19 to merge.


### A26-L27 - A price push's chart token lives five minutes, the push it rides on four hours

- **Canonical severity:** LOW. kept LOW.
- **Absorbs:** A26-S17-04 (primary, 17-ai-mcp-notifications.md, session severity LOW).
- **Invariants and prior findings named:** none in the index (see field 4 of each member).
- **Lens:** frontend.

#### A26-S17-04 (primary) - A price push's chart token lives five minutes, the push it rides on four hours

1. **Severity:** LOW
2. **Confidence:** high (read)
3. **Location:** `backend/src/push/push-chart-artifact.service.ts:11` (`CHART_TOKEN_TTL_MS = 5 * 60_000`), `:27-40` (sweep every five minutes), `:73-93` (`consume` refuses after expiry); `backend/src/push/web-push-sender.service.ts:24, 339` (`PUSH_TTL_SECONDS = 4 * 60 * 60`, no `urgency` option, so the push service may hold a normal-priority message while the device dozes); `frontend/public/sw.js:468-489` (the image URL is fetched only when the notification is shown).
4. **Violated invariant:** the opt-in price-chart feature's promise (the notification carries the chart) for every delivery the push service still makes.
5. **Realistic reproduction scenario:** an Android phone in Doze or offline when a price alert fires; the push service delivers it 20 minutes later.
6. **Observed implementation behavior:** the service worker shows the notification with an image URL whose token expired 15 minutes earlier and whose row the sweep removed; the image request is a 404 and the notification shows no chart.
7. **Expected behavior:** the chart is available for as long as the push can be delivered, or the push expires with it.
8. **Impact:** the feature silently degrades to text-only for every delayed delivery; no data or security effect. The one-use token also means a notification re-shown by the OS cannot fetch it again.
9. **Root cause:** two TTLs chosen independently.
10. **Recommended correction:** give price pushes that carry a chart a push TTL no longer than the token's, or raise the token TTL (and the quota window) to the push TTL.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/push/push-chart-artifact.service.ts
+++ b/backend/src/push/push-chart-artifact.service.ts
-export const CHART_TOKEN_TTL_MS = 5 * 60_000;
+// As long as the push that names it can still be delivered
+// (web-push-sender.service.ts PUSH_TTL_SECONDS); the one-use DELETE still
+// retires it at the first fetch.
+export const CHART_TOKEN_TTL_MS = PUSH_TTL_SECONDS * 1000;
```

The quota (`CHART_ARTIFACT_LIMIT = 1000` live rows across the deployment) must then be re-sized: four hours of artifacts is 48 times the current window.
12. **Recommended regression test:** a unit spec asserting `CHART_TOKEN_TTL_MS >= PUSH_TTL_SECONDS * 1000` (a source-level pin of the relation, the `CONFIRM_TIMEOUT_MS` pattern in `mcp-confirm.spec.ts`).
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+it("keeps a chart token alive for as long as the push can be delivered", () => {
+  expect(CHART_TOKEN_TTL_MS).toBeGreaterThanOrEqual(PUSH_TTL_SECONDS * 1000);
+});
```

14. **Verification method:** the spec above; `push-chart-token.integration.spec.ts`.
15. **Residual risks / patch limitations:** the global quota becomes the binding limit for a large deployment; the cap's behaviour (`issue` returns `null`, the push goes without chart) is already graceful.

Causality: `NEW_SINCE_UPSTREAM_AUDIT` (push chart artifacts are new). This is the "chart artifact TTL" of the hint line.


### A26-L28 - The portfolio-movement alert commits its new baseline before it writes the notification

- **Canonical severity:** LOW. kept LOW.
- **Absorbs:** A26-S17-06 (primary, 17-ai-mcp-notifications.md, session severity LOW).
- **Invariants and prior findings named:** none in the index (see field 4 of each member).
- **Lens:** data.

#### A26-S17-06 (primary) - The portfolio-movement alert commits its new baseline before it writes the notification, so a failed write loses the alert for good

1. **Severity:** LOW
2. **Confidence:** medium (read; the failure window is not executed)
3. **Location:** `backend/src/notification-center/portfolio-movement-alert.service.ts:232-247` (`storeBaseline` in its own transaction), `:251-257` (`dispatch.notify` after it); the notification already carries a per-day dedupe key (`:507`, `portmove:<currency>:<today>`).
4. **Violated invariant:** `docs/external-side-effects.md` ordering ("do the thing, then write down what happened") applied to an alert: the state that suppresses a repeat must not commit before the thing it suppresses.
5. **Realistic reproduction scenario:** the movement cron decides to fire and to re-baseline; `storeBaseline` commits; the `notify` transaction fails (a connection reset, a statement timeout) or the process is killed before it runs.
6. **Observed implementation behavior:** the baseline has moved to today's value, so the next run measures no movement; no notification row exists.
7. **Expected behavior:** the alert is written first (the dedupe key makes a retry harmless), then the baseline moves.
8. **Impact:** an opted-in user misses one portfolio-movement alert; no financial state changes.
9. **Root cause:** the suppression state is written before the event it suppresses, although the event is idempotent by its key.
10. **Recommended correction:** call `notify` first and `storeBaseline` after it returns (a `null` from `notify` means another replica already wrote today's alert, and the baseline still moves).
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/notification-center/portfolio-movement-alert.service.ts
+++ b/backend/src/notification-center/portfolio-movement-alert.service.ts
@@
-    if (decision.rebaselineTo != null) {
-      ...
-      await this.storeBaseline(userId, decision.rebaselineTo, currency, today, snapshot);
-    }
-    if (decision.fire == null || baselineDate === null) return false;
-    ...
-    const written = await this.dispatch.notify(...);
+    let written: Notification | null = null;
+    if (decision.fire != null && baselineDate !== null) {
+      // First: the per-day dedupe key makes a retry of this write harmless,
+      // while a baseline moved first would hide the move from the retry.
+      written = await this.dispatch.notify(...);
+    }
+    if (decision.rebaselineTo != null) {
+      ...
+      await this.storeBaseline(userId, decision.rebaselineTo, currency, today, snapshot);
+    }
+    if (decision.fire == null || baselineDate === null) return false;
```

12. **Recommended regression test / 13. diff (illustrative, not applied):**

```diff
+it("keeps the baseline when the alert could not be written", async () => {
+  dispatch.notify.mockRejectedValueOnce(new Error("connection reset"));
+  await expect(service.evaluateUser(USER)).rejects.toThrow();
+  expect(storeBaselineSpy).not.toHaveBeenCalled();
+});
```

14. **Verification method:** the unit case; `portfolio-movement-flow.integration.spec.ts` re-run.
15. **Residual risks / patch limitations:** the fan-out still runs before the baseline commits; a crash between them repeats nothing because the second run's `notify` returns `null` on the dedupe key.

Causality: `NEW_SINCE_UPSTREAM_AUDIT` (portfolio-movement alerts are new). Handed from S08 (`08-scheduler-cron.md` section 12).


### A26-L29 - The insights aggregator computes the month start as a local-midnight date read back in UTC

- **Canonical severity:** LOW. kept LOW.
- **Absorbs:** A26-S17-07 (primary, 17-ai-mcp-notifications.md, session severity LOW).
- **Invariants and prior findings named:** none in the index (see field 4 of each member).
- **Lens:** financial.

#### A26-S17-07 (primary) - The insights aggregator computes the month start as a local-midnight date read back in UTC, so a server east of UTC treats the previous month as the current one

1. **Severity:** LOW
2. **Confidence:** high (executed: `TZ=Europe/Warsaw` gives `2026-09-30` for the start of October 2026, `TZ=UTC` gives `2026-10-01`)
3. **Location:** `backend/src/ai/insights/insights-aggregator.service.ts:54-61` (`new Date(y, m, 1).toISOString().substring(0, 10)` for `currentMonthStart` and `sixMonthsAgo`), `:79-81` (`monthlySpending.find(m => m.month === currentMonthStart.substring(0, 7))`).
4. **Violated invariant:** `backend/CLAUDE.md` "A calendar date stepped over a range: `enumerateDaysYMD` / `addDaysYMD`, never a local-midnight `Date` read back with `toISOString()`".
5. **Realistic reproduction scenario:** an operator sets `TZ=Europe/Warsaw` on the backend container; the 6 AM insight cron runs on 21 October.
6. **Observed implementation behavior:** `currentMonthStart = "2026-09-30"`, so the aggregates' "current month" is September and the six-month window starts on 31 March.
7. **Expected behavior:** `2026-10-01` and `2026-04-01` whatever the server zone (the user's financial today, `financialTodayYmd` on the server side).
8. **Impact:** insights compare the wrong month ("you spent more this month") for every user of such a deployment; no stored financial data changes. Default containers run in UTC, which hides it.
9. **Root cause:** local-time constructor plus UTC serialisation.
10. **Recommended correction:** build the dates from a `YYYY-MM-DD` string of the user's financial today and step them with `addDaysYMD`/month arithmetic on strings.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
-    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
-      .toISOString()
-      .substring(0, 10);
-    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, 1)
-      .toISOString()
-      .substring(0, 10);
-    const today = now.toISOString().substring(0, 10);
+    const today = formatDateYMD(now); // or the user's financial today
+    const currentMonthStart = `${today.substring(0, 7)}-01`;
+    const sixMonthsAgo = addMonthsYMD(currentMonthStart, -6); // string arithmetic, no Date
```

(`addMonthsYMD` is illustrative: the repository's month-stepping helper must be located first, Rule 2.)
12. **Recommended regression test / 13. diff (illustrative, not applied):** a spec run under a fixed non-UTC zone (`process.env.TZ` set before the module loads, or the jest config's per-file environment) asserting `currentMonthStart` is the first of the month.
14. **Verification method:** the spec under `TZ=Europe/Warsaw` and `TZ=America/Los_Angeles`.
15. **Residual risks / patch limitations:** `forecast-aggregator.service.ts:126` and other `toISOString().substring(0, 10)` reads of "today" have the UTC-day variant of the same question (not a month shift); not swept.

Causality: `PRE_EXISTING_UNREPORTED`. Found in the approval challenge.


### A26-L30 - Figures and labels bypass the reader's number locale and the message catalog (lib formatters, form readouts, figure surfaces)

- **Canonical severity:** LOW. kept LOW for the group: one rule (`useNumberFormat`, the catalog), three sessions.
- **Absorbs:** A26-S18-09 (primary, 18-frontend-core.md, session severity LOW); A26-S19-07 (merged surface, 19-frontend-forms.md, session severity LOW); A26-S20-07 (merged surface, 20-frontend-figures.md, session severity LOW).
- **Invariants and prior findings named:** INV-DISPLAY-001.
- **Lens:** frontend.

#### A26-S18-09 (primary) - Two lib formatters render user-facing text outside the reader's locale and language

1. **Severity:** LOW
2. **Confidence:** high (static)
3. **Location:** `frontend/src/lib/format.ts:476-491` (`formatRelativeTime`: hard-coded English "Never", "Just now", "5m ago", "Yesterday", then the browser's `toLocaleDateString()`), rendered by `components/investments/RefreshPricesButton.tsx:52, 79`; `frontend/src/lib/pdf-export.ts:253-259` (PDF header timestamp in `en-US`).
4. **Violated invariant:** INV-DISPLAY-001 (the date and number locale by preference) and the translation rule in `AGENTS.md`.
5. **Reproduction:** a Polish-language user with the `DD.MM.YYYY` date preference opens Investments; the button reads "(5m ago)" and, after a week, a browser-locale date; every exported PDF header says "Oct 21, 2026, 11:45 PM".
6. **Observed / 7. Expected:** English and browser-locale strings / the catalog strings and `useDateFormat`.
8. **Impact:** cosmetic but on every Investments visit and every PDF.
9. **Root cause:** pure helpers predating the locale hooks, outside the guard's patterns.
10. **Correction / 11. diff (illustrative, not applied):**

```diff
--- a/frontend/src/components/investments/RefreshPricesButton.tsx
+++ b/frontend/src/components/investments/RefreshPricesButton.tsx
-import { formatRelativeTime } from '@/lib/format';
+import { useRelativeTime } from '@/hooks/useRelativeTime';
@@
-          ? t('page.lastUpdated', { time: formatRelativeTime(lastPriceUpdate) })
+          ? t('page.lastUpdated', { time: relativeTime(lastPriceUpdate) })
```

   (`hooks/useRelativeTime.ts` exists; whether its output matches is to be checked), and `pdf-export.ts` takes the formatted timestamp from its React caller.
12. **Regression test / 13. diff:** a `ui-conventions.test.ts` rule banning imports of `formatRelativeTime` from components, and a `pdf-export` case that passes a locale.
14. **Verification:** `npm run test -- RefreshPricesButton pdf-export ui-conventions`.
15. **Residual risks:** none material. Causality: `PRE_EXISTING_UNREPORTED`.

#### A26-S19-07 (merged surface) - Nine form readouts format figures with `toFixed`, outside the reader's number locale, and the guard does not see them

1. **Severity:** LOW
2. **Confidence:** high (by reading)
3. **Location:** `frontend/src/components/investments/InvestmentTransactionForm.tsx:1513, 1533, 1538, 1545, 1550` (split preview), `:1606, :1611` (transfer source holding), `:1783` (`sharesAtPrice`); `frontend/src/components/accounts/LoanPaymentSetupDialog.tsx:467, 472`; guard `frontend/src/test/number-locale.guard.test.ts` (scans `toFixed` only beside `%`).
4. **Violated invariant:** INV-DISPLAY-001.
5. **Reproduction:** a reader with `numberFormat: pl-PL` opens a security transfer.
6. **Observed:** the source-holding line renders `10.0000` shares at `100.0000` average cost with dot decimals.
7. **Expected:** `formatShareQuantity` / `formatCurrency` off `useNumberFormat()` (comma decimals for pl-PL).
8. **Impact:** a misread figure at the point where the user decides how many shares to move; no stored value changes.
9. **Root cause:** the guard is keyed on the `%` fingerprint, so a bare `toFixed` in JSX passes; `docs/system-invariants.md` records INV-DISPLAY-001 as `enforced`.
10. **Recommended correction:** use the hook's formatters; extend the guard to a `toFixed(` inside JSX braces or a `t(...)` argument.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/frontend/src/components/investments/InvestmentTransactionForm.tsx
+++ b/frontend/src/components/investments/InvestmentTransactionForm.tsx
@@ -1606 +1606 @@
-                  {Number(selectedTransferHolding.quantity).toFixed(4)}
+                  {formatShareQuantity(Number(selectedTransferHolding.quantity))}
@@ -1610,2 +1610 @@
-                  {currencySymbol}
-                  {Number(selectedTransferHolding.averageCost ?? 0).toFixed(4)}
+                  {formatCurrency(Number(selectedTransferHolding.averageCost ?? 0), transactionCurrency)}
```

12. **Recommended regression test:** a guard case matching `.toFixed(` inside JSX braces or a `t(` argument object under `src/components/`.
13. **Suggested regression-test diff (illustrative, not applied):** add to `number-locale.guard.test.ts` a scan for `/\{[^}]*\.toFixed\(\d\)[^}]*\}/` over `src/components/**/*.tsx` with an empty allowlist.
14. **Verification method:** the extended guard fails at the baseline on the nine sites and passes after the migration.
15. **Residual risks:** `formatCurrency` rounds to the currency's decimals, so a 4dp average cost needs a price formatter with more decimals. Causality: `PRE_EXISTING_UNREPORTED`.

#### A26-S20-07 (merged surface) - Numbers bypass the locale formatter and Monte Carlo compare labels bypass the catalog, with no guard to catch either

1. **Severity:** LOW
2. **Confidence:** high (read)
3. **Location:** `frontend/src/components/reports/SavingsRateReport.tsx:389` (`point.savingsRate.toFixed(1)` into `"Rate: {rate}%"`, `i18n/messages/en/reports.json:1348`); `MonteCarloReport.tsx:646` (`(form.expectedReturn * 100).toFixed(1)`); `CurrencyExposureReport.tsx:172-176` (rate `toFixed`); `monte-carlo/compareMetricRows.ts:177` (`new Date(stamp).toLocaleString()` and the literal `'Never'`) and 36 literal English `label:` strings in the same file rendered by `CompareMetricTable.tsx:167, 184`; 17 non-test files in `src/` contain `.toFixed(` or `toLocaleString()`, and `src/test/ui-conventions.test.ts` scans for neither.
4. **Violated invariant:** `frontend/CLAUDE.md` "Number a person reads: `useNumberFormat()` ... never `toFixed`, `toLocaleString()`, a literal `%`"; "Every user-facing string is translated".
5-7. **Observed / expected:** a Polish reader sees "12.3%" and "Last run ... Never" in English; expected "12,3 %" through `formatPercent` and catalog strings.
8. **Impact:** wrong decimal separator and untranslated labels on two reports; no financial value changes.
9. **Root cause:** the rule has no source-scanning guard.
10-11. **Correction / diff (illustrative):** `t('savingsRate.tooltipRate', { rate: formatPercent(point.savingsRate, 1) })` with the catalog's `%` removed; translate the compare labels through `useTranslations('reports')`; add a `toFixed(` / `toLocaleString()` scan to `ui-conventions.test.ts` with a shrink-only baseline of the current sites.
12-15. **Test / verification / residual:** the guard itself is the regression test; `npm run test -- ui-conventions SavingsRateReport MonteCarloReport`; CSV paths (`MonteCarloReport.tsx:323-327`) are machine output and stay `toFixed`.

Causality: `PRE_EXISTING_UNREPORTED`.


### A26-L31 - The client forecast accumulates floats and rounds the projected balance with `Math.round(x * 100) / 100`

- **Canonical severity:** LOW. kept LOW.
- **Absorbs:** A26-S18-10 (primary, 18-frontend-core.md, session severity LOW).
- **Invariants and prior findings named:** none in the index (see field 4 of each member).
- **Lens:** frontend.

#### A26-S18-10 (primary) - The client forecast accumulates floats and rounds the projected balance with `Math.round(x * 100) / 100`

1. **Severity:** LOW
2. **Confidence:** high (computed)
3. **Location:** `frontend/src/lib/forecast.ts:745` (`currentBalance += tx.amount`), `:760` (`Math.round(currentBalance * 100) / 100`), `:992`, `:1020-1027` (the projected balance returned to the posting dialog); `:503-510` (`Number(amount) * rate` unrounded).
4. **Violated invariant:** `AGENTS.md` financial math ("never accumulate floats ... `roundMoney` every result"); `lib/format.ts` `roundToCents` is round-half-away-from-zero, `Math.round` is round-half-up and loses the IEEE midpoint.
5. **Reproduction / numbers (node):** a projected balance of 1.0050 renders 1.00 (`roundToCents` 1.01); -2 500.0050 renders -2 500.00 (expected -2 500.01).
6. **Impact:** a one-cent difference between the forecast's projected balance and the server's balance forecast for 4-decimal (FX-converted) balances; no write depends on it.
7. **Correction / 11. diff (illustrative, not applied):**

```diff
--- a/frontend/src/lib/forecast.ts
+++ b/frontend/src/lib/forecast.ts
@@ -744,3 +744,3 @@
     for (const tx of dayTransactions) {
-      currentBalance += tx.amount;
+      currentBalance = roundMoney(currentBalance + tx.amount);
     }
@@ -760 +760 @@
-        balance: Math.round(currentBalance * 100) / 100,
+        balance: roundToCents(currentBalance),
@@ -1027 +1027 @@
-  return Math.round(balance * 100) / 100;
+  return roundToCents(balance);
```

12. **Regression test:** `forecast.test.ts` with a 1.0050 starting balance asserting 1.01. 14. **Verification:** `npm run test -- forecast`. 15. **Residual risks:** none. Causality: `PRE_EXISTING_UNREPORTED`.


### A26-L32 - Frontend response types drop signals the backend sends (contract drift)

- **Canonical severity:** LOW. kept LOW.
- **Absorbs:** A26-S18-11 (primary, 18-frontend-core.md, session severity LOW).
- **Invariants and prior findings named:** none in the index (see field 4 of each member).
- **Lens:** frontend.

#### A26-S18-11 (primary) - Response types drop signals the backend sends (contract drift)

1. **Severity:** LOW
2. **Confidence:** high for (a) and (b), verified at both ends; (c) as stated
3. **Location and surfaces (Rule 7, one finding):**
   - (a) `ExplainedRuleSkip` (`frontend/src/types/transaction-rule-explain.ts:66, 74`) is `'disabled' | 'invalid'`; the backend `RuleSkipReason` adds `'outside_active_window'` (`backend/src/transaction-rules/rule-effects.ts:91-95`, asserted by `rule-effects.active-window.spec.ts:52-88`); the renderer `ImportPreviewRuleTest.tsx:67` looks up `notEvaluated.${skippedRule}` and the catalog (`en/import.json:598-602`) has no `outside_active_window`, so the rule-test panel shows a missing-message key for a rule outside its active window (INV-RULE-004).
   - (b) `bondRowsWithoutSeries` (`backend/src/import/dto/import.dto.ts:413`, MNY `mny-import-job.ts:106`) is in no frontend type and rendered nowhere: bond lots imported without a series are never reported.
   - (c) `PortfolioPeriodResult.incompleteRanges` (`net-worth/portfolio-period-result.service.ts:150`) is absent from `types/net-worth.ts:175-245`: the dated gap ranges the server computes never reach the reader (the figures themselves are nullable, so no false total).
4. **Violated invariant:** `docs/financial-calculation-contract.md` 1.3 (a withheld figure names what is missing); representation contract.
5. **Correction / 11. diff (illustrative, not applied):**

```diff
--- a/frontend/src/types/transaction-rule-explain.ts
+++ b/frontend/src/types/transaction-rule-explain.ts
-export type ExplainedRuleSkip = 'disabled' | 'invalid';
+export type ExplainedRuleSkip = 'disabled' | 'invalid' | 'outside_active_window';
--- a/frontend/src/i18n/messages/en/import.json
+++ b/frontend/src/i18n/messages/en/import.json
       "notEvaluated": {
         "afterStop": "Not evaluated: a previous rule stopped the rules.",
         "disabled": "Not evaluated: the rule is switched off.",
-        "invalid": "Not evaluated: the rule is not valid. Open it to repair it."
+        "invalid": "Not evaluated: the rule is not valid. Open it to repair it.",
+        "outside_active_window": "Not evaluated: the row's date is outside the rule's active dates."
       },
```

   plus `bondRowsWithoutSeries?: number` on the import result types with a line in the completion step.
12. **Regression test:** a contract test (the `budget-trend.contract.test.ts` pattern) holding `ExplainedRuleSkip` equal to the backend union.
14. **Verification:** `npm run test -- ImportPreviewRuleTest transaction-rule-explain`; `npm run i18n:check`.
15. Causality: `NEW_SINCE_UPSTREAM_AUDIT` for (a) (`transaction-rules/` is new) and (b) (bonds are new); (c) `NEW_SINCE_UPSTREAM_AUDIT`.


### A26-L33 - A loan stored at 0 % interest opens with an empty rate and every edit is refused

- **Canonical severity:** LOW. kept LOW.
- **Absorbs:** A26-S19-06 (primary, 19-frontend-forms.md, session severity LOW).
- **Invariants and prior findings named:** none in the index (see field 4 of each member).
- **Lens:** frontend.

#### A26-S19-06 (primary) - A loan or mortgage stored at 0 % interest opens with an empty rate and every edit is refused by the required-field check

1. **Severity:** LOW
2. **Confidence:** medium (by reading; not executed)
3. **Location:** `frontend/src/components/accounts/AccountForm.tsx:427` (`interestRate: account.interestRate || undefined`), `:225, :233` (`requireField(data.interestRate === undefined, ...)` for MORTGAGE and LOAN).
4. **Violated invariant:** a known zero renders as a number (`frontend/CLAUDE.md`: never truthiness where 0 is a legitimate value).
5. **Reproduction:** an interest-free family loan or a 0 % promotional loan; the user renames the account.
6. **Observed:** the rate field is empty; Save reports that the interest rate is required.
7. **Expected:** the field shows 0 and the rename saves.
8. **Impact:** workflow friction on one account kind; no money moves (the user can retype 0).
9. **Root cause:** truthiness on a numeric API value.
10. **Recommended correction:** `account.interestRate != null ? Number(account.interestRate) : undefined`.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/frontend/src/components/accounts/AccountForm.tsx
+++ b/frontend/src/components/accounts/AccountForm.tsx
@@ -427 +427 @@
-          interestRate: account.interestRate || undefined,
+          interestRate: account.interestRate != null ? Number(account.interestRate) : undefined,
```

12. **Recommended regression test:** a LOAN with `interestRate: 0` renames and saves; the payload carries `interestRate: 0`.
13. **Suggested regression-test diff (illustrative, not applied):** in `AccountForm.test.tsx`, render the loan fixture with `interestRate: 0`, change the name, submit, and `expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ interestRate: 0 }))`.
14. **Verification method:** the test above fails at the baseline.
15. **Residual risks:** `creditLimit` 0 loads as `undefined` (`:416-418`) and is omitted on save, which leaves the stored 0 unchanged (harmless). Causality: `PRE_EXISTING_UNREPORTED` (S15 hand-off).


### A26-L34 - "Interest already saved" counts unrecorded interest as saved for a loan that books interest outside the app

- **Canonical severity:** LOW. kept LOW.
- **Absorbs:** A26-S20-06 (primary, 20-frontend-figures.md, session severity LOW).
- **Invariants and prior findings named:** none in the index (see field 4 of each member).
- **Lens:** frontend.

#### A26-S20-06 (primary) - "Interest already saved" counts unrecorded interest as saved for a loan that books interest outside the app

1. **Severity:** LOW
2. **Confidence:** high (executed, probe P8)
3. **Location:** `frontend/src/lib/loan-past-impact.ts:198-212` (`originalSchedule.totalInterest - (history.cumulativeInterest + projectedRemainingInterest)` with no gate on whether the history recorded interest); rendered by `components/accounts/loan-detail/PastImpactSection.tsx:60-66`.
4. **Violated invariant:** a measured zero and an unknown are different (`docs/frontend/financial-figures.md`, "A historical loan row states the ledger"): `cumulativeInterest` is the ledger's zero for a loan whose interest is booked elsewhere, which the doc accepts for history but which is not "interest not paid".
5. **Reproduction:** a 10,000 loan at 6 percent, four 500 payments of 450 principal and 50 interest. (A) interest recorded as separate expenses; (B) the same loan with interest booked in another application (principal-only rows).
6. **Observed:** `cumulativeInterest` A 200, B 0; `interestAlreadySaved` A 0.00, B 159.14.
7. **Expected:** B withheld (unknown) or equal to A; never 159.14.
8. **Impact:** 159.14 shown as saved interest that was in fact paid (bounded by the unrecorded interest, 200.00 here); on a long mortgage the figure grows with every year booked outside the app.
9. **Root cause:** the history has no "interest recorded" flag, and the saving subtracts its zero as a known amount; `observedInstallment` (`loan-history.ts:326-374`) already detects the same incomplete case for the payment.
10. **Recommended correction:** return `interestAlreadySaved: null` when no repayment recorded interest and the loan's rate is not zero (the `observedInstallment(...).complete === false` test).
11. **Suggested remediation diff (illustrative, not applied):**

```diff
-  const interestAlreadySaved =
-    originalSchedule.paidOff && projectedRemainingInterest !== null
+  const interestRecorded = history.cumulativeInterest > 0 || observedInstallment(history)?.complete === true;
+  const interestAlreadySaved =
+    originalSchedule.paidOff && projectedRemainingInterest !== null && interestRecorded
```

12-14. **Test / verification:** the probe (B equals A or is null) in `loan-past-impact.test.ts`; `npm run test -- loan-past-impact PastImpactSection`.
15. **Residual risks:** a loan that genuinely charged 0 interest so far must keep its figure; the gate needs the 0 percent case (`annualRate === 0`) the doc's "0 percent is a rate" rule names.

Causality: `PRE_EXISTING_UNREPORTED` (handed by S15, `15-loans-strategies.md` section 12).


### A26-L35 - The E2E release gate passes a test that failed twice out of three, never runs one of its tests, and swaps a shard for the cluster run

- **Canonical severity:** LOW. kept LOW.
- **Absorbs:** A26-S21-05 (primary, 21-tests-ci-release.md, session severity LOW).
- **Invariants and prior findings named:** none in the index (see field 4 of each member).
- **Lens:** ci.

#### A26-S21-05 (primary) - The E2E release gate passes a test that failed twice out of three, never runs one of its tests, and swaps a shard for the cluster run

1. **Severity:** LOW
2. **Confidence:** high
3. **Location:** `e2e/playwright.config.ts:12` (`retries: process.env.CI ? 2 : 0`, no `failOnFlakyTests`); `ci.yml:1466-1478` (matrix `shard: [1, 2, 3, 4]` plus `include: shard: 4, cluster: 'true'`, which adds `cluster` to the existing shard-4 entry instead of adding a fifth job); `e2e/tests/backup.spec.ts:160-163` (`test.skip(process.env.DEMO_MODE !== 'true')`) versus `docker-compose.e2e.yml:46` (`DEMO_MODE: "false"`); no `e2e/tsconfig.json` and no lint or type-check step for `e2e/` in any workflow.
4. **Violated invariant:** S21-I1 in its general form: a green gate means every test in it passed on the configuration it names.
5. **Reproduction scenario:** (a) an order-dependent race in the app that fails one attempt in two passes with retries 2 at probability 7/8 per test, and the run is green (S01 observed 6 such first-attempt failures at the baseline); (b) the "Restricted in Demo Mode" backup test runs in no job; (c) shard 4's quarter of the suite runs only against the two-replica stack, so a defect that appears with one backend in that quarter is not seen.
6. **Observed:** as above; the job comment `ci.yml:1451` says "Retries (2 in CI) absorb flakiness".
7. **Expected:** flaky tests fail the gate (Playwright `failOnFlakyTests: true` in CI, or a step that fails on a non-empty "flaky" count), every test runs in some job, and the cluster run is a fifth job.
8. **Impact:** test signal; the defects are in other findings.
9. **Root cause:** retries were added to absorb environment noise and absorb product races too.
10. **Recommended correction / 11. Suggested remediation diff (illustrative, not applied):**

```diff
--- a/e2e/playwright.config.ts
+++ b/e2e/playwright.config.ts
   retries: process.env.CI ? 2 : 0,
+  // A retry may rescue the run from the environment, never hide a product race.
+  failOnFlakyTests: !!process.env.CI,
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
       matrix:
-        shard: [1, 2, 3, 4]
-        include:
-          - shard: 4
-            cluster: 'true'
+        shard: [1, 2, 3, 4]
+        cluster: ['false']
+        include:
+          - shard: 4
+            cluster: 'true'
+            name-suffix: cluster
```

    (the second hunk needs the job name and the `--shard` arithmetic adjusted; maintainer decision whether the cluster job runs the whole suite or one shard). The DEMO test needs either a demo-mode job or deletion with its behaviour covered by a component test.
12. **Recommended regression test / 13. diff:** a guard asserting `failOnFlakyTests` is set when `CI` is, beside `ci-images.guard.spec.ts`.
14. **Verification method:** a deliberately flaky test (`expect(Math.random() > 0.5)`) must turn the job red.
15. **Residual risks:** turning flakes red will surface the six S01 observed; they then need root causes.

Causality: `PRE_EXISTING_UNREPORTED` (S01 handed DR-S01-5 and the shard note to S21).


### A26-L36 - `push:client:test` passes with zero discovered tests (MON-L07 residual)

- **Canonical severity:** LOW. kept LOW.
- **Absorbs:** A26-S21-06 (primary, 21-tests-ci-release.md, session severity LOW).
- **Invariants and prior findings named:** none in the index (see field 4 of each member).
- **Lens:** ci.

#### A26-S21-06 (primary) - `push:client:test` passes with zero discovered tests, and REL-001's "every runner fails on zero" does not hold for `node --test`

1. **Severity:** LOW
2. **Confidence:** high (executed)
3. **Location:** `backend/package.json` `push:client:test` = `node --test scripts/unifiedpush-client/*.test.cjs` (run by `ci.yml:78`); `docs/release-integrity.md:19-22`, `:70-73`; `backend/src/common/jest-config.guard.spec.ts` (scans for the flag only).
4. **Violated invariant:** REL-001 / S21-I1.
5. **Reproduction (executed in the scratch worktree):** `npm run push:client:test` at the baseline: `tests 10, pass 10`, exit 0. Rename `core.test.cjs` to `core.spec.cjs`: `tests 0, pass 0`, **exit 0**. Separately, `node --test empty.test.cjs` on a file declaring no test exits 0; a missing explicit file exits 1. The four other `node --test` steps in CI name explicit files, so they fail on a missing file but pass on a file emptied of tests.
6. **Observed / 7. Expected:** a renamed or moved push-client test silently drops out of `backend-lint`; expected exit 1 with zero tests.
8. **Impact:** test signal for the push tooling under `backend/scripts/` (INV-PUSH tooling, not the server); narrow.
9. **Root cause:** Node's test runner treats an empty set as success, and the guard only looks for a flag.
10. **Recommended correction / 11. diff (illustrative, not applied):**

```diff
--- a/backend/package.json
+++ b/backend/package.json
-    "push:client:test": "node --test scripts/unifiedpush-client/*.test.cjs",
+    "push:client:test": "node --test scripts/unifiedpush-client/core.test.cjs",
```

    and, for the general rule, a case in `jest-config.guard.spec.ts` refusing a `node --test` command whose arguments contain a glob.
12. **Regression test / 13. diff:** the guard case above (`expect(script).not.toMatch(/node --test[^&|]*\*/)` over every `package.json` script and workflow `run:`).
14. **Verification:** rename the file again; the step must exit 1.
15. **Residual:** an explicit file emptied of tests still passes; Node has no "fail on zero" switch, so a count assertion (REL-002) is the only full answer.

Causality: `NEW_SINCE_UPSTREAM_AUDIT` (the push tooling postdates `d5cea9bf`). Also a documentation inconsistency (MON-L07 residual, section 11).


### A26-L37 - Coverage excludes every DTO; two cross-field or privacy constraints there are held by no test

- **Canonical severity:** LOW. kept LOW.
- **Absorbs:** A26-S21-07 (primary, 21-tests-ci-release.md, session severity LOW).
- **Invariants and prior findings named:** none in the index (see field 4 of each member).
- **Lens:** test.

#### A26-S21-07 (primary) - Coverage excludes every DTO, and two cross-field or privacy constraints that live only there are held by no test

1. **Severity:** LOW (test coverage; the code is correct at the baseline)
2. **Confidence:** high (executed)
3. **Location:** `backend/package.json` `jest.collectCoverageFrom` `"!src/**/*.dto.ts"` (also `*.entity.ts`, `*.module.ts`); `backend/src/emergency-access/dto/upsert-settings.dto.ts:12-36` (`ReminderLtGrantConstraint`, the only place `reminderAfterDays < grantAfterDays` is enforced: the monitor, `emergency-access-monitor.service.ts:892`, only compares days since login with each threshold); `backend/src/backup/support-backup/dto/create-support-backup.dto.ts:36-56` (`IsNonIntegerMultiplierConstraint`: the de-identifying multiplier must not be an integer); 26 DTO files carry 46 `@Transform` decorators and five carry custom constraints, three of them with no spec of their own.
4. **Violated invariant:** S21-I5 (the coverage gate measures the code that carries behaviour) and S21-I4.
5. **Reproduction (executed in the scratch worktree):** (a) `ReminderLtGrantConstraint.validate` -> `return true`: `npx jest src/emergency-access` 4 suites, 128 tests, all pass. (b) `IsNonIntegerMultiplierConstraint.validate` without `!Number.isInteger(value)`: `npx jest src/backup/support-backup` 5 suites, 64 tests, all pass. No integration suite goes through HTTP (0 of 118 import `supertest`; `emergency-access-grant-cycles.integration.spec.ts:198` calls `upsertSettings` directly), and no E2E spec sets `reminderAfterDays`.
6. **Observed:** with (a), an owner can save "remind after 30 days, grant after 7": the monitor grants the emergency contact access on day 7 and the owner's warning never precedes it. With (b), a support backup can be made with multiplier 2, so every private amount is recoverable by halving.
7. **Expected:** each cross-field or privacy rule in a DTO is pinned by a `validate()`-level spec, and the coverage gate counts DTO files (their decorators execute at import, so including them costs nothing but exposes untested constraint and transform bodies).
8. **Impact:** security and privacy rules that one refactor can drop with every gate green; no present-day defect.
9. **Root cause:** DTOs were excluded as declarative files; some now hold logic.
10. **Recommended correction:** drop `!src/**/*.dto.ts` from `collectCoverageFrom` (check the thresholds still hold) and add the two specs.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/package.json
+++ b/backend/package.json
     "collectCoverageFrom": [
       "src/**/*.(t|j)s",
       "!src/main.ts",
       "!src/**/*.module.ts",
       "!src/**/*.entity.ts",
-      "!src/**/*.dto.ts",
       "!src/database/seed*.ts",
```

12. **Recommended regression test / 13. Suggested regression-test diff (illustrative, not applied):**

```ts
// backend/src/emergency-access/dto/upsert-settings.dto.spec.ts
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { UpsertSettingsDto } from "./upsert-settings.dto";

it("refuses a reminder that does not come before the grant", () => {
  const dto = plainToInstance(UpsertSettingsDto, { enabled: true, grantAfterDays: 7, reminderAfterDays: 7 });
  expect(validateSync(dto).map((e) => e.property)).toContain("reminderAfterDays");
});
```

    and the same shape for `CreateSupportBackupDto` with `multiplier: 2`.
14. **Verification:** re-apply both mutations; the new specs must fail.
15. **Residual:** excluding `*.entity.ts` was tested the same way and is held: the entity `numericTransformer` mutation `null -> 0` in `investment-transaction.entity.ts:22-26` is killed by `security-transfer.integration.spec.ts` ("is stored as unknown for ADD_SHARES"). The frontend exclusion of `src/proxy.ts` hides nothing measurable either: measured alone, its own tests cover it at 97.05 % statements, 95.16 % branches, 100 % functions.

Causality: `PRE_EXISTING_UNREPORTED`.


### A26-L38 - A manual close in the middle of a budget period leaves the budget with no OPEN period for good

- **Canonical severity:** LOW. kept LOW.
- **Absorbs:** A26-S16-07 (primary, 16-budgets-reports.md, session severity LOW).
- **Invariants and prior findings named:** none in the index (see field 4 of each member).
- **Lens:** financial.

#### A26-S16-07 (primary) - A manual close in the middle of a period leaves the budget with no OPEN period for good

1. **Severity:** LOW
2. **Confidence:** high (executed, P3)
3. **Location:** `budget-period.service.ts:177, 214-260` (`createNextPeriod` -> `createPeriodForBudget` -> `getCurrentMonthPeriodDates()`), route `budgets.controller.ts:295-303`; `budget-period-cron.service.ts:152-154` skips a budget with no OPEN period.
4. **Violated invariant:** after a close, exactly one OPEN period exists for the following period (state machine).
5. **Reproduction (executed):** with October 2026 OPEN, `POST /budgets/:id/periods/close` on 2026-10-21.
6. **Observed:** October CLOSED; the next-period insert uses `period_start 2026-10-01`, hits `ON CONFLICT DO NOTHING` and returns the just-closed row; no OPEN period; `getOrCreateCurrentPeriod` returns the CLOSED October row (probe P3 `{"after":[...CLOSED, CLOSED],"current":"CLOSED"}`); the November cron finds no OPEN period and skips the budget every month after.
7. **Expected:** the next period starts the day after the closed period ends (November), or a close before `period_end` is refused.
8. **Impact:** the period history stops for that budget; the live budget page is unaffected (it reads the calendar month). Reachable only through the API: no frontend component calls `budgetsApi.closePeriod` (`frontend/src/lib/budgets.ts:161`). The same date rule makes a late cron (a replica down over a month boundary) skip the missed months silently.
9. **Root cause:** the next period's dates come from the wall clock, not from the closed period.
10. **Recommended correction:** derive the next period from `closedPeriod.periodEnd + 1 day` (`getMonthPeriodDates`), and refuse a manual close before `period_end` (maintainer decision).
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/budgets/budget-period.service.ts
+++ b/backend/src/budgets/budget-period.service.ts
@@ async createPeriodForBudget(
     budget: Budget,
     rolloverMap?: Map<string, number>,
     manager?: EntityManager,
+    dates: PeriodDateRange = getCurrentMonthPeriodDates(),
   ): Promise<BudgetPeriod> {
-    const { periodStart, periodEnd } = getCurrentMonthPeriodDates();
+    const { periodStart, periodEnd } = dates;
@@ private async createNextPeriod(
-    return this.createPeriodForBudget(budget, rolloverMap, manager);
+    return this.createPeriodForBudget(
+      budget, rolloverMap, manager, followingMonthPeriodDates(closedPeriod.periodEnd),
+    );
```

12. **Recommended regression test:** the P3 scenario: after a close dated inside the period, exactly one OPEN period exists and it starts the next month (or the close is refused with 400).
13. **Suggested regression-test diff:** as item 12 in a budget period integration spec.
14. **Verification:** `npm run test:integration -- budget`.
15. **Residual risks:** with dates derived from the closed period, a two-month outage creates the missed month as OPEN and the next cron closes it; whether to back-fill is a product decision.

Causality: `PRE_EXISTING_UNREPORTED`.


### A26-L39 - Two flex groups over 90 percent share one alert fingerprint, so the second is never raised in the period

- **Canonical severity:** LOW. kept LOW.
- **Absorbs:** A26-S16-08 (primary, 16-budgets-reports.md, session severity LOW).
- **Invariants and prior findings named:** MON-L03.
- **Lens:** financial.

#### A26-S16-08 (primary) - Two flex groups over 90 percent share one alert fingerprint, so the second is never raised in the period

1. **Severity:** LOW
2. **Confidence:** high (executed at the SQL level, P4)
3. **Location:** `budget-alert.service.ts:589-608` (`budgetCategoryId: null`, one `FLEX_GROUP_WARNING` per group, group name only in `data`); `database/schema.sql:2483-2490`; `deduplicateAlerts` `:689-714` matches on `(type, budgetCategoryId)` only.
4. **Violated invariant:** one alert per logical condition (MON-L03's own statement, "one logical alert fingerprint per budget period").
5. **Reproduction (executed):** two `FLEX_GROUP_WARNING` rows for one budget and period with different group names.
6. **Observed:** first insert 1 row, second 0 rows (probe P4 `flexFun 1, flexDining 0`); on later days `deduplicateAlerts` also filters the second group against the first.
7. **Expected:** one alert per flex group.
8. **Impact:** a user with two overspent flex groups is told about one.
9. **Root cause:** the fingerprint identifies a budget-wide alert by `(budget, period, type, NULL category, severity)` and flex groups have no column of their own.
10. **Recommended correction:** add the group to the key (a migration widening the fingerprint with `COALESCE(data->>'flexGroup', '')`, mirrored in `deduplicateAlerts`).
11. **Suggested remediation diff (illustrative, not applied):** a timestamped migration dropping and recreating `idx_notifications_fingerprint` with the extra expression, the same in `database/schema.sql`, and `e.data?.flexGroup === candidate.data?.flexGroup` added to the `deduplicateAlerts` match.
12. **Recommended regression test:** two groups at 95 percent produce two rows.
13. **Suggested regression-test diff:** a `budget-alert.service.spec.ts` case for `deduplicateAlerts` plus an integration insert pair.
14. **Verification:** `npm run migration:lint`, `scripts/verify-schema.sh`, the integration case.
15. **Residual risks:** the migration's preflight must not collapse legitimate rows.

Causality: `PRE_EXISTING_UNREPORTED` (the fingerprint shape is from migration 140).


## 8. Security and RLS findings

Two HIGH findings are exploitable now without a second defect. A26-H01 is in the refresh-token
reuse branch: the family revocation runs in the same `withScopedDb` transaction as the
`UnauthorizedException` that reports the reuse, so it is rolled back, and the existing unit tests
assert only that `manager.update` was called (known-wrong, section 13). A26-H02 is in the email
receipt sender check: a pasted "Forwarded message" block replaces the envelope sender, so any
address can submit a trade the parser attributes to a broker; with auto-apply it is booked.

The MEDIUM register repeats one shape across credential and delegation code: an authorization or
a snapshot is read in one transaction and the write lands in another (A26-M01, A26-M02, A26-M04,
A26-M05; D-S03-01 and D-S04-05 in section 15). A26-M06 is the RLS policy that would contain a
mistake in that code and does not. A26-M03 matters for sequencing: fixing A26-H01 makes the
false "token theft" of two tabs refreshing at once fire for real, so the two land in one task.
A26-M17 (user actions create global currencies) and A26-M36 (another person's portfolio series
from `sessionStorage`) are tenancy defects outside the database. No session found a cross-tenant read
through RLS on a current application path (S04).

| ID | Severity | Title | Session findings |
| --- | --- | --- | --- |
| A26-H01 | HIGH | Refresh-token reuse detection does not revoke the family: the revocation is rolled back by the exception that reports it | A26-S03-01 |
| A26-H02 | HIGH | Any sender can make an email read as the broker's by pasting a forwarded-message header block; with auto-apply the trade it states is booked | A26-S11-04 |
| A26-M01 | MEDIUM | A successful password login writes the pre-bcrypt snapshot back and restores the failed-login counter it just reset | A26-S03-02 |
| A26-M02 | MEDIUM | Change-password, admin reset/disable and owner-of-delegate reset end refresh sessions with one blanket UPDATE that misses a concurrently inserted successor | A26-S03-07 |
| A26-M03 | MEDIUM | Two tabs refreshing at once read as token theft: the family is revoked and every session ends with no explanation | A26-S18-06 |
| A26-M04 | MEDIUM | Grantee and cross-owner writes are authorized in earlier transactions and written under the system bypass without a re-check | A26-S04-01 |
| A26-M05 | MEDIUM | Delegation management reads in one transaction and writes back the stale entity in another: a revoked delegation is re-instated | A26-S04-02 |
| A26-M06 | MEDIUM | The `account_delegates` and `account_delegate_grants` policies let a delegate-side session issue itself a delegation from any owner | A26-S04-03 |
| A26-M17 | MEDIUM | User actions create or leave global, active currencies offered to every user (MNY import, preferences, deleted users' custom currencies) | A26-S09-06, A26-S13-06 |
| A26-M36 | MEDIUM | The intraday portfolio series is cached in sessionStorage with no user or acting-context key and survives sign-out and context switches | A26-S20-04, A26-S18-08 |
| A26-L06 | LOW | `JwtStrategy` accepts every `JWT_SECRET`-signed token except `2fa_pending` as an access token | A26-S03-03 |
| A26-L07 | LOW | Admin and owner-of-delegate password resets revoke PATs and trusted devices in a separate transaction from the password write | A26-S03-05 |
| A26-L08 | LOW | Per-user TOTP and step-up attempt budgets are enforced by peek-then-verify | A26-S03-06 |

## 9. Database, migration, backup and restore findings

The backup lens is largely closed: S06 verified eleven upstream findings fixed (MON-H02, M08-M13,
M16-M18, L05 and the backup half of M11). What remains is the legacy flat-root retention sweep
that deletes other owners' pre-upgrade artifacts (A26-M07), the S3 target's only bucket-backed
suite that never runs in CI and fails when run (A26-M08), restore staging without upload intents
(A26-L10) and the absence of semantic backfills on restore (A26-L11). Migrations replay as a
no-op on `schema.sql` (S05, `scripts/verify-schema.sh` twice); one migration contracts a column
the previous release still reads (A26-L09). The MNY import is the data lens's HIGH (A26-H08).

| ID | Severity | Title | Session findings |
| --- | --- | --- | --- |
| A26-H08 | HIGH | A failure after the MNY import's data commit is reported as "Nothing was saved", and the same file can then be imported again | A26-S09-01, A26-S02-05, A26-S18-05 |
| A26-M07 | MEDIUM | Automatic-backup retention deletes legacy flat-root artifacts of other owners (MON-H01 residual, MON-M43) | A26-S06-01, A26-S02-06 |
| A26-L09 | LOW | `20260908120000_remove_notification_browser.sql` drops a column the previous release still selects | A26-S05-02 |
| A26-L10 | LOW | Restore staging writes external attachment objects without an upload intent (MON-M22 residual) | A26-S06-03 |
| A26-L11 | LOW | A restore applies no semantic backfill to rows from an older artifact (`skip_price_updates`) | A26-S06-04, A26-S05-03 |
| A26-L14 | LOW | A staged MNY file can still be deleted under a job that was just created (MON-L04 residual) | A26-S09-04 |
| A26-L16 | LOW | Deleting a rule leaves its open AI review requests rule-less, and they block the email-receipt review of the same transaction | A26-S10-04 |
| A26-L18 | LOW | The trade card's preview can call the FX provider inside the pipeline's receipt transaction | A26-S11-03 |
| A26-L28 | LOW | The portfolio-movement alert commits its new baseline before it writes the notification | A26-S17-06 |

## 10. Backend transaction and concurrency findings

The program's most frequent root: a delta, a status or a whole entity derived from a row read
before the write transaction's lock (A26-H03, A26-H04, A26-H06, A26-M09, A26-M13, A26-L19), or a
single-use action not pinned to the identity the user saw (A26-H07). The house mechanisms exist and
are used on the main paths (`lockTransactionRow`, the compare-and-set in `updateTransfer`, the
occurrence claims, the job leases); the defects are the branches left out when those mechanisms
were introduced, and the guards that hold them match per file or per public method, so a private
branch escapes (`derived-state-writers.guard.spec.ts`, `reconciled-lock.guard.spec.ts`). Two
post-commit shapes recur: a failure after the commit reported as "nothing happened" (A26-H08,
A26-M14) and leases shorter than the work they guard (A26-L13).

| ID | Severity | Title | Session findings |
| --- | --- | --- | --- |
| A26-H03 | HIGH | Transfer edit paths derive both balance deltas from pre-transaction snapshots (split-transfer leg, connected cross-owner transfer) | A26-S07-01, A26-S02-01 |
| A26-H04 | HIGH | Editing an investment transaction twice at once, or while it is deleted, duplicates or orphans its cash leg | A26-S12-01 |
| A26-H07 | HIGH | Manual post and skip of a scheduled transaction are not pinned to the occurrence the user saw; a stale view pays a bill twice or consumes the next occurrence | A26-S08-01, A26-S02-04 |
| A26-M09 | MEDIUM | VOID crossings are decided from a status read before the row lock (bulk VOID expansion and `addSplit`; MON-H10 residual) | A26-S07-03, A26-S02-07 |
| A26-M13 | MEDIUM | A whole-entity save or an absolute write puts a snapshot's `current_balance` back: investment-pair rename or re-currency, QIF/CSV opening balance | A26-S07-07, A26-S10-05 |
| A26-M14 | MEDIUM | An error after a single-use write commits is reported as a failure, so the offered retry writes again (scheduled post and its cron alert, AI action confirm) | A26-S08-02, A26-S17-02 |
| A26-M19 | MEDIUM | Deleting an account checks "no transactions" in one transaction and deletes in another: a concurrent sync or import is cascaded away | A26-S10-03 |
| A26-L13 | LOW | Job leases are shorter than the provider calls they guard and the saves are not fenced by the lease token (AI insights, email-receipt poll) | A26-S08-04, A26-S11-01 |
| A26-L19 | LOW | The security-transfer edit writes and validates before taking the holdings lock, from snapshots of both legs | A26-S12-07 |

## 11. Financial-correctness findings

Four invariant families carry the financial HIGH findings: "a rate for a date" (A26-H11; INV-FX-001,
INV-FX-003), "rate 1 means same currency, never no rate" (A26-H10), "convert before summing"
(A26-H12) and "a subtotal is not a total" (A26-H15, A26-M38). Each has a shared helper in the
codebase (`resolveFxRate`, `FxAggregate`, `sumConverted`, the completeness flags) that the failing
surfaces do not call. Ledger arithmetic proper (signs, splits, VOID inclusion, deletion effects)
holds on the main paths; the defects are on edges: bulk delete of a split leg (A26-H05), a QIF or
MNY writer that leaves one leg in the wrong currency (A26-M16, A26-M18), loan-history inclusion
(A26-M28), installments below the interest (A26-M29), budget periods (A26-M31, A26-M32), and the
custom report engine (A26-H12, A26-M33, A26-L12).

| ID | Severity | Title | Session findings |
| --- | --- | --- | --- |
| A26-H05 | HIGH | Bulk-deleting one leg of a split transfer deletes the parent but leaves the other legs, creating their money | A26-S13-03 |
| A26-H06 | HIGH | Undo or redo of an account edit restores a whole-entity snapshot: the edit-time balance is written back absolutely and a loan's coupled template is left unrepriced or unlinked | A26-S07-02, A26-S15-01 |
| A26-H09 | HIGH | A bank transaction whose entry reference the bank repeats on a later day is imported twice, or a later one is silently dropped (INV-BANKSYNC-001) | A26-S10-01 |
| A26-H10 | HIGH | Built-in reports convert a missing exchange rate 1:1 and label the result in the reporting currency (MON-H12, MON-M39) | A26-S13-01, A26-S02-02 |
| A26-H11 | HIGH | A rate for a date is not the resolver's: the latest-rate readers use a frozen pre-1.17 mirror row and a rate of any age, and back-dated trades settle or prefill at the newest rate (INV-FX-001, INV-FX-003) | A26-S13-02, A26-S12-02, A26-S19-04, A26-S18-04 |
| A26-H12 | HIGH | Totals sum amounts of different currencies without conversion: budget actuals, the custom report engine and the AI/MCP transaction analytics | A26-S16-01, A26-S16-06, A26-S17-01 |
| A26-M10 | MEDIUM | `PATCH /transactions/:id` changes the amount, rate or account of one transfer leg only (MON-H11 server residual) | A26-S07-04 |
| A26-M11 | MEDIUM | The strict reconciled lock is skipped on split-transfer leg and cross-owner transfer edits and deletes | A26-S07-05, A26-S02-08 |
| A26-M12 | MEDIUM | An account closes over a pending future-dated row, which the due-balance cron later applies to the closed account (MON-M20 residual) | A26-S07-06 |
| A26-M15 | MEDIUM | `post()` advances the cursor past its own slot only, so a slot a settlement rule claimed ahead of the cursor becomes `next_due_date` and the schedule stalls | A26-S08-03 |
| A26-M16 | MEDIUM | A cross-currency transfer into an investment sleeve credits the bank account's amount under the sleeve's currency (MNY import) | A26-S09-03 |
| A26-M18 | MEDIUM | A QIF split-transfer leg into another account is written in the source account's currency and amount (MON-H11 QIF half) | A26-S10-02, A26-S02-09 |
| A26-M20 | MEDIUM | An AI or MCP edit that names no rate replaces the row's own exchange rate with a freshly resolved market rate (INV-FX-002) | A26-S12-03 |
| A26-M21 | MEDIUM | Realized gains and capital-gains replays price a transferred-in lot at the carried per-share figure and rate 1 (MON-M35 residual) | A26-S12-04 |
| A26-M22 | MEDIUM | A security transfer's basis is the leg's stored price (today's average on create, the client's figure on edit); the form shows an editable cost the server replaces | A26-S12-05, A26-S19-05 |
| A26-M23 | MEDIUM | The holdings fold snaps every intermediate position under 0.0001 shares to zero | A26-S12-06 |
| A26-M24 | MEDIUM | A Money-imported trade of a security quoted in another currency stores its price and total in the account's currency, read as the security's | A26-S12-09 |
| A26-M26 | MEDIUM | On a day the bond engine refuses to price, the blend readers still value the holding; current per-account surfaces use the blended price (INV-BOND-010) | A26-S14-01, A26-S14-02 |
| A26-M27 | MEDIUM | GEM momentum prices one role from a close up to 14 days before the boundary while its series holds a later close | A26-S15-02 |
| A26-M28 | MEDIUM | The loan payment history counts VOID payments, VOID interest expenses and future-dated payments as paid | A26-S15-03 |
| A26-M29 | MEDIUM | An installment below the period's interest is booked as settling the period; the unpaid interest is recorded nowhere | A26-S15-04 |
| A26-M30 | MEDIUM | Loan payment setup accepts a source account in another currency; every posting of the bill is then refused | A26-S15-10 |
| A26-M31 | MEDIUM | The account exclusions chosen in the budget wizard are stored and never applied | A26-S16-02 |
| A26-M32 | MEDIUM | Closing a budget period never writes a rollover: `closePeriod` does not load the relation `computeRollover` reads | A26-S16-03 |
| A26-M33 | MEDIUM | A category's cost is not its signed sum: the custom report engine sums absolute values, the loan summary adds an interest refund to "Interest Paid" | A26-S16-05, A26-S15-05 |
| A26-M34 | MEDIUM | The AI and MCP `spending_anomalies` report passes the requested number of months as the z-score threshold | A26-S17-03 |
| A26-M38 | MEDIUM | Portfolio gain is the priced market value less the cost of every holding, so an unpriced holding reads as a loss of its whole cost | A26-S20-02 |
| A26-L12 | LOW | The custom-report text filter is a second search door with unescaped LIKE wildcards (INV-SEARCH-001) | A26-S07-08 |
| A26-L17 | LOW | A trade email that states only a price books a total derived from the price rounded to 4 decimals (INV-TRADE-001) | A26-S11-02 |
| A26-L20 | LOW | The price-window fill remembers a month as empty when one provider answered nothing and another failed | A26-S12-08 |
| A26-L21 | LOW | The undo/redo holdings fold adds a dividend's total to the basis and stores the average at 6 decimals | A26-S12-10 |
| A26-L22 | LOW | A benchmark observation stored outside the 06:25 run is not followed by a price recompute | A26-S14-03 |
| A26-L23 | LOW | A loan owing exactly one minor unit is treated as paid off on both layers | A26-S15-06 |
| A26-L24 | LOW | The GEM signal-change alert is not bound to the current period and its dedupe memory is purged after the retention window | A26-S15-07 |
| A26-L29 | LOW | The insights aggregator computes the month start as a local-midnight date read back in UTC | A26-S17-07 |
| A26-L38 | LOW | A manual close in the middle of a budget period leaves the budget with no OPEN period for good | A26-S16-07 |
| A26-L39 | LOW | Two flex groups over 90 percent share one alert fingerprint, so the second is never raised in the period | A26-S16-08 |

## 12. Frontend, contract, cache, date and localization findings

The transfer form is where the frontend can write wrong money: opening a cross-currency transfer
from its receiving leg (A26-H13) and switching an existing row to Transfer mode (A26-H14). The
figure surfaces read the server's completeness flags in some places and not in others (A26-H15);
a failed request is rendered as an empty or zero figure on three surfaces (A26-M39). The client
cache invalidates by route list and by hand-rolled reads, so recategorising, non-ledger valuation
inputs and imports leave derived figures stale (A26-M35). Four-decimal amounts are blurred to two
(A26-M37). Locale and catalog bypasses are LOW (A26-L30).

| ID | Severity | Title | Session findings |
| --- | --- | --- | --- |
| A26-H13 | HIGH | A cross-currency transfer opened from its receiving leg loads the received amount into the source-amount field, and an unedited save re-prices the transfer (MON-H11 client half) | A26-S19-01 |
| A26-H14 | HIGH | Switching an existing income, expense or split to Transfer mode creates a second, new transfer and leaves the original row in place | A26-S19-02 |
| A26-H15 | HIGH | Completeness flags are not carried or read where totals are shown: net worth, accounts, portfolio widget and history, the AI/MCP account tools, report exports and Cash Flow | A26-S20-01, A26-S02-03, A26-S13-04, A26-S16-04 |
| A26-M25 | MEDIUM | Choosing a default currency that is not yet in the table fails on the foreign key: onboarding on a fresh instance accepts only USD | A26-S13-05 |
| A26-M35 | MEDIUM | Client caches outlive the data they derive from: recategorising writes, non-ledger valuation inputs and MNY imports invalidate nothing, and hand-rolled reads are not generation-aware (INV-CACHE-001 client half) | A26-S18-01, A26-S18-02, A26-S18-03, A26-S18-07 |
| A26-M37 | MEDIUM | Four-decimal amounts are loaded and blurred at two decimals, so an unedited save re-amounts a row or is refused (MON-M37) | A26-S19-03 |
| A26-M39 | MEDIUM | A failed or pending request is shown as data: reports keep the previous window through a failed reload, the country view and the dashboard render a failure as empty or zero | A26-S20-03, A26-S20-05, A26-S20-08 |
| A26-L25 | LOW | Loan Amortization Report: "Original Amount" double-counts projected principal when the opening balance is unset; exports run while loading | A26-S15-08 |
| A26-L26 | LOW | The Post dialog previews the stored template's principal/interest split while the post re-prices the bill from the ledger | A26-S15-09 |
| A26-L27 | LOW | A price push's chart token lives five minutes, the push it rides on four hours | A26-S17-04 |
| A26-L30 | LOW | Figures and labels bypass the reader's number locale and the message catalog (lib formatters, form readouts, figure surfaces) | A26-S18-09, A26-S19-07, A26-S20-07 |
| A26-L31 | LOW | The client forecast accumulates floats and rounds the projected balance with `Math.round(x * 100) / 100` | A26-S18-10 |
| A26-L32 | LOW | Frontend response types drop signals the backend sends (contract drift) | A26-S18-11 |
| A26-L33 | LOW | A loan stored at 0 % interest opens with an empty rate and every edit is refused | A26-S19-06 |
| A26-L34 | LOW | "Interest already saved" counts unrecorded interest as saved for a loan that books interest outside the app | A26-S20-06 |

## 13. Test and CI findings

The suites are large and green at the baseline, and the coverage gates hold; what they lack is the
production boundary. S21's program table (59 undetected mutation rows in eleven families) shows
that removing a lock, a lease predicate, a compare-and-set, an RLS predicate or a post-commit
ordering leaves every committed suite green, because the integration harness has no two-connection
primitive, builds its schema from entities (15 unique keys and 82 CHECKs missing), and replaces the
scheduled module with stubs (A26-M42). The release path publishes before it gates and never boots
the image it publishes (A26-M40, A26-M41), and the audited revision itself has no hosted CI run
(section 2). Ten tests assert a defect (known-wrong, appendix B); the first of them is the
`report-currency.service.spec.ts:213` case that `docs/verification-contract.md` section 5 listed as
"not located".

| ID | Severity | Title | Session findings |
| --- | --- | --- | --- |
| A26-M08 | MEDIUM | The S3 half of INV-BACKUP-006 rests on a suite that never runs in CI and fails when it does; no local/S3 attachment round trip exists (MON-M47) | A26-S06-02, A26-S06-05 |
| A26-M42 | MEDIUM | The concurrency, post-commit and database-boundary invariants behind the program's HIGH and MEDIUM findings have no test at the production boundary (MON-M46) | A26-S21-04, A26-S03-04, A26-S04-04, A26-S05-01, A26-S07-09, A26-S08-05, A26-S16-09, A26-S17-05, A26-S02-12, A26-S06-06, A26-S09-02 |
| A26-L05 | LOW | `fx-fallback.guard.spec.ts` cannot see a camelCase rate fallback | A26-S02-11 |
| A26-L37 | LOW | Coverage excludes every DTO; two cross-field or privacy constraints there are held by no test | A26-S21-07 |
| ID | Severity | Title | Session findings |
| --- | --- | --- | --- |
| A26-M40 | MEDIUM | The production image is never exercised: no CI gate boots the published target, and both documented Compose deployments mount backup and attachment directories the backend user cannot write | A26-S21-01, A26-S21-03 |
| A26-M41 | MEDIUM | Release publication precedes the gates: images reach `:latest` before the CVE gate, and the release job pushes an untested `[skip ci]` bump with an admin token (MON-M45) | A26-S21-02, A26-S02-10 |
| A26-L01 | LOW | CI's backend lint step runs `eslint --fix`, so a fixable lint error never fails CI | A26-S01-01 |
| A26-L02 | LOW | The `WITH_CONTEXT_ALLOWLIST` lint fence misses several import forms | A26-S01-02 |
| A26-L35 | LOW | The E2E release gate passes a test that failed twice out of three, never runs one of its tests, and swaps a shard for the cluster run | A26-S21-05 |
| A26-L36 | LOW | `push:client:test` passes with zero discovered tests (MON-L07 residual) | A26-S21-06 |

## 14. Documentation inconsistencies

Cross-cutting roots (S23 consolidation):

1. **Status words without their mechanism.** Several `enforced` entries in
   `docs/system-invariants.md` name a mechanism that covers only part of the paths: INV-BANKSYNC-001
   names only the hash-to-ref path (A26-H09), INV-IMPORT-003's entry names one writer of three
   (A26-L15), INV-BOND-010 lists only historical series (A26-M26), INV-CACHE-001 reads `enforced`
   while undo dispatches no recompute (section 15, S13), INV-BACKUP-006's text claims a rejected
   put from a checksum-ignoring S3 service (A26-M08). The remediation tasks name the entry each fix
   must correct.
2. **Two-transaction prescriptions.** `docs/backend/database-access-and-tenancy.md:31, 35` and
   `rls-context-smoke.spec.ts` prescribe the shape behind A26-M04 and A26-M05 (D-S04-05).
3. **Instruction files.** A26-L03 (local coverage run), A26-L04 (`npm install*` pre-approved);
   `AGENTS.md`'s "`TZ=UTC npm run test:unit -- --coverage` # what CI runs" while CI sets no `TZ`
   (DR-S01-4).
4. **Release and deployment docs.** The Compose deployments the README documents cannot write
   backups (A26-M40); INV-RELEASE-001's retry semantics describe a double bump where a re-dispatch
   reuses a version for a different digest (A26-M41); `docs/verification-contract.md` section 5's
   "not located" item 1 is located (appendix B).

| ID | Severity | Title | Session findings |
| --- | --- | --- | --- |
| A26-L03 | LOW | The layer instruction files order a local coverage run that `AGENTS.md` and the verification contract say is CI's | A26-S01-03 |
| A26-L04 | LOW | `.claude/settings.json` pre-approves `npm install*`, an action `AGENTS.md` lists under "Ask first" | A26-S01-04 |
| A26-L15 | LOW | INV-IMPORT-003 is still unenforced on the MNY and QIF writers, and its index entry names one path of three | A26-S09-05 |

The per-session registers follow verbatim (section 11 of each report; sessions without entries
are omitted).

#### S01 (`01-baseline.md` section 11)

| # | Where | Inconsistency |
| --- | --- | --- |
| D1 | `docs/audits/2026-10/plan.md` s1 | "Invariant index at baseline: 145 entries: 126 enforced, 19 partial, 1 unenforced" sums to 146. The index table says 126/18/1; the entry bodies say 125/19/1. The difference is INV-BONDNOTIFY-003 (D2). |
| D2 | `docs/system-invariants.md` | INV-BONDNOTIFY-003: index row `enforced`, entry body `Status partial` ("no guard scanning the rules for a recomputed figure"). The plan's list of 19 non-enforced IDs omits it. |
| D3 | `docs/audits/2026-10/plan.md` s1 | "40 cron jobs": the code and `docs/cron-jobs.md` have 49 `@Cron` handlers in 46 services. |
| D4 | `docs/audits/2026-10/plan.md` s5 | `backend/src/import-preview/` is "2k"; measured 222 non-test lines (`.ts`). MNY import "73k": `backend/src/import/` is 22.8k non-test `.ts` lines, 83k including non-`.ts` files. Bonds "18k": 13.9k `.ts`, 21.6k all files. |
| D5 | `docs/backend/testing.md:95` | Recommends injecting repository mocks via `getRepositoryToken()`; production services inject only `DataSource` and the working pattern is `createScopedDbMocks` (`src/built-in-reports/tax-recurring-reports.service.spec.ts:143-163` carries both, the token providers dead). Not scanned by `lint-bans.spec.ts`. MON-M02 residual. |
| D6 | `backend/src/mcp/CLAUDE.md` | "Three of them hold on every change here" followed by four bullets. |
| D7 | `CONTRIBUTING.md:39-43` | "Two of them are worth restating" followed by three bullets. |
| D8 | `docs/system-invariants.md` INV-CRON-001 (from line 5745) | Says the budget rollover is guarded by "ON CONFLICT ... with the loser re-reading the winner"; the code (`budget-period-cron.service.ts:121,203`) and `docs/cron-jobs.md` use `claimOnce` plus `releasePermanentClaim`. |
| D9 | `docs/cron-jobs.md:27` | The `processAutoPostTransactions` row omits the `scheduled_transaction_postings ON CONFLICT (scheduled_transaction_id, original_due_date)` claim (`scheduled-transactions.service.ts:3651`) that `concurrency-and-idempotency.md` names. |
| D10 | `docs/cron-jobs.md:36` | The `closeExpiredPeriods` row does not mention the monthly summary email (`budget-period-cron.service.ts:228,401`), guarded only by the per-owner `claimOnce`, with no delivery record. |
| D11 | `docs/system-invariants.md` INV-HA-001 | Prose says "The E2E above does not exist yet"; Required tests says the positive half exists (`e2e/tests/cluster.spec.ts:117-118` asserts the 200 case). |
| D12 | `docs/system-invariants.md` INV-LOAN-HISTORY-001 | The second gap ("no reader branches on `interest_booking_mode`") is stale: `loan-installments/plan-loan-settlement.ts:231` and `transaction-rules/rule-loan-settlement.ts:165` branch on it; the history producer still does not. |
| D13 | `docs/system-invariants.md` INV-RULE-002 | The call-site list omits `bank-sync/bank-sync-writer.service.ts:323`, which the guard's `APPLYING_SITES` includes. |
| D14 | `docs/verification-contract.md:347`, `AGENTS.md` | Present `npm run lint` as the backend lint check; it is a fixer (A26-S01-01). |
| D16 | `AGENTS.md` (Commands: "91/90/87/85 thresholds"), `frontend/CLAUDE.md:17` ("85% branches") | `frontend/vitest.config.ts:31` sets `branches: 84`. Either the threshold was lowered without the documents, or the documents were never right; `AGENTS.md` lists coverage thresholds under "Do not change these casually". Measured branch coverage at the baseline is 87.74, so neither value is binding today. |
| D15 | root `CLAUDE.md` | Describes `.claude/settings.json` as "read-only git"; it allows `git add*` and `git checkout -b*` (A26-S01-04). |

#### S02 (`02-prior-high-triage.md` section 11)

- `docs/concurrency-and-idempotency.md:470-476` says manual posting is covered by the occurrence pin; the HTTP path is not (A26-S02-04).
- `docs/system-invariants.md:219-221` (INV-IMPORT-001) says the reaper fails a crashed job "retryably"; it does so only when `data_committed = false`, and the index is credited to migration 135 only (140 re-creates it).
- `docs/system-invariants.md` INV-IMPORT-002 says the committed run is finalized; nothing re-runs post-processing after a post-commit failure (A26-S02-05).
- `auto-backup.service.ts:2256-2263` documents the legacy sweep as intended, against the upstream remediation (A26-S02-06).
- `net-worth.service.spec.ts` around `:4025`: comment "100 - 30 - 20 + 50 = 100" no longer describes the asserted ratio fixture (cosmetic).

#### S03 (`03-security-auth.md` section 11)

- `docs/system-invariants.md` INV-AUTH-001 says the loser "takes the reuse-detection branch" and the family ends revoked; at the baseline the branch's revocation rolls back (A26-S03-01).
- `docs/system-invariants.md` INV-AUTH-005 says standing credentials are revoked "inside the password write's own withScopedDb transaction"; the admin and owner-of-delegate resets do it in a second transaction (A26-S03-05), and three paths do not use the converging refresh revocation its "existing revocation" wording implies (A26-S03-07).
- `docs/system-invariants.md` INV-AUTH-002 says "the success-path reset writes a fixed absolute value and was always safe"; a later whole-entity save overwrites it (A26-S03-02).
- `docs/system-invariants.md` INV-CLAIM-001 names only `claim_token_used_at IS NULL` as the guard; at the baseline `claim_token_hash = NULL` in the same statement is an equally sufficient second guard, which is why removing the named predicate alone does not reopen the race (section 6). Not wrong, but a reader removing the "redundant" hash clear would then depend on the predicate alone without knowing it.

#### S04 (`04-rls-tenancy.md` section 11)

- `docs/row-level-security-contract.md` section 2: `push_chart_artifacts` is in `RLS_EXEMPT_TABLES` but has no row in the exemption table; its rationale is an unheaded paragraph after section 6, so step 3 of the contract's own section 5 checklist is not met.
- `docs/backend/database-access-and-tenancy.md:71` says there is "exactly one sanctioned direct-`DataSource` exception"; the canonical contract (section 4) documents a second one (the `PgListener` connection).
- `docs/backend/database-access-and-tenancy.md:55-58`: the `withScopedDb` code sample has lost its opening fence and first lines (a stray `// ...mutate + repo.save(row)` and a closing fence render as body text).
- `docs/backend/database-access-and-tenancy.md:31, 35` versus `:9` (D-S04-05).
- `backend/src/transactions/transaction-transfer.service.ts:641-643` ("account ownership and delegation grants are not written by the posting that follows") is true of the posting and false of the system: a concurrent revoke writes them (A26-S04-01).
- `backend/src/transactions/joint-register.service.ts:38` ("Every check that can refuse runs before the system-context window opens") states as a safety property the shape that A26-S04-01 shows unsafe.
- `docs/system-invariants.md` has no entry for joint-account or delegation tenancy; the session plan (`sessions.md` S04, `plan.md` section 5) names INV-SHARE-001..005 for joint accounts, but those IDs are the PWA share target (`system-invariants.md:139-143`).
- `docs/row-level-security-contract.md` section 1 ("RLS is what contains the query that forgets to") overstates what the delegation policies contain (A26-S04-03).

#### S05 (`05-migrations-schema.md` section 11)

- `backend/test/integration/email-receipts-schema.integration.spec.ts` header: "entity metadata ... creates none of the CHECK constraints". Sixteen entities carry `@Check` (e.g. `transaction-rule.entity.ts:52`, `scheduled-transaction-posting.entity.ts:46-47`, `exchange-rate-coverage.entity.ts:39`); the correct statement is "most", 82 of the production CHECKs being absent.
- `AGENTS.md` / `.claude/commands/audit.md` state the three-place rule as if held; nothing holds it for unique keys or CHECKs (A26-S05-01).
- `backend/src/common/db/required-db-functions.ts`: `currency_code_in_use_globally` names `136_currency_global_liveness.sql` as its migration; the body in force is `20261010190000_currency_in_use_bond_instruments.sql` (after `20260920163144`). Harmless for the existence check, misleading for an operator reading the boot failure.
- `scripts/verify-schema.sh` and `database/CLAUDE.md` are precise about what is proven ("no-op when replayed on top of schema.sql", not historical upgrade parity); consistent.

#### S06 (`06-backup-restore.md` section 11)

- `docs/system-invariants.md` INV-BACKUP-006: status `enforced` with "Integration against MinIO: test/integration/backup-store-s3.integration.spec.ts" as required test; CI never sets the endpoint and the suite fails when run (A26-S06-02). The sentence "where an S3-compatible service ignores the checksum header we learn it from a rejected put, not from a silent acceptance" is false for a service that ignores the header (moto accepts silently).
- INV-BACKUP-006 "Two runs for the same user and day cannot interleave -- the run is claimed (claimDueBackup)": the manual fan-out (`runManualBackupClaimed` -> `runBackupForUser`) takes only the deployment-wide manual claim, never the per-user one (section 7).
- INV-BACKUP-009 lists `restore-plan.spec.ts` "confines every repair to the restoring user's rows" as the test of the Phase-3 scoping; it tests the declarations, not the SQL (A26-S06-06).
- `auto-backup.service.ts:2256-2263` documents the legacy sweep as intended, while `local-backup-storage.target.ts:392-395` refuses to serve the same files because they "can[not] be attributed to anybody" (A26-S06-01).
- `docs/external-side-effects.md` restore paragraph says nothing about the staged objects' crash semantics (A26-S06-03).

#### S07 (`07-cash-ledger.md` section 11)

- `docs/financial-semantics.md` section 10 (gap register) still lists "Does a cross-currency transfer need a real rate? `exchangeRate` defaults to `1` ... a transfer created as `VOID` still moves both balances" and "`PATCH /transactions/:id/status` ... touch only the row given ... Breaches FIN-001"; the transfer routes now resolve or refuse a rate and VOID creates move nothing (`docs/system-invariants.md` INV-BALANCE-001 says so), and a VOID crossing on the generic route mirrors the counterpart. The register describes fixed behaviour as open.
- `docs/system-invariants.md` INV-BALANCE-001 says "only sanctioned services write current_balance, and each reads under a lock"; the account-edit undo writes it from a snapshot (A26-S07-02).
- INV-RECONCILE-001 lists `removeTransfer` / `updateTransfer` as covered; their split-leg and cross-owner branches are not (A26-S07-05).
- INV-TRANSFER-001 status `enforced` with "both legs' balances stay consistent across a VOID transition" on every path; A26-S07-03 is a concurrent counterexample.
- The comment at `transaction-bulk-update.service.ts:199-203` ("it does not read the statuses ... safe to run before the lock") is false.
- The comment at `transaction-transfer.service.ts:2215-2217` ("authorization was fully decided before entry") describes A26-S04-01's gap as a design.
- No document states the sign policy of split lines (mixed-sign is supported in practice; MON-M28 rejected on that basis).

#### S08 (`08-scheduler-cron.md` section 11)

- `docs/system-invariants.md` INV-OCCURRENCE-001 "Crash semantics: a crash between claim and advance leaves the claim row, so the next tick is refused rather than reposting" describes the pre-fix two-transaction shape; claim, money and advance now commit or roll back together (P5).
- `docs/concurrency-and-idempotency.md:470-476` says manual posting is covered by the occurrence pin; the HTTP path is not (A26-S08-01; S02 recorded the same line).
- `schedule-cursor.ts` header: "the cursor steps past every consecutive claimed slot so the bill never offers an occurrence whose own claim key is taken" is true of the rule's caller, not of `post()` (A26-S08-03).
- `docs/audits/2026-10/plan.md` section 1 and `sessions.md` S08 say 40 cron jobs; the code has 49 `@Cron` handlers in 46 files (and `docs/cron-jobs.md` has 49 rows).
- `docs/cron-jobs.md` `email-receipt-poll` "at most 5 provider calls ... per user per tick": the code also allows `AI_CATEGORY_CALLS_PER_POLL = 10` (`email-receipt-poll.service.ts:54, 355`; sweep, not executed) -- to S11.
- `docs/cron-jobs.md` `updates.service` "every 12 hours": the 12-hour window equals the period with a strict comparison (`updates.service.ts:28, 302-308`), so a tick can find the window not yet elapsed; effective cadence up to 24 h (sweep, not executed) -- to S17.
- `docs/cron-jobs.md` notification purge "both deletes are by predicate on stored timestamps": the cutoffs come from the process clock (`notification.service.ts:323`); harmless across replicas.

#### S09 (`09-import-mny.md` section 11)

- `docs/system-invariants.md` INV-IMPORT-002: "a committed run is finalized rather than replayed" and "Failpoint present ... commits writeAll then fails before terminal completion": no such failpoint exists; the committed in-process failure is neither finalized nor protected from a second start (A26-S09-01/-02).
- `docs/system-invariants.md` INV-IMPORT-003 names only `import.service.ts`; the CSV path was fixed, the MNY writers have the same gap.
- `mny-staging.service.ts:96-103`: "a started import can never have its bytes swept out from under it" overstates the mechanism (A26-S09-04).
- `frontend/src/i18n/messages/*/import.json` `mnyErrors.mnyImportFailed`: "Nothing was saved" is false whenever `data_committed` is true.
- `docs/audits/monize-audit-01-remediation-review-response.md` RFR-001 describes `assertStillHoldsSlot` / `MnyImportSlotLostError`, since replaced by `markDataCommitted`; it is a shipped record (not to be edited) and no live document repeats it.

#### S10 (`10-rules-banksync-csv.md` section 11)

- `docs/system-invariants.md` INV-BANKSYNC-001 Status names one key-instability path (`hash:` to `ref:`); the fetch-local discriminator is a second one (A26-S10-01), and the spec section 6 ("so none is lost and the key does not depend on the listing order") is true within one fetch only.
- INV-RULE-002 "Call sites" lists bank sync only through INV-RULE-005 and the guard; the call-site sentence omits `BankSyncWriterService` (the guard's APPLYING_SITES has it).
- `bank-sync-writer.service.ts:136-172` docblock sits above `CreatedOperation`, not the class it describes (cosmetic, not a finding).

#### S11 (`11-email-receipts.md` section 11)

- `docs/cron-jobs.md` row `email-receipt-poll.service`: "take a bounded AI step (at most 5 provider calls, 2 of them parser drafts, per user per tick)". The poll also asks up to `AI_CATEGORY_CALLS_PER_POLL = 10` category questions per tick in the pipeline loop for any mailbox whose AI mode is not `off` (`poll.service.ts:54, :355`; `pipeline.service.ts:368-397`), so the bound is 15 per tick (and 10 in mode `on_demand`). `docs/specs/email-receipt-matching.md:292` ("The poll's automatic step never calls the AI for categories") is literally true of `runAutomaticStep` and misleading about the poll. `email-receipt-ai.service.ts:139-143` ("AI mode governs only what happens by itself: the poll's automatic step calls AiService for automatic mailboxes alone") is contradicted by the same category calls.
- `docs/system-invariants.md` INV-RECEIPT-006: "the poll starts no new work after 8" minutes; provider calls already started run on, and the AI step's calls are not checked against the budget at all (A26-S11-01).
- `docs/future-plans/email-receipts.md` decision 12 and `receipt-rows.ts:85-87` describe a forward "from the user's own address"; the code honours a forwarded header block from any sender, and decision 12's safety argument ("it never reaches the ledger except through the same card and approval") does not hold under auto-apply (A26-S11-04).
- INV-RECEIPT-008 lists `Present` tests that are all unit specs and states the integration gap honestly; after P3 the gap is narrower than "absent" only in this audit's scratch worktree.

#### S12 (`12-securities-holdings.md` section 11)

- `portfolio-calculation.service.ts:1243-1248` says the realized-gain replay omits the acquisition commission; it uses `acquisitionCost` and includes it.
- `investment-transactions.service.ts:666-672` documents the latest-rate fallback as precedence item 3, against INV-FX-001 and `backend/CLAUDE.md`.
- `docs/system-invariants.md` INV-HOLDING-001 known gap describes the update/remove snapshot as a scope problem only; the cash duplication (A26-S12-01) and the transfer-basis rule (A26-S12-05) are not recorded; its "transferSecurity reads the source position's carried cost before the transaction" names the race but not the as-of-date defect.
- `holdings.service.ts:562-563` says prices and `averageCost` are in the security's currency; Money-imported cross-currency rows are not (A26-S12-09).
- `portfolio-calculation.service.ts:785-791` states the transfer rule as if it held for the module; it holds for one of four replays (A26-S12-04).

#### S13 (`13-valuation-fx-networth.md` section 11)

- `docs/specs/exchange-rate-canonical-orientation.md` section 8 says the client rate map and the report map "already fall back to the inverse key, so receiving one orientation per pair needs no change"; during the expand window they receive both orientations and prefer the frozen one (A26-S13-02).
- `common/time-series/fx-rate.one-door.spec.ts:16-19` calls `getLatestRates()` "the plural admin listing", but it feeds every built-in report and the frontend; INV-FX-001's enforcement text does not mention it.
- INV-FX-003's status text records the pre-release mirror rows as harmless duplicates; it does not record that direct-first readers prefer them.
- INV-CACHE-001 reads `enforced`; undo/redo and `removeAll` of investment transactions dispatch nothing and rely on the sweep, which the entry does not name.
- `sessions.md` S13 names INV-PORTMOVE-001..002; the index holds only INV-PORTMOVE-007 and -008.
- `currencies.service.ts:232-238` says `ensureSystemCurrency` is "safe to call on every default-currency change"; the caller runs it after the FK-checked write (A26-S13-05).
- The session plan's runtime line names `net-worth*`, `currenc*`, `exchange*`, `portfolio*` integration suites; only `portfolio-movement-flow` and `portfolio-tag-keys` match.

#### S14 (`14-bonds.md` section 11)

- **D1** INV-BONDNOTIFY-003: index row `enforced` (`docs/system-invariants.md:116`), body `partial` (`:3968-3969`). Confirms the S01 hand-off.
- **D2** INV-BOND-010 Enforcement lists only historical per-account series as unrouted (`:3885-3889`); three current surfaces read the blend (A26-S14-02), and every blend surface values a refused day (A26-S14-01).
- **D3** INV-BOND-005 says "a transaction price is one lot's trade price, not the holding's value" and covers the `security_prices` writers only; `NetWorthService.loadTxPriceSeries` reads trade prices of linked securities as closes.
- **D4** `docs/cron-jobs.md:42` says the bond price cron runs "After the benchmark refresh"; the ordering is a 20-minute clock gap with no dependency, and a store outside the 06:25 run has no recompute of its own (A26-S14-03).

#### S15 (`15-loans-strategies.md` section 11)

- **D-1** `sessions.md` (S15) and the plan name INV-LOAN-001..011; the index has INV-LOAN-001..010 plus INV-LOAN-HISTORY-001; there is no INV-LOAN-011.
- **D-2** INV-LOAN-HISTORY-001 (`docs/system-invariants.md:3171-3180`): "the provenance of a SPLIT-recorded interest line is enforced" is false when one parent pays two loans whose interest lines share a category (`readRecordedInterest`, `loan-history.ts:1256-1263`; sweep probe F: 300 shown, 200 correct); "no reader branches on `interest_booking_mode`" is false on the backend (`loan-payment-detector.service.ts:280,286`, `plan-loan-settlement.ts:231`, `rule-loan-settlement.ts:165`), and the layers disagree for a SPLIT loan (the backend detector refuses to pair standalone expenses, the frontend history pairs them). Same stale sentence in `docs/frontend/financial-figures.md:198`.
- **D-3** INV-LOAN-HISTORY-001 does not mention VOID, refund or future-dated rows (A26-S15-03, -05).
- **D-4** `docs/specs/gem-signal-change-notifications.md:3` says "proposed, awaiting maintainer approval" while the cron is implemented and registered (`docs/cron-jobs.md:44`); its INV-GEM-NOTIFY-001..005 are not in `docs/system-invariants.md`; its producer pseudo-code (section 4) reads "two latest" rows, the same shape as A26-S15-07(a).
- **D-5** `docs/gem-strategy.md:24-25` says the benchmark is "US equity leg or the safe asset"; the code uses `benchmarkRoleFor` (risk-free when assigned), as the same document says at lines 197-198. `docs/gem-strategy.md:552-562` presents the settled-boundary rule as complete; it does not cover a gap just before the boundary (A26-S15-02). `frontend/src/types/gem-strategy.ts:82` says "Trailing 12-month" for a configurable lookback.
- **D-6** `docs/frontend/financial-figures.md:171` places `resolveEffectiveLoanTerms` in `lib/loan-schedule.ts`; it is defined in `lib/loan-comparison.ts:129`.
- **D-7** `bookLoanAllocation`'s comment (`loan-payment-waterfall.util.ts:113-119`) says a residue "of less than one unit" reads as paid off; the threshold it names (`debt <= 0.01`) includes one whole unit (A26-S15-06); `docs/specs/loan-installment-settlement.md` 7.2 and E15 state `<= 0.01`.
- **D-8** INV-LOAN-006's statement "the interest ... is roundMoney(debt x periodic rate)" does not mention the cap at the installment (A26-S15-04).

#### S16 (`16-budgets-reports.md` section 11)

- `budget-alert.service.ts:403-411` says "the unique fingerprint ... arbitrates", true in production and unprovable in the test harness (A26-S16-09).
- `budget-period-cron.service.ts:112-115` says the next period's `ON CONFLICT` "is what actually enforces once"; true, but the same conflict swallows the next period after a mid-period close (A26-S16-07).
- `budget-spending.util.ts:211-221` documents "signed net sums" with no word on currency; `budgets.module.ts:54-55` says the budget converts occurrences "before totalling", which a reader can take to cover actuals.
- `docs/system-invariants.md:1741-1760` describes the custom report engine as covered for INV-REPORT-001 without noting that it neither nets nor converts.

#### S17 (`17-ai-mcp-notifications.md` section 11)

- `docs/cron-jobs.md` states `updates.service` runs "every 12 hours"; with `UPDATE_CHECK_WINDOW_MS` equal to the period and a strict `<` in `claimCheck` (`updates.service.ts:298-312`), the effective cadence is between 12 and 24 hours.
- `docs/system-invariants.md` INV-MCP-001 "Required tests" lists no test of the per-request scope on an existing 2025-era session, while its statement promises "that credential's current scopes" (A26-S17-05).
- `docs/backend/ai-and-payees.md` "Shared AI tools" does not list `render_chart` as an assistant-only presentation tool beside `enter_bond_series_manually`'s documented MCP-only status.
- The `spending_anomalies` tool descriptions (`tool-definitions.ts:1051-1056`, `reports.tool.ts:65-67`) promise a months window the implementation does not have (A26-S17-03).

#### S18 (`18-frontend-core.md` section 11)

- `docs/system-invariants.md` INV-CACHE-001 is `enforced`, but three classes of derived-cache staleness reproduce (A26-S18-01, -02, -03); the entry should be `partial` with these paths named.
- `docs/system-invariants.md` INV-FX-001 "Known gap" names only the built-in reports; the client's ageless conversion (A26-S18-04) is a second gap.
- `docs/frontend/api-and-cache.md` says "A write that moves money calls `invalidateBalanceCaches()`"; the budget family is moved by writes that move no money (recategorisation), and the guard enforces the narrower reading.
- `frontend/src/lib/apiCache.ts:10-17` describes the in-flight generation fix as closing the resurrection class; it closes it for `dedupe` only.
- `import.json` `mnyImportFailed` contains `--`, which `frontend/CLAUDE.md` forbids in copy (the em-dash rule); cosmetic.

#### S19 (`19-frontend-forms.md` section 11)

- `docs/system-invariants.md` records INV-DISPLAY-001 as `enforced`, but nine form readouts use `toFixed` and the guard is keyed on `%` only (A26-S19-07).
- `docs/frontend/forms-and-formatting.md:19` says `CurrencyInput` rounds "so the stored value never carries sub-cent precision the 2dp display hides", and `:35` says "a field that hands back its own value has not been edited"; for a four-decimal stored value the two statements conflict and the first wins (A26-S19-03).
- `docs/frontend/financial-figures.md:55` states that an investment price or quantity the user saved is never written over; the same paragraph exempts the Post dialog's refresh of a template price; the first sentence should name the exception.
- `frontend/src/i18n/messages/en/investments.json:297` tells the user the cost per share they see is carried; it is, but a typed one is not (A26-S19-05).

#### S20 (`20-frontend-figures.md` section 11)

- `docs/frontend/financial-figures.md` ("Portfolio Value Over Time is the same shape, per date") describes the per-point rule for the report only; the investments page chart and the widget, which the same document lists as reading the same series, do not apply it.
- `types/net-worth.ts:30-35` tells consumers to read the flags; the sibling `MonthlyNetWorth` in the same file has none to read.
- `GeographicAllocationReport.tsx:788-806` documents the country aggregate's missing completeness as known; no invariant entry or plan records it.

#### S21 (`21-tests-ci-release.md` section 11)

| Document | Claim | Reality |
| --- | --- | --- |
| `docs/release-integrity.md:207` | "CVE gate fails the build ... The scan is a gate, not a report" | the gate runs after `:latest` and `:X.Y.Z` are pushed (A26-S21-02) |
| `docs/release-integrity.md:205` | the SHA binding is "the pattern to copy" | true for the revision; the artifact built is a different target from the one the gates ran (A26-S21-01) |
| `docs/release-integrity.md:72-73` | "No runner carries such a flag today either ... Playwright fails by default when it discovers no spec files" | `node --test` passes on zero (A26-S21-06) |
| `docs/release-integrity.md:75-76` | "the 35 suites tracked under `backend/test/integration/`" | 118 spec files at the baseline; the guard asserts `> 30` |
| `docs/system-invariants.md` INV-RELEASE-001 "Retry semantics" | "may bump the version twice" | a re-dispatch after an image-stage failure reuses the version for a different digest (A26-S21-02 (c)); both outcomes are possible |
| `docs/verification-contract.md:345-354` | the jobs "that exist in `.github/workflows/ci.yml`" include `Lighthouse audit` | Lighthouse is `lighthouse.yml`, pull-request only, in no `needs:` |
| `docs/verification-contract.md` section 5 | four items "reported but not located" | item 1 located; ten audit-located known-wrong tests absent from the register (section 10.1) |
| `frontend/CLAUDE.md` Commands | `test:cov` "85% branches" | `vitest.config.ts` branches 84 (S01 D16, still open) |
| `ci.yml:1451` | "Gates releases: build-and-push lists this job in its needs" | `prepare-release` / `prepare-preview` list it; `build-and-push` needs only `prepare-release` (transitively equivalent; wording only) |
| `README.md:651-656` | "Build and start" `docker-compose.prod.yml` | the file pulls `:latest`, builds nothing; no ownership step for the bind mounts (A26-S21-03) |
| `backend/src/net-worth/net-worth.service.spec.ts:1961` | title "returns amount unconverted when no rate exists" | the body asserts the gap; title stale |

#### S22 (`22-delta-review.md` section 11)

None introduced by the delta. One note for the plan: `plan.md` section 4 step 2's pin-check
command uses pathspecs that resolve against the working directory, so it must be run from the
repository root; run from `docs/audits/2026-10/` it reports the audit reports as a code change.

## 15. Design risks and open hypotheses

Not counted in the 96. Cross-cutting design risks (S23):

- **Numeric `total*` fields when incomplete** (S02, S18, S20 D-S20-04): the server keeps a
  subtotal under a total's name and every consumer must remember the flag; this is how A26-H15
  and A26-M38 recur. A typed `{ value, complete }` or `null` plus a `known*Subtotal` field would
  make the read compulsory.
- **Whole-entity `save` after an earlier read** (D-S03-01, the 26-site sweep of S04, S12's
  `updatePrice`): every site is a lost-update candidate; A26-M01, -M05, -M13 are the proven ones.
- **"Today" is computed four ways** across the cash ledger and the scheduler (S07, S08 design
  risks); replicas with different `TZ` would disagree.
- **No source key on imported rows** (DR-S09-04): duplicate prevention lives only in job state
  machines, which is why A26-H08 and A26-H09 are possible.
- **Nearest-slot selection with a wide rule window** (S15 D2) turns into a stuck cursor through
  A26-M15.
- **Built-in reports convert past buckets at today's rate** (S13): the look-ahead clause of
  INV-FX-001 for a past period; needs a maintainer policy statement or `convertAtDate`.
- **Release:** `:beta` and fork images are unbooted and unscanned (DR-S21-1, DR-S21-2); liveness
  versus a long migration (DR-S05-1, DR-S21-3); branch protection unverifiable (DR-S21-5).
- **Open hypotheses handed to S23 and not promoted:** server-side sector weightings skip unpriced
  holdings with no flag (`sector-weighting.service.ts:420-431`, S18); the country look-through
  aggregate carries no completeness and the intraday response has no flag for a dropped bond
  (S20, with S13/S14); `currencyCode ?? "USD"` at `monte-carlo.service.ts:721` (S14). Each is a
  surface for task T17 or T33 to check, not a confirmed finding.

The per-session design-risk registers follow verbatim (section 9 of each report).

#### S01 (`01-baseline.md` section 9)

- **DR-S01-1 The lint gate's strength rests on undocumented rule properties.** The RLS bans hold under `--fix` only because no fixer exists for them; adding an auto-fixable custom rule later would silently stop gating (A26-S01-01 widens this).
- **DR-S01-2 `cron-doc.spec.ts` checks prose, not code.** It proves each `docs/cron-jobs.md` row names a mechanism from `REPLICA_MECHANISM_VOCABULARY`; nothing checks that the handler calls it (M5). A handler refactor can drop its claim with the doc unchanged.
- **DR-S01-3 No `engines` field and no `.nvmrc`.** `npm ci` fails on Node 22 with an engine message about a transitive package, not about the project; README.md:491 is the only statement.
- **DR-S01-4 CI's UTC is implicit.** `backend-unit-tests` runs `npm run test:unit -- --coverage` without `TZ`; it is UTC because GitHub's `ubuntu-latest` image is. `AGENTS.md` says "`TZ=UTC npm run test:unit -- --coverage` # what CI runs". A self-hosted runner in another zone would make `insights-aggregator.service.spec.ts` and `net-worth.service.spec.ts` flap (verification-contract s7).
- **DR-S01-5 E2E CI retries.** `e2e/playwright.config.ts:12` sets `retries: 2` under `CI`; a test that fails twice and passes once is green. Handed to S21.
- **DR-S01-6 Workflow concurrency group shared with releases.** `ci.yml:41-43` groups by workflow and ref with `cancel-in-progress: true`; a push to `main` can cancel an in-flight `workflow_dispatch` release on `main` (not tested). Handed to S21 (INV-RELEASE-001).

#### S02 (`02-prior-high-triage.md` section 9)

- Portfolio `total*` fields stay numeric (the known subtotal) when `valuationComplete` is false (`portfolio-calculation.service.ts:2184-2185`); AGENTS.md says `null` plus a separate subtotal field. Consumers must read the flag, which A26-S02-03 shows they do not everywhere. Owner S13/S20.
- Cross-currency transfer `toAmount` / `exchangeRate` accepted without a tolerance against the market rate (MON-H11). Maintainer policy decision.
- No instance namespace in backup keys (A26-S02-06 second half).
- `currency-conversion.util.ts:20` treats an empty source currency code as "same currency"; protected by a report spec. Hypothesis for S13.
- `investment-transactions.service.ts:782-792` falls back to `getLatestRate` with no age bound when the trade date has no rate (INV-FX-001 "never one struck after it"). Hypothesis for S12/S13.
- `update()` takes `effectiveAccount` / currency from the pre-lock snapshot (`transactions.service.ts:2575-2579, 2799`); `PATCH /transactions/:id` with `amount` on a mirror transfer leg may change one leg only; `update()` vs `updateTransfer` lock order can deadlock. Hypotheses for S07.
- A scheduled transfer into another owner's account can never post (`writeTransferLegs` refuses cross-owner on a caller's manager, `:751-760`). Functional gap, S08.

#### S03 (`03-security-auth.md` section 9)

- D-S03-01: whole-entity `repo.save(user)` after an earlier read and an intervening SQL write to the same row appears on several credential paths (`auth.service.ts:511, 538, 786, 903, 920`; `auth-email.service.ts:119, 224`; `two-factor.service.ts:367, 516, 581, 615, 905, 998`; `users.service.ts:173, 481`). TypeORM's `save` diffs the snapshot against the current row and writes every column that differs, so a concurrent committed change to another column of `users` (a password reset, a lockout, a 2FA disable) can be reverted. A26-S03-02 is the instance proven on a single request; the concurrent instances are not yet demonstrated (handed to S04/S07 as a pattern search, section 12).
- D-S03-02: step-up tokens are reusable for their purpose for 5 minutes (no `jti` consumption). Acceptable for the two current purposes; a future destructive purpose added to `STEP_UP_PURPOSES` would inherit replayability. A guard that refuses a destructive purpose without a `jti` claim would make the rule machine-checked.
- D-S03-03: an acting delegate receives the owner's `lastLogin`, `lastActivityAt`, `role`, `authProvider` and `emailVerified` from `/users/me` and `/auth/profile`. Not credential state, and the UI may need some of it; whether a delegate should see the owner's presence timestamps is a product decision (they reveal when the owner was last active, which is also the emergency-access clock).
- D-S03-04: the nightly purge deletes revoked refresh tokens (`token.service.ts:378-382`), which also deletes the evidence reuse detection needs; once A26-S03-01 is fixed, a token stolen more than a day before reuse will be "invalid", not "reused".

#### S04 (`04-rls-tenancy.md` section 9)

- D-S04-01: the joint read arms (`schema.sql:3651-3724` and the indirect splits/tags arms) key on `app_real_user_id()` and any active delegation, so while Bob acts for Alice his session can also read, at the database level, what Carol granted him. Application code narrows it; RLS does not. A predicate pairing the delegation's owner with `app_current_user_id()` when the two GUCs differ would make RLS agree with the app.
- D-S04-02: `push_chart_artifacts` holds rendered images of a person's figures in an exempt table readable by every session; the safety argument is the token-keyed consume and the short expiry, not a policy. The contract's section 2 table has no row for it (section 11).
- D-S04-03: `revokeDelegate` decides "delete the login" from counts without locking the `users` row against a concurrent link (section 8).
- D-S04-04: the startup role check is a point-in-time check; an attribute granted after boot is not seen until restart (documented in `app-role.ts:57-62`). A periodic re-check, or the readiness probe asking the same question, would close it.
- D-S04-05: `docs/backend/database-access-and-tenancy.md:31, 35` and `src/delegation/rls-context-smoke.spec.ts` prescribe "authorization read under the caller's identity before any bypass opens", which is the two-transaction shape behind A26-S04-01 and A26-S04-02; the same document's section "Rejection happens before the write" requires the opposite. A rule that names the in-transaction re-check would resolve it.

#### S05 (`05-migrations-schema.md` section 9)

- **DR-S05-1 Liveness probe vs the lock holder.** `db-init`/`db-migrate` run before `app.listen`; the chart's liveness probe (`helm/values.yaml:282-288`: `initialDelaySeconds: 10`, `periodSeconds: 60`, default `failureThreshold: 3`) kills a container that has not answered in about 190 s, and nothing distinguishes "migrating" from "hung". A single migration longer than that (an index build or table rewrite on a large table) is killed and rolled back on every attempt, a deterministic crash loop on that database only. Followers waiting on the lock are also killed, which is harmless. `advisory-locks.ts` itself says "a large migration run can hold the lock for minutes". Decision needed: a `startupProbe` with a long budget, or running migrations as a pre-upgrade Job. Not a present-day failure for a household-sized database.
- **DR-S05-2 Off/shadow mode owner writes the ledger.** By design the runtime is the owner at `RLS_MODE=off|shadow`, so MON-M15's protection applies only under `enforce`.
- **DR-S05-3 Session lock requires a direct connection.** Documented in `advisory-locks.ts`: through a transaction-mode pooler the lock and the DDL can land on different server sessions. Nothing checks it at startup for the migrator (INV-HA-001's LISTEN check runs later, in `main.ts`).
- **DR-S05-4 Redundant index.** `idx_transaction_rules_user_position` duplicates the btree of `uq_transaction_rules_user_position` (same columns, same order), the case `20260912131500` already fixed for calendar notes; cost is one extra index write per rule save.
- **DR-S05-5 Boot check covers called functions, not triggers.** Invariants held by triggers (`bond_reject_mutation` for INV-BOND-001, `guard_job_claim_lease_ownership`, `reject_unfenced_import_checkpoint`, the attachment tombstone triggers) are not part of `REQUIRED_DB_FUNCTIONS`; a database whose trigger was dropped by hand boots and serves.

#### S06 (`06-backup-restore.md` section 9)

- **Post-commit `.then` chained to the failure `.catch`** (`backup-restore.service.ts:417-448`): any throw after the commit runs `discardStagedAttachmentObjects` over keys the committed metadata now names, and reports a committed restore as failed. Every callee swallows today (`deleteDisplacedAttachmentObjects` per-key try, `recomputeLinkedSecurities` wraps everything, `invalidatePortfolioSummary` synchronous), so it is not reachable; M2/R5 shows the first future throwing call deletes every restored attachment's bytes, and no test would notice. Remedy: `.then(onCommitted, onFailed)` form, or wrap the post-commit block in its own try so only pre-commit failures discard.
- **No instance namespace in automatic-backup keys** (A26-S02-06 second half): two deployments sharing a directory or `BACKUP_STORE_S3_*` bucket and prefix with the same user ids (a staging clone) write and retain each other's artifacts. Operator-configurable for S3 (prefix), not for local beyond the mount. Needs a decision on an instance id.
- **Currency codes are one global namespace**: a restore onto an instance where another user already created the same custom code keeps that user's `name`, `symbol` and `decimal_places` (`ON CONFLICT (code) DO NOTHING`), and the restoring user cannot edit it.
- **The local attachment provider reuses the backup temp prefix** (`writeFileAtomic`): a crash mid-upload leaves `.monize-backup-tmp-*` inside attachment shard directories, and `cleanStaleTempFiles` is only ever called on backup folders. Storage leak only.
- **Restore format has no producing-release marker** (A26-S06-04 root): every future semantic backfill repeats the gap.

#### S07 (`07-cash-ledger.md` section 9)

- Writers disagree on "today": `recalculateCurrentBalance` (`todayYMD()`), action-history `recalculateBalance` and import post-processing (`CURRENT_DATE`), bulk VOID (`formatDateYMDLocal(new Date())`), the due-balance cron (user timezone). Handed to S08.
- The action-history delta writer (`action-history.service.ts:1799-1805`) has no `is_closed = false` predicate, so an undo can move a closed account's balance (not executed).
- `updateTransfer`'s CAS compares amount, account and date but not status; the VOID decision reads `lockedFrom.status` only (`:1914`).
- Cross-owner authorization outside the write transaction (A26-S04-01) also covers update and delete; the fix is S04's helper.
- `derived-state-writers.guard.spec.ts` and `reconciled-lock.guard.spec.ts` match per file or per public method, so a private branch method escapes both (A26-S07-01, -05).

#### S08 (`08-scheduler-cron.md` section 9)

- No alert for a schedule refused tick after tick: the cron counts a `ConflictException` as "claimed elsewhere" (`:629-636`) whatever its cause, so any state that makes the cursor's slot unclaimable is silent (A26-S08-03, and the undo rewind below). A refusal of the same occurrence across, say, 24 ticks is not a replica race.
- Undo of a schedule edit restores `next_due_date`, `occurrences_remaining`, `is_active`, `last_posted_date` absolutely (A26-S07-02 family); with a posting that recorded no action or a rule claim, it rewinds the cursor onto a claimed slot.
- "Today" in this slice: the cron selects by the user's timezone (`todayInTimezone`), while `advanceScheduleCursor` stamps `last_posted_date` with `todayYMD()`, which outside a request is the server's local date (`common/date-utils.ts:111-122`); the bill reminder's run date, the mortgage reminder key and the emergency-access key are server-local too. Replicas with different `TZ` would key reminders differently (one email each); a single image has one `TZ`, so this is a configuration hazard, not a present failure.
- `close()` neither deactivates nor warns about active schedules on the account; the cron then fails daily with `SCHEDULED_POST_FAILED`.
- Lease overruns of the same class as A26-S08-04, not executed: `email-receipt-poll` (10-min lease, work budget checked only before a step, provider steps up to 20 min; stored rows are idempotent, provider calls are not); `bond-series` `withLease` 90 min against a worst case of about 270 x (3 s + 2 x 30 s); `backup-offsite-retry` reclaims after 60 min and the late worker's outcome write is conditioned on `status = 'uploading'` only.
- A post-commit failure in `completeTransfer` loses the transfer's tags and history entry (the money is consistent); independent of A26-S08-02's reporting fix.

#### S09 (`09-import-mny.md` section 9)

- **DR-S09-01 Verification is self-referential.** `verify` checks write fidelity (database versus mapper), not mapping fidelity (mapper versus Money). A26-S09-03 is invisible to it. Money stores no per-account balance in the tables read, so a stronger check would need Money's own computed balance or a second, independent fold.
- **DR-S09-02 Synchronous parse versus the 5-minute stale threshold.** `parser.parse` is synchronous (`mny-import.service.ts:265`); the heartbeat timer cannot fire while it runs. A parse longer than about 5 minutes on a loaded pod lets another replica's poll reap a healthy job; the fence then rolls the import back and the retry repeats the same parse. Bounded by the documented 3-minute target for 37,000 transactions; no measurement in the repository.
- **DR-S09-03 Wipe longer than `JOB_STALE_AFTER_MS`.** The pending row created before the wipe is reaped after 5 minutes (S02 item); the claim then returns null and the import never runs after a completed wipe; Retry (no second wipe) recovers. The slot is free during the remainder of the wipe, so a restore could start alongside it.
- **DR-S09-04 Fresh UUIDs per parse.** Nothing on an imported row identifies its Money source record, so every duplicate-prevention rule has to live in the job state machine; a source key (`htrn`) would make replay idempotent at the row level.

#### S10 (`10-rules-banksync-csv.md` section 9)

- **Bank-sync preview does not disclose structural rule effects.** `bank-sync-preview.service.ts:368-466` shows payee, category, tags and the matched rules; a `convert_to_transfer`, `split` or `settle_loan_installment` the commit will write (moving money in another account) is not shown, each row is planned alone without the pass's prior settlements (`planForRow`, `:381`), and the confirm fingerprint covers only the bank rows (`bank-sync-plan-fingerprint.ts`). Today's displayed fields agree with the commit; a person confirming the preview is not told what moves elsewhere. Handed to S19/S20 for the client side.
- **Rule-application guard patterns.** `rule-application-sites.guard.spec.ts:141-156` does not match `m.save(Transaction, {...})` or `m.insert(Transaction, ...)`-style calls through a variable not named by the held-repository scan; no such site exists today (grep empty).
- **Bank-sync ledger not in the backup** (`export-table-queries.ts:155-158`, documented BS11): after a restore the link and the ledger are gone; the default cut-off of the new link (day after the newest non-VOID row) is the only defence against a re-import.
- **Transient balances during a QIF/CSV import.** VOID rows (`:138`) and the opening balance (A26-S10-05) move `current_balance` inside the import transaction in ways only the post-commit recompute corrects; a recompute failure leaves them.
- **`matchPendingTransfer` / the split pending branch** update a pending leg's amount and the account balance with no VOID or reconciled-lock check, and select the placeholder by `description LIKE '%PENDING IMPORT%'`, a user-editable field (`import-regular-processor.service.ts:244-298, 548-587`).

#### S11 (`11-email-receipts.md` section 9)

- **DR-S11-1** (S05 hand-off): a deleted rule's open review becomes a rule-less open request that blocks the receipt's own request on that transaction (section 8). A `kind` filter (`AND open_request.kind = 'email_receipt'`) in the `NOT EXISTS` would decouple them, but would also let a receipt request sit beside an orphaned review; the maintainer decides.
- **DR-S11-2**: the trade link (`email-receipt-trade-link.service.ts:150-308`) records `investment_transaction_id` after a `claimedElsewhere` read with no lock on the linked row and no unique index (`idx_email_receipts_investment_transaction` is non-unique), so two different emails linked to one row at the same moment both account for it. Needs two simultaneous person actions on two copies of one confirmation; the visible effect is that a third identical email is proposed as a second fill (never auto-applied).
- **DR-S11-3**: a component's re-join of waiting settlements (`pipeline.service.ts:318-320`) runs after the component's commit with no durable marker; a crash between them leaves an applied settlement unenriched by the component until a person reprocesses it (an applied settlement is not in the rematch selection).
- **DR-S11-4**: `ignore` and `remove` decide "applied" before closing the requests and do not re-read, unlike the trade link (section 8); harmless today because of the candidate exclusion, but the two paths encode the same race differently.

#### S12 (`12-securities-holdings.md` section 9)

- `update()` assigns a supplied `exchangeRate` directly (`investment-transactions.service.ts:4706-4707`), skipping the "same currency dominates" rule `create` applies (`:770-772`): a same-currency row edited through the API with `exchangeRate: 1.35` posts its cash x 1.35. The form does not offer the field for a same-currency pair (S19 to confirm). A reversed rate (CAD->USD supplied for USD->CAD) is accepted on every path without a tolerance against the market; same policy question as MON-H11.
- The preview returns an unrounded rate (`1.3699999999986299` in P4) while the row stores `NUMERIC(20,10)`; `roundFxRate` is not applied in `resolveCashExchangeRateOrNull`.
- Post-commit work in `create`/`update`/`remove` (SPLIT full rebuild, transaction-derived price, bond recompute) is best-effort and logged; a failure leaves a stale derived price row, not a wrong holding.
- A security's `currency_code` can be changed while it holds provider prices and trades in the old currency (`securities.service.ts:1071-1078` checks only bond links); the INV-PRICE-001 known gap (no currency on a price row) makes the old rows indistinguishable.
- `getMonthOverMonthMovers` has no age bound: a feed that stopped before `previousEnd` yields the same close on both sides and a 0.00 percent "move" instead of no figure.
- Quote refresh has no negative cache per security (`refreshPricesForSecurities`, `:873-986`): each refresh of a dead symbol costs one call per routed provider (Yahoo, then MSN autosuggest and quote). Model: 5 dead symbols x 3 calls x one refresh every 5 minutes of an open session = 180 calls an hour; bounded by the breaker and `QUOTE_FETCH_CONCURRENCY`; not demonstrated as an operational problem (Rule 6), so an optimization, not a finding.
- Yahoo retries 429/503 inside a held semaphore slot for up to 30 s (`yahoo-finance.service.ts:263-286`), so five throttled requests block the whole provider; a design choice documented in place.
- `updatePrice` (`security-price.service.ts:2579-2622`) reads the price row outside its write transaction and saves the whole entity.

#### S13 (`13-valuation-fx-networth.md` section 9)

- Built-in reports convert every historical bucket at today's rate ("flat latest-rate lookup", `report-currency.service.ts:105`), which is the look-ahead clause of INV-FX-001 for a past period; a currency's move inflates or deflates last year's spending. The maintainer should state this as policy or route reports through `buildRateIndex` / `convertAtDate` as the Sankey report does.
- `monthly_account_balances` has no completeness column (`net-worth.service.ts:2948-2959`, spec section 5): a security-to-account FX gap and an unpriced position are lost at write time, so the read-time `fxComplete` can say `true` over a stored subtotal.
- Undo/redo dispatches no net-worth recalc; the 30-minute sweep is the only repair, and INV-CACHE-001 reads `enforced` without naming it. A sweep skipped (an account with no snapshot rows is never swept) leaves the history stale.
- Unbounded `getLatestRate` fallbacks outside the investment trade path: the scheduled foreign-currency estimate cron (`scheduled-transactions.service.ts:792`) and a dateless split posting (`fx-entry.util.ts:186`). Exposure is low while the daily refresh succeeds; a pair dropped by the provider keeps a stale estimate indefinitely.
- An imported junk currency code (S09-06) referenced by an account is sent to Yahoo on every refresh (`yahoo-fx.provider.ts:155-157` carries every code; the refresh has no negative cache).
- Monte Carlo return weights and `getHoldingStats.marketValue` read `getLatestPrices` for a bond-linked holding (`monte-carlo.service.ts:511-539, 708-727`) instead of `valueBondHoldings`; the current value itself is bond-aware. Handed to S14.
- `POST /currencies/exchange-rates/refresh` lets any authenticated user start a deployment-wide provider refresh (default throttle only); availability, not integrity. Handed to S03/S21.
- `getAccountMarketValues` accumulates in floats (`portfolio.service.ts:1545-1548`), not through `FxAggregate`; drift is sub-cent at realistic sizes.

#### S14 (`14-bonds.md` section 9)

- **DR1 Matured coupon lot value excludes the final coupon until the REDEEM is booked.** `bond-engine.ts:349-358`; sanctioned by `polish-retail-bonds.md` 6 (lines 490-497). A matured COI1030 lot with period 4 at 5.00 % is worth 100.00 per bond in every holding surface from the maturity day, while it pays 105.00 when booked; the notification of item 4 names the payout. Same ledger lag as every unbooked coupon; not a present-day contradiction of a contract.
- **DR2 The price cron follows the benchmark refresh by wall clock only** (06:25 weekdays, 06:45 daily, Europe/Warsaw, separate leases). A refresh still running at 06:45 on another replica is not waited for; the 10-minute lease and two small documents make that unlikely. A26-S14-03 covers the stores outside the window.
- **DR3 The redemption endpoint's same-day order** (R9).
- **DR4 No negative cache in the cron's unbounded backfill.** `backfillHistory` claims an attempt lease only when `limit` is set (`bond-series.service.ts:772-788`); the 07:15 cron passes none, so every code that answers `SERIES_NOT_PUBLISHED` or `SOURCE_DOCUMENT_MISSING` is asked again each day. Call model: k such codes cost k x (3 s gap + 1-2 requests) per day; with 8 products from 2024-01 (`backfill-codes.ts`, about 270 codes by 2026-10) the bound is about 15 minutes a day of polite requests if every code were missing. An optimization, not a defect (Rule 6).

#### S15 (`15-loans-strategies.md` section 9)

- **D1 Same-day prepayment priced into that day's installment.** `datedLoanDebt` is inclusive of the installment's date (INV-LOAN-006 by definition), so a principal payment dated on the due date reduces that installment's interest: R8, 894.74 instead of 944.74 (50.00) for a 10,000.00 prepayment at 0.5 % a period. A lender accruing to the due date charges the period on the balance before the prepayment. The spec should say which convention it means and why; a row dated the same day as the occurrence is the boundary.
- **D2 Nearest-slot selection with a wide window** can attribute a late payment to the next slot (and a duplicate bank row, A26-S09-01 / A26-S10-01, to the next installment), which A26-S08-03 turns into a stuck cursor.
- **D3 VOID keeps a `post()` claim.** A bounced installment (R9) is never re-offered; the spec states this for rule claims (12.5) and the index lists it in INV-LOAN-008's tests; for a bill-driven loan the user must post the missed installment by hand with no prompt.
- **D4 Delete releases a claim but not the cursor** (spec 12.5): a bill-driven loan silently skips the freed slot.
- **D5 A declined template (escrow, tax, insurance line) posts its stored lines on the final installment**, so its principal line overpays the debt and pushes the loan into credit; documented as the deliberate fail-safe of INV-LOAN-006 "Scope", but no surface warns at the final installment.
- **D6 GEM momentum in listing currency.** A US fund in USD +10 % and an ex-US fund in EUR +8 % with EUR +5 % against USD: in USD the ex-US fund is +13.4 % and should win. Documented in the types and `docs/gem-strategy.md:311-312`, not in the Rules section; the settings form warns about cost, not comparability.
- **D7 Rate-change sync applies a re-plan**, not the confirmed preview (no revision passed down).
- **D8** a lump sum that would make a non-amortizing loan amortize is refused before it applies (frontend projection).
- **D9** same-date history attribution depends on the API's order (sweep probe D: `observedInstallment` 1,000 complete vs 800 incomplete for the same data).
- **D10 A retired schedule is not reactivated** when the final payment is later voided or deleted (the deactivation in `reprice-template.ts:175-178` has no inverse); the loan owes again with no bill.

#### S16 (`16-budgets-reports.md` section 9)

- `computePeriodActuals` (`budget-period.service.ts:339-469`) is a second copy of `queryCategorySpending`'s predicates; they agree today. A predicate fix in one (A26-S16-01, A26-S16-02) can miss the other.
- A deleted category or transfer account sets `budget_categories.category_id` / `transfer_account_id` to NULL (`schema.sql`, `ON DELETE SET NULL`); the line then reads "Uncategorized" or "Transfer" with `spent` always 0 (`resolveCategorySpent`), while it still takes part in totals and alerts.
- `computeActualIncome` runs its two halves in two transactions (`budgets.service.ts:1047-1078`).
- A26-S02-02 confirmation (report surfaces): the 1:1 fallback `convertAmount` serves eleven endpoints: Spending by Payee, Monthly Spending Trend (`spending-reports.service.ts:329, 431`), Income by Source (`income-reports.service.ts:206`, which Cash Flow's inflow table also reads), Year over Year and Weekend vs Weekday (`comparison-reports.service.ts:100, 106, 204`), Spending Anomalies (`anomaly-reports.service.ts:111-317`), Monthly Category Breakdown (`monthly-category-breakdown.service.ts:167-321`), Tax Summary, Recurring Expenses, Bill Payment History (`tax-recurring-reports.service.ts:202, 360, 555`), Uncategorized and Duplicate Transactions (`data-quality-reports.service.ts:117, 197, 204`). Complete-or-null today: Spending by Category (`FxAggregate`), Income vs Expenses (`tryConvertAmount`), Cash Flow Sankey (INV-SANKEY-004).

#### S17 (`17-ai-mcp-notifications.md` section 9)

- **D1 - untrusted email text in a run that offers a tool with no card.** An ordinary assistant run that claims an `email_receipt` or `email_trade` request receives the email body (`ai-review-work.service.ts:233-245, 335-359`, up to `AI_REVIEW_EMAIL_TEXT_MAX_CHARS`), and that run still offers `fetch_bond_series`, which writes reference data with no confirmation card; only the parser generator run withdraws it (`NETWORK_WRITING_TOOL_NAMES`, `tool-definitions.ts:1337`; `email-receipt-parser-generate.service.ts:62-64`). An instruction in a shop's email could make the run fetch and store a bond series the person never asked for (INV-BOND-008: nothing fetches a series until a person acts). Bounded: the target is the issuer's official source, the allowance is 10 a minute, and nothing reaches the ledger. Depends on model compliance, so not a present-day failure (Rule 1). Remediation: pass `excludeTools: NETWORK_WRITING_TOOL_NAMES` for the rest of any run once a tool result carries `emailReceipt(s)`.
- **D2 - the MCP and AI daily write caps are check-then-act** (`mcp-write-limiter.ts` `reserve`, `ai-actions.service.ts:200-209`): concurrent calls can overshoot by their number. Every write is still confirmed by a person.
- **D3 - `isGenerating` is process-local** (`ai-insights.service.ts:69, 130`): a second replica answers `false` while the first generates; cosmetic since the lease is the exclusion.
- **D4 - MCP direct commits build DTOs without class-validator** (`transactions.tool.ts:1130-1143` and siblings), unlike the AI executors' `toValidatedDto`. Today every field comes from a server-side preview, so nothing unvalidated reaches the service; a future field copied from tool input would skip the DTO bounds. A shared commit through `AiActionsService.commitApproved` (as `manage_transaction_rules` already does) would remove the second commit path altogether.
- **D5 - 2025-era confirmations across replicas** without sticky routing read a lost answer as `"unsupported"` and proceed under the client's own approval (documented in `docs/backend/mcp.md`; deployment rule, not a code defect).

#### S18 (`18-frontend-core.md` section 9)

- `total*` fields on `PortfolioSummary` and `AccountHoldings` stay numeric (a subtotal) when `valuationComplete` is false; every consumer must read the flag (A26-S02-03 shows several do not). Server-side rename to `null` plus a `known*Subtotal` field would make the type enforce it.
- Decimal columns arrive as strings while every type says `number` (section 7.1 kind 4). Correct today only because readers coerce; a new reader that adds two amounts concatenates them. A response mapper (or a numeric `transformer` on the entities) would close it.
- Cached payloads carry neither the reporting currency nor the reader's "today", so any cache surviving a preference change mislabels (A26-S18-03 residual).
- Filter state in `localStorage` (account ids, free-text search) survives logout; ids only resolve for their owner, but the search text is the previous user's typing.
- The balance-cache guard is a route list; any new write route that moves transaction-derived figures must be added by hand (A26-S18-01).

#### S19 (`19-frontend-forms.md` section 9)

- `getLocalDateString()` for a duplicate's date (`TransactionForm.tsx:336`) is the browser's day, not the financial today that `frontend/CLAUDE.md` names (`useFinancialToday`); a user whose timezone preference differs from the device duplicates onto a different day near midnight.
- The server cannot distinguish a client-normalized transfer amount from a typed one, so every transfer form defect of the A26-S19-01 kind becomes a re-pricing. A transfer update DTO naming the leg the client treats as the source (or the leg ids it read) would let the server refuse a mismatch.
- The OIDC delete-data options are not part of what the reauth artifact binds; today the reset to defaults after the redirect makes this safe by accident.

#### S20 (`20-frontend-figures.md` section 9)

- **D-S20-01:** client-side conversion of per-currency summary buckets uses today's rate (`useExchangeRates`), so a historic income total moves with today's FX; INV-FX-002 asks for the row's own rate. A server-authoritative converted summary (as `getTransactionSummary` does for investments) would remove it.
- **D-S20-02:** report settings persisted in localStorage (`SANKEY_STORAGE_KEYS.accounts` and the account pickers of other reports) are not scoped to the user or the acting context; after a switch the stored owner account ids are sent under the new context, where `resolveScope` intersects them away and the report shows an empty scope. No disclosure (the server filters), a confusing empty report.
- **D-S20-03:** `PortfolioValueWidget` prints holdings-plus-cash in its header beside a securities-only sparkline with no caption separating the two measures.
- **D-S20-04:** the server's portfolio `total*` fields stay numeric when incomplete (A26-S02 section 9); every new consumer has to remember the flag, which is how A26-S20-01 and -02 recur. A typed `{ value, complete }` pair would make the read compulsory.

#### S21 (`21-tests-ci-release.md` section 9)

- **DR-S21-1** The preview path pushes `:beta` on every merge with no CVE scan, signature or SBOM (`ci.yml:1300-1304`, deliberate). Combined with A26-S21-01, `:beta` is an unbooted, unscanned image; acceptable only while nobody is told to run it.
- **DR-S21-2** `fork-images.yml` publishes `:latest` on every push to a fork's `main` and branch images for `feat/**`, `fork/**`, with "NOT gated on the full test/security matrix" (its header). On this fork it is in active use (runs 521-525 on 2026-10-18 built and pushed branch images). Documented choice for forks; a fork that deploys `ghcr.io/<owner>/monize-*:latest` deploys untested images.
- **DR-S21-3** Liveness versus migration (from S05): the backend runs `db-init` and `db-migrate` before `listen`; the chart's liveness probe (`initialDelaySeconds: 10`, `periodSeconds: 60`, default `failureThreshold: 3`, no `startupProbe`, `values.yaml:282-288`) restarts a pod whose migrations run longer than about 190 s, and the restarted pod starts the same migration again. A `startupProbe` or a pre-upgrade Job is a chart decision.
- **DR-S21-4** Direct `[skip ci]` pushes by the maintainer: `3519269` "fix(deps): bump vite ... and hono" was committed two seconds before `bfb57ca` "docs(trail) ... [skip ci]" (author dates); if pushed together, no push-triggered gate ran on the dependency bump before the release dispatch tested `bfb57ca`. Not verifiable without the upstream run list (out of this session's repository scope).
- **DR-S21-5** Branch protection is not readable from the repository (REL-007); the workflow comments imply the only required check is "Verify PR checklist", which auto-passes on push events (`pr-checklist.yml:16-19`). Whether the CI jobs are required checks could not be verified (no admin API access).

#### S22 (`22-delta-review.md` section 9)

- **No hosted CI evidence for `MAIN_SHA`.** The head of `main` and the two commits below it are
  `[skip ci]`; the newest hosted `ci.yml` push run on `main` in `WMP/monize` is from 2026-10-16
  on a commit not present in the fetched history. The program's only test evidence for the
  audited revision is local (S01's full run and this session's focused runs). This joins
  A26-S02-10 / MON-M45 and INV-RELEASE-001 (`partial`) with S21; S23 should state it in the
  final report's limitations.

## 16. Areas reviewed without material findings

As recorded by each session (section 12); "not stated" means the session listed none, never that
the area is clean.

- **S01 baseline (`01-baseline.md`):** The DB-primitive bans and their documented list (MON-M02); allowlist vs call sites (81 entries, 214 call sites, no stale, none missing); cron doc vs code (49 handlers, one row per handler, expressions); CI image registries (Dockerfiles `FROM mirror.gcr.io`); guard specs' skip conditions.
- **S02 prior high triage (`02-prior-high-triage.md`):** H02 export/stage/restore ordering; H03 start/create/wipe ordering; H07 absolute writers; H08 holding lock namespace; H09 consume; H13 replay sites; H14 form; H15 dialog; M42 logout; M44 discovery.
- **S03 security auth (`03-security-auth.md`):** Claim consume (MON-H09), logout (MON-M23), lockout increment (MON-M24), OIDC re-auth (MON-M05), activity attribution (MON-M07), profile allowlist (MON-M03), grant issuance (MON-M26), PAT scopes (MON-L01), TOTP replay, admin last-admin locking (`lockAdminsForUpdate`), push subscription ownership clause, OAuth consent CSRF, frontend credential persistence.
- **S04 RLS tenancy (`04-rls-tenancy.md`):** `withScopedDb` identity join refusal and isolation refusal, GUC emission per mode, fail-closed helpers (`NULLIF(...)::uuid`, `COALESCE`), runtime role check and provisioning (MON-M14), `schema_migrations` write revoke, `WITH_CONTEXT_ALLOWLIST` completeness, the `oauth_payloads` and `PgListener` exceptions, MCP bearer context seeding, MON-M06 flows under enforcement.
- **S05 migrations schema (`05-migrations-schema.md`):** Replay idempotency of all 56 (guards on every statement; executed); RLS enable + policy shipped in the same file for each of the 19 user-owned tables created; RLS-exempt tables (`push_chart_artifacts`, `auth_attempt_counters`, `single_use_tokens`, `oauth_instance_config`, `fetch_sync`, `update_check_state`, `http_throttle_counters`, `auto_backup_policy`, bond reference tables) carry no owner column; no migration names a role; arbiters for every `ON CONFLICT` except `budget_periods` in the harness; `required-db-functions` registration; the startup lock and the ledger revoke (executed).
- **S06 backup restore (`06-backup-restore.md`):** Export snapshot, decompression bound, re-auth ordering, AI key transport, reference resolution and remap, carried-bytes validation and blob rebuild, legacy ownership proof, path containment on both stores and both providers, support-backup currency pseudonymisation, admin gating of the policy and browse routes, attachment cap lock.
- **S07 cash ledger (`07-cash-ledger.md`):** `deletionBalanceEffect` and its single caller pattern (`removeLockedTransactionLeg`); `applyRegisterOrder` total order and the page window; same-owner `updateTransfer` and `removeTransfer`; `update()` and `remove()` lock placement; MCP/AI transfer routing; the `is_closed` predicate; currency derivation on create/update/transfer.
- **S08 scheduler cron (`08-scheduler-cron.md`):** Cron selection (postponed and override-moved occurrences, `:574-608`); the pre-lock and under-lock checks (`sameScheduleMutationBasis`, override and split bases); loan pricing re-resolution on both posting paths (presence and lock order); the reminder lease and delivery record; the dispatch seam; budget rollover claim and release; the 30-day claim sweep; the S06 manual fan-out.
- **S09 import mny (`09-import-mny.md`):** One-active-job index and its 409 mapping; claim CAS; token-scoped progress, heartbeat, complete and fail; reaper grouping (`reapStatement` parenthesis); wipe-after-slot ordering; maintenance-lease interlock in `create`; `userId` from the JWT on all routes.
- **S10 rules banksync csv (`10-rules-banksync-csv.md`):** INV-BANKSYNC-002, -003, -004; INV-RULE-001 (matched row), -004, -005; INV-PAYEE-001, -002; concurrent sync arbitration; rules inside the inserting transaction on every creation path found.
- **S11 email receipts (`11-email-receipts.md`):** INV-RECEIPT-001 read-only IMAP; INV-RECEIPT-002 ingest transaction and cursor; INV-RECEIPT-004 host policy at save and connect; INV-RECEIPT-005 secrets; INV-RECEIPT-007 OAuth state; the email HTML frame; parser patterns without `RegExp`; archive decompression bounds; the AI's answers (validated, owned categories, never confirmed by the AI path); the write-limit exemption; the trade confirm's `beforeWrite` / `afterWrite` under the holdings lock; the mailbox settings round trip; the parser form's refusal to edit what it cannot represent; the document scanner (client-only).
- **S12 securities holdings (`12-securities-holdings.md`):** The SPLIT reducer and its guards; commission in basis on every backend replay; non-positive rate refusal; `updateStatus` (row lock and advisory lock, VOID crossings mirror the cash leg); the provider currency checks on every provider write path read; the MSN negative cache; the Yahoo breaker door; the daily-change resolver and the movers board; manual price route ownership.
- **S13 valuation fx networth (`13-valuation-fx-networth.md`):** The resolver's look-ahead, age bound and direction rule; `FxAggregate`; `getRateForDate` / `getLiveRate` / `resolveStoredRate`; the portfolio summary's `convertToDefault` and `primeLiveRates`; the monthly net-worth fold's flags; Monte Carlo refusals; the currency delete gate and its race; `normalizeFxEntry` / `assertTransactionCurrencyMatchesAccount`; the period-result arithmetic; the forecast's unknown occurrence handling; portfolio movement notifications (read `valuationComplete === true`).
- **S14 bonds (`14-bonds.md`):** The redemption split identity and its booking; per-bond rounding; window refusals; lots per account and series; the price writer's precedence and deletes; recompute locking; series store idempotency; provider failure in the series fetch; notification dispatch outside transactions and the maturity-coupon exclusion; NBP and GUS coverage.
- **S15 loans strategies (`15-loans-strategies.md`):** The posting boundary's lock order and re-resolution on both branches; the claim INSERT and its backstop; the rate timeline (dated, 0 % distinct from unknown on the settlement path); the waterfall's clamp order; the minor-unit booking never retiring more than the debt; LOC exemption from deactivation; loan controllers' auth; the settlement amount policy (read against spec section 8).
- **S16 budgets reports (`16-budgets-reports.md`):** not stated in section 12 (no such list; section 12 lists undetected mutation rows only: VOID in budget actuals; rollover relation; fingerprint index removal; next-period dates; budget currency conversion).
- **S17 ai mcp notifications (`17-ai-mcp-notifications.md`):** MCP identity per request, credential binding and the 403/401 paths; the relay caller-scoped liveness and card routing; the dispatch seam's lock, dedupe and fan-out order; system-alert insert winner and email claim; push subscribe refusals, endpoint ownership, hold and purge; the chart route's credential (256-bit nonce plus HMAC, one-use `DELETE ... RETURNING`); the AI review claim keys; the MCP bearer verifiers against `JWT_SECRET` tokens.
- **S18 frontend core (`18-frontend-core.md`):** Logout and its retry (MON-M36/M42); the `dedupe` generation mechanism; `useExchangeRates` 1:1 half; the share target's ownership and logout sweep (INV-SHARE-001..005); `investmentsApi.refreshSelectedPrices` write-nothing rule; scheduled-post, split, transfer, bulk, import, bank-sync and investment-trade invalidation; `backupApi.restoreBackup` `clearAllCache()`; `forecast.ts` settlement-account remap and unknown-rate withholding.
- **S19 frontend forms (`19-frontend-forms.md`):** The override editor's stored price (MON-H15), the reauthentication artifact on delete-account and delete-data, the restore result counters, the transfer mode lock, the date input, the rules editor value controls, the onboarding serializer (beyond A26-S13-05), the split editor's sign handling.
- **S20 frontend figures (`20-frontend-figures.md`):** not stated in section 12 (no such list).
- **S21 tests ci release (`21-tests-ci-release.md`):** not stated in section 12.
- **S22 delta review (`22-delta-review.md`):** not stated in section 12 (the delta is empty; every A26 HIGH (18) and every STILL_OPEN prior finding recorded as untouched by the delta).

## 17. Complete deduplication and supersession register

### 17.1 Every session finding, exactly once

Relations: `primary` (the canonical text), `merged surface` (a distinct surface of the same root,
carried verbatim under the canonical), `superseded` (the same root and scenario re-stated by a
later session; pointer only). 143 rows; the S02-11 re-statement inside `13-valuation-fx-networth.md`
section 4 is the same finding and is not counted twice.

| Session finding | Report | Canonical | Relation |
| --- | --- | --- | --- |
| A26-S01-01 | `01-baseline.md` | A26-L01 | primary |
| A26-S01-02 | `01-baseline.md` | A26-L02 | primary |
| A26-S01-03 | `01-baseline.md` | A26-L03 | primary |
| A26-S01-04 | `01-baseline.md` | A26-L04 | primary |
| A26-S02-01 | `02-prior-high-triage.md` | A26-H03 | superseded |
| A26-S02-02 | `02-prior-high-triage.md` | A26-H10 | superseded |
| A26-S02-03 | `02-prior-high-triage.md` | A26-H15 | superseded |
| A26-S02-04 | `02-prior-high-triage.md` | A26-H07 | superseded |
| A26-S02-05 | `02-prior-high-triage.md` | A26-H08 | superseded |
| A26-S02-06 | `02-prior-high-triage.md` | A26-M07 | superseded |
| A26-S02-07 | `02-prior-high-triage.md` | A26-M09 | superseded |
| A26-S02-08 | `02-prior-high-triage.md` | A26-M11 | superseded |
| A26-S02-09 | `02-prior-high-triage.md` | A26-M18 | superseded |
| A26-S02-10 | `02-prior-high-triage.md` | A26-M41 | merged surface |
| A26-S02-11 | `02-prior-high-triage.md` | A26-L05 | primary |
| A26-S02-12 | `02-prior-high-triage.md` | A26-M42 | merged surface |
| A26-S03-01 | `03-security-auth.md` | A26-H01 | primary |
| A26-S03-02 | `03-security-auth.md` | A26-M01 | primary |
| A26-S03-03 | `03-security-auth.md` | A26-L06 | primary |
| A26-S03-04 | `03-security-auth.md` | A26-M42 | merged surface |
| A26-S03-05 | `03-security-auth.md` | A26-L07 | primary |
| A26-S03-06 | `03-security-auth.md` | A26-L08 | primary |
| A26-S03-07 | `03-security-auth.md` | A26-M02 | primary |
| A26-S04-01 | `04-rls-tenancy.md` | A26-M04 | primary |
| A26-S04-02 | `04-rls-tenancy.md` | A26-M05 | primary |
| A26-S04-03 | `04-rls-tenancy.md` | A26-M06 | primary |
| A26-S04-04 | `04-rls-tenancy.md` | A26-M42 | merged surface |
| A26-S05-01 | `05-migrations-schema.md` | A26-M42 | merged surface |
| A26-S05-02 | `05-migrations-schema.md` | A26-L09 | primary |
| A26-S05-03 | `05-migrations-schema.md` | A26-L11 | superseded |
| A26-S06-01 | `06-backup-restore.md` | A26-M07 | primary |
| A26-S06-02 | `06-backup-restore.md` | A26-M08 | primary |
| A26-S06-03 | `06-backup-restore.md` | A26-L10 | primary |
| A26-S06-04 | `06-backup-restore.md` | A26-L11 | primary |
| A26-S06-05 | `06-backup-restore.md` | A26-M08 | merged surface |
| A26-S06-06 | `06-backup-restore.md` | A26-M42 | merged surface |
| A26-S07-01 | `07-cash-ledger.md` | A26-H03 | primary |
| A26-S07-02 | `07-cash-ledger.md` | A26-H06 | primary |
| A26-S07-03 | `07-cash-ledger.md` | A26-M09 | primary |
| A26-S07-04 | `07-cash-ledger.md` | A26-M10 | primary |
| A26-S07-05 | `07-cash-ledger.md` | A26-M11 | primary |
| A26-S07-06 | `07-cash-ledger.md` | A26-M12 | primary |
| A26-S07-07 | `07-cash-ledger.md` | A26-M13 | primary |
| A26-S07-08 | `07-cash-ledger.md` | A26-L12 | primary |
| A26-S07-09 | `07-cash-ledger.md` | A26-M42 | merged surface |
| A26-S08-01 | `08-scheduler-cron.md` | A26-H07 | primary |
| A26-S08-02 | `08-scheduler-cron.md` | A26-M14 | primary |
| A26-S08-03 | `08-scheduler-cron.md` | A26-M15 | primary |
| A26-S08-04 | `08-scheduler-cron.md` | A26-L13 | primary |
| A26-S08-05 | `08-scheduler-cron.md` | A26-M42 | merged surface |
| A26-S09-01 | `09-import-mny.md` | A26-H08 | primary |
| A26-S09-02 | `09-import-mny.md` | A26-M42 | merged surface |
| A26-S09-03 | `09-import-mny.md` | A26-M16 | primary |
| A26-S09-04 | `09-import-mny.md` | A26-L14 | primary |
| A26-S09-05 | `09-import-mny.md` | A26-L15 | primary |
| A26-S09-06 | `09-import-mny.md` | A26-M17 | primary |
| A26-S10-01 | `10-rules-banksync-csv.md` | A26-H09 | primary |
| A26-S10-02 | `10-rules-banksync-csv.md` | A26-M18 | primary |
| A26-S10-03 | `10-rules-banksync-csv.md` | A26-M19 | primary |
| A26-S10-04 | `10-rules-banksync-csv.md` | A26-L16 | primary |
| A26-S10-05 | `10-rules-banksync-csv.md` | A26-M13 | merged surface |
| A26-S11-01 | `11-email-receipts.md` | A26-L13 | merged surface |
| A26-S11-02 | `11-email-receipts.md` | A26-L17 | primary |
| A26-S11-03 | `11-email-receipts.md` | A26-L18 | primary |
| A26-S11-04 | `11-email-receipts.md` | A26-H02 | primary |
| A26-S12-01 | `12-securities-holdings.md` | A26-H04 | primary |
| A26-S12-02 | `12-securities-holdings.md` | A26-H11 | merged surface |
| A26-S12-03 | `12-securities-holdings.md` | A26-M20 | primary |
| A26-S12-04 | `12-securities-holdings.md` | A26-M21 | primary |
| A26-S12-05 | `12-securities-holdings.md` | A26-M22 | primary |
| A26-S12-06 | `12-securities-holdings.md` | A26-M23 | primary |
| A26-S12-07 | `12-securities-holdings.md` | A26-L19 | primary |
| A26-S12-08 | `12-securities-holdings.md` | A26-L20 | primary |
| A26-S12-09 | `12-securities-holdings.md` | A26-M24 | primary |
| A26-S12-10 | `12-securities-holdings.md` | A26-L21 | primary |
| A26-S13-01 | `13-valuation-fx-networth.md` | A26-H10 | primary |
| A26-S13-02 | `13-valuation-fx-networth.md` | A26-H11 | primary |
| A26-S13-03 | `13-valuation-fx-networth.md` | A26-H05 | primary |
| A26-S13-04 | `13-valuation-fx-networth.md` | A26-H15 | merged surface |
| A26-S13-05 | `13-valuation-fx-networth.md` | A26-M25 | primary |
| A26-S13-06 | `13-valuation-fx-networth.md` | A26-M17 | merged surface |
| A26-S14-01 | `14-bonds.md` | A26-M26 | primary |
| A26-S14-02 | `14-bonds.md` | A26-M26 | merged surface |
| A26-S14-03 | `14-bonds.md` | A26-L22 | primary |
| A26-S15-01 | `15-loans-strategies.md` | A26-H06 | merged surface |
| A26-S15-02 | `15-loans-strategies.md` | A26-M27 | primary |
| A26-S15-03 | `15-loans-strategies.md` | A26-M28 | primary |
| A26-S15-04 | `15-loans-strategies.md` | A26-M29 | primary |
| A26-S15-05 | `15-loans-strategies.md` | A26-M33 | merged surface |
| A26-S15-06 | `15-loans-strategies.md` | A26-L23 | primary |
| A26-S15-07 | `15-loans-strategies.md` | A26-L24 | primary |
| A26-S15-08 | `15-loans-strategies.md` | A26-L25 | primary |
| A26-S15-09 | `15-loans-strategies.md` | A26-L26 | primary |
| A26-S15-10 | `15-loans-strategies.md` | A26-M30 | primary |
| A26-S16-01 | `16-budgets-reports.md` | A26-H12 | primary |
| A26-S16-02 | `16-budgets-reports.md` | A26-M31 | primary |
| A26-S16-03 | `16-budgets-reports.md` | A26-M32 | primary |
| A26-S16-04 | `16-budgets-reports.md` | A26-H15 | merged surface |
| A26-S16-05 | `16-budgets-reports.md` | A26-M33 | primary |
| A26-S16-06 | `16-budgets-reports.md` | A26-H12 | merged surface |
| A26-S16-07 | `16-budgets-reports.md` | A26-L38 | primary |
| A26-S16-08 | `16-budgets-reports.md` | A26-L39 | primary |
| A26-S16-09 | `16-budgets-reports.md` | A26-M42 | merged surface |
| A26-S17-01 | `17-ai-mcp-notifications.md` | A26-H12 | merged surface |
| A26-S17-02 | `17-ai-mcp-notifications.md` | A26-M14 | merged surface |
| A26-S17-03 | `17-ai-mcp-notifications.md` | A26-M34 | primary |
| A26-S17-04 | `17-ai-mcp-notifications.md` | A26-L27 | primary |
| A26-S17-05 | `17-ai-mcp-notifications.md` | A26-M42 | merged surface |
| A26-S17-06 | `17-ai-mcp-notifications.md` | A26-L28 | primary |
| A26-S17-07 | `17-ai-mcp-notifications.md` | A26-L29 | primary |
| A26-S18-01 | `18-frontend-core.md` | A26-M35 | primary |
| A26-S18-02 | `18-frontend-core.md` | A26-M35 | merged surface |
| A26-S18-03 | `18-frontend-core.md` | A26-M35 | merged surface |
| A26-S18-04 | `18-frontend-core.md` | A26-H11 | merged surface |
| A26-S18-05 | `18-frontend-core.md` | A26-H08 | merged surface |
| A26-S18-06 | `18-frontend-core.md` | A26-M03 | primary |
| A26-S18-07 | `18-frontend-core.md` | A26-M35 | merged surface |
| A26-S18-08 | `18-frontend-core.md` | A26-M36 | merged surface |
| A26-S18-09 | `18-frontend-core.md` | A26-L30 | primary |
| A26-S18-10 | `18-frontend-core.md` | A26-L31 | primary |
| A26-S18-11 | `18-frontend-core.md` | A26-L32 | primary |
| A26-S19-01 | `19-frontend-forms.md` | A26-H13 | primary |
| A26-S19-02 | `19-frontend-forms.md` | A26-H14 | primary |
| A26-S19-03 | `19-frontend-forms.md` | A26-M37 | primary |
| A26-S19-04 | `19-frontend-forms.md` | A26-H11 | merged surface |
| A26-S19-05 | `19-frontend-forms.md` | A26-M22 | merged surface |
| A26-S19-06 | `19-frontend-forms.md` | A26-L33 | primary |
| A26-S19-07 | `19-frontend-forms.md` | A26-L30 | merged surface |
| A26-S20-01 | `20-frontend-figures.md` | A26-H15 | primary |
| A26-S20-02 | `20-frontend-figures.md` | A26-M38 | primary |
| A26-S20-03 | `20-frontend-figures.md` | A26-M39 | primary |
| A26-S20-04 | `20-frontend-figures.md` | A26-M36 | primary |
| A26-S20-05 | `20-frontend-figures.md` | A26-M39 | merged surface |
| A26-S20-06 | `20-frontend-figures.md` | A26-L34 | primary |
| A26-S20-07 | `20-frontend-figures.md` | A26-L30 | merged surface |
| A26-S20-08 | `20-frontend-figures.md` | A26-M39 | merged surface |
| A26-S21-01 | `21-tests-ci-release.md` | A26-M40 | primary |
| A26-S21-02 | `21-tests-ci-release.md` | A26-M41 | primary |
| A26-S21-03 | `21-tests-ci-release.md` | A26-M40 | merged surface |
| A26-S21-04 | `21-tests-ci-release.md` | A26-M42 | primary |
| A26-S21-05 | `21-tests-ci-release.md` | A26-L35 | primary |
| A26-S21-06 | `21-tests-ci-release.md` | A26-L36 | primary |
| A26-S21-07 | `21-tests-ci-release.md` | A26-L37 | primary |


### 17.2 Where two sessions disagree, and the reading S23 takes

Each item is marked for the maintainer.

| # | Question | Session A | Session B | S23 reading and evidence |
| --- | --- | --- | --- | --- |
| 1 | Should loan-occurrence slot selection prefer the cursor's own unpaid slot? | S08 (A26-S08-03 hand-off): the selection picks the nearest free slot, cursor and later slots included, and a claim ahead of the cursor stalls the schedule | S15 (section 8, D2): nearest-then-earlier is the spec's deliberate rule (`docs/specs` loan settlement 6.2 step 3, truth table rows 10-12); with the default 3/7 window the cursor slot and the next are never both candidates | S15's reading (Rule 2, a documented exception beats similarity). The defect is A26-M15 in `post()`; the selection stays; wide windows are design risk D2. **Maintainer:** confirm the wide-window policy. |
| 2 | Does `TransactionsService.update()` keep a transfer's counterpart leg in step? | S07 (A26-S07-04, executed): no; `PATCH /transactions/:id` changes one leg (legs -100.00 / +150.00, 200) | S17 (section 12): the AI/MCP previews refuse transfers, `update()` itself does not; reachable by a rule's `convert_to_transfer` between a card and its confirm, and by a plain PATCH | Not a contradiction: S07 answers S17's question with execution. A26-M10 carries S17's two extra entry points as surfaces; task T06 adds the rule-conversion path to its test matrix. **Maintainer:** choose refuse-on-leg (S07's correction) or route to `updateTransfer`. |
| 3 | Severity of the completeness-flag gap | S02 (A26-S02-03): MEDIUM, static for half | S20 (A26-S20-01): HIGH, four surfaces executed | HIGH (section 6.2). |
| 4 | Severity of the intraday `sessionStorage` leak | S18 (A26-S18-08): LOW, shared device | S20 (A26-S20-04): MEDIUM, also the delegate-context switch | MEDIUM (A26-M36). |
| 5 | MON-H14 status | S02: FIXED_VERIFIED (preview and commit align) | S12, S19: STILL_OPEN with a different root (both align on a rate INV-FX-001 forbids) | STILL_OPEN (A26-H11); S02 tested the pair's agreement, S12 the rate's date. |
| 6 | Is the MNY client copy a separate finding? | S18 (A26-S18-05): distinct from the replay; consolidate if one PR | S09 (A26-S09-01): the false report is part of the root | Merged as a surface of A26-H08, one task (T04). |
| 7 | Should A26-S14-01 join S13's valuation findings? | S14 hand-off: "a net-worth valuation-series root, consolidate with S13's position-price findings" | S13: no position-price finding of that root was raised | Kept separate (A26-M26): the root is the blend readers not honouring the bond engine's refusal, not a dropped flag; task T33 checks the S13 net-worth readers it names. |
| 8 | Mutation-table wording | Ledger: S03 row ":222+226 drop both guards" | S21 section 6.2: the report's table has ":222 keep the hash and :226 drop used_at IS NULL" | The report (S21's merge). |
| 9 | Cron count | `plan.md`: 40 | S01: 49 handlers in 46 services | S01 (counted). |

## 18. Final BLOCKER/HIGH verification ledger

No BLOCKER candidate was raised by any session. Every HIGH member below was executed at the
baseline code in a scratch worktree (plan section 4 step 7); "Confidence" and "Execution" are the
session's fields 2 and 6, abridged only where marked with an ellipsis. Superseded members are
covered by their primary's execution.

**A26-H01** (Refresh-token reuse detection does not revoke the family: the revocation is rolled back by the exception that reports it)

- A26-S03-01 (P, `03-security-auth.md`, session severity HIGH). Confidence: high (executed against PostgreSQL 16) Execution: probe `AUDIT S03 probe: refresh reuse` (scratch worktree, real `TokenService`, real PostgreSQL): AUDIT-PROBE rows after reuse [{"is_revoked":true,"replaced_by_hash":"05a7e8ca..."},{"is_revoked":false,"replaced_by_hash":null}] AUDIT-PROBE successorStillRotates true Expected: false / Received: true The reuse is reported (401 to the victim, cookies cleared) while the attacker's successor rotates successfully afterwards.

**A26-H02** (Any sender can make an email read as the broker's by pasting a forwarded-message header block; with auto-apply the trade it states is booked)

- A26-S11-04 (P, `11-email-receipts.md`, session severity HIGH). Confidence: high (executed, P3, real PostgreSQL under RLS, the real poll, pipeline, card, auto-apply and `confirm`) Execution: `email_receipts` row `from_address = notifications@wealthsimple.com`, `from_domain = wealthsimple.com`, `forwarded_by = someone@evil.example`, status `review`; `ai_review_requests` one `email_trade`, status `applied`; `investment_transactions` one `BUY`, quantity 10, `total_amount` 2000.0000; the linked cash account's `current_balance` 10 000.0000 -> 8 000.0000. Control (P3b, the same body without the block): `from_domain = evil.example`, status `no_parser`, no trade, balance unchanged. Without auto-apply the same email produces a signed card labelled with the broker's identity that waits for approval.

**A26-H03** (Transfer edit paths derive both balance deltas from pre-transaction snapshots (split-transfer leg, connected cross-owner transfer))

- A26-S07-01 (P, `07-cash-ledger.md`, session severity HIGH). Confidence: high (executed, both surfaces) Execution: (a) both 200; chequing stored 4 880.00 vs ledger 4 890.00, savings stored 2 060.00 vs ledger 2 050.00, 5 of 5 iterations. (b) both 200; Bob's savings stored 1 300.00 vs ledger 1 400.00; Alice's chequing stored 5 700.00 vs ledger 5 600.00.
- A26-S02-01 (superseded): covered by the primary's execution.

**A26-H04** (Editing an investment transaction twice at once, or while it is deleted, duplicates or orphans its cash leg)

- A26-S12-01 (P, `12-securities-holdings.md`, session severity HIGH). Confidence: high (executed, forced interleaving, R1 and R2) Execution: R1 -- two cash rows, ledger -2,200.00, balance 97,800.00; the investment row names C3 only. R2 -- investment row gone, one cash row -1,100.00 left, balance 98,900.00.

**A26-H05** (Bulk-deleting one leg of a split transfer deletes the parent but leaves the other legs, creating their money)

- A26-S13-03 (P, `13-valuation-fx-networth.md`, session severity HIGH). Confidence: high (executed, P4, against the schema's `ON DELETE` actions) Execution: `{"deleted":1}`; balances A 1,000.00, B 0.00, C 40.00; the ledger holds one row, C's +40.00 transfer, with `linked_transaction_id: null`. The sum of the three balances is 1,040.00.

**A26-H06** (Undo or redo of an account edit restores a whole-entity snapshot: the edit-time balance is written back absolutely and a loan's coupled template is left unrepriced or unlinked)

- A26-S07-02 (P, `07-cash-ledger.md`, session severity HIGH). Confidence: high (executed) Execution: `"Undone: Updated account \"Chequing renamed\""`; chequing stored 5 000.00, ledger 4 800.00.
- A26-S15-01 (M, `15-loans-strategies.md`, session severity HIGH). Confidence: high (executed, both halves) Execution: (a) after the undo the account is ANNUITY with `payment_amount` 1,108.86 and the template still holds 1,333.3333; the next advancement (`rewriteLoanTemplate`, purpose `template`) leaves it at 1,333.3333 (`max(template, dated payment)`), and the posting purpose prices principal 833.3333 + interest 500.00 = **1,333.3333**. (b) after the undo the account's category is A and the template line is B: `identifyLoanTemplate(...).managed === false`, so every later posting declines to re-price (posts the stored split), the template never advances, and a `settle_loan_installment` rule refuses `loan_not_configured` (`managedTemplate`).

**A26-H07** (Manual post and skip of a scheduled transaction are not pinned to the occurrence the user saw; a stale view pays a bill twice or consumes the next occurrence)

- A26-S08-01 (P, `08-scheduler-cron.md`, session severity HIGH). Confidence: high (executed, P2, P3, P7) Execution: (a) P2: two rows dated 2026-09-01, balance 0.00, claims `[2026-09-01, 2026-10-01]`, cursor 2026-11-01 -- October was consumed early under September's date. (b) P7: the deactivated schedule posts again: two rows dated 2026-09-01, balance 0.00 instead of 50.00, a claim on 2026-10-01 for a schedule that had no occurrence left. (c) P3: cursor 2026-10-01 -> 2026-11-01; October is skipped although the user skipped September (already paid), and October's override, if any, is deleted with it.
- A26-S02-04 (superseded): covered by the primary's execution.

**A26-H08** (A failure after the MNY import's data commit is reported as "Nothing was saved", and the same file can then be imported again)

- A26-S09-01 (P, `09-import-mny.md`, session severity HIGH). Confidence: high (executed: failpoint over three fixtures plus a re-upload variant) Execution: Sample Deposit Account 5000.00 -> 10000.00; investment cash 4061.00 -> 8122.00; holding 1000 -> 2000 shares; job 2 reports `completed` with two `balanceMismatch` warnings. Same-staged-id path: identical result (`money2002`: 60 -> 120 investment rows, every holding 0.02 -> 0.04).
- A26-S02-05 (superseded): covered by the primary's execution.
- A26-S18-05 (M, `18-frontend-core.md`, session severity MEDIUM). Confidence: high (static, every link cited; the copy is asserted by the existing test `MnyImportProgress.test.tsx:160-167`) Execution: the job is `failed`, `errorKey: 'mnyImportFailed'`, `retryable: false`; the wizard shows "Something went wrong while importing. Nothing was saved -- you can try again." with only "Start over".

**A26-H09** (A bank transaction whose entry reference the bank repeats on a later day is imported twice, or a later one is silently dropped (INV-BANKSYNC-001))

- A26-S10-01 (P, `10-rules-banksync-csv.md`, session severity HIGH). Confidence: high for the mechanism (executed); medium for frequency (it needs a bank that repeats `entry_reference`, which the spec and the code both say happens: Enable Banking FAQ, `bank-transaction-planner.ts:363-366`, `docs/specs/bank-sync.md` section 6). Execution: scratch integration case on real PostgreSQL (enforced RLS harness of `bank-sync.integration.spec.ts`): sync 2 returns `imported: 2, skipped: 0`; the account holds 3 rows; balance `983` = 1000 - 5 - 5 - 7. The planner probe gives `first=ref:R-1`, `second=["ref:R-1#638be0ba...","ref:R-1#6e56756a..."]`. The other direction: when the reuse arrives after the first row has left the window, the new row is alone in its fetch, keyed `ref:<reference>`, hits the first row's ledger entry, and is counted as `skipped` ("already imported"): a real bank transaction is never imported and nothing says so.

**A26-H10** (Built-in reports convert a missing exchange rate 1:1 and label the result in the reporting currency (MON-H12, MON-M39))

- A26-S13-01 (P, `13-valuation-fx-networth.md`, session severity HIGH). Confidence: high (executed, P2; the known-wrong unit test passes) Execution: `{"data":[{"payeeName":"Shop","total":100000}],"totalSpending":100000}` and the data-quality row `{"amount":-100000,"currencyCode":"USD", ...}` with `summary.expenseTotal: 100000, currencyCode: "USD"`. No field says a currency was not converted. `report-currency.service.spec.ts:213` "returns original amount when no rate is available" asserts the defect and passes (S02 batch; re-run in section 12).
- A26-S02-02 (superseded): covered by the primary's execution.

**A26-H11** (A rate for a date is not the resolver's: the latest-rate readers use a frozen pre-1.17 mirror row and a rate of any age, and back-dated trades settle or prefill at the newest rate (INV-FX-001, INV-FX-003))

- A26-S13-02 (P, `13-valuation-fx-networth.md`, session severity HIGH). Confidence: high for the behaviour (executed, P3, P3b); medium for the severity, which grows with the time since a deployment upgraded to 1.17.0 and with the currency's move since. Execution: `getLatestRate("USD","CAD")` = 1.399999999972 (the resolver picks today's inverse row); `getLatestRates()` returns `[CAD->USD 2026-10-21, USD->CAD 2026-08-01]`; Spending by Payee answers `totalSpending: 1300`. The frontend `convert(1000, "USD", "CAD")` over the same endpoint returns 1,300.00 by the same direct-first rule (`useExchangeRates.ts:85-86`). P3b: with only a `CAD->USD 0.8` row dated 2025-12-01 (324 days old), the report answers 1,250.00 as a current figure.
- A26-S12-02 (M, `12-securities-holdings.md`, session severity MEDIUM). Confidence: high (executed, P3) Execution: the row stores `exchange_rate` 1.3700000000 and the cash leg -13,700.00 CAD. The preview carries `exchangeRate` but no field saying which rate answered (trade date, latest, or supplied).
- A26-S19-04 (M, `19-frontend-forms.md`, session severity MEDIUM). Confidence: high (executed: P4; the server half by reading) Execution: the rate field fills 1.350000 from `getRate('USD', 'CAD')` (the latest; the only call recorded); the payload carries `transactionDate: '2025-01-02', exchangeRate: 1.35`; the server keeps it, so its own dated resolution never runs.
- A26-S18-04 (M, `18-frontend-core.md`, session severity MEDIUM). Confidence: high (executed, P7) Execution: `convert(100000, 'CHF', 'USD')` returns 113 000; `getRate` returns 1.13. Every client-side aggregate built on it (`sumConverted` on the accounts page, the foreign-account view of `PortfolioSummaryCard`, the calendar and budget conversions) reports a complete figure; the server's resolver for the same pair answers unknown.

**A26-H12** (Totals sum amounts of different currencies without conversion: budget actuals, the custom report engine and the AI/MCP transaction analytics)

- A26-S16-01 (P, `16-budgets-reports.md`, session severity HIGH). Confidence: high (executed, P1) Execution: `totalSpent = 10200`, category `spent = 10200`, `percentUsed = 2040` (probe P1 output `{"totalSpent":10200,"cat":[[10200,2040]]}`).
- A26-S16-06 (M, `16-budgets-reports.md`, session severity MEDIUM). Confidence: high (static: `reports.service.ts` contains no rate, currency or conversion reference) Execution: Groceries 10 200.
- A26-S17-01 (M, `17-ai-mcp-notifications.md`, session severity MEDIUM). Confidence: high (executed, P3 against PostgreSQL; see section 7) Execution: `getLlmPeriodComparison` -> `period1.total = 400`, `period2.total = 5000`, `totalChange = 4600`, `totalChangePercent = 1150`; the summary line the model quotes is `Period 2 (...): 5000.00, Change: +4600.00 (+1150%)`. `getLlmListTransactions` -> `totalExpenses = 5000`, summary `Expenses: 5000.00`, with `byCurrency` present in the payload only.

**A26-H13** (A cross-currency transfer opened from its receiving leg loads the received amount into the source-amount field, and an unedited save re-prices the transfer (MON-H11 client half))

- A26-S19-01 (P, `19-frontend-forms.md`, session severity HIGH). Confidence: high (executed: component probe P1 and a backend integration probe on PostgreSQL) Execution: the form shows "Transfer amount (USD) 135.00" and "Amount received (CAD) 135.00" (P1 inputs); the payload is `{ fromAccountId: <USD>, toAccountId: <CAD>, amount: 135, toAmount: 135, ... }`. On PostgreSQL the same payload through `TransactionsService.updateTransfer` on the CAD leg gives: before `usdBal 900, fromLeg -100, toLeg 135, rate 1.35`; after `usdBal 865, fromLeg -135, toLeg 135, rate 1`.

**A26-H14** (Switching an existing income, expense or split to Transfer mode creates a second, new transfer and leaves the original row in place)

- A26-S19-02 (P, `19-frontend-forms.md`, session severity HIGH). Confidence: high (executed: component probe P5; the server half is the ordinary `createTransfer`, covered by `transfers.integration.spec.ts` "should create linked transactions and update both balances") Execution: submit label "Update Transfer"; `createTransfer` called once with `{ fromAccountId: 'acc-1', toAccountId: 'acc-2', amount: 50, categoryId: 'cat-1', ... }`; `update` and `updateTransfer` not called; the toast says the transfer was created.

**A26-H15** (Completeness flags are not carried or read where totals are shown: net worth, accounts, portfolio widget and history, the AI/MCP account tools, report exports and Cash Flow)

- A26-S20-01 (P, `20-frontend-figures.md`, session severity HIGH). Confidence: high (four surfaces executed, the rest read) Execution: (a) "Current Net Worth $50000", no marker, nothing names `ZZZ->USD` (probe P1 fails: `expected false to be true`). (b) Total Assets `$50000.00` with no "partial total" (probe P3 fails). (c) the widget prints `$100000` (probe P2 fails). (d) "Lowest Value $100.00" for the day the holding was unpriced (probe P4 fails). (e) read only.
- A26-S02-03 (superseded): covered by the primary's execution.
- A26-S13-04 (M, `13-valuation-fx-networth.md`, session severity MEDIUM). Confidence: high (executed, P5) Execution: `/accounts/summary` -> `{"totalAssets":1000,"netWorth":1000}` with no completeness field; `getLlmAccounts` -> `netWorth: 1000` with `missingRatePairs: ["ZZZ->USD"]` from its separate per-account conversion, and no total-level flag. The AI line prints `Net worth: 1000.00`.
- A26-S16-04 (M, `16-budgets-reports.md`, session severity MEDIUM). Confidence: high (static; the component code is direct) Execution: Cash Flow: `totals.income = null` renders "Total Inflows 0.00" and "Net +0.00 - expenses" on screen and in the PDF. Income vs Expenses PDF: "Total Income 5 000.00" with no caption. With the Cash Flow request failed: the PDF button stays enabled and writes three zero cards.


## 19. Prior-findings disposition summary

All 70 upstream findings were disposed of by their owning sessions; the wording below is the
register's final wording, with each still-open finding mapped to its canonical ID.

| Disposition | HIGH | MEDIUM | LOW | Total |
| --- | --- | --- | --- | --- |
| `FIXED_VERIFIED` | 7 | 35 | 5 | 47 |
| of which with a residual or test gap named | 0 | 6 (M04, M17, M21, M25, M29, M34) | 1 (L03) | 7 |
| `STILL_OPEN` (whole or residual) | 9 | 11 | 2 | 22 |
| `REJECTED` | 0 | 1 (M28) | 0 | 1 |
| `SUPERSEDED` | 0 | 0 | 0 | 0 |
| `NOT_LOCATED` | 0 | 0 | 0 | 0 |

The ledger's raw count before consolidation (32 in full, 11 with residual, 24 still open, 2
rejected) counted split rows (server and client halves) separately; the table above counts each
upstream ID once, at its worst half. MON-H14 is the one row whose S02 triage (`FIXED_VERIFIED`)
was overturned by the owning sessions (section 17.2 item 5). No upstream fix has regressed.

| ID | Title (abridged) | Owner | Final disposition | Canonical A26 |
| --- | --- | --- | --- | --- |
| MON-H01 | Automatic backups of different owners and instances share one filename and retention namespace | S06 | STILL_OPEN | A26-M07 |
| MON-H02 | Restore remaps local/S3 attachment metadata without copying or verifying the bytes | S06 | FIXED_VERIFIED | -- |
| MON-H03 | Concurrent MNY import starts create separate active jobs for one user | S09 | FIXED_VERIFIED | -- |
| MON-H04 | Import worker crash after the data commit lets retry replay the committed source | S09 | STILL_OPEN (A26-S09-01) | A26-H08 |
| MON-H05 | Transaction, transfer, reconciliation and bulk mutations derive balance deltas from stale snapshots | S07 | STILL_OPEN (A26-S07-01) | A26-H03 |
| MON-H06 | Scheduled posting has no durable occurrence identity and commits money before advancing the schedule | S08 | STILL_OPEN (residual, A26-S08-01) | A26-H07 |
| MON-H07 | Absolute balance recomputation can overwrite a concurrent committed atomic delta | S07 | FIXED_VERIFIED | -- |
| MON-H08 | Holding updates and full rebuilds can lose concurrent investment transactions | S12 | FIXED_VERIFIED | -- |
| MON-H09 | One emergency-access claim token can be consumed by two concurrent requests | S03 | FIXED_VERIFIED | -- |
| MON-H10 | Transfer VOID transitions can leave the two legs and both balances inconsistent | S07 | STILL_OPEN (residual, A26-S07-03) | A26-M09 |
| MON-H11 | Transfer currencies, FX rate and destination value are not server-authoritative | S07 (client half S19) | STILL_OPEN (server half residual, `07-cash-ledger.md#5`; QIF half A26-S10-02, `10-rules-banksync-csv.md#5`; client half A26-S19-01, `19-frontend-forms.md#5`) | A26-H13, A26-M10, A26-M18 |
| MON-H12 | Unavailable FX is converted as a valid-looking 1:1 value | S13 | STILL_OPEN (A26-S13-01, A26-S13-02) | A26-H10, A26-H11 |
| MON-H13 | Historical net-worth replay adds a stock-split ratio instead of multiplying shares | S13 | FIXED_VERIFIED | -- |
| MON-H14 | Investment preview and commit can use different exchange rates without disclosure | S12 | STILL_OPEN (server half A26-S12-02, `12-securities-holdings.md#5`; client half A26-S19-04, `19-frontend-forms.md#5`) | A26-H11 |
| MON-H15 | Opening an existing scheduled investment override replaces its stored price with the latest quote | S19 | FIXED_VERIFIED | -- |
| MON-H16 | Partial or unavailable portfolio valuations are rendered as complete totals | S20 | STILL_OPEN (A26-S20-01, HIGH) | A26-H15 |
| MON-M01 | Deployment documentation and defaults do not match Compose and Helm manifests | S21 | STILL_OPEN (narrowed, A26-S21-03) | A26-M40 |
| MON-M02 | Contributor guidance recommends transaction APIs the scoped rule prohibits | S01 | FIXED_VERIFIED | -- |
| MON-M03 | Delegated `/users/me` responses expose fields outside the delegated profile | S03 | FIXED_VERIFIED | -- |
| MON-M04 | MCP sessions keep the scopes from session creation after the bearer is revalidated | S17 | FIXED_VERIFIED (test gap, A26-S17-05) | A26-M42 |
| MON-M05 | OIDC destructive-action confirmation accepts an arbitrary non-empty value | S03 | FIXED_VERIFIED | -- |
| MON-M06 | Delegation create, link and revoke conflict with enforced RLS ownership | S04 | FIXED_VERIFIED | -- |
| MON-M07 | Delegated activity is attributed to the effective owner, not the real actor | S03 | FIXED_VERIFIED | -- |
| MON-M08 | Restore ordering can fail linked asset/loan account relationships | S06 | FIXED_VERIFIED | -- |
| MON-M09 | Automatic-backup artifacts are published through non-crash-atomic final-file operations | S06 | FIXED_VERIFIED | -- |
| MON-M10 | Authenticated users can browse and select arbitrary server filesystem backup paths | S06 | FIXED_VERIFIED | -- |
| MON-M11 | Default Helm deployment exposes automatic backup without a writable persistent mount | S06 (Helm half S21) | FIXED_VERIFIED (backup half `06-backup-restore.md#5`; Helm half `21-tests-ci-release.md#5`) | -- |
| MON-M12 | Backup export reads tables through separate transactions, not one snapshot | S06 | FIXED_VERIFIED | -- |
| MON-M13 | Backup export buffers the whole database and archive in memory | S06 | FIXED_VERIFIED | -- |
| MON-M14 | RLS enforce mode can accept an unsafe runtime database role | S04 | FIXED_VERIFIED | -- |
| MON-M15 | The runtime application role can write migration history | S05 | FIXED_VERIFIED | -- |
| MON-M16 | Restore decompression has no effective size or ratio bound | S06 | FIXED_VERIFIED | -- |
| MON-M17 | Backups containing custom currencies are not portable across instances | S06 | FIXED_VERIFIED (design residual) | -- |
| MON-M18 | Support backups retain identifying custom-currency names while UI copy says masked | S06 | FIXED_VERIFIED | -- |
| MON-M19 | Global custom-currency cleanup decides deletion from tenant-filtered evidence | S13 | FIXED_VERIFIED | -- |
| MON-M20 | Account closure can race a mutation and commit a closed non-zero account | S07 | STILL_OPEN (residual, A26-S07-06) | A26-M12 |
| MON-M21 | Concurrent incremental split additions can exceed the parent amount | S07 | FIXED_VERIFIED (test gap, A26-S07-09) | A26-M42 |
| MON-M22 | Local and S3 attachment bytes are not transactionally coupled to metadata | S06 | STILL_OPEN | A26-L10 |
| MON-M23 | Logout can miss a refresh token created by a concurrent rotation in the same family | S03 | FIXED_VERIFIED | -- |
| MON-M24 | Parallel failed logins lose counter increments and delay lockout | S03 | FIXED_VERIFIED | -- |
| MON-M25 | AI insight generation uses a process-local guard and duplicates work across replicas | S08 (claim), S17 (provider) | FIXED_VERIFIED (claim half `08-scheduler-cron.md#5`, residual A26-S08-04; provider half `17-ai-mcp-notifications.md#5`) | A26-L13 |
| MON-M26 | Emergency-access grant issuance can send links another replica immediately invalidates | S03 | FIXED_VERIFIED | -- |
| MON-M27 | Ordinary transaction currency can disagree with the owning account currency | S07 (cross-check S10) | FIXED_VERIFIED | -- |
| MON-M28 | Mixed-sign split children are accepted when their signed total equals the parent | S07 (client half S19) | REJECTED (server half `07-cash-ledger.md#5` and client half `19-frontend-forms.md#5`: mixed-sign splits are a documented shape) | -- |
| MON-M29 | Explicit zero or negative investment FX rates produce inconsistent cash postings | S12 | FIXED_VERIFIED (create and preview) | -- |
| MON-M30 | BUY commission is omitted from cost basis although cash and UI wording include fees | S12 | FIXED_VERIFIED (backend `12-securities-holdings.md#5`; UI wording `20-frontend-figures.md#5`) | -- |
| MON-M31 | Transfer split amounts are omitted from budget spending | S16 | FIXED_VERIFIED | -- |
| MON-M32 | Final scheduled loan payment recalculates splits without shrinking the parent payment | S15 | FIXED_VERIFIED | -- |
| MON-M33 | Monte Carlo current-value failure is converted to a real zero | S13 | FIXED_VERIFIED | -- |
| MON-M34 | Bulk deletion can leave linked-account monthly/net-worth snapshots stale | S13 | FIXED_VERIFIED (counterpart snapshot; related A26-S13-03 on the bulk path) | A26-H05 |
| MON-M35 | Foreign-security transfer resets destination cost basis to an implied 1:1 value | S12 | STILL_OPEN (A26-S12-04) | A26-M21 |
| MON-M36 | A failed backend logout is presented as a successful local logout | S18 | FIXED_VERIFIED | -- |
| MON-M37 | Two-decimal split editing and one-cent tolerance conflict with four-decimal persistence | S19 | STILL_OPEN (A26-S19-03, different root cause) | A26-M37 |
| MON-M38 | Successful transaction mutations leave cached budget progress stale | S18 | STILL_OPEN (narrowed, A26-S18-01) | A26-M35 |
| MON-M39 | Tests validate missing FX as a successful 1:1 conversion (verification defect) | S13 | STILL_OPEN (relocated, A26-S13-01) | A26-H10 |
| MON-M40 | The scheduled-override test expects an existing price to be overwritten (verification defect) | S19 | FIXED_VERIFIED | -- |
| MON-M41 | The historical stock-split fixture encodes additive shares (verification defect) | S13 | FIXED_VERIFIED | -- |
| MON-M42 | The AppHeader test expects logout failure to look successful (verification defect) | S18 | FIXED_VERIFIED | -- |
| MON-M43 | Automatic-backup tests expect generic cross-owner keys (verification defect) | S06 | STILL_OPEN | A26-M07 |
| MON-M44 | The backend integration CI command can succeed after discovering zero tests | S21 | FIXED_VERIFIED | -- |
| MON-M45 | The release workflow pushes a `[skip ci]` bump after testing a different SHA | S21 | STILL_OPEN (A26-S02-10) | A26-M41 |
| MON-M46 | Canonical concurrency defects lack deterministic tests at the production boundary (missing test) | S21 | STILL_OPEN (widened, A26-S21-04) | A26-M42 |
| MON-M47 | No local/S3 attachment backup-restore round trip verifies bytes and remapping (missing test) | S06 | STILL_OPEN | A26-M08 |
| MON-L01 | A stale PAT comment mentions a reports scope issuance does not support | S03 | FIXED_VERIFIED | -- |
| MON-L02 | Database initialization and migration runners are not serialized across replicas | S05 | FIXED_VERIFIED | -- |
| MON-L03 | Budget-alert deduplication is a check-then-insert race | S16 | FIXED_VERIFIED (with residuals, A26-S16-08) | A26-L39 |
| MON-L04 | Staged-file expiry can delete bytes a pending or running import still needs | S09 | STILL_OPEN (narrowed, A26-S09-04) | A26-L14 |
| MON-L05 | Concurrent attachment uploads can exceed the per-transaction cap | S06 | FIXED_VERIFIED | -- |
| MON-L06 | Bill and mortgage reminder crons send duplicate email from every replica | S08 | FIXED_VERIFIED | -- |
| MON-L07 | Test and CI documentation overstates enforcement | S21 | STILL_OPEN (narrowed) | A26-L36 |

## 20. Complete review-coverage ledger

### 20.1 Not audited this program

| Area | Why | Where it goes |
| --- | --- | --- |
| INV-SHARE-001..005 (PWA share target) | Mislabelled as joint accounts in `sessions.md`; neither S18 nor S20 took it after S04's correction | A follow-up audit session; not reported as clean |
| Categories, payees, tags, calendar (INV-PAYEE-001/002, INV-DAYNOTE-001) | S16 sampled them through their integration suites only after its sweeps were lost to the usage limit | Same |
| The five largest forms beyond the sampled ranges; Playwright | S19 size-L deviation | Same; E2E ran green in S01 |
| Budgets, strategies, bonds, receipts and tours UI | S20 by grep only | Same |
| Bank-sync preview UI, rules editor | S10 to S19/S20 hand-off, not read | Same |
| The XL slices outside their recorded ranges | MNY import, securities, frontend reports, frontend lib (plan section 6) | Ranges in 20.2 |

### 20.2 Per session

#### S01 baseline (`01-baseline.md`)
- **Runtime executed:** Backend lint (check form `npx eslint "{src,apps,libs,test}/**/*.ts" --max-warnings=0`): FAIL, 3 `prettier/prettier` errors; `tsc --noEmit` and typecheck pass. Backend unit `TZ=UTC npm run test:unit -- --coverage`: 1 048 suites; 27 481 tests: 27 479 passed, 2 skipped, 0 failed (thresholds met). Backend build pass. Backend integration `npm run test:integration`: 118 suites (117 passed, 1 failed); 1 479 tests: 1 470 passed, 8 skipped, 1 failed (`ofx-import-fitid` deadlock in `cleanTables`; passes alone 10/10). Frontend lint, type-check, i18n:check pass; `npm run test:cov`: 1 139 files, 22 249 tests passed. E2E Chromium only: 191 tests discovered: 178 passed, 6 flaky, 7 skipped, 0 failed. `node scripts/check-env-docs.mjs`, `check-docs-manifests.mjs` (33 documents), `migration:lint` (233) pass; `check-migration-prefixes.mjs` pass (partial, no base ref). `scripts/verify-schema.sh` not run. Hosted CI not available. Mutations in a scratch worktree at `AUDIT_BASELINE_SHA`. Three delegated read-only sweeps (allowlist, cron matrix, non-enforced invariants).
- **Read in full:** `AGENTS.md`, `CLAUDE.md`, `backend/CLAUDE.md`, `e2e/CLAUDE.md`, `backend/src/mcp/CLAUDE.md`, `CONTRIBUTING.md`, `.claude/settings.json`, `.lintstagedrc.cjs`, `docs/audits/2026-10/{plan,ledger,prior-findings-register}.md`, S01 block of `sessions.md`.
- **Sampled / not read:** Sampled: `frontend/CLAUDE.md` and `database/CLAUDE.md` (command and gate lines), `backend/eslint.config.mjs:17-30,270-300,395-475`, `docs/verification-contract.md:483-560`, `docs/backend/testing.md:85-110`, `docs/system-invariants.md` (INV-RELEASE-001 and 20 non-enforced entries), `docs/cron-jobs.md:1-20`, `backend/src/common/db/prohibited-primitive-guidance.ts:1-40`, `ci.yml:23-155,1452-1600`. Upstream baseline `d5cea9bf` not reachable in the shallow clone. Firefox project, cluster shard, push suite not run.
- **Reviewed without a finding:** The DB-primitive bans and their documented list (MON-M02); allowlist vs call sites (81 entries, 214 call sites, no stale, none missing); cron doc vs code (49 handlers, one row per handler, expressions); CI image registries (Dockerfiles `FROM mirror.gcr.io`); guard specs' skip conditions.

#### S02 prior high triage (`02-prior-high-triage.md`)
- **Runtime executed:** Node 24.22.1; `npm ci` OK in `backend/` and `frontend/`; PostgreSQL 16 from container binaries (no Docker daemon). Backend unit: 28 suites, 2 065 tests passed, 2 skipped (16 suites, 734 passed, 2 skipped plus 12 suites, 1 331 passed). Backend integration: 13 suites, 204 tests passed, 0 failed (serial). Frontend unit: 15 files, 454 passed. `npm run build` OK. Zero-test check: Jest on a non-matching integration suite exits 1. Mutations: 11 run in a scratch worktree, 9 detected, 2 undetected. Scratch two-connection race spec (R1, R2): MON-H05 reproduced 10 of 10 on the split-transfer-leg path.
- **Read in full:** Not stated as full reads; read by range (this session): `transaction-transfer.service.ts:1660-1735, 2555-2760`; `report-currency.service.ts:95-125`; `mny-import.service.ts:135-215, 280-335`; `reconciled-lock.util.ts:1-60, 168-200`; `locks.ts:155-175, 245-390`; `transfers.integration.spec.ts:1-245`; `backend/test/jest-integration.json`; `PostTransactionDialog.tsx` (post call and date initialization).
- **Sampled / not read:** Seven read-only sub-agents reconstructed findings; their reads were "spot-checked at the lines used here". Not a PR: no base, merge base or hosted CI consulted. Dispositions are triage, final call with owners. 23 of 70 prior findings triaged.
- **Reviewed without a finding:** H02 export/stage/restore ordering; H03 start/create/wipe ordering; H07 absolute writers; H08 holding lock namespace; H09 consume; H13 replay sites; H14 form; H15 dialog; M42 logout; M44 discovery.

#### S03 security auth (`03-security-auth.md`)
- **Runtime executed:** Node 24.22.1; `backend/` `npm ci` OK; PostgreSQL 16 in Docker after starting `dockerd` by hand. Integration (9 named suites, one worker): 9 suites, 87 tests passed. Unit slice `TZ=UTC npx jest src/auth src/oauth src/users src/admin src/emergency-access src/delegation src/push src/common/interceptors`: 1951 tests passed. Probe file in scratch worktree: refresh reuse fails on baseline (A26-S03-01), login counter fails (A26-S03-02), claim race x5 passes, logout race passes, per-user revoke race (blanket fails, helper passes: A26-S03-07). Mutation runs (section 6): four undetected rows listed.
- **Read in full:** `emergency-access-claim.controller.ts`, `token.service.ts`, `login-lockout.ts` (code), `step-up.service.ts` (code), `step-up.guard.ts`, `single-use-token.service.ts`, `jwt.strategy.ts` (code), `user-profile.ts` (code), `push-chart.controller.ts`.
- **Sampled / not read:** Sampled: `auth.service.ts:55-160, 360-560, 930-975`; `auth.controller.ts:1260-1355`; `oidc-reauth.service.ts:100-160, 237-300, 362-458`; `two-factor.service.ts:225-275, 405-440, 477-512`; `emergency-access-monitor.service.ts:75-200, 360-470, 583-670`; `delegation.service.ts:763-787, 1465-1540`; `admin.service.ts:333-395, 552-610, 723-735`; `oauth-interaction.controller.ts:20-170, 370-400`. "Not covered this session (sampled or skipped, never reported clean)": OAuth provider internals, PAT bearer guard and MCP bearer path, remaining `auth.controller.ts` routes, `frontend/src/lib/api.ts` 401/refresh interceptor, `docs/specs/row-level-security.md` and `docs/rls-runbook.md`, `SECURITY.md`.
- **Reviewed without a finding:** Claim consume (MON-H09), logout (MON-M23), lockout increment (MON-M24), OIDC re-auth (MON-M05), activity attribution (MON-M07), profile allowlist (MON-M03), grant issuance (MON-M26), PAT scopes (MON-L01), TOTP replay, admin last-admin locking (`lockAdminsForUpdate`), push subscription ownership clause, OAuth consent CSRF, frontend credential persistence.

#### S04 RLS tenancy (`04-rls-tenancy.md`)
- **Runtime executed:** Node 24.22.1; `npm ci` OK; `dockerd` started by hand; PostgreSQL 16 as `monize-pg`. Integration `npm run test:integration -- 'rls-|runtime-role|joint-accounts|cross-owner-transfers|security-cross-user-isolation|schema-entity-parity'`: 9 suites, 180 tests passed. Probe `zz-audit-s04-probe.integration.spec.ts`: 4 cases, 1 passed, 3 failed on baseline as designed; `zz-audit-s04-transfer-probe.integration.spec.ts`: 1 case, failed as designed (A26-S04-01). Probes ran on the unprivileged `monize_app` role with `RLS_MODE=enforce`. Mutations MA to ME: MA 175/175 green and `rls-enforcement` 35/35 green; MB 35 failed; MC 4 failed; MD 175/175 green, unit 2 failed; ME unit 4 failed, `runtime-role` 27/27 green. Scripted allowlist check: 94 files mention a helper, 81 import it, 81 entries, 0 missing, 0 stale.
- **Read in full:** `scoped-db.ts`, `with-context.ts`, `rls-config.ts`, `rls-exempt-tables.ts`, `runtime-role-check.ts`, `app-role.ts`, `docs/row-level-security-contract.md`, `docs/backend/database-access-and-tenancy.md`. Protocol `.claude/commands/audit.md` read in full (1637 lines).
- **Sampled / not read:** Sampled: `delegation.service.ts:160-295, 385-460, 940-1010, 1035-1544`; `cross-owner-access.service.ts:66-110`; `transaction-transfer.service.ts:516-1000, 2142-2390` (VOID lines only); `joint-register.service.ts:20-154`; `main.ts:130-300`; `mcp-http.controller.ts:270-460`; `schema.sql:1970-2002, 3555-4200`; `rls-enforcement.integration.spec.ts:36-285`. "Not covered this session (sampled or skipped, never reported clean)": cross-owner transfer update and delete paths beyond VOID and authorization placement; `joint-categories.service.ts` beyond its shape; `account-delegate.guard.ts` body-account checks; `docs/specs/row-level-security.md` and `docs/rls-runbook.md`; the 23 enforced-harness suites were not run. INV-SHARE-001..005 not audited.
- **Reviewed without a finding:** `withScopedDb` identity join refusal and isolation refusal, GUC emission per mode, fail-closed helpers (`NULLIF(...)::uuid`, `COALESCE`), runtime role check and provisioning (MON-M14), `schema_migrations` write revoke, `WITH_CONTEXT_ALLOWLIST` completeness, the `oauth_payloads` and `PgListener` exceptions, MCP bearer context seeding, MON-M06 flows under enforcement.

#### S05 migrations schema (`05-migrations-schema.md`)
- **Runtime executed:** Node 24.22.1; backend `npm ci` OK; PostgreSQL 16 in Docker. `scripts/verify-schema.sh`: OK (both passes). `npm run migration:lint:test`: 0 failed. `npm run migration:lint`: OK, 233 files, one registered one-shot (`166_heal_loan_schedule_end_dates.sql`). `node scripts/check-migration-prefixes.mjs` OK (233 migrations, 0 added vs `origin/main`) after `git fetch --unshallow origin`. Three scratch integration specs (three-place catalog diff; two-replica startup race, baseline passed and lock-removed mutation failed as expected; `ON CONFLICT` arbiter probe). Mutations: `src/db-init.spec.ts` + `src/db-migrate.spec.ts` under M1: 6 failed / 39 passed; `src/common/db/app-role.spec.ts` under M2: 4 failed / 15 passed; `runtime-role.integration.spec.ts` under M2: 1 failed / 26 passed; M3, M4, M5 undetected (section 6). Repository integration suites (12 named patterns, one worker): 12 suites passed, 161 tests passed, 0 failed.
- **Read in full:** The 56 timestamped migrations (`20260906235944` .. `20261018052801`); `backend/src/db-init.ts`; `backend/src/db-migrate.ts`; `backend/src/common/db/advisory-locks.ts`; `backend/src/common/db/required-db-functions.ts`; `backend/docker-entrypoint.sh`; `scripts/verify-schema.sh`; `database/CLAUDE.md`; `schema-entity-parity.integration.spec.ts`; `backend/test/helpers/test-database.ts`.
- **Sampled / not read:** Sampled with ranges: `app-role.ts:60-268`; `integration-setup.ts:36-75,200-250`; `rls-setup.ts:335-476`; `docs/database-migrations.md:30-110`; `ai-review-requests.service.ts:180-330`; `budget-period.service.ts:225-250`; `mortgage-type.util.ts:160-200`; `plan-loan-settlement.ts:258-264,420-442`; `transaction-rules-applier.service.ts:790-830`; `bank-sync.integration.spec.ts:2265-2310`; `docs/audits/2026-08-upstream/03-database-backup.md:479-635`. Numbered migrations sampled against upstream inventory (7 modified diffed in full, 3 deleted traced). "Not read" items: not stated in section 12.
- **Reviewed without a finding:** Replay idempotency of all 56 (guards on every statement; executed); RLS enable + policy shipped in the same file for each of the 19 user-owned tables created; RLS-exempt tables (`push_chart_artifacts`, `auth_attempt_counters`, `single_use_tokens`, `oauth_instance_config`, `fetch_sync`, `update_check_state`, `http_throttle_counters`, `auto_backup_policy`, bond reference tables) carry no owner column; no migration names a role; arbiters for every `ON CONFLICT` except `budget_periods` in the harness; `required-db-functions` registration; the startup lock and the ledger revoke (executed).

#### S06 backup restore (`06-backup-restore.md`)
- **Runtime executed:** Node 24.22.1; `dockerd` by hand; moto 5.2.4 as S3 endpoint (no MinIO image). Unit `TZ=UTC npx jest src/backup src/attachments src/currencies src/common/shard-path`: 90 suites, 1942 passed, 2 skipped, 0 failed. Integration: `backup-restore` 25 passed; `support-backup` 5; `attachment-late-write` 12; `attachment-scan-pair` 8; `backup-offsite-claim` 7; `backup-store-s3` without endpoint 1 passed, 8 skipped; with moto endpoint 7 passed, 2 failed (A26-S06-02). Scratch round trip R1..R6: 6 passed with `S06_PROVIDER=local`, 6 passed with `S06_PROVIDER=s3`. Mutations M1..M4 in scratch worktree; three undetected.
- **Read in full:** `backup/backup.service.ts`, `backup-id-remap.util.ts`, `backup-restore.service.ts`, `backup-attachment-transfer.service.ts`, `restore-plan.ts`, `backup-file-names.ts`, `atomic-file.ts`; `attachments/storage/` `local-storage.provider.ts`, `s3-storage.provider.ts`, `database-storage.provider.ts`, `storage-key.util.ts`, `attachment-storage.interface.ts`.
- **Sampled / not read:** Sampled: `auto-backup.service.ts` 880-1145, 1293-1460, 1601-1660, 2083-2332 (of 2452; cron fan-out 1654-1906 and reconcile 1906-2080 not read); `backup-restore-database.service.ts` 39-420; `backup-export.service.ts` 194-300, 400-568; `local-backup-storage.target.ts` 1-560; `s3-backup-storage.target.ts` grep only. "Not read": `backup/offsite/*` beyond the invariant text and the integration suite result; `backup-envelope.ts`, `backup-key-wrap.ts`, `backup-encryption.service.ts`; `restore-upload-admission.ts`, `restore-processing-gate.ts`, `restore-peak-rss.harness.ts`; `frontend/src/lib/backupApi.ts`, `frontend/src/components/settings/`; `docs/specs/backup-off-machine.md`, `backup-storage-targets.md`, `backup-envelope-key-wrapping.md`, `docs/adr/0003-*`.
- **Reviewed without a finding:** Export snapshot, decompression bound, re-auth ordering, AI key transport, reference resolution and remap, carried-bytes validation and blob rebuild, legacy ownership proof, path containment on both stores and both providers, support-backup currency pseudonymisation, admin gating of the policy and browse routes, attachment cap lock.

#### S07 cash ledger (`07-cash-ledger.md`)
- **Runtime executed:** Node 24.22.1; PostgreSQL 16 in Docker; `dockerd` by hand. Baseline integration (8 named patterns): 9 suites, 104 tests passed (serial). Three scratch probe specs, 13 cases: 10 reproduce a defect, 3 show a mechanism holding (probe 1 P1-P8: 6 failed by design, 2 passed; probe 2 Q1, Q2 reproduce, Q3 holds; probe 3 R1, R2 reproduce). Four mutations M1-M4: 1 undetected, 2 unit-only, 1 covered.
- **Read in full:** Ranges: `transaction-transfer.service.ts` `:228-340`, `:645-760`, `:1474-2760`; `transactions.service.ts:2534-3160`, `:3660-3712`; `accounts.service.ts:858-1557`, `:1868-2260`; `common/deletion-balance.util.ts`; `transactions/register-order.ts`; `remove-transaction-leg.ts`; `reconciled-lock.util.ts:1-60, 150-211`; `reconciled-lock.guard.spec.ts:1-140`; `transaction-bulk-update.service.ts:160-499, 1184-1368`.
- **Sampled / not read:** Sampled: `transaction-split.service.ts:1075-1235`, `:170-210`; `common/db/locks.ts:215-295`; `action-history.service.ts:170-195, 486-546, 1730-1770`; `mcp/tools/transactions.tool.ts` three ranges; `ai-actions.service.ts:570-600`; `transaction-tool-prep.service.ts:505-610`; `reports.service.ts:560-590, 715-735`; `transactions.controller.ts:1520-1595`. "Not read in full despite the size-L instruction": `transactions.service.ts` outside the ranges above, `transaction-split.service.ts` outside the ranges above, `investment-filter.util.ts` (sampled by the guard's existence only), `transaction-search*.ts` (sampled by grep). Recorded as sampled, never as clean.
- **Reviewed without a finding:** `deletionBalanceEffect` and its single caller pattern (`removeLockedTransactionLeg`); `applyRegisterOrder` total order and the page window; same-owner `updateTransfer` and `removeTransfer`; `update()` and `remove()` lock placement; MCP/AI transfer routing; the `is_closed` predicate; currency derivation on create/update/transfer.

#### S08 scheduler cron (`08-scheduler-cron.md`)
- **Runtime executed:** Node 24.22.1; PostgreSQL 16 in Docker; `dockerd` by hand. Baseline integration (`scheduled|job-claim|loan-settlement-claim|dated-loan-payment|loan-settlement-debt|backup-offsite-claim`): 8 suites, 45 passed. `scheduled-transactions.service.spec.ts` 320 passed at baseline (319 + 1 failed under each of M1-M3); `job-claim.service.spec.ts` 16 passed at baseline (15 + 1 failed under each of M5-M7). Probes in scratch worktree: `zz-s08-probe` P1-P7 (8 cases, real `ScheduledTransactionsService`), `zz-s08-probe2` R1, R2 (real `BillReminderService` x3, `AiInsightsService` x2). Mutations M1-M3, M5-M7; three undetected at integration level (caught only by SQL-text unit asserts).
- **Read in full:** `common/jobs/job-claim.service.ts`; `notifications/bill-reminder.service.ts`; `scheduled-transactions/schedule-cursor.ts` (to `PrunedScheduleOverride`); `docs/cron-jobs.md`; `docs/backend/cron-and-background-work.md`. The 49-handler cron matrix was built by a read-only sweep agent and spot-checked.
- **Sampled / not read:** `scheduled-transactions.service.ts` 486-864, 2640-3900 (of 4305); "`create`/`update` 866-2640 and the override and loan delegations after 4079 not read". Also sampled: controller 329-368; `claim-loan-occurrence.ts` 1-180; `occurrence-slots.ts`; `ai-insights.service.ts` 140-360, 602-650, 741-790; `budget-period-cron.service.ts` 30-260; `auto-backup.service.ts` 1293-1430; `notification-dispatch.service.ts` 175-262; `transactions.service.ts` five ranges; `PostTransactionDialog.tsx` 405-480; `system-invariants.md` 4002-4130, 5745-5770.
- **Reviewed without a finding:** Cron selection (postponed and override-moved occurrences, `:574-608`); the pre-lock and under-lock checks (`sameScheduleMutationBasis`, override and split bases); loan pricing re-resolution on both posting paths (presence and lock order); the reminder lease and delivery record; the dispatch seam; budget rollover claim and release; the 30-day claim sweep; the S06 manual fan-out.

#### S09 import mny (`09-import-mny.md`)
- **Runtime executed:** Node 24.22.1; PostgreSQL 16 in Docker; `dockerd` by hand. Baseline integration `npm run test:integration -- "mny\|import"`: 8 suites, 137 tests, all passed. Scratch worktree: post-commit failpoint spec over 3 fixtures (3 fail = defect reproduced) and re-upload variant (1 fail); currency-override probe (1 pass); mapper probe `map-transactions.spec.ts` (1 pass); seven mutations at integration and unit level (unit `src/import` 1848/1848 under M2; three undetected); two-connection SQL race (A26-S09-04). All serial.
- **Read in full:** `mny-import-job.service.ts`, `mny-import.service.ts`, `mny-staging.service.ts`, `mny-import.controller.ts`, both entities.
- **Sampled / not read:** Primary path "XL, sampled by the job state machine". Sampled: `map/map-transactions.ts:360-470, 630-725`; `map/map-transfers.ts` (all 84 lines); `map/map-investments.ts:195-320`; `writers/write-reference.ts:159-246`; `writers/write-investments.ts:180-292`; `map/map-reference.ts:150-215`; `currencies.service.ts:176-275`; `mny-parser.service.ts:194-250`; `import-post-processing.service.ts:44-200`; `mny-import.integration.spec.ts:1347-1630`; `mny-import-job.integration.spec.ts:517-765`. "Not read" items: not stated in section 12.
- **Reviewed without a finding:** One-active-job index and its 409 mapping; claim CAS; token-scoped progress, heartbeat, complete and fail; reaper grouping (`reapStatement` parenthesis); wipe-after-slot ordering; maintenance-lease interlock in `create`; `userId` from the JWT on all routes.

#### S10 rules banksync csv (`10-rules-banksync-csv.md`)
- **Runtime executed:** Node 24.22.1; PostgreSQL 16 in Docker; `dockerd` by hand. Baseline integration (`transaction-rules|bank-sync|transaction-external-id|payee-lookup|ofx-import-fitid|import-balance-delta`): 17 suites, 244 tests, all passed in 223 s. Slice unit `TZ=UTC npm run test:unit -- src/transaction-rules src/bank-sync src/import-preview "src/import/[^/]*\.spec"`: 102 suites, 3205 tests, all passed. Scratch worktree: planner probe and integration probe for A26-S10-01, integration probe for A26-S10-02 (both fail at baseline as described), four mutations (all four listed as undetected rows). Serial runs.
- **Read in full:** `bank-sync/bank-sync-writer.service.ts`; `import/import-regular-processor.service.ts` (1-330, 420-798; 330-420 sampled); `transaction-rules/rule-application-sites.guard.spec.ts` (1-217).
- **Sampled / not read:** Sampled: `bank-transaction-planner.ts:216-556`; `bank-sync.service.ts:440-660`; `bank-sync-preview.service.ts:300-495`; `transaction-rules-applier.service.ts` five ranges; `rule-effects.ts:650-780`; `transaction-rules.service.ts:112-222`; `import.service.ts` three ranges; `docs/specs/bank-sync.md:220-360`; `schema.sql` three ranges. "Not read": the rule validator (`rule-validation.ts`, 810 lines), `rule-tool-prep.service.ts` (1128 lines), `bank-sync-connections.service.ts`, `bank-sync-profiles.ts`, the Enable Banking adapter, `csv-parser.ts` and `qif-parser.ts`, the frontend `components/rules/` and `components/import-preview/`, `import-investment-processor.service.ts`, `import-transfer-dedupe.ts`.
- **Reviewed without a finding:** INV-BANKSYNC-002, -003, -004; INV-RULE-001 (matched row), -004, -005; INV-PAYEE-001, -002; concurrent sync arbitration; rules inside the inserting transaction on every creation path found.

#### S11 email receipts (`11-email-receipts.md`)
- **Runtime executed:** Node 24.22.1; PostgreSQL 16 in Docker `monize-pg`. Unit `npm run test:unit -- src/email-receipts src/ai-review`: 102 suites, 2 985 tests passed. Integration (`email-receipt|ai-review-requests|ai-review-mcp|holding-concurrent-trades|rls-context-smoke`): 8 suites, 223 tests passed (`rls-context-smoke` matched nothing). Probes P1 (3 cases, A26-S11-02), P2 (`providerCalls=2 drafts=2`, A26-S11-01), P3 (P3a trade booked, cash 10 000 -> 8 000; P3b control, nothing; A26-S11-04) in scratch worktree. Mutations M1, M3, M4, M6, M7, M8 (all covered, four by unit tests only). CI/hosted status not checked.
- **Read in full:** `poll/email-receipt-poll.service.ts`, `poll/receipt-rows.ts`, `poll/email-receipt-poll-limits.ts`, `pipeline/email-receipt-pipeline.service.ts`, `pipeline/email-receipt-trade.service.ts`, `pipeline/receipt-requests.util.ts`, `pipeline/auto-apply-gate.ts`, `pipeline/trade-reading.ts`, `ai/email-receipt-ai.service.ts`, `mailbox/email-receipt-mailbox.service.ts`, `oauth/email-receipt-oauth.service.ts`, `oauth/oauth-state.ts`, `import/email-receipt-import.service.ts`, `imap/forwarded-receipt.ts`, `receipts/receipt-disposal.ts`, `EmailHtmlFrame.tsx`, `EmailBodyView.tsx` (and others, some from a stated line).
- **Sampled / not read:** Sampled: `imap/imap-mailbox-client.ts:140-394`; `receipts/email-receipts.service.ts:580-1000`; `parsing/parse-trade.ts:20-100, 400-594`; `ai-review-requests.service.ts:180-380, 845-975`; `ai-review-work.service.ts:575-825`; `ai-actions.service.ts:1090-1192`; `exchange-rate.service.ts:379-420, 1150-1215`; several files by grep. "Not read": `parsing/receipt-parser.validation.ts` (1 433 lines), `imap/forwarded-message.ts` beyond its contract, `imap/html-lines.util.ts`, `imap/mail-text.util.ts`, `import/msg-message.ts`, `import/mbox.ts`, `parsing/parse-receipt.ts`, `parsing/schema-org-order.ts`, `proposal/build-receipt-proposal.ts` beyond its kinds, `linking/*` beyond the pipeline's calls, `parsers/receipt-dry-run.ts`, `parsers/email-receipt-parser-preview.service.ts`, the frontend wizard and inbox components.
- **Reviewed without a finding:** INV-RECEIPT-001 read-only IMAP; INV-RECEIPT-002 ingest transaction and cursor; INV-RECEIPT-004 host policy at save and connect; INV-RECEIPT-005 secrets; INV-RECEIPT-007 OAuth state; the email HTML frame; parser patterns without `RegExp`; archive decompression bounds; the AI's answers (validated, owned categories, never confirmed by the AI path); the write-limit exemption; the trade confirm's `beforeWrite` / `afterWrite` under the holdings lock; the mailbox settings round trip; the parser form's refusal to edit what it cannot represent; the document scanner (client-only).

#### S12 securities holdings (`12-securities-holdings.md`)
- **Runtime executed:** Node 24.22.1; PostgreSQL 16; `dockerd` by hand. Baseline `npm run test:integration -- "holding\|investment\|securit\|price\|trade"`: 13 suites, 176 tests, all passed. Scratch spec `zz-s12-race.integration.spec.ts`: three forced interleavings R1-R3 (R1, R2 defects demonstrated; R3 mechanism holds) and five numeric probes P1-P5 (defects demonstrated); 16 mutation rows (several undetected). Serial runs.
- **Read in full:** `investment-replay.util.ts`, `investment-amount.util.ts`, `daily-change.util.ts`, `holdings.service.ts`. `investment-transactions.service.ts` read 469-2970, 3818-5095. `security-price.service.ts` read 330-2662.
- **Sampled / not read:** "the remaining 2970-3817 -- embedded status propagation, register reads, history, capital-gains and LLM shapes -- sampled at 3093-3200 only"; `security-price.service.ts` 1-330 sampled. Other samples: `portfolio-calculation.service.ts`, `portfolio.service.ts` 1290-1489, `yahoo-finance.service.ts` 150-330, `msn-finance.service.ts` 376-412, `exchange-rate.service.ts` 916-1174, `mcp/tools/investments.tool.ts`, `locks.ts`, `action-history.service.ts` 1850-1965. Not reviewed: `portfolio.service.ts` valuation and FX aggregation (S13), `lse-finance.service.ts`, `market-index.service.ts`, `performance-comparison.service.ts`, `sector-weighting.service.ts`, `security-detail.service.ts`, `bond-*` (S14), the intraday series, `provider-health/` beyond its use in Yahoo, the frontend (S19/S20).
- **Reviewed without a finding:** The SPLIT reducer and its guards; commission in basis on every backend replay; non-positive rate refusal; `updateStatus` (row lock and advisory lock, VOID crossings mirror the cash leg); the provider currency checks on every provider write path read; the MSN negative cache; the Yahoo breaker door; the daily-change resolver and the movers board; manual price route ownership.

#### S13 valuation fx networth (`13-valuation-fx-networth.md`)
- **Runtime executed:** Node 24.22.1; PostgreSQL 16 in Docker. Baseline integration (`rls-enforcement`, `fx-rate-coverage`, `portfolio-movement-flow`, `portfolio-tag-keys`, `report-investment-cash`, `invested-capital-flow`, `scheduled-investment-split-fx`, `fx-fee-summary`, `bond-holding-value`): 9 suites, 110 tests, all pass. Baseline unit batch (16 patterns, `TZ=UTC npm run test:unit -- <pattern>`): 20 suites, 984 tests, pass. Scratch probes P1-P5 (6 cases): every case reproduces a defect. Ten mutations: nine detected (four only by mock-based unit tests), one undetected. Frontend `npm ci` not run. No `net-worth*`, `currenc*` or `exchange*` integration suite exists.
- **Read in full:** `fx-rate-resolver.ts`, `fx-aggregate.ts`, `fx-entry.util.ts`, `currency-conversion.util.ts`, `currencies.service.ts`, `currencies.controller.ts` (60-422), `position-price.util.ts`, `useExchangeRates.ts`, `report-currency.service.ts` (1-121). Four read-only sub-agent sweeps, re-checked at cited lines.
- **Sampled / not read:** Sampled: `exchange-rate.service.ts` 900-1339; `net-worth.service.ts` 780-1080, 2925-2960, 3071-3146; `portfolio.service.ts` 662-692, 1491-1566, 2145-2149; `monte-carlo.service.ts` 290-740, 860-937; `transaction-bulk-update.service.ts` 501-690; `accounts.service.ts` 1575-1825; `users.service.ts` 225-425; `forecast.ts` 215-285, 356-525; `schema.sql` four ranges. "Not reviewed": `exchange-rate-history.service.ts` and `rate-gap-plan.ts`, provider adapters beyond `carries`, `portfolio-period-result.service.ts` and the batch service beyond the util, `invested-capital-flow.util.ts`, the intraday series, `sector-weighting.service.ts` arithmetic, `number-locale.util.ts`, the frontend report components (S20).
- **Reviewed without a finding:** The resolver's look-ahead, age bound and direction rule; `FxAggregate`; `getRateForDate` / `getLiveRate` / `resolveStoredRate`; the portfolio summary's `convertToDefault` and `primeLiveRates`; the monthly net-worth fold's flags; Monte Carlo refusals; the currency delete gate and its race; `normalizeFxEntry` / `assertTransactionCurrencyMatchesAccount`; the period-result arithmetic; the forecast's unknown occurrence handling; portfolio movement notifications (read `valuationComplete === true`).

#### S14 bonds (`14-bonds.md`)
- **Runtime executed:** Node 24.22.1; PostgreSQL 16; `dockerd` by hand. `TZ=UTC npm run test:unit -- src/bonds src/securities/portfolio-calculation src/securities/accrued-interest`: 53 suites, 1 401 tests, all pass. `TZ=UTC npm run test:integration -- "bond\|no-automatic-bonds\|redemption\|accrued"`: 12 suites, 174 tests, all pass. Mutations: 12 unit-level in a scratch worktree, all killed; three lock and SQL-text rows re-run at integration level, all killed (15 executed, 15 killed). One redemption example worked by hand against `docs/specs/bond-redemption-interest.md` section 3.1.
- **Read in full:** `engine/redemption-split.ts`, `engine/redemption.ts`, `engine/accrual.ts`, `engine/bond-engine.ts`, `bond-holdings.service.ts`, `bond-lots.ts`, `bond-valuation.service.ts`, `bond-price.service.ts`, `benchmark-refresh.service.ts`.
- **Sampled / not read:** Sampled: `bond-series.service.ts` 130-200, 205-364, 425-514, 660-975; `bond-notification.service.ts` 60-270; `bond-notification-events.ts` 330-375; `adapters/pl/pl-nbp-reference.ts` 120-178; `adapters/pl/series/series-source.ts` 50-135; `backfill-codes.ts` (whole); `bond-write-guard.ts` 1-60; `monte-carlo.service.ts` 495-545, 686-735; `net-worth.service.ts` four ranges. "Not read (sampled by invariant only through their suites)": `engine/rate-resolution.ts`, `domain/bond-terms.ts`, `bond-catalog.service.ts`, `bond-offer.service.ts`, `bond-series-resolver.ts`, `bonds.controller.ts`, the rest of `adapters/pl/`, `frontend/src/components/bonds/`.
- **Reviewed without a finding:** The redemption split identity and its booking; per-bond rounding; window refusals; lots per account and series; the price writer's precedence and deletes; recompute locking; series store idempotency; provider failure in the series fetch; notification dispatch outside transactions and the maturity-coupon exclusion; NBP and GUS coverage.

#### S15 loans strategies (`15-loans-strategies.md`)
- **Runtime executed:** Node 24.22.1; `npm ci` OK in `backend/` and `frontend/`; PostgreSQL 16. Baseline integration (11 patterns, one invocation): 11 suites, 71 tests, all passed. Unit `TZ=UTC npm run test:unit -- src/strategies`: 14 suites, 375 passed. Frontend `npx vitest run src/lib/loan-history src/lib/loan-schedule src/components/reports/LoanAmortizationReport`: 6 files, 351 passed. Scratch probes: `zz-s15-probe` (R1-R11 through the real `post()`, 6 cases), `zz-s15-undo`, `zz-s15-undo2`, `zz-gem.spec.ts`, cross-currency `zz-s15-fx`; mutations M1-M7 (four undetected rows). Two read-only sweep agents (GEM; frontend loan history), claims re-verified.
- **Read in full:** `scheduled-transaction-loan.service.ts`, `price-installment.ts`, `reprice-template.ts`, `claim-loan-occurrence.ts`, `occurrence-slots.ts`, `loan-payment-waterfall.util.ts`, `dated-loan-debt.util.ts`; `post()` `scheduled-transactions.service.ts:2862-3768` in full (listed under both read and sampled).
- **Sampled / not read:** Sampled: `plan-loan-settlement.ts:120-420`; `action-history.service.ts:160-212, 560-610, 1727-1770`; `accounts.service.ts:1020-1050, 1120-1230`; `loan-rate-changes.service.ts:319-370`; `gem-momentum.util.ts:180-240`; `price-boundary.util.ts:30-100`; `gem-signal-change-alert.service.ts:150-220`; `notification.service.ts:320-370`; `loan-history.ts:1240-1316, 1530-1560`; `LoanAmortizationReport.tsx:290-297`; `loan-schedule.ts:405-410`. `loan-rate-changes/` and `loan-scenarios/` sampled. "Not read" list: not stated in section 12.
- **Reviewed without a finding:** The posting boundary's lock order and re-resolution on both branches; the claim INSERT and its backstop; the rate timeline (dated, 0 % distinct from unknown on the settlement path); the waterfall's clamp order; the minor-unit booking never retiring more than the debt; LOC exemption from deactivation; loan controllers' auth; the settlement amount policy (read against spec section 8).

#### S16 budgets reports (`16-budgets-reports.md`)
- **Runtime executed:** Node 24.22.1; PostgreSQL 16 in Docker. `npm run test:integration -- "budget\|report\|categor\|payee\|calendar\|tag-usage"`: 10 suites, 112 tests, all passed. Scratch probe `s16-probe.integration.spec.ts` P1-P4 (P2/P3 needed the production `UNIQUE(budget_id, period_start)` added by hand). Seven mutation runs (M1, M3, M5, M7 via `jest spending-reports built-in-reports`, `jest budget`, `budget-split`, `budget-spending`); five undetected rows named. Frontend suites not run.
- **Read in full:** `budgets/budget-spending.util.ts`, `common/investment-filter.util.ts`.
- **Sampled / not read:** Sampled: `budget-period.service.ts:90-470`; `budget-period-cron.service.ts:70-230`; `budget-alert.service.ts:137-715`; `budgets.service.ts:400-412, 1031-1168`; `notification.service.ts:100-185`; `reports.service.ts:565-600, 715-740, 840-912`; `spending-reports.service.ts:55-135, 236-255`; `income-reports.service.ts:279-300`; `CashFlowReport.tsx:92-290`; `IncomeVsExpensesReport.tsx:191-290, 473-479`; `SpendingByCategoryReport.tsx:176-262`; `useReportData.ts:115-240`. "Not read in full despite the session brief": `budget-alert.service.ts:716-1262`, `budget-generator.service.ts`, the budget trend/health/activity report services beyond their transfer calls, `cash-flow-sankey*.ts`, `tax-recurring-reports.service.ts`, the backend CSV paths. Categories, payees, tags and calendar "covered only by their integration suites"; INV-PAYEE-001/002 and INV-DAYNOTE-001 mechanisms "not re-read". Three sweep subagents stopped on a usage limit.
- **Reviewed without a finding:** not stated in section 12 (no such list; section 12 lists undetected mutation rows only: VOID in budget actuals; rollover relation; fingerprint index removal; next-period dates; budget currency conversion).

#### S17 ai mcp notifications (`17-ai-mcp-notifications.md`)
- **Runtime executed:** Node 24.22.1; PostgreSQL 16 in Docker; `dockerd` by hand. Unit `TZ=UTC npm run test:unit -- src/mcp src/ai src/ai-review src/notifications src/notification-center src/push src/system-alerts src/provider-health`: 157 suites, 4200 tests, all pass. Integration (`ai-action-replay|ai-relay|ai-review|push-|system-alert|provider-health|daily-write-limit|notifications|transactions.integration`, one worker): 14 suites, 145 tests, pass. No `mcp*` integration suite exists. Probes P1 (MCP caller key, forged `Mcp-Session-Id`), P2 (AI confirm after post-commit attachment failure), P3 (LLM analytics over two currencies, real PostgreSQL). Mutations M1-M4; three undetected rows.
- **Read in full:** `mcp/mcp-http.controller.ts`, `mcp/mcp-context.ts`, `mcp/CLAUDE.md`, `docs/backend/mcp.md`, `notifications/notification-dispatch.service.ts` (`:60-483`), `push/push-chart-artifact.service.ts`, `push/push-chart.controller.ts`, `ai/actions/ai-write-limiter.ts`, `mcp/mcp-write-limiter.ts`.
- **Sampled / not read:** Sampled: `ai-actions.service.ts:143-392, 467-1260`; `tool-executor.service.ts:240-345, 2858-3066`; `ai-insights.service.ts:40-339`; `ai-relay.service.ts:214-543`; `push-subscription.service.ts:204-503`; `transactions.tool.ts:1020-1180`; `transaction-analytics.service.ts` three ranges; `ai-review-work.service.ts:215-245, 335-362`; `attachments.service.ts:140-330`; `system-alert.service.ts:143-300`; `oauth-provider.service.ts:357-417`; `pat.service.ts:116-165`, and others. "Not read (named so nobody reads this as clean)": `ai/query/tool-executor.service.ts` outside the ranges above (about 2,400 lines, parity grep only), `ai/relay/ai-relay.service.ts:543-1106`, `mcp/mcp-confirm.ts` and `mcp-request-state.ts`, `provider-health/` (code not read), `notification-center/` beyond the two alert services, the frontend `components/notifications/` and `lib/push.ts`, `docs/specs/notification-preferences.md` (1,336 lines).
- **Reviewed without a finding:** MCP identity per request, credential binding and the 403/401 paths; the relay caller-scoped liveness and card routing; the dispatch seam's lock, dedupe and fan-out order; system-alert insert winner and email claim; push subscribe refusals, endpoint ownership, hold and purge; the chart route's credential (256-bit nonce plus HMAC, one-use `DELETE ... RETURNING`); the AI review claim keys; the MCP bearer verifiers against `JWT_SECRET` tokens.

#### S18 frontend core (`18-frontend-core.md`)
- **Runtime executed:** Node 24.22.1; `npm ci` in `frontend/` OK. `npx vitest run src/lib src/hooks src/store src/types`: 349 files, 5 825 tests, all passed. `AppHeader.test.tsx`, `IncompleteLogoutNotice.test.tsx`, `MnyImportProgress.test.tsx`: 65/65 passed. `npm run lint`, `npm run type-check`, `npm run i18n:check`: all exit 0. Probes: 9 scratch-worktree vitest cases (P1-P8), all reproduce. Mutations: 3 executed, all killed. No backend suite run.
- **Read in full:** `lib/apiCache.ts`, `lib/api.ts`, `lib/investments.ts`, `store/authStore.ts:1-200`, `hooks/useExchangeRates.ts`, `lib/logout-state.ts:1-60`, `docs/frontend/api-and-cache.md`. Three read-only subagent sweeps built the contract matrix; rows used in findings re-read at both ends.
- **Sampled / not read:** Sampled: `lib/transactions.ts:1-240` and method list to `:572`; `lib/forecast.ts` ranges ("not read line by line: `:760-980`"); `lib/format.ts:1-180, 470-491`; `lib/budgets.ts`, `accounts.ts`, `categories.ts`, `payees.ts`, `import-mny.ts:277-338`, `share-inbox.ts:85-300`, `exchange-rates.ts`, `utils.ts:80-105`, `pdf-export.ts:245-262`; several backend files. "Not read (recorded as sampled, never as clean)": `lib/push.ts`, `lib/loan-history.ts`, `lib/receipt-parser-form.ts`, `lib/document-scanner/`, `lib/email-receipts-*`, `lib/rule-*`, `lib/loan-*`, `lib/backupApi.ts` beyond the restore line, `lib/number-parse.ts`, `lib/date-parse.ts`, `hooks/useNumberFormat.ts` beyond its exports, `docs/frontend/financial-figures.md` and `forms-and-formatting.md` beyond grep.
- **Reviewed without a finding:** Logout and its retry (MON-M36/M42); the `dedupe` generation mechanism; `useExchangeRates` 1:1 half; the share target's ownership and logout sweep (INV-SHARE-001..005); `investmentsApi.refreshSelectedPrices` write-nothing rule; scheduled-post, split, transfer, bulk, import, bank-sync and investment-trade invalidation; `backupApi.restoreBackup` `clearAllCache()`; `forecast.ts` settlement-account remap and unknown-rate withholding.

#### S19 frontend forms (`19-frontend-forms.md`)
- **Runtime executed:** Node 24.22.1; `npm ci` OK in `frontend/` and `backend/`. Baseline component suites over the slice: 157 files, 4025 tests, all passed (`OverrideEditorDialog.test.tsx` 71 passed; `InvestmentTransactionForm.bondRedemption.test.tsx` 11 passed). Scratch worktree: five component probes P1-P5 plus one `CurrencyInput` four-decimal probe; backend integration probes `a26-s19-incoming-transfer` and `a26-s19-fourdp` (3 cases, PostgreSQL 16, `--runInBand`); 11 mutations (three undetected rows). Playwright not run.
- **Read in full:** `frontend/src/components/ui/CurrencyInput.tsx` (500 lines); `TransferTransactionFields.tsx:60-307`.
- **Sampled / not read:** Sampled: `TransactionForm.tsx:90-460, 495-530, 1180-1480, 1510-1580` (of 1873); `SplitEditor.tsx:258-332, 940-1140`; `OverrideEditorDialog.tsx:95-575, 630-710` (of 899); `PostTransactionDialog.tsx:400-520, 596-618, 690-775` (of 1259); `ScheduledTransactionForm.tsx:640-662` plus greps (of 2074); `InvestmentTransactionForm.tsx` seven ranges (of 1867); `AccountForm.tsx`, `AccountFormModal.tsx:60-224`, `DangerZoneSection.tsx:20-194`, and others; backend `transaction-transfer.service.ts:420-494, 1702-1841`. "Not read (size-L deviation)": the rest of `TransactionForm.tsx`, `SplitEditor.tsx`, `ScheduledTransactionForm.tsx`, `PostTransactionDialog.tsx` and `InvestmentTransactionForm.tsx`; `BulkUpdateModal.tsx` (schema only); `MortgageFields.tsx`, `LoanFields.tsx`, `SecurityForm.tsx`, the CSV import mapping steps, `AutoBackupSection.tsx`, `SecuritySection.tsx`, `ApiAccessSection.tsx`, `DelegateAccessModal.tsx`; the rules editor beyond its value controls.
- **Reviewed without a finding:** The override editor's stored price (MON-H15), the reauthentication artifact on delete-account and delete-data, the restore result counters, the transfer mode lock, the date input, the rules editor value controls, the onboarding serializer (beyond A26-S13-05), the split editor's sign handling.

#### S20 frontend figures (`20-frontend-figures.md`)
- **Runtime executed:** Node 24.22.1; `npm ci` OK. `npm run i18n:check`: pass. Guard and i18n suites (`src/test/ui-conventions.test.ts`, `src/i18n`, scheduled-effective-amount, chart-reduction, loan-history, balance-cache guards): 16 files, 2049 tests, all pass. Component suites as mutation baselines pass unmutated: `PortfolioValueReport` (83), `accounts/page` (59), `CashFlowSankeyReport` (46), `PortfolioValueWidget` (15), `GeographicAllocationReport` (32), `GroupedHoldingsList` (27), `NetWorthReport` (32). Eight probes P1-P8 in a scratch worktree, all eight fail at baseline as the findings predict. Eight mutations. `npm run build`: pass.
- **Read in full:** `NetWorthReport.tsx`, `CashFlowSankeyReport.tsx:95-345`, `PortfolioValueWidget.tsx:100-330`, `PortfolioValueReport.tsx:540-800`, `InvestmentPerformanceReport.tsx:160-320`, `widget-shared.ts:1-140`, `invested-value.ts`, `portfolio-chart-utils.tsx:30-160`, `useReportData.ts:100-220`.
- **Sampled / not read:** Primary path "XL, sampled by figure". Sampled: `GeographicAllocationReport.tsx:255-470, 575-600, 725-812`; `DividendYieldGrowthReport.tsx:240-280, 515-580`; `DebtPayoffTimelineReport.tsx:130-255, 630-665`; `LoanAmortizationReport.tsx:70-160, 425-511`; `BudgetVsActualReport.tsx:185-335`; `SecurityTypeAllocationReport.tsx`; `InvestmentValueChart.tsx:200-330, 500-550, 650-670`; `AssetsVsLiabilities.tsx:40-131`; `accounts/page.tsx:95-150`; `GroupedHoldingsList.tsx`; `loan-past-impact.ts:85-225`; `compareMetricRows.ts:170-180`; `SavingsRateReport.tsx:384-392`; `CurrencyExposureReport.tsx:168-178`. "Not read: the 60 other report components beyond the scripted matrix (12.4), `components/budgets/`, `strategies/` (only `GemPortfolioPanel` `isKnown` reads), `bonds/`, `email-receipts/`, `tours/`, `whats-new/`, `app/` route guards beyond `DelegateSectionGuard` naming."
- **Reviewed without a finding:** not stated in section 12 (no such list).

#### S21 tests ci release (`21-tests-ci-release.md`)
- **Runtime executed:** Node 24.22.1; PostgreSQL 16 in Docker (`monize-pg`); Helm v3.16.4. `node scripts/check-env-docs.mjs` OK (81 vars); `node scripts/check-docs-manifests.mjs` OK (119 Helm values, 33 documents); `helm lint` and `helm template` default and `backend.persistence.backups.enabled=true`; `push:client:test` baseline and renamed (10 then 0 tests, both exit 0); `node --test` on a missing file (exit 1) and an empty file (exit 0); two `docker run -u 1001` writability probes (both denied). Backend `TZ=UTC npm run test:unit -- --coverage`: 1048 suites, 27481 tests (27479 passed, 2 skipped), thresholds met. Frontend `npm run test:cov`: 1139 files, 22249 tests passed, thresholds met. Full `npm run test:integration`: 118 suites, 1479 tests: 1468 passed, 8 skipped, 3 failed (all in `bank-sync.integration.spec.ts`, midnight crossing); one deadlock reproduced in the PostgreSQL log without a failing test. Focused mutation runs (section 6.1). Hosted CI read read-only via the GitHub API; not used as a test result.
- **Read in full:** `.github/workflows/ci.yml`; `docs/release-integrity.md`; `backend/Dockerfile`; `frontend/Dockerfile`; `backend/docker-entrypoint.sh`; `backend/scripts/test-chain.mjs`; `backend/scripts/test-changed.mjs`; `frontend/scripts/test-changed.mjs`; `frontend/vitest.config.ts`; `backend/test/jest-integration.json`; `backend/test/jest-e2e.json`; the `jest` block of `backend/package.json`; `e2e/playwright.config.ts`; `e2e/playwright.push.config.ts`.
- **Sampled / not read:** Sampled: `fork-images.yml` 1-56, 84-196; `lighthouse.yml` 25-67; `zap.yml` 20-63; `pr-checklist.yml` 1-40; `helm/values.yaml` 215-300; `helm/templates/deployment-backend.yaml` (by grep); `docker-compose.prod.yml` 96-112; `docker-compose.ha.yml` ranges; `README.md` 486-527, 645-680; `docs/verification-contract.md` sections 4-5; `scripts/check-env-docs.mjs` 1-80; `integration-setup.ts` ranges; `report-currency.service.ts` 81-120. "Not reviewed": `restore-peak-rss.yml`, `ghcr-cleanup.yml`, `bearer-exceptions-review.yml` beyond their triggers; `scripts/verify-schema.sh` (S05 ran it twice); the 40 E2E specs beyond their skip sites.
- **Reviewed without a finding:** not stated in section 12.

#### S22 delta review (`22-delta-review.md`)
- **Runtime executed:** 8 runs at `MAIN_SHA` in a worktree (Node 24.22.1, `TZ=UTC`; `npm ci` in `backend/` and `frontend/` exit 0), all green. Backend unit HIGH set: 14/14 suites, 1 398/1 398 tests. Backend integration HIGH set (10 patterns): 10/10 suites, 238/238 tests. Backend unit STILL_OPEN set: 9/9 suites; 1 247 passed, 2 skipped (root-only backup permission tests). Backend integration STILL_OPEN set: 4/4 suites, 60/60 tests. Frontend A26-S20-01 set: 11/11 files, 333/333 tests. Frontend A26-S18-01 set: 3/3 files, 64/64 tests. Frontend A26-S19 set: 7/7 files, 426/426 tests. Integration suites ran one at a time (`--runInBand`). Delta `git diff 72c59ec4...origin/main`: 0 bytes, 0 files (`MAIN_SHA` equals `AUDIT_BASELINE_SHA`). No `ci.yml` run exists for `72c59ec4` (`[skip ci]`); hosted CI not converted into a result.
- **Read in full:** Reports `01` to `18` and `20` read at `f7690b3`: finding headings, severity and Location of every A26 finding in section 4, HIGH findings' fields 3-6, section 5 through the register; `plan.md`, `sessions.md` (S22 block), `ledger.md`, `prior-findings-register.md` in full.
- **Sampled / not read:** "sections 4 and 5 of the reports were read by heading, severity, location and disposition, not line by line"; `19-frontend-forms.md` and `21-tests-ci-release.md` read by headings and severity (S21 partial). "No source call site was inspected: no source file changed."
- **Reviewed without a finding:** not stated in section 12 (the delta is empty; every A26 HIGH (18) and every STILL_OPEN prior finding recorded as untouched by the delta).

## 21. Prioritized remediation plan

The task list is [`remediation-tasks.md`](./remediation-tasks.md): 58 tasks, one PR each,
dependency-ordered, each naming the canonical findings it closes, the invariants, the files, the
regression tests and the gate. The remediation is a separate program with its own Discussion and
`approved-to-build` label (`CONTRIBUTING.md`).

| Priority | Workstream | Tasks | Closes |
| --- | --- | --- | --- |
| P0 | Security boundaries open now | T01, T02 | A26-H01, A26-M03, A26-H02 |
| P0 | Writers that create or duplicate money without a race | T03, T04, T05, T06, T07 | A26-H05, A26-H08, A26-H09, A26-H13, A26-M10, A26-H14 |
| P1 | Test harness at the production boundary (first, blocks the rest of P1) | T08 | A26-M42 (harness half) |
| P1 | Snapshot and occurrence roots | T09, T10, T11, T12, T13 | A26-H03, A26-M11, A26-H04, A26-H06, A26-H07, A26-M15, A26-M14 |
| P1 | Currency and completeness roots | T14, T15, T16, T17 | A26-H10, A26-L05, A26-H11, A26-H12, A26-H15 |
| P2 | Auth and tenancy | T18, T19, T20, T27, T41 | A26-M01, -M02, -L07, -M04, -M05, -M06, -M17, -M25, -M36 |
| P2 | Ledger, imports and accounts | T21, T23, T24, T25, T26, T28, T29 | A26-M07, -M09, -M12, -M13, -M16, -M24, -M18, -M19 |
| P2 | Investments, bonds, loans, strategies | T30, T31, T32, T33, T34, T35, T36 | A26-M20, -M21, -M22, -M23, -M26, -M27, -L24, -M29, -M30, -M28, -L25, -L34 |
| P2 | Budgets, reports, AI | T37, T38, T39, T43, T44 | A26-M31, -M32, -L38, -L39, -M33, -L12, -M34, -M38, -M39 |
| P2 | Frontend state | T40, T42 | A26-M35, A26-M37 |
| P2 | Release and CI | T22, T45, T46, T47 | A26-M08, -M40, -M41, A26-M42 (remaining family rows) |
| P3 | LOW findings and documentation | T48-T58 | the remaining LOW canonicals |

Sequencing rules: the P0 tasks need no new harness (each has a single-connection or failpoint red
test); T08 lands before any P1 task whose test needs two connections or the real scheduled
module; T13 follows T12 (both change `post()`); T15 and T16 follow T14 (they use its "unknown,
not 1" contract); T43 and T44 follow T17. Every task lands with its red test first and with the
`docs/system-invariants.md` entry it corrects.

## 22. Residual risk after remediation

- **The snapshot shape will recur** until a guard matches per function rather than per file, and
  until whole-entity saves after an earlier read are banned or audited (D-S03-01). T09 extends
  `derived-state-writers.guard.spec.ts`; the save audit is not in the task list and needs its own
  proposal.
- **Provider and deployment behaviour** stays unobserved: real S3 semantics, real bank
  `entry_reference` reuse frequency (A26-H09's medium frequency confidence), branch protection.
- **Areas not audited** (section 20.1) carry their pre-program risk.
- **No hosted CI evidence for the audited revision** (section 2): until A26-M41 is fixed, every
  release revision is in the same position.
- **Severity of the merged groups is the group's.** A remediation that fixes the primary surface
  and not the merged ones leaves a finding open; each task lists every surface.

## 23. Final conclusion

Monize at `72c59ec4` has closed most of what the upstream audit found, with mechanisms that
hold under execution and tests that mostly prove them. The program found 96 canonical defects, 15 of
them HIGH, concentrated in two security checks, in branches that bypass the lock or the
occurrence identity the main path uses, in writers that duplicate or create money on edges, and in
currency and completeness rules that have a shared helper the failing surfaces do not call. No
BLOCKER was found, no upstream fix has regressed, and every HIGH has an executed reproduction and
a red test to land with its fix.

**Program verdict: REQUEST CHANGES.** The verdict turns to APPROVE for this revision's successor
when the P0 and P1 tasks have landed with their red tests, A26-M42's harness exists, and a hosted
CI run of the release revision is on record.

## 24. Text for the ledger (orchestrator merges)

- **Session row:** `| S23 | done | 2026-10-22 | 2026-10-22 | <this commit> | 0/15/42/39 (canonical) | 23-final-report.md, remediation-tasks.md; verdict REQUEST CHANGES; 143 session findings -> 96 canonical; main re-fetched, equal to the baseline |`
- **Running counts (final, canonical):** BLOCKER 0; HIGH 15 (A26-H01..H15); MEDIUM 42 (A26-M01..M42); LOW 39 (A26-L01..L39). Session-level counts unchanged (18/66/59 = 143); section 17 maps each.
- **Prior findings (final):** 47 FIXED_VERIFIED (7 with a residual or test gap), 22 STILL_OPEN, 1 REJECTED (MON-M28), 0 SUPERSEDED, 0 NOT_LOCATED.
- **Open hypotheses:** every "to S23" line is disposed of in sections 6.2, 15 and 17.2; the remaining open items are the not-audited areas of section 20.1.
- **`main` at closure:** `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86` (2026-10-22), no second delta review.
- **Deviation:** S23 delegated the extraction of the per-session coverage ledgers (section 20.2) to one read-only subagent and spot-checked S07 and S16 against their reports; the findings, severities and the register were built by S23 directly from section 4 of each report.

## Appendix A. Rejected hypotheses

### A.1 S23's merges and severity changes (Rule 8)

| Candidate | Evidence considered | Why rejected or downgraded | Final classification |
| --- | --- | --- | --- |
| Merge A26-H08 (MNY) with A26-M14 (scheduled post, AI action) as one post-commit root | Same class: a post-commit failure reported as no write, inviting a replay | The breadth differs (a whole file versus one row) and the code paths share nothing; Rule 7 asks for one finding per root cause, and the faulty decisions are three different error classifiers | Kept separate; one remediation pattern, tasks T04 and T13 |
| Merge MON-H11's four surfaces (A26-H13, A26-M10, A26-M16, A26-M18) | Same invariant: each transfer leg in its own account's currency, legs in step | Four different writers (client form, PATCH route, MNY synthesizer, QIF writer) with four faulty decisions | Kept separate; T06 joins the form and the route because they share the transfer edit contract |
| Merge A26-H01 and A26-M03 | Both in the refresh-token family logic | Opposite failures (false negative and false positive) | Kept separate; one task (T01) because the fix of one changes the other |
| Merge A26-H03 (cash transfers) and A26-H04 (investment cash leg) | Same snapshot shape | Different invariants (INV-BALANCE-001 versus INV-HOLDING-001) and services | Kept separate |
| Merge every "check in one transaction, write in another" finding | A26-M01, -M02, -M04, -M05, -M19 share the shape | Different code, different invariants | Kept separate; the shape is a design risk (section 15) |
| A26-S06-01 as HIGH (other owners' backups deleted) | Loss of recovery points | A one-time population; live data and current backups unaffected | MEDIUM kept (A26-M07) |
| A26-S04-03 as HIGH (RLS lets a delegate issue itself a delegation) | Cross-tenant escalation at the policy level, executed | Needs a second defect on a current path | MEDIUM kept (A26-M06) |
| A26-S21-02 / A26-S02-10 as HIGH | A CRITICAL-CVE image could reach `:latest` | Conditional on a CVE at release time; no present failure | MEDIUM kept (A26-M41) |
| A26-S21-03 as HIGH (backups cannot be written on documented Compose) | Feature unavailable | Visible through `describeStore`, no silent loss | MEDIUM kept (A26-M40) |
| A26-S07-04 as HIGH (PATCH changes one leg) | 50 % of a transfer created, executed | Not reachable from the transfer form; REST, PAT and joint register only | MEDIUM kept (A26-M10) |

### A.2 Per-session tables (section 8 of each report, verbatim)

#### S01 (`01-baseline.md` section 8)

| Candidate | Evidence considered | Why rejected or downgraded | Final classification |
| --- | --- | --- | --- |
| A file outside `WITH_CONTEXT_ALLOWLIST` seeds a context today | 81 importers of `with-context` vs 81 allowlist entries, parsed with the TypeScript parser; 214 call sites; no alias, namespace, re-export, `require`, dynamic import; `requestContextStorage.run` only in `with-context.ts` and the allowlisted interceptor | Sets match exactly in both directions; no stale entry | `REJECTED` (the latent bypass is A26-S01-02) |
| Identity GUCs set outside `scoped-db.ts` | `set_config` sweep: `app-role.ts:218,243,250` (role), `advisory-locks.ts:85` (`lock_timeout`), `backup-export.service.ts:431`, `job-claim.service.ts:245` (`app.job_claim_lease_token`) | None sets `app.current_user_id`, `app.real_user_id`, `app.bypass_rls` or `app.preserve_timestamps` | `REJECTED` |
| A bare `dataSource.query` on tenant data outside the door | `src/database/fix-linked-transactions.ts`, `add-skip-price-updates-column.ts` (one-off maintenance scripts with their own `DataSource`), `health.controller.ts:146` (`SELECT 1`), `main.ts:198` (`pg_notify`) | None reads or writes tenant rows through the request path; the scripts are operator tools | `REJECTED`; the two maintenance scripts are handed to S04 to confirm they are not reachable from the API |
| A cron without any cross-replica mechanism | 49 handlers in 46 files; every one names a claim, lease, conditional write, dedupe index or an idempotent predicate `DELETE` (section 12.3) | The 16 handlers without a claim either delete by predicate, recompute absolutely under a row lock, or dedupe their notification; none sends email, push or a provider call without a claim, lease or dedupe key | `REJECTED` at inventory level; per-job proof is S08 |
| `npm ci` on Node 22 is a repository defect | S00 record; README.md:418,491 says Node 24; every CI job pins `node-version: 24`; Dockerfiles use `node:24-*` | No `engines` field and no `.nvmrc`, but the requirement is documented and enforced where it matters | `REJECTED` (environment fact); the absent `engines`/`.nvmrc` is in section 9 |
| The 2 skipped backend unit tests hide a defect | `backup/auto-backup.service.spec.ts:935,1346` skip when `process.getuid() === 0` (permission tests); the session container runs as root, CI does not | Environment-dependent by design | `REJECTED` |
| Guard specs silently skip and pass | 14 guard specs use `REPO_ROOT || process.env.CI ? describe : describe.skip` | In a clone `REPO_ROOT` resolves; in CI `CI` is set; they ran here (no extra skips counted) | `REJECTED` |
| An AI tool wired into only one adapter | Not searched in this session | Out of slice | handed to S17 |

#### S02 (`02-prior-high-triage.md` section 8)

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

#### S03 (`03-security-auth.md` section 8)

| Candidate | Evidence considered | Why rejected or downgraded | Final classification |
| --- | --- | --- | --- |
| Step-up tokens are replayable within 5 minutes (hint: "single use of step-up") | `step-up.guard.ts` never checks `jti`; `step-up.service.ts:210-214` mints one | No document or invariant claims single use for step-up tokens; they are purpose-, subject- and time-bound, and the two purposes (`personal-access-token`, `emergency-access`) are settings writes the same session could repeat after another step-up. The single-use requirement is stated, and met, for the OIDC artifact (INV-AUTH-003) | `DESIGN_RISK` (D-S03-02) |
| OAuth consent `POST /oauth/interaction/:uid/confirm` is `@SkipCsrf` and cookie-authenticated, so CSRF can grant a client | `oauth-interaction.controller.ts:23, 131-170`; `auth_token` cookie `sameSite: "lax"`; `uid` is the provider's unguessable interaction id bound to its own interaction cookie | A cross-site POST does not carry `SameSite=Lax` cookies, and the attacker cannot know the victim's `uid` | `REJECTED` |
| Emergency claim: the pre-check (`findValidContact`) is a read-then-write | `emergency-access-claim.controller.ts:183` | The pre-check only rejects early; the consume is the conditional UPDATE (executed race, section 5) | `REJECTED` |
| Lockout check reads a snapshot before bcrypt, so parallel attempts on an unlocked account all reach bcrypt | `auth.service.ts:400-409` | All of them are counted atomically and the lock follows; the burst is bounded by the per-address throttle; same class as A26-S03-06 but for passwords the lock is the documented control and it engages | downgraded, folded into A26-S03-06's reasoning |
| `revokeAllUserRefreshTokens` misses a family opened mid-sweep | `token.service.ts:313-361` | Deliberate (comment cites maintainer review PR #1097 finding 4): a session opened after the operation began is not one the caller asked to end | `REJECTED` (Rule 2: deliberate semantics) |
| Delegated refresh rotation keeps `actingAsUserId` after the delegation is revoked | `token.service.ts:222-238` | `JwtStrategy.validate` re-runs `validateActingContext` on every request and `AccountDelegateGuard` re-checks capabilities | `REJECTED` |
| An id route in the slice lacks `ParseUUIDPipe` | `grep @Param(` over the slice's controllers | Only `push-chart.controller.ts` `:token` (an opaque one-use token, not a UUID) | `REJECTED` |
| A `withSystemContext` / `withUserContext` / `withDelegateContext` call site in the slice is missing from `WITH_CONTEXT_ALLOWLIST` | 20 files in the slice call one; each checked against `backend/eslint.config.mjs` | All 20 are listed | `REJECTED` |
| A TOTP code can be replayed across login and step-up | `two-factor.service.ts:315-320, 477-512` (`SingleUseTokenService.claim` with one purpose for both) | Replay protection is shared and atomic (`INSERT ... ON CONFLICT DO NOTHING RETURNING`); `single-use-token` integration suite green | `REJECTED` |
| Frontend persists a credential | `frontend/src/store/authStore.ts:139-143` `partialize` keeps only `isAuthenticated`; no storage of step-up or re-auth tokens found | -- | `REJECTED` |

#### S04 (`04-rls-tenancy.md` section 8)

| Candidate | Evidence considered | Why rejected or downgraded | Final classification |
| --- | --- | --- | --- |
| A file uses an identity-context helper without being in `WITH_CONTEXT_ALLOWLIST` | 94 files mention a helper name; 81 import `with-context`; the allowlist has 81 entries | Every importer is listed and no entry is stale; the 13 other files mention the names in comments only (or are `scoped-db.ts` / `with-context.ts` themselves) | `REJECTED` |
| `RLS_MODE` read from two sources could put the owner's credentials behind enforced GUCs | `app.module.ts:100` reads `ConfigService`, `withScopedDb` and `main.ts` read `process.env`; `ConfigModule.forRoot` loads `../.env` into `process.env` before the pool is built | Both resolve to the same value once the config module has loaded, which precedes the first `withScopedDb` and the startup check; a mismatch (owner role with GUCs) would also be the safe direction for tenancy | `REJECTED` |
| `PgListener` (second direct connection) reaches tables | `docs/row-level-security-contract.md` section 4; `direct-connection.guard.spec.ts` | Runs only `LISTEN` / `pg_notify` on the runtime role; guard-enforced; payload rule stated | `REJECTED` |
| The `oauth_payloads` exception is wider than documented | contract section 3; `OAUTH_PAYLOAD_ALLOWLIST`; `oauth-payload-access.spec.ts` | Two access paths, both in `oauth/`, both guard-enforced; `revokeAllForUser` keyed on a server-derived id | `REJECTED` |
| `withUserContext` used where `withDelegateContext` is needed | 4 `withDelegateContext` calls in 3 files (`jwt.strategy`, `account-delegate.guard`, `delegation.service`); MCP seeds `withUserContext(bearer userId)` and does not support acting | MCP and PAT routes cannot act as a delegate (no `@AllowDelegate`), so one id is the correct identity | `REJECTED` |
| A delegate acting for owner A can read owner B's granted accounts at the database level | The joint read arms match any active delegation whose `delegate_user_id = app_real_user_id()`, whichever owner the session is acting for | App-level filters (`userId = owner`, `delegateReadableAccountScope`) still apply, and the arm widens nothing the delegate cannot read in its own session; no present-day leak | `DESIGN_RISK` (D-S04-01) |
| `revokeDelegate` races `createDelegate` of another owner and deletes the login the other owner just linked | `delegation.service.ts:1348-1369` counts other delegations then deletes the user, without a lock | Under READ COMMITTED the other owner's insert either commits before the count (no delete) or fails on the FK after the delete (the link errors visibly); the bad interleaving (insert commits between count and delete) cascades the new delegation away, so the other owner sees an error or a missing delegate, not a leak | downgraded, `DESIGN_RISK` (D-S04-03) |
| Cross-owner VOID / reconcile semantics are wrong under enforcement | `cross-owner-transfers` green on the owner role; locked per-leg VOID decision in `updateCrossOwnerTransfer` | Not executed on `monize_app` (A26-S04-04); depth belongs to S07 | handed to S07 |
| `push_chart_artifacts` exemption leaks one user's chart to another | exempt table, no owner column, `png BYTEA` of a person's figures, id is a 64-hex token | No application read path other than the token-keyed `DELETE ... RETURNING`; rows are short-lived; any session could `SELECT` them only through a second defect | `DESIGN_RISK` (D-S04-02) |

#### S05 (`05-migrations-schema.md` section 8)

| Candidate | Evidence considered | Why rejected or downgraded | Final classification |
| --- | --- | --- | --- |
| Rule-less AI review requests escape `uq_ai_review_requests_open` (NULLs distinct) | `ai-review-requests.service.ts:183-330` | Known and handled: the receipt path takes an advisory lock and a `WHERE NOT EXISTS`; the only `enqueue` caller (`transaction-rules-applier.service.ts:812`) always passes a rule id | REJECTED |
| Mortgages created by a 1.17 pod during the 1.18 rollout keep `mortgage_type NULL` and are priced as annuities | `mortgage-type.util.ts:162-180`, `plan-loan-settlement.ts:260-264` | Every consumer reads through `mortgageTypeOf`, which falls back to the legacy flags; the CHECKs added in `20261002151116`/`20261003000245`/`20261003000246` all admit NULL | REJECTED |
| Restoring a backup without `calendar_day_notes.end_date` fails the `NOT NULL` | `20260912034642` and `20260912200152` both first shipped in 1.17.0 | No released artifact lacks the column | REJECTED |
| Seven merged numbered migrations were edited after `d5cea9bf` (037, 111, 112, 113, 114, 117, 123) | `git diff d5cea9bf 72c59ec4 -- database/migrations/` | 111/113/114/117/123: comments only. 037 and 112: replay guards (`to_regclass` skip) added for the `budget_alerts -> notifications` rename in 179, so a replay on `schema.sql` no longer fails; a database that applied the old body is unaffected because the tracker never re-runs it, and the new body does the same thing where the table exists | REJECTED (no behavior change on any deployed database) |
| Deleted migrations (`174_notification_throttle_minutes`, `20260920110943_currency_provider_history_floor`, `149_emergency_access_generation_compat`) left orphan tracker rows or columns on deployed databases | release trees `c1fdebd87`..`3cac8b895` | None shipped in a release; the `provider_missing_*` columns the second one added are dropped by `20260920163144` for any `main` build that ran it | REJECTED |
| `currency_code_in_use_globally` loses its `REVOKE ... FROM PUBLIC` when redefined by `CREATE OR REPLACE` in `20260920163144` and `20261010190000` | PostgreSQL keeps a function's ACL on `CREATE OR REPLACE`; `schema.sql:4327` revokes on fresh installs | ACL preserved on both paths | REJECTED (not executed: `verify-schema.sh` dumps `--no-privileges`, so this is not covered by the drift job; recorded in section 10) |
| `bond_instruments` auto-named unique constraint (64 characters) differs between migration and `schema.sql` | catalog diff: `bond_instruments_issuer_country_code_issuer_code_series_cod_key` on both | Same truncation on both paths; the harness has an equivalent key under a TypeORM name, and no code names the constraint | REJECTED |
| A required SQL function is called from `src/` but unregistered | every `CREATE FUNCTION` in `schema.sql` vs `backend/src` callers | The six called functions are registered; the eight others are trigger functions | REJECTED |
| `pg_advisory_lock($1)` with 4150293001 resolves to the two-int overload or overflows | key > 2^31 is a valid `bigint`; one-argument overload is bigint only | Executed: the race run acquired and serialized | REJECTED |

#### S06 (`06-backup-restore.md` section 8)

| Candidate | Evidence considered | Why rejected or downgraded | Final classification |
| --- | --- | --- | --- |
| A failed post-restore delete of displaced objects orphans the old receipts forever | R6; `schema.sql:549` trigger | Every DELETE of an external row writes a tombstone; the sweeper deletes the key unless a live row names it | REJECTED |
| A concurrent upload between `collectExternalAttachmentKeys` and Phase 1 orphans its bytes | trigger as above | Phase 1's DELETE tombstones it | REJECTED |
| A non-UUID or traversal `storage_key` from the file reaches a provider | `backup-attachment-transfer.service.ts:288`, `restore-references.ts:328`, `storage-key.util.ts` | key forced to the id; non-UUID ids refused; key validated per provider | REJECTED |
| A crafted file reads another tenant's external object (F3RRR-001) | `loadOwnedAttachmentSources` scoped by `user_id`, stored size and hash compared | ownership comes from the database only | REJECTED |
| Duplicate `attachment_blobs` rows validate one copy and insert another | `:242-251, 427-432` rebuild | collapsed to the validated bytes | REJECTED |
| Non-admin users choose backup folders (MON-M10) | controller guards | admin only, canonical containment | REJECTED (fixed) |
| Restore silently removes a joint-account grantee's access | `docs/backup-restore-contract.md` "Delegation is reset" | documented, product decision recorded as undecided | DESIGN_RISK (documented; not a finding) |
| A cross-owner transfer's counterpart leg keeps a balance effect after the owner restores | `restore-references.ts:217-226` | documented severing; each owner's ledger is self-consistent | REJECTED (documented behaviour; S07 owns the ledger) |
| Manual backup races a restore (TOCTOU on `isUnderMaintenance`) | `auto-backup.service.ts:1297-1305`; export in one `REPEATABLE READ` snapshot; restore one transaction | the snapshot sees either the before or the after state, never a mixture | REJECTED |
| Monthly name with a two-digit year mis-sorts | `backup-file-names.ts` parses `20YY-MM` | consistent within the century | REJECTED |

#### S07 (`07-cash-ledger.md` section 8)

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

#### S08 (`08-scheduler-cron.md` section 8)

| Candidate | Evidence considered | Why rejected or downgraded | Final classification |
| --- | --- | --- | --- |
| Budget rollover keyed on the UTC month while the cron fires at server-local midnight (sweep agent) | `budget-period-cron.service.ts:40-42, 75-100, 150-155` | The close decision parses `periodEnd + "T23:59:59"` on the same local clock that fired the cron, so the right period closes; the key is a label. Replicas in different zones fire at different instants and the guarded writes (`closePeriod` row lock, `ON CONFLICT (budget_id, period_start)`) hold | REJECTED |
| Reminder lease (10 min) vs nodemailer's default 10-minute socket timeout | `email.service.ts:199`; one tick per day per key | A second replica fires at the same instant and has already lost; a later tick of the same key does not exist (date-keyed, daily) | REJECTED |
| `claimOnce` keys reset by the 30-day sweep | sweep agent; every key is a day, hour or month | No undated permanent key | REJECTED |
| One email per replica on any cron | the 49-row sweep (section 12) | Every external effect sits behind a claim, a lease or a dedupe insert | REJECTED |
| `refreshForeignCurrencyEstimates` overwrites a concurrent edit of `originalAmount` (unlocked read then `update`) | `scheduled-transactions.service.ts:769-829` | Writes only the account-currency estimate; posting re-derives from `originalAmount` and the dated rate (`resolveFxForPosting`, `:2721-2795`); INV-OCCURRENCE-003 says no surface substitutes the persisted `amount` (not re-verified per surface here); at worst a stale estimate until the next weekday | DESIGN_RISK (LOW, not a finding) |
| Two replicas both post a due occurrence | P1, P1b, M2, M3 | Lock + CAS + claim key, each a backstop for the other | REJECTED (holds) |
| A failure between the claim and the money leaves a claim and no money | P5 | One transaction | REJECTED (holds) |
| The cron alerts on every replica | `raiseUserAlert` dedupe key `SCHEDULED_POST_FAILED:<id>:<UTC day>` | One row per schedule per day | REJECTED |
| Manual backup fan-out rewinds the cron's per-user claim (S06) | `auto-backup.service.ts:1293-1373` | Records only the outcome | REJECTED (beyond S06's own effects) |

#### S09 (`09-import-mny.md` section 8)

| Candidate | Evidence considered | Why rejected or downgraded | Final classification |
| --- | --- | --- | --- |
| A retired (reaped) worker commits its rows | `markDataCommitted` CAS, trigger 145, M3 detected; jobs never return to `pending`, so a reaped row can never be re-claimed | fence holds; the token is redundant with `status` but harmless | REJECTED |
| A reaper UPDATE racing the checkpoint loses the committed flag | the checkpoint UPDATE row-locks the job; the reaper waits, re-evaluates its WHERE on the new version (EvalPlanQual), and its `CASE WHEN data_committed` sees `true` | committed key and `retryable=false` written | REJECTED |
| The unawaited job body joins the request's ambient transaction | `start` has returned from `create`'s `withScopedDb` before the `void withUserContext(...)`; the ambient manager lives only inside `withScopedDb` (`scoped-db.ts:131`) | no ambient manager at that point | REJECTED |
| `start`'s `.catch` fails a live worker's job without a token | it runs only when `runClaimed` itself rejects, i.e. after the body finished or never ran | no live body at that point | REJECTED |
| `deleteData` (wipe) deletes the pending job or its staged file | `import_jobs`/`import_staged_files` are referenced only by maintenance, backup and the MNY module | not reachable | REJECTED |
| `exchangeRate: 1` on every MNY row misstates a cross-currency transfer | rows carry their own account's currency and no `originalCurrencyCode`; the rate is relative to the original currency (`financial-semantics.md` section 3) | rate 1 means "same currency" here, consistently | REJECTED |
| Old-binary worker during a 1.18 -> 1.19 rolling deploy bypasses the fence | both releases carry the token fence; the pre-140 binaries no longer exist on a supported upgrade path | historical only | REJECTED |
| A pre-140 failed job that had committed (P4-002 era) is offered Retry after the upgrade | migration 140 adds `data_committed DEFAULT false`, so such a row stays `retryable`; its staged bytes expire 24 h after upload and the wizard only polls the job it started | window closed within a day of the upgrade; not reachable from the UI later | REJECTED |
| `accounts` and `bills` arrays in `MnyImportOptionsDto` lack `@ArrayMaxSize` (`backend/CLAUDE.md` rule) | elements are bounded `@IsInt`/`@IsBoolean`; the JSON body limit bounds the array; the mapper looks entries up by handle | convention deviation, no demonstrated impact | DESIGN_RISK (noted for S21's guard work) |
| Security currency differs from the account's: trades in account currency at rate 1, prices in the security's currency | writer denominates the row in `transaction.currencyCode` with `exchangeRate: 1` (`write-investments.ts:274-292`); INV-FX-002 reads the rate as amount -> settlement currency, so 1 is right; valuation of such holdings is S12/S13's | not an import defect on the evidence read | handed to S12/S13 |
| Verification compares against Money's own balances | it compares the database against `computeExpectedBalances`, which sums the mapped rows | mapping defects are invisible to it | DESIGN_RISK (section 9) |

#### S10 (`10-rules-banksync-csv.md` section 8)

| Candidate | Evidence considered | Why rejected or downgraded | Final classification |
| --- | --- | --- | --- |
| Two concurrent syncs import a row twice | link `FOR UPDATE`, `ON CONFLICT` claim; integration "two syncs at once" (three variants) green | The ledger key arbitrates | REJECTED |
| A re-link to the same account with the same cut-off during a cron fetch imports an account that "needs preview" | writer re-checks `accountId` and `syncFromDate` only (`bank-sync-writer.service.ts:212-228`) | The rows are the ones the link already covered; a changed cut-off is refused | DESIGN_RISK (narrow), not a finding |
| The rules applier opens its own transaction somewhere | every read/write on the passed `m`; `resolveCreatedPayee` calls `PayeesService` (`withScopedDb` re-entrant, joins the ambient transaction) | Nested scoped calls join | REJECTED |
| `createSplits(new Date(row.transactionDate))` shifts a rule split's leg date in a negative time zone | `transaction-split.service.ts:124-132, 395-396, 482-483` use `toISOString()` of a UTC-midnight `Date` | Consistent UTC round trip | REJECTED |
| `balanceDiff = newAmount - oldAmount` unrounded in `matchPendingTransfer` | `updateAccountBalance` applies `roundMoney` (`import-context.ts:216`) | Rounded at the write | REJECTED |
| A VOID imported row moves the balance (`updateAccountBalance` at `import-regular-processor.service.ts:138` ignores status) | post-processing recompute uses `LEDGER_MOVEMENT_PREDICATE` under the lock | Transient only, healed after the commit like A26-S10-05; noted in section 9 | DESIGN_RISK |
| Bank-sync provider failure multiplies provider calls | one fetch per sync under the 30-minute lease; balance failure logged once; failure recorded once per account | No amplification model beyond one call per account per sync (Rule 6) | REJECTED |
| Private key leaks through `last_sync_error` | `describeSyncFailure` / bounded sanitized message (`bank-sync-errors.ts:150`); grep of `bank-sync/providers` for `privateKey` in a log, error, message or throw: none | Not reachable from the code read (the adapter itself was not read in full) | REJECTED |

#### S11 (`11-email-receipts.md` section 8)

| Candidate | Evidence considered | Why rejected or downgraded | Final classification |
| --- | --- | --- | --- |
| S05 hand-off: rule deletion pushes a receipt into `review_conflict` | `ai_review_requests.rule_id REFERENCES transaction_rules ON DELETE SET NULL` (`schema.sql:914`); `insertReceiptRequest`'s `NOT EXISTS` counts any open, unexpired request with `rule_id IS NULL` on the transaction, whatever its kind (`ai-review-requests.service.ts:301-308`); the only producer of a rule-less `transaction_review` is that `SET NULL` (the rules applier is the sole `enqueue` caller) | Reachable: a rule's open review on transaction T, the rule deleted, an email then matching T becomes `review_conflict` ("Another request is open"). But the orphaned request is a real open review of T, visible in the inbox, the label is accurate, the person dismisses it and reprocesses, and it expires in 30 days; nothing is written wrongly. Not executed beyond the code and schema read | DESIGN_RISK (DR-S11-1) |
| Two-pass AI category question doubles the call under the poll's own loop | `pipeline.process` asks between two transactions; the second pass re-locks and re-checks `onlyWhenStatusIn` | Within one lease, one poll asks once per email; doubling only under the lease overrun of A26-S11-01, where it is counted | Folded into A26-S11-01 |
| Concurrent passes replace an auto-applied proposal | Two passes on a `review` email from the rematch list; the second closes the first's `proposed` request | `markApplied` is bound to `proposed`: whichever commits first wins, the loser's confirm is a 409 that leaves its proposal in the inbox; a second application re-writes the same splits; reachable only under lease overrun | REJECTED (benign) |
| `ignore` racing an auto-apply leaves an applied email `ignored` | `ignore` reads `receiptApplied` before `closeReceiptRequests` and does not re-read (the trade link does, `email-receipt-trade-link.service.ts:252-273`) | The applied transaction is then no purchase candidate (`receipt-candidates.ts:33-54` excludes it), and a trade email keeps `investment_transaction_id`, so a later reprocess proposes nothing twice; only the label is wrong | REJECTED (cosmetic; noted in section 9 as the asymmetry) |
| Mailbox security downgrade by a stolen session (port/security change keeps the stored password) | `upsert` needs the password again only when host or user name changes (`mailbox.service.ts:169-173`) | `security` is `tls` or `starttls` only and `doSTARTTLS: true`, `rejectUnauthorized: true`, TLS 1.2 minimum (`imap-mailbox-client.ts:154-169`): there is no cleartext mode; a port change on the same host reaches the same operator | REJECTED |
| ReDoS through a parser pattern written by a prompt-injected AI draft | Drafts come from email text through the AI | Patterns are globs matched linearly; no `RegExp` is built from a profile (`receipt-glob.ts:20-25`); drafts read nothing until approved | REJECTED |
| XSS through the email's HTML | `readDetail` returns `body_html` | `EmailHtmlFrame` renders it only in `<iframe sandbox="" srcDoc>` behind a CSP meta; a source test forbids `dangerouslySetInnerHTML` in the tree | REJECTED |
| OAuth flow tokens accepted by another verifier (A26-S03-03 pattern) | The flow's state and tokens | The state is an AES-GCM `EncryptionService` envelope, not a JWT; the id_token is read only for the login name, from the token endpoint's own TLS response; no token of this flow is signed with `JWT_SECRET` | REJECTED (pattern not present) |
| Whole-entity save after an SQL write (D-S03-01 pattern) | Every `repo.save` in the slice | `save` is used only for inserts (mailbox create, draft parser create, parser create); every update is a column-scoped `repo.update` or SQL after a row lock | REJECTED (pattern not present) |
| Refresh-token rotation race loses the rotated token | Two `obtain` calls on one stored token | Both writes are CAS on the ciphertext read; the only loss is when a provider revokes the old token on reuse and the delete wins the race, which disconnects the mailbox (the user reconnects); Google does not rotate, Microsoft keeps the old token valid | DESIGN_RISK (narrow; not separately listed) |
| Purchase receipts are currency-blind | `ParsedReceipt` has no currency; matching compares numbers | The card is splits checked to the exact transaction amount; no amount, account or date changes, so a cross-currency coincidence can only mislabel categories, and auto-apply also needs an order id, a reference or the payee | REJECTED |
| Two different messages with one Message-ID collapse on import | `deriveImportedUid` keys on the Message-ID | A Message-ID is the sender's identity of one message; the user's own archive; the second copy is reported in `duplicates` | REJECTED |
| A vanished UID is passed by the cursor without a row | `fetchSince` skips a UID with no size or no source and reports `highestUid` of the batch | The message is gone from the folder (deleted between SEARCH and FETCH); nothing readable is lost | REJECTED |
| Daily write-limit exemption claimed by a non-profile writer | `isExemptFromWriteLimit` reads `claimed_by = EMAIL_RECEIPTS_CLAIM_KEY` and the stored switch | Server rows only; whether an MCP agent can ever claim under that literal key is S17's (handed on) | REJECTED here, hand-off |

#### S12 (`12-securities-holdings.md` section 8)

| Candidate | Evidence considered | Why rejected or downgraded | Final classification |
| --- | --- | --- | --- |
| S01 hand-off: `security-price.service.ts:2364, 2432` write prices outside `refuseForeignCurrency` | `upsertTransactionPriceInner` and `backfillTransactionPrices` average the row's own `price` | For app-created rows the price is in the security's currency by construction (the cash leg converts out of it, `:838-850`), so these writers are not provider answers; for Money-imported cross-currency rows it is not, which is A26-S12-09 | Downgraded: REJECTED for app-created rows, CONFIRMED_WITH_DIFFERENT_ROOT_CAUSE as A26-S12-09; `write-prices.ts`, `bond-price.service.ts`, `demo-seed.service.ts` are S09/S14's |
| MON-H08 rebuild racing a trade | `rebuildFromTransactions` takes the lock before its ledger read | Executed R3; M1 caught | REJECTED (fixed) |
| Deutsche Boerse caches a `null` currency after a transport failure (`deutsche-boerse-finance.service.ts:229-266`) | A failed currency lookup is cached as `null`, which makes the quote "provider-silent" (accepted unverified) | TTL is 60 s (`:46`); a mis-recorded currency would also need to coincide with the failure window | DESIGN_RISK (minor) |
| MSN instrument-id negative cache poisons lookups for 24 h | `msn-finance.service.ts:405-412` | Writes `null` only when `answeredSince` shows MSN answered | REJECTED |
| `getMonthOverMonthMovers` subtracts two closes outside `resolveDailyPriceChange` (`portfolio.service.ts:1445-1468`) | A period move, not a daily one | Not a daily-change surface; a stale feed shows a 0.00 percent month (section 9) | DESIGN_RISK |
| Embedded split row edited twice duplicates cash | `updateEmbeddedSplitParent` row-locks the parent and derives the delta from the locked amount (`:3130-3170`) | No separate cash row; last writer wins on the investment fields only | REJECTED |
| A26-S09-03 shape (sleeve credited minus the bank amount under the sleeve currency) on the app's own funding path | `resolveSettlementCurrencyPair` (`:635-660`) and `createCashTransactionInTransaction` (`:838-850`) convert from the security's currency to the funding account's with the trade's rate | The app's BUY/SELL funding leg is converted, not mirrored; the bank-to-sleeve cash transfer is S07's | REJECTED for `securities/` |
| A whole-entity save in `securities/` like A26-S07-07 | `update()` `:4731`, `updateLinkedTransfer` `:4004-4005`, `updatePrice` `security-price.service.ts:2585-2610`, `syncAccruedInterestCompanion` `:1060-1070` | Confirmed for `update()` (A26-S12-01) and `updateLinkedTransfer` (A26-S12-07); `updatePrice` saves a price row only a user edits (a lost concurrent manual edit, no money); the companion is saved under the redemption's lock path | `updatePrice`: DESIGN_RISK |

#### S13 (`13-valuation-fx-networth.md` section 8)

| Candidate | Evidence considered | Why rejected or downgraded | Final classification |
| --- | --- | --- | --- |
| Preferences `defaultCurrency` creates a global active currency (S09 hand-off) | `users.service.ts:373-409`, FK `schema.sql:1561`, P1 | The FK refuses an absent code before the ensure runs | REJECTED (A26-S13-05 is the real defect) |
| MON-M19 cleanup decided from tenant-filtered evidence | definer function, creator gate, integration race | Fixed by the definer function in the caller's transaction | REJECTED for the current code (FIXED_VERIFIED) |
| CSV/QIF mapping names another user's custom currency (S10 hand-off) | `import.dto.ts:145-151`, FK, `findAll` | Currencies are shared reference data by design (any user may activate any code); the effect is that the creator can no longer delete it | DESIGN_RISK |
| `backfillHistoricalRates` reads accounts and securities without `user_id` (agent sweep) | `exchange-rate.service.ts:601-628`, admin-only route | The backfill is deliberately global (the pair set is the deployment's), like the refresh | REJECTED |
| Monte Carlo current value becomes 0 on failure (MON-M33) | `monte-carlo.service.ts:881-936`, frontend test | `null` and a refusal | REJECTED for the current code (FIXED_VERIFIED) |
| Historical net-worth snapshot values a position at a years-old close | `position-price.util.ts`, `docs/time-series-contract.md` section 2.1 | Deliberate and documented (issue #1242): a position's worth is its latest accepted close, unbounded; returns and boundaries stay bounded | REJECTED (documented contract) |
| Period result over a deposit counts the deposit (INV-PORTRESULT-001) | `portfolio-period-result.util.ts:286-330` | `investmentResult = valueChange - netExternalFlows`, percentage only over the result, `zeroStart` refusal | REJECTED |
| `resolveFxRate` default `today` is UTC while callers pass the request day | `fx-rate-resolver.ts:345`, callers pass `todayYMD()` | Every caller read passes `today` explicitly | REJECTED |
| Provider call amplification in `getRateForDate` (no negative cache) | `exchange-rate.service.ts:1129-1227` | Report reads pass `fetchMissing: false`; the posting path is one call per write; no N-row read model built (Rule 6) | optimization hypothesis, handed to S10 for the QIF/CSV per-row FX resolution |
| Portfolio `total*` numeric when incomplete | `portfolio-calculation.service.ts:2184-2185` | Stage 1 of the completeness spec, flags carried; consumers that read them are held | DESIGN_RISK (S02 section 9) |

#### S14 (`14-bonds.md` section 8)

| Candidate | Evidence considered | Why rejected or downgraded | Final classification |
| --- | --- | --- | --- |
| R1 Rounding residual from `price = principalReturned / q` when the removed portions have different per-bond figures | `InvestmentTransactionForm.tsx:567` rounds to 10 dp; `investment_price NUMERIC(24,10)`; `total_amount NUMERIC(20,4)` | The error is at most 5e-11 x q; it reaches 0.0001 only at q of about 10^6 bonds | REJECTED |
| R2 `bond-series` lease (90 min) outrun, S08 hand-off | `getFromIssuer` maps a timeout to `SOURCE_UNAVAILABLE` (`series-source.ts:90-102`), which ends the backfill pass (`bond-series.service.ts:807-811`); the cron fires once a day | A hung source stops the pass at the first timeout; no second runner exists the same day; the store is idempotent under the lock | REJECTED |
| R3 A26-S12-06 (sub-0.0001 snap) in bonds/ | `bondLotsFromTransactions` refuses fractional quantities; `ownLotsGrossValue` tolerance compares whole numbers | No snap reachable; a fractional row refuses the lots and names the row | REJECTED |
| R4 A26-S12-01 (decision from a snapshot read before the lock) in bonds/ | `recomputeSecurity` locks first (`bond-price.service.ts:195`); `store` locks then re-reads (`:880`); write guard after `lockHoldingScope` (create 1231->1238, transfer 2384->2388, update 4477->4482) | The bond paths decide after the lock; S12-01's cash-leg snapshot is S12's and covers bond rows too | REJECTED for bonds/ |
| R5 `GREATEST(covered_through)` defeats the NBP "archive behind" safety | `pl-nbp-reference.ts:140-178`; `benchmark-refresh.service.ts:406-412` | Forward-only coverage never extends coverage on an archive-behind fetch; it keeps the older, smaller date | REJECTED |
| R6 Monte Carlo weighting (`monte-carlo.service.ts:512-539`) wrong for bonds | blend = total gross / total quantity | Summed over accounts, quantity x blend is the security's exact gross; only the per-account path is wrong (A26-S14-02) | DOWNGRADED into A26-S14-02 |
| R7 Final coupon counted twice (interest notification and redemption split) | `bond-notification-events.ts:342-346` | Item 2 requires `maturityDate > date`; the maturity coupon is only in the redemption split | REJECTED |
| R8 Maturity payout of the wrong lot (FIFO) | `bond-holdings.service.ts:84-100`; sale window is one month | Lots of one series share the period months, so the rates and figures are equal | REJECTED |
| R9 Redemption endpoint vs the write's order on the same day | the endpoint appends the REDEEM after every same-day row; an edited row keeps its `created_at` position | A same-day BUY created after an edited REDEEM could be counted by the endpoint and refused by the write; reachable only by editing a redemption on a day with a later same-day purchase that it needs; the write still refuses | DESIGN_RISK, not a finding |
| R10 NBP coverage `today` at 06:25 claims an unfinished day | decisions take effect the day after their announcement | The value effective today is known at 06:25 | REJECTED |
| R11 `valueSecurity` totals null for a matured or not-redeemable lot's `earlyRedemptionValue` | `bond-valuation.service.ts:439-441`, `sumKnown` | A total of early-redemption proceeds over lots some of which cannot be redeemed early has no value; null is honest | REJECTED |

#### S15 (`15-loans-strategies.md` section 8)

| Candidate | Evidence considered | Why rejected or downgraded | Final classification |
| --- | --- | --- | --- |
| MON-M32 still open | upstream P5-008 example | executed through the real `post()`: parent -40.00 = lines (R11) | REJECTED (FIXED_VERIFIED) |
| S08 hand-off: slot selection should prefer the cursor's unpaid slot | `selectOccurrenceSlot` (`occurrence-slots.ts:256-288`), spec 6.2 step 3 and truth table rows 10-12 | nearest-then-earlier is the spec's deliberate rule (Rule 2); with the default window 3/7 (`rule-action.types.ts:150`) a monthly cursor slot and the next slot are never both candidates; with a wide window (up to 31/31, `transaction-rules.limits.ts:35`) a late payment can be matched to the next slot, which only becomes harmful through A26-S08-03's cursor defect. The fix belongs in `post()` (A26-S08-03's diff), not in the selection | DESIGN_RISK (D2), feeds A26-S08-03 |
| S09 hand-off: a doubled MNY import re-settles an occurrence through a structural rule (INV-LOAN-008) | planner rows 14-15 (`plan-loan-settlement.ts:280-302`): claims read under the schedule lock, `occurrence_already_posted` | the duplicate row's window (3/7) contains only the slot the original already claimed, so the duplicate is refused `occurrence_already_posted` and stays a plain debit (A26-S09-01's double cash only). Only a window wide enough to reach the next slot (about 28+ days for monthly) settles it as the next installment | REJECTED at the default window; DESIGN_RISK for wide windows (D2) |
| S10 hand-off: what deleting a duplicate settled row undoes | spec 12.5; `transaction_id ... ON DELETE CASCADE`; `loan-settlement-claim` "delete releasing the claim" | delete releases the claim in the same statement; the cursor is deliberately not rewound; for a rule-driven loan the next real bank row settles the freed history slot (nearest unclaimed in window), so nothing is lost; for a bill-driven loan the advanced cursor skips the freed slot with no signal | PRE_EXISTING (documented decision), D4 |
| A26-S07-02 for loan accounts mis-prices installments | `datedLoanDebt` reads `ACCOUNT_BALANCE_AS_OF_SQL` (opening balance + ledger), never `current_balance` | a restored stale `current_balance` cannot reach pricing; the loan-specific damage of the same undo function is A26-S15-01 | REJECTED for pricing; superseded by A26-S15-01 for the loan columns |
| GEM converts prices before computing momentum | `docs/gem-strategy.md:311-312`, `gem-report.types.ts:262-268` | native-currency momentum is the documented design; the hint's "converted prices" is not the contract | DESIGN_RISK (D6) |
| GEM position valuation uses rate 1 for a missing rate | `gem-position.service.ts:356-385` (sweep, read) | 1 only for the same currency; a missing rate is null; `getLatestRate(..., 14)` is a listed exception in `fx-rate.one-door.spec.ts` (INV-FX-001 partial, S13's) | REJECTED (S13 owns the FX door) |
| GEM incomplete signal fires an alert | sweep Q3 | RISK_OFF without EM is documented and tested; the real alert defect is the period binding (A26-S15-07) | REJECTED |
| Rate-change sync applies something other than its preview | `applyScheduledPaymentSync` re-plans in its own transaction (`loan-rate-changes.service.ts:319-330`) | the plan is one function for both; a ledger move between preview and confirm changes the applied figure, and the response returns what was applied; no expectation is passed down | DESIGN_RISK (D7) |
| Two loans sharing one interest category merge on the SPLIT path | sweep probe F | real, but it is the index's own known gap widened, not a new mechanism | documentation (section 11, D-2) |
| Lump sum on a non-amortizing loan yields no projection (frontend probe I) | `loan-schedule.ts:451-455` refuses before lump sums apply | the refusal is INV-LOAN-004's "-1 when the installment never amortizes"; a plan that would rescue it is an edge of the projection, not a wrong figure | DESIGN_RISK (D8) |
| Same-day multiple payments double count interest in history | sweep probe D: each date's interest used once | no double count; attribution depends on API order (same-date rows) | DESIGN_RISK (D9) |

#### S16 (`16-budgets-reports.md` section 8)

| Candidate | Evidence considered | Why rejected or downgraded | Final classification |
| --- | --- | --- | --- |
| Budgets net across categories | `GROUP BY category_id`, clamp per line | netting is within one category | REJECTED |
| Budgets need `investmentExclusionSql` | generated cash legs carry no category; embedded investment splits have `category_id NULL` | selection by `category_id` cannot reach them | REJECTED |
| Period close race between replicas | `pessimistic_write` on the OPEN row, `NoOpenPeriodError` skip, per-owner claim; `budget-period-rollover.integration.spec.ts` passed | holds | REJECTED |
| Nested `withScopedDb` in `computePeriodActuals` splits the snapshot | nested calls join the ambient transaction (AGENTS) | same transaction | REJECTED |
| Alert email resent after a crash between send and `markEmailSent` | the row exists, the next run dedups on it | at most one email | REJECTED |
| `computeActualIncome` `Promise.all` over two `withScopedDb` | each opens its own top-level transaction (no ambient one in a request) | two snapshots, not one connection's queue; a cosmetic snapshot skew only | DESIGN_RISK (section 9) |
| A26-S07-04 unequal transfer legs mis-state budget transfer lines | builders read the outgoing leg (`amount < 0`) only | the line counts the source leg, which is what left the budgeted account | REJECTED for budgets |
| Capital-gains report surface of A26-S12-04 | `RealizedGainsReport.tsx`, `DividendIncomeReport.tsx` (capital gains), `InvestmentDetailView.tsx`, AI `tool-executor.service.ts`, MCP `investments.tool.ts` | consumers read the server figure; the defect is S12's root, no separate report-side defect found; both components return early on error, so exports are not reachable on a failed load | handed back (surface list only) |

#### S17 (`17-ai-mcp-notifications.md` section 8)

| Candidate | Evidence considered | Why rejected or downgraded | Final classification |
| --- | --- | --- | --- |
| An MCP agent or the assistant claims a request under `EMAIL_RECEIPTS_CLAIM_KEY` (S11 hand-off) | P1; `callerKey` (`mcp-context.ts:101-105`); claim SQL `status = 'pending'` (`ai-review-requests.service.ts:690-742`) | no caller key can equal the literal; `email_trade` requests are never pending | REJECTED |
| MCP/PAT bearer verifiers accept `step_up` / `oidc_reauth` JWTs (A26-S03-03) | `validatePat`, `validateAccessToken`, opaque token format | the MCP verifiers are store lookups, not JWT verifies | REJECTED (the cookie/Authorization path stays A26-S03-03's) |
| MCP sessions keep creation-time scopes (MON-M04) | section 5 | fixed by mechanism; only the test is missing | FIXED_VERIFIED + A26-S17-05 |
| A tool wired into one layer only | parity matrix (section 2) | `render_chart` (presentation, no data), `enter_bond_series_manually` (documented admin fallback), relay tools, `list_transaction_rules` folded into `manage_transaction_rules` (documented) | REJECTED |
| A notify caller runs inside an outer transaction, so the push fans out for a row that can roll back (S08 hand-off) | all 16 `.notify(` callers; `balance-threshold-alert.service.ts:69-96` commits the latch first by design | no caller nests `notify` in a `withScopedDb` | REJECTED |
| A read-path producer (bill reminders on `GET /notifications`) duplicates rows and pushes under two concurrent reads | `budgets.service.ts:714-826`: dedupe key `BILL_DUE:<bill>:<originalDate>`, `ON CONFLICT DO NOTHING`, `null` fans out nothing | the database arbitrates | REJECTED |
| An AI/MCP write skips the HTTP refusals (VOID, currency, ownership, reconciled lock) | refusals live in `TransactionsService` and the transfer/investment services; controllers add only joint-register routing | the adapters call the same service methods; the AI executors also re-run class-validator (`toValidatedDto`) | REJECTED (the MCP direct commits skip `toValidatedDto`, but their DTOs are built from server previews, not from model input; noted in section 9) |
| AI/MCP `get_capital_gains` (S12 hand-off A26-S12-04) | `getLlmCapitalGains` is the shared door; nulls carried | same root cause as A26-S12-04 | consolidated under A26-S12-04 (Rule 7) |
| AI/MCP edit card shows no rate (S12 hand-off A26-S12-03) | `investments.tool.ts:1245-1287` card lines (no rate line); frontend `TransactionConfirmationCard.tsx` (no `exchangeRate`) | confirmed surface of the same root cause | consolidated under A26-S12-03 (Rule 7) |
| AI/MCP account summary drops completeness flags (S13 hand-off A26-S13-04) | `tool-executor.service.ts:2433` summary line; `getLlmAccounts` totals | confirmed surface | consolidated under A26-S13-04 (Rule 7) |
| `updates.service` window equal to its 12-hour period (S08 hand-off) | `updates.service.ts:28, 130, 298-312` | real (a tick can find the window not yet elapsed by milliseconds, so the effective cadence is up to 24 h) but the impact is an update notice up to 12 hours late: fails the Rule 1 materiality gate | REJECTED as a finding; documentation inconsistency in section 11 |
| A post-commit failure of `ScheduledTransactionsService.post` lets an AI trade card post twice (S08 hand-off on A26-S08-02) | `ai-actions.service.ts:1142-1185`: the signed `scheduledDueDate` is checked inside `post()`; `confirm` runs no outer transaction (`:211-223`) | a replay is refused by the moved due date | REJECTED |
| The relay routes a direct client's write into an unwatched web chat | `emitRelayCard`, `findSessionTurn` scoped to the caller's own claim, `reportToolActivity` scoped to the caller's session (`ai-relay.service.ts:419-495`) | caller-scoped since the documented fix; `mcp-relay-confirm.spec.ts` green | REJECTED |
| The MCP daily write cap can be exceeded by concurrent calls | `McpWriteLimiter.reserve` is a read, `record` after the write | real overshoot by the number of concurrent calls; the cap is a soft abuse bound and every write is still human-confirmed | DESIGN_RISK (D2) |

#### S18 (`18-frontend-core.md` section 8)

| Candidate | Evidence considered | Why rejected or downgraded | Final classification |
| --- | --- | --- | --- |
| A rate is rounded as money somewhere in `lib/` | grep of `roundMoney`/`roundToCents`/`toFixed` beside a rate across `src/` | every hit rounds an amount (`amount * rate`), not the rate; `roundFxRate` uses 10 dp; display uses `FX_RATE_DISPLAY_DECIMALS`; two `toFixed(FX_RATE_DISPLAY_DECIMALS)` displays (`CurrencyList.tsx:160-161`, `CurrencyExposureReport.tsx:175`) are unlocalized, a component issue | REJECTED for lib; locale half handed to S20 |
| `forecast.ts` selects investment schedules by the brokerage `accountId` (sweep claim) | `forecast.ts:607, 805, 977` normalise every schedule onto its settlement account before `scheduledFlowsForAccount` | the remap precedes selection | REJECTED |
| `useExchangeRates.convert` returns 1:1 or the input on a missing pair | `useExchangeRates.ts:83-101` returns `null`; `getRate` `null` | holds; `ratesUnavailable` distinguishes loading/failed | REJECTED |
| A share bundle can be read by another account (INV-SHARE-005) | `share-inbox.ts:85-102, 153-183, 246-283`: claim on list and read, `isVisibleTo` filter, `viewerUserId` required | holds; `discardSharedBundle(id)` takes no owner, so another account holding the random id could delete (not read) a bundle: no realistic path, ids come from the owner's own URL | REJECTED (note only) |
| Logout retry cannot succeed after the access token expires | `auth.controller.ts:1335-1354` is public, revokes by the refresh cookie | holds | REJECTED |
| The 401 interceptor loops or double-redirects during a user sign-out | `isSigningOut()` gate (`api.ts:193`), `beginSignOut` before any await (`AppHeader.tsx:255`) | holds | REJECTED |
| `budgets:dashboard` misses transaction writes (MON-M38 as filed) | prefix in `invalidateBalanceCaches`, mutation M1 killed | fixed | REJECTED for the original paths (residual is A26-S18-01) |
| Decimal strings typed `number` produce a wrong figure in `lib/` | sampled readers coerce (`investmentFold.ts:27-31`, `security-detail.ts:81-84`, `sumMoney` multiplies) | no concrete failing reader found in `lib/` | DESIGN_RISK (section 9) |
| `MnyImportJob` failure with `errorKey: null` shows "Nothing was saved" wrongly | backend always sets a key on failure | the `null` branch is unreachable; the reachable case is the generic key after commit (A26-S18-05) | merged into A26-S18-05 |
| The persisted AI chat (`localStorage`) leaks across accounts | `authStore.logout` removes `monize:ai-chat-messages` on every logout path (user, 401, rehydrate failure, PWA resume) | holds; still readable by XSS while signed in, which the guard records as a reviewed decision | REJECTED |

#### S19 (`19-frontend-forms.md` section 8)

| Candidate | Evidence considered | Why rejected or downgraded | Final classification |
| --- | --- | --- | --- |
| The Post dialog replaces a schedule's saved price with the latest close | `PostTransactionDialog.tsx:598-618`; `docs/frontend/financial-figures.md:55-57` | Deliberate: only a per-occurrence override's price is protected in the Post dialog; posting at today's market is documented. The general sentence reads wider than the exception (section 11) | REJECTED (documented exception, Rule 2) |
| `nextOverride?.amount ?? amount` in the Post dialog violates INV-OCCURRENCE-003 | guard allowlist `:54-63`; the foreign and loan branches | Allowed on the write path; the loan consequence is A26-S15-09 | REJECTED (deliberate) |
| A same-currency investment trade can be sent with a non-1 rate (S12) | `:625-631`, `:1693` | The field is hidden and forced to 1 | REJECTED |
| The split editor rewrites a valid 4dp split on open (the upstream MON-M37 wording) | `toSplitRows` keeps `Number(split.amount)` (`SplitEditor.tsx:1094`) | The lines are kept exactly; the loss is the parent's load and the blur (A26-S19-03) | REJECTED in that form; root moved |
| A date field set by `setValue` leaves the visible box stale | 15 `setValue('<x>Date'` sites | All are `DateInput` `onDateChange` handlers | REJECTED |
| The delete-data reauth artifact is not bound to the chosen options | `DangerZoneSection.tsx:117-141` | The artifact is purpose-bound (`delete-data`); the options reset to the least destructive defaults after the round trip; the server owns the binding (S03) | DESIGN RISK (section 9) |
| `LoanPaymentSetupDialog.tsx:624` renders a literal 0 | React renders `0 && ...` as `0` | Cosmetic, no value written | REJECTED (cosmetic) |
| The rules editor serializes an empty range bound as 0 | `RuleValueControl.tsx:210-235` | `undefined` serializes as `null` in a JSON array, not 0 | REJECTED |
| Duplicating a transaction dates it with the browser's local day rather than the financial today | `TransactionForm.tsx:336` `getLocalDateString()` | Plausible off-by-one for a user whose timezone preference differs from the browser near midnight; not traced to a wrong posting | DESIGN RISK (section 9) |

#### S20 (`20-frontend-figures.md` section 8)

| Candidate | Evidence considered | Why rejected or downgraded | Final classification |
| --- | --- | --- | --- |
| A26-S17-01 reaches the transactions page summary as a mixed-currency scalar | `TransactionSummary.byCurrency` producer `transaction-analytics.service.ts:437-495`; consumers `PayeeInfoWidget`, `CategoryInfoWidget`, `app/categories/[id]/page.tsx`, `app/payees/[id]/page.tsx` | every HTTP consumer goes through `buildDisplayCurrencyStrategy` / `summarizeInDisplayCurrency` (`components/transactions/widget-shared.ts:36-110`), which converts per bucket and marks a missing rate with `PartialTotal`; no component reads the scalar `totalIncome` of a multi-currency summary | REJECTED for the UI; design note: the client converts at today's rate, not each row's (INV-FX-002), D-S20-01 |
| Debt Payoff Timeline exports while one of its four requests failed (S16 hand-off) | `DebtPayoffTimelineReport.tsx:137-251, 636-640` | combined `isLoading` / `error` early return; the toolbar is not mounted | REJECTED |
| Budget reports export on a failed secondary request | `BudgetVsActualReport.tsx:188-225, 320-324` and siblings | combined early return | REJECTED |
| Cash Flow Sankey PDF has no partial caption (S16 hand-off) | `CashFlowSankeyReport.tsx:216` | partial cards carry a `*`; the PDF has no legend for it, which is A26-S16-04's "`exportToPdf` cannot express a partial figure" | CONFIRMED under A26-S16-04 (not re-counted) |
| `exportToPdf` partial caption across every `PartialTotal` report (S16 hand-off) | PDF cards of AccountBalances, CreditUtilization, SecurityTypeAllocation (suffix present), DividendYieldGrowth (`:523-525`, no marker), Geographic (A26-S20-05), IncomeVsExpenses and SpendingByCategory (A26-S16-04) | DividendYieldGrowth's three cards are the only new instance and share A26-S16-04's root (no partial field in `pdf-export.ts`) | CONFIRMED under A26-S16-04 (surface added) |
| A26-S15-08 (Loan Amortization exports on error; Original Amount) | `LoanAmortizationReport.tsx:429-440, 497-511` | unchanged at the baseline; no new surface | CONFIRMED, stays A26-S15-08 |
| A26-S15-03 / -05 in the report UI | `LoanAmortizationReport` reads `deriveLoanPaymentHistory`, the one derivation | the UI renders the derivation; the defect is in `lib/loan-history.ts` as S15 reported | CONFIRMED, stays S15's |
| S14: the intraday path values a linked security at the ledger close and drops bond holdings in the no-ledger branch | `portfolio.service.ts:2276-2310, 2420, 2574-2603`: holdings with `fetchIntraday` false are neither `intradayHoldings` nor `closeValued` when `ledger` is null, and a failed holding with no close is skipped (`if (lastClose == null) continue`) | traced to the figures: `InvestmentValueChart` and `PortfolioValueReport` intraday lines and their Highest / Lowest; the intraday response type (`lib/investments.ts:239-266`) carries no completeness flag, so no frontend fix exists without a server flag | DESIGN_RISK on the frontend; the server root stays with A26-S14-01 (consolidate in S23) |
| Period change shown as a return | `NetWorthReport` "Change %" (net worth over its first month), `PortfolioValueWidget`, `InvestmentValueChart`, `PortfolioValueReport` | the investment surfaces read the server's `investmentPnl` / `investmentReturnPercent`; net worth's "Change %" is captioned as a change, not a return | REJECTED |
| Cash folded into an invested figure | `PortfolioValueWidget.tsx:117, 149` | the sparkline plots `investedValue`; the header prints `totalPortfolioValue` (holdings plus cash) under the widget's "Portfolio Value" title, a value, not a result | REJECTED (caption issue only; see D-S20-03) |
| Hand-edited pseudo-locale, catalog parity | `npm run i18n:check` pass; `src/i18n` parity suites pass | no drift | REJECTED |
| S10: the bank-sync preview UI does not disclose structural rule effects | not read in this session (budget) | handed on | open, to S23 |

#### S21 (`21-tests-ci-release.md` section 8)

| Candidate | Evidence considered | Why rejected or downgraded | Final classification |
| --- | --- | --- | --- |
| `check-env-docs.mjs` misses env reads | ran it (OK, 81 vars); a wider scan for `getOrThrow`, other receivers, `env.X`, `env["X"]` found only ignored or non-env names (`US_EQUITY` is a GEM asset key) | no undocumented variable found | REJECTED |
| Integration runner passes on zero suites | Jest exits 1 (S02 executed); guard re-read | holds | REJECTED (MON-M44 fixed) |
| Vitest passes on zero tests | Vitest 5 default `passWithNoTests: false`; no override in `vitest.config.ts` | holds | REJECTED |
| Guards in `backend/src` silently skip in CI | 15 specs use `REPO_ROOT \|\| process.env.CI ? describe : describe.skip`; CI sets `CI=true` | they run in CI; they skip only outside a checkout without `CI` | REJECTED |
| Helm default disables a protection | default render: `readOnlyRootFilesystem`, `runAsNonRoot`, `seccompProfile: RuntimeDefault`, drop ALL, `podSecurityEnforce: restricted`; the chart refuses two replicas at `single`, a selector-less spread, a zero-disruption budget (CI-tested) | no protection disabled by default | REJECTED |
| `zizmor ... \|\| true` hides workflow findings | SARIF is uploaded to code scanning; not a gate by design | visibility choice, documented in the job | DESIGN_RISK (not listed) |
| Unconfirmed known-wrong tests 2-4 still present | override price: `PostTransactionDialog.test.tsx:1426`, `OverrideEditorDialog.test.tsx:698` assert the override is kept; logout: `AppHeader.test.tsx:204` "does not claim success when authApi.logout fails", `auth.controller.spec.ts:1099`; backup naming: no filename assertion found, the located backup known-wrong tests are the cross-owner sweep (A26-S06-01) | corrected or replaced | REJECTED (items 2, 3); item 4 superseded by A26-S06-01's tests; item 1 CONFIRMED (section 10) |
| `net-worth.service.spec.ts:1961` "returns amount unconverted when no rate exists" is known-wrong | the body asserts the gap (comment "NOT applied as 1:1 (audit P5-009)") | the title is stale, the assertion is right | REJECTED (doc nit, section 11) |
| Entity numeric transformers excluded from coverage hide a defect | 31 entity files define local transformers; mutation `investment-transaction.entity.ts:22-26` `null -> 0` run against 8 investment integration suites | killed: `security-transfer.integration.spec.ts` fails (`Received: 0`), 69 others pass | REJECTED (held at integration) |
| `frontend/src/proxy.ts` (CSP nonce, auth redirect, API proxy) excluded from coverage hides an untested file | coverage measured with the exclusion removed, its five test files only | 97.05 % statements, 95.16 % branches, 100 % functions | REJECTED (the exclusion is unexplained but hides nothing today) |

#### S22 (`22-delta-review.md` section 8)

| Candidate | Evidence considered | Why rejected or downgraded | Final classification |
| --- | --- | --- | --- |
| `main` moved after the program pinned it | `git ls-remote`, `git fetch`, GitHub `list_commits`; tree hash | all equal to the baseline | REJECTED |
| The audit branch carries a code change beyond `docs/audits/` | pin check from the repository root: empty | a first run from `docs/audits/2026-10/` listed the audit reports only because the exclusion pathspecs resolve against the working directory; re-run from the root is empty | REJECTED (operator error, recorded) |
| A HIGH could be fixed or worsened by the delta | 0-byte delta | no hunk exists | REJECTED for all 18 HIGH |
| Integration suites skip silently against the container database | 238 + 60 integration tests reported passed, 0 skipped; the `pretest:integration` hook created `monize_test` | the suites ran against PostgreSQL | REJECTED |
| The fork's last hosted `ci.yml` run on `main` (run 253 on `0d99f8f`, 2026-10-16, conclusion `failure`) means `main` is red | job list: every test job `success`; only `Build & Push Preview (backend/frontend)` failed; `0d99f8f` is not in the local clone of `main`'s history (ancestry not established) | a preview-image push failure on an older, possibly non-ancestor commit says nothing about `72c59ec4`'s tests | DESIGN_RISK for S21 (hosted CI on this fork does not track `main`); not a delta finding |

## Appendix B. Known-wrong tests and missing tests

### B.1 Known-wrong test register (from `21-tests-ci-release.md` section 10.1)

| Test (path:line) | Asserts | Protects defect | Owner finding | Found by |
| --- | --- | --- | --- | --- |
| `backend/src/built-in-reports/report-currency.service.spec.ts:213-218` "returns original amount when no rate is available" (and the inverse-zero case near `:247`) | 1000 JPY with no rate -> `toBe(1000)` in USD | the 1:1 fallback of `convertAmount` (`report-currency.service.ts:113-118`), used by seven built-in report services | A26-S02-02 / A26-S13-01 (MON-H12, MON-M39) | S02, S13; re-located here: **this is `docs/verification-contract.md` section 5's unconfirmed item 1** |
| `backend/src/backup/auto-backup.service.spec.ts:3870/3871`, `:3907` "counts files left flat in the base folder by an older version" | the cross-owner legacy sweep | A26-S06-01 | A26-S06-01, MON-M43 | S02, S06 |
| `backend/src/auth/token.service.spec.ts:323` (replay detection), `:387` (user not found), `:408` (user inactive) | that `manager.update` was called, true while the revocation is rolled back | A26-S03-01 | A26-S03-01 | S03 |
| `backend/src/securities/investment-transactions.service.spec.ts:5120` "converts cash amount using the latest market rate when currencies differ", and five sibling cases S12 M11 names but does not list | stub `getRateForDate` to null and `getLatestRate` to the answer | the `getLatestRate` fallback, `investment-transactions.service.ts:789-792` | A26-S12-02 | S12 |
| `backend/src/delegation/rls-context-smoke.spec.ts` (S04 D-S04-05) | "authorization under the caller, then bypass" order | A26-S04-01 | A26-S04-01 | S04 |
| `backend/test/integration/backup-store-s3.integration.spec.ts:160-185` | unpadded day names, its own pruning wrong; never runs in CI | test defect | A26-S06-02 | S06 |
| `backend/src/users/users.service.spec.ts:148` | mocks `ensureSystemCurrency`, so write-before-ensure passes | A26-S13-05 | A26-S13-05 | S13 |
| `backend/src/transactions/transaction-bulk-update.service.spec.ts:2592-2643` | only that `updateBalance` was called | A26-S13-03 | A26-S13-03 | S13 |
| `frontend/src/lib/loan-history.test.ts:2058` | the overpayment-takes-the-interest variant of a same-day pair | order dependence (D9) | -- | S15 |
| `backend/src/ai/query/tool-executor.service.spec.ts:1345-1351`, `backend/src/mcp/tools/reports.tool.spec.ts:220-246` | `getSpendingAnomalies(userId, months)` | months passed as the z-score threshold | A26-S17-03 | S17 |

The four "reported but not located" items of `docs/verification-contract.md` section 5: item 1 located (row 1); items 2 and 3 corrected (section 8); item 4 superseded by the A26-S06-01 tests.

### B.2 Missing tests per session (section 10 of each report, verbatim)

#### S01 (`01-baseline.md` section 10)

- Missing: a guard that CI lint steps do not auto-fix (A26-S01-01).
- Missing: a lint-config test that every spelling of a `with-context` import and a direct `requestContextStorage.run` is flagged outside the allowlist (A26-S01-02).
- Missing: a code-level check that each `@Cron` handler calls the mechanism its doc row names (DR-S01-2, M5).
- Missing (INV-CRON-001, recorded `partial`): two-instance tests per job; only the MNY job has one.
- Unstable test (observed): `test/integration/ofx-import-fitid.integration.spec.ts` failed in the full integration run with `deadlock detected` inside `cleanTables` (`test/helpers/integration-setup.ts:272`) and passed 10/10 alone. `cleanTables` already settles pending price writes and pending history writes before its `TRUNCATE ... CASCADE` (`:255-271`), so a third kind of un-awaited post-request write from an earlier suite (candidates: post-commit recompute dispatch, notification or provider-health writes) still runs into the next suite's truncate. Not root-caused here; handed to S21. If the same writer exists in production, it is a write that outlives its request, which `docs/external-side-effects.md` and INV-CACHE-001 govern (S07).
- Known-wrong: none found in the slice. `docs/verification-contract.md` s5 is S02's.

#### S02 (`02-prior-high-triage.md` section 10)

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

#### S03 (`03-security-auth.md` section 10)

- INV-AUTH-001's required two-connection rotation test does not exist (`test/integration/` has no refresh-rotation suite; only `logout-revoke-failpoint`). A26-S03-04.
- INV-CLAIM-001's two-connection test is listed as "still owed" and is still missing; the only protection is a SQL-text unit assertion. A26-S03-04.
- No test drives `AuthService.login` against a real database; `auth.service.spec.ts` mocks `save`, which is how A26-S03-02 stays green.
- No test covers the three blanket-revoke paths under a concurrent rotation (A26-S03-07).
- Known-wrong (asserts current defect as correct): `token.service.spec.ts` "should revoke entire family and throw when token is already revoked (replay detection)" asserts that `manager.update` was called, which is true while the revocation is rolled back (A26-S03-01). Same for the "user is not found" and "user is inactive" cases.
- INV-AUTH-005's own "still owed" item (a real-database test that a PAT minted before a reset is refused after it) is still missing.

#### S04 (`04-rls-tenancy.md` section 10)

- No service-level test under the unprivileged role for delegation management (create, link, reset, capability and section setters, revoke), joint-account writes, or cross-owner transfers (A26-S04-04). 23 of 101 integration files use `createEnforcedIntegrationModule`; none of these.
- No concurrency test for revoke versus any in-flight delegation or grantee write (A26-S04-01, -02).
- No negative test that a delegate session cannot insert into `account_delegates` / `account_delegate_grants` (A26-S04-03); `rls-enforcement` asserts "keeps WITH CHECK owner-only" only for the widened data tables.
- `rls-context-smoke.spec.ts` asserts the order "authorization under the caller, then bypass" as correct; it is a test of the shape that lets a revoke slip between the two (known-wrong in the sense of `docs/verification-contract.md`: it would fail on the fix for A26-S04-01 unless updated).
- MON-M06's enforcement behaviour is protected only by `rls-context-smoke.spec.ts` (a unit test recording identities around mocked repositories), not by a real-role run.

#### S05 (`05-migrations-schema.md` section 10)

- No repository test races two real `runMigrations()`/`initDatabase()` processes; MON-L02's fix is held by mock-order unit specs (`db-init.spec.ts`, `db-migrate.spec.ts`) and the lock-primitive test `demo-seed-lock.integration.spec.ts`. The audit's script (`zz-audit-migrate-race`) is the shape such a test would take.
- No guard for unique-key or CHECK parity between entities and `schema.sql` (A26-S05-01).
- No integration test of `BudgetPeriodService.createPeriodForBudget` concurrency; impossible today without the key (A26-S05-01).
- `verify-schema.sh` dumps with `--no-privileges` and `--no-comments`, so function ACLs (`REVOKE EXECUTE ... FROM PUBLIC` on SECURITY DEFINER functions) and comments are outside the drift job; it also runs on an empty database, so no data backfill in the 56 migrations is exercised by it (the per-migration specs `mortgage-type-backfill`, `migration-149-backfill`, `migration-140-preflight` cover three).
- No lint for contract-without-expand (A26-S05-02; the documentation states this).
- No known-wrong test found in the slice.

#### S06 (`06-backup-restore.md` section 10)

- Known-wrong: `backend/src/backup/auto-backup.service.spec.ts:3870`, `:3907` (assert the cross-owner legacy sweep; A26-S06-01).
- Known-wrong and never run: `backend/test/integration/backup-store-s3.integration.spec.ts:160-185` (unpadded day names; A26-S06-02).
- Missing: local/S3 restore round trip (A26-S06-05, MON-M47).
- Missing: Phase-3 owner predicate (A26-S06-06, M4).
- Missing: restore staging crash/discard-failure leaves an enumerable intent (A26-S06-03, R4).
- Missing: post-commit throw must not discard committed bytes (section 9, M2/R5).
- Missing: two-connection test of the off-machine lease reclamation (INV-BACKUP-005 owed, unchanged).
- Missing: two-connection attachment cap race at count 9 (MON-L05, mechanism present).

#### S07 (`07-cash-ledger.md` section 10)

Known-wrong: none found in the slice.

Missing:
- Two-connection tests for the split-leg and cross-owner transfer edits, bulk VOID expansion, `addSplit`, close versus un-void, `updateTransfer` with different amounts (A26-S07-01, -03, -09).
- An undo-after-unrecorded-posting test for account edits (A26-S07-02).
- A refusal test for `PATCH /transactions/:id` on a transfer leg (A26-S07-04).
- Reconciled-lock cases for the split-leg and cross-owner branches (A26-S07-05).
- Close with a pending future-dated row (A26-S07-06); linked-half save race (A26-S07-07).
- `transfers.integration.spec.ts` still proves only a client-supplied rate (S02's item, unchanged).

#### S08 (`08-scheduler-cron.md` section 10)

- No integration test of the real `post()`, the auto-post cron or `skip()` (A26-S08-05).
- No real-database test of `claimLease` expiry, the delivered-row exclusion, or the stale holder's `markDelivered` (M5-M7).
- No test of a rule claim ahead of the cursor followed by a post (A26-S08-03).
- No test asserting the HTTP routes carry an occurrence pin (A26-S08-01).
- Known-wrong: none found in the slice.

#### S09 (`09-import-mny.md` section 10)

- No test throws from the job body after `markDataCommitted` committed (A26-S09-02; M2 undetected).
- The reaper's committed branch is held only by SQL-text assertions on a mocked `manager.query` (M1).
- The sweep's active-job exclusion is held only by a SQL-text unit assertion (M4).
- No two-connection test of sweep or superseded-drop versus job creation (A26-S09-04).
- No cross-currency case for the synthesized sleeve counterpart (A26-S09-03).
- `mny-import.integration.spec.ts` "imports the file's rows once, not twice" runs on `money2008`, which writes 0 rows to `transactions` (3 investment rows): its `transactions` count assertion is `0 === 0` and cannot see a duplicate; the balance loop checks two zero-balance accounts. The race is in fact held by the job-count test beside it; this one is weaker than its name.
- No test for a category or payee collision on the MNY writers (A26-S09-05).
- No DTO test refusing a non-ISO `currencyOverride`, and no test that an import leaves other users' currency lists unchanged (A26-S09-06).
- `e2e/tests/import-mny.spec.ts` covers the happy path, the password prompt and a non-Money file; nothing drives the failed-job screen or its copy.

#### S10 (`10-rules-banksync-csv.md` section 10)

- No test syncs a reference repeated across two fetches (A26-S10-01; M5).
- No import test covers a cross-currency split transfer (A26-S10-02; M6).
- No two-connection test for `AccountsService.delete` against a writer (A26-S10-03; M7).
- No test deletes a rule that has an open review request (A26-S10-04; M8).
- No test of a 4 dp QIF opening balance or of the opening balance under a concurrent delta (A26-S10-05).
- No known-wrong test found in the slice.

#### S11 (`11-email-receipts.md` section 10)

- No test enters the lease-overrun path: `email-receipt-poll.service.spec.ts` mocks `JobClaimService`; P2 (section 12) is the missing integration case (A26-S11-01).
- No price-only trade test with a price above 4 decimals (A26-S11-02); `parse-trade.spec.ts:139-170` covers 3 and 4 decimals and the cross-check only.
- No integration test for a trade email end to end (INV-RECEIPT-008 says so itself); P3 is the first run of the trade path against PostgreSQL, through the real poll, pipeline, card and confirm.
- No test of a forwarded header block in an email from an address that is not the mailbox owner's (the forward fixtures all come from the owner, `forwarded-receipt.spec.ts`), which is why A26-S11-04 is undetected.
- No test that a trade card's preview makes no provider call inside the pipeline's transaction (A26-S11-03).
- INV-RECEIPT-006 "Present: rls-context-smoke.spec.ts (real lease)": that spec claims and releases; it does not show that a second poll is refused while the first runs, and nothing tests the lease against the work it guards.
- The mutation rows marked `undetected` in section 6 are test-coverage findings.
- Known-wrong tests: none found in the slice.

#### S12 (`12-securities-holdings.md` section 10)

Known-wrong (assert a defect and pass): `investment-transactions.service.spec.ts` "converts cash amount using the latest market rate when currencies differ", and with it the five other unit cases M11 names (they stub `getRateForDate` to null and `getLatestRate` to the answer), which hold the A26-S12-02 fallback in place.

Missing:
- No two-connection test for `update()` or `remove()` of an investment row (A26-S12-01); the lock in `update()` is held only by a mock-order unit case (M10, M10i).
- No integration test of a transfer's carried basis (M12i), of a back-dated transfer (A26-S12-05) or of a transfer edit that changes date or quantity.
- No test pins the 0.0001 snap either way (M13; A26-S12-06).
- No realized-gain test after a cross-currency transfer (A26-S12-04); the lots replay has one.
- No test that the AI/MCP edit keeps the stored rate (A26-S12-03).
- No two-currency Money fixture for investment rows (A26-S12-09, shared with S09).
- No undo test comparing the undo rebuild with `findLedgerDiscrepancies` (A26-S12-10).

#### S13 (`13-valuation-fx-networth.md` section 10)

Known-wrong (assert a defect and pass):
- `backend/src/built-in-reports/report-currency.service.spec.ts:213` and the inverse-zero case (MON-M39, A26-S13-01).
- `backend/src/users/users.service.spec.ts:148` mocks `ensureSystemCurrency`, so the write-before-ensure order of A26-S13-05 passes.
- `backend/src/transactions/transaction-bulk-update.service.spec.ts:2592-2643` (split-transfer bulk delete) asserts only that `updateBalance` was called; it cannot see A26-S13-03.

Missing:
- No `net-worth*`, `currenc*` or `exchange*` integration suite exists, though the session plan names them; net worth, `CurrenciesService.remove` end to end, the rate table's two orientations and `getLatestRates` are covered only by mocks (M3, M3b, M6 detected by mocks alone).
- The entity-built integration harness lacks the schema's `ON DELETE` actions on the `transactions` and `transaction_splits` FKs and lacks `user_preferences.default_currency -> currencies(code)`: a bulk-delete case fails in the harness for a reason production does not have, and A26-S13-05 cannot be seen at all (joins A26-S05-01's harness-parity gap; S21).
- No test of a selected split-transfer leg, a cross-owner leg or a split parent with embedded investment lines in `bulkDelete`.
- No test of `getLatestRates` / the client `convert` with both orientations present (A26-S13-02); no frontend test of a stale rate.
- No portfolio test for a currency with neither a time series nor a spot rate (M4, A26-S02-11).
- No reverse-split case in `net-worth.service.spec.ts` (MON-M41 residual).
- No completeness assertion on `/accounts/summary`, `getLlmAccounts`, `month_comparison` or `getAccountMarketValues` (A26-S13-04).

#### S14 (`14-bonds.md` section 10)

- No test values a bond-linked security in net worth on a day the engine left without a row (A26-S14-01); `bond-holding-value.integration.spec.ts` covers the routed surfaces only.
- No test of the per-account value of a linked security on Monte Carlo holding stats, the investment report or net worth by account (A26-S14-02).
- No test that a benchmark store is followed by a recompute (A26-S14-03).
- Coverage-forward-only (M6) is held by an SQL-text unit assertion only; no integration test stores an archive-behind NBP fetch after a newer one.
- No known-wrong test found in the slice.

#### S15 (`15-loans-strategies.md` section 10)

- No integration test runs the real `post()` for any loan matrix row (the harness stubs the scheduled module; `scheduled-loan-pricing-concurrency.integration.spec.ts:36-46` says so); the `zz-s15-probe` construction is the recipe (joins A26-S08-05 / MON-M46).
- No real-database case of a settlement claim stepping past a consecutive claimed slot (M3 survives every integration suite).
- No test of an account-edit undo on a loan (A26-S15-01), of the below-interest shortfall (A26-S15-04), of a 0.01 debt (A26-S15-06).
- GEM: no case with a role's feed gap before the boundary (A26-S15-02); the alert's `run`/`evaluateUser`/`evaluateStrategy` and spec test-matrix items 5-8 are untested (A26-S15-07); `latestPrices` with a stored close of 0 (the sweep: valued at 0 rather than unknown, LOW, not raised as a finding here because every valuer in the app shares it; S12/S13).
- Frontend loan history: VOID payment and VOID interest, refund rows paired and orphan, future-dated payment against the projection, a shared category across two loans in one parent, an exact split plus a paired standalone expense on one date (the expense is silently dropped, sweep probe E: 200 shown, 215 booked), export while `historyError` is set, Original Amount with an unset opening balance.
- No test of a loan payment setup with a source account in another currency (A26-S15-10).
- Known-wrong: `loan-history.test.ts:2058` pins the overpayment-takes-the-interest variant of a same-day pair (D9), which is order-dependent.

#### S16 (`16-budgets-reports.md` section 10)

- No integration test for rollover on a real close; the unit fixtures hydrate `budgetCategory` by hand (`budget-period-lifecycle.spec.ts:405-453`, `budget-period.service.spec.ts:98`): fixture cleaner than production (A26-S16-03).
- No race test for the alert fingerprint or the period insert; neither key exists in the harness schema (A26-S16-09).
- No VOID case for category actuals (mutation M5).
- No multi-currency budget test (A26-S16-01); no wizard exclusion test past the component (A26-S16-02).
- No component test for Cash Flow with `null` totals; no PDF test asserting a partial caption (A26-S16-04).
- No custom report test with a refund or two currencies (A26-S16-05, -06).

#### S17 (`17-ai-mcp-notifications.md` section 10)

- Known-wrong: `ai/query/tool-executor.service.spec.ts:1345-1351` and `mcp/tools/reports.tool.spec.ts:220-246` assert `getSpendingAnomalies(userId, months)` (A26-S17-03).
- Missing: an existing 2025-era session served a narrowed same-credential token's scopes (A26-S17-05, M2).
- Missing: a post-commit failure in `AiActionsService.confirm` keeps the claim (A26-S17-02, P2).
- Missing: any multi-currency case for `getSummary`, `getLlmPeriodComparison`, `getLlmInvestmentTransactions` (A26-S17-01, P3).
- Missing: a relation test between `CHART_TOKEN_TTL_MS` and `PUSH_TTL_SECONDS` (A26-S17-04).
- Missing: a two-connection test of the dispatch advisory lock (INV-DISPATCH-003 is held only by mock-order unit assertions, M3).

#### S18 (`18-frontend-core.md` section 10)

- No test covers a read in flight across a mutation for any `getCached`/`setCache` site (A26-S18-02).
- No test for recategorising writes and budget caches (A26-S18-01); no test for price, security-currency or preference writes and the valuation cache (A26-S18-03).
- `useExchangeRates.test.ts` uses `rateDate: '2025-01-15'` everywhere and never tests age (A26-S18-04).
- `hooks/useInvestmentDailyValues.ts` has no test file; its `=== false` reads are held by one component case (mutation row 3).
- `MnyImportProgress.test.tsx:160-167` asserts "Nothing was saved" for `errorKey: null`, an unreachable server state; weak, not wrong (A26-S18-05).
- No cross-tab refresh test anywhere (A26-S18-06); `e2e/` has no fixture to expire the access cookie.
- `persisted-storage.guard.test.ts` does not scan `sessionStorage` writers (A26-S18-08).
- Known-wrong test: none found in the slice (the MON-M42 assertion is corrected).

#### S19 (`19-frontend-forms.md` section 10)

- Missing: a receiving-leg, cross-currency transfer edit and duplicate (A26-S19-01); an existing-row mode switch to Transfer (A26-S19-02); any four-decimal fixture in `CurrencyInput.test.tsx`, `TransactionForm.test.tsx`, the split editor, `AccountForm`, the override editor and the schedule form (A26-S19-03); a back-dated trade's rate (A26-S19-04); a 0 % loan edit (A26-S19-06); a guard for a bare `toFixed` in JSX (A26-S19-07); individual tests for the override editor's `hasStoredPrice` gate (M1a) and the redemption form's price guard and opened-key seed (R1, R2).
- Known-wrong: `InvestmentTransactionForm.test.tsx:1329-1357` "auto-fills the exchange rate with the latest market rate" asserts the undated latest rate for a trade whose date it never sets, which is the behaviour INV-FX-001 forbids for a back-dated trade.
- A green suite with the defects present: 157 files and 4025 tests pass at the baseline with A26-S19-01 to -04 present; the suites had no case for them.

#### S20 (`20-frontend-figures.md` section 10)

- No page-level case for an unpriced or FX-incomplete brokerage on the accounts page (M2 undetected).
- No case for a partial Geographic total card (M6) or for export gating after a failed load on any inside-tree report (M8).
- No test feeds `fxComplete:false` to any `MonthlyNetWorth` consumer; the type makes such a fixture impossible without a cast.
- No test feeds `pricesComplete:false` to `InvestmentValueChart` or the widget's series.
- No backend case asserts the gain with one unpriced holding (`portfolio.service.spec.ts`, `portfolio-calculation.service.spec.ts`).
- `store/persisted-storage.guard.test.ts` covers localStorage, not sessionStorage.
- No known-wrong test found in the slice.

#### S21 (`21-tests-ci-release.md` section 10)

##### 10.1 Known-wrong test register (program-wide)

| Test (path:line) | Asserts | Protects defect | Owner finding | Found by |
| --- | --- | --- | --- | --- |
| `backend/src/built-in-reports/report-currency.service.spec.ts:213-218` "returns original amount when no rate is available" (and the inverse-zero case near `:247`) | 1000 JPY with no rate -> `toBe(1000)` in USD | the 1:1 fallback of `convertAmount` (`report-currency.service.ts:113-118`), used by seven built-in report services | A26-S02-02 / A26-S13-01 (MON-H12, MON-M39) | S02, S13; re-located here: **this is `docs/verification-contract.md` section 5's unconfirmed item 1** |
| `backend/src/backup/auto-backup.service.spec.ts:3870/3871`, `:3907` "counts files left flat in the base folder by an older version" | the cross-owner legacy sweep | A26-S06-01 | A26-S06-01, MON-M43 | S02, S06 |
| `backend/src/auth/token.service.spec.ts:323` (replay detection), `:387` (user not found), `:408` (user inactive) | that `manager.update` was called, true while the revocation is rolled back | A26-S03-01 | A26-S03-01 | S03 |
| `backend/src/securities/investment-transactions.service.spec.ts:5120` "converts cash amount using the latest market rate when currencies differ", and five sibling cases S12 M11 names but does not list | stub `getRateForDate` to null and `getLatestRate` to the answer | the `getLatestRate` fallback, `investment-transactions.service.ts:789-792` | A26-S12-02 | S12 |
| `backend/src/delegation/rls-context-smoke.spec.ts` (S04 D-S04-05) | "authorization under the caller, then bypass" order | A26-S04-01 | A26-S04-01 | S04 |
| `backend/test/integration/backup-store-s3.integration.spec.ts:160-185` | unpadded day names, its own pruning wrong; never runs in CI | test defect | A26-S06-02 | S06 |
| `backend/src/users/users.service.spec.ts:148` | mocks `ensureSystemCurrency`, so write-before-ensure passes | A26-S13-05 | A26-S13-05 | S13 |
| `backend/src/transactions/transaction-bulk-update.service.spec.ts:2592-2643` | only that `updateBalance` was called | A26-S13-03 | A26-S13-03 | S13 |
| `frontend/src/lib/loan-history.test.ts:2058` | the overpayment-takes-the-interest variant of a same-day pair | order dependence (D9) | -- | S15 |
| `backend/src/ai/query/tool-executor.service.spec.ts:1345-1351`, `backend/src/mcp/tools/reports.tool.spec.ts:220-246` | `getSpendingAnomalies(userId, months)` | months passed as the z-score threshold | A26-S17-03 | S17 |

The four "reported but not located" items of `docs/verification-contract.md` section 5: item 1 located (row 1); items 2 and 3 corrected (section 8); item 4 superseded by the A26-S06-01 tests.

##### 10.2 Missing tests of this slice

- A production-image boot in a gate (A26-S21-01); a release-workflow self-test (INV-RELEASE-001 "Required tests"; A26-S21-02); a bind-mount / named-volume writability check for the production image (A26-S21-03); a suite inventory (REL-002); a `failOnFlakyTests` guard (A26-S21-05); a `node --test` glob guard (A26-S21-06); MinIO and `BACKUP_STORE_S3_TEST_ENDPOINT` in `backend-integration-tests` so `backup-store-s3.integration.spec.ts` runs (A26-S06-02's CI half: today its `describe` is skipped in CI and counts as green); a kind/k3d chart install with persistence (`ci.yml:381-385`); the INV-HA-001 flip (a replica losing its channel goes 503), recorded as owed by the invariant itself; `e2e/` lint and type-check (no `tsconfig.json`, no ESLint config); the backend `test/*.e2e-spec.ts` suites run in no job (`backend/CLAUDE.md`: "three of five suites are broken").
- **Unstable test observed (midnight crossing):** `backend/test/integration/bank-sync.integration.spec.ts:74` fixes `today` once for the suite (`daysAgo = (days) => addDaysYMD(today, -days)`), while the service computes its own date at call time. The full integration run started at 23:59:24 UTC; the suite (126.5 s) failed at `:2777` with `defaultSyncFromDate` expected `2026-07-24`, received `2026-07-25`, and in further cases of the same describe blocks. Any CI run that crosses UTC midnight fails it; the remedy is an injected clock in the service, or reading `today` per test.
- **Integration deadlock root-caused (S01 hand-off), executed:** the full `npm run test:integration` (118 suites) reproduced it once. PostgreSQL log, 00:18:02 UTC: `deadlock detected`; process A ran `TRUNCATE action_history, transaction_splits, transactions, monthly_account_balances, accounts, categories, payees, users CASCADE` (the `cleanTables` list of `ofx-import-fitid.integration.spec.ts:101-111`, shared by five other suites); process B ran `SELECT MIN(transaction_date) as earliest FROM transactions WHERE account_id = $1 ...`, which is `NetWorthService.recalculateRegularAccount` (`backend/src/net-worth/net-worth.service.ts:2685-2692`). B is the per-account net-worth recompute that `ImportPostProcessingService` dispatches without awaiting (`backend/src/import/import-post-processing.service.ts:170-177`, `.recalculateAccount(...).catch(warn)`), still running from the previous test when the next `beforeEach` truncates. `cleanTables` (`test/helpers/integration-setup.ts:251-273`) settles only pending price writes and pending history writes. In this run PostgreSQL chose the background query as the victim, so its failure was swallowed by the `.catch` and no test failed; in S01's run it chose the `TRUNCATE`, and `ofx-import-fitid` failed. Remedy (test harness, not production): register the dispatched recompute the way `settlePendingPriceWrites` registers price writes and await it in `cleanTables`, or have `cleanTables` wait until no other backend of the test database is active before truncating. In production the same un-awaited recompute against a concurrent account delete ends in a logged warning, not in a wrong figure.
- **No integration suite goes through HTTP:** 0 of 118 import `supertest`, so `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`), guards and DTO constraints run only in unit DTO specs and the E2E suite (A26-S21-07 is one consequence).

#### S22 (`22-delta-review.md` section 10)

No new item: the delta adds or removes no test. Confirmed still present at `MAIN_SHA`: the
known-wrong test of MON-M39 (`backend/src/built-in-reports/report-currency.service.spec.ts:212-217`).
