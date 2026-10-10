import { readdirSync, readFileSync } from "fs";
import { join, relative } from "path";

/**
 * The bond domain and engine know no country, issuer, program or product. A rule
 * of one market is data in an adapter (`src/bonds/adapters/<country>/`) built
 * from the generic primitives of the terms document; the engine only switches on
 * a primitive's `type`. Adding a country must not change `domain/` or `engine/`.
 */
const BONDS_ROOT = join(__dirname);
const GUARDED = ["domain", "engine"];
const FORBIDDEN = /\b(PL|PLN|TOS|ROR|COI|EDO|NBP|GUS)\b/;
const ADAPTER_IMPORT =
  /from\s+["'][^"']*adapters[^"']*["']|require\(\s*["'][^"']*adapters/;

const HOW_TO_FIX =
  "Express the rule as a primitive in the terms data (a new union member in " +
  "domain/bond-terms.ts plus one engine case) and keep the market-specific part " +
  "in src/bonds/adapters/<country>/.";

/** Blank comments, keeping line numbers, so prose may name what the code must not. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(
      /(^|[^:"'`\\])\/\/[^\n]*/g,
      (m, lead) => lead + " ".repeat(m.length - lead.length),
    );
}

function guardedFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (path.endsWith(".ts") && !path.endsWith(".spec.ts"))
        out.push(path);
    }
  };
  GUARDED.forEach((d) => walk(join(BONDS_ROOT, d)));
  return out;
}

function offenders(pattern: RegExp): string[] {
  const found: string[] = [];
  for (const file of guardedFiles()) {
    stripComments(readFileSync(file, "utf8"))
      .split("\n")
      .forEach((line, i) => {
        if (pattern.test(line))
          found.push(`${relative(BONDS_ROOT, file)}:${i + 1}: ${line.trim()}`);
      });
  }
  return found;
}

describe("bonds domain and engine are country-agnostic", () => {
  it("scans files at all", () => {
    expect(guardedFiles().length).toBeGreaterThan(5);
  });

  it("imports nothing from an adapter", () => {
    const found = offenders(ADAPTER_IMPORT);
    if (found.length) {
      throw new Error(
        `domain/ and engine/ must not import adapters:\n${found.join("\n")}\n${HOW_TO_FIX}`,
      );
    }
  });

  it("names no country, currency, issuer, program or product", () => {
    const found = offenders(FORBIDDEN);
    if (found.length) {
      throw new Error(
        `country or product literal in domain/ or engine/:\n${found.join("\n")}\n${HOW_TO_FIX}`,
      );
    }
  });

  describe("the scanner", () => {
    it("lets a comment name what code may not, and catches code", () => {
      const prose = stripComments(
        "// TOS note\n/* ROR\nPLN */\nconst a = 1;\n",
      );
      expect(FORBIDDEN.test(prose)).toBe(false);
      expect(prose.split("\n")).toHaveLength(5);
      expect(FORBIDDEN.test(stripComments('const c = "PLN";'))).toBe(true);
      expect(
        FORBIDDEN.test(
          stripComments('const c = "x"; // fine\nconst d = "TOS";'),
        ),
      ).toBe(true);
    });

    it("matches an adapter import in both import styles", () => {
      expect(ADAPTER_IMPORT.test('import { x } from "../adapters/pl";')).toBe(
        true,
      );
      expect(ADAPTER_IMPORT.test('const x = require("../adapters/pl")')).toBe(
        true,
      );
      expect(ADAPTER_IMPORT.test('import { x } from "../domain/a";')).toBe(
        false,
      );
    });
  });
});
