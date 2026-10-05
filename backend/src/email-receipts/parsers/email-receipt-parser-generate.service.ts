import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { DataSource, EntityManager, In } from "typeorm";
import { AiQueryService } from "../../ai/query/ai-query.service";
import { loadQualifiedCategoryNames } from "../../categories/category-name.util";
import { withScopedDb } from "../../common/db/scoped-db";
import { tr } from "../../i18n/translate";
import { EmailReceiptParser } from "../entities/email-receipt-parser.entity";
import { EmailReceipt } from "../entities/email-receipt.entity";
import { effectiveReceiptDate } from "../imap/forwarded-receipt";
import { ReceiptSourceLines } from "../pipeline/receipt-source-lines";
import type { GenerateParserWithAiDto } from "./dto/email-receipt-parser.dto";
import { toParserView } from "./email-receipt-parser.view";
import {
  buildGeneratePrompt,
  type GenerateRevision,
  type GenerateSample,
} from "./parser-generate-prompt";
import { loadTransactionSummaries } from "./receipt-dry-run";

export interface GenerateParserResult {
  parserId: string;
  /** The draft's revision after the run: send it as `expectedRevision` when approving. */
  revision: number;
  /** What the assistant said it did. */
  answer: string;
}

/** What is read before the run: the samples as the prompt shows them, and the draft state to compare with. */
interface Prepared {
  samples: GenerateSample[];
  revision: GenerateRevision | null;
  /** Ids of the parsers that existed before a run that creates one. */
  knownParserIds: ReadonlySet<string>;
}

/**
 * "Generate a profile with AI" (the wizard's step 2): run the assistant
 * synchronously over the sample emails and the transactions they paid for, with
 * the `email_receipt_parsers` tool, and report the draft it saved.
 *
 * Lives in `EmailReceiptsModule`, not in the leaf `EmailReceiptParsersModule`:
 * it needs `AiQueryService`, whose module (`AiModule`) imports the leaf for the
 * tool, so the leaf importing `AiModule` would close a cycle, while
 * `EmailReceiptsModule` already imports `AiModule` and nothing in the AI layer
 * imports it back (`src/module-graph.spec.ts`).
 *
 * Every refusal (a missing or foreign email or transaction, an email of another
 * domain, an approved or missing draft) happens in one read-only transaction
 * BEFORE the provider is called, so a rejected request has written nothing. The
 * run's writes are the tool's own (a draft, or an update of the named draft
 * under a revision compare-and-swap). What the run did is read back from the
 * database, never inferred from the model's words.
 */
@Injectable()
export class EmailReceiptParserGenerateService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly aiQuery: AiQueryService,
  ) {}

  async generate(
    userId: string,
    dto: GenerateParserWithAiDto,
  ): Promise<GenerateParserResult> {
    const prepared = await withScopedDb(this.dataSource, (m) =>
      this.prepare(m, userId, dto),
    );
    const prompt = buildGeneratePrompt({
      domain: dto.domain,
      samples: prepared.samples,
      revision: prepared.revision,
    });
    // The assistant's own door: a user with no tool-capable provider is refused
    // here exactly as in the chat.
    const { answer } = await this.aiQuery.executeQuery(userId, prompt);

    const saved = await withScopedDb(this.dataSource, (m) =>
      this.findSavedDraft(m, userId, prepared),
    );
    if (!saved) {
      throw new UnprocessableEntityException({
        message: tr(
          "errors.emailReceipts.generateNoDraft",
          "The assistant did not save a draft parser. Read its answer, adjust the samples or add a note, and try again.",
        ),
        answer,
      });
    }
    return { parserId: saved.id, revision: saved.revision, answer };
  }

  private async prepare(
    m: EntityManager,
    userId: string,
    dto: GenerateParserWithAiDto,
  ): Promise<Prepared> {
    const receipts = await m.getRepository(EmailReceipt).find({
      where: { userId, id: In(dto.samples.map((s) => s.receiptId)) },
    });
    const receiptById = new Map(receipts.map((r) => [r.id, r]));
    const transactions = await loadTransactionSummaries(
      m,
      userId,
      dto.samples.map((s) => s.transactionId),
    );
    const samples: GenerateSample[] = [];
    for (const pair of dto.samples) {
      const receipt = receiptById.get(pair.receiptId);
      if (!receipt) {
        throw new NotFoundException(
          tr(
            "errors.emailReceipts.receiptNotFound",
            `Email ${pair.receiptId} not found`,
            { id: pair.receiptId },
          ),
        );
      }
      const transaction = transactions.get(pair.transactionId);
      if (!transaction) {
        throw new NotFoundException(
          tr(
            "errors.emailReceipts.transactionNotFound",
            "That transaction was not found.",
          ),
        );
      }
      if (receipt.status === "skipped") {
        throw new ConflictException(
          tr(
            "errors.emailReceipts.receiptSkipped",
            "This email could not be read (it was too large or could not be decoded), so there is nothing to process.",
          ),
        );
      }
      if (
        receipt.fromDomain !== dto.domain &&
        !receipt.fromDomain.endsWith(`.${dto.domain}`)
      ) {
        throw new BadRequestException(
          tr(
            "errors.emailReceipts.generateReceiptOutsideDomain",
            "An email is not from the sender domain the profile is for.",
          ),
        );
      }
      const lines = new ReceiptSourceLines(receipt);
      const textLines = lines.text();
      const htmlLines = textLines.length === 0 ? lines.html() : null;
      samples.push({
        receiptId: receipt.id,
        subject: receipt.subject,
        effectiveDate: effectiveReceiptDate(receipt).toISOString().slice(0, 10),
        lines: htmlLines ?? textLines,
        source: htmlLines ? "html" : "text",
        transaction,
      });
    }

    const repo = m.getRepository(EmailReceiptParser);
    if (!dto.parserId) {
      const known = await repo.find({
        where: { userId },
        select: { id: true },
      });
      return {
        samples,
        revision: null,
        knownParserIds: new Set(known.map((row) => row.id)),
      };
    }
    const draft = await repo.findOne({ where: { id: dto.parserId, userId } });
    if (!draft) {
      throw new NotFoundException(
        tr(
          "errors.emailReceipts.parserNotFound",
          `Receipt parser ${dto.parserId} not found`,
          { id: dto.parserId },
        ),
      );
    }
    if (draft.status !== "draft") {
      throw new ConflictException(
        tr(
          "errors.emailReceipts.parserNotDraft",
          "Only a draft parser can be updated by the assistant. This one is approved.",
        ),
      );
    }
    const view = toParserView(
      draft,
      await loadQualifiedCategoryNames(m, userId),
    );
    return {
      samples,
      revision: {
        parserId: draft.id,
        revision: draft.revision,
        name: draft.name,
        definition: view.definition,
        feedback: dto.feedback?.trim() || null,
      },
      knownParserIds: new Set(),
    };
  }

  /**
   * The draft this run saved: the named one when its revision moved on, else the
   * newest draft that did not exist before the run. Null when the run saved none.
   */
  private async findSavedDraft(
    m: EntityManager,
    userId: string,
    prepared: Prepared,
  ): Promise<{ id: string; revision: number } | null> {
    const repo = m.getRepository(EmailReceiptParser);
    if (prepared.revision) {
      const row = await repo.findOne({
        where: { id: prepared.revision.parserId, userId },
        select: { id: true, revision: true },
      });
      return row && row.revision > prepared.revision.revision ? row : null;
    }
    const drafts = await repo.find({
      where: { userId, status: "draft" },
      select: { id: true, revision: true },
      order: { createdAt: "DESC", id: "DESC" },
    });
    return drafts.find((row) => !prepared.knownParserIds.has(row.id)) ?? null;
  }
}
