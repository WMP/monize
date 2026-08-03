import { DEFAULT_APP_USER, RlsMode } from "./rls-config";

/**
 * Startup verification that `RLS_MODE=enforce` is actually enforcing.
 *
 * Selecting the application role and supplying its password is not the same as
 * connecting under one: PostgreSQL exempts a superuser, a role with `BYPASSRLS`,
 * and the owner of a table (unless the table is `FORCE ROW LEVEL SECURITY`) from
 * every policy on it. An operator who points `DATABASE_APP_USER` at the database
 * owner, or at a pre-existing role that happens to hold `BYPASSRLS`, gets a
 * successful boot, a log line saying enforce, and no database-level tenant
 * boundary at all (P2-006). Provisioning cannot substitute for this check: a
 * role that already exists is only altered, the deployment may provision the
 * role declaratively (CNPG `managed.roles`) where the application never touches
 * it, and an attribute granted after startup is invisible either way.
 *
 * So the runtime asks the database, over the connection it will actually serve
 * requests on, what it is -- and refuses to start when the answer is not the
 * unprivileged role the mode promises. Fail closed: a wrong answer here means
 * every later query silently sees every tenant.
 *
 * At `off`/`shadow` the runtime connects as the owner on purpose, so the check
 * is skipped by design.
 */

/** Minimal query surface shared by `DataSource`, `pg.Client` and test doubles. */
export interface RuntimeRoleQuerier {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}

export interface RuntimeRoleFacts {
  /** The role the connection is actually authenticated as. */
  currentUser: string;
  isSuperuser: boolean;
  hasBypassRls: boolean;
  /** True when this role owns the database it is connected to. */
  ownsDatabase: boolean;
  /**
   * How many tables with RLS enabled this role owns. A table's owner is exempt
   * from its policies unless the table is FORCE ROW LEVEL SECURITY, which this
   * schema deliberately does not use (owner/migration operations run outside
   * enforcement by design), so owning even one policied table is a hole.
   */
  ownedPoliciedTables: number;
}

/**
 * One round trip. `pg_roles` is world-readable, `pg_database.datdba` and
 * `pg_class.relowner` likewise, so an unprivileged role can answer all of this
 * about itself -- no elevated grant is needed to run the check.
 */
export const RUNTIME_ROLE_FACTS_SQL = `
SELECT current_user AS current_user_name,
       r.rolsuper AS is_superuser,
       r.rolbypassrls AS has_bypass_rls,
       (d.datdba = r.oid) AS owns_database,
       (SELECT count(*)
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relkind = 'r'
           AND c.relrowsecurity
           AND c.relowner = r.oid) AS owned_policied_tables
  FROM pg_roles r
  JOIN pg_database d ON d.datname = current_database()
 WHERE r.rolname = current_user
`.trim();

interface RawFactRow {
  current_user_name?: string;
  is_superuser?: boolean;
  has_bypass_rls?: boolean;
  owns_database?: boolean;
  owned_policied_tables?: number | string;
}

/** Normalize what `DataSource.query` / `pg.Client.query` hand back. */
function firstRow(result: unknown): RawFactRow | undefined {
  if (Array.isArray(result)) return result[0] as RawFactRow | undefined;
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown[] }).rows;
    return Array.isArray(rows)
      ? (rows[0] as RawFactRow | undefined)
      : undefined;
  }
  return undefined;
}

export async function readRuntimeRoleFacts(
  querier: RuntimeRoleQuerier,
): Promise<RuntimeRoleFacts> {
  const row = firstRow(await querier.query(RUNTIME_ROLE_FACTS_SQL));
  if (!row?.current_user_name) {
    throw new Error(
      "RLS_MODE=enforce: could not read the runtime role's attributes from " +
        "pg_roles. Refusing to start rather than assume the role is safe.",
    );
  }
  return {
    currentUser: row.current_user_name,
    isSuperuser: !!row.is_superuser,
    hasBypassRls: !!row.has_bypass_rls,
    ownsDatabase: !!row.owns_database,
    ownedPoliciedTables: Number(row.owned_policied_tables ?? 0),
  };
}

/**
 * Every reason `facts` disqualifies the connection from serving enforced
 * traffic, in the operator's words. Empty means the role is safe.
 *
 * Returns all of them rather than the first: an operator who fixed one attribute
 * and restarted should not discover the next one on the following restart.
 */
export function runtimeRoleViolations(
  facts: RuntimeRoleFacts,
  expectedRole: string,
): string[] {
  const violations: string[] = [];
  if (facts.currentUser !== expectedRole) {
    violations.push(
      `connected as "${facts.currentUser}" but DATABASE_APP_USER names ` +
        `"${expectedRole}"`,
    );
  }
  if (facts.isSuperuser) {
    violations.push(
      `role "${facts.currentUser}" is a SUPERUSER, which PostgreSQL exempts ` +
        "from every row-level-security policy",
    );
  }
  if (facts.hasBypassRls) {
    violations.push(
      `role "${facts.currentUser}" holds BYPASSRLS, which exempts it from ` +
        "every row-level-security policy",
    );
  }
  if (facts.ownsDatabase) {
    violations.push(
      `role "${facts.currentUser}" owns this database; owner credentials must ` +
        "not serve ordinary requests",
    );
  }
  if (facts.ownedPoliciedTables > 0) {
    violations.push(
      `role "${facts.currentUser}" owns ${facts.ownedPoliciedTables} table(s) ` +
        "with RLS enabled, and a table's owner is exempt from its policies",
    );
  }
  return violations;
}

export interface AssertRuntimeRoleOptions {
  mode: RlsMode;
  appUser: string | undefined;
}

/**
 * Verify the connection is fit to serve enforced traffic, or throw.
 *
 * Call it with the runtime's own connection -- the point is to interrogate the
 * session that will run requests, not a second one opened as somebody else.
 */
export async function assertRuntimeRoleSafe(
  querier: RuntimeRoleQuerier,
  { mode, appUser }: AssertRuntimeRoleOptions,
): Promise<RuntimeRoleFacts | null> {
  if (mode !== "enforce") return null;

  const expectedRole = appUser || DEFAULT_APP_USER;
  const facts = await readRuntimeRoleFacts(querier);
  const violations = runtimeRoleViolations(facts, expectedRole);
  if (violations.length > 0) {
    throw new Error(
      "RLS_MODE=enforce requires an unprivileged, non-owner runtime role, " +
        `but ${violations.join("; ")}. ` +
        "Point DATABASE_APP_USER at a role created with NOSUPERUSER " +
        "NOCREATEDB NOCREATEROLE NOBYPASSRLS that owns no application object, " +
        "or set RLS_MODE=shadow until it is provisioned.",
    );
  }
  return facts;
}
