import { TestingModule } from "@nestjs/testing";
import { DataSource } from "typeorm";

import { InvestmentTransactionsService } from "@/securities/investment-transactions.service";
import { SecuritiesModule } from "@/securities/securities.module";
import { SecuritiesService } from "@/securities/securities.service";
import { Holding } from "@/securities/entities/holding.entity";
import {
  Account,
  AccountSubType,
  AccountType,
} from "@/accounts/entities/account.entity";
import { InvestmentAction } from "@/securities/entities/investment-transaction.entity";
import { withUserContext } from "@/common/db/with-context";

import {
  createIntegrationModule,
  cleanTables,
  createTestUserDirect,
} from "../helpers/integration-setup";
import { createTestAccount } from "../helpers/test-factories";
import { raceAll, losers } from "../helpers/race-harness";

/**
 * R4-002: opposite-direction security transfers deadlocking on account locks.
 *
 * Every holdings mutator locks its account, and a transfer runs two of them: a
 * `TRANSFER_OUT` that locks the source, then a `TRANSFER_IN` that locks the
 * destination. So a transfer A->B acquires the pair source-then-destination, and
 * a simultaneous B->A acquires it destination-then-source -- opposite orders on
 * the same two rows, which is the textbook deadlock. PostgreSQL breaks it by
 * aborting one transaction with SQLSTATE 40P01, so a user's valid transfer fails
 * for no reason they can see.
 *
 * The fix takes the whole account set once, in sorted order, before either leg
 * (`lockAccountsForHoldings`), so every transfer acquires the pair the same way
 * and the cycle cannot form.
 *
 * This is a stress test, not a gated one: a deadlock needs each transaction
 * paused *between* its two lock acquisitions, and `transferSecurity` has no seam
 * there that a test could reach without deforming production code. So it fires
 * many opposite transfers at once -- with the fix that is deterministically
 * deadlock-free, and without it the aborts appear. Verified by reverting the
 * up-front lock and watching 40P01 losers show up here.
 */
describe("Opposite-direction security transfers (integration)", () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let service: InvestmentTransactionsService;
  let userId: string;
  let accountA: string;
  let accountB: string;
  let securityId: string;

  const PAIRS = 16;

  beforeAll(async () => {
    module = await createIntegrationModule([SecuritiesModule]);
    service = module.get(InvestmentTransactionsService);
    dataSource = module.get(DataSource);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await cleanTables(dataSource, [
      "action_history",
      "holdings",
      "securities",
      "transaction_splits",
      "transactions",
      "accounts",
      "categories",
      "payees",
      "scheduled_transaction_splits",
      "scheduled_transaction_overrides",
      "scheduled_transactions",
      "investment_transactions",
      "monthly_account_balances",
      "users",
    ]);
    await dataSource.query(
      `INSERT INTO currencies (code, name, symbol, decimal_places)
         VALUES ('USD', 'US Dollar', '$', 2) ON CONFLICT DO NOTHING`,
    );
    userId = (await createTestUserDirect(dataSource)).id;

    const mkBrokerage = async (name: string): Promise<string> => {
      const acct = await createTestAccount(dataSource, userId, {
        name,
        openingBalance: 0,
        currentBalance: 0,
      });
      await dataSource.manager.update(Account, acct.id, {
        accountType: AccountType.INVESTMENT,
        accountSubType: AccountSubType.INVESTMENT_BROKERAGE,
      });
      return acct.id;
    };
    accountA = await mkBrokerage("Brokerage A");
    accountB = await mkBrokerage("Brokerage B");

    securityId = (
      await withUserContext(userId, () =>
        module.get(SecuritiesService).create(userId, {
          symbol: "ACME",
          name: "Acme Corp",
          securityType: "STOCK",
          currencyCode: "USD",
        } as never),
      )
    ).id;

    // Seed both accounts with plenty of shares so every 1-share transfer, in
    // either direction, has stock to move and the over-draw guard never fires.
    for (const accountId of [accountA, accountB]) {
      await withUserContext(userId, () =>
        service.create(userId, {
          accountId,
          action: InvestmentAction.ADD_SHARES,
          transactionDate: "2026-01-01",
          securityId,
          quantity: 1000,
        } as never),
      );
    }
  });

  const held = async (accountId: string): Promise<number> => {
    const row = await dataSource.getRepository(Holding).findOne({
      where: { accountId, securityId },
    });
    return row ? Number(row.quantity) : 0;
  };

  const transfer = (from: string, to: string, date: string) =>
    withUserContext(userId, () =>
      service.transferSecurity(userId, {
        fromAccountId: from,
        toAccountId: to,
        securityId,
        transactionDate: date,
        quantity: 1,
        costPerShare: 10,
      } as never),
    );

  const isDeadlock = (error: unknown): boolean => {
    const code = (error as { code?: string; driverError?: { code?: string } })
      ?.code;
    const driverCode = (error as { driverError?: { code?: string } })
      ?.driverError?.code;
    return code === "40P01" || driverCode === "40P01";
  };

  it("does not deadlock when A->B and B->A run concurrently", async () => {
    // Interleave the two directions so the scheduler cannot trivially run all of
    // one before the other.
    const participants: Array<() => Promise<unknown>> = [];
    for (let i = 0; i < PAIRS; i += 1) {
      const day = String((i % 27) + 1).padStart(2, "0");
      participants.push(() => transfer(accountA, accountB, `2026-02-${day}`));
      participants.push(() => transfer(accountB, accountA, `2026-03-${day}`));
    }

    const outcomes = await raceAll(participants);

    // The assertion the fix exists for: not one transfer was aborted by a
    // deadlock. On the unlocked code, some of these lose with 40P01.
    const deadlocks = losers(outcomes).filter(isDeadlock);
    expect(deadlocks).toHaveLength(0);

    // Every A->B is matched by a B->A of the same size, so the holdings return
    // to where they started -- nothing was lost or double-counted.
    expect(await held(accountA)).toBe(1000);
    expect(await held(accountB)).toBe(1000);
  });

  it("still moves shares correctly for a single uncontended transfer", async () => {
    await transfer(accountA, accountB, "2026-04-01");

    expect(await held(accountA)).toBe(999);
    expect(await held(accountB)).toBe(1001);
  });
});
