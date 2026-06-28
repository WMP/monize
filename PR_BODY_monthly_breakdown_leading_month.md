## Summary

Fixes an inconsistency in the **Monthly Category Breakdown** report where the same calendar month showed **different figures depending on the selected range preset**. A categorized investment transfer (e.g. a monthly IKE top-up dated the 5th) was missing from the `2026-03` column under **3M** but present under **6M**.

## Root cause

The report is **month-columnar** — every column is a whole calendar month — but it passed the raw resolved start date straight to the API. Day-level presets resolve to a **mid-month** start:

- **3M** -> `subDays(now, 90)` -> from 2026-06-23 that is **2026-03-25**
- **6M** -> `subMonths(now, 6)` -> **2025-12-23** (covers all of March)

So under **3M** the query started on **March 25** and dropped the March 5 transfer, yet the `2026-03` column still rendered (because of late-March activity) — silently omitting early-month rows and disagreeing with the wider preset. `useDateRange` deliberately keeps `3m`/`1y` day-level (asserted by its tests, intended for charts), so the fix belongs in this report, which is the only month-grained report that did not already pass `alignment: 'month'`.

## Fix

Snap the resolved start **down to the first of its month** before querying, so every visible month column is fully covered and consistent across presets:

```ts
const reportStart = rangeStart ? `${rangeStart.slice(0, 7)}-01` : '';
```

- `reportStart` feeds the API call **and** the category/transfer drill-downs, so the transactions list opens over the same range the report actually covered.
- An empty start (`all`) stays empty.
- The end stays at "today"; the in-progress current month is still dropped by default via the existing `includeCurrentMonth` toggle.

After the fix, **3M** starts at `2026-03-01` and the IKE row shows `-1000 PLN` in `2026-03`, matching **6M**.

## Changes

**Frontend**
- `MonthlyCategoryBreakdownReport.tsx`: derive `reportStart` (month-snapped) and use it for the breakdown query and both drill-down navigations.

## Tests

- New: a mid-month resolved start (`2025-03-25`) is sent to the API as `2025-03-01`.
- New: the category drill-down navigates using the same month-snapped start.
- Existing breakdown component suite green (27 tests); ESLint + `tsc --noEmit` clean.

## Checklist

- [x] This PR addresses a **single concern** (consistent month columns in the monthly breakdown).
- [x] New behavior has tests, and the existing suite passes.
- [x] No user-facing strings added or changed (no i18n impact).
- [x] No shared/core areas refactored (`useDateRange` is intentionally left unchanged; the fix is local to the one month-grained report).
- [x] The branch is based on the latest `main`.
- [x] AI assistance is disclosed below, and I have reviewed and own the result.

## AI assistance disclosure

Implemented with Claude Code; design and approach reviewed and owned by me.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
