import { TestingModule } from "@nestjs/testing";
import { DataSource } from "typeorm";
import { InvestmentTransactionsService } from "@/securities/investment-transactions.service";
import { SecuritiesModule } from "@/securities/securities.module";
import { SecuritiesService } from "@/securities/securities.service";
import {
  Account,
  AccountSubType,
  AccountType,
} from "@/accounts/entities/account.entity";
import { Transaction } from "@/transactions/entities/transaction.entity";
import {
  InvestmentTransaction,
  InvestmentAction,
} from "@/securities/entities/investment-transaction.entity";
import {
  createIntegrationModule,
  cleanTables,
  createTestUserDirect,
} from "../helpers/integration-setup";
import { createTestAccount } from "../helpers/test-factories";

describe("InvestmentTransactionsService funding account changes (integration)", () => {
  let module: TestingModule;
  let service: InvestmentTransactionsService;
  let dataSource: DataSource;
  let userId: string;
  let brokerageAccountId: string;
  let linkedCashAccountId: string;
  let fundingAccountA: string;
  let fundingAccountB: string;
  let securityId: string;

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
      `INSERT INTO currencies (code, name, symbol, decimal_places) VALUES ('USD', 'US Dollar', '$', 2) ON CONFLICT DO NOTHING`,
    );

    const user = await createTestUserDirect(dataSource);
    userId = user.id;

    const cash = await createTestAccount(dataSource, userId, {
      name: "Brokerage Cash",
      openingBalance: 0,
      currentBalance: 0,
    });
    await dataSource.manager.update(Account, cash.id, {
      accountType: AccountType.INVESTMENT,
      accountSubType: AccountSubType.INVESTMENT_CASH,
    });
    linkedCashAccountId = cash.id;

    const brokerage = await createTestAccount(dataSource, userId, {
      name: "Brokerage",
      openingBalance: 0,
      currentBalance: 0,
    });
    await dataSource.manager.update(Account, brokerage.id, {
      accountType: AccountType.INVESTMENT,
      accountSubType: AccountSubType.INVESTMENT_BROKERAGE,
      linkedAccountId: linkedCashAccountId,
    });
    brokerageAccountId = brokerage.id;

    const accountA = await createTestAccount(dataSource, userId, {
      name: "Funding A",
      openingBalance: 10000,
      currentBalance: 10000,
    });
    fundingAccountA = accountA.id;

    const accountB = await createTestAccount(dataSource, userId, {
      name: "Funding B",
      openingBalance: 10000,
      currentBalance: 10000,
    });
    fundingAccountB = accountB.id;

    const securitiesService = module.get(SecuritiesService);
    const security = await securitiesService.create(userId, {
      symbol: "AAPL",
      name: "Apple Inc.",
      securityType: "STOCK" as any,
      currencyCode: "USD",
    } as any);
    securityId = security.id;
  });

  it("moves the debit from old funding account to new funding account when fundingAccountId is changed", async () => {
    const buy = await service.create(userId, {
      accountId: brokerageAccountId,
      action: InvestmentAction.BUY,
      transactionDate: "2026-01-15",
      securityId,
      fundingAccountId: fundingAccountA,
      quantity: 10,
      price: 100,
      commission: 0,
    });

    // After buy: A should be debited by 1000, B unchanged, linked cash unchanged
    let a = await dataSource.manager.findOneOrFail(Account, {
      where: { id: fundingAccountA },
    });
    let b = await dataSource.manager.findOneOrFail(Account, {
      where: { id: fundingAccountB },
    });
    let cash = await dataSource.manager.findOneOrFail(Account, {
      where: { id: linkedCashAccountId },
    });
    expect(Number(a.currentBalance)).toBe(9000);
    expect(Number(b.currentBalance)).toBe(10000);
    expect(Number(cash.currentBalance)).toBe(0);

    const txInA = await dataSource.manager.find(Transaction, {
      where: { accountId: fundingAccountA, userId },
    });
    expect(txInA).toHaveLength(1);
    expect(Number(txInA[0].amount)).toBe(-1000);

    // Now switch funding account to B
    await service.update(userId, buy.id, {
      fundingAccountId: fundingAccountB,
    });

    a = await dataSource.manager.findOneOrFail(Account, {
      where: { id: fundingAccountA },
    });
    b = await dataSource.manager.findOneOrFail(Account, {
      where: { id: fundingAccountB },
    });
    cash = await dataSource.manager.findOneOrFail(Account, {
      where: { id: linkedCashAccountId },
    });

    expect(Number(a.currentBalance)).toBe(10000); // refunded
    expect(Number(b.currentBalance)).toBe(9000); // debited
    expect(Number(cash.currentBalance)).toBe(0); // untouched

    // And the cash transactions follow: none in A, one in B
    const txInAAfter = await dataSource.manager.find(Transaction, {
      where: { accountId: fundingAccountA, userId },
    });
    const txInBAfter = await dataSource.manager.find(Transaction, {
      where: { accountId: fundingAccountB, userId },
    });
    expect(txInAAfter).toHaveLength(0);
    expect(txInBAfter).toHaveLength(1);
    expect(Number(txInBAfter[0].amount)).toBe(-1000);

    // The investment transaction itself should now point to fundingAccountB
    const reloaded = await dataSource.manager.findOneOrFail(
      InvestmentTransaction,
      { where: { id: buy.id } },
    );
    expect(reloaded.fundingAccountId).toBe(fundingAccountB);
  });
});
