# Remediation Streams: branches grouped by file locality

> Companion to [`remediation-tasks.md`](./remediation-tasks.md). The 58 tasks are grouped into
> branches ("streams") so that no two branches worked on at the same time edit the same source
> file. Inside a stream the tasks run in the listed order, one commit per task, on one branch.
> The grouping was computed from the `Files` list of every task: tasks that share a non-doc file
> are in one stream, and the hub files (`accounts.service.ts`,
> `investment-transactions.service.ts`, `token.service.ts`, `transaction-transfer.service.ts`,
> `ci.yml`) each belong to exactly one stream.

## Rules for every fix session

- Branch from `origin/main` (equal to `AUDIT_BASELINE_SHA` `72c59ec4` when this file was
  written): `git fetch origin main && git checkout -B <branch> origin/main`. Never commit to
  `main`; never push to another stream's branch.
- The audit reports live only on `ccr-1f689e5c-onia07`: `git fetch origin ccr-1f689e5c-onia07`
  and read them with `git show origin/ccr-1f689e5c-onia07:docs/audits/2026-10/<file>` into the
  scratchpad. The task block (`remediation-tasks.md`, "Task details") names the canonical
  finding IDs; the finding's full text, numerical example, suggested diff and regression-test
  diff are in `23-final-report.md` section 7; the session report it absorbs has the probe code.
- Follow `AGENTS.md` and the layer `CLAUDE.md` in full: `withScopedDb` only, rejection before
  write, atomic SQL deltas, `roundMoney`/`roundFxRate`, `FxAggregate`, i18n English-first with
  `npm run i18n:pseudo`, no emojis, no `console.log`, `database/schema.sql` paired with every
  migration, guard baselines never widened. A guard that fires is fixed in the code, never
  allowlisted.
- Every task lands with the red test its finding names (run it against the unfixed code first
  and quote the failure), then the gate for the layer touched
  (`backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`,
  `npm run build && npm run test:integration -- <pattern>` when a query, entity or migration
  changed; `frontend/`: `npm run lint && npm run type-check && npm run i18n:check`,
  `npm run test:changed`, `npm run build`). Quote the results in the commit body.
- One commit per task: `fix(<scope>): <imperative subject>` with the body naming the canonical
  finding IDs (`A26-H01`), the invariant IDs, the test added, and the gate results; trailer
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push after every task:
  `git push -u origin <branch>`.
- Do not open a pull request; the maintainer opens one per stream (or per task) from the pushed
  branch. Do not touch `.github/`, `helm/` or `docker-compose*.yml` outside the `ci-release`
  stream.
- Do not use `send_message` or any claude-code-remote tool. The pushed branch is the only channel.
  At about 70 percent of the context, commit what is green, push, and stop with a note in the
  last commit body: `Stream status: tasks done <list>, next <id>`.

## Wave 1 (disjoint; run in parallel)

| Stream | Branch | Tasks in order | Why together |
|---|---|---|---|
| harness | `fix/audit-harness` | T08 | Prerequisite of T09, T10, T12, T19, T23, T29, T47; touches test helpers plus the hub services for wiring, so it runs alone and merges first. |
| auth | `fix/audit-auth` | T01, T18, T49 | `token.service.ts`, `auth.service.ts`, `users.service.ts` (T18), `delegation.service.ts` (T18). |
| forms | `fix/audit-forms` | T06, T07, T42 | `TransactionForm.tsx` and its test. |

## Wave 2 (after harness merges; disjoint among themselves)

| Stream | Branch | Tasks in order | Hub files |
|---|---|---|---|
| receipts | `fix/audit-receipts` | T02 | `email-receipts/` only (T53 waits for securities). |
| banksync | `fix/audit-banksync` | T05 | `bank-sync/` only. |
| mny | `fix/audit-mny` | T04, T26, T52 | `import/mny/*`, `import.service.ts`, `frontend/src/lib/import-mny.ts`. T27 (currencies) waits: it shares `mny-import.service.ts` and `users.service.ts`. |
| ledger | `fix/audit-ledger` | T03, T23, T09, T19, T11, T24, T25, T29 | `transaction-bulk-update.service.ts`, `transaction-split.service.ts`, `transaction-transfer.service.ts`, `accounts.service.ts`, `delegation.service.ts` (after auth merged). |
| fx | `fix/audit-fx` | T14, T15, T16 | `report-currency.service.ts`, `portfolio.service.ts`, `budget-spending.util.ts`, `reports.service.ts`, `tool-executor.service.ts`, `investment-transactions.service.ts` (the rate readers only). |
| scheduler | `fix/audit-scheduler` | T12, T13, T35, T55 | `scheduled-transactions.service.ts`, `PostTransactionDialog.tsx`, loan posting. |
| ci-release | `fix/audit-ci-release` | T22, T45, T46, T48, T58 | `.github/workflows/ci.yml`, `backend/package.json`, Dockerfiles, compose. Needs the maintainer's explicit go (AGENTS.md "Ask first"). |
| singles | `fix/audit-misc-a` | T21, T28, T34, T41, T51, T56 | No shared files between them; one branch for convenience, one commit each. |

## Wave 3 (after fx merges)

| Stream | Branch | Tasks in order | Hub files |
|---|---|---|---|
| securities | `fix/audit-securities` | T10, T30, T31, T32, T33, T53, T54 | `investment-transactions.service.ts`, `holdings.service.ts`, `portfolio-calculation.service.ts`, `security-price.service.ts`, `bond-price.service.ts`, `action-history.service.ts` (T54 after ledger's T11). |
| completeness | `fix/audit-completeness` | T17, T43, T44 | `accounts.service.ts` (after ledger merged), `net-worth.service.ts`, `NetWorthReport.tsx`, `pdf-export.ts`. |
| budgets-reports | `fix/audit-budgets-reports` | T37, T38, T39, T36 | `budget-*.ts`, `reports.service.ts`, `tool-executor.service.ts` (after fx merged), `loan-history.ts`. |
| frontend-cache | `fix/audit-frontend-cache` | T40, T57 | `frontend/src/lib/*`, `InvestmentTransactionForm.tsx` (after securities merged), `import-mny.ts` (after mny merged). |
| currencies | `fix/audit-currencies` | T27 | after auth and mny merged. |
| database | `fix/audit-database` | T20, T50 | migration, `scripts/verify-schema.sh`, restore backfills. |

## Wave 4

| Stream | Branch | Tasks | Note |
|---|---|---|---|
| mutation-tests | `fix/audit-mutation-tests` | T47 | Last: one red test per remaining row of the program mutation table, across every hub; rebased on everything above. |

## Status

| Stream | Branch | Started | Child session | Tasks done | Merged |
|---|---|---|---|---|---|
| harness | `fix/audit-harness` | 2026-10-22 04:19 UTC | session_01JWWBawaWKEiTgRH4EUCL9M | T08 (head 67041d9; 7 commits, tests and helpers only, no production code; full integration suite 123/123 green) | not yet |
| ledger | `fix/audit-ledger` (based on `fix/audit-harness`) | 2026-10-22 05:37 UTC | session_0162iK2ZgbyzonPiq6wog7RJ | T03, T23, T09, T19, T11, T24, T25, T29 (head 111af88; T24 departs from the task note, T19 cross-owner policy to confirm: see the commit bodies) | not yet |
| receipts | `fix/audit-receipts` | 2026-10-22 05:13 UTC | session_01Vd7kVJvSZgM5rCdWSbwbDd | T02 (head 366e5be; two commits: owner-only forwarded identity, forwarded_by on the inbox card) | not yet |
| mny | `fix/audit-mny` | 2026-10-22 06:10 UTC | session_019FG9PsmcGWWcRSDqUKYSDk | T04, T26, T52 (head 31022f0) | not yet |
| scheduler | `fix/audit-scheduler` (based on `fix/audit-harness`) | 2026-10-22 07:33 UTC | session_01T3KXuByz6au2UiJkLQBeap | T12, T13, T35, T55 (head beb2ced; integration 126/127 suites, the known deadlock flake) | not yet |
| integration | `fix/audit-all` | 2026-10-22 | orchestrator | merge of the nine streams above on `origin/main`; only two conflicts, both one-sentence rule additions in `backend/CLAUDE.md` and `docs/concurrency-and-idempotency.md`, resolved as a union; 434 files, +24 738 / -2 882; base for wave 3 | -- |
| securities | `fix/audit-securities` (based on `fix/audit-all`) | 2026-10-22 | see next update | | |
| completeness | `fix/audit-completeness` (based on `fix/audit-all`) | 2026-10-22 | see next update | | |
| budgets-reports | `fix/audit-budgets-reports` (based on `fix/audit-all`) | 2026-10-22 | see next update | | |
| banksync | `fix/audit-banksync` | 2026-10-22 05:25 UTC | session_01HUQYhLK1iA2SyKqUEunC7S | T05 (head 70005fe; row-keyed dedup, no migration, legacy keys held; residuals recorded in INV-BANKSYNC-001) | not yet |
| fx | `fix/audit-fx` | 2026-10-22 05:49 UTC | session_01E4fLuC2UsV3VXW9mWmgnkP | T14, T15, T16 (head 38de59a, locales translated; coverage above thresholds) | not yet |
| auth | `fix/audit-auth` | 2026-10-22 04:19 UTC | session_01J1DvFkbLT5hNjYcqy139nN | T01, T18, T49 (head 58dca78; 34 files; gate green per commit, run with NODE_OPTIONS=--max-old-space-size=6144; T01 adds a 10 s rotation grace for a second tab, maintainer decision) | not yet |
| forms | `fix/audit-forms` | 2026-10-22 04:19 UTC | session_013UqoZAfBLgw68Gya3qWYTS | T06, T07, T42 (head b714919; gate green; T07 taken as the fallback: Transfer mode hidden on an existing row, in-place conversion left as a proposal) | not yet |
