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
    EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', role_name, role_pw);
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

    -- The one SECURITY DEFINER helper the runtime needs: it answers whether a
    -- currency code is still referenced anywhere, which the tenant's own view of
    -- the tables cannot. EXECUTE is revoked from PUBLIC by migration 133, so it
    -- has to be granted back here -- a migration cannot name this role, which
    -- may not exist yet on a given deployment. Guarded on the function's
    -- presence so a deployment mid-upgrade (role provisioned, migration 133 not
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
 * `currency_code_in_use_globally`, whose EXECUTE migration 133 revokes from
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
