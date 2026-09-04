import { TestingModule } from "@nestjs/testing";
import { DataSource } from "typeorm";
import { AccountsModule } from "@/accounts/accounts.module";
import { PayeeLookupQuotaService } from "@/payees/lookup/google-places/payee-lookup-quota.service";
import { withSystemContext, withUserContext } from "@/common/db/with-context";
import {
  cleanTables,
  createIntegrationModule,
  createTestUserDirect,
} from "../helpers/integration-setup";

/**
 * INV-PAYEE-002 -- the two-connection proof.
 *
 * The claim is that the number of Google Places requests made in a UTC calendar
 * month never exceeds the cap for the key's owner. A unit spec can only assert
 * the SQL string; whether the statement actually refuses a concurrent second
 * claimant is a property of PostgreSQL, and only a real database can answer it.
 *
 * The interleaving needs no barrier here, and that is worth stating rather than
 * assuming. The mechanism is a single `INSERT ... ON CONFLICT DO UPDATE ...
 * WHERE`, so each claimant's read and write are one statement: the second one
 * blocks on the first's row lock inside the statement and re-evaluates the
 * `WHERE` against the committed value. There is no window between a read and a
 * write for a barrier to hold open -- which is precisely the property being
 * tested, and why a read-then-write implementation would fail this spec even
 * under a plain `Promise.all`.
 */
describe("Google Places quota claim (INV-PAYEE-002)", () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let quota: PayeeLookupQuotaService;
  let userId: string;

  beforeAll(async () => {
    // The service's only collaborator is the DataSource, and the subject here
    // is the statement it sends -- AccountsModule is imported solely because
    // the shared harness resolves NetWorthService out of the built module.
    module = await createIntegrationModule([AccountsModule]);
    dataSource = module.get(DataSource);
    quota = new PayeeLookupQuotaService(dataSource);
  });

  afterAll(async () => {
    await module?.close();
  });

  beforeEach(async () => {
    await cleanTables(dataSource, [
      "payee_lookup_usage",
      "google_places_instance_usage",
      "users",
    ]);
    const user = await createTestUserDirect(dataSource);
    userId = user.id;
  });

  const userScope = (cap: number, capEnabled = true) =>
    ({ kind: "user", userId, capEnabled, cap }) as const;
  const operatorScope = (cap: number, capEnabled = true) =>
    ({ kind: "operator", capEnabled, cap }) as const;

  const storedCount = async (): Promise<number> => {
    const rows = await withSystemContext(() =>
      dataSource.query(
        `SELECT google_places_requests AS used FROM payee_lookup_usage
          WHERE user_id = $1`,
        [userId],
      ),
    );
    return rows.length === 0 ? 0 : Number(rows[0].used);
  };

  describe("a user's own key", () => {
    it("has exactly one winner when two claims race over the last slot", async () => {
      await withUserContext(userId, () => quota.claim(userScope(2)));

      const results = await Promise.all([
        withUserContext(userId, () => quota.claim(userScope(2))),
        withUserContext(userId, () => quota.claim(userScope(2))),
      ]);

      // One claim takes the second slot; the other is refused. Both succeeding
      // is the lost update this statement exists to prevent.
      const granted = results.filter((count) => count !== null);
      expect(granted).toHaveLength(1);
      expect(granted[0]).toBe(2);
      expect(await storedCount()).toBe(2);
    });

    it("refuses every claim once the cap is spent, however many race", async () => {
      await withUserContext(userId, () => quota.claim(userScope(1)));

      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          withUserContext(userId, () => quota.claim(userScope(1))),
        ),
      );

      expect(results.every((count) => count === null)).toBe(true);
      expect(await storedCount()).toBe(1);
    });

    it("creates the month's row on the first claim and counts up from one", async () => {
      await expect(
        withUserContext(userId, () => quota.claim(userScope(10))),
      ).resolves.toBe(1);
      await expect(
        withUserContext(userId, () => quota.claim(userScope(10))),
      ).resolves.toBe(2);
    });

    it("counts without limit when the cap is switched off", async () => {
      // The counter still moves -- the settings screen reports it -- but no
      // claim is ever refused.
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          withUserContext(userId, () => quota.claim(userScope(1, false))),
        ),
      );

      expect(results.every((count) => count !== null)).toBe(true);
      expect(await storedCount()).toBe(5);
    });

    it("files the claim under the current UTC month", async () => {
      await withUserContext(userId, () => quota.claim(userScope(10)));

      const rows = await withSystemContext(() =>
        dataSource.query(
          "SELECT month FROM payee_lookup_usage WHERE user_id = $1",
          [userId],
        ),
      );
      const expected = new Date().toISOString().slice(0, 7);
      expect(rows[0].month.trim()).toBe(expected);
    });

    it("keeps one user's spending off another's counter", async () => {
      const other = await createTestUserDirect(dataSource);

      await withUserContext(userId, () => quota.claim(userScope(1)));
      const otherResult = await withUserContext(other.id, () =>
        quota.claim({
          kind: "user",
          userId: other.id,
          capEnabled: true,
          cap: 1,
        }),
      );

      // A shared counter would refuse the second user their first lookup.
      expect(otherResult).toBe(1);
    });

    it("reads back what it has spent this month", async () => {
      await withUserContext(userId, () => quota.claim(userScope(10)));
      await withUserContext(userId, () => quota.claim(userScope(10)));

      await expect(
        withUserContext(userId, () => quota.usedThisMonth(userScope(10))),
      ).resolves.toBe(2);
    });

    it("reports nothing spent before the first claim of the month", async () => {
      await expect(
        withUserContext(userId, () => quota.usedThisMonth(userScope(10))),
      ).resolves.toBe(0);
    });
  });

  describe("the operator's key", () => {
    it("has exactly one winner when two users race over the last slot", async () => {
      // One operator key is one bill, so two different users' lookups compete
      // for the same counter.
      const other = await createTestUserDirect(dataSource);
      await withUserContext(userId, () => quota.claim(operatorScope(2)));

      const results = await Promise.all([
        withUserContext(userId, () => quota.claim(operatorScope(2))),
        withUserContext(other.id, () => quota.claim(operatorScope(2))),
      ]);

      expect(results.filter((count) => count !== null)).toEqual([2]);
    });

    it("counts every user's lookup against the one deployment counter", async () => {
      const other = await createTestUserDirect(dataSource);

      await withUserContext(userId, () => quota.claim(operatorScope(10)));
      await withUserContext(other.id, () => quota.claim(operatorScope(10)));

      await expect(
        withUserContext(userId, () => quota.usedThisMonth(operatorScope(10))),
      ).resolves.toBe(2);
    });
  });
});
