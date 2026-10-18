-- A stored email is identified by its Message-ID
-- (docs/future-plans/ai-review-retry.md, decision 7).
--
-- The unique key (mailbox_id, uid_validity, uid) is the IMAP identity of a
-- message; it changes with a folder change, a cursor reset, a UIDVALIDITY change
-- or an archive import, so one email was stored again under a new key. From now
-- on a user holds one row per Message-ID, compared without case and surrounding
-- spaces; the insert skips a conflict and counts it as a duplicate.
--
-- Step 1 resolves the copies that exist now, per (user_id, lower(btrim(message_id))):
--   * keeper: a copy that "holds something" (a transaction, an investment
--     transaction, an email_receipt_links row as settlement or component, or an
--     `applied` request), the oldest of those; else the oldest copy
--     (created_at, id).
--   * every other copy loses its message_id. When it holds nothing it also
--     becomes `ignored` with status_reason 'duplicate', and its open requests
--     (pending, claimed, proposed) are rejected with close_reason 'duplicate'.
--   Nothing is deleted. After the first pass no message_id has two rows, so a
--   second run changes nothing.
-- Step 2 creates the partial unique index. Rows with no Message-ID, or an empty
-- one, are outside it. Expand only: the previous release inserts the same
-- columns, and its insert of a copy fails on the index (ON CONFLICT names the
-- other key) until the rollout ends; the poll rolls back and retries.
--
-- Dry run (read-only): the copies this migration would change.
--
--   WITH copies AS (
--     SELECT r.id, r.user_id, r.message_id, r.created_at, r.status,
--            (r.transaction_id IS NOT NULL
--             OR r.investment_transaction_id IS NOT NULL
--             OR EXISTS (SELECT 1 FROM email_receipt_links l
--                         WHERE l.settlement_receipt_id = r.id OR l.component_receipt_id = r.id)
--             OR EXISTS (SELECT 1 FROM ai_review_requests q
--                         WHERE q.email_receipt_id = r.id AND q.status = 'applied')) AS holds,
--            ROW_NUMBER() OVER (
--              PARTITION BY r.user_id, lower(btrim(r.message_id))
--              ORDER BY (NOT (r.transaction_id IS NOT NULL
--                             OR r.investment_transaction_id IS NOT NULL
--                             OR EXISTS (SELECT 1 FROM email_receipt_links l
--                                         WHERE l.settlement_receipt_id = r.id OR l.component_receipt_id = r.id)
--                             OR EXISTS (SELECT 1 FROM ai_review_requests q
--                                         WHERE q.email_receipt_id = r.id AND q.status = 'applied'))),
--                       r.created_at, r.id) AS rank
--       FROM email_receipts r
--      WHERE r.message_id IS NOT NULL AND btrim(r.message_id) <> '')
--   SELECT id, user_id, message_id, created_at, status, holds,
--          CASE WHEN holds THEN 'clear message_id' ELSE 'ignore as duplicate, clear message_id' END AS action
--     FROM copies
--    WHERE rank > 1
--    ORDER BY user_id, lower(btrim(message_id)), rank;

-- One statement: the two data-modifying CTEs read the same snapshot, so the
-- copy list cannot drift between closing the requests and clearing the ids.
DO $migration_email_receipt_message_id$
DECLARE
    closed_requests INTEGER;
    ignored_copies INTEGER;
    cleared_copies INTEGER;
BEGIN
    WITH ranked AS (
        SELECT r.id, r.user_id, h.holds,
               ROW_NUMBER() OVER (
                 PARTITION BY r.user_id, lower(btrim(r.message_id))
                 ORDER BY (NOT h.holds), r.created_at, r.id) AS rank
          FROM email_receipts r
         CROSS JOIN LATERAL (
               SELECT (r.transaction_id IS NOT NULL
                       OR r.investment_transaction_id IS NOT NULL
                       OR EXISTS (SELECT 1 FROM email_receipt_links l
                                   WHERE l.settlement_receipt_id = r.id
                                      OR l.component_receipt_id = r.id)
                       OR EXISTS (SELECT 1 FROM ai_review_requests q
                                   WHERE q.email_receipt_id = r.id
                                     AND q.status = 'applied')) AS holds) h
         WHERE r.message_id IS NOT NULL
           AND btrim(r.message_id) <> ''
    ),
    copies AS (
        SELECT id, user_id, holds FROM ranked WHERE rank > 1
    ),
    closed AS (
        UPDATE ai_review_requests q
           SET status = 'rejected',
               close_reason = 'duplicate',
               proposal = NULLIF(q.proposal - 'agentNote', '{}'::jsonb)
          FROM copies c
         WHERE NOT c.holds
           AND q.email_receipt_id = c.id
           AND q.user_id = c.user_id
           AND q.status IN ('pending', 'claimed', 'proposed')
        RETURNING q.id
    ),
    changed AS (
        UPDATE email_receipts r
           SET status = CASE WHEN c.holds THEN r.status ELSE 'ignored' END,
               status_reason = CASE WHEN c.holds THEN r.status_reason ELSE 'duplicate' END,
               message_id = NULL
          FROM copies c
         WHERE r.id = c.id
        RETURNING c.holds
    )
    SELECT (SELECT count(*) FROM closed),
           count(*) FILTER (WHERE NOT holds),
           count(*)
      INTO closed_requests, ignored_copies, cleared_copies
      FROM changed;

    IF cleared_copies > 0 THEN
        RAISE NOTICE
            'email_receipts: % duplicate copies lost their message_id (% ignored as duplicate, % open requests closed)',
            cleared_copies, ignored_copies, closed_requests;
    END IF;
END
$migration_email_receipt_message_id$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_email_receipts_user_message_id
    ON email_receipts (user_id, lower(btrim(message_id)))
    WHERE message_id IS NOT NULL AND btrim(message_id) <> '';
