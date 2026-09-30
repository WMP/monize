# Email receipts: order-confirmation emails enrich bank transactions

Companion files: [`email-receipts-tasks.md`](./email-receipts-tasks.md) (the
task list) and [`../specs/email-receipt-matching.md`](../specs/email-receipt-matching.md) (the
matching and proposal arithmetic: truth tables, numerical examples, missing-data
policy, test matrix).

Status: **implemented on a fork branch, not approved upstream.** Discussion
kenlasko/monize#930 proposes the feature; the maintainer has not given it the
`approved-to-build` label. The branch author asked for the whole feature in one
branch. The maintainer decides whether it merges, in what slices, and the open
questions in section 12.

## 1. Goal

A bank transaction says how much and when, not what was bought. The order
confirmation email says what. The user forwards (or filters) order
confirmations to a dedicated mailbox; Monize reads that mailbox over IMAP,
read-only, finds the transaction each email pays for, and proposes an
enrichment: a description, a split by line item with a category per line, a
payee. The user approves the proposal in the review queue. Nothing is written to
the ledger without an approval, except by an opt-in auto-apply that section 7
bounds.

"AI is a compiler": a per-merchant parser is written once (by the user, or
drafted by the user's AI provider from one sample email and approved by the
user) and then runs deterministically. The AI is not called per email unless the
user chose that.

Out of scope for this branch: receipt photos and OCR (a vision pass over an
image attachment), OAuth2 (XOAUTH2) mailbox login, more than one mailbox per
user, POP3, and attaching the email's PDF parts to the transaction. Section 11
records them.

## 2. What exists, and what this composes

| Piece | Where | Used for |
|---|---|---|
| Glob with named captures | `backend/src/transaction-rules/rule-glob-capture.ts` | Every extraction pattern of a parser, applied to one line at a time |
| AI review queue | `backend/src/ai-review/` | The processing queue: a proposal is a signed `PendingAiAction`, approved through `/ai/actions/confirm`, marked applied in the write's own transaction |
| Proposal validation and card | `AiReviewWorkService.submit` / `buildCard` | Exact split sum, category resolution, transfer refusal, the confirmation card |
| AI providers | `AiService.complete` | Drafting a parser from a sample; proposing an enrichment for an email no parser reads |
| Secret encryption | `EncryptionService` | The IMAP password (AES-256-GCM) |
| Egress policy | `ai/providers/provider-egress.ts`, `ai/validators/safe-url.validator.ts`, `ai/validators/private-base-url-allowlist.ts` | The IMAP host reaches only public addresses unless the owner is an admin or the operator allows it |
| Per-user lease | `JobClaimService.claimLease` | One poll per mailbox at a time across replicas |
| Payee lookup | `PayeesService.resolveByName` | The parser's payee, and the proposal's payee name |

**Why the rules engine is not the parser.** The rule condition tree and its
facts are typed to a transaction row, and the glob matcher refuses text longer
than 500 characters, finds one match per pattern and has no repetition. An
email body is thousands of characters and a receipt has N line items. So the
parser is its own small language, but every pattern in it is a rule glob,
matched by `matchGlobWithCaptures` against one line of the email's text (lines
are cut to 500 characters). No regular expression is accepted anywhere, for the
same reason the rules refuse one (ReDoS, `docs/future-plans/transaction-rules.md`
section 10.5).

## 3. Product decisions

1. **One mailbox per user**, dedicated to receipts. The settings screen says the
   mailbox should hold nothing else: every message in its folder is read.
2. **Read-only.** The folder is opened with `EXAMINE` (`readOnly: true`) and
   messages are fetched with `BODY.PEEK`. Monize never sets a flag, moves,
   deletes or appends. Progress is a UID cursor stored in Monize.
3. **TLS always.** `security` is `tls` (implicit, port 993) or `starttls`
   (port 143, upgrade required). There is no plaintext mode. The certificate is
   verified; there is no "accept any certificate" switch.
4. **First sync is bounded**: messages received in the last 30 days. After that,
   every message with a UID above the cursor, 50 per poll (operator-tunable).
5. **The review queue is the existing AI review inbox** (`/ai-reviews`). A
   receipt's proposal is a request of kind `email_receipt`. The receipts page
   (`/email-receipts`) lists every stored email with its state and the actions
   on it (link to a transaction, reprocess, ask the AI, draft a parser, ignore,
   delete).
6. **AI mode** per mailbox: `off` (the AI is never called for receipts),
   `on_demand` (only when the user presses "Ask AI" or "Draft parser with AI"),
   `automatic` (the poll asks the AI, bounded per tick, for a matched receipt
   no approved parser could fully read, and drafts a parser for a sender domain
   that has none). An AI answer is always a proposal or a draft; it is never
   applied or approved on its own.
7. **Auto-apply** (off by default) applies a proposal without asking only when
   all of: an approved parser read the email completely, the match is by order
   number or by exact amount plus payee with a single candidate, and the
   proposal balances to the cent. It applies through the same signed card and
   the same `/ai/actions/confirm` path a person's approval uses, so what is
   applied is what the card would have shown. Everything else waits for a
   person.
8. **A receipt that matches nothing is retried** on every poll for 30 days
   after it arrived: the bank transaction usually arrives later than the email.
9. **The email is kept** (subject, sender, date, text up to 100,000 characters)
   until the user deletes it or deletes the mailbox. The raw MIME source and
   HTML are not stored; the HTML is converted to text at ingestion.
10. **Owner only.** A delegate sees neither the settings nor the receipts page,
    and the API refuses a delegate's session.

## 4. Data model

Four changes, one migration each (`database/migrations/`), mirrored in
`database/schema.sql`, every table with its RLS policy and
`ENABLE ROW LEVEL SECURITY` in the same file.

```
email_receipt_mailboxes              -- one per user (unique user_id)
  id, user_id
  host varchar(255), port int (1..65535), security varchar(10) 'tls'|'starttls'
  username varchar(320), password_enc text      -- EncryptionService; never returned
  folder varchar(255) default 'INBOX'
  enabled bool default false
  ai_mode varchar(12) default 'off'  'off'|'on_demand'|'automatic'
  auto_apply bool default false
  uid_validity bigint null, last_uid bigint null  -- the cursor
  last_polled_at, last_success_at, last_error varchar(300), last_error_at
  created_at, updated_at

email_receipt_parsers
  id, user_id, name varchar(100)
  payee_id uuid null -> payees ON DELETE SET NULL
  from_domains text[] (1..10 entries, lower-case, no '@')
  subject_contains text[] (0..10)
  definition jsonb                               -- section 5
  status varchar(10) 'draft'|'approved', source varchar(10) 'manual'|'ai'
  approved_at timestamptz null, revision int     -- compare-and-swap
  created_at, updated_at

email_receipts
  id, user_id, mailbox_id -> email_receipt_mailboxes ON DELETE CASCADE
  uid_validity bigint, uid bigint, message_id varchar(500) null
  from_address varchar(320), from_domain varchar(255), subject varchar(500)
  received_at timestamptz, body_text text (<= 100,000 chars)
  status varchar(20)  -- section 6
  status_reason varchar(40) null
  parser_id -> email_receipt_parsers ON DELETE SET NULL
  parsed jsonb null                             -- ParsedReceipt, section 5.3
  transaction_id -> transactions ON DELETE SET NULL
  candidate_transaction_ids uuid[] (<= 10)
  match_kind varchar(20) null  'order_id'|'amount_payee'|'amount_only'|'manual'
  ai_review_request_id uuid null (no FK: the request table references this one)
  created_at, updated_at
  UNIQUE (mailbox_id, uid_validity, uid)        -- ingestion idempotency

ai_review_requests (widened)
  kind CHECK widened to ('transaction_review', 'email_receipt')
  email_receipt_id uuid null -> email_receipts ON DELETE SET NULL
```

The existing partial unique index on `(transaction_id, rule_id)` while a
request is open is kept unchanged (its predicate is what the running
`enqueue`'s `ON CONFLICT` infers during a rolling deploy). Its consequence is a
decision: one open request without a rule per transaction. A receipt whose
transaction already has an open manual or receipt request is reported as
`review_conflict` and can be reprocessed once that request closes.

Backup: `email_receipt_mailboxes` is excluded (an encrypted credential for
another instance's key, like `backup_offsite_settings`); `email_receipts` is
excluded (a mailbox copy the user can re-read); `email_receipt_parsers` is
exported, and its support-backup rules drop the free text. Section 11 records
the trade.

## 5. The parser

### 5.1 Definition (`definition` jsonb, version 1)

```json
{
  "version": 1,
  "orderId": ["*order #{orderid}*", "Order number: {orderid}"],
  "total": ["Order total: {amount}", "*Grand total*{amount}"],
  "shipping": ["Shipping: {amount}"],
  "discount": ["Discount: {amount}"],
  "items": {
    "startAfter": "Items in your order",
    "stopAt": "Subtotal",
    "patterns": ["{qty} x {name} {amount}", "{name} {amount}"]
  },
  "categoryRules": [
    { "match": "*cable*", "categoryId": "<uuid>" },
    { "match": "*book*", "categoryId": "<uuid>" }
  ],
  "defaultCategoryId": "<uuid>",
  "shippingCategoryId": "<uuid>"
}
```

- Every pattern is a rule glob (`*` wildcard, `{name}` capture), matched
  case-insensitively against one whole line. `orderId` patterns are tried on
  the subject first, then on each line.
- Capture names: `orderid` (order patterns), `amount` (total, shipping,
  discount), and in item patterns `name` (required), `amount` (the line total)
  or `price` with `qty` (the line total is `price * qty`), `qty` optional
  (default 1).
- `startAfter` / `stopAt` are plain case-insensitive substrings that bound the
  item section: items are read from the line after the first line containing
  `startAfter` (or from the top) up to the first line containing `stopAt`
  (or the end).
- A line item's category is the first `categoryRules` entry whose glob matches
  the item's name, else `defaultCategoryId`, else the parser payee's default
  category, else none.

### 5.2 Bounds (validated on save, by the same validator the AI draft passes)

At most 10 patterns per field, 200 characters per pattern, 5 captures per
pattern (the glob's own limit), 50 category rules, 100 characters per section
marker; unknown keys refused; every category id owned by the user (checked in
the write's transaction). Parsing reads at most 2,000 lines and 100 items.

### 5.3 Output (`ParsedReceipt`)

`{ orderId, total, shipping, discount, items: [{ name, qty, amount,
categoryId }], complete, reason }`, every amount a non-negative integer in
1/10000 units. `complete` is true only when `total` was found and the items,
plus shipping, minus discount, equal the total exactly and every item and the
shipping line (when present) has a category. `reason` names the first missing
thing otherwise. The spec has the amount grammar and the truth table.

## 6. Pipeline and receipt states

```
poll -> store (status pending)
     -> choose parser: none -> no_parser
     -> parse: no total -> parse_failed
     -> match: none -> unmatched (retried 30 days) | several -> ambiguous
     -> propose: an open request exists -> review_conflict
               | proposal stored (status review)
     -> auto-apply (opt-in, section 3.7)
user -> link to a transaction (any state but ignored) -> propose
     -> ignore -> ignored
     -> reprocess -> back to the top (a closed request is not reopened)
     -> ask AI (mode on_demand|automatic) -> request pending, then proposed
```

`skipped` is a message larger than the size cap or that could not be decoded
(`status_reason` says which). The receipts page derives the shown state of a
`review` receipt from its request: `proposed`, `applied`, `dismissed`,
`expired` or `pending_ai`.

The proposal uses `AiReviewWorkService.submit` as an agent does, with the
claim key `email-receipts` (deterministic) or `email-receipts-ai` (the AI):
the receipts service inserts the request already claimed by its key, then
submits. A proposal the validation refuses (the lines do not add up, a category
was deleted) falls back to the description-only proposal; if that is refused
too, the request is released as rejected with the reason, and the receipt
shows it.

What a proposal contains:

- **Complete parse and the transaction amount equals the parsed total**: split
  lines, one per item (memo `name` or `name x qty`), plus shipping and discount
  lines, each signed like the transaction; a single line is not a split but a
  category. The description is the existing one with ` | ` and the summary
  appended (capped at 750).
- **Anything else**: the description only, with the summary; the receipt page
  names the reason (`amount_differs`, `items_uncategorized`, ...).
- **Payee**: the parser's payee name when the transaction has none.

## 7. Invariants

| ID | Statement | Mechanism |
|---|---|---|
| INV-RECEIPT-001 | The mailbox is read, never written | The IMAP client opens the folder with `readOnly: true` and fetches with `BODY.PEEK`; the client module exposes no flag, move, delete or append call; a unit test asserts the options and a source scan asserts that `messageFlagsAdd`, `messageMove`, `messageDelete`, `append` never appear |
| INV-RECEIPT-002 | A receipt is ingested once | `UNIQUE (mailbox_id, uid_validity, uid)` with `ON CONFLICT DO NOTHING`; the cursor advances in the transaction that inserts the rows |
| INV-RECEIPT-003 | A receipt changes the ledger only through an approved (or opt-in auto-applied) card, and never moves money | The proposal is `AiReviewProposalInput` (no amount, date, account or status); it is written only by `/ai/actions/confirm` with `markApplied` in the same transaction; auto-apply calls the same `confirm` with the card it built |
| INV-RECEIPT-004 | The mailbox connection reaches only a public address unless the owner is an admin or the operator allowed the host | The host is checked on save (IP literal, blocked names, DNS) and at connect (`publicOnlyLookup` passed as the socket's `lookup`, IP literal refused) |
| INV-RECEIPT-005 | The password is encrypted at rest and never returned | `EncryptionService.encrypt`; the view carries `passwordSet: boolean`; the table is excluded from backups; errors are logged through `describeFetchFailure`, never with the password |
| INV-RECEIPT-006 | One poll per mailbox at a time across replicas | `JobClaimService.claimLease(EmailReceiptPoll, userId, mailboxId)` around the poll, released by token |

`docs/system-invariants.md` carries each with an honest status.

## 8. Backend

Module `backend/src/email-receipts/`:

- `mailbox/`: entity, DTOs, `EmailReceiptMailboxService` (get view, upsert,
  delete, test connection), host policy.
- `imap/`: `ImapMailboxClient` (the only file importing `imapflow`) and
  `mail-text.util.ts` (the only file importing `mailparser`; HTML to text,
  line normalisation, caps).
- `parsing/`: definition types, validator, `parseReceipt(definition, subject,
  text)`, amount grammar. Pure.
- `matching/`: `matchReceipt(parsed, candidates, parserPayeeId)`. Pure.
- `proposal/`: `buildReceiptProposal(parsed, transaction, context)`. Pure.
- `EmailReceiptsService`: list, get, link, ignore, delete, reprocess, ask AI.
- `EmailReceiptPipelineService`: parse, match, propose for one receipt.
- `EmailReceiptPollService`: the `@Cron` (every 15 minutes), per-user lease,
  ingestion, rematch of `unmatched`, the automatic AI step.
- `EmailReceiptAiService`: draft a parser from a receipt; propose for a
  receipt's request. Uses `AiService.complete` with `responseFormat: "json"`,
  feature labels `email_receipt_parser` and `email_receipt_review`; the email
  text is sanitized, truncated and framed as untrusted data.
- `EmailReceiptParsersService` + controller: CRUD, approve, test against a
  stored receipt.

The AI review queue gains the `email_receipt` kind, `claimById`, and an
`enqueueClaimed` producer; the MCP and assistant `claim` result carries the
email (sender, subject, date, text up to 20,000 characters) for that kind, so
an MCP agent can answer a receipt request too.

Environment (operator, all optional): `EMAIL_RECEIPTS_MAX_MESSAGES_PER_POLL`
(50), `EMAIL_RECEIPTS_MAX_MESSAGE_BYTES` (2,000,000),
`EMAIL_RECEIPTS_PRIVATE_HOST_ALLOWLIST` (empty).

## 9. Frontend

- `/settings/email-receipts`: the mailbox form (write-only password, test
  connection, poll now, AI mode, auto-apply, last poll and last error), and the
  parsers list with an editor (name, domains, subject words, payee, patterns
  one per line, section markers, category rules, default and shipping
  category), a test panel against a stored receipt, approve and delete.
- `/email-receipts` (Tools menu, owner only): the receipts table with state
  badges and actions; a detail dialog with the text, the parsed result and the
  candidates.
- `/ai-reviews`: an `email_receipt` row shows the sender and subject instead of
  the rule name.

## 10. Test matrix

| Layer | Suite | Proves |
|---|---|---|
| Unit | `parsing/*.spec.ts` | Amount grammar, item section, captures, bounds, `complete` truth table |
| Unit | `matching/*.spec.ts` | Every row of the match truth table (spec section 3) |
| Unit | `proposal/*.spec.ts` | Signs, single line vs split, shipping and discount lines, description cap |
| Unit | `imap/*.spec.ts` | Read-only options, egress lookup passed, IP literal refused, source scan of write calls |
| Unit | services | Lease, cursor, rematch window, auto-apply gate, AI modes, owner-only |
| Integration | `email-receipts.integration.spec.ts` | Ingestion idempotency on the unique key; RLS isolation of the three tables; the widened kind CHECK |
| Frontend | components | Settings form never shows the password; states and actions; inbox row for the new kind |

## 11. Deliberately left for later

- Receipt photos and PDF attachments (vision or OCR, then the same parser).
- OAuth2 login for Gmail and Microsoft 365 (an app password works today).
- Several mailboxes per user; a per-parser currency; tolerance for an amount
  that differs by an FX conversion.
- Backing up mailboxes (credentials) and receipts.

## 12. Open questions for the maintainer

- **Q1.** Is the review inbox the right queue, or should receipts have their
  own proposal store? (This branch reuses the inbox.)
- **Q2.** Should auto-apply exist at all, given INV-RULE-001's "never committed
  without a human approval" for AI proposals? (It is limited here to a
  deterministic, user-approved parser and a single strong match.)
- **Q3.** Retention: should stored email text be purged after N days?
