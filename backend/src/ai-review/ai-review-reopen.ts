import { BadRequestException } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import { acquireAdvisoryLocks, LockScope } from "../common/db/locks";
import { returnedRows } from "../common/db/query-result";
import { tr } from "../i18n/translate";
import {
  AI_REVIEW_REQUEST_LIFETIME_DAYS,
  type AiReviewRequestKind,
  type AiReviewRequestStatus,
} from "./ai-review-request.entity";
import {
  AI_PROVIDER_UNAVAILABLE_NOTE,
  AI_REVIEW_REOPEN_MAX,
  AI_REVIEW_REOPENABLE_KINDS,
  type AiReviewReopenOutcome,
  type AiReviewReopenSummary,
} from "./ai-review-retry";

/**
 * Sending a closed request again (docs/future-plans/ai-review-retry.md, decision
 * 4). Every function takes the caller's `withScopedDb` manager: the checks and
 * the write run in one transaction, under the row locks below.
 */

interface LockedRequest {
  id: string;
  kind: AiReviewRequestKind;
  status: AiReviewRequestStatus;
  transaction_id: string | null;
  rule_id: string | null;
  email_receipt_id: string | null;
}

/**
 * Reopen the named requests, each with its own outcome. The lock order is the
 * receipts module's (`receipt-requests.util.ts`): the emails' rows (ascending),
 * then the advisory lock every enqueue of a rule-less request takes on its
 * transaction (ascending), then the request rows `FOR UPDATE` (ascending). A
 * concurrent reprocess, ignore or enqueue therefore queues behind this call, and
 * a second open request cannot appear between the check and the write.
 *
 * Refused per request, with nothing written for it:
 * - `not_found`: absent, or another user's;
 * - `not_closed`: the status is not `rejected` or `expired`;
 * - `kind_not_reopenable`: only `transaction_review` and `email_receipt`;
 * - `superseded`: an `email_receipt` whose email no longer stands behind it (it
 *   was deleted, ignored or skipped, points at another request or transaction, or
 *   has left `review`);
 * - `open_exists`: another open request has the same transaction, kind and rule.
 *
 * A reopened request is `pending`, its claim and proposal cleared, its counters
 * zero and its life fresh. Its email needs no write: the checks above hold it in
 * `review` and pointing at this request, which is what an open request leaves it
 * in (a close never touches the email).
 */
export async function reopenRequests(
  m: EntityManager,
  userId: string,
  ids: readonly string[],
): Promise<AiReviewReopenSummary> {
  const unique = [...new Set(ids)];
  if (unique.length > AI_REVIEW_REOPEN_MAX) {
    throw new BadRequestException(
      tr(
        "errors.aiReview.reopenTooMany",
        `At most ${AI_REVIEW_REOPEN_MAX} requests can be sent again at once.`,
        { max: AI_REVIEW_REOPEN_MAX },
      ),
    );
  }
  const outcomes = new Map<string, AiReviewReopenOutcome>();
  if (unique.length > 0) {
    const ordered = [...unique].sort();
    await lockEmailsAndTransactions(m, userId, ordered);
    const locked = returnedRows<LockedRequest>(
      await m.query(
        `SELECT id, kind, status, transaction_id, rule_id, email_receipt_id
           FROM ai_review_requests
          WHERE id = ANY($1::uuid[]) AND user_id = $2
          ORDER BY id
            FOR UPDATE`,
        [ordered, userId],
      ),
    );
    for (const row of locked) {
      outcomes.set(row.id, await reopenLocked(m, userId, row));
    }
  }
  const results = unique.map((id) => ({
    id,
    outcome: outcomes.get(id) ?? ("not_found" as const),
  }));
  return {
    results,
    reopened: results.filter((r) => r.outcome === "reopened").length,
  };
}

/**
 * The ids of the user's closed receipt requests the AI provider did not answer
 * (`last_error`, or the note an older release stored in `proposal`), newest
 * first, at most `AI_REVIEW_REOPEN_MAX`.
 */
export async function providerTimeoutRequestIds(
  m: EntityManager,
  userId: string,
): Promise<string[]> {
  const rows = returnedRows<{ id: string }>(
    await m.query(
      `SELECT id
         FROM ai_review_requests
        WHERE user_id = $1
          AND kind = 'email_receipt'
          AND status IN ('rejected', 'expired')
          AND (last_error = $2
               OR proposal #>> '{agentNote,reason}' = $2)
        ORDER BY created_at DESC, id
        LIMIT $3`,
      [userId, AI_PROVIDER_UNAVAILABLE_NOTE, AI_REVIEW_REOPEN_MAX],
    ),
  );
  return rows.map((row) => row.id);
}

/** The emails' rows, then the transactions' advisory locks, for the requests named (an unlocked read finds them). */
async function lockEmailsAndTransactions(
  m: EntityManager,
  userId: string,
  ids: readonly string[],
): Promise<void> {
  const found = returnedRows<
    Pick<LockedRequest, "kind" | "transaction_id" | "email_receipt_id">
  >(
    await m.query(
      `SELECT kind, transaction_id, email_receipt_id
         FROM ai_review_requests
        WHERE id = ANY($1::uuid[]) AND user_id = $2`,
      [[...ids], userId],
    ),
  );
  const emailIds = [
    ...new Set(
      found.flatMap((r) =>
        r.kind === "email_receipt" && r.email_receipt_id
          ? [r.email_receipt_id]
          : [],
      ),
    ),
  ].sort();
  if (emailIds.length > 0) {
    await m.query(
      `SELECT id FROM email_receipts
        WHERE id = ANY($1::uuid[]) AND user_id = $2
        ORDER BY id
          FOR UPDATE`,
      [emailIds, userId],
    );
  }
  await acquireAdvisoryLocks(
    m,
    LockScope.AiReviewRequests,
    found.flatMap((r) => (r.transaction_id ? [r.transaction_id] : [])),
  );
}

async function reopenLocked(
  m: EntityManager,
  userId: string,
  row: LockedRequest,
): Promise<AiReviewReopenOutcome> {
  if (row.status !== "rejected" && row.status !== "expired") {
    return "not_closed";
  }
  if (
    !(AI_REVIEW_REOPENABLE_KINDS as readonly string[]).includes(row.kind) ||
    row.transaction_id === null
  ) {
    return "kind_not_reopenable";
  }
  if (row.kind === "email_receipt") {
    const stands =
      row.email_receipt_id !== null &&
      returnedRows<{ id: string }>(
        await m.query(
          `SELECT id FROM email_receipts
            WHERE id = $1
              AND user_id = $2
              AND ai_review_request_id = $3
              AND transaction_id = $4
              AND status = 'review'`,
          [row.email_receipt_id, userId, row.id, row.transaction_id],
        ),
      ).length > 0;
    if (!stands) return "superseded";
  }
  const open = returnedRows<{ id: string }>(
    await m.query(
      `SELECT id FROM ai_review_requests
        WHERE user_id = $1
          AND transaction_id = $2
          AND kind = $3
          AND rule_id IS NOT DISTINCT FROM $4::uuid
          AND id <> $5
          AND status IN ('pending', 'claimed', 'proposed')
        LIMIT 1`,
      [userId, row.transaction_id, row.kind, row.rule_id, row.id],
    ),
  );
  if (open.length > 0) return "open_exists";
  const updated = returnedRows<{ id: string }>(
    await m.query(
      `UPDATE ai_review_requests
          SET status = 'pending',
              claimed_by = NULL,
              claimed_at = NULL,
              proposal = NULL,
              attempts = 0,
              last_error = NULL,
              last_attempt_at = NULL,
              needs_agent = false,
              close_reason = NULL,
              expires_at = CURRENT_TIMESTAMP + make_interval(days => $3::int),
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
          AND user_id = $2
          AND status IN ('rejected', 'expired')
       RETURNING id`,
      [row.id, userId, AI_REVIEW_REQUEST_LIFETIME_DAYS],
    ),
  );
  return updated.length > 0 ? "reopened" : "not_closed";
}
