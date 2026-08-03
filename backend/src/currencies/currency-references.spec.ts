import { readFileSync } from "fs";
import { join } from "path";
import { CURRENCY_REFERENCE_COLUMNS } from "./currency-reference-columns";

/**
 * Proves the two currency-reference functions consult every foreign key that
 * points at `currencies(code)`.
 *
 * That list has been wrong three times, in three places, for three reasons.
 * `CurrenciesService.isInUseGlobally` named only some of the referencing columns
 * -- `budgets.currency_code` and both `exchange_rates` columns were absent, so
 * it could call a live code dead and hand the caller a foreign-key violation.
 * The backup restore's cleanup named all of them but ran under the caller's RLS
 * scope, where the clauses looking for other users' rows could not see them, and
 * the `user_currency_preferences` cascade then deleted another user's
 * activation. And the backup export did not use the list at all: it selected
 * currencies by `created_by_user_id`, so a user whose accounts were denominated
 * in somebody else's custom currency exported the references without the
 * definition.
 *
 * All three now go through SQL functions -- `currency_code_in_use_globally`
 * (migration 133) for the global question, `currency_codes_referenced_by_user`
 * (134) for the per-user one. What is left to go wrong is a migration adding a
 * reference and not extending them, so that is checked here against the schema
 * rather than against a list somebody has to remember to update.
 */

const SCHEMA_PATH = join(__dirname, "..", "..", "..", "database", "schema.sql");
const schema = readFileSync(SCHEMA_PATH, "utf8");

/** Schema text with `--` comments blanked, so documentation cannot match. */
const uncommented = schema
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

interface CurrencyReference {
  table: string;
  column: string;
}

/** Every column with a foreign key to `currencies(code)`. */
function parseCurrencyReferences(sql: string): CurrencyReference[] {
  const references: CurrencyReference[] = [];
  const tableBlocks = sql.matchAll(
    /CREATE TABLE(?: IF NOT EXISTS)?\s+(\w+)\s*\(([\s\S]*?)\n\);/g,
  );
  for (const [, table, body] of tableBlocks) {
    for (const match of body.matchAll(
      /^\s*(\w+)\s+[A-Za-z0-9_() ,]*?REFERENCES\s+currencies\s*\(\s*code\s*\)/gim,
    )) {
      references.push({ table, column: match[1] });
    }
    for (const match of body.matchAll(
      /FOREIGN KEY\s*\((\w+)\)\s*REFERENCES\s+currencies\s*\(\s*code\s*\)/gi,
    )) {
      references.push({ table, column: match[1] });
    }
  }
  for (const match of sql.matchAll(
    /ALTER TABLE\s+(?:IF EXISTS\s+)?(\w+)\s+ADD CONSTRAINT\s+\w+\s+FOREIGN KEY\s*\((\w+)\)\s*REFERENCES\s+currencies\s*\(\s*code\s*\)/gi,
  )) {
    references.push({ table: match[1], column: match[2] });
  }
  return references;
}

/** A function's body, so the assertions read the SQL that actually ships. */
function functionBody(sql: string, name: string): string {
  const match = new RegExp(
    `CREATE OR REPLACE FUNCTION ${name}\\([\\s\\S]*?\\nAS \\$\\$([\\s\\S]*?)\\$\\$;`,
  ).exec(sql);
  if (!match) {
    throw new Error(`${name} not found in database/schema.sql`);
  }
  return match[1];
}

/** Referencing tables with no `user_id` column, exempt from the per-user answer. */
function tablesWithoutUserId(tables: string[]): string[] {
  return tables.filter((table) => {
    const block = new RegExp(
      `CREATE TABLE(?: IF NOT EXISTS)?\\s+${table}\\s*\\(([\\s\\S]*?)\\n\\);`,
    ).exec(schema);
    return block ? !/^\s*user_id\s/m.test(block[1]) : false;
  });
}

const references = parseCurrencyReferences(uncommented);
const body = functionBody(uncommented, "currency_code_in_use_globally");
const perUserBody = functionBody(
  uncommented,
  "currency_codes_referenced_by_user",
);

describe("currency global liveness", () => {
  // Every assertion below depends on the parser. A regex that stops matching
  // would leave them all vacuously true, so the parser is checked first.
  describe("schema parser", () => {
    it("finds the references it is meant to find", () => {
      const has = (table: string, column: string) =>
        references.some((r) => r.table === table && r.column === column);

      expect(has("accounts", "currency_code")).toBe(true);
      expect(has("user_currency_preferences", "currency_code")).toBe(true);
      expect(has("exchange_rates", "from_currency")).toBe(true);
      expect(has("exchange_rates", "to_currency")).toBe(true);
      // The two the old service-side query forgot.
      expect(has("budgets", "currency_code")).toBe(true);
      expect(has("user_preferences", "default_currency")).toBe(true);
    });

    it("finds more than a handful", () => {
      // A sanity floor for the parser, not a census: the completeness claim is
      // the next test's, which needs no count.
      expect(references.length).toBeGreaterThanOrEqual(8);
    });
  });

  it("consults every column that references currencies(code)", () => {
    const notConsulted = references.filter(
      ({ table, column }) =>
        !new RegExp(`FROM\\s+${table}\\b`, "i").test(body) ||
        !new RegExp(`\\b${column}\\s*=\\s*p_code`, "i").test(body),
    );

    // A reference the function does not consult means the code can be reported
    // as unreferenced while a row still holds it. For the cascading FK on
    // user_currency_preferences that deletes another user's data; for the rest
    // it aborts whatever statement was relying on the answer.
    expect(
      notConsulted.map(({ table, column }) => `${table}.${column}`),
    ).toEqual([]);
  });

  /**
   * The per-user companion (migration 134), which the backup export uses to
   * decide which currency definitions to include. Same list of referencing
   * columns, different question -- and the export used to answer it with
   * `created_by_user_id = $1`, so a user whose accounts were denominated in
   * somebody else's custom currency exported the references without the
   * definition and the restore invented the metadata.
   */
  describe("currency_codes_referenced_by_user", () => {
    it("consults every referencing column whose table has an owner", () => {
      const ownerless = new Set(
        tablesWithoutUserId([...new Set(references.map((r) => r.table))]),
      );
      const notConsulted = references
        .filter(({ table }) => !ownerless.has(table))
        .filter(
          ({ table, column }) =>
            !new RegExp(`FROM\\s+${table}\\b`, "i").test(perUserBody) ||
            !new RegExp(`SELECT\\s+${column}\\b`, "i").test(perUserBody),
        );

      // A missed column means a currency the user's data depends on is left out
      // of their backup, and the restore guesses its name, symbol and decimal
      // places instead.
      expect(
        notConsulted.map(({ table, column }) => `${table}.${column}`),
      ).toEqual([]);
    });

    it("excludes exactly the ownerless referencing tables", () => {
      // Not an exception list: a referencing table with no `user_id` cannot
      // contribute to a per-user answer. Asserted so the rule stays visible if a
      // future table joins exchange_rates in that category.
      expect(
        tablesWithoutUserId([
          ...new Set(references.map((r) => r.table)),
        ]).sort(),
      ).toEqual(["exchange_rates"]);
      expect(perUserBody).not.toMatch(/FROM\s+exchange_rates/i);
    });

    it("scopes every branch to the requested user", () => {
      const branches = perUserBody
        .split(/UNION/i)
        .map((b) => b.trim())
        .filter(Boolean);
      expect(branches.length).toBeGreaterThan(5);
      // A branch without the predicate would return every user's codes, so a
      // backup would carry currency rows the exporter has nothing to do with.
      for (const branch of branches) {
        expect(branch).toMatch(/WHERE user_id = p_user_id/);
      }
    });

    it("is SECURITY INVOKER", () => {
      const definition =
        /CREATE OR REPLACE FUNCTION currency_codes_referenced_by_user\([\s\S]*?\nAS \$\$/.exec(
          uncommented,
        )![0];
      // The caller's own policies are meant to scope this; a definer function
      // would hand back other tenants' codes.
      expect(definition).not.toMatch(/SECURITY DEFINER/);
    });
  });

  it("is SECURITY DEFINER with a pinned search_path", () => {
    const definition =
      /CREATE OR REPLACE FUNCTION currency_code_in_use_globally\([\s\S]*?\nAS \$\$/.exec(
        uncommented,
      )![0];
    // SECURITY DEFINER is the whole point: as an invoker function it would be
    // filtered by the caller's RLS policies and answer the wrong question.
    expect(definition).toMatch(/SECURITY DEFINER/);
    // A definer function without a pinned search_path can be redirected at
    // objects the caller controls.
    expect(definition).toMatch(/SET search_path = public, pg_temp/);
  });

  it("is not executable by PUBLIC", () => {
    expect(uncommented).toMatch(
      /REVOKE ALL ON FUNCTION currency_code_in_use_globally\(VARCHAR\) FROM PUBLIC;/,
    );
  });

  it("is the only SECURITY DEFINER function in the schema", () => {
    // The RLS design relies on invoker functions everywhere else; a second
    // definer function is a privilege decision that needs its own review, not
    // something to notice later.
    // Counted over function definitions only -- COMMENT ON bodies are string
    // literals that survive comment stripping and mention the attribute in prose.
    const definitions =
      uncommented.match(/CREATE (?:OR REPLACE )?FUNCTION[\s\S]*?\$\$/g) ?? [];
    const definers = definitions.filter((d) => /SECURITY DEFINER/.test(d));
    expect(definers).toHaveLength(1);
  });

  /**
   * The one caller that cannot ask the database: the support backup rewrites
   * currency codes in an in-memory export, after the rows have left Postgres, so
   * it needs the list in TypeScript. Which makes it the fourth place this list
   * could drift -- hence this.
   */
  it("keeps CURRENCY_REFERENCE_COLUMNS identical to the schema", () => {
    const fromSchema = references
      .map(({ table, column }) => `${table}.${column}`)
      .sort();
    const fromCode = Object.entries(CURRENCY_REFERENCE_COLUMNS)
      .flatMap(([table, columns]) => columns.map((c) => `${table}.${c}`))
      .sort();

    // Both directions: a missing entry leaves a real reference un-rewritten (the
    // pseudonymised code and the row pointing at it disagree, and the artifact
    // will not restore), and a stale entry names a column that no longer exists.
    expect(fromCode).toEqual(fromSchema);
  });

  it("is the predicate both callers use", () => {
    const currenciesService = readFileSync(
      join(__dirname, "currencies.service.ts"),
      "utf8",
    );
    const backupService = readFileSync(
      join(__dirname, "..", "backup", "backup.service.ts"),
      "utf8",
    );
    // Re-deriving the predicate at either call site is how it drifted the first
    // two times.
    expect(currenciesService).toContain("currency_code_in_use_globally");
    expect(backupService).toContain("currency_code_in_use_globally");
    for (const [name, source] of [
      ["currencies.service.ts", currenciesService],
      ["backup.service.ts", backupService],
    ] as const) {
      const spelledOut = /FROM exchange_rates[\s\S]{0,400}?FROM budgets/.test(
        source,
      );
      expect({ file: name, spelledOut }).toEqual({
        file: name,
        spelledOut: false,
      });
    }
  });
});
