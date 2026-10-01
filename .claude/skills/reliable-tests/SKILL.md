---
name: reliable-tests
description: Test discipline for Monize. Use it whenever you plan or make a change whose correctness tests must prove (a feature, a bug fix or bug report, a refactor touching authorization, tenancy, money, FX, migrations, concurrency or irreversible effects), and for any test work - writing, changing, deleting, running, reviewing or debugging tests, fixtures, mocks or test configuration, a failing or flaky test in CI, or a request to skip, loosen or narrow a test. It takes expected results from contracts rather than from the code, requires each new test to be seen failing on its defect, runs targeted mutations without touching the working tree, and defines the evidence report (PASS, FAIL, BLOCKED, NOT RUN). Do not use it for changes limited to documentation or code comments.
---

# Reliable tests

AI agents write most of the code and most of the tests in this repository, so one wrong assumption can land in both and pass. A test is worth keeping only when it fails on a defect someone could plausibly ship. This skill is the working method for showing that. It is guidance, not a control: CI, the guard tests and human review are the controls (`references/project-test-map.md`, "What enforces what").

The rules themselves live in the contract documents. Cite them by ID or section; do not restate them.

## 1. Size the work first

| The change | What this skill asks |
|---|---|
| Documentation or comments only; no code path changes | No test suite. Run only the checks the edit can trip (`references/project-test-map.md`, "Documentation-only changes") and report the suites as NOT RUN with that reason. Stop here. |
| Low risk: local logic, rendering, a helper with no money, identity or persistence effect | Steps 2 to 9 in short form. The oracle fits in two or three sentences of the report. |
| High risk: authorization, delegation, joint access, tenancy or RLS; money, FX, balances, holdings, totals; migrations and schema; concurrency, retries, idempotency, crons; deletes, restores, imports, anything outside PostgreSQL (files, S3, email, push, providers); shared test infrastructure, runner or CI configuration | All steps, a written oracle map, a targeted mutation, and a fresh-context review if your environment can run one. |

When unsure, treat the change as high risk. A refactor that "does not change behaviour" is high risk when it moves a check, a transaction boundary, a lock, a query predicate or an error path.

## 2. Scope, contracts, baseline

1. Name the layers and the invariant IDs the change touches (`docs/system-invariants.md`, index at the top). For each ID, read its row in `docs/verification-contract.md` section 3: the load-bearing (bold) test kind is required, and a mock does not stand in for it (VER-001 to VER-003).
2. Read the layer's testing document before writing a test: `docs/backend/testing.md`, `docs/frontend/testing.md` or `e2e/CLAUDE.md`. Money: `docs/financial-calculation-contract.md` sections 7 and 8. Concurrency: `docs/concurrency-and-idempotency.md` section 9.
3. Record the starting point before you edit: `git rev-parse --short HEAD`, `git status --short`, and one run of the focused tests you expect to touch. A failure that predates your change is inherited: report it, do not hide it, do not attribute it to your change. If you cannot get a baseline (no database, no Docker), say so; that is not a pass.

## 3. Fix the expected behaviour before you fit a test to code

Expected results come from, in this order: an approved spec (`docs/specs/`), a contract or invariant entry, a domain rule (`docs/financial-semantics.md`), a worked example checked by hand, or an independent reference model written in the test. The implementation under test is not on this list, and neither are the existing tests (VER-004).

- Never compute an expected value with the function under test, a production helper it uses (`roundMoney`, `sumMoney`, `applyFxConversion`, `resolveFxRate` and the like), or a copy of its algorithm. Write the literal, and the arithmetic that produced it in a comment. Shared builders and factories may create inputs; they must not decide the result (`docs/testing-contract.md`, "Fixtures and shared constants").
- A snapshot, golden file or recorded response that the application produced is a record, not an oracle. Check every changed line against the rule before you accept it. Never accept snapshot updates in bulk.
- A test that pins today's behaviour without a source saying it is right is a characterization test. Start its `describe` title with `characterization:` and add a comment naming what it pins and any known defect it pins with it. It protects a refactor; it is not evidence that the behaviour is correct. When an old implementation is the comparison baseline, list its known defects and exclude those cases from the comparison explicitly.
- If the rule is ambiguous and the question is who may do something, how money moves, or whether data can be lost, stop and ask the user. Do not choose the answer that matches the code. Record the open question in the report.

For a significant change, write the oracle map beside the tests or in the PR description. It extends the negative-control note in `docs/testing-contract.md`:

```text
Rule and source:   <invariant ID, contract section, spec line or hand-checked example>
Scenario:          <actor, prior state, input>
Expected:          <result AND stored state, including what must not change>
Wrong code caught: <the concrete defect, e.g. "the update filters by id but not by user id">
```

For a small change, give the same four facts in two or three sentences of the report.

## 4. Design the scenarios before you look at what the code returns

- Use the lowest level that can see the defect (`references/project-test-map.md`, "Choosing the level"). A mock proves a call. It never proves a property of PostgreSQL, of two processes, of a provider or of the browser.
- Take inputs from `docs/testing-contract.md`: only the classes the code can receive, a value on each side of every boundary, and at least one adversarial combination.
- Choose negative cases by risk, not only by form: identity and tenancy, illegal state and replay, dependency failure and partial work. `references/techniques.md` has the checklist for each risk.
- Assert a refusal in two halves: the kind of refusal the contract specifies, and the absence of every forbidden effect, reloaded through the real persistence path (`docs/financial-calculation-contract.md` section 7.1). The contract, not you, decides which effects are allowed (an audit row, a log line). Also run the allowed path: the same request by an actor who may make it succeeds (a positive control), so a refusal caused by a malformed request or a wrong route cannot pass for an authorization check.
- Assert asynchronous work after it has finished: await the job's own promise, or poll an observable condition with a time bound. The state when the HTTP response arrives proves nothing about a background effect.
- Control the clock, the time zone, randomness and the network (`references/techniques.md`, "Determinism").

## 5. Prove that each new test fails for the right reason

- Bug fix: write the regression test first. Run it against the unfixed code and see it fail; then fix and see it pass. Quote both runs.
- Read why it failed. Detection is an assertion about the behaviour that fails. A missing import, a TypeScript error, "Test suite failed to run", an unreachable database, a timeout or "No tests found" is not detection.
- New feature: a test that fails because the code does not exist yet is the red step of TDD. It says nothing about the strength of the assertions; check that after you implement, with a mutation.
- Targeted mutation (required for high-risk logic, useful for any test that looks weak): insert one plausible defect at a time, such as `>` to `>=`, a dropped `userId` predicate, an inverted sign, a skipped deduplication, a skipped write, or the check moved after the save. Run the tests that should catch it and read the failure. Use `.claude/skills/reliable-tests/scripts/mutation-probe.mjs` from the repository root (usage in its header; `references/examples.md`, example 6): it works in a temporary git worktree, refuses a red baseline, and reports KILLED, SURVIVED or INVALID. If you mutate by hand, mutate a scratch copy and confirm with `git status` and `git diff` that nothing is left behind.
- Classify every surviving mutation: a real gap (add the case), an equivalent mutation (say why), behaviour outside the contract, or a tool problem. Never exclude a survivor to improve a score, and do not set one mutation score for every module. A mutation you did not run is a hypothesis; report it as one.
- Coverage finds code that no test reached. It does not show that a reached line is checked. Keep the layer thresholds; do not chase 100 %.

## 6. Run in widening rings

1. The focused test while you edit.
2. The tests of the code that depends on what you changed. For a shared helper, harness, factory, setup file or runner configuration, that is the whole layer.
3. Once, before you push: the layer gate in `AGENTS.md`, "Required before you push", including the backend integration suite when a query, an entity, a migration or an RLS context changed.
4. CI. Say whether you have a local result or a CI result; one is not the other.

Exact commands, single-test filters and environment needs are in `references/project-test-map.md`. One trap: a focused backend integration run is `npx jest --config ./test/jest-e2e.json --testPathPatterns=test/integration/<file regex>` from `backend/`, because `npm run test:integration -- <regex>` still runs every suite. Never read a result through a pipe that hides the exit code (`npm run test:unit | tail` reports the exit code of `tail`): use `set -o pipefail`, or read the runner's summary line. Mutation runs, generated-input loops and wide matrices are for high-risk changes, not for every edit. Saving time is never a reason to skip a required gate.

## 7. Review test changes as strictly as production code

Each of these needs a fix or a written reason:

- an expected value derived from production code, or a snapshot accepted without reading it;
- `toBeDefined()`, a status code alone, or `toHaveBeenCalled()` in place of the business outcome and the stored state;
- a mock of the behaviour under test; an untyped mock of one of our own services; a fixture the producer could never emit, or none for a shape it can emit (`docs/backend/testing.md`; `docs/financial-calculation-contract.md` section 8.3);
- an uncontrolled clock, time zone, randomness or network; a fixed sleep instead of a condition; shared mutable state, or a dependency on test order;
- a `try`/`catch` or a condition that lets the test pass without reaching its assertion;
- no oracle source, no named defect, or no evidence that the test ever failed.

Several assertions in one test are fine when they describe one scenario. `references/project-test-map.md`, "Reviewing a test diff", has commands that list new skips, removed assertions, and changed runner configuration and snapshots.

**High risk: an independent reviewer.** If your environment can start a subagent with a fresh context (in Claude Code, the Agent tool), use it in two rounds. Round 1: give it only the requirement, the contract sections and the public interface, and ask for the cases and counterexamples it would test. Round 2: show it the implementation and the tests, and ask which of its cases are missing and which tests would still pass on a wrong implementation. Turn real findings into tests. A second agent, even a different model, can share your blind spots and does not replace an executed check. If no such review took place, the report says so.

## 8. Never make a test pass by weakening it

These need an explicit change of requirement that the user approved: loosening an assertion; catching and ignoring an error; adding `.only`, `.skip`, `.todo`, `xit` or a conditional skip; narrowing test discovery, filters or paths in a configuration or a script; lowering a coverage threshold; adding to a guard's baseline or allowlist; updating snapshots in bulk; adding retries; deleting a failing test. `AGENTS.md` lists these under "Ask first". When you believe a test or a guard is wrong, stop and report what it asserts, why you think it is wrong, and which source says so.

Correcting a test that asserts a known violation is not weakening (VER-004), but the change cites the source that defines the correct behaviour. Do not keep a wrong test because it already exists.

- Flaky test: a rerun is a diagnostic, not a fix, and a pass on retry does not erase the failure (CI retries Playwright tests twice). Find the cause: clock, order, shared state, timing.
- Quarantine (a skip or a narrowed range that stays for a while) is the user's decision, made after hearing the reason. Make it the narrowest skip (one case, not a range), with a comment that names the failing case, an owner and an exit condition, and repeat those facts in the report.
- Fewer tests: a run that executes no tests, or fewer than the baseline, is a failure to explain (REL-001, REL-002). Compare the runner's totals with the baseline run.

## 9. Report

```text
Scope and risk:     <layers, files>; <low | high> because <failure mode>
Tested state:       <git SHA>; <clean | uncommitted changes in ...>
Contracts:          <INV-, VER-, CONC- IDs and the sections read>
Oracle:             <the map, or two sentences for a small change>
Scenarios:          <added or changed tests: path and test name>
Detection evidence: <test> failed on <defect or mutation> with <assertion>, passes after the fix
                    | <mutation-probe RESULT line> | not shown, because <reason>
Commands:           <exact command> -> PASS | FAIL | BLOCKED (<cause>) | NOT RUN (<reason>)
Review:             <independent reviewer: yes, with findings ... | no>
Open:               <skips, flakes, inherited failures, gaps, questions for the user, CI not yet run>
```

PASS and FAIL are results of a run you performed on the tested state. BLOCKED means you tried and the environment could not run it (no PostgreSQL, no Docker). NOT RUN means you chose not to run it, and why. Lint and type-check are not behaviour tests. A plan is not a run, a local pass is not a CI pass, and a green suite does not prove the application correct.

## Reference files

Load only the file the task needs.

- `references/project-test-map.md`: runners, commands, single-test selection, environment needs, CI jobs, harness entry points, documentation-only changes, reviewing a test diff, and what enforces what (with the known gaps).
- `references/techniques.md`: negative and boundary cases by risk, authorization and tenancy, state and concurrency, failure injection, generated-input (property-based), metamorphic, model-based and differential tests, migrations, performance, UI, determinism.
- `references/examples.md`: worked cases from this repository.

`trials.md` holds the behaviour checks for maintainers of this skill; it is not needed for ordinary work.
