import { DataSource } from "typeorm";
import * as fs from "fs";
import * as path from "path";

import {
  INTEGRATION_TYPEORM_OPTIONS,
  cleanTables,
  createTestUserDirect,
} from "../helpers/integration-setup";
import {
  calculateEffectiveAnnualRate,
  calculateMortgageAmortization,
  calculatePaymentAmount,
  getPeriodicRate,
} from "../../src/accounts/mortgage-amortization.util";
import { mortgageTypeOf } from "../../src/accounts/mortgage-type.util";
import { roundMoney } from "../../src/common/round.util";

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
       VALUES ($1, $2, $3, $4, 'CAD', -300000, -300000, $5, $6)`,
      [
        id,
        owner,
        fields.accountType ?? "MORTGAGE",
        `Mortgage ${id}`,
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
    // The harness builds the schema from the entities, which declare both
    // flags without `nullable: true`, so TypeORM makes them NOT NULL here.
    // schema.sql leaves them nullable, and production rows can hold a NULL;
    // match production so the NULL-flag case can be seeded at all.
    await dataSource.query(
      `ALTER TABLE accounts
         ALTER COLUMN is_canadian_mortgage DROP NOT NULL,
         ALTER COLUMN is_variable_rate DROP NOT NULL`,
    );
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

  it("prices every backfilled row through its type as the flags priced it", async () => {
    // Spec decision 2, checked where the column is first read (P1-B3): one
    // mortgage per row of table 4.2, plus the NULL-flag rows, has the same
    // payment, first split and EAR read through the stored type as the
    // two-flag forms gave it before the type existed.
    const rows = [
      { id: "60000000-0000-4000-8000-000000000001", c: false, v: false },
      { id: "60000000-0000-4000-8000-000000000002", c: false, v: true },
      { id: "60000000-0000-4000-8000-000000000003", c: true, v: false },
      { id: "60000000-0000-4000-8000-000000000004", c: true, v: true },
      { id: "60000000-0000-4000-8000-000000000005", c: true, v: null },
      { id: "60000000-0000-4000-8000-000000000006", c: null, v: false },
    ];
    for (const row of rows) {
      await seedAccount(row.id, { isCanadian: row.c, isVariable: row.v });
    }

    await applyMigration();

    const principal = 300000;
    const annualRate = 5;
    const amortizationMonths = 300;
    for (const row of rows) {
      const [stored] = (await dataSource.query(
        `SELECT mortgage_type, is_canadian_mortgage, is_variable_rate
           FROM accounts WHERE id = $1`,
        [row.id],
      )) as {
        mortgage_type: "ANNUITY" | "CANADIAN_FIXED";
        is_canadian_mortgage: boolean | null;
        is_variable_rate: boolean | null;
      }[];
      const type = mortgageTypeOf({
        mortgageType: stored.mortgage_type,
        isCanadianMortgage: stored.is_canadian_mortgage,
        isVariableRate: stored.is_variable_rate,
      });

      for (const ppy of [12, 26]) {
        const flagsRate = getPeriodicRate(
          annualRate,
          ppy,
          stored.is_canadian_mortgage,
          stored.is_variable_rate,
        );
        expect(getPeriodicRate(annualRate, ppy, type)).toBe(flagsRate);
        expect(calculateEffectiveAnnualRate(annualRate, ppy, type)).toBe(
          calculateEffectiveAnnualRate(
            annualRate,
            stored.is_canadian_mortgage,
            stored.is_variable_rate,
            ppy,
          ),
        );
      }

      const flagsMonthlyRate = getPeriodicRate(
        annualRate,
        12,
        stored.is_canadian_mortgage,
        stored.is_variable_rate,
      );
      const flagsPayment = calculatePaymentAmount(
        principal,
        flagsMonthlyRate,
        amortizationMonths,
      );
      const preview = calculateMortgageAmortization({
        principal,
        annualRate,
        amortizationMonths,
        paymentFrequency: "MONTHLY",
        mortgageType: type,
        startDate: new Date(2025, 0, 1),
      });
      expect(preview.paymentAmount).toBe(flagsPayment);
      const flagsInterest = roundMoney(principal * flagsMonthlyRate);
      expect(preview.interestPayment).toBe(flagsInterest);
      expect(preview.principalPayment).toBe(
        roundMoney(flagsPayment - flagsInterest),
      );
    }
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
