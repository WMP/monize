# Shared expenses tasks

Execute [the plan](shared-expenses.md) against the accepted financial and UX specs.
Keep evidence here so a resumed session continues the same implementation.

| ID | Deliverable | Dependency | Status |
| --- | --- | --- | --- |
| S1 | User-authorized spec and execution plan committed on new feature branch | None | In progress |
| B1 | Exact allocation, currency tuples, balances/refunds and numeric tests | S1 | Pending |
| B2 | Schema/migration, RLS, entities/DTOs, backup classification | B1 | Pending |
| B3 | Group/contact/member/invitation and financial command APIs | B2 | Pending |
| B4 | Optional own-ledger integration, linked-row protections and report semantics | B3 | Pending |
| B5 | Shared file parents, publication/copies, activity/export/notifications | B3 | Pending |
| B6 | Detached user restore, erasure and group lifecycle | B4, B5 | Pending |
| F1 | Navigation, group/people pages and entry/split/repayment UX | B3 | Pending |
| F2 | Files, invitations, bank matching and private review UX | B4, B5, F1 | Pending |
| Q1 | Focused and cross-layer financial/authorization/concurrency tests | B1-B6 | Pending |
| Q2 | Browser journeys, responsive review and real screenshots | F2, Q1 | Pending |
| L1 | Final translation pass and generated pseudo-locales | F2 | Pending |
| Q3 | Required gates, documentation/invariant evidence and PR description | Q2, L1 | Pending |

## Evidence and environment

- Repository was clean except the three new specification documents from this
  task. Created `feat/shared-expenses` from freshly fetched `origin/main`.
- Docker is available; no running application containers were found initially.
  The default development compose needs an env file; use the self-contained E2E
  stack for isolated validation, without production/user data.
- Installing existing locked dependencies does not change dependency versions.
- No upstream Discussion, issue label or PR has been created or claimed.
