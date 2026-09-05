import { readFileSync } from "fs";
import { join } from "path";
import { gitListFiles } from "./repo-tree.util";
import {
  resolveNumberLocale,
  numberFormatterFor,
  defaultNumberT,
} from "./number-locale.util";
import { DEFAULT_LOCALE } from "../i18n/config";

/**
 * Issue #1316: a figure the server composes FOR A PERSON follows that person's
 * number locale, never the server's.
 *
 * The two `en-US` helpers in `format-currency.util.ts` were reached by six
 * production callers, and one of them was the bill-reminder email -- which takes
 * the recipient's localized translator and then rendered the amount as
 * `zl18,812.71` inside Polish copy. The helpers are not wrong; the classification
 * of their callers was.
 *
 * So this guard holds two things: the classification (below), and the behaviour
 * of the resolver every addressed surface now goes through.
 */
const srcRoot = join(__dirname, "..");

const sourceFiles = (): string[] =>
  gitListFiles(srcRoot)
    .filter((file) => file.endsWith(".ts"))
    .filter((file) => !file.endsWith(".spec.ts"));

const read = (file: string): string =>
  readFileSync(join(srcRoot, file), "utf8");

/**
 * Callers of the deterministic `en-US` helpers, each with the reason its output
 * is NOT addressed to a person. Every one of these is a documented fixed-locale
 * contract; a new caller must earn its line here or use
 * `number-locale.util.ts` instead.
 */
const MACHINE_FORMAT_CALLERS: Record<string, string> = {
  "ai/forecast/ai-forecast.service.ts":
    "builds an LLM prompt: one stable representation, read by a model",
  "transactions/transactions.service.ts":
    "the English `description` fallback on an action-history row; the reader's client formats `amountValue`/`amountCurrency` instead",
  "transactions/transaction-transfer.service.ts":
    "same action-history English fallback, for the transfer pair",
  "budgets/budgets.service.ts":
    "the English `title`/`message` fallback on a bill notification; the UI composes its own copy from `type` + `data`",
};

/** Where the helpers themselves live. */
const HELPER_MODULE = "common/format-currency.util.ts";

describe("the en-US money helpers", () => {
  it("are imported only by callers whose output is not addressed to a person", () => {
    // Matched on the import's NAMED BINDINGS, not on the file mentioning the
    // word: `number-locale.util.ts` imports `getDecimalPlacesForCurrency` from
    // the same module and declares its own `formatCurrency` in an interface, so
    // a whole-file grep classified the replacement as an offender.
    const IMPORTS_THE_FORMATTERS =
      /import\s*\{([^}]*)\}\s*from\s*["'][^"']*format-currency\.util["']/;
    const importers = sourceFiles().filter((file) => {
      const named = IMPORTS_THE_FORMATTERS.exec(read(file))?.[1];
      return named !== undefined && /\bformatCurrency(Amount)?\b/.test(named);
    });
    // An empty subject set passes every assertion below, so prove it is not one.
    expect(importers.length).toBeGreaterThan(2);

    const unclassified = importers.filter(
      (file) => !(file in MACHINE_FORMAT_CALLERS),
    );
    expect(unclassified).toEqual([]);
  });

  it("keeps the classification list honest", () => {
    // A stale entry silently covers a future caller in the same file.
    const files = sourceFiles();
    for (const file of Object.keys(MACHINE_FORMAT_CALLERS)) {
      // A classified file that no longer exists, or no longer imports the
      // helpers, is a stale exemption -- it would silently cover a future
      // caller in the same path.
      expect(files).toContain(file);
      expect(read(file)).toMatch(
        /import\s*\{[^}]*\bformatCurrency(Amount)?\b[^}]*\}\s*from\s*["'][^"']*format-currency\.util["']/,
      );
    }
  });

  it("hold the only hardcoded en-US formatter in src/", () => {
    // `monthly-comparison.service.ts` built its own `new Intl.NumberFormat("en-US")`
    // for generated report notes, so the notes disagreed with the screen around
    // them. A second copy is how a classification silently stops covering
    // everything.
    const offenders = sourceFiles()
      .filter((file) => file !== HELPER_MODULE)
      .filter((file) =>
        /(?:Intl\.NumberFormat)\(\s*["']en-US["']/.test(read(file)),
      );
    expect(offenders).toEqual([]);
  });

  it("still hold that formatter, so the exemption is not vacuous", () => {
    expect(read(HELPER_MODULE)).toMatch(/Intl\.NumberFormat\(\s*["']en-US["']/);
  });
});

describe("resolveNumberLocale", () => {
  it("lets an explicit numberFormat win over the UI language", () => {
    // The whole point of the preference: German grouping with an English UI.
    expect(resolveNumberLocale("de-DE", "en")).toBe("de-DE");
    // And the reverse -- an explicit en-US is a choice, not a default.
    expect(resolveNumberLocale("en-US", "pl")).toBe("en-US");
  });

  it("falls back to the UI language when numberFormat is 'browser'", () => {
    expect(resolveNumberLocale("browser", "pl")).toBe("pl");
    expect(resolveNumberLocale("browser", "pt-BR")).toBe("pt-BR");
  });

  it("falls back to the default locale where nothing resolves", () => {
    // There is no browser on the server, so "follow the browser" and the
    // pseudo-locale both land on the documented default rather than on a guess.
    expect(resolveNumberLocale("browser", "browser")).toBe(DEFAULT_LOCALE);
    expect(resolveNumberLocale("browser", "xx")).toBe(DEFAULT_LOCALE);
    expect(resolveNumberLocale("browser", null)).toBe(DEFAULT_LOCALE);
    expect(resolveNumberLocale(null, undefined)).toBe(DEFAULT_LOCALE);
    // A user row that has never been written at all.
    expect(resolveNumberLocale(undefined, undefined)).toBe(DEFAULT_LOCALE);
  });
});

describe("numberFormatterFor", () => {
  /**
   * Asserted on the separators rather than on an exact string: ICU writes the
   * Polish group separator as a narrow no-break space (U+202F) in some versions
   * and a regular no-break space (U+00A0) in others, and pinning the byte makes
   * the suite fail on a Node upgrade with nothing wrong.
   */
  const groupsWithSpace = (formatted: string) => /\d[\s  ]\d/.test(formatted);

  it("renders Polish money with a comma decimal and a spaced group", () => {
    const n = numberFormatterFor("pl-PL", "en");
    const formatted = n.formatCurrency(18812.71, "PLN");
    expect(formatted).toContain("18");
    expect(formatted).toContain("812,71");
    expect(groupsWithSpace(formatted)).toBe(true);
    // The symbol trails in Polish; the screenshot in issue #1316 showed it
    // leading, as `zl18,812.71`.
    expect(formatted.trimEnd().endsWith("z\u0142")).toBe(true);
  });

  it("renders the same amount in en-US convention when that is the choice", () => {
    const n = numberFormatterFor("en-US", "pl");
    expect(n.formatCurrency(18812.71, "USD")).toBe("$18,812.71");
  });

  it("uses the currency's own decimal places", () => {
    const n = numberFormatterFor("en-US", "en");
    // JPY has none, BHD has three -- the property the en-US helper already had
    // and which must survive the move.
    expect(n.formatCurrency(1234.6, "JPY")).toBe("¥1,235");
    expect(n.formatCurrency(1234.5678, "BHD")).toContain("1,234.568");
  });

  it("rounds a money midpoint away from zero", () => {
    // 159.735 is held as 159.73499... in IEEE 754; without the pre-round it
    // formats as 159.73.
    expect(
      numberFormatterFor("en-US", "en").formatCurrency(159.735, "USD"),
    ).toBe("$159.74");
  });

  it("formats a percentage in the reader's convention", () => {
    expect(numberFormatterFor("pl-PL", "en").formatPercent(12.3, 1)).toContain(
      "12,3",
    );
    expect(numberFormatterFor("en-US", "en").formatPercent(12.3, 1)).toBe(
      "12.3%",
    );
  });

  it("formats a plain count in the reader's convention", () => {
    expect(
      groupsWithSpace(numberFormatterFor("pl-PL", "en").formatNumber(12345, 0)),
    ).toBe(true);
    expect(numberFormatterFor("en-US", "en").formatNumber(12345, 0)).toBe(
      "12,345",
    );
  });

  it("falls back to a locale-formatted number for an unknown currency code", () => {
    // An unknown code is a reason to lose the symbol, never a reason to fall
    // back to en-US -- that is the defect wearing a catch block.
    const n = numberFormatterFor("pl-PL", "en");
    expect(n.formatCurrency(1234.5, "NOTACURRENCY")).toContain("1234,50");
  });

  it("exposes a default-locale formatter for a caller with no recipient", () => {
    expect(defaultNumberT.locale).toBe(DEFAULT_LOCALE);
  });

  it("survives being destructured", () => {
    // Email templates and the budget-alert messages call through the bundle, but
    // nothing stops a caller pulling one formatter out -- and an object method
    // would then lose its `this` and crash inside a cron-composed email.
    const { formatCurrency, formatPercent, formatNumber } = numberFormatterFor(
      "pl-PL",
      "en",
    );
    expect(() => formatCurrency(1, "PLN")).not.toThrow();
    expect(() => formatCurrency(1, "NOTACURRENCY")).not.toThrow();
    expect(() => formatPercent(1)).not.toThrow();
    expect(() => formatNumber(1)).not.toThrow();
  });
});
