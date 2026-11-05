# S15 Loans and GEM strategies

## 1. Metadata

| Field | Value |
| --- | --- |
| Session | S15 (parallel wave, child of orchestrator session_018Nx7aian3f7dpRX5msjFBg) |
| `AUDIT_BASELINE_SHA` | `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86` |
| `git rev-parse HEAD` at start | `1c0cbcfa0614328af8c7965c387d8cf2d46fd7b8` (pin check of plan step 2: empty diff outside `docs/audits/`) |
| Date | 2026-10-21 |
| Primary path | `backend/src/loan-installments/` |
| Hint line used | `run the protocol's loan matrix in full: normal payment, principal-only extra payment, payment below accrued interest, payoff, one cent above and below payoff, rate change, same-day multiple payments, voided payment, duplicate posting; prioritize the final payment's parent amount versus its splits, ledger-backed interest history, schedule regeneration after a rate change, preview equals commit, and for GEM the signal computed from converted prices at one session with a refusal when a component is missing` |
| Status | done |
| Runtime executed | Node 24.22.1; `npm ci` OK in `backend/` and `frontend/`; PostgreSQL 16 (`mirror.gcr.io/library/postgres:16-alpine`, `dockerd` started by hand). Baseline integration, one invocation: `npm run test:integration -- 'dated-loan-payment\|gem-price\|imported-settlement-flow\|loan-interest-relink\|loan-settlement-claim\|loan-settlement-debt\|mortgage-method-checks\|mortgage-type-backfill\|scheduled-loan-dated-balance\|scheduled-loan-pricing-concurrency\|transaction-rules-loan-fold'`: **11 suites, 71 tests, all passed**. Unit: `TZ=UTC npm run test:unit -- src/strategies` 14 suites, 375 passed. Frontend: `npx vitest run src/lib/loan-history src/lib/loan-schedule src/components/reports/LoanAmortizationReport` 6 files, 351 passed. Probes in a scratch worktree at the baseline (`<scratchpad>/mut`, never committed): `zz-s15-probe.integration.spec.ts` (the loan matrix through the REAL `ScheduledTransactionsService.post()`, constructed by hand over the real `TransactionsService` and `ScheduledTransactionLoanService`, 6 cases), `zz-s15-undo.integration.spec.ts` and `zz-s15-undo2.integration.spec.ts` (real `AccountsService.update` + real `ActionHistoryService.undo`), `src/zz/zz-gem.spec.ts` (real `momentumSnapshot` / `evaluate`); two read-only sweep agents (GEM; frontend loan history) whose claims were re-verified as stated per finding. |

## 2. Invariant map

| ID | Statement | Mechanism named | Holds at baseline? |
| --- | --- | --- | --- |
| INV-LOAN-004 | The final payment is the residual payoff | Posting: `resolvePostingAllocation` -> `allocateLoanPayment` clamps principal to the dated debt and `post()` re-sums the parent from the lines (`scheduled-transactions.service.ts:3509-3514`, `:3631-3633`); template: `applyLoanTemplateRewrite` writes parent = `allocation.total` (`reprice-template.ts:256-266`) | **Yes** for a managed template, executed (R4, R5, R11). A declined (escrow) template posts its stored principal past the debt (section 9, D5). |
| INV-LOAN-006 | An installment prices the ledger debt and the rate dated at its own due date | `resolveInstallmentCore` -> `datedLoanDebt` (`ACCOUNT_BALANCE_AS_OF_SQL`, inclusive of the date) and `annualRateOn` over `loan_rate_changes`; `lockLoanLedgerForPricing` before the read (`:3472`, `:3607`) | **Yes**, executed (R1, R2, R7, R9). Same-day rows are inside the bound by definition (D1). A payment below the period's interest books less interest than `debt x rate` and nothing records the rest (A26-S15-04). |
| INV-LOAN-007 | One amortization method per mortgage type, on every surface | `amortizationMethodFor` traits; `AccountsService.update` reprices the template on a method change (`accounts.service.ts:1126-1187`) | **No** on the undo/redo path (A26-S15-01, executed). |
| INV-LOAN-008 | One settlement per occurrence; the claim commits with the split | `idx_stp_occurrence` + `INSERT ... ON CONFLICT DO NOTHING RETURNING id` in `post()` (`:3646-3663`) and `claimLoanOccurrence` (`claim-loan-occurrence.ts:89-117`); one `withScopedDb` transaction | **Yes** for the claim, executed (R10: pinned duplicate 409, ledger moved once). The cursor half is A26-S08-03 (S08's, re-confirmed by reading). |
| INV-LOAN-009 | An annuity installment's payment is the one stated for its own due date | `datedAnnuityPayment` / `paymentNewlyApplies` (`price-installment.ts:373-460`); posting keeps the bill shown | Yes on the paths read; `dated-loan-payment` integration passed. |
| INV-LOAN-010 | A loan's interest category and its template's interest line change together | `planLoanInterestRelink` / `applyLoanInterestRelink` in `AccountsService.update` | **No** on the undo/redo path (A26-S15-01, executed: template unmanaged after undo). |
| INV-LOAN-HISTORY-001 (`partial`) | Historical interest is ledger-backed | `frontend/src/lib/loan-history.ts` `deriveLoanPaymentHistory` / `classifyPayment` | The estimate is gone (verified: no balance x rate producer of a historical figure). The recorded gap is **wider** than the index says (section 11, D-2) and the history's row inclusion is not the ledger's (A26-S15-03, A26-S15-05). |
| INV-LOAN-001..003, 005 | Cadence, truncation, compounding, first payment | `recurringOccurrencesDue`, `paidOff` gating, `getPeriodicRate`, `calculateEndDate` | Sampled through the frontend sweep (loan-schedule probes J, L: OK); not re-derived. |
| INV-OCCURRENCE-001 | One occurrence, one financial effect | as INV-LOAN-008 | Yes for a pinned post (R10); unpinned manual post is A26-S08-01 (S08). |
| INV-BALANCE-001 | `current_balance` = ledger | loan pricing never reads `current_balance` (`datedLoanDebt`) | A26-S07-02's absolute restore cannot mis-price an installment (pricing reads the ledger), but the same undo function breaks INV-LOAN-007/010 (A26-S15-01). |
| GEM (no index entry) | The signal compares every role's return over the same sessions; an unknown component refuses | `spanCloses` (`gem-momentum.util.ts:191-237`): each end within `BOUNDARY_LAG_DAYS` = 14, settled once the series holds a close on or after the boundary; RISK_ON refused when a market is unmeasured (`:366-409`) | **No** for "same session" (A26-S15-02, executed). Refusal on a missing component: yes. Converted prices: no -- momentum is native-currency by documented design (D6). |
| INV-GEM-NOTIFY-001..003 (spec only, not in the index) | One alert per (strategy, period, kind), only for the current period's change | dedupe key `gem:<id>:<evaluatedOn>:<kind>` on `idx_notifications_dedupe`, `INSERT ... ON CONFLICT DO NOTHING` | **No**: not bound to the current period, and the dedupe row is purged after the retention window (A26-S15-07). |

Material flows:

- `schedule template -> post() (lock schedule, re-read splits, lockLoanLedgerForPricing) -> resolvePostingAllocation (datedLoanDebt(postDate), annualRateOn, priceInstallment purpose=posting) -> bookLoanAllocation (minor unit, never past the debt) -> transactionsService.create (parent re-summed) -> claim INSERT -> advanceScheduleCursor -> commit -> recalculateLoanPaymentSplits (rewriteLoanTemplate purpose=template at the new next_due_date; paid-off -> isActive=false unless LOC)`.
- `bank row -> rule settle_loan_installment -> loan-settlement-facts (locks, claims, datedLoanDebts) -> selectOccurrenceSlot (nearest free slot in window) -> planLoanSettlement (priceInstallment purpose=settlement, amount policy table 8) -> writeEffects (split, claimLoanOccurrence, cursor) -> commit -> repriceSettledLoanTemplates`.
- `account edit -> AccountsService.update (relink, reprice in the same transaction) -> action_history (beforeData = whole entity) -> undo -> undoSimpleEntity (manager.update(Account, id, beforeData filtered by ALLOWED_COLUMNS.accounts))` -- the last step writes the coupled loan columns with no relink and no reprice.
- `security prices -> GemPriceService -> momentumSnapshot (spanCloses per role) -> evaluate -> gem_strategy_signals (materialized once per fingerprint/version) -> report -> GemSignalChangeAlertService (two newest history rows) -> NotificationService.create (dedupe) -> purgeOld (30-day retention)`.
- `transactions API (all statuses, all dates) -> fetchAllAccountTransactions -> deriveLoanPaymentHistory -> LoanAmortizationReport cards, table, CSV/PDF, projection seed`.

## 3. Lens ledger

| Lens | Ran / not applicable |
| --- | --- |
| Instructions before implementation | ran: `AGENTS.md`, root and `backend/CLAUDE.md`, `docs/system-invariants.md` INV-LOAN-001..010 and HISTORY-001 in full, `docs/specs/loan-installment-settlement.md` sections 6-12, `scheduled-loan-installment-pricing.md` sections 3-4 (sampled), `gem-signal-change-notifications.md` sections 3-4; `mortgage-types.md`, `docs/gem-strategy.md`, `docs/future-plans/mortgage-types.md` sampled through the sweep agents. |
| Invariant model | ran (section 2). INV-LOAN-011 named in `sessions.md` does not exist (section 11). |
| Change surface / producer-consumer | ran: posting (two branches), template rewrite, settlement claim, slot selection, undo of account edits, frontend history producer and its report consumer, GEM momentum and alert. |
| Representation boundary | ran: debt `0.01` vs `< 0.01` (A26-S15-06), `null` rate vs 0 % (posting keeps `?? 0`, settlement refuses: documented), interest sign in history (A26-S15-05), VOID / future-dated rows in history (A26-S15-03). |
| Browser/UI round trip | ran for the Post dialog echo path by reading (`post()` `:3546-3636`: an unchanged echo re-prices, a typed figure posts as given); the dialog itself is S19's. |
| Server-authoritative metadata | ran: the loan, its debt, rate and payment are read server-side; `userId` from JWT on both loan controllers (`@UseGuards(AuthGuard("jwt"))`, `ParseUUIDPipe` on every `:id` / `:accountId`). The loan schedule's currency is taken from the setup request's loan without checking the source account (A26-S15-10). |
| Identity versus value | ran: posted lines are addressed by `sourceSplitId`; claims by `(schedule, original_due_date)`; R10 duplicate. No new finding. |
| State machine | ran: schedule `active -> posted/advanced -> retired (paid-off, isActive=false) / LOC stays active`; claim `none -> post|rule -> released on delete / kept on void`; account edit `-> undo` (A26-S15-01). |
| Concurrency / idempotency | ran: `scheduled-loan-pricing-concurrency` and `loan-settlement-claim` (two connections) passed; R10. No new race found. |
| Partial failure | ran: post-commit template reprice failure is logged and the posting reprices at the boundary (`reprice-template.ts:288-306`); nothing outside PostgreSQL. |
| External provider | ran for GEM price/FX reads (sweep agent, verified for momentum); no provider call in the loan slice. |
| Database / migration | not applicable beyond reading: no migration is in the slice; `idx_stp_occurrence` and the `transaction_id` partial unique index were checked by S08/S05. |
| Backup/restore | not applicable: no backup path in the slice (S06 owns it). |
| Financial / loan matrix | ran in full, section 7.1, every row with a worked example. |
| Authorization / RLS | ran: loan-scenarios and loan-rate-changes controllers and services scope by `userId` through `withScopedDb`; GEM controller guarded, ownership checked inside the save transaction (sweep, spot-checked). |
| Tests as evidence | ran: the matrix probes show which rows no suite exercises against the real `post()` (section 10). |
| Mutation | ran: M1-M7 executed, M8-M9 baseline defects (section 6). |
| Counterexample / interaction | ran (section 7). |
| Adversarial approval challenge | ran (section 13). |

## 4. Confirmed findings

### A26-S15-01 - Undo (and redo) of a loan or mortgage account edit restores the loan's coupled columns without the template reprice or relink the edit performed: the bill keeps the previous method's installment for the life of the loan, or the template stops being managed

1. **Severity:** HIGH
2. **Confidence:** high (executed, both halves)
3. **Location:** `backend/src/action-history/action-history.service.ts:1741-1764` (`undoSimpleEntity`, `update`: `manager.update(entityClass, id, beforeData)`), `:172-212` (`ALLOWED_COLUMNS.accounts` includes `mortgage_type`, `payment_amount`, `interest_category_id`, `prepayment_mode`, `amortization_months`, `original_principal`, `source_account_id`, `scheduled_transaction_id`, `payment_matching_rule_id`); dispatch `:577-578`; producer `backend/src/accounts/accounts.service.ts:1022-1042, 1126-1130, 1169-1187, 1208-1217`. Redo uses the same function with before/after swapped.
4. **Violated invariant:** INV-LOAN-007 (one method per mortgage type, from preview to pricing; a method change reprices the template, `docs/specs/mortgage-types.md` 5.6) and INV-LOAN-010 (a template managed before a successful update is managed after it).
5. **Reproduction:** (a) an ANNUITY mortgage, EUR 300,000, 360 months, 2.00 %, payment 1,108.86, template 608.86 + 500.00. The user changes the type to LINEAR (the update reprices the template to 833.3333 + 500.00 = 1,333.3333 and nulls `payment_amount`), then presses Undo. (b) a LOAN with interest category A; the user changes it to B (the update relinks the template line to B), then presses Undo.
6. **Observed (executed, `zz-s15-undo2`, `zz-s15-undo`):** (a) after the undo the account is ANNUITY with `payment_amount` 1,108.86 and the template still holds 1,333.3333; the next advancement (`rewriteLoanTemplate`, purpose `template`) leaves it at 1,333.3333 (`max(template, dated payment)`), and the posting purpose prices principal 833.3333 + interest 500.00 = **1,333.3333**. (b) after the undo the account's category is A and the template line is B: `identifyLoanTemplate(...).managed === false`, so every later posting declines to re-price (posts the stored split), the template never advances, and a `settle_loan_installment` rule refuses `loan_not_configured` (`managedTemplate`).
7. **Expected:** an undo is an edit like any other: it reprices the template to the restored method (1,108.86) and relinks the interest line to the restored category, in the same transaction, or the undo is refused.
8. **Impact:** (a) EUR 1,333.33 instead of 1,108.86 every month: **+224.47 per installment (+20.2 %)** moved from chequing to the mortgage that the bank never debited, cumulative and silent until reconciliation (2,693.64 after a year). (b) the split stays at the last period's figures (interest overstated by a growing amount, principal understated), and the final installment posts its stored principal past the debt; payment matching stops working. Both reachable by one Undo click after an ordinary edit.
9. **Root cause:** the generic entity undo treats the account's loan configuration as independent columns; the side effects `AccountsService.update` performs on the schedule (relink, reprice) are not part of the action record and nothing replays them. Same function as A26-S07-02 (S07, `current_balance`), different invariants.
10. **Recommended correction:** route an account `update` undo/redo through `AccountsService.update` with the restored values (so relink, reprice and their refusals run), or remove the loan-coupled columns from `ALLOWED_COLUMNS.accounts` and refuse the undo of an edit that changed any of them while a schedule exists.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/action-history/action-history.service.ts
+++ b/backend/src/action-history/action-history.service.ts
@@ case "account":
-        await this.undoSimpleEntity(action, manager, Account, "accounts");
+        if (action.action === "update" && touchesLoanTemplate(action)) {
+          // A loan's method and interest category are coupled to its payment
+          // template (INV-LOAN-007, INV-LOAN-010); restoring the columns alone
+          // leaves the template priced for the other configuration.
+          throw new ConflictException(
+            tr(
+              "errors.actionHistory.loanEditNotUndoable",
+              "This loan change cannot be undone automatically. Edit the loan to change it back.",
+            ),
+          );
+        }
+        await this.undoSimpleEntity(action, manager, Account, "accounts");
@@
+const LOAN_TEMPLATE_COLUMNS = [
+  "mortgageType", "prepaymentMode", "amortizationMonths", "originalPrincipal",
+  "paymentAmount", "interestCategoryId", "sourceAccountId", "paymentFrequency",
+] as const;
+function touchesLoanTemplate(action: ActionHistory): boolean {
+  const before = action.beforeData ?? {};
+  const after = action.afterData ?? {};
+  return (
+    !!(before.scheduledTransactionId ?? after.scheduledTransactionId) &&
+    LOAN_TEMPLATE_COLUMNS.some((k) => (before[k] ?? null) !== (after[k] ?? null))
+  );
+}
```

   Decision for the maintainer: refuse (above, smallest safe change) or replay through `AccountsService.update` (keeps Undo working, needs the service in the action-history module without a cycle). The refusal must run before any write; `undo()` already runs in one transaction. Needs: a new i18n key, unit cases, the two probes as integration cases.
12. **Recommended regression test:** the two probes: change type / category through `AccountsService.update`, undo, assert the template is either repriced to the annuity payment and still managed, or the undo was refused with nothing written.
13. **Suggested regression-test diff (illustrative, not applied):** `backend/test/integration/loan-account-undo.integration.spec.ts`, built as `zz-s15-undo2` (the harness's scheduled-module stub gets the real `rewriteLoanTemplate(m, id, "reconfigure")` as `repriceLoanTemplate`): `await accounts.update(userId, loanId, { mortgageType: "LINEAR", prepaymentMode: "SHORTEN_TERM" }); await history.undo(userId).catch(() => undefined); const st = await db.manager.findOneByOrFail(ScheduledTransaction, { id }); expect(Math.abs(Number(st.amount))).toBe(1108.86);` and the category case `expect(identifyLoanTemplate(lines, loan).managed).toBe(true)`.
14. **Verification:** those specs; `npm run test:unit -- action-history`; the redo direction (LINEAR restored with the annuity template: heals at the next advancement, since LINEAR derives its installment, but the posting before it re-divides the annuity bill).
15. **Residual risks:** `source_account_id` restored without `reassignLoanSourceAccount` moves the loan's payments to another account only in the account row (not executed); `payment_matching_rule_id` and `scheduled_transaction_id` restored to ids that may since have been deleted (not executed). The refusal blocks Undo for legitimate non-loan edits made in the same action (name plus type): acceptable, the message says what to do.

- Causality: `NEW_SINCE_UPSTREAM_AUDIT` (mortgage types, the relink and the reprice are post-August; the generic undo is older and was correct before the coupling existed).

### A26-S15-02 - GEM momentum prices one role from a close up to 14 days before the boundary while its series already holds a later close, so the signal compares different sessions and is materialized for good

1. **Severity:** MEDIUM
2. **Confidence:** high (executed)
3. **Location:** `backend/src/strategies/gem-momentum.util.ts:191-237` (`spanCloses`: each end `pointAsOf` within `BOUNDARY_LAG_DAYS`; the "settled" test is only `prices[last].date < to`), `backend/src/common/time-series/price-boundary.util.ts:44, 82-99`; materialized once: `gem-signal.service.ts:439-441, 481-486` (per the sweep, read).
4. **Violated invariant:** the AGENTS.md rule "a board of movers is one session's" applied to a ranking of returns (`keepNewestSession`): roles compared over one window must be priced at the same session; and the hint's "signal computed at one session".
5. **Reproduction:** monthly GEM, 12-month lookback, evaluation 2026-09-30. US fund 100 -> 110 (close on 09-30). Ex-US fund 100 -> its feed has no closes 2026-09-19..09-30 (a refresh outage), last close 104 on 09-18, then 113 on 10-01 when the feed resumes; its true 09-30 close was 112. Safe asset +3 %.
6. **Observed (executed, `src/zz/zz-gem.spec.ts` over the real `momentumSnapshot` and `evaluate`):** `{"US_EQUITY":10,"EX_US_EQUITY":4,"SAFE":3}` -> `RISK_ON`, target `US_EQUITY`, lead 6 pp.
7. **Expected:** the ex-US span is not settled for 09-30 (the series has a gap at the boundary while other roles have the boundary's close), so the period defers (`UNELAPSED`) or refuses naming the role and the missing session; with the true close (+12 %) the target is `EX_US_EQUITY`.
8. **Impact:** the wrong fund is recommended for the whole period and the stored signal is never re-evaluated after the gap is repaired; the user may switch the whole strategy allocation (a financially significant action) on it.
9. **Root cause:** the settled test asks whether the series has *any* close at or after the boundary, not whether its exit close is the boundary session the other roles use; the 14-day lag that tolerates exchange holidays also tolerates a feed gap.
10. **Recommended correction:** price the exit of every role at one common session: the newest date on or before the boundary on which every role has a close (or each role's exit within a small holiday tolerance of the newest exit across roles), otherwise `UNELAPSED`/refuse with the role named.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/strategies/gem-momentum.util.ts
+++ b/backend/src/strategies/gem-momentum.util.ts
@@ export function spanCloses(
   if (end === "BOUNDARY" && prices[prices.length - 1].date < to) {
     return { state: "UNELAPSED" };
   }
+  // A close exists after the boundary but none near it: the series has a gap
+  // at the boundary (a feed outage), not a holiday. Defer rather than price the
+  // span off an older session than the other roles use.
+  if (end === "BOUNDARY" && daysBetween(exit.date, to) > BOUNDARY_HOLIDAY_DAYS) {
+    return { state: "UNELAPSED" };
+  }
```

   with `BOUNDARY_HOLIDAY_DAYS` (for example 4) in `price-boundary.util.ts`. Decision for the maintainer: a per-role holiday tolerance (above) or a common-session rule across roles in `momentumSnapshot` (stronger, needs the roles' series together). Needs: unit cases, the backfill's gap test (`gem-backfill.service.ts:98-104`) aligned.
12. **Recommended regression test:** the counterexample above as a `gem-momentum.util.spec.ts` case asserting the ex-US role is not `PRICED` (or the snapshot refuses) for 2026-09-30.
13. **Suggested regression-test diff (illustrative, not applied):** `it("does not price a role across a feed gap at the boundary", () => { const m = momentumSnapshot({ US_EQUITY: us, EX_US_EQUITY: exWithGap, SAFE: safe }, "2026-09-30", 12); expect(m.EX_US_EQUITY).toBeNull(); });`
14. **Verification:** `TZ=UTC npm run test:unit -- src/strategies`; a backtest regression to confirm holiday boundaries still price.
15. **Residual risks:** a market closed for more than the tolerance (a long national holiday) would defer a period; the materialized row needs re-evaluation for periods already stored on a gap (a data repair decision).

- Causality: `NEW_SINCE_UPSTREAM_AUDIT` (`backend/src/strategies/` is new).

### A26-S15-03 - The loan payment history counts VOID payments, VOID interest expenses and future-dated payments as paid

1. **Severity:** MEDIUM
2. **Confidence:** high (VOID: executed by the frontend sweep's Vitest probe over the real `deriveLoanPaymentHistory`, re-verified by reading; future-dated: executed by the same probe)
3. **Location:** `frontend/src/lib/loan-history.ts:1536-1552` (`fetchAllAccountTransactions`: no `statuses`, no date bound), the derivation (no `status` or date read anywhere in the module: `grep -n "VOID\|status" loan-history.ts` returns nothing); backend `transactions.service.ts:1403-1407` (status filtered only when `statuses` is passed). Consumers: `LoanAmortizationReport.tsx` cards, table, CSV/PDF, the projection seed (`observedInstallment`), `hooks/useLoanProjection.ts`.
4. **Violated invariant:** INV-TRANSFER-001 ("VOID means no balance moved, on every surface"), INV-LOAN-HISTORY-001 (interest counted as paid is ledger-backed), and the shared inclusion rule `LEDGER_MOVEMENT_PREDICATE` the backend balance readers use.
5. **Reproduction:** loan opening 10,000; a 1,000 payment on 2026-01-15; a second 1,000 payment on 2026-02-15 that bounced and was voided. Separately: a standalone interest expense of 50 voided. Separately: a 500 payment entered for 2026-12-15 (today 2026-10-21).
6. **Observed:** cumulative principal **2,000.00**, last history balance **8,000.00** (account balance 9,000.00); interest **50.00** from the voided expense; the future 500 is listed as paid (history principal 1,500) and the projection, which starts from the 9,000.00 current balance, pays it again (history + projection principal 10,500.02 on a 10,000 loan).
7. **Expected:** 1,000.00 / 9,000.00; 0.00; the future row either excluded from history or the projection anchored after it.
8. **Impact:** "Total Principal Paid", "Total Interest Paid", the per-row balance, the exports and the projection seed are wrong by the voided or future amount; 1,000.00 here (10 % of the loan).
9. **Root cause:** the client history re-derives row inclusion instead of applying the ledger's (non-VOID, top-level, dated through today).
10. **Recommended correction:** request only `statuses` other than VOID and bound the fetch at the user's today (`financialTodayYmd`), or filter both in `deriveLoanPaymentHistory`; add a source-scan guard that the module reads `status`.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/frontend/src/lib/loan-history.ts
+++ b/frontend/src/lib/loan-history.ts
@@ export function deriveLoanPaymentHistory(
-  const sorted = [...transactions].sort(byDate);
+  // The ledger's own inclusion: a VOID row moved nothing, and a row dated
+  // after today is not history yet (the projection pays it).
+  const counts = (t: Transaction) =>
+    t.status !== 'VOID' && t.transactionDate <= todayYmd;
+  const sorted = transactions.filter(counts).sort(byDate);
+  const interestRows = interestTransactions.filter(counts);
```

   (`todayYmd` passed in by the callers, which already hold it for the projection, INV-LOAN-006's frontend half). Needs: the call sites, the tests.
12. **Recommended regression test:** the three probe cases in `loan-history.test.ts` with monetary asserts.
13. **Suggested regression-test diff (illustrative, not applied):** `it("ignores a VOID payment", () => { const h = deriveLoanPaymentHistory(acct(), [tx({ amount: 1000, transactionDate: "2026-01-15" }), tx({ amount: 1000, transactionDate: "2026-02-15", status: "VOID" })], [], [], "2026-10-21"); expect(h.cumulativePrincipal).toBe(1000); });`
14. **Verification:** `npm run test -- loan-history LoanAmortizationReport`; `npm run type-check`.
15. **Residual risks:** a refund sign (A26-S15-05) and the shared-category merge (section 11) are separate.

- Causality: `PRE_EXISTING_UNREPORTED` for VOID (the module's history predates the upstream audit by its own comments; not provable in the shallow clone), the future-date half likewise.

### A26-S15-04 - An installment below the period's interest is booked as settling the period; the unpaid interest is recorded nowhere and the loan stops growing

1. **Severity:** MEDIUM
2. **Confidence:** medium (executed; the expected treatment is a product decision)
3. **Location:** `backend/src/accounts/loan-payment-waterfall.util.ts:59-71` (`interest = Math.min(interest, paymentAmount); principal = 0`), consumed by `priceInstallment` (`price-installment.ts:677-683`) for every purpose.
4. **Violated invariant:** INV-LOAN-006's statement "the interest of a scheduled loan installment is roundMoney(debt x periodic rate)", and "withholding a figure is only honest if the reader learns why" (AGENTS.md): the shortfall is neither booked nor reported.
5. **Reproduction:** LOAN 400,000 at 6 % monthly, schedule payment 1,500 (for example after a rate rise whose payment sync the user declined, INV-LOAN-006 known gap). Post 2026-08-01 and 2026-09-01.
6. **Observed (executed, R3):** each posting books interest 1,500.00 and principal 0.00; the loan ledger stays at 400,000.00; the template keeps 1,500 / 0; no log, alert or flag.
7. **Expected:** interest accrued 2,000.00 per period; either the 500.00 shortfall is capitalized onto the debt (negative amortization, debt 400,500 then 401,002.50) or the posting/template carries an explicit "does not cover interest" state the bill and the loan page show.
8. **Impact:** the loan balance understates the debt by 500.00 per period (6,000.00 after a year, 1.5 %); every forecast and payoff date read from the ledger is optimistic; the frontend projection already refuses the same loan (`coveredInterest: false`), so the two layers disagree silently.
9. **Root cause:** the cap was added so a child cannot exceed its parent (RR2-006); nothing records what the cap removed.
10. **Recommended correction:** decide the convention (capitalize, or flag); minimum: return the shortfall from `allocateLoanPayment` and surface it on the occurrence projection and the bill as a warning; capitalization would add a loan-side interest accrual row.
11. **Suggested remediation diff: incomplete.** Supported part:

```diff
--- a/backend/src/accounts/loan-payment-waterfall.util.ts
+++ b/backend/src/accounts/loan-payment-waterfall.util.ts
@@ export interface LoanPaymentAllocation {
   total: number;
+  /** Accrued interest the installment did not cover (0 when covered). */
+  unpaidInterest: number;
 }
@@
-  if (interest > basePayment) {
+  const accrued = interest;
+  if (interest > basePayment) {
     interest = Math.min(interest, paymentAmount);
     principal = 0;
   }
@@
   return {
     principal,
     interest,
     extraPrincipal,
     total: roundMoney(principal + interest + extraPrincipal),
+    unpaidInterest: roundMoney(Math.max(0, accrued - interest)),
   };
```

   Missing: the maintainer's choice between capitalizing (a ledger row on the loan, with its own invariant) and flagging (the occurrence projection's `complete`/warning field and the bill UI).
12. **Recommended regression test:** R3 with an assert on the chosen behaviour (`unpaidInterest === 500` on the allocation and on the projection).
13. **Suggested regression-test diff (illustrative, not applied):** `expect(allocateLoanPayment({ paymentAmount: 1500, extraPrincipal: 0, interest: 2000, principal: -500, currentBalance: 400000 })).toMatchObject({ interest: 1500, principal: 0, unpaidInterest: 500 });`
14. **Verification:** `npm run test:unit -- loan-payment-waterfall price-installment`; R3 through `post()`.
15. **Residual risks:** a lender that treats the shortfall as arrears (not capitalized) would want a third treatment.

- Causality: `PRE_EXISTING_UNREPORTED` (the cap predates the new modules; the exact introduction date is not provable in the shallow clone).

### A26-S15-05 - An interest refund in the loan's interest category is added to "Interest Paid" instead of netted

1. **Severity:** LOW
2. **Confidence:** high (executed by the frontend sweep's probe; lines re-read)
3. **Location:** `frontend/src/lib/loan-history.ts:1313` (`Math.abs(Number(tx.amount))` for every standalone interest row), `:1244-1246` (per split line).
4. **Violated invariant:** "a category's cost is its signed sum over rows of both signs" (AGENTS.md, `netEntityTotal`).
5. **Reproduction:** a -200.00 interest expense on 2026-01-15 and a +50.00 interest refund on 2026-01-16 from the lender.
6. **Observed:** interest **250.00**; an orphan +50.00 refund becomes an interest row of +50.00.
7. **Expected:** 150.00; the orphan refund reduces cumulative interest (-50.00).
8. **Impact:** Interest Paid, the exports and the tax-relevant interest total overstated by twice the refund (100.00 here).
9. **Root cause:** magnitude taken per row before summing.
10. **Recommended correction:** sum signed amounts and negate once.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
-    const amount = Math.abs(Number(tx.amount));
+    // Signed: an expense is negative, a refund positive; interest paid is the
+    // negated net, so a refund reduces it.
+    const amount = -Number(tx.amount);
```

   and the split-line sum likewise (`-Number(s.amount)`), clamping only the displayed per-row figure if a negative row must not render. Needs: the pairing code that assumes non-negative amounts re-checked.
12. **Recommended regression test / 13. diff:** `it("nets an interest refund", () => { ... intx({ amount: -200 }), intx({ amount: 50 }) ...; expect(h.cumulativeInterest).toBe(150); })`.
14. **Verification:** `npm run test -- loan-history`.
15. **Residual risks:** a refund of interest from another year changes a past year's total (correct, but visible).

- Causality: `PRE_EXISTING_UNREPORTED`.

### A26-S15-06 - A loan owing exactly one minor unit is treated as paid off on both layers: the posting writes nothing, the schedule deactivates, the 0.01 stays owed and the account cannot be closed

1. **Severity:** LOW
2. **Confidence:** high (backend executed, R6; frontend executed by the sweep's probe H)
3. **Location:** `backend/src/loan-installments/price-installment.ts:769` (`debt <= 0.01` -> `paid-off`), `reprice-template.ts:154-178` (deactivates), settlement `debtBefore <= 0.01` -> `loan_debt_retired` (spec 7.2, `plan-loan-settlement.ts`); close refusal `accounts.service.ts:1300-1306`; frontend `frontend/src/lib/loan-schedule.ts:408, 539` with `PAYOFF_EPSILON = 0.01` (`loan-frequency.ts:83`).
4. **Violated invariant:** INV-LOAN-004 (the final payment retires the balance); the code's own comment in `bookLoanAllocation` says the threshold absorbs "a residue of less than one unit", and 0.01 is one whole unit.
5. **Reproduction:** a loan whose ledger owes 0.01 (a manual payment one cent short of the payoff) with an active bill.
6. **Observed (executed, R6):** the post claims 2026-08-01 with no transaction (`transaction_id` NULL), the schedule becomes inactive, the loan ledger stays **-0.01**; closing the account is refused (`closeNonZeroBalance`). A debt of 0.02 posts 0.02 (R6b). Frontend: balance 1,000 at 0 %, payment 999.99 -> one row, `paidOff: true`, `totalPaid` 999.99, balance 0.01.
7. **Expected:** a debt of 0.01 is owed: post 0.01 (+0.00 interest) and retire it; the projection adds a 0.01 row.
8. **Impact:** a loan that can never reach zero through the app without a hand-entered cent; the bill silently disappears.
9. **Root cause:** `<=` where the documented intent is `<` one minor unit; the frontend epsilon mirrors it.
10. **Recommended correction:** `debt < minorUnit / 2` (or `< 0.01`) on both layers and in the planner's `loan_debt_retired`.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/loan-installments/price-installment.ts
+++ b/backend/src/loan-installments/price-installment.ts
-  if (debt <= 0.01) {
+  // Less than one cent is a rounding residue; one whole cent is still owed.
+  if (debt < 0.01) {
--- a/frontend/src/lib/loan-schedule.ts
+++ b/frontend/src/lib/loan-schedule.ts
-  while (balance > PAYOFF_EPSILON && paymentNumber < maxPayments) {
+  while (balance >= PAYOFF_EPSILON && paymentNumber < maxPayments) {
```

   plus the planner's threshold and spec 7.2/E15 updated together (the spec states `<= 0.01`; Rule 2: the spec must change with the code). Needs: the 4dp-ledger residue case (`bookLoanAllocation` leaves < 0.01) still reading as paid off.
12. **Recommended regression test / 13. diff:** R6 as an integration case asserting a 0.01 posting and a zero ledger; `loan-schedule.test.ts` 1,000 / 999.99 asserting two rows.
14. **Verification:** the probe; `npm run test:unit -- price-installment plan-loan-settlement`; `npm run test -- loan-schedule`.
15. **Residual risks:** a JPY loan (0 decimals) needs the threshold in its own minor unit.

- Causality: `NEW_SINCE_UPSTREAM_AUDIT` for the posting `retired` decision; the frontend epsilon `PRE_EXISTING_UNREPORTED`.

### A26-S15-07 - The GEM signal-change alert is not bound to the current period and its dedupe memory is purged after the retention window, so an old change is announced, and announced again

1. **Severity:** LOW
2. **Confidence:** high (period: executed by the GEM sweep's `cx2` over the real `detectSignalChange`, re-read; purge: by reading)
3. **Location:** `backend/src/strategies/gem-signal-change-alert.service.ts:202-218` (`detectSignalChange` compares the two newest history entries whatever the current period's state), `:176` (dedupe key); `backend/src/notification-center/notification.service.ts:325-366` (`purgeOld` deletes read rows older than the retention window and dismissed ones; `gem:` is not in `STATE_KEYED_DEDUPE_PREFIXES`, `notification-bounds.ts:29-32`).
4. **Violated invariant:** INV-GEM-NOTIFY-002 (re-running the cron is a no-op per period) and INV-GEM-NOTIFY-003 (a non-evaluable current period is a no-op) of `docs/specs/gem-signal-change-notifications.md`.
5. **Reproduction:** (a) a strategy configured in October whose current period is not yet evaluable and whose two newest history rows differ (2026-08-31 RISK_OFF, 2026-07-31 RISK_ON). (b) a quarterly strategy: the 2026-09-30 risk alert is read on 10-01; about 11-01 the purge deletes it; the 09-30/06-30 pair is still the newest, so the next run inserts and sends it again (WARNING, push/email), and again a month later.
6. **Observed:** (a) `kind: "risk"`, key `gem:S:2026-08-31:risk` for a change two months old; (b) by reading, the insert succeeds once the row is purged.
7. **Expected:** silence in both cases.
8. **Impact:** repeated or stale "moved to risk-off" warnings; the recommendation shown is still the latest, so the harm is noise and a prompt to trade on a change already acted on.
9. **Root cause:** the producer reads "two newest rows" instead of "the current period and the one before it", and relies on a dedupe row the retention policy deletes.
10. **Recommended correction:** fire only when `current.evaluatedOn` is the report's current evaluable period (`report.signal?.evaluatedOn`), and keep `gem:` rows past retention like the bond state keys (or record the last notified period on the strategy row).
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/strategies/gem-signal-change-alert.service.ts
+++ b/backend/src/strategies/gem-signal-change-alert.service.ts
@@ export function detectSignalChange(
   if (periods.length < 2) return null;
   const [current, previous] = periods;
+  // INV-GEM-NOTIFY-003: only the current period's change, never an old one.
+  if (!report.signal || report.signal.evaluatedOn !== current.evaluatedOn) {
+    return null;
+  }
--- a/backend/src/notification-center/notification-bounds.ts
+++ b/backend/src/notification-center/notification-bounds.ts
 export const STATE_KEYED_DEDUPE_PREFIXES: readonly string[] = [
   "bond:unbooked:",
   "bond:missing:",
+  "gem:",
 ];
```

   Needs: the field name of the report's current signal checked against `GemStrategyReportView`; `bond-notification-events.ts:128` destructures the first two prefixes positionally and must not shift.
12. **Recommended regression test / 13. diff:** spec test-matrix items 5-8 (`gem-signal-change-alert.service.spec.ts`): no current signal plus two differing history rows -> no notify; a purge then a re-run -> no second notify.
14. **Verification:** `npm run test:unit -- gem-signal-change-alert notification`.
15. **Residual risks:** the spec's own pseudo-code reads "two latest" too (section 11).

- Causality: `NEW_SINCE_UPSTREAM_AUDIT`.

### A26-S15-08 - Loan Amortization Report: "Original Amount" double-counts projected principal when the opening balance is unset, and the CSV/PDF exports run while the history request has failed

1. **Severity:** LOW
2. **Confidence:** medium (Original Amount executed by the frontend sweep's probe N; exports by reading only)
3. **Location:** `frontend/src/components/reports/LoanAmortizationReport.tsx:290-295` (`Math.abs(openingBalance) || (totalPrincipal + currentBalance)`, where `totalPrincipal` already includes projected rows); exports `:340-387` with `ReportToolbarActions` given no `disabled` (`:497-501`).
4. **Violated invariant:** a figure is from one source (the history's `startingBalance`); INV-LOAN-HISTORY-001's failure response ("a FAILED read is unknown, not zero, and must not be rendered as a schedule").
5. **Reproduction:** opening balance unset, current 9,000, 1,000 paid: card shows **19,000.02**, expected 10,000.00. History fetch rejected: the CSV still writes a schedule of "Projected" rows from the account's own rate and payment and the PDF says "Payments Made 0".
6-8. **Observed / expected / impact:** as above; a wrong headline figure, and an export presenting a schedule the screen withholds.
9. **Root cause:** the fallback sums the whole table; the export handlers do not read `historyError`.
10. **Recommended correction:** `originalBalance = history.startingBalance` when the opening balance is unset; disable both exports while the history is in error.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
-    const originalBalance = Math.abs(selectedAccount.openingBalance) || (totalPrincipal + currentBalance);
+    const originalBalance =
+      Math.abs(selectedAccount.openingBalance) || history.startingBalance;
@@
-        <ReportToolbarActions onExportCsv={handleExportCsv} onExportPdf={handleExportPdf} />
+        <ReportToolbarActions
+          onExportCsv={handleExportCsv}
+          onExportPdf={handleExportPdf}
+          disabled={!!historyError}
+        />
```

   (names to be checked against the component's props.)
12-14. **Test:** `LoanAmortizationReport.test.tsx`: the probe-N fixture asserting 10,000.00; a rejected history asserting both exports disabled. `npm run test -- LoanAmortizationReport`.
15. **Residual risks:** none beyond the prop names.

- Causality: `PRE_EXISTING_UNREPORTED`.

### A26-S15-09 - The Post dialog previews the stored template's principal/interest split, while the post re-prices the same bill from the ledger and books a different split

1. **Severity:** LOW
2. **Confidence:** high (backend half executed, R2; frontend half by reading)
3. **Location:** `frontend/src/components/scheduled-transactions/PostTransactionDialog.tsx:456-474` (split rows pre-filled from `scheduledTransaction.splits`, the stored template), rendered at `:1182`; backend `scheduled-transactions.service.ts:3546-3636` (an unchanged echo re-prices through `resolvePostingAllocation`). The projection that prices the occurrence from the ledger exists (`GET /scheduled-transactions/:id/loan-occurrences`) and is read only by `OccurrenceDatePicker` and the override editor.
4. **Violated invariant:** "a preview computes what the commit will do, through the same code" (AGENTS.md); INV-LOAN-009's F2 reads the projection for a loan bill on the picker and the editor but not on the dialog that commits.
5. **Reproduction:** the R2 ledger: LOAN 200,000 at 6 %, the August installment posted (template rewritten for September to 997.50 interest / 502.50 principal), then a 10,000 principal-only payment on 2026-08-15. Open Post for 2026-09-01 and press Post without editing.
6. **Observed:** the dialog shows interest 997.50, principal 502.50; the ledger receives interest **947.50**, principal **552.50** (executed through the real `post()`, R2). The total (1,500.00) is the same.
7. **Expected:** the dialog shows 947.50 / 552.50 (the projection's first occurrence), or labels the lines as re-priced at posting.
8. **Impact:** the split the user confirms is not the split written (50.00 moved between interest and principal here); a user who types the shown figures back (a non-echo) posts the stale split deliberately.
9. **Root cause:** the dialog pre-fills from the template snapshot; the server's echo detection then replaces what was shown.
10. **Recommended correction:** pre-fill a loan bill's lines from `loan-occurrences` (count 1) as the picker does; keep the server's echo re-pricing as the backstop.
11. **Suggested remediation diff (illustrative, not applied):** in `PostTransactionDialog.tsx`, when `scheduledTransaction` pays a loan (the client already knows from `loanOccurrences` status `priced`), map the first occurrence's `lines` onto the split rows by `sourceSplitId` before `bookSplitRowsAtMinorUnit`; names to be checked against `types/scheduled-transaction.ts`.
12-14. **Test:** a dialog test with a template 997.50/502.50 and a projection 947.50/552.50 asserting the rows show the projection; `npm run test -- PostTransactionDialog`.
15. **Residual risks:** the projection is a read without the posting's lock; a payment committed between the dialog's read and the post still re-prices (server backstop).

- Causality: `NEW_SINCE_UPSTREAM_AUDIT` (the projection and the echo re-pricing are new). Overlap: S08 handed S19 the same dialog's amount pre-fill (`:433`); this finding is the loan-split half, for S19 to merge.

### A26-S15-10 - Loan payment setup accepts a source account in another currency and writes a bill in the loan's currency on it; every posting of that bill is refused

1. **Severity:** MEDIUM
2. **Confidence:** high for the posting refusal (executed); medium that the setup path reaches it (by reading: no currency check found)
3. **Location:** `backend/src/accounts/loan-payment-setup.service.ts:227-237` (source account checked for ownership only), `:488-505` (schedule created on `dto.sourceAccountId` with `currencyCode: account.currencyCode`, the loan's); `scheduled-transactions.service.ts:960-975` (`create` stores the DTO's `currencyCode`; `resolveScheduleFx` only reads `originalCurrencyCode`); the refusal at posting `common/fx-entry.util.ts:205` through `transactionsService.create`; the create paths in `loan-mortgage-account.service.ts:290, 533` pass the same currency (not traced to their source-account check). Frontend: no currency filter on the setup dialog's source account (`LoanPaymentSetupDialog.tsx`, searched).
4. **Violated invariant:** "a currency code is derived from the account, never accepted from the request" (`assertTransactionCurrencyMatchesAccount`); a schedule that can never post is the state INV-LOAN-006's fail-safe text calls the worst outcome ("a bill that never posts again").
5. **Reproduction:** a EUR mortgage (or a CHF one, common for Polish borrowers) paid from a PLN current account: set up payments with the PLN account as source.
6. **Observed (executed, `zz-s15-fx`, the setup's shape: schedule currency EUR on a PLN account, transfer split to the EUR loan):** `post()` answers **400 "Transaction currency EUR must match the account currency PLN. Use originalAmount and originalCurrencyCode for a foreign-currency entry."**; nothing written, no claim, cursor unchanged; every auto-post tick fails the same way (the cron raises an alert for a non-conflict error).
7. **Expected:** the setup refuses a source account in another currency with a message naming both currencies, or builds a cross-currency transfer bill the posting can convert (a decision: the settlement path already refuses `transfer_currency_mismatch`, spec section 11 row 8, so refusing is consistent).
8. **Impact:** the loan's payments are never booked by the app; the user learns it only from the posting error or the alert, after the setup reported success.
9. **Root cause:** the setup validates ownership but not currency, and the schedule create trusts the DTO's currency.
10. **Recommended correction:** refuse in `setupLoanPayments` (and the account-create paths) when `sourceAccount.currencyCode !== account.currencyCode`, before any write; independently, make `ScheduledTransactionsService.create` derive or verify `currencyCode` against the schedule's account.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/accounts/loan-payment-setup.service.ts
+++ b/backend/src/accounts/loan-payment-setup.service.ts
@@
     if (!sourceAccount) {
       throw new BadRequestException(
         tr("errors.accounts.sourceNotFound", "Source account not found"),
       );
     }
+    // The bill is booked on the source account in the loan's currency; a
+    // posting refuses a currency the account does not hold.
+    if (sourceAccount.currencyCode !== account.currencyCode) {
+      throw new BadRequestException(
+        tr(
+          "errors.accounts.loanSourceCurrencyMismatch",
+          `The payment account is in ${sourceAccount.currencyCode} and the loan in ${account.currencyCode}. Choose an account in ${account.currencyCode}.`,
+          { source: sourceAccount.currencyCode, loan: account.currencyCode },
+        ),
+      );
+    }
```

   Needs: the i18n key; the same check on the create paths; a decision whether cross-currency loan payment is a feature to build (then an FX transfer template, which INV-LOAN-006's pricing would have to price in two currencies).
12-14. **Test:** a `loan-payment-setup.service.spec.ts` case with a PLN source and a EUR loan asserting the refusal and no schedule written; the `zz-s15-fx` probe as an integration case for the posting side. `npm run test:unit -- loan-payment-setup`.
15. **Residual risks:** existing schedules already in this state stay unpostable until edited (a data question for the maintainer).

- Causality: `PRE_EXISTING_UNREPORTED` (setup predates the new modules; not provable in the shallow clone).

## 5. Prior-finding dispositions

| ID | Disposition | Evidence |
| --- | --- | --- |
| MON-M32 | **FIXED_VERIFIED** | Mechanism: the posting re-resolves the occurrence (`resolvePostingAllocation`, `scheduled-transaction-loan.service.ts:189-257`) and `post()` re-sums the parent from the resolved lines (`scheduled-transactions.service.ts:3509-3514` base splits, `:3631-3633` dialog echo); `allocateLoanPayment` clamps principal to the dated debt; the template rewrite writes the parent as `allocation.total` (`reprice-template.ts:256-266`). Executed: the upstream example (regular 100.00, debt 40.00, 0 %) through the real `post()` posts parent **-40.00** with lines -40.00 / 0.00, ledger 0.00, schedule deactivated (R11); 6 % payoff 1,000.00 posts 1,005.00 = 1,000.00 + 5.00 (R4). Tests: `scheduled-transaction-loan.service.spec.ts:407-460` ("final installment (P5-008)"), `loan-payment-waterfall.util.spec.ts:73` and `:217-263`. Mutation M1 (drop the parent re-sum) is caught by the unit suite (2 failures) and by the probe (2 failures). Residual outside the original finding: a declined (escrow) template still posts its stored principal past the debt (section 9, D5), and an exactly-0.01 debt is not paid (A26-S15-06). |

## 6. Mutation table

All in the scratch worktree at the baseline, each reverted with `git checkout` before the next.

| # | Invariant | Mutation (file:line, what) | Test that fails | Verdict |
| --- | --- | --- | --- | --- |
| M1 | INV-LOAN-004 / MON-M32 | `scheduled-transactions.service.ts:3512-3514` drop the parent re-sum after a re-resolved allocation | `scheduled-transactions.service.spec.ts` (2 of 597 in `src/scheduled-transactions`); probe R4/R11 (2 of 6) | covered (unit) |
| M2 | INV-LOAN-006 | `price-installment.ts:755` price the debt through `9999-12-31` instead of the installment's date | `src/loan-installments` + `scheduled-transaction-loan` (2 of 395); `scheduled-loan-dated-balance`/`dated-loan-payment` (4 of 15) | covered |
| M3 | INV-LOAN-008 cursor | `claim-loan-occurrence.ts:178` advance past the claimed slot only (`new Set([before.nextDueDate])`) | `claim-loan-occurrence.spec.ts` (1 of 7); `loan-settlement-claim` + `imported-settlement-flow` integration: 17 of 17 **pass** | covered (unit only; no real-database case of a consecutive claim) |
| M4 | INV-LOAN-010 | `accounts.service.ts:1170` drop `applyLoanInterestRelink` | `accounts.service.spec.ts` (1 of 274); `loan-interest-relink` (2 of 4) | covered |
| M5 | INV-LOAN-004 waterfall | `loan-payment-waterfall.util.ts:67` drop the interest cap | 2 of 181 (`loan-payment-waterfall`, `price-installment`, `scheduled-transaction-loan`) | covered |
| M6 | GEM settled boundary | `gem-momentum.util.ts:228` drop the "no close at or after the boundary yet" deferral | `src/strategies` (2 of 375); `gem-price` integration 14 of 14 pass | covered (unit) |
| M7 | INV-LOAN-004 one-cent boundary | `price-installment.ts:769` `debt <= 0.01` -> `debt < 0.01` (the direction A26-S15-06's fix takes) | none: `src/loan-installments`, `scheduled-transaction-loan`, waterfall (411 of 411) and `scheduled-loan-dated-balance`/`loan-settlement-debt` (12 of 12) all pass | undetected: no case pins the 0.01 boundary in either direction (finding A26-S15-06) |
| M8 | INV-LOAN-007/010 on undo | (baseline defect, A26-S15-01) `action-history.service.ts:1741-1764` | none: every suite green at the baseline, the probes show the defect | undetected (finding) |
| M9 | INV-LOAN-006 below-interest | (baseline behaviour, A26-S15-04) `loan-payment-waterfall.util.ts:66-69` | no test asserts the unpaid interest | undetected (finding) |

## 7. Counterexamples and the interaction scenario

### 7.1 The loan matrix

LOAN 200,000.00 at 6.00 % nominal, monthly (periodic 0.005), payment 1,500.00, template 500.00 principal + 1,000.00 interest, unless the row says otherwise. "Executed" means the real `ScheduledTransactionsService.post()` against PostgreSQL (`zz-s15-probe`, section 1); every figure below is the probe's output.

| # | Row | Worked example | Result | Status |
| --- | --- | --- | --- | --- |
| R1 | Normal payment | debt 200,000.00 x 0.005 = 1,000.00 interest; 1,500.00 - 1,000.00 = 500.00 principal | posted -1,500.00 = -1,000.00 / -500.00; loan 199,500.00; template for 09-01: 997.50 / 502.50 | executed; also `scheduled-transaction-loan.service.spec.ts`, spec 9.2 A1/A6 |
| R2 | Principal-only extra payment | +10,000.00 on 08-15; 09-01 debt 189,500.00 x 0.005 = 947.50; principal 552.50 | posted 947.50 / 552.50; loan 188,947.50 | executed; covered by `scheduled-loan-dated-balance` (dated debt) |
| R3 | Payment below accrued interest | LOAN 400,000.00: interest 2,000.00 > payment 1,500.00 | posted 1,500.00 interest / 0.00 principal twice; loan stays 400,000.00; 500.00 per period recorded nowhere | executed; **A26-S15-04** |
| R4 | Payoff | debt 1,000.00: interest 5.00, principal min(1,495.00, 1,000.00) = 1,000.00 | posted -1,005.00 = -1,000.00 / -5.00; loan 0.00; schedule inactive | executed; covered (spec E4, waterfall spec) |
| R5 | One cent above payoff | debt 1,000.01: interest roundMoney(5.00005) = 5.0001 -> booked 5.00; principal 1,000.01 | posted -1,005.01; loan 0.00; schedule inactive | executed |
| R6 | One cent below payoff | a payment leaving 0.01: debt 0.01 | no transaction, claim with `transaction_id` NULL, schedule inactive, loan **-0.01** forever | executed; **A26-S15-06**; 0.02 posts 0.02 (R6b) |
| R7 | Rate change | `loan_rate_changes` 7.20 % from 07-15; 08-01: 200,000.00 x 0.006 = 1,200.00, principal 300.00; 09-01: 199,700.00 x 0.006 = 1,198.20 | posted 1,200.00 / 300.00 then 1,198.20 / 301.80; template for 10-01 1,196.3892 / 303.6108; `accounts.interest_rate` untouched | executed; covered by `dated-loan-payment` |
| R8 | Same-day multiple payments | +10,000.00 dated 10-01, then the 10-01 installment: debt 178,947.50 x 0.005 = 894.74 | posted 894.74 / 605.26; excluding the same-day row it would be 944.74 / 555.26 (50.00 apart) | executed; inside the spec's definition (inclusive bound), **D1** |
| R9 | Voided payment | void the 08-01 posting, then post 09-01 | loan back to 200,000.00; 09-01 priced on it: 1,000.00 / 500.00; the 08-01 claim stays (void keeps it), so August is never re-billed | executed; claim retention per spec 12.5 (**D3**) |
| R10 | Duplicate posting | a second `post()` of 09-01 with the same pin | 409 "This occurrence has already been posted."; ledger unchanged | executed; the unpinned duplicate is A26-S08-01 (S08) |
| R11 | Final payment parent vs splits (MON-M32) | 0 %, payment 100.00, debt 40.00 | parent -40.00, lines -40.00 / 0.00 | executed |

Settlement rows (spec 9.1-9.3) are covered by `plan-loan-settlement.spec.ts` (1,780 lines, the spec's fixtures row by row, computed independently of the implementation per the spec) and were read, not re-executed: one cent above a payoff (paid 1,005.01 on debt 1,000.00) lands as `tolerance` on interest (5.01); 1,005.06 is `installment_amount_excess` (1,000.00 + 0.06 > 1,000.00); a row below the interest under `interest_first` books interest = paid and principal 0 (the A26-S15-04 surface on the settlement path).

### 7.2 Further counterexamples (not copied from the suites)

| Invariant | Counterexample | Outcome |
| --- | --- | --- |
| INV-LOAN-007 | ANNUITY -> LINEAR -> Undo | 1,333.33 billed on a 1,108.86 annuity (A26-S15-01) |
| INV-LOAN-010 | category A -> B -> Undo | template unmanaged (A26-S15-01) |
| GEM one session | an 8-trading-day feed gap before month end, feed resumed after | wrong target stored (A26-S15-02) |
| INV-TRANSFER-001 in history | a bounced (VOID) installment | counted as paid (A26-S15-03) |
| net within a category | an interest refund | added, not netted (A26-S15-05) |
| preview = commit | extra principal between two installments, Post dialog unedited | shown 997.50/502.50, written 947.50/552.50 (A26-S15-09) |

### 7.3 Interaction scenario

A26-S15-01(a) x payment matching (INV-LOAN-008) x A26-S08-03. A mortgage with a `settle_loan_installment` rule has `auto_post = false` (spec 12.7), so its bank rows, not the bill, drive the ledger: after the ANNUITY -> LINEAR -> Undo sequence the settlement prices each bank row at the slot's dated payment (purpose `settlement`, 1,108.86 from `accounts.payment_amount`), books it `exact`, and the ledger stays right while the bills page shows 1,333.33 due. A bill-driven mortgage (no rule) posts 1,333.33 each month. So A26-S15-01's money impact falls on bill-driven loans, its display impact on both; and if the user, seeing 1,333.33 "due", posts the bill by hand on a rule-driven loan whose bank row for that month already settled the slot, the post is refused 409 (claim taken) -- unless the rule settled the NEXT slot early (A26-S08-03's shape), in which case the hand post pays the cursor slot at 1,333.33 and the cursor lands on the claimed slot and sticks. Each mechanism is correct alone; the stale template is what turns the claim protocol's refusals into a confusing "already posted" on a bill the page shows as due. Executed halves: A26-S15-01 (probes), the claim refusal (R10); the combination is reasoned.

## 8. Rejected hypotheses

| Candidate | Evidence considered | Why rejected or downgraded | Final classification |
| --- | --- | --- | --- |
| MON-M32 still open | upstream P5-008 example | executed through the real `post()`: parent -40.00 = lines (R11) | REJECTED (FIXED_VERIFIED) |
| S08 hand-off: slot selection should prefer the cursor's unpaid slot | `selectOccurrenceSlot` (`occurrence-slots.ts:256-288`), spec 6.2 step 3 and truth table rows 10-12 | nearest-then-earlier is the spec's deliberate rule (Rule 2); with the default window 3/7 (`rule-action.types.ts:150`) a monthly cursor slot and the next slot are never both candidates; with a wide window (up to 31/31, `transaction-rules.limits.ts:35`) a late payment can be matched to the next slot, which only becomes harmful through A26-S08-03's cursor defect. The fix belongs in `post()` (A26-S08-03's diff), not in the selection | DESIGN_RISK (D2), feeds A26-S08-03 |
| S09 hand-off: a doubled MNY import re-settles an occurrence through a structural rule (INV-LOAN-008) | planner rows 14-15 (`plan-loan-settlement.ts:280-302`): claims read under the schedule lock, `occurrence_already_posted` | the duplicate row's window (3/7) contains only the slot the original already claimed, so the duplicate is refused `occurrence_already_posted` and stays a plain debit (A26-S09-01's double cash only). Only a window wide enough to reach the next slot (about 28+ days for monthly) settles it as the next installment | REJECTED at the default window; DESIGN_RISK for wide windows (D2) |
| S10 hand-off: what deleting a duplicate settled row undoes | spec 12.5; `transaction_id ... ON DELETE CASCADE`; `loan-settlement-claim` "delete releasing the claim" | delete releases the claim in the same statement; the cursor is deliberately not rewound; for a rule-driven loan the next real bank row settles the freed history slot (nearest unclaimed in window), so nothing is lost; for a bill-driven loan the advanced cursor skips the freed slot with no signal | PRE_EXISTING (documented decision), D4 |
| A26-S07-02 for loan accounts mis-prices installments | `datedLoanDebt` reads `ACCOUNT_BALANCE_AS_OF_SQL` (opening balance + ledger), never `current_balance` | a restored stale `current_balance` cannot reach pricing; the loan-specific damage of the same undo function is A26-S15-01 | REJECTED for pricing; superseded by A26-S15-01 for the loan columns |
| GEM converts prices before computing momentum | `docs/gem-strategy.md:311-312`, `gem-report.types.ts:262-268` | native-currency momentum is the documented design; the hint's "converted prices" is not the contract | DESIGN_RISK (D6) |
| GEM position valuation uses rate 1 for a missing rate | `gem-position.service.ts:356-385` (sweep, read) | 1 only for the same currency; a missing rate is null; `getLatestRate(..., 14)` is a listed exception in `fx-rate.one-door.spec.ts` (INV-FX-001 partial, S13's) | REJECTED (S13 owns the FX door) |
| GEM incomplete signal fires an alert | sweep Q3 | RISK_OFF without EM is documented and tested; the real alert defect is the period binding (A26-S15-07) | REJECTED |
| Rate-change sync applies something other than its preview | `applyScheduledPaymentSync` re-plans in its own transaction (`loan-rate-changes.service.ts:319-330`) | the plan is one function for both; a ledger move between preview and confirm changes the applied figure, and the response returns what was applied; no expectation is passed down | DESIGN_RISK (D7) |
| Two loans sharing one interest category merge on the SPLIT path | sweep probe F | real, but it is the index's own known gap widened, not a new mechanism | documentation (section 11, D-2) |
| Lump sum on a non-amortizing loan yields no projection (frontend probe I) | `loan-schedule.ts:451-455` refuses before lump sums apply | the refusal is INV-LOAN-004's "-1 when the installment never amortizes"; a plan that would rescue it is an edge of the projection, not a wrong figure | DESIGN_RISK (D8) |
| Same-day multiple payments double count interest in history | sweep probe D: each date's interest used once | no double count; attribution depends on API order (same-date rows) | DESIGN_RISK (D9) |

## 9. Design risks

- **D1 Same-day prepayment priced into that day's installment.** `datedLoanDebt` is inclusive of the installment's date (INV-LOAN-006 by definition), so a principal payment dated on the due date reduces that installment's interest: R8, 894.74 instead of 944.74 (50.00) for a 10,000.00 prepayment at 0.5 % a period. A lender accruing to the due date charges the period on the balance before the prepayment. The spec should say which convention it means and why; a row dated the same day as the occurrence is the boundary.
- **D2 Nearest-slot selection with a wide window** can attribute a late payment to the next slot (and a duplicate bank row, A26-S09-01 / A26-S10-01, to the next installment), which A26-S08-03 turns into a stuck cursor.
- **D3 VOID keeps a `post()` claim.** A bounced installment (R9) is never re-offered; the spec states this for rule claims (12.5) and the index lists it in INV-LOAN-008's tests; for a bill-driven loan the user must post the missed installment by hand with no prompt.
- **D4 Delete releases a claim but not the cursor** (spec 12.5): a bill-driven loan silently skips the freed slot.
- **D5 A declined template (escrow, tax, insurance line) posts its stored lines on the final installment**, so its principal line overpays the debt and pushes the loan into credit; documented as the deliberate fail-safe of INV-LOAN-006 "Scope", but no surface warns at the final installment.
- **D6 GEM momentum in listing currency.** A US fund in USD +10 % and an ex-US fund in EUR +8 % with EUR +5 % against USD: in USD the ex-US fund is +13.4 % and should win. Documented in the types and `docs/gem-strategy.md:311-312`, not in the Rules section; the settings form warns about cost, not comparability.
- **D7 Rate-change sync applies a re-plan**, not the confirmed preview (no revision passed down).
- **D8** a lump sum that would make a non-amortizing loan amortize is refused before it applies (frontend projection).
- **D9** same-date history attribution depends on the API's order (sweep probe D: `observedInstallment` 1,000 complete vs 800 incomplete for the same data).
- **D10 A retired schedule is not reactivated** when the final payment is later voided or deleted (the deactivation in `reprice-template.ts:175-178` has no inverse); the loan owes again with no bill.

## 10. Missing tests and known-wrong tests

- No integration test runs the real `post()` for any loan matrix row (the harness stubs the scheduled module; `scheduled-loan-pricing-concurrency.integration.spec.ts:36-46` says so); the `zz-s15-probe` construction is the recipe (joins A26-S08-05 / MON-M46).
- No real-database case of a settlement claim stepping past a consecutive claimed slot (M3 survives every integration suite).
- No test of an account-edit undo on a loan (A26-S15-01), of the below-interest shortfall (A26-S15-04), of a 0.01 debt (A26-S15-06).
- GEM: no case with a role's feed gap before the boundary (A26-S15-02); the alert's `run`/`evaluateUser`/`evaluateStrategy` and spec test-matrix items 5-8 are untested (A26-S15-07); `latestPrices` with a stored close of 0 (the sweep: valued at 0 rather than unknown, LOW, not raised as a finding here because every valuer in the app shares it; S12/S13).
- Frontend loan history: VOID payment and VOID interest, refund rows paired and orphan, future-dated payment against the projection, a shared category across two loans in one parent, an exact split plus a paired standalone expense on one date (the expense is silently dropped, sweep probe E: 200 shown, 215 booked), export while `historyError` is set, Original Amount with an unset opening balance.
- No test of a loan payment setup with a source account in another currency (A26-S15-10).
- Known-wrong: `loan-history.test.ts:2058` pins the overpayment-takes-the-interest variant of a same-day pair (D9), which is order-dependent.

## 11. Documentation inconsistencies

- **D-1** `sessions.md` (S15) and the plan name INV-LOAN-001..011; the index has INV-LOAN-001..010 plus INV-LOAN-HISTORY-001; there is no INV-LOAN-011.
- **D-2** INV-LOAN-HISTORY-001 (`docs/system-invariants.md:3171-3180`): "the provenance of a SPLIT-recorded interest line is enforced" is false when one parent pays two loans whose interest lines share a category (`readRecordedInterest`, `loan-history.ts:1256-1263`; sweep probe F: 300 shown, 200 correct); "no reader branches on `interest_booking_mode`" is false on the backend (`loan-payment-detector.service.ts:280,286`, `plan-loan-settlement.ts:231`, `rule-loan-settlement.ts:165`), and the layers disagree for a SPLIT loan (the backend detector refuses to pair standalone expenses, the frontend history pairs them). Same stale sentence in `docs/frontend/financial-figures.md:198`.
- **D-3** INV-LOAN-HISTORY-001 does not mention VOID, refund or future-dated rows (A26-S15-03, -05).
- **D-4** `docs/specs/gem-signal-change-notifications.md:3` says "proposed, awaiting maintainer approval" while the cron is implemented and registered (`docs/cron-jobs.md:44`); its INV-GEM-NOTIFY-001..005 are not in `docs/system-invariants.md`; its producer pseudo-code (section 4) reads "two latest" rows, the same shape as A26-S15-07(a).
- **D-5** `docs/gem-strategy.md:24-25` says the benchmark is "US equity leg or the safe asset"; the code uses `benchmarkRoleFor` (risk-free when assigned), as the same document says at lines 197-198. `docs/gem-strategy.md:552-562` presents the settled-boundary rule as complete; it does not cover a gap just before the boundary (A26-S15-02). `frontend/src/types/gem-strategy.ts:82` says "Trailing 12-month" for a configurable lookback.
- **D-6** `docs/frontend/financial-figures.md:171` places `resolveEffectiveLoanTerms` in `lib/loan-schedule.ts`; it is defined in `lib/loan-comparison.ts:129`.
- **D-7** `bookLoanAllocation`'s comment (`loan-payment-waterfall.util.ts:113-119`) says a residue "of less than one unit" reads as paid off; the threshold it names (`debt <= 0.01`) includes one whole unit (A26-S15-06); `docs/specs/loan-installment-settlement.md` 7.2 and E15 state `<= 0.01`.
- **D-8** INV-LOAN-006's statement "the interest ... is roundMoney(debt x periodic rate)" does not mention the cap at the installment (A26-S15-04).

## 12. Review ledger

- **Revision:** pinned at `AUDIT_BASELINE_SHA` (empty diff outside the audit directories); HEAD at start `1c0cbcfa`; report commits on `ccr-1f689e5c-onia07`.
- **Directories inspected:** `backend/src/loan-installments/`, `loan-rate-changes/` (sampled), `loan-scenarios/` (controller and service ownership sampled), `strategies/` (through the sweep, verified for the findings), `scheduled-transactions/` (the loan service in full; `post()` `:2862-3768` in full), `accounts/` (waterfall, dated debt, update relink and reprice), `action-history/` (undo dispatch and `undoSimpleEntity`), `notification-center/` (purge); frontend `lib/loan-history.ts`, `lib/loan-schedule.ts`, `components/reports/LoanAmortizationReport.tsx`, `hooks/useLoanProjection.ts`, `components/scheduled-transactions/PostTransactionDialog.tsx` (pre-fill only).
- **Files read in full:** `scheduled-transaction-loan.service.ts`, `price-installment.ts`, `reprice-template.ts`, `claim-loan-occurrence.ts`, `occurrence-slots.ts`, `loan-payment-waterfall.util.ts`, `dated-loan-debt.util.ts`. **Sampled:** `plan-loan-settlement.ts:120-420`, `scheduled-transactions.service.ts:2862-3768` (post), `action-history.service.ts:160-212, 560-610, 1727-1770`, `accounts.service.ts:1020-1050, 1120-1230`, `loan-rate-changes.service.ts:319-370`, `gem-momentum.util.ts:180-240`, `price-boundary.util.ts:30-100`, `gem-signal-change-alert.service.ts:150-220`, `notification.service.ts:320-370`, `notification-bounds.ts:20-40`, `loan-history.ts:1240-1316, 1530-1560`, `LoanAmortizationReport.tsx:290-297`, `loan-schedule.ts:405-410`; specs as in section 3; the frontend sweep read `loan-history.ts`, `loan-schedule.ts`, `LoanAmortizationReport.tsx`, `useLoanProjection.ts` in full; the GEM sweep read the strategies module's services in full (its file list is in its report, summarized in section 3).
- **Searches:** `resolvePostingAllocation|recalculateLoanPaymentSplits|bookTemplateAtMinorUnit|retired` in the scheduler; `daysBefore|daysAfter|MAX_LOAN_SETTLEMENT_WINDOW_DAYS`; `ALLOWED_COLUMNS` accounts; `applyLoanInterestRelink|repriceLoanTemplate|planLoanInterestRelink`; `VOID|status` in `loan-history.ts`; `statuses` in `transactions.service.ts`; `STATE_KEYED_DEDUPE_PREFIXES`; `loanOccurrences` consumers in the frontend; `@UseGuards|ParseUUIDPipe|req.user.id` in the two loan controllers; `currency` in the loan setup and pricing.
- **Suites run:** baseline integration 11 suites / 71 passed (section 1); `src/strategies` unit 375 passed; frontend loan vitest 351 passed; probes R1-R11, the two undo probes, the cross-currency probe, the GEM spec; mutations M1-M7 (section 6).
- **Finding counts:** BLOCKER 0, HIGH 1 (A26-S15-01), MEDIUM 4 (A26-S15-02, -03, -04, -10), LOW 5 (A26-S15-05, -06, -07, -08, -09).
- **Areas reviewed without a finding:** the posting boundary's lock order and re-resolution on both branches; the claim INSERT and its backstop; the rate timeline (dated, 0 % distinct from unknown on the settlement path); the waterfall's clamp order; the minor-unit booking never retiring more than the debt; LOC exemption from deactivation; loan controllers' auth; the settlement amount policy (read against spec section 8).
- **Text for the ledger (orchestrator merges):**
  - Session status: S15 done; findings B/H/M/L 0/1/4/5; verdict REQUEST CHANGES.
  - Prior findings disposed (final): MON-M32 FIXED_VERIFIED (R11 through the real `post()`, M1 covered).
  - Suites: baseline integration 11 suites 71 passed (loan*, mortgage*, gem-price, settlement, fold); `src/strategies` unit 375 passed; frontend loan vitest 351 passed; probes `zz-s15-probe` (R1-R11), `zz-s15-undo`, `zz-s15-undo2`, `zz-gem` in a scratch worktree; mutations M1-M7; `zz-s15-fx` (cross-currency bill).
  - Undetected mutations: `INV-LOAN-008 | claim-loan-occurrence.ts:178 advance past the claimed slot only | a real-database consecutive-claim case | S15` (unit-only); `INV-LOAN-007/010 | action-history.service.ts:1741-1764 undo writes coupled loan columns (baseline defect A26-S15-01) | an account-undo integration case | S15`; `INV-LOAN-006 | loan-payment-waterfall.util.ts:66-69 unpaid interest dropped (A26-S15-04) | an unpaidInterest assert | S15`; `INV-LOAN-004 | price-installment.ts:769 <= 0.01 -> < 0.01 | a 0.01-debt case | S15`.
  - Open hypotheses handed on: to S19, A26-S15-09 (Post dialog loan split) merges with S08's `PostTransactionDialog.tsx:433` item, plus `AccountForm.tsx:427` (`account.interestRate || undefined` loads a stored 0 % as empty; the sweep, not executed) and `LoanPaymentSetupDialog.tsx:624` (`detected?.estimatedInterestRate && ...` renders a literal 0); to S20, A26-S15-03/-05/-08 surfaces in the report UI and the `loan-past-impact.ts:203-212` "interest already saved" for a loan whose interest is booked outside the app (measured 0 subtracted, not executed); to S12/S13, `GemPriceService.latestPrices` accepts a 0 close (valued 0, not unknown) and GEM valuation's undated `getLatestRate(..., 14)` (INV-FX-001 partial); to S21, the real-`post()` harness (A26-S08-05) and M3; to S17, none; to S23, A26-S15-01 and A26-S07-02 share `undoSimpleEntity` (consolidate the remediation, keep the two invariants).
  - Deviations: two read-only sweep agents (GEM, frontend history) were used for breadth; every finding they proposed that is reported here was re-verified by reading and, where marked, re-executed (GEM momentum) or executed by the agent's probe over the real function (frontend, marked per finding). Report written by S15 only; ledger, sessions and register left to the orchestrator.

## 13. Adversarial approval challenge

Assumption: "the loan slice can be approved once the posting boundary is proven". Started from the slice's own abstractions rather than the findings:

- **`LoanPostingDecision` (three answers).** Producers: `resolvePostingAllocation` only. Consumers: both `post()` branches (`:3501`, `:3619`). `retired` writes a claim with `transaction_id` NULL that no deletion can release, and the post-commit rewrite then deactivates the schedule; nothing reactivates it when the final payment is later voided (D10). The one-cent edge of `paid-off` is A26-S15-06.
- **`InstallmentPurpose` (five purposes).** Searched every caller of `resolveInstallmentCore` / `priceInstallment` (`reprice-template.ts:86`, `scheduled-transaction-loan.service.ts:570`, `plan-loan-settlement.ts:347`, the projection). Each purpose's payment rule matches spec 7.2; the `posting` purpose keeps the template amount, which is what makes a stale template (A26-S15-01(a)) post the wrong total -- the challenge found the undo path as the producer of a stale template no reprice follows.
- **Server-authoritative currency.** The pricing never reads a currency; the posting trusts the schedule's. Searching who writes a loan schedule's `currencyCode` found the setup path's unchecked source account (A26-S15-10, executed).
- **Identity of a claim.** `(schedule, original_due_date)` plus `transaction_id`; void keeps, delete releases; checked against R9 and spec 12.5 (D3, D4).
- **Legacy / mixed data.** A loan with no `scheduled_transaction_id` falls back to "any active schedule paying the loan" (`scheduled-transaction-loan.service.ts:350-373`); a standalone extra-principal schedule can then anchor the report only when the pointer is null (documented in the code); not raised.
- **Performance.** `projectLoanOccurrencesMany` loops schedules inside one transaction with one debt statement per schedule; bounded by the count DTO; no amplification found.
- **Stale client.** The Post dialog's echo detection compares exact amounts; a dialog opened before a template rewrite sends the old template, which is no longer an exact echo of the locked template and so posts as the user's own figures (the stale split); the dialog half is A26-S15-09, the stale-echo half joins S08's hand-off to S19.
- **GEM.** From `spanCloses` and the materializer: A26-S15-02; from the alert's dedupe and the purge: A26-S15-07.

What the challenge did not reach: the rule-run undo (`rule-run-undo.ts`) beyond its tests (the `loan-settlement-claim` integration suite passed); the loan-scenarios write path beyond ownership; the MCP/AI tools reading loan figures (S17); the E2E loan flows.

Result: the challenge added A26-S15-10 and D10 and confirmed that A26-S15-01 is reachable from an ordinary UI action. APPROVE is not reachable for the slice.

## 14. Verdict

**REQUEST CHANGES** for the slice: one HIGH (A26-S15-01) survives, executed; four MEDIUM (A26-S15-02 GEM session, -03 VOID/future rows in loan history, -04 unpaid interest, -10 cross-currency loan bill) and five LOW. MON-M32 is fixed and verified. The posting boundary, the claim and the pricing core hold on every matrix row except the two boundaries reported (below-interest shortfall, the one-cent debt).
