import {
  RUNTIME_ROLE_FACTS_SQL,
  RuntimeRoleFacts,
  assertRuntimeRoleSafe,
  readRuntimeRoleFacts,
  runtimeRoleViolations,
} from "./runtime-role-check";
import { APP_ROLE_ATTRIBUTES, APP_ROLE_UPSERT_SQL } from "./app-role";

const SAFE: RuntimeRoleFacts = {
  currentUser: "monize_app",
  isSuperuser: false,
  hasBypassRls: false,
  ownsDatabase: false,
  ownedPoliciedTables: 0,
};

/** A querier returning one row, in the `DataSource.query` array shape. */
const arrayQuerier = (row: Record<string, unknown>) => ({
  query: jest.fn().mockResolvedValue([row]),
});

/** ...and in the `pg.Client.query` `{ rows }` shape. Both are used in-tree. */
const pgQuerier = (row: Record<string, unknown>) => ({
  query: jest.fn().mockResolvedValue({ rows: [row] }),
});

const SAFE_ROW = {
  current_user_name: "monize_app",
  is_superuser: false,
  has_bypass_rls: false,
  owns_database: false,
  owned_policied_tables: "0",
};

describe("runtimeRoleViolations", () => {
  it("accepts an unprivileged non-owner role", () => {
    expect(runtimeRoleViolations(SAFE, "monize_app")).toEqual([]);
  });

  // Each of these is a role PostgreSQL exempts from every policy, which is what
  // made a successful RLS_MODE=enforce boot compatible with zero enforcement.
  it.each([
    ["a superuser", { isSuperuser: true }, /SUPERUSER/],
    ["a BYPASSRLS role", { hasBypassRls: true }, /BYPASSRLS/],
    ["the database owner", { ownsDatabase: true }, /owns this database/],
    [
      "an owner of a policied table",
      { ownedPoliciedTables: 3 },
      /owns 3 table\(s\) with RLS enabled/,
    ],
  ])("rejects %s", (_label, override, expected) => {
    const violations = runtimeRoleViolations(
      { ...SAFE, ...(override as Partial<RuntimeRoleFacts>) },
      "monize_app",
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(expected);
  });

  it("rejects a connection authenticated as a different role than configured", () => {
    // The operator asked for monize_app; the pool handed us the owner. Selecting
    // a username is not the same as connecting under it.
    const violations = runtimeRoleViolations(
      { ...SAFE, currentUser: "monize" },
      "monize_app",
    );

    expect(violations).toEqual([
      'connected as "monize" but DATABASE_APP_USER names "monize_app"',
    ]);
  });

  it("reports every reason at once", () => {
    // An operator who fixes one attribute and restarts should not discover the
    // next one on the following restart.
    const violations = runtimeRoleViolations(
      {
        currentUser: "monize",
        isSuperuser: true,
        hasBypassRls: true,
        ownsDatabase: true,
        ownedPoliciedTables: 53,
      },
      "monize_app",
    );

    expect(violations).toHaveLength(5);
  });
});

describe("readRuntimeRoleFacts", () => {
  it("reads the array result shape TypeORM returns", async () => {
    const querier = arrayQuerier(SAFE_ROW);

    await expect(readRuntimeRoleFacts(querier)).resolves.toEqual(SAFE);
    expect(querier.query).toHaveBeenCalledWith(RUNTIME_ROLE_FACTS_SQL);
  });

  it("reads the { rows } result shape pg returns", async () => {
    await expect(readRuntimeRoleFacts(pgQuerier(SAFE_ROW))).resolves.toEqual(
      SAFE,
    );
  });

  it("coerces the bigint count Postgres returns as a string", async () => {
    const facts = await readRuntimeRoleFacts(
      arrayQuerier({ ...SAFE_ROW, owned_policied_tables: "7" }),
    );

    // A string "7" is truthy but `> 0` on a string is a comparison nobody
    // should have to reason about, so the boundary is crossed here, once.
    expect(facts.ownedPoliciedTables).toBe(7);
  });

  it("refuses to guess when pg_roles returns no row", async () => {
    await expect(
      readRuntimeRoleFacts({ query: jest.fn().mockResolvedValue([]) }),
    ).rejects.toThrow(/Refusing to start rather than assume the role is safe/);
  });
});

describe("assertRuntimeRoleSafe", () => {
  it("does not query the database at off or shadow", async () => {
    for (const mode of ["off", "shadow"] as const) {
      const querier = arrayQuerier(SAFE_ROW);

      await expect(
        assertRuntimeRoleSafe(querier, { mode, appUser: "monize_app" }),
      ).resolves.toBeNull();
      // Those modes connect as the owner deliberately; a check there would
      // fail every existing deployment.
      expect(querier.query).not.toHaveBeenCalled();
    }
  });

  it("returns the verified facts at enforce", async () => {
    await expect(
      assertRuntimeRoleSafe(arrayQuerier(SAFE_ROW), {
        mode: "enforce",
        appUser: "monize_app",
      }),
    ).resolves.toEqual(SAFE);
  });

  it("defaults the expected role name to monize_app", async () => {
    await expect(
      assertRuntimeRoleSafe(arrayQuerier(SAFE_ROW), {
        mode: "enforce",
        appUser: undefined,
      }),
    ).resolves.toEqual(SAFE);
  });

  it("honours an operator-chosen role name", async () => {
    await expect(
      assertRuntimeRoleSafe(arrayQuerier({ ...SAFE_ROW }), {
        mode: "enforce",
        appUser: "tenant_runtime",
      }),
    ).rejects.toThrow(/DATABASE_APP_USER names "tenant_runtime"/);
  });

  it("refuses to start on a BYPASSRLS role and says what to do", async () => {
    await expect(
      assertRuntimeRoleSafe(
        arrayQuerier({ ...SAFE_ROW, has_bypass_rls: true }),
        { mode: "enforce", appUser: "monize_app" },
      ),
    ).rejects.toThrow(
      /RLS_MODE=enforce requires an unprivileged, non-owner runtime role[\s\S]*NOBYPASSRLS/,
    );
  });

  it("refuses to start on the database owner", async () => {
    await expect(
      assertRuntimeRoleSafe(
        arrayQuerier({ ...SAFE_ROW, owns_database: true }),
        {
          mode: "enforce",
          appUser: "monize_app",
        },
      ),
    ).rejects.toThrow(/owns this database/);
  });
});

describe("APP_ROLE_UPSERT_SQL", () => {
  it("strips privileged attributes from an already existing role", () => {
    // The ALTER is the load-bearing half: a role provisioned out of band with
    // SUPERUSER or BYPASSRLS used to keep those attributes forever, because
    // provisioning only converged LOGIN PASSWORD.
    const alter = APP_ROLE_UPSERT_SQL.slice(
      APP_ROLE_UPSERT_SQL.indexOf("ALTER ROLE"),
    );

    for (const attribute of [
      "NOSUPERUSER",
      "NOCREATEDB",
      "NOCREATEROLE",
      "NOBYPASSRLS",
    ]) {
      expect(alter).toContain(attribute);
    }
  });

  it("creates the role with the same attribute set it converges to", () => {
    // Two different attribute lists would mean a freshly created role and a
    // converged one are not the same role.
    const create = APP_ROLE_UPSERT_SQL.slice(
      APP_ROLE_UPSERT_SQL.indexOf("CREATE ROLE"),
      APP_ROLE_UPSERT_SQL.indexOf("ELSE"),
    );

    expect(create).toContain(APP_ROLE_ATTRIBUTES);
    expect(
      APP_ROLE_UPSERT_SQL.slice(APP_ROLE_UPSERT_SQL.indexOf("ALTER ROLE")),
    ).toContain(APP_ROLE_ATTRIBUTES);
  });

  it("still passes the password as a quoted literal, never interpolated", () => {
    expect(APP_ROLE_UPSERT_SQL).toContain("PASSWORD %L");
    expect(APP_ROLE_UPSERT_SQL).not.toMatch(/PASSWORD\s+'/);
  });
});
