import { readFileSync } from "fs";
import { join } from "path";
import {
  findRepoRoot,
  gitListFiles,
  requireRepoRoot,
} from "../common/repo-tree.util";

/**
 * `getPeriodicRate` and `calculateEffectiveAnnualRate` are keyed on the
 * mortgage type (`compoundingFor`, `backend/src/accounts/mortgage-type.util.ts`).
 * Their two-flag forms (`isCanadian, isVariableRate`) remain only as overloads
 * that delegate through `mortgageTypeFromFlags` while the two booleans still
 * exist, and are deleted with them in P3-B1 (docs/specs/mortgage-types.md,
 * section 6.1; INV-LOAN-003, INV-LOAN-007).
 *
 * This scan names every production call site of the two-flag forms, per file
 * and per function, as a shrink-only baseline: a new boolean caller fails, and
 * so does a baseline entry that no longer matches, so a migrated caller lowers
 * its count in the same commit rather than leaving room for the next one.
 *
 * The forms are told apart by argument count: the type-keyed forms take three
 * arguments, the two-flag forms four.
 */
const FUNCTIONS = {
  getPeriodicRate: {
    typed: 3,
    flags: 4,
    replacement: "getPeriodicRate(annualRate, periodsPerYear, mortgageType)",
  },
  calculateEffectiveAnnualRate: {
    typed: 3,
    flags: 4,
    replacement:
      "calculateEffectiveAnnualRate(annualRate, periodsPerYear, mortgageType)",
  },
} as const;

type GuardedFunction = keyof typeof FUNCTIONS;

/**
 * The two-flag callers on `main` when the type-keyed forms landed. Shrink-only:
 * lower a count, or delete an entry, as its callers move to the type.
 */
const FLAGS_CALLER_BASELINE: Readonly<
  Record<string, Partial<Record<GuardedFunction, number>>>
> = {
  "src/accounts/loan-mortgage-account.service.ts": { getPeriodicRate: 1 },
  "src/accounts/mortgage-amortization.util.ts": {
    getPeriodicRate: 4,
    calculateEffectiveAnnualRate: 1,
  },
  "src/loan-rate-changes/loan-rate-changes.service.ts": { getPeriodicRate: 2 },
  "src/scheduled-transactions/scheduled-transaction-loan.service.ts": {
    getPeriodicRate: 1,
  },
};

/**
 * The source with comments removed and the contents of string and template
 * literals blanked, so a call written in a comment or a string is not counted,
 * a comment between two arguments does not hide a comma, and a comma inside a
 * string argument does not add one. A `//` inside a string is not a comment.
 */
export function codeOnly(source: string): string {
  const parts: string[] = [];
  let start = 0;
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && (next === "/" || next === "*")) {
      parts.push(source.slice(start, i));
      if (next === "/") {
        const end = source.indexOf("\n", i);
        i = end === -1 ? source.length : end;
      } else {
        const end = source.indexOf("*/", i + 2);
        i = end === -1 ? source.length : end + 2;
        parts.push(" ");
      }
      start = i;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < source.length && source[j] !== ch) {
        j += source[j] === "\\" ? 2 : 1;
      }
      const close = Math.min(j, source.length);
      parts.push(source.slice(start, i), ch, " ".repeat(close - i - 1), ch);
      i = close + 1;
      start = i;
      continue;
    }
    i++;
  }
  parts.push(source.slice(start));
  return parts.join("");
}

/**
 * The argument count of every call of `name` in a `codeOnly` source,
 * skipping its declarations (`function name(`). A trailing comma does not
 * count as an argument.
 */
export function callArgumentCounts(source: string, name: string): number[] {
  const counts: number[] = [];
  const pattern = new RegExp(`\\b${name}\\s*\\(`, "g");
  for (const match of source.matchAll(pattern)) {
    const before = source.slice(Math.max(0, match.index - 40), match.index);
    if (/\bfunction\s+$/.test(before)) continue;
    let depth = 0;
    let args = 0;
    let sawToken = false;
    for (let i = match.index + match[0].length; i < source.length; i++) {
      const ch = source[i];
      if (ch === "(" || ch === "[" || ch === "{") depth++;
      if (ch === ")" || ch === "]" || ch === "}") {
        if (depth === 0) break;
        depth--;
      }
      if (ch === "," && depth === 0) {
        if (sawToken) args++;
        sawToken = false;
        continue;
      }
      if (!/\s/.test(ch)) sawToken = true;
    }
    counts.push(args + (sawToken ? 1 : 0));
  }
  return counts;
}

/**
 * Every tracked production source under `backend/src`, staged-but-uncommitted
 * files included (`--cached --others --exclude-standard`) so a brand-new file
 * is scanned before its first commit.
 */
function productionSources(): [string, string][] {
  const root = requireRepoRoot(findRepoRoot(__dirname));
  return gitListFiles(root, "--cached --others --exclude-standard")
    .filter((path) => path.startsWith("backend/src/"))
    .filter((path) => path.endsWith(".ts") && !path.endsWith(".spec.ts"))
    .map((path) => [
      path.replace(/^backend\//, ""),
      readFileSync(join(root, path), "utf8"),
    ]);
}

interface CallSites {
  flags: Map<string, Partial<Record<GuardedFunction, number>>>;
  unrecognised: string[];
}

function scanCallSites(sources: [string, string][]): CallSites {
  const flags = new Map<string, Partial<Record<GuardedFunction, number>>>();
  const unrecognised: string[] = [];
  for (const [path, raw] of sources) {
    const names = (Object.keys(FUNCTIONS) as GuardedFunction[]).filter((name) =>
      raw.includes(name),
    );
    if (names.length === 0) continue;
    const source = codeOnly(raw);
    for (const name of names) {
      for (const count of callArgumentCounts(source, name)) {
        if (count === FUNCTIONS[name].flags) {
          const perFile = flags.get(path) ?? {};
          flags.set(path, { ...perFile, [name]: (perFile[name] ?? 0) + 1 });
        } else if (count !== FUNCTIONS[name].typed) {
          unrecognised.push(`${path}: ${name} called with ${count} arguments`);
        }
      }
    }
  }
  return { flags, unrecognised };
}

describe("the two-flag mortgage rate forms are not called anew", () => {
  const sources = productionSources();
  const sites = scanCallSites(sources);

  it("adds no boolean caller beyond the baseline", () => {
    const offenders: string[] = [];
    for (const [path, perFile] of sites.flags) {
      for (const [name, count] of Object.entries(perFile)) {
        const allowed =
          FLAGS_CALLER_BASELINE[path]?.[name as GuardedFunction] ?? 0;
        if (count > allowed) {
          offenders.push(
            `${path}: ${count} two-flag call(s) of ${name}, baseline ${allowed}. ` +
              `Resolve the type (the column, else mortgageTypeFromFlags) and ` +
              `call ${FUNCTIONS[name as GuardedFunction].replacement}.`,
          );
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("has no stale baseline entry", () => {
    // Shrink-only: a count above what the file still holds excuses a caller
    // nobody has argued for.
    const stale: string[] = [];
    for (const [path, perFile] of Object.entries(FLAGS_CALLER_BASELINE)) {
      for (const [name, allowed] of Object.entries(perFile)) {
        const actual = sites.flags.get(path)?.[name as GuardedFunction] ?? 0;
        if (actual < (allowed ?? 0)) {
          stale.push(
            `${path}: ${name} baseline ${allowed}, but ${actual} remain; ` +
              `lower the baseline to ${actual}.`,
          );
        }
      }
    }
    expect(stale).toEqual([]);
  });

  it("recognises every call by its argument count", () => {
    expect(sites.unrecognised).toEqual([]);
  });

  it("scans a non-empty tree, so the rule cannot pass by accident", () => {
    expect(sources.length).toBeGreaterThan(100);
    expect(sites.flags.size).toBeGreaterThan(0);
  });
});

describe("the call-site parser", () => {
  it("counts arguments across lines, nested calls and a trailing comma", () => {
    const source = codeOnly(`
      const a = getPeriodicRate(rate, n, "ANNUITY");
      const b = getPeriodicRate(
        rate,
        // a comment, with a comma
        periodsPerYear(x, y) ?? 12,
        account.isCanadianMortgage || false,
        account.isVariableRate || false,
      );
      const c = calculateEffectiveAnnualRate(rate, [1, 2].length, type);
    `);
    expect(callArgumentCounts(source, "getPeriodicRate")).toEqual([3, 4]);
    expect(callArgumentCounts(source, "calculateEffectiveAnnualRate")).toEqual([
      3,
    ]);
  });

  it("skips declarations, comments and string contents", () => {
    const source = codeOnly(`
      export function getPeriodicRate(a: number, b: number, c: string): number;
      /* getPeriodicRate(a, b, c, d) */
      // getPeriodicRate(a, b, c, d)
      const s = "getPeriodicRate(a, b, c, d) // not a comment";
    `);
    expect(callArgumentCounts(source, "getPeriodicRate")).toEqual([]);
  });

  it("keeps a string argument containing a comma as one argument", () => {
    expect(
      callArgumentCounts(
        codeOnly(`getPeriodicRate(a, b, "x, (y")`),
        "getPeriodicRate",
      ),
    ).toEqual([3]);
  });
});
