/**
 * Executable vocabulary for feature state machines.
 *
 * A feature contract is intentionally stricter than a prose diagram: every
 * discriminator value must have one state definition, every tracked field must
 * be classified in every state, and an explicit transition policy must classify
 * every source/destination pair. The validator is used by repository tests so a
 * new enum member cannot compile or merge without a deliberate contract update.
 */
export type StateFieldMode =
  | "required"
  | "optional"
  | "derived"
  | "fixed-zero"
  | "fixed-one"
  | "fixed-null";

export interface StateDefinition<
  State extends string,
  Field extends string,
  Effect extends string = string,
> {
  state: State;
  fields: Record<Field, StateFieldMode>;
  effects: readonly Effect[];
}

export interface ExplicitTransitionClassification<State extends string> {
  allowed: readonly State[];
  forbidden: readonly State[];
}

export type TransitionPolicy<State extends string> =
  | { kind: "all-pairs" }
  | {
      kind: "explicit";
      byState: Record<State, ExplicitTransitionClassification<State>>;
    };

export interface StateFlowContract<
  State extends string,
  Field extends string,
  Effect extends string = string,
  Definition extends StateDefinition<State, Field, Effect> = StateDefinition<
    State,
    Field,
    Effect
  >,
> {
  name: string;
  fields: readonly Field[];
  states: Record<State, Definition>;
  transitions: TransitionPolicy<State>;
}

export interface ContractIssue {
  path: string;
  message: string;
}

export interface StateTransitionCase<
  State extends string,
  Field extends string,
  Effect extends string,
  Definition extends StateDefinition<State, Field, Effect>,
> {
  from: State;
  to: State;
  allowed: boolean;
  destination: Definition;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function compareKeys(
  expected: readonly string[],
  actual: readonly string[],
  path: string,
): ContractIssue[] {
  const issues: ContractIssue[] = [];
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);

  for (const missing of expected.filter((value) => !actualSet.has(value))) {
    issues.push({
      path: `${path}.${missing}`,
      message: "missing classification",
    });
  }
  for (const extra of actual.filter((value) => !expectedSet.has(value))) {
    issues.push({
      path: `${path}.${extra}`,
      message: "unknown classification",
    });
  }

  return issues;
}

/** Runtime counterpart to `satisfies Record<Enum, Contract>`. */
export function validateExhaustiveRecord<State extends string>(
  expectedStates: readonly State[],
  record: Readonly<Partial<Record<State, unknown>>>,
  path: string,
): ContractIssue[] {
  return compareKeys(expectedStates, Object.keys(record), path);
}

export function validateStateFlowContract<
  State extends string,
  Field extends string,
  Effect extends string,
  Definition extends StateDefinition<State, Field, Effect>,
>(
  expectedStates: readonly State[],
  contract: StateFlowContract<State, Field, Effect, Definition>,
): ContractIssue[] {
  const issues: ContractIssue[] = [];
  const states = unique(expectedStates);
  const fields = unique(contract.fields);

  if (states.length !== expectedStates.length) {
    issues.push({
      path: `${contract.name}.states`,
      message: "the discriminator contains duplicate values",
    });
  }
  if (fields.length !== contract.fields.length) {
    issues.push({
      path: `${contract.name}.fields`,
      message: "the tracked field list contains duplicate values",
    });
  }

  issues.push(
    ...validateExhaustiveRecord(
      states,
      contract.states,
      `${contract.name}.states`,
    ),
  );

  for (const state of states) {
    const definition = contract.states[state];
    if (!definition) continue;

    if (definition.state !== state) {
      issues.push({
        path: `${contract.name}.states.${state}.state`,
        message: `declares ${definition.state} instead of ${state}`,
      });
    }

    issues.push(
      ...compareKeys(
        fields,
        Object.keys(definition.fields),
        `${contract.name}.states.${state}.fields`,
      ),
    );

    if (definition.effects.length === 0) {
      issues.push({
        path: `${contract.name}.states.${state}.effects`,
        message: "must name at least one effect, including an explicit no-op",
      });
    }
  }

  if (contract.transitions.kind === "explicit") {
    issues.push(
      ...validateExhaustiveRecord(
        states,
        contract.transitions.byState,
        `${contract.name}.transitions`,
      ),
    );

    const stateSet = new Set(states);
    for (const from of states) {
      const classification = contract.transitions.byState[from];
      if (!classification) continue;

      const allowed = unique(classification.allowed);
      const forbidden = unique(classification.forbidden);
      if (allowed.length !== classification.allowed.length) {
        issues.push({
          path: `${contract.name}.transitions.${from}.allowed`,
          message: "contains duplicate destinations",
        });
      }
      if (forbidden.length !== classification.forbidden.length) {
        issues.push({
          path: `${contract.name}.transitions.${from}.forbidden`,
          message: "contains duplicate destinations",
        });
      }

      for (const target of [...allowed, ...forbidden]) {
        if (!stateSet.has(target)) {
          issues.push({
            path: `${contract.name}.transitions.${from}`,
            message: `classifies unknown destination ${target}`,
          });
        }
      }

      const forbiddenSet = new Set(forbidden);
      for (const target of allowed.filter((value) => forbiddenSet.has(value))) {
        issues.push({
          path: `${contract.name}.transitions.${from}.${target}`,
          message: "is both allowed and forbidden",
        });
      }

      issues.push(
        ...compareKeys(
          states,
          [...allowed, ...forbidden],
          `${contract.name}.transitions.${from}`,
        ),
      );
    }
  }

  return issues;
}

export function assertStateFlowContract<
  State extends string,
  Field extends string,
  Effect extends string,
  Definition extends StateDefinition<State, Field, Effect>,
>(
  expectedStates: readonly State[],
  contract: StateFlowContract<State, Field, Effect, Definition>,
): void {
  const issues = validateStateFlowContract(expectedStates, contract);
  if (issues.length === 0) return;

  const detail = issues
    .map((issue) => `- ${issue.path}: ${issue.message}`)
    .join("\n");
  throw new Error(`Invalid state-flow contract ${contract.name}:\n${detail}`);
}

/**
 * Generate the complete source x destination matrix. Tests consume this rather
 * than hand-picking a few transitions, which is how action-only transitions
 * previously kept stale financial fields.
 */
export function buildStateTransitionMatrix<
  State extends string,
  Field extends string,
  Effect extends string,
  Definition extends StateDefinition<State, Field, Effect>,
>(
  expectedStates: readonly State[],
  contract: StateFlowContract<State, Field, Effect, Definition>,
): Array<StateTransitionCase<State, Field, Effect, Definition>> {
  assertStateFlowContract(expectedStates, contract);

  return expectedStates.flatMap((from) =>
    expectedStates.map((to) => {
      const allowed =
        contract.transitions.kind === "all-pairs" ||
        contract.transitions.byState[from].allowed.includes(to);
      return {
        from,
        to,
        allowed,
        destination: contract.states[to],
      };
    }),
  );
}

/** Stable diagnostic helper used by guard tests and handoff tooling. */
export function stateFlowFingerprint<
  State extends string,
  Field extends string,
  Effect extends string,
  Definition extends StateDefinition<State, Field, Effect>,
>(
  expectedStates: readonly State[],
  contract: StateFlowContract<State, Field, Effect, Definition>,
): string {
  assertStateFlowContract(expectedStates, contract);
  const rows = expectedStates.map((state) => {
    const definition = contract.states[state];
    const fieldSummary = sorted(
      Object.entries(definition.fields).map(
        ([field, mode]) => `${field}:${mode}`,
      ),
    ).join(",");
    return `${state}|${fieldSummary}|${sorted(definition.effects).join(",")}`;
  });
  return rows.join("\n");
}
