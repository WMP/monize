# UI consistency findings (follow-up to kenlasko/monize#1912)

Status: work in progress. This file collects:

1. **Candidate rules** that the reference screens follow but `docs/frontend/screens-and-dialogs.md` does not state yet.
2. **Deviations**: screens that detract from the whole, because they break a rule from `screens-and-dialogs.md` or a candidate rule.

Each item names the evidence (`file:line`, relative to `frontend/src/`). Each item needs human review before it becomes a rule or a fix.

## The reference screens contradict the document

Before anyone fixes a screen "against" `screens-and-dialogs.md`, a maintainer must decide, rule by rule, whether the document or the reference code is correct. As written, several rules fail the screens the document names as the model (all verified in the source):

- **Segmented filter.** The document says `SEGMENTED_GROUP_CLASS` + `segmentClass`. No reference screen uses it: `app/currencies/page.tsx:315-337` and `app/securities/page.tsx:420-442` hand-roll `bg-blue-600` buttons (with counts); `components/accounts/AccountList.tsx:788-819` and `components/transactions/TransactionFilterPanel.tsx:511-545` hand-roll them without counts. Only newer screens use the constant (`AiReviewInbox`, `EmailReceiptsManager`, `InvestmentViewToggle`).
- **Table cells.** The document names `CurrencyList` and `SecurityList` as models "with `Th`/`Td`". Both use raw `<th onClick>` + `SortIcon` (`components/currencies/CurrencyList.tsx:610-616`, `components/securities/SecurityList.tsx:601-643`). The `<th onClick>` is also not reachable by keyboard.
- **Toolbar wraps.** Currencies and Securities use `flex flex-col sm:flex-row` without `flex-wrap` (`app/currencies/page.tsx:307`, `app/securities/page.tsx:412`).
- **Refresh.** Currencies "Refresh Rates" has no icon and no age (`app/currencies/page.tsx:281-287`). Securities puts Refresh in the toolbar row (`app/securities/page.tsx:446-452`), Investments in `PageHeader` (`app/investments/page.tsx:253`).
- **Transactions.** No `SummaryCard` row (a chart, `app/transactions/page.tsx:1304`); filters fold into a Show/Hide panel (`TransactionFilterPanel.tsx:249-290`), which the "filters are always visible" rule forbids; the search field has a label and comes last (`TransactionFilterPanel.tsx:764-771`).
- **Investments.** Three primary "New" buttons on one screen: `NewTransactionButton` in `PageHeader` (`app/investments/page.tsx:258`) and two hand-rolled `bg-blue-600` buttons (`components/investments/InvestmentTransactionList.tsx:608-614`, `app/investments/page.tsx:438`). Brokerage / Cash is a segmented control that switches registers, i.e. navigation (`InvestmentViewToggle.tsx:36-44`, key `brokerageTab`), which the document reserves for `Tabs`. Filters are behind toggles (`InvestmentTransactionList.tsx:618-646`).
- **Accounts.** No toolbar above the list; search comes last inside the list card (`AccountList.tsx:834-840`); no `Pagination`.
- **Export.** Currencies, Securities and Accounts have none. `ListTopToolbar` has no export control of its own (`components/ui/ListTopToolbar.tsx:40`); Transactions passes a button through `actions` (`TransactionList.tsx:750-754`). The rule "Export is the export control of `ListTopToolbar`" names a control that does not exist.
- **Security detail order** is header, `SummaryCard`s, a chart grid, then `Tabs` (`app/securities/[id]/page.tsx:444, 464, 509`), not "`SummaryCard` row, then `Tabs`".
- **`PageHeader` help** is shown only on hover at `md` and up (`components/layout/PageHeader.tsx`, `md:group-hover`), against the rule that help is not hidden below a breakpoint.

Suggestion: either fix the reference screens first (they are what agents copy), or narrow the document to what those screens do today and list the gaps as known debt.

## Candidate rules

### List and detail pages

- **R12. Page container: `<main className="px-4 sm:px-6 lg:px-12 pt-6 pb-8">` at full width** (`app/currencies/page.tsx:274`, `securities:392`, `transactions:1291`, `investments:232`); settings pages `max-w-4xl mx-auto`.
- **R13. Every list page passes `helpUrl` to `PageHeader`** (Currencies, Securities, Transactions, Investments, Accounts).
- **R14. The list sits in `${CARD_CLASS} overflow-hidden`, with `<LoadingSpinner text>` inside it while loading** (`currencies:368-370`, `securities:471-473`, `transactions:1709-1712`).
- **R15. `EmptyState` renders inside the list component** (`CurrencyList.tsx:549`, `AccountList.tsx:773`).
- **R16. Sort: a sortable header with `SortIcon` and `aria-sort`, persisted with `useLocalStorage('monize-<list>-sort-field' / '-sort-dir')`, and a sort, filter or search change resets to page 1** (`currencies:53-54, 242-260`). Status filters start at `'active'` (`currencies:51`, `securities:65`).
- **R17. Density: `useDensityPreference(view)` with `DensityToggleBar` above a table, or `DensityToggle` in `ListTopToolbar` for a register** (`CurrencyList.tsx:487, 566`).
- **R18. Phone layout: `wrapped = isMobile && density === 'normal'` renders one card cell per row with a slim sort header** (`CurrencyList.tsx:523, 571-600`, also Security, Account, Payee, Institution, Warranty lists); a register uses `useRegisterPhoneCard`.
- **R19. Number, rate and action columns are right-aligned; row actions are `RowActions`.**
- **R20. A list reloads after undo/redo and AI actions with `useOnUndoRedo(load)` + `useOnAiAction(load)`** (`currencies:115-117`, `securities:160-162`).
- **R21. Create/edit of a record is `useFormModal` + `Modal` + `UnsavedChangesDialog`** (`currencies:49, 341-353`); a deep link to a row uses `useHighlightParam` (`securities:373-381`).
- **R22. A column chooser (`useHiddenColumns` + `ColumnChooserMenu`) belongs to registers only** (TransactionList, InvestmentTransactionList, GroupedHoldingsList). State this, so lists do not gain one ad hoc.
- **R23. No interactive element inside `<a>`**: a back or cancel link is a `Link` styled with `buttonClassName(...)`, never `<Link><Button>`.
- **Open question O1. Count line under a list**: two patterns compete, a centred "N items" for one page (`currencies:403-407`, `securities:507-511`) and `ListBottomPager` `totalLabel` (`transactions:1761-1769`, warranties, investments). Pick one.
- **Open question O2. Summary grid gap** varies (`gap-6`, `gap-4 sm:gap-6`, `gap-3 sm:gap-6`, `gap-4`). Detail pages share `SummaryCardGrid` + `summaryGridClass` (`components/accounts/shared/SummaryCardGrid.tsx:72, 82`); make it the list-page summary row too.

### Reports, settings, states, destructive actions

- **R1. A report keeps its toolbar mounted while it reloads.** Loading, error and empty states render inside the chart card, below the toolbar, as in `components/reports/SpendingByCategoryReport.tsx:380-394` (its comment: focus in `DateInput` survives a reload). Nine reports do this; 38 return early with a skeleton card.
- **R2. A report error is `ReportError` with `useReportData().reload`** (49 files).
- **R3. A chart/table switch in a report is `ChartViewToggle`** (`SpendingByCategoryReport.tsx:352`, 10 reports).
- **R4. A report date range is `DateRangeSelector` with `showCustom`** (19 files, `SpendingByCategoryReport.tsx:340`). Open question: name a small set of standard `ranges` presets (today 12 different sets).
- **R5. Pie and donut charts use `ChartLegend`; other charts use the recharts default `<Legend />` at the bottom.** One font size for both.
- **R6. A settings section is one card with an `h2 text-lg font-semibold mb-4`; a sub-group heading is `h3 text-sm font-semibold mb-1`** (`components/settings/ProfileSection.tsx:113-114`, `BackupRestoreSection.tsx:345`). The danger zone is the red-bordered card, last on the page (`DangerZoneSection.tsx:166`).
- **R7. A button that saves shows progress with `<Button isLoading>`**, not a label ternary `isSaving ? t('saving') : t('save')` (31+ sites vs 5).
- **R8. A load error outside reports is `EmptyState` + `ExclamationTriangleIcon` + Retry `Button` inside `role="alert"`** (`components/rules/RuleEditor.tsx:35-60`). Open question: an inline error banner has no shared component; 33 files hand-roll it in at least 5 class strings.
- **R9. Loading: a route has `loading.tsx` with the `*Skeleton` components; a report uses `Skeleton`; a component uses `LoadingSpinner`.** Never plain "Loading..." text.
- **R10. Every delete or remove asks first with `ConfirmDialog`** (61 renders, no `window.confirm`). An irreversible account-level action (delete account, restore backup, disable 2FA) uses the inline typed/password confirm of `DangerZoneSection.tsx:181`.
- **R11. Feedback after a write is `react-hot-toast` (default import): `toast.success` on success, `toast.error(getErrorMessage(err, t('...Failed')))` on failure, plain `toast()` only for information.**


## Deviations

### List and detail pages

- **D15. Hand-rolled segmented filters**: `app/payees/page.tsx:407, 430`, `app/categories/page.tsx:231`, `app/institutions/page.tsx:281-314` (no counts), `app/reports/page.tsx:346-368` (pills, no counts), `components/dashboard/TopMovers.tsx:164`, `app/budgets/page.tsx:154`. `AiReviewInbox.tsx:174-197` uses the constant but has no counts.
- **D16. Hand-rolled tab bar** for List/Calendar on Bills (`app/bills/page.tsx:772-791`), which should be `ViewModeToggle`; the Bills type filter is chips hidden below `sm` (`:796-808`) and the filter panel collapses (`components/scheduled-transactions/BillsFilterPanel.tsx:78, 175`).
- **D17. `Tabs` used as a list filter, with counts**: `components/settings/bank-sync/BankSyncPreviewList.tsx:108-111, 221`.
- **D18. Records shown as a card grid, not a table**: `app/budgets/page.tsx:134-170` (a `div role="link" onClick`, not `useLongPress`).
- **D19. Hand-rolled empty states instead of `EmptyState`**: `app/categories/page.tsx:275-310`, `app/tags/page.tsx:235-260`, `app/budgets/page.tsx:121`.
- **D20. Primary action not in `PageHeader`**: Warranties puts "New" as a toolbar text button (`app/warranties/page.tsx:410-418`) and its filters are `Badge` buttons without counts, before the search (`:493-507`); Rules uses a `<Link>` styled as a button (`components/rules/RulesManager.tsx:48`); Dashboard "Customize" is a hand-rolled button (`app/dashboard/page.tsx:273-281`); Insights "Refresh" is a filled primary (`components/insights/InsightsList.tsx:237`).
- **D21. Raw `<select>` filters and pill counts instead of `SummaryCard`** on Insights (`InsightsList.tsx:215-220, 245, 257`); free-form `<dl>` summary on `components/admin/PushChannelsPanel.tsx:134` and `components/warranties/WarrantyDetailCard.tsx:214`.
- **D22. Search after the filters, with a label**: Email Receipts (`components/email-receipts/ReceiptSearchBar.tsx:36`, `EmailReceiptsManager.tsx:995`).
- **D23. Page container outliers**: `app/reminders/page.tsx:35` (`<div>`, not `<main>`, `max-w-5xl`), `app/insights/page.tsx:19` (`max-w-4xl`), `app/reports/custom/new/page.tsx:42` (`max-w-3xl`), `app/reports/investment/new/page.tsx:41`. Breaks R12.
- **D24. Missing `helpUrl`**: tags, institutions, warranties, rules, ai-reviews, email-receipts, insights, taxes, reminders, admin. Breaks R13.
- **D25. Detail pages without the chevron back pattern**: `app/budgets/[id]/page.tsx:261-269` ("Back to Budgets" is an outline button at the end of the actions, after Delete; no switcher, no `SummaryCard`s); `app/budgets/[id]/edit/page.tsx:141-148`; `app/taxes/payroll-deductions/page.tsx:147-153` (`ArrowLeftIcon`); `app/warranties/[id]/page.tsx` has no `EntitySwitcher`.
- **D26. `<Link><Button>` (a button inside a link)**: `app/reports/custom/new/page.tsx:47-48`, `custom/[id]/edit/page.tsx:111-112`, `investment/new/page.tsx:46-47`, `investment/[id]/edit/page.tsx:111`, `monte-carlo/compare/page.tsx:32-33`. Breaks R23 and is an accessibility defect.
- **D27. Tables without sort, density or phone layout**: `components/admin/UserManagementTable.tsx:80-101` (raw `<th>`, inside a `bg-gray-900` card at `app/admin/users/page.tsx:311`), `AiReviewInbox`, `EmailReceiptsManager`, `RulesList`; `CategoryList` and `TagList` lack `aria-sort` and the phone layout. Break R16-R18.
- **D28. `/rules` does not reload after undo/redo** (no `useOnUndoRedo`). Breaks R20.

### Reports, settings, states, destructive actions

- **D1. Toolbar unmounts on every reload (probable defect, not reproduced in a browser).** These reports hold their date controls and return early on `isLoading`, which `hooks/useReportData.ts:184` sets on every fetch: `components/reports/BillPaymentHistoryReport.tsx:317`, `CustomReportViewer.tsx:177`, `DuplicateTransactionReport.tsx:74`, `InvestmentReportViewer.tsx:260`, `UncategorizedTransactionsReport.tsx:283`, `WeekendVsWeekdayReport.tsx:191`. Breaks R1.
- **D2. Hand-rolled view switches instead of `ChartViewToggle` / `segmentClass`** (`bg-blue-600 text-white` buttons): `components/reports/RealizedGainsReport.tsx:499` (plain chart/table toggle), `DividendYieldGrowthReport.tsx:605`, `BillPaymentHistoryReport.tsx:388`, `DividendIncomeReport.tsx:1173`, `DebtPayoffTimelineReport.tsx:688`, `SecurityPerformanceReport.tsx:664`, `UpcomingBillsReport.tsx:404`, `WeekendVsWeekdayReport.tsx:265`, `GeographicAllocationReport.tsx:564`, `InvestmentPerformanceReport.tsx:474`, `BudgetVsActualReport.tsx:441` (a third style). Breaks R3.
- **D3. Report empty state is a plain `<p className="... text-center py-8">`** in 34 report files (39 hits, e.g. `SpendingByCategoryReport.tsx:392`), not `EmptyState`. The `ui-conventions.test.ts` guard bans only `py-12`, so `py-8` passes it.
- **D4. `ReportError` draws its own button** with `focus:ring` (`components/reports/ReportError.tsx:29`), not `Button` and not `focus-visible:`.
- **D5. Raw `DateInput` pairs instead of `DateRangeSelector`**: `CustomReportViewer.tsx:228`, `InvestmentReportViewer.tsx:334`, `account-balances/AccountBalancesControls.tsx:100`. Breaks R4.
- **D6. Chart card padding differs between reports**: `px-2 py-4 sm:p-6` (14), `p-3 sm:p-6` (7), `p-6` (3), `p-4 sm:p-6` (1). Legend font-size outliers: `NetWorthByAccountTypeChart.tsx:186`, `PortfolioValueReport.tsx:1576`.
- **D7. Settings sub-group heading outliers**: `components/settings/SecuritySection.tsx:294` (`text-base font-medium`), `:378`, `:463` (`h3 text-lg`), `DefaultViewsGroup.tsx:87`, `NotificationsSection.tsx:138`, `NotificationPreferencesMatrix.tsx:197`, `PushDevicesPanel.tsx:660`. Breaks R6.
- **D8. Settings sub-pages use a text link `&larr; Back` above `PageHeader`**, not the documented chevron "Back to <List>": `app/settings/ai/page.tsx:87-98`, `bank-sync/page.tsx:151`, `emergency-access/page.tsx:135`, `:560`, `shared-access/page.tsx:31`, `tours/page.tsx:29`.
- **D9. Settings page width differs between its states**: `app/settings/page.tsx:254` is `max-w-6xl`, its loading/delegate branches `:109`, `:121`, `:140` are `max-w-4xl`, `app/settings/loading.tsx` is `max-w-2xl`. The skeleton jumps width when the page loads.
- **D10. Save buttons with a label ternary instead of `isLoading`**: `ProfileSection.tsx:160`, `SecuritySection.tsx:285`, `AutoBackupSection.tsx:672`, `OffsiteDestinationsForm.tsx:449`, `components/budgets/BudgetForm.tsx:164-170`. Breaks R7.
- **D11. Full-page forms with a hand-rolled button row instead of `FormActions`**: `components/rules/RuleEditorBody.tsx:323-350`, `components/budgets/BudgetForm.tsx:164`, `app/settings/emergency-access/page.tsx:694`, `:814`, `:954`.
- **D12. Plain-text loading** instead of a spinner/skeleton: `SharedAccessSection.tsx:313`, `PayeeAliasManager.tsx:137`, `NotificationList.tsx:342`, `StoredBackupsSubsection.tsx:260`, `OffsiteDestinationsForm.tsx:208`, `BackupRestoreSection.tsx:419`, `AccountDetailShell.tsx:208`, `MonteCarloHoldingStatsTable.tsx:37`, `RecentTransactionsPopover.tsx:123`. Breaks R9.
- **D13. Delete with no confirmation** (verified): `components/settings/ai/ProviderList.tsx:226` calls `handleDelete` (`:90`) directly, which deletes the AI provider and shows a toast. Same in `settings/PushDevicesPanel.tsx:510` (`handleRemove`, `:282`). Breaks R10.
- **D14. Named toast import** in `settings/ai/ProviderConfigForm.tsx:6`, `settings/ai/ProviderTestButton.tsx:4`. Breaks R11 (cosmetic).

