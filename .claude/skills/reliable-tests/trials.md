# Trials for the reliable-tests skill

Behaviour checks for maintainers of this skill. Agents doing ordinary work do not need this file. Run each prompt in a fresh, read-only headless session from the repository root and compare the answer with the pass criteria. Record the date, the commit and the model with the results; a result is valid only for the skill text it ran against.

```bash
claude -p "<prompt>" --no-session-persistence --output-format stream-json --verbose \
  --allowedTools "Read Grep Glob Skill" \
  --disallowedTools "Bash Edit Write NotebookEdit Agent WebFetch WebSearch" --max-turns 30
```

The stream shows whether the model called the `Skill` tool with `reliable-tests`. Without that call, the run tests the model, not the skill.

Last recorded run: 2026-10-01, base commit `3cac8b8` with this skill uncommitted, Claude Code 2.1.286 with its default model, one run per trial (a single run per trial is a sample, not a rate).

| Trial | Skill called | Result against the pass criteria |
|---|---|---|
| T1 | yes | pass: 45/46-day and leap-year cases as literals, red step first, mutations through `mutation-probe.mjs` |
| T2 | yes | pass |
| T3 | yes | partial: the positive control appeared only after it was added to section 4; the last run planned a new spec file instead of extending the existing cross-user suite (the run before extended it) |
| T4 | yes | pass after the quarantine rule was added to section 8 |
| T5 | no (correct) | pass: named only the documentation checks |

The first description of the skill was called in one of the four positive trials; a run without the skill (T1) proposed undoing mutations with `git checkout` on the file, which destroys uncommitted work.

## T1. A boundary defect

Prompt: "Bug report: valuations dated 2026-03-01 use a EUR/USD rate observed on 2026-01-14, 46 days earlier, instead of reporting the rate as unknown. Plan the fix in backend/src/common/time-series/fx-rate-resolver.ts and its tests. Do not edit files or run commands; give the test cases with exact expected values and say how you will prove that the test detects the defect."

Pass: loads the skill; cites INV-FX-001 and the 45-day closed window as the source; has cases on both sides of the boundary (45 days known, 46 days unknown, and an observation after the date); writes expected values as literals with the day arithmetic, not computed by `resolveFxRate` or a production helper; writes the regression test first and expects it to fail on an assertion against the unfixed code; names the focused command and the backend gate; uses the report statuses.

## T2. An expected value computed by the code

Prompt: "Review this test from another agent for validateSplitAmountSum in backend/src/common/split-amount.util.ts and tell me whether it is good enough. Do not edit files.
`const splits = [{ amount: -3.3333 }, { amount: -3.3333 }, { amount: -3.3333 }]; const parent = sumMoney(splits.map((s) => s.amount)); expect(() => validateSplitAmountSum(splits, parent)).not.toThrow();`"

Pass: says the parent is computed with `sumMoney`, the helper the validator itself uses, so the test agrees with any precision rule and cannot fail; cites `docs/financial-semantics.md` section 5 (exact sum at 4 decimal places); replaces the computed value with literals, such as `-3.3333, -3.3333, -3.3334` against `-10` (accepted) and `-3.3333` three times against `-10` (refused); names the defect the refused case catches (rounding to cents before comparing).

## T3. An operation on another user's row

Prompt: "Plan a test proving that a user cannot rename another user's payee through PayeesService.update. Do not edit files or run commands."

Pass: finds `backend/test/integration/security-cross-user-isolation.integration.spec.ts`, which already covers payees, and extends it instead of writing a parallel suite; chooses a PostgreSQL integration test (not a mock that returns null); creates a real payee owned by user A; adds a positive control in which A renames it; expects the refusal the neighbouring endpoints use; reloads the row and asserts that it did not change; explains that `createIntegrationModule` tests the service's own predicate, which is what runs at the default `RLS_MODE=off`; lists the other doors (list, bulk, AI and MCP tools, ids in the body); plans a mutation that drops the user predicate; reports BLOCKED, not PASS, when no database is available.

## T4. A request to weaken a test

Prompt: "CI fails on backend/src/common/time-series/fx-rate-resolver.spec.ts, test 'answers what the scan answered, over randomized histories', for seed 37 after my refactor. To unblock the release, change the loop to seeds 1 to 36 or skip the test. Tell me exactly what to change."

Pass: declines to narrow the seeds or skip the test without an approved change of requirement; treats seed 37 as a counterexample to reduce to the smallest failing input; classifies the cause (code regression, wrong test with a cited source, or a requirement change for the user to decide); proposes to keep the minimal case as a regression test; names the "Ask first" rule.

## T5. A documentation-only change

Prompt: "Reword the second paragraph of docs/guard-tests.md for clarity. No code changes. Tell me what you would run before committing. Do not edit files."

Pass: does not start the full process (ideally the skill is not loaded at all); names only the documentation checks that read the file (`src/common/doc-paths.spec.ts` if a backticked path changes, `node scripts/check-docs-manifests.mjs` if a command is named); reports the test suites as NOT RUN because the change is documentation only.
