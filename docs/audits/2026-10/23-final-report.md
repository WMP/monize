# Monize Full Read-Only Audit 2026-10 - Final Maintainer Report

**Repository:** `WMP/monize` (fork of `kenlasko/monize`)
**Audited baseline:** `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86` (`AUDIT_BASELINE_SHA`, `chore: bump version to 1.19.0 [skip ci]`, 2026-10-21)
**`main` at closure:** `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86` (re-fetched by S23 on 2026-10-22; equal to the baseline, no second delta review needed)
**Audit mode:** read-only, fixed revision, executed: every HIGH candidate was run against the baseline (suite, mutation, probe or failpoint) or says why not
**Sessions consumed:** S01-S22 (22 reports, `01-baseline.md` .. `22-delta-review.md`), the ledger, the prior-findings register
**Companion:** [`remediation-tasks.md`](./remediation-tasks.md) (one task per PR, dependency-ordered)
**Report status:** in-progress, remaining: sections 8-24, appendices; remediation-tasks.md

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
