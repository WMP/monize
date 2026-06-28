## Follow-up changes

These commits sit on top of the original feature commit (a transfer can carry a spending category and surface in the monthly category breakdown). They address @kenlasko's review and a couple of UX/i18n gaps found while testing.

### `ebf81325` — keep the transfer amount positive when a category is set
Selecting an *expense* category on a transfer flipped the amount negative (the normal-mode income/expense sign rule), which then failed the "amount must be positive" check, so the transfer could not be saved.

A transfer's amount is always entered as a positive number — the legs' signs are derived on save — so the category-driven sign adjustment must not run in transfer mode. `handleCategoryChange` is now guarded with `mode === 'normal'`, mirroring the guard already present in `handleAmountChange`. Per @kenlasko's review.

Adds a regression test (expense category on a transfer keeps the amount positive).

### `73b3625a` — show the assigned category on a categorized transfer row
The transactions list rendered only the linked-account arrow chip in the Category column for a transfer, completely hiding any spending category assigned to it. For a transfer that carries a category, the row now shows the **category chip alongside the transfer arrow** (e.g. `[Investments] [→ BOŚ IKE - Cash]`); the category chip is clickable to filter, like a normal category chip. Adds a test.

### `b66a876d` — full localization
Translated the two new feature strings (`transactions.form.fields.categoryOptional`, `transactions.form.transferCategoryNote`) for every full locale; the regional `en-*` variants inherit from `en`. Frontend message parity is green.

### `d94c0a07` — document the two-leg drill-down behavior (no behavior change)
The category is stored on **both legs** of the transfer, so the monthly-breakdown aggregate counts only the outflow leg (one net line, e.g. `-1000`), while a category-scoped transaction view (a report drill-down, or the transactions list filtered by that category) lists **both legs** (`-1000` and `+1000`) which visibly net to zero. This is expected, not a double-count — the net contribution lives in the aggregate. Documented inline in the breakdown query so it isn't mistaken for a bug.

### Out of scope / unchanged (intentional)
- The monthly-breakdown aggregate is correct as-is; no report behavior was changed.
- `excludeFromNetWorth` stays net-worth-only (it does not affect any report) — not repurposed.
- Category reports still exclude `INVESTMENT` accounts. A known, untouched inconsistency: the transfer rollup in the monthly breakdown does not filter investment / `excludeFromNetWorth` accounts — separate concern.

### Tests
Frontend suites (TransactionForm, TransferTransactionFields, TransactionRow) green; backend monthly-category-breakdown green; type-check clean; i18n message parity green.
