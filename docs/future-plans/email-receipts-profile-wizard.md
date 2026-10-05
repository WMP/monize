# Email receipts: domain profile wizard

> Companion to [`email-receipts.md`](./email-receipts.md) (the design) and
> [`email-receipts-profile-wizard-tasks.md`](./email-receipts-profile-wizard-tasks.md)
> (the task list). The invariants of the parent design apply unchanged: the
> mailbox is read, never written (INV-RECEIPT-001), and a receipt reaches the
> ledger only through the review card and `/ai/actions/confirm`
> (INV-RECEIPT-003).

## Why

Parsing is automatic: the poll cron runs every `pending` email through the
pipeline, and an approved profile for the sender domain parses it. A manual
"Parse all" button on every screen therefore suggests that nothing happens
without it, and it does nothing useful for an email that has no profile. What
the user actually lacks is a guided way to create the profile for a domain
that has none.

## Decisions

1. **Tabs** are ordered `overview`, `mailbox`, `profiles`, `emails`.
2. **The manual processing button is shown only when it can change
   something**:
   - in the Emails tab, "Retry failed emails" while the status counts report
     `parse_failed > 0`; it processes only `parse_failed` emails
     (`process-batch` with `statuses: ["parse_failed"]`);
   - on a profile row, "Re-parse emails" while `reprocessableCount > 0`: emails
     of the profile's domains in a processable status that were last processed
     before the profile's last change (`updated_at < parser.updated_at`).
   The Overview card and the unconditional Emails-tab button are removed.
3. **Approving a profile processes its domain**: after approval the client
   runs `process-batch` with the profile's domain, so the user does not need
   a button for the common case.
4. **The Profiles tab opens with "Create a profile for a domain"**: a cloud of
   sender domains that have stored emails and no approved profile. A click
   starts the wizard for that domain.
5. **The wizard runs in place**, in four steps:
   1. *Samples.* A table of the domain's emails. Each row opens the email
      content (HTML, text, numbered lines) and has a transaction picker. A row
      can be selected only when a transaction is chosen; at most 5 rows.
      The email-to-transaction pairs stay in the wizard: nothing is written to
      the receipts at this step.
   2. *Generate.* The pairs go to `POST /email-receipt-parsers/generate-with-ai`.
      The server runs the assistant synchronously with the email bodies and the
      transactions (date, amount, payee, category splits) and the
      `email_receipt_parsers` tool; the assistant tests its definition against
      the samples and saves a draft. The response names the draft.
   3. *Preview.* `POST /email-receipt-parsers/:id/preview` runs the draft over
      the domain's emails, read-only, and returns two lists: the selected
      samples (with the expected transaction and whether the parse agrees with
      it) and every other email of the domain.
   4. *Accept or revise.* Accept approves the draft (existing
      `POST /email-receipt-parsers/:id/approve`) and processes the domain.
      Revise returns to step 2 with a free-text note; the server sends the
      draft, the note and the samples back to the assistant, which updates
      the same draft.
6. `ProfileCreationGuide` (a static four-step text) is removed; the wizard
   replaces it.

## API contract

- `GET /email-receipts/domains/uncovered` returns
  `[{ domain, count, draftParserId | null }]`, at most 200, count descending:
  domains of the user's stored emails with no approved profile matching them
  (subdomains match as in the pipeline).
- `POST /email-receipt-parsers/generate-with-ai`, body
  `{ domain, samples: [{ receiptId, transactionId }] (1..5, unique receipt ids,
  every receipt from that domain, every transaction the user's), parserId?,
  feedback? (max 2000 chars) }`. Returns `{ parserId, revision, answer }`; a
  run that saved no draft is a 422 carrying the assistant's answer. Requires
  a configured AI provider (same check as the assistant).
- `POST /email-receipt-parsers/:id/preview`, body
  `{ selectedReceiptIds: uuid[] (0..5), expected?: [{ receiptId, transactionId }] }`.
  Returns `{ selected: PreviewItem[], others: PreviewItem[], othersTotal }`,
  where `others` is capped at 100 newest and `PreviewItem` is
  `{ receiptId, subject, receivedAt, outcome, statusReason, parsed: { date,
  total, currency, lineCount } | null, match: { transactionId, summary } | null,
  expected: { transactionId, summary } | null, agrees: boolean | null }`.
  It writes nothing.
- `GET /email-receipt-parsers` adds `reprocessableCount` to each parser.
- `POST /email-receipts/process-batch` accepts `statuses?` (a subset of the
  processable statuses).
- The tool action `testDefinition` accepts the expected transaction per sample
  and reports whether the parsed date and total agree with it.

## Verification

Backend: lint, both typechecks, `test:changed`, and `build` plus
`test:integration` (new queries). Frontend: lint, type-check, i18n:check,
`test:changed`, build. Observed: on a stack with a mailbox holding emails of a
domain without a profile, the Profiles tab shows the domain in the cloud; the
wizard produces a draft, the preview lists both groups, and accepting moves
the domain's `no_parser` emails out of `no_parser`.
