import {
  assertStateFlowContract,
  buildStateTransitionMatrix,
  StateFlowContract,
  validateStateFlowContract,
} from "./state-flow.contract";

type DemoState = "DRAFT" | "POSTED" | "VOID";
type DemoField = "amount" | "postedAt";
type DemoEffect = "none" | "moves-money" | "reverses-money";

const STATES: readonly DemoState[] = ["DRAFT", "POSTED", "VOID"];

const VALID_CONTRACT = {
  name: "demo-payment",
  fields: ["amount", "postedAt"],
  states: {
    DRAFT: {
      state: "DRAFT",
      fields: { amount: "required", postedAt: "fixed-null" },
      effects: ["none"],
    },
    POSTED: {
      state: "POSTED",
      fields: { amount: "required", postedAt: "derived" },
      effects: ["moves-money"],
    },
    VOID: {
      state: "VOID",
      fields: { amount: "required", postedAt: "optional" },
      effects: ["reverses-money"],
    },
  },
  transitions: {
    kind: "explicit",
    byState: {
      DRAFT: { allowed: ["DRAFT", "POSTED"], forbidden: ["VOID"] },
      POSTED: { allowed: ["POSTED", "VOID"], forbidden: ["DRAFT"] },
      VOID: { allowed: ["VOID", "POSTED"], forbidden: ["DRAFT"] },
    },
  },
} satisfies StateFlowContract<DemoState, DemoField, DemoEffect>;

describe("state-flow contract validator", () => {
  it("accepts a complete state, field and transition classification", () => {
    expect(() => assertStateFlowContract(STATES, VALID_CONTRACT)).not.toThrow();
  });

  it("generates every source/destination pair", () => {
    const matrix = buildStateTransitionMatrix(STATES, VALID_CONTRACT);
    expect(matrix).toHaveLength(9);
    expect(matrix).toContainEqual(
      expect.objectContaining({ from: "POSTED", to: "DRAFT", allowed: false }),
    );
    expect(matrix).toContainEqual(
      expect.objectContaining({ from: "VOID", to: "POSTED", allowed: true }),
    );
  });

  it("fails when a new state has no contract entry", () => {
    const mutated = structuredClone(VALID_CONTRACT) as StateFlowContract<
      DemoState,
      DemoField,
      DemoEffect
    >;
    delete (mutated.states as Partial<typeof mutated.states>).VOID;

    expect(validateStateFlowContract(STATES, mutated)).toContainEqual({
      path: "demo-payment.states.VOID",
      message: "missing classification",
    });
  });

  it("fails when a destination field is left unclassified", () => {
    const mutated = structuredClone(VALID_CONTRACT) as StateFlowContract<
      DemoState,
      DemoField,
      DemoEffect
    >;
    delete (mutated.states.POSTED.fields as Partial<Record<DemoField, unknown>>)
      .postedAt;

    expect(validateStateFlowContract(STATES, mutated)).toContainEqual({
      path: "demo-payment.states.POSTED.fields.postedAt",
      message: "missing classification",
    });
  });

  it("fails when an explicit transition is neither allowed nor forbidden", () => {
    const mutated = structuredClone(VALID_CONTRACT) as StateFlowContract<
      DemoState,
      DemoField,
      DemoEffect
    >;
    if (mutated.transitions.kind !== "explicit")
      throw new Error("test fixture");
    mutated.transitions.byState.DRAFT = {
      allowed: ["DRAFT", "POSTED"],
      forbidden: [],
    };

    expect(validateStateFlowContract(STATES, mutated)).toContainEqual({
      path: "demo-payment.transitions.DRAFT.VOID",
      message: "missing classification",
    });
  });

  it("supports deliberately all-pairs feature flows", () => {
    const allPairs = {
      ...VALID_CONTRACT,
      transitions: { kind: "all-pairs" },
    } satisfies StateFlowContract<DemoState, DemoField, DemoEffect>;

    expect(buildStateTransitionMatrix(STATES, allPairs)).toHaveLength(9);
    expect(
      buildStateTransitionMatrix(STATES, allPairs).every((row) => row.allowed),
    ).toBe(true);
  });
});
