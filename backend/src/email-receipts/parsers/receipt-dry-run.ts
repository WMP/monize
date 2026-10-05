import { EntityManager } from "typeorm";
import { loadQualifiedCategoryNames } from "../../categories/category-name.util";
import { returnedRows } from "../../common/db/query-result";
import { effectiveReceiptDate } from "../imap/forwarded-receipt";
import {
  matchReceipt,
  receiptCandidateWindow,
  receiptMatchAmount,
  type ReceiptMatchCandidate,
  type ReceiptMatchResult,
} from "../matching/match-receipt";
import {
  parseReceiptLinesTraced,
  type ReceiptOutcome,
} from "../parsing/parse-receipt";
import {
  resolveMatchConfig,
  type ResolvedMatchConfig,
} from "../parsing/receipt-match-config";
import type {
  ParsedReceipt,
  ReceiptParserDefinition,
  ReceiptTrace,
} from "../parsing/receipt-parser.types";
import { loadReceiptCandidates } from "../pipeline/receipt-candidates";
import { ReceiptSourceLines } from "../pipeline/receipt-source-lines";

const MONEY_UNITS = 10_000;

/** The parts of a stored email a dry run reads. */
export interface DryRunReceipt {
  id: string;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  receivedAt: Date;
  originalSentAt: Date | null;
}

/** The payee a parser carries: its default category is the fallback, and the payee is a match signal. */
export interface DryRunPayee {
  id: string;
  defaultCategoryId: string | null;
}

/** What reading one stored email with a definition, and matching the result, yields. */
export interface ReceiptDryRun {
  parsed: ParsedReceipt;
  trace: ReceiptTrace;
  outcome: ReceiptOutcome;
  /** The day the shop sent the order when a forward carried it, else the day the email arrived. */
  effectiveDate: Date;
  /** `YYYY-MM-DD` of `effectiveDate`: what the match window is centred on. */
  purchaseDate: string;
  matchConfig: ResolvedMatchConfig;
  candidates: ReceiptMatchCandidate[];
  match: ReceiptMatchResult;
  /** The candidate the matcher chose, when it chose one. */
  hit: ReceiptMatchCandidate | undefined;
}

/**
 * Read one stored email with `definition` and say what the matcher would do
 * with the result. The one implementation behind the parser test endpoint, the
 * assistant's `test` operation and the preview, so a preview computes what the
 * commit will do through the same code. Reads only.
 */
export async function dryRunReceipt(
  m: EntityManager,
  userId: string,
  definition: ReceiptParserDefinition,
  receipt: DryRunReceipt,
  payee: DryRunPayee | null,
): Promise<ReceiptDryRun> {
  // The lines of the source the definition chose (`text` or `html`); the trace's
  // line numbers refer to them. `no_html`: it reads HTML, the email has none.
  const { parsed, trace, outcome } = parseReceiptLinesTraced(
    definition,
    receipt.subject,
    new ReceiptSourceLines(receipt).forSource(definition.source),
    payee?.defaultCategoryId ?? null,
  );
  const effectiveDate = effectiveReceiptDate(receipt);
  const purchaseDate = effectiveDate.toISOString().slice(0, 10);
  const matchConfig = resolveMatchConfig(definition.match);
  const candidates = await loadReceiptCandidates(
    m,
    userId,
    purchaseDate,
    receipt.id,
    matchConfig,
  );
  const match = matchReceipt(
    parsed,
    purchaseDate,
    candidates,
    payee?.id ?? null,
    matchConfig,
  );
  const hit =
    match.kind === "matched"
      ? candidates.find((c) => c.id === match.transactionId)
      : undefined;
  return {
    parsed,
    trace,
    outcome,
    effectiveDate,
    purchaseDate,
    matchConfig,
    candidates,
    match,
    hit,
  };
}

// ---------------------------------------------------------------- transactions

/** A transaction as the wizard, the preview and the prompt describe it. */
export interface TransactionSummary {
  id: string;
  /** `YYYY-MM-DD`. */
  date: string;
  /** Signed, in the transaction's currency. */
  amount: number;
  currencyCode: string;
  payeeName: string | null;
  description: string | null;
  /** Category lines: the splits, or the single category of an unsplit transaction. */
  categories: Array<{
    category: string | null;
    amount: number | null;
    memo: string | null;
  }>;
}

/**
 * The user's transactions among `ids`, by id (an id that is not the user's is
 * absent: the caller decides whether that is a 404). Two statements however
 * many ids: the rows, then their split lines.
 */
export async function loadTransactionSummaries(
  m: EntityManager,
  userId: string,
  ids: readonly string[],
): Promise<Map<string, TransactionSummary>> {
  const result = new Map<string, TransactionSummary>();
  if (ids.length === 0) return result;
  const rows = returnedRows<{
    id: string;
    date: string;
    amount: string | number;
    currency_code: string;
    payee_name: string | null;
    description: string | null;
    category_id: string | null;
  }>(
    await m.query(
      `SELECT t.id, TO_CHAR(t.transaction_date, 'YYYY-MM-DD') AS date,
              t.amount, t.currency_code, t.payee_name, t.description,
              t.category_id
         FROM transactions t
        WHERE t.user_id = $1
          AND t.id = ANY($2::uuid[])`,
      [userId, [...ids]],
    ),
  );
  if (rows.length === 0) return result;
  const splitRows = returnedRows<{
    transaction_id: string;
    category_id: string | null;
    amount: string | number;
    memo: string | null;
  }>(
    await m.query(
      `SELECT s.transaction_id, s.category_id, s.amount, s.memo
         FROM transaction_splits s
         JOIN transactions t ON t.id = s.transaction_id
        WHERE t.user_id = $1
          AND s.transaction_id = ANY($2::uuid[])
        ORDER BY s.created_at ASC, s.id ASC`,
      [userId, rows.map((row) => row.id)],
    ),
  );
  const names = await loadQualifiedCategoryNames(m, userId);
  const nameOf = (id: string | null): string | null =>
    id === null ? null : (names.get(id) ?? null);
  for (const row of rows) {
    const splits = splitRows.filter((s) => s.transaction_id === row.id);
    result.set(row.id, {
      id: row.id,
      date: row.date,
      amount: Number(row.amount),
      currencyCode: row.currency_code,
      payeeName: row.payee_name,
      description: row.description,
      categories:
        splits.length > 0
          ? splits.map((s) => ({
              category: nameOf(s.category_id),
              amount: Number(s.amount),
              memo: s.memo,
            }))
          : [{ category: nameOf(row.category_id), amount: null, memo: null }],
    });
  }
  return result;
}

/** One line a person reads: "2026-03-02, -49.99 PLN, Allegro". */
export function summarizeTransaction(tx: {
  date: string;
  amount: number;
  currencyCode?: string | null;
  payeeName: string | null;
}): string {
  return [
    tx.date,
    tx.currencyCode ? `${tx.amount} ${tx.currencyCode}` : `${tx.amount}`,
    ...(tx.payeeName ? [tx.payeeName] : []),
  ].join(", ");
}

// ------------------------------------------------------------------ agreement

/** Whether a parsed email agrees with the transaction a person says it paid for. */
export interface ExpectedAgreement {
  /** The transaction's date lies inside the profile's match window around the purchase date. */
  date: boolean;
  /** The amount paid (else the total) equals the transaction's amount within the profile's tolerance; false when the email states neither. */
  total: boolean;
  /** Both of the above. */
  agrees: boolean;
}

/**
 * Compare a parse with the expected transaction by the matcher's own rules: the
 * date window and the amount tolerance of the profile (`receiptCandidateWindow`,
 * `receiptMatchAmount`), so "agrees" means the matcher could pick that
 * transaction on date and amount.
 */
export function compareWithExpected(
  parsed: Pick<ParsedReceipt, "total" | "paid">,
  purchaseDate: string,
  matchConfig: Pick<
    ResolvedMatchConfig,
    "daysBefore" | "daysAfter" | "toleranceUnits"
  >,
  expected: Pick<TransactionSummary, "date" | "amount">,
): ExpectedAgreement {
  const window = receiptCandidateWindow(purchaseDate, matchConfig);
  const date = expected.date >= window.from && expected.date <= window.to;
  const paid = receiptMatchAmount(parsed);
  const total =
    paid !== null &&
    Math.abs(Math.round(Math.abs(expected.amount) * MONEY_UNITS) - paid) <=
      matchConfig.toleranceUnits;
  return { date, total, agrees: date && total };
}
