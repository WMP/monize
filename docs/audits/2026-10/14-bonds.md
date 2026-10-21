# Session S14: Bonds

## 1. Metadata

| Field | Value |
| --- | --- |
| Session | S14 (wave 3, run in parallel with S13 and S15 under orchestration) |
| Status | done |
| `AUDIT_BASELINE_SHA` | `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86` |
| `git rev-parse HEAD` at start | `de2683748c5b4aaf8edbdb60ef17a99223933b85` (pin check of plan step 2: empty diff outside `docs/audits/`) |
| Date | 2026-10-21 |
| Primary path | `backend/src/bonds/` |
| Hint line used | `prioritize a bond-linked holding valued from its own lots and never quantity times a blended price, accrued interest and day-count at redemption boundaries, engine price recompute after the benchmark refresh (ordering across replicas), early redemption fees and rounding residuals, series fetch idempotency and provider failure, and every total that can be partial` |
| Toolchain | Node 24.22.1 (`/opt/nvm`), `npm ci` in `backend/`, `dockerd` started by hand, PostgreSQL 16 (`mirror.gcr.io/library/postgres:16-alpine`) |
| Runtime executed | `TZ=UTC npm run test:unit -- src/bonds src/securities/portfolio-calculation src/securities/accrued-interest`: 53 suites, 1 401 tests, all pass. `TZ=UTC npm run test:integration -- "bond\|no-automatic-bonds\|redemption\|accrued"`: 12 suites (the 12 `bond-*` and `no-automatic-bonds` integration specs), 174 tests, all pass. 12 unit-level mutations in a scratch worktree at the baseline, all killed; the three lock and SQL-text rows re-run at integration level, all killed (section 6). One redemption example worked by hand against `docs/specs/bond-redemption-interest.md` section 3.1 (section 7). |

## 2. Invariant map

| ID | Statement (short) | Mechanism named | Path `producer -> transformations -> storage -> consumers -> side effects` | Holds? |
| --- | --- | --- | --- | --- |
| INV-BOND-001 | Terms, period rates, instruments, programs immutable | `bond_reject_mutation()` trigger on the four tables; `INSERT ... ON CONFLICT DO NOTHING`; `content_hash` compare in `storeEntry` | adapter fetch / admin entry -> `parseBondTerms` -> `BondSeriesService.store` (advisory lock `BondSeriesFetch`, `bond-series.service.ts:880`) -> `bond_terms_versions` -> `BondValuationService.loadTerms` (newest version) | Yes (`bond-reference-tables.integration.spec.ts` green) |
| INV-BOND-002 | A missing rate is unknown, never substituted | `resolvePeriodRates`/`ratesWithStarted` (`engine/rate-resolution.ts`); `inputsFor` returns null (`engine/bond-engine.ts:66-81`) | `benchmark_values` + `covered_through` -> `loadBenchmarks` (`bond-valuation.service.ts:850-903`) -> engine -> null figure, `missing[]` -> valuation API, notifications, price sync (no row) | Engine yes. **Downstream no**: a day with no engine row is valued by the blend readers from a carried price or a trade price (A26-S14-01) |
| INV-BOND-003 | Exact until the document rounds | `ExactDecimal`; `roundMoney` per bond then `x q` (`engine/bond-engine.ts:326-327`, `redemption-split.ts:48-64`); `country-agnostic.guard.spec.ts` | terms -> accrual (`engine/accrual.ts`) -> per-bond round -> lot | Yes (M1, M2 killed) |
| INV-BOND-004 | Known and projected never mix | `valueOn` status per flow, `maturityValueKnown` null while projected (`bond-engine.ts:566-571`) | rates -> flows -> valuation -> notifications item 2/3 | Yes |
| INV-BOND-005 | Engine price only, manual wins, unchanged day not rewritten | `upsertPrices` `WHERE source IS DISTINCT FROM 'manual' AND (...)` (`bond-price.service.ts:469-500`); `deleteStalePrices` binds `bond_engine`; advisory lock `BondPriceRecompute` first statement (`:195`) | ledger -> `dailyPrices` (fold per change date, `grossValueSeries` per distinct lot) -> blend `total/qty` 10 dp -> `security_prices` -> net worth, intraday, reports, Monte Carlo -> post-commit `invalidatePortfolioSummary` + `triggerDebouncedRecalc` | Price writer yes (integration green). Consumers read trade prices of linked securities through net-worth's `txFallback` (A26-S14-01) |
| INV-BOND-006 | Terms only from the official source or an admin | DTO with two bounded fields; `getFromIssuer` host/status/size/timeout refusals (`adapters/pl/series/series-source.ts:80-135`); one store path under the lock | request -> adapter -> cross-check -> template -> `store` -> catalog | Yes (sampled) |
| INV-BOND-007 | Rows name a series of the program; removals checked at write | `resolveTransactionSeries`; `BondWriteGuard` after `lockHoldingScope` (`investment-transactions.service.ts:1231->1238`, `2384->2388`, `4477->4482`) | write -> resolver -> row -> guard (`bondLotsFromTransactions` over `loadBondLedger`) -> commit | Yes (sampled) |
| INV-BOND-008 | Nothing fetched without a person | `benchmarksRead` reads stored series first (`benchmark-refresh.service.ts:156-183`); `autoFetchPrograms` (`bond-series.service.ts:471-486`); `no-automatic-bonds.guard.spec.ts` | cron / boot -> stored-series filter -> fetch | Yes (integration green) |
| INV-BOND-009 | Redemption cash = principalReturned + interest | `splitOf` (`engine/redemption-split.ts:92-125`): `interest = max(0, grossInterest - deduction)`, `principalReturned = payout - interest`, per bond then `x q` | lot + date -> `redemptionSplit` (`bond-engine.ts:605-656`) -> `BondHoldingsService.redemptionSplit` (FIFO by the write's own fold, `bond-holdings.service.ts:240-295`) -> form fills `price = principalReturned/q` (10 dp) and `accruedInterest` -> REDEEM + INTEREST companion -> one cash row (`disposalCashAmount`) | Yes; hand-worked (section 7) |
| INV-BOND-010 (`partial`) | A holding's current value is its own account's lots | `valueByAccount` + `ownLotsGrossValue` (`bond-valuation.service.ts:191-204, 461-495`), `valueBondHoldings` | ledger -> lots per account -> engine on financial today -> `calculateHoldingsWithValues`, `getAccountMarketValues`, sector weightings, GEM, balances report | Routed surfaces yes. **Three unlisted current surfaces read the blend** (A26-S14-02) and every blend surface prices an unknown day (A26-S14-01) |
| INV-BONDNOTIFY-001 | Producer fetches nothing | injects only valuation, holdings, dispatch (`bond-notification.service.ts:59-64`) | reads -> events -> `notify` after reads (`:149-161`) | Yes |
| INV-BONDNOTIFY-002 | One row per event | dedupe key + `ON CONFLICT DO NOTHING`; state-keyed prefixes kept by the purge | events -> `NotificationService.create` | Yes (integration green) |
| INV-BONDNOTIFY-003 | Figures are the engine's | event rules pure over `valueSecurity` / `redemptionSplit` (`:174-266`) | valuation -> rule -> copy | Yes; index says `enforced`, body says `partial` (D1) |
| INV-BONDNOTIFY-004 | Unknown said, never zero | `payoutOf`/`unknownPayout`, `sumExact` | split refusal -> null payout + code | Yes (sampled) |
| INV-BONDNOTIFY-005 | Country-agnostic | `country-agnostic.guard.spec.ts` | -- | Yes |
| INV-REDEEM-001 | Accrued interest moves cash once | `disposalCashAmount`; companion `transaction_id` NULL; `accrued-interest.guard.spec.ts` | REDEEM + `accruedInterest` -> companion -> one cash row | Yes (unit green; the bond form fills it from INV-BOND-009) |

Derived-value dependency matrix (Rule 5) for the engine price, the value every blend surface reads:

| Dependency | Mutation / refresh paths | Invalidation |
| --- | --- | --- |
| ledger rows of a linked security | UI, bulk, AI, MCP, import, undo/redo, restore | `recomputeLinkedSecurities` after the commit (INV-BOND-005 list) |
| stored series (terms) | fetch, offer, backfill, admin entry | `afterStored` -> `recomputeLinkedSecuritiesOfSeries` (`bond-series.service.ts:316-322`) |
| benchmark observations / coverage | cron 06:25 weekdays, boot warm-up, `refreshNeverFetched` | **none of its own**; the next 06:45 daily recompute (A26-S14-03) |
| user's financial today | clock, timezone preference | daily cron; request recompute |
| link (program) | `SecuritiesService.update`, undo | `clearEnginePrices` under the same lock |

## 3. Lens ledger

| Lens | Result |
| --- | --- |
| Pin revision | ran: empty diff outside `docs/audits/` against the baseline |
| Instructions first | ran: `AGENTS.md`, `CLAUDE.md`, `backend/CLAUDE.md`, the INV-BOND/BONDNOTIFY/REDEEM bodies, `bond-redemption-interest.md`, `redemption-accrued-interest.md`, `polish-retail-bonds.md` 6 (matured lots), `docs/cron-jobs.md` bond rows |
| Hypotheses from summaries | ran: S01 12.7 (Monte Carlo path, INV-BONDNOTIFY-003 status), S08 bond cron rows and the `bond-series` lease overrun, S12-01 and S12-06 patterns (sections 8 and 12) |
| Invariant model | ran (section 2) |
| Change surface / producer-consumer | ran: repo-wide sweep of current-value consumers of a bond-linked holding (31 rows, section 12) |
| Rule 4 read-model migration | ran: `bond_engine` blend vs own-lots value; every consumer of the stored price checked (A26-S14-01, -02) |
| Rule 5 dependency matrix | ran (section 2) |
| Cross-layer | ran: engine -> service -> endpoint -> form fill (`InvestmentTransactionForm.tsx:564-567`) -> REDEEM/companion -> cash |
| Representation boundary | ran: null vs zero in totals (`sumKnown`), REFUSED lot null, whole-number quantities, 10 dp blend, 4 dp money, `principalReturned/q` at 10 dp (R1) |
| Browser round trip | ran (limited): the form fill keeps a person's edit and an existing redemption's values per the spec; read `InvestmentTransactionForm.tsx:560-570` only; full UI round trip is S19's |
| Server-authoritative metadata | ran: `userId` from the JWT in every service read; series named by a client checked by the resolver; quantity `ParseBondQuantityPipe` |
| Identity vs value | ran: lots keyed by account, series, purchase date (`bond-holdings.service.ts:76-77`); `dailyPrices` lot key without account is a blend on purpose |
| State machine | ran: lot states OPEN / MATURED / REFUSED; redemption refusals; benchmark coverage forward-only |
| Concurrency / idempotency | ran: recompute lock first, series store lock then re-read, write guard after `lockHoldingScope`, notification dedupe, benchmark upsert converges |
| Partial failure | ran: series store before the post-commit refresh and recompute; a failed refresh or recompute logged, repaired by the daily job |
| External provider | ran: timeout -> `SOURCE_UNAVAILABLE` -> backfill pass stops; current-offer pass per code; no negative cache in the cron's unbounded backfill (DR4, call model) |
| Database / migration | not applicable to a finding: no schema read beyond `investment_transactions.price NUMERIC(24,10)`, `security_prices.close_price NUMERIC(24,10)`; S05 owns parity |
| Backup / restore | not applicable as a lens run here: S06 owns it; INV-BOND-005 restore behaviour taken from its body only |
| Financial | ran: numerical examples in A26-S14-01, -02, section 7, DR1 |
| AuthZ / RLS | ran (sampled): every bond read is `withScopedDb`; cross-user listing in `withSystemContext`, per user `withUserContext` (`bond-price.service.ts:129-160`, `bond-notification.service.ts:104-124`) |
| Tests as evidence | ran: mutation table; the suites that hold the blend consumers stop at the engine price (section 10) |
| Mutation | ran: 12 executed mutations (section 6) |
| Counterexamples / interaction | ran (section 7) |
| Adversarial approval challenge | ran (section 13) |

## 4. Confirmed findings

### A26-S14-01 - On a day the bond engine refuses to price, the blend readers still value the holding, from a carried-forward engine close or one lot's trade price

1. **Severity:** MEDIUM
2. **Confidence:** medium-high (static, traced through every branch named; not executed against a database, see 14)
3. **Location:** `backend/src/net-worth/net-worth.service.ts:1891-1895` (`loadDailyInvestments`), `:2924-2928` (`recalculateBrokerageAccount`, the stored `monthly_account_balances.market_value`), `:3071-3118` (`loadTxPriceSeries`, no bond-linked exclusion); `backend/src/net-worth/position-price.util.ts:68-84` (`positionClosePointAsOf`: the newer of the stored close and the transaction price); producer of the gap `backend/src/bonds/bond-price.service.ts:435-443, 502-516` (no row for a day whose lots or rates are unknown, and its stale rows deleted). Secondary consumers (sweep, section 12): `getLatestNetWorth` (`net-worth.service.ts:1051`) and through it the dashboard net worth and `AccountsService.getSummary` / `getLlmAccounts` totals (`accounts.service.ts:1598, 1817`); `foldInvestmentBreakdown` (`:2281`); the period result end value (`portfolio-period-result.service.ts:295`, `portfolio-period-results-batch.service.ts:235`); `daily-movement.service.ts:363`; `investment-report-data.service.ts:371`; `monte-carlo.service.ts:512-539, 709-726`; `portfolio.service.ts:1466` (month-over-month movers); `portfolio-price-freshness.util.ts:215`.
4. **Violated invariant:** INV-BOND-010 "An unknown lot makes the holding unpriced (marketValue null, pricesComplete false), never the blend"; INV-BOND-002 (a started period without a rate has no value, nothing substitutes another value); INV-BOND-005 "a transaction price is one lot's trade price, not the holding's value"; AGENTS.md "A subtotal is not a total".
5. **Realistic reproduction scenario:** Account A holds 100 bonds of EDO1034 (bought 2024-10-15 at 100.00; the engine prices it daily). On 2026-10-14 the person imports an OFX/QIF file with a BUY of 10 more EDO at 100.00 dated in a month whose series is not in the catalog. Per INV-BOND-007 the import stores the row with `bond_instrument_id` NULL and counts it in `bondRowsWithoutSeries`. From 2026-10-14 `bondLotsFromTransactions` refuses with `SERIES_NOT_DETERMINED` (`bond-lots.ts:229-236`), so `dailyPrices` emits no price for 2026-10-14 onward and `deleteStalePrices` removes any engine row there. The same happens without an import whenever a started period's benchmark observation is missing (a stalled CPI feed, a benchmark never fetched), or a lot is REFUSED (`PURCHASE_OUTSIDE_SALE_WINDOW`).
6. **Observed behaviour:** The portfolio summary and account market values (routed through `valueBondHoldings`) say the holding is unpriced: `marketValue` null, `pricesComplete` false. Net worth, the account summary totals, the period result and the investment report instead value the 110 bonds at `positionCloseAsOf`: the newer of the last engine close (2026-10-13) and the import row's trade price (2026-10-14, 100.00), so 110 x 100.00 = 11,000.00, presented as a settled figure. Without a priced row on or after the gap (a missing rate, an ADD_SHARES), the last engine close is carried forward over the unknown days for every lot, the unknown ones included.
7. **Expected behaviour:** A day on which the engine refuses a linked security's lots is unknown on every surface: the figure is null (or relabelled as a known subtotal of the derivable lots) with the refusal named, as the routed surfaces already do. A transaction price of a linked security never stands for the holding's value.
8. **Impact:** Financial display integrity. Numerical example (the engine close is illustrative, the arithmetic is exact): engine close on 2026-10-13 P = 111.62; known part (the 100 derivable bonds) = 11,162.00; the 10 new bonds unknown. Net worth shows 11,000.00 as a total; the honest answer is "unknown" with a known subtotal of 11,162.00 for the 100 bonds; difference against that subtotal 162.00 (1.45 %), and the figure carries no flag. In the carry-forward variant (no newer trade price) it shows 110 x 111.62 = 12,278.20, which prices 10 bonds the engine cannot value. The dashboard net worth and the per-account list (routed) then disagree by the whole holding. The AI/MCP `list_accounts` totals inherit the same figure. No balance or ledger row is wrong; the derived figures are.
9. **Root cause:** The blend readers treat `security_prices` as "the latest accepted close on or before the day", the right rule for a quoted security. For a bond-linked security the absence of an engine row is a refusal, not a missing quote, and `loadTxPriceSeries` and `positionClosePointAsOf` know nothing of the link, so the refusal is overwritten by a carry-forward or a trade price.
10. **Recommended correction:** In the net-worth valuation series, for a security with `bond_program_id`, read only `bond_engine` (or `manual`) rows and only on their own day: no transaction-price fallback and no carry-forward past a day the engine left without a row; a missing day makes the security's value for that day unknown and the series' completeness flag false, the same `FxAggregate`/`pricesComplete` channel the series already uses for a missing rate. The decision belongs to S13 (net worth) for the flag plumbing; this slice states the bond side.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/net-worth/net-worth.service.ts
+++ b/backend/src/net-worth/net-worth.service.ts
@@ -3079,10 +3079,14 @@ export class NetWorthService {
     const rows = await this.scopedQuery<TransactionPriceRow>(
       `WITH boundary_dates AS (
          SELECT DISTINCT ON (security_id) security_id, transaction_date
            FROM investment_transactions
           WHERE security_id = ANY($1::UUID[])
+            -- A bond-linked security is valued by the engine only (INV-BOND-005,
+            -- INV-BOND-010): one lot's trade price never stands for the holding.
+            AND security_id NOT IN (
+                  SELECT id FROM securities WHERE bond_program_id IS NOT NULL)
             AND action = ANY($2)
@@ -3102,6 +3106,8 @@ export class NetWorthService {
        windowed AS (
          SELECT security_id, transaction_date,
                 ROUND(AVG(price::numeric), 6) AS price
            FROM investment_transactions
           WHERE security_id = ANY($1::UUID[])
+            AND security_id NOT IN (
+                  SELECT id FROM securities WHERE bond_program_id IS NOT NULL)
             AND action = ANY($2)
--- a/backend/src/net-worth/position-price.util.ts
+++ b/backend/src/net-worth/position-price.util.ts
@@ -51,6 +51,20 @@
+/**
+ * A bond-linked security's close on `date` itself, or null: the engine writes a
+ * row for every day it can value and none for a day it refuses (INV-BOND-002),
+ * so a carried close would price a refusal.
+ */
+export function engineCloseOn(
+  stored: PricePoint[] | undefined,
+  date: string,
+): number | null {
+  const point = stored && stored.length > 0 ? pointAsOf(stored, date) : null;
+  return point && point.date === date ? point.close : null;
+}
```

    and at `net-worth.service.ts:1891` and `:2924`, `const price = security?.bondProgramId ? engineCloseOn(pricesBySec.get(secId), dateStr) : positionCloseAsOf(...)`, with a null price recorded as an unknown component of that day's `FxAggregate` (not skipped). **Incomplete**: the month-end variant (`:2924`) needs a decision for a month whose last day falls before the user's financial today has been priced (the 06:45 cron), and the series flag that carries "unknown" to the dashboard and the LLM shape is S13's; `securities.bond_program_id` is assumed to be on the loaded `securityMap` entity.
12. **Recommended regression test:** an integration test with one linked security, two derivable lots and a third BUY stored with a NULL series: `getDailyInvestments` (and `getLatestNetWorth`) on a day after the NULL row reports the security unknown, never `quantity x` the trade price or the carried engine close.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
--- a/backend/test/integration/bond-holding-value.integration.spec.ts
+++ b/backend/test/integration/bond-holding-value.integration.spec.ts
@@
+  it("a day the engine refuses is unknown in net worth, never a trade price", async () => {
+    // 100 bonds of a stored series bought 2024-10-15; recompute writes engine rows.
+    // A BUY of 10 at 100.00 on 2026-10-14 written with bond_instrument_id NULL
+    // (the import path), then recompute: no engine row from 2026-10-14.
+    const series = await netWorth.getDailyInvestments(userId, "2026-10-13", "2026-10-15");
+    const day = series.find((p) => p.date === "2026-10-15")!;
+    expect(day.value).toBeNull();               // not 11000.00
+    expect(day.valuationComplete).toBe(false);
+  });
```

14. **Verification method:** the integration test above against PostgreSQL; `bond-prices.integration.spec.ts` and `bond-holding-value.integration.spec.ts` still green; the net-worth unit suite for the non-bond fallback (a manual or imported price still honoured for an ordinary security, #1242). Not executed in this session: the scenario needs the import writer plus the net-worth fold on a real database, and MEDIUM does not require it under plan step 7.
15. **Residual risks:** the diff does not cover the intraday path (`portfolio.service.ts:2049, 2577-2586`), which values a linked security at the ledger close of the day, nor the per-account split (A26-S14-02).

Causality: `NEW_SINCE_UPSTREAM_AUDIT` (the bond link and the engine price are new; the net-worth fallback predates them and was not adapted). Surfaces (Rule 7): net worth daily and monthly, latest net worth (dashboard, account summary totals, LLM account totals), period result, daily movement, investment report, Monte Carlo, month-over-month movers, late-price adjustment. Overlap: S13 owns the net-worth flag; consolidate there in S23 if S13 reports the same root.

### A26-S14-02 - Three current per-account surfaces value a bond-linked holding at quantity x the blended price; INV-BOND-010 lists only historical series as not enforced

1. **Severity:** LOW
2. **Confidence:** high
3. **Location:** `backend/src/monte-carlo/monte-carlo.service.ts:709, 717-728` (`getHoldingStats`, per-account `marketValue`); `backend/src/investment-reports/investment-report-data.service.ts:333, 368-369` (`computeHoldings`, per account unless `mergeAccounts`, as-of defaulting to the latest market day); `backend/src/net-worth/net-worth.service.ts:2924-2935` (`recalculateBrokerageAccount`, current month's per-account `market_value`, read by net worth by account). Index: `docs/system-invariants.md:3880-3898` (INV-BOND-010 Enforcement).
4. **Violated invariant:** INV-BOND-010: the current market value of a bond-linked holding (one account, one security) is its own account's lots, never quantity x the daily blend.
5. **Realistic reproduction scenario:** One security linked to an EDO-like program; account A holds 100 bonds of an older series, account B 100 bonds of a newer one. Engine gross values today (illustrative): A 111.62 per bond, B 101.10 per bond. Blend = (11,162.00 + 10,110.00) / 200 = 106.36.
6. **Observed behaviour:** Monte Carlo's holding stats, the investment report and net worth by account show A = 10,636.00 and B = 10,636.00.
7. **Expected behaviour:** A = 11,162.00, B = 10,110.00, as the portfolio summary and the account list (`valueBondHoldings`) show; difference 526.00 per account (4.7 % of A, 5.2 % of B). Totals agree (21,272.00), so the error is the split.
8. **Impact:** per-account figures disagree across surfaces for a person holding one bond program in two accounts; the Monte Carlo per-account table and the investment report misstate each account. No total, ledger row or balance is wrong. The S01 hand-off named the Monte Carlo path; the weighting path (`:512-539`) sums over accounts and is exact (R6).
9. **Root cause:** These surfaces read `security_prices` per holding; the index's "not enforced" list names only historical per-account series, so the current surfaces were never routed.
10. **Recommended correction:** route the three current surfaces through `valueBondHoldings` (or `ownLotsGrossValue` per holding) as `calculateHoldingsWithValues` does; and widen the INV-BOND-010 Status text to name what is still unrouted, so the index states the gap honestly.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/monte-carlo/monte-carlo.service.ts
+++ b/backend/src/monte-carlo/monte-carlo.service.ts
@@ -706,6 +706,9 @@
     const currentPrices =
       await this.portfolioService.getLatestPrices(securityIds);
+    // A bond-linked holding is its own account's lots (INV-BOND-010).
+    const bondValues = await this.portfolioCalculation.valueBondHoldings(
+      userId, active);
@@ -722,8 +725,11 @@
         quantity: Number(h.quantity),
-        marketValue:
-          price == null ? null : roundMoney(Number(h.quantity) * price),
+        marketValue: h.security?.bondProgramId
+          ? bondValues.get(`${h.accountId}:${h.securityId}`) ?? null
+          : price == null
+            ? null
+            : roundMoney(Number(h.quantity) * price),
--- a/docs/system-invariants.md
+++ b/docs/system-invariants.md
@@ -3897,1 +3897,4 @@
-Status              partial (historical per-account series)
+Status              partial (historical per-account series; and three current
+                    per-account surfaces still read the blend: Monte Carlo
+                    holding stats, the investment report holdings, net worth by
+                    account for the current month)
```

    **Incomplete**: `valueBondHoldings`' exact signature and return shape (`portfolio-calculation.service.ts:1742`) must be matched, and `MonteCarloService` may not inject `PortfolioCalculationService` today; the investment report and the net-worth month need the same routing in their own idiom.
12. **Recommended regression test:** a Monte Carlo `getHoldingStats` unit test with two accounts holding different series of one program, asserting each account's `marketValue` equals its lots' value.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
--- a/backend/src/monte-carlo/monte-carlo.service.spec.ts
+++ b/backend/src/monte-carlo/monte-carlo.service.spec.ts
@@
+  it("values a bond-linked holding from its own account's lots", async () => {
+    // valueBondHoldings mock: A -> 11162.00, B -> 10110.00; getLatestPrices -> 106.36
+    const stats = await service.getHoldingStats(userId, [accountA, accountB]);
+    expect(stats.find((a) => a.accountId === accountA)!.holdings[0].marketValue).toBe(11162);
+    expect(stats.find((a) => a.accountId === accountB)!.holdings[0].marketValue).toBe(10110);
+  });
```

14. **Verification method:** the unit test above; `portfolio-calculation.service.spec.ts` unchanged; `instruction-files`/`doc-paths` specs after the doc edit.
15. **Residual risks:** the routed value is computed on the person's financial today; the investment report's as-of may be a past day, which needs `valueByAccount(userId, securityId, date)` with that date.

Causality: `NEW_SINCE_UPSTREAM_AUDIT`.

### A26-S14-03 - A benchmark observation stored outside the 06:25 run is not followed by a price recompute

1. **Severity:** LOW
2. **Confidence:** high (static)
3. **Location:** `backend/src/bonds/benchmark-refresh.service.ts:79-90` (boot warm-up), `:127-148` (`refreshNeverFetched`), `:351-414` (`store`, no recompute); `backend/src/bonds/bond-series.service.ts:316-322` (`afterStored`); `backend/src/bonds/bond-price.service.ts:103-119` (the only scheduled recompute, 06:45 Warsaw).
4. **Violated invariant:** INV-CACHE-001 (derived state is invalidated after the commit that changed its input) applied to INV-BOND-005's engine price, whose inputs include the benchmark observations.
5. **Realistic reproduction scenario:** (a) A deploy rolls at 11:00 on the day GUS publishes a CPI value that an EDO lot's new period needs; the boot warm-up (`onlyStale`) stores it. (b) A person fetches a new series whose benchmark was never fetched while another replica holds the `bond-benchmarks` lease for a run that computed its `needed` set before the series existed: `refreshNeverFetched` loses the lease and returns, then `recomputeLinkedSecuritiesOfSeries` recomputes without the observation.
6. **Observed behaviour:** (a) The engine rows for the days the new value makes derivable are written only at the next 06:45 run, up to about 20 hours later; (b) the benchmark is fetched at the next weekday 06:25 run, so a Friday-morning series store waits until Monday 06:25/06:45, about 3 days.
7. **Expected behaviour:** a store that changed or added observations, or a correction (`benchmark-refresh.service.ts:400-404` logs it), recomputes the engine prices of the securities whose series read that benchmark, after its commit.
8. **Impact:** for those hours or days the stored price history lacks the days in question, and the blend surfaces fall back per A26-S14-01. Live valuations (`valueByAccount`, the security page) read the observations directly and are correct. Narrow, self-healing.
9. **Root cause:** `BenchmarkRefreshService` has no post-store dispatch, and the only consumer link is the wall-clock gap of 20 minutes between the two crons (DR2).
10. **Recommended correction:** have `store` report whether any row was inserted or changed, and after `refreshAll` commits dispatch `recomputeLinkedSecuritiesOfSeries` for the instruments whose newest terms read a changed code, outside the lease call. This inverts no module edge if the dispatch lives in `BondSeriesService` or a small coordinator; `BenchmarkRefreshService` cannot inject `BondPriceService` without checking `src/module-graph.spec.ts`.
11. **Suggested remediation diff:** incomplete. Supported part:

```diff
--- a/backend/src/bonds/benchmark-refresh.service.ts
+++ b/backend/src/bonds/benchmark-refresh.service.ts
@@ -351,7 +351,7 @@
   private async store(
     code: string,
     result: BenchmarkFetchResult,
-  ): Promise<void> {
+  ): Promise<boolean> {
+    let changed = false;
@@ -399,6 +400,7 @@
         );
+        changed = (corrections?.length ?? 0) > 0 || /* inserted rows */ false;
```

    Missing: the upsert's `RETURNING` already yields inserted and changed rows (`upserted`), but the outer `SELECT` joins `old` and drops insertions, so a second count of `upserted` is needed; and the caller that owns the recompute (a module-graph decision for the maintainer).
12. **Recommended regression test:** a unit test of the refresh: a store that inserts a new observation triggers one recompute dispatch for the series reading that code, after the store resolved; an unchanged store triggers none.
13. **Suggested regression-test diff:** omitted, depends on where the dispatch lives (item 11).
14. **Verification method:** the unit test; `benchmark-refresh.service.spec.ts`; `no-automatic-bonds.integration.spec.ts` (a recompute must not fetch).
15. **Residual risks:** a recompute of every linked security of every user after each correction may be costly; bounding it to the programs reading the code is required.

Causality: `NEW_SINCE_UPSTREAM_AUDIT`.

## 5. Prior-finding dispositions

This slice owns no `MON-*` finding (`prior-findings-register.md`: the bond module did not exist at `d5cea9bf`). Nothing to dispose of.

## 6. Mutation table

Executed in a scratch worktree at the baseline (`git worktree add <scratchpad>/mut 72c59ec4...`), one mutation at a time, reverted with `git checkout` after each; unit command `TZ=UTC npx jest src/bonds` (plus the named extra paths).

| ID | Invariant | Mutation (file:line, what) | Test that fails | Verdict |
| --- | --- | --- | --- | --- |
| M1 | INV-BOND-009 | `engine/redemption-split.ts:105-108` drop the `max(0, ...)` floor on interest | `engine/redemption-split.spec.ts`, `adapters/pl/redemption-split.golden.spec.ts` (3 tests) | covered |
| M2 | INV-BOND-009 | `engine/redemption-split.ts:115` `principalReturned = principal` | same two suites (3 tests) | covered |
| M3 | INV-BOND-007 | `bond-lots.ts:252-253` a removal ignores its named series | `bond-lots.spec.ts`, `bond-holdings.service.spec.ts` (9 tests) | covered |
| M4 | AGENTS "a subtotal is not a total" | `bond-valuation.service.ts:913` `sumKnown` skips a null instead of returning null | `bond-valuation.service.spec.ts` (3 tests) | covered |
| M5 | INV-BOND-009 endpoint | `bond-holdings.service.ts:252-255` drop the `transactionDate <= date` filter | `bond-holdings.service.spec.ts` (1 test) | covered |
| M6 | INV-BOND-002 (coverage forward-only) | `benchmark-refresh.service.ts:408` `covered_through = $2` | `benchmark-refresh.service.spec.ts` (1 test, SQL text) | covered (unit, SQL text only) |
| M7 | INV-BOND-005 manual wins | `bond-price.service.ts:486` drop `source IS DISTINCT FROM 'manual'` | `bond-price.service.spec.ts` (1 test, SQL text) | covered (unit, SQL text only) |
| M8 | redemption window | `engine/redemption.ts:34` `earliestDaysAfterPurchase` without `+ 1` | `adapters/pl/golden.spec.ts`, `engine/bond-engine.spec.ts` (3 tests) | covered |
| M9 | early-redemption floor | `engine/redemption.ts:101` floor applies to every period | `redemption-split.spec.ts`, golden (15 tests) | covered |
| M10 | INV-BOND-010 | `bond-valuation.service.ts:200` drop the `QUANTITY_MISMATCH` check | `securities/portfolio-calculation.service.spec.ts` (1 test) | covered |
| M11 | INV-BOND-005 concurrency | `bond-price.service.ts:195` drop the `BondPriceRecompute` advisory lock | `bond-price.service.spec.ts` (2 tests, call order on a mock) | covered (unit, mock order only) |
| M12 | INV-BOND-006 concurrency | `bond-series.service.ts:880` drop the `BondSeriesFetch` advisory lock | `bond-series.service.spec.ts` (4 tests, call order on a mock) | covered (unit, mock order only) |

The three rows whose unit kill rests on SQL text or mock call order were re-run against PostgreSQL with `TZ=UTC npm run test:integration -- "bond-prices|bond-series-fetch"` (baseline in the main tree: 2 suites, 71 tests, pass):

| ID | Integration result | Verdict |
| --- | --- | --- |
| M7 | `bond-prices.integration.spec.ts` 4 tests fail (the manual price is overwritten) | covered at integration level |
| M11 | `bond-prices.integration.spec.ts` 2 tests fail | covered at integration level |
| M12 | `bond-series-fetch.integration.spec.ts` 1 test fails | covered at integration level |

No mutation survived, so this session adds no row to the program-wide undetected list. The conceptual mutations for the three findings are undetected by construction (section 10): for A26-S14-01, making `positionClosePointAsOf` prefer a trade price on a linked security changes no bond or net-worth test result, because no suite values a linked security in net worth on a day without an engine row; for A26-S14-02, no suite checks a per-account bond value on the three surfaces; for A26-S14-03, no suite asserts a recompute after a benchmark store.

## 7. Counterexamples and the interaction scenario

**Hand-worked redemption (spec `bond-redemption-interest.md` 3.1, row "EDO early, interest above the fee"), traced through the code, q = 3:**
`figuresOn`: value before penalty per bond 110.20 -> `grossBond = roundMoney(110.20) = 110.20`; `proceedsPerBond`: `FIXED_FEE_PER_UNIT` 3.00 -> net `roundMoney(107.20)`; floor `FACE_VALUE` -> `max(107.20, 100.00) = 107.20 = earlyBond`. `splitOf`: `grossInterest = 110.20 - 100.00 = 10.20`; `deduction = 110.20 - 107.20 = 3.00`; `interest = max(0, 10.20 - 3.00) = 7.20`; `principalReturned = 107.20 - 7.20 = 100.00`. Lot: 330.60 / 30.60 / 9.00 / 21.60 / 300.00 / 321.60. Form: `price = 300.00 / 3 = 100.0000000000`, `accruedInterest = 21.60`; REDEEM `total_amount = 300.00`, companion 21.60, one cash row `disposalCashAmount = 321.60`. Identity `payout = principalReturned + interest` holds (321.60 = 300.00 + 21.60); realized gain 0 against a cost of 300.00. Matches the spec row. The two other early rows check the same way: interest below the fee (gross 101.50, payout max(98.50, 100.00) = 100.00, interest 0, principalReturned 100.00) and COI period 2 (gross 101.20, flat 2.00, no floor, payout 99.20, interest max(0, -0.80) = 0, principalReturned 99.20). Algebraically `interest = max(0, payout - principal)` and `principalReturned = min(payout, principal)`, so INV-BOND-009's three conditions hold for every input.

**Boundary days:** `windowRefusal` `TOO_EARLY` until `purchaseDate + N + 1` (`redemption.ts:31-38`, mutation M8); on the maturity date `matured` is true and the payout is `maturityValue` with deduction 0 (`bond-engine.ts:624-637`); after maturity the date is clamped to the maturity day for the principal and the rates (`day = p.maturity`).

**Counterexamples tried:** same series bought on two days of its sale month, redeemed at the second lot's maturity (FIFO takes the older lot; same month, same rates, same figures: R8); final coupon of a coupon bond notified and also in the redemption (rejected: `interestCandidates` requires `maturityDate > date`, R7); a lot count off by a fraction from the holding (whole numbers only: R3); a redemption split across portions with different per-bond figures (`principalReturned/q` at 10 dp: R1).

**Interaction scenario (INV-BOND-007 import NULL x INV-BOND-005 engine price x net-worth fallback):** a file import stores a BUY without a series (allowed), the engine stops pricing from its date (correct), and the net-worth fold, which is correct for quoted securities, picks the import's trade price as the holding's close: A26-S14-01.

## 8. Rejected hypotheses

| Candidate | Evidence considered | Why rejected or downgraded | Final classification |
| --- | --- | --- | --- |
| R1 Rounding residual from `price = principalReturned / q` when the removed portions have different per-bond figures | `InvestmentTransactionForm.tsx:567` rounds to 10 dp; `investment_price NUMERIC(24,10)`; `total_amount NUMERIC(20,4)` | The error is at most 5e-11 x q; it reaches 0.0001 only at q of about 10^6 bonds | REJECTED |
| R2 `bond-series` lease (90 min) outrun, S08 hand-off | `getFromIssuer` maps a timeout to `SOURCE_UNAVAILABLE` (`series-source.ts:90-102`), which ends the backfill pass (`bond-series.service.ts:807-811`); the cron fires once a day | A hung source stops the pass at the first timeout; no second runner exists the same day; the store is idempotent under the lock | REJECTED |
| R3 A26-S12-06 (sub-0.0001 snap) in bonds/ | `bondLotsFromTransactions` refuses fractional quantities; `ownLotsGrossValue` tolerance compares whole numbers | No snap reachable; a fractional row refuses the lots and names the row | REJECTED |
| R4 A26-S12-01 (decision from a snapshot read before the lock) in bonds/ | `recomputeSecurity` locks first (`bond-price.service.ts:195`); `store` locks then re-reads (`:880`); write guard after `lockHoldingScope` (create 1231->1238, transfer 2384->2388, update 4477->4482) | The bond paths decide after the lock; S12-01's cash-leg snapshot is S12's and covers bond rows too | REJECTED for bonds/ |
| R5 `GREATEST(covered_through)` defeats the NBP "archive behind" safety | `pl-nbp-reference.ts:140-178`; `benchmark-refresh.service.ts:406-412` | Forward-only coverage never extends coverage on an archive-behind fetch; it keeps the older, smaller date | REJECTED |
| R6 Monte Carlo weighting (`monte-carlo.service.ts:512-539`) wrong for bonds | blend = total gross / total quantity | Summed over accounts, quantity x blend is the security's exact gross; only the per-account path is wrong (A26-S14-02) | DOWNGRADED into A26-S14-02 |
| R7 Final coupon counted twice (interest notification and redemption split) | `bond-notification-events.ts:342-346` | Item 2 requires `maturityDate > date`; the maturity coupon is only in the redemption split | REJECTED |
| R8 Maturity payout of the wrong lot (FIFO) | `bond-holdings.service.ts:84-100`; sale window is one month | Lots of one series share the period months, so the rates and figures are equal | REJECTED |
| R9 Redemption endpoint vs the write's order on the same day | the endpoint appends the REDEEM after every same-day row; an edited row keeps its `created_at` position | A same-day BUY created after an edited REDEEM could be counted by the endpoint and refused by the write; reachable only by editing a redemption on a day with a later same-day purchase that it needs; the write still refuses | DESIGN_RISK, not a finding |
| R10 NBP coverage `today` at 06:25 claims an unfinished day | decisions take effect the day after their announcement | The value effective today is known at 06:25 | REJECTED |
| R11 `valueSecurity` totals null for a matured or not-redeemable lot's `earlyRedemptionValue` | `bond-valuation.service.ts:439-441`, `sumKnown` | A total of early-redemption proceeds over lots some of which cannot be redeemed early has no value; null is honest | REJECTED |

## 9. Design risks

- **DR1 Matured coupon lot value excludes the final coupon until the REDEEM is booked.** `bond-engine.ts:349-358`; sanctioned by `polish-retail-bonds.md` 6 (lines 490-497). A matured COI1030 lot with period 4 at 5.00 % is worth 100.00 per bond in every holding surface from the maturity day, while it pays 105.00 when booked; the notification of item 4 names the payout. Same ledger lag as every unbooked coupon; not a present-day contradiction of a contract.
- **DR2 The price cron follows the benchmark refresh by wall clock only** (06:25 weekdays, 06:45 daily, Europe/Warsaw, separate leases). A refresh still running at 06:45 on another replica is not waited for; the 10-minute lease and two small documents make that unlikely. A26-S14-03 covers the stores outside the window.
- **DR3 The redemption endpoint's same-day order** (R9).
- **DR4 No negative cache in the cron's unbounded backfill.** `backfillHistory` claims an attempt lease only when `limit` is set (`bond-series.service.ts:772-788`); the 07:15 cron passes none, so every code that answers `SERIES_NOT_PUBLISHED` or `SOURCE_DOCUMENT_MISSING` is asked again each day. Call model: k such codes cost k x (3 s gap + 1-2 requests) per day; with 8 products from 2024-01 (`backfill-codes.ts`, about 270 codes by 2026-10) the bound is about 15 minutes a day of polite requests if every code were missing. An optimization, not a defect (Rule 6).

## 10. Missing tests and known-wrong tests

- No test values a bond-linked security in net worth on a day the engine left without a row (A26-S14-01); `bond-holding-value.integration.spec.ts` covers the routed surfaces only.
- No test of the per-account value of a linked security on Monte Carlo holding stats, the investment report or net worth by account (A26-S14-02).
- No test that a benchmark store is followed by a recompute (A26-S14-03).
- Coverage-forward-only (M6) is held by an SQL-text unit assertion only; no integration test stores an archive-behind NBP fetch after a newer one.
- No known-wrong test found in the slice.

## 11. Documentation inconsistencies

- **D1** INV-BONDNOTIFY-003: index row `enforced` (`docs/system-invariants.md:116`), body `partial` (`:3968-3969`). Confirms the S01 hand-off.
- **D2** INV-BOND-010 Enforcement lists only historical per-account series as unrouted (`:3885-3889`); three current surfaces read the blend (A26-S14-02), and every blend surface values a refused day (A26-S14-01).
- **D3** INV-BOND-005 says "a transaction price is one lot's trade price, not the holding's value" and covers the `security_prices` writers only; `NetWorthService.loadTxPriceSeries` reads trade prices of linked securities as closes.
- **D4** `docs/cron-jobs.md:42` says the bond price cron runs "After the benchmark refresh"; the ordering is a 20-minute clock gap with no dependency, and a store outside the 06:25 run has no recompute of its own (A26-S14-03).

## 12. Review ledger

- **Directories inspected:** `backend/src/bonds/` (engine, domain, services, adapters/pl sampled), `backend/src/net-worth/` (valuation series), `backend/src/monte-carlo/`, `backend/src/investment-reports/` (one function), `backend/src/securities/investment-transactions.service.ts` (lock and guard order only).
- **Files read in full:** `engine/redemption-split.ts`, `engine/redemption.ts`, `engine/accrual.ts`, `engine/bond-engine.ts`, `bond-holdings.service.ts`, `bond-lots.ts`, `bond-valuation.service.ts`, `bond-price.service.ts`, `benchmark-refresh.service.ts`.
- **Files sampled with ranges:** `bond-series.service.ts` 130-200, 205-364, 425-514, 660-975; `bond-notification.service.ts` 60-270; `bond-notification-events.ts` 330-375; `adapters/pl/pl-nbp-reference.ts` 120-178; `adapters/pl/series/series-source.ts` 50-135; `adapters/pl/series/backfill-codes.ts` (whole); `bond-write-guard.ts` 1-60; `monte-carlo.service.ts` 495-545, 686-735; `investment-report-data.service.ts` 330-380; `net-worth.service.ts` 1720-1735, 1880-1910, 2905-2935, 3071-3200; `position-price.util.ts` 51-84; `docs/specs/polish-retail-bonds.md` 486-500.
- **Not read (sampled by invariant only through their suites):** `engine/rate-resolution.ts`, `domain/bond-terms.ts`, `bond-catalog.service.ts`, `bond-offer.service.ts`, `bond-series-resolver.ts`, `bonds.controller.ts`, the rest of `adapters/pl/`, `frontend/src/components/bonds/`.
- **Searches:** repo-wide sweep (read-only agent, spot-checked by me at the five rows that became findings) of every current-value computation of a holding: 31 rows; callers of `valueByAccount`/`ownLotsGrossValue`/`valueBondHoldings` (portfolio-calculation 1787, 1816, 1899; portfolio 1509; sector-weighting 388, 665; gem-position 555; account-balances-report 636, 683); callers of `recomputeAll`, `recomputeLinkedSecuritiesOfSeries`, `refreshNeverFetched`; `SOURCE_UNAVAILABLE` producers; `lockHoldingScope` and `beginBondWriteGuard` order.
- **Suites run:** unit 53 suites / 1 401 tests pass; integration 12 suites / 174 tests pass (`bond-catalog`, `bond-holding-value`, `bond-import`, `bond-link-band`, `bond-notifications`, `bond-offer`, `bond-prices`, `bond-reference-tables`, `bond-series-fetch`, `bond-series-write`, `bond-valuation`, `no-automatic-bonds`); mutations in section 6.
- **Areas reviewed without a finding:** the redemption split identity and its booking; per-bond rounding; window refusals; lots per account and series; the price writer's precedence and deletes; recompute locking; series store idempotency; provider failure in the series fetch; notification dispatch outside transactions and the maturity-coupon exclusion; NBP and GUS coverage.
- **Finding counts:** BLOCKER 0, HIGH 0, MEDIUM 1 (A26-S14-01), LOW 2 (A26-S14-02, -03).

### 12.1 Text for the program ledger (for the orchestrator to merge)

- Session row: `S14 | done | 2026-10-21 | 2026-10-21 | <final commit> | 0/0/1/2 | 14-bonds.md; verdict APPROVE`.
- Suites: unit `src/bonds` + `portfolio-calculation` + `accrued-interest`: 53 suites, 1 401 tests, pass. Integration `bond*` + `no-automatic-bonds`: 12 suites, 174 tests, pass.
- Prior findings: none owned.
- Open hypotheses handed on:
  - from S14 to S13: A26-S14-01 is a net-worth valuation-series root (a linked security valued from a carried engine close or a trade price on a day the engine refuses); the flag plumbing (series completeness to the dashboard and the LLM shape) is S13's call; consolidate with any S13 finding on `positionCloseAsOf` / `txFallback` (including A26-S12-09's txFallback) under Rule 7.
  - from S14 to S13: the S01 Monte Carlo item is disposed of: the weighting path is exact for bonds, the per-account holding stats are A26-S14-02; the `currencyCode ?? "USD"` default at `monte-carlo.service.ts:721` is S13's FX lens.
  - from S14 to S20: the intraday path values a linked security at the ledger close (`portfolio.service.ts:2049, 2577-2586`) and drops bond holdings in the no-ledger branch (`:2589-2595`); not traced to a figure here.
  - from S14 to S19: the redemption form's fill (`InvestmentTransactionForm.tsx:560-570`) was read only for the price rounding; its keep-the-person's-edit behaviour is untested here.
  - from S14 to S21: no undetected mutation row (15 executed, 15 killed); M6 is held by SQL-text unit assertions only (no integration test of forward-only `covered_through`).
  - from S14 to S08: the `bond-series` lease-overrun hypothesis is rejected (R2).
- Program mutation table (undetected rows): none from S14.
- Deviations: run in parallel with S13 and S15; the ledger, `sessions.md` and the register were not edited (this section carries their text); the Docker daemon was started by hand and again after a worker restart; the consumer sweep was delegated to a read-only search agent and its finding rows spot-checked.

## 13. Adversarial approval challenge

Assumption: "a bond-linked holding is valued from its own lots everywhere, and every bond figure that can be unknown is null" is wrong. Started from the slice's own abstractions (the engine price row as the only stored bond value, `valueByAccount` as the only current value, `sumKnown` as the only total, the per-bond rounding, the leases), not from the findings.

- **Who reads the engine price row and for what?** Every consumer of `security_prices` for a linked security. Found the net-worth fold's `positionCloseAsOf` treats a missing engine row as a missing quote and fills it with a trade price (A26-S14-01), and three current per-account readers (A26-S14-02).
- **Can a total be partial?** `sumKnown` returns null on any null; `valueByAccount` nulls a REFUSED lot; `unitPrice` writes no row when any lot is unknown; the redemption endpoint sums portions with null propagation; `sumExact` in the notifications. The partial totals found are outside the module (A26-S14-01).
- **Precision transformations:** per-bond `toFixed(places)` then `x q` exact; blend 10 dp; form price 10 dp (R1). None material.
- **Legacy and mixed data:** rows without a series (import NULL, written before the link) -> `SERIES_NOT_DETERMINED`, honoured by the engine, not by the blend readers (A26-S14-01).
- **Retry and concurrency:** recompute serialized by the advisory lock taken first; series store lock then re-read; benchmark upsert converges; notifications deduped; the price cron's lease is a cost control. Nothing found.
- **Failure multiplicity at the provider:** series fetch bounded by the first timeout; benchmark refresh per series with a persistent-failure report after 3 days. Only DR4.
- **Ordering across replicas:** benchmark refresh then price recompute by clock; stores outside that window not followed by a recompute (A26-S14-03).
- **Changed behaviour in unchanged callers:** the net-worth and intraday folds predate the bond link and were not adapted (A26-S14-01).

Result: one MEDIUM and two LOW findings; no BLOCKER or HIGH candidate arose. The MEDIUM was not upgraded: no ledger or balance is wrong, the routed surfaces show the truth, and the wrong figures are derived and self-correct when the lots become derivable.

## 14. Verdict

**APPROVE** for the S14 slice at `AUDIT_BASELINE_SHA`: no BLOCKER or HIGH survived the adversarial approval challenge. The engine's redemption split, rounding, window refusals, lot derivation, price writer and series store hold their invariants, and the bond suites (1 401 unit, 174 integration tests) are green. One MEDIUM (A26-S14-01: blend readers value a day the engine refuses) and two LOW findings (A26-S14-02: three current per-account surfaces read the blend; A26-S14-03: no recompute after a benchmark store outside the 06:25 run), four documentation inconsistencies, four design risks.
