import { readFileSync } from "fs";
import { join } from "path";

/**
 * Proves `currency_code_in_use_globally` consults every foreign key that
 * references `currencies(code)`.
 *
 * This predicate has now been wrong twice, in two places, for two different
 * reasons. `CurrenciesService.isInUseGlobally` listed only some of the
 * referencing columns -- `budgets.currency_code` and both `exchange_rates`
 * columns were absent, so it could call a live code dead and hand the caller a
 * foreign-key violation. The backup restore's cleanup listed all of them but ran
 * under the caller's RLS scope, where the clauses looking for other users' rows
 * could not see them, and the `user_currency_preferences` cascade then deleted
 * another user's activation.
 *
 * Both now call one SECURITY DEFINER function (migration 133). What is left to
 * go wrong is a migration adding a thirteenth reference and not extending it --
 * so that is checked here, against the schema rather than against a list
 * somebody has to remember to update.
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

/** The function body, so the assertions read the SQL that actually ships. */
function currencyLivenessBody(sql: string): string {
  const match =
    /CREATE OR REPLACE FUNCTION currency_code_in_use_globally\([\s\S]*?\nAS \$\$([\s\S]*?)\$\$;/.exec(
      sql,
    );
  if (!match) {
    throw new Error(
      "currency_code_in_use_globally not found in database/schema.sql",
    );
  }
  return match[1];
}

const references = parseCurrencyReferences(uncommented);
const body = currencyLivenessBody(uncommented);

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
