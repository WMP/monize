# Loan installment settlement

Design for settling an imported bank debit against a mortgage or loan
installment through a typed rule action: the Rules Engine matches the row,
the loan core prices the installment for the occurrence it pays, the existing
split writer books it, and the occurrence is claimed in
`scheduled_transaction_postings` in the same database transaction. The task
list is [`loan-installment-settlement-tasks.md`](./loan-installment-settlement-tasks.md).
The financial rules, truth tables and fixtures are in the spec,
[`docs/specs/loan-installment-settlement.md`](../specs/loan-installment-settlement.md);
this plan says what to edit, in what order, and what to run, and defers to
the spec on every number and every refusal.

Status: **implemented**, approved in discussion #1486 (with the architecture
review by WMP attached to the thread), tracked by issue #1589. Each task was
a sub-issue (#1590 to #1602), one PR each; Q, the acceptance task, closes
the feature.

## 1. Goal

- A bank row such as ING NL's monthly mortgage debit becomes a split: a
  principal transfer to the loan, an interest category line, and an
  extra-principal transfer when the row paid more, priced by the installment
  engine for the slot it pays (spec sections 7 and 8).
- The Scheduled Bill occurrence is marked settled through the claim's unique
  occurrence index, so a later post of it is refused, and the bill moves on
  (spec sections 4.1 and 12).
- It works for imported history ("Process history", oldest first) and for
  every later import, create and bank sync.
- Creating a mortgage, or setting up payments on an existing loan, creates the
  rule, visible and editable in Tools > Rules.

## 2. What exists, and what this composes

| Need | Existing piece | Notes |
| --- | --- | --- |
| One pricing path | `ScheduledTransactionLoanService.resolveInstallment` (`backend/src/scheduled-transactions/scheduled-transaction-loan.service.ts`, private) | `datedLoanDebt`, `effectiveAnnualRateOn`, the type-keyed periodic rate, `methodPrincipal`, `allocateLoanPayment`, `bookLoanAllocation` (INV-LOAN-006, INV-LOAN-007). B2 extracts it. |
| The waterfall and booking | `allocateLoanPayment`, `bookLoanAllocation` (`backend/src/accounts/loan-payment-waterfall.util.ts`) | Reused unchanged. |
| The dated debt | `datedLoanDebt` (`backend/src/accounts/dated-loan-debt.util.ts`) | B3 adds a batched form over many dates. |
| The method principal and its terms | `methodPrincipal`, `nonAnnuityInstallment`, `missingMethodTerms` (`backend/src/accounts/mortgage-installment.util.ts`) | Reused. |
| Minor units | `currencyMinorUnitDecimals`, `bookSplitsAtMinorUnit` (`backend/src/common/currency-minor-unit.util.ts`) | The tolerance is in these units. |
| Occurrence identity | `scheduled_transaction_postings`, unique `(scheduled_transaction_id, original_due_date)` (`idx_stp_occurrence`); `ScheduledTransactionPosting` (`backend/src/scheduled-transactions/entities/scheduled-transaction-posting.entity.ts`) | No `transaction_id` today. B1 adds the claim columns. |
| The cursor advance | inline in `ScheduledTransactionsService.post()` (`backend/src/scheduled-transactions/scheduled-transactions.service.ts`) | B2 extracts `advanceScheduleCursor`; `post()` keeps calling it. |
| Recurrence | `calculateNextDueDate` (`backend/src/common/recurrence.ts`) | The slot calendar steps with it. |
| Structural rule actions | `convert_to_transfer`, `split` (`docs/specs/transaction-rules-structural-actions.md`); `planRuleEffects` (`backend/src/transaction-rules/rule-effects.ts`), `SplitStructurePlan` (`backend/src/transaction-rules/rule-structure.ts`) | The settlement plans a `split` structure so later-rule semantics, labels and locks work unchanged. |
| Planner lookups | `set_payee_from_text`'s two-pass payee lookup (`payeeLookups`, `payeeResolutions`) | The loan facts use the same pattern. |
| The write | `TransactionRulesApplierService.writeEffects` (`backend/src/transaction-rules/transaction-rules-applier.service.ts`), `writeSplit` | Gains the claim and the cursor. |
| Run, fingerprint, snapshot, undo | `TransactionRulesRunService` (`backend/src/transaction-rules/transaction-rules-run.service.ts`), `rule-run-fingerprint.ts`, `rule-run-snapshot.ts`, `backend/src/action-history/rule-run-undo.ts` | Newest first today (`loadCandidateUnits` in `backend/src/transaction-rules/rule-run-candidates.ts`); ascending when a rule settles (B6). |
| Creation paths that run rules | `TransactionsService.create`, `ImportRegularProcessorService` (`backend/src/import/import-regular-processor.service.ts`), `applyImportRules` (`backend/src/import/mny/writers/apply-import-rules.ts`), `BankSyncWriterService` (`backend/src/bank-sync/bank-sync-writer.service.ts`), `writeTransferLegs` | The imports run rules in file order today; B6 sorts by date. |
| Locks | `lockAccountsForBalanceWrite`, `lockTransactionRows` (`backend/src/common/db/locks.ts`) | `post()`'s order: schedule row, then source and loan. |
| Mortgage create and loan setup | `LoanMortgageAccountService` (`backend/src/accounts/loan-mortgage-account.service.ts`), `LoanPaymentSetupService` (`backend/src/accounts/loan-payment-setup.service.ts`) | B7 adds payment matching. |
| Rule creation | `TransactionRulesService.create` (`backend/src/transaction-rules/transaction-rules.service.ts`) | Appends at the end of the order. |
| Frontend rules editor | `RuleStructuralActions.tsx`, `RuleRunPreviewTable.tsx`, `RunRuleDialog.tsx` (`frontend/src/components/rules/`), `frontend/src/types/transaction-rule.ts`, `frontend/src/types/transaction-rule-run.ts` | F1 adds the action card and the preview columns. |
| Mortgage form, setup dialog, Loan Details | `MortgageFields.tsx`, `LoanPaymentSetupDialog.tsx`, `AccountForm.tsx` (`frontend/src/components/accounts/`), `LoanDetailView.tsx` (`frontend/src/components/accounts/loan-detail/`) | F2 and F3. |
| Assistant and MCP | `rule-name-mapping.ts`, `rule-validation-hints.ts`, `rule-tool-prep.service.ts` (`backend/src/transaction-rules/`), `backend/src/ai/query/rule-language.ts`, `backend/src/mcp/tools/rules.tool.ts` | B8. |
| Backup and history | `backend/src/backup/support-backup/support-backup-rules.ts`, `backend/src/backup/export-table-queries.ts`, `backend/src/backup/restore-plan.ts`, `backend/src/action-history/action-history.service.ts` | B1 carries the new columns. |

## 3. Decisions

The twenty-one decisions are in spec section 3 (1 to 10 agreed on #1589, 11
to 21 made in the spec). The ones that decide the shape of the work:

1. **A neutral loan core**, `backend/src/loan-installments/`: functions over
   `EntityManager`, no `@Injectable`, and no import from `transactions/*`,
   `scheduled-transactions/*.service*` or `transaction-rules/*`, held by a
   source-scanning guard spec (B2). Both the posting path and the rules engine
   call into it; it calls into neither.
2. **The core is split into an I/O half and a pure half.** `priceInstallment`
   and `planLoanSettlement` take facts and return figures; the facts loader
   reads under the locks. The rules planner stays pure: it receives loan facts
   through a lookup round, as `set_payee_from_text` receives payees.
3. **A success plans a `split` structure**, so `writeSplit`, the labels, the
   target-account locks and a later rule's `hasSplits` work unchanged; the
   settlement adds a `LoanSettlementPlan` beside it.
4. **The claim is written before the split** (spec decision 17), on the same
   `EntityManager`.
5. **The migration only expands** (spec decision 10): nullable columns, a
   defaulted `source`, two indexes; nothing dropped, so a rollback to the
   previous image reads the table as before.

## 4. Order of work

| Phase | Tasks | What ships | Behaviour change |
| --- | --- | --- | --- |
| 0 | S1 | This plan and the spec | none |
| 1 | B1, B2 | The columns (unused); the loan core extracted, `post()` calling `advanceScheduleCursor` | none |
| 2 | B3, B4, B5, B6 | The pure planner, the action in the rules engine, the write path, the chronological fold and the import sort | The action can be stored and run; imports insert rows in date order for every user (B6) |
| 3 | F1, B7, F2, F3, B8 | The rules editor card and preview, payment matching on create and setup, the Loan Details panel, the assistant and MCP name form | Creating a mortgage with payment matching creates a rule and turns auto-post off |
| 4 | Q | Every locale, invariants enforced, docs, release note | none |

B4 adds the action to the union and the planner while `rule-validation.ts`
still answers `UNKNOWN_ACTION` for it, so no rule can store it and B4 is
inert; B5 accepts it in the same PR that writes the claim, and F1 follows
B5. B6 is the only task that changes behaviour for users
who never create the rule (the import sort).

## 5. Where each rule is held

| Rule | Mechanism | Task |
| --- | --- | --- |
| One claim per occurrence | `idx_stp_occurrence`, claimed `ON CONFLICT DO NOTHING` by `post()` and the settlement | exists; B5 |
| One occurrence per transaction | partial unique index on `transaction_id` | B1 |
| A rule claim names its transaction | `CHECK (source = 'post' OR transaction_id IS NOT NULL)` | B1 |
| Claim with the split | one `EntityManager`, claim then split then cursor | B5 |
| Release on delete | `transaction_id ... ON DELETE CASCADE` | B1 |
| Last-in, first-out undo | `RULE_RUN_UNDO_LATER_SETTLEMENT`, decided before any write | B5 |
| The loan core stands alone | the import guard spec | B2 |
| One pricing core | `priceInstallment`, called by `resolveInstallment` and the planner | B2, B3 |
| The settlement's numbers | fixtures copied from spec sections 6, 8 and 9 | B3 |
| Every refusal decided before a write | the pure planner; the refusal order of spec section 11 | B3, B4 |
| Chronological fold | ascending candidates when a rule settles; `priorSettlements` through `plan()` and `applyToNew`; `loanSettlement` in `canonicalChanges` | B6, B5 |
| Imports in date order | a stable sort on every import path | B6 |
| Derived state after the commit | the net-worth dispatch and `rewriteLoanTemplate` per caller | B5, B6 |

## 6. Assumptions, restated for a fresh session

- The spec's sections 6, 8 and 9 are the fixtures; they were computed from the
  formulas, not from an implementation.
- A slot is a recurrence date of the schedule (`start_date`, `frequency`,
  `calculateNextDueDate`); an override's moved date is not.
- "The schedule" of a loan is `accounts.scheduled_transaction_id`, never a
  search for a schedule with a transfer into the loan.
- `post()` keeps its own pricing boundary (`postDate`); the settlement prices
  at the slot.
- `LINE_OF_CREDIT` and `interest_booking_mode = SEPARATE` are refused, not
  supported.
- Locales: English first in each task, `npm run i18n:pseudo` after editing
  `en/*`; the full-locale pass is Q.

## 7. Risks

| Risk | Mitigation |
| --- | --- |
| An opening balance that is not the debt at the start of history books a gap as extra principal | The run preview shows `debtBefore` and the extra line per row (F1); the precondition is stated on the panel (F3) and in spec section 14.3 |
| A LINEAR mortgage whose ledger starts after the loan prices the wrong constant principal | `original_principal` becomes a form field separate from the opening balance (B7, F2) |
| A bill auto-posted and a bank row imported for the same installment | `auto_post` set off when the rule is created (B7); the panel warns (F3); the claim refuses the second (spec 12.7) |
| A run scanning the same 1000 rows forever | "Process history" pages by `startDate` and stops when a page cannot advance (spec 14.1) |
| A concurrent bill post during an import deadlocks | Named as a known gap (spec section 15); auto-post is off for the matched bill, so only a person pressing Post can race it |
| An undo that leaves a later settlement priced on a debt that no longer exists | `RULE_RUN_UNDO_LATER_SETTLEMENT` (B5) |
| The import sort changes register order for every user | Named in the release note (Q); rows keep file order within a date |
