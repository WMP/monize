import { describe, it, expect } from "vitest";

/**
 * Guard tests for the UI conventions in `frontend/CLAUDE.md`.
 *
 * These exist because a documented rule is only as good as its enforcement. Each
 * one was added after an agent reached for the generic solution, a human spotted
 * it in the running app, and the fix landed in a single file. A test that scans
 * the whole source tree catches the next instance wherever it appears, which a
 * test around the one component that was fixed cannot.
 *
 * Add a case here whenever a *mechanical* mistake gets corrected -- a raw element
 * used where a shared component exists. Judgement calls (is this list long enough
 * to need paging?) stay in prose; only checkable rules belong here.
 *
 * Modelled on `src/lib/tours/anchors.uniqueness.test.ts`, which scans the tree the
 * same way for detached tour anchors.
 */
const sources = import.meta.glob("/src/**/*.{ts,tsx}", {
  query: "?raw",
  eager: true,
  import: "default",
}) as Record<string, string>;

/** Source files only: tests legitimately contain the markup they assert on. */
function productionSources(): [string, string][] {
  return Object.entries(sources).filter(
    ([path]) => !/\.test\.tsx?$/.test(path),
  );
}

describe("date entry goes through DateInput", () => {
  /** The one file allowed to hold a raw date input -- it *is* the wrapper. */
  const WRAPPER = "/src/components/ui/DateInput.tsx";
  const RAW_DATE_INPUT = /type=["']date["']/;

  it('has no raw <input type="date"> outside the shared component', () => {
    const offenders = productionSources()
      .filter(([path]) => path !== WRAPPER)
      .filter(([, content]) => RAW_DATE_INPUT.test(content))
      .map(([path]) => path);

    // A bare date input misses the locale-aware parsing and `CalendarPopover`,
    // and shows the browser's own calendar icon beside Monize's -- the
    // `.date-picker-hide` rule in globals.css exists to suppress exactly that.
    expect(offenders).toEqual([]);
  });

  it("still finds the wrapper, so the rule cannot pass by accident", () => {
    // Were DateInput renamed, or were it to stop using a native date input, the
    // check above would trivially pass over an empty set. This fails first and
    // says what to update.
    const wrapper = sources[WRAPPER];
    expect(
      wrapper,
      `${WRAPPER} not found -- update WRAPPER in this test`,
    ).toBeTruthy();
    expect(RAW_DATE_INPUT.test(wrapper)).toBe(true);
  });
});

describe('numeric entry goes through NumericInput or CurrencyInput', () => {
  /**
   * `type="number"` is not exclusive to inputs -- recharts' `<XAxis type="number">`
   * declares a continuous scale and appears in roughly twenty chart components.
   * So the check is not "does this file contain the string": it walks back from
   * each occurrence to the tag it belongs to and only complains about `input`
   * (the raw element) and `Input` (the shared text field). Anything else --
   * `XAxis`, `YAxis`, a future chart prop -- is left alone.
   */
  const TYPE_NUMBER = /type=["']number["']/g;

  /** The JSX tag an attribute at `index` belongs to, or null if unparseable. */
  function owningTag(content: string, index: number): string | null {
    const open = content.lastIndexOf('<', index);
    if (open === -1) return null;
    return /^<\s*([A-Za-z][\w.]*)/.exec(content.slice(open, index))?.[1] ?? null;
  }

  const NUMERIC_ENTRY_TAGS = new Set(['input', 'Input']);

  it('has no <input type="number"> anywhere in the source tree', () => {
    const offenders: string[] = [];
    for (const [path, content] of productionSources()) {
      for (const match of content.matchAll(TYPE_NUMBER)) {
        const tag = owningTag(content, match.index);
        if (tag && NUMERIC_ENTRY_TAGS.has(tag)) {
          offenders.push(`${path}: <${tag} type="number">`);
        }
      }
    }

    // A native number input adds spinner arrows, changes value on scroll wheel,
    // and hands the form a locale-dependent parse of what was typed. Money goes
    // through `CurrencyInput` (thousands separators, rounding to cents, the
    // inline calculator); every other number -- share counts, rates, day-of-month,
    // retention counts -- through `NumericInput` with `decimalPlaces`.
    expect(offenders).toEqual([]);
  });

  it('still resolves the tag an attribute belongs to', () => {
    // Were `owningTag` to start returning null -- a bad edit, a JSX form it
    // cannot walk -- the check above would pass over an empty set. Assert both
    // halves: the raw input is caught, the recharts axis is not.
    const sample = [
      '<input type="number" min={0} />',
      '<XAxis dataKey="t" type="number" scale="time" />',
    ].join('\n');
    const tags = [...sample.matchAll(TYPE_NUMBER)].map((m) => owningTag(sample, m.index));
    expect(tags).toEqual(['input', 'XAxis']);
  });
});

describe("a scrollbar you need is not hidden", () => {
  /**
   * `scrollbar-hide` is for a horizontal strip of chips, where the content being
   * cut off is itself the signal that there is more. On a vertical list it hides
   * the only indication that rows exist below the fold, which is strictly worse
   * than the plain bar someone was trying to get rid of. The fix for an ugly bar
   * is `scrollbar-slim`, not no bar.
   *
   * Matched per class attribute rather than per file, so an unrelated
   * `scrollbar-hide` elsewhere in the same component does not trip it.
   */
  const CLASS_ATTR = /class(?:Name)?=(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})/g;

  it("never puts scrollbar-hide on a vertically scrolling element", () => {
    const offenders: string[] = [];
    for (const [path, content] of productionSources()) {
      for (const match of content.matchAll(CLASS_ATTR)) {
        const classes = match[1] ?? match[2] ?? match[3] ?? "";
        if (
          classes.includes("scrollbar-hide") &&
          /\boverflow-y-(auto|scroll)\b/.test(classes)
        ) {
          offenders.push(`${path}: ${classes.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("chart colours come from the theme tokens", () => {
  /**
   * `src/lib/chart-colors.ts` exposes `var(--chart-*)` strings so a chart
   * follows the active colour theme and light/dark mode with no JS. A literal
   * `fill="#22c55e"` looks correct on the default palette and then stays that
   * exact green on all twenty-odd themes -- the charts were the last thing on
   * screen still doing it.
   *
   * Matched per colour prop rather than per file, because the same components
   * legitimately hold hex for the PDF export: `pdf-export.ts` parses
   * `summaryCards[].color` as hex, and a `var(...)` there produces NaN. Those
   * are `color:` keys and never reach a chart.
   *
   * The value is captured whole (`{...}`, `"..."`, `'...'`) so a conditional
   * like `fill={up ? '#16a34a' : '#dc2626'}` is caught too, not just the
   * literal-valued form.
   */
  const COLOUR_PROP =
    /\b(fill|stroke|stopColor)\s*[=:]\s*(\{[^{}]*\}|"[^"]*"|'[^']*')/g;
  const HEX = /#[0-9a-fA-F]{3,8}\b/;

  /**
   * Drawn on top of a filled flag bubble rather than on the card, so these are
   * contrast against the fill -- white is the point. `chartColors.surface`
   * would make them the card colour and so invisible on the bubble in dark
   * mode. The only exemption; anything new needs its own reason here.
   */
  const ON_FILL_WHITE = "/src/components/investments/portfolio-chart-utils.tsx";

  it("never hardcodes a hex colour on a chart fill or stroke", () => {
    const offenders: string[] = [];
    for (const [path, content] of productionSources()) {
      if (!/from ['"]recharts['"]/.test(content)) continue;
      for (const match of content.matchAll(COLOUR_PROP)) {
        if (!HEX.test(match[2])) continue;
        // The bubble text/divider/cross, and nothing else in that file.
        if (path === ON_FILL_WHITE && /#fff\b/.test(match[2])) continue;
        offenders.push(`${path}: ${match[0].trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("still matches the colour props it is meant to police", () => {
    // Were the regex to stop matching -- a Recharts rename, a bad edit -- the
    // check above would pass over an empty set. This fails first and says so.
    const sample = `fill="#22c55e" stroke={up ? '#16a34a' : '#dc2626'}`;
    const hits = [...sample.matchAll(COLOUR_PROP)].filter((m) =>
      HEX.test(m[2]),
    );
    expect(hits).toHaveLength(2);
  });
});

describe('a control sitting beside an input is the height of that input', () => {
  /**
   * `CurrencyPickerButton` is the square button left of an Amount field. It has
   * no vertical padding and no height of its own, so its height comes entirely
   * from the flex row. That made it a two-part rule that was easy to half-apply:
   * the button needs `self-stretch`, and the row it sits in needs
   * `items-stretch` with a `min-w-0` sibling. Getting either wrong renders a
   * squat button beside a full-height input, which is what a human had to point
   * out on the Bills & Deposits form.
   *
   * Both halves are checked: `self-stretch` on the button makes it correct
   * whatever the wrapper does, and the row check keeps the two existing call
   * sites (and any new one) on the same layout.
   */
  const BUTTON = '/src/components/transactions/CurrencyPickerButton.tsx';

  it('gives CurrencyPickerButton self-stretch, so any wrapper renders it full height', () => {
    const source = sources[BUTTON];
    expect(source, `${BUTTON} not found -- update BUTTON in this test`).toBeTruthy();
    // Guard against the class being dropped in a future restyle: align-self
    // beats the parent's align-items, so this is what makes the button
    // independent of how it is laid out.
    expect(source).toMatch(/className="[^"]*\bself-stretch\b/);
  });

  it('renders the picker only inside an items-stretch row', () => {
    const ROW = /<div className="flex items-stretch space-x-2">/;
    // Building the picker and handing it down as `currencyPickerSlot={...}` is
    // not laying it out -- TransactionForm does exactly that, and the row lives
    // in NormalTransactionFields / SplitTransactionFields, which receive it. So
    // a file that passes the slot on is a producer, and the check applies to
    // whoever actually renders it beside an input.
    const HANDS_OFF = /currencyPickerSlot=\{/;
    const offenders = productionSources()
      .filter(([path]) => path !== BUTTON)
      .filter(
        ([, content]) =>
          /<CurrencyPickerButton\b/.test(content) || /\{currencyPickerSlot\}/.test(content),
      )
      .filter(([, content]) => !HANDS_OFF.test(content))
      .filter(([, content]) => !ROW.test(content))
      .map(([path]) => path);

    // `items-start` (or the default `stretch` being overridden) leaves the
    // button at its content height. Use the same row the other call sites do.
    expect(offenders).toEqual([]);
  });
});

describe('the GEM report links through its shared wrappers', () => {
  /**
   * Every account and instrument the report names is a way into that account
   * or instrument, and they all have to look the same doing it. A hand-rolled
   * `<Link>` in one card gets its own colour and its own hover, which is how
   * the report ended up with permanently blue anchors in one tab and plain
   * text everywhere else. `GemSecurityLink` / `GemAccountLink` in
   * `GemPrimitives.tsx` are the only place that markup lives.
   */
  const WRAPPERS = "/src/components/strategies/GemPrimitives.tsx";

  it("has no ad-hoc security or account link in a strategy component", () => {
    const offenders = productionSources()
      .filter(
        ([path]) =>
          path.startsWith("/src/components/strategies/") && path !== WRAPPERS,
      )
      .filter(([, source]) => /href={`\/(securities|accounts)\//.test(source))
      .map(([path]) => path);

    expect(offenders).toEqual([]);
  });
});

describe("a tab bar is the shared Tabs component", () => {
  /**
   * `ui/Tabs.tsx` is the only tablist in the app. It carries the roving
   * tabindex, the arrow/Home/End keys, the horizontal scroll and the `pb-px`
   * that keeps a stray vertical scrollbar off the row, plus the id convention
   * (`tabId`/`tabPanelId`) a panel points back at.
   *
   * The rule is a scan because a second tablist is never wrong on its own file's
   * terms -- it simply re-derives all of that, and drops some of it. The GEM
   * report's hand-rolled bar set `aria-controls` on all five tabs while only the
   * selected tab's panel is rendered, so four of them named an element that was
   * not in the document. `Tabs.tsx` sets the attribute for the selected tab
   * only, with a comment saying why; that is the fix a call site inherits by
   * using it.
   */
  const SHARED = "/src/components/ui/Tabs.tsx";
  const TABLIST = /role=["']tablist["']/;

  it("declares role=tablist in exactly one place", () => {
    const offenders = productionSources()
      .filter(([path]) => path !== SHARED)
      .filter(([, source]) => TABLIST.test(source))
      .map(([path]) => path);

    expect(offenders).toEqual([]);
  });

  it("still finds the shared tablist, so the rule cannot pass by accident", () => {
    const shared = sources[SHARED];
    expect(
      shared,
      `${SHARED} not found -- update SHARED in this test`,
    ).toBeTruthy();
    expect(TABLIST.test(shared)).toBe(true);
  });
});

describe("nothing interactive is nested inside a button", () => {
  /**
   * `<button>`'s content model forbids interactive descendants, and the
   * failure is not cosmetic: the parser closes the outer button at the inner
   * tag, so the click target is truncated to whatever preceded it and the
   * server's markup no longer matches what React builds on the client.
   *
   * This landed the moment `InfoTooltip`'s trigger changed from a `<span>` to
   * a `<button>` -- correct in isolation, and it broke the one card that had
   * put a tooltip inside a clickable card. That is the shape of mistake a
   * scan catches and a component test cannot: neither file is wrong on its
   * own, only the pair is, and the pair is discovered by grepping.
   *
   * Fix it at the call site by making the two siblings, not by demoting the
   * inner control to a non-focusable element -- a tab stop that announces
   * nothing is how `InfoTooltip` got here in the first place.
   */
  const INTERACTIVE = /<(button|a|select|textarea|input|InfoTooltip)[\s/>]/g;

  /**
   * Blank out comment bodies, keeping the file's length and line breaks so
   * reported line numbers still point at the source. Prose in this repo
   * discusses `<button>` constantly, and a scan that reads its own
   * explanation as a violation is worse than no scan.
   */
  function withoutComments(source: string): string {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "))
      .replace(
        /(^|[^:])\/\/[^\n]*/g,
        (match, before: string) =>
          before + " ".repeat(match.length - before.length),
      );
  }

  /** [start, end) of every non-self-closing `<button>` element's children. */
  function buttonBodies(source: string): Array<[number, number]> {
    const bodies: Array<[number, number]> = [];
    const opens = /<button(?=[\s/>])/g;
    let open: RegExpExecArray | null;
    while ((open = opens.exec(source))) {
      const tagEnd = source.indexOf(">", open.index);
      if (tagEnd === -1) continue;
      // `<button ... />` has no children to search.
      if (source[tagEnd - 1] === "/") continue;
      let depth = 1;
      let cursor = tagEnd + 1;
      while (depth > 0) {
        const close = source.indexOf("</button>", cursor);
        if (close === -1) break;
        const nested = source.slice(cursor).search(/<button(?=[\s/>])/);
        const nestedAt = nested === -1 ? Infinity : cursor + nested;
        if (nestedAt < close) {
          const nestedEnd = source.indexOf(">", nestedAt);
          if (source[nestedEnd - 1] !== "/") depth += 1;
          cursor = nestedEnd + 1;
          continue;
        }
        depth -= 1;
        cursor = close + "</button>".length;
        if (depth === 0) bodies.push([tagEnd + 1, close]);
      }
    }
    return bodies;
  }

  it("puts no control, link or tooltip inside a <button>", () => {
    const offenders: string[] = [];
    for (const [path, raw] of productionSources()) {
      if (!path.endsWith(".tsx")) continue;
      const source = withoutComments(raw);
      for (const [start, end] of buttonBodies(source)) {
        const body = source.slice(start, end);
        INTERACTIVE.lastIndex = 0;
        let hit: RegExpExecArray | null;
        while ((hit = INTERACTIVE.exec(body))) {
          const line = source.slice(0, start + hit.index).split("\n").length;
          offenders.push(`${path}:${line} nests <${hit[1]}> in a <button>`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("still recognises a nested control, so the rule cannot pass by accident", () => {
    // The scanner skips self-closing buttons and blanks out comments, and
    // both of those could silently grow into "skips everything". This is the
    // markup the guard exists for.
    const sample = `
      {/* a <button> inside a comment is not a violation */}
      <button type="button" />
      <button onClick={go}>
        <span>Account</span>
        <InfoTooltip text={help} />
      </button>
    `;
    const bodies = buttonBodies(withoutComments(sample));
    expect(bodies).toHaveLength(1);
    const body = sample.slice(bodies[0][0], bodies[0][1]);
    expect(/<InfoTooltip[\s/>]/.test(body)).toBe(true);
  });
});

describe("a stored money amount is edited at storage precision", () => {
  /**
   * `CurrencyInput` defaults to 2 decimal places, and money is stored as
   * `decimal(20,4)`. A field bound to a stored amount that takes the default
   * shows 10.0048 as 10.0000 and saves that back on any unrelated edit -- the
   * loss is silent, and the split children beside it are already validated at
   * 4 dp, so the same untouched record can also be rejected as unbalanced.
   *
   * Every amount field bound to a persisted transaction/schedule amount passes
   * `decimalPlaces`, normally `moneyFractionDigits([...])` so ordinary values
   * still read as cents. This scans for the shape rather than the value: a
   * `CurrencyInput` whose `value=` mentions an amount must also mention
   * `decimalPlaces`.
   */
  const AMOUNT_BOUND_FILES = [
    "/src/components/transactions/NormalTransactionFields.tsx",
    "/src/components/transactions/SplitTransactionFields.tsx",
    "/src/components/scheduled-transactions/ScheduledTransactionForm.tsx",
    "/src/components/scheduled-transactions/OverrideEditorDialog.tsx",
  ];

  const currencyInputs = (content: string): string[] =>
    content.match(/<CurrencyInput[\s\S]*?\/>/g) ?? [];

  it("passes decimalPlaces on every amount-bound CurrencyInput", () => {
    const offenders: string[] = [];

    for (const path of AMOUNT_BOUND_FILES) {
      const content = sources[path];
      expect(content, `${path} is missing -- update this list`).toBeDefined();
      for (const element of currencyInputs(content)) {
        const bindsAnAmount = /value=\{[^}]*[Aa]mount/.test(element);
        if (!bindsAnAmount) continue;
        if (element.includes("decimalPlaces")) continue;
        offenders.push(`${path}: ${element.split("\n")[1]?.trim() ?? element}`);
      }
    }

    // Add `decimalPlaces={moneyFractionDigits([<the value>])}`.
    expect(offenders).toEqual([]);
  });

  it("still finds the amount fields it is meant to police", () => {
    // A renamed prop or a switch to another input would leave the check above
    // passing over an empty set.
    const bound = AMOUNT_BOUND_FILES.flatMap((path) =>
      currencyInputs(sources[path] ?? "").filter((element) =>
        /value=\{[^}]*[Aa]mount/.test(element),
      ),
    );
    expect(bound.length).toBeGreaterThanOrEqual(4);
  });
});

describe("a money helper is never re-implemented in a mock", () => {
  /**
   * `vi.mock('@/lib/format', ...)` must go through `importOriginal`.
   *
   * A hand-written replacement for a money helper is fiction that passes: four
   * of these rounded at cents (`Math.round(v * 100) / 100`) or formatted with a
   * bare `toLocaleString()`, so every 4 dp assertion in those specs held over
   * code that was losing 0.0048, and one file's expectations had been written
   * against the mock's output rather than the component's. Stub the
   * presentational bits on top of the real module; never re-derive the maths.
   */
  const FORMAT_MOCK = /vi\.mock\(\s*['"]@\/lib\/format['"]\s*,\s*([^)]*)/;

  it("has no @/lib/format mock that replaces the module wholesale", () => {
    const offenders = Object.entries(sources)
      .filter(([path]) => /\.test\.tsx?$/.test(path))
      .filter(([, content]) => {
        const match = FORMAT_MOCK.exec(content);
        // `importOriginal` or an explicit `vi.importActual` both build on the real
        // module; only a wholesale replacement is the problem.
        return (
          match !== null &&
          !match[1].includes("importOriginal") &&
          !content.includes("vi.importActual<typeof import('@/lib/format')>")
        );
      })
      .map(([path]) => path);

    // Use:
    //   vi.mock('@/lib/format', async (importOriginal) => {
    //     const actual = await importOriginal<typeof import('@/lib/format')>();
    //     return { ...actual, getCurrencySymbol: () => '$' };
    //   });
    expect(offenders).toEqual([]);
  });

  it("still finds the format mocks it is meant to police", () => {
    const mocks = Object.entries(sources).filter(
      ([path, content]) =>
        /\.test\.tsx?$/.test(path) && FORMAT_MOCK.test(content),
    );
    expect(mocks.length).toBeGreaterThanOrEqual(5);
  });
});
