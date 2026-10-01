import { Logger } from "@nestjs/common";
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

/** Minimal logger surface (matches NestJS `Logger` and any test double). */
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
 * The attribute set that makes the role unprivileged, spelled out on both the
 * CREATE and the ALTER.
 *
 * The ALTER is the load-bearing half. Provisioning used to converge only
 * `LOGIN PASSWORD`, so a role that already existed kept whatever attributes it
 * was created with -- `SUPERUSER` or `BYPASSRLS` among them -- and PostgreSQL
 * exempts both from every policy. `ALTER ROLE` is not additive, so naming the
 * NO-forms here actually strips them.
 *
 * This still cannot be the only defence: the deployment may provision the role
 * declaratively (CNPG `managed.roles`) where this SQL never runs, the ALTER can
 * fail with `insufficient_privilege` and degrade to a warning, and an attribute
 * granted after startup is invisible to it. `runtime-role-check.ts` asks the
 * database what the connection actually is, and refuses to serve traffic on a
 * wrong answer.
 */
/**
 * `NOINHERIT` is defence in depth for RR3-001, not the fix.
 *
 * PostgreSQL decides table ownership with `has_privs_of_role`, which walks
 * *inheritable* memberships -- so a role that inherits the owner's privileges is
 * an owner for the RLS check and bypasses every policy without ever issuing
 * `SET ROLE`. `NOINHERIT` makes that the role's default, which helps.
 *
 * It cannot be the whole answer, for three reasons that all apply here: the
 * deployment may provision the role declaratively (CNPG `managed.roles`) where
 * this SQL never runs; PostgreSQL 16 stores inheritance on each membership grant,
 * so `GRANT owner TO app WITH INHERIT TRUE` overrides the role default; and the
 * `ALTER` below degrades to a warning when the owner may not change the
 * attributes. The startup check is what actually refuses to serve -- this only
 * narrows the default.
 */
export const APP_ROLE_ATTRIBUTES =
  "LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION NOINHERIT";

/**
 * The `NO<x>` half of `APP_ROLE_ATTRIBUTES`, i.e. the attributes an operator must
 * strip when provisioning declaratively. Derived from the one attribute string so
 * the insufficient-privilege warning below cannot drift behind the contract the
 * runtime verifier enforces (RR7-002: the warning hand-listed four of these and
 * silently dropped `NOREPLICATION` and `NOINHERIT`, so an operator who followed it
 * into `managed.roles` rebuilt a role that later failed enforce-mode startup).
 * `app-role.spec.ts` asserts every one of these appears in the warning text.
 */
export const APP_ROLE_FORBIDDEN_ATTRIBUTE_TOKENS = APP_ROLE_ATTRIBUTES.split(
  /\s+/,
).filter((token) => token.startsWith("NO"));

/**
 * For each token of `APP_ROLE_ATTRIBUTES`, the `pg_roles` condition that is true
 * when a role VIOLATES it (a role created with `LOGIN` violates it by having
 * `NOT rolcanlogin`; one created `NOSUPERUSER` violates it by having `rolsuper`).
 *
 * Written once, here, and consumed only through `appRoleConvergeSql`, so the
 * per-attribute convergence in `APP_ROLE_UPSERT_SQL` is derived from the
 * attribute string rather than listed beside it. A token with no entry here
 * makes this module throw at load, and `app-role.spec.ts` asserts the two keep
 * the same members and that each `NO<x>` entry reads the column
 * `runtime-role-check.ts` checks.
 */
export const APP_ROLE_ATTRIBUTE_VIOLATIONS: Readonly<Record<string, string>> = {
  LOGIN: "NOT rolcanlogin",
  NOSUPERUSER: "rolsuper",
  NOCREATEDB: "rolcreatedb",
  NOCREATEROLE: "rolcreaterole",
  NOBYPASSRLS: "rolbypassrls",
  NOREPLICATION: "rolreplication",
  NOINHERIT: "rolinherit",
};

/**
 * One guarded `ALTER ROLE` per token of `attributes`, as PL/pgSQL statements for
 * the role-exists branch of `APP_ROLE_UPSERT_SQL`:
 *
 *     IF EXISTS (SELECT FROM pg_roles WHERE rolname = role_name AND (<violation>)) THEN
 *       EXECUTE format('ALTER ROLE %I <TOKEN>', role_name);
 *     END IF;
 *
 * Each statement names exactly one attribute and runs only for a role that
 * violates that one, so a role that conforms is never sent a statement
 * PostgreSQL would refuse and a role drifted in an attribute the owner may
 * change is converged without naming any it may not.
 *
 * Throws when a token has no entry in `violations`: a token with no condition
 * would be an attribute the role may carry without ever being converged.
 */
export function appRoleConvergeSql(
  attributes: string,
  violations: Readonly<Record<string, string>>,
): string {
  const tokens = attributes.split(/\s+/).filter((token) => token !== "");
  if (tokens.length === 0) {
    throw new Error("APP_ROLE_ATTRIBUTES names no attributes");
  }
  const unmapped = tokens.filter(
    (token) => !Object.prototype.hasOwnProperty.call(violations, token),
  );
  if (unmapped.length > 0) {
    throw new Error(
      `APP_ROLE_ATTRIBUTES token(s) ${unmapped.join(", ")} have no entry in ` +
        "APP_ROLE_ATTRIBUTE_VIOLATIONS, so role drift on them would go undetected",
    );
  }
  return tokens
    .map(
      (token) =>
        `    IF EXISTS (SELECT FROM pg_roles WHERE rolname = role_name AND (${violations[token]})) THEN\n` +
        `      EXECUTE format('ALTER ROLE %I ${token}', role_name);\n` +
        "    END IF;",
    )
    .join("\n");
}

/** The per-attribute convergence statements for `APP_ROLE_ATTRIBUTES`. */
export const APP_ROLE_CONVERGE_SQL = appRoleConvergeSql(
  APP_ROLE_ATTRIBUTES,
  APP_ROLE_ATTRIBUTE_VIOLATIONS,
);

/**
 * Create the role if absent, else rotate its password and converge each
 * attribute it has drifted on. Idempotent and re-applied on every startup so
 * rotating `DATABASE_APP_PASSWORD` and restarting is sufficient.
 *
 * The password is altered in a statement of its own, and each attribute in a
 * statement of its own. PostgreSQL 16 lets an owner holding only `CREATEROLE`
 * change the password of a role it created, but refuses any `ALTER ROLE` that
 * names `SUPERUSER`, `REPLICATION` or `BYPASSRLS` ("Only roles with the ...
 * attribute may change the ... attribute"), even as the NO-form and even when
 * nothing would change. One combined statement therefore passed on the first
 * boot (the CREATE) and failed with `insufficient_privilege` on every later one,
 * so a rotated password was never applied. Each attribute ALTER now runs only
 * when `APP_ROLE_CONVERGE_SQL`'s guard finds the role violating that attribute,
 * so a conforming role is sent none, and an attribute the owner may change
 * (`NOINHERIT`, `LOGIN`) is fixed without naming one it may not.
 *
 * `EXCEPTION WHEN insufficient_privilege` wraps the whole block, and an
 * exception inside a PL/pgSQL block rolls the block back (it is a
 * subtransaction). So when the role has drifted on an attribute the owner may
 * not change (`BYPASSRLS`, `REPLICATION`, `SUPERUSER`, `CREATEDB`), the
 * statements before the refused one are undone with it: the old password stays
 * and the warning fires. Safety does not depend on that:
 * `runtime-role-check.ts` still refuses an enforce boot on a role holding a
 * forbidden attribute.
 *
 * On managed Postgres (CNPG) where the owner lacks `CREATEROLE`, the CREATE
 * raises `insufficient_privilege` (42501); we swallow it with a warning and let
 * the role be provisioned declaratively via the CNPG `Cluster` spec
 * (`managed.roles`).
 */
export const APP_ROLE_UPSERT_SQL = `
DO $$
DECLARE
  role_name text := current_setting('${APP_ROLE_NAME_GUC}');
  role_pw   text := current_setting('${APP_ROLE_PASSWORD_GUC}');
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = role_name) THEN
    EXECUTE format('CREATE ROLE %I ${APP_ROLE_ATTRIBUTES} PASSWORD %L', role_name, role_pw);
  ELSE
    EXECUTE format('ALTER ROLE %I PASSWORD %L', role_name, role_pw);
${APP_ROLE_CONVERGE_SQL}
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE WARNING 'Insufficient privilege to create/alter role %; provision it declaratively via CNPG managed.roles (spec.managed.roles) with ${APP_ROLE_FORBIDDEN_ATTRIBUTE_TOKENS.join(" ")}.', role_name;
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
  infra_table text;
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = role_name) THEN
    EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', role_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', role_name);
    EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', role_name);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', role_name);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I', role_name);

    -- Then take back what the blanket grant should never have included.
    --
    -- The grant above is deliberately "all tables": a new user-owned table has
    -- to be reachable the moment a migration creates it, and an allowlist that
    -- has to be edited per table would be forgotten, leaving the feature broken
    -- in enforce mode only. But "all tables" also hands the runtime role write
    -- access to the migration ledger, which no request has any reason to touch
    -- and which no RLS policy protects -- it is one of the four documented
    -- exemptions. A mistaken raw query or an application SQL injection could
    -- rewrite it, and db-migrate reads it to decide what to replay: a forged row
    -- silently skips a migration, a deleted one replays a migration on top of
    -- itself. Revoking write while keeping SELECT is a strict narrowing (task
    -- DR-02); nothing at runtime writes it.
    FOR infra_table IN SELECT unnest(ARRAY['schema_migrations']) LOOP
      IF EXISTS (
        SELECT FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relname = infra_table
      ) THEN
        EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON public.%I FROM %I', infra_table, role_name);
      END IF;
    END LOOP;

    -- currency_code_in_use_globally (migration 136) is SECURITY DEFINER and
    -- revokes EXECUTE from PUBLIC in the same file -- the implicit grant every
    -- other function keeps. Nothing re-grants it to the runtime role without
    -- this, so RLS_MODE=enforce gets "permission denied for function" the
    -- first time CurrenciesService.remove asks whether a code is still live
    -- anywhere. Guarded by to_regprocedure so a boot before migration 136 has
    -- run (or a downgrade) does not fail on a missing function.
    IF to_regprocedure('public.currency_code_in_use_globally(varchar)') IS NOT NULL THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.currency_code_in_use_globally(varchar) TO %I', role_name);
    END IF;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE WARNING 'Insufficient privilege to grant DML to role %; grant it manually or via the DB owner.', role_name;
END $$;
`.trim();

/**
 * Tables the runtime role may read but never write: infrastructure with no RLS
 * policy, where the blanket grant is the only thing standing between a mistaken
 * query and a corrupted invariant. Exported so the integration harness can
 * assert the revoke actually took (`app-role.spec.ts` asserts the SQL; only a
 * live database can assert the privilege).
 */
export const RUNTIME_READ_ONLY_TABLES = ["schema_migrations"] as const;

export interface ProvisionAppRoleOptions {
  appUser: string | undefined;
  appPassword: string | undefined;
  logger?: RoleProvisionLogger;
}

/**
 * Apply the grants alone, without touching the role or its password.
 *
 * Called twice per startup: by `db-init` (inside `provisionAppRole`) and again
 * by `db-migrate` after its DDL. On a first boot the second call is the one
 * that takes effect: db-init's grants run before `schema.sql` has created
 * anything, so the write-revoke on `schema_migrations` finds no table and is
 * skipped -- and the default privileges db-init sets then hand the runtime role
 * INSERT/UPDATE/DELETE on the ledger the moment it is created. Re-running after
 * migrations is what takes those writes back. The same pass is what would cover
 * an object a migration creates in the boot that first ships it, once this SQL
 * carries a grant for it -- today it carries none beyond the blanket
 * table/sequence grants, which `ALTER DEFAULT PRIVILEGES` already extends to
 * new objects.
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
  {
    appUser,
    appPassword,
    logger = new Logger("AppRole"),
  }: ProvisionAppRoleOptions,
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
