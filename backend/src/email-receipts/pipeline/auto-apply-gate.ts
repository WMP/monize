import type { EmailReceiptParserStatus } from "../entities/email-receipt-parser.entity";
import type { EmailReceiptMatchKind } from "../entities/email-receipt.entity";
import { receiptMatchAmount } from "../matching/match-receipt";
import type { ParsedReceipt } from "../parsing/receipt-parser.types";
import type { ReceiptProposalKind } from "../proposal/build-receipt-proposal";

/** What `autoApplyAllowed` reads: every condition of spec section 7. */
export interface AutoApplyFacts {
  mailboxAutoApply: boolean;
  /** The parser that matched the sender; `draft` stands for none (a draft never reads mail). */
  parserStatus: EmailReceiptParserStatus;
  parsed: ParsedReceipt;
  /** Signed, as stored. */
  transactionAmount: number;
  matchKind: EmailReceiptMatchKind;
  proposalKind: ReceiptProposalKind;
  /** The itemized proposal was refused and the description-only one stored instead. */
  usedFallback: boolean;
  cardBuilt: boolean;
}

const MONEY_UNITS = 10000;

/**
 * Spec section 7. Applies only when every condition holds: the mailbox opted in;
 * the parser is `approved`; the parse is `complete` and was read by a parser
 * (never by the email's schema.org markup); `abs(T)` equals the parsed total;
 * the match is by order number or by amount plus payee; the card was built.
 * Stricter than the spec in one way: the stored proposal must be the
 * category lines themselves (itemized or one category), not a description-only
 * proposal or the fallback of a refused one, because the design promises that
 * what is applied "balances to the cent".
 */
export function autoApplyAllowed(facts: AutoApplyFacts): boolean {
  return (
    facts.mailboxAutoApply &&
    facts.parserStatus === "approved" &&
    facts.parsed.complete &&
    // The email's own markup is no approved parser's reading: a person looks first.
    facts.parsed.source !== "schema_org" &&
    receiptMatchAmount(facts.parsed) !== null &&
    Math.round(Math.abs(facts.transactionAmount) * MONEY_UNITS) ===
      receiptMatchAmount(facts.parsed) &&
    (facts.matchKind === "order_id" || facts.matchKind === "amount_payee") &&
    (facts.proposalKind === "itemized" ||
      facts.proposalKind === "single_category") &&
    !facts.usedFallback &&
    facts.cardBuilt
  );
}
