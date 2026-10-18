# AI review queue retry and email-receipt matching fixes

> Companion to [`ai-review-retry-tasks.md`](./ai-review-retry-tasks.md). Builds on
> the linked-receipts line ([`email-receipts-linked.md`](./email-receipts-linked.md)),
> which the instance runs. The invariants of the email-receipts design apply
> unchanged: the mailbox is read, never written (INV-RECEIPT-001), and a receipt
> reaches the ledger only through the review card and `/ai/actions/confirm`
> (INV-RECEIPT-003).

## Why (observed on real data, 2026-10-18)

- When the built-in AI provider does not answer, the automatic step releases the
  request to `pending` with `proposal.agentNote.reason = "The AI provider did not
  answer."`. The automatic step picks only `proposal IS NULL`, so the request is
  never retried by it; it waits for an MCP agent and expires after 30 days.
- `closeReceiptRequests` (reprocess, ask-ai, ignore, delete, bulk, poll re-match,
  a component re-read) sets `rejected` and keeps the old `agentNote`, so a request
  closed by a reprocess reads as "the provider did not answer". A rejected
  request is final; there is no way to send it again.
- An automatic receipt match can pick a transaction on an `INVESTMENT_CASH`
  account (an employer pension contribution, for example). The sign is already
  checked on this line (linked receipts, decision 9).
- The same message is stored again when its IMAP identity changes (folder change,
  cursor reset, UIDVALIDITY change, archive import): the unique key is
  `(mailbox_id, uid_validity, uid)` and `message_id` is not unique.
- A record step reads one line (or one fixed multi-line block). A settlement part
  with a variable number of seller lines ("Zakup od ..." x4, each with a product
  name and "+ N inne") does not fit the 6-step limit.

## Decisions

1. **A provider failure is a retry, not an answer.** The automatic step records a
   failure in new columns `attempts`, `last_error`, `last_attempt_at` and leaves
   `proposal` NULL. It selects a request again when `attempts <
   AI_REVIEW_AUTO_MAX_ATTEMPTS` (env, default 5) and the backoff after the last
   attempt has passed: 5 min, 30 min, 2 h, 12 h (after attempt 1, 2, 3, 4). The
   failure that reaches the maximum sets `needs_agent = true`; the request stays
   `pending`, an MCP agent or the chat can still claim it. A proposal clears
   `last_error` and `needs_agent` and resets `attempts`.
2. **A closed request says why.** New column `close_reason` (`superseded`,
   `dismissed`, `cannot_be_done`, `receipt_ignored`, `receipt_deleted`,
   `mailbox_deleted`, `duplicate`, `parser_draft_superseded`). Closing removes
   `proposal.agentNote` (the note described a past attempt, not the close).
   Rows closed before the migration keep `close_reason` NULL (unknown).
3. **Reprocess closes, it does not carry over.** Reprocess re-reads the email and
   may pick another transaction or another profile; carrying an open request
   over would let a stale instruction answer a new reading. The closed request
   gets `close_reason = 'superseded'`, which is what tells it apart.
4. **A closed request can be sent again.** `POST /ai-review-requests/:id/reopen`
   and `POST /ai-review-requests/reopen-batch` (ids, or the preset "the AI
   provider did not answer"), the MCP `ai_review_requests` operation `reopen`,
   and a UI action. Re-open is refused, per request, when another open request
   exists for the same transaction, kind and rule, or (kind `email_receipt`)
   when the email no longer points at this request. The check and the update run
   in one `withScopedDb` transaction under the row lock. A re-opened request is
   `pending` with a fresh lifetime and cleared counters.
5. **One-time data migration.** Pending requests whose proposal is only the
   provider-timeout note are converted to the new columns (`proposal` NULL,
   `attempts = 1`, `last_error`, `last_attempt_at` from the note). Rejected
   `email_receipt` requests with that note are re-opened only under the rules of
   decision 4.
6. **Investment cash is not a receipt candidate by default.** The automatic
   candidate query excludes accounts of sub-type `INVESTMENT_CASH` unless the
   profile lists them in `match.includeAccountIds` (account ids, at most 20). A
   manual link is not limited. A refund direction is not built: the linked
   receipts plan assumes every receipt amount is an expense.
7. **Message-ID is the identity of a stored email.** A partial unique index on
   `(user_id, lower(btrim(message_id))) WHERE message_id IS NOT NULL`; the insert
   skips a conflict and counts it as a duplicate. The migration first resolves
   existing copies: per message it keeps the copy that holds something (a
   transaction, an investment transaction, a link row, an applied request), else
   the oldest; a copy that holds nothing is set to `ignored` with reason
   `duplicate`, its open requests closed with `close_reason = 'duplicate'`; a
   copy that holds something keeps its row and loses its `message_id`. Nothing
   is deleted. No fuzzy fallback (from, subject, total, time): two identical
   orders on one evening are real and would be merged. The migration is
   `20261018210000_email_receipt_message_id_unique.sql`; the receipt's reason
   label `duplicate` is a frontend string (beside `profile_ignore` in
   `emailReceipts.json`). A backup does not carry `email_receipts`, so a restore
   cannot meet the index. Dry run before the upgrade (read-only; lists the
   copies the migration would change, `action` says what it does to each):

   ```sql
   WITH copies AS (
     SELECT r.id, r.user_id, r.message_id, r.created_at, r.status,
            h.holds,
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
      WHERE r.message_id IS NOT NULL AND btrim(r.message_id) <> '')
   SELECT id, user_id, message_id, created_at, status, holds,
          CASE WHEN holds THEN 'clear message_id'
               ELSE 'ignore as duplicate, clear message_id' END AS action
     FROM copies
    WHERE rank > 1
    ORDER BY user_id, lower(btrim(message_id)), rank;
   ```
8. **`received_at` source is unchanged and documented**: the `Date` header when
   it parses and is not more than a day in the future, else IMAP `INTERNALDATE`.
9. **A record step can repeat.** `repeat: true` on a record step consumes 0..N
   consecutive lines that match its pattern and stop at the first line that
   matches the next step, at most 30 lines. A repeat step captures nothing
   (validation code `repeat_step_captures`) and implies `optional`.

## Not in this plan (needs a decision first)

- **Rule condition on split lines** (transaction-rules Q2): a new field
  `anySplitCategoryId` keeps existing rules' meaning; whether a request needs a
  `split_id` is open.
- **A rule trigger after an update or an email enrichment** (transaction-rules
  10.5): needs a loop guard design.
- **A refund direction for receipts.**
- **Paginating a rule `run`** beyond `MAX_RULE_RUN_LIMIT`: today a run reads the
  newest `limit` rows and returns `truncated`.

## What to run

`AGENTS.md` "Required before you push" for `backend/` and `frontend/`, plus
`migration:lint`, `scripts/verify-schema.sh` and `check-migration-prefixes.mjs`
for the two migrations and `check-env-docs.mjs` for the new env variable.

## Assumptions

- The instance runs the linked-receipts line (`claude/wizardly-thompson-cyxt50`);
  this work is built on it.
- Account sub-type `INVESTMENT_CASH` is the cash sleeve of a portfolio.
- `message_id` is the raw `Message-ID` header value, compared without case and
  surrounding spaces.
