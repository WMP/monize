import type { PendingAction } from '@/types/ai';

/**
 * The AI review inbox as `GET /ai-review-requests` answers it. Mirrors
 * `backend/src/ai-review/ai-review-work.types.ts` (`AiReviewInboxItem`).
 */
export const AI_REVIEW_STATUSES = [
  'pending',
  'claimed',
  'proposed',
  'applied',
  'rejected',
  'expired',
] as const;

export type AiReviewStatus = (typeof AI_REVIEW_STATUSES)[number];

/**
 * What raised a request: a rule or a person (`transaction_review`), a stored
 * order-confirmation email (`email_receipt`), or a person asking for a receipt
 * parser to be written from up to five stored emails (`email_parser_draft`,
 * which is about emails and has no transaction).
 */
export const AI_REVIEW_KINDS = ['transaction_review', 'email_receipt', 'email_parser_draft'] as const;

export type AiReviewKind = (typeof AI_REVIEW_KINDS)[number];

/** The email a request of kind `email_receipt` was raised for (`AiReviewInboxEmailReceipt`). */
export interface AiReviewEmailReceipt {
  id: string;
  fromAddress: string;
  subject: string;
  /** ISO timestamp. */
  receivedAt: string;
}

/** The reviewed transaction as the inbox shows it (not a raw row). */
export interface AiReviewTransactionSummary {
  id: string;
  /** YYYY-MM-DD. */
  date: string;
  amount: number;
  currencyCode: string;
  payeeName: string | null;
  description: string | null;
  accountId: string;
  accountName: string | null;
  categoryName: string | null;
  isSplit: boolean;
}

/**
 * A proposal is the confirmation card rebuilt against the transaction as it is
 * now, or the reason it can no longer be built. The card is committed through
 * `POST /ai/actions/confirm`, never here.
 */
export type AiReviewProposal =
  | { action: Omit<PendingAction, 'status'> }
  | { error: string };

/** What an inbox row of kind `email_parser_draft` says (`AiReviewInboxParserDraft`). */
export interface AiReviewParserDraft {
  /** The sender domain the draft is for. */
  domain: string;
  /** How many emails the request names. */
  emailCount: number;
  /** The draft parser an agent saved for it, once `proposed`; else null. */
  parserId: string | null;
}

export interface AiReviewItem {
  id: string;
  kind: AiReviewKind;
  status: AiReviewStatus;
  instruction: string;
  /** Null for a request of kind `email_parser_draft`. */
  transactionId: string | null;
  ruleId: string | null;
  ruleName: string | null;
  /** Null unless the request is of kind `email_receipt` and its email still exists. */
  emailReceipt: AiReviewEmailReceipt | null;
  /** Null unless the request is of kind `email_parser_draft`. */
  parserDraft: AiReviewParserDraft | null;
  createdAt: string;
  expiresAt: string;
  /** Null when the transaction no longer exists. */
  transaction: AiReviewTransactionSummary | null;
  agentNote?: { reason: string; at: string };
  proposal?: AiReviewProposal;
}

/**
 * The inbox's kind filter: every request, the order-email proposals, or the
 * rules' (and a person's) transaction reviews. A parser-draft request has no card
 * to approve and is listed under "all" only. `?kind=` carries the filter in the URL.
 */
export const AI_REVIEW_KIND_FILTERS = ['all', 'email_receipt', 'transaction_review'] as const;
export type AiReviewKindFilter = (typeof AI_REVIEW_KIND_FILTERS)[number];

/** `?kind=` if it names a filter, else "all". */
export function parseKindFilter(value: string | null): AiReviewKindFilter {
  return AI_REVIEW_KIND_FILTERS.find((filter) => filter === value) ?? 'all';
}

/** A request a person can approve from the list: proposed, with a card that could still be built. */
export function isApprovable(item: AiReviewItem): boolean {
  return item.status === 'proposed' && item.proposal !== undefined && 'action' in item.proposal;
}

/**
 * What names a request in a list or a message: the sender domain of a parser
 * draft, the email's subject, the transaction's payee or the rule, in that order;
 * `null` when it has none of them.
 */
export function reviewItemLabel(item: AiReviewItem): string | null {
  return item.parserDraft?.domain ?? item.emailReceipt?.subject ?? item.transaction?.payeeName ?? item.ruleName ?? null;
}

/** What happened to one request of a bulk approval. */
export interface AiReviewApproveBatchItemResult {
  id: string;
  ok: boolean;
  /** Why it was not approved; absent when `ok`. */
  error?: string;
}

/** `POST /ai-review-requests/approve-batch`. */
export interface AiReviewApproveBatchResult {
  results: AiReviewApproveBatchItemResult[];
  approved: number;
  failed: number;
}

/** Most requests one bulk approval names (the server's bound). */
export const AI_REVIEW_APPROVE_BATCH_MAX = 100;

/** The inbox's default view (no status sent): everything waiting, plus expired. */
export type AiReviewFilter = 'open' | AiReviewStatus;
