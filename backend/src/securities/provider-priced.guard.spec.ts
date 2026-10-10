import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

/**
 * INV-BOND-005: a security linked to a bond instrument is priced by the bond
 * engine only. Every path that asks a quote provider for a security's quote,
 * bar, window or intraday series therefore consults ONE predicate,
 * `isPricedByQuoteProvider` (`provider-priced.util.ts`), directly or through
 * `isRefreshEligible`, which is built on it.
 *
 * The mistake is mechanical -- a new refresh, backfill or chart path that
 * fetches for "every security" and never asks -- so it gets a scanning test
 * rather than a paragraph. A failure names the predicate to call; the fix is the
 * call, never an entry in EXEMPT below (an entry is a decision about a kind of
 * caller that has no security to price, with its reason).
 */
const SRC_ROOT = join(__dirname, "..");

const PREDICATE = /\b(?:isPricedByQuoteProvider|isRefreshEligible)\s*\(/;

/** The three private entry points of `SecurityPriceService` that reach a provider for a security. */
const GATED_FETCHES =
  /\bthis\.(?:fetchQuoteWithFallback|fetchHistoricalWithFallback|fillPriceWindow)\s*\(/;

/** A direct call of a provider's fetch method. */
const PROVIDER_CALL =
  /\.(?:fetchQuote|fetchHistoricalSeries|fetchHistoricalWindowSeries|fetchIntradaySeries|fetchHistorical|fetchHistoricalWindow)\s*\(/;

const PRICE_SERVICE = "securities/security-price.service.ts";

/**
 * Files that call a provider's fetch method without pricing a security, each with
 * the reason. The provider implementations call one another's methods; the FX and
 * market-index services fetch a currency pair or an index, which no security link
 * can name. Shrink-only: a new reader of security quotes is not an exemption.
 */
const EXEMPT: ReadonlyMap<string, string> = new Map([
  [
    "securities/yahoo-finance.service.ts",
    "a provider implementation, calling its own methods",
  ],
  [
    "securities/msn-finance.service.ts",
    "a provider implementation, calling its own methods",
  ],
  [
    "securities/lse-finance.service.ts",
    "a provider implementation, calling its own methods",
  ],
  [
    "currencies/exchange-rate.service.ts",
    "fetches a currency pair's rate, not a security",
  ],
  [
    "securities/market-index.service.ts",
    "fetches a market index, not a security",
  ],
]);

/** Blank comments, keeping line numbers, so prose may name what the code must not. */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(
      /(^|[^:"'`\\])\/\/[^\n]*/g,
      (m, lead) => lead + " ".repeat(m.length - lead.length),
    );
}

/** Class members at two-space indent, by name, with their text up to the next member. */
export function classMethods(source: string): Map<string, string> {
  const lines = source.split("\n");
  const starts: Array<{ name: string; line: number }> = [];
  lines.forEach((text, line) => {
    const m =
      /^ {2}(?:(?:public|private|protected|static|async)\s+)*([A-Za-z_]\w*)\s*(?:<[^>]*>)?\(/.exec(
        text,
      );
    if (m) starts.push({ name: m[1], line });
  });
  const methods = new Map<string, string>();
  starts.forEach(({ name, line }, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].line : lines.length;
    methods.set(name, lines.slice(line, end).join("\n"));
  });
  return methods;
}

/** Methods that reach a provider through a gated entry point without consulting the predicate. */
export function ungatedMethods(source: string): string[] {
  return [...classMethods(stripComments(source))]
    .filter(([, body]) => GATED_FETCHES.test(body) && !PREDICATE.test(body))
    .map(([name]) => name);
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      out.push(...sourceFiles(full));
      continue;
    }
    if (!entry.endsWith(".ts") || /\.(spec|test)\.ts$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

const read = (rel: string) =>
  stripComments(readFileSync(join(SRC_ROOT, rel), "utf8"));
const relOf = (file: string) => relative(SRC_ROOT, file).split("\\").join("/");

describe("a bond-linked security is never priced by a quote provider (INV-BOND-005)", () => {
  const files = sourceFiles(SRC_ROOT);

  it("scans files at all", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("builds the refresh-eligibility predicate on the one named predicate", () => {
    const methodless = read(PRICE_SERVICE);
    const body = /function isRefreshEligible\([\s\S]*?\n\}\n/.exec(methodless);
    expect(body).not.toBeNull();
    expect(body![0]).toMatch(/\bisPricedByQuoteProvider\s*\(/);
  });

  it("has no method of SecurityPriceService reaching a provider without consulting it", () => {
    const offenders = ungatedMethods(
      readFileSync(join(SRC_ROOT, PRICE_SERVICE), "utf8"),
    );
    expect(offenders.map((name) => `${PRICE_SERVICE}: ${name}()`)).toEqual([]);
  });

  it("still finds the gated entry points, so the rule cannot pass over an empty sweep", () => {
    const methods = [...classMethods(read(PRICE_SERVICE))].filter(([, body]) =>
      GATED_FETCHES.test(body),
    );
    // refresh x2, backfill, settlement, range fetch, on-demand fill, holding period.
    expect(methods.length).toBeGreaterThanOrEqual(7);
  });

  it("has no other file calling a provider's fetch without consulting it or being exempt", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relOf(file);
      if (rel === PRICE_SERVICE || rel.startsWith("securities/providers/")) {
        continue;
      }
      const source = stripComments(readFileSync(file, "utf8"));
      if (!PROVIDER_CALL.test(source)) continue;
      if (EXEMPT.has(rel) || PREDICATE.test(source)) continue;
      offenders.push(
        `${rel} -- call isPricedByQuoteProvider (securities/provider-priced.util.ts) before asking a provider about a security`,
      );
    }
    expect(offenders).toEqual([]);
  });

  it("keeps every exemption pointing at a file that still calls a provider", () => {
    for (const rel of EXEMPT.keys()) {
      expect(PROVIDER_CALL.test(read(rel))).toBe(true);
    }
  });

  describe("the scanner", () => {
    it("flags a method that fetches without the predicate, and passes one that asks", () => {
      const source = [
        "class S {",
        "  async refreshNew() {",
        "    return this.fetchQuoteWithFallback(s);",
        "  }",
        "  async refreshOld() {",
        "    const ok = list.filter((s) => isRefreshEligible(s));",
        "    return this.fetchHistoricalWithFallback(ok[0]);",
        "  }",
        "  private async other(x) {",
        "    return this.fillPriceWindow(x);",
        "  }",
        "}",
      ].join("\n");
      expect(ungatedMethods(source)).toEqual(["refreshNew", "other"]);
    });

    it("reads a comment naming the predicate as prose, not as a call", () => {
      const source = [
        "class S {",
        "  async refreshNew() {",
        "    // consults isPricedByQuoteProvider(s) -- not really",
        "    return this.fetchQuoteWithFallback(s);",
        "  }",
        "}",
      ].join("\n");
      expect(ungatedMethods(source)).toEqual(["refreshNew"]);
    });
  });
});
