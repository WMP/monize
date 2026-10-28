# Shared expenses UI review: task list

Plan: `docs/future-plans/shared-expenses-ui-polish.md`.
Specification: `docs/specs/shared-expenses-ui-polish.md`.

## Approval and preparation

- [x] Read the current Discussion, issue, PR comments, reviews and inline comments.
- [x] Pin Ken's review and the published revision; inspect affected feature code.
- [x] Identify the existing Transactions controls and the FX/category conflict.
- [x] Prepare a proposal covering UI-01 through UI-11 and numerical examples.
- [x] Requester approves the spec, including section 5's proposed FX policy.
- [ ] Recheck branch state, fast-forward while preserving Ken's merge, and commit
  the approved spec before its implementation.
- [ ] Read in full the relevant layer/contract documents before code changes;
  analysis excerpts do not satisfy that implementation precondition.

## Implementation after approval

- [ ] UI-01/UI-04: staged attachments in the expense form, successful close,
  in-place upload recovery, no redundant item/amount description.
- [ ] UI-02/UI-05: group and expense tables with existing filter presentation,
  server paging, accessible rows and phone layouts.
- [ ] UI-03: standard money/currency composition across entry, split and booking.
- [ ] UI-06/UI-07/UI-08/UI-11: transaction wording, standard creation form,
  category placement, matched-source preservation and relevant allocation controls.
- [ ] UI-10: historical matching, server eligibility before paging and source
  freshness/ownership checks.
- [ ] UI-09: approved FX/category policy, same server preview/commit resolver,
  stored-source compatibility and consumer/report consistency.
- [ ] Document each corrected convention at its existing instruction/doc location
  with a regression; no guard-baseline growth.

## Verification and publication

- [ ] Run focused regressions during development; demonstrate the original
  failure for changed behavior where feasible.
- [ ] Frontend gate: `npm run lint`, `npm run type-check`, `npm run i18n:check`,
  `npm run test:changed`, production build.
- [ ] Backend gate: `npm run lint`, `npx tsc --noEmit`, `npm run typecheck`,
  `npm run test:changed`, `npm run build`, `npm run test:integration`.
- [ ] Root checks: `node scripts/check-env-docs.mjs` and
  `node scripts/check-docs-manifests.mjs`; stage new files before tree-walking guards.
- [ ] Browser acceptance: expense save plus documents/retry, new personal payment,
  old matched source, partial/split match, FX cases, phone table/filter/currency
  controls; assert persisted results after reload.
- [ ] Grep E2E selectors for renamed labels; update the driven controls' tests.
- [ ] Develop English-first, regenerate pseudo-locale, then finish every supported
  locale after functional copy stabilizes, as the final implementation commit.
- [ ] Capture the running implementation with synthetic data; label images/video
  by the actual tested revision and distinguish older evidence.
- [ ] Normal push to the existing feature branch; read back the PR head.
- [ ] Add NEW Discussion and issue comments with changes, evidence and remaining
  review items; do not replace earlier replies with progress updates.

## Resource budget

Use the existing native verification mirror. One heavy command or database-backed
suite at a time, one worker, a process-group memory limit of 3500 MiB, limited CPU,
and at least 1536 MiB available host memory. If that reserve is crossed, stop the
owned workload and report it. Do not launch Docker or unrelated services.

The ordinary build may exceed that limit during combined phases. Use the supported
sequential compile/type-check/generate phases if needed and report their evidence
accurately. Do not call the combined build passed when it was stopped.

Run the assembled gate once; follow failures with focused checks. Repeat a broad
run only if later material changes invalidate its evidence. Coverage is CI's gate
unless the user separately requests a local coverage run. Stop task-owned services
after browser/database checks. No product tests or services are needed to approve
this documentation-only proposal.
