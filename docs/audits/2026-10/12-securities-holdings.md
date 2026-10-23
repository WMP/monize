# Session S12: Securities, holdings, trades, prices, providers

Status: done. Verdict: REQUEST CHANGES (HIGH 1, MEDIUM 6, LOW 3).

## 1. Metadata

| Field | Value |
| --- | --- |
| Session | S12 (parallel wave, child session of orchestrator session_018Nx7aian3f7dpRX5msjFBg) |
| `AUDIT_BASELINE_SHA` | `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86` |
| `git rev-parse HEAD` at start of writing | `2b800f5deda83fecdc97c0e8040e512b6b842a92` (pin check: `git diff --stat 72c59ec4 HEAD -- . ':!docs/audits/2026-10' ':!docs/audits/2026-08-upstream'` empty) |
| Date | 2026-10-21 |
| Primary path | `backend/src/securities/` |
| Hint line used | `prioritize holdings updates and full rebuilds under concurrent trades, the single share-count reducer (SPLIT is a ratio), commission in cost basis versus cash versus UI wording, non-positive or reversed FX on an investment posting, preview equals commit through one resolver (rate and source disclosed), foreign-security transfer basis currency, a stored price in the security's currency, daily change needing a current close, provider negative caching and call multiplicity, and the executed-total-is-the-fact rule on edits` |
| Runtime executed | Node 24.22.1 (`nvm use 24`), `npm ci` OK in `backend/`. PostgreSQL 16 (`mirror.gcr.io/library/postgres:16-alpine`, `dockerd` started by hand). Baseline `npm run test:integration -- "holding\|investment\|securit\|price\|trade"`: **13 suites, 176 tests, all passed** (`bond-holding-value`, `bond-prices`, `gem-price`, `holding-concurrent-trades`, `holding-ledger-projection`, `invested-capital-flow`, `investment-transactions`, `manual-price-snapshot-recovery`, `report-investment-cash`, `scheduled-investment-split-fx`, `security-cross-user-isolation`, `security-transaction-history`, `security-transfer`). Scratch worktree at the baseline (`<scratchpad>/mut`, `node_modules` symlinked): one scratch spec `test/integration/zz-s12-race.integration.spec.ts` with three forced interleavings (R1-R3, a held `lockHoldingScope` barrier and `pg_stat_activity` polling) and five numeric probes (P1-P5) through the real services; results in section 4 and section 7; 16 mutation rows (section 6). Every integration run was serial (`--runInBand`), never in parallel with another. |

## 2. Invariant map

| ID | Statement | Mechanism named | Path (producer -> transformations -> storage -> consumers -> side effects) | Holds at baseline? |
| --- | --- | --- | --- | --- |
| INV-HOLDING-001 | `holdings.quantity` / `average_cost` equal a deterministic replay of the ledger | `rebuildScopesFromTransactions` (`holdings.service.ts:616-727`) in the write's own transaction under `lockHoldingScope` (`common/db/locks.ts:161-166`, advisory, per account, taken before the ledger read); order `INVESTMENT_REPLAY_ORDER` (`investment-replay.util.ts:51-59`); projection `projectedHoldingRow` (`:470-477`) | create / update / remove / updateStatus / transferSecurity / updateLinkedTransfer -> ledger row -> `computeHoldingsMap` (`holdings.service.ts:512-592`) -> `holdings` -> holdings page, portfolio valuation (`portfolio.service.ts:1249, 1380, 1520`), drift report | **Yes for concurrent trades and rebuilds** (R3 executed). **No** for two classes of input: a back-dated or edited transfer leg's price (A26-S12-05) and positions below 0.0001 shares (A26-S12-06). |
| INV-BALANCE-001 (investment cash leg) | The linked cash row of an investment row is created once and torn down once | Cash row created in `processTransactionEffectsInTransaction` (`investment-transactions.service.ts:2537-2625`), deleted by `reverseTransactionEffectsInTransaction` (`:4905-4936`) keyed on the **snapshot's** `transactionId`; `deleteCashTransactionInTransaction` row-locks the cash row (`:889-927`) | edit/delete -> snapshot read before the transaction (`:4321`, `:4939`) -> reverse by snapshot id -> save whole entity -> new cash row -> `accounts.current_balance` | **No**: two edits, or an edit and a delete, of one row duplicate or orphan the cash leg (A26-S12-01, executed). |
| INV-HOLDING-002 | Every share-count replay applies each action identically; SPLIT multiplies | `applyActionToQuantity` (`investment-replay.util.ts:88-109`); `investment-replay.guard.spec.ts` | ledger -> reducer -> holdings / net-worth (`net-worth.service.ts:1853, 2252, 2908`) / cost-basis replays | Reducer **yes**; the holdings fold's per-step 0.0001 snap is not shared with the net-worth reducers, so the share counts disagree for micro positions (A26-S12-06). |
| INV-TRADE-001 | The executed total is the fact; price derived at 10 dp | `resolveInvestmentAmounts` (`investment-amount.util.ts:149-182`); value-keyed change detection in `update()` (`investment-transactions.service.ts:4615-4656`) | DTO total -> stored `total_amount` -> cash leg, realized gain | Yes on the form and the HTTP edit path (M3 caught). The AI/MCP edit path keeps the total but replaces the rate (A26-S12-03). |
| INV-FX-001 | A rate for a date is the newest observation on or before it within 45 days, else unknown | `resolveFxRate` behind `getRateForDate` (`currencies/exchange-rate.service.ts:1129-1174`) | trade date -> `resolveCashExchangeRateOrNull` (`investment-transactions.service.ts:726-801`) -> `exchange_rate` on the row -> cash leg amount | **No** on the posting path: a null from `getRateForDate` falls back to `getLatestRate` with no age bound (`:788-793`), so a back-dated trade settles at a rate struck after it (A26-S12-02, executed). |
| INV-FX-002 | A row carrying its own rate is converted at that rate on every surface | `exchange_rate` stored on the row; `update()` keeps it unless account/funding/security changed (`:4700-4729`) | stored rate -> cash leg, realized gain (`portfolio-calculation.service.ts:1299, 1333`), lots (`:772-779`) | **No** on the AI/MCP edit path, which re-resolves and writes a fresh market rate on a description-only edit (A26-S12-03, executed). |
| Transfer basis (MON-M35; contract `portfolio-calculation.service.ts:785-791`) | A security transfer conserves basis: the destination takes exactly what the source released, in the source's settlement currency | `calculateCostBasisLotsInAccountCurrency` carries the OUT leg's released basis (`:886-963`); every other replay prices the IN leg as `acquisitionCost` at rate 1 | transfer -> two legs at `carriedCost` and rate 1 -> holdings fold, realized gains (`:1304-1310`), capital-gains seed `applyTxToState` (`:293-339`), `:1620-1624` | **No** on realized gains and the capital-gains replays (A26-S12-04, executed); holdings average cost not conserved for a back-dated transfer (A26-S12-05, executed). |
| Commission in basis (MON-M30) | Acquisition commission is in the basis; sale commission reduces proceeds | `acquisitionCost` (`investment-replay.util.ts:376-418`, prefers the stored total, which includes commission); `deriveInvestmentTotal` (`investment-amount.util.ts:47-66`) | DTO commission -> `total_amount` -> cash leg (`-total`) and basis | Yes on every backend replay read (holdings, lots, realized gains, `getHoldingAt`). UI wording is S19/S20's. |
| Non-positive FX (MON-M29) | A supplied rate must be > 0; a stored rate is never collapsed with `\|\| 1` | DTO `@IsPositive()` (`dto/create-investment-transaction.dto.ts:98-102`, inherited by the update DTO through `PartialType`); `resolveCashExchangeRateOrNull` refuses `<= 0` (`:743-751`); cash leg uses `??` (`:835-837`); `acquisitionCost` returns null for `<= 0` (`investment-replay.util.ts:408-409`) | DTO -> rate -> cash leg | Yes on create and preview; update writes the DTO rate without the same-currency rule (section 9). |
| INV-PRICE-001 | A provider price is stored only in the security's currency | `refuseForeignCurrency` / `verifyProviderCurrency` at `fetchQuoteWithFallback`, `fetchHistoricalWithFallback`, `fillPriceWindow`, and per security before every group write (`security-price.service.ts:379-566, 822-836, 1486-1500, 1732-1742, 2098-2102`) | provider -> currency check -> `savePriceData` / `bulkUpsertPrices` -> `security_prices` -> valuation | Yes for the provider writers read. The S01 hand-off writers `security-price.service.ts:2364, 2432` are transaction-derived (the trade's own price), not provider answers (section 8). |
| Daily change (contract rule, `daily-change.util.ts`) | Two closes are a daily move only when adjacent and current | `resolveDailyPriceChange` (`:102-137`), `keepNewestSession` (`:164-173`) | two newest closes -> movers board (`portfolio.service.ts:1316-1353`), favourites (`securities.service.ts:1342`) | Yes (M6 caught); the month-over-month board is a period figure with no age bound (section 9). |
| INV-PROVIDER-001 | An unreachable provider stops being called and is reported once | `ProviderHealthService` breaker; `describeFetchFailure` | provider call -> `assertAvailable` before the semaphore (`yahoo-finance.service.ts:215-297`) -> `recordSuccess` on body (`:307-316`) -> `logFailure` | Yes on the Yahoo door read; MSN and Deutsche Boerse sampled at their caches only. |
| Negative caching (`docs/backend/securities-and-providers.md`) | Only an answered window is remembered as empty | `fillPriceWindow` returns `{ stored, answered }` (`security-price.service.ts:2043-2116`); `emptyPriceWindows` | read -> fill -> memory (30 min) | Partially: `answered` is true when any provider answered, even if a later one failed (A26-S12-08). |
| INV-INTRADAY-001 | An intraday bar is valued at its own day's positions | `getDailyInvestmentPositions` | S13 boundary | Not reviewed here; handed to S13 (section 12). |

## 3. Lens ledger

| Lens | Status |
| --- | --- |
| Pin the revision | ran (section 1) |
| Instructions before implementation | ran: `AGENTS.md`, root and `backend/CLAUDE.md`, `docs/backend/securities-and-providers.md`, `docs/system-invariants.md` entries INV-HOLDING-001/002, INV-TRADE-001, INV-PRICE-001, INV-FX-001/002 |
| Summaries as hypotheses | ran: S02's MON-H08 and MON-H14 triage re-executed (R3, P3); the INV-HOLDING-001 "known gap" text re-tested (R1, R2) |
| Invariant model | ran (section 2) |
| Change surface (producers/consumers) | ran for `exchange_rate`, `price` on transfer legs, `transaction_id` on investment rows, `holdings.quantity` (every writer, section 13), `security_prices` writers, provider currency fields |
| Cross-layer | ran for the AI/MCP edit path (`mcp/tools/investments.tool.ts:827-883`, `ai/actions/ai-action-builder.service.ts:693-726`) |
| Representation boundary | ran: rate `undefined` vs stored vs supplied; quantity below 0.0001; `answered` vs `[]` vs `null` |
| Browser/UI round trip | not run here: the form round trip is S19's (`sessions.md`); the server half of each value was traced |
| Server-authoritative metadata | ran: transfer price on edit (A26-S12-05), rate on edit (A26-S12-03), settlement currency derivation (`resolveSettlementCurrencyPair`, held) |
| Identity versus value | ran: cash leg identity read from a snapshot (A26-S12-01) |
| State machine | ran: VOID crossings in `updateStatus` (row lock and advisory lock held; no finding) |
| Concurrency and idempotency | ran: R1, R2, R3 executed |
| Partial failure | ran: post-commit `upsertTransactionPrice`, SPLIT full rebuild and bond recompute are best-effort after commit (section 9) |
| External provider lookup | ran (sampled): one/N success and failure, empty answer, negative caching (`emptyPriceWindows`, MSN id cache, Deutsche Boerse currency cache), call multiplicity of the refresh (section 9); A26-S12-08 |
| Database and migration | not applicable: the slice changes no schema; `security_prices` has no currency column (INV-PRICE-001 known gap, unchanged) |
| Backup/restore | not applicable: S06's slice; holdings are rebuilt from the ledger on restore (not re-verified here) |
| Financial | ran: numerical examples in A26-S12-01..06 |
| Authorization/RLS | ran on reading for the paths read: every service method takes `userId` from the caller and filters by it; RLS itself is S04's |
| Tests as evidence | ran: section 10 |
| Mutation | ran: 16 rows (section 6) |
| Counterexamples, interaction | ran (section 7) |

## 4. Confirmed findings

### A26-S12-01 - Editing an investment transaction twice at once, or editing it while it is deleted, duplicates or orphans its cash leg

1. **Severity:** HIGH
2. **Confidence:** high (executed, forced interleaving, R1 and R2)
3. **Location:** `backend/src/securities/investment-transactions.service.ts:4321` (`update()` reads the row with `findOne` before its transaction), `:4473-4480` (the transaction takes only the account-level advisory lock), `:4536-4540` -> `:4905-4936` (`reverseTransactionEffectsInTransaction` deletes the cash row named by the **snapshot's** `transactionId` and nulls the column on the live row), `:4731` (`manager.save(transaction)` writes the whole stale entity), `:4750-4756` (a new cash row is created unconditionally); same shape in `remove()` `:4939`, `:5016-5019`; `updateLinkedTransfer` `:3853-4005` (no cash, see A26-S12-07).
4. **Violated invariant:** INV-BALANCE-001 for the investment cash leg; the rule in `AGENTS.md` "every check that can refuse a request ... runs inside the same transaction as the mutation, under the same lock"; INV-HOLDING-001 known gap ("update() and remove() derive the scopes ... from a snapshot loaded before the transaction, without lockInvestmentTransactionRow") is narrower than the defect.
5. **Reproduction:** funding account 100,000.00; BUY 10 @ 100.00 posts cash row C1 -1,000.00 (balance 99,000.00). Two `PATCH /investment-transactions/:id {price: 110}` arrive together (double submit, two tabs, or the form plus an AI edit). Both read the row (transactionId C1) before either takes `lockHoldingScope`. A runs: deletes C1 (+1,000.00), saves, creates C2 (-1,100.00), commits. B then runs with its snapshot: `manager.update(..., {transactionId: null})` unlinks C2, `lockTransactionRow(C1)` finds nothing so nothing is reversed, B saves its stale entity and creates C3 (-1,100.00). R2: the same with A an edit and B a `DELETE`: B deletes the investment row but reverses only C1 (already gone), so C2 survives with no owner.
6. **Observed (executed):** R1 -- two cash rows, ledger -2,200.00, balance 97,800.00; the investment row names C3 only. R2 -- investment row gone, one cash row -1,100.00 left, balance 98,900.00.
7. **Expected:** R1 -- one cash row -1,100.00, balance 98,900.00 (the second edit is a no-op or a 409). R2 -- no investment row, no cash row, balance 100,000.00.
8. **Impact:** money created or destroyed in a cash account with no investment row behind it: -1,100.00 per duplicated edit (100 percent of the trade); the orphan cash row cannot be removed through the investment register and survives every holdings rebuild (holdings are re-derived, the cash row is not). Reachable from the form, `PATCH`, the AI assistant and MCP (`update()` is the one door), and from the bulk update path, which loops `update()`.
9. **Root cause:** the advisory lock serializes the two writers but neither re-reads the row after acquiring it; every decision after the lock (which cash row to delete, which fields to save) is taken from a snapshot read outside the transaction. `updateStatus` (`:4109-4289`) shows the correct shape: `lockInvestmentTransactionRow` inside the transaction after the advisory lock.
10. **Recommended correction:** inside the transaction, after `lockHoldingScope`, take `lockInvestmentTransactionRow(manager, id, userId)`, refuse with 404 when it is gone, refuse with 409 when its account no longer matches the locked scope, and reload the entity from the manager before applying the DTO; the same in `remove()` (and in `updateLinkedTransfer` for both legs).
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/securities/investment-transactions.service.ts
+++ b/backend/src/securities/investment-transactions.service.ts
@@ -4477,6 +4477,27 @@ export class InvestmentTransactionsService {
       await lockHoldingScope(
         manager,
         [accountId, updateDto.accountId].filter((id): id is string => !!id),
       );
+      // The row as it is now, under its own lock: a concurrent edit or delete
+      // may have replaced its cash leg (or removed it) since the read above.
+      const locked = await lockInvestmentTransactionRow(manager, id, userId);
+      if (!locked) {
+        throw new NotFoundException(
+          tr(
+            "errors.securities.investmentTransactionNotFound",
+            `Investment transaction with ID ${id} not found`,
+            { id },
+          ),
+        );
+      }
+      if (locked.accountId !== accountId) {
+        throw new ConflictException(
+          tr(
+            "errors.securities.investmentTransactionChanged",
+            "This transaction was changed by another request; reload it and try again.",
+          ),
+        );
+      }
+      Object.assign(
+        transaction,
+        await manager
+          .getRepository(InvestmentTransaction)
+          .findOneOrFail({ where: { id, userId }, relations: ["account", "security", "fundingAccount"] }),
+      );
@@ -4991,6 +5012,14 @@ export class InvestmentTransactionsService {
     await withScopedDb(this.dataSource, async (manager) => {
       await lockHoldingScope(manager, affectedAccountIds);
+      for (const leg of legsToRemove) {
+        const locked = await lockInvestmentTransactionRow(manager, leg.id, userId);
+        if (!locked) {
+          throw new NotFoundException(/* as above */);
+        }
+        // Reverse what the row carries now, not what it carried at the read.
+        leg.transactionId = locked.transactionId;
+      }
```

The prior* values (`priorPrice`, `priorQuantity`, ...) and `beforeData` must then be taken from the reloaded entity, not the outer read. Needs: type-check, the unit suite (the mocked `lockInvestmentTransactionRow` returns null by default in `test-helpers/locks-testing.ts:64`, so mocks need a row), and the R1/R2 race below at integration level. Decision for the maintainer: 409 versus "apply on top of the current row" for the second of two edits.

12. **Recommended regression test:** two-connection R1 and R2 at integration level, barrier on `lockHoldingScope`, asserting the funding account's cash rows and balance against the ledger.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+++ b/backend/test/integration/investment-edit-race.integration.spec.ts
+  it("a double-submitted edit of one BUY moves the cash once", async () => {
+    const tx = await buy(10, 100, "2026-01-15");          // cash -1,000.00
+    const barrier = holdBarrier([brokerageId]);           // lockHoldingScope held
+    await barrier.isHeld;
+    const a = as(() => investments.update(userId, tx.id, { price: 110 }));
+    const b = as(() => investments.update(userId, tx.id, { price: 110 }));
+    await waitForBlockedBackends(2);
+    barrier.release();
+    await Promise.allSettled([barrier.done, a, b]);
+    const rows = await cashRows(fundingId);
+    expect(rows).toHaveLength(1);
+    expect(await balance(fundingId)).toBe(98900);
+  });
```

14. **Verification:** the scratch spec R1/R2 green after the fix and red with the lock call removed; `npm run test:unit -- investment-transactions`; `npm run test:integration -- investment`.
15. **Residual risks:** the patch closes the investment row; `transactions.service` edits of a linked cash leg are S07's (A26-S07-01). The same snapshot shape in `updateLinkedTransfer` moves no cash and is A26-S12-07.

- Causality: `PRE_EXISTING_UNREPORTED` (the investment-ledger sibling of MON-H05 / A26-S07-01; the INV-HOLDING-001 known-gap text names the snapshot but not the cash duplication).

### A26-S12-02 - A back-dated cross-currency trade with no rate near its date settles at the newest rate, struck after it (MON-H14 residual, server half)

1. **Severity:** MEDIUM
2. **Confidence:** high (executed, P3)
3. **Location:** `backend/src/securities/investment-transactions.service.ts:780-793` (`getRateForDate` then `getLatestRate(sourceCurrency, cashCurrency)` with no `maxAgeDays`); consumers: `create` `:1216-1223`, `previewCreateInvestmentTransaction` `:1780-1787`, `update` `:4720-4727`, the forecast through `resolveCashExchangeRateOrNull` (the scheduled path), bulk, AI and MCP through `create`.
4. **Violated invariant:** INV-FX-001 ("never one struck after it and never an unboundedly old one; null otherwise"); `backend/CLAUDE.md` "A rate for a date: `resolveFxRate` ... never `getLatestRate`".
5. **Reproduction:** CAD brokerage and CAD funding account, USD security; `exchange_rates` holds only today's USD/CAD 1.37. `create` a BUY of 100 @ 100.00 dated 1990-01-02 with no `exchangeRate` (MCP, AI, bulk paste, or an API client). `getRateForDate` finds nothing within 45 days and the provider window answers nothing (USDCAD history begins December 2003, `docs/backend/securities-and-providers.md`), so it returns null; the fallback returns today's 1.37.
6. **Observed (executed):** the row stores `exchange_rate` 1.3700000000 and the cash leg -13,700.00 CAD. The preview carries `exchangeRate` but no field saying which rate answered (trade date, latest, or supplied).
7. **Expected:** refused with `errors.securities.exchangeRateUnavailable`, as the code's own comment at `:674-677` and `:694-711` intends, so the caller supplies the settlement rate.
8. **Impact:** a cash balance off by the currency move between the trade date and today: if the trade settled at 1.16 (an illustrative 1990 rate), 13,700.00 versus 11,600.00 CAD, 2,100.00 CAD (18.1 percent), and the same error in every cost basis and realized gain read from the row's rate (INV-FX-002 makes the wrong rate authoritative everywhere). Also reachable for any date while the FX provider is down and the stored history has a gap over 45 days.
9. **Root cause:** a secondary "latest snapshot" fallback (precedence item 3 in the comment at `:666-672`) left in after `getRateForDate` gained its own age-bounded resolution and provider fill.
10. **Recommended correction:** drop the `getLatestRate` fallback in `resolveCashExchangeRateOrNull`; a null then throws in the posting variant and stays unknown in the forecast variant, which is the documented behaviour. Disclose the rate's basis in the preview (`exchangeRateSource: "supplied" | "trade_date" | "same_currency"`).
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/securities/investment-transactions.service.ts
+++ b/backend/src/securities/investment-transactions.service.ts
@@ -778,19 +778,13 @@
-    // Prefer the rate as of the transaction date (fetching from Yahoo for that
-    // date when not already stored); fall back to the latest stored snapshot.
-    let rate: number | null = null;
-    if (transactionDate) {
-      rate = await this.exchangeRateService.getRateForDate(
-        sourceCurrency,
-        cashCurrency,
-        transactionDate,
-      );
-    }
-    if (rate === null) {
-      rate = await this.exchangeRateService.getLatestRate(
-        sourceCurrency,
-        cashCurrency,
-      );
-    }
+    // The rate as of the transaction date, under INV-FX-001 (resolveFxRate's
+    // 45-day bound, with a provider window fill). Nothing newer than the date
+    // and nothing unboundedly old: unknown is refused by the posting variant.
+    const rate = await this.exchangeRateService.getRateForDate(
+      sourceCurrency,
+      cashCurrency,
+      transactionDate ?? todayYMD(),
+    );
```

Needs: the unit cases that assert the latest-rate fallback updated (`investment-transactions.service.spec.ts`, search `getLatestRate`), and a check of the scheduled-investment forecast, which then shows such an occurrence as unknown rather than at today's rate.

12. **Recommended regression test:** an integration case with only a current stored rate and a trade dated outside the 45-day window, asserting a 400 and no row written; a unit case asserting `getLatestRate` is never called by the posting path.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+  it("refuses a back-dated cross-currency trade with no admissible rate", async () => {
+    await seedRate("CAD", "USD", 1 / 1.37, today);
+    await expect(
+      as(() => investments.create(userId, { ...buyUsdInCad, transactionDate: "1990-01-02" })),
+    ).rejects.toThrow(/exchange rate/i);
+    expect(await countRows("investment_transactions")).toBe(0);
+  });
```

14. **Verification:** P3 refused after the fix; `npm run test:unit -- investment-transactions`.
15. **Residual risks:** the client half (the form's own rate field) is S19's; the preview-source disclosure is a contract decision.

- Causality: `PRIOR_REPORTED` MON-H14, `CONFIRMED_WITH_DIFFERENT_ROOT_CAUSE` (S02 found the preview/commit pair aligned; the residual is that both align on a rate INV-FX-001 forbids).

### A26-S12-03 - An AI or MCP edit that names no rate replaces the row's own exchange rate with a freshly resolved market rate

1. **Severity:** MEDIUM
2. **Confidence:** high (executed, P4)
3. **Location:** `backend/src/securities/investment-transactions.service.ts:1912-1915` (`previewUpdateInvestmentTransaction` passes `exchangeRate: input.exchangeRate`, so the preview re-resolves when the edit names none); commit: `mcp/tools/investments.tool.ts:869-881` and the bulk loop after `:950` send `exchangeRate: preview.exchangeRate`; `ai/actions/ai-action-builder.service.ts:693-726` signs `exchangeRate: preview.exchangeRate` into the descriptor; `update()` writes any DTO rate (`:4706-4707`). The confirmation text (`mcp/tools/investments.tool.ts:1236-1280`, `editLines`) shows no rate.
4. **Violated invariant:** INV-FX-002 (the row's own rate is the fact); `AGENTS.md` "A presentation-only edit does not re-resolve an FX rate"; the `update()` contract at `:4700-4705` (keep the stored rate unless the pair changed).
5. **Reproduction:** a SELL of 141 shares of a USD security from a CAD brokerage, entered at its statement total 820.91 USD and the broker's settlement rate 1.40 (cash +1,149.27 CAD); today's stored USD/CAD is 1.37. Through MCP `manage_investment_transactions` (or the assistant) the user asks to change only the description.
6. **Observed (executed):** the preview resolves 1.3699999999986299 (unrounded, not `roundFxRate`) and `cashAmount` 1,124.65; after confirmation the row stores 1.37 and the cash leg +1,124.65.
7. **Expected:** the stored 1.40 kept; cash leg unchanged at +1,149.27.
8. **Impact:** -24.62 CAD (2.1 percent) on a description edit; the realized gain on the sale moves by the same amount; the user is shown no rate line, only a cash figure, so the change is not disclosed. A back-dated row combines with A26-S12-02 (today's rate).
9. **Root cause:** the preview reconstructs the edit as a create and therefore resolves a rate; the commit sends what the preview resolved as if the user had supplied it.
10. **Recommended correction:** in `previewUpdateInvestmentTransaction`, when the edit names no rate and changes neither the account, funding account nor security, carry the stored rate (`Number(existing.exchangeRate)`) into the preview; the adapters then send it back unchanged. Show the rate line in `editLines` when it differs from the stored one.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/securities/investment-transactions.service.ts
+++ b/backend/src/securities/investment-transactions.service.ts
@@ -1909,10 +1909,15 @@
-      // Only an explicit override pins the rate; otherwise the preview
-      // re-resolves it fresh (for the new currency pair if the security or
-      // account changed), matching update()'s re-resolution precedence.
-      exchangeRate: input.exchangeRate,
+      // update() keeps the stored rate unless the pair changed (INV-FX-002), and
+      // the adapters commit exactly what this preview resolved, so the preview
+      // must carry the stored rate rather than re-resolve it.
+      exchangeRate:
+        input.exchangeRate ??
+        (input.securityQuery === undefined ||
+        input.securityQuery === existing.security?.symbol
+          ? Number(existing.exchangeRate)
+          : undefined),
```

Needs: a same-currency row still resolves to 1 (the same-currency branch dominates a supplied rate, `:770-772`); unit cases for the preview; the AI executor's update path (`ai/query/tool-executor.service.ts:2189, 2226`) re-checked.

12. **Recommended regression test:** preview a description-only edit of a cross-currency row with a stored rate different from the market and assert `preview.exchangeRate` equals the stored rate; at integration level, P4 asserting the cash leg.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+  it("keeps the row's own rate when an AI edit names none", async () => {
+    const sell = await sellUsdFromCad({ totalAmount: 820.91, exchangeRate: 1.4 });
+    const preview = await svc.previewUpdateInvestmentTransaction(userId, sell.id, { description: "x" });
+    expect(preview.exchangeRate).toBe(1.4);
+    expect(preview.cashAmount).toBe(1149.27);
+  });
```

14. **Verification:** P4 green; `npm run test:unit -- investment-transactions mcp/tools/investments ai-action-builder`.
15. **Residual risks:** a security change through `securityQuery` still re-resolves, which is correct; the preview's unrounded rate (1.3699999999986299 versus the stored 1.3700000000) is a separate precision nit (section 9).

- Causality: `PRE_EXISTING_UNREPORTED`. Surfaces (Rule 7): MCP single, MCP bulk, AI assistant confirmation.

### A26-S12-04 - Realized gains and capital-gains replays price a transferred-in lot at the carried per-share figure and rate 1, so a cross-currency transfer resets the basis (MON-M35 still open off the lots surface)

1. **Severity:** MEDIUM
2. **Confidence:** high (executed, P5)
3. **Location:** `backend/src/securities/portfolio-calculation.service.ts:1302-1310` (`calculateRealizedGains`: `TRANSFER_IN` through `acquisitionCost(tx)`, rate 1 from `transferSecurity` `investment-transactions.service.ts:2414, 2439`), `:293-311` (`applyTxToState`, the capital-gains seed), `:1615-1625` (same fold); the correct fold is `calculateCostBasisLotsInAccountCurrency` `:940-963`, whose own comment (`:926-935`) describes this exact defect.
4. **Violated invariant:** basis conservation across a transfer (`portfolio-calculation.service.ts:785-791`); `AGENTS.md` "The fix for one surface is not the fix".
5. **Reproduction:** two CAD brokerages, USD security. BUY 10 @ 100.00 USD at 1.37 in A (basis 1,370.00 CAD). `transferSecurity` 10 shares A -> B. SELL 10 @ 140.00 USD at 1.37 in B (proceeds 1,918.00 CAD). `calculateRealizedGains`.
6. **Observed (executed):** realized gain 918.00 with cost basis 1,000 (the USD figure under a CAD label).
7. **Expected:** (1,400 - 1,000) x 1.37 = 548.00 CAD.
8. **Impact:** +370.00 CAD phantom gain (67.5 percent) on every sale after a cross-currency transfer, carried into the realized-gains report, the capital-gains-by-month/day charts, the AI/MCP `get_capital_gains` answer (`getLlmCapitalGains`) and any tax figure built from them; the lots surface on the same screen says 548, so two surfaces answer one sale with two figures.
9. **Root cause:** the MON-M35 fix moved only `calculateCostBasisLotsInAccountCurrency` to "the destination takes what the source released"; the three other replays still treat `TRANSFER_IN` as an acquisition.
10. **Recommended correction:** extract the carried-basis handling (the `carriedByTransferOut` map keyed on `linkedTransactionId`, with the OUT-before-IN ordering) into one helper used by all four folds, or route realized gains through the lots replay.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/securities/portfolio-calculation.service.ts
+++ b/backend/src/securities/portfolio-calculation.service.ts
@@ -1300,12 +1300,24 @@
       switch (baseInvestmentAction(tx.action)) {
+        case InvestmentAction.TRANSFER_IN: {
+          // The destination takes what the paired OUT leg released, in the
+          // source's currency -- never quantity x carried price at rate 1.
+          const carried = tx.linkedTransactionId
+            ? released.get(tx.linkedTransactionId)
+            : undefined;
+          if (carried !== undefined) entry.costBasis += carried;
+          entry.quantity += quantity;
+          break;
+        }
         case InvestmentAction.BUY:
-        case InvestmentAction.REINVEST:
-        case InvestmentAction.TRANSFER_IN: {
+        case InvestmentAction.REINVEST: {
@@ -1313,6 +1325,9 @@
         case InvestmentAction.TRANSFER_OUT: {
           const costBasisSold = sellQty * avgCostPerShare;
+          if (tx.action === InvestmentAction.TRANSFER_OUT) {
+            released.set(tx.id, costBasisSold);
+          }
```

plus the OUT-before-IN sort the lots replay uses (`:871-884`), and the same change in `applyTxToState` and `:1615-1625`. An unknown carried basis needs the lots replay's `transferred_basis_unknown` treatment, which `RealizedGainEntry` has no field for: a maintainer decision.

12. **Recommended regression test:** P5 at integration level asserting 548.00 from `calculateRealizedGains` and equality with the lots surface; a source scan that no replay folds `TRANSFER_IN` through `acquisitionCost`.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+  it("a transfer between two CAD accounts carries the CAD basis into the gain", async () => {
+    // BUY 10 @ 100 USD at 1.37 in A, transfer to B, SELL 10 @ 140 USD at 1.37 in B
+    const [gain] = await calc.calculateRealizedGains(userId, {});
+    expect(gain.realizedGain).toBeCloseTo(548, 2);
+  });
```

14. **Verification:** P5 green; `npm run test:unit -- portfolio-calculation`.
15. **Residual risks:** valuation and FX aggregation of these figures are S13's; the holdings page's average cost of a transferred lot is in the security's currency and unaffected by this finding.

- Causality: `PRIOR_REPORTED` MON-M35, `CONFIRMED` (residual on three of four replays).

### A26-S12-05 - A security transfer's basis is the leg's stored price, which is today's average cost on create and whatever the client sends on edit, so a back-dated or edited transfer creates or destroys basis

1. **Severity:** MEDIUM
2. **Confidence:** high (executed, P1)
3. **Location:** `backend/src/securities/investment-transactions.service.ts:2365-2372` (`carriedCost` from the stored holding, read before the transaction, rounded to 6 dp), `:2412, 2436` (both legs priced at it); `updateLinkedTransfer` `:3985-3986` (`leg.price = updateDto.price`, trusted), `:3989-3990` (date and quantity change keep the old price); fold `holdings.service.ts:558-576` (the IN leg adds `acquisitionCost` = quantity x leg price, the OUT leg relieves at the running average as of its date).
4. **Violated invariant:** basis conservation across a transfer (INV-HOLDING-001 projection; `portfolio-calculation.service.ts:785-791`); server-authoritative financial metadata (`AGENTS.md`); INV-HOLDING-001 known gap names only the race.
5. **Reproduction:** BUY 10 @ 100 on 2026-01-10, BUY 10 @ 200 on 2026-03-10 (stored average 150). Record a transfer of 10 shares dated 2026-02-10 (when the source held 10 @ 100).
6. **Observed (executed):** source 10 @ 200.00 (basis 2,000), destination 10 @ 150.00 (basis 1,500); total 3,500.
7. **Expected:** source 10 @ 200 (2,000), destination 10 @ 100 (1,000); total 3,000, what was paid.
8. **Impact:** +500.00 of basis (16.7 percent) created, understating the unrealized and later realized gain on the destination; the opposite sign when later purchases were cheaper. The edit path lets any API client set the destination's basis per share outright. The lots surface (`calculateCostBasisLotsInAccountCurrency`) carries the released basis and disagrees with the holdings page.
9. **Root cause:** the destination's basis is stored as a per-share price on the IN leg and computed once, from today's projection, instead of being the basis the OUT leg releases at its own date in the replay.
10. **Recommended correction:** make the holdings fold carry the OUT leg's released basis to the linked IN leg (the lots replay's rule, one helper shared with A26-S12-04) so the IN leg's price is presentation only; at minimum compute `carriedCost` inside the transaction from `getHoldingAt(..., transactionDate)` and ignore a client `price` on transfer legs.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/securities/holdings.service.ts
+++ b/backend/src/securities/holdings.service.ts
@@ -553,7 +553,20 @@
-      if (tx.action === InvestmentAction.SPLIT) {
+      if (tx.action === InvestmentAction.TRANSFER_IN && tx.linkedTransactionId) {
+        // The destination takes what the paired OUT leg released at its own
+        // date, not quantity x the leg's stored price.
+        const carried = releasedByTransferOut.get(tx.linkedTransactionId);
+        if (carried !== undefined) holding.totalCost += carried;
+      } else if (tx.action === InvestmentAction.SPLIT) {
@@ -571,6 +584,9 @@
       } else if (holding.quantity > 0) {
         const avgCost = holding.totalCost / holding.quantity;
         const relieved = Math.min(Math.abs(quantityChange), holding.quantity);
         holding.totalCost -= relieved * avgCost;
+        if (tx.action === InvestmentAction.TRANSFER_OUT) {
+          releasedByTransferOut.set(tx.id, relieved * avgCost);
+        }
       }
```

with the replay reading both accounts of a pair (a scope rebuild of the destination alone does not see the source's OUT leg: `rebuildScopesFromTransactions` filters to the requested pairs, so the transfer paths must request both scopes, as they already do) and the OUT-before-IN tie order. Decision for the maintainer: the drift report will then flag every existing transfer whose stored price disagreed.

12. **Recommended regression test:** P1 at integration level (basis sum 3,000), and an edit case that changes the transfer's date and asserts the destination's basis follows.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+  it("a back-dated transfer carries the basis the source held on its date", async () => {
+    await buy(10, 100, "2026-01-10");
+    await buy(10, 200, "2026-03-10");
+    await transfer(10, "2026-02-10");
+    expect(await basis(brokerage2Id)).toBeCloseTo(1000, 4);
+    expect((await basis(brokerageId)) + (await basis(brokerage2Id))).toBeCloseTo(3000, 4);
+  });
```

14. **Verification:** P1 green; `npm run test:integration -- security-transfer holding-ledger-projection`.
15. **Residual risks:** the client prefilled `costPerShare` is S19's; cross-currency transfer basis is A26-S12-04.

- Causality: `PRE_EXISTING_UNREPORTED`.

### A26-S12-06 - The holdings fold snaps every intermediate position under 0.0001 shares to zero, so small fractional purchases never form a holding

1. **Severity:** MEDIUM
2. **Confidence:** high (executed, P2; the sell consequence by reading)
3. **Location:** `backend/src/securities/holdings.service.ts:584-588` (per-step `if (Math.abs(holding.quantity) < 0.0001) { quantity = 0; totalCost = 0 }`); not shared with `getHoldingAt` (`:233-236`, end-only snap at 1e-8), `validateNoNegativeHoldingsHistory` (`:376-403`, no snap) or the net-worth reducers (`net-worth/net-worth.service.ts:1853, 2252, 2908`, no snap); `projectedHoldingRow` uses 1e-8 (`investment-replay.util.ts:457, 475`).
4. **Violated invariant:** INV-HOLDING-001 (the stored row equals a replay of the ledger) and INV-HOLDING-002 (one share count per position across surfaces).
5. **Reproduction:** a CRYPTO security (`security-enums.ts:53`); two BUYs of 0.00005 at 60,000.00 (DTO allows 8 dp, `dto/create-investment-transaction.dto.ts:51-53`). A daily recurring buy of 5.00 of bitcoin is 0.000083 BTC.
6. **Observed (executed):** no holding row after the two BUYs (cash -6.00 posted). By reading: each further buy starts from the snapped 0 and is snapped again, so a year of 0.00009 daily buys (0.03285 BTC, about 1,971.00 at 60,000) holds nothing; a later SELL of 0.03 passes `validateNoNegativeHoldingsHistory` (unsnapped sum 0.03285) and the fold then stores a short position of -0.03.
7. **Expected:** a holding of 0.0001 (two buys), 0.03285 (the year).
8. **Impact:** the position is absent from the holdings page and from every valuation that reads `holdings` (`portfolio.service.ts:1249, 1380, 1520`), while the net-worth replay values it; the cash left the account. Narrow in instruments (fractional crypto, fractional shares under 0.0001), unbounded in amount.
9. **Root cause:** a "ghost holding" guard written per step in the fold rather than once at projection, where `projectedHoldingRow` already applies a 1e-8 epsilon.
10. **Recommended correction:** remove the per-step snap from `computeHoldingsMap` and let `projectedHoldingRow` decide at the end; if a residue guard is still wanted mid-fold, use `HOLDING_QUANTITY_EPSILON` (1e-8), the stored scale.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/securities/holdings.service.ts
+++ b/backend/src/securities/holdings.service.ts
@@ -582,10 +582,11 @@
-      // Snap near-zero to exactly zero to prevent ghost holdings
-      if (Math.abs(holding.quantity) < 0.0001) {
+      // A rounding residue of the fold, at the stored scale (8 dp); a real
+      // fractional position of 0.00005 is not a ghost.
+      if (Math.abs(holding.quantity) <= HOLDING_QUANTITY_EPSILON) {
         holding.quantity = 0;
         holding.totalCost = 0;
       }
```

The 0.0001 "held" predicate in the valuation (`portfolio.service.ts:1249` and siblings) is a separate display threshold and a maintainer decision.

12. **Recommended regression test:** P2 at integration level, and a unit case in `holdings.service.spec.ts` folding 10 BUYs of 0.00009.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+  it("keeps a position built from purchases under 0.0001 shares", async () => {
+    for (let d = 10; d < 20; d++) await buy(0.00009, 60000, `2026-01-${d}`);
+    const h = await holdingOf(brokerageId);
+    expect(Number(h.quantity)).toBeCloseTo(0.0009, 8);
+  });
```

14. **Verification:** P2 green; `npm run test:unit -- holdings.service investment-replay`.
15. **Residual risks:** the drift report will flag existing micro positions after the fix, which is the intended repair path.

- Causality: `PRE_EXISTING_UNREPORTED`.

### A26-S12-07 - The security-transfer edit writes and validates before taking the holdings lock, from snapshots of both legs

1. **Severity:** LOW
2. **Confidence:** medium (reading; not executed)
3. **Location:** `backend/src/securities/investment-transactions.service.ts:4330-4336` (linked leg read outside the transaction), `:3853-4027` (no `lockHoldingScope` before the reversal, the two whole-entity `save`s and `validateNoNegativeHoldingsHistory`), `:4036-4040` (the lock is first taken inside `rebuildAccountsFromTransactions`).
4. **Violated invariant:** "a refusal runs inside the same transaction under the same lock" (`AGENTS.md`); the lock-first order every other investment writer follows (`common/db/locks.ts`).
5. **Reproduction:** account X holds 10; a SELL of 10 on X and an edit raising a transfer-out of X from 0 to 10 run together. The SELL holds the lock and validates without seeing the edit; the edit validates without the lock and without seeing the uncommitted SELL. Both commit.
6. **Observed:** (by reading) X's history goes to -10; two concurrent edits of one transfer also overwrite each other's fields (no cash, so no money moves).
7. **Expected:** the second writer waits on `lockHoldingScope` and is refused.
8. **Impact:** a negative position the oversell guard exists to refuse; lost edits of a transfer's fields.
9. **Root cause:** `updateLinkedTransfer` predates the lock-first rule and relies on the rebuild's lock.
10. **Recommended correction:** take `lockHoldingScope` on both legs' old and new accounts as the first statement, then `lockInvestmentTransactionRow` on both legs and reload them.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
@@ -3853,4 +3853,12 @@
     await withScopedDb(this.dataSource, async (manager) => {
+      await lockHoldingScope(manager, [
+        editedLeg.accountId,
+        linkedLeg.accountId,
+        ...[updateDto.accountId, updateDto.destinationAccountId].filter(
+          (id): id is string => !!id,
+        ),
+      ]);
+      // then lockInvestmentTransactionRow on both legs and reload them (A26-S12-01)
       const bondGuard = await beginBondWriteGuard(manager, userId, [
```

12. **Recommended regression test:** a two-connection SELL versus transfer edit with a barrier on the lock.
13. **Suggested regression-test diff:** incomplete: the barrier must hold `lockHoldingScope` while the edit is shown to block on it, which needs the patch above to exist first; same harness as A26-S12-01.
14. **Verification:** `npm run test:integration -- security-transfer`.
15. **Residual risks:** none beyond A26-S12-01's.

- Causality: `PRE_EXISTING_UNREPORTED`.

### A26-S12-08 - The price-window fill remembers a month as empty when one provider answered nothing and another failed

1. **Severity:** LOW
2. **Confidence:** medium (reading)
3. **Location:** `backend/src/securities/security-price.service.ts:2058, 2091` (`answered = true` on any non-null series), `:1999-2013` (`emptyPriceWindows.remember` when `stored === 0 && answered`).
4. **Violated invariant:** `docs/backend/securities-and-providers.md` "a null from a refusal or from a transport failure ... means we did not get an answer"; the FX chain's rule that a window is `answered: false` as soon as a carrying provider returned null (`fx-provider-chain`), which the price fill does not follow.
5. **Reproduction:** a security routed Yahoo then MSN; Yahoo answers `[]` for the month (a window it lacks), MSN times out. `ensurePricesForDate` stores nothing and remembers the month empty for 30 minutes.
6. **Observed:** (by reading) the report shows the position unpriced and does not re-ask MSN for 30 minutes after MSN recovers.
7. **Expected:** not remembered while a routed provider failed to answer.
8. **Impact:** a report unpriced for up to 30 minutes after a partial outage; no wrong figure (the position is reported unpriced).
9. **Root cause:** a single `answered` flag for the chain instead of "every routed provider answered".
10. **Recommended correction:** track `allAnswered` and remember only when it holds.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
-      if (series !== null) answered = true;
+      if (series === null) allAnswered = false;
+      else answered = true;
...
-    return { stored: 0, answered };
+    return { stored: 0, answered: answered && allAnswered };
```

(`allAnswered` initialised true, set false in the `catch` too.)

12. **Recommended regression test:** a unit case with provider 1 returning an empty series and provider 2 throwing, asserting nothing is remembered.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+  it("does not remember a window empty while a routed provider failed", async () => {
+    yahoo.fetchHistoricalWindowSeries.mockResolvedValue({ prices: [], currencyCode: "USD" });
+    msn.fetchHistoricalSeries.mockRejectedValue(new Error("timeout"));
+    await service.ensurePricesForDate([sec.id], "2017-03-15");
+    await service.ensurePricesForDate([sec.id], "2017-03-15");
+    expect(msn.fetchHistoricalSeries).toHaveBeenCalledTimes(2);
+  });
```

14. **Verification:** `npm run test:unit -- security-price.service`.
15. **Residual risks:** none.

- Causality: `PRE_EXISTING_UNREPORTED`.

### A26-S12-09 - A Money-imported trade of a security quoted in another currency stores its price and total in the account's currency, and the app reads both as the security's

1. **Severity:** MEDIUM
2. **Confidence:** medium (reading across two slices; not executed, no committed two-currency Money fixture)
3. **Location:** `backend/src/import/mny/map/map-investments.ts:283-284` (`currencyCode` is the **investment account's**), `import/mny/writers/write-investments.ts:274-292` (price, total and cash amount denominated in `transaction.currencyCode`, `exchangeRate: 1`); readers that assume the security's currency: `holdings.service.ts:558-570` ("Prices here are in the security's currency, as is `averageCost`"), `security-price.service.ts:2314-2372` and `:2374-2458` (`upsertTransactionPrice` / `backfillTransactionPrices` copy the average trade price into `security_prices`, whose currency is `securities.currency_code`), `net-worth/position-price.util.ts:27-34` (`txFallback` reads trade prices as closes).
4. **Violated invariant:** INV-PRICE-001 (a row in `security_prices` is in the security's currency) through the transaction-derived writer; INV-HOLDING-001's denomination (average cost in the security's currency).
5. **Reproduction:** a Money file with a CAD investment account holding a USD security; Money records the buy of 10 shares at the account's CAD figure (S09: "trades in account currency at rate 1, prices in the security's currency"). After import, any edit or the maintenance pass (`POST` behind `securities.controller.ts:750`) writes the CAD trade price as that day's USD close; the holdings fold blends CAD totals into an average the valuation treats as USD.
6. **Observed:** (by reading) on a day with no provider bar, the position is valued at the CAD trade price read as USD and converted again (x 1.37 at USD/CAD 1.37, a 37 percent overstatement on those days); the holding's average cost is CAD under a USD label beside app-created rows in USD.
7. **Expected:** the trade row carries the security's price and an `exchange_rate` to the account (the convention every app-created row follows, `investment-transactions.service.ts:803-850`), or the transaction-derived writer refuses a row whose currency is not the security's.
8. **Impact:** wrong market values on unpriced days and a wrong average cost for imported cross-currency positions; silent, because no row records the currency it was written in (INV-PRICE-001 known gap).
9. **Root cause:** two conventions for `investment_transactions.price`: "in the security's currency, converted by `exchange_rate`" (the app) and "in the account's currency, rate 1" (the Money writer).
10. **Recommended correction:** a maintainer decision: convert at import (security-currency price, `exchange_rate` = account/security) or exclude rows whose account currency differs from the security's from `upsertTransactionPrice` and the holdings basis, reporting them as unknown.
11. **Suggested remediation diff: incomplete.** Supported by the evidence: guard the transaction-derived writer so it averages only rows denominated in the security's currency.

```diff
--- a/backend/src/securities/security-price.service.ts
+++ b/backend/src/securities/security-price.service.ts
@@ -2333,8 +2333,12 @@
        FROM investment_transactions
+       JOIN accounts a ON a.id = investment_transactions.account_id
+       JOIN securities s ON s.id = investment_transactions.security_id
        WHERE security_id = $1
          AND transaction_date = $2
          AND action = ANY($3)
          AND price IS NOT NULL
-         AND status != 'VOID'`,
+         AND status != 'VOID'
+         -- a rate-1 row in another currency is denominated in the account's
+         AND (exchange_rate <> 1 OR a.currency_code = s.currency_code)`,
```

Missing: which currency the Money writer's `price` is in for every action (S09 confirmed the total and cash amount; the price is inferred from the same writer comment), and the import-side conversion, which is S09/S10's.

12. **Recommended regression test:** an MNY writer case with a CAD account and a USD security asserting the stored price and rate, and a transaction-price case asserting no `security_prices` row from a rate-1 cross-currency trade.
13. **Suggested regression-test diff:** incomplete (needs the decision in 10).
14. **Verification:** `npm run test:integration -- mny-import`; a two-currency Money fixture.
15. **Residual risks:** valuation of such holdings (S13).

- Causality: `PRE_EXISTING_UNREPORTED` (S09 hand-off "valuation of a holding whose security currency differs from its account's", answered here for the trade-price half).

### A26-S12-10 - The undo/redo holdings fold adds a dividend's total to the basis and stores the average at 6 decimals

1. **Severity:** LOW
2. **Confidence:** medium (reading)
3. **Location:** `backend/src/action-history/action-history.service.ts:1873-1880` (reads every non-VOID row, no `SHARE_MOVING_ACTIONS` filter), `:1902-1916` (`quantityChange > 0` -> `acquisitionCost` with `total_amount`), `:1942-1947` (average rounded to 6 dp; the canonical writers store 10 dp, `holdings.service.ts:712-724`).
4. **Violated invariant:** INV-HOLDING-001 (one fold; the drift report compares at 1e-10).
5. **Reproduction:** 100 shares bought at 10.00 (basis 1,000.00) and a DIVIDEND entered with quantity 100 and price 0.50 (total 50.00, `deriveInvestmentTotal` uses `quantity || 1`). Undo any action on that account.
6. **Observed:** (by reading) the undo rebuild stores an average of 10.50 instead of 10.00; any average that does not terminate in 6 dp (300.00 / 9 = 33.3333333333) is stored as 33.333333 and reported by the boot-time drift report as a discrepancy (difference 3.3e-7 > 1e-10).
7. **Expected:** the canonical fold's result (10.00; 33.3333333333).
8. **Impact:** a wrong average cost until the next canonical rebuild of that scope; drift reports that a rebuild then "repairs".
9. **Root cause:** a second fold kept beside `computeHoldingsMap` (recorded as an open risk in INV-HOLDING-001's known gap, without the dividend arithmetic or the precision).
10. **Recommended correction:** call `HoldingsService.rebuildAccountsFromTransactions(userId, [accountId], manager)` from the undo path and delete the copy.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/action-history/action-history.service.ts
+++ b/backend/src/action-history/action-history.service.ts
@@ private async rebuildHoldings(
-    await lockHoldingScope(manager, [accountId]);
-    await manager.query(`DELETE FROM holdings WHERE account_id = $1`, [accountId]);
-    ... (the hand-written fold and INSERT loop)
+    await this.holdingsService.rebuildAccountsFromTransactions(
+      userId,
+      [accountId],
+      manager,
+    );
```

Needs a `forwardRef` to `HoldingsService` (`src/module-graph.spec.ts`) and the undo specs updated.

12. **Recommended regression test:** undo after a DIVIDEND with quantity, asserting the stored average equals `findLedgerDiscrepancies`'s replay (no discrepancy).
13. **Suggested regression-test diff:** `expect(await holdings.findLedgerDiscrepancies(userId, m)).toEqual([])` after `actionHistory.undo(...)` on the fixture above.
14. **Verification:** `npm run test:unit -- action-history`.
15. **Residual risks:** none.

- Causality: `PRE_EXISTING_UNREPORTED` (partly recorded as an INV-HOLDING-001 known gap).

## 5. Prior-finding dispositions

| ID | Disposition | Evidence |
| --- | --- | --- |
| MON-H08 | `FIXED_VERIFIED` | `lockHoldingScope` (advisory, per account) is the first statement of create, update, remove, updateStatus and transferSecurity and is taken by every rebuild before its ledger read (`holdings.service.ts:636, 755, 867, 1020`); holdings are written only by replay. Executed: R3 (two concurrent BUYs plus `rebuildFromTransactions`, forced to park on a held lock) stores 30 @ 200.00, equal to the replay; baseline `holding-concurrent-trades.integration.spec.ts` passed. The investment row's own snapshot is a different defect (A26-S12-01); `updateLinkedTransfer` takes the lock late (A26-S12-07). |
| MON-H14 (server half) | `STILL_OPEN` (residual, A26-S12-02) | Preview and commit go through the same `resolveCashExchangeRate`, but both fall back to an unbounded `getLatestRate` for a back-dated trade (P3 executed), and the preview discloses no rate source; the AI/MCP edit path re-resolves a stored rate (A26-S12-03). Client half S19. |
| MON-M29 | `FIXED_VERIFIED` (create and preview) | DTO `@IsPositive()` on `exchangeRate`, inherited by the update DTO (`PartialType`); `resolveCashExchangeRateOrNull` throws on `<= 0` in both variants (`:743-751`); the cash leg reads a stored rate with `??` (`:835-837`); `acquisitionCost` treats `<= 0` as unknown. Mutation M5 caught. Residual: `update()` writes a supplied rate on a same-currency row without the "same currency dominates" rule; reversed (inverted) rates are accepted without a tolerance against the market (section 9). |
| MON-M30 | `FIXED_VERIFIED` (backend) | `acquisitionCost` includes commission and prefers the stored total, which includes it (`investment-replay.util.ts:376-418`); used by the holdings fold, `getHoldingAt`, the lots replay, realized gains and `applyTxToState`; a sale's commission reduces `total_amount` (`investment-amount.util.ts:55-56`) and so the proceeds. Mutation M4 caught by 13 tests. The UI wording half is S19/S20's; the docstring of `calculateRealizedGains` (`portfolio-calculation.service.ts:1243-1248`) still says that replay omits the commission (section 11). |
| MON-M35 | `STILL_OPEN` (A26-S12-04) | Fixed in `calculateCostBasisLotsInAccountCurrency` only; realized gains and the two capital-gains folds still price `TRANSFER_IN` at quantity x carried price x 1 (P5 executed: 918.00 versus 548.00). |

## 6. Mutation table

All in the scratch worktree `<scratchpad>/mut` at `AUDIT_BASELINE_SHA`, applied with `perl`, the suite run, the file restored with `git checkout` after each row (`<scratchpad>/mutate.sh`, `mutate2.sh`). Unit runs `TZ=UTC npx jest <pattern>`; integration runs `--runInBand`.

| ID | Invariant | Mutation (file:line, what) | Test that fails | Verdict |
| --- | --- | --- | --- | --- |
| M1 | INV-HOLDING-001 | `common/db/locks.ts:165` `lockHoldingScope` returns `Promise.resolve()` | `holding-concurrent-trades` "does not lose an update" and scratch R3 (2 of 2) | covered |
| M2 | INV-HOLDING-002 | `investment-replay.util.ts:104` drop the `quantity > 0` SPLIT guard | `applyActionToQuantity` "leaves the position alone for a zero or negative ratio" | covered |
| M2b | INV-HOLDING-002 | `holdings.service.ts:553-555` SPLIT branch scales `totalCost *= quantity` | "rebuilds correctly when a SPLIT is between buys (preserves cost basis)"; `investment-replay.guard` "has no SPLIT branch that computes a quantity itself" | covered |
| M3 | INV-TRADE-001 | `investment-transactions.service.ts:4615-4617` `quantityChanged` keyed on presence | "keeps the stored total when a resent edit changes only the description" | covered (unit) |
| M4 | MON-M30 | `investment-replay.util.ts:414, 417` ignore the stored total and drop the commission | 13 tests (`investment-replay`, `holdings.service`, `portfolio-calculation`) | covered |
| M5 | MON-M29 | `investment-transactions.service.ts:744` accept a supplied rate `<= 0` | "still throws for a non-positive supplied rate" | covered (unit; the DTO `@IsPositive()` also refuses) |
| M6 | daily change | `daily-change.util.ts:125` drop the stale-close age test | 4 tests (`daily-change.util`, `portfolio.service`, `securities.service`) | covered |
| M7 | negative caching | `security-price.service.ts:1999` remember an empty window without `answered` | "does not remember an empty window the provider never answered" | covered |
| M8 | INV-PRICE-001 | `security-price.service.ts:828` skip the per-security check in the group refresh | "prices the members a group answer fits although the representative refuses it" | covered |
| M10 | INV-HOLDING-001 | `investment-transactions.service.ts:4477` drop `update()`'s first-statement `lockHoldingScope` | unit: "update takes the holdings advisory lock before its first row lock or write" (mock call order) | covered (unit only) |
| M10i | INV-HOLDING-001 | same as M10 | none: `investment`, `holding`, `security-transfer` integration suites 63/63 green | **undetected at integration level** (the rebuild re-takes the lock later; only lock order and A26-S12-01's window change) |
| M11 | INV-FX-001 | `investment-transactions.service.ts:789-792` remove the `getLatestRate` fallback (the fix of A26-S12-02) | 6 unit tests, among them "converts cash amount using the latest market rate when currencies differ" | **known-wrong tests**: they assert the defect (section 10) |
| M12 | transfer basis | `investment-transactions.service.ts:2371` use the client `costPerShare` | unit "carries the source holding's average cost, ignoring the client value" | covered (unit only) |
| M12i | transfer basis | same as M12 | none: `security-transfer`, `holding-ledger-projection` 17/17 green | **undetected at integration level** |
| M13 | INV-HOLDING-001/002 | `holdings.service.ts:585` snap threshold 0.0001 -> 1e-8 (the fix of A26-S12-06) | none: 193/193 green | **undetected**: no test pins the threshold either way (A26-S12-06 missing case) |
| R1 | INV-BALANCE-001 | none (baseline): double-submitted edit | scratch R1 fails (2 rows, 97,800.00) | defect demonstrated (A26-S12-01) |
| R2 | INV-BALANCE-001 | none (baseline): edit racing delete | scratch R2 fails (orphan -1,100.00) | defect demonstrated (A26-S12-01) |
| R3 | INV-HOLDING-001 | none (baseline): two BUYs plus rebuild | scratch R3 passes | mechanism holds |

## 7. Counterexamples and the interaction scenario

| Invariant | Counterexample (not copied from the tests) | Result |
| --- | --- | --- |
| INV-HOLDING-001 (concurrency) | A full rebuild queued between two BUYs, all three parked on the lock | Holds (R3: 30 @ 200.00) |
| Cash leg identity | The same edit submitted twice | Cash posted twice (R1: 97,800.00 for 98,900.00) |
| Cash leg identity | Edit then delete of one row | Orphan cash row (R2: -1,100.00 with no investment row) |
| Transfer basis | A transfer recorded with a date before a later purchase | +500.00 basis (P1: 3,500 for 3,000) |
| INV-HOLDING-002 | Two purchases each below the snap threshold | No holding (P2) |
| INV-FX-001 | A trade dated before the provider's coverage | Today's rate (P3: 1.37, cash -13,700.00) |
| INV-FX-002 | A description-only edit through MCP | Rate 1.40 -> 1.37, cash 1,149.27 -> 1,124.65 (P4) |
| MON-M35 | Transfer between two accounts of one currency, security in another | 918.00 versus 548.00 (P5) |
| INV-TRADE-001 | Form resends every field on a description edit | Holds (unit case; M3 caught) |
| SPLIT is a ratio | A non-positive ratio; a SPLIT between buys | Holds (M2, M2b caught) |

**Interaction scenario.** A26-S12-02 meets A26-S12-03 and A26-S12-01. A 1990 BUY was entered through the form with the broker's settlement rate 1.16. The user asks the assistant to correct only its description. The preview re-resolves the rate (A26-S12-03); `getRateForDate` finds nothing within 45 days of 1990-01-02 and the fallback answers today's 1.37 (A26-S12-02); the card shows a new cash figure and no rate line; on confirmation `update()` writes 1.37 and re-creates the cash leg: for 10,000.00 USD the cash moves from -11,600.00 to -13,700.00 CAD. If the user also saves the same row from the form while the assistant's request is in flight, the form's request uses its pre-lock snapshot of the cash leg id and the two requests leave two cash rows (A26-S12-01). Each mechanism alone (the row's own rate, the 45-day resolver, the holdings lock) is correct; the preview-as-create and the snapshot are what combine them. Re-checked against the code after the mutations: the path holds (`previewUpdateInvestmentTransaction` `:1891-1929` -> `previewCreateInvestmentTransaction` `:1780-1787` -> `resolveCashExchangeRateOrNull` `:780-793`; commit `mcp/tools/investments.tool.ts:869-881`).

## 8. Rejected hypotheses

| Candidate | Evidence considered | Why rejected or downgraded | Final classification |
| --- | --- | --- | --- |
| S01 hand-off: `security-price.service.ts:2364, 2432` write prices outside `refuseForeignCurrency` | `upsertTransactionPriceInner` and `backfillTransactionPrices` average the row's own `price` | For app-created rows the price is in the security's currency by construction (the cash leg converts out of it, `:838-850`), so these writers are not provider answers; for Money-imported cross-currency rows it is not, which is A26-S12-09 | Downgraded: REJECTED for app-created rows, CONFIRMED_WITH_DIFFERENT_ROOT_CAUSE as A26-S12-09; `write-prices.ts`, `bond-price.service.ts`, `demo-seed.service.ts` are S09/S14's |
| MON-H08 rebuild racing a trade | `rebuildFromTransactions` takes the lock before its ledger read | Executed R3; M1 caught | REJECTED (fixed) |
| Deutsche Boerse caches a `null` currency after a transport failure (`deutsche-boerse-finance.service.ts:229-266`) | A failed currency lookup is cached as `null`, which makes the quote "provider-silent" (accepted unverified) | TTL is 60 s (`:46`); a mis-recorded currency would also need to coincide with the failure window | DESIGN_RISK (minor) |
| MSN instrument-id negative cache poisons lookups for 24 h | `msn-finance.service.ts:405-412` | Writes `null` only when `answeredSince` shows MSN answered | REJECTED |
| `getMonthOverMonthMovers` subtracts two closes outside `resolveDailyPriceChange` (`portfolio.service.ts:1445-1468`) | A period move, not a daily one | Not a daily-change surface; a stale feed shows a 0.00 percent month (section 9) | DESIGN_RISK |
| Embedded split row edited twice duplicates cash | `updateEmbeddedSplitParent` row-locks the parent and derives the delta from the locked amount (`:3130-3170`) | No separate cash row; last writer wins on the investment fields only | REJECTED |
| A26-S09-03 shape (sleeve credited minus the bank amount under the sleeve currency) on the app's own funding path | `resolveSettlementCurrencyPair` (`:635-660`) and `createCashTransactionInTransaction` (`:838-850`) convert from the security's currency to the funding account's with the trade's rate | The app's BUY/SELL funding leg is converted, not mirrored; the bank-to-sleeve cash transfer is S07's | REJECTED for `securities/` |
| A whole-entity save in `securities/` like A26-S07-07 | `update()` `:4731`, `updateLinkedTransfer` `:4004-4005`, `updatePrice` `security-price.service.ts:2585-2610`, `syncAccruedInterestCompanion` `:1060-1070` | Confirmed for `update()` (A26-S12-01) and `updateLinkedTransfer` (A26-S12-07); `updatePrice` saves a price row only a user edits (a lost concurrent manual edit, no money); the companion is saved under the redemption's lock path | `updatePrice`: DESIGN_RISK |

## 9. Design risks

- `update()` assigns a supplied `exchangeRate` directly (`investment-transactions.service.ts:4706-4707`), skipping the "same currency dominates" rule `create` applies (`:770-772`): a same-currency row edited through the API with `exchangeRate: 1.35` posts its cash x 1.35. The form does not offer the field for a same-currency pair (S19 to confirm). A reversed rate (CAD->USD supplied for USD->CAD) is accepted on every path without a tolerance against the market; same policy question as MON-H11.
- The preview returns an unrounded rate (`1.3699999999986299` in P4) while the row stores `NUMERIC(20,10)`; `roundFxRate` is not applied in `resolveCashExchangeRateOrNull`.
- Post-commit work in `create`/`update`/`remove` (SPLIT full rebuild, transaction-derived price, bond recompute) is best-effort and logged; a failure leaves a stale derived price row, not a wrong holding.
- A security's `currency_code` can be changed while it holds provider prices and trades in the old currency (`securities.service.ts:1071-1078` checks only bond links); the INV-PRICE-001 known gap (no currency on a price row) makes the old rows indistinguishable.
- `getMonthOverMonthMovers` has no age bound: a feed that stopped before `previousEnd` yields the same close on both sides and a 0.00 percent "move" instead of no figure.
- Quote refresh has no negative cache per security (`refreshPricesForSecurities`, `:873-986`): each refresh of a dead symbol costs one call per routed provider (Yahoo, then MSN autosuggest and quote). Model: 5 dead symbols x 3 calls x one refresh every 5 minutes of an open session = 180 calls an hour; bounded by the breaker and `QUOTE_FETCH_CONCURRENCY`; not demonstrated as an operational problem (Rule 6), so an optimization, not a finding.
- Yahoo retries 429/503 inside a held semaphore slot for up to 30 s (`yahoo-finance.service.ts:263-286`), so five throttled requests block the whole provider; a design choice documented in place.
- `updatePrice` (`security-price.service.ts:2579-2622`) reads the price row outside its write transaction and saves the whole entity.

## 10. Missing tests and known-wrong tests

Known-wrong (assert a defect and pass): `investment-transactions.service.spec.ts` "converts cash amount using the latest market rate when currencies differ", and with it the five other unit cases M11 names (they stub `getRateForDate` to null and `getLatestRate` to the answer), which hold the A26-S12-02 fallback in place.

Missing:
- No two-connection test for `update()` or `remove()` of an investment row (A26-S12-01); the lock in `update()` is held only by a mock-order unit case (M10, M10i).
- No integration test of a transfer's carried basis (M12i), of a back-dated transfer (A26-S12-05) or of a transfer edit that changes date or quantity.
- No test pins the 0.0001 snap either way (M13; A26-S12-06).
- No realized-gain test after a cross-currency transfer (A26-S12-04); the lots replay has one.
- No test that the AI/MCP edit keeps the stored rate (A26-S12-03).
- No two-currency Money fixture for investment rows (A26-S12-09, shared with S09).
- No undo test comparing the undo rebuild with `findLedgerDiscrepancies` (A26-S12-10).

## 11. Documentation inconsistencies

- `portfolio-calculation.service.ts:1243-1248` says the realized-gain replay omits the acquisition commission; it uses `acquisitionCost` and includes it.
- `investment-transactions.service.ts:666-672` documents the latest-rate fallback as precedence item 3, against INV-FX-001 and `backend/CLAUDE.md`.
- `docs/system-invariants.md` INV-HOLDING-001 known gap describes the update/remove snapshot as a scope problem only; the cash duplication (A26-S12-01) and the transfer-basis rule (A26-S12-05) are not recorded; its "transferSecurity reads the source position's carried cost before the transaction" names the race but not the as-of-date defect.
- `holdings.service.ts:562-563` says prices and `averageCost` are in the security's currency; Money-imported cross-currency rows are not (A26-S12-09).
- `portfolio-calculation.service.ts:785-791` states the transfer rule as if it held for the module; it holds for one of four replays (A26-S12-04).

## 12. Review ledger

- Pinned: `AUDIT_BASELINE_SHA` 72c59ec4; code diff against it empty at start; HEAD at final writing in section 1 and in the commit.
- Directories inspected: `backend/src/securities/` (core and providers), `backend/src/common/db/locks.ts`, `backend/src/currencies/exchange-rate.service.ts`, `backend/src/mcp/tools/investments.tool.ts`, `backend/src/ai/actions/ai-action-builder.service.ts`, `backend/src/action-history/action-history.service.ts`, `backend/src/import/mny/map/map-investments.ts` and `writers/write-investments.ts`, `backend/src/scheduled-transactions/scheduled-transactions.service.ts`.
- Files read in full: `investment-replay.util.ts`, `investment-amount.util.ts`, `daily-change.util.ts`, `holdings.service.ts`. `investment-transactions.service.ts` read 469-2970, 3818-5095 (the remaining 2970-3817 -- embedded status propagation, register reads, history, capital-gains and LLM shapes -- sampled at 3093-3200 only). `security-price.service.ts` read 330-2662 (1-330 is imports, types and constants; sampled).
- Sampled with ranges: `portfolio-calculation.service.ts` 280-340, 765-1004, 1230-1345; `portfolio.service.ts` 1290-1489; `yahoo-finance.service.ts` 150-330; `msn-finance.service.ts` 376-412; `deutsche-boerse-finance.service.ts` 225-270; `exchange-rate.service.ts` 916-1174; `mcp/tools/investments.tool.ts` 820-960, 1236-1280; `ai-action-builder.service.ts` 693-726; `common/db/locks.ts` 140-215, 395-475; `action-history.service.ts` 1850-1965; `scheduled-transactions.service.ts` 3930-4000; `securities.service.ts` 1060-1110, 1245-1300; `net-worth/position-price.util.ts` 20-60.
- Not reviewed: `portfolio.service.ts` valuation and FX aggregation (S13), `lse-finance.service.ts`, `market-index.service.ts`, `performance-comparison.service.ts`, `sector-weighting.service.ts`, `security-detail.service.ts`, `bond-*` (S14), the intraday series (INV-INTRADAY-001, S13), `provider-health/` beyond its use in Yahoo, the frontend (S19/S20).
- Searches: callers of `previewUpdateInvestmentTransaction` / `previewCreateInvestmentTransaction` / `create` / `resolveCashExchangeRateOrNull`; every holdings writer outside `holdings.service.ts`; `lockInvestmentTransactionRow` users; `applyActionToQuantity` users in `net-worth/`; the 0.0001 threshold across `securities/`; `resolveDailyPriceChange` / `keepNewestSession` consumers; `upsertTransactionPrice` callers; manual price routes' ownership checks (`securities.controller.ts:817-845`, held).
- Suites run: baseline 13 integration suites, 176 tests, green; scratch R1-R3, P1-P5 (6 fail as defects, R3 passes, see section 7); 16 mutation rows (section 6).
- Areas reviewed without a finding: the SPLIT reducer and its guards; commission in basis on every backend replay; non-positive rate refusal; `updateStatus` (row lock and advisory lock, VOID crossings mirror the cash leg); the provider currency checks on every provider write path read; the MSN negative cache; the Yahoo breaker door; the daily-change resolver and the movers board; manual price route ownership.

### Text for the orchestrator to merge (ledger, sessions, register)

- Session row: S12 `done`, 2026-10-21, findings B/H/M/L 0/1/6/3 (HIGH A26-S12-01; MEDIUM A26-S12-02, -03, -04, -05, -06, -09; LOW A26-S12-07, -08, -10); verdict REQUEST CHANGES.
- Suites: baseline integration `holding|investment|securit|price|trade` 13 suites, 176 tests, all pass; scratch race and probe spec (R1, R2 defects demonstrated; R3 mechanism holds; P1-P5 defects demonstrated); 16 mutations.
- Prior findings (final): MON-H08 `FIXED_VERIFIED`; MON-H14 server half `STILL_OPEN` (residual, A26-S12-02; client half S19); MON-M29 `FIXED_VERIFIED`; MON-M30 `FIXED_VERIFIED` (backend; UI wording S19/S20); MON-M35 `STILL_OPEN` (A26-S12-04).
- Program mutation table, undetected rows: `INV-HOLDING-001 | investment-transactions.service.ts:4477 drop update()'s lockHoldingScope | integration none (unit mock-order only) | S12`; `transfer basis | investment-transactions.service.ts:2371 client costPerShare | integration none (unit only) | S12`; `INV-HOLDING-001/002 | holdings.service.ts:585 snap 0.0001 -> 1e-8 | none | S12`; `INV-FX-001 | :789-792 remove getLatestRate fallback | six known-wrong unit tests fail | S12`; R1/R2 baseline defects (A26-S12-01).
- Hypotheses handed on: to S13, the realized-gain and capital-gains consumers of A26-S12-04 (built-in reports, AI/MCP `get_capital_gains`, tax figures) and the valuation of Money-imported cross-currency holdings (A26-S12-09, txFallback in `net-worth/position-price.util.ts`); to S09/S10 (import owners), the Money writer's price currency for cross-currency securities (A26-S12-09); to S17, the AI/MCP edit card shows no exchange-rate line (A26-S12-03); to S19, the form's rate source on a back-dated trade, the transfer `costPerShare` field and whether the form offers a rate on a same-currency pair (section 9); to S21, A26-S12-01's missing two-connection tests and the M10i/M12i/M13 rows join MON-M46 and the program mutation table; to the INV-HOLDING-001 index entry owner (S23), the known-gap text (section 11).
- Deviations: run as a parallel child session; `ledger.md`, `sessions.md` and `prior-findings-register.md` not edited (this section carries their text); `dockerd` started by hand; PostgreSQL started with `docker run` rather than `docker compose`; `investment-transactions.service.ts` 2970-3817 and `security-price.service.ts` 1-330 sampled, not read in full; provider services sampled at the ranges above.

## 13. Adversarial approval challenge

Started from the slice's own abstractions, not the findings: "the holding is a projection" (`rebuildScopesFromTransactions`, `projectedHoldingRow`), "the executed total is the fact" (`resolveInvestmentAmounts`), "the settlement pair" (`resolveSettlementCurrencyPair`), "a preview is the commit's code", "a provider price is checked per security" (`refuseForeignCurrency`), "a daily move needs a current close".

- Is the holding written anywhere else? Searched every `holdings` writer: `action-history.service.ts:1858-1966` keeps a second fold (A26-S12-10); `demo-seed.service.ts:914` writes holdings directly for the demo user (outside scope, demo data); restore is S06's.
- Does any write decide from a value read before its lock? `update()`, `remove()` (A26-S12-01), `updateLinkedTransfer` (A26-S12-07), `transferSecurity`'s `carriedCost` (A26-S12-05); `updateStatus` is clean.
- Does the preview resolve anything the commit then trusts as user input? The rate (A26-S12-03); the series and the redemption split are resolved by the same code on both sides (held); the total and price go through `resolveInvestmentAmounts` on both sides (held).
- Is a rate struck after the trade reachable? Yes (A26-S12-02), on create, preview, update with a pair change, the embedded split path (`:2744-2751`) and the scheduled posting (which calls `create`).
- Is the security's currency the only currency a price row can be in? Not for Money-imported cross-currency trades (A26-S12-09).
- Does every replay apply the transfer rule? No (A26-S12-04); does every replay snap at the same threshold? No (A26-S12-06).
- Unchanged callers: bulk create loops `create` per row (inherits A26-S12-02); the MCP bulk update loops `update` with preview rates (inherits A26-S12-03); the scheduled post calls `create` with its stored rate when the pair matches (held) and resolves fresh otherwise (inherits A26-S12-02, low exposure because the post date is near today).

Result: the challenge found A26-S12-09 and A26-S12-10 and no reason to withdraw any earlier finding.

## 14. Verdict

**REQUEST CHANGES** for `backend/src/securities/` at `72c59ec4`.

Confirmed: BLOCKER 0, HIGH 1 (A26-S12-01, executed), MEDIUM 6 (A26-S12-02 to -06 executed; A26-S12-09 by reading), LOW 3 (A26-S12-07, -08, -10, by reading). Independently verified: the holdings lock under two concurrent trades and a rebuild (MON-H08 fixed), the SPLIT reducer, commission in basis, non-positive rate refusal, the per-security provider currency checks, the stale-close rule and the empty-window memory (mutations M1-M8 caught). Limitations: no frontend round trip (S19), valuation and FX aggregation left to S13, the provider services sampled. The adversarial close-out pass was completed (section 13).
