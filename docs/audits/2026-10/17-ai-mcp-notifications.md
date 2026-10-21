# S17 AI assistant, MCP tools, notifications, push

## 1. Metadata

| Field | Value |
| --- | --- |
| Session | S17 (child session_01111K7XW3AyLWdho7J2V8cV), parallel wave with S14 and S16 |
| `AUDIT_BASELINE_SHA` | `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86` |
| `git rev-parse HEAD` at start | `4e796dd7f8f01da49f36276ead7104a03e98f649` (pin check: `git diff --stat` against the baseline outside `docs/audits/` is empty) |
| Date | 2026-10-21 |
| Primary path | `backend/src/mcp/` |
| Hint line | `prioritize every AI tool implemented once on a domain service and adapted by both the executor and the MCP layer (a tool in one layer only is a finding), the compact LLM shape carrying every completeness flag, MCP scopes bound to the current token not the session, every write tool reaching the same refusals as the HTTP path (VOID, currency, ownership), prompt content as untrusted input, insight generation across replicas, push subscription lifecycle and the chart artifact TTL, and dispatch at-most-once` |
| Status | in-progress, remaining: integration suite results, sections 12-14 final text |

Runtime executed: Node 24.22.1 (`/opt/nvm`), backend `npm ci` OK, PostgreSQL 16 (`mirror.gcr.io/library/postgres:16-alpine`) in Docker (`dockerd` started by hand). Results:

- Unit, `TZ=UTC npm run test:unit -- src/mcp src/ai src/ai-review src/notifications src/notification-center src/push src/system-alerts src/provider-health`: **157 suites, 4200 tests, all pass**.
- Integration: see section 12 (suites listed there with results).
- Probes in a scratch worktree at the baseline (`git worktree add <scratchpad>/mut 72c59ec4`), never on the audit branch: P1 (MCP caller key on a 2026-07-28 request with a forged `Mcp-Session-Id`), P2 (AI confirm after a post-commit attachment failure), P3 (LLM analytics over two currencies, real PostgreSQL). Mutations M1-M4 (section 6).

## 2. Invariant map

| ID | Statement | Mechanism named | Holds at the baseline? |
| --- | --- | --- | --- |
| INV-MCP-001 | An MCP request is served as the credential presented on that request, with its current scopes | `McpHttpController.authorize` -> `validatePat` per request -> `toAuthInfo` on `req.auth`; the node transport forwards `req.auth` as the handler's `authInfo` on every request (`@modelcontextprotocol/node` `index.cjs:238`); `resolveUserContext` validates the shape; 2025-era `authorizeExistingSession` requires the same `credentialId` (`mcp-http.controller.ts:194-222`) | Yes (M1 caught). The per-request scope read (the MON-M04 fix) has no test (M2 undetected, A26-S17-05) |
| INV-MCP-002 | An MCP request is answered by the MCP transport | `frontend/src/proxy.ts` `isRootMcpRequest`; 401 + RFC 9728 header | Not re-audited beyond the index (S03 owns the proxy) |
| INV-MCP-003 | A confirmation is bound to one credential and one change | HMAC seal over credential + method + fingerprint of `roundStableAction` (`mcp-request-state.ts`, `mcp-confirm.ts`) | Yes (suites green; mechanism read) |
| INV-MCP-004 | A write happens only on the round a human answered | `confirmWrite` outcome matrix; `isAsk` returned untouched | Yes on the MCP side. The AI confirm endpoint can write twice for one approval after a post-commit failure (A26-S17-02) |
| (shared tools) | Every AI tool that reads or aggregates is one domain method with two thin adapters (executor and MCP) | `docs/backend/ai-and-payees.md` "Shared AI tools"; `backend/src/mcp/CLAUDE.md` | Yes: parity matrix below, every read tool calls the same domain method in both layers; documented exceptions only |
| (LLM shape) | A figure a model reads names its currency, and a total is a total only when every component is known; the completeness flag rides to the LLM shape | `AGENTS.md` "Convert before summing", "A completeness flag is read where the numbers are shown"; `FxAggregate` | **No**: the transaction analytics LLM reads sum amounts of different currencies with no conversion and no flag (A26-S17-01); account summary flags dropped (A26-S13-04, consolidated there) |
| (refusal parity) | Every AI/MCP write reaches the refusals the HTTP path has (VOID, currency, ownership, reconciled lock) | The refusals live in the domain services (`TransactionsService.create/update/removeAny`, `assertTransactionCurrencyMatchesAccount`, the reconciled lock in `transactions.service.ts`), which the HTTP controller, the AI executors (`ai-actions.service.ts`) and the MCP tools all call; AI executors additionally run `toValidatedDto` (class-validator) | Yes, by construction: no refusal found in a controller only. The preview-only transfer refusal is a parity question with the HTTP path, not an AI gap (section 8) |
| (untrusted prompt content) | Text from email, imports or other users is data, never instructions; a run carrying it is offered no tool that acts without a card | `NETWORK_WRITING_TOOL_NAMES` withdrawn from the parser generator run only (`tool-definitions.ts:1337`); every ledger write needs a card | Partly: the ordinary assistant run that claims an email-derived review request still offers `fetch_bond_series` (D1, design risk) |
| MON-M25 (provider half) | One provider call per insight generation across replicas | `claimLease(AiInsightGeneration, 15 min)` + cooldown re-read under the lease (`ai-insights.service.ts:184-217`); `POST /ai/insights/generate` throttled 3/min | Yes within the lease; beyond it A26-S08-04 (owned by S08) |
| INV-DISPATCH-001..004 | One write door; the bell row always written; the throttle gates only the fan-out under a per-(user, category) advisory lock; a delivery failure never reaches the producer | `notification-dispatch.service.ts:172-244` (`withScopedDb` row + lock + `priorInWindow`; fan-out after the commit, `.catch`) | Yes (M3 caught). Every one of the 16 `notify` callers was checked for an enclosing transaction: none (section 12) |
| (dispatch at most once) | A notification fans out at most once | `ON CONFLICT DO NOTHING` on `idx_notifications_dedupe` / fingerprint; `create` returns `null` to the loser and `null` fans out nothing; producers on read paths carry a `dedupeKey` (`budgets.service.ts:822` `BILL_DUE:<bill>:<originalDate>`) | Yes. A crash between the commit and the fan-out loses the push (at most once, by design) |
| INV-ALERT-001 | A system alert lands once per (recipient, dedupe key); only the insert winner emails | `insertAlert` through `notify` (null for the loser), `claimEmail` (`system-alert.service.ts:197-275`) | Yes (sampled) |
| INV-PUSH-001, -003, -004, -011 | A subscription is the caller's; a rotation retires stale keys; a dead device stops being attempted; a held device receives nothing | `subscribe` refusals inside the writing transaction, `ON CONFLICT (endpoint_hash) DO UPDATE ... WHERE user_id = EXCLUDED.user_id` (`push-subscription.service.ts:204-375`); `hold` one guarded `UPDATE` (`:479-493`); purge cron (`:396-443`) | Yes (sampled) |
| (push chart artifact) | The image a price push names is available while the push is deliverable | `CHART_TOKEN_TTL_MS = 5 min` (`push-chart-artifact.service.ts:11`) vs `PUSH_TTL_SECONDS = 4 h` (`web-push-sender.service.ts:24, 339`) | **No**: a push delivered after five minutes names an image that is gone (A26-S17-04) |
| INV-NOTIFY-001 | Producers use `NotificationService.create` | `notification-write-door.spec.ts` | Yes (suite green) |
| INV-CACHE-001 (server half) | A money-moving write invalidates derived caches | the domain services dispatch the recompute after their own commit; AI and MCP call those services | Yes for the AI/MCP adapters (they add no write of their own) |

Material flows:

- Read tool: `model -> tool input (zod, numberArg/booleanArg) -> adapter (executor | MCP) -> domain getLlm* -> SQL -> compact shape -> summary line (executor) | toolResult/structuredContent (MCP) -> model -> user`.
- Write tool: `model -> prep service (resolve names, preview, refusals) -> signed descriptor (AiActionBuilderService) -> card (web chat, relay) | elicitation (MCP) -> /ai/actions/confirm (signature, expiry, single-use claim, AI write cap) | MCP direct commit (McpWriteLimiter) -> domain service write (own withScopedDb, refusals, post-commit recompute) -> attachments (post-commit) -> write counter`.
- Notification: `producer -> NotificationDispatchService.notify -> withScopedDb(advisory lock, NotificationService.create ON CONFLICT, priorInWindow, onWritten) -> commit -> fanOut (push via PushSubscriptionService.sendToUser -> WebPushSender; email) -> outcome bookkeeping`.

### Tool-parity matrix (executor `tool-executor.service.ts` vs MCP `tools/*.tool.ts`)

| AI tool | Domain door (both layers) | R/W | Executor | MCP | Notes |
| --- | --- | --- | --- | --- | --- |
| `list_transactions` | `TransactionAnalyticsService.getLlmListTransactions`, `TransactionsService.getLlmTransactionRows` | R | yes | yes (`transactions.tool.ts`) | A26-S17-01 |
| `compare_periods` | `TransactionAnalyticsService.getLlmPeriodComparison` | R | yes | yes | A26-S17-01 |
| `list_accounts` | `AccountsService.getLlmAccounts` | R | yes | yes | A26-S13-04 (consolidated) |
| `list_categories` | `CategoriesService.getLlmCategories` | R | yes | yes | |
| `get_portfolio_summary` | `PortfolioService.getLlmSummary` | R | yes | yes | flags carried in the summary line (`:2534-2558`) |
| `list_investment_transactions` | `InvestmentTransactionsService.getLlmInvestmentTransactions` | R | yes | yes | A26-S17-01 (`totalAmount`, `totalCommission`) |
| `list_capital_gains` | `InvestmentTransactionsService.getLlmCapitalGains` | R | yes | yes | A26-S12-04 consumer (consolidated there) |
| `get_budget_status` | `BudgetReportsService.getLlmBudgetStatus` | R | yes | yes | |
| `list_upcoming_bills` | `ScheduledTransactionsService.getLlmUpcomingBillsAndDeposits` | R | yes | yes | `amountsComplete`, `known*Subtotal` carried |
| `list_payees` | `PayeesService.getLlmPayees` | R | yes | yes | |
| `lookup_securities` | `SecuritiesService.lookupSecuritiesForLlm` | R | yes | yes | |
| `generate_report` | `BuiltInReportsService.*`, `NetWorthService.getLlmHistory` | R | yes | yes (`reports.tool.ts`) | A26-S17-03 (`spending_anomalies`) |
| `calculate` | `calculate-tool.ts` `executeCalculation` / `executeConversion` | R | yes | yes | |
| `manage_transactions` | `TransactionToolPrepService` + `AiActionBuilderService`; commit `TransactionsService` | W | card -> `AiActionsService` | direct commit after `confirmWrite` | A26-S17-02 |
| `manage_payees` | `PayeeToolPrepService`; commit `PayeesService` | W | card | direct | |
| `manage_securities` | `SecurityToolPrepService`; commit `SecuritiesService` | W | card | direct | |
| `manage_investment_transactions` | `InvestmentTransactionsService.prepare*/preview*`; commit `create/update/remove` | W | card | direct | A26-S12-03 surface (no rate line on either card) |
| `manage_transaction_rules` | `TransactionRuleToolPrepService`; commit `AiActionsService.commitApproved` | W | card | `commitApproved` | |
| `list_transaction_rules` | `TransactionRuleToolPrepService.list` | R | yes | folded into `manage_transaction_rules` `list` | documented (`docs/backend/mcp.md` annotation presets) |
| `ai_review_requests` | `AiReviewWorkService` | W (queue) | yes, key `assistant` | yes, key `callerKey(ctx)` | |
| `email_receipt_parsers` | `EmailReceiptParserToolsService` | R/W (drafts) | yes | yes | assistant form takes `samples` (documented) |
| `fetch_bond_series` | `BondSeriesService.fetchSeries` | W (reference) | yes | yes | D1 |
| `render_chart` | none (presentation only, `tool-executor.service.ts:3050`) | - | yes | no | not a data tool; the chart is an SSE event, never stored (no chart TTL exists on the assistant side) |
| `enter_bond_series_manually` | `BondSeriesService.enterManually` | W | no | yes | documented MCP-only administrator fallback |
| `get_next_prompt`, `post_response`, `report_progress` | `AiRelayService` | relay | no | yes | relay transport, not AI tools |

No undocumented one-layer tool was found. The executor also carries five legacy `case` labels (`spending_by_category` ... `income_by_source`) inside `generateReport`, which are report types, not tools.

## 3. Lens ledger

| Lens | Status |
| --- | --- |
| Pin the revision | ran (section 1) |
| Instructions first | ran: `AGENTS.md`, root and `backend/` `CLAUDE.md`, `backend/src/mcp/CLAUDE.md`, `docs/backend/mcp.md` in full, `docs/backend/ai-and-payees.md` "Shared AI tools" to the end, `docs/system-invariants.md` INV-MCP-001..004 and INV-DISPATCH-001..004 in full, INV-PUSH/ALERT/NOTIFY by index line |
| Summaries as hypotheses | ran: S03 (A26-S03-03), S07, S08 (A26-S08-04, notify-in-transaction), S11 (claim key, `forwarded_by`), S12 (A26-S12-03/-04), S13 (A26-S13-04, anomaly `months`) hand-offs each re-derived from code |
| Invariant model | ran (section 2) |
| Change surface / secondary consumers | ran: parity matrix; every `.notify(` caller (16); every summary line in the executor; the LLM analytics producers |
| Calibration Rule 4 (semantic migration) | ran: `incomeByCurrency` beside `totalAmount` in `getLlmInvestmentTransactions` and `byCurrency` beside `totalIncome` in `getSummary` (the per-currency field was added and the old scalar left mixed, A26-S17-01) |
| Calibration Rule 5 (dependency matrix) | ran for the LLM figures: account currency (UI/AI/MCP/import), exchange rate (cron/manual) -> the analytics totals read neither |
| Cross-layer | ran: tool -> prep -> descriptor -> card (frontend `ConfirmationCardShell.tsx`, `aiChatStore.ts:725-790`) -> confirm -> service |
| Representation boundaries | ran: `months` (1..24) reused as a z-score threshold (A26-S17-03); `callerKey` `undefined` vs session id vs credential id (P1); mixed-currency sum vs `null` (A26-S17-01) |
| Browser/UI round trip | ran for the confirmation card: the error state offers "Retry" with the same signed descriptor (A26-S17-02) |
| Server-authoritative metadata | ran: `userId` from `AuthInfo` (never args); claim key from `callerKey`, never from input; currency from the account in the prep services |
| Identity versus value | ran: relay turn ownership by claim (`claimed_by`), not by user; one-use chart nonce |
| State machine | ran: AI action `pending -> confirming -> confirmed | error -> retry` against the single-use claim (A26-S17-02); relay prompt `pending -> claimed -> answered -> consumed`; review request `pending -> claimed -> proposed -> applied` |
| Concurrency / idempotency | ran: single-use claim (`singleUseTokens.claim`), dispatch advisory lock, chart quota lock, relay conditional `UPDATE`s, MCP write cap check-then-act (D2) |
| Partial failure / compensation | ran: write then attachments (A26-S17-02), row then fan-out (held), chart bytes before push |
| External provider | ran: insight provider call vs lease (MON-M25), push endpoints, chart fetch after delay (A26-S17-04) |
| Calibration Rule 6 (performance) | ran: no N+1 claim made; the insight generate endpoint is bounded (3/min, lease) |
| Database and migration | not applicable because the slice changes no schema at the baseline; `notifications` unique indexes read in `database/schema.sql:2483-2499` only |
| Backup/restore | not applicable beyond INV-PUSH-005 (subscriptions not backed up, index entry read); S06 owns restore |
| Financial | ran: A26-S17-01 numerical example; A26-S17-02 duplicate amount |
| Authorization / RLS | ran: bearer verifiers (A26-S03-03 hand-off), `withUserContext` per request, push chart route public by design |
| Tests are evidence | ran: known-wrong tests for A26-S17-03; M2 shows the MON-M04 fix is untested |
| Mutation | ran: M1-M4 executed (section 6) |
| Counterexample / interaction | ran (section 7) |
| Rules 1, 2, 3, 7, 8 | ran (sections 4, 8) |
| Suggested diff + Rule 10 | ran per finding |
| Adversarial approval challenge | ran (section 13) |

## 4. Confirmed findings

### A26-S17-01 - The AI and MCP transaction analytics add amounts of different currencies together, with no conversion, no currency label and no completeness flag

1. **Severity:** MEDIUM
2. **Confidence:** high (executed, P3 against PostgreSQL; see section 7)
3. **Location:** `backend/src/transactions/transaction-analytics.service.ts:437-495` (`getSummary`: `totalIncome += income` over per-currency rows, `netCashFlow` from the mixed sum), `:1201-1230` (`getLlmListTransactions` returns those totals; `byCurrency` only when more than one currency), `:1430-1505` and `:1512-1580` (`getLlmPeriodComparison` / `getComparisonPeriodData`: `SUM(ABS(split amount))` over every account in every currency, no `byCurrency` at all); `backend/src/securities/investment-transactions.service.ts:5176-5190` (`getLlmInvestmentTransactions`: `totalAmountScaled` and `totalCommissionScaled` across currencies, beside a per-currency `incomeByCurrency`). Consumers: AI summary lines `ai/query/tool-executor.service.ts:516-517` (list_transactions: "Income: X, Expenses: Y, Net: Z", no currency), `:2499` (compare_periods), `:2610-2612` (list_investment_transactions); MCP `list_transactions`, `compare_periods`, `list_investment_transactions` (`mcp/tools/transactions.tool.ts`, `investments.tool.ts`) return the same objects through `toolResult`.
4. **Violated invariant:** `AGENTS.md` Financial math: "Convert before summing ... a total names its currency"; "A subtotal is not a total"; "carry it to every surface including the LLM shape". The compare-periods grouping also adds `ABS` of expense rows only, so a refund in the same category is not netted (`AGENTS.md` "A category's cost is its signed sum over rows of both signs").
5. **Realistic reproduction scenario:** a user with a PLN current account (default currency PLN) and a USD card. September: 4,000.00 PLN groceries and 1,000.00 USD groceries; August: 400.00 PLN. The user asks the assistant (or an MCP client) "how did my spending in September compare with August?" and "what did I spend in September?".
6. **Observed implementation behavior (P3):** `getLlmPeriodComparison` -> `period1.total = 400`, `period2.total = 5000`, `totalChange = 4600`, `totalChangePercent = 1150`; the summary line the model quotes is `Period 2 (...): 5000.00, Change: +4600.00 (+1150%)`. `getLlmListTransactions` -> `totalExpenses = 5000`, summary `Expenses: 5000.00`, with `byCurrency` present in the payload only.
7. **Expected behavior:** each total converted into the reporting currency at the row's date rate (or the row's own rate) through `FxAggregate`, the currency named (`totalsCurrency`), and `fxComplete: false` with a `known*Subtotal` when a rate is missing; or, at minimum, no cross-currency scalar and a per-currency breakdown only.
8. **Impact:** with a USD/PLN rate near 3.65 the September figure is 7,650.00 PLN, not 5,000.00 (understated by 2,650.00, about 35 percent) and the change is +7,250.00 PLN (+1,812 percent), not +4,600.00; the direction can flip when the foreign currency is the larger one in one period and not the other. Every multi-currency user who asks either surface about spending gets a figure in no currency, stated as settled. No stored data is changed.
9. **Root cause:** the LLM analytics reads were built as SQL sums over `amount` without the currency dimension; when the per-currency income was fixed (`incomeByCurrency`, `byCurrency`) the sibling totals were left on the mixed source.
10. **Recommended correction:** aggregate through `FxAggregate` into `resolveUserDefaultCurrency(userId)` per row date (`resolveFxRate`), return `totalsCurrency`, `fxComplete`, `missingRatePairs` and `known*Subtotal`, make the totals `null` when incomplete, and print the currency and the completeness note in the executor's summary lines; net within one category in the comparison (`NET_SPEND_AMOUNT`).
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/transactions/transaction-analytics.service.ts
+++ b/backend/src/transactions/transaction-analytics.service.ts
@@ getComparisonPeriodData
-      if (groupBy === "payee") {
-        qb.select("COALESCE(t.payeeName, 'Unknown')", "label")
-          .addSelect(`SUM(ABS(${SPLIT_AMOUNT}))`, "total")
+      // Group by currency as well; the caller converts each group at the
+      // reporting currency through FxAggregate (AGENTS.md "Convert before summing").
+      qb.addSelect("t.currencyCode", "currencyCode").addGroupBy("t.currencyCode");
+      if (groupBy === "payee") {
+        qb.select("COALESCE(t.payeeName, 'Unknown')", "label")
+          .addSelect(`SUM(${NET_SPEND_AMOUNT})`, "total")
@@ getLlmPeriodComparison
-    const p1Total = sumMoney(period1.map((i) => i.total));
-    const p2Total = sumMoney(period2.map((i) => i.total));
+    const target = await this.reportCurrency.getDefaultCurrency(userId);
+    const p1 = await this.convertPeriod(userId, period1, target, input.period1End);
+    const p2 = await this.convertPeriod(userId, period2, target, input.period2End);
+    // FxAggregate.total is null while a component is unknown.
+    const p1Total = p1.total;
+    const p2Total = p2.total;
@@ return
-      totalChange,
-      totalChangePercent,
+      totalsCurrency: target,
+      fxComplete: p1.fxComplete && p2.fxComplete,
+      missingRatePairs: [...new Set([...p1.missing, ...p2.missing])],
+      totalChange: p1Total === null || p2Total === null ? null : roundMoney(p2Total - p1Total),
+      totalChangePercent: /* null when either total is null or p1Total is 0 */ ...,
--- a/backend/src/ai/query/tool-executor.service.ts
+++ b/backend/src/ai/query/tool-executor.service.ts
@@ comparePeriods summary
-      summary: `Period 1 (${period1Start} to ${period1End}): ${data.period1.total.toFixed(2)}, ...`,
+      summary: data.fxComplete === false
+        ? `Totals withheld: no exchange rate for ${data.missingRatePairs.join(", ")}. ...`
+        : `Period 1 (${period1Start} to ${period1End}): ${data.period1.total.toFixed(2)} ${data.totalsCurrency}, ...`,
```

Suggested remediation diff: incomplete. Missing: the rate date per row (row date or the row's own `exchange_rate`, INV-FX-002), the same change in `getSummary` (also read by the transactions page, so its HTTP consumers in S07/S16/S20 must be checked first under Rule 10), `getLlmGroupedBreakdown`, `getLlmInvestmentTransactions`, and the MCP output schemas (`tool-output-schemas.ts`) for the new declared fields.
12. **Recommended regression test:** an integration case with two currencies and a stored rate asserting the converted totals, and a missing-rate case asserting `fxComplete: false` with `null` totals; a unit case asserting the summary line names the currency.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+++ b/backend/test/integration/llm-analytics-currency.integration.spec.ts
+it("converts a USD expense before comparing periods", async () => {
+  // PLN default; Aug 400 PLN; Sep 4,000 PLN + 1,000 USD; USD/PLN 3.65 on 2026-09-12
+  const cmp = await withUserContext(userId, () =>
+    analytics.getLlmPeriodComparison(userId, { period1Start: "2026-08-01", period1End: "2026-08-31", period2Start: "2026-09-01", period2End: "2026-09-30" }),
+  );
+  expect(cmp.totalsCurrency).toBe("PLN");
+  expect(cmp.period2.total).toBeCloseTo(7650, 2);
+  expect(cmp.totalChange).toBeCloseTo(7250, 2);
+});
+it("withholds the comparison when a rate is missing", async () => {
+  // same rows, no USD/PLN rate stored
+  expect(cmp.fxComplete).toBe(false);
+  expect(cmp.period2.total).toBeNull();
+});
```

14. **Verification method:** the new integration suite; `tool-executor.service.spec.ts` summary-line cases; `tool-output-schemas.spec.ts` round trip with the new fields; `tools-list-budget.spec.ts` (a schema change costs `tools/list` bytes).
15. **Residual risks / patch limitations:** the transactions page summary shares `getSummary`; changing its scalar semantics there needs the frontend consumer audit (S20). The patch does not decide whether a transfer between two currencies belongs in either total (it is excluded today by `isTransfer = false`).

Causality: `PRE_EXISTING_UNREPORTED` (the analytics LLM reads predate the 2026-08 audit; not in its register). Rule 7 surfaces: AI and MCP `list_transactions`, `compare_periods`, `list_investment_transactions`. Not merged with A26-S13-01: that finding is a missing-rate fallback inside a conversion; here no conversion is attempted.

### A26-S17-02 - A failure after the write commits releases the AI action's single-use claim, so the card's "Retry" writes the same transaction a second time

1. **Severity:** MEDIUM
2. **Confidence:** high (executed, P2; mechanism read end to end)
3. **Location:** `backend/src/ai/actions/ai-actions.service.ts:224-280` (`confirm`: claim, `execute`, and on ANY throw `singleUseTokens.release`), `:921-949` (`executeCreateTransaction`: `transactionsService.create` commits in its own `withScopedDb`, then `persistAttachments`), `:754-812` (same order on update), `:909-919` (`persistAttachments` -> `attachmentsService.create`, which can throw on storage failure, the per-transaction cap under the row lock, or a refused upload); frontend `frontend/src/store/aiChatStore.ts:730-733` (an `error` action is sendable again) and `frontend/src/components/ai/ConfirmationCardShell.tsx:65-71` ("Retry" re-sends the same signed descriptor). MCP sibling: `backend/src/mcp/tools/transactions.tool.ts:1130-1153` (`create` commits, `writeLimiter.record`, then `persistAttachmentsDirect`; a throw there reaches the model as the generic `safeToolError`, `mcp-context.ts:174`).
4. **Violated invariant:** INV-MCP-004 / the single-use confirmation the claim implements ("a descriptor commits once"); `docs/external-side-effects.md` ordering (a failure must not leave the user told "not done" for a write that is done); `docs/concurrency-and-idempotency.md` retry after commit.
5. **Realistic reproduction scenario:** a user drops a receipt photo into the chat and asks the assistant to record a 245.80 PLN purchase with the photo attached. The card shows the transaction and the attachment; the user confirms. The attachment store (S3 or the local volume) refuses the put, or another upload to the same transaction fills the tenth slot between the card and the confirm (update path). The transaction has committed; the card turns red with the storage error and a "Retry" button.
6. **Observed implementation behavior (P2):** the first `confirm` creates the transaction, `attachments.create` throws, the claim is released, the error reaches the card; the second `confirm` with the same `actionId` and signature passes the claim and calls `transactionsService.create` again: `creates= 2`. On the MCP path the model is told "An error occurred while processing your request" after the row exists and the cap was charged; its documented response to an error is to retry, which asks the human again for a change that is already in the ledger.
7. **Expected behavior:** once the ledger write has committed, the descriptor is spent: the claim stays taken, the attachment failure is reported as "saved, but the file could not be attached" with the transaction id, and a retry attaches the file to that transaction rather than creating another.
8. **Impact:** a duplicate transaction of the full amount (balance moved twice: 245.80 PLN extra, 100 percent), with no daily-cap charge for the first one (`record` is skipped on the throw), on a path the UI invites the user to take. Recoverable by deleting the duplicate if noticed.
9. **Root cause:** the claim-release rule ("released when the write throws, so a transient failure leaves the descriptor confirmable") treats `execute` as atomic, but `execute` is a committed write followed by a separate external side effect.
10. **Recommended correction:** release the claim only when the failure happened before the ledger write committed: split `execute` into the write (inside which a throw releases) and the post-commit steps (whose failure keeps the claim and returns a partial result), and on MCP return a structured partial success naming the created id.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/ai/actions/ai-actions.service.ts
+++ b/backend/src/ai/actions/ai-actions.service.ts
@@ executeCreateTransaction
     const transaction = await this.transactionsService.create(userId, dto, {
       createPayeeIfMissing: descriptor.createPayee === true,
     });
-    await this.persistAttachments(userId, transaction.id, files, refIds);
-    return { type: "create_transaction", id: transaction.id };
+    // The ledger write has committed: from here a failure must not make the
+    // descriptor confirmable again (a retry would create a second transaction).
+    const attachmentError = await this.persistAttachments(
+      userId, transaction.id, files, refIds,
+    ).then(() => null, (err: unknown) => err);
+    return {
+      type: "create_transaction",
+      id: transaction.id,
+      ...(attachmentError ? { attachmentsFailed: files.length } : {}),
+    };
   }
@@ executeUpdateTransaction
-    await this.persistAttachments(userId, transaction.id, files, refIds);
-    return { type: "update_transaction", id: transaction.id };
+    const attachmentError = await this.persistAttachments(
+      userId, transaction.id, files, refIds,
+    ).then(() => null, (err: unknown) => err);
+    return {
+      type: "update_transaction",
+      id: transaction.id,
+      ...(attachmentError ? { attachmentsFailed: files.length } : {}),
+    };
--- a/backend/src/mcp/tools/transactions.tool.ts
+++ b/backend/src/mcp/tools/transactions.tool.ts
@@ manageCreateSplit (and the other direct commits that attach)
-    const attachments =
-      attachmentDtos && attachmentRefs
-        ? await this.persistAttachmentsDirect(...)
-        : undefined;
+    let attachments: { id: string; filename: string }[] | undefined;
+    let attachmentsFailed = false;
+    if (attachmentDtos && attachmentRefs) {
+      try {
+        attachments = await this.persistAttachmentsDirect(...);
+      } catch {
+        attachmentsFailed = true; // the transaction exists; do not invite a retry
+      }
+    }
     return toolResult({
       id: tx.id,
       date: tx.transactionDate,
       count: 1,
       ...(attachments ? { attachments } : {}),
+      ...(attachmentsFailed ? { attachmentsFailed: true } : {}),
     });
```

The `ConfirmActionResult` type, the card's confirmed state ("saved; the file was not attached") and the i18n key are the remaining layers; the design decision for the maintainer is whether a failed attachment should instead be retried from a stored ref (the parked bytes live until the relay store's TTL).
12. **Recommended regression test:** `ai-actions.service.spec.ts`: `attachments.create` rejects once; the first confirm resolves with `attachmentsFailed`; a second confirm with the same dto is refused by the claim and `transactions.create` was called once. An integration variant against `single_use_tokens` (`ai-action-replay.integration.spec.ts` is the harness).
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+    it("keeps the claim when the transaction committed and the attachment failed", async () => {
+      attachmentStore.get.mockResolvedValue({ data: FILE_BYTES });
+      attachments.create.mockRejectedValueOnce(new Error("S3 unavailable"));
+      const dto = dtoFor(createTxDescriptor({ attachments: [attachmentRef()] }));
+      const first = await service.confirm(USER, dto);
+      expect(first).toMatchObject({ id: "tx-new", attachmentsFailed: 1 });
+      await expect(service.confirm(USER, dto)).rejects.toThrow(BadRequestException);
+      expect(transactions.create).toHaveBeenCalledTimes(1);
+    });
```

14. **Verification method:** the unit case above (fails at the baseline: P2 shows two creates); `ai-action-replay.integration.spec.ts` extended with a post-commit failure; the frontend card test for the partial state.
15. **Residual risks / patch limitations:** a throw from the domain service AFTER its own commit (for example a post-commit recompute that rejects) has the same shape; the patch covers only the attachment step. A26-S08-02's change to `ScheduledTransactionsService.post` (resolve after a post-commit failure) closes the scheduled branch of `executeCreateInvestmentTransaction`, where the signed due date already refuses a replay.

Causality: `NEW_SINCE_UPSTREAM_AUDIT` (the single-use claim row replaced the in-memory `Map` after 2026-08; the attachment path on cards is new). Rule 7 surfaces: AI `create_transaction` and `update_transaction` confirm; MCP direct commits that attach.

### A26-S17-03 - The AI and MCP `spending_anomalies` report passes the requested number of months as the z-score threshold

1. **Severity:** MEDIUM
2. **Confidence:** high (read; the unit tests assert the defect; M4)
3. **Location:** `backend/src/ai/query/tool-executor.service.ts:2908-2924`, `backend/src/mcp/tools/reports.tool.ts:85-90` (`getSpendingAnomalies(userId, args.months ?? 3)`); callee `backend/src/built-in-reports/anomaly-reports.service.ts:37-40` (`threshold: number = 2`, fixed six-month window at `:51-54`); HTTP route `built-in-reports.controller.ts:188-197` clamps the threshold to `[0.5, 10]`. Tool descriptions `tool-definitions.ts:1051-1056`, `reports.tool.ts:65-67` ("months of history. Default 3", bounds 1..24).
4. **Violated invariant:** the tool contract it documents (months of history), parity with the HTTP report (same data, same threshold), and "A preview computes what the commit will do, through the same code" in its read form: the same report must answer the same question on every surface.
5. **Realistic reproduction scenario:** a user asks "any unusual spending?". The model omits `months` (default 3) or passes 12.
6. **Observed implementation behavior:** the anomaly search runs with z-score threshold 3 (or 12) over the fixed six-month window; at 12 nothing can qualify and the tool description tells the model an empty list "means nothing was unusual". At `months: 1` the threshold is 1 and ordinary purchases are flagged. The AI summary also says "over the last N months", which is not the window used.
7. **Expected behavior:** the default threshold (2, as the Reports page) and either a real `months` window or no `months` input.
8. **Impact:** the assistant and MCP clients answer "nothing unusual" while the Reports page lists anomalies for the same user and data, or flag noise; an explicit user parameter is silently reinterpreted. No stored data changes.
9. **Root cause:** a positional argument of the wrong meaning; the tests mock the callee and assert the wrong value.
10. **Recommended correction:** pass the threshold explicitly (the HTTP default) and either drop `months` from both schemas or add a `months` window parameter to `getSpendingAnomalies`.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/ai/query/tool-executor.service.ts
+++ b/backend/src/ai/query/tool-executor.service.ts
@@ generateReport
-      const months = (input.months as number | undefined) ?? 3;
-      const data = await this.builtInReportsService.getSpendingAnomalies(
-        userId,
-        months,
-      );
+      // The second parameter is the z-score threshold, not a window; the
+      // window is the report's own six months, as on the Reports page.
+      const data = await this.builtInReportsService.getSpendingAnomalies(userId);
       const count = data.anomalies.length;
       return {
         data,
-        summary: `${count} spending anomal${count === 1 ? "y" : "ies"} detected over the last ${months} month${months === 1 ? "" : "s"}.`,
+        summary: `${count} spending anomal${count === 1 ? "y" : "ies"} detected over the last 6 months.`,
--- a/backend/src/mcp/tools/reports.tool.ts
+++ b/backend/src/mcp/tools/reports.tool.ts
-            const data = await this.reportsService.getSpendingAnomalies(
-              user.userId,
-              args.months ?? 3,
-            );
+            const data = await this.reportsService.getSpendingAnomalies(user.userId);
```

plus removing `months` from `tool-input-schemas.ts:329`, `tool-definitions.ts:1051-1056` and `reports.tool.ts:65-67` (a `tools/list` byte reduction).
12. **Recommended regression test:** both adapter specs assert `getSpendingAnomalies` is called with the user id only (or with the documented threshold), replacing the two known-wrong assertions.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
--- a/backend/src/ai/query/tool-executor.service.spec.ts
+++ b/backend/src/ai/query/tool-executor.service.spec.ts
@@ ~1348
-      expect(builtInReports.getSpendingAnomalies).toHaveBeenCalledWith(
-        "user-1",
-        6,
-      );
+      expect(builtInReports.getSpendingAnomalies).toHaveBeenCalledWith("user-1");
```

(same in `mcp/tools/reports.tool.spec.ts:228, 243`).
14. **Verification method:** the two specs; `tools-list-budget.spec.ts` (the caps are a ratchet: lower them); `tool-output-schemas.spec.ts`.
15. **Residual risks / patch limitations:** removing an input field breaks a client that sends it only if the schema were strict; the MCP SDK validates against the declared input schema, so a stale client sending `months` would be refused. The safer first step keeps `months` accepted and ignored.

Causality: `PRE_EXISTING_UNREPORTED`. Handed from S13 (`13-valuation-fx-networth.md` section 12). Rule 7 surfaces: AI and MCP `generate_report` `spending_anomalies`.

### A26-S17-04 - A price push's chart token lives five minutes, the push it rides on four hours

1. **Severity:** LOW
2. **Confidence:** high (read)
3. **Location:** `backend/src/push/push-chart-artifact.service.ts:11` (`CHART_TOKEN_TTL_MS = 5 * 60_000`), `:27-40` (sweep every five minutes), `:73-93` (`consume` refuses after expiry); `backend/src/push/web-push-sender.service.ts:24, 339` (`PUSH_TTL_SECONDS = 4 * 60 * 60`, no `urgency` option, so the push service may hold a normal-priority message while the device dozes); `frontend/public/sw.js:468-489` (the image URL is fetched only when the notification is shown).
4. **Violated invariant:** the opt-in price-chart feature's promise (the notification carries the chart) for every delivery the push service still makes.
5. **Realistic reproduction scenario:** an Android phone in Doze or offline when a price alert fires; the push service delivers it 20 minutes later.
6. **Observed implementation behavior:** the service worker shows the notification with an image URL whose token expired 15 minutes earlier and whose row the sweep removed; the image request is a 404 and the notification shows no chart.
7. **Expected behavior:** the chart is available for as long as the push can be delivered, or the push expires with it.
8. **Impact:** the feature silently degrades to text-only for every delayed delivery; no data or security effect. The one-use token also means a notification re-shown by the OS cannot fetch it again.
9. **Root cause:** two TTLs chosen independently.
10. **Recommended correction:** give price pushes that carry a chart a push TTL no longer than the token's, or raise the token TTL (and the quota window) to the push TTL.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/push/push-chart-artifact.service.ts
+++ b/backend/src/push/push-chart-artifact.service.ts
-export const CHART_TOKEN_TTL_MS = 5 * 60_000;
+// As long as the push that names it can still be delivered
+// (web-push-sender.service.ts PUSH_TTL_SECONDS); the one-use DELETE still
+// retires it at the first fetch.
+export const CHART_TOKEN_TTL_MS = PUSH_TTL_SECONDS * 1000;
```

The quota (`CHART_ARTIFACT_LIMIT = 1000` live rows across the deployment) must then be re-sized: four hours of artifacts is 48 times the current window.
12. **Recommended regression test:** a unit spec asserting `CHART_TOKEN_TTL_MS >= PUSH_TTL_SECONDS * 1000` (a source-level pin of the relation, the `CONFIRM_TIMEOUT_MS` pattern in `mcp-confirm.spec.ts`).
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+it("keeps a chart token alive for as long as the push can be delivered", () => {
+  expect(CHART_TOKEN_TTL_MS).toBeGreaterThanOrEqual(PUSH_TTL_SECONDS * 1000);
+});
```

14. **Verification method:** the spec above; `push-chart-token.integration.spec.ts`.
15. **Residual risks / patch limitations:** the global quota becomes the binding limit for a large deployment; the cap's behaviour (`issue` returns `null`, the push goes without chart) is already graceful.

Causality: `NEW_SINCE_UPSTREAM_AUDIT` (push chart artifacts are new). This is the "chart artifact TTL" of the hint line.

### A26-S17-05 - No test pins that a 2025-era session's tools see the presenting token's scopes (the MON-M04 fix is undetected by every suite)

1. **Severity:** LOW
2. **Confidence:** high (executed, M2)
3. **Location:** `backend/src/mcp/mcp-http.controller.ts:235-257` (`authorize` sets `req.auth` per request), `:298-325` (existing-session POST); tests `mcp-http.controller.spec.ts`, `mcp-eras.spec.ts`.
4. **Violated invariant:** INV-MCP-001 ("with that credential's current scopes"); `docs/verification-contract.md` (a material invariant needs a test that fails when it is broken).
5. **Realistic reproduction scenario:** an OAuth MCP client refreshes its access token with a narrower `scope` (`monize:read` only) on the same grant; the 2025-era session continues.
6. **Observed implementation behavior:** correct today (the tool sees `read`). Mutation M2, which serves the tools the scopes stored at session creation (the exact MON-M04 defect), passes all 802 MCP unit tests.
7. **Expected behavior:** a test fails when a tool on an existing 2025-era session is served anything but the presenting request's scopes.
8. **Impact:** a regression of MON-M04 (a narrowed token keeping write scope for up to the 1-hour session TTL) would ship green.
9. **Root cause:** the controller spec asserts the 403 on a credential mismatch and the modern request's own `authInfo`, but no case drives a same-credential, narrowed-scope request through an existing session to a tool.
10. **Recommended correction:** add that case (and, separately, the documentation line in INV-MCP-001's "Required tests").
11. **Suggested remediation diff (illustrative, not applied):** test-only by nature; the production code is correct (the defect is the missing test, protocol item 12).
12. **Recommended regression test / 13. Suggested regression-test diff (illustrative, not applied):**

```diff
+++ b/backend/src/mcp/mcp-http.controller.spec.ts
+it("serves an existing session's tool the scopes of the token presented now", async () => {
+  // initialize with oauth grant g1 scopes "read,write"; then call a tool with
+  // the same grant (credentialId oauth:g1) whose current scope is "read".
+  validateAccessToken.mockResolvedValueOnce({ userId: "u1", scopes: "read,write", grantId: "g1" });
+  const sid = await initializeSession();
+  validateAccessToken.mockResolvedValueOnce({ userId: "u1", scopes: "read", grantId: "g1" });
+  const req = toolCallRequest(sid);
+  await controller.handlePost(req, res);
+  expect((req as { auth?: AuthInfo }).auth?.scopes).toEqual(["read"]);
+});
```

14. **Verification method:** re-run M2 with the new case: it must fail.
15. **Residual risks / patch limitations:** the assertion is on `req.auth`; the end-to-end property also depends on the SDK forwarding `req.auth` per request (`@modelcontextprotocol/node` `index.cjs:238`), which an SDK upgrade could change; `mcp-eras.spec.ts` is the place for a real-SDK variant.

Causality: `PRIOR_REPORTED` (MON-M04, test half; the defect itself is `FIXED_VERIFIED`, section 5).
