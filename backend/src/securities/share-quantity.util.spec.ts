import { applyShareAction, movesShares } from "./share-quantity.util";
import { InvestmentAction } from "./entities/investment-transaction.entity";

describe("applyShareAction", () => {
  describe("SPLIT is a ratio, not a share count", () => {
    // The numbers here are the ones from the audit that distinguish the two
    // readings: 90 shares with a stored quantity of 2.0 is 180 under ratio
    // semantics and 92 under additive semantics. A fixture using 90/90 -> 180
    // cannot tell the two apart, which is how the additive bug survived.
    it("multiplies on a 2-for-1 split", () => {
      expect(applyShareAction(90, InvestmentAction.SPLIT, 2)).toBe(180);
    });

    it("does not add the ratio to the share count", () => {
      expect(applyShareAction(90, InvestmentAction.SPLIT, 2)).not.toBe(92);
    });

    it("halves on a 1-for-2 reverse split", () => {
      expect(applyShareAction(90, InvestmentAction.SPLIT, 0.5)).toBe(45);
    });

    it("composes sequential splits multiplicatively", () => {
      const afterForward = applyShareAction(90, InvestmentAction.SPLIT, 2);
      expect(applyShareAction(afterForward, InvestmentAction.SPLIT, 0.25)).toBe(
        45,
      );
    });

    it("treats a literal 90 as a ratio, yielding 8100", () => {
      // Proves the fixture cannot be read additively: additive would give 180.
      expect(applyShareAction(90, InvestmentAction.SPLIT, 90)).toBe(8100);
    });

    it("ignores a zero ratio rather than destroying the position", () => {
      expect(applyShareAction(90, InvestmentAction.SPLIT, 0)).toBe(90);
    });

    it("ignores a negative ratio", () => {
      expect(applyShareAction(90, InvestmentAction.SPLIT, -2)).toBe(90);
    });
  });

  describe("additive actions", () => {
    it.each([
      InvestmentAction.BUY,
      InvestmentAction.REINVEST,
      InvestmentAction.TRANSFER_IN,
      InvestmentAction.ADD_SHARES,
    ])("%s adds shares", (action) => {
      expect(applyShareAction(10, action, 5)).toBe(15);
    });
  });

  describe("subtractive actions", () => {
    it.each([
      InvestmentAction.SELL,
      InvestmentAction.TRANSFER_OUT,
      InvestmentAction.REMOVE_SHARES,
    ])("%s removes shares", (action) => {
      expect(applyShareAction(10, action, 4)).toBe(6);
    });
  });

  describe("cash-only actions", () => {
    it.each([
      InvestmentAction.DIVIDEND,
      InvestmentAction.INTEREST,
      InvestmentAction.CAPITAL_GAIN,
    ])("%s leaves the share count untouched", (action) => {
      expect(applyShareAction(10, action, 99)).toBe(10);
    });
  });

  it("covers every action in the enum", () => {
    // A new action added to the enum without a decision here would silently
    // fall through to "does not move shares", which is a guess, not a rule.
    const handled = new Set<string>([
      InvestmentAction.BUY,
      InvestmentAction.SELL,
      InvestmentAction.DIVIDEND,
      InvestmentAction.INTEREST,
      InvestmentAction.CAPITAL_GAIN,
      InvestmentAction.SPLIT,
      InvestmentAction.TRANSFER_IN,
      InvestmentAction.TRANSFER_OUT,
      InvestmentAction.REINVEST,
      InvestmentAction.ADD_SHARES,
      InvestmentAction.REMOVE_SHARES,
    ]);
    expect(new Set(Object.values(InvestmentAction))).toEqual(handled);
  });

  it("accepts the raw action strings a raw SQL row carries", () => {
    // net-worth replays read `tx.action` off a raw row, so the helper has to
    // work on the string as well as the enum member.
    expect(applyShareAction(90, "SPLIT", 2)).toBe(180);
    expect(applyShareAction(10, "ADD_SHARES", 5)).toBe(15);
  });
});

describe("movesShares", () => {
  it("is true for every quantity-changing action", () => {
    for (const action of [
      InvestmentAction.BUY,
      InvestmentAction.SELL,
      InvestmentAction.SPLIT,
      InvestmentAction.TRANSFER_IN,
      InvestmentAction.TRANSFER_OUT,
      InvestmentAction.REINVEST,
      InvestmentAction.ADD_SHARES,
      InvestmentAction.REMOVE_SHARES,
    ]) {
      expect(movesShares(action)).toBe(true);
    }
  });

  it("is false for cash-only actions", () => {
    for (const action of [
      InvestmentAction.DIVIDEND,
      InvestmentAction.INTEREST,
      InvestmentAction.CAPITAL_GAIN,
    ]) {
      expect(movesShares(action)).toBe(false);
    }
  });
});
