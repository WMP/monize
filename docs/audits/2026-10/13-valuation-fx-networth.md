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
| Status | complete |
| Runtime executed | Node 24.22.1 (`nvm use 24`); `npm ci` OK in `backend/`. PostgreSQL 16 in Docker (`mirror.gcr.io/library/postgres:16-alpine`, `dockerd` started by hand). Baseline integration: `rls-enforcement`, `fx-rate-coverage`, `portfolio-movement-flow`, `portfolio-tag-keys`, `report-investment-cash`, `invested-capital-flow`, `scheduled-investment-split-fx`, `fx-fee-summary`, `bond-holding-value`: 9 suites, 110 tests, all pass. Baseline unit batch (16 patterns, section 12): 20 suites, 984 tests, all pass. One scratch probe spec (P1-P5, six cases) in a worktree at the baseline: every case reproduces a defect (section 7). Ten mutations in the same worktree (section 6): nine detected (four of them only by mock-based unit tests), one undetected. `database/schema.sql` loaded into a scratch database for the foreign-key replay of P1. No `net-worth*`, `currenc*` or `exchange*` integration suite exists (section 10). |

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
9. **Root cause:** the expand release made writers canonical and assumed every reader was inverse-aware (spec section 8: "already fall back to the inverse key, so receiving one orientation per pair needs no change"); the readers are inverse-aware only when the direct key is absent, and `getLatestRates` hands them both orientations with different dates and no age bound. The one-door guard exempts the method by design ("the plural admin listing is a list, not a value-for-a-date", `common/time-series/fx-rate.one-door.spec.ts:16-19, 242-245`), while it is the rate source of every built-in report and every client-side conversion.
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

## 5. Prior-finding dispositions

Final dispositions for the register (plan step 8). The S02 triage column of the register is
superseded by this column.

| ID | Disposition | Mechanism and evidence run in this session |
| --- | --- | --- |
| MON-H12 | STILL_OPEN -> A26-S13-01 (reports 1:1, unconverted amount under the target label) and A26-S13-02 (frozen orientation and unbounded age on the reports and the client) | FIXED on the portfolio, net-worth, frontend-hook and Monte Carlo paths: `resolveFxRate` returns `unknown`, `FxAggregate` withholds `total`, the hook returns `null` (mutations M1, M2, M7 detected; unit batch green). Executed P2, P3, P3b on the report path. |
| MON-H13 | FIXED_VERIFIED | Every historical replay folds through `applyActionToQuantity` (`investment-replay.util.ts:104`), held by `investment-replay.guard.spec.ts`; mutation M9 (`*` -> `+`) fails 9 tests in `investment-replay.util.spec.ts` and `net-worth.service.spec.ts` ("multiplies by the split ratio rather than adding it (P5-011)"). Residual: no reverse-split case in `net-worth.service.spec.ts` (section 10). |
| MON-M19 | FIXED_VERIFIED | `currency_code_in_use_globally` is SECURITY DEFINER and runs in the caller's transaction (`schema.sql:4294-4318`); the creator gate `currency.createdByUserId === userId` (`currencies.service.ts:446`); parent `FOR UPDATE` (`:402`). `rls-enforcement.integration.spec.ts` "currency liveness is global, not tenant-scoped" (5 cases, including the two-connection activation race) passed. Mutations M3 and M3b detected, by mock-based unit tests only; no integration test drives `CurrenciesService.remove` against another user's account or transaction (section 10). |
| MON-M33 | FIXED_VERIFIED | `computeCurrentValue` returns `null` on `!valuationComplete`, a non-finite total or a throw, and `requireCurrentValue` refuses with `errors.monteCarlo.currentValueUnavailable` (`monte-carlo.service.ts:881-936`); `getHistoricalStats.currentBalance` is `number | null`; the frontend test "surfaces a null currentBalance instead of writing 0 into the form" (`MonteCarloReport.test.tsx:653`). Mutation M5 fails 2 tests. Residual (INV-BOND-010 path of S01): the return weights and `getHoldingStats` value a bond holding at `getLatestPrices` (section 9, S14). |
| MON-M34 | FIXED_VERIFIED for the counterpart account's snapshot; related open defect A26-S13-03 | `bulkDelete` adds every locked linked row's account to the post-commit recalc set (`transaction-bulk-update.service.ts:595-597`); mutation M6 fails "recalculates net worth for a linked account reached only through a transfer leg (P5-012)" (mock-based). The selected split-transfer leg path leaves rows, not only a snapshot: A26-S13-03 (executed). Undo/redo dispatches no recalc; the 30-minute `sweepStaleSnapshots` repairs it (section 9). |
| MON-M39 | STILL_OPEN (relocated) -> A26-S13-01 | `report-currency.service.spec.ts:213` ("returns original amount when no rate is available") and the inverse-zero case assert the defect and pass in the unit batch. The two tests the upstream audit named now assert `null` (S02). |
| MON-M41 | FIXED_VERIFIED | The net-worth fixtures use ratio 2 (`net-worth.service.spec.ts:797-822`, `:4001-4002`) and fail under M9. No reverse-split case (section 10). |

Hand-offs received and disposed:

| From | Hypothesis | Disposition |
| --- | --- | --- |
| S02 | A26-S02-02 (reports 1:1) | CONFIRMED, superseded by A26-S13-01 |
| S02 | A26-S02-11 (guard blind spot) | CONFIRMED (M4 undetected again); LOW, stays A26-S02-11 |
| S02 | `currency-conversion.util.ts:20` empty source code is same-currency | CONFIRMED, folded into A26-S13-01 (root cause and diff) |
| S12 | A26-S12-04 consumers | CONFIRMED surfaces: `getRealizedGains` (REST, `investment-transactions.service.ts:3476`, and the security detail page `security-detail.service.ts:338`), `getCapitalGainsByMonth` / `ByDay` (charts, `:3507`), AI `get_capital_gains` (`tool-executor.service.ts:2638-2680`) and MCP (`mcp/tools/investments.tool.ts:299`) through `getLlmCapitalGains` -> `calculateCapitalGains`. No built-in report and no tax figure reads these folds (`tax-recurring-reports.service.ts` reads cash transactions). No new finding (Rule 7); the surface list belongs to A26-S12-04. |
| S12 | A26-S12-09 valuation via txFallback | CONFIRMED by reading: `loadTxPriceSeries` (`net-worth.service.ts:3071-3146`) averages `investment_transactions.price` with no currency or `exchange_rate` test, and `positionCloseAsOf` merges it with the store, so a Money-imported CAD price is read as a USD close and converted again in the snapshot writer (`:2925-2945`). Not executed (no two-currency Money fixture). Surface added to A26-S12-09. |
| S12 | A26-S12-02 other `getLatestRate` callers | Surfaces: `scheduled-transactions.service.ts:792` (daily estimate cron for future-dated schedules, unbounded), `common/fx-entry.util.ts:186` with `transaction-split.service.ts:89` (a split posting with no date), `gem-position.service.ts:376` (bounded, held). Same root cause as A26-S12-02; added there (section 12). |
| S09 | A26-S09-06 preferences surface | REJECTED as a creation path (the FK refuses before `ensureSystemCurrency`); found A26-S13-05 instead. Jobs iterating active currencies: none iterates all active ones; the refresh takes codes referenced by accounts, securities and defaults, so an imported junk code is sent to Yahoo on every refresh (section 9). |
| S09 | MON-M19 | FIXED_VERIFIED (above) |
| S10 | CSV/QIF `AccountMappingDto.currencyCode` naming another user's custom currency | DESIGN_RISK (section 8): currencies are shared by design; the FK accepts it, and the reference then blocks the creator's deletion. |
| S01 | Monte Carlo bond valuation (INV-BOND-010) | Current value: held (summary path is bond-aware). Weights and holding stats: DESIGN_RISK handed to S14 (section 9). |
| S01/S07 | Undo never recomputes net worth | CONFIRMED as a gap with a backstop: no undo/redo path dispatches a recalc; `sweepStaleSnapshots` (30 minutes, keyed on `accounts.updated_at`, which the undo's raw `UPDATE accounts` bumps) repairs it within about 40 minutes. DESIGN_RISK (section 9); A26-S07-02 is the balance half. |

## 6. Mutation table

All in the scratch worktree `<scratchpad>/mut` at `AUDIT_BASELINE_SHA`, reverted after each run
(`git status` clean apart from the scratch spec).

| ID | Invariant | Mutation (file:line, what) | Test that fails | Verdict |
| --- | --- | --- | --- | --- |
| M1 | INV-FX-001 age bound | `common/time-series/fx-rate-resolver.ts:230` drop `if (dates[at] < oldest) return null;` | 9 tests in `fx-rate-resolver.spec.ts`, `rate-index.util.spec.ts`, `exchange-rate.service.spec.ts`, `portfolio-calculation.service.spec.ts` | covered |
| M7 | INV-FX-001 look-ahead | `fx-rate-resolver.ts:216` historical `newest = onDate` -> `shiftYMD(onDate, maxAgeDays, "max")` | 7 tests (`getRateForDate` "refuses a fetched window whose every bar is dated after the target", `convertAtDate` "converts at the rate that stood on the day") | covered |
| M2 | Financial contract section 1 | `common/fx-aggregate.ts:78` `total` returns the subtotal always | 17 tests in `fx-aggregate.spec.ts`, `daily-balance-totals.service.spec.ts`, `investment-transaction-summary.service.spec.ts` | covered (the net-worth and portfolio suites stay green because those surfaces read `knownSubtotal` by design, stage 1) |
| M3 | INV-CURRENCY-001 creator gate | `currencies/currencies.service.ts:446` `=== userId` -> `!== null` | "does not delete another user's custom currency, even when globally unreferenced" (mock) | covered (unit only) |
| M3b | INV-CURRENCY-001 global check | `currencies.service.ts:607` `isInUseGlobally` always false | 2 tests (mock of the SQL answer) | covered (unit only; the integration cases call the SQL function, not the service) |
| M4 | INV-FX-001 guard | `securities/portfolio.service.ts:2147` `?? null` -> `?? 1` | none (`fx-fallback.guard`, `portfolio.service` 187 passed) | **undetected** (A26-S02-11, re-run) |
| M5 | MON-M33 | `monte-carlo/monte-carlo.service.ts:895` skip the `valuationComplete` check | 2 tests ("refuses to run from an incomplete portfolio total (FR-005)", "... no price (RR3-004)") | covered |
| M6 | MON-M34 / INV-CACHE-001 | `transactions/transaction-bulk-update.service.ts:596` drop the locked-row account collection | "recalculates net worth for a linked account reached only through a transfer leg (P5-012)" (mock) | covered (unit only) |
| M9 | INV-HOLDING-002 | `securities/investment-replay.util.ts:104` `*` -> `+` | 9 tests | covered |
| R1 | A26-S13-03 | none (baseline code); P4 | scratch spec fails (total 1,040.00) | defect demonstrated |

Conceptual, not executed: making `getLatestNetWorth` drop `fxComplete` (already the baseline,
A26-S13-04) has no test to fail; reordering `ensureSystemCurrency` before the write in
`users.service.ts` would be invisible to `users.service.spec.ts` (mocked) and to the entity
harness (no FK), so the A26-S13-05 regression test must run on a schema-faithful database.

## 7. Counterexamples and the interaction scenario

| Invariant | Counterexample (not copied from the tests) | Result |
| --- | --- | --- |
| INV-FX-001 (1:1) | A JPY row in Spending by Payee with an empty rate table (P2) | 100,000 summed into a USD total; data-quality labels it USD |
| INV-FX-003 / INV-FX-001 age | Pre-upgrade mirror row plus today's canonical row (P3); one 324-day-old row (P3b) | 1,300.00 instead of 1,400.00; 1,250.00 reported as current |
| Balance conservation on delete | Bulk-delete one leg of a two-leg split transfer (P4) | +40.00 created in C, orphan leg |
| Completeness on every surface | A custom-currency account with no rate beside a USD account (P5) | `netWorth: 1000`, no flag on `/accounts/summary` |
| On-demand currency | Onboarding with a currency not yet in the table (P1) | FK violation, nothing saved |
| INV-CURRENCY-001 | Creator deletes while another user's activation commits concurrently | refused cleanly (integration, two connections) |
| MON-M33 | One unpriced holding in a `useCurrentBalance` run | 400 refusal (unit; M5) |
| INV-HOLDING-002 | Two sequential 2:1 splits | multiplies (M9 detected) |

Interaction scenario. A26-S13-02 meets INV-FX-002 and A26-S12-04: a CAD-reporting user on an
instance upgraded from 1.16 enters a cash withdrawal with an embedded USD investment buy. The
split form prefills the trade's `exchangeRate` from the client map, which answers the frozen
upgrade-day `USD->CAD` row (A26-S13-02); if the server keeps the supplied rate (S19 to confirm),
INV-FX-002 then makes that rate authoritative for the row's cost basis on every surface, and a
later transfer of the lot to a second CAD brokerage resets the basis at rate 1 in the realized
gain (A26-S12-04). Each mechanism alone is documented as correct (the row's own rate wins; the
client map is "inverse-aware"; the lots surface carries basis); together the realized gain is
wrong by the rate drift since the upgrade plus the transfer's currency reset, and the lots surface
on the same screen gives a third figure.

## 8. Rejected hypotheses

| Candidate | Evidence considered | Why rejected or downgraded | Final classification |
| --- | --- | --- | --- |
| Preferences `defaultCurrency` creates a global active currency (S09 hand-off) | `users.service.ts:373-409`, FK `schema.sql:1561`, P1 | The FK refuses an absent code before the ensure runs | REJECTED (A26-S13-05 is the real defect) |
| MON-M19 cleanup decided from tenant-filtered evidence | definer function, creator gate, integration race | Fixed by the definer function in the caller's transaction | REJECTED for the current code (FIXED_VERIFIED) |
| CSV/QIF mapping names another user's custom currency (S10 hand-off) | `import.dto.ts:145-151`, FK, `findAll` | Currencies are shared reference data by design (any user may activate any code); the effect is that the creator can no longer delete it | DESIGN_RISK |
| `backfillHistoricalRates` reads accounts and securities without `user_id` (agent sweep) | `exchange-rate.service.ts:601-628`, admin-only route | The backfill is deliberately global (the pair set is the deployment's), like the refresh | REJECTED |
| Monte Carlo current value becomes 0 on failure (MON-M33) | `monte-carlo.service.ts:881-936`, frontend test | `null` and a refusal | REJECTED for the current code (FIXED_VERIFIED) |
| Historical net-worth snapshot values a position at a years-old close | `position-price.util.ts`, `docs/time-series-contract.md` section 2.1 | Deliberate and documented (issue #1242): a position's worth is its latest accepted close, unbounded; returns and boundaries stay bounded | REJECTED (documented contract) |
| Period result over a deposit counts the deposit (INV-PORTRESULT-001) | `portfolio-period-result.util.ts:286-330` | `investmentResult = valueChange - netExternalFlows`, percentage only over the result, `zeroStart` refusal | REJECTED |
| `resolveFxRate` default `today` is UTC while callers pass the request day | `fx-rate-resolver.ts:345`, callers pass `todayYMD()` | Every caller read passes `today` explicitly | REJECTED |
| Provider call amplification in `getRateForDate` (no negative cache) | `exchange-rate.service.ts:1129-1227` | Report reads pass `fetchMissing: false`; the posting path is one call per write; no N-row read model built (Rule 6) | optimization hypothesis, handed to S10 for the QIF/CSV per-row FX resolution |
| Portfolio `total*` numeric when incomplete | `portfolio-calculation.service.ts:2184-2185` | Stage 1 of the completeness spec, flags carried; consumers that read them are held | DESIGN_RISK (S02 section 9) |

## 9. Design risks

- Built-in reports convert every historical bucket at today's rate ("flat latest-rate lookup", `report-currency.service.ts:105`), which is the look-ahead clause of INV-FX-001 for a past period; a currency's move inflates or deflates last year's spending. The maintainer should state this as policy or route reports through `buildRateIndex` / `convertAtDate` as the Sankey report does.
- `monthly_account_balances` has no completeness column (`net-worth.service.ts:2948-2959`, spec section 5): a security-to-account FX gap and an unpriced position are lost at write time, so the read-time `fxComplete` can say `true` over a stored subtotal.
- Undo/redo dispatches no net-worth recalc; the 30-minute sweep is the only repair, and INV-CACHE-001 reads `enforced` without naming it. A sweep skipped (an account with no snapshot rows is never swept) leaves the history stale.
- Unbounded `getLatestRate` fallbacks outside the investment trade path: the scheduled foreign-currency estimate cron (`scheduled-transactions.service.ts:792`) and a dateless split posting (`fx-entry.util.ts:186`). Exposure is low while the daily refresh succeeds; a pair dropped by the provider keeps a stale estimate indefinitely.
- An imported junk currency code (S09-06) referenced by an account is sent to Yahoo on every refresh (`yahoo-fx.provider.ts:155-157` carries every code; the refresh has no negative cache).
- Monte Carlo return weights and `getHoldingStats.marketValue` read `getLatestPrices` for a bond-linked holding (`monte-carlo.service.ts:511-539, 708-727`) instead of `valueBondHoldings`; the current value itself is bond-aware. Handed to S14.
- `POST /currencies/exchange-rates/refresh` lets any authenticated user start a deployment-wide provider refresh (default throttle only); availability, not integrity. Handed to S03/S21.
- `getAccountMarketValues` accumulates in floats (`portfolio.service.ts:1545-1548`), not through `FxAggregate`; drift is sub-cent at realistic sizes.

## 10. Missing tests and known-wrong tests

Known-wrong (assert a defect and pass):
- `backend/src/built-in-reports/report-currency.service.spec.ts:213` and the inverse-zero case (MON-M39, A26-S13-01).
- `backend/src/users/users.service.spec.ts:148` mocks `ensureSystemCurrency`, so the write-before-ensure order of A26-S13-05 passes.
- `backend/src/transactions/transaction-bulk-update.service.spec.ts:2592-2643` (split-transfer bulk delete) asserts only that `updateBalance` was called; it cannot see A26-S13-03.

Missing:
- No `net-worth*`, `currenc*` or `exchange*` integration suite exists, though the session plan names them; net worth, `CurrenciesService.remove` end to end, the rate table's two orientations and `getLatestRates` are covered only by mocks (M3, M3b, M6 detected by mocks alone).
- The entity-built integration harness lacks the schema's `ON DELETE` actions on the `transactions` and `transaction_splits` FKs and lacks `user_preferences.default_currency -> currencies(code)`: a bulk-delete case fails in the harness for a reason production does not have, and A26-S13-05 cannot be seen at all (joins A26-S05-01's harness-parity gap; S21).
- No test of a selected split-transfer leg, a cross-owner leg or a split parent with embedded investment lines in `bulkDelete`.
- No test of `getLatestRates` / the client `convert` with both orientations present (A26-S13-02); no frontend test of a stale rate.
- No portfolio test for a currency with neither a time series nor a spot rate (M4, A26-S02-11).
- No reverse-split case in `net-worth.service.spec.ts` (MON-M41 residual).
- No completeness assertion on `/accounts/summary`, `getLlmAccounts`, `month_comparison` or `getAccountMarketValues` (A26-S13-04).

## 11. Documentation inconsistencies

- `docs/specs/exchange-rate-canonical-orientation.md` section 8 says the client rate map and the report map "already fall back to the inverse key, so receiving one orientation per pair needs no change"; during the expand window they receive both orientations and prefer the frozen one (A26-S13-02).
- `common/time-series/fx-rate.one-door.spec.ts:16-19` calls `getLatestRates()` "the plural admin listing", but it feeds every built-in report and the frontend; INV-FX-001's enforcement text does not mention it.
- INV-FX-003's status text records the pre-release mirror rows as harmless duplicates; it does not record that direct-first readers prefer them.
- INV-CACHE-001 reads `enforced`; undo/redo and `removeAll` of investment transactions dispatch nothing and rely on the sweep, which the entry does not name.
- `sessions.md` S13 names INV-PORTMOVE-001..002; the index holds only INV-PORTMOVE-007 and -008.
- `currencies.service.ts:232-238` says `ensureSystemCurrency` is "safe to call on every default-currency change"; the caller runs it after the FK-checked write (A26-S13-05).
- The session plan's runtime line names `net-worth*`, `currenc*`, `exchange*`, `portfolio*` integration suites; only `portfolio-movement-flow` and `portfolio-tag-keys` match.

## 12. Review ledger

- Pinned: `AUDIT_BASELINE_SHA` 72c59ec4; code diff against it empty at start (HEAD `d8fd873`).
- Directories inspected: `backend/src/currencies/`, `backend/src/common/` (FX files), `backend/src/common/time-series/` (resolver, rate index), `backend/src/net-worth/`, `backend/src/monte-carlo/`, `backend/src/built-in-reports/` (rate service and call sites), `backend/src/accounts/accounts.service.ts` (summary, LLM accounts), `backend/src/transactions/transaction-bulk-update.service.ts`, `backend/src/users/users.service.ts` (preferences), `frontend/src/hooks/useExchangeRates.ts`, `frontend/src/lib/forecast.ts`.
- Files read in full: `fx-rate-resolver.ts`, `fx-aggregate.ts`, `fx-entry.util.ts`, `currency-conversion.util.ts`, `currencies.service.ts`, `currencies.controller.ts` (60-422), `position-price.util.ts`, `useExchangeRates.ts`, `report-currency.service.ts` (1-121).
- Sampled with ranges: `exchange-rate.service.ts` 900-1339; `net-worth.service.ts` 780-1080, 2925-2960, 3071-3146; `portfolio-calculation.service.ts` 380-510; `portfolio.service.ts` 662-692, 1491-1566, 2145-2149; `monte-carlo.service.ts` 290-740, 860-937; `transaction-bulk-update.service.ts` 501-690; `accounts.service.ts` 1575-1825; `users.service.ts` 225-425; `portfolio-period-result.util.ts` 286-330; `forecast.ts` 215-285, 356-525; `InvestmentSplitFields.tsx` 105-180; `database/schema.sql` 66-110, 370-410, 1555-1565, 4250-4430; the `sector-weighting.service.ts` and `investment-report-data.service.ts` flag producers through the sweep only.
- Not reviewed: `exchange-rate-history.service.ts` and `rate-gap-plan.ts` (gap fill; INV-FX-005 sampled through the sweep), provider adapters beyond `carries`, `portfolio-period-result.service.ts` and the batch service beyond the util, `invested-capital-flow.util.ts`, the intraday series, `sector-weighting.service.ts` arithmetic, `number-locale.util.ts`, the frontend report components (S20).
- Searches (four read-only sub-agent sweeps, re-checked at the cited lines): every `convertAmount` / `tryConvertAmount` / `convertWithRateLookup` call site and their AI/MCP consumers; every `getLatestRate(s)` / `getLatestPrices` caller; rate-1 fallbacks the guard regex misses; every completeness-flag producer and consumer across backend, AI, MCP, frontend types and components; net-worth invalidation on bulk delete, single delete, VOID, undo, imports, AI and MCP deletes; every currency-creating path and the delete gate.
- Suites run: baseline unit batch `fx-rate-resolver|fx-aggregate|fx-fallback.guard|fx-rate.one-door|currencies.service|currency-references|exchange-rate.service|report-currency|investment-replay|net-worth.service|monte-carlo|portfolio.service|portfolio-calculation|transaction-bulk-update|canonical-rate|exchange-rate-orientation` (`TZ=UTC npm run test:unit -- <pattern>`): 20 suites, 984 tests, pass. Baseline integration (`npm run test:integration -- <pattern>`, serial): `rls-enforcement|fx-rate-coverage|portfolio-movement-flow|portfolio-tag-keys|report-investment-cash|invested-capital-flow|scheduled-investment-split-fx|fx-fee-summary|bond-holding-value`: 9 suites, 110 tests, pass. Scratch probes P1-P5 (6 cases, all reproduce a defect). Mutations M1-M9 (section 6).
- Areas reviewed without a finding: the resolver's look-ahead, age bound and direction rule; `FxAggregate`; `getRateForDate` / `getLiveRate` / `resolveStoredRate`; the portfolio summary's `convertToDefault` and `primeLiveRates`; the monthly net-worth fold's flags; Monte Carlo refusals; the currency delete gate and its race; `normalizeFxEntry` / `assertTransactionCurrencyMatchesAccount`; the period-result arithmetic; the forecast's unknown occurrence handling; portfolio movement notifications (read `valuationComplete === true`).

### Text for the orchestrator to merge (ledger, sessions, register)

- Session row: S13 `done`, 2026-10-21, findings B/H/M/L 0/3/2/1 (HIGH A26-S13-01, -02, -03; MEDIUM A26-S13-04, -05; LOW A26-S13-06); A26-S13-01 supersedes A26-S02-02; A26-S02-11 confirmed (stays S02's count); verdict REQUEST CHANGES.
- Suites: unit 20 suites / 984 tests pass; integration 9 suites / 110 tests pass; probes P1-P5 (6 cases) reproduce defects; mutations 10 rows (1 undetected).
- Prior findings (final): MON-H12 `STILL_OPEN` (A26-S13-01, A26-S13-02); MON-H13 `FIXED_VERIFIED`; MON-M19 `FIXED_VERIFIED`; MON-M33 `FIXED_VERIFIED`; MON-M34 `FIXED_VERIFIED` (counterpart snapshot; related A26-S13-03); MON-M39 `STILL_OPEN` (relocated, A26-S13-01); MON-M41 `FIXED_VERIFIED`.
- Program mutation table, undetected rows: `INV-FX-001 | portfolio.service.ts:2147 ?? null -> ?? 1 | a portfolio case with no series and no spot rate | S13 (re-run of S02 M1)`; unit-only rows: `INV-CURRENCY-001 | currencies.service.ts:446, :607 | an integration case driving CurrenciesService.remove | S13`, `INV-CACHE-001 | transaction-bulk-update.service.ts:596 | an integration bulk-delete snapshot case | S13`; R1 baseline defect (A26-S13-03).
- Hypotheses handed on: to S19, whether the server keeps the client-sent `exchangeRate` of an embedded investment split prefilled from `getRate` (A26-S13-02 persisted path) and the onboarding round trip (A26-S13-05); to S20, the frontend `MonthlyNetWorth` / `AccountSummary` types without flags, the net-worth report and its PDF/CSV, `NetWorthChart`, `AssetsVsLiabilities`, `PortfolioValueWidget` (with A26-S02-03), and the client `convert` direction rule; to S16/S17, AI and MCP pass `months` where `getSpendingAnomalies` expects the z-score threshold (`tool-executor.service.ts:2910-2913`, `reports.tool.ts:86-89`), and the report DTO completeness fields for A26-S13-01; to S17, the AI/MCP `list_accounts` and `month_comparison` shapes (A26-S13-04) and the `net_worth_history` summary line that never mentions an incomplete month (`tool-executor.service.ts:2897`); to S07/S12, `bulkDelete` of a split parent with embedded investment lines (no `deleteSplitSideEffects`, no holdings rebuild) and of a cross-owner leg (counterpart never removed), and `removeAll` of investment transactions dispatching no recalc; to S12 (A26-S12-02 surface list), `scheduled-transactions.service.ts:792` and `fx-entry.util.ts:186`; to S14, Monte Carlo bond weights; to S10, per-row FX provider resolution in CSV/QIF import (Rule 6 model owed); to S21, the integration harness parity gaps (section 10), the missing `net-worth*` / `currenc*` / `exchange*` suites, and the unit-only rows above; to S03/S21, the refresh endpoint open to every user.
- Deviations: run as a parallel child session; `ledger.md`, `sessions.md` and `prior-findings-register.md` not edited (this section carries their text); `dockerd` started by hand and PostgreSQL started with `docker run`; the sweeps were delegated to four read-only sub-agents and their citations spot-checked; P4 restores the schema's `ON DELETE` actions in the entity harness before running, and P1 adds the schema's FK (both inside the scratch spec only); the frontend direct-first behaviour of A26-S13-02 is shown by the backend payload of `GET /currencies/exchange-rates` and the hook's code, not by a frontend test run (frontend `npm ci` not run in this session).

## 13. Adversarial approval challenge

Started from the slice's own abstractions, not from the findings: "the one door" (`resolveFxRate`),
"an accumulator that cannot absorb a missing rate" (`FxAggregate`), "rate 1 only for equal codes",
"one orientation per pair" (`canonicalRateRow`), "a definer function for a global answer",
"currencies created on demand", "null, not zero" (Monte Carlo).

- Does any rate reach a figure without passing the door? Yes: `getLatestRates` (exempted from the guard as a "listing") feeds the reports and the client, with no age bound and both orientations (A26-S13-02); the built-in reports' own pass-through (A26-S13-01).
- Can the accumulator be bypassed? The scalar consumers read `knownSubtotal`-derived numbers and drop the flags (A26-S13-04); `getAccountMarketValues` uses `+` and `continue`.
- Can rate 1 appear for unequal codes? An empty source code in `convertWithRateLookup` (A26-S13-01); camelCase stored-rate fallbacks the guard cannot see (A26-S02-11, not lookup failures today).
- Is "one orientation" true on read? Not for direct-first readers during the expand window (A26-S13-02).
- Is "created on demand" true on every path that needs a currency? Not on the preferences path (A26-S13-05); and on-demand creation from a user's own action becomes everyone's list on account deletion (A26-S13-06).
- Does "deleting a row reverses only what it contributed" hold on the bulk path? Not for a split-transfer leg (A26-S13-03).
- Unchanged callers: the AI and MCP report tools inherit A26-S13-01; the MCP resource and both `list_accounts` inherit A26-S13-04; portfolio movement notifications and Monte Carlo read `valuationComplete` correctly (held).

Result: the challenge found A26-S13-05 and A26-S13-06 and the guard exemption behind A26-S13-02,
and no reason to withdraw an earlier finding.

## 14. Verdict

**REQUEST CHANGES** for `backend/src/currencies/` and its secondary paths at `72c59ec4`.

Confirmed: BLOCKER 0, HIGH 3 (A26-S13-01, -02, -03, each executed), MEDIUM 2 (A26-S13-04, -05,
executed), LOW 1 (A26-S13-06, by reading). Independently verified: the resolver's age bound and
no-look-ahead rule (M1, M7), `FxAggregate` (M2), the split replay (M9, MON-H13 fixed), the
currency delete gate (MON-M19 fixed, integration race passed), the Monte Carlo refusal (MON-M33
fixed), the counterpart snapshot on bulk delete (MON-M34 fixed for that case). Limitations: the
frontend consumers were read, not run (S18/S20); the gap-fill service, provider adapters,
sector weighting and the period-result service were sampled; no `net-worth*` / `currenc*` /
`exchange*` integration suite exists to run. The adversarial close-out pass was completed
(section 13).
