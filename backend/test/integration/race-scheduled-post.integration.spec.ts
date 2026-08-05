import { Test, TestingModule } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  BadRequestException,
  ConflictException,
  Global,
  Module,
} from "@nestjs/common";
import { I18nService } from "nestjs-i18n";
import { DataSource } from "typeorm";

import { ScheduledTransactionsModule } from "@/scheduled-transactions/scheduled-transactions.module";
import { ScheduledTransactionsService } from "@/scheduled-transactions/scheduled-transactions.service";
import { ScheduledTransaction } from "@/scheduled-transactions/entities/scheduled-transaction.entity";
import { Transaction } from "@/transactions/entities/transaction.entity";
import { NetWorthService } from "@/net-worth/net-worth.service";
import { withUserContext } from "@/common/db/with-context";

import {
  INTEGRATION_TYPEORM_OPTIONS,
  cleanTables,
  createTestUserDirect,
} from "../helpers/integration-setup";
import { applyRlsPolicies } from "../helpers/rls-setup";
import {
  createTestAccount,
  createTestCategory,
} from "../helpers/test-factories";
import {
  RowGate,
  describeOutcomes,
  losers,
  raceAll,
  waitForBlockedBackends,
  winners,
} from "../helpers/race-harness";

/**
 * P4-004 / audit race 3: two posters of the same scheduled occurrence.
 *
 * This is the race with money in it. `post` read the schedule, created the
 * transaction, and advanced `next_due_date` in three separate transactions with
 * no lock between them, so two callers both read the same due date, both created
 * a transaction for it, and both advanced to the same new date. The bill was paid
 * twice and the schedule looked perfectly healthy afterwards -- there was no
 * inconsistency to notice, just an extra payment.
 *
 * "Two callers" is not hypothetical. `docs/cron-jobs.md` records that every
 * backend replica fires every cron, the Pay button can be double-clicked, and a
 * retried request repeats a POST the server already accepted.
 *
 * The mocked unit suite cannot see any of it: one manager, one instance, and the
 * three transaction boundaries collapse into the same mock.
 */
describe("Scheduled posting single-occurrence (integration)", () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let scheduled: ScheduledTransactionsService;
  let userId: string;
  let accountId: string;
  let categoryId: string;

  /** Same stub the shared integration setup installs, for the same reason. */
  @Global()
  @Module({
    providers: [
      {
        provide: I18nService,
        useValue: {
          translate: (key: string, options?: { defaultValue?: string }) =>
            options?.defaultValue ?? key,
          t: (key: string, options?: { defaultValue?: string }) =>
            options?.defaultValue ?? key,
        },
      },
    ],
    exports: [I18nService],
  })
  class TestI18nModule {}

  beforeAll(async () => {
    // The real ScheduledTransactionsModule, not the stub `createIntegrationModule`
    // installs: the service under test is the point, and its posting path reaches
    // TransactionsService for real.
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TestI18nModule,
        TypeOrmModule.forRoot(INTEGRATION_TYPEORM_OPTIONS),
        ScheduledTransactionsModule,
      ],
    }).compile();

    dataSource = module.get(DataSource);
    scheduled = module.get(ScheduledTransactionsService);
    await applyRlsPolicies(dataSource);

    // Debounced recalculation leaves a timer behind, which hangs the run.
    jest
      .spyOn(module.get(NetWorthService), "triggerDebouncedRecalc")
      .mockImplementation(() => {});
  });

  afterAll(async () => {
    await module?.close();
  });

  beforeEach(async () => {
    await cleanTables(dataSource, [
      "action_history",
      "transaction_splits",
      "transactions",
      "scheduled_transaction_splits",
      "scheduled_transaction_overrides",
      "scheduled_transactions",
      "investment_transactions",
      "monthly_account_balances",
      "accounts",
      "categories",
      "payees",
      "users",
    ]);
    userId = (await createTestUserDirect(dataSource)).id;
    accountId = (
      await createTestAccount(dataSource, userId, {
        openingBalance: 5000,
        currentBalance: 5000,
      })
    ).id;
    categoryId = (await createTestCategory(dataSource, userId)).id;
  });

  /** A monthly bill due on the 15th. */
  async function seedSchedule(dueDate = "2026-04-15"): Promise<string> {
    const repo = dataSource.getRepository(ScheduledTransaction);
    const row = await repo.save(
      repo.create({
        userId,
        accountId,
        categoryId,
        name: "Rent",
        description: "Rent",
        amount: -1200,
        currencyCode: "CAD",
        frequency: "MONTHLY",
        startDate: dueDate,
        nextDueDate: dueDate,
        isActive: true,
      }),
    );
    return row.id;
  }

  const postedCount = () =>
    dataSource.getRepository(Transaction).count({ where: { accountId } });

  const nextDueDate = async (id: string): Promise<string> => {
    const rows: Array<{ next: string }> = await dataSource.query(
      `SELECT TO_CHAR(next_due_date, 'YYYY-MM-DD') AS next
         FROM scheduled_transactions WHERE id = $1`,
      [id],
    );
    return rows[0].next;
  };

  it("posts one transaction when two callers post the same occurrence", async () => {
    const id = await seedSchedule();

    // Both posters park on the schedule row inside their own transactions, so
    // both have read the same due date and are inside the window when released.
    const gate = await RowGate.hold(
      dataSource,
      `SELECT id FROM scheduled_transactions WHERE id = $1 FOR UPDATE`,
      [id],
    );

    let outcomes;
    try {
      const running = raceAll([
        () =>
          withUserContext(userId, () =>
            scheduled.post(userId, id, { expectedNextDueDate: "2026-04-15" }),
          ),
        () =>
          withUserContext(userId, () =>
            scheduled.post(userId, id, { expectedNextDueDate: "2026-04-15" }),
          ),
      ]);
      await waitForBlockedBackends(dataSource, 2);
      await gate.release();
      outcomes = await running;
    } finally {
      await gate.release();
    }

    // One payment. This is the assertion the whole suite exists for.
    expect(await postedCount()).toBe(1);
    expect(winners(outcomes)).toHaveLength(1);
    expect(losers(outcomes)[0]).toBeInstanceOf(ConflictException);
    // And the schedule advanced exactly one period, not two and not zero.
    expect(await nextDueDate(id)).toBe("2026-05-15");
    expect(describeOutcomes(outcomes)).toContain("ConflictException");
  });

  it("keeps the amount right as well as the count", async () => {
    // A duplicate is not only an extra row: the account's ledger is wrong by the
    // amount of the bill, which is the part a user notices.
    const id = await seedSchedule();

    const gate = await RowGate.hold(
      dataSource,
      `SELECT id FROM scheduled_transactions WHERE id = $1 FOR UPDATE`,
      [id],
    );
    try {
      const running = raceAll([
        () =>
          withUserContext(userId, () =>
            scheduled.post(userId, id, { expectedNextDueDate: "2026-04-15" }),
          ),
        () =>
          withUserContext(userId, () =>
            scheduled.post(userId, id, { expectedNextDueDate: "2026-04-15" }),
          ),
      ]);
      await waitForBlockedBackends(dataSource, 2);
      await gate.release();
      await running;
    } finally {
      await gate.release();
    }

    const rows: Array<{ total: string }> = await dataSource.query(
      `SELECT COALESCE(SUM(amount), 0)::text AS total FROM transactions WHERE account_id = $1`,
      [accountId],
    );
    expect(Number(rows[0].total)).toBe(-1200);
  });

  it("still posts consecutive occurrences one after another", async () => {
    // The precondition is per-occurrence, so posting April and then May must
    // both work: a guard that refused the second posting outright would be a
    // worse bug than the one it replaced.
    const id = await seedSchedule();

    await withUserContext(userId, () =>
      scheduled.post(userId, id, { expectedNextDueDate: "2026-04-15" }),
    );
    await withUserContext(userId, () =>
      scheduled.post(userId, id, { expectedNextDueDate: "2026-05-15" }),
    );

    expect(await postedCount()).toBe(2);
    expect(await nextDueDate(id)).toBe("2026-06-15");
  });

  it("refuses a second post of an occurrence that already went through", async () => {
    // The sequential form of the same refusal -- a retried request, or a second
    // replica arriving late. It must be a conflict, not a silent second payment.
    //
    // Through the **public** method, naming the occurrence, which is what the
    // cron and both frontend call sites now do. An earlier version of this test
    // reached for the private `postOccurrence` and so proved something no caller
    // could reach.
    const id = await seedSchedule();
    await withUserContext(userId, () =>
      scheduled.post(userId, id, { expectedNextDueDate: "2026-04-15" }),
    );

    const stale = withUserContext(userId, () =>
      scheduled.post(userId, id, { expectedNextDueDate: "2026-04-15" }),
    );

    await expect(stale).rejects.toBeInstanceOf(ConflictException);
    expect(await postedCount()).toBe(1);
    expect(await nextDueDate(id)).toBe("2026-05-15");
  });

  it("leaves nothing behind when the posting is refused", async () => {
    // "A rejected command must not already have written": the refusal happens
    // inside the transaction that would do the writing, so there is no posted
    // transaction and no advanced date to clean up.
    const id = await seedSchedule();

    await expect(
      withUserContext(userId, () =>
        scheduled.post(userId, id, { expectedNextDueDate: "1999-01-01" }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(await postedCount()).toBe(0);
    expect(await nextDueDate(id)).toBe("2026-04-15");
  });

  it("refuses a post that names no occurrence, and writes nothing", async () => {
    // R4-001: there is no "post current" fallback. Deriving the occurrence from
    // a fresh read is what let a retry pay the next period, so a caller that
    // names nothing is refused before the transaction opens -- the public DTO
    // makes this a 400, and the service makes it a refusal for internal callers
    // too, which is what this asserts.
    const id = await seedSchedule();

    await expect(
      withUserContext(userId, () => scheduled.post(userId, id, {} as never)),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(await postedCount()).toBe(0);
    expect(await nextDueDate(id)).toBe("2026-04-15");
  });

  /**
   * RFR7-001: the delayed replica.
   *
   * The dangerous shape is not two workers arriving together -- that one the row
   * lock already handled. It is one worker arriving *late*: the cron discovers a
   * due list, another replica posts the occurrence and advances the schedule, and
   * the late worker then posts from its stale candidate. If the command means
   * "post whatever is current", the late worker pays the **next** period early:
   * a second payment and a skipped occurrence, from a worker that was asked for
   * April.
   *
   * These cases go through `processAutoPostTransactions` -- the real cron entry
   * point, discovery included -- because the defect lived in what the cron did
   * with what it discovered, and a test that calls `post` directly cannot see it.
   */
  describe("delayed auto-post replica", () => {
    /** Makes the schedule due for the cron: auto-post on, due date in the past. */
    async function seedDueForCron(dueDate = "2026-04-15"): Promise<string> {
      const id = await seedSchedule(dueDate);
      await dataSource.query(
        `UPDATE scheduled_transactions SET auto_post = true WHERE id = $1`,
        [id],
      );
      return id;
    }

    it("does not post the next occurrence when it resumes after another replica", async () => {
      const id = await seedDueForCron();

      // Replica A: the whole cron, discovery and posting, run to completion.
      await scheduled.processAutoPostTransactions();
      expect(await postedCount()).toBe(1);
      expect(await nextDueDate(id)).toBe("2026-05-15");

      // Replica B resumed from a due list it built before A committed. Its
      // candidate still says April, so that is the occurrence it must post -- and
      // April is gone, so it must post nothing.
      await withUserContext(userId, () =>
        scheduled
          .post(userId, id, { expectedNextDueDate: "2026-04-15" })
          .catch(() => undefined),
      );

      expect(await postedCount()).toBe(1);
      expect(await nextDueDate(id)).toBe("2026-05-15");
    });

    it("posts once when two cron replicas run over the same due list", async () => {
      const id = await seedDueForCron();

      // Two full cron passes racing. Both discover April; the lock and the
      // precondition between them decide that April is paid once.
      const gate = await RowGate.hold(
        dataSource,
        `SELECT id FROM scheduled_transactions WHERE id = $1 FOR UPDATE`,
        [id],
      );
      try {
        const running = raceAll<void>([
          () => scheduled.processAutoPostTransactions(),
          () => scheduled.processAutoPostTransactions(),
        ]);
        await waitForBlockedBackends(dataSource, 2);
        await gate.release();
        await running;
      } finally {
        await gate.release();
      }

      expect(await postedCount()).toBe(1);
      expect(await nextDueDate(id)).toBe("2026-05-15");
      const rows: Array<{ total: string }> = await dataSource.query(
        `SELECT COALESCE(SUM(amount), 0)::text AS total FROM transactions WHERE account_id = $1`,
        [accountId],
      );
      expect(Number(rows[0].total)).toBe(-1200);
    });

    it("still catches up an occurrence nobody has posted", async () => {
      // The precondition must not stop the cron doing its job. A due occurrence
      // with no competing replica is posted, once, and the schedule advances.
      const id = await seedDueForCron("2026-03-15");

      await scheduled.processAutoPostTransactions();

      expect(await postedCount()).toBe(1);
      expect(await nextDueDate(id)).toBe("2026-04-15");
    });
  });
});
