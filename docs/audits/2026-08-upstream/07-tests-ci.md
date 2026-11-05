# Monize Full Read-Only Audit - Phase 7: Tests, CI, Required Checks, and Verification Coverage

## Report metadata

| Field | Value |
|---|---|
| Repository | `kenlasko/monize` |
| Audit phase | Phase 7 - Tests, CI, Required Checks, and Verification Coverage |
| Worker chat | `07 - Monize Audit: Tests, CI, Required Checks, and Verification Coverage` |
| Audited baseline | `d5cea9bfa995885ba5198f9843359362927c0fd4` |
| Evidence rule | Every repository file used as evidence was re-fetched with `ref=d5cea9bfa995885ba5198f9843359362927c0fd4` |
| Access mode | Read-only GitHub connector reads; no clone, checkout, branch, commit, review, workflow action, or repository-setting change |
| Tests executed by this audit | None |
| CI runs executed or rerun by this audit | None |
| Report filename | `monize-audit-07-tests-ci.md` |
| Completion status | Complete with explicitly qualified inventory and CI-history limitations |

## Executive summary

Phase 7 examined whether the repository's test suites and CI configuration can reliably detect the confirmed defects from Phases 1-6. The answer is mixed. The repository has substantial automated verification: high aggregate unit-test thresholds, real PostgreSQL integration suites, an RLS enforcement harness, four isolated Playwright shards against a real application stack, schema/migration drift checks, production dependency auditing, Docker image builds, and several security scanners. Those controls should be preserved.

The strongest existing tests exercise ordinary single-operation behavior, service-level cross-user isolation, and RLS policy enforcement. They do not, however, reliably verify several of the audit's material invariants. Five Phase 7 findings are tests that actively encode known-bad behavior. The most important examples are missing FX being accepted as a 1:1 conversion, a scheduled override's stored price being replaced merely by opening an editor, historical stock splits being replayed as additive quantities, logout failure being presented as success, and automatic backups using a shared filename/retention namespace. A green run containing those assertions is evidence that the defect remains, not evidence that it is fixed.

A second major limitation is concurrency fidelity. Real PostgreSQL tests exist, but the canonical races identified in Phase 4 generally stop at a unit mock, a single service instance, one transaction manager, or a test of a different conflict boundary. The MNY integration test, for example, strongly verifies that only one worker can claim the same already-created job, but it does not verify that two concurrent `start` requests cannot create two independently active jobs. Similar production-boundary gaps exist for transaction snapshots, scheduled posting, balance recomputation, holdings rebuilds, emergency claims, and logout/refresh-family rotation.

The CI pipeline is broad, but two exact enforcement defects were confirmed. Backend integration discovery uses `--passWithNoTests`, so an accidental discovery regression can produce a green integration job that ran zero integration tests. The manual release workflow tests and builds one SHA, then directly pushes a different version-bump commit to protected `main` using an administrator token and a `[skip ci]` message; the new commit is not verified at its own SHA before it becomes branch head.

### Confirmed finding count by severity

| Severity | Count |
|---|---:|
| BLOCKER | 0 |
| HIGH | 1 |
| MEDIUM | 8 |
| LOW | 1 |
| **Total confirmed findings** | **10** |

One additional `MEDIUM` design risk is recorded separately because the immutable workflow inventory could not be proven recursively: no discovered workflow validates Helm rendering/default installation or backup persistence, but connector limitations prevent claiming that no such workflow exists anywhere in the baseline tree.

### Confirmed finding count by classification

| Classification | Count |
|---|---:|
| Confirmed incorrect test | 5 |
| Confirmed CI defect | 2 |
| Confirmed missing test | 2 |
| Stale documentation | 1 |
| Design risk, not counted as a confirmed defect | 1 |

## 1. Phase scope

This phase audited:

- test frameworks, discovery, configuration, and coverage thresholds;
- frontend Vitest setup and rendering helpers;
- backend Jest unit and PostgreSQL integration setup;
- RLS enforcement fidelity and ordinary integration-test RLS state;
- Playwright configuration, fixtures, browser matrix, retry behavior, and full-stack environment;
- test helpers, factories, provider mocks, clocks, locales, timezones, randomness, and concurrency orchestration;
- tests related to all canonical HIGH roots and the mandatory Phase 2-6 regression backlog;
- migration/schema verification, Docker/Compose coverage, and discovered Helm guidance;
- every discovered GitHub Actions workflow, its triggers, permissions, job dependencies, conditions, retries, artifacts, and release path;
- available status and workflow-run evidence for the fixed baseline SHA;
- contradictions between repository instructions, documentation, test configuration, workflow configuration, and actual test behavior.

This was not a style review. A test or CI issue is reported only where a realistic known defect can remain while the suite or workflow appears green, where a test explicitly validates known-bad behavior, or where documentation materially misstates the verification contract.

## 2. Audited baseline SHA

```text
AUDIT_BASELINE_SHA=d5cea9bfa995885ba5198f9843359362927c0fd4
```

The baseline commit was fetched successfully. No later `main` head, pull-request head, synthetic merge commit, merge-queue commit, PR #1014 short head `8fd4c4f`, search-result branch link, or other revision was used as evidence. Search was used only to discover candidate paths. Each evidentiary file was then fetched again at the exact baseline SHA.

## 3. Method

1. Re-established the fixed baseline by fetching the exact commit object.
2. Read the scoped instruction hierarchy before implementation and test code.
3. Attempted immutable recursive inventory discovery. The connector did not expose a usable recursive tree, so the test inventory was built from pinned configuration, targeted repository search for candidate paths, explicit directory/document references, and exact-SHA re-fetches of every evidentiary file.
4. Inspected framework configuration, discovery expressions, coverage collection, setup files, integration helpers, Playwright fixtures, and CI workflows.
5. Re-fetched and reviewed the mandatory wrong-test targets.
6. Followed each canonical HIGH root to the most relevant unit, integration, frontend, or E2E tests and classified coverage as strong, partial, incorrect, unit-only, mocked-away, not located, confirmed missing, inaccessible, or not applicable.
7. Distinguished a test of a nearby behavior from a test of the production conflict boundary. In particular, one JavaScript promise queue or one mocked transaction manager was not accepted as evidence for a multi-connection database race.
8. Requested combined commit status and workflow-run evidence for the baseline SHA. No evidence was returned.
9. Did not execute tests, builds, containers, migrations, browsers, Helm, or workflows because the audit is read-only and the environment cannot clone the repository.
10. Recorded false positives and positive controls so that missing coverage is not overstated.

## 4. Repository instruction hierarchy

The following baseline-pinned instruction hierarchy was applied, with the nearest scoped `CLAUDE.md` taking precedence for its subtree:

| Precedence | Path | Scope and relevant testing rule |
|---:|---|---|
| 1 | `CLAUDE.md` | Repository-wide commands, regression-test requirement, `TZ=UTC` convention, one Playwright worker in CI, RLS/`withScopedDb` requirements, decimal money conventions, migration and release expectations |
| 2 | `backend/CLAUDE.md` | Backend Jest thresholds, coverage exclusions, unit-mock conventions, PostgreSQL integration expectations, RLS smoke checks, and cron behavior in every replica |
| 2 | `frontend/CLAUDE.md` | Vitest conventions, custom English render helper, i18n parity/pseudo-locale rules, frontend thresholds, and cache-invalidation guard expectations |
| 2 | `database/CLAUDE.md` | Migration/schema rules, idempotency, and database verification expectations |
| 3 | `backend/src/mcp/CLAUDE.md` | MCP-subtree constraints |
| Auxiliary | `.claude/settings.json` | Tooling permissions and local agent settings |
| Auxiliary, potentially stale | `.claude/skills/backend.md` | Older backend workflow that still describes direct repository/QueryRunner patterns |
| Auxiliary, potentially stale | `.claude/skills/frontend.md` | Frontend workflow summary |
| Auxiliary, potentially stale | `.claude/skills/infrastructure.md` | Older infrastructure description, including outdated browser/port/schema assumptions |
| Contributor guidance | `CONTRIBUTING.md` | Contributor commands and patterns; several statements conflict with current scoped instructions and implementation |
| Security guidance | `SECURITY.md` | Security policy and reporting guidance |

No `AGENTS.md` was located through repository search, and direct reads of likely root/backend/frontend locations returned no file. Because an immutable recursive tree was unavailable, recursive absence is unproven.

## 5. Confirmed findings

### P7-001 - Tests explicitly validate missing FX as a successful 1:1 conversion

- **Classification:** confirmed incorrect test
- **Severity:** MEDIUM
- **Confidence:** high
- **Related roots:** P5-009 / P6-006
- **Evidence:**
  - `frontend/src/hooks/useExchangeRates.test.ts:90-190`
  - `backend/src/securities/portfolio.service.spec.ts:760-850`
- **Violated verification invariant:** A missing direct and inverse exchange rate must remain distinguishable from a valid same-currency rate of `1.0000`; aggregate results must expose unavailable pairs and completeness instead of returning a valid-looking destination-currency number.
- **Observed assertion:** The frontend hook returns the original numeric amount when neither rate exists. The backend portfolio test explicitly expects a rate of `1` when neither direction is available and accepts an unconverted foreign holding in the portfolio total.
- **Realistic green-suite scenario:** A user has `100.00 USD`, requests a CAD total, and no USD/CAD or CAD/USD rate is available. The tested behavior returns numeric `100.00` and downstream UI labels or aggregates can present it as `100.00 CAD`. The suite remains green because both layers assert that behavior. If the eventual valid rate is `1.3500`, the displayed total is understated by `35.00 CAD`; more fundamentally, at the time of calculation there is no valid numeric expected total at all.
- **Impact:** Financial dashboards, portfolio summaries, and aggregate reports can look complete while silently using a fabricated 1:1 conversion. Users can make allocation, net-worth, or reconciliation decisions from a materially false total.
- **Recommended correction:** Replace numeric-only conversion APIs with a typed result such as `{ status: 'ok', value, rate, source, asOf }` or `{ status: 'unavailable', from, to }`. Preserve same-currency `1.0000` as an explicit successful result. Propagate missing-pair and completeness metadata through backend DTOs, frontend adapters, and aggregate components.
- **Recommended regression test:**
  1. `100.00 USD -> USD` returns `ok`, value `100.00`, rate `1.0000`.
  2. `100.00 USD -> CAD` with direct `1.3500` returns `135.00 CAD`.
  3. With only inverse `0.7407407`, return approximately `135.00 CAD` within the repository's rounding contract.
  4. With neither rate, return `unavailable`, no numeric destination total, and aggregate completeness `partial` with pair `USD/CAD` listed.
  5. Verify that a consumer cannot render the source amount with the destination currency label.
- **Verification method:** Re-fetch the two tests and the associated conversion implementations at the baseline SHA; run corrected unit tests plus a backend/frontend contract test after the implementation is changed.

### P7-002 - The scheduled-override component test expects opening the dialog to replace the stored price

- **Classification:** confirmed incorrect test
- **Severity:** MEDIUM
- **Confidence:** high
- **Related root:** P6-005
- **Evidence:** `frontend/src/components/scheduled-transactions/OverrideEditorDialog.test.tsx:480-680`, especially the latest-price auto-fill assertions around `580-591`
- **Violated verification invariant:** Existing override values must remain unchanged until the user explicitly chooses to apply a refreshed market price. A date-only or description-only edit must preserve quantity, price, total, and commission.
- **Observed assertion:** The test opens the editor and expects the price field to be populated from the latest market quote. It does not assert an explicit user action before replacement, nor does it verify that saving an unrelated field preserves the stored price.
- **Realistic green-suite scenario:** The stored override has price `250.00`; the latest quote is `123.45`. The user opens the dialog only to change the date and saves. The tested behavior can persist `123.45`, changing the transaction by `-126.55` per share without informed consent, while the component suite remains green.
- **Impact:** Silent mutation of investment history, scheduled cash requirements, commissions, holdings, and future projections.
- **Recommended correction:** Keep the stored override price as the editable value. Show the latest quote as a separately labeled suggestion with source and timestamp. Require an explicit `Apply latest price` action, and mark the form dirty only after that action.
- **Recommended regression test:** Start with quantity `4`, price `250.00`, commission `5.00`, total `1005.00`, and latest quote `123.45`. Open the dialog, edit only the description, save, and assert all four financial fields remain exactly unchanged. Add a second test where the user explicitly applies `123.45`, then verify the expected recalculated total and submitted payload.
- **Verification method:** Re-fetch component and test at the fixed SHA; use controlled deferred quote promises to prove that both early and late quote responses cannot mutate an existing override without explicit user action.

### P7-003 - Historical stock-split replay is tested as addition rather than multiplication

- **Classification:** confirmed incorrect test
- **Severity:** MEDIUM
- **Confidence:** high
- **Related root:** P5-011
- **Evidence:** `backend/src/net-worth/net-worth.service.spec.ts:300-560`, especially the historical split fixture/assertions around `429-511`
- **Violated verification invariant:** A stock split quantity represents a ratio. Historical replay must multiply shares by the ratio, preserve total basis, and correctly compose reverse and sequential splits.
- **Observed assertion:** The test starts with `90` shares, supplies a split quantity of `90`, and expects `180`, matching additive replay (`90 + 90`) rather than ratio semantics.
- **Realistic green-suite scenario:** A real 2-for-1 split is stored as ratio `2.0`. The additive implementation produces `92` shares from `90` instead of `180`, an error of `-88` shares. Conversely, if the test's literal `90.0` were interpreted as a ratio, the expected result would be `8,100`, not `180`. The current fixture therefore cannot distinguish the defect from correct behavior.
- **Impact:** Materially incorrect historical holdings, cost-per-share, net worth, realized/unrealized gains, and any report replaying transactions before or after a split.
- **Recommended correction:** Define the field and DTO contract as a positive split ratio and multiply historical quantity by it. Divide average cost per share by the same ratio while preserving total basis. Validate unsupported zero/negative ratios.
- **Recommended regression test:**
  - `90` shares at `10.00` basis/share with ratio `2.0` -> `180` shares at `5.00`, total basis `900.00`.
  - Ratio `0.5` -> `45` shares at `20.00`, same total basis.
  - Sequential ratios `2.0` then `0.25` -> `45` shares.
  - Literal ratio `90.0` -> `8,100` shares, proving the fixture cannot be interpreted additively.
- **Verification method:** Re-fetch service and spec at the baseline; add unit replay tests and an integration test using persisted investment transactions and the net-worth query path.

### P7-004 - The AppHeader test validates a false-success logout contract

- **Classification:** confirmed incorrect test
- **Severity:** MEDIUM
- **Confidence:** high
- **Related roots:** P4-011 / P6-010
- **Evidence:** `frontend/src/components/layout/AppHeader.test.tsx:90-130`
- **Violated verification invariant:** The UI must not tell the user logout succeeded when server-side refresh-family revocation failed and a valid session may remain usable. Local state clearing is not equivalent to server logout.
- **Observed assertion:** The test named `still logs out and redirects when authApi.logout fails` rejects the logout API call and then expects local logout plus navigation to `/login`.
- **Realistic green-suite scenario:** A network or server failure prevents refresh-token-family revocation. The browser clears local state and redirects, so the user sees a successful logout screen, but a refresh token cookie may still be accepted later or on another tab/device. The suite remains green because it explicitly requires the false-success presentation.
- **Impact:** Misleading security state, retained session capability on shared devices, and reduced confidence in emergency account-protection actions.
- **Recommended correction:** Represent logout as `confirmed`, `local-only/pending`, or `failed`. When server revocation fails, do not claim completion; retry or direct the user to close the browser and revoke sessions from a verified endpoint. Ensure cookie-clearing semantics and backend family revocation are coordinated.
- **Recommended regression test:** Reject `authApi.logout`, assert that a visible localized warning states server logout was not confirmed, assert no success toast, and verify the state machine does not mark the session server-revoked. Add a backend integration race with two independent connections: refresh rotation and family revocation must not leave an accepted descendant token.
- **Verification method:** Re-fetch AppHeader/auth store/token service at the baseline; verify corrected component behavior and a real PostgreSQL refresh/logout race.

### P7-005 - Automatic-backup tests validate a cross-tenant filename and retention namespace

- **Classification:** confirmed incorrect test
- **Severity:** MEDIUM
- **Confidence:** high
- **Related root:** P3-001
- **Evidence:** `backend/src/backup/auto-backup.service.spec.ts:430-780`
- **Violated verification invariant:** Each owner's automatic backups must have a tenant-isolated object/path namespace, and retention must delete only backups belonging to the same owner and instance.
- **Observed assertion:** The unit suite expects generic date-based names such as `monize-backup-daily-...` and tests retention against a shared generic listing. It uses one mocked owner and cannot expose filename collision or cross-owner deletion.
- **Realistic green-suite scenario:** User A and User B run daily backup on the same date against the same destination. Both select the same key. One overwrites the other, or retention for one owner deletes the other's object. The test remains green because the generic namespace is the expected value.
- **Impact:** Cross-tenant backup overwrite/deletion, loss of recovery points, possible disclosure when a user restores an object containing another user's data, and operational ambiguity across multiple instances.
- **Recommended correction:** Include an immutable owner identifier and deployment/instance namespace in every automatic-backup key. Scope list, retention, and deletion operations to that prefix. Use atomic creation semantics where the provider supports them.
- **Recommended regression test:** Use User A, User B, Instance 1, and Instance 2 with the same timestamp. Assert four distinct keys. Populate retention candidates in all four prefixes, run retention for A/1, and assert no object outside A/1 is listed or deleted. Repeat with local and S3-compatible provider fakes.
- **Verification method:** Re-fetch auto-backup service/spec and storage providers at the baseline; add provider integration tests that inspect actual keys and delete calls.

### P7-006 - Backend integration discovery can pass after running zero integration tests

- **Classification:** confirmed CI defect
- **Severity:** MEDIUM
- **Confidence:** high
- **Evidence:**
  - `backend/package.json:18-28`
  - `.github/workflows/ci.yml:95-145`
- **Violated verification invariant:** The mandatory backend integration job must fail when its discovery expression finds no integration suites. A green integration check must prove at least one intended test was executed.
- **Observed configuration:** `test:integration` invokes Jest with `--testPathPatterns='test/integration/.*\.spec\.ts$' --runInBand --passWithNoTests`, and the CI job runs that script directly.
- **Realistic green-suite scenario:** A directory rename, Jest CLI behavior change, pattern escaping error, or accidental suite move causes discovery to match zero files. Jest exits successfully because `--passWithNoTests` is present. CI reports `Backend Integration Tests` green while RLS, PostgreSQL transactions, and cross-user integration behavior were not exercised.
- **Impact:** Broad false confidence for security, RLS, migration-adjacent, transaction, and import behavior. This is particularly material because many audit invariants rely on the integration layer to compensate for simplified unit mocks.
- **Recommended correction:** Remove `--passWithNoTests`. Add an explicit immutable discovery guard that lists tests and fails below an expected minimum or when mandatory suite names are absent. Emit the discovered file list and test count as an artifact or job summary.
- **Recommended regression/CI test:** Add a CI self-test that runs the discovery command, records the count, and asserts the RLS enforcement, cross-user isolation, transaction, transfer, MNY, backup/support-backup, and security-transfer suites are present before executing Jest.
- **Verification method:** Temporarily evaluate the discovery command on a branch with the integration directory deliberately renamed; the job must fail before merge. Do not use `--passWithNoTests` in the production workflow.

### P7-007 - The release workflow pushes an unverified version-bump commit to protected `main`

- **Classification:** confirmed CI defect
- **Severity:** MEDIUM
- **Confidence:** high
- **Evidence:** `.github/workflows/ci.yml:650-735`
- **Violated verification invariant:** The exact commit that becomes protected-branch head and is represented by repository package manifests must be the commit that passed the required verification set, or must be deterministically proven equivalent by an enforced post-commit check.
- **Observed configuration:** The manual release path runs gates for the workflow's starting SHA, stamps/builds signed images, then checks out with an administrator `RELEASE_TOKEN`, changes package manifests and lockfiles, commits `chore: bump version ... [skip ci]`, rebases, and pushes directly to `main`. Workflow comments explicitly state that the administrator token bypasses the required checklist status and that `[skip ci]` is used.
- **Realistic green-suite scenario:** The tested parent SHA passes. The subsequent `npm version` mutation changes four files and produces a distinct commit. A lockfile inconsistency, package-script side effect, rebase interaction, or future versioning hook introduces a defect. That new commit becomes `main` head without running lint, unit, integration, E2E, schema, or image-build checks at its own SHA.
- **Impact:** Protected-branch and release provenance no longer mean that branch head passed verification. The repository commit and already-built image can also diverge in subtle ways.
- **Recommended correction:** Generate the version-bump commit first on a release branch/PR and run the full required gate set on that exact SHA, or create the commit in the workflow and run the verification graph after the commit before an atomic protected push. Avoid administrator bypass for routine release automation. Bind image attestations and the GitHub release to the exact committed SHA.
- **Recommended regression/CI test:** Add a release dry-run job that creates the intended commit, records `git rev-parse HEAD`, reruns manifest/lockfile consistency plus the required verification set on that SHA, and refuses push/release if `tested_sha != pushed_sha` or `image_revision != pushed_sha`.
- **Verification method:** Inspect workflow logs for a future release and compare starting SHA, post-version commit SHA, pushed SHA, image OCI revision annotation, and release target. All must identify the same verified commit.

### P7-008 - Canonical concurrency defects lack deterministic tests at the production conflict boundary

- **Classification:** confirmed missing test
- **Severity:** HIGH
- **Confidence:** medium
- **Related roots:** P4-001, P4-002, P4-003, P4-004, P4-005, P4-006, P4-007; also P4-008 through P4-018 as backlog
- **Evidence:**
  - `backend/test/integration/mny-import-job.integration.spec.ts:1-420`
  - `backend/test/integration/transactions.integration.spec.ts:1-260`
  - `backend/src/scheduled-transactions/scheduled-transactions.service.spec.ts:1-2700`
  - `backend/src/securities/holdings.service.spec.ts:1-1200`
  - `backend/src/emergency-access/emergency-access.service.spec.ts:1-1400`
  - `backend/src/auth/token.service.spec.ts:1-1000`
  - `backend/src/test-helpers/scoped-db-testing.ts:1-400`
  - `docs/cron-jobs.md:1-25`
- **Violated verification invariant:** A concurrency regression test must exercise the same conflict boundary as production: independent database connections/transactions or application instances, deterministic barriers, and externally visible side effects. One mock manager, one service instance, or `Promise.all` around a different row-level operation is insufficient.
- **Observed coverage:**
  - MNY has a valuable real-PostgreSQL test proving one winner when multiple workers claim the same already-created job. It does not race two `start` requests that can create two different active jobs, nor a retry after source data has committed.
  - Transaction integration tests create/update/remove sequentially and do not hold stale snapshots across transactions.
  - Scheduled posting is covered by a large mocked unit suite; ordinary integration setup stubs the scheduled-transactions module.
  - Holdings tests use the scoped-db mock and one manager; no rebuild/update race is orchestrated.
  - Emergency-access and token tests use mocked transaction managers. The token unit test asserts a pessimistic lock request, but no independent refresh/logout transactions contend.
  - Repository documentation confirms every backend replica fires every cron, while no reviewed test starts two scheduler instances against one database.
- **Realistic green-suite scenarios:** Two API requests create independent MNY jobs; two scheduler replicas post the same occurrence; an update writes a balance derived from a stale snapshot; a holdings rebuild overwrites a concurrent trade; two claim requests consume one emergency token; logout revocation races refresh rotation. Existing suites can remain green because none deterministically reaches those conflict windows.
- **Impact:** Duplicate financial records, lost updates, corrupted balances/holdings, repeated notifications, replayed imports, or multiple consumption of single-use security grants. The breadth spans seven current canonical HIGH roots, which makes the verification gap itself HIGH severity.
- **Recommended correction:** Build a reusable PostgreSQL race harness with two or more independently acquired connections, explicit transaction isolation, named barriers/latches, and optional multiple Nest application/scheduler instances. Avoid sleep-only synchronization. Assert both database state and provider side effects.
- **Recommended regression tests:**
  1. Two simultaneous MNY `start` requests -> exactly one active import; retry after committed data -> no duplicate source rows.
  2. Two update/delete transactions load the same snapshot, pause, then commit -> serializable invariant or deterministic conflict/retry.
  3. Two scheduled posters for the same occurrence -> one posted transaction and one idempotency record.
  4. Recompute versus concurrent delta -> final balance equals opening plus committed transactions.
  5. Holding rebuild versus buy/sell -> no lost quantity or basis.
  6. Two emergency-claim completions -> one succeeds, one fails, one grant side effect.
  7. Refresh rotation versus family revocation -> no accepted live descendant after confirmed logout.
- **Verification method:** Execute each test repeatedly against PostgreSQL with barriers, not sleeps; vary transaction ordering and run selected cases against two application instances.

### P7-009 - Restore tests do not verify local or S3 attachment bytes across a round trip

- **Classification:** confirmed missing test
- **Severity:** MEDIUM
- **Confidence:** high
- **Related root:** P3-002; also P4-010
- **Evidence:**
  - `backend/src/backup/backup.service.spec.ts:1-900`
  - `e2e/tests/backup.spec.ts:1-220`
  - `e2e/ROADMAP.md:1-260`
- **Violated verification invariant:** Restore must not only remap attachment metadata; it must ensure every restored metadata row points to bytes that exist in the selected provider under the remapped key, with compensating cleanup on partial failure.
- **Observed coverage:** The backend backup service suite mocks repositories, file/storage behavior, and OIDC authorization. The browser backup suite verifies export/download behavior but explicitly defers restore round trips. The E2E roadmap lists restore/encrypted restore as deferred. No reviewed test seeds attachment bytes in local and S3-compatible providers, exports, restores into a clean owner, and downloads the restored object.
- **Realistic green-suite scenario:** A backup includes attachment metadata. Restore remaps database IDs and storage keys but never copies the object bytes. The database transaction succeeds and all current tests pass. The attachment appears in the UI but download later returns missing-object/404. A partial copy failure can also leave orphaned bytes or metadata.
- **Impact:** Silent data loss discovered only during recovery, broken evidence/receipt attachments, and storage leaks after failed restore.
- **Recommended correction:** Make restore's attachment phase explicit and transactional at the application level: stage/copy bytes, verify content length/hash, commit metadata, and compensate provider writes on database or provider failure. Report partial failure honestly if atomicity across database and object store is impossible.
- **Recommended regression test:** Parameterize over local filesystem and an S3-compatible test service. Seed two attachments with known hashes, export, restore into a clean user with ID remapping, then fetch both through the public download path and compare bytes/hashes. Inject failure after the first object copy and assert no committed dangling metadata and no uncompensated object.
- **Verification method:** Run the provider-parameterized integration suite and a browser restore/download smoke test against the full stack.

### P7-010 - No discovered CI path validates Helm rendering, default installation, or backup persistence

- **Classification:** design risk
- **Severity:** MEDIUM
- **Confidence:** medium
- **Related root:** P3-006
- **Evidence:**
  - `.github/workflows/ci.yml:1-1180`
  - `.github/workflows/lighthouse.yml:1-420`
  - `.github/workflows/zap.yml:1-600`
  - `.github/workflows/fork-images.yml:1-600`
  - `.github/workflows/ghcr-cleanup.yml:1-500`
  - `.github/workflows/bearer-exceptions-review.yml:1-500`
  - `helm/README.md:1-260`
  - `helm/values.yaml:1-800`
- **Violated verification invariant:** A releaseable deployment chart should be rendered and smoke-tested with its defaults, including persistence needed by automatic backup/restore, before images/releases are published.
- **Observed evidence:** The chart documentation describes manual `helm lint`, `helm template`, and dry-run commands. No Helm invocation was found in the discovered workflows. CI builds Docker images and starts a Compose stack, but does not render/install the chart, replace a pod, or verify a backup volume. Because the connector did not expose a complete immutable workflow-directory listing, this remains a design risk rather than a confirmed repository-wide absence.
- **Realistic scenario:** A template/value mismatch or absent default backup volume ships in signed images/releases while all discovered checks remain green. A user installs the documented defaults and automatic backups are written to ephemeral or unwritable storage.
- **Impact:** Deployment failure, non-persistent recovery data, and release confidence that does not cover the supported Kubernetes artifact.
- **Recommended correction:** Add chart lint/render tests for default, Ingress, HTTPRoute, RLS enforce, local attachment, S3, and backup-persistence values. Add a kind/k3d smoke test that installs the chart, initializes/migrates the database, creates a backup, replaces the backend pod, and verifies the backup persists.
- **Recommended regression/CI test:** Require `helm lint`, `helm template`, schema validation, and a minimal install/upgrade test before release. Include a default-values assertion that the automatic-backup path is backed by the intended persistent volume.
- **Verification method:** First obtain a complete immutable workflow tree; if no existing equivalent job exists, implement and require the chart job.

### P7-011 - Testing and deployment documentation conflicts with the executable configuration

- **Classification:** stale documentation
- **Severity:** LOW
- **Confidence:** high
- **Evidence:**
  - `frontend/CLAUDE.md:1-30` versus `frontend/vitest.config.ts:1-40`
  - `CONTRIBUTING.md:1-500` versus `backend/CLAUDE.md` and current scoped-database helpers
  - `.claude/skills/infrastructure.md:1-500` versus `e2e/playwright.config.ts` and `docker-compose.e2e.yml`
  - `helm/README.md:1-260` versus `helm/Chart.yaml` and `helm/values.yaml`
- **Violated verification invariant:** Maintainer-facing verification instructions must describe the commands and thresholds that CI actually enforces, especially where contributors decide whether a change is ready to merge.
- **Observed contradictions:**
  - Frontend scoped instructions state an `85%` branch threshold; executable Vitest configuration uses `84%`.
  - Contributor/auxiliary guidance retains older QueryRunner/direct-repository or integer-cent assumptions that conflict with current `withScopedDb` and decimal contracts.
  - Infrastructure guidance describes a Chromium-only or older stack while Playwright runs Chromium and Firefox and current Compose ports/settings differ.
  - Helm documentation contains path/default examples that do not consistently match the chart root and current values.
- **Realistic scenario:** A contributor follows documentation, runs a different or weaker verification set, and reasonably believes the change matches CI. A deployment operator follows a stale Helm path/default and receives an installation or resource-sizing failure.
- **Impact:** Avoidable failed PRs, missed local regressions, and incorrect deployment preparation. The impact is bounded because executable CI remains authoritative.
- **Recommended correction:** Generate threshold/command tables from executable configuration where practical. Remove obsolete auxiliary patterns, or mark them historical. Add a documentation consistency test for threshold values, browser projects, chart path, and key defaults.
- **Recommended regression test:** A script should parse Vitest/Jest/Playwright/Helm configuration and compare documented values; CI should fail on drift.
- **Verification method:** Re-run the documentation consistency script after each configuration change.

## 6. Design risks

The following risks are material but are not reported as confirmed defects unless an exact configuration proves the failure path.

| ID | Risk | Evidence | Why not a confirmed defect | Decision needed |
|---|---|---|---|---|
| DR-01 | `ci.yml` has no `merge_group` trigger. | `.github/workflows/ci.yml:1-40` | Merge-queue use and required merge-group checks were inaccessible. Absence is harmful only if a merge queue is enabled or planned. | Confirm whether merge queue is enabled. If yes, run the same required jobs on `merge_group`. |
| DR-02 | Playwright retries each failed test twice in CI. | `e2e/playwright.config.ts:1-100` | Retries can hide first-attempt flakes but a retry is not itself a defect. | Record first-attempt failures separately and fail or quarantine above an agreed flake budget. |
| DR-03 | E2E runs serially inside each shard and with RLS off. | `e2e/playwright.config.ts`; `docker-compose.e2e.yml` | This is an explicit isolation/stability choice. It becomes a defect only if E2E is claimed to prove concurrent or RLS-enforced behavior. | Keep the ordinary E2E suite, but add dedicated RLS-enforce and concurrency jobs. |
| DR-04 | CI does not set an explicit timezone for unit/integration/E2E jobs. | `.github/workflows/ci.yml`; repository instructions mention `TZ=UTC` | GitHub-hosted Linux runners are commonly UTC, but the workflow does not make this invariant explicit and runner behavior was not executed here. | Set `TZ=UTC` for the ordinary suite and add separate timezone matrix jobs. |
| DR-05 | Aggregate coverage thresholds may conceal high-risk exclusions. | Jest/Vitest configuration | Exclusion is not automatically wrong; many generated/bootstrap files are intentionally excluded. | Add invariant-targeted and changed-file gates rather than merely raising global percentages. |
| DR-06 | Workflow comments describe at least one required status and administrator bypass. | `.github/workflows/ci.yml`; `.github/workflows/pr-checklist.yml` | Branch-protection settings were inaccessible, so comments cannot establish current required-check policy. | Export and review branch rules/rulesets; compare exact required context names to emitted check names. |
| DR-07 | Security scans include intentionally non-blocking modes (`zizmor ... || true`, informational dev audit, ZAP `fail_action: false`, Trivy HIGH non-blocking). | Discovered workflows | The workflow clearly distinguishes visibility from blocking. Non-blocking visibility is not a defect by itself. | Document which severities must block release and review exception aging. |

## 7. Missing tests

### 7.1 Confirmed-missing-test register

A test is marked confirmed missing only where the relevant production path and its likely unit/integration/E2E suites were inspected at the baseline, or where the repository explicitly documents deferral.

| Root | Missing regression | Evidence supporting absence | Required environment | Priority |
|---|---|---|---|---:|
| P3-002 | Export/restore/download attachment bytes for local and S3-compatible providers; failure compensation | Backend backup suite uses mocks; E2E backup suite and roadmap defer restore round trip | Real PostgreSQL, temporary local storage, S3-compatible service, public download path | P0 |
| P4-001 | Two simultaneous MNY `start` calls cannot create two active jobs | Existing integration races worker claims for one existing job, not job creation | Two application requests/connections plus deterministic barrier | P0 |
| P4-002 | Retry after committed imported data cannot replay source rows | MNY tests cover retryability/staged bytes, not partial commit replay | Real PostgreSQL, staged file, failure injection after commit boundary | P0 |
| P4-003 | Two stale update/delete snapshots cannot corrupt balances | Transaction integration tests are sequential | Two independent transactions/connections with barriers | P0 |
| P4-004 | Two scheduler instances cannot post one occurrence twice | Scheduled service suite is mocked; ordinary integration stubs module | Two Nest scheduler/service instances and one database | P0 |
| P4-005 | Recompute cannot overwrite a concurrent committed balance delta | No production-boundary race in reviewed account/transaction suites | Two connections; barrier between snapshot and write | P0 |
| P4-006 | Holding update/rebuild cannot lose a concurrent investment change | Holdings unit suite uses one mocked manager; sequential investment integration | Two connections and rebuild/trade barrier | P0 |
| P4-007 | One emergency claim cannot be completed twice | Emergency suite uses one mocked manager; no claim-flow integration | Two connections/requests, one token, provider-side-effect counter | P0 |
| P5-001/P6-001 | `VOID` on either transfer leg preserves pair status and ledger equivalence | Transfer integration covers creation, not pair-wide VOID semantics | Real PostgreSQL, both legs, balances before/after | P0 |
| P5-002/P6-002 | Direct, scheduled, and split transfer destination values are server-authoritative | Transfer integration passes client `exchangeRate`; no server-authority negative case | Real rate store/service, two currencies, tampered client payload | P0 |
| P5-009/P6-006 | Missing FX produces partial/unavailable aggregates | Existing frontend and backend tests assert 1:1 fallback | Backend/frontend contract integration | P0 |
| P5-011 | Historical split ratio replay | Existing net-worth test is semantically additive | Persisted investment history plus net-worth replay | P0 |
| P6-003 | Preview and commit use one immutable FX quote/rate identifier | No matching contract test located in targeted investment tests | Controllable FX provider, delayed/stale response, preview/commit API | P0 |
| P6-005 | Existing override financial fields survive open and unrelated edit | Existing component test expects latest-price replacement | Frontend component with deferred quote promise | P0 |
| P6-007 | Partial/unavailable portfolio values are visibly incomplete end to end | Backend per-holding null test exists; aggregate/frontend completeness not verified | Backend DTO + frontend adapter/component + E2E | P0 |
| P6-010/P4-011 | Logout failure and logout/refresh race do not appear as confirmed success | Frontend test expects false success; token tests are mocked and sequential | Component state machine plus two-connection token integration | P0 |
| P3-001 | Cross-user/cross-instance automatic-backup key and retention isolation | Existing unit tests assert generic namespace with one owner | Local/S3 provider fake with two users/two instances | P1 |
| P3-004 | Crash-atomic backup writes | No reviewed test kills/fails between write and rename/commit | Filesystem/provider failure injection | P1 |
| P3-006 | Default Helm install gives automatic backup durable storage | No discovered Helm CI test; reported as design risk due inventory limitation | Helm render plus kind/k3d pod-replacement test | P1 |
| P4-010 | Attachment database/provider compensation across create/delete/restore | Restore byte test absent; provider failures not orchestrated | Real DB plus provider failure hooks | P1 |

### 7.2 Test-not-located register

These items were searched or traced to likely suites, but the immutable inventory was not sufficiently complete to declare repository-wide absence. Phase 8 or remediation planning should preserve them as open verification questions.

| Root | Test not located | Search/review performed | Status |
|---|---|---|---|
| P2-003 | Delegated profile response allowlist at controller/DTO/E2E boundary | Delegation E2E, RLS tests, cross-user isolation, auth tests | not located |
| P2-005/P3-009/P6-009 | Real OIDC step-up issuance bound to destructive-action purpose | Step-up guard unit, emergency controller override, OIDC E2E roadmap | unit guard only; end-to-end not located |
| P2-007 | Delegation create/link/revoke under enforced RLS using runtime role | RLS enforcement and delegation E2E inspected separately | partial; combined flow not located |
| P2-008 | Real actor versus effective owner in activity attribution | Cross-user and delegation suites inspected | not located |
| P3-005 | Backup path traversal and arbitrary destination authorization across public endpoint and provider | Backup unit suite and scanner exception comments | provider/endpoint integration not located |
| P3-007 | Export uses a transactionally consistent snapshot while writes occur | Backup unit suite | not located |
| P3-008 | Large backup streaming/memory boundary | Backup tests and Helm memory guidance | not located |
| P3-010 | Startup rejects unsafe runtime role | RLS integration and startup docs | not located as startup test |
| P3-011 | Runtime role cannot read/write migration history | RLS enforcement suites | not located |
| P3-012 | Compressed and decompressed restore limits | Backup suite | not located |
| P3-013 | Custom-currency backup portability | Backup/support-backup docs and tests sampled | not located |
| P3-014/P6-014 | Support-backup custom-currency masking | Support-backup documentation references golden tests; specific case not re-fetched | not located |
| P3-015 | Cross-user currency cleanup | Currency and isolation test candidates searched | not located |
| P3-016 | Concurrent initialization/migration | `db-init.spec.ts`, `db-migrate.spec.ts`, schema script inspected | unit-only; multi-process test not located |
| P4-008 | Account close versus transaction mutation | Account/transaction integration reviewed | not located |
| P4-009 | Concurrent split modifications | Transaction/scheduled suites reviewed | not located |
| P4-012 | Parallel failed-login counters | Auth unit suite sampled | not located |
| P4-013 | Duplicate AI generation | E2E roadmap defers AI; no provider race test re-fetched | not located |
| P4-014 | Emergency-grant issuance versus delivery race | Emergency unit/controller suites | not located |
| P4-015 | Duplicate budget alerts across schedulers | Cron documentation and E2E budget suite discovery | not located |
| P4-016 | Staged-file expiry versus import use | MNY job/staging-related tests sampled | not located |
| P4-017 | Concurrent attachment-cap enforcement | Backup/attachment candidates searched | not located |
| P4-018 | Duplicate reminders across schedulers | Cron documentation and E2E bills discovery | not located |
| P5-003 | Account/transaction currency agreement at API and database boundary | Transaction integration | not located |
| P5-004/P6-011/P6-012 | Split sign and exact four-decimal equality across frontend/backend | Transaction and scheduled tests sampled | partial nominal coverage; exact parity not located |
| P5-005 | Investment FX zero, absent, stale, preview, and commit semantics | Investment integration and portfolio tests | complete matrix not located |
| P5-006/P6-013 | Commissioned basis and realized gain | Investment/security transfer tests sampled | not located as complete numeric regression |
| P5-007/P6-015 | Transfer splits in budgets and cache invalidation | Frontend cache guidance and budget/transfer tests sampled | not located |
| P5-008 | Final loan installment | E2E and backend loan candidates not fully inventoried | not located |
| P5-010/P6-008 | Valuation failure versus explicit zero in aggregate/UI | Backend per-holding null test exists | partial; aggregate/UI not located |
| P5-012 | Linked-account snapshot invalidation | Investment/account tests sampled | not located |
| P5-013/P6-004 | Foreign-security transfer basis | Same-currency security-transfer integration exists | foreign-currency case not located |
| Frontend | Date-only fields in `Europe/Warsaw`, UTC, negative offset, and DST transitions | Frontend/E2E locale/time configuration inspected | not located |
| Frontend | Comma-decimal entry/round-trip | Render helper and input guidance inspected | not located in reviewed evidence |
| Frontend | Delegated-context cache clearing | Delegation E2E and cache guidance inspected | not located |
| Frontend | Restore partial-success state | Backup E2E and roadmap inspected | not located |
| Simulation | Deterministic Monte Carlo seed | Randomness search/config sampling | not located |

## 8. Documentation issues

| ID | Paths | Issue | Classification | Impact |
|---|---|---|---|---|
| DOC-01 | `frontend/CLAUDE.md`; `frontend/vitest.config.ts` | Documented branch threshold is 85%; executable threshold is 84%. | stale documentation | Contributors cannot know the actual enforced gate from scoped instructions. |
| DOC-02 | `CONTRIBUTING.md`; `.claude/skills/backend.md`; `backend/CLAUDE.md` | Older QueryRunner/direct-repository guidance conflicts with current `withScopedDb` transaction and RLS convention. | stale documentation | New tests can mock the wrong boundary and omit actor/effective-owner context. |
| DOC-03 | `CONTRIBUTING.md`; current schema/entity conventions | Some contributor guidance describes integer-cent assumptions inconsistent with current four-decimal database money fields. | stale documentation | Financial tests may use insufficient precision or assert the wrong contract. |
| DOC-04 | `.claude/skills/infrastructure.md`; `e2e/playwright.config.ts`; `docker-compose.e2e.yml` | Browser/port/stack descriptions are outdated. | stale documentation | Local reproduction differs from CI. |
| DOC-05 | `helm/README.md`; `helm/Chart.yaml`; `helm/values.yaml` | Chart path/default examples are not consistently aligned with the current chart root and values. | stale documentation | Operators can invoke an invalid path or size/configure the deployment incorrectly. |
| DOC-06 | `e2e/ROADMAP.md`; backend backup tests | The roadmap says restore is covered by backend tests, but reviewed backend tests do not verify attachment-provider byte movement or a real restore/download round trip. | documentation overstatement | Maintainers may believe P3-002 has stronger verification than it does. |
| DOC-07 | Workflow comments; inaccessible branch rules | Comments call a checklist check required and describe an administrator bypass. Current rulesets were not accessible. | unverified documentation claim | Do not treat workflow prose as branch-protection evidence. |

## 9. Reviewed scope

### 9.1 Directories inspected

- repository root configuration and contributor/security documentation;
- `.github/workflows/` through every workflow discovered by connector search and documentation references;
- `.claude/` settings and skills guidance;
- `backend/`, `backend/src/`, `backend/test/`, targeted service/test subtrees, and migration/startup scripts;
- `frontend/`, `frontend/src/test/`, targeted hooks/components/stores/i18n tests;
- `e2e/`, its configuration, global setup, fixtures, helpers, roadmap, and targeted suites;
- `database/` instructions and schema/migration documentation;
- `docs/` files relevant to migrations, RLS, cron jobs, backup/support backup, import, testing, and deployment;
- `helm/` chart metadata, values, and README;
- Docker/Compose configuration used by E2E and CI.

### 9.2 Files inspected in full or in all relevant ranges

The audit ledger at the end lists exact paths. Key evidence files include the complete framework configuration, all discovered workflows, mandatory wrong-test files, RLS helpers/tests, targeted backend integration suites, backup tests, release workflow, Playwright setup, and deployment/test documentation.

### 9.3 Areas reviewed without a material Phase 7 issue

- The RLS enforcement integration suite uses a real unprivileged runtime role, multiple users, delegated context, policy catalogs, and invalid/unset context cases. It is a strong positive control for the policy behaviors it covers.
- The service-level cross-user isolation integration suite is extensive across accounts, transactions, categories, payees, tags, securities, budgets, and reports. It should not be replaced by only RLS tests.
- The MNY job-claim integration test uses real PostgreSQL and multiple concurrent claim attempts against the same job; it is strong for that precise invariant.
- The security-transfer integration suite checks paired legs, quantity edits, deletion, and same-currency basis preservation.
- Migration lint and schema drift/double-apply checks are substantive controls for guarded/idempotent migrations and schema agreement.
- CI pins third-party actions to immutable commit SHAs in the inspected workflows.
- Unit and E2E artifacts are retained on failure/always in the primary pipeline, including coverage and Playwright reports.
- Search did not locate `.skip`, `.only`, or `todo` markers in the queried test forms. This is not claimed as exhaustive because the recursive tree was unavailable.

## 10. Unreviewed or inaccessible scope

- A complete immutable recursive tree and therefore proof of every test/workflow file in the repository.
- GitHub branch-protection rules/rulesets, required check names, strict up-to-date policy, merge-queue state, admin bypass settings, review requirements, force-push policy, and conversation-resolution settings.
- Check suites/check runs, annotations, raw logs, artifacts, flaky history, retry history, and merge-group evidence for the baseline.
- Full workflow-run pagination/history and status source applications.
- Live CI execution, local test execution, Docker/Compose execution, browser execution, migration execution, coverage reports, or Helm rendering/install.
- Actual deployed providers, secrets, databases, object stores, Kubernetes clusters, and backup volumes.
- Complete immutable contents of every E2E suite and every backend/frontend test file; the inventory is explicitly limitation-qualified.
- Track B PR/review content except to exclude it from baseline evidence.

## 11. Test framework and configuration matrix

| Layer | Framework/config | Discovery | Environment | Isolation/concurrency | Coverage | CI job | Required check |
|---|---|---|---|---|---|---|---|
| Backend unit | Jest 30, config in `backend/package.json` | `src/.*\.spec\.ts$` via `test:unit` | Node; production database replaced by repository/transaction mocks | One mocked manager/service instance unless a spec builds custom promises | V8/Istanbul through Jest; global 85/95/95/94 (branches/functions/lines/statements) | `Backend Unit Tests` | unknown |
| Backend integration | Jest with `backend/test/jest-e2e.json` | `test/integration/.*\.spec\.ts$`; `--runInBand`; currently `--passWithNoTests` | Real PostgreSQL 16 in CI; Nest testing modules | One worker; many suites share one application/data source; selected tests use multiple promises but rarely multiple explicit connections | Not part of unit coverage threshold | `Backend Integration Tests` | unknown |
| RLS integration | Jest integration plus RLS helpers | Dedicated RLS suites under `backend/test/integration` | Real PostgreSQL, unprivileged runtime role, RLS policies | Multiple users and contexts; transaction-scoped GUC verification | Not part of unit coverage threshold | `Backend Integration Tests` | unknown |
| Frontend unit/component | Vitest, jsdom, V8 | `src/**/*.{test,spec}.{ts,tsx}` | jsdom; shared mocks; custom render uses English messages | Single process; API/store mocks; 30s timeout | 84/87/91/90 (branches/functions/lines/statements) | `Frontend Unit Tests` | unknown |
| i18n structural | Vitest and pseudo-locale script | parity/punctuation/convention tests plus `i18n:check` | Catalog parsing, not browser locale behavior | N/A | Included when source under collection; scripts separate | `Frontend Unit Tests`, `Frontend Lint & Type Check` | unknown |
| Browser E2E | Playwright | `e2e/tests`; four CI shards | Real Chromium and Firefox against Docker Compose full stack | One worker per shard, isolated stack per shard, retries 2 | Does not feed frontend/backend unit thresholds | `E2E Tests (shard N/4)` | unknown |
| Migration static | Node test/script | migration-lint self-test and all migration SQL | Node parser/static rules | N/A | No code coverage gate | `Backend Lint & Type Check` | unknown |
| Schema runtime | Shell + Docker/PostgreSQL | `scripts/verify-schema.sh` | Temporary PostgreSQL databases | Sequential apply and re-apply | N/A | `Schema vs Migrations Drift` | unknown |
| Docker | Docker Buildx/Compose | Dockerfiles and Compose file | Production image builds; E2E development targets | Four isolated Compose stacks | N/A | preview/release image jobs and E2E shards | unknown |
| Helm | Manual commands documented | No discovered CI invocation | Not executed by this audit | Not verified | N/A | not located | unknown |

## 12. Limitation-qualified test inventory

The connector did not expose a complete immutable recursive tree. The table below is therefore the baseline-confirmed inventory of tests and configuration directly inspected for this phase, not a claim that every repository test file was enumerated. Candidate paths found by search were not treated as evidence until re-fetched at the baseline.

| Path | Layer | Framework | Domain/scope | Environment | Isolation/concurrency | Time/locale/providers | CI job | Required | Status/notes |
|---|---|---|---|---|---|---|---|---|---|
| `backend/src/auth/step-up/step-up.guard.spec.ts` | backend unit | Jest | purpose/type/sub/expiry validation | mocked JWT | single call | no real OIDC | Backend Unit Tests | unknown | Present; strong guard unit, not issuance/E2E |
| `backend/src/auth/token.service.spec.ts` | backend unit | Jest | refresh rotation/replay/revocation | mocked manager/repo | one manager; lock request asserted | mocked random token/UUID; real clock in places | Backend Unit Tests | unknown | Present; no refresh/logout DB race |
| `backend/src/auth/auth.service.spec.ts` | backend unit | Jest | registration/login/delegation/auth flows | extensive mocks | mocked transactions | mocked crypto/TOTP/email | Backend Unit Tests | unknown | Present; not a runtime-role/real OIDC test |
| `backend/src/emergency-access/emergency-access.service.spec.ts` | backend unit | Jest | settings, contacts, grant state | mocked scoped DB/email/encryption | one manager | provider cannot model delivery race | Backend Unit Tests | unknown | Present; no two-claim test |
| `backend/src/emergency-access/emergency-access.controller.spec.ts` | backend unit | Jest | controller delegation | service mock | StepUpGuard overridden true | N/A | Backend Unit Tests | unknown | Present; cannot prove destructive step-up |
| `backend/src/backup/auto-backup.service.spec.ts` | backend unit | Jest | scheduling, naming, retention | mocked FS/backup/scoped DB | one owner | success-oriented local mock | Backend Unit Tests | unknown | Present; validates generic namespace |
| `backend/src/backup/backup.service.spec.ts` | backend unit | Jest | export/restore orchestration | mocked DB/storage/OIDC claims | one process | no real local/S3 byte roundtrip | Backend Unit Tests | unknown | Present; provider failures simplified |
| `backend/src/import/mny/mny-import-job.service.spec.ts` | backend unit | Jest | job state/retry/claim API | mocked DB | one service/manager | fake timers in selected cases | Backend Unit Tests | unknown | Present; comments defer atomic claim to integration |
| `backend/test/integration/mny-import-job.integration.spec.ts` | backend integration | Jest | same-job worker claim, progress, stale reaper | real PostgreSQL | concurrent promises against same job | controlled dates; no two `start` requests | Backend Integration Tests | unknown | Present; strong for same-row claim only |
| `backend/test/integration/transactions.integration.spec.ts` | backend integration | Jest | create/update/delete/void/balance | real PostgreSQL | sequential | USD fixtures | Backend Integration Tests | unknown | Present; no stale-snapshot race |
| `backend/test/integration/transfers.integration.spec.ts` | backend integration | Jest | same/cross-currency transfer creation | real PostgreSQL | sequential | client-supplied FX | Backend Integration Tests | unknown | Present; no pair VOID/server authority |
| `backend/test/integration/investment-transactions.integration.spec.ts` | backend integration | Jest | funding-account change | real PostgreSQL | sequential | USD, commission 0 in reviewed case | Backend Integration Tests | unknown | Present; narrow scenario |
| `backend/test/integration/security-transfer.integration.spec.ts` | backend integration | Jest | paired security transfer/edit/delete/basis | real PostgreSQL | sequential | same currency | Backend Integration Tests | unknown | Present; foreign-currency case absent from reviewed file |
| `backend/src/scheduled-transactions/scheduled-transactions.service.spec.ts` | backend unit | Jest | CRUD/posting/overrides/splits | repositories/services mocked | one service/manager | fixed dates, no scheduler instances | Backend Unit Tests | unknown | Present; no production-boundary race |
| `backend/src/securities/holdings.service.spec.ts` | backend unit | Jest | holdings queries/rebuild/history | scoped DB mock | one manager | correct ratio semantics in holdings helper | Backend Unit Tests | unknown | Present; no concurrent rebuild |
| `backend/src/securities/portfolio.service.spec.ts` | backend unit | Jest | portfolio totals, prices, FX | repositories/providers mocked | one service | always controlled rates/prices | Backend Unit Tests | unknown | Present; one test asserts missing FX = 1 |
| `backend/src/net-worth/net-worth.service.spec.ts` | backend unit | Jest | historical net-worth replay | mocked repositories | single-thread | fixed dates | Backend Unit Tests | unknown | Present; additive split assertion |
| `backend/src/db-init.spec.ts` | backend unit | Jest | schema initialization behavior | mocked pg/fs | one process | N/A | Backend Unit Tests | unknown | Present; no concurrent startup |
| `backend/src/db-migrate.spec.ts` | backend unit | Jest | ordering, transaction, diagnostics | mocked pg/fs | one process | N/A | Backend Unit Tests | unknown | Present; no multi-process migration |
| `backend/test/integration/rls-harness.integration.spec.ts` | backend integration | Jest | policy catalog/harness behavior | real PostgreSQL | serial | runtime role setup | Backend Integration Tests | unknown | Present |
| `backend/test/integration/rls-enforcement.integration.spec.ts` | backend integration | Jest | runtime-role RLS isolation/delegation/context | real PostgreSQL/RLS enforce | multiple users and contexts | unprivileged app role | Backend Integration Tests | unknown | Present; strong positive control |
| `backend/test/integration/security-cross-user-isolation.integration.spec.ts` | backend integration | Jest | service-level IDOR across domains | real PostgreSQL | two users, sequential attacks | English i18n; scheduled module excluded | Backend Integration Tests | unknown | Present; broad service isolation |
| `frontend/src/hooks/useExchangeRates.test.ts` | frontend hook | Vitest | conversion and rate map | jsdom/API mock | single | controlled rates | Frontend Unit Tests | unknown | Present; incorrect missing-FX assertion |
| `frontend/src/components/scheduled-transactions/OverrideEditorDialog.test.tsx` | frontend component | Vitest | override editing/latest quote | jsdom/API mocks | asynchronous quote but no explicit barrier contract | English | Frontend Unit Tests | unknown | Present; incorrect auto-replacement assertion |
| `frontend/src/components/layout/AppHeader.test.tsx` | frontend component | Vitest | navigation/logout | jsdom/auth API mock | single | English | Frontend Unit Tests | unknown | Present; incorrect false-success logout assertion |
| `frontend/src/store/authStore.test.ts` | frontend unit | Vitest | local auth state/rehydration | jsdom/module mock | single | English; waitFor replaces prior fixed sleep | Frontend Unit Tests | unknown | Present; local logout only |
| `frontend/src/i18n/messages.parity.test.ts` | frontend structural | Vitest | catalog key/ICU parity | Node/jsdom | N/A | all catalogs structurally | Frontend Unit Tests | unknown | Present; not behavioral locale coverage |
| `e2e/tests/backup.spec.ts` | browser E2E | Playwright | backup export/download | real browser/full stack | one user, serial | local stack; no restore/provider matrix | E2E shard | unknown | Present; restore deferred |
| `e2e/tests/delegation.spec.ts` | browser E2E | Playwright | owner add/remove; delegate sees grant | two browser contexts/full stack | distinct owner/delegate sessions | RLS off | E2E shard | unknown | Present; positive grant path |
| `e2e/ROADMAP.md` referenced suites | browser E2E | Playwright | auth/admin/mobile/security/import/budgets/accounts/reports/investments/transactions and more | full stack | serial per shard | English locale; deferred OIDC/AI/restore/emergency claim | E2E shards | unknown | Discovery inventory only unless individually re-fetched |

## 13. Test-helper and fixture ledger

| Helper/path | Purpose | Realism | Isolation | Missing dimensions | Risk |
|---|---|---|---|---|---|
| `backend/src/test-helpers/scoped-db-testing.ts` | Route entity repositories through a mocked `withScopedDb` transaction manager | Useful unit abstraction; not PostgreSQL/RLS | fresh Jest mocks per test | actual transaction isolation, GUCs, locks, connection pools, failures after partial side effects | Can make transaction/RLS code look exercised when only callback wiring is tested |
| `backend/test/helpers/integration-setup.ts` | Build Nest integration modules, reset schema/tables, create users, apply policies | Real PostgreSQL and application modules | one test DB, one worker; drop/synchronize/reset | migrations as deployed, multi-process startup, ordinary-suite RLS enforce, multiple explicit connections by default | Strong ordinary integration base but can hide scheduler/RLS/migration differences |
| `backend/test/helpers/test-factories.ts` | Create users/accounts/categories/payees and domain rows | Real database rows | caller controls user | delegated identity, custom currencies, stale FX/prices, provider failures, four-decimal edge corpus not consistently built in | Tests default to simple USD/single-user data |
| RLS role/context helpers | Create runtime role and set owner/delegate context | High realism for RLS policy tests | transaction-scoped context | destructive endpoint/DTO/frontend path, actor attribution | Strong policy evidence, partial cross-layer evidence |
| `frontend/src/test/setup.ts` | Global DOM/router/toast/storage/media mocks | Appropriate for component tests | shared reset behavior | browser cookies, real network, timezone/locale engines, navigation races | Broad mocks can hide integration state transitions |
| `frontend/src/test/render.tsx` | Theme and i18n wrapper | Real component rendering with complete English catalog | fresh render | non-English locale, regional number/date format, negative UTC offsets | Locale-sensitive defects cannot be reproduced through default helper |
| `e2e/global-setup.ts` | Ensure reusable admin account | Real API/full stack | shared admin identity | strict per-test admin isolation | Cross-test coupling possible for admin state; no issue confirmed |
| `e2e/fixtures.ts` | Fresh authenticated user/API/page fixtures | High realism for ordinary browser flows | fresh user and isolated browser context | runtime RLS enforce, multiple app replicas, provider services | Good ordinary E2E; not security/concurrency deployment fidelity |
| `e2e/helpers/api.ts` | CSRF-aware API client and unique IDs | Real backend API | per request context | duplicate-request/retry injection, controlled clocks | One transparent 403 retry can conceal only CSRF refresh behavior, not domain idempotency |
| Backup/storage mocks | Avoid filesystem/S3 dependencies | Low for provider atomicity | in-memory/Jest state | copy/delete failure after partial success, object consistency, cross-instance prefix collision | Hides P3-001/P3-002/P3-004/P4-010 classes |
| FX/price mocks | Supply deterministic rates/prices | Good for arithmetic unit tests | per test | unavailable/stale/partial/source timestamp unless explicitly configured | Defaults often produce complete data; one suite encodes 1:1 fallback |
| Email/OIDC mocks | Isolate security workflows | Low for issuance/delivery races | one mock instance | real token purpose issuance, email-before-state ordering, retry/duplicate delivery | Hides P2-005/P4-014 |
| Clock controls | `Date.now` spies/fake timers in selected unit tests | Deterministic locally | per test | timezone matrix, DST, multi-instance scheduler boundary, database clock | Real-clock and timezone assumptions remain |
| Concurrency barriers | No reusable production-boundary barrier helper located | N/A | N/A | two connections, latches, multi-instance orchestration | Main cause of P7-008 |

## 14. Findings-to-tests coverage matrix for canonical HIGH roots

| Finding | Root invariant | Existing test paths | Positive | Negative | Cross-user | Concurrency | Failure/retry | Frontend/E2E | CI enforcement | Coverage status |
|---|---|---|---|---|---|---|---|---|---|---|
| P3-001 | Backup keys/retention are tenant and instance isolated | `auto-backup.service.spec.ts` | Single-user creation | Basic retention | No | No | Partial provider errors | No | Unit job only | **incorrect assertion** |
| P3-002 | Restore remaps metadata and moves/verifies bytes | `backup.service.spec.ts`; `e2e/tests/backup.spec.ts` | Metadata/orchestration mocked; export download | Some mocked errors | No provider tenant matrix | No | No partial-copy compensation | Restore explicitly deferred | Unit/E2E jobs, but scenario absent | **confirmed missing** |
| P4-001 | One active MNY import per owner/source | `mny-import-job.integration.spec.ts`; unit specs | One job claim | Already-claimed worker | Owner-scoped rows | Same-job workers only | Some stale/retry states | MNY E2E candidate | Integration job can pass no tests | **partial; wrong conflict boundary** |
| P4-002 | Retry after commit does not replay source rows | MNY unit/integration | Retryable state | Generic failure | Owner scope | No commit/retry race | Partial | Import E2E candidate | Same as above | **confirmed missing** |
| P4-003 | Stale transaction snapshots cannot corrupt balances | `transactions.integration.spec.ts` | Sequential CRUD/balance | Validation/void cases | IDOR suite | No | Rollback cases limited | Transactions E2E candidate | Integration job | **confirmed missing concurrency case** |
| P4-004 | One scheduled occurrence posts once | `scheduled-transactions.service.spec.ts` | Sequential posting | Skip/override cases | Unit user scoping | No; one mock instance | Mocked service failures | Bills/scheduled UI candidates | Unit job | **mocked-away** |
| P4-005 | Recompute cannot overwrite committed deltas | transaction/account tests | Ordinary recompute behavior sampled | Some errors | IDOR suite | No | No interleaving | Accounts E2E candidate | Unit/integration | **confirmed missing concurrency case** |
| P4-006 | Holdings update/rebuild preserves concurrent changes | `holdings.service.spec.ts`; investment integration | Sequential history/rebuild | Validation | User scoping | No | Limited | Investments E2E candidate | Unit/integration | **mocked-away / confirmed missing race** |
| P4-007 | Emergency claim is single-use | emergency unit/controller tests | Settings/contact/grant state | Expiry/revoke unit cases | Owner context | No | Provider mock | Emergency E2E does not cover claim delivery | Unit/E2E | **confirmed missing** |
| P5-001/P6-001 | Both transfer legs preserve ledger/status equivalence under VOID | `transfers.integration.spec.ts`; transaction VOID tests | Transfer creation | Single transaction VOID | User scoping | No | No pair rollback retry | Transaction E2E candidate | Integration | **confirmed missing pair case** |
| P5-002/P6-002 | Server authoritatively derives FX and destination amount | `transfers.integration.spec.ts` | Direct arithmetic with supplied rate | Basic validation | User scoping | No | No stale/missing rate | UI candidates | Integration | **partial; client contract masks defect** |
| P5-009/P6-006 | Missing FX is unavailable/partial, not 1:1 | `useExchangeRates.test.ts`; `portfolio.service.spec.ts` | Direct/inverse rate | Missing rate | N/A | N/A | Missing provider | Frontend hook tested | Unit jobs | **incorrect assertion** |
| P5-011 | Split ratio multiplies historical quantity | `net-worth.service.spec.ts`; holdings tests | Holdings helper has ratio semantics | Reverse split coverage sampled elsewhere | N/A | No | Sequential replay only | No | Unit job | **incorrect assertion in net-worth path** |
| P6-003 | Preview and commit use the same FX quote | investment tests sampled | Normal preview/commit separately | Absent/stale not located | User scope | No | Provider timing absent | Component/API coverage not located | Unit/integration | **not located / confirmed gap in targeted path** |
| P6-005 | Opening override does not mutate price | `OverrideEditorDialog.test.tsx` | New/edited override cases | No explicit-preservation case | N/A | Async quote only | No late-response barrier | Component test | Frontend unit | **incorrect assertion** |
| P6-007 | Partial portfolio values are visibly incomplete | `portfolio.service.spec.ts`; investment page candidate | Complete totals | Per-holding no-price null | User scope | N/A | Missing price partial | Complete-state UI tests sampled | Unit/frontend | **partial; aggregate contract missing** |
| P6-010 | Logout failure is not reported as success | `AppHeader.test.tsx`; `token.service.spec.ts` | Success path | API failure asserted as success | N/A | No logout/refresh race | Mock failure | Component only | Unit jobs | **incorrect assertion and unit-only** |

## 15. Full Phase 1-6 finding verification and disposition

Phase-local implementation findings remain authoritative in their accepted reports. This table records only Phase 7's verification disposition and does not duplicate implementation defects.

### 15.1 Security and RLS backlog

| Finding | Verification disposition | Evidence/notes |
|---|---|---|
| P2-003 | partial / test not located | Delegation E2E proves positive account visibility; no complete delegated-profile field allowlist negative test located. |
| P2-005/P3-009/P6-009 | unit-only | `StepUpGuard` strongly tests purpose/type/sub/expiry, but real OIDC issuance and destructive endpoint flow are not verified; emergency controller overrides guard. |
| P2-007 | partial | RLS delegation policies and browser delegation are tested separately; combined create/link/revoke under enforced runtime RLS not located. |
| P2-008 | test not located | No reviewed assertion distinguishes real actor from effective owner in activity records. |
| P4-007 | confirmed missing | No two-connection single-use claim completion. |
| P4-011/P6-010 | incorrect assertion / missing race | Frontend expects false success; backend token tests use one mocked manager. |
| P4-014 | test not located | No deterministic state-versus-email delivery race. |

### 15.2 Database, migration, backup, and restore backlog

| Finding | Verification disposition | Evidence/notes |
|---|---|---|
| P3-001 | incorrect assertion | Generic filename/retention is expected by unit tests. |
| P3-002 | confirmed missing | No provider byte round trip. |
| P3-004 | test not located | No crash/failure between temporary write and final publication. |
| P3-005 | test not located | Local provider traversal unit coverage is referenced in workflow comments, but complete endpoint/destination authorization was not re-fetched. |
| P3-006 | design risk | No discovered Helm CI path; immutable workflow completeness unproven. |
| P3-007 | test not located | No concurrent write during export snapshot. |
| P3-008 | test not located | No large-backup streaming/RSS assertion located. |
| P3-010 | partial | RLS tests prove runtime role properties in test setup; startup rejection of unsafe role not located. |
| P3-011 | test not located | Runtime denial for `schema_migrations` not located. |
| P3-012 | test not located | Compressed/decompressed limit matrix not located. |
| P3-013 | test not located | Custom currency portability not located. |
| P3-014/P6-014 | test not located | Support-backup golden/allowlist tests are documented, but custom-currency masking case was not re-fetched. |
| P3-015 | test not located | Cross-user currency cleanup not located. |
| P3-016 | unit-only | Startup scripts are unit tested with mocked PG/FS; no two-process initialization/migration test. |
| P4-010 | partial / confirmed provider gap | Metadata and provider units exist, but restore/create/delete compensation across actual providers is not verified. |

### 15.3 Backend concurrency and idempotency backlog

| Finding | Verification disposition | Production boundary exercised? |
|---|---|---|
| P4-001 | partial | No; same-job worker claim is tested, simultaneous job creation is not. |
| P4-002 | confirmed missing | No committed-data retry/replay failure injection. |
| P4-003 | confirmed missing | No two independent transaction snapshots. |
| P4-004 | mocked-away | No two scheduler instances. |
| P4-005 | confirmed missing | No recompute/delta interleaving. |
| P4-006 | mocked-away | No rebuild/trade interleaving. |
| P4-007 | confirmed missing | No two claim transactions/provider side effects. |
| P4-008 | test not located | Account close versus mutation race not located. |
| P4-009 | test not located | Concurrent split modification not located. |
| P4-011 | unit-only | Pessimistic lock request tested with mock; no logout/refresh connections. |
| P4-012 | test not located | Parallel failed-login counter update not located. |
| P4-013 | test not located | AI provider E2E deferred; no duplicate generation race re-fetched. |
| P4-014 | test not located | No grant issuance/delivery barrier. |
| P4-015 | test not located | No multiple scheduler budget-alert test. |
| P4-016 | test not located | No staged-file expiry/use barrier. |
| P4-017 | test not located | No concurrent attachment cap test. |
| P4-018 | test not located | No multiple scheduler reminder test. |

### 15.4 Financial-correctness backlog

| Finding | Verification disposition | Required numerical regression |
|---|---|---|
| P5-001/P6-001 | confirmed missing | Transfer `-100.00` source / `+135.00` destination at `1.3500`; VOID either leg -> both excluded and balances return exactly to pre-transfer values. |
| P5-002/P6-002 | partial | Client submits tampered destination `999.99`; server with `1.3500` must store `135.00`, difference `864.99`. Repeat direct, scheduled, split. |
| P5-003 | test not located | Account USD plus transaction CAD must reject or convert by explicit contract; no silent label mismatch. |
| P5-004/P6-011/P6-012 | partial | Parent `-10.0000`; splits `-3.3333`, `-3.3333`, `-3.3334` sum exactly `-10.0000`; opposite sign or `-9.9999` rejected. |
| P5-005/P6-003 | test not located | Preview at `1.2500` for `100.00 USD` -> `125.00 CAD`; commit must use same quote even if provider changes to `1.3000` (otherwise `5.00 CAD` drift). Zero/missing/stale distinct. |
| P5-006/P6-013 | test not located | Buy 10 at `20.00` plus `5.00` commission -> basis `205.00`, `20.50/share`; sell 4 at `30.00` with `2.00` fee -> proceeds `118.00`, basis `82.00`, gain `36.00`. |
| P5-007/P6-015 | test not located | Transfer split touching destination account/budget must invalidate both accounts and affected budget queries; stale amount must not persist. |
| P5-008 | test not located | Principal `100.00`, two `33.33` payments -> final installment `33.34`, not `33.33` or `33.35`. |
| P5-009/P6-006 | incorrect assertion | Missing USD/CAD for `100.00` -> unavailable; same-currency USD/USD -> valid `100.00` at `1.0000`. |
| P5-010/P6-008 | partial | Quantity 10, price unavailable -> aggregate partial, not `0.00`; explicit valid price `0.00` remains distinct. |
| P5-011 | incorrect assertion | `90 * 2.0 = 180`; additive implementation gives `92`, error `-88`; reverse `90 * 0.5 = 45`. |
| P5-012 | test not located | Linked cash account balance change must invalidate brokerage and aggregate snapshot. |
| P5-013/P6-004 | partial | Transfer 10 shares with basis `200.00 USD` to CAD account at `1.3500` -> basis `270.00 CAD`; same-currency-only suite cannot prove it. |

### 15.5 Frontend contracts backlog

| Finding | Verification disposition | Notes |
|---|---|---|
| P6-003 | test not located | No shared quote/rate identity across preview and commit. |
| P6-005 | incorrect assertion | Latest quote is expected to overwrite on open. |
| P6-007 | partial | Per-holding null exists; aggregate completeness and UI warning absent from reviewed evidence. |
| P6-010 | incorrect assertion | API failure is expected to redirect as if logout succeeded. |
| P6-012 | test not located | Four-decimal frontend/backend equality matrix not located. |
| P6-015 | test not located | Transaction-to-budget cache dependency regression not located. |
| Date-only timezone behavior | test not located | No Warsaw/UTC/negative-offset/DST matrix located. |
| Comma-decimal locale | test not located | Default render and E2E locale are English. |
| Zero/null/absent/unknown | partial | Individual units exist; no cross-contract matrix located. |
| Delegated-context cache clearing | test not located | Positive delegation E2E only. |
| Restore partial success | test not located | Restore E2E deferred. |

## 16. Incorrect-test register

| Register ID | Path/range | Assertion currently protected | Correct contract | Related finding | CI consequence |
|---|---|---|---|---|---|
| T-WRONG-01A | `frontend/src/hooks/useExchangeRates.test.ts:90-190` | Missing direct/inverse FX returns original numeric amount. | Return typed unavailable/partial; same-currency `1.0000` is separately valid. | P5-009/P6-006, P7-001 | Frontend unit green proves wrong behavior remains. |
| T-WRONG-01B | `backend/src/securities/portfolio.service.spec.ts:760-850` | Missing direct/inverse FX uses rate `1` in aggregate. | Aggregate must be partial/unavailable and list missing pair. | P5-009/P6-006, P7-001 | Backend unit green protects fabricated totals. |
| T-WRONG-02 | `frontend/src/components/scheduled-transactions/OverrideEditorDialog.test.tsx:480-680` | Opening editor applies latest quote to price. | Stored override remains until explicit apply action. | P6-005, P7-002 | Component green protects silent mutation. |
| T-WRONG-03 | `backend/src/net-worth/net-worth.service.spec.ts:300-560` | Split quantity is added to prior shares. | Split quantity is a multiplicative ratio. | P5-011, P7-003 | Net-worth green protects corrupt replay. |
| T-WRONG-04 | `frontend/src/components/layout/AppHeader.test.tsx:90-130` | Logout API failure still clears state and redirects as success. | UI must show unconfirmed/failed server logout. | P6-010, P7-004 | Frontend green protects false security state. |
| T-WRONG-05 | `backend/src/backup/auto-backup.service.spec.ts:430-780` | Generic date-based filename and shared retention list are expected. | Owner/instance-isolated prefix and retention. | P3-001, P7-005 | Backend green protects cross-tenant collision/deletion. |

## 17. Mock-fidelity matrix

| Exact path/material mock | Production behavior omitted | Defect class hidden | Recommended realistic fake/integration test |
|---|---|---|---|
| `backend/src/test-helpers/scoped-db-testing.ts` | Real PostgreSQL transaction, RLS GUCs, lock waits, serialization failures, independent connections | P2/P4 authorization and race classes | Use helper only for unit wiring; add real-DB tests with runtime role and explicit connection checkout. |
| `scheduled-transactions.service.spec.ts` repository and transaction-service mocks | Unique/idempotency constraints, two scheduler replicas, committed side effects | P4-004, P4-015, P4-018 | Two Nest instances, common PostgreSQL, barrier before insert/send. |
| `holdings.service.spec.ts` mocked repositories | Concurrent trade/rebuild write ordering and database constraints | P4-006/P4-009 | Two transactions plus deterministic rebuild/trade barrier. |
| `emergency-access.service.spec.ts` one manager and email mock | Single-use update conflict, send-before/after-commit ordering, duplicate delivery | P4-007/P4-014 | Real DB plus recording email fake that can block/fail. |
| `token.service.spec.ts` mocked transaction manager | Actual row locks and concurrent refresh/logout transactions | P4-011 | Two independent DB connections and real `RefreshToken` rows. |
| `auto-backup.service.spec.ts` filesystem/list mocks | Prefix collision across owners/instances, atomic write/rename, provider list semantics | P3-001/P3-004 | Temp filesystem and S3-compatible recording provider with failure hooks. |
| `backup.service.spec.ts` storage and claims mocks | Object byte movement, provider failure after first object, real purpose-bound token | P3-002/P3-005/P4-010 | Provider-parameterized integration plus real guard/controller path. |
| FX/price mocks in portfolio/investment tests | Missing/stale/partial data and quote identity over time | P5-005/P5-009/P5-010/P6-003/P6-007 | Controllable provider fake returning explicit timestamp/source/status and delayed responses. |
| `AppHeader.test.tsx` auth API/store mocks | Cookie state, backend family revocation, another tab/device | P4-011/P6-010 | Component failure-state test plus API/database integration race. |
| E2E stack `RLS_MODE=off` | Runtime app role and database-enforced policy failures | P2/P3 RLS deployment defects | Separate RLS-enforce E2E/HTTP smoke job. |
| E2E environment with no S3/SMTP/OIDC/AI | Provider-specific failure/retry/delivery/identity behavior | P3-002, P2-005, P4-013/P4-014 | Dedicated service containers or protocol-faithful local fakes. |
| Playwright route/API helpers | A transparent CSRF retry only; no duplicate-domain-request injection | Idempotency retry classes can remain untested | Add explicit duplicate request and response-loss test helpers. |

## 18. Concurrency-test fidelity matrix

| Root | One promise queue | One service instance | One DB connection/manager | Two DB connections | Two app/scheduler instances | Barrier/latch | Provider side effects | Assessment |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| P4-001 MNY start | existing claim test uses concurrent promises | yes | likely pool-managed, same app | not proven for start | no | no explicit start barrier | staged-file state | Wrong boundary; missing |
| P4-002 MNY retry | yes/sequential | yes | one | no | no | no commit-failure barrier | staged file retained | Missing |
| P4-003 stale transactions | no race | yes | one ordinary integration context | no | no | no | balance DB effect | Missing |
| P4-004 scheduled posting | unit promises only if any | yes | mocked manager | no | no | no | transaction creation mocked | Mocked-away |
| P4-005 balance recompute | no | yes | one | no | no | no | DB balance only | Missing |
| P4-006 holdings rebuild | no | yes | mocked manager | no | no | no | holdings only | Mocked-away |
| P4-007 emergency claim | no | yes | mocked manager | no | no | no | email mock cannot coordinate | Missing |
| P4-008 account close | not located | unknown | unknown | not located | no | no | N/A | Test not located |
| P4-009 split edit | not located | unknown | unknown | not located | no | no | N/A | Test not located |
| P4-011 logout/refresh | sequential mocked calls | yes | mocked manager | no | no | no | cookie/API absent | Unit-only |
| P4-012 failed-login counter | not located | unknown | unknown | not located | no | no | N/A | Test not located |
| P4-013 AI generation | not located | unknown | unknown | not located | no | no | real/fake provider not located | Test not located |
| P4-014 grant delivery | no | yes | mocked manager | no | no | no | simple email mock | Missing orchestration |
| P4-015 budget alerts | not located | unknown | unknown | not located | no | no | notification fake not located | Test not located |
| P4-016 staged expiry | partial timer units | yes | one/mock | no | no | no | filesystem mock | Test not located at boundary |
| P4-017 attachment cap | not located | unknown | unknown | not located | no | no | storage absent | Test not located |
| P4-018 reminders | not located | unknown | unknown | not located | no | no | notification absent | Test not located |

A strong concurrency test for these roots requires the production conflict boundary: independently acquired connections/transactions or multiple application instances, deterministic barriers, and assertion of both database state and external side effects. Sleep-only tests would not be accepted.

## 19. Time, locale, and randomness matrix

| Dimension | Current evidence | Coverage assessment | Required addition |
|---|---|---|---|
| UTC | Repository instructions expect UTC; many fixtures use `Z`; CI has no explicit `TZ` | partial/implicit | Set `TZ=UTC` in ordinary jobs and record it. |
| `Europe/Warsaw` | No targeted test located | missing | Date-only CRUD and scheduled occurrence tests in winter/summer and DST transitions. |
| Negative UTC offset | No targeted test located | missing | Run date-only UI/API tests under e.g. `America/Los_Angeles`. |
| DST transition | No targeted test located | missing | Spring-forward/fall-back scheduled dates and local-midnight boundaries. |
| Frontend locale | `render.tsx` uses `en`; Playwright fixes `en` | English-only behavior | Add `pl` and a comma-decimal locale; keep pseudo-locale visual smoke. |
| Catalog parity | `messages.parity.test.ts` and pseudo-locale check | strong structural coverage | Add behavioral formatting tests; parity cannot verify meaning/direction. |
| Comma decimal | Not located in reviewed tests | missing | Enter `1 234,56`/`1234,56` per supported UI contract and verify exact backend payload. |
| Zero/null/absent/unknown | Individual tests exist, but no uniform contract matrix | partial | Table-driven DTO/frontend adapter tests. |
| Fixed dates | Common in unit/integration fixtures | good determinism locally | Combine with explicit timezone matrix. |
| Real clock | `Date.now` used for unique IDs/expiry in several suites | partial flake exposure | Central controllable clock for scheduler/security tests. |
| Fake timers | Used selectively in MNY and components | partial | Do not use as substitute for database clock/lock races. |
| Random UUID/token | Unit token test mocks crypto; E2E uses random/Date-based identifiers | appropriate for isolation; not reproducible seeds everywhere | Log seeds/IDs and provide deterministic factory option. |
| Monte Carlo randomness | Deterministic seed test not located | not located | Inject seed and assert repeatable distribution/statistics. |
| Playwright retries | `2` in CI | can hide first-attempt flake | Capture first-attempt failure and trend flake rate. |
| Scheduler boundary | One worker and one app stack | missing multi-instance timing | Two scheduler instances with shared DB and controllable clock. |

## 20. Coverage threshold and exclusion matrix

| Layer | Provider | Global thresholds | Excluded paths | Material audit implication | CI behavior |
|---|---|---|---|---|---|
| Backend unit | Jest coverage | branches 85%, functions 95%, lines 95%, statements 94% | `main.ts`, `db-init.ts`, modules, entities, DTOs, seeds/add/fix scripts, `src/database/migrations/**`, fixtures | DTO/entity/migration/bootstrap contracts can be completely uncovered without reducing the threshold; many RLS/concurrency paths are mocked | `Backend Unit Tests` invokes unit suite with coverage; actual result not available for baseline |
| Frontend unit | V8 | branches 84%, functions 87%, lines 91%, statements 90% | test helpers, declarations, app layout/manifest, proxy, types | API types/proxy and some app shell contracts can be excluded; high totals do not prove missing-FX or partial-state behavior | `Frontend Unit Tests` runs `test:cov`; actual result unavailable |
| Backend integration | Jest, no coverage aggregation observed | none | N/A | Real DB/RLS tests do not contribute to global backend threshold | Separate integration job; can pass with zero tests due `--passWithNoTests` |
| E2E | Playwright | no code-coverage threshold | N/A | Browser behavior does not contribute to unit thresholds | Four shard jobs; retries 2; actual baseline status unavailable |
| Migration lint/schema | script/shell | pass/fail, not percentage | Static parser scope and schema comparison | Strong for guarded re-apply/drift; does not prove concurrent migration or every data-migration semantic | Separate jobs/steps; status unavailable |
| Changed-file/per-file | none located | none | N/A | A newly added high-risk file can be weakly tested while global totals remain above threshold | Not enforced in inspected config |

Confirmed defect paths that aggregate coverage does not adequately protect include DTO/type contracts for partial valuation, migration/startup concurrency, entities/schema constraints, and provider/deployment behavior. This does not mean those exclusions are automatically wrong; it means aggregate percentages cannot be cited as evidence for the audited invariants.

## 21. CI workflow and job inventory

### 21.1 Workflow inventory

| Workflow/path | Trigger | SHA tested | Permissions | Concurrency/path filters | Main verification/publish behavior | Required status |
|---|---|---|---|---|---|---|
| `CI Pipeline` - `.github/workflows/ci.yml` | `push` to `main`/`develop`; `pull_request` to same; `workflow_dispatch`; no `merge_group` | Event SHA: branch head for push, GitHub PR test SHA semantics for PR, selected branch SHA for dispatch; exact run evidence unavailable | Default `contents: read`; job-specific package/id-token/attestation/security-event/write permissions | Workflow/ref concurrency, cancel in progress; no top-level path filter | Lint, types, unit coverage, integration, audit, licenses, schema, scanners, four E2E shards, preview images; manual signed release | unknown |
| PR checklist - `.github/workflows/pr-checklist.yml` | PR events and push to `main` as configured | Event SHA | PR read/write as configured | No required-rule evidence | Validates checklist for PR; push path has no PR body and is designed to pass | unknown; comments are not proof |
| Lighthouse - `.github/workflows/lighthouse.yml` | PR/path-filtered and/or configured dispatch | Event SHA | read plus report/comment permissions as configured | Frontend-related path filters | Performance/accessibility-style checks against built/full stack | unknown |
| ZAP - `.github/workflows/zap.yml` | schedule/manual | Scheduled branch/dispatch SHA | read/security or issue permissions as configured | Separate from PR gate | Dynamic scan with `fail_action: false`; visibility/reporting rather than blocking | not proven required |
| Fork images - `.github/workflows/fork-images.yml` | fork-specific push/PR conditions | Event SHA | package write where permitted | Conditions restrict upstream behavior | Builds/publishes images for forks; explicitly separate from upstream release gate | not applicable/unknown |
| GHCR cleanup - `.github/workflows/ghcr-cleanup.yml` | schedule/manual | Workflow branch SHA | package deletion/write as configured | Maintenance only | Registry retention/cleanup | not applicable |
| Bearer exceptions review - `.github/workflows/bearer-exceptions-review.yml` | schedule/manual or configured events | Event SHA | issue/write as configured | Maintenance only | Opens/reports overdue static-scan exceptions | not proven required |

No complete immutable directory listing was available, so this table covers every workflow discovered and re-fetched, not a proven exhaustive workflow set.

### 21.2 Primary CI job inventory

| Status/job name | Matrix/services | Main steps | `needs`/conditions | Continue on error/retry | Timeout/artifacts | Finding status |
|---|---|---|---|---|---|---|
| `Backend Lint & Type Check` | Node 24 | `npm ci`, lint, TypeScript, migration-lint self-test and lint | independent | no job-level allowance | default timeout; no special artifact | safe/positive control |
| `Backend Unit Tests` | Node 24 | unit Jest with coverage | independent | no | coverage artifact `if: always()` | safe, but wrong assertions included |
| `Backend Integration Tests` | PostgreSQL 16 service, Node 24 | build then `npm run test:integration` | independent | script contains `--passWithNoTests` | default; no explicit test-count artifact | **P7-006** |
| `Frontend Lint & Type Check` | Node 24 | lint, type-check, pseudo-locale check | independent | no | default | safe/positive control |
| `Frontend Unit Tests` | Node 24 | Vitest coverage | independent | no | coverage artifact always | safe, but wrong assertions included |
| `NPM Audit` | backend/frontend | production audit blocks HIGH; dev audit informational | independent | dev audit `continue-on-error: true` | logs | intentional visibility split |
| `License Compliance (backend/frontend)` | package matrix | production license allowlist | independent | `fail-fast: false` matrix | default | safe/positive control |
| `Schema vs Migrations Drift` | Docker/PostgreSQL script | schema apply, migrations, repeat, compare | independent | no | script output | strong for covered invariant |
| `Frontend Bundle Size` | frontend | production build and size report | PR-only | N/A | job summary | informational, not push gate |
| `Env Var Documentation` | Node | configuration/documentation consistency script | independent | no | logs | positive control |
| `Workflow Security Scan (zizmor)` | Python/uv | emits SARIF | independent | scanner command ends `|| true` | SARIF always | non-blocking by design |
| `Dockerfile Lint (hadolint)` | backend/frontend | lint both Dockerfiles | independent | no | logs | positive control |
| `Bearer Security Scan` | repository | static scan with reviewed exception fingerprints | independent | configured exclusions | scanner output | blocking behavior depends action result; exceptions reviewed separately |
| `E2E Browser Cache` | Node, Chromium/Firefox cache | install dependencies/cache/download browsers | needs backend/frontend unit | download conditional | 15-minute browser download timeout | positive infrastructure control |
| `E2E Tests (shard N/4)` | four shards; each own PostgreSQL/backend/frontend Compose stack; Chromium+Firefox | build/start stack, install deps, run Playwright, diagnostics, teardown | needs browser cache | Playwright retries 2; `--max-failures=5`; matrix `fail-fast:false` | run 30m; reports 7 days; failure logs/comments | broad ordinary E2E; RLS/providers/concurrency limited |
| `Prepare Release` | manual `main` only | resolve version/metadata | needs lint, units, integration, audits, scanners, schema, E2E | no | outputs version/date/SHA | gates release parent SHA |
| `Build & Push (backend/frontend)` | two images, amd64/arm64 | stamp version, build/push, sign, SBOM, attest, Trivy | needs prepare release | matrix `fail-fast:false`; Trivy HIGH visibility, CRITICAL blocks | OCI artifacts/SARIF | strong image supply-chain control |
| `Commit Version & Release` | one job | version files, admin-token direct push, GitHub release | needs prepare/build | no rerun on new commit; commit uses `[skip ci]` | release artifact | **P7-007** |
| Preview preparation/build jobs | backend/frontend images | gated preview tag build/push | event/owner conditions | conditions vary; no formal release | registry images | separate preview path |

### 21.3 CI dependency and condition graph

```text
backend-unit-tests ----+
                       +--> e2e-browsers --> e2e-tests (4 isolated shards)
frontend-unit-tests ---+

backend-lint ---------------------------+
backend-unit-tests ---------------------+
backend-integration-tests --------------+
frontend-lint --------------------------+
frontend-unit-tests --------------------+
npm-audit / bearer / hadolint ----------+
license-check / schema-drift -----------+--> prepare-release
zizmor / env-doc-check -----------------+
e2e-tests ------------------------------+

prepare-release --> build-and-push (backend, frontend) --> release
                                                        --> version-bump commit pushed after tests
```

Important conditions:

- `prepare-release` runs only for `workflow_dispatch` on `refs/heads/main`.
- E2E is gated transitively only by backend and frontend unit jobs before it starts; release additionally requires the broader gate set.
- Each E2E shard uses an independent Compose stack and one Playwright worker.
- E2E retries failed tests twice in CI and stops a shard after five failures; a shard still fails if failures remain.
- Preview and formal release paths are separate.
- No `merge_group` trigger is present in the primary workflow.
- No inspected primary job uses `if: always()` to convert a failed required dependency into a successful release. Diagnostics/artifact steps use `always()` appropriately.

## 22. Branch-protection and required-check evidence

| Item | Evidence | Result |
|---|---|---|
| Required status context names | Branch protection/rulesets inaccessible | unknown |
| Strict up-to-date requirement | inaccessible | unknown |
| Merge queue enabled | inaccessible | unknown |
| Required reviews | inaccessible | unknown |
| Required conversation resolution | inaccessible | unknown |
| Force-push/deletion policy | inaccessible | unknown |
| Admin bypass | Workflow comments describe an admin-token bypass, but live rules inaccessible | unverified as current setting; workflow intent is explicit |
| Status source application restriction | inaccessible | unknown |
| Duplicate check-name spoofing exposure | required context/source rules inaccessible | unknown |
| `Verify PR checklist` required | workflow comments claim it; live rule inaccessible | unknown, not treated as verified |

No branch-protection defect is reported solely from inaccessibility. Phase 8 must not infer required checks from workflow names or comments.

## 23. Baseline SHA CI evidence

Audited SHA:

```text
d5cea9bfa995885ba5198f9843359362927c0fd4
```

| Evidence request | Connector result | Interpretation |
|---|---|---|
| Commit object | Returned successfully | Baseline identity established. |
| Combined commit status | No statuses returned | Not proof of failure or success. |
| Workflow runs for commit | No runs returned | Not proof of failure or success; connector pagination/scope may omit data. |
| Check suites/check runs | Not accessible through available connector evidence | unknown |
| Logs/annotations/artifacts | Not accessible | unknown |
| Workflow definition revision | Baseline-pinned workflow files inspected | Configuration known; execution result unknown. |

**No baseline CI evidence was available.**

The audit therefore does not state that the baseline passed CI, failed CI, met coverage, built images, ran migrations, started Compose, rendered Helm, or completed browser tests.

## 24. Docker, Compose, and Helm verification matrix

| Verification target | Existing evidence in discovered CI | Fidelity/status | Gap or note |
|---|---|---|---|
| Backend production Docker image builds | preview/release Buildx jobs | strong build evidence by configuration; no baseline run evidence | Actual build result unavailable. |
| Frontend production Docker image builds | preview/release Buildx jobs | strong configuration | Actual result unavailable. |
| Dockerfile lint | hadolint job | present | Does not start image. |
| Compose startup | four E2E shards | present, full PostgreSQL/backend/frontend | RLS off; dev image targets. |
| Fresh database initialization | Compose backend command runs `db-init` | present by configuration | Actual run unavailable. |
| Sequential migrations | Compose command and schema job | present | No multi-replica migration race. |
| Runtime application role | RLS integration only | partial | E2E stack uses owner-style role/RLS off. |
| RLS enforce mode | dedicated integration suite | strong policy-level | No full browser/HTTP deployment smoke. |
| Backend/frontend health | Compose health checks | present | Actual baseline result unavailable. |
| Local attachment provider | ordinary app path only | partial/not specifically verified in E2E | No restore byte roundtrip. |
| S3-compatible provider | no discovered CI service | not located | Needed for P3-002/P4-010. |
| Backup volume | no discovered Compose/Helm persistence smoke | not located | P3-006 risk. |
| Automatic backup | unit mocked | unit-only | No deployment persistence or cross-instance test. |
| Backup export | browser download test | present | Restore not paired. |
| Restore | backend mocked; browser deferred | confirmed gap | No full-stack restore/download. |
| Helm lint | manual README command only | design risk | No discovered job. |
| Helm template render | manual README command only | design risk | No discovered job. |
| Default Helm install | none discovered | design risk | Need kind/k3d. |
| Persistence after pod replacement | none discovered | missing/not located | Needed for backups/attachments. |
| Multi-replica startup/migration | none discovered | missing/not located | Needed for P3-016 and cron behavior. |

## 25. Skipped, flaky, retry, and allowed-failure ledger

| Path/config | Mechanism | Material relationship | Can CI pass without verification? | Recommended treatment |
|---|---|---|---|---|
| Repository test search | No `.skip`, `it.skip`, `describe.skip`, `test.todo`, `test.only`, or `it.only` located in targeted searches | Broad suite hygiene | Search was not recursive/immutable-complete | Add CI grep/AST guard for committed `.only`; report skips/todos. |
| `e2e/playwright.config.ts` | `retries: 2` in CI | Can turn first-attempt flake into green | Yes, for flaky tests that pass later; final persistent failure remains red | Publish first-attempt failures and flake rate; deterministic replacement for material tests. |
| `.github/workflows/ci.yml` E2E | `--max-failures=5` | Limits diagnostic breadth after five failures | Job remains failed; not a false green | Keep for cost control, but ensure report shows truncated count. |
| `e2e/helpers/api.ts` | one retry after CSRF 403/refresh path | Correctly models transparent CSRF refresh | Domain operation may be retried only as implemented by helper | Add explicit idempotency tests for response-loss/duplicate request. |
| Backend integration script | `--passWithNoTests` | Entire integration layer | **Yes** | Remove; P7-006. |
| NPM audit dev step | `continue-on-error: true` | Development dependencies | Yes, intentionally | Keep labeled informational; do not describe it as blocking. |
| Zizmor | command ends `|| true` | Workflow-security findings | Yes, intentionally | Define severity threshold if blocking is desired; preserve SARIF. |
| ZAP | `fail_action: false` | Dynamic security scan | Yes, intentionally | Document as monitoring; promote chosen classes to a gate after stabilization. |
| Trivy | HIGH SARIF non-blocking, CRITICAL blocking | Image vulnerabilities | Yes for HIGH, no for CRITICAL | Document release risk policy and exception SLA. |
| Fixed sleeps | No material sleep-only race accepted as evidence in reviewed canonical tests | Concurrency | N/A | Use barriers/latches. |

## 26. CI failure-path analysis

| Green-while-unverified scenario | Status | Exact reason |
|---|---|---|
| Backend integration tests are undiscovered | confirmed | `--passWithNoTests` returns success. |
| Known-bad missing FX remains | confirmed | Frontend and backend unit assertions require 1:1 fallback. |
| Known-bad override mutation remains | confirmed | Component test requires latest-price auto-fill on open. |
| Known-bad split replay remains | confirmed | Net-worth test fixture/assertion is additive. |
| Logout server failure is shown as success | confirmed | AppHeader test requires local logout and redirect after API rejection. |
| Cross-tenant backup key/retention remains | confirmed | Auto-backup unit expectations use shared names/listing. |
| Release branch head differs from tested SHA | confirmed | Version commit is created/pushed after gates with `[skip ci]`. |
| Concurrency defects remain | confirmed coverage gap | Relevant suites do not exercise independent conflict boundaries. |
| E2E passes after retry | design risk | Retry 2 can mask a first-attempt flake; final run still verifies functional pass. |
| RLS integration skipped by path filter | not confirmed | Primary workflow has no top-level path filter; integration job always scheduled for configured push/PR events. |
| Merge group merges without checks | unverified | No `merge_group` trigger, but merge queue state inaccessible. |
| Migration checks verify only current schema | rejected as overstatement | `verify-schema.sh` applies migrations twice on schema and compares; it is meaningful, though it does not prove multi-process startup or a migrations-only fresh build. |
| Required jobs are cancelled but release proceeds | not located | `prepare-release` has normal `needs`; no permissive release `if` was found. |
| Failed test artifacts are unavailable | mostly rejected | Coverage/Playwright artifacts and diagnostics use `always()`/failure paths; retention is finite. |
| Docker/Helm packaging succeeds without restore/backup smoke | Docker confirmed; Helm design risk | Images are built, but no discovered restore/provider/Helm persistence test. |

## 27. Prioritized regression plan

### P0 - Correct tests that currently protect known-bad behavior

1. Replace missing-FX numeric fallback with typed completeness across backend and frontend. Update both wrong tests and add a contract/E2E partial-state case.
2. Preserve scheduled override values until explicit quote application. Add deferred-response component tests.
3. Correct net-worth split replay to ratio multiplication with reverse/sequential split basis tests.
4. Change logout failure UX from false success to unconfirmed/failed and add a real refresh/logout race.
5. Add owner/instance namespace to automatic backups and test two users/two instances on local and S3-compatible providers.

### P0 - Establish a production-boundary concurrency harness

Create a shared integration utility with:

- two or more independently acquired PostgreSQL connections;
- explicit transaction isolation and lock-timeout control;
- named barriers/latches implemented outside sleep timing;
- helpers to start two Nest service/application/scheduler instances;
- recording provider fakes for email, object storage, and external quote side effects;
- deterministic assertions after both success and failure branches.

Use it first for P4-001 through P4-007, then P4-008 through P4-018.

### P0 - Close CI false-green paths

- Remove backend `--passWithNoTests` and assert the mandatory integration inventory/count.
- Make the release's pushed SHA identical to the tested SHA. Prefer a version-bump PR or run the full gate graph after creating the commit and before protected push.
- Record tested SHA, pushed SHA, image revision, and release target in a machine-checked provenance step.

### P1 - Recovery and provider fidelity

- Add local and S3-compatible backup/restore round trips with byte hashes, ID remapping, failure compensation, and public download verification.
- Add crash-atomic backup write tests and cross-instance retention tests.
- Add an RLS-enforce HTTP/browser smoke job using the runtime application role.
- Add real OIDC step-up issuance and destructive-endpoint tests; keep purpose mismatch cases.

### P1 - Financial contract matrix

Add table-driven integration tests covering:

- zero, null, absent, unknown, stale, and unavailable values;
- currencies and quantities requiring zero, two, three, and four decimal places;
- direct/inverse/missing FX and quote timestamps/sources;
- transfer pair VOID and server-authoritative destination amounts;
- split sign/exact equality;
- commissioned investment basis and realized gain;
- foreign-security transfer basis;
- explicit zero valuation versus provider failure;
- preview/commit quote identity.

Every case should state input, produced result, expected result, and exact monetary/quantity/rate difference.

### P1 - Deployment verification

After obtaining a complete workflow inventory, add or confirm:

- `helm lint` and default/variant `helm template` jobs;
- schema validation of rendered manifests;
- kind/k3d install and upgrade;
- default backup/attachment persistence through pod replacement;
- multi-replica startup/migration and duplicate-cron protection;
- S3-compatible attachment/backup provider smoke tests.

### P2 - Locale, time, and flake transparency

- Run focused date-only/scheduler tests in UTC, `Europe/Warsaw`, and a negative UTC offset, including DST transitions.
- Add `pl`/comma-decimal component and browser cases.
- Make Monte Carlo and other randomized tests seedable and print the seed.
- Record Playwright first-attempt failures even when a retry passes.
- Add a CI guard against `.only` and an inventory report for skipped/todo tests.

## 28. Contradictions and supersession register

| Item | Earlier/documented claim | Phase 7 evidence | Disposition |
|---|---|---|---|
| Frontend branch threshold | Scoped docs say 85% | Vitest config enforces 84% | Documentation stale; executable config authoritative. |
| Restore coverage | E2E roadmap says backend tests cover restore | Backend tests mock provider behavior and no byte round trip was found | Documentation overstates P3-002 coverage. |
| Infrastructure browser scope | Auxiliary guidance describes Chromium-only/older setup | Playwright config and CI use Chromium and Firefox | Auxiliary guidance stale. |
| Backend DB pattern | Contributor/auxiliary guidance references older QueryRunner/direct repository patterns | Current scoped instructions and tests use `withScopedDb`/manager routing | Scoped `backend/CLAUDE.md` wins; old guidance stale. |
| Money representation | Some contributor guidance uses integer-cent framing | Current database/instructions use decimal money including four-decimal cases | Old guidance stale. |
| MNY concurrency coverage | Unit comment points to integration atomicity | Integration proves same-job worker claim, not simultaneous job creation/retry replay | Do not supersede P4-001/P4-002. |
| RLS coverage | Ordinary integration might be interpreted as RLS evidence | Ordinary setup disables RLS; dedicated RLS suite enables runtime-role enforcement | Preserve strong dedicated evidence; do not generalize it to every integration suite. |
| Portfolio unavailable price | A per-holding null test exists | Aggregate completeness and missing-FX tests still accept apparently complete totals | P6-007/P5-009 remain; per-holding case is only partial coverage. |
| Transfer FX | Cross-currency integration exists | Test supplies client `exchangeRate`; no server-authority negative case | P5-002/P6-002 remains. |
| Step-up purpose | Guard tests reject wrong purpose | Real OIDC issuance/destructive endpoint path not verified | P2-005/P3-009/P6-009 reduced to unit-only verification, not disproved. |
| Phase 6 deduplication | Nine P6 items merge into earlier roots | No Phase 7 evidence disproves accepted merge decisions | Preserve all supplied deduplication decisions for Phase 8. |
| Baseline CI state | A workflow file exists | No exact baseline status/run evidence returned | Do not say baseline passed or failed. |

## 29. False positives investigated and rejected

| Candidate concern | Investigation | Rejection/qualification |
|---|---|---|
| “There are no real database tests.” | Inspected RLS, transactions, transfers, MNY, investment, security-transfer, and cross-user integration suites. | Rejected. Real PostgreSQL coverage is substantial; the issue is missing conflict boundaries and some contract cases. |
| “MNY concurrency has no test.” | Inspected the job-claim integration suite. | Rejected as stated. Same-job claim has a strong concurrent test; P4-001/P4-002 concern is different. |
| “RLS is entirely mocked.” | Inspected dedicated enforcement suite using an unprivileged runtime role. | Rejected. RLS policy coverage is strong for listed tables/contexts, while ordinary E2E remains RLS off. |
| “No cross-user tests exist.” | Inspected broad service-level isolation integration and delegation E2E. | Rejected. Remaining gaps are delegated allowlists/actor attribution/combined enforce flows. |
| “No missing-price behavior is tested.” | Found portfolio test asserting per-holding null fields. | Rejected. The confirmed issue is aggregate completeness and missing-FX fallback. |
| “No transfer FX arithmetic is tested.” | Inspected cross-currency transfer integration. | Rejected. The remaining issue is server authority, pair VOID, scheduled/split variants, and retry/concurrency. |
| “Step-up purpose is untested.” | Inspected `StepUpGuard` unit cases. | Rejected. Purpose validation is unit tested; issuance and real endpoint integration remain open. |
| “Playwright retries make the job always green.” | Inspected config and E2E command. | Rejected. Persistent failures remain red; retries can only hide first-attempt flakes. |
| “A missing `merge_group` trigger is definitely a branch-protection defect.” | Branch settings/queue state unavailable. | Rejected as confirmed defect; retained as design risk. |
| “No baseline status means CI failed.” | Requested combined status and workflow runs. | Rejected. Absence of returned evidence proves neither pass nor fail. |
| “Schema drift checks only lint SQL text.” | Inspected migration docs/script behavior. | Rejected. Runtime double-apply and schema comparison are substantive, with separate limitations. |
| “All scanner findings block releases.” | Inspected continue-on-error/`|| true`/fail-action and Trivy severity modes. | Rejected. Several scans are intentionally visibility-only; documentation should state the policy accurately. |
| “Every test file was inventoried.” | Attempted recursive immutable tree; unavailable. | Rejected. Inventory is expressly limitation-qualified. |

## 30. Track B isolation table

| Potential non-baseline source | Handling | Included in findings? |
|---|---|---|
| PR #1014 short head `8fd4c4f` | Explicitly excluded by phase instructions. | No |
| Current default-branch/search-result SHAs, including links returned by code search | Used only to discover candidate paths; each evidentiary file was re-fetched at the baseline SHA. | No direct evidence |
| Synthetic PR merge SHA | No run/status evidence accepted. | No |
| Merge-group SHA | No evidence accessible; no inference made. | No |
| Newer `main` commits | Not followed. | No |
| Workflow execution on another SHA | No successful run on another SHA was used to claim baseline success. | No |
| Track B review comments, proposed patches, or changed tests | Not accessed or incorporated as baseline defects. | No |

## 31. Audit ledger

| Ledger field | Record |
|---|---|
| Audit phase | Phase 7 - Tests, CI, Required Checks, and Verification Coverage |
| Worker-chat name | `07 - Monize Audit: Tests, CI, Required Checks, and Verification Coverage` |
| Audited SHA | `d5cea9bfa995885ba5198f9843359362927c0fd4` |
| Assigned scope | Test frameworks/configuration/inventory, helpers/fixtures, RLS/integration/E2E fidelity, concurrency, financial regression coverage, coverage thresholds/exclusions, CI workflows/dependencies/conditions, branch protection/status evidence, Docker/Compose/Helm verification, flaky/skipped/retry behavior |
| Instruction hierarchy | Root `CLAUDE.md`; scoped backend/frontend/database/MCP `CLAUDE.md`; auxiliary `.claude` guidance; contributor/security docs |
| Directories inspected | Root, `.github/workflows`, `.claude`, `backend/src`, `backend/test`, `frontend/src`, `e2e`, `database`, `docs`, `helm` |
| Files inspected in full/relevant ranges | Framework/configuration files, every discovered workflow, mandatory wrong tests, targeted backup/auth/RLS/MNY/transaction/transfer/investment/scheduled/portfolio/net-worth tests, E2E setup/fixtures/backup/delegation/roadmap, migration/schema/Docker/Helm docs and scripts |
| Files sampled | Additional large unit/integration suites where targeted ranges and semantic searches were sufficient for the assigned invariant |
| Inaccessible files/resources | Recursive immutable tree, branch protection/rulesets, required-check configuration, complete check suites/runs/logs/artifacts, complete flaky history, deployment environments |
| Capped/truncated searches | GitHub code search and large connector responses were capped/truncated; targeted exact-SHA ranges were re-fetched where needed |
| Test inventory method | Pinned config discovery + candidate path search + documentation references + exact-SHA evidence fetch; limitation-qualified, not claimed complete |
| Tests/checks examined | Jest unit/integration, Vitest/component/i18n, Playwright E2E, migration lint, schema drift, NPM audit/licenses, static/security scans, Docker builds, release flow |
| Tests actually executed | None |
| Workflow runs/statuses accessed | Baseline combined status requested: none returned. Baseline workflow runs requested: none returned. |
| Branch-protection data accessed | None; connector did not expose it |
| Test framework matrix | Section 11 |
| Helper/fixture ledger | Section 13 |
| Findings-to-tests matrix | Sections 14-15 |
| Incorrect tests | Six individual assertions in Section 16, grouped into five confirmed findings |
| Confirmed missing tests | Sections 7.1 and findings P7-008/P7-009 |
| Tests not located | Section 7.2 |
| Mock-fidelity matrix | Section 17 |
| Concurrency fidelity matrix | Section 18 |
| Time/locale/randomness matrix | Section 19 |
| Coverage matrix | Section 20 |
| Workflow/job inventory | Section 21 |
| Branch protection/required checks | Section 22: inaccessible/unknown |
| Baseline CI evidence | Section 23: no evidence available |
| Docker/Helm coverage | Section 24 |
| Skipped/flaky/retry ledger | Section 25 |
| Confirmed findings by severity | 0 BLOCKER, 1 HIGH, 8 MEDIUM, 1 LOW |
| Design risks | Seven general risks plus P7-010 Helm verification risk |
| Documentation issues | Seven entries; one consolidated LOW finding |
| Open hypotheses | Required checks/merge queue, full workflow/test inventory, several test-not-located cases |
| False positives rejected | Section 29 |
| Areas without material findings | Section 9.3 |
| Dependencies on Phases 1-6 | Accepted baseline, canonical roots, mandatory backlog, Phase 6 deduplication decisions |
| Contradictions with earlier reports | None that disproves an accepted root; several coverage assumptions narrowed in Section 28 |
| Duplicates/strengthening/supersession | P7 findings classify verification defects only; implementation roots remain in source phases. P7-001 strengthens P5-009/P6-006; P7-004 strengthens P4-011/P6-010; P7-005 strengthens P3-001. |
| Track B isolation | Section 30 |
| Report filename | `monize-audit-07-tests-ci.md` |
| Completion status | Complete with explicit connector limitations |
| Next required action | Phase 8 final verification and deduplication at the same SHA |

### 31.1 Exact baseline-pinned evidence paths

The following paths were directly fetched at `ref=d5cea9bfa995885ba5198f9843359362927c0fd4` during this phase:

- `CLAUDE.md`
- `backend/CLAUDE.md`
- `frontend/CLAUDE.md`
- `database/CLAUDE.md`
- `backend/src/mcp/CLAUDE.md`
- `.claude/settings.json`
- `.claude/skills/backend.md`
- `.claude/skills/frontend.md`
- `.claude/skills/infrastructure.md`
- `README.md`
- `CONTRIBUTING.md`
- `SECURITY.md`
- `frontend/package.json`
- `frontend/vitest.config.ts`
- `frontend/src/test/setup.ts`
- `frontend/src/test/render.tsx`
- `frontend/src/i18n/messages.parity.test.ts`
- `frontend/src/hooks/useExchangeRates.test.ts`
- `frontend/src/components/scheduled-transactions/OverrideEditorDialog.test.tsx`
- `frontend/src/components/layout/AppHeader.test.tsx`
- `frontend/src/store/authStore.test.ts`
- `backend/package.json`
- `backend/test/jest-e2e.json`
- `backend/src/test-helpers/scoped-db-testing.ts`
- `backend/test/helpers/integration-setup.ts`
- `backend/test/integration/rls-harness.integration.spec.ts`
- `backend/test/integration/rls-enforcement.integration.spec.ts`
- `backend/test/integration/security-cross-user-isolation.integration.spec.ts`
- `backend/src/auth/step-up/step-up.guard.spec.ts`
- `backend/src/auth/auth.service.spec.ts`
- `backend/src/auth/token.service.spec.ts`
- `backend/src/emergency-access/emergency-access.service.spec.ts`
- `backend/src/emergency-access/emergency-access.controller.spec.ts`
- `backend/src/backup/auto-backup.service.spec.ts`
- `backend/src/backup/backup.service.spec.ts`
- `backend/src/import/mny/mny-import-job.service.spec.ts`
- `backend/test/integration/mny-import-job.integration.spec.ts`
- `backend/test/integration/transactions.integration.spec.ts`
- `backend/test/integration/transfers.integration.spec.ts`
- `backend/test/integration/investment-transactions.integration.spec.ts`
- `backend/test/integration/security-transfer.integration.spec.ts`
- `backend/src/scheduled-transactions/scheduled-transactions.service.spec.ts`
- `backend/src/securities/holdings.service.spec.ts`
- `backend/src/securities/portfolio.service.spec.ts`
- `backend/src/net-worth/net-worth.service.spec.ts`
- `backend/src/db-init.spec.ts`
- `backend/src/db-migrate.spec.ts`
- `e2e/package.json`
- `e2e/playwright.config.ts`
- `e2e/global-setup.ts`
- `e2e/fixtures.ts`
- `e2e/helpers/api.ts`
- `e2e/tests/backup.spec.ts`
- `e2e/tests/delegation.spec.ts`
- `e2e/ROADMAP.md`
- `docker-compose.e2e.yml`
- `.github/workflows/ci.yml`
- `.github/workflows/pr-checklist.yml`
- `.github/workflows/lighthouse.yml`
- `.github/workflows/zap.yml`
- `.github/workflows/fork-images.yml`
- `.github/workflows/ghcr-cleanup.yml`
- `.github/workflows/bearer-exceptions-review.yml`
- `scripts/verify-schema.sh`
- `docs/database-migrations.md`
- `docs/cron-jobs.md`
- `docs/support-backup.md`
- `helm/Chart.yaml`
- `helm/values.yaml`
- `helm/README.md`

## 32. Handoff to Phase 8

Phase 8 must continue to audit exactly:

```text
AUDIT_BASELINE_SHA=d5cea9bfa995885ba5198f9843359362927c0fd4
```

### 32.1 Accepted phase reports

The final report should consume and deduplicate the accepted reports:

1. `monize-audit-01-baseline-architecture.md`
2. `monize-audit-02-security-rls.md`
3. `monize-audit-03-database-backup.md`
4. `monize-audit-04-backend-concurrency.md`
5. `monize-audit-05-financial-correctness.md`
6. `monize-audit-06-frontend-contracts.md`
7. `monize-audit-07-tests-ci.md`

### 32.2 Canonical deduplication to preserve

Preserve the accepted Phase 6 merge decisions unless baseline re-fetch disproves them:

- P6-001 with P5-001;
- P6-002 with P5-002;
- P6-004 with P5-013;
- P6-006 with P5-009;
- P6-008 with P5-010;
- P6-009 with P2-005/P3-009;
- P6-011 with P5-004;
- P6-013 with P5-006;
- P6-014 with P3-014.

Distinct Phase 6 roots remain P6-003, P6-005, P6-007, P6-010, P6-012, and P6-015.

### 32.3 BLOCKER/HIGH re-fetch list

No Phase 7 BLOCKER was found. Before including any existing HIGH implementation root or P7-008 in the final report, Phase 8 must re-fetch all relevant files from the baseline and independently verify the complete scenario. At minimum re-verify:

1. P3-001 - automatic-backup service and provider key/retention paths; include P7-005 wrong test.
2. P3-002 - backup restore, attachment metadata, local/S3 providers; include P7-009 missing round trip.
3. P4-001/P4-002 - MNY start, job creation/claim, import commit/retry, and integration test boundary.
4. P4-003 - transaction update/delete snapshots, balance writes, integration coverage.
5. P4-004 - scheduled occurrence selection/posting/idempotency and scheduler test boundary.
6. P4-005 - balance recomputation and concurrent transaction delta.
7. P4-006 - holdings update/rebuild and investment transaction commit.
8. P4-007 - claim validation/consumption/grant delivery and emergency tests.
9. P5-001/P6-001 - transfer pair VOID/status/ledger equivalence and integration tests.
10. P5-002/P6-002 - direct/scheduled/split transfer FX authority and DTO/API/frontend path.
11. P5-009/P6-006 - missing FX backend/frontend behavior and both wrong tests in P7-001.
12. P5-011 - historical split implementation and P7-003 wrong test.
13. P6-003 - preview/commit quote acquisition and missing-rate path.
14. P6-005 - override editor implementation and P7-002 wrong test.
15. P6-007 - portfolio backend DTO, frontend adapter/component, and completeness representation.
16. P6-010 - AppHeader/auth API/backend logout/token family behavior and P7-004 wrong test.
17. P7-008 - confirm no baseline test at the production conflict boundary for the canonical races; downgrade if a previously inaccessible test disproves a row.

### 32.4 Exact incorrect tests to preserve in the final remediation plan

- `frontend/src/hooks/useExchangeRates.test.ts:90-190`
- `backend/src/securities/portfolio.service.spec.ts:760-850`
- `frontend/src/components/scheduled-transactions/OverrideEditorDialog.test.tsx:480-680`
- `backend/src/net-worth/net-worth.service.spec.ts:300-560`
- `frontend/src/components/layout/AppHeader.test.tsx:90-130`
- `backend/src/backup/auto-backup.service.spec.ts:430-780`

Do not cite a green run containing these assertions as evidence that the corresponding implementation root is fixed.

### 32.5 CI and required-check handoff

- The primary workflow has no `merge_group` trigger; merge-queue use is unknown.
- `backend/package.json` uses `--passWithNoTests` for integration discovery (P7-006).
- The manual release workflow pushes a different `[skip ci]` version commit after tests and explicitly uses an admin token to bypass a checklist status (P7-007).
- Branch protection, required checks, strictness, status source, review requirements, and bypass policy were inaccessible.
- **No baseline CI evidence was available.** Do not state that the baseline passed or failed.
- Obtain exact baseline check suites/runs and branch rules before making final claims about required checks.

### 32.6 Numerical examples to carry forward

- Missing FX: `100.00 USD`, no USD/CAD or CAD/USD -> unavailable, not `100.00 CAD`; at a later true `1.3500`, the false total differs by `35.00 CAD`.
- Override preservation: stored `250.00`, latest `123.45`, unrelated edit -> expected `250.00`; silent change `-126.55` per share.
- Stock split: `90 * 2.0 = 180`; additive implementation produces `92`, difference `-88` shares; ratio `90.0` would produce `8,100`.
- Transfer authority: source `100.00`, rate `1.3500` -> destination `135.00`; tampered `999.99` differs by `864.99`.
- Commissioned basis: 10 at `20.00` plus `5.00` fee -> `205.00` basis and `20.50/share`; sale example in Section 15.4.
- Exact splits: `-3.3333 - 3.3333 - 3.3334 = -10.0000`.

### 32.7 Unverified/inaccessible scope not to silently close

- immutable recursive tree and complete test/workflow inventory;
- branch protection/rulesets and required context names;
- exact baseline CI run/check/log/artifact evidence;
- merge queue/merge-group evidence;
- tests listed as `not located` in Section 7.2;
- actual Kubernetes/Helm, S3, SMTP, OIDC, AI, and production database environments;
- complete flaky/retry history.

### 32.8 False positives not to reopen without new evidence

- Do not claim there are no real PostgreSQL, RLS, cross-user, MNY claim, transfer, migration, or Playwright tests.
- Do not claim Playwright retries always make E2E green.
- Do not claim a missing `merge_group` trigger is defective unless merge queue use is established.
- Do not treat absent baseline status data as CI failure.
- Do not treat every coverage exclusion or non-blocking scanner as a defect without a concrete failure scenario.
- Do not treat Track B/current-branch search links as baseline evidence.

### 32.9 Final-report remediation ordering input

1. Correct the six wrong assertions and their production contracts.
2. Add production-boundary concurrency coverage for P4-001 through P4-007.
3. Remove integration zero-test pass behavior and bind release to the exact tested SHA.
4. Add attachment-provider restore round trips and backup namespace/provider failure tests.
5. Add server-authoritative financial contract matrices and partial-value UI coverage.
6. Add OIDC/destructive-step-up, RLS-enforce HTTP smoke, locale/timezone, and deployment/Helm tests.
7. Reconcile documentation with executable configuration and publish the actual required-check policy.

Phase 8 should remove duplicates, downgrade or remove any finding that fails independent baseline verification, and keep verification defects (this report) distinct from the underlying implementation defects in Phases 2-6.
