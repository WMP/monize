/**
 * Types for the AI Assistant human-in-the-loop write actions.
 *
 * When the assistant proposes a write (create a transaction, categorize a
 * transaction, create a payee) the executor runs a dry-run preview and produces
 * a signed action descriptor. The descriptor flows to the browser as a
 * `pending_action` SSE event, the user reviews a confirmation card, and on
 * approval the descriptor is posted back to the confirm endpoint which verifies
 * the signature, re-validates, and performs the real write.
 *
 * The descriptor is the integrity boundary: it carries the validated/resolved
 * fields, the owning `userId`, and an `expiresAt`, all covered by the HMAC
 * signature. The confirm endpoint always re-validates and re-checks ownership;
 * the signature only guarantees the client did not tamper with what the
 * assistant proposed.
 */

import { InvestmentAction } from "../../securities/entities/investment-transaction.entity";

export type AiActionType =
  | "create_transaction"
  | "categorize_transaction"
  | "create_payee"
  | "create_security"
  | "create_investment_transaction"
  | "create_transactions"
  | "create_investment_transactions";

export const AI_ACTION_TYPES: AiActionType[] = [
  "create_transaction",
  "categorize_transaction",
  "create_payee",
  "create_security",
  "create_investment_transaction",
  "create_transactions",
  "create_investment_transactions",
];

/**
 * Largest batch a single bulk action may carry. Tool-call arguments count
 * against the provider output-token budget (Anthropic completes tool use with a
 * bounded `max_tokens`), so the parsed table is capped here, in the bulk tool's
 * Zod schema, and again defensively at confirm time.
 */
export const MAX_BULK_ACTION_ROWS = 25;

/** Fields common to every signed descriptor. */
interface BaseDescriptor {
  type: AiActionType;
  /** Owner the descriptor was minted for; checked against the JWT on confirm. */
  userId: string;
  /** Unique id for correlation, anti-replay, and UI keying. */
  actionId: string;
  /** Epoch ms after which the descriptor is no longer accepted. */
  expiresAt: number;
}

export interface CreateTransactionDescriptor extends BaseDescriptor {
  type: "create_transaction";
  accountId: string;
  amount: number;
  transactionDate: string;
  /** Existing payee the name resolved to, or null to record a free-text name. */
  payeeId: string | null;
  payeeName: string | null;
  /**
   * When true and payeeId is null, the confirm step creates a payee from
   * payeeName and links the transaction to it; when false the name is stored as
   * free text. Always false when payeeId is set or no payee name was given.
   */
  createPayee: boolean;
  categoryId: string | null;
  description: string | null;
  currencyCode: string;
}

export interface CategorizeTransactionDescriptor extends BaseDescriptor {
  type: "categorize_transaction";
  transactionId: string;
  categoryId: string;
}

export interface CreatePayeeDescriptor extends BaseDescriptor {
  type: "create_payee";
  name: string;
  defaultCategoryId: string | null;
}

export interface CreateSecurityDescriptor extends BaseDescriptor {
  type: "create_security";
  /** Ticker symbol resolved by the quote-provider lookup. */
  symbol: string;
  name: string;
  /** Constrained to the known security-type list, or null when unclassified. */
  securityType: string | null;
  /** Constrained to the known exchange list, or null when not exchange-listed. */
  exchange: string | null;
  currencyCode: string;
  isFavourite: boolean;
  /** Per-security quote-source override carried from the lookup; null = user default. */
  quoteProvider: "yahoo" | "msn" | null;
  msnInstrumentId: string | null;
}

export interface CreateInvestmentTransactionDescriptor extends BaseDescriptor {
  type: "create_investment_transaction";
  accountId: string;
  action: InvestmentAction;
  transactionDate: string;
  /** Resolved security (matched by symbol or name); null for cash-only actions. */
  securityId: string | null;
  /** Explicit cash account override, or null to use the brokerage's cash sleeve. */
  fundingAccountId: string | null;
  quantity: number | null;
  price: number | null;
  commission: number;
  /** Resolved at preview time so confirm persists the rate the user approved. */
  exchangeRate: number;
  description: string | null;
}

/**
 * One resolved cash-transaction row inside a bulk `create_transactions` action.
 * Identical to the singular `CreateTransactionDescriptor` minus the per-action
 * envelope (the batch shares one `actionId`/`expiresAt`/`userId`/signature).
 */
export interface TransactionRowDescriptor {
  accountId: string;
  amount: number;
  transactionDate: string;
  payeeId: string | null;
  payeeName: string | null;
  createPayee: boolean;
  categoryId: string | null;
  description: string | null;
  currencyCode: string;
}

export interface CreateTransactionsDescriptor extends BaseDescriptor {
  type: "create_transactions";
  /** Order is load-bearing: it is covered by the signature and preserved on confirm. */
  rows: TransactionRowDescriptor[];
}

/**
 * One resolved investment-transaction row inside a bulk
 * `create_investment_transactions` action. Mirrors the singular
 * `CreateInvestmentTransactionDescriptor` minus the envelope.
 */
export interface InvestmentTransactionRowDescriptor {
  accountId: string;
  action: InvestmentAction;
  transactionDate: string;
  securityId: string | null;
  fundingAccountId: string | null;
  quantity: number | null;
  price: number | null;
  commission: number;
  exchangeRate: number;
  description: string | null;
}

export interface CreateInvestmentTransactionsDescriptor extends BaseDescriptor {
  type: "create_investment_transactions";
  /** Order is load-bearing: it is covered by the signature and preserved on confirm. */
  rows: InvestmentTransactionRowDescriptor[];
}

export type AiActionDescriptor =
  | CreateTransactionDescriptor
  | CategorizeTransactionDescriptor
  | CreatePayeeDescriptor
  | CreateSecurityDescriptor
  | CreateInvestmentTransactionDescriptor
  | CreateTransactionsDescriptor
  | CreateInvestmentTransactionsDescriptor;

/**
 * Human-readable preview shown on the confirmation card. Display-only (not part
 * of the signed descriptor) -- it carries resolved names so the user sees what
 * the action will do.
 */
export interface AiActionPreview {
  accountName?: string;
  amount?: number;
  currencyCode?: string;
  transactionDate?: string;
  payeeName?: string | null;
  /** True when approving the transaction will also create a new payee. */
  payeeWillBeCreated?: boolean;
  categoryName?: string | null;
  newCategoryName?: string | null;
  currentCategoryName?: string | null;
  description?: string | null;
  name?: string | null;
  // create_investment_transaction display fields.
  investmentAction?: InvestmentAction;
  symbol?: string | null;
  securityName?: string | null;
  securityCurrency?: string | null;
  quantity?: number | null;
  price?: number | null;
  commission?: number;
  totalAmount?: number;
  cashAccountName?: string | null;
  cashCurrency?: string | null;
  cashAmount?: number | null;
  // create_security display fields (symbol/securityName/securityCurrency above
  // are reused for the ticker, full name, and currency).
  securityType?: string | null;
  exchange?: string | null;
  isFavourite?: boolean;
  /**
   * Per-row previews for the bulk actions (`create_transactions`,
   * `create_investment_transactions`). Carries every pasted row in order --
   * both the valid rows that will be created and the flagged rows that were
   * dropped -- so the confirmation card can show the whole table with badges.
   */
  rows?: AiActionPreviewRow[];
}

/**
 * Display-only preview of a single row in a bulk action. Reuses the singular
 * display fields and adds a `status` so the card can grey out and explain rows
 * that failed to resolve (unknown security/account, validation error). Flagged
 * rows are NOT part of the signed descriptor; only `status: "ok"` rows are.
 */
export interface AiActionPreviewRow {
  status: "ok" | "error";
  /** Human-readable reason the row was dropped, when status is "error". */
  error?: string;
  // Shared / cash-transaction display fields.
  accountName?: string;
  amount?: number;
  currencyCode?: string;
  transactionDate?: string;
  payeeName?: string | null;
  payeeWillBeCreated?: boolean;
  categoryName?: string | null;
  description?: string | null;
  // Investment-transaction display fields.
  investmentAction?: InvestmentAction;
  symbol?: string | null;
  securityName?: string | null;
  securityCurrency?: string | null;
  quantity?: number | null;
  price?: number | null;
  commission?: number;
  totalAmount?: number;
  cashAccountName?: string | null;
  cashCurrency?: string | null;
  cashAmount?: number | null;
}

/**
 * The full payload emitted to the browser as a `pending_action` SSE event and
 * stored on the assistant message.
 */
export interface PendingAiAction {
  actionId: string;
  type: AiActionType;
  preview: AiActionPreview;
  descriptor: AiActionDescriptor;
  signature: string;
  expiresAt: number;
}
