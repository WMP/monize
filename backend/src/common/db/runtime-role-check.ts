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
  /**
   * Role contexts this connection can *enter* with `SET ROLE` that are exempt
   * once entered.
   *
   * "Exempt once entered" is the whole point, and it is what the earlier version
   * of this field got wrong (RR4-001): a context is judged on what it can do,
   * not on whether the catalog names it as an owner. `bridge` may own nothing
   * while inheriting the owner, and `SET ROLE bridge` then lands in a context
   * that bypasses every policy.
   *
   * Nothing in this application issues `SET ROLE`, but an injected statement or a
   * mistaken raw query gets it for free, so it stays a refusal.
   *
   * Transitive in both modes, so a chain of any length is covered where a direct
   * `pg_auth_members` join sees only the first hop (DR-R1).
   */
  exemptReachableContexts: string[];
  /**
   * Owner roles whose privileges this role **already holds by inheritance**.
   *
   * The more dangerous half, and the one `SET` reachability cannot see (RR3-001).
   * PostgreSQL decides "is the current role the table owner" with
   * `object_ownercheck` -> `has_privs_of_role`, which walks inheritable
   * memberships -- so an inherited owner is an owner *now*, with no `SET ROLE` and
   * nothing to detect at the statement level. Measured on a live server:
   * `GRANT owner TO app WITH INHERIT TRUE, SET FALSE` gives `SET=false`,
   * `USAGE=true`, `row_security_active=false`, and both tenants' rows.
   *
   * The remedy differs from the list above, which is why it is a separate field:
   * revoking is one option, `WITH INHERIT FALSE` on the membership is the other.
   */
  inheritedOwnerRoles: string[];
}

/**
 * One round trip. `pg_roles` is world-readable, `pg_database.datdba` and
 * `pg_class.relowner` likewise, so an unprivileged role can answer all of this
 * about itself -- no elevated grant is needed to run the check.
 */
export const RUNTIME_ROLE_FACTS_SQL = `
WITH protected_owners AS (
  -- The roles that own an RLS-enabled public table. Collected once: the
  -- reachable-context arm below asks a pg_has_role question per owner per
  -- candidate role, and there are far fewer owners than tables.
  SELECT DISTINCT c.relowner AS oid
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND c.relrowsecurity
)
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
           AND c.relowner = r.oid) AS owned_policied_tables,
       -- Every role CONTEXT this connection can enter, judged on what that
       -- context can do -- not just on what the runtime role directly holds.
       --
       -- RR4-001: asking pg_has_role(r, g, 'SET') and then testing whether g
       -- *directly* owns something misses a mode change partway along the chain.
       -- app --SET--> bridge --INHERIT--> owner gives SET=false and USAGE=false
       -- from app to owner, and bridge owns nothing itself, so both arms were
       -- silent -- while SET ROLE bridge lands in a context that inherits the
       -- owner and bypasses every policy. Measured: rls_active goes false and
       -- both tenants' rows appear.
       --
       -- So each reachable context is asked the ownership question in its OWN
       -- right, with USAGE (privileges, which inherit) rather than identity.
       -- Attributes stay a direct test on the context, because they do not
       -- inherit. Both pg_has_role calls are transitive, so a chain of any
       -- length in either mode is covered, and a role is its own SET/USAGE member
       -- so "owns it directly" needs no separate clause.
       (SELECT coalesce(array_agg(DISTINCT h.rolname::text), '{}'::text[])
          FROM pg_roles h
         WHERE h.oid <> r.oid
           AND pg_has_role(r.oid, h.oid, 'SET')
           AND (h.rolsuper
                OR h.rolbypassrls
                OR pg_has_role(h.oid, d.datdba, 'USAGE')
                OR EXISTS (SELECT 1
                             FROM protected_owners po
                            WHERE pg_has_role(h.oid, po.oid, 'USAGE'))))
         AS exempt_reachable_contexts,
       -- USAGE from the runtime role itself: ownership is a privilege, and
       -- PostgreSQL's owner check walks inheritable memberships, so an inherited
       -- owner bypasses RLS with no SET ROLE at all (RR3-001). Reported
       -- separately from the contexts above because it is already true rather
       -- than one statement away, and because the remedy differs.
       (SELECT coalesce(array_agg(DISTINCT g.rolname::text), '{}'::text[])
          FROM pg_roles g
         WHERE g.oid <> r.oid
           AND pg_has_role(r.oid, g.oid, 'USAGE')
           AND (g.oid = d.datdba
                OR EXISTS (SELECT 1
                             FROM protected_owners po
                            WHERE po.oid = g.oid)))
         AS inherited_owner_roles
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
  exempt_reachable_contexts?: string[] | string | null;
  inherited_owner_roles?: string[] | string | null;
}

/**
 * `text[]` arrives as a JS array from node-postgres and as the literal
 * `{a,b}` from anything that does not parse the OID -- and `name[]`, which
 * `array_agg(rolname)` produces without a cast, is one of those.
 *
 * This is not defensive noise. The first version of this check aggregated
 * `rolname` directly, so the field held the two-character string `"{}"`, whose
 * `.length` is 2: every `RLS_MODE=enforce` boot refused to start, naming a
 * membership violation that did not exist. The unit test could not see it
 * because its mock returned the array the code wanted rather than the value the
 * driver sends.
 */
function toRoleNames(value: string[] | string | null | undefined): string[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  const inner = value.trim().replace(/^\{|\}$/g, "");
  if (inner === "") return [];
  return inner
    .split(",")
    .map((name) => name.trim().replace(/^"|"$/g, ""))
    .filter((name) => name !== "");
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
    exemptReachableContexts: toRoleNames(row.exempt_reachable_contexts),
    inheritedOwnerRoles: toRoleNames(row.inherited_owner_roles),
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
  if (facts.inheritedOwnerRoles.length > 0) {
    // First, because it is the only one that is already true rather than one
    // statement away, and because the fix is different.
    violations.push(
      `role "${facts.currentUser}" inherits the privileges of ${facts.inheritedOwnerRoles
        .map((r) => `"${r}"`)
        .join(
          ", ",
        )}, which own RLS-protected objects -- PostgreSQL treats an ` +
        "inherited owner as the owner, so policies are already inactive. Revoke " +
        "the membership or re-grant it WITH INHERIT FALSE",
    );
  }
  if (facts.exemptReachableContexts.length > 0) {
    violations.push(
      `role "${facts.currentUser}" can SET ROLE into ${facts.exemptReachableContexts
        .map((r) => `"${r}"`)
        .join(
          ", ",
        )}, and policies do not apply in that context -- it holds an ` +
        "exempt attribute, owns RLS-protected objects, or inherits a role that " +
        "does. Revoke the grant that makes it reachable",
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
