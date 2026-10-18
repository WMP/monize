-- Retry of the automatic AI step, and a reason for every closed request
-- (docs/future-plans/ai-review-retry.md, decisions 1, 2, 4 and 5).
--
-- attempts, last_error, last_attempt_at: the automatic step records a provider
-- failure here and leaves `proposal` NULL, so it picks the request again after a
-- backoff. needs_agent is set by the failure that reaches the maximum number of
-- attempts; the request stays `pending` for an MCP agent or the chat.
-- close_reason: why a request is `rejected`; NULL for a request closed before
-- this migration (unknown) and for one that is not closed.
--
-- Expand only: every column is new and nullable or carries a default, and both
-- CHECKs accept every row the previous release writes (it never writes the new
-- columns), so the previous release keeps working while the rollout runs.
--
-- The data part is idempotent: each UPDATE selects on the pre-migration shape
-- (a proposal that is only the provider-timeout note), which it removes.

ALTER TABLE ai_review_requests ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_review_requests ADD COLUMN IF NOT EXISTS last_error VARCHAR(500);
ALTER TABLE ai_review_requests ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ;
ALTER TABLE ai_review_requests ADD COLUMN IF NOT EXISTS needs_agent BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE ai_review_requests ADD COLUMN IF NOT EXISTS close_reason VARCHAR(30);

ALTER TABLE ai_review_requests DROP CONSTRAINT IF EXISTS ck_ai_review_requests_attempts;
ALTER TABLE ai_review_requests
    ADD CONSTRAINT ck_ai_review_requests_attempts
    CHECK (attempts >= 0);

ALTER TABLE ai_review_requests DROP CONSTRAINT IF EXISTS ck_ai_review_requests_close_reason;
ALTER TABLE ai_review_requests
    ADD CONSTRAINT ck_ai_review_requests_close_reason
    CHECK (close_reason IS NULL OR close_reason IN (
      'superseded', 'dismissed', 'cannot_be_done', 'receipt_ignored',
      'receipt_deleted', 'mailbox_deleted', 'duplicate',
      'parser_draft_superseded', 'parser_deleted'));

-- (a) A pending request whose whole proposal is the provider-timeout note was
-- never retried. It becomes one failed attempt, so the automatic step takes it
-- again after the first backoff.
UPDATE ai_review_requests
   SET proposal = NULL,
       attempts = 1,
       last_error = proposal #>> '{agentNote,reason}',
       last_attempt_at = COALESCE((proposal #>> '{agentNote,at}')::timestamptz, updated_at)
 WHERE kind = 'email_receipt'
   AND status = 'pending'
   AND proposal IS NOT NULL
   AND proposal - 'agentNote' = '{}'::jsonb
   AND proposal #>> '{agentNote,reason}' = 'The AI provider did not answer.';

-- (b) A rejected request with the same note was closed by something else (a
-- reprocess, a dismissal) and still reads as a timeout. It is re-opened only
-- while its email still stands behind it: the email points at this request, at
-- the same transaction, in the state `review` an open request leaves it in (a
-- close never changes the email, so nothing on the email needs to be set), and
-- no other open email_receipt request exists for the transaction. One request
-- per transaction is chosen (the newest), so two rejected ones cannot both open.
WITH reopenable AS (
    SELECT DISTINCT ON (q.transaction_id) q.id
      FROM ai_review_requests q
      JOIN email_receipts r
        ON r.ai_review_request_id = q.id
       AND r.user_id = q.user_id
       AND r.transaction_id = q.transaction_id
       AND r.status = 'review'
     WHERE q.kind = 'email_receipt'
       AND q.status = 'rejected'
       AND q.proposal IS NOT NULL
       AND q.proposal - 'agentNote' = '{}'::jsonb
       AND q.proposal #>> '{agentNote,reason}' = 'The AI provider did not answer.'
       AND NOT EXISTS (
             SELECT 1
               FROM ai_review_requests open_request
              WHERE open_request.transaction_id = q.transaction_id
                AND open_request.kind = 'email_receipt'
                AND open_request.id <> q.id
                AND open_request.status IN ('pending', 'claimed', 'proposed'))
     ORDER BY q.transaction_id, q.created_at DESC, q.id
)
UPDATE ai_review_requests q
   SET status = 'pending',
       proposal = NULL,
       attempts = 1,
       last_error = q.proposal #>> '{agentNote,reason}',
       last_attempt_at = COALESCE((q.proposal #>> '{agentNote,at}')::timestamptz, q.updated_at),
       close_reason = NULL,
       needs_agent = false,
       claimed_by = NULL,
       claimed_at = NULL,
       expires_at = CURRENT_TIMESTAMP + INTERVAL '30 days'
  FROM reopenable
 WHERE q.id = reopenable.id
   AND q.status = 'rejected';
