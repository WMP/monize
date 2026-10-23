# S11 Email receipts and document scanner

Status: done.

## 1. Metadata

| Field | Value |
| --- | --- |
| Session | S11 (parallel wave, child session_01NGWhzqqpfZRRd58ooquSgs) |
| `AUDIT_BASELINE_SHA` | `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86` |
| Pin check | `git diff --stat 72c59ec4 HEAD -- . ':!docs/audits/2026-10' ':!docs/audits/2026-08-upstream'` empty |
| Date | 2026-10-21 |
| Primary path | `backend/src/email-receipts/` |
| Hint line | `prioritize mailbox credentials and OAuth tokens (encrypted, scoped, never returned), email content as untrusted input to the AI parser and to HTML rendering (prompt injection, escapeHtml), parsed amounts and currencies as server-authoritative versus parser-supplied, at-most-once receipt-to-transaction and receipt-to-trade creation under poll retries, the executed-total-is-the-fact rule for parsed trades, partial pipeline failure and compensation, and provider call multiplicity` |
| Runtime | unit 102 suites / 2 985 passed; integration 8 suites / 223 passed; probes P1-P3 and mutations M1, M3, M4, M6-M8 in a scratch worktree (section 12) |

## 2. Invariant map

| ID | Statement | Mechanism named | Holds at baseline? |
| --- | --- | --- | --- |
| INV-RECEIPT-001 | The mailbox is read, never written | `imap-mailbox-client.ts` sole `imapflow` importer; `mailboxOpen(..., { readOnly: true })` (EXAMINE) at `:237, :256`; `fetchOne(..., { source: true })` = `BODY.PEEK[]` (`:278`); `imap-source-scan.spec.ts` | Yes (static; no real-IMAP test, as the index says) |
| INV-RECEIPT-002 | One row per (mailbox, UIDVALIDITY, UID); the cursor never passes an unstored message | `uq_email_receipts_message UNIQUE (mailbox_id, uid_validity, uid)` + `ON CONFLICT DO NOTHING` (`poll/receipt-rows.ts:142-149`); cursor moved by `advanceCursor` (`GREATEST` on one UIDVALIDITY) inside the insert's `withScopedDb` (`email-receipt-poll.service.ts:411-424`) | Yes. One edge: a UID that vanishes between `SEARCH` and `FETCH` is passed by the cursor without a row (`imap-mailbox-client.ts:272, :283`); the message is gone, so nothing is lost (section 8) |
| INV-RECEIPT-003 | A receipt changes the ledger only through the signed card and `confirm`; the card never moves money | `AiReviewWorkService.submit` (exact split sum, owned categories, no transfer), `markApplied` (`ai-review-requests.service.ts:853-879`) in the write's transaction; auto-apply = `confirm` with the built card after the pipeline commit (`email-receipt-pipeline.service.ts:312-315, :1318-1335`), gated by `autoApplyAllowed` | Through the card, yes; but the auto-apply gate trusts a sender identity the email's text can set (A26-S11-04) |
| INV-RECEIPT-004 | A non-admin mailbox reaches only a public address | `assertMailboxHostAllowed` on save, `assertMailboxHostLiteralAllowed` + `mailboxEgressLookup` at connect (`imap-mailbox-client.ts:146, :367`); OAuth host from the closed table (`email-receipt-mailbox.service.ts:505-530`); admin read from the user's own row per poll (`:670-678`) | Yes |
| INV-RECEIPT-005 | Password / refresh token encrypted, never returned, logged or stored in `last_error` | `EncryptionService.encrypt` before the write (`mailbox.service.ts:133, oauth.service.ts:157`); `select: false` + `readStored` the only `addSelect` (`:654-664`); `toMailboxView` copies field by field with booleans; `describeMailboxFailure(error, secrets)`; access token only in memory (`oauth-access-token.service.ts`) | Yes |
| INV-RECEIPT-006 | One poll per mailbox at a time across replicas | `claimLease(EmailReceiptPoll, userId, mailboxId, POLL_LEASE_MS = 10 min)` around `pollLeased` and `processStoredNow` (`poll.service.ts:212-227, :240-262`), released by token; a work budget of 8 min checked only between emails and before the AI step (`:358, :363, :374`) | Within the lease only: the lease is outrun by provider calls that start before minute 8 (A26-S11-01) |
| INV-RECEIPT-007 | An OAuth callback completes only the caller's flow, once, in 10 min | `oauth-state.ts`: AES-GCM envelope (user, provider, PKCE verifier, nonce, exp), `state.userId !== userId` refused before `SingleUseTokenService.claim(OAUTH_STATE_PURPOSE, nonce)` (`email-receipt-oauth.service.ts:249-265`) | Yes. The flow mints no JWT: the A26-S03-03 deny-list pattern does not apply (section 8) |
| INV-RECEIPT-008 | A trade email creates an investment transaction only through its signed card; never twice | `uq_ai_review_requests_trade_open` + `enqueueTrade ON CONFLICT` (`ai-review-requests.service.ts:335-363`); `markTradeApplied` (bound to `proposed`, unexpired) + `findTradeInLedger` under the holdings lock in `beforeWrite`, `recordTradeBooking` in `afterWrite` (`ai/actions/ai-actions.service.ts:1098-1190`); `onlyWhenStatusIn` + `email_trade` early return keeps automatic passes off a trade proposal (`pipeline.service.ts:462-468`) | Only through the card, yes; but auto-apply books a trade for any sender that pastes a forwarded header block naming the broker (A26-S11-04, executed P3). The link half (`email-receipt-trade-link.service.ts:150-308`) has no lock or unique index on the linked row (DR-S11-2) |
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

## 6. Mutation table

Run in a scratch worktree at `AUDIT_BASELINE_SHA` (`<scratchpad>/mut`), one mutation at a time, reverted with `git checkout` after each; baseline in the worktree: unit `src/email-receipts src/ai-review` 2 988 passed (2 985 + the 3 probe cases of P1), integration 140 passed for the four suites named.

| Invariant | Mutation (file:line, what) | Test that fails | Verdict |
| --- | --- | --- | --- |
| One open rule-less request per transaction (INV-RECEIPT-003 queue exclusion) | M1 `ai-review/ai-review-requests.service.ts:301` `WHERE NOT EXISTS (` -> `WHERE TRUE OR NOT EXISTS (` | unit 1 failed; integration (`email-receipts-pipeline`, `-linked`, `-profile`, `ai-review-requests`) 4 failed | covered |
| A poll never undoes a person's command (`onlyWhenStatusIn`) | M3 `pipeline/email-receipt-pipeline.service.ts:412` guard -> `false &&` | unit 1 failed; integration 140/140 green | covered (unit only; no integration case of a person's command landing between the poll's select and its lock) |
| An automatic pass never replaces a trade proposal (INV-RECEIPT-008) | M4 `pipeline/email-receipt-pipeline.service.ts:463` guard -> `false &&` | unit 4 failed; integration green (no trade integration test exists) | covered (unit only) |
| A trade the ledger may hold is never auto-applied | M6 `pipeline/email-receipt-trade.service.ts:149` `!ledger.anyMatch` -> `true` | unit 1 failed | covered (unit only) |
| A schema.org reading never auto-applies | M7 `pipeline/auto-apply-gate.ts:45` condition -> `true` | unit 1 failed | covered (unit only) |
| The cursor never rewinds on one UIDVALIDITY (INV-RECEIPT-002) | M8 `mailbox/email-receipt-mailbox.service.ts:575` `GREATEST(last_uid, $4)` -> `$4` | unit 1 failed (`src/email-receipts`) | covered (by a SQL-text assertion; the integration suite was not run under M8) |
| The lease excludes a second poll while work it started runs (INV-RECEIPT-006) | conceptual: the baseline itself (P2) | none: P2 is a new probe; no suite exercises overrun | undetected (baseline defect, A26-S11-01) |
| A price-only trade total is the price as written times the shares (INV-TRADE-001) | conceptual: the baseline itself (P1) | none | undetected (baseline defect, A26-S11-02) |
| A forwarded identity is honoured only for the owner's forward; auto-apply needs a trusted sender | conceptual: the baseline itself (P3) | none: every forward fixture is the owner's | undetected (baseline defect, A26-S11-04) |
| No provider call inside the receipt's transaction | conceptual: the baseline itself | none | undetected (A26-S11-03, not executed) |

## 7. Counterexamples and the interaction scenario

Counterexamples (none copied from the existing tests):

- INV-RECEIPT-006: a provider call started at minute 7.9 of a 10-minute lease (P2: two polls, two provider calls, two drafts).
- INV-TRADE-001: a price written with 8 decimals and no total (P1: 10 000 x 1.23456789 books 12 346.00, not 12 345.68).
- INV-RECEIPT-008 / decision 12: a message whose identity is the text's claim, not the sender's (P3: `someone@evil.example` books a trade as `wealthsimple.com`).
- INV-RECEIPT-002: the same message polled and then imported from an archive gets two rows (`uid_validity` 1001 and 0); the second matches nothing because the first's applied transaction is no candidate (`receipt-candidates.ts:33-54`), so nothing is booked twice (section 8).
- INV-RECEIPT-005: a test connection with a changed port on the stored host keeps the stored password; refused as a cleartext risk because TLS is mandatory (section 8).
- INV-RECEIPT-007: a state sealed for user A posted by user B is refused before the nonce is spent (`email-receipt-oauth.service.ts:257`), so B cannot burn A's flow.

Interaction scenario (two correct mechanisms combined): the forwarded-identity heal (correct for the owner's forwards) x the trade auto-apply gate (correct for an approved profile's consistent reading) = an outside sender selects the owner's approved profile and the gate books its trade (A26-S11-04, executed). A second interaction: the lease (correct within its TTL) x the AI step's provider timeout (correct per call) = duplicate drafts (A26-S11-01, executed). A third, analysed and benign: two passes on one `review` email under overrun x `markApplied`'s CAS = at most one card applied, the loser's 409 leaves its proposal (section 8).

## 8. Rejected hypotheses

| Candidate | Evidence considered | Why rejected or downgraded | Final classification |
| --- | --- | --- | --- |
| S05 hand-off: rule deletion pushes a receipt into `review_conflict` | `ai_review_requests.rule_id REFERENCES transaction_rules ON DELETE SET NULL` (`schema.sql:914`); `insertReceiptRequest`'s `NOT EXISTS` counts any open, unexpired request with `rule_id IS NULL` on the transaction, whatever its kind (`ai-review-requests.service.ts:301-308`); the only producer of a rule-less `transaction_review` is that `SET NULL` (the rules applier is the sole `enqueue` caller) | Reachable: a rule's open review on transaction T, the rule deleted, an email then matching T becomes `review_conflict` ("Another request is open"). But the orphaned request is a real open review of T, visible in the inbox, the label is accurate, the person dismisses it and reprocesses, and it expires in 30 days; nothing is written wrongly. Not executed beyond the code and schema read | DESIGN_RISK (DR-S11-1) |
| Two-pass AI category question doubles the call under the poll's own loop | `pipeline.process` asks between two transactions; the second pass re-locks and re-checks `onlyWhenStatusIn` | Within one lease, one poll asks once per email; doubling only under the lease overrun of A26-S11-01, where it is counted | Folded into A26-S11-01 |
| Concurrent passes replace an auto-applied proposal | Two passes on a `review` email from the rematch list; the second closes the first's `proposed` request | `markApplied` is bound to `proposed`: whichever commits first wins, the loser's confirm is a 409 that leaves its proposal in the inbox; a second application re-writes the same splits; reachable only under lease overrun | REJECTED (benign) |
| `ignore` racing an auto-apply leaves an applied email `ignored` | `ignore` reads `receiptApplied` before `closeReceiptRequests` and does not re-read (the trade link does, `email-receipt-trade-link.service.ts:252-273`) | The applied transaction is then no purchase candidate (`receipt-candidates.ts:33-54` excludes it), and a trade email keeps `investment_transaction_id`, so a later reprocess proposes nothing twice; only the label is wrong | REJECTED (cosmetic; noted in section 9 as the asymmetry) |
| Mailbox security downgrade by a stolen session (port/security change keeps the stored password) | `upsert` needs the password again only when host or user name changes (`mailbox.service.ts:169-173`) | `security` is `tls` or `starttls` only and `doSTARTTLS: true`, `rejectUnauthorized: true`, TLS 1.2 minimum (`imap-mailbox-client.ts:154-169`): there is no cleartext mode; a port change on the same host reaches the same operator | REJECTED |
| ReDoS through a parser pattern written by a prompt-injected AI draft | Drafts come from email text through the AI | Patterns are globs matched linearly; no `RegExp` is built from a profile (`receipt-glob.ts:20-25`); drafts read nothing until approved | REJECTED |
| XSS through the email's HTML | `readDetail` returns `body_html` | `EmailHtmlFrame` renders it only in `<iframe sandbox="" srcDoc>` behind a CSP meta; a source test forbids `dangerouslySetInnerHTML` in the tree | REJECTED |
| OAuth flow tokens accepted by another verifier (A26-S03-03 pattern) | The flow's state and tokens | The state is an AES-GCM `EncryptionService` envelope, not a JWT; the id_token is read only for the login name, from the token endpoint's own TLS response; no token of this flow is signed with `JWT_SECRET` | REJECTED (pattern not present) |
| Whole-entity save after an SQL write (D-S03-01 pattern) | Every `repo.save` in the slice | `save` is used only for inserts (mailbox create, draft parser create, parser create); every update is a column-scoped `repo.update` or SQL after a row lock | REJECTED (pattern not present) |
| Refresh-token rotation race loses the rotated token | Two `obtain` calls on one stored token | Both writes are CAS on the ciphertext read; the only loss is when a provider revokes the old token on reuse and the delete wins the race, which disconnects the mailbox (the user reconnects); Google does not rotate, Microsoft keeps the old token valid | DESIGN_RISK (narrow; not separately listed) |
| Purchase receipts are currency-blind | `ParsedReceipt` has no currency; matching compares numbers | The card is splits checked to the exact transaction amount; no amount, account or date changes, so a cross-currency coincidence can only mislabel categories, and auto-apply also needs an order id, a reference or the payee | REJECTED |
| Two different messages with one Message-ID collapse on import | `deriveImportedUid` keys on the Message-ID | A Message-ID is the sender's identity of one message; the user's own archive; the second copy is reported in `duplicates` | REJECTED |
| A vanished UID is passed by the cursor without a row | `fetchSince` skips a UID with no size or no source and reports `highestUid` of the batch | The message is gone from the folder (deleted between SEARCH and FETCH); nothing readable is lost | REJECTED |
| Daily write-limit exemption claimed by a non-profile writer | `isExemptFromWriteLimit` reads `claimed_by = EMAIL_RECEIPTS_CLAIM_KEY` and the stored switch | Server rows only; whether an MCP agent can ever claim under that literal key is S17's (handed on) | REJECTED here, hand-off |

## 9. Design risks

- **DR-S11-1** (S05 hand-off): a deleted rule's open review becomes a rule-less open request that blocks the receipt's own request on that transaction (section 8). A `kind` filter (`AND open_request.kind = 'email_receipt'`) in the `NOT EXISTS` would decouple them, but would also let a receipt request sit beside an orphaned review; the maintainer decides.
- **DR-S11-2**: the trade link (`email-receipt-trade-link.service.ts:150-308`) records `investment_transaction_id` after a `claimedElsewhere` read with no lock on the linked row and no unique index (`idx_email_receipts_investment_transaction` is non-unique), so two different emails linked to one row at the same moment both account for it. Needs two simultaneous person actions on two copies of one confirmation; the visible effect is that a third identical email is proposed as a second fill (never auto-applied).
- **DR-S11-3**: a component's re-join of waiting settlements (`pipeline.service.ts:318-320`) runs after the component's commit with no durable marker; a crash between them leaves an applied settlement unenriched by the component until a person reprocesses it (an applied settlement is not in the rematch selection).
- **DR-S11-4**: `ignore` and `remove` decide "applied" before closing the requests and do not re-read, unlike the trade link (section 8); harmless today because of the candidate exclusion, but the two paths encode the same race differently.

## 10. Missing tests and known-wrong tests

- No test enters the lease-overrun path: `email-receipt-poll.service.spec.ts` mocks `JobClaimService`; P2 (section 12) is the missing integration case (A26-S11-01).
- No price-only trade test with a price above 4 decimals (A26-S11-02); `parse-trade.spec.ts:139-170` covers 3 and 4 decimals and the cross-check only.
- No integration test for a trade email end to end (INV-RECEIPT-008 says so itself); P3 is the first run of the trade path against PostgreSQL, through the real poll, pipeline, card and confirm.
- No test of a forwarded header block in an email from an address that is not the mailbox owner's (the forward fixtures all come from the owner, `forwarded-receipt.spec.ts`), which is why A26-S11-04 is undetected.
- No test that a trade card's preview makes no provider call inside the pipeline's transaction (A26-S11-03).
- INV-RECEIPT-006 "Present: rls-context-smoke.spec.ts (real lease)": that spec claims and releases; it does not show that a second poll is refused while the first runs, and nothing tests the lease against the work it guards.
- The mutation rows marked `undetected` in section 6 are test-coverage findings.
- Known-wrong tests: none found in the slice.

## 11. Documentation inconsistencies

- `docs/cron-jobs.md` row `email-receipt-poll.service`: "take a bounded AI step (at most 5 provider calls, 2 of them parser drafts, per user per tick)". The poll also asks up to `AI_CATEGORY_CALLS_PER_POLL = 10` category questions per tick in the pipeline loop for any mailbox whose AI mode is not `off` (`poll.service.ts:54, :355`; `pipeline.service.ts:368-397`), so the bound is 15 per tick (and 10 in mode `on_demand`). `docs/specs/email-receipt-matching.md:292` ("The poll's automatic step never calls the AI for categories") is literally true of `runAutomaticStep` and misleading about the poll. `email-receipt-ai.service.ts:139-143` ("AI mode governs only what happens by itself: the poll's automatic step calls AiService for automatic mailboxes alone") is contradicted by the same category calls.
- `docs/system-invariants.md` INV-RECEIPT-006: "the poll starts no new work after 8" minutes; provider calls already started run on, and the AI step's calls are not checked against the budget at all (A26-S11-01).
- `docs/future-plans/email-receipts.md` decision 12 and `receipt-rows.ts:85-87` describe a forward "from the user's own address"; the code honours a forwarded header block from any sender, and decision 12's safety argument ("it never reaches the ledger except through the same card and approval") does not hold under auto-apply (A26-S11-04).
- INV-RECEIPT-008 lists `Present` tests that are all unit specs and states the integration gap honestly; after P3 the gap is narrower than "absent" only in this audit's scratch worktree.

## 12. Review ledger

- **`PR_REVIEW_SHA`:** `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86` (path target; the audit branch head differs only under `docs/audits/`, pin check empty).
- **Directories inspected:** `backend/src/email-receipts/{poll,pipeline,receipts,import,mailbox,oauth,imap,ai,parsing,parsers,matching,proposal,linking,entities}`, `backend/src/ai-review/` (the receipt and trade halves), `backend/src/ai/actions/ai-actions.service.ts` (trade confirm), `frontend/src/components/email-receipts/` (HTML frame, body view, detail dialog), `frontend/src/lib/receipt-parser-form.ts`, `frontend/src/lib/document-scanner/`.
- **Files in full:** `poll/email-receipt-poll.service.ts`, `poll/receipt-rows.ts`, `poll/email-receipt-poll-limits.ts`, `pipeline/email-receipt-pipeline.service.ts`, `pipeline/email-receipt-trade.service.ts`, `pipeline/receipt-requests.util.ts`, `pipeline/auto-apply-gate.ts`, `pipeline/trade-reading.ts`, `ai/email-receipt-ai.service.ts`, `mailbox/email-receipt-mailbox.service.ts`, `oauth/email-receipt-oauth.service.ts`, `oauth/oauth-state.ts`, `oauth/oauth-access-token.service.ts` (from `:30`), `oauth/id-token-email.ts`, `import/email-receipt-import.service.ts`, `imap/forwarded-receipt.ts`, `receipts/email-receipt-trade-link.service.ts` (from `:60`), `receipts/receipt-disposal.ts`, `pipeline/linkable-transaction.ts` (to the VOID check), `frontend/.../EmailHtmlFrame.tsx`, `EmailBodyView.tsx`.
- **Files sampled (ranges):** `imap/imap-mailbox-client.ts:140-394`; `receipts/email-receipts.service.ts:580-1000`; `parsing/parse-trade.ts:20-100, 400-594`; `parsing/receipt-glob.ts:1-60`; `import/zip-archive.ts` (constants and budget, by grep); `ai/email-receipt-category-ai.service.ts:20-100`; `parsers/email-receipt-parsers.service.ts`, `email-receipt-parser-generate.service.ts`, `email-receipt-parser-tools.service.ts` (status handling, by grep); `receipts/email-receipt-profile-batch.service.ts` (by grep); `poll/email-receipts-attention-alert.service.ts` (dedupe, by grep); `pipeline/receipt-candidates.ts`, `matching/match-receipt.ts` (filters and arithmetic, by grep); `mailbox/dto/upsert-email-receipt-mailbox.dto.ts` (by grep); the four controllers (guards, pipes, throttles, by grep); `ai-review/ai-review-requests.service.ts:180-380, 845-975`; `ai-review/ai-review-work.service.ts:575-825`; `ai/actions/ai-actions.service.ts:1090-1192`; `securities/investment-transactions.service.ts:606-620, 726-800` and the preview by grep; `currencies/exchange-rate.service.ts:379-420, 1150-1215`; `frontend/src/lib/receipt-parser-form.ts:636-705`; `docs/future-plans/email-receipts.md:160-200`; `docs/specs/email-receipt-matching.md:60-72, 283-300`. Not read: `parsing/receipt-parser.validation.ts` (1 433 lines), `imap/forwarded-message.ts` beyond its contract, `imap/html-lines.util.ts`, `imap/mail-text.util.ts`, `import/msg-message.ts`, `import/mbox.ts`, `parsing/parse-receipt.ts`, `parsing/schema-org-order.ts`, `proposal/build-receipt-proposal.ts` beyond its kinds, `linking/*` beyond the pipeline's calls, `parsers/receipt-dry-run.ts`, `parsers/email-receipt-parser-preview.service.ts`, the frontend wizard and inbox components.
- **Searches performed:** `new RegExp|re2|safe-regex` under the module; `dkim|spf|dmarc|authentication-results|spoof` under the module and the design doc; `forward` in the design doc and specs; `bodyHtml|body_html|dangerouslySetInnerHTML` in the frontend; `profileProposalsCountTowardAiLimit|count_toward`; `ruleId: null` and `.enqueue(` across `src`; `investment_transaction_id` in `schema.sql`, `ai/actions`, `ai-review`; `timeout|AbortSignal` in `ai/providers`; `claimLease|renew` in `job-claim.service.ts`; `MAX_PARSERS_PER_USER`, `EMAIL_RECEIPTS_BATCH_AI_CATEGORY_CALLS`, `runAutomaticStep` callers.
- **Suites run (baseline, Node 24.22.1, PostgreSQL 16 in Docker `monize-pg`):** unit `npm run test:unit -- src/email-receipts src/ai-review`: 102 suites, 2 985 tests passed. Integration `npm run test:integration -- "email-receipt|ai-review-requests|ai-review-mcp|holding-concurrent-trades|rls-context-smoke"`: 8 suites, 223 tests passed (`ai-review-mcp`, `ai-review-requests`, `email-receipt-mailbox`, `email-receipts-linked`, `email-receipts-pipeline`, `email-receipts-profile`, `email-receipts-schema`, `holding-concurrent-trades`; `rls-context-smoke` is a unit spec and matched nothing here).
- **Probes (scratch worktree, never on the branch):** P1 `src/email-receipts/parsing/audit-s11-price-only.spec.ts` (3 cases, A26-S11-02); P2 `test/integration/audit-s11-lease-overrun.integration.spec.ts` (`providerCalls=2 drafts=2`, A26-S11-01); P3 `test/integration/audit-s11-forwarded-sender.integration.spec.ts` (P3a trade booked, cash 10 000 -> 8 000; P3b control, nothing; A26-S11-04). P3 needed `findInvestmentOccurrenceForTrade` set on the harness's `{}` stub of `ScheduledTransactionsService` (`test/helpers/integration-setup.ts:192-211`), which is why no trade integration test exists.
- **Mutations:** M1, M3, M4, M6, M7, M8 (section 6).
- **CI / hosted status:** not checked (path audit of a pinned baseline; no PR).
- **Reviewed without a finding:** INV-RECEIPT-001 read-only IMAP; INV-RECEIPT-002 ingest transaction and cursor; INV-RECEIPT-004 host policy at save and connect; INV-RECEIPT-005 secrets (ciphertext only, `select: false`, view booleans, redaction, OAuth token CAS); INV-RECEIPT-007 OAuth state; the email HTML frame; parser patterns without `RegExp`; archive decompression bounds; the AI's answers (validated, owned categories, never confirmed by the AI path); the write-limit exemption; the trade confirm's `beforeWrite` / `afterWrite` under the holdings lock; the mailbox settings round trip; the parser form's refusal to edit what it cannot represent; the document scanner (client-only, engine self-hosted at `/vendor/opencv/opencv.js`; attachments are S06's).
- **Finding counts:** BLOCKER 0, HIGH 1 (A26-S11-04), MEDIUM 0, LOW 3 (A26-S11-01, -02, -03). Design risks DR-S11-1..4.
- **Text for the ledger (orchestrator merges):**
  - Session status: S11 done; commit: the commit carrying this file; findings B/H/M/L 0/1/0/3; verdict REQUEST CHANGES.
  - Prior findings disposed: none owned (module new since the upstream audit).
  - Suites: unit 102 suites / 2 985 passed; integration 8 suites / 223 passed; probes P1-P3; mutations M1, M3, M4, M6, M7, M8 (all covered, four by unit tests only).
  - Hand-offs disposed: from S08 (poll lease and the 5-vs-15 provider budget): A26-S11-01 and section 11; from S05 (rule deletion and `review_conflict`): DR-S11-1; from S03 (A26-S03-03 and D-S03-01 patterns): not present in the slice (section 8).
  - Open hypotheses handed on:
    - from S11 to S13: `resolveCashExchangeRateOrNull` falls back to `getLatestRate` (`investment-transactions.service.ts:788-792`), reachable from the trade card (INV-FX-001), and `getRateForDate` writes fetched rates in the caller's transaction (A26-S11-03).
    - from S11 to S17: whether an MCP agent or the assistant can ever claim a request under the literal `EMAIL_RECEIPTS_CLAIM_KEY` (the write-limit exemption and the trade auto-apply rest on that key being the profile's alone); the AI review inbox card does not show `forwarded_by` (A26-S11-04 residual).
    - from S11 to S21: the integration harness stubs `ScheduledTransactionsService` with `{}`, so no integration test can run a trade card; P1-P3 belong in the suite; A26-S11-01's missing overrun test joins A26-S08-05; M3, M4, M6, M7 are held by unit tests only.
    - from S11 to S23: A26-S11-01 and A26-S08-04 share one root cause (lease TTL independent of the provider budget); consolidate under Rule 7 if the program wants one finding.
  - Undetected mutation rows for the program table: `INV-RECEIPT-006 | baseline (P2) | a lease-overrun integration test | S11`; `INV-TRADE-001 | baseline (P1) parse-trade.ts:559-571 | a price-only >4-decimal case | S11`; `INV-RECEIPT-008 | baseline (P3) forwarded-receipt.ts:33-71 | a non-owner forward test | S11`.
  - Deviations: the local branch ref went stale after a rebased pull (HEAD detached); reattached with `git branch -f` to the rebased HEAD (fast-forward of origin) before the first push. PostgreSQL started with `docker run` (`monize-pg`), integration database `monize_test` created by hand. The required "mutation on the dedup key of receipt-to-transaction creation" is M1 (the request-queue exclusion); the email-row dedup key itself (`uq_email_receipts_message`) was not mutated, since dropping `ON CONFLICT` turns a duplicate into an error rather than a second row.

## 13. Adversarial approval challenge

Started from the slice's own abstractions, assuming the verdict wrong, not from the findings:

- **"Which approved profile reads this email" is decided by `from_domain`.** Who produces `from_domain`? `extractMailText` (the From header, sender-controlled) and `resolveForwardedIdentity` (the text, sender-controlled). Neither is authenticated; the second is not even bounded to the owner. This search produced A26-S11-04, the slice's one HIGH; the first variant (a directly spoofed From) depends on the broker's DMARC and the owner's provider, and is decision (c) of that finding.
- **The auto-apply gates.** Every condition was traced to its producer: mailbox switch (owner), profile status (owner), reading completeness and consistency (sender text), ledger match (server), match kind (server over sender values). Only the sender's identity was missing from the gates.
- **The lease.** What does the lease guard, and what is the longest thing it guards? The provider calls; their bound (20 minutes) exceeds the TTL (A26-S11-01).
- **Executed total.** Which number is the fact when the email states no total? The reader's rounded price, not the written one (A26-S11-02).
- **"A provider call must not hold a row lock."** Every await inside `processInTransaction` was checked for a network call: the AI is outside; the trade card's preview is not (A26-S11-03).
- **Representation:** `currency` null vs named vs security-derived (refusal holds), `categoryHints` undefined vs null vs array (holds), `password` absent vs blank (holds), `lastUid` null (holds).
- **Stale clients and legacy rows:** a row stored before the forward heal heals on reprocess, and would keep an outside sender's identity after a fix unless the heal can un-heal (noted in A26-S11-04's diff).
- **Consumers of `investment_transaction_id`:** `findTradeInLedger`, the trade link, `refuseUnprocessable`, the candidates list; each reads it as "accounted for"; the non-unique index is DR-S11-2.
- **Failure multiplicity:** a failed draft is not retried (`draft_failed`); a failed AI request is released with a note and not retaken by the poll; a failed OAuth refresh with `invalid_grant` deletes the token and the poll skips the mailbox; a failed provider FX lookup inside the trade card falls back to the latest rate (handed to S13).

What it found: A26-S11-04 (HIGH, executed). Nothing else above LOW.

## 14. Verdict

**REQUEST CHANGES** for `backend/src/email-receipts/` at `72c59ec4`: one HIGH (A26-S11-04, executed: an outside sender books an investment transaction through auto-apply) survived the approval challenge; three LOW (A26-S11-01 executed, A26-S11-02 executed, A26-S11-03 static). The adversarial close-out pass was completed. Limitations: the files listed as not read in section 12; no real IMAP server; no hosted CI.
