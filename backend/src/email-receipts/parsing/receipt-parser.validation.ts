import { UUID_REGEX } from "../../common/query-param-utils";
import {
  MAX_CAPTURES_PER_PATTERN,
  parseGlob,
} from "../../transaction-rules/rule-glob-capture";
import {
  MAX_CATEGORY_RULES,
  MAX_LABEL_WITHIN,
  MAX_LINE_GUARDS,
  MAX_PATTERN_LENGTH,
  MAX_PATTERNS_PER_FIELD,
  MAX_RECORD_STEPS,
  MAX_SECTION_MARKER_LENGTH,
  MAX_SKIP_LINES,
  MAX_STEP_ALTERNATIVES,
  MIN_LABEL_WITHIN,
  RECEIPT_LINES_SOURCES,
  RECEIPT_PARSER_VERSION,
  ReceiptBlockItemsDefinition,
  ReceiptCategoryRule,
  ReceiptCategoryRuleField,
  ReceiptFieldEntry,
  ReceiptItemsDefinition,
  ReceiptLabelledPattern,
  ReceiptLinesSource,
  ReceiptParserDefinition,
  ReceiptRecordStep,
  ReceiptSingleItemsDefinition,
} from "./receipt-parser.types";

/**
 * The one validator of a receipt parser definition (design 5.2 and 5.4). The
 * form, the API and the AI draft all pass through it, so a stored definition has the
 * same shape whoever wrote it. Pure and total: it never throws, whatever it is
 * given, and reports every problem it finds (up to a cap) as a path and a
 * machine-readable code. Ownership of the category ids is not checked here;
 * `collectParserCategoryIds` lists them for the service that does.
 */

/** A validator result stays small however hostile the input is. */
const MAX_REPORTED_ERRORS = 50;

export interface ReceiptParserValidationError {
  /** Where the problem is, e.g. `items.patterns[1]` or `categoryRules[0].categoryId`. */
  path: string;
  /**
   * `not_object`, `unknown_key`, `unsupported_version`, `invalid_type`,
   * `empty`, `too_many`, `too_long`, `control_character`, `malformed_capture`,
   * `too_many_captures`, `duplicate_capture`, `capture_not_allowed`,
   * `capture_missing`, `capture_conflict`, `invalid_uuid`, `out_of_range`
   * (`within`), `items_patterns_and_record`, `items_shape_missing`,
   * `items_single_conflict`, `skip_lines_need_record`,
   * `join_wrapped_needs_patterns`, `record_name_missing`, `invalid_value` (a
   * category rule `field` or the top-level `source`).
   */
  code: string;
}

export type ReceiptParserValidation =
  | { ok: true; definition: ReceiptParserDefinition }
  | { ok: false; errors: ReceiptParserValidationError[] };

/** The capture names a pattern of each field may hold, and the ones it must hold. */
interface FieldCaptures {
  readonly allowed: readonly string[];
  readonly required: readonly string[];
}

const ORDER_ID_CAPTURES: FieldCaptures = {
  allowed: ["orderid"],
  required: ["orderid"],
};
const PAYEE_CAPTURES: FieldCaptures = {
  allowed: ["payee"],
  required: ["payee"],
};
const SINGLE_NAME_CAPTURES: FieldCaptures = {
  allowed: ["name"],
  required: ["name"],
};
const AMOUNT_CAPTURES: FieldCaptures = {
  allowed: ["amount"],
  required: ["amount"],
};
const ITEM_CAPTURES: FieldCaptures = {
  allowed: ["name", "amount", "price", "qty"],
  required: ["name"],
};

/** A record step may hold any item capture; the record as a whole must name and price the item. */
const RECORD_STEP_CAPTURES: FieldCaptures = {
  allowed: ITEM_CAPTURES.allowed,
  required: [],
};

const TOP_LEVEL_KEYS: readonly string[] = [
  "version",
  "source",
  "orderId",
  "total",
  "paid",
  "shipping",
  "discount",
  "payee",
  "items",
  "categoryRules",
  "defaultCategoryId",
  "shippingCategoryId",
  "requireLine",
  "skipIfLine",
  "waitIfLine",
];
const ITEMS_KEYS: readonly string[] = ["startAfter", "stopAt", "patterns"];
/** The keys of the multi-line item shape. */
const ITEMS_KEYS_OTHER: readonly string[] = [
  "skipLines",
  "record",
  "single",
  "joinWrapped",
];
const RULE_FIELDS: readonly ReceiptCategoryRuleField[] = [
  "item",
  "payee",
  "line",
];
const LABELLED_KEYS: readonly string[] = ["label", "value", "within"];
const RECORD_STEP_KEYS: readonly string[] = ["line", "optional"];
const NO_CAPTURES: FieldCaptures = { allowed: [], required: [] };
const CATEGORY_RULE_KEYS: readonly string[] = ["match", "categoryId", "field"];

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Collects errors up to the cap; a full collector ignores further reports. */
class Errors {
  readonly list: ReceiptParserValidationError[] = [];
  add(path: string, code: string): void {
    if (this.list.length < MAX_REPORTED_ERRORS) this.list.push({ path, code });
  }
}

function checkKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  prefix: string,
  errors: Errors,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.add(prefix + key, "unknown_key");
  }
}

function asArray(
  value: unknown,
  path: string,
  errors: Errors,
): unknown[] | null {
  if (!Array.isArray(value)) {
    errors.add(path, "invalid_type");
    return null;
  }
  if (value.length > MAX_PATTERNS_PER_FIELD) {
    errors.add(path, "too_many");
    return null;
  }
  return value;
}

function hasControlCharacter(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** A glob pattern for one field: bounded, well formed, with only the allowed captures. */
function checkPattern(
  value: unknown,
  path: string,
  captures: FieldCaptures,
  errors: Errors,
): boolean {
  if (typeof value !== "string") {
    errors.add(path, "invalid_type");
    return false;
  }
  if (value.trim() === "") {
    errors.add(path, "empty");
    return false;
  }
  if (value.length > MAX_PATTERN_LENGTH) {
    errors.add(path, "too_long");
    return false;
  }
  // A line never holds a line break or another control character.
  if (hasControlCharacter(value)) {
    errors.add(path, "control_character");
    return false;
  }
  const glob = parseGlob(value);
  const before = errors.list.length;
  if (glob.malformed.length > 0) errors.add(path, "malformed_capture");
  if (glob.captureNames.length > MAX_CAPTURES_PER_PATTERN) {
    errors.add(path, "too_many_captures");
  }
  const seen = new Set<string>();
  for (const name of glob.captureNames) {
    if (seen.has(name)) errors.add(path, "duplicate_capture");
    seen.add(name);
    if (!captures.allowed.includes(name)) {
      errors.add(path, "capture_not_allowed");
    }
  }
  for (const name of captures.required) {
    if (!seen.has(name)) errors.add(path, "capture_missing");
  }
  return errors.list.length === before;
}

/** A labelled entry: a capture-free `label`, the field's own `value`, and `within` (1 to 10). */
function checkLabelled(
  entry: Record<string, unknown>,
  path: string,
  captures: FieldCaptures,
  errors: Errors,
): ReceiptLabelledPattern | null {
  const before = errors.list.length;
  checkKeys(entry, LABELLED_KEYS, `${path}.`, errors);
  const label = checkPattern(entry.label, `${path}.label`, NO_CAPTURES, errors);
  const value = checkPattern(entry.value, `${path}.value`, captures, errors);
  let within: number | undefined;
  if (entry.within !== undefined) {
    if (typeof entry.within !== "number" || !Number.isInteger(entry.within)) {
      errors.add(`${path}.within`, "invalid_type");
    } else if (
      entry.within < MIN_LABEL_WITHIN ||
      entry.within > MAX_LABEL_WITHIN
    ) {
      errors.add(`${path}.within`, "out_of_range");
    } else {
      within = entry.within;
    }
  }
  if (!label || !value || errors.list.length > before) return null;
  const out: ReceiptLabelledPattern = {
    label: entry.label as string,
    value: entry.value as string,
  };
  if (within !== undefined) out.within = within;
  return out;
}

/**
 * A field's entry list: each entry a glob with the field's captures or, when
 * `labelled`, a `{label, value, within}` object. A list of plain globs (such
 * as `items.patterns`) refuses an object as `invalid_type`.
 */
function checkPatternList(
  value: unknown,
  path: string,
  captures: FieldCaptures,
  errors: Errors,
  minimum: number,
  labelled = true,
): ReceiptFieldEntry[] | null {
  const list = asArray(value, path, errors);
  if (list === null) return null;
  if (list.length < minimum) {
    errors.add(path, "empty");
    return null;
  }
  let valid = true;
  const out: ReceiptFieldEntry[] = [];
  list.forEach((entry, index) => {
    const entryPath = `${path}[${index}]`;
    if (labelled && isPlainObject(entry)) {
      const parsed = checkLabelled(entry, entryPath, captures, errors);
      if (parsed !== null) out.push(parsed);
      else valid = false;
    } else if (checkPattern(entry, entryPath, captures, errors)) {
      out.push(entry as string);
    } else {
      valid = false;
    }
  });
  return valid ? out : null;
}

/** An item pattern also needs `amount`, or `price` (optionally with `qty`), never both. */
function checkItemPriceCaptures(
  patterns: readonly string[],
  path: string,
  errors: Errors,
): void {
  patterns.forEach((pattern, index) => {
    const names = parseGlob(pattern).captureNames;
    const hasAmount = names.includes("amount");
    const hasPrice = names.includes("price");
    if (hasAmount && hasPrice) {
      errors.add(`${path}[${index}]`, "capture_conflict");
    } else if (!hasAmount && !hasPrice) {
      errors.add(`${path}[${index}]`, "capture_missing");
    }
  });
}

function checkMarker(
  value: unknown,
  path: string,
  errors: Errors,
): string | null {
  if (typeof value !== "string") {
    errors.add(path, "invalid_type");
    return null;
  }
  if (value.trim() === "") {
    errors.add(path, "empty");
    return null;
  }
  if (value.length > MAX_SECTION_MARKER_LENGTH) {
    errors.add(path, "too_long");
    return null;
  }
  return value;
}

function checkUuid(
  value: unknown,
  path: string,
  errors: Errors,
): string | null {
  if (typeof value !== "string") {
    errors.add(path, "invalid_type");
    return null;
  }
  if (!UUID_REGEX.test(value)) {
    errors.add(path, "invalid_uuid");
    return null;
  }
  return value;
}

/** A list of capture-free globs: `skipLines` (up to 10) and the line guards (up to 10). */
function checkGlobList(
  value: unknown,
  path: string,
  max: number,
  errors: Errors,
): string[] | null {
  if (!Array.isArray(value)) {
    errors.add(path, "invalid_type");
    return null;
  }
  if (value.length > max) {
    errors.add(path, "too_many");
    return null;
  }
  let valid = true;
  const out: string[] = [];
  value.forEach((entry, index) => {
    if (checkPattern(entry, `${path}[${index}]`, NO_CAPTURES, errors)) {
      out.push(entry as string);
    } else {
      valid = false;
    }
  });
  return valid ? out : null;
}

/**
 * The `line` of a record step: a glob, or 1 to 5 alternative globs tried in
 * order. The names an alternative captures are the step's; every alternative
 * holds each name once and `amount` and `price` never together.
 */
function checkStepLine(
  value: unknown,
  path: string,
  errors: Errors,
): { line: string | string[]; names: Set<string> } | null {
  const before = errors.list.length;
  const alternatives: unknown[] = Array.isArray(value) ? value : [value];
  if (Array.isArray(value)) {
    if (value.length === 0) {
      errors.add(path, "empty");
      return null;
    }
    if (value.length > MAX_STEP_ALTERNATIVES) {
      errors.add(path, "too_many");
      return null;
    }
  }
  const names = new Set<string>();
  alternatives.forEach((alternative, index) => {
    const at = Array.isArray(value) ? `${path}[${index}]` : path;
    if (!checkPattern(alternative, at, RECORD_STEP_CAPTURES, errors)) return;
    const found = parseGlob(alternative as string).captureNames;
    if (found.includes("amount") && found.includes("price")) {
      errors.add(at, "capture_conflict");
    }
    found.forEach((name) => names.add(name));
  });
  return errors.list.length === before
    ? { line: value as string | string[], names }
    : null;
}

/**
 * The `record` of block items: 1 to 6 steps, each a glob (or alternatives) over
 * one line with the item captures and an optional flag. Across the steps a
 * capture name belongs to one step, and the record names the item (`name`). An
 * item the record gives no amount or price takes the email's total when it is
 * the only item.
 */
function checkRecord(
  value: unknown,
  errors: Errors,
): ReceiptRecordStep[] | null {
  const path = "items.record";
  if (!Array.isArray(value)) {
    errors.add(path, "invalid_type");
    return null;
  }
  if (value.length === 0) {
    errors.add(path, "empty");
    return null;
  }
  if (value.length > MAX_RECORD_STEPS) {
    errors.add(path, "too_many");
    return null;
  }
  const before = errors.list.length;
  const out: ReceiptRecordStep[] = [];
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    const stepPath = `${path}[${index}]`;
    if (!isPlainObject(entry)) {
      errors.add(stepPath, "invalid_type");
      return;
    }
    checkKeys(entry, RECORD_STEP_KEYS, `${stepPath}.`, errors);
    const linePath = `${stepPath}.line`;
    const line = checkStepLine(entry.line, linePath, errors);
    if (entry.optional !== undefined && typeof entry.optional !== "boolean") {
      errors.add(`${stepPath}.optional`, "invalid_type");
    }
    if (line === null) return;
    if ([...line.names].some((name) => seen.has(name))) {
      errors.add(linePath, "duplicate_capture");
    }
    line.names.forEach((name) => seen.add(name));
    const step: ReceiptRecordStep = { line: line.line };
    if (typeof entry.optional === "boolean") step.optional = entry.optional;
    out.push(step);
  });
  if (errors.list.length > before) return null;
  if (!seen.has("name")) errors.add(path, "record_name_missing");
  return errors.list.length === before ? out : null;
}

/** The `single` of items: one item whose `name` glob captures `{name}`. */
function checkSingle(value: unknown, errors: Errors): { name: string } | null {
  if (!isPlainObject(value)) {
    errors.add("items.single", "invalid_type");
    return null;
  }
  const before = errors.list.length;
  checkKeys(value, ["name"], "items.single.", errors);
  checkPattern(value.name, "items.single.name", SINGLE_NAME_CAPTURES, errors);
  return errors.list.length === before ? { name: value.name as string } : null;
}

type ItemsDefinition =
  | ReceiptItemsDefinition
  | ReceiptBlockItemsDefinition
  | ReceiptSingleItemsDefinition;

/**
 * The item section: exactly one of `patterns` (one item per line, with
 * optional `joinWrapped`), `record` (items that span lines, with optional
 * `skipLines`) and `single` (one item for the whole email).
 */
function checkItems(value: unknown, errors: Errors): ItemsDefinition | null {
  if (!isPlainObject(value)) {
    errors.add("items", "invalid_type");
    return null;
  }
  const before = errors.list.length;
  checkKeys(value, [...ITEMS_KEYS, ...ITEMS_KEYS_OTHER], "items.", errors);
  const markers: { startAfter?: string; stopAt?: string } = {};
  if (value.startAfter !== undefined) {
    const marker = checkMarker(value.startAfter, "items.startAfter", errors);
    if (marker !== null) markers.startAfter = marker;
  }
  if (value.stopAt !== undefined) {
    const marker = checkMarker(value.stopAt, "items.stopAt", errors);
    if (marker !== null) markers.stopAt = marker;
  }

  const hasPatterns = value.patterns !== undefined;
  const hasRecord = value.record !== undefined;
  const hasSingle = value.single !== undefined;
  if (hasPatterns && hasRecord && !hasSingle) {
    errors.add("items", "items_patterns_and_record");
    return null;
  }
  if ([hasPatterns, hasRecord, hasSingle].filter(Boolean).length > 1) {
    errors.add("items", "items_single_conflict");
    return null;
  }
  if (!hasPatterns && !hasRecord && !hasSingle) {
    errors.add("items", "items_shape_missing");
    return null;
  }
  if (value.joinWrapped !== undefined) {
    if (typeof value.joinWrapped !== "boolean") {
      errors.add("items.joinWrapped", "invalid_type");
    } else if (!hasPatterns) {
      errors.add("items.joinWrapped", "join_wrapped_needs_patterns");
    }
  }

  if (hasSingle) {
    if (value.skipLines !== undefined) {
      errors.add("items.skipLines", "skip_lines_need_record");
    }
    const single = checkSingle(value.single, errors);
    return errors.list.length === before && single !== null
      ? { ...markers, single }
      : null;
  }

  if (hasRecord) {
    const record = checkRecord(value.record, errors);
    let skipLines: string[] | undefined;
    if (value.skipLines !== undefined) {
      skipLines =
        checkGlobList(
          value.skipLines,
          "items.skipLines",
          MAX_SKIP_LINES,
          errors,
        ) ?? undefined;
    }
    if (errors.list.length > before || record === null) return null;
    return {
      ...markers,
      ...(skipLines !== undefined ? { skipLines } : {}),
      record,
    };
  }

  if (value.skipLines !== undefined) {
    errors.add("items.skipLines", "skip_lines_need_record");
  }
  const patterns = checkPatternList(
    value.patterns,
    "items.patterns",
    ITEM_CAPTURES,
    errors,
    1,
    false,
  );
  if (patterns !== null) {
    checkItemPriceCaptures(patterns as string[], "items.patterns", errors);
  }
  return errors.list.length === before && patterns !== null
    ? {
        ...markers,
        patterns: patterns as string[],
        ...(value.joinWrapped === true ? { joinWrapped: true } : {}),
      }
    : null;
}

function checkCategoryRules(
  value: unknown,
  errors: Errors,
): ReceiptCategoryRule[] | null {
  if (!Array.isArray(value)) {
    errors.add("categoryRules", "invalid_type");
    return null;
  }
  if (value.length > MAX_CATEGORY_RULES) {
    errors.add("categoryRules", "too_many");
    return null;
  }
  const before = errors.list.length;
  const out: ReceiptCategoryRule[] = [];
  value.forEach((entry, index) => {
    const path = `categoryRules[${index}]`;
    if (!isPlainObject(entry)) {
      errors.add(path, "invalid_type");
      return;
    }
    checkKeys(entry, CATEGORY_RULE_KEYS, `${path}.`, errors);
    // A category rule is a capture-less glob over an item name, the payee or a line.
    const noCaptures: FieldCaptures = { allowed: [], required: [] };
    const matchOk = checkPattern(
      entry.match,
      `${path}.match`,
      noCaptures,
      errors,
    );
    const categoryId = checkUuid(
      entry.categoryId,
      `${path}.categoryId`,
      errors,
    );
    let field: ReceiptCategoryRuleField | undefined;
    let fieldOk = true;
    if (entry.field !== undefined) {
      if (typeof entry.field !== "string") {
        errors.add(`${path}.field`, "invalid_type");
        fieldOk = false;
      } else if (
        !RULE_FIELDS.includes(entry.field as ReceiptCategoryRuleField)
      ) {
        errors.add(`${path}.field`, "invalid_value");
        fieldOk = false;
      } else {
        field = entry.field as ReceiptCategoryRuleField;
      }
    }
    if (matchOk && categoryId !== null && fieldOk) {
      out.push({
        match: entry.match as string,
        categoryId,
        ...(field === undefined ? {} : { field }),
      });
    }
  });
  return errors.list.length === before ? out : null;
}

/**
 * Validate an untrusted value as a receipt parser definition (version 2, the
 * only one). Refuses unknown keys at every level, wrong types, another
 * version (`unsupported_version`, version 1 included), bounds exceeded,
 * malformed or repeated captures, a capture name the field does not take, and
 * a category id that is not a UUID. On success the returned definition is a
 * fresh object holding only validated data.
 */
export function validateReceiptParserDefinition(
  input: unknown,
): ReceiptParserValidation {
  const errors = new Errors();
  if (!isPlainObject(input)) {
    errors.add("", "not_object");
    return { ok: false, errors: errors.list };
  }
  checkKeys(input, TOP_LEVEL_KEYS, "", errors);
  if (input.version !== RECEIPT_PARSER_VERSION) {
    errors.add("version", "unsupported_version");
  }

  const out: Record<string, unknown> = { version: RECEIPT_PARSER_VERSION };
  if (input.source !== undefined) {
    // Anything that is not one of the two sources is the same refusal, whatever its type.
    if (RECEIPT_LINES_SOURCES.includes(input.source as ReceiptLinesSource)) {
      out.source = input.source;
    } else {
      errors.add("source", "invalid_value");
    }
  }
  const fields: [
    "orderId" | "total" | "paid" | "shipping" | "discount" | "payee",
    FieldCaptures,
  ][] = [
    ["orderId", ORDER_ID_CAPTURES],
    ["total", AMOUNT_CAPTURES],
    ["paid", AMOUNT_CAPTURES],
    ["shipping", AMOUNT_CAPTURES],
    ["discount", AMOUNT_CAPTURES],
    ["payee", PAYEE_CAPTURES],
  ];
  for (const [field, captures] of fields) {
    if (input[field] === undefined) continue;
    const patterns = checkPatternList(input[field], field, captures, errors, 0);
    if (patterns !== null) out[field] = patterns;
  }
  if (input.items !== undefined) {
    const items = checkItems(input.items, errors);
    if (items !== null) out.items = items;
  }
  if (input.categoryRules !== undefined) {
    const rules = checkCategoryRules(input.categoryRules, errors);
    if (rules !== null) out.categoryRules = rules;
  }
  for (const field of ["requireLine", "skipIfLine", "waitIfLine"] as const) {
    if (input[field] === undefined) continue;
    const globs = checkGlobList(input[field], field, MAX_LINE_GUARDS, errors);
    if (globs !== null) out[field] = globs;
  }
  for (const field of ["defaultCategoryId", "shippingCategoryId"] as const) {
    if (input[field] === undefined) continue;
    const id = checkUuid(input[field], field, errors);
    if (id !== null) out[field] = id;
  }

  return errors.list.length > 0
    ? { ok: false, errors: errors.list }
    : { ok: true, definition: out as unknown as ReceiptParserDefinition };
}

/**
 * Every category id a definition refers to, each once, in first-seen order
 * (rules, then the default, then shipping). The service that saves a parser
 * checks in the write's transaction that the user owns each of them.
 */
export function collectParserCategoryIds(
  definition: ReceiptParserDefinition,
): string[] {
  const ids: string[] = [];
  for (const rule of definition.categoryRules ?? []) ids.push(rule.categoryId);
  if (definition.defaultCategoryId) ids.push(definition.defaultCategoryId);
  if (definition.shippingCategoryId) ids.push(definition.shippingCategoryId);
  return [...new Set(ids)];
}
