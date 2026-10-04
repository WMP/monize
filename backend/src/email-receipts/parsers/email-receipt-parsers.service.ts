import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DataSource, EntityManager, In, QueryDeepPartialEntity } from "typeorm";
import { AiReviewRequestsService } from "../../ai-review/ai-review-requests.service";
import { withScopedDb } from "../../common/db/scoped-db";
import { tr } from "../../i18n/translate";
import { Payee } from "../../payees/entities/payee.entity";
import { EmailReceiptParser } from "../entities/email-receipt-parser.entity";
import { EmailReceipt } from "../entities/email-receipt.entity";
import {
  matchReceipt,
  type ReceiptMatchResult,
} from "../matching/match-receipt";
import { effectiveReceiptDate } from "../imap/forwarded-receipt";
import { loadReceiptCandidates } from "../pipeline/receipt-candidates";
import { ReceiptSourceLines } from "../pipeline/receipt-source-lines";
import {
  parseReceiptLinesTraced,
  type ReceiptOutcome,
} from "../parsing/parse-receipt";
import type {
  ParsedReceipt,
  ReceiptParserDefinition,
  ReceiptTrace,
} from "../parsing/receipt-parser.types";
import {
  collectParserCategoryIds,
  validateReceiptParserDefinition,
} from "../parsing/receipt-parser.validation";
import { isReceiptDomain } from "./dto/receipt-domain.validator";
import { RECEIPT_PARSER_DRAFT_INSTRUCTION } from "./parser-draft-instruction";
import {
  ApproveEmailReceiptParserDto,
  CreateEmailReceiptParserDto,
  TestEmailReceiptParserDto,
  UpdateEmailReceiptParserDto,
} from "./dto/email-receipt-parser.dto";
import {
  toParserView,
  type EmailReceiptParserView,
} from "./email-receipt-parser.view";
import {
  assertParserReferencesOwned,
  invalidDefinitionError,
} from "./parser-references.util";

/** A user holds at most this many parsers: the pipeline reads them all for each email. */
export const MAX_PARSERS_PER_USER = 200;

/** What "draft a parser with AI" answers: the request that now waits for an agent. */
export interface ParserDraftRequestResult {
  ok: true;
  requestId: string;
}

/**
 * The sender domain a parser draft is for: the most common non-empty domain of
 * the emails (the first one named wins a tie). Emails of different senders may be
 * selected together; the request is filed under the one most of them share.
 */
export function dominantSenderDomain(domains: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const domain of domains) {
    if (domain !== "") counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }
  let best = "";
  let bestCount = 0;
  for (const [domain, count] of counts) {
    if (count > bestCount) {
      best = domain;
      bestCount = count;
    }
  }
  return best;
}

/** What a parser test returns: the read, and what the matcher would do with it. */
export interface EmailReceiptParserTestResult {
  parsed: ParsedReceipt;
  /** Which entry and which line read each value (see `ReceiptTrace`). */
  trace: ReceiptTrace;
  /** `read`, or the guard (`requireLine`, `skipIfLine`, `waitIfLine`) that stops the pipeline reading it. */
  outcome: ReceiptOutcome;
  match: ReceiptMatchResult;
  /** Candidate transactions the matcher was given (at most 200). */
  candidateCount: number;
  /** The matched transaction, when there is one. */
  transaction: {
    id: string;
    date: string;
    amount: number;
    payeeName: string | null;
  } | null;
}

/**
 * The parsers a user owns (design sections 5 and 8): create, edit under a
 * compare-and-swap revision, approve, delete, and test a draft definition
 * against a stored email without writing anything. A definition is validated by
 * the one validator the AI draft also passes; a payee or category the user does
 * not own is refused in the write's own transaction.
 *
 * It also queues "draft a parser with AI" requests (`requestAiDraft`, no
 * provider call: an assistant or an MCP agent answers them with the
 * `email_receipt_parsers` tool) and closes the loop on them: approving a draft
 * marks the request that proposed it `applied`, and deleting it dismisses that
 * request, each in the transaction of the change itself.
 */
@Injectable()
export class EmailReceiptParsersService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly requests: AiReviewRequestsService,
  ) {}

  async list(userId: string): Promise<EmailReceiptParserView[]> {
    const rows = await withScopedDb(this.dataSource, (m) =>
      m.getRepository(EmailReceiptParser).find({
        where: { userId },
        order: { name: "ASC", id: "ASC" },
        take: MAX_PARSERS_PER_USER * 5,
      }),
    );
    return rows.map(toParserView);
  }

  async get(userId: string, id: string): Promise<EmailReceiptParserView> {
    const row = await withScopedDb(this.dataSource, (m) =>
      m.getRepository(EmailReceiptParser).findOne({ where: { id, userId } }),
    );
    if (!row) throw parserNotFound(id);
    return toParserView(row);
  }

  /** A manual parser is approved on creation: the person who wrote it is the approval. */
  async create(
    userId: string,
    dto: CreateEmailReceiptParserDto,
  ): Promise<EmailReceiptParserView> {
    const definition = validDefinition(dto.definition);
    const row = await withScopedDb(this.dataSource, async (m) => {
      const repo = m.getRepository(EmailReceiptParser);
      // The cap is a bound on work per email, not a security limit: two
      // concurrent creates can overshoot it by one.
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
        payeeId: dto.payeeId ?? null,
        categoryIds: collectParserCategoryIds(definition),
      });
      return repo.save(
        repo.create({
          userId,
          name: dto.name,
          payeeId: dto.payeeId ?? null,
          fromDomains: unique(dto.fromDomains),
          subjectContains: unique(dto.subjectContains ?? []),
          definition: definition as unknown as Record<string, unknown>,
          status: "approved",
          source: "manual",
          approvedAt: new Date(),
        }),
      );
    });
    return toParserView(row);
  }

  /**
   * Change a parser the caller has read at `expectedRevision`. The row is locked
   * first and the revision compared under the lock (404 for a missing row, 409
   * for one that has moved on), every reference is checked, and only then is
   * anything written. The status is unchanged: an approved parser stays
   * approved, because the person editing it is its author.
   */
  async update(
    userId: string,
    id: string,
    dto: UpdateEmailReceiptParserDto,
  ): Promise<EmailReceiptParserView> {
    const definition =
      dto.definition === undefined
        ? undefined
        : validDefinition(dto.definition);
    const row = await withScopedDb(this.dataSource, async (m) => {
      const repo = m.getRepository(EmailReceiptParser);
      const existing = await this.lockParser(m, userId, id);
      if (existing.revision !== dto.expectedRevision) {
        throw revisionConflict();
      }
      const payeeId =
        dto.payeeId === undefined ? existing.payeeId : (dto.payeeId ?? null);
      await assertParserReferencesOwned(m, userId, {
        payeeId: payeeId !== existing.payeeId ? payeeId : null,
        categoryIds: definition ? collectParserCategoryIds(definition) : [],
      });
      await repo.update(
        { id, userId },
        {
          ...(dto.name === undefined ? {} : { name: dto.name }),
          payeeId,
          ...(dto.fromDomains === undefined
            ? {}
            : { fromDomains: unique(dto.fromDomains) }),
          ...(dto.subjectContains === undefined
            ? {}
            : { subjectContains: unique(dto.subjectContains) }),
          ...(definition === undefined
            ? {}
            : {
                definition:
                  definition as unknown as QueryDeepPartialEntity<EmailReceiptParser>["definition"],
              }),
          revision: () => "revision + 1",
        },
      );
      return repo.findOneByOrFail({ id, userId });
    });
    return toParserView(row);
  }

  /**
   * Delete a parser. An open parser-draft request that proposed it is dismissed
   * in the same transaction, so the inbox never offers a draft that is gone; a
   * missing parser is a 404 that has written nothing (the throw rolls it back).
   */
  async remove(userId: string, id: string): Promise<void> {
    await withScopedDb(this.dataSource, async (m) => {
      const deleted = await m
        .getRepository(EmailReceiptParser)
        .delete({ id, userId });
      if (!deleted.affected) throw parserNotFound(id);
      await this.requests.dismissParserDraftsFor(m, userId, id);
    });
  }

  /**
   * Queue a request for an assistant (or an MCP agent) to write a parser from
   * 1 to 5 of the user's stored emails. No provider is called here: the request
   * waits `pending` in the AI review inbox, and the receipts page opens the chat
   * with the emails attached, or says it waits for an agent. ONE transaction holds
   * every check and the write, so a refusal has written nothing: every email must
   * be the user's (an email that is not is a 404, never read as absent) and must
   * have been read (a `skipped` one has no text), and the sender domain they share
   * must be a usable one. Several senders may be selected together; the request is
   * filed under the most common one. At most one request is open per (user,
   * domain): a new one replaces the open one (`enqueueParserDraft`).
   */
  async requestAiDraft(
    userId: string,
    receiptIds: readonly string[],
  ): Promise<ParserDraftRequestResult> {
    return withScopedDb(this.dataSource, async (m) => {
      const rows = await m.getRepository(EmailReceipt).find({
        where: { userId, id: In([...receiptIds]) },
        select: { id: true, fromDomain: true, status: true },
      });
      const byId = new Map(rows.map((row) => [row.id, row]));
      for (const id of receiptIds) {
        if (!byId.has(id)) throw receiptNotFound(id);
      }
      if (rows.some((row) => row.status === "skipped")) {
        throw new ConflictException(
          tr(
            "errors.emailReceipts.receiptSkipped",
            "This email could not be read (it was too large or could not be decoded), so there is nothing to process.",
          ),
        );
      }
      const domain = dominantSenderDomain(
        receiptIds.map((id) => byId.get(id)?.fromDomain ?? ""),
      );
      if (!isReceiptDomain(domain)) {
        throw new BadRequestException(
          tr(
            "errors.emailReceipts.receiptNoSender",
            "This email has no usable sender domain, so a parser cannot be drafted for it.",
          ),
        );
      }
      const request = await this.requests.enqueueParserDraft(m, userId, {
        emailReceiptIds: receiptIds,
        parserDomain: domain,
        instruction: RECEIPT_PARSER_DRAFT_INSTRUCTION,
      });
      return { ok: true as const, requestId: request.id };
    });
  }

  /**
   * Draft to approved. Under the row lock, the stored definition must pass the
   * validator now (a draft restored from a backup can be `{}`) and every
   * category it names must still be the user's. Approving an approved parser is
   * a no-op. With `expectedRevision` the approval is of the version the person
   * read, not of an edit that landed since.
   */
  async approve(
    userId: string,
    id: string,
    dto: ApproveEmailReceiptParserDto = {},
  ): Promise<EmailReceiptParserView> {
    const row = await withScopedDb(this.dataSource, async (m) => {
      const repo = m.getRepository(EmailReceiptParser);
      const existing = await this.lockParser(m, userId, id);
      if (
        dto.expectedRevision !== undefined &&
        existing.revision !== dto.expectedRevision
      ) {
        throw revisionConflict();
      }
      if (existing.status === "approved") return existing;
      const definition = validDefinition(existing.definition);
      await assertParserReferencesOwned(m, userId, {
        payeeId: existing.payeeId,
        categoryIds: collectParserCategoryIds(definition),
      });
      await repo.update(
        { id, userId },
        {
          status: "approved",
          approvedAt: new Date(),
          revision: () => "revision + 1",
        },
      );
      // The request an agent answered with this draft is done with it: applied in
      // the same transaction as the approval, so the two commit or roll back
      // together. Nothing matching is fine (a draft written by hand).
      await this.requests.markParserDraftApplied(m, userId, id);
      return repo.findOneByOrFail({ id, userId });
    });
    return toParserView(row);
  }

  /**
   * Read a stored email with a definition that is not saved, and show what the
   * matcher would do with the result. Reads only: nothing is written.
   */
  async test(
    userId: string,
    dto: TestEmailReceiptParserDto,
  ): Promise<EmailReceiptParserTestResult> {
    const definition = validDefinition(dto.definition);
    return withScopedDb(this.dataSource, async (m) => {
      const receipt = await m.getRepository(EmailReceipt).findOne({
        where: { id: dto.receiptId, userId },
      });
      if (!receipt) {
        throw new NotFoundException(
          tr(
            "errors.emailReceipts.receiptNotFound",
            `Email ${dto.receiptId} not found`,
            { id: dto.receiptId },
          ),
        );
      }
      const payee = dto.payeeId
        ? await m.getRepository(Payee).findOne({
            where: { id: dto.payeeId, userId },
            select: { id: true, defaultCategoryId: true },
          })
        : null;
      if (dto.payeeId && !payee) {
        throw new NotFoundException(
          tr(
            "errors.emailReceipts.parserPayeeNotFound",
            "The payee of this parser was not found.",
          ),
        );
      }
      // The lines of the source the definition chose (`text` or `html`); the
      // trace's line numbers refer to them. `no_html`: it reads HTML, the email has none.
      const { parsed, trace, outcome } = parseReceiptLinesTraced(
        definition,
        receipt.subject,
        new ReceiptSourceLines(receipt).forSource(definition.source),
        payee?.defaultCategoryId ?? null,
      );
      // Centred on the day the shop sent the order when a forward carried it.
      const purchaseDate = effectiveReceiptDate(receipt)
        .toISOString()
        .slice(0, 10);
      const candidates = await loadReceiptCandidates(
        m,
        userId,
        purchaseDate,
        receipt.id,
      );
      const match = matchReceipt(
        parsed,
        purchaseDate,
        candidates,
        payee?.id ?? null,
      );
      const hit =
        match.kind === "matched"
          ? candidates.find((c) => c.id === match.transactionId)
          : undefined;
      return {
        parsed,
        trace,
        outcome,
        match,
        candidateCount: candidates.length,
        transaction: hit
          ? {
              id: hit.id,
              date: hit.transactionDate,
              amount: hit.amount,
              payeeName: hit.payeeName,
            }
          : null,
      };
    });
  }

  private async lockParser(
    m: EntityManager,
    userId: string,
    id: string,
  ): Promise<EmailReceiptParser> {
    const row = await m.getRepository(EmailReceiptParser).findOne({
      where: { id, userId },
      lock: { mode: "pessimistic_write" },
    });
    if (!row) throw parserNotFound(id);
    return row;
  }
}

/** The definition, or the 400 that lists every code the validator found. Never throws otherwise. */
function validDefinition(input: unknown): ReceiptParserDefinition {
  const validation = validateReceiptParserDefinition(input);
  if (!validation.ok) throw invalidDefinitionError(validation.errors);
  return validation.definition;
}

const unique = (values: readonly string[]): string[] => [...new Set(values)];

function receiptNotFound(id: string): NotFoundException {
  return new NotFoundException(
    tr("errors.emailReceipts.receiptNotFound", `Email ${id} not found`, { id }),
  );
}

function parserNotFound(id: string): NotFoundException {
  return new NotFoundException(
    tr(
      "errors.emailReceipts.parserNotFound",
      `Receipt parser ${id} not found`,
      { id },
    ),
  );
}

function revisionConflict(): ConflictException {
  return new ConflictException(
    tr(
      "errors.emailReceipts.parserRevisionConflict",
      "This parser was changed since you opened it. Reload it and try again.",
    ),
  );
}
