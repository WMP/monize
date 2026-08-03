import * as fs from "fs";
import * as path from "path";

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const ESLINT_CONFIG = path.join(REPO_ROOT, "backend/eslint.config.mjs");

/**
 * The documented set of prohibited database primitives must be the configured
 * set.
 *
 * `CONTRIBUTING.md` told contributors to use `QueryRunner` transactions for every
 * multi-table write, long after the root instructions and ESLint had prohibited
 * them, and the auxiliary agent guidance demonstrated `dataSource.transaction`.
 * Nothing failed, because a document cannot be type-checked -- so a contributor
 * or an agent following official guidance produced code CI rejects, or worse,
 * code that evades the narrow syntax rule and merges.
 *
 * Fixing the wording is not the fix. This ties the two together: a ban added to
 * the config that no instruction file mentions fails here, and so does an
 * instruction naming a ban the config does not have. It reads the config as text
 * on purpose -- importing it would execute a flat-config module for its side
 * effects and still not enumerate the selectors.
 */
describe("RLS lint bans are documented where contributors read", () => {
  const config = fs.readFileSync(ESLINT_CONFIG, "utf8");

  /**
   * Method names banned via `no-restricted-syntax` on
   * `CallExpression[callee.property.name="..."]`, read out of the config rather
   * than listed here, so a new ban is covered without editing this spec.
   */
  const bannedCalls = [
    ...config.matchAll(
      /CallExpression\[callee\.property\.name="([A-Za-z]+)"\]/g,
    ),
  ].map((match) => match[1]);

  const instructionFiles = [
    "CLAUDE.md",
    "CONTRIBUTING.md",
    "backend/CLAUDE.md",
  ];

  it("finds the bans it is meant to check", () => {
    // A regex that silently matches nothing would make every assertion below
    // vacuous.
    expect(bannedCalls).toContain("createQueryRunner");
    expect(bannedCalls).toContain("transaction");
    expect(config).toContain("InjectRepository");
  });

  it.each(["CLAUDE.md", "CONTRIBUTING.md"])(
    "%s names every call the config bans",
    (relative) => {
      const doc = fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
      // The call form, not the bare word: `transaction` is ordinary English in
      // these files ("MUST run in a single transaction"), so a substring check
      // for the method name would pass without the ban being documented at all.
      // The receiver is left open -- these files write both
      // `this.dataSource.transaction(...)` and a bare `createQueryRunner()`.
      const missing = bannedCalls.filter(
        (name) => !new RegExp(String.raw`\b${name}\(`).test(doc),
      );
      expect(missing).toEqual([]);
    },
  );

  it("no instruction file positively recommends a banned primitive", () => {
    // The failure mode was an imperative: "must use a QueryRunner transaction".
    // Historical and negative mentions are legitimate and common in these files,
    // so this matches a recommending verb followed by an actual call, and again
    // never by the bare method name.
    const calls = bannedCalls.map((name) => `${name}\\(`).join("|");
    // Same line, within a short distance, and the *call* form -- these files are
    // full of markdown punctuation ("MUST use a `createQueryRunner()`
    // transaction"), so requiring a word boundary right before the identifier
    // let the exact original wording through.
    const recommendation = new RegExp(
      String.raw`(?:must|should|always|prefer)[^\n]{0,40}?(?:${calls}|@InjectRepository)`,
      "i",
    );
    const offenders = instructionFiles.filter((relative) =>
      recommendation.test(
        fs.readFileSync(path.join(REPO_ROOT, relative), "utf8"),
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("does not claim a counting ratchet that no longer exists", () => {
    // `docs/future-plans/mny-import.md` described a CI script counting
    // `@InjectRepository`/`createQueryRunner` sites and failing on any increase.
    // The script is gone -- the ratchet reached zero and became an outright ban
    // -- so a reader was being pointed at a gate that could not fail.
    const scripts = [
      path.join(REPO_ROOT, "scripts"),
      path.join(REPO_ROOT, "backend/scripts"),
    ].flatMap((dir) =>
      fs.existsSync(dir)
        ? fs.readdirSync(dir).map((name) => path.join(dir, name))
        : [],
    );
    const ratchetExists = scripts.some((file) =>
      /InjectRepository|createQueryRunner/.test(fs.readFileSync(file, "utf8")),
    );

    const claimsRatchet = fs
      .readFileSync(
        path.join(REPO_ROOT, "docs/future-plans/mny-import.md"),
        "utf8",
      )
      .match(/the CI script counts/);

    expect(Boolean(claimsRatchet)).toBe(ratchetExists);
  });
});
