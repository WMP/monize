# Monize Full Read-Only Audit 2026-10 - Final Maintainer Report

**Repository:** `WMP/monize` (fork of `kenlasko/monize`)
**Audited baseline:** `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86` (`AUDIT_BASELINE_SHA`, `chore: bump version to 1.19.0 [skip ci]`, 2026-10-21)
**`main` at closure:** `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86` (re-fetched by S23 on 2026-10-22; equal to the baseline, no second delta review needed)
**Audit mode:** read-only, fixed revision, executed: every HIGH candidate was run against the baseline (suite, mutation, probe or failpoint) or says why not
**Sessions consumed:** S01-S22 (22 reports, `01-baseline.md` .. `22-delta-review.md`), the ledger, the prior-findings register
**Companion:** [`remediation-tasks.md`](./remediation-tasks.md) (one task per PR, dependency-ordered)
**Report status:** in-progress, remaining: chapters 7.2-7.3, sections 8-24, appendices; remediation-tasks.md

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
their sessions and this consolidation. The remediation plan (section 20) and the task list put the
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
and the sessions' focused runs (section 19). This is the concrete instance of A26-M41 (the
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
