# Shared expenses UI review: task list

Plan: `docs/future-plans/shared-expenses-ui-polish.md`.
Specification: `docs/specs/shared-expenses-ui-polish.md`.

## Current scope

- [x] Recheck edited PR comments as well as new Discussion/issue replies.
- [x] Identify the newly added restriction on accounts and possible deferral of
  core integrations; record the narrower proposal in specification section 0.
- [x] Retain the original approval and subsequent scope correction as history.
- [x] Requester approves the narrower boundary; revise the plan and acceptance
  matrix. New private posting, matching and private FX redesign are deferred.

## Approval and preparation

- [x] Read the current Discussion, issue, PR comments, reviews and inline comments.
- [x] Pin Ken's review and the published revision; inspect affected feature code.
- [x] Identify the existing Transactions controls and the FX/category conflict.
- [x] Prepare a proposal covering UI-01 through UI-11 and numerical examples.
- [x] Requester approves the spec, including section 5's proposed FX policy.
- [x] Recheck branch state, fast-forward while preserving Ken's merge, and commit
  the earlier approved spec before its implementation (`69734062d`).
- [ ] Read in full the relevant layer/contract documents before code changes;
  analysis excerpts do not satisfy that implementation precondition.

## Implementation

- [ ] Block new private-finance commands at the server, with HTTP regressions;
  retain existing reads/unlink and their ownership checks.
- [ ] Remove creation/handoff controls and handle old URLs; retain access to
  already-created private records.
- [ ] UI-01/UI-04: staged attachments, successful close, in-place retry and no
  redundant item/amount subheading.
- [ ] UI-02/UI-05: group and expense tables, standard filter presentation,
  accessible rows, server paging and phone layouts.
- [ ] UI-03: standard currency square and input; retain precision and group FX.
- [ ] Document corrected conventions with regressions, without baseline growth.

## Verification and publication

- [ ] Run focused regressions during development; demonstrate the original
  failure for changed behavior where feasible.
- [ ] Frontend gate: `npm run lint`, `npm run type-check`, `npm run i18n:check`,
  `npm run test:changed`, production build.
- [ ] Backend gate: `npm run lint`, `npx tsc --noEmit`, `npm run typecheck`,
  `npm run test:changed`, `npm run build`, `npm run test:integration`.
- [ ] Root checks: `node scripts/check-env-docs.mjs` and
  `node scripts/check-docs-manifests.mjs`; stage new files before tree-walking guards.
- [ ] Browser acceptance: expense save/documents/retry, six-person allocations,
  repayments, group FX, phone tables/filters/currency controls and refused new
  private integration; assert persisted results after reload.
- [ ] Grep E2E selectors for renamed labels; update the driven controls' tests.
- [ ] Develop English-first, regenerate pseudo-locale, then finish every supported
  locale after functional copy stabilizes, as the final implementation commit.
- [ ] Capture the running implementation with synthetic data; label images/video
  by the actual tested revision and distinguish older evidence.
- [ ] Normal push to the existing feature branch; read back the PR head.
- [ ] Add a NEW PR progress comment following Ken's requested review location;
  keep issue evidence current with a new comment and do not rewrite old replies.

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
