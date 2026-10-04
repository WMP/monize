import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DataSource, EntityManager, In } from "typeorm";
import { AiReviewRequestsService } from "../../ai-review/ai-review-requests.service";
import { loadQualifiedCategoryNames } from "../../categories/category-name.util";
import { returnedRows } from "../../common/db/query-result";
import { withScopedDb } from "../../common/db/scoped-db";
import { roundMoney } from "../../common/round.util";
import { tr } from "../../i18n/translate";
import { PayeesService } from "../../payees/payees.service";
import {
  EmailReceiptParser,
  EMAIL_RECEIPT_PARSER_MAX_FROM_DOMAINS,
  EMAIL_RECEIPT_PARSER_MAX_SUBJECT_WORDS,
} from "../entities/email-receipt-parser.entity";
import { EmailReceipt } from "../entities/email-receipt.entity";
import { EMAIL_RECEIPT_PARSER_LANGUAGE_GUIDE } from "./parser-tool.guide";
import { effectiveReceiptDate } from "../imap/forwarded-receipt";
import { ReceiptSourceLines } from "../pipeline/receipt-source-lines";
import {
  parseReceiptLinesTraced,
  type ReceiptOutcome,
} from "../parsing/parse-receipt";
import {
  RECEIPT_PARSER_VERSION,
  type ParsedReceipt,
  type ReceiptParserDefinition,
  type ReceiptTrace,
} from "../parsing/receipt-parser.types";
import {
  collectParserCategoryIds,
  validateReceiptParserDefinition,
  type ReceiptParserValidationError,
} from "../parsing/receipt-parser.validation";
import {
  isReceiptDomain,
  normalizeReceiptDomain,
} from "./dto/receipt-domain.validator";
import { MAX_PARSERS_PER_USER } from "./email-receipt-parsers.service";
import {
  assertParserReferencesOwned,
  invalidDefinitionError,
} from "./parser-references.util";

/**
 * The `email_receipt_parsers` tool's logic (the assistant's executor and the MCP
 * tool are thin adapters over it, `docs/backend/ai-and-payees.md` "Shared AI
 * tools"): everything an agent needs to write a receipt parser from stored
 * emails, and nothing that touches the ledger or reads mail.
 *
 * - `listCategories`: the category ids a parser names, with qualified names.
 * - `testDefinition`: read stored emails with a definition that is not saved and
 *   report what it parsed. Reads only.
 * - `saveDraft`: store the definition as a DRAFT parser (`status: draft`,
 *   `source: ai`). A draft reads no email until the user approves it, so this is
 *   not a write to anything that moves money (INV-RECEIPT-003); the user's
 *   approval in the settings screen is the confirmation.
 *
 * Every read and write is keyed on `userId` (the JWT's, or the MCP context's),
 * never on an argument: an email or category that is not the user's reads as
 * absent.
 */

/** Categories one `categories` call returns. */
export const PARSER_TOOL_MAX_CATEGORIES = 300;
/** Emails one `test` call reads (the same bound a draft request has). */
export const PARSER_TOOL_MAX_RECEIPTS = 5;

const MONEY_UNITS = 10_000;
const MAX_NAME_LENGTH = 100;
const MAX_SUBJECT_WORD_LENGTH = 100;

/** A parsed receipt as a model reads it: decimal amounts, category names. */
export interface LlmParsedReceipt {
  orderId: string | null;
  total: number | null;
  paid: number | null;
  payee: string | null;
  shipping: number | null;
  discount: number | null;
  items: Array<{
    name: string;
    qty: number;
    amount: number;
    category: string | null;
  }>;
  complete: boolean;
  reason: ParsedReceipt["reason"];
}

export interface ParserToolTestEmail {
  receiptId: string;
  subject: string;
  /** ISO timestamp: the day the shop sent the order, or the day the email arrived. */
  effectiveDate: string;
  parsed: LlmParsedReceipt;
  /** `read`, or the guard that stops the pipeline reading this email under the parser. */
  outcome: ReceiptOutcome;
  /** Which entry and which line read each value; at most 20 items are traced. */
  trace: ReceiptTrace;
}

/** Items a `test` result traces (the rest are counted in `parsed`). */
const TRACE_MAX_ITEMS = 20;

export interface ParserToolTestResult {
  /** False when the definition failed validation; `errors` says where and why. */
  valid: boolean;
  errors: ReceiptParserValidationError[];
  /** Category ids the definition names that are not the user's. */
  unknownCategoryIds: string[];
  emails: ParserToolTestEmail[];
  /** True only when the definition is valid and every email reads complete. */
  allComplete: boolean;
}

export interface ParserToolCategories {
  categories: Array<{ id: string; name: string }>;
  totalCount: number;
  truncated: boolean;
  /** The whole parser language, which the tool's description has no room for. */
  guide: string;
}

export interface ParserToolSaveInput {
  /** The claimed parser-draft request this draft answers, when there is one. */
  requestId?: string;
  name: string;
  fromDomains: string[];
  subjectContains?: string[];
  /** Resolved with the payee lookup the other tools use; never created. */
  payeeName?: string;
  definition: unknown;
}

export interface ParserToolSaveResult {
  parserId: string;
  name: string;
  status: "draft";
  fromDomains: string[];
  /** The payee the name resolved to, or null when none did (nothing is created). */
  payee: { id: string; name: string } | null;
  /** True when the request named by `requestId` is now `proposed`. */
  requestProposed: boolean;
}

/** A model may leave the version out; it has still written a parser of the current version. */
function withVersion(definition: unknown): unknown {
  return typeof definition === "object" &&
    definition !== null &&
    !Array.isArray(definition)
    ? {
        version: RECEIPT_PARSER_VERSION,
        ...(definition as Record<string, unknown>),
      }
    : definition;
}

const units = (value: number | null): number | null =>
  value === null ? null : roundMoney(value / MONEY_UNITS);

function toLlmParsed(
  parsed: ParsedReceipt,
  categoryNames: ReadonlyMap<string, string>,
): LlmParsedReceipt {
  return {
    orderId: parsed.orderId,
    total: units(parsed.total),
    paid: units(parsed.paid ?? null),
    payee: parsed.payee ?? null,
    shipping: units(parsed.shipping),
    discount: units(parsed.discount),
    items: parsed.items.map((item) => ({
      name: item.name,
      qty: item.qty,
      amount: roundMoney(item.amount / MONEY_UNITS),
      category:
        item.categoryId === null
          ? null
          : (categoryNames.get(item.categoryId) ?? null),
    })),
    complete: parsed.complete,
    reason: parsed.reason,
  };
}

@Injectable()
export class EmailReceiptParserToolsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly payees: PayeesService,
    private readonly requests: AiReviewRequestsService,
  ) {}

  /**
   * The user's categories as `id` and qualified name (`Parent: Child`), for a
   * parser's `categoryRules`, `defaultCategoryId` and `shippingCategoryId`. At
   * most `PARSER_TOOL_MAX_CATEGORIES`; `truncated` says more exist.
   */
  async listCategories(userId: string): Promise<ParserToolCategories> {
    const names = await withScopedDb(this.dataSource, (m) =>
      loadQualifiedCategoryNames(m, userId),
    );
    const all = [...names.entries()];
    return {
      categories: all
        .slice(0, PARSER_TOOL_MAX_CATEGORIES)
        .map(([id, name]) => ({ id, name })),
      totalCount: all.length,
      truncated: all.length > PARSER_TOOL_MAX_CATEGORIES,
      guide: EMAIL_RECEIPT_PARSER_LANGUAGE_GUIDE,
    };
  }

  /**
   * Read 1 to 5 of the user's stored emails with a definition that is not saved.
   * An invalid definition is a RESULT (`valid: false` and every error with its
   * path), not an exception, so the agent can fix it and test again. Reads only:
   * nothing is written and no email changes. A category id the definition names
   * that is not the user's is listed in `unknownCategoryIds`: the draft would be
   * refused on save.
   */
  async testDefinition(
    userId: string,
    input: {
      definition: unknown;
      receiptIds: readonly string[];
      payeeName?: string;
    },
  ): Promise<ParserToolTestResult> {
    if (
      input.receiptIds.length < 1 ||
      input.receiptIds.length > PARSER_TOOL_MAX_RECEIPTS
    ) {
      throw new ConflictException(
        tr(
          "errors.emailReceipts.parserToolReceiptCount",
          "Name 1 to 5 emails to test the parser on.",
        ),
      );
    }
    const validation = validateReceiptParserDefinition(
      withVersion(input.definition),
    );
    if (!validation.ok) {
      return {
        valid: false,
        errors: validation.errors,
        unknownCategoryIds: [],
        emails: [],
        allComplete: false,
      };
    }
    const definition: ReceiptParserDefinition = validation.definition;
    const payee = input.payeeName
      ? await this.payees.resolveByName(userId, input.payeeName)
      : null;

    return withScopedDb(this.dataSource, async (m) => {
      const receipts = await m.getRepository(EmailReceipt).find({
        where: { userId, id: In([...input.receiptIds]) },
        select: {
          id: true,
          subject: true,
          bodyText: true,
          bodyHtml: true,
          receivedAt: true,
          originalSentAt: true,
        },
      });
      const byId = new Map(receipts.map((r) => [r.id, r]));
      const categoryNames = await loadQualifiedCategoryNames(m, userId);
      const emails: ParserToolTestEmail[] = [];
      for (const id of input.receiptIds) {
        const receipt = byId.get(id);
        if (!receipt) throw receiptNotFound(id);
        const { parsed, trace, outcome } = parseReceiptLinesTraced(
          definition,
          receipt.subject,
          new ReceiptSourceLines(receipt).forSource(definition.source),
          payee?.defaultCategoryId ?? null,
        );
        emails.push({
          receiptId: receipt.id,
          subject: receipt.subject,
          effectiveDate: effectiveReceiptDate(receipt).toISOString(),
          parsed: toLlmParsed(parsed, categoryNames),
          outcome,
          trace: { ...trace, items: trace.items.slice(0, TRACE_MAX_ITEMS) },
        });
      }
      const unknownCategoryIds = collectParserCategoryIds(definition).filter(
        (id) => !categoryNames.has(id),
      );
      return {
        valid: true,
        errors: [],
        unknownCategoryIds,
        emails,
        allComplete:
          unknownCategoryIds.length === 0 &&
          emails.every((email) => email.parsed.complete),
      };
    });
  }

  /**
   * Store a definition as a DRAFT parser and, when `requestId` names a
   * parser-draft request the caller has claimed, mark that request `proposed`
   * with `{ parserId }`. ONE transaction holds every check and every write, so a
   * refusal has written nothing: the request row is locked and checked first
   * (the user's, `email_parser_draft`, `claimed` by `caller`, not expired: else a
   * 409/404), then the parser cap, the payee and category ownership, the INSERT,
   * and the request's conditional UPDATE (`proposeParserDraft`).
   *
   * The definition goes through the one validator a person's parser passes. The
   * payee is looked up by name (`PayeesService.resolveByName`) and never created:
   * an unknown name leaves the parser without a payee, and the result says so.
   */
  async saveDraft(
    userId: string,
    caller: string,
    input: ParserToolSaveInput,
  ): Promise<ParserToolSaveResult> {
    const validation = validateReceiptParserDefinition(
      withVersion(input.definition),
    );
    if (!validation.ok) throw invalidDefinitionError(validation.errors);
    const definition = validation.definition;
    const name = input.name.trim().slice(0, MAX_NAME_LENGTH);
    const fromDomains = [
      ...new Set(
        input.fromDomains
          .slice(0, EMAIL_RECEIPT_PARSER_MAX_FROM_DOMAINS)
          .map((domain) => normalizeReceiptDomain(domain) as string),
      ),
    ];
    if (
      name === "" ||
      fromDomains.length === 0 ||
      !fromDomains.every(isReceiptDomain)
    ) {
      throw new ConflictException(
        tr(
          "errors.emailReceipts.parserToolInvalidSender",
          "A draft needs a name and one to ten sender domains such as shop.example.com.",
        ),
      );
    }
    const subjectContains = [
      ...new Set(
        (input.subjectContains ?? [])
          .slice(0, EMAIL_RECEIPT_PARSER_MAX_SUBJECT_WORDS)
          .map((word) =>
            word.trim().toLowerCase().slice(0, MAX_SUBJECT_WORD_LENGTH),
          )
          .filter((word) => word !== ""),
      ),
    ];
    const payee = input.payeeName
      ? await this.payees.resolveByName(userId, input.payeeName)
      : null;

    return withScopedDb(this.dataSource, async (m) => {
      if (input.requestId) {
        await this.lockClaimedRequest(m, userId, caller, input.requestId);
      }
      const repo = m.getRepository(EmailReceiptParser);
      if ((await repo.count({ where: { userId } })) >= MAX_PARSERS_PER_USER) {
        throw new ConflictException(
          tr(
            "errors.emailReceipts.tooManyParsers",
            `At most ${MAX_PARSERS_PER_USER} parsers can be saved. Delete one first.`,
            { max: MAX_PARSERS_PER_USER },
          ),
        );
      }
      await assertParserReferencesOwned(m, userId, {
        payeeId: payee?.id ?? null,
        categoryIds: collectParserCategoryIds(definition),
      });
      const saved = await repo.save(
        repo.create({
          userId,
          name,
          payeeId: payee?.id ?? null,
          fromDomains,
          subjectContains,
          definition: definition as unknown as Record<string, unknown>,
          status: "draft",
          source: "ai",
          approvedAt: null,
        }),
      );
      let requestProposed = false;
      if (input.requestId) {
        requestProposed = await this.requests.proposeParserDraft(
          m,
          userId,
          input.requestId,
          caller,
          saved.id,
        );
        // The row was locked and checked above, so a miss here means the claim
        // moved in between: refuse, and the throw rolls the parser back.
        if (!requestProposed) throw requestNotClaimed();
      }
      return {
        parserId: saved.id,
        name: saved.name,
        status: "draft" as const,
        fromDomains: saved.fromDomains,
        payee: payee ? { id: payee.id, name: payee.name } : null,
        requestProposed,
      };
    });
  }

  /**
   * Lock the named request and refuse unless it is the user's parser-draft
   * request, claimed by `caller` and still alive. The check runs before the
   * parser is written, in the same transaction, so a refusal has written nothing.
   */
  private async lockClaimedRequest(
    m: EntityManager,
    userId: string,
    caller: string,
    requestId: string,
  ): Promise<void> {
    const rows = returnedRows<{
      kind: string;
      status: string;
      claimed_by: string | null;
      live: boolean;
    }>(
      await m.query(
        `SELECT kind, status, claimed_by,
                (expires_at > CURRENT_TIMESTAMP) AS live
           FROM ai_review_requests
          WHERE id = $1
            AND user_id = $2
            FOR UPDATE`,
        [requestId, userId],
      ),
    );
    const row = rows[0];
    if (!row) {
      throw new NotFoundException(
        tr(
          "errors.aiReview.notFound",
          `AI review request with ID ${requestId} not found`,
          { id: requestId },
        ),
      );
    }
    if (
      row.kind !== "email_parser_draft" ||
      row.status !== "claimed" ||
      row.claimed_by !== caller ||
      !row.live
    ) {
      throw requestNotClaimed();
    }
  }
}

function requestNotClaimed(): ConflictException {
  return new ConflictException(
    tr(
      "errors.emailReceipts.parserDraftRequestNotClaimed",
      "This parser draft request is not claimed by you. Claim it first with ai_review_requests, or save the draft without a requestId.",
    ),
  );
}

function receiptNotFound(id: string): NotFoundException {
  return new NotFoundException(
    tr("errors.emailReceipts.receiptNotFound", `Email ${id} not found`, { id }),
  );
}
