import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { InvestmentAction } from "./entities/investment-transaction.entity";
import { applyShareQuantity } from "./share-quantity.util";

describe("applyShareQuantity", () => {
  it.each([
    InvestmentAction.BUY,
    InvestmentAction.REINVEST,
    InvestmentAction.TRANSFER_IN,
    InvestmentAction.ADD_SHARES,
  ])("adds units for %s", (action) => {
    expect(applyShareQuantity(100, action, 10)).toBe(110);
  });

  it.each([
    InvestmentAction.SELL,
    InvestmentAction.TRANSFER_OUT,
    InvestmentAction.REMOVE_SHARES,
  ])("removes units for %s", (action) => {
    expect(applyShareQuantity(100, action, 10)).toBe(90);
  });

  // The whole point of the helper. Three parts of the codebase disagreed about
  // this one action: the net-worth history added the ratio (102 shares), the TWR
  // walk ignored it (100), and the holdings replays multiplied (200).
  it("multiplies by the ratio for a SPLIT", () => {
    expect(applyShareQuantity(100, InvestmentAction.SPLIT, 2)).toBe(200);
    expect(applyShareQuantity(100, InvestmentAction.SPLIT, 0.5)).toBe(50);
  });

  it("leaves the count alone for a SPLIT with no usable ratio", () => {
    expect(applyShareQuantity(100, InvestmentAction.SPLIT, 0)).toBe(100);
    expect(applyShareQuantity(100, InvestmentAction.SPLIT, -2)).toBe(100);
  });

  it.each([
    InvestmentAction.DIVIDEND,
    InvestmentAction.INTEREST,
    InvestmentAction.CAPITAL_GAIN,
  ])("leaves the count alone for cash-only %s", (action) => {
    expect(applyShareQuantity(100, action, 25)).toBe(100);
  });

  it("accepts the raw string action a raw SQL row carries", () => {
    // `getRawMany` rows come back with the enum as a plain string.
    expect(applyShareQuantity(100, "SPLIT", 3)).toBe(300);
    expect(applyShareQuantity(100, "BUY", 3)).toBe(103);
  });

  it("treats a null or unparseable quantity as zero units", () => {
    expect(applyShareQuantity(100, InvestmentAction.BUY, null as any)).toBe(
      100,
    );
    expect(applyShareQuantity(100, InvestmentAction.BUY, "x" as any)).toBe(100);
  });

  it("ignores an action it does not know rather than guessing", () => {
    expect(applyShareQuantity(100, "SOMETHING_NEW", 10)).toBe(100);
  });
});

/**
 * Prose said "quantity is a ratio" and three call sites did something else, so
 * the rule is checked instead.
 *
 * Every place that decides what an action does to a share count either calls
 * `applyShareQuantity` or is on this list with a reason. The listed files
 * interleave the quantity walk with a cost-basis walk in one switch and cannot
 * be expressed through the helper; they already agree with it. A new file
 * matching a SPLIT case has to be added here deliberately -- which is the moment
 * to check it agrees.
 */
const SPLIT_CASE_ALLOWLIST = new Map<string, string>([
  [
    "securities/share-quantity.util.ts",
    "the helper itself -- the single definition",
  ],
  [
    "securities/portfolio-calculation.service.ts",
    "cost-basis and lot replays: quantity and basis move together in one switch",
  ],
  [
    "investment-reports/investment-report-data.service.ts",
    "report replay: same interleaving of quantity and basis",
  ],
  [
    "securities/holdings.service.ts",
    "stored-holdings replay: quantity and average cost in one switch",
  ],
  [
    "securities/investment-transactions.service.ts",
    "per-action validation and reversal, not a running share count",
  ],
  [
    "action-history/action-history.service.ts",
    "renders an action's description; no share count involved",
  ],
]);

describe("share-quantity guard", () => {
  const srcRoot = join(__dirname, "..");

  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return walk(full);
      if (!full.endsWith(".ts") || full.endsWith(".spec.ts")) return [];
      return [full];
    });

  it("only decides what a SPLIT does to a share count in known places", () => {
    const offenders = walk(srcRoot)
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        return (
          source.includes("case InvestmentAction.SPLIT") ||
          source.includes('case "SPLIT"')
        );
      })
      .map((file) =>
        file
          .slice(srcRoot.length + 1)
          .split("\\")
          .join("/"),
      )
      .filter((relative) => !SPLIT_CASE_ALLOWLIST.has(relative));

    expect(offenders).toEqual([]);
  });

  it("keeps the allowlist honest -- every entry still exists and still matches", () => {
    const stale = [...SPLIT_CASE_ALLOWLIST.keys()].filter((relative) => {
      let source: string;
      try {
        source = readFileSync(join(srcRoot, relative), "utf8");
      } catch {
        return true;
      }
      return !(
        source.includes("case InvestmentAction.SPLIT") ||
        source.includes('case "SPLIT"') ||
        relative === "securities/share-quantity.util.ts"
      );
    });

    expect(stale).toEqual([]);
  });
});
