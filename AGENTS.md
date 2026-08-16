# Repository Agent Instructions

## State-flow-first rule for major features

Before implementing any new major feature, or materially extending an existing one, define or update an executable state-flow contract. The contract must enumerate every state/discriminator value, classify every source-to-destination transition, classify fields owned by each destination state (required, optional, derived, or reset), and identify financial side effects, missing/null/zero semantics, authorization boundaries, and locking/idempotency boundaries. Generated tests must enumerate the complete state and transition matrix. A new enum member, writer, state, or transition that is not classified must fail CI.

Keep the contract beside the canonical domain code and use `backend/src/common/financial-invariants/state-flow.contract.ts`; do not substitute a diagram or prose-only checklist. Alternative writers such as imports, restore, scheduled posting, overrides, background jobs, undo/redo, AI/MCP actions, previews, and forecasts must either route through the same contract or have explicit parity tests.

## Financial safety gate

Run `cd backend && npm run test:financial-invariants` for changes affecting amounts, balances, currencies, transfers, splits, scheduled posting, occurrence overrides, investments, securities, holdings, loans, mortgages, lines of credit, imports, forecasts/previews, financial persistence, concurrency, or idempotency.

- New financial enum members must be represented by exhaustive executable contracts.
- New financial writers must be registered or covered by a mechanical writer guard and behavioral tests.
- Locking, isolation, uniqueness, and idempotency claims require real PostgreSQL integration tests; mocked unit tests are not sufficient evidence.
- CI and executable guards are authoritative. Do not weaken a guard or expand an allowlist without a concrete invariant, failure scenario, and negative control.
