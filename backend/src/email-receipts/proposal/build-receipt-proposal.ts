import {
  AI_REVIEW_MAX_TAG_NAME_LENGTH,
  type AiReviewProposalInput,
  type AiReviewSplitLine,
} from "../../ai-review/ai-review-work.types";
import { roundMoney, sumMoney } from "../../common/round.util";
import { stripHtml } from "../../common/sanitization.util";
import { TRANSACTION_NOTE_MAX_LENGTH } from "../../common/transaction-note";
import { composeDescription } from "../../transaction-rules/rule-template";
import type {
  ParsedReceipt,
  ParsedReceiptItem,
  ParsedReceiptReason,
} from "../parsing/receipt-parser.types";

/**
 * The enrichment an email receipt proposes for a bank transaction (spec
 * section 5). Pure: the caller supplies the transaction's facts and the
 * category names, and the result is an `AiReviewProposalInput`, which cannot
 * carry an amount, a date, an account or a status, so a receipt can re-label
 * and split a transaction but never move money (INV-RECEIPT-003).
 */

/** The summary appended to a description is cut to this many characters. */
export const RECEIPT_SUMMARY_MAX_LENGTH = 300;
const MONEY_UNITS = 10000;
const ELLIPSIS = "...";
const DESCRIPTION_SEPARATOR = " | ";

export type ReceiptProposalKind =
  | "itemized"
  | "single_category"
  | "description_only"
  | "none";

export type ReceiptProposalReason =
  | ParsedReceiptReason
  | "amount_differs"
  | "category_missing";

export interface ReceiptProposalTransaction {
  /** Signed, as stored. */
  amount: number;
  description: string | null;
  payeeId: string | null;
}

export interface ReceiptProposalContext {
  parserName: string;
  /** The parser payee (a payment gateway, say), by id. */
  parserPayeeId?: string | null;
  /** The parser payee's name, used only when the transaction has no payee. */
  payeeName: string | null;
  /** Category id to name, for every category the proposal may use. */
  categoryNames: ReadonlyMap<string, string>;
  /**
   * The tag the profile adds to a transaction it categorised (`definition.tag`):
   * on an itemized or one-category proposal only, never on a description-only
   * one. Null or absent: none.
   */
  tagName?: string | null;
}

export interface ReceiptProposal {
  /** Null when the proposal would carry nothing at all. */
  input: AiReviewProposalInput | null;
  kind: ReceiptProposalKind;
  /** Why the proposal is not itemized; null when it is. */
  reason: ReceiptProposalReason | null;
}

/** One category line in 1/10000 units, before it is signed and converted. */
interface ReceiptLine {
  categoryId: string | null;
  units: number;
  /** +1 for a line with the transaction's sign, -1 for the opposite (a discount). */
  direction: 1 | -1;
  memo?: string;
  /** `"ai"` when the AI chose the item's category. */
  categorySource?: "ai";
}

/** Text that came from an email: angle brackets stripped, whitespace folded. */
const clean = (text: string): string =>
  (stripHtml(text) ?? "").replace(/\s+/g, " ").trim();

function cut(text: string, max: number): string {
  return text.length > max ? text.slice(0, max).trim() : text;
}

/** `name` or `name x qty` (a quantity above one), as a split memo. */
function itemMemo(item: ParsedReceiptItem): string {
  const name = clean(item.name);
  return cut(
    item.qty > 1 ? `${name} x ${item.qty}` : name,
    TRANSACTION_NOTE_MAX_LENGTH,
  );
}

/**
 * `"{parser} {orderId}: item1 x2, item2"`. The order id part is left out when
 * the email had none, and so is the item list when it had no items. Cut to 300
 * characters with `...`.
 */
function buildSummary(parsed: ParsedReceipt, parserName: string): string {
  const head = [clean(parserName), parsed.orderId ? clean(parsed.orderId) : ""]
    .filter((part) => part !== "")
    .join(" ");
  const items = parsed.items
    .map((item) => {
      const name = clean(item.name);
      return item.qty > 1 ? `${name} x${item.qty}` : name;
    })
    .join(", ");
  const summary = items === "" ? head : `${head}: ${items}`;
  return summary.length > RECEIPT_SUMMARY_MAX_LENGTH
    ? summary.slice(0, RECEIPT_SUMMARY_MAX_LENGTH - ELLIPSIS.length) + ELLIPSIS
    : summary;
}

/**
 * The description after appending the summary, or null when the transaction
 * already carries it (case-insensitive) or the result would not add to it.
 */
export function buildDescription(
  existing: string | null,
  summary: string,
): string | null {
  const current = (existing ?? "").trim();
  if (summary === "") return null;
  if (current.toLowerCase().includes(summary.toLowerCase())) return null;
  const composed = composeDescription(
    current === "" ? null : current,
    current === "" ? summary : DESCRIPTION_SEPARATOR + summary,
    "append",
  );
  // A description already at or over the cap would be cut by `composeDescription`:
  // the proposal never shortens what the person wrote, so it proposes nothing.
  return composed === null ||
    composed === current ||
    !composed.startsWith(current)
    ? null
    : composed;
}

/** The lines an itemized proposal is made of: items, shipping, each fee, then the discount. */
function receiptLines(parsed: ParsedReceipt): ReceiptLine[] {
  const lines: ReceiptLine[] = parsed.items.map((item) => ({
    categoryId: item.categoryId,
    units: item.amount,
    direction: 1,
    memo: itemMemo(item),
    ...(item.categorySource === "ai" ? { categorySource: "ai" as const } : {}),
  }));
  if ((parsed.shipping ?? 0) > 0) {
    lines.push({
      categoryId: parsed.shippingCategoryId,
      units: parsed.shipping as number,
      direction: 1,
    });
  }
  for (const fee of parsed.fees ?? []) {
    if (fee > 0) {
      lines.push({
        categoryId: parsed.feesCategoryId ?? null,
        units: fee,
        direction: 1,
      });
    }
  }
  if ((parsed.discount ?? 0) > 0) {
    lines.push({
      categoryId: parsed.discountCategoryId,
      units: parsed.discount as number,
      direction: -1,
    });
  }
  return lines;
}

/**
 * The payee the proposal sets, or undefined for none. When the email names the
 * merchant (a payment gateway's notice), that name is proposed when the
 * transaction has no payee or its payee is the parser's own (the gateway);
 * a transaction with another payee keeps it. An email that names none falls
 * back to the parser payee's name, for a transaction without a payee.
 */
function proposedPayeeName(
  parsed: ParsedReceipt,
  tx: ReceiptProposalTransaction,
  ctx: ReceiptProposalContext,
): string | undefined {
  const merchant = parsed.payee ? clean(parsed.payee) : "";
  if (merchant !== "") {
    const gateway =
      tx.payeeId !== null &&
      ctx.parserPayeeId !== undefined &&
      ctx.parserPayeeId !== null &&
      tx.payeeId === ctx.parserPayeeId;
    return tx.payeeId === null || gateway ? merchant : undefined;
  }
  return tx.payeeId === null &&
    ctx.payeeName !== null &&
    clean(ctx.payeeName) !== ""
    ? clean(ctx.payeeName)
    : undefined;
}

/** The amount the transaction must equal: what was paid, else the total. */
const expectedAmount = (parsed: ParsedReceipt): number | null =>
  parsed.paid ?? parsed.total;

/**
 * Build the proposal for one matched receipt.
 *
 * A complete parse whose total equals the transaction amount becomes one
 * category (a single line) or splits (two or more lines), each signed like the
 * transaction and the discount the opposite way, plus the description summary.
 * Anything else, including a category the user no longer has, becomes a
 * description-only proposal with the reason. The split lines equal the
 * transaction amount by construction (the parser is complete only when the
 * lines sum to the total); a mismatch is an internal bug and throws.
 */
export function buildReceiptProposal(
  parsed: ParsedReceipt,
  tx: ReceiptProposalTransaction,
  ctx: ReceiptProposalContext,
): ReceiptProposal {
  const summary = buildSummary(parsed, ctx.parserName);
  const description = buildDescription(tx.description, summary);
  const payeeName = proposedPayeeName(parsed, tx, ctx);
  const common: AiReviewProposalInput = {
    ...(payeeName === undefined ? {} : { payeeName }),
    ...(description === null ? {} : { description }),
  };

  const descriptionOnly = (
    reason: ReceiptProposalReason | null,
  ): ReceiptProposal =>
    Object.keys(common).length === 0
      ? { input: null, kind: "none", reason }
      : { input: common, kind: "description_only", reason };

  if (!parsed.complete) return descriptionOnly(parsed.reason);
  if (
    Math.round(Math.abs(tx.amount) * MONEY_UNITS) !== expectedAmount(parsed)
  ) {
    return descriptionOnly("amount_differs");
  }

  const lines = receiptLines(parsed);
  const names: string[] = [];
  for (const line of lines) {
    const name =
      line.categoryId === null
        ? undefined
        : ctx.categoryNames.get(line.categoryId);
    if (name === undefined) return descriptionOnly("category_missing");
    names.push(name);
  }

  const tag = clean(ctx.tagName ?? "");
  const tags: AiReviewProposalInput =
    tag === "" ? {} : { tagNames: [cut(tag, AI_REVIEW_MAX_TAG_NAME_LENGTH)] };

  if (lines.length === 1) {
    return {
      input: {
        categoryName: names[0],
        ...(lines[0].categorySource === "ai"
          ? { categorySource: "ai" as const }
          : {}),
        ...common,
        ...tags,
      },
      kind: "single_category",
      reason: null,
    };
  }

  const sign = tx.amount < 0 ? -1 : 1;
  // Signed 1/10000 units per line; what the lines miss the transaction by, when
  // within the profile's balance tolerance, goes to the LAST line so the split
  // sums to the transaction to the cent (integer arithmetic, never floats).
  const signedUnits = lines.map((line) => sign * line.direction * line.units);
  const missing =
    Math.round(tx.amount * MONEY_UNITS) -
    signedUnits.reduce((sum, units) => sum + units, 0);
  if (missing !== 0) {
    const last = signedUnits.length - 1;
    const adjusted = signedUnits[last] + missing;
    const sameSign = Math.sign(adjusted) === Math.sign(signedUnits[last]);
    if (Math.abs(missing) > (parsed.balanceTolerance ?? 0) || !sameSign) {
      return descriptionOnly("amount_differs");
    }
    signedUnits[last] = adjusted;
  }
  const splits: AiReviewSplitLine[] = lines.map((line, index) => ({
    categoryName: names[index],
    amount: roundMoney(signedUnits[index] / MONEY_UNITS),
    ...(line.memo ? { memo: line.memo } : {}),
    ...(line.categorySource === "ai" ? { categorySource: "ai" as const } : {}),
  }));
  const splitTotal = sumMoney(splits.map((split) => split.amount));
  if (
    Math.round(splitTotal * MONEY_UNITS) !== Math.round(tx.amount * MONEY_UNITS)
  ) {
    // Complete but not payable as split: the email's total is the list price
    // and no `paid` says what the bank was charged after the discount.
    return descriptionOnly("amount_differs");
  }
  return {
    input: { splits, ...common, ...tags },
    kind: "itemized",
    reason: null,
  };
}
