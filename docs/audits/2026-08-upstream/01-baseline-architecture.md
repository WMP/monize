# Monize Full Audit - Phase 1: Baseline, Repository Instructions, and Architecture

**Repository:** `kenlasko/monize`  
**Audit date:** 2026-08-01  
**Phase:** 1 of 8  
**Status:** Complete  
**Audit mode:** Read-only  
**AUDIT_BASELINE_SHA:** `d5cea9bfa995885ba5198f9843359362927c0fd4`

## Finding summary

| Severity | Confirmed findings |
|---|---:|
| BLOCKER | 0 |
| HIGH | 1 |
| MEDIUM | 2 |
| LOW | 1 |
| **Total** | **4** |

The baseline was established successfully and all technical evidence used in this report was fetched from the exact commit above. Later phases must continue to audit this SHA and must not silently follow a newer `main`.

---

## 1. Phase scope

This phase established the immutable audit baseline, reconstructed the repository instruction hierarchy, and produced an architectural map suitable for the later security, database, concurrency, financial-correctness, frontend-contract, and test/CI phases.

The phase covered:

- the current `main` commit at audit start and the immutable audit SHA;
- repository-wide and subtree-specific instruction files;
- primary development, security, database, RLS, backup, restore, testing, deployment, and import documentation;
- top-level repository structure;
- backend module boundaries and cross-cutting infrastructure;
- frontend routing, API integration, state, and contract organization;
- schema and migration organization;
- request-scoped database access and PostgreSQL RLS architecture;
- ordinary backup, restore, automatic backup, and support-backup architecture;
- test frameworks, CI workflows, and available status evidence;
- representative controller-to-database and backend-to-frontend flows;
- high-risk areas and exact handoff targets for Phase 2.

This was intentionally not an exhaustive general code review. Implementation reads were selected to establish architecture, verify documentation, trace representative cross-layer paths, and confirm material defects encountered during mapping.

---

## 2. Audited baseline SHA

### 2.1 Baseline

`AUDIT_BASELINE_SHA = d5cea9bfa995885ba5198f9843359362927c0fd4`

### 2.2 Establishment procedure

The baseline was established before substantive implementation review by:

1. resolving the repository and its default branch;
2. identifying the current commit at the tip of `main`;
3. fetching the commit object for `d5cea9bfa995885ba5198f9843359362927c0fd4`;
4. comparing that SHA to `main` and confirming no difference at baseline time;
5. re-fetching all evidence used in this report with `ref=d5cea9bfa995885ba5198f9843359362927c0fd4`.

A short README probe was made against the branch ref during baseline verification and was not used as audit evidence. The README and every other file cited below were subsequently fetched from the immutable SHA.

### 2.3 Pinning rule for later phases

Every later phase must use:

```text
ref=d5cea9bfa995885ba5198f9843359362927c0fd4
```

Later phases must not re-resolve `main` and substitute a newer revision. If the Phase 1 report is the only available project context, this SHA is the authoritative baseline.

### 2.4 Commit and CI context

The baseline is the merge commit for PR #1016. The merge commit itself had no workflow-run or commit-status records returned by the GitHub connector. The PR head SHA, `4c0101de9ee848de4889d1841d8d5785cdc94fa3`, did have successful CI, Lighthouse, and PR-checklist runs. This is useful evidence about the merged content, but it is not identical to a successful run attached to the merge commit. The limitation is preserved in the audit ledger and must not be represented as a green baseline-SHA run.

---

## 3. Method

### 3.1 Repository access

The audit used the authenticated GitHub connector in read-only mode. A local clone was attempted but the execution environment could not resolve GitHub network endpoints. No branch, commit, pull request, review, label, issue, or repository setting was modified.

The connector supported reliable file reads pinned to a commit SHA. It did not provide a complete recursive tree as a single operation, and repository search responses were sometimes capped or truncated. Directory discovery therefore combined:

- pinned file reads;
- pinned search-result URLs;
- root and package documentation;
- module registration files;
- workflow and manifest references;
- targeted path existence checks.

### 3.2 Instruction-first review

Before implementation tracing, the audit searched for and read:

- every discovered `CLAUDE.md`;
- every discovered `AGENTS.md` (none were present);
- `.claude/settings.json`;
- all files under `.claude/skills/`;
- `README.md`;
- `CONTRIBUTING.md`;
- `SECURITY.md`;
- relevant root, `docs/`, package, import, release, E2E, and Helm documentation.

Instruction scope was applied by path: root instructions apply globally, subtree instructions override within their subtree, and `backend/src/mcp/CLAUDE.md` is the most specific instruction file for the MCP implementation.

### 3.3 Architectural tracing

Representative paths were traced across layers rather than reviewing isolated files. The principal traces were:

- authenticated browser request -> frontend proxy -> backend guards/interceptors -> request context -> service -> `withScopedDb` -> RLS policy;
- frontend transaction contract -> transaction controller -> service validation -> transaction/split/tag writes -> account balance update;
- `.mny` upload -> parse/decrypt -> database staging -> background job -> mapping/writers -> verification -> polling UI;
- backup export/restore -> encryption/compression -> validation -> ID remapping -> transactional restore;
- support-backup request -> scope calculation -> allowlist/de-identification -> integrity scrub -> mandatory encryption;
- PAT/OAuth bearer authentication -> scope guard -> MCP session -> shared domain services.

### 3.4 Finding standard

A defect was reported only when a realistic failure scenario was supported by implementation, schema, documentation, or test evidence at the baseline SHA. Cosmetic preferences and generic best practices were excluded.

Each confirmed finding includes severity, confidence, exact paths and line ranges, the violated invariant, a realistic reproduction, impact, correction, regression test, and verification method.

### 3.5 Execution limits

No repository test suite, migration, container, Helm render, or application runtime was executed locally because the source tree could not be cloned into the execution environment. Existing CI metadata and workflow definitions were inspected instead. This phase therefore confirms static defects and architecture, not runtime behavior beyond what can be proven from the repository and recorded CI evidence.

---

## 4. Repository instruction hierarchy

### 4.1 Applicable instruction files

| Priority | Scope | File | Status |
|---:|---|---|---|
| 1 | Repository-wide | `CLAUDE.md` | Current primary instruction source |
| 2 | Backend subtree | `backend/CLAUDE.md` | Applies under `backend/` |
| 2 | Frontend subtree | `frontend/CLAUDE.md` | Applies under `frontend/` |
| 2 | Database subtree | `database/CLAUDE.md` | Applies under `database/` |
| 3 | MCP subtree | `backend/src/mcp/CLAUDE.md` | Most specific MCP instructions |
| Auxiliary | Tool/agent guidance | `.claude/skills/backend.md` | Present but partially stale |
| Auxiliary | Tool/agent guidance | `.claude/skills/frontend.md` | Present; some version drift |
| Auxiliary | Tool/agent guidance | `.claude/skills/infrastructure.md` | Materially stale |
| Auxiliary | Claude configuration | `.claude/settings.json` | Security-guidance plugin only |
| Contributor guidance | Repository-wide | `CONTRIBUTING.md` | Partially contradicts current DB rule |
| Security reporting | Repository-wide | `SECURITY.md` | Reporting policy, not coding architecture |

No `AGENTS.md` file was found. No additional generic `instructions.md` file was found.

### 4.2 Precedence applied

The effective hierarchy used by this audit was:

1. the root `CLAUDE.md` for repository-wide invariants;
2. the closest subtree `CLAUDE.md` for layer-specific conventions;
3. the MCP-specific `CLAUDE.md` inside `backend/src/mcp/`;
4. contributor and architecture documentation when it does not conflict with the instruction files;
5. `.claude/skills/*` as auxiliary context only, because those files are not declared by the root instruction file and contain demonstrably stale examples.

### 4.3 Core current invariants

The current instruction set establishes the following material invariants:

- all production database access goes through `backend/src/common/db/scoped-db.ts`;
- services obtain repositories from the scoped transaction `EntityManager`;
- production source must not inject repositories or create manual `QueryRunner`s;
- imports of `with-context` are reviewed through an explicit ESLint allowlist because system context bypasses RLS;
- migrations and `database/schema.sql` must be updated together;
- any newly exported support-backup column must be explicitly classified;
- controllers are thin, user identity comes from authentication context, and service methods enforce ownership;
- frontend API traffic goes through the central client and proxy, with CSRF/refresh handling and cache invalidation;
- MCP tools reuse domain services, enforce scopes, and declare schemas and annotations.

### 4.4 Confirmed instruction/documentation contradictions

The following contradictions were confirmed and are formal findings below:

- `CONTRIBUTING.md` still mandates `QueryRunner` transactions while current root instructions and ESLint prohibit them;
- `.claude/skills/backend.md` demonstrates direct repository use and `DataSource.transaction`, bypassing the single scoped-DB door;
- the VAT plan proposes both a `QueryRunner` and a `reports` MCP scope that the current PAT API cannot issue;
- root and auxiliary infrastructure documentation points to non-existent Compose, Helm, and schema paths or incorrect defaults;
- `database/schema.sql` documents a `reports` PAT scope while the DTO accepts only `read` and `write`.

---

## 5. Architectural baseline

### 5.1 Repository structure

| Path | Architectural role |
|---|---|
| `.claude/` | Agent/tool instructions and settings |
| `.github/workflows/` | CI, security scanning, Lighthouse, image maintenance, and PR policy automation |
| `.husky/` | Local Git hooks |
| `backend/` | NestJS API, background schedules, domain services, migrations bootstrap, imports, backup, MCP/OAuth |
| `database/` | Fresh-install schema and ordered SQL migrations |
| `docs/` | Operational documentation, release notes, data-model notes, and future plans |
| `e2e/` | Playwright browser tests and roadmap |
| `frontend/` | Next.js App Router application, proxy, API clients, state, i18n, UI tests |
| `helm/` | Kubernetes chart, values, and templates |
| `scripts/` | Repository-level verification and maintenance scripts |
| `docker-compose.dev.yml` | Development stack |
| `docker-compose.prod.yml` | Production Compose stack |
| `docker-compose.demo.yml` | Demo deployment |
| `docker-compose.e2e.yml` | E2E environment |
| `docker-compose.zap.yml` | ZAP environment |

There is no tracked root `docker-compose.yml` at the audited SHA.

### 5.2 Runtime topology

The primary deployment topology is:

```text
Browser
  -> Next.js frontend (public)
      -> server-side proxy for /api/v1, OAuth, well-known, and MCP routes
          -> NestJS backend (internal in Helm; directly mapped in Compose)
              -> PostgreSQL 16
```

The browser primarily uses cookie authentication through the frontend origin. PAT, OAuth, and MCP use bearer authentication. The backend keeps separate CORS and CSRF assumptions for cookie and bearer surfaces.

Compose development defaults map the frontend to host port 3001 and the backend to host port 3000. Internally, the frontend reaches the backend at `http://backend:3000`. The Helm chart exposes only the frontend and keeps the backend on an internal `ClusterIP` service.

### 5.3 Backend stack and bootstrap

The backend is a NestJS 11 / TypeScript / TypeORM application using PostgreSQL. `backend/src/app.module.ts` centrally registers domain modules and global infrastructure. `backend/src/main.ts` configures:

- PostgreSQL date parsing that preserves date-only values as strings;
- global DTO validation and transformation;
- cookies, Helmet, CORS, and API prefixing;
- CSRF-aware cookie routes and bearer-oriented OAuth/MCP routes;
- Swagger in non-production environments;
- request timeouts and a large raw body path for backup restore;
- port and public URL behavior.

TypeORM `synchronize` is not the schema-management mechanism. Fresh installation and incremental upgrade are handled by `db-init` and `db-migrate`.

### 5.4 Backend module map

`backend/src/app.module.ts` registers the following functional groups.

#### Identity, authorization, and access

- `auth`: local login, JWT, refresh rotation, PATs, OIDC integration, 2FA, trusted devices, password flows;
- `users`: user profile, preferences, destructive data operations;
- `admin`: administrative user management;
- `delegation`: owner/delegate context and capability handling;
- `emergency-access`: emergency-access grants and claim monitoring;
- `oauth`: OAuth 2.1 provider flows for external clients;
- `mcp`: Streamable HTTP MCP server, sessions, tools, resources, and prompts.

#### Core personal-finance domains

- `accounts`: account CRUD, balance state, investment account pairs, loan/mortgage fields;
- `transactions`: transaction CRUD, filtering, transfers, splits, reconciliation, tags, and balance effects;
- `categories`: hierarchical categories and default-category import;
- `payees`: payee management and suggestion behavior;
- `tags`: transaction tagging;
- `institutions`: financial-institution metadata;
- `currencies`: currencies and exchange rates.

#### Investments and valuation

- `securities`: securities, holdings, prices, investment transactions, and documents;
- `net-worth`: net-worth snapshots and related calculations;
- `investment-reports`: investment-specific reporting.

#### Planning and automation

- `scheduled-transactions`: bills, deposits, posting schedules, overrides, transfers, and investment schedules;
- `budgets`: budget definitions, periods, categories, and alerts;
- `loan-scenarios`: scenario modeling;
- `loan-rate-changes`: variable-rate history;
- `monte-carlo`: simulation functionality.

#### Reporting and AI

- `reports`: custom report definitions and execution;
- `built-in-reports`: predefined reporting services;
- `ai`: provider configuration, usage, insights, and query tools;
- `ai-relay`: AI relay integration.

#### Data lifecycle and platform

- `import`: QIF/OFX/CSV and native Microsoft Money import paths;
- `backup`: export, restore, encryption, automatic backups, and support backups;
- `attachments`: attachment storage;
- `action-history`: undo/redo and audit-oriented history;
- `database`: initialization, seeding, and demo reset;
- `notifications`: email and reminder delivery;
- `updates`: update/release-note support;
- `health`: liveness/readiness;
- `i18n`: backend localization.

### 5.5 Cross-cutting backend request pipeline

Global guards and interceptors are registered centrally. The observed order and responsibilities include:

- throttling;
- CSRF enforcement for cookie-authenticated mutating requests;
- password-change requirements;
- PAT scope enforcement;
- demo-mode restrictions;
- request-context seeding;
- CSRF refresh behavior;
- class serialization.

The request-context interceptor records authenticated identity and request metadata in `AsyncLocalStorage`. Database services then enter `withScopedDb`, which either joins an active scoped transaction or opens a new transaction and sets PostgreSQL local configuration values for the effective user, real user, bypass flag, and timestamp-preservation mode.

### 5.6 Scoped database access and RLS

The central RLS path is:

```text
Authentication / delegated context
  -> AsyncLocalStorage request context
      -> withScopedDb(DataSource, callback)
          -> transaction EntityManager
          -> set_config(..., true) for local GUCs
          -> TypeORM or parameterized SQL
          -> PostgreSQL RLS policies
```

Relevant components:

- `backend/src/common/request-context.ts` - context representation;
- `backend/src/common/interceptors/request-context.interceptor.ts` - request seeding;
- `backend/src/common/db/with-context.ts` - user, delegate, system, and preserve-timestamp contexts;
- `backend/src/common/db/scoped-db.ts` - the single transaction/GUC entry point;
- `backend/src/common/db/rls-config.ts` - `off`, `shadow`, and `enforce` behavior;
- `backend/src/common/db/app-role.ts` - unprivileged runtime-role setup and grants;
- `backend/eslint.config.mjs` - repository-injection, manual-QueryRunner, and context-import controls.

The RLS identity model distinguishes:

- effective/current user;
- real/authenticated user;
- explicit system bypass;
- timestamp-preservation mode used by restore.

The intended deployment modes are:

- `off`: existing owner-role behavior;
- `shadow`: policy and role preparation without fully switching runtime enforcement;
- `enforce`: runtime use of the unprivileged application role with RLS active.

The owner path remains necessary for initialization, migration, grants, and controlled system operations. The application role must not have `BYPASSRLS`.

### 5.7 RLS migration organization

The core RLS migrations are staged:

- `111_rls_helpers_and_trigger.sql`: helper functions and timestamp-preservation trigger behavior;
- `112_rls_policies_direct.sql`: direct-user and real-user policies;
- `113_rls_policies_indirect.sql`: ownership through parent relationships;
- `114_rls_policies_special.sql`: special cases and exemptions;
- later feature migrations add policies for newly introduced tables;
- `123_rls_enable.sql`: enables RLS on covered tables.

The fresh-install `database/schema.sql` includes the resulting functions, policies, and enables. The runbook treats role switching and policy enabling as separate operational flips. The baseline contains the enabling migration, but default deployment values still set `RLS_MODE=off`.

Intentional exemptions include globally shared currencies/exchange rates and migration/OAuth payload infrastructure. `FORCE ROW LEVEL SECURITY` is not used; owner and controlled system paths therefore remain outside ordinary tenant enforcement.

### 5.8 Database schema and migration model

`database/schema.sql` is the fresh-install source of truth. `database/migrations/` contains incremental SQL. `backend/src/db-init.ts` initializes the fresh schema and role prerequisites; `backend/src/db-migrate.ts`:

1. reads SQL files;
2. sorts by full filename;
3. compares full filenames against `schema_migrations`;
4. applies each pending migration in its own transaction;
5. records successful application.

Historical duplicate numeric prefixes exist. They are not ambiguous to the current runner because the complete filename is tracked and sorting falls back to filename order, but current instructions prohibit adding new duplicate prefixes.

The schema covers identity, accounts, transactions, splits, categories, payees, institutions, currencies, investments, holdings, prices, schedules, reports, budgets, AI, delegation, emergency access, OAuth/PATs, backups, imports, action history, loans, and Monte Carlo data.

A critical architecture fact is that `accounts.current_balance` is maintained by application code rather than a database trigger. Transactional integrity and concurrency correctness therefore depend on service-level write boundaries.

Monetary storage is generally `NUMERIC(20,4)`, while quantities, prices, and rates use higher precision where needed. Restore can set `app.preserve_timestamps` so the standard update trigger does not overwrite restored timestamps.

### 5.9 Frontend architecture

The frontend is a Next.js App Router application using React, TypeScript, Axios, Zustand, `next-intl`, and Vitest.

Primary structure:

- `frontend/src/app/`: routes, layouts, feature pages, and route-specific composition;
- `frontend/src/components/`: reusable and feature UI;
- `frontend/src/lib/`: central Axios client and domain API adapters;
- `frontend/src/hooks/`: stateful workflows, including imports;
- `frontend/src/store/`: Zustand stores for auth, preferences, connectivity, and feature state;
- `frontend/src/types/`: manually maintained API/domain contracts;
- `frontend/src/i18n/`: locale catalogs and registration;
- `frontend/src/proxy.ts`: server-side routing, CSP/security headers, locale handling, and internal backend forwarding.

`frontend/src/lib/api.ts` is the central browser client. It handles:

- `/api/v1` base routing and credentials;
- CSRF header acquisition and serialized retry;
- serialized refresh-token retry for 401 responses;
- timezone metadata;
- backend-down state;
- cross-feature cache invalidation.

The auth store persists only a coarse `isAuthenticated` flag. User PII and delegation context are re-fetched, while the actual authentication token remains in an HTTP-only cookie.

Frontend REST contracts are manually duplicated in TypeScript rather than generated from OpenAPI. This is a high-priority contract-drift risk for Phase 6.

### 5.10 Representative transaction data flow

The representative transaction path is:

```text
Transaction form / frontend domain adapter
  -> frontend/src/lib/transactions.ts
  -> POST /api/v1/transactions
  -> backend transaction controller
  -> user/delegation identity from request context
  -> TransactionsService validation
  -> withScopedDb transaction
      -> transaction row
      -> split rows and transfer links
      -> tag links
      -> account balance update
  -> response mapped to frontend manual type
  -> balance/report cache invalidation
```

The service validates ownership, account/currency relationships, split structure, and related entities before writing. Transaction, split, tag, and balance effects are intended to share one scoped database transaction.

### 5.11 Native Microsoft Money import architecture

The `.mny` path is distinct from text-file imports:

1. the browser uploads one `.mny` file;
2. the controller buffers it in memory and enforces a configurable size limit;
3. the parser decrypts in place when necessary; the password is request-scoped and is not stored;
4. successfully parsed plaintext bytes are staged in PostgreSQL so any backend replica can access them;
5. the start endpoint creates an `import_jobs` row and launches an in-process asynchronous job;
6. the frontend polls the job every 1.5 seconds;
7. the importer re-parses staged bytes, maps source handles, pre-generates UUIDs, and writes reference data, transactions, investments, prices, bills, and loans;
8. business data writes occur in a scoped import transaction, while progress/heartbeats use separate short transactions so polling can observe them;
9. post-processing rebuilds balances/holdings and produces a verification report;
10. a reaper marks stale pending/running jobs failed and retryable;
11. completed imports delete staged bytes.

The architecture intentionally uses PostgreSQL, not pod-local storage or Redis, for staging and job coordination. The confirmed concurrency defect in Finding P1-001 is in the create/start boundary, not the per-row claim operation.

### 5.12 Backup, restore, and support-backup architecture

#### Standard backup

The backup module supports streaming export, optional encryption, compression, and user-triggered restore. Automatic backups write files to a configured host/container directory and are scheduled by the backend process.

#### Restore

The restore path:

1. accepts encrypted or gzip content through a raw-body endpoint;
2. authenticates destructive intent;
3. decrypts/decompresses and validates format/version;
4. identifies normal versus support-backup content;
5. builds old-to-new UUID maps, including IDs embedded in JSON structures;
6. enters timestamp-preservation and scoped database contexts;
7. removes the user's existing dataset;
8. restores rows in foreign-key order;
9. performs deferred link updates for cycles/self-references;
10. commits all restored user data or rolls back the entire operation.

The browser clears frontend caches after a successful restore.

#### Support backup

Support backup is an independent, always-encrypted export designed for diagnostic sharing. The public DTO requires a password. The implementation uses:

- explicit section, account, and date scopes;
- a column allowlist and classification rules;
- a golden test intended to fail when an exported schema column is unclassified;
- deterministic relationship handling and dangling-reference scrubbing;
- text masking and uniqueness preservation;
- numerical scaling by a random non-integer multiplier;
- exclusion of highly sensitive tables and binary attachment data;
- price-history exclusion by default because public prices can re-identify masked securities;
- preview output before final export;
- mandatory encryption before the file leaves the server.

Deep validation of ID remapping, date-range opening-balance adjustment, relationship closure, and de-identification strength belongs to Phase 3.

### 5.13 MCP, PAT, and OAuth architecture

The MCP server is exposed through Streamable HTTP outside the normal `/api/v1` prefix. Each session receives its own transport/server instance and resolves `{ userId, scopes }` from PAT or OAuth bearer authentication.

MCP tools are expected to:

- define title, description, input schema, output schema, and annotations;
- resolve caller context from the session rather than tool arguments;
- require `read` or `write` scope;
- reuse shared domain services and `withScopedDb`;
- sanitize errors and avoid leaking internal details;
- apply a per-user write limiter to mutating tools.

PAT token values are hashed; only a display prefix is stored. The current PAT creation DTO recognizes only `read` and `write`.

### 5.14 Background schedules and replica behavior

NestJS Schedule runs inside the backend API process. Documentation explicitly notes that every backend replica executes scheduled jobs. This affects automatic backups, reminders, rates/prices, budget processing, stale import reaping, and other cron-driven behavior.

Some jobs may be idempotent or use database coordination, but this phase did not exhaustively verify every scheduled task. Multi-replica duplicate execution is therefore a design risk and a Phase 4 priority, not a confirmed general defect.

### 5.15 Testing and CI organization

#### Backend

- Jest unit tests under `backend/src/**/*.spec.ts`;
- database integration tests under `backend/test/integration/`;
- serial integration execution against PostgreSQL;
- high global coverage thresholds;
- migration lint and schema-drift checks;
- dedicated RLS integration helpers and harness tests.

#### Frontend

- Vitest and Testing Library;
- coverage thresholds for lines, statements, functions, and branches;
- component, hook, store, and API-adapter tests;
- i18n consistency checks.

#### End-to-end

- Playwright under `e2e/`;
- Chromium and Firefox projects;
- one worker in CI, with retries;
- sharded CI execution;
- application stack started through dedicated Compose configuration.

#### Workflows

- `.github/workflows/ci.yml`: lint, type checking, unit tests, database integration, schema drift, migration lint, dependency audit, license checks, Bearer scan, Zizmor, Dockerfile lint, bundle checks, i18n, and E2E shards;
- `.github/workflows/zap.yml`: scheduled/manual ZAP scan; findings are reported but the scan is not a blocking failure gate;
- `.github/workflows/lighthouse.yml`: Lighthouse checks for public/pre-authentication pages;
- `.github/workflows/pr-checklist.yml`: PR-process enforcement;
- `.github/workflows/bearer-exceptions-review.yml`: weekly review of time-bounded Bearer exceptions;
- `.github/workflows/fork-images.yml` and `ghcr-cleanup.yml`: image maintenance.

The PR head associated with the baseline had successful recorded runs for the principal CI, Lighthouse, and checklist workflows. No direct merge-SHA run was available through the connector.

### 5.16 High-risk priority matrix

| Later phase | Priority areas established in Phase 1 |
|---|---|
| Phase 2 - Security/RLS | ALS identity propagation, effective vs real user, system bypass allowlist, delegation, policy coverage, app-role grants, cookie/CSRF vs bearer boundaries, PAT/OAuth/MCP scopes |
| Phase 3 - Database/backup | schema/migration parity, restore ordering and remapping, support-backup closure/de-identification, timestamp preservation, backup compatibility, attachment handling |
| Phase 4 - Backend/concurrency | confirmed `.mny` start race, application-maintained balances, read-modify-write paths, scheduled jobs on multiple replicas, background in-process jobs, refresh/token races |
| Phase 5 - Financial correctness | sign conventions, FX, rounding, fees/commissions, prices, adjusted close, holdings replay, loans/mortgages, budgets, simulations, missing/unknown values |
| Phase 6 - Frontend/contracts | manual REST types, adapters, null/zero/absent semantics, cache invalidation, delegation UI, localization parity, proxy behavior |
| Phase 7 - Tests/CI | missing race tests, merge-SHA evidence, branch protection, non-gating security scans, release reproducibility, contract and docs smoke tests |


---

## 6. Confirmed findings

### P1-001 - Concurrent `.mny` start requests can create and run separate active jobs

- **Severity:** HIGH
- **Confidence:** high
- **Classification:** confirmed data-integrity and concurrency defect
- **Primary owner for remediation:** backend/import + database

#### Exact locations

- `backend/src/import/mny/mny-import.controller.ts:165-184`
- `backend/src/import/mny/mny-import.service.ts:116-155`
- `backend/src/import/mny/mny-import-job.service.ts:75-132`
- `database/migrations/117_mny_import_staging_and_jobs.sql:32-65`
- `backend/src/import/mny/map/map-transactions.ts:518-536`
- `backend/src/import/mny/writers/write-transactions.ts:48-102`
- `backend/src/import/mny/mny-import.service.spec.ts:362-371`
- `backend/test/integration/mny-import-job.integration.spec.ts:105-145`

#### Violated invariant

For one user, at most one `.mny` import may be in `pending` or `running` state. The guard must be enforced atomically at the database boundary. A staged file must not be imported twice merely because two start requests overlap.

#### Evidence

`MnyImportService.start()` first calls `hasActiveJob(userId)` and later calls `create(userId, stagedFileId, options)`. These operations run in separate `withScopedDb` transactions. An optional destructive wipe is also performed between the check and job creation.

`MnyImportJobService.create()` unconditionally inserts a new `pending` row. `hasActiveJob()` is a separate count query. The `claim(jobId)` update is atomic only for multiple workers racing over the same job row; it does not prevent two requests from creating two different job rows.

The schema has ordinary indexes on `user_id`, `staged_file_id`, and running-job heartbeat, but no partial unique constraint covering `(user_id) WHERE status IN ('pending','running')` and no equivalent advisory lock.

Each import parse pre-generates new random UUIDs for transactions, and the writer inserts those IDs. Two successful jobs over the same source bytes therefore do not naturally deduplicate transaction rows.

The unit test named `refuses a second concurrent import` only mocks `hasActiveJob()` to return `true`; it does not execute concurrent starts. The integration concurrency tests race multiple claims of one row, not two check-and-create sequences.

#### Realistic reproduction scenario

1. Authenticate as one user and upload/parse a `.mny` file to obtain a valid `stagedFileId`.
2. Ensure the user has no `pending` or `running` import job.
3. Send two concurrent `POST /api/v1/import/mny/start` requests with the same `stagedFileId`.
4. Schedule the requests so both `hasActiveJob()` count queries finish before either `create()` commits.
5. Both requests create distinct `pending` jobs.
6. Each job claims its own row and begins importing the same staged bytes.

The same race applies to different staged files for the same user. With `wipeExistingData=true`, both requests can also pass the initial active-job check and independently enter the destructive pre-job wipe path.

#### Impact

Depending on source data and timing:

- duplicate transaction history can be committed because each import generates fresh UUIDs;
- account balances, net worth, reports, and investment history can be doubled;
- reference entities may be duplicated or one job may fail on a uniqueness conflict after substantial work;
- two jobs can interleave post-processing or compete over user-level state;
- the user can see one completed and one failed job without a clear explanation of the data state;
- wipe mode increases the destructive surface before a durable job lock exists.

The defect is tenant-local, but it affects core financial data integrity and is therefore HIGH.

#### Recommended correction

Make active-job acquisition atomic in PostgreSQL. The preferred correction is:

1. add a partial unique index, for example:

   ```sql
   CREATE UNIQUE INDEX ... ON import_jobs(user_id)
   WHERE status IN ('pending', 'running');
   ```

2. perform job creation directly and translate the unique-violation code into the existing HTTP 409 response;
3. keep `claim(jobId)` as worker-level protection for a single row;
4. consider an idempotency key for `(user_id, staged_file_id, client request)` so a network retry can return the existing job instead of only rejecting;
5. place any wipe authorization and destructive operation behind the same user-level acquisition, or acquire the lock before wiping and release/mark failure transactionally when preconditions fail.

A PostgreSQL advisory lock or serializable transaction can also work, but a durable partial unique index is simpler to inspect and harder to bypass accidentally.

#### Recommended regression test

Add a real PostgreSQL integration test that uses separate connections and a synchronization barrier:

- start two requests for the same user and staged file at the same time;
- assert exactly one request returns a created job and the other returns 409 or the same idempotent job;
- assert exactly one `pending`/`running` row exists;
- assert the import body executes once;
- after completion, assert transaction counts and balances equal one import, not two;
- repeat with two staged files for the same user;
- assert two different users can start imports concurrently;
- repeat with `wipeExistingData=true` and verify only the winning request can wipe.

#### Verification method

Run the barrier-based test repeatedly against PostgreSQL under the normal RLS/scoped-DB setup. Inspect `import_jobs`, transaction counts, account balances, and job results. Then run the full `.mny` unit and integration suite and the schema-drift test.

---

### P1-002 - Documented bootstrap and deployment commands do not match the tracked manifests

- **Severity:** MEDIUM
- **Confidence:** high
- **Classification:** confirmed documentation and operability defect
- **Primary owner for remediation:** repository documentation + infrastructure

#### Exact locations

- `README.md:231-275`
- `.claude/skills/infrastructure.md:5-35`
- `.claude/skills/infrastructure.md:78-145`
- `helm/README.md:15-29`
- `helm/README.md:92-112`
- `docker-compose.dev.yml:1-124`
- `database/CLAUDE.md:5-18`
- `helm/values.yaml:18-43`
- `helm/templates/statefulset-backend.yaml:37-42`
- `helm/Chart.yaml:1-10`

#### Violated invariant

The repository's primary setup and deployment documentation must identify files, services, ports, commands, and defaults that exist at the audited revision. A clean checkout following the documented happy path must reach a valid configuration rather than fail before the application starts.

#### Evidence

The root README lists `docker-compose.yml` and instructs users to run `docker-compose up -d`. No `docker-compose.yml` exists at the baseline; the development manifest is `docker-compose.dev.yml`. A pinned fetch of the documented path returned 404.

The auxiliary infrastructure instruction file additionally describes:

- a Compose service named `db`, while the tracked development service is `postgres`;
- `database/init.sql` as the schema source of truth, while that file does not exist and the current source is `database/schema.sql`;
- a backend proxy target on port 3001, while development Compose uses `http://backend:3000` internally;
- startup through `db-init` alone, while the tracked development command runs both `db-init` and `db-migrate`;
- Chromium-only E2E at `localhost:3000`, while the current Playwright setup includes Chromium and Firefox and the public development frontend is mapped to host port 3001;
- default `docker compose` commands without the required `-f docker-compose.dev.yml` argument;
- `docker compose exec db`, which targets a non-existent service.

The Helm README instructs users to install `./helm/monize`, but the chart root is `helm/` (`helm/Chart.yaml`, `helm/values.yaml`, and `helm/templates/`), and `helm/monize/Chart.yaml` does not exist. The README also documents defaults such as `pullPolicy: Always` and a 150 MiB backend memory limit that disagree with `helm/values.yaml`, which uses `IfNotPresent` and 400 MiB. The templates consume those actual values.

#### Realistic reproduction scenario

1. Clone the baseline and follow the root README Quick Start.
2. Run `docker-compose up -d` from the repository root.
3. Compose exits because no default Compose file exists.

For the Helm path:

1. Follow `helm/README.md` from the repository root.
2. Run `helm install monize ./helm/monize ...`.
3. Helm exits because the documented chart directory does not exist.

For agent-assisted maintenance, an automated contributor following `.claude/skills/infrastructure.md` can attempt to edit a non-existent `database/init.sql`, target a non-existent `db` service, or validate the wrong ports and browser matrix.

#### Impact

- the primary documented onboarding path is blocked;
- operators and automated agents can target wrong files or services;
- migration and schema changes can be prepared against a non-existent source-of-truth path;
- Helm users can fail installation before rendering templates;
- incorrect documented defaults make resource and image-pull behavior harder to reason about;
- the combination of mutable `latest` image tags and actual `IfNotPresent` behavior can make deployments retain a cached image even though the README says pulls are always performed.

The defect is operational rather than a direct security or data-loss defect, so it is MEDIUM.

#### Recommended correction

- Make `README.md` use `docker compose -f docker-compose.dev.yml up -d` and list the actual Compose files.
- Update or regenerate `.claude/skills/infrastructure.md` from current manifests, or remove it if it is not maintained as an instruction source.
- Change Helm commands to target `./helm` or move the chart to match the documented path.
- Generate the Helm default-value table from `helm/values.yaml` to prevent drift.
- Prefer immutable release tags or digests in examples and defaults. If `latest` remains supported, align pull policy and documentation explicitly.
- Identify one canonical development and one canonical production bootstrap path and link all secondary documents to them.

#### Recommended regression test

Add a documentation/configuration smoke job to CI that:

- verifies every referenced repository path in canonical setup commands exists;
- runs `docker compose -f docker-compose.dev.yml config`;
- verifies documented Compose service names against rendered service names;
- runs `helm lint ./helm` and `helm template` using documented commands;
- compares documented Helm defaults to `helm show values ./helm` or generates the table;
- rejects `latest` plus `IfNotPresent` in release-oriented values unless explicitly waived;
- verifies documented Playwright projects and base URL against `e2e/playwright.config.ts`.

#### Verification method

Execute every canonical Quick Start and Helm command in a clean checkout with no untracked compatibility files. Confirm that the rendered Compose/Helm topology matches the documentation and that all referenced paths and services exist.

---

### P1-003 - Repository instructions direct contributors to transaction APIs prohibited by the RLS architecture

- **Severity:** MEDIUM
- **Confidence:** high
- **Classification:** confirmed instruction and security-architecture defect
- **Primary owner for remediation:** repository instructions + backend platform

#### Exact locations

- `CLAUDE.md:111-124`
- `backend/eslint.config.mjs:103-130`
- `CONTRIBUTING.md:61-67`
- `.claude/skills/backend.md:177-208`
- `docs/future-plans/vat-support.md:42-47`

#### Violated invariant

All production database access must enter through `withScopedDb`, which binds transaction lifetime to request/system identity GUCs. Production code must not create manual `QueryRunner`s, inject repositories, or open an independent `DataSource.transaction` that is unaware of the active scoped manager.

#### Evidence

The current root instruction file states that no `QueryRunner`s remain and that all database access must use `withScopedDb`. ESLint rejects `createQueryRunner()` and injected repositories in production source because they bypass the scoped transaction and identity GUCs.

`CONTRIBUTING.md`, however, says every multi-table or read-modify-write operation must use a `QueryRunner` transaction and tells readers to consult `CLAUDE.md`, which says the opposite.

`.claude/skills/backend.md` demonstrates direct repository access and `this.dataSource.transaction(...)` as preferred patterns. The latter may not trigger the narrow `createQueryRunner` syntax rule, but it still bypasses the active scoped manager and local RLS identity setup.

The VAT design document proposes `QueryRunner` for default-rate enforcement, so following that plan literally would violate the current RLS architecture.

#### Realistic reproduction scenario

1. A contributor reads `CONTRIBUTING.md` or the backend skill while adding a multi-table feature.
2. They implement `createQueryRunner()` or `dataSource.transaction()` instead of `withScopedDb`.
3. A manual `QueryRunner` fails CI, wasting development/review time.
4. A `DataSource.transaction()` implementation can be merged if it evades the current syntax restriction or is added to an allowlist without understanding the invariant.
5. In `RLS_MODE=enforce`, the independent transaction lacks `app.current_user_id` and other local GUCs, causing tenant reads/writes to fail closed. In owner/off paths it can bypass defense-in-depth and rely only on application filters. In nested workflows it can commit independently of the caller's scoped transaction.

#### Impact

- predictable CI failures for contributors following official guidance;
- runtime authorization failures when RLS enforcement is enabled;
- loss of atomicity when an inner independent transaction commits and an outer operation later rolls back;
- possible defense-in-depth regression in owner/off or incorrectly provisioned environments;
- inconsistent effective/real-user behavior for delegated access;
- higher risk that future features, including planned VAT support, are implemented against the wrong database abstraction.

Because the contradiction targets a security-critical invariant but is not itself an active cross-tenant exploit, severity is MEDIUM.

#### Recommended correction

- Replace the `QueryRunner` rule in `CONTRIBUTING.md` with the canonical `withScopedDb` pattern.
- Rewrite `.claude/skills/backend.md` examples to accept an `EntityManager` and join the active scoped transaction.
- Update the VAT plan and other future-plan documents before implementation.
- Add a restricted-syntax rule for direct `DataSource.transaction()` calls outside `scoped-db.ts` and explicit test/bootstrap exceptions.
- Add a short architectural decision record explaining why the scoped manager is required for both RLS and nested atomicity.
- Make the root instruction file explicitly declare the status and precedence of `.claude/skills/*`.

#### Recommended regression test

- Add a repository documentation lint that flags positive recommendations of `QueryRunner`, `createQueryRunner`, injected repositories, or `DataSource.transaction` outside approved historical/negative contexts.
- Add an ESLint fixture test proving `DataSource.transaction()` is rejected in production source.
- Add an integration test where a nested service call joins the same scoped transaction and observes the same effective/real-user GUCs.
- Add an RLS-enforce test proving the canonical example works and the unscoped transaction does not.

#### Verification method

Search production source and current instruction documents for forbidden transaction primitives, run backend lint fixture tests, and exercise nested scoped operations under `RLS_MODE=enforce` with both direct-user and delegated-user contexts.

---

### P1-004 - The schema advertises a PAT scope that the API cannot issue

- **Severity:** LOW
- **Confidence:** high
- **Classification:** confirmed authorization-contract documentation defect
- **Primary owner for remediation:** auth/MCP + database documentation

#### Exact locations

- `database/schema.sql:1103-1111`
- `backend/src/auth/dto/create-pat.dto.ts:20-31`
- `backend/src/auth/guards/pat-scope.guard.ts:20-44`
- `docs/future-plans/vat-support.md:61-69`

#### Violated invariant

The supported authorization-scope vocabulary must have one authoritative definition across schema comments, token issuance, guards, OAuth/MCP tooling, and feature plans.

#### Evidence

The `personal_access_tokens.scopes` schema comment lists `read`, `write`, and `reports`. `CreatePatDto` accepts only comma-separated `read` and `write`; a request containing `reports` is rejected by validation. The scope guard compares arbitrary required strings to the stored comma-separated token scopes, but issuance remains limited by the DTO.

The VAT plan proposes an MCP tool guarded by `reports`, which would be unreachable through a newly issued PAT unless the authorization contract is expanded across all layers.

No active privilege expansion was found: the stale schema comment does not grant a scope and the DTO prevents its issuance. This is therefore LOW.

#### Realistic reproduction scenario

1. A maintainer reads the schema comment or VAT plan and assumes `reports` is supported.
2. They submit PAT creation with `scopes=reports` or `read,reports`.
3. DTO validation rejects the request.
4. If a future MCP tool requires `reports` without completing token-issuance work, PAT users cannot call it even though repository documentation says the scope exists.

#### Impact

- misleading API and schema documentation;
- avoidable integration failures for MCP/PAT clients;
- risk of an inaccessible future tool or inconsistent PAT versus OAuth behavior;
- duplicated scope vocabulary that can drift silently.

#### Recommended correction

Choose one model and apply it consistently:

- if only `read` and `write` are supported, remove `reports` from `schema.sql` and update the VAT plan to use `read` or a documented capability model;
- if `reports` is intended, define a shared scope enum/constant and update PAT DTO validation, PAT UI/types, OAuth scope registration, guards, MCP instructions, tests, and migration/schema documentation together.

#### Recommended regression test

- add a table-driven contract test that enumerates every supported scope from one source and verifies PAT creation, OAuth registration, guard checks, MCP tool requirements, and generated documentation;
- add a schema/comment drift check or generate the schema comment from the same constant;
- test rejection of unknown scopes and successful issuance/use of every supported scope.

#### Verification method

Create PATs for each declared scope through the public API, authenticate an endpoint/tool requiring each scope, and compare the accepted set against schema and OpenAPI documentation.

---

## 7. Design risks requiring later decisions

The items in this section are not confirmed defects in Phase 1. They require deeper scenario verification or an explicit design decision.

### 7.1 RLS rollout is operationally coupled to deployment immutability

`123_rls_enable.sql` exists in the baseline, while runtime enforcement depends on role provisioning and `RLS_MODE`. Compose and Helm default to RLS off. Helm defaults also use mutable `latest` image tags with `IfNotPresent`. A staged RLS rollout can become difficult to reason about if replicas run different cached images or if migrations advance before the runtime role switch. Phase 2 should verify the exact safe upgrade sequence; Phase 7 should address reproducible releases.

### 7.2 System-context bypass is broad and centrally allowlisted

`backend/eslint.config.mjs` contains a substantial list of files permitted to import `with-context`. The existence of a review gate is positive, but every call site is a potential cross-tenant boundary. Phase 2 must inspect purpose, caller identity, SQL predicates, and auditability for each bypass-capable path.

### 7.3 Delegation depends on correct effective-user versus real-user semantics

Some tables should follow the owner/effective user while security-sensitive records should follow the authenticated/real user. A single swapped GUC or policy helper can either hide valid delegated data or expose records that must remain personal. This is a primary Phase 2 cross-layer invariant.

### 7.4 Application-maintained balances amplify concurrency risk

The database does not derive account balances with triggers. Correctness depends on every transaction, split, import, undo, restore, scheduled posting, and investment path using the right transaction manager and update ordering. Phase 4 must inventory all balance mutators and verify locking/lost-update behavior.

### 7.5 Background work runs in API processes

Scheduled jobs and `.mny` imports are not handled by a dedicated queue worker. Every replica runs schedules, and a pod restart can interrupt in-process work. Some tasks use database jobs, heartbeats, or idempotent sweeps; others may not. Phase 4 must classify each scheduled/background path.

### 7.6 Backup restore is intentionally powerful

Restore deletes and rebuilds the user's dataset in one transaction, uses timestamp-preservation context, accepts large raw bodies, and remaps many IDs and JSON references. Authentication, memory use, version compatibility, relationship closure, and rollback guarantees need focused Phase 3 verification.

### 7.7 Support-backup de-identification is complex

Allowlisting, numerical scaling, text masking, account/date scoping, opening-balance adjustment, relationship closure, and price-history exclusion interact. The architecture has thoughtful safeguards, but a single unclassified JSON field or indirect identifier can leak information. Phase 3 must test realistic datasets and re-identification attempts.

### 7.8 Frontend contracts are manually duplicated

The frontend does not consume generated REST types. DTO/entity changes can compile on the backend while adapters and components retain stale nullability, enum, or field semantics. Phase 6 should trace material contracts and evaluate generation or schema-based contract tests.

### 7.9 Large binary workflows are memory-sensitive

Both frontend proxy and backend buffer `.mny` uploads, while restore and support export can also process large payloads. Helm documentation acknowledges the issue, but actual resource defaults, request limits, and failure modes require runtime verification.

### 7.10 Security scans are not uniformly blocking

The main CI includes multiple security checks, but ZAP is configured to report rather than fail the workflow, and Lighthouse covers pre-authentication pages. Phase 7 should determine which findings can block merges/releases and whether authenticated attack surfaces receive dynamic coverage.

---

## 8. Missing tests

### 8.1 Confirmed missing regression coverage

1. **Atomic concurrent `.mny` start:** no test races two real start/check/create paths for the same user. Existing tests cover a mocked positive `hasActiveJob` result and concurrent claims of one row.
2. **Canonical documentation smoke:** no inspected CI job executes the root README Quick Start or Helm README install command, otherwise the non-existent paths would fail.
3. **Instruction-pattern parity:** no inspected check compares current DB-access instructions with the ESLint-enforced `withScopedDb` rule.
4. **PAT scope vocabulary parity:** no inspected test proves schema/OpenAPI/PAT/OAuth/MCP scope declarations are identical.

### 8.2 Tests not located and requiring confirmation in later phases

The following may exist outside the sampled paths, but were not established in Phase 1 and must be explicitly searched before being reported as absent:

- a full policy-by-table RLS matrix for every user-owned table introduced after the core RLS migrations;
- negative delegated-access tests for every real-user table;
- production-role grant and sequence/function privilege tests;
- end-to-end restore tests covering every deferred foreign key and JSONB ID remap;
- support-backup re-identification and account/date-scope closure tests beyond the inspected golden/rules/integration coverage;
- multi-replica cron coordination tests;
- generated or runtime backend/frontend contract tests;
- a merge-commit CI policy that guarantees the exact merge SHA is tested.

---

## 9. Documentation issues

This section consolidates documentation defects, including those that are formal findings.

### 9.1 Primary setup documentation

- `README.md` references a non-existent `docker-compose.yml` and an unusable default Compose command.
- The correct development manifest is `docker-compose.dev.yml`.

### 9.2 Auxiliary infrastructure instruction

`.claude/skills/infrastructure.md` is materially stale: Compose filename, service name, schema path, ports/proxy target, migration startup sequence, E2E browser matrix, base URL, and database-access command do not match the baseline.

### 9.3 Helm documentation

- install commands target non-existent `./helm/monize` instead of the chart root;
- documented registry, pull policy, and memory defaults disagree with `helm/values.yaml`;
- the README says `Always`, while templates render the actual `IfNotPresent` value.

### 9.4 Database access instructions

- `CONTRIBUTING.md` recommends `QueryRunner` despite the repository-wide prohibition;
- `.claude/skills/backend.md` demonstrates direct repository access and `DataSource.transaction`;
- the VAT plan repeats the obsolete `QueryRunner` pattern.

### 9.5 PAT/MCP scope documentation

- `database/schema.sql` lists `reports` as a PAT scope;
- PAT creation accepts only `read` and `write`;
- the VAT plan assumes `reports` without defining the required authorization changes.

### 9.6 RLS document placement and status

The implemented RLS design, task list, and production runbook remain under `docs/future-plans/`. Their content reflects a substantially implemented system, including the enabling migration, so the directory name can cause maintainers to misread the feature as entirely future work. The documents themselves contain useful status and rollout cautions; relocation or a clear status banner would reduce ambiguity.

### 9.7 Documentation reviewed without a material contradiction

- `docs/database-migrations.md` is broadly consistent with the current migration runner and schema-drift model;
- `docs/support-backup.md` aligns with the inspected support-backup architecture;
- `docs/cron-jobs.md` accurately warns that every backend replica executes schedules;
- `docs/future-plans/cross-owner-transfers*.md` clearly describes unimplemented future work rather than claiming current support;
- `docs/release-notes/README.md` aligns with the release-note workflow structure;
- `CONTAINER_BUILD.md` is consistent with the multi-stage container approach at the level inspected.


---

## 10. Reviewed scope

### 10.1 Directories inspected

| Directory | Review depth | Purpose in this phase |
|---|---|---|
| repository root | architectural inventory | baseline files, package/workspace metadata, Compose variants, contributor/security/build docs |
| `.claude/` | full instruction discovery | settings and all discovered skill guidance |
| `.github/workflows/` | full workflow inventory; principal workflows read | CI, security, performance, PR policy, image maintenance |
| `backend/` | architecture and representative cross-layer tracing | package/test configuration and layer instructions |
| `backend/src/common/` | focused deep read | request context, scoped DB, RLS configuration, interceptors, validation infrastructure |
| `backend/src/auth/` | focused sample | PAT service/DTO/entity/guard and authentication architecture |
| `backend/src/transactions/` | representative flow | controller/service transaction creation and balance effects |
| `backend/src/backup/` | focused deep sample | export, restore, encryption surfaces, support backup |
| `backend/src/import/mny/` | focused deep sample | upload, staging, background jobs, mapping, writers, tests, UI integration |
| `backend/src/mcp/` | instruction and auth architecture | MCP transport/tool conventions and scope model |
| `backend/test/` | representative configuration/tests | integration harness, RLS helpers discovered, MNY and support-backup coverage |
| `frontend/src/app/` | route inventory/sample | App Router organization and feature surface |
| `frontend/src/lib/` | focused sample | central API client, transactions, backup, feature adapters |
| `frontend/src/hooks/` | focused sample | import wizard and `.mny` state machine |
| `frontend/src/store/` | focused sample | auth persistence and delegation restoration |
| `frontend/src/types/` | representative sample | manually duplicated REST/domain contracts |
| `frontend/src/i18n/` | structural review | localization organization and CI checks |
| `database/` | focused deep read | schema, instructions, RLS functions/policies, migration organization |
| `database/migrations/` | RLS/import-focused sample plus inventory | policy rollout, import jobs, migration ordering |
| `docs/` | broad documentation review | migration, RLS, backup, cron, import, release, and future-plan docs |
| `e2e/` | configuration and roadmap | Playwright projects, execution model, coverage roadmap |
| `helm/` | chart/docs/config sample | deployment topology, defaults, RLS and memory configuration |

### 10.2 Files inspected in full

The following files were read to EOF or are sufficiently small that the pinned fetch returned the complete file:

#### Instructions and repository policy

- `CLAUDE.md`
- `backend/CLAUDE.md`
- `frontend/CLAUDE.md`
- `database/CLAUDE.md`
- `backend/src/mcp/CLAUDE.md`
- `.claude/settings.json`
- `.claude/skills/backend.md`
- `.claude/skills/frontend.md`
- `.claude/skills/infrastructure.md`
- `CONTRIBUTING.md`
- `SECURITY.md`

#### Primary documentation

- `README.md`
- `CONTAINER_BUILD.md`
- `docs/database-migrations.md`
- `docs/support-backup.md`
- `docs/cron-jobs.md`
- `docs/future-plans/row-level-security.md`
- `docs/future-plans/row-level-security-tasks.md`
- `docs/future-plans/row-level-security-runbook.md`
- `docs/future-plans/cross-owner-transfers.md`
- `docs/future-plans/cross-owner-transfers-tasks.md`
- `docs/future-plans/mny-import.md`
- `docs/future-plans/user-encryption.md`
- `docs/future-plans/vat-support.md`
- `docs/import-ms-money.md`
- `backend/src/import/mny/README.md`
- `e2e/ROADMAP.md`
- `docs/release-notes/README.md`
- `helm/README.md`

#### Configuration and entry points

- `package.json`
- `backend/package.json`
- `frontend/package.json`
- `e2e/package.json`
- `backend/src/app.module.ts`
- `backend/src/main.ts`
- `backend/eslint.config.mjs`
- `docker-compose.dev.yml`
- `docker-compose.prod.yml`
- `helm/Chart.yaml`
- `helm/values.yaml` (reviewed through the primary backend/frontend configuration blocks)
- `e2e/playwright.config.ts`
- `frontend/vitest.config.ts`
- `backend/test/jest-e2e.json`

#### Scoped DB and RLS

- `backend/src/common/db/scoped-db.ts`
- `backend/src/common/db/with-context.ts`
- `backend/src/common/request-context.ts`
- `backend/src/common/interceptors/request-context.interceptor.ts`
- `backend/src/common/db/rls-config.ts`
- `backend/src/common/db/app-role.ts`
- `backend/src/db-init.ts`
- `backend/src/db-migrate.ts`
- `database/migrations/111_rls_helpers_and_trigger.sql`
- `database/migrations/112_rls_policies_direct.sql`
- `database/migrations/113_rls_policies_indirect.sql`
- `database/migrations/114_rls_policies_special.sql`
- `database/migrations/123_rls_enable.sql`

#### Selected functional files

- `backend/src/backup/backup.module.ts`
- `backend/src/backup/backup.controller.ts`
- `backend/src/backup/support-backup/dto/create-support-backup.dto.ts`
- `backend/src/backup/support-backup/support-backup.service.ts`
- `backend/src/backup/support-backup/support-backup-scope.ts`
- `backend/src/auth/dto/create-pat.dto.ts`
- `backend/src/auth/entities/personal-access-token.entity.ts`
- `backend/src/auth/guards/pat-scope.guard.ts`
- `backend/src/transactions/transactions.controller.ts`
- `backend/src/import/mny/mny-import.controller.ts`
- `backend/src/import/mny/mny-import-job.service.ts`
- `backend/src/import/mny/writers/write-transactions.ts`
- `backend/src/import/mny/writers/write-reference.ts`
- `backend/src/import/mny/map/map-transactions.ts`
- `frontend/src/lib/api.ts`
- `frontend/src/proxy.ts`
- `frontend/src/lib/backupApi.ts`
- `frontend/src/hooks/useMnyImport.ts`
- `frontend/src/store/authStore.ts`
- `frontend/src/types/transaction.ts`

#### Workflows

- `.github/workflows/ci.yml`
- `.github/workflows/zap.yml`
- `.github/workflows/lighthouse.yml`
- `.github/workflows/pr-checklist.yml`
- `.github/workflows/bearer-exceptions-review.yml`

### 10.3 Files sampled rather than exhaustively reviewed

The following large or broad files were sampled for architecture and representative flows. No claim of complete defect review is made for them:

- `database/schema.sql` - sequential large ranges covering the principal schema, RLS, and relevant tables; not treated as a line-by-line schema audit;
- `backend/src/backup/backup.service.ts` - export/restore entry, remapping, ordering, and transaction sections;
- `backend/src/backup/support-backup/support-backup-rules.ts` - classification and transformation rules;
- `backend/src/backup/support-backup/support-backup-integrity.ts` - dangling-reference and integrity logic;
- `backend/src/transactions/transactions.service.ts` - create and representative transactional paths;
- `frontend/src/lib/transactions.ts` - principal adapter methods and cache behavior;
- `frontend/src/hooks/useImportWizard.ts` - route selection and `.mny` integration portions;
- `backend/src/import/mny/mny-import.service.ts` - start, orchestration, import transaction, and verification portions;
- `backend/src/import/mny/mny-import.service.spec.ts` - start and orchestration tests;
- `backend/test/integration/mny-import-job.integration.spec.ts` - job creation/claim/progress sections;
- `backend/test/integration/mny-import.integration.spec.ts` - representative import integration coverage;
- `backend/test/integration/support-backup.integration.spec.ts` - representative support-backup coverage;
- `docs/ms-money-data-model.md` - architecture-relevant portions;
- individual route components under `frontend/src/app/` and `frontend/src/components/` - discovered and sampled, not exhaustively read;
- individual non-RLS migrations - indexed/discovered and selectively sampled, not line-by-line audited;
- `helm/templates/*` - backend image/config and routing-relevant portions;
- `.github/workflows/fork-images.yml` and `.github/workflows/ghcr-cleanup.yml` - discovered, not deeply reviewed.

### 10.4 Areas reviewed without a material issue in Phase 1

- the representative ordinary transaction create path uses one `withScopedDb` transaction for the transaction, splits/tags, and balance effect;
- support-backup public endpoints require encryption credentials through the DTO;
- support-backup uses an explicit allowlist and has a golden-classification testing concept;
- the auth store persists only the authentication flag, not user PII or cookie tokens;
- restore is structured around one scoped transaction and deferred foreign-key repair;
- migration tracking uses the full filename, so historical duplicate numeric prefixes do not collide in `schema_migrations`;
- broad CORS behavior on bearer/OAuth/MCP surfaces is separated from cookie-authenticated origin handling;
- the frontend proxy is not treated as the security boundary; backend authentication remains authoritative;
- cross-owner transfers are documented as future work, not falsely advertised as current behavior;
- release-note organization and the inspected release workflow documentation are broadly consistent.

---

## 11. Unreviewed or inaccessible scope

### 11.1 Inaccessible or unavailable

- A local repository clone/archive could not be obtained because the execution environment could not resolve GitHub network endpoints.
- A complete recursive Git tree was not available as one connector operation.
- Production databases, backups, attachments, `.mny` samples, secrets, runtime environment variables, and deployed infrastructure were not available.
- Branch-protection rules, required-check configuration, environment protection, repository secrets, and organization-level settings were not exposed by the inspected connector functions.
- No direct CI run attached to the merge SHA was returned.

### 11.2 Not executed

- backend unit tests;
- backend integration tests;
- frontend tests;
- Playwright E2E;
- schema-drift and migration-lint scripts;
- Docker Compose rendering or startup;
- Helm lint/template/install;
- ZAP, Lighthouse, Bearer, Zizmor, or dependency scanners;
- backup export/restore round trips;
- support-backup de-identification experiments;
- RLS role switching or production runbook exercises.

Existing workflow definitions and recorded PR-head job results were examined instead.

### 11.3 Intentionally deferred

- exhaustive authorization and RLS policy review: Phase 2;
- full schema, migration, restore, and support-backup verification: Phase 3;
- broad backend concurrency and scheduled-job review: Phase 4;
- numerical financial correctness: Phase 5;
- exhaustive frontend contract and localization review: Phase 6;
- exhaustive test quality, CI policy, and release reproducibility: Phase 7;
- cross-phase deduplication and final severity re-verification: Phase 8.

### 11.4 Coverage caveat

Repository-search results were sometimes capped at 100 entries or truncated. The audit therefore does not claim that every source file in a broad subsystem was read. Claims are limited to the explicit ledger above.

---

## 12. False positives investigated and rejected

### 12.1 Presence of `123_rls_enable.sql` is not by itself a production outage

The enabling migration is present, but default runtime mode remains off and owner-role behavior bypasses RLS. The runbook describes staged role and policy flips. A rollout defect may still exist, but it was not established merely from the migration's presence.

### 12.2 Broad bearer-route CORS is not automatically a cookie-origin bypass

The backend distinguishes bearer/OAuth/MCP surfaces from cookie-authenticated browser routes. Broad bearer CORS is intentional where credentials are not cookie-based. Phase 2 must verify the exact route classification, but no blanket CORS finding was reported.

### 12.3 Absence of `FORCE ROW LEVEL SECURITY` is intentional

Owner/migration/restore paths require controlled bypass behavior. The design relies on an unprivileged application role for runtime enforcement rather than forcing policies on the owner. This is a risk boundary, not automatically a defect.

### 12.4 Global currency and exchange-rate tables are intentionally exempt

The RLS design treats shared market/reference data separately from user-owned data. Their exemption was documented and not reported as tenant leakage.

### 12.5 Historical duplicate migration prefixes do not overwrite tracking rows

The current runner sorts and records full filenames. Historical duplicate numeric prefixes are brittle and current instructions forbid new ones, but they do not collide solely because the numeric prefix is repeated.

### 12.6 Cross-owner transfers are not an implementation regression

The relevant documents are explicitly future plans and task lists remain open. Current same-owner transfer behavior was not misclassified as a defect.

### 12.7 Support backup cannot be requested unencrypted through the public DTO

An internal service parameter appears optional in isolation, but the public DTO requires a password and the controller path uses it. The hypothesis of a publicly downloadable unencrypted support backup was rejected.

### 12.8 The stale `reports` schema comment does not grant an active privilege

PAT issuance rejects `reports`. The defect is documentation/contract drift, not an active over-privilege vulnerability.

### 12.9 No active manual `QueryRunner` was found in production source

Search results were confined to instructions, plans, comments, and tests/helpers. The current production architecture appears converted to `withScopedDb`; the finding concerns contradictory guidance, not a known live manual `QueryRunner` call.

### 12.10 Missing merge-SHA status is not proof that CI failed

The PR head had successful recorded checks and the merge may have been permitted based on those checks. The evidence is insufficient to call CI broken, so this remains a limitation for Phase 7.

### 12.11 Every-replica cron execution is not automatically duplicate behavior

Some jobs may use idempotent updates, advisory locks, unique constraints, or safe sweeps. A job-by-job review is required before confirming defects.

### 12.12 Frontend route redirects are not authorization controls

Proxy/auth-store redirects improve UX, but backend guards and RLS remain authoritative. No finding was based solely on client-side route gating.

---

## 13. Audit ledger

### 13.1 Baseline ledger

| Item | Result |
|---|---|
| Repository | `kenlasko/monize` |
| Default branch | `main` |
| Baseline SHA | `d5cea9bfa995885ba5198f9843359362927c0fd4` |
| Baseline comparison | Identical to `main` at establishment time |
| Read pin | All report evidence re-fetched at the baseline SHA |
| Write operations | None |
| Local clone | Unavailable due network/DNS restriction |
| Evidence channel | Authenticated GitHub connector, pinned file reads and metadata |

### 13.2 Instruction-discovery ledger

| Search target | Result |
|---|---|
| `AGENTS.md` | None found |
| root `CLAUDE.md` | Found and read |
| subtree `CLAUDE.md` | `backend/`, `frontend/`, `database/`, `backend/src/mcp/` found and read |
| `.claude/settings.json` | Found and read |
| `.claude/skills/*` | backend, frontend, infrastructure found and read |
| `README.md` | Found and read |
| `CONTRIBUTING.md` | Found and read |
| `SECURITY.md` | Found and read |
| relevant `docs/` | migration, RLS, backup, cron, import, release, and future-plan documents read |
| package/directory README files | relevant MNY, release, E2E, and Helm documents read |

### 13.3 CI and test evidence ledger

| Evidence | Result |
|---|---|
| Baseline merge-SHA workflow runs | none returned |
| Baseline merge-SHA combined status | none returned |
| PR #1016 head SHA | `4c0101de9ee848de4889d1841d8d5785cdc94fa3` |
| PR-head CI | successful recorded run |
| PR-head Lighthouse | successful recorded run |
| PR-head checklist | successful recorded run |
| CI jobs inspected | backend lint/type, unit, integration, migration lint, schema drift, frontend lint/type/unit/i18n, Dockerfile lint, audit, licenses, Bearer, Zizmor, bundle, E2E browser cache/shards, preview images |
| Backend test configuration | Jest unit and serial PostgreSQL integration reviewed |
| Frontend test configuration | Vitest and coverage thresholds reviewed |
| E2E configuration | Chromium/Firefox, CI workers/retries, base URL reviewed |
| Representative tests read | MNY service/job/integration and support-backup/RLS test locations sampled |

### 13.4 Confirmed-finding ledger

| ID | Severity | Confidence | Summary |
|---|---|---|---|
| P1-001 | HIGH | high | `.mny` active-job check and creation are non-atomic, allowing two independent imports |
| P1-002 | MEDIUM | high | canonical Compose/Helm/infrastructure documentation does not match tracked manifests |
| P1-003 | MEDIUM | high | contributor/agent instructions recommend DB transaction APIs prohibited by scoped RLS architecture |
| P1-004 | LOW | high | schema advertises unsupported `reports` PAT scope |

### 13.5 Open-hypothesis ledger

| Hypothesis | Status | Next phase |
|---|---|---|
| Some post-core tables may lack complete RLS policy/enable/grant coverage | unverified | Phase 2 |
| Effective and real user may be inconsistent in a delegation edge case | unverified | Phase 2 |
| A system-context allowlisted call site may have an over-broad bypass | unverified | Phase 2 |
| App-role sequence/function privileges may be incomplete or excessive | unverified | Phase 2 |
| Restore may miss a deferred or JSONB reference in an edge case | unverified | Phase 3 |
| Support-backup account/date scoping may permit an indirect identifier | unverified | Phase 3 |
| A balance mutation may be vulnerable to a lost update | unverified | Phase 4 |
| A cron job may duplicate side effects on multiple replicas | unverified | Phase 4 |
| A price/FX/rounding path may produce incorrect financial results | unverified | Phase 5 |
| A frontend manual type may disagree with a backend DTO | unverified | Phase 6 |
| Required-check/branch-protection policy may not cover the merge SHA | unverified | Phase 7 |

### 13.6 False-positive ledger

Rejected hypotheses are documented in Section 12. The most important rejected cases were unencrypted public support backup, active production `QueryRunner` usage, automatic RLS outage from migration 123, and CI failure inferred solely from missing merge-SHA status.

### 13.7 Areas with no material finding

The representative transaction-boundary design, mandatory public support-backup encryption, auth-store PII handling, full-filename migration tracking, and documented status of cross-owner transfers did not produce a material Phase 1 finding.

---

## 14. Handoff to Phase 2 - Security and RLS

### 14.1 Mandatory baseline

Phase 2 must audit:

```text
AUDIT_BASELINE_SHA=d5cea9bfa995885ba5198f9843359362927c0fd4
```

Do not resolve or follow a newer `main`.

### 14.2 Primary security/RLS invariants

1. Every user-data query runs inside `withScopedDb` with the correct local identity GUCs.
2. Direct-user tables use effective-user ownership unless they are explicitly real-user security records.
3. Delegated access never changes the authenticated real user for sessions, tokens, credentials, audit records, or other personal security data.
4. System bypass is used only for documented cross-user maintenance and never exposes unfiltered user data to a request.
5. The runtime application role is non-owner, non-superuser, and lacks `BYPASSRLS`.
6. The runtime role has exactly the table, sequence, function, and schema privileges required by the application.
7. Every user-owned table has the intended policy and is enabled when enforce mode is active.
8. Every controller/auth surface reaches the correct cookie/CSRF or bearer/scope boundary.
9. Backup, restore, seed, migration, admin, cron, and MCP paths use explicit and auditable context transitions.
10. Policy behavior remains correct for direct users, delegates, admins, demo mode, OAuth clients, PAT clients, and system jobs.

### 14.3 Exact code paths to start with

#### Request and identity context

- `backend/src/common/request-context.ts`
- `backend/src/common/interceptors/request-context.interceptor.ts`
- `backend/src/common/db/with-context.ts`
- `backend/src/common/db/scoped-db.ts`
- `backend/src/auth/strategies/jwt.strategy.ts`
- `backend/src/delegation/guards/account-delegate.guard.ts`
- delegation context DTO/service/controller paths discovered from `backend/src/app.module.ts`

Trace effective user, real user, roles, acting-as owner, timezone, and bypass from authentication through every `set_config` call.

#### RLS configuration and role provisioning

- `backend/src/common/db/rls-config.ts`
- `backend/src/common/db/app-role.ts`
- `backend/src/db-init.ts`
- `backend/src/db-migrate.ts`
- `docker-compose.dev.yml`
- `docker-compose.prod.yml`
- `helm/values.yaml`
- `helm/templates/statefulset-backend.yaml`
- backend ConfigMap/secret templates under `helm/templates/`

Verify role creation ownership, grants, default privileges, sequence access, function execution, connection selection, shadow/enforce behavior, and failure modes when app-role credentials are missing or wrong.

#### Policies and schema

- `database/migrations/111_rls_helpers_and_trigger.sql`
- `database/migrations/112_rls_policies_direct.sql`
- `database/migrations/113_rls_policies_indirect.sql`
- `database/migrations/114_rls_policies_special.sql`
- every later migration that creates a user-owned table or adds an RLS policy, especially import jobs/staging and security documents;
- `database/migrations/123_rls_enable.sql`
- corresponding RLS sections in `database/schema.sql`

Build a complete table matrix with columns for ownership route, policy expression, `WITH CHECK`, enable state, role grants, fresh-schema parity, migrated-schema parity, and test coverage. Do not rely on the documented expected policy count without independently enumerating the baseline.

#### Bypass-capable call sites

Start from `WITH_CONTEXT_ALLOWLIST` in `backend/eslint.config.mjs` and inspect every importer of `with-context`, including:

- auth/token/PAT services;
- backup/restore/automatic backup;
- admin;
- AI usage/insights;
- budget and scheduled cron services;
- currency/rate maintenance;
- seed/demo reset;
- delegation and emergency access;
- `.mny` staging/job/import services;
- MCP transport/tools;
- notification reminders;
- OAuth;
- holdings and security prices.

For each call site record: caller, context entered, tables touched, tenant predicate, reason bypass is required, and whether an audit trail exists.

#### Authentication and authorization surfaces

- cookie JWT and refresh-token extraction;
- CSRF guard and refresh interceptor;
- PAT service, DTO, strategy/validation, and scope guard;
- OAuth provider/token services;
- MCP transport session authentication;
- admin and demo guards;
- delegation and emergency-access grants;
- backup restore re-authentication;
- OIDC interaction and restore confirmation behavior.

Verify that cookie credentials cannot be accepted on bearer-only paths and that bearer credentials do not inherit cookie/CSRF assumptions.

### 14.4 Exact tests to inspect or add

- `backend/test/helpers/rls-setup.ts`
- `backend/test/integration/rls-helpers-and-trigger.integration.spec.ts`
- all files matching `backend/test/integration/*rls*.spec.ts`
- delegation integration tests;
- PAT and OAuth scope tests;
- backup/restore authorization integration tests;
- MCP transport and tool scope tests;
- schema-drift test and migration-lint rules.

Add missing negative tests using two users plus a delegate. Test reads and writes, not only reads. Execute under the unprivileged application role, not only the owner role.

### 14.5 Open Phase 2 questions

1. Do all tables added after migrations 112-114 have policies, enables, grants, and fresh-schema parity?
2. Are `app.current_user_id`, `app.real_user_id`, and `app.bypass_rls` cleared safely on every transaction boundary and connection-pool reuse?
3. Can nested contexts change identity inside an already-active scoped transaction, and if so, is the mismatch rejected?
4. Are all system-context call sites genuinely cross-user and safely filtered?
5. Does delegation use effective-user policies for finance data and real-user policies for credentials/security records consistently?
6. Are app-role grants narrow enough to prevent direct access to exempt infrastructure tables that should remain owner-only?
7. Can owner credentials accidentally be used in production `enforce` mode?
8. Are PAT, OAuth, and MCP scope vocabularies consistent, including the stale `reports` reference?
9. Do raw SQL and query-builder paths always use the scoped manager and parameterization?
10. Does restore or support-backup bypass RLS only within the intended authenticated user's transaction?

### 14.6 Findings carried forward

- P1-003 is directly relevant to Phase 2 because stale instructions can reintroduce unscoped DB access.
- P1-004 must be considered while auditing PAT/OAuth/MCP scope semantics.
- P1-001 primarily belongs to Phase 4, but Phase 2 should verify that its eventual uniqueness/locking fix remains user-scoped under RLS.
- P1-002 affects reproducible RLS rollout and deployment verification.

### 14.7 Expected Phase 2 deliverable

Create `monize-audit-02-security-rls.md` against the same baseline SHA. Preserve the complete table/policy matrix, bypass-callsite ledger, authentication-surface matrix, confirmed findings, rejected hypotheses, and exact handoff to Phase 3.

---

## Phase 1 conclusion

The repository has a coherent modern architecture centered on scoped TypeORM transactions, PostgreSQL RLS defense in depth, a shared-service backend, a Next.js proxy/API layer, and unusually detailed backup/import functionality. The instruction hierarchy and deployment documentation have accumulated significant drift, and the `.mny` job start boundary contains a confirmed high-severity race capable of corrupting financial history.

The baseline is stable and suitable for continuation. Phase 2 should begin with the request-context/GUC chain, application-role provisioning, complete policy enumeration, and every system-bypass call site.
