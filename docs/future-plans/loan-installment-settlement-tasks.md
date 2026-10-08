# Loan Installment Settlement: Agent Task List

> Companion to [`loan-installment-settlement.md`](./loan-installment-settlement.md) (the plan) and [`docs/specs/loan-installment-settlement.md`](../specs/loan-installment-settlement.md) (the spec). This file breaks the work into tasks sized for one AI-agent session each. Do the tasks in dependency order; never start a task whose dependencies are unmerged. Mark a task done by checking its box and noting the PR.

## How to use this list (read first, every session)

- **One task per session/PR.** Each task lists its files. Touching files outside the task's scope is a scope violation -- stop and leave a note on the task's issue instead.
- **The spec is the authority on every number and every refusal.** A fixture is copied from spec sections 6, 8 and 9, never from the implementation's own output. If the code and the spec disagree, the spec is changed first, in its own commit, with the reason.
- **The governing invariants apply to every task:** one settlement per occurrence, the claim written in the split's transaction on one `EntityManager` (INV-LOAN-008), and a pass that settles folds chronologically (INV-RULE-005). Name both, and every other invariant the task touches, in the PR.
- **Definition of done for every task** (in addition to per-task acceptance):
  - `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`; plus `npm run build && npm run test:integration` when a query, an entity, a migration or an RLS context changed; `npm run migration:lint` when a migration changed.
  - `frontend/`: `npm run lint && npm run type-check && npm run i18n:check`, `npm run test:changed`, `npm run build`.
  - `database/`: `npm run migration:lint`, `scripts/verify-schema.sh`, `node scripts/check-migration-prefixes.mjs`, and `database/schema.sql` in the same commit as the migration.
  - `docs/`: `node scripts/check-docs-manifests.mjs` and, in `backend/`, `npm run test:unit -- doc-paths instruction-files`.
  - Stage new files before running a guard (`git add -N` is enough).
  - New user-facing strings: English catalogs only, then `npm run i18n:pseudo`. The full-locale pass is Q.
  - The doc line each task names lands in the same PR.
- **Terminology:** "the spec" = `docs/specs/loan-installment-settlement.md`; "the plan" = `loan-installment-settlement.md`; "the core" = `backend/src/loan-installments/`. Section references point there. Re-locate code by symbol, never by line.

## Deployment safety

| Class | Meaning |
|-------|---------|
| **none** | Tests, docs, or code nothing calls yet. |
| **inert** | Ships a column, a constant or a code path that changes nothing until a user stores the action or turns on payment matching. |
| **neutral** | Rewrites a live code path. Designed behaviour-preserving for every existing user, except where the task names a change; the full unit suite of the touched module is the gate. |

Every task is safe to merge in any order that respects its dependencies: the migration only adds columns, the core extraction keeps every existing spec green unchanged, and the action changes nothing until a rule carries it.

## Task graph

| ID | Issue | Task | Depends on | Deploy class | Status | PR |
|----|-------|------|-----------|--------------|--------|----|
| S1 | #1590 | Spec in `docs/specs/` and plan pair in `docs/future-plans/`; INV-LOAN-008 and INV-RULE-005 registered `unenforced` | -- | none | [x] | the PR closing #1590 |
| B1 | #1591 | Migration: claim columns on `scheduled_transaction_postings`, `accounts.payment_matching_rule_id`; entities, backup, restore, action history | S1 | inert | [x] | the PR closing #1591 |
| B2 | #1592 | Loan core extraction into `backend/src/loan-installments/`; `advanceScheduleCursor` shared with `post()` | S1 | neutral | [x] | the PR closing #1592 |
| B3 | #1593 | Settlement types, occurrence slots, facts loader, `datedLoanDebts`, pure planner | B1, B2 | none | [x] | the PR closing #1593 |
| B4 | #1594 | The action in the rules engine: types, validation, references, planner, lookup rounds, skip reasons | B3 | inert | [x] | the PR closing #1594 |
| B5 | #1595 | Write path: claim, cursor, trace, fingerprint, snapshot, undo, after-commit reprice; `post()` records its transaction | B4 | inert | [x] | the PR closing #1595 |
| B6 | #1596 | Chronological fold, ascending run order, import ordering, bank-sync affected accounts | B5 | neutral | [ ] | -- |
| F1 | #1597 | Frontend action card, types, run preview, skip reasons, en + pseudo | B5 | inert | [ ] | -- |
| B7 | #1598 | Mortgage and setup backend: payment matching, rule creation, auto-post off, original principal, endpoints | B5 | inert | [ ] | -- |
| F2 | #1599 | Mortgage form and setup dialog: Payment matching, Original principal | F1, B7 | inert | [ ] | -- |
| F3 | #1600 | Loan Details Payment matching panel | F2, B6 | inert | [ ] | -- |
| B8 | #1601 | Assistant and MCP name form, hints, rule language, docs | B4 | inert | [ ] | -- |
| Q | #1602 | Acceptance: all locales, invariants enforced, docs, release note | F3, B8, B6 | none | [ ] | -- |

**Why F1 waits for B5:** until B5 the validator refuses the action, so a card for it would offer something the server refuses to save.

**Why B6 is neutral, not inert:** the import sort applies to every user (spec decision 7), whether or not they store the action; within a date the file order is kept, so a file already in date order inserts exactly as before.

---

## Task details

### S1 -- Spec and plan

**Files:** `docs/specs/loan-installment-settlement.md`, `docs/future-plans/loan-installment-settlement.md`, `docs/future-plans/loan-installment-settlement-tasks.md` (all new), `docs/system-invariants.md` (INV-LOAN-008 and INV-RULE-005, `unenforced`), `docs/verification-contract.md` (their matrix rows), `docs/specs/scheduled-loan-installment-pricing.md` section 2 (the fourth consumer row).

- Acceptance: every "atomic", "exactly once", "never" and "cannot" names its mechanism; the truth tables and the worked numbers reproduce `docs/specs/mortgage-types.md` table 7.1 rows 1 and 2 and `docs/specs/scheduled-loan-installment-pricing.md` section 5 at cents; the refusal table is total over the planner's union; the docs gate above passes.

### B1 -- Claim columns and the payment-matching pointer

**Files:** `database/migrations/<UTC timestamp>_loan_settlement_claims.sql` (new), `database/schema.sql`, `backend/src/scheduled-transactions/entities/scheduled-transaction-posting.entity.ts`, `backend/src/accounts/entities/account.entity.ts`, `backend/src/backup/support-backup/support-backup-rules.ts`, `backend/src/backup/export-table-queries.ts`, `backend/src/backup/restore-plan.ts`, `backend/src/backup/restore-references.ts`, `backend/src/action-history/action-history.service.ts`, their specs.

- Spec section 5.2: `transaction_id` (FK `ON DELETE CASCADE`), `source` (`NOT NULL DEFAULT 'post'`, CHECK over `post` and `rule`), `rule_id` (FK `ON DELETE SET NULL`), `pricing JSONB`; the partial unique index on `transaction_id`; `CHECK (source = 'post' OR transaction_id IS NOT NULL)`. Spec 5.4: `accounts.payment_matching_rule_id` (FK `ON DELETE SET NULL`).
- Backup exports and restores the new columns; a restore remaps `transaction_id`, `rule_id` and `payment_matching_rule_id` through the id maps the restore already keeps. Action history records `payment_matching_rule_id` on an account change.
- Acceptance: `migration:lint`, `scripts/verify-schema.sh`, `check-migration-prefixes`; a PG integration case per spec section 16 row B1 (the second claim for one transaction refused, delete cascades, rule delete nulls both pointers); a backup round trip with a rule claim.
- Inert: nothing writes the new columns until B5 and B7.

### B2 -- The loan core, behaviour-preserving

**Files:** `backend/src/loan-installments/price-installment.ts`, `backend/src/loan-installments/reprice-template.ts`, `backend/src/scheduled-transactions/schedule-cursor.ts`, `backend/src/loan-installments/loan-core-imports.guard.spec.ts` (all new), `backend/src/scheduled-transactions/scheduled-transaction-loan.service.ts`, `backend/src/scheduled-transactions/scheduled-transactions.service.ts`, their specs.

- `price-installment.ts`: the body of `resolveInstallment`, split into the I/O half (debt, rate, template lines) and a pure `priceInstallment(inputs)`; `reprice-template.ts`: the body of `rewriteTemplate` as `rewriteLoanTemplate(m, scheduledTransactionId, purpose)`. `ScheduledTransactionLoanService` delegates; its public methods and their specs are unchanged.
- `priceInstallment` takes the annual rate, the cadence and the payment as inputs, so each caller states its missing-data rule; the posting path keeps today's defaults (spec section 15 item 5) and its specs stay green unchanged.
- `schedule-cursor.ts` (in `scheduled-transactions/`, beside the entities, which the core may import): `advanceScheduleCursor(m, schedule, consumedSlots)`, the recurring branch of `post()` after the claim (next due date, override pruning, occurrences, end date, `last_posted_date`), stepping past every consecutive claimed slot; `post()` calls it with the one slot it claimed.
- The guard spec fails an import from `transactions/*`, `scheduled-transactions/*.service*` or `transaction-rules/*` inside the core.
- Acceptance: every existing spec of the two services green with no expectation changed; the guard's own positive and negative cases.

### B3 -- Types, slots, facts, planner

**Files:** `backend/src/loan-installments/loan-settlement.types.ts`, `backend/src/loan-installments/occurrence-slots.ts`, `backend/src/loan-installments/loan-settlement-facts.ts`, `backend/src/loan-installments/plan-loan-settlement.ts` (all new, with specs), `backend/src/accounts/dated-loan-debt.util.ts` (`datedLoanDebts` beside `datedLoanDebt`), `backend/src/common/ledger-balance.sql.ts` (the batched statement), `backend/test/integration/loan-settlement-debt.integration.spec.ts`.

- Types: `LoanSettlementAction` fields, `LoanSettlementPlan`, the `pricing` record (spec 5.3), the refusal reasons and `missing` codes (spec sections 10 and 11), `LOAN_SETTLEMENT_TOLERANCE_MINOR_UNITS = 5`.
- `occurrence-slots.ts`: the pure calendar of spec 6.1 (built around `next_due_date`, history from `start_date`, periods, `ONCE`, the cadence check) and the selection of 6.2.
- `datedLoanDebts(m, loan, dates)`: one statement (`ACCOUNT_BALANCES_AS_OF_DATES_SQL`, the as-of join bounded at each unnested date) for every date, equal date by date to `datedLoanDebt`.
- `loan-settlement-facts.ts`: account, schedule and template lines, rates (the dated payment of spec decision 12 is read off them), the slots of the pass's window, the claims over their periods, the dated debts; read after the locks of spec section 13 when the caller asks for them.
- `plan-loan-settlement.ts`: pure; slot selection, the fold over `priorSettlements` (spec 7.2), pricing through `priceInstallment` (spec 7.3), the amount policy (spec section 8), refusals 11 to 19 (spec section 11); returns a `SplitStructurePlan` and a `LoanSettlementPlan`, or a refusal with its detail.
- Acceptance: spec section 16 rows B3; every row of spec sections 6, 8 and 9 as a named case.

### B4 -- The action in the rules engine

**Files:** `backend/src/transaction-rules/rule-action.types.ts`, `backend/src/transaction-rules/rule-validation.ts`, `backend/src/transaction-rules/rule-references.ts`, `backend/src/transaction-rules/rule-target-accounts.ts`, `backend/src/transaction-rules/rule-effects.ts`, `backend/src/transaction-rules/rule-structure.ts`, `backend/src/transaction-rules/rule-labels.ts`, `backend/src/transaction-rules/transaction-rules.limits.ts`, `backend/src/transaction-rules/transaction-rules-applier.service.ts` (the lookup rounds only), `backend/src/transaction-rules/transaction-rules-run.service.ts` (the lookup rounds only), the DTOs, `backend/src/i18n/locales/en/errors.json`, their specs.

- `settle_loan_installment` joins `RULE_ACTION_TYPES` and `StructuralRuleAction`; validation per spec 5.1 with defaults written on save; `MAX_LOAN_SETTLEMENT_WINDOW_DAYS`; references and target accounts.
- `RulePlanContext` gains `loanFacts` and `fromScheduledPosting` (server-set, never from a request); `RuleEffects` gains `loanFactsLookups`; the applier and the run service answer them in a second round, as for payees.
- `RuleSkippedAction` gains the optional `detail` (spec decision 18). Refusals in spec section 11's order; a success plans `changes.structure` (a split) and `changes.loanSettlement`.
- Inert by construction until B5: `rule-validation.ts` answers `UNKNOWN_ACTION` for `settle_loan_installment` on every save path (REST, assistant, MCP), as it does today, so no stored rule can carry the action and no create or import can reach it. The planner and the lookup rounds are exercised by the specs directly. B5 lets the validator accept the type in the same PR that writes the claim, so a split is never written without its claim and nothing throws on a create or import path in between.
- As built: the type is in the `RuleAction` union and `StructuralRuleAction`, but not in `RULE_ACTION_TYPES`, the list `frontend/src/lib/rule-fields.contract.test.ts` mirrors; the validator accepts it only while `SETTLE_LOAN_INSTALLMENT_ACCEPTED` (`rule-action.types.ts`) is true, which it is not, and the planner skips a rule the validator refuses (`invalid`). The specs that plan the action mock the flag on. B5 deletes the flag and appends the type to `RULE_ACTION_TYPES`; that append fails the frontend's mirror tests (`rule-fields.contract.test.ts`, `rules-catalog.test.ts`, `rule-actions.test.ts`) until the frontend lists the type, so B5 carries the frontend mirror entry or lands with F1. The name-mapping and hint entries (`RULE_ACTION_TOOL_KEYS`, `ACTION_NAME_KEYS`) are keyed on `RULE_ACTION_TYPES` and follow with it.
- Acceptance: spec section 16 row B4.

### B5 -- Write path, claim, cursor, undo

**Files:** `backend/src/loan-installments/claim-loan-occurrence.ts` (new), `backend/src/transaction-rules/transaction-rules-applier.service.ts`, `backend/src/transaction-rules/rule-run-fingerprint.ts`, `backend/src/transaction-rules/rule-run-snapshot.ts`, `backend/src/transaction-rules/transaction-rules-run.service.ts`, `backend/src/action-history/rule-run-undo.ts`, `backend/src/scheduled-transactions/scheduled-transactions.service.ts` (`post()` writes `transaction_id` and passes `fromScheduledPosting`), `backend/src/transactions/transactions.service.ts` (the after-commit dispatch), `backend/test/integration/loan-settlement-claim.integration.spec.ts` (new), their specs.

- Spec section 12 in full: split, claim, cursor in that order on one `EntityManager`; a write-time conflict is the throwing backstop of decision 17, unreachable while the planner reads the claims under the locks; the trace and `canonicalChanges`; the snapshot; undo with `RULE_RUN_UNDO_LATER_SETTLEMENT`, the conditional rewind and the overrides restored; the after-commit net-worth dispatch and `rewriteLoanTemplate` on the create, import, bank-sync and run paths.
- Locks per spec section 13 on the create and run paths; the run derives its schedules and loans from the rules before planning.
- `post()` sets `transaction_id` on its claim after it creates the transaction (spec 5.2), null for investment posts; the INV-OCCURRENCE-001 entry names the release on delete for every schedule.
- `rule-validation.ts` accepts `settle_loan_installment` (it answered `UNKNOWN_ACTION` until this task).
- Acceptance: spec section 16 rows B5, including the two-connection case.

### B6 -- Fold, order, imports

**Files:** `backend/src/transaction-rules/rule-run-candidates.ts`, `backend/src/transaction-rules/transaction-rules-run.service.ts`, `backend/src/transaction-rules/transaction-rules-applier.service.ts`, `backend/src/import/import-regular-processor.service.ts`, `backend/src/import/import.service.ts`, `backend/src/import/mny/writers/apply-import-rules.ts`, `backend/src/bank-sync/bank-sync-writer.service.ts`, their specs.

- Ascending candidates when any rule of the run carries the action; `priorSettlements` through `plan()` and `applyToNew` (planned and not yet written only).
- The import sort on every path (stable within a date), and the after-commit dispatch on the import paths, bank sync included.
- Acceptance: spec section 16 row B6; spec table 9.4 through preview and commit with equal fingerprints.

### F1 -- Rules editor and run preview

**Files:** `frontend/src/types/transaction-rule.ts`, `frontend/src/types/transaction-rule-run.ts`, `frontend/src/components/rules/RuleStructuralActions.tsx`, `frontend/src/components/rules/RuleRunPreviewTable.tsx`, `frontend/src/components/rules/use-rule-change-text.ts`, `frontend/src/components/rules/use-rule-enum-labels.ts`, `frontend/src/i18n/messages/en/rules.json`, their tests.

- One card for the action, built from the transaction form's account and category pickers (loan accounts of type `MORTGAGE` and `LOAN` only), the window and the two policies.
- The preview shows per row the slot, `debtBefore`, the lines and the extra line; every refusal and `missing` code is worded, held to the backend's list by a contract test.

### B7 -- Payment matching on create and setup

**Files:** `backend/src/accounts/loan-mortgage-account.service.ts`, `backend/src/accounts/loan-payment-setup.service.ts`, `backend/src/accounts/dto/create-account.dto.ts`, `backend/src/accounts/dto/update-account.dto.ts`, `backend/src/accounts/dto/setup-loan-payments.dto.ts`, `backend/src/accounts/accounts.controller.ts`, their specs.

- Spec decision 5: the rule through `TransactionRulesService.create`, `payment_matching_rule_id`, `auto_post = false`; `original_principal` accepted on create and edit, separate from the opening balance (spec 14.3).
- An endpoint listing the loan's settled installments from the claims (slot, transaction, lines, `pricing`), and one creating the rule for an existing loan.
- A rule-creation failure is reported and the account stays (spec section 15 item 6).

### F2 -- Mortgage form and setup dialog

**Files:** `frontend/src/components/accounts/MortgageFields.tsx`, `frontend/src/components/accounts/LoanPaymentSetupDialog.tsx`, `frontend/src/components/accounts/AccountForm.tsx`, `frontend/src/i18n/messages/en/accounts.json`, their tests.

- "Payment matching": payee pattern prefilled with the institution name, optional description pattern, the source account fixed; "Original principal" beside the opening balance. Grep `e2e/` for any accessible name the form changes.

### F3 -- Loan Details panel

**Files:** a new panel under `frontend/src/components/accounts/loan-detail/`, `frontend/src/components/accounts/loan-detail/LoanDetailView.tsx`, `frontend/src/i18n/messages/en/accounts.json`, tests.

- The linked rule or a dialog to create one; "Process history" paging per spec 14.1; the auto-post warning; the settled installments; the preconditions of spec 14.3 stated.

### B8 -- Assistant and MCP

**Files:** `backend/src/transaction-rules/rule-name-mapping.ts`, `backend/src/transaction-rules/rule-validation-hints.ts`, `backend/src/transaction-rules/rule-tool-prep.service.ts`, `backend/src/ai/query/rule-language.ts`, `backend/src/mcp/tools/rules.tool.ts`, `docs/backend/mcp.md`, `docs/backend/ai-and-payees.md`, their specs.

- The name form of spec 5.1 both ways; a hint per validation code; the rule language describes the action.

### Q -- Acceptance

**Files:** every locale's `rules.json` and `accounts.json` and backend `errors.json`, `docs/system-invariants.md` (INV-LOAN-008 and INV-RULE-005 flipped with their tests named; INV-LOAN-006's Statement names the fourth consumer; INV-RULE-001 and INV-RULE-003 name the action), `docs/verification-contract.md` (the two rows met), the spec's status and "Asserted by" entries, a release note under `docs/release-notes/` (naming the import sort).
