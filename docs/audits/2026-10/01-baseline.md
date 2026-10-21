# S01 Baseline, toolchain, CI and cron inventory

## 1. Metadata

| Field | Value |
| --- | --- |
| Session | S01 (parallel wave with S02 and S03, orchestrated) |
| `AUDIT_BASELINE_SHA` | `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86` |
| `git rev-parse HEAD` at start | `becd00facf022d3e52e3d6efa8019a486c68b1de` (audit branch; pin check of plan step 2 returned an empty diff) |
| Date | 2026-10-21 |
| Primary path | `AGENTS.md` (the instruction hierarchy), then `.github/workflows/ci.yml` |
| Hint line used | `prioritize the instruction hierarchy and its contradictions, the architecture delta since d5cea9bf (plan section 5), which suites run green at the baseline, and the 19 partial and 1 unenforced invariants as standing hypotheses` |
| Runtime executed | See section 12.1 (baseline suite table). Node 24.22.1 via `/opt/nvm`; PostgreSQL 16 (`mirror.gcr.io/library/postgres:16-alpine`) in Docker; mutations in a scratch worktree at `AUDIT_BASELINE_SHA`. |
| Status | in-progress (suite results being filled) |

## 2. Invariant map

The slice is the instruction hierarchy and the gates that hold it. Its material invariants:

| ID | Statement | Mechanism named | Path |
| --- | --- | --- | --- |
| S01-I1 (no INV ID) | The instruction files give one answer per question; a more specific file does not contradict `AGENTS.md`. | `backend/src/common/instruction-files.spec.ts` (size ceilings, docs reachability), `backend/src/common/db/lint-bans.spec.ts` (no instruction file recommends a banned DB primitive), `doc-paths.spec.ts` | `AGENTS.md -> CLAUDE.md (@import) -> layer CLAUDE.md -> docs/<layer>/*.md -> agent behaviour -> code` |
| S01-I2 (no INV ID; ADR 0001) | All DB access goes through `withScopedDb`; `@InjectRepository`, `createQueryRunner()`, `DataSource.transaction()` are banned. | ESLint `no-restricted-imports` / `no-restricted-syntax` in `backend/eslint.config.mjs:277-443`; `lint-bans.spec.ts` | `source -> eslint (CI backend-lint) -> merge` |
| S01-I3 (no INV ID; RLS contract) | Every caller of `withSystemContext`/`withUserContext`/`withDelegateContext`/`withPreserveTimestamps` is a reviewed entry of `WITH_CONTEXT_ALLOWLIST`. | ESLint `no-restricted-imports` pattern `["**/db/with-context", "./with-context"]`, lifted per allowlisted file (`eslint.config.mjs:17-268, 283-289, 449-473`) | `import specifier -> eslint pattern match -> CI backend-lint` |
| S01-I4 (CI gate) | A lint error in `backend/` fails CI. | `backend-lint` job, `npm run lint` (`ci.yml:66`) | `source -> npm run lint -> job exit code` |
| INV-CRON-001 (partial) | One logical effect per tick across replicas. | `JobClaimService.claimOnce`/`claimLease`/`withLease`, conditional `UPDATE ... RETURNING`, `ON CONFLICT`, dedupe index; doc held by `cron-doc.spec.ts` | `@Cron (every replica) -> claim -> effect -> delivery record` |
| INV-RELEASE-001 (partial) / REL-001 | The tested, imaged and tagged revisions are one; zero discovered tests is a failure. | `prepare-release` SHA threading; `passWithNoTests` guard (`jest-config.guard.spec.ts`) | `PR SHA -> CI gate -> release job -> bump commit -> tag` |
| INV-HA-001 (partial) | A replica serves only while what it shares is reachable. | `checkClusterBoot` (`cluster-mode.ts:154`), readiness grace (`health.controller.ts:38,192`) | `boot -> readiness -> LB` |
| The 19 non-enforced entries | See section 12.4. | | |

## 3. Lens ledger

| Lens | Status |
| --- | --- |
| Pin the revision | ran (empty `git diff --stat` against `AUDIT_BASELINE_SHA` outside `docs/audits/`) |
| Read instructions first | ran: `AGENTS.md`, root, `backend/`, `frontend/` (commands and gate sections), `database/` (commands), `e2e/`, `backend/src/mcp/` `CLAUDE.md`; `CONTRIBUTING.md`; `.claude/settings.json`; `.lintstagedrc.cjs`; `docs/verification-contract.md` s7-8; `docs/backend/testing.md`; `docs/cron-jobs.md` |
| Treat summaries as hypotheses | ran: the plan's own figures (cron count, invariant counts, module sizes) were re-measured; three are wrong (section 11) |
| Invariant model | ran (section 2) |
| Change surface (producer/consumer) | ran for the instruction rules: each rule traced to the guard that holds it and the CI job that runs it |
| Cross-layer verification | ran for the gate path `instruction -> command -> CI job -> exit code` |
| Representation boundary | ran for import specifiers (`with-context` vs `with-context.js` vs `./db/./with-context`) |
| Browser/UI round trip | not applicable: S01 has no UI intent path; S19 owns it |
| Server-authoritative metadata | ran only for the context-seeding fence (who may seed `system:true`); per-route checks are S03/S04 |
| Identity versus value | not applicable: no mutable repeated structure in the slice |
| State machine | not applicable in depth: the only lifecycle in the slice is the release flow, handed to S21 |
| Concurrency and idempotency | ran at inventory level: the cron matrix (section 12.3) names the cross-replica mechanism of each of 49 handlers; per-job proof is S08 |
| Partial failure | ran at inventory level for cron side effects (email/push/provider idempotency column, section 12.3) |
| External provider | not applicable: no provider call in the slice beyond inventory |
| Database and migration | ran at inventory level (233 migrations, 56 timestamped); schema parity is S05 |
| Backup/restore | not applicable: S06 |
| Financial | not applicable: no monetary computation in the slice |
| AuthZ/RLS | ran for the `WITH_CONTEXT_ALLOWLIST` fence (section 12.2, finding A26-S01-02) |
| Tests as evidence | ran: baseline suites executed, skip sites located, guard scope read |
| Mutation | ran: section 6, four executed in a scratch worktree |
| Counterexample | ran: section 7 |
| Interaction | ran: section 7 |
| Rejected hypotheses | ran: section 8 |
| Adversarial approval challenge | ran: section 13 |
</content>
</invoke>
