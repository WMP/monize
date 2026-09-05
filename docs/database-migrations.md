# Database migrations: rules, guards, and recovery

Reference for how `database/migrations/*.sql` is applied, why every migration
body has to be re-runnable, and how to recover when one fails at startup.

Contributor checklist for writing a migration lives in `database/CLAUDE.md`;
this document is the operational side.

## How migrations run

`backend/src/db-migrate.ts` runs on every backend start (dev and production):

1. Creates the `schema_migrations` tracking table if absent.
2. Lists `database/migrations/*.sql`, in prefix order -- numeric on the prefix,
   then the full filename (see "Filenames" below).
3. Skips filenames already present in `schema_migrations`.
4. For each remaining file, in order: `BEGIN`, the whole file as one query,
   `INSERT INTO schema_migrations`, `COMMIT`.
5. Any failure rolls that file back and exits non-zero — **fail fast**. A
   partially migrated database is never served.

Two consequences worth internalising:

- **The tracker keys off the filename, not the content.** Editing a migration
  that some database has already applied means that database never sees the new
  content. Ship a new timestamp-prefixed file instead. For the same reason a
  migration is never renamed: the new name is a migration no database has
  recorded, and it re-runs the body everywhere.
- **A file that fails leaves no tracker row**, so the next startup re-runs the
  whole body. If the body is not idempotent, that retry fails the same way and
  the pod crash-loops.

## Filenames

Two prefix forms live side by side in `database/migrations/`:

| Form | Example | Status |
|---|---|---|
| `NNN_description.sql` | `191_payee_lookup_ai_enabled.sql` | Historical. The set is frozen; nothing new is written under it, and nothing in it is renumbered. |
| `YYYYMMDDHHMMSS_description.sql` | a migration authored at 2026-09-05 14:30:00 UTC starts 20260905143000_ | Every new migration. The prefix is the UTC second of authoring: `date -u +%Y%m%d%H%M%S`. |

The counter was retired because it was a manually policed global value that
did not scale with parallel work (issue #1277): two branches from one base both
correctly read "the current max is 164", both correctly picked 165, and nothing
either could do locally detected the other. Six earlier pairs had got through the
same way. A timestamp is known before a PR exists and cannot be generated twice.

**Apply order is numeric on the prefix, then the full filename**, and that rule
is written once -- `backend/src/common/db/migration-filename.ts` -- and imported
by the runner, the integration harnesses, the migration lint and the prefix
check; `scripts/verify-schema.sh` reproduces it with `sort -n`, and
`migration-filename.spec.ts` runs that pipeline against the comparator. A string
sort agrees with numeric order today only by a coincidence of digits -- every
historical prefix begins with 0 or 1 and every timestamp with 2 -- and the
five-digit band scheme the issue first considered would have broken it outright
(13120 sorts before 168 as a string). Ordering by value makes the apply order a
fact about numbers, not leading digits; every fourteen-digit timestamp then
follows every three-digit prefix, so the transition is additive and the
historical files are untouched.

Two consequences:

- **Apply order is authoring order, not merge order.** A migration authored on
  Monday and merged Friday replays before one authored Tuesday and merged
  Wednesday on a fresh install, while an upgraded database ran them the other
  way round. The counter had the same property (prefixes were assigned at
  authoring time too); timestamps only make it visible. A migration must not
  depend on the ordering of another *in-flight* migration.
- **The prefix check changed shape.** `scripts/check-migration-prefixes.mjs`
  used to require a new prefix to exceed the base branch's maximum, which a
  later-merging older PR would now legitimately fail. It requires instead that
  every migration a branch adds is timestamp-prefixed and names a real UTC
  instant between the scheme's adoption and now, that no three-digit prefix
  exceeds the highest one ever issued (`LEGACY_PREFIX_CEILING`), that nothing
  on the base branch has gone missing, and -- as before -- that no prefix is
  used twice outside the six grandfathered pairs.

## The idempotency rule

> Every statement in a migration must be a no-op when the object it creates
> already exists.

This is not a style preference. Three routine situations re-run a body that
already took effect:

- a crash or pod eviction between the DDL and the `schema_migrations` INSERT;
- a restore from a snapshot taken mid-deploy;
- a fresh install, where `schema.sql` already contains everything and every
  migration then runs on top of it (this is what `scripts/verify-schema.sh`
  checks).

The failure mode is a crash-loop at startup with a message like
`trigger "update_x_updated_at" for relation "x" already exists`, and the only
way out is hand-editing `schema_migrations` — which is what happened with
`056_monte_carlo_scenarios.sql` in the PR #192 thread.

### Guard recipes

| Statement | Guard |
|---|---|
| `CREATE TABLE` / `CREATE INDEX` / `CREATE UNIQUE INDEX` | `IF NOT EXISTS` |
| `ALTER TABLE ... ADD COLUMN` | `ADD COLUMN IF NOT EXISTS` (never omit the `COLUMN` keyword — the guard needs it) |
| `DROP` anything (`TABLE`, `INDEX`, `TRIGGER`, `POLICY`, `COLUMN`, `CONSTRAINT`, ...) | `IF EXISTS` |
| `ALTER TABLE ... ADD CONSTRAINT c` | precede it with `ALTER TABLE ... DROP CONSTRAINT IF EXISTS c` (Postgres has no `ADD CONSTRAINT IF NOT EXISTS`), or wrap in a `DO` block that checks `pg_constraint` |
| `CREATE TRIGGER t` | precede it with `DROP TRIGGER IF EXISTS t ON tbl`, or wrap in a `DO` block that checks `pg_trigger` |
| `CREATE POLICY p` | precede it with `DROP POLICY IF EXISTS p ON tbl` (the RLS migrations do this inside a `format()` loop) |
| `CREATE EXTENSION` / `SEQUENCE` / `SCHEMA` | `IF NOT EXISTS` |
| `CREATE FUNCTION` / `CREATE VIEW` | `CREATE OR REPLACE` |
| `CREATE TYPE` | wrap in a `DO` block that checks `pg_type` |
| `ALTER TYPE ... ADD VALUE` | `ADD VALUE IF NOT EXISTS` |
| `INSERT INTO` (data backfill) | `ON CONFLICT DO NOTHING` / `DO UPDATE`, or `WHERE NOT EXISTS` |
| `UPDATE` / `DELETE` backfill | write the `WHERE` clause against the pre-migration state (`WHERE kind IS NULL`) so a second pass matches nothing |

Statements that need no guard because re-running them is already a no-op:
`ALTER COLUMN ... TYPE / SET DEFAULT / SET NOT NULL / DROP NOT NULL`,
`ENABLE ROW LEVEL SECURITY`, `COMMENT ON`, `GRANT`.

The `DO`-block form, for reference (`056` and `093` use it):

```sql
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_x_updated_at') THEN
        CREATE TRIGGER update_x_updated_at
            BEFORE UPDATE ON x
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;
```

### The two gates that enforce it

| Gate | Command | What it proves |
|---|---|---|
| Static lint | `cd backend && npm run migration:lint` | Every statement carries a guard, a preceding `DROP ... IF EXISTS`, or an enclosing conditional `DO` block. Runs in the "Backend Lint & Type Check" job; self-test is `npm run migration:lint:test`. |
| Runtime double-apply | `scripts/verify-schema.sh` (needs Docker) | Every migration applies cleanly on top of `schema.sql` **twice**, and the resulting schema still matches `schema.sql`. Runs in the "Schema vs Migrations Drift" job. |

The lint has an escape hatch for a statement that is provably re-runnable in a
way the rules cannot see. The reason is mandatory:

```sql
-- migration-lint-disable-next-line insert-without-on-conflict: table is empty until this migration
INSERT INTO ...
```

## Recovering from a failed migration at startup

The runner prints a block naming the file, the SQLSTATE, every diagnostic
Postgres supplied (`detail`, `hint`, `where`, table/column/constraint), and the
line and column of the failing statement when the error carries a position. Read
that first — it usually names the object involved.

### Case 1: the SQL is wrong

The transaction rolled back, so the database is untouched and
`schema_migrations` has no row for the file. Fix the SQL in the same file (it was
never applied anywhere) and restart. Nothing else to clean up.

### Case 2: "already exists" — the body is not re-runnable

SQLSTATE `42701` (duplicate_column), `42710` (duplicate_object), `42723`,
`42P06`, `42P07` (duplicate_table). The migration is already partly there, which
means the body needs a guard, not a database edit:

1. Add the guard from the recipes above to the offending statement.
2. Verify: `cd backend && npm run migration:lint`.
3. Restart. The guarded body now completes and records itself.

Guarding the file is always preferable to marking it applied by hand: the guard
fixes every other install too, including the ones that have not upgraded yet.

### Case 3: "does not exist" — a missing object or the wrong order

SQLSTATE `42P01` (undefined_table), `42703` (undefined_column), `42704`,
`42883`. Two distinct causes:

- A `DROP` (or an `ALTER` of something already removed) that needs `IF EXISTS`
  — guard it, as in case 2.
- The migration ran ahead of whatever creates the object: a database that never
  had `schema.sql` applied, or a filename that sorts before its prerequisite.
  Check the named object against `database/schema.sql`; on a fresh database, run
  `db-init` (which applies `schema.sql`) before `db-migrate`.

### Case 4: the object exists but the migration cannot be made to skip it

Rare, and only when the migration's remaining statements are genuinely already
in effect (e.g. someone applied the DDL manually). Confirm the end state matches
what the migration would have produced, then record it:

```sql
-- Inspect first: what does the tracker think is applied?
SELECT filename, applied_at FROM schema_migrations ORDER BY filename DESC LIMIT 10;

-- Only after confirming the schema already matches the migration's end state:
INSERT INTO schema_migrations (filename) VALUES ('YYYYMMDDHHMMSS_the_migration.sql')
ON CONFLICT DO NOTHING;
```

Then open a follow-up to guard the file, so the next install does not need the
same manual step.

### Case 5: the runner never got to a migration

"Migration runner failed before or between migrations." — nothing was applied.
Causes are environmental: database unreachable, wrong `DATABASE_*` credentials,
or the role lacking rights on `schema_migrations`. Check the connection settings
and the database's own logs; no schema recovery is needed.

## Verifying before you push

```bash
cd backend
npm run migration:lint          # static guard check (fast)
npm run migration:lint:test     # self-test for the lint itself

cd ..
scripts/verify-schema.sh        # applies every migration twice on schema.sql (Docker)
```

If Docker is unavailable, the equivalent by hand against any throwaway Postgres:
apply `database/schema.sql`, then apply every file in
`database/migrations/` in order, then apply them all again — the second pass must
be silent.
