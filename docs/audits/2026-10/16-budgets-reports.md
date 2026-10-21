# S16 Budgets, reports, categories, payees, tags, calendar

Status: in-progress, remaining: execution evidence for A26-S16-01..03, built-in report FX/netting sweep, export sweep, categories/payees/tags/calendar sampling, mutation table, sections 6-14.

## 1. Metadata

| Field | Value |
| --- | --- |
| Session | S16 |
| `AUDIT_BASELINE_SHA` | `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86` |
| `git rev-parse HEAD` at start | `71daab591ca8b4a99f2205c2beb0fff79a7d2ae8` (pin check: no code diff against the baseline outside `docs/audits/`) |
| Date | 2026-10-21 |
| Primary path | `backend/src/budgets/` |
| Hint line | `prioritize a category's cost as its signed net within one category and never across two, transfer splits in budget spending, what a row is deciding the filter and never the account type, budget-alert check-then-insert, period rollover across replicas, exports giving the same server-authoritative figure as the screen, and partial totals captioned as partial` |
| Runtime | Node 24.22.1, `npm ci` (backend) clean; PostgreSQL 16 (`mirror.gcr.io/library/postgres:16-alpine`). `npm run test:integration -- "budget\|report\|categor\|payee\|calendar\|tag-usage"`: 10 suites, 112 tests, all passed (budget-period-rollover, budget-split-transfer-spending, calendar-day-notes, calendar-read-models, category-delete-set-null, category-service-write, payee-lookup-quota, report-investment-cash, report-tag-key-breakdown, tag-usage). |

## 4. Confirmed findings (provisional, execution pending)

- A26-S16-01 (candidate HIGH): budget actuals sum `t.amount` / `s.amount` across accounts of every currency with no conversion into `budgets.currency_code` (`budget-spending.util.ts:124-155`, `budget-period.service.ts:355-397`, `budgets.service.ts:1031-1085`), while upcoming bills on the same screen are converted (`budgets.service.ts:572-592`). Feeds the budget page, alerts and emails, the persisted closed-period `actual_amount` and rollover.
- A26-S16-02 (candidate MEDIUM): `closePeriod` loads `periodCategories` without `budgetCategory` (`budget-period.service.ts:130-133`), and `computeRollover` returns 0 when `periodCategory.budgetCategory` is absent (`:297-300`); the unit fixtures hydrate the relation (`budget-period-lifecycle.spec.ts:405`), so no suite sees it.
- A26-S16-03 (candidate LOW/MEDIUM): `POST /budgets/:id/periods/close` on the current month closes it and `createNextPeriod` inserts the same `period_start` (`getCurrentMonthPeriodDates`), so `ON CONFLICT DO NOTHING` returns the just-closed row and the budget is left with no OPEN period; the monthly cron then skips it (`budget-period-cron.service.ts:152-154`).
- A26-S16-04 (candidate LOW): two flex groups at or above 90 percent produce two `FLEX_GROUP_WARNING` candidates with `budget_category_id` NULL and the same severity, which share one `idx_notifications_fingerprint` key; the second is refused for the whole period (`budget-alert.service.ts:565-610`).
- `Budget.config.excludedAccountIds` and `includeTransfers` are declared (`entities/budget.entity.ts:29-30`) and read nowhere in `backend/src`.

## 5. Prior-finding dispositions (provisional)

| ID | Disposition | Evidence |
| --- | --- | --- |
| MON-M31 | provisional FIXED_VERIFIED for transfer budget lines | `outgoingSplitTransfers` (`budget-spending.util.ts:70-94`) on all six transfer readers; `budget-split-transfer-spending.integration.spec.ts` passed |
| MON-L03 | provisional FIXED (mechanism present, race not yet executed) | `NotificationService.create` `INSERT ... ON CONFLICT DO NOTHING RETURNING id` (`notification.service.ts:140-163`) over `idx_notifications_fingerprint` (`database/schema.sql:2483-2490`); the index is not declared on the entity, so the synchronize-built integration schema has no index to contend over |

## 12. Review ledger (partial)

Files read in full: `budgets/budget-spending.util.ts`, `common/investment-filter.util.ts`, `budgets/budget-period.service.ts:90-470`, `budgets/budget-period-cron.service.ts:70-230`, `budgets/budget-alert.service.ts:137-715`, `budgets/budgets.service.ts:1031-1168`, `notification-center/notification.service.ts:100-185`.
