# S11 Email receipts and document scanner

Status: in-progress, remaining: mutation table results, S05 hand-off probe, sections 6-14.

## 1. Metadata

| Field | Value |
| --- | --- |
| Session | S11 (parallel wave, child session_01NGWhzqqpfZRRd58ooquSgs) |
| `AUDIT_BASELINE_SHA` | `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86` |
| Pin check | `git diff --stat 72c59ec4 HEAD -- . ':!docs/audits/2026-10' ':!docs/audits/2026-08-upstream'` empty |
| Date | 2026-10-21 |
| Primary path | `backend/src/email-receipts/` |
| Hint line | `prioritize mailbox credentials and OAuth tokens (encrypted, scoped, never returned), email content as untrusted input to the AI parser and to HTML rendering (prompt injection, escapeHtml), parsed amounts and currencies as server-authoritative versus parser-supplied, at-most-once receipt-to-transaction and receipt-to-trade creation under poll retries, the executed-total-is-the-fact rule for parsed trades, partial pipeline failure and compensation, and provider call multiplicity` |
| Runtime | see section 12 |

## 2. Invariant map

| ID | Statement | Mechanism named | Holds at baseline? |
| --- | --- | --- | --- |
| INV-RECEIPT-001 | The mailbox is read, never written | `imap-mailbox-client.ts` sole `imapflow` importer; `mailboxOpen(..., { readOnly: true })` (EXAMINE) at `:237, :256`; `fetchOne(..., { source: true })` = `BODY.PEEK[]` (`:278`); `imap-source-scan.spec.ts` | Yes (static; no real-IMAP test, as the index says) |
| INV-RECEIPT-002 | One row per (mailbox, UIDVALIDITY, UID); the cursor never passes an unstored message | `uq_email_receipts_message UNIQUE (mailbox_id, uid_validity, uid)` + `ON CONFLICT DO NOTHING` (`poll/receipt-rows.ts:142-149`); cursor moved by `advanceCursor` (`GREATEST` on one UIDVALIDITY) inside the insert's `withScopedDb` (`email-receipt-poll.service.ts:411-424`) | Yes. One edge: a UID that vanishes between `SEARCH` and `FETCH` is passed by the cursor without a row (`imap-mailbox-client.ts:272, :283`); the message is gone, so nothing is lost (section 8) |
| INV-RECEIPT-003 | A receipt changes the ledger only through the signed card and `confirm`; the card never moves money | `AiReviewWorkService.submit` (exact split sum, owned categories, no transfer), `markApplied` (`ai-review-requests.service.ts:853-879`) in the write's transaction; auto-apply = `confirm` with the built card after the pipeline commit (`email-receipt-pipeline.service.ts:312-315, :1318-1335`), gated by `autoApplyAllowed` | Yes |
| INV-RECEIPT-004 | A non-admin mailbox reaches only a public address | `assertMailboxHostAllowed` on save, `assertMailboxHostLiteralAllowed` + `mailboxEgressLookup` at connect (`imap-mailbox-client.ts:146, :367`); OAuth host from the closed table (`email-receipt-mailbox.service.ts:505-530`); admin read from the user's own row per poll (`:670-678`) | Yes |
| INV-RECEIPT-005 | Password / refresh token encrypted, never returned, logged or stored in `last_error` | `EncryptionService.encrypt` before the write (`mailbox.service.ts:133, oauth.service.ts:157`); `select: false` + `readStored` the only `addSelect` (`:654-664`); `toMailboxView` copies field by field with booleans; `describeMailboxFailure(error, secrets)`; access token only in memory (`oauth-access-token.service.ts`) | Yes |
| INV-RECEIPT-006 | One poll per mailbox at a time across replicas | `claimLease(EmailReceiptPoll, userId, mailboxId, POLL_LEASE_MS = 10 min)` around `pollLeased` and `processStoredNow` (`poll.service.ts:212-227, :240-262`), released by token; a work budget of 8 min checked only between emails and before the AI step (`:358, :363, :374`) | Within the lease only: the lease is outrun by provider calls that start before minute 8 (A26-S11-01) |
| INV-RECEIPT-007 | An OAuth callback completes only the caller's flow, once, in 10 min | `oauth-state.ts`: AES-GCM envelope (user, provider, PKCE verifier, nonce, exp), `state.userId !== userId` refused before `SingleUseTokenService.claim(OAUTH_STATE_PURPOSE, nonce)` (`email-receipt-oauth.service.ts:249-265`) | Yes. The flow mints no JWT: the A26-S03-03 deny-list pattern does not apply (section 8) |
| INV-RECEIPT-008 | A trade email creates an investment transaction only through its signed card; never twice | `uq_ai_review_requests_trade_open` + `enqueueTrade ON CONFLICT` (`ai-review-requests.service.ts:335-363`); `markTradeApplied` (bound to `proposed`, unexpired) + `findTradeInLedger` under the holdings lock in `beforeWrite`, `recordTradeBooking` in `afterWrite` (`ai/actions/ai-actions.service.ts:1098-1190`); `onlyWhenStatusIn` + `email_trade` early return keeps automatic passes off a trade proposal (`pipeline.service.ts:462-468`) | Yes for creation. The link half (`email-receipt-trade-link.service.ts:150-308`) has no lock or unique index on the linked row (DR-S11-2) |
| INV-TRADE-001 (receipt half) | The executed total is the fact; a price-only caller has the total derived from the price | `parse-trade.ts:559-571` `tradeExecutedTotalUnits`; card `totalAmount` (`email-receipt-trade.service.ts:177-185`) then `resolveInvestmentAmounts` | Total stated: yes. Price only: the total is derived from the price rounded to 4 decimals, not the price as written (A26-S11-02, executed P1) |
| (pipeline) A refusal writes nothing; a provider call holds no row lock | One `withScopedDb` per pass holding the receipt row lock (`pipeline.service.ts:292-310`); the AI category question asked between two transactions (`:295-310`) | The AI half holds. The trade half does not: `buildTradeCard` -> `previewCreateInvestmentTransaction` -> `getRateForDate` may fetch a rate from the provider inside the receipt's transaction (A26-S11-03) |
| (AI trust boundary) Email content is data; an AI answer reaches the ledger only through validation and a person | `email-receipt-ai.prompts.ts` (text as data), `buildAiParsedReceipt`, `AiReviewWorkService.submit`; AI drafts born `draft`, validated, category ids checked (`email-receipt-ai.service.ts:170-284`); `processAiRequest` never confirms | Yes |
| (HTML boundary) Email HTML never becomes markup of the app | `EmailHtmlFrame.tsx`: `<iframe sandbox="" srcDoc>` with a CSP meta first, `referrerPolicy="no-referrer"`; text in `<pre>`; parser patterns are globs, no `RegExp` built from a profile (`receipt-glob.ts`) | Yes |
| (archive import) Decompression and message counts are bounded; nothing outside PostgreSQL | `zip-archive.ts` counts inflated bytes (100 MB/request, 2 000 entries), `MAX_IMPORT_MESSAGES = 5 000`, per-message cap; uid = 63 bits of SHA-256 of Message-ID or bytes under `uid_validity 0` | Yes |

Material flows (`producer -> transformations -> storage -> consumers -> side effects`):

- Poll: `@Cron */15` -> `listEnabledMailboxes` (system) -> per mailbox `withUserContext` -> `claimLease` -> `loadConnection` (decrypt / OAuth refresh, rotated token CAS) -> `fetchSince` (EXAMINE, PEEK) -> `buildReceiptRow` (mail text, forwarded identity) -> `insertReceiptRows` + `advanceCursor` (one transaction) -> `processStored` (pending, rematch, AI step) -> `attention.evaluate` -> `releaseLease`.
- Receipt to transaction: stored row -> `pipeline.process` (row lock, parser choice, parse, schema.org fallback, settlement join, match, category history, optional AI categories between two transactions) -> `enqueueClaimed` (advisory lock on the transaction + `NOT EXISTS`) -> `AiReviewWorkService.submit` (signed card) -> commit -> optional `actions.confirm` -> `markApplied` + transaction enrichment.
- Receipt to trade: stored row -> `EmailReceiptTradeService.process` (`readTradeEmail`, `toInput`: executed total, currency, account by rule) -> `findTradeInLedger` -> `enqueueTrade` -> `submitTrade` -> `buildTradeCard` (`resolveByTradeSymbol`, currency refusal, ledger refusal, scheduled occurrence, `previewCreateInvestmentTransaction`) -> commit -> person or auto-apply `confirm` -> `beforeWrite` (`markTradeApplied`, ledger re-check under holdings lock) -> `investment_transactions` (or the schedule's `post`) -> `afterWrite` (`recordTradeBooking` on the email).
- Mailbox secrets: DTO password / OAuth code -> `EncryptionService.encrypt` -> `password_enc` / `oauth_refresh_token_enc` (`select: false`) -> `readStored` -> `loadConnection` / `testConnection` -> IMAP login (TLS required) -> failure line via `describeMailboxFailure(secrets)` -> `last_error` -> view.

## 3. Lens ledger

| Lens | Ran / not applicable |
| --- | --- |
| Pin the revision | ran (section 1) |
| Instructions before implementation | ran: `AGENTS.md`, root and `backend/CLAUDE.md`, `.claude/commands/audit.md`, INV-RECEIPT-001..008 and INV-TRADE-001 in `docs/system-invariants.md`, `docs/cron-jobs.md` row `email-receipt-poll.service`, `docs/external-side-effects.md` OAuth section, `docs/specs/email-receipt-matching.md` (aiCategories, bulk), `docs/specs/document-scanner.md` (context) |
| Summaries as hypotheses | ran: the S08, S05 and S03 hand-offs and the index's "enforced" statuses were each re-derived from code (section 8) |
| Invariant model first | ran (section 2) |
| Change surface / producer-consumer | ran: `email_receipts.investment_transaction_id` (producers `recordTradeBooking`, trade link, pipeline `trade_exists`; consumers `findTradeInLedger`, trade-link candidates, `refuseUnprocessable`), `ai_review_requests` rule-less open rows (producers `insertReceiptRequest`, rule deletion `ON DELETE SET NULL`; consumer the `NOT EXISTS` exclusion), `ParsedTrade.price` / `total` (producer `parseTradeLinesTraced`; consumers `tradeExecutedTotalUnits`, `toInput`, preview, card), `last_error` (producers `recordPollFailure`; consumer the view) |
| Representation boundary | ran: trade price units (1e-8 read, 1e-4 kept, A26-S11-02); `currency` null vs email-named vs security-derived (`parse-trade.ts:450-468`, refusal in `buildTradeCard`); `password` absent vs blank vs value (DTO keeps on absent/blank); `lastUid` null vs value on a new UIDVALIDITY (`advanceCursor`); `categoryHints` undefined vs null vs array (pipeline two-pass) |
| Browser / UI round trip | ran (narrow): mailbox settings form resends host, user name and folder; the server compares values, not presence (`mailbox.service.ts:169-175`), so an unchanged resend needs no password and never resets the cursor; the email HTML is never page markup (`EmailHtmlFrame.tsx`) |
| Server-authoritative metadata | ran: `userId` from the JWT on every controller; transaction to link checked under `user_id` (`linkable-transaction.ts`); trade account from the profile's rules and the security from `resolveByTradeSymbol` under the user; currency mismatch refused (`ai-review-work.service.ts:615-630`); the AI's category ids filtered to owned ones; write-limit exemption read from stored rows only (`isExemptFromWriteLimit`) |
| Identity versus value | ran: imported uid = hash of Message-ID or bytes (two different messages with one Message-ID collapse into one row, accepted: section 8); a trade already booked is matched by value (`findTradeInLedger`), and the claim column `investment_transaction_id` disambiguates identical fills |
| State machine | ran: receipt statuses x request statuses for the automatic guards (`onlyWhenStatusIn`, applied, `email_trade` early return, rejoin); trade request `claimed -> proposed -> applied/rejected/expired`; mailbox password <-> oauth2 switching |
| Concurrency and idempotency | ran: lease (A26-S11-01, executed P2), ingest `ON CONFLICT` + `GREATEST` cursor, advisory lock + `NOT EXISTS` for rule-less requests, `enqueueTrade` partial unique index, `markApplied` / `markTradeApplied` CAS, refresh-token rotation CAS, trade link (DR-S11-2) |
| Partial failure and compensation | ran: ingest is one transaction; the pipeline commits before auto-apply and before the settlement re-joins (DR-S11-3); a provider call inside the trade card's transaction (A26-S11-03); OAuth exchange outside the write; nothing is written outside PostgreSQL by the import |
| External provider lookup | ran: AI provider calls per tick (A26-S11-01; the documented "at most 5" is 15, section 11); OAuth token endpoint once per connection; FX provider through the trade preview (A26-S11-03); negative caching: a failed draft marks `draft_failed`, a failed AI request is released with a note and not retried by the poll |
| Database and migration | ran (narrow): `uq_email_receipts_message`, `uq_ai_review_requests_trade_open`, the non-unique `idx_email_receipts_investment_transaction`, `ai_review_requests.rule_id ON DELETE SET NULL`; migrations are S05's (`email-receipts-schema` integration suite passed) |
| Backup / restore | not applicable as a lens of this slice beyond one fact: `email_receipt_mailboxes` is excluded from backups (INV-RECEIPT-005); the receipt tables' restore is S06's |
| Financial | ran: trade total and price (A26-S11-02, numerical), commission direction (`commissionIsAdded`), cross-currency refusal, purchase matching tolerance in 1/10000 units; the purchase path never changes an amount (the card is splits that `submit` checks to the exact sum) |
| Authorization / RLS | ran: every controller class-level `AuthGuard('jwt')`, `ParseUUIDPipe` on `:id`, throttles; cron fan-out `withSystemContext` then `withUserContext` per mailbox; OAuth state bound to the user before the nonce is spent |
| Tests as evidence | ran: unit 102 suites / 2 985 tests, integration 8 suites / 223 tests on the baseline; where each enters and stops is in section 10 |
| Mutation | ran (section 6) |
| Counterexamples and interaction | ran (section 7) |
| Adversarial approval challenge | ran (section 13) |

## 4. Confirmed findings

Ordered by severity: A26-S11-04 (HIGH), then A26-S11-01, -02, -03 (LOW). IDs are in the order found.

### A26-S11-04 - Any sender can make its email read as the broker's by pasting a "Forwarded message" header block, and with auto-apply on the trade it states is booked with no person

1. **Severity:** HIGH
2. **Confidence:** high (executed, P3, real PostgreSQL under RLS, the real poll, pipeline, card, auto-apply and `confirm`)
3. **Location:** `backend/src/email-receipts/imap/forwarded-receipt.ts:33-71` (`resolveForwardedIdentity`: any text with a forwarded header block replaces `from_address` / `from_domain` / `subject`; the outer sender is not compared with anything); `poll/receipt-rows.ts:85-104` (applied at ingestion, comment "A forward from the user's own address", not enforced); `pipeline/email-receipt-pipeline.service.ts:475, :1187-1216` (re-applied on every pass); `pipeline/choose-receipt-parser.ts` (the parser is chosen by `from_domain`); `pipeline/email-receipt-trade.service.ts:145-150` (the trade auto-apply gate: mailbox switch, approved profile, consistent reading, no ledger match; nothing about the sender); `pipeline/auto-apply-gate.ts:39-58` (the purchase gate, same gap); `pipeline/email-receipt-pipeline.service.ts:312-315, :1318-1335` (`confirm` with the built card).
4. **Violated invariant:** INV-RECEIPT-008 and INV-RECEIPT-003 as the design argues them: decision 12 of `docs/future-plans/email-receipts.md` says the forwarded block "can only choose which approved parser reads the email and which days to look at: it never reaches the ledger except through the same card and approval". Under auto-apply the approval is the gate, and the gate trusts the claimed sender. The server-authoritative rule of the protocol: the identity that decides which of the user's approved profiles may write the ledger is taken from attacker-controlled text.
5. **Realistic reproduction scenario:** the owner connects their inbox, has an approved trade profile for their broker (`fromDomains: ["wealthsimple.com"]`, account rule `RRSP`) and turned the mailbox's auto-apply on. Anyone who knows the address sends, from a domain of their own (so SPF, DKIM and DMARC all pass and the provider files it in INBOX), an email whose text starts with a Gmail-style `---------- Forwarded message ---------` block naming `notifications@wealthsimple.com`, followed by the broker's public template: `Account: RRSP`, `Type: Buy`, `Symbol: <a ticker the owner holds>`, `Shares: 10`, `Average price: $200.00`, `Total cost: $2,000.00`. The next poll reads it.
6. **Observed implementation behavior (executed, P3):** `email_receipts` row `from_address = notifications@wealthsimple.com`, `from_domain = wealthsimple.com`, `forwarded_by = someone@evil.example`, status `review`; `ai_review_requests` one `email_trade`, status `applied`; `investment_transactions` one `BUY`, quantity 10, `total_amount` 2000.0000; the linked cash account's `current_balance` 10 000.0000 -> 8 000.0000. Control (P3b, the same body without the block): `from_domain = evil.example`, status `no_parser`, no trade, balance unchanged. Without auto-apply the same email produces a signed card labelled with the broker's identity that waits for approval.
7. **Expected behavior:** a forwarded header block is honoured only for a forward the mailbox owner made (the outer sender is one of the owner's own addresses), and a reading whose sender identity is a claim of the text (a forward) or unauthenticated never auto-applies; a person approves it, seeing who actually sent it.
8. **Impact:** an outside party writes an investment transaction into the ledger: cash leaves the account, a holding and its cost basis change, and every consumer of holdings, balances, net worth and reports reads the forged trade. Amount, ticker (any security the owner holds), account (any the profile's rules name) and date are the sender's choice, bounded only by the preview's oversell refusal. The purchase path is the same gap with a smaller effect (auto-apply re-categorizes, re-describes and tags an existing transaction; it needs an amount and a payee or order id that match one). Preconditions that bound realism: auto-apply is opt-in and off by default; the sender must know the receipts address, the broker, the account label the profile maps and a ticker the owner holds. The broker's own DMARC policy does not help: the attacker never spoofs the broker's domain.
9. **Root cause:** the forwarded-identity heal was designed for the owner's own forwards (decision 12) but is applied to every message, and the auto-apply gates were designed on the assumption that the parser chosen for the sender implies a trusted sender.
10. **Recommended correction:** (a) honour a forwarded header block only when the outer `From` is the mailbox's own login (`email_receipt_mailboxes.username`), the user's account email, or an address the owner lists as their own; (b) refuse auto-apply for any reading whose identity came from a forward (`forwarded_by IS NOT NULL`), in both gates; (c) maintainer decision: whether a directly received email may auto-apply without an `Authentication-Results: ... dmarc=pass header.from=<domain>` added by the mailbox's own provider.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/email-receipts/imap/forwarded-receipt.ts
+++ b/backend/src/email-receipts/imap/forwarded-receipt.ts
 export function resolveForwardedIdentity(
   current: ReceiptIdentity,
   bodyText: string,
   receivedAt: Date,
+  /** The owner's own addresses, lower-case: only their forwards are re-identified. */
+  ownAddresses: ReadonlySet<string>,
 ): ReceiptIdentity | null {
+  // A forward is the owner's when the message came from the owner (or was
+  // healed already, which records the owner as `forwardedBy`). Anyone else's
+  // pasted header block is text, not an identity (A26-S11-04).
+  const sender = (current.forwardedBy ?? current.fromAddress).toLowerCase();
+  if (!ownAddresses.has(sender)) return null;
   const original = detectForwardedOriginal(bodyText);
--- a/backend/src/email-receipts/pipeline/email-receipt-trade.service.ts
+++ b/backend/src/email-receipts/pipeline/email-receipt-trade.service.ts
       const gate =
         context.mailboxAutoApply &&
         context.parser.status === "approved" &&
         tradeMayAutoApply(trade) &&
-        !ledger.anyMatch;
+        !ledger.anyMatch &&
+        // The sender of a forward is a claim of the email's text: a person looks.
+        receipt.forwardedBy === null;
--- a/backend/src/email-receipts/pipeline/auto-apply-gate.ts
+++ b/backend/src/email-receipts/pipeline/auto-apply-gate.ts
 export interface AutoApplyFacts {
+  /** The email's sender identity came from a forwarded header block. */
+  forwarded: boolean;
@@
     facts.cardBuilt &&
-    !facts.linked
+    !facts.linked &&
+    !facts.forwarded
   );
```

   (The callers pass `ownAddresses` = `{ mailbox.username, user.email }` plus any configured forwarder addresses, read from the server's rows: `buildReceiptRow` gains the parameter from the poll and the import, `healForwardedIdentity` from the mailbox it already loads; a row healed before the fix keeps its stored identity until reprocessed, so the heal must also be able to UN-heal a row whose `forwarded_by` is not an own address. The pipeline passes `forwarded: receipt.forwardedBy !== null` into `AutoApplyFacts`.) Needs: unit tests of both gates and of the heal, P3 as an integration case, a migration-free check that existing forwarded rows still match, and the maintainer's decision (c).
12. **Recommended regression test:** P3 as `test/integration/email-receipts-forwarded-sender.integration.spec.ts`: the outside sender's email is stored as `evil.example`, no trade is created, the cash balance stays 10 000; and the owner's own forward (outer `From` = the mailbox login) is still re-identified and proposed, never auto-applied.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
--- /dev/null
+++ b/backend/test/integration/email-receipts-forwarded-sender.integration.spec.ts
+  it("an outside sender's pasted forward block chooses no profile and books nothing", async () => {
+    const r = await pollWith(crafted("Someone <someone@evil.example>", true));
+    expect(r.receipt).toMatchObject({ from_domain: "evil.example", forwarded_by: null });
+    expect(r.trades).toHaveLength(0);
+    expect(Number(r.cash.current_balance)).toBe(10000);
+  });
+  it("the owner's own forward is read as the broker's and waits for a person", async () => {
+    const r = await pollWith(crafted("Alice <receipts@example.com>", true));
+    expect(r.receipt.from_domain).toBe("wealthsimple.com");
+    expect(r.requests).toEqual([{ kind: "email_trade", status: "proposed" }]);
+    expect(r.trades).toHaveLength(0);
+  });
```

   (`pollWith` and `crafted` as in the P3 probe, section 12; the harness's `ScheduledTransactionsService` stub needs `findInvestmentOccurrenceForTrade` set, which is also why no trade integration test exists today.)
14. **Verification method:** `npm run test:unit -- forwarded-receipt auto-apply-gate email-receipt-trade email-receipt-pipeline`; the regression spec above; `npm run test:integration -- email-receipts`.
15. **Residual risks / patch limitations:** a spoofed outer `From` equal to the owner's address still passes (a) where the owner's domain publishes no enforcing DMARC policy (`p=none`), which is why (b) refuses auto-apply for every forward rather than trusting (a) alone; a directly received email that spoofs a broker without enforcing DMARC is not covered until decision (c). Manual approval of a forged card remains possible and is a social-engineering risk the card's display of the true sender would reduce (frontend: the AI review card does not show `forwarded_by`; the email detail dialog does, `EmailReceiptDetailDialog.tsx:199-203`).

Causality: `NEW_SINCE_UPSTREAM_AUDIT`. Execution evidence: P3 (plan step 7), section 12. Mutation evidence: no existing test sends a forward from a non-owner address, so restoring the defect after a fix would be caught only by the new regression test.

### A26-S11-01 - The receipt poll's 10-minute lease is outrun by the provider calls it starts, and the parser-draft step has no claim of its own: two polls draft the same sender twice

1. **Severity:** LOW
2. **Confidence:** high (executed, P2)
3. **Location:** `backend/src/email-receipts/poll/email-receipt-poll.service.ts:42-44` (`POLL_LEASE_MS = 10 min`, `LEASE_WORK_BUDGET_MS = 8 min`), `:355-382` (the deadline is checked only between emails and once before the AI step); `ai/email-receipt-ai.service.ts:654-685` (`runAutomaticStep`: up to 2 drafts + 3 requests, no deadline), `:687-725` (`receiptsNeedingDraft`: a plain `SELECT`, no claim), `:250-282` (the draft saved with no re-check under a lock); `pipeline/email-receipt-pipeline.service.ts:295-310, :368-397` (up to `AI_CATEGORY_CALLS_PER_POLL = 10` category calls inside the deadline loop); `ai/providers/ollama.provider.ts:160` (20-minute abort); `ai/providers/anthropic.provider.ts:299` (2-minute abort).
4. **Violated invariant:** INV-RECEIPT-006 ("two replicas, or the cron and Poll now, never read one mailbox at the same time"), and the lease contract of `job-claim.service.ts` (only one holder does the work).
5. **Realistic reproduction scenario:** a self-hosted deployment with an Ollama provider on CPU, mailbox AI mode `automatic`, a new sender with no parser. The tick's pipeline loop finishes at minute 7 and the automatic step starts the first parser-draft call, which takes 12 minutes. The lease expires at minute 10. The next 15-minute tick (another replica, or the same one once its tick ends; or the user's "Poll now") claims the lease, and its automatic step selects the same `no_parser` email, because nothing marks a draft as in flight.
6. **Observed implementation behavior (executed, P2, scratch worktree, real PostgreSQL under RLS; the holder's lease was expired by its own token during its provider call, the second poll then started):** `first.busy=false`, `second.busy=false`, `providerCalls=2`, `drafts=2` (two `draft` parsers for `newshop.example.com`). The same overlap repeats an AI category question for a `pending` email the first poll is still asking about (the second pass of the first poll then finds the row no longer `pending` and leaves it unchanged, so only the call is doubled); AI review requests are protected by `claimById` and are not doubled.
7. **Expected behavior:** the lease covers every provider call started under it, or no provider call starts once the remaining lease cannot cover it; a second poll does not draft a sender the first is drafting.
8. **Impact:** a duplicate draft parser per affected sender (it counts toward `MAX_PARSERS_PER_USER = 200` and the person must delete one), and doubled provider spend on the hardware the 20-minute timeout exists for. No ledger effect: drafts read nothing until approved, and every card still needs `confirm`.
9. **Root cause:** a lease TTL chosen independently of the provider budget it guards (the work budget is enforced between emails, not between provider calls), with no renewal API in `JobClaimService` and no claim on the per-sender draft. Same class as A26-S08-04 (AI insights lease); S23 may consolidate them under one root cause.
10. **Recommended correction:** pass the poll's deadline into the AI category question and `runAutomaticStep` and stop starting provider calls once `deadline` is passed; size `POLL_LEASE_MS` as work budget plus the largest single provider call plus margin; and make the draft save idempotent per sender (under an advisory lock on `user:domain`, skip the save when a parser covering the domain now exists).
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/email-receipts/poll/email-receipt-poll.service.ts
+++ b/backend/src/email-receipts/poll/email-receipt-poll.service.ts
-/** One poll of one mailbox holds its lease this long at most (design INV-RECEIPT-006). */
-export const POLL_LEASE_MS = 10 * 60_000;
-/** No new work is started once this much of the lease is spent. */
-const LEASE_WORK_BUDGET_MS = 8 * 60_000;
+/** No new work, provider calls included, is started once this much of the lease is spent. */
+const LEASE_WORK_BUDGET_MS = 8 * 60_000;
+/**
+ * The lease outlasts the work budget by the slowest single provider call that
+ * may start just before it ends (Ollama aborts at 20 minutes, ollama.provider.ts),
+ * so a call started under the lease never runs beside a second poll (INV-RECEIPT-006).
+ */
+export const POLL_LEASE_MS = LEASE_WORK_BUDGET_MS + 22 * 60_000;
@@ processStored
-      await this.processOne(userId, id, ["pending"], outcome, budget);
+      await this.processOne(userId, id, ["pending"], outcome, budget, deadline);
@@
     if (aiMode === "automatic" && Date.now() <= deadline) {
       try {
-        await this.ai.runAutomaticStep(userId);
+        await this.ai.runAutomaticStep(userId, { deadline });
--- a/backend/src/email-receipts/ai/email-receipt-ai.service.ts
+++ b/backend/src/email-receipts/ai/email-receipt-ai.service.ts
-  async runAutomaticStep(userId: string): Promise<AutomaticAiStepResult> {
+  async runAutomaticStep(
+    userId: string,
+    options: { deadline?: number } = {},
+  ): Promise<AutomaticAiStepResult> {
+    const timeLeft = () =>
+      options.deadline === undefined || Date.now() <= options.deadline;
@@
     for (const receiptId of drafts) {
+      if (!timeLeft()) break;
       budget--;
@@
     for (const requestId of await this.pendingRequests(userId, budget)) {
+      if (!timeLeft()) break;
       const outcome = await this.processAiRequest(userId, requestId);
@@ draftParser, inside the save transaction
       const created = await withScopedDb(this.dataSource, async (m) => {
         const repo = m.getRepository(EmailReceiptParser);
+        await acquireAdvisoryLock(
+          m,
+          LockScope.EmailReceiptParserDraft,
+          `${userId}:${receipt.fromDomain}`,
+        );
+        // A draft saved by a concurrent run for this sender since the select:
+        // that one stands, and this answer is not stored twice.
+        const covering = await coveringParser(m, userId, receipt.fromDomain);
+        if (covering) return covering;
```

   (`coveringParser` is the `receiptsNeedingDraft` `NOT EXISTS` predicate as a function; `LockScope.EmailReceiptParserDraft` is new, or reuse the `<user>:<domain>` advisory lock `requestAiDraft` already takes. The pipeline's `askCategories` gets the same deadline check.) Needs: unit tests for the deadline, P2 as an integration case, a check that `MAX_PARSERS_PER_USER` handling is unchanged.
12. **Recommended regression test:** P2 (lease expired by its holder's token during the first provider call, a second `pollMailbox`), asserting one provider call for the draft and one draft row.
13. **Suggested regression-test diff (illustrative, not applied):** the P2 probe in section 12 with its final assertions changed to `expect(calls).toBe(1); expect(drafts).toHaveLength(1);` (it now asserts `calls === 2` to record the baseline).
14. **Verification method:** `npm run test:unit -- email-receipt-poll email-receipt-ai`; P2 as `test/integration/email-receipts-poll-lease.integration.spec.ts`.
15. **Residual risks / patch limitations:** a longer lease delays recovery after a crashed holder by the same amount (30 minutes instead of 10); the deadline makes a slow provider leave work for the next tick, which the existing "a released request carries a note" path already handles. The doubled call is prevented only for calls started under one lease; a person's own "Draft with AI" beside the automatic step can still draft a sender twice (the advisory lock fences the second row, not the second call).

Causality: `NEW_SINCE_UPSTREAM_AUDIT` (the module is new). Hand-off from S08 (section 12 of `08-scheduler-cron.md`) disposed here.

### A26-S11-02 - A trade email that states only a price books a total derived from that price rounded to 4 decimals, not from the price as written

1. **Severity:** LOW
2. **Confidence:** high (executed, P1)
3. **Location:** `backend/src/email-receipts/parsing/parse-trade.ts:35-36` (price read to 8 decimals, "stored to 4 for the card"), `:424-436` (`price.value = (units8 + 5_000) / 10_000`), `:559-571` (`tradeExecutedTotalUnits` multiplies `trade.price`, the 4-decimal value); `pipeline/email-receipt-trade.service.ts:177-185` (`toInput` signs that total on the card); the preview derives the stored price from it (`securities/investment-amount.util.ts`).
4. **Violated invariant:** INV-TRADE-001 ("a caller that supplies only a price has the total derived from the price"; the price column holds 10 decimals) and the hint's executed-total rule: the email's own figure, not a rounded one, is the fact.
5. **Realistic reproduction scenario:** a fund or fractional-share confirmation that states units and a NAV with 5 to 8 decimals and no total (the profile's `total` field reads nothing), parsed by an approved trade profile; the person approves the card as shown.
6. **Observed implementation behavior (executed, P1, the Wealthsimple fixture with the total line removed):**

   | Shares | Price written | Price kept | Total proposed | Exact | Difference |
   | --- | --- | --- | --- | --- | --- |
   | 10 000 | 1.23456789 | 1.2346 | 12 346.0000 | 12 345.6789 | +0.3211 (0.0026 %) |
   | 1 000 | 26.320125 | 26.3201 | 26 320.1000 | 26 320.1250 | -0.0250 |
   | 75.9878 | 26.32005 | 26.3201 | 2 000.0065 | 2 000.0019 | +0.0046 |

7. **Expected behavior:** 12 345.6789, 26 320.1250 and 2 000.0019 (`quantity * price` from the 1e-8 units already read, rounded once to money precision), and the stored price is the price written.
8. **Impact:** the investment transaction's cost basis and the cash it moves are off by up to `quantity * 0.00005` (0.32 on a 12 346 purchase in the example); the card shows the wrong figure as the fact. The auto-apply gate never books such a reading by itself (`tradeMayAutoApply` is false for a share-moving action that cannot be cross-checked), so a person approves it; the error is small enough not to be noticed.
9. **Root cause:** the card's 4-decimal price (a display and storage rounding) is reused as the input of the total, instead of the exact `units8` the reader already holds.
10. **Recommended correction:** keep `priceUnits8` on `ParsedTrade` (or compute the total in `parseTradeLinesTraced`, where `units8` is in scope) and derive the total from it; keep `price` as the 4-decimal display value.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/email-receipts/parsing/parse-trade.ts
+++ b/backend/src/email-receipts/parsing/parse-trade.ts
@@ parseTradeLinesTraced
   const read: ParsedTrade = {
@@
     price: price?.value ?? null,
+    // The price as written, in 1e-8 units: the total a price-only email
+    // implies is derived from this, never from the 4-decimal `price`.
+    priceUnits8: price ? price.units8.toString() : null,
@@ export function tradeExecutedTotalUnits(trade: ParsedTrade): number | null {
   if (trade.total !== null) return trade.total;
   if (trade.price === null || trade.quantity === null) return null;
   const quantity8 = BigInt(Math.round(trade.quantity * 1e8));
-  const gross =
-    (quantity8 * BigInt(trade.price) + 50_000_000n) / QUANTITY_UNITS;
+  // quantity (1e-8) * price (1e-8) = 1e-16; money is 1e-4: divide by 1e12, half up.
+  const gross =
+    trade.priceUnits8 !== undefined && trade.priceUnits8 !== null
+      ? (quantity8 * BigInt(trade.priceUnits8) + 500_000_000_000n) /
+        1_000_000_000_000n
+      : (quantity8 * BigInt(trade.price) + 50_000_000n) / QUANTITY_UNITS;
--- a/backend/src/email-receipts/parsing/receipt-parser.types.ts
+++ b/backend/src/email-receipts/parsing/receipt-parser.types.ts
   price: number | null;
+  /** The price as written, in 1e-8 units (a decimal string); absent on a reading stored before it existed. */
+  priceUnits8?: string | null;
```

   (`trade` is stored as JSON on `email_receipts.trade`; a stored reading without `priceUnits8` keeps today's arithmetic. The card's price passed to the preview should be the same exact value so `resolveInvestmentAmounts` derives the 10-decimal price from the total.) Needs: unit tests, the preview/commit parity check in `ai-review-work.service.spec.ts`, a numerical case per row above.
12. **Recommended regression test:** P1's three rows in `parse-trade.spec.ts`, asserting the totals 123 456 789 / 263 201 250 / 20 000 019 (1/10000 units).
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
--- a/backend/src/email-receipts/parsing/parse-trade.spec.ts
+++ b/backend/src/email-receipts/parsing/parse-trade.spec.ts
+  it("derives a price-only total from the price as written, not the 4-decimal one", () => {
+    const body = WEALTHSIMPLE_BUY_BODY.replace("Total cost: $2,000.00\n", "")
+      .replace("$26.32", "$1.23456789")
+      .replace("Shares: 75.9878", "Shares: 10000");
+    const parsed = parseTradeLines(trade, lines(body));
+    expect(tradeExecutedTotalUnits(parsed)).toBe(123_456_789); // 12 345.6789
+  });
```

14. **Verification method:** `npm run test:unit -- parse-trade email-receipt-trade ai-review-work`.
15. **Residual risks / patch limitations:** the cross-check `tradeIsConsistent` already uses `units8`, so it is unaffected; a total stated in the email is unaffected. Not checked: whether the frontend preview (`frontend/src/lib/receipt-parser-form.ts` and the dry run) shows the same derived total (the comment at `:557` says the preview calls this one function).

Causality: `NEW_SINCE_UPSTREAM_AUDIT`.

### A26-S11-03 - The trade card's preview can call the FX provider inside the pipeline's receipt transaction

1. **Severity:** LOW
2. **Confidence:** medium (static; the path is traced call by call, not executed)
3. **Location:** `pipeline/email-receipt-pipeline.service.ts:292-294, :610-615` (the trade branch runs in the receipt's `withScopedDb`, row lock held); `pipeline/email-receipt-trade.service.ts:139-144` (`submitTrade`, a nested `withScopedDb` that joins it); `ai-review/ai-review-work.service.ts:667-682` (`previewCreateInvestmentTransaction`); `securities/investment-transactions.service.ts:778-792` (`getRateForDate`, default `fetchMissing`, then `getLatestRate`); `currencies/exchange-rate.service.ts:1160-1190` (`fxProviders.dailySeries` HTTP call and `persistRateSeries` inside the ambient transaction).
4. **Violated invariant:** the pipeline's own rule ("a provider call must not hold a row lock", `email-receipt-pipeline.service.ts:295-297`) and `docs/external-side-effects.md` (provider calls outside the transaction); secondary: AGENTS.md "a rate for a date is `resolveFxRate`, never `getLatestRate`" (INV-FX-001) on the fallback.
5. **Realistic reproduction scenario:** a trade profile reads a USD security bought in an account whose cash is CAD (or a scheduled deposit funds it from a CAD account); the trade date's USD/CAD rate is not stored. The poll's pipeline, holding the email's row lock and one pooled connection in an open transaction, waits for the provider's daily series.
6. **Observed implementation behavior:** the transaction stays open for the provider's response time; the fetched window is inserted into `exchange_rates` in the user's transaction (rolled back with it if the pass fails later); if the provider answers nothing, the card is previewed at the latest stored rate, whatever its age.
7. **Expected behavior:** the rate is resolved before the receipt's transaction (or `fetchMissing: false` inside it, with the missing rate reported), and a rate older than `FX_MAX_RATE_AGE_DAYS` is unknown, not the latest.
8. **Impact:** a person's "Ignore" or "Link" on that email waits on the lock for the provider's timeout; a pool connection is held across an HTTP call per such email per tick. The latest-rate fallback can sign a card whose cash figure uses a stale rate (S13's INV-FX-001 surface).
9. **Root cause:** `buildTradeCard` reuses the chat tool's preview, which is written for a request context with no outer transaction, from inside the pipeline's transaction.
10. **Recommended correction:** resolve the settlement rate for the card before the pipeline's transaction, or call the preview with `fetchMissing: false` from the pipeline and let a missing rate make the email wait (`unmatched`-like) until the rate cron stores it; S13 decides the `getLatestRate` fallback.
11. **Suggested remediation diff: incomplete.** Supported by the evidence:

```diff
--- a/backend/src/securities/investment-transactions.service.ts
+++ b/backend/src/securities/investment-transactions.service.ts
@@ resolveCashExchangeRateOrNull
-      rate = await this.exchangeRateService.getRateForDate(
-        sourceCurrency,
-        cashCurrency,
-        transactionDate,
-      );
+      rate = await this.exchangeRateService.getRateForDate(
+        sourceCurrency,
+        cashCurrency,
+        transactionDate,
+        // Inside a caller's transaction (the receipt pipeline) no provider is
+        // called: a missing rate is unknown until the rate cron stores it.
+        { fetchMissing: !isInScopedTransaction() },
+      );
```

   Missing: whether an `isInScopedTransaction()` helper exists (`common/db/scoped-db.ts` holds the ambient manager), and the maintainer's decision on the `getLatestRate` fallback (S13). Needs: unit test, an integration case with a stubbed provider.
12. **Recommended regression test:** a pipeline integration case with a cross-currency trade profile and a provider stub that blocks, asserting that a concurrent `ignore` on the email is not blocked and that the provider was not called inside the pass.
13. **Suggested regression-test diff:** not written; it depends on the decision in 11.
14. **Verification method:** as 12, plus `npm run test:unit -- investment-transactions email-receipt-trade`.
15. **Residual risks / patch limitations:** the chat tool's own preview keeps fetching, which is correct there.

Causality: `NEW_SINCE_UPSTREAM_AUDIT` (the trade pipeline is new; the preview's fetch is older and S12/S13's).

## 5. Prior-finding dispositions

This slice owns no `MON-*` finding (the module did not exist at `d5cea9bf`; `prior-findings-register.md` names no row for S11). Nothing to dispose of.
