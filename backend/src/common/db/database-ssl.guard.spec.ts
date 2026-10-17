import { readFileSync } from "node:fs";
import { join } from "node:path";
import { globSync } from "glob";

import { extractTsComments } from "../repo-paths.util";

/**
 * Every direct database connection takes its TLS settings from
 * `resolveDatabaseSsl` (`database-ssl.ts`).
 *
 * The pool, the notification listener and the startup scripts have to agree: a
 * `pg.Client` built without `ssl` ignores `DATABASE_SSL`, and against a server
 * that refuses plain connections the container crash-looped in `db-init`
 * before the application started. Nothing about that shape is visible to the
 * type checker, since `ssl` is optional on every constructor, so the rule is
 * held here: a file that opens a connection of its own must call the helper.
 *
 * What it can and cannot see. It reads a file at a time, so it proves the
 * helper is *called* in a file that opens a connection, not that its result
 * reaches the right constructor; the per-script specs (`db-init.spec.ts`,
 * `db-migrate.spec.ts`, `db-demo-check.spec.ts`) assert that. A call only counts
 * as code: a comment that names `resolveDatabaseSsl(`, or an import with no
 * call, does not satisfy the guard.
 */
const SRC = join(__dirname, "..", "..");

/** A connection built by hand: `pg` clients and pools, and a TypeORM data source. */
const OPENS_CONNECTION = /\bnew\s+(?:pg\.)?(?:Client|Pool|DataSource)\s*\(/;

/** A call, not an import: the helper has to be used, not merely mentioned. */
const CALLS_HELPER = /\bresolveDatabaseSsl\s*\(/;

/** The files `directConnectionFiles` is expected to find at the least. */
const KNOWN_CONNECTION_FILES = [
  "db-init.ts",
  "db-migrate.ts",
  "db-demo-check.ts",
  "database/fix-linked-transactions.ts",
  "database/add-skip-price-updates-column.ts",
  "common/cluster/pg-listener.provider.ts",
];

/**
 * `source` with every comment body replaced by spaces, newlines kept so a line
 * number still points at the right line.
 *
 * `extractTsComments` returns bodies in source order but not their positions, so
 * each is located again, accepted only where a comment can actually begin
 * (right after `//` or the block opener). When no such site is found the
 * comment is left in place, which is the safe direction for a scan that wants
 * to *find* a pattern: an unblanked comment can add a file to the report, and
 * the report names it.
 */
function blankComments(source: string): string {
  let out = source;
  let cursor = 0;
  for (const body of extractTsComments(source)) {
    if (body === "") continue;
    let at = out.indexOf(body, cursor);
    while (at !== -1) {
      const opener = out.slice(Math.max(0, at - 2), at);
      if (opener === "//" || opener === "/*") break;
      at = out.indexOf(body, at + 1);
    }
    if (at === -1) continue;
    out =
      out.slice(0, at) +
      body.replace(/[^\n]/g, " ") +
      out.slice(at + body.length);
    cursor = at + body.length;
  }
  return out;
}

/** The paths, among `files`, that open a connection without calling the helper. */
function missingHelper(files: { path: string; source: string }[]): string[] {
  return files
    .filter(({ source }) => {
      const code = blankComments(source);
      return OPENS_CONNECTION.test(code) && !CALLS_HELPER.test(code);
    })
    .map(({ path }) => path);
}

function sourceFiles(): { path: string; source: string }[] {
  return globSync("**/*.ts", {
    cwd: SRC,
    absolute: true,
    ignore: ["**/*.spec.ts", "**/*.d.ts", "**/node_modules/**"],
  })
    .sort()
    .map((file) => ({
      path: file.slice(SRC.length + 1).replace(/\\/g, "/"),
      source: readFileSync(file, "utf8"),
    }));
}

function directConnectionFiles(): string[] {
  return sourceFiles()
    .filter(({ source }) => OPENS_CONNECTION.test(blankComments(source)))
    .map(({ path }) => path);
}

describe("direct database connections take their TLS settings from one place", () => {
  it("every file that opens a connection calls resolveDatabaseSsl", () => {
    const offenders = missingHelper(sourceFiles());

    expect(
      offenders.map(
        (file) =>
          `${file} opens a database connection without ` +
          "`ssl: resolveDatabaseSsl((name) => process.env[name])` " +
          "(common/db/database-ssl.ts). A connection built without it ignores " +
          "DATABASE_SSL and DATABASE_SSL_CA_FILE, and a server that refuses " +
          "plain connections rejects it.",
      ),
    ).toEqual([]);
  });

  it("finds the connections at all, so the scan cannot pass by seeing nothing", () => {
    // The vacuity anchor: a glob or a regex that silently stopped matching would
    // otherwise turn the spec above green.
    const found = directConnectionFiles();

    for (const file of KNOWN_CONNECTION_FILES) {
      expect(found).toContain(file);
    }
  });

  describe("the scan itself", () => {
    it("flags a pg client, a pool and a data source built without the helper", () => {
      const files = [
        { path: "client.ts", source: "const c = new Client({ host });" },
        { path: "pool.ts", source: "const p = new pg.Pool({ host });" },
        {
          path: "source.ts",
          source: 'const d = new DataSource({ type: "postgres" });',
        },
      ];

      expect(missingHelper(files)).toEqual([
        "client.ts",
        "pool.ts",
        "source.ts",
      ]);
    });

    it("accepts a file that builds a connection and calls the helper", () => {
      const source = [
        'import { resolveDatabaseSsl } from "./database-ssl";',
        "const c = new Client({ ssl: resolveDatabaseSsl(read) });",
      ].join("\n");

      expect(missingHelper([{ path: "ok.ts", source }])).toEqual([]);
    });

    it("does not count an import, or a comment naming the helper, as a call", () => {
      const importOnly = [
        'import { resolveDatabaseSsl } from "./database-ssl";',
        "const c = new Client({ host });",
      ].join("\n");
      const commentOnly = [
        "// TODO: pass ssl: resolveDatabaseSsl(read) here",
        "/* resolveDatabaseSsl( ) */",
        "const c = new Client({ host });",
      ].join("\n");

      expect(
        missingHelper([
          { path: "import.ts", source: importOnly },
          { path: "comment.ts", source: commentOnly },
        ]),
      ).toEqual(["import.ts", "comment.ts"]);
    });

    it("does not flag prose that merely names a connection", () => {
      const source = [
        "/**",
        " * A `new Client(...)` here would bypass the pool.",
        " */",
        "// never call new Pool( by hand",
        "export const x = 1;",
      ].join("\n");

      expect(missingHelper([{ path: "prose.ts", source }])).toEqual([]);
    });

    it("blanks comments but keeps line numbers", () => {
      const source = "a // new Client(\nb /* new Pool(\n*/ c";

      const blanked = blankComments(source);

      expect(blanked.split("\n")).toHaveLength(3);
      expect(blanked).not.toContain("new Client(");
      expect(blanked).not.toContain("new Pool(");
      expect(blanked).toContain("a ");
      expect(blanked).toContain(" c");
    });
  });
});
