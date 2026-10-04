import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { returnedRows } from "../../common/db/query-result";
import { withScopedDb } from "../../common/db/scoped-db";
import { tr } from "../../i18n/translate";
import { escapeLikePattern } from "../../transactions/transaction-search.util";
import { EmailReceipt } from "../entities/email-receipt.entity";
import type { EmailReceiptStatus } from "../entities/email-receipt.entity";
import { orderFromStructuredData } from "../parsing/schema-org-order";
import { EmailReceiptPipelineService } from "../pipeline/email-receipt-pipeline.service";
import { ReceiptSourceLines } from "../pipeline/receipt-source-lines";
import {
  closeReceiptRequests,
  currentReceiptRequestStatus,
  lockReceiptTransaction,
} from "../pipeline/receipt-requests.util";
import {
  EMAIL_RECEIPT_PROCESSABLE_STATUSES,
  EMAIL_RECEIPTS_DEFAULT_BATCH_LIMIT,
  EMAIL_RECEIPTS_DEFAULT_LIST_LIMIT,
  EMAIL_RECEIPTS_MAX_BATCH_LIMIT,
  EMAIL_RECEIPTS_MAX_LIST_LIMIT,
} from "./dto/email-receipts.dto";
import { describeFailure } from "../pipeline/receipt-failure";
import type {
  EmailReceiptCandidateSummary,
  EmailReceiptDetail,
  EmailReceiptDisplayState,
  EmailReceiptDomainCount,
  EmailReceiptListItem,
  EmailReceiptsOverview,
} from "./email-receipt.view";

/** At most this many sender domains are listed for the filter. */
export const EMAIL_RECEIPTS_MAX_DOMAINS = 200;
/** The overview names at most this many sender domains no profile covers. */
export const EMAIL_RECEIPTS_OVERVIEW_DOMAINS = 10;
/**
 * AI category questions one bulk call may ask (each is a provider call, so a
 * batch of 200 emails does not become 200 calls): past it, the receipts that
 * need one are queued for an agent instead (design 5.6).
 */
export const EMAIL_RECEIPTS_BATCH_AI_CATEGORY_CALLS = 25;

/** What "process in bulk" did (design 8): the emails it ran, where they ended and what is left. */
export interface ProcessBatchResult {
  /** Emails the pipeline acted on in this call. */
  processed: number;
  /** Where the processed emails ended, by their new status. */
  byOutcome: Partial<Record<EmailReceiptStatus, number>>;
  /** Emails that raised an error and were passed over (they are not retried by this run). */
  failed: number;
  /** Matching emails this run has not touched yet; 0 ends the run. */
  remaining: number;
  /** Send this back as `since` in the next call of the same run. */
  since: string;
}

/** The request a receipt points at, as far as the derived state needs it. */
export interface ReceiptRequestFacts {
  status: string;
  /** The request's life has run out, whatever its stored status still says. */
  expired: boolean;
}

/**
 * The shown state of a `review` receipt, derived from its request (design
 * section 6). Null for every other status: only a receipt that stands behind a
 * request has a request's state to show.
 */
export function deriveDisplayState(
  status: EmailReceiptStatus,
  request: ReceiptRequestFacts | null,
): EmailReceiptDisplayState | null {
  if (status !== "review") return null;
  if (request === null) return "request_missing";
  switch (request.status) {
    case "applied":
      return "applied";
    case "rejected":
      return "dismissed";
    case "expired":
      return "expired";
    case "proposed":
      return request.expired ? "expired" : "proposed";
    default:
      // pending, claimed
      return request.expired ? "expired" : "pending_ai";
  }
}

interface ItemRow {
  id: string;
  from_address: string;
  from_domain: string;
  subject: string;
  received_at: Date | string;
  forwarded_by: string | null;
  original_sent_at: Date | string | null;
  created_at: Date | string;
  status: EmailReceiptStatus;
  status_reason: string | null;
  match_kind: EmailReceiptListItem["matchKind"];
  parser_id: string | null;
  parser_name: string | null;
  ai_review_request_id: string | null;
  request_status: string | null;
  request_expired: boolean | null;
  request_note: string | null;
  transaction_id: string | null;
  tx_date: string | null;
  tx_amount: string | number | null;
  tx_currency: string | null;
  tx_payee: string | null;
}

interface DetailRow extends ItemRow {
  body_text: string;
  body_html: string | null;
  parsed: Record<string, unknown> | null;
  candidate_transaction_ids: string[];
}

const ITEM_COLUMNS = `r.id, r.from_address, r.from_domain, r.subject, r.received_at,
       r.forwarded_by, r.original_sent_at, r.created_at, r.status, r.status_reason, r.match_kind, r.parser_id,
       p.name AS parser_name, r.ai_review_request_id,
       rq.status AS request_status,
       (rq.expires_at <= CURRENT_TIMESTAMP) AS request_expired,
       rq.proposal #>> '{agentNote,reason}' AS request_note,
       r.transaction_id,
       TO_CHAR(t.transaction_date, 'YYYY-MM-DD') AS tx_date,
       t.amount AS tx_amount, t.currency_code AS tx_currency,
       t.payee_name AS tx_payee`;

const ITEM_JOINS = `FROM email_receipts r
       LEFT JOIN email_receipt_parsers p
              ON p.id = r.parser_id AND p.user_id = r.user_id
       LEFT JOIN ai_review_requests rq
              ON rq.id = r.ai_review_request_id AND rq.user_id = r.user_id
       LEFT JOIN transactions t
              ON t.id = r.transaction_id AND t.user_id = r.user_id`;

const iso = (value: Date | string): string =>
  (value instanceof Date ? value : new Date(value)).toISOString();

function toListItem(row: ItemRow): EmailReceiptListItem {
  return {
    id: row.id,
    fromAddress: row.from_address,
    fromDomain: row.from_domain,
    subject: row.subject,
    receivedAt: iso(row.received_at),
    forwardedBy: row.forwarded_by ?? null,
    originalSentAt: row.original_sent_at ? iso(row.original_sent_at) : null,
    effectiveDate: iso(row.original_sent_at ?? row.received_at),
    status: row.status,
    statusReason: row.status_reason,
    matchKind: row.match_kind,
    parserId: row.parser_id,
    parserName: row.parser_name,
    aiReviewRequestId: row.ai_review_request_id,
    displayState: deriveDisplayState(
      row.status,
      row.request_status === null
        ? null
        : {
            status: row.request_status,
            expired: row.request_expired === true,
          },
    ),
    requestNote: row.request_note,
    transaction:
      row.transaction_id !== null && row.tx_date !== null
        ? {
            id: row.transaction_id,
            date: row.tx_date,
            amount: Number(row.tx_amount),
            currencyCode: row.tx_currency as string,
            payeeName: row.tx_payee,
          }
        : null,
    createdAt: iso(row.created_at),
  };
}

/**
 * The receipts page's API over the stored emails (design sections 6 and 8): the
 * list, one email with its text, and the person's commands on it. Every method
 * is keyed on the JWT's user. A command that can refuse (an applied proposal, an
 * ignored or skipped email, a transaction that is not the user's) refuses inside
 * the transaction that would write, under the receipt's row lock, so a
 * rejection has written nothing.
 */
@Injectable()
export class EmailReceiptsService {
  private readonly logger = new Logger(EmailReceiptsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly pipeline: EmailReceiptPipelineService,
  ) {}

  /**
   * The sender domains of the user's emails (the shop's, after forward
   * detection), each with its count: most emails first, then by name, at most
   * 200. What the receipts page's domain filter offers.
   */
  async listDomains(userId: string): Promise<EmailReceiptDomainCount[]> {
    const rows = await withScopedDb(this.dataSource, async (m) =>
      returnedRows<{
        domain: string;
        count: string | number;
        processable: string | number;
      }>(
        await m.query(
          `SELECT r.from_domain AS domain,
                  COUNT(*)::int AS count,
                  (COUNT(*) FILTER (WHERE r.status = ANY($3::varchar[])))::int
                    AS processable
             FROM email_receipts r
            WHERE r.user_id = $1
              AND r.from_domain <> ''
            GROUP BY r.from_domain
            ORDER BY count DESC, r.from_domain ASC
            LIMIT $2`,
          [
            userId,
            EMAIL_RECEIPTS_MAX_DOMAINS,
            [...EMAIL_RECEIPT_PROCESSABLE_STATUSES],
          ],
        ),
      ),
    );
    return rows.map((row) => ({
      domain: row.domain,
      count: Number(row.count),
      processable: Number(row.processable),
    }));
  }

  /**
   * Everything the hub's Overview shows, in ONE statement (design 9): the mailbox,
   * the emails by status, the profiles by status, the proposals waiting for
   * approval and the sender domains no profile covers. Counts and names only.
   */
  async overview(userId: string): Promise<EmailReceiptsOverview> {
    const rows = await withScopedDb(this.dataSource, async (m) =>
      returnedRows<{
        mailbox: {
          enabled: boolean;
          auth_method: "password" | "oauth2";
          ai_mode: "off" | "on_demand" | "automatic";
          connected: boolean;
          last_polled_at: string | null;
          last_success_at: string | null;
          last_error: string | null;
          last_error_at: string | null;
        } | null;
        by_status: Record<string, number> | null;
        to_approve: number;
        parsers: { approved: number; draft: number };
        uncovered: Array<{ domain: string; count: number }> | null;
      }>(
        await m.query(
          `SELECT
             (SELECT json_build_object(
                       'enabled', mb.enabled,
                       'auth_method', mb.auth_method,
                       'ai_mode', mb.ai_mode,
                       'connected', (mb.auth_method = 'password'
                                     OR mb.oauth_refresh_token_enc IS NOT NULL),
                       'last_polled_at', mb.last_polled_at,
                       'last_success_at', mb.last_success_at,
                       'last_error', mb.last_error,
                       'last_error_at', mb.last_error_at)
                FROM email_receipt_mailboxes mb
               WHERE mb.user_id = $1) AS mailbox,
             (SELECT json_object_agg(s.status, s.n)
                FROM (SELECT status, COUNT(*)::int AS n
                        FROM email_receipts
                       WHERE user_id = $1
                       GROUP BY status) s) AS by_status,
             (SELECT COUNT(*)::int
                FROM ai_review_requests rq
               WHERE rq.user_id = $1
                 AND rq.kind = 'email_receipt'
                 AND rq.status = 'proposed'
                 AND rq.expires_at > CURRENT_TIMESTAMP) AS to_approve,
             (SELECT json_build_object(
                       'approved', COUNT(*) FILTER (WHERE p.status = 'approved')::int,
                       'draft', COUNT(*) FILTER (WHERE p.status = 'draft')::int)
                FROM email_receipt_parsers p
               WHERE p.user_id = $1) AS parsers,
             (SELECT json_agg(json_build_object('domain', d.from_domain, 'count', d.n)
                              ORDER BY d.n DESC, d.from_domain ASC)
                FROM (SELECT r.from_domain, COUNT(*)::int AS n
                        FROM email_receipts r
                       WHERE r.user_id = $1
                         AND r.status = 'no_parser'
                         AND r.from_domain <> ''
                         AND NOT EXISTS (
                               SELECT 1
                                 FROM email_receipt_parsers p,
                                      unnest(p.from_domains) AS pd(domain)
                                WHERE p.user_id = r.user_id
                                  AND (r.from_domain = pd.domain
                                       OR right(r.from_domain, length(pd.domain) + 1)
                                          = '.' || pd.domain))
                       GROUP BY r.from_domain
                       ORDER BY n DESC, r.from_domain ASC
                       LIMIT $2) d) AS uncovered`,
          [userId, EMAIL_RECEIPTS_OVERVIEW_DOMAINS],
        ),
      ),
    );
    const row = rows[0];
    const byStatus = (row?.by_status ?? {}) as Record<string, number>;
    const emailsByStatus: EmailReceiptsOverview["emailsByStatus"] = {};
    for (const [status, count] of Object.entries(byStatus)) {
      emailsByStatus[status as EmailReceiptStatus] = Number(count);
    }
    const mailbox = row?.mailbox ?? null;
    return {
      mailbox: mailbox
        ? {
            enabled: mailbox.enabled,
            authMethod: mailbox.auth_method,
            aiMode: mailbox.ai_mode,
            connected: mailbox.connected,
            lastPolledAt: mailbox.last_polled_at
              ? iso(mailbox.last_polled_at)
              : null,
            lastSuccessAt: mailbox.last_success_at
              ? iso(mailbox.last_success_at)
              : null,
            lastError: mailbox.last_error,
            lastErrorAt: mailbox.last_error_at
              ? iso(mailbox.last_error_at)
              : null,
          }
        : null,
      emailsByStatus,
      processable: EMAIL_RECEIPT_PROCESSABLE_STATUSES.reduce(
        (sum, status) => sum + (emailsByStatus[status] ?? 0),
        0,
      ),
      proposalsToApprove: Number(row?.to_approve ?? 0),
      parsers: {
        approved: Number(row?.parsers?.approved ?? 0),
        draft: Number(row?.parsers?.draft ?? 0),
      },
      domainsWithoutProfile: (row?.uncovered ?? []).map((entry) => ({
        domain: entry.domain,
        count: Number(entry.count),
      })),
    };
  }

  /**
   * "Process in bulk" (design 8): run the pipeline over up to `limit` emails in
   * the given statuses (every processable one by default), oldest first, one after
   * the other, each in its own transaction exactly as `process` always runs (a
   * failure of one email never rolls back another). Returns where they ended and
   * how many matching emails this run has not touched yet.
   *
   * What makes a loop of calls end: an email that stays in a selected status after
   * processing (still unmatched, say) would match the filter forever, so the run
   * takes only emails not UPDATED since the run began. `since` is that instant (the
   * database's clock, the first call's start; later calls send it back), and every
   * email the pipeline processes is written, so it leaves the candidates; one that
   * raised an error is touched on purpose, so it cannot starve the rest.
   */
  async processBatch(
    userId: string,
    options: {
      domain?: string;
      statuses?: readonly EmailReceiptStatus[];
      limit?: number;
      since?: string;
    } = {},
  ): Promise<ProcessBatchResult> {
    const statuses = [
      ...(options.statuses && options.statuses.length > 0
        ? options.statuses
        : EMAIL_RECEIPT_PROCESSABLE_STATUSES),
    ] as EmailReceiptStatus[];
    const limit = Math.min(
      Math.max(
        Math.trunc(options.limit ?? EMAIL_RECEIPTS_DEFAULT_BATCH_LIMIT),
        1,
      ),
      EMAIL_RECEIPTS_MAX_BATCH_LIMIT,
    );
    const domain = options.domain?.trim().toLowerCase() || null;
    const domainLike =
      domain === null ? null : `%.${escapeLikePattern(domain)}`;

    const selected = await withScopedDb(this.dataSource, async (m) => {
      const [stamp] = returnedRows<{ since: string }>(
        await m.query(
          `SELECT TO_CHAR(
                    LEAST(COALESCE($1::timestamptz, CURRENT_TIMESTAMP),
                          CURRENT_TIMESTAMP) AT TIME ZONE 'UTC',
                    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS since`,
          [options.since ?? null],
        ),
      );
      const ids = returnedRows<{ id: string }>(
        await m.query(
          `SELECT r.id
             FROM email_receipts r
            WHERE r.user_id = $1
              AND r.status = ANY($2::varchar[])
              AND ($3::varchar IS NULL
                   OR r.from_domain = $3::varchar
                   OR r.from_domain LIKE $4::varchar ESCAPE '\\')
              AND r.updated_at < $5::timestamptz
            ORDER BY r.received_at ASC, r.id ASC
            LIMIT $6`,
          [userId, statuses, domain, domainLike, stamp.since, limit],
        ),
      );
      return { since: stamp.since, ids: ids.map((row) => row.id) };
    });

    const byOutcome: ProcessBatchResult["byOutcome"] = {};
    let processed = 0;
    let failed = 0;
    const budget = { remaining: EMAIL_RECEIPTS_BATCH_AI_CATEGORY_CALLS };
    for (const id of selected.ids) {
      try {
        const result = await this.pipeline.process(userId, id, {
          onlyWhenStatusIn: statuses,
          aiCategoryBudget: budget,
        });
        if (!result.unchanged) {
          processed++;
          byOutcome[result.status] = (byOutcome[result.status] ?? 0) + 1;
        }
      } catch (error) {
        failed++;
        this.logger.warn(
          `Bulk processing could not process email ${id} (${describeFailure(error)})`,
        );
        await this.touch(userId, id);
      }
    }

    const [left] = await withScopedDb(this.dataSource, async (m) =>
      returnedRows<{ remaining: number | string }>(
        await m.query(
          `SELECT COUNT(*)::int AS remaining
             FROM email_receipts r
            WHERE r.user_id = $1
              AND r.status = ANY($2::varchar[])
              AND ($3::varchar IS NULL
                   OR r.from_domain = $3::varchar
                   OR r.from_domain LIKE $4::varchar ESCAPE '\\')
              AND r.updated_at < $5::timestamptz`,
          [userId, statuses, domain, domainLike, selected.since],
        ),
      ),
    );
    return {
      processed,
      byOutcome,
      failed,
      remaining: Number(left?.remaining ?? 0),
      since: selected.since,
    };
  }

  /** Move an email's `updated_at` so a bulk run does not take it again; best effort. */
  private async touch(userId: string, id: string): Promise<void> {
    try {
      await withScopedDb(this.dataSource, (m) =>
        m.query(
          `UPDATE email_receipts SET status_reason = status_reason
            WHERE id = $1 AND user_id = $2`,
          [id, userId],
        ),
      );
    } catch (error) {
      this.logger.warn(
        `Could not mark email ${id} as passed over (${describeFailure(error)})`,
      );
    }
  }

  /**
   * The user's emails, newest first, without their text. `domain` keeps the
   * emails from exactly that sender domain or one of its sub-domains; it
   * combines with `status`.
   */
  async list(
    userId: string,
    options: {
      status?: EmailReceiptStatus;
      domain?: string;
      limit?: number;
    } = {},
  ): Promise<EmailReceiptListItem[]> {
    const limit = Math.min(
      Math.max(
        Math.trunc(options.limit ?? EMAIL_RECEIPTS_DEFAULT_LIST_LIMIT),
        1,
      ),
      EMAIL_RECEIPTS_MAX_LIST_LIMIT,
    );
    const domain = options.domain?.trim().toLowerCase() || null;
    const rows = await withScopedDb(this.dataSource, async (m) =>
      returnedRows<ItemRow>(
        await m.query(
          `SELECT ${ITEM_COLUMNS}
             ${ITEM_JOINS}
            WHERE r.user_id = $1
              AND ($2::varchar IS NULL OR r.status = $2::varchar)
              AND ($3::varchar IS NULL
                   OR r.from_domain = $3::varchar
                   OR r.from_domain LIKE $4::varchar ESCAPE '\\')
            ORDER BY r.received_at DESC, r.id DESC
            LIMIT $5`,
          [
            userId,
            options.status ?? null,
            domain,
            domain === null ? null : `%.${escapeLikePattern(domain)}`,
            limit,
          ],
        ),
      ),
    );
    return rows.map(toListItem);
  }

  /** One of the user's emails with its text, parse result and candidates. */
  async get(userId: string, id: string): Promise<EmailReceiptDetail> {
    const detail = await withScopedDb(this.dataSource, (m) =>
      this.readDetail(m, userId, id),
    );
    if (!detail) throw receiptNotFound(id);
    return detail;
  }

  /** Back to the top of the pipeline (design section 6); a closed request is not reopened. */
  async reprocess(userId: string, id: string): Promise<EmailReceiptDetail> {
    await this.pipeline.process(userId, id);
    return this.get(userId, id);
  }

  /**
   * A person names the transaction the email paid for (match kind `manual`) and
   * the pipeline proposes from it. Ownership, transfer and VOID are checked by
   * the pipeline inside the transaction that stores the link.
   */
  async link(
    userId: string,
    id: string,
    transactionId: string,
  ): Promise<EmailReceiptDetail> {
    await this.pipeline.process(userId, id, { link: { transactionId } });
    return this.get(userId, id);
  }

  /** Stop the email proposing anything: its open request is dismissed with it. */
  async ignore(userId: string, id: string): Promise<EmailReceiptDetail> {
    await withScopedDb(this.dataSource, async (m) => {
      const receipt = await this.lockReceipt(m, userId, id);
      if (receipt.status === "ignored") return;
      if (receipt.status === "skipped") {
        throw new ConflictException(
          tr(
            "errors.emailReceipts.receiptSkipped",
            "This email could not be read (it was too large or could not be decoded), so there is nothing to process.",
          ),
        );
      }
      await this.refuseWhenApplied(m, userId, receipt);
      if (receipt.transactionId) {
        await lockReceiptTransaction(m, receipt.transactionId);
      }
      await closeReceiptRequests(m, userId, id);
      await m
        .getRepository(EmailReceipt)
        .update(
          { id, userId },
          { status: "ignored", statusReason: null, aiReviewRequestId: null },
        );
    });
    return this.get(userId, id);
  }

  /** Delete the stored email; its open request is dismissed in the same transaction. */
  async remove(userId: string, id: string): Promise<void> {
    await withScopedDb(this.dataSource, async (m) => {
      const receipt = await this.lockReceipt(m, userId, id);
      if (receipt.transactionId) {
        await lockReceiptTransaction(m, receipt.transactionId);
      }
      await closeReceiptRequests(m, userId, id);
      await m.getRepository(EmailReceipt).delete({ id, userId });
    });
  }

  // ---------------------------------------------------------------------

  private async lockReceipt(
    m: EntityManager,
    userId: string,
    id: string,
  ): Promise<EmailReceipt> {
    const receipt = await m.getRepository(EmailReceipt).findOne({
      where: { id, userId },
      lock: { mode: "pessimistic_write" },
    });
    if (!receipt) throw receiptNotFound(id);
    return receipt;
  }

  private async refuseWhenApplied(
    m: EntityManager,
    userId: string,
    receipt: EmailReceipt,
  ): Promise<void> {
    const status = await currentReceiptRequestStatus(
      m,
      userId,
      receipt.aiReviewRequestId,
    );
    if (status === "applied") {
      throw new ConflictException(
        tr(
          "errors.emailReceipts.receiptApplied",
          "This email's proposal has already been applied to a transaction.",
        ),
      );
    }
  }

  private async readDetail(
    m: EntityManager,
    userId: string,
    id: string,
  ): Promise<EmailReceiptDetail | null> {
    const rows = returnedRows<DetailRow>(
      await m.query(
        `SELECT ${ITEM_COLUMNS},
                r.body_text, r.body_html, r.parsed, r.candidate_transaction_ids
           ${ITEM_JOINS}
          WHERE r.user_id = $1
            AND r.id = $2`,
        [userId, id],
      ),
    );
    const row = rows[0];
    if (!row) return null;
    const sources = new ReceiptSourceLines({
      bodyText: row.body_text,
      bodyHtml: row.body_html,
    });
    const structured = sources.structured();
    return {
      ...toListItem(row),
      bodyText: row.body_text,
      bodyHtml: row.body_html,
      lines: { text: sources.text(), html: sources.html() },
      structuredOrder:
        structured === null ? null : orderFromStructuredData(structured),
      parsed: row.parsed,
      candidates: await this.readCandidates(
        m,
        userId,
        row.candidate_transaction_ids ?? [],
      ),
    };
  }

  /** The candidates of an ambiguous email, in the stored order (closest date first). */
  private async readCandidates(
    m: EntityManager,
    userId: string,
    ids: readonly string[],
  ): Promise<EmailReceiptCandidateSummary[]> {
    if (ids.length === 0) return [];
    const rows = returnedRows<{
      id: string;
      date: string;
      amount: string | number;
      currency_code: string;
      payee_name: string | null;
      description: string | null;
    }>(
      await m.query(
        `SELECT t.id, TO_CHAR(t.transaction_date, 'YYYY-MM-DD') AS date,
                t.amount, t.currency_code, t.payee_name, t.description
           FROM transactions t
          WHERE t.user_id = $1
            AND t.id = ANY($2::uuid[])`,
        [userId, [...ids]],
      ),
    );
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.flatMap((id) => {
      const row = byId.get(id);
      return row
        ? [
            {
              id: row.id,
              date: row.date,
              amount: Number(row.amount),
              currencyCode: row.currency_code,
              payeeName: row.payee_name,
              description: row.description,
            },
          ]
        : [];
    });
  }
}

function receiptNotFound(id: string): NotFoundException {
  return new NotFoundException(
    tr("errors.emailReceipts.receiptNotFound", `Email ${id} not found`, { id }),
  );
}
