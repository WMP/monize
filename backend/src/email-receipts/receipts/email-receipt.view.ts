import type { EmailReceiptMatchKind } from "../entities/email-receipt.entity";
import type { EmailReceiptStatus } from "../entities/email-receipt.entity";

/**
 * What a `review` receipt's request says about it (design section 6): `proposed`
 * waits for approval, `applied` was written, `dismissed` was rejected (by the
 * person, or by a refusal whose reason is `requestNote`), `expired` ran out,
 * `pending_ai` waits for the AI (or an agent), and `request_missing` means the
 * request row is gone (a restore), which the next poll repairs. Null for every
 * other status.
 */
export type EmailReceiptDisplayState =
  | "proposed"
  | "applied"
  | "dismissed"
  | "expired"
  | "pending_ai"
  | "request_missing";

/** The linked transaction, as far as the receipts page needs it. */
export interface EmailReceiptTransactionSummary {
  id: string;
  /** `YYYY-MM-DD`. */
  date: string;
  amount: number;
  currencyCode: string;
  payeeName: string | null;
}

/** A candidate of an ambiguous receipt: the summary plus the text that helps choose. */
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
   * confirmation (`fromAddress`, `fromDomain` and `subject` are then the
   * shop's), else null.
   */
  forwardedBy: string | null;
  /** When the shop sent the order, read from a forwarded header block; else null. */
  originalSentAt: string | null;
  /**
   * The day the match window is centred on: `originalSentAt` when known, else
   * `receivedAt` (an ISO timestamp either way).
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

/** One stored email with its text, what the parser read and the candidates. */
export interface EmailReceiptDetail extends EmailReceiptListItem {
  bodyText: string;
  /**
   * The HTML part as the sender wrote it, for display in a sandboxed frame that
   * runs nothing and loads nothing; null when the email has none. Only the
   * detail carries it, never the list.
   */
  bodyHtml: string | null;
  parsed: Record<string, unknown> | null;
  candidates: EmailReceiptCandidateSummary[];
}
