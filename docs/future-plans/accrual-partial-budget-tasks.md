# Partial accrual budget FX tasks

- [x] Commit the boundary and validation plan before implementation.
- [x] Implement scoped monetary accumulation and explicit unknown-result response.
- [x] Wire REST and assistant/MCP budget read boundaries; preserve strict/native writes.
- [x] Recognize partial responses and show known components without zero/stale charts.
- [x] Verify known/missing currency, repair/retry, request isolation and bounds with real PostgreSQL and UI tests.
- [x] Run focused types/guards/regressions and update server records.


Focused evidence: enforced PostgreSQL budget boundary repair/recovery, scoped request-isolation and diagnostic-bound units, typed frontend rejection/retry and known-component panels, source/test types. Final whole-branch validation remains in the main accrual task list. This completion does not cover non-budget monthly charts or independently retained legacy budget metadata.
