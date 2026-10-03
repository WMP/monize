import {
  RuleConditionExplanation,
  explainRuleCondition,
} from "./rule-condition.explain";
import {
  RULE_CONDITION_FIELDS,
  RuleConditionNode,
  RuleFacts,
} from "./rule-condition.types";
import { RuleDefinitionLabels } from "./rule-labels";
import { RuleSkipReason, RuleTraceEntry } from "./rule-effects";
import { RuleReferencedIds } from "./rule-validation";

/** One rule of the user as the explanation lists it. */
export interface ListedRule {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly position: number;
  readonly condition: RuleConditionNode;
  /** The stored definition no longer validates, or names an id that is gone. */
  readonly invalid: boolean;
}

/** What one rule did for the row, in the order the rules run. */
export interface ExplainedRule {
  readonly ruleId: string;
  readonly ruleName: string;
  readonly enabled: boolean;
  readonly position: number;
  /** Why the rule was not evaluated at all: it is switched off, or it no longer validates. */
  readonly skippedRule?: RuleSkipReason;
  /** False for a rule that was not reached: a rule before it stopped the pass, or it was skipped. */
  readonly evaluated: boolean;
  readonly matched: boolean;
  /** Each condition node with its answer; null when the rule was not evaluated. */
  readonly condition: RuleConditionExplanation | null;
  /**
   * The trace entry the planner wrote for this rule: what its actions changed,
   * applied and skipped (with reasons). Null when the rule was not evaluated.
   */
  readonly effects: RuleTraceEntry | null;
  /** True when this matched rule ended the pass (`stopProcessing`). */
  readonly stopped: boolean;
}

/** The answer of `POST /transaction-rules/explain-row`. */
export interface RuleRowExplanation {
  readonly rules: readonly ExplainedRule[];
  /** Names for every id the explanation mentions; an id with no name is gone. */
  readonly labels: RuleDefinitionLabels;
}

/**
 * Put the planner's answer next to the rules in the order they run. Pure.
 * `trace` is the planner's own (`planForRow` over the usable rules) and
 * `factsByRule` the facts each rule's condition was evaluated against, so the
 * explanation describes the evaluation that decided the trace, not a second
 * one.
 */
export function assembleExplainedRules(
  listed: readonly ListedRule[],
  trace: readonly RuleTraceEntry[],
  factsByRule: ReadonlyMap<string, RuleFacts>,
): ExplainedRule[] {
  const entries = new Map(trace.map((entry) => [entry.ruleId, entry]));
  return listed.map((rule): ExplainedRule => {
    const base = {
      ruleId: rule.id,
      ruleName: rule.name,
      enabled: rule.enabled,
      position: rule.position,
    };
    const notRun = !rule.enabled ? "disabled" : rule.invalid ? "invalid" : null;
    const entry = entries.get(rule.id);
    const facts = factsByRule.get(rule.id);
    if (notRun !== null || entry === undefined || facts === undefined) {
      return {
        ...base,
        ...(notRun !== null ? { skippedRule: notRun } : {}),
        evaluated: false,
        matched: false,
        condition: null,
        effects: null,
        stopped: false,
      };
    }
    return {
      ...base,
      evaluated: true,
      matched: entry.matched,
      condition: explainRuleCondition(rule.condition, facts),
      effects: entry,
      stopped: entry.stopped,
    };
  });
}

const addId = (target: Set<string>, id: unknown): void => {
  if (typeof id === "string") target.add(id);
};

function visit(
  node: RuleConditionExplanation,
  sets: Record<keyof RuleReferencedIds, Set<string>>,
): void {
  if (node.kind === "omitted") return;
  if (node.kind !== "leaf") {
    node.children.forEach((child) => visit(child, sets));
    return;
  }
  const kind = RULE_CONDITION_FIELDS[node.field]?.kind;
  const target =
    kind === "accountId"
      ? sets.accountIds
      : kind === "payeeId"
        ? sets.payeeIds
        : kind === "categoryId"
          ? sets.categoryIds
          : kind === "tagIds"
            ? sets.tagIds
            : null;
  if (target === null) return;
  for (const value of [node.expected, node.actual]) {
    for (const id of Array.isArray(value) ? value : [value]) addId(target, id);
  }
}

/**
 * The ids a set of explained rules mentions, to be named: the ids a condition
 * expected, the ids the row had, and the ids its effects moved between.
 */
export function explainedIds(
  rules: readonly ExplainedRule[],
): RuleReferencedIds {
  const sets = {
    accountIds: new Set<string>(),
    payeeIds: new Set<string>(),
    categoryIds: new Set<string>(),
    tagIds: new Set<string>(),
  };
  for (const rule of rules) {
    if (rule.condition !== null) visit(rule.condition, sets);
    const changes = rule.effects?.changes;
    if (changes === undefined) continue;
    addId(sets.categoryIds, changes.categoryId?.before);
    addId(sets.categoryIds, changes.categoryId?.after);
    addId(sets.payeeIds, changes.payeeId?.before);
    addId(sets.payeeIds, changes.payeeId?.after);
    for (const id of [
      ...(changes.tagIds?.before ?? []),
      ...(changes.tagIds?.after ?? []),
    ]) {
      addId(sets.tagIds, id);
    }
  }
  return {
    accountIds: [...sets.accountIds],
    payeeIds: [...sets.payeeIds],
    categoryIds: [...sets.categoryIds],
    tagIds: [...sets.tagIds],
  };
}
