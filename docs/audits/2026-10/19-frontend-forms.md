# S19 Frontend Forms Round Trip

## 1. Metadata

| Field | Value |
| --- | --- |
| Session | S19 (child session_01LuCrA2Ko2LmWJpCCVZtqu1), parallel wave with S17 and S18; the S18 dependency waived by the orchestrator |
| `AUDIT_BASELINE_SHA` | `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86` |
| `git rev-parse HEAD` at start | `a57bd40` (docs-only commits on top of the baseline) |
| Pin check | `git diff --stat 72c59ec4 HEAD -- . ':!docs/audits/2026-10' ':!docs/audits/2026-08-upstream'`: empty |
| Date | 2026-10-21 |
| Primary path | `frontend/src/components/transactions/` |
| Secondary paths | `components/accounts/`, `components/scheduled-transactions/`, `components/investments/`, `components/import/`, `components/settings/` (backup, danger zone), `components/rules/`, `components/ui/` (`CurrencyInput`, `NumericInput`, `DateInput`), `components/auth/OnboardingPreferences.tsx`, the request DTOs and the backend write paths they reach |
| Hint line | `trace the protocol's browser round trip for every form that influences money, authorization or identity: persisted value to rendered control to blur to serializer to DTO; prioritize an unchanged value re-emitted as a change, empty input becoming zero, a stored override price replaced by a live quote on open, two-decimal editing of four-decimal data and the one-cent tolerance, hidden fields still serialized, the reauthentication artifact sent on destructive actions, and the one date input and one money formatter` |
| Runtime | Node 24.22.1 (`nvm use 24`), `npm ci` OK in `frontend/` and `backend/`. Baseline component suites over the slice: **157 files, 4025 tests, all passed**. Scratch worktree at the baseline (`<scratchpad>/wt`): five component probes (P1-P5) inside copies of `TransactionForm.test.tsx` and `InvestmentTransactionForm.test.tsx` plus one `CurrencyInput` probe; two backend integration probe specs (3 cases) against PostgreSQL 16 (`mirror.gcr.io/library/postgres:16-alpine`, `dockerd` started by hand), run serially with `--runInBand`; 11 mutations (section 6). Playwright not run (section 12). |

## 2. Invariant map

| ID | Statement | Mechanism | Round trip traced | Holds? |
| --- | --- | --- | --- | --- |
| INV-OCCURRENCE-002 | A stored override price survives reopening | `OverrideEditorDialog.tsx:419-431`: the market fill runs only when `!hasStoredPrice && !userEditedTotal && investmentPrice === ''`; otherwise "use latest close" is an explicit action (`:688-707`) | stored override `investmentPrice` -> `initialPrice` (`:281-296`) -> `NumericInput` (6dp) -> `handleSave` `investmentPrice: Number(...)` (`:538-539`) -> `updateOverride` | Yes (MON-H15 fixed; mutation M1b caught by 6 tests) |
| INV-OCCURRENCE-003 (client) | Every surface reads the effective occurrence | `lib/scheduled-effective-amount.ts`, `scheduled-effective-amount.guard.test.ts` (Post dialog deliberately allowed, `:54-63`) | Post dialog: `nextOverride?.amount ?? amount` (`PostTransactionDialog.tsx:433`) -> `amount` in the `post()` body (`:742-766`) | Holds for plain schedules; loan bills are A26-S15-09; the dialog and the row menu send no occurrence identity (A26-S08-01 client half) |
| INV-TRANSFER-001 / FIN-001 (client) | A transfer form never sends a figure the user did not state; a reopened transfer saved unedited moves nothing | `resolveTransferFxForUpdate` compares values, not presence (`transaction-transfer.service.ts:443-455`) | persisted legs -> `TransactionForm` defaults (`:246-285`, `:329-348`) -> `TransferTransactionFields` (`:224-250`) -> `transferData` (`:1256-1277`) -> `updateTransfer` -> `newAmount = updateDto.amount` (`:1796`) | **No** when the transfer is opened from its receiving leg and the currencies differ (A26-S19-01, executed end to end) |
| (no double booking) | Saving an edit writes the edited row, not a second one | none on the client: `performSubmit` transfer branch (`TransactionForm.tsx:1279-1293`) | existing income/expense -> mode switch to Transfer (`:495-517`, offered at `:1521`) -> `createTransfer` | **No** (A26-S19-02, executed) |
| (precision round trip, MON-M37) | An unchanged amount is re-sent at the precision it is stored with | `CurrencyInput.notifyIfChanged` (`:190-193`) compares the parsed 2dp text with the held value | stored `decimal(20,4)` -> `Math.round(x*100)/100` on load (`TransactionForm.tsx:341-343`, `AccountForm.tsx:411-415`, `OverrideEditorDialog.tsx:203,223`, `ScheduledTransactionForm.tsx:271-273`) -> `CurrencyInput` 2dp display -> blur -> `roundToCents` (`:118-124`) -> DTO -> server `roundMoney` / exact split sum (`split-amount.util.ts:43-54`) | **No** (A26-S19-03, executed) |
| INV-FX-001 (client half) | A rate for a date is the newest observation on or before it | server: `resolveCashExchangeRateOrNull` prefers a dated rate (`investment-transactions.service.ts:778-792`) but honours a supplied one first (`:772-774`) | `useExchangeRates().getRate(from, to)` (undated) -> `exchangeRate` field (`InvestmentTransactionForm.tsx:613-664`; `InvestmentSplitFields.tsx:118-140`) -> payload `exchangeRate` (`:1192-1195`) -> stored as the trade's rate | **No** for a back-dated trade (A26-S19-04, executed) |
| INV-AUTH-003 (client half) | A destructive OIDC action sends a real reauth artifact | `takeOidcReauthArtifact(purpose, '/settings')`, redirect when absent (`DangerZoneSection.tsx:78-89`, `:132-141`; `BackupRestoreSection.tsx` imports the same helper) | no artifact -> redirect, nothing sent; a password account sends the typed password | Yes (mutations M10, M10b caught) |
| INV-DISPLAY-001 | A figure addressed to a person is in the reader's number locale | `useNumberFormat()`; `number-locale.guard.test.ts` scans for `toFixed` beside `%`, `toLocaleString()` and the raw helpers | `InvestmentTransactionForm.tsx:1513-1550, 1606, 1611, 1783`; `LoanPaymentSetupDialog.tsx:467, 472` render `toFixed` | **No** on nine form readouts (A26-S19-07); the index status `enforced` overstates it |
| (date entry) | One date input; a programmatic date change moves the visible box | `DateInput`, `ui-conventions.test.ts` | every `setValue('<x>Date', ...)` in `components/` is an `onDateChange` handler of a `DateInput` (15 sites) | Yes |
| (unknown vs zero) | A stored zero loads as zero | none | `AccountForm.tsx:427` `interestRate: account.interestRate \|\| undefined` -> required-field refinement `:225, :233` | **No** for a 0 % loan (A26-S19-06) |

`producer -> transformations -> storage -> consumers` for the two material money paths:

- Transfer edit: `transactions` row pair (from leg negative, to leg positive, rate on the to leg) -> `GET` with `linkedTransaction` -> `TransactionForm` takes `amount` from the leg it was opened on and `transferTargetAmount` from the to leg -> `PUT /transactions/:id/transfer` -> `updateTransfer` derives from/to by sign (`:1756-1758`) and compares `updateDto.amount` with the FROM leg -> `resolveTransferFx` implied rate `toAmount / amount` (`:318`) -> both legs and both balances -> net worth, reports, AI/MCP.
- Investment trade: `useExchangeRates` latest table -> form field -> `createTransaction` / embedded split `investment.exchangeRate` -> `resolveCashExchangeRate` keeps it -> cash leg `total * rate`, `investment_transactions.exchange_rate` -> cost basis in the cash currency, realized gains, every report.

## 3. Lens ledger

| Lens | Status |
| --- | --- |
| Pin the revision | ran (section 1) |
| Instructions before implementation | ran: `AGENTS.md`, root, `frontend/`, `backend/` `CLAUDE.md`, `docs/frontend/forms-and-formatting.md`, `docs/frontend/financial-figures.md:55-57`, `docs/backend/transactions-and-money.md:23`, the INV-OCCURRENCE-002/003, INV-AUTH-003, INV-DISPLAY-001 and INV-FX-001 entries |
| Summaries as hypotheses | ran: S02's MON-H15/M40 FIXED_VERIFIED re-executed (M1a, M1b); the S06, S07, S08, S09, S10, S12, S13, S14 and S15 hand-offs each traced (sections 5, 12) |
| Invariant model | ran (section 2) |
| Change surface (producers/consumers) | ran: every `transactionsApi.update(` caller (one, `TransactionForm.tsx:1369`); every `scheduledTransactionsApi.post(` / `skip(` caller (two files); every `setValue('<x>Date'`; every `getRate(` use in a form; the four-decimal loaders listed in section 2 |
| Rule 4 (read-model migration) | ran: `nextOverride?.amount ?? amount` survives only on the Post dialog write path, allowed by `scheduled-effective-amount.guard.test.ts:54-63`; its loan-bill consequence is A26-S15-09 |
| Rule 5 (dependency mutation matrix) | ran for the investment rate: the form's rate depends on the pair and on the latest-rate table, not on the trade date, so a date edit never re-resolves it (A26-S19-04) |
| Cross-layer verification | ran for A26-S19-01 (component payload -> real `updateTransfer` on PostgreSQL), A26-S19-03 (component payload -> real `update` and split validator) and A26-S19-04 (payload -> `resolveCashExchangeRateOrNull`, by reading) |
| Representation boundary | ran: 4dp vs 2dp (A26-S19-03), stored 0 vs empty (A26-S19-06), `''` / `undefined` / `0` for prices (`Number(data.price) \|\| 0` for a transfer cost, A26-S19-05), rate `1` meaning "same currency" (`InvestmentTransactionForm.tsx:625-631`) and `0` meaning unresolved (`:653-655`) |
| Browser/UI round trip | ran, primary lens: component-level round trips with the serialized payload asserted (P1-P5); Playwright not run (section 12) |
| Server-authoritative metadata | ran: transfer currency codes derived server-side (`assertTransactionCurrencyMatchesAccount`); the client-sent investment rate is kept (A26-S19-04); the transfer `costPerShare` is overridden server-side (A26-S19-05) |
| Identity versus value | ran: a transfer's legs are identified by sign on both layers, so the leg the form was opened on decides which amount is shown as the source (A26-S19-01); split rows carry `sourceSplitId` only on scheduled surfaces (`SplitEditor.tsx:1121-1138`); the Post dialog sends no occurrence identity (A26-S08-01) |
| State machine | ran for the form modes (normal / split / transfer): transfer -> other is locked for an existing transfer (`:1521`, mutation M7 caught); normal/split -> transfer on an existing row is open and double-books (A26-S19-02) |
| Concurrency and idempotency | not applicable as a primary lens: no form in the slice holds a lock; the stale-dialog post is A26-S08-01 (server, S08) and the stale-template echo is S15's; double submit is guarded by `isLoading` on every form read |
| Partial failure / compensation | ran for the MNY wizard's failed-after-commit state (A26-S09-01 client half, section 5) and the restore result counters (section 5) |
| External provider lookup | ran: the override editor makes one price request per open (`OverrideEditorDialog.tsx:326-359`); the investment form reads the cached latest-rate table and makes no dated request (A26-S19-04) |
| Database and migration | not applicable: the slice is frontend; no schema read beyond the `decimal(20,4)` / `NUMERIC(20,10)` precision |
| Backup/restore | ran narrowly: the restore result's five not-done counters render outside `restored` (`BackupRestoreSection.tsx:733-810`, covered by `BackupRestoreSection.test.tsx:553-607`); restore and delete send the OIDC artifact |
| Financial | ran: numerical examples in A26-S19-01 to -04 |
| Authorization / reauthentication | ran: `DangerZoneSection` (mutations M10, M10b); the joint-account payee refusal in `TransactionForm.tsx:1222-1231` read |
| Tests as evidence | ran: 157 green files, none failing on A26-S19-01 to -04; `InvestmentTransactionForm.test.tsx:1329-1357` asserts the undated latest rate (section 10) |
| Mutation | ran: 11 mutations (section 6) |
| Counterexamples, interaction | ran (section 7) |
| Rejected hypotheses | section 8 |
| Adversarial approval challenge | section 13 |

## 4. Confirmed findings

### A26-S19-01 - A cross-currency transfer opened from its receiving leg loads the received amount into the source-amount field, and an unedited save re-prices the transfer

1. **Severity:** HIGH
2. **Confidence:** high (executed: component probe P1 and a backend integration probe on PostgreSQL)
3. **Location:** `frontend/src/components/transactions/TransactionForm.tsx:341-343` (`amount` defaults to `Math.abs(initSource.amount)` whatever leg `initSource` is), `:277-285` (`transferTargetAmount` correctly taken from the to leg), `:1256-1277` (payload), `:103-116` (`reconciledEditAffectsReconciliation` mirrors the same normalization); `TransferTransactionFields.tsx:224-232` (the field is labelled with the FROM currency); backend `transaction-transfer.service.ts:1756-1819` (`newAmount = updateDto.amount`, compared with the FROM leg), `:290-333` (implied rate from a supplied `toAmount`). Secondary: the duplicate path (`duplicateFrom` uses the same defaults, `:329-343`) and the cross-owner edit (`:2098-2108`, same payload).
4. **Violated invariant:** reopening a transfer and saving it without editing its figures moves no money (AGENTS.md "A change is a value difference, not a field being present"; `docs/financial-semantics.md` transfer legs; the client half of MON-H11).
5. **Reproduction:** a USD account (balance 1,000.00) sends 100.00 USD to a CAD account, received 135.00 CAD (rate 1.35). The user opens the transfer from the CAD account's register (the clicked row is the positive CAD leg), changes only the description and clicks Update Transfer.
6. **Observed (executed):** the form shows "Transfer amount (USD) 135.00" and "Amount received (CAD) 135.00" (P1 inputs); the payload is `{ fromAccountId: <USD>, toAccountId: <CAD>, amount: 135, toAmount: 135, ... }`. On PostgreSQL the same payload through `TransactionsService.updateTransfer` on the CAD leg gives: before `usdBal 900, fromLeg -100, toLeg 135, rate 1.35`; after `usdBal 865, fromLeg -135, toLeg 135, rate 1`.
7. **Expected:** the source field shows 100.00 USD, the payload carries `amount: 100`, nothing is re-priced; the USD balance stays 900.00.
8. **Impact:** every cross-currency transfer edited (or duplicated) from its receiving account: the source account is debited by the received amount, the stored rate becomes 1 (a 1:1 cross-currency transfer, the shape INV-FX-001 forbids), net worth and every report move by the difference. Numerical: inputs 100.00 USD -> 135.00 CAD; result -135.00 USD; expected -100.00 USD; absolute difference 35.00 USD (35 % of the transfer). A reconciled USD leg is altered with no confirmation, because `reconciledEditAffectsReconciliation` compares the opened leg's own amount (135 against 135) and sees no change.
9. **Root cause:** the form normalizes "the transfer amount" from whichever leg it was given instead of from the FROM leg it treats as the source everywhere else (`getTransferAccounts` already picks the FROM leg's account, `:248-267`); the server cannot tell this false signal from a real edit, because the field is legitimately the source amount.
10. **Recommended correction:** take the source amount from the FROM (negative) leg in the defaults and in the reconciled-edit comparison; add a regression test opening the receiving leg of a cross-currency transfer.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/frontend/src/components/transactions/TransactionForm.tsx
+++ b/frontend/src/components/transactions/TransactionForm.tsx
@@ -100,13 +100,26 @@
  * precision the form loads them with, so float drift never triggers a warning.
  */
+/**
+ * The amount a transfer form shows as "Transfer amount": the FROM (negative)
+ * leg's, whichever leg the form was opened on. The receiving leg holds the
+ * amount in the destination currency.
+ */
+function transferSourceAmount(source: Transaction): number {
+  const linked = source.linkedTransaction;
+  const fromLeg =
+    Number(source.amount) >= 0 && linked ? linked : source;
+  return Math.abs(Number(fromLeg.amount));
+}
+
 function reconciledEditAffectsReconciliation(
   original: Transaction,
   data: TransactionFormData,
 ): boolean {
   const dateChanged = data.transactionDate !== original.transactionDate;
   const originalAmount = original.isTransfer
-    ? Math.abs(Math.round(Number(original.amount) * 100) / 100)
+    ? Math.round(transferSourceAmount(original) * 100) / 100
     : Math.round(Number(original.amount) * 100) / 100;
@@ -339,7 +352,7 @@
           categoryId: initSource.categoryId || '',
           // For transfers, always show absolute amount
           amount: initSource.isTransfer
-            ? Math.abs(Math.round(Number(initSource.amount) * 100) / 100)
+            ? Math.round(transferSourceAmount(initSource) * 100) / 100
             : Math.round(Number(initSource.amount) * 100) / 100,
```

12. **Recommended regression test:** open the CAD (receiving) leg of a USD 100 -> CAD 135 transfer, save unedited, assert `amount: 100` and `toAmount: 135`; the same for `duplicateFrom`; a reconciled receiving leg whose source amount is edited raises the confirmation.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
--- a/frontend/src/components/transactions/TransactionForm.test.tsx
+++ b/frontend/src/components/transactions/TransactionForm.test.tsx
@@ -3152,6 +3152,30 @@
     });
+
+    it('sends the source amount when a cross-currency transfer is opened from its receiving leg', async () => {
+      const incoming = createExistingTransaction({
+        accountId: 'acc-1', amount: 135, currencyCode: 'CAD', isTransfer: true,
+        linkedTransactionId: 'linked-usd',
+        linkedTransaction: {
+          ...createExistingTransaction({ id: 'linked-usd', accountId: 'acc-3', amount: -100, currencyCode: 'USD', isTransfer: true }),
+          account: { id: 'acc-3', name: 'USD Account' },
+        },
+        payeeId: null, payeeName: null, categoryId: null, category: null,
+      });
+      render(<TransactionForm transaction={incoming} onSuccess={mockOnSuccess} onCancel={mockOnCancel} />);
+      await waitFor(() => expect(screen.getByText('From Account')).toBeInTheDocument());
+      fireEvent.click(screen.getByRole('button', { name: /Update Transfer/i }));
+      await waitFor(() => expect(mockUpdateTransfer).toHaveBeenCalled());
+      expect(mockUpdateTransfer.mock.calls[0][1]).toEqual(
+        expect.objectContaining({ fromAccountId: 'acc-3', toAccountId: 'acc-1', amount: 100, toAmount: 135 }),
+      );
+    });
```

14. **Verification method:** the test above fails at the baseline (P1 observed `amount: 135`) and passes with the fix; re-run the backend probe with the corrected payload and assert the balances unchanged (`usdBal 900`, rate 1.35); lint and type-check in `frontend/`.
15. **Residual risks:** a transfer whose counterpart is masked (cross-owner, hidden account) may carry no usable `linkedTransaction.amount`; the form already locks the money fields there (`counterpartLocked`, `TransferTransactionFields.tsx:151-154`), but the default has to be checked against that payload shape. The server cannot detect the false signal; a defence in depth (refusing an update whose `amount` equals the opened receiving leg while differing from the FROM leg) would be a heuristic, not a fix. Causality: `PRE_EXISTING_UNREPORTED` (the lines sit at the shallow-clone boundary commit `3c1b2ff`, so their age cannot be dated; the upstream report's P6-002 does not describe the receiving leg). It is the client half of MON-H11, `CONFIRMED_WITH_DIFFERENT_ROOT_CAUSE`. Invariants: INV-TRANSFER-001 (client), FIN-001, INV-FX-001 (a 1:1 cross-currency rate is written).

### A26-S19-02 - Switching an existing income, expense or split to Transfer mode creates a second, new transfer and leaves the original row in place

1. **Severity:** HIGH
2. **Confidence:** high (executed: component probe P5; the server half is the ordinary `createTransfer`, covered by `transfers.integration.spec.ts` "should create linked transactions and update both balances")
3. **Location:** `frontend/src/components/transactions/TransactionForm.tsx:1520-1567` (the mode selector is offered on any edit except an existing transfer), `:495-517` (`handleModeChange`), `:1279-1293` (`transaction?.isTransfer` false -> `createTransfer`; the edited row is never updated or deleted). The domain already has an in-place conversion, used only by rules: `backend/src/transactions/convert-to-transfer.ts:53-60`.
4. **Violated invariant:** saving an edit writes the edited row; one user action has at most one financial effect.
5. **Reproduction:** an imported expense of -50.00 CAD on Chequing (balance 1,000.00 before it, 950.00 after) was really a move to Savings. The user opens it, clicks Transfer, picks Savings and clicks the button labelled "Update Transfer".
6. **Observed (executed, P5):** submit label "Update Transfer"; `createTransfer` called once with `{ fromAccountId: 'acc-1', toAccountId: 'acc-2', amount: 50, categoryId: 'cat-1', ... }`; `update` and `updateTransfer` not called; the toast says the transfer was created.
7. **Expected:** the expense becomes the FROM leg of a transfer (Chequing stays at 950.00, Savings +50.00), or the form refuses the conversion.
8. **Impact:** Chequing 900.00 instead of 950.00 (difference -50.00, 100 % of the converted amount), Savings +50.00, and the expense still counts in the category reports and budgets; the button said "Update". Converting a miscategorized bank row to a transfer is a common clean-up after an import, and the duplicate stays until noticed.
9. **Root cause:** the transfer branch of `performSubmit` decides create versus update from `transaction?.isTransfer` instead of from "is there a row being edited", and no conversion endpoint is exposed to the form.
10. **Recommended correction:** until a conversion route exists, do not offer Transfer mode when editing an existing non-transfer row and refuse it in `performSubmit`; the full fix exposes `convertToTransfer` (`convert-to-transfer.ts`) behind a route the form calls, inside one transaction with the row lock. Maintainer decision: which of the two.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/frontend/src/components/transactions/TransactionForm.tsx
+++ b/frontend/src/components/transactions/TransactionForm.tsx
@@ -1235,6 +1235,14 @@
       if (mode === 'transfer') {
+        // An existing income, expense or split cannot become a transfer from
+        // here: creating one would leave the original row in place and book
+        // the money twice.
+        if (transaction && !transaction.isTransfer) {
+          toast.error(t('form.toasts.convertToTransferUnsupported'));
+          setIsLoading(false);
+          return;
+        }
         if (!transferToAccountId) {
@@ -1553,7 +1561,7 @@
           </button>
-          <button
+          {!transaction && <button
             type="button"
             onClick={() => handleModeChange('transfer')}
@@ -1565,6 +1573,6 @@
             {t('form.modeTransfer')}
-          </button>
+          </button>}
         </div>
```

(the new key goes into `en/transactions.json` and the pseudo-locale).

12. **Recommended regression test:** open an existing expense, assert there is no Transfer mode button; a forced transfer-mode submit calls neither `createTransfer` nor `update`.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
--- a/frontend/src/components/transactions/TransactionForm.test.tsx
+++ b/frontend/src/components/transactions/TransactionForm.test.tsx
@@ -2615,6 +2615,16 @@
+    it('does not offer Transfer mode when editing an existing expense', async () => {
+      const tx = createExistingTransaction({ amount: -50, accountId: 'acc-1' });
+      render(<TransactionForm transaction={tx} onSuccess={mockOnSuccess} onCancel={mockOnCancel} />);
+      await waitFor(() => expect(screen.getByRole('button', { name: /^Transaction$/ })).toBeInTheDocument());
+      expect(screen.queryByRole('button', { name: /^Transfer$/ })).not.toBeInTheDocument();
+      expect(mockCreateTransfer).not.toHaveBeenCalled();
+    });
```

14. **Verification method:** the test fails at the baseline (P5: the button exists and `createTransfer` is called) and passes with the diff; the existing "switches from normal to transfer and back to normal" test (`:1060`) runs in create mode and must stay green.
15. **Residual risks:** the guard closes the double booking but removes a workflow users may rely on; the conversion route is the real remedy and needs its own spec (category clearing, reconciled state, tags, splits). Causality: `PRE_EXISTING_UNREPORTED` (not in the upstream report; the lines are at the shallow boundary). Rule 10: the create-mode mode switch and the duplicate flow are untouched.

### A26-S19-03 - Four-decimal amounts are loaded and blurred at two decimals, so an unedited save re-amounts a row or is refused (MON-M37)

1. **Severity:** MEDIUM
2. **Confidence:** high (executed: P2 and P3 component payloads, the `CurrencyInput` probe, and both backend probes)
3. **Location:** `frontend/src/components/ui/CurrencyInput.tsx:118-124` (parse rounds to cents), `:190-193` (`notifyIfChanged` compares the 2dp parse with the 4dp value), `:209-239` (blur); loaders: `TransactionForm.tsx:341-343`, `AccountForm.tsx:411-415` (`openingBalance`, always sent on edit; also `creditLimit`, `paymentAmount`, `originalPrincipal`), `OverrideEditorDialog.tsx:203, 223`, `ScheduledTransactionForm.tsx:271-273, 292-294`; the split check `TransactionForm.tsx:1309-1318` (cents) against `backend/src/common/split-amount.util.ts:43-54` (exact 4dp).
4. **Violated invariant:** an unchanged value re-sent by the client is not a change (AGENTS.md); money is `decimal(20,4)` and the server rounds with `roundMoney`.
5. **Reproduction:** four-decimal rows are written by the server itself: `applyFxConversion` (`fx-entry.util.ts:126-137`; a foreign entry through an import, the assistant or MCP), the implied destination of a cross-currency transfer (`roundMoney(amount * rate)`), investment cash legs. (a) A -3.3333 expense opened and saved with a description edit; (b) a -12.3457 split parent with lines -6.1728 and -6.1729 saved unedited; (c) a tab through any `CurrencyInput` holding -3.3333.
6. **Observed (executed):** (a) payload `amount: -3.33`; on PostgreSQL the balance moves 96.6667 -> 96.67 and the row becomes -3.3300. (b) payload parent `-12.35`, lines `[-6.1728, -6.1729]`; the server refuses with "Split amounts (-12.3457) must equal transaction amount (-12.35)", so the row cannot be saved from the form at all. (c) `onChange(-3.33)` fires on a bare focus and blur.
7. **Expected:** an untouched field reports nothing; the loaded value keeps its stored precision until the user types.
8. **Impact:** sub-cent balance drift on every cosmetic edit (+0.0033 in the example; a reconciled row is re-amounted with no confirmation because `reconciledEditAffectsReconciliation` compares cents), a split row that cannot be edited at all (workflow failure), and the same rounding on account opening balances and schedule templates. The per-row money is small; the refusal is the material part.
9. **Root cause:** the forms round at load, and `CurrencyInput` treats "the text on screen parses to the held value" as the no-edit test, which is false whenever the held value has more precision than the display; the client split check tolerates a cent the server does not.
10. **Recommended correction:** keep the stored value on load (no `Math.round` in the defaults) and make `notifyIfChanged` treat a 2dp parse equal to the held value at display precision as no edit; compare split sums at 4dp on the client.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/frontend/src/components/ui/CurrencyInput.tsx
+++ b/frontend/src/components/ui/CurrencyInput.tsx
@@ -190,5 +190,11 @@
     const notifyIfChanged = (next: number | undefined) => {
       if (next === value) return;
+      // The field shows two decimals; a stored 4dp value (-3.3333) re-parses
+      // as its display (-3.33). That is the same field untouched, not an edit.
+      if (next !== undefined && value !== undefined && roundToCents(value) === next) return;
       onChange(next);
     };
--- a/frontend/src/components/transactions/TransactionForm.tsx
+++ b/frontend/src/components/transactions/TransactionForm.tsx
@@ -341,3 +341,3 @@
           amount: initSource.isTransfer
             ? Math.abs(Math.round(Number(initSource.amount) * 100) / 100)
-            : Math.round(Number(initSource.amount) * 100) / 100,
+            : Number(initSource.amount),
@@ -1310,4 +1310,4 @@
         const splitsTotal = splitsData.reduce((sum, s) => sum + s.amount, 0);
-        const roundedSplitsTotal = Math.round(splitsTotal * 100) / 100;
-        const roundedAmount = Math.round(data.amount * 100) / 100;
+        const roundedSplitsTotal = roundMoney(splitsTotal);
+        const roundedAmount = roundMoney(data.amount);
```

(the same load change applies to the `AccountForm`, override editor and schedule form loaders; the transfer default is A26-S19-01's diff).

12. **Recommended regression test:** `CurrencyInput` with `value={-3.3333}` focused and blurred reports nothing; `TransactionForm` reopening -3.3333 sends -3.3333; a -12.3457 split parent saves unedited.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
--- a/frontend/src/components/ui/CurrencyInput.test.tsx
+++ b/frontend/src/components/ui/CurrencyInput.test.tsx
@@ -171,4 +171,13 @@
     });
+
+    it('stays silent when a four-decimal value is blurred untouched', () => {
+      const onChange = vi.fn();
+      render(<CurrencyInput label="Total" value={-3.3333} onChange={onChange} />);
+      const input = screen.getByLabelText('Total');
+      fireEvent.focus(input);
+      fireEvent.blur(input);
+      expect(onChange).not.toHaveBeenCalled();
+    });
```

14. **Verification method:** the tests above fail at the baseline (probe: `onChange(-3.33)`); the backend probes re-run with the corrected payloads leave the balance at 96.6667 and accept the split save.
15. **Residual risks:** the guard drops a user's deliberate entry of the rounded figure over a 4dp value (typing -3.33 over -3.3333). Currencies with three decimals (KWD, BHD) still display two; currency-aware precision is the full remedy the upstream report asked for. Causality: `PRIOR_REPORTED` MON-M37, `CONFIRMED_WITH_DIFFERENT_ROOT_CAUSE` (the loss is in load and blur, not in the split editor's redistribution; the tolerance conflict is client cents against server exact). Rule 7 surfaces: transaction, split parent, account opening balance, override editor, schedule form.

### A26-S19-04 - The investment form and the embedded investment split prefill the undated latest rate and send it as explicit, so a back-dated trade commits today's rate (MON-H14 client half, A26-S13-02 persisted path)

1. **Severity:** MEDIUM
2. **Confidence:** high (executed: P4; the server half by reading)
3. **Location:** `frontend/src/components/investments/InvestmentTransactionForm.tsx:613-664` (the fill effect depends on the pair only, `getMarketRate(transactionCurrency, cashCurrency)`), `:1192-1195` (the rate is always sent); `frontend/src/components/transactions/InvestmentSplitFields.tsx:118-140` (same `getRate`, carried as `exchangeRate`); `frontend/src/hooks/useExchangeRates.ts:113-140` (`getRate(from, to)`, no date); server `backend/src/securities/investment-transactions.service.ts:772-774` (a supplied rate wins over the dated lookup at `:778-792`) and `:2744-2780` (the embedded split converts at the supplied rate).
4. **Violated invariant:** INV-FX-001: a rate for a date is the newest observation on or before the date, never one struck after it.
5. **Reproduction:** a CAD brokerage and a USD security; the user records a BUY dated 2025-01-02 today (2026-10-21).
6. **Observed (executed, P4):** the rate field fills 1.350000 from `getRate('USD', 'CAD')` (the latest; the only call recorded); the payload carries `transactionDate: '2025-01-02', exchangeRate: 1.35`; the server keeps it, so its own dated resolution never runs.
7. **Expected:** the form asks for the rate on the trade date (`exchangeRatesApi.getRateForDate`, already used by `TransactionForm.tsx:986`) and asks again when the date changes, or omits the rate and lets the server resolve and disclose it.
8. **Impact:** every back-dated cross-currency trade, every historical trade re-entered by hand, and every embedded investment split. Numerical (illustrative rates): 10 x 100.00 USD, rate on 2025-01-02 1.4389, latest 1.3700; committed 1,370.00 CAD against 1,438.90 CAD, -68.90 CAD (-4.8 %) on the cash balance and on the cost basis in CAD. With A26-S13-02's frozen upgrade-day rows the "latest" may itself be stale. The rate is visible and editable, and the help line asks the user to match the posted amount, which is why this is MEDIUM rather than HIGH.
9. **Root cause:** the only rate source the form uses has no date parameter; the server treats any supplied rate as the user's statement.
10. **Recommended correction:** fetch the dated rate in the form (keyed on pair and date, the answer kept with its request key per `docs/frontend/api-and-cache.md`) and keep a "rate edited by the user" flag, as the foreign-entry panel of `TransactionForm` does.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/frontend/src/components/investments/InvestmentTransactionForm.tsx
+++ b/frontend/src/components/investments/InvestmentTransactionForm.tsx
@@ -635,16 +635,24 @@
     if (watchedExchangeRate && watchedExchangeRate !== 1) {
       return;
     }
-    const marketRate = getMarketRate(transactionCurrency, cashCurrency);
-    if (marketRate && marketRate !== 1) {
-      setValue('exchangeRate', roundFxRate(marketRate), {
-        shouldDirty: false,
-      });
-      return;
-    }
+    let cancelled = false;
+    exchangeRatesApi
+      .getRateForDate(transactionCurrency, cashCurrency, watchedTransactionDate)
+      .then((rate) => {
+        if (cancelled) return;
+        setValue('exchangeRate', rate && rate > 0 ? roundFxRate(rate) : 0, { shouldDirty: false });
+      })
+      .catch(() => {
+        if (!cancelled) setValue('exchangeRate', 0, { shouldDirty: false });
+      });
+    return () => {
+      cancelled = true;
+    };
-  }, [securitiesLoaded, needsConversion, transactionCurrency, cashCurrency, getMarketRate, setValue, watchedExchangeRate]);
+  }, [securitiesLoaded, needsConversion, transactionCurrency, cashCurrency, watchedTransactionDate, setValue, watchedExchangeRate]);
```

(the "user edited the rate" flag must stop a date change from replacing a typed rate; the embedded split needs the parent's date passed in; `exchangeRatesApi` is imported from `@/lib/exchange-rates`).

12. **Recommended regression test:** a BUY dated 2025-01-02 asks `getRateForDate('USD', 'CAD', '2025-01-02')` and sends its answer; a date change asks again unless the user typed a rate.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
--- a/frontend/src/components/investments/InvestmentTransactionForm.test.tsx
+++ b/frontend/src/components/investments/InvestmentTransactionForm.test.tsx
@@ -1329,3 +1329,4 @@
-    it('auto-fills the exchange rate with the latest market rate', async () => {
+    it('fills the exchange rate for the trade date, not the latest', async () => {
+      getRateForDateMock.mockResolvedValue(1.4389);
       getMarketRateMock.mockReturnValue(1.365);
@@
-        expect(Number(rateInput.value)).toBeCloseTo(1.365, 3);
+        expect(getRateForDateMock).toHaveBeenCalledWith('USD', 'CAD', expect.any(String));
+        expect(Number(rateInput.value)).toBeCloseTo(1.4389, 4);
```

(`getRateForDateMock` is a new mock of `exchangeRatesApi.getRateForDate`).

14. **Verification method:** P4 re-run must show the dated rate in the payload; S12's A26-S12-02 (the server's fallback to the latest rate) is a separate fix.
15. **Residual risks:** a dated lookup can fail or find nothing; the form must then show the unresolved state (it already blocks the commit, `:1144-1151`) rather than fall back to the latest. Causality: `PRIOR_REPORTED` MON-H14 (client half), `CONFIRMED_WITH_DIFFERENT_ROOT_CAUSE`: the preview-versus-commit divergence is fixed (the previewed rate is the committed one); the rate itself is undated. Rule 7 surfaces: investment form, embedded investment split (A26-S13-02's persisted path, confirmed).

### A26-S19-05 - The transfer form's cost per share is editable, but the server replaces it with the source holding's average on create

1. **Severity:** LOW
2. **Confidence:** high (by reading; the server override is unit-tested per S12)
3. **Location:** `frontend/src/components/investments/InvestmentTransactionForm.tsx:905-915` (prefill), `:1591-1599` (editable `NumericInput`), `:996, :1032` (`costPerShare: Number(data.price) || 0`); `backend/src/securities/investment-transactions.service.ts:2356-2372`; copy `frontend/src/i18n/messages/en/investments.json:297` ("The cost per share ... is carried to the destination").
4. **Violated invariant:** an explicit user instruction is not silently ignored; a field that has no effect is not offered as editable.
5. **Reproduction:** transfer 10 shares whose source average is 100.00; the user types 150.00 as the cost per share.
6. **Observed:** the request carries `costPerShare: 150`; the server writes both legs at 100.00 (the source holds the security).
7. **Expected:** the field is read-only when the server will carry the source basis, or the server honours the stated cost.
8. **Impact:** narrow: the basis is conserved (the server's choice is the correct accounting), but the screen accepted a different figure without saying it would be ignored.
9. **Root cause:** the server became authoritative for the basis (to stop a stale client value poisoning it) and the field stayed editable.
10. **Recommended correction:** render the carried cost as a read-only figure for a new transfer from a holding.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/frontend/src/components/investments/InvestmentTransactionForm.tsx
+++ b/frontend/src/components/investments/InvestmentTransactionForm.tsx
@@ -1591,6 +1591,8 @@
             <NumericInput
               label={t('transactionForm.costPerShare', { currency: transactionCurrency })}
               prefix={currencySymbol}
               value={watchedPrice || undefined}
+              // The server carries the source's average cost on a new transfer.
+              disabled={isTransfer && !!selectedTransferHolding}
               onChange={(value) => setValue('price', value, { shouldValidate: true })}
```

12. **Recommended regression test:** a new transfer from a holding renders the cost field disabled, showing the source average.
13. **Suggested regression-test diff (illustrative, not applied):** in the transfer block of `InvestmentTransactionForm.test.tsx`, after selecting the source holding, `expect(screen.getByLabelText(/Cost per Share/)).toBeDisabled()`.
14. **Verification method:** the component test above.
15. **Residual risks:** the edit path sends `price` and the server's update path was not re-read for its basis rule. Causality: `NEW_SINCE_UPSTREAM_AUDIT` (the upstream P6-004 described the opposite: the client value trusted).

### A26-S19-06 - A loan or mortgage stored at 0 % interest opens with an empty rate and every edit is refused by the required-field check

1. **Severity:** LOW
2. **Confidence:** medium (by reading; not executed)
3. **Location:** `frontend/src/components/accounts/AccountForm.tsx:427` (`interestRate: account.interestRate || undefined`), `:225, :233` (`requireField(data.interestRate === undefined, ...)` for MORTGAGE and LOAN).
4. **Violated invariant:** a known zero renders as a number (`frontend/CLAUDE.md`: never truthiness where 0 is a legitimate value).
5. **Reproduction:** an interest-free family loan or a 0 % promotional loan; the user renames the account.
6. **Observed:** the rate field is empty; Save reports that the interest rate is required.
7. **Expected:** the field shows 0 and the rename saves.
8. **Impact:** workflow friction on one account kind; no money moves (the user can retype 0).
9. **Root cause:** truthiness on a numeric API value.
10. **Recommended correction:** `account.interestRate != null ? Number(account.interestRate) : undefined`.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/frontend/src/components/accounts/AccountForm.tsx
+++ b/frontend/src/components/accounts/AccountForm.tsx
@@ -427 +427 @@
-          interestRate: account.interestRate || undefined,
+          interestRate: account.interestRate != null ? Number(account.interestRate) : undefined,
```

12. **Recommended regression test:** a LOAN with `interestRate: 0` renames and saves; the payload carries `interestRate: 0`.
13. **Suggested regression-test diff (illustrative, not applied):** in `AccountForm.test.tsx`, render the loan fixture with `interestRate: 0`, change the name, submit, and `expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ interestRate: 0 }))`.
14. **Verification method:** the test above fails at the baseline.
15. **Residual risks:** `creditLimit` 0 loads as `undefined` (`:416-418`) and is omitted on save, which leaves the stored 0 unchanged (harmless). Causality: `PRE_EXISTING_UNREPORTED` (S15 hand-off).

### A26-S19-07 - Nine form readouts format figures with `toFixed`, outside the reader's number locale, and the guard does not see them

1. **Severity:** LOW
2. **Confidence:** high (by reading)
3. **Location:** `frontend/src/components/investments/InvestmentTransactionForm.tsx:1513, 1533, 1538, 1545, 1550` (split preview), `:1606, :1611` (transfer source holding), `:1783` (`sharesAtPrice`); `frontend/src/components/accounts/LoanPaymentSetupDialog.tsx:467, 472`; guard `frontend/src/test/number-locale.guard.test.ts` (scans `toFixed` only beside `%`).
4. **Violated invariant:** INV-DISPLAY-001.
5. **Reproduction:** a reader with `numberFormat: pl-PL` opens a security transfer.
6. **Observed:** the source-holding line renders `10.0000` shares at `100.0000` average cost with dot decimals.
7. **Expected:** `formatShareQuantity` / `formatCurrency` off `useNumberFormat()` (comma decimals for pl-PL).
8. **Impact:** a misread figure at the point where the user decides how many shares to move; no stored value changes.
9. **Root cause:** the guard is keyed on the `%` fingerprint, so a bare `toFixed` in JSX passes; `docs/system-invariants.md` records INV-DISPLAY-001 as `enforced`.
10. **Recommended correction:** use the hook's formatters; extend the guard to a `toFixed(` inside JSX braces or a `t(...)` argument.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/frontend/src/components/investments/InvestmentTransactionForm.tsx
+++ b/frontend/src/components/investments/InvestmentTransactionForm.tsx
@@ -1606 +1606 @@
-                  {Number(selectedTransferHolding.quantity).toFixed(4)}
+                  {formatShareQuantity(Number(selectedTransferHolding.quantity))}
@@ -1610,2 +1610 @@
-                  {currencySymbol}
-                  {Number(selectedTransferHolding.averageCost ?? 0).toFixed(4)}
+                  {formatCurrency(Number(selectedTransferHolding.averageCost ?? 0), transactionCurrency)}
```

12. **Recommended regression test:** a guard case matching `.toFixed(` inside JSX braces or a `t(` argument object under `src/components/`.
13. **Suggested regression-test diff (illustrative, not applied):** add to `number-locale.guard.test.ts` a scan for `/\{[^}]*\.toFixed\(\d\)[^}]*\}/` over `src/components/**/*.tsx` with an empty allowlist.
14. **Verification method:** the extended guard fails at the baseline on the nine sites and passes after the migration.
15. **Residual risks:** `formatCurrency` rounds to the currency's decimals, so a 4dp average cost needs a price formatter with more decimals. Causality: `PRE_EXISTING_UNREPORTED`.

## 5. Prior-finding dispositions

| ID | Disposition | Evidence |
| --- | --- | --- |
| MON-H15 | FIXED_VERIFIED | The market fill runs only with no stored price, no typed total and an empty field (`OverrideEditorDialog.tsx:419-431`); a stored price is offered "use latest close" beside it (`:688-707`). Mutation M1b (both `!hasStoredPrice` and `investmentPrice === ''` to `true`) fails 6 tests, among them "keeps an existing override price when a latest close arrives" and "saves the stored price when only the date is changed". M1a (`!hasStoredPrice` alone) survives: it is redundant with the empty-field gate, so the stored price is protected twice and the first gate has no test of its own (section 6). |
| MON-M40 | FIXED_VERIFIED | The two tests named above assert that the stored price survives a delivered quote and a date-only save (`OverrideEditorDialog.test.tsx`, 71 tests passed at the baseline); mutation M1b detected. |
| MON-M37 | STILL_OPEN -> A26-S19-03 | Executed P2, P3 and the `CurrencyInput` probe, backend probes on PostgreSQL; `CONFIRMED_WITH_DIFFERENT_ROOT_CAUSE`. |
| MON-H11 (client half) | STILL_OPEN -> A26-S19-01 | The tampering half is server-side and fixed for transfers (S07); the client manufactures a false source amount when opened from the receiving leg (executed end to end). `CONFIRMED_WITH_DIFFERENT_ROOT_CAUSE`. |
| MON-H14 (client half) | STILL_OPEN -> A26-S19-04 | Preview and commit now agree (the previewed rate is sent; an unresolved rate blocks, S02 mutation M9), but the previewed rate is the undated latest (P4). `CONFIRMED_WITH_DIFFERENT_ROOT_CAUSE`. |
| MON-M28 (client half) | REJECTED | The server half is REJECTED as a documented shape (S07). The editor signs each line by its own category (`SplitEditor.tsx:264-319`, `effectiveAutoSign`), which produces exactly the documented mixed-sign split (a refund line inside an expense) and no other; the client check is the signed sum (`TransactionForm.tsx:1309-1318`), consistent with the server. Nothing in the client contradicts the contract. |
| Hand-off A26-S07-04 client half | disposed: no form PATCHes a transfer leg | `transactionsApi.update(` has one caller (`TransactionForm.tsx:1369`), reached only outside transfer mode; an existing transfer cannot leave transfer mode (`:1521`, mutation M7 caught by "hides mode selector tabs for existing transfer transactions"). The opposite direction is A26-S19-02. |
| Hand-off A26-S08-01 client half | CONFIRMED (no new ID) | `PostScheduledTransactionData` (`types/scheduled-transaction.ts:387-403`) has no occurrence field; `scheduledTransactionsApi.post` and `skip` (`lib/scheduled-transactions.ts:138-158`) send none; the row menu posts with no body at all (`ScheduledTransactionListParts.tsx:209-215`). The dialog's `transactionDate` is the date shown, not an identity. |
| Hand-off S08 `PostTransactionDialog.tsx:433` | disposed: no schedule kind found whose echo posts wrongly beyond A26-S15-09 | The shape is deliberately allowed on the write path (`scheduled-effective-amount.guard.test.ts:54-63`); plain schedules post the override or template figure the user sees; foreign schedules send `originalAmount` only (`:744-756`); loan bills are A26-S15-09 (S15's, merged here). |
| Hand-off A26-S15-09 | CONFIRMED by S15 (owner); client surface merged | The dialog seeds lines from the template (`:456-483`) and the parent from `nextOverride?.amount ?? amount`; it has no loan-occurrence projection, unlike the override editor (`OverrideEditorDialog.tsx:238-271`). |
| Hand-off S15 `AccountForm.tsx:427` | CONFIRMED -> A26-S19-06 | by reading |
| Hand-off S15 `LoanPaymentSetupDialog.tsx:624` | REJECTED as a finding (cosmetic) | `detected?.estimatedInterestRate && (...)` renders a bare `0` when the estimate is 0; a display glitch with no value written (section 8). |
| Hand-off S12 transfer `costPerShare` | CONFIRMED -> A26-S19-05 | |
| Hand-off S12 trade form rate on a back-dated trade | CONFIRMED -> A26-S19-04 | |
| Hand-off S12 rate offered on a same-currency pair | REJECTED | The conversion panel renders only when `needsConversion` (`:1693`); the field is reset to 1 otherwise (`:625-631`); the server's same-currency rule dominates anyway. |
| Hand-off A26-S13-02 persisted path | CONFIRMED -> A26-S19-04 | The server keeps a supplied rate for a cross-currency embedded split (`investment-transactions.service.ts:772-774`) and checks the split amount at it. |
| Hand-off A26-S13-05 client round trip | CONFIRMED (no new ID; S13 owns the finding) | The onboarding picker preselects `detectBrowserCurrency()` (`OnboardingPreferences.tsx:62-64`), so a pl-PL browser on a fresh instance hits the FK failure with zero interaction; the code sent is the catalog's upper-case code. |
| Hand-off S14 redemption keep-the-edit | holds in the suite's scenarios; guards not individually held | `InvestmentTransactionForm.bondRedemption.test.tsx:197-211, 303-322`; mutation R3 (both person-edit guards removed) fails "keeps what the person typed"; R1 (price guard only) and R2 (`lastFilledKey` seeded with `null`) survive (section 6); handed to S21. |
| Hand-off S06 restore dialog counters | disposed: shown | `skippedAttachments`, `unusableAiProviderKeys`, `unlinkedBondSecurities`, `unlinkedBondSeries`, `unrecoveredBondSeries` render outside `restored` (`BackupRestoreSection.tsx:733-810`), tested (`BackupRestoreSection.test.tsx:553-607`). |
| Hand-off S09 wizard committed-failure state | CONFIRMED (client surface of A26-S09-01, no new ID) | `MnyImportProgress.tsx:43-69` shows `mnyErrors.mnyImportFailed` ("Nothing was saved -- you can try again") for any failed job without an error key and offers Start over; the job type carries no `dataCommitted`. Only the reaper path has a post-commit message (`mnyJobStalledAfterCommit`). |
| Hand-off S10 rules editor and bank-sync preview | disposed: no finding | Rule values go through `CurrencyInput` / `NumericInput` (`RuleValueControl.tsx:210-245`, `RuleLoanSettlementFields.tsx:71-89`); the bank-sync row details render each matched rule's applied actions, structural ones included, behind the row's expander (`BankSyncPreviewRowDetails.tsx:19-34`, `ImportPreviewRuleTest.tsx:69-118`); S10's design risk (no summary-level disclosure, no prior-settlement planning) stands as recorded there. |

## 6. Mutation table

| Invariant | Mutation (file:line, what) | Test that fails | Verdict |
| --- | --- | --- | --- |
| INV-OCCURRENCE-002 | M1a `OverrideEditorDialog.tsx:423` `!hasStoredPrice` -> `true` | none (71 passed) | undetected (equivalent today: the `investmentPrice === ''` gate also blocks; the first gate has no test of its own) |
| INV-OCCURRENCE-002 | M1b `:423` and `:425` both -> `true` | 6 tests in `OverrideEditorDialog.test.tsx` | covered |
| no false edit | M2 `CurrencyInput.tsx:191` drop `if (next === value) return;` | 4 tests in `CurrencyInput.test.tsx` | covered |
| no PATCH of a transfer leg | M7 `TransactionForm.tsx:1521` mode selector shown for transfers | "hides mode selector tabs for existing transfer transactions" | covered |
| split sum (client) | M9 `TransactionForm.tsx:1313` `if (false)` | "rejects when splits total does not equal amount" | covered |
| INV-AUTH-003 | M10 `DangerZoneSection.tsx:133` artifact falls back to a forged string | 1 test in `DangerZoneSection.test.tsx` | covered |
| INV-AUTH-003 | M10b `:81` the same for delete-account | 1 test | covered |
| redemption keep-the-edit | R1 `InvestmentTransactionForm.tsx:566` `!priceEditedByPerson.current` -> `true` | none (11 passed; a probe shows the typed 99.5 kept even so) | undetected |
| redemption opens with stored values | R2 `:558` `lastFilledKey` seeded with `null` | none (11 passed) | undetected |
| redemption keep-the-edit | R3 `:566` and `:572` both -> `true` | "keeps what the person typed" | covered |
| A26-S19-01 | baseline defect (`TransactionForm.tsx:341-343`) | none of the 202 `TransactionForm` tests; probe P1 | undetected |
| A26-S19-02 | baseline defect (`:1279-1293`) | none; probe P5 | undetected |
| A26-S19-03 | baseline defect (`CurrencyInput.tsx:190-193`, the loaders) | none; every fixture is 2dp | undetected |
| A26-S19-04 | baseline defect (`InvestmentTransactionForm.tsx:638`) | none; `:1329-1357` asserts the latest rate | undetected |

## 7. Counterexamples and the interaction scenario

- Same numeric value, different meaning: `135` is the received CAD amount on the to leg, and the form re-labels it the USD source (A26-S19-01).
- Apparently cosmetic edit: a description-only save re-amounts a 4dp row (A26-S19-03) and re-prices a cross-currency transfer (A26-S19-01).
- Different object, same values: switching an existing row to Transfer writes a second object with the first's values (A26-S19-02).
- Stale value: a back-dated trade carries today's rate (A26-S19-04).
- Zero versus unknown: a stored 0 % rate loads as unknown (A26-S19-06).
- Counterexamples that held: a stored override price with a delayed quote (MON-H15); a forged reauth artifact (M10); a transfer leg forced into normal mode (M7).

**Interaction scenario (A26-S19-01 x the reconciled-edit guard x A26-S19-03):** a RECONCILED USD leg of a USD 100.1234 -> CAD 135.1667 transfer (both legs four-decimal, as an assistant-created transfer at the server's implied amount would be). Opened from the CAD register, `reconciledEditAffectsReconciliation` compares the CAD leg's own rounded amount (135.17) with the submitted `amount` (135.17) and asks nothing; the server sees `amount 135.17` against the FROM leg's 100.1234 and re-prices at 1:1, moving a reconciled USD row by 35.05 with no prompt. With the strict reconciled lock on, `assertReconciledRowsMutable` would refuse instead, so the user gets a 4xx for a description edit. Not executed; read from `TransactionForm.tsx:103-116, 1395-1404` and S07's INV-RECONCILE-001 row.

## 8. Rejected hypotheses

| Candidate | Evidence considered | Why rejected or downgraded | Final classification |
| --- | --- | --- | --- |
| The Post dialog replaces a schedule's saved price with the latest close | `PostTransactionDialog.tsx:598-618`; `docs/frontend/financial-figures.md:55-57` | Deliberate: only a per-occurrence override's price is protected in the Post dialog; posting at today's market is documented. The general sentence reads wider than the exception (section 11) | REJECTED (documented exception, Rule 2) |
| `nextOverride?.amount ?? amount` in the Post dialog violates INV-OCCURRENCE-003 | guard allowlist `:54-63`; the foreign and loan branches | Allowed on the write path; the loan consequence is A26-S15-09 | REJECTED (deliberate) |
| A same-currency investment trade can be sent with a non-1 rate (S12) | `:625-631`, `:1693` | The field is hidden and forced to 1 | REJECTED |
| The split editor rewrites a valid 4dp split on open (the upstream MON-M37 wording) | `toSplitRows` keeps `Number(split.amount)` (`SplitEditor.tsx:1094`) | The lines are kept exactly; the loss is the parent's load and the blur (A26-S19-03) | REJECTED in that form; root moved |
| A date field set by `setValue` leaves the visible box stale | 15 `setValue('<x>Date'` sites | All are `DateInput` `onDateChange` handlers | REJECTED |
| The delete-data reauth artifact is not bound to the chosen options | `DangerZoneSection.tsx:117-141` | The artifact is purpose-bound (`delete-data`); the options reset to the least destructive defaults after the round trip; the server owns the binding (S03) | DESIGN RISK (section 9) |
| `LoanPaymentSetupDialog.tsx:624` renders a literal 0 | React renders `0 && ...` as `0` | Cosmetic, no value written | REJECTED (cosmetic) |
| The rules editor serializes an empty range bound as 0 | `RuleValueControl.tsx:210-235` | `undefined` serializes as `null` in a JSON array, not 0 | REJECTED |
| Duplicating a transaction dates it with the browser's local day rather than the financial today | `TransactionForm.tsx:336` `getLocalDateString()` | Plausible off-by-one for a user whose timezone preference differs from the browser near midnight; not traced to a wrong posting | DESIGN RISK (section 9) |

## 9. Design risks

- `getLocalDateString()` for a duplicate's date (`TransactionForm.tsx:336`) is the browser's day, not the financial today that `frontend/CLAUDE.md` names (`useFinancialToday`); a user whose timezone preference differs from the device duplicates onto a different day near midnight.
- The server cannot distinguish a client-normalized transfer amount from a typed one, so every transfer form defect of the A26-S19-01 kind becomes a re-pricing. A transfer update DTO naming the leg the client treats as the source (or the leg ids it read) would let the server refuse a mismatch.
- The OIDC delete-data options are not part of what the reauth artifact binds; today the reset to defaults after the redirect makes this safe by accident.

## 10. Missing tests and known-wrong tests

- Missing: a receiving-leg, cross-currency transfer edit and duplicate (A26-S19-01); an existing-row mode switch to Transfer (A26-S19-02); any four-decimal fixture in `CurrencyInput.test.tsx`, `TransactionForm.test.tsx`, the split editor, `AccountForm`, the override editor and the schedule form (A26-S19-03); a back-dated trade's rate (A26-S19-04); a 0 % loan edit (A26-S19-06); a guard for a bare `toFixed` in JSX (A26-S19-07); individual tests for the override editor's `hasStoredPrice` gate (M1a) and the redemption form's price guard and opened-key seed (R1, R2).
- Known-wrong: `InvestmentTransactionForm.test.tsx:1329-1357` "auto-fills the exchange rate with the latest market rate" asserts the undated latest rate for a trade whose date it never sets, which is the behaviour INV-FX-001 forbids for a back-dated trade.
- A green suite with the defects present: 157 files and 4025 tests pass at the baseline with A26-S19-01 to -04 present; the suites had no case for them.

## 11. Documentation inconsistencies

- `docs/system-invariants.md` records INV-DISPLAY-001 as `enforced`, but nine form readouts use `toFixed` and the guard is keyed on `%` only (A26-S19-07).
- `docs/frontend/forms-and-formatting.md:19` says `CurrencyInput` rounds "so the stored value never carries sub-cent precision the 2dp display hides", and `:35` says "a field that hands back its own value has not been edited"; for a four-decimal stored value the two statements conflict and the first wins (A26-S19-03).
- `docs/frontend/financial-figures.md:55` states that an investment price or quantity the user saved is never written over; the same paragraph exempts the Post dialog's refresh of a template price; the first sentence should name the exception.
- `frontend/src/i18n/messages/en/investments.json:297` tells the user the cost per share they see is carried; it is, but a typed one is not (A26-S19-05).

## 12. Review ledger

- **Directories inspected:** `frontend/src/components/{transactions,accounts,scheduled-transactions,investments,import,import-preview,rules,settings,settings/bank-sync,auth,ui}`, `frontend/src/lib`, `frontend/src/hooks`, `frontend/src/types`; the backend write paths named in section 2.
- **Files in full:** `frontend/src/components/ui/CurrencyInput.tsx` (500 lines); `TransferTransactionFields.tsx:60-307`.
- **Files sampled (ranges):** `TransactionForm.tsx:90-460, 495-530, 1180-1480, 1510-1580` (of 1873); `SplitEditor.tsx:258-332, 940-1140` (of 1140); `OverrideEditorDialog.tsx:95-575, 630-710` (of 899); `PostTransactionDialog.tsx:400-520, 596-618, 690-775` (of 1259); `ScheduledTransactionForm.tsx:640-662` plus greps (of 2074); `InvestmentTransactionForm.tsx:340-740, 905-925, 985-1200, 1436-1450, 1584-1615, 1636-1648, 1690-1751` (of 1867); `InvestmentSplitFields.tsx:100-150`; `AccountForm.tsx:215-240, 305-345, 400-470, 540-575`; `AccountFormModal.tsx:60-224`; `LoanPaymentSetupDialog.tsx:460-475, 615-630`; `OnboardingPreferences.tsx:60-125`; `DangerZoneSection.tsx:20-194`; `BackupRestoreSection.tsx:733-810` (grep); `MnyImportProgress.tsx:25-80`; `RuleValueControl.tsx:195-250`; `RuleLoanSettlementFields.tsx:55-100`; `BankSyncPreviewRowDetails.tsx:1-40`; `ImportPreviewRuleTest.tsx:60-120` (grep); `lib/scheduled-transactions.ts:130-160`; `types/scheduled-transaction.ts:387-420`; `lib/scheduled-effective-amount.guard.test.ts:38-66`; backend `transaction-transfer.service.ts:420-494, 1702-1841`; `investment-transactions.service.ts:678-800, 2350-2380, 2637-2780`; `common/split-amount.util.ts:19-60`; `common/fx-entry.util.ts:126-137`; `transactions/convert-to-transfer.ts:1-60`.
- **Not read (size-L deviation):** the rest of `TransactionForm.tsx`, `SplitEditor.tsx`, `ScheduledTransactionForm.tsx`, `PostTransactionDialog.tsx` and `InvestmentTransactionForm.tsx`; `BulkUpdateModal.tsx` (schema only); `MortgageFields.tsx`, `LoanFields.tsx`, `SecurityForm.tsx`, the CSV import mapping steps, `AutoBackupSection.tsx`, `SecuritySection.tsx`, `ApiAccessSection.tsx`, `DelegateAccessModal.tsx`; the rules editor beyond its value controls.
- **Searches:** `transactionsApi.update(` callers; `scheduledTransactionsApi.post(` / `skip(` callers; `nextOverride?.amount`; `setValue('<x>Date'`; `getSecurityPrices` in the scheduled forms; `getRate(` / `getRateForDate` in forms; `.toFixed(` in the form directories; `skippedAttachments|unusableAiProviderKeys|unlinkedBond`; `linkedTransaction` consumers in `app/`, `components/`, `hooks/`, `lib/`; `convert-to-transfer` in the backend.
- **Suites run:** baseline component suites (the slice's directories plus `lib/scheduled-effective-amount`): 157 files, 4025 tests, all passed. `OverrideEditorDialog.test.tsx` 71 passed; `InvestmentTransactionForm.bondRedemption.test.tsx` 11 passed. Probes (scratch worktree, not on the branch): P1-P5 component (all ran; outcomes in section 4), the `CurrencyInput` four-decimal probe (ran), backend `a26-s19-incoming-transfer` and `a26-s19-fourdp` integration probes on PostgreSQL 16 (3 cases ran, outcomes in section 4). Playwright: not run. The component probes assert the serialized payload at the `transactionsApi` / `investmentsApi` boundary, and the backend probes feed that exact payload into the real services on a real database; this covers the round trip a Playwright spec would add except the HTTP serializer. Rebuilding the E2E images with the proxy CA (S01's recipe) was not attempted in this budget.
- **Areas reviewed without a finding:** the override editor's stored price (MON-H15), the reauthentication artifact on delete-account and delete-data, the restore result counters, the transfer mode lock, the date input, the rules editor value controls, the onboarding serializer (beyond A26-S13-05), the split editor's sign handling.
- **Text for the ledger (orchestrator merges):**
  - Session status: S19 done; commit: the commit carrying this file; findings B/H/M/L 0/2/2/3; verdict REQUEST CHANGES.
  - Prior findings (final): MON-H15 FIXED_VERIFIED; MON-M40 FIXED_VERIFIED; MON-M37 STILL_OPEN (A26-S19-03); MON-H11 client half STILL_OPEN (A26-S19-01); MON-H14 client half STILL_OPEN (A26-S19-04); MON-M28 client half REJECTED. MON-M37 is not in this session's override list but is in S19's register row; disposed here.
  - Suites: 157 frontend files / 4025 tests passed at the baseline; 6 component probes and 3 backend integration probe cases, serial.
  - Undetected mutations for the program table: `INV-OCCURRENCE-002 | OverrideEditorDialog.tsx:423 !hasStoredPrice -> true (equivalent) | a test with a stored price and the field cleared before the quote lands | S19`; `redemption keep-the-edit | InvestmentTransactionForm.tsx:566 price guard -> true | a test whose second answer would change the price | S19`; `redemption opened values | :558 lastFilledKey seeded null | a test that asserts no overwrite after the first answer for the opened key | S19`; the four baseline defects A26-S19-01 to -04 (section 6).
  - Open hypotheses handed on: to S21, the three undetected mutation rows above and the known-wrong rate test; to S20, the `toFixed` readouts (A26-S19-07) are figure surfaces too; to S23, A26-S19-01 joins MON-H11's remediation task, A26-S19-04 joins A26-S12-02 and A26-S13-02 (the "a rate for a date" task), A26-S19-03 is MON-M37's; to S08/S23, the client half of A26-S08-01 (no occurrence field in `PostScheduledTransactionData`, the row-menu post with no body) belongs in the same remediation as the server pin; to S09/S23, the wizard's "Nothing was saved" copy for a committed failure joins A26-S09-01; to S17, whether the assistant's or MCP's transfer edit can send the receiving leg's amount as the source the way the form does (the A26-S19-01 shape).
  - Deviations: the size-L "read in full" list was not met for the five largest forms (ranges above); Playwright not run (reason above); `dockerd` started by hand and a stand-alone PostgreSQL container used for the integration probes; probes ran in a scratch worktree with symlinked `node_modules`; nothing outside this report was written to the branch.

## 13. Adversarial approval challenge

Assumption: "the forms send only what the user stated" is wrong. Started from the slice's own abstractions, not from the findings:

- `notifyIfChanged`, the form's own "this was not an edit" signal: asked which held values the 2dp display cannot reproduce. Found the four-decimal rows the server itself writes (A26-S19-03); the 6dp/10dp rate case is already guarded in the investment rate field (`InvestmentTransactionForm.tsx:1703-1719`).
- The leg-by-sign convention shared by both layers: asked what the form does with the leg it did not choose. Found the receiving-leg source amount (A26-S19-01).
- The mode state machine: listed the nine transitions for an edit (three modes from three origins). Transfer -> other is locked (M7); normal/split -> transfer is not, and it double-books (A26-S19-02).
- Every prefill in a money form (market price, market rate, average cost, loan occurrence): asked whether the prefill depends on everything the value depends on. The rate does not depend on the date (A26-S19-04); the average cost is overridden server-side (A26-S19-05); the market price is gated (MON-H15 holds).
- Stale clients: the Post dialog over an advanced schedule (A26-S08-01, client half confirmed; no pin field exists in the client type).
- Searched for a second write path the form defects could also reach: the AI/MCP transfer edit (handed to S17), bulk update (no amount field), the import wizard (no form-owned money).

Result: both HIGH findings (A26-S19-01, -02) survive the challenge and are executed; nothing found invalidates them.

## 14. Verdict

**REQUEST CHANGES.** Reviewed SHA `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86`. Confirmed: BLOCKER 0, HIGH 2 (A26-S19-01, -02, executed), MEDIUM 2 (A26-S19-03, -04, executed), LOW 3 (A26-S19-05, -06, -07, by reading). Independently verified: MON-H15 and MON-M40 fixed (mutation M1b), the reauthentication artifact on destructive actions, the transfer mode lock, the split editor's documented mixed-sign behaviour, the restore result counters. Limitations: the five largest forms were sampled, not read end to end; no Playwright run; hosted CI not consulted (read-only audit of a pinned baseline). The adversarial close-out pass was completed (section 13).
