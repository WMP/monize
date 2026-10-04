import type { GlobCaptures } from "../../transaction-rules/rule-glob-capture";
import {
  isStrictReceiptAmount,
  parseReceiptAmount,
  parseReceiptQty,
} from "./receipt-amount";
import { matchReceiptPattern } from "./receipt-glob";
import {
  itemSectionRange,
  normalizeLine,
  normalizeReceiptLines,
  traceLine,
  traceSubject,
} from "./receipt-lines";
import {
  DEFAULT_LABEL_WITHIN,
  MAX_ITEMS,
  MAX_JOINED_LINES,
  MAX_LABEL_WITHIN,
  MIN_LABEL_WITHIN,
  ParsedReceipt,
  ParsedReceiptItem,
  ParsedReceiptReason,
  ReceiptBlockItemsDefinition,
  ReceiptFieldEntry,
  ReceiptItemsDefinition,
  ReceiptLabelledPattern,
  ReceiptParserDefinition,
  ReceiptRecordStep,
  ReceiptSingleItemsDefinition,
  ReceiptTrace,
  ReceiptTraceHit,
  ReceiptTraceItem,
} from "./receipt-parser.types";

/**
 * The receipt parser (design 5): one definition, the subject and the text of
 * one email in, what the email says out. Pure: no database, no clock, no
 * regular expression over email text (every pattern is a rule glob matched
 * against one line at a time), and integer arithmetic only (amounts are
 * 1/10000 units).
 *
 * - PRIORITY BY ORDER: a field's entries are tried in array order, each over
 *   the whole email, so `total: [specific, general]` prefers the specific one
 *   wherever it sits.
 * - LABELLED FIELDS: `{label, value, within}` finds a line matching `label`
 *   and reads the value from one of the next `within` lines, for emails that
 *   put "TOTAL" on one line and the amount under it.
 * - ITEMS: one per line (`patterns`, optionally `joinWrapped`), a multi-line
 *   `record` read from a cursor, or one `single` item for the whole email.
 *
 * An amount is `isStrictReceiptAmount`: a line such as "3 × 1,47 zł" is not
 * read as 31,47. Every read also leaves a trace (which entry, which line) for
 * the `test` operation.
 */
export { normalizeReceiptLines } from "./receipt-lines";

// ---------------------------------------------------------------- fields

const isLabelled = (entry: unknown): entry is ReceiptLabelledPattern =>
  typeof entry === "object" &&
  entry !== null &&
  typeof (entry as ReceiptLabelledPattern).label === "string" &&
  typeof (entry as ReceiptLabelledPattern).value === "string";

/** The `within` of a labelled entry: an integer from 1 to 10, else the default of 3. */
function lookahead(entry: ReceiptLabelledPattern): number {
  const within = entry.within;
  return typeof within === "number" &&
    Number.isInteger(within) &&
    within >= MIN_LABEL_WITHIN &&
    within <= MAX_LABEL_WITHIN
    ? within
    : DEFAULT_LABEL_WITHIN;
}

/** What an entry read: the captures, the line they came from and, for a labelled entry, its label line. */
interface Found {
  captures: GlobCaptures;
  line: number;
  labelLine?: number;
}

/**
 * A labelled entry: for each line matching `label`, the first of the next
 * `within` lines whose `value` matches and is accepted; none, then the next
 * line matching the label. A line's reading by `value` is cached, so however
 * many label lines look at it, each line is matched once.
 */
function findLabelled(
  entry: ReceiptLabelledPattern,
  lines: readonly string[],
  accept: (captures: GlobCaptures) => boolean,
): Found | null {
  const within = lookahead(entry);
  const read = new Map<number, GlobCaptures | null>();
  for (let at = 0; at < lines.length; at++) {
    if (matchReceiptPattern(entry.label, lines[at], () => true) === null) {
      continue;
    }
    const last = Math.min(lines.length - 1, at + within);
    for (let next = at + 1; next <= last; next++) {
      let captures = read.get(next);
      if (captures === undefined) {
        captures = matchReceiptPattern(entry.value, lines[next], accept);
        read.set(next, captures);
      }
      if (captures !== null) return { captures, line: next, labelLine: at };
    }
  }
  return null;
}

/** One entry over the whole email: a line pattern's first accepted line, or a labelled entry. */
function findEntry(
  entry: ReceiptFieldEntry,
  lines: readonly string[],
  accept: (captures: GlobCaptures) => boolean,
): Found | null {
  if (typeof entry === "string") {
    for (let i = 0; i < lines.length; i++) {
      const captures = matchReceiptPattern(entry, lines[i], accept);
      if (captures !== null) return { captures, line: i };
    }
    return null;
  }
  return isLabelled(entry) ? findLabelled(entry, lines, accept) : null;
}

function hitOf(
  entry: ReceiptFieldEntry,
  index: number,
  found: Found,
  lines: readonly string[],
): ReceiptTraceHit {
  if (typeof entry === "string") {
    return { entry: index, pattern: entry, line: traceLine(lines, found.line) };
  }
  return {
    entry: index,
    pattern: entry.value,
    label: entry.label,
    ...(found.labelLine === undefined
      ? {}
      : { labelLine: traceLine(lines, found.labelLine) }),
    line: traceLine(lines, found.line),
  };
}

/** The first entry, in array order, that reads something, with what read it. */
function findField(
  entries: readonly ReceiptFieldEntry[] | undefined,
  lines: readonly string[],
  accept: (captures: GlobCaptures) => boolean,
): { captures: GlobCaptures; hit: ReceiptTraceHit } | null {
  if (!Array.isArray(entries)) return null;
  for (let index = 0; index < entries.length; index++) {
    const found = findEntry(entries[index], lines, accept);
    if (found !== null) {
      return {
        captures: found.captures,
        hit: hitOf(entries[index], index, found, lines),
      };
    }
  }
  return null;
}

const hasStrictAmount = (captures: GlobCaptures): boolean =>
  captures.amount !== undefined && isStrictReceiptAmount(captures.amount);

const hasOrderId = (captures: GlobCaptures): boolean =>
  identifierToken(captures, "orderid") !== "";

const hasReference = (captures: GlobCaptures): boolean =>
  identifierToken(captures, "reference") !== "";

const hasPayee = (captures: GlobCaptures): boolean =>
  (captures.payee ?? "") !== "";

/**
 * An order number or a bank reference has no spaces: only the first
 * whitespace-delimited token of the capture is kept.
 */
const identifierToken = (
  captures: GlobCaptures,
  name: "orderid" | "reference",
): string => captures[name]?.trim().split(/\s+/)[0] ?? "";

interface Read<T> {
  value: T;
  hit: ReceiptTraceHit;
}

function readAmount(
  entries: readonly ReceiptFieldEntry[] | undefined,
  lines: readonly string[],
): Read<number> | null {
  const found = findField(entries, lines, hasStrictAmount);
  if (found === null) return null;
  const value = parseReceiptAmount(found.captures.amount);
  return value === null ? null : { value, hit: found.hit };
}

function readPayee(
  entries: readonly ReceiptFieldEntry[] | undefined,
  lines: readonly string[],
): Read<string> | null {
  const found = findField(entries, lines, hasPayee);
  return found === null
    ? null
    : { value: found.captures.payee, hit: found.hit };
}

/**
 * The first entry, in array order, that finds an identifier (an order id or a
 * bank reference: the same rules for both). A line pattern reads the subject
 * first, then each line; a labelled entry reads lines only (a subject is one
 * line, with nothing near it to be a label for).
 */
function readIdentifier(
  entries: readonly ReceiptFieldEntry[] | undefined,
  subject: string,
  lines: readonly string[],
  capture: "orderid" | "reference",
): Read<string> | null {
  if (!Array.isArray(entries)) return null;
  const accept = capture === "orderid" ? hasOrderId : hasReference;
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (typeof entry === "string") {
      const fromSubject = matchReceiptPattern(entry, subject, accept);
      if (fromSubject !== null) {
        return {
          value: identifierToken(fromSubject, capture),
          hit: { entry: index, pattern: entry, line: traceSubject(subject) },
        };
      }
    }
    const found = findEntry(entry, lines, accept);
    if (found !== null) {
      return {
        value: identifierToken(found.captures, capture),
        hit: hitOf(entry, index, found, lines),
      };
    }
  }
  return null;
}

/** The first glob (in list order) matching some line: for `requireLine`, `skipIfLine` and `waitIfLine`. */
function findGuard(
  globs: readonly string[] | undefined,
  lines: readonly string[],
): ReceiptTraceHit | null {
  if (!Array.isArray(globs)) return null;
  for (let entry = 0; entry < globs.length; entry++) {
    for (let i = 0; i < lines.length; i++) {
      if (matchReceiptPattern(globs[entry], lines[i], () => true) !== null) {
        return {
          entry,
          pattern: globs[entry],
          line: traceLine(lines, i),
        };
      }
    }
  }
  return null;
}

/** What `requireLine`, `skipIfLine` and `waitIfLine` found in an email. */
export interface ReceiptLineGuards {
  /** False when the definition has `requireLine` and no line matches one of its globs. */
  applies: boolean;
  requireLine: ReceiptTraceHit | null;
  skipIfLine: ReceiptTraceHit | null;
  waitIfLine: ReceiptTraceHit | null;
}

export function readLineGuards(
  def: ReceiptParserDefinition,
  lines: readonly string[],
): ReceiptLineGuards {
  const requireLine = findGuard(def.requireLine, lines);
  return {
    applies:
      !Array.isArray(def.requireLine) ||
      def.requireLine.length === 0 ||
      requireLine !== null,
    requireLine,
    skipIfLine: findGuard(def.skipIfLine, lines),
    waitIfLine: findGuard(def.waitIfLine, lines),
  };
}

/**
 * What the pipeline would do with an email under a parser: `read` it, or pass
 * over / set aside / hold it by a guard, or fail it because the parser reads the
 * HTML part (`source: "html"`) and the email has none (`no_html`).
 */
export type ReceiptOutcome =
  | "read"
  | "not_applicable"
  | "skip_line"
  | "wait_line"
  | "no_html";

/** `requireLine` unmet: another parser would be tried; else `skipIfLine`, then `waitIfLine`, else the email is read. */
export function receiptOutcome(guards: ReceiptLineGuards): ReceiptOutcome {
  if (!guards.applies) return "not_applicable";
  if (guards.skipIfLine !== null) return "skip_line";
  if (guards.waitIfLine !== null) return "wait_line";
  return "read";
}

// ----------------------------------------------------------------- items

/** Name, qty and line total in units from the captures of an item; the amount is null when none was captured. */
interface ItemFields {
  name: string;
  qty: number;
  amount: number | null;
}

/**
 * Name and qty from the captures of an item pattern or record, and the line
 * total: the `amount` capture, else the unit `price` times qty, else null (the
 * item then takes the email's total if it is the only item). Null when the
 * captures do not read at all.
 */
function readItemFields(captures: GlobCaptures): ItemFields | null {
  const name = captures.name?.trim() ?? "";
  if (name === "") return null;
  const qty = captures.qty === undefined ? 1 : parseReceiptQty(captures.qty);
  if (qty === null) return null;
  const money = captures.amount ?? captures.price;
  if (money === undefined) return { name, qty, amount: null };
  const units = parseReceiptAmount(money);
  if (units === null || !isStrictReceiptAmount(money)) return null;
  const amount = captures.amount === undefined ? units * qty : units;
  return Number.isSafeInteger(amount) ? { name, qty, amount } : null;
}

/** What an item looks like before its category is known. */
interface RawItem extends ItemFields {
  trace: ReceiptTraceItem;
}

/** One item line read by one pattern, or null when neither reading of the line is usable. */
function readLineItem(line: string, pattern: string): ItemFields | null {
  const captures = matchReceiptPattern(pattern, line, (c) => {
    const read = readItemFields(c);
    return read !== null && read.amount !== null;
  });
  return captures === null ? null : readItemFields(captures);
}

/**
 * One item per line: each line of the section is read by the first pattern
 * that reads it. With `joinWrapped`, a line no pattern reads is held (the last
 * three) and put in front of the next line, joined by a space, before the
 * patterns are tried on that; an emitted item clears what was held.
 */
function readPatternItems(
  items: ReceiptItemsDefinition,
  lines: readonly string[],
): RawItem[] {
  const { start, end } = itemSectionRange(
    lines,
    items.startAfter,
    items.stopAt,
  );
  const join = items.joinWrapped === true;
  const out: RawItem[] = [];
  let held: number[] = [];
  for (let at = start; at < end; at++) {
    const text = held.length
      ? `${held.map((index) => lines[index]).join(" ")} ${lines[at]}`
      : lines[at];
    let read: { item: ItemFields; pattern: string } | null = null;
    for (const pattern of items.patterns) {
      const item = readLineItem(text, pattern);
      if (item !== null) {
        read = { item, pattern };
        break;
      }
    }
    if (read !== null) {
      out.push({
        ...read.item,
        trace: {
          mode: "patterns",
          patterns: [read.pattern],
          lines: [...held, at].map((index) => traceLine(lines, index)),
        },
      });
      held = [];
      if (out.length >= MAX_ITEMS) break;
    } else if (join) {
      held.push(at);
      if (held.length > MAX_JOINED_LINES) held.shift();
    }
  }
  return out;
}

/** A step's reading of a line is usable only when every value it captured reads. */
const acceptStep = (captures: GlobCaptures): boolean => {
  if (captures.name !== undefined && captures.name.trim() === "") return false;
  for (const money of [captures.amount, captures.price]) {
    if (money !== undefined && !isStrictReceiptAmount(money)) return false;
  }
  return captures.qty === undefined || parseReceiptQty(captures.qty) !== null;
};

/** The globs of a record step: its `line`, or its alternatives in order. */
const stepGlobs = (step: ReceiptRecordStep): readonly string[] =>
  typeof step.line === "string" ? [step.line] : step.line;

/**
 * Read one record at `start` of the section's lines: each step consumes the
 * line under the cursor when one of its globs matches and the values read (the
 * alternatives in order, the first that reads wins); an optional step that does
 * not match consumes nothing, a required one fails the record. The captures of
 * all the steps are one item (a capture name belongs to one step).
 */
function readRecord(
  record: readonly ReceiptRecordStep[],
  section: readonly number[],
  lines: readonly string[],
  start: number,
): { item: RawItem; next: number } | null {
  const merged: Record<string, string> = Object.create(null);
  const used: number[] = [];
  const patterns: string[] = [];
  let at = start;
  for (const step of record) {
    let taken: { glob: string; captures: GlobCaptures } | null = null;
    if (at < section.length) {
      for (const glob of stepGlobs(step)) {
        const captures = matchReceiptPattern(
          glob,
          lines[section[at]],
          acceptStep,
        );
        if (captures !== null) {
          taken = { glob, captures };
          break;
        }
      }
    }
    if (taken === null) {
      if (step.optional === true) continue;
      return null;
    }
    for (const [name, value] of Object.entries(taken.captures)) {
      if (!(name in merged)) merged[name] = value;
    }
    patterns.push(taken.glob);
    used.push(section[at]);
    at++;
  }
  const fields = readItemFields(merged);
  if (fields === null) return null;
  return {
    item: {
      ...fields,
      trace: {
        mode: "record",
        patterns,
        lines: used.map((index) => traceLine(lines, index)),
      },
    },
    next: at,
  };
}

/** Block items: the section minus its `skipLines`, then a record read from a cursor. */
function readBlockItems(
  items: ReceiptBlockItemsDefinition,
  lines: readonly string[],
): RawItem[] {
  const skip = items.skipLines ?? [];
  const { start, end } = itemSectionRange(
    lines,
    items.startAfter,
    items.stopAt,
  );
  const section: number[] = [];
  for (let at = start; at < end; at++) {
    const dropped = skip.some(
      (glob) => matchReceiptPattern(glob, lines[at], () => true) !== null,
    );
    if (!dropped) section.push(at);
  }
  const out: RawItem[] = [];
  let cursor = 0;
  while (cursor < section.length && out.length < MAX_ITEMS) {
    const read = readRecord(items.record, section, lines, cursor);
    if (read === null) {
      // A failed record moves the cursor one line, so the next product is found.
      cursor += 1;
      continue;
    }
    out.push(read.item);
    cursor = Math.max(read.next, cursor + 1);
  }
  return out;
}

/** One item for the whole email: its name from the first section line the glob reads; its amount comes later. */
function readSingleItem(
  items: ReceiptSingleItemsDefinition,
  lines: readonly string[],
): RawItem[] {
  const { start, end } = itemSectionRange(
    lines,
    items.startAfter,
    items.stopAt,
  );
  const glob = items.single?.name;
  if (typeof glob !== "string") return [];
  for (let at = start; at < end; at++) {
    const captures = matchReceiptPattern(
      glob,
      lines[at],
      (c) => (c.name ?? "") !== "",
    );
    if (captures !== null) {
      return [
        {
          name: captures.name,
          qty: 1,
          amount: null,
          trace: {
            mode: "single",
            patterns: [glob],
            lines: [traceLine(lines, at)],
          },
        },
      ];
    }
  }
  return [];
}

function readItems(
  def: ReceiptParserDefinition,
  lines: readonly string[],
): RawItem[] {
  const items = def.items;
  if (!items) return [];
  if ("record" in items) return readBlockItems(items, lines);
  if ("single" in items) return readSingleItem(items, lines);
  return readPatternItems(items, lines);
}

// ------------------------------------------------------------ categories

interface CategoryContext {
  payee: string | null;
  lines: readonly string[];
  /** Whether some line matches rule `i` (computed once per rule, for the "line" field). */
  lineMatches: Map<number, boolean>;
}

const matchesGlob = (glob: string, text: string): boolean =>
  matchReceiptPattern(glob, text, () => true) !== null;

/**
 * The category of an item: the first rule, in order, that covers it (its name
 * matches a `field: "item"` rule; the parsed payee matches a `payee` rule; any
 * line matches a `line` rule), else the default, else the payee's default, else
 * none.
 */
function itemCategory(
  def: ReceiptParserDefinition,
  name: string,
  fallbackCategoryId: string | null,
  ctx: CategoryContext,
): string | null {
  const rules = def.categoryRules ?? [];
  for (let index = 0; index < rules.length; index++) {
    const rule = rules[index];
    const field = rule.field ?? "item";
    let covers: boolean;
    if (field === "payee") {
      covers = ctx.payee !== null && matchesGlob(rule.match, ctx.payee);
    } else if (field === "line") {
      let known = ctx.lineMatches.get(index);
      if (known === undefined) {
        known = ctx.lines.some((line) => matchesGlob(rule.match, line));
        ctx.lineMatches.set(index, known);
      }
      covers = known;
    } else {
      covers = matchesGlob(rule.match, name);
    }
    if (covers) return rule.categoryId;
  }
  return def.defaultCategoryId ?? fallbackCategoryId;
}

// ---------------------------------------------------------- completeness

/**
 * The first thing missing, in the order of the spec's completeness table
 * (section 4); null when the receipt is complete. The one truth table: a
 * receipt read by the AI is judged by this function too.
 *
 * `gross` is the items plus shipping and `net` is `gross` minus the discount
 * (a missing discount is 0). One of `total` and `paid` must be stated; `paid`,
 * when stated, equals `net`; `total`, when stated, equals `gross` or `net`.
 * `itemsUnresolved` is true when an item has no amount and cannot take the
 * email's total.
 */
export function completeness(
  parsed: Omit<ParsedReceipt, "complete" | "reason" | "source">,
  itemsUnresolved = false,
): ParsedReceiptReason | null {
  const { total, items, shipping, discount } = parsed;
  const paid = parsed.paid ?? null;
  if (total === null && paid === null) return "no_total";
  if (itemsUnresolved) return "item_amount_missing";
  if (items.length === 0) return "no_items";
  const gross =
    items.reduce((sum, item) => sum + item.amount, 0) + (shipping ?? 0);
  const net = gross - (discount ?? 0);
  if (
    net < 0 ||
    (paid !== null && paid !== net) ||
    (total !== null && total !== gross && total !== net)
  ) {
    return "items_unbalanced";
  }
  const discountUncategorized =
    (discount ?? 0) > 0 && parsed.discountCategoryId === null;
  if (items.some((item) => item.categoryId === null) || discountUncategorized) {
    return "items_uncategorized";
  }
  if ((shipping ?? 0) > 0 && parsed.shippingCategoryId === null) {
    return "shipping_uncategorized";
  }
  return null;
}

// ---------------------------------------------------------------- reading

export interface TracedReceipt {
  parsed: ParsedReceipt;
  trace: ReceiptTrace;
  /** What the pipeline would do with this email: read it, or pass over / set aside / hold it by a guard. */
  outcome: ReceiptOutcome;
}

/**
 * Read one email, given as the lines of the source the definition names
 * (`def.source`: the text, or the HTML part; `pipeline/receipt-source-lines.ts`
 * chooses them), with a parser definition and say what read each value.
 * `lines` is null when the definition reads the HTML part and the email has
 * none: nothing is read and the outcome is `no_html`.
 * `fallbackCategoryId` is the parser payee's default category, used for an
 * item no rule categorises and no `defaultCategoryId` covers.
 *
 * The shipping line is categorised by `shippingCategoryId` alone, the discount
 * line by `defaultCategoryId` (else the fallback): a parser must say where
 * shipping goes before the receipt counts as complete.
 */
export function parseReceiptLinesTraced(
  def: ReceiptParserDefinition,
  subject: string,
  sourceLines: readonly string[] | null,
  fallbackCategoryId: string | null,
): TracedReceipt {
  const lines = sourceLines ?? [];
  const subjectLine = typeof subject === "string" ? normalizeLine(subject) : "";
  const orderId = readIdentifier(def.orderId, subjectLine, lines, "orderid");
  const reference = readIdentifier(
    def.reference,
    subjectLine,
    lines,
    "reference",
  );
  const total = readAmount(def.total, lines);
  const paid = readAmount(def.paid, lines);
  const shipping = readAmount(def.shipping, lines);
  const discount = readAmount(def.discount, lines);
  const payee = readPayee(def.payee, lines);
  const guards = readLineGuards(def, lines);

  // An item with no amount of its own takes the email's total (else what was
  // paid), but only when it is the only item; any other is unresolved.
  const raw = readItems(def, lines);
  const wholeAmount = total?.value ?? paid?.value ?? null;
  const resolved = raw.map((item) =>
    item.amount === null && raw.length === 1 && wholeAmount !== null
      ? { ...item, amount: wholeAmount }
      : item,
  );
  const kept = resolved.filter(
    (item): item is RawItem & { amount: number } => item.amount !== null,
  );
  const itemsUnresolved = kept.length !== resolved.length;

  const ctx: CategoryContext = {
    payee: payee?.value ?? null,
    lines,
    lineMatches: new Map(),
  };
  const items: ParsedReceiptItem[] = kept.map((item) => ({
    name: item.name,
    qty: item.qty,
    amount: item.amount,
    categoryId: itemCategory(def, item.name, fallbackCategoryId, ctx),
  }));
  const parsed = {
    orderId: orderId?.value ?? null,
    reference: reference?.value ?? null,
    total: total?.value ?? null,
    paid: paid?.value ?? null,
    payee: payee?.value ?? null,
    shipping: shipping?.value ?? null,
    discount: discount?.value ?? null,
    items,
    shippingCategoryId: def.shippingCategoryId ?? null,
    discountCategoryId: def.defaultCategoryId ?? fallbackCategoryId,
  };
  const reason = completeness(parsed, itemsUnresolved);
  const trace: ReceiptTrace = {
    orderId: orderId?.hit ?? null,
    reference: reference?.hit ?? null,
    total: total?.hit ?? null,
    paid: paid?.hit ?? null,
    shipping: shipping?.hit ?? null,
    discount: discount?.hit ?? null,
    payee: payee?.hit ?? null,
    requireLine: guards.requireLine,
    skipIfLine: guards.skipIfLine,
    waitIfLine: guards.waitIfLine,
    items: kept.map((item) => item.trace),
  };
  return {
    parsed: { ...parsed, complete: reason === null, reason },
    trace,
    outcome: sourceLines === null ? "no_html" : receiptOutcome(guards),
  };
}

/**
 * Read an email's TEXT with a definition, whatever `def.source` says: the
 * text-source reading, kept for the callers (and specs) that hold only a text.
 * The pipeline, the `test` operation and the AI tool choose the lines by the
 * definition's source and call `parseReceiptLinesTraced`.
 */
export function parseReceiptTraced(
  def: ReceiptParserDefinition,
  subject: string,
  bodyText: string,
  fallbackCategoryId: string | null,
): TracedReceipt {
  return parseReceiptLinesTraced(
    def,
    subject,
    normalizeReceiptLines(bodyText),
    fallbackCategoryId,
  );
}

/** Read one email's text with a parser definition (see `parseReceiptTraced`). */
export function parseReceipt(
  def: ReceiptParserDefinition,
  subject: string,
  bodyText: string,
  fallbackCategoryId: string | null,
): ParsedReceipt {
  return parseReceiptTraced(def, subject, bodyText, fallbackCategoryId).parsed;
}

/** Read one email, given as the lines of the definition's source, without the trace (see `parseReceiptLinesTraced`). */
export function parseReceiptLines(
  def: ReceiptParserDefinition,
  subject: string,
  sourceLines: readonly string[] | null,
  fallbackCategoryId: string | null,
): ParsedReceipt {
  return parseReceiptLinesTraced(def, subject, sourceLines, fallbackCategoryId)
    .parsed;
}
