import {
  APP_ROLE_ATTRIBUTES,
  APP_ROLE_GRANTS_SQL,
  RUNTIME_READ_ONLY_TABLES,
  APP_ROLE_NAME_GUC,
  APP_ROLE_PASSWORD_GUC,
  APP_ROLE_UPSERT_SQL,
  provisionAppRole,
  SqlClient,
} from "./app-role";
import { DEFAULT_APP_USER } from "./rls-config";

function makeClient() {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  const client: SqlClient = {
    query: jest.fn((text: string, params?: unknown[]) => {
      calls.push({ text, params });
      return Promise.resolve({ rows: [] });
    }),
  };
  return { client, calls };
}

function makeLogger() {
  return { log: jest.fn(), warn: jest.fn() };
}

describe("provisionAppRole", () => {
  it("sets the role name and password via parameterized set_config, then upserts and grants", async () => {
    const { client, calls } = makeClient();
    const logger = makeLogger();

    await provisionAppRole(client, {
      appUser: "monize_app",
      appPassword: "s3cret",
      logger,
    });

    // Role name carried via a parameterized session GUC (no interpolation).
    expect(calls[0]).toEqual({
      text: "SELECT set_config($1, $2, false)",
      params: [APP_ROLE_NAME_GUC, "monize_app"],
    });
    // Password carried via a parameterized session GUC (never in SQL text).
    expect(calls[1]).toEqual({
      text: "SELECT set_config($1, $2, false)",
      params: [APP_ROLE_PASSWORD_GUC, "s3cret"],
    });
    expect(calls[2].text).toBe(APP_ROLE_UPSERT_SQL);
    expect(calls[3].text).toBe(APP_ROLE_GRANTS_SQL);
    expect(calls).toHaveLength(4);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("defaults the role name to monize_app when appUser is unset", async () => {
    const { client, calls } = makeClient();
    await provisionAppRole(client, {
      appUser: undefined,
      appPassword: "pw",
      logger: makeLogger(),
    });
    expect(calls[0].params).toEqual([APP_ROLE_NAME_GUC, DEFAULT_APP_USER]);
  });

  it("skips role creation but still applies grants when the password is unset", async () => {
    const { client, calls } = makeClient();
    const logger = makeLogger();

    await provisionAppRole(client, {
      appUser: "monize_app",
      appPassword: undefined,
      logger,
    });

    // Only the role-name GUC + grants run; no password GUC, no upsert.
    expect(calls.map((c) => c.text)).toEqual([
      "SELECT set_config($1, $2, false)",
      APP_ROLE_GRANTS_SQL,
    ]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toMatch(/DATABASE_APP_PASSWORD/);
    expect(logger.log).not.toHaveBeenCalled();
  });

  it("defaults the logger to console when none is provided", async () => {
    const { client } = makeClient();
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await provisionAppRole(client, {
        appUser: "monize_app",
        appPassword: "pw",
      });
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it("never emits the password as a literal in any SQL statement text", async () => {
    const { client, calls } = makeClient();
    await provisionAppRole(client, {
      appUser: "monize_app",
      appPassword: "super-secret-value",
      logger: makeLogger(),
    });
    for (const call of calls) {
      expect(call.text).not.toContain("super-secret-value");
    }
  });
});

describe("app-role SQL", () => {
  it("uses %I / %L formatting and no FOR ROLE clause", () => {
    expect(APP_ROLE_UPSERT_SQL).toContain(
      `format('CREATE ROLE %I ${APP_ROLE_ATTRIBUTES} PASSWORD %L'`,
    );
    expect(APP_ROLE_UPSERT_SQL).toContain("insufficient_privilege");
    expect(APP_ROLE_GRANTS_SQL).toContain(
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public",
    );
    expect(APP_ROLE_GRANTS_SQL).not.toMatch(/FOR ROLE/i);
  });
});

/**
 * DR-02. The blanket "all tables in schema public" grant is deliberate -- a new
 * user-owned table must be reachable the moment a migration creates it -- but it
 * also handed the runtime role write access to the migration ledger, which no
 * request touches and no policy protects.
 */
describe("runtime grant surface", () => {
  it("revokes writes on every read-only infrastructure table", () => {
    for (const table of RUNTIME_READ_ONLY_TABLES) {
      expect(APP_ROLE_GRANTS_SQL).toContain(`'${table}'`);
    }
    expect(APP_ROLE_GRANTS_SQL).toContain(
      "REVOKE INSERT, UPDATE, DELETE ON public.%I",
    );
  });

  it("keeps SELECT, so nothing that reads the ledger breaks", () => {
    expect(APP_ROLE_GRANTS_SQL).not.toContain("REVOKE ALL");
    expect(APP_ROLE_GRANTS_SQL).not.toMatch(/REVOKE[^;]*SELECT/);
  });

  it("guards the revoke on the table existing", () => {
    // The grants block runs on every startup, including before schema.sql has
    // created anything. A REVOKE on a missing table aborts the whole DO block
    // and would take the grants with it.
    expect(APP_ROLE_GRANTS_SQL).toMatch(/IF EXISTS \(\s*SELECT FROM pg_class/);
  });

  it("revokes after granting, not before", () => {
    // "GRANT ON ALL TABLES" would re-add what an earlier revoke took away.
    expect(APP_ROLE_GRANTS_SQL.indexOf("GRANT SELECT, INSERT")).toBeLessThan(
      APP_ROLE_GRANTS_SQL.indexOf("REVOKE"),
    );
  });
});
