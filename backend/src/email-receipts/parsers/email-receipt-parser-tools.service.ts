import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DataSource, EntityManager, In, QueryDeepPartialEntity } from "typeorm";
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
import { effectiveMatchDefinition } from "../parsing/receipt-match-config";
import { resolveParserCategoryNames } from "./parser-category-names.util";
import type { ReceiptMatchStrategy } from "../parsing/receipt-parser.types";
import type { ReceiptOutcome } from "../parsing/parse-receipt";
import {
  compareWithExpected,
  dryRunReceipt,
  loadTransactionSummaries,
  type ExpectedAgreement,
} from "./receipt-dry-run";
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
  /** What the profile's `reference` field read; null when none. */
  reference: string | null;
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

/**
 * What the profile's matching would do with one tested email, compactly: the
 * strategy that decided, the transaction it matched, how many candidates each
 * strategy kept (spec 3a). Reads only.
 */
export interface ParserToolMatch {
  outcome: "matched" | "ambiguous" | "unmatched";
  /** The strategy that matched or found several candidates; null when none did. */
  strategy: ReceiptMatchStrategy | null;
  transaction: {
    id: string;
    date: string;
    amount: number;
    payeeName: string | null;
  } | null;
  /** Candidates inside the profile's date window. */
  considered: number;
  attempts: Array<{ strategy: ReceiptMatchStrategy; count: number }>;
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
  /** What the definition's `match` section would do with this email (design 5.5). */
  match: ParserToolMatch;
  /**
   * The transaction the caller says this email paid for and whether the parsed
   * date and total agree with it; null when the sample named none.
   */
  expected: {
    transactionId: string;
    date: string;
    amount: number;
    currencyCode: string;
    payeeName: string | null;
  } | null;
  agreement: ExpectedAgreement | null;
}

/** One sample of a `test` call: an email, and optionally the transaction it paid for. */
export interface ParserToolSample {
  receiptId: string;
  transactionId?: string;
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
  /**
   * Whether every sample that named an expected transaction agrees with it on
   * date and total; null when no sample named one.
   */
  allAgree: boolean | null;
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
  /**
   * Update this DRAFT parser instead of creating one; `expectedRevision` is then
   * required and must still be the draft's revision (compare-and-swap under the
   * row lock). An approved parser is never changed by the tool.
   */
  parserId?: string;
  expectedRevision?: number;
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
  /** The draft's revision after this save (1 for a new draft). */
  revision: number;
  fromDomains: string[];
  /** The payee the name resolved to, or null when none did (nothing is created). */
  payee: { id: string; name: string } | null;
  /** The matching the saved profile effectively has (defaults filled in). */
  match: ReturnType<typeof effectiveMatchDefinition>;
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
    reference: parsed.reference ?? null,
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
   * The definition with the category NAMES it carries (`defaultCategory`, ...)
   * turned into the user's category ids, so an agent may write either. An
   * unknown or ambiguous name is a 400 naming it; nothing is written.
   */
  private resolveNames(userId: string, definition: unknown): Promise<unknown> {
    return withScopedDb(this.dataSource, (m) =>
      resolveParserCategoryNames(m, userId, definition),
    );
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
      /** Emails to read; `samples` (which may also name the expected transaction) takes precedence. */
      receiptIds?: readonly string[];
      samples?: readonly ParserToolSample[];
      payeeName?: string;
    },
  ): Promise<ParserToolTestResult> {
    const samples: readonly ParserToolSample[] =
      input.samples ??
      (input.receiptIds ?? []).map((receiptId) => ({ receiptId }));
    if (samples.length < 1 || samples.length > PARSER_TOOL_MAX_RECEIPTS) {
      throw new ConflictException(
        tr(
          "errors.emailReceipts.parserToolReceiptCount",
          "Name 1 to 5 emails to test the parser on.",
        ),
      );
    }
    const validation = validateReceiptParserDefinition(
      withVersion(await this.resolveNames(userId, input.definition)),
    );
    if (!validation.ok) {
      return {
        valid: false,
        errors: validation.errors,
        unknownCategoryIds: [],
        emails: [],
        allComplete: false,
        allAgree: null,
      };
    }
    const definition: ReceiptParserDefinition = validation.definition;
    const payee = input.payeeName
      ? await this.payees.resolveByName(userId, input.payeeName)
      : null;

    return withScopedDb(this.dataSource, async (m) => {
      const receipts = await m.getRepository(EmailReceipt).find({
        where: { userId, id: In(samples.map((sample) => sample.receiptId)) },
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
      const expectedIds = samples.flatMap((sample) =>
        sample.transactionId ? [sample.transactionId] : [],
      );
      const transactions = await loadTransactionSummaries(
        m,
        userId,
        expectedIds,
      );
      const emails: ParserToolTestEmail[] = [];
      for (const sample of samples) {
        const receipt = byId.get(sample.receiptId);
        if (!receipt) throw receiptNotFound(sample.receiptId);
        const expectedTx = sample.transactionId
          ? transactions.get(sample.transactionId)
          : undefined;
        if (sample.transactionId && !expectedTx) {
          throw new NotFoundException(
            tr(
              "errors.emailReceipts.transactionNotFound",
              "That transaction was not found.",
            ),
          );
        }
        const run = await dryRunReceipt(m, userId, definition, receipt, payee);
        const { parsed, trace, outcome, match: matched, hit } = run;
        emails.push({
          receiptId: receipt.id,
          subject: receipt.subject,
          effectiveDate: run.effectiveDate.toISOString(),
          parsed: toLlmParsed(parsed, categoryNames),
          outcome,
          trace: { ...trace, items: trace.items.slice(0, TRACE_MAX_ITEMS) },
          match: {
            outcome: matched.kind,
            strategy: matched.kind === "unmatched" ? null : matched.strategy,
            transaction: hit
              ? {
                  id: hit.id,
                  date: hit.transactionDate,
                  amount: hit.amount,
                  payeeName: hit.payeeName,
                }
              : null,
            considered: matched.considered,
            attempts: matched.attempts.map((attempt) => ({
              strategy: attempt.strategy,
              count: attempt.count,
            })),
          },
          expected: expectedTx
            ? {
                transactionId: expectedTx.id,
                date: expectedTx.date,
                amount: expectedTx.amount,
                currencyCode: expectedTx.currencyCode,
                payeeName: expectedTx.payeeName,
              }
            : null,
          agreement: expectedTx
            ? compareWithExpected(
                parsed,
                run.purchaseDate,
                run.matchConfig,
                expectedTx,
              )
            : null,
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
        allAgree: emails.some((email) => email.agreement !== null)
          ? emails.every((email) => email.agreement?.agrees !== false)
          : null,
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
      withVersion(await this.resolveNames(userId, input.definition)),
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
      const existing = input.parserId
        ? await this.lockDraft(
            m,
            userId,
            input.parserId,
            input.expectedRevision,
          )
        : null;
      if (
        !existing &&
        (await repo.count({ where: { userId } })) >= MAX_PARSERS_PER_USER
      ) {
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
      let saved: EmailReceiptParser;
      if (existing) {
        await repo.update(
          { id: existing.id, userId },
          {
            name,
            payeeId: payee?.id ?? null,
            fromDomains,
            subjectContains,
            definition:
              definition as unknown as QueryDeepPartialEntity<EmailReceiptParser>["definition"],
            revision: () => "revision + 1",
          },
        );
        saved = await repo.findOneByOrFail({ id: existing.id, userId });
      } else {
        saved = await repo.save(
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
      }
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
        revision: saved.revision,
        fromDomains: saved.fromDomains,
        payee: payee ? { id: payee.id, name: payee.name } : null,
        match: effectiveMatchDefinition(definition),
        requestProposed,
      };
    });
  }

  /**
   * Lock the draft an update targets and refuse unless it is the user's, still a
   * draft (an approved parser reads mail and is only ever changed by a person)
   * and still at `expectedRevision`. Runs in the transaction of the write, under
   * the row lock, so a refusal has written nothing.
   */
  private async lockDraft(
    m: EntityManager,
    userId: string,
    parserId: string,
    expectedRevision: number | undefined,
  ): Promise<EmailReceiptParser> {
    const row = await m.getRepository(EmailReceiptParser).findOne({
      where: { id: parserId, userId },
      lock: { mode: "pessimistic_write" },
    });
    if (!row) {
      throw new NotFoundException(
        tr(
          "errors.emailReceipts.parserNotFound",
          `Receipt parser ${parserId} not found`,
          { id: parserId },
        ),
      );
    }
    if (row.status !== "draft") {
      throw new ConflictException(
        tr(
          "errors.emailReceipts.parserNotDraft",
          "Only a draft parser can be updated by the assistant. This one is approved.",
        ),
      );
    }
    if (expectedRevision === undefined || row.revision !== expectedRevision) {
      throw new ConflictException(
        tr(
          "errors.emailReceipts.parserRevisionConflict",
          "This parser was changed since you opened it. Reload it and try again.",
        ),
      );
    }
    return row;
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
