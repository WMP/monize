import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { returnedRows } from "../../common/db/query-result";
import { withScopedDb } from "../../common/db/scoped-db";
import { roundMoney } from "../../common/round.util";
import { tr } from "../../i18n/translate";
import { Payee } from "../../payees/entities/payee.entity";
import { EmailReceiptParser } from "../entities/email-receipt-parser.entity";
import { receiptMatchAmount } from "../matching/match-receipt";
import type { ReceiptOutcome } from "../parsing/parse-receipt";
import type { ParsedReceiptReason } from "../parsing/receipt-parser.types";
import { validateReceiptParserDefinition } from "../parsing/receipt-parser.validation";
import type { PreviewEmailReceiptParserDto } from "./dto/email-receipt-parser.dto";
import { invalidDefinitionError } from "./parser-references.util";
import {
  compareWithExpected,
  dryRunReceipt,
  loadTransactionSummaries,
  summarizeTransaction,
  type DryRunReceipt,
  type DryRunPayee,
  type TransactionSummary,
} from "./receipt-dry-run";
import type { ReceiptParserDefinition } from "../parsing/receipt-parser.types";

/** The preview lists at most this many of the domain's other emails, newest first. */
export const PARSER_PREVIEW_MAX_OTHERS = 100;
const MONEY_UNITS = 10_000;

/**
 * What the commit would do with one email: the guard that stops the pipeline
 * reading it (`not_applicable`, `skip_line`, `wait_line`, `no_html`), a read
 * that is not complete (`parse_failed`, with `statusReason`), or, for a
 * complete read, what the matcher found.
 */
export type ParserPreviewOutcome =
  | Exclude<ReceiptOutcome, "read">
  | "parse_failed"
  | "matched"
  | "ambiguous"
  | "unmatched";

export interface ParserPreviewItem {
  receiptId: string;
  subject: string;
  /** ISO timestamp the email arrived. */
  receivedAt: string;
  outcome: ParserPreviewOutcome;
  /** Why a read is incomplete (`ParsedReceiptReason`); null otherwise. */
  statusReason: ParsedReceiptReason | null;
  /** What was read, in decimal units; null when a guard stopped the read. */
  parsed: {
    /** `YYYY-MM-DD`: the day the shop sent the order, or the day the email arrived. */
    date: string;
    /** The amount paid, else the total; null when the email states neither. */
    total: number | null;
    /** The currency of the expected or matched transaction; null when there is neither. */
    currency: string | null;
    lineCount: number;
  } | null;
  match: { transactionId: string; summary: string } | null;
  expected: { transactionId: string; summary: string } | null;
  /** Date and total agree with `expected`; null when the email has none. */
  agrees: boolean | null;
}

export interface ParserPreviewResult {
  selected: ParserPreviewItem[];
  others: ParserPreviewItem[];
  /** All of the domain's other emails, of which `others` shows the newest. */
  othersTotal: number;
}

interface PreviewRow extends DryRunReceipt {
  inDomain: boolean;
}

interface RawRow {
  id: string;
  subject: string;
  body_text: string;
  body_html: string | null;
  received_at: Date | string;
  original_sent_at: Date | string | null;
  in_domain: boolean;
}

const DOMAIN_MATCH_SQL = `EXISTS (
        SELECT 1
          FROM unnest($2::text[]) AS pd(domain)
         WHERE r.from_domain = pd.domain
            OR right(r.from_domain, length(pd.domain) + 1) = '.' || pd.domain)`;

const toDate = (value: Date | string): Date =>
  value instanceof Date ? value : new Date(value);

function toPreviewRow(row: RawRow): PreviewRow {
  return {
    id: row.id,
    subject: row.subject,
    bodyText: row.body_text,
    bodyHtml: row.body_html,
    receivedAt: toDate(row.received_at),
    originalSentAt: row.original_sent_at ? toDate(row.original_sent_at) : null,
    inDomain: row.in_domain,
  };
}

/**
 * "Preview a profile over its domain" (the profile wizard, step 3): run a
 * parser's definition, draft or approved, over the stored emails of its sender
 * domains and say what the pipeline would do with each, without writing
 * anything. The read and the match are `dryRunReceipt`, the code behind the test
 * endpoint and the assistant's `test`, so the preview shows what the commit
 * will do. One read-only transaction.
 */
@Injectable()
export class EmailReceiptParserPreviewService {
  constructor(private readonly dataSource: DataSource) {}

  async preview(
    userId: string,
    parserId: string,
    dto: PreviewEmailReceiptParserDto,
  ): Promise<ParserPreviewResult> {
    const selectedIds = dto.selectedReceiptIds;
    const expectedPairs = dto.expected ?? [];
    for (const pair of expectedPairs) {
      if (!selectedIds.includes(pair.receiptId)) {
        throw new BadRequestException(
          tr(
            "errors.emailReceipts.previewExpectedNotSelected",
            "An expected transaction was named for an email that is not among the selected ones.",
          ),
        );
      }
    }
    return withScopedDb(this.dataSource, async (m) => {
      const parser = await m
        .getRepository(EmailReceiptParser)
        .findOne({ where: { id: parserId, userId } });
      if (!parser) {
        throw new NotFoundException(
          tr(
            "errors.emailReceipts.parserNotFound",
            `Receipt parser ${parserId} not found`,
            { id: parserId },
          ),
        );
      }
      const validation = validateReceiptParserDefinition(parser.definition);
      if (!validation.ok) throw invalidDefinitionError(validation.errors);
      const definition = validation.definition;
      const payee: DryRunPayee | null = parser.payeeId
        ? await m.getRepository(Payee).findOne({
            where: { id: parser.payeeId, userId },
            select: { id: true, defaultCategoryId: true },
          })
        : null;

      const selectedRows = await this.readRows(m, userId, parser.fromDomains, {
        ids: selectedIds,
      });
      const byId = new Map(selectedRows.map((row) => [row.id, row]));
      for (const id of selectedIds) {
        const row = byId.get(id);
        if (!row) {
          throw new NotFoundException(
            tr(
              "errors.emailReceipts.receiptNotFound",
              `Email ${id} not found`,
              {
                id,
              },
            ),
          );
        }
        if (!row.inDomain) {
          throw new BadRequestException(
            tr(
              "errors.emailReceipts.previewReceiptOutsideDomain",
              "An email is not from a sender domain of this parser.",
            ),
          );
        }
      }
      const transactions = await loadTransactionSummaries(
        m,
        userId,
        expectedPairs.map((pair) => pair.transactionId),
      );
      const expectedByReceipt = new Map<string, TransactionSummary>();
      for (const pair of expectedPairs) {
        const tx = transactions.get(pair.transactionId);
        if (!tx) {
          throw new NotFoundException(
            tr(
              "errors.emailReceipts.transactionNotFound",
              "That transaction was not found.",
            ),
          );
        }
        expectedByReceipt.set(pair.receiptId, tx);
      }

      const otherRows = await this.readRows(m, userId, parser.fromDomains, {
        excludeIds: selectedIds,
        limit: PARSER_PREVIEW_MAX_OTHERS,
      });
      const [{ n }] = returnedRows<{ n: number | string }>(
        await m.query(
          `SELECT COUNT(*)::int AS n
             FROM email_receipts r
            WHERE r.user_id = $1
              AND r.status <> 'skipped'
              AND NOT (r.id = ANY($3::uuid[]))
              AND ${DOMAIN_MATCH_SQL}`,
          [userId, parser.fromDomains, selectedIds],
        ),
      );

      const item = (
        row: PreviewRow,
        expected: TransactionSummary | undefined,
      ) => this.previewOne(m, userId, definition, payee, row, expected);
      const selected: ParserPreviewItem[] = [];
      for (const id of selectedIds) {
        selected.push(
          await item(byId.get(id) as PreviewRow, expectedByReceipt.get(id)),
        );
      }
      const others: ParserPreviewItem[] = [];
      for (const row of otherRows) others.push(await item(row, undefined));
      return { selected, others, othersTotal: Number(n) };
    });
  }

  /**
   * The user's stored emails: those named by `ids` (any domain, flagged
   * `inDomain`), or the domain's emails except `excludeIds` and `skipped` ones
   * (nothing was read from those), newest first by the day the shop sent them.
   */
  private async readRows(
    m: EntityManager,
    userId: string,
    domains: readonly string[],
    options: {
      ids?: readonly string[];
      excludeIds?: readonly string[];
      limit?: number;
    },
  ): Promise<PreviewRow[]> {
    const byIds = options.ids !== undefined;
    const rows = returnedRows<RawRow>(
      await m.query(
        `SELECT r.id, r.subject, r.body_text, r.body_html, r.received_at,
                r.original_sent_at, (${DOMAIN_MATCH_SQL}) AS in_domain
           FROM email_receipts r
          WHERE r.user_id = $1
            AND ${
              byIds
                ? "r.id = ANY($3::uuid[])"
                : `r.status <> 'skipped'
            AND NOT (r.id = ANY($3::uuid[]))
            AND ${DOMAIN_MATCH_SQL}`
            }
          ORDER BY COALESCE(r.original_sent_at, r.received_at) DESC, r.id DESC
          LIMIT $4`,
        [
          userId,
          [...domains],
          byIds ? [...(options.ids ?? [])] : [...(options.excludeIds ?? [])],
          options.limit ?? 1000,
        ],
      ),
    );
    return rows.map(toPreviewRow);
  }

  private async previewOne(
    m: EntityManager,
    userId: string,
    definition: ReceiptParserDefinition,
    payee: DryRunPayee | null,
    row: PreviewRow,
    expected: TransactionSummary | undefined,
  ): Promise<ParserPreviewItem> {
    const run = await dryRunReceipt(m, userId, definition, row, payee);
    const { parsed, outcome } = run;
    const read = outcome === "read";
    const paid = receiptMatchAmount(parsed);
    let itemOutcome: ParserPreviewOutcome;
    if (!read) itemOutcome = outcome;
    else if (!parsed.complete) itemOutcome = "parse_failed";
    else itemOutcome = run.match.kind;
    return {
      receiptId: row.id,
      subject: row.subject,
      receivedAt: row.receivedAt.toISOString(),
      outcome: itemOutcome,
      statusReason: read && !parsed.complete ? parsed.reason : null,
      parsed: read
        ? {
            date: run.purchaseDate,
            total: paid === null ? null : roundMoney(paid / MONEY_UNITS),
            currency: expected?.currencyCode ?? null,
            lineCount: parsed.items.length,
          }
        : null,
      match: run.hit
        ? {
            transactionId: run.hit.id,
            summary: summarizeTransaction({
              date: run.hit.transactionDate,
              amount: run.hit.amount,
              payeeName: run.hit.payeeName,
            }),
          }
        : null,
      expected: expected
        ? {
            transactionId: expected.id,
            summary: summarizeTransaction(expected),
          }
        : null,
      agrees: expected
        ? compareWithExpected(
            parsed,
            run.purchaseDate,
            run.matchConfig,
            expected,
          ).agrees
        : null,
    };
  }
}
