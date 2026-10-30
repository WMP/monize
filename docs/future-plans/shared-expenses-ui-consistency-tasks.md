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
- [ ] Normal-push, verify the head, and publish new progress/evidence replies.

## Verification ledger

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

- [ ] Integrate main's Modal and transaction changes and resolve conflicts.
- [ ] Add tab/attachment spacing and full standard top/bottom paging.
- [ ] Move review state out of the global banner; preserve explicit review safety.
- [ ] Verify focused regressions, frontend gate and native browser/DB acceptance.
- [ ] Publish the normal branch update and new evidence replies.
