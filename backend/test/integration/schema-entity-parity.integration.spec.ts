import { DataSource } from "typeorm";
import { readFileSync } from "fs";
import { join } from "path";

import { INTEGRATION_TYPEORM_OPTIONS } from "../helpers/integration-setup";

/**
 * The integration harness builds its schema from entity metadata
 * (`synchronize: true`); production applies `database/schema.sql`. Where an
 * entity omits an `onDelete` that schema.sql declares, the two databases behave
 * differently -- and the difference is invisible until a test asserts a cascade
 * that only production performs, or fails to reproduce one that only production
 * performs.
 *
 * That is not hypothetical. `user_currency_preferences.currency_code` is
 * `ON DELETE CASCADE` in schema.sql and was `NO ACTION` here, which is the FK
 * that made P2-009 a silent cross-tenant deletion: in the harness the same
 * DELETE could only ever have raised a foreign-key error, so the data loss was
 * not reproducible in an integration test at all.
 *
 * 55 further foreign keys drift the same way today. Correcting them all is an
 * entity-wide change with its own review, so they are baselined here and the
 * list may only SHRINK: a new drift fails this test, and a fixed one fails it
 * too, with a message saying to delete the line. That is the same shrink-only
 * shape `array-bound-dto.spec.ts` and `messages.punctuation.test.ts` use.
 *
 * Production is unaffected either way -- it never runs `synchronize`. What is
 * affected is whether an integration suite is evidence about production.
 */
describe("entity/schema FK delete-rule drift (integration)", () => {
  jest.setTimeout(60000);

  /**
   * Foreign keys whose delete rule differs between schema.sql and the
   * entity-derived schema. Shrink-only: never add to this list.
   */
  const KNOWN_DRIFT: string[] = [
    "account_delegates.delegate_user_id",
    "account_delegates.owner_user_id",
    "accounts.linked_account_id",
    "accounts.source_account_id",
    "accounts.user_id",
    "action_history.user_id",
    "ai_insights.user_id",
    "ai_provider_configs.user_id",
    "ai_usage_logs.user_id",
    "budget_alerts.budget_category_id",
    "budget_alerts.budget_id",
    "budget_alerts.user_id",
    "budget_categories.budget_id",
    "budget_categories.category_id",
    "budget_categories.transfer_account_id",
    "budget_period_categories.budget_category_id",
    "budget_period_categories.budget_period_id",
    "budget_period_categories.category_id",
    "budget_periods.budget_id",
    "budgets.user_id",
    "categories.parent_id",
    "categories.user_id",
    "custom_reports.user_id",
    "holdings.account_id",
    "import_column_mappings.user_id",
    "institutions.user_id",
    "investment_reports.user_id",
    "investment_transactions.account_id",
    "investment_transactions.funding_account_id",
    "investment_transactions.transaction_id",
    "investment_transactions.user_id",
    "loan_rate_changes.account_id",
    "loan_rate_changes.user_id",
    "loan_scenarios.account_id",
    "loan_scenarios.user_id",
    "monte_carlo_scenarios.user_id",
    "monthly_account_balances.account_id",
    "monthly_account_balances.user_id",
    "payee_aliases.user_id",
    "payees.user_id",
    "personal_access_tokens.user_id",
    "refresh_tokens.user_id",
    "scheduled_transaction_overrides.category_id",
    "scheduled_transactions.account_id",
    "scheduled_transactions.transfer_account_id",
    "scheduled_transactions.user_id",
    "securities.user_id",
    "security_prices.security_id",
    "tags.user_id",
    "transaction_attachments.user_id",
    "transaction_splits.transaction_id",
    "transactions.account_id",
    "transactions.user_id",
    "trusted_devices.user_id",
    "user_preferences.user_id",
  ];

  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource({
      ...INTEGRATION_TYPEORM_OPTIONS,
      synchronize: true,
      dropSchema: true,
    } as never);
    await dataSource.initialize();
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  /** `table.column -> ON DELETE rule`, as schema.sql declares it. */
  function declaredDeleteRules(): Map<string, string> {
    const sql = readFileSync(
      join(__dirname, "../../../database/schema.sql"),
      "utf8",
    );
    const rules = new Map<string, string>();
    let table: string | null = null;
    for (const line of sql.split("\n")) {
      const created = /^CREATE TABLE (?:IF NOT EXISTS )?(\w+)/.exec(line);
      if (created) table = created[1];
      const fk =
        /^\s*(\w+)\s+[A-Za-z0-9_()[\], ]*REFERENCES\s+\w+\s*\(\s*\w+\s*\)([^,]*)/.exec(
          line,
        );
      if (fk && table) {
        const trailing = fk[2];
        const rule = /ON DELETE CASCADE/i.test(trailing)
          ? "CASCADE"
          : /ON DELETE SET NULL/i.test(trailing)
            ? "SET NULL"
            : "NO ACTION";
        rules.set(`${table}.${fk[1]}`, rule);
      }
    }
    return rules;
  }

  it("has no foreign key drifting outside the known list", async () => {
    const declared = declaredDeleteRules();
    // Sanity: a parser that matched nothing would make this test vacuous.
    expect(declared.size).toBeGreaterThan(80);

    const live: Array<{
      table_name: string;
      column_name: string;
      delete_rule: string;
    }> = await dataSource.query(`
      SELECT tc.table_name, kcu.column_name, rc.delete_rule
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON kcu.constraint_name = tc.constraint_name
        JOIN information_schema.referential_constraints rc
          ON rc.constraint_name = tc.constraint_name
       WHERE tc.constraint_type = 'FOREIGN KEY'
         AND tc.table_schema = 'public'`);
    expect(live.length).toBeGreaterThan(80);

    const drifting = live
      .filter((fk) => {
        const want = declared.get(`${fk.table_name}.${fk.column_name}`);
        return want !== undefined && want !== fk.delete_rule;
      })
      .map((fk) => `${fk.table_name}.${fk.column_name}`)
      .sort();

    const unexpected = drifting.filter((k) => !KNOWN_DRIFT.includes(k));
    const fixed = KNOWN_DRIFT.filter((k) => !drifting.includes(k));

    expect(unexpected).toEqual([]);
    // A fixed one must leave the list, or the list stops meaning anything.
    expect(fixed).toEqual([]);
  });

  it("agrees with schema.sql on the FK P2-009 turns on", async () => {
    // Named explicitly rather than left to the list above: this is the one whose
    // rule decides whether deleting a shared currency destroys another tenant's
    // row or merely fails, so a regression here changes what the currency tests
    // are able to observe.
    const [fk] = await dataSource.query(`
      SELECT rc.delete_rule
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON kcu.constraint_name = tc.constraint_name
        JOIN information_schema.referential_constraints rc
          ON rc.constraint_name = tc.constraint_name
       WHERE tc.constraint_type = 'FOREIGN KEY'
         AND tc.table_name = 'user_currency_preferences'
         AND kcu.column_name = 'currency_code'`);

    expect(fk?.delete_rule).toBe("CASCADE");
  });
});
