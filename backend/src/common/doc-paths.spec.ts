import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, resolve } from "path";

/**
 * A doc that names a file is making a claim about the source tree.
 *
 * The rule is already written down in the root `CLAUDE.md` -- rename or delete a
 * file and grep `docs/` and every `CLAUDE.md` in the same commit -- and it was
 * still broken: the cross-owner-transfers plan pointed at
 * `backend/src/ai/query/transaction-tool-prep.service.ts` for a service that
 * lives under `backend/src/transactions/`, so anyone following the path would
 * find nothing and either hunt for it or create a second one. A rule in prose
 * gets read, agreed with, and violated anyway; this is the version the machine
 * checks.
 *
 * Scope is the binding contracts -- every `CLAUDE.md` plus the top level of
 * `docs/` -- and deliberately not `docs/future-plans/`, whose whole job is to
 * name files that do not exist yet, nor `docs/release-notes/`, which is a
 * shipped historical record and must not be edited to match a later tree.
 *
 * Two strengths of claim, because docs use two idioms:
 *
 *  - A **rooted** path (`backend/src/...`, `database/...`) is an exact claim and
 *    must resolve exactly. This is the one that was wrong.
 *  - A **relative** path (`map/map-loans.ts` inside a section about one
 *    directory) is a readable shorthand, so it only has to match some file's
 *    path suffix somewhere in the tree. That still catches the failure mode that
 *    matters -- a renamed or deleted file -- without forcing every mention to
 *    carry six directories of prefix.
 */
describe("docs name files that exist", () => {
  const REPO_ROOT = resolve(__dirname, "..", "..", "..");

  const SKIP_DIRS = new Set([
    ".git",
    "node_modules",
    "dist",
    "coverage",
    ".next",
    "test-results",
    "playwright-report",
    ".turbo",
  ]);

  /** Prefixes that make a path a claim about an exact location. */
  const ROOTED = [
    "backend/",
    "frontend/",
    "database/",
    "docs/",
    "helm/",
    "scripts/",
    "e2e/",
    ".github/",
    ".claude/",
  ];

  const EXTENSIONS = "ts|tsx|sql|mjs|cjs|js|json|sh|ya?ml|md";
  const PATH_IN_BACKTICKS = new RegExp(
    `\`([A-Za-z0-9_.@/-]+/[A-Za-z0-9_.@-]+\\.(?:${EXTENSIONS}))\``,
    "g",
  );

  /**
   * Paths that are deliberately not files: a glob, a template, or a path inside a
   * container rather than the repo. Each needs a reason, not just an entry.
   */
  const NOT_REPO_PATHS = [
    /\*/, // globs: src/**/*.ts
    /\{|\}/, // templates: messages/{locale}/{namespace}.json
    /^\/(?:data|app|tmp|etc|root)\//, // container and host paths
    /^https?:/,
  ];

  const collectDocs = (): string[] => {
    const docs: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (!SKIP_DIRS.has(entry)) walk(full);
          continue;
        }
        if (entry === "CLAUDE.md") docs.push(full);
      }
    };
    walk(REPO_ROOT);
    // The top level of docs/ only: future-plans names unbuilt files by design,
    // and release-notes is a historical record.
    for (const entry of readdirSync(join(REPO_ROOT, "docs"))) {
      const full = join(REPO_ROOT, "docs", entry);
      if (entry.endsWith(".md") && statSync(full).isFile()) docs.push(full);
    }
    return docs;
  };

  /** Every file in the repo, as repo-relative paths. */
  const allFiles = (): string[] => {
    const out: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (!SKIP_DIRS.has(entry)) walk(full);
          continue;
        }
        out.push(full.slice(REPO_ROOT.length + 1));
      }
    };
    walk(REPO_ROOT);
    return out;
  };

  const docs = collectDocs();
  const files = allFiles();

  it("scans the contracts it claims to scan", () => {
    // A broken walk would make every assertion below vacuous.
    expect(docs.some((d) => d.endsWith("/CLAUDE.md"))).toBe(true);
    expect(
      docs.some((d) => d.endsWith("/docs/financial-calculation-contract.md")),
    ).toBe(true);
    expect(docs.length).toBeGreaterThan(5);
    expect(files.length).toBeGreaterThan(500);
  });

  it("resolves every rooted path exactly", () => {
    const broken: string[] = [];
    for (const doc of docs) {
      const text = readFileSync(doc, "utf8");
      for (const [, path] of text.matchAll(PATH_IN_BACKTICKS)) {
        if (NOT_REPO_PATHS.some((p) => p.test(path))) continue;
        if (!ROOTED.some((prefix) => path.startsWith(prefix))) continue;
        if (existsSync(join(REPO_ROOT, path))) continue;
        broken.push(`${doc.slice(REPO_ROOT.length + 1)}: ${path}`);
      }
    }
    // A doc describing a file that is not there gets read, believed, and built
    // on -- or sends the reader to create a duplicate at the path it names.
    expect(broken).toEqual([]);
  });

  it("resolves every relative path somewhere in the tree", () => {
    const broken: string[] = [];
    for (const doc of docs) {
      const text = readFileSync(doc, "utf8");
      for (const [, path] of text.matchAll(PATH_IN_BACKTICKS)) {
        if (NOT_REPO_PATHS.some((p) => p.test(path))) continue;
        if (ROOTED.some((prefix) => path.startsWith(prefix))) continue;
        if (files.some((f) => f === path || f.endsWith(`/${path}`))) continue;
        broken.push(`${doc.slice(REPO_ROOT.length + 1)}: ${path}`);
      }
    }
    // Weaker than the rooted claim on purpose: a shorthand inside a section
    // about one directory is readable, and this still catches the rename.
    expect(broken).toEqual([]);
  });
});
