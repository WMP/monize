# Shared expenses tasks

Execute [the plan](shared-expenses.md) against the requester-accepted
[financial spec](../specs/shared-expenses.md) and
[UX contract](../specs/shared-expenses-ux.md).

## Current handoff — 2026-10-27

Branch `feat/shared-expenses` is based on upstream `ed148f527`. The spec/plan
commit preceded implementation. The user authorized
[Draft PR #1890](https://github.com/kenlasko/monize/pull/1890) and
[Discussion #1889](https://github.com/kenlasko/monize/discussions/1889) to seek
maintainer scope approval. [Issue #1891](https://github.com/kenlasko/monize/issues/1891)
tracks the concrete feature request under the Discussion guidelines. Upstream approval and the `approved-to-build` label
remain pending. Merge remains a maintainer decision.

| ID | Deliverable | Status |
| --- | --- | --- |
| S1 | Spec and execution plan before financial code | Committed; upstream scope approval pending |
| B1 | Exact allocations, FX tuples, balances, refunds | Implemented; numeric unit cases passed |
| B2 | Schema, six migrations, RLS, backup classification | Implemented; final two-pass schema replay passed |
| B3 | Groups, contacts, roles, invitations, ownership consent | Implemented; enforced-RLS feature suites passed |
| B4 | Private ledger, bank payments, category portions and source protection | Implemented; booking integration passed |
| B5 | Group files, publication, activity, exports, notifications | Implemented; lifecycle integration passed |
| B6 | Detached restore, private ledger retention and erasure | Implemented; lifecycle integration passed |
| F1 | Group/people screens, splits, refunds and repayments | Implemented; production browser journeys passed |
| F2 | Bank matching, combined save and private review | All seven production Chromium journeys passed after UX refinement |
| Q1 | Financial, authorization and concurrency regressions | Changed-test gates and full PostgreSQL integration passed |
| Q2 | Desktop/mobile browser captures | Ten production captures refreshed and visually reviewed |
| L1 | Every supported locale and generated pseudo-locales | All supported locales authored and parity checked; separate final commit |
| Q3 | Gates, invariant catalog, consumer audit and PR | Local gates passed; upstream scope, review-series agreement and CI pending |

## Implementation baseline verified at `d83568b96`

- Backend lint, source/test typechecks, pseudo-locale check and build passed.
  The final `test:changed` gate passed all 582 selected files, including 67 guards,
  with zero failing tests.
- All 47 PostgreSQL cases in the four shared-feature/support suites passed,
  including two lock-blocked invitation claimants, rollback after an injected
  balance-write failure, revoked document access and detached backup restore.
  The complete integration run passed all 168 suites: 1846 cases passed and
  eight existing live-S3 cases were skipped because `BACKUP_STORE_S3_TEST_ENDPOINT`
  was not configured. Their gate in
  `backend/test/integration/backup-store-s3.integration.spec.ts` is unchanged from
  upstream. The serial PostgreSQL run took about 14.5 minutes.
- Frontend lint, typecheck, pseudo-locale check and `test:changed` passed:
  867 files / 16,171 cases, including all 37 selected guards.
- The standard frontend `npm run build` passed on the final source in 90 seconds,
  with a 2831 MiB memory peak inside a 4096 MiB ceiling. A cold attempt had reached
  that ceiling; separate compile/type-check/generate steps prepared the cache
  before the successful standard build. No type checks or build steps were skipped.
- All six final Chromium journeys passed against that production build, with
  one worker and zero retries. The review journey caught a missing `main`
  landmark; its scoped assertion is retained. Four new pages now follow the
  existing group page's landmark and responsive padding. Persistence and account
  balances are checked after reload.
- Native PostgreSQL 16 replayed all 253 retained migrations twice with matching
  normalized schema dumps. Migration lint/self-tests, environment documentation,
  documentation manifests and migration-prefix checks passed.
- Frontend unit tests ran with this run's generated ignored vendor assets archived
  outside the checkout, following the upstream test/build artifact boundary.
  The public-script guard is unchanged; the subsequent build regenerated the assets.
- Four guard decisions were explicitly authorized by the requesting user:
  shared-document export scope, one derived-posting rule exemption, checked
  transient restore-field clearing, and the two support-backup completeness
  checks. These are local authorizations, not upstream security review.

## UX refinement — 2026-10-27

The [UX review](shared-expenses-ux-review.md) records the findings and reference
flows. Ordinary expenses now request a read-only server preview after a typing
pause, with one explicit Save action. The preview displays personal cost and the
position change separately. Exact-split helpers appear when a remainder exists;
mobile balances and primary actions use less vertical space. Entry, split and
private-booking dialogs retain their title and footer while the body scrolls.

The financial/domain implementation is unchanged from the baseline above. New
frontend regression cases exercise current-draft identity, delayed responses,
failed preview retry, unchanged command/fingerprint after a lost save response,
and split helper behavior. Production browser assertions also check that the
ordinary-entry and private-booking title and acceptance action remain in the
viewport after scrolling.

- Focused editor/split/summary tests: 3 files, 21 cases passed.
- Frontend lint, typecheck and pseudo-locale check passed. The final
  `test:changed` gate passed 867 files / 16,178 cases, including all 37 selected
  guards; its bounded run took 1864 seconds with at least 4705 MiB host memory
  available.
- The standard production build passed in 30 seconds, with a 2611 MiB peak
  inside the 4096 MiB ceiling and at least 3755 MiB host memory available.
  It ran normal type checking and page generation.
- All seven production Chromium journeys passed with one worker and zero
  retries. Ten final captures were visually reviewed. The added ordinary-bill
  journey checks no entry exists before Save and one persisted entry after it.
- All supported locale catalogs include the finalized copy; the pseudo-locale
  was regenerated from English. Foreign translations form the final commit.

No Docker or database integration rerun was needed for this frontend-only
refinement. The browser services were stopped before the changed-test gate;
this build's generated vendor assets were archived outside the test checkout,
following the same upstream artifact boundary as the baseline run.

## Upstream synchronization — 2026-10-27

The requester authorized rebasing the published branch onto `ed148f527` and a
push guarded by the previous fork-head value. The only application-source differences from
the published UX revision `54d8e3ad0` are the four upstream Tools-menu/payroll-form
files. The navigation-test conflict preserves the owner-only shared-expenses
link while adopting the upstream ordering. The two affected test files passed
all 20 cases in the prepared candidate; backend/database and UX source and
catalogs are unchanged.

Post-rebase frontend lint, typecheck and locale checks passed. The full
`test:changed` gate passed 867 files / 16,178 cases, including 37 guards, in
1978 seconds with at least 3845 MiB host memory available. The standard
production build passed in 46 seconds with a 2150 MiB peak inside its 4096 MiB
ceiling. All seven Chromium journeys then passed with one worker and zero
retries. The ten runtime captures were reviewed after synchronization.
The browser services were stopped after verification; Docker was not started.

## Browser captures

These are synthetic users and amounts, captured from the production build with
1440×900 desktop and 360×800 mobile viewports. Some captures include the full page.
The ten images below are from the final UX-refined production build.

| Capture | What it shows |
| --- | --- |
| [Ordinary expense, desktop](shared-expenses-screenshots/expense-preview-desktop.png) | Automatic server preview of a 300 bill: own cost 100, claim 200 |
| [Ordinary expense, mobile](shared-expenses-screenshots/expense-preview-mobile.png) | Bill context and Save remain visible at 360px |
| [Unequal split](shared-expenses-screenshots/unequal-split-desktop.png) | A 300 expense split into 80, 110 and 110 |
| [Group overview](shared-expenses-screenshots/group-desktop.png) | Own cost 80 and amount owed 220 |
| [Mobile balances](shared-expenses-screenshots/balances-mobile.png) | A partial repayment reduces the amount owed to 170 |
| [Group files](shared-expenses-screenshots/files-desktop.png) | One persisted file linked to its expense |
| [Bank preview](shared-expenses-screenshots/bank-preview-desktop.png) | Existing bank debit 300, personal cost 100 and claim 200 |
| [Combined mobile booking](shared-expenses-screenshots/combined-bank-mobile.png) | A 350 basket with 50 private consumption and a 300 shared portion |
| [Category portions](shared-expenses-screenshots/category-portions-desktop.png) | Selected portions from the original bank split |
| [Private review](shared-expenses-screenshots/personal-review-desktop.png) | Group edits waiting for the account owner's acceptance |

## Remaining review work

1. Obtain maintainer agreement on scope, security boundaries and a smaller PR
   series; this draft currently collects the implementation for that discussion.
2. Complete upstream CI and human review, including the planned usability study.
   Keep unmet PR checklist boxes unticked until that evidence exists.

The [consumer audit](../specs/shared-expenses-consumers.md) and
[security decisions](../specs/shared-expenses-security.md) are the review guides.
All owned test services have been stopped and the temporary RAM database removed.

## Local verification environment

The working tree is authoritative. An identical Linux checkout uses upstream
locked dependencies. One test/build runs at a time, in UTC with one worker;
database suites share only the throwaway `monize_test` and overlap no other check.
Docker has not been started in this resume.

Systemd scopes bound memory (normally 3500 MiB), swap and CPU. The isolated
PostgreSQL 16 service uses loopback port 15433 and UTC. Schema replay used a
768 MiB ceiling. The full integration run uses a temporary RAM-backed cluster
under a 1280 MiB ceiling covering both processes and database files; fsync,
synchronous commit and full-page writes stay enabled. The initial disk run was
interrupted because WSL file synchronization dominated execution time. Existing
local databases are not review targets. The browser app services are stopped
between runs. Private logs are in ignored `tmp/shared-expenses-spec/`.

The planned human usability study remains outstanding; automated browser checks
do not replace it. Upstream CI and maintainer approval are reported separately
from these local results.
