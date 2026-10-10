# Sovereign Bonds: Agent Task List

> Companion to [`sovereign-bonds.md`](./sovereign-bonds.md) (the plan) and [`docs/specs/polish-retail-bonds.md`](../specs/polish-retail-bonds.md) (the spec). Do the tasks in dependency order. Mark a task done by checking its box and noting the PR.

## Rules for every task

- **The spec is the authority on every number.** A fixture copies spec section 5, never the implementation's output. If code and spec disagree, change the spec first, in its own commit, with the reason.
- **Invariants:** INV-BOND-001 to INV-BOND-004. Name the ones the task touches in the PR.
- **Definition of done:** the "Required before you push" list in `AGENTS.md` for each layer the task touches.

## PR 1: foundation and four products

- [ ] **T1 Exact decimal type.** `backend/src/bonds/domain/exact-decimal.ts` and its spec. Rational over `BigInt`; parse from a decimal string only; `add`, `sub`, `mul`, `div`, `cmp`, `roundHalfUp(places)`, `toFixed(places)`. Acceptance: spec section 11, row "Exact arithmetic".
- [ ] **T2 Dates and calendars.** `backend/src/bonds/domain/period-schedule.ts`, the business-day calendar interface and registry in `backend/src/bonds/domain/`, the Polish calendar in `backend/src/bonds/adapters/pl/`, specs. Acceptance: ROR annex 3 rows, E14, E15.
- [ ] **T3 Terms types and parser.** `backend/src/bonds/domain/bond-terms.ts`, spec. Primitive unions of spec section 2.1; refuses unknown fields, JSON numbers for rates or amounts, and an unknown primitive (`UNSUPPORTED_PRIMITIVE`).
- [ ] **T4 Engine and Polish adapter.** `backend/src/bonds/engine/bond-engine.ts`, terms manifests and golden fixtures in `backend/src/bonds/adapters/pl/`, the country-agnostic guard spec. Acceptance: E1 to E16 through the manifests, spec section 4 truth table, window cases, guard green. Depends on T1 to T3.
- [ ] **T5 Migration and entities.** One migration with the five country-agnostic tables of spec section 7, `database/schema.sql`, `RLS_EXEMPT_TABLES`, the schema marker lines, `docs/row-level-security-contract.md` section 2 rows, `INTENTIONALLY_EXCLUDED_TABLES`, entities. Acceptance: `migration:lint`, `verify-schema.sh`, immutability integration test.
- [ ] **T6 Read service.** `backend/src/bonds/bond-valuation.service.ts`, `backend/src/bonds/bonds.module.ts`, unit spec, integration spec. Depends on T4 and T5.
- [ ] **T7 Invariant entries.** INV-BOND-001 to INV-BOND-004 in `docs/system-invariants.md`, with honest status.

## Later PRs

See the phase table in the plan. Each starts with its own task list section here before code.
