import { TestingModule } from "@nestjs/testing";
import { Module } from "@nestjs/common";
import { DataSource } from "typeorm";
import { ScheduledTransactionLoanService } from "@/scheduled-transactions/scheduled-transaction-loan.service";
import { ScheduledTransaction } from "@/scheduled-transactions/entities/scheduled-transaction.entity";
import { ScheduledTransactionSplit } from "@/scheduled-transactions/entities/scheduled-transaction-split.entity";
import { Account, AccountType } from "@/accounts/entities/account.entity";
import { Transaction } from "@/transactions/entities/transaction.entity";
import { LoanRateChange } from "@/loan-rate-changes/entities/loan-rate-change.entity";
import { NetWorthService } from "@/net-worth/net-worth.service";
import {
  createIntegrationModule,
  cleanTables,
  createTestUserDirect,
} from "../helpers/integration-setup";
import {
  createTestAccount,
  createTestCategory,
} from "../helpers/test-factories";
import { withUserContext } from "@/common/db/with-context";

/**
 * Issue #1637, B1 -- the PostgreSQL half of INV-LOAN-009.
 *
 * The configured payment of an annuity installment is the one the rate
 * timeline states for its own due date, and the template advancement steps
 * into a stated payment at the first installment it newly applies to
 * (`docs/specs/scheduled-loan-installment-pricing.md` sections 5.2, 6 and
 * 7.3). The unit specs prove the rule against mocked rows; this suite proves
 * it on a real ledger, a real `loan_rate_changes` timeline and a real
 * schedule calendar, through the advancement every posting dispatches.
 *
 * Fixture 5.1 with Timeline A: ANNUITY, 100,000.00 over 300 monthly payments
 * from 2023-02-03, 584.59 at 5.0 %, the `initial` row 5.0 % / 584.59 from
 * 2023-02-03 and 4.5 % / 560.00 stated from 2023-04-15. Each installment is
 * posted on its due date as table 5.2 books it.
 */
@Module({
  providers: [
    ScheduledTransactionLoanService,
    {
      provide: NetWorthService,
      useValue: { triggerDebouncedRecalc: () => undefined },
    },
  ],
})
class DatedLoanPaymentTestModule {}

describe("Dated loan payment: the advancement across a stated change (integration)", () => {
  let module: TestingModule;
  let service: ScheduledTransactionLoanService;
  let dataSource: DataSource;
  let userId: string;
  let loanId: string;
  let scheduledId: string;
  let principalSplitId: string;
  let interestSplitId: string;

  beforeAll(async () => {
    module = await createIntegrationModule([DatedLoanPaymentTestModule]);
    service = module.get(ScheduledTransactionLoanService);
    dataSource = module.get(DataSource);
  });

  afterAll(async () => {
    await module.close();
  });

  /** Table 5.2: the cents each installment books and the principal the ledger takes. */
  const posted: ReadonlyArray<[string, number]> = [
    ["2023-02-03", 167.92],
    ["2023-03-03", 168.62],
    ["2023-04-03", 169.33],
  ];

  /**
   * The loan after the installments through `postedThrough` posted on their
   * due dates, its template holding the last one's lines and its cursor on
   * the slot after it.
   */
  const seed = async (postedThrough: number) => {
    await cleanTables(dataSource, [
      "scheduled_transaction_splits",
      "scheduled_transactions",
      "loan_rate_changes",
      "transactions",
      "accounts",
      "categories",
      "users",
    ]);
    await dataSource.query(
      `INSERT INTO currencies (code, name, symbol, decimal_places)
       VALUES ('USD', 'US Dollar', '$', 2)
       ON CONFLICT DO NOTHING`,
    );
    userId = (await createTestUserDirect(dataSource)).id;
    const chequing = await createTestAccount(dataSource, userId, {
      name: "Chequing",
      openingBalance: 50000,
      currentBalance: 50000,
    });
    const interestCategory = await createTestCategory(dataSource, userId, {
      name: "Mortgage Interest",
    });
    const loan = await createTestAccount(dataSource, userId, {
      name: "Mortgage",
      openingBalance: -100000,
      currentBalance: -100000,
    });
    loanId = loan.id;
    await dataSource.manager.update(Account, loanId, {
      accountType: AccountType.MORTGAGE,
      mortgageType: "ANNUITY",
      interestRate: 5,
      paymentFrequency: "MONTHLY",
      paymentAmount: 584.59,
      paymentStartDate: "2023-02-03" as unknown as Date,
      amortizationMonths: 300,
      originalPrincipal: 100000,
      interestCategoryId: interestCategory.id,
    });

    // Timeline A: the `initial` row the first change wrote, and the change.
    for (const row of [
      {
        effectiveDate: "2023-02-03",
        annualRate: 5,
        newPaymentAmount: 584.59,
        source: "initial" as const,
      },
      {
        effectiveDate: "2023-04-15",
        annualRate: 4.5,
        newPaymentAmount: 560,
        source: "manual" as const,
      },
    ]) {
      await dataSource.manager.save(
        dataSource.manager.create(LoanRateChange, {
          userId,
          accountId: loanId,
          note: null,
          ...row,
        }),
      );
    }

    // The ledger: each posted installment's principal, dated on its due date.
    for (const [date, principal] of posted.slice(0, postedThrough)) {
      await dataSource.manager.save(
        dataSource.manager.create(Transaction, {
          userId,
          accountId: loanId,
          transactionDate: date,
          amount: principal,
          currencyCode: "USD",
          status: "UNRECONCILED",
        } as Partial<Transaction>),
      );
    }

    const [lastDue, lastPrincipal] = posted[postedThrough - 1];
    const nextDueDate = posted[postedThrough]?.[0] ?? "2023-05-03";
    const scheduled = await dataSource.manager.save(
      dataSource.manager.create(ScheduledTransaction, {
        userId,
        accountId: chequing.id,
        name: "Mortgage Payment",
        amount: -584.59,
        currencyCode: "USD",
        frequency: "MONTHLY",
        startDate: "2023-02-03",
        nextDueDate,
        isActive: true,
        isSplit: true,
      } as Partial<ScheduledTransaction>),
    );
    scheduledId = scheduled.id;
    principalSplitId = (
      await dataSource.manager.save(
        dataSource.manager.create(ScheduledTransactionSplit, {
          scheduledTransactionId: scheduledId,
          kind: "transfer",
          transferAccountId: loanId,
          amount: -lastPrincipal,
          memo: "Principal",
        } as Partial<ScheduledTransactionSplit>),
      )
    ).id;
    interestSplitId = (
      await dataSource.manager.save(
        dataSource.manager.create(ScheduledTransactionSplit, {
          scheduledTransactionId: scheduledId,
          kind: "category",
          categoryId: interestCategory.id,
          amount: -(584.59 - lastPrincipal),
          memo: `Interest through ${lastDue}`,
        } as Partial<ScheduledTransactionSplit>),
      )
    ).id;
  };

  const cents = (value: number) => Math.round(value * 100) / 100;

  const templateAmounts = async () => {
    const splits = await dataSource.manager.find(ScheduledTransactionSplit, {
      where: { scheduledTransactionId: scheduledId },
    });
    const scheduled = await dataSource.manager.findOne(ScheduledTransaction, {
      where: { id: scheduledId },
    });
    return {
      principal: cents(
        Number(splits.find((s) => s.id === principalSplitId)!.amount),
      ),
      interest: cents(
        Number(splits.find((s) => s.id === interestSplitId)!.amount),
      ),
      parent: Number(scheduled!.amount),
    };
  };

  it("steps the template into the stated 560.00 = 373.10 + 186.90 at 2023-05-03, the first installment the change applies to", async () => {
    await seed(3);

    await withUserContext(userId, () =>
      service.recalculateLoanPaymentSplits(scheduledId),
    );

    // Debt through 2023-05-03: 100,000.00 - 505.87 = 99,494.13 at 4.5 %.
    expect(await templateAmounts()).toEqual({
      principal: -186.9,
      interest: -373.1,
      parent: -560,
    });
  });

  it("posts the stepped bill as shown, re-divided at its due date", async () => {
    await seed(3);
    await withUserContext(userId, () =>
      service.recalculateLoanPaymentSplits(scheduledId),
    );
    const scheduled = await dataSource.manager.findOne(ScheduledTransaction, {
      where: { id: scheduledId },
    });
    const splits = await dataSource.manager.find(ScheduledTransactionSplit, {
      where: { scheduledTransactionId: scheduledId },
    });

    const allocation = await withUserContext(userId, () =>
      service.resolvePostingAllocation(scheduled!, splits, "2023-05-03"),
    );

    expect(allocation.kind).toBe("allocation");
    if (allocation.kind !== "allocation") throw new Error("unreachable");
    expect(allocation.parentAmount).toBe(-560);
    expect(allocation.amountsBySplitId.get(interestSplitId)).toBe(-373.1);
    expect(allocation.amountsBySplitId.get(principalSplitId)).toBe(-186.9);
  });

  it("leaves the installment before the change at 584.59 = 415.26 + 169.33", async () => {
    // 2023-03-03 posted; the cursor is 2023-04-03, before 2023-04-15: the
    // dated payment there is the initial row's, max(584.59, 584.59).
    await seed(2);

    await withUserContext(userId, () =>
      service.recalculateLoanPaymentSplits(scheduledId),
    );

    expect(await templateAmounts()).toEqual({
      principal: -169.33,
      interest: -415.26,
      parent: -584.59,
    });
  });

  it("does not write accounts.payment_amount", async () => {
    await seed(3);

    await withUserContext(userId, () =>
      service.recalculateLoanPaymentSplits(scheduledId),
    );

    const loan = await dataSource.manager.findOne(Account, {
      where: { id: loanId },
    });
    expect(Number(loan!.paymentAmount)).toBe(584.59);
  });
});
