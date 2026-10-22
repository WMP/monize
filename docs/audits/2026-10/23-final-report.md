# Monize Full Read-Only Audit 2026-10 - Final Maintainer Report

**Repository:** `WMP/monize` (fork of `kenlasko/monize`)
**Audited baseline:** `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86` (`AUDIT_BASELINE_SHA`, `chore: bump version to 1.19.0 [skip ci]`, 2026-10-21)
**`main` at closure:** `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86` (re-fetched by S23 on 2026-10-22; equal to the baseline, no second delta review needed)
**Audit mode:** read-only, fixed revision, executed: every HIGH candidate was run against the baseline (suite, mutation, probe or failpoint) or says why not
**Sessions consumed:** S01-S22 (22 reports, `01-baseline.md` .. `22-delta-review.md`), the ledger, the prior-findings register
**Companion:** [`remediation-tasks.md`](./remediation-tasks.md) (one task per PR, dependency-ordered)
**Report status:** in-progress, remaining: findings chapters 7.1-7.3, sections 8-24, appendices; remediation-tasks.md

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
