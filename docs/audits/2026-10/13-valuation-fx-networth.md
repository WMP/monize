# S13 Valuation, FX, Currencies, Net Worth, Investment Reports, Monte Carlo

## 1. Metadata

| Field | Value |
| --- | --- |
| Session | S13 (parallel wave; run directly by the orchestrator's assignment, not picked from the ledger) |
| `AUDIT_BASELINE_SHA` | `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86` |
| `git rev-parse HEAD` at start | `d8fd873b0d864cb270b1d05593110dd27191cfac` (pin check of plan step 2: empty diff outside `docs/audits/`) |
| Date | 2026-10-21 |
| Primary path | `backend/src/currencies/` |
| Hint line used | `prioritize rate 1 versus no rate on every surface (dashboard, reports, exports, AI, MCP, notifications, frontend), rate age bounds and never a rate struck after the date, pair orientation in storage and on read, FxAggregate with null total and knownSubtotal, fxComplete and pricesComplete carried to every consumer including the LLM shape, the multiplicative split in historical net-worth replay, Monte Carlo failure never a real zero, bulk deletion versus linked-account snapshots, custom-currency global cleanup from tenant-filtered evidence, a period change is not a return, cash is not an investment` |
| Status | Status: in-progress, remaining: mutation table execution, unit suite batch, sections 6-14 final text |
| Runtime executed | Node 24.22.1 (`nvm use 24`); `npm ci` OK in `backend/`. PostgreSQL 16 in Docker (`mirror.gcr.io/library/postgres:16-alpine`, `dockerd` started by hand). Baseline integration: `rls-enforcement`, `fx-rate-coverage`, `portfolio-movement-flow`, `portfolio-tag-keys`, `report-investment-cash`, `invested-capital-flow`, `scheduled-investment-split-fx`, `fx-fee-summary`, `bond-holding-value`: 9 suites, 110 tests, all pass. One scratch probe spec (P1-P5, six cases) in a worktree at the baseline: every case reproduces a defect (section 7). `database/schema.sql` loaded into a scratch database for the foreign-key replay of P1. No `net-worth*`, `currenc*` or `exchange*` integration suite exists (section 10). |

## 2. Invariant map

| ID | Statement (short) | Mechanism named at the baseline | Producer -> transformations -> storage -> consumers -> side effects |
| --- | --- | --- | --- |
| INV-FX-001 (partial) | A missing rate is unknown, never 1; no rate struck after the date; none older than `FX_MAX_RATE_AGE_DAYS` (45) | `resolveFxRate` (`common/time-series/fx-rate-resolver.ts:311-402`), `FxAggregate` (`common/fx-aggregate.ts`), `fx-fallback.guard.spec.ts`, `fx-rate.one-door.spec.ts` | provider chain -> `canonicalRateRow` -> `exchange_rates` -> `resolveStoredRate` / `getRateForDate` / `getLiveRate` (bounded) and `getLatestRate` / `getLatestRates` (unbounded by default) -> portfolio, net worth, reports, frontend hook, AI/MCP `calculate` -> post-commit nothing |
| INV-FX-002 | A row carrying its own rate converts at that rate | `investment-transaction-summary.service.ts` `usableRowRate`; folds multiply `total_amount * exchange_rate` | row rate -> realized gains, capital gains, transaction history |
| INV-FX-003 (partial) | One orientation per pair and date | `canonicalRateRow` in every writer, `exchange-rate-orientation.guard.spec.ts`; the contract migration (CHECK) not shipped | writers canonical since 1.17.0 (PR #1421); pre-1.17 mirror rows still stored; readers: `resolveFxRate` (newest direction wins), `convertWithRateLookup` / frontend `convert` (direct first) |
| INV-FX-004 | A user's rate never rewrites global history | `ON CONFLICT DO NOTHING` in `write-prices.ts` | not re-audited (S09 owns the writer); read side unaffected |
| INV-FX-005 | A stored rate names its provider; outage is not empty | `FxProviderChain`, `EmptyWindowMemory` (30 min, 2000 entries) | sampled; no finding |
| INV-CURRENCY-001 | A shared currency is deleted only when nothing anywhere references it | `currency_code_in_use_globally` SECURITY DEFINER (`database/schema.sql:4294-4318`), creator gate (`currencies.service.ts:446`), `FOR UPDATE` on the parent (`:402`), `currency-references.spec.ts` | `DELETE /currencies/:code` -> `removeWithin` -> per-user check (`currency_codes_referenced_by_user_data`, INVOKER) -> delete own preference -> global check -> delete row |
| (server-authoritative, unnamed) | A tenant request does not create global reference data offered to others | `ensureCatalogCurrency` inactive for bonds only; FK `user_preferences.default_currency -> currencies(code)` | MNY import (S09-06), preferences, `POST /currencies`, user deletion (`created_by_user_id ON DELETE SET NULL`) -> `findAll` lists `created_by_user_id IS NULL` to everyone |
| INV-HOLDING-002 (replay half) | SPLIT multiplies by its ratio on every replay | `applyActionToQuantity` (`securities/investment-replay.util.ts`), `investment-replay.guard.spec.ts` | ledger -> `foldDailyInvestments` / `foldInvestmentBreakdown` / `recalculateBrokerageAccount` -> `monthly_account_balances.market_value` -> net-worth series |
| INV-PORTRESULT-001 / 002 | A period change is not a return; cash is not an investment | `decidePeriodResult`, `PortfolioPeriodResultService` (status `enforced`) | sampled (section 12); no finding |
| INV-PORTMOVE-007 / 008 | A flow at its own day's rate; a late close restates the baseline | `portfolio-movement.util.ts` `decideMovement`; baseline only from a complete value | `portfolio-movement-flow.integration.spec.ts` passed; no finding |
| INV-PORTCHART-001, INV-INTRADAY-001 | Chart boundaries on their figures' closes | not re-read beyond the rate index (`buildDailyRateIndex`) | sampled; no finding |
| INV-CACHE-001 | A money-moving write invalidates derived state after commit | `triggerDebouncedRecalc` after `withScopedDb`, 30-minute `sweepStaleSnapshots` keyed on `accounts.updated_at` | bulk delete, single delete, transfers, VOID, undo (no dispatch; sweep only) |
| INV-BOND-010 | A bond holding's value is its own account's lots | `valueBondHoldings` in `getAccountMarketValues` and the summary | Monte Carlo weights and `getHoldingStats` read `getLatestPrices` (S01 hand-off; section 9) |
| INV-DISPLAY-001 | A figure in the reader's number locale | `common/number-locale.util.ts` | sampled; no finding in the slice |
| Financial contract section 1 | A total is `null` unless complete; the partial sum in its own field; a completeness flag is read where the figure is shown | `FxAggregate.total`; `valuationComplete` on the portfolio summary | portfolio summary (held), net-worth monthly series (flags as subtotal markers), latest net worth (flags dropped), account market values (no flags) |
| Monte Carlo (MON-M33) | A failed valuation is never a real zero | `computeCurrentValue` returns `null` on `!valuationComplete` or a throw; `requireCurrentValue` refuses | `runSaved` / `runAdHoc` -> 400; `getHistoricalStats.currentBalance: null` -> frontend `useMonteCarloScenarios.ts:251` |

## 3. Lens ledger

| Lens | Status |
| --- | --- |
| Repository instructions first | ran: `AGENTS.md`, root, `backend/`, `database/` `CLAUDE.md`, `docs/system-invariants.md` entries above, `docs/time-series-contract.md` sections 2-2.2, `docs/specs/exchange-rate-canonical-orientation.md` sections 1, 8, 9, the `/audit` protocol |
| Summaries as hypotheses | ran: every S02/S09/S12/S01/S10 hand-off re-derived from code; four read-only sub-agent sweeps re-checked at the cited lines before use |
| Invariant model | ran (section 2) |
| Change surface / producer-consumer | ran: every `convertAmount` / `tryConvertAmount` / `convertWithRateLookup` call site (20 / 4 / 3), every `getLatestRate` / `getLatestRates` / `getLatestPrices` caller, every completeness-flag producer and consumer (backend, AI executor, MCP tools and resources, frontend types and components), every `ensureSystemCurrency` caller |
| Calibration Rule 4 (semantic migration) | ran: `fxComplete` beside `netWorth` (monthly series) versus the old scalar read by `getLatestNetWorth`, `month_comparison`, the accounts summary; A26-S13-04 |
| Calibration Rule 5 (dependency mutation matrix) | ran: the rate table (cron refresh, manual refresh, gap fill, MNY import, `getRateForDate` fill) -> net-worth snapshots (re-read at query time, rates not persisted in snapshots) and the client rate map (fetched once per mount); the orientation change of 1.17.0 is the mutation channel nobody invalidated (A26-S13-02) |
| Cross-layer verification | ran: rate table -> `/currencies/exchange-rates` -> `useExchangeRates` -> components; preferences DTO -> service -> FK; report service -> AI/MCP `generate_report` |
| Representation boundary | ran: `null` / 0 / 1 for rates; empty currency code (`convertWithRateLookup` `!from`); `?? 0` for net worth and brokerage balance; absent flags in `MonthlyNetWorth` |
| Browser/UI round trip | ran narrowly: onboarding currency picker -> `updatePreferences` (A26-S13-05); the embedded investment split's rate prefill from the hook handed to S19 |
| Server-authoritative metadata | ran: currency codes from DTOs and files (A26-S13-06, S09-06 surfaces), client-sent split rate (handed to S19) |
| Identity versus value | ran: split-transfer leg identity in bulk delete (A26-S13-03); pair identity across two stored orientations (A26-S13-02) |
| State machine | not applicable as a lens of its own because the slice has no lifecycle beyond currency active/inactive/deleted, which the INV-CURRENCY-001 row covers |
| Concurrency and idempotency | ran: currency delete versus concurrent activation (two-connection integration test passed); preferences merge lock; no new race executed |
| Partial failure and compensation | ran: provider fetch inside `getRateForDate` (persist then re-resolve), post-commit net-worth dispatch (in-process timer plus 30-minute sweep) |
| External provider lookup | ran: `getRateForDate` provider window per miss (no negative cache on that path; `EmptyWindowMemory` on `ensureRatesForDate` and gap fill), Yahoo `carries` true for any code (junk codes requested on every refresh, section 9) |
| Database and migration | ran: FKs to `currencies(code)`, `currency_code_in_use_globally`, the entity harness's missing `ON DELETE` actions (section 10) |
| Backup/restore | not applicable beyond the currency cleanup call, which S06 audited (`backup-restore-database.service.ts:361-366` uses the same definer function) |
| Financial lens | ran with numerical examples for every financial finding |
| Authorization/RLS | ran: SECURITY DEFINER versus INVOKER functions, `findAll` visibility, `GET /currencies/:code` exposure (A26-S13-06) |
| Tests are evidence | ran: known-wrong tests and harness parity (section 10) |
| Mutation | ran (section 6) |
| Counterexamples and interaction | ran (section 7) |
| Rejected hypotheses | ran (section 8) |
| Suggested diffs | written for every confirmed finding |
| Adversarial approval challenge | ran (section 13) |

## 4. Confirmed findings

Severity order. Causality classes are plan section 3.

### A26-S13-01 - Built-in reports convert a missing exchange rate 1:1 and label the result in the reporting currency (MON-H12 and MON-M39 still open; supersedes A26-S02-02)

1. **Severity:** HIGH
2. **Confidence:** high (executed, P2; the known-wrong unit test passes)
3. **Location:** `backend/src/built-in-reports/report-currency.service.ts:99-121` (`convertAmount` returns `amount` when `convertWithRateLookup` is null); `backend/src/common/currency-conversion.util.ts:20-22` (`!from` returns the amount as if same-currency). Call sites (20 in 13 methods, 7 services): `income-reports.service.ts:206`; `anomaly-reports.service.ts:111, 128, 221, 307, 317`; `monthly-category-breakdown.service.ts:167, 173, 315, 321`; `comparison-reports.service.ts:100, 106, 204`; `spending-reports.service.ts:329, 431`; `tax-recurring-reports.service.ts:202, 360, 555`; `data-quality-reports.service.ts:117, 197, 204` (row and summary labelled `currencyCode: defaultCurrency`, `:123`, `:219`). Allowlisted at `common/fx-fallback.guard.spec.ts:84-101`.
4. **Violated invariant:** INV-FX-001 (both clauses: no 1:1 value, no unconverted amount under the target label); `AGENTS.md` "Convert before summing", "A subtotal is not a total".
5. **Reproduction:** default currency USD, a JPY card with one expense of -100,000 JPY on 2026-09-15, no JPY rate stored. Call Spending by Payee and Uncategorized Transactions for September 2026 (HTTP, AI `generate_report`, MCP `generate_report`).
6. **Observed (executed, P2):** `{"data":[{"payeeName":"Shop","total":100000}],"totalSpending":100000}` and the data-quality row `{"amount":-100000,"currencyCode":"USD", ...}` with `summary.expenseTotal: 100000, currencyCode: "USD"`. No field says a currency was not converted. `report-currency.service.spec.ts:213` "returns original amount when no rate is available" asserts the defect and passes (S02 batch; re-run in section 12).
7. **Expected:** the figure converted (about 670 USD at 0.0067), or the total `null` with `knownSubtotal`, `missingCurrencies: ["JPY"]` and `excludedCount: 1`, as Spending by Category and Income vs Expenses already answer (`spending-reports.service.ts:196-263`).
8. **Impact:** +99,330 USD (about 14,800 percent) in the example; every report family named above, including the tax summary (`getTaxSummary`), year-over-year comparison and anomaly detection (a JPY row is a z-score outlier by the currency's unit), reaches the reader, the assistant and an MCP client as a settled figure. Spending anomalies are also called with `months` where the signature expects the z-score threshold (`ai/query/tool-executor.service.ts:2910-2913`, `mcp/tools/reports.tool.ts:86-89` versus `anomaly-reports.service.ts:37-39`); handed to S16/S17, not part of this finding.
9. **Root cause:** `convertAmount` has a `number` signature shared by seven services, so the null branch cannot be expressed; the guard allowlists the pass-through instead of failing it; `convertWithRateLookup` treats an empty source code as the reporting currency.
10. **Recommended correction:** return `number | null` from `convertAmount` (or delete it in favour of `tryConvertAmount`), accumulate every report total through `FxAggregate`, give each report DTO `missingCurrencies` and `excludedCount` as the two converted families do, drop the allowlist entry, and make `!from` unknown.
11. **Suggested remediation diff: incomplete.** Supported part:

```diff
--- a/backend/src/built-in-reports/report-currency.service.ts
+++ b/backend/src/built-in-reports/report-currency.service.ts
@@ -99,23 +99,11 @@
-  convertAmount(
-    amount: number,
-    fromCurrency: string,
-    defaultCurrency: string,
-    rateMap: RateMap,
-  ): number {
-    // Flat latest-rate lookup; the direct/inverse decision is shared with
-    // net worth via convertWithRateLookup so the two surfaces stay consistent.
-    const result = convertWithRateLookup(
-      amount,
-      fromCurrency,
-      defaultCurrency,
-      (f, t) => rateMap.get(`${f}->${t}`),
-    );
-    if (result == null) {
-      // M30: Log warning when no conversion rate is found instead of silently returning unconverted amount
-      this.logger.warn(
-        `No exchange rate found for ${fromCurrency} -> ${defaultCurrency}, returning unconverted amount`,
-      );
-      return amount;
-    }
-    return result;
-  }
+  // convertAmount is removed: every caller takes tryConvertAmount, excludes a
+  // row it cannot convert and reports it (INV-FX-001).
--- a/backend/src/common/currency-conversion.util.ts
+++ b/backend/src/common/currency-conversion.util.ts
@@ -20,3 +20,6 @@
-  if (!from || from === to) {
+  // An empty code is not the reporting currency; it is unknown.
+  if (!from || !to) return null;
+  if (from === to) {
     return amount;
   }
--- a/backend/src/common/fx-fallback.guard.spec.ts
+++ b/backend/src/common/fx-fallback.guard.spec.ts
-  const RETURNS_ITS_INPUT_UNCONVERTED = [ { file: "built-in-reports/report-currency.service.ts", ... } ];
+  const RETURNS_ITS_INPUT_UNCONVERTED: ReadonlyArray<{ file: string; reason: string }> = [];
```

   Missing: each of the 20 call sites moves to `tryConvertAmount` plus `FxAggregate` (the pattern at `spending-reports.service.ts:196-263`), each report DTO and frontend view gains the partial state, and the MCP output schemas (`mcp/tool-output-schemas.ts:197-213`) declare the fields. The per-report policy (exclude the row, or withhold the report) is the maintainer's decision; the empty-code change needs a check that no caller passes an empty code for a real same-currency row (the `report` spec named by S02).
12. **Recommended regression test:** per report family, one account in a currency with no rate: total `null`, known subtotal set, `missingCurrencies` names it; a source scan that no file under `built-in-reports/` calls `convertAmount`.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
--- a/backend/src/built-in-reports/report-currency.service.spec.ts
+++ b/backend/src/built-in-reports/report-currency.service.spec.ts
-    it("returns original amount when no rate is available", () => {
+    it("answers null, never the input, when no rate is available (INV-FX-001)", () => {
       const result = service.tryConvertAmount(1000, "JPY", "USD", new Map());
-      expect(result).toBe(1000);
+      expect(result).toBeNull();
     });
+--- a/backend/src/built-in-reports/spending-reports.service.spec.ts
++  it("withholds Spending by Payee when a JPY row has no rate", async () => {
++    // one -100000 JPY row, default USD, empty rate map
++    const res = await service.getSpendingByPayee(userId, "2026-09-01", "2026-09-30");
++    expect(res.totalSpending).toBeNull();
++    expect(res.missingCurrencies).toEqual(["JPY"]);
++  });
```

14. **Verification:** `npm run test:unit -- report-currency built-in-reports fx-fallback.guard`; P2 re-run must show `totalSpending: null`; the report views (S20).
15. **Residual risks:** the rate the reports convert at is the unbounded latest rate in a direct-first map (A26-S13-02); fixing the 1:1 half alone leaves those figures valid-looking and wrong.

- Causality: `PRIOR_REPORTED`, `CONFIRMED` (MON-H12 on the reports surface, MON-M39's wrong test relocated). Supersedes A26-S02-02 (same root cause, surfaces extended to AI/MCP and the empty-code branch).
- Surfaces (Rule 7): HTTP built-in reports (7 services), AI `generate_report` (`tool-executor.service.ts:2910-2980`), MCP `generate_report` (`reports.tool.ts:86-143`); no email, notification or export consumer exists (searched).

### A26-S13-02 - Direct-first readers of the latest-rate table use a frozen pre-1.17 mirror row and a rate of any age (INV-FX-003 expand window, INV-FX-001 age clause)

1. **Severity:** HIGH
2. **Confidence:** high for the behaviour (executed, P3, P3b); medium for the severity, which grows with the time since a deployment upgraded to 1.17.0 and with the currency's move since.
3. **Location:** `backend/src/currencies/exchange-rate.service.ts:916-927` (`getLatestRates`: `DISTINCT ON (from, to)`, newest per stored direction, no age bound), served by `currencies.controller.ts:137-147`; readers that try the direct key first: `frontend/src/hooks/useExchangeRates.ts:79-101` (`convert`), `:111-120` (`getRate`), `:159-178` (`convertWithRateMap`), `backend/src/built-in-reports/report-currency.service.ts:64-121` through `common/currency-conversion.util.ts:28-36`.
4. **Violated invariant:** INV-FX-003 ("resolveFxRate answers with the more recently observed direction ... an old direct row must not block a fresh inverse one", `fx-rate-resolver.ts:23-25`); INV-FX-001 ("nor by one older than FX_MAX_RATE_AGE_DAYS"); `docs/time-series-contract.md` section 2.1 (a `DISTINCT ON` newest read with no lower bound used in a reported figure).
5. **Reproduction:** a deployment that ran a release before 1.17.0 stored every fetched pair twice (`docs/specs/exchange-rate-canonical-orientation.md` section 1). From 1.17.0 the refresh writes only the canonical orientation (`from < to`), so for a user whose reporting currency sorts before the foreign code (CAD with USD, EUR with USD/GBP/PLN, PLN with USD) the direction the readers ask first (`USD->CAD`) stops updating at the upgrade, while `CAD->USD` is refreshed daily. Scripted: `USD->CAD 1.3000` and `CAD->USD 0.7142857143` on 2026-08-01, `CAD->USD 0.7142857143` (1.4000) today; default CAD, a USD expense of -1,000.00 in September.
6. **Observed (executed, P3):** `getLatestRate("USD","CAD")` = 1.399999999972 (the resolver picks today's inverse row); `getLatestRates()` returns `[CAD->USD 2026-10-21, USD->CAD 2026-08-01]`; Spending by Payee answers `totalSpending: 1300`. The frontend `convert(1000, "USD", "CAD")` over the same endpoint returns 1,300.00 by the same direct-first rule (`useExchangeRates.ts:85-86`). P3b: with only a `CAD->USD 0.8` row dated 2025-12-01 (324 days old), the report answers 1,250.00 as a current figure.
7. **Expected:** one answer per pair, the one `resolveFxRate` gives (1,400.00 CAD); a pair whose newest observation is older than 45 days is unknown (P3b: `null` and the pair named).
8. **Impact:** every client-side conversion (accounts page and account-group totals, investments holdings and portfolio card rate lines, currency exposure, currency list, security summary) and every built-in report converts at the upgrade-day rate for about half the pairs, forever, until the contract migration of INV-FX-003 ships (which the spec says cannot ship until the expand release is everywhere). In the example -100.00 CAD (7.1 percent) on 1,000 USD; on a 100,000 USD portfolio a 3 percent move since the upgrade is 3,000 CAD, and the server-side portfolio summary on the same screen (resolver) shows the other figure. The embedded investment split prefills `exchangeRate` from `getRate` (`frontend/src/components/transactions/InvestmentSplitFields.tsx:118-140`), so the frozen rate can be sent as the trade's own settlement rate (persisted path handed to S19 for confirmation). P3b's stale branch also applies to a pair whose refresh silently stopped (a provider dropped the pair).
9. **Root cause:** the expand release made writers canonical and assumed every reader was inverse-aware (spec section 8: "already fall back to the inverse key, so receiving one orientation per pair needs no change"); the readers are inverse-aware only when the direct key is absent, and `getLatestRates` hands them both orientations with different dates and no age bound.
10. **Recommended correction:** make `getLatestRates` answer one row per directionless pair through `resolveFxRate` in `live` mode (newest admissible direction, 45-day bound, canonical orientation in the payload), so the client and the report map receive one orientation and no stale row; give the frontend `convert` the same rule (prefer the newer of the two keys) as a defence while old clients are served.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/currencies/exchange-rate.service.ts
+++ b/backend/src/currencies/exchange-rate.service.ts
@@ -913,15 +913,38 @@
   /**
-   * Get the latest exchange rates (most recent per currency pair)
+   * The current rate per pair, one row per directionless pair, in canonical
+   * orientation: the newer of the two stored directions inside the age bound
+   * (resolveFxRate, live mode). Both orientations used to be returned with
+   * their own dates, and every direct-first reader took a mirror row frozen at
+   * the 1.17.0 upgrade over today's canonical row (INV-FX-003).
    */
   async getLatestRates(): Promise<ExchangeRate[]> {
-    return withScopedDb(this.dataSource, (manager) =>
+    const today = todayYMD();
+    const rows = await withScopedDb(this.dataSource, (manager) =>
       manager
         .getRepository(ExchangeRate)
         .createQueryBuilder("er")
         .distinctOn(["er.from_currency", "er.to_currency"])
+        .where("er.rate_date >= :floor", {
+          floor: addDaysYMD(today, -FX_MAX_RATE_AGE_DAYS),
+        })
         .orderBy("er.from_currency")
         .addOrderBy("er.to_currency")
         .addOrderBy("er.rate_date", "DESC")
         .getMany(),
     );
+    const byPair = new Map<string, ExchangeRate>();
+    for (const row of rows) {
+      const key = directionlessPairKey(row.fromCurrency, row.toCurrency);
+      const held = byPair.get(key);
+      if (!held || String(row.rateDate) > String(held.rateDate)) {
+        byPair.set(key, row);
+      }
+    }
+    return [...byPair.values()];
   }
```

   Needs: `directionlessPairKey` from `canonical-rate.util.ts`, the controller's Swagger text, a tie rule identical to the resolver's (direct wins a tie, so the canonical row should be returned when both share a date), and the frontend `convert` change for clients cached before the deploy.
12. **Recommended regression test:** an integration case with a stale mirror row and a fresh canonical row asserting one row per pair carrying the fresh rate; a report case asserting 1,400.00; a row older than 45 days absent from the payload.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+  it("returns one current row per pair, never a frozen mirror (INV-FX-003)", async () => {
+    await insertRates([
+      ["USD", "CAD", 1.3, "2026-08-01"],
+      ["CAD", "USD", 0.7142857143, "2026-08-01"],
+      ["CAD", "USD", 0.7142857143, todayYMD()],
+    ]);
+    const rows = await fx.getLatestRates();
+    expect(rows).toHaveLength(1);
+    expect(rows[0]).toMatchObject({ fromCurrency: "CAD", toCurrency: "USD" });
+  });
```

14. **Verification:** P3 and P3b re-run; `npm run test:unit -- exchange-rate useExchangeRates report-currency`; a frontend test of `convert` with both keys present.
15. **Residual risks:** the built-in reports still convert a past period at today's rate (a deliberate "flat latest-rate lookup", `report-currency.service.ts:105`), which is the look-ahead clause of INV-FX-001 for every historical bucket; that is a policy the maintainer has to state (section 9). The persisted-rate path through the investment split is S19's to confirm.

- Causality: `NEW_SINCE_UPSTREAM_AUDIT` (the canonical orientation shipped in 1.17.0, after `d5cea9bf`); the age half is `PRE_EXISTING_UNREPORTED` on the client.
- Surfaces (Rule 7): frontend `useExchangeRates` (`convert`, `getRate`, `convertWithRateMap`), built-in reports (A26-S13-01's call sites, also `tryConvertAmount` in the two converted families), `GET /currencies/exchange-rates` for any API client.

### A26-S13-03 - Bulk-deleting one leg of a split transfer deletes the parent but leaves the other legs, creating their money (MON-M34 residual on the bulk path)

1. **Severity:** HIGH
2. **Confidence:** high (executed, P4, against the schema's `ON DELETE` actions)
3. **Location:** `backend/src/transactions/transaction-bulk-update.service.ts:556-572` (a selected row's `linkedTransactionId` is queued; a split-transfer leg links to the split **parent**, whose own splits are never loaded, so its other legs are not collected), `:604-612` (reversal only of locked rows), `:621-639` (parent deleted; `transaction_splits` cascade, `database/schema.sql:404`; the surviving legs' `linked_transaction_id` set NULL, `:378`). The single path removes the sibling legs explicitly (`transaction-transfer.service.ts:1664-1692`).
4. **Violated invariant:** INV-BALANCE-001 (a balance equals its ledger and a transfer moves no money in total); `AGENTS.md` "A deletion reverses only what the row contributed" and "A refusal is only worth as much as its least-guarded entry point".
5. **Reproduction:** account A (1,000.00), B and C (0.00). A split withdrawal of -100.00 in A with two transfer lines: 60.00 to B and 40.00 to C. In B's register, select the 60.00 leg and bulk-delete it (`POST /transactions/bulk-delete`, `mode: "ids"`).
6. **Observed (executed, P4):** `{"deleted":1}`; balances A 1,000.00, B 0.00, C 40.00; the ledger holds one row, C's +40.00 transfer, with `linked_transaction_id: null`. The sum of the three balances is 1,040.00.
7. **Expected:** either the whole split transfer is removed (A 1,000.00, B 0.00, C 0.00, total 1,000.00), as the single-delete path does, or the selected leg is refused with the reason (a split leg is edited through its parent).
8. **Impact:** 40.00 created (40 percent of the transfer, 4 percent of the total held) per occurrence; C's balance agrees with C's ledger, so neither `recalculateCurrentBalance` nor the net-worth sweep repairs it, and every report and net-worth figure carries the orphan leg as a transfer with no source. The deletion of a split parent selected in bulk is handled (its legs are collected); the defect is only on the leg selection.
9. **Root cause:** the bulk path treats `linkedTransactionId` as "the other leg" for every row, which is true for a plain transfer and false for a split-transfer leg, whose link names the parent; the sibling expansion the single path performs was not ported (the P5-012 fix added accounts, not rows).
10. **Recommended correction:** inside the bulk transaction, after locking, expand a selected split-transfer leg to its parent's full set (parent, every split's linked leg), exactly as `removeParentTransaction` does, or refuse a leg whose parent is not also selected.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/transactions/transaction-bulk-update.service.ts
+++ b/backend/src/transactions/transaction-bulk-update.service.ts
@@ -556,6 +556,24 @@
       for (const tx of transactions) {
+        // A split-transfer leg links to the split PARENT, not to a mirror leg:
+        // deleting the parent cascades its split rows and leaves every other
+        // leg standing with its money. Expand to the parent's whole set, the
+        // way the single delete does (removeParentTransaction).
+        if (tx.linkedTransactionId) {
+          const parentSplits = await m.getRepository(TransactionSplit).find({
+            where: { transactionId: tx.linkedTransactionId },
+          });
+          for (const s of parentSplits) {
+            if (
+              s.linkedTransactionId &&
+              !transactionIdsSet.has(s.linkedTransactionId)
+            ) {
+              linkedIdsToDelete.add(s.linkedTransactionId);
+            }
+          }
+        }
         if (
           tx.linkedTransactionId &&
           !transactionIdsSet.has(tx.linkedTransactionId)
```

   Needs: the `TransactionSplit` import, the reconciled-lock check over the expanded set (it runs after the lock, so it covers them), and a decision whether a leg selected without its parent should rather be refused.
12. **Recommended regression test:** integration (schema-faithful FKs): bulk-delete a split-transfer leg, assert all three balances return to their pre-transfer values and no orphan leg remains; also the parent selected, both legs selected, and a cross-owner leg.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+  it("bulk-deleting one split-transfer leg removes the whole split transfer", async () => {
+    // A 1000, split -100 -> B 60 / C 40, then bulk-delete B's leg
+    await bulk.bulkDelete(userId, { mode: "ids", transactionIds: [bLeg.id] });
+    expect(await balanceOf(a.id)).toBe(1000);
+    expect(await balanceOf(b.id)).toBe(0);
+    expect(await balanceOf(c.id)).toBe(0);
+    expect(await countRows(userId)).toBe(0);
+  });
```

14. **Verification:** P4 green; the case must run on a database whose `transaction_splits` and `transactions` FKs carry the schema's `ON DELETE` actions (the entity harness does not, section 10).
15. **Residual risks:** a bulk delete of a split parent with embedded investment lines does not call `deleteSplitSideEffects` (investment rows cascade with no holdings rebuild; agent sweep, not executed) and a cross-owner counterpart is never removed (`lockTransactionRows` filters on `user_id`); both handed to S07/S12 (section 12).

- Causality: `PRE_EXISTING_UNREPORTED` (MON-M34 covered the counterpart account's snapshot; the sibling-leg rows were not in it).

### A26-S13-04 - The latest net worth, the account market values and the month comparison drop the completeness flags, so the accounts summary and the AI/MCP account tools quote a subtotal as net worth

1. **Severity:** MEDIUM
2. **Confidence:** high (executed, P5)
3. **Location:** `backend/src/net-worth/net-worth.service.ts:1051-1080` (`getLatestNetWorth` returns `{assets, liabilities, netWorth}` and drops `fxComplete` / `missingRatePairs`); consumers `accounts/accounts.service.ts:1598-1606` (`getSummary`, `?? 0`), `:1817-1823` (`getLlmAccounts` totals, `?? 0`), `mcp/resources/financial-summary.resource.ts:57, 83`, AI `list_accounts` line `tool-executor.service.ts:2433`, MCP `list_accounts` schema `mcp/tool-output-schemas.ts:59-66`; `securities/portfolio.service.ts:1491-1551` (`getAccountMarketValues` skips an unpriced or unconvertible position with no flag; `accounts.service.ts:1746-1751` reads it with `?? 0`); `built-in-reports/monthly-comparison.service.ts:338-362` (month reduced to `{month, netWorth}`); the snapshot writer `net-worth.service.ts:2931, 2948-2959` stores the subtotal for a security-to-account gap and skips an unpriced position silently, so the read-time `fxComplete` cannot see either.
4. **Violated invariant:** `docs/financial-calculation-contract.md` section 1 and `AGENTS.md` "A completeness flag is read where the numbers are shown ... carry it to every surface including the LLM shape".
5. **Reproduction:** default USD; a USD chequing account of 1,000.00 and an account in a custom currency `ZZZ` holding 1,000,000 with no rate. Call `GET /accounts/summary`, the MCP resource `monize://financial-summary`, AI or MCP `list_accounts`.
6. **Observed (executed, P5):** `/accounts/summary` -> `{"totalAssets":1000,"netWorth":1000}` with no completeness field; `getLlmAccounts` -> `netWorth: 1000` with `missingRatePairs: ["ZZZ->USD"]` from its separate per-account conversion, and no total-level flag. The AI line prints `Net worth: 1000.00`.
7. **Expected:** `netWorth: null` (or the subtotal under a named field) with `fxComplete: false` and the pair, as `getMonthlyNetWorth` carries for the same month.
8. **Impact:** the assistant and an MCP client state a net worth short by the whole unconvertible account (1,000,000 ZZZ here); the account tools' brokerage `balance` is a silent subtotal or 0 when a holding's price or rate is missing; the month comparison quotes net worth deltas over subtotals. The frontend `MonthlyNetWorth` type has no flag at all (`frontend/src/types/net-worth.ts:3-15`), so the net-worth report, its PDF/CSV and the two dashboard widgets show the series' subtotals as totals (UI half handed to S20, with A26-S02-03).
9. **Root cause:** stage 1 of `docs/specs/fx-conversion-completeness.md` kept the figures numeric and added the flags beside them, but the scalar consumers (latest month, month comparison, account market values) were not migrated (Rule 4); the snapshot table has no completeness column.
10. **Recommended correction:** return the flags from `getLatestNetWorth` and carry them into `getSummary`, `getLlmAccounts`, the financial-summary resource and both `list_accounts` schemas; give `getAccountMarketValues` a per-account completeness map (or reuse the summary's per-account `valuationComplete`); keep `fxComplete` in `month_comparison`; persist a completeness bit on the snapshot (a migration, maintainer decision).
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/net-worth/net-worth.service.ts
+++ b/backend/src/net-worth/net-worth.service.ts
@@ -1051,7 +1051,13 @@
   async getLatestNetWorth(
     userId: string,
     jointScope?: JointNetWorthScope,
-  ): Promise<{ assets: number; liabilities: number; netWorth: number } | null> {
+  ): Promise<{
+    assets: number;
+    liabilities: number;
+    netWorth: number;
+    fxComplete: boolean;
+    missingRatePairs: string[];
+  } | null> {
@@ -1075,6 +1081,8 @@
     return {
       assets: latest.assets,
       liabilities: latest.liabilities,
       netWorth: latest.netWorth,
+      fxComplete: latest.fxComplete,
+      missingRatePairs: latest.missingRatePairs,
     };
--- a/backend/src/accounts/accounts.service.ts
+++ b/backend/src/accounts/accounts.service.ts
@@ -1600,8 +1600,13 @@
     return {
       totalAccounts: accounts.length,
       totalBalance,
       totalAssets: roundMoney(latest?.assets ?? 0),
       totalLiabilities: roundMoney(latest?.liabilities ?? 0),
-      netWorth: roundMoney(latest?.netWorth ?? 0),
+      // A subtotal is not a total: null when a component did not convert.
+      netWorth:
+        latest && latest.fxComplete === false ? null : roundMoney(latest?.netWorth ?? 0),
+      fxComplete: latest?.fxComplete ?? true,
+      missingRatePairs: latest?.missingRatePairs ?? [],
     };
```

   Needs: the same in `getLlmAccounts`, the MCP schemas, the AI summary line, the frontend `AccountSummary` and `MonthlyNetWorth` types; `getAccountMarketValues` completeness; the snapshot column. `Suggested remediation diff: incomplete` for the snapshot half (a migration and a decision whether a partially priced month is stored at all).
12. **Recommended regression test:** P5 as an integration case asserting `fxComplete: false` and the pair on both the summary and the LLM shape; a unit case for `getAccountMarketValues` with one unpriced holding.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+  it("does not report a subtotal as net worth (financial contract section 1)", async () => {
+    // USD 1000 + ZZZ 1,000,000 with no rate
+    const s = await accounts.getSummary(userId);
+    expect(s.fxComplete).toBe(false);
+    expect(s.missingRatePairs).toEqual(["ZZZ->USD"]);
+    expect(s.netWorth).toBeNull();
+  });
```

14. **Verification:** P5 re-run; `npm run test:unit -- accounts.service net-worth.service monthly-comparison tool-executor`; MCP schema tests.
15. **Residual risks:** the look-through and allocation `totalValue` (`sector-weighting.service.ts:420-433, 806-826`, `portfolio.service.ts:1563-1720`) also carry no flags (same root cause, listed here as surfaces); the frontend reading is S20's.

- Causality: `EXPOSED_OR_AMPLIFIED` by the stage-1 completeness change (plan class `PRE_EXISTING_UNREPORTED` for the scalar consumers; the flags themselves are new since the upstream audit).
- Surfaces (Rule 7): `/accounts/summary`, MCP `monize://financial-summary`, AI and MCP `list_accounts` (totals and brokerage balances), AI/MCP `month_comparison`, the snapshot writer, look-through and allocation totals.

### A26-S13-05 - Choosing a default currency that is not yet in the table fails on the foreign key: onboarding on a fresh instance accepts only USD

1. **Severity:** MEDIUM
2. **Confidence:** high (executed, P1, and replayed against `database/schema.sql`)
3. **Location:** `backend/src/users/users.service.ts:373-379` (the patch, including `default_currency`, is written inside the transaction), `:399-409` (`ensureSystemCurrency` runs after the transaction commits); FK `database/schema.sql:1561` (`user_preferences.default_currency REFERENCES currencies(code)`, not deferrable); `frontend/src/components/auth/OnboardingPreferences.tsx:68-70, 100-115` (the picker offers the whole catalog, "the chosen one is created when saved").
4. **Violated invariant:** the on-demand currency contract stated at `currencies.service.ts:47-53, 64-69` and `:232-238` ("Idempotent and safe to call on every default-currency change ... instead of seeding a whole list up front").
5. **Reproduction:** a fresh instance (only USD exists, `onApplicationBootstrap`); a new user picks CAD (or PLN, EUR) at onboarding and saves.
6. **Observed (executed, P1):** `updatePreferences(userId, { defaultCurrency: "PLN" })` throws `QueryFailedError: insert or update on table "user_preferences" violates foreign key constraint`; no currency row is created; the onboarding toast reports the save failed. The SQL replay on `schema.sql` gives the same violation for `PLN` and for lower-case `pln` (the DTO does not upper-case; `@MaxLength(3)` only).
7. **Expected:** the currency ensured (validated as ISO 4217, upper-cased) before the preference row is written, in the same transaction.
8. **Impact:** every non-USD user on a fresh deployment cannot finish onboarding with their currency; the work-around (keep USD, add the currency on the Currencies page, then change the default) is undiscoverable from the error. A reporting currency left at USD by mistake then converts every figure the user reads.
9. **Root cause:** the ensure was placed with the post-commit side effects (the rate refresh), after a write that depends on it; the unit spec mocks the repository (`users.service.spec.ts:148`) and the entity harness has no such FK, so no test can see the order.
10. **Recommended correction:** validate `defaultCurrency` with `IsCurrencyCode` after an upper-casing `@Transform`, and call `ensureSystemCurrency` inside the transaction before the update (it joins the ambient transaction).
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/users/dto/update-preferences.dto.ts
+++ b/backend/src/users/dto/update-preferences.dto.ts
@@ -49,6 +49,8 @@
   @IsOptional()
-  @IsString()
-  @MaxLength(3)
+  @Transform(({ value }) => (typeof value === "string" ? value.toUpperCase() : value))
+  @ValidateIf((_o, v) => v !== null && v !== "")
+  @IsCurrencyCode()
   defaultCurrency?: string;
--- a/backend/src/users/users.service.ts
+++ b/backend/src/users/users.service.ts
@@ -331,6 +331,13 @@
       async (manager) => {
         await ensureUserPreferencesRow(manager, userId);
+        // The FK to currencies(code) is checked at the UPDATE below, so the
+        // currency has to exist first; ensureSystemCurrency joins this
+        // transaction.
+        if (dto.defaultCurrency !== undefined) {
+          await this.moduleRef
+            .get(CurrenciesService, { strict: false })
+            .ensureSystemCurrency(dto.defaultCurrency);
+        }
         const repo = manager.getRepository(UserPreference);
```

   Needs: removal of the post-commit ensure at `:399-409`; a decision whether a user's default should create an active system currency (A26-S13-06 and S09-06 argue for inactive plus a preference row).
12. **Recommended regression test:** an integration case on a database carrying the schema's FK: a fresh user sets `defaultCurrency: "PLN"`, the row is saved and `currencies` holds PLN.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+  it("creates the chosen default currency before writing the preference", async () => {
+    const saved = await users.updatePreferences(userId, { defaultCurrency: "PLN" });
+    expect(saved.defaultCurrency).toBe("PLN");
+    expect(await currencyExists("PLN")).toBe(true);
+  });
```

14. **Verification:** P1 re-run on a schema-faithful database; the onboarding E2E with a non-USD currency (S20/S21).
15. **Residual risks:** the same ordering exists wherever a referenced code is written before `ensure*` (none other found: the MNY import ensures before its transaction).

- Causality: `PRE_EXISTING_UNREPORTED` (introduction date not determinable in the shallow clone).
- Disposes the S09 hand-off "A26-S09-06's preferences surface": the preferences path cannot create a currency at all (the FK refuses first), so it is not a global-creation path; it is this functional defect instead.

### A26-S13-06 - A deleted user's custom currencies become active system currencies offered to every user, and `GET /currencies/:code` exposes a currency creator's user id

1. **Severity:** LOW
2. **Confidence:** medium (reading; the FK action and the `findAll` predicate are unambiguous, not executed)
3. **Location:** `database/schema.sql:70` (`currencies.created_by_user_id REFERENCES users(id) ON DELETE SET NULL`); `backend/src/users/users.service.ts:561-645` (account deletion; no currency cleanup); `currencies/currencies.service.ts:176-195` (`findAll` lists `created_by_user_id IS NULL AND is_active` to everyone), `:314-321`, `:446` (a NULL creator can be neither edited nor deleted by anyone); `currencies.controller.ts:351-356` with `entities/currency.entity.ts:26-27` (`createdByUserId` serialized); `currencies/dto/create-currency.dto.ts:15-18` (`@Length(3, 3)` only, so `POST /currencies` accepts `"q#!"`).
4. **Violated invariant:** a tenant's data does not become reference data other tenants see (the reason `ensureCatalogCurrency` creates inactive rows, `currencies.service.ts:243-252`); identifiers of other users are not returned (`AGENTS.md` security rules).
5. **Reproduction:** user A creates `PTS / Family Points`, deletes their account; user B lists currencies.
6. **Observed (by reading):** `PTS` now has `created_by_user_id NULL`, `is_active true`, and appears in every user's picker as a system currency; no user can edit or delete it. While A exists, `GET /currencies/PTS` returns A's user UUID to any authenticated caller who knows the code.
7. **Expected:** the deleted user's unreferenced custom currencies deleted with the account (or kept inactive), and `createdByUserId` omitted from the response.
8. **Impact:** cross-tenant visibility of a user-chosen name and symbol, permanently; a user id disclosed. No financial figure changes.
9. **Root cause:** the FK action turns ownership into "system" on delete; the entity has no `@Exclude`.
10. **Recommended correction:** in the account deletion, `DELETE FROM currencies WHERE created_by_user_id = $1 AND NOT currency_code_in_use_globally(code)` before the user row goes, and set the rest inactive; exclude `createdByUserId` from serialization (the view type `UserCurrencyView` already omits it); validate `CreateCurrencyDto.code` with `IsCurrencyCode` or a three-letter pattern.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/currencies/entities/currency.entity.ts
+++ b/backend/src/currencies/entities/currency.entity.ts
@@ -24,5 +24,6 @@
+  @Exclude()
   @Column({ name: "created_by_user_id", type: "uuid", nullable: true })
   createdByUserId: string | null;
--- a/backend/src/users/users.service.ts
+++ b/backend/src/users/users.service.ts
@@ (account deletion, before the user row is removed)
+      // A custom currency nobody else references goes with its creator; one
+      // still referenced stays, inactive, rather than becoming a system
+      // currency offered to every user (created_by_user_id ON DELETE SET NULL).
+      await m.query(
+        `DELETE FROM currencies WHERE created_by_user_id = $1
+           AND NOT currency_code_in_use_globally(code)`,
+        [userId],
+      );
+      await m.query(
+        `UPDATE currencies SET is_active = false WHERE created_by_user_id = $1`,
+        [userId],
+      );
```

   Needs: the deletion's own context (it is a self-delete under the user's identity; the definer function is callable there) and a check that `ClassSerializerInterceptor` applies to `findOne`'s entity return.
12. **Recommended regression test:** integration: user A creates and deletes; user B's `findAll` does not list A's code.
13. **Suggested regression-test diff:** as 12; not written out.
14. **Verification:** the integration case; `npm run test:unit -- currencies users.service`.
15. **Residual risks:** S09-06 (MNY import) remains the active creation path for junk codes; the daily refresh then asks Yahoo for any referenced code on every run (`yahoo-fx.provider.ts:155-157` carries every code; no negative cache on the refresh), an operational cost recorded in section 9.

- Causality: `PRE_EXISTING_UNREPORTED`.

### A26-S02-11 (owned here) - `fx-fallback.guard.spec.ts` cannot see a camelCase rate fallback

Disposition: CONFIRMED by this session (section 6, mutation M4); severity LOW unchanged; the finding text in `02-prior-high-triage.md` stands. Additional unseen sites found by the sweep: `transaction-transfer.service.ts:455, 484`, `scheduled-transactions.service.ts:1100-1102` (multi-line ternary). None is a lookup failure today (stored-rate reads of a `NOT NULL DEFAULT 1` column, or the no-foreign-currency branch).
