import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";

import { INTEGRATION_TYPEORM_OPTIONS } from "../helpers/integration-setup";
import {
  applyRlsPolicies,
  TEST_APP_ROLE,
  TEST_APP_ROLE_PASSWORD,
} from "../helpers/rls-setup";
import { withScopedDb } from "@/common/db/scoped-db";
import { withUserContext } from "@/common/db/with-context";
import { withElevatedDb } from "@/common/db/elevated-db";
import {
  readRuntimeRoleFacts,
  runtimeRoleViolations,
} from "@/common/db/runtime-role-check";

/**
 * The scenarios two rounds of independent review asked for and neither party
 * could execute: they need a live PostgreSQL and a real non-owner role, so a
 * mocked query double cannot answer them.
 *
 * Four questions, each previously answered only by a unit test with a hand-built
 * manager:
 *
 *  - RV-001: does a concurrent sibling elevation window really keep the bypass
 *    on, measured by rows the database returns rather than by the GUC string?
 *  - FV-003: does `SELECT ... FOR UPDATE` on the parent currency actually
 *    serialize against a concurrent activation's foreign-key lock -- and would
 *    the outcome have been a silent cross-tenant cascade without it?
 *  - MT-13: does the runtime role's grant surface really refuse a write to
 *    `schema_migrations` while still allowing the read?
 *  - DR-R1: is `pg_has_role(..., 'SET')` really transitive, so a two-hop
 *    membership chain through an unremarkable intermediate role is caught?
 *
 * The last one matters most for confidence: it is the only way to establish that
 * the startup check's central predicate behaves as the documentation says,
 * rather than as the author read it.
 */
describe("RLS elevation and runtime role (real PostgreSQL)", () => {
  jest.setTimeout(120000);

  let dataSource: DataSource;
  const USER_A = randomUUID();
  const USER_B = randomUUID();
  const previousMode = process.env.RLS_MODE;

  /** A pool of exactly one connection, authenticated as the non-owner role. */
  async function appRolePool(): Promise<DataSource> {
    const ds = new DataSource({
      ...INTEGRATION_TYPEORM_OPTIONS,
      username: TEST_APP_ROLE,
      password: TEST_APP_ROLE_PASSWORD,
      synchronize: false,
      dropSchema: false,
      extra: { max: 1 },
    } as never);
    await ds.initialize();
    return ds;
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      ...INTEGRATION_TYPEORM_OPTIONS,
      synchronize: true,
      dropSchema: true,
    } as never);
    await dataSource.initialize();
    // `synchronize` builds from entity metadata, and `schema_migrations` has no
    // entity -- it is the migration runner's own ledger. Create it before the role
    // is provisioned, because the revoke that MT-13 is about is guarded on the
    // table existing and would otherwise be a silent no-op.
    await dataSource.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         filename VARCHAR(255) PRIMARY KEY,
         applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
       )`,
    );
    await applyRlsPolicies(dataSource, { includeEnable: true });

    await dataSource.query(
      `INSERT INTO currencies (code, name, symbol, decimal_places, is_active)
       VALUES ('USD', 'US Dollar', '$', 2, true)
       ON CONFLICT (code) DO NOTHING`,
    );
    for (const id of [USER_A, USER_B]) {
      await dataSource.query(
        `INSERT INTO users (id, email, password_hash, first_name, last_name)
         VALUES ($1, $2, 'x', 'T', 'U')`,
        [id, `${id}@example.test`],
      );
      await dataSource.query(
        `INSERT INTO accounts (id, user_id, name, account_type, currency_code)
         VALUES ($1, $2, $3, 'CHEQUING', 'USD')`,
        [randomUUID(), id, `acct-${id.slice(0, 8)}`],
      );
    }
  });

  afterAll(async () => {
    if (previousMode === undefined) delete process.env.RLS_MODE;
    else process.env.RLS_MODE = previousMode;
    await dataSource?.destroy();
  });

  describe("RV-001 -- concurrent sibling elevation windows", () => {
    it("keeps a sibling's reads unfiltered after the other sibling returns", async () => {
      // The shape `listDelegates` had: Promise.all over a page, each branch
      // opening its own window. The assertion is on ROWS, not on the GUC: what
      // the defect actually produced was a count computed from one tenant's rows
      // while the code believed it was global.
      const app = await appRolePool();
      process.env.RLS_MODE = "enforce";
      try {
        let lateCount = -1;

        await withUserContext(USER_A, () =>
          withScopedDb(app, async (m) => {
            // Both windows are opened in ONE synchronous burst, which is what
            // `Promise.all` over a page of rows does and what puts both bypass
            // probes on the wire before either flip: the pre-fix algorithm then
            // had both siblings believing they owned the restore.
            const fast = withElevatedDb(m, "fast sibling", async (elevated) => {
              await elevated.query("SELECT count(*) FROM accounts");
            });
            const slow = withElevatedDb(m, "slow sibling", async (elevated) => {
              // Awaiting the sibling's whole promise -- not a signal it fires
              // mid-flight -- is what makes this measure the defect: it resolves
              // only after that sibling's `finally` has run, so the read below is
              // issued strictly after any restore it performed.
              await fast;
              const [{ n }] = await elevated.query(
                "SELECT count(*)::int AS n FROM accounts",
              );
              lateCount = n;
            });
            await Promise.all([fast, slow]);
          }),
        );

        // Both users' accounts. Tenant-filtered it would be 1 -- which is exactly
        // how a delegation count of 2 became 1 and offered a reset it should not.
        expect(lateCount).toBe(2);
      } finally {
        await app.destroy();
      }
    });

    it("restores the tenant filter once the last sibling has left", async () => {
      // The other half of the contract: the window must actually close. A
      // reference count that never reached zero would leave the rest of the
      // transaction elevated, which is the opposite failure and just as bad.
      const app = await appRolePool();
      process.env.RLS_MODE = "enforce";
      try {
        const after = await withUserContext(USER_A, () =>
          withScopedDb(app, async (m) => {
            await Promise.all([
              withElevatedDb(m, "sibling one", (e) =>
                e.query("SELECT 1 FROM accounts"),
              ),
              withElevatedDb(m, "sibling two", (e) =>
                e.query("SELECT 1 FROM accounts"),
              ),
            ]);
            const [{ n }] = await m.query(
              "SELECT count(*)::int AS n FROM accounts",
            );
            return n;
          }),
        );

        expect(after).toBe(1);
      } finally {
        await app.destroy();
      }
    });

    it("sees only its own rows without elevation, so the test above measures something", async () => {
      // Negative control. Without it, "2" could mean the policies were never
      // enforcing in this suite at all.
      const app = await appRolePool();
      process.env.RLS_MODE = "enforce";
      try {
        const n = await withUserContext(USER_A, () =>
          withScopedDb(app, async (m) => {
            const [{ n }] = await m.query(
              "SELECT count(*)::int AS n FROM accounts",
            );
            return n;
          }),
        );
        expect(n).toBe(1);
      } finally {
        await app.destroy();
      }
    });
  });

  describe("FV-003 -- currency deletion against a concurrent activation", () => {
    const CODE = "XYZ";

    beforeEach(async () => {
      await dataSource.query(
        "DELETE FROM user_currency_preferences WHERE currency_code = $1",
        [CODE],
      );
      await dataSource.query("DELETE FROM currencies WHERE code = $1", [CODE]);
      await dataSource.query(
        `INSERT INTO currencies (code, name, symbol, decimal_places, is_active, created_by_user_id)
         VALUES ($1, 'Test', 'X', 2, true, $2)`,
        [CODE, USER_A],
      );
    });

    it("makes a concurrent activation wait and then refuses it, rather than cascading it away", async () => {
      // A: creator deletes the code. B: another tenant activates it. With the
      // parent row locked first, the two serialize -- B waits for A's commit and
      // is then refused by the foreign key. The outcome is deterministic and
      // nothing of B's is silently destroyed.
      const a = await appRolePool();
      const b = await appRolePool();
      try {
        const aRunner = a.createQueryRunner();
        const bRunner = b.createQueryRunner();
        await aRunner.connect();
        await bRunner.connect();
        await aRunner.query(`SET ROLE ${TEST_APP_ROLE}`);
        await bRunner.query(`SET ROLE ${TEST_APP_ROLE}`);

        await aRunner.startTransaction();
        await aRunner.query(
          "SELECT set_config('app.current_user_id', $1, true)",
          [USER_A],
        );
        // The lock this fix added, taken before anything is read or written.
        await aRunner.query(
          "SELECT code FROM currencies WHERE code = $1 FOR UPDATE",
          [CODE],
        );

        await bRunner.startTransaction();
        await bRunner.query(
          "SELECT set_config('app.current_user_id', $1, true)",
          [USER_B],
        );
        await bRunner.query("SET LOCAL lock_timeout = '4s'");
        // Blocks: the FK's KEY SHARE lock conflicts with A's FOR UPDATE.
        const bInsert = bRunner
          .query(
            `INSERT INTO user_currency_preferences (user_id, currency_code, is_active)
             VALUES ($1, $2, true)`,
            [USER_B, CODE],
          )
          .then(
            () => "inserted",
            (e: Error) => e.message,
          );

        // A now decides with a stable view and deletes.
        const [{ n }] = await aRunner.query(
          "SELECT count(*)::int AS n FROM user_currency_preferences WHERE currency_code = $1",
          [CODE],
        );
        expect(n).toBe(0);
        await aRunner.query("DELETE FROM currencies WHERE code = $1", [CODE]);
        await aRunner.commitTransaction();

        const bOutcome = await bInsert;
        // Refused, explicitly, rather than committed and then cascaded away.
        expect(bOutcome).toMatch(
          /violates foreign key constraint|is not present in table/i,
        );
        await bRunner.rollbackTransaction();
        await aRunner.release();
        await bRunner.release();

        const survivors = await dataSource.query(
          "SELECT count(*)::int AS n FROM user_currency_preferences WHERE currency_code = $1",
          [CODE],
        );
        expect(survivors[0].n).toBe(0);
      } finally {
        await a.destroy();
        await b.destroy();
      }
    });

    it("without the lock, the other tenant's committed row is cascaded away", async () => {
      // The negative control, and the reason the lock is not optional: identical
      // sequence with the FOR UPDATE removed. B's activation commits, A's check
      // cannot see it, and the DELETE takes it with no error anywhere.
      const a = await appRolePool();
      const b = await appRolePool();
      try {
        const aRunner = a.createQueryRunner();
        const bRunner = b.createQueryRunner();
        await aRunner.connect();
        await bRunner.connect();
        await aRunner.query(`SET ROLE ${TEST_APP_ROLE}`);
        await bRunner.query(`SET ROLE ${TEST_APP_ROLE}`);

        await aRunner.startTransaction();
        await aRunner.query(
          "SELECT set_config('app.current_user_id', $1, true)",
          [USER_A],
        );
        // No lock. A's reference check runs first and sees nothing.
        const [{ n }] = await aRunner.query(
          "SELECT count(*)::int AS n FROM user_currency_preferences WHERE currency_code = $1",
          [CODE],
        );
        expect(n).toBe(0);

        // B activates and commits in the window between the check and the delete.
        await bRunner.startTransaction();
        await bRunner.query(
          "SELECT set_config('app.current_user_id', $1, true)",
          [USER_B],
        );
        await bRunner.query(
          `INSERT INTO user_currency_preferences (user_id, currency_code, is_active)
           VALUES ($1, $2, true)`,
          [USER_B, CODE],
        );
        await bRunner.commitTransaction();

        await aRunner.query("DELETE FROM currencies WHERE code = $1", [CODE]);
        await aRunner.commitTransaction();
        await aRunner.release();
        await bRunner.release();

        const [{ n: left }] = await dataSource.query(
          "SELECT count(*)::int AS n FROM user_currency_preferences WHERE currency_code = $1",
          [CODE],
        );
        // B committed a row and no longer has it, and nobody was told: A's DELETE
        // succeeded because the FK cascades. This is the production behaviour the
        // lock exists to prevent -- and it is only observable here because the
        // entity now declares the same ON DELETE CASCADE that schema.sql does.
        expect(left).toBe(0);
      } finally {
        await a.destroy();
        await b.destroy();
      }
    });
  });

  describe("MT-13 -- the runtime role's grant surface", () => {
    it("may read the migration ledger but not write it", async () => {
      const app = await appRolePool();
      try {
        await expect(
          app.query("SELECT count(*) FROM schema_migrations"),
        ).resolves.toBeDefined();

        await expect(
          app.query(
            "INSERT INTO schema_migrations (filename) VALUES ('999_forged.sql')",
          ),
        ).rejects.toThrow(/permission denied/i);
        await expect(
          app.query("DELETE FROM schema_migrations"),
        ).rejects.toThrow(/permission denied/i);
        await expect(
          app.query("UPDATE schema_migrations SET filename = filename"),
        ).rejects.toThrow(/permission denied/i);
      } finally {
        await app.destroy();
      }
    });

    it("may write an ordinary application table, so the revoke is targeted", async () => {
      // Negative control: a blanket loss of DML would pass the assertions above
      // while breaking every request.
      const app = await appRolePool();
      process.env.RLS_MODE = "enforce";
      try {
        await withUserContext(USER_A, () =>
          withScopedDb(app, (m) =>
            m.query(
              `INSERT INTO accounts (id, user_id, name, account_type, currency_code)
               VALUES ($1, $2, 'writable', 'CHEQUING', 'USD')`,
              [randomUUID(), USER_A],
            ),
          ),
        );
      } finally {
        await dataSource.query("DELETE FROM accounts WHERE name = 'writable'");
        await app.destroy();
      }
    });
  });

  describe("DR-V2 / DR-R1 -- what the startup check sees", () => {
    it("passes the provisioned unprivileged role", async () => {
      const app = await appRolePool();
      try {
        const facts = await readRuntimeRoleFacts(app);
        expect(facts.currentUser).toBe(TEST_APP_ROLE);
        expect(facts.isSuperuser).toBe(false);
        expect(facts.hasBypassRls).toBe(false);
        expect(facts.ownsDatabase).toBe(false);
        expect(runtimeRoleViolations(facts, TEST_APP_ROLE)).toEqual([]);
      } finally {
        await app.destroy();
      }
    });

    it("refuses the owner connection the rest of the suite uses", async () => {
      // The check has to fail for a real owner, not only for a fabricated fact
      // object. This connection owns the database and every policied table.
      const facts = await readRuntimeRoleFacts(dataSource);
      const violations = runtimeRoleViolations(facts, facts.currentUser);

      expect(violations.length).toBeGreaterThan(0);
      expect(violations.join(" ")).toMatch(/owns this database|SUPERUSER/i);
    });

    it("catches a two-hop SET ROLE chain to the database owner (DR-R1)", async () => {
      // The case a `pg_auth_members.member = r.oid` join cannot see: the runtime
      // role is granted an unremarkable intermediate role, and only that role is
      // granted the owner. This is the whole justification for pg_has_role's
      // transitivity, and a unit test cannot establish it.
      const intermediate = `mid_role_${Date.now()}`;
      const owner = (await dataSource.query("SELECT current_user AS u"))[0].u;
      await dataSource.query(`CREATE ROLE ${intermediate} NOLOGIN`);
      const app = await appRolePool();
      try {
        const before = await readRuntimeRoleFacts(app);
        expect(before.exemptRoleMemberships).toEqual([]);

        await dataSource.query(`GRANT ${owner} TO ${intermediate}`);
        await dataSource.query(`GRANT ${intermediate} TO ${TEST_APP_ROLE}`);

        const after = await readRuntimeRoleFacts(app);
        // The OWNER is named, not just the intermediate: reachability, not the
        // first hop.
        expect(after.exemptRoleMemberships).toContain(owner);
        const violations = runtimeRoleViolations(after, TEST_APP_ROLE);
        expect(violations.join(" ")).toMatch(/SET ROLE/);
      } finally {
        await app.destroy();
        await dataSource.query(`REVOKE ${intermediate} FROM ${TEST_APP_ROLE}`);
        await dataSource.query(`REVOKE ${owner} FROM ${intermediate}`);
        await dataSource.query(`DROP ROLE ${intermediate}`);
      }
    });

    /**
     * RR3-001. The membership matrix, measured rather than reasoned about.
     *
     * PostgreSQL 16 stores `INHERIT` and `SET` independently per grant, and they
     * answer different questions:
     *
     *  - `SET` decides whether the role can *become* the other role. Attribute
     *    exemptions (`rolsuper`, `rolbypassrls`) are reachable only this way,
     *    because attributes are not inherited.
     *  - `INHERIT` decides whether the other role's *privileges* are already in
     *    force. Ownership is a privilege, and PostgreSQL's owner check
     *    (`object_ownercheck` -> `has_privs_of_role`) walks inheritable
     *    memberships -- so an inherited owner bypasses RLS immediately, with no
     *    statement to detect.
     *
     * The previous version of this suite asserted that `WITH SET FALSE` was
     * harmless. The row below marked "the defect" is what that actually is.
     */
    const MEMBERSHIP_MATRIX = [
      {
        grant: "WITH INHERIT TRUE, SET FALSE",
        expectRlsActive: false,
        expectVisibleRows: 2,
        expectRejected: true,
        note: "the defect: inherited ownership, no SET ROLE needed",
      },
      {
        grant: "WITH INHERIT FALSE, SET TRUE",
        expectRlsActive: true,
        expectVisibleRows: 1,
        expectRejected: true,
        note: "no bypass yet, but one SET ROLE away",
      },
      {
        grant: "WITH INHERIT FALSE, SET FALSE",
        expectRlsActive: true,
        expectVisibleRows: 1,
        expectRejected: false,
        note: "neither route available: genuinely harmless",
      },
    ] as const;

    it.each(MEMBERSHIP_MATRIX)(
      "owner membership $grant -- $note",
      async ({ grant, expectRlsActive, expectVisibleRows, expectRejected }) => {
        const owner = (await dataSource.query("SELECT current_user AS u"))[0].u;
        const app = await appRolePool();
        try {
          await dataSource.query(`GRANT ${owner} TO ${TEST_APP_ROLE} ${grant}`);

          // What the database itself thinks, as the app role, with a tenant GUC
          // set -- the ground truth the check is supposed to predict.
          const [observed] = await app.query(
            `SELECT row_security_active('accounts') AS rls_active,
                    pg_has_role(current_user, $1, 'SET') AS can_set,
                    pg_has_role(current_user, $1, 'USAGE') AS has_usage`,
            [owner],
          );
          expect(observed.rls_active).toBe(expectRlsActive);

          const visible = await app.transaction(async (m) => {
            await m.query(
              "SELECT set_config('app.current_user_id', $1, true)",
              [USER_A],
            );
            const [{ n }] = await m.query(
              "SELECT count(*)::int AS n FROM accounts",
            );
            return n;
          });
          expect(visible).toBe(expectVisibleRows);

          // And what the startup check concludes. It must agree with the row
          // count: refusing to serve exactly when the boundary is not there.
          const facts = await readRuntimeRoleFacts(app);
          const violations = runtimeRoleViolations(facts, TEST_APP_ROLE);
          if (expectRejected) {
            expect(violations.length).toBeGreaterThan(0);
          } else {
            expect(violations).toEqual([]);
          }

          if (observed.has_usage && !observed.can_set) {
            // The precise shape of the finding: reported through the inherited
            // arm, which `SET` reachability alone could never have seen.
            expect(facts.inheritedOwnerRoles).toContain(owner);
            expect(facts.exemptRoleMemberships).not.toContain(owner);
          }
        } finally {
          await app.destroy();
          await dataSource.query(`REVOKE ${owner} FROM ${TEST_APP_ROLE}`);
        }
      },
    );

    it("catches an inherited owner two hops away (RR3-001 + DR-R1)", async () => {
      // Both defects at once: the membership is indirect AND it is inherited
      // rather than SET-reachable. A direct-membership join misses the first, and
      // a SET-only predicate misses the second.
      const owner = (await dataSource.query("SELECT current_user AS u"))[0].u;
      const intermediate = `mid_inherit_${Date.now()}`;
      await dataSource.query(`CREATE ROLE ${intermediate} NOLOGIN`);
      const app = await appRolePool();
      try {
        await dataSource.query(
          `GRANT ${owner} TO ${intermediate} WITH INHERIT TRUE, SET FALSE`,
        );
        await dataSource.query(
          `GRANT ${intermediate} TO ${TEST_APP_ROLE} WITH INHERIT TRUE, SET FALSE`,
        );

        const [observed] = await app.query(
          "SELECT row_security_active('accounts') AS rls_active",
        );
        expect(observed.rls_active).toBe(false);

        const facts = await readRuntimeRoleFacts(app);
        expect(facts.inheritedOwnerRoles).toContain(owner);
        expect(runtimeRoleViolations(facts, TEST_APP_ROLE).join(" ")).toContain(
          "inherits the privileges",
        );
      } finally {
        await app.destroy();
        await dataSource.query(`REVOKE ${intermediate} FROM ${TEST_APP_ROLE}`);
        await dataSource.query(`REVOKE ${owner} FROM ${intermediate}`);
        await dataSource.query(`DROP ROLE ${intermediate}`);
      }
    });

    it("does not report an inherited membership in a role that owns nothing policied", async () => {
      // The negative control for the USAGE arm. Inheriting from an ordinary group
      // confers no exemption, and reporting it would train the operator to ignore
      // the message -- the same reasoning that keeps rolsuper/rolbypassrls out of
      // this arm, since those are not inherited at all.
      const plain = `plain_group_${Date.now()}`;
      await dataSource.query(`CREATE ROLE ${plain} NOLOGIN`);
      const app = await appRolePool();
      try {
        await dataSource.query(
          `GRANT ${plain} TO ${TEST_APP_ROLE} WITH INHERIT TRUE, SET TRUE`,
        );

        const facts = await readRuntimeRoleFacts(app);
        expect(facts.inheritedOwnerRoles).not.toContain(plain);
        expect(facts.exemptRoleMemberships).not.toContain(plain);
        expect(runtimeRoleViolations(facts, TEST_APP_ROLE)).toEqual([]);
      } finally {
        await app.destroy();
        await dataSource.query(`REVOKE ${plain} FROM ${TEST_APP_ROLE}`);
        await dataSource.query(`DROP ROLE ${plain}`);
      }
    });

    it("does not inherit BYPASSRLS, so that stays a SET-only question", async () => {
      // The assumption the split rests on. Verified rather than read: a member of
      // a BYPASSRLS role with INHERIT TRUE still has policies applied, because
      // role attributes are not privileges.
      const bypasser = `bypass_role_${Date.now()}`;
      await dataSource.query(`CREATE ROLE ${bypasser} NOLOGIN BYPASSRLS`);
      const app = await appRolePool();
      try {
        await dataSource.query(
          `GRANT ${bypasser} TO ${TEST_APP_ROLE} WITH INHERIT TRUE, SET FALSE`,
        );

        const [observed] = await app.query(
          "SELECT row_security_active('accounts') AS rls_active",
        );
        expect(observed.rls_active).toBe(true);
        const facts = await readRuntimeRoleFacts(app);
        expect(facts.inheritedOwnerRoles).not.toContain(bypasser);
        // ...and it is not SET-reachable either, so nothing is reported.
        expect(facts.exemptRoleMemberships).not.toContain(bypasser);
      } finally {
        await app.destroy();
        await dataSource.query(`REVOKE ${bypasser} FROM ${TEST_APP_ROLE}`);
        await dataSource.query(`DROP ROLE ${bypasser}`);
      }
    });
  });
});
