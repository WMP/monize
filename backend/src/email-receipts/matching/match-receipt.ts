import { addDaysYMD } from "../../common/date-utils";
import { normalizePayeeName } from "../../payees/payee-normalize.util";
import type { ParsedReceipt } from "../parsing/receipt-parser.types";

/**
 * Which bank transaction an order-confirmation email pays for (spec section
 * 3). Pure: the candidates are loaded by the caller in one query and handed
 * in; nothing here reads the database or the clock. The truth table is the
 * spec's, row for row.
 */

/**
 * The window is centred on the PURCHASE date: the day the shop sent the order
 * (the original date of a forwarded email) or, when none is known, the day the
 * email arrived. A candidate is dated this many days before it... */
export const RECEIPT_MATCH_DAYS_BEFORE = 3;
/** ...or this many days after (the bank posts later than the shop mails). */
export const RECEIPT_MATCH_DAYS_AFTER = 14;
/** The candidate list stored on an ambiguous receipt. */
export const MAX_STORED_CANDIDATES = 10;
/** An order id shorter than this is too likely to occur by chance to be a signal. */
export const MIN_ORDER_ID_LENGTH = 4;

const MONEY_UNITS = 10000;
const MS_PER_DAY = 86_400_000;

export interface ReceiptMatchCandidate {
  id: string;
  /** `YYYY-MM-DD`. */
  transactionDate: string;
  /** Signed, as stored. */
  amount: number;
  payeeId: string | null;
  payeeName: string | null;
  description: string | null;
  referenceNumber: string | null;
}

export type ReceiptMatchKind = "order_id" | "amount_payee" | "amount_only";

export type ReceiptMatchResult =
  | { kind: "matched"; transactionId: string; matchKind: ReceiptMatchKind }
  | { kind: "ambiguous"; candidateIds: string[] }
  | { kind: "unmatched" };

/** The inclusive date range in which a transaction can be the one an email paid for. */
export function receiptCandidateWindow(purchaseDate: string): {
  from: string;
  to: string;
} {
  return {
    from: addDaysYMD(purchaseDate, -RECEIPT_MATCH_DAYS_BEFORE),
    to: addDaysYMD(purchaseDate, RECEIPT_MATCH_DAYS_AFTER),
  };
}

/** Whole days between two `YYYY-MM-DD` dates (UTC, so no daylight-saving drift). */
function daysApart(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.abs(
    Math.round(
      (Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / MS_PER_DAY,
    ),
  );
}

/** At most 10 ids, the closest date to the received date first, ties by id. */
function closestIds(
  set: readonly ReceiptMatchCandidate[],
  purchaseDate: string,
): string[] {
  return [...set]
    .sort(
      (x, y) =>
        daysApart(x.transactionDate, purchaseDate) -
          daysApart(y.transactionDate, purchaseDate) ||
        (x.id < y.id ? -1 : x.id > y.id ? 1 : 0),
    )
    .slice(0, MAX_STORED_CANDIDATES)
    .map((candidate) => candidate.id);
}

/** Signal O: the order id occurs, case-insensitively, in the description, payee name or reference. */
function mentionsOrderId(
  candidate: ReceiptMatchCandidate,
  orderId: string,
): boolean {
  const needle = orderId.toLowerCase();
  return [candidate.description, candidate.payeeName, candidate.referenceNumber]
    .filter((text): text is string => typeof text === "string")
    .some((text) => text.toLowerCase().includes(needle));
}

/** The amount the bank was charged: what was paid, else the total; null when the email states neither. */
export function receiptMatchAmount(
  parsed: Partial<Pick<ParsedReceipt, "total" | "paid">>,
): number | null {
  return parsed.paid ?? parsed.total ?? null;
}

/** Signal P (by name): the candidate's payee is the merchant the email names, ignoring case, accents and legal suffixes. */
function namesParsedPayee(
  candidate: ReceiptMatchCandidate,
  parsedPayee: string | null,
): boolean {
  if (parsedPayee === null || candidate.payeeName === null) return false;
  const wanted = normalizePayeeName(parsedPayee);
  return wanted !== "" && normalizePayeeName(candidate.payeeName) === wanted;
}

/**
 * Match a parsed receipt against the user's candidate transactions.
 *
 * Signals per candidate: O (the order id, at least four characters, appears in
 * its description, payee name or reference), A (`abs(amount)` in units equals
 * the amount paid, else the parsed total, exactly; false when neither was
 * parsed) and P (its payee is the parser's payee, or its payee's name is the
 * merchant the email names). One O candidate wins; else one A-and-P candidate;
 * else one A candidate; two or more at any step are ambiguous (that step's
 * set). A candidate outside the window around `purchaseDate` is ignored.
 */
export function matchReceipt(
  parsed: Partial<Pick<ParsedReceipt, "total" | "paid" | "payee">> &
    Pick<ParsedReceipt, "orderId">,
  purchaseDate: string,
  candidates: readonly ReceiptMatchCandidate[],
  parserPayeeId: string | null,
): ReceiptMatchResult {
  const window = receiptCandidateWindow(purchaseDate);
  const inWindow = candidates.filter(
    (candidate) =>
      candidate.transactionDate >= window.from &&
      candidate.transactionDate <= window.to,
  );

  const orderId = parsed.orderId?.trim() ?? "";
  const withOrderId =
    orderId.length >= MIN_ORDER_ID_LENGTH
      ? inWindow.filter((candidate) => mentionsOrderId(candidate, orderId))
      : [];
  if (withOrderId.length === 1) {
    return matched(withOrderId[0], "order_id");
  }
  if (withOrderId.length > 1) {
    return {
      kind: "ambiguous",
      candidateIds: closestIds(withOrderId, purchaseDate),
    };
  }

  const total = receiptMatchAmount(parsed);
  const parsedPayee = parsed.payee ?? null;
  const withAmount =
    total === null
      ? []
      : inWindow.filter(
          (candidate) =>
            Math.round(Math.abs(candidate.amount) * MONEY_UNITS) === total,
        );
  const withAmountAndPayee = withAmount.filter(
    (candidate) =>
      (parserPayeeId !== null && candidate.payeeId === parserPayeeId) ||
      namesParsedPayee(candidate, parsedPayee),
  );
  if (withAmountAndPayee.length === 1) {
    return matched(withAmountAndPayee[0], "amount_payee");
  }
  if (withAmountAndPayee.length > 1) {
    return {
      kind: "ambiguous",
      candidateIds: closestIds(withAmountAndPayee, purchaseDate),
    };
  }
  if (withAmount.length === 1) {
    return matched(withAmount[0], "amount_only");
  }
  if (withAmount.length > 1) {
    return {
      kind: "ambiguous",
      candidateIds: closestIds(withAmount, purchaseDate),
    };
  }
  return { kind: "unmatched" };
}

function matched(
  candidate: ReceiptMatchCandidate,
  matchKind: ReceiptMatchKind,
): ReceiptMatchResult {
  return { kind: "matched", transactionId: candidate.id, matchKind };
}
