# S20 Frontend figures, reports, dashboard, pages, i18n

## 1. Metadata

| Field | Value |
| --- | --- |
| Session | S20 (child session_01VSrfzDF4F63zWMJY2giCfB), run in parallel with S18 and S19 (the S18 dependency waived by the orchestrator) |
| `AUDIT_BASELINE_SHA` | `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86` |
| `git rev-parse HEAD` at start | `7b38d09383f276ad893f9706c4f0e32aaaf09c7c` (pin check: `git diff --stat 72c59ec4... HEAD -- . ':!docs/audits/2026-10' ':!docs/audits/2026-08-upstream'` empty) |
| Date | 2026-10-21 |
| Primary path | `frontend/src/components/reports/` (XL, sampled by figure; ranges in section 12) |
| Secondary paths | `frontend/src/components/dashboard/`, `components/investments/` (portfolio chart only), `app/accounts/`, `app/dashboard/`, `lib/` figure helpers, `i18n/`; budgets, strategies, bonds and email-receipts UI sampled only |
| Hint line | `prioritize every total rendered from a server field that can be null or partial (caption relabelled, never a subtotal under a total's caption), valuationComplete read where the number is shown, a percentage only over the result, period change versus return, cash versus investments, the one money formatter and number localization, locale catalogs in parity with no hand-edited pseudo-locale, and a page that fetches under the wrong owner on a delegated session` |
| Runtime | Node 24.22.1; `npm ci` OK. `npm run i18n:check`: pass. Guard and i18n suites (`src/test/ui-conventions.test.ts`, `src/i18n`, scheduled-effective-amount, chart-reduction, loan-history, balance-cache guards): 16 files, 2049 tests, all pass. Component suites for the sampled figures: see 12.5. Eight focused probes in a scratch worktree at the baseline (section 4 evidence, all eight fail at the baseline as the findings predict). Eight mutations (section 6). `npm run build`: pass. |

## 2. Invariant map

| ID | Statement | Mechanism | Producer -> transformations -> storage -> consumers -> side effects |
| --- | --- | --- | --- |
| AGENTS "A completeness flag is read where the numbers are shown"; MON-H16 | A figure that is a subtotal is never shown under a total's caption; flags read `=== false` | per-surface reads of `valuationComplete` / `fxComplete` / `pricesComplete`; `PartialTotal`, `UnknownAmount` | `portfolio-calculation.service.ts` (`valuationComplete` per account and summary), `net-worth.service.ts` (`fxComplete` per month, per daily point) -> JSON -> `types/investment.ts`, `types/net-worth.ts` -> accounts page, dashboard widgets, net-worth report, portfolio charts, CSV/PDF |
| AGENTS "A subtotal is not a total"; "never default ... to 0" | `total*`, gain, `estimated*` null when a component is unknown, partial sum in its own field | `FxAggregate` server side; `sumConverted` / `combineTotals` client side | server totals stay numeric with flags beside them (design risk, A26-S02 section 9) -> consumers must read the flag |
| INV-PORTRESULT-001 | A period change is not a return; a percentage only over the result | `GET /net-worth/investments-period-result`, `usePortfolioPeriodResult` | server -> hook -> `PortfolioValueWidget`, `InvestmentValueChart`, `PortfolioValueReport`, `PortfolioPerformanceCard` (all read the server's result; no client subtraction found) |
| INV-PORTRESULT-002 | Cash is not an investment | `investedValue`, `breakdownInvestedValue` (`lib/invested-value.ts`) | daily series `securitiesValue` -> three investment charts; net-worth chart keeps `value` |
| INV-PORTCHART-001 | A long range is the daily series sampled; the first point is the close the figures are measured from | `sampling: 'monthEnd'`, `openingSessionDate` | read on all three portfolio surfaces |
| INV-REPORT-002 / exports | An export carries the screen's server-authoritative figure and its completeness | `ReportToolbarActions` `disabled`; `exportToPdf`, `exportToCsv` | `useReportData` keeps the last successful `data` through a failed or in-flight reload (`hooks/useReportData.ts:207-216`) -> report export handlers |
| INV-SANKEY (SANKEY-005) | Every card reads the server's totals, partial ones marked | `figure()` with `PartialTotal` (`CashFlowSankeyReport.tsx:146-154`) | server totals / knownTotals -> cards, table, PDF, CSV |
| Number localization | A number a person reads goes through `useNumberFormat` | rule only; no guard scans for `toFixed` / `toLocaleString()` | -- |
| i18n parity | Every locale has every key; `xx` generated | `messages.parity.test.ts`, `i18n:check` | both pass |
| Delegation / owner | A page never shows data fetched under another identity | full reload on context switch (`DelegationBanner.tsx:28-31`); `clearAllCache()` on logout | sessionStorage intraday cache is outside both (A26-S20-04) |
| INV-SHARE-001..005 | PWA share target | -- | not audited here; owned by S18 (ledger, "from S04 to S18") |

## 3. Lens ledger

| Lens | Status |
| --- | --- |
| Instructions before implementation | ran: `AGENTS.md`, root and `frontend/CLAUDE.md`, `docs/frontend/financial-figures.md` (full), `docs/frontend/api-and-cache.md` rules cited in `frontend/CLAUDE.md`, the hand-off sections of 02, 10, 12, 13, 14, 15, 16, 17 |
| Invariant model first | ran: section 2 |
| Change surface / producer-consumer | ran: every consumer of `MonthlyNetWorth`, `totalPortfolioValue`, `totalMarketValue`, `totalGainLoss`, `getInvestmentsDaily`, `getIntradayValue`, `getSummary` (`/transactions/summary`), `ReportToolbarActions` (49 call sites) |
| Calibration Rule 4 (semantic migration) | ran: `fxComplete` beside `netWorth` on `/net-worth/monthly` never reached the frontend type (A26-S20-01); `valuationComplete` beside `unpricedHoldingsCount` (A26-S20-01); nullable Cash Flow totals (A26-S16-04, confirmed, not re-reported) |
| Calibration Rule 5 (dependency mutation matrix) | ran for the intraday cache: user, acting context, range, accounts, currency; only the last three are in the key (A26-S20-04) |
| Cross-layer verification | ran: `portfolio-calculation.service.ts` -> `types/investment.ts` -> accounts page / reports (A26-S20-01, -02); `net-worth.service.ts` -> `types/net-worth.ts` -> report and dashboard |
| Representation boundary | ran: absent vs `false` flags (all reads found use `=== false`); `null` vs `0` (`countryResp?.totalPortfolioValue ?? 0`, A26-S20-05); stale `data` vs failed request (A26-S20-03) |
| Browser/UI round trip | not applicable: no input in this slice changes financial intent (forms are S19's); the export path is covered under exports |
| Server-authoritative metadata | ran: no client-supplied currency or owner in the report requests sampled; stored account ids reused across contexts (section 9, D-S20-02) |
| Identity versus value | ran: report rows keyed by server ids or ISO dates; `axisKey` pinned by its guard |
| State machine | not applicable: no lifecycle in the read-only figure surfaces |
| Concurrency / idempotency | ran (client form): `useReportData` run counter and request keys; stale-on-failure is A26-S20-03 |
| Partial failure | ran: one failed request in multi-request reports (Debt Payoff Timeline, Loan Amortization, Budget reports, Geographic, Sankey, dashboard page) |
| External provider | ran: intraday Yahoo failure paths as they reach the frontend (S14 hand-off, section 8) |
| Database / migration | not applicable: no schema in the slice |
| Backup / restore | not applicable |
| Financial lens | ran: each confirmed financial finding has a numerical example |
| AuthZ / RLS | ran for the frontend half only: delegation switch, logout, persisted storage (A26-S20-04) |
| Tests as evidence | ran: eight probes, eight mutations; undetected rows in section 6 |
| Mutation | ran: section 6 |
| Counterexamples / interaction | ran: section 7 |
| Adversarial approval challenge | ran: section 13 |

## 4. Confirmed findings

### A26-S20-01 - Completeness flags are not read where the totals are shown: the net-worth report and dashboard, the accounts page, the portfolio widget and the portfolio charts print subtotals as totals (MON-H16 residual, A26-S02-03, A26-S13-04 UI half)

1. **Severity:** HIGH (re-assessed from A26-S02-03's MEDIUM: the surface list now includes the Net Worth report and both dashboard net-worth widgets, and the omitted component is a whole account of any size; S23 to confirm)
2. **Confidence:** high (four surfaces executed, the rest read)
3. **Location (Rule 7, one root, every surface):**
   - (a) net worth: `frontend/src/types/net-worth.ts:3-15` (`MonthlyNetWorth` has no `fxComplete` / `missingRatePairs`, although `backend/src/net-worth/net-worth.service.ts:830-858` sends both per month); consumers `components/reports/NetWorthReport.tsx:135-187` (cards, table, chart), `:264-283` (PDF, CSV); `components/dashboard/NetWorthChart.tsx:88-113, 206-211`; `components/dashboard/AssetsVsLiabilities.tsx:55-64`.
   - (b) accounts: `app/accounts/page.tsx:115-141` (brokerage contribution gated on `unpricedHoldingsCount` only), `components/accounts/AccountList.tsx:1074`, `lib/logical-accounts.ts:225-240`.
   - (c) portfolio headline: `components/dashboard/PortfolioValueWidget.tsx:149, 287-291` (`formatCurrency(totalPortfolioValue)` with no flag).
   - (d) portfolio series: `components/investments/InvestmentValueChart.tsx:218-241` (every daily point plotted as `investedValue(d)` whatever `pricesComplete` / `fxComplete` say), `:503-508, 656-664` (Highest / Lowest cards ranked over those points); `PortfolioValueWidget.tsx:116-118` (sparkline).
   - (e) per-account breakdown: `components/reports/PortfolioValueReport.tsx:1042-1045` (CSV), `:1770-1784` (table: holdings, total, gain with no per-account `valuationComplete`); `components/reports/SecurityTypeAllocationReport.tsx:786` (footer "Total" prints the subtotal the card above it marks partial).
4. **Violated invariant:** AGENTS.md "A completeness flag is read where the numbers are shown ... relabel a partial figure rather than leaving a total's caption over it"; MON-H16; `types/net-worth.ts:30-35` ("Read the flags before printing this under a total's caption").
5. **Reproduction:** (a) reporting currency USD; a USD chequing account of 50,000 and an account in a currency with no rate (custom `ZZZ`, 1,000,000). Open Reports -> Net Worth. (b) a CAD brokerage with a USD position and no USD->CAD rate, every price present. (c) one unpriced holding worth about 50,000 beside 100,000 priced. (d) a holding with no accepted close for part of the window.
6. **Observed (executed):** (a) "Current Net Worth $50000", no marker, nothing names `ZZZ->USD` (probe P1 fails: `expected false to be true`). (b) Total Assets `$50000.00` with no "partial total" (probe P3 fails). (c) the widget prints `$100000` (probe P2 fails). (d) "Lowest Value $100.00" for the day the holding was unpriced (probe P4 fails). (e) read only.
7. **Expected:** each figure either marked partial with the missing pair or security named (`PartialTotal` / `IncompleteDataDetails`, as `PortfolioSummaryCard` and `PortfolioValueReport`'s daily path already do), or withheld; an incomplete point plotted as `null` and the extremes withheld (as `PortfolioValueReport.tsx:436-445, 757-776` does).
8. **Impact:** the net worth headline, the accounts page Net Worth and Total Assets, the dashboard's net-worth and asset/liability widgets and the portfolio widget omit a whole component silently: 1,000,000 ZZZ in (a), about USD 100,000 in (b), 50,000 (33 percent) in (c); a chart dip in (d) is ranked as the period low. The PDF and CSV exports of (a) and (e) carry the same subtotals out of the application.
9. **Root cause:** stage 1 of `docs/specs/fx-conversion-completeness.md` kept the figures numeric and put the flags beside them; three consumer families were not migrated (Rule 4): a type that never declared the flags (a), consumers keyed on the narrower `unpricedHoldingsCount` (b), and series consumers fixed in the report for #1389 but not on the investments page or the widget (d).
10. **Recommended correction:** declare the flags on `MonthlyNetWorth` and render the months through `PartialTotal`; gate the brokerage contribution and the widget headline on `valuationComplete === false`; reuse the report's per-point completeness and extremes rule in `InvestmentValueChart` and the widget; read the per-account `valuationComplete` in the breakdown table and CSV.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/frontend/src/types/net-worth.ts
+++ b/frontend/src/types/net-worth.ts
@@ export interface MonthlyNetWorth {
   netWorth: number;
+  /** False when a component of this month could not be converted; the three
+   *  figures are then subtotals. Optional: absent is no information. */
+  fxComplete?: boolean;
+  missingRatePairs?: string[];
   byAccountType?: Partial<Record<AccountType, number>>;
--- a/frontend/src/components/reports/NetWorthReport.tsx
+++ b/frontend/src/components/reports/NetWorthReport.tsx
@@ const summary = useMemo(() => {
-    if (chartData.length === 0) return { current: 0, change: 0, changePercent: 0 };
+    if (chartData.length === 0) return { current: 0, change: 0, changePercent: 0, missing: [] as string[] };
+    const last = monthlyData[monthlyData.length - 1];
+    const first = monthlyData[0];
+    const missing = [...new Set([...(last.missingRatePairs ?? []), ...(first.missingRatePairs ?? [])])];
@@
-          <div className={`text-2xl font-bold ${gainLossColor(summary.current)}`}>
-            {formatCurrency(summary.current)}
+          <div className={`text-2xl font-bold ${gainLossColor(summary.current)}`}>
+            <PartialTotal total={{ value: summary.current, missingCurrencies: summary.missing, excludedCount: summary.missing.length }} displayCurrency={defaultCurrency}>
+              {formatCurrency(summary.current)}
+            </PartialTotal>
--- a/frontend/src/app/accounts/page.tsx
+++ b/frontend/src/app/accounts/page.tsx
@@ const contributedBalance = (a: Account): number | null => {
-      if (portfolioFailed || (unpricedHoldingCounts.get(a.id) ?? 0) > 0) return null;
+      if (portfolioFailed || incompleteAccounts.has(a.id)) return null;
@@
+  // valuationComplete covers prices AND rates; unpricedHoldingsCount only prices.
+  const incompleteAccounts = useMemo(() => new Set(
+    (portfolioSummary?.holdingsByAccount ?? [])
+      .filter((h) => h.valuationComplete === false || (h.unpricedHoldingsCount ?? 0) > 0)
+      .map((h) => h.accountId)), [portfolioSummary]);
--- a/frontend/src/components/dashboard/PortfolioValueWidget.tsx
+++ b/frontend/src/components/dashboard/PortfolioValueWidget.tsx
@@
-  const totalPortfolioValue = summary?.totalPortfolioValue ?? null;
+  const totalPortfolioValue =
+    summary && summary.valuationComplete !== false ? summary.totalPortfolioValue : null;
@@
-      .then((rows) =>
-        rows.map((r) => ({ date: r.date, value: investedValue(r) })),
+      .then((rows) =>
+        rows.map((r) => ({
+          date: r.date,
+          value: r.pricesComplete !== false && r.fxComplete !== false ? investedValue(r) : null,
+        })),
--- a/frontend/src/components/investments/InvestmentValueChart.tsx
+++ b/frontend/src/components/investments/InvestmentValueChart.tsx
@@ data.map((d) => ({
-            Value: investedValue(d),
+            Value: d.pricesComplete !== false && d.fxComplete !== false ? investedValue(d) : null,
+            complete: d.pricesComplete !== false && d.fxComplete !== false,
```

   plus: the summary `useMemo` at `:503` takes `PortfolioValueReport.tsx:757-776` verbatim (one incomplete point leaves both extremes unknown), the same predicate in `AccountList.tsx:1074` and `logical-accounts.ts:225-240`, `NetWorthChart` and `AssetsVsLiabilities` marked from the same month fields, and the breakdown table/CSV reading `acct.valuationComplete === false`. Maintainer decision: whether the widget headline shows the subtotal under `PartialTotal` (as the investments page does) or withholds it.
12. **Recommended regression test:** one component case per surface fed `valuationComplete:false` (or `fxComplete:false` on a month, `pricesComplete:false` on a point) with every other field complete.
13. **Suggested regression-test diff (illustrative, not applied):** the four probes run for this report, kept as tests:

```diff
+// NetWorthReport.test.tsx
+it('marks the current net worth partial when the latest month is fxComplete:false', async () => {
+  mockGetMonthly.mockResolvedValue([
+    { month: '2024-11-01', assets: 50000, liabilities: 0, netWorth: 50000, fxComplete: true, missingRatePairs: [] },
+    { month: '2024-12-01', assets: 50000, liabilities: 0, netWorth: 50000, fxComplete: false, missingRatePairs: ['ZZZ->USD'] },
+  ]);
+  await act(async () => { render(<NetWorthReport />); });
+  await waitFor(() => expect(screen.getAllByText('$50000').length).toBeGreaterThan(0));
+  expect(document.body.innerHTML.includes('ZZZ') || /partial/i.test(document.body.innerHTML)).toBe(true);
+});
+// app/accounts/page.test.tsx, inside 'an unknown value is not a measured zero'
+it('marks the totals partial when a brokerage is FX-incomplete with every price present', async () => {
+  mockGetAll.mockResolvedValue([{ id: 'acc-5', name: 'Brokerage', accountType: 'INVESTMENT', accountSubType: 'INVESTMENT_BROKERAGE', currencyCode: 'USD', currentBalance: 0, isClosed: false, canDelete: false }]);
+  mockGetPortfolioSummary.mockResolvedValue({ holdingsByAccount: [{ accountId: 'acc-5', totalMarketValue: 50000, cashBalance: 0, unpricedHoldingsCount: 0, fxComplete: false, missingRatePairs: ['USD->CAD'], pricesComplete: true, valuationComplete: false }] });
+  render(<AccountsPage />);
+  await waitFor(() => expect(screen.getByTestId('summary-Total Assets')).toHaveTextContent('$50000.00'));
+  expect(screen.getByTestId('summary-Total Assets')).toHaveTextContent('partial total');
+});
+// PortfolioValueWidget.test.tsx
+it('does not print a subtotal bare when valuationComplete is false', async () => {
+  getPortfolioSummary.mockResolvedValue({ totalPortfolioValue: 100000, holdings: [], holdingsByAccount: [], pricesComplete: false, fxComplete: true, valuationComplete: false, unpricedSecurityIds: ['sec-1'], missingRatePairs: [] });
+  getInvestmentsDaily.mockResolvedValue([{ date: '2026-05-28', value: 9000 }, { date: '2026-06-28', value: 10000 }]);
+  await renderWidget();
+  expect(screen.queryByText('$100000')).not.toBeInTheDocument();
+});
+// InvestmentValueChart.test.tsx
+it('does not rank a pricesComplete:false point as the Lowest Value', async () => {
+  vi.mocked(netWorthApi.getInvestmentsDaily).mockResolvedValue([
+    { date: '2023-06-01', value: 10000, securitiesValue: 10000, pricesComplete: true },
+    { date: '2023-09-01', value: 100, securitiesValue: 100, pricesComplete: false, unpricedSecurityIds: ['sec-1'] },
+    { date: '2024-01-01', value: 15000, securitiesValue: 15000, pricesComplete: true },
+  ]);
+  render(<InvestmentValueChart />);
+  await screen.findByText('Lowest Value');
+  expect(screen.queryByText('$100.00')).not.toBeInTheDocument();
+});
```

14. **Verification:** `npm run test -- NetWorthReport NetWorthChart AssetsVsLiabilities accounts/page AccountList logical-accounts PortfolioValueWidget InvestmentValueChart PortfolioValueReport SecurityTypeAllocationReport`; `npm run type-check`; a browser check of the four surfaces with a missing rate.
15. **Residual risks:** the server `total*` fields stay numeric when incomplete (design risk, A26-S02 section 9); the snapshot table behind `/net-worth/monthly` cannot see an unpriced position (A26-S13-04), so `fxComplete` on a month is itself narrower than "complete"; the intraday series carries no flag at all (section 8, S14 hand-off).

Causality: `PRIOR_REPORTED`, `CONFIRMED_WITH_DIFFERENT_ROOT_CAUSE` (MON-H16), consolidating A26-S02-03 (owner S20) and the UI half of A26-S13-04. Execution: probes P1-P4 (section 12.5), mutation M2 undetected (section 6).

### A26-S20-02 - Portfolio gain is the priced market value less the cost of every holding, so an unpriced holding reads as a loss of its whole cost; the Investment Performance report and the Portfolio Value account breakdown print it unflagged

1. **Severity:** MEDIUM
2. **Confidence:** high (frontend executed; server arithmetic read line by line)
3. **Location:** server `backend/src/securities/portfolio-calculation.service.ts:1976-1995` (cost added for every holding, including `marketValue === null`) versus `:2018-2025` (market value added only when priced); summary `backend/src/securities/portfolio.service.ts:902-909` (`totalGainLoss = totalHoldingsValue - totalCostBasis`); per account `portfolio-calculation.service.ts:2140-2193` (same asymmetry). Consumers: `frontend/src/components/reports/InvestmentPerformanceReport.tsx:172-195` (single-account branch recomputes the same difference client side), `:305-309` (PDF), `:380-390` (cards); `PortfolioValueReport.tsx:1045, 1783` (account gain, CSV and table). `GroupedHoldingsList.tsx:274, 292` marks the account but still prints the gain beside the mark.
4. **Violated invariant:** AGENTS "A subtotal is not a total ... a field named `gain` carries a value only when every component is known"; a gain is market value less the cost OF THE SAME holdings.
5. **Reproduction:** holding A priced, market value 100,000, cost 80,000; holding B with no price, cost 50,000. Open Reports -> Investment Performance.
6. **Observed (executed, probe P5):** "Total Gain/Loss -$30,000.00", "Return -23.08%", no marker (`{ gainShown: true, marked: false }`).
7. **Expected:** the gain withheld (unknown) or reported over the priced holdings only (+20,000, +25 percent) under a caption that says so; never -30,000.
8. **Impact:** a fabricated loss equal to the unpriced holdings' cost: 50,000 of swing on the example (-30,000 shown, +20,000 on the known part), a -23.1 percent "Return" against +25 percent. A reader sees a loss the portfolio has not made.
9. **Root cause:** the two `FxAggregate`s (cost and value) skip different components: the value aggregate skips an unpriced holding, the cost aggregate does not, so their difference is not a subtotal of anything.
10. **Recommended correction:** on the server, add a holding's cost to the gain's cost basis only when its market value joined the value total (keep the full cost under `totalCostBasis` for the basis card), or return `totalGainLoss: null` when `valuationComplete` is false (maintainer decision); on the client, read `valuationComplete === false` before printing gain, return and cost-derived figures.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/securities/portfolio-calculation.service.ts
+++ b/backend/src/securities/portfolio-calculation.service.ts
@@ (calculateHoldingsWithValues, per holding)
+      const pricedCost = marketValue === null ? null : costBasisAccountCurrency;
       if (marketValue !== null) {
         holdingsValueTotal.add(...);
+        pricedCostTotal.add(await this.convertToDefault(pricedCost, accountCurrency, defaultCurrency, rateCache), accountCurrency, defaultCurrency);
       }
@@ return
+      totalCostBasisOfPriced: pricedCostTotal.knownSubtotal,
--- a/backend/src/securities/portfolio.service.ts
+++ b/backend/src/securities/portfolio.service.ts
-    const totalGainLoss =
-      holdingsResult.totalHoldingsValue - holdingsResult.totalCostBasis;
+    const totalGainLoss =
+      holdingsResult.totalHoldingsValue - holdingsResult.totalCostBasisOfPriced;
--- a/frontend/src/components/reports/InvestmentPerformanceReport.tsx
+++ b/frontend/src/components/reports/InvestmentPerformanceReport.tsx
@@
-          {summaryValues.totalGainLoss >= 0 ? '+' : ''}{fmtSummary(summaryValues.totalGainLoss)}
+          {portfolio?.valuationComplete === false
+            ? <UnknownAmount reason="noPrice" />
+            : <>{summaryValues.totalGainLoss >= 0 ? '+' : ''}{fmtSummary(summaryValues.totalGainLoss)}</>}
```

   The same change in `buildHoldingsByAccount` (`:2140-2193`) and in the single-account branch (`InvestmentPerformanceReport.tsx:174-188`, which should read the server's per-account gain rather than recompute it). Needs verification: the AI/MCP portfolio tools that quote `totalGainLoss` (S17's surface) and the backend specs at `portfolio.service.spec.ts:1237-1256`.
12. **Recommended regression test:** a backend unit case with one priced and one unpriced holding asserting the gain is over the priced holding (or null), and the frontend probe below.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+// InvestmentPerformanceReport.test.tsx
+it('does not print the gain/return as complete when valuationComplete is false', async () => {
+  mockGetPortfolioSummary.mockResolvedValue({ ...fullPortfolio, holdingsByAccount: [],
+    totalPortfolioValue: 100000, totalCostBasis: 130000, totalGainLoss: -30000, totalGainLossPercent: -23.076923,
+    pricesComplete: false, fxComplete: true, valuationComplete: false, unpricedSecurityIds: ['sec-x'], missingRatePairs: [] });
+  mockGetInvestmentAccounts.mockResolvedValue([]);
+  render(<InvestmentPerformanceReport />);
+  await waitFor(() => expect(screen.getByText('Total Value')).toBeInTheDocument());
+  expect(document.body.textContent).not.toMatch(/-\$?30,?000/);
+});
```

14. **Verification:** backend `npm run test:unit -- portfolio-calculation portfolio.service`; frontend `npm run test -- InvestmentPerformanceReport PortfolioValueReport GroupedHoldingsList`.
15. **Residual risks:** the same asymmetry applies when a holding's market value has no rate but its historical cost does (the two aggregates use different pairs); not executed separately.

Causality: `PRE_EXISTING_UNREPORTED` (not in the upstream report or S02/S12/S13; the shallow clone cannot date it).

### A26-S20-03 - A report keeps the previous request's answer through a failed or pending reload, so its cards (Sankey) and its exports present the old window under the new one

1. **Severity:** MEDIUM
2. **Confidence:** high (Sankey executed; the other reports read)
3. **Location:** `frontend/src/hooks/useReportData.ts:207-216` (a failure keeps `data`, by design for `dataKey`); consumers that render the toolbar during an error and gate the export on the data being non-empty: `CashFlowSankeyReport.tsx:130, 299, 304-315` (cards shown from `response` above the error), `NetWorthReport.tsx:398-402`, `SpendingByCategoryReport.tsx:296-299`, `IncomeBySourceReport.tsx:270-273`, `SpendingByPayeeReport.tsx:171-174`, `MonthlyCategoryBreakdownReport.tsx:1294`, `CashFlowReport.tsx:284` (no gate; A26-S16-04), `SecurityPerformanceReport.tsx:680-683`. Not affected: reports that return early on `error` or `isLoading` (Debt Payoff Timeline `:636-640`, Budget reports `BudgetVsActualReport.tsx:320-324` and siblings, Geographic `:497`).
4. **Violated invariant:** `frontend/CLAUDE.md` "Asynchronous data belongs to the request that produced it ... never render a failed lookup as" a result; INV-REPORT-002 (an export carries the screen's figure).
5. **Reproduction:** open Cash Flow Sankey (month to date), let it load; switch to Subcategories (or another range) while the server fails the request.
6. **Observed (executed, probe P6):** the five cards still show the previous request's totals above the error panel, and the PDF and CSV buttons stay enabled over the previous answer (`{ staleCard: true, exportEnabled: true }`). On Spending by Category, Income by Source and Spending by Payee the PDF has no subtitle naming the period, so an export taken after a range change carries the previous range unlabelled.
7. **Expected:** cards and exports only for the data whose request key matches the current selection; the export disabled while loading or failed.
8. **Impact:** a document leaves the application with the figures of a different window or depth from the one selected; on Sankey the screen itself shows the old totals under the new selection.
9. **Root cause:** `useReportData` deliberately keeps the last payload and exposes `dataKey`, but these consumers gate on `data` (or its length) instead of `dataKey === requestKey && !error && !isLoading`.
10. **Recommended correction:** a `dataUnavailable = isLoading || !!error` gate on every inside-tree report's `ReportToolbarActions` and on Sankey's cards (the pattern `NetWorthReport.tsx:316` already defines for its cards and then does not apply to its toolbar).
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/frontend/src/components/reports/CashFlowSankeyReport.tsx
+++ b/frontend/src/components/reports/CashFlowSankeyReport.tsx
-  const data = response && response.nodes.length > 0 ? response : null;
+  // The previous answer is not this selection's answer while the new request
+  // is pending or failed.
+  const data = !isLoading && !error && response && response.nodes.length > 0 ? response : null;
--- a/frontend/src/components/reports/NetWorthReport.tsx
+++ b/frontend/src/components/reports/NetWorthReport.tsx
-            disabled={chartData.length === 0}
+            disabled={dataUnavailable || chartData.length === 0}
```

   and the same `disabled` in the five other reports listed. Needs: the Sankey drill-down (`open`) and the legend read `data` too; verify a background refresh does not blank the diagram if that is wanted (a maintainer choice between hiding and dimming).
12. **Recommended regression test:** per report, load once, fail the second request, assert the export is disabled (and on Sankey that no card renders).
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+// CashFlowSankeyReport.test.tsx
+it('does not keep the previous answer on screen, or exportable, when the new request fails', async () => {
+  await renderReport();
+  mockGetSankey.mockRejectedValue(new Error('500'));
+  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Subcategories' })); });
+  await waitFor(() => expect(mockGetSankey).toHaveBeenLastCalledWith(expect.objectContaining({ depth: 2 })));
+  expect(screen.queryByTestId('sankey-card-income')).not.toBeInTheDocument();
+  expect(screen.getByTestId('export-pdf')).toBeDisabled();
+});
```

14. **Verification:** `npm run test -- CashFlowSankeyReport NetWorthReport SpendingByCategoryReport IncomeBySourceReport SpendingByPayeeReport MonthlyCategoryBreakdownReport SecurityPerformanceReport`.
15. **Residual risks:** the request-by-request trace covered the 49 `ReportToolbarActions` call sites by their gating expression and the multi-request reports named by S16; reports that early-return were not exercised for a failure of a secondary request (Geographic's country request is A26-S20-05).

Causality: `PRE_EXISTING_UNREPORTED` (extends the export-on-error pattern of A26-S16-04 and A26-S15-08, which name the first-load case only). Mutation M8 (export gate removed, undetected) shows the gate is untested.

### A26-S20-04 - The intraday portfolio series is cached in sessionStorage under a key with no user and no acting context, and neither sign-out nor a context switch clears it, so the next user (or context) on the tab is drawn the previous one's portfolio

1. **Severity:** MEDIUM
2. **Confidence:** high (executed at unit level; hydration path read)
3. **Location:** `frontend/src/components/investments/portfolio-chart-utils.tsx:115-122` (`buildIntradayCacheKey(range, accountIds, currency)`), `:124-134` (`readIntradayCache`, no freshness check), `:147-160` (`clearAllIntradayCache`, called only on refresh in `InvestmentValueChart.tsx:407, 430`); readers `InvestmentValueChart.tsx:258-276` and `PortfolioValueReport.tsx:598-613` (hydrate before the network answers); `store/authStore.ts:97-114` (logout clears `apiCache`, two localStorage keys and the share inbox, not this); `components/layout/DelegationBanner.tsx:28-31` (context switch is a `window.location.reload()`, which keeps sessionStorage).
4. **Violated invariant:** a page never shows data fetched under another identity (the hint's delegated-session lens; `frontend/CLAUDE.md` "Asynchronous data belongs to the request that produced it"); the persisted-storage rule's intent (`store/persisted-storage.guard.test.ts` covers localStorage only).
5. **Reproduction:** user A opens Investments on 1D with all accounts in USD, signs out; user B signs in on the same tab and opens Investments on 1D, all accounts, USD. Or: a delegate acting as an owner opens 1D, then switches back to their own context.
6. **Observed (executed, probe P7):** after `useAuthStore.getState().logout()` the entry written for A is still returned for B's identical key (`expected { fetchedAt: ..., ... } to be null`). The chart sets A's points (`setLoadedPoints`) and drops the skeleton before B's request answers; it is replaced only when B's response arrives.
7. **Expected:** the cache keyed by the user and acting context, and cleared on sign-out and on a context switch.
8. **Impact:** another person's portfolio value series and its Highest / Lowest figures shown on a shared device for the length of an intraday request (which fetches every holding from the provider), and the owner's figures shown under the delegate's own context after a switch.
9. **Root cause:** the cache identity covers what the request names (range, accounts, currency) but not whose request it is (Rule 5: two dependencies of the payload, user and acting context, have no invalidation path).
10. **Recommended correction:** add the user id and `actingAsUserId` to the key and call `clearAllIntradayCache()` from `logout()` and before the context-switch reload.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/frontend/src/store/authStore.ts
+++ b/frontend/src/store/authStore.ts
       logout: () => {
         clearAllCache();
+        import('@/components/investments/portfolio-chart-utils').then(({ clearAllIntradayCache }) => clearAllIntradayCache());
--- a/frontend/src/components/layout/DelegationBanner.tsx
+++ b/frontend/src/components/layout/DelegationBanner.tsx
       await delegationApi.switchContext(targetUserId);
+      clearAllIntradayCache();
       window.location.reload();
--- a/frontend/src/components/investments/portfolio-chart-utils.tsx
+++ b/frontend/src/components/investments/portfolio-chart-utils.tsx
-export function buildIntradayCacheKey(range: string, accountIds: string[] | undefined, currency: string): string {
+export function buildIntradayCacheKey(range: string, accountIds: string[] | undefined, currency: string, identity: string): string {
   const accts = (accountIds ?? []).slice().sort().join(',');
-  return `${INTRADAY_CACHE_PREFIX}${range}|${accts}|${currency}`;
+  return `${INTRADAY_CACHE_PREFIX}${identity}|${range}|${accts}|${currency}`;
```

   (`identity` = `${user.id}:${actingAsUserId ?? 'self'}` from `useAuthStore`.) The logout import is dynamic to keep the store free of a component dependency; a `lib/` home for the cache helpers is the cleaner fix.
12. **Recommended regression test:** the probe below, plus a key test asserting two identities never share a key.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+// store/authStore.test.ts
+it('drops the intraday portfolio cache on logout', () => {
+  const key = buildIntradayCacheKey('1d', [], 'USD', 'user-a:self');
+  writeIntradayCache(key, { fetchedAt: Date.now(), points: [{ timestamp: '2026-10-21T14:30:00Z', value: 1, securitiesValue: 1 }], interval: '5m', currency: 'USD', fallbackToDaily: false, skippedSymbols: [], failedSymbols: [] });
+  useAuthStore.getState().logout();
+  expect(readIntradayCache(key)).toBeNull();
+});
```

14. **Verification:** `npm run test -- authStore portfolio-chart-utils InvestmentValueChart PortfolioValueReport DelegationBanner`; a two-user browser check on one tab.
15. **Residual risks:** other sessionStorage users (`stepUpToken`, `logout-state`, `whatsNewStore`) were not swept for identity; localStorage report settings that hold account ids are discussed in section 9 (D-S20-02).

Causality: `PRE_EXISTING_UNREPORTED` (not datable in the shallow clone).

### A26-S20-05 - Geographic Allocation's country view renders a failed country request as an empty table totalling 0, and its PDF prints a different aggregate under the screen card's caption

1. **Severity:** LOW
2. **Confidence:** high (read)
3. **Location:** `frontend/src/components/reports/GeographicAllocationReport.tsx:267-273` (country request, error not destructured), `:345-365` (`if (!countryResp) return []`, `countryResp?.totalPortfolioValue ?? 0`), `:780-812` (footer "Total" with the server look-through total and "100%"), `:416-424` (PDF card "Total Portfolio" = `countryTotalValue`, while the screen card `:583-597` prints the client `totalValue` under the same caption).
4. **Violated invariant:** "never render a failed lookup as an empty result ... a total of zero"; "never `?? 0` on an API value"; one caption, one figure.
5. **Reproduction:** open Geographic Allocation, choose By country; the country request fails (or is slow) while the summary succeeds.
6. **Observed:** no error, an empty country table with a footer "Total 0.00 / 100%"; the PDF exports "Total Portfolio 0.00". When both succeed the PDF's "Total Portfolio" is the look-through total, not the figure the screen card shows (the code's own comment at `:788-806` records that this aggregate has no completeness).
7. **Expected:** the country view in its error state with a retry; the PDF card the same figure and marker as the screen card, or captioned as the look-through total.
8. **Impact:** a zero portfolio in the country view and its PDF; two different "Total Portfolio" figures for one report.
9. **Root cause:** the secondary request was added without an error branch; the PDF took the view's own aggregate.
10. **Recommended correction:** destructure `error` and `isLoading` from the country request and render `ReportError` in the country view; `countryTotalValue: number | null`; caption the PDF card from the view.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
-  const { data: countryResp, reload: reloadCountry } = useReportData(
+  const { data: countryResp, error: countryError, reload: reloadCountry } = useReportData(
@@
-  const countryTotalValue = countryResp?.totalPortfolioValue ?? 0;
+  const countryTotalValue = countryResp ? countryResp.totalPortfolioValue : null;
@@
-      {viewType === 'country' ? (
+      {viewType === 'country' && countryError ? (
+        <ReportError onRetry={reloadCountry} />
+      ) : viewType === 'country' ? (
```

12-13. **Regression test:** reject `getCountryWeightings` with the summary resolved, select By country, assert the error and no "0.00" total; mutation M6 (the card's partial marker removed, undetected) is the same file's missing test.
14. **Verification:** `npm run test -- GeographicAllocationReport`.
15. **Residual risks:** the look-through aggregate's own completeness is a backend gap (`sector-weighting.service.ts`), handed to S23 (section 12.6).

Causality: `PRE_EXISTING_UNREPORTED`.

### A26-S20-06 - "Interest already saved" counts unrecorded interest as saved for a loan that books interest outside the app

1. **Severity:** LOW
2. **Confidence:** high (executed, probe P8)
3. **Location:** `frontend/src/lib/loan-past-impact.ts:198-212` (`originalSchedule.totalInterest - (history.cumulativeInterest + projectedRemainingInterest)` with no gate on whether the history recorded interest); rendered by `components/accounts/loan-detail/PastImpactSection.tsx:60-66`.
4. **Violated invariant:** a measured zero and an unknown are different (`docs/frontend/financial-figures.md`, "A historical loan row states the ledger"): `cumulativeInterest` is the ledger's zero for a loan whose interest is booked elsewhere, which the doc accepts for history but which is not "interest not paid".
5. **Reproduction:** a 10,000 loan at 6 percent, four 500 payments of 450 principal and 50 interest. (A) interest recorded as separate expenses; (B) the same loan with interest booked in another application (principal-only rows).
6. **Observed:** `cumulativeInterest` A 200, B 0; `interestAlreadySaved` A 0.00, B 159.14.
7. **Expected:** B withheld (unknown) or equal to A; never 159.14.
8. **Impact:** 159.14 shown as saved interest that was in fact paid (bounded by the unrecorded interest, 200.00 here); on a long mortgage the figure grows with every year booked outside the app.
9. **Root cause:** the history has no "interest recorded" flag, and the saving subtracts its zero as a known amount; `observedInstallment` (`loan-history.ts:326-374`) already detects the same incomplete case for the payment.
10. **Recommended correction:** return `interestAlreadySaved: null` when no repayment recorded interest and the loan's rate is not zero (the `observedInstallment(...).complete === false` test).
11. **Suggested remediation diff (illustrative, not applied):**

```diff
-  const interestAlreadySaved =
-    originalSchedule.paidOff && projectedRemainingInterest !== null
+  const interestRecorded = history.cumulativeInterest > 0 || observedInstallment(history)?.complete === true;
+  const interestAlreadySaved =
+    originalSchedule.paidOff && projectedRemainingInterest !== null && interestRecorded
```

12-14. **Test / verification:** the probe (B equals A or is null) in `loan-past-impact.test.ts`; `npm run test -- loan-past-impact PastImpactSection`.
15. **Residual risks:** a loan that genuinely charged 0 interest so far must keep its figure; the gate needs the 0 percent case (`annualRate === 0`) the doc's "0 percent is a rate" rule names.

Causality: `PRE_EXISTING_UNREPORTED` (handed by S15, `15-loans-strategies.md` section 12).

### A26-S20-07 - Numbers bypass the locale formatter and Monte Carlo compare labels bypass the catalog, with no guard to catch either

1. **Severity:** LOW
2. **Confidence:** high (read)
3. **Location:** `frontend/src/components/reports/SavingsRateReport.tsx:389` (`point.savingsRate.toFixed(1)` into `"Rate: {rate}%"`, `i18n/messages/en/reports.json:1348`); `MonteCarloReport.tsx:646` (`(form.expectedReturn * 100).toFixed(1)`); `CurrencyExposureReport.tsx:172-176` (rate `toFixed`); `monte-carlo/compareMetricRows.ts:177` (`new Date(stamp).toLocaleString()` and the literal `'Never'`) and 36 literal English `label:` strings in the same file rendered by `CompareMetricTable.tsx:167, 184`; 17 non-test files in `src/` contain `.toFixed(` or `toLocaleString()`, and `src/test/ui-conventions.test.ts` scans for neither.
4. **Violated invariant:** `frontend/CLAUDE.md` "Number a person reads: `useNumberFormat()` ... never `toFixed`, `toLocaleString()`, a literal `%`"; "Every user-facing string is translated".
5-7. **Observed / expected:** a Polish reader sees "12.3%" and "Last run ... Never" in English; expected "12,3 %" through `formatPercent` and catalog strings.
8. **Impact:** wrong decimal separator and untranslated labels on two reports; no financial value changes.
9. **Root cause:** the rule has no source-scanning guard.
10-11. **Correction / diff (illustrative):** `t('savingsRate.tooltipRate', { rate: formatPercent(point.savingsRate, 1) })` with the catalog's `%` removed; translate the compare labels through `useTranslations('reports')`; add a `toFixed(` / `toLocaleString()` scan to `ui-conventions.test.ts` with a shrink-only baseline of the current sites.
12-15. **Test / verification / residual:** the guard itself is the regression test; `npm run test -- ui-conventions SavingsRateReport MonteCarloReport`; CSV paths (`MonteCarloReport.tsx:323-327`) are machine output and stay `toFixed`.

Causality: `PRE_EXISTING_UNREPORTED`.

### A26-S20-08 - The dashboard turns a failed net-worth request into "No net worth data available yet"

1. **Severity:** LOW
2. **Confidence:** high (read)
3. **Location:** `frontend/src/app/dashboard/page.tsx:159` (`netWorthApi.getMonthly(...).catch(() => [] as MonthlyNetWorth[])`), rendered by `components/dashboard/AssetsVsLiabilities.tsx:103-104` with `assetsVsLiabilities.empty`.
4. **Violated invariant:** "never render a failed lookup as an empty result".
5-8. **Observed / expected / impact:** a 500 from `/net-worth/monthly` shows the empty-state copy instead of a failure the reader can retry; the sibling `NetWorthChart` fetches for itself and does show `netWorth.loadFailed`, so the two widgets disagree on one outage.
9-11. **Root cause / correction / diff (illustrative):** carry `netWorthError` from the page into the widget context and render the same `loadFailed` message: `.catch((e) => { setNetWorthError(true); return [] })` and `ctx.netWorthError ? <WidgetMessage>{t('netWorth.loadFailed')}</WidgetMessage> : ...`.
12-15. **Test / verification / residual:** reject `getMonthly` in the dashboard page test and assert no empty-state copy; `npm run test -- dashboard/page AssetsVsLiabilities`.

Causality: `PRE_EXISTING_UNREPORTED`.

## 5. Prior-finding dispositions

| ID | Disposition | Evidence |
| --- | --- | --- |
| MON-H16 | `STILL_OPEN` -> A26-S20-01 | The request-failure and unpriced-holding halves are fixed on the accounts page and the investments page (S02). The FX-incomplete account, the portfolio widget, the net-worth surfaces (whose frontend type drops `fxComplete`) and the portfolio series remain; executed by probes P1-P4. A26-S02-03 is consolidated here. |
| MON-M30 (UI wording half, from S12) | `FIXED_VERIFIED` | `i18n/messages/en/investments.json:51` (`costBasisTooltip`) states "purchase prices plus the commission charged on each purchase, each converted at the rate of the trade that paid for it", which matches `acquisitionCost` (S12) and the historical-basis preference at `portfolio-calculation.service.ts:1966-1974`; no other cost or average-cost copy mentions fees. |

## 6. Mutation table

Run in a scratch worktree at the baseline with the frontend `node_modules` linked; each file restored after its run.

| Invariant | Mutation (file:line, what) | Test that fails | Verdict |
| --- | --- | --- | --- |
| Per-point completeness (#1389) | `PortfolioValueReport.tsx:439-440` `complete = true` | 2 tests in `PortfolioValueReport` | covered |
| MON-H16 (unpriced brokerage) | `app/accounts/page.tsx:140` drop `|| (unpricedHoldingCounts.get(a.id) ?? 0) > 0` | none (59/59 pass) | **undetected** |
| SANKEY-005 partial cards | `CashFlowSankeyReport.tsx:147` always `formatCurrency(total ?? known ?? 0)` | 1 test | covered |
| Extremes withheld | `PortfolioValueReport.tsx:765` `extremesKnown = true` | 2 tests | covered |
| Unknown result | `PortfolioValueWidget.tsx:201` `?? null` -> `?? 0` | 1 test | covered |
| Partial total card | `GeographicAllocationReport.tsx:592` empty `missingCurrencies`, `excludedCount: 0` | none (32/32 pass) | **undetected** |
| Account valuation mark | `GroupedHoldingsList.tsx:141` drop `valuationComplete === false` return | 1 test | covered |
| Export gating | `NetWorthReport.tsx:401` `disabled={false}` | none (32/32 pass) | **undetected** |

Undetected rows for the program table: `MON-H16 | app/accounts/page.tsx:140 drop the unpriced-holding gate | a page case with an unpriced brokerage | S20`; `PartialTotal | GeographicAllocationReport.tsx:592 empty the marker | a partial country/region card case | S20`; `INV-REPORT-002 | NetWorthReport.tsx:401 export always enabled | a failed-load export case | S20`.

## 7. Counterexamples and the interaction scenario

- **Same number, different meaning:** 50,000 on the accounts page is the whole brokerage when `valuationComplete` is true and a subtotal missing a USD position when it is false with `unpricedHoldingsCount` 0 (P3).
- **Different object, same key:** two users, one tab, identical `(1d, [], USD)` intraday key (P7).
- **Provider returns nothing for one holding:** an unpriced holding drops out of value but stays in cost; the gain turns into a loss of its cost (P5).
- **Legacy / absent field:** every flag read found uses `=== false`; `MonthlyNetWorth` cannot read one at all, so a fully current backend behaves like an old one.
- **Interaction scenario (completeness x stale data x export):** a reader with a ZZZ account opens Net Worth on 1Y (subtotal, unmarked, A26-S20-01), switches to 5Y while the server fails; the error replaces the chart, the cards turn into skeletons, but Export PDF stays enabled and writes the 1Y subtotal months as "Current Net Worth" (A26-S20-03). Two individually small gaps produce a document with the wrong period and an unmarked partial total.

## 8. Rejected hypotheses

| Candidate | Evidence considered | Why rejected or downgraded | Final classification |
| --- | --- | --- | --- |
| A26-S17-01 reaches the transactions page summary as a mixed-currency scalar | `TransactionSummary.byCurrency` producer `transaction-analytics.service.ts:437-495`; consumers `PayeeInfoWidget`, `CategoryInfoWidget`, `app/categories/[id]/page.tsx`, `app/payees/[id]/page.tsx` | every HTTP consumer goes through `buildDisplayCurrencyStrategy` / `summarizeInDisplayCurrency` (`components/transactions/widget-shared.ts:36-110`), which converts per bucket and marks a missing rate with `PartialTotal`; no component reads the scalar `totalIncome` of a multi-currency summary | REJECTED for the UI; design note: the client converts at today's rate, not each row's (INV-FX-002), D-S20-01 |
| Debt Payoff Timeline exports while one of its four requests failed (S16 hand-off) | `DebtPayoffTimelineReport.tsx:137-251, 636-640` | combined `isLoading` / `error` early return; the toolbar is not mounted | REJECTED |
| Budget reports export on a failed secondary request | `BudgetVsActualReport.tsx:188-225, 320-324` and siblings | combined early return | REJECTED |
| Cash Flow Sankey PDF has no partial caption (S16 hand-off) | `CashFlowSankeyReport.tsx:216` | partial cards carry a `*`; the PDF has no legend for it, which is A26-S16-04's "`exportToPdf` cannot express a partial figure" | CONFIRMED under A26-S16-04 (not re-counted) |
| `exportToPdf` partial caption across every `PartialTotal` report (S16 hand-off) | PDF cards of AccountBalances, CreditUtilization, SecurityTypeAllocation (suffix present), DividendYieldGrowth (`:523-525`, no marker), Geographic (A26-S20-05), IncomeVsExpenses and SpendingByCategory (A26-S16-04) | DividendYieldGrowth's three cards are the only new instance and share A26-S16-04's root (no partial field in `pdf-export.ts`) | CONFIRMED under A26-S16-04 (surface added) |
| A26-S15-08 (Loan Amortization exports on error; Original Amount) | `LoanAmortizationReport.tsx:429-440, 497-511` | unchanged at the baseline; no new surface | CONFIRMED, stays A26-S15-08 |
| A26-S15-03 / -05 in the report UI | `LoanAmortizationReport` reads `deriveLoanPaymentHistory`, the one derivation | the UI renders the derivation; the defect is in `lib/loan-history.ts` as S15 reported | CONFIRMED, stays S15's |
| S14: the intraday path values a linked security at the ledger close and drops bond holdings in the no-ledger branch | `portfolio.service.ts:2276-2310, 2420, 2574-2603`: holdings with `fetchIntraday` false are neither `intradayHoldings` nor `closeValued` when `ledger` is null, and a failed holding with no close is skipped (`if (lastClose == null) continue`) | traced to the figures: `InvestmentValueChart` and `PortfolioValueReport` intraday lines and their Highest / Lowest; the intraday response type (`lib/investments.ts:239-266`) carries no completeness flag, so no frontend fix exists without a server flag | DESIGN_RISK on the frontend; the server root stays with A26-S14-01 (consolidate in S23) |
| Period change shown as a return | `NetWorthReport` "Change %" (net worth over its first month), `PortfolioValueWidget`, `InvestmentValueChart`, `PortfolioValueReport` | the investment surfaces read the server's `investmentPnl` / `investmentReturnPercent`; net worth's "Change %" is captioned as a change, not a return | REJECTED |
| Cash folded into an invested figure | `PortfolioValueWidget.tsx:117, 149` | the sparkline plots `investedValue`; the header prints `totalPortfolioValue` (holdings plus cash) under the widget's "Portfolio Value" title, a value, not a result | REJECTED (caption issue only; see D-S20-03) |
| Hand-edited pseudo-locale, catalog parity | `npm run i18n:check` pass; `src/i18n` parity suites pass | no drift | REJECTED |
| S10: the bank-sync preview UI does not disclose structural rule effects | not read in this session (budget) | handed on | open, to S23 |

## 9. Design risks

- **D-S20-01:** client-side conversion of per-currency summary buckets uses today's rate (`useExchangeRates`), so a historic income total moves with today's FX; INV-FX-002 asks for the row's own rate. A server-authoritative converted summary (as `getTransactionSummary` does for investments) would remove it.
- **D-S20-02:** report settings persisted in localStorage (`SANKEY_STORAGE_KEYS.accounts` and the account pickers of other reports) are not scoped to the user or the acting context; after a switch the stored owner account ids are sent under the new context, where `resolveScope` intersects them away and the report shows an empty scope. No disclosure (the server filters), a confusing empty report.
- **D-S20-03:** `PortfolioValueWidget` prints holdings-plus-cash in its header beside a securities-only sparkline with no caption separating the two measures.
- **D-S20-04:** the server's portfolio `total*` fields stay numeric when incomplete (A26-S02 section 9); every new consumer has to remember the flag, which is how A26-S20-01 and -02 recur. A typed `{ value, complete }` pair would make the read compulsory.

## 10. Missing tests and known-wrong tests

- No page-level case for an unpriced or FX-incomplete brokerage on the accounts page (M2 undetected).
- No case for a partial Geographic total card (M6) or for export gating after a failed load on any inside-tree report (M8).
- No test feeds `fxComplete:false` to any `MonthlyNetWorth` consumer; the type makes such a fixture impossible without a cast.
- No test feeds `pricesComplete:false` to `InvestmentValueChart` or the widget's series.
- No backend case asserts the gain with one unpriced holding (`portfolio.service.spec.ts`, `portfolio-calculation.service.spec.ts`).
- `store/persisted-storage.guard.test.ts` covers localStorage, not sessionStorage.
- No known-wrong test found in the slice.

## 11. Documentation inconsistencies

- `docs/frontend/financial-figures.md` ("Portfolio Value Over Time is the same shape, per date") describes the per-point rule for the report only; the investments page chart and the widget, which the same document lists as reading the same series, do not apply it.
- `types/net-worth.ts:30-35` tells consumers to read the flags; the sibling `MonthlyNetWorth` in the same file has none to read.
- `GeographicAllocationReport.tsx:788-806` documents the country aggregate's missing completeness as known; no invariant entry or plan records it.

## 12. Review ledger

### 12.1 Directories inspected

`frontend/src/components/reports/` (sampled), `components/dashboard/` (sampled), `components/investments/` (portfolio chart, holdings list), `components/transactions/widget-shared.ts`, `components/layout/DelegationBanner.tsx`, `app/accounts/page.tsx`, `app/dashboard/page.tsx`, `hooks/useReportData.ts`, `hooks/useLocalStorage.ts`, `lib/invested-value.ts`, `lib/loan-past-impact.ts`, `lib/delegation.ts`, `store/authStore.ts`, `types/net-worth.ts`, `types/investment.ts`, `types/transaction.ts`, `i18n/messages/en/` (grep); backend read for cross-layer: `net-worth.service.ts:825-925`, `portfolio-calculation.service.ts:1960-2200`, `portfolio.service.ts:880-910, 2270-2640`, `transaction-analytics.service.ts:437-495`, `cash-flow-sankey.service.ts:403-414`.

### 12.2 Files in full

`NetWorthReport.tsx`, `CashFlowSankeyReport.tsx:95-345`, `PortfolioValueWidget.tsx:100-330`, `PortfolioValueReport.tsx:540-800`, `InvestmentPerformanceReport.tsx:160-320`, `widget-shared.ts:1-140`, `invested-value.ts`, `portfolio-chart-utils.tsx:30-160`, `useReportData.ts:100-220`.

### 12.3 Files sampled (ranges)

`GeographicAllocationReport.tsx:255-470, 575-600, 725-812`; `DividendYieldGrowthReport.tsx:240-280, 515-580`; `DebtPayoffTimelineReport.tsx:130-255, 630-665`; `LoanAmortizationReport.tsx:70-160, 425-511`; `BudgetVsActualReport.tsx:185-335`; `SecurityTypeAllocationReport.tsx:420-430, 745-790`; `InvestmentValueChart.tsx:200-330, 500-550, 650-670`; `NetWorthChart.tsx` (grep); `AssetsVsLiabilities.tsx:40-131`; `accounts/page.tsx:95-150`; `GroupedHoldingsList.tsx:135-165, 270-295`; `loan-past-impact.ts:85-225`; `compareMetricRows.ts:170-180`; `SavingsRateReport.tsx:384-392`; `CurrencyExposureReport.tsx:168-178`. Not read: the 60 other report components beyond the scripted matrix (12.4), `components/budgets/`, `strategies/` (only `GemPortfolioPanel` `isKnown` reads), `bonds/`, `email-receipts/`, `tours/`, `whats-new/`, `app/` route guards beyond `DelegateSectionGuard` naming.

### 12.4 Searches performed

Per-file matrix over every report and dashboard component: `PartialTotal`, `fxComplete`, `valuationComplete|pricesComplete`, `?? 0`, `|| 0`, toolbar `disabled`, `exportToPdf`, `exportToCsv`, early error return, `useReportData` count. Consumers of `MonthlyNetWorth`, `getInvestmentsDaily|Breakdown|Monthly|Intraday`, `totalPortfolioValue|totalMarketValue|totalHoldingsValue`, `totalGainLoss`, `transactionsApi.getSummary`, `byCurrency`, `<ReportToolbarActions` (49), `actingAsUserId`, `sessionStorage`, `clearAllIntradayCache`, `.toFixed(|toLocaleString(`.

### 12.5 Suites and probes run

| Run | Result |
| --- | --- |
| `npm run i18n:check` | pass |
| Guards + i18n (`ui-conventions`, `src/i18n`, four `lib/*.guard`, balance-cache) | 16 files, 2049 tests, pass |
| Component suites as mutation baselines: `PortfolioValueReport` (83), `accounts/page` (59), `CashFlowSankeyReport` (46), `PortfolioValueWidget` (15), `GeographicAllocationReport` (32), `GroupedHoldingsList` (27), `NetWorthReport` (32) | all pass unmutated (counts from the mutation runs) |
| P1 NetWorthReport `fxComplete:false` month | fails at baseline (A26-S20-01) |
| P2 PortfolioValueWidget `valuationComplete:false` | fails (A26-S20-01) |
| P3 accounts page FX-incomplete brokerage | fails (A26-S20-01) |
| P4 InvestmentValueChart unpriced point as Lowest Value | fails (A26-S20-01) |
| P5 InvestmentPerformanceReport unpriced holding gain | fails (A26-S20-02) |
| P6 Sankey failed reload | fails (A26-S20-03) |
| P7 intraday cache after logout | fails (A26-S20-04) |
| P8 interest already saved, interest booked outside | fails (A26-S20-06) |
| `npm run build` | pass (exit 0; `.next` is ignored, working tree clean afterwards) |

### 12.6 Open hypotheses handed on

- to S23 (with S13): the country look-through aggregate (`sector-weighting.service.ts`) carries no completeness; A26-S20-05's PDF card depends on it.
- to S23 (with S14/S13): the intraday response needs a completeness flag before any frontend surface can mark a dropped bond or a failed holding (section 8).
- to S23 / S17: `totalGainLoss` (A26-S20-02) is quoted by the AI and MCP portfolio tools (`tool-executor.service.ts`, `tool-output-schemas.ts`); not traced here.
- to S23 / S10: the bank-sync preview UI and the rules editor (S10 section 12) were not read.
- to S18: INV-SHARE-001..005 (PWA share target) not audited here; other sessionStorage users swept for identity (A26-S20-04 residual).

### 12.7 Ledger text for the orchestrator

- Session row: S20 `done`, 2026-10-21, findings B/H/M/L 0/1/3/4 (HIGH A26-S20-01; MEDIUM A26-S20-02, -03, -04; LOW A26-S20-05, -06, -07, -08); A26-S20-01 consolidates A26-S02-03 (S02's count stays S02's) and the UI half of A26-S13-04; verdict REQUEST CHANGES.
- Prior findings: MON-H16 `STILL_OPEN` -> A26-S20-01; MON-M30 UI half `FIXED_VERIFIED`.
- Undetected mutation rows: the three in section 6.
- Deviations: S18 dependency waived (parallel wave); eight probes run in a scratch worktree at the baseline and deleted after their run (their code is in the findings' test diffs); budgets, strategies, bonds, email-receipts, tours and whats-new UI sampled by grep only.

## 13. Adversarial approval challenge

Started from the slice's own abstractions, assuming an APPROVE was wrong:

- **`PartialTotal` / completeness flags:** searched every consumer of the four portfolio totals and of `MonthlyNetWorth` instead of the surfaces S02 named; found the net-worth family, the per-point series on two surfaces, the breakdown table and the Security Type footer (A26-S20-01), and the gain asymmetry (A26-S20-02), which no flag-reading fix would close because the server's own difference is wrong.
- **`useReportData`:** asked what a consumer sees between a failed reload and a retry; found A26-S20-03.
- **Caches outside `apiCache`:** asked which persisted payload survives `clearAllCache()` and a context switch; found A26-S20-04.
- **Secondary requests in multi-request reports:** found Geographic's unhandled country request (A26-S20-05); Debt Payoff Timeline and the budget reports held.
- **Loan figures handed by S15:** found A26-S20-06 in the past-impact panel.
- **Formatter and catalog rules:** no guard exists; found A26-S20-07.
- Nothing found for: client subtraction of plotted points into a result (none), `connectNulls` defaults in the sampled charts, a hand-edited `xx` catalog, parity drift.

## 14. Verdict

`REQUEST CHANGES` for the slice: one HIGH (A26-S20-01, executed) survives the challenge, with three MEDIUM and four LOW findings. The adversarial pass was completed. Limitations: XL slice sampled by figure; budgets, strategies, bonds and email-receipts UI not read beyond grep; no browser run; hosted CI not consulted.
