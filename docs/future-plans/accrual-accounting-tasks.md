# Accrual accounting integration tasks

- [x] Capture the pre-accrual baseline and isolate the accrual delta by file hashes.
- [x] Fetch upstream and fork refs; fast-forward local main and branch from latest upstream.
- [x] Transfer persistence, backend, frontend, reporting and test changes.
- [x] Resolve upstream overlaps while retaining warranty and reporting changes.
- [x] Record the feature contract and integration plan before the implementation commit.
- [x] Finish current-upstream compatibility checks and regression validation.
- [x] Record the final changed-file inventory and validation evidence.
- [x] Commit the implementation with Conventional Commits and AI co-author trailer.
- [ ] Obtain/link upstream scope approval, ownership and approved-to-build designation.
- [ ] Agree on upstream default and review-series size with the maintainer.
- [x] Publish the requested feature branch and PR (upstream PR #1883).

## Resumed validation, October 26, 2026

The published branch includes the specification, implementation, translations and CI guard fixes. PR #1883 is open. The prior uncommitted handoff is historical.

An additional rule/accrual regression suite covers reviewed manual edits, automatic-write refusal, deleted references, stale source hashes, history restoration and source locking. Its focused run passes 24 tests; strict lint and backend test-inclusive types pass. The full backend coverage gate passes without changing thresholds: 1,111 suites, 28,934 passing tests and four existing skips; statements 95.01%, branches 85.95%, functions 95.04%, lines 95.87%. Import protections and reporting provenance mapping have 17 additional passing cases.

The published frontend CI run has one failure in the unchanged investment transaction form's dated-FX rejection test. Its complete 100-test file passes locally; this remains a reported CI failure, not a verified fix. No investment code or assertion was changed.

## CI compatibility repair

Corrected dated-rate test fixtures, FK comparison by reference target, budget basis query validation, and the nullable account-summary / LLM native-bucket adapters. Cash-specific browser scenarios request cash mode explicitly. Final changed backend batch passes 714 files, including guards; targeted browser scenarios pass eight cases each in Chromium and Firefox with no retries. Full GitHub CI must be rechecked on the repair commit.

## Bill reminder projection regression

- [x] Reproduce the maintainer's notification-column error against PostgreSQL with enforced RLS.
- [x] Restore ordinary scoped notification reads and restrict recognition projection to transaction roots.
- [x] Verify due reminders and repeated-read deduplication in cash/accrual mode, plus adjacent reporting coverage: 28 integration tests and 774 changed backend test files/guards pass.

## October 28 maintainer review

- [x] Reproduce transfer/investment RLS performance on a synthetic PG16 ledger through real services.
- [x] Replace scalar identity lookups with set-based mappings and add the full schedule source index.
- [x] Restore the initial migration Cash default without overwriting saved choices.
- [ ] Restore native Cash reads, SQL aggregation, bounded FX history and partial-result contracts.
- [ ] Repair recurring-charge grouping, monthly distinct counts and closed-budget snapshots.
- [x] Remove optional frontend accrual calls/cache clears when disabled and restore independent panel errors.
- [ ] Reduce import/taxonomy/rule/source-write locks and snapshots without opening schedule-creation races.
- [x] Preserve recognition date rules in combined saves and history/undo.
- [x] Repair stale split previews, reconcile fingerprints, bulk-update races and oversized history.
- [x] Review preview locks, delegate limits, SQL rewriting and unused UI code.
- [ ] Diagnose current backend-unit and security-scan CI failures.
- [ ] Run merged-source gates, record exact changed files and sync server development records.
- [ ] Push validated commits and summarize addressed findings on PR #1883.

### Resumed review repair checkpoint, October 28

Targeted database reruns passed: provenance18; budgets/close/rollover10; editor/history/incremental27; rule runs15. Backend and frontend types passed at that checkpoint. Optional-request gating fixture is corrected with explicit disabled-no-fetch coverage. Payee required-history failures remain visible rather than becoming empty arrays.

A captured full frontend run identified the remaining category-history failures, a read-only preview misclassified by the balance-cache guard, and generated public vendor files rejected by the unchanged public-script guard. The owner approved only an exact preview-route exemption, with neighboring-write regression checks. Category/budget required history failures and legacy date-rule recovery are being repaired; full final gates remain pending. Closed-period accrual category membership and grouped category reads are also in progress. These notes do not mark the larger partial-FX, oversized-history or taxonomy-scope work complete.

## 2026-10-29 taxonomy review repair

- [x] Replace operation-level whole-ledger taxonomy freeze with selected source/parent and FK-target locks, fresh membership checks and scoped owner authorization.
- [x] Share sorted subtree/ancestry category locks with the category editor; retain fresh graph validation.
- [x] Verify source-parent ordering, unrelated-row availability, first-schedule creation, membership races, delegated scope, taxonomy undo/redo and oversized alias restoration in enforced PostgreSQL.
- [ ] Finish adjacent standalone writer lock-order/cost audit; the combined import/taxonomy/rule/source-write item above remains open.

Targeted PostgreSQL suites52 unique tests have passing results; final scoped suite7/7 passes again after the role-closure guard. Source/test types pass. Changed-backend gate746/747 files pass; six failures in an unchanged AI-review spec come from its fixed expiry `2026-10-29T08:00:00Z`. The unchanged file104/104 passes with a temporary external pre-expiry clock diagnostic; the normal gate remains red. No tests or guards weakened. Remaining reporting/FX and final whole-source gates stay open.


## October 29 continuation

- [x] Resolve Cash net-worth precision and enforce effective-owner consistency without rewriting native Cash SQL.
- [x] Preserve stored budget history/cache behavior for selected Accrual with no schedules.
- [x] Use retained closed-period membership in active Accrual health trend comparisons.
- [x] Share parent-first source locking and fresh required-membership validation with import matches.
- [x] Move stale-save, removal, income-preview and lookup-retry coverage to the active editor; remove approved obsolete components/tests.
- [x] Verify explicit partial budget response, known components, repair/retry and request isolation.
- [ ] Finish non-budget monthly partial-FX contract and per-row FX rounding assessment.
- [ ] Record retained schema/index/automatic-rule limitations and final whole-source verification before publishing.

Owner-approved Cash precision/owner-scope regressions pass; the reporting surface suite7/7 and budget suite5/5 pass under enforced RLS. Active editor/form243/243 and adjacent backend135/135 pass. Broad backend gate encountered two index-scanning guards because approved deletions were unstaged; after staging, both unchanged guards pass20/20. Whole-branch final gate/build/integration results are recorded separately and not implied by these focused counts.
