/* eslint-disable no-console */
/**
 * Memory-profiling repro for the reported backend OOM when importing (adding)
 * or deleting large batches of transactions (>1000).
 *
 * This test exercises the REAL code paths against the test database
 * (monize_test) using SYNTHETIC data only. It never touches the user's real
 * data. It creates and cleans up its own user/account/transactions.
 *
 * What it measures:
 *  - IMPORT path: ImportService.importQifFile (one giant transaction with a
 *    per-row SAVEPOINT, processing each row via ImportRegularProcessorService
 *    using queryRunner.manager). See src/import/import.service.ts.
 *  - DELETE path: TransactionBulkUpdateService.bulkDelete.
 *
 * Around each path it samples process.memoryUsage() (rss + heapUsed) on a
 * short interval and logs a table of: N, duration, peak rss, peak heapUsed,
 * and before->after delta.
 *
 * Configuration (env):
 *  - REPRO_TX_COUNT   number of transactions to generate (default 2000)
 *  - REPRO_HEAP_SNAPSHOT=1  write a v8 heap snapshot at peak (requires the
 *                           process to allow it; file lands in cwd)
 *
 * Run with (from backend/):
 *   npm run test:integration -- --testPathPatterns='transaction-memory'
 *
 * For more accurate numbers, expose gc so the test can force a collection
 * before sampling baselines:
 *   node --expose-gc node_modules/.bin/jest --config ./test/jest-e2e.json \
 *     --testPathPatterns='transaction-memory' --runInBand
 *
 * This test does NOT assert a hard memory threshold (that would be flaky).
 * It primarily LOGS the numbers. A very loose sanity guard is included.
 */
import { Test, TestingModule } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ConfigModule } from "@nestjs/config";
import { DataSource } from "typeorm";
import * as v8 from "v8";
import { ImportService } from "@/import/import.service";
import { ImportModule } from "@/import/import.module";
import { TransactionBulkUpdateService } from "@/transactions/transaction-bulk-update.service";
import { Transaction } from "@/transactions/entities/transaction.entity";
import { NetWorthService } from "@/net-worth/net-worth.service";
import { HoldingsService } from "@/securities/holdings.service";
import { InvestmentTransactionsService } from "@/securities/investment-transactions.service";
import { ScheduledTransactionsModule } from "@/scheduled-transactions/scheduled-transactions.module";
import { ScheduledTransaction } from "@/scheduled-transactions/entities/scheduled-transaction.entity";
import { ScheduledTransactionSplit } from "@/scheduled-transactions/entities/scheduled-transaction-split.entity";
import { ScheduledTransactionOverride } from "@/scheduled-transactions/entities/scheduled-transaction-override.entity";
import { Account } from "@/accounts/entities/account.entity";
import { ScheduledTransactionsService } from "@/scheduled-transactions/scheduled-transactions.service";
import { ScheduledTransactionOverrideService } from "@/scheduled-transactions/scheduled-transaction-override.service";
import { ScheduledTransactionLoanService } from "@/scheduled-transactions/scheduled-transaction-loan.service";
import { cleanTables, createTestUserDirect } from "../helpers/integration-setup";
import { createTestAccount } from "../helpers/test-factories";

/**
 * Builds the test module for this repro.
 *
 * This mirrors test/helpers/integration-setup.ts#createIntegrationModule
 * (real Postgres, ScheduledTransactionsModule stubbed to break the
 * Transactions <-> Accounts <-> ScheduledTransactions cycle, NetWorth
 * debounced recalc no-op'd) but is inlined here for one extra reason: it
 * also stubs the securities services (HoldingsService,
 * InvestmentTransactionsService) that the repro never uses. Pulling in
 * ImportModule transitively drags SecuritiesModule into the graph through a
 * forwardRef cycle (Securities <-> Transactions <-> Accounts), and resolving
 * those two services from that cycle is order-sensitive and intermittently
 * fails DI. The repro only touches regular bank import + bulkDelete, so
 * stubbing them keeps the module deterministic without affecting what we
 * measure.
 */
async function buildModule(): Promise<TestingModule> {
  const builder = Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      TypeOrmModule.forRoot({
        type: "postgres",
        host: process.env.DATABASE_HOST || "localhost",
        port: parseInt(process.env.DATABASE_PORT || "5432"),
        username: process.env.DATABASE_USER || "monize_user",
        password: process.env.DATABASE_PASSWORD || "monize_password",
        database: process.env.DATABASE_NAME || "monize_test",
        entities: [__dirname + "/../../src/**/*.entity{.ts,.js}"],
        synchronize: true,
        dropSchema: true,
      }),
      ImportModule,
    ],
  })
    .overrideModule(ScheduledTransactionsModule)
    .useModule({
      module: class StubScheduledTransactionsModule {},
      imports: [
        TypeOrmModule.forFeature([
          ScheduledTransaction,
          ScheduledTransactionSplit,
          ScheduledTransactionOverride,
          Account,
        ]),
      ],
      providers: [
        { provide: ScheduledTransactionsService, useValue: {} },
        { provide: ScheduledTransactionOverrideService, useValue: {} },
        { provide: ScheduledTransactionLoanService, useValue: {} },
      ],
      exports: [ScheduledTransactionsService],
    })
    .overrideProvider(HoldingsService)
    .useValue({})
    .overrideProvider(InvestmentTransactionsService)
    .useValue({});

  const module = await builder.compile();

  const netWorthService = module.get(NetWorthService, { strict: false });
  jest
    .spyOn(netWorthService, "triggerDebouncedRecalc")
    .mockImplementation(() => {});

  return module;
}

const TX_COUNT = parseInt(process.env.REPRO_TX_COUNT || "2000", 10);
const WRITE_HEAP_SNAPSHOT = process.env.REPRO_HEAP_SNAPSHOT === "1";

interface MemorySample {
  rss: number;
  heapUsed: number;
}

/**
 * Samples process.memoryUsage() every `intervalMs` while `fn` runs.
 * Returns the result of `fn` plus before/after/peak memory and duration.
 */
async function profile<T>(
  fn: () => Promise<T>,
  intervalMs = 25,
): Promise<{
  result: T;
  durationMs: number;
  before: MemorySample;
  after: MemorySample;
  peak: MemorySample;
}> {
  forceGc();
  const before = sample();
  let peak: MemorySample = { ...before };

  const timer = setInterval(() => {
    const s = sample();
    if (s.rss > peak.rss) peak = { ...peak, rss: s.rss };
    if (s.heapUsed > peak.heapUsed) peak = { ...peak, heapUsed: s.heapUsed };
    if (WRITE_HEAP_SNAPSHOT && s.heapUsed >= peak.heapUsed) {
      // Best-effort: capture at the highest observed point.
      maybeSnapshot();
    }
  }, intervalMs);

  const start = Date.now();
  let result: T;
  try {
    result = await fn();
  } finally {
    clearInterval(timer);
  }
  const durationMs = Date.now() - start;

  // Capture one final sample (loop may have missed the true peak right at end).
  const end = sample();
  if (end.rss > peak.rss) peak = { ...peak, rss: end.rss };
  if (end.heapUsed > peak.heapUsed) peak = { ...peak, heapUsed: end.heapUsed };

  const after = sample();
  return { result, durationMs, before, after, peak };
}

function sample(): MemorySample {
  const m = process.memoryUsage();
  return { rss: m.rss, heapUsed: m.heapUsed };
}

function forceGc(): void {
  if (global.gc) {
    global.gc();
  }
}

let snapshotWritten = false;
function maybeSnapshot(): void {
  if (snapshotWritten) return;
  snapshotWritten = true;
  try {
    const file = v8.writeHeapSnapshot();
    console.log(`[memory-repro] wrote heap snapshot: ${file}`);
  } catch (err) {
    console.log(`[memory-repro] heap snapshot failed: ${(err as Error).message}`);
  }
}

const MB = 1024 * 1024;
function mb(bytes: number): string {
  return `${(bytes / MB).toFixed(1)} MB`;
}

function logTable(
  label: string,
  n: number,
  p: {
    durationMs: number;
    before: MemorySample;
    after: MemorySample;
    peak: MemorySample;
  },
): void {
  const rssDelta = p.after.rss - p.before.rss;
  const heapDelta = p.after.heapUsed - p.before.heapUsed;
  console.log(`\n[memory-repro] ${label} (N=${n})`);
  console.table({
    duration_ms: { value: p.durationMs },
    rss_before: { value: mb(p.before.rss) },
    rss_peak: { value: mb(p.peak.rss) },
    rss_after: { value: mb(p.after.rss) },
    rss_delta: { value: mb(rssDelta) },
    heapUsed_before: { value: mb(p.before.heapUsed) },
    heapUsed_peak: { value: mb(p.peak.heapUsed) },
    heapUsed_after: { value: mb(p.after.heapUsed) },
    heapUsed_delta: { value: mb(heapDelta) },
    per_tx_heap_peak: { value: `${((p.peak.heapUsed - p.before.heapUsed) / n / 1024).toFixed(2)} KB/tx` },
  });
}

/**
 * Builds a valid single-account QIF string with `count` regular bank
 * transactions. Each row has a unique payee/memo so payee dedup and
 * transfer-dup detection do not collapse rows. Dates are ISO (YYYY-MM-DD)
 * and we pass dateFormat: "YYYY-MM-DD" explicitly when importing.
 */
function buildQif(count: number): string {
  const lines: string[] = ["!Type:Bank"];
  for (let i = 0; i < count; i++) {
    // Spread dates across a year so they are not all identical.
    const day = (i % 28) + 1;
    const month = (Math.floor(i / 28) % 12) + 1;
    const date = `2024-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const amount = ((i % 100) + 1) * (i % 2 === 0 ? -1 : 1);
    lines.push(`D${date}`);
    lines.push(`T${amount.toFixed(2)}`);
    lines.push(`PSynthetic Payee ${i}`);
    lines.push(`MSynthetic memo for row ${i}`);
    lines.push(`N${1000 + i}`);
    lines.push(`LSynthetic Category ${i % 20}`);
    lines.push("^");
  }
  return lines.join("\n") + "\n";
}

describe("Transaction import/delete memory (integration repro)", () => {
  let module: TestingModule;
  let importService: ImportService;
  let bulkService: TransactionBulkUpdateService;
  let dataSource: DataSource;
  let userId: string;
  let accountId: string;

  beforeAll(async () => {
    module = await buildModule();
    importService = module.get(ImportService, { strict: false });
    bulkService = module.get(TransactionBulkUpdateService, { strict: false });
    dataSource = module.get(DataSource);
  }, 120_000);

  afterAll(async () => {
    if (module) {
      await module.close();
    }
  });

  beforeEach(async () => {
    await cleanTables(dataSource, [
      "action_history",
      "transaction_tags",
      "transaction_split_tags",
      "transaction_splits",
      "transactions",
      "payee_aliases",
      "payees",
      "accounts",
      "categories",
      "tags",
      "monthly_account_balances",
      "users",
    ]);
    const user = await createTestUserDirect(dataSource);
    userId = user.id;
    const account = await createTestAccount(dataSource, userId, {
      openingBalance: 0,
      currentBalance: 0,
    });
    accountId = account.id;
  });

  it(`profiles import + delete of ${TX_COUNT} synthetic transactions`, async () => {
    // Guard: confirm we are pointed at the test database, never real data.
    expect(dataSource.options.database).toBe(
      process.env.DATABASE_NAME || "monize_test",
    );

    const qif = buildQif(TX_COUNT);

    // --- IMPORT ---
    const importProfile = await profile(() =>
      importService.importQifFile(userId, {
        content: qif,
        accountId,
        categoryMappings: [],
        accountMappings: [],
        securityMappings: [],
        dateFormat: "YYYY-MM-DD",
      } as any),
    );

    logTable("IMPORT (importQifFile)", TX_COUNT, importProfile);

    const importResult = importProfile.result;
    console.log(
      `[memory-repro] import result: imported=${importResult.imported} ` +
        `skipped=${importResult.skipped} errors=${importResult.errors} ` +
        `payeesCreated=${importResult.payeesCreated} ` +
        `categoriesCreated=${importResult.categoriesCreated}`,
    );

    const importedCount = await dataSource.manager.count(Transaction, {
      where: { userId },
    });
    console.log(`[memory-repro] transactions in DB after import: ${importedCount}`);
    expect(importedCount).toBeGreaterThan(0);

    // Collect IDs to delete via the real bulkDelete path.
    const rows = await dataSource.manager.find(Transaction, {
      where: { userId },
      select: ["id"],
    });
    const ids = rows.map((r) => r.id);

    // --- DELETE ---
    const deleteProfile = await profile(() =>
      bulkService.bulkDelete(userId, {
        mode: "ids",
        transactionIds: ids,
      } as any),
    );

    logTable("DELETE (bulkDelete)", ids.length, deleteProfile);
    console.log(
      `[memory-repro] delete result: deleted=${deleteProfile.result.deleted}`,
    );

    const remaining = await dataSource.manager.count(Transaction, {
      where: { userId },
    });
    expect(remaining).toBe(0);

    // Very loose sanity guard only (NOT a tight threshold). Heap growth per
    // transaction should not be absurd; if a single small bank row retains
    // megabytes, something is badly wrong. 200 KB/tx is generous.
    const importHeapPerTx =
      (importProfile.peak.heapUsed - importProfile.before.heapUsed) / TX_COUNT;
    expect(importHeapPerTx).toBeLessThan(200 * 1024);
  }, 600_000);
});
