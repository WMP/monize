@AGENTS.md

## Claude Code specifics

The rules are in `AGENTS.md`, imported above. What follows applies to Claude Code only.

- **Navigate with LSP** (`workspaceSymbol`, `findReferences`, `goToDefinition`, `hover`) before Grep or Read; check LSP diagnostics after every edit and fix them before moving on.
- **Run the safe local actions yourself**: `.claude/settings.json` pre-approves lint, type-check, unit tests, the repo-level check scripts and read-only git. Ask before anything `AGENTS.md` lists under "Ask first".
- **A subagent pays for itself only on a wide read-only sweep or an isolated parallel branch** (the "grep every consumer" fan-out across both layers is the case). A single-file change, a focused test run or a question you can answer from one file is cheaper in-context. Never spawn one to re-run a suite you have already run.
- **Verify, do not assert.** Before reporting done, run the layer's gate from `AGENTS.md` once and quote the result; "should pass" is not a result. Do not re-run the same suite hoping for a different outcome; find the cause.
- **Invoke the `reliable-tests` skill** (`.claude/skills/reliable-tests/SKILL.md`) before you plan or make a behaviour change or a bug fix, and for all test work, including the tests for a feature you have just implemented, a failing or flaky test, and a request to skip or loosen one: expected results come from a contract, not from the code, and each new test is seen failing on the defect it targets. A documentation-only change does not need it.
- **Scope.** Change what was asked and the tests that prove it. A refactor, a new abstraction, a new dependency or a change under `.github/`, `helm/` or `database/migrations/` beyond the task is a separate proposal, stated to the user rather than done.
- **Output.** Report the diff and what you verified; no transcript, no restating the instructions, no emojis.
