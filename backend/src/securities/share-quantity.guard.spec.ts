import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

/**
 * Source scan: share-quantity arithmetic belongs to `share-quantity.util.ts`.
 *
 * `net-worth.service` spelled the action switch out three times and added a
 * split's ratio instead of multiplying by it in all three, while
 * `holdings.service` had it right -- so the holdings page and the historical
 * chart disagreed about the same history, and a 2-for-1 on 90 shares produced
 * 92 instead of 180. A fourth copy in the TWR replay treated a split as no
 * change at all, leaving the share count pre-split while prices went post-split.
 *
 * Neither file was wrong on its own, which is exactly the kind of defect only a
 * scan can hold: the mistake is that the decision exists in more than one place.
 * Two of the copies also carried comments claiming they "mirrored" the holdings
 * fold -- a mirror maintained by comment is what drifts.
 *
 * So this test fails on any *new* multiplication or division keyed on a split,
 * and on any new hand-rolled set of "actions that move shares", outside the one
 * function. The rule is in `CLAUDE.md` too, but prose gets read, agreed with and
 * violated anyway; a failing test is what makes the next agent inherit the
 * correction.
 */

const SRC = join(__dirname, "..");
const HELPER = join(SRC, "securities", "share-quantity.util.ts");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (!name.endsWith(".ts")) continue;
    if (name.endsWith(".spec.ts")) continue;
    if (full === HELPER) continue;
    out.push(full);
  }
  return out;
}

/**
 * Quantity arithmetic, as it appears under a SPLIT label. Both the scan and its
 * positive controls use these, so a control cannot pass against a pattern the
 * scan does not actually apply.
 */
const MULTIPLICATIVE = /[*/]=|=\s*[\w.()]+\s*[*/]\s*[\w.()]+/;
// Addition/subtraction of a quantity. Whitespace around the operator is
// required so `1e-8` and negative literals do not match, and the operands may be
// parenthesised because the original defect added inside a call argument:
// `holdings.set(id, (holdings.get(id) || 0) + qty)` -- there is no `=` to anchor on.
const ADDITIVE = /\+=|-=|[\w)]\s+\+\s+[\w(]|[\w)]\s+-\s+[\w(]/;

/** Lines within `radius` lines after a SPLIT case label, joined for matching. */
function splitBranchWindows(source: string, radius = 6): string[] {
  const lines = source.split("\n");
  const windows: string[] = [];
  lines.forEach((line, index) => {
    if (/case\s+(InvestmentAction\.SPLIT|["']SPLIT["'])\s*:/.test(line)) {
      windows.push(lines.slice(index, index + radius).join("\n"));
    }
  });
  return windows;
}

describe("share-quantity arithmetic lives in one place", () => {
  const files = sourceFiles(SRC);

  it("finds source files to scan", () => {
    // A scan over nothing passes for the wrong reason.
    expect(files.length).toBeGreaterThan(100);
  });

  it("no SPLIT branch outside the helper multiplies or divides a quantity", () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const window of splitBranchWindows(readFileSync(file, "utf-8"))) {
        if (MULTIPLICATIVE.test(window)) {
          offenders.push(`${file.replace(SRC, "src")}:\n${window}`);
        }
      }
    }
    // A split's quantity is a ratio, and how to apply it is decided once, in
    // src/securities/share-quantity.util.ts (applyShareAction). Call it instead
    // of writing the arithmetic here -- the copies that drifted apart were each
    // individually plausible. Jest prints the offending windows in the diff.
    expect(offenders.join("\n\n")).toBe("");
  });

  it("no SPLIT branch outside the helper adds or subtracts a quantity", () => {
    // The original defect in its exact form: `holdings.set(id, current + qty)`
    // under a SPLIT label.
    const offenders: string[] = [];
    for (const file of files) {
      for (const window of splitBranchWindows(readFileSync(file, "utf-8"))) {
        if (ADDITIVE.test(window)) {
          offenders.push(`${file.replace(SRC, "src")}:\n${window}`);
        }
      }
    }
    // A split multiplies; adding its quantity is the defect this guard exists
    // for. Use applyShareAction.
    expect(offenders.join("\n\n")).toBe("");
  });

  // A third check -- "no file hand-rolls a set of share-moving actions" -- was
  // written and removed. `movesShares` is the predicate, but action *lists*
  // legitimately appear for other reasons: AI tool input schemas, DTO validation
  // allowlists, UI label maps. The scan could not tell those from a duplicated
  // fold, and a guard with false positives is a guard someone deletes. The two
  // arithmetic checks above are precise, because arithmetic under a SPLIT label
  // has exactly one correct home.

  it("the guard would catch the original defect", () => {
    // Positive control: the scan is only worth having if it fires on the real
    // shape of the bug. This is the exact line net-worth.service carried.
    const defect = [
      "switch (tx.action) {",
      '  case "SPLIT":',
      "    acctHoldings.set(secId, (acctHoldings.get(secId) || 0) + qty);",
      "    break;",
      "}",
    ].join("\n");
    const windows = splitBranchWindows(defect);
    expect(windows.length).toBe(1);
    expect(ADDITIVE.test(windows[0])).toBe(true);
  });

  it("the guard would catch a multiplying copy too", () => {
    const copy = [
      "case InvestmentAction.SPLIT: {",
      "  const splitRatio = quantity || 1;",
      "  if (splitRatio > 0) state.quantity *= splitRatio;",
      "  break;",
      "}",
    ].join("\n");
    const windows = splitBranchWindows(copy);
    expect(windows.length).toBe(1);
    expect(MULTIPLICATIVE.test(windows[0])).toBe(true);
  });
});
