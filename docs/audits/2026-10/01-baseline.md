# S01 Baseline, toolchain, CI and cron inventory

## 1. Metadata

| Field | Value |
| --- | --- |
| Session | S01 (parallel wave with S02 and S03, orchestrated) |
| `AUDIT_BASELINE_SHA` | `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86` |
| `git rev-parse HEAD` at start | `becd00facf022d3e52e3d6efa8019a486c68b1de` (audit branch; pin check of plan step 2 returned an empty diff) |
| Date | 2026-10-21 |
| Primary path | `AGENTS.md` (the instruction hierarchy), then `.github/workflows/ci.yml` |
| Hint line used | `prioritize the instruction hierarchy and its contradictions, the architecture delta since d5cea9bf (plan section 5), which suites run green at the baseline, and the 19 partial and 1 unenforced invariants as standing hypotheses` |
| Runtime executed | See section 12.1 (baseline suite table). Node 24.22.1 via `/opt/nvm`; PostgreSQL 16 (`mirror.gcr.io/library/postgres:16-alpine`) in Docker; mutations in a scratch worktree at `AUDIT_BASELINE_SHA`. |
| Status | in-progress (suite results being filled) |

## 2. Invariant map

The slice is the instruction hierarchy and the gates that hold it. Its material invariants:

| ID | Statement | Mechanism named | Path |
| --- | --- | --- | --- |
| S01-I1 (no INV ID) | The instruction files give one answer per question; a more specific file does not contradict `AGENTS.md`. | `backend/src/common/instruction-files.spec.ts` (size ceilings, docs reachability), `backend/src/common/db/lint-bans.spec.ts` (no instruction file recommends a banned DB primitive), `doc-paths.spec.ts` | `AGENTS.md -> CLAUDE.md (@import) -> layer CLAUDE.md -> docs/<layer>/*.md -> agent behaviour -> code` |
| S01-I2 (no INV ID; ADR 0001) | All DB access goes through `withScopedDb`; `@InjectRepository`, `createQueryRunner()`, `DataSource.transaction()` are banned. | ESLint `no-restricted-imports` / `no-restricted-syntax` in `backend/eslint.config.mjs:277-443`; `lint-bans.spec.ts` | `source -> eslint (CI backend-lint) -> merge` |
| S01-I3 (no INV ID; RLS contract) | Every caller of `withSystemContext`/`withUserContext`/`withDelegateContext`/`withPreserveTimestamps` is a reviewed entry of `WITH_CONTEXT_ALLOWLIST`. | ESLint `no-restricted-imports` pattern `["**/db/with-context", "./with-context"]`, lifted per allowlisted file (`eslint.config.mjs:17-268, 283-289, 449-473`) | `import specifier -> eslint pattern match -> CI backend-lint` |
| S01-I4 (CI gate) | A lint error in `backend/` fails CI. | `backend-lint` job, `npm run lint` (`ci.yml:66`) | `source -> npm run lint -> job exit code` |
| INV-CRON-001 (partial) | One logical effect per tick across replicas. | `JobClaimService.claimOnce`/`claimLease`/`withLease`, conditional `UPDATE ... RETURNING`, `ON CONFLICT`, dedupe index; doc held by `cron-doc.spec.ts` | `@Cron (every replica) -> claim -> effect -> delivery record` |
| INV-RELEASE-001 (partial) / REL-001 | The tested, imaged and tagged revisions are one; zero discovered tests is a failure. | `prepare-release` SHA threading; `passWithNoTests` guard (`jest-config.guard.spec.ts`) | `PR SHA -> CI gate -> release job -> bump commit -> tag` |
| INV-HA-001 (partial) | A replica serves only while what it shares is reachable. | `checkClusterBoot` (`cluster-mode.ts:154`), readiness grace (`health.controller.ts:38,192`) | `boot -> readiness -> LB` |
| The 19 non-enforced entries | See section 12.4. | | |

## 3. Lens ledger

| Lens | Status |
| --- | --- |
| Pin the revision | ran (empty `git diff --stat` against `AUDIT_BASELINE_SHA` outside `docs/audits/`) |
| Read instructions first | ran: `AGENTS.md`, root, `backend/`, `frontend/` (commands and gate sections), `database/` (commands), `e2e/`, `backend/src/mcp/` `CLAUDE.md`; `CONTRIBUTING.md`; `.claude/settings.json`; `.lintstagedrc.cjs`; `docs/verification-contract.md` s7-8; `docs/backend/testing.md`; `docs/cron-jobs.md` |
| Treat summaries as hypotheses | ran: the plan's own figures (cron count, invariant counts, module sizes) were re-measured; three are wrong (section 11) |
| Invariant model | ran (section 2) |
| Change surface (producer/consumer) | ran for the instruction rules: each rule traced to the guard that holds it and the CI job that runs it |
| Cross-layer verification | ran for the gate path `instruction -> command -> CI job -> exit code` |
| Representation boundary | ran for import specifiers (`with-context` vs `with-context.js` vs `./db/./with-context`) |
| Browser/UI round trip | not applicable: S01 has no UI intent path; S19 owns it |
| Server-authoritative metadata | ran only for the context-seeding fence (who may seed `system:true`); per-route checks are S03/S04 |
| Identity versus value | not applicable: no mutable repeated structure in the slice |
| State machine | not applicable in depth: the only lifecycle in the slice is the release flow, handed to S21 |
| Concurrency and idempotency | ran at inventory level: the cron matrix (section 12.3) names the cross-replica mechanism of each of 49 handlers; per-job proof is S08 |
| Partial failure | ran at inventory level for cron side effects (email/push/provider idempotency column, section 12.3) |
| External provider | not applicable: no provider call in the slice beyond inventory |
| Database and migration | ran at inventory level (233 migrations, 56 timestamped); schema parity is S05 |
| Backup/restore | not applicable: S06 |
| Financial | not applicable: no monetary computation in the slice |
| AuthZ/RLS | ran for the `WITH_CONTEXT_ALLOWLIST` fence (section 12.2, finding A26-S01-02) |
| Tests as evidence | ran: baseline suites executed, skip sites located, guard scope read |
| Mutation | ran: section 6, four executed in a scratch worktree |
| Counterexample | ran: section 7 |
| Interaction | ran: section 7 |
| Rejected hypotheses | ran: section 8 |
| Adversarial approval challenge | ran: section 13 |
</content>
</invoke>

## 4. Confirmed findings

No BLOCKER, HIGH or MEDIUM survived. Four LOW findings, all in the gate and instruction layer.

### A26-S01-01 -- CI's backend lint step runs `eslint --fix`, so a fixable lint error never fails CI

1. **Severity:** LOW
2. **Confidence:** high
3. **Location:** `backend/package.json` script `lint` (`eslint "{src,apps,libs,test}/**/*.ts" --fix`); `.github/workflows/ci.yml:66` (`- run: npm run lint` in `backend-lint`). Secondary: `AGENTS.md` "Required before you push" (names `npm run lint` as the gate), `docs/verification-contract.md:347` (says the job owns "eslint").
4. **Violated invariant:** S01-I4. A lint error in `backend/` fails the `Backend Lint & Type Check` job. Causality: `PRE_EXISTING_UNREPORTED`.
5. **Reproduction:** At `AUDIT_BASELINE_SHA`, three files carry `prettier/prettier` errors: `backend/src/ai-review/ai-review-work.service.ts:1049`, `backend/src/email-receipts/parsing/receipt-parser.types.ts:157`, `backend/src/email-receipts/pipeline/receipt-instructions.ts:85`. In a scratch worktree at the baseline: `npx eslint <the three files> --max-warnings=0` exits 1 with "3 problems (3 errors)"; `npx eslint <the three files> --fix` (what `npm run lint` does) exits 0 and rewrites the files. CI's checkout is ephemeral, so the rewrite is discarded and the job is green.
6. **Observed:** The job passes with three lint errors on `main`. Any rule ESLint can auto-fix is never enforced by CI for the backend.
7. **Expected:** The job fails on any lint error, as the frontend job does (`frontend` `lint` is `eslint .`, no `--fix`).
8. **Impact:** Operations and code quality only. The RLS bans (`no-restricted-imports`, `no-restricted-syntax`) are not auto-fixable, so they still fail CI; this was checked by mutation (section 6, M2). The defect makes the gate weaker than `AGENTS.md` and `verification-contract.md` state, and the pre-commit hook (`.lintstagedrc.cjs`, also `--fix`) is the only formatting enforcement. A commit that bypasses the hook (web edit, `--no-verify`, squash of an unformatted branch) reaches `main` unformatted, as the three files show.
9. **Root cause:** One script serves two purposes: a developer's auto-format (`--fix`) and the CI check. CI calls the developer script.
10. **Recommended correction:** Add a check-only script and call it from CI.
11. **Suggested remediation diff (illustrative, not applied):**
    ```diff
    --- a/backend/package.json
    +++ b/backend/package.json
    @@
         "lint": "eslint \"{src,apps,libs,test}/**/*.ts\" --fix",
    +    "lint:check": "eslint \"{src,apps,libs,test}/**/*.ts\" --max-warnings=0",
    --- a/.github/workflows/ci.yml
    +++ b/.github/workflows/ci.yml
    @@ backend-lint
           - run: npm ci
    -      - run: npm run lint
    +      - run: npm run lint:check
    ```
    The same commit must format the three files, or the job turns red. `.github/` is an "Ask first" area (`AGENTS.md`), so the CI half needs the maintainer's agreement. `--max-warnings=0` is a decision: CI currently tolerates warnings; leave it out to change only the `--fix` half.
12. **Recommended regression test:** A source-scanning guard over `ci.yml` that fails when a lint step in any job resolves to a script carrying `--fix`.
13. **Suggested regression-test diff (illustrative, not applied):**
    ```diff
    --- /dev/null
    +++ b/backend/src/common/ci-lint-no-fix.guard.spec.ts
    @@
    +import * as fs from "fs";
    +import * as path from "path";
    +
    +const ROOT = path.resolve(__dirname, "../../..");
    +
    +describe("CI lint steps check, never fix", () => {
    +  it("the backend-lint job runs a script without --fix", () => {
    +    const ci = fs.readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
    +    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "backend/package.json"), "utf8"));
    +    const job = ci.slice(ci.indexOf("  backend-lint:"), ci.indexOf("  backend-unit-tests:"));
    +    const scripts = [...job.matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1]);
    +    for (const s of scripts) expect(pkg.scripts[s] ?? "").not.toMatch(/--fix\b/);
    +  });
    +});
    ```
14. **Verification method:** Re-run the M1 mutation of section 6 (introduce a `prettier/prettier` violation); the job must fail. Run the guard against the unfixed `ci.yml`; it must fail.
15. **Residual risks:** `ci.yml:66` is the only workflow step that calls the backend `lint` script (searched all of `.github/workflows/`). The guard parses YAML textually. `e2e/` has no lint and no type-check step in CI at all (handed to S21).

### A26-S01-02 -- The `WITH_CONTEXT_ALLOWLIST` lint fence does not match an import specifier with a file extension, a `./` segment, a dynamic `import()`, or a direct `requestContextStorage.run`

1. **Severity:** LOW
2. **Confidence:** high
3. **Location:** `backend/eslint.config.mjs:283-289` (`BAN_WITH_CONTEXT.group = ["**/db/with-context", "./with-context"]`). Secondary: `backend/src/common/request-context.ts` (exports `requestContextStorage`, not restricted); the `BAN_OAUTH_PAYLOAD_ENTITY` pattern in the same file has the same form and was not tested.
4. **Violated invariant:** S01-I3 (`AGENTS.md`, "Database access": "A new call site of any of these is added to `WITH_CONTEXT_ALLOWLIST` in the same PR, as a reviewed decision"). The rule has no entry in `docs/system-invariants.md`. Causality: `PRE_EXISTING_UNREPORTED` (the allowlist existed at `d5cea9bf`, `docs/audits/2026-08-upstream/01-baseline-architecture.md:171,896`).
5. **Reproduction (executed, section 6 M3):** In a scratch worktree at the baseline, a new non-allowlisted file `src/zz/a.ts` with `import { withSystemContext } from "../common/db/with-context.js";` and a call to it. `npx eslint src/zz/a.ts` reports nothing; the control file `src/zz/b.ts` with the extensionless specifier is flagged. `npx tsc --noEmit` reports no error for `src/zz/a.ts` (`moduleResolution: nodenext` resolves `.js` to the `.ts` source). A separate `eslint --stdin` sweep found the same miss for `.ts` suffixes, a `../common/db/./with-context` segment and dynamic `import()`; `requestContextStorage.run({ system: true }, fn)` is not restricted by any rule.
6. **Observed:** A file outside the allowlist can seed system context (RLS bypass) and pass lint and type-check.
7. **Expected:** Every importer of `with-context`, in any spelling, and every direct seeding of the context store, fails lint unless allowlisted.
8. **Impact:** Security process. No present-day bypass exists: all 81 importers are allowlisted and none uses these forms (section 12.2). The fence is the mechanism the repository names for reviewing every RLS-bypass call site, and it can be passed by accident (an editor auto-import that adds `.js`) without review.
9. **Root cause:** The ban matches the import string by glob, not the resolved module; the glob enumerates two spellings.
10. **Recommended correction:** Match by regular expression on the specifier, ban the dynamic form, and restrict `requestContextStorage.run` to `with-context.ts` and the interceptor.
11. **Suggested remediation diff (illustrative, not applied):**
    ```diff
    --- a/backend/eslint.config.mjs
    +++ b/backend/eslint.config.mjs
    @@
     const BAN_WITH_CONTEXT = {
    -  group: ["**/db/with-context", "./with-context"],
    +  // Matched by regex on the specifier: the glob form missed "with-context.js"
    +  // (legal under moduleResolution nodenext), ".ts" and a "./" segment.
    +  regex: "(^|/)with-context(\\.[cm]?[jt]s)?$",
       message:
    @@ no-restricted-syntax (src/**/*.ts block)
    +        {
    +          selector: "ImportExpression[source.value=/with-context/]",
    +          message: "Dynamic import of common/db/with-context bypasses WITH_CONTEXT_ALLOWLIST.",
    +        },
    +        {
    +          selector:
    +            'CallExpression[callee.object.name="requestContextStorage"][callee.property.name="run"]',
    +          message: "Seed identity through common/db/with-context (WITH_CONTEXT_ALLOWLIST), never the store directly.",
    +        },
    ```
    The `requestContextStorage.run` selector needs `src/common/db/with-context.ts` and `src/common/interceptors/request-context.interceptor.ts` exempted in a separate block. Needs verification: `npx eslint src` stays green; `regex` support in the installed ESLint 10 `no-restricted-imports` (documented since ESLint 9).
12. **Recommended regression test:** Extend `lint-bans.spec.ts` (it already loads the config) with a case that lints each bypass spelling through the ESLint Node API from a non-allowlisted path and expects one error each.
13. **Suggested regression-test diff (illustrative, not applied):**
    ```diff
    --- a/backend/src/common/db/lint-bans.spec.ts
    +++ b/backend/src/common/db/lint-bans.spec.ts
    @@
    +import { ESLint } from "eslint";
    +
    +describe("with-context fence matches every spelling", () => {
    +  const eslint = new ESLint({ cwd: path.join(REPO_ROOT, "backend") });
    +  it.each([
    +    'import { withSystemContext } from "../common/db/with-context";',
    +    'import { withSystemContext } from "../common/db/with-context.js";',
    +    'import { withSystemContext } from "../common/db/./with-context";',
    +    'export const m = () => import("../common/db/with-context");',
    +    'import { requestContextStorage } from "../common/request-context";\nrequestContextStorage.run({ system: true } as never, () => 1);',
    +  ])("flags %s", async (code) => {
    +    const [r] = await eslint.lintText(code, { filePath: "src/zz/not-allowlisted.ts" });
    +    expect(r.messages.some((m) => /with-context|identity/.test(m.message))).toBe(true);
    +  });
    +});
    ```
14. **Verification method:** The new cases fail on the baseline config (M3 shows it for `.js`) and pass after the fix; `npm run lint` over `src` stays green.
15. **Residual risks:** A wrapper that receives a callback and calls `withSystemContext` on behalf of arbitrary callers is not caught by any lint rule; the sweep found only file-private wrappers (`delegation.service.ts:178`, `transaction-transfer.service.ts:914`). The same gap probably exists for `BAN_OAUTH_PAYLOAD_ENTITY` and `BAN_INJECT_REPOSITORY` path forms; not tested.

### A26-S01-03 -- The layer instruction files order a local coverage run that `AGENTS.md`, the root `CLAUDE.md` and the verification contract say is CI's

1. **Severity:** LOW
2. **Confidence:** high
3. **Location:** `backend/CLAUDE.md:121` ("2. `TZ=UTC npm run test:unit -- --coverage`" under "Before you finish"); `frontend/CLAUDE.md:113` ("2. `npm run test:cov` (CI runs the coverage thresholds, not a bare `npm run test`)"). Contradicted by `AGENTS.md` "Required before you push" ("While developing run `npm run test:changed` ...; the coverage gate is CI's, run it locally only when asked"), root `CLAUDE.md` ("`test:changed` for tests; CI owns the coverage gate"), and `docs/verification-contract.md` s7 ("The full `test:cov` gate stays CI's").
4. **Violated invariant:** S01-I1. Causality: `PRE_EXISTING_UNREPORTED` (not verifiable against `d5cea9bf` in the shallow clone; the `test:changed` rule postdates the upstream audit, so it may be `NEW_SINCE_UPSTREAM_AUDIT`).
5. **Reproduction:** An agent working in `backend/` reads `backend/CLAUDE.md` (the protocol and `AGENTS.md` both say the more specific file applies to its subtree) and runs the full coverage suite before finishing; an agent reading `AGENTS.md` runs `test:changed` and skips coverage. The measured cost of the backend coverage run at the baseline is in section 12.1.
6. **Observed:** Two opposite instructions for the same step.
7. **Expected:** One rule. The guard `backend/src/common/test-changed.guard.spec.ts` holds the `AGENTS.md` version, so the layer files should match it.
8. **Impact:** Agent and contributor workflow only: either a long redundant run per task, or a contributor who reads only `AGENTS.md` believing the layer file is stale. No code impact.
9. **Root cause:** `AGENTS.md` and the root `CLAUDE.md` were updated to the `test:changed` rule; the two layer "Before you finish" lists were not.
10. **Recommended correction:** Change both layer lists to `npm run test:changed`, with the coverage run "only when asked".
11. **Suggested remediation diff (illustrative, not applied):**
    ```diff
    --- a/backend/CLAUDE.md
    +++ b/backend/CLAUDE.md
    @@
    -2. `TZ=UTC npm run test:unit -- --coverage` (and `npm run build && npm run test:integration` when a query, an entity, a migration or an RLS context changed)
    +2. `npm run test:changed` (the coverage gate is CI's; run `TZ=UTC npm run test:unit -- --coverage` only when asked), and `npm run build && npm run test:integration` when a query, an entity, a migration or an RLS context changed
    --- a/frontend/CLAUDE.md
    +++ b/frontend/CLAUDE.md
    @@
    -2. `npm run test:cov` (CI runs the coverage thresholds, not a bare `npm run test`)
    +2. `npm run test:changed` (CI runs `test:cov` and its thresholds; run it locally only when asked)
    ```
12. **Recommended regression test:** Extend `test-changed.guard.spec.ts` to scan every `CLAUDE.md` "Before you finish" block and fail on `--coverage` or `test:cov` there.
13. **Suggested regression-test diff:** incomplete. The guard's present scope was not read in full; the missing information is whether it already reads the layer files. The decision is the maintainer's: a scanning guard, or a single sentence in `AGENTS.md` that layer files never restate the gate.
14. **Verification method:** `instruction-files.spec.ts` (size ceilings) after the edit; the extended guard fails on the current text.
15. **Residual risks:** None material.

### A26-S01-04 -- `.claude/settings.json` pre-approves `npm install*`, an action `AGENTS.md` lists under "Ask first"

1. **Severity:** LOW
2. **Confidence:** high
3. **Location:** `.claude/settings.json` (`"Bash(npm install*)"`, also `"Bash(git add*)"`, `"Bash(git checkout -b*)"`). Secondary: root `CLAUDE.md` ("`.claude/settings.json` pre-approves lint, type-check, unit tests, the repo-level check scripts and read-only git. Ask before anything `AGENTS.md` lists under 'Ask first'"); `AGENTS.md` "Ask first: ... adding or upgrading a dependency" and "Do not change these casually: ... any `package-lock.json` (only as the product of an agreed dependency change)".
4. **Violated invariant:** S01-I1 (the permission layer matches the instruction layer). Causality: `PRE_EXISTING_UNREPORTED`.
5. **Reproduction:** A Claude Code agent asked to fix a build runs `npm install some-package` in `backend/`; the harness does not prompt, because the allow-list matches; `package.json` and `package-lock.json` change without the maintainer's agreement.
6. **Observed:** The machine-held permission layer allows, silently, what the prose layer forbids without asking. The root `CLAUDE.md` describes the allow-list as covering checks and "read-only git", which `npm install*`, `git add*` and `git checkout -b*` are not (the last two are permitted by `AGENTS.md` "Autonomous work" and are not a contradiction in effect).
7. **Expected:** The allow-list holds `npm ci*` (lock-file faithful) and not `npm install*`, or the root `CLAUDE.md` names the exception.
8. **Impact:** Process: a dependency change bypasses "Ask first". The pull-request review is still a backstop.
9. **Root cause:** `npm install` was allowed beside `npm ci` for convenience; the allow-list is not checked against `AGENTS.md`.
10. **Recommended correction:** Drop `Bash(npm install*)`; describe the list accurately in the root `CLAUDE.md`.
11. **Suggested remediation diff (illustrative, not applied):**
    ```diff
    --- a/.claude/settings.json
    +++ b/.claude/settings.json
    @@
           "Bash(npm ci*)",
    -      "Bash(npm install*)",
    --- a/CLAUDE.md
    +++ b/CLAUDE.md
    @@
    -- **Run the safe local actions yourself**: `.claude/settings.json` pre-approves lint, type-check, unit tests, the repo-level check scripts and read-only git.
    +- **Run the safe local actions yourself**: `.claude/settings.json` pre-approves `npm ci`, lint, type-check, unit tests, the repo-level check scripts, read-only git, staging and creating a branch.
    ```
12. **Recommended regression test:** A guard that reads `.claude/settings.json` and fails on an allow entry matching `npm install`, `npm i `, `npm update`, `git push`, `git reset`, `git rebase`.
13. **Suggested regression-test diff (illustrative, not applied):**
    ```diff
    --- a/backend/src/common/instruction-files.spec.ts
    +++ b/backend/src/common/instruction-files.spec.ts
    @@
    +  it("the Claude Code allow-list pre-approves nothing AGENTS.md lists under Ask first", () => {
    +    const s = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, ".claude/settings.json"), "utf8"));
    +    const allow: string[] = s.permissions?.allow ?? [];
    +    for (const a of allow) expect(a).not.toMatch(/npm (install|i |update|uninstall)|git (push|reset|rebase|branch -[dD])/);
    +  });
    ```
14. **Verification method:** The new case fails on the baseline file and passes after removal.
15. **Residual risks:** `npm run lint*` in `backend/` rewrites files (`--fix`, A26-S01-01); that is a local write the allow-list also permits, and is benign.

## 5. Prior-finding dispositions

| ID | Disposition | Evidence |
| --- | --- | --- |
| MON-M02 | `FIXED_VERIFIED` | The upstream evidence paths were `CLAUDE.md`, `backend/CLAUDE.md`, `CONTRIBUTING.md`, `.claude/skills/backend.md`. At the baseline: `.claude/skills/` does not exist (only `commands/audit.md` and `settings.json`); `CONTRIBUTING.md:42` and `AGENTS.md:73` both prohibit `@InjectRepository`, `createQueryRunner()`, `dataSource.transaction()` and a bare `dataSource.query`; `backend/CLAUDE.md:55` says the same. Mechanism: ESLint bans in `backend/eslint.config.mjs:277-443` (all three non-fixable, so A26-S01-01 does not weaken them) and `backend/src/common/db/lint-bans.spec.ts`, which scans `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `backend/CLAUDE.md` for a recommendation of a banned primitive. Executed: reintroducing the historical sentence ("must use a `QueryRunner` transaction") in `CONTRIBUTING.md` makes `lint-bans.spec.ts` fail 2 of 20 (section 6, M4); the spec is green at the baseline in the full unit run. Residual, not a finding: `docs/backend/testing.md:95` still describes injecting mocks via `getRepositoryToken()`, which 22 specs do as dead providers next to `createScopedDbMocks` (section 11); `lint-bans.spec.ts` does not scan `docs/backend/*.md`. |

## 6. Mutation table

| # | Invariant | Mutation (file:line, what) | Test or gate that fails | Verdict |
| --- | --- | --- | --- | --- |
| M1 | S01-I4 | Any `prettier/prettier` violation in `backend/src` (observed at baseline in 3 files) | none: CI `npm run lint` fixes and exits 0 (executed) | undetected (A26-S01-01) |
| M2 | S01-I2 | Add `@InjectRepository(X)` or `this.dataSource.transaction(...)` in a service | ESLint `no-restricted-imports` / `no-restricted-syntax`, not auto-fixable, so CI `backend-lint` fails | covered |
| M3 | S01-I3 | New non-allowlisted file imports `../common/db/with-context.js` (executed in scratch worktree) | none: eslint silent, tsc clean | undetected (A26-S01-02) |
| M4 | S01-I1 / MON-M02 | `CONTRIBUTING.md:42` replaced by "Every multi-table write must use a `QueryRunner` transaction." (executed) | `src/common/db/lint-bans.spec.ts`: 2 failed, 18 passed | covered |
| M5 | INV-CRON-001 | Remove the `claimLease(...)` call from a cron handler, keep its `docs/cron-jobs.md` row | none: `cron-doc.spec.ts` checks the doc's wording against `REPLICA_MECHANISM_VOCABULARY`, not the handler's code (read, not executed) | undetected (test-coverage gap already recorded by the entry's `partial` status; handed to S08) |
| M6 | S01-I1 | Grow `AGENTS.md` past its ceiling | `instruction-files.spec.ts` | covered (by reading the spec; green at baseline) |

## 7. Counterexamples and the interaction scenario

- **S01-I1, same command, different meaning:** `npm run lint` is named a check in `AGENTS.md` and is a formatter in `backend/` (`--fix`) but a check in `frontend/` (`eslint .`). An agent that runs it "to verify" in `backend/` writes source files. A26-S01-01, A26-S01-04 residual.
- **S01-I3, same module, different specifier:** `with-context` and `with-context.js` resolve to one module under `nodenext`; the fence keys on the string. A26-S01-02.
- **S01-I1, more specific file wins:** the protocol's scope rule (more specific instructions apply to their subtree) makes the stale `backend/CLAUDE.md` gate the binding one for backend work. A26-S01-03.
- **Interaction:** A26-S01-01 x A26-S01-02. Both fences are lint. The RLS fence survives `--fix` only because `no-restricted-imports` has no fixer; an editor auto-import that writes `.js` produces a file that passes lint, type-check and the 1048 unit suites, and the only reviewer signal left is the diff. The two gaps do not compound into a present-day bypass (no such import exists), but they show the gate's strength rests on rule properties no document states.

## 8. Rejected hypotheses

| Candidate | Evidence considered | Why rejected or downgraded | Final classification |
| --- | --- | --- | --- |
| A file outside `WITH_CONTEXT_ALLOWLIST` seeds a context today | 81 importers of `with-context` vs 81 allowlist entries, parsed with the TypeScript parser; 214 call sites; no alias, namespace, re-export, `require`, dynamic import; `requestContextStorage.run` only in `with-context.ts` and the allowlisted interceptor | Sets match exactly in both directions; no stale entry | `REJECTED` (the latent bypass is A26-S01-02) |
| Identity GUCs set outside `scoped-db.ts` | `set_config` sweep: `app-role.ts:218,243,250` (role), `advisory-locks.ts:85` (`lock_timeout`), `backup-export.service.ts:431`, `job-claim.service.ts:245` (`app.job_claim_lease_token`) | None sets `app.current_user_id`, `app.real_user_id`, `app.bypass_rls` or `app.preserve_timestamps` | `REJECTED` |
| A bare `dataSource.query` on tenant data outside the door | `src/database/fix-linked-transactions.ts`, `add-skip-price-updates-column.ts` (one-off maintenance scripts with their own `DataSource`), `health.controller.ts:146` (`SELECT 1`), `main.ts:198` (`pg_notify`) | None reads or writes tenant rows through the request path; the scripts are operator tools | `REJECTED`; the two maintenance scripts are handed to S04 to confirm they are not reachable from the API |
| A cron without any cross-replica mechanism | 49 handlers in 46 files; every one names a claim, lease, conditional write, dedupe index or an idempotent predicate `DELETE` (section 12.3) | The 16 handlers without a claim either delete by predicate, recompute absolutely under a row lock, or dedupe their notification; none sends email, push or a provider call without a claim, lease or dedupe key | `REJECTED` at inventory level; per-job proof is S08 |
| `npm ci` on Node 22 is a repository defect | S00 record; README.md:418,491 says Node 24; every CI job pins `node-version: 24`; Dockerfiles use `node:24-*` | No `engines` field and no `.nvmrc`, but the requirement is documented and enforced where it matters | `REJECTED` (environment fact); the absent `engines`/`.nvmrc` is in section 9 |
| The 2 skipped backend unit tests hide a defect | `backup/auto-backup.service.spec.ts:935,1346` skip when `process.getuid() === 0` (permission tests); the session container runs as root, CI does not | Environment-dependent by design | `REJECTED` |
| Guard specs silently skip and pass | 14 guard specs use `REPO_ROOT || process.env.CI ? describe : describe.skip` | In a clone `REPO_ROOT` resolves; in CI `CI` is set; they ran here (no extra skips counted) | `REJECTED` |
| An AI tool wired into only one adapter | Not searched in this session | Out of slice | handed to S17 |

## 9. Design risks

- **DR-S01-1 The lint gate's strength rests on undocumented rule properties.** The RLS bans hold under `--fix` only because no fixer exists for them; adding an auto-fixable custom rule later would silently stop gating (A26-S01-01 widens this).
- **DR-S01-2 `cron-doc.spec.ts` checks prose, not code.** It proves each `docs/cron-jobs.md` row names a mechanism from `REPLICA_MECHANISM_VOCABULARY`; nothing checks that the handler calls it (M5). A handler refactor can drop its claim with the doc unchanged.
- **DR-S01-3 No `engines` field and no `.nvmrc`.** `npm ci` fails on Node 22 with an engine message about a transitive package, not about the project; README.md:491 is the only statement.
- **DR-S01-4 CI's UTC is implicit.** `backend-unit-tests` runs `npm run test:unit -- --coverage` without `TZ`; it is UTC because GitHub's `ubuntu-latest` image is. `AGENTS.md` says "`TZ=UTC npm run test:unit -- --coverage` # what CI runs". A self-hosted runner in another zone would make `insights-aggregator.service.spec.ts` and `net-worth.service.spec.ts` flap (verification-contract s7).
- **DR-S01-5 E2E CI retries.** `e2e/playwright.config.ts:12` sets `retries: 2` under `CI`; a test that fails twice and passes once is green. Handed to S21.
- **DR-S01-6 Workflow concurrency group shared with releases.** `ci.yml:41-43` groups by workflow and ref with `cancel-in-progress: true`; a push to `main` can cancel an in-flight `workflow_dispatch` release on `main` (not tested). Handed to S21 (INV-RELEASE-001).

## 10. Missing tests and known-wrong tests

- Missing: a guard that CI lint steps do not auto-fix (A26-S01-01).
- Missing: a lint-config test that every spelling of a `with-context` import and a direct `requestContextStorage.run` is flagged outside the allowlist (A26-S01-02).
- Missing: a code-level check that each `@Cron` handler calls the mechanism its doc row names (DR-S01-2, M5).
- Missing (INV-CRON-001, recorded `partial`): two-instance tests per job; only the MNY job has one.
- Known-wrong: none found in the slice. `docs/verification-contract.md` s5 is S02's.

## 11. Documentation inconsistencies

| # | Where | Inconsistency |
| --- | --- | --- |
| D1 | `docs/audits/2026-10/plan.md` s1 | "Invariant index at baseline: 145 entries: 126 enforced, 19 partial, 1 unenforced" sums to 146. The index table says 126/18/1; the entry bodies say 125/19/1. The difference is INV-BONDNOTIFY-003 (D2). |
| D2 | `docs/system-invariants.md` | INV-BONDNOTIFY-003: index row `enforced`, entry body `Status partial` ("no guard scanning the rules for a recomputed figure"). The plan's list of 19 non-enforced IDs omits it. |
| D3 | `docs/audits/2026-10/plan.md` s1 | "40 cron jobs": the code and `docs/cron-jobs.md` have 49 `@Cron` handlers in 46 services. |
| D4 | `docs/audits/2026-10/plan.md` s5 | `backend/src/import-preview/` is "2k"; measured 222 non-test lines (`.ts`). MNY import "73k": `backend/src/import/` is 22.8k non-test `.ts` lines, 83k including non-`.ts` files. Bonds "18k": 13.9k `.ts`, 21.6k all files. |
| D5 | `docs/backend/testing.md:95` | Recommends injecting repository mocks via `getRepositoryToken()`; production services inject only `DataSource` and the working pattern is `createScopedDbMocks` (`src/built-in-reports/tax-recurring-reports.service.spec.ts:143-163` carries both, the token providers dead). Not scanned by `lint-bans.spec.ts`. MON-M02 residual. |
| D6 | `backend/src/mcp/CLAUDE.md` | "Three of them hold on every change here" followed by four bullets. |
| D7 | `CONTRIBUTING.md:39-43` | "Two of them are worth restating" followed by three bullets. |
| D8 | `docs/system-invariants.md` INV-CRON-001 (from line 5745) | Says the budget rollover is guarded by "ON CONFLICT ... with the loser re-reading the winner"; the code (`budget-period-cron.service.ts:121,203`) and `docs/cron-jobs.md` use `claimOnce` plus `releasePermanentClaim`. |
| D9 | `docs/cron-jobs.md:27` | The `processAutoPostTransactions` row omits the `scheduled_transaction_postings ON CONFLICT (scheduled_transaction_id, original_due_date)` claim (`scheduled-transactions.service.ts:3651`) that `concurrency-and-idempotency.md` names. |
| D10 | `docs/cron-jobs.md:36` | The `closeExpiredPeriods` row does not mention the monthly summary email (`budget-period-cron.service.ts:228,401`), guarded only by the per-owner `claimOnce`, with no delivery record. |
| D11 | `docs/system-invariants.md` INV-HA-001 | Prose says "The E2E above does not exist yet"; Required tests says the positive half exists (`e2e/tests/cluster.spec.ts:117-118` asserts the 200 case). |
| D12 | `docs/system-invariants.md` INV-LOAN-HISTORY-001 | The second gap ("no reader branches on `interest_booking_mode`") is stale: `loan-installments/plan-loan-settlement.ts:231` and `transaction-rules/rule-loan-settlement.ts:165` branch on it; the history producer still does not. |
| D13 | `docs/system-invariants.md` INV-RULE-002 | The call-site list omits `bank-sync/bank-sync-writer.service.ts:323`, which the guard's `APPLYING_SITES` includes. |
| D14 | `docs/verification-contract.md:347`, `AGENTS.md` | Present `npm run lint` as the backend lint check; it is a fixer (A26-S01-01). |
| D15 | root `CLAUDE.md` | Describes `.claude/settings.json` as "read-only git"; it allows `git add*` and `git checkout -b*` (A26-S01-04). |

## 12. Review ledger

### 12.1 Baseline suite results

SUITE_TABLE_PLACEHOLDER

### 12.2 `withSystemContext` / `withUserContext` / `withDelegateContext` / `withPreserveTimestamps` call sites against `WITH_CONTEXT_ALLOWLIST`

`WITH_CONTEXT_ALLOWLIST` (`backend/eslint.config.mjs:17-268`) has 81 entries, no duplicates. Exactly 81 non-spec files under `backend/src` import `common/db/with-context`, all with plain named imports; the two sets are equal. 214 call sites (comment hits excluded). S = system, U = user, D = delegate, P = preserve-timestamps; counts per file.

| File (under `backend/src/`) | Calls | File | Calls |
| --- | --- | --- | --- |
| accounts/accounts.service | S1 | delegation/cross-owner-access.service | S5 |
| accounts/mortgage-reminder.service | S1 U1 | delegation/delegation.service | S5 D2 |
| action-history/action-history.service | S1 | delegation/guards/account-delegate.guard | D1 |
| admin/admin.service | S8 | delegation/joint-accounts.service | S1 |
| ai/ai-usage.service | S1 | email-receipts/poll/email-receipt-poll.service | S1 U1 |
| ai/insights/ai-insights.service | S2 U1 | emergency-access/emergency-access-claim.controller | S2 |
| ai/relay/relay-sweeper.service | S1 | emergency-access/emergency-access-monitor.service | S2 |
| ai-review/ai-review-notification.service | S2 U2 | import/mny/mny-import-job.service | S1 U1 |
| ai-review/ai-review-requests-expiry.service | S1 | import/mny/mny-import.service | U2 |
| attachments/attachment-orphan-sweeper.service | S1 | import/mny/mny-staging.service | S1 |
| attachments/storage/attachment-storage-migrator.service | S3 U1 | mcp/mcp-http.controller | U5 |
| auth/auth-state-sweeper.service | S1 | mcp/tools/transactions.tool | U2 |
| auth/auth.controller | S4 | net-worth/net-worth.service | S1 U2 |
| auth/auth.service | S13 | notification-center/balance-threshold-alert.service | U1 |
| auth/pat.service | S1 | notification-center/notification.service | S1 |
| auth/strategies/jwt.strategy | U1 D1 | notification-center/portfolio-movement-alert.service | S1 U1 |
| auth/token.service | S1 | notification-center/security-price-alert.service | S1 U1 |
| backup/auto-backup.service | S11 U9 | notifications/bill-reminder.service | S1 U1 |
| backup/backup-restore.service | P1 | notifications/notification-reminder-cron.service | S2 U1 |
| backup/offsite/backup-offsite-dispatch.service | U1 | notifications/provider-outage-alert.service | S1 |
| backup/offsite/backup-offsite-retry.service | S2 U1 | oauth/oauth-interaction.controller | U1 |
| bank-sync/bank-sync-consent-reminder.service | S1 U1 | oauth/oauth-provider.service | U2 |
| bank-sync/bank-sync-cron.service | S1 U1 | oauth/oauth-signing-keys.service | S1 |
| bonds/benchmark-refresh.service | S3 | payees/lookup/google-places/payee-lookup-quota.service | S3 |
| bonds/bond-catalog.service | S1 | payees/lookup/payee-contact-enrichment.service | U1 |
| bonds/bond-notification.service | S1 U1 | provider-health/provider-health.service | S1 |
| bonds/bond-price.service | S2 U2 | push/push-chart-artifact.service | S3 |
| bonds/bond-series.service | S1 | push/push-config.service | S4 |
| budgets/budget-alert.service | S2 U2 | push/push-subscription.service | S1 |
| budgets/budget-period-cron.service | S1 U5 | scheduled-transactions/scheduled-transactions.service | S2 U3 |
| categories/joint-categories.service | S1 | securities/holdings.service | S1 U1 |
| common/cluster/replica-census.service | S1 | securities/holdings-drift-report.service | S1 U1 |
| common/interceptors/request-context.interceptor | U3 + direct `requestContextStorage.run` :136 | securities/market-index.service | S3 |
| common/jobs/job-claim.service | S1 | securities/security-price.service | S3 |
| common/throttler/postgres-throttler-storage | S1 | securities/securities.controller | S1 |
| currencies/currencies.service | S1 | strategies/gem-signal-change-alert.service | S1 U1 |
| currencies/exchange-rate.service | S3 U1 | system-alerts/system-alert.service | S1 U1 |
| database/demo-reset.service | S2 | transaction-rules/transaction-rule-applications-retention.service | S1 |
| database/demo-seed.service | S2 | transactions/joint-register.service | S5 |
| database/seed.service | S1 | transactions/transaction-transfer.service | S5 |
| | | updates/updates.service | S3 |

Not in the allowlist but calling: none. Stale allowlist entries: none. Wrappers passing a caller's callback into system context: only file-private ones (`delegation.service.ts:178` `systemScoped`, callers in-file at 809, 1053, 1484, 1523, 1532; `transaction-transfer.service.ts:914` `inWriteIdentity`; local closures `payee-lookup-quota.service.ts:104,197`, `transaction-transfer.service.ts:1081`). The per-site justification of each system-context use (does it need to bypass RLS) is S03/S04's.

### 12.3 Cron matrix

49 `@Cron` handlers in 46 services (plan said 40, D3). `ScheduleModule.forRoot()` at `backend/src/app.module.ts:164`: every replica fires every handler. `docs/cron-jobs.md` has 49 rows, one per handler; `cron-doc.spec.ts` holds the row-per-handler, the expression and the mechanism vocabulary (prose only, DR-S01-2). Ctx: Sys = `withSystemContext` only; Sys/User = system scan then `withUserContext` per user. Paths under `backend/src/`.

| # | Handler (file:line) | Schedule | Cross-replica mechanism | Ctx | Side effect idempotency |
| --- | --- | --- | --- | --- | --- |
| 1 | database/demo-reset.service:29 resetDemoData | `0 4 * * *` | `claimOnce(DemoReset, reset:<UTC day>)` :68 | Sys | permanent claim |
| 2 | database/demo-reset.service:226 generateIntradayTransactions | `0 */3 * * *` | `claimOnce(DemoIntraday, <day>-<hour>)` :254 | Sys | permanent claim |
| 3 | ai/ai-usage.service:69 purgeOldUsageLogs | `0 4 * * *` | none; predicate DELETE | Sys | n/a |
| 4 | ai/insights/ai-insights.service:355 handleDailyInsightGeneration | 06:00 | `claimLease(AiInsightGeneration)` :184 + cooldown re-read | Sys/User | LLM call may repeat after an empty save (documented) |
| 5 | auth/token.service:363 purgeExpiredRefreshTokens | 03:00 | none; predicate DELETE | Sys | n/a |
| 6 | scheduled-transactions/scheduled-transactions.service:527 processAutoPostTransactions | `5 * * * *` | `expectedDueDate` pin :624, `pessimistic_write` :2509, `scheduled_transaction_postings ON CONFLICT` :3651 | Sys/User | unique posting key; failure alert dedupeKey :723 |
| 7 | scheduled-transactions/scheduled-transactions.service:760 refreshForeignCurrencyEstimates | `25 17 * * 1-5` NY | none; absolute overwrite | Sys | n/a |
| 8 | currencies/exchange-rate.service:1396 scheduledRateRefresh | `5 17 * * 1-5` NY | `withLease("exchange-rates")` :194 | Sys | upsert :337; startup backfill unleased (documented) |
| 9 | accounts/accounts.service:2168 applyDueTransactionBalances | `0 * * * *` | none; `lockAccountsForBalanceWrite` + absolute recompute | Sys | absolute (CONC-003 register) |
| 10 | net-worth/net-worth.service:511 sweepStaleSnapshots | every 30 min | none; absolute recompute; CAS alert latch | Sys/User | CAS latch |
| 11 | accounts/mortgage-reminder.service:86 checkMortgageRenewals | 08:00 | `claimLease(MortgageReminder)` :176 | Sys/User | wasDelivered/markDelivered (at-least-once) |
| 12 | notifications/bill-reminder.service:82 sendBillReminders | 08:00 | `claimLease(BillReminder)` :226 | Sys/User | wasDelivered :237 / markDelivered :396 |
| 13 | notifications/provider-outage-alert.service:155 sweepProviderHealth | `*/10 * * * *` | conditional `UPDATE provider_health ... RETURNING` :233,:335 | Sys | CAS per episode + dedupeKey :279 |
| 14 | system-alerts/system-alert-monitor.service:117 sweepSystemHealth | `*/15 * * * *` | `idx_notifications_dedupe` (dedupeKey :173,:234) | Sys | dedupe index; SMTP probe per replica by design |
| 15 | budgets/budget-period-cron.service:72 closeExpiredPeriods | `0 0 1 * *` | `claimOnce(BudgetPeriodRollover)` :121, `releasePermanentClaim` :203, ON CONFLICT :113 | Sys/User | monthly email has only the owner claim, no delivery record (D10) |
| 16 | budgets/budget-alert.service:136 checkBudgetAlerts | `0 7 * * *` | notify `ON CONFLICT DO NOTHING RETURNING` :410 | Sys/User | insert winner sends |
| 17 | budgets/budget-alert.service:191 sendWeeklyDigest | `0 7 * * 1` | `claimLease` :947 | Sys/User | wasDelivered :958 / markDelivered :978 |
| 18 | securities/security-price.service:1779 scheduledPriceRefresh | `0 17 * * 1-5` NY | `withLease("security-prices")` :1792 | Sys | upsert :1052 |
| 19 | securities/market-index.service:399 scheduledRefresh | `10 17 * * 1-5` NY | `withLease("market-indexes")` :380 | Sys | upsert :798 |
| 20 | bonds/benchmark-refresh.service:101 scheduledRefresh | `25 6 * * 1-5` Warsaw | `withLease("bond-benchmarks")` :81 | Sys | ON CONFLICT :378 |
| 21 | bonds/bond-price.service:103 scheduledRecompute | `45 6 * * *` Warsaw | `withLease("bond-prices")` :107, advisory lock 7 | Sys/User | upsert :482 |
| 22 | bonds/bond-series.service:427 scheduledCurrentOffer | `15 7 * * *` Warsaw | `withLease("bond-series")` :431, advisory lock 8 | Sys | immutable store |
| 23 | strategies/gem-signal-change-alert.service:63 run | `30 17 * * 1-5` NY | dedupeKey :176 | Sys/User | dedupe index |
| 24 | bonds/bond-notification.service:71 run | `40 7 * * *` Warsaw | dedupeKey :158 | Sys/User | dedupe index |
| 25 | notification-center/portfolio-movement-alert.service:94 run | `40 17 * * 1-5` NY | dedupeKey :507 | Sys/User | dedupe index |
| 26 | notification-center/security-price-alert.service:63 run | `*/15 * * * *` | dedupeKey :153 (+ in-process `running` :55) | Sys/User | dedupe index |
| 27 | push/push-chart-artifact.service:27 cleanup | `*/5 * * * *` | none; predicate DELETE | Sys | n/a |
| 28 | ai/relay/relay-sweeper.service:53 sweepRelayState | `*/5 * * * *` | none; predicate | Sys | n/a |
| 29 | import/mny/mny-staging.service:160 sweepExpiredFiles | hourly | none; predicate | Sys | staged files (MON-L04, S09) |
| 30 | import/mny/mny-import-job.service:737 reapStaleJobs | hourly | conditional `UPDATE import_jobs ... RETURNING` | Sys | CAS |
| 31 | backup/auto-backup.service:1654 handleAutoBackupCron | `0 * * * *` | `UPDATE ... next_backup_at <= $3 RETURNING user_id` :1614 | Sys/User | claimOnce on email dedupe key |
| 32 | backup/offsite/backup-offsite-retry.service:131 handleRetrySweep | `30 * * * *` | `status -> 'uploading' ... RETURNING` (dispatch :374) | Sys/User | CAS claim |
| 33 | action-history/action-history.service:2043 cleanupExpiredHistory | `0 3 * * *` | none; predicate | Sys | n/a |
| 34 | notification-center/notification.service:321 purgeOld | `0 3 * * *` | none; predicate | Sys | n/a |
| 35 | notifications/notification-reminder-cron.service:90 fireDue | `* * * * *` | `UPDATE ... RETURNING` over `FOR UPDATE SKIP LOCKED` :128 | Sys/User | row claimed once |
| 36 | push/push-subscription.service:396 purgeRetiredDevices | `30 3 * * *` | none; predicate | Sys | n/a |
| 37 | common/jobs/job-claim.service:325 sweepOldClaims | 04:00 | none; predicate | Sys | n/a |
| 38 | auth/auth-state-sweeper.service:41 sweepExpiredAuthState | `0 4 * * *` | none; predicate | Sys | n/a |
| 39 | transaction-rules/transaction-rule-applications-retention.service:49 purgeExpiredApplications | `45 3 * * *` | `FOR UPDATE SKIP LOCKED` :33 | Sys | n/a |
| 40 | ai-review/ai-review-requests-expiry.service:54 sweepQueue | `20 * * * *` | `SKIP LOCKED` :40; dedupe key | Sys | dedupe index |
| 41 | ai-review/ai-review-notification.service:137 notifyExpiring | `41 7 * * *` UTC | dedupeKey :40 / ON CONFLICT :85 | Sys/User | dedupe index |
| 42 | email-receipts/poll/email-receipt-poll.service:127 pollAll | `*/15 * * * *` | `claimLease(EmailReceiptPoll)` :96 | Sys/User | ON CONFLICT :99 on uid |
| 43 | securities/holdings.service:941 applyMaturedInvestmentHoldings | `30 * * * *` | none; `lockHoldingScope` + rebuild | Sys/User | absolute rebuild |
| 44 | emergency-access/emergency-access-monitor.service:182 runDailyCheck | 09:00 | CAS `granted_at IS NULL` :102; `claimLease` :765, :488 | Sys | lease + delivery record |
| 45 | updates/updates.service:130 scheduledRefresh | every 12 h | conditional upsert `... DO UPDATE ... WHERE ... RETURNING` :304 | Sys | claim window |
| 46 | attachments/attachment-orphan-sweeper.service:358 sweepOrphanedObjects | hourly | `UPDATE attachment_blob_tombstones ... RETURNING` :278-286 | Sys | provider delete idempotent |
| 47 | attachments/storage/attachment-storage-migrator.service:206 relocateOnSchedule | `0 50 * * * *` | `withLease("attachment-relocation")` :272, row `FOR UPDATE` :539 | Sys/User | ON CONFLICT :598 |
| 48 | bank-sync/bank-sync-cron.service:62 handleDailySync | `17 5 * * *` UTC | `claimOnce(BankSyncDaily)` :121 + `claimLease(BankSyncAccount)` | Sys/User | ON CONFLICT ledger + dedupe |
| 49 | bank-sync/bank-sync-consent-reminder.service:88 handleDailyReminders | `23 6 * * *` UTC | dedupeKey :65 / ON CONFLICT :67 | Sys/User | dedupe index |

Per-process timers outside `@Cron` (not in `docs/cron-jobs.md`, which covers only `@Cron`): heartbeats `ai/query/ai-query.controller.ts:94`, `ai/relay/ai-relay.controller.ts:81`, `import/mny/mny-import-job.service.ts:655`; MCP session cleanup `mcp/mcp-http.controller.ts:128`; a harness `backup/restore-peak-rss.harness.ts:307`. No `@Interval`, `@Timeout`, `SchedulerRegistry` or `CronJob`. Process-local guards beside a cron are held by `derived-state-writers.guard.spec.ts:215` (5 allowlisted files) and `process-local-state.guard.spec.ts`.

### 12.4 The non-enforced invariants as standing hypotheses

Index table: 145 rows, 126 `enforced`, 18 `partial`, 1 `unenforced`. Entry bodies: 125/19/1; INV-BONDNOTIFY-003 is the difference (D2). "Still the gap" = the recorded gap reproduces in code; "other path" = a path with the same gap the entry does not list. [V] = verified in code, [D] = read in the doc only.

| ID | Recorded gap still the gap? | Other path not listed in the entry | Hand to |
| --- | --- | --- | --- |
| INV-IMPORT-003 (unenforced) | yes [V]: `import/import.service.ts:664-680` check-then-insert, no ON CONFLICT; `schema.sql:268` `UNIQUE(user_id, name, parent_id)` never trips for NULL `parent_id` | **yes [V]**: MNY writer `import/mny/writers/write-reference.ts:168-201` (`writeCategories`) reads then plain `repo.insert`; for top-level names a concurrent create yields a duplicate category, not an abort | S09 |
| INV-BANKSYNC-001 | yes [V]: `keyFor` `bank-transaction-planner.ts:541-556`; BS10 unchecked `docs/future-plans/bank-sync-tasks.md:30` | **yes [V, read only]**: `resolveEntryReferences` (`:381-413`) adds `#<hash>` only when the current fetch holds a duplicate reference, so `ref:X` then `ref:X#...` re-keys the same row | S10 |
| INV-API-001 | yes, part (1) [V]: `snapshotTransaction` (`transactions.service.ts:3773-3800`) omits `externalId`; (2),(3) [D] | no | S07 |
| INV-FX-001 | yes [V]: `report-currency.service.ts:99-121` returns `amount` unconverted; `data-quality-reports.service.ts:123,220` label it `defaultCurrency` | no; caller families match the doc. Note: comment at `report-currency.service.ts:105` says these reports use a flat latest-rate lookup | S13 |
| INV-FX-003 | yes [V]: no CHECK on `exchange_rates` (`schema.sql:88-96`) | no; raw inserts only `exchange-rate.service.ts:335,415`, `write-prices.ts:226`, all through `canonicalRateRow` | S13 |
| INV-PRICE-001 | yes [V]: `security_prices` has no currency column | possible [V, unassessed]: writers outside `refuseForeignCurrency`: `import/mny/writers/write-prices.ts:112`, `bonds/bond-price.service.ts:479`, `security-price.service.ts:2364,2432`, `database/demo-seed.service.ts:902` (entry scopes itself to provider prices) | S12 |
| INV-LOAN-HISTORY-001 | yes, main gap [V]: `frontend/src/lib/loan-history.ts:1607-1613` filters by interest category and source account only | no; second gap wording stale (D12) | S15 |
| INV-BOND-010 | yes [V]: `net-worth/` has no bond-specific valuation | **yes [V]**: `monte-carlo/monte-carlo.service.ts:511-539,708-727` values each holding as `quantity x getLatestPrices()` without a `bondProgramId` check | S13 / S14 |
| INV-BACKUP-004 | yes, by nature (bucket policy outside the repo) [V]: uploader builds no Delete/Get/Head; `IfNoneMatch: "*"` :118,:298 | no | S06 |
| INV-BACKUP-005 | yes [V]: `backup-offsite-email.sender.ts:99-135` reports "uploaded" when `sendMail` resolves | no | S06 |
| INV-BACKUP-008 | yes [V]: `backup_password_enc` still in `schema.sql:51`; `backup-password.util.ts:29-33` decrypts it | no | S06 |
| INV-CRON-001 | yes [D]: only the MNY job has a two-instance test; text stale (D8) | not assessed per job; M5 | S08 |
| INV-RELEASE-001 | yes [V]: bump commit and push `ci.yml:~1149-1151`; `gh release create` without `--target` `ci.yml:1191-1197` | possible: workflow concurrency group shared with push-to-main (DR-S01-6) | S21 |
| INV-HA-001 | yes [V]: `e2e/tests/cluster.spec.ts:117-118` asserts only the 200 case | no; prose self-contradiction (D11) | S21 |
| INV-RULE-001 | yes [V]: `rule-run-undo.ts:125` collects `affectedAccountIds`, `action-history.service.ts:615-620` drops them | **wider [V]**: no file in `action-history/` references `NetWorthService`; no undo or redo path triggers a net-worth recompute (only `invalidatePortfolioSummary` :517,:551), while INV-CACHE-001 is `enforced`; whether the 30-minute stale-snapshot sweep (#10) covers it is open | S07 / S10 |
| INV-RULE-002 | yes [V]: guard comment `rule-application-sites.guard.spec.ts:56-58` | no; list stale (D13) | S10 |
| INV-RULE-003 | yes [V]: fingerprint has no account state | open: `rule-row-explain.ts` is a second evaluation used for explanations; agreement with the planner unchecked | S10 |
| INV-RULE-004 | yes, by design [V] | no; AI/MCP passes the window (`rule-tool-prep.service.ts:940-947`) | S10 |
| INV-SEARCH-001 | yes [V]: `HAND_PATTERN` scope `transactions/` only | `reports/reports.service.ts:573,724` build `%...%` unescaped; declared out of scope by the guard (`:138-140`), not a violation as written | S16 |
| INV-BONDNOTIFY-003 (body `partial`, index `enforced`) | body gap: copy held by unit tests only, no guard for a recomputed figure | not assessed | S14 |

Enforced entries: a scripted check of every file path named in the 125 body-`enforced` entries (622 tokens) resolved all of them against `git ls-files`; two unresolved tokens were prose. Existence does not prove the mechanism.

### 12.5 Module inventory and architecture delta

Backend `src/` non-test `.ts`: 345 341 lines in 1 395 files (49 top-level directories plus root files `main.ts`, `app.module.ts`, `db-*.ts`); 1 041 `*.spec.ts` under `src/`; 118 integration specs under `backend/test/integration/`. Frontend `src/` non-test `.ts/.tsx`: 277 492 lines in 1 262 files (components 188k, lib 43k, app 19.6k, hooks 12k, types 10k, store 2.4k). Migrations: 233 files, 56 timestamped. E2E: 40 specs in `e2e/tests/`, 1 in `e2e/push/`, 5 screenshot specs in `e2e/readme/` (run only by `playwright.readme.config.ts`, not CI). The plan's "411k in 1 429 files" for the backend counts more than `src/**/*.ts`; the method was not recorded (D4).

Backend modules, non-test `.ts` lines (files / specs); `*` marks a module plan s5 lists as new since `d5cea9bf`:

securities 34 717 (80/63); email-receipts* 27 271 (121/95); ai 23 147 (75/63); import 22 835 (68/54; 83k with non-`.ts` files); backup 22 157 (75/53); transactions 19 575 (43/29); accounts 15 697 (44/39); common 14 094 (112/126); bonds* 13 931 (69/50); transaction-rules* 11 568 (48/56); bank-sync* 10 084 (48/30); scheduled-transactions 9 574; mcp 9 531; payees 9 105; budgets 7 966; auth 7 621; net-worth 7 596; built-in-reports 7 492; strategies* 7 115; currencies 5 576; notifications 4 196; notification-center* 4 000; database 3 909; delegation 3 795; ai-review* 3 607; loan-installments 3 348; attachments 3 303; users 3 083; push* 2 896; investment-reports 2 769; categories 2 759; action-history 2 674; emergency-access 2 345; monte-carlo 2 127; oauth* 1 924; reports 1 896; loan-rate-changes* 1 366; updates* 1 204; provider-health* 1 070; admin 1 007; test-helpers 994; tags 965; institutions 775; system-alerts* 747; loan-scenarios* 604; calendar* 535; i18n 359; import-preview* 222; health 210.

The upstream baseline `d5cea9bf` is not reachable in the shallow clone (256 commits back to 2026-10-11), so the delta list is plan s5's, re-measured for size, not re-derived by diff.

### 12.6 Ledger

- Directories inspected: repository root, `.claude/`, `.github/workflows/` (`ci.yml` jobs `backend-lint`, `backend-unit-tests`, `backend-integration-tests`, `frontend-*`, `e2e-tests`, env/concurrency header), `backend/` config, `backend/src/common/db/`, `e2e/` config.
- Files read in full: `AGENTS.md`, `CLAUDE.md`, `backend/CLAUDE.md`, `e2e/CLAUDE.md`, `backend/src/mcp/CLAUDE.md`, `CONTRIBUTING.md`, `.claude/settings.json`, `.lintstagedrc.cjs`, `docs/audits/2026-10/{plan,ledger,prior-findings-register}.md`, S01 block of `sessions.md`.
- Sampled: `frontend/CLAUDE.md` and `database/CLAUDE.md` (command and gate lines), `backend/eslint.config.mjs:17-30,270-300,395-475`, `docs/verification-contract.md:483-560`, `docs/backend/testing.md:85-110`, `docs/system-invariants.md` (INV-RELEASE-001 and the 20 non-enforced entries via a delegated sweep), `docs/cron-jobs.md:1-20`, `backend/src/common/db/prohibited-primitive-guidance.ts:1-40`, `lint-bans.spec.ts` (doc list), `ci.yml:23-155,1452-1600`.
- Delegated read-only sweeps (results re-checked by spot reads): `WITH_CONTEXT_ALLOWLIST` reconciliation (12.2), cron matrix (12.3), non-enforced invariants (12.4).
- Searches: banned DB primitives across all `*.md` and `src/`; `getRepositoryToken` (22 spec files); `set_config` identity GUCs; `describe.skip`/`it.skip`; `@Cron`/`@Interval`/`setInterval`; `passWithNoTests`.
- Areas reviewed without a finding: the DB-primitive bans and their documented list (MON-M02); allowlist vs call sites; cron doc vs code (one row per handler, expressions); CI image registries (Dockerfiles `FROM mirror.gcr.io`); guard specs' skip conditions.
- Open hypotheses handed on: see 12.4 "Hand to" column, plus: to S04, the two `src/database/*.ts` maintenance scripts with their own `DataSource` are not reachable from the API; to S08, M5 and D10 (monthly budget summary email has no delivery record; a crash after the claim and before the send loses the email, a crash after the send and before completion does not repeat it); to S21, DR-S01-5 (E2E `retries: 2`), DR-S01-6 (concurrency group), the matrix `include` that turns shard 4 into the cluster shard (the single-backend shard 4 subset never runs on one backend), and that `e2e/` code is neither linted nor type-checked in CI (only executed by Playwright's transpiler); to S03/S04, the per-site justification of each of the 214 context call sites.

## 13. Adversarial approval challenge

Assumption: "the gates hold the instruction rules" is wrong. Started from the slice's own abstractions (the instruction files, the lint fences, the CI jobs, the guard specs), not from the findings.

- **Does every rule `AGENTS.md` calls machine-held actually fail CI?** Traced each named guard to a job: lint bans -> `backend-lint` (survive `--fix`, M2); `lint-bans.spec.ts`, `instruction-files.spec.ts`, `doc-paths.spec.ts`, `cron-doc.spec.ts`, `ci-images.guard.spec.ts`, `jest-config.guard.spec.ts`, `test-changed.guard.spec.ts` -> `backend-unit-tests` (all green in the baseline run, none skipped: the 2 skips are the root-only backup permission tests). Found: the lint step is a fixer (A26-S01-01).
- **Can a fence be passed by a spelling it did not anticipate?** Tried every import spelling against `BAN_WITH_CONTEXT`; found the `.js`/`.ts`/`./`/dynamic misses (A26-S01-02).
- **Does a more specific instruction contradict the canonical one?** Compared every "Before you finish" and "Commands" block with `AGENTS.md`: coverage contradiction (A26-S01-03); permission allow-list vs "Ask first" (A26-S01-04); counting slips (D6, D7).
- **Does CI swallow a failure?** Searched `continue-on-error`, `|| true`, `if: always()`: the dev-dependency audit (`ci.yml:235`) and `zizmor ... || true` (`ci.yml:615`) are documented informational steps, the `always()` uses are artifact uploads. No hidden swallow found. `retries: 2` in E2E is a softer gate (DR-S01-5).
- **Is any layer outside every gate?** `e2e/` TypeScript is neither linted nor type-checked in CI (handed to S21).
- **Are the plan's own figures, which later sessions rely on, true?** No: cron count, invariant counts and three module sizes are wrong (D1, D3, D4); later sessions should use section 12.
- **Do the non-enforced invariants list every path?** No: four entries have an unlisted path (INV-IMPORT-003, INV-BANKSYNC-001, INV-BOND-010, INV-RULE-001), and one `enforced` index row is `partial` in its body (INV-BONDNOTIFY-003). Each is handed to its owning session rather than promoted here, because S01 did not construct their reproductions.

Result: no BLOCKER or HIGH candidate arose in the slice; the four findings stand as LOW.
