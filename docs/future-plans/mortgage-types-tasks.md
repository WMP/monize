# Mortgage Types: Agent Task List

> Companion to [`mortgage-types.md`](./mortgage-types.md) (the plan) and [`docs/specs/mortgage-types.md`](../specs/mortgage-types.md) (the spec). This file breaks the work into tasks sized for one AI-agent session each. Do the tasks in dependency order; never start a task whose dependencies are unmerged. Mark a task done by checking its box and noting the PR.

## How to use this list (read first, every session)

- **One task per session/PR.** Each task lists its files. Touching files outside the task's scope is a scope violation -- stop and leave a note on the task's issue instead.
- **The spec is the authority on every number.** A fixture is copied from spec section 7, never from the implementation's own output. If the code and the spec disagree, the spec is changed first, in its own commit, with the reason.
- **The governing invariant applies to every task:** one amortization method per mortgage type (INV-LOAN-007). A consumer reads the type's traits; a new read of `isCanadianMortgage` or `isVariableRate` fails the flags guard from P1-B2 on.
- **Definition of done for every task** (in addition to per-task acceptance):
  - `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `TZ=UTC npm run test:unit -- --coverage`; plus `npm run build && npm run test:integration` when a query, an entity or a migration changed; `npm run migration:lint` when a migration changed.
  - `frontend/`: `npm run lint && npm run type-check && npm run i18n:check`, `npm run test:cov`, `npm run build`.
  - `database/`: `npm run migration:lint`, `scripts/verify-schema.sh`, `node scripts/check-migration-prefixes.mjs`, and `database/schema.sql` in the same commit as the migration.
  - `docs/`: `node scripts/check-docs-manifests.mjs` and, in `backend/`, `npm run test:unit -- doc-paths instruction-files`.
  - Stage new files before running a guard (`git add -N` is enough).
  - New user-facing strings: English catalogs only, then `npm run i18n:pseudo`. The full-locale passes are P1-Q and P2-Q.
  - The doc line each task names lands in the same PR.
- **Terminology:** "the spec" = `docs/specs/mortgage-types.md`; "the plan" = `mortgage-types.md`. Section references point there. Re-locate code by symbol, never by line.

## Deployment safety

| Class | Meaning |
|-------|---------|
| **none** | Tests, docs, or code nothing calls yet. |
| **inert** | Ships a column, a constant or a code path that changes nothing until a user selects a new type (or until a later task calls it). |
| **neutral** | Rewrites a live code path. Designed behaviour-preserving for every existing account (spec section 4.2); the full unit suite of the touched module is the gate. |

Every task is safe to merge in any order that respects its dependencies: the column is nullable and read with a flags fallback until P3-B1, Phase 1 offers only the two values that exist today, and the new methods are unreachable until P2-B1 lets the DTOs accept them.

## Task graph

| ID | Issue | Task | Depends on | Deploy class | Status |
|----|-------|------|-----------|--------------|--------|
| S1 | #1502 | Spec in `docs/specs/` and plan pair in `docs/future-plans/`; INV-LOAN-007 registered `unenforced` | -- | none | [ ] |
| P1-B1 | #1503 | Migration: nullable `mortgage_type`, backfill, CHECK; entity, backup rules, action history, demo seed | S1 | inert | [ ] |
| P1-B2 | #1504 | `mortgage-type.util.ts`, traits, parity cases, type-keyed rate and EAR, flags guard | P1-B1 | none | [ ] |
| P1-B3 | #1505 | Backend consumers read the type with flags fallback; DTOs accept it; LLM account row carries it; dated debt on the rate-change path | P1-B2 | neutral | [ ] |
| P1-F1 | #1506 | Frontend type and traits; schedule, frequency, history and summary code keyed on type | P1-B3 | neutral | [ ] |
| P1-F2 | #1507 | One Select replaces both checkbox pairs; Term Length for every type; help text; copy fixes; en i18n | P1-F1 | neutral | [ ] |
| P1-Q | #1508 | Phase 1 acceptance: locales, docs, release note | P1-F2 | none | [ ] |
| P2-B1 | #1509 | Backend LINEAR and INTEREST_ONLY, `prepayment_mode` | P1-Q | inert | [ ] |
| P2-F1 | #1510 | Frontend LINEAR and INTEREST_ONLY | P2-B1 | inert | [ ] |
| P2-B2 | #1511 | Detect mortgage type from sample installments and from history (backend) | P2-B1 | inert | [ ] |
| P2-F2 | #1512 | Type detection UI | P2-B2 | inert | [ ] |
| P2-Q | #1513 | Phase 2 acceptance: spec, invariants, locales | P2-F1, P2-F2 | none | [ ] |
| P3-B1 | #1514 | Contract migration: NOT NULL default, drop the booleans, delete overloads and guard | P2-Q, one release after P1 | neutral | [ ] |

**Why P3-B1 waits a release:** a rollback to the image before Phase 1 reads the two booleans; dropping them in the same release that stopped writing them leaves no image to roll back to.

---

## Task details

### S1 -- Spec and plan

**Files:** `docs/specs/mortgage-types.md`, `docs/future-plans/mortgage-types.md`, `docs/future-plans/mortgage-types-tasks.md` (all new), `docs/system-invariants.md` (INV-LOAN-007, `unenforced`), `docs/verification-contract.md` (its matrix row).

- Acceptance: the section 7 fixtures reproduce #1501's tables at cents; every "always", "never" and "cannot" names its mechanism; open point 1 decided (spec section 9); the docs gate above passes.

### P1-B1 -- Column, backfill, CHECK

**Files:** `database/migrations/<UTC timestamp>_accounts_mortgage_type.sql` (new), `database/schema.sql`, `backend/src/accounts/entities/account.entity.ts`, `backend/src/backup/support-backup/support-backup-rules.ts`, `backend/src/action-history/action-history.service.ts`, `backend/src/database/demo-seed.service.ts`, `backend/src/database/demo-seed-data/accounts.ts`.

- `mortgage_type VARCHAR(20)` nullable, CHECK over the four values of spec decision 1; backfill per spec table 4.2 for `account_type = 'MORTGAGE'` only. Fix the wrong "uses monthly compounding" comment on `is_variable_rate` in `schema.sql` in the same commit.
- The backup rule keeps the column; action history records it beside the two booleans; the demo seed writes it.
- Acceptance: `migration:lint`, `scripts/verify-schema.sh`, `check-migration-prefixes`; a migration test asserts one account per row of table 4.2 lands on its type.
- Inert: nothing reads the column until P1-B3.

### P1-B2 -- Types, traits, parity, guard

**Files:** `backend/src/accounts/mortgage-type.util.ts` + `mortgage-type.util.spec.ts` (new), `backend/src/accounts/mortgage-type-cases.json` (new), `backend/src/accounts/mortgage-type-flags.guard.spec.ts` (new), a schema contract spec for the CHECK (new, the `backend/src/common/db/rls-exempt-tables.spec.ts` pattern), `backend/src/accounts/mortgage-amortization.util.ts`.

- `MORTGAGE_TYPES`, `MortgageType`, `MORTGAGE_TYPE_TRAITS` (spec table 4.1), `compoundingFor`, `amortizationMethodFor`, `annualizationFor`, `mortgageTypeFromFlags`, `flagsFromMortgageType`.
- Type-keyed `getPeriodicRate` and `calculateEffectiveAnnualRate`; the boolean overloads delegate.
- The flags guard lists every current caller of the boolean overloads and of the two entity fields; shrink-only, with the failure message naming the type-keyed replacement.
- Acceptance: the type-keyed and boolean forms agree on every row of table 4.2; the contract spec reconciles the CHECK with `MORTGAGE_TYPES` both ways.

### P1-B3 -- Backend consumers

**Files:** `backend/src/accounts/loan-mortgage-account.service.ts`, `backend/src/accounts/loan-payment-setup.service.ts`, `backend/src/accounts/accounts.service.ts` (update path, `LlmAccountRow`), `backend/src/accounts/accounts.controller.ts`, `backend/src/accounts/dto/create-account.dto.ts`, `backend/src/accounts/dto/update-account.dto.ts`, `backend/src/accounts/dto/mortgage-preview.dto.ts`, `backend/src/accounts/dto/setup-loan-payments.dto.ts`, `backend/src/scheduled-transactions/scheduled-transaction-loan.service.ts`, `backend/src/loan-rate-changes/loan-rate-changes.service.ts`, `backend/src/loan-rate-changes/rate-change-inference.service.ts`, their specs, the MCP and AI tool output schemas that carry the account row.

- Each consumer reads the type (column, else `mortgageTypeFromFlags`) and asks a trait. Saves write the type and `flagsFromMortgageType` together.
- DTOs accept `mortgageType` in `ANNUITY` and `CANADIAN_FIXED`; the booleans stay accepted and are translated when the type is absent. Correct the "uses monthly compounding" copy in both DTOs.
- `buildScheduledUpdate`, `recalculatePaymentForRate` and the mortgage rate update (`UpdateMortgageRateDto`) read `datedLoanDebt` at the effective date (spec decision 5).
- `annualizeRate` keyed on `annualizationFor` (spec table 4.2, last row).
- Acceptance: a future-dated rate change prices the debt at its date; every existing spec green unchanged except the Canadian-variable inference case, whose expectation changes with a comment naming table 4.2.

### P1-F1 -- Frontend type and traits

**Files:** `frontend/src/types/account.ts`, `frontend/src/lib/mortgage-type.ts` + `mortgage-type.contract.test.ts` (new), `frontend/src/lib/loan-schedule-types.ts`, `frontend/src/lib/loan-schedule.ts`, `frontend/src/lib/loan-frequency.ts`, `frontend/src/lib/loan-history.ts`, `frontend/src/lib/loan-figures.ts`, `frontend/src/lib/loan-past-impact.ts`, `frontend/src/components/accounts/loan-detail/LoanSummaryCards.tsx`, `frontend/src/components/import/CompleteStep.tsx`, their tests.

- `LoanScheduleInput.mortgageType` replaces the two booleans; `getPeriodicRate` keyed on the type; the history mirror of `annualizeRate` keyed on `annualizationFor`.
- Acceptance: the contract test reads `backend/src/accounts/mortgage-type-cases.json`; every existing schedule test green with only the input shape changed.

### P1-F2 -- The Select

**Files:** `frontend/src/components/accounts/MortgageFields.tsx` + test, `frontend/src/components/accounts/LoanPaymentSetupDialog.tsx` + test, `frontend/src/components/accounts/AccountForm.tsx` + test (`optionalEnum(MORTGAGE_TYPES)`), `frontend/src/i18n/messages/en/accounts.json`.

- One `Select` with `ANNUITY` and `CANADIAN_FIXED` and help text per option; Term Length shown for every type; the "Record rate changes in Loan Details" hint shown for every type when editing (#1501 open point 2); remove `mortgageFields.variableRateDesc`'s wrong claim.
- Grep `e2e/` for the old checkbox accessible names before removing them.

### P1-Q -- Phase 1 acceptance

**Files:** every locale's `accounts.json`, `docs/financial-semantics.md` section 9 (the convention table names `compoundingFor`), `docs/system-invariants.md` (INV-LOAN-003's mechanism), a new file under `docs/release-notes/` for the release (naming the Canadian-variable inference change).

### P2-B1 -- Backend LINEAR and INTEREST_ONLY

**Files:** `database/migrations/<UTC timestamp>_accounts_prepayment_mode.sql` (new), `database/schema.sql`, `backend/src/accounts/entities/account.entity.ts`, `backend/src/accounts/mortgage-amortization.util.ts`, `backend/src/scheduled-transactions/scheduled-transaction-loan.service.ts`, `backend/src/loan-rate-changes/loan-rate-changes.service.ts`, `backend/src/accounts/loan-payment-setup.service.ts`, `backend/src/accounts/loan-mortgage-account.service.ts`, `backend/src/scheduled-transactions/scheduled-transactions.service.ts` (the template edit that writes `payment_amount`), `backend/src/loan-rate-changes/rate-change-inference.service.ts`, `backend/src/accounts/accounts.service.ts` (`LlmAccountRow`), the MCP and AI tool output schemas that carry the account row, the DTOs, `backend/src/accounts/mortgage-type-cases.json`, their specs, `backend/src/backup/support-backup/support-backup-rules.ts`.

- `prepayment_mode` with the CHECK of spec decision 10; the `payment_amount` CHECK of spec decision 11, and every backend reader in spec table 5.6 changed as its row says. Preview per spec 5.1, pricing per 5.2 and table 4.3, rate change per 5.3, setup per 5.5, missing data per section 8, template shape per section 9.
- Acceptance: spec tables 7.1 to 7.5 row by row, the stale-template-after-rate-rise sequence, section 9's obligations, accelerated frequencies refused, the backend rows of the spec's test matrix for section 5.6 and section 8.

### P2-F1 -- Frontend LINEAR and INTEREST_ONLY

**Files:** `frontend/src/lib/loan-schedule.ts`, `frontend/src/lib/loan-history.ts` (`buildLoanProjectionInput` supplies the term end), `frontend/src/lib/mortgage-type.ts`, `frontend/src/components/accounts/MortgageFields.tsx`, `frontend/src/components/accounts/LoanPaymentSetupDialog.tsx`, `frontend/src/lib/loan-figures.ts`, `frontend/src/lib/loan-past-impact.ts`, `frontend/src/lib/loan-overpayment-solver.ts`, `frontend/src/components/accounts/loan-detail/LoanSummaryCards.tsx`, `frontend/src/components/accounts/loan-detail/OverpaymentSimulator.tsx`, `frontend/src/components/reports/LoanAmortizationReport.tsx`, `frontend/src/i18n/messages/en/accounts.json`, their tests.

- The Select gains `LINEAR` and `INTEREST_ONLY`; `prepayment_mode` shown for LINEAR only.
- Every frontend reader in spec table 5.6 changed as its row says: the next installment captioned with its date, the bullet beside it for INTEREST_ONLY, the simulator's budget and extra defined per projected row.
- Acceptance: spec tables 7.1, 7.3 and 7.4 from `generateLoanSchedule`; the frontend row of the spec's test matrix for section 5.6, with `payment_amount` null on the fixture account.

### P2-B2 -- Detection (backend)

**Files:** a pure detector util + spec and its fixtures in `backend/src/accounts/` (new), the endpoints on the accounts controller.

- Spec section 10; the detector writes nothing. Fixtures add rows to the spec's table 10 in the same PR.

### P2-F2 -- Detection UI

**Files:** sample installments on the create form, a detect action in Loan Details, `frontend/src/i18n/messages/en/accounts.json`, tests.

### P2-Q -- Phase 2 acceptance

**Files:** `docs/specs/mortgage-types.md` (status, any truth-table rows the implementation added), `docs/system-invariants.md` (INV-LOAN-006's Statement per spec 6.2, INV-LOAN-004 per 6.4, INV-LOAN-007 flipped to `enforced` with its tests named), `docs/verification-contract.md`, every locale.

### P3-B1 -- Contract migration

**Files:** a new migration and `database/schema.sql` (`NOT NULL DEFAULT 'ANNUITY'`, drop `is_canadian_mortgage` and `is_variable_rate`), the entity, the DTOs (the booleans no longer accepted), `backend/src/accounts/mortgage-amortization.util.ts` (overloads deleted), `backend/src/accounts/mortgage-type-flags.guard.spec.ts` (deleted with its last caller), the frontend type, backup rules, action history, demo seed.

- Restoring a backup taken before Phase 1 maps the booleans through `mortgageTypeFromFlags`; a backup integration case asserts it.
