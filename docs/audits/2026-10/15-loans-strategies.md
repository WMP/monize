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
| Status | in-progress (see section 12 for what remains) |
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
| Server-authoritative metadata | ran: the loan, its debt, rate and payment are read server-side; `userId` from JWT on both loan controllers (`@UseGuards(AuthGuard("jwt"))`, `ParseUUIDPipe` on every `:id` / `:accountId`). No finding. |
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
| Mutation | in progress (section 6). |
| Counterexample / interaction | ran (section 7). |
| Adversarial approval challenge | pending (section 13). |

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
