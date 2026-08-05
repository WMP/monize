import { DEFAULT_APP_USER } from "./rls-config";

/**
 * Provisioning of the unprivileged `monize_app` runtime role and its DML grants.
 *
 * This lives in db-init (run as the DB owner on every startup), NOT in a
 * migration: a migration that referenced the role (`GRANT ... TO monize_app`,
 * `ALTER DEFAULT PRIVILEGES FOR ROLE ...`) would run unconditionally at startup
 * and crash-loop any deployment where the role does not yet exist. Keeping all
 * role/grant SQL here is what lets existing deployments upgrade with zero new
 * env vars and zero behavior change. See the RLS design doc, Phase 1.
 *
 * The SQL is exported (not just executed inline) so the integration harness (T1)
 * can apply the exact same grants without duplicating them.
 */

/** Minimal query surface shared by `pg.Client` and test doubles. */
export interface SqlClient {
  query(
    text: string,
    params?: unknown[],
  ): Promise<{ rows?: unknown[] } | unknown>;
}

/** Minimal logger surface (matches both `console` and NestJS `Logger`). */
export interface RoleProvisionLogger {
  log(message: string): void;
  warn(message: string): void;
}

/**
 * Session GUC that carries the operator-chosen role name into the DO blocks.
 * A dotted (namespaced) custom GUC can be set at runtime without prior
 * definition, and `format('%I', ...)` quotes it as an identifier so a hostile
 * role name cannot inject SQL.
 */
export const APP_ROLE_NAME_GUC = "monize.app_role";

/**
 * Session GUC that carries the password into the DO block. The password reaches
 * SQL only via a parameterized `set_config` (never string interpolation), then
 * `format('%L', ...)` quotes it as a literal inside the CREATE/ALTER ROLE.
 */
export const APP_ROLE_PASSWORD_GUC = "monize.app_password";

/**
 * Create the role if absent, else rotate its password. Idempotent and
 * re-applied on every startup so rotating `DATABASE_APP_PASSWORD` and
 * restarting is sufficient. On managed Postgres (CNPG) where the owner lacks
 * `CREATEROLE`, the CREATE/ALTER raises `insufficient_privilege` (42501); we
 * swallow it with a warning and let the role be provisioned declaratively via
 * the CNPG `Cluster` spec (`managed.roles`).
 */
export const APP_ROLE_UPSERT_SQL = `
DO $$
DECLARE
  role_name text := current_setting('${APP_ROLE_NAME_GUC}');
  role_pw   text := current_setting('${APP_ROLE_PASSWORD_GUC}');
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = role_name) THEN
    -- The attributes are PostgreSQL's defaults for a new role, spelled out so
    -- the intent is on the page: this role exists to be bound by policies, and
    -- SUPERUSER or BYPASSRLS would make enforcement a no-op. Naming them costs
    -- nothing and needs no elevated privilege, since they are already the
    -- defaults. An operator-precreated role gets whatever it was given, which is
    -- what assertRuntimeRoleIsSafe refuses to boot on.
    EXECUTE format(
      'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION',
      role_name, role_pw);
  ELSE
    EXECUTE format('ALTER ROLE %I LOGIN PASSWORD %L', role_name, role_pw);
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE WARNING 'Insufficient privilege to create/alter role %; provision it declaratively via CNPG managed.roles (spec.managed.roles).', role_name;
END $$;
`.trim();

/**
 * Apply DML grants + default privileges whenever the role exists (however it
 * was provisioned). No `FOR ROLE` clause: `ALTER DEFAULT PRIVILEGES` then
 * applies to the current role -- the actual owner, whatever its operator-chosen
 * name. Re-applied every startup so a grant revoked out-of-band is restored and
 * a role provisioned late (CNPG, manual DBA) converges on the next restart.
 * Insufficient-privilege failures degrade to a warning so an `off`/`shadow`
 * deployment (where the role is unused) still boots.
 */
export const APP_ROLE_GRANTS_SQL = `
DO $$
DECLARE
  role_name text := current_setting('${APP_ROLE_NAME_GUC}');
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = role_name) THEN
    EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', role_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', role_name);
    EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', role_name);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', role_name);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I', role_name);

    -- Migration bookkeeping is the owner's, not the runtime's. The blanket
    -- "ALL TABLES IN SCHEMA public" above hands DML on every table to the app
    -- role, and schema_migrations is a table in public, so ordinary runtime
    -- credentials could insert a filename (making the next deployment skip
    -- required DDL) or delete one (making a migration body re-run). No
    -- application code reads or writes it -- the migrator uses owner
    -- credentials -- so revoking costs nothing and closes the privilege that
    -- compromised runtime code or an injection bug would otherwise inherit.
    IF EXISTS (
      SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'schema_migrations'
    ) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.schema_migrations FROM %I', role_name);
    END IF;

    -- The one SECURITY DEFINER helper the runtime needs: it answers whether a
    -- currency code is still referenced anywhere, which the tenant's own view of
    -- the tables cannot. EXECUTE is revoked from PUBLIC by migration 136, so it
    -- has to be granted back here -- a migration cannot name this role, which
    -- may not exist yet on a given deployment. Guarded on the function's
    -- presence so a deployment mid-upgrade (role provisioned, migration 136 not
    -- yet applied) warns rather than failing startup.
    IF EXISTS (
      SELECT FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname = 'currency_code_in_use_globally'
    ) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.currency_code_in_use_globally(character varying) TO %I', role_name);
    END IF;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE WARNING 'Insufficient privilege to grant DML to role %; grant it manually or via the DB owner.', role_name;
END $$;
`.trim();

/**
 * What makes a runtime role unsafe under enforcement, as one query.
 *
 * Enforcement rests on the runtime connecting as a role that policies actually
 * bind. Four things exempt a role from its own policies:
 *
 *   - `rolsuper`      -- a superuser bypasses RLS outright.
 *   - `rolbypassrls`  -- the attribute that says so by name.
 *   - table ownership -- an owner bypasses RLS on its own tables, because
 *                        `FORCE ROW LEVEL SECURITY` is deliberately not used
 *                        (db-init, db-migrate and backup restore rely on the
 *                        owner bypass).
 *   - membership in a role with any of the above -- whether the privileges arrive
 *     automatically or only after an explicit `SET ROLE`.
 *
 * `pg_has_role(..., 'MEMBER')` is what catches the fourth. This was `'USAGE'`,
 * which asks a narrower question: whether the other role's privileges are
 * *immediately* available through `INHERIT`. It says nothing about whether the
 * login can become that role on request, and role membership permits `SET ROLE`
 * by default. So a grant of the form
 *
 *     GRANT monize_owner TO monize_app WITH INHERIT FALSE, SET TRUE;
 *
 * passed the check -- `USAGE` is false -- while `SET ROLE monize_owner` in any
 * session succeeded and every subsequent permission check ran as the database
 * owner. A boundary that can be stepped over on request is not a boundary.
 *
 * `MEMBER` is true for direct or indirect membership, which is exactly "can do
 * `SET ROLE` to it", and it is implied by `USAGE`, so it subsumes the old check
 * rather than replacing one gap with another. PostgreSQL 16 also offers a
 * narrower `'SET'` privilege type that would exempt a `WITH SET FALSE, INHERIT
 * FALSE` membership; `MEMBER` deliberately rejects that too. Being wrong in the
 * direction of refusing to boot is recoverable in a way that silently running
 * with policies bypassed is not, and a membership that grants neither inheritance
 * nor role-switching has no reason to exist on a runtime login.
 *
 * The original gap was wider still: startup validated the configured *name* and
 * *password* and never asked the catalog anything at all.
 */
const RUNTIME_ROLE_SAFETY_SQL = `
SELECT
  r.rolsuper,
  r.rolbypassrls,
  r.rolcreatedb,
  r.rolcreaterole,
  r.rolreplication,
  EXISTS (
    SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p')
       AND pg_has_role(r.oid, c.relowner, 'MEMBER')
  ) AS owns_tables,
  EXISTS (
    SELECT 1 FROM pg_database d
     WHERE d.datname = $2
       AND pg_has_role(r.oid, d.datdba, 'MEMBER')
  ) AS owns_database,
  EXISTS (
    SELECT 1 FROM pg_roles m
     WHERE m.rolname <> r.rolname
       AND (m.rolsuper OR m.rolbypassrls)
       AND pg_has_role(r.oid, m.oid, 'MEMBER')
  ) AS inherits_bypass
FROM pg_roles r
WHERE r.rolname = $1
`.trim();

interface RuntimeRoleSafetyRow {
  rolsuper: boolean;
  rolbypassrls: boolean;
  rolcreatedb: boolean;
  rolcreaterole: boolean;
  rolreplication: boolean;
  owns_tables: boolean;
  owns_database: boolean;
  inherits_bypass: boolean;
}

/**
 * Refuse to boot under `RLS_MODE=enforce` when the runtime role can ignore the
 * policies.
 *
 * Provisioning creates a safe role, but it only ever *created or rotated the
 * password of* an existing one -- so a role pre-created as the database owner, a
 * superuser, or with `BYPASSRLS` (a plausible mistake, and the normal shape of a
 * managed-Postgres role) connected happily while every policy was bypassed.
 * Enforcement reported itself as on and was not, which is worse than being off:
 * off is a documented state somebody chose.
 *
 * Throwing is the point. A warning here would be read once and then live in the
 * logs of a deployment that believes it is isolating tenants.
 */
export async function assertRuntimeRoleIsSafe(
  client: SqlClient,
  {
    appUser,
    databaseName,
    logger = console,
  }: {
    appUser: string | undefined;
    databaseName: string;
    logger?: RoleProvisionLogger;
  },
): Promise<void> {
  const roleName = appUser || DEFAULT_APP_USER;
  const result = (await client.query(RUNTIME_ROLE_SAFETY_SQL, [
    roleName,
    databaseName,
  ])) as { rows?: RuntimeRoleSafetyRow[] };
  const row = result?.rows?.[0];

  if (!row) {
    throw new Error(
      `RLS_MODE=enforce requires the runtime role '${roleName}' to exist, and it does not. ` +
        "Set DATABASE_APP_PASSWORD so it can be provisioned, create it declaratively " +
        "(CNPG spec.managed.roles), or use RLS_MODE=shadow/off.",
    );
  }

  const problems: string[] = [];
  if (row.rolsuper) problems.push("it is a SUPERUSER (bypasses RLS entirely)");
  if (row.rolbypassrls) problems.push("it has BYPASSRLS");
  if (row.owns_database) {
    problems.push(`it owns the database '${databaseName}'`);
  }
  if (row.owns_tables) {
    problems.push(
      "it owns tables in schema public (an owner bypasses RLS on its own tables, " +
        "since FORCE ROW LEVEL SECURITY is deliberately not used)",
    );
  }
  if (row.inherits_bypass) {
    problems.push(
      "it is a member of a SUPERUSER or BYPASSRLS role, so it can reach that " +
        "privilege by inheritance or by SET ROLE",
    );
  }

  if (problems.length > 0) {
    throw new Error(
      `RLS_MODE=enforce refuses to start: the runtime role '${roleName}' would not be ` +
        `subject to row-level security because ${problems.join("; ")}. ` +
        "Point DATABASE_APP_USER at an unprivileged non-owner role, or use " +
        "RLS_MODE=shadow to exercise the mechanism without relying on it.",
    );
  }

  // Not fatal: these grant no RLS exemption. Worth saying out loud because a
  // runtime role holding them is a sign it was provisioned as something else.
  const overpowered = [
    row.rolcreatedb && "CREATEDB",
    row.rolcreaterole && "CREATEROLE",
    row.rolreplication && "REPLICATION",
  ].filter(Boolean);
  if (overpowered.length > 0) {
    logger.warn(
      `Runtime role '${roleName}' holds ${overpowered.join(", ")}. These do not bypass RLS, ` +
        "but an application role should not need them.",
    );
  }

  logger.log(
    `Runtime role '${roleName}' verified as non-owner, non-superuser, non-BYPASSRLS for RLS_MODE=enforce.`,
  );
}

export interface ProvisionAppRoleOptions {
  appUser: string | undefined;
  appPassword: string | undefined;
  logger?: RoleProvisionLogger;
}

/**
 * Apply the grants alone, without touching the role or its password.
 *
 * Called twice per startup, and the second call is the one that matters.
 * `db-init` runs before `db-migrate`, so on the boot that first applies a
 * migration creating a database object the runtime needs -- the SECURITY DEFINER
 * `currency_code_in_use_globally`, whose EXECUTE migration 136 revokes from
 * PUBLIC -- the grant in `db-init` runs while that object does not yet exist and
 * silently grants nothing. Under `RLS_MODE=enforce` the runtime would then get
 * "permission denied for function" until somebody restarted the pod again. So
 * `db-migrate` converges the grants once more after its DDL.
 *
 * Idempotent and never fatal: a privilege shortfall degrades to a warning, as
 * everywhere else in this file.
 */
export async function applyAppRoleGrants(
  client: SqlClient,
  { appUser }: { appUser: string | undefined },
): Promise<void> {
  const roleName = appUser || DEFAULT_APP_USER;
  await client.query("SELECT set_config($1, $2, false)", [
    APP_ROLE_NAME_GUC,
    roleName,
  ]);
  await client.query(APP_ROLE_GRANTS_SQL);
}

/**
 * Provision (or converge) the runtime role and its grants. Safe to call on
 * every startup and before the "tables already exist" early return in db-init,
 * so both initial creation and password rotation run on an already-initialized
 * DB. Never throws on a missing password or a privilege shortfall -- those
 * degrade to warnings so a plain upgrade at `RLS_MODE=off` is unaffected.
 */
export async function provisionAppRole(
  client: SqlClient,
  { appUser, appPassword, logger = console }: ProvisionAppRoleOptions,
): Promise<void> {
  const roleName = appUser || DEFAULT_APP_USER;

  // Carry the role name into the DO blocks as a session GUC (parameterized).
  await client.query("SELECT set_config($1, $2, false)", [
    APP_ROLE_NAME_GUC,
    roleName,
  ]);

  if (appPassword) {
    // Parameterized: the password never appears in top-level SQL text.
    await client.query("SELECT set_config($1, $2, false)", [
      APP_ROLE_PASSWORD_GUC,
      appPassword,
    ]);
    await client.query(APP_ROLE_UPSERT_SQL);
    logger.log(
      `Ensured runtime role '${roleName}' (created or password rotated).`,
    );
  } else {
    logger.warn(
      `DATABASE_APP_PASSWORD not set; skipping creation of runtime role '${roleName}'. ` +
        "Grants will still be applied if the role already exists (e.g. via CNPG managed.roles).",
    );
  }

  // Grants run whenever the role exists, regardless of how it was provisioned.
  // db-migrate re-applies them after its DDL -- see applyAppRoleGrants.
  await client.query(APP_ROLE_GRANTS_SQL);
}
