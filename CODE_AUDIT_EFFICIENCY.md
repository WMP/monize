# Code Efficiency & Consistency Audit

Generated 2026-05-30. Read-only audit run across the whole repo by five parallel agents
(backend services, AI/MCP tool parity, cross-cutting backend patterns, frontend, database/tests).
No source files were modified. All line references are against the current working tree.

## Executive summary

The codebase is, on the whole, unusually disciplined: QueryRunner transaction usage in the
core write paths is solid, controller auth/`ParseUUIDPipe`/`userId`-from-JWT conventions are
applied uniformly, the frontend funnels every backend call through one axios client with a
shared dedupe cache, and test coverage is ~99% of services. The findings below are mostly
**de-duplication and consistency gap-filling**, not systemic breakage.

The single biggest cross-cutting theme, flagged independently by three of the five agents, is
**money rounding/summation**: the same logic is reimplemented ~7 times with two different
precisions (`*100`/2dp vs `*10000`/4dp), and several aggregations use naive float `reduce`.
This is both the top correctness risk (report totals can drift from ledger totals) and the
biggest single dedup win.

---

## P0 / P1 — Highest impact (correctness + biggest dedup)

> Status (2026-05-30): Items #2, #3, and #4 below have been implemented on
> branch `claude/code-audit-efficiency-Ifpnl` with full unit-test coverage.
> Item #1 (money helper) is intentionally deferred.

### 1. Money rounding & summation: standardize on one shared helper (HIGH) — DEFERRED
Three distinct conventions are in active use, and the helper is redefined ~7 times.
- Core write/balance path correctly uses 4dp (`accounts.service.ts:269,275,464,781,818`;
  `transaction-split.service.ts:77,80`).
- Read/report/derived code truncates to 2dp via `Math.round(x*100)/100`: `accounts.service.ts:920`
  (`getLlmBalances`), all of `built-in-reports/*`, `budgets/*`, `reports/reports.service.ts:893-948`.
- Naive float reduces on money: `budgets.service.ts:349-354,725-729`,
  `securities/investment-transactions.service.ts:2727-2735`, `reports.service.ts:646-867`,
  `budget-period.service.ts:163`, `loan-payment-detector.service.ts:361`.
- Helper duplicated: `transaction-analytics.service.ts:116-122` (and re-declared at `:186-187`,
  with `roundMoney` 2dp but `sumMoney` 4dp in the *same file*), plus private `round()` in
  `budget-health-reports.service.ts:538`, `budget-activity-reports.service.ts:377`,
  `budget-trend-reports.service.ts:645`, `budget-generator.service.ts:604`,
  `monte-carlo-simulation.service.ts:379`, `investment-report-data.service.ts:57`.

**Fix:** create `common/money.util.ts` exporting `roundMoney` (4dp) and `sumMoney` (integer-cents),
replace all of the above, and only round to 2dp at the display layer — never in aggregation.
A `roundToDecimals` already exists in `common/round.util.ts` (used only by `format-currency.util.ts`);
fold this into it.

### 2. Wrap remaining multi-table writes in QueryRunner transactions (MEDIUM) — DONE
The hot paths are covered; these read-modify-write cascades are not, and can leave denormalized
data inconsistent on partial failure:
- `payees.update` — `payees.service.ts:279` saves payee then separately updates `transactions`
  and `scheduled_transactions` name snapshots (3 independent writes).
- `categories.update` / `categories.remove` — `categories.service.ts:418,441` cascade
  `isIncome` to descendants and reassign transactions outside a transaction.
- `budgets.bulkUpdateCategories` — `budgets.service.ts:284` per-row findOne+save loop (also N+1).
- `scheduled-transactions.update` — `scheduled-transactions.service.ts:715` deletes/recreates
  splits + updates row via plain repos (its own `post()`/`create` are careful — internal inconsistency).
- `accounts.reopen` (`:663`) and `accounts.delete` (`:981`) — multi-table writes; `close()` (`:601`)
  correctly uses a pessimistic-locked QueryRunner, so these are inconsistent with their sibling.

### 3. AI tool / MCP data-shape divergence: `get_net_worth_history` (HIGH, scoped) — DONE
`NetWorthService.getLlmHistory` returns a bare array, but the AI executor wraps it as
`{ months: history }` (`tool-executor.service.ts:387`) while MCP returns the bare array
(`net-worth.tool.ts:92`). The shared-tool rule requires identical shapes. **Fix:** drop the
`{ months }` wrapper in the executor so `data` equals the MCP payload (preferred), or push the
wrapper into the service and update MCP. Update the corresponding specs.

### 4. De-duplicate recurring-charge detection across AI aggregators (MEDIUM, largest AI dup) — DONE
`getRecurringCharges` + `detectFrequency` + the `RecurringCharge` interface are copy-pasted in
`insights-aggregator.service.ts:26-34,244-332` and `forecast-aggregator.service.ts:60-68,296-383`
(near-identical QueryBuilder, same frequency thresholds). **Fix:** extract to a single
`TransactionAnalyticsService.getRecurringCharges` + shared type in `common/`; both aggregators delegate.

---

## P2 — Notable consistency gaps

### Backend
- **No shared pagination contract** — there is no `PaginationQueryDto` or `PaginatedResult<T>`.
  `transactions.service.ts:54-56,507` and `investment-transactions.service.ts:1244-1306` each
  recompute the `{ total, totalPages, hasMore }` envelope with their own limit clamps; several
  DTOs declare bare `limit?` with different bounds. Add `common/dto/pagination-query.dto.ts` +
  `PaginatedResult<T>` envelope and refactor both onto one helper.
- **`escapeHtml` reimplemented** — `notifications/email-templates.ts:9` and
  `oauth/consent-template.ts:25` define separate escapers with different character sets, while
  CLAUDE.md mandates a canonical `escapeHtml()`. Add `common/escape-html.util.ts` (OWASP set).
- **`currencyCode` validated three ways** — `@MaxLength(3)` (accounts/transfer), `@Length(3,3)`
  (currencies), `@Matches(/^[A-Z]{3}$/)` (ai-config). Add one `@IsCurrencyCode()` validator.
- **Unbounded numeric DTO fields** (violates `@Min`/`@Max` rule): `create-transfer.dto.ts:61,69`
  (`exchangeRate`, `toAmount`), `scheduled-transaction-override.dto.ts:45,73,107,112,120,161,166,174`,
  `post/create-scheduled-transaction.dto.ts`, `update-account.dto.ts:55` (`openingBalance` — bounded
  in create, unbounded in update), and two unbounded `sortOrder` fields. Adopt the existing
  `budgets`/`create-account` bounds as the standard.
- **Duplicate service instances via re-provided providers** — `AiEncryptionService` is re-listed
  as a provider in `backup.module.ts:24` and `emergency-access.module.ts:31` (three AES-key
  instances) instead of being exported from `AiModule` and imported; same for `PasswordBreachService`
  in `users.module.ts:22`. Export and import instead.
- **Triplicated per-user timezone bucketing** (~30 lines x3) — `accounts.service.ts:1198-1228`,
  `scheduled-transactions.service.ts:126-157`, `holdings.service.ts:846-873`. Extract
  `getUsersByEffectiveTimezone()`. This is cron-critical code.
- **Currency-conversion math duplicated 3 ways** — only `net-worth.service.ts` uses a
  `convertCurrency` helper; `portfolio.service.ts` and `loan-payment-detector.service.ts` do rate
  math inline; `built-in-reports` uses `ReportCurrencyService.convertAmount`. Consolidate onto one
  service method.
- **Split-amount validation duplicated** — `transaction-split.service.ts:62`,
  `scheduled-transactions.service.ts:427` (both 4dp) and
  `scheduled-transaction-override.service.ts:228` (naive float). Share one validator.

### AI / MCP
- **MCP-only aggregation tools** with real business logic and no AI-executor counterpart:
  `get_anomalies`, `monthly_comparison`, `generate_report` (`reports.tool.ts:22-166`),
  and `search_transactions` (`transactions.tool.ts:33-149`, which embeds split-expansion +
  amount-filter logic inline rather than on a domain service). Decide/document parity intent;
  move `search_transactions` row-shaping onto `TransactionAnalyticsService`.
- **Duplicate MCP registration** — `get_account_summary` (`accounts.tool.ts:81`) and `get_net_worth`
  (`net-worth.tool.ts:23`) are two tool names with identical behavior. Consolidate.
- **`compare_periods` all-or-nothing default guard** copy-pasted in both adapters
  (`tool-executor.service.ts:406-416`, `transactions.tool.ts:359-372`). Add a shared
  `resolveComparePeriods(input)` helper.

### Frontend
- **Two currency formatters produce different output** (HIGH) — `lib/format.ts:21` `formatCurrency`
  hardcodes `en-US`/USD; `hooks/useNumberFormat.ts` honors user locale + default currency (CAD).
  ~11 display-time files import the pure version (`TransactionRow.tsx`, `RecentTransactionsPopover.tsx:145`,
  `app/reconcile/page.tsx`, `MonteCarloReport.tsx`, `BudgetWizardStrategy.tsx`). Migrate display-time
  uses to the hook; restrict `lib/format` to non-React/test contexts.
- **~92 inline percent formatters** (`toFixed(n)%`) bypass the existing `formatPercent`; ~19 inline
  `toLocaleString()`/`toLocaleDateString()` bypass `formatNumber`/`formatDate`. Route through the hooks.
- **Server lists re-fetched into per-page `useState`** — `accounts`/`categories`/`payees`/`tags`
  are independently fetched in ~10 pages/components. `apiCache.dedupe` softens it, but introduce
  shared `useAccounts()`/`useCategories()` hooks (or React Query) so reference data is fetched once.
- **`Intl.NumberFormat` allocated per call** in `useNumberFormat.ts` (lines 39,65,80,97,145) — runs
  per-row per-render in tables. Memoize formatter instances via a module-level cache keyed by
  locale+currency+options.
- **Ad-hoc `ChartDataItem` redefined per report** — `IncomeBySourceReport.tsx:34`,
  `SpendingByCategoryReport.tsx:34`, `MonthlySpendingTrendReport.tsx:32`, `CashFlowReport.tsx:31`,
  `IncomeVsExpensesReport.tsx:33`, `SpendingByPayeeReport.tsx:32` — same `{name,value}` shape.
  Define a shared `ChartDatum` in `types/`.

### Database / tests
- **`monthly_account_balances.month`** is `@Column({type:"date"}) month: Date` with no string
  transformer (`monthly-account-balance.entity.ts:34-35`) — the lone DATE column missing the
  mandatory transformer; runtime value is actually a string. Fix to `string` + transformer.
- **`database/CLAUDE.md` stale** — says "next migration = 019" but real latest is `079`. Duplicate
  numeric prefixes exist (`022`, `068`, `075` each used twice). Update doc; enforce unique prefixes.
- **`holdings` has no `user_id` column** — every other tenant table has `user_id` + `idx_*_user`;
  holdings is scoped only via `account_id`, forcing a join and breaking the universal convention
  (its sibling `investment_transactions` *does* have `user_id`). Add it or document the exception.
- **Only one untested service** — `budgets/budget-health-reports.service.ts` (541 lines of money
  aggregation, the largest untested file). Add `budget-health-reports.service.spec.ts`.

---

## P3 — Lower priority / informational

- `scheduled_transaction_overrides` timestamps use bare `@CreateDateColumn` (maps to
  `timestamp without time zone`) vs schema `TIMESTAMPTZ`; add `type:"timestamptz"` for parity
  with `action_history`.
- Legacy `is_cleared`/`is_reconciled` columns + 3 dead indexes on `transactions` (entity exposes
  them only as computed getters over `status`). Plan a drop migration.
- N+1 loops: `budgets.bulkUpdateCategories` (`:293-305`), `scheduled-transactions.createSplits`
  tag-setting (`:455-521`). `reports.execute` loads up to 50k hydrated transactions then aggregates
  in JS (`reports.service.ts:420-423,564-884`) — candidate for SQL `GROUP BY`.
- Seed/demo services use `console.log` + emojis (`demo-seed.service.ts`, `seed.service.ts`,
  `demo-mode.service.ts:13`), violating the no-`console.log`/no-emoji rules. Switch to `Logger`.
- A few `catch {}` swallow without logging: `transaction-transfer.service.ts:211`,
  `budget-reports.service.ts:255,263,270`, `currencies.service.ts:493`, `oidc.service.ts:189`.
- Inconsistent NotFound message wording (templated `... with ID ${id} not found` vs terse
  `Category not found`). Cosmetic.
- No `@CurrentUser` decorator — all 38 controllers inject the raw `@Request() req` (untyped). Optional.
- Mixed `@Put`/`@Patch` for partial updates; standardize on `@Patch`.
- Per-account count/sum Map building reimplemented in `accounts`/`categories`/`payees`; a shared
  `toCountMap(rows)` would DRY it.
- Frontend: large lists `AccountList.tsx`/`HoldingsList.tsx` render rows without `React.memo`;
  paginate-all loop inlined in `app/dashboard/page.tsx:156-172` (extract to `transactionsApi.getAllPages`).
- Unit specs each re-declare mock-repo boilerplate; a shared `createMockRepo()` helper would reduce
  duplication. Consider a smoke test diffing `schema.sql` against `synchronize`-generated DDL.

---

## Suggested sequencing
1. `common/money.util.ts` (roundMoney/sumMoney) + replace all 2dp/float-reduce sites. (#1)
2. QueryRunner-wrap `payees.update`, `categories.update/remove`, `scheduled-transactions.update`,
   `accounts.reopen/delete`, `budgets.bulkUpdateCategories`. (#2)
3. Fix `get_net_worth_history` shape + de-dup recurring-charge detection. (#3, #4)
4. Shared pagination contract; `escape-html.util.ts`; `@IsCurrencyCode()`; numeric DTO bounds;
   export AiEncryptionService/PasswordBreachService.
5. Frontend: unify currency formatting + route percent/number/date through hooks; memoize
   Intl formatters.
6. DB fixes (`month` transformer, holdings `user_id`, stale migration doc) + the one missing test.
