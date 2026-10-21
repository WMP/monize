# S16 Budgets, reports, categories, payees, tags, calendar

## 1. Metadata

| Field | Value |
| --- | --- |
| Session | S16 |
| `AUDIT_BASELINE_SHA` | `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86` |
| `git rev-parse HEAD` | `71daab591ca8b4a99f2205c2beb0fff79a7d2ae8` at start; `6bcea8d` after the first partial commit. Pin check (plan step 2): no code difference against the baseline outside `docs/audits/`. |
| Date | 2026-10-21 |
| Primary path | `backend/src/budgets/` |
| Secondary paths read | `backend/src/common/investment-filter.util.ts`, `backend/src/reports/reports.service.ts`, `backend/src/built-in-reports/` (FX call sites, `spending-reports.service.ts`, `income-reports.service.ts`), `backend/src/notification-center/notification.service.ts`, `frontend/src/components/reports/*` (export handlers), `frontend/src/components/budgets/BudgetWizard*.tsx`, `frontend/src/hooks/useReportData.ts` |
| Hint line | `prioritize a category's cost as its signed net within one category and never across two, transfer splits in budget spending, what a row is deciding the filter and never the account type, budget-alert check-then-insert, period rollover across replicas, exports giving the same server-authoritative figure as the screen, and partial totals captioned as partial` |
| Runtime | Node 24.22.1; backend `npm ci` clean; PostgreSQL 16 (`mirror.gcr.io/library/postgres:16-alpine`) in Docker. (1) `npm run test:integration -- "budget\|report\|categor\|payee\|calendar\|tag-usage"`: 10 suites, 112 tests, all passed. (2) Scratch-worktree probe `test/integration/s16-probe.integration.spec.ts` (never committed) against the same database: P1-P4, results in section 4. (3) Seven mutation runs (section 6). Frontend suites: not run (the frontend findings are by reading). |
| Status | complete for the budget slice and the report/export surfaces; categories, payees, tags and calendar sampled through their integration suites only (section 12). |

## 2. Invariant map

| ID / rule | Statement | Mechanism | Holds? |
| --- | --- | --- | --- |
| Category net (AGENTS "A category's cost is its signed sum") | A category's cost is its signed sum, netted within one category, never across two | Budgets: signed `SUM(t.amount)` / `SUM(s.amount)` per `category_id`, clamped per line in `resolveCategorySpent` (`budget-spending.util.ts:124-155, 222-232`); built-in: `NET_SPEND_AMOUNT` + `isNetSpending` (`spending-reports.service.ts:63-75`) | Budgets and built-in Spending by Category: yes. Custom report engine: **no** (A26-S16-05). |
| Convert before summing (AGENTS; INV-FX-001) | A total is in one named currency, every component converted, or it is withheld | Budgets: **none** for actuals; bills converted through `memoizedRateResolver` (`budgets.service.ts:572-592`) | **No** (A26-S16-01); custom reports **no** (A26-S16-06); built-in reports partly (A26-S02-02 confirmation, section 9). |
| MON-M31 / transfer splits in budgets | A split line carrying `transfer_account_id` counts toward the transfer budget line of its destination, once | `outgoingParentTransfers` + `outgoingSplitTransfers` (`budget-spending.util.ts:45-94`) used by all six transfer readers | Yes (section 5). |
| INV-REPORT-001 | Report scope is investment linkage, not account type | `investmentExclusionSql`, `applyInvestmentTransactionFilters`, `reportableTransactionAmountSql`; custom engine `ordinarySplitLines` / `reportableTransactionAmount` | Yes on paths read. Budgets need none: they select by `category_id`, and generated investment cash legs carry no category; embedded investment splits carry `category_id NULL`. |
| INV-REPORT-003 | A transfer leg is a named flow, never income/expense | `t.is_transfer = false` and `ts.transfer_account_id IS NULL` in built-in queries; budgets read transfers only into transfer lines | Yes on paths read. |
| User budget configuration | `excludedAccountIds` chosen in the wizard is honoured | none | **No** (A26-S16-02). |
| Period close and rollover | Closing a period freezes its actuals, writes `rollover_out`, opens the next period with `rollover_in` | `closePeriod` under `pessimistic_write` on the OPEN row (`budget-period.service.ts:109-180`); next period `INSERT ... ON CONFLICT (budget_id, period_start) DO NOTHING` (`:237-260`); per-owner monthly `JobClaimService.claimOnce` (`budget-period-cron.service.ts:120-133`) | Lock and claim: yes. Rollover: **no** (A26-S16-03). Next-period date: **no** for a mid-month close (A26-S16-07). |
| MON-L03 / budget-alert dedupe | One alert per (budget, period, type, category, severity) and one email | `idx_notifications_fingerprint` (`database/schema.sql:2483-2490`) + `INSERT ... ON CONFLICT DO NOTHING RETURNING id` (`notification.service.ts:140-163`); email only for returned rows (`budget-alert.service.ts:412-462`) | Yes under a real race (P4); the key conflates flex groups (A26-S16-08); no committed test can see the index (A26-S16-09). |
| INV-REPORT-002 / exports | An export carries the screen's server-authoritative figure and its completeness | `ReportToolbarActions`; `exportToPdf` / `exportToCsv` | **No** for partial totals (A26-S16-04). |
| INV-SEARCH-001 | One search door, escaped once | `applyTransactionSearch` (transactions only) | **No** in custom reports (A26-S07-08 confirmed). |

Material flow (budget actuals): `transactions` / `transaction_splits` (any account, any currency) -> `queryCategorySpending` (`budget-spending.util.ts:102-196`) / `computePeriodActuals` (`budget-period.service.ts:339-469`) / `computeActualIncome` (`budgets.service.ts:1031-1085`) -> `resolveCategorySpent` -> consumers: `getSummary`, `getDashboardSummary`, `getCategoryBudgetStatus`, `getLlmBudgetStatus` (AI `tool-executor.service.ts:2702`, MCP `mcp/tools/budgets.tool.ts:53`), `BudgetAlertService.processAlerts` (bell, critical email, weekly digest), `closePeriod` (persisted `budget_period_categories.actual_amount`, `rollover_out`, monthly summary email), budget trend/health/activity/seasonal reports, `BudgetGeneratorService` suggestions.

## 3. Lens ledger

| Lens | Status |
| --- | --- |
| Pin revision | ran (section 1) |
| Instructions first | ran: `AGENTS.md`, `CLAUDE.md`, `backend/CLAUDE.md`, `frontend/CLAUDE.md`, `docs/system-invariants.md` INV-REPORT-001..003, INV-SANKEY-001..005, INV-SEARCH-001 index rows, INV-PAYEE/DAYNOTE index rows; `.claude/commands/audit.md` loaded through `/audit` |
| Summaries as hypotheses | ran: MON-M31, MON-L03, A26-S07-08, A26-S02-02, A26-S15-08, A26-S12-04 re-traced; code comments claiming "the unique fingerprint arbitrates" and "both transfer shapes" were executed, not accepted |
| Invariant model | ran (section 2) |
| Change surface / producer-consumer | ran: every caller of `queryCategorySpending`, `resolveCategorySpent`, `outgoing*Transfers`, `closePeriod`, `convertAmount`, `ReportToolbarActions` (scripted sweep of 49 report components) |
| Cross-layer | ran for budget actuals (DB -> service -> AI/MCP/email), wizard `excludedAccountIds` (component -> DTO -> JSONB -> no reader), income-vs-expenses totals (DTO `number \| null` -> frontend type -> component `?? 0` -> PDF) |
| Representation boundary | ran: `null` total versus `0` (A26-S16-04), unhydrated relation versus "no rollover" (A26-S16-03), NULL `budget_category_id` in the fingerprint (A26-S16-08) |
| Browser/UI round trip | ran (narrow): wizard exclusion round trip; report export handlers. Budget forms not re-traced (S19/S20) |
| Server-authoritative metadata | ran: budget currency comes from the budget row; transaction currency is never compared with it (A26-S16-01) |
| Identity versus value | ran: flex groups identified by name inside `data`, not by the fingerprint key (A26-S16-08) |
| State machine | ran: period OPEN -> CLOSED -> next OPEN, four entry cases (cron on time, cron late, manual end of period, manual mid-period); A26-S16-07 |
| Concurrency and idempotency | ran and executed: alert fingerprint race (P4), period close lock and `ON CONFLICT` reading; replica claim covered by the passing `budget-period-rollover.integration.spec.ts` |
| Partial failure / compensation | ran: close writes period, categories and next period in one `withScopedDb`; alert email is sent after the row commits and flagged after; a crash between send and flag loses only the flag (at most one email, since the row exists) |
| External provider lookup | not applicable as a provider path: budgets and reports read stored rates (`buildRateMap`, `memoizedRateResolver`) and call no provider on read in the paths read |
| Database / migration | ran (narrow): FKs of `budget_categories` (`category_id`, `transfer_account_id` `ON DELETE SET NULL`), `budget_periods UNIQUE(budget_id, period_start)`, `idx_notifications_fingerprint`; entity parity (A26-S16-09) |
| Backup/restore | not applicable: no backup path in the slice (S06) |
| Financial | ran: every financial finding carries a numerical example |
| Authorization / RLS | ran (narrow): budget and report controllers use `req.user.id`, `ParseUUIDPipe` on `:id` (`budgets.controller.ts:301`); cron bodies seed `withUserContext`/`withSystemContext`; RLS policy behaviour is S04's |
| Tests as evidence | ran (section 10) |
| Mutation | ran: 7 executed (section 6) |
| Counterexamples, interaction | ran (section 7) |
| Rejected hypotheses | ran (section 8) |
| Adversarial approval challenge | ran (section 13) |

## 4. Confirmed findings

### A26-S16-01 - Budget actuals sum transactions of every currency into the budget's currency without conversion

1. **Severity:** HIGH
2. **Confidence:** high (executed, P1)
3. **Location:** `backend/src/budgets/budget-spending.util.ts:124-155` (category actuals), `:179-192` (transfer actuals); `budget-period.service.ts:355-397, 419-454` (period close); `budgets.service.ts:1031-1085` (`computeActualIncome`); the same raw sums in `budget-trend-reports.service.ts`, `budget-health-reports.service.ts`, `budget-activity-reports.service.ts`, `budget-generator.service.ts` (none of them reads `currency_code`). Contrast `budgets.service.ts:572-592`, where bills are converted into `budget.currencyCode`.
4. **Violated invariant:** AGENTS.md "Convert before summing"; "A subtotal is not a total"; INV-FX-001 (rate 1 means same currency).
5. **Reproduction (executed):** CAD budget, Groceries line 500.00. A CAD account with -200.00 and a JPY account with -10 000 JPY in Groceries, both in October 2026. `BudgetsService.getSummary`.
6. **Observed:** `totalSpent = 10200`, category `spent = 10200`, `percentUsed = 2040` (probe P1 output `{"totalSpent":10200,"cat":[[10200,2040]]}`).
7. **Expected:** 200.00 + 10 000 x 0.0090 = 290.00 CAD (58 percent), or the figure withheld with the missing JPY->CAD pair named.
8. **Impact:** difference +9 910.00 CAD (+3 417 percent). The same figure drives the OVER_BUDGET / THRESHOLD_CRITICAL alert and its immediate email, the weekly digest, the AI and MCP `get_budget_status` answers, the persisted closed-period `actual_amount` (never recomputed) and its rollover, the budget reports and the generator's suggested amounts. Any user with a foreign-currency card or account in a budgeted category is affected; the screen labels the figure in the budget's currency.
9. **Root cause:** the actuals queries `SUM(amount)` without `GROUP BY currency_code` and the service never consults a rate; the bill path was converted (issue #1247) and the actuals path was not.
10. **Recommended correction:** group every actuals query by `t.currency_code`, convert each (category, currency) total into `budget.currencyCode` through the same `memoizedRateResolver` the bill path uses (or a period-end `resolveFxRate`), aggregate through `FxAggregate`, and give each category line `spent: number | null` plus `missingCurrencies`; the alert path must skip a line whose `spent` is `null`.
11. **Suggested remediation diff: incomplete** (supported part; the rate date, per transaction or period end, is the maintainer's decision):

```diff
--- a/backend/src/budgets/budget-spending.util.ts
+++ b/backend/src/budgets/budget-spending.util.ts
@@ -124,7 +124,8 @@ export async function queryCategorySpending(
     const directRows = await transactionsRepository
       .createQueryBuilder("t")
       .select("t.category_id", "categoryId")
+      .addSelect("t.currency_code", "currencyCode")
       .addSelect("COALESCE(SUM(t.amount), 0)", "total")
@@
-      .groupBy("t.category_id")
+      .groupBy("t.category_id")
+      .addGroupBy("t.currency_code")
       .getRawMany();
-    for (const row of directRows) {
-      spendingMap.set(row.categoryId, parseFloat(row.total || "0"));
-    }
+    // Each (category, currency) row is converted by the caller-supplied
+    // resolver into the budget's currency through FxAggregate; a missing
+    // pair makes that category's spent null, never the raw figure.
```

   Missing: the same change in the split half, `computePeriodActuals` (better: make it call `queryCategorySpending` instead of its own copy), `computeActualIncome`, the four report services and the generator; `resolveCategorySpent` returning `number | null`; the DTOs and `frontend/src/types/budget.ts` carrying the completeness; `BudgetAlertService` skipping unknown lines.
12. **Recommended regression test:** the P1 scenario against PostgreSQL with a stored JPY->CAD rate (spent 290.00) and without one (spent `null`, `missingCurrencies: ["JPY"]`, no OVER_BUDGET alert).
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
--- /dev/null
+++ b/backend/test/integration/budget-multi-currency-actuals.integration.spec.ts
+it("converts a JPY expense into a CAD budget before summing", async () => {
+  await insertRate("JPY", "CAD", "2026-10-01", 0.009);
+  await tx(cadId, "CAD", "2026-10-05", -200);
+  await tx(jpyId, "JPY", "2026-10-06", -10000);
+  const s = await withUserContext(userId, () => budgets.getSummary(userId, budgetId));
+  expect(s.categoryBreakdown[0].spent).toBe(290);
+});
+it("withholds spent when no JPY->CAD rate exists", async () => {
+  await tx(jpyId, "JPY", "2026-10-06", -10000);
+  const s = await withUserContext(userId, () => budgets.getSummary(userId, budgetId));
+  expect(s.categoryBreakdown[0].spent).toBeNull();
+});
```

14. **Verification:** `npm run test:unit -- budget`, the new integration spec, `npm run test:integration -- budget`; frontend budget views rendering `null`.
15. **Residual risks:** the diff does not decide the rate date; closed periods already persisted keep their wrong `actual_amount` (a one-off recompute is a separate decision).

Causality: `PRE_EXISTING_UNREPORTED`. Surfaces (Rule 7): budget page, dashboard budget widget, transaction-form category status, AI, MCP, alerts and emails, period close, budget reports, generator.

### A26-S16-02 - The account exclusions chosen in the budget wizard are stored and never applied

1. **Severity:** MEDIUM
2. **Confidence:** high (static; a repo-wide search finds no reader)
3. **Location:** written by `frontend/src/components/budgets/BudgetWizardStrategy.tsx:145-149` and `BudgetWizardReview.tsx:71-72` (shown back as "N accounts excluded", `:158-164`); stored in `budgets.config` (`entities/budget.entity.ts:29-30`); read nowhere in `backend/src` (no match outside the entity and two specs).
4. **Violated invariant:** an explicit user instruction is honoured (protocol MEDIUM example "explicit user instruction silently ignored").
5. **Reproduction:** create a budget through the wizard, excluding a business credit card; spend 300.00 in Groceries on that card.
6. **Observed:** Groceries `spent` includes 300.00; alerts fire on it.
7. **Expected:** the excluded account's rows are out of every actuals query and out of the generator's history analysis.
8. **Impact:** wrong budget actuals and alerts for every user who used the exclusion; the review screen tells them it was applied.
9. **Root cause:** the option was added to the wizard and the JSONB config without a backend consumer.
10. **Recommended correction:** apply `t.account_id NOT IN (:...excluded)` in `queryCategorySpending`, `computePeriodActuals`, `computeActualIncome`, the transfer builders (source side) and `BudgetGeneratorService`; or remove the option from the wizard. Product decision; the safer candidate is to honour it.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/budgets/budget-spending.util.ts
+++ b/backend/src/budgets/budget-spending.util.ts
@@ export async function queryCategorySpending(
   periodStart: string,
   periodEnd: string,
+  excludedAccountIds: readonly string[] = [],
 ): Promise<{
@@
       .andWhere("t.is_split = false")
+    if (excludedAccountIds.length > 0) {
+      directQb.andWhere("t.account_id NOT IN (:...excludedAccountIds)", {
+        excludedAccountIds,
+      });
+    }
```

   and the callers pass `budget.config?.excludedAccountIds ?? []`.
12. **Recommended regression test:** an integration case with one excluded account: its expense is not in `spent`.
13. **Suggested regression-test diff:** as A26-S16-01's spec, with `config: { excludedAccountIds: [cardId] }` and `expect(spent).toBe(200)`.
14. **Verification:** `npm run test:unit -- budget`, `npm run test:integration -- budget`.
15. **Residual risks:** a transfer line whose source is an excluded account is a semantic choice to state in the spec.

Causality: `PRE_EXISTING_UNREPORTED` (not verified whether the wizard option predates `d5cea9bf`).

### A26-S16-03 - Closing a period never writes a rollover: `closePeriod` does not load the relation `computeRollover` reads

1. **Severity:** MEDIUM
2. **Confidence:** high (executed, P2)
3. **Location:** `backend/src/budgets/budget-period.service.ts:130-133` (`relations: ["periodCategories"]`), `:156-157`, `:293-300` (`if (!budgetCategory || ...) return 0`).
4. **Violated invariant:** a category with `rollover_type != NONE` carries its unused budget into the next period (the feature's contract, `computeRollover`).
5. **Reproduction (executed):** budget line Groceries 500.00, `rollover_type = MONTHLY`, no cap; OPEN period September 2026 with `effective_budget 500`; -200.00 spent in September; `closePeriod`.
6. **Observed:** September `actual_amount 200, rollover_out 0`; October `rollover_in 0, effective_budget 500` (probe P2).
7. **Expected:** `rollover_out 300`; October `rollover_in 300, effective_budget 800`.
8. **Impact:** -300.00 (-37.5 percent of the expected effective budget) per category per month; the rollover setting is silently inert for every user, on the cron and the manual path alike.
9. **Root cause:** `BudgetPeriodCategory.budgetCategory` is a lazy-free `@ManyToOne` that is not hydrated; the unit fixtures hydrate it by hand (`budget-period-lifecycle.spec.ts:405, 421, 437, 453`), so the defect is invisible to every suite (fixture cleaner than production).
10. **Recommended correction:** load `periodCategories.budgetCategory` in the second read (the lock is on the first query, so the outer join is allowed there), or look the line up in `budget.categories` (already loaded, `:159-161`).
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/budgets/budget-period.service.ts
+++ b/backend/src/budgets/budget-period.service.ts
@@ -130,7 +130,7 @@
       const openPeriod = await periods.findOne({
         where: { id: locked.id },
-        relations: ["periodCategories"],
+        relations: ["periodCategories", "periodCategories.budgetCategory"],
       });
```

12. **Recommended regression test:** the P2 scenario against PostgreSQL.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+it("carries the unused budget into the next period", async () => {
+  // MONTHLY rollover, 500 budgeted, 200 spent in the closed month
+  await withUserContext(userId, () => periods.closePeriod(userId, budgetId));
+  const [closed, next] = await rowsByPeriod(budgetId);
+  expect(closed.rollover_out).toBe("300.0000");
+  expect(next.rollover_in).toBe("300.0000");
+  expect(next.effective_budget).toBe("800.0000");
+});
```

14. **Verification:** the new integration case; `npm run test:unit -- budget-period`.
15. **Residual risks:** `QUARTERLY` and `ANNUAL` are treated as `MONTHLY` by `computeRollover`; that semantics is not decided by this fix. The live budget page (`getSummary`) uses `bc.amount` and ignores `effective_budget` entirely, so even a fixed rollover reaches only the period detail view.

Causality: `PRE_EXISTING_UNREPORTED`.

### A26-S16-04 - Report exports and the Cash Flow report present a partial or unknown total as a complete one

1. **Severity:** MEDIUM
2. **Confidence:** high (static; the component code is direct)
3. **Location:** `frontend/src/components/reports/CashFlowReport.tsx:142-147` (`totals.income ?? 0`, `expenses ?? 0`, `net ?? 0` over a `number | null` DTO field), rendered on screen `:226, :234` and in the PDF `:158-178`; its `ReportToolbarActions` has no `disabled` (`:284`) and `useReportData` leaves `data` null on a failed first load, so the PDF exports zeros; `IncomeVsExpensesReport.tsx:260-271` and `SpendingByCategoryReport.tsx:232-250` write `knownIncome` / `knownSpending` under "Total ..." in the PDF while the screen wraps the same figure in `PartialTotal` (`IncomeVsExpensesReport.tsx:473-479`, `SpendingByCategoryReport.tsx:442`); `frontend/src/lib/pdf-export.ts` has no partial or missing-currency field.
4. **Violated invariant:** `frontend/CLAUDE.md` "never `?? 0` on an API value"; AGENTS "A completeness flag is read where the numbers are shown"; INV-REPORT-002 (an export carries the screen's figure); the A26-S15-08 pattern (export while the request failed).
5. **Reproduction:** reporting currency CAD, income 5 000.00 CAD and 1 000.00 EUR with no EUR->CAD rate. Open Cash Flow; export PDF. Then Income vs Expenses -> PDF.
6. **Observed:** Cash Flow: `totals.income = null` renders "Total Inflows 0.00" and "Net +0.00 - expenses" on screen and in the PDF. Income vs Expenses PDF: "Total Income 5 000.00" with no caption. With the Cash Flow request failed: the PDF button stays enabled and writes three zero cards.
7. **Expected:** unknown totals rendered as unknown, partial ones captioned with the missing currency (as the screen does), exports disabled while the data is loading or failed.
8. **Impact:** a document that leaves the application carries a false total; in the Cash Flow case the reader sees zero income.
9. **Root cause:** `IncomeExpenseTotals` became `number | null` server-side without the Cash Flow consumer being migrated (Rule 4); the PDF helper cannot express a partial figure.
10. **Recommended correction:** read the nullable totals through `PartialTotal` in Cash Flow; add a `note` / `partial` option to `exportToPdf` summary cards and pass the missing currencies; `disabled={dataUnavailable}` on the Cash Flow toolbar.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/frontend/src/components/reports/CashFlowReport.tsx
+++ b/frontend/src/components/reports/CashFlowReport.tsx
@@ -142,9 +142,9 @@
   const totals = useMemo(
     () => ({
-      totalIncome: response?.cashFlowResponse.totals.income ?? 0,
-      totalExpenses: response?.cashFlowResponse.totals.expenses ?? 0,
-      netCashFlow: response?.cashFlowResponse.totals.net ?? 0,
+      totalIncome: response?.cashFlowResponse.totals.income ?? null,
+      totalExpenses: response?.cashFlowResponse.totals.expenses ?? null,
+      netCashFlow: response?.cashFlowResponse.totals.net ?? null,
     }),
@@ -284 +284 @@
-          <ReportToolbarActions onExportPdf={handleExportPdf} />
+          <ReportToolbarActions onExportPdf={handleExportPdf} disabled={dataUnavailable} />
```

   plus rendering each `null` through `PartialTotal` with `knownIncome` / `missingCurrencies`, and a `partialNote` field in `exportToPdf` used by all three reports.
12. **Recommended regression test:** component tests rendering a response with `income: null, knownIncome: 5000, missingCurrencies: ["EUR"]`: no "0.00" for income, PDF called with the partial note; a failed load leaves the export disabled.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+it("never shows an unknown total as zero", async () => {
+  mockCashFlow({ totals: { income: null, knownIncome: 5000, expenses: 3000, net: null }, missingCurrencies: ["EUR"] });
+  await act(async () => render(<CashFlowReport />));
+  expect(screen.queryByText("$0.00")).toBeNull();
+});
```

14. **Verification:** `npm run test -- CashFlowReport IncomeVsExpensesReport SpendingByCategoryReport pdf-export`; `npm run type-check`.
15. **Residual risks:** the sweep covered the 49 components that render `ReportToolbarActions` for an early error return or a `disabled` prop; reports with several requests (Debt Payoff Timeline, Cash Flow Sankey, the budget reports) were not traced request by request; handed to S20.

Causality: `PRE_EXISTING_UNREPORTED` for the PDF captions; `EXPOSED_OR_AMPLIFIED` for Cash Flow (the server field became nullable, the consumer kept `?? 0`).

### A26-S16-05 - The custom report engine sums the absolute value of every row, so a refund raises a category's cost

1. **Severity:** MEDIUM
2. **Confidence:** high (static; the arithmetic is direct)
3. **Location:** `backend/src/reports/reports.service.ts:817, 833, 855, 858, 896, 905, 959, 1019, 1030, 1091` (`Math.abs(...)` per row or line); direction filter `:581-596` (`EXPENSES_ONLY` default `:74`, keeps `amount < 0` only).
4. **Violated invariant:** AGENTS "A category's cost is its signed sum over rows of both signs, netted within one category" (`isNetSpending` / `NET_SPEND_AMOUNT`, issue #1125).
5. **Reproduction:** Groceries -100.00 and a +30.00 refund in the same month. Built-in Spending by Category; custom report by category with direction `EXPENSES_ONLY`, then `BOTH`.
6. **Observed:** built-in 70.00; custom `EXPENSES_ONLY` 100.00 (refund dropped, the pre-#1125 rule); custom `BOTH` 130.00 (refund added).
7. **Expected:** 70.00 for the category on every surface.
8. **Impact:** +30.00 (+42.9 percent) or +60.00 (+85.7 percent) on the example; two report surfaces disagree on one category and month.
9. **Root cause:** the engine was written before the netting rule and aggregates magnitudes.
10. **Recommended correction:** accumulate the signed amount per group and present `-sum` for expense groupings (drop a group whose net is not spending, as `isNetSpending`); keep the direction filter as a row filter only where the user asked for a cash-direction view. Product decision on `BOTH`.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/reports/reports.service.ts
+++ b/backend/src/reports/reports.service.ts
@@ -893,7 +893,7 @@
           const existing = dataMap.get(categoryId) || { sum: 0, count: 0 };
-          existing.sum = roundMoney(
-            existing.sum + Math.abs(Number(split.amount)),
-          );
+          existing.sum = roundMoney(existing.sum - Number(split.amount));
@@ -905 +905 @@
-        existing.sum = roundMoney(existing.sum + Math.abs(Number(tx.amount)));
+        existing.sum = roundMoney(existing.sum - Number(tx.amount));
```

   and the same change in the other aggregators, with the sign flipped for an `INCOME_ONLY` report.
12. **Recommended regression test:** the -100 / +30 case through `executeReport`, asserting 70.
13. **Suggested regression-test diff:** a `reports.service.spec.ts` case with two hydrated transactions, `expect(result.data[0].value).toBe(70)`.
14. **Verification:** `npm run test:unit -- reports.service`.
15. **Residual risks:** the direction filter is user configuration; whether `EXPENSES_ONLY` should mean "categories that net to spending" is the maintainer's decision.

Causality: `PRE_EXISTING_UNREPORTED`.

### A26-S16-06 - The custom report engine sums amounts of every currency with no conversion

1. **Severity:** MEDIUM
2. **Confidence:** high (static: `reports.service.ts` contains no rate, currency or conversion reference)
3. **Location:** `backend/src/reports/reports.service.ts:849-1170` (every aggregator sums `amount` regardless of `currencyCode`).
4. **Violated invariant:** "Convert before summing"; INV-FX-001.
5. **Reproduction:** the A26-S16-01 data (200.00 CAD + 10 000 JPY in Groceries) in a custom report by category.
6. **Observed (by reading):** Groceries 10 200.
7. **Expected:** 290.00 in the reporting currency, or a withheld total naming JPY.
8. **Impact:** +9 910.00 (+3 417 percent) in the example; percentages of the total are distorted for every other group.
9. **Root cause:** the engine aggregates hydrated entities in TypeScript and never consults `ReportCurrencyService`.
10. **Recommended correction:** convert each row with `ReportCurrencyService.tryConvertAmount` and aggregate through `FxAggregate`, returning `missingCurrencies` and a `null` total when incomplete.
11. **Suggested remediation diff: incomplete.** Supported part: inject `ReportCurrencyService`, build the rate map once per execution, replace each `existing.sum + x` with `agg.addConverted(tryConvertAmount(x, tx.currencyCode, defaultCurrency, rateMap))`. Missing: the response DTO fields and the frontend custom report viewer's partial rendering.
12. **Recommended regression test:** two currencies, one with a rate (converted) and one without (`null` total, missing currency named).
13. **Suggested regression-test diff:** as item 12 in `reports.service.spec.ts` with a mocked `ReportCurrencyService` typed to the real signature.
14. **Verification:** `npm run test:unit -- reports.service`.
15. **Residual risks:** shares A26-S02-02's open decision on the per-report missing-data policy.

Causality: `PRE_EXISTING_UNREPORTED`.

### A26-S16-07 - A manual close in the middle of a period leaves the budget with no OPEN period for good

1. **Severity:** LOW
2. **Confidence:** high (executed, P3)
3. **Location:** `budget-period.service.ts:177, 214-260` (`createNextPeriod` -> `createPeriodForBudget` -> `getCurrentMonthPeriodDates()`), route `budgets.controller.ts:295-303`; `budget-period-cron.service.ts:152-154` skips a budget with no OPEN period.
4. **Violated invariant:** after a close, exactly one OPEN period exists for the following period (state machine).
5. **Reproduction (executed):** with October 2026 OPEN, `POST /budgets/:id/periods/close` on 2026-10-21.
6. **Observed:** October CLOSED; the next-period insert uses `period_start 2026-10-01`, hits `ON CONFLICT DO NOTHING` and returns the just-closed row; no OPEN period; `getOrCreateCurrentPeriod` returns the CLOSED October row (probe P3 `{"after":[...CLOSED, CLOSED],"current":"CLOSED"}`); the November cron finds no OPEN period and skips the budget every month after.
7. **Expected:** the next period starts the day after the closed period ends (November), or a close before `period_end` is refused.
8. **Impact:** the period history stops for that budget; the live budget page is unaffected (it reads the calendar month). Reachable only through the API: no frontend component calls `budgetsApi.closePeriod` (`frontend/src/lib/budgets.ts:161`). The same date rule makes a late cron (a replica down over a month boundary) skip the missed months silently.
9. **Root cause:** the next period's dates come from the wall clock, not from the closed period.
10. **Recommended correction:** derive the next period from `closedPeriod.periodEnd + 1 day` (`getMonthPeriodDates`), and refuse a manual close before `period_end` (maintainer decision).
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/budgets/budget-period.service.ts
+++ b/backend/src/budgets/budget-period.service.ts
@@ async createPeriodForBudget(
     budget: Budget,
     rolloverMap?: Map<string, number>,
     manager?: EntityManager,
+    dates: PeriodDateRange = getCurrentMonthPeriodDates(),
   ): Promise<BudgetPeriod> {
-    const { periodStart, periodEnd } = getCurrentMonthPeriodDates();
+    const { periodStart, periodEnd } = dates;
@@ private async createNextPeriod(
-    return this.createPeriodForBudget(budget, rolloverMap, manager);
+    return this.createPeriodForBudget(
+      budget, rolloverMap, manager, followingMonthPeriodDates(closedPeriod.periodEnd),
+    );
```

12. **Recommended regression test:** the P3 scenario: after a close dated inside the period, exactly one OPEN period exists and it starts the next month (or the close is refused with 400).
13. **Suggested regression-test diff:** as item 12 in a budget period integration spec.
14. **Verification:** `npm run test:integration -- budget`.
15. **Residual risks:** with dates derived from the closed period, a two-month outage creates the missed month as OPEN and the next cron closes it; whether to back-fill is a product decision.

Causality: `PRE_EXISTING_UNREPORTED`.

### A26-S16-08 - Two flex groups over 90 percent share one alert fingerprint, so the second is never raised in the period

1. **Severity:** LOW
2. **Confidence:** high (executed at the SQL level, P4)
3. **Location:** `budget-alert.service.ts:589-608` (`budgetCategoryId: null`, one `FLEX_GROUP_WARNING` per group, group name only in `data`); `database/schema.sql:2483-2490`; `deduplicateAlerts` `:689-714` matches on `(type, budgetCategoryId)` only.
4. **Violated invariant:** one alert per logical condition (MON-L03's own statement, "one logical alert fingerprint per budget period").
5. **Reproduction (executed):** two `FLEX_GROUP_WARNING` rows for one budget and period with different group names.
6. **Observed:** first insert 1 row, second 0 rows (probe P4 `flexFun 1, flexDining 0`); on later days `deduplicateAlerts` also filters the second group against the first.
7. **Expected:** one alert per flex group.
8. **Impact:** a user with two overspent flex groups is told about one.
9. **Root cause:** the fingerprint identifies a budget-wide alert by `(budget, period, type, NULL category, severity)` and flex groups have no column of their own.
10. **Recommended correction:** add the group to the key (a migration widening the fingerprint with `COALESCE(data->>'flexGroup', '')`, mirrored in `deduplicateAlerts`).
11. **Suggested remediation diff (illustrative, not applied):** a timestamped migration dropping and recreating `idx_notifications_fingerprint` with the extra expression, the same in `database/schema.sql`, and `e.data?.flexGroup === candidate.data?.flexGroup` added to the `deduplicateAlerts` match.
12. **Recommended regression test:** two groups at 95 percent produce two rows.
13. **Suggested regression-test diff:** a `budget-alert.service.spec.ts` case for `deduplicateAlerts` plus an integration insert pair.
14. **Verification:** `npm run migration:lint`, `scripts/verify-schema.sh`, the integration case.
15. **Residual risks:** the migration's preflight must not collapse legitimate rows.

Causality: `PRE_EXISTING_UNREPORTED` (the fingerprint shape is from migration 140).

### A26-S16-09 - No committed test can exercise the two unique keys budgets rely on, and VOID removal from budget spending is undetected (test coverage)

1. **Severity:** LOW
2. **Confidence:** high (executed)
3. **Location:** `idx_notifications_fingerprint` and `budget_periods UNIQUE(budget_id, period_start)` exist in `database/schema.sql` (`:2483`, `:2407`) but on neither entity (`notification-center/entities/notification.entity.ts`, `budgets/entities/budget-period.entity.ts`); the integration harness builds from entities (`test/helpers/integration-setup.ts:60`).
4. **Violated invariant:** the protocol's "declared in all three"; docs/verification-contract.md (a race claim needs a real two-connection test).
5. **Reproduction (executed):** `closePeriod` in the integration schema fails with "there is no unique or exclusion constraint matching the ON CONFLICT specification" until the constraint is added by hand (probe first run); no integration spec touches the fingerprint (`grep` finds only `migration-140-preflight`, which tests the preflight, not the race). Mutation M5 (VOID kept in budget category spending) passes both `budget*` unit suites and the budget integration suite.
6. **Observed:** the period close and both race arbiters are untestable in the committed harness; three mutations survive (section 6).
7. **Expected:** entity decorators matching `schema.sql`; a two-connection race test for alerts and for the period insert; a VOID case for category actuals.
8. **Impact:** a regression in MON-L03's fix, in period creation or in the VOID filter would ship green.
9. **Root cause:** the keys were added by migration only.
10. **Recommended correction:** `@Index("idx_notifications_fingerprint", ...)` is not expressible with `COALESCE` in a decorator, so the harness should apply the expression index after synchronize (beside `applyRlsPolicies`); `@Unique(["budgetId", "periodStart"])` on `BudgetPeriod`.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/budgets/entities/budget-period.entity.ts
+++ b/backend/src/budgets/entities/budget-period.entity.ts
-@Entity("budget_periods")
+@Entity("budget_periods")
+@Unique(["budgetId", "periodStart"])
 export class BudgetPeriod {
```

12. **Recommended regression test:** P4 (two `pg` clients, barrier, one row) and P2/P3 as committed integration specs; a VOID expense in `budget-split-transfer-spending` asserting it is not in `spent`.
13. **Suggested regression-test diff:** the probe in section 7, minus the hand-made constraint.
14. **Verification:** `npm run test:integration -- budget`.
15. **Residual risks:** the harness change touches every suite's schema; run the whole integration job once.

Causality: `PRE_EXISTING_UNREPORTED`.

### Confirmed hand-off: A26-S07-08 (custom-report text filter)

Confirmed at `reports.service.ts:571-577` (`searchText`) and `:719-735` (`text` condition): `%${value.trim().toLowerCase()}%`, no escape, outside `applyTransactionSearch`. Keeps S07's ID and severity (LOW); no new finding.

## 5. Prior-finding dispositions

| ID | Disposition | Evidence |
| --- | --- | --- |
| MON-M31 | FIXED_VERIFIED | `outgoingSplitTransfers` (`budget-spending.util.ts:70-94`) reads split lines carrying `transfer_account_id` for transfer budget lines, beside `outgoingParentTransfers`, in all six readers (summary, alerts, period close, trend, activity, generator). The category line keeps the category child (-60) and the transfer line gets the transfer child (-40): no omission and no double count (a counterpart row is not a split). `budget-split-transfer-spending.integration.spec.ts` passed; mutation M7 (remove the split half) fails 2 unit and 1 integration tests. The upstream "expected 100 in the category line" reading is rejected: the transfer child belongs to the transfer line of its destination. |
| MON-L03 | FIXED_VERIFIED (with residuals) | `NotificationService.create` `INSERT ... ON CONFLICT DO NOTHING RETURNING id` (`notification.service.ts:140-163`) over `idx_notifications_fingerprint` (`schema.sql:2483-2490`, `COALESCE` on the nullable category); email only for returned rows (`budget-alert.service.ts:412-462`). Executed: two connections, barrier, same fingerprint: winner 1 row, loser 0 rows (P4). Residuals: flex-group key collision (A26-S16-08); no committed test can see the index (A26-S16-09). |

## 6. Mutation table

| Invariant | Mutation (file:line, what) | Test that fails | Verdict |
| --- | --- | --- | --- |
| Category net (built-in) | `spending-reports.service.ts:74` `return total > 0` -> `return true` | 4 tests in `spending-reports` / `built-in-reports` unit suites | covered |
| Category net, refunds read (#1125) | `spending-reports.service.ts:64` `<> 0` -> `< 0` (debit-only) | 2 unit tests | covered |
| VOID excluded from budget actuals | `budget-spending.util.ts:132` remove `t.status != VOID` | none: 510 `budget` unit tests and 3 `budget-split` integration tests pass | **undetected** (A26-S16-09) |
| MON-M31 split transfers | `budget-spending.util.ts:186-192` remove the split-transfer collect | 2 unit (`budget-spending`), 1 integration (`budget-split`) | covered |
| Rollover written on close | baseline code itself (`budget-period.service.ts:130-133` omits the relation) | none; the unit fixtures hydrate it | **undetected** (A26-S16-03) |
| Alert race arbitration | remove `idx_notifications_fingerprint` | none in the committed suites (index absent from the harness) | **undetected** (A26-S16-09) |
| Next period after close | baseline `getCurrentMonthPeriodDates()` in `createPeriodForBudget` | none | **undetected** (A26-S16-07) |
| Budget currency conversion | baseline (no conversion) | none | **undetected** (A26-S16-01) |

## 7. Counterexamples and the interaction scenario

| Invariant | Counterexample | Result |
| --- | --- | --- |
| Convert before summing | 200 CAD + 10 000 JPY in a CAD budget | 10 200 "CAD" (P1) |
| Rollover | MONTHLY, 500 budgeted, 200 spent | rollover 0 (P2) |
| One OPEN period | close on day 21 of the period | zero OPEN periods (P3) |
| Alert fingerprint | two flex groups, same day | one alert (P4) |
| Category net | -100 and +30 in Groceries, custom report | 100 or 130 against 70 built-in |
| Partial totals | one currency without a rate in Cash Flow | "0.00" income on screen and PDF |
| Wizard exclusion | expense on an excluded card | counted |

Interaction scenario (A26-S16-01 x A26-S16-03 x alerts): a user with a JPY card and a MONTHLY-rollover Groceries line spends 200 CAD and 10 000 JPY. The live page and the critical email say 2 040 percent used; at month end `closePeriod` freezes `actual_amount = 10 200`, `computeRollover` would return 0 for the overspend anyway, and because the relation is unloaded it also returns 0 for every underspent line; the November period opens with no rollover and the frozen October figure is never recomputed. Fixing A26-S16-03 alone would start carrying rollovers computed from unconverted actuals, so A26-S16-01 has to land first or together.

## 8. Rejected hypotheses

| Candidate | Evidence considered | Why rejected or downgraded | Final classification |
| --- | --- | --- | --- |
| Budgets net across categories | `GROUP BY category_id`, clamp per line | netting is within one category | REJECTED |
| Budgets need `investmentExclusionSql` | generated cash legs carry no category; embedded investment splits have `category_id NULL` | selection by `category_id` cannot reach them | REJECTED |
| Period close race between replicas | `pessimistic_write` on the OPEN row, `NoOpenPeriodError` skip, per-owner claim; `budget-period-rollover.integration.spec.ts` passed | holds | REJECTED |
| Nested `withScopedDb` in `computePeriodActuals` splits the snapshot | nested calls join the ambient transaction (AGENTS) | same transaction | REJECTED |
| Alert email resent after a crash between send and `markEmailSent` | the row exists, the next run dedups on it | at most one email | REJECTED |
| `computeActualIncome` `Promise.all` over two `withScopedDb` | each opens its own top-level transaction (no ambient one in a request) | two snapshots, not one connection's queue; a cosmetic snapshot skew only | DESIGN_RISK (section 9) |
| A26-S07-04 unequal transfer legs mis-state budget transfer lines | builders read the outgoing leg (`amount < 0`) only | the line counts the source leg, which is what left the budgeted account | REJECTED for budgets |
| Capital-gains report surface of A26-S12-04 | `RealizedGainsReport.tsx`, `DividendIncomeReport.tsx` (capital gains), `InvestmentDetailView.tsx`, AI `tool-executor.service.ts`, MCP `investments.tool.ts` | consumers read the server figure; the defect is S12's root, no separate report-side defect found; both components return early on error, so exports are not reachable on a failed load | handed back (surface list only) |

## 9. Design risks

- `computePeriodActuals` (`budget-period.service.ts:339-469`) is a second copy of `queryCategorySpending`'s predicates; they agree today. A predicate fix in one (A26-S16-01, A26-S16-02) can miss the other.
- A deleted category or transfer account sets `budget_categories.category_id` / `transfer_account_id` to NULL (`schema.sql`, `ON DELETE SET NULL`); the line then reads "Uncategorized" or "Transfer" with `spent` always 0 (`resolveCategorySpent`), while it still takes part in totals and alerts.
- `computeActualIncome` runs its two halves in two transactions (`budgets.service.ts:1047-1078`).
- A26-S02-02 confirmation (report surfaces): the 1:1 fallback `convertAmount` serves eleven endpoints: Spending by Payee, Monthly Spending Trend (`spending-reports.service.ts:329, 431`), Income by Source (`income-reports.service.ts:206`, which Cash Flow's inflow table also reads), Year over Year and Weekend vs Weekday (`comparison-reports.service.ts:100, 106, 204`), Spending Anomalies (`anomaly-reports.service.ts:111-317`), Monthly Category Breakdown (`monthly-category-breakdown.service.ts:167-321`), Tax Summary, Recurring Expenses, Bill Payment History (`tax-recurring-reports.service.ts:202, 360, 555`), Uncategorized and Duplicate Transactions (`data-quality-reports.service.ts:117, 197, 204`). Complete-or-null today: Spending by Category (`FxAggregate`), Income vs Expenses (`tryConvertAmount`), Cash Flow Sankey (INV-SANKEY-004).

## 10. Missing tests and known-wrong tests

- No integration test for rollover on a real close; the unit fixtures hydrate `budgetCategory` by hand (`budget-period-lifecycle.spec.ts:405-453`, `budget-period.service.spec.ts:98`): fixture cleaner than production (A26-S16-03).
- No race test for the alert fingerprint or the period insert; neither key exists in the harness schema (A26-S16-09).
- No VOID case for category actuals (mutation M5).
- No multi-currency budget test (A26-S16-01); no wizard exclusion test past the component (A26-S16-02).
- No component test for Cash Flow with `null` totals; no PDF test asserting a partial caption (A26-S16-04).
- No custom report test with a refund or two currencies (A26-S16-05, -06).

## 11. Documentation inconsistencies

- `budget-alert.service.ts:403-411` says "the unique fingerprint ... arbitrates", true in production and unprovable in the test harness (A26-S16-09).
- `budget-period-cron.service.ts:112-115` says the next period's `ON CONFLICT` "is what actually enforces once"; true, but the same conflict swallows the next period after a mid-period close (A26-S16-07).
- `budget-spending.util.ts:211-221` documents "signed net sums" with no word on currency; `budgets.module.ts:54-55` says the budget converts occurrences "before totalling", which a reader can take to cover actuals.
- `docs/system-invariants.md:1741-1760` describes the custom report engine as covered for INV-REPORT-001 without noting that it neither nets nor converts.

## 12. Review ledger

- **SHA:** baseline `72c59ec4`; branch head at start `71daab59`. Base and merge base not applicable (baseline audit).
- **Directories inspected:** `backend/src/budgets/`, `backend/src/reports/`, `backend/src/built-in-reports/` (FX and netting sites), `backend/src/notification-center/` (create door), `frontend/src/components/reports/` (export handlers), `frontend/src/components/budgets/` (wizard).
- **Files in full:** `budgets/budget-spending.util.ts`, `common/investment-filter.util.ts`.
- **Files sampled (ranges):** `budgets/budget-period.service.ts:90-470`; `budgets/budget-period-cron.service.ts:70-230`; `budgets/budget-alert.service.ts:137-715`; `budgets/budgets.service.ts:400-412, 1031-1168`; `budgets/entities/budget.entity.ts`, `budget-category.entity.ts` (columns); `notification-center/notification.service.ts:100-185`; `reports/reports.service.ts:565-600, 715-740, 840-912`; `built-in-reports/spending-reports.service.ts:55-135, 236-255`; `built-in-reports/income-reports.service.ts:279-300` and the currency lines; `built-in-reports/dto/income-vs-expenses.dto.ts:50-66`; `frontend/src/components/reports/CashFlowReport.tsx:92-290`, `IncomeVsExpensesReport.tsx:191-290, 473-479`, `SpendingByCategoryReport.tsx:176-262`; `frontend/src/hooks/useReportData.ts:115-240`; `BudgetWizardReview.tsx:71-72, 158-164`.
- **Not read in full despite the session brief:** `budget-alert.service.ts:716-1262` (email and digest bodies, seasonal spikes), `budget-generator.service.ts`, the budget trend/health/activity report services beyond their transfer calls, `cash-flow-sankey*.ts`, `tax-recurring-reports.service.ts`, the backend CSV paths. Categories, payees, tags and calendar were covered only by their integration suites (category-delete-set-null, category-service-write, payee-lookup-quota, calendar-day-notes, calendar-read-models, tag-usage, report-tag-key-breakdown: all passed); INV-PAYEE-001/002 and INV-DAYNOTE-001 mechanisms were not re-read. Three read-only sweep subagents (built-in report netting, exports, categories/payees/tags/calendar) stopped on a usage limit before reporting; their questions were answered in part by the scripted sweeps above and the rest is handed on.
- **Searches:** callers of `queryCategorySpending`, `resolveCategorySpent`, `outgoingParentTransfers`, `outgoingSplitTransfers`, `closePeriod`, `createPeriodForBudget`, `rolloverIn`/`rolloverOut`/`effectiveBudget`, `excludedAccountIds`/`includeTransfers` (backend and frontend), `isNetSpending`/`NET_SPEND_AMOUNT`, `convertAmount(` in `built-in-reports/`, `FxAggregate`/`tryConvertAmount`, `Math.abs` in `reports.service.ts`, `idx_notifications_fingerprint` and `ON CONFLICT` in notification code, `getLlmBudgetStatus` consumers, capital-gains consumers, a scripted sweep of the 49 components rendering `ReportToolbarActions` for an early error return or `disabled`, `totals.(income|expenses|net) ??` in the frontend.
- **Suites run:** `npm run test:integration -- "budget|report|categor|payee|calendar|tag-usage"`: 10 suites, 112 tests passed. Scratch probe `s16-probe.integration.spec.ts` (P1-P4) in worktree `<scratchpad>/mut` at the baseline: P1, P4 ran first time; P2/P3 needed the production `UNIQUE(budget_id, period_start)` added by hand, then ran. Mutations: `jest spending-reports built-in-reports` (M1, M3), `jest budget` (M5), `jest --config ./test/jest-integration.json --runInBand budget-split` (M5, M7), `jest budget-spending` (M7).
- **Finding counts:** HIGH 1 (A26-S16-01), MEDIUM 5 (A26-S16-02..06), LOW 3 (A26-S16-07..09); A26-S07-08 confirmed (S07's ID). Prior: MON-M31 FIXED_VERIFIED, MON-L03 FIXED_VERIFIED with residuals.
- **Undetected mutation rows:** VOID in budget actuals; rollover relation; fingerprint index removal; next-period dates; budget currency conversion.
- **Open hypotheses handed on:**
  - to S20 (frontend reports): request-by-request export gating in multi-request reports (Debt Payoff Timeline, Cash Flow Sankey, Budget reports); `exportToPdf` partial caption across every report that uses `PartialTotal`.
  - to S13/S23: the A26-S02-02 surface list in section 9 (eleven endpoints); A26-S16-01 and -06 join the same "convert before summing" remediation task.
  - to S17: `getLlmBudgetStatus` carries A26-S16-01's unconverted `spent` into AI and MCP answers; the compact shape needs the completeness field once it exists.
  - to S23 sampling: categories, payees, tags and calendar beyond their integration suites (INV-PAYEE-001/002, INV-DAYNOTE-001 mechanisms not re-read; category merge/reparent effect on budget lines; tag totals across currencies).
- **Deviations:** sub-agent sweeps lost to a usage limit (above); the worker restarted mid-session, which detached `HEAD` from the branch; the branch was re-pointed to the local commit (an ancestor check passed) and pushed without rewriting remote history.

## 13. Adversarial approval challenge

Started from the slice's own abstractions, not the findings: "a budget line's spent", "a period's frozen actual", "an alert's fingerprint", "an export's total".

- *Spent:* asked what changes `spent` besides the ledger. Searched every reader of `budget.config` (A26-S16-02 found), every currency read in `budgets/` (A26-S16-01), and the six transfer readers for the two-shape rule (all six use both builders). Checked the income-linked branch: `budgeted = actualIncome * pct / 100` inherits A26-S16-01 through `computeActualIncome`, and `getSummary` reports `percentUsed = 0` when `budgeted` is 0 (no division by zero).
- *Frozen actual:* asked whether a closed period can be wrong and stay wrong: yes, through A26-S16-01, and never recomputed; and whether two periods can be open: no (unique key), but zero can (A26-S16-07).
- *Fingerprint:* asked which two distinct conditions share a key: flex groups (A26-S16-08); budget-wide positive milestone and income shortfall are one per budget by nature; seasonal spikes carry a category.
- *Export total:* asked where a `number | null` server total meets `?? 0` or a PDF card: Cash Flow and two PDFs (A26-S16-04).

Nothing in this pass reduces A26-S16-01 below HIGH: the figure reaches persisted state (closed periods), an outbound email and two machine consumers.

## 14. Verdict

`REQUEST CHANGES` for the slice: A26-S16-01 (HIGH) survived the challenge with execution evidence; five MEDIUM and three LOW findings stand.
