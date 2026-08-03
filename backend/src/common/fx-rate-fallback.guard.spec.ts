import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

/**
 * A rate lookup may not fall back to 1.
 *
 * `docs/financial-calculation-contract.md` forbids defaulting an exchange rate
 * to 1: between two different currencies it asserts they are at par, and the
 * unconverted amount then gets summed into a total labelled with the target
 * currency. A 100,000 PLN brokerage contributing 100,000 to a CAD portfolio
 * value is silent, unbounded, and grows with every unconverted account.
 *
 * The rule is in prose in two `CLAUDE.md` files and was violated anyway, in
 * three places, so it is checked here. The check is deliberately narrow: a
 * conditional expression assigned to a rate-ish variable whose else-branch is
 * the literal `1`. That is the exact shape the violations take.
 *
 * The three sites below are **known outstanding violations**, kept on an
 * allowlist rather than silently tolerated. Removing them is not a local edit:
 * `convertToDefault` returning `number | null` makes the seven `total*` fields of
 * `PortfolioSummary` (and their `LlmPortfolioSummary` mirrors, the MCP tool
 * output, the AI tool executor, and the frontend summary card) nullable, which is
 * an API-contract change and the shared valuation envelope DOC-05 asks for. The
 * allowlist may only shrink; a new entry is a regression, not a decision.
 */
const KNOWN_RATE_FALLBACKS: ReadonlyArray<{
  file: string;
  count: number;
  note: string;
}> = [
  {
    file: "securities/portfolio-calculation.service.ts",
    count: 2,
    note: "convertToDefault and the capital-gains fxRate helper. Removing these makes PortfolioSummary's total* fields nullable across backend DTO, MCP, AI tools and the frontend card -- the DOC-05 valuation envelope.",
  },
  {
    file: "investment-reports/investment-report-data.service.ts",
    count: 1,
    note: "report-row fxRate helper; same envelope change, reached through the custom-report row shape.",
  },
];

describe("exchange-rate fallback guard", () => {
  const srcRoot = join(__dirname, "..");

  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return walk(full);
      if (!full.endsWith(".ts") || full.endsWith(".spec.ts")) return [];
      return [full];
    });

  /**
   * `<something>rate<something> = <cond> ? <expr> : 1;`
   *
   * Matches the assignment form the violations use, in either variable-naming
   * style, and only when the fallback is the bare literal 1.
   */
  const FALLBACK = /\b\w*[Rr]ate\w*\s*=\s*[^;\n]*\?\s*[^;\n]*:\s*1\s*;/g;

  const found = new Map<string, number>();
  for (const file of walk(srcRoot)) {
    const matches = readFileSync(file, "utf8").match(FALLBACK);
    if (!matches) continue;
    found.set(
      file
        .slice(srcRoot.length + 1)
        .split("\\")
        .join("/"),
      matches.length,
    );
  }

  it("has no exchange-rate fallback outside the known set", () => {
    const allowed = new Set(KNOWN_RATE_FALLBACKS.map((entry) => entry.file));
    expect([...found.keys()].filter((file) => !allowed.has(file))).toEqual([]);
  });

  it("does not grow the known violations", () => {
    const grown = KNOWN_RATE_FALLBACKS.filter(
      (entry) => (found.get(entry.file) ?? 0) > entry.count,
    ).map(
      (entry) => `${entry.file}: ${found.get(entry.file)} > ${entry.count}`,
    );
    expect(grown).toEqual([]);
  });

  // The allowlist is a debt register, so a paid-off entry has to be struck off --
  // otherwise it keeps licensing a fallback that is no longer there.
  it("has no stale entry left after a fix", () => {
    const stale = KNOWN_RATE_FALLBACKS.filter(
      (entry) => (found.get(entry.file) ?? 0) < entry.count,
    ).map(
      (entry) =>
        `${entry.file}: now ${found.get(entry.file) ?? 0}, lower the count or remove the entry`,
    );
    expect(stale).toEqual([]);
  });
});
