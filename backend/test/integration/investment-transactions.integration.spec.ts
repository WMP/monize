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
import { withUserContext } from "@/common/db/with-context";
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
    const security = await withUserContext(userId, () =>
      securitiesService.create(userId, {
        symbol: "AAPL",
        name: "Apple Inc.",
        securityType: "STOCK" as any,
        currencyCode: "USD",
      } as any),
    );
    securityId = security.id;
  });

  it("moves the debit from old funding account to new funding account when fundingAccountId is changed", async () => {
    const buy = await withUserContext(userId, () =>
      service.create(userId, {
        accountId: brokerageAccountId,
        action: InvestmentAction.BUY,
        transactionDate: "2026-01-15",
        securityId,
        fundingAccountId: fundingAccountA,
        quantity: 10,
        price: 100,
        commission: 0,
      }),
    );

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
    await withUserContext(userId, () =>
      service.update(userId, buy.id, {
        fundingAccountId: fundingAccountB,
      }),
    );

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

  // FINV-FX-001: changing the funding account to one in a different currency,
  // with no explicit rate, must re-resolve FX for the new pair. The defect was
  // that `fundingChanged` compared the DTO against the property this method had
  // already overwritten, so it was always false and the old same-currency rate
  // of 1 survived -- posting a 1,000 USD buy as a 1,000 EUR debit instead of
  // 920 EUR at 0.92.
  it("re-resolves FX when the funding account currency changes", async () => {
    await dataSource.query(
      `INSERT INTO currencies (code, name, symbol, decimal_places) VALUES ('EUR', 'Euro', '€', 2) ON CONFLICT DO NOTHING`,
    );
    // A USD -> EUR rate on/around the trade date, so the resolver reads it from
    // the database (LessThanOrEqual carry-forward) rather than reaching Yahoo.
    await dataSource.query(
      `INSERT INTO exchange_rates (from_currency, to_currency, rate, rate_date, source) VALUES ('USD', 'EUR', 0.92, '2026-01-01', 'test') ON CONFLICT DO NOTHING`,
    );

    const eurFunding = await createTestAccount(dataSource, userId, {
      name: "Funding EUR",
      currencyCode: "EUR",
      openingBalance: 10000,
      currentBalance: 10000,
    });

    // BUY 10 @ 100 USD, funded from a USD account -> stored rate 1.
    const buy = await withUserContext(userId, () =>
      service.create(userId, {
        accountId: brokerageAccountId,
        action: InvestmentAction.BUY,
        transactionDate: "2026-01-15",
        securityId,
        fundingAccountId: fundingAccountA,
        quantity: 10,
        price: 100,
        commission: 0,
      }),
    );

    // Switch the funding account to the EUR one and nothing else -- no rate.
    await withUserContext(userId, () =>
      service.update(userId, buy.id, { fundingAccountId: eurFunding.id }),
    );

    const reloaded = await dataSource.manager.findOneOrFail(
      InvestmentTransaction,
      { where: { id: buy.id } },
    );
    expect(reloaded.fundingAccountId).toBe(eurFunding.id);
    // The stored rate is the USD -> EUR rate, not the stale same-currency 1.
    expect(Number(reloaded.exchangeRate)).toBeCloseTo(0.92, 10);

    // The linked cash leg lands in the EUR account: 1000 USD * 0.92 = 920 EUR.
    const eurTx = await dataSource.manager.find(Transaction, {
      where: { accountId: eurFunding.id, userId },
    });
    expect(eurTx).toHaveLength(1);
    expect(Number(eurTx[0].amount)).toBe(-920);
    expect(eurTx[0].currencyCode).toBe("EUR");

    // The original USD funding account is refunded in full; the EUR account is
    // debited by 920, not 1000.
    const a = await dataSource.manager.findOneOrFail(Account, {
      where: { id: fundingAccountA },
    });
    const eur = await dataSource.manager.findOneOrFail(Account, {
      where: { id: eurFunding.id },
    });
    expect(Number(a.currentBalance)).toBe(10000);
    expect(Number(eur.currentBalance)).toBe(9080);
  });

  // FINV-STATE-002: an action-only edit must recompute the derived total from
  // the new action's formula. The defect recomputed the total only when
  // quantity/price/commission were present, so switching a BUY(10 @ 100 + 5)
  // to DIVIDEND kept the stale 1005 total and posted a 1005 dividend.
  it("recomputes the derived total when only the action changes", async () => {
    const buy = await withUserContext(userId, () =>
      service.create(userId, {
        accountId: brokerageAccountId,
        action: InvestmentAction.BUY,
        transactionDate: "2026-01-15",
        securityId,
        fundingAccountId: fundingAccountA,
        quantity: 10,
        price: 100,
        commission: 5,
      }),
    );
    const created = await dataSource.manager.findOneOrFail(
      InvestmentTransaction,
      { where: { id: buy.id } },
    );
    expect(Number(created.totalAmount)).toBe(1005);

    // Change only the action.
    await withUserContext(userId, () =>
      service.update(userId, buy.id, { action: InvestmentAction.DIVIDEND }),
    );

    const reloaded = await dataSource.manager.findOneOrFail(
      InvestmentTransaction,
      { where: { id: buy.id } },
    );
    // DIVIDEND total = (10 || 1) * 100 = 1000, not the carried-over BUY 1005.
    expect(Number(reloaded.totalAmount)).toBe(1000);

    // The old BUY cash leg (-1005) is reversed and a DIVIDEND credit created in
    // its place: the funding account now holds exactly one +1000 cash entry.
    const cashTx = await dataSource.manager.find(Transaction, {
      where: { accountId: fundingAccountA, userId },
    });
    expect(cashTx).toHaveLength(1);
    expect(Number(cashTx[0].amount)).toBe(1000);
  });
});
