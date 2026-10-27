# Shared expenses implementation

Status: authorized locally by the requesting user on 2026-10-25; implementation
branch `feat/shared-expenses`, rebased onto `b70868dda`. On 2026-10-27 the user
requested an upstream Draft PR and Discussion for scope review before maintainer
approval. The draft remains unapproved and is not ready to merge.

The accepted product contracts are [financial behavior](../specs/shared-expenses.md)
and [interaction/document behavior](../specs/shared-expenses-ux.md). The
[task list](shared-expenses-tasks.md) records progress and evidence. This plan does
not expand into the deferred offline sync, OCR allocation, recurring expenses,
historical imports, cross-group netting or payment initiation.

## Assumptions and architecture

- A person can participate without a login. Claimed memberships grant group
  access, independently of private bank accounts and private contacts.
- The group journal is the authority for shares and repayments. Own ledger
  postings are explicit, private and pinned to accepted financial inputs.
- One managed settlement account per user/group represents booked claims/debts;
  bank movements retain their identity. Category rows represent own consumption.
- Exact integer allocations and frozen original/group currency tuples are shared
  by preview and commit. Missing FX produces a named unresolved state.
- Shared documents have a group or entry parent. Publishing a private file makes
  an independent authorized copy; original scan images need explicit opt-in.
- Use existing Nest/TypeORM, scoped database access, React controls, money/date
  formatting, notifications and attachment providers. No new dependency is planned.

## Delivery order and edit areas

1. Commit accepted specifications and this plan before changing financial code.
2. Add exact allocation/balance helpers and adversarial fixtures in the backend
   shared-expenses feature. Keep each helper small and independent of HTTP/storage.
3. Add paired schema/migration definitions, membership authorization and bounded
   DTOs. Tables cover groups, participants, memberships, contacts/mappings,
   invitations, entries/allocations, activity, private integration and command
   receipts. Add database sum/identity constraints, RLS policies and required
   database-function registration; classify each table for backup/support backup.
4. Implement scoped group, participant, invitation, entry and repayment services
   and authenticated controllers. Serialize financial commands by group before
   accounts/transactions. Recheck access/revision inside the write transaction.
5. Implement the personal posting bridge through the ledger's existing mutation
   primitives. Guard linked rows against generic edit/delete/VOID/bulk/rules/undo
   and AI/MCP bypasses. Include report classification, account pickers, cache
   invalidation and bank-transaction matching. Resolve private review states.
6. Extend shared attachment parent/types, upload/preview/publish authorization,
   storage lifecycle and group document limits. Wire activity, exports and muted
   group notifications. Restore user snapshots as detached groups without live
   membership grants; preserve canonical relationships in instance recovery.
7. Add frontend types/API, translated navigation and group/people/detail screens.
   Build expense/split/repayment editors, document flows, invitations and private
   finance review from shared Monize primitives. Add register entry points.
8. Prove behavior through focused unit/component tests, real PostgreSQL identity
   and concurrency tests, and browser journeys with reload assertions. Run the
   complete required gates once the affected layers are ready.
9. Finish translation parity across supported locales, capture real desktop/mobile
   screenshots, and prepare a truthful PR description with validation and limits.

## Observable acceptance

- PLN 300 paid by me for three yields bank -300, own expense 100 and claim 200;
  repayment 100 yields bank +100 and claim -100 with no income.
- A partial shared basket (350 bank / 300 shared / own share 80) yields own cost
  130 and claim 220. Several payers, unequal splits and currency precision follow
  the spec fixtures; no float accumulation or missing-rate substitution.
- Solo groups, later participant claims and revoked access preserve history and
  expose no private account or source-document data.
- A group booking PDF needs no financial row. Failed file upload/retry creates no
  extra expense. A cropped shared scan exposes no unselected private original.
- Group edits from another member do not write my private ledger; review explains
  the difference. Rejected/stale commands leave every affected balance unchanged.
- Mobile entry, cancel/back, rounding, duplicate import matching, partial repayment,
  refund after settlement, archive/reopen, export and restore survive reloads.

## Verification and review artifacts

During development run focused backend/frontend tests and stage new files before
tree-walking guards. Final backend gate is `lint`, `tsc --noEmit`, `typecheck`,
`test:changed`, `migration:lint`, `build` and serial `test:integration` in UTC.
Final frontend gate is `lint`, `type-check`, `i18n:check`, `test:changed`, `build`.
Run the schema replay/prefix checks and the repo's docs/env checks. Browser tests
use the existing E2E stack, one worker, fresh users and real API seeding.

Screenshots come from the running feature, with seeded fictional data, at desktop
and phone sizes; capture group overview, unequal split, files, balances and bank
integration. Keep the narrative clear about which checks ran and which failed.
Usability targets in the UX contract remain targets until observed in user tests;
automated browser checks do not establish the five-person formative study.

PR preparation follows the repository template and names SE-001 through SE-012
and existing affected invariants. Do not tick the upstream approval/label or human
review boxes without evidence. The user requested a branch ready for a later PR,
not publication now.
