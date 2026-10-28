# Accrual read-model redesign tasks

- [x] Record the owner-approved redesign contract and implementation sequence.
- [x] Reproduce the large-ledger slowdown and save baseline evidence.
- [x] Implement feature-off cash execution and consistent defaults/selection.
- [x] Move accrual settings into Transactions above quick-fill.
- [x] Implement explicit scoped recognition relations/readers without ledger table shadowing.
- [x] Migrate register, report, budget and export readers.
- [x] Validate retained schedule edits while disabled and re-enable behavior.
- [x] Pass zero/one/many-schedule large-ledger regression tests and capture plans/timings.
- [ ] Pass correctness, RLS, static, migration and browser checks.
- [ ] Refresh changed-file inventory, publish tested commits and report remaining CI state.

The final integration/static rerun is in progress. The frontend public-script guard also fails on the published baseline after vendor generation; its allowlist is unchanged. Publication remains on hold. Server evidence and the changed-file inventory are under the accrual development directory in `pr-preparation/READ-MODEL-REDESIGN-STATUS.md` and `READ-MODEL-REDESIGN-FILES.json`.
