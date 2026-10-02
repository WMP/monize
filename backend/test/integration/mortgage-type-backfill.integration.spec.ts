import { DataSource } from "typeorm";
import * as fs from "fs";
import * as path from "path";

import {
  INTEGRATION_TYPEORM_OPTIONS,
  cleanTables,
  createTestUserDirect,
} from "../helpers/integration-setup";

/**
 * The `accounts.mortgage_type` migration's backfill, against the flag
 * combinations a pre-migration database holds (docs/specs/mortgage-types.md,
 * table 4.2).
 *
 * The backfill must name, for every existing mortgage, the convention
 * `getPeriodicRate` already applies to it: semi-annual compounding only when
 * the row is Canadian and not variable, the nominal rate otherwise. A unit test
 * cannot check this, because the claim is about what a SQL `CASE` concludes
 * from production-shaped rows, including the NULL flags the columns permit; so
 * the fixture is a real database and the migration is read from disk.
 */
describe("mortgage_type migration backfill over the legacy flags", () => {
  let dataSource: DataSource;
  let owner: string;

  const MIGRATIONS_DIR = path.join(__dirname, "../../../database/migrations");
  const MIGRATION_FILE = fs
    .readdirSync(MIGRATIONS_DIR)
    .find((f) => /^\d{14}_accounts_mortgage_type\.sql$/.test(f));

  const applyMigration = () =>
    dataSource.query(
      fs.readFileSync(path.join(MIGRATIONS_DIR, MIGRATION_FILE!), "utf8"),
    );

  /** Undo the migration, so each case starts from a genuinely pre-migration table. */
  const removeColumn = async () => {
    await dataSource.query(
      `ALTER TABLE accounts
         DROP CONSTRAINT IF EXISTS accounts_mortgage_type_check`,
    );
    await dataSource.query(
      `ALTER TABLE accounts DROP COLUMN IF EXISTS mortgage_type`,
    );
  };

  const seedAccount = async (
    id: string,
    fields: {
      accountType?: string;
      isCanadian: boolean | null;
      isVariable: boolean | null;
    },
  ): Promise<void> => {
    await dataSource.query(
      `INSERT INTO accounts (id, user_id, account_type, name, currency_code,
                             opening_balance, current_balance,
                             is_canadian_mortgage, is_variable_rate)
       VALUES ($1, $2, $3, $1, 'CAD', -300000, -300000, $4, $5)`,
      [
        id,
        owner,
        fields.accountType ?? "MORTGAGE",
        fields.isCanadian,
        fields.isVariable,
      ],
    );
  };

  const mortgageType = async (id: string): Promise<string | null> => {
    const [row] = (await dataSource.query(
      `SELECT mortgage_type FROM accounts WHERE id = $1`,
      [id],
    )) as { mortgage_type: string | null }[];
    return row.mortgage_type;
  };

  beforeAll(async () => {
    if (!MIGRATION_FILE) {
      throw new Error(
        `No *_accounts_mortgage_type.sql migration found in ${MIGRATIONS_DIR}`,
      );
    }
    dataSource = new DataSource(INTEGRATION_TYPEORM_OPTIONS as never);
    await dataSource.initialize();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      // Leave the shared schema as the entity maps it.
      await applyMigration();
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    await cleanTables(dataSource, ["accounts", "users"]);
    owner = (
      await createTestUserDirect(dataSource, {
        email: "mortgage-type@example.com",
      })
    ).id;
    await removeColumn();
  });

  it("lands one mortgage per row of table 4.2 on its type", async () => {
    const rows = [
      { id: "10000000-0000-4000-8000-000000000001", c: false, v: false },
      { id: "10000000-0000-4000-8000-000000000002", c: false, v: true },
      { id: "10000000-0000-4000-8000-000000000003", c: true, v: false },
      { id: "10000000-0000-4000-8000-000000000004", c: true, v: true },
    ];
    for (const row of rows) {
      await seedAccount(row.id, { isCanadian: row.c, isVariable: row.v });
    }

    await applyMigration();

    expect(await mortgageType(rows[0].id)).toBe("ANNUITY");
    expect(await mortgageType(rows[1].id)).toBe("ANNUITY");
    expect(await mortgageType(rows[2].id)).toBe("CANADIAN_FIXED");
    // Canadian variable computes as a plain annuity today: the variable flag
    // cancels the semi-annual branch, so there is no CANADIAN_VARIABLE type.
    expect(await mortgageType(rows[3].id)).toBe("ANNUITY");
  });

  it("reads a NULL flag as false, the way getPeriodicRate does", async () => {
    // `isCanadian && !isVariableRate` takes the semi-annual branch for
    // (true, null), so that row is CANADIAN_FIXED today; a bare
    // `NOT is_variable_rate` would evaluate to NULL and backfill it ANNUITY,
    // changing its payment.
    const canadianNullVariable = "20000000-0000-4000-8000-000000000001";
    const nullCanadian = "20000000-0000-4000-8000-000000000002";
    await seedAccount(canadianNullVariable, {
      isCanadian: true,
      isVariable: null,
    });
    await seedAccount(nullCanadian, { isCanadian: null, isVariable: false });

    await applyMigration();

    expect(await mortgageType(canadianNullVariable)).toBe("CANADIAN_FIXED");
    expect(await mortgageType(nullCanadian)).toBe("ANNUITY");
  });

  it("leaves non-mortgage accounts null, flags or not", async () => {
    const loan = "30000000-0000-4000-8000-000000000001";
    const chequing = "30000000-0000-4000-8000-000000000002";
    await seedAccount(loan, {
      accountType: "LOAN",
      isCanadian: true,
      isVariable: false,
    });
    await seedAccount(chequing, {
      accountType: "CHEQUING",
      isCanadian: false,
      isVariable: false,
    });

    await applyMigration();

    expect(await mortgageType(loan)).toBeNull();
    expect(await mortgageType(chequing)).toBeNull();
  });

  it("refuses an unknown type and accepts every listed one and null", async () => {
    const id = "40000000-0000-4000-8000-000000000001";
    await seedAccount(id, { isCanadian: false, isVariable: false });
    await applyMigration();

    await expect(
      dataSource.query(
        `UPDATE accounts SET mortgage_type = 'CANADIAN_VARIABLE' WHERE id = $1`,
        [id],
      ),
    ).rejects.toThrow(/accounts_mortgage_type_check/);

    for (const type of [
      "ANNUITY",
      "CANADIAN_FIXED",
      "LINEAR",
      "INTEREST_ONLY",
      null,
    ]) {
      await dataSource.query(
        `UPDATE accounts SET mortgage_type = $2 WHERE id = $1`,
        [id, type],
      );
      expect(await mortgageType(id)).toBe(type);
    }
  });

  it("is re-runnable and never overwrites a stored type", async () => {
    const id = "50000000-0000-4000-8000-000000000001";
    await seedAccount(id, { isCanadian: true, isVariable: false });
    await applyMigration();
    expect(await mortgageType(id)).toBe("CANADIAN_FIXED");

    // A type the user chose after the first apply outlives a second one, even
    // where it disagrees with the flags.
    await dataSource.query(
      `UPDATE accounts SET mortgage_type = 'LINEAR' WHERE id = $1`,
      [id],
    );
    await applyMigration();

    expect(await mortgageType(id)).toBe("LINEAR");
  });
});
