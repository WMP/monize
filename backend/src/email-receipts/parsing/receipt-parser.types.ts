/**
 * The types of the email-receipt parser (design 5). Pure data: no behaviour,
 * no database, no clock. Every amount a parser reads is a non-negative
 * integer in 1/10000 units (spec section 1), the unit rule facts use.
 */

/**
 * The only definition version this code reads or writes. Version 1 (one line
 * pattern per field, first matching line wins) was replaced by this one before
 * any parser used it: a stored version 1 definition is invalid and is saved
 * again, never read with another rule.
 */
export const RECEIPT_PARSER_VERSION = 2;

/** Design 5.2: bounds the validator enforces and the parser relies on. */
export const MAX_PATTERNS_PER_FIELD = 10;
export const MAX_PATTERN_LENGTH = 200;
export const MAX_CATEGORY_RULES = 50;
export const MAX_SECTION_MARKER_LENGTH = 100;
/** Parsing reads at most this many lines of an email. */
export const MAX_PARSE_LINES = 2000;
/** Parsing keeps at most this many line items. */
export const MAX_ITEMS = 100;
/** A line is cut to this many characters (the glob matcher's own bound). */
export const MAX_LINE_LENGTH = 500;
/** The lines a labelled field looks at after its label (bounds and default). */
export const MIN_LABEL_WITHIN = 1;
export const MAX_LABEL_WITHIN = 10;
export const DEFAULT_LABEL_WITHIN = 3;
/** Lines a block item section drops, and steps of one record. */
export const MAX_SKIP_LINES = 10;
export const MAX_RECORD_STEPS = 6;
/** Alternative globs one record step may list. */
export const MAX_STEP_ALTERNATIVES = 5;
/** Globs one of `requireLine`, `skipIfLine` and `waitIfLine` may list. */
export const MAX_LINE_GUARDS = 10;
/** Lines a `joinWrapped` item section holds back for the next line. */
export const MAX_JOINED_LINES = 3;
/** A traced line is cut to this many characters. */
export const MAX_TRACE_LINE_LENGTH = 200;
/** The longest tag a profile may add to the transactions it splits. */
export const MAX_PROFILE_TAG_LENGTH = 50;

/** The item section and the patterns that read one line item per line. */
export interface ReceiptItemsDefinition {
  /** Case-insensitive substring: items start on the line AFTER the first line holding it. */
  startAfter?: string;
  /** Case-insensitive substring: items end BEFORE the first line holding it after the start. */
  stopAt?: string;
  patterns: string[];
  /** A line no pattern reads is held (up to 3) and put in front of the next line. */
  joinWrapped?: boolean;
}

/**
 * A category for every item the rule covers: `field` "item" (the default) when
 * the glob matches the item's name, "payee" when it matches the parsed payee,
 * "line" when it matches any line of the email (the last two cover every item).
 */
export interface ReceiptCategoryRule {
  match: string;
  categoryId: string;
  field?: ReceiptCategoryRuleField;
}

/**
 * A field entry that finds its value NEAR a label line. `label` is a
 * capture-free glob matched against a whole line; `value` is the field's own
 * pattern, tried on each of the next `within` lines (default 3).
 */
export interface ReceiptLabelledPattern {
  label: string;
  value: string;
  within?: number;
}

/** A field entry is a line pattern or a labelled one. */
export type ReceiptFieldEntry = string | ReceiptLabelledPattern;

/**
 * One line of a record. `line` is a glob, or a list of alternative globs tried
 * in order (the first that matches and reads wins). An optional step that does
 * not match consumes nothing.
 */
export interface ReceiptRecordStep {
  line: string | string[];
  optional?: boolean;
}

/** One item for the whole email: its name from the first line the glob matches. */
export interface ReceiptSingleItemDefinition {
  name: string;
}

/**
 * Items that span several lines. `skipLines` globs drop lines from
 * the section first; then `record` is read from a cursor, one item per match.
 */
export interface ReceiptBlockItemsDefinition {
  startAfter?: string;
  stopAt?: string;
  skipLines?: string[];
  record: ReceiptRecordStep[];
}

/** One item that carries the whole amount (a payment gateway's one-line notice). */
export interface ReceiptSingleItemsDefinition {
  startAfter?: string;
  stopAt?: string;
  single: ReceiptSingleItemDefinition;
}

/** Where a category rule looks: the item's name, the parsed payee, or any line of the email. */
export type ReceiptCategoryRuleField = "item" | "payee" | "line";

/**
 * Which rendering of the email a parser reads its lines from: the stored text
 * (`"text"`, the default) or the lines of the HTML part (`"html"`, one line per
 * block element and per table cell; `imap/html-lines.util.ts`). Every pattern,
 * guard and trace line number refers to the chosen source.
 */
export type ReceiptLinesSource = "text" | "html";
export const RECEIPT_LINES_SOURCES: readonly ReceiptLinesSource[] = [
  "text",
  "html",
];

/**
 * How a profile identifies the bank transaction an email paid for, in the order
 * the profile lists them (design 5.5, spec 3a): `reference` and `orderId` look
 * for the parsed value in the transaction's text, `amount_payee` is an amount
 * within the tolerance plus a payee signal, `amount_date` an amount within the
 * tolerance inside the date window.
 */
export type ReceiptMatchStrategy =
  | "reference"
  | "orderId"
  | "amount_payee"
  | "amount_date";
export const RECEIPT_MATCH_STRATEGIES: readonly ReceiptMatchStrategy[] = [
  "reference",
  "orderId",
  "amount_payee",
  "amount_date",
];

/** The transaction fields a `reference` or `orderId` strategy looks in. */
export type ReceiptMatchTextField = "description" | "payee" | "referenceNumber";
export const RECEIPT_MATCH_TEXT_FIELDS: readonly ReceiptMatchTextField[] = [
  "description",
  "payee",
  "referenceNumber",
];

/**
 * The `match` section of a profile: every key is optional and the defaults
 * reproduce the matching a profile without the section had (spec 3a).
 * `amountTolerance` is a decimal string (`"0.00"` to `"5.00"`) because it is
 * money: it is compared in 1/10000 units, never as a float.
 */
export interface ReceiptMatchDefinition {
  by?: ReceiptMatchStrategy[];
  referenceIn?: ReceiptMatchTextField[];
  daysBefore?: number;
  daysAfter?: number;
  amountTolerance?: string;
}

/**
 * A per-merchant parser (the `definition` jsonb of `email_receipt_parsers`).
 * A field's entries are tried in array order; an entry is a line pattern or a
 * labelled `{label, value, within}`; items are one per line (`patterns`) or a
 * multi-line `record`.
 */
export interface ReceiptParserDefinition {
  version: 2;
  /** The lines the parser reads: the email's text (default) or its HTML part. */
  source?: ReceiptLinesSource;
  orderId?: ReceiptFieldEntry[];
  total?: ReceiptFieldEntry[];
  /** The amount actually paid (after a discount); `total` is then the list price. */
  paid?: ReceiptFieldEntry[];
  shipping?: ReceiptFieldEntry[];
  discount?: ReceiptFieldEntry[];
  /** The merchant, when it is not the sender (a payment gateway). Capture `{payee}`. */
  payee?: ReceiptFieldEntry[];
  /**
   * An identifier the shop or the payment gateway puts into the bank operation
   * (the card statement line, a transfer title). Capture `{reference}`; the
   * `reference` match strategy looks for it in the transaction's text.
   */
  reference?: ReceiptFieldEntry[];
  /** How the transaction this email paid for is identified (design 5.5). */
  match?: ReceiptMatchDefinition;
  /**
   * A tag the proposal adds to every transaction this profile splits (created
   * when missing, at confirm time). 1 to 50 characters, trimmed.
   */
  tag?: string;
  /**
   * Ask the user's AI for the category of an item no rule categorised, when it
   * can answer now; otherwise queue the request for an agent (design 5.6).
   */
  aiCategories?: boolean;
  items?:
    | ReceiptItemsDefinition
    | ReceiptBlockItemsDefinition
    | ReceiptSingleItemsDefinition;
  categoryRules?: ReceiptCategoryRule[];
  defaultCategoryId?: string;
  shippingCategoryId?: string;
  /** The parser applies only when a line matches one of these; else the next parser for the domain. */
  requireLine?: string[];
  /** A line matching one of these makes the receipt `ignored` (`skip_line`). */
  skipIfLine?: string[];
  /** A line matching one of these leaves the receipt `unmatched` (`wait_line`) for a later re-read. */
  waitIfLine?: string[];
}

/** One line item as read from the email. */
export interface ParsedReceiptItem {
  name: string;
  qty: number;
  /** The line total, in 1/10000 units. */
  amount: number;
  categoryId: string | null;
  /**
   * `"ai"` when the AI chose this item's category (design 5.6); absent when a
   * rule, the default or the payee did. The card and the receipt page label it.
   */
  categorySource?: "ai";
}

/** The first thing missing from a receipt that is not complete (spec section 4). */
export type ParsedReceiptReason =
  | "no_total"
  | "no_items"
  | "item_amount_missing"
  | "items_unbalanced"
  | "items_uncategorized"
  | "shipping_uncategorized";

/**
 * What a parser read from one email. Amounts are 1/10000 units. `total`,
 * `shipping` and `discount` are null when the email did not state them.
 *
 * `shippingCategoryId` and `discountCategoryId` are the categories the
 * proposal gives the shipping and discount lines; they are resolved here, from
 * the definition, so the proposal builder needs no definition.
 */
export interface ParsedReceipt {
  orderId: string | null;
  total: number | null;
  /** What was actually paid; null when the email did not state it (and on a receipt stored before it existed). */
  paid: number | null;
  /** The merchant the email names; null when it names none. */
  payee: string | null;
  /**
   * The identifier the profile's `reference` field read (what the shop put into
   * the bank operation); null or absent when none (and on a receipt stored
   * before it existed).
   */
  reference?: string | null;
  shipping: number | null;
  discount: number | null;
  items: ParsedReceiptItem[];
  shippingCategoryId: string | null;
  discountCategoryId: string | null;
  complete: boolean;
  reason: ParsedReceiptReason | null;
  /**
   * Who read the email: a saved parser (absent, as every receipt stored before
   * this field existed), the AI (`"ai"`, spec "AI extraction") or the email's
   * own structured data (`"schema_org"`, spec "Structured data"). It changes
   * nothing about the completeness rules or the proposal; it tells the reader
   * where the figures came from.
   */
  source?: "parser" | "ai" | "schema_org";
}

/** A line a trace points at: its 1-based number among the email's lines (0 is the subject) and its text. */
export interface ReceiptTraceLine {
  line: number;
  text: string;
}

/** What found one value: the entry of the field, its glob and the line that produced it. */
export interface ReceiptTraceHit {
  /** Index in the field's list (a guard's list too). */
  entry: number;
  /** The line glob; for a labelled entry, its `value` glob. */
  pattern: string;
  /** A labelled entry's `label` glob and the line it matched. */
  label?: string;
  labelLine?: ReceiptTraceLine;
  /** The line the value was read from. */
  line: ReceiptTraceLine;
}

/** What read one item: the glob(s) and the line(s) that produced it. */
export interface ReceiptTraceItem {
  mode: "patterns" | "record" | "single";
  /** The item's glob (patterns, single) or one per consumed step (record). */
  patterns: string[];
  /** The lines the item was read from (a joined item lists each of them). */
  lines: ReceiptTraceLine[];
}

/** Why a parser read what it read: for the `test` operation and the editor's test panel. */
export interface ReceiptTrace {
  orderId: ReceiptTraceHit | null;
  reference: ReceiptTraceHit | null;
  total: ReceiptTraceHit | null;
  paid: ReceiptTraceHit | null;
  shipping: ReceiptTraceHit | null;
  discount: ReceiptTraceHit | null;
  payee: ReceiptTraceHit | null;
  requireLine: ReceiptTraceHit | null;
  skipIfLine: ReceiptTraceHit | null;
  waitIfLine: ReceiptTraceHit | null;
  items: ReceiptTraceItem[];
}
