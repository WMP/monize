import { BadRequestException } from "@nestjs/common";
import { validateSplitAmountSum } from "./split-amount.util";

describe("validateSplitAmountSum", () => {
  it("accepts splits whose 4dp sum equals the transaction amount", () => {
    expect(() =>
      validateSplitAmountSum(
        [{ amount: 50.0 }, { amount: 30.0 }, { amount: 20.0 }],
        100,
      ),
    ).not.toThrow();
  });

  it("rejects when the sum does not match", () => {
    expect(() =>
      validateSplitAmountSum([{ amount: 50 }, { amount: 30 }], 100),
    ).toThrow(BadRequestException);
  });

  it("rejects fewer than 2 splits by default", () => {
    expect(() => validateSplitAmountSum([{ amount: 100 }], 100)).toThrow(
      BadRequestException,
    );
  });

  it("rejects fewer than 2 splits when passthrough is disallowed by predicate", () => {
    expect(() =>
      validateSplitAmountSum([{ amount: 100 }], 100, {
        allowSinglePassthrough: true,
        isPassthrough: () => false,
      }),
    ).toThrow(BadRequestException);
  });

  it("allows a single split when allowSinglePassthrough + predicate match", () => {
    expect(() =>
      validateSplitAmountSum([{ amount: 100 }], 100, {
        allowSinglePassthrough: true,
        isPassthrough: () => true,
      }),
    ).not.toThrow();
  });

  it("tolerates rounding within 4dp precision", () => {
    expect(() =>
      validateSplitAmountSum(
        [{ amount: 33.3333 }, { amount: 33.3333 }, { amount: 33.3334 }],
        100,
      ),
    ).not.toThrow();
  });

  it("rejects float-precision mismatches beyond 4dp", () => {
    expect(() =>
      validateSplitAmountSum(
        [{ amount: 33.33333 }, { amount: 33.33333 }, { amount: 33.33333 }],
        100,
      ),
    ).toThrow(BadRequestException);
  });

  describe("child sign must follow the parent (P5-004)", () => {
    it("accepts same-sign children under a negative parent", () => {
      expect(() =>
        validateSplitAmountSum([{ amount: -60 }, { amount: -40 }], -100),
      ).not.toThrow();
    });

    it("accepts same-sign children under a positive parent", () => {
      expect(() =>
        validateSplitAmountSum([{ amount: 60 }, { amount: 40 }], 100),
      ).not.toThrow();
    });

    it("rejects +50 / -150 under a -100 parent", () => {
      // The audit's worked example. The signed sum is -100, so the old sum-only
      // check passed it: the account balance was right (it takes the parent
      // once) while category reporting gained 50 of income that never arrived
      // and 150 of expense against 100 of actual outflow.
      expect(() =>
        validateSplitAmountSum([{ amount: 50 }, { amount: -150 }], -100),
      ).toThrow(BadRequestException);
      expect(() =>
        validateSplitAmountSum([{ amount: 50 }, { amount: -150 }], -100),
      ).toThrow(/same sign/);
    });

    it("rejects a negative child under a positive parent", () => {
      expect(() =>
        validateSplitAmountSum([{ amount: 150 }, { amount: -50 }], 100),
      ).toThrow(/same sign/);
    });

    it("allows a zero child, which carries no sign", () => {
      expect(() =>
        validateSplitAmountSum([{ amount: 0 }, { amount: -100 }], -100),
      ).not.toThrow();
    });

    it("skips the check for a zero parent, where children must oppose", () => {
      // Children summing to zero necessarily have opposing signs and there is
      // no parent sign for them to follow.
      expect(() =>
        validateSplitAmountSum([{ amount: 100 }, { amount: -100 }], 0),
      ).not.toThrow();
    });

    it("allows mixed signs when the caller declares opposing flows", () => {
      // One brokerage line can sell (+proceeds), pay a fee (-) and buy (-) at
      // once, netting to a small positive. Those children are each real and are
      // validated against their computed cash impact instead.
      expect(() =>
        validateSplitAmountSum(
          [{ amount: 1000 }, { amount: -250 }, { amount: -700 }],
          50,
          { allowMixedSign: true },
        ),
      ).not.toThrow();
    });

    it("still enforces the sum when mixed signs are allowed", () => {
      expect(() =>
        validateSplitAmountSum(
          [{ amount: 1000 }, { amount: -250 }, { amount: -700 }],
          999,
          { allowMixedSign: true },
        ),
      ).toThrow(/must equal transaction amount/);
    });

    it("checks the sign at 4dp, so sub-cent noise does not flip it", () => {
      expect(() =>
        validateSplitAmountSum(
          [{ amount: -99.99999 }, { amount: -0.00001 }],
          -100,
        ),
      ).not.toThrow();
    });
  });
});
