/**
 * Email receipts as the API answers them. Mirrors
 * `backend/src/email-receipts/` (mailbox view and DTOs, receipts view, parsers
 * view and DTOs, `parsing/receipt-parser.types.ts`). The value lists are
 * `as const` arrays with the unions derived from them, so a control can
 * enumerate what the type allows.
 *
 * Amounts inside a `ParsedReceipt` are integers in 1/10000 units (the parser
 * reads text, never floats); a transaction summary's `amount` is an ordinary
 * currency amount. `fromReceiptUnits` (`lib/email-receipts-format.ts`) is the
 * one conversion between the two.
 */

export const EMAIL_RECEIPT_MAILBOX_SECURITIES = ['tls', 'starttls'] as const;
export type EmailReceiptMailboxSecurity = (typeof EMAIL_RECEIPT_MAILBOX_SECURITIES)[number];

export const EMAIL_RECEIPT_AI_MODES = ['off', 'on_demand', 'automatic'] as const;
export type EmailReceiptAiMode = (typeof EMAIL_RECEIPT_AI_MODES)[number];

export const EMAIL_RECEIPT_AUTH_METHODS = ['password', 'oauth2'] as const;
export type EmailReceiptAuthMethod = (typeof EMAIL_RECEIPT_AUTH_METHODS)[number];

export const EMAIL_RECEIPT_OAUTH_PROVIDERS = ['google', 'microsoft'] as const;
export type EmailReceiptOAuthProvider = (typeof EMAIL_RECEIPT_OAUTH_PROVIDERS)[number];

export const EMAIL_RECEIPT_STATUSES = [
  'pending',
  'skipped',
  'no_parser',
  'parse_failed',
  'unmatched',
  'ambiguous',
  'review_conflict',
  'review',
  'ignored',
] as const;
export type EmailReceiptStatus = (typeof EMAIL_RECEIPT_STATUSES)[number];

/**
 * How an email was tied to its transaction: the profile strategy that found it
 * (`reference`, `order_id`, `amount_payee`, `amount_date`) or `manual`.
 * `amount_only` is what an email matched before the strategies were configurable
 * carries: it is shown, never produced.
 */
export const EMAIL_RECEIPT_MATCH_KINDS = [
  'order_id',
  'reference',
  'amount_payee',
  'amount_date',
  'amount_only',
  'manual',
] as const;
export type EmailReceiptMatchKind = (typeof EMAIL_RECEIPT_MATCH_KINDS)[number];

/** What a `review` receipt's request says about it; null for every other status. */
export const EMAIL_RECEIPT_DISPLAY_STATES = [
  'proposed',
  'applied',
  'dismissed',
  'expired',
  'pending_ai',
  'request_missing',
] as const;
export type EmailReceiptDisplayState = (typeof EMAIL_RECEIPT_DISPLAY_STATES)[number];

export const EMAIL_RECEIPT_PARSER_STATUSES = ['draft', 'approved'] as const;
export type EmailReceiptParserStatus = (typeof EMAIL_RECEIPT_PARSER_STATUSES)[number];

export const EMAIL_RECEIPT_PARSER_SOURCES = ['manual', 'ai'] as const;
export type EmailReceiptParserSource = (typeof EMAIL_RECEIPT_PARSER_SOURCES)[number];

/** Why a parse is not complete (`ParsedReceipt.reason`). */
export const PARSED_RECEIPT_REASONS = [
  'no_total',
  'no_items',
  'item_amount_missing',
  'items_unbalanced',
  'items_uncategorized',
  'shipping_uncategorized',
] as const;
export type ParsedReceiptReason = (typeof PARSED_RECEIPT_REASONS)[number];

// ---------------------------------------------------------------- mailbox

/** The user's mailbox. The password is never here: `passwordSet` says whether one is stored. */
export interface EmailReceiptMailbox {
  id: string;
  host: string;
  port: number;
  security: EmailReceiptMailboxSecurity;
  username: string;
  folder: string;
  enabled: boolean;
  aiMode: EmailReceiptAiMode;
  autoApply: boolean;
  /**
   * Whether a proposal a saved profile built counts toward the daily AI write
   * limit when it is confirmed. The user's own switch; an AI-built proposal always counts.
   */
  profileProposalsCountTowardAiLimit: boolean;
  passwordSet: boolean;
  encryptionConfigured: boolean;
  authMethod: EmailReceiptAuthMethod;
  oauthProvider: EmailReceiptOAuthProvider | null;
  oauthConnected: boolean;
  lastPolledAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** `PUT /email-receipts/mailbox`: the whole configuration. `password` only when typed. */
export interface UpsertEmailReceiptMailboxPayload {
  host: string;
  port: number;
  security: EmailReceiptMailboxSecurity;
  username: string;
  password?: string;
  folder?: string;
  enabled: boolean;
  aiMode: EmailReceiptAiMode;
  autoApply: boolean;
  /** Omit to keep the stored value. */
  profileProposalsCountTowardAiLimit?: boolean;
}

/** `PATCH /email-receipts/mailbox/settings`: the settings an OAuth mailbox has. */
export interface UpdateEmailReceiptMailboxSettingsPayload {
  folder?: string;
  enabled?: boolean;
  aiMode?: EmailReceiptAiMode;
  autoApply?: boolean;
  profileProposalsCountTowardAiLimit?: boolean;
}

/** `POST /email-receipts/mailbox/test`: a draft; a field left out is read from the stored mailbox. */
export interface TestEmailReceiptMailboxPayload {
  host?: string;
  port?: number;
  security?: EmailReceiptMailboxSecurity;
  username?: string;
  password?: string;
  folder?: string;
}

export type EmailReceiptMailboxTestResult =
  | { ok: true; messages: number }
  | { ok: false; error: string };

export interface EmailReceiptPollResult {
  ok: boolean;
  busy?: boolean;
  /** Emails stored by this poll. */
  fetched: number;
  /** Messages stored as skipped (too large or undecodable). */
  skipped: number;
  /** Stored emails the pipeline acted on. */
  processed: number;
  error?: string;
}

/** Which OAuth providers the operator configured, and the redirect URI to register. */
export interface EmailReceiptOAuthProviders {
  google: boolean;
  microsoft: boolean;
  redirectUri: string;
}

// --------------------------------------------------------------- receipts

export interface EmailReceiptTransactionSummary {
  id: string;
  /** YYYY-MM-DD. */
  date: string;
  amount: number;
  currencyCode: string;
  payeeName: string | null;
}

export interface EmailReceiptCandidateSummary extends EmailReceiptTransactionSummary {
  description: string | null;
}

/** One stored email in the list: never its text. */
export interface EmailReceiptListItem {
  id: string;
  fromAddress: string;
  fromDomain: string;
  subject: string;
  receivedAt: string;
  /**
   * The mailbox's own From when the email was a forward of an order
   * confirmation; `fromAddress`, `fromDomain` and `subject` are then the shop's.
   */
  forwardedBy: string | null;
  /** When the shop sent the order (a forward's original date), else null. ISO timestamp. */
  originalSentAt: string | null;
  /**
   * The day the match window is centred on: `originalSentAt` when known, else
   * `receivedAt`. The transaction picker's default range is built from this.
   */
  effectiveDate: string;
  status: EmailReceiptStatus;
  statusReason: string | null;
  matchKind: EmailReceiptMatchKind | null;
  parserId: string | null;
  parserName: string | null;
  aiReviewRequestId: string | null;
  displayState: EmailReceiptDisplayState | null;
  /** Why the request was closed without being applied, when it says. */
  requestNote: string | null;
  transaction: EmailReceiptTransactionSummary | null;
  createdAt: string;
}

/** One line of a schema.org order: the line total is the unit price times the quantity; either is `null` when the markup states none. */
export interface SchemaOrgOrderItem {
  name: string;
  qty: number;
  /** In 1/10000 units. */
  amount: number | null;
  /** In 1/10000 units. */
  unitPrice: number | null;
}

/** The schema.org `Order` or `Invoice` the email carries as markup (JSON-LD or microdata). Amounts are in 1/10000 units. */
export interface SchemaOrgOrder {
  orderNumber: string | null;
  seller: string | null;
  currency: string | null;
  orderDate: string | null;
  total: number | null;
  discount: number | null;
  items: SchemaOrgOrderItem[];
}

/** The lines a parser's patterns are matched against, per `source`; `html` is `null` when the email has no HTML part. */
export interface EmailReceiptLines {
  text: string[];
  html: string[] | null;
}

/** One sender domain of the user's stored emails with how many there are (`GET /email-receipts/domains`). */
export interface EmailReceiptDomainCount {
  domain: string;
  count: number;
  /**
   * How many of them "Process all" would run again (not yet read, or in a state
   * a new profile or transaction can change). Absent from a server that predates it.
   */
  processable?: number;
}

/** How many stored emails are in each state (`GET /email-receipts/status-counts`); a state with none may be absent. */
export type EmailReceiptStatusCounts = Partial<Record<EmailReceiptStatus, number>>;

/** The statuses "Process all" acts on: the pipeline can run them again; `review` stands behind a proposal a person decides. */
export const EMAIL_RECEIPT_PROCESSABLE_STATUSES = [
  'pending',
  'no_parser',
  'parse_failed',
  'unmatched',
  'ambiguous',
  'review_conflict',
] as const;
export type EmailReceiptProcessableStatus = (typeof EMAIL_RECEIPT_PROCESSABLE_STATUSES)[number];

/** `POST /email-receipts/process-batch`. */
export interface ProcessEmailReceiptsPayload {
  domain?: string;
  statuses?: readonly EmailReceiptProcessableStatus[];
  limit?: number;
  /** The `since` the previous call of the same run answered; omit on the first call. */
  since?: string;
}

/** What one call of "process in bulk" did and what is left of the run. */
export interface ProcessEmailReceiptsResult {
  processed: number;
  /** Where the processed emails ended, by their new status (a status with none is absent). */
  byOutcome: Partial<Record<EmailReceiptStatus, number>>;
  /** Emails that raised an error and were passed over. */
  failed: number;
  /** Matching emails this run has not touched yet; 0 ends the run. */
  remaining: number;
  /** Send back as `since` in the next call of the same run. */
  since: string;
}

/** `GET /email-receipts/overview`: what the hub's Overview cards show. */
export interface EmailReceiptsOverview {
  /** Null when the user has no mailbox yet. */
  mailbox: {
    enabled: boolean;
    authMethod: EmailReceiptAuthMethod;
    aiMode: EmailReceiptAiMode;
    /** False for an OAuth mailbox that was disconnected or revoked. */
    connected: boolean;
    lastPolledAt: string | null;
    lastSuccessAt: string | null;
    lastError: string | null;
    lastErrorAt: string | null;
  } | null;
  /** Stored emails by status; a status with none is absent. */
  emailsByStatus: Partial<Record<EmailReceiptStatus, number>>;
  /** Emails "Process all" would run. */
  processable: number;
  /** Proposals of the email-receipt kind waiting for approval. */
  proposalsToApprove: number;
  parsers: { approved: number; draft: number };
  /** Sender domains of emails no profile covers, most emails first (at most ten). */
  domainsWithoutProfile: Array<{ domain: string; count: number }>;
}

export interface EmailReceiptDetail extends EmailReceiptListItem {
  bodyText: string;
  /**
   * The HTML part as the sender wrote it, for a sandboxed frame that runs and
   * loads nothing (`EmailHtmlFrame`); `null` when the email has none. Never in the list.
   */
  bodyHtml: string | null;
  /**
   * The numbered lines each source gives (at most 2,000 each): exactly what a
   * parser's patterns match against. Only the detail carries them.
   */
  lines: EmailReceiptLines;
  /** The schema.org order found in the HTML part, or `null` when there is none. */
  structuredOrder: SchemaOrgOrder | null;
  /** The stored `ParsedReceipt`; read it through `readParsedReceipt`. */
  parsed: Record<string, unknown> | null;
  candidates: EmailReceiptCandidateSummary[];
}

/**
 * `POST /email-receipts/:id/ask-ai`: the request now waits, pending, in the AI
 * review inbox for whoever claims it by id (the assistant in the chat, or an
 * MCP agent). Nothing has answered it yet.
 */
export interface EmailReceiptAskAiResult {
  ok: true;
  requestId: string;
  transactionId: string;
}

/**
 * `POST /email-receipt-parsers/draft-with-ai`: the request now waits, pending,
 * in the AI review inbox for whoever claims it by id (the assistant in the
 * chat, or an MCP agent). No provider was called.
 */
export interface EmailReceiptParserDraftRequestResult {
  ok: true;
  requestId: string;
}

/** Most emails one "Draft parser with AI" request names (the server's bound). */
export const PARSER_DRAFT_MAX_RECEIPTS = 5;

// ---------------------------------------------------------------- parsers

/** Bounds the server's validator enforces (`receipt-parser.types.ts`), mirrored so the form says so first. */
export const RECEIPT_PARSER_LIMITS = {
  maxPatternsPerField: 10,
  maxPatternLength: 200,
  maxCategoryRules: 50,
  maxSectionMarkerLength: 100,
  maxSkipLines: 10,
  maxRecordSteps: 6,
  maxLabelWithin: 10,
  maxStepAlternatives: 5,
  maxLineGuards: 10,
  maxNameLength: 100,
  maxFromDomains: 10,
  maxSubjectWords: 10,
  maxSubjectWordLength: 100,
  maxTagLength: 50,
  maxMatchStrategies: 4,
  maxDaysBefore: 60,
  maxDaysAfter: 90,
  /** The largest amount tolerance, in whole currency units (`"5.00"`). */
  maxAmountTolerance: 5,
} as const;

/** The days of the window and the amount tolerance a profile that says nothing uses. */
export const DEFAULT_MATCH_DAYS_BEFORE = 3;
export const DEFAULT_MATCH_DAYS_AFTER = 14;

/** Items read one per line. */
export interface ReceiptItemsDefinition {
  startAfter?: string;
  stopAt?: string;
  patterns: string[];
  /** A line no pattern reads is held (the last three) and put in front of the next line. */
  joinWrapped?: boolean;
}

/** An entry of a field that finds its value on a line near a label line. */
export interface ReceiptLabelledPattern {
  label: string;
  value: string;
  within?: number;
}

/** A field entry: a line pattern or a labelled one. Entries are tried in array order. */
export type ReceiptFieldEntry = string | ReceiptLabelledPattern;

export interface ReceiptRecordStep {
  /** A glob, or up to five alternative globs tried in order. */
  line: string | string[];
  optional?: boolean;
}

/** Items that span several lines: lines to drop, then a record read from a cursor. */
export interface ReceiptBlockItemsDefinition {
  startAfter?: string;
  stopAt?: string;
  skipLines?: string[];
  record: ReceiptRecordStep[];
}

export interface ReceiptCategoryRule {
  match: string;
  categoryId: string;
  /** What the glob is matched against: the item's name (default), the parsed payee or any line. */
  field?: 'item' | 'payee' | 'line';
}

/** One item for the whole email: its name from the first line the glob reads. */
export interface ReceiptSingleItemsDefinition {
  startAfter?: string;
  stopAt?: string;
  single: { name: string };
}

/** How a profile identifies the bank transaction an email paid for, tried in the profile's order. */
export const RECEIPT_MATCH_STRATEGIES = ['reference', 'orderId', 'amount_payee', 'amount_date'] as const;
export type ReceiptMatchStrategy = (typeof RECEIPT_MATCH_STRATEGIES)[number];

/** The strategies tried when a profile names none: the matching a profile without a `match` section always had. */
export const DEFAULT_MATCH_BY: readonly ReceiptMatchStrategy[] = ['orderId', 'amount_payee', 'amount_date'];

/** The transaction fields `reference` and `orderId` are looked for in. */
export const RECEIPT_MATCH_TEXT_FIELDS = ['description', 'payee', 'referenceNumber'] as const;
export type ReceiptMatchTextField = (typeof RECEIPT_MATCH_TEXT_FIELDS)[number];

/** The `match` section of a profile; every key is optional. `amountTolerance` is a decimal string ("0.00" to "5.00"). */
export interface ReceiptMatchDefinition {
  by?: ReceiptMatchStrategy[];
  referenceIn?: ReceiptMatchTextField[];
  daysBefore?: number;
  daysAfter?: number;
  amountTolerance?: string;
}

/** Which lines a parser reads: the email's text (the default) or the lines of its HTML part. */
export const RECEIPT_LINES_SOURCES = ['text', 'html'] as const;
export type ReceiptLinesSource = (typeof RECEIPT_LINES_SOURCES)[number];

/** A parser definition, version 2 (`definition` of an `email_receipt_parsers` row). */
export interface ReceiptParserDefinition {
  version: 2;
  /** The lines the patterns read: the email's text (default) or its HTML part. */
  source?: ReceiptLinesSource;
  orderId?: ReceiptFieldEntry[];
  total?: ReceiptFieldEntry[];
  paid?: ReceiptFieldEntry[];
  shipping?: ReceiptFieldEntry[];
  discount?: ReceiptFieldEntry[];
  payee?: ReceiptFieldEntry[];
  /** An identifier the shop or the payment gateway puts into the bank operation. Capture `{reference}`. */
  reference?: ReceiptFieldEntry[];
  match?: ReceiptMatchDefinition;
  /** A tag the proposal adds to every transaction the profile categorises. */
  tag?: string;
  /** Ask the user's AI for the category of an item no rule matched. */
  aiCategories?: boolean;
  items?: ReceiptItemsDefinition | ReceiptBlockItemsDefinition | ReceiptSingleItemsDefinition;
  /** Fees of the order (a payment or handling charge), read like `shipping`. Capture `{amount}`. */
  fees?: ReceiptFieldEntry[];
  /** How far the items may differ from the bank amount before the proposal is not balanced; a decimal string. */
  balanceTolerance?: string;
  /** Advanced, edited as JSON only: rules in order, the first whose glob matches an item's name wins. */
  categoryRules?: ReceiptCategoryRule[];
  /** Categories are named, not identified: the full name as the category list shows it (`Parent: Child`). */
  defaultCategory?: string;
  shippingCategory?: string;
  feesCategory?: string;
  requireLine?: string[];
  skipIfLine?: string[];
  waitIfLine?: string[];
}

/** One problem the server's validator found: where, and a machine-readable code. */
export interface ReceiptParserValidationError {
  path: string;
  code: string;
}

export interface EmailReceiptParser {
  id: string;
  name: string;
  payeeId: string | null;
  fromDomains: string[];
  subjectContains: string[];
  definition: Record<string, unknown>;
  definitionValid: boolean;
  definitionErrors: ReceiptParserValidationError[];
  status: EmailReceiptParserStatus;
  source: EmailReceiptParserSource;
  approvedAt: string | null;
  revision: number;
  /**
   * Stored emails of the profile's domains, in a processable state, last processed
   * before the profile's last change. Absent from a server that predates it.
   */
  reprocessableCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEmailReceiptParserPayload {
  name: string;
  payeeId?: string | null;
  fromDomains: string[];
  subjectContains?: string[];
  definition: ReceiptParserDefinition;
}

export interface UpdateEmailReceiptParserPayload extends Partial<CreateEmailReceiptParserPayload> {
  expectedRevision: number;
}

export interface TestEmailReceiptParserPayload {
  definition: ReceiptParserDefinition;
  receiptId: string;
  payeeId?: string | null;
}

export interface ParsedReceiptItem {
  name: string;
  qty: number;
  /** The line total, in 1/10000 units. */
  amount: number;
  categoryId: string | null;
  /** `"ai"` when the AI chose this item's category. */
  categorySource?: 'ai';
}

/** What a parser read from one email. Every amount is in 1/10000 units; null means the email did not state it. */
export interface ParsedReceipt {
  orderId: string | null;
  total: number | null;
  /** What was actually charged, when the email states it separately. Absent on a receipt stored before the field existed. */
  paid?: number | null;
  /** The merchant the email names (a payment gateway's notice). Absent on a receipt stored before the field existed. */
  payee?: string | null;
  /** The identifier the profile's `reference` field read. Absent on a receipt stored before the field existed. */
  reference?: string | null;
  shipping: number | null;
  discount: number | null;
  items: ParsedReceiptItem[];
  shippingCategoryId: string | null;
  discountCategoryId: string | null;
  complete: boolean;
  reason: ParsedReceiptReason | null;
  /** Who read the email: a saved parser, the AI, or the email's own schema.org markup. Absent on a receipt stored before the field existed. */
  source?: 'parser' | 'ai' | 'schema_org';
}

export type ReceiptMatchResult =
  | { kind: 'matched'; transactionId: string; matchKind: Exclude<EmailReceiptMatchKind, 'manual' | 'amount_only'> }
  | { kind: 'ambiguous'; candidateIds: string[] }
  | { kind: 'unmatched' };

/** A transaction a matching strategy kept. */
export interface ReceiptMatchTraceTransaction {
  id: string;
  /** YYYY-MM-DD. */
  date: string;
  amount: number;
  payeeName: string | null;
}

/** What one strategy kept: how many candidates, and the first ten. */
export interface ReceiptMatchTraceAttempt {
  strategy: ReceiptMatchStrategy;
  count: number;
  transactions: ReceiptMatchTraceTransaction[];
}

/** What the matcher looked at: the window, the strategies in order, and what each kept. */
export interface ReceiptMatchTrace {
  window: { from: string; to: string };
  daysBefore: number;
  daysAfter: number;
  /** In 1/10000 units. */
  toleranceUnits: number;
  referenceIn: ReceiptMatchTextField[];
  by: ReceiptMatchStrategy[];
  /** Candidates inside the window. */
  considered: number;
  /** The strategies tried, up to and including the one that decided. */
  attempts: ReceiptMatchTraceAttempt[];
  /** The strategy that matched or found several candidates; null when none did. */
  decidedBy: ReceiptMatchStrategy | null;
}

/** A line a trace points at: its 1-based number (0 is the subject) and its text. */
export interface ReceiptTraceLine {
  line: number;
  text: string;
}

/** What found one value: the entry index of the field, its glob and the line that produced it. */
export interface ReceiptTraceHit {
  entry: number;
  /** The line glob; for a labelled entry, its `value` glob. */
  pattern: string;
  /** A labelled entry's label glob and the line it matched. */
  label?: string;
  labelLine?: ReceiptTraceLine;
  line: ReceiptTraceLine;
}

export interface ReceiptTraceItem {
  mode: 'patterns' | 'record' | 'single';
  patterns: string[];
  lines: ReceiptTraceLine[];
}

/** The fields a trace names, in the order the panel lists them. */
export const RECEIPT_TRACE_FIELDS = [
  'orderId',
  'reference',
  'total',
  'paid',
  'shipping',
  'discount',
  'payee',
  'requireLine',
  'skipIfLine',
  'waitIfLine',
] as const;
export type ReceiptTraceField = (typeof RECEIPT_TRACE_FIELDS)[number];

export type ReceiptTrace = Record<ReceiptTraceField, ReceiptTraceHit | null> & { items: ReceiptTraceItem[] };

/** What the pipeline would do with the email under this parser (`no_html`: it reads the HTML part and the email has none). */
export type ReceiptOutcome = 'read' | 'not_applicable' | 'skip_line' | 'wait_line' | 'no_html';

export interface EmailReceiptParserTestResult {
  parsed: ParsedReceipt;
  /** Which entry and which line read each value. Absent from a server that predates it. */
  trace?: ReceiptTrace;
  outcome?: ReceiptOutcome;
  match: ReceiptMatchResult;
  /** What the matcher looked at, by strategy. Absent from a server that predates it. */
  matchTrace?: ReceiptMatchTrace;
  /** Candidate transactions the matcher was given. */
  candidateCount: number;
  /** The matched transaction, when there is one (an ordinary amount, no currency). */
  transaction: { id: string; date: string; amount: number; payeeName: string | null } | null;
}

/** One sender domain with stored emails and no approved profile (`GET /email-receipts/domains/uncovered`). */
export interface UncoveredDomain {
  domain: string;
  count: number;
  /** A draft profile already written for the domain, or null. */
  draftParserId: string | null;
}

/** One email of the domain paired with the transaction it paid for (a wizard sample). */
export interface ParserSamplePair {
  receiptId: string;
  transactionId: string;
}

/** `POST /email-receipt-parsers/generate-with-ai`: 1 to 5 samples; `parserId` and `feedback` revise an existing draft. */
export interface GenerateParserWithAiPayload {
  domain: string;
  samples: ParserSamplePair[];
  parserId?: string;
  feedback?: string;
}

export interface GenerateParserWithAiResult {
  parserId: string;
  revision: number;
  /** What the assistant said about its work. */
  answer: string;
}

/** `POST /email-receipt-parsers/:id/preview`. */
export interface PreviewEmailReceiptParserPayload {
  selectedReceiptIds: string[];
  expected?: ParserSamplePair[];
}

export interface ParserPreviewTransaction {
  transactionId: string;
  summary: string;
}

export const PARSER_PREVIEW_OUTCOMES = [
  'matched',
  'ambiguous',
  'unmatched',
  'parse_failed',
  'not_applicable',
  'skip_line',
  'wait_line',
  'no_html',
] as const;
export type ParserPreviewOutcome = (typeof PARSER_PREVIEW_OUTCOMES)[number];

export interface ParserPreviewItem {
  receiptId: string;
  subject: string;
  receivedAt: string;
  /** How the draft would read the email; the server's `ParserPreviewOutcome`. */
  outcome: ParserPreviewOutcome;
  statusReason: string | null;
  parsed: { date: string | null; total: number | null; currency: string | null; lineCount: number } | null;
  match: ParserPreviewTransaction | null;
  expected: ParserPreviewTransaction | null;
  /** Whether the parsed date and total agree with the expected transaction; null without an expectation. */
  agrees: boolean | null;
}

export interface ParserPreviewResult {
  selected: ParserPreviewItem[];
  others: ParserPreviewItem[];
  /** How many other emails the domain has; `others` holds the newest 100. */
  othersTotal: number;
}
