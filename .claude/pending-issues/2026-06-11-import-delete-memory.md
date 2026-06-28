---
repo: kenlasko/monize
title: "[BUG] Backend memory blows up on large transaction import (>~1000 rows)"
labels: ["bug", "performance"]
---

## What's wrong

Importing a large file (more than ~1000 transactions) drives the backend toward
an out-of-memory condition. The whole import runs inside a single database
transaction with a per-row savepoint and a per-row account-balance
read-modify-write, so memory grows roughly linearly with the number of rows and
is only released at commit.

This write-up is from **static analysis of the code, a memory-profiling repro
test, and read-only inspection of the production deployment**. I have not yet
captured the heapUsed-vs-N curve (the repro writes data, so it must run against a
throwaway test DB, not production) — but the production facts below already
explain and corroborate the OOM.

## Production evidence (read-only)

From the live deployment and read-only `SELECT`s against the production DB:

- **The backend container memory limit is just `150Mi`** (request `60Mi`), and the
  pod **idles at ~107Mi** — roughly 40Mi of headroom before the cgroup OOM-kills
  it. No `--max-old-space-size` / `NODE_OPTIONS` is set, so the cgroup limit is
  the binding ceiling (the container is OOM-killed well before any Node heap
  error).
- **The data easily exceeds the trigger threshold:** one account holds **8,393
  transactions** (the whole dataset is on that account). Any operation that walks
  that set in one transaction with a growing identity map — a re-import, a bulk
  delete, etc. — is ~8× past the ~1000-row point where memory starts to balloon,
  against a 40Mi headroom.

So the OOM is the product of **two compounding factors**: the algorithm (below)
*and* an unusually tight 150Mi limit for a NestJS process. Raising the limit is
the cheap mitigation; fixing the algorithm is the real fix. The repro is still
worth running on a test DB to get the exact heapUsed-vs-N slope.

## Code paths (current `main`)

### Import (suspected culprit) — `backend/src/import/import.service.ts`

- `importParsedTransactions` (line 1142) wraps the **entire** import in one
  transaction: `queryRunner.startTransaction()` (1209) … `commitTransaction()`
  (1332).
- The per-row loop issues a named `SAVEPOINT` per row (1303), processes the row,
  then `RELEASE SAVEPOINT` (1310) / `ROLLBACK TO SAVEPOINT` on error (1312).
- Each row is processed by
  `ImportRegularProcessorService.processTransaction` (1308), which for a plain
  bank row does `resolvePayee` (creates+saves a Payee if new),
  `queryRunner.manager.create(Transaction)` + `save`, then `updateAccountBalance`.
- `updateAccountBalance` (`backend/src/import/import-context.ts:33,40`) does a
  `findOne(Account)` **plus** `update(Account)` for **every** imported row.
- The same one-transaction + per-row-savepoint pattern is in the multi-account
  path too (`SAVEPOINT`/`RELEASE`/`ROLLBACK TO` at lines 411–420).

### Delete — `backend/src/transactions/transaction-bulk-update.service.ts`

- `bulkDelete` (188) loads **every** matched transaction with its splits via
  `leftJoinAndSelect("transaction.splits", "splits")` + `getMany()` (210–213)
  into memory, then deletes with a single `id IN (:...ids)` clause. No per-row
  loop and no per-row entity creation, so this is expected to be far lighter than
  import — but a very large in-memory row set + a huge `IN (...)` parameter list
  is the thing to watch. (Suspected secondary, not the primary OOM source.)

## Most likely cause (ranked)

0. **Tight container memory limit (150Mi) with ~107Mi idle usage** — the
   environmental multiplier. Even a modest amount of the linear growth below is
   enough to cross the cgroup limit and trigger an OOM-kill. (See Production
   evidence above.)
1. **One unbounded transaction with an ever-growing TypeORM identity map
   (import).** Every `create`/`save`/`findOne` runs through the same
   `EntityManager`, whose persistence/identity context lives for the whole
   import. For N rows it retains references to N (or 2N for transfers)
   Transaction entities plus Payee/Split/Account entities, with nothing released
   until commit. Memory grows ~linearly with N and is reclaimed only at the end —
   the classic "import everything in one EM/transaction" signature.
2. **Thousands of named SAVEPOINTs in a single PG transaction.** One savepoint
   per row (released immediately on success) still accumulates server-side
   subtransaction state and can spill the subxid cache. More a DB/perf concern
   than a Node-heap OOM, but it compounds #1.
3. **Per-row read-modify-write of the account balance.** A `findOne(Account)` +
   `update(Account)` per row — N extra reads/writes that also accrete in the unit
   of work — and they are largely redundant given the grouped balance recompute
   that already runs in post-import processing.
4. **Delete: large in-memory row set + giant `IN (...)`** (to be confirmed by the
   repro; expected far lighter than import).

## Reproduction

A memory-profiling integration test lives on branch
`investigate/transaction-memory` in my fork:

- Spec: https://github.com/WMP/monize/blob/investigate/transaction-memory/backend/test/integration/transaction-memory.integration.spec.ts
- Diagnosis notes: https://github.com/WMP/monize/blob/investigate/transaction-memory/docs/bugs/transaction-import-delete-memory.md
- Branch: https://github.com/WMP/monize/tree/investigate/transaction-memory

It exercises the real import and delete paths against `monize_test` with
synthetic QIF data, sampling `process.memoryUsage()` and logging
duration / peak RSS / peak heapUsed / before→after delta for each phase. It
touches only `monize_test`, uses parameterized TypeORM queries, and creates/cleans
its own data; no production import/delete logic is modified.

```bash
# from backend/ (docker-compose Postgres on localhost:5432; pretest auto-creates monize_test)
REPRO_TX_COUNT=250  npm run test:integration -- --testPathPatterns='transaction-memory'
REPRO_TX_COUNT=1000 npm run test:integration -- --testPathPatterns='transaction-memory'
REPRO_TX_COUNT=2000 npm run test:integration -- --testPathPatterns='transaction-memory'

# more accurate baselines (force GC before sampling) + optional heap snapshot
REPRO_HEAP_SNAPSHOT=1 node --expose-gc node_modules/.bin/jest \
  --config ./test/jest-e2e.json --testPathPatterns='transaction-memory' --runInBand
```

Linear (or worse) growth in heapUsed during the **import** phase that is released
after commit, with a **flat delete** phase, confirms causes #1/#3.

## Suggested fixes (not implemented)

- **Immediate mitigation: raise the backend memory request/limit.** The current
  `request: 60Mi` / `limit: 150Mi` is unrealistic for a NestJS process that idles
  at ~107Mi. The request should sit around the real idle footprint (~`120Mi`) so
  the scheduler reserves enough, and the limit should be roughly **twice the
  request (~`240Mi`)** to give imports headroom. Optionally also set an explicit
  `--max-old-space-size` consistent with the limit. This buys headroom but does
  not fix the linear growth; pair it with the algorithmic changes below.
- **Chunk the import** into batches (e.g. 200–500 rows) with a commit per chunk
  instead of one transaction for the whole file. Bounds both the identity map and
  the PG subtransaction count. (Tradeoff: a mid-import failure leaves earlier
  chunks committed — `ImportResultDto` already tracks `imported`/`errors` to
  surface partial progress.)
- If a single transaction must stay, **clear the unit of work between chunks**
  (fresh manager per chunk / EM reset) so entities aren't retained for the whole
  import.
- **Drop or batch the per-row SAVEPOINTs** (one savepoint per chunk, or none).
- **Replace per-row `updateAccountBalance`** with a single aggregated balance
  update per affected account at the end (the grouped recompute in post-import
  processing already does this; the per-row updates look redundant).
- **Delete:** if the repro shows pressure, chunk the `id IN (...)` list and avoid
  `leftJoinAndSelect` of splits for the whole set at once (fetch splits only for
  `isSplit` rows).

## Environment

- Backend: NestJS + TypeORM, running in Kubernetes (StatefulSet), container memory
  limit `150Mi` / request `60Mi`, idle ~107Mi, no `--max-old-space-size` set.
- DB: PostgreSQL 17.5 (CloudNativePG). Production dataset ~8,400 transactions,
  with a single account holding all 8,393.
- Analysis against current `main`; line references from `main`.
