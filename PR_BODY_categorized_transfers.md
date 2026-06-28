## Linked discussion / issue

Closes #740 (labeled `approved-to-build`).

## Summary

Lets an account-to-account **transfer optionally carry a spending category**, and surfaces such categorized transfers in the `monthly-category-breakdown` report — so recurring investment contributions (e.g. monthly IKE/IKZE top-ups) show up as a monthly "Investments" line **without** being counted as expenses/income or affecting net worth.

### Behavior

- A transfer can be assigned a category (web transfer form, optional field). The category is stored on both legs.
- In the monthly category breakdown, a categorized transfer is counted **once** — its outflow leg (`amount < 0`) — under its category, as a withdrawal. The inflow leg never double-counts (it is on the destination account and is excluded both by `amount < 0` and the existing `account_type != 'INVESTMENT'` filter). Categorized transfers are removed from the report's separate transfer rollup so the same movement is not shown twice.
- Every **other** report (spending-by-category, income, comparison, tax, anomaly, data-quality, …) still filters `is_transfer = false`, so a categorized transfer is **never** treated as income/expense. Net worth is unaffected (it is the sum of account balances; categories don't enter it).
- Inclusion is **always on** (no toggle): in practice this is backward compatible because no transfer carried a category before this change, so existing reports are unchanged until a user opts a transfer in by setting one.

### Why no migration

`transactions.category_id` already exists (nullable, `ON DELETE SET NULL`) with no constraint tying it to non-transfers — the old restriction was purely application-level (the transfer DTOs didn't accept a category and the service never set one). So this is additive with **no schema change**.

## Changes

**Backend**
- `create-transfer.dto.ts` / `update-transfer.dto.ts`: optional `categoryId` (`@IsUUID`; update accepts `null` to clear).
- `transaction-transfer.service.ts`: validate the category belongs to the user (mirrors `transactions.service.create()`), store it on both legs on create, set/clear on update.
- `monthly-category-breakdown.service.ts`: category query also includes the outflow leg of categorized transfers; transfer-rollup query excludes categorized transfers to avoid double-counting.

**Frontend**
- Optional "Category (Optional)" combobox in the transfer form (`TransferTransactionFields`), with an explanatory note; wired through `TransactionForm` and the transfer API type.

## Out of scope (separate "Related gaps" from the issue)

Creating transfers via MCP (`create_transaction` has no destination field) and a `create_account` tool — those are independent and tracked separately. This PR sets the category from the web UI; the shared breakdown read inherits the new behavior automatically (no tool-signature change).

## Tests

- Transfer service: category stored on both legs (create), set/cleared (update), validated (rejects an unowned category), and not required.
- Breakdown service: category query includes the categorized-transfer outflow leg; transfer rollup excludes categorized transfers.
- Frontend: the optional category field + note render in transfer mode.
- Backend `transactions` + `built-in-reports` suites green (973); frontend transfer/transaction form tests green.

## Checklist

- [x] An approved discussion or issue exists and is linked above (#740, `approved-to-build`).
- [x] This PR addresses a **single concern** (categorized transfers in the monthly breakdown).
- [x] New behavior has tests, and the existing suite passes.
- [ ] All user-facing strings are translated for **every** locale — English (`en`) + pseudo (`xx`) done; the full localization pass is deferred to acceptance per the repo's English-first workflow. (2 new keys: `transactions.form.fields.categoryOptional`, `transactions.form.transferCategoryNote`.)
- [x] No shared/core areas were refactored without prior agreement (additive DTO field, additive report SQL; no signature changes to shared tools).
- [x] The branch is rebased on the latest `main`.
- [x] AI assistance is disclosed below, and I have reviewed and own the result.

## AI assistance disclosure

Implemented with Claude Code; design and approach reviewed and owned by me.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
