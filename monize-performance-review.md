# Monize Dashboard — Performance Review (deep dive)

**Target:** `https://monize.ucdialplans.com/dashboard`
**Stack:** Next.js (Turbopack) App Router, Recharts, Tailwind, PWA (service worker active)
**Captured:** 2026-05-06 via Chrome DevTools performance trace + runtime introspection
**Companion screenshot:** `monize-dashboard.jpeg` (full-page render)

---

## TL;DR

The page is fast at the network layer (TTFB 59 ms) but has a **poor CLS of 0.31** because eight dashboard cards and three Recharts charts all paint with auto height while their data is fetching. Recharts itself logs `width(-1) and height(-1)` warnings three times — the same number as charts on screen, so it is the direct cause of one of the layout shifts. Top fix order:

1. Reserve heights on every card (minutes of work, ~0.2 CLS reduction)
2. Wrap charts to give Recharts a stable container before render (kills the Recharts warning)
3. Trim two specific oversized API responses (`transactions` 200 KB, `categories` 84 KB)
4. Convert the dashboard shell to a server component with streamed widgets

---

## Core Web Vitals (lab, no throttling)

| Metric | Value | Threshold | Verdict |
|---|---|---|---|
| TTFB | 59 ms | — | Excellent |
| FCP | ~110 ms | ≤ 1.8 s | Excellent |
| LCP | 765 ms | ≤ 2.5 s | Good |
| **CLS** | **0.31** | ≤ 0.1 | **Poor** |

LCP element: a `<p class="text-gray-500 dark:text-gray-400 text-sm">` (text). LCP breakdown: TTFB 59 ms (7.7 %) + render delay 706 ms (92.3 %).

### CLS cluster breakdown

| Shift | Start | Score | Likely cause |
|---|---|---|---|
| 1 | 764 ms | **0.3064** | Cards expand from 0 → real height as initial API responses arrive |
| 2 | 1413 ms | 0.0077 | Recharts re-measures after `ResponsiveContainer` gets a second layout |

---

## Smoking gun #1 — Recharts ResponsiveContainer warning

Console logs three identical warnings since navigation:

```
The width(-1) and height(-1) of chart should be greater than 0,
please check the style of container, or the props width(100%) and height(100%),
or add a minWidth(0) or minHeight(undefined) or use aspect(undefined) to control the
height and width.   (3 times)
```

Three charts on the dashboard (Net Worth, Expenses by Category, Income vs Expenses) → 3 warnings. Each `ResponsiveContainer` measures parent dimensions, gets `-1` (parent not laid out yet), then re-measures after the next frame, then renders SVG, then triggers another layout. That is the second layout-shift cluster at 1413 ms and contributes most of the forced-reflow time.

### Chart parents (measured live)

| Chart | Parent class | Rendered size | minHeight |
|---|---|---|---|
| Net Worth | `h-40 flex-grow` | 737×327 | `auto` |
| Top Movers / Income vs Expenses | `h-64` | 737×256 | `auto` |
| Expenses by Category | `h-64 flex-grow` | 737×386 | `auto` |

Note `h-40` (160 px) and `h-64` (256 px) only set the *initial* height; `flex-grow` then expands the container. Recharts measures during the in-between state where height is briefly `auto` or shrunk.

**Fixes (pick one per chart, in order of preference):**

1. Wrap Recharts in a div with explicit pixel height instead of `flex-grow`:
   ```tsx
   <div className="h-[327px]">
     <ResponsiveContainer width="100%" height="100%">…</ResponsiveContainer>
   </div>
   ```
2. Or use `aspect-ratio` on the wrapper (`className="aspect-[16/9]"`) — Recharts will respect it.
3. Avoid the warning entirely by passing fixed `width`/`height` props and skipping `ResponsiveContainer` when the layout already has a stable size.

---

## Smoking gun #2 — Cards have no reserved height

Measured runtime computed styles for the 8 dashboard cards:

| Card | Rendered | minHeight |
|---|---|---|
| Favourite Accounts | 785×644 | `auto` |
| Upcoming Bills & Deposits | 785×644 | `auto` |
| Net Worth | 785×503 | `auto` |
| Top Movers | 785×503 | `auto` |
| Expenses by Category | 785×539 | `auto` |
| Income vs Expenses | 785×539 | `auto` |
| Budget Status | 785×389 | `auto` |
| Spending Insights | 785×389 | `auto` |

Every card has `minHeight: auto`. Top-row cards are 644 px tall, but render at 0 px until accounts/bills load → that's the 0.3064 shift. Bottom rows shift by less because they're already pushed below the fold.

**Fix:** add `min-h-[Xpx]` or `style={{ minHeight: X }}` to each card matching its typical content height. For lists (Favourite Accounts, Upcoming Bills) the height should account for the typical row count × row height + header. Concrete starting values:

| Card | Suggested `min-h` |
|---|---|
| Favourite Accounts | `min-h-[644px]` |
| Upcoming Bills & Deposits | `min-h-[644px]` |
| Net Worth | `min-h-[500px]` |
| Top Movers | `min-h-[500px]` |
| Expenses by Category | `min-h-[540px]` |
| Income vs Expenses | `min-h-[540px]` |
| Budget Status | `min-h-[390px]` |
| Spending Insights | `min-h-[390px]` |

(Tweak after measuring on real content; using a skeleton inside the card is even better since it conveys loading state.)

---

## Smoking gun #3 — Forced reflow in `0thpn_acbk1r1.js`

Trace identified the offending function `O` at `/_next/static/chunks/0thpn_acbk1r1.js:1:8421`. Top callers (with self time including children):

| Time | Caller |
|---|---|
| 145 ms | `(anonymous) @ 0eiwa6v4u2z.y.js:0:304435` |
| 80 ms  | `(anonymous) @ 0o3iyl.26p~k2.js:0:13159` |
| 13 ms  | `s @ 0eiwa6v4u2z.y.js:0:256430` |
| 1 ms   | `(anonymous) @ 0eiwa6v4u2z.y.js:0:70853` |

Total reflow time: 120 ms. `0eiwa6v4u2z.y.js` is one of the 324 KB vendor-style chunks (see Bundle below). This pattern is consistent with Recharts' internal `getBoundingClientRect` calls on `ResponsiveContainer` — fixing the chart sizing (above) should also collapse this. After the chart fix, re-run the trace and confirm reflow drops below 50 ms.

> Filename hashes change each build. To resolve to source, run `next build` and search the chunk for `getBoundingClientRect`/`offsetWidth`. Source maps will let DevTools show the original component name.

---

## API fan-out (13 calls, 405 KB decoded)

Sorted by decoded size:

| Endpoint | Decoded | Transfer | Duration | Notes |
|---|---|---|---|---|
| `/api/v1/transactions?startDate=…&endDate=…&page=1&limit=200` | **200 KB** | 17 KB | 187 ms | **Way oversized for a dashboard widget.** Drop `limit` to 10–20 if the dashboard only renders a "recent" preview, or ship a dedicated `/api/v1/transactions/recent` endpoint that returns only the columns the card needs. |
| `/api/v1/categories` | **84 KB** | 12 KB | 170 ms | Categories rarely change. Cache in TanStack Query with `staleTime: Infinity` (or until the user edits a category), or move to a server component that hydrates them once. Also check whether the response includes per-transaction-history data that doesn't belong in a category list. |
| `/api/v1/scheduled-transactions` | 62 KB | 8 KB | 93 ms | Same pattern — cache aggressively. |
| `/api/v1/accounts?includeInactive=false` | 17 KB | 2 KB | 125 ms | Cache. |
| `/api/v1/budgets/alerts?unreadOnly=false` | 16 KB | 4 KB | 34 ms | Fine size, but consider `unreadOnly=true` on dashboard load and only fetch all on the alerts page. |
| `/api/v1/ai/insights` | 11 KB | 3 KB | 187 ms | Fine. |
| `/api/v1/portfolio/summary` | 11 KB | 3 KB | **302 ms** ← slowest | Backend bottleneck. Profile this endpoint server-side (likely a synchronous fetch of live prices). |
| `/api/v1/budgets/dashboard-summary` | 0.6 KB | 0.6 KB | 189 ms | Very small payload but slow — likely DB aggregation; check indexes. |
| `/api/v1/portfolio/top-movers` | 2 KB | 1 KB | 38 ms | Fine. |
| `/api/v1/net-worth/monthly?startDate=…&endDate=…` | 1 KB | 0.6 KB | 129 ms | Fine. |
| `/api/v1/currencies/exchange-rates` | 0.3 KB | 0.5 KB | 97 ms | Cache for hours, not per request. |
| `/api/v1/updates/status` | 0.3 KB | 0.5 KB | 82 ms | Background poll, not blocking. |
| `/api/v1/auth/profile` | 0.1 KB | 0.4 KB | 46 ms | Could ship in the initial document via cookie/session. |

**Action items, in priority order:**

1. **Trim `/api/v1/transactions?limit=200` for the dashboard.** This single endpoint is half the API payload. Add a `limit` parameter that the dashboard sets to `10` (or whatever the card displays).
2. **Trim `/api/v1/categories`.** 84 KB of categories is suspicious — inspect the JSON and remove fields the dashboard doesn't render (icon SVGs, history, ancestor trees, etc.).
3. **Investigate `/api/v1/portfolio/summary` 302 ms TTFB.** Largest single backend latency on the page; trace it server-side.
4. **Aggregate or stream.** Either:
   - **(A)** Add `GET /api/v1/dashboard` returning the data needed by all cards in one round trip, or
   - **(B)** Convert the dashboard route to a Next.js Server Component, fetch from your backend in `loading.tsx`/`page.tsx`, and stream cards in via Suspense. Browser receives one streamed HTML response instead of 13 separate JSON fetches.

---

## Bundle / JS

24 script chunks, total **decoded 1.9 MB** (transferSize is 0 because the service worker served everything from cache — but parse cost is paid every load):

| Chunk | Decoded | Note |
|---|---|---|
| `0eiwa6v4u2z.y.js` | 324 KB | Forced reflow source. Likely contains Recharts and/or framework-motion. |
| `01.x3p5g6ujm5.js` | 324 KB | Identical size — probably the same vendor chunk emitted under a different name (App Router route group). Worth verifying. |
| `0tv351iuo1s~q.js` | 324 KB | Same. |
| `0thpn_acbk1r1.js` | 233 KB | Contains the `O` reflow function. |
| `00nlt7x_9mi4z.js` | 137 KB | |
| `0z595td.k6xy4.js` | 71 KB | |
| `0nuiinggxg3g6.js` | 69 KB | |
| `148ko75-ihlmp.js` | 55 KB | |
| (15 more chunks) | ≤ 45 KB each | |

Three identical 324 KB chunks is suspicious. Possibilities:

- Same vendor bundle duplicated across route groups (App Router can split per layout).
- Heavy library (e.g. Recharts is ~140 KB gzipped, plus d3) included in multiple bundles.

**Action:** run `ANALYZE=true next build` (or `@next/bundle-analyzer`) and look for duplicates. Configure `experimental.optimizePackageImports` for `recharts`/`lucide-react`/`@tanstack/react-query`/`date-fns` if not already.

### CSS

Single stylesheet **0t8.~ubbyshn_.css = 118 KB decoded.** That is large for a Tailwind site. Verify:

- `content` glob in `tailwind.config.js` is correct (over-broad globs can prevent purge from working).
- No `@import` of full third-party CSS (e.g. `react-day-picker`'s default styles).
- Production build is generating the optimized CSS (Turbopack dev should be discounted; re-test against `next build && next start`).

---

## Service worker

`navigator.serviceWorker.controller` is active — the app is a PWA. transferSize=0 on revisit means the SW is caching aggressively, which is great for steady state. But:

- Confirm the SW has a strategy for **API responses** (cache-first for `/api/v1/categories`, `/auth/profile`, etc., stale-while-revalidate for `transactions`).
- Verify there is **no SW caching of `/dashboard` HTML** that could mask render delays during testing.

---

## DOM & framework signals

| Signal | Value | Comment |
|---|---|---|
| Total elements | 655 | Reasonable. |
| Max depth | 18 | Reasonable. |
| `__NEXT_DATA__` | absent | App Router (RSC), no Pages Router data blob. |
| `#__next` / `#root` | absent | Confirms App Router. |
| `nextScript` chunks | present | Standard Next.js. |

The dashboard route appears to be **fully client-rendered** despite the App Router being available. Look for a `'use client'` near the top of `app/dashboard/layout.tsx` or `page.tsx` — that single directive forces every descendant to be client. Splitting boundaries so card titles/frames stay server-rendered cuts the 706 ms render delay.

---

## Fonts

`Inter` via `next/font` — only one weight loaded, fallback `Inter Fallback` is metric-adjusted. No font-swap CLS visible. Leave alone.

---

## Quick-win order of operations

| # | Action | Effort | Impact | File hint |
|---|---|---|---|---|
| 1 | Add `min-h-[…]` to each of the 8 dashboard cards | 30 min | CLS −0.20 | `app/dashboard/page.tsx` and the card components it imports |
| 2 | Wrap each Recharts chart in a fixed-height div; drop `flex-grow` on chart parents | 1 h | CLS −0.10, eliminates Recharts warning, drops forced reflow | wherever `ResponsiveContainer` is used (3 places) |
| 3 | Trim `/api/v1/transactions?limit` from 200 to 10 (or new endpoint) | 1 h | API payload −200 KB, jank −1 staggered render | dashboard query call site + backend route |
| 4 | Trim `/api/v1/categories` payload | 1 h | API payload −60 KB | backend route |
| 5 | Aggregate dashboard APIs into `/api/v1/dashboard` *or* convert to Server Components with streamed Suspense | 1–2 days | Render delay −300 ms, removes staggered repaints | `app/dashboard/page.tsx` |
| 6 | Profile `/api/v1/portfolio/summary` (302 ms) | varies | Snappier card | backend |
| 7 | Bundle analyzer pass; deduplicate 324 KB chunks; lazy-load heavy widgets behind their cards | half day | JS parse −300 KB+ | `next.config.js` + dashboard imports |
| 8 | Verify Tailwind purge (118 KB CSS) | 30 min | CSS −60+ KB | `tailwind.config.js` `content` |

Do **1 and 2 first** — they are the highest impact for the smallest change. Re-measure CLS after each.

---

## Verification checklist

After each change, re-run a trace and confirm:

- [ ] CLS < 0.1
- [ ] LCP render delay < 400 ms
- [ ] No forced-reflow warning > 50 ms total
- [ ] No Recharts `width(-1)/height(-1)` warnings in console
- [ ] Dashboard payload total ≤ 150 KB decoded
- [ ] CSS bundle ≤ 60 KB

Use Chrome DevTools → Performance with `--throttling.cpuSlowdownMultiplier=4` (mobile) or run Lighthouse mobile to make sure the wins survive on slower devices.

---

## Raw data captured

- Performance trace: navigation reload of `/dashboard`, no throttling, ~5.3 s window. CLS=0.31, LCP=765 ms.
- Network log: 44 requests, all 200 OK, all `monize.ucdialplans.com` origin. transferSize 0 on cached resources (service worker).
- Console: 3× Recharts ResponsiveContainer width/height warning; 1× `[PriceRefresh] Skipping auto-refresh: outside market hours` (informational).
- DOM measurements (computed styles, bounding rects) confirm no card or chart has `min-height` reserved.
- Service worker is registered and controlling the page.
- Top JS chunks: three 324 KB vendor chunks plus a 233 KB chunk containing the forced-reflow function `O`.
- Largest API responses: `/transactions` 200 KB, `/categories` 84 KB, `/scheduled-transactions` 62 KB.
- Slowest API: `/portfolio/summary` 302 ms TTFB.
