# Shared expenses UI consistency tasks

Plan: `docs/future-plans/shared-expenses-ui-consistency.md`.
Specification: `docs/specs/shared-expenses-ui-consistency.md`.

- [x] Read the current review and newly approved screen contract.
- [x] Preserve feature history and merge the current main without conflicts.
- [x] Record the requester-authorized refinement before implementation.
- [x] Implement and test unified split instructions and server amount preview.
- [x] Align summaries, Tabs, filters, forms, attachment header and repayments.
- [x] Correct retained account toggle label and secondary navigation.
- [x] Run focused regressions and the bounded frontend gate.
- [x] Run native browser acceptance and capture real screenshots.
- [x] Finish translations and regenerate pseudo-locales.
- [x] Normal-push, verify the head, and publish new progress/evidence replies.

## 29 October verification ledger

The frontend gate passed lint, type checking, pseudo-locale validation and
1,215 changed test files / 23,524 cases. Documentation and environment checks
passed. An additional seven focused files / 186 cases passed after the final
weight-validation, duplicate-name accessibility and slider-range corrections;
type checking passed again. The broad suite was run once.

The cleared-weight regression failed on the original implementation before the
existing split validator was corrected. Early focused runs also caught outdated
button/caption expectations; an intermediate typecheck caught an unsupported test
option and an unintended bare return in the extracted position caption. These
were corrected. No test, guard, baseline or threshold was disabled or weakened.

Sequential production compile/typecheck/generate and the backend build passed.
All 43 cases in three PostgreSQL suites passed with enforced RLS. The browser
application uses a separate fixture database with RLS off.

All nine Chromium scenarios have passing evidence, with retries disabled:
seven passed initially; the ordinary-save scenario passed after scrolling to the
standard, non-sticky form actions. The unequal split exposed an automatic-preview
arrival during input selection. Disabling the loading field alone did not fix
that race. Initializing its ready input with the received amount, while retaining
a focused/explicit edit, fixed it. The unequal split and six-person trip both
passed afterward. The corresponding delayed-preview/focused-edit regression and
split-editor tests passed (two files / 14 cases), as did focused lint, types and
the rebuilt production output. No further broad suite was run.

Reviewed captures are in
`docs/future-plans/shared-expenses-consistency-screenshots/README.md`.
Verification used one bounded native workload at a time, no Docker and no local
coverage run. The common Modal chrome remains separate upstream work. Publication
is the remaining external step at this commit; its readback is recorded in the
PR/issue thread. Maintainer scope approval, CI and human acceptance remain open.

## 30 October follow-up

- [x] Integrate main's Modal and transaction changes and resolve conflicts.
- [x] Add tab/attachment spacing and full standard top/bottom paging.
- [x] Move review state out of the global banner; preserve explicit review safety.
- [x] Verify focused regressions, lint/types/locales and native DB acceptance.
- [x] Finish browser acceptance.
- [ ] Confirm the frontend production build in CI.
- [ ] Publish the normal branch update and new evidence replies.

### 30 October verification ledger

Merged main through `6a6a8a01403a11646dfbe48515d19694024e74c7` without
rewriting published history. This includes the common Modal change that was
pending in the preceding ledger. No database migration or locale key changed.

Frontend lint, types, locale validation and changed tests passed: 915 affected
files / 17,136 cases. Backend lint and both type checks passed. The changed
backend run passed 600 of 603 files; the three failing guards found stale deleted
paths in the native verification index and an oversized instruction file. Staging
the rename and shortening the new instruction resolved them: 37 focused cases
passed, with no guard change. An additional 166 backend cases cover replay,
timing-safe comparison, module size and upstream expiry regressions. The final
49 frontend cases cover navigation, pending-filter empty states, pagination and
the upstream month-boundary regression. Environment and documentation checks
passed.

The backend production build and 61 cases in four PostgreSQL suites passed,
including transaction conversion and enforced RLS. Bearer 2.1.3 passed all 84
checks with zero findings using the existing CI exclusions. Replay fingerprint
checks now use the existing timing-safe comparator; no security exception or
threshold changed. The backup exclusion registry was split without changing
its entries.

Local full frontend production compilation reached the 3500 MiB process limit
and was stopped; the limit was not raised. The alternative Webpack attempt was
incompatible with an existing scanner import. The default production build must
therefore be confirmed by CI on the published head. Browser captures in
`docs/future-plans/shared-expenses-final-review-screenshots/README.md` use Next
development mode and the compiled backend, with synthetic data and RLS off;
they are not production-build or RLS evidence.

Chromium ran with one worker and retries disabled. All eleven journeys have
passing evidence: seven initial passes, three focused follow-up passes and the
final ordinary-transaction pass. Initial development-mode route compilation caused
offline fallback/registration timing failures. Anonymous prewarming was found
to redirect protected routes to login; the local harness now prewarms with an
authenticated fixture and asserts the requested URL. An attempted selector
correction was also found to be wrong and reverted; the existing transaction
test and its assertions are unchanged. Authenticated prewarming resolved the
offline route; that run reached the final list assertion before exhausting the
60-second test budget. The final focused local run allows 120 seconds for this
CPU-capped development server, without changing repository or CI timeouts. It
passed in 42.5 seconds, including the persisted bank balance and unchanged group.

All local work used bounded native processes, one heavy command at a time,
with a host-memory reserve and no Docker or local coverage run. The frontend
production build, updated-head CI and formal maintainer acceptance remain
separate gates. No test, guard, baseline or coverage threshold was weakened.
