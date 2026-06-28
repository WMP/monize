## Summary

Lets a **scheduled (recurring) transfer carry an optional spending category**, mirroring what #743 added for one-off transfers. Until now the New Schedule / Bills transfer tab had no category field, and the backend silently dropped any category on a transfer schedule — so a recurring investment contribution (e.g. a monthly IKE/IKZE top-up modelled as a transfer) could not be categorized and never showed up in the monthly category breakdown.

This is a follow-on to #743 (which made the underlying transfer + report support a category); the data model already had everything, the scheduled-transaction layer just stripped it.

## The gap (category was dropped in three places)

1. **Backend create** — forced `categoryId: null` whenever `isTransfer`.
2. **Backend update** — nulled `categoryId` when switching to / saving a transfer.
3. **Backend posting** — `createTransfer(...)` was called without `categoryId`, so even a stored category wouldn't reach the materialized transfer.
4. **Frontend form** — the category field rendered only in `transaction` mode; switching to `transfer` cleared it and submit forced `categoryId: undefined`.

## Changes

**Backend** (`scheduled-transactions.service.ts`)
- `create`: only splits/investments null the category; a transfer keeps `categoryId`.
- `update`: stop force-nulling `categoryId` when `isTransfer` (it's controlled by the DTO, like every other field).
- `post`: pass the effective category to `createTransfer` — same precedence as the non-transfer branch (inline override → stored occurrence override → the schedule's own category). `createTransfer` (from #743) validates ownership and stores it on **both legs**. This also covers the auto-post cron, which shares the post path.

**Frontend** (`ScheduledTransactionForm.tsx`)
- An optional "Category (Optional)" combobox in the transfer tab, with a short note that it surfaces the transfer in the monthly breakdown without counting as income/expense.
- Stop clearing the category on switch to transfer mode; submit the selected category for transfers.
- `handleCategoryChange` no longer flips the amount sign in transfer mode (a transfer amount is a positive magnitude negated on submit; the category is just a label there).

## Why no migration

`scheduled_transactions.category_id` already exists (nullable, `ON DELETE SET NULL`). The restriction was purely application-level. Additive, **no schema change**.

## Out of scope

Per-occurrence **overrides** setting a transfer category (the override editor) — left for a follow-up; this PR covers the schedule itself and its posting.

## Tests

- Backend: a transfer keeps its category on create and update; switching to transfer no longer nulls it; posting forwards the schedule's category to `createTransfer`. (`scheduled-transactions` Jest suite green — 142.)
- Frontend: the optional category field renders in transfer mode; editing an existing categorized transfer submits with the category. (`ScheduledTransactionForm` suite green — 140.)
- ESLint + `tsc --noEmit` clean both layers; pseudo-locale regenerated (`i18n:check` passes).

## Checklist

- [x] Single concern (category on scheduled transfers), a direct follow-on to #743.
- [x] New behavior has tests, and the existing suite passes.
- [x] All user-facing strings translated for **every** locale — the 2 new keys (`scheduledTransactions.form.transferCategoryLabel`, `…transferCategoryNote`) are translated across all locales; `en-*` stay lean and inherit from `en`; pseudo (`xx`) regenerated. Parity test green (980).
- [x] No shared/core refactor beyond reusing #743's `createTransfer(categoryId)`.
- [x] The branch is based on the latest `main`.
- [x] AI assistance is disclosed below, and I have reviewed and own the result.

## AI assistance disclosure

Implemented with Claude Code; design and approach reviewed and owned by me.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
