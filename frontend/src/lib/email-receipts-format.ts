import {
  EMAIL_RECEIPT_DISPLAY_STATES,
  EMAIL_RECEIPT_STATUSES,
  PARSED_RECEIPT_REASONS,
  type EmailReceiptListItem,
  type ParsedReceipt,
  type ParsedReceiptItem,
  type ParsedReceiptReason,
} from '@/types/email-receipts';

/** A parsed receipt's amounts are integers in 1/10000 units (`decimal(20,4)`'s scale). */
const RECEIPT_UNITS_PER_CURRENCY_UNIT = 10_000;

/**
 * A parsed amount as an ordinary currency amount, for `formatCurrency`.
 * The one place the 1/10000 scale is undone, once per figure: dividing again
 * downstream (or dividing a figure that is already a transaction amount) is
 * a 10000x error that still renders as a plausible price.
 */
export function fromReceiptUnits(units: number): number {
  return units / RECEIPT_UNITS_PER_CURRENCY_UNIT;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A stated amount, or `null` for "the email did not say". Zero is a stated amount. */
const readAmount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const readText = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

function readItem(value: unknown): ParsedReceiptItem | null {
  if (!isRecord(value) || typeof value.name !== 'string') return null;
  const amount = readAmount(value.amount);
  if (amount === null) return null;
  return {
    name: value.name,
    qty: typeof value.qty === 'number' && Number.isFinite(value.qty) ? value.qty : 1,
    amount,
    categoryId: readText(value.categoryId),
  };
}

/**
 * The stored `parsed` of a receipt as a `ParsedReceipt`, or `null` when there
 * is none. The API types it as a bare record (it is a jsonb column a newer or
 * older server may have written), so every field is read defensively: an
 * amount that is not a number is unknown, never `0`.
 */
export function readParsedReceipt(value: unknown): ParsedReceipt | null {
  if (!isRecord(value)) return null;
  const reason = PARSED_RECEIPT_REASONS.find((r) => r === value.reason) as ParsedReceiptReason | undefined;
  return {
    orderId: readText(value.orderId),
    total: readAmount(value.total),
    shipping: readAmount(value.shipping),
    discount: readAmount(value.discount),
    items: Array.isArray(value.items)
      ? value.items.map(readItem).filter((item): item is ParsedReceiptItem => item !== null)
      : [],
    shippingCategoryId: readText(value.shippingCategoryId),
    discountCategoryId: readText(value.discountCategoryId),
    complete: value.complete === true,
    reason: reason ?? null,
    ...(value.source === 'ai' || value.source === 'parser' ? { source: value.source } : {}),
  };
}

/** The domain of an address (`orders@shop.example.com` gives `shop.example.com`); empty when there is none. */
export function senderDomain(fromAddress: string): string {
  const at = fromAddress.lastIndexOf('@');
  return at === -1 ? '' : fromAddress.slice(at + 1).trim().toLowerCase();
}

/** What the receipts table and the detail dialog call a stored email's state. */
export const EMAIL_RECEIPT_SHOWN_STATES = [
  ...EMAIL_RECEIPT_STATUSES.filter((status) => status !== 'review'),
  ...EMAIL_RECEIPT_DISPLAY_STATES,
] as const;
export type EmailReceiptShownState = (typeof EMAIL_RECEIPT_SHOWN_STATES)[number];

/**
 * The state to show for an email. A `review` email is told apart by what its
 * request says (`displayState`: waiting for approval, applied, dismissed, ...);
 * every other status is its own state. A `review` email the server sent with no
 * display state is shown as `request_missing`, never as a proposal waiting.
 */
export function shownReceiptState(receipt: Pick<EmailReceiptListItem, 'status' | 'displayState'>): EmailReceiptShownState {
  if (receipt.status !== 'review') return receipt.status;
  return receipt.displayState ?? 'request_missing';
}

/** Whether a person can still change what the email proposes (it is neither closed nor applied). */
export function isReceiptActionable(receipt: Pick<EmailReceiptListItem, 'status' | 'displayState'>): boolean {
  return receipt.status !== 'skipped' && receipt.status !== 'ignored' && receipt.displayState !== 'applied';
}

/** The states from which "Recognize with AI" is offered: nothing read it, or what read it was dismissed or lost. */
const RECOGNIZABLE_STATES: readonly EmailReceiptShownState[] = [
  'no_parser',
  'parse_failed',
  'unmatched',
  'ambiguous',
  'review_conflict',
  'dismissed',
  'expired',
  'request_missing',
];

/**
 * Whether the button "Recognize with AI" is offered for an email. Whatever the
 * mailbox's AI mode (it governs only what happens by itself; pressing the button
 * is the person's consent). An email with an applied request, an ignored or a
 * skipped one, one still waiting to be read and one whose proposal is waiting
 * for approval or for an agent gets no button.
 */
export function canRecognizeWithAi(receipt: Pick<EmailReceiptListItem, 'status' | 'displayState'>): boolean {
  return RECOGNIZABLE_STATES.includes(shownReceiptState(receipt));
}

/** States whose email "Draft parser with AI" is offered for: no parser read it, or the one that did could not. */
const DRAFTABLE_STATES: readonly EmailReceiptShownState[] = ['no_parser', 'parse_failed'];

/** Whether the row's own "Draft parser with AI" action is offered for an email. */
export function canDraftParser(receipt: Pick<EmailReceiptListItem, 'status' | 'displayState'>): boolean {
  return DRAFTABLE_STATES.includes(shownReceiptState(receipt));
}

/**
 * The distinct sender domains of some emails, in the order they first appear.
 * An email with no usable domain (a skipped one) is left out.
 */
export function distinctSenderDomains(receipts: ReadonlyArray<Pick<EmailReceiptListItem, 'fromDomain' | 'fromAddress'>>): string[] {
  const seen = new Set<string>();
  for (const receipt of receipts) {
    const domain = receipt.fromDomain || senderDomain(receipt.fromAddress);
    if (domain !== '') seen.add(domain);
  }
  return [...seen];
}

/** Tags counted before a text with no `<html` or doctype is still taken for HTML. */
const HTML_TAG_THRESHOLD = 5;
/** Only this much of a text is scanned, and a tag is at most this long. */
const HTML_SCAN_CHARS = 200_000;
const HTML_TAG_MAX_CHARS = 500;

const isTagStart = (ch: string): boolean => (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '/' || ch === '!';

/**
 * Whether stored text is really markup: it opens with `<html` or a doctype, or it
 * holds several tags. An email whose HTML part was not kept (stored before it was)
 * can still have markup in its text when the sender put HTML in a text part; the
 * detail dialog then shows it through the same sandboxed frame as a real HTML part
 * instead of as a wall of angle brackets.
 *
 * One bounded scan, no regular expression over the text: a tag is a `<` followed by
 * a letter, `/` or `!` and a `>` within 500 characters with no other `<` between,
 * and not an address in angle brackets (`<alice@example.com>`).
 */
export function looksLikeHtml(text: string): boolean {
  const head = text.trimStart().slice(0, 20).toLowerCase();
  if (head.startsWith('<html') || head.startsWith('<!doctype')) return true;
  const end = Math.min(text.length, HTML_SCAN_CHARS);
  let tags = 0;
  let i = 0;
  while (i < end && tags < HTML_TAG_THRESHOLD) {
    if (text[i] === '<' && isTagStart(text.charAt(i + 1))) {
      const limit = Math.min(end, i + HTML_TAG_MAX_CHARS);
      let j = i + 1;
      let hasAt = false;
      let hasSpace = false;
      while (j < limit && text[j] !== '>' && text[j] !== '<') {
        if (text[j] === '@') hasAt = true;
        if (text[j] === ' ' || text[j] === '\n' || text[j] === '\t') hasSpace = true;
        j += 1;
      }
      // `<alice@example.com>` is an address in angle brackets, not a tag.
      if (j < limit && text[j] === '>' && !(hasAt && !hasSpace)) {
        tags += 1;
        i = j + 1;
        continue;
      }
    }
    i += 1;
  }
  return tags >= HTML_TAG_THRESHOLD;
}

/**
 * The sender domain most of the emails share, the first one named winning a tie:
 * the same choice the server makes when it files a "Draft parser with AI" request
 * (`dominantSenderDomain`), so the message names the domain the request carries.
 * Empty when no email has a usable domain.
 */
export function dominantSenderDomain(receipts: ReadonlyArray<Pick<EmailReceiptListItem, 'fromDomain' | 'fromAddress'>>): string {
  const counts = new Map<string, number>();
  for (const receipt of receipts) {
    const domain = receipt.fromDomain || senderDomain(receipt.fromAddress);
    if (domain !== '') counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }
  let best = '';
  let bestCount = 0;
  for (const [domain, count] of counts) {
    if (count > bestCount) {
      best = domain;
      bestCount = count;
    }
  }
  return best;
}
