import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import {
  BANK_SYNC_CONNECTION_STATUSES,
  BANK_SYNC_LAST_SYNC_STATUSES,
  BANK_SYNC_PROVIDERS,
  BANK_SYNC_PSU_TYPES,
} from "./bank-sync.constants";

/**
 * `bank-sync.constants.ts` documents each list as written once, and each is also
 * a database CHECK. Nothing in TypeScript can read a SQL CHECK, so this guard is
 * what binds them: it fails when a list in `database/schema.sql` or in the
 * bank-sync migration drifts from its constant in either direction. Without it,
 * adding a status to the constant while forgetting the paired migration passes
 * every DTO validator and then fails each INSERT at runtime.
 */
const DATABASE = join(__dirname, "../../../database");
const SCHEMA = readFileSync(join(DATABASE, "schema.sql"), "utf8");
const MIGRATION_FILE = readdirSync(join(DATABASE, "migrations")).filter(
  (name) => name.endsWith("_bank_sync.sql"),
);
const MIGRATION = MIGRATION_FILE.map((name) =>
  readFileSync(join(DATABASE, "migrations", name), "utf8"),
).join("\n");

/** The body of `CREATE TABLE [IF NOT EXISTS] <table> ( ... );`. */
function tableBody(sql: string, table: string): string {
  const match = new RegExp(
    `CREATE TABLE (?:IF NOT EXISTS )?${table}\\s*\\(([\\s\\S]*?)\\n\\);`,
  ).exec(sql);
  if (!match) throw new Error(`no CREATE TABLE ${table} found`);
  return match[1];
}

/** The quoted values of `<column> IN ('a', 'b', ...)` inside one table. */
function checkList(sql: string, table: string, column: string): string[] {
  const match = new RegExp(`\\b${column}\\b\\s+IN\\s*\\(([^)]*)\\)`).exec(
    tableBody(sql, table),
  );
  if (!match) throw new Error(`no ${column} IN (...) CHECK in ${table}`);
  return match[1]
    .split(",")
    .map((entry) => entry.trim().replace(/^'|'$/g, ""))
    .filter((entry) => entry.length > 0);
}

describe("bank-sync constants match the database CHECK constraints", () => {
  it("finds the migration it is checking", () => {
    // A scan that silently matched nothing would pass every case below.
    expect(MIGRATION_FILE).toHaveLength(1);
  });

  describe.each([
    ["schema.sql", SCHEMA],
    ["the migration", MIGRATION],
  ])("%s", (_label, sql) => {
    it.each(["bank_sync_credentials", "bank_sync_connections"])(
      "the %s provider CHECK lists exactly BANK_SYNC_PROVIDERS",
      (table) => {
        expect(checkList(sql, table, "provider").sort()).toEqual(
          [...BANK_SYNC_PROVIDERS].sort(),
        );
      },
    );

    it("the connection status CHECK lists exactly BANK_SYNC_CONNECTION_STATUSES", () => {
      expect(checkList(sql, "bank_sync_connections", "status").sort()).toEqual(
        [...BANK_SYNC_CONNECTION_STATUSES].sort(),
      );
    });

    it("the connection psu_type CHECK lists exactly BANK_SYNC_PSU_TYPES", () => {
      expect(
        checkList(sql, "bank_sync_connections", "psu_type").sort(),
      ).toEqual([...BANK_SYNC_PSU_TYPES].sort());
    });

    it("the bank account last_sync_status CHECK lists exactly BANK_SYNC_LAST_SYNC_STATUSES", () => {
      expect(
        checkList(sql, "bank_sync_accounts", "last_sync_status").sort(),
      ).toEqual([...BANK_SYNC_LAST_SYNC_STATUSES].sort());
    });
  });
});
