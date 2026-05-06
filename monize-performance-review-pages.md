# Monize — Multi-Page Performance Review

**Pages reviewed:** `/transactions`, `/bills`, `/investments`, `/accounts`, `/budgets`, `/reports`
**Stack:** Next.js (Turbopack) App Router, Recharts, Tailwind, PWA (service worker active, transferSize=0 on cached assets)
**Captured:** 2026-05-06 via Chrome DevTools performance trace + runtime introspection on each page
**Companion file:** `monize-performance-review.md` covers `/dashboard`

---

## Executive summary

| Page | LCP (ms) | CLS | Forced reflow | DOM | API decoded | Notes |
|---|---|---|---|---|---|---|
| **/transactions** | 1138 | **0.61** | 251 ms | 1718 | **~6.7 MB** | Duplicate API fetches; `/payees` 1.26 MB × 2; `/accounts/daily-balances` 1.88 MB × 3 |
| **/bills** | 1103 | 0.04 | **652 ms** | 1178 | 179 KB | Big scheduled-tx table re-rendering with 1 chart |
| **/investments** | **2292** | **0.59** | **1147 ms** | 1694 | 193 KB | `/exchange-rates` × 5; 366-dot Recharts area; 758 ms style recalc |
| /accounts | 951 | 0.00 | – | 1020 | 78 KB | Clean ✓ |
| /budgets | 680 | 0.00 | – | 123 | 66 KB | Clean ✓ |
| /reports | 634 | 0.00 | – | 839 | 26 KB | Landing page (loads charts on demand) ✓ |

**Worst offenders:** `/transactions` (network), `/investments` (rendering), `/bills` (forced reflow).
**Best:** `/reports`, `/budgets`, `/accounts` — all CLS 0, sub-1 s LCP.

---

## Cross-cutting issues (recur across pages)

These are the patterns that appear on multiple pages — fix once, fix everywhere.

### A. Recharts ResponsiveContainer warning (dashboard, bills, investments)

```
The width(-1) and height(-1) of chart should be greater than 0…
```

Appears whenever a chart is inside a flex/grow container with no fixed initial height. Causes layout shift + forced reflow.

**Fix pattern:** wrap every `ResponsiveContainer` in a div with explicit pixel height (or `aspect-ratio`):

```tsx
<div className="h-[320px]"> {/* not h-72 inside flex-grow */}
  <ResponsiveContainer width="100%" height="100%">…</ResponsiveContainer>
</div>
```

After this single change the warning should disappear from the console on every page.

### B. Duplicate API fetches (transactions, investments)

Multiple components on the same page each fetch the same endpoint independently. React Query / TanStack Query is presumably already used elsewhere — these duplicates indicate either:

1. Multiple components calling the API directly (bypassing the query cache), or
2. Different `queryKey`s used by each component for what is logically the same data, defeating the cache, or
3. React 18 strict mode double-effect (only in dev — but if you're seeing it in prod, something else).

Concrete duplicates measured live:

| Page | Endpoint | Times fetched | Decoded each |
|---|---|---|---|
| /transactions | `/api/v1/payees` | **2** | 1.26 MB |
| /transactions | `/api/v1/accounts/daily-balances` | **3** | 1.88 MB / 1.6 MB / 1.6 MB |
| /transactions | `/api/v1/transactions` | **3** | 130 KB each |
| /transactions | `/api/v1/categories` | 2 | 84 KB |
| /transactions | `/api/v1/accounts` | 2 | 50 KB |
| /transactions | `/api/v1/budgets/category-budget-status` | 2 | 1.7 KB |
| /investments | `/api/v1/currencies/exchange-rates` | **5** | 0.3 KB |

`/transactions` alone is wasting ~5 MB of redundant fetches per page load. Fix by:

- Centralize on TanStack Query with a stable `queryKey` per logical resource (`['payees']`, `['accounts', { active: true }]`, etc.).
- Set `staleTime` aggressively for slow-changing data (`payees`, `categories`, `accounts`, `exchange-rates`): 1–24 h.
- For derived data, use `useQuery` selectors instead of separate fetches.

### C. Oversized backend responses

| Endpoint | Size | Where seen | Comment |
|---|---|---|---|
| `/api/v1/accounts/daily-balances` | **1.88 MB** | /transactions | Daily balances per account for full history → server-side aggregate to needed range, or stream. |
| `/api/v1/payees` | **1.26 MB** | /transactions | Almost certainly returns extra fields (transaction history, last-used dates, totals). Ship minimal `{id, name, defaultCategory}` for the picker; load enriched data only on payee detail. |
| `/api/v1/investment-transactions` | 126 KB | /investments | Reasonable for a 50-row paginated view. |
| `/api/v1/transactions?limit=200` | 200 KB | /dashboard | Already noted — drop limit on dashboard widget. |
| `/api/v1/transactions?page=1&limit=50` | 130 KB | /transactions | OK for a page view, but verify columns shipped match what the table renders. |
| `/api/v1/categories` | 84 KB | most pages | Categories rarely change — long `staleTime`, plus check whether 84 KB is justified. |

### D. Recharts forced reflow (dashboard, transactions, bills, investments)

Same offending function `O @ 0thpn_acbk1r1.js:1:8421` (chunk hash differs by build). Total reflow times:

| Page | Reflow time |
|---|---|
| /dashboard | 120 ms |
| /transactions | 251 ms |
| /bills | **652 ms** |
| /investments | **1147 ms** |

This is Recharts measuring container geometry on each render. Same fix as (A) — when the parent has a stable size, Recharts measures once and stops.

For `/investments` specifically, the trace shows a Recharts area chart with **366 dots** (`recharts-area-dots`, presumably daily portfolio history for a year). 366 SVG `<circle>` elements per chart × multiple charts is the source of:

- 758 ms style recalculation touching 479 elements
- 816 ms reflow in chart 1, 329 ms in chart 2
- DOM depth 19 (path inside layered groups)

**Fix:** disable dots on dense time-series. In Recharts: `<Area dot={false} activeDot={…}>`. Show dots only on hover.

### E. Tables not virtualized (transactions, accounts, investments, bills)

| Page | Rows | Pixel height | Virtualized |
|---|---|---|---|
| /transactions | 50 (limit) | 3234 px | No |
| /investments | 50 (limit) | 3490 px | No |
| /accounts | 58 | 3831 px | No |
| /bills | 23 | 1380 px | No |

50 rows is borderline — current scrolling is fine. But the layout updates show 1000–2000 nodes needing layout per render, which means re-renders are expensive. If you ever raise `limit` past ~100 you'll feel it.

**Fix:** adopt `@tanstack/react-virtual` or `react-window` for the transactions and investments tables. Initial render touches O(viewport rows) instead of O(all rows).

### F. Render delay dominates LCP (every page)

Across all 6 pages, render delay accounts for **95–98 % of LCP time**. TTFB is 21–26 ms (the backend is fast); the bottleneck is JS hydration before the LCP element can paint.

Two levers:

1. **Server-render the page shell.** Move titles, navigation, card frames into Server Components. Stream client widgets in via Suspense. The LCP element (often a header/title text) should paint as part of the initial HTML, not after hydration.
2. **Trim the hydration bundle.** Three identical 324 KB chunks consistently appear in the network log on every page (`0eiwa6v4u2z.y.js`, `01.x3p5g6ujm5.js`, `0tv351iuo1s~q.js`, `0p_iv2w.zfs~w.js` — the names rotate but the size is constant). Run `ANALYZE=true next build` to verify they aren't duplicate copies of the same vendor code emitted into multiple route group chunks.

### G. CSS bundle is 118 KB

Single stylesheet `0…ubbyshn_.css` / `0ul3peou…css` (filename rotates). 118 KB decoded for what should be a Tailwind app. Verify:

- `tailwind.config.js` `content` glob covers the actual source paths and nothing more (over-broad globs sometimes prevent purging).
- No `@import` of unminified third-party CSS (date pickers, syntax highlighters).
- `next build && next start` (not Turbopack dev) is what's serving production.

### H. Service worker caching strategy

Service worker is active on every page (`navigator.serviceWorker.controller` truthy). transferSize=0 on cached resources. Verify:

- Workbox or your custom SW has cache-first for `/_next/static/*` (correct) and a strategy for `/api/v1/*`. Minimum: stale-while-revalidate for slow-changing endpoints (`accounts`, `categories`, `payees`, `exchange-rates`, `auth/profile`).
- HTML for app routes is **not** cached aggressively, or you'll mask updates.
- The SW does not retry failed requests (would inflate the duplicate-fetch issue further).

---

## Per-page detail

### /transactions — worst overall

| Metric | Value |
|---|---|
| LCP | 1138 ms |
| CLS | **0.61** (catastrophic) |
| Forced reflow | 251 ms |
| DOM | 1718 elements, depth 17, tbody w/ 50 children |
| API total | **~6.7 MB decoded** (with duplicates) |
| Layout updates | 88 ms touching 2083/2310 nodes; style recalc 76 ms × 1292 elements |

**CLS cluster:** 3 shifts of 0.18, 0.19, 0.23 across 1.6–3.9 s. Almost certainly:

1. Empty page renders → table appears with placeholder rows → real rows load → categories/payee dropdown filters appear → chart re-measures.
2. Each of the 13+ API responses arrives at a different time, causing visible movement.

**Action items, in priority order:**

1. **Stop duplicate fetches.** Audit which components on `/transactions` request `/payees`, `/accounts/daily-balances`, `/transactions`, `/categories` — consolidate behind a single TanStack Query call per resource. Rough payload reduction: **~5 MB** per page load.
2. **Trim `/payees`.** Return only `{id, name}` for the picker; if there's a bulk-list view it should request a heavier shape under a different key. Target: ≤ 50 KB.
3. **Trim `/accounts/daily-balances`.** Either reduce to the date range the page actually charts, or add a `/api/v1/accounts/daily-balances/summary` aggregate (monthly buckets) for the chart and only fetch full daily on drill-down. Target: ≤ 100 KB.
4. **Reserve heights** on the chart container, the filter row (date picker, category dropdown, search), and the table to kill the CLS shifts. Skeleton a 50-row table immediately; replace with real rows when data arrives.
5. **Virtualize the table** with `@tanstack/react-virtual`.

Filter controls measured: Bulk Update, All categories, two date pickers, search field, Export. That's 6 stateful elements above the table — they each appear and shift content as JS hydrates.

### /bills — high forced reflow despite low CLS

| Metric | Value |
|---|---|
| LCP | 1103 ms |
| CLS | 0.04 (good) |
| Forced reflow | **652 ms** |
| DOM | 1178 elements |
| Layout updates | 134 ms × 1059 nodes (largest single layout pass on any page) |
| Cards | "Cash Flow Forecast" 477 px (chart), 1380 px scheduled-transactions table |
| Console | 1× Recharts width(-1)/height(-1) |

The page is two big sections: a forecast chart (Recharts), then a 23-row scheduled-transactions table. CLS is fine because the chart and table both render with stable heights. But the chart's measure-then-render cycle plus the 23-row table re-rendering whenever filters/data change adds up to 652 ms reflow.

**Action items:**

1. **Wrap the Cash Flow Forecast chart** in a fixed-height div (kills the Recharts warning + cuts the largest reflow caller).
2. **Memoize the scheduled-transactions table** rows so re-renders don't touch every row. Each row should be `React.memo`'d on its data.
3. **Layout update of 134 ms touching 1059 nodes** is the table re-laying out. Combined with (2), look at whether the table is in a flex container that stretches based on content — replace with explicit grid or overflow scroll.

### /investments — slowest LCP, worst forced reflow

| Metric | Value |
|---|---|
| LCP | **2292 ms** (close to "needs improvement" 2.5 s threshold) |
| CLS | **0.59** (catastrophic) |
| Forced reflow | **1147 ms** |
| DOM | 1694 elements, depth 19 |
| Charts | 4 Recharts containers; one with 366-dot area |
| Style recalc | **758 ms** affecting 479 elements |
| Console | 1× form-field-no-id-or-name issue, 2× Recharts width(-1) warnings |

**Smoking gun:** Recharts area-dots layer with **366 child paths** (the daily price history). This is the dominant cost on the page.

**Action items:**

1. **Disable dots on the time-series area chart:** `<Area dot={false} activeDot={{ r: 4 }} />`. Drops 366 SVG elements → cuts style recalc and layout time dramatically.
2. **Reduce data density.** Daily resolution for a year (366 points) is fine to plot but pointless to render dots for. If users zoom in, server-render daily; default to weekly buckets at year scope.
3. **Stop refetching `/exchange-rates` 5 times per page load.** All 5 calls are identical — that's a clear cache-miss bug. Fix the query key.
4. **Reserve heights** on the 4 chart containers and the 51-row holdings table.
5. **Form field a11y:** add `id` or `name` to the unnamed form field (issue tracked in console).
6. Audit the LCP element (text node) — at 2292 ms it's the slowest of all pages, suggesting hydration is gated on the full chart bundle.

### /accounts — clean

| Metric | Value |
|---|---|
| LCP | 951 ms |
| CLS | 0.00 ✓ |
| Forced reflow | none flagged |
| DOM | 1020 elements |
| Tables | 58-row accounts table, 3831 px tall |
| API total | 78 KB |

**Action items (minor):**

1. Layout update of 79 ms touches 1476/1565 nodes when the table renders — virtualization (or row memoization) would help if the account list grows.
2. No charts → no Recharts issues. Good baseline for the rest of the app.

### /budgets — cleanest

| Metric | Value |
|---|---|
| LCP | 680 ms (fastest tracked) |
| CLS | 0.00 ✓ |
| Forced reflow | none flagged |
| DOM | **123 elements** (smallest) |
| Tables | 0 |
| Charts | 0 |
| API total | 66 KB |

This page works. Nothing to fix. **Use this layout pattern as the template** for refactoring the others — clearly the budget list is collapsed/lazy-loaded such that DOM stays small.

### /reports — landing page

| Metric | Value |
|---|---|
| LCP | 634 ms (fastest) |
| CLS | 0.00 ✓ |
| Forced reflow | none flagged |
| DOM | 839 elements |
| Charts/tables | 0 |
| Headings detected | "Net Worth Over Time", "Monthly Comparison", "Spending by Category", "Spending by Payee", "Monthly Spending Trend", "Income vs Expenses", "Income by Source", "Account Balances", "Cash Flow Statement" |
| API total | 26 KB |

It's a landing page that lists 9+ report cards. Charts load on demand when the user clicks into a specific report. Good pattern.

**Action items (minor):**

1. Form field a11y issue (same as /investments) — likely a search/filter input on the page.
2. Consider preloading the chart bundle once a user hovers a report card so the click→render feels instant.
3. Reuse this lazy-load-charts pattern on `/dashboard` and `/investments`, where charts are eager-loaded today.

---

## Combined action plan

Ordered by ratio of impact to effort. The same fix often helps multiple pages — note the "pages helped" column.

| # | Action | Pages helped | Effort | Estimated impact |
|---|---|---|---|---|
| 1 | Eliminate duplicate API fetches by centralizing TanStack Query keys | /transactions, /investments | ½ day | −5 MB on /transactions, +faster TTI everywhere |
| 2 | Wrap every Recharts `ResponsiveContainer` in a fixed-height div | /dashboard, /bills, /investments | 2 h | Removes Recharts warnings, cuts reflow up to 600+ ms on /investments |
| 3 | Add `dot={false}` to dense time-series Recharts areas | /investments (and any other) | 30 min | Cuts /investments style recalc 758 → ~100 ms |
| 4 | Trim `/api/v1/payees` and `/api/v1/accounts/daily-balances` payloads | /transactions | 1 day backend | −3 MB+ wire on /transactions |
| 5 | Reserve heights / skeleton loaders on every dashboard, transactions, investments card | /dashboard, /transactions, /investments | ½ day | CLS 0.31 → < 0.1, 0.61 → < 0.1, 0.59 → < 0.1 |
| 6 | Convert page shells (header/nav/card frames) to Server Components, stream widgets via Suspense | all pages | 2 days | LCP render delay −300 to −800 ms |
| 7 | Stable cache keys + long `staleTime` for `/categories`, `/accounts`, `/auth/profile`, `/exchange-rates`, `/payees` | all pages | 2 h | Cuts repeat-API cost on every navigation |
| 8 | Virtualize transactions and investments tables | /transactions, /investments | ½ day | Faster scroll, smaller layout updates |
| 9 | Bundle analyzer pass; verify the three 324 KB vendor chunks aren't duplicates | all pages | ½ day | Possibly −300 KB JS parse |
| 10 | Verify Tailwind purge / CSS bundle 118 KB → ≤ 60 KB | all pages | 1 h | Faster initial CSS parse |
| 11 | Memoize table rows (`React.memo`) | /bills, /accounts, /transactions, /investments | 2 h | Cuts re-render reflow |
| 12 | Service worker `/api/v1/*` cache strategy (SWR) | all pages | 1 day | Faster repeat loads |
| 13 | A11y: add `id`/`name` to form field | /investments, /reports | 5 min | Lighthouse a11y |

**Recommended sequencing:** 2 → 3 → 5 (immediate visible CLS/reflow wins) → 1 → 4 → 7 (network-side wins on heaviest pages) → 6 (the architectural one) → 8–13 (polish).

---

## Verification targets after fixes

For each page, re-trace and confirm:

| Page | LCP target | CLS target | Reflow target |
|---|---|---|---|
| /dashboard | < 800 ms | < 0.1 | < 50 ms |
| /transactions | < 1500 ms | < 0.1 | < 100 ms |
| /bills | < 1000 ms | < 0.1 | < 200 ms |
| /investments | **< 1500 ms** | < 0.1 | **< 200 ms** |
| /accounts | < 900 ms | < 0.1 | < 50 ms |
| /budgets | (already good) | (already good) | – |
| /reports | (already good) | (already good) | – |

Re-run with `--throttling.cpuSlowdownMultiplier=4` to validate against mid-tier devices.

---

## Raw measurements (for reference)

### Per-page metrics
```
                LCP    TTFB   Render   CLS    Reflow   DOM    APIs   Charts  Tables
/dashboard      765    59     706      0.31   120 ms   655    13     3       0
/transactions   1138   25     1113     0.61   251 ms   1718   13(7u) 2       1×50
/bills          1103   23     1080     0.04   652 ms   1178   8      1       1×23
/investments    2292   26     2266     0.59   1147 ms  1694   14(5d) 4       1×51
/accounts       951    21     931      0.00   none     1020   6      0       1×58
/budgets        680    21     659      0.00   none     123    6      0       0
/reports        634    24     611      0.00   none     839    5      0       0
```
(`u` = unique endpoints among duplicates; `d` = duplicates of the same endpoint)

### Forced-reflow source (constant across pages)
```
O @ /_next/static/chunks/0thpn_acbk1r1.js:1:8421
```
Source-mapped, this should resolve to Recharts' container measurement code (`ResponsiveContainer`).

### Largest API responses observed
```
/api/v1/accounts/daily-balances     1877590 B  (×3 on /transactions)
/api/v1/payees                      1263293 B  (×2 on /transactions)
/api/v1/transactions?limit=200       199908 B  (/dashboard)
/api/v1/transactions?limit=50        129635 B  (/transactions, ×3)
/api/v1/investment-transactions      125616 B  (/investments)
/api/v1/categories                    83761 B  (every page; ×2 on /transactions)
/api/v1/scheduled-transactions        61931 B  (/dashboard, /bills)
/api/v1/accounts                      50057 B  (/transactions, /investments)
```

### Universally cached resources (transferSize=0 from SW)
- `/_next/static/chunks/*` (24 chunks per page, ~1.9 MB decoded)
- Stylesheet `0ul3peou--.n2.css` etc. (118 KB)
