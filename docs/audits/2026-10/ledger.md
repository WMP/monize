# Full Read-Only Audit 2026-10: Program Ledger

> Every session reads this file first and writes it last (plan section 4, steps 1 and 11).
> It is the only shared state between sessions. Keep entries short; the detail is in the
> session reports.

## Pinned revision

| Field | Value |
| --- | --- |
| `AUDIT_BASELINE_SHA` | `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86` |
| Audit branch | `ccr-1f689e5c-onia07` |
| Pinned on | 2026-10-21 |
| Upstream audit baseline | `d5cea9bfa995885ba5198f9843359362927c0fd4` (2026-08-01) |
| `main` at last delta check | not yet checked (S22) |

A session whose `git rev-parse HEAD` on the audit branch differs from `AUDIT_BASELINE_SHA` in
anything but `docs/audits/2026-10/` stops and reports before auditing.

## Session status

| Session | Status | Started | Finished | Commit | Findings (B/H/M/L) | Report |
| --- | --- | --- | --- | --- | --- | --- |
| S00 planning | done | 2026-10-21 | 2026-10-21 | this commit | -- | `plan.md`, `sessions.md`, `prior-findings-register.md` |
| S01 | open | | | | | `01-baseline.md` |
| S02 | open | | | | | `02-prior-high-triage.md` |
| S03 | open | | | | | `03-security-auth.md` |
| S04 | open | | | | | `04-rls-tenancy.md` |
| S05 | open | | | | | `05-migrations-schema.md` |
| S06 | open | | | | | `06-backup-restore.md` |
| S07 | open | | | | | `07-cash-ledger.md` |
| S08 | open | | | | | `08-scheduler-cron.md` |
| S09 | open | | | | | `09-import-mny.md` |
| S10 | open | | | | | `10-rules-banksync-csv.md` |
| S11 | open | | | | | `11-email-receipts.md` |
| S12 | open | | | | | `12-securities-holdings.md` |
| S13 | open | | | | | `13-valuation-fx-networth.md` |
| S14 | open | | | | | `14-bonds.md` |
| S15 | open | | | | | `15-loans-strategies.md` |
| S16 | open | | | | | `16-budgets-reports.md` |
| S17 | open | | | | | `17-ai-mcp-notifications.md` |
| S18 | open | | | | | `18-frontend-core.md` |
| S19 | open | | | | | `19-frontend-forms.md` |
| S20 | open | | | | | `20-frontend-figures.md` |
| S21 | open | | | | | `21-tests-ci-release.md` |
| S22 | open | | | | | `22-delta-review.md` |
| S23 | open | | | | | `23-final-report.md`, `remediation-tasks.md` |

Status values: `open`, `in-progress` (resume it first), `done`, `split` (see `sessions.md` for
the two halves).

## Toolchain state at the baseline

Filled by S01. Later sessions read it instead of re-discovering it.

| Check | Result | Notes |
| --- | --- | --- |
| Node version | Node 24.22.1 via `/opt/nvm` (`nvm install 24 && nvm use 24`) | The container default, Node 22.22.0, fails `npm ci` in both layers; CI pins Node 24. S00 verified both. |
| `backend/`: `npm ci` | OK on Node 24 (S00) | `src/common/doc-paths.spec.ts` and `instruction-files.spec.ts` ran: 26 passed |
| `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck` | not run | |
| `backend/`: `TZ=UTC npm run test:unit` | not run | discovered test count: |
| `backend/`: `npm run test:integration` (PostgreSQL via `docker compose -f docker-compose.dev.yml up -d postgres`) | not run | discovered test count: |
| `frontend/`: `npm ci`, `npm run lint && npm run type-check && npm run i18n:check` | not run | |
| `frontend/`: `npm run test` | not run | discovered test count: |
| `e2e/`: stack start (`docker-compose.e2e.yml`) | not run | |
| `scripts/verify-schema.sh` | not run | |
| `node scripts/check-migration-prefixes.mjs` | not run | needs `git fetch --unshallow origin` |

## Running counts

| Severity | Confirmed `A26-*` findings so far |
| --- | --- |
| BLOCKER | 0 |
| HIGH | 0 |
| MEDIUM | 0 |
| LOW | 0 |

Prior findings disposed: 0 of 70.

## Open hypotheses handed between sessions

One line each: `from Sxx to Syy: <hypothesis>; <what to check>`. The receiving session deletes
the line when it disposes of the hypothesis in its report.

- (none yet)

## Program-wide mutation table (undetected rows only)

Appended by each session; S21 merges it. `invariant | mutation (file:line, what) | test that
should fail | session`.

- (none yet)

## Known deviations from the plan

Record any time a session could not follow `plan.md` section 4 (a suite that cannot run in
the container, a slice split in two, a lens not run) with the reason.

- S00: `npm ci` fails on the container's default Node 22.22.0 in both layers because entries
  in the lock files (`chokidar@5.0.0` under `@nestjs/cli`, `msw@2.15.0`) declare engines the
  default Node does not satisfy; this is a session-environment fact, not a repository defect,
  since CI runs Node 24 and the lock files install there. S01 confirms it on the frontend and
  records whether `docs/` says which Node version a contributor needs.
- S00: the clone is shallow (276 commits from 2026-10-11); the upstream baseline `d5cea9bf` is
  not reachable in it, so the prior findings are re-verified against the current code only, never
  by diffing against the upstream baseline. S05 and S22 need `git fetch --unshallow origin`.
