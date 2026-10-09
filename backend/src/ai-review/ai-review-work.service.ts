import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from "@nestjs/common";
import { DataSource, In } from "typeorm";
import { withScopedDb } from "../common/db/scoped-db";
import { roundMoney, sumMoney } from "../common/round.util";
import { tr } from "../i18n/translate";
import { AiActionBuilderService } from "../ai/actions/ai-action-builder.service";
import type { PendingAiAction } from "../ai/actions/ai-action.types";
import { TransactionsService } from "../transactions/transactions.service";
import { TransactionToolPrepService } from "../transactions/transaction-tool-prep.service";
import { Transaction } from "../transactions/entities/transaction.entity";
import { TransactionRule } from "../transaction-rules/transaction-rule.entity";
import { EmailReceipt } from "../email-receipts/entities/email-receipt.entity";
import { AiReviewRequest } from "./ai-review-request.entity";
import { AiReviewRequestsService } from "./ai-review-requests.service";
import {
  AI_REVIEW_EMAIL_TEXT_MAX_CHARS,
  AI_REVIEW_MAX_TAG_NAME_LENGTH,
  AI_REVIEW_MAX_TAG_NAMES,
  AI_REVIEW_PARSER_EMAIL_TEXT_MAX_CHARS,
  AiReviewInboxItem,
  AiReviewProposalInput,
  AiReviewSubmitResult,
  DEFAULT_AI_REVIEW_TOOL_LIST_LIMIT,
  LlmAiReviewClaim,
  LlmAiReviewEmailReceipt,
  LlmAiReviewList,
  LlmAiReviewParserEmail,
  LlmAiReviewRequest,
  MAX_AI_REVIEW_TOOL_LIST_LIMIT,
  StoredAiReviewProposal,
} from "./ai-review-work.types";

/** Inbox page size when the caller names none, and its ceiling. */
export const DEFAULT_AI_REVIEW_INBOX_LIMIT = 50;

/** Statuses an inbox shows: everything still waiting, plus what ran out. */
const INBOX_STATUSES = ["pending", "claimed", "proposed", "expired"] as const;
const OPEN_STATUSES = ["pending", "claimed", "proposed"] as const;

/** Whether a text holds a control character (a line break included). */
function hasControlCharacter(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

interface AgentNote {
  reason: string;
  at: string;
}

function agentNoteOf(request: AiReviewRequest): AgentNote | undefined {
  const note = request.proposal?.agentNote as Partial<AgentNote> | undefined;
  return note && typeof note.reason === "string"
    ? { reason: note.reason, at: String(note.at ?? "") }
    : undefined;
}

/**
 * What the inbox says about a parser-draft request: the sender domain, how many
 * emails it names and, once an agent saved its draft, which parser that is.
 * Null for every other kind.
 */
function inboxParserDraft(
  request: AiReviewRequest,
): AiReviewInboxItem["parserDraft"] {
  if (request.kind !== "email_parser_draft") return null;
  const parserId = (request.proposal as { parserId?: unknown } | null)
    ?.parserId;
  return {
    domain: request.parserDomain ?? "",
    emailCount: request.emailReceiptIds?.length ?? 0,
    parserId: typeof parserId === "string" ? parserId : null,
  };
}

/** The inbox's view of a stored email: who, what, when -- never its text. */
function inboxEmail(
  receipt: EmailReceipt | undefined,
): AiReviewInboxItem["emailReceipt"] {
  return receipt
    ? {
        id: receipt.id,
        fromAddress: receipt.fromAddress,
        subject: receipt.subject,
        receivedAt: receipt.receivedAt.toISOString(),
      }
    : null;
}

/**
 * The AI review queue as agents and people use it (design 6.5): the shared door
 * for the MCP `ai_review_requests` tool, the assistant's tool of the same name
 * and the review inbox's REST controller, so all three return one shape.
 *
 * A proposal is never a write. `submit` validates it with the same preparation
 * an `update_transaction` from the chat uses, stores the signed action on the
 * request and stops; the person approves through `/ai/actions/confirm`, which
 * marks the request applied in the transaction that writes the edit.
 */
@Injectable()
export class AiReviewWorkService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly requests: AiReviewRequestsService,
    @Inject(forwardRef(() => TransactionsService))
    private readonly transactionsService: TransactionsService,
    @Inject(forwardRef(() => TransactionToolPrepService))
    private readonly prepService: TransactionToolPrepService,
    private readonly actionBuilder: AiActionBuilderService,
  ) {}

  private toLlm(request: AiReviewRequest, caller: string): LlmAiReviewRequest {
    const note = agentNoteOf(request);
    return {
      id: request.id,
      kind: request.kind,
      status: request.status,
      instruction: request.instruction,
      transactionId: request.transactionId,
      ruleId: request.ruleId,
      emailReceiptId: request.emailReceiptId ?? null,
      emailReceiptIds: request.emailReceiptIds ?? null,
      parserDomain: request.parserDomain ?? null,
      claimedByYou: request.claimedBy === caller,
      createdAt: request.createdAt.toISOString(),
      expiresAt: request.expiresAt.toISOString(),
      ...(note ? { agentNote: note } : {}),
    };
  }

  /** Open requests that have not expired, oldest first. */
  async list(
    userId: string,
    caller: string,
    limit?: number,
  ): Promise<LlmAiReviewList> {
    const take = Math.min(
      Math.max(Math.trunc(limit ?? DEFAULT_AI_REVIEW_TOOL_LIST_LIMIT), 1),
      MAX_AI_REVIEW_TOOL_LIST_LIMIT,
    );
    // One more than asked, so `truncated` is a fact and not a guess.
    const rows = await this.requests.listForUser(userId, {
      statuses: OPEN_STATUSES,
      unexpiredOnly: true,
      limit: take + 1,
    });
    return {
      requests: rows.slice(0, take).map((r) => this.toLlm(r, caller)),
      totalCount: Math.min(rows.length, take),
      truncated: rows.length > take,
    };
  }

  /**
   * Take the oldest pending request (or the one named by `requestId`) for
   * `caller` and read its transaction
   * through the same projection `list_transactions` uses. A read that fails
   * after the claim gives the request back rather than stranding it.
   */
  async claim(
    userId: string,
    caller: string,
    requestId?: string,
  ): Promise<LlmAiReviewClaim> {
    // A named request is claimed by id (the receipts page hands the assistant
    // the request it just queued); none is the oldest pending one. A named
    // request that is not pending, expired or someone else's is "nothing".
    const request = requestId
      ? await this.requests.claimById(userId, requestId, caller)
      : await this.requests.claimNext(userId, caller);
    if (!request) return { request: null };
    try {
      // A parser-draft request is about emails, not a transaction: its claim
      // carries the emails and no transaction.
      if (request.kind === "email_parser_draft") {
        return {
          request: this.toLlm(request, caller),
          emailReceipts: await this.loadParserEmailsForClaim(userId, request),
        };
      }
      const transaction = await this.transactionsService.getLlmTransactionById(
        userId,
        this.requireTransactionId(request),
      );
      const emailReceipt = await this.loadEmailForClaim(userId, request);
      return {
        request: this.toLlm(request, caller),
        transaction,
        ...(emailReceipt ? { emailReceipt } : {}),
      };
    } catch (err) {
      await this.requests.release(userId, request.id, caller, {
        final: false,
        note: "The transaction or its email could not be read.",
      });
      throw err;
    }
  }

  /**
   * The transaction a request is about. Every kind but `email_parser_draft` has
   * one (the schema's CHECK), so a null here is a row that should not exist; it is
   * refused rather than read as "no transaction".
   */
  private requireTransactionId(request: AiReviewRequest): string {
    if (request.transactionId === null) {
      throw new BadRequestException(
        tr(
          "errors.aiReview.noTransaction",
          "This AI review request is not about a transaction.",
        ),
      );
    }
    return request.transactionId;
  }

  /**
   * The emails of a parser-draft request that still exist, in the order the
   * request names them: sender, subject, the day the shop sent the order (a
   * forward's original date, else the arrival day) and the text, each cut to
   * `AI_REVIEW_PARSER_EMAIL_TEXT_MAX_CHARS`. Read through the user's own scope
   * by id and owner, so another user's email is absent, never read; a deleted one
   * is skipped.
   */
  private async loadParserEmailsForClaim(
    userId: string,
    request: AiReviewRequest,
  ): Promise<LlmAiReviewParserEmail[]> {
    const ids = request.emailReceiptIds ?? [];
    if (ids.length === 0) return [];
    const receipts = await withScopedDb(this.dataSource, (m) =>
      m.getRepository(EmailReceipt).find({
        where: { userId, id: In([...ids]) },
        select: {
          id: true,
          fromAddress: true,
          subject: true,
          receivedAt: true,
          originalSentAt: true,
          bodyText: true,
        },
      }),
    );
    const byId = new Map(receipts.map((r) => [r.id, r]));
    return ids.flatMap((id) => {
      const receipt = byId.get(id);
      return receipt
        ? [
            {
              id: receipt.id,
              fromAddress: receipt.fromAddress,
              subject: receipt.subject,
              effectiveDate: (
                receipt.originalSentAt ?? receipt.receivedAt
              ).toISOString(),
              text: receipt.bodyText.slice(
                0,
                AI_REVIEW_PARSER_EMAIL_TEXT_MAX_CHARS,
              ),
            },
          ]
        : [];
    });
  }

  /**
   * The email behind a request of kind `email_receipt`: who sent it, when, and
   * its text cut to `AI_REVIEW_EMAIL_TEXT_MAX_CHARS`. Read through the user's
   * own scope by id and owner, so another user's email is absent, never read.
   * Undefined for any other kind, and when the email was deleted since.
   */
  private async loadEmailForClaim(
    userId: string,
    request: AiReviewRequest,
  ): Promise<LlmAiReviewEmailReceipt | undefined> {
    if (request.kind !== "email_receipt" || !request.emailReceiptId) {
      return undefined;
    }
    const receipt = await withScopedDb(this.dataSource, (m) =>
      m.getRepository(EmailReceipt).findOne({
        where: { id: request.emailReceiptId as string, userId },
        select: {
          id: true,
          fromAddress: true,
          subject: true,
          receivedAt: true,
          bodyText: true,
        },
      }),
    );
    if (!receipt) return undefined;
    return {
      fromAddress: receipt.fromAddress,
      subject: receipt.subject,
      receivedAt: receipt.receivedAt.toISOString(),
      text: receipt.bodyText.slice(0, AI_REVIEW_EMAIL_TEXT_MAX_CHARS),
    };
  }

  /** The claim check every agent write starts with; nothing is written before it passes. */
  private async requireClaim(
    userId: string,
    caller: string,
    requestId: string,
  ): Promise<AiReviewRequest> {
    const request = await this.requests.getForUser(userId, requestId);
    if (!request) {
      throw new NotFoundException(
        tr(
          "errors.aiReview.notFound",
          `AI review request with ID ${requestId} not found`,
          { id: requestId },
        ),
      );
    }
    if (request.status !== "claimed" || request.claimedBy !== caller) {
      throw new ConflictException(this.notClaimedMessage());
    }
    return request;
  }

  private notClaimedMessage(): string {
    return tr(
      "errors.aiReview.notClaimed",
      "This AI review request is not claimed by you. Claim the next pending one first; a request you did not claim cannot be answered.",
    );
  }

  /**
   * Build the confirmation card for `input` against the transaction as it is
   * now. Every refusal happens here, before anything is stored: an unusable
   * transfer, a proposal with no change, category lines that do not add up to
   * the transaction (the difference is named), an unknown category.
   */
  private async buildCard(
    userId: string,
    request: AiReviewRequest,
    input: AiReviewProposalInput,
  ): Promise<PendingAiAction> {
    if (
      input.splits === undefined &&
      input.categoryName === undefined &&
      input.payeeName === undefined &&
      input.description === undefined &&
      (input.tagNames === undefined || input.tagNames.length === 0)
    ) {
      throw new BadRequestException(
        tr(
          "errors.aiReview.nothingProposed",
          "A proposal needs at least one change: splits, categoryName, payeeName or description.",
        ),
      );
    }
    this.assertTagNames(input.tagNames);
    if (input.splits !== undefined && input.categoryName !== undefined) {
      throw new BadRequestException(
        tr(
          "errors.aiReview.splitsAndCategory",
          "Send either splits or categoryName, not both: a split transaction has no single category.",
        ),
      );
    }
    const transactionId = this.requireTransactionId(request);
    const transaction = await this.transactionsService.findOne(
      userId,
      transactionId,
    );
    if (transaction.isTransfer) {
      throw new BadRequestException(
        tr(
          "errors.aiReview.transferNotSupported",
          "A transfer cannot be reviewed by proposal. Reject the request instead.",
        ),
      );
    }
    if (input.splits !== undefined) {
      const amount = roundMoney(Number(transaction.amount));
      const sum = sumMoney(input.splits.map((line) => Number(line.amount)));
      if (sum !== amount) {
        throw new BadRequestException(
          tr(
            "errors.aiReview.splitDifference",
            `The split lines add up to ${sum} but the transaction is ${amount}: ${roundMoney(amount - sum)} is not assigned. Make the lines add up to the transaction; a leftover such as a delivery cost needs its own line, or is named to the user instead of being assigned.`,
            {
              sum,
              amount,
              difference: roundMoney(amount - sum),
            },
          ),
        );
      }
    }
    const prep = await this.prepService.prepareUpdate(userId, {
      transactionId,
      splits: input.splits,
      categoryName: input.categoryName,
      payeeName: input.payeeName,
      description: input.description,
      tagNames: input.tagNames,
      categorySource: input.categorySource,
    });
    if (prep.kind !== "standard") {
      throw new BadRequestException(
        tr(
          "errors.aiReview.transferNotSupported",
          "A transfer cannot be reviewed by proposal. Reject the request instead.",
        ),
      );
    }
    return this.actionBuilder.buildUpdateTransaction(
      userId,
      prep.preview,
      prep.splits,
      undefined,
      { aiReviewRequestId: request.id },
    );
  }

  /** Tag names a proposal may add: a few, each a short plain name. Defence in depth; the producers bound them too. */
  private assertTagNames(names: readonly string[] | undefined): void {
    if (names === undefined) return;
    const valid =
      Array.isArray(names) &&
      names.length <= AI_REVIEW_MAX_TAG_NAMES &&
      names.every(
        (name) =>
          typeof name === "string" &&
          name.trim().length >= 1 &&
          name.trim().length <= AI_REVIEW_MAX_TAG_NAME_LENGTH &&
          !hasControlCharacter(name),
      );
    if (!valid) {
      throw new BadRequestException(
        tr(
          "errors.aiReview.tagNamesInvalid",
          `A proposal may add up to ${AI_REVIEW_MAX_TAG_NAMES} tags of 1 to ${AI_REVIEW_MAX_TAG_NAME_LENGTH} characters each, with no control characters.`,
          {
            max: AI_REVIEW_MAX_TAG_NAMES,
            length: AI_REVIEW_MAX_TAG_NAME_LENGTH,
          },
        ),
      );
    }
  }

  /**
   * Store an agent's proposal for the request it claimed and return the signed
   * card. The conditional UPDATE in `submitProposal` is the authority on the
   * claim; the read before it only refuses early and with a reason.
   */
  async submit(
    userId: string,
    caller: string,
    requestId: string,
    input: AiReviewProposalInput,
  ): Promise<AiReviewSubmitResult> {
    const request = await this.requireClaim(userId, caller, requestId);
    if (request.kind === "email_parser_draft") {
      throw new BadRequestException(
        tr(
          "errors.aiReview.parserDraftNotSubmittable",
          "A parser draft request is answered with the email_receipt_parsers tool (test, then save_draft with this requestId), not with a transaction proposal.",
        ),
      );
    }
    const action = await this.buildCard(userId, request, input);
    const stored: StoredAiReviewProposal = {
      input,
      action,
      proposedAt: new Date().toISOString(),
    };
    const proposed = await this.requests.submitProposal(
      userId,
      requestId,
      caller,
      stored as unknown as Record<string, unknown>,
    );
    if (!proposed) throw new ConflictException(this.notClaimedMessage());
    return { request: this.toLlm(proposed, caller), action };
  }

  /**
   * An agent gives a claimed request up. `cannotBeDone` closes it (`rejected`);
   * otherwise it returns to `pending` with the claim cleared, and the reason is
   * kept for the next agent.
   */
  async reject(
    userId: string,
    caller: string,
    requestId: string,
    reason: string,
    cannotBeDone: boolean,
  ): Promise<LlmAiReviewRequest> {
    await this.requireClaim(userId, caller, requestId);
    const released = await this.requests.release(userId, requestId, caller, {
      final: cannotBeDone,
      note: reason,
    });
    if (!released) throw new ConflictException(this.notClaimedMessage());
    return this.toLlm(released, caller);
  }

  // ---------------------------------------------------------------------
  // The review inbox (REST)
  // ---------------------------------------------------------------------

  /**
   * The user's requests, newest first, each with a summary of its transaction
   * and, when proposed, the card rebuilt against the transaction as it is now.
   */
  async listInbox(
    userId: string,
    options: { status?: AiReviewRequest["status"]; limit?: number } = {},
  ): Promise<AiReviewInboxItem[]> {
    const rows = await this.requests.listForUser(userId, {
      ...(options.status
        ? { status: options.status }
        : { statuses: INBOX_STATUSES }),
      limit: options.limit ?? DEFAULT_AI_REVIEW_INBOX_LIMIT,
      order: "DESC",
    });
    return this.toInboxItems(userId, rows);
  }

  private async toInboxItems(
    userId: string,
    rows: AiReviewRequest[],
  ): Promise<AiReviewInboxItem[]> {
    if (rows.length === 0) return [];

    const ruleIds = [
      ...new Set(rows.flatMap((r) => (r.ruleId ? [r.ruleId] : []))),
    ];
    const receiptIds = [
      ...new Set(
        rows.flatMap((r) => (r.emailReceiptId ? [r.emailReceiptId] : [])),
      ),
    ];
    const transactionIds = rows.flatMap((r) =>
      r.transactionId ? [r.transactionId] : [],
    );
    const { transactions, rules, receipts } = await withScopedDb(
      this.dataSource,
      async (m) => ({
        transactions: transactionIds.length
          ? await m.getRepository(Transaction).find({
              where: { userId, id: In(transactionIds) },
              relations: ["account", "category"],
            })
          : [],
        rules: ruleIds.length
          ? await m.getRepository(TransactionRule).find({
              where: { userId, id: In(ruleIds) },
              select: { id: true, name: true },
            })
          : [],
        receipts: receiptIds.length
          ? await m.getRepository(EmailReceipt).find({
              where: { userId, id: In(receiptIds) },
              select: {
                id: true,
                fromAddress: true,
                subject: true,
                receivedAt: true,
              },
            })
          : [],
      }),
    );
    const txById = new Map(transactions.map((t) => [t.id, t]));
    const ruleName = new Map(rules.map((r) => [r.id, r.name]));
    const receiptById = new Map(receipts.map((r) => [r.id, r]));

    const items: AiReviewInboxItem[] = [];
    for (const request of rows) {
      const t = request.transactionId
        ? txById.get(request.transactionId)
        : undefined;
      const note = agentNoteOf(request);
      const stored = request.proposal as Partial<StoredAiReviewProposal> | null;
      items.push({
        id: request.id,
        kind: request.kind,
        status: request.status,
        instruction: request.instruction,
        transactionId: request.transactionId,
        ruleId: request.ruleId,
        ruleName: request.ruleId
          ? (ruleName.get(request.ruleId) ?? null)
          : null,
        emailReceipt: inboxEmail(
          request.emailReceiptId
            ? receiptById.get(request.emailReceiptId)
            : undefined,
        ),
        parserDraft: inboxParserDraft(request),
        createdAt: request.createdAt.toISOString(),
        expiresAt: request.expiresAt.toISOString(),
        transaction: t
          ? {
              id: t.id,
              date: String(t.transactionDate).slice(0, 10),
              amount: Number(t.amount),
              currencyCode: t.currencyCode,
              payeeName: t.payeeName,
              description: t.description,
              accountId: t.accountId,
              accountName: t.account?.name ?? null,
              categoryName: t.category?.name ?? null,
              isSplit: t.isSplit,
            }
          : null,
        ...(note ? { agentNote: note } : {}),
        ...(request.status === "proposed" && stored?.input
          ? { proposal: await this.rebuiltCard(userId, request, stored.input) }
          : {}),
      });
    }
    return items;
  }

  /**
   * The card to approve for one of the user's requests, rebuilt from its stored
   * proposal against the transaction as it is now (the inbox's own path, so what
   * is approved is what the inbox shows), or the reason there is none: not the
   * user's (reads as not found), no longer `proposed`, expired, not a proposal
   * that has a card (a parser draft), or a proposal the transaction no longer
   * admits. Reads only; the caller commits the card through
   * `AiActionsService.confirm`.
   */
  async buildApprovalCard(
    userId: string,
    requestId: string,
  ): Promise<{ action: PendingAiAction } | { error: string }> {
    const request = await this.requests.getForUser(userId, requestId);
    if (!request) {
      return {
        error: tr(
          "errors.aiReview.notFound",
          `AI review request with ID ${requestId} not found`,
          { id: requestId },
        ),
      };
    }
    const stored = request.proposal as Partial<StoredAiReviewProposal> | null;
    if (
      request.status !== "proposed" ||
      request.expiresAt.getTime() <= Date.now()
    ) {
      return {
        error: tr(
          "errors.aiReview.notProposed",
          "This AI review request is no longer waiting for approval, so its proposal was not applied.",
        ),
      };
    }
    if (request.kind === "email_parser_draft" || !stored?.input) {
      return {
        error: tr(
          "errors.aiReview.noApprovableProposal",
          "This request has no proposal to approve here.",
        ),
      };
    }
    return this.rebuiltCard(userId, request, stored.input);
  }

  private async rebuiltCard(
    userId: string,
    request: AiReviewRequest,
    input: AiReviewProposalInput,
  ): Promise<{ action: PendingAiAction } | { error: string }> {
    try {
      return { action: await this.buildCard(userId, request, input) };
    } catch (err) {
      // A refusal (the transaction changed and the lines no longer add up, a
      // category was deleted) is the reason to show. Anything else is ours and
      // propagates, so an internal error is never rendered as a proposal's.
      if (
        err instanceof BadRequestException ||
        err instanceof NotFoundException ||
        err instanceof ConflictException
      ) {
        return { error: err.message };
      }
      throw err;
    }
  }

  /** The person dismisses a request that is still open. */
  async dismiss(userId: string, requestId: string): Promise<AiReviewInboxItem> {
    const dismissed = await this.requests.dismiss(userId, requestId);
    if (!dismissed) {
      const existing = await this.requests.getForUser(userId, requestId);
      if (!existing) {
        throw new NotFoundException(
          tr(
            "errors.aiReview.notFound",
            `AI review request with ID ${requestId} not found`,
            { id: requestId },
          ),
        );
      }
      throw new ConflictException(
        tr(
          "errors.aiReview.notOpen",
          "This AI review request is no longer open.",
        ),
      );
    }
    const [item] = await this.toInboxItems(userId, [dismissed]);
    return item;
  }
}
