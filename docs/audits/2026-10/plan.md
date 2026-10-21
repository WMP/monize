# Full Read-Only Audit 2026-10: Program Plan

**Status:** active. **Executable form of each session:** `/audit` (`.claude/commands/audit.md`).
**Companions:** [`sessions.md`](./sessions.md) (the session list, one per working day),
[`prior-findings-register.md`](./prior-findings-register.md) (the 70 upstream findings to re-verify),
[`ledger.md`](./ledger.md) (the cross-session state every session reads first and writes last).

This plan exists because a full audit of the repository does not fit in one session under the
current usage limits. It cuts the audit into sessions that each fit one context window, fixes the
revision and the rules once so no session has to re-decide them, and makes every session resumable
from the ledger. A fresh session with no memory of this conversation must be able to execute any
session from this plan and the three companions alone.

## 1. Fixed facts

| Fact | Value |
| --- | --- |
| Repository | `WMP/monize` (fork of `kenlasko/monize`) |
| `AUDIT_BASELINE_SHA` | `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86` (`chore: bump version to 1.19.0`, 2026-10-21) |
| Audit branch | `ccr-1f689e5c-onia07`, created from `AUDIT_BASELINE_SHA`; the code on it never moves, only `docs/audits/2026-10/` grows |
| Report directory | `docs/audits/2026-10/` |
| Prior audit | `kenlasko/monize` at `d5cea9bfa995885ba5198f9843359362927c0fd4` (2026-08-01), 8 phases, 70 canonical findings, reports copied verbatim to `docs/audits/2026-08-upstream/` |
| Protocol | `.claude/commands/audit.md`, reconciled against `docs/audits/monize-universal-adversarial-pr-review-project-prompt.md` |
| Language | Conversation with the user in Polish; every report, finding, diff and ledger entry in English |
| Invariant index at baseline | 145 entries: 126 `enforced`, 19 `partial`, 1 `unenforced` (`docs/system-invariants.md`) |
| Code size at baseline (non-test lines) | backend 411k in 1 429 files; frontend 279k in 1 264 files; 233 migrations; 40 cron jobs; 40 E2E specs |

The prior audit could not clone, install or run anything; every one of its findings is static.
This audit has a clone, Node 22, Docker and PostgreSQL available in the session container, so the
protocol's "actual mutation execution is preferred when practical" is **mandatory here for every
HIGH or BLOCKER candidate**: a race, a rollback, a filesystem property or a monetary result is
demonstrated by running the suite or a one-off script against the baseline, or the finding says
why that was not possible.

## 2. What is in scope and what is not

In scope: every layer of the repository at `AUDIT_BASELINE_SHA`, every lens of the protocol,
every entry of `docs/system-invariants.md`, every one of the 70 prior findings, and the delta
between `AUDIT_BASELINE_SHA` and `main` at the end of the program.

Out of scope: fixing anything. The audit is read-only on code. The only writes permitted are
files under `docs/audits/2026-10/` on the audit branch, committed with `docs(audits): ...`
subjects. A fix that looks obvious goes into the finding's suggested remediation diff and into the
final remediation plan, never into the tree. A session that finds itself editing a source file has
left the protocol.

Also out of scope until the final sessions: re-reading `main`. Every session pins to the audit
branch, whose code equals `AUDIT_BASELINE_SHA`. Session S22 reviews the delta once, as the
protocol's "PR head changed during review" procedure.

## 3. How the protocol is applied to a baseline instead of a PR

`/audit` is written for a pull request. Four adaptations apply to every session, and they are
the only ones:

1. **Target.** The argument is a path, as the protocol allows (`/audit <path> -- <hints>`).
   `PR_REVIEW_SHA` is `AUDIT_BASELINE_SHA` for the whole program. Secondary paths named in the
   session's hints are part of the change surface, not an excuse to skip the repo-wide
   producer/consumer searches the protocol requires.
2. **Causality classification (Rule 3).** There is no PR, so every candidate is classified as
   exactly one of:
   - `NEW_SINCE_UPSTREAM_AUDIT`: in code that did not exist at `d5cea9bf` (the modules listed in
     section 5 are new);
   - `PRIOR_REPORTED`: matches a `MON-*` finding; name it, and classify it per Rule 9
     (`CONFIRMED`, `CONFIRMED_WITH_DIFFERENT_ROOT_CAUSE`, `DESIGN_RISK`, `PRE_EXISTING`,
     `REJECTED`);
   - `REGRESSION_OF_PRIOR_FIX`: a `MON-*` finding that was fixed after 2026-08 and is reachable
     again; name the fix and the path that reopens it;
   - `PRE_EXISTING_UNREPORTED`: existed at `d5cea9bf`, missed then.
3. **Verdict.** Each session ends with a verdict for its slice: `APPROVE` when no BLOCKER or HIGH
   survived the adversarial approval challenge, `REQUEST CHANGES` otherwise. The program's verdict
   is the final report's.
4. **Finding IDs.** `A26-<slice>-<nn>` (for example `A26-S08-03`), assigned in the session,
   renumbered once in S23 into the canonical register. Severity, confidence and the 15-field
   finding format are the protocol's, unchanged.

Everything else in the protocol applies verbatim: instructions before implementation, the
invariant model first, every mandatory lens, the mutation table, the counterexample per invariant,
the interaction scenario, the rejected-hypothesis table, the suggested remediation diff and
regression-test diff, the adversarial approval challenge, the ledger.

## 4. The session protocol

Every session runs the same twelve steps. A session that cannot finish them writes the ledger
and stops; the next session resumes from the ledger before taking new work.

1. **Open the ledger.** Read `ledger.md`. If a session is marked `in-progress`, resume it: read
   its partial report, its open hypotheses, and continue from the first lens it has not closed.
   Otherwise take the first session in `sessions.md` marked `open` whose dependencies are `done`.
2. **Pin.** `git rev-parse HEAD` on the audit branch must equal `AUDIT_BASELINE_SHA`. If it does
   not, stop and report; do not audit a moved head.
3. **Read instructions first.** `AGENTS.md`, root `CLAUDE.md`, the layer `CLAUDE.md` the session
   touches, the `docs/` rows that layer's table names for the subject, the `docs/specs/*.md` the
   session names, and the `docs/system-invariants.md` entries the session names. Read
   `.claude/commands/audit.md` in full; it is self-contained and nothing in it is optional.
4. **Load the prior findings for the slice.** The session's row in `prior-findings-register.md`
   names the `MON-*` findings it owns. Read each one's section in
   `docs/audits/2026-08-upstream/08-final-report.md` and the supporting phase section it cites.
   They are hypotheses, not findings (protocol: "treat summaries and review comments as
   hypotheses").
5. **Bring up the toolchain the session needs.** First switch to the Node version CI uses:
   `export NVM_DIR=/opt/nvm && source /opt/nvm/nvm.sh && nvm install 24 && nvm use 24`. The
   session container defaults to Node 22.22.0, on which `npm ci` refuses both lock files
   (`Missing: chokidar@5.0.0`, `Missing: msw@2.15.0`); CI runs Node 24 and the lock files install
   cleanly there. Then `npm ci` in the layer directory; for a session
   marked `runtime: integration`, start PostgreSQL with
   `docker compose -f docker-compose.dev.yml up -d postgres` and run the integration suites named
   (`npm run test:integration -- <pattern>` from `backend/`). Record in the ledger which suites ran and their result;
   a suite that could not run is recorded as such, never as green.
6. **Invoke the protocol.** `/audit <primary path> -- <the session's hint line, verbatim>`. Build
   the invariant map, map the change surface, run every lens, write the mutation table, construct
   the counterexamples and the interaction scenario.
7. **Execute, do not only reason, for HIGH and BLOCKER candidates.** Run the existing test that
   should catch the defect; apply the conceptual mutation in a scratch copy
   (`git stash` is not allowed; use `git worktree add <scratchpad>/mut AUDIT_BASELINE_SHA`) and
   run the suite to prove `undetected`; for a race, use two connections and a barrier in a
   throwaway script under the scratchpad directory. Never leave a modified file on the audit
   branch.
8. **Dispose of each prior finding the session owns.** Write its row in the session report with
   exactly one disposition: `FIXED_VERIFIED` (name the mechanism and the test),
   `STILL_OPEN` (becomes an `A26-*` finding), `SUPERSEDED` (the code path is gone; say what
   replaced it), `NOT_LOCATED` (the evidence path no longer exists and no equivalent was found),
   `REJECTED` (the prior analysis was wrong; say why).
9. **Budget stop.** When the context is about 70 percent used, or the lens list is complete,
   stop auditing and write. A half-written report with an honest ledger is worth more than a
   complete read with no record.
10. **Write the report** to the session's output file in the format of section 7.
11. **Update the ledger**: the session's status, suites run, files inspected in full and sampled,
    finding counts, open hypotheses handed to a later session, and the exact `git rev-parse HEAD`.
    Update the session's row in `sessions.md` and the owned rows in
    `prior-findings-register.md`.
12. **Commit and push** on the audit branch: one commit, `docs(audits): session Sxx <slice>`,
    with the `Co-Authored-By` trailer the repository convention asks for. Nothing outside
    `docs/audits/2026-10/` may be in the diff; `git status --short` is checked before the commit.

A session never opens a pull request, never comments on GitHub, and never touches `main`.

## 5. What changed since the upstream audit

These modules did not exist at `d5cea9bf` and have never been audited. Each is named in the
session that owns it. Their invariants and specs are the first hypotheses.

| Module | Size (non-test lines) | Invariants / specs |
| --- | --- | --- |
| `backend/src/bank-sync/` | 10k | INV-BANKSYNC-001..004, INV-API-001, `docs/specs/bank-sync.md`, `bank-sync-notifications.md` |
| `backend/src/bonds/` | 18k | INV-BOND-001..010, INV-BONDNOTIFY, INV-REDEEM, `docs/specs/polish-retail-bonds.md`, `sovereign-bonds.md`, `bond-*.md`, `redemption-accrued-interest.md` |
| `backend/src/email-receipts/` | 27k | INV-RECEIPT-001..008, `docs/specs/email-receipt-*.md`, `document-scanner.md` |
| `backend/src/transaction-rules/` | 12k | INV-RULE-001..005 (all `partial`), `docs/specs/transaction-rules-structural-actions.md` |
| `backend/src/strategies/` | 7k | `docs/gem-strategy.md`, `docs/specs/gem-signal-change-notifications.md` |
| `backend/src/loan-scenarios/`, `loan-rate-changes/` | 3k | INV-LOAN-001..011, `docs/specs/loan-installment-settlement.md`, `scheduled-loan-installment-pricing.md`, `mortgage-types.md` |
| `backend/src/import-preview/` | 2k | `docs/specs/mny-import.md`, `docs/future-plans/unified-import-preview.md` |
| `backend/src/push/`, `notification-center/`, `system-alerts/`, `provider-health/` | 10k | INV-PUSH-001..011, INV-DISPATCH, INV-ALERT, INV-NOTIFY, `docs/specs/system-alerts.md`, `provider-outage-alerts.md` |
| `backend/src/ai-review/`, `oauth/`, `updates/`, `calendar/` | 8k | `docs/specs/ai-review-notifications.md`, `calendar-view.md` |
| Joint accounts, cross-owner transfers, horizontal scaling | in existing modules | INV-SHARE-001..005, INV-TRANSFER-001, INV-HA-001..005, `docs/specs/joint-accounts.md`, `cross-owner-transfers.md`, `horizontal-scaling.md` |
| Migrations | 56 timestamped files since August | INV-MIGRATION-001, `docs/database-migrations.md` |

Twelve evidence paths from the final upstream report no longer exist (among them
`backend/src/auth/jwt.strategy.ts`, `backend/src/budgets/budget-calculation.service.ts`,
`frontend/src/lib/backup.ts`, `helm/templates/statefulset-backend.yaml`). A prior finding whose
evidence path is gone is not closed by that fact; the session finds the replacement or records
`NOT_LOCATED`.

The invariants currently `partial` or `unenforced` are standing hypotheses for the session that
owns them: INV-IMPORT-003 (unenforced), INV-BANKSYNC-001, INV-API-001, INV-FX-001, INV-FX-003,
INV-PRICE-001, INV-LOAN-HISTORY-001, INV-BOND-010, INV-BACKUP-004, INV-BACKUP-005,
INV-BACKUP-008, INV-CRON-001, INV-RELEASE-001, INV-HA-001, INV-RULE-001..004, INV-SEARCH-001.
For each, the session states whether the gap the index records is still the gap, and whether the
unenforced paths it lists are still the only ones.

## 6. Budget and cadence

- **One session is one context window.** A session marked XL is sampled by invariant, never read
  end to end, and its ledger says "sampled" with the ranges. The XL slices are MNY import (73k
  lines), securities (35k), frontend reports (41k) and frontend lib (43k).
- **Five sessions a week, 23 sessions, five weeks.** Week 1 baseline, prior HIGH triage,
  security and the data layer; week 2 backup, cash ledger, scheduler and import; week 3 receipts
  and investments; week 4 consumers and frontend; week 5 tests, delta and closure. `sessions.md`
  carries the order and the dependencies.
- **Minimum viable audit** if the budget runs short: S01, S02, S03, S04, S06, S07, S08, S09, S12,
  S13, S19, S21, S23. The others are sampled in S23 from their invariant lists and reported as
  `not audited this program`, never as clean.
- **Limits.** If a session hits the usage limit mid-lens, step 9 applies: write the ledger. The
  next day's session resumes it. Two consecutive sessions on one slice are allowed; a third means
  the slice is cut in two in `sessions.md`.
- **Automation (optional).** A Routine can fire one fresh session per weekday with the prompt in
  section 8. It must not be created without the maintainer's explicit go, because each firing
  spends the same budget a manual session would.

## 7. Report format for one session

Each `NN-<slice>.md` has these sections, in this order, and nothing else. Section numbers are
fixed so S23 can consolidate mechanically.

1. **Metadata**: session ID, `AUDIT_BASELINE_SHA`, `git rev-parse HEAD`, date, primary path,
   hint line used, runtime executed (suites and results, or "none, because ...").
2. **Invariant map** for the slice: ID, statement, mechanism named, `producer -> transformations
   -> storage -> consumers -> side effects` for each material one.
3. **Lens ledger**: every mandatory lens of the protocol with `ran` or `not applicable because
   ...`. A lens marked not-applicable without a reason invalidates the session.
4. **Confirmed findings**, severity-ordered, each in the protocol's 15-field format with the
   causality class of section 3, the `MON-*` ID where one applies, and for HIGH/BLOCKER the
   execution evidence of step 7.
5. **Prior-finding dispositions**: one row per owned `MON-*` with the disposition of step 8 and
   the evidence.
6. **Mutation table**: `invariant | mutation (file:line, what) | test that fails | verdict`.
   Every `undetected` row is a test-coverage finding.
7. **Counterexamples and the interaction scenario.**
8. **Rejected hypotheses** (Rule 8): candidate, evidence considered, why rejected or downgraded,
   final classification.
9. **Design risks** (Rule 1 outcomes that are not present-day failures).
10. **Missing tests and known-wrong tests** found in the slice.
11. **Documentation inconsistencies** (implementation vs tests vs schema vs docs).
12. **Review ledger**: directories inspected, files in full, files sampled with ranges, searches
    performed, call sites inspected, suites run, areas reviewed without a finding, open hypotheses
    handed on (to which session).
13. **Adversarial approval challenge**: started from the slice's own abstractions, not from the
    findings; what it searched; what it found.
14. **Verdict** for the slice.

## 8. Session prompt

This is the whole prompt for a session, manual or scheduled. Everything else is in the files it
names.

```text
Open docs/audits/2026-10/ledger.md on branch ccr-1f689e5c-onia07 of WMP/monize.
Follow docs/audits/2026-10/plan.md section 4 exactly: resume the in-progress session if
there is one, otherwise take the first open session in docs/audits/2026-10/sessions.md
whose dependencies are done. Run /audit with that session's primary path and hint line.
The audit is read-only: write only under docs/audits/2026-10/, commit as
"docs(audits): session Sxx <slice>", push to the same branch, never open a PR.
Stop at about 70 percent of the context and write the ledger before anything else.
Talk to the user in Polish; write every report in English.
```

## 9. Closure

S23 produces `23-final-report.md` in the structure of
`docs/audits/2026-08-upstream/08-final-report.md`: executive summary, audited SHA, method and
limitations, finding counts, the canonical index, findings by severity, the registers (design
risks, missing tests, documentation, known-wrong tests), the deduplication and supersession
register, the BLOCKER/HIGH verification ledger, the coverage ledger, the prioritized remediation
plan, residual risk, and the final conclusion. It also produces
`remediation-tasks.md` in the pattern of `docs/future-plans/*-tasks.md`: one task per PR in
dependency order, each naming the finding IDs it closes, the files, the invariants, and the gate.
The remediation itself is a separate program with its own discussion, per `CONTRIBUTING.md`.
