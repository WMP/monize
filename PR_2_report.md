# reports: Monthly Breakdown report (category-by-month matrix)

Branch: `feat/monthly-breakdown-report` -> base `main` (standalone; no i18n
dependency)

## Summary
Adds a new built-in report, **Monthly Breakdown** (`monthly-category-breakdown`),
showing expense/income amounts broken down by **category (rows) x month
(columns)** — a spreadsheet-style budget overview ported from yaffa's
"Monthly breakdown" tab (kantorge/yaffa#409).

## Features
- Categories **grouped into sections by parent category** (parentless -> "Other"),
  sections sorted by total with colored headers and subtotal rows.
- **Total** and **Avg/month** columns; **grand summary** rows (total expenses,
  total income, balance per month); a **section recap** at the bottom.
- **Deviation highlighting**: cells shaded red/green at 5/10/15% above/below the
  category's non-zero-month average (reversed for income; needs >= 3 non-zero
  months).
- **Percentage toggle** (share of monthly income/expense total).
- **Drill-down**: clicking a non-zero cell opens the transactions list filtered to
  that month + category.

## Architecture (follows Monize conventions)
- **Backend** `GET /built-in-reports/monthly-category-breakdown`: auth-guarded,
  `userId` from JWT, parameterized QueryBuilder, base-currency conversion via
  `report-currency.service`. Read-only — **no schema changes or migrations**.
  Returns months + per-category rows; section grouping / deviation / percentage
  are computed client-side, matching yaffa.
- **Frontend** `MonthlyCategoryBreakdownReport.tsx` (Tailwind, dark-mode aware),
  registered in the reports list and the `[reportId]` router. Plain English UI
  (this PR has no i18n dependency; the i18n PR localizes it on top).
- Money math uses integer-cents rounding on both sides (no floating-point drift).

## Tests
- Backend: new service spec (7 tests); `built-in-reports` Jest suite passes;
  `tsc --noEmit` clean.
- Frontend: component tests (sections, deviation, percentage, drill-down) and the
  report-registry tests pass; `tsc --noEmit` clean.

## Notes
No emojis, immutable updates, NestJS `Logger`, parameterized queries, DTO
validation per `CLAUDE.md`. `database/schema.sql` unchanged.
