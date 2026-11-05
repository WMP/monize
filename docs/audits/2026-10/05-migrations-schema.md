# S05 Migrations, schema parity, replicas

## 1. Metadata

| Field | Value |
| --- | --- |
| Session | S05 (parallel wave, orchestrator session_018Nx7aian3f7dpRX5msjFBg) |
| `AUDIT_BASELINE_SHA` | `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86` |
| `git rev-parse HEAD` at start | `4adfd72f5dd74d4fa04937dd766c0d51e264bb1c` (pin check: `git diff --stat 72c59ec4 HEAD -- . ':!docs/audits/2026-10' ':!docs/audits/2026-08-upstream'` empty) |
| Date | 2026-10-21 |
| Primary path | `database/migrations/` |
| Hint line | `prioritize idempotent replay of every migration on schema.sql, the three-place declaration of every index and constraint (migration, schema.sql, entity), NULL semantics of every nullable column added since August, backfills over legacy rows, migration runner serialization across replicas, and required-db-functions registration` |
| Status | complete |
| Runtime executed | Node 24.22.1 (`/opt/nvm`); backend `npm ci` OK; PostgreSQL 16 (`mirror.gcr.io/library/postgres:16-alpine`) in Docker. `scripts/verify-schema.sh`: OK (both passes, "every retained migration is a no-op when replayed on top of schema.sql"). `npm run migration:lint:test`: 0 failed. `npm run migration:lint`: OK, 233 files, one registered one-shot (`166_heal_loan_schedule_end_dates.sql`). `git fetch --unshallow origin` then `node scripts/check-migration-prefixes.mjs`: OK (233 migrations, 0 added vs `origin/main` at `72c59ec4`). Three throwaway integration specs in a scratch worktree at the baseline (`<scratchpad>/wt`, never on the audit branch): the three-place catalog diff, the two-replica startup race (baseline and lock-removed mutation), and the `ON CONFLICT` arbiter probe. Mutation runs: `src/db-init.spec.ts` + `src/db-migrate.spec.ts`, `src/common/db/app-role.spec.ts`, `test/integration/runtime-role.integration.spec.ts`. Repository integration suites run (one worker, sequential): see section 12. |

## 2. Invariant map

| ID | Statement | Mechanism named | Status after this session |
| --- | --- | --- | --- |
| INV-MIGRATION-001 | Migrations apply in numeric prefix order; a new prefix cannot collide | `backend/src/common/db/migration-filename.ts` comparator, imported by `db-migrate.ts`, harnesses, lint and `scripts/check-migration-prefixes.mjs`; `verify-schema.sh` uses `sort -n` | held (prefix check and lint green; runner applied 233 files in order in the race run) |
| S05-A (repo rule, `database/CLAUDE.md`) | Every migration body is a no-op when replayed on an up-to-date database | `verify-schema.sh` (two passes on `schema.sql`), `migration-lint.mjs` | held for schema shape; not proven for data backfills (empty database) |
| S05-B (repo rule, `AGENTS.md` "Database and migration review") | An index or constraint is declared in migration, `schema.sql` and entity | none for unique keys or CHECKs; `schema-entity-parity.integration.spec.ts` covers FK delete rules only | **violated**: A26-S05-01 |
| S05-C (repo rule, `docs/database-migrations.md` "expand first, contract in a later release") | The previous release keeps working on the new schema for the length of a rollout | review only (the doc says no guard catches it) | **violated once** in the 56: A26-S05-02 |
| S05-D | A one-time data backfill that changes a column's meaning reaches every row that will carry the old meaning | the migration's own `UPDATE`; nothing on the restore path | **violated**: A26-S05-03 |
| INV-HA (startup serialization, MON-L02) | Only one process initializes or migrates at a time | session advisory lock `DB_LIFECYCLE_LOCK_KEY = 4150293001` (`backend/src/common/db/advisory-locks.ts`), taken by `db-init.ts:71`, `db-migrate.ts:300`, `db-demo-check.ts:74`, `database/seed.ts:36`, each re-reading state after acquiring | held, executed (section 6 row M1) |
| MON-M15 / DR-02 | The runtime role may read but never write `schema_migrations` | `APP_ROLE_GRANTS_SQL` revoke loop (`backend/src/common/db/app-role.ts:155-162`), re-applied by `db-migrate.ts` after DDL via `applyAppRoleGrants` | held, executed (section 6 row M2) |
| S05-E (repo rule) | Every SQL function `src/` calls is registered in `required-db-functions.ts` | `REQUIRED_DB_FUNCTIONS`, boot check `missingDbFunctions` in `db-migrate.ts` and `main.ts` | held: all six functions referenced from `src/` are registered; the eight unregistered functions are trigger functions no `src/` code calls |
| INV-HA-001..005 | Replica-shared state (counters, single-use tokens, OIDC keys, relay prompts) | tables from `20260917194655`, `20260917200518`, `20260917215817`, `20260918014500`, `20260918203802`; each arbiter is a PK or unique key | storage layer held: every `ON CONFLICT` target in `src/` on these tables has an arbiter in both `schema.sql` and the entity harness (section 7); the service-level claims are S03/S17 scope |

Material flows:

- `migration file -> db-migrate (lock, applied-set read, BEGIN, body, INSERT schema_migrations, COMMIT) -> applyAppRoleGrants -> missingDbFunctions -> main.ts`.
- `schema.sql -> db-init (lock, users-table probe, apply) -> provisionAppRole/grants -> enforce-mode role check`.
- `entity metadata -> TypeORM synchronize (integration harness) -> applyRlsPolicies (RLS, trigger and function migrations, updated_at triggers, exclusion constraints from schema.sql) -> every integration suite`. This is the flow A26-S05-01 breaks: the harness is the evidence base for every race and constraint claim in `docs/verification-contract.md`, and it does not carry the production constraints.
- `previous release pod -> new schema during rollout` (A26-S05-02).
- `backup from release N -> restore into release N+k -> rows that never saw N+1's backfill` (A26-S05-03).

## 3. Lens ledger

| Lens | Result |
| --- | --- |
| Pin the exact revision | ran (section 1) |
| Repository instructions first | ran: `AGENTS.md`, `CLAUDE.md`, `backend/CLAUDE.md`, `database/CLAUDE.md`, `docs/database-migrations.md` (lines 1-160), `docs/system-invariants.md` INV-MIGRATION-001 and INV-HA-001..005, `.claude/commands/audit.md` |
| Summaries as hypotheses | ran: MON-M15 and MON-L02 re-derived from code and executed, not taken from the fix commits' prose |
| Invariant model first | ran (section 2) |
| Complete change surface | ran: all 56 timestamped migrations read in full; every `ON CONFLICT` target in `backend/src` mapped to its arbiter; every `CREATE FUNCTION` in `schema.sql` mapped to `src/` callers; 7 numbered migrations modified after `d5cea9bf` diffed |
| Cross-layer verification | ran for migration -> schema.sql -> entity -> harness -> service (`budget-period.service.ts`, `tags.service.ts`, `bank-sync-operation-tags.ts`, `ai-review-requests.service.ts`, `mortgage-type.util.ts`, `security-price.service.ts`) |
| Representation boundary | ran for the NUMERIC change in `20260908130000` (float8 to NUMERIC(9,4) in the same release that added the column, so no released reader saw float8); for nullable columns (section 8) |
| Browser/UI round trip | not applicable because the slice is schema and startup; no form in it writes a migrated column the session could trace end to end. The two UI-facing columns touched (`hidden_table_columns`, `view_defaults`) are `NOT NULL DEFAULT '{}'` additions with no meaning change; S19 owns the forms |
| Server-authoritative metadata | not applicable because no migration in the slice adds a client-supplied provenance or authority field |
| Identity versus value | ran: `bond_programs`/`bond_instruments` unique natural keys, `email_receipts (mailbox_id, uid_validity, uid)`, `transactions (account_id, external_id)` partial unique |
| State machine | ran at the constraint level only: `ai_review_requests` kind/status CHECKs and the three partial unique "open" indexes, `ai_relay_prompts` status CHECK, `backup_offsite_uploads` status CHECK. The transitions themselves are S10/S11/S17/S06 |
| Concurrency and idempotency | ran: two-replica startup race executed (section 6 M1); arbiter existence for every `ON CONFLICT` (section 7) |
| Partial failure and compensation | ran: a failed migration rolls back its body and its tracker row in one transaction (`db-migrate.ts` BEGIN..COMMIT); the mutated race shows the loser exits 1 after ROLLBACK and the survivor completes |
| External/provider lookup | not applicable because no migration or startup step calls a provider |
| Database and migration | ran (the slice's main lens): forward migration, schema representation, entity mapping, constraints, indexes, nullability, defaults, old rows, backfills, mixed data, restore compatibility |
| Backup/restore | ran only for restore compatibility of migration backfills (A26-S05-03); S06 owns the rest |
| Financial and loan | ran only for `accounts_mortgage_type` backfill and the NULL fallback (`mortgageTypeOf`); rejected in section 8 |
| Authorization, authentication and RLS | ran for the runtime role's privileges on `schema_migrations` (executed) and for every new user-owned table shipping `ENABLE ROW LEVEL SECURITY` plus a policy in its own file (all 19 do); S04 owns the policy semantics |
| Tests are evidence | ran: harness-vs-production schema diff executed (A26-S05-01); unit and integration suites for the lock and the revoke mutated |
| Mutation | ran (section 6) |
| Counterexample | ran (section 7) |
| Interaction | ran (section 7) |
| Rejected hypotheses | section 8 |
| Suggested fix diff | per finding |
| Adversarial approval challenge | section 13 |

## 4. Confirmed findings

### A26-S05-01 (MEDIUM) The integration harness lacks 15 production unique keys and 82 production CHECK constraints, and no guard compares them

1. **Severity:** MEDIUM
2. **Confidence:** high
3. **Location:** `backend/test/integration/schema-entity-parity.integration.spec.ts:29-160` (the only schema/entity parity guard; FK delete rules only); `backend/test/helpers/integration-setup.ts:52-70` (`synchronize: true`); `backend/test/helpers/rls-setup.ts:335-476` (`applyRlsPolicies`, which restores policies, triggers, functions and exclusion constraints but no unique key or CHECK); `backend/src/budgets/entities/budget-period.entity.ts:32` vs `database/schema.sql:2407` and `backend/src/budgets/budget-period.service.ts:237-243`; the 15 keys listed below.
4. **Violated invariant:** S05-B, the `AGENTS.md` rule that an index or constraint is declared in the migration, `schema.sql` and an entity decorator, "because the integration suite builds from entities, so a missing decorator lets race tests pass against a database with no constraint to contend over"; and `docs/verification-contract.md` VER-001's premise that a two-connection integration test is evidence about production.
5. **Realistic reproduction scenario:** Build the harness exactly as every integration suite does (`INTEGRATION_TYPEORM_OPTIONS` + `applyRlsPolicies`), build a second database from `schema.sql`, and diff `pg_index`/`pg_constraint`. Executed in the scratch worktree: the harness has no unique arbiter for these 15 production keys:
   - `budget_periods (budget_id, period_start)`, `budget_period_categories (budget_period_id, budget_category_id)`, `categories (user_id, name, parent_id)`, `import_column_mappings (user_id, name)`, `ai_provider_configs (user_id, provider, priority)`, `loan_rate_changes (account_id, effective_date)`, `account_delegates (owner_user_id, delegate_user_id)`, `account_delegate_grants (delegation_id, account_id)`;
   - expression or token indexes: `tags (user_id, lower(name))`, `payee_aliases (user_id, lower(alias))`, `loan_scenarios (user_id, account_id, lower(name))`, `emergency_access_contacts (owner_user_id, lower(email))`, `refresh_tokens (token_hash)`, `personal_access_tokens (token_hash)`, `trusted_devices (token_hash)`.

   And 82 production CHECK constraints are absent from the harness (61 of them on tables created or changed by the 56 migrations since 2026-08), among them `ck_ai_review_requests_parser_draft_shape`, `ck_ai_review_requests_trade_shape`, `ck_email_receipt_mailboxes_credentials`, `ck_bank_sync_accounts_linked_has_cutoff`, `accounts_prepayment_mode_linear_only`, `accounts_payment_amount_method_check`, `ck_calendar_day_notes_span`, `ck_backup_offsite_uploads_status`. The harness has no CHECK that production lacks.

   Concrete consequence, executed: `INSERT INTO budget_periods ... ON CONFLICT (budget_id, period_start) DO NOTHING` (the statement `BudgetPeriodService.createPeriodForBudget` issues) returns `INSERT 0 0` on the `schema.sql` database and `ERROR: there is no unique or exclusion constraint matching the ON CONFLICT specification` on the harness database. The production write path that decides "who creates this month's period" therefore cannot run in any integration suite; no integration suite calls it (`budget-period-rollover.integration.spec.ts:24-26` tests only the job claim in front of it and says "the rollover's own writes ... have their own specs", which are unit specs with mocks).
6. **Observed implementation behavior:** Each suite that needs a production key re-creates it by hand (`bank-sync.integration.spec.ts:2268-2280` creates and drops `idx_tags_user_name`; `email-receipts-schema.integration.spec.ts` builds a separate `schema.sql` database because "every other integration suite builds its schema from entity metadata, which creates none of the CHECK constraints"). Every other suite runs without them. The parity guard asserts only `ON DELETE` rules, with a 55-entry shrink-only baseline.
7. **Expected behavior:** The harness carries every unique key, exclusion constraint and CHECK `schema.sql` declares, or a guard fails the build when an entity omits one, the way the FK guard does for delete rules.
8. **Impact:** Data integrity and verification. A race or duplicate-write test over any of the 15 keys passes against a database with no constraint to contend over (`refresh_tokens.token_hash`, `personal_access_tokens.token_hash` and `trusted_devices.token_hash` are the token lookup keys; `account_delegates`/`account_delegate_grants` are the delegation keys; `categories`, `tags`, `payee_aliases` decide find-or-create convergence). A write that a production CHECK rejects (a parser-draft row of the wrong shape, an OAuth mailbox carrying a password) passes every integration suite and fails only in production, as a 500. No present-day production corruption was established: production has the constraints. The defect is that the suite the repository names as its evidence for these properties cannot observe them, and `ON CONFLICT` paths on missing keys are untestable at the integration level.
9. **Root cause:** The rule "declare it in all three places" has no machine check for unique keys or CHECKs; `schema-entity-parity` was written for the P2-009 FK case only, and `applyRlsPolicies` restores the categories TypeORM "cannot express" (exclusion constraints) but not the ones the entities simply omit.
10. **Recommended correction:** Extend the parity guard to unique keys (including partial and expression indexes) and CHECK constraints, with the same shrink-only baseline shape; then shrink the baseline by declaring the keys on the entities (`@Unique`, `@Index(..., { unique: true, where })`, `@Check`) or, for expression indexes TypeORM cannot express, by having `applyRlsPolicies` apply them from `schema.sql` the way it applies exclusion constraints.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/test/integration/schema-entity-parity.integration.spec.ts
+++ b/backend/test/integration/schema-entity-parity.integration.spec.ts
@@
+  /**
+   * Unique keys and CHECKs schema.sql declares that the entity-built harness
+   * lacks. Shrink-only, like KNOWN_DRIFT: a race test over a key that is not
+   * here runs against a database with nothing to contend over.
+   */
+  const KNOWN_MISSING_KEYS: string[] = [
+    "account_delegate_grants|UNIQUE (delegation_id, account_id)",
+    // ... the 15 unique keys and 82 CHECKs found at 72c59ec4, sorted
+  ];
+
+  it("carries every unique key and CHECK schema.sql declares", async () => {
+    const prod = await catalogOf(await schemaSqlDatabase());
+    const harness = await catalogOf(dataSource);
+    const missing = prod.filter((k) => !harness.has(k)).sort();
+    expect(missing.filter((k) => !KNOWN_MISSING_KEYS.includes(k))).toEqual([]);
+    expect(KNOWN_MISSING_KEYS.filter((k) => !missing.includes(k))).toEqual([]);
+  });
--- a/backend/src/budgets/entities/budget-period.entity.ts
+++ b/backend/src/budgets/entities/budget-period.entity.ts
@@
-@Entity("budget_periods")
+@Entity("budget_periods")
+@Unique("budget_periods_budget_id_period_start_key", ["budgetId", "periodStart"])
```

12. **Recommended regression test:** the extended parity guard above, plus a two-connection integration test of `createPeriodForBudget` for one budget and one month.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+++ b/backend/test/integration/budget-period-create-race.integration.spec.ts
+it("two concurrent creations of one month's period leave one row and both succeed", async () => {
+  const [a, b] = await Promise.all([
+    withUserContext(ownerId, () => periodsA.createPeriodForBudget(ownerId, budget, monthStart)),
+    withUserContext(ownerId, () => periodsB.createPeriodForBudget(ownerId, budget, monthStart)),
+  ]);
+  expect(a.id).toBe(b.id);
+  expect(await count("budget_periods", { budget_id: budget.id })).toBe(1);
+});
```

    Fails today with 42P10 in the harness, which is the point: it cannot pass until the key is in the harness.
14. **Verification method:** run the extended guard on the baseline (expect the baseline list), add the `@Unique`, re-run (expect the entry to leave the list), run the race test.
15. **Residual risks / patch limitations:** declaring a key on an entity changes nothing in production (no `synchronize` there), so the fix is test-only; expression indexes need the `schema.sql`-extraction route; the baseline approach keeps the gap visible but does not close it.

Causality: `PRE_EXISTING_UNREPORTED` for the 15 unique keys (all on tables older than `d5cea9bf`; the upstream phase 7 inventory row for `integration-setup.ts` says the harness "can hide ... migration differences" without naming one); `NEW_SINCE_UPSTREAM_AUDIT` for the 61 CHECKs on tables from the 56 new migrations. One finding per Rule 7: one violated rule, one root cause. Execution evidence: `<scratchpad>/three-place.json` (catalog diff) and the arbiter probe in section 7.

### A26-S05-02 (LOW) `20260908120000_remove_notification_browser.sql` drops a column the previous release still selects

1. **Severity:** LOW
2. **Confidence:** high
3. **Location:** `database/migrations/20260908120000_remove_notification_browser.sql:5`; commit `8e2f78bc5` (2026-09-06) removed the entity property and added the `DROP COLUMN` in one change (the file was later renamed from `188_` to its timestamp); 1.15.1 (`f20c561f6`) `backend/src/users/entities/user-preference.entity.ts:49-50` maps `notification_browser`.
4. **Violated invariant:** S05-C, `docs/database-migrations.md` "Two versions of the code run against one database during a rollout": `DROP COLUMN` is forbidden in the release that stops writing the column.
5. **Realistic reproduction scenario:** An install on 1.15.x upgrades to any release from 1.16.0 to 1.19.0 with the chart's default `RollingUpdate` (`maxSurge: 1`, `maxUnavailable: 0`). The new pod runs `db-migrate` and commits the drop while the 1.15.x pod still serves. Every TypeORM read of `UserPreference` on the old pod selects `"UserPreference"."notification_browser"`. Executed on the `schema.sql` database: `SELECT "UserPreference"."notification_browser" FROM user_preferences "UserPreference"` fails `column UserPreference.notification_browser does not exist`.
6. **Observed implementation behavior:** contract shipped in the same release as the writer's removal.
7. **Expected behavior:** 1.16.0 stops mapping the column; a later release drops it.
8. **Impact:** availability for the length of the rollout (every request on the old pod that reads preferences fails), longer if the new pod's readiness stalls with both generations live. Self-heals when the old pod is gone. No data loss (the column was dormant).
9. **Root cause:** no guard for expand/contract; the documentation says so ("the only thing that catches a contract shipped too early is somebody asking").
10. **Recommended correction:** the migration is merged and shipped, so it is never edited. Release notes for upgrades from 1.15.x or earlier should name the transient failure, or say to upgrade through 1.15.x -> 1.16.x with a `Recreate` rollout. For the future, a lint rule: a migration whose body contains `DROP COLUMN`, `RENAME`, `SET NOT NULL`, or a narrowing `ALTER TYPE` on a table that exists in the previous release's `schema.sql` must name, in a marked comment, the release in which the writer stopped, and `migration-lint.mjs` refuses one that does not.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/scripts/migration-lint.mjs
+++ b/backend/scripts/migration-lint.mjs
@@
+// contract-without-expand: DROP COLUMN / RENAME / SET NOT NULL must carry
+//   -- contract-after: <version>
+// naming the release that stopped using the old shape.
+const CONTRACT = /\b(DROP\s+COLUMN|RENAME\s+(COLUMN|TO)|SET\s+NOT\s+NULL)\b/i;
+if (CONTRACT.test(body) && !/^--\s*contract-after:\s*\d+\.\d+\.\d+/m.test(raw)) {
+  report(file, "contract-without-expand", "a contract statement needs -- contract-after: <version>");
+}
```

12. **Recommended regression test:** a `migration-lint` self-test fixture with a bare `DROP COLUMN` that must be refused, and one with the marker that passes.
13. **Suggested regression-test diff (illustrative, not applied):** one fixture pair under `backend/scripts/migration-lint.test.mjs` asserting the rule id `contract-without-expand`.
14. **Verification method:** `npm run migration:lint:test && npm run migration:lint` (the existing migrations need markers or a grandfather list).
15. **Residual risks / patch limitations:** a marker is a claim, not a proof; only a test that runs the previous release's image against the new schema proves it.

Causality: `NEW_SINCE_UPSTREAM_AUDIT`. It is the only contract-in-one-step among the 56: the other drops (`provider_missing_*` in `20260920163144`) remove columns no release ever shipped; the type change in `20260908130000` and the `NOT NULL`/constraint drop in `20260912200152` act on objects created in the same release.

### A26-S05-03 (LOW) The `skip_price_updates` meaning change is a one-time backfill that a restore of an older backup bypasses

1. **Severity:** LOW
2. **Confidence:** medium
3. **Location:** `database/migrations/20261012131846_securities_skip_price_updates_user_switch.sql` (1.19.0); `backend/src/securities/security-price.service.ts:213-225` (refresh now honours the flag alone); `backend/src/backup/` has no transform for the column (only `support-backup-rules.ts:439` names it).
4. **Violated invariant:** S05-D, the hint's "backfills over legacy rows": a migration that changes what a stored value means must reach every row that carries the old meaning, including rows that arrive later from an artifact written under the old meaning.
5. **Realistic reproduction scenario:** On 1.18.x a user imports a Money file (imports set `skip_price_updates = true`, `security-price.service.ts:1862`) and then sets a provider override; under 1.18 the override wins and the security refreshes. The user takes a backup. The instance upgrades to 1.19.0 (the migration clears the flag on the live row). Later the user restores the 1.18 backup: the row comes back with `skip_price_updates = true` and a provider, the migration never runs again, and under 1.19 semantics the security stops refreshing.
6. **Observed implementation behavior:** restore copies the column as stored.
7. **Expected behavior:** the restore applies the same normalization to rows exported before 1.19, or the backup carries the release that wrote it so the restore can.
8. **Impact:** stale prices for the affected securities after a restore; visible as the "disable price updates" switch being on, so a person can repair it. No money moves.
9. **Root cause:** a semantic flip implemented only as a migration `UPDATE`; the backup envelope's version is compared for equality and does not change when a column's meaning does (`backup-format.ts:291-305`).
10. **Recommended correction:** apply the migration's predicate in the restore for the `securities` section (`skip_price_updates = false WHERE skip_price_updates AND (quote_provider IS NOT NULL OR msn_instrument_id IS NOT NULL)`) when the artifact predates 1.19, or unconditionally if the predicate is judged safe for current exports.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/backup/backup-restore-database.service.ts
+++ b/backend/src/backup/backup-restore-database.service.ts
@@ after the securities section is inserted
+    // 20261012131846 changed what skip_price_updates means; a row exported
+    // before it carries the old meaning and must be normalized the same way.
+    await m.query(
+      `UPDATE securities SET skip_price_updates = false
+        WHERE user_id = $1 AND skip_price_updates
+          AND (quote_provider IS NOT NULL OR msn_instrument_id IS NOT NULL)`,
+      [userId],
+    );
```

12. **Recommended regression test:** restore a fixture backup holding such a row and assert the flag reads false.
13. **Suggested regression-test diff (illustrative, not applied):** a case in `backup-restore.integration.spec.ts` with one security row `{ skip_price_updates: true, quote_provider: 'yahoo' }`.
14. **Verification method:** the integration case; confirm a row with the flag and no provider keeps it.
15. **Residual risks / patch limitations:** applied unconditionally it would also clear a flag a 1.19 user set deliberately on a security with a provider; the release-gated form needs the exporting version in the artifact, which it does not carry today. S06 decides.

Causality: `NEW_SINCE_UPSTREAM_AUDIT`. Not executed (LOW; static trace of migration, reader and restore); handed to S06 for the restore-compatibility generalization.

## 5. Prior-finding dispositions

| ID | Disposition | Evidence |
| --- | --- | --- |
| MON-M15 (runtime role can write migration history) | `FIXED_VERIFIED` | Mechanism: `APP_ROLE_GRANTS_SQL` revokes `INSERT, UPDATE, DELETE` on `schema_migrations` from the runtime role after the blanket grant (`backend/src/common/db/app-role.ts:155-162`), re-applied by `db-migrate.ts` after DDL so the first boot also converges (`applyAppRoleGrants`). Test: `test/integration/runtime-role.integration.spec.ts` (forged INSERT, DELETE, UPDATE refused; SELECT allowed) and `src/common/db/app-role.spec.ts`. Executed: after the real `db-init` + `db-migrate` sequence on a fresh database, `has_table_privilege('monize_app','schema_migrations', ...)` is SELECT true, INSERT/UPDATE/DELETE/TRUNCATE false. Mutation M2 (revoke replaced by `NULL`) fails both the unit spec (4 tests) and the integration spec (1 test). Residual, by design: at `RLS_MODE=off`/`shadow` the application connects as the owner and can write the ledger; the revoke protects only enforce-mode deployments. |
| MON-L02 (init and migration runners not serialized across replicas) | `FIXED_VERIFIED` | Mechanism: session advisory lock `pg_advisory_lock(4150293001)` with `lock_timeout 600s` (`backend/src/common/db/advisory-locks.ts`) taken by `db-init.ts:71` before the users-table probe and by `db-migrate.ts:300` before the applied-set read; also by `db-demo-check.ts` and `database/seed.ts`. Executed: two concurrent `initDatabase()` then two concurrent `runMigrations()` on one fresh database: all four `ok`, no `process.exit`, 233 of 233 rows in `schema_migrations`. Mutation M1 (both lock calls removed): one initializer exits 1, one migrator exits 1 with `Migration failed: 018_user_currency_preferences.sql sqlstate 23505`. Test that catches the mutation: `src/db-init.spec.ts` and `src/db-migrate.spec.ts` (6 failures, call-order assertions on a mock). No repository test races two real runners (section 10). The superseded evidence path `helm/templates/statefulset-backend.yaml` is gone; the chart now ships `helm/templates/deployment-backend.yaml` with a rolling update. |

## 6. Mutation table

| # | Invariant | Mutation (file:line, what) | Test that fails | Verdict |
| --- | --- | --- | --- | --- |
| M1 | MON-L02 startup serialization | `backend/src/db-init.ts:71` and `backend/src/db-migrate.ts:300`, `await acquireDbLifecycleLock(client)` removed | `src/db-init.spec.ts`, `src/db-migrate.spec.ts` (6 failed); audit race script fails (exit 1 twice, 23505) | detected (by mock-order unit specs only; no real-concurrency repository test) |
| M2 | MON-M15 ledger write revoke | `backend/src/common/db/app-role.ts:160`, `REVOKE ... ON public.%I` replaced by `NULL` | `src/common/db/app-role.spec.ts` (4 failed), `test/integration/runtime-role.integration.spec.ts` (1 failed) | detected |
| M3 | S05-B three-place declaration | conceptual: delete `UNIQUE(budget_id, period_start)` from `schema.sql:2407` and its migration | none: no suite runs the `ON CONFLICT` path, and the harness already lacks the key | **undetected** (A26-S05-01) |
| M4 | S05-B | conceptual: delete any of the 82 CHECKs from an entity-less declaration (e.g. `ck_ai_review_requests_parser_draft_shape`) | only `email-receipts-schema.integration.spec.ts` for the email-receipt tables; none for `accounts`, `bank_sync_*`, `backup_offsite_*`, `transaction_rules`, `calendar_day_notes` checks | **undetected** for the tables outside the email-receipt schema spec |
| M5 | S05-C expand/contract | conceptual: any new `DROP COLUMN` of a column the previous release maps | none (`migration:lint` and `verify-schema.sh` both pass it; the docs state this) | **undetected** (A26-S05-02) |
| M6 | S05-A replay idempotency | conceptual: remove `IF NOT EXISTS` from `20261012145720` `CREATE UNIQUE INDEX` | `migration:lint` (static) and `verify-schema.sh` pass 1 | detected (not executed; the lint's self-test fixtures cover the pattern, `migration:lint:test` 0 failed) |

## 7. Counterexamples and the interaction scenario

Counterexample per invariant:

- S05-B: `budget_periods` `ON CONFLICT (budget_id, period_start)`: `INSERT 0 0` on `schema.sql`, `ERROR 42P10` on the harness (executed). Every other `ON CONFLICT` target in `backend/src` (39 distinct table/column sets) has an arbiter on both databases (executed probe over `pg_index`); `tags` finds-or-creates with a target-less `ON CONFLICT DO NOTHING` whose arbiter, `idx_tags_user_name`, exists only in production and in the one bank-sync suite that creates it by hand.
- S05-C: the 1.15.x `UserPreference` select against the current schema fails 42703 (executed).
- S05-D: the restore path described in A26-S05-03 (static).
- MON-L02: lock removed, two replicas: 23505 on the tracker or DDL and exit 1 (executed); lock present: four clean exits (executed).
- MON-M15: lock and grants as shipped: runtime role cannot INSERT/UPDATE/DELETE/TRUNCATE the ledger (executed).

Interaction scenario (A26-S05-01 x A26-S05-02 x MON-L02): an operator upgrades a two-replica 1.15.x deployment to 1.19.0. Pod B1 takes the lifecycle lock and applies 121 migrations; pod B2 waits on the lock (correct, MON-L02 fixed). During that window the two 1.15.x pods keep serving; once B1 commits `20260908120000`, their preference reads fail 42703 (A26-S05-02) until the rollout replaces them. B1's run then reaches `20261012145720` (a unique index build on `transactions`), which holds the lock while the liveness probe (`helm/values.yaml:282-288`, 10 s + 3 x 60 s) is not answered because the process has not reached `app.listen`; on a large database a run longer than about 190 s gets the lock holder killed mid-migration, the open migration rolls back, and the pod restarts (design risk DR-S05-1). None of this is visible to the integration suite, which never runs the migrations against an old schema and does not carry the keys the migrations declare (A26-S05-01).

## 8. Rejected hypotheses

| Candidate | Evidence considered | Why rejected or downgraded | Final classification |
| --- | --- | --- | --- |
| Rule-less AI review requests escape `uq_ai_review_requests_open` (NULLs distinct) | `ai-review-requests.service.ts:183-330` | Known and handled: the receipt path takes an advisory lock and a `WHERE NOT EXISTS`; the only `enqueue` caller (`transaction-rules-applier.service.ts:812`) always passes a rule id | REJECTED |
| Mortgages created by a 1.17 pod during the 1.18 rollout keep `mortgage_type NULL` and are priced as annuities | `mortgage-type.util.ts:162-180`, `plan-loan-settlement.ts:260-264` | Every consumer reads through `mortgageTypeOf`, which falls back to the legacy flags; the CHECKs added in `20261002151116`/`20261003000245`/`20261003000246` all admit NULL | REJECTED |
| Restoring a backup without `calendar_day_notes.end_date` fails the `NOT NULL` | `20260912034642` and `20260912200152` both first shipped in 1.17.0 | No released artifact lacks the column | REJECTED |
| Seven merged numbered migrations were edited after `d5cea9bf` (037, 111, 112, 113, 114, 117, 123) | `git diff d5cea9bf 72c59ec4 -- database/migrations/` | 111/113/114/117/123: comments only. 037 and 112: replay guards (`to_regclass` skip) added for the `budget_alerts -> notifications` rename in 179, so a replay on `schema.sql` no longer fails; a database that applied the old body is unaffected because the tracker never re-runs it, and the new body does the same thing where the table exists | REJECTED (no behavior change on any deployed database) |
| Deleted migrations (`174_notification_throttle_minutes`, `20260920110943_currency_provider_history_floor`, `149_emergency_access_generation_compat`) left orphan tracker rows or columns on deployed databases | release trees `c1fdebd87`..`3cac8b895` | None shipped in a release; the `provider_missing_*` columns the second one added are dropped by `20260920163144` for any `main` build that ran it | REJECTED |
| `currency_code_in_use_globally` loses its `REVOKE ... FROM PUBLIC` when redefined by `CREATE OR REPLACE` in `20260920163144` and `20261010190000` | PostgreSQL keeps a function's ACL on `CREATE OR REPLACE`; `schema.sql:4327` revokes on fresh installs | ACL preserved on both paths | REJECTED (not executed: `verify-schema.sh` dumps `--no-privileges`, so this is not covered by the drift job; recorded in section 10) |
| `bond_instruments` auto-named unique constraint (64 characters) differs between migration and `schema.sql` | catalog diff: `bond_instruments_issuer_country_code_issuer_code_series_cod_key` on both | Same truncation on both paths; the harness has an equivalent key under a TypeORM name, and no code names the constraint | REJECTED |
| A required SQL function is called from `src/` but unregistered | every `CREATE FUNCTION` in `schema.sql` vs `backend/src` callers | The six called functions are registered; the eight others are trigger functions | REJECTED |
| `pg_advisory_lock($1)` with 4150293001 resolves to the two-int overload or overflows | key > 2^31 is a valid `bigint`; one-argument overload is bigint only | Executed: the race run acquired and serialized | REJECTED |

## 9. Design risks

- **DR-S05-1 Liveness probe vs the lock holder.** `db-init`/`db-migrate` run before `app.listen`; the chart's liveness probe (`helm/values.yaml:282-288`: `initialDelaySeconds: 10`, `periodSeconds: 60`, default `failureThreshold: 3`) kills a container that has not answered in about 190 s, and nothing distinguishes "migrating" from "hung". A single migration longer than that (an index build or table rewrite on a large table) is killed and rolled back on every attempt, a deterministic crash loop on that database only. Followers waiting on the lock are also killed, which is harmless. `advisory-locks.ts` itself says "a large migration run can hold the lock for minutes". Decision needed: a `startupProbe` with a long budget, or running migrations as a pre-upgrade Job. Not a present-day failure for a household-sized database.
- **DR-S05-2 Off/shadow mode owner writes the ledger.** By design the runtime is the owner at `RLS_MODE=off|shadow`, so MON-M15's protection applies only under `enforce`.
- **DR-S05-3 Session lock requires a direct connection.** Documented in `advisory-locks.ts`: through a transaction-mode pooler the lock and the DDL can land on different server sessions. Nothing checks it at startup for the migrator (INV-HA-001's LISTEN check runs later, in `main.ts`).
- **DR-S05-4 Redundant index.** `idx_transaction_rules_user_position` duplicates the btree of `uq_transaction_rules_user_position` (same columns, same order), the case `20260912131500` already fixed for calendar notes; cost is one extra index write per rule save.
- **DR-S05-5 Boot check covers called functions, not triggers.** Invariants held by triggers (`bond_reject_mutation` for INV-BOND-001, `guard_job_claim_lease_ownership`, `reject_unfenced_import_checkpoint`, the attachment tombstone triggers) are not part of `REQUIRED_DB_FUNCTIONS`; a database whose trigger was dropped by hand boots and serves.

## 10. Missing tests and known-wrong tests

- No repository test races two real `runMigrations()`/`initDatabase()` processes; MON-L02's fix is held by mock-order unit specs (`db-init.spec.ts`, `db-migrate.spec.ts`) and the lock-primitive test `demo-seed-lock.integration.spec.ts`. The audit's script (`zz-audit-migrate-race`) is the shape such a test would take.
- No guard for unique-key or CHECK parity between entities and `schema.sql` (A26-S05-01).
- No integration test of `BudgetPeriodService.createPeriodForBudget` concurrency; impossible today without the key (A26-S05-01).
- `verify-schema.sh` dumps with `--no-privileges` and `--no-comments`, so function ACLs (`REVOKE EXECUTE ... FROM PUBLIC` on SECURITY DEFINER functions) and comments are outside the drift job; it also runs on an empty database, so no data backfill in the 56 migrations is exercised by it (the per-migration specs `mortgage-type-backfill`, `migration-149-backfill`, `migration-140-preflight` cover three).
- No lint for contract-without-expand (A26-S05-02; the documentation states this).
- No known-wrong test found in the slice.

## 11. Documentation inconsistencies

- `backend/test/integration/email-receipts-schema.integration.spec.ts` header: "entity metadata ... creates none of the CHECK constraints". Sixteen entities carry `@Check` (e.g. `transaction-rule.entity.ts:52`, `scheduled-transaction-posting.entity.ts:46-47`, `exchange-rate-coverage.entity.ts:39`); the correct statement is "most", 82 of the production CHECKs being absent.
- `AGENTS.md` / `.claude/commands/audit.md` state the three-place rule as if held; nothing holds it for unique keys or CHECKs (A26-S05-01).
- `backend/src/common/db/required-db-functions.ts`: `currency_code_in_use_globally` names `136_currency_global_liveness.sql` as its migration; the body in force is `20261010190000_currency_in_use_bond_instruments.sql` (after `20260920163144`). Harmless for the existence check, misleading for an operator reading the boot failure.
- `scripts/verify-schema.sh` and `database/CLAUDE.md` are precise about what is proven ("no-op when replayed on top of schema.sql", not historical upgrade parity); consistent.

## 12. Review ledger

- **Directories inspected:** `database/migrations/`, `database/`, `backend/src/common/db/`, `backend/test/helpers/`, `backend/test/integration/` (constraint-related specs), `helm/templates/`, `helm/values.yaml` (probes), `scripts/`.
- **Files in full:** the 56 timestamped migrations (`20260906235944` .. `20261018052801`); `backend/src/db-init.ts`; `backend/src/db-migrate.ts`; `backend/src/common/db/advisory-locks.ts`; `backend/src/common/db/required-db-functions.ts`; `backend/docker-entrypoint.sh`; `scripts/verify-schema.sh`; `database/CLAUDE.md`; `backend/test/integration/schema-entity-parity.integration.spec.ts`; `backend/test/helpers/test-database.ts`.
- **Files sampled with ranges:** `backend/src/common/db/app-role.ts:60-268`; `backend/test/helpers/integration-setup.ts:36-75,200-250`; `backend/test/helpers/rls-setup.ts:335-476`; `docs/database-migrations.md:30-110`; `docs/system-invariants.md:180-185,6657-6772`; `backend/src/ai-review/ai-review-requests.service.ts:180-330`; `backend/src/budgets/budget-period.service.ts:225-250`; `backend/src/accounts/mortgage-type.util.ts:160-200`; `backend/src/loan-installments/plan-loan-settlement.ts:258-264,420-442`; `backend/src/transaction-rules/transaction-rules-applier.service.ts:790-830`; `backend/test/integration/bank-sync.integration.spec.ts:2265-2310`; `backend/test/integration/budget-period-rollover.integration.spec.ts:1-40`; `backend/test/integration/email-receipts-schema.integration.spec.ts:1-60`; `docs/audits/2026-08-upstream/03-database-backup.md:479-635`; numbered migrations sampled against the upstream section 8 inventory: the 7 modified files diffed in full, the 3 deleted files traced to release trees; `git diff --name-status d5cea9bf 72c59ec4 -- database/migrations/` = 121 added, 7 modified, 0 deleted (upstream inventory 111 files; 112 at `d5cea9bf` counting `000`).
- **Searches performed:** every `ON CONFLICT (` in `backend/src`; every `CREATE FUNCTION` in `schema.sql` against `backend/src`; `@Check(` in entities; `ADD CONSTRAINT|CREATE UNIQUE INDEX` in integration specs; `acquireDbLifecycleLock`, `RUNTIME_READ_ONLY_TABLES`; `skip_price_updates` in `backend/src/backup`; `mortgageType` NULL handling; release membership of each of the 56 migrations (`1.16.0`: 6, `1.17.0`: 19, `1.18.0`: 18, `1.19.0`: 13).
- **Suites and scripts run:** `scripts/verify-schema.sh` OK; `npm run migration:lint:test` 0 failed; `npm run migration:lint` OK (233 files); `node scripts/check-migration-prefixes.mjs` OK after `git fetch --unshallow origin`; audit scratch specs (worktree): three-place diff (ran), startup race baseline (passed), startup race mutated (failed as expected); `src/db-init.spec.ts` + `src/db-migrate.spec.ts` under M1: 6 failed / 39 passed; `src/common/db/app-role.spec.ts` under M2: 4 failed / 15 passed; `test/integration/runtime-role.integration.spec.ts` under M2: 1 failed / 26 passed; repository integration suites on the baseline, one worker (`npm run test:integration -- schema-entity-parity|migration-path|migration-140|migration-149|mortgage-type-backfill|email-receipts-schema|runtime-role|demo-seed-lock|rls-enable|bond-reference-tables|calendar-day-notes|transaction-external-id`): 12 suites passed, 161 tests passed, 0 failed.
- **Areas reviewed without a finding:** replay idempotency of all 56 (guards present on every statement; executed); RLS enable + policy shipped in the same file for each of the 19 user-owned tables the 56 create; RLS-exempt tables (`push_chart_artifacts`, `auth_attempt_counters`, `single_use_tokens`, `oauth_instance_config`, `fetch_sync`, `update_check_state`, `http_throttle_counters`, `auto_backup_policy`, bond reference tables) carry no owner column; no migration names a role; arbiters for every `ON CONFLICT` except `budget_periods` in the harness; `required-db-functions` registration; the startup lock and the ledger revoke (executed).
- **Open hypotheses handed on:**
  - from S05 to S06: semantic backfills are not re-applied to restored legacy rows (A26-S05-03 is one instance); check every migration since 2026-08 that rewrites existing values (`20261002151116` mortgage_type, `20261012131846` skip_price_updates, `20260919193554` auto_backup_policy copy) against what a restore of an older artifact writes.
  - from S05 to S21: liveness probe vs long migration (DR-S05-1); a startup probe or pre-upgrade Job is a chart decision.
  - from S05 to S21: a real two-process `runMigrations()` race test belongs in the integration suite (section 10).
  - from S05 to S04: harness lacks `account_delegates`/`account_delegate_grants` unique keys; any delegation race test S04 relies on runs without them.
  - from S05 to S10/S11: rule deletion sets `ai_review_requests.rule_id` to NULL on open requests, turning them into rule-less open requests that the receipt path's `WHERE NOT EXISTS` then treats as a conflict for that transaction (`ai-review-requests.service.ts:300-318`); check whether a receipt can be pushed into `review_conflict` by an unrelated rule deletion.
- **Ledger text for the orchestrator:** S05 done; findings B/H/M/L = 0/0/1/2; MON-M15 `FIXED_VERIFIED`, MON-L02 `FIXED_VERIFIED`; toolchain rows: `scripts/verify-schema.sh` OK, `check-migration-prefixes.mjs` OK after unshallow (clone now unshallowed, 7011 commits); undetected mutation rows: M3, M4, M5 (section 6); deviation: S01 dependency waived per the parallel-wave override, PostgreSQL started with `docker run` (`monize-pg`) rather than `docker compose ... up postgres`, scratch specs ran in a worktree at the baseline.

## 13. Adversarial approval challenge

Started from the slice's own abstractions rather than the findings: the lifecycle lock, the replay-on-`schema.sql` contract, the ledger revoke, the harness as evidence, and the boot function check.

- **Lock.** Searched for every process that runs DDL or seeds at startup (`docker-entrypoint.sh`: `db-init`, `db-migrate`, `db-demo-check`, `seed`); all four take the same key and re-read after acquiring. Searched for a second key or a `pg_try_advisory_lock` on this path: none. Checked the timeout reset (`RESET lock_timeout` after acquisition) so migrations keep server behavior. Executed both the fixed and the broken shape. Found: DR-S05-1 (probe), DR-S05-3 (pooler), no defect.
- **Replay.** Executed `verify-schema.sh`; then asked what it cannot see: privileges, comments, data. Checked ACL preservation on the two `CREATE OR REPLACE` of the SECURITY DEFINER function (preserved by PostgreSQL semantics); checked every data `UPDATE` in the 56 for re-run safety (calendar `end_date`, mortgage backfill, skip flag: all guarded by their own predicate; `auto_backup_policy` by `ON CONFLICT (id) DO NOTHING`). Found A26-S05-03 on the restore side, not the replay side.
- **Ledger revoke.** Asked whether any path recreates `schema_migrations` writes after the revoke: default privileges re-grant only on newly created tables; `db-migrate` re-runs the revoke after DDL each boot; TRUNCATE was never granted. Executed the privilege matrix. No defect beyond DR-S05-2.
- **Harness.** Did not assume the FK guard implied a key guard; diffed the catalogs. Found A26-S05-01, then probed every `ON CONFLICT` target to separate "missing but unused" from "missing and on a production write path" (one: `budget_periods`).
- **Boot check.** Mapped every function to its callers; found the trigger gap (DR-S05-5), not a registration defect.
- **Expand/contract.** Checked every one of the 56 migrations against the previous release's tree, not only the obvious drops. Found A26-S05-02 and nothing else.

Nothing found by the challenge raises a finding above MEDIUM. The two HIGH-shaped questions in the slice (a migration race corrupting the ledger, the runtime role forging it) were executed and do not reproduce at the baseline.

## 14. Verdict

`APPROVE` for the slice: no BLOCKER or HIGH survived the adversarial challenge. One MEDIUM (A26-S05-01, verification defect) and two LOW (A26-S05-02, A26-S05-03) are recorded for the remediation plan; MON-M15 and MON-L02 are fixed and verified by execution.
