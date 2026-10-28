# UI consistency findings (follow-up to kenlasko/monize#1912)

Status: work in progress. This file collects:

1. **Candidate rules** that the reference screens follow but `docs/frontend/screens-and-dialogs.md` does not state yet.
2. **Deviations**: screens that detract from the whole, because they break a rule from `screens-and-dialogs.md` or a candidate rule.

Each item names the evidence (`file:line`, relative to `frontend/src/`). Each item needs human review before it becomes a rule or a fix.

## Candidate rules

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

