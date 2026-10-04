import type {
  CreateEmailReceiptParserPayload,
  EmailReceiptParser,
  ReceiptCategoryRule,
  ReceiptParserDefinition,
  ReceiptParserValidationError,
} from '@/types/email-receipts';

/**
 * The parser editor's form state and its conversion to and from the stored
 * definition (design section 5.1). Pure, so the JSON the editor sends is
 * tested without rendering it. Patterns are one per line in a textarea; the
 * server's validator is the authority on what a pattern may hold, so nothing
 * here rejects a pattern, it only builds the structure.
 */

/** The only definition version the server reads; the form always writes it. */
export const PARSER_DEFINITION_VERSION = 2;

export interface CategoryRuleRow {
  /** A list key, never sent. */
  uid: string;
  match: string;
  categoryId: string;
}

export interface ParserFormState {
  name: string;
  payeeId: string;
  /** Comma, semicolon, space or line separated. */
  fromDomains: string;
  /** Comma or line separated (a word may hold spaces). */
  subjectContains: string;
  /** One pattern per line, for each of the four fields below. */
  orderId: string;
  total: string;
  shipping: string;
  discount: string;
  startAfter: string;
  stopAt: string;
  itemPatterns: string;
  categoryRules: CategoryRuleRow[];
  defaultCategoryId: string;
  shippingCategoryId: string;
}

/**
 * A change to the form: the fields that moved, or a function of the form as it
 * is when the change is applied. A list edited from the previous render's copy
 * (append a rule, remove a rule) loses a change made in the same batch, so the
 * list fields use the function.
 */
export type ParserFormChange = (
  changes: Partial<ParserFormState> | ((current: ParserFormState) => Partial<ParserFormState>),
) => void;

export const emptyParserForm = (overrides: Partial<ParserFormState> = {}): ParserFormState => ({
  name: '',
  payeeId: '',
  fromDomains: '',
  subjectContains: '',
  orderId: '',
  total: '',
  shipping: '',
  discount: '',
  startAfter: '',
  stopAt: '',
  itemPatterns: '',
  categoryRules: [],
  defaultCategoryId: '',
  shippingCategoryId: '',
  ...overrides,
});

const newRow = (match: string, categoryId: string): CategoryRuleRow => ({
  uid: crypto.randomUUID(),
  match,
  categoryId,
});

export const blankCategoryRule = (): CategoryRuleRow => newRow('', '');

/** Non-blank lines, trimmed. A pattern may hold a comma, so lines are the only separator. */
export function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/** Non-blank entries separated by a line break or a comma, trimmed. */
export function splitWords(text: string): string[] {
  return text
    .split(/[\r\n,]+/)
    .map((word) => word.trim())
    .filter((word) => word !== '');
}

/** Domains separated by whitespace, commas or semicolons; a leading `@` is what a pasted address leaves. */
export function splitDomains(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((domain) => domain.trim().replace(/^@+/, ''))
    .filter((domain) => domain !== '');
}

/**
 * The definition the form describes. An empty field is left out (an absent
 * field reads nothing), but `items` is sent whenever any of its three parts is
 * filled, so a section marker with no pattern is reported by the server as
 * `items.patterns: empty` instead of being dropped without a word.
 */
export function buildParserDefinition(form: ParserFormState): ReceiptParserDefinition {
  const definition: ReceiptParserDefinition = { version: PARSER_DEFINITION_VERSION };

  const orderId = splitLines(form.orderId);
  const total = splitLines(form.total);
  const shipping = splitLines(form.shipping);
  const discount = splitLines(form.discount);
  if (orderId.length > 0) definition.orderId = orderId;
  if (total.length > 0) definition.total = total;
  if (shipping.length > 0) definition.shipping = shipping;
  if (discount.length > 0) definition.discount = discount;

  const patterns = splitLines(form.itemPatterns);
  const startAfter = form.startAfter.trim();
  const stopAt = form.stopAt.trim();
  if (patterns.length > 0 || startAfter !== '' || stopAt !== '') {
    definition.items = {
      ...(startAfter !== '' ? { startAfter } : {}),
      ...(stopAt !== '' ? { stopAt } : {}),
      patterns,
    };
  }

  const rules: ReceiptCategoryRule[] = form.categoryRules
    .filter((row) => row.match.trim() !== '' || row.categoryId !== '')
    .map((row) => ({ match: row.match.trim(), categoryId: row.categoryId }));
  if (rules.length > 0) definition.categoryRules = rules;

  if (form.defaultCategoryId !== '') definition.defaultCategoryId = form.defaultCategoryId;
  if (form.shippingCategoryId !== '') definition.shippingCategoryId = form.shippingCategoryId;
  return definition;
}

/**
 * The create payload; update sends the same fields plus the revision it was
 * read at. The definition is the form's unless the JSON editor supplies one.
 */
export function buildParserPayload(
  form: ParserFormState,
  definition: ReceiptParserDefinition = buildParserDefinition(form),
): CreateEmailReceiptParserPayload {
  return {
    name: form.name.trim(),
    payeeId: form.payeeId === '' ? null : form.payeeId,
    fromDomains: splitDomains(form.fromDomains),
    subjectContains: splitWords(form.subjectContains),
    definition,
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

type DefinitionFields = Pick<
  ParserFormState,
  | 'orderId'
  | 'total'
  | 'shipping'
  | 'discount'
  | 'startAfter'
  | 'stopAt'
  | 'itemPatterns'
  | 'categoryRules'
  | 'defaultCategoryId'
  | 'shippingCategoryId'
>;

/**
 * The form fields a definition fills. The definition comes off the wire as a
 * bare record (a draft restored from a backup can be `{}`), so each part is
 * read defensively and a missing part is an empty field, never a crash. What
 * the form has no field for is not read: `formCanRepresent` says when that
 * would lose something.
 */
export function definitionToFormFields(value: unknown): DefinitionFields {
  const definition = isRecord(value) ? value : {};
  const items = isRecord(definition.items) ? definition.items : {};
  const rules = Array.isArray(definition.categoryRules) ? definition.categoryRules : [];
  return {
    orderId: stringList(definition.orderId).join('\n'),
    total: stringList(definition.total).join('\n'),
    shipping: stringList(definition.shipping).join('\n'),
    discount: stringList(definition.discount).join('\n'),
    startAfter: text(items.startAfter),
    stopAt: text(items.stopAt),
    itemPatterns: stringList(items.patterns).join('\n'),
    categoryRules: rules
      .filter(isRecord)
      .map((rule) => newRow(text(rule.match), text(rule.categoryId))),
    defaultCategoryId: text(definition.defaultCategoryId),
    shippingCategoryId: text(definition.shippingCategoryId),
  };
}

/** A stored parser as form state. */
export function parserToForm(parser: EmailReceiptParser): ParserFormState {
  return {
    name: parser.name,
    payeeId: parser.payeeId ?? '',
    fromDomains: parser.fromDomains.join('\n'),
    subjectContains: parser.subjectContains.join('\n'),
    ...definitionToFormFields(parser.definition),
  };
}

const FORM_TOP_LEVEL_KEYS = [
  'version',
  'orderId',
  'total',
  'shipping',
  'discount',
  'items',
  'categoryRules',
  'defaultCategoryId',
  'shippingCategoryId',
];
const FORM_ITEMS_KEYS = ['startAfter', 'stopAt', 'patterns'];

const onlyStrings = (value: unknown): boolean =>
  value === undefined || (Array.isArray(value) && value.every((entry) => typeof entry === 'string'));

const onlyKeys = (value: Record<string, unknown>, allowed: readonly string[]): boolean =>
  Object.keys(value).every((key) => allowed.includes(key));

/**
 * Can the form show this definition without losing any of it? Only a
 * definition of plain line patterns, one item per line, with nothing the form
 * has no field for: a labelled entry, a multi-line `record`, `skipLines`, an
 * unknown key or a value of the wrong kind would be dropped by the next
 * `buildParserDefinition`, so such a definition is edited as JSON. The version
 * does not matter: an old definition the form can show is shown, and saving it
 * writes the current version.
 */
export function formCanRepresent(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!onlyKeys(value, FORM_TOP_LEVEL_KEYS)) return false;
  for (const field of ['orderId', 'total', 'shipping', 'discount']) {
    if (!onlyStrings(value[field])) return false;
  }
  if (value.items !== undefined) {
    if (!isRecord(value.items) || !onlyKeys(value.items, FORM_ITEMS_KEYS)) return false;
    if (!onlyStrings(value.items.patterns)) return false;
    for (const marker of [value.items.startAfter, value.items.stopAt]) {
      if (marker !== undefined && typeof marker !== 'string') return false;
    }
  }
  if (value.categoryRules !== undefined) {
    if (!Array.isArray(value.categoryRules)) return false;
    const simple = value.categoryRules.every(
      (rule) =>
        isRecord(rule) &&
        onlyKeys(rule, ['match', 'categoryId']) &&
        typeof rule.match === 'string' &&
        typeof rule.categoryId === 'string',
    );
    if (!simple) return false;
  }
  for (const id of [value.defaultCategoryId, value.shippingCategoryId]) {
    if (id !== undefined && typeof id !== 'string') return false;
  }
  return true;
}

/** The definition as the JSON editor shows it: indented, so a person can read and edit it. */
export function formatDefinitionJson(definition: unknown): string {
  return JSON.stringify(definition ?? {}, null, 2);
}

export type DefinitionJsonResult = { ok: true; definition: Record<string, unknown> } | { ok: false };

/**
 * The text of the JSON editor as a definition. Only the shape is checked here
 * (a JSON object); what the object may hold is the server's validator's call,
 * reported with the same codes as the form's.
 */
export function parseDefinitionJson(source: string): DefinitionJsonResult {
  try {
    const parsed: unknown = JSON.parse(source);
    return isRecord(parsed) ? { ok: true, definition: parsed } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/** Every code the server's validator reports (`ReceiptParserValidationError.code`). */
export const PARSER_VALIDATION_CODES = [
  'not_object',
  'unknown_key',
  'unsupported_version',
  'invalid_type',
  'empty',
  'too_many',
  'too_long',
  'control_character',
  'malformed_capture',
  'too_many_captures',
  'duplicate_capture',
  'capture_not_allowed',
  'capture_missing',
  'capture_conflict',
  'invalid_uuid',
  'out_of_range',
  'items_patterns_and_record',
  'items_shape_missing',
  'skip_lines_need_record',
  'record_name_missing',
  'items_single_conflict',
  'join_wrapped_needs_patterns',
  'invalid_value',
] as const;

const PROBLEM = new RegExp(
  `(\\(definition\\)|[A-Za-z][A-Za-z.]*(?:\\[\\d+\\])?(?:\\.[A-Za-z]+(?:\\[\\d+\\])?)*): (${PARSER_VALIDATION_CODES.join('|')})\\b`,
  'g',
);

/**
 * The `path: code` problems in a 400's message ("The parser definition is not
 * valid: total[0]: capture_missing; ..."). The 400 carries them only inside its
 * text, in the server's language, so the codes are matched against the known
 * list rather than by splitting on the prose around them. Empty when the
 * message lists none (a payee or category refusal, say): the caller then shows
 * the message as it is.
 */
export function parseValidationProblems(message: string): ReceiptParserValidationError[] {
  return [...message.matchAll(PROBLEM)].map((match) => ({
    path: match[1] === '(definition)' ? '' : match[1],
    code: match[2],
  }));
}
