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

A session whose code differs from `AUDIT_BASELINE_SHA` in anything but `docs/audits/2026-10/`
and `docs/audits/2026-08-upstream/` (the check in plan section 4, step 2) stops and reports
before auditing.

## Session status

| Session | Status | Started | Finished | Commit | Findings (B/H/M/L) | Report |
| --- | --- | --- | --- | --- | --- | --- |
| S00 planning | done | 2026-10-21 | 2026-10-21 | this commit | -- | `plan.md`, `sessions.md`, `prior-findings-register.md` |
| S01 | in-progress | 2026-10-21 | | | | `01-baseline.md` (child session_01K2tpEV1qrxan3G3mhQa4Jn, claude-opus-5-5) |
| S02 | done | 2026-10-21 | 2026-10-21 | bd06ebd | 0/2/8/2 | `02-prior-high-triage.md` (child session_01366anc7J8MgFS2vwq5szy2) |
| S03 | done | 2026-10-21 | 2026-10-21 | 4adfd72 | 0/1/3/3 | `03-security-auth.md` (child session_019xGDCFeEXnmBq2PfLKgW9t); verdict REQUEST CHANGES |
| S04 | in-progress | 2026-10-21 | | | | `04-rls-tenancy.md` (child session_01XG1M2wjANyUMMeHkkGGyN1, claude-opus-5-5) |
| S05 | done | 2026-10-21 | 2026-10-21 | 3268ccec | 0/0/1/2 | `05-migrations-schema.md` (child session_01XM8Gxs6p79kg8d2mviohsA); verdict APPROVE |
| S06 | in-progress | 2026-10-21 | | | | `06-backup-restore.md` (child: see next ledger update) |
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
| `scripts/verify-schema.sh` | OK (S05, 2 passes) | `migration:lint` OK, 233 files |
| `node scripts/check-migration-prefixes.mjs` | OK (S05, after `git fetch --unshallow`) | |

## Running counts

| Severity | Confirmed `A26-*` findings so far |
| --- | --- |
| BLOCKER | 0 |
| HIGH | 3 (S02: 2, S03: 1) |
| MEDIUM | 12 (S02: 8, S03: 3, S05: 1) |
| LOW | 7 (S02: 2, S03: 3, S05: 2) |

Prior findings disposed (final, by the owning session): 10 of 70 (S03: MON-H09, M03, M05, M07, M23, M24, M26, L01; S05: MON-M15, L02; all `FIXED_VERIFIED`). S02 triaged 23 rows (12 FIXED_VERIFIED, 11 STILL_OPEN in whole or part); final call stays with the owning sessions, see the register.

## Open hypotheses handed between sessions

One line each: `from Sxx to Syy: <hypothesis>; <what to check>`. The receiving session deletes
the line when it disposes of the hypothesis in its report.

- from S02 to S06: MON-H01 residual (legacy flat-root sweep, no instance namespace, A26-S02-06), MON-H02 real local/S3 round trip still missing, MON-M43 narrowed; see `02-prior-high-triage.md` sections 5 and 9.
- from S02 to S07: MON-H05 split-transfer leg deltas from snapshots (A26-S02-01, executed 10/10), MON-H10 bulk VOID expansion race (A26-S02-07), MON-H11 residuals, A26-S02-08 reconciled lock bypass; section 5.
- from S02 to S08: MON-H06 residual, manual post not pinned to the occurrence (A26-S02-04); no integration test calls the real `post()`.
- from S02 to S09: MON-H04 residual, replay by a new start on the same staged file (A26-S02-05).
- from S02 to S10: QIF split-transfer leg unconverted (A26-S02-09); `applyOpeningBalance` hypothesis (section 9).
- from S02 to S12: MON-H14 residual hypothesis, latest rate used for a back-dated trade (section 9).
- from S02 to S13: MON-H12 built-in reports still 1:1 (A26-S02-02), guard blind spot (A26-S02-11), MON-M39 relocated to `report-currency.service.spec.ts:213`.
- from S02 to S20: MON-H16 residual, FX-incomplete account and dashboard widget (A26-S02-03).
- from S02 to S21: MON-M45 release job pushes an untested bump (A26-S02-10); A26-S02-12 integration race exercises a copy of the consume SQL.
- from S03 to S04: D-S03-01, whole-entity `repo.save(user)` after an intervening SQL write can revert a concurrent change; demonstrate one concurrent instance (given to S04 in its prompt).
- from S03 to S17: confirm the MCP/PAT bearer verifiers reject `step_up` / `oidc_reauth` JWT types (A26-S03-03).
- from S03 to S18: frontend handling of the 401 "Refresh token reuse detected".
- from S03 to S21: A26-S03-04's three missing two-connection tests join MON-M46.
- from S05 to S06: semantic backfills (e.g. `skip_price_updates`, 20261012131846) are not applied to rows restored from pre-1.19 backups (A26-S05-03).
- from S05 to S21: liveness probe versus a long migration; a real-runner two-replica race test is still owed.
- from S05 to S04: delegation unique keys missing in the entity-built integration harness (A26-S05-01).
- from S05 to S10/S11: rule deletion nulls `rule_id` on open reviews.

## Program-wide mutation table (undetected rows only)

Appended by each session; S21 merges it. `invariant | mutation (file:line, what) | test that
should fail | session`.

- `INV-AUTH-004 | token.service.ts:261 drop lockTokenFamily in revokeTokenFamily | a two-connection logout-vs-rotation test | S03`
- `INV-AUTH-001/004 | token.service.ts:149 drop lockTokenFamily in refreshTokens | same | S03`
- `INV-AUTH-001 | token.service.ts:164-177 reuse revocation rolled back (baseline defect) | a real-database reuse test | S03`
- `INV-CLAIM-001 | emergency-access-claim.controller.ts:222+226 drop both guards | a two-connection claim test | S03`
- S05: M3, M4, M5 of `05-migrations-schema.md` section 6 (entity-harness parity gaps; runner lock caught only by mock-order unit specs).
- S02's table: see `02-prior-high-triage.md` section 6 (M3 undetected at integration level, A26-S02-12).

## Known deviations from the plan

- S03: the Docker daemon was not running in the child container; `dockerd` was started by hand (S04 and S05 prompts carry the workaround).
- Wave 1 (2026-10-21): S01, S02 and S03 run concurrently as three remote child sessions on
  `claude-opus-5-5`, orchestrated by session_018Nx7aian3f7dpRX5msjFBg. The S02 and S03 dependency
  on S01 is waived; each child brings up its own toolchain. Children write only their report
  file; the orchestrator merges dispositions and ledger text after each check-in.

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
