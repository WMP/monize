# S20 Frontend figures, reports, dashboard, pages, i18n

Status: in-progress, remaining: lenses, findings, mutation table, challenge.

## 1. Metadata

| Field | Value |
| --- | --- |
| Session | S20 (child session_01VSrfzDF4F63zWMJY2giCfB) |
| `AUDIT_BASELINE_SHA` | `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86` |
| Pin check | `git diff --stat 72c59ec4... HEAD -- . ':!docs/audits/2026-10' ':!docs/audits/2026-08-upstream'` empty |
| Primary path | `frontend/src/components/reports/` |
| Date | 2026-10-21 |

## 12. Review ledger (working inventory)

### 12.1 Figure inventory, reports (first pass)

Columns: PT = `PartialTotal` uses, fx/vC = `fxComplete` / `valuationComplete|pricesComplete` reads, `?? 0` / `|| 0` counts (not all on API values), toolbar `disabled` expression.

| Report | Server figure(s) | Nullable / partial on the wire | Flag read | Caption when partial | Export gating |
| --- | --- | --- | --- | --- | --- |
| NetWorthReport | `GET /net-worth/monthly` assets, liabilities, netWorth per month | subtotal when `fxComplete:false` (server sends `fxComplete`, `missingRatePairs`) | none: frontend type `MonthlyNetWorth` omits both | none | `chartData.length === 0`; stale data on failed reload |
| CashFlowReport | `/built-in-reports/cash-flow` totals income/expenses/net | `number | null` | `?? 0` | zero shown (A26-S16-04) | none |
| CashFlowSankeyReport | sankey totals / knownTotals | `null` + known subtotal | `PartialTotal` on screen | screen yes; PDF `*` with no legend | `!data`; stale response kept on failed reload |
| IncomeVsExpensesReport, SpendingByCategoryReport | totals with `known*`, `missingCurrencies` | yes | `PartialTotal` on screen | PDF none (A26-S16-04) | `chartData.length === 0` |
| GeographicAllocationReport | summary holdings (client conversion), country look-through `totalPortfolioValue` | country aggregate carries no completeness | client `PartialTotal` on region/exchange; country none | PDF country card none; failed country request renders 0 | none |
| DividendYieldGrowthReport | client sums over holdings and dividend rows | client-side partial | `PartialTotal` on screen | PDF none | none |
| CreditUtilizationReport, AccountBalancesReport, SecurityTypeAllocationReport | client conversions | partial | `PartialTotal` | PDF suffix | n/a |
| PortfolioValueReport | `/net-worth/investments-daily`, breakdown, intraday, period result | per-point `pricesComplete`/`fxComplete`; intraday none | daily: yes; intraday: none (server sends none) | daily yes | `chartPoints.length === 0` |
| DebtPayoffTimelineReport | 4 requests | -- | combined error/loading early return | -- | toolbar not rendered while any request loads or fails |
| LoanAmortizationReport | accounts + history bundle | -- | `historyError` inline | -- | no `disabled` (A26-S15-08) |
| Budget* reports | budgets + report | -- | combined early return | -- | toolbar unmounted on error |

### 12.2 Figure inventory, dashboard and pages (first pass)

| Surface | Figure | Flag read | Observed |
| --- | --- | --- | --- |
| `PortfolioValueWidget` | `summary.totalPortfolioValue`; sparkline `investedValue(point)` | none | subtotal printed bare; incomplete points plotted |
| `InvestmentValueChart` (investments page) | daily `investedValue(point)`; Highest / Lowest cards | none | subtotal points plotted and ranked |
| `NetWorthChart`, `AssetsVsLiabilities` (dashboard) | `MonthlyNetWorth` | none (type omits it) | subtotal months as totals |
| `app/dashboard/page.tsx:159` | `netWorthApi.getMonthly(...).catch(() => [])` | -- | a failed request becomes an empty series |
| `app/accounts/page.tsx:115-122` | brokerage contribution | `unpricedHoldingsCount` only | FX-incomplete account summed as complete (A26-S02-03 a) |
| `PayeeInfoWidget`, `CategoryInfoWidget`, category/payee pages | `getSummary` `byCurrency` buckets | client conversion + `PartialTotal` | per-currency, partial marked |
