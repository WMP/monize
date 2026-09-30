import { createHash } from "node:crypto";
import { addDaysYMD } from "../common/date-utils";
import { roundMoney } from "../common/round.util";
import { TRANSACTION_NOTE_MAX_LENGTH } from "../common/transaction-note";
import { isCalendarDate } from "../common/validators/is-calendar-date.validator";
import type { BankTransaction } from "./providers/bank-sync-provider.interface";

/**
 * Turns the rows a provider returned into the rows Monize will write, and
 * counts what it did not write and why. Pure: no clock, no database, no
 * provider. The truth table is `docs/specs/bank-sync.md` section 6 and the
 * first matching line wins:
 *
 * 1. not booked: not planned, counted as `pending` (not an error);
 * 2. no valid date: refused `missing_date`;
 * 3. date before the cut-off: not planned, counted as `beforeCutoff`;
 * 4. date after today + 1 day: refused `future_date`;
 * 5. amount not `^\d{1,16}(\.\d{1,8})?$` after trimming: refused `invalid_amount`;
 * 6. direction neither credit nor debit: refused `unknown_direction`;
 * 7. currency differs from the Monize account's: refused `currency_mismatch`
 *    (INV-BANKSYNC-003: never converted, never written with a foreign amount);
 * 8. otherwise planned.
 *
 * A row whose currency the provider did not report is refused as
 * `currency_mismatch` too: an unknown currency is not the account's currency,
 * and writing the amount in the account's currency on a guess is exactly what
 * the invariant forbids.
 */

/** The reasons a booked row is refused, each counted in `refused`. */
export const BANK_IMPORT_REFUSAL_REASONS = [
  "missing_date",
  "future_date",
  "invalid_amount",
  "unknown_direction",
  "currency_mismatch",
] as const;
export type RefusalReason = (typeof BANK_IMPORT_REFUSAL_REASONS)[number];

/** The create DTO's bound on a payee name and on a reference number. */
export const BANK_IMPORT_PAYEE_MAX_LENGTH = 100;
export const BANK_IMPORT_REFERENCE_MAX_LENGTH = 100;

/** The width of `bank_sync_imported_transactions.external_key`. */
export const BANK_IMPORT_EXTERNAL_KEY_MAX_LENGTH = 255;

const AMOUNT_PATTERN = /^\d{1,16}(\.\d{1,8})?$/;

export interface PlannedBankRow {
  /** The duplicate key (INV-BANKSYNC-001); at most 255 characters. */
  externalKey: string;
  /** `YYYY-MM-DD`. */
  transactionDate: string;
  /** Signed: negative for a debit, at money precision. */
  amount: number;
  payeeText: string | null;
  description: string | null;
  referenceNumber: string | null;
}

export interface BankImportPlan {
  planned: PlannedBankRow[];
  refused: Record<RefusalReason, number>;
  pending: number;
  beforeCutoff: number;
}

export interface BankImportContext {
  /** The Monize account's currency. */
  accountCurrencyCode: string;
  /** The cut-off date, `YYYY-MM-DD`: rows dated before it are never imported. */
  syncFromDate: string;
  /** The server's date, `YYYY-MM-DD`, injected so the plan is deterministic. */
  today: string;
}

/** A row that passed lines 1 to 7, before its key is assigned. */
interface Draft {
  transactionDate: string;
  amount: number;
  /** The unsigned amount, for the hash. */
  absoluteAmount: number;
  direction: "credit" | "debit";
  currencyCode: string;
  payeeText: string | null;
  description: string | null;
  referenceNumber: string | null;
  entryReference: string | null;
  transactionId: string | null;
}

type Classified =
  | { kind: "pending" }
  | { kind: "beforeCutoff" }
  | { kind: "refused"; reason: RefusalReason }
  | { kind: "planned"; draft: Draft };

/**
 * `value` trimmed and cut to `max` UTF-16 units, without splitting a surrogate
 * pair (a lone surrogate is not valid text). Null when nothing is left.
 */
function bounded(value: string | null | undefined, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (trimmed.length <= max) return trimmed;
  const last = trimmed.charCodeAt(max - 1);
  const isHighSurrogate = last >= 0xd800 && last <= 0xdbff;
  const cut = trimmed.slice(0, isHighSurrogate ? max - 1 : max).trim();
  return cut === "" ? null : cut;
}

/** The first of the three dates that names a real day, or null. */
function firstValidDate(row: BankTransaction): string | null {
  for (const candidate of [
    row.bookingDate,
    row.valueDate,
    row.transactionDate,
  ]) {
    const trimmed = candidate?.trim();
    if (isCalendarDate(trimmed)) return trimmed;
  }
  return null;
}

function sameCurrency(rowCurrency: string | null, accountCurrency: string) {
  const row = rowCurrency?.trim().toUpperCase();
  return !!row && row === accountCurrency.trim().toUpperCase();
}

function classify(row: BankTransaction, ctx: BankImportContext): Classified {
  if (!row.booked) return { kind: "pending" };

  const transactionDate = firstValidDate(row);
  if (transactionDate === null) {
    return { kind: "refused", reason: "missing_date" };
  }
  if (transactionDate < ctx.syncFromDate) return { kind: "beforeCutoff" };
  if (transactionDate > addDaysYMD(ctx.today, 1)) {
    return { kind: "refused", reason: "future_date" };
  }

  const amountText = row.amount?.trim() ?? "";
  if (!AMOUNT_PATTERN.test(amountText)) {
    return { kind: "refused", reason: "invalid_amount" };
  }
  if (row.direction !== "credit" && row.direction !== "debit") {
    return { kind: "refused", reason: "unknown_direction" };
  }
  if (!sameCurrency(row.currencyCode, ctx.accountCurrencyCode)) {
    return { kind: "refused", reason: "currency_mismatch" };
  }

  const absoluteAmount = roundMoney(Number(amountText));
  const signed = row.direction === "debit" ? -absoluteAmount : absoluteAmount;
  const remittance = row.remittance
    .map((line) => line.trim())
    .filter((line) => line !== "");

  return {
    kind: "planned",
    draft: {
      transactionDate,
      // Not `-0`: a debit of nothing is nothing.
      amount: signed === 0 ? 0 : signed,
      absoluteAmount,
      direction: row.direction,
      currencyCode: ctx.accountCurrencyCode.trim().toUpperCase(),
      // The counterparty is already chosen by direction (creditor for a debit,
      // debtor for a credit); without one, the first remittance line stands in.
      payeeText:
        bounded(row.counterpartyName, BANK_IMPORT_PAYEE_MAX_LENGTH) ??
        bounded(remittance[0], BANK_IMPORT_PAYEE_MAX_LENGTH),
      description: bounded(remittance.join(" "), TRANSACTION_NOTE_MAX_LENGTH),
      referenceNumber: bounded(
        row.bankReference,
        BANK_IMPORT_REFERENCE_MAX_LENGTH,
      ),
      entryReference: bounded(row.entryReference, Number.MAX_SAFE_INTEGER),
      transactionId: bounded(row.transactionId, Number.MAX_SAFE_INTEGER),
    },
  };
}

const sha256Hex = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

/**
 * One field of the hash input, with the separator and the escape character
 * escaped so two different rows cannot produce the same input (a payee
 * containing `|` must not read as the start of the description).
 */
const hashField = (value: string): string =>
  value.replaceAll("\\", "\\\\").replaceAll("|", "\\|");

/** The hash form's input: `date|amount|currency|direction|payee|description`. */
function hashInput(draft: Draft): string {
  return [
    draft.transactionDate,
    String(draft.absoluteAmount),
    draft.currencyCode,
    draft.direction,
    draft.payeeText ?? "",
    draft.description ?? "",
  ]
    .map(hashField)
    .join("|");
}

/**
 * A key longer than the column is replaced by its prefix and the SHA-256 hex of
 * the whole value, so it stays deterministic and fits.
 */
function fitKey(prefix: string, key: string): string {
  return key.length <= BANK_IMPORT_EXTERNAL_KEY_MAX_LENGTH
    ? key
    : `${prefix}${sha256Hex(key)}`;
}

/**
 * The plan for one fetch.
 *
 * The external key is the first that applies: `ref:` + the provider's entry
 * reference; `id:` + its transaction id; otherwise `hash:` + the SHA-256 of
 * the row's content, then `:` + the occurrence number of that hash among the
 * planned rows of this fetch, counted from 0 in the order the provider returned
 * them. The hash form is stable because every fetch requests whole days, so two
 * identical coffees on one day are always `:0` and `:1`.
 */
export function planBankImport(
  rows: readonly BankTransaction[],
  ctx: BankImportContext,
): BankImportPlan {
  const classified = rows.map((row) => classify(row, ctx));

  const refused = Object.fromEntries(
    BANK_IMPORT_REFUSAL_REASONS.map((reason) => [
      reason,
      classified.filter((c) => c.kind === "refused" && c.reason === reason)
        .length,
    ]),
  ) as Record<RefusalReason, number>;

  const occurrences = new Map<string, number>();
  const planned = classified.flatMap((c): PlannedBankRow[] => {
    if (c.kind !== "planned") return [];
    const { draft } = c;
    return [
      {
        externalKey: keyFor(draft, occurrences),
        transactionDate: draft.transactionDate,
        amount: draft.amount,
        payeeText: draft.payeeText,
        description: draft.description,
        referenceNumber: draft.referenceNumber,
      },
    ];
  });

  return {
    planned,
    refused,
    pending: classified.filter((c) => c.kind === "pending").length,
    beforeCutoff: classified.filter((c) => c.kind === "beforeCutoff").length,
  };
}

/** The key of one planned row; `occurrences` counts the hash forms seen so far. */
function keyFor(draft: Draft, occurrences: Map<string, number>): string {
  if (draft.entryReference !== null) {
    return fitKey("ref:", `ref:${draft.entryReference}`);
  }
  if (draft.transactionId !== null) {
    return fitKey("id:", `id:${draft.transactionId}`);
  }
  const hash = sha256Hex(hashInput(draft));
  const occurrence = occurrences.get(hash) ?? 0;
  occurrences.set(hash, occurrence + 1);
  return `hash:${hash}:${occurrence}`;
}
