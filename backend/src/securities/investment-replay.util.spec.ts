import { InvestmentAction } from "./entities/investment-transaction.entity";
import {
  acquisitionCost,
  acquisitionUnitCost,
  applyActionToQuantity,
  isQuantityOnlyAction,
  SHARE_MOVING_ACTIONS,
} from "./investment-replay.util";

describe("applyActionToQuantity", () => {
  describe("acquisitions add shares", () => {
    it.each([
      InvestmentAction.BUY,
      InvestmentAction.REINVEST,
      InvestmentAction.TRANSFER_IN,
      InvestmentAction.ADD_SHARES,
    ])("%s adds the quantity", (action) => {
      expect(applyActionToQuantity(10, action, 5)).toBe(15);
    });
  });

  describe("disposals subtract shares", () => {
    it.each([
      InvestmentAction.SELL,
      InvestmentAction.TRANSFER_OUT,
      InvestmentAction.REMOVE_SHARES,
    ])("%s subtracts the quantity", (action) => {
      expect(applyActionToQuantity(10, action, 4)).toBe(6);
    });

    it("subtracts in full past zero rather than clamping", () => {
      // An over-sell is a fact about the history, not something a replay may
      // quietly absorb: clamping here made the same position reconcile in the
      // holdings rebuild and fail in the import cross-check.
      expect(
        applyActionToQuantity(10, InvestmentAction.REMOVE_SHARES, 25),
      ).toBe(-15);
      expect(applyActionToQuantity(10, InvestmentAction.SELL, 25)).toBe(-15);
    });
  });

  describe("SPLIT quantity is a ratio, not a share count", () => {
    // This is the regression the audit's P5-011 named: three net-worth
    // reducers ADDED the ratio to the share count. A 2-for-1 split of a
    // 10-share position came out as 12 shares, worth 600 at 50/share instead
    // of 1,000 -- a 40% understatement on every historical chart.
    it("multiplies by a 2-for-1 ratio (10 shares -> 20, not 12)", () => {
      expect(applyActionToQuantity(10, InvestmentAction.SPLIT, 2)).toBe(20);
      expect(applyActionToQuantity(10, InvestmentAction.SPLIT, 2)).not.toBe(12);
    });

    it("handles a 3-for-2 ratio", () => {
      expect(applyActionToQuantity(100, InvestmentAction.SPLIT, 1.5)).toBe(150);
    });

    it("handles a 1-for-2 reverse split", () => {
      expect(applyActionToQuantity(100, InvestmentAction.SPLIT, 0.5)).toBe(50);
    });

    it("compounds sequential splits multiplicatively", () => {
      let qty = 10;
      qty = applyActionToQuantity(qty, InvestmentAction.SPLIT, 2);
      qty = applyActionToQuantity(qty, InvestmentAction.SPLIT, 3);
      expect(qty).toBe(60);
    });

    it("leaves the position alone for a zero or negative ratio", () => {
      // A row that cannot say what the split was is not evidence the shares
      // went away, and 0 would silently destroy a real position.
      expect(applyActionToQuantity(10, InvestmentAction.SPLIT, 0)).toBe(10);
      expect(applyActionToQuantity(10, InvestmentAction.SPLIT, -2)).toBe(10);
    });

    it("leaves an empty position empty", () => {
      expect(applyActionToQuantity(0, InvestmentAction.SPLIT, 2)).toBe(0);
    });
  });

  describe("cash actions do not move shares", () => {
    it.each([
      InvestmentAction.DIVIDEND,
      InvestmentAction.INTEREST,
      InvestmentAction.CAPITAL_GAIN,
    ])("%s leaves the quantity unchanged", (action) => {
      expect(applyActionToQuantity(10, action, 999)).toBe(10);
    });

    it("leaves the quantity unchanged for an unrecognised action", () => {
      expect(applyActionToQuantity(10, "SOMETHING_NEW", 5)).toBe(10);
    });
  });

  it("accepts a raw action string, as the net-worth raw-SQL replays supply", () => {
    // The historical replays read raw rows, where `action` is a plain string
    // rather than the enum member. Both must fold identically.
    expect(applyActionToQuantity(10, "SPLIT", 2)).toBe(20);
    expect(applyActionToQuantity(10, "ADD_SHARES", 5)).toBe(15);
    expect(applyActionToQuantity(10, "REMOVE_SHARES", 5)).toBe(5);
  });

  it("covers every share-moving action in SHARE_MOVING_ACTIONS", () => {
    for (const action of SHARE_MOVING_ACTIONS) {
      expect(applyActionToQuantity(10, action, 2)).not.toBe(10);
    }
  });

  it("lists exactly the actions that move shares", () => {
    const moving = Object.values(InvestmentAction).filter(
      (action) => applyActionToQuantity(10, action, 2) !== 10,
    );
    expect([...SHARE_MOVING_ACTIONS].sort()).toEqual(moving.sort());
  });
});

describe("isQuantityOnlyAction", () => {
  it("is true only for ADD_SHARES and REMOVE_SHARES", () => {
    expect(isQuantityOnlyAction(InvestmentAction.ADD_SHARES)).toBe(true);
    expect(isQuantityOnlyAction(InvestmentAction.REMOVE_SHARES)).toBe(true);
    expect(isQuantityOnlyAction(InvestmentAction.BUY)).toBe(false);
    expect(isQuantityOnlyAction(InvestmentAction.SPLIT)).toBe(false);
  });
});

describe("acquisitionCost", () => {
  it("includes the commission (P5-006)", () => {
    // 10 shares at 100 with 10 commission costs 1,010 -- which is exactly what
    // the linked cash debit takes out. A basis of 1,000 turns the commission
    // into 10 of phantom gain on the eventual sale.
    expect(acquisitionCost({ quantity: 10, price: 100, commission: 10 })).toBe(
      1010,
    );
  });

  it("converts price and commission together at the stored rate", () => {
    expect(
      acquisitionCost({
        quantity: 10,
        price: 100,
        commission: 10,
        exchangeRate: 0.9,
      }),
    ).toBeCloseTo(909, 10);
  });

  it("treats a missing commission as zero", () => {
    expect(acquisitionCost({ quantity: 10, price: 100 })).toBe(1000);
    expect(
      acquisitionCost({ quantity: 10, price: 100, commission: null }),
    ).toBe(1000);
  });

  it("defaults a missing rate to 1 only because same-currency needs no rate", () => {
    expect(
      acquisitionCost({ quantity: 2, price: 50, exchangeRate: null }),
    ).toBe(100);
  });

  it("returns null when the price is unknown but something was acquired", () => {
    // Unknown is not free. Folding this to 0 let an incomplete import pass the
    // quantity reconciliation and report a confident gain on a basis of zero.
    expect(acquisitionCost({ quantity: 10, price: null })).toBeNull();
    expect(acquisitionCost({ quantity: 10, price: undefined })).toBeNull();
    expect(
      acquisitionCost({ quantity: 0, price: null, commission: 5 }),
    ).toBeNull();
  });

  it("treats a stored zero price as unpriced, not free", () => {
    // This case used to assert the opposite -- that `price: 0` was an
    // explicitly free acquisition. Before `assertAcquisitionPriced` shipped,
    // `create()` stored `price ?? 0` and the form accepted a blank field, so
    // real databases hold zero-price BUY/REINVEST rows that mean "unknown";
    // no legitimate zero can be stored from here on, because the guard
    // refuses it.
    expect(acquisitionCost({ quantity: 10, price: 0 })).toBeNull();
    expect(acquisitionCost({ quantity: 10, price: -5 })).toBeNull();
    // A row that acquired nothing and paid nothing has a settled cost of
    // zero regardless of its price field.
    expect(acquisitionCost({ quantity: 0, price: null })).toBe(0);
  });

  it("accepts the string numerics a raw select returns", () => {
    expect(
      acquisitionCost({
        quantity: "10",
        price: "100",
        commission: "10",
        exchangeRate: "1",
      }),
    ).toBe(1010);
  });
});

describe("acquisitionUnitCost", () => {
  it("is the commission-inclusive cost per share (FR-008)", () => {
    // The live incremental holding update blends a per-share figure in, while a
    // rebuild sums total cost. Both must describe the same acquisition: 10
    // shares at 100 with 10 commission is 101.00 per share.
    expect(
      acquisitionUnitCost({ quantity: 10, price: 100, commission: 10 }),
    ).toBe(101);
  });

  it("agrees with acquisitionCost for every priced shape", () => {
    // The invariant that keeps the incremental path and the rebuild from
    // drifting: unit cost times quantity is the cost the rebuild would fold in.
    const shapes = [
      { quantity: 10, price: 100, commission: 10 },
      { quantity: 3, price: 150, commission: 9.99 },
      { quantity: 20, price: 100, commission: 0 },
      { quantity: 0.5, price: 1234.5678, commission: 1.25 },
      // No zero-price shape here: a stored 0 means "unpriced", not "free",
      // so it is not a priced shape either function can cost.
      { quantity: -5, price: 100, commission: 10 },
    ];

    for (const shape of shapes) {
      const total = acquisitionCost(shape);
      expect(total).not.toBeNull();
      expect(acquisitionUnitCost(shape) * shape.quantity).toBeCloseTo(
        total as number,
        8,
      );
    }
  });

  it("falls back to the price when the cost cannot be worked out", () => {
    // An unpriced TRANSFER_IN carries no cost, and the incremental holding
    // update needs a number rather than a null -- the same 0 the pre-FR-008
    // `Number(price)` produced, so an unpriced transfer behaves as before.
    expect(acquisitionUnitCost({ quantity: 10, price: null })).toBe(0);
    expect(acquisitionUnitCost({ quantity: 10, price: undefined })).toBe(0);
  });

  it("returns the price when no shares moved", () => {
    // Dividing by a zero quantity would give Infinity, which would be written
    // into averageCost.
    expect(acquisitionUnitCost({ quantity: 0, price: 42, commission: 5 })).toBe(
      42,
    );
  });

  it("accepts the string numerics a raw select returns", () => {
    expect(
      acquisitionUnitCost({ quantity: "10", price: "100", commission: "10" }),
    ).toBe(101);
  });
});
