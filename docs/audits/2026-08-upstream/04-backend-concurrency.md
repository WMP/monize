# Monize Audit Phase 4 — Backend Transactions, Concurrency, Background Jobs, and Data Integrity

## Report metadata

| Field | Value |
|---|---|
| Audit phase | Phase 4 — Backend Transactions, Concurrency, Background Jobs, and Data Integrity |
| Worker chat | Phase 4 worker chat — Backend Transactions, Concurrency, Background Jobs, and Data Integrity |
| Repository | `kenlasko/monize` |
| Audited baseline SHA | `d5cea9bfa995885ba5198f9843359362927c0fd4` |
| Baseline variable | `AUDIT_BASELINE_SHA=d5cea9bfa995885ba5198f9843359362927c0fd4` |
| Access mode | Read-only, SHA-pinned GitHub connector reads |
| Runtime execution | None |
| Tests executed | None |
| Report filename | `monize-audit-04-backend-concurrency.md` |
| Report status | Complete, subject to the limitations recorded below |

## Executive finding summary

This phase confirmed **18 defects** at the fixed baseline:

| Severity | Confirmed findings |
|---|---:|
| BLOCKER | 0 |
| HIGH | 7 |
| MEDIUM | 7 |
| LOW | 4 |
| **Total** | **18** |

The highest-risk themes are:

1. `.mny` import start and retry paths are not idempotent. Concurrent starts can create independent active jobs, and a worker crash after the import transaction commits can cause a retry to insert the same source data again under newly generated UUIDs.
2. transaction update, delete, transfer, reconciliation, and bulk paths derive balance adjustments from pre-transaction snapshots without row locks or optimistic versions. The ledger row may serialize at PostgreSQL, while the stale delta still corrupts `accounts.current_balance`.
3. scheduled-transaction posting commits the financial transaction before advancing or deleting the schedule, with no occurrence key. Two replicas, a manual post racing cron, or a crash between commits can post the same occurrence twice.
4. full balance recomputation and holdings maintenance use snapshot-write or read-modify-write protocols that are incompatible with concurrent incremental writes. They can overwrite valid committed balance or position changes.
5. an emergency-access claim link is described as revalidated “under lock,” but the consuming transaction does not lock or conditionally consume the row. Two requests can both replace the owner’s credentials and proceed to session issuance.
6. local-filesystem and S3 attachment bytes are not transactionally coupled to PostgreSQL metadata and are not covered by compensation or orphan cleanup.
7. several multi-replica cron workflows have concrete duplicate external or persistent effects because coordination exists only in process memory or as a pre-write application query.

No finding was escalated to BLOCKER. No dynamic concurrency test, database startup, migration, filesystem operation, S3 call, SMTP delivery, or external provider call was executed in this environment.

---

## 1. Phase scope

The phase reviewed backend transaction boundaries, nested scoped transactions, stale-read and check-then-act races, row locking, uniqueness and idempotency, persistent job state, background and scheduled work, application-maintained balances and holdings, attachment and backup side effects, migration startup concurrency, refresh-token and account-recovery races, and relevant tests and CI definitions.

The review followed material behavior across layers where evidence was available:

```text
controller / cron / worker
→ DTO or persistent job state
→ service
→ withScopedDb boundary
→ entity/query
→ migration/schema constraint
→ derived balance/holding/status
→ external side effect
→ tests and CI definition
```

The phase did not perform a generic backend style review. Findings require a realistic concurrent or failure interleaving with a concrete user, data, security, or operational effect.

## 2. Audited baseline SHA

All evidentiary repository reads used:

```text
ref=d5cea9bfa995885ba5198f9843359362927c0fd4
```

`main` was not resolved again. Search results were treated only as path discovery because connector search links can point at a newer branch head. Every file cited as evidence was re-fetched from the fixed SHA.

## 3. Method

### 3.1 Static verification approach

The audit used the following method:

1. read the repository instruction hierarchy and relevant architecture, RLS, migration, import, backup, deployment, cron, and testing documentation;
2. inventory transaction and external-side-effect boundaries;
3. identify reads whose values later control writes;
4. test each candidate against PostgreSQL row-lock, statement-snapshot, unique-constraint, foreign-key, and transaction semantics;
5. trace retries, crashes, multi-replica execution, and stale worker behavior;
6. inspect the corresponding schema and migration before accepting a race;
7. inspect relevant unit and integration tests before calling a test missing;
8. separate new Phase 4 defects from prior accepted findings and from design risks that lack a demonstrated production call path.

### 3.2 Static confirmation standard

A defect is marked confirmed only where the failure follows from the code, schema, deployment model, and ordinary PostgreSQL `READ COMMITTED` behavior. Scenarios that require an unverified deployment option, undocumented threat capability, or arbitrary SQL are classified as risks or hypotheses instead.

### 3.3 Runtime status

The following were **not** performed:

- repository clone;
- package installation;
- unit or integration test execution;
- PostgreSQL startup;
- migration execution;
- multi-connection race reproduction;
- backend replica startup;
- Docker or Helm execution;
- attachment filesystem or S3 operation;
- backup-volume operation;
- SMTP or AI/market-data provider call;
- CI artifact or log download.

All proposed regression tests below are unexecuted test designs.

## 4. Repository instruction hierarchy applied

The following hierarchy was applied, with the nearest scoped instruction taking precedence:

1. project audit instructions supplied for Phase 4;
2. repository root `CLAUDE.md`;
3. `backend/CLAUDE.md` for backend code;
4. `database/CLAUDE.md` for schema and migrations;
5. `backend/src/mcp/CLAUDE.md` for MCP-adjacent paths;
6. `frontend/CLAUDE.md` where API-contract implications were sampled;
7. auxiliary, potentially stale guidance in `.claude/settings.json`, `.claude/skills/backend.md`, `.claude/skills/infrastructure.md`, `CONTRIBUTING.md`, and `SECURITY.md`.

Key repository invariants applied in this phase were:

- multi-table operations and read-modify-write sequences should use one `withScopedDb` transaction;
- nested `withScopedDb` calls join the ambient manager;
- account-balance deltas should use atomic SQL arithmetic rather than stale entity saves;
- cron methods run in every backend replica because scheduling is embedded in the API process;
- cross-user jobs must deliberately establish system or per-user context;
- migrations are individually transactional and tracked by filename.

A search for `AGENTS.md` returned no path, but the connector does not provide a recursive immutable tree and search can be capped. The audit therefore records **“not located”**, not proof of repository-wide absence.

## 5. Architecture and concurrency baseline

### 5.1 Transaction model

`withScopedDb` stores an active `EntityManager` in `AsyncLocalStorage`. A nested call joins the active manager rather than creating a savepoint or independent commit. A top-level call creates a query runner, starts a transaction, sets RLS-related GUCs, executes the callback, commits, and releases the runner. `runOutsideActiveScopedManager` deliberately escapes that ambient manager for progress and heartbeat writes.

The common transaction isolation level was not explicitly overridden in the reviewed workflows; the analysis therefore uses PostgreSQL’s ordinary `READ COMMITTED` statement-snapshot semantics. The migration runner uses explicit `BEGIN`/`COMMIT` per migration.

### 5.2 Derived financial state

The database stores both source ledger rows and application-maintained derived state:

- `accounts.current_balance`;
- `holdings.quantity` and `holdings.average_cost`;
- scheduled-job and import-job statuses;
- generated AI insights and budget-alert rows;
- backup artifact status and retention state;
- post-commit action-history and net-worth recalculation triggers.

The reviewed code uses two incompatible balance-update protocols:

1. atomic increment: `current_balance = current_balance + delta`;
2. full snapshot recomputation followed by an absolute write.

The first protocol is safe against another atomic increment. It is not safe against an unlocked recomputation that read an earlier ledger snapshot and writes an absolute value afterward.

### 5.3 Multi-replica deployment model

`docs/cron-jobs.md` states that there is no separate scheduler process and every backend replica fires every cron. Helm exposes `backend.replicas`, and every backend container uses the same image entrypoint. The entrypoint runs `db-init`, `db-migrate`, and then the API process. Consequently, all cron and startup-concurrency findings were evaluated under a supported multi-replica deployment, not an invented topology.

---

## 6. Confirmed findings

### P4-001 — Concurrent `.mny` starts can create independent active jobs and duplicate or destructively interleave imports

- **Classification:** confirmed defect; independent confirmation of canonical P1-001
- **Severity:** HIGH
- **Confidence:** high
- **Primary paths:**
  - `backend/src/import/mny/mny-import.controller.ts:162-188`
  - `backend/src/import/mny/mny-import.service.ts:102-166`
  - `backend/src/import/mny/mny-import-job.service.ts:76-142`
  - `backend/src/import/mny/entities/import-job.entity.ts:17-78`
  - `backend/src/import/mny/model/mny-import-job.ts:11-22`
  - `database/migrations/117_mny_import_staging_and_jobs.sql:1-102`
  - `backend/src/import/mny/map/map-transactions.ts:430-530`

#### Violated invariant

The service and API contract state that a user may have only one pending or running `.mny` import. The active-job decision and job insertion must therefore be one database-enforced operation. A UI double-click guard is insufficient.

#### Evidence and interleaving

`start()` first calls `hasActiveJob(userId)` in one scoped transaction, optionally performs a destructive user-data wipe, and later calls `jobs.create(...)` in another scoped transaction. `create()` unconditionally inserts a `pending` row. The migration defines `status` as an unconstrained `VARCHAR` and has no partial unique index for active jobs.

Two requests can execute:

```text
A: find staged file
B: find staged file
A: count pending/running = 0
B: count pending/running = 0
A: insert pending job A
B: insert pending job B
A: claim job A
B: claim job B
```

The conditional claim protects one job row from two workers. It does not prevent two independently created rows from each being claimed.

The intended uniqueness key at this baseline is **`user_id` for statuses `pending` and `running`**:

- `hasActiveJob` filters by `userId` without staged file or source-format qualification;
- the conflict message says an import is already running for the user;
- different users are intentionally independent;
- the current product behavior blocks both the same staged file and a different staged file for one user.

If product policy changes to permit concurrent formats, `(user_id, source_format)` would be the next plausible key. `(user_id, staged_file_id)` would not preserve the currently documented one-import-per-user rule.

#### Reproduction scenario

1. User A previews one staged file.
2. Send two simultaneous `POST /import/mny/start` requests with the same `stagedFileId`.
3. Both requests pass `hasActiveJob` before either inserts.
4. Each request creates and claims a different job.
5. If both workers load the bytes before either removes the staged row, both import the same source file.

A second scenario uses two staged files created by concurrent upload/start interleavings. Both jobs still pass because the guard is per user but not atomic.

With `wipeExistingData=true`, both requests may wipe before either job exists. One wipe can also occur while the other import has begun, deleting rows written by the other worker and producing a destructive mixed result rather than a simple duplicate.

#### Concrete financial example

- Input file: one checking-account expense of `-100.00`.
- Expected result: one ledger row; balance impact `-100.00`.
- Concurrent implementation result when both jobs import: two rows with independently generated UUIDs; balance impact `-200.00`.
- Difference: `-100.00`.

#### Impact

Duplicate transactions, duplicate accounts/reference data where uniqueness does not absorb the race, inconsistent verification, destructive wipe/import interleavings, and user-visible financial corruption. Multi-replica workers do not mitigate the issue because each job row can be claimed once and both claims are legitimate.

#### Recommended correction

1. Add a database `CHECK` constraint restricting status to `pending`, `running`, `completed`, or `failed`.
2. Add a partial unique index matching the explicitly documented product key, at this baseline:

   ```sql
   CREATE UNIQUE INDEX ... ON import_jobs(user_id)
   WHERE status IN ('pending', 'running');
   ```

3. Insert the pending job directly and map SQLSTATE `23505` to the existing 409 response. Do not pre-authorize creation solely with `hasActiveJob`.
4. If wipe mode remains available, claim the per-user import slot before deleting data and hold an explicit maintenance/import lease through the destructive and import phases.
5. Preserve RLS by inserting with the user-scoped manager; database uniqueness still arbitrates across concurrent transactions.

A status `CHECK` is required with the partial index so an invalid application status cannot bypass the active-state predicate.

#### Recommended regression test

Use two real PostgreSQL connections and a barrier around job insertion:

- same user, same staged file: exactly one 201 and one 409; one active job;
- same user, two staged files: result matches the chosen documented key;
- two users: both starts succeed;
- same cases with `wipeExistingData=true`: exactly one wipe and one job;
- two backend worker instances: only the winning job is claimable;
- run under the unprivileged runtime role with RLS enforcement.

#### Verification method

Static controller-to-service-to-job-to-schema trace at the fixed SHA, plus inspection of the existing real-PostgreSQL claim integration test. The existing test races two claims of one row; it does not race two complete start/check/create requests.

---

### P4-002 — A `.mny` worker crash after the import commit can make a retry import the committed data again

- **Classification:** confirmed defect
- **Severity:** HIGH
- **Confidence:** high
- **Primary paths:**
  - `backend/src/import/mny/mny-import.service.ts:196-330`
  - `backend/src/import/mny/mny-import.service.ts:370-570`
  - `backend/src/import/mny/mny-import-job.service.ts:145-350`
  - `backend/src/import/mny/mny-staging.service.ts:103-178`
  - `backend/src/import/mny/map/map-transactions.ts:430-530`
  - `backend/src/import/mny/writers/write-transactions.ts:1-460`

#### Violated invariant

A job advertised as retryable must either be known not to have committed business data or must use a deterministic idempotency key that makes replay safe. Job completion state and data-commit state must not be ambiguous.

#### Evidence and failure window

`writeAll()` commits the imported user data in one scoped transaction. After that commit, `runImport()` performs post-processing, verification, holding verification, staged-byte removal, timing/log construction, and result assembly. Only after the body returns does `runClaimed()` mark the job `completed` in another transaction.

A process crash, pod eviction, exception in verification, or terminal-status write failure after `writeAll()` commits leaves the job `running` or marks it `failed` with `retryable=true`. The staged file remains available for failures before the explicit removal. Retrying creates a new job over the same bytes.

The mapper assigns fresh UUIDs to mapped transactions on every parse. There is no stable source-record identity or import-run key on the inserted transaction rows. A replay therefore does not conflict with the first committed import.

Terminal state updates are also not compare-and-set operations:

- `complete()` updates by `id` without requiring `status='running'` or a lease owner;
- `fail()` updates by `id` without a current-state predicate;
- a stale worker can overwrite a reaper transition, or vice versa.

#### Reproduction scenario

1. Start a normal `.mny` import.
2. Let `writeAll()` commit all account and transaction rows.
3. Kill the worker before `complete()` commits, while the staged bytes still exist.
4. The reaper marks the job failed and retryable.
5. Retry the same staged file.
6. The second run generates fresh UUIDs and inserts the source transactions again.

A crash after staged-byte deletion but before completion creates the inverse failure: the job can remain failed/retryable while the bytes required for retry no longer exist.

#### Concrete financial example

- Source file contains one transaction of `-25.00`.
- First `writeAll()` commit produces balance impact `-25.00`.
- Worker crashes before job completion.
- Retry inserts the same source transaction under a new UUID.
- Produced balance impact: `-50.00`.
- Expected balance impact: `-25.00`.
- Difference: `-25.00`.

#### Impact

Core financial duplication after ordinary operational failures, misleading retry UI, ambiguous terminal job state, and inability to distinguish “safe to retry” from “business data committed but completion metadata missing.” Wipe mode can amplify the effect into destructive partial replacement.

#### Recommended correction

Use one of these durable models:

1. **Commit checkpoint model:** write an immutable import-run row and a `data_committed` checkpoint in the same transaction as the imported rows. After a crash, recovery finalizes that run rather than replaying it.
2. **Deterministic idempotency model:** assign each source record a stable `(import_run/source_file hash, source record key)` and enforce uniqueness on imported rows.
3. **Lease/state-machine hardening:** add lease owner/generation and compare-and-set predicates to progress, heartbeat, complete, fail, and reaper transitions.
4. Distinguish pre-commit failure, commit-unknown, data-committed/finalization-pending, completed, and non-retryable states. Do not label commit-unknown as an ordinary retry without reconciliation.
5. Delete staged bytes only after durable completion or after a recoverable finalization checkpoint.

#### Recommended regression test

Add failpoints immediately:

- before import transaction commit;
- after import commit but before post-processing;
- after verification;
- after staged-byte deletion;
- before and after job completion update.

Restart a simulated worker after each failpoint and assert that the final ledger contains exactly one copy, terminal state is monotonic, and retry availability matches actual byte/data state.

#### Verification method

Static transaction-boundary and state-machine trace at the fixed SHA. No process kill or database restart was executed.

---

### P4-003 — Transaction, transfer, reconciliation, and bulk mutations use stale pre-transaction snapshots to adjust balances

- **Classification:** confirmed defect
- **Severity:** HIGH
- **Confidence:** high
- **Primary paths:**
  - `backend/src/transactions/transactions.service.ts:1900-2178`
  - `backend/src/transactions/transactions.service.ts:2190-2285`
  - `backend/src/transactions/transaction-transfer.service.ts:360-920`
  - `backend/src/transactions/transaction-reconciliation.service.ts:24-86`
  - `backend/src/transactions/transaction-bulk-update.service.ts:120-340`
  - `backend/src/accounts/accounts.service.ts:947-1018`

#### Violated invariant

A balance delta for update, delete, status change, or transfer mutation must be derived from the exact ledger version that the write successfully replaces or deletes. Loading the old row before the write transaction and later applying a delta from that snapshot is not safe under concurrent requests.

#### Evidence and interleaving

`TransactionsService.update()` calls `findOne()` before opening the write transaction and stores `oldAmount`, `oldAccountId`, date, and status. It then updates the row by ID without a row lock or version predicate and calculates the balance delta from the stale values. PostgreSQL serializes the row updates, but the second request does not refresh its original snapshot after waiting.

`remove()` similarly loads the entity before the transaction and reverses its amount before deleting. Two removals can both reverse the same amount even if only one delete actually removes the row.

The transfer service loads both legs before its transaction. The reconciliation service receives a preloaded `Transaction` and applies `VOID` transitions from that object. Bulk paths collect rows before their later write transaction. These are the same root cause and are counted once.

#### Reproduction scenario

Initial state:

- account opening balance: `100.00`;
- one transaction: `-10.00`;
- stored current balance: `90.00`.

Two requests race:

```text
A reads old amount -10.00
B reads old amount -10.00
A updates row to -20.00 and applies delta -10.00
B waits on the row, then updates it to -30.00 and applies stale delta -20.00
```

#### Concrete financial example

- Produced final ledger: one transaction of `-30.00`.
- Produced stored balance: `60.00`.
- Expected stored balance from opening balance plus final ledger: `70.00`.
- Difference: `-10.00`.

Double-delete variant:

- opening balance `100.00`, transaction `-10.00`, current balance `90.00`;
- both requests reverse `+10.00`;
- produced balance can become `110.00` after the row is gone;
- expected balance is `100.00`;
- difference: `+10.00`.

Transfer updates can corrupt both source and destination balances from stale leg values. `VOID`/unvoid races can apply the same amount twice or omit one reversal.

#### Impact

Persistent divergence between the authoritative ledger and `accounts.current_balance`, affecting registers, net worth, budgets, reports, transfers, and later reconciliation. The issue is realistic for double-clicks, retries, two tabs, API clients, and scheduler/manual overlap.

#### Recommended correction

1. Open the transaction before reading the row to mutate.
2. Lock the transaction row with `FOR UPDATE`, and lock linked transfer legs in a deterministic ID order.
3. Re-read old amount, account, date, status, splits, and linked IDs under those locks.
4. Apply the ledger write and corresponding account deltas in the same transaction.
5. Alternatively add a version column and require `UPDATE ... WHERE id=? AND version=? RETURNING ...`; retry or return 409 on a lost race.
6. For deletes, reverse a balance only when a conditional `DELETE ... RETURNING` actually removes the expected version.
7. Make status transitions compare-and-set operations from the expected old status.

#### Recommended regression test

Use two independent PostgreSQL connections and barriers for:

- two amount updates to one transaction;
- update versus delete;
- two deletes;
- `VOID` versus unvoid;
- transfer amount/account update versus delete;
- bulk delete versus single update;
- split replacement versus parent update.

After every interleaving, assert both final ledger rows and a fresh SQL recomputation of each affected account balance.

#### Verification method

Static read/write-boundary trace across service, nested balance call, and schema. Existing tests use mocked managers and do not exercise two database connections.

---

### P4-004 — Scheduled posting has no occurrence idempotency key and commits the financial effect before schedule advancement

- **Classification:** confirmed defect
- **Severity:** HIGH
- **Confidence:** high
- **Primary paths:**
  - `backend/src/scheduled-transactions/scheduled-transactions.service.ts:134-280`
  - `backend/src/scheduled-transactions/scheduled-transactions.service.ts:1110-1395`
  - `backend/src/scheduled-transactions/entities/scheduled-transaction.entity.ts:1-420`
  - `database/schema.sql:390-500`
  - `docs/cron-jobs.md:1-24`

#### Violated invariant

One logical scheduled occurrence must create at most one cash transaction, transfer pair, or investment transaction, regardless of replica count, manual posting, retries, or process failure.

#### Evidence and interleaving

Every replica’s cron reads due schedules in a system-context transaction and commits that read before calling `post()` per user. `post()` loads the schedule and occurrence data without a claim or row lock. It then calls the ordinary transaction, transfer, or investment creation service; that service commits the financial effect in its own transaction. Only afterward does `post()` open a second transaction to remove an `ONCE` schedule or advance a recurring schedule.

There is no occurrence ledger or unique key such as `(scheduled_transaction_id, original_due_date)`. `lastPostedDate` is not used as an atomic compare-and-set guard.

#### Reproduction scenario

- Replica A and replica B select the same due row.
- Both call `post()` using the same `nextDueDate`.
- Both create and commit a financial transaction.
- Both then advance the schedule to the same next date.

The same result occurs when manual posting races the cron. A process crash after the financial commit but before schedule bookkeeping causes the next cron run to post the same occurrence again.

#### Concrete financial example

- Initial account balance: `100.00`.
- Due scheduled expense: `-50.00`.
- Expected one posting: final balance `50.00`.
- Two postings: final balance `0.00`.
- Difference: `-50.00`.

For a transfer, both source and destination legs are duplicated. For an investment schedule, cash, investment row, and holding effects can all be duplicated.

#### Impact

Duplicate bills, deposits, transfers, and investment trades in ordinary supported multi-replica deployments, plus retry duplication after a crash. This is core financial corruption.

#### Recommended correction

1. Materialize a scheduled occurrence with a stable key, for example `(scheduled_transaction_id, original_due_date)`.
2. Atomically insert/claim that occurrence. Only the winner may create financial effects.
3. Use one outer scoped transaction for occurrence claim, financial row(s), balance/holding effects, override consumption, and schedule advancement when all effects are in PostgreSQL.
4. If a separate durable workflow is required, use a strict state machine (`claimed`, `posted`, `advanced`) and resume finalization rather than recreate the financial effect.
5. Route manual and cron posting through the same occurrence key.

#### Recommended regression test

With two application instances or two database connections:

- race two cron workers for one occurrence;
- race manual post with cron;
- crash after financial commit before advancement;
- race post with edit/delete/skip;
- repeat for cash, transfer, investment, split, and `ONCE` schedules.

Assert one occurrence row, one financial effect, one advancement, and balances/holdings matching recomputation.

#### Verification method

Static cron-to-post-to-financial-service-to-schema trace at the fixed SHA. No scheduler was executed.

---

### P4-005 — Full balance recomputation can overwrite a concurrent committed atomic increment

- **Classification:** confirmed defect
- **Severity:** HIGH
- **Confidence:** high
- **Primary paths:**
  - `backend/src/accounts/accounts.service.ts:947-1060`
  - `backend/src/accounts/accounts.service.ts:1580-1705`
  - `backend/src/import/import-post-processing.service.ts:35-105`
  - `backend/src/transactions/transactions.service.ts:315-490`

#### Violated invariant

`accounts.current_balance` must equal opening balance plus all included non-void parent transactions. Every balance writer must participate in one serialization protocol. An absolute snapshot write cannot race an atomic delta without a lock or compare-and-set.

#### Evidence and interleaving

`updateBalance()` correctly uses SQL arithmetic for ordinary current-dated transactions. `recalculateCurrentBalance()` instead:

1. reads the `Account` entity;
2. computes a ledger sum;
3. assigns an absolute value to the detached entity;
4. saves it without locking the account.

The import post-processor and hourly due-balance cron similarly compute balances and then issue absolute updates. Under `READ COMMITTED`, the `SELECT` and later `UPDATE` are separate statement snapshots even when wrapped in one transaction.

#### Reproduction scenario and numerical example

- Initial authoritative balance and stored balance: `100.00`.
- Recompute transaction reads ledger sum `100.00`.
- Concurrent Request B inserts a current-dated transaction of `-20.00` and atomically updates the account to `80.00`, then commits.
- Recompute writes its earlier absolute result `100.00`.

Result:

- produced stored balance: `100.00`;
- expected stored balance: `80.00`;
- difference: `+20.00`.

The reverse ordering can also omit a delete or status change. A multi-replica hourly recomputation is idempotent only against an unchanged ledger, not against interactive writes between its read and write statements.

#### Impact

Broad, silent divergence of account balances after future-dated transaction maintenance, import post-processing, manual recomputation, or hourly due processing. The ledger remains present, but every consumer that trusts `current_balance` can show incorrect financial state until another correct rebuild happens—and another unlocked rebuild can race again.

#### Recommended correction

Adopt one per-account serialization mechanism for **all** balance mutations:

- lock the account row before reading the ledger and hold the lock through the absolute write; and
- require atomic-delta writers to acquire the same lock before their ledger mutation and balance update;

or use a per-account advisory lock shared by all writers. A single SQL `UPDATE ... SET current_balance = (SELECT ...)` is not sufficient by itself if concurrent ledger inserts are not serialized against it.

Avoid saving a detached `Account` entity for this operation. Use a targeted SQL update and verify the affected row. For batch recomputation, lock accounts in deterministic ID order.

#### Recommended regression test

Use two connections and barriers around the recompute `SELECT` and account `UPDATE`:

- recompute versus create;
- recompute versus update;
- recompute versus delete/VOID;
- import post-processing versus interactive write;
- hourly due-balance job versus interactive write;
- two-account transfer versus batch recomputation.

Compare stored balances with a fresh authoritative SQL sum after each interleaving.

#### Verification method

Static SQL and transaction-isolation analysis at the fixed SHA. No database race was executed.

---

### P4-006 — Holdings updates and rebuilds can lose concurrent investment transactions

- **Classification:** confirmed defect
- **Severity:** HIGH
- **Confidence:** high
- **Primary paths:**
  - `backend/src/securities/holdings.service.ts:200-420`
  - `backend/src/securities/holdings.service.ts:600-900`
  - `backend/src/securities/investment-transactions.service.ts:900-1700`
  - `backend/src/securities/entities/holding.entity.ts:1-120`

#### Violated invariant

For each `(account_id, security_id)`, holdings quantity and average cost must equal the ordered investment ledger. Concurrent buys, sells, splits, transfers, rebuilds, and reversals must not overwrite one another.

#### Evidence and interleaving

`createOrUpdate()`, `adjustQuantity()`, and split operations read a holding entity, calculate a new quantity/cost in application code, and save it without a row lock or version predicate. The unique key on `(account_id, security_id)` prevents two absent-row inserts from both succeeding, but it does not protect updates to an existing holding.

A row lock obtained by PostgreSQL during the first `UPDATE` only serializes physical writes. The second request still writes the quantity it calculated from the stale value read before waiting.

`rebuildFromTransactions()` is additionally split into separate scoped reads of accounts and investment transactions, computation outside the write transaction, and a later delete/recreate transaction. `rebuildAccountsFromTransactions()` operates in the caller transaction but does not lock the relevant account/holding range against another investment transaction.

#### Reproduction scenario and numerical example

Initial holding:

- quantity: `10` shares;
- average cost: `$100.00`;
- cost basis: `$1,000.00`.

Concurrent buys:

- Request A buys `1` share at `$100.00`;
- Request B buys `2` shares at `$100.00`;
- both read quantity `10` and average cost `$100.00`;
- A writes `11`;
- B later writes stale-derived `12`.

Result:

- produced holding: `12` shares, cost basis `$1,200.00`;
- expected holding: `13` shares, cost basis `$1,300.00`;
- quantity difference: `-1` share;
- monetary difference: `-$100.00`;
- percentage understatement: `7.69%` of expected quantity/cost basis.

Both investment transaction rows and both cash effects can commit successfully while the derived holding loses one purchase.

#### Impact

Incorrect portfolio quantities, cost basis, performance, net worth, sell validation, and tax-related outputs. A rebuild racing an interactive trade can also delete or replace a freshly updated holding with a snapshot that omitted the trade.

#### Recommended correction

1. Lock the holding row for `(account_id, security_id)` before reading it.
2. For an absent row, use a conflict-safe insert/upsert that retries under the same serialization protocol.
3. Lock affected investment accounts and holding keys in deterministic order for transfers and multi-security operations.
4. Make incremental updates and rebuilds share the same lock namespace.
5. Run a rebuild’s ledger read, calculation inputs, delete, and recreate in one repeatable-read/serializable transaction or under explicit account locks.
6. Consider deriving holdings on demand or maintaining a version/checkpoint that can detect stale derived state.

#### Recommended regression test

Use two PostgreSQL connections for:

- two buys of one existing holding;
- buy versus sell;
- buy versus split;
- transfer-in versus transfer-out;
- update/delete of a historical trade versus a current trade;
- full rebuild versus interactive trade;
- matured-holdings cron versus interactive trade.

Assert final holdings against a deterministic replay of the investment ledger and assert cash balances separately.

#### Verification method

Static service/entity/schema analysis at the fixed SHA. Existing holdings tests use mocks and do not reproduce database row-lock interleavings.

---

### P4-007 — One emergency-access claim token can be consumed successfully by two concurrent requests

- **Classification:** confirmed defect
- **Severity:** HIGH
- **Confidence:** high
- **Primary paths:**
  - `backend/src/emergency-access/emergency-access-claim.controller.ts:175-350`
  - `backend/src/auth/token.service.ts:110-245`
  - `backend/src/emergency-access/emergency-access-claim.controller.spec.ts:1-880`

#### Violated invariant

An emergency-access magic link is a single-use credential. Exactly one request may consume it, replace account credentials, revoke prior sessions, and obtain a new session.

#### Evidence and interleaving

The controller performs an initial token check, then hashes the new password, then opens a transaction and re-fetches the contact by token hash. A comment says the transaction “re-validates under lock,” but the query has no `pessimistic_write` lock. Consumption is an ordinary entity save, not a conditional `UPDATE ... WHERE claim_token_used_at IS NULL ... RETURNING`.

Two transactions can both read the unused token before either commits. PostgreSQL serializes later writes, but the second transaction does not re-evaluate the single-use predicate after waiting. It can overwrite the owner password, save the already-consumed contact again, and commit.

Session revocation and new token-pair issuance occur after the credential transaction. Depending on ordering, both requests can receive sessions, or one request can revoke the other’s newly issued refresh token while still returning its own successful response. Either outcome violates single-use semantics.

#### Reproduction scenario

1. Contact receives one valid claim URL.
2. Send two `POST /emergency-access/claim/complete` requests simultaneously with the same token and different new passwords.
3. Both transactional reads see `claimTokenUsedAt IS NULL`.
4. Both replace the owner credentials and mark the token used.
5. Both proceed to revoke sessions and generate a token pair.

#### Impact

Account-takeover race, nondeterministic final password, multiple successful claim responses, and potentially multiple active post-claim sessions. An attacker who obtains the link can race the intended contact rather than merely use it first.

#### Recommended correction

Inside one transaction, atomically acquire/consume the token before any credential mutation:

```sql
UPDATE emergency_access_contacts
SET claim_token_used_at = CURRENT_TIMESTAMP,
    claim_token_hash = NULL,
    ...
WHERE claim_token_hash = $1
  AND claim_token_used_at IS NULL
  AND claim_token_expires_at >= CURRENT_TIMESTAMP
RETURNING id, owner_user_id;
```

Only the transaction receiving one returned row may update credentials. A `SELECT ... FOR UPDATE` followed by revalidation is also acceptable, but the conditional consume is easier to verify.

Coordinate session-family revocation and post-claim session issuance through a durable claim result. Do not return a successful response if another winner has already consumed the claim.

#### Recommended regression test

Use two independent connections and a barrier after token lookup. Submit two different passwords with the same token. Assert:

- exactly one 200 response;
- exactly one credential version wins by design;
- exactly one new refresh-token family remains active;
- the loser receives the stable invalid/used-link response;
- sibling contact tokens are voided once.

#### Verification method

Static controller/query/transaction trace and inspection of mocked claim tests. No real two-connection claim test was located or executed.

### P4-008 — Account closure can race a mutation of an existing transaction and commit a closed account with a non-zero balance

- **Classification:** confirmed defect
- **Severity:** MEDIUM
- **Confidence:** high
- **Primary paths:**
  - `backend/src/accounts/accounts.service.ts:812-910`
  - `backend/src/accounts/accounts.service.ts:947-1018`
  - `backend/src/transactions/transaction-reconciliation.service.ts:24-86`
  - `backend/src/transactions/transactions.service.ts:1900-2178`

#### Violated invariant

A closed account must have zero balance and must reject balance-affecting mutations. The open-state check and balance update must be atomic with respect to `close()`.

#### Evidence and interleaving

`close()` correctly locks the account row and checks `currentBalance === 0`. `updateBalance()`, however, first reads the account without a lock, rejects it if already closed, and later executes:

```sql
UPDATE accounts
SET current_balance = current_balance + $1
WHERE id = $2
```

The SQL has no `is_closed = false` predicate. A mutation of an **existing** transaction does not need to insert a new account foreign key and therefore need not hold a parent-row key-share lock. It can read the account as open, then allow `close()` to acquire the row lock and commit, then wait and update the now-closed row.

The audit rejected the broader claim that every new transaction create can necessarily produce this race: inserting a new child row can acquire a foreign-key row lock on the account. The confirmed path uses an existing transaction status/amount mutation, where that indirect serialization does not protect the account.

#### Reproduction scenario and numerical example

Initial state:

- account is open;
- `current_balance = 0.00`;
- existing transaction amount `-10.00` is `VOID` and therefore excluded.

Interleaving:

```text
A: begin unvoid; update transaction status
A: updateBalance reads account as open
B: close() locks account, sees 0.00, sets is_closed=true, commits
A: balance UPDATE waits, then adds -10.00 without checking is_closed
A: commits
```

Result:

- produced state: closed account, balance `-10.00`;
- valid outcomes: either close is rejected after seeing `-10.00`, or the unvoid is rejected/rolled back;
- expected closed-account balance: `0.00`;
- difference: `-10.00`.

#### Impact

A closed account can contain active ledger effects and a non-zero stored balance, breaking account-state assumptions and later reopen/report behavior. The scope is narrower than the general stale-delta corruption in P4-003 but has a distinct account-state invariant and correction.

#### Recommended correction

- Lock the account row within the same transaction before any existing-ledger mutation changes its balance.
- Change the balance statement to a conditional update with `WHERE id=$2 AND is_closed=false RETURNING ...` and roll back the ledger mutation when no row is returned.
- Use the same deterministic account-lock order for transfers and split transfers.
- Treat close/reopen and every balance mutation as participants in one per-account lock protocol.

#### Recommended regression test

Race `close()` against:

- `VOID → UNRECONCILED`;
- amount update;
- existing transfer update;
- transaction delete/reversal;
- split-side-effect reversal.

Assert that the final state is never `is_closed=true` with a non-zero authoritative or stored balance.

#### Verification method

Static lock-order and SQL-predicate analysis, including rejection of the overbroad new-insert scenario after checking the account foreign key in `database/schema.sql:260-300`.

---

### P4-009 — Concurrent incremental split additions can exceed the parent transaction amount

- **Classification:** confirmed defect
- **Severity:** MEDIUM
- **Confidence:** high
- **Primary paths:**
  - `backend/src/transactions/transaction-split.service.ts:480-620`
  - `database/schema.sql:300-325`
  - `backend/src/transactions/transaction-split.service.spec.ts:1-920`

#### Violated invariant

The signed sum of a transaction’s splits must not exceed the parent amount. Validation and insertion must observe one serialized split set.

#### Evidence and interleaving

`addSplit()` reads all existing splits in one scoped transaction, computes `existingTotal`, validates the new total in application code, and later opens another transaction to insert the new split and any transfer counterpart. It does not lock the parent transaction or existing split set. The schema has no aggregate constraint that enforces the split sum.

Two inserts reference the same parent but can both hold compatible foreign-key key-share locks and commit distinct split rows.

#### Reproduction scenario and numerical example

- Parent transaction amount: `-100.00`.
- Existing split total: `-60.00`.
- Request A adds `-30.00` and validates `-90.00`.
- Request B concurrently adds `-30.00` and also validates `-90.00`.
- Both insert.

Result:

- produced split total: `-120.00`;
- permitted/expected maximum magnitude: `-100.00`;
- difference: `-20.00` beyond the parent.

If either split is a transfer or embedded investment split, its counterpart or holding side effects also commit, making later repair more complex.

#### Impact

Invalid split accounting, overstated category totals, extra transfer or investment side effects, and inconsistent parent-versus-child reporting.

#### Recommended correction

- Start the transaction before reading the split set.
- Lock the parent transaction row with `FOR UPDATE`.
- Re-read and validate the complete split sum under the lock, then insert.
- Make full split replacement and incremental add/remove share the same parent lock.
- Prefer replacing the complete split set through one versioned operation; return 409 on stale parent version.

#### Recommended regression test

With two connections at a parent amount of `-100.00` and existing total `-60.00`, race two `-30.00` additions. Exactly one may commit. Repeat with category, transfer, and investment split kinds, and race add against full replacement.

#### Verification method

Static service/schema trace. Existing split tests validate single-call arithmetic and rollback behavior with mocks, not concurrent aggregate enforcement.

---

### P4-010 — Local and S3 attachment bytes are not transactionally coupled to metadata and have no compensation lifecycle

- **Classification:** confirmed defect; concrete extension of Phase 3 DR-006, distinct from P3-002 restore remapping
- **Severity:** MEDIUM
- **Confidence:** high
- **Primary paths:**
  - `backend/src/attachments/attachments.service.ts:45-190`
  - `backend/src/attachments/storage/database-storage.provider.ts:1-180`
  - `backend/src/attachments/storage/local-storage.provider.ts:1-180`
  - `backend/src/attachments/storage/s3-storage.provider.ts:1-220`
  - `database/migrations/109_transaction_attachments.sql:1-55`
  - `backend/src/transactions/transactions.service.ts:2190-2285`

#### Violated invariant

Committed attachment metadata must refer to available bytes, and bytes that are no longer referenced must eventually be removed. PostgreSQL rollback must not leave an irreversible external operation unaccounted for.

#### Evidence and failure cases

`AttachmentsService.create()` inserts metadata and then calls `storage.save()` inside the database callback. This is truly atomic only for the database provider because its blob write joins the ambient manager. The local provider executes `writeFile`; the S3 provider performs an object-store put. Those external operations cannot roll back with PostgreSQL.

`remove()` deletes metadata and then performs the external delete before database commit. Transaction deletion relies on `ON DELETE CASCADE`, which invokes no storage provider at all; the cascade only removes PostgreSQL metadata and database-provider blobs.

Concrete failure cases:

1. local/S3 save succeeds, then PostgreSQL commit fails: external orphan remains;
2. external delete succeeds, then PostgreSQL commit fails: metadata remains but bytes are gone;
3. parent transaction deletion commits: local/S3 object remains orphaned because only metadata cascades;
4. download reads metadata, then a concurrent delete removes the object before `load()`;
5. retry after commit uncertainty can repeat an external operation without a durable lifecycle state.

The service comment that metadata and bytes “commit together” is correct for the database provider only.

#### Impact

Lost receipts/documents, metadata that produces broken downloads, unbounded local/S3 orphan accumulation, and no deterministic recovery after commit failure. The impact is limited to external providers; the built-in database provider remains transactionally coupled.

#### Recommended correction

Use a durable attachment lifecycle:

- create metadata in `pending_upload` with a generated immutable object key;
- upload to a temporary or final idempotent key;
- verify checksum/size;
- atomically mark metadata `available`;
- for deletion, mark/tombstone in PostgreSQL and dispatch an idempotent outbox delete;
- remove metadata only after durable delete completion, or retain a tombstone for retries;
- create cleanup work for parent-transaction cascades;
- add an orphan reconciler that compares metadata and provider keys;
- keep database-provider writes in the current shared transaction.

#### Recommended regression test

Inject failures at:

- after local/S3 put but before DB commit;
- after metadata delete and external delete but before DB commit;
- parent transaction cascade;
- repeated create/delete retries;
- concurrent download/delete;
- checksum mismatch.

Assert recoverable state, no silent metadata-to-missing-object commit, and eventual orphan cleanup.

#### Verification method

Static provider and transaction-order inspection at the fixed SHA. No filesystem or S3 operation was executed.

---

### P4-011 — Logout can miss a refresh token created by a concurrent rotation in the same family

- **Classification:** confirmed defect
- **Severity:** MEDIUM
- **Confidence:** high
- **Primary paths:**
  - `backend/src/auth/token.service.ts:110-248`
  - `backend/src/auth/token.service.spec.ts:1-920`

#### Violated invariant

After logout/revocation returns, no refresh token in the presented token’s family should remain usable.

#### Evidence and interleaving

`refreshTokens()` correctly locks the presented refresh-token row, revokes it, and inserts the replacement in one transaction. `revokeRefreshToken()`, however, first finds the presented token in one scoped transaction and then calls `revokeTokenFamily()` in another. The family update is not coordinated with rotation.

Under `READ COMMITTED`, an `UPDATE` statement uses one statement snapshot. If it starts while rotation holds the old row lock, it can wait for that row, update the now-revoked old row after rotation commits, but still not see the replacement row inserted after the update statement’s snapshot was taken.

#### Reproduction scenario

```text
Logout A: read old token and family F; commit lookup transaction
Refresh B: lock old token, revoke it, insert new token N in family F
Logout A: start UPDATE family F; see old row and wait on B
Refresh B: commit, returning N
Logout A: update old row, but N is outside A's statement snapshot; commit
```

The logout response succeeds while N remains active.

#### Impact

A session can remain refreshable after the user explicitly logs out. This matters for a stolen refresh token racing the legitimate user’s logout.

#### Recommended correction

- Keep token lookup and family revocation in one transaction.
- Lock a durable family/session row, or lock the presented row before deriving the family and updating all members.
- Prefer one session-family record with a generation/revoked marker checked by every refresh.
- Re-check that no active family member remains before commit, under the same lock protocol.

#### Recommended regression test

Use two database connections with a barrier while refresh holds the old-token lock. Start logout’s family update before refresh commits. After both finish, assert that every token in the family is revoked and the replacement cannot rotate again.

#### Verification method

Static PostgreSQL statement-snapshot analysis and token-service trace. Existing tests confirm the refresh-row lock with mocks but do not race logout against refresh on PostgreSQL.

---

### P4-012 — Parallel failed logins lose counter increments and delay account lockout

- **Classification:** confirmed defect
- **Severity:** MEDIUM
- **Confidence:** high
- **Primary paths:**
  - `backend/src/auth/auth.service.ts:318-410`
  - `backend/src/auth/auth.service.spec.ts` (relevant login and lockout tests sampled)

#### Violated invariant

Every failed password attempt must atomically increment the persistent counter, and lockout must be based on the committed count rather than a stale entity snapshot.

#### Evidence and interleaving

The login flow reads the user, performs bcrypt comparison, calculates `newAttempts = user.failedLoginAttempts + 1`, and writes that absolute number. Despite the comment “Atomically increment failed attempts,” the SQL update does not use arithmetic and there is no row lock or version predicate.

Two parallel failures that both read `0` each write `1`. Parallel brute-force requests can therefore make the persistent counter grow substantially more slowly than the number of attempts. A successful-login reset can also race a failed attempt and erase it.

#### Reproduction scenario

- Counter starts at `0`; lockout threshold is `5`.
- Five concurrent invalid-password requests all read `0` before hashing completes.
- Each computes and writes `1`.
- Persistent result can be `1`, not `5`; the account is not locked.

#### Impact

Weakened password-guessing defense and misleading security notifications. This does not bypass password verification, but it undermines the intended online-attempt limit.

#### Recommended correction

Use a row lock or one SQL statement that increments and returns the committed value, then derives lockout from that value. One robust pattern is a CTE/`UPDATE ... SET failed_login_attempts = failed_login_attempts + 1 ... RETURNING failed_login_attempts`, followed by a locked update of `locked_until` when the returned threshold is crossed. Coordinate successful reset with the same row lock or an expected counter/version.

#### Recommended regression test

Run 5, 10, and 20 simultaneous invalid logins through independent connections. Assert exact counter growth and lockout timing. Race a valid login with an invalid login and specify which serial order is accepted; no committed failure may be silently erased by a stale reset.

#### Verification method

Static read-modify-write analysis. No parallel bcrypt/login test was executed.

---

### P4-013 — AI insight generation uses a process-local guard, allowing duplicate provider calls and persistent generations across replicas

- **Classification:** confirmed defect
- **Severity:** MEDIUM
- **Confidence:** high
- **Primary paths:**
  - `backend/src/ai/insights/ai-insights.service.ts:104-270`
  - `backend/src/ai/insights/ai-insights.service.ts:650-735`
  - `backend/src/ai/insights/ai-insights.service.spec.ts:1-820`
  - `docs/cron-jobs.md:1-24`

#### Violated invariant

At most one insight generation should consume provider quota and persist a generation for one user within the configured cooldown window.

#### Evidence and interleaving

`generatingUsers` is an in-memory `Set`. Each backend replica has a different set. The persistent cooldown is a query for a recent insight performed before the provider call and before any generation marker is written.

Two replicas can both:

1. observe no recent insight;
2. add the user to their independent in-memory set;
3. compute aggregates;
4. call the external provider;
5. save separate insight rows.

The cap-pruning transaction does not deduplicate generations and can itself race another save/prune operation.

#### Reproduction scenario

At the daily cron boundary, two backend replicas process the same eligible user before either has saved a new insight. Both provider calls and both saves complete.

Illustrative cost example:

- expected: one provider generation costing `$0.02`;
- produced: two generations costing `$0.04`;
- difference: `+$0.02` or `+100%` for that generation window.

Actual cost depends on provider/model; the concurrency defect does not depend on that illustrative rate.

#### Impact

Duplicate or conflicting insights, excess AI cost, quota exhaustion, duplicate usage accounting, and unnecessary provider load across all users in scaled deployments.

#### Recommended correction

Create a durable per-user generation lease or generation row with a unique `(user_id, generation_window)` key. Claim it before computing aggregates or calling the provider, include an expiry for crashed workers, and permit only the lease owner/generation ID to save results and usage. Make retries resume or replace the same generation rather than create a new one.

#### Recommended regression test

Run `generateInsights(userId)` concurrently in two service instances sharing PostgreSQL. Assert one lease winner, one provider mock invocation, one usage record, and one generation ID. Also test lease expiry and retry after a worker crash.

#### Verification method

Static process/DB-boundary analysis. Existing tests use one service instance and mocks.

---

### P4-014 — Emergency-access grant issuance races across replicas and can email links that are immediately invalidated

- **Classification:** confirmed defect
- **Severity:** MEDIUM
- **Confidence:** high
- **Primary paths:**
  - `backend/src/emergency-access/emergency-access-monitor.service.ts:60-250`
  - `backend/src/emergency-access/emergency-access-monitor.service.spec.ts:1-780`
  - `docs/cron-jobs.md:1-24`

#### Violated invariant

One grant transition for an inactive owner should generate one durable token per contact and send one matching usable link. Only one worker should move the owner from ungranted to granted.

#### Evidence and interleaving

Every replica loads all enabled settings. `processOne()` reads `grantedAt`, loads contacts, generates a fresh random token per contact, saves each contact in its own scoped transaction, sends email, and only after delivery saves `settings.grantedAt` in another transaction. There is no claim, lock, compare-and-set, or transactional outbox.

Two replicas can both see `grantedAt === null`. Replica A saves token A and sends link A. Replica B saves token B to the same contact and sends link B. Whichever token hash is written last is valid; the other delivered link is broken. Both replicas can then mark the settings granted.

The same application-read/send/write pattern exists for daily reminder suppression through `lastReminderSentAt`.

#### Impact

Duplicate sensitive emails, invalid emergency-access links, confused or blocked contacts during a high-stakes recovery event, and non-deterministic grant state.

#### Recommended correction

- Atomically claim the grant transition with `UPDATE ... WHERE granted_at IS NULL ... RETURNING` or a dedicated grant-attempt lease.
- Generate and persist one immutable token/version per contact under the winning grant ID.
- Use a transactional email outbox. The email payload must reference the committed token version.
- Mark `grantedAt` as part of the same durable state transition, not after delivery from every replica.
- Use a unique daily reminder key for reminders.

#### Recommended regression test

Run the daily monitor concurrently in two instances. Assert one grant ID, one token version per contact, one outbox message per contact, and that every delivered token validates. Repeat with SMTP failure and worker crash before/after outbox dispatch.

#### Verification method

Static monitor state-transition and email-order trace. No SMTP or multi-instance test was executed.

---

### P4-015 — Budget-alert deduplication is a check-then-insert race and can duplicate alerts and critical emails

- **Classification:** confirmed defect
- **Severity:** LOW
- **Confidence:** high
- **Primary paths:**
  - `backend/src/budgets/budget-alert.service.ts:203-390`
  - `backend/src/budgets/budget-alert.service.ts:500-690`
  - `backend/src/budgets/entities/budget-alert.entity.ts:1-300`
  - `backend/src/budgets/budget-alert.service.spec.ts:1-760`

#### Violated invariant

For one budget period and logical alert fingerprint, at most one persistent alert and one immediate critical email should be created.

#### Evidence and interleaving

The service reads existing alerts, deduplicates candidates in memory by logical fields including alert type and budget-category ID, then saves each new alert in a separate scoped transaction. The entity/schema has indexes but no matching unique constraint.

Two replicas can both read no existing alert and insert the same candidate. Each set of saved critical alerts can trigger an immediate email.

#### Reproduction scenario

Two daily alert cron invocations process the same over-budget category concurrently. Both observe no `OVER_BUDGET` alert for the period, both insert, and both send the critical email.

#### Impact

Duplicate alert rows, duplicate emails, noisy UI/history, and repeated downstream work. Financial ledger data is not changed.

#### Recommended correction

Define a normalized database fingerprint, for example `(budget_id, period_start, alert_type, normalized_budget_category_id, variant_key)`, and enforce uniqueness. Use `INSERT ... ON CONFLICT DO NOTHING RETURNING`. Send email only for rows returned by the winning insert, preferably through an outbox.

#### Recommended regression test

Run two alert processors against one budget and period. Assert one database row and one email/outbox message for category and budget-wide alerts, including nullable category IDs.

#### Verification method

Static service/entity/schema analysis. Unit tests exercise candidate calculation and single-run deduplication only.

---

### P4-016 — Expired staged-file cleanup can remove bytes required by a pending or running `.mny` job

- **Classification:** confirmed defect
- **Severity:** LOW
- **Confidence:** high
- **Primary paths:**
  - `backend/src/import/mny/mny-staging.service.ts:80-220`
  - `backend/src/import/mny/mny-import.service.ts:102-230`
  - `database/migrations/117_mny_import_staging_and_jobs.sql:1-102`

#### Violated invariant

A staged file referenced by a pending or running job must remain available until the job loads it or the job is safely failed. Expiry eligibility and start eligibility must be consistent.

#### Evidence and interleaving

`sweepExpiredFiles()` deletes every row with `expires_at < CURRENT_TIMESTAMP` and does not exclude staged files referenced by `pending` or `running` jobs. `findInfo()` claims in its comment to return null for expired files, but its query does not filter `expiresAt`. Therefore a request can start from an already expired row before the hourly sweep, and the sweep can delete it before the worker loads the bytes.

The foreign key uses `ON DELETE SET NULL`; the job history survives, but `runImport()` uses the captured staged ID and receives no bytes.

#### Reproduction scenario

1. A staged file passes its expiry time but has not yet been swept.
2. User starts an import; `findInfo()` still returns it and a pending job is created.
3. The sweep deletes the staged row before the background worker calls `loadBytes()`.
4. The job fails with a missing-file error.

A long pending job or stalled worker can be affected similarly.

#### Impact

Failed imports, misleading retry state, and forced re-upload of potentially large files. No committed ledger corruption follows from this race alone.

#### Recommended correction

- Enforce `expires_at >= CURRENT_TIMESTAMP` in `findInfo()` and `loadBytes()`.
- In the same transaction that creates/claims a job, lease or extend the staged file.
- Exclude staged IDs referenced by active jobs from the sweep.
- Release/delete the staged file only after a monotonic terminal job transition.

#### Recommended regression test

Use barriers between `findInfo`, job insertion, claim, load, and sweep. Assert that an active job retains bytes and that an expired, unleased file cannot start.

#### Verification method

Static query/predicate and foreign-key analysis. The sweeper was not executed.

---

### P4-017 — Concurrent attachment uploads can exceed the per-transaction attachment cap

- **Classification:** confirmed defect
- **Severity:** LOW
- **Confidence:** high
- **Primary paths:**
  - `backend/src/attachments/attachments.service.ts:20-125`
  - `database/migrations/109_transaction_attachments.sql:12-40`
  - `backend/src/attachments/attachments.service.spec.ts:1-860`

#### Violated invariant

A transaction may have at most `MAX_ATTACHMENTS_PER_TRANSACTION` (10) attachments, including under concurrent uploads.

#### Evidence and interleaving

The service counts existing attachments and later inserts metadata in the same transaction, but does not lock the parent transaction or use a database-enforced slot. Two transactions can both read the same count and insert distinct rows. The schema has no cap constraint.

#### Reproduction scenario

- Transaction has 9 attachments.
- Upload A counts 9.
- Upload B counts 9.
- Both pass the `< 10` check and insert.
- Final count is 11.

With local/S3 storage, both external objects can also be written.

#### Impact

The advertised storage limit is bypassed, increasing storage and UI/API load. Scope is limited to one transaction and does not alter financial ledger values.

#### Recommended correction

Lock the parent transaction row before count-and-insert, or assign database-enforced attachment slots `1..10` with a unique `(transaction_id, slot)` constraint. Keep the lock/slot claim in the same transaction as metadata creation.

#### Recommended regression test

Start with 9 attachments and race two uploads through independent connections. Exactly one should commit. Repeat from 0 with more than 10 concurrent uploads and with each provider.

#### Verification method

Static count/insert/schema analysis. Existing tests cover the cap serially with mocks.

---

### P4-018 — Bill and mortgage reminder crons send duplicate email from every backend replica

- **Classification:** confirmed defect
- **Severity:** LOW
- **Confidence:** high
- **Primary paths:**
  - `backend/src/notifications/bill-reminder.service.ts:1-170`
  - `backend/src/accounts/mortgage-reminder.service.ts:1-190`
  - `docs/cron-jobs.md:1-24`
  - `helm/templates/statefulset-backend.yaml:1-35`

#### Violated invariant

One logical reminder window should produce at most one email per user, independent of backend replica count.

#### Evidence and interleaving

Both reminder services run daily in the API process, query eligible rows, group them per user, and call `sendMail()` directly. Neither service claims a delivery, records a durable notification key, nor passes an idempotency key to a provider. Repository documentation explicitly states that every backend replica fires every cron.

Two healthy replicas therefore both send the same reminder without requiring a rare timing race.

#### Reproduction scenario

Deploy two backend replicas with SMTP configured. At 08:00, both replicas select the same user’s due manual bill or approaching mortgage renewal and send the same message.

#### Impact

Duplicate user email, reduced trust in reminders, unnecessary SMTP load, and possible provider-rate-limit pressure. No ledger mutation occurs.

#### Recommended correction

Create a durable notification-delivery key such as `(notification_type, user_id, local_delivery_date, reminder_window_hash)`. Atomically insert/claim it and send through a transactional outbox. Only the winning claim may dispatch; retries should reuse the same provider idempotency key where supported.

#### Recommended regression test

Run each reminder cron from two service instances against one database. Assert one outbox/delivery row and one provider invocation per logical window. Include crash after claim and before/after send.

#### Verification method

Static cron/deployment/email-call trace. No SMTP delivery was executed.

---

## 7. Design risks requiring a decision

These items are material architectural risks but did not meet the standard for a new confirmed defect in this phase.

### DR-04-01 — Nested scoped calls do not bind the ambient transaction to one immutable identity context

`withScopedDb` joins an active manager without comparing effective user, real user, system-bypass flag, or preserve-timestamps flag to the context that established the transaction GUCs. An inner `withSystemContext` does not reconfigure the already-open transaction; an inner user switch likewise continues under outer GUCs. Request context and transaction context can therefore diverge in principle.

No realistic production call path changing identity inside an active transaction was established at this baseline. The issue remains a design risk and missing-test area, not a confirmed authorization defect.

**Decision required:** capture an immutable transaction-context fingerprint with the active manager and reject incompatible nested contexts, or define and test explicit escalation/de-escalation semantics.

### DR-04-02 — Destructive imports/restores lack an explicit same-user maintenance lease

`.mny` wipe mode deletes user data before job creation. Backup restore and other destructive maintenance operations have broad transactional scope, but the reviewed paths do not establish a common per-user maintenance lock that blocks interactive writes or another maintenance job. Phase 3 identified restore-specific problems; this phase did not dynamically prove an additional distinct corruption scenario beyond P4-001/P4-002 and prior findings.

**Decision required:** define whether interactive writes are allowed during restore/wipe, and implement a per-user maintenance lease if they are not.

### DR-04-03 — Post-commit action history and net-worth recalculation have no durable delivery guarantee

Several financial services commit the ledger and then record action history or trigger debounced net-worth recalculation outside the transaction. A crash can lose the secondary action, while retries can duplicate it. No concrete user-data corruption beyond stale derived/audit state was independently proven in this phase.

**Decision required:** identify which derived/audit effects are required and move them to an outbox or transactionally written work queue.

### DR-04-04 — The cron architecture has no shared lease/idempotency framework

Individual jobs implement heterogeneous safeguards: conditional update, unique constraints, process-local sets, pre-write queries, or no coordination. P4-004, P4-013, P4-014, P4-015, and P4-018 are concrete manifestations. Other provider refresh and cleanup jobs were sampled but not fully proven defective.

**Decision required:** establish a standard durable cron claim and idempotency library instead of per-service ad hoc coordination.

### DR-04-05 — Application-maintained financial state uses incompatible mutation protocols

Atomic increments, absolute recomputation, delete/recreate rebuilds, and direct import writes coexist without one lock/version protocol. P4-003, P4-005, and P4-006 are confirmed defects; additional mutators may share the same structural risk.

**Decision required:** choose one serialization model per account/holding key and require every mutator to participate.

### DR-04-06 — Demo reset and intraday generation are not coordinated across replicas

In demo mode, the daily clear commits before reseeding, and intraday generation performs check, insert, and balance update in separate transactions. Multiple replicas can clear/reseed concurrently or both pass the deterministic intraday deduplication query. Because this is restricted to demo mode and seed internals were sampled rather than exhaustively traced, it is recorded as a design risk rather than an additional counted defect.

### DR-04-07 — Backup execution has no claim/lease, but the concrete root causes remain prior Phase 3 findings

Manual “run now,” cron, and multiple replicas can execute the same user/date backup concurrently. Retention and promotion can race active writes. This strengthens P3-001 and P3-004 but does not add a distinct Phase 4 root cause.

### DR-04-08 — Database initialization and migrations are not serialized across replicas

Every backend entrypoint runs `db-init` and `db-migrate`. The runner reads one applied-set snapshot and has no advisory lock. Two processes can attempt the same migration and one can fail at DDL or tracker insertion, causing rollout restart noise. This independently confirms P3-016 at its prior LOW severity; persistent corruption was not established, so it is not counted again.

---

## 8. Missing tests

### 8.1 Confirmed missing concurrency tests

The following gaps are confirmed after inspecting the corresponding test files and, where present, integration suites:

1. two complete `.mny` `start()` requests for the same user/file;
2. `.mny` start for two files, two users, and wipe mode under concurrency;
3. failpoints after `.mny` data commit and before terminal job state;
4. transaction update/update, update/delete, delete/delete, and status races using two PostgreSQL connections;
5. transfer and split races with deterministic row-lock ordering;
6. absolute balance recomputation versus atomic delta;
7. two concurrent investment trades against one existing holding;
8. holdings rebuild versus interactive trade;
9. scheduled post versus cron/manual/edit/delete and crash between commits;
10. account close versus existing-ledger unvoid/update/delete;
11. local/S3 attachment operation versus database commit failure and parent cascade;
12. logout versus refresh rotation;
13. parallel failed-login counter increments;
14. double emergency-access claim;
15. two-replica emergency grant issuance;
16. two-instance AI generation;
17. two-instance budget-alert insertion/email;
18. concurrent attachment-cap enforcement;
19. duplicate bill and mortgage reminder dispatch.

### 8.2 Nested scoped-transaction tests not located

The scoped DB tests cover ordinary nesting and manager reuse, but tests were not located for:

- changed effective user;
- changed real user;
- user-to-system and system-to-user nesting;
- changed preserve-timestamps flag;
- inner error caught by outer code;
- inner error propagated;
- real pool reuse after rollback;
- pool reuse after an uncaught callback exception;
- external side effect before outer commit.

### 8.3 Broader tests not located under connector limitations

A complete immutable recursive tree was unavailable, so the following are phrased as “test not located,” not proven repository-wide absence:

- two-process `db-init`/`db-migrate` execution;
- automatic-backup manual/cron/retention overlap;
- global currency cleanup racing activation;
- restore running concurrently with interactive writes;
- provider-refresh duplicate-call tests across replicas.

---

## 9. Documentation issues

### DOC-04-01 — Attachment transactionality comment overstates local/S3 guarantees

`backend/src/attachments/attachments.service.ts:47-53, 112-116` says metadata and bytes are written in one transaction and commit together. That is true only for the database provider. Local filesystem and S3 operations are not transactional with PostgreSQL.

### DOC-04-02 — `.mny` retry comment contradicts the post-commit workflow

`backend/src/import/mny/mny-import.service.ts:70-78` says a failure leaves nothing behind and retry cannot double-import. `writeAll()` commits before finalization, verification, staged-file removal, and job completion, so failures after that commit can leave all imported rows behind.

### DOC-04-03 — Staged-file lookup comment claims expiry enforcement that the query does not implement

`backend/src/import/mny/mny-staging.service.ts:88-101` describes expired files as absent, but `findInfo()` filters only by ID and user.

### DOC-04-04 — Emergency claim comment claims locking that is absent

`backend/src/emergency-access/emergency-access-claim.controller.ts:181-187` says the transaction revalidates under lock. The `findOne` call has no lock option and consumption has no conditional predicate.

### DOC-04-05 — Failed-login comment calls an absolute stale write an atomic increment

`backend/src/auth/auth.service.ts:354-382` says “Atomically increment failed attempts,” but calculates from the pre-hash entity and writes an absolute value.

### DOC-04-06 — Cron inventory is incomplete

`docs/cron-jobs.md` correctly warns that every replica runs every cron, but its table omits discovered jobs including automatic backup, matured investment holdings, emergency-access monitoring, action-history cleanup, and update checks. The omission makes multi-replica side-effect review harder.

### DOC-04-07 — Auxiliary contribution guidance is stale relative to scoped transaction conventions

`CONTRIBUTING.md` and auxiliary `.claude` guidance include patterns that are less specific than the current `withScopedDb`/RLS rules in the nearest `CLAUDE.md` files. The scoped instructions were treated as authoritative.

## 10. Complete backend transaction inventory

The table records only workflows inspected to a level that supports the stated classification. “Unknown” isolation means no explicit override was found; PostgreSQL `READ COMMITTED` was used for race analysis.

| Workflow | Entry point | Service method | Scoped context | Transaction boundary | Nested calls joining boundary | Reads before writes | Locking / constraint | Isolation assumption | External effects | Retry behavior | Idempotency | Derived state | Failure behavior | Test coverage | Finding status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Cash transaction create | API / MCP-confirmed create | `TransactionsService.create` | user / delegated user | one inner `withScopedDb` for row, splits, tags, balance | split, tag, balance services join | account/category/payee validation occurs before write tx; account is read again by balance service | atomic account increment; no request idempotency key | READ COMMITTED | post-commit net-worth trigger/action history | caller retry can create another row | none | `current_balance`, tags, split/transfer side effects | DB work rolls back together; post-commit derived effects can be lost | unit tests with mocks; no duplicate-request integration race | safe for two ordinary atomic increments; P4-005/P4-008 at protocol boundaries |
| Cash transaction update | API | `TransactionsService.update` | user | write `withScopedDb` starts after `findOne` | splits, transfer, balance | original row/account/amount/status/date loaded before tx | no row lock/version | READ COMMITTED | post-commit net-worth/history | manual retry | none | balance, splits, counterpart | stale delta can commit | mocked unit tests | **P4-003** |
| Cash transaction delete | API | `TransactionsService.remove` | user | write tx after pre-read | split side effects, transfer, balance | transaction loaded before tx | no `DELETE ... RETURNING` expected-version guard | READ COMMITTED | action history / net worth after commit | retry can reverse twice | none | balance, linked rows | second delete may still reverse stale amount | mocked unit tests | **P4-003** |
| Transfer create | API / scheduled post | `TransactionsService.createTransfer` / `TransactionTransferService.create` | user | one scoped tx for both legs and balances | account balance/tag calls join | source/destination validation before tx | atomic increments; no request idempotency key | READ COMMITTED | post-commit history/net worth | duplicate request creates another pair | none | two ledger legs, links, two balances | DB rollback protects both legs | unit tests; no duplicate/concurrent request test | safe atomic pair; exposed by P4-004 duplicate occurrence |
| Transfer update/delete | API | `TransactionTransferService.update/remove` | user | tx starts after both legs are loaded | balance and tag calls join | both leg snapshots predate tx | no row lock/version; no deterministic lock protocol | READ COMMITTED | post-commit history/net worth | retry unsafe | none | both balances, link symmetry | stale leg deltas can corrupt one/both accounts | mocked unit tests | **P4-003** |
| Full split replacement | transaction API | `TransactionSplitService.updateSplits` | user | one scoped tx; nested methods join | remove embedded investments/linked transfers; create replacement | parent object supplied from caller; side-effect rows read in tx | no explicit parent lock/version | READ COMMITTED | net-worth trigger may be post-commit/debounced | retry replaces again | parent ID only, no version | categories, transfer counterparts, holdings | inner DB work rolls back; concurrent parent/split edit unresolved | unit tests with mocks | risk through P4-003/P4-009; no separate finding |
| Incremental split add | transaction API | `TransactionSplitService.addSplit` | user | insert tx after existing-sum read | transfer counterpart/balance joins insert tx | existing split total read before tx | no parent lock; no aggregate constraint | READ COMMITTED | net-worth side effect | retry adds another split | none | split sum, optional counterpart/balance | both individually valid additions can exceed parent | mocked unit tests | **P4-009** |
| Investment create | API / scheduled / embedded split | `InvestmentTransactionsService.create*` | user | one scoped tx for investment row, cash row/effect, holding | account, holding, transfer helpers join | ownership and some related objects may be validated before tx | cash delta atomic; holding RMW unlocked | READ COMMITTED | net-worth / prices may be post-commit | duplicate request repeats trade | none | cash balance, holding quantity/cost | cash can remain correct while holding loses update | unit tests and mocked holdings tests | **P4-006** |
| Investment update/delete | API | `InvestmentTransactionsService.update/remove` | user | reverse/reapply in one scoped tx | holding/cash/transfer helpers join | original investment loaded before or at outer flow; holding reads unlocked | no holding lock/version; historical replay validation | READ COMMITTED | net-worth | retry unsafe without version | none | cash, holdings, transfer relations | stale holding/state interleavings possible | unit tests; no two-connection race | **P4-006**, P4-003-adjacent |
| Holding full rebuild | API/import/hourly cron | `HoldingsService.rebuildFromTransactions`, `rebuildAccountsFromTransactions` | user; system fan-out then user | full rebuild reads may span separate txs; delete/recreate in later tx | investment queries | accounts and transactions read before write tx in full rebuild | unique pair only; no account/holding serialization | READ COMMITTED | none external | cron/manual rerun recomputes | intended idempotent only on unchanged ledger | holdings | can replace a concurrent committed trade with stale snapshot | mocked tests | **P4-006** |
| Scheduled posting | hourly cron / manual API | `processAutoPostTransactions` → `post` | system fan-out; per-user post | due read tx; financial create tx; separate bookkeeping tx | ordinary transaction/transfer/investment services | due row/override read before posting | no claim/occurrence unique key | READ COMMITTED | history, email indirectly | cron repeats; crash repeats | none per occurrence | ledger, balances, holdings, next due date | financial effect can commit without advancement | unit tests with mocks | **P4-004** |
| `.mny` stage/upload | API | `MnyStagingService.stage` | user | one tx for superseded cleanup + BYTEA insert | none | active-job exclusion in cleanup | no one-file-per-user DB uniqueness; row expiry | READ COMMITTED | none (bytes in DB) | reupload creates new row | SHA stored but not used as idempotency key | staged bytes | active files protected from supersede, not expiry sweep | unit tests sampled | P4-016 risk boundary |
| `.mny` start | API | `MnyImportService.start` | user | multiple independent scoped txs | job/staging/wipe services | staged info, active-job check, wipe before job insert | no active unique key | READ COMMITTED | background task scheduling | client retry creates new job | none | job state; optional destructive wipe | two starts both succeed | unit tests; no full start race | **P4-001** |
| `.mny` import body | detached background worker | `runImport` / `writeAll` | explicit user context | one long DB import tx, then separate postprocess/status txs | writers join import tx; progress escapes it | staged bytes loaded before write; mappings built in memory | one job-row claim; no import idempotency key | READ COMMITTED | price/FX providers, net-worth tasks | failed jobs can be retried | fresh UUIDs; no source uniqueness | all user financial data, balances, holdings, result | commit/finalization ambiguity | job claim integration test; no failpoint recovery | **P4-002** |
| Generic import post-processing | import completion | `ImportPostProcessingService.run` | user | balance select/update tx; provider calls separate | price/FX/net-worth services | balance snapshot before absolute update | no account lock | READ COMMITTED | market/FX providers | per-step best effort | provider-specific | balances, prices, rates, net worth | warnings swallow failures; stale overwrite possible | tests sampled | **P4-005** / design risk |
| Attachment upload | API | `AttachmentsService.create` | user | one DB tx for metadata; provider called before commit | DB provider joins; local/S3 do not | transaction ownership and count in tx | no parent lock for cap | READ COMMITTED | local filesystem or S3 | caller retry creates new UUID/key | object key unique, no operation state | attachment count/availability | external orphan on DB commit failure | mocked provider tests | **P4-010**, **P4-017** |
| Attachment delete | API / transaction cascade | `AttachmentsService.remove`; FK cascade | user | metadata delete tx; external delete before commit | provider call | metadata read before delete tx | no tombstone/outbox | READ COMMITTED | local filesystem or S3 | retry may find metadata/missing object mismatch | delete intended idempotent at provider only | attachment availability | external delete can survive DB rollback; cascade skips provider | mocked tests | **P4-010** |
| Automatic backup | cron / admin “run now” | `AutoBackupService` methods | system fan-out; per-user export | export consists of many short query txs; status separate | `BackupService` | due/config/status read before artifact | no claim/lease; prior shared path | READ COMMITTED per query | filesystem volume | cron/manual rerun | filename/date only; unsafe across tenants per P3 | artifact/status/retention | overlap and crash windows | unit tests sampled | prior P3-001/P3-004 strengthening |
| Backup export | API / auto backup | `BackupService.export*` | user/system as caller | each query helper opens its own scoped tx | table query helpers | table-by-table reads | no one-snapshot transaction | READ COMMITTED across transactions | memory/filesystem at caller | manual retry | none | serialized relational snapshot | parent/child tables can reflect different commits | backup tests sampled | independent confirmation of P3-007 |
| Backup restore | API | `BackupService.restore*` | user + preserve timestamps | broad DB restore tx for database rows | mapping/import helpers | backup parsed/validated before tx | no explicit same-user maintenance lease | READ COMMITTED | local/S3 mapping issues prior P3 | retry semantics complex | backup IDs/remap | DB rollback on failure; external providers not coupled | tests sampled | prior findings / DR-04-02 |
| Account close/reopen | API | `AccountsService.close/reopen` | user | one scoped tx | linked brokerage update | close reads account under lock | `pessimistic_write` on primary account | READ COMMITTED | post-commit net worth in other update paths | explicit user retry | state check | closed flag/pair state | existing-ledger balance update can cross close | unit tests; no race | **P4-008** |
| Refresh rotation | auth endpoint | `TokenService.refreshTokens` | pre/user auth context | one scoped tx | user read | token read under row lock | `pessimistic_write`; family ID | READ COMMITTED | JWT signing in process | replay revokes family | token hash unique | token family | concurrent same-token rotation has one winner | mocked tests | safe for same-token race |
| Logout/revoke | auth endpoint | `revokeRefreshToken` | user/pre-auth | lookup tx then family-update tx | `revokeTokenFamily` | token/family read before later update | no family lock | READ COMMITTED | none | user retry | family update | active sessions | replacement inserted after update snapshot can survive | mocked tests | **P4-011** |
| Failed login | auth endpoint | `AuthService.loginWithinContext` | system pre-identity | user read and later updates in separate short txs | preferences/email | counter read before bcrypt and update | no row lock/arithmetic increment | READ COMMITTED | lockout email fire-and-forget | attacker parallel requests | none | failed-attempt counter/lock | lost increments | unit tests sampled | **P4-012** |
| Emergency claim | unauthenticated endpoint | claim controller `completeWithinContext` | system | one credential tx; token revocation and issuance afterward | TokenService | precheck then transaction re-read | no row lock/CAS on claim | READ COMMITTED | breach API; cookies/JWT | duplicate request possible | token intended single-use only | credentials, 2FA, sessions | two consumers can commit | mocked tests | **P4-007** |
| Emergency grant monitor | daily cron | `EmergencyAccessMonitorService.runDailyCheck` | system | many short repository txs around direct email sends | email/localization | settings/contacts read before token writes and grant marker | no claim/CAS | READ COMMITTED | SMTP | next cron retries | none | grant tokens, marker | multiple replicas overwrite tokens and send mismatched links | mocked tests | **P4-014** |
| Budget alert generation | multiple crons | `BudgetAlertService.processAlerts` | system fan-out then user | existing read, each insert, and email flags in separate txs | email | existing-alert snapshot | no unique fingerprint | READ COMMITTED | SMTP | next cron | app-only dedupe | alert rows/email state | duplicate inserts/emails | mocked tests | **P4-015** |
| AI insights generation | cron/manual | `AiInsightsService.generateInsights` | user/system fan-out | cooldown read; provider; save/prune tx | aggregator/AI/usage | recent-insight query before provider | process-local set only | READ COMMITTED | AI provider | cron/manual retry | cooldown after result only | insight rows/usage | duplicate provider calls and rows | mocked tests | **P4-013** |
| DB initialization | every backend entrypoint | `db-init` | migrator credentials | existence check and schema application | raw pg | database/object existence | no advisory lock | PostgreSQL defaults | filesystem schema read | process restart | partial idempotency in schema | database schema | simultaneous fresh init can conflict | tests not located | prior P3-016 |
| DB migration | every backend entrypoint | `runMigrations` | migrator credentials | each migration own `BEGIN`/`COMMIT` | raw pg | applied set read once | filename PK only; no runner lock | READ COMMITTED | filesystem migration read | pod restart retries | migration SQL guards vary | schema/tracker | second runner can fail rollout | migration lint/CI definition | prior P3-016 |

## 11. Account-balance and holdings mutator ledger

| Path / method | Balance source | Mutation form | Lock | Transaction coupling | Concurrent failure | Recovery | Tests | Status |
|---|---|---|---|---|---|---|---|---|
| `TransactionsService.create` | supplied signed amount | atomic SQL increment | account row locked only by update statement | same tx as ledger insert | safe against another atomic create; incompatible with absolute recompute | later rebuild | mocked unit tests | safe within atomic protocol; P4-005 boundary |
| `TransactionTransferService.create` | two signed legs / conversion result | two atomic SQL increments | update statement locks | same tx as both legs | atomic pair; duplicate request/occurrence repeats pair | rebuild | mocked tests | safe pair; P4-004 idempotency gap |
| `TransactionsService.update` | old entity snapshot + new amount | delta from stale old value | none on ledger before read | delta and row write share tx, but old read does not | lost/stale adjustment | rebuild only | mocked tests | **P4-003** |
| `TransactionsService.remove` | preloaded transaction amount | reversal delta | none / no conditional delete result | same tx after stale pre-read | double reversal | rebuild | mocked tests | **P4-003** |
| `TransactionTransferService.update/remove` | preloaded two-leg snapshot | reverse/reapply deltas | no deterministic row locks | one write tx | stale two-account corrections | rebuild | mocked tests | **P4-003** |
| `TransactionReconciliationService.updateStatus` | caller-supplied transaction/status | add/remove amount on VOID transition | none on transaction/account | status and delta share tx | two transitions or close race | rebuild | mocked tests | **P4-003**, **P4-008** |
| `TransactionBulkUpdateService` | rows collected before later operation | per-row reversal/update | none for collected snapshot | later scoped tx | concurrent row mutation invalidates delta | rebuild | sampled tests | **P4-003** |
| `TransactionSplitService` transfer side effects | split amount / linked tx | atomic delta | no parent split-set lock | nested in split tx | aggregate race; side effect may be based on invalid set | manual repair/rebuild | mocked tests | **P4-009** |
| `InvestmentTransactionsService` cash side | action-dependent amount | atomic account delta | update statement | same tx as investment row/holding | cash increments serialize; holding may not | rebuild cash/holdings | mocked tests | cash safe; holding **P4-006** |
| `HoldingsService.createOrUpdate/adjust/applySplit` | current holding entity | `new = old + delta`, entity save | none/version absent | same tx as trade when manager passed | lost quantity/cost update | holdings rebuild | mocked tests | **P4-006** |
| `HoldingsService.rebuildFromTransactions` | replayed investment ledger snapshot | delete/recreate full state | none shared with interactive trades | read(s) and write not one serialized snapshot | stale rebuild overwrites trade | rerun, but rerun can race again | mocked tests | **P4-006** |
| `AccountsService.recalculateCurrentBalance` | opening + SUM ledger | absolute entity save | none | sum and save scoped, detached account pre-read | overwrites concurrent delta | rerun | mocked tests | **P4-005** |
| `ImportPostProcessingService.run` | grouped opening + SUM | absolute bulk update | none | SELECT and UPDATE in one READ COMMITTED tx | concurrent ledger commit between statements omitted | rerun | tests sampled | **P4-005** |
| `AccountsService.applyDueTransactionBalances` | grouped ledger/date snapshot | absolute bulk update | none | scoped select/update | same stale overwrite class | next hourly run | tests sampled | **P4-005** |
| `.mny` writers | mapped file totals and transactions | direct inserts plus balance writes/rebuild | import transaction only | one long import tx | duplicate job/retry repeats source; concurrent interactive writes not maintenance-locked | restore/rebuild/manual cleanup | writer tests; no full race | **P4-001**, **P4-002**, DR-04-02 |
| Scheduled posting | scheduled amount delegates to ordinary services | normal atomic deltas | no occurrence claim | financial commit before schedule advancement | duplicate occurrence applies twice | manual delete/rebuild | mocked tests | **P4-004** |
| Backup restore | backup-provided rows/balances | full restored state | broad restore tx; no maintenance lease found | database rows transactional | concurrent user semantics undecided | restore retry/manual | sampled tests | prior findings / DR-04-02 |
| Demo intraday generation | generated signed amount | transaction insert, then separate atomic balance update | none across the two txs | **not** same transaction | crash leaves ledger without balance; replicas can duplicate | next reset | demo tests sampled | DR-04-06 (demo-only) |
| Account opening-balance update | stored opening balance | account entity update, derived recalculation trigger | account write lock at statement only | account update tx; net worth post-commit | interaction with concurrent rebuild not exhaustively traced | balance recompute | sampled | sampled; Phase 5 follow-up |

### Required lost-update example

The canonical account-balance example applies to P4-003:

```text
Opening balance: 100.00
Existing transaction: -10.00
Stored current balance: 90.00
Request A changes transaction to -20.00 (delta -10.00)
Request B changes transaction to -30.00 but uses the same old -10.00 (delta -20.00)
Produced current balance: 60.00
Expected current balance for the final -30.00 row: 70.00
Difference: -10.00
```

Two simultaneous ordinary creates of `-10.00` and `-20.00` use SQL arithmetic and should produce `70.00`; the failure occurs when a stale absolute or stale-delta writer participates.

## 12. `.mny` job state-machine and concurrency analysis

### 12.1 State-machine ledger

| Current state | Transition | Source | Condition / SQL predicate | Lease or owner check | Retry counter | Constraint enforcement | Failure notes | Test coverage |
|---|---|---|---|---|---|---|---|---|
| none | → `pending` | `jobs.create` | unconditional insert | none | none | TypeScript type only; DB `VARCHAR` | two starts create two rows | unit test; no full start race |
| `pending` | → `running` | `claim` | `WHERE id=$1 AND status='pending' RETURNING id` | job ID only | none | predicate enforces transition | one row has one winner | real PostgreSQL concurrent-claim integration test |
| `running` | → `running` heartbeat | timer | `WHERE id=$1 AND status='running'` | no worker generation/owner | none | predicate only | old and new worker cannot be distinguished if job ID reused operationally | unit tests |
| `running` | → `running` progress | worker | `WHERE id=$1 AND status='running'` | no worker generation/owner | none | predicate only | progress ignored after state leaves running | unit tests |
| `running` | → `completed` | worker | `WHERE id=$1` | none | none | no state predicate | can overwrite a reaper’s `failed` state | unit tests; no reaper race |
| `running` | → `failed` | worker catch | `WHERE id=$1` | none | none | no state predicate | any non-parser failure marked retryable, including post-commit ambiguity | unit tests |
| `pending`/`running` | → `failed` | reaper | stale timestamp predicate in one SQL update | no worker generation | none | conditional state/time predicate | safe against a heartbeat committed before predicate evaluation; can race late completion | integration/unit coverage partial |
| `failed` | → new `pending` row | user retry/start | new job insert over same staged file | none | no attempt linkage/count | no uniqueness | replay not idempotent | no post-commit retry test |
| `completed` | terminal | none | application convention only | none | none | no DB CHECK | invalid status could bypass active partial logic if added without CHECK | no DB constraint test |

### 12.2 Active-job key decision

At this baseline, the implementation’s intended key is `user_id`, not `staged_file_id`, because `hasActiveJob` asks only whether that user has any pending/running job. The report recommends preserving that key unless product requirements explicitly change. If concurrent source formats are later allowed, `(user_id, source_format)` is the defensible alternative. Any choice must be documented and enforced by both a status `CHECK` and a partial unique index.

### 12.3 Worker, reaper, and staged-file conclusions

- Two workers claiming **one** job are safely serialized by the conditional update.
- Two independently created jobs are not serialized.
- A heartbeat committed before the reaper update’s predicate is evaluated prevents that row from matching; the prior “fresh heartbeat is always reaped” hypothesis remains rejected.
- A stalled worker that resumes can call unguarded `complete()` after the reaper set `failed`.
- Staged-file expiry is not coordinated with active job state (P4-016).
- Retry has no attempt linkage, source-record key, or durable data-commit checkpoint (P4-002).
- Progress and heartbeat intentionally use `runOutsideActiveScopedManager`; this makes progress visible but also confirms that job state and imported data are not one atomic unit.

## 13. Multi-replica scheduled-job matrix

| Job | Schedule | Replica behavior | Selection | Claim mechanism | Side effect | Idempotency | Concrete duplicate impact | Recovery | Tests | Classification |
|---|---|---|---|---|---|---|---|---|---|---|
| Scheduled transaction auto-post | minute 5 hourly | every replica | active, auto-post, due rows | none | cash/transfer/investment ledger + balances/holdings | none per occurrence | duplicate financial posting | next run repeats if schedule not advanced | mocked unit tests | **P4-004 defect** |
| Automatic backup | configured cron + manual | every replica/manual | enabled users/due date | none | filesystem write, promotion, retention, status | date filename only | concurrent same path; prior shared namespace | retry/next run; no crash-atomic recovery | sampled tests | prior P3-001/P3-004 strengthening |
| `.mny` job reaper | every 5 min | every replica | stale pending/running | conditional bulk update | job status | predicate makes duplicate updates harmless | no duplicate business effect established | user retry | integration/unit partial | safe for duplicate reaper execution; P4-002 terminal race |
| Staged-file expiry | hourly | every replica | `expires_at < now` | delete predicate only | BYTEA deletion | delete is idempotent | active job can lose bytes | re-upload | unit partial | **P4-016 defect** |
| Bill reminders | daily 08:00 | every replica | due manual bills | none | SMTP | none | duplicate user email | next day repeats | unit/sample | **P4-018 defect** |
| Mortgage reminders | daily 08:00 | every replica | term ending within window | none | SMTP | none | duplicate user email | next day repeats | unit/sample | **P4-018 defect** |
| Budget-period creation | monthly | every replica | budgets needing period | application flow | DB insert | `UNIQUE(budget_id, period_start)` | duplicate row prevented; one worker may receive unique error | next run/manual | unit tests | rejected duplicate-period false positive |
| Budget alerts | daily/weekly configured crons | every replica | active budgets/current period | existing-row query only | alert rows + SMTP | app-only dedupe | duplicate alert/email | future dedupe sees duplicates already stored | mocked tests | **P4-015 defect** |
| AI insights | daily 06:00/manual | every replica | eligible users / cooldown | process-local set | provider call, usage, insight rows | post-result cooldown | duplicate provider cost/rows | cap pruning | mocked tests | **P4-013 defect** |
| Matured investment holdings | hourly at minute 30 | every replica | users with today’s investment rows | none beyond rebuild | holdings delete/recreate | intended full recompute | races interactive trade/rebuild | later rebuild | mocked tests | **P4-006 defect** |
| Due/current account balances | daily/hourly account maintenance | every replica | eligible accounts/users | none | absolute balance write | recompute on unchanged ledger | overwrites interactive delta | next rebuild | sampled tests | **P4-005 defect** |
| Emergency-access monitor | daily 09:00 | every replica | enabled settings | none | tokens, credentials state marker, SMTP | app state checks | overwritten emailed token / duplicate reminders | next run cannot repair delivered broken link | mocked tests | **P4-014 defect** |
| Refresh-token purge | daily 03:00 | every replica | expired/revoked rows | delete predicate | DB delete | idempotent | no material duplicate side effect | next run | mocked tests | no material issue found |
| Action-history cleanup | discovered cron | every replica | old history rows | delete predicate | DB delete | expected idempotent | no concrete duplicate harm established | next run | sampled | no material issue found |
| Exchange-rate refresh/backfill | scheduled/provider-driven | every replica | currencies/dates | provider- and upsert-specific; sampled | provider calls + rates | uniqueness/upsert likely limits rows | duplicate provider calls possible; no distinct corruption confirmed | next refresh | sampled | design risk / not fully verified |
| Security-price refresh | weekday schedule | every replica | active securities | provider- and unique-date logic; sampled | provider calls + prices | `UNIQUE(security_id,price_date)` limits rows | duplicate provider load; exact overwrite semantics not fully traced | next refresh | sampled | design risk / not fully verified |
| Demo reset | daily 04:00 | every replica in demo mode | demo user | none | destructive clear then reseed | seed-specific | overlapping empty/reseed windows | retry once/next reset | sampled tests | DR-04-06 |
| Demo intraday generation | every 3 hours | every replica in demo mode | deterministic date/hour candidates | check-then-insert | transaction insert then separate balance delta | query-only dedupe | duplicate demo transaction; crash can split ledger/balance | next reset | sampled tests | DR-04-06 |
| Update checks | discovered scheduled service | every replica | release/update source | process/cache behavior sampled | external HTTP/cache/notification | not fully established | no concrete persistent duplicate effect confirmed | next run | sampled | unverified hypothesis |

## 14. External-side-effect atomicity matrix

| Workflow | DB transaction | External operation | Order relative to commit | Failure before commit | Failure after external success | Retry safety | Compensation | Idempotency key | Orphan detection | Finding status |
|---|---|---|---|---|---|---|---|---|---|---|
| Attachment, database provider | metadata + blob share ambient manager | none outside PostgreSQL | same commit | all DB work rolls back | not applicable | DB PK protects blob | cascade | attachment ID | DB referential integrity | safe; excluded from P4-010 |
| Attachment, local provider | metadata tx | `writeFile` / `unlink` | before DB commit | provider error aborts tx | commit failure leaves orphan or missing bytes | key operation partly repeatable; lifecycle ambiguous | none | attachment UUID | absent | **P4-010** |
| Attachment, S3 provider | metadata tx | put/delete object | before DB commit | provider error aborts tx | commit failure leaves orphan or missing bytes | object key repeatable but state ambiguous | none | attachment UUID/object key | absent | **P4-010** |
| Parent transaction delete with external attachment | transaction delete tx | no provider call | DB commit only | rollback keeps metadata | committed cascade leaves object | retry cannot discover removed metadata | none | absent | absent | **P4-010** |
| Automatic backup | table reads/status txs | filesystem write/copy/unlink | outside DB commit; status later | partial artifact/status mismatch | artifact can exist without correct status | same path unsafe | retention only | date filename | directory scan only | prior P3-001/P3-004 |
| Bill reminder | read txs only | SMTP send | after reads, no durable delivery tx | no DB state needed | send succeeds before process crash → next replica/retry sends again | not duplicate-safe | none | absent | absent | **P4-018** |
| Mortgage reminder | read txs only | SMTP send | after reads | same | same | not duplicate-safe | none | absent | absent | **P4-018** |
| Budget critical alert | alert insert tx(s), email flag later | SMTP send | after row commit, before/then flag updates | inserted row may remain unsent | send can succeed before email flag save; duplicate processor sends too | not duplicate-safe | none | absent | row flag only | **P4-015** |
| Emergency grant | token saves and settings save in separate txs | SMTP send | after each token save, before grant marker | token can exist unsent | sent token can be overwritten by replica; crash before marker retries | not duplicate-safe | none | random token, no grant generation | absent | **P4-014** |
| Emergency reminder | settings timestamp after email | SMTP send | send before `lastReminderSentAt` save | no timestamp if send fails | send succeeds, save/crash fails → repeat | not duplicate-safe | none | absent | timestamp only | covered by P4-014 design/root |
| AI insights | cooldown read; result save tx | AI provider completion | provider before result commit | provider failure saves nothing | provider succeeds, DB save fails → retry spends again | not duplicate-safe | none | absent generation ID | absent | **P4-013** |
| Price/FX backfill | multiple DB operations | market-data providers | service-specific | partial best effort | provider success and DB failure can retry | provider calls repeatable; row uniqueness varies | none common | date/security or currency/date at DB layer | partial | sampled design risk |
| Action history / net worth | financial DB commit already complete | in-process async/debounced work | after commit | ledger remains authoritative | crash loses derived/audit work | may duplicate on caller retry | logging only | absent | recomputation possible for net worth | DR-04-03 |
| `.mny` staged bytes | PostgreSQL BYTEA | none external | DB transactions | rollback safe | separate job/data commits create state ambiguity | retry unsafe after data commit | none | SHA stored but not enforced | job/row inspection only | **P4-002/P4-016** |
| OAuth/OIDC revocation | sampled only | identity-provider call | not fully traced | unknown | unknown | unknown | unknown | unknown | unknown | unreviewed beyond relevant auth races |

## 15. Nested scoped-transaction analysis

| Question | Result | Evidence / consequence |
|---|---|---|
| Do nested calls join the same manager? | Yes | `withScopedDb` returns `fn(activeManager)` when an ambient manager exists. Nested services do not commit independently. |
| Is inner identity compared with outer identity? | No | No comparison of effective user, real user, bypass, or preserve-timestamps context was found. |
| Can inner system context change active PostgreSQL GUCs? | No | It changes AsyncLocalStorage request context, but the already-open transaction retains the GUCs set at its start. |
| Can inner user context de-escalate a system transaction? | Not at the DB GUC layer | The inner call joins the system transaction unless deliberately escaped. |
| Can preserve-timestamps change after transaction start? | Not effectively | A nested context flag does not re-run GUC setup on the active manager. |
| Can nested calls commit independently? | No, normally | They share the outer transaction. `runOutsideActiveScopedManager` is an explicit escape used for job progress/heartbeat. |
| Does a propagated inner error roll back the outer transaction? | Yes | The top-level callback throws and the query runner rolls back. |
| Can an outer caller catch an inner error and continue? | Yes at the JavaScript level | Whether PostgreSQL remains usable depends on whether the inner operation put the transaction in an aborted state. No policy prevents unsafe continuation. No production exploit path was confirmed. |
| Can external effects occur before outer commit? | Yes | Local/S3 attachment save/delete occurs inside the callback but outside PostgreSQL atomicity. |
| Can request context diverge from transaction context? | Yes in principle | Context can be changed while the ambient manager/GUCs remain from the outer transaction. This is DR-04-01. |
| Does pool cleanup occur in `finally`? | Yes | The query runner is released after commit/rollback paths. Real pool-reuse tests after faults were not located. |

### Required nested tests and status

| Test | Located? | Result |
|---|---|---|
| same-user nested call | yes, ordinary nesting coverage | manager reuse covered |
| changed effective user | no | confirmed missing |
| changed real user | no | confirmed missing |
| user → system | no | confirmed missing |
| system → user | no | confirmed missing |
| preserve-timestamps change | no | confirmed missing |
| inner throw caught by outer | no real DB case located | missing |
| inner throw propagated | partial unit coverage | rollback structure covered, not full pool behavior |
| pool reuse after rollback | no real pool test located | missing |
| pool reuse after uncaught exception | no | missing |

## 16. Required concurrency and failure-scenario disposition

No scenario was executed. “Confirmed” below means the static failure follows from the fixed code/schema/deployment model; “rejected” means the proposed failure did not survive static verification.

| # | Scenario | Static disposition | Finding / note |
|---:|---|---|---|
| 1 | Two simultaneous `.mny` starts, same user and staged file | confirmed | P4-001 |
| 2 | Two simultaneous `.mny` starts, one user and two staged files | confirmed when both staged rows exist; current intended key remains per user | P4-001 |
| 3 | Two users start imports concurrently | no shared uniqueness required; user-scoped jobs should both succeed | no material issue found |
| 4 | Two workers claim one job | rejected as a duplicate-claim defect | conditional `pending → running` update and integration test protect one row |
| 5 | Reaper races a fresh heartbeat | rejected for a heartbeat committed before the reaper predicate is evaluated | conditional stale predicate; terminal-state ownership remains weak |
| 6 | Reaper races final import commit/completion | state anomaly confirmed | P4-002: data commit is separate and `complete()` lacks state/lease CAS |
| 7 | Staged expiry races job start | confirmed | P4-016 |
| 8 | Retry after worker crash | confirmed unsafe after data commit | P4-002 |
| 9 | Concurrent ordinary transaction creates against one account | atomic increments serialize; no lost update between two deltas | P4-005 applies only when a recompute participates |
| 10 | Concurrent updates of one transaction | confirmed | P4-003 |
| 11 | Concurrent transfer creation/update | duplicate creates need an idempotency key; stale update corruption confirmed | P4-003; scheduled duplicate P4-004 |
| 12 | Scheduled post versus manual post | confirmed duplicate occurrence | P4-004 |
| 13 | Scheduled post versus delete/edit | confirmed lack of occurrence claim/version; exact winner varies | P4-004 |
| 14 | Two scheduler replicas select one due item | confirmed | P4-004 |
| 15 | Manual automatic-backup run versus cron | overlap confirmed, but root belongs to prior findings | strengthens P3-001/P3-004 |
| 16 | Two replicas write the same backup | overlap confirmed, prior root | strengthens P3-001/P3-004 |
| 17 | Retention races active write/promotion | possible under current ordering; prior root | strengthens P3-004 |
| 18 | Local/S3 upload succeeds but DB commit fails | confirmed orphan possibility | P4-010 |
| 19 | DB metadata commits but external object write fails | not the create ordering at this baseline; provider write occurs before commit and throws into rollback | rejected for upload; other lifecycle failures remain P4-010 |
| 20 | External delete succeeds but DB rollback occurs | confirmed broken metadata-to-object reference | P4-010 |
| 21 | Export runs while parent/child records change | confirmed table reads can observe different commits | independent confirmation of P3-007 |
| 22 | Two backend processes run init/migrate | confirmed rollout race; no persistent corruption established | independent confirmation of P3-016 LOW |
| 23 | Two simultaneous refreshes use the same token | rejected as a double-rotation defect | pessimistic row lock; second sees revoked token |
| 24 | Logout races token refresh | confirmed | P4-011 |
| 25 | Nested scoped call changes identity | abstract capability confirmed; production path not established | DR-04-01 |
| 26 | Pool reuse after rollback/exception | cleanup structure present; dynamic behavior unverified | missing real-DB tests |
| 27 | Global currency cleanup races activation by another user | no distinct new root established | P3-015 remains canonical |
| 28 | Account/holding rebuild races interactive writes | confirmed | P4-005 and P4-006 |

## 17. Phase 1–3 verification and disposition

| Prior item | Phase 4 disposition | Count treatment |
|---|---|---|
| P1-001 — concurrent `.mny` starts create independent jobs | independently verified through controller, service, job, migration, mapper, and tests; correct current uniqueness key is `user_id` for active statuses | represented as P4-001 for this phase; final Phase 8 must deduplicate the shared root |
| P3-001 — automatic backups share cross-tenant filename/retention namespace | manual/cron/two-replica overlap strengthens impact | not counted again |
| P3-002 — restore remaps external attachment metadata without bytes | no duplicate restore finding; P4-010 concerns ordinary upload/delete/cascade compensation | P4-010 is a distinct lifecycle root |
| P3-003 — linked-loan restore ordering | no additional reciprocal-link concurrency defect confirmed | not counted |
| P3-004 — backup writes are not crash-atomic | concurrent writer/promotion/retention overlap strengthens recovery risk | not counted again |
| P3-007 — backup export lacks one DB snapshot | independently confirmed: helper queries use separate scoped transactions | not counted again |
| P3-015 — currency cleanup uses tenant-filtered evidence globally | no distinct activation/delete race proven beyond prior root | not counted |
| P3-016 — init/migrations not serialized | independently confirmed through entrypoint, runner, and Helm replicas | not counted again; prior LOW retained |
| Phase 3 DR-006 — external operations not coupled to DB | concretized for local/S3 attachment create/delete/cascade | P4-010 counted as distinct confirmed defect |
| Phase 3 DR-012 — crafted foreign keys may survive remapping | no service-level stale-validation race established | remains design risk/hypothesis |
| Phase 2 DR-01 — nested identity mismatch | implementation possibility confirmed; no realistic production switch path found | DR-04-01, not a defect |

## 18. Contradictions and supersession register

| Topic | Prior/documented position | Phase 4 evidence | Disposition |
|---|---|---|---|
| `.mny` active import | service intends one active import per user | check and insert are separate; no DB uniqueness | P1-001 independently confirmed as P4-001 |
| `.mny` retry | comment states rollback means retry cannot double-import | data transaction commits before finalization/job completion | documentation contradicted; P4-002 |
| attachment atomicity | service comment says metadata and bytes commit together | only database provider shares transaction; local/S3 do not | documentation narrowed; P4-010 |
| emergency claim locking | comment says revalidation occurs under lock | no lock or CAS in transaction | comment contradicted; P4-007 |
| failed-login increment | comment says atomic | absolute value derived from stale entity | comment contradicted; P4-012 |
| all every-replica crons are defective | previously rejected overgeneralization | several jobs are idempotent or constrained; only concrete effects counted | prior rejection preserved |
| budget-period duplicate creation | initial candidate based on multi-replica check/create | schema has `UNIQUE(budget_id, period_start)` | candidate disproved and removed |
| two workers claim one import job | potential generic job race | conditional status update and integration test show one winner | rejected false positive preserved |
| account close versus every new transaction | initial broad candidate | account FK insertion can indirectly serialize a new child; existing-row mutation still races | narrowed to P4-008; broad form rejected |
| migration numeric prefixes | prior rejected collision theory | runner tracks full filename; no new contrary evidence | rejection preserved |

## 19. False positives investigated and rejected

1. **Every-replica cron execution is automatically defective.** Rejected. Token purge and ordinary predicate deletes are idempotent; budget-period uniqueness blocks duplicate rows. Findings require a demonstrated duplicate financial, persistent, or external effect.
2. **Two workers can both claim one `pending` `.mny` job.** Rejected. The conditional update has one winner, and the integration suite explicitly races this case on PostgreSQL.
3. **A fresh heartbeat is necessarily overwritten by the reaper.** Rejected for an already committed heartbeat because the reaper update includes state/time predicates. Late completion and lease ownership remain weak under P4-002.
4. **Two ordinary transaction creates lose one account increment.** Rejected. SQL arithmetic serializes two deltas. The confirmed balance issue requires a stale delta or absolute recomputation.
5. **The database attachment provider has the same external atomicity failure as local/S3.** Rejected. Its blob operation joins the ambient database transaction.
6. **Concurrent budget-period creation produces duplicate rows.** Rejected. `UNIQUE(budget_id, period_start)` prevents duplicate persistence, although a loser may log an error.
7. **Two simultaneous refreshes both rotate the same refresh token.** Rejected. The token row is pessimistically locked; the second request observes revoked/reuse state.
8. **Any new transaction can always race account closure into a closed non-zero account.** Rejected as overbroad because a new child insert can hold a foreign-key row lock. P4-008 is limited to mutations of existing ledger rows that do not acquire that parent-key protection.
9. **Backup overlap is a new Phase 4 root cause.** Rejected as duplicate counting. It strengthens P3-001/P3-004.
10. **Migration filename numeric-prefix duplication collides under the current runner.** Not reopened; full filename is the tracker key.
11. **A failed restore partially commits merely because deletion occurs first.** Not reopened; the database restore transaction remains the relevant atomic unit.
12. **Normal timestamp-preservation GUC state leaks after a completed transaction.** No new evidence; not reopened.
13. **The presence of RLS enablement proves runtime enforcement.** Not used as an assumption.
14. **Missing CI status proves CI failed.** Rejected. No status/run was returned for the SHA, which is an evidence limitation only.
15. **System context automatically leaks all tenants.** Rejected as a generic claim; findings require the exact query and intended scope.
16. **MNY job updates by ID are automatically cross-tenant.** Not reported; RLS/context and caller paths were considered separately. State-CAS weaknesses are reported without asserting cross-tenant access.
17. **All `ON CONFLICT DO NOTHING` restore behavior is corrupting.** Not reopened.
18. **Any foreign UUID in a crafted backup definitely crosses ownership.** Not reopened without executable confirmation.

## 20. Areas reviewed without a material new finding

The ledger supports only the following bounded statements:

- ordinary current-dated transaction creates use atomic SQL balance increments and do not lose updates solely because two deltas run concurrently;
- transfer creation keeps both ledger legs and both balance mutations in one database transaction;
- one `.mny` job row has an atomic single-winner claim;
- refresh-token rotation for two simultaneous uses of the same token uses a pessimistic row lock;
- the database attachment provider keeps metadata and BYTEA in PostgreSQL and shares rollback;
- budget-period duplicate rows are blocked by the schema uniqueness constraint;
- refresh-token purge and similar predicate deletes showed no material duplicate side effect from multiple replicas;
- top-level `withScopedDb` has commit/rollback/release structure, and normal nested calls do not independently commit;
- backup export non-snapshot behavior, backup overlap, and migration startup overlap were confirmed but remain canonical prior-phase items rather than duplicate Phase 4 findings.

These statements do not claim complete subsystem safety.

## 21. Reviewed scope

### 21.1 Directories inspected

- repository root instructions and deployment files;
- `.claude/` auxiliary guidance;
- `.github/workflows/` CI definition;
- `backend/src/common/db/` and request context;
- `backend/src/transactions/`;
- `backend/src/accounts/`;
- `backend/src/securities/`;
- `backend/src/scheduled-transactions/`;
- `backend/src/import/` and `backend/src/import/mny/`;
- `backend/src/attachments/`;
- `backend/src/backup/`;
- `backend/src/auth/`;
- `backend/src/emergency-access/`;
- `backend/src/budgets/`;
- `backend/src/ai/insights/`;
- `backend/src/notifications/`;
- `backend/src/database/`;
- `database/` schema and relevant migrations;
- `docs/` files relevant to cron, migrations, imports, backup, RLS, and development;
- `helm/` values, README, and backend StatefulSet template.

### 21.2 Files inspected in full or in complete contiguous chunks

The following were read in full, or in sequential chunks covering the full file where connector response limits required multiple reads:

- `CLAUDE.md`
- `backend/CLAUDE.md`
- `database/CLAUDE.md`
- `frontend/CLAUDE.md`
- `backend/src/mcp/CLAUDE.md`
- `.claude/settings.json`
- `.claude/skills/backend.md`
- `.claude/skills/infrastructure.md`
- `CONTRIBUTING.md`
- `SECURITY.md`
- `README.md`
- `docs/cron-jobs.md`
- `docs/database-migrations.md`
- `docs/import-ms-money.md`
- `backend/src/import/mny/README.md`
- `docs/support-backup.md`
- `docs/future-plans/row-level-security.md`
- `docs/future-plans/row-level-security-runbook.md`
- `docker-compose.dev.yml`
- `docker-compose.prod.yml`
- `backend/docker-entrypoint.sh`
- `backend/Dockerfile`
- `helm/README.md`
- `helm/values.yaml`
- `helm/templates/statefulset-backend.yaml`
- `.github/workflows/ci.yml`
- `backend/package.json`
- `backend/src/common/db/scoped-db.ts`
- `backend/src/common/db/with-context.ts`
- `backend/src/common/request-context.ts`
- `backend/src/import/mny/mny-import.controller.ts`
- `backend/src/import/mny/mny-import.service.ts`
- `backend/src/import/mny/mny-import-job.service.ts`
- `backend/src/import/mny/mny-staging.service.ts`
- `backend/src/import/mny/entities/import-job.entity.ts`
- `backend/src/import/mny/model/mny-import-job.ts`
- `backend/src/import/mny/map/map-transactions.ts`
- `backend/src/import/mny/writers/write-transactions.ts`
- `database/migrations/117_mny_import_staging_and_jobs.sql`
- `backend/src/import/import-post-processing.service.ts`
- `backend/src/attachments/attachments.service.ts`
- `backend/src/attachments/storage/database-storage.provider.ts`
- `backend/src/attachments/storage/local-storage.provider.ts`
- `backend/src/attachments/storage/s3-storage.provider.ts`
- `database/migrations/109_transaction_attachments.sql`
- `backend/src/auth/token.service.ts`
- `backend/src/emergency-access/emergency-access-claim.controller.ts`
- `backend/src/emergency-access/emergency-access-monitor.service.ts`
- `backend/src/notifications/bill-reminder.service.ts`
- `backend/src/accounts/mortgage-reminder.service.ts`
- `backend/src/db-init.ts`
- `backend/src/db-migrate.ts`

### 21.3 Large files sampled in material ranges

- `backend/src/transactions/transactions.service.ts`
- `backend/src/transactions/transaction-transfer.service.ts`
- `backend/src/transactions/transaction-split.service.ts`
- `backend/src/transactions/transaction-bulk-update.service.ts`
- `backend/src/transactions/transaction-reconciliation.service.ts`
- `backend/src/accounts/accounts.service.ts`
- `backend/src/securities/investment-transactions.service.ts`
- `backend/src/securities/holdings.service.ts`
- `backend/src/scheduled-transactions/scheduled-transactions.service.ts`
- `backend/src/backup/backup.service.ts`
- `backend/src/backup/auto-backup.service.ts`
- `backend/src/budgets/budget-alert.service.ts`
- `backend/src/budgets/budget-period.service.ts`
- `backend/src/budgets/budget-period-cron.service.ts`
- `backend/src/ai/insights/ai-insights.service.ts`
- `backend/src/auth/auth.service.ts`
- `backend/src/currencies/currencies.service.ts`
- `backend/src/database/demo-reset.service.ts`
- `database/schema.sql`

### 21.4 Tests inspected

- `backend/src/common/db/scoped-db.spec.ts`
- `backend/src/common/db/with-context.spec.ts`
- `backend/src/transactions/transactions.service.spec.ts`
- `backend/src/transactions/transaction-transfer.service.spec.ts`
- `backend/src/transactions/transaction-split.service.spec.ts`
- `backend/src/securities/holdings.service.spec.ts`
- `backend/src/import/mny/mny-import-job.service.spec.ts`
- `backend/src/import/mny/mny-import.service.spec.ts`
- `backend/test/integration/mny-import-job.integration.spec.ts`
- `backend/src/scheduled-transactions/scheduled-transactions.service.spec.ts`
- `backend/src/attachments/attachments.service.spec.ts`
- `backend/src/auth/token.service.spec.ts`
- `backend/src/budgets/budget-period.service.spec.ts`
- `backend/src/budgets/budget-alert.service.spec.ts`
- `backend/src/ai/insights/ai-insights.service.spec.ts`
- `backend/src/emergency-access/emergency-access-claim.controller.spec.ts`
- `backend/src/emergency-access/emergency-access-monitor.service.spec.ts`

## 22. Unreviewed or inaccessible scope

### 22.1 Connector and environment limitations

- DNS restrictions prevented cloning the repository.
- The GitHub connector did not expose a recursive immutable tree for the baseline.
- Search results can be capped/truncated and can link to the current branch rather than the baseline.
- Search absence could not prove repository-wide file absence.
- CI combined status and workflow-run queries returned no result for the baseline SHA; no conclusion about CI success or failure is drawn.
- CI logs, artifacts, service containers, runtime configuration, production data, database statistics, object-store buckets, backup volumes, SMTP delivery, and provider responses were inaccessible.
- No dynamic PostgreSQL lock behavior or filesystem semantics were reproduced in this environment.

### 22.2 Areas not exhaustively reviewed

- every controller/DTO/frontend adapter for all listed workflows;
- every MCP tool that can invoke transaction mutation;
- every loan, mortgage, budget, net-worth, report, simulation, and tax formula—financial arithmetic is assigned to Phase 5;
- all OAuth/OIDC provider revocation and trusted-device paths;
- every price/exchange-rate provider implementation and cache write;
- every backup restore table and mapping rule, already primarily covered in Phase 3;
- all Helm templates and every deployment override;
- every migration file;
- all tests matching potentially truncated search results;
- production database role and actual RLS enforcement state, covered primarily in Phase 2.

## 23. Audit ledger

| Ledger field | Recorded value |
|---|---|
| Audit phase | Phase 4 |
| Worker-chat name | Phase 4 worker chat — Backend Transactions, Concurrency, Background Jobs, and Data Integrity |
| Audited SHA | `d5cea9bfa995885ba5198f9843359362927c0fd4` |
| Assigned scope | backend transactions, concurrency, jobs, cron, external effects, derived financial state, relevant auth races |
| Repository instruction hierarchy | project instructions → root `CLAUDE.md` → nearest scoped `CLAUDE.md` → auxiliary guidance |
| Directories inspected | listed in Section 21.1 |
| Files inspected in full | listed in Section 21.2 |
| Files sampled | listed in Section 21.3 |
| Inaccessible resources | recursive immutable tree, clone, runtime DB, CI logs/artifacts, object stores, SMTP/providers |
| Capped/truncated searches | multiple GitHub code searches, including `@Cron`, `current_balance`, `AGENTS.md`, tests, and schema path discovery |
| Commands/checks examined | SHA-pinned connector fetches; code search for discovery; commit status/workflow-run queries; no local repository commands |
| Tests/CI examined | tests in Section 21.4; `.github/workflows/ci.yml`; `backend/package.json` scripts |
| Tests actually executed | none |
| Runtime scenarios executed | none |
| Transaction inventory | Section 10 |
| Balance-mutator ledger | Section 11 |
| Job-state ledger | Section 12 |
| Multi-replica matrix | Section 13 |
| External-side-effect matrix | Section 14 |
| Confirmed findings | 18: 7 HIGH, 7 MEDIUM, 4 LOW |
| Design risks | 8 recorded in Section 7 |
| Missing tests | Section 8 |
| Documentation issues | 7 recorded in Section 9 |
| Open hypotheses | provider refresh duplication, restore/write maintenance exclusion, additional balance mutators, update-check behavior |
| False positives rejected | Section 19 |
| Areas without material finding | Section 20 |
| Dependencies on Phases 1–3 | Section 17 |
| Contradictions/supersession | Section 18 |
| Report filename | `monize-audit-04-backend-concurrency.md` |
| Completion status | complete under static-read limitations |
| Next required action | Phase 5 financial-correctness audit at the same SHA |

---

## 24. Handoff to Phase 5 — Financial Correctness

### 24.1 Immutable baseline and report requirement

Phase 5 must audit exactly:

```text
AUDIT_BASELINE_SHA=d5cea9bfa995885ba5198f9843359362927c0fd4
```

It must not resolve `main` again. Its required deliverable is:

```text
monize-audit-05-financial-correctness.md
```

Every financial finding must include:

- input values;
- result produced by the implementation;
- expected result;
- monetary or percentage difference.

### 24.2 Financial data model and mutation paths to preserve

Phase 5 must independently inspect these exact paths and their callers:

#### Core cash ledger and balances

- `backend/src/transactions/transactions.service.ts`
- `backend/src/transactions/transaction-transfer.service.ts`
- `backend/src/transactions/transaction-split.service.ts`
- `backend/src/transactions/transaction-reconciliation.service.ts`
- `backend/src/transactions/transaction-bulk-update.service.ts`
- `backend/src/transactions/entities/transaction.entity.ts`
- `backend/src/accounts/accounts.service.ts`
- `backend/src/accounts/entities/account.entity.ts`
- `backend/src/import/import-post-processing.service.ts`
- `database/schema.sql`

At this baseline, schema comments and service behavior use signed amounts:

- positive amount: income/deposit into the account;
- negative amount: expense/outflow;
- account balance is intended to be opening balance plus included non-void parent transactions up to the applicable date;
- transfer source and destination use opposite signs;
- a transfer split creates a counterpart with `amount = -split.amount`;
- future-dated and `VOID` transactions are excluded from current-balance recomputation.

Phase 5 must verify these conventions in every path rather than assuming comments are correct.

#### Foreign currency

Inspect:

- `originalAmount`;
- `originalCurrencyCode`;
- `exchangeRate`;
- account-currency amount derivation;
- transfer source/destination conversion;
- scheduled transfer/investment conversion;
- import mapping and restore behavior;
- exchange-rate lookup/backfill and stale/missing-rate behavior.

Known path: `TransactionsService.normalizeFxEntry` requires original amount/code together, requires a positive rate for foreign entry, and enforces matching signs. Phase 5 must verify whether every producer and consumer uses the same “account-currency units per one original-currency unit” convention.

Relevant files include:

- `backend/src/transactions/transactions.service.ts`
- `backend/src/transactions/transaction-transfer.service.ts`
- `backend/src/currencies/exchange-rate.service.ts`
- `backend/src/import/import-post-processing.service.ts`
- `backend/src/import/mny/map/`
- `backend/src/import/mny/writers/`
- backup export/restore currency fields and migrations.

#### Splits

Verify:

- signed split sum versus parent amount;
- magnitude checks and rounding tolerance;
- category, transfer, and investment split behavior;
- counterpart signs;
- parent amount changes after split creation;
- tag junction behavior;
- full replacement versus incremental add/remove;
- null category versus absent category;
- P4-009’s aggregate race and whether the serial arithmetic itself is correct.

#### Investments and holdings

Inspect:

- `backend/src/securities/investment-transactions.service.ts`
- `backend/src/securities/holdings.service.ts`
- `backend/src/securities/entities/holding.entity.ts`
- `backend/src/securities/security-price.service.ts`
- investment DTOs/entities and scheduled-investment paths;
- embedded investment splits;
- MNY investment mapping/writers.

Preserve and verify action semantics for:

- `BUY`;
- `SELL`;
- `REINVEST`;
- `DIVIDEND`;
- `INTEREST`;
- `CAPITAL_GAIN`;
- `SPLIT`;
- `TRANSFER_IN` / `TRANSFER_OUT`;
- `ADD_SHARES` / `REMOVE_SHARES`.

Phase 5 must check:

- quantity direction;
- cash direction;
- average-cost and cost-basis formulas;
- commission and fee inclusion;
- tax basis;
- funding-account transfers;
- zero quantity/price handling;
- missing security or stale price handling;
- close versus adjusted-close usage;
- imported versus replayed holding quantities;
- P4-006’s lost-update example and whether rebuild arithmetic is correct when run serially.

#### Prices and valuation

Inspect security price storage and every valuation consumer for:

- `close_price` versus `adjusted_close`;
- manual, transaction-derived, Yahoo/MSN, and stale price precedence;
- quoted-at/date/timezone handling;
- missing price represented as `null`, zero, absent row, or stale row;
- percentage and currency conversion order;
- net-worth fallback behavior.

Relevant paths include:

- `backend/src/securities/security-price.service.ts`
- `backend/src/securities/entities/`
- `backend/src/net-worth/net-worth.service.ts`
- dashboards/reports and simulation services discovered at the baseline.

#### Scheduled posting

Inspect serial arithmetic and override precedence in:

- `backend/src/scheduled-transactions/scheduled-transactions.service.ts`
- scheduled split, transfer, investment, and loan helpers;
- scheduled override entity/schema;
- front-end/API types if they alter null/zero semantics.

P4-004 proves duplicate occurrences are possible. Phase 5 must separately verify the amount, sign, commission, split, date, and currency produced by one correctly serialized occurrence.

#### Imports

Inspect:

- QIF/OFX/CSV import services and mappers;
- `.mny` parser, mapping, writers, verification, and warning aggregation;
- opening balances, future transactions, void rows, transfers, lots, prices, exchange rates, and skipped rows;
- post-import absolute balance calculation;
- source values represented as unknown versus zero.

P4-001 and P4-002 show that correct serial arithmetic can still be applied twice. Phase 5 must not duplicate those concurrency roots, but must include them when evaluating user-visible financial outcomes.

#### Loans, mortgages, budgets, reports, and simulations

Locate and inspect the exact baseline files for:

- loan principal/interest/overpayment split calculation;
- mortgage payment and renewal fields;
- scheduled-loan split recalculation;
- budget actuals, income-linked budgets, flex groups, carryover, and period boundaries;
- net worth and monthly balances;
- Monte Carlo and other simulations;
- tax/commission calculations;
- percentage denominators and divide-by-zero behavior.

No complete arithmetic conclusion was reached for these subsystems in Phase 4.

### 24.3 Concurrency findings that directly affect financial outputs

Phase 5 must preserve these exact numerical examples and avoid counting the same root twice:

1. **P4-001 duplicate import:** one `-100.00` source transaction can be imported twice; produced `-200.00`, expected `-100.00`, difference `-100.00`.
2. **P4-002 retry after commit:** one `-25.00` source transaction can be replayed; produced `-50.00`, expected `-25.00`, difference `-25.00`.
3. **P4-003 stale update:** opening `100.00`, final ledger row `-30.00`; produced balance `60.00`, expected `70.00`, difference `-10.00`.
4. **P4-003 double delete:** opening `100.00`, removed `-10.00` row; produced `110.00`, expected `100.00`, difference `+10.00`.
5. **P4-004 duplicate scheduled expense:** opening `100.00`, one due `-50.00`; produced `0.00`, expected `50.00`, difference `-50.00`.
6. **P4-005 stale recomputation:** recompute reads `100.00`, concurrent `-20.00` commits; produced `100.00`, expected `80.00`, difference `+20.00`.
7. **P4-006 holdings lost update:** starting 10 shares at `$100`, concurrent buys of 1 and 2; produced 12 shares / `$1,200`, expected 13 / `$1,300`, difference `-1` share and `-$100` (`-7.69%`).
8. **P4-008 close/unvoid:** closed account produced at `-10.00`, expected closed balance `0.00` or rejected close, difference `-10.00`.
9. **P4-009 split overflow:** parent `-100.00`, existing `-60.00`, two `-30.00` additions; produced `-120.00`, expected maximum `-100.00`, difference `-20.00`.

### 24.4 Missing financial regression tests to carry forward

Phase 5 should require serial and concurrent tests for:

- sign conventions across create/update/delete/VOID;
- same-currency and foreign-currency entry;
- transfer conversion and rounding;
- split sum and rounding at four decimals;
- investment action cash/quantity/cost basis including commission;
- adjusted versus unadjusted prices;
- null/zero/absent/stale rates and prices;
- scheduled overrides with zero versus absent values;
- import verification tolerances;
- loan principal/interest rounding;
- budget period and percentage boundaries;
- net-worth valuation with missing prices;
- simulation incomplete coverage;
- all nine concurrency examples above.

### 24.5 Prior findings Phase 5 must independently verify or consume

- consume P4-001 through P4-006, P4-008, and P4-009 as concurrency preconditions, without duplicating roots;
- independently verify serial arithmetic in the same paths;
- retain P3 custom-currency backup and support-backup findings when evaluating portability/de-identification;
- retain P3 non-snapshot export when evaluating whether a backup can contain financially incompatible parent/child states;
- retain P3 linked-loan restore ordering;
- do not reopen rejected claims about duplicate migration prefixes, automatic cron defectiveness, restore partial commit solely from delete-first order, or arbitrary crafted foreign IDs without executable evidence.

### 24.6 Evidence limitations for Phase 5

Phase 4 used static SHA-pinned reads only. Phase 5 should state separately whether it can execute arithmetic tests or PostgreSQL integration cases. Connector search is not a complete immutable tree, so newly discovered files must be re-fetched from the same SHA before they are cited.

---

## 25. Final Phase 4 conclusion

The backend has a sound local pattern for grouping many ordinary multi-table writes with `withScopedDb`, and several targeted protections—atomic balance increments, a single-row import claim, refresh-token row locking, and database-provider attachment atomicity—are real. The principal weakness is not the absence of transactions everywhere; it is the absence of a **shared concurrency protocol across transactions**. Pre-transaction snapshots, absolute recomputation, process-local cron guards, and post-commit external or bookkeeping effects interact in ways that ordinary retries and supported multi-replica deployment can expose.

The immediate remediation priority is:

1. enforce `.mny` active-job uniqueness and durable import commit/idempotency state;
2. lock/version ledger rows before deriving balance deltas;
3. introduce scheduled-occurrence idempotency and one transactional posting workflow;
4. serialize all balance recomputation and holding mutation by account/holding key;
5. make emergency claim consumption a single conditional database transition;
6. adopt durable outbox/lifecycle patterns for external objects and notifications;
7. standardize database-backed leases for multi-replica cron work;
8. add real two-connection and two-instance integration tests for every confirmed interleaving.
