# Internationalization (i18n) with Polish translation + Monthly Breakdown report

This branch delivers two independent features. They share a branch only because
the new report's UI strings are localized through the i18n layer added here; the
two parts can be split into separate PRs if preferred (i18n first, report second).

---

## Part 1 — Internationalization (next-intl) with a full Polish translation

### Summary
Adds multi-language support to the frontend using **next-intl**, with **English
as the default** and a complete **Polish** translation. Users switch language
from **Settings -> Preferences**; the choice is stored in a cookie and persists
across sessions. English is the fallback locale, so any not-yet-translated string
renders in English rather than breaking.

### How it works
- **Locale source**: a `NEXT_LOCALE` cookie (no URL prefix), so language follows
  the user across the authenticated SPA without rewriting routes. Resolved in
  `src/i18n/request.ts`; `<html lang>` is set from it in the root layout.
- **Catalogs**: messages are split into **24 per-namespace JSON files** per locale
  (`src/i18n/messages/{en,pl}/<namespace>.json`) so feature work stays isolated.
  They are merged at load time.
- **Fallback**: the active locale is deep-merged onto the English base
  (`src/i18n/merge.ts`), so a missing Polish key transparently falls back to
  English. Partial translations are always safe.
- **Switcher**: `LanguageSwitcher` writes the cookie via a server action and
  refreshes; added to `PreferencesSection`.

### Coverage
- **208 components/pages** localized via `useTranslations` / `getTranslations`.
- **4171 message keys** per locale, with **exact EN/PL key parity**.
- Fully translated areas: navigation/shell, auth, dashboard, accounts,
  transactions, scheduled transactions, categories, payees, tags, budgets,
  bills, investments, securities, currencies, insights, import, settings, admin,
  AI, reconcile, shared UI primitives, and the Reports catalog (report names,
  descriptions, categories, filters) plus 15 report views.
- **Known follow-up**: ~45 of the larger report components (mostly investment
  reports and the custom/investment report builders) are not yet localized and
  fall back to English. The pattern and shared keys are in place to finish them.

### Polish terminology
Terminology was validated against the official **GnuCash Polish glossary** and
documented in `src/i18n/GLOSSARY.pl.md` for consistency across namespaces
(e.g. income = przychód, expense = wydatek, account transfer = przelew,
securities transfer = przeniesienie, reconcile = uzgodnij, payee = odbiorca,
net worth = wartość netto). One deliberate deviation: payee is `odbiorca`, not
GnuCash's `wierzyciel` (creditor), which is the wrong semantics for a payee.

### Tests
- Existing component tests resolve `t('...')` against the real English catalog
  via a `next-intl` test mock (`src/test/setup.ts`), so assertions on visible
  English text keep passing unchanged.
- New tests for the i18n core: `merge.test.ts` (fallback deep-merge) and
  `config.test.ts`.
- Full frontend suite green; type-check clean.

---

## Part 2 — Monthly Breakdown report (recreates yaffa PR #409)

### Summary
Adds a new built-in report, **Monthly Breakdown** (`monthly-category-breakdown`),
showing expense/income amounts broken down by **category (rows) x month
(columns)** — a spreadsheet-style budget overview ported from yaffa's
"Monthly breakdown" tab.

### Features
- Categories **grouped into sections by parent category** (parentless -> "Other"),
  sections sorted by total with colored headers and subtotal rows.
- **Total** and **Avg/month** columns; **grand summary** rows (total expenses,
  total income, balance per month); a **section recap** at the bottom.
- **Deviation highlighting**: cells shaded red/green at 5/10/15% above/below the
  category's non-zero-month average (reversed for income; needs >= 3 non-zero
  months).
- **Percentage toggle** (share of monthly income/expense total).
- **Drill-down**: clicking a non-zero cell opens the transactions list filtered to
  that month + category (`/transactions?categoryIds=...&startDate=...&endDate=...`).

### Architecture (follows Monize conventions)
- **Backend** `GET /built-in-reports/monthly-category-breakdown` (auth-guarded,
  `userId` from JWT, parameterized QueryBuilder, base-currency conversion via
  `report-currency.service`). Read-only aggregation — **no schema changes or
  migrations**. Returns months + per-category rows
  (`{categoryId, categoryName, parentId, parentName, isIncome, valuesByMonth,
  depositTotal, withdrawalTotal}`); section grouping / deviation / percentage are
  computed client-side, matching yaffa.
- **Frontend** `MonthlyCategoryBreakdownReport.tsx` (Tailwind, dark-mode aware),
  registered in the reports list and the `[reportId]` router. Localized via the
  i18n layer above.
- Money math uses integer-cents rounding on both sides (no floating-point drift).

### Tests
- Backend: new service spec (7 tests); backend type-check clean; the
  `built-in-reports` suite passes.
- Frontend: component tests (table rendering, sections, deviation, percentage,
  drill-down) and the report-registry tests pass.

---

## Validation
- Frontend: `tsc --noEmit` clean; full Vitest suite green.
- Backend: `tsc --noEmit` clean; `built-in-reports` Jest suite green.
- Production image built with Podman (`npm ci` + `next build` in-container).

## Notes for reviewers
- No emojis, immutable updates, NestJS `Logger` (no `console.log`), parameterized
  queries, and DTO validation follow `CLAUDE.md`.
- `database/schema.sql` is unchanged (the report adds no tables/columns).
