import { readFileSync } from "fs";
import { join } from "path";
import {
  assertStateFlowContract,
  buildStateTransitionMatrix,
  validateStateFlowContract,
} from "../common/financial-invariants/state-flow.contract";
import { computeInvestmentCashImpact } from "./cash-impact.util";
import { InvestmentAction } from "./entities/investment-transaction.entity";
import {
  INVESTMENT_ACTION_FIELDS,
  INVESTMENT_ACTION_FLOW,
  investmentActionsWhere,
} from "./investment-action.contract";
import {
  applyActionToQuantity,
  isQuantityOnlyAction,
  SHARE_MOVING_ACTIONS,
} from "./investment-replay.util";

const ACTIONS = Object.values(InvestmentAction);

const CASH_IMPACT_CASES: Array<
  [InvestmentAction, number, number, number, number]
> = [
  [InvestmentAction.BUY, 10, 100, 5, -1005],
  [InvestmentAction.SELL, 10, 100, 5, 995],
  [InvestmentAction.DIVIDEND, 10, 2, 0, 20],
  [InvestmentAction.INTEREST, 0, 25, 0, 25],
  [InvestmentAction.CAPITAL_GAIN, 2, 40, 0, 80],
  [InvestmentAction.REINVEST, 10, 100, 5, 0],
  [InvestmentAction.SPLIT, 10, 100, 5, 0],
  [InvestmentAction.TRANSFER_IN, 10, 100, 5, 0],
  [InvestmentAction.TRANSFER_OUT, 10, 100, 5, 0],
  [InvestmentAction.ADD_SHARES, 10, 100, 5, 0],
  [InvestmentAction.REMOVE_SHARES, 10, 100, 5, 0],
];

describe("InvestmentAction executable contract", () => {
  it("classifies every backend enum member and every tracked field", () => {
    expect(() =>
      assertStateFlowContract(ACTIONS, INVESTMENT_ACTION_FLOW),
    ).not.toThrow();
    expect(Object.keys(INVESTMENT_ACTION_FLOW.states).sort()).toEqual(
      [...ACTIONS].sort(),
    );

    for (const action of ACTIONS) {
      expect(
        Object.keys(INVESTMENT_ACTION_FLOW.states[action].fields).sort(),
      ).toEqual([...INVESTMENT_ACTION_FIELDS].sort());
    }
  });

  it("generates the full action-transition matrix", () => {
    const matrix = buildStateTransitionMatrix(ACTIONS, INVESTMENT_ACTION_FLOW);
    expect(matrix).toHaveLength(ACTIONS.length * ACTIONS.length);
    expect(matrix.every((transition) => transition.allowed)).toBe(true);

    // Destination rules, not source fields, decide what survives a transition.
    const buyToAddShares = matrix.find(
      ({ from, to }) =>
        from === InvestmentAction.BUY && to === InvestmentAction.ADD_SHARES,
    );
    expect(buyToAddShares?.destination.fields).toMatchObject({
      fundingAccountId: "fixed-null",
      price: "fixed-null",
      commission: "fixed-zero",
      totalAmount: "fixed-zero",
      exchangeRate: "fixed-one",
      cashTransactionId: "fixed-null",
    });
  });

  it("keeps the frontend InvestmentAction union exhaustive and equal", () => {
    const frontendSource = readFileSync(
      join(__dirname, "../../../frontend/src/types/investment.ts"),
      "utf8",
    );
    const union = frontendSource.match(
      /export type InvestmentAction\s*=([\s\S]*?);/,
    )?.[1];
    expect(union).toBeDefined();

    const frontendActions = Array.from(
      union!.matchAll(/'([^']+)'/g),
      (match) => match[1],
    );
    expect([...new Set(frontendActions)].sort()).toEqual([...ACTIONS].sort());
  });

  it("keeps the canonical replay and cash consumers routed through the registry", () => {
    const replaySource = readFileSync(
      join(__dirname, "investment-replay.util.ts"),
      "utf8",
    );
    const cashSource = readFileSync(
      join(__dirname, "cash-impact.util.ts"),
      "utf8",
    );

    expect(replaySource).toContain('from "./investment-action.contract"');
    expect(cashSource).toContain('from "./investment-action.contract"');
    expect(replaySource).not.toMatch(/case InvestmentAction\./);
    expect(cashSource).not.toMatch(/case InvestmentAction\./);
  });

  it("derives every replay classification from the same registry", () => {
    expect([...SHARE_MOVING_ACTIONS].sort()).toEqual(
      investmentActionsWhere((state) => state.shareEffect !== "none").sort(),
    );
    expect(isQuantityOnlyAction(InvestmentAction.ADD_SHARES)).toBe(true);
    expect(isQuantityOnlyAction(InvestmentAction.REMOVE_SHARES)).toBe(true);
    expect(isQuantityOnlyAction(InvestmentAction.BUY)).toBe(false);
  });

  it.each(CASH_IMPACT_CASES)(
    "%s has the contract cash impact for q=%s p=%s commission=%s",
    (
      action: InvestmentAction,
      quantity: number,
      price: number,
      commission: number,
      expected: number,
    ) => {
      expect(
        computeInvestmentCashImpact(action, quantity, price, commission),
      ).toBe(expected);
    },
  );

  it.each([
    [InvestmentAction.BUY, 12],
    [InvestmentAction.SELL, 8],
    [InvestmentAction.DIVIDEND, 10],
    [InvestmentAction.INTEREST, 10],
    [InvestmentAction.CAPITAL_GAIN, 10],
    [InvestmentAction.SPLIT, 20],
    [InvestmentAction.TRANSFER_IN, 12],
    [InvestmentAction.TRANSFER_OUT, 8],
    [InvestmentAction.REINVEST, 12],
    [InvestmentAction.ADD_SHARES, 12],
    [InvestmentAction.REMOVE_SHARES, 8],
  ] as Array<[InvestmentAction, number]>)(
    "%s has the expected share effect",
    (action: InvestmentAction, expected: number) => {
      expect(applyActionToQuantity(10, action, 2)).toBe(expected);
    },
  );

  it("replays share additions, removals and split ratios numerically", () => {
    let quantity = 0;
    quantity = applyActionToQuantity(quantity, InvestmentAction.BUY, 10);
    quantity = applyActionToQuantity(quantity, InvestmentAction.ADD_SHARES, 2);
    quantity = applyActionToQuantity(quantity, InvestmentAction.SPLIT, 2);
    quantity = applyActionToQuantity(quantity, InvestmentAction.SELL, 5);
    quantity = applyActionToQuantity(
      quantity,
      InvestmentAction.REMOVE_SHARES,
      1,
    );
    expect(quantity).toBe(18);

    // A non-positive ratio is missing/invalid, not evidence that shares vanished.
    expect(applyActionToQuantity(18, InvestmentAction.SPLIT, 0)).toBe(18);
  });

  it("has a negative control: removing one action makes the gate fail", () => {
    const mutated = JSON.parse(
      JSON.stringify(INVESTMENT_ACTION_FLOW),
    ) as typeof INVESTMENT_ACTION_FLOW;
    delete (mutated.states as Partial<typeof mutated.states>)[
      InvestmentAction.BUY
    ];

    expect(validateStateFlowContract(ACTIONS, mutated)).toContainEqual({
      path: "investment-action.states.BUY",
      message: "missing classification",
    });
  });
});
