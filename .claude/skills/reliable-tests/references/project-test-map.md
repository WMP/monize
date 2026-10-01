# Project test map

Read from the named files at commit `3cac8b8` (2026-10-01). The files win when they disagree with this page; correct this page in the same change. `backend/src/common/doc-paths.spec.ts` does not scan `.claude/`, so nothing fails when a path or a command here goes stale.

## Runners and commands

Run each command from its layer directory.

| Layer | Runner and configuration | What it discovers | Focused run | CI job: command |
|---|---|---|---|---|
| backend unit | Jest 30 with ts-jest; the `jest` block in `backend/package.json` | `src/**/*.spec.ts` (roots `<rootDir>/src`) | `npm run test:unit -- <path or regex>`, one test: add `-t "<name regex>"` | Backend Unit Tests: `npm run test:unit -- --coverage` |
| backend integration | Jest with `backend/test/jest-e2e.json` (one worker, 30 s timeout) | `test/integration/*.spec.ts`, through `--testPathPatterns` in the script | `npx jest --config ./test/jest-e2e.json --testPathPatterns=test/integration/<file regex>`, one test: add `-t "<name regex>"` (not `npm run test:integration -- <regex>`, see below; without the `test/integration/` prefix the pattern also picks the `test/*.e2e-spec.ts` suites) | Backend Integration Tests: `npm run build`, then `npm run test:integration` on `postgres:16-alpine` |
| frontend | Vitest 4, `frontend/vitest.config.ts` (jsdom, setup `src/test/setup.ts`) | `src/**/*.{test,spec}.{ts,tsx}` | `npm run test -- <path or filter>`, one test: add `-t "<name regex>"` | Frontend Unit Tests: `npm run test:cov` |
| e2e | Playwright 1.58, `e2e/playwright.config.ts` (Chromium and Firefox) | `e2e/tests/*.spec.ts` | `npm test -- tests/<file>.spec.ts`, one test: add `-g "<title regex>"`; whole suite `npm test -- --workers=1` | E2E Tests, four shards; shard 1 also runs the push suite, shard 4 the cluster spec |
| e2e push | `e2e/playwright.push.config.ts` | `e2e/push/` | `npm run test:push` (needs no stack) | E2E shard 1 |

- `npm run test:integration -- <regex>` does not narrow the run, although `backend/CLAUDE.md` and `docs/backend/testing.md` offer it as the filtered form: Jest joins the argument with the script's own `--testPathPatterns` by OR, so every integration suite runs (`--listTests` lists all of them either way; the run ends with "Ran all test suites matching <regex>|test/integration/..."). The direct `npx jest` form above narrows; it skips `pretest:integration`, so create `monize_test` once with `npm run pretest:integration`.
- Backend `npm test` is `node scripts/test-chain.mjs`: `test:unit`, then `test:integration`. It refuses arguments, and it needs PostgreSQL.
- Backend `npm run test:e2e` (`test/*.e2e-spec.ts`) is not a CI gate, and three of its five suites are broken (`docs/backend/testing.md`).
- Coverage thresholds. Backend (`coverageThreshold` in `backend/package.json`): lines 95, statements 94, functions 95, branches 85. Frontend (`coverage.thresholds` in `frontend/vitest.config.ts`): lines 91, statements 90, functions 87, branches 84. `AGENTS.md` and `frontend/CLAUDE.md` say 85 for frontend branches; the configuration says 84.
- Test discovery lives in the runner configurations, not in scripts. `backend/src/common/jest-config.guard.spec.ts` rejects discovery flags in scripts and every pass-with-no-tests flag (REL-001).
- Other checks: backend `npm run migration:lint:test && npm run migration:lint`; backend `npm run push:client:test && npm run push:tls:test`; at the repository root, `node --test scripts/npm-audit-gate.test.mjs`, `node --test scripts/ghcr-version-class.test.mjs`, `node scripts/check-env-docs.mjs`, `node scripts/check-docs-manifests.mjs`, `node scripts/check-migration-prefixes.mjs` and `scripts/verify-schema.sh` (Docker).
- Flake diagnosis flags: Playwright `--repeat-each <n>` and `--fail-on-flaky-tests`; Vitest `--retry <n>` only to measure, never committed.

## Environment

- Backend unit and frontend tests need only `npm ci` in the layer. Run them with `TZ=UTC` as `AGENTS.md` says. `ci.yml` does not set `TZ`; the GitHub runner's default is UTC.
- Backend integration needs a reachable PostgreSQL 16. The connection comes from `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_USER`, `DATABASE_PASSWORD`, `DATABASE_NAME`; the defaults in `backend/test/helpers/integration-setup.ts` are `localhost`, `5432`, `monize_user`, `monize_password`, `monize_test`. `pretest:integration` creates `monize_test` when it is missing. Set the `DATABASE_*` variables explicitly, as CI does: some suites (the event bus) read them without those defaults. The role needs CREATEROLE (the enforced-RLS harness) and CREATEDB (`backend/test/integration/migration-path.integration.spec.ts`); each suite names the missing privilege when it fails. Every suite rebuilds the schema (`synchronize`, `dropSchema`): never start two database-backed runs on one database, including two agents.
- E2E needs Docker (`docker compose -f docker-compose.e2e.yml up -d --wait` from the repository root) and the browsers (`npx playwright install chromium firefox`). `playwright.config.ts` also starts the stack itself when `CI` is unset.
- Without the database or Docker, the result is BLOCKED. Say which required test kind is still unproven.

## Choosing the level

`docs/verification-contract.md` sections 1 and 3 say which kind of test an invariant needs. Where each kind lives here:

| Need | Use | Pattern to copy |
|---|---|---|
| Pure logic, arithmetic, validation branches | a unit test in the layer | the spec beside the module |
| A mistake that must appear nowhere | a source-scanning guard; read `docs/guard-tests.md` first | `backend/src/common/fx-fallback.guard.spec.ts`, `frontend/src/test/ui-conventions.test.ts` |
| A backend service unit test | `scopedDbMockModule()` from `backend/src/test-helpers/scoped-db-testing.ts`; typed doubles for our own services | `docs/backend/testing.md` |
| The identity a query runs under, without a database | the real `withScopedDb` at `RLS_MODE=enforce`, recording the context of each call | `backend/src/delegation/rls-context-smoke.spec.ts` |
| SQL semantics, constraints, cascades, the application's ownership predicate | integration with `createIntegrationModule` (owner connection; RLS is bypassed) | `backend/test/integration/security-cross-user-isolation.integration.spec.ts` |
| RLS policies | integration with `createEnforcedIntegrationModule`; seed through `owner`; first assert that the harness enforces | `backend/test/integration/calendar-read-models.integration.spec.ts`, `backend/test/integration/transaction-rules.integration.spec.ts` |
| One winner, lost updates, lock order | two real connections, or a deterministic barrier: one transaction holds `FOR UPDATE`, wait until the other is blocked (`pg_stat_activity`), then release | `backend/test/integration/single-use-token.integration.spec.ts`, `backend/test/integration/holding-concurrent-trades.integration.spec.ts` |
| A crash between an effect and its commit | a failpoint at the boundary (a `RAISE EXCEPTION` trigger, or a spy that throws after the real call), plus a control case without it | `backend/test/integration/logout-revoke-failpoint.integration.spec.ts`, `backend/test/integration/transaction-rules-import.integration.spec.ts` |
| A migration over existing data | recreate the old shape, seed legacy rows, apply the migration file from disk | `backend/test/integration/migration-149-backfill.integration.spec.ts`, `backend/test/integration/migration-path.integration.spec.ts` |
| Files and atomic writes | a real temporary directory (`mkdtemp`), never a mocked `fs` | `backend/src/backup/atomic-file.spec.ts` |
| A clock-dependent rule | fake `Date` only, moved through one helper | `withClockAt` in `backend/src/backup/auto-backup.service.spec.ts` |
| A rule both layers implement | one shared case table that both layers' tests read | `backend/src/common/phone-number-cases.json` with `frontend/src/lib/phone-number.contract.test.ts` |
| A component | `render` from `@/test/render`; API modules mocked with `vi.mock` (spread `importOriginal` for a partial mock) | `docs/frontend/testing.md` |
| What the user sees, persistence after a reload, browser state | Playwright: seed through `e2e/helpers/factories.ts`, one fresh user per test (`e2e/fixtures.ts`) | `e2e/CLAUDE.md` |

Two traps specific to this repository:

- The production default is `RLS_MODE=off` (`docs/row-level-security-contract.md` section 1), so the application's own ownership predicate is the protection most deployments run with. A cross-user test that runs only under the enforced harness can pass on the policy while that predicate is missing. Test the predicate with `createIntegrationModule`, and the policy with the enforced harness.
- Backend unit specs mock `withScopedDb` away, so they cannot see an identity or tenancy defect (`docs/backend/database-access-and-tenancy.md`). A unit test whose mock returns `null` for "another user's row" proves only that the service throws on `null`.

## Documentation-only changes

No suite runs. Run the checks that read what you edited, and report the suites as NOT RUN with the reason "documentation only":

| You edited | Run |
|---|---|
| A backticked path in a `CLAUDE.md`, `AGENTS.md`, `docs/*.md`, `docs/backend/*.md` or `docs/frontend/*.md` | `cd backend && npm run test:unit -- src/common/doc-paths.spec.ts` (a new document is scanned only once tracked: `git add -N` it) |
| `AGENTS.md` or a `CLAUDE.md` (size ceilings, issue numbers, wording near the banned database calls, control bytes) | `cd backend && npm run test:unit -- src/common/instruction-files.spec.ts src/common/db/lint-bans.spec.ts src/common/source-bytes.spec.ts` |
| A comment in `backend/src` or in a migration that names a path | `cd backend && npm run test:unit -- src/common/source-comment-paths.spec.ts` |
| `docs/system-invariants.md` or `docs/verification-contract.md` | `cd backend && npm run test:unit -- src/common/invariant-catalog-parity.spec.ts` |
| `docs/cron-jobs.md` | `cd backend && npm run test:unit -- src/common/cron-doc.spec.ts` |
| An npm script, a compose file or a Helm value named in a document | `node scripts/check-docs-manifests.mjs` (repository root) |

A Markdown file under `.claude/` is read by none of these.

## Reviewing a test diff

From the repository root. Stage new files first (`git add -N <file>`): `git diff` does not show untracked files. `B` is the base of the change.

```bash
B=$(git merge-base origin/main HEAD)
T=(-- '*.spec.ts' '*.test.ts' '*.test.tsx' 'e2e/*.ts')
# focus and skip markers added
git diff -U0 "$B" "${T[@]}" | grep -nE '^\+.*(\b(it|test|describe)\.(only|skip|todo|fixme|skipIf)\b|\b(fit|fdescribe|xit|xdescribe|xtest)\()'
# assertion lines removed, then added
git diff -U0 "$B" "${T[@]}" | grep -cE '^-[^-].*\bexpect\('
git diff -U0 "$B" "${T[@]}" | grep -cE '^\+[^+].*\bexpect\('
# runner configuration, harness, guards, workflows and snapshots touched
git diff --stat "$B" -- backend/package.json backend/test/jest-e2e.json backend/test/helpers frontend/vitest.config.ts frontend/src/test e2e/playwright.config.ts e2e/playwright.push.config.ts e2e/fixtures.ts .github/workflows '*.guard.spec.ts' '*.guard.test.ts' '*.snap'
```

Each line these print needs a reason in the report. A `grep` that prints nothing exits 1; that is the expected result.

## What enforces what

Controls (a violation fails a check):

- runner exit codes and the coverage thresholds, in the CI jobs above;
- REL-001: `backend/src/common/jest-config.guard.spec.ts` (no pass-with-no-tests flag on any runner surface, no discovery flags in scripts, every integration suite discoverable);
- frontend tests fail on an act() warning or a missing translation (`frontend/src/test/act-guard.ts`, `frontend/src/test/intl-guard.ts`), and on the patterns in `frontend/src/test/test-hygiene.test.ts` and `frontend/src/test/e2e-conventions.test.ts`;
- `test.only` fails Playwright when `CI` is set (`forbidOnly`); Vitest refuses `.only` when `CI` is set (`--allowOnly` defaults to `!process.env.CI`);
- the source-scanning guards (`docs/verification-contract.md` section 6 and the layer documents), migration lint, schema drift, documentation checks and instruction-file ceilings;
- `.github/workflows/pr-checklist.yml`: the PR template is ticked and the linked item carries `approved-to-build`.

A guard rail for Claude Code agents only: the `PreToolUse` hook `.claude/hooks/require-reliable-tests.mjs`, registered in `.claude/settings.json`, refuses an Edit, Write, MultiEdit or NotebookEdit of a test file, a test helper or a runner configuration until the session's transcript shows this skill loaded (the Skill tool, or `/reliable-tests`). Its own tests: `node --test .claude/hooks/require-reliable-tests.test.mjs` from the repository root; CI does not run them. It does not see a file written through Bash, other agents do not run it, it lets the edit through when it cannot read its input or the transcript, and it shows that the skill was loaded, not that it was followed.

Not controlled today (a reviewer is the only check):

- Jest has no protection against `.only`, no layer lints `.skip` or `.only`, and nothing reports a new skip.
- Nothing counts the executed tests or compares the count with an earlier run (REL-002).
- Playwright retries a failed test twice in CI; a test that passes on a retry is green.
- No CODEOWNERS file and no branch-protection policy in the repository (REL-007). Changes to tests, guards, thresholds, runner configuration and workflows are protected only by review.
- The Frontend Bundle Size job reports sizes and fails on nothing.
- The backend `test:e2e` suites do not run; the MinIO suite (`backend/test/integration/backup-store-s3.integration.spec.ts`) is skipped in CI.
- This skill, `AGENTS.md` and a second agent are instructions, not controls.
