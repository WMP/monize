/**
 * The action list as the editor holds it, and the operations on it. Like
 * `lib/rule-tree.ts`, every operation returns a new list and each action
 * carries a `uid` so a moved card keeps its own picker state.
 */
import {
  MAX_RULE_ACTIONS,
  MAX_RULE_AI_REVIEW_ACTIONS,
  isRuleActionType,
} from '@/lib/rule-fields';
import { newUid } from '@/lib/rule-tree';
import type { RuleActionType, RuleDescriptionMode, StructuralRuleAction } from '@/types/transaction-rule';

/** Every action the server accepts has a card, so the editor holds all of them. */
export type EditorActionType = RuleActionType;

export const isEditorActionType = (value: unknown): value is EditorActionType => isRuleActionType(value);

/**
 * The two actions that restructure the row (a transfer, a split). They are
 * created through the assistant or MCP, so the editor holds them as they are
 * stored, shows them read-only, and never offers them in the type picker.
 */
export type StructuralActionType = StructuralRuleAction['type'];

export const isStructuralActionType = (value: unknown): value is StructuralActionType =>
  value === 'convert_to_transfer' || value === 'split';

/** The types a card can be set to, and a blank card can start as. */
export type EditableActionType = Exclude<EditorActionType, StructuralActionType>;

export const isEditableActionType = (value: unknown): value is EditableActionType =>
  isEditorActionType(value) && !isStructuralActionType(value);

/** The order the type picker lists them in: the ones that write the row first, the review last. */
export const EDITOR_ACTION_TYPES: readonly EditableActionType[] = [
  'add_tags',
  'remove_tags',
  'set_category',
  'set_payee',
  'set_payee_from_text',
  'set_description',
  'request_ai_review',
];

/** The ways `set_description` joins its text to the current one. */
export const DESCRIPTION_MODES: readonly RuleDescriptionMode[] = ['replace', 'append', 'prepend'];

export const isDescriptionMode = (value: unknown): value is RuleDescriptionMode =>
  typeof value === 'string' && (DESCRIPTION_MODES as readonly string[]).includes(value);

export type EditorAction =
  | { readonly uid: string; readonly type: 'add_tags' | 'remove_tags'; readonly tagIds: readonly string[] }
  | { readonly uid: string; readonly type: 'set_category'; readonly categoryId: string; readonly onlyIfEmpty: boolean }
  | { readonly uid: string; readonly type: 'set_payee'; readonly payeeId: string; readonly onlyIfEmpty: boolean }
  | {
      readonly uid: string;
      readonly type: 'set_payee_from_text';
      readonly template: string;
      readonly createIfMissing: boolean;
      readonly onlyIfEmpty: boolean;
    }
  | {
      readonly uid: string;
      readonly type: 'set_description';
      readonly template: string;
      readonly mode: RuleDescriptionMode;
      readonly onlyIfEmpty: boolean;
    }
  | { readonly uid: string; readonly type: 'request_ai_review'; readonly instruction: string }
  /** Kept exactly as stored: the editor does not edit it, and saving the rule sends it back unchanged. */
  | { readonly uid: string; readonly type: StructuralActionType; readonly stored: StructuralRuleAction };

/** An action the editor can create and edit: every one except the stored structural ones. */
export type EditableAction = Exclude<EditorAction, { readonly stored: StructuralRuleAction }>;

/**
 * A blank action of `type`. `onlyIfEmpty` starts on: a rule fills, it does not
 * overwrite. The two text actions start where the server's defaults are
 * (`withActionDefaults`): a payee is filled and never created, a description is
 * replaced and written even when there is one.
 */
export function createAction(type: EditableActionType = 'add_tags'): EditableAction {
  const uid = newUid();
  switch (type) {
    case 'add_tags':
    case 'remove_tags':
      return { uid, type, tagIds: [] };
    case 'set_category':
      return { uid, type, categoryId: '', onlyIfEmpty: true };
    case 'set_payee':
      return { uid, type, payeeId: '', onlyIfEmpty: true };
    case 'set_payee_from_text':
      return { uid, type, template: '', createIfMissing: false, onlyIfEmpty: true };
    case 'set_description':
      return { uid, type, template: '', mode: 'replace', onlyIfEmpty: false };
    case 'request_ai_review':
      return { uid, type, instruction: '' };
  }
}

/** Changing the type starts over, but the card keeps its place and its `uid`. */
export function changeActionType(action: EditorAction, type: EditableActionType): EditableAction {
  if (action.type === type) return action;
  return { ...createAction(type), uid: action.uid };
}

const countAiReviews = (actions: readonly EditorAction[]): number =>
  actions.filter((a) => a.type === 'request_ai_review').length;

/** Room for another action of any type. */
export function canAddAction(actions: readonly EditorAction[]): boolean {
  return actions.length < MAX_RULE_ACTIONS;
}

/**
 * The types the card at `index` may be set to. `request_ai_review` is offered
 * only to the card that already is one, or while no other card is.
 */
export function availableActionTypes(actions: readonly EditorAction[], index: number): EditableActionType[] {
  const othersWithReview = countAiReviews(actions.filter((_, i) => i !== index));
  return EDITOR_ACTION_TYPES.filter(
    (type) => type !== 'request_ai_review' || othersWithReview < MAX_RULE_AI_REVIEW_ACTIONS,
  );
}

export function updateAction(
  actions: readonly EditorAction[],
  index: number,
  next: EditorAction,
): readonly EditorAction[] {
  return actions.map((a, i) => (i === index ? next : a));
}

export function removeAction(actions: readonly EditorAction[], index: number): readonly EditorAction[] {
  return actions.filter((_, i) => i !== index);
}

export function canMoveAction(actions: readonly EditorAction[], index: number, delta: -1 | 1): boolean {
  const target = index + delta;
  return index >= 0 && index < actions.length && target >= 0 && target < actions.length;
}

export function moveAction(
  actions: readonly EditorAction[],
  index: number,
  delta: -1 | 1,
): readonly EditorAction[] {
  if (!canMoveAction(actions, index, delta)) return actions;
  const next = [...actions];
  [next[index], next[index + delta]] = [next[index + delta], next[index]];
  return next;
}

/** A second `request_ai_review` or structural action is refused by the server, so it is never offered. */
export function canDuplicateAction(actions: readonly EditorAction[], index: number): boolean {
  const action = actions[index];
  if (!action || !canAddAction(actions)) return false;
  return action.type !== 'request_ai_review' && !isStructuralActionType(action.type);
}

export function duplicateAction(actions: readonly EditorAction[], index: number): readonly EditorAction[] {
  if (!canDuplicateAction(actions, index)) return actions;
  const next = [...actions];
  next.splice(index + 1, 0, { ...actions[index], uid: newUid() });
  return next;
}

/** The stable string an error map uses for an action card. */
export const actionKey = (index: number): string => `a:${index}`;
