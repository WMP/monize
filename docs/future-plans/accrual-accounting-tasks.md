# Accrual accounting integration tasks

- [x] Capture the pre-accrual baseline and isolate the accrual delta by file hashes.
- [x] Fetch upstream and fork refs; fast-forward local main and branch from latest upstream.
- [x] Transfer persistence, backend, frontend, reporting and test changes.
- [x] Resolve upstream overlaps while retaining warranty and reporting changes.
- [x] Record the feature contract and integration plan before the implementation commit.
- [ ] Finish current-upstream compatibility checks and regression validation.
- [ ] Record the final changed-file inventory and validation evidence.
- [x] Commit the implementation with Conventional Commits and AI co-author trailer.
- [ ] Obtain/link upstream scope approval, ownership and approved-to-build designation.
- [ ] Agree on upstream default and review-series size with the maintainer.
- [x] Publish the requested feature branch and PR (upstream PR #1883).

## Resumed validation, October 26, 2026

The published branch includes the specification, implementation, translations and CI guard fixes. PR #1883 is open. The prior uncommitted handoff is historical.

An additional rule/accrual regression suite covers reviewed manual edits, automatic-write refusal, deleted references, stale source hashes, history restoration and source locking. Its focused run passes 24 tests; strict lint and backend test-inclusive types pass. The full backend coverage gate is being rechecked without changing thresholds.

The published frontend CI run has one failure in the unchanged investment transaction form's dated-FX rejection test. Its complete 100-test file passes locally; this remains a reported CI failure, not a verified fix. No investment code or assertion was changed.
