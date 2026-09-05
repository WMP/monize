import { describe, it, expect } from 'vitest';

/**
 * Guard for issue #1316: the configured number locale is the single source of
 * truth for every figure addressed to a user, the way `useDateFormat()` is for
 * dates.
 *
 * Monize has had a preference-aware formatter (`useNumberFormat()`) and a
 * preference-blind one (`@/lib/format`) side by side for a long time, and the
 * second is the one a component reaches for when the first needs a hook. So a
 * Polish user with `numberFormat: 'pl-PL'` read `zl18,812.71` on the Securities
 * page and `18 812,71 zl` on the page beside it.
 *
 * Four fingerprints reproduce every instance that was found:
 *
 *   1. a React/UI file importing the raw `formatCurrency` / `formatShareQuantity`;
 *   2. a numeric `toLocaleString()`, which follows the BROWSER -- and an explicit
 *      `numberFormat` exists precisely to override the browser, so swapping a
 *      hardcoded `en-US` for a bare `toLocaleString()` is not a fix;
 *   3. `toFixed(n)` concatenated with a literal `%`, which is a `.` decimal in
 *      every locale and puts the `%` where English puts it;
 *   4. a hardcoded `en-US` `Intl.NumberFormat` in runtime code.
 *
 * Each allowlist entry below is a classified fixed-locale contract, not a
 * grandfathered offender. Prefer shrinking it to widening a pattern.
 */
const sources = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  eager: true,
  import: 'default',
}) as Record<string, string>;

/** Source files only: a test may legitimately spell the pattern it asserts on. */
function productionSources(): [string, string][] {
  return Object.entries(sources).filter(
    ([path]) => !/\.test\.tsx?$/.test(path),
  );
}

/**
 * Blank out comment bodies, keeping line breaks so reported line numbers still
 * point at the source. The prose above and in `useNumberFormat.ts` has to NAME
 * `toLocaleString()` and `toFixed` to explain why they are banned, and a scan
 * that reads its own explanation as a violation is worse than no scan -- the
 * cheap way out of it is a weaker comment. Same technique as
 * `lib/loan-history.guard.test.ts`.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
    .replace(
      /(^|[^:])\/\/[^\n]*/g,
      (match, before: string) =>
        before + ' '.repeat(match.length - before.length),
    );
}

/** 1-indexed line number of a character offset, for an offender report. */
function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

describe('the comment stripper', () => {
  it('blanks a comment while preserving line numbers', () => {
    const stripped = withoutComments('const a = 1;\n// toFixed(1)}%\nconst b = 2;');
    expect(stripped).not.toContain('toFixed');
    expect(stripped.split('\n')).toHaveLength(3);
  });

  it('leaves code alone, so a real offender is still found', () => {
    const stripped = withoutComments("const a = `${x.toFixed(1)}%`;");
    expect(stripped).toContain('toFixed(1)}%');
  });

  it('does not mistake a URL for a comment', () => {
    expect(withoutComments("const u = 'https://x.test/a';")).toContain('//x.test');
  });
});

describe('user-facing money and share counts go through useNumberFormat', () => {
  /**
   * `@/lib/format` keeps `formatCurrency` and `formatShareQuantity` as pure
   * deterministic helpers -- they are fine in a non-React, non-user-facing
   * context. What must not happen is a component rendering through them: that is
   * the `en-US` the user's preference was supposed to override.
   */
  const RAW_CURRENCY_IMPORT =
    /import\s*\{[^}]*\b(formatCurrency|formatShareQuantity)\b[^}]*\}\s*from\s*['"]@\/lib\/format['"]/;

  const UI_FILE = /^\/src\/(components|app|hooks)\//;

  it('has no UI file importing the raw currency or share helper', () => {
    const offenders = productionSources()
      .filter(([path]) => UI_FILE.test(path))
      .filter(([, content]) => RAW_CURRENCY_IMPORT.test(withoutComments(content)))
      .map(([path]) => path);

    expect(offenders).toEqual([]);
  });

  it('still finds the helpers, so the rule cannot pass by accident', () => {
    // Were either renamed or moved, the check above would trivially pass over an
    // empty set. This fails first and says what to update.
    const format = sources['/src/lib/format.ts'];
    expect(format, '/src/lib/format.ts not found -- update this guard').toBeTruthy();
    expect(format).toContain('export function formatCurrency');
    expect(format).toContain('export function formatShareQuantity');
  });

  it('offers a locale-aware share formatter to migrate to', () => {
    // The migration target. Without it the rule above has no answer for a
    // holdings column, and the honest response would be to allowlist it.
    const hook = sources['/src/hooks/useNumberFormat.ts'];
    expect(hook).toContain('const formatShareQuantity = useCallback');
    expect(hook).toContain('SHARE_QUANTITY_MAX_FRACTION_DIGITS');
  });
});

describe('a number is not formatted through the browser locale', () => {
  /**
   * `toLocaleString()` on a Date is a date, which `useDateFormat()` governs and
   * this guard does not. Everything else reaching for it is a number following
   * the browser instead of the user's `numberFormat`.
   */
  const TO_LOCALE_STRING = /\.toLocaleString\(/g;

  /** The receiver expression a `.toLocaleString(` call is made on. */
  function receiverBefore(source: string, index: number): string {
    const lineStart = source.lastIndexOf('\n', index) + 1;
    return source.slice(lineStart, index);
  }

  /**
   * Files with a classified non-numeric `toLocaleString`, each with its reason.
   * A `new Date(...)` receiver needs no entry -- it is self-evidently a date.
   */
  const ALLOWLIST: Record<string, string> = {
    '/src/components/budgets/BudgetWizard.tsx':
      "a month name for the default budget NAME (`now.toLocaleString('default', { month: 'long' })`), not a figure",
    '/src/lib/utils.ts':
      "machine-shaped wall-clock timestamps in a fixed 'sv-SE' (ISO-like) form for timezone arithmetic; never displayed",
  };

  it('has no numeric toLocaleString outside the classified set', () => {
    const offenders: string[] = [];
    for (const [path, raw] of productionSources()) {
      if (path in ALLOWLIST) continue;
      const content = withoutComments(raw);
      for (const match of content.matchAll(TO_LOCALE_STRING)) {
        const receiver = receiverBefore(content, match.index);
        if (/\bDate\b/.test(receiver)) continue;
        offenders.push(`${path}:${lineOf(content, match.index)}`);
      }
    }

    // Use `useNumberFormat().formatNumber(value, 0)` for a count, `formatPercent`
    // for a percentage, `formatCurrency` for money. A bare `toLocaleString()`
    // renders `12,345` for a Polish user whose preference asks for `12 345`,
    // because it reads the browser and not the preference.
    expect(offenders).toEqual([]);
  });

  it('keeps every allowlisted file honest', () => {
    // An entry that no longer names a real file, or a file that no longer holds
    // the pattern, is a stale exemption -- it would silently cover a future
    // offender in the same file.
    for (const path of Object.keys(ALLOWLIST)) {
      expect(sources[path], `${path} is allowlisted but does not exist`).toBeTruthy();
      expect(
        withoutComments(sources[path]),
        `${path} no longer calls toLocaleString -- delete its allowlist entry`,
      ).toContain('.toLocaleString(');
    }
  });
});

describe('a percentage is not built with toFixed and a literal %', () => {
  /** Both shapes that were found: `${x.toFixed(1)}%` and `x.toFixed(1) + '%'`. */
  const TOFIXED_PERCENT = /\.toFixed\(\s*\d+\s*\)\s*(?:\}%|\+\s*['"]%['"])/g;

  it('has none in the source tree', () => {
    const offenders: string[] = [];
    for (const [path, raw] of productionSources()) {
      const content = withoutComments(raw);
      for (const match of content.matchAll(TOFIXED_PERCENT)) {
        offenders.push(`${path}:${lineOf(content, match.index)}`);
      }
    }

    // `toFixed` writes a `.` decimal in every locale and the literal `%` lands
    // where English puts it (fr-FR writes "12,3 %"). Use
    // `useNumberFormat().formatPercent(value, decimals)` -- it takes percentage
    // units -- or `formatSignedPercent` where an explicit leading sign is wanted.
    expect(offenders).toEqual([]);
  });
});

describe('en-US is not hardcoded in a formatter', () => {
  const HARDCODED_EN_US =
    /(?:Intl\.NumberFormat|toLocaleString)\(\s*['"]en-US['"]/g;

  /** The one module whose documented contract IS a fixed deterministic locale. */
  const DETERMINISTIC_HELPERS = '/src/lib/format.ts';

  /**
   * Files whose fixed `en-US` is a classified contract rather than a defect.
   * `productionSources()` filters out `*.test.ts` but not a test HELPER, and
   * this one is deliberately deterministic -- it stands in for the hook so a
   * component test's output does not move with the runner's locale.
   */
  const ALLOWLIST = new Set([
    DETERMINISTIC_HELPERS,
    '/src/test/number-format-mock.ts',
  ]);

  it('appears only in the deterministic helper module', () => {
    const offenders: string[] = [];
    for (const [path, raw] of productionSources()) {
      if (ALLOWLIST.has(path)) continue;
      const content = withoutComments(raw);
      for (const match of content.matchAll(HARDCODED_EN_US)) {
        offenders.push(`${path}:${lineOf(content, match.index)}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('still finds the helper module, so the exemption is not vacuous', () => {
    expect(
      HARDCODED_EN_US.test(withoutComments(sources[DETERMINISTIC_HELPERS])),
    ).toBe(true);
  });
});
