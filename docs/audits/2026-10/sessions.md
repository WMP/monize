# Full Read-Only Audit 2026-10: Session List

> Companion to [`plan.md`](./plan.md). One session per working day, in dependency order. A
> session is taken by the protocol in `plan.md` section 4; its status lives in
> [`ledger.md`](./ledger.md) and is mirrored here. Mark a session done by checking its box and
> naming the commit.

## How to read a session block

- **Primary path** is the `/audit` argument. **Secondary paths** are the change surface the
  session must search (producers, consumers, fixtures, adapters), not optional reading.
- **Hint line** is passed to `/audit` verbatim after the path.
- **Prior findings** are the `MON-*` rows of `prior-findings-register.md` the session disposes
  of (plan section 4, step 8).
- **Runtime** says what must be executed: `unit` (the layer's unit suite for the slice),
  `integration` (PostgreSQL in Docker, named suites), `script` (a throwaway race or round-trip
  script under the scratchpad directory), `mutation` (plan step 7, in a scratch worktree).
- **Size**: S under 10k non-test lines of primary code, M 10k to 20k, L 20k to 35k, XL above;
  XL is sampled by invariant, never read end to end.

## Task graph

| ID | Week | Session | Depends on | Size | Status |
|----|------|---------|-----------|------|--------|
| S01 | 1 | Baseline, toolchain, CI and cron inventory | -- | M | [ ] |
| S02 | 1 | Prior HIGH and verification-defect triage | S01 | M | [ ] |
| S03 | 1 | Security: auth, OAuth, users, admin, emergency access, delegation | S01 | M | [ ] |
| S04 | 1 | RLS and tenancy: policies, contexts, joint accounts, cross-owner transfers | S01 | M | [ ] |
| S05 | 1 | Migrations, schema parity, replicas | S01 | M | [ ] |
| S06 | 2 | Backup, restore, support backup, attachments | S04 | L | [ ] |
| S07 | 2 | Cash ledger: transactions, accounts, transfers, splits, reconciliation | S04 | L | [ ] |
| S08 | 2 | Scheduler, cron matrix, job claims, loan posting | S07 | M | [ ] |
| S09 | 2 | MNY import state machine | S07 | XL | [ ] |
| S10 | 2 | CSV import, import preview, bank sync, transaction rules | S07 | L | [ ] |
| S11 | 3 | Email receipts and document scanner | S07 | L | [ ] |
| S12 | 3 | Securities, holdings, trades, prices, providers | S07 | XL | [ ] |
| S13 | 3 | Valuation, FX, currencies, net worth, investment reports, Monte Carlo | S12 | L | [ ] |
| S14 | 3 | Bonds | S12 | M | [ ] |
| S15 | 3 | Loans and GEM strategies | S08 | M | [ ] |
| S16 | 4 | Budgets, reports, categories, payees, tags, calendar | S07 | M | [ ] |
| S17 | 4 | AI assistant, MCP tools, notifications, push | S13 | L | [ ] |
| S18 | 4 | Frontend core: lib, types, hooks, store, cache | S13 | XL | [ ] |
| S19 | 4 | Frontend forms round trip | S18 | L | [ ] |
| S20 | 4 | Frontend figures, reports, dashboard, pages, i18n | S18 | XL | [ ] |
| S21 | 5 | Tests, CI, release, deployment manifests | S02 | M | [ ] |
| S22 | 5 | Delta review: `AUDIT_BASELINE_SHA` to `main` | S01..S21 | varies | [ ] |
| S23 | 5 | Consolidation, final report, remediation task list | S22 | -- | [ ] |

Minimum viable program (plan section 6): S01, S02, S03, S04, S06, S07, S08, S09, S12, S13, S19,
S21, S23.

## Week 1

### S01 Baseline, toolchain, CI and cron inventory

- **Primary path:** `AGENTS.md` (the instruction hierarchy), then `.github/workflows/ci.yml`.
- **Secondary paths:** every `CLAUDE.md`; `docs/system-invariants.md`; `docs/cron-jobs.md`;
  `docs/verification-contract.md`; `docs/release-integrity.md`; `backend/package.json`,
  `frontend/package.json`, `e2e/package.json`; `docker-compose*.yml`; `helm/values.yaml`.
- **Hint line:** `prioritize the instruction hierarchy and its contradictions, the architecture
  delta since d5cea9bf (plan section 5), which suites run green at the baseline, and the 19
  partial and 1 unenforced invariants as standing hypotheses`.
- **Deliverables beyond the report:** the baseline suite results table (what ran, what passed,
  what could not run and why), the list of every `withSystemContext`/`withUserContext` call site
  against `WITH_CONTEXT_ALLOWLIST`, the cron matrix (40 jobs with claim mechanism per row), the
  module inventory with sizes.
- **Prior findings:** MON-M02.
- **Runtime:** `unit` for both layers (`TZ=UTC npm run test:unit` in `backend/`, `npm run test`
  in `frontend/`), `integration` for the whole backend integration suite once, so later sessions
  know which suites are green at the baseline. Record the discovered test count (zero is a
  failure, `docs/release-integrity.md`).
- **Output:** `01-baseline.md`.

### S02 Prior HIGH and verification-defect triage

- **Primary path:** `docs/audits/2026-08-upstream/08-final-report.md` sections 7.1 and 13.
- **Secondary paths:** every evidence path of MON-H01..H16 and MON-M39..M45 at
  `AUDIT_BASELINE_SHA`; `docs/verification-contract.md` section 5; `docs/system-invariants.md`.
- **Hint line:** `for each of MON-H01..H16 and MON-M39..M45, independently reconstruct the
  scenario at AUDIT_BASELINE_SHA and dispose it FIXED_VERIFIED (name the mechanism and the test),
  STILL_OPEN, SUPERSEDED, NOT_LOCATED or HANDED_TO_Sxx; never accept the upstream fix narrative in
  docs/ as proof`.
- **Rule:** a disposition other than `HANDED_TO_Sxx` needs the mechanism named and, for
  `FIXED_VERIFIED`, the test run. The domain session that owns the finding makes the final call;
  S02 exists so the maintainer learns early how much of the upstream audit is still open.
- **Prior findings:** MON-H01..H16, MON-M39..M45 (triage only; final disposition stays with the
  owning session in the register).
- **Runtime:** `unit` for each named test; `integration` where the mechanism is a constraint,
  lock or CAS.
- **Output:** `02-prior-high-triage.md`.

### S03 Security: auth, OAuth, users, admin, emergency access, delegation

- **Primary path:** `backend/src/auth/`.
- **Secondary paths:** `backend/src/oauth/`, `backend/src/users/`, `backend/src/admin/`,
  `backend/src/emergency-access/`, `backend/src/delegation/`, `backend/src/push/` (device auth),
  `backend/src/common/request-context.ts`, `backend/src/main.ts` (global pipes and guards),
  `frontend/src/store/authStore.ts`, `frontend/src/lib/api*.ts`; `docs/specs/row-level-security.md`,
  `docs/rls-runbook.md`, `SECURITY.md`.
- **Invariants:** INV-AUTH-001..005, INV-CLAIM-001, INV-PROFILE-001, INV-ACTIVITY-001,
  INV-PUSH (the authentication half).
- **Hint line:** `prioritize purpose binding and single use of step-up and emergency claims
  (conditional UPDATE, not read-then-write), refresh-token family rotation and logout under
  concurrency, lockout counters under parallel failures, delegated DTO allowlists, actor versus
  effective-owner attribution, ParseUUIDPipe and whitelist on every controller, userId never from
  the request, secrets never returned`.
- **Prior findings:** MON-H09, MON-M03, MON-M05, MON-M07, MON-M23, MON-M24, MON-M26, MON-L01.
- **Runtime:** `integration` (`auth`, `step-up`, `emergency`, `delegation` suites), `script`
  for the double-claim race, `mutation` on the claim's conditional predicate.
- **Output:** `03-security-auth.md`.

### S04 RLS and tenancy: policies, contexts, joint accounts, cross-owner transfers

- **Primary path:** `backend/src/common/db/`.
- **Secondary paths:** `database/migrations/*rls*`, `database/schema.sql` (every `CREATE
  POLICY`), `backend/eslint.config.mjs` (`WITH_CONTEXT_ALLOWLIST`, `RLS_EXEMPT_TABLES` and where
  it is checked), `backend/src/mcp/` (bearer-only context seeding), every `withSystemContext`
  and `withDelegateContext` call site from S01's list, `backend/test/integration/rls-*.spec.ts`;
  `docs/row-level-security-contract.md`, `docs/backend/database-access-and-tenancy.md`,
  `docs/specs/joint-accounts.md`, `docs/specs/cross-owner-transfers.md`.
- **Invariants:** INV-RLS-001, INV-SHARE-001..005, INV-TRANSFER-001.
- **Hint line:** `prioritize the runtime role and enforce mode, every exempt table with its
  reason, system-context call sites that read cross-user data and then write under one user,
  joint-account grants and revocation, the per-ledger status of a cross-owner transfer, the
  single sanctioned direct-DataSource exception, and whether the integration suites run under the
  unprivileged role`.
- **Prior findings:** MON-M06, MON-M14.
- **Runtime:** `integration` (`rls-*`, `joint-*`, `cross-owner*` suites), `mutation` (drop one
  policy predicate in the scratch worktree and confirm which suite fails).
- **Output:** `04-rls-tenancy.md`.

### S05 Migrations, schema parity, replicas

- **Primary path:** `database/migrations/` (the 56 timestamped files since 2026-08 in full; the
  numbered ones sampled against the upstream phase 3 inventory).
- **Secondary paths:** `database/schema.sql`, `backend/src/db-init.ts`, `backend/src/db-migrate.ts`,
  `backend/src/common/db/required-db-functions.ts`, every entity decorator for an index or
  constraint a migration declares, `scripts/verify-schema.sh`,
  `scripts/check-migration-prefixes.mjs`, `backend/docker-entrypoint.sh`, `helm/templates/`;
  `docs/database-migrations.md`, `docs/specs/horizontal-scaling.md`, `database/CLAUDE.md`.
- **Invariants:** INV-MIGRATION-001, INV-HA-001..005.
- **Hint line:** `prioritize idempotent replay of every migration on schema.sql, the
  three-place declaration of every index and constraint (migration, schema.sql, entity), NULL
  semantics of every nullable column added since August, backfills over legacy rows, migration
  runner serialization across replicas, and required-db-functions registration`.
- **Prior findings:** MON-M15, MON-L02.
- **Runtime:** `scripts/verify-schema.sh`, `npm run migration:lint`,
  `node scripts/check-migration-prefixes.mjs` (needs an unshallowed clone:
  `git fetch --unshallow origin` first, read-only), `integration` for the entity-decorator check
  (the suite builds from entities).
- **Output:** `05-migrations-schema.md`.

## Week 2

### S06 Backup, restore, support backup, attachments

- **Primary path:** `backend/src/backup/`.
- **Secondary paths:** `backend/src/attachments/` and its storage providers,
  `backend/src/common/shard-path.util.ts`, `backend/src/currencies/` (custom-currency portability),
  `frontend/src/lib/backupApi.ts`, `frontend/src/components/settings/`;
  `docs/backup-restore-contract.md`, `docs/support-backup.md`, `docs/external-side-effects.md`,
  `docs/specs/backup-off-machine.md`, `backup-storage-targets.md`,
  `backup-envelope-key-wrapping.md`, `docs/adr/0003-filesystem-objects-use-id-sharding.md`.
- **Invariants:** INV-BACKUP-001..009 (004, 005, 008 are `partial`), INV-ATTACHMENT-001..003.
- **Hint line:** `prioritize backup/restore atomicity, owner and instance namespace isolation,
  external attachment bytes versus metadata on every provider, ID remapping, restore ordering and
  deferred FKs, decompression bounds, one export snapshot, cleanup and rollback, legacy-backup
  compatibility, off-machine copy verification and reclaim, key wrapping and what the server can
  decrypt, support-backup de-identification`.
- **Prior findings:** MON-H01, MON-H02, MON-M08, MON-M09, MON-M10, MON-M11 (Helm half handed to
  S21), MON-M12, MON-M13, MON-M16, MON-M17, MON-M18, MON-M22, MON-M43, MON-M47, MON-L05.
- **Runtime:** `integration` (`backup*`, `restore*`, `attachment*` suites), `script`: a local
  provider export/restore round trip in a real temporary directory with non-empty attachment
  bytes and checksums, and a two-owner same-date automatic backup run.
- **Output:** `06-backup-restore.md`.

### S07 Cash ledger: transactions, accounts, transfers, splits, reconciliation

- **Primary path:** `backend/src/transactions/`.
- **Secondary paths:** `backend/src/accounts/`, `backend/src/common/deletion-balance.util.ts`,
  `backend/src/common/investment-filter.util.ts`, `backend/src/transactions/register-order.ts`,
  `backend/src/action-history/` (undo), the bulk, AI-action and MCP routes to the same writes
  (`backend/src/ai/query/tool-executor.service.ts`, `backend/src/mcp/tools/*`),
  `frontend/src/types/transaction*.ts`; `docs/financial-semantics.md`,
  `docs/financial-calculation-contract.md` section 7, `docs/concurrency-and-idempotency.md`,
  `docs/specs/split-bulk-update.md`, `register-sorting.md`, `advanced-search.md`,
  `account-balances-as-of.md`, `investment-transaction-status.md`.
- **Invariants:** INV-BALANCE-001, INV-TRANSFER-001, INV-REGISTER-001, INV-RECONCILE-001,
  INV-SEARCH-001..005 (001 `partial`), INV-CACHE-001, INV-API-001.
- **Hint line:** `prioritize stale-snapshot balance deltas versus atomic SQL on every mutation
  path (single, bulk, undo, AI, MCP, scheduled), the four-state VOID matrix on transfer legs,
  server-derived currency and rate on transfers, split sum and sign rules at four decimals,
  account closure versus a concurrent mutation, absolute recompute versus a concurrent delta,
  rejection before write, derived-state invalidation after commit, and the one search parser`.
- **Prior findings:** MON-H05, MON-H07, MON-H10, MON-H11, MON-M20, MON-M21, MON-M27, MON-M28.
- **Runtime:** `integration` (`transactions*`, `accounts*`, `transfer*`, `split*`,
  `reconcil*`, race suites), `script` for recompute-versus-delta and closure-versus-mutation with
  two connections, `mutation` on one lock and one atomic `UPDATE`.
- **Output:** `07-cash-ledger.md`.

### S08 Scheduler, cron matrix, job claims, loan posting

- **Primary path:** `backend/src/scheduled-transactions/`.
- **Secondary paths:** every service in `docs/cron-jobs.md` (claim mechanism per row from S01),
  the job-claim and lease service, `backend/src/notifications/` reminder crons,
  `backend/src/loan-installments/` (posting half), `backend/src/budgets/` period cron,
  `backend/src/net-worth/` recompute cron, `backend/src/securities/security-price.service.ts`
  (fetch-then-settle), `frontend/src/components/scheduled-transactions/`;
  `docs/cron-jobs.md`, `docs/backend/cron-and-background-work.md`,
  `docs/specs/scheduled-investment-fx-currency-pair.md`, `scheduled-loan-installment-pricing.md`.
- **Invariants:** INV-CRON-001 (`partial`), INV-OCCURRENCE-001..003, INV-CLAIM-001,
  INV-DISPATCH-001..004, INV-LOAN-HISTORY-001 (`partial`).
- **Hint line:** `prioritize one logical effect per tick across replicas for all 40 jobs,
  durable occurrence identity before money moves, the occurrence-first rule on every surface
  (nextOccurrenceEffectiveAmount, never amount), override lifecycle, lease and claim expiry
  versus a still-running worker, duplicate email from every replica, and retry after a partial
  commit`.
- **Prior findings:** MON-H06, MON-M25 (claim half; provider half to S17), MON-L06.
- **Runtime:** `integration` (`scheduled*`, `job-claim*`, `cron*` suites), `script`: two
  processes firing one tick with a barrier, `mutation` on the occurrence key.
- **Output:** `08-scheduler-cron.md`.

### S09 MNY import state machine

- **Primary path:** `backend/src/import/mny/` (XL: sample by state machine, not by file).
- **Secondary paths:** `backend/src/import/` (controller, DTOs, staging, entities),
  `database/migrations/*import*`, `frontend/src/components/import/`, `frontend/src/lib/import.ts`,
  `e2e/tests/import-mny.spec.ts`; `docs/import-ms-money.md`, `docs/ms-money-data-model.md`,
  `docs/specs/mny-import.md`.
- **Invariants:** INV-IMPORT-001..003 (003 `unenforced`).
- **Hint line:** `prioritize the job state machine (every state, transition, retry, crash,
  heartbeat, reap, stale request), the one-active-job index and its three-place declaration,
  retry after the data commit, wipe-before-claim ordering, staged-file expiry versus a running
  job, a retired job whose worker still commits, category collisions, and the monetary mapping of
  transfers, splits, investments and currencies from the MNY model`.
- **Prior findings:** MON-H03, MON-H04, MON-L04.
- **Runtime:** `integration` (`import*`, `mny*` suites), `script`: a failpoint after the data
  commit and a retry, `mutation` on the retired-job predicate.
- **Output:** `09-import-mny.md`.

### S10 CSV import, import preview, bank sync, transaction rules

- **Primary path:** `backend/src/transaction-rules/`.
- **Secondary paths:** `backend/src/bank-sync/`, `backend/src/import-preview/`, the CSV path in
  `backend/src/import/`, `backend/src/payees/` (lookup and AI payee matching), every creation
  path a rule must run on (single, bulk, import, bank sync, receipts, scheduled, AI, MCP),
  `frontend/src/components/rules/`, `frontend/src/components/import-preview/`;
  `docs/specs/transaction-rules-structural-actions.md`, `bank-sync.md`,
  `bank-sync-notifications.md`, `docs/import-csv-investment-spec.md`,
  `docs/future-plans/unified-import-preview.md`, `csv-source-profiles.md`.
- **Invariants:** INV-RULE-001..005 (001..004 `partial`), INV-BANKSYNC-001..004 (001
  `partial`), INV-API-001 (`partial`), INV-PAYEE-001..002.
- **Hint line:** `prioritize at-most-once import per bank transaction and per externalId under
  concurrency, rule application inside the inserting transaction on every creation path, preview
  equals commit for rules and imports, a rule never changing amount/account/date/status, the
  active-window check on unknown dates, bank credentials encrypted and never returned, provider
  failure multiplicity`.
- **Prior findings:** none owned; cross-check MON-M27 on the import creation path.
- **Runtime:** `integration` (`rule*`, `bank-sync*`, `import-preview*` suites), `script` for
  the duplicate-import race, `mutation` on the externalId uniqueness.
- **Output:** `10-rules-banksync-csv.md`.

## Week 3

### S11 Email receipts and document scanner

- **Primary path:** `backend/src/email-receipts/`.
- **Secondary paths:** `backend/src/email-receipts/{imap,oauth,mailbox,poll,parsing,parsers,ai,pipeline,receipts,import}/`,
  `backend/src/attachments/` (receipt bytes), `frontend/src/components/email-receipts/`,
  `frontend/src/lib/receipt-parser-form.ts`, `frontend/src/lib/document-scanner/`;
  `docs/specs/email-receipt-matching.md`, `email-receipt-trades.md`,
  `email-receipt-dividend-trades.md`, `email-receipt-linked-receipts.md`,
  `document-scanner.md`, `docs/external-side-effects.md`.
- **Invariants:** INV-RECEIPT-001..008, INV-TRADE-001 (the receipt-to-trade half).
- **Hint line:** `prioritize mailbox credentials and OAuth tokens (encrypted, scoped, never
  returned), email content as untrusted input to the AI parser and to HTML rendering (prompt
  injection, escapeHtml), parsed amounts and currencies as server-authoritative versus
  parser-supplied, at-most-once receipt-to-transaction and receipt-to-trade creation under
  poll retries, the executed-total-is-the-fact rule for parsed trades, partial pipeline failure
  and compensation, and provider call multiplicity`.
- **Prior findings:** none (module is new).
- **Runtime:** `integration` (`email-receipt*`, `receipt*` suites), `mutation` on the dedup
  key of receipt-to-transaction creation.
- **Output:** `11-email-receipts.md`.

### S12 Securities, holdings, trades, prices, providers

- **Primary path:** `backend/src/securities/` (XL: `investment-transactions.service.ts`,
  `holdings.service.ts`, `investment-replay.util.ts`, `investment-amount.util.ts`,
  `daily-change.util.ts`, `security-price.service.ts` in full; providers sampled).
- **Secondary paths:** the three provider services (`yahoo-finance`, `msn-finance`,
  `deutsche-boerse-finance`), `backend/src/provider-health/`, `backend/src/common/fx-entry.util.ts`,
  the scheduled investment path from S08, `frontend/src/components/investments/`,
  `frontend/src/components/securities/`, `frontend/src/lib/investments.ts`,
  `frontend/src/lib/security-detail.ts`, `frontend/src/types/investment.ts`;
  `docs/financial-calculation-contract.md`, `docs/time-series-contract.md`,
  `docs/backend/securities-and-providers.md`, `docs/specs/investment-account-consolidation.md`,
  `exchange-price-providers.md`, `intraday-historical-positions.md`, `security-price-alerts.md`.
- **Invariants:** INV-HOLDING-001..002, INV-TRADE-001, INV-PRICE-001 (`partial`),
  INV-PROVIDER-001, INV-INTRADAY-001, INV-FX-002.
- **Hint line:** `prioritize holdings updates and full rebuilds under concurrent trades, the
  single share-count reducer (SPLIT is a ratio), commission in cost basis versus cash versus UI
  wording, non-positive or reversed FX on an investment posting, preview equals commit through one
  resolver (rate and source disclosed), foreign-security transfer basis currency, a stored price
  in the security's currency, daily change needing a current close, provider negative caching and
  call multiplicity, and the executed-total-is-the-fact rule on edits`.
- **Prior findings:** MON-H08, MON-H14, MON-M29, MON-M30, MON-M35.
- **Runtime:** `integration` (`securities*`, `holding*`, `investment*` suites), `script`:
  two concurrent BUYs against one holding plus a rebuild, `mutation` on the holding lock and on
  the SPLIT branch of the reducer.
- **Output:** `12-securities-holdings.md`.

### S13 Valuation, FX, currencies, net worth, investment reports, Monte Carlo

- **Primary path:** `backend/src/currencies/`.
- **Secondary paths:** `backend/src/common/fx-aggregate.ts`, `backend/src/common/fx-fallback.guard.spec.ts`,
  `backend/src/common/time-series/`, `backend/src/securities/portfolio.service.ts`,
  `portfolio-calculation.service.ts`, `sector-weighting.service.ts`, `backend/src/net-worth/`,
  `backend/src/investment-reports/`, `backend/src/monte-carlo/`, `backend/src/common/number-locale.util.ts`,
  `frontend/src/lib/forecast.ts`, `frontend/src/hooks/useExchangeRates.ts`;
  `docs/specs/fx-conversion-completeness.md`, `fx-history-gap-fill.md`,
  `exchange-rate-canonical-orientation.md`, `exchange-rate-providers.md`,
  `portfolio-period-result.md`, `portfolio-movement-notifications.md`,
  `docs/future-plans/exchange-rate-canonical-orientation.md`, `portfolio-chart-boundaries.md`.
- **Invariants:** INV-FX-001..005 (001, 003 `partial`), INV-CURRENCY-001,
  INV-PORTRESULT-001..002, INV-PORTMOVE-001..002, INV-PORTCHART-001, INV-HOLDING-002 (historical
  replay half), INV-DISPLAY-001.
- **Hint line:** `prioritize rate 1 versus no rate on every surface (dashboard, reports,
  exports, AI, MCP, notifications, frontend), rate age bounds and never a rate struck after the
  date, pair orientation in storage and on read, FxAggregate with null total and knownSubtotal,
  fxComplete and pricesComplete carried to every consumer including the LLM shape, the
  multiplicative split in historical net-worth replay, Monte Carlo failure never a real zero,
  bulk deletion versus linked-account snapshots, custom-currency global cleanup from
  tenant-filtered evidence, a period change is not a return, cash is not an investment`.
- **Prior findings:** MON-H12, MON-H13, MON-M19, MON-M33, MON-M34, MON-M39, MON-M41.
- **Runtime:** `unit` (the FX fallback guard, replay guard), `integration` (`net-worth*`,
  `currenc*`, `exchange*`, `portfolio*` suites), `mutation` on the `resolveFxRate` age bound
  and on `FxAggregate.total`.
- **Output:** `13-valuation-fx-networth.md`.

### S14 Bonds

- **Primary path:** `backend/src/bonds/`.
- **Secondary paths:** the bond cron chain in `docs/cron-jobs.md` (benchmark, price, series,
  notification), `backend/src/securities/` where bond-linked holdings are valued,
  `frontend/src/components/bonds/`; `docs/specs/polish-retail-bonds.md`, `sovereign-bonds.md`,
  `bond-program-securities.md`, `bond-offer-and-history.md`, `bond-redemption-interest.md`,
  `bond-series-fetch.md`, `bond-notifications.md`, `redemption-accrued-interest.md`.
- **Invariants:** INV-BOND-001..010 (010 `partial`), INV-BONDNOTIFY-001..005, INV-REDEEM-001.
- **Hint line:** `prioritize a bond-linked holding valued from its own lots and never quantity
  times a blended price, accrued interest and day-count at redemption boundaries, engine price
  recompute after the benchmark refresh (ordering across replicas), early redemption fees and
  rounding residuals, series fetch idempotency and provider failure, and every total that can be
  partial`.
- **Prior findings:** none (module is new).
- **Runtime:** `integration` (`bond*` suites), numerical verification of at least one
  redemption example against the spec by hand.
- **Output:** `14-bonds.md`.

### S15 Loans and GEM strategies

- **Primary path:** `backend/src/loan-installments/`.
- **Secondary paths:** `backend/src/loan-rate-changes/`, `backend/src/loan-scenarios/`,
  `backend/src/scheduled-transactions/scheduled-transaction-loan.service.ts`,
  `backend/src/strategies/`, `frontend/src/lib/loan-history.ts`, `frontend/src/lib/loan-schedule.ts`,
  `frontend/src/components/reports/LoanAmortizationReport.tsx`,
  `frontend/src/components/strategies/`; `docs/specs/loan-installment-settlement.md`,
  `scheduled-loan-installment-pricing.md`, `mortgage-types.md`, `docs/gem-strategy.md`,
  `docs/specs/gem-signal-change-notifications.md`, `docs/future-plans/mortgage-types.md`.
- **Invariants:** INV-LOAN-001..011 (LOAN-HISTORY-001 `partial`).
- **Hint line:** `run the protocol's loan matrix in full: normal payment, principal-only extra
  payment, payment below accrued interest, payoff, one cent above and below payoff, rate change,
  same-day multiple payments, voided payment, duplicate posting; prioritize the final payment's
  parent amount versus its splits, ledger-backed interest history, schedule regeneration after a
  rate change, preview equals commit, and for GEM the signal computed from converted prices at one
  session with a refusal when a component is missing`.
- **Prior findings:** MON-M32.
- **Runtime:** `integration` (`loan*`, `strateg*`, `gem*` suites), numerical verification of
  every matrix row with a worked example in the report.
- **Output:** `15-loans-strategies.md`.

## Week 4

### S16 Budgets, reports, categories, payees, tags, calendar

- **Primary path:** `backend/src/budgets/`.
- **Secondary paths:** `backend/src/reports/`, `backend/src/built-in-reports/`,
  `backend/src/categories/`, `backend/src/payees/`, `backend/src/tags/`, `backend/src/calendar/`,
  `backend/src/common/investment-filter.util.ts`, CSV and PDF export paths,
  `frontend/src/components/budgets/`, `frontend/src/components/payees/`,
  `frontend/src/components/calendar/`; `docs/specs/sankey-cash-flow.md`,
  `report-tag-key-breakdown.md`, `calendar-view.md`, `balance-threshold-notifications.md`.
- **Invariants:** INV-REPORT-001..003, INV-SANKEY-001..005, INV-PAYEE-001..002, INV-DAYNOTE-001.
- **Hint line:** `prioritize a category's cost as its signed net within one category and never
  across two, transfer splits in budget spending, what a row is deciding the filter and never the
  account type, budget-alert check-then-insert, period rollover across replicas, exports giving
  the same server-authoritative figure as the screen, and partial totals captioned as partial`.
- **Prior findings:** MON-M31, MON-L03.
- **Runtime:** `integration` (`budget*`, `report*`, `categor*`, `payee*` suites), `mutation`
  on `isNetSpending`.
- **Output:** `16-budgets-reports.md`.

### S17 AI assistant, MCP tools, notifications, push

- **Primary path:** `backend/src/mcp/`.
- **Secondary paths:** `backend/src/ai/` (tool executor, query, relay, insights, usage),
  `backend/src/ai-review/`, `backend/src/notifications/`, `backend/src/notification-center/`,
  `backend/src/push/`, `backend/src/system-alerts/`, `backend/src/provider-health/`,
  `frontend/src/components/ai/`, `frontend/src/components/notifications/`, `frontend/src/lib/push.ts`;
  `backend/src/mcp/CLAUDE.md`, `docs/backend/mcp.md`, `docs/backend/ai-and-payees.md`,
  `docs/backend/notifications-and-push.md`, `docs/specs/notification-preferences.md`,
  `notification-transaction-cascade.md`, `system-alerts.md`, `provider-outage-alerts.md`,
  `ai-review-notifications.md`, `docs/future-plans/mcp-context-aware-listing.md`.
- **Invariants:** INV-MCP-001..004, INV-PUSH-001..011, INV-DISPATCH-001..004, INV-NOTIFY-001,
  INV-ALERT-001, INV-CACHE-001 (server half).
- **Hint line:** `prioritize every AI tool implemented once on a domain service and adapted by
  both the executor and the MCP layer (a tool in one layer only is a finding), the compact LLM
  shape carrying every completeness flag, MCP scopes bound to the current token not the session,
  every write tool reaching the same refusals as the HTTP path (VOID, currency, ownership),
  prompt content as untrusted input, insight generation across replicas, push subscription
  lifecycle and the chart artifact TTL, and dispatch at-most-once`.
- **Prior findings:** MON-M04, MON-M25 (provider half).
- **Runtime:** `unit` (tool-parity guards), `integration` (`mcp*`, `ai*`, `notification*`,
  `push*` suites).
- **Output:** `17-ai-mcp-notifications.md`.

### S18 Frontend core: lib, types, hooks, store, cache

- **Primary path:** `frontend/src/lib/` (XL: `apiCache.ts`, `api*.ts`, every formatter,
  `investments.ts`, `forecast.ts`, `transactions.ts` in full; the rest sampled).
- **Secondary paths:** `frontend/src/types/` (each type against its backend DTO: a field the
  type omits, a flag read as `!flag`), `frontend/src/hooks/`, `frontend/src/store/`
  (`persisted-storage.guard.test.ts`), `frontend/src/lib/cache-prefix-classification.guard.test.ts`,
  `frontend/src/test/ui-conventions.test.ts`, `frontend/src/components/layout/AppHeader.tsx`;
  `frontend/CLAUDE.md`, `docs/frontend/api-and-cache.md`, `docs/frontend/financial-figures.md`,
  `docs/frontend/forms-and-formatting.md`.
- **Invariants:** INV-CACHE-001, INV-DISPLAY-001, INV-FX-001 (client half), INV-OCCURRENCE-003
  (client half).
- **Hint line:** `prioritize the backend-to-frontend contract matrix (every nullable or
  optional field with its absent/undefined/null/zero meaning), completeness flags read === false,
  cache families and invalidation after every mutation (budget progress, balances, holdings),
  sumConverted and sumEffectiveOccurrences versus raw fields, number and date localization by
  preference, failed logout presented as success, persisted-store contents, and a formatter that
  rounds a rate as money`.
- **Prior findings:** MON-M36, MON-M38, MON-M42.
- **Runtime:** `unit` (`npm run test -- lib hooks store types`), `mutation` on one cache
  invalidation and one `=== false` read.
- **Output:** `18-frontend-core.md`.

### S19 Frontend forms round trip

- **Primary path:** `frontend/src/components/transactions/`.
- **Secondary paths:** `frontend/src/components/accounts/`,
  `frontend/src/components/scheduled-transactions/` (`OverrideEditorDialog.tsx`),
  `frontend/src/components/investments/` and `securities/` forms, `frontend/src/components/import/`,
  `frontend/src/components/settings/` (backup, danger zone, reauthentication),
  `frontend/src/components/rules/`, `frontend/src/components/ui/` (date and money inputs),
  the request DTOs each form serializes to; `docs/frontend/forms-and-formatting.md`,
  `docs/frontend/ui-conventions.md`, `e2e/tests/transactions.spec.ts`, `settings.spec.ts`,
  `zz-danger-zone.spec.ts`.
- **Invariants:** INV-OCCURRENCE-003, INV-TRANSFER-001 (client half), INV-AUTH-003 (client
  half), INV-DISPLAY-001.
- **Hint line:** `trace the protocol's browser round trip for every form that influences
  money, authorization or identity: persisted value to rendered control to blur to serializer to
  DTO; prioritize an unchanged value re-emitted as a change, empty input becoming zero, a stored
  override price replaced by a live quote on open, two-decimal editing of four-decimal data and
  the one-cent tolerance, hidden fields still serialized, the reauthentication artifact sent on
  destructive actions, and the one date input and one money formatter`.
- **Prior findings:** MON-H15, MON-M37, MON-M40, MON-H11 (client half), MON-M28 (client half).
- **Runtime:** `unit` (component suites), one Playwright spec per traced form against the E2E
  stack (`docker compose -f docker-compose.e2e.yml up -d --wait`, then
  `npm test -- <spec>` from `e2e/`) where the stack can start in the container.
- **Output:** `19-frontend-forms.md`.

### S20 Frontend figures, reports, dashboard, pages, i18n

- **Primary path:** `frontend/src/components/reports/` (XL: sampled by figure, every file
  that renders a total, a gain, a tax or a percentage).
- **Secondary paths:** `frontend/src/components/dashboard/`, `frontend/src/components/budgets/`,
  `frontend/src/components/strategies/`, `frontend/src/components/bonds/`,
  `frontend/src/components/email-receipts/`, `frontend/src/app/` (page composition and route
  guards), `frontend/src/i18n/`, `frontend/src/components/tours/`, `whats-new/`;
  `docs/frontend/financial-figures.md`, `docs/frontend/tables-and-registers.md`,
  `docs/frontend/theming.md`, `docs/frontend/pwa-push-share.md`.
- **Invariants:** INV-DISPLAY-001, INV-PORTRESULT-001..002, INV-PORTCHART-001, INV-SANKEY,
  INV-REPORT, INV-SHARE (client half).
- **Hint line:** `prioritize every total rendered from a server field that can be null or
  partial (caption relabelled, never a subtotal under a total's caption), valuationComplete read
  where the number is shown, a percentage only over the result, period change versus return,
  cash versus investments, the one money formatter and number localization, locale catalogs in
  parity with no hand-edited pseudo-locale, and a page that fetches under the wrong owner on a
  delegated session`.
- **Prior findings:** MON-H16.
- **Runtime:** `unit` (component suites for the sampled figures), `npm run i18n:check`,
  `npm run build` for the bundle gate.
- **Output:** `20-frontend-figures.md`.

## Week 5

### S21 Tests, CI, release, deployment manifests

- **Primary path:** `.github/workflows/ci.yml`.
- **Secondary paths:** every `jest*.json`, `vitest.config.*`, `backend/scripts/test-changed.mjs`,
  `frontend/scripts/test-changed.mjs`, coverage exclusions, `.github/workflows/*` (release,
  preview), `scripts/*.mjs`, `scripts/verify-schema.sh`, `docker-compose*.yml`, `helm/`,
  `Dockerfile*`, `.env.example`, `e2e/playwright*.config.ts`, the guard tests named in
  `docs/guard-tests.md`; `docs/verification-contract.md`, `docs/testing-contract.md`,
  `docs/release-integrity.md`, `README.md` deployment sections.
- **Invariants:** INV-RELEASE-001 (`partial`), INV-HA-001 (deployment half).
- **Hint line:** `prioritize zero discovered tests as a failure on every job, the tested
  imaged and tagged revision being one revision, passWithNoTests and skipped tests, coverage
  exclusions hiding a load-bearing file, known-wrong tests (search for the four unconfirmed ones
  in docs/verification-contract.md section 5), mock fidelity at the boundaries S03..S17 marked
  undetected, a deployment default (Helm, Compose) that disables a protection or a persistent
  mount, and documentation promising a guarantee no mechanism holds`.
- **Deliverable beyond the report:** the program-wide mutation table, merging every session's
  `undetected` rows, and the known-wrong test register.
- **Prior findings:** MON-M01, MON-M11 (Helm half), MON-M44, MON-M45, MON-M46, MON-L07.
- **Runtime:** `node scripts/check-env-docs.mjs`, `node scripts/check-docs-manifests.mjs`,
  `mutation` for every HIGH finding of the program not yet executed, the full `TZ=UTC npm run
  test:unit -- --coverage` once to read the thresholds against the exclusions.
- **Output:** `21-tests-ci-release.md`.

### S22 Delta review: `AUDIT_BASELINE_SHA` to `main`

- **Primary path:** `git diff 72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86...origin/main` (fetch
  `main` read-only; the audit branch stays pinned).
- **Hint line:** `treat the delta as a PR whose base is AUDIT_BASELINE_SHA: re-pin to the
  current main SHA for this session only, inspect the delta, re-run every invariant a session
  marked material that the delta touches, classify every change against the open A26 findings
  (fixed, unchanged, reopened, new), and run the adversarial approval challenge on the delta's new
  abstractions`.
- **Prior findings:** every `STILL_OPEN` row of the register, re-checked against `main`.
- **Runtime:** the suites the delta touches, at the `main` SHA, in a separate worktree.
- **Output:** `22-delta-review.md`, with both SHAs in its metadata.

### S23 Consolidation, final report, remediation task list

- **Inputs:** every `NN-*.md`, `ledger.md`, `prior-findings-register.md`.
- **Hint line:** `merge duplicates across sessions by root cause (Rule 7), re-assess every
  severity independently, build the rejected-hypothesis table for the program, the
  BLOCKER/HIGH verification ledger with execution evidence, the coverage ledger naming what was
  not audited, the prioritized remediation plan, and the task list`.
- **Output:** `23-final-report.md` and `remediation-tasks.md` (plan section 9).
