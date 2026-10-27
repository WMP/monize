# Shared expenses tasks

Execute [the plan](shared-expenses.md) against the requester-accepted
[financial spec](../specs/shared-expenses.md) and
[UX contract](../specs/shared-expenses-ux.md).

## Current handoff — 2026-10-27

Branch `feat/shared-expenses` is rebased onto upstream `b70868dda`. The spec/plan
commit preceded implementation; current commits are `e0a9a7e34` (spec),
`ca15ea80f` (backend) and `20ca83c46` (frontend). The user authorized an upstream
Draft PR and Discussion to seek maintainer scope approval while checks continue.
There is no upstream approval or approved-to-build label yet. Merge remains a
maintainer decision.

| ID | Deliverable | Status |
| --- | --- | --- |
| S1 | Spec and execution plan before financial code | Committed; upstream scope approval pending |
| B1 | Exact allocations, FX tuples, balances, refunds | Implemented; numeric unit cases passed |
| B2 | Schema, six migrations, RLS, backup classification | Implemented; final rebased schema replay pending |
| B3 | Groups, contacts, roles, invitations, ownership consent | Implemented; enforced-RLS recheck passed |
| B4 | Private ledger, bank payments, category portions and source protection | Implemented; rebased integration recheck passed |
| B5 | Group files, publication, activity, exports, notifications | Implemented; rebased lifecycle recheck passed |
| B6 | Detached restore, private ledger retention and erasure | Implemented; rebased lifecycle recheck passed |
| F1 | Group/people screens, splits, refunds and repayments | Implemented; final browser review pending |
| F2 | Bank matching, combined save and private review | Implemented; six final Chromium journeys pending |
| Q1 | Financial, authorization and concurrency regressions | Added; final gates pending |
| Q2 | Desktop/mobile browser captures | Six earlier captures reviewed; final refresh pending |
| L1 | Every supported locale and generated pseudo-locales | All translations authored locally; final localization commit pending |
| Q3 | Gates, invariant catalog, consumer audit and PR | Invariants/audit written; draft publication and final verification in progress |

## Verified evidence

- After rebase: frontend lint, typecheck and pseudo-locale check passed, plus
  6 focused files / 380 tests covering attachment staging, register controls,
  action sheet, bank eligibility and E2E conventions.
- After rebase: backend lint, source/test typechecks, pseudo-locale check and
  build passed. All 47 PostgreSQL cases in the four shared-feature/support suites
  passed, including two lock-blocked invitation claimants and rollback after an
  injected balance-write failure.
- Before rebase: controlled restore checks passed 53 cases, support-reference
  unit checks passed 69 cases, and support-backup integration passed all 5 cases.
  The latter checks actual exported columns and complete composite FK tuples.
- Before rebase: native PostgreSQL 16 replayed 252 migrations twice with matching
  normalized schema dumps; migration lint/self-tests and root env/docs/prefix
  checks passed. Replay must be repeated after upstream migrations and the final
  shared-document FK fix. The FK fix installs constraints independently of
  whether entity synchronization already created the columns.
- Four guard decisions were explicitly authorized by the requesting user:
  shared-document export scope, one derived-posting rule exemption, checked
  transient restore-field clearing, and the two support-backup completeness
  checks. These are local authorizations, not upstream security review.
- The earlier full integration run was interrupted to correct the isolated
  database timezone to UTC. Its 12 attachment lease cases then passed. It is not
  a completed full gate. The reported SimpleFIN lock inversion is fixed by
  upstream `main`; verify the inherited fix in the final run.
- The old frontend broad run had a generated-vendor-assets guard failure. The
  maintainer's upstream note explains the test/build artifact boundary; final
  tests use a fresh Linux checkout, before builds create those ignored assets.
- Earlier default frontend builds hit the bounded memory budget; the Webpack
  alternative failed on the existing scanner's browser import of node:module.
  A final default-build attempt is pending on the rebased tree with a monitored
  4096 MiB ceiling and a 1536 MiB host-memory reserve.

## Remaining sequence

1. Finish the rebased shared integration check, including a two-connection
   invitation claim and an injected failure after the booking starts writing.
2. Run backend/frontend changed-test gates once on the final source. Run the
   native schema replay, root metadata checks and full serial backend integration.
3. Run the bounded frontend production build and six Chromium journeys; refresh
   and inspect every saved desktop/mobile capture. Record failures explicitly.
4. Commit resulting fixes and refreshed evidence, then translations last. Keep
   the [consumer audit](../specs/shared-expenses-consumers.md) and
   [security decisions](../specs/shared-expenses-security.md) aligned with results.
5. Publish/update the user-requested Draft PR and Discussion with completed
   checks, remaining work and AI disclosure. Leave approval, complete-suite and
   human-review boxes unticked until their evidence exists. Do not merge.

## Local verification environment

The source of truth is the working tree. An identical Linux checkout uses
upstream locked dependencies;
synchronize subsequent edits before checking it. Docker has not been started
in this resume. One test/build runs at a time, in UTC with one worker.

Systemd scopes bound memory (normally 3500 MiB), swap (256 MiB) and CPU. The
isolated PostgreSQL 16 service uses loopback port 15433, UTC and a 768 MiB ceiling.
Existing local databases are not review targets. Database suites share only the
throwaway `monize_test` and never overlap another test/build process.

Private logs are in ignored `tmp/shared-expenses-spec/`. Screenshots and fixtures
use synthetic users and amounts. The planned human usability study remains
outstanding; automated browser checks do not replace it.
