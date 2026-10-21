# Monize Full Read-Only Audit - Final Maintainer Report

**Repository:** `kenlasko/monize`  
**Audited baseline:** `d5cea9bfa995885ba5198f9843359362927c0fd4`  
**Audit mode:** read-only, fixed-revision, static repository inspection  
**Runtime execution:** none in Phase 8; earlier phases also recorded their own execution limits  
**Report status:** final deduplicated baseline report

## 1. Executive summary

This audit reviewed the Monize repository as a personal-finance system in which authorization, recovery, transaction ordering, financial arithmetic, derived balances/holdings, backup portability, frontend contracts, and release verification are all material integrity boundaries. The codebase contains meaningful controls: scoped database transactions, broad user scoping, real PostgreSQL integration suites, unprivileged-role RLS tests, migration lint/schema drift checks, atomic SQL increments for ordinary balance deltas, single-winner claiming of an already-created MNY job, and purpose-bound step-up tokens for the endpoints that actually require them. Those controls are real, but they do not cover several cross-transaction and cross-provider workflows.

The final registry contains **70 unique confirmed findings** after consuming all seven accepted phase reports, re-fetching every retained HIGH evidence path from the fixed SHA, merging cross-layer duplicates, preserving verification defects separately, and downgrading two provisional HIGH candidates. No BLOCKER survived final verification. The most urgent risks are destructive backup namespace collisions; local/S3 attachment restore that commits metadata without restored bytes; non-idempotent MNY starts/retries; stale or incompatible balance/holding mutation protocols; duplicate scheduled occurrences; a double-consumable emergency claim; server-nonauthoritative transfer FX/value; false 1:1 conversion when FX is missing; incorrect historical stock-split replay; destructive frontend form initialization; and complete-looking partial portfolio totals.

The report does not claim runtime reproduction. The confirmed implementation defects are retained only where the failure follows deterministically from the inspected code, schema, transaction boundaries, deployment model, and ordinary PostgreSQL semantics. Live branch protection and complete baseline CI/check evidence were inaccessible. **No baseline CI evidence was available.**

### Final count

| Severity | Unique canonical findings |
| --- | --- |
| BLOCKER | 0 |
| HIGH | 16 |
| MEDIUM | 47 |
| LOW | 7 |
| Total | 70 |

### Separate consolidated registers

| Register | Count | Counting rule |
| --- | --- | --- |
| Design risks and open hypotheses | 20 | Not included in the 70 unless promoted to a canonical confirmed finding |
| Missing regression-test scenarios | 48 | Scenario inventory; MON-M46 and MON-M47 are the two canonical systemic missing-test findings |
| Documentation inconsistencies | 24 | Consolidated issue inventory; four documentation roots are canonical findings |
| Known-wrong tests | 6 | Six exact file/assertion entries grouped into five canonical verification findings and linked to production roots |

## 2. Audited SHA

Every evidentiary repository read used `ref=d5cea9bfa995885ba5198f9843359362927c0fd4`. The baseline resolves to commit `d5cea9bfa995885ba5198f9843359362927c0fd4` (merge commit for PR #1016; the merged subject includes `Fix missing IdToken TTL in OIDC provider config`; committed 2026-08-01T16:15:28Z). `main` was not re-resolved for this phase, and moving-head links returned by code search were used only to discover candidate paths before each evidentiary file was re-fetched from the fixed SHA.

The seven accepted phase reports consumed were:

| Phase | Accepted report | Phase-local confirmed findings | Scope |
| --- | --- | --- | --- |
| Phase 1 | monize-audit-01-baseline-architecture.md | 4 | Baseline, instruction hierarchy, architecture |
| Phase 2 | monize-audit-02-security-rls.md | 9 | Security, authorization, delegation, RLS |
| Phase 3 | monize-audit-03-database-backup.md | 16 | Schema, migrations, backup, restore, support backup |
| Phase 4 | monize-audit-04-backend-concurrency.md | 18 | Transactions, concurrency, jobs, external effects |
| Phase 5 | monize-audit-05-financial-correctness.md | 13 | Financial arithmetic, currency, investments, simulations |
| Phase 6 | monize-audit-06-frontend-contracts.md | 15 | Frontend contracts, cache, state, localization |
| Phase 7 | monize-audit-07-tests-ci.md | 10 | Tests, CI, release verification; plus one design risk |

Phase-local counts sum to 85. The final count is 70 because duplicate cross-layer roots were merged or superseded, while severity was independently reassessed. Phase 7 also recorded one design risk that remains outside the canonical finding count.

## 3. Method and limitations

### Method

1. Established and preserved the immutable SHA from Phase 1.
2. Consumed the complete accepted reports from Phases 1 through 7 rather than conversational summaries.
3. Applied the repository instruction hierarchy before implementation review.
4. Traced material behavior across controller/DTO/service/transaction/query/entity/migration/API type/frontend adapter/component/test/CI layers where applicable.
5. Re-fetched every retained BLOCKER/HIGH implementation, schema, migration, frontend, test, workflow, and documentation file from the fixed SHA.
6. Reconstructed realistic failure interleavings and exact financial examples.
7. Merged duplicates, preserved verification defects separately, rejected unsupported hypotheses, and downgraded findings whose final evidence did not justify the provisional severity.
8. Built a consolidated coverage, false-positive, test, documentation, and remediation ledger.

### Important limitations

- Repository cloning, dependency installation, unit/integration/E2E execution, PostgreSQL startup, multi-connection race reproduction, migrations, containers, object stores, filesystems, SMTP, OIDC providers, market-data providers, and deployments were not available in Phase 8.
- The GitHub connector did not expose a complete immutable recursive tree. Search could be capped and could point at a newer branch head; every file used as evidence was therefore fetched directly by path and fixed ref. Absence from search is reported as `not located`, not proof of repository-wide absence.
- Combined status and workflow-run queries returned no entries for the baseline. Check suites, check runs, logs, artifacts, rulesets, required status contexts, strict up-to-date policy, merge queue, `merge_group` checks, review requirements, status-source restrictions, and admin bypass settings were inaccessible.
- Production database role attributes, grants, RLS enforcement, data volumes, provider configuration, mounted volumes, bucket policies, and operational runbooks were not inspected in a live environment.
- Exact line ranges in this report identify the relevant fixed-SHA chunks inspected; large files were sampled in material contiguous ranges rather than claimed as fully reviewed.
- No finding is described as runtime-reproduced unless the relevant accepted phase explicitly executed it; this final phase executed no repository tests or runtime scenarios.

## 4. Repository instruction hierarchy

| Precedence | Instruction source | Applied scope / note |
| --- | --- | --- |
| 1 | Project audit instructions | Fixed baseline, read-only operation, phase deliverables, finding standard, financial examples, and final verification gate. |
| 2 | `CLAUDE.md` | Repository-wide architecture, commands, i18n, testing, and workflow rules. |
| 3 | `backend/CLAUDE.md` | Backend transactions, RLS/scoped DB, modules, jobs, localization, and tests. |
| 3 | `frontend/CLAUDE.md` | Frontend state, API/cache/contracts, forms, localization, and tests. |
| 3 | `database/CLAUDE.md` | Schema, migrations, RLS, idempotency, and database-role expectations. |
| 4 | `backend/src/mcp/CLAUDE.md` | More specific MCP subtree requirements. |
| 5 | `.claude/settings.json`, `.claude/skills/*.md` | Auxiliary guidance; treated as subordinate when less specific or stale. |
| 6 | `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, relevant `docs/` | Product, deployment, contribution, recovery, RLS, cron, import, and testing documentation. |
| 7 | `AGENTS.md` | Not located. Connector search cannot prove repository-wide absence because no recursive immutable tree was available. |

Nearest-scoped instructions took precedence. Material contradictions were recorded rather than silently reconciled: contributor/auxiliary transaction examples lag the scoped `withScopedDb` rule; attachment, MNY retry, emergency claim, and failed-login comments overstate guarantees; cron documentation is incomplete; and test/release documentation does not state the zero-test and post-gate SHA gaps.

## 5. Architecture overview

| Area | Observed architecture | Primary inspected evidence |
| --- | --- | --- |
| Frontend | Next.js application under `frontend/src/app`, reusable components/hooks, Zustand authentication/preferences state, Axios-style API modules, and handwritten TypeScript response types. | frontend/src/app/**; frontend/src/components/**; frontend/src/hooks/useExchangeRates.ts:1-260; frontend/src/store/authStore.ts:1-300; frontend/src/types/investment.ts:1-340 |
| Backend | NestJS modules and services with TypeORM entities/repositories. Large domain services coordinate transactions, imports, investments, schedules, backups, authentication, delegation, and notifications. | backend/src/app.module.ts; backend/CLAUDE.md; backend/src/transactions/**; backend/src/securities/**; backend/src/backup/** |
| Scoped database transactions | `withScopedDb` stores an EntityManager in AsyncLocalStorage; nested calls join the ambient manager. Top-level calls set RLS GUCs, commit/rollback, and release. `runOutsideActiveScopedManager` deliberately escapes for job progress/heartbeats. | backend/src/common/db/scoped-db.ts; backend/src/common/db/with-context.ts; backend/src/common/request-context.ts |
| RLS | Policies use request-derived effective/real user and optional system context. Deployment expects an unprivileged runtime role; dedicated integration suites exercise enablement and enforcement. | database/migrations/114_rls_policies_special.sql; database/migrations/123_rls_enable.sql; backend/test/integration/rls-*.integration.spec.ts |
| Schema and migrations | Canonical schema plus ordered SQL migrations tracked by full filename. Entry points run initialization/migration before the API process; migrations are individually transactional but not globally serialized. | database/schema.sql; backend/src/db-init.ts; backend/src/db-migrate.ts; docs/database-migrations.md; backend/docker-entrypoint.sh |
| Authentication and delegation | JWT access and HttpOnly refresh cookies, refresh-token families, local/OIDC login, 2FA, purpose-bound step-up tokens, and owner/delegate acting contexts. | backend/src/auth/auth.controller.ts:1-1300; backend/src/auth/token.service.ts:100-275; backend/src/auth/step-up/step-up.guard.ts:1-260; backend/src/delegation/** |
| Cash ledger | Signed transactions are authoritative source rows while `accounts.current_balance` is application-maintained derived state. Transfers are paired rows with opposite signs; splits and VOID status alter inclusion. | backend/src/transactions/transactions.service.ts; backend/src/transactions/transaction-transfer.service.ts; backend/src/accounts/accounts.service.ts; database/schema.sql |
| Investments and holdings | Investment transactions create cash effects and update materialized holdings quantity/average cost. Portfolio and net-worth services add prices, FX, historical snapshots, and aggregate returns. | backend/src/securities/investment-transactions.service.ts; backend/src/securities/holdings.service.ts; backend/src/securities/portfolio-calculation.service.ts; backend/src/net-worth/net-worth.service.ts |
| Backup and restore | JSON-oriented export/restore with ID remapping, optional encryption/compression, automatic local/S3 artifacts, retention/promotion, database attachment bytes, and a de-identified support-backup path. | backend/src/backup/backup.service.ts; backend/src/backup/auto-backup.service.ts; backend/src/backup/backup-id-remap.util.ts; docs/support-backup.md |
| MNY import | Staged files are stored in PostgreSQL, persistent job rows drive a detached worker, one data transaction writes mapped rows, and progress/heartbeat/finalization use separate state transactions. | backend/src/import/mny/mny-import.service.ts; backend/src/import/mny/mny-import-job.service.ts; database/migrations/117_mny_import_staging_and_jobs.sql |
| Scheduled/background work | Nest scheduler runs in every API replica. Jobs post scheduled transactions, recompute balances/holdings, send reminders, generate insights, monitor emergency access, clean data, and run automatic backups. | docs/cron-jobs.md:1-90; backend/src/scheduled-transactions/scheduled-transactions.service.ts; helm/templates/statefulset-backend.yaml |
| Caching and contracts | Frontend API cache and local component/store state sit on handwritten contracts; mutation invalidation is distributed rather than generated from one schema. | frontend/src/lib/apiCache.ts; frontend/src/lib/**; frontend/src/types/**; frontend/src/components/** |
| Tests | Jest/Vitest unit tests, real PostgreSQL integration suites, Playwright E2E, migration/schema checks, and coverage gates. Several concurrency/provider boundaries remain mock-only or absent. | backend/package.json; frontend/package.json; backend/test/integration/**; .github/workflows/ci.yml |
| Deployment and CI | Docker Compose and Helm deploy API/frontend/PostgreSQL and optional storage. A single CI workflow runs lint, unit, integration, E2E, security, schema, image, preview, and manual release paths. | docker-compose.*.yml; helm/**; .github/workflows/ci.yml:1-820 |

## 6. Final finding-count summary

| Severity | Confirmed canonical findings | Interpretation |
| --- | --- | --- |
| BLOCKER | 0 | No catastrophic/baseline-invalidating root survived verification. |
| HIGH | 16 | Realistic broad financial corruption, destructive recovery failure, or account/security compromise. |
| MEDIUM | 47 | Constrained but material data, security, financial, availability, deployment, or verification defects. |
| LOW | 7 | Bounded operational, notification, migration-startup, cap, or documentation defects. |
| Total | 70 | Unique deduplicated registry. |

### Classification summary

| Classification | Count |
| --- | --- |
| confirmed defect | 57 |
| confirmed verification defect | 7 |
| missing test | 2 |
| stale documentation | 4 |

### Canonical index

| ID | Severity | Classification | Title | Supporting phase IDs |
| --- | --- | --- | --- | --- |
| MON-H01 | HIGH | confirmed defect | Automatic backups from different owners and instances share one filename and retention namespace | P3-001; P2-001 superseded; P7-005 supporting wrong test |
| MON-H02 | HIGH | confirmed defect | Restore remaps local/S3 attachment metadata without copying or verifying the external bytes | P3-002; P7-009 supporting missing test |
| MON-H03 | HIGH | confirmed defect | Concurrent Microsoft Money import starts can create separate active jobs for one user | P4-001; P1-001 superseded |
| MON-H04 | HIGH | confirmed defect | An import worker crash after the data commit can make retry replay the committed source | P4-002 |
| MON-H05 | HIGH | confirmed defect | Transaction, transfer, reconciliation, and bulk mutations derive balance deltas from stale snapshots | P4-003 |
| MON-H06 | HIGH | confirmed defect | Scheduled posting has no durable occurrence identity and commits money before advancing the schedule | P4-004 |
| MON-H07 | HIGH | confirmed defect | Absolute balance recomputation can overwrite a concurrent committed atomic delta | P4-005 |
| MON-H08 | HIGH | confirmed defect | Holding updates and full rebuilds can lose concurrent investment transactions | P4-006 |
| MON-H09 | HIGH | confirmed defect | One emergency-access claim token can be consumed successfully by two concurrent requests | P4-007 |
| MON-H10 | HIGH | confirmed defect | Transfer VOID transitions can leave the two legs and both balances inconsistent | P5-001; P6-001 supporting frontend path |
| MON-H11 | HIGH | confirmed defect | Transfer currencies, FX rate, and destination value are not server-authoritative | P5-002; P6-002 supporting frontend path |
| MON-H12 | HIGH | confirmed defect | Unavailable foreign exchange is converted as a valid-looking 1:1 value | P5-009; P6-006 supporting frontend path; P7-001 wrong tests |
| MON-H13 | HIGH | confirmed defect | Historical net-worth replay adds a stock-split ratio instead of multiplying shares | P5-011; P7-003 supporting wrong test |
| MON-H14 | HIGH | confirmed defect | Investment preview and commit can use different exchange rates without disclosure | P6-003 |
| MON-H15 | HIGH | confirmed defect | Opening an existing scheduled investment override can replace its stored price with the latest quote | P6-005; P7-002 supporting wrong test |
| MON-H16 | HIGH | confirmed defect | Partial or unavailable portfolio valuations are rendered as complete ordinary totals | P6-007 |
| MON-M01 | MEDIUM | stale documentation | Deployment documentation and documented defaults do not match the inspected Compose and Helm manifests | P1-002 |
| MON-M02 | MEDIUM | stale documentation | Official contributor guidance recommends database transaction APIs prohibited by the scoped repository instructions | P1-003 |
| MON-M03 | MEDIUM | confirmed defect | Delegated /users/me responses expose fields outside the intended delegated profile | P2-003 |
| MON-M04 | MEDIUM | confirmed defect | MCP sessions keep the scopes from session creation after the bearer token is revalidated | P2-004 |
| MON-M05 | MEDIUM | confirmed defect | OIDC destructive-action confirmation accepts an arbitrary non-empty value instead of verified reauthentication | P2-005; P3-009 and P6-009 supporting evidence |
| MON-M06 | MEDIUM | confirmed defect | Delegation create, link, and revoke paths conflict with enforced RLS ownership semantics | P2-007 |
| MON-M07 | MEDIUM | confirmed defect | Delegated activity is attributed to the effective owner rather than the real actor | P2-008 |
| MON-M08 | MEDIUM | confirmed defect | Restore ordering can deterministically fail linked asset/loan account relationships | P3-003 |
| MON-M09 | MEDIUM | confirmed defect | Automatic-backup artifacts are published through non-crash-atomic final-file operations | P3-004 |
| MON-M10 | MEDIUM | confirmed defect | Authenticated users can browse and select arbitrary server filesystem backup paths | P3-005; P2-002 superseded |
| MON-M11 | MEDIUM | confirmed defect | The default Helm deployment exposes automatic backup behavior without a writable persistent backup mount | P3-006 |
| MON-M12 | MEDIUM | confirmed defect | Backup export reads tables through separate transactions instead of one consistent database snapshot | P3-007 |
| MON-M13 | MEDIUM | confirmed defect | Backup export buffers the complete database and archive in memory | P3-008 |
| MON-M14 | MEDIUM | confirmed defect | RLS enforce mode can accept an unsafe runtime database role | P3-010; P2-006 superseded |
| MON-M15 | MEDIUM | confirmed defect | The runtime application role can write migration history | P3-011 |
| MON-M16 | MEDIUM | confirmed defect | Restore decompression has no effective decompressed-size or ratio bound | P3-012 |
| MON-M17 | MEDIUM | confirmed defect | Backups containing custom currencies are not reliably portable across instances | P3-013 |
| MON-M18 | MEDIUM | confirmed defect | Support backups retain identifying custom-currency names and symbols while UI copy says names are masked | P3-014; P6-014 supporting frontend copy |
| MON-M19 | MEDIUM | confirmed defect | Global custom-currency cleanup decides deletion from tenant-filtered evidence | P3-015; P2-009 superseded |
| MON-M20 | MEDIUM | confirmed defect | Account closure can race a mutation of an existing transaction and commit a closed non-zero account | P4-008 |
| MON-M21 | MEDIUM | confirmed defect | Concurrent incremental split additions can exceed the parent transaction amount | P4-009 |
| MON-M22 | MEDIUM | confirmed defect | Local and S3 attachment bytes are not transactionally coupled to metadata and lack compensation | P4-010; Phase 3 DR-006 concretized |
| MON-M23 | MEDIUM | confirmed defect | Logout can miss a refresh token created by a concurrent rotation in the same family | P4-011 |
| MON-M24 | MEDIUM | confirmed defect | Parallel failed logins lose counter increments and delay account lockout | P4-012 |
| MON-M25 | MEDIUM | confirmed defect | AI insight generation uses a process-local guard and duplicates provider work across replicas | P4-013 |
| MON-M26 | MEDIUM | confirmed defect | Emergency-access grant issuance can send links that another replica immediately invalidates | P4-014 |
| MON-M27 | MEDIUM | confirmed defect | Ordinary transaction currency can disagree with the owning account currency | P5-003 |
| MON-M28 | MEDIUM | confirmed defect | Mixed-sign split children are accepted when their signed total happens to equal the parent | P5-004; P6-011 supporting frontend path |
| MON-M29 | MEDIUM | confirmed defect | Explicit zero or negative investment FX rates can produce inconsistent or direction-reversing cash postings | P5-005 |
| MON-M30 | MEDIUM | confirmed defect | BUY commission is omitted from cost basis although cash and UI wording include transaction fees | P5-006; P6-013 supporting misleading tooltip |
| MON-M31 | MEDIUM | confirmed defect | Transfer split amounts are omitted from budget spending | P5-007 |
| MON-M32 | MEDIUM | confirmed defect | Final scheduled loan payment recalculates principal/interest splits without shrinking the parent payment | P5-008 |
| MON-M33 | MEDIUM | confirmed defect | Monte Carlo current-value failure is converted to a real zero | P5-010; P6-008 supporting frontend path |
| MON-M34 | MEDIUM | confirmed defect | Bulk deletion can leave linked-account monthly/net-worth snapshots stale | P5-012 |
| MON-M35 | MEDIUM | confirmed defect | Foreign-security transfer resets destination account-currency cost basis to an implied 1:1 value | P5-013; P6-004 supporting frontend path |
| MON-M36 | MEDIUM | confirmed defect | A failed backend logout is presented as successful local logout | P6-010; P7-004 supporting wrong test |
| MON-M37 | MEDIUM | confirmed defect | Two-decimal split editing and one-cent tolerance conflict with four-decimal persistence | P6-012 |
| MON-M38 | MEDIUM | confirmed defect | Successful transaction mutations leave cached budget progress stale | P6-015 |
| MON-M39 | MEDIUM | confirmed verification defect | Tests explicitly validate missing FX as a successful 1:1 conversion | P7-001 |
| MON-M40 | MEDIUM | confirmed verification defect | The scheduled-override test expects an existing price to be overwritten by the latest quote | P7-002 |
| MON-M41 | MEDIUM | confirmed verification defect | The historical stock-split test fixture encodes additive shares instead of a ratio | P7-003 |
| MON-M42 | MEDIUM | confirmed verification defect | The AppHeader test expects logout failure to look successful | P7-004 |
| MON-M43 | MEDIUM | confirmed verification defect | Automatic-backup tests expect generic cross-owner keys and retention patterns | P7-005 |
| MON-M44 | MEDIUM | confirmed verification defect | The backend integration CI command can succeed after discovering zero tests | P7-006 |
| MON-M45 | MEDIUM | confirmed verification defect | The release workflow pushes a new [skip ci] version-bump commit after testing a different SHA | P7-007 |
| MON-M46 | MEDIUM | missing test | Canonical concurrency defects lack deterministic tests at the production conflict boundary | P7-008 |
| MON-M47 | MEDIUM | missing test | No local/S3 attachment backup-restore round trip verifies metadata, bytes, remapping, and compensation | P7-009 |
| MON-L01 | LOW | stale documentation | A stale PAT comment mentions a reports scope that issuance and enforcement do not support | P1-004 |
| MON-L02 | LOW | confirmed defect | Database initialization and migration runners are not serialized across backend replicas | P3-016 |
| MON-L03 | LOW | confirmed defect | Budget-alert deduplication is a check-then-insert race | P4-015 |
| MON-L04 | LOW | confirmed defect | Staged-file expiry can delete bytes required by a pending or running import job | P4-016 |
| MON-L05 | LOW | confirmed defect | Concurrent attachment uploads can exceed the per-transaction cap | P4-017 |
| MON-L06 | LOW | confirmed defect | Bill and mortgage reminder crons send duplicate email from every backend replica | P4-018 |
| MON-L07 | LOW | stale documentation | Test and CI documentation overstates enforcement without documenting zero-test and release-SHA gaps | P7-011 |

## 7. Canonical findings ordered by severity

### 7.1 HIGH findings

### MON-H01 - Automatic backups from different owners and instances share one filename and retention namespace

| Field | Value |
| --- | --- |
| Supporting phase IDs | P3-001; P2-001 superseded; P7-005 supporting wrong test |
| Classification | confirmed defect |
| Severity | HIGH |
| Confidence | high |
| Affected layers | backup scheduler -> local/S3 provider -> promotion -> retention -> deployment storage |
| Final verification status | Retained as HIGH after independent Phase 8 verification. |
| Deduplication / supersession | P3-001 is canonical and supersedes P2-001. Crash-atomic publication, arbitrary destination selection, and missing Helm persistence remain separate roots. |

**Evidence paths and relevant ranges**

- `backend/src/backup/auto-backup.service.ts:1-220,280-600`
- `backend/src/backup/auto-backup.service.spec.ts:430-780`
- docker-compose.prod.yml:1-240
- `helm/values.yaml:1-260`

**Violated invariant or expected behavior**

Each durable backup key and every retention decision must be isolated by deployment instance and owner. A backup job for one owner must never overwrite, promote, enumerate, or delete another owner's artifacts.

**Realistic reproduction scenario**

Configure two users on the default automatic-backup root and run same-date jobs. Both construct generic date/frequency names. The second write can replace the first; later daily/weekly/monthly promotion and retention enumerate the same namespace and can delete the other user's only recoverable copy. The same root applies when two Monize instances share a bucket or mounted directory.

**Impact**

Cross-tenant backup loss, replacement with another tenant's data, and retention-driven deletion of recoverable artifacts. The failure is destructive and can remain unnoticed until restore is needed.

**Recommended correction**

Namespace all keys by a stable instance identifier and owner identifier, then use run IDs and atomic publication. Retention must enumerate only that namespace. Add a migration/discovery plan for existing generic keys and reject ambiguous legacy artifacts instead of guessing ownership.

**Recommended regression test**

Run two users and two simulated instances against the same local directory and S3 prefix. Assert distinct temporary/final keys, independent promotion, and retention that cannot enumerate or delete outside the winning namespace. Correct the unit tests that currently expect generic keys.

**Verification method**

Phase 8 re-fetched the complete naming, promotion, provider, and retention paths plus the wrong unit expectations at ref=d5cea9bfa995885ba5198f9843359362927c0fd4.

### MON-H02 - Restore remaps local/S3 attachment metadata without copying or verifying the external bytes

| Field | Value |
| --- | --- |
| Supporting phase IDs | P3-002; P7-009 supporting missing test |
| Classification | confirmed defect |
| Severity | HIGH |
| Confidence | high |
| Affected layers | backup export -> UUID remap -> attachment metadata -> storage provider -> restore result |
| Final verification status | Retained as HIGH after independent Phase 8 verification. |
| Deduplication / supersession | Distinct from MON-M22, which covers ordinary attachment create/delete/cascade atomicity rather than backup restore remapping. |

**Evidence paths and relevant ranges**

- `backend/src/backup/backup.service.ts:300-760,820-2010`
- `backend/src/backup/backup-id-remap.util.ts:1-240`
- `backend/src/attachments/storage/local-storage.provider.ts:1-220`
- `backend/src/attachments/storage/s3-storage.provider.ts:1-240`
- `backend/src/attachments/storage/database-storage.provider.ts:1-200`

**Violated invariant or expected behavior**

A successful restore must make every restored attachment retrievable under its restored metadata, or explicitly report a partial restore and preserve a recoverable retry plan.

**Realistic reproduction scenario**

Export a database that uses the local or S3 provider, then restore it with ID remapping enabled. The generic deep remapper changes attachment IDs and matching storage_key UUIDs, but export contains bytes only for the database provider and restore does not copy local/S3 objects from old keys to new keys. Metadata commits with a key for which no restored object exists.

**Impact**

Receipts and documents become permanently inaccessible after a nominally successful destructive restore. Rollback cannot repair already-missing external objects, and the current result does not provide a provider-level recovery manifest.

**Recommended correction**

Package external bytes or an immutable object manifest in the backup; perform provider-specific copy/verify operations with checksums; retain old keys until the database transaction and external finalization are durable; return an explicit partial/failure state and compensation plan. Keep the database provider's existing transactional behavior as a positive control.

**Recommended regression test**

Create local, S3, and database-provider round trips with non-empty attachment bytes. Restore with remapped IDs, then load every attachment and compare checksums. Inject missing-object, partial-copy, and DB-rollback failures and assert accurate result/compensation state.

**Verification method**

Phase 8 re-fetched export/import/remap code and all three storage providers at the fixed SHA. No filesystem or S3 operation was executed.

### MON-H03 - Concurrent Microsoft Money import starts can create separate active jobs for one user

| Field | Value |
| --- | --- |
| Supporting phase IDs | P4-001; P1-001 superseded |
| Classification | confirmed defect |
| Severity | HIGH |
| Confidence | high |
| Affected layers | controller -> active-job query -> optional wipe -> job insert -> worker claim -> schema/test |
| Final verification status | Retained as HIGH after independent Phase 8 verification. |
| Deduplication / supersession | P4-001 supersedes P1-001. The same-row worker-claim positive control is retained and is not reported as defective. |

**Evidence paths and relevant ranges**

- `backend/src/import/mny/mny-import.controller.ts:140-210`
- `backend/src/import/mny/mny-import.service.ts:60-250`
- `backend/src/import/mny/mny-import-job.service.ts:60-370`
- `database/migrations/117_mny_import_staging_and_jobs.sql:1-140`
- `backend/test/integration/mny-import-job.integration.spec.ts:1-360`

**Violated invariant or expected behavior**

The documented one-active-import-per-user rule must be enforced by one database arbitration point, including wipe mode and multiple replicas.

**Realistic reproduction scenario**

Send two start requests before either inserts its pending row. Both observe no active job, both can wipe, and both insert independent pending rows. The conditional claim test protects two workers claiming one existing row; it does not prevent both newly created rows from being legitimately claimed and executed.

**Concrete numerical example**

Input: one source expense of `-100.00`.
Implementation result after two accepted jobs: two rows and a `-200.00` balance effect.
Expected: one row and `-100.00`.
Difference: `-100.00`.

**Impact**

Duplicate or destructively interleaved imports, duplicate reference and ledger data, incorrect balances, and a wipe from one request deleting data written by the other.

**Recommended correction**

Add a status CHECK and a partial unique index on user_id for pending/running states, then insert directly and map SQLSTATE 23505 to the existing conflict response. Acquire the per-user import slot before wipe and hold a durable maintenance lease through the destructive/import workflow.

**Recommended regression test**

Race complete start requests for the same file, different files, wipe mode, two users, and two worker instances under the unprivileged RLS role. Exactly one same-user start may create an active job; different users must remain independent.

**Verification method**

Phase 8 re-fetched controller, service, job state, migration, mapping, and the real-PostgreSQL claim test at the fixed SHA.

### MON-H04 - An import worker crash after the data commit can make retry replay the committed source

| Field | Value |
| --- | --- |
| Supporting phase IDs | P4-002 |
| Classification | confirmed defect |
| Severity | HIGH |
| Confidence | high |
| Affected layers | persistent job state -> import transaction -> post-processing -> staged bytes -> terminal status |
| Final verification status | Retained as HIGH after independent Phase 8 verification. |
| Deduplication / supersession | Separate from concurrent job creation: this root reproduces with one job and an operational failure after commit. |

**Evidence paths and relevant ranges**

- `backend/src/import/mny/mny-import.service.ts:196-330,370-570`
- `backend/src/import/mny/mny-import-job.service.ts:145-350`
- `backend/src/import/mny/mny-staging.service.ts:103-178`
- `backend/src/import/mny/map/map-transactions.ts:430-550`

**Violated invariant or expected behavior**

A retryable job must either be known not to have committed business data or replay against stable source-record idempotency keys.

**Realistic reproduction scenario**

Let writeAll commit, then terminate the worker before verification, staged-file removal, result assembly, or complete(). The job remains running or becomes retryable failed. Retrying reparses the same bytes and generates fresh transaction UUIDs, so the second run does not conflict with the first committed rows.

**Concrete numerical example**

Input: one source transaction of `-25.00`.
Implementation result after post-commit crash and retry: `-50.00`.
Expected: `-25.00`.
Difference: `-25.00`.

**Impact**

Ordinary process eviction or finalization failure can double core financial history. The inverse window can delete staged bytes while leaving a retryable state that can no longer be retried.

**Recommended correction**

Write a durable import-run/data_committed checkpoint in the same transaction as imported rows, or enforce deterministic source record keys. Add lease generation/CAS predicates for all state transitions and distinguish pre-commit, commit-unknown, finalization-pending, completed, and non-retryable states.

**Recommended regression test**

Add failpoints before commit, after commit, after verification, after byte deletion, and around complete(). Restart workers and assert exactly one source copy plus monotonic state and truthful retry availability.

**Verification method**

Phase 8 reconstructed the commit/finalization/state-machine ordering from SHA-pinned code; no process-kill test was run.

### MON-H05 - Transaction, transfer, reconciliation, and bulk mutations derive balance deltas from stale snapshots

| Field | Value |
| --- | --- |
| Supporting phase IDs | P4-003 |
| Classification | confirmed defect |
| Severity | HIGH |
| Confidence | high |
| Affected layers | API -> pre-transaction entity load -> write transaction -> ledger row -> account delta -> integration tests |
| Final verification status | Retained as HIGH after independent Phase 8 verification. |
| Deduplication / supersession | All stale pre-transaction delta variants are merged here; absolute recomputation is MON-H07 because it uses a different write protocol. |

**Evidence paths and relevant ranges**

- `backend/src/transactions/transactions.service.ts:1880-2310`
- `backend/src/transactions/transaction-transfer.service.ts:340-1235`
- `backend/src/transactions/transaction-reconciliation.service.ts:1-130`
- `backend/src/transactions/transaction-bulk-update.service.ts:100-700`
- `backend/src/accounts/accounts.service.ts:930-1085`
- `backend/test/integration/transactions.integration.spec.ts:1-700`

**Violated invariant or expected behavior**

A balance adjustment must be derived from the exact row version that the write successfully replaces or deletes.

**Realistic reproduction scenario**

Two requests load the same old amount before either write transaction. PostgreSQL serializes the physical row updates, but the second request still applies a delta calculated from its stale object. Deletes likewise reverse an amount before proving that the expected row/version was actually removed.

**Concrete numerical example**

Example A — concurrent updates:
- Opening balance: `100.00`; old transaction: `-10.00`; stored balance: `90.00`.
- Final ledger row: `-30.00`.
- Implementation result: `60.00`.
- Expected: `70.00`.
- Difference: `-10.00`.

Example B — double delete:
- Implementation result after two stale reversals: `110.00`.
- Expected after removing one `-10.00` row: `100.00`.
- Difference: `+10.00`.

**Impact**

Persistent divergence between ledger rows and accounts.current_balance across ordinary double-clicks, retries, two tabs, transfer edits, VOID changes, and bulk operations.

**Recommended correction**

Read and lock all affected ledger rows inside the write transaction, lock linked legs in deterministic order, and use version predicates or UPDATE/DELETE ... RETURNING. Apply balance deltas only from returned old/new versions and make status transitions compare-and-set operations.

**Recommended regression test**

Use two independent PostgreSQL connections and deterministic barriers for update/update, update/delete, delete/delete, VOID/unvoid, transfer, split, and bulk combinations. Recompute authoritative balances after every interleaving.

**Verification method**

Phase 8 re-fetched all primary mutation paths and the serial integration suite. The suite verifies sequential CRUD only and does not hold competing stale snapshots.

### MON-H06 - Scheduled posting has no durable occurrence identity and commits money before advancing the schedule

| Field | Value |
| --- | --- |
| Supporting phase IDs | P4-004 |
| Classification | confirmed defect |
| Severity | HIGH |
| Confidence | high |
| Affected layers | multi-replica cron/manual post -> transaction/transfer/investment creation -> schedule bookkeeping -> schema/tests |
| Final verification status | Retained as HIGH after independent Phase 8 verification. |
| Deduplication / supersession | Cron duplication is counted only where the missing occurrence key creates a concrete financial effect; generic every-replica scheduling is not itself a finding. |

**Evidence paths and relevant ranges**

- `backend/src/scheduled-transactions/scheduled-transactions.service.ts:120-310,1080-1435`
- `backend/src/scheduled-transactions/entities/scheduled-transaction.entity.ts:1-430`
- `database/schema.sql:380-525`
- `docs/cron-jobs.md:1-90`
- `backend/src/scheduled-transactions/scheduled-transactions.service.spec.ts:1-1100`

**Violated invariant or expected behavior**

One logical scheduled occurrence must produce at most one financial effect across replicas, manual posting, retries, and crashes.

**Realistic reproduction scenario**

Two replicas or a manual request and cron both select the same due row. Each commits a cash transaction, transfer pair, or investment effect before either separately advances or deletes the schedule. A crash in the same gap leaves the original due occurrence eligible for the next run.

**Concrete numerical example**

Input: balance `100.00`; one due expense `-50.00`.
Implementation result after two posters: `0.00`.
Expected after one occurrence: `50.00`.
Difference: `-50.00`.

**Impact**

Duplicate bills, deposits, transfers, investment trades, balances, and holdings in a supported multi-replica topology.

**Recommended correction**

Materialize and uniquely constrain an occurrence key such as (scheduled_transaction_id, original_due_date). Atomically claim it and commit occurrence, financial rows, balances/holdings, override consumption, and schedule advancement in one transaction or one resumable state machine.

**Recommended regression test**

Race two schedulers and manual-versus-cron for cash, transfer, investment, split, and ONCE schedules. Inject a crash after financial commit and assert one occurrence, one financial effect, and one advancement.

**Verification method**

Phase 8 re-fetched due selection, posting, schema, multi-replica documentation, and mocked tests at the fixed SHA.

### MON-H07 - Absolute balance recomputation can overwrite a concurrent committed atomic delta

| Field | Value |
| --- | --- |
| Supporting phase IDs | P4-005 |
| Classification | confirmed defect |
| Severity | HIGH |
| Confidence | high |
| Affected layers | ledger SUM snapshot -> absolute accounts.current_balance write -> concurrent incremental writer |
| Final verification status | Retained as HIGH after independent Phase 8 verification. |
| Deduplication / supersession | Distinct from stale delta derivation in MON-H05. |

**Evidence paths and relevant ranges**

- `backend/src/accounts/accounts.service.ts:930-1085,1560-1720`
- `backend/src/import/import-post-processing.service.ts:1-140`
- `backend/src/transactions/transactions.service.ts:315-490`

**Violated invariant or expected behavior**

Every writer of derived account balance must participate in one per-account serialization protocol.

**Realistic reproduction scenario**

A recomputation reads opening balance and ledger SUM. Before its absolute UPDATE, another request commits a ledger row and atomic balance delta. The recomputation then writes its older absolute value and erases the valid committed delta.

**Concrete numerical example**

Recompute snapshot: `100.00`; concurrent committed expense: `-20.00`.
Implementation result: recompute writes `100.00`.
Expected: `80.00`.
Difference: `+20.00`.

**Impact**

Broad silent balance divergence after import post-processing, future/due maintenance, manual rebuilds, and interactive activity.

**Recommended correction**

Use a shared account-row or advisory-lock protocol for both recomputations and incremental writers. Perform the ledger read and targeted absolute update under that lock; lock accounts in deterministic order for batches/transfers.

**Recommended regression test**

Barrier the recomputation SELECT and UPDATE against create, update, delete, VOID, import post-processing, due-balance cron, and transfers. Compare stored balances with a fresh authoritative SQL sum.

**Verification method**

Phase 8 re-fetched all principal absolute writers and confirmed no shared lock with incremental mutations.

### MON-H08 - Holding updates and full rebuilds can lose concurrent investment transactions

| Field | Value |
| --- | --- |
| Supporting phase IDs | P4-006 |
| Classification | confirmed defect |
| Severity | HIGH |
| Confidence | high |
| Affected layers | investment transaction -> holding read/compute/save -> rebuild snapshot/delete/recreate -> tests |
| Final verification status | Retained as HIGH after independent Phase 8 verification. |
| Deduplication / supersession | Serial holding arithmetic findings remain separate where applicable; this root is lost-update/rebuild serialization. |

**Evidence paths and relevant ranges**

- `backend/src/securities/holdings.service.ts:180-450,560-930`
- `backend/src/securities/investment-transactions.service.ts:860-1700`
- `backend/src/securities/entities/holding.entity.ts:1-150`
- `backend/src/securities/holdings.service.spec.ts:1-260`
- `backend/test/integration/investment-transactions.integration.spec.ts:1-900`

**Violated invariant or expected behavior**

For each account/security key, quantity and basis must equal deterministic replay of all committed investment transactions.

**Realistic reproduction scenario**

Two trades read the same holding, calculate new values in application memory, and later save. The second physical UPDATE can wait yet still write its stale calculation. Rebuild is more exposed: it reads account/transaction snapshots and later deletes/recreates holdings without sharing a lock with interactive trades.

**Concrete numerical example**

Starting holding: `10` shares at `$100.00` (`$1,000.00` basis).
Concurrent buys: `1` and `2` shares at `$100.00`.
Implementation result: `12` shares, `$1,200.00` basis.
Expected: `13` shares, `$1,300.00` basis.
Difference: `-1` share, `-$100.00`, `-7.69%` of expected quantity/basis.

**Impact**

Wrong shares, average cost, tax basis, performance, sell validation, and net worth while both source investment rows can remain committed.

**Recommended correction**

Lock the holding/account key before reading it, use conflict-safe upsert for absent rows, and make incremental operations and rebuilds share the same deterministic lock namespace. Run rebuild reads and replacement in one serialized transaction or versioned checkpoint.

**Recommended regression test**

Race buy/buy, buy/sell, buy/split, transfer-in/out, historical edit/delete, and rebuild/trade with two connections. Replay the ledger to assert quantity and basis, and verify cash separately.

**Verification method**

Phase 8 re-fetched incremental and rebuild protocols plus the accessible mocked/serial tests at the baseline SHA.

### MON-H09 - One emergency-access claim token can be consumed successfully by two concurrent requests

| Field | Value |
| --- | --- |
| Supporting phase IDs | P4-007 |
| Classification | confirmed defect |
| Severity | HIGH |
| Confidence | high |
| Affected layers | unauthenticated claim -> token validation -> credential transaction -> session revocation/issuance -> tests |
| Final verification status | Retained as HIGH after independent Phase 8 verification. |
| Deduplication / supersession | Distinct from emergency grant-email races and from general step-up weaknesses. |

**Evidence paths and relevant ranges**

- `backend/src/emergency-access/emergency-access-claim.controller.ts:150-370`
- `backend/src/emergency-access/entities/emergency-access-contact.entity.ts:1-240`
- `backend/src/auth/token.service.ts:100-275`
- `backend/src/emergency-access/emergency-access-claim.controller.spec.ts:1-260`

**Violated invariant or expected behavior**

A recovery link is a single-use credential: exactly one transaction may consume it and replace credentials/session state.

**Realistic reproduction scenario**

Two requests validate the same unused token and enter independent transactions. The second query has neither FOR UPDATE nor a conditional claim_token_used_at IS NULL consume. Both can update the owner password, mark the contact used, revoke sessions, and issue a token pair.

**Impact**

Account-takeover race, nondeterministic final password, two successful claim responses, and conflicting post-claim refresh families.

**Recommended correction**

Atomically consume by UPDATE ... WHERE token_hash=? AND used_at IS NULL AND expires_at>=now RETURNING owner_user_id, then permit only the winner to mutate credentials and establish one new session family. Alternatively lock and revalidate under FOR UPDATE.

**Recommended regression test**

Use two independent transactions and different proposed passwords. Assert exactly one success, one durable password, one active refresh family, and a stable used/invalid response for the loser.

**Verification method**

Phase 8 re-fetched the complete claim transaction, token lifecycle, entity, and unit-test boundary. No two-connection execution occurred.

### MON-H10 - Transfer VOID transitions can leave the two legs and both balances inconsistent

| Field | Value |
| --- | --- |
| Supporting phase IDs | P5-001; P6-001 supporting frontend path |
| Classification | confirmed defect |
| Severity | HIGH |
| Confidence | high |
| Affected layers | frontend selection/form -> DTO -> ordinary/bulk status update -> linked legs -> account balances/snapshots |
| Final verification status | Retained as HIGH after independent Phase 8 verification. |
| Deduplication / supersession | P6-001 is merged into P5-001 as one cross-layer root. |

**Evidence paths and relevant ranges**

- `backend/src/transactions/transaction-transfer.service.ts:680-930`
- `backend/src/transactions/transaction-bulk-update.service.ts:400-700`
- `backend/src/transactions/transaction-reconciliation.service.ts:1-130`
- `frontend/src/components/transactions/BulkUpdateModal.tsx:35-220`
- `frontend/src/hooks/useTransactionSelection.ts:1-210`
- `frontend/src/components/transactions/TransactionForm.tsx:900-1060`

**Violated invariant or expected behavior**

The two legs of a transfer must remain equivalent in status and must enter or leave balances exactly once as one atomic operation.

**Realistic reproduction scenario**

An ordinary transfer edit can set both leg statuses to VOID without applying the corresponding reversals because the balance-adjustment branch is tied to amount/account/date changes. Bulk update operates on selected IDs and can VOID only one linked leg. Downstream snapshots and reports then observe either active money with VOID rows or one-sided money creation/removal.

**Concrete numerical example**

Initial balances: source `1,000.00`, destination `1,000.00`.
Active transfer: `100.00` -> balances `900.00` and `1,100.00`.
Implementation result after marking both legs VOID without deltas: still `900.00` and `1,100.00`.
Expected: `1,000.00` and `1,000.00`.
Differences: source `-100.00`; destination `+100.00`.

**Impact**

Direct corruption of two account balances and transfer history; reports, net worth, reconciliation, and cached registers can disagree.

**Recommended correction**

Route all transfer status changes through one pair-aware service. Lock both legs/accounts in deterministic order, compare-and-set the prior statuses, update both rows and both balance deltas atomically, and make bulk selection expand/validate linked pairs.

**Recommended regression test**

Cover create-as-VOID, active-to-VOID, VOID-to-active, selecting one leg in bulk, linked split transfers, rollback, snapshots, reports, and cache invalidation with real PostgreSQL integration and browser tests.

**Verification method**

Phase 8 re-fetched ordinary, bulk, frontend selection, and form paths at the fixed SHA and merged backend/frontend evidence.

### MON-H11 - Transfer currencies, FX rate, and destination value are not server-authoritative

| Field | Value |
| --- | --- |
| Supporting phase IDs | P5-002; P6-002 supporting frontend path |
| Classification | confirmed defect |
| Severity | HIGH |
| Confidence | high |
| Affected layers | frontend form -> transfer DTO -> account lookup -> direct/scheduled/split transfer -> ledger/balance -> tests |
| Final verification status | Retained as HIGH after independent Phase 8 verification. |
| Deduplication / supersession | P6-002 is merged into P5-002. Missing FX represented as 1:1 is MON-H12 because it affects broader valuation contracts. |

**Evidence paths and relevant ranges**

- `backend/src/transactions/dto/create-transfer.dto.ts:1-180`
- `backend/src/transactions/transaction-transfer.service.ts:90-285`
- `backend/src/transactions/transaction-split.service.ts:180-480`
- `backend/src/scheduled-transactions/scheduled-transactions.service.ts:1080-1435`
- `frontend/src/components/transactions/TransactionForm.tsx:300-620`
- `backend/test/integration/transfers.integration.spec.ts:1-760`

**Violated invariant or expected behavior**

The server must derive source/destination currencies from owned accounts and derive or validate the destination amount from one documented rate direction and fee model.

**Realistic reproduction scenario**

A caller supplies account IDs together with arbitrary currency codes, exchangeRate, or toAmount. The service loads the accounts but trusts the supplied financial fields. Scheduled transfer omits an authoritative cross-currency derivation, and transfer splits construct the counterpart with exchangeRate 1. A tampered client can therefore create a destination leg unrelated to the source value.

**Concrete numerical example**

Source: `100.00`; authoritative rate: `1.3500` destination units per source unit.
Expected destination: `135.00`.
Tampered client destination accepted by the current contract: `999.99`.
Difference: `+864.99` destination-currency units.

**Impact**

Arbitrary transfer value creation/destruction, incorrect balances, and inconsistent direct, scheduled, and split semantics.

**Recommended correction**

Ignore client currency codes, derive them from accounts, resolve a dated rate server-side, compute the destination amount with documented rounding/fees, and either reject or reconcile any client preview outside a strict tolerance. Reuse one transfer engine for direct, scheduled, and split paths.

**Recommended regression test**

Test USD->CAD and CAD->USD, direct/inverse rates, stale/missing rates, tampered toAmount/rate/currency, scheduled posting, transfer splits, fees, and account changes after form entry. The accessible current integration test must stop treating a supplied rate as authoritative proof.

**Verification method**

Phase 8 re-fetched DTO, service, scheduled/split paths, frontend serialization, and integration coverage at the fixed SHA.

### MON-H12 - Unavailable foreign exchange is converted as a valid-looking 1:1 value

| Field | Value |
| --- | --- |
| Supporting phase IDs | P5-009; P6-006 supporting frontend path; P7-001 wrong tests |
| Classification | confirmed defect |
| Severity | HIGH |
| Confidence | high |
| Affected layers | rate lookup -> conversion helper -> portfolio aggregation -> frontend display -> tests |
| Final verification status | Retained as HIGH after independent Phase 8 verification. |
| Deduplication / supersession | P5-009 and P6-006 are one root. P7-001 remains a separate verification finding because it actively protects the bad contract. |

**Evidence paths and relevant ranges**

- `frontend/src/hooks/useExchangeRates.ts:1-260`
- `frontend/src/hooks/useExchangeRates.test.ts:80-205`
- `backend/src/securities/portfolio.service.ts:340-760`
- `backend/src/securities/portfolio-calculation.service.ts:1-420`
- `backend/src/securities/portfolio.service.spec.ts:730-890`

**Violated invariant or expected behavior**

A missing direct and inverse FX rate must remain distinguishable from a valid same-currency rate of 1.0000; incomplete aggregates must expose their missing pairs.

**Realistic reproduction scenario**

When neither rate direction exists, the frontend returns the original number and the backend inserts rate 1 into portfolio conversion. Both existing tests explicitly expect this. Downstream totals label an unconverted source amount in the destination currency and present it as complete.

**Concrete numerical example**

Input: `100.00 USD`; destination `CAD`; rate unavailable.
Implementation result: a complete-looking `100.00 CAD` (or equivalent total using rate 1).
Expected at the time of calculation: unavailable/partial, not a number.
At a later valid rate of `1.3500`, the correct amount would be `135.00 CAD`.
Difference from the false numeric result: `-35.00 CAD` (`-25.93%` of the correct value).

**Impact**

False net worth and allocation totals without any warning, potentially across every foreign holding or account whose rate is unavailable.

**Recommended correction**

Return a typed conversion result with ok/unavailable status, rate, source, and as-of date. Preserve same-currency 1.0000 only as explicit success. Propagate missing pairs and completeness to every aggregate and UI.

**Recommended regression test**

Correct both known wrong tests; add direct, inverse, same-currency, missing, stale, zero, and partial-aggregate matrices across backend/frontend plus E2E display of incomplete totals.

**Verification method**

Phase 8 re-fetched conversion implementations and both wrong tests from the baseline.

### MON-H13 - Historical net-worth replay adds a stock-split ratio instead of multiplying shares

| Field | Value |
| --- | --- |
| Supporting phase IDs | P5-011; P7-003 supporting wrong test |
| Classification | confirmed defect |
| Severity | HIGH |
| Confidence | high |
| Affected layers | investment ledger -> historical reducer -> price valuation -> chart -> wrong unit test |
| Final verification status | Retained as HIGH after independent Phase 8 verification. |
| Deduplication / supersession | Current holdings split handling is a positive control; only historical replay is defective. P7-003 is counted separately as a verification defect. |

**Evidence paths and relevant ranges**

- `backend/src/net-worth/net-worth.service.ts:600-1150`
- `backend/src/net-worth/net-worth.service.spec.ts:280-580`
- `backend/src/securities/holdings.service.ts:180-450`

**Violated invariant or expected behavior**

A split transaction stores a ratio; historical quantity must be multiplied by that ratio, including reverse splits, while basis is preserved according to the same action contract as current holdings.

**Realistic reproduction scenario**

The current holding path multiplies quantity, but historical replay treats the persisted ratio as an additive share count. The unit fixture encodes 90 as the split quantity on a 90-share holding, making the wrong addition accidentally produce the expected 180 and allowing the suite to remain green.

**Concrete numerical example**

Starting shares: `90`; split ratio: `2.0`.
Implementation result: `92` shares.
Expected: `180` shares.
Difference: `-88` shares (`-48.89%`).

**Impact**

Materially false historical share counts, net worth, performance, and charts after splits; reverse splits are even more distorted.

**Recommended correction**

Centralize investment action replay and use it for current and historical holdings. Represent split ratio explicitly, multiply quantity, preserve basis, and reject legacy additive fixtures or migrate them deliberately.

**Recommended regression test**

Replace the wrong fixture with ratios 2.0, 0.5, and 3-for-2; assert shares, total basis, basis/share, and historical valuation before/after the action.

**Verification method**

Phase 8 re-fetched both replay implementations and the test fixture at the fixed SHA.

### MON-H14 - Investment preview and commit can use different exchange rates without disclosure

| Field | Value |
| --- | --- |
| Supporting phase IDs | P6-003 |
| Classification | confirmed defect |
| Severity | HIGH |
| Confidence | high |
| Affected layers | form initialization -> rate hook -> preview -> request omission -> backend historical/latest rate -> committed cash leg |
| Final verification status | Retained as HIGH after independent Phase 8 verification. |
| Deduplication / supersession | Separate from accepting non-positive explicit rates (MON-M29) and from general missing-FX totals (MON-H12). |

**Evidence paths and relevant ranges**

- `frontend/src/components/investments/InvestmentTransactionForm.tsx:1-900`
- `backend/src/securities/investment-transactions.service.ts:320-760`

**Violated invariant or expected behavior**

The monetary preview shown immediately before submission must use the exact rate, date, source, and rounding that the backend will commit, or block submission until that value is known.

**Realistic reproduction scenario**

When no frontend rate is available, preview arithmetic uses rate || 1, while the request omits exchangeRate. The backend then resolves a valid historical or latest rate and posts a different cash amount. The user approves one number and receives another without an explicit reconciliation step.

**Concrete numerical example**

Trade source value: `1,000.00 USD`; frontend has no rate and previews `1,000.00 CAD` using 1:1.
Backend resolves `1.3500` and commits `1,350.00 CAD`.
Difference between approved preview and committed cash effect: `+350.00 CAD` (`+35.00%` of the preview).

**Impact**

Unexpected cash debits/credits and funding-account balances, especially for back-dated trades and volatile currency pairs.

**Recommended correction**

Add a server quote/preview endpoint or return a signed quote token containing rate/as-of/source/rounding. Submit that quote or require an explicit server-confirmed value; never preview missing FX at 1.

**Recommended regression test**

Exercise missing, stale, inverse, zero, negative, historical, and latest rates. Assert preview amount, submitted quote, committed investment.exchangeRate, linked cash amount, and UI confirmation are identical.

**Verification method**

Phase 8 re-fetched the form and backend resolution path at the fixed SHA.

### MON-H15 - Opening an existing scheduled investment override can replace its stored price with the latest quote

| Field | Value |
| --- | --- |
| Supporting phase IDs | P6-005; P7-002 supporting wrong test |
| Classification | confirmed defect |
| Severity | HIGH |
| Confidence | high |
| Affected layers | existing override -> form initialization -> asynchronous quote fetch -> state mutation -> save payload -> wrong test |
| Final verification status | Retained as HIGH after independent Phase 8 verification. |
| Deduplication / supersession | P7-002 is a separate verification defect; this is the production root. |

**Evidence paths and relevant ranges**

- `frontend/src/components/scheduled-transactions/OverrideEditorDialog.tsx:1-400`
- `frontend/src/components/scheduled-transactions/OverrideEditorDialog.test.tsx:450-710`

**Violated invariant or expected behavior**

Opening or editing unrelated fields must preserve the stored override price unless the user explicitly chooses to refresh or edit it.

**Realistic reproduction scenario**

The dialog initializes the saved override, then an asynchronous latest-price response unconditionally writes investmentPrice. Saving a date or description therefore persists the quote as a new override price. The current test explicitly expects this replacement.

**Concrete numerical example**

Stored override price: `250.00`; latest quote: `123.45`.
User edits only description/date.
Implementation result saved: `123.45`.
Expected: `250.00`.
Difference: `-126.55` per share (`-50.62%`).

**Impact**

Silent mutation of future trade price, total, cash movement, quantity, and projections merely by opening and saving the dialog.

**Recommended correction**

Track field provenance/dirty state. Populate a market quote only for an empty new override or behind an explicit Use latest quote action. Save only changed fields or rebase against the original override with versioning.

**Recommended regression test**

Open an override with a stored price, deliver a delayed quote, edit only description/date, and assert the original price remains. Add explicit-refresh, stale response, close/reopen, and optimistic concurrency tests.

**Verification method**

Phase 8 re-fetched component state effects, save payload, and the wrong test expectation.

### MON-H16 - Partial or unavailable portfolio valuations are rendered as complete ordinary totals

| Field | Value |
| --- | --- |
| Supporting phase IDs | P6-007 |
| Classification | confirmed defect |
| Severity | HIGH |
| Confidence | high |
| Affected layers | per-holding valuation -> aggregate response -> failed request/null coercion -> account and summary UI |
| Final verification status | Retained as HIGH after independent Phase 8 verification. |
| Deduplication / supersession | Kept separate from MON-H12 because missing-price and full-request failures remain defective even when every FX rate exists. |

**Evidence paths and relevant ranges**

- `backend/src/securities/portfolio-calculation.service.ts:1020-1325`
- `frontend/src/app/accounts/page.tsx:35-180`
- `frontend/src/components/investments/PortfolioSummaryCard.tsx:40-290`
- `frontend/src/types/investment.ts:1-340`

**Violated invariant or expected behavior**

Portfolio totals must carry completeness/error metadata; missing prices or a failed portfolio request must never be indistinguishable from an actual zero or a complete subtotal.

**Realistic reproduction scenario**

Backend holding rows can have null values while aggregate totals sum only priced rows. At the frontend, a failed portfolio request yields null and brokerage values default to zero, while summary cards expose only numeric totals with no partial state. The user sees an ordinary complete number.

**Concrete numerical example**

Example A — request failure:
- Cash: `20,000.00`; brokerage market value: `100,000.00`.
- Implementation display after portfolio request failure: `20,000.00`.
- Expected: unavailable/partial (complete value would be `120,000.00`).
- Numeric omission: `-100,000.00` (`-83.33%`).

Example B — one unpriced holding:
- Priced holdings: `100,000.00`; omitted holding if priced: `50,000.00`.
- Implementation total: `100,000.00` shown as complete.
- Complete value: `150,000.00`.
- Difference: `-50,000.00` (`-33.33%`).

**Impact**

Allocation, net-worth, risk, and withdrawal decisions can be based on a total that silently omits entire securities or accounts.

**Recommended correction**

Return valued/unvalued counts, missing security/rate reasons, as-of provenance, and total status complete/partial/unavailable. Keep failures separate from zero. Require UI badges, omitted-value disclosure, and no complete-looking currency total when status is not complete.

**Recommended regression test**

Test one missing price, several missing prices, provider failure, whole-request failure, genuine zero portfolio, stale prior result, and missing FX. Assert status and user-visible disclosure across accounts and summary screens.

**Verification method**

Phase 8 re-fetched backend aggregation, frontend failure/default behavior, display component, and handwritten type contract.

### 7.2 MEDIUM findings

### MON-M01 - Deployment documentation and documented defaults do not match the inspected Compose and Helm manifests

| Field | Value |
| --- | --- |
| Supporting phase IDs | P1-002 |
| Classification | stale documentation |
| Severity | MEDIUM |
| Confidence | high |
| Affected layers | operator documentation -> configuration -> storage/network/process topology |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | Backup-specific persistence and namespace defects are counted separately as MON-H01 and MON-M11. |

**Evidence paths and relevant ranges**

- README.md:1-260
- docker-compose.prod.yml:1-240
- `helm/README.md:1-320`
- `helm/values.yaml:1-300`
- `helm/templates/statefulset-backend.yaml:1-220`

**Violated invariant or expected behavior**

Installation guidance must describe the behavior and persistence actually created by the maintained manifests.

**Realistic reproduction scenario**

An operator follows the documented deployment expectations but receives different mounts, paths, defaults, or process behavior from Compose/Helm, including backup persistence assumptions refined by later phases.

**Impact**

Misconfigured production deployments, unavailable features, or false durability expectations.

**Recommended correction**

Generate deployment-reference tables from manifest defaults, mark topology-specific differences, and add smoke checks that compare documented paths/ports/volumes with rendered manifests.

**Recommended regression test**

Render default Compose/Helm configurations and assert documented values, writable paths, health checks, and persistence across pod/container replacement.

**Verification method**

Accepted Phase 1 finding, strengthened by Phase 3 deployment evidence; static source comparison only.

### MON-M02 - Official contributor guidance recommends database transaction APIs prohibited by the scoped repository instructions

| Field | Value |
| --- | --- |
| Supporting phase IDs | P1-003 |
| Classification | stale documentation |
| Severity | MEDIUM |
| Confidence | high |
| Affected layers | repository instruction hierarchy -> contributor workflow -> backend transaction/RLS code |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | Instruction drift only; no duplicate authorization finding is claimed. |

**Evidence paths and relevant ranges**

- CLAUDE.md:1-280
- `backend/CLAUDE.md:1-260`
- CONTRIBUTING.md:1-340
- `.claude/skills/backend.md:1-260`

**Violated invariant or expected behavior**

Contributor guidance must not direct changes around the mandatory withScopedDb/RLS transaction model.

**Realistic reproduction scenario**

A contributor follows older direct repository or QueryRunner examples from CONTRIBUTING or auxiliary skills, bypassing the identity GUC and ambient-manager conventions required by the nearer CLAUDE files.

**Impact**

New code can accidentally escape tenant context, split transactions, or regress rollback behavior even though the current production tree did not expose a confirmed active manual-QueryRunner path.

**Recommended correction**

Delete or clearly supersede stale examples, link every contributor path to the scoped transaction rules, and enforce prohibited APIs with lint/static checks.

**Recommended regression test**

Add a documentation/lint fixture containing the prohibited pattern and require CI to fail; keep one approved migration-only exception list.

**Verification method**

Accepted Phase 1 documentation finding; later phases preserved the precedence and rejected the claim that current production code broadly uses manual QueryRunner.

### MON-M03 - Delegated /users/me responses expose fields outside the intended delegated profile

| Field | Value |
| --- | --- |
| Supporting phase IDs | P2-003 |
| Classification | confirmed defect |
| Severity | MEDIUM |
| Confidence | high |
| Affected layers | delegated JWT/context -> users/me service -> response DTO -> frontend identity cache |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | Distinct from delegation write failures and activity attribution. |

**Evidence paths and relevant ranges**

- `backend/src/users/users.controller.ts:31-50`
- `backend/src/users/users.service.ts:45-85`
- `backend/src/users/entities/user.entity.ts:1-260`
- `backend/src/auth/jwt.strategy.ts:120-260`

**Violated invariant or expected behavior**

A delegate should receive only the allowlisted profile fields needed to act for the owner, not the owner's full self-profile or security-sensitive settings.

**Realistic reproduction scenario**

Enter delegated mode and request /users/me. The endpoint resolves the effective owner identity and returns fields omitted from the intended delegated contract; frontend caching can retain them until context reset.

**Impact**

Constrained disclosure of owner profile/security metadata to an authorized financial delegate whose permission does not imply full account administration.

**Recommended correction**

Introduce an explicit delegated-profile DTO/serializer keyed by real versus effective user, deny sensitive fields by default, and clear identity/query caches on every delegation transition.

**Recommended regression test**

HTTP integration and browser tests must assert an exact field allowlist for owner, delegate, and post-switch contexts, including cache clearing.

**Verification method**

Accepted Phase 2 cross-layer static trace; no HTTP request was executed.

### MON-M04 - MCP sessions keep the scopes from session creation after the bearer token is revalidated

| Field | Value |
| --- | --- |
| Supporting phase IDs | P2-004 |
| Classification | confirmed defect |
| Severity | MEDIUM |
| Confidence | high |
| Affected layers | MCP bearer validation -> session cache -> current token identity check -> cached scope authorization -> tool handler |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | P2-004 canonical root. Distinct from the PAT advertised-scope documentation mismatch MON-L01. |

**Evidence paths and relevant ranges**

- `backend/src/mcp/mcp-http.controller.ts:45-230`
- `backend/src/mcp/mcp-http.controller.ts:230-360`
- `backend/src/mcp/mcp-context.ts:1-180`
- `backend/src/mcp/CLAUDE.md:1-80`

**Violated invariant or expected behavior**

Every MCP request must authorize from the scopes on the currently validated bearer token, not from scopes cached when the session was created.

**Realistic reproduction scenario**

Create an MCP session with write scope, then present a valid read-only token for the same user while retaining the session ID. The controller revalidates the token and checks only that the user ID matches; the server's scope resolver continues to read the scope string stored in sessionUsers at creation.

**Impact**

A token that has been downgraded or replaced can continue invoking write-scoped MCP tools for up to the one-hour session lifetime.

**Recommended correction**

Refresh the session context from every successful token validation, or bind the session to a token identifier/generation and destroy it on token revocation, replacement, or scope change.

**Recommended regression test**

MCP transport integration tests should create a write session, rotate or downgrade the token to read-only for the same user, and prove write tools fail over POST and GET session flows while read tools remain authorized.

**Verification method**

Phase 8 re-fetched the MCP controller and context at the fixed SHA. Session scopes are written only at creation, while later requests compare user ID and route through the cached resolver. No MCP client was run.

### MON-M05 - OIDC destructive-action confirmation accepts an arbitrary non-empty value instead of verified reauthentication

| Field | Value |
| --- | --- |
| Supporting phase IDs | P2-005; P3-009 and P6-009 supporting evidence |
| Classification | confirmed defect |
| Severity | MEDIUM |
| Confidence | high |
| Affected layers | destructive UI -> confirmation header/token -> controller/guard -> restore/account deletion |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | P3-009 and P6-009 are merged here; backup decryption credentials remain a separate control. |

**Evidence paths and relevant ranges**

- `backend/src/users/users.service.ts:330-430`
- `backend/src/users/dto/delete-account.dto.ts:1-100`
- `backend/src/backup/backup.controller.ts:220-390`
- `frontend/src/components/settings/DataManagement.tsx:350-760`
- `frontend/src/lib/backup.ts:1-260`

**Violated invariant or expected behavior**

A destructive action described as password or identity-provider reauthentication must cryptographically prove a recent, purpose-bound assertion from that provider.

**Realistic reproduction scenario**

For an OIDC-authenticated account, submit any non-empty confirmation value to a destructive restore or account-deletion flow whose backend branch tests presence rather than verifying a provider assertion. The UI wording implies stronger authentication than the server performs.

**Impact**

A stolen active session can perform irreversible operations that the user and operator expect to require fresh identity proof.

**Recommended correction**

Use the existing signed purpose-bound step-up token flow after an actual OIDC prompt/login interaction, bind it to subject, purpose, nonce, and short expiry, and consume/replay-protect it.

**Recommended regression test**

End-to-end tests with a local OIDC provider must reject arbitrary strings, wrong subject/purpose, stale/replayed assertions, and prove the destructive endpoint only runs after real reauthentication.

**Verification method**

Accepted Phase 2 root, independently confirmed for restore in Phase 3 and false frontend wording in Phase 6.

### MON-M06 - Delegation create, link, and revoke paths conflict with enforced RLS ownership semantics

| Field | Value |
| --- | --- |
| Supporting phase IDs | P2-007 |
| Classification | confirmed defect |
| Severity | MEDIUM |
| Confidence | high |
| Affected layers | delegation API -> scoped identity -> invitation/link rows -> RLS policies -> transaction rollback |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | Unsafe runtime-role acceptance is MON-M14; this root remains even when the runtime role is correctly unprivileged. |

**Evidence paths and relevant ranges**

- `backend/src/delegation/delegation.service.ts:520-940`
- `backend/src/delegation/delegation.service.ts:940-1120`
- `database/migrations/112_rls_policies_direct.sql:1-320`
- `database/migrations/114_rls_policies_special.sql:1-300`
- `backend/test/integration/rls-enforcement.integration.spec.ts:1-1200`

**Violated invariant or expected behavior**

Owner-initiated delegation lifecycle operations must remain writable under the unprivileged enforced-RLS role while never exposing another owner's rows.

**Realistic reproduction scenario**

Run create/link/revoke under the application role with RLS enforcement. The service's effective/real identity and policy predicates do not align for all lifecycle writes, so a supported operation can be rejected or partially fail despite passing service authorization.

**Impact**

Delegates cannot reliably be invited, linked, or revoked in the secure deployment mode; operators may be tempted to weaken role enforcement to restore functionality.

**Recommended correction**

Define explicit policy predicates for owner, invitee, and real actor; execute each lifecycle transition in one scoped transaction; avoid owner-role bypass as an operational workaround.

**Recommended regression test**

Real-PostgreSQL integration tests under the unprivileged role must cover owner A, user B, delegate D, invite acceptance, link, revoke, rollback, and negative cross-owner cases.

**Verification method**

Accepted Phase 2 static RLS/service analysis; exact production role catalogs were inaccessible.

### MON-M07 - Delegated activity is attributed to the effective owner rather than the real actor

| Field | Value |
| --- | --- |
| Supporting phase IDs | P2-008 |
| Classification | confirmed defect |
| Severity | MEDIUM |
| Confidence | high |
| Affected layers | authenticated real user -> delegated effective user -> activity update/audit metadata |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | Distinct from delegated profile disclosure and write-policy failures. |

**Evidence paths and relevant ranges**

- `backend/src/common/interceptors/request-context.interceptor.ts:55-145`
- `backend/src/auth/jwt.strategy.ts:120-260`
- `backend/src/emergency-access/emergency-access-monitor.service.ts:60-250`
- `database/migrations/076_users_last_activity_at.sql:1-40`

**Violated invariant or expected behavior**

Security-relevant activity and last-active timestamps must identify the human/session that acted, while separately recording the account on whose behalf the action occurred.

**Realistic reproduction scenario**

A delegate operates in the owner's context. The activity update uses the effective owner ID, advancing the owner's timestamp while the real delegate's activity remains unrecorded.

**Impact**

Misleading inactivity, emergency-access timing, audit history, and incident reconstruction; an owner can appear active because a delegate acted.

**Recommended correction**

Persist real_actor_user_id and effective_owner_user_id separately and define which timestamp drives emergency access, session security, and user presence. Never infer actor from effective tenant context.

**Recommended regression test**

Run owner and delegated requests and assert actor/effective IDs and timestamps independently, including emergency-access inactivity calculations.

**Verification method**

Accepted Phase 2 context-flow analysis; no runtime request was executed.

### MON-M08 - Restore ordering can deterministically fail linked asset/loan account relationships

| Field | Value |
| --- | --- |
| Supporting phase IDs | P3-003 |
| Classification | confirmed defect |
| Severity | MEDIUM |
| Confidence | high |
| Affected layers | backup row ordering -> UUID remap -> account insert -> reciprocal linked-account constraints |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | External attachment restore is MON-H02; this is an internal relational ordering root. |

**Evidence paths and relevant ranges**

- `backend/src/backup/backup.service.ts:1180-1900`
- `backend/src/accounts/entities/account.entity.ts:1-420`
- `database/schema.sql:180-300`

**Violated invariant or expected behavior**

Restore must either insert mutually linked account graphs in a constraint-safe order or defer/patch links after all vertices exist.

**Realistic reproduction scenario**

Restore a backup containing the supported asset/loan linked pair in the order produced by export. One row references a remapped counterpart not yet inserted, causing the transaction to fail deterministically.

**Impact**

A valid backup cannot be restored; because restore is destructive, the user experiences an outage until rollback/retry, even though database rollback prevents partial relational commit.

**Recommended correction**

Insert accounts with nullable links first, then update remapped reciprocal links after all rows exist, or use safely deferred constraints and validate graph closure before deletion.

**Recommended regression test**

Round-trip asset/loan and mortgage-linked graphs in both row orders, with missing/one-way links and rollback assertions.

**Verification method**

Accepted Phase 3 schema/restore-order analysis; restore was not executed.

### MON-M09 - Automatic-backup artifacts are published through non-crash-atomic final-file operations

| Field | Value |
| --- | --- |
| Supporting phase IDs | P3-004 |
| Classification | confirmed defect |
| Severity | MEDIUM |
| Confidence | high |
| Affected layers | export buffer -> filesystem/object write -> promotion/copy -> status/retention |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | Namespace collision is MON-H01; this root reproduces for one user and one process. |

**Evidence paths and relevant ranges**

- `backend/src/backup/auto-backup.service.ts:280-600`
- `backend/src/backup/backup.service.ts:1-420`

**Violated invariant or expected behavior**

A filename presented as a completed backup must become visible only after a fully written, flushed, verified artifact is atomically published.

**Realistic reproduction scenario**

Terminate the process during direct write/copy or between write and status update. A partial or stale final-name artifact can remain indistinguishable from a valid backup; promotion/retention may then act on it.

**Impact**

Restore can consume truncated/corrupt data, or a valid prior artifact can be replaced before the new one is durable.

**Recommended correction**

Write to unique temporary keys, fsync/verify checksum and size, atomically rename or server-side promote, then commit a manifest/status. Clean abandoned temporary objects by run ID.

**Recommended regression test**

Inject failures at chunk writes, fsync/upload completion, rename/copy, manifest write, and status update for local and S3 providers; never expose a valid final key before verification.

**Verification method**

Accepted Phase 3 failure-order analysis; no power-loss/filesystem test was executed.

### MON-M10 - Authenticated users can browse and select arbitrary server filesystem backup paths

| Field | Value |
| --- | --- |
| Supporting phase IDs | P3-005; P2-002 superseded |
| Classification | confirmed defect |
| Severity | MEDIUM |
| Confidence | high |
| Affected layers | authenticated backup API -> path normalization/browsing -> host/container filesystem permissions |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | Local attachment provider traversal guards were separately reviewed and are not implicated. |

**Evidence paths and relevant ranges**

- `backend/src/backup/backup.controller.ts:1-420`
- `backend/src/backup/auto-backup.service.ts:1-220`
- docker-compose.prod.yml:1-240

**Violated invariant or expected behavior**

Normal users must select only administrator-configured backup roots or opaque storage locations, never arbitrary server paths.

**Realistic reproduction scenario**

Call the folder-browsing/configuration endpoints with absolute paths or symlinked locations reachable by the backend process. The path is normalized but is not constrained to a realpath-checked allowlist root.

**Impact**

Filesystem disclosure and writes within container permissions; in shared/self-hosted deployments one user can target operational paths outside the intended backup volume.

**Recommended correction**

Replace raw paths with administrator-defined storage IDs, resolve real paths, reject symlink escapes, and reserve provider/root configuration for administrators or instance configuration.

**Recommended regression test**

Endpoint tests should cover absolute paths, .., symlink swaps, mount boundaries, permission errors, and a normal user's inability to enumerate outside the configured root.

**Verification method**

Accepted Phase 3 strengthening of P2-002; no container filesystem was accessed.

### MON-M11 - The default Helm deployment exposes automatic backup behavior without a writable persistent backup mount

| Field | Value |
| --- | --- |
| Supporting phase IDs | P3-006 |
| Classification | confirmed defect |
| Severity | MEDIUM |
| Confidence | high |
| Affected layers | Helm defaults -> backend filesystem -> backup feature -> pod lifecycle |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | Documentation mismatch is MON-M01; cross-owner filename collision is MON-H01. |

**Evidence paths and relevant ranges**

- `helm/values.yaml:1-300`
- `helm/templates/statefulset-backend.yaml:1-220`
- `helm/README.md:1-320`
- `backend/src/backup/auto-backup.service.ts:1-220`

**Violated invariant or expected behavior**

A supported default deployment must either provision durable writable storage for an enabled feature or fail closed with explicit configuration requirements.

**Realistic reproduction scenario**

Install the chart with default values and configure local automatic backup. The backend path is absent, read-only, or ephemeral in the pod because the chart does not mount the documented backup volume.

**Impact**

Backup jobs fail or artifacts disappear on reschedule, while the application can still present configuration controls that imply durability.

**Recommended correction**

Add an explicit PVC/volume option and mount, default the feature off until storage is configured, validate writability at startup, and surface provider durability status.

**Recommended regression test**

Render/install chart defaults, run a backup, replace the pod, and verify the artifact persists; add negative tests for disabled/unwritable configurations.

**Verification method**

Accepted Phase 3 manifest analysis; no Kubernetes cluster was used.

### MON-M12 - Backup export reads tables through separate transactions instead of one consistent database snapshot

| Field | Value |
| --- | --- |
| Supporting phase IDs | P3-007 |
| Classification | confirmed defect |
| Severity | MEDIUM |
| Confidence | high |
| Affected layers | export table iterator -> repeated scoped transactions -> parent/child relational snapshot |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | Memory buffering is MON-M13 and restore ordering is MON-M08. |

**Evidence paths and relevant ranges**

- `backend/src/backup/backup.service.ts:300-1180`
- `backend/src/common/db/scoped-db.ts:1-260`

**Violated invariant or expected behavior**

One backup artifact must represent one database snapshot so all foreign keys, balances, schedules, and child collections are mutually compatible.

**Realistic reproduction scenario**

Modify parent and child data between two export helper queries. Each helper opens a separate READ COMMITTED transaction, allowing the artifact to contain a parent from one point in time and children from another.

**Impact**

Restore may fail, omit rows, or recreate financially inconsistent state even when every individual table query succeeded.

**Recommended correction**

Run export under one read-only repeatable-read transaction/snapshot and stream all table reads through the same manager; record snapshot metadata and verify closure before publishing.

**Recommended regression test**

Use two connections and barriers to insert/delete/update parent-child, transfer, split, and holding rows during export; the artifact must match either the before or after state, never a mixture.

**Verification method**

Accepted Phase 3 transaction-boundary trace; no concurrent export was executed.

### MON-M13 - Backup export buffers the complete database and archive in memory

| Field | Value |
| --- | --- |
| Supporting phase IDs | P3-008 |
| Classification | confirmed defect |
| Severity | MEDIUM |
| Confidence | high |
| Affected layers | database reads -> in-memory JSON -> compression/encryption -> HTTP/filesystem output |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | Restore decompression is MON-M16. |

**Evidence paths and relevant ranges**

- `backend/src/backup/backup.service.ts:1-1180`
- `backend/src/backup/backup.controller.ts:1-420`

**Violated invariant or expected behavior**

Backup size must be bounded or streamed so a valid large tenant cannot exhaust the API process.

**Realistic reproduction scenario**

Create a tenant with large transaction history, attachments/metadata, prices, and support tables, then request export. The implementation materializes complete row arrays and archive buffers before delivery.

**Impact**

Process out-of-memory termination, API outage, failed backup, and possible collateral impact on other tenants.

**Recommended correction**

Stream rows and archive/encryption output with backpressure, impose documented size limits, move heavy work to a job, and reserve memory independently of request concurrency.

**Recommended regression test**

Generate progressively large datasets and assert peak RSS, backpressure, cancellation cleanup, and a stable 413/job response above limits.

**Verification method**

Accepted Phase 3 static allocation/dataflow analysis; no load or RSS measurement was run.

### MON-M14 - RLS enforce mode can accept an unsafe runtime database role

| Field | Value |
| --- | --- |
| Supporting phase IDs | P3-010; P2-006 superseded |
| Classification | confirmed defect |
| Severity | MEDIUM |
| Confidence | high |
| Affected layers | deployment credentials -> startup role inspection -> RLS GUCs/policies -> runtime queries |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | The audit does not assert that the actual production role is unsafe; it confirms the missing fail-closed verification. |

**Evidence paths and relevant ranges**

- `backend/src/common/db/app-role.ts:1-420`
- `backend/src/common/db/scoped-db.ts:1-260`
- `backend/src/db-init.ts:1-360`
- `docs/future-plans/row-level-security-runbook.md:1-420`

**Violated invariant or expected behavior**

Enforce mode must fail startup unless the runtime connection is an unprivileged non-owner role whose attributes and grants cannot bypass the intended policy boundary.

**Realistic reproduction scenario**

Configure enforce mode with an owner, superuser, BYPASSRLS role, or otherwise unsafe role. Startup checks do not establish every required live role property, so the application may run while tests/docs imply RLS is authoritative.

**Impact**

Deployment-dependent cross-tenant protection can silently collapse; an application authorization bug then reaches all rows.

**Recommended correction**

Query pg_roles/current_user/table ownership at startup, reject owner/superuser/BYPASSRLS and prohibited grants, separate migrator/runtime credentials, and expose a health diagnostic without secrets.

**Recommended regression test**

Integration tests should start with safe and unsafe role matrices and assert fail-closed behavior plus real cross-user denial under the runtime connection.

**Verification method**

Accepted Phase 3 strengthening of P2-006. Live production role catalogs were inaccessible.

### MON-M15 - The runtime application role can write migration history

| Field | Value |
| --- | --- |
| Supporting phase IDs | P3-011 |
| Classification | confirmed defect |
| Severity | MEDIUM |
| Confidence | high |
| Affected layers | database grants -> runtime role -> schema_migrations integrity -> migration runner |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | Unserialized startup is MON-L02. |

**Evidence paths and relevant ranges**

- `database/migrations/123_rls_enable.sql:1-260`
- `backend/src/db-migrate.ts:1-360`
- `database/schema.sql:1-2005`

**Violated invariant or expected behavior**

Only the migrator should insert, update, or delete migration-tracking rows; runtime compromise must not forge schema state.

**Realistic reproduction scenario**

Use the application role to change schema_migrations. The granted privileges permit the tracker to diverge from actual DDL, causing future startup to skip required migrations or attempt an invalid sequence.

**Impact**

Persistent schema drift, failed upgrades, and a stronger post-exploitation persistence path.

**Recommended correction**

Revoke runtime writes to migration metadata and DDL-adjacent objects; grant the migrator separately; verify default privileges for future objects.

**Recommended regression test**

Connect as runtime role and assert SELECT/INSERT/UPDATE/DELETE behavior matches the policy; run the migrator as its own role and confirm upgrades still work.

**Verification method**

Accepted Phase 3 grant analysis; live grant/default-privilege catalogs were not available.

### MON-M16 - Restore decompression has no effective decompressed-size or ratio bound

| Field | Value |
| --- | --- |
| Supporting phase IDs | P3-012 |
| Classification | confirmed defect |
| Severity | MEDIUM |
| Confidence | high |
| Affected layers | authenticated upload -> decrypt -> decompress -> parse/validate -> destructive transaction |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | Export buffering is MON-M13. |

**Evidence paths and relevant ranges**

- `backend/src/backup/backup.service.ts:1-420,1180-1600`
- `backend/src/backup/backup.controller.ts:1-420`

**Violated invariant or expected behavior**

Untrusted backup input must be bounded by compressed size, decompressed bytes, expansion ratio, nesting, and processing time before destructive work.

**Realistic reproduction scenario**

Upload a small authenticated/compliant archive that expands to a very large JSON payload. The service decompresses and buffers it without an adequate post-decompression limit.

**Impact**

Memory/CPU exhaustion and API outage; the attacker needs an authenticated account but can affect the shared process.

**Recommended correction**

Stream with hard compressed/decompressed byte counters, expansion-ratio and time limits, bounded JSON parsing, and reject before deleting data.

**Recommended regression test**

Test boundary sizes, high-ratio archives, truncated streams, nested encodings, timeouts, and cleanup with stable 4xx errors and no database mutation.

**Verification method**

Accepted Phase 3 static resource-bound analysis; no hostile archive was executed.

### MON-M17 - Backups containing custom currencies are not reliably portable across instances

| Field | Value |
| --- | --- |
| Supporting phase IDs | P3-013 |
| Classification | confirmed defect |
| Severity | MEDIUM |
| Confidence | high |
| Affected layers | currency metadata export -> ID/code remap -> accounts/transactions/rates -> target instance |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | Support-backup privacy leakage is MON-M18. |

**Evidence paths and relevant ranges**

- `backend/src/backup/backup.service.ts:300-2010`
- `backend/src/currencies/currencies.service.ts:1-760`
- `database/migrations/018_user_currency_preferences.sql:1-220`

**Violated invariant or expected behavior**

A full backup must carry and restore every user-defined reference value needed to interpret monetary rows, without colliding with target-global currency state.

**Realistic reproduction scenario**

Create custom currency metadata and rows that reference it, export, and restore to an instance with different currency IDs/global rows. The backup/remap contract does not recreate all required custom metadata consistently before dependent rows.

**Impact**

Restore failure or financially mislabelled accounts, transactions, rates, and reports.

**Recommended correction**

Include a versioned custom-currency manifest keyed by stable owner/code identity, validate collisions, restore metadata first, remap every dependent field, and report unsupported conflicts before deletion.

**Recommended regression test**

Round-trip multiple custom currencies across empty and conflicting targets and verify account, transaction, rate, preference, symbol, decimal, and report semantics.

**Verification method**

Accepted Phase 3 portability analysis; no cross-instance restore was run.

### MON-M18 - Support backups retain identifying custom-currency names and symbols while UI copy says names are masked

| Field | Value |
| --- | --- |
| Supporting phase IDs | P3-014; P6-014 supporting frontend copy |
| Classification | confirmed defect |
| Severity | MEDIUM |
| Confidence | high |
| Affected layers | support-backup allowlist -> field transformer -> preview/manifest -> privacy copy |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | General structural re-identification remains a design-risk/threat-model issue rather than an additional confirmed defect. |

**Evidence paths and relevant ranges**

- `backend/src/backup/support-backup/support-backup-rules.ts:1-420`
- `backend/src/backup/support-backup/support-backup.service.ts:1-420`
- `frontend/src/components/settings/SupportBackupDialog.tsx:1-420`
- `frontend/src/i18n/messages/en/settings.json:1-520`
- `backend/test/integration/support-backup.integration.spec.ts:1-1100`

**Violated invariant or expected behavior**

Every exported field must match the stated de-identification promise, especially user-defined labels and symbols that can contain names or organizations.

**Realistic reproduction scenario**

Define a custom currency such as 'Smith Family Tokens' with identifying symbol/text and create a support backup. Monetary values may be scaled and ordinary names masked, but custom currency metadata remains readable while the UI/documentation describes names as masked.

**Impact**

Re-identification of a support bundle and a materially false privacy representation to users sharing financial data.

**Recommended correction**

Classify custom metadata as user text, mask/drop it or replace it with deterministic neutral tokens, and generate a machine-readable privacy manifest that drives UI wording.

**Recommended regression test**

Golden support-backup tests should seed identifying currency names/symbols, free text, exact dates/rates, and relationship structure; assert the documented policy and preview match bytes actually exported.

**Verification method**

Accepted Phase 3/6 cross-layer finding; no support archive was generated.

### MON-M19 - Global custom-currency cleanup decides deletion from tenant-filtered evidence

| Field | Value |
| --- | --- |
| Supporting phase IDs | P3-015; P2-009 superseded |
| Classification | confirmed defect |
| Severity | MEDIUM |
| Confidence | high |
| Affected layers | user-scoped request -> RLS-filtered reference queries -> deletion from shared currencies table |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | Shared reference-table status is intentional; only the tenant-filtered global deletion decision is defective. |

**Evidence paths and relevant ranges**

- `backend/src/currencies/currencies.service.ts:1-900`
- `database/schema.sql:1-2005`
- `database/migrations/018_user_currency_preferences.sql:1-220`

**Violated invariant or expected behavior**

A global reference row may be deleted only after a true system-wide dependency check; tenant-scoped absence is not global absence.

**Realistic reproduction scenario**

User A deactivates or cleans a shared/custom currency while User B still references it. The evidence query runs in A's tenant context and cannot see B's rows, then the service performs a global deletion decision.

**Impact**

Cross-tenant broken foreign keys, missing labels/rates, or failed financial views for another user.

**Recommended correction**

Run dependency evaluation in an explicit audited system context or prevent physical deletion and use immutable/global tombstones; let foreign keys and ownership metadata enforce safe lifecycle.

**Recommended regression test**

With two users under enforced RLS, reference the same currency from B, invoke cleanup as A, and assert the row survives and both tenants remain valid; cover concurrent activation/cleanup.

**Verification method**

Accepted Phase 3 strengthening of P2-009; no runtime RLS race was executed.

### MON-M20 - Account closure can race a mutation of an existing transaction and commit a closed non-zero account

| Field | Value |
| --- | --- |
| Supporting phase IDs | P4-008 |
| Classification | confirmed defect |
| Severity | MEDIUM |
| Confidence | high |
| Affected layers | account close lock -> existing ledger mutation -> conditional balance update |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | Canonical root; no duplicate final count. |

**Evidence paths and relevant ranges**

- `backend/src/accounts/accounts.service.ts:812-1018`
- `backend/src/transactions/transaction-reconciliation.service.ts:24-86`
- `backend/src/transactions/transactions.service.ts:1900-2178`

**Violated invariant or expected behavior**

A closed account must have zero authoritative and stored balance, and every balance-affecting mutation must serialize with close/reopen.

**Realistic reproduction scenario**

A mutation reads the account as open, then close locks it, sees zero, and commits is_closed=true. The later balance UPDATE waits and then adds its delta because the SQL lacks is_closed=false and the mutation does not share the close lock.

**Concrete numerical example**

Initial: open account `0.00`; existing `-10.00` transaction is VOID.
Implementation result after close/unvoid interleaving: closed account `-10.00`.
Expected: close rejected or mutation rejected, with any closed balance `0.00`.
Difference: `-10.00`.

**Impact**

Closed accounts can contain active financial effects and violate reporting/reopen assumptions.

**Recommended correction**

Lock the account before existing-ledger mutations and use UPDATE ... WHERE is_closed=false RETURNING; roll back the ledger mutation when no row is returned. Use one account lock order for transfers.

**Recommended regression test**

Race close against unvoid, amount update, transfer update, delete/reversal, and split reversal; never permit closed plus non-zero authoritative/stored balance.

**Verification method**

Accepted Phase 4 lock/predicate analysis; broad new-child insertion variant was rejected after checking FK locking.

### MON-M21 - Concurrent incremental split additions can exceed the parent transaction amount

| Field | Value |
| --- | --- |
| Supporting phase IDs | P4-009 |
| Classification | confirmed defect |
| Severity | MEDIUM |
| Confidence | high |
| Affected layers | parent transaction -> existing split SUM -> validation -> later split insert/side effects |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | Canonical root; no duplicate final count. |

**Evidence paths and relevant ranges**

- `backend/src/transactions/transaction-split.service.ts:480-620`
- `database/schema.sql:300-325`
- `backend/src/transactions/transaction-split.service.spec.ts:1-920`

**Violated invariant or expected behavior**

Validation and insertion of a split must observe one serialized split set for the parent.

**Realistic reproduction scenario**

Two requests read the same existing total before either insert. Each addition is individually valid, but both distinct rows commit because neither locks the parent and the schema has no aggregate constraint.

**Concrete numerical example**

Parent: `-100.00`; existing splits: `-60.00`.
Concurrent additions: `-30.00` and `-30.00`.
Implementation result: `-120.00`.
Expected maximum: `-100.00`.
Difference: `-20.00`.

**Impact**

Invalid category totals and extra transfer/investment side effects that do not reconcile to the parent.

**Recommended correction**

Start the transaction before reading, lock the parent FOR UPDATE, re-read the full set, and make add/remove/full replacement share the same parent version/lock.

**Recommended regression test**

Race two additions and add-versus-replace for category, transfer, and investment splits; exactly one conflicting mutation may commit.

**Verification method**

Accepted Phase 4 service/schema analysis; no two-connection test was executed.

### MON-M22 - Local and S3 attachment bytes are not transactionally coupled to metadata and lack compensation

| Field | Value |
| --- | --- |
| Supporting phase IDs | P4-010; Phase 3 DR-006 concretized |
| Classification | confirmed defect |
| Severity | MEDIUM |
| Confidence | high |
| Affected layers | attachment metadata transaction -> local/S3 put/delete -> parent cascade -> download |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | External restore remapping is MON-H02. |

**Evidence paths and relevant ranges**

- `backend/src/attachments/attachments.service.ts:45-190`
- `backend/src/attachments/storage/database-storage.provider.ts:1-180`
- `backend/src/attachments/storage/local-storage.provider.ts:1-180`
- `backend/src/attachments/storage/s3-storage.provider.ts:1-220`
- `database/migrations/109_transaction_attachments.sql:1-55`

**Violated invariant or expected behavior**

Committed metadata must refer to available bytes, and unreferenced bytes must be removed through a durable retryable lifecycle.

**Realistic reproduction scenario**

External save succeeds then DB commit fails, external delete succeeds then DB rolls back, or parent transaction cascade removes metadata without calling local/S3 delete. Concurrent download/delete can also observe metadata just before the object disappears.

**Impact**

Lost receipts, broken download records, and unbounded external-object orphans. The database provider remains safe because its blob shares the transaction.

**Recommended correction**

Use pending/available/tombstoned states and a transactional outbox for idempotent upload finalization/deletion, including parent cascades, checksum verification, retries, and orphan reconciliation.

**Recommended regression test**

Inject failures around put/delete/commit, parent cascade, retries, checksum mismatch, and download/delete for all providers; assert eventual metadata/object convergence.

**Verification method**

Accepted Phase 4 provider-order analysis; no filesystem or S3 operation was executed.

### MON-M23 - Logout can miss a refresh token created by a concurrent rotation in the same family

| Field | Value |
| --- | --- |
| Supporting phase IDs | P4-011 |
| Classification | confirmed defect |
| Severity | MEDIUM |
| Confidence | high |
| Affected layers | presented refresh token -> family lookup -> concurrent locked rotation -> family revocation |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | Frontend false-success handling is MON-M36, a separate root. |

**Evidence paths and relevant ranges**

- `backend/src/auth/token.service.ts:110-248`
- `backend/src/auth/token.service.spec.ts:1-920`

**Violated invariant or expected behavior**

After successful logout, no refresh token in the presented token's family may remain usable.

**Realistic reproduction scenario**

Logout resolves the family in one transaction and revokes it in another. A concurrent rotation inserts a replacement after the revocation UPDATE statement snapshot begins; the update waits on the old row but can miss the newly inserted family member.

**Impact**

A stolen token can remain refreshable after the user receives a successful logout response.

**Recommended correction**

Use a durable session-family row with generation/revoked state, lock it for both rotation and logout, or perform lookup/revocation under one shared lock and verify no active member remains.

**Recommended regression test**

Barrier logout's family UPDATE against rotation's old-row lock and replacement insert; every family member must be revoked and unable to rotate afterward.

**Verification method**

Accepted Phase 4 PostgreSQL statement-snapshot analysis; no concurrent token test was run.

### MON-M24 - Parallel failed logins lose counter increments and delay account lockout

| Field | Value |
| --- | --- |
| Supporting phase IDs | P4-012 |
| Classification | confirmed defect |
| Severity | MEDIUM |
| Confidence | high |
| Affected layers | login user read -> bcrypt -> absolute failed-attempt write -> lockout |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | Canonical root; no duplicate final count. |

**Evidence paths and relevant ranges**

- `backend/src/auth/auth.service.ts:318-410`
- `backend/src/auth/auth.service.spec.ts:1-900`

**Violated invariant or expected behavior**

Every failed attempt must atomically increment the committed counter and lockout must use that committed value.

**Realistic reproduction scenario**

Several invalid-password requests read the same counter, compute the same new absolute value, and overwrite one another after hashing. A success reset can similarly race a failure.

**Impact**

Online password-guessing protection is weaker than configured and security notifications undercount attempts.

**Recommended correction**

Use UPDATE failed_login_attempts=failed_login_attempts+1 RETURNING under a user-row lock and derive locked_until from the returned value; coordinate success reset with the same lock/version.

**Recommended regression test**

Run 5, 10, and 20 simultaneous invalid logins plus valid/invalid races and assert exact count and deterministic lockout.

**Verification method**

Accepted Phase 4 read-modify-write analysis; no parallel bcrypt test was executed.

### MON-M25 - AI insight generation uses a process-local guard and duplicates provider work across replicas

| Field | Value |
| --- | --- |
| Supporting phase IDs | P4-013 |
| Classification | confirmed defect |
| Severity | MEDIUM |
| Confidence | high |
| Affected layers | multi-replica cron/manual request -> local Set -> cooldown query -> provider -> result/usage rows |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | Canonical root; no duplicate final count. |

**Evidence paths and relevant ranges**

- `backend/src/ai/insights/ai-insights.service.ts:104-270,650-735`
- `backend/src/ai/insights/ai-insights.service.spec.ts:1-820`
- `docs/cron-jobs.md:1-24`

**Violated invariant or expected behavior**

One user/generation window should consume one provider call and persist one generation.

**Realistic reproduction scenario**

Two replicas have independent generatingUsers sets and both query before either saves a recent insight. Both call the provider and save separate generations/usage.

**Concrete numerical example**

Illustrative one-window provider cost: expected `$0.02`; two replicas produce `$0.04`.
Difference: `+$0.02` (`+100%`). Actual provider pricing is deployment-dependent; the duplicate-call root is not.

**Impact**

Duplicate/conflicting insights, excess cost, quota exhaustion, and provider load.

**Recommended correction**

Claim a durable unique (user_id,generation_window) lease before provider work, with owner generation and expiry; make save/usage idempotent under the lease.

**Recommended regression test**

Run two service instances sharing PostgreSQL; assert one lease winner, provider call, usage record, and result, including crash/expiry recovery.

**Verification method**

Accepted Phase 4 process/database boundary analysis; no provider call was made.

### MON-M26 - Emergency-access grant issuance can send links that another replica immediately invalidates

| Field | Value |
| --- | --- |
| Supporting phase IDs | P4-014 |
| Classification | confirmed defect |
| Severity | MEDIUM |
| Confidence | high |
| Affected layers | multi-replica monitor -> token generation/save -> SMTP -> granted marker |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | Canonical root; no duplicate final count. |

**Evidence paths and relevant ranges**

- `backend/src/emergency-access/emergency-access-monitor.service.ts:60-250`
- `backend/src/emergency-access/emergency-access-monitor.service.spec.ts:1-780`
- `docs/cron-jobs.md:1-24`

**Violated invariant or expected behavior**

One grant transition must create one immutable token version per contact and one matching deliverable message.

**Realistic reproduction scenario**

Two replicas both see grantedAt null, write different token hashes, and send both links before separately marking granted. The last token write wins, so at least one delivered link is invalid; reminders have the same pre-send timestamp race.

**Impact**

Duplicate sensitive mail and broken recovery links during a high-stakes event.

**Recommended correction**

Atomically claim a grant ID, persist immutable contact token versions, enqueue transactional outbox messages referencing that generation, and uniquely key daily reminders.

**Recommended regression test**

Run two monitors with SMTP failure/crash points and assert one grant, one token version and one usable delivered link per contact.

**Verification method**

Accepted Phase 4 transition/email-order analysis; no SMTP operation was executed.

### MON-M27 - Ordinary transaction currency can disagree with the owning account currency

| Field | Value |
| --- | --- |
| Supporting phase IDs | P5-003 |
| Classification | confirmed defect |
| Severity | MEDIUM |
| Confidence | high |
| Affected layers | account selection -> transaction DTO -> ledger amount/currency -> account balance |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | Canonical root; no duplicate final count. |

**Evidence paths and relevant ranges**

- `backend/src/transactions/dto/create-transaction.dto.ts:1-220`
- `backend/src/transactions/transactions.service.ts:315-650`
- `backend/src/accounts/entities/account.entity.ts:1-260`
- `backend/src/transactions/entities/transaction.entity.ts:1-260`

**Violated invariant or expected behavior**

The primary amount posted to an account must be denominated in that account's currency; original foreign amount/rate must be represented separately.

**Realistic reproduction scenario**

Submit a transaction whose currencyCode differs from the selected account while using the primary amount field. The service can persist the label and apply the unconverted number directly to current_balance.

**Concrete numerical example**

USD account; submitted primary amount `100.00` labelled CAD; valid rate `1 USD = 1.3500 CAD`.
Implementation can increase the USD balance by `100.0000` while the row says CAD.
Converted value would be `74.0741 USD` (or the request should be rejected).
Numeric overstatement relative to conversion: `+25.9259 USD` (`+35.00%`).

**Impact**

Financial rows and balances disagree on denomination, corrupting registers and reports.

**Recommended correction**

Derive primary currency from the account, reject mismatched labels, and require originalAmount/originalCurrencyCode/exchangeRate as one validated foreign-entry tuple.

**Recommended regression test**

Cover create/edit/copy/import/quick-add/MCP for same and foreign currencies, both signs, missing/zero rates, and rounding.

**Verification method**

Accepted Phase 5 serial contract analysis; no API request was executed.

### MON-M28 - Mixed-sign split children are accepted when their signed total happens to equal the parent

| Field | Value |
| --- | --- |
| Supporting phase IDs | P5-004; P6-011 supporting frontend path |
| Classification | confirmed defect |
| Severity | MEDIUM |
| Confidence | high |
| Affected layers | split editor/API -> signed sum validator -> category/transfer/investment children |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | Frontend permitting the payload is merged into the backend invariant root. |

**Evidence paths and relevant ranges**

- `backend/src/transactions/transaction-split.service.ts:120-480`
- `backend/src/transactions/dto/transaction-split.dto.ts:1-180`
- `frontend/src/components/transactions/SplitTransactionEditor.tsx:1-620`
- `frontend/src/lib/transactions.ts:1-320`

**Violated invariant or expected behavior**

Expense parents should not contain income children, and income parents should not contain expense children, unless an explicit mixed-sign product model is documented and every consumer supports it.

**Realistic reproduction scenario**

Submit an expense parent whose children include a positive and a larger negative amount. The validator checks only total equality, so category/report consumers see phantom income and overstated expense even though the net parent matches.

**Concrete numerical example**

Parent expense: `-100.00`; children: `+50.00` and `-150.00`.
Implementation result: accepted because sum is `-100.00`.
Expected: reject.
Financial distortion inside categories: `+50.00` phantom income and `+50.00` excess expense.

**Impact**

Incorrect budget/category analytics and confusing transfer/investment side effects.

**Recommended correction**

Enforce same-sign non-zero children for the ordinary split contract, or introduce an explicit adjustment type and update every consumer. Mirror validation in UI but keep backend authoritative.

**Recommended regression test**

Test mixed signs via UI and direct API, zeros, refunds/adjustments, transfer/investment children, and four-decimal exact sums.

**Verification method**

Accepted Phase 5/6 cross-layer analysis.

### MON-M29 - Explicit zero or negative investment FX rates can produce inconsistent or direction-reversing cash postings

| Field | Value |
| --- | --- |
| Supporting phase IDs | P5-005 |
| Classification | confirmed defect |
| Severity | MEDIUM |
| Confidence | high |
| Affected layers | investment DTO -> explicit-rate precedence -> stored rate -> linked cash transaction |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | Canonical root; no duplicate final count. |

**Evidence paths and relevant ranges**

- `backend/src/securities/investment-transactions.service.ts:320-760`
- `backend/src/securities/dto/create-investment-transaction.dto.ts:1-260`
- `frontend/src/components/investments/InvestmentTransactionForm.tsx:1-900`

**Violated invariant or expected behavior**

Every explicit cross-currency investment rate must be finite and greater than zero, and the stored rate must equal the rate used for the cash leg.

**Realistic reproduction scenario**

Supply exchangeRate=0. resolveCashExchangeRate returns it without validation, the investment row stores zero, and cash posting uses Number(rate) || 1. A negative rate is truthy and can reverse the cash direction.

**Concrete numerical example**

BUY source value: `1,000.00 USD`; funding account CAD; explicit rate `0`; valid rate would be `1.3500`.
Implementation stores rate `0` but cash fallback posts `-1,000.00 CAD`.
Expected: reject; at the valid rate the debit would be `-1,350.00 CAD`.
Difference from the valid cash effect: `+350.00 CAD` (under-debit of `25.93%`).

**Impact**

Incorrect funding-account cash, inconsistent audit data, and potentially a BUY that credits rather than debits cash.

**Recommended correction**

Reject non-finite/non-positive rates at DTO and service boundaries, remove truthiness fallback, and use one validated rate value for preview, investment row, and cash transaction.

**Recommended regression test**

Test empty, zero, negative, NaN/infinite, stale, direct/inverse, and valid rates; assert stored and cash rates/amounts are identical.

**Verification method**

Accepted Phase 5 static arithmetic trace; Phase 8 re-fetched explicit-rate precedence and cash conversion.

### MON-M30 - BUY commission is omitted from cost basis although cash and UI wording include transaction fees

| Field | Value |
| --- | --- |
| Supporting phase IDs | P5-006; P6-013 supporting misleading tooltip |
| Classification | confirmed defect |
| Severity | MEDIUM |
| Confidence | high |
| Affected layers | investment BUY -> cash amount -> holding basis/average cost -> portfolio UI |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | P6-013 is merged as supporting false contract text. |

**Evidence paths and relevant ranges**

- `backend/src/securities/holdings.service.ts:200-420`
- `backend/src/securities/portfolio-calculation.service.ts:560-760`
- `backend/src/securities/investment-transactions.service.ts:520-980`
- `frontend/src/components/investments/InvestmentTransactionForm.tsx:570-790`
- `frontend/src/i18n/messages/en/investments.json:1-500`

**Violated invariant or expected behavior**

Acquisition commission included in cash paid must be included in basis under the product's stated average-cost contract, or the UI must explicitly define a different model.

**Realistic reproduction scenario**

Post a BUY with commission. Cash decreases by price*quantity plus commission, but holding basis adds only price*quantity; the tooltip promises fees are included.

**Concrete numerical example**

BUY `10` shares at `20.00`; commission `5.00`.
Implementation basis: `200.00`; basis/share: `20.00`.
Expected basis: `205.00`; basis/share: `20.50`.
Differences: `-5.00` total and `-0.50` per share.

**Impact**

Understated basis and average cost, overstated unrealized/realized gain, and misleading tax/performance output.

**Recommended correction**

Allocate acquisition commission into basis, preserve it through partial sales/transfers, and document treatment of sell commissions, taxes, and other fees.

**Recommended regression test**

Cover buy, reinvest, partial/full sell, transfer, split, and rebuild with commissions and exact basis reconciliation to cash.

**Verification method**

Accepted Phase 5/6 cross-layer arithmetic and wording analysis.

### MON-M31 - Transfer split amounts are omitted from budget spending

| Field | Value |
| --- | --- |
| Supporting phase IDs | P5-007 |
| Classification | confirmed defect |
| Severity | MEDIUM |
| Confidence | high |
| Affected layers | transaction/split ledger -> budget spending map -> category/flex totals |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | Canonical root; no duplicate final count. |

**Evidence paths and relevant ranges**

- `backend/src/budgets/budget-calculation.service.ts:120-620`
- `backend/src/budgets/budget-period.service.ts:180-620`
- `backend/src/transactions/transaction-split.service.ts:120-620`
- `backend/src/transactions/entities/transaction-split.entity.ts:1-180`

**Violated invariant or expected behavior**

Every categorized expense component must be counted exactly once, including a transfer split that represents spending under the supported model.

**Realistic reproduction scenario**

Create a split expense with one category child and one transfer child. Live balances are correct, but budget aggregation excludes the transfer split from spending.

**Concrete numerical example**

Parent expense: `-100.00`; category child: `-60.00`; transfer child: `-40.00`.
Implementation budget spending: `60.00`.
Expected: `100.00` under the supported categorized-transfer model.
Difference: `-40.00` (`-40%`).

**Impact**

Understated budget actuals and overstated remaining amounts.

**Recommended correction**

Define transfer-split budget semantics explicitly and include qualifying child amounts exactly once, avoiding both parent and counterpart double-counting.

**Recommended regression test**

Test category+transfer, multiple transfers, refunds, VOID/future rows, counterpart exclusion, and cache refresh.

**Verification method**

Accepted Phase 5 aggregation trace.

### MON-M32 - Final scheduled loan payment recalculates principal/interest splits without shrinking the parent payment

| Field | Value |
| --- | --- |
| Supporting phase IDs | P5-008 |
| Classification | confirmed defect |
| Severity | MEDIUM |
| Confidence | high |
| Affected layers | remaining loan balance -> scheduled template parent amount -> principal/interest split recurrence -> posting |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | Canonical root; no duplicate final count. |

**Evidence paths and relevant ranges**

- `backend/src/scheduled-transactions/scheduled-transaction-loan.service.ts:1-260`
- `backend/src/scheduled-transactions/scheduled-transactions.service.ts:1080-1435`
- `backend/src/scheduled-transactions/scheduled-transaction-loan.service.spec.ts:1-1200`

**Violated invariant or expected behavior**

For the final installment, parent amount and child splits must reconcile to the smaller amount required to settle the remaining balance and interest.

**Realistic reproduction scenario**

When remaining principal is below the regular payment, the service caps the principal split but leaves scheduledTransaction.amount unchanged. The next posting template can fail split validation or post a parent amount that disagrees with children.

**Concrete numerical example**

Regular parent payment: `-100.00`; remaining principal: `40.00`; interest: `0.00`.
Implementation recalculated split total: `-40.00` while parent remains `-100.00`.
Expected parent and split total: `-40.00`.
Difference in parent amount: `-60.00`.

**Impact**

Failed final payment, overpayment, or irreconcilable loan ledger/template.

**Recommended correction**

Recompute and atomically persist the parent amount with all splits, include interest/fees/extra principal, and deactivate only after the posted result settles within tolerance.

**Recommended regression test**

Test zero/non-zero rate, final balance below installment, fees/extra principal, rate changes, rounding, posting, and deactivation.

**Verification method**

Accepted Phase 5 arithmetic/state analysis; no amortization runtime was executed.

### MON-M33 - Monte Carlo current-value failure is converted to a real zero

| Field | Value |
| --- | --- |
| Supporting phase IDs | P5-010; P6-008 supporting frontend path |
| Classification | confirmed defect |
| Severity | MEDIUM |
| Confidence | high |
| Affected layers | portfolio/current-value lookup -> API adapter -> simulation form -> run/result |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | P6-008 is merged into this implementation root. |

**Evidence paths and relevant ranges**

- `backend/src/monte-carlo/monte-carlo.service.ts:120-720`
- `frontend/src/components/reports/MonteCarloReport.tsx:1-620`
- `frontend/src/components/reports/useMonteCarloScenarios.ts:1-420`
- `frontend/src/lib/monte-carlo.ts:1-260`

**Violated invariant or expected behavior**

Unavailable valuation must remain an error/unknown state and cannot be coerced to a valid starting value of zero.

**Realistic reproduction scenario**

Enable use-current-balance while valuation fails. Backend/frontend fallback produces 0 and the simulation proceeds or displays it as an intentional starting balance.

**Concrete numerical example**

Actual portfolio: `100,000.00`.
Implementation value after valuation failure: `0.00`.
Expected: unavailable/error or an explicit user override, not zero.
Numeric difference from actual value: `-100,000.00` (`-100%`).

**Impact**

Financial plans can show catastrophic or misleading outcomes based on a fabricated zero instead of the actual portfolio.

**Recommended correction**

Use a discriminated valuation result, block or require an explicit manual override on failure, and retain prior successful values only with visible stale provenance.

**Recommended regression test**

Test provider/API failure, genuine zero, stale cached value, manual override, retry, and result labelling.

**Verification method**

Accepted Phase 5/6 cross-layer null/zero analysis.

### MON-M34 - Bulk deletion can leave linked-account monthly/net-worth snapshots stale

| Field | Value |
| --- | --- |
| Supporting phase IDs | P5-012 |
| Classification | confirmed defect |
| Severity | MEDIUM |
| Confidence | high |
| Affected layers | bulk delete -> linked transfer accounts -> snapshot/recalculation triggers -> reports |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | Canonical root; no duplicate final count. |

**Evidence paths and relevant ranges**

- `backend/src/transactions/transaction-bulk-update.service.ts:120-700`
- `backend/src/net-worth/net-worth.service.ts:1-1150`
- `backend/src/accounts/accounts.service.ts:1560-1720`

**Violated invariant or expected behavior**

Deleting linked financial rows must invalidate/recalculate every affected source and destination account and all derived snapshots.

**Realistic reproduction scenario**

Bulk-delete selected transfer rows. The path derives or triggers recalculation from the directly selected accounts but can omit the linked counterpart account, leaving its monthly/net-worth snapshot at the pre-delete value.

**Concrete numerical example**

Transfer contribution to destination snapshot: `+100.00`.
After bulk deletion, implementation can leave the destination snapshot overstated by `100.00`.
Expected adjustment: `-100.00` to remove the deleted transfer.
Difference: `+100.00` stale value.

**Impact**

Persistent stale net worth and historical reports even after the ledger/balance is corrected.

**Recommended correction**

Collect all affected account IDs from rows and linked legs before deletion, persist an outbox/recalc set in the transaction, and make recomputation idempotent.

**Recommended regression test**

Delete source leg, destination leg, both legs, split transfers, and mixed batches; assert live balances and monthly/net-worth/report snapshots for every linked account.

**Verification method**

Accepted Phase 5 cross-layer derived-state analysis.

### MON-M35 - Foreign-security transfer resets destination account-currency cost basis to an implied 1:1 value

| Field | Value |
| --- | --- |
| Supporting phase IDs | P5-013; P6-004 supporting frontend path |
| Classification | confirmed defect |
| Severity | MEDIUM |
| Confidence | high |
| Affected layers | security transfer-out/in -> native basis -> account-currency basis -> destination holding/UI |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | P6-004 is merged into this backend financial root. |

**Evidence paths and relevant ranges**

- `backend/src/securities/investment-transactions.service.ts:980-1500`
- `backend/src/securities/holdings.service.ts:200-500`
- `backend/src/securities/portfolio-calculation.service.ts:500-900`
- `frontend/src/components/investments/InvestmentTransactionForm.tsx:330-900`

**Violated invariant or expected behavior**

A security transfer must preserve proportional native and account-currency basis; changing accounts is not a new 1:1 currency conversion.

**Realistic reproduction scenario**

Transfer a foreign-currency holding between investment accounts. The destination rebuild/transfer path carries native cost but reconstructs account-currency basis with an implicit rate of one.

**Concrete numerical example**

Transferred native basis: `200.00 USD`; preserved account-currency basis at rate `1.3500`: `270.00 CAD`.
Implementation destination basis: `200.00 CAD`.
Expected: `270.00 CAD`.
Difference: `-70.00 CAD` (`-25.93%`).

**Impact**

Wrong average cost, unrealized gain, tax basis, and portfolio performance in the destination account.

**Recommended correction**

Carry both basis currencies and the proportional transferred basis explicitly, with source acquisition FX provenance; do not recompute from current price or rate 1.

**Recommended regression test**

Test full/partial transfer, same/different account currencies, subsequent sale, split, and rebuild while reconciling source+destination basis.

**Verification method**

Accepted Phase 5/6 cross-layer basis analysis.

### MON-M36 - A failed backend logout is presented as successful local logout

| Field | Value |
| --- | --- |
| Supporting phase IDs | P6-010; P7-004 supporting wrong test |
| Classification | confirmed defect |
| Severity | MEDIUM |
| Confidence | high |
| Affected layers | logout UI -> POST /auth/logout -> HttpOnly refresh cookie/family -> local store/cache -> redirect |
| Final verification status | Confirmed and downgraded from HIGH to MEDIUM in Phase 8. |
| Deduplication / supersession | Kept separate from MON-M23: one is UI failure handling, the other a successful-server-response concurrency race. |

**Evidence paths and relevant ranges**

- `frontend/src/components/layout/AppHeader.tsx:1-300`
- `frontend/src/components/layout/AppHeader.test.tsx:70-155`
- `frontend/src/lib/auth.ts:1-260`
- `frontend/src/store/authStore.ts:1-300`
- `backend/src/auth/auth.controller.ts:850-1300`

**Violated invariant or expected behavior**

The UI must not claim session revocation when the server failed to revoke the refresh family or clear HttpOnly cookies.

**Realistic reproduction scenario**

Force the logout request to fail. The header catches the error, clears only JavaScript state, and redirects without warning. The refresh cookie remains because only a successful backend response can clear it; the existing unit test expects this false-success path.

**Impact**

On a shared device or later navigation, a server-side session credential can remain usable while the user believes logout completed.

**Recommended correction**

Show a blocking warning/retry, prevent a success message, and offer a deliberate local-only exit that clearly states server session revocation failed. Prefer idempotent logout and CSRF-safe cookie clearing where possible.

**Recommended regression test**

Browser test with a real HttpOnly refresh cookie and failed logout must prove no false success; retry success must revoke/clear it. Correct the current unit assertion.

**Verification method**

Phase 8 re-fetched frontend/backend/test paths. Severity was downgraded from HIGH because the ordinary client does not automatically restore the session after local logout, limiting immediate exploitability.

### MON-M37 - Two-decimal split editing and one-cent tolerance conflict with four-decimal persistence

| Field | Value |
| --- | --- |
| Supporting phase IDs | P6-012 |
| Classification | confirmed defect |
| Severity | MEDIUM |
| Confidence | high |
| Affected layers | four-decimal stored amounts -> two-decimal UI -> tolerance validation -> save/reopen |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | Canonical root; no duplicate final count. |

**Evidence paths and relevant ranges**

- `frontend/src/components/transactions/SplitTransactionEditor.tsx:1-620`
- `frontend/src/components/ui/CurrencyInput.tsx:1-360`
- `backend/src/transactions/transaction-split.service.ts:120-480`
- `database/schema.sql:300-325`

**Violated invariant or expected behavior**

Editing must round-trip exact stored monetary precision or explicitly rebalance with user consent; display precision cannot silently mutate a valid split set.

**Realistic reproduction scenario**

Open a valid four-decimal split in the two-decimal editor. Display/redistribution rounds each child, and a one-cent tolerance can accept or rewrite a set different from the persisted exact total.

**Concrete numerical example**

Exact children: `-3.3333 - 3.3333 - 3.3334 = -10.0000`.
A two-decimal edit can produce `-3.33 - 3.33 - 3.33 = -9.99`.
Expected: preserve `-10.0000` or require explicit remainder allocation.
Difference: `+0.0100`.

**Impact**

Cent/sub-cent drift, failed later validation, and repeated mutation on each edit for assets/currencies using more than two decimals.

**Recommended correction**

Use currency-aware decimal precision end-to-end, preserve raw decimal strings, require exact four-decimal equality at save, and provide an explicit remainder allocation action.

**Recommended regression test**

Round-trip -3.3333/-3.3333/-3.3334, 0/3/4-decimal currencies, locale commas, repeated open/save, and backend direct API.

**Verification method**

Accepted Phase 6 frontend/backend precision analysis.

### MON-M38 - Successful transaction mutations leave cached budget progress stale

| Field | Value |
| --- | --- |
| Supporting phase IDs | P6-015 |
| Classification | confirmed defect |
| Severity | MEDIUM |
| Confidence | high |
| Affected layers | transaction create/edit/delete/VOID -> custom API cache invalidation -> budget actual/remaining UI |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | Canonical root; no duplicate final count. |

**Evidence paths and relevant ranges**

- `frontend/src/lib/transactions.ts:1-420`
- `frontend/src/lib/apiCache.ts:1-320`
- `frontend/src/lib/balance-cache.guard.test.ts:1-420`
- `frontend/src/lib/budgets.ts:1-420`
- `frontend/src/app/budgets/page.tsx:1-620`

**Violated invariant or expected behavior**

A successful mutation that changes budget spending must invalidate every budget-period/progress cache before presenting success.

**Realistic reproduction scenario**

Prime budget progress, then create/edit/delete/VOID a categorized transaction. Mutation invalidation refreshes transaction/account views but omits one or more budget query keys, so the budget remains stale until TTL/navigation/manual refresh.

**Concrete numerical example**

Budget: `100.00`; cached spent: `0.00`; new categorized expense: `20.00`.
Implementation can continue to show remaining `100.00`.
Expected remaining: `80.00`.
Difference: `+20.00` overstated remaining budget.

**Impact**

Users can overspend or make planning decisions from obsolete remaining values immediately after a successful action.

**Recommended correction**

Centralize a typed mutation-to-query dependency map, invalidate budget periods/categories/flex groups for every ledger mutation, and prefer versioned server responses or event-driven cache updates.

**Recommended regression test**

Browser tests should prime caches, mutate via every transaction path including scheduled/import and transfer splits, then require immediate authoritative actual/remaining values.

**Verification method**

Accepted Phase 6 cache matrix analysis; browser execution was unavailable.

### MON-M39 - Tests explicitly validate missing FX as a successful 1:1 conversion

| Field | Value |
| --- | --- |
| Supporting phase IDs | P7-001 |
| Classification | confirmed verification defect |
| Severity | MEDIUM |
| Confidence | high |
| Affected layers | frontend unit test + backend unit test -> production missing-FX contract |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | Verification defect counted separately from MON-H12. |

**Evidence paths and relevant ranges**

- `frontend/src/hooks/useExchangeRates.test.ts:90-190`
- `backend/src/securities/portfolio.service.spec.ts:760-850`

**Violated invariant or expected behavior**

Tests must fail when an unavailable rate is presented as a complete destination-currency value.

**Realistic reproduction scenario**

Remove both direct and inverse rate fixtures. The frontend test expects the original number; the backend test expects rate 1 and a complete portfolio total, so the suite protects MON-H12.

**Impact**

A green suite gives false confidence while the highest-impact valuation contract remains wrong.

**Recommended correction**

Change assertions to a typed unavailable/partial result and require missing pair metadata; retain an explicit same-currency 1.0000 case.

**Recommended regression test**

Add backend/frontend integration plus browser coverage that displays partial totals and never relabels source amount as destination currency.

**Verification method**

Phase 8 re-fetched both tests and linked them to the reverified production root.

### MON-M40 - The scheduled-override test expects an existing price to be overwritten by the latest quote

| Field | Value |
| --- | --- |
| Supporting phase IDs | P7-002 |
| Classification | confirmed verification defect |
| Severity | MEDIUM |
| Confidence | high |
| Affected layers | component unit test -> async quote effect -> saved override |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | Verification defect counted separately from MON-H15. |

**Evidence paths and relevant ranges**

- `frontend/src/components/scheduled-transactions/OverrideEditorDialog.test.tsx:480-680`
- `frontend/src/components/scheduled-transactions/OverrideEditorDialog.tsx:1-400`

**Violated invariant or expected behavior**

Regression coverage must preserve an existing value unless the user explicitly changes or refreshes it.

**Realistic reproduction scenario**

Open a stored override and resolve the latest-price mock. The test asserts that the input becomes the quote and the save payload uses it, institutionalizing MON-H15.

**Impact**

Refactoring that correctly preserves the override would currently break the suite.

**Recommended correction**

Assert stored price persistence on unrelated edits; add a separate explicit Use latest quote test and stale-response/dirty-field cases.

**Recommended regression test**

Browser or component integration should delay the quote until after user edits and verify save provenance.

**Verification method**

Phase 8 re-fetched implementation and test at the fixed SHA.

### MON-M41 - The historical stock-split test fixture encodes additive shares instead of a ratio

| Field | Value |
| --- | --- |
| Supporting phase IDs | P7-003 |
| Classification | confirmed verification defect |
| Severity | MEDIUM |
| Confidence | high |
| Affected layers | unit fixture -> historical replay assertion -> split contract |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | Verification defect counted separately from MON-H13. |

**Evidence paths and relevant ranges**

- `backend/src/net-worth/net-worth.service.spec.ts:300-560`
- `backend/src/net-worth/net-worth.service.ts:600-1150`

**Violated invariant or expected behavior**

A split test must store the real ratio and prove multiplication, not choose an additive value that coincidentally reaches the expected result.

**Realistic reproduction scenario**

The fixture starts at 90 shares and stores quantity 90 for a nominal 2-for-1 event. The broken reducer adds 90 and reaches 180, so the test remains green.

**Impact**

The suite actively hides MON-H13 and provides no reverse-split control.

**Recommended correction**

Use ratios 2.0, 0.5, and 1.5; assert quantity, basis, basis/share, and valuation on both sides of the event.

**Recommended regression test**

Add integration with persisted investment rows and a current-holdings positive control using the same action contract.

**Verification method**

Phase 8 re-fetched the reducer and wrong fixture.

### MON-M42 - The AppHeader test expects logout failure to look successful

| Field | Value |
| --- | --- |
| Supporting phase IDs | P7-004 |
| Classification | confirmed verification defect |
| Severity | MEDIUM |
| Confidence | high |
| Affected layers | component test -> failed network request -> local auth state/redirect |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | Verification defect counted separately from MON-M36. |

**Evidence paths and relevant ranges**

- `frontend/src/components/layout/AppHeader.test.tsx:90-130`
- `frontend/src/components/layout/AppHeader.tsx:1-300`

**Violated invariant or expected behavior**

A failed server logout test must require an explicit warning/retry state and must not assert successful revocation.

**Realistic reproduction scenario**

Reject the logout mock. The test expects local state clearing and redirect with no warning, directly protecting MON-M36.

**Impact**

A green UI suite prevents a safe failure-state fix and obscures remaining HttpOnly credentials.

**Recommended correction**

Assert visible failure, no success claim, deliberate local-only exit wording, and successful retry behavior.

**Recommended regression test**

Use an E2E companion with a real HttpOnly cookie and backend failure/success transitions.

**Verification method**

Phase 8 re-fetched the component, auth store/client, backend cookie clearing, and test.

### MON-M43 - Automatic-backup tests expect generic cross-owner keys and retention patterns

| Field | Value |
| --- | --- |
| Supporting phase IDs | P7-005 |
| Classification | confirmed verification defect |
| Severity | MEDIUM |
| Confidence | high |
| Affected layers | backup unit fixtures -> object/path key assertions -> namespace/retention behavior |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | Verification defect counted separately from MON-H01. |

**Evidence paths and relevant ranges**

- `backend/src/backup/auto-backup.service.spec.ts:430-780`
- `backend/src/backup/auto-backup.service.ts:1-600`

**Violated invariant or expected behavior**

Tests must require owner/instance isolation and must fail on any shared generic final key.

**Realistic reproduction scenario**

The unit suite asserts date/frequency names without an owner or instance component and uses those patterns for promotion/retention, preserving MON-H01.

**Impact**

A correct namespace fix will initially fail tests while the destructive cross-tenant behavior remains green.

**Recommended correction**

Rewrite expectations around stable instance/owner/run namespaces and independent retention enumeration; add migration treatment for legacy keys.

**Recommended regression test**

Add local and S3 integration with two users and two instances sharing one root/prefix.

**Verification method**

Phase 8 re-fetched both production and test paths.

### MON-M44 - The backend integration CI command can succeed after discovering zero tests

| Field | Value |
| --- | --- |
| Supporting phase IDs | P7-006 |
| Classification | confirmed verification defect |
| Severity | MEDIUM |
| Confidence | high |
| Affected layers | npm script -> Jest discovery expression -> integration CI job |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | The breadth of missing concurrency cases is MON-M46. |

**Evidence paths and relevant ranges**

- `backend/package.json:1-180`
- `.github/workflows/ci.yml:1-260`

**Violated invariant or expected behavior**

A job named and depended upon as integration verification must fail when its expected suite is not discovered.

**Realistic reproduction scenario**

Rename/move/misconfigure all matching files or break the discovery expression. The script still passes because it includes --passWithNoTests, and CI invokes that script without an independent discovered-test-count guard.

**Impact**

Schema/RLS/transaction integration coverage can disappear while required-looking CI remains green.

**Recommended correction**

Remove --passWithNoTests, make the pattern explicit, print and assert a minimum discovered test/file count, and retain an intentional separate no-tests mode only for local optional use.

**Recommended regression test**

Add a CI self-test that temporarily targets an empty pattern and must fail; record discovered suites and counts as an artifact.

**Verification method**

Phase 8 re-fetched the exact package script and workflow invocation at the fixed SHA.

### MON-M45 - The release workflow pushes a new [skip ci] version-bump commit after testing a different SHA

| Field | Value |
| --- | --- |
| Supporting phase IDs | P7-007 |
| Classification | confirmed verification defect |
| Severity | MEDIUM |
| Confidence | high |
| Affected layers | starting workflow SHA -> verification/build -> admin-token version mutation -> commit/push -> release |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | Live required-check/administrator policy remains an evidence limitation, not an inferred finding. |

**Evidence paths and relevant ranges**

- `.github/workflows/ci.yml:360-820`

**Violated invariant or expected behavior**

The pushed branch head, image revision, and release target must all identify the same commit that passed the required verification graph.

**Realistic reproduction scenario**

The workflow tests/builds the starting SHA, then changes manifests/lockfiles, commits with [skip ci], rebases, and pushes using an administrator token. No later job verifies that new commit, and images were stamped from the earlier SHA.

**Impact**

Protected main and release provenance can point to an untested commit; package metadata and image source revision can diverge.

**Recommended correction**

Create the version commit first on a release branch/PR or rerun the full gate graph on the new commit before an atomic protected push. Remove routine admin bypass and bind image attestations/release target to the tested SHA.

**Recommended regression test**

A release dry-run must compare tested_sha, pushed_sha, image_revision, and release target and fail on any mismatch; verify manifest/lock consistency after the commit.

**Verification method**

Phase 8 re-fetched the release graph. No workflow was rerun and no live branch policy was accessible.

### MON-M46 - Canonical concurrency defects lack deterministic tests at the production conflict boundary

| Field | Value |
| --- | --- |
| Supporting phase IDs | P7-008 |
| Classification | missing test |
| Severity | MEDIUM |
| Confidence | medium |
| Affected layers | real PostgreSQL suites + mocked service suites -> conflict windows of MON-H03 through MON-H09 |
| Final verification status | Confirmed gap and downgraded from HIGH to MEDIUM in Phase 8. |
| Deduplication / supersession | Verification-system finding; it does not duplicate the implementation defects it fails to catch. |

**Evidence paths and relevant ranges**

- `backend/test/integration/mny-import-job.integration.spec.ts:1-420`
- `backend/test/integration/transactions.integration.spec.ts:1-700`
- `backend/test/integration/transfers.integration.spec.ts:1-760`
- `backend/test/integration/investment-transactions.integration.spec.ts:1-900`
- `backend/src/scheduled-transactions/scheduled-transactions.service.spec.ts:1-2700`
- `backend/src/securities/holdings.service.spec.ts:1-1200`
- `backend/src/emergency-access/emergency-access-claim.controller.spec.ts:1-880`

**Violated invariant or expected behavior**

Concurrency regression tests must use independent transactions or application instances, deterministic barriers, and observable database/provider outcomes at the same boundary as production.

**Realistic reproduction scenario**

Existing positive controls cover one-worker claim of one already-created MNY job and sequential CRUD, while scheduler, holdings, emergency claim, and token tests use one mock manager/instance. The confirmed creation, retry, stale-snapshot, occurrence, recompute, rebuild, and claim races can all remain green.

**Impact**

High-impact corruption/security regressions have no deterministic automated guard despite the presence of valuable real-PostgreSQL infrastructure.

**Recommended correction**

Build a reusable race harness with separately acquired connections, named latches, optional multiple Nest/scheduler instances, failpoints, and provider side-effect assertions.

**Recommended regression test**

Implement the seven HIGH race cases first, then account-close, splits, attachments, logout/refresh, login counter, and multi-replica notification/provider cases.

**Verification method**

Phase 8 re-fetched the accessible integration inventory and contrasted each positive control with the missing conflict boundary. Severity was downgraded from HIGH because the connector lacked a recursive immutable tree, so repository-wide absence could not be proved with high confidence.

### MON-M47 - No local/S3 attachment backup-restore round trip verifies metadata, bytes, remapping, and compensation

| Field | Value |
| --- | --- |
| Supporting phase IDs | P7-009 |
| Classification | missing test |
| Severity | MEDIUM |
| Confidence | high |
| Affected layers | backup unit/integration/E2E inventory -> external provider bytes -> MON-H02 |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | Verification finding separate from MON-H02. |

**Evidence paths and relevant ranges**

- `backend/test/integration/backup-restore.integration.spec.ts:1-1000`
- `backend/src/attachments/attachments.service.spec.ts:1-860`
- `backend/src/attachments/storage/local-storage.provider.spec.ts:1-520`
- `backend/src/attachments/storage/s3-storage.provider.spec.ts:1-520`
- `backend/src/backup/backup.service.ts:220-1035`

**Violated invariant or expected behavior**

Restore tests must prove provider bytes, not only metadata and mocked orchestration, survive ID remapping and failure recovery.

**Realistic reproduction scenario**

Run the current suites with provider mocks or database attachments: metadata paths can pass while no test uploads local/S3 bytes, restores them under remapped keys, and downloads/checksums the result.

**Impact**

MON-H02 can remain green and destructive restore confidence is materially overstated.

**Recommended correction**

Add disposable local-directory and S3-compatible provider fixtures, real byte round trips, missing/partial objects, rollback, retry, and truthful partial-result assertions.

**Recommended regression test**

Export non-empty bytes from each provider, restore with new IDs, download every object and compare checksum; inject failure after each external/DB boundary.

**Verification method**

Accepted Phase 7 inventory conclusion and Phase 8 provider re-fetch; no provider execution occurred.

### 7.3 LOW findings

### MON-L01 - A stale PAT comment mentions a reports scope that issuance and enforcement do not support

| Field | Value |
| --- | --- |
| Supporting phase IDs | P1-004 |
| Classification | stale documentation |
| Severity | LOW |
| Confidence | high |
| Affected layers | developer comment -> PAT scope contract |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | Documentation only. |

**Evidence paths and relevant ranges**

- `backend/src/auth/dto/create-pat.dto.ts:1-100`
- `backend/src/auth/entities/personal-access-token.entity.ts:1-160`
- `backend/src/auth/pat.service.ts:35-95`
- `backend/src/mcp/CLAUDE.md:175-215`
- `frontend/src/components/settings/PersonalAccessTokens.tsx:1-420`

**Violated invariant or expected behavior**

Security documentation/comments should enumerate only active scopes.

**Realistic reproduction scenario**

A contributor reads the reports-scope comment and implements a client or future authorization branch around a scope that cannot currently be issued/enforced.

**Impact**

Confusion and future authorization drift; no current privilege expansion was found.

**Recommended correction**

Remove/update the comment and derive documentation from the scope enum/schema.

**Recommended regression test**

Assert documented scope lists equal accepted issuance/enforcement values.

**Verification method**

Accepted Phase 1 finding; Phase 2 explicitly rejected active privilege impact.

### MON-L02 - Database initialization and migration runners are not serialized across backend replicas

| Field | Value |
| --- | --- |
| Supporting phase IDs | P3-016 |
| Classification | confirmed defect |
| Severity | LOW |
| Confidence | high |
| Affected layers | pod startup -> db-init -> migration applied-set snapshot -> DDL/tracker insert |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | Canonical root; no duplicate final count. |

**Evidence paths and relevant ranges**

- `backend/docker-entrypoint.sh:1-220`
- `backend/src/db-init.ts:1-360`
- `backend/src/db-migrate.ts:1-360`
- `helm/templates/statefulset-backend.yaml:1-220`

**Violated invariant or expected behavior**

Only one migrator should apply/record a migration set at a time.

**Realistic reproduction scenario**

Start two backend replicas simultaneously. Both read the same applied set and can execute the same DDL/tracker insert; one may fail and restart the rollout.

**Impact**

Deployment noise/delay and possible manual intervention; persistent corruption was not established, supporting LOW severity.

**Recommended correction**

Use a PostgreSQL advisory lock for init/migrate, or one explicit migration job, and make startup wait for its verified completion.

**Recommended regression test**

Start two migrators against a disposable database and assert one applies while the other waits/exits cleanly.

**Verification method**

Accepted Phase 3/4 startup analysis; no concurrent migrators were run.

### MON-L03 - Budget-alert deduplication is a check-then-insert race

| Field | Value |
| --- | --- |
| Supporting phase IDs | P4-015 |
| Classification | confirmed defect |
| Severity | LOW |
| Confidence | high |
| Affected layers | multi-replica alert cron -> existing query -> insert -> immediate email |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | Canonical root; no duplicate final count. |

**Evidence paths and relevant ranges**

- `backend/src/budgets/budget-alert.service.ts:203-390,500-690`
- `backend/src/budgets/entities/budget-alert.entity.ts:1-300`

**Violated invariant or expected behavior**

One logical alert fingerprint per budget period should create one row and one notification.

**Realistic reproduction scenario**

Two replicas read no existing alert and insert the same candidate because no matching unique constraint exists; both can send critical email.

**Impact**

Duplicate rows, emails, and noisy history without ledger corruption.

**Recommended correction**

Enforce a normalized unique fingerprint and INSERT ... ON CONFLICT DO NOTHING RETURNING; notify only returned winners through an outbox.

**Recommended regression test**

Run two processors for nullable-category and budget-wide alerts; assert one row/message.

**Verification method**

Accepted Phase 4 static race analysis.

### MON-L04 - Staged-file expiry can delete bytes required by a pending or running import job

| Field | Value |
| --- | --- |
| Supporting phase IDs | P4-016 |
| Classification | confirmed defect |
| Severity | LOW |
| Confidence | high |
| Affected layers | staged TTL -> start/claim -> sweeper -> byte load |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | Canonical root; no duplicate final count. |

**Evidence paths and relevant ranges**

- `backend/src/import/mny/mny-staging.service.ts:80-220`
- `backend/src/import/mny/mny-import.service.ts:102-230`
- `database/migrations/117_mny_import_staging_and_jobs.sql:1-102`

**Violated invariant or expected behavior**

An active job must lease its staged bytes until a monotonic terminal state.

**Realistic reproduction scenario**

Start from a row that has expired but has not yet been swept; the sweeper deletes it without excluding active job references before the worker loads bytes.

**Impact**

Failed import and forced re-upload; no committed ledger corruption follows from this race alone.

**Recommended correction**

Enforce expiry in lookup/load, lease/extend in the same transaction as job creation, and exclude active references from sweep.

**Recommended regression test**

Barrier lookup, create, claim, load, and sweep; active bytes must survive and expired unleased files must not start.

**Verification method**

Accepted Phase 4 query/predicate analysis.

### MON-L05 - Concurrent attachment uploads can exceed the per-transaction cap

| Field | Value |
| --- | --- |
| Supporting phase IDs | P4-017 |
| Classification | confirmed defect |
| Severity | LOW |
| Confidence | high |
| Affected layers | attachment count -> cap validation -> insert |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | Canonical root; no duplicate final count. |

**Evidence paths and relevant ranges**

- `backend/src/attachments/attachments.service.ts:20-125`
- `database/migrations/109_transaction_attachments.sql:12-40`

**Violated invariant or expected behavior**

The ten-attachment limit must hold under concurrent uploads.

**Realistic reproduction scenario**

At count nine, two transactions both count nine and insert distinct rows without locking the parent or claiming a constrained slot.

**Impact**

Bounded storage/UI limit bypass; local/S3 can also create both objects.

**Recommended correction**

Lock the parent through count/insert or claim unique slots 1..10.

**Recommended regression test**

Race two uploads from nine and more than ten uploads from zero for all providers; at most ten may commit.

**Verification method**

Accepted Phase 4 count/insert analysis.

### MON-L06 - Bill and mortgage reminder crons send duplicate email from every backend replica

| Field | Value |
| --- | --- |
| Supporting phase IDs | P4-018 |
| Classification | confirmed defect |
| Severity | LOW |
| Confidence | high |
| Affected layers | every-replica cron -> eligible rows -> direct SMTP |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | Canonical root; no duplicate final count. |

**Evidence paths and relevant ranges**

- `backend/src/notifications/bill-reminder.service.ts:1-170`
- `backend/src/accounts/mortgage-reminder.service.ts:1-190`
- `docs/cron-jobs.md:1-24`
- `helm/templates/statefulset-backend.yaml:1-35`

**Violated invariant or expected behavior**

One logical reminder window should produce at most one delivery per user.

**Realistic reproduction scenario**

Deploy two replicas. Both select the same due bills/mortgage renewals and call sendMail without a durable delivery key.

**Impact**

Duplicate user mail, reduced trust, and avoidable provider load.

**Recommended correction**

Claim a unique notification key and dispatch through an outbox/provider idempotency key.

**Recommended regression test**

Run two service instances and assert one outbox row/provider call per window, including crash/retry.

**Verification method**

Accepted Phase 4 cron/deployment trace; no email was sent.

### MON-L07 - Test and CI documentation overstates enforcement without documenting zero-test and release-SHA gaps

| Field | Value |
| --- | --- |
| Supporting phase IDs | P7-011 |
| Classification | stale documentation |
| Severity | LOW |
| Confidence | medium |
| Affected layers | repository testing/release guidance -> actual script/workflow behavior |
| Final verification status | Confirmed at the fixed baseline by deterministic static analysis; not runtime-reproduced. |
| Deduplication / supersession | Documentation only; no additional CI defect count. |

**Evidence paths and relevant ranges**

- CLAUDE.md:1-300
- `backend/CLAUDE.md:1-260`
- `docs/database-migrations.md:1-420`
- `.github/workflows/ci.yml:1-820`
- `backend/package.json:1-180`

**Violated invariant or expected behavior**

Documentation should distinguish intended gates from verifiably enforced discovery, branch policy, and tested release SHA.

**Realistic reproduction scenario**

A maintainer relies on guidance that integration/release verification is mandatory, while --passWithNoTests and the post-gate [skip ci] commit create exceptions not clearly described.

**Impact**

Operational false confidence; the concrete CI defects remain MON-M44 and MON-M45.

**Recommended correction**

Document exact job names, discovery guards, tested/pushed/image SHAs, unavailable live branch-policy evidence, and the release provenance invariant.

**Recommended regression test**

Add documentation assertions or generated CI graph/provenance output checked in the workflow.

**Verification method**

Accepted Phase 7 documentation finding; title consolidated in Phase 8 from the report's CI/documentation evidence.

## 8. Security and RLS findings

The security/RLS review found meaningful positive controls, but several high-value workflows bypass the strongest boundary or use non-atomic credential/session transitions. The following canonical roots contain the complete evidence and remediation details:

| ID | Severity | Title |
| --- | --- | --- |
| MON-H09 | HIGH | One emergency-access claim token can be consumed successfully by two concurrent requests |
| MON-M03 | MEDIUM | Delegated /users/me responses expose fields outside the intended delegated profile |
| MON-M04 | MEDIUM | MCP sessions keep the scopes from session creation after the bearer token is revalidated |
| MON-M05 | MEDIUM | OIDC destructive-action confirmation accepts an arbitrary non-empty value instead of verified reauthentication |
| MON-M06 | MEDIUM | Delegation create, link, and revoke paths conflict with enforced RLS ownership semantics |
| MON-M07 | MEDIUM | Delegated activity is attributed to the effective owner rather than the real actor |
| MON-M14 | MEDIUM | RLS enforce mode can accept an unsafe runtime database role |
| MON-M15 | MEDIUM | The runtime application role can write migration history |
| MON-M19 | MEDIUM | Global custom-currency cleanup decides deletion from tenant-filtered evidence |
| MON-M23 | MEDIUM | Logout can miss a refresh token created by a concurrent rotation in the same family |
| MON-M24 | MEDIUM | Parallel failed logins lose counter increments and delay account lockout |
| MON-M36 | MEDIUM | A failed backend logout is presented as successful local logout |

The RLS model itself was not treated as globally broken. Dedicated unprivileged-role tests exist; the retained issues concern fail-closed runtime-role validation, migration-history privilege separation, specific delegation lifecycle paths, real/effective actor attribution, and high-value recovery/session state machines.

## 9. Database, migration, backup, and restore findings

| ID | Severity | Title |
| --- | --- | --- |
| MON-H01 | HIGH | Automatic backups from different owners and instances share one filename and retention namespace |
| MON-H02 | HIGH | Restore remaps local/S3 attachment metadata without copying or verifying the external bytes |
| MON-M08 | MEDIUM | Restore ordering can deterministically fail linked asset/loan account relationships |
| MON-M09 | MEDIUM | Automatic-backup artifacts are published through non-crash-atomic final-file operations |
| MON-M10 | MEDIUM | Authenticated users can browse and select arbitrary server filesystem backup paths |
| MON-M11 | MEDIUM | The default Helm deployment exposes automatic backup behavior without a writable persistent backup mount |
| MON-M12 | MEDIUM | Backup export reads tables through separate transactions instead of one consistent database snapshot |
| MON-M13 | MEDIUM | Backup export buffers the complete database and archive in memory |
| MON-M14 | MEDIUM | RLS enforce mode can accept an unsafe runtime database role |
| MON-M15 | MEDIUM | The runtime application role can write migration history |
| MON-M16 | MEDIUM | Restore decompression has no effective decompressed-size or ratio bound |
| MON-M17 | MEDIUM | Backups containing custom currencies are not reliably portable across instances |
| MON-M18 | MEDIUM | Support backups retain identifying custom-currency names and symbols while UI copy says names are masked |
| MON-M19 | MEDIUM | Global custom-currency cleanup decides deletion from tenant-filtered evidence |
| MON-M22 | MEDIUM | Local and S3 attachment bytes are not transactionally coupled to metadata and lack compensation |
| MON-L02 | LOW | Database initialization and migration runners are not serialized across backend replicas |

The highest recovery priority is to prevent cross-owner key collisions and to refuse a successful local/S3 attachment restore unless object bytes are present and verified. Snapshot consistency, streaming/bounds, reciprocal-link restoration, custom-currency portability, support-backup privacy, role separation, and migration serialization follow as core recovery hardening.

## 10. Backend transaction and concurrency findings

| ID | Severity | Title |
| --- | --- | --- |
| MON-H03 | HIGH | Concurrent Microsoft Money import starts can create separate active jobs for one user |
| MON-H04 | HIGH | An import worker crash after the data commit can make retry replay the committed source |
| MON-H05 | HIGH | Transaction, transfer, reconciliation, and bulk mutations derive balance deltas from stale snapshots |
| MON-H06 | HIGH | Scheduled posting has no durable occurrence identity and commits money before advancing the schedule |
| MON-H07 | HIGH | Absolute balance recomputation can overwrite a concurrent committed atomic delta |
| MON-H08 | HIGH | Holding updates and full rebuilds can lose concurrent investment transactions |
| MON-H09 | HIGH | One emergency-access claim token can be consumed successfully by two concurrent requests |
| MON-M20 | MEDIUM | Account closure can race a mutation of an existing transaction and commit a closed non-zero account |
| MON-M21 | MEDIUM | Concurrent incremental split additions can exceed the parent transaction amount |
| MON-M22 | MEDIUM | Local and S3 attachment bytes are not transactionally coupled to metadata and lack compensation |
| MON-M23 | MEDIUM | Logout can miss a refresh token created by a concurrent rotation in the same family |
| MON-M24 | MEDIUM | Parallel failed logins lose counter increments and delay account lockout |
| MON-M25 | MEDIUM | AI insight generation uses a process-local guard and duplicates provider work across replicas |
| MON-M26 | MEDIUM | Emergency-access grant issuance can send links that another replica immediately invalidates |
| MON-L03 | LOW | Budget-alert deduplication is a check-then-insert race |
| MON-L04 | LOW | Staged-file expiry can delete bytes required by a pending or running import job |
| MON-L05 | LOW | Concurrent attachment uploads can exceed the per-transaction cap |
| MON-L06 | LOW | Bill and mortgage reminder crons send duplicate email from every backend replica |

The recurring architectural pattern is not `no transactions`; it is incompatible protocols across transactions: stale pre-transaction snapshots, atomic deltas mixed with unlocked absolute writes, read-modify-write holdings mixed with delete/recreate rebuilds, and multi-replica jobs without durable occurrence/delivery identities. Correctness requires one shared lock/version/idempotency protocol per account, holding, import, occurrence, attachment object, notification, and provider generation key.

## 11. Financial-correctness findings

| ID | Severity | Title | Numerical example present |
| --- | --- | --- | --- |
| MON-H03 | HIGH | Concurrent Microsoft Money import starts can create separate active jobs for one user | yes |
| MON-H04 | HIGH | An import worker crash after the data commit can make retry replay the committed source | yes |
| MON-H05 | HIGH | Transaction, transfer, reconciliation, and bulk mutations derive balance deltas from stale snapshots | yes |
| MON-H06 | HIGH | Scheduled posting has no durable occurrence identity and commits money before advancing the schedule | yes |
| MON-H07 | HIGH | Absolute balance recomputation can overwrite a concurrent committed atomic delta | yes |
| MON-H08 | HIGH | Holding updates and full rebuilds can lose concurrent investment transactions | yes |
| MON-H10 | HIGH | Transfer VOID transitions can leave the two legs and both balances inconsistent | yes |
| MON-H11 | HIGH | Transfer currencies, FX rate, and destination value are not server-authoritative | yes |
| MON-H12 | HIGH | Unavailable foreign exchange is converted as a valid-looking 1:1 value | yes |
| MON-H13 | HIGH | Historical net-worth replay adds a stock-split ratio instead of multiplying shares | yes |
| MON-H14 | HIGH | Investment preview and commit can use different exchange rates without disclosure | yes |
| MON-H15 | HIGH | Opening an existing scheduled investment override can replace its stored price with the latest quote | yes |
| MON-H16 | HIGH | Partial or unavailable portfolio valuations are rendered as complete ordinary totals | yes |
| MON-M20 | MEDIUM | Account closure can race a mutation of an existing transaction and commit a closed non-zero account | yes |
| MON-M21 | MEDIUM | Concurrent incremental split additions can exceed the parent transaction amount | yes |
| MON-M25 | MEDIUM | AI insight generation uses a process-local guard and duplicates provider work across replicas | yes |
| MON-M27 | MEDIUM | Ordinary transaction currency can disagree with the owning account currency | yes |
| MON-M28 | MEDIUM | Mixed-sign split children are accepted when their signed total happens to equal the parent | yes |
| MON-M29 | MEDIUM | Explicit zero or negative investment FX rates can produce inconsistent or direction-reversing cash postings | yes |
| MON-M30 | MEDIUM | BUY commission is omitted from cost basis although cash and UI wording include transaction fees | yes |
| MON-M31 | MEDIUM | Transfer split amounts are omitted from budget spending | yes |
| MON-M32 | MEDIUM | Final scheduled loan payment recalculates principal/interest splits without shrinking the parent payment | yes |
| MON-M33 | MEDIUM | Monte Carlo current-value failure is converted to a real zero | yes |
| MON-M34 | MEDIUM | Bulk deletion can leave linked-account monthly/net-worth snapshots stale | yes |
| MON-M35 | MEDIUM | Foreign-security transfer resets destination account-currency cost basis to an implied 1:1 value | yes |
| MON-M37 | MEDIUM | Two-decimal split editing and one-cent tolerance conflict with four-decimal persistence | yes |
| MON-M38 | MEDIUM | Successful transaction mutations leave cached budget progress stale | yes |

Every retained financial finding above includes concrete input, implementation result, expected result, and monetary/quantity/rate/percentage difference in Section 7. The central contract decisions required are: server authority for transfer currency/rate/destination amount; explicit unavailable/partial valuation states; multiplicative split ratios; commission-inclusive basis; defined currency for transferred basis; four-decimal split persistence; and a single serialized protocol for derived balances and holdings.

## 12. Frontend, contract, cache, date, and localization findings

| ID | Severity | Title |
| --- | --- | --- |
| MON-H10 | HIGH | Transfer VOID transitions can leave the two legs and both balances inconsistent |
| MON-H11 | HIGH | Transfer currencies, FX rate, and destination value are not server-authoritative |
| MON-H12 | HIGH | Unavailable foreign exchange is converted as a valid-looking 1:1 value |
| MON-H14 | HIGH | Investment preview and commit can use different exchange rates without disclosure |
| MON-H15 | HIGH | Opening an existing scheduled investment override can replace its stored price with the latest quote |
| MON-H16 | HIGH | Partial or unavailable portfolio valuations are rendered as complete ordinary totals |
| MON-M03 | MEDIUM | Delegated /users/me responses expose fields outside the intended delegated profile |
| MON-M05 | MEDIUM | OIDC destructive-action confirmation accepts an arbitrary non-empty value instead of verified reauthentication |
| MON-M18 | MEDIUM | Support backups retain identifying custom-currency names and symbols while UI copy says names are masked |
| MON-M28 | MEDIUM | Mixed-sign split children are accepted when their signed total happens to equal the parent |
| MON-M30 | MEDIUM | BUY commission is omitted from cost basis although cash and UI wording include transaction fees |
| MON-M33 | MEDIUM | Monte Carlo current-value failure is converted to a real zero |
| MON-M35 | MEDIUM | Foreign-security transfer resets destination account-currency cost basis to an implied 1:1 value |
| MON-M36 | MEDIUM | A failed backend logout is presented as successful local logout |
| MON-M37 | MEDIUM | Two-decimal split editing and one-cent tolerance conflict with four-decimal persistence |
| MON-M38 | MEDIUM | Successful transaction mutations leave cached budget progress stale |

The reviewed date-only paths did not establish a UTC day-shift defect, and delegation context switching performs a full reload. The material frontend roots are instead silent coercion (`missing -> 1/0`), form initialization that mutates persisted meaning before user action, local-only logout after server failure, precision loss, incomplete cache invalidation, and handwritten contracts that cannot represent partiality.

## 13. Test and CI findings

| ID | Severity | Title |
| --- | --- | --- |
| MON-M39 | MEDIUM | Tests explicitly validate missing FX as a successful 1:1 conversion |
| MON-M40 | MEDIUM | The scheduled-override test expects an existing price to be overwritten by the latest quote |
| MON-M41 | MEDIUM | The historical stock-split test fixture encodes additive shares instead of a ratio |
| MON-M42 | MEDIUM | The AppHeader test expects logout failure to look successful |
| MON-M43 | MEDIUM | Automatic-backup tests expect generic cross-owner keys and retention patterns |
| MON-M44 | MEDIUM | The backend integration CI command can succeed after discovering zero tests |
| MON-M45 | MEDIUM | The release workflow pushes a new [skip ci] version-bump commit after testing a different SHA |
| MON-M46 | MEDIUM | Canonical concurrency defects lack deterministic tests at the production conflict boundary |
| MON-M47 | MEDIUM | No local/S3 attachment backup-restore round trip verifies metadata, bytes, remapping, and compensation |
| MON-L07 | LOW | Test and CI documentation overstates enforcement without documenting zero-test and release-SHA gaps |

### CI re-verification

| Evidence item | Fixed-SHA result | Conclusion |
| --- | --- | --- |
| Integration command | `jest --config ./test/jest-e2e.json --testPathPatterns='test/integration/.*\.spec\.ts$' --runInBand --passWithNoTests` | A zero-discovery integration run exits successfully. |
| CI invocation | `.github/workflows/ci.yml` runs `npm run test:integration` | No independent test-count/discovery guard was located. |
| Release tested SHA | `prepare-release` records `github.sha`; all prerequisite test jobs run before build/release | The gate applies to the workflow-start SHA. |
| Post-test mutation | Release job runs `npm version` in backend/frontend and commits package/lock files | A new source commit is created after the test gate. |
| Push behavior | Admin-scoped `RELEASE_TOKEN`, direct push, commit message contains `[skip ci]` | The newly pushed commit is not verified by the normal CI trigger. |
| Image revision | Build metadata and OCI revision use `prepare-release.outputs.git_sha` | Images identify the pre-bump tested SHA while the release/tag is created after a different commit is pushed. |
| Baseline combined status | No status entries returned | No baseline CI evidence was available. |
| Baseline workflow runs | No workflow runs returned by the available commit query | No baseline CI evidence was available. |
| Check suites/runs/logs/artifacts | Inaccessible | No pass/fail conclusion. |
| Rulesets/required checks/strict/merge queue/reviews/status source/admin bypass | Inaccessible | Workflow comments were not treated as live policy evidence. |

## 14. Documentation inconsistencies

| ID | Documentation issue |
| --- | --- |
| DOC-01 | Deployment documentation diverges from Compose/Helm defaults and persistence. |
| DOC-02 | CONTRIBUTING and auxiliary backend guidance retain direct repository/QueryRunner patterns contrary to scoped instructions. |
| DOC-03 | PAT comments mention an inactive reports scope. |
| DOC-04 | MCP session guidance does not state that authorization scopes must be refreshed or token-generation-bound on every request. |
| DOC-05 | OIDC destructive prompts imply verified reauthentication although arbitrary non-empty confirmation is accepted in affected paths. |
| DOC-06 | RLS documentation does not fully state the fail-closed runtime-role attribute/grant requirements. |
| DOC-07 | Backup naming and retention documentation omits owner/instance namespace requirements. |
| DOC-08 | Backup completion wording does not distinguish temporary, verified, and atomically published artifacts. |
| DOC-09 | Restore wording overstates local/S3 attachment recovery. |
| DOC-10 | Support-backup privacy wording says names are masked while custom currency names/symbols remain. |
| DOC-11 | Custom-currency backup portability/conflict behavior is not documented. |
| DOC-12 | The attachment service comment says metadata and bytes commit together, which is true only for the database provider. |
| DOC-13 | MNY import retry/atomicity wording says failure leaves nothing, contradicted by the post-commit finalization window. |
| DOC-14 | Staged-file lookup comments claim expiry enforcement that the query does not implement. |
| DOC-15 | Emergency claim comments say revalidation is under lock although no lock/CAS is used. |
| DOC-16 | Failed-login comments call an absolute stale write an atomic increment. |
| DOC-17 | Cron inventory omits several scheduled services and does not identify each idempotency/lease mechanism. |
| DOC-18 | Transfer FX direction, source of truth, destination tolerance, fees, scheduled, and split semantics lack one authoritative contract. |
| DOC-19 | Investment cost-basis documentation does not state commission/tax/fee treatment. |
| DOC-20 | The future MNY split plan conflicts with the current importer README/mapper semantics. |
| DOC-21 | Split editing documentation does not reconcile display precision with four-decimal persistence. |
| DOC-22 | Portfolio and Monte Carlo contracts do not define complete, partial, unavailable, stale, and real-zero states. |
| DOC-23 | Testing guidance does not disclose that integration discovery can pass with zero tests. |
| DOC-24 | Release guidance does not state that the pushed version-bump commit differs from the tested/image SHA. |

The documentation inventory is broader than the four canonical documentation findings because several comments/docs are supporting contradictions for implementation roots. Correcting wording alone does not close an implementation finding; the linked executable invariant and regression test must also change.

## 15. Design risks and open hypotheses

| ID | Risk / open hypothesis | Decision or verification required |
| --- | --- | --- |
| DR-01 | Nested scoped database calls do not bind the ambient manager to an immutable effective/real/system identity fingerprint. | Reject incompatible nested contexts or define and test explicit escalation/de-escalation semantics. |
| DR-02 | Destructive import/restore workflows lack one common per-user maintenance lease against interactive writes. | Decide whether writes are allowed during maintenance; otherwise enforce a durable lease across all destructive phases. |
| DR-03 | Post-commit action history and net-worth triggers have no durable delivery guarantee. | Classify required derived/audit effects and use an outbox or durable work queue. |
| DR-04 | Cron services have no shared lease/idempotency framework and rely on heterogeneous local safeguards. | Provide a standard database-backed claim, generation, expiry, and idempotency library. |
| DR-05 | Application-maintained balances and holdings use incompatible incremental, absolute, and delete/rebuild protocols. | Adopt one serialization/version protocol per account/holding key and enforce it in every mutator. |
| DR-06 | Demo reset and intraday generation are not coordinated across replicas. | Use a demo-user maintenance lease and one transaction/outbox model even in demo mode. |
| DR-07 | Automatic backup execution itself has no run claim/lease across cron, manual run, and replicas. | Create a per-owner/frequency/run-date job row with a unique claim and resumable state. |
| DR-08 | Database startup lifecycle is embedded in every API replica instead of a dedicated migration owner. | Prefer a one-shot migration job plus advisory lock and explicit readiness dependency. |
| DR-09 | Support backups can remain re-identifiable through exact dates, rates, prices, and relationship structure even after field masking. | Define the threat model and disclose residual linkage risk; add optional coarsening/generalization modes. |
| DR-10 | Crafted backup foreign keys may interact with RLS/RI in ways not dynamically verified for every table. | Preflight ownership/closure and execute malicious-fixture restore tests under the real runtime/migrator roles. |
| DR-11 | Historical FX lookup may use a later/earliest rate when no prior rate exists, depending on consumer path. | Specify no-prior-rate semantics and propagate unavailable rather than silently time-travelling. |
| DR-12 | Investment fee/tax model covers commission but not withholding, transaction tax, exchange fees, or jurisdiction rules. | Document product scope and represent unsupported costs explicitly rather than folding them ambiguously. |
| DR-13 | The OAuth adapter uses a deliberate infrastructure-table exception outside ordinary tenant tables. | Keep the table narrowly scoped, separately granted, audited, and protected by adapter-specific tests. |
| DR-14 | Externally managed production roles might mitigate some RLS findings, but live attributes/default privileges were inaccessible. | Add a deploy-time role attestation artifact and fail health/readiness on unsafe attributes. |
| DR-15 | External object and email/provider workflows lack one cross-cutting compensation/outbox policy. | Define standard pending/available/tombstoned states, provider idempotency, and reconciliation ownership. |
| DR-16 | Live branch protection, rulesets, merge queue, required contexts, source restrictions, and admin bypass were inaccessible. | Export and review policy-as-code or auditable repository settings; do not rely on workflow comments. |
| DR-17 | No complete Helm/default-deployment validation workflow was established (Phase 7 P7-010 remains a design risk). | Add rendered-manifest lint plus disposable-cluster smoke for health, migration, storage, backup, and restore. |
| DR-18 | The API has no common completeness/provenance contract for partial monetary aggregates. | Adopt discriminated complete/partial/unavailable responses with missing components and as-of metadata. |
| DR-19 | Price/FX refreshers may duplicate provider calls across replicas even where row uniqueness limits duplicate persistence. | Add provider-call leases and rate/price acquisition idempotency before external requests. |
| DR-20 | Month-boundary, user-timezone, and report-period semantics were sampled but not fully proven across every report/cache path. | Create one date-only/period contract and a multi-timezone, DST, locale regression matrix. |

None of these items is included in the 70 confirmed findings unless a separate canonical finding already captures a proven manifestation. They should be converted only after a concrete production path, failure scenario, and fixed-SHA evidence are established.

## 16. Areas reviewed without material findings

The following bounded positive conclusions survived consolidation:

- Real PostgreSQL integration suites exist and are used for RLS, migrations, transactions, transfers, investment transactions, MNY job claiming, backup/restore, and support-backup paths, although coverage is incomplete.
- A dedicated unprivileged-role RLS enforcement suite and helper/trigger tests provide meaningful positive controls.
- Service-level cross-user isolation is broad in the reviewed controllers/services; no generic all-tenant leak was inferred from system contexts.
- One worker claim on an already-created MNY job is atomic and has a real PostgreSQL concurrency test.
- Two simultaneous refreshes of the same presented refresh token are serialized by a pessimistic row lock.
- Ordinary current-dated balance deltas use atomic SQL arithmetic and are safe against another ordinary delta; the confirmed defects involve stale or absolute writers.
- The database attachment provider keeps metadata and bytes in PostgreSQL and shares rollback.
- Current holdings apply stock-split ratios multiplicatively; the confirmed split defect is historical replay.
- Migration lint and schema-drift checks are substantive, and the runner tracks full filenames rather than numeric prefixes.
- Budget periods have a database uniqueness constraint preventing duplicate period rows.
- Successful restore clears the frontend API cache in the reviewed path.
- Delegation context switch performs a full reload, reducing stale identity/cache exposure.
- Reviewed date-only transaction/input paths did not establish a UTC day-shift defect.
- Frontend loan projection caps the final projected payment; the confirmed loan defect is backend scheduled-template reconciliation.
- Playwright retries do not automatically turn persistent failures green; a test must still pass within configured attempts.
- No baseline CI evidence was available; this absence is not evidence that CI passed or failed.

### False positives investigated and rejected

| ID | Candidate | Final disposition |
| --- | --- | --- |
| FP-01 | Two ordinary atomic transaction creates necessarily lose one balance increment | Rejected: SQL arithmetic serializes two deltas; failures require stale delta or absolute recompute. |
| FP-02 | Two workers can claim the same pending MNY job | Rejected: conditional pending-to-running UPDATE has one winner; the defect is creation of two jobs. |
| FP-03 | A committed fresh heartbeat is always reaped | Rejected: the stale-state/time predicate is re-evaluated for the UPDATE; late completion ownership remains weak. |
| FP-04 | Every cron running in every replica is automatically defective | Rejected: only concrete duplicate business/provider effects were retained. |
| FP-05 | The database attachment provider has local/S3 atomicity defects | Rejected: its BYTEA write joins the database transaction. |
| FP-06 | Concurrent budget-period creation persists duplicate periods | Rejected: UNIQUE(budget_id, period_start) prevents duplicates. |
| FP-07 | Two refreshes rotate one token successfully | Rejected: pessimistic lock serializes the presented row; logout-versus-replacement is different. |
| FP-08 | Any new transaction always races account closure | Rejected as overbroad because FK insertion can lock the parent; existing-row mutation remains confirmed. |
| FP-09 | Duplicate numeric migration prefixes collide | Rejected: migration history uses the full filename. |
| FP-10 | Delete-first restore partially commits relational data after an insert failure | Rejected: database work is one transaction; external effects are separate. |
| FP-11 | Timestamp-preservation GUC necessarily leaks after commit | Rejected by an existing real-PostgreSQL positive control for commit cleanup. |
| FP-12 | Backup encryption lacks integrity | Rejected: AES-GCM authentication/tamper coverage was present. |
| FP-13 | Crafted backup keys can inject arbitrary SQL columns | Rejected: table allowlists and information_schema filtering drop unknown columns. |
| FP-14 | Global currencies/exchange rates are inherently tenant leaks | Rejected: they are intentional shared references; tenant-filtered deletion is the defect. |
| FP-15 | No FORCE ROW LEVEL SECURITY is automatically a defect | Rejected under the documented owner/migrator/runtime model. |
| FP-16 | Frontend hiding is an authorization control | Rejected: backend guards/RLS remain authoritative. |
| FP-17 | No visible CI status means CI failed | Rejected: the only supported conclusion is no baseline CI evidence was available. |
| FP-18 | Serial four-decimal split summation is wrong | Rejected: -0.3333/-0.3333/-0.3334 reconciles correctly; UI precision and concurrency are separate. |
| FP-19 | Explicit zero scheduled overrides are generally discarded | Rejected: posting precedence uses null/undefined checks; price overwrite is a different frontend effect. |
| FP-20 | Future investment transactions immediately change current holdings/cash | Rejected in the reviewed serial path; due-date and concurrency findings remain separate. |

## 17. Complete deduplication and supersession register

| Earlier/supporting item(s) | Final canonical disposition | Decision | Reason |
| --- | --- | --- | --- |
| P1-001 | MON-H03 / P4-001 | Superseded | Phase 4 established the complete check/create/schema/worker race and the intended per-user active-job key. |
| P2-001 | MON-H01 / P3-001 | Superseded | Phase 3 traced backup keys through provider, promotion, and retention. |
| P2-002 | MON-M10 / P3-005 | Superseded | Phase 3 provided the broader arbitrary server destination and deletion scenario. |
| P2-005 + P3-009 + P6-009 | MON-M05 | Merged | One destructive-step-up root with backend restore and frontend confirmation evidence. |
| P2-006 | MON-M14 / P3-010 | Superseded | Phase 3 proved the startup/runtime-role fail-open behavior in deployment context. |
| P2-009 | MON-M19 / P3-015 | Superseded | Phase 3 established global cleanup based on tenant-filtered evidence. |
| P5-001 + P6-001 | MON-H10 | Merged | Backend transfer-pair/status/balance root with frontend one-leg selection path. |
| P5-002 + P6-002 | MON-H11 | Merged | One server-authority root for transfer destination amount, rate, currencies, scheduled, and split paths. |
| P5-013 + P6-004 | MON-M35 | Merged | Foreign-security transfer basis and its frontend contract form one arithmetic root. |
| P5-009 + P6-006 | MON-H12 | Merged | Backend and frontend both convert missing FX into complete-looking numbers. |
| P5-010 + P6-008 | MON-M33 | Merged | Monte Carlo unavailable data becomes zero across the API/UI contract. |
| P5-004 + P6-011 | MON-M28 | Merged | Mixed-sign split acceptance and editor behavior share one invariant. |
| P5-006 + P6-013 | MON-M30 | Merged | Commission omission and misleading basis presentation share one root. |
| P3-014 + P6-014 | MON-M18 | Merged | Support-backup privacy leak and frontend/support wording are one de-identification root. |
| P6-003 | MON-H14 | Distinct | Preview/commit FX divergence is separate from transfer authority and generic missing-FX aggregation. |
| P6-005 | MON-H15 | Distinct | Asynchronous overwrite of a stored override is a separate destructive form-state root. |
| P6-007 | MON-H16 | Distinct | Missing price/request-failure completeness remains distinct from missing-FX fallback, though both require typed partiality. |
| P6-010 | MON-M36 | Distinct and downgraded | Frontend false-success is separate from the backend logout/refresh family race MON-M23. |
| P6-012 | MON-M37 | Distinct | Display/persistence precision loss is not the same as split-sign validation or concurrent aggregate enforcement. |
| P6-015 | MON-M38 | Distinct | Frontend cache invalidation remains independent of backend budget arithmetic. |
| P7-001..P7-005 | MON-M39..MON-M43 | Linked, not merged into production roots | Incorrect tests are verification defects that actively protect the implementation roots; they retain separate canonical IDs. |
| P7-006 | MON-M44 | Distinct verification defect | Zero-test success can make a named CI job green without executing integration tests. |
| P7-007 | MON-M45 | Distinct verification defect | Release provenance tests one SHA but pushes/releases another. |
| P7-008 | MON-M46 | Distinct missing-test finding; downgraded | Breadth is systemic but complete repository-wide absence was not provable. |
| P7-009 | MON-M47 | Distinct missing-test finding | Provider round-trip coverage is a verification root linked to MON-H02. |
| P7-010 | DR-19 | Design risk only | Live required-check/branch-protection policy was inaccessible and was not converted into a confirmed defect. |
| Track B PR #1014 / 8fd4c4f | Excluded | Removed from baseline registry | Moving-head GEM review did not match the fixed baseline and contributes zero findings. |

Final accounting: 85 phase-local confirmed findings became 70 unique canonical findings. Cross-layer evidence was retained in each canonical card; verification defects were not silently folded into implementation defects; Track B contributed zero; no finding was removed merely because it was difficult to reproduce dynamically.

## 18. Final BLOCKER/HIGH verification ledger

| Final ID | Candidate source | Final status | Independent Phase 8 verification result |
| --- | --- | --- | --- |
| MON-H01 | P3-001 | Retained HIGH | Naming, promotion, retention, local/S3 behavior, deployment defaults, and wrong tests were re-fetched. Shared owner/instance namespace remains deterministic and destructive. |
| MON-H02 | P3-002 | Retained HIGH | Export/remap/restore and all storage providers were re-fetched. Local/S3 bytes are neither packaged nor copied to remapped keys; database provider is the positive exception. |
| MON-H03 | P4-001 / P1-001 | Retained HIGH | Complete start/check/create and schema were re-fetched. No active-job uniqueness exists; the integration test covers only two claims of one existing job. |
| MON-H04 | P4-002 | Retained HIGH | Import commit, finalization, terminal status, staged bytes, and fresh UUID generation were re-fetched. Replay after post-commit failure remains deterministic. |
| MON-H05 | P4-003 | Retained HIGH | Update/delete/transfer/reconciliation/bulk paths were re-fetched. Old values are loaded outside the write transaction and no version/row-lock predicate protects delta derivation. |
| MON-H06 | P4-004 | Retained HIGH | Due selection, post flow, schema, multi-replica docs, and tests were re-fetched. No occurrence key exists and financial effects commit before advancement. |
| MON-H07 | P4-005 | Retained HIGH | Recalculation, import post-processing, and due maintenance were re-fetched. Absolute writes do not share a lock protocol with incremental writers. |
| MON-H08 | P4-006 | Retained HIGH | Incremental holding methods, rebuilds, investment callers, entity uniqueness, and mocked tests were re-fetched. Stale entity saves and snapshot rebuilds remain vulnerable. |
| MON-H09 | P4-007 | Retained HIGH | Claim lookup, transaction, contact entity, credential/session effects, and tests were re-fetched. No FOR UPDATE or conditional one-time consume exists. |
| MON-H10 | P5-001 / P6-001 | Retained HIGH | Frontend selection/form, ordinary and bulk update, linked legs, balance effects, and serial tests were re-fetched. Pair/status/balance invariants are not enforced. |
| MON-H11 | P5-002 / P6-002 | Retained HIGH | DTO, account lookup, direct/scheduled/split transfer paths, frontend payload, and integration tests were re-fetched. Client destination value remains authoritative. |
| MON-H12 | P5-009 / P6-006 / P7-001 | Retained HIGH | Backend conversion, portfolio aggregation, frontend hook, and both wrong tests were re-fetched. Missing data is represented as 1 or an unchanged number. |
| MON-H13 | P5-011 / P7-003 | Retained HIGH | Persisted split ratio, current holding multiplication, historical replay addition, and masking fixture were re-fetched. The root is limited to historical replay. |
| MON-H14 | P6-003 | Retained HIGH | Form initialization, fallback preview, omitted payload rate, and backend historical/latest resolution were re-fetched. Preview and commit can differ materially. |
| MON-H15 | P6-005 / P7-002 | Retained HIGH | Override initialization, asynchronous quote, unconditional state overwrite, save payload, and wrong test were re-fetched. |
| MON-H16 | P6-007 | Retained HIGH | Per-holding nulls, aggregate zeroing/omission, request failure fallback, accounts page, summary card, and type contract were re-fetched. No completeness signal exists. |
| MON-M36 | P6-010 / P7-004 | Downgraded HIGH to MEDIUM | The frontend definitely hides server logout failure, but the normal path does not automatically rehydrate the session. Risk remains material because HttpOnly cookies can survive, but exposure is more constrained than a broad session compromise. |
| MON-M46 | P7-008 | Downgraded HIGH to MEDIUM | Accessible integration suites contain only serial positive controls for the canonical races. The connector did not expose a complete immutable recursive tree, so repository-wide absence could not be established with HIGH confidence. |

No BLOCKER candidate survived. Every retained HIGH was re-fetched from the fixed SHA and independently reconstructed. Two provisional HIGH candidates were downgraded with reasons shown above. No HIGH was retained solely because an earlier phase assigned that severity.

## 19. Complete review-coverage ledger

### 19.1 Directories and architecture areas inspected

| Area | Coverage statement |
| --- | --- |
| Repository root and instructions | Root instruction/docs, Compose, Docker, package metadata, security/contribution guidance, and release workflow were inspected. |
| Backend common/auth/delegation | Scoped DB, request context, JWT/cookies/tokens, step-up, OIDC, emergency access, and delegation paths were inspected in full or material ranges. |
| Backend finance | Transactions, transfers, splits, reconciliation, bulk operations, accounts, scheduled transactions, loans, investments, holdings, prices, portfolio, net worth, budgets, and simulations were inspected in full or sampled ranges. |
| Imports/attachments/backup | MNY staging/jobs/mapping/writers, attachment providers/lifecycle, backup/export/restore/remap/auto-backup/support-backup were inspected. |
| Database | Canonical schema, RLS migrations, attachment/MNY migrations, migration runner, initialization, and migration documentation were inspected; not every migration was fully reviewed. |
| Frontend | Accounts/investments/transactions/scheduled forms, exchange-rate hook, portfolio summary, auth header/store, API cache, handwritten types, and relevant tests were inspected. |
| Tests and CI | Unit, real PostgreSQL integration, frontend component, E2E definitions, coverage scripts, migration/schema checks, CI/release definitions, and available baseline status/run evidence were examined. |
| Deployment | Development/production Compose, Docker entrypoint/images, Helm values/templates/README, replica/volume behavior, and cron-in-API topology were inspected. |

### 19.2 Files inspected in full or complete sequential chunks

- `CLAUDE.md`
- `backend/CLAUDE.md`
- `frontend/CLAUDE.md`
- `database/CLAUDE.md`
- `backend/src/mcp/CLAUDE.md`
- `.claude/settings.json`
- `.claude/skills/backend.md`
- `.claude/skills/infrastructure.md`
- `README.md`
- `CONTRIBUTING.md`
- `SECURITY.md`
- `docs/cron-jobs.md`
- `docs/database-migrations.md`
- `docs/import-ms-money.md`
- `backend/src/import/mny/README.md`
- `docs/support-backup.md`
- `docs/future-plans/row-level-security.md`
- `docs/future-plans/row-level-security-runbook.md`
- `docker-compose.dev.yml`
- `docker-compose.prod.yml`
- `backend/docker-entrypoint.sh`
- `backend/Dockerfile`
- `helm/README.md`
- `helm/values.yaml`
- `helm/templates/statefulset-backend.yaml`
- `.github/workflows/ci.yml`
- `backend/package.json`
- `frontend/package.json`
- `backend/src/common/db/scoped-db.ts`
- `backend/src/common/db/with-context.ts`
- `backend/src/common/request-context.ts`
- `backend/src/mcp/mcp-http.controller.ts`
- `backend/src/mcp/mcp-context.ts`
- `backend/src/import/mny/mny-import.controller.ts`
- `backend/src/import/mny/mny-import-job.service.ts`
- `backend/src/import/mny/mny-staging.service.ts`
- `backend/src/import/mny/entities/import-job.entity.ts`
- `backend/src/import/mny/model/mny-import-job.ts`
- `database/migrations/109_transaction_attachments.sql`
- `database/migrations/114_rls_policies_special.sql`
- `database/migrations/117_mny_import_staging_and_jobs.sql`
- `database/migrations/123_rls_enable.sql`
- `backend/src/attachments/attachments.service.ts`
- `backend/src/attachments/storage/database-storage.provider.ts`
- `backend/src/attachments/storage/local-storage.provider.ts`
- `backend/src/attachments/storage/s3-storage.provider.ts`
- `backend/src/auth/token.service.ts`
- `backend/src/emergency-access/emergency-access-claim.controller.ts`
- `backend/src/emergency-access/emergency-access-monitor.service.ts`
- `backend/src/notifications/bill-reminder.service.ts`
- `backend/src/accounts/mortgage-reminder.service.ts`
- `backend/src/db-init.ts`
- `backend/src/db-migrate.ts`
- `frontend/src/hooks/useExchangeRates.ts`
- `frontend/src/hooks/useExchangeRates.test.ts`
- `frontend/src/store/authStore.ts`
- `frontend/src/lib/auth.ts`

### 19.3 Large files sampled in material contiguous ranges

- `database/schema.sql`
- `backend/src/transactions/transactions.service.ts`
- `backend/src/transactions/transaction-transfer.service.ts`
- `backend/src/transactions/transaction-split.service.ts`
- `backend/src/transactions/transaction-bulk-update.service.ts`
- `backend/src/transactions/transaction-reconciliation.service.ts`
- `backend/src/accounts/accounts.service.ts`
- `backend/src/securities/investment-transactions.service.ts`
- `backend/src/securities/holdings.service.ts`
- `backend/src/securities/portfolio.service.ts`
- `backend/src/securities/portfolio-calculation.service.ts`
- `backend/src/scheduled-transactions/scheduled-transactions.service.ts`
- `backend/src/scheduled-transactions/scheduled-transaction-loan.service.ts`
- `backend/src/backup/backup.service.ts`
- `backend/src/backup/auto-backup.service.ts`
- `backend/src/auth/auth.service.ts`
- `backend/src/auth/auth.controller.ts`
- `backend/src/budgets/budget-alert.service.ts`
- `backend/src/ai/insights/ai-insights.service.ts`
- `backend/src/net-worth/net-worth.service.ts`
- `backend/src/currencies/currencies.service.ts`
- `frontend/src/components/transactions/TransactionForm.tsx`
- `frontend/src/components/transactions/BulkUpdateModal.tsx`
- `frontend/src/components/investments/InvestmentTransactionForm.tsx`
- `frontend/src/components/scheduled-transactions/OverrideEditorDialog.tsx`
- `frontend/src/components/investments/PortfolioSummaryCard.tsx`
- `frontend/src/components/layout/AppHeader.tsx`
- `frontend/src/app/accounts/page.tsx`

### 19.4 Tests and checks examined

- `backend/src/common/db/scoped-db.spec.ts`
- `backend/src/common/db/with-context.spec.ts`
- `backend/src/transactions/transactions.service.spec.ts`
- `backend/src/transactions/transaction-transfer.service.spec.ts`
- `backend/src/transactions/transaction-split.service.spec.ts`
- `backend/src/securities/holdings.service.spec.ts`
- `backend/src/import/mny/mny-import-job.service.spec.ts`
- `backend/src/import/mny/mny-import.service.spec.ts`
- `backend/test/integration/mny-import-job.integration.spec.ts`
- `backend/test/integration/mny-import.integration.spec.ts`
- `backend/test/integration/transactions.integration.spec.ts`
- `backend/test/integration/transfers.integration.spec.ts`
- `backend/test/integration/investment-transactions.integration.spec.ts`
- `backend/test/integration/backup-restore.integration.spec.ts`
- `backend/test/integration/support-backup.integration.spec.ts`
- `backend/test/integration/rls-enable.integration.spec.ts`
- `backend/test/integration/rls-harness.integration.spec.ts`
- `backend/test/integration/rls-enforcement.integration.spec.ts`
- `backend/test/integration/security-cross-user-isolation.integration.spec.ts`
- `backend/src/scheduled-transactions/scheduled-transactions.service.spec.ts`
- `backend/src/attachments/attachments.service.spec.ts`
- `backend/src/auth/token.service.spec.ts`
- `backend/src/budgets/budget-alert.service.spec.ts`
- `backend/src/ai/insights/ai-insights.service.spec.ts`
- `backend/src/emergency-access/emergency-access-claim.controller.spec.ts`
- `backend/src/emergency-access/emergency-access-monitor.service.spec.ts`
- `backend/src/securities/portfolio.service.spec.ts`
- `backend/src/net-worth/net-worth.service.spec.ts`
- `frontend/src/components/scheduled-transactions/OverrideEditorDialog.test.tsx`
- `frontend/src/components/layout/AppHeader.test.tsx`
- `backend/src/backup/auto-backup.service.spec.ts`

### 19.5 Execution and access ledger

| Ledger field | Final recorded value |
| --- | --- |
| Audited baseline | d5cea9bfa995885ba5198f9843359362927c0fd4 |
| Accepted reports consumed | 7 of 7 |
| Repository mode | Read-only; no branches, commits, PRs, comments, labels, workflow actions, settings, databases, or deployments changed |
| Tests executed in Phase 8 | None |
| Runtime scenarios executed in Phase 8 | None |
| Migrations executed | None |
| Containers started | None |
| PostgreSQL connections opened | None |
| Local/S3/SMTP/OIDC/market providers accessed | None |
| CI definitions examined | backend/package.json and .github/workflows/ci.yml, including integration, image, preview, and release paths |
| Baseline CI evidence | No baseline CI evidence was available. |
| Live branch protection/rulesets | Inaccessible |
| Files inaccessible | No recursive immutable tree; CI logs/artifacts/check suites/runs; live repository settings; production configuration/data/providers |
| Search limitations | Results could be capped/truncated and could point at a newer head; absence was not treated as proof |
| Confirmed canonical findings | 70 |
| Retained HIGH after re-verification | 16 |
| Findings downgraded in Phase 8 | 2 provisional HIGH candidates to MEDIUM |
| Findings merged/superseded | 15 net phase-local duplicates removed from final count |
| Findings removed as unsupported | No additional canonical root retained from Track B; unsupported hypotheses stayed outside the registry |
| Design risks/open hypotheses | 20 |
| Missing-test scenarios | 48 |
| Documentation inconsistencies | 24 |
| False positives rejected | 20 |
| Areas reviewed without material findings | 16 |
| Track B exclusions | PR #1014 and short head 8fd4c4f; all GEM findings excluded |

### 19.6 Scope not exhaustively reviewed

- Every repository file, migration, controller/DTO, MCP tool, frontend component, translation string, provider implementation, Helm override, and test was not exhaustively read.
- Production data scale, lock timing, object-store consistency, filesystem durability, SMTP delivery, provider quotas, and deployment policy remain unverified.
- Live branch protection, merge queue, required checks, administrator bypass, and status-source restrictions remain unknown.
- Exact behavior under database isolation levels/configuration different from ordinary PostgreSQL READ COMMITTED requires execution.
- The final ledger therefore makes bounded subsystem statements and does not claim complete repository safety.

## 20. Prioritized remediation plan

| Priority | Workstream | Recommended owner | Canonical findings | Expected risk reduction | Dependencies / implementation direction | Verification before closure |
| --- | --- | --- | --- | --- | --- | --- |
| P0 | Immediate containment | Backup/restore maintainers | MON-H01, MON-H02, MON-M09, MON-M10, MON-M11 | Prevent cross-owner overwrite/deletion and avoid false successful recovery. | Define instance/owner namespace; block local/S3 restore unless bytes can be verified; stage backups before atomic publication. | Two-owner/two-instance provider tests and restore checksum round trips. |
| P0 | Immediate containment | Import/backend maintainers | MON-H03, MON-H04 | Stop duplicate/destructive MNY ingestion during retries and double starts. | Add active-job uniqueness and temporarily disable wipe-mode concurrency; classify commit-unknown jobs as non-replayable pending reconciliation. | Two-connection start race and failpoint recovery matrix. |
| P0 | Immediate containment | Transactions/scheduler maintainers | MON-H05, MON-H06, MON-H07, MON-H08, MON-H10 | Prevent new balance, holding, transfer-pair, and scheduled-occurrence corruption. | Gate risky update/delete/VOID/post/rebuild paths behind per-key locks or temporary single-replica/manual controls until durable protocols land. | Authoritative ledger/holding recomputation after every race case. |
| P0 | Immediate containment | Security/auth maintainers | MON-H09, MON-M05 | Reduce account-recovery and destructive-action compromise. | Make emergency claim consume conditional immediately; require purpose-bound verified reauthentication for destructive restore/wipe actions. | Concurrent claim, step-up replay, and destructive HTTP E2E tests. |
| P0 | Immediate containment | Frontend/portfolio maintainers | MON-H12, MON-H14, MON-H15, MON-H16, MON-M33, MON-M36 | Stop presenting fabricated or silently changed financial/session outcomes. | Render unavailable/partial states; preserve stored override price; display preview/commit source and rate; warn on failed logout revocation. | Contract/component/browser tests for missing data, quote arrival, and logout failure. |
| P0 | Immediate containment | CI/release maintainers | MON-M44, MON-M45 | Prevent false-green integration and untested release commits. | Remove --passWithNoTests; add an explicit discovery-count guard; do not create/push a post-gate commit, or re-run the complete gate on the exact release SHA. | CI self-tests and tested/pushed/image/release SHA equality assertion. |
| P1 | Core correctness | Database/transactions | MON-H05, MON-H07, MON-M20, MON-M21, MON-M34 | Unify cash-ledger serialization and remove stale snapshots. | Adopt deterministic account/transaction locks or optimistic versions; use RETURNING; make recompute and incremental writers share one protocol. | Production-boundary two-connection race harness. |
| P1 | Core correctness | Scheduler/jobs | MON-H06, MON-M25, MON-M26, MON-L03, MON-L04, MON-L06 | Make every recurring effect at-most-once or explicitly resumable. | Create durable occurrence/delivery/generation keys, leases, and transactional outboxes for cron and provider effects. | Two-instance cron matrix with crash/retry failpoints. |
| P1 | Core correctness | Investments | MON-H08, MON-H13, MON-M29, MON-M30, MON-M35 | Restore holdings, historical replay, FX, and basis invariants. | Serialize holdings/rebuilds; replay SPLIT multiplicatively; reject non-positive FX; include commission/fees in basis; transfer basis in a defined currency. | Ledger replay matrix including ratio, commission, transfer, and FX cases. |
| P1 | Core correctness | Transfers/financial contracts | MON-H10, MON-H11, MON-M27, MON-M28, MON-M31, MON-M32, MON-M37 | Make server-calculated signs, currencies, values, splits, and final payments authoritative. | Derive transfer currencies/rates/toAmount from owned accounts and validated rate; update paired legs atomically; reconcile parent/splits and preserve four-decimal data. | Direct/scheduled/split transfer matrix plus loan and precision contracts. |
| P1 | Core correctness | Backup/database | MON-M08, MON-M12, MON-M13, MON-M16, MON-M17, MON-M18, MON-M19, MON-L02 | Make recovery portable, bounded, snapshot-consistent, and operationally safe. | One export snapshot; streaming limits; decompression caps; two-pass reciprocal links; custom-currency manifest; global-reference cleanup under global evidence; migration advisory lock. | Large-data, concurrent-export, malformed-archive, and restore-order suites. |
| P1 | Core correctness | Attachments | MON-H02, MON-M22, MON-L05 | Couple object lifecycle and metadata through durable state. | Pending/available/tombstoned state, immutable keys, checksum verification, outbox deletes, cascade cleanup, orphan reconciliation, cap slots/parent lock. | Provider failure injection and orphan reconciler tests. |
| P1 | Core correctness | Auth/delegation | MON-M03, MON-M04, MON-M06, MON-M07, MON-M23, MON-M24 | Close constrained identity/session integrity gaps. | Explicit delegated DTO allowlists; current-token MCP scope binding; verified RLS-safe delegation lifecycle; real/effective actor attribution; family row/generation; atomic failed-login increment. | RLS HTTP, token-family race, and attribution tests. |
| P2 | Verification repair | Test infrastructure | MON-M39..MON-M47 | Turn the suite from a protector of known defects into a correctness gate. | Correct the six wrong assertions; add provider round trips, typed partiality, concurrency barriers, release provenance, and exact test discovery guards. | All wrong-test register assertions plus integration/E2E companions. |
| P2 | Verification repair | RLS/security QA | MON-M14, MON-M15, MON-M04, MON-M05, DR-03 | Verify fail-closed deployment and purpose-bound authentication at the production boundary. | Run HTTP smoke under the actual unprivileged role; real OIDC step-up; runtime role attribute/grant matrix; migration history denial. | Containerized role matrix and OIDC provider E2E. |
| P2 | Verification repair | Frontend QA | MON-H12, MON-H14, MON-H15, MON-H16, MON-M28, MON-M33, MON-M36, MON-M37, MON-M38 | Verify unavailable, stale, partial, precision, and failure states across locales/timezones. | Create cross-layer contract fixtures and browser tests; assert cache invalidation and no silent coercion to zero/1. | Locale/timezone/currency matrix and stale-cache scenarios. |
| P3 | Documentation and operations | Maintainers/docs | MON-M01, MON-M02, MON-L01, MON-L07, DOC-01..DOC-24 | Align contributor, deployment, recovery, financial, test, and release promises with enforceable behavior. | Update scoped transaction guidance, backup/restore guarantees, support privacy wording, FX/basis contracts, coverage policy, Helm persistence, and release provenance. | Documentation review checklist tied to executable controls and examples. |

## 21. Suggested implementation and regression-test sequencing

1. **Freeze and observe risky operations.** Add metrics/audit events for duplicate imports/occurrences, balance-versus-ledger drift, holding replay drift, missing attachment objects, backup key collisions, partial portfolio inputs, and logout revocation errors. Temporarily limit destructive/import/scheduler workflows where a safe invariant cannot be enforced.
2. **Add database arbitration primitives first.** Ship active-import uniqueness, scheduled occurrence keys, conditional emergency-claim consume, session-family generation/lock, account/transaction/holding version or lock protocol, attachment lifecycle states, notification/provider outboxes, and migration advisory lock.
3. **Build the race/failure harness before broad refactors.** Use independent PostgreSQL connections and deterministic barriers; add worker/commit/provider failpoints. Preserve current positive controls such as same-job claim and ordinary atomic balance increments.
4. **Correct financial contracts.** Make transfer amount/rate/currencies server-authoritative; define split/commission/basis/loan semantics; fix historical split replay; reject non-positive FX; expose complete/partial/unavailable states.
5. **Repair recovery paths.** Namespace backups, publish atomically, export one snapshot with streaming bounds, package/verify external attachment bytes, restore links/currencies in dependency order, and produce a durable recovery manifest.
6. **Repair frontend state and cache behavior.** Preserve existing override values, remove 1/0 fallbacks, display rate/source and partiality, warn on logout failure, preserve four decimals, and invalidate all affected caches after mutation.
7. **Replace the six wrong assertions.** Land corrected unit tests and their integration/E2E companions in the same changes as production fixes so green tests cannot preserve the old contract.
8. **Close CI provenance.** Fail zero-test discovery, require the complete gate on the exact pushed/released SHA, and make image/release provenance identify that SHA. Verify live required-check policy separately.
9. **Update documentation after executable controls pass.** Align deployment, transaction, backup/restore, support privacy, FX/basis, test discovery, release provenance, and Helm persistence wording with verified behavior.
10. **Run a full post-remediation audit.** Recompute balances and holdings from ledgers, exercise cross-owner/provider recovery, run RLS HTTP smoke under the production role, and compare tested/pushed/image/release SHAs.

## 22. Residual risk after remediation

Even after the prioritized fixes, residual risk will remain in migration of legacy backup keys/objects, reconciliation of already-divergent balances/holdings, classification of commit-unknown imports/jobs, recovery of existing local/S3 attachment orphans, historical price/FX quality, provider idempotency limits, and operator deployment choices. Closure should therefore require both preventive controls and one-time detection/repair tooling: namespace migration reports, ledger-to-balance and ledger-to-holding reconciliation, occurrence/import duplicate scanners, object/metadata orphan inventories, partial-valuation telemetry, and release provenance checks.

Risk acceptance must be explicit for any design item that remains outside a database constraint or durable state machine. A passing unit suite alone is not sufficient for concurrency, provider, RLS, recovery, or release-provenance closure.

## 23. Track B isolation statement

PR #1014 and its short reviewed head `8fd4c4f` were outside the fixed-baseline audit. GEM findings were not mixed into this report because matching GEM implementation was not confirmed at `d5cea9bfa995885ba5198f9843359362927c0fd4`. Moving-head review work contributes zero to the finding counts, architecture conclusions, numerical examples, or remediation mapping in this document.

## 24. Final conclusion

The fixed-baseline audit of `kenlasko/monize` at `d5cea9bfa995885ba5198f9843359362927c0fd4` is complete under the recorded static-read limitations. The repository has substantial engineering controls and meaningful real-database coverage, but the most consequential workflows cross transaction, process, provider, or frontend-contract boundaries without one shared correctness protocol. The recommended response is not a collection of cosmetic hardening changes: it is a sequenced integrity program built around database-enforced idempotency, per-key serialization/versioning, durable external-effect state, typed partial/unavailable financial contracts, exact recovery verification, and CI provenance tied to the released commit.

The authoritative final count is **0 BLOCKER, 16 HIGH, 47 MEDIUM, and 7 LOW: 70 unique findings**.

# Appendix A - Canonical finding index

| ID | Severity | Classification | Title | Phase IDs |
| --- | --- | --- | --- | --- |
| MON-H01 | HIGH | confirmed defect | Automatic backups from different owners and instances share one filename and retention namespace | P3-001; P2-001 superseded; P7-005 supporting wrong test |
| MON-H02 | HIGH | confirmed defect | Restore remaps local/S3 attachment metadata without copying or verifying the external bytes | P3-002; P7-009 supporting missing test |
| MON-H03 | HIGH | confirmed defect | Concurrent Microsoft Money import starts can create separate active jobs for one user | P4-001; P1-001 superseded |
| MON-H04 | HIGH | confirmed defect | An import worker crash after the data commit can make retry replay the committed source | P4-002 |
| MON-H05 | HIGH | confirmed defect | Transaction, transfer, reconciliation, and bulk mutations derive balance deltas from stale snapshots | P4-003 |
| MON-H06 | HIGH | confirmed defect | Scheduled posting has no durable occurrence identity and commits money before advancing the schedule | P4-004 |
| MON-H07 | HIGH | confirmed defect | Absolute balance recomputation can overwrite a concurrent committed atomic delta | P4-005 |
| MON-H08 | HIGH | confirmed defect | Holding updates and full rebuilds can lose concurrent investment transactions | P4-006 |
| MON-H09 | HIGH | confirmed defect | One emergency-access claim token can be consumed successfully by two concurrent requests | P4-007 |
| MON-H10 | HIGH | confirmed defect | Transfer VOID transitions can leave the two legs and both balances inconsistent | P5-001; P6-001 supporting frontend path |
| MON-H11 | HIGH | confirmed defect | Transfer currencies, FX rate, and destination value are not server-authoritative | P5-002; P6-002 supporting frontend path |
| MON-H12 | HIGH | confirmed defect | Unavailable foreign exchange is converted as a valid-looking 1:1 value | P5-009; P6-006 supporting frontend path; P7-001 wrong tests |
| MON-H13 | HIGH | confirmed defect | Historical net-worth replay adds a stock-split ratio instead of multiplying shares | P5-011; P7-003 supporting wrong test |
| MON-H14 | HIGH | confirmed defect | Investment preview and commit can use different exchange rates without disclosure | P6-003 |
| MON-H15 | HIGH | confirmed defect | Opening an existing scheduled investment override can replace its stored price with the latest quote | P6-005; P7-002 supporting wrong test |
| MON-H16 | HIGH | confirmed defect | Partial or unavailable portfolio valuations are rendered as complete ordinary totals | P6-007 |
| MON-M01 | MEDIUM | stale documentation | Deployment documentation and documented defaults do not match the inspected Compose and Helm manifests | P1-002 |
| MON-M02 | MEDIUM | stale documentation | Official contributor guidance recommends database transaction APIs prohibited by the scoped repository instructions | P1-003 |
| MON-M03 | MEDIUM | confirmed defect | Delegated /users/me responses expose fields outside the intended delegated profile | P2-003 |
| MON-M04 | MEDIUM | confirmed defect | MCP sessions keep the scopes from session creation after the bearer token is revalidated | P2-004 |
| MON-M05 | MEDIUM | confirmed defect | OIDC destructive-action confirmation accepts an arbitrary non-empty value instead of verified reauthentication | P2-005; P3-009 and P6-009 supporting evidence |
| MON-M06 | MEDIUM | confirmed defect | Delegation create, link, and revoke paths conflict with enforced RLS ownership semantics | P2-007 |
| MON-M07 | MEDIUM | confirmed defect | Delegated activity is attributed to the effective owner rather than the real actor | P2-008 |
| MON-M08 | MEDIUM | confirmed defect | Restore ordering can deterministically fail linked asset/loan account relationships | P3-003 |
| MON-M09 | MEDIUM | confirmed defect | Automatic-backup artifacts are published through non-crash-atomic final-file operations | P3-004 |
| MON-M10 | MEDIUM | confirmed defect | Authenticated users can browse and select arbitrary server filesystem backup paths | P3-005; P2-002 superseded |
| MON-M11 | MEDIUM | confirmed defect | The default Helm deployment exposes automatic backup behavior without a writable persistent backup mount | P3-006 |
| MON-M12 | MEDIUM | confirmed defect | Backup export reads tables through separate transactions instead of one consistent database snapshot | P3-007 |
| MON-M13 | MEDIUM | confirmed defect | Backup export buffers the complete database and archive in memory | P3-008 |
| MON-M14 | MEDIUM | confirmed defect | RLS enforce mode can accept an unsafe runtime database role | P3-010; P2-006 superseded |
| MON-M15 | MEDIUM | confirmed defect | The runtime application role can write migration history | P3-011 |
| MON-M16 | MEDIUM | confirmed defect | Restore decompression has no effective decompressed-size or ratio bound | P3-012 |
| MON-M17 | MEDIUM | confirmed defect | Backups containing custom currencies are not reliably portable across instances | P3-013 |
| MON-M18 | MEDIUM | confirmed defect | Support backups retain identifying custom-currency names and symbols while UI copy says names are masked | P3-014; P6-014 supporting frontend copy |
| MON-M19 | MEDIUM | confirmed defect | Global custom-currency cleanup decides deletion from tenant-filtered evidence | P3-015; P2-009 superseded |
| MON-M20 | MEDIUM | confirmed defect | Account closure can race a mutation of an existing transaction and commit a closed non-zero account | P4-008 |
| MON-M21 | MEDIUM | confirmed defect | Concurrent incremental split additions can exceed the parent transaction amount | P4-009 |
| MON-M22 | MEDIUM | confirmed defect | Local and S3 attachment bytes are not transactionally coupled to metadata and lack compensation | P4-010; Phase 3 DR-006 concretized |
| MON-M23 | MEDIUM | confirmed defect | Logout can miss a refresh token created by a concurrent rotation in the same family | P4-011 |
| MON-M24 | MEDIUM | confirmed defect | Parallel failed logins lose counter increments and delay account lockout | P4-012 |
| MON-M25 | MEDIUM | confirmed defect | AI insight generation uses a process-local guard and duplicates provider work across replicas | P4-013 |
| MON-M26 | MEDIUM | confirmed defect | Emergency-access grant issuance can send links that another replica immediately invalidates | P4-014 |
| MON-M27 | MEDIUM | confirmed defect | Ordinary transaction currency can disagree with the owning account currency | P5-003 |
| MON-M28 | MEDIUM | confirmed defect | Mixed-sign split children are accepted when their signed total happens to equal the parent | P5-004; P6-011 supporting frontend path |
| MON-M29 | MEDIUM | confirmed defect | Explicit zero or negative investment FX rates can produce inconsistent or direction-reversing cash postings | P5-005 |
| MON-M30 | MEDIUM | confirmed defect | BUY commission is omitted from cost basis although cash and UI wording include transaction fees | P5-006; P6-013 supporting misleading tooltip |
| MON-M31 | MEDIUM | confirmed defect | Transfer split amounts are omitted from budget spending | P5-007 |
| MON-M32 | MEDIUM | confirmed defect | Final scheduled loan payment recalculates principal/interest splits without shrinking the parent payment | P5-008 |
| MON-M33 | MEDIUM | confirmed defect | Monte Carlo current-value failure is converted to a real zero | P5-010; P6-008 supporting frontend path |
| MON-M34 | MEDIUM | confirmed defect | Bulk deletion can leave linked-account monthly/net-worth snapshots stale | P5-012 |
| MON-M35 | MEDIUM | confirmed defect | Foreign-security transfer resets destination account-currency cost basis to an implied 1:1 value | P5-013; P6-004 supporting frontend path |
| MON-M36 | MEDIUM | confirmed defect | A failed backend logout is presented as successful local logout | P6-010; P7-004 supporting wrong test |
| MON-M37 | MEDIUM | confirmed defect | Two-decimal split editing and one-cent tolerance conflict with four-decimal persistence | P6-012 |
| MON-M38 | MEDIUM | confirmed defect | Successful transaction mutations leave cached budget progress stale | P6-015 |
| MON-M39 | MEDIUM | confirmed verification defect | Tests explicitly validate missing FX as a successful 1:1 conversion | P7-001 |
| MON-M40 | MEDIUM | confirmed verification defect | The scheduled-override test expects an existing price to be overwritten by the latest quote | P7-002 |
| MON-M41 | MEDIUM | confirmed verification defect | The historical stock-split test fixture encodes additive shares instead of a ratio | P7-003 |
| MON-M42 | MEDIUM | confirmed verification defect | The AppHeader test expects logout failure to look successful | P7-004 |
| MON-M43 | MEDIUM | confirmed verification defect | Automatic-backup tests expect generic cross-owner keys and retention patterns | P7-005 |
| MON-M44 | MEDIUM | confirmed verification defect | The backend integration CI command can succeed after discovering zero tests | P7-006 |
| MON-M45 | MEDIUM | confirmed verification defect | The release workflow pushes a new [skip ci] version-bump commit after testing a different SHA | P7-007 |
| MON-M46 | MEDIUM | missing test | Canonical concurrency defects lack deterministic tests at the production conflict boundary | P7-008 |
| MON-M47 | MEDIUM | missing test | No local/S3 attachment backup-restore round trip verifies metadata, bytes, remapping, and compensation | P7-009 |
| MON-L01 | LOW | stale documentation | A stale PAT comment mentions a reports scope that issuance and enforcement do not support | P1-004 |
| MON-L02 | LOW | confirmed defect | Database initialization and migration runners are not serialized across backend replicas | P3-016 |
| MON-L03 | LOW | confirmed defect | Budget-alert deduplication is a check-then-insert race | P4-015 |
| MON-L04 | LOW | confirmed defect | Staged-file expiry can delete bytes required by a pending or running import job | P4-016 |
| MON-L05 | LOW | confirmed defect | Concurrent attachment uploads can exceed the per-transaction cap | P4-017 |
| MON-L06 | LOW | confirmed defect | Bill and mortgage reminder crons send duplicate email from every backend replica | P4-018 |
| MON-L07 | LOW | stale documentation | Test and CI documentation overstates enforcement without documenting zero-test and release-SHA gaps | P7-011 |

# Appendix B - Wrong-test register

## WT-01 - `frontend/src/hooks/useExchangeRates.test.ts:90-190`

- **Incorrect behavior asserted:** The test asserts that an unavailable cross-currency rate returns the original numeric amount, which presents missing conversion data as a complete 1:1 result.
- **Implementation root protected:** MON-H12 / P5-009 / P6-006
- **Why green is not correctness:** A green result proves only that the hook preserves the defective fallback. It does not prove that the displayed currency amount is valid.
- **Corrected assertion:** Assert a typed unavailable/partial result for a missing pair; reserve exactly 1.0000 for equal currencies. Test direct and inverse rates separately.
- **Required integration/E2E companion:** Backend/frontend contract test with 100.00 USD to CAD: missing rate must be unavailable; rate 1.3500 must produce 135.00 CAD.

## WT-02 - `backend/src/securities/portfolio.service.spec.ts:760-850`

- **Incorrect behavior asserted:** The test expects a missing exchange-rate lookup to be cached as 1 and included in aggregate portfolio totals.
- **Implementation root protected:** MON-H12 / P5-009
- **Why green is not correctness:** The assertion makes a fabricated conversion part of the expected backend contract, so a passing unit suite protects false completeness.
- **Corrected assertion:** Assert that the holding or aggregate is marked partial/unavailable and that no converted total is emitted for the missing pair.
- **Required integration/E2E companion:** Real-service integration test with same-currency, direct, inverse, and missing rates, including partial aggregate metadata.

## WT-03 - `frontend/src/components/scheduled-transactions/OverrideEditorDialog.test.tsx:480-680`

- **Incorrect behavior asserted:** The test explicitly expects the latest quote to overwrite the stored investment override price when the dialog opens.
- **Implementation root protected:** MON-H15 / P6-005
- **Why green is not correctness:** A green test confirms the destructive initialization rather than preservation of the user's existing override.
- **Corrected assertion:** Assert that an existing override price remains 250.00 after the asynchronous quote 123.45 arrives unless the user explicitly chooses to replace it.
- **Required integration/E2E companion:** Component/E2E test editing only description or date and verifying the saved payload still contains 250.00.

## WT-04 - `backend/src/net-worth/net-worth.service.spec.ts:300-560`

- **Incorrect behavior asserted:** The split fixture stores quantity 90 on a holding of 90 shares, so the defective additive replay happens to reach 180 and passes.
- **Implementation root protected:** MON-H13 / P5-011
- **Why green is not correctness:** The fixture encodes an absolute increment instead of the persisted split ratio and therefore cannot detect additive replay.
- **Corrected assertion:** Store ratio 2.0 and expect 180 from 90; add reverse split 0.5 and fractional split 1.5 while preserving basis.
- **Required integration/E2E companion:** Integration replay test comparing current holdings and historical monthly snapshots from the same investment ledger.

## WT-05 - `frontend/src/components/layout/AppHeader.test.tsx:90-130`

- **Incorrect behavior asserted:** The test expects local logout and redirect even when the server-side logout request fails, without warning the user that HttpOnly cookies may remain valid.
- **Implementation root protected:** MON-M36 / P6-010
- **Why green is not correctness:** A green test validates a false-success experience and says nothing about refresh-cookie invalidation.
- **Corrected assertion:** Assert an explicit revocation-failed warning and a deliberate recovery choice; do not label the operation successful.
- **Required integration/E2E companion:** Browser/E2E test with a failed /auth/logout response and a subsequent authenticated request/refresh attempt using the retained cookies.

## WT-06 - `backend/src/backup/auto-backup.service.spec.ts:430-780`

- **Incorrect behavior asserted:** The tests expect generic date/frequency backup keys and retention enumeration without owner or instance namespace.
- **Implementation root protected:** MON-H01 / P3-001 / P7-005
- **Why green is not correctness:** A passing test entrenches the exact key collision and cross-tenant retention scope that cause destructive backup loss.
- **Corrected assertion:** Assert keys include a stable instance namespace, owner ID, frequency, date, and immutable run identifier; retention must stay inside that prefix.
- **Required integration/E2E companion:** Local and S3 integration tests with two owners and two instances sharing one root/prefix, including promotion and deletion.

# Appendix C - Missing-test register

| ID | Scenario | Evidence status | Required coverage |
| --- | --- | --- | --- |
| MT-01 | Concurrent complete MNY starts | confirmed missing | Two same-user start requests, same and different staged files, wipe mode, two replicas. |
| MT-02 | MNY post-commit recovery | confirmed missing | Failpoints before/after data commit, verification, byte deletion, and terminal-state update. |
| MT-03 | Transaction stale-snapshot races | confirmed missing | Update/update, update/delete, delete/delete, VOID/unvoid with independent connections. |
| MT-04 | Transfer pair race/status matrix | confirmed missing | Pair locks, one-leg bulk status, rollback, and source/destination balance reconciliation. |
| MT-05 | Scheduled occurrence idempotency | confirmed missing | Two schedulers, manual versus cron, crash between money and advancement. |
| MT-06 | Balance recompute versus delta | confirmed missing | Recompute SELECT/UPDATE barrier against create/update/delete/VOID/import/due cron. |
| MT-07 | Holding incremental races | confirmed missing | Buy/buy, buy/sell, split, transfer, and absent-row upsert contention. |
| MT-08 | Holding rebuild versus trade | confirmed missing | Rebuild snapshot/delete/recreate against interactive investment commit. |
| MT-09 | Emergency claim single use | confirmed missing | Two claim completions with different passwords and session-family assertion. |
| MT-10 | Account close versus existing mutation | test not located | Close against unvoid, edit, transfer update, and delete. |
| MT-11 | Concurrent split aggregate enforcement | test not located | Two additions and add-versus-replace under parent lock/version. |
| MT-12 | Attachment external compensation | confirmed provider gap | Put/delete/cascade versus DB commit/rollback for local and S3. |
| MT-13 | Attachment restore provider round trip | confirmed missing | Export, remap, restore, download, checksum, missing/partial object cases. |
| MT-14 | Logout versus refresh rotation | confirmed missing | Family lock and descendant-token revocation with two connections. |
| MT-15 | Parallel failed-login counter | confirmed missing | 5/10/20 failures plus success/failure race. |
| MT-16 | Two-instance AI generation | confirmed missing | One provider call/result/usage and lease expiry recovery. |
| MT-17 | Two-instance emergency grant | confirmed missing | One token generation, outbox message, and usable link per contact. |
| MT-18 | Budget-alert unique fingerprint | test not located | Two processors, nullable category, one row and one email. |
| MT-19 | Staged-file lease and sweep | test not located | Expiry/start/claim/load/sweep deterministic barriers. |
| MT-20 | Attachment cap contention | test not located | Nine existing plus two uploads; more than ten simultaneous uploads. |
| MT-21 | Duplicate reminder delivery | test not located | Two replicas, one outbox/provider invocation per logical window. |
| MT-22 | Nested scoped identity changes | confirmed missing | Effective user, real user, user-to-system, system-to-user, preserve timestamps. |
| MT-23 | Nested error/pool reuse | partial | Caught/propagated errors, rollback, uncaught exception, same-connection reuse. |
| MT-24 | Backup namespace isolation | incorrect existing assertion | Two users/instances, local/S3, promotion and retention isolation. |
| MT-25 | Backup crash-atomic publication | test not located | Temporary write, fsync/checksum, atomic rename/copy, cleanup. |
| MT-26 | Backup one-snapshot export | test not located | Concurrent parent/child/transfer/split changes during export. |
| MT-27 | Large backup streaming/RSS | test not located | Backpressure, cancellation, size cap, concurrent exports. |
| MT-28 | Restore decompression limits | test not located | Compressed/decompressed bytes, ratio, timeout, malformed/truncated data. |
| MT-29 | Linked asset/loan restore order | test not located | Both row orders, reciprocal/missing links, rollback. |
| MT-30 | Custom-currency portability | test not located | Empty/conflicting target, all dependent references and rates. |
| MT-31 | Support-backup custom-currency masking | test not located | Identifying names/symbols plus privacy manifest/golden output. |
| MT-32 | Unsafe runtime-role startup rejection | partial | Owner/superuser/BYPASSRLS/grant matrix and health failure. |
| MT-33 | Runtime denial on migration history | test not located | Application role cannot mutate schema_migrations; migrator can. |
| MT-34 | Two-process init/migrate | test not located | Advisory lock/one winner and clean wait/retry. |
| MT-35 | Delegated profile field allowlist | confirmed missing | Owner/delegate exact response fields and cache clearing. |
| MT-36 | MCP session scope refresh after token downgrade/revocation | confirmed missing | Create a write-scoped session, revalidate a read-only/revoked replacement token for the same user, and prove cached write authority is removed. |
| MT-37 | OIDC destructive step-up E2E | confirmed missing | Real provider assertion, subject/purpose/nonce/expiry/replay. |
| MT-38 | Delegation lifecycle under enforced RLS | partial | Create, accept/link, revoke, rollback, cross-owner denial. |
| MT-39 | Real/effective actor attribution | test not located | Activity and emergency inactivity timestamps. |
| MT-40 | Transfer FX authority matrix | confirmed missing | Tampered amount/rate/currency, direct/scheduled/split, inverse and fees. |
| MT-41 | Investment FX preview/commit parity | test not located | Missing/zero/negative/stale/historical rate and signed quote. |
| MT-42 | Commission-bearing basis | confirmed missing | Buy, partial/full sell, transfer, rebuild, realized gain. |
| MT-43 | Split sign and four-decimal round trip | confirmed missing/incorrect UI | Mixed signs, exact precision, locales, repeated edit. |
| MT-44 | Loan final installment reconciliation | confirmed missing | Parent/splits, zero/nonzero rate, fees, extra principal, deactivation. |
| MT-45 | Partial valuation contract | test not located | Missing price, request failure, genuine zero, stale prior, missing FX. |
| MT-46 | Historical stock-split ratio | present but wrong | 2.0, 0.5, 1.5 ratios and basis/valuation. |
| MT-47 | Budget mutation cache invalidation | confirmed missing | Prime cache, create/edit/delete/VOID/scheduled/import, immediate refresh. |
| MT-48 | CI/release self-verification | confirmed missing | Zero-test discovery must fail; tested/pushed/image/release SHA equality. |

# Appendix D - CI evidence table

| Evidence | Observed at fixed baseline | Audit conclusion |
| --- | --- | --- |
| backend/package.json integration script | Includes --passWithNoTests | MON-M44 confirmed |
| CI integration job | Runs npm run test:integration without a discovery guard | Zero tests can still report success |
| Release prerequisites | Run on workflow-start SHA before version mutation | Original SHA is tested |
| Version bump | Mutates four package/lock files after prerequisites | Creates a different source tree |
| Release commit | Direct admin-token push with [skip ci] | New commit bypasses normal gate |
| Image metadata | Uses pre-bump prepare-release git_sha | Image/release commit identity can diverge |
| Combined status for baseline | No entries returned | No baseline CI evidence was available. |
| Workflow runs for baseline | No entries returned by available connector query | No baseline CI evidence was available. |
| Check suites/check runs/logs/artifacts | Unavailable | No conclusion |
| Rulesets/required checks/merge queue/admin bypass | Unavailable | P7-010 remains design risk DR-17 |

# Appendix E - Numerical-example index

| Finding | Severity | Numerical example |
| --- | --- | --- |
| MON-H03 | HIGH | Input: one source expense of `-100.00`. Implementation result after two accepted jobs: two rows and a `-200.00` balance effect. Expected: one row and `-100.00`. Difference: `-100.00`. |
| MON-H04 | HIGH | Input: one source transaction of `-25.00`. Implementation result after post-commit crash and retry: `-50.00`. Expected: `-25.00`. Difference: `-25.00`. |
| MON-H05 | HIGH | Example A — concurrent updates: - Opening balance: `100.00`; old transaction: `-10.00`; stored balance: `90.00`. - Final ledger row: `-30.00`. - Implementation result: `60.00`. - Expected: `70.00`. - Difference: `-10.00`.  Example B — double delete: - Implementation result after two stale reversals: `110.00`. - Expected after removing one `-10.00` row: `100.00`. - Difference: `+10.00`. |
| MON-H06 | HIGH | Input: balance `100.00`; one due expense `-50.00`. Implementation result after two posters: `0.00`. Expected after one occurrence: `50.00`. Difference: `-50.00`. |
| MON-H07 | HIGH | Recompute snapshot: `100.00`; concurrent committed expense: `-20.00`. Implementation result: recompute writes `100.00`. Expected: `80.00`. Difference: `+20.00`. |
| MON-H08 | HIGH | Starting holding: `10` shares at `$100.00` (`$1,000.00` basis). Concurrent buys: `1` and `2` shares at `$100.00`. Implementation result: `12` shares, `$1,200.00` basis. Expected: `13` shares, `$1,300.00` basis. Difference: `-1` share, `-$100.00`, `-7.69%` of expected quantity/basis. |
| MON-H10 | HIGH | Initial balances: source `1,000.00`, destination `1,000.00`. Active transfer: `100.00` -> balances `900.00` and `1,100.00`. Implementation result after marking both legs VOID without deltas: still `900.00` and `1,100.00`. Expected: `1,000.00` and `1,000.00`. Differences: source `-100.00`; destination `+100.00`. |
| MON-H11 | HIGH | Source: `100.00`; authoritative rate: `1.3500` destination units per source unit. Expected destination: `135.00`. Tampered client destination accepted by the current contract: `999.99`. Difference: `+864.99` destination-currency units. |
| MON-H12 | HIGH | Input: `100.00 USD`; destination `CAD`; rate unavailable. Implementation result: a complete-looking `100.00 CAD` (or equivalent total using rate 1). Expected at the time of calculation: unavailable/partial, not a number. At a later valid rate of `1.3500`, the correct amount would be `135.00 CAD`. Difference from the false numeric result: `-35.00 CAD` (`-25.93%` of the correct value). |
| MON-H13 | HIGH | Starting shares: `90`; split ratio: `2.0`. Implementation result: `92` shares. Expected: `180` shares. Difference: `-88` shares (`-48.89%`). |
| MON-H14 | HIGH | Trade source value: `1,000.00 USD`; frontend has no rate and previews `1,000.00 CAD` using 1:1. Backend resolves `1.3500` and commits `1,350.00 CAD`. Difference between approved preview and committed cash effect: `+350.00 CAD` (`+35.00%` of the preview). |
| MON-H15 | HIGH | Stored override price: `250.00`; latest quote: `123.45`. User edits only description/date. Implementation result saved: `123.45`. Expected: `250.00`. Difference: `-126.55` per share (`-50.62%`). |
| MON-H16 | HIGH | Example A — request failure: - Cash: `20,000.00`; brokerage market value: `100,000.00`. - Implementation display after portfolio request failure: `20,000.00`. - Expected: unavailable/partial (complete value would be `120,000.00`). - Numeric omission: `-100,000.00` (`-83.33%`).  Example B — one unpriced holding: - Priced holdings: `100,000.00`; omitted holding if priced: `50,000.00`. - Implementation total: `100,000.00` shown as complete. - Complete value: `150,000.00`. - Difference: `-50,000.00` (`-33.33%`). |
| MON-M20 | MEDIUM | Initial: open account `0.00`; existing `-10.00` transaction is VOID. Implementation result after close/unvoid interleaving: closed account `-10.00`. Expected: close rejected or mutation rejected, with any closed balance `0.00`. Difference: `-10.00`. |
| MON-M21 | MEDIUM | Parent: `-100.00`; existing splits: `-60.00`. Concurrent additions: `-30.00` and `-30.00`. Implementation result: `-120.00`. Expected maximum: `-100.00`. Difference: `-20.00`. |
| MON-M25 | MEDIUM | Illustrative one-window provider cost: expected `$0.02`; two replicas produce `$0.04`. Difference: `+$0.02` (`+100%`). Actual provider pricing is deployment-dependent; the duplicate-call root is not. |
| MON-M27 | MEDIUM | USD account; submitted primary amount `100.00` labelled CAD; valid rate `1 USD = 1.3500 CAD`. Implementation can increase the USD balance by `100.0000` while the row says CAD. Converted value would be `74.0741 USD` (or the request should be rejected). Numeric overstatement relative to conversion: `+25.9259 USD` (`+35.00%`). |
| MON-M28 | MEDIUM | Parent expense: `-100.00`; children: `+50.00` and `-150.00`. Implementation result: accepted because sum is `-100.00`. Expected: reject. Financial distortion inside categories: `+50.00` phantom income and `+50.00` excess expense. |
| MON-M29 | MEDIUM | BUY source value: `1,000.00 USD`; funding account CAD; explicit rate `0`; valid rate would be `1.3500`. Implementation stores rate `0` but cash fallback posts `-1,000.00 CAD`. Expected: reject; at the valid rate the debit would be `-1,350.00 CAD`. Difference from the valid cash effect: `+350.00 CAD` (under-debit of `25.93%`). |
| MON-M30 | MEDIUM | BUY `10` shares at `20.00`; commission `5.00`. Implementation basis: `200.00`; basis/share: `20.00`. Expected basis: `205.00`; basis/share: `20.50`. Differences: `-5.00` total and `-0.50` per share. |
| MON-M31 | MEDIUM | Parent expense: `-100.00`; category child: `-60.00`; transfer child: `-40.00`. Implementation budget spending: `60.00`. Expected: `100.00` under the supported categorized-transfer model. Difference: `-40.00` (`-40%`). |
| MON-M32 | MEDIUM | Regular parent payment: `-100.00`; remaining principal: `40.00`; interest: `0.00`. Implementation recalculated split total: `-40.00` while parent remains `-100.00`. Expected parent and split total: `-40.00`. Difference in parent amount: `-60.00`. |
| MON-M33 | MEDIUM | Actual portfolio: `100,000.00`. Implementation value after valuation failure: `0.00`. Expected: unavailable/error or an explicit user override, not zero. Numeric difference from actual value: `-100,000.00` (`-100%`). |
| MON-M34 | MEDIUM | Transfer contribution to destination snapshot: `+100.00`. After bulk deletion, implementation can leave the destination snapshot overstated by `100.00`. Expected adjustment: `-100.00` to remove the deleted transfer. Difference: `+100.00` stale value. |
| MON-M35 | MEDIUM | Transferred native basis: `200.00 USD`; preserved account-currency basis at rate `1.3500`: `270.00 CAD`. Implementation destination basis: `200.00 CAD`. Expected: `270.00 CAD`. Difference: `-70.00 CAD` (`-25.93%`). |
| MON-M37 | MEDIUM | Exact children: `-3.3333 - 3.3333 - 3.3334 = -10.0000`. A two-decimal edit can produce `-3.33 - 3.33 - 3.33 = -9.99`. Expected: preserve `-10.0000` or require explicit remainder allocation. Difference: `+0.0100`. |
| MON-M38 | MEDIUM | Budget: `100.00`; cached spent: `0.00`; new categorized expense: `20.00`. Implementation can continue to show remaining `100.00`. Expected remaining: `80.00`. Difference: `+20.00` overstated remaining budget. |

# Appendix F - Path and line reference index

| Fixed-SHA path / range | Canonical finding IDs |
| --- | --- |
| .claude/skills/backend.md:1-260 | MON-M02 |
| .github/workflows/ci.yml:1-260 | MON-M44 |
| .github/workflows/ci.yml:1-820 | MON-L07 |
| .github/workflows/ci.yml:360-820 | MON-M45 |
| CLAUDE.md:1-280 | MON-M02 |
| CLAUDE.md:1-300 | MON-L07 |
| CONTRIBUTING.md:1-340 | MON-M02 |
| README.md:1-260 | MON-M01 |
| backend/CLAUDE.md:1-260 | MON-M02, MON-L07 |
| backend/docker-entrypoint.sh:1-220 | MON-L02 |
| backend/package.json:1-180 | MON-M44, MON-L07 |
| backend/src/accounts/accounts.service.ts:1560-1720 | MON-M34 |
| backend/src/accounts/accounts.service.ts:812-1018 | MON-M20 |
| backend/src/accounts/accounts.service.ts:930-1085 | MON-H05 |
| backend/src/accounts/accounts.service.ts:930-1085,1560-1720 | MON-H07 |
| backend/src/accounts/entities/account.entity.ts:1-260 | MON-M27 |
| backend/src/accounts/entities/account.entity.ts:1-420 | MON-M08 |
| backend/src/accounts/mortgage-reminder.service.ts:1-190 | MON-L06 |
| backend/src/ai/insights/ai-insights.service.spec.ts:1-820 | MON-M25 |
| backend/src/ai/insights/ai-insights.service.ts:104-270,650-735 | MON-M25 |
| backend/src/attachments/attachments.service.spec.ts:1-860 | MON-M47 |
| backend/src/attachments/attachments.service.ts:20-125 | MON-L05 |
| backend/src/attachments/attachments.service.ts:45-190 | MON-M22 |
| backend/src/attachments/storage/database-storage.provider.ts:1-180 | MON-M22 |
| backend/src/attachments/storage/database-storage.provider.ts:1-200 | MON-H02 |
| backend/src/attachments/storage/local-storage.provider.spec.ts:1-520 | MON-M47 |
| backend/src/attachments/storage/local-storage.provider.ts:1-180 | MON-M22 |
| backend/src/attachments/storage/local-storage.provider.ts:1-220 | MON-H02 |
| backend/src/attachments/storage/s3-storage.provider.spec.ts:1-520 | MON-M47 |
| backend/src/attachments/storage/s3-storage.provider.ts:1-220 | MON-M22 |
| backend/src/attachments/storage/s3-storage.provider.ts:1-240 | MON-H02 |
| backend/src/auth/auth.controller.ts:850-1300 | MON-M36 |
| backend/src/auth/auth.service.spec.ts:1-900 | MON-M24 |
| backend/src/auth/auth.service.ts:318-410 | MON-M24 |
| backend/src/auth/dto/create-pat.dto.ts:1-100 | MON-L01 |
| backend/src/auth/entities/personal-access-token.entity.ts:1-160 | MON-L01 |
| backend/src/auth/jwt.strategy.ts:120-260 | MON-M03, MON-M07 |
| backend/src/auth/pat.service.ts:35-95 | MON-L01 |
| backend/src/auth/token.service.spec.ts:1-920 | MON-M23 |
| backend/src/auth/token.service.ts:100-275 | MON-H09 |
| backend/src/auth/token.service.ts:110-248 | MON-M23 |
| backend/src/backup/auto-backup.service.spec.ts:430-780 | MON-H01, MON-M43 |
| backend/src/backup/auto-backup.service.ts:1-220 | MON-M10, MON-M11 |
| backend/src/backup/auto-backup.service.ts:1-220,280-600 | MON-H01 |
| backend/src/backup/auto-backup.service.ts:1-600 | MON-M43 |
| backend/src/backup/auto-backup.service.ts:280-600 | MON-M09 |
| backend/src/backup/backup-id-remap.util.ts:1-240 | MON-H02 |
| backend/src/backup/backup.controller.ts:1-420 | MON-M10, MON-M13, MON-M16 |
| backend/src/backup/backup.controller.ts:220-390 | MON-M05 |
| backend/src/backup/backup.service.ts:1-1180 | MON-M13 |
| backend/src/backup/backup.service.ts:1-420 | MON-M09 |
| backend/src/backup/backup.service.ts:1-420,1180-1600 | MON-M16 |
| backend/src/backup/backup.service.ts:1180-1900 | MON-M08 |
| backend/src/backup/backup.service.ts:220-1035 | MON-M47 |
| backend/src/backup/backup.service.ts:300-1180 | MON-M12 |
| backend/src/backup/backup.service.ts:300-2010 | MON-M17 |
| backend/src/backup/backup.service.ts:300-760,820-2010 | MON-H02 |
| backend/src/backup/support-backup/support-backup-rules.ts:1-420 | MON-M18 |
| backend/src/backup/support-backup/support-backup.service.ts:1-420 | MON-M18 |
| backend/src/budgets/budget-alert.service.ts:203-390,500-690 | MON-L03 |
| backend/src/budgets/budget-calculation.service.ts:120-620 | MON-M31 |
| backend/src/budgets/budget-period.service.ts:180-620 | MON-M31 |
| backend/src/budgets/entities/budget-alert.entity.ts:1-300 | MON-L03 |
| backend/src/common/db/app-role.ts:1-420 | MON-M14 |
| backend/src/common/db/scoped-db.ts:1-260 | MON-M12, MON-M14 |
| backend/src/common/interceptors/request-context.interceptor.ts:55-145 | MON-M07 |
| backend/src/currencies/currencies.service.ts:1-760 | MON-M17 |
| backend/src/currencies/currencies.service.ts:1-900 | MON-M19 |
| backend/src/db-init.ts:1-360 | MON-M14, MON-L02 |
| backend/src/db-migrate.ts:1-360 | MON-M15, MON-L02 |
| backend/src/delegation/delegation.service.ts:520-940 | MON-M06 |
| backend/src/delegation/delegation.service.ts:940-1120 | MON-M06 |
| backend/src/emergency-access/emergency-access-claim.controller.spec.ts:1-260 | MON-H09 |
| backend/src/emergency-access/emergency-access-claim.controller.spec.ts:1-880 | MON-M46 |
| backend/src/emergency-access/emergency-access-claim.controller.ts:150-370 | MON-H09 |
| backend/src/emergency-access/emergency-access-monitor.service.spec.ts:1-780 | MON-M26 |
| backend/src/emergency-access/emergency-access-monitor.service.ts:60-250 | MON-M07, MON-M26 |
| backend/src/emergency-access/entities/emergency-access-contact.entity.ts:1-240 | MON-H09 |
| backend/src/import/import-post-processing.service.ts:1-140 | MON-H07 |
| backend/src/import/mny/map/map-transactions.ts:430-550 | MON-H04 |
| backend/src/import/mny/mny-import-job.service.ts:145-350 | MON-H04 |
| backend/src/import/mny/mny-import-job.service.ts:60-370 | MON-H03 |
| backend/src/import/mny/mny-import.controller.ts:140-210 | MON-H03 |
| backend/src/import/mny/mny-import.service.ts:102-230 | MON-L04 |
| backend/src/import/mny/mny-import.service.ts:196-330,370-570 | MON-H04 |
| backend/src/import/mny/mny-import.service.ts:60-250 | MON-H03 |
| backend/src/import/mny/mny-staging.service.ts:103-178 | MON-H04 |
| backend/src/import/mny/mny-staging.service.ts:80-220 | MON-L04 |
| backend/src/mcp/CLAUDE.md:1-80 | MON-M04 |
| backend/src/mcp/CLAUDE.md:175-215 | MON-L01 |
| backend/src/mcp/mcp-context.ts:1-180 | MON-M04 |
| backend/src/mcp/mcp-http.controller.ts:230-360 | MON-M04 |
| backend/src/mcp/mcp-http.controller.ts:45-230 | MON-M04 |
| backend/src/monte-carlo/monte-carlo.service.ts:120-720 | MON-M33 |
| backend/src/net-worth/net-worth.service.spec.ts:280-580 | MON-H13 |
| backend/src/net-worth/net-worth.service.spec.ts:300-560 | MON-M41 |
| backend/src/net-worth/net-worth.service.ts:1-1150 | MON-M34 |
| backend/src/net-worth/net-worth.service.ts:600-1150 | MON-H13, MON-M41 |
| backend/src/notifications/bill-reminder.service.ts:1-170 | MON-L06 |
| backend/src/scheduled-transactions/entities/scheduled-transaction.entity.ts:1-430 | MON-H06 |
| backend/src/scheduled-transactions/scheduled-transaction-loan.service.spec.ts:1-1200 | MON-M32 |
| backend/src/scheduled-transactions/scheduled-transaction-loan.service.ts:1-260 | MON-M32 |
| backend/src/scheduled-transactions/scheduled-transactions.service.spec.ts:1-1100 | MON-H06 |
| backend/src/scheduled-transactions/scheduled-transactions.service.spec.ts:1-2700 | MON-M46 |
| backend/src/scheduled-transactions/scheduled-transactions.service.ts:1080-1435 | MON-H11, MON-M32 |
| backend/src/scheduled-transactions/scheduled-transactions.service.ts:120-310,1080-1435 | MON-H06 |
| backend/src/securities/dto/create-investment-transaction.dto.ts:1-260 | MON-M29 |
| backend/src/securities/entities/holding.entity.ts:1-150 | MON-H08 |
| backend/src/securities/holdings.service.spec.ts:1-1200 | MON-M46 |
| backend/src/securities/holdings.service.spec.ts:1-260 | MON-H08 |
| backend/src/securities/holdings.service.ts:180-450 | MON-H13 |
| backend/src/securities/holdings.service.ts:180-450,560-930 | MON-H08 |
| backend/src/securities/holdings.service.ts:200-420 | MON-M30 |
| backend/src/securities/holdings.service.ts:200-500 | MON-M35 |
| backend/src/securities/investment-transactions.service.ts:320-760 | MON-H14, MON-M29 |
| backend/src/securities/investment-transactions.service.ts:520-980 | MON-M30 |
| backend/src/securities/investment-transactions.service.ts:860-1700 | MON-H08 |
| backend/src/securities/investment-transactions.service.ts:980-1500 | MON-M35 |
| backend/src/securities/portfolio-calculation.service.ts:1-420 | MON-H12 |
| backend/src/securities/portfolio-calculation.service.ts:1020-1325 | MON-H16 |
| backend/src/securities/portfolio-calculation.service.ts:500-900 | MON-M35 |
| backend/src/securities/portfolio-calculation.service.ts:560-760 | MON-M30 |
| backend/src/securities/portfolio.service.spec.ts:730-890 | MON-H12 |
| backend/src/securities/portfolio.service.spec.ts:760-850 | MON-M39 |
| backend/src/securities/portfolio.service.ts:340-760 | MON-H12 |
| backend/src/transactions/dto/create-transaction.dto.ts:1-220 | MON-M27 |
| backend/src/transactions/dto/create-transfer.dto.ts:1-180 | MON-H11 |
| backend/src/transactions/dto/transaction-split.dto.ts:1-180 | MON-M28 |
| backend/src/transactions/entities/transaction-split.entity.ts:1-180 | MON-M31 |
| backend/src/transactions/entities/transaction.entity.ts:1-260 | MON-M27 |
| backend/src/transactions/transaction-bulk-update.service.ts:100-700 | MON-H05 |
| backend/src/transactions/transaction-bulk-update.service.ts:120-700 | MON-M34 |
| backend/src/transactions/transaction-bulk-update.service.ts:400-700 | MON-H10 |
| backend/src/transactions/transaction-reconciliation.service.ts:1-130 | MON-H05, MON-H10 |
| backend/src/transactions/transaction-reconciliation.service.ts:24-86 | MON-M20 |
| backend/src/transactions/transaction-split.service.spec.ts:1-920 | MON-M21 |
| backend/src/transactions/transaction-split.service.ts:120-480 | MON-M28, MON-M37 |
| backend/src/transactions/transaction-split.service.ts:120-620 | MON-M31 |
| backend/src/transactions/transaction-split.service.ts:180-480 | MON-H11 |
| backend/src/transactions/transaction-split.service.ts:480-620 | MON-M21 |
| backend/src/transactions/transaction-transfer.service.ts:340-1235 | MON-H05 |
| backend/src/transactions/transaction-transfer.service.ts:680-930 | MON-H10 |
| backend/src/transactions/transaction-transfer.service.ts:90-285 | MON-H11 |
| backend/src/transactions/transactions.service.ts:1880-2310 | MON-H05 |
| backend/src/transactions/transactions.service.ts:1900-2178 | MON-M20 |
| backend/src/transactions/transactions.service.ts:315-490 | MON-H07 |
| backend/src/transactions/transactions.service.ts:315-650 | MON-M27 |
| backend/src/users/dto/delete-account.dto.ts:1-100 | MON-M05 |
| backend/src/users/entities/user.entity.ts:1-260 | MON-M03 |
| backend/src/users/users.controller.ts:31-50 | MON-M03 |
| backend/src/users/users.service.ts:330-430 | MON-M05 |
| backend/src/users/users.service.ts:45-85 | MON-M03 |
| backend/test/integration/backup-restore.integration.spec.ts:1-1000 | MON-M47 |
| backend/test/integration/investment-transactions.integration.spec.ts:1-900 | MON-H08, MON-M46 |
| backend/test/integration/mny-import-job.integration.spec.ts:1-360 | MON-H03 |
| backend/test/integration/mny-import-job.integration.spec.ts:1-420 | MON-M46 |
| backend/test/integration/rls-enforcement.integration.spec.ts:1-1200 | MON-M06 |
| backend/test/integration/support-backup.integration.spec.ts:1-1100 | MON-M18 |
| backend/test/integration/transactions.integration.spec.ts:1-700 | MON-H05, MON-M46 |
| backend/test/integration/transfers.integration.spec.ts:1-760 | MON-H11, MON-M46 |
| database/migrations/018_user_currency_preferences.sql:1-220 | MON-M17, MON-M19 |
| database/migrations/076_users_last_activity_at.sql:1-40 | MON-M07 |
| database/migrations/109_transaction_attachments.sql:1-55 | MON-M22 |
| database/migrations/109_transaction_attachments.sql:12-40 | MON-L05 |
| database/migrations/112_rls_policies_direct.sql:1-320 | MON-M06 |
| database/migrations/114_rls_policies_special.sql:1-300 | MON-M06 |
| database/migrations/117_mny_import_staging_and_jobs.sql:1-102 | MON-L04 |
| database/migrations/117_mny_import_staging_and_jobs.sql:1-140 | MON-H03 |
| database/migrations/123_rls_enable.sql:1-260 | MON-M15 |
| database/schema.sql:1-2005 | MON-M15, MON-M19 |
| database/schema.sql:180-300 | MON-M08 |
| database/schema.sql:300-325 | MON-M21, MON-M37 |
| database/schema.sql:380-525 | MON-H06 |
| docker-compose.prod.yml:1-240 | MON-H01, MON-M01, MON-M10 |
| docs/cron-jobs.md:1-24 | MON-M25, MON-M26, MON-L06 |
| docs/cron-jobs.md:1-90 | MON-H06 |
| docs/database-migrations.md:1-420 | MON-L07 |
| docs/future-plans/row-level-security-runbook.md:1-420 | MON-M14 |
| frontend/src/app/accounts/page.tsx:35-180 | MON-H16 |
| frontend/src/app/budgets/page.tsx:1-620 | MON-M38 |
| frontend/src/components/investments/InvestmentTransactionForm.tsx:1-900 | MON-H14, MON-M29 |
| frontend/src/components/investments/InvestmentTransactionForm.tsx:330-900 | MON-M35 |
| frontend/src/components/investments/InvestmentTransactionForm.tsx:570-790 | MON-M30 |
| frontend/src/components/investments/PortfolioSummaryCard.tsx:40-290 | MON-H16 |
| frontend/src/components/layout/AppHeader.test.tsx:70-155 | MON-M36 |
| frontend/src/components/layout/AppHeader.test.tsx:90-130 | MON-M42 |
| frontend/src/components/layout/AppHeader.tsx:1-300 | MON-M36, MON-M42 |
| frontend/src/components/reports/MonteCarloReport.tsx:1-620 | MON-M33 |
| frontend/src/components/reports/useMonteCarloScenarios.ts:1-420 | MON-M33 |
| frontend/src/components/scheduled-transactions/OverrideEditorDialog.test.tsx:450-710 | MON-H15 |
| frontend/src/components/scheduled-transactions/OverrideEditorDialog.test.tsx:480-680 | MON-M40 |
| frontend/src/components/scheduled-transactions/OverrideEditorDialog.tsx:1-400 | MON-H15, MON-M40 |
| frontend/src/components/settings/DataManagement.tsx:350-760 | MON-M05 |
| frontend/src/components/settings/PersonalAccessTokens.tsx:1-420 | MON-L01 |
| frontend/src/components/settings/SupportBackupDialog.tsx:1-420 | MON-M18 |
| frontend/src/components/transactions/BulkUpdateModal.tsx:35-220 | MON-H10 |
| frontend/src/components/transactions/SplitTransactionEditor.tsx:1-620 | MON-M28, MON-M37 |
| frontend/src/components/transactions/TransactionForm.tsx:300-620 | MON-H11 |
| frontend/src/components/transactions/TransactionForm.tsx:900-1060 | MON-H10 |
| frontend/src/components/ui/CurrencyInput.tsx:1-360 | MON-M37 |
| frontend/src/hooks/useExchangeRates.test.ts:80-205 | MON-H12 |
| frontend/src/hooks/useExchangeRates.test.ts:90-190 | MON-M39 |
| frontend/src/hooks/useExchangeRates.ts:1-260 | MON-H12 |
| frontend/src/hooks/useTransactionSelection.ts:1-210 | MON-H10 |
| frontend/src/i18n/messages/en/investments.json:1-500 | MON-M30 |
| frontend/src/i18n/messages/en/settings.json:1-520 | MON-M18 |
| frontend/src/lib/apiCache.ts:1-320 | MON-M38 |
| frontend/src/lib/auth.ts:1-260 | MON-M36 |
| frontend/src/lib/backup.ts:1-260 | MON-M05 |
| frontend/src/lib/balance-cache.guard.test.ts:1-420 | MON-M38 |
| frontend/src/lib/budgets.ts:1-420 | MON-M38 |
| frontend/src/lib/monte-carlo.ts:1-260 | MON-M33 |
| frontend/src/lib/transactions.ts:1-320 | MON-M28 |
| frontend/src/lib/transactions.ts:1-420 | MON-M38 |
| frontend/src/store/authStore.ts:1-300 | MON-M36 |
| frontend/src/types/investment.ts:1-340 | MON-H16 |
| helm/README.md:1-320 | MON-M01, MON-M11 |
| helm/templates/statefulset-backend.yaml:1-220 | MON-M01, MON-M11, MON-L02 |
| helm/templates/statefulset-backend.yaml:1-35 | MON-L06 |
| helm/values.yaml:1-260 | MON-H01 |
| helm/values.yaml:1-300 | MON-M01, MON-M11 |

---

End of report. Audited baseline: `d5cea9bfa995885ba5198f9843359362927c0fd4`.
