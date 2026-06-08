# Backend OOM on large transaction import / delete

Status: investigation + repro only (no fix applied).
Branch: `investigate/transaction-memory`.

## Summary

Importing (or, less likely, deleting) more than ~1000 transactions can drive
the NestJS backend toward an out-of-memory condition. A memory-profiling repro
has been added at:

- `backend/test/integration/transaction-memory.integration.spec.ts`

It exercises the real import and delete code paths against `monize_test` using
synthetic QIF data, sampling `process.memoryUsage()` and logging a table of
duration / peak RSS / peak heapUsed / before->after delta for both the import
and delete phases. It could not be executed in the investigation sandbox
(no Postgres reachable on `localhost:5432`); run it against your dev/test
Postgres (see "How to run").

## Code paths

### Import (the suspected culprit)

`backend/src/import/import.service.ts`

- `importQifFile` (line 106) -> `importParsedTransactions` (line 1126).
- The ENTIRE import runs inside ONE transaction:
  `queryRunner.startTransaction()` at line 1185, `commitTransaction()` at
  line 1308.
- The per-row loop is lines 1275-1306. For every row it issues
  `SAVEPOINT tx_import_N` (line 1279), processes the row, then
  `RELEASE SAVEPOINT` (line 1286). On error it `ROLLBACK TO SAVEPOINT`.
- Each row is processed by `ImportRegularProcessorService.processTransaction`
  (`backend/src/import/import-regular-processor.service.ts:19`), which for a
  plain bank row does: `resolvePayee` (findOne; creates+saves a Payee if new),
  `queryRunner.manager.create(Transaction)` + `save`, then
  `updateAccountBalance` (`import-context.ts:28`: a `findOne(Account)` +
  `update(Account)` per row).

The same one-giant-transaction + per-row-savepoint pattern also exists in
`importQifMultiAccountFile` (transaction lines 208->447, savepoint loop
lines 403-434).

### Delete

`backend/src/transactions/transaction-bulk-update.service.ts`

- `bulkDelete` (line 180). Selects only the columns it needs
  (lines 190-205), computes balance adjustments in memory, then issues bulk
  `DELETE ... WHERE id IN (:...ids)` statements (lines 283-300) inside one
  transaction. It does NOT loop per row and does NOT create per-row entities.
- Static reading suggests this is relatively lean; the repro measures it to
  confirm/refute. The main concern is a single very large `IN (...)` list and
  loading all matched rows (with `leftJoinAndSelect` on splits) into memory at
  once (lines 190-205).

## Most likely root cause(s), with evidence

1. One unbounded transaction with an ever-growing identity map (import).
   - The whole import is a single TypeORM transaction
     (`import.service.ts:1185` .. `:1308`). Every `queryRunner.manager.create`
     / `save` / `findOne` runs through the same `EntityManager`, whose
     persistence/identity context lives for the entire transaction. For N rows
     this retains references to N (or 2N for transfers) Transaction entities,
     plus Payee/Split/Account entities, with nothing released until commit.
     Memory therefore grows roughly linearly with N and is only reclaimed at
     the very end. This is the classic "import everything in one EM/transaction"
     leak signature.

2. Thousands of named SAVEPOINTs in a single PG transaction.
   - `import.service.ts:1279` creates `SAVEPOINT tx_import_N` per row. Although
     each is RELEASEd immediately on success (line 1286), a single Postgres
     transaction that opens this many subtransactions accumulates server-side
     subtransaction state (and can spill the local subxid cache, hurting
     performance). This is more a DB/performance concern than a Node-heap OOM,
     but it compounds the long-lived-transaction problem.

3. Per-row read-modify-write of the account balance.
   - `updateAccountBalance` (`import-context.ts:33`) does a `findOne(Account)`
     plus `update(Account)` for EVERY imported row, all on the same manager
     inside the one transaction. N extra Account reads/writes that also accrete
     in the unit of work.

4. Delete: large in-memory row set + giant IN-list (to be confirmed by repro).
   - `bulkDelete` loads every matched transaction (and its splits via
     `leftJoinAndSelect`) into memory before deleting
     (`transaction-bulk-update.service.ts:190-205`), and builds a single
     `id IN (:...ids)` clause. For very large N this is a large array + a large
     SQL parameter list. Expected to be far lighter than import; the repro's
     delete-phase numbers will show whether memory grows materially here.

The repro distinguishes these: if heapUsed grows ~linearly with N during the
import phase and is released after commit, that confirms cause #1/#3. If the
delete phase stays flat, it confirms the delete path is not the OOM source.

## How to run

From `backend/` (their docker-compose provides Postgres on localhost:5432,
user `monize_user` / `monize_password`; `pretest:integration` auto-creates the
`monize_test` DB):

```bash
# default N = 2000
npm run test:integration -- --testPathPatterns='transaction-memory'

# vary N to see the growth curve
REPRO_TX_COUNT=250  npm run test:integration -- --testPathPatterns='transaction-memory'
REPRO_TX_COUNT=1000 npm run test:integration -- --testPathPatterns='transaction-memory'
REPRO_TX_COUNT=2000 npm run test:integration -- --testPathPatterns='transaction-memory'

# more accurate baselines (force GC before sampling) and optional heap snapshot
REPRO_HEAP_SNAPSHOT=1 node --expose-gc node_modules/.bin/jest \
  --config ./test/jest-e2e.json \
  --testPathPatterns='transaction-memory' --runInBand
```

Compare `heapUsed_peak`/`rss_peak` and `per_tx_heap_peak` across N. Linear (or
worse) growth in the IMPORT phase, with a flat DELETE phase, is the OOM
signature pointing at the import transaction.

## Recommended fixes (NOT yet implemented)

- Batch the import into chunks (e.g. 200-500 rows) with a commit per chunk,
  instead of one transaction for the whole file. This bounds both the TypeORM
  identity map and Postgres subtransaction state. (Accept the tradeoff that a
  mid-import failure leaves earlier chunks committed; surface partial progress
  in `ImportResultDto`, which already tracks `imported`/`errors`.)
- If a single transaction must be kept, periodically clear the unit of work
  between rows/chunks (e.g. `queryRunner.manager.queryRunner` is shared; use a
  fresh manager per chunk, or call `connection.manager`/`EntityManager` reset
  patterns) so persisted entities are not retained for the whole import.
- Avoid per-row SAVEPOINTs: either drop them (let one bad row fail the chunk)
  or batch them (one savepoint per chunk). This removes the thousands of
  subtransactions per import.
- Replace per-row `updateAccountBalance` read-modify-write with a single
  aggregated balance update per affected account at the end (the code already
  does a grouped recompute in `postImportProcessing`,
  `import.service.ts:1646`-`:1694`; the per-row updates are largely redundant
  given that final recompute).
- For delete, if the repro shows pressure: chunk the `id IN (...)` list (e.g.
  1000 ids per DELETE) and avoid `leftJoinAndSelect("transaction.splits")` for
  the whole set at once; fetch splits only for rows that are `isSplit`.

## Constraints honored

No production import/delete logic was modified. The repro uses parameterized
queries via TypeORM, only touches `monize_test`, creates and cleans its own
data, and asserts no tight memory threshold (only a very loose sanity guard).
`npx tsc --noEmit` passes.
