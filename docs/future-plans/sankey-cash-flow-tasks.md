# Sankey Cash Flow: Agent Task List

> Companion to [`sankey-cash-flow.md`](./sankey-cash-flow.md) (the design). One task per session/PR, in dependency order. Mark a task done by checking its box and noting the PR.

## How to use this list (read first, every session)

- **One task per session/PR.** Each task lists its files. Touching files outside the task's scope is a scope violation -- stop and leave a note instead.
- **The governing invariants apply to every task:** the diagram closes (SANKEY-001), a transfer leg is counted once by scope and class (SANKEY-002), investment linkage and VOID are excluded on every branch (SANKEY-003), a total is null while a pair is missing (SANKEY-004), and the "Other" merge is drawing only (SANKEY-005). A component that sums links, or a query without `investmentExclusionSql`, is off the plan.
- **Every figure is the server's.** The component merges for drawing over a copy and reads the totals from the response.
- **Definition of done for every task** (in addition to per-task acceptance):
  - `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `TZ=UTC npm run test:unit -- --coverage`; plus `npm run build && npm run test:integration` because the service is a query.
  - `frontend/`: `npm run lint && npm run type-check && npm run i18n:check`, `npm run test:cov`, `npm run build` (the bundle-size job reports the lazy chunk; note its size in the PR).
  - Stage new files before running a guard (`git add -N` is enough).
  - New user-facing strings: English catalogs only, then `npm run i18n:pseudo`. The full-locale pass is Q3, once, at acceptance.
  - The doc line each task names lands in the same PR.
- **Terminology:** "the design" = `sankey-cash-flow.md`; section references point there. Re-locate code by symbol, never by line.

## Deployment safety

| Class | Meaning |
|-------|---------|
| **none** | Tests, docs, or code nothing calls yet. |
| **inert** | Ships an endpoint or a component nothing links to until the catalog entry lands. |
| **live** | The report appears in the catalog. |

No task writes to the database; there is no migration. S2 is a docs-only amendment of an invariant's wording and is its own PR so the discussion can reject it independently.

## Task graph

| ID | Task | Depends on | Deploy impact | Status |
|----|------|-----------|---------------|--------|
| S1 | Discussion agreeing `sankey-cash-flow.md`; label `approved-to-build`; K1 and K2 answered | -- | none | [x] issue #1490 |
| S2 | Amend INV-REPORT-003 in `docs/system-invariants.md` and `docs/specs/report-tag-key-breakdown.md` ("named flow" covers a destination class) | S1 | none | [x] issue #1490 |
| B1 | `CashFlowSankeyService` (scope, income, expense, outflow, inflow queries; residual; links; SANKEY-001..004), DTO, controller route, facade method, `sankey-branches.guard.spec.ts` (SANKEY-003) | S2 | inert | [x] issue #1490 |
| B2 | Property test over generated ledgers for SANKEY-001 and the integration suite on real PostgreSQL | B1 | none | [x] issue #1490 |
| F1 | `buildTransactionsHref` helper + test | S1 | none | [x] issue #1490 |
| F2 | `sankey-layout.ts` (hub-centred links to recharts shape; "Other" merge; `MAX_NODES_PER_COLUMN`) + test; the `ui-conventions.test.ts` case (SANKEY-005) | S1 | none | [x] issue #1490 |
| F3 | `CashFlowSankeyReport` component with diagram, table twin, legend, tooltip, toolbar, drill-down, phone default; API client and types | B1, F1, F2 | inert | [x] issue #1490 |
| F4 | Catalog entry, lazy route entry, `reports.json` name and description, `report-definitions.test.ts` | F3 | live | [x] issue #1490 |
| Q1 | Playwright `tests/cash-flow-sankey.spec.ts` | F4 | none | [x] issue #1490 |
| Q2 | PDF and CSV export cases, `report-locale.guard.test.ts` green, theme contrast for the new node colours | F3 | none | [x] issue #1490 |
| Q3 | Full-locale i18n pass (acceptance, final commit) | all above | none | [x] issue #1490 |
| D1 | Wiki Reports page row, README sample list line, `docs/system-invariants.md` SANKEY-001..005 | Q1 | none | [x] issue #1490 (README and catalog; the wiki is outside the repository) |
| M1 | Migrate the other reports' drill-down URLs onto `buildTransactionsHref` | F1, D1 | neutral | [ ] (optional, separate proposal) |

**Why F1 and F2 depend only on S1:** both are pure client helpers with their own tests; they can be built in parallel with B1 and meet at F3.

---

## Task details

### S1 -- Proposal

Open a Discussion linking `sankey-cash-flow.md`, summarising decisions 1-11, the endpoint and the amendment to INV-REPORT-003, and asking the maintainer to answer K1 (default scope includes savings) and K2 (credit-card payments as "Other accounts"). Record the answers in the design before S2 starts.

### S2 -- Invariant amendment

**Files:** `docs/system-invariants.md` (INV-REPORT-003 statement and mechanism), `docs/specs/report-tag-key-breakdown.md` (a note that the named-flow model is shared).

- Wording per design section 5. No code changes. Its own PR.

### B1 -- Service, DTO, route

**Files:** `backend/src/built-in-reports/cash-flow-sankey.service.ts` + `.spec.ts`, `backend/src/built-in-reports/sankey-branches.guard.spec.ts`, `backend/src/built-in-reports/dto/cash-flow-sankey.dto.ts` (new), `backend/src/built-in-reports/dto/index.ts`, `backend/src/built-in-reports/built-in-reports.controller.ts` + `.spec.ts`, `backend/src/built-in-reports/built-in-reports.service.ts` + `.spec.ts`, `backend/src/built-in-reports/built-in-reports.module.ts`, `docs/backend/transactions-and-money.md` (one entry: a transfer leg becomes a Sankey flow by scope and class), `docs/financial-semantics.md` (a "Cash flow Sankey" section stating decisions 1-8).

- Four queries through `withScopedDb`, each with `investmentExclusionSql`, the VOID predicate, `t.parent_transaction_id IS NULL`, the asset-category `NOT EXISTS`, `TO_CHAR` on dates, `Number(...)` at the boundary; the transfer queries join the counterpart account for its type; `FxAggregate` per link with `resolveFxRate` on the row's date (INV-FX-001, INV-FX-002 via the row's own rate when present); the residual and SANKEY-001 check in scaled integers; `ReportCurrencyService` for the reporting currency.
- The guard: the four query-builder functions each contain `investmentExclusionSql(` and the VOID predicate (the INV-REPORT-001 guard pattern).
- Acceptance: truth tables A and B, the numerical example with and without the USD rate, the Scope and Exclusions rows of the test matrix.

### B2 -- Property and integration tests

**Files:** `backend/src/built-in-reports/cash-flow-sankey.property.spec.ts` (new; a seeded generator of ledgers over the account types, both transfer directions, splits, VOID, investment-linked legs; asserts SANKEY-001 and SANKEY-002), `backend/test/integration/cash-flow-sankey.integration.spec.ts` (new; the numerical example on real PostgreSQL, scope widening makes a leg internal).

### F1 -- Drill-down helper

**Files:** `frontend/src/lib/transactions-href.ts` + `.test.ts` (new), `docs/frontend/ui-conventions.md` (one line: a link from a report to Transactions is `buildTransactionsHref`; existing sites migrate in M1).

- Uses `URLSearchParams`; `categoryId` accepts the `SPECIAL_CATEGORY_FILTER_IDS` pseudo-ids; `accountIds` csv.

### F2 -- Layout helper and the rendering guard

**Files:** `frontend/src/components/reports/sankey-layout.ts` + `.test.ts` (new), `frontend/src/test/ui-conventions.test.ts` (a case: `CashFlowSankeyReport.tsx` imports nothing from `widget-shared` or any sum helper; `sankey-layout.ts` returns new arrays and never mutates the response).

- `toRechartsSankey(response, { depth, maxNodesPerColumn })` -> `{ nodes: [{ name, id, kind, color }], links: [{ source: index, target: index, value }] }`; the "Other" node per column with its member list for the tooltip; links with `amount: null` are drawn at `knownAmount` and flagged.

### F3 -- Report component

**Files:** `frontend/src/components/reports/CashFlowSankeyReport.tsx` + `.test.tsx` + `.mobileWrapped.test.tsx` (new), `frontend/src/lib/built-in-reports.ts` + `.test.ts`, `frontend/src/types/built-in-reports.ts`, `frontend/src/i18n/messages/en/reports.json` (the report's own keys under `sankey.*`).

- `vi.mock("recharts")` through `frontend/src/test/recharts-mock.tsx` extended with a `Sankey` stub (one line); `useNumberFormat()` for every number; `useDateFormat` for the range; `chartColors` and `buildCategoryColorMap` only; `role="img"` with an `aria-label` from the totals; the table twin under `ChartViewToggle`; `ReportToolbarActions` last in the toolbar row; phone default `table` via the `sm` media query hook the other reports use (locate by `useMediaQuery` or the equivalent in `hooks/`).

### F4 -- Catalog entry

**Files:** `frontend/src/components/reports/report-definitions.tsx`, `frontend/src/app/reports/[reportId]/page.tsx` + `.test.tsx`, `frontend/src/i18n/messages/en/reports.json` (`page.names.cash-flow-sankey`, `page.descriptions.cash-flow-sankey`), `frontend/src/components/reports/report-definitions.test.ts`.

- Live: the card appears in the catalog under Insights.

### Q1 -- E2E

**Files:** `e2e/tests/cash-flow-sankey.spec.ts` (new). The demo data set is the fixture.

### Q2 -- Export, locale guard, contrast

**Files:** `CashFlowSankeyReport.test.tsx` (export cases), `frontend/src/test/theme-contrast.test.ts` (only if a new token is introduced; this plan introduces none).

### Q3 -- Localization pass

Every locale for `reports`. Final commit on the last PR.

### D1 -- Documentation

**Files:** the wiki's Reports page (an Insights row), `README.md` (one line in the sample list), `docs/system-invariants.md` (SANKEY-001..005 with mechanisms and status).

### M1 -- Drill-down migration (optional)

Its own proposal: replace the per-report `URLSearchParams` and template-string sites with `buildTransactionsHref`, one report per PR, shrink-only against a baseline listing the current sites.
