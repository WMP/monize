import { readFileSync } from "fs";
import { join } from "path";
import { RESTORE_PLAN } from "./restore-plan";

/**
 * Proves the export never hands JSON a value JSON cannot carry.
 *
 * The export is `SELECT *` for most tables, and `pg` returns a `bytea` column as
 * a `Buffer`. Nothing downstream survives that:
 *
 *   - `JSON.stringify` turns a Buffer into `{"type":"Buffer","data":[...]}`,
 *     roughly six bytes of JSON per byte of payload.
 *   - `deepRemapIds` walks objects with `Object.fromEntries(Object.entries(...))`,
 *     so it destructures the Buffer into a numeric-keyed object.
 *   - `insertRows` sees the column in `byteaColumns` and wraps its placeholder in
 *     `decode($n, 'base64')`, which then receives that JSON text.
 *
 * The result is a restore that either errors or writes garbage bytes. Both of
 * today's bytea columns are read through `encode(..., 'base64')` for exactly this
 * reason, and this test is what stops the next one from being added without it.
 *
 * Timestamps and DATEs are the same shape of hazard with a subtler outcome: a
 * `Date` serialises to an ISO instant, and for a DATE column that can shift the
 * day when it is parsed back in a negative-offset zone. `main.ts` installs a
 * global DATE-as-string parser, but `backend/CLAUDE.md` is explicit that it must
 * not be relied on, since it is absent in any process that does not boot the app.
 * That is left as-is here (it needs a driver-level fix, not an export-level one)
 * and is asserted only to the extent that DATE columns are never bytea.
 */

const SCHEMA_PATH = join(__dirname, "..", "..", "..", "database", "schema.sql");
const SERVICE_PATH = join(__dirname, "backup.service.ts");

const schema = readFileSync(SCHEMA_PATH, "utf8");
const service = readFileSync(SERVICE_PATH, "utf8");

/** Uncommented schema, so a column documented in prose cannot match. */
const uncommentedSchema = schema
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

/** `table.column` for every bytea column in the schema. */
function byteaColumns(): string[] {
  const found: string[] = [];
  for (const [, table, body] of uncommentedSchema.matchAll(
    /CREATE TABLE(?: IF NOT EXISTS)?\s+(\w+)\s*\(([\s\S]*?)\n\);/g,
  )) {
    for (const match of body.matchAll(/^\s*(\w+)\s+BYTEA\b/gim)) {
      found.push(`${table}.${match[1]}`);
    }
  }
  return found;
}

/** The SQL of each export query, keyed by the table it reads. */
function exportQueries(): Map<string, string> {
  const block = service.slice(
    service.indexOf("private getTableQueries()"),
    service.indexOf("private async collectGzippedExport"),
  );
  const queries = new Map<string, string>();
  for (const match of block.matchAll(
    /key:\s*"(\w+)",\s*\n?\s*sql:\s*(`[\s\S]*?`|"[\s\S]*?")/g,
  )) {
    queries.set(match[1], match[2]);
  }
  return queries;
}

const bytea = byteaColumns();
const queries = exportQueries();
const exportedTables = new Set(queries.keys());

describe("export driver values", () => {
  // Everything below trusts these two parsers; a regex that stopped matching
  // would make each assertion vacuously true.
  describe("parsers", () => {
    it("finds the bytea columns that exist today", () => {
      expect(bytea).toContain("institutions.logo_data");
      expect(bytea).toContain("attachment_blobs.data");
      expect(bytea).toContain("import_staged_files.data");
    });

    it("finds an export query for every restored table", () => {
      const missing = RESTORE_PLAN.map((step) => step.table).filter(
        (table) => !exportedTables.has(table),
      );
      // A restored table with no export query would be wiped and never refilled.
      expect(missing).toEqual([]);
    });
  });

  it("reads every exported bytea column through encode(..., 'base64')", () => {
    const unencoded = bytea.filter((qualified) => {
      const [table, column] = qualified.split(".");
      const sql = queries.get(table);
      if (!sql) return false; // not exported at all -- nothing to get wrong
      return !new RegExp(`encode\\(\\s*(?:\\w+\\.)?${column}\\s*,`, "i").test(
        sql,
      );
    });

    // A bytea column reaching JSON as a Buffer is corrupted three times over --
    // see this file's header. Either read it with `encode(col, 'base64')` (and
    // let insertRows' decode() put it back), or exclude the table.
    expect(unencoded).toEqual([]);
  });

  it("does not SELECT * from a table that has a bytea column", () => {
    const wildcards = bytea
      .map((qualified) => qualified.split(".")[0])
      .filter((table) => {
        const sql = queries.get(table);
        return !!sql && /SELECT\s+\*/i.test(sql);
      });

    // `SELECT *` picks up a bytea column silently the moment a migration adds
    // one, which is why these tables list their columns explicitly.
    expect([...new Set(wildcards)]).toEqual([]);
  });

  it("keeps the restore's bytea decode in step with the export's encode", () => {
    // The two halves are separated by the file format, so a change to one that
    // misses the other produces bytes that survive the round trip only by luck.
    expect(service).toMatch(/data_type === "bytea"/);
    expect(service).toMatch(/decode\(\$\$\{i \+ 1\}, 'base64'\)|decode\(\$/);
  });
});
