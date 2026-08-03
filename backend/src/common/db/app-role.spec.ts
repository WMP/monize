import {
  APP_ROLE_GRANTS_SQL,
  APP_ROLE_NAME_GUC,
  APP_ROLE_PASSWORD_GUC,
  APP_ROLE_UPSERT_SQL,
  assertRuntimeRoleIsSafe,
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
    // Identifier and literal quoting, so a hostile role name or password cannot
    // inject SQL into the DO block.
    expect(APP_ROLE_UPSERT_SQL).toMatch(
      /format\(\s*'CREATE ROLE %I LOGIN PASSWORD %L/,
    );
    expect(APP_ROLE_UPSERT_SQL).toContain("insufficient_privilege");
    expect(APP_ROLE_GRANTS_SQL).toContain(
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public",
    );
    expect(APP_ROLE_GRANTS_SQL).not.toMatch(/FOR ROLE/i);
  });

  it("creates the role without any RLS-exempting attribute", () => {
    // Already PostgreSQL's defaults; named so that a future edit adding
    // SUPERUSER or BYPASSRLS has to delete an explicit NO.
    for (const attribute of [
      "NOSUPERUSER",
      "NOBYPASSRLS",
      "NOCREATEDB",
      "NOCREATEROLE",
      "NOREPLICATION",
    ]) {
      expect(APP_ROLE_UPSERT_SQL).toContain(attribute);
    }
  });

  it("revokes the runtime role's access to migration bookkeeping", () => {
    // The blanket "ALL TABLES IN SCHEMA public" grant includes
    // schema_migrations, so runtime credentials could insert a filename (the next
    // deployment then skips required DDL) or delete one (a migration body
    // re-runs). No application code touches the table.
    expect(APP_ROLE_GRANTS_SQL).toMatch(
      /REVOKE ALL ON TABLE public\.schema_migrations FROM %I/,
    );
    // Guarded on the table's existence: the grants run on every startup,
    // including before the table has been created.
    expect(APP_ROLE_GRANTS_SQL).toContain("tablename = 'schema_migrations'");
  });

  it("orders the revoke after the blanket grant", () => {
    // A revoke that ran first would be undone by the grant that followed it.
    const grantAt = APP_ROLE_GRANTS_SQL.indexOf(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES",
    );
    const revokeAt = APP_ROLE_GRANTS_SQL.indexOf(
      "REVOKE ALL ON TABLE public.schema_migrations",
    );
    expect(grantAt).toBeGreaterThan(-1);
    expect(revokeAt).toBeGreaterThan(grantAt);
  });
});

describe("assertRuntimeRoleIsSafe", () => {
  const safeRow = {
    rolsuper: false,
    rolbypassrls: false,
    rolcreatedb: false,
    rolcreaterole: false,
    rolreplication: false,
    owns_tables: false,
    owns_database: false,
    inherits_bypass: false,
  };

  function clientReturning(row: Record<string, boolean> | undefined) {
    return {
      query: jest.fn().mockResolvedValue({ rows: row ? [row] : [] }),
    };
  }

  const logger = { log: jest.fn(), warn: jest.fn() };

  beforeEach(() => {
    logger.log.mockClear();
    logger.warn.mockClear();
  });

  it("accepts an unprivileged non-owner role", async () => {
    await expect(
      assertRuntimeRoleIsSafe(clientReturning(safeRow), {
        appUser: "monize_app",
        databaseName: "monize",
        logger,
      }),
    ).resolves.toBeUndefined();
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining("verified as non-owner"),
    );
  });

  /**
   * Each of these exempts a role from its own policies, and startup used to
   * validate only the configured name and password -- so enforcement reported
   * itself as on while every policy was bypassed. That is worse than `off`, which
   * is at least a state somebody chose.
   */
  it.each([
    ["rolsuper", "SUPERUSER"],
    ["rolbypassrls", "BYPASSRLS"],
    ["owns_database", "owns the database"],
    ["owns_tables", "owns tables in schema public"],
    ["inherits_bypass", "inherits membership"],
  ])("refuses to start when %s", async (flag, expectedReason) => {
    await expect(
      assertRuntimeRoleIsSafe(clientReturning({ ...safeRow, [flag]: true }), {
        appUser: "monize_app",
        databaseName: "monize",
        logger,
      }),
    ).rejects.toThrow(new RegExp(expectedReason, "i"));
  });

  it("names every problem at once rather than one per restart", async () => {
    await expect(
      assertRuntimeRoleIsSafe(
        clientReturning({
          ...safeRow,
          rolsuper: true,
          rolbypassrls: true,
          owns_tables: true,
        }),
        { appUser: "monize_app", databaseName: "monize", logger },
      ),
    ).rejects.toThrow(/SUPERUSER.*BYPASSRLS.*owns tables/s);
  });

  it("refuses to start when the role does not exist", async () => {
    await expect(
      assertRuntimeRoleIsSafe(clientReturning(undefined), {
        appUser: "monize_app",
        databaseName: "monize",
        logger,
      }),
    ).rejects.toThrow(/requires the runtime role 'monize_app' to exist/);
  });

  it("warns but starts on attributes that do not bypass RLS", async () => {
    await expect(
      assertRuntimeRoleIsSafe(
        clientReturning({
          ...safeRow,
          rolcreatedb: true,
          rolreplication: true,
        }),
        { appUser: "monize_app", databaseName: "monize", logger },
      ),
    ).resolves.toBeUndefined();
    // Refusing here would block a boot over something that grants no exemption;
    // saying nothing would hide that the role was provisioned as something else.
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("CREATEDB, REPLICATION"),
    );
  });

  it("falls back to the default role name", async () => {
    const client = clientReturning(safeRow);
    await assertRuntimeRoleIsSafe(client, {
      appUser: undefined,
      databaseName: "monize",
      logger,
    });
    expect(client.query.mock.calls[0][1]).toEqual([DEFAULT_APP_USER, "monize"]);
  });
});
