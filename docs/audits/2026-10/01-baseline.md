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
15. **Residual risks:** Does not cover other workflows that may call `npm run lint` (`lighthouse.yml`, `zap.yml` were not read). The guard parses YAML textually.

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
