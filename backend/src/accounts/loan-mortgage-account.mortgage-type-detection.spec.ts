import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException } from "@nestjs/common";
import { DataSource } from "typeorm";
import {
  createScopedDbMocks,
  ManagerMock,
} from "../test-helpers/scoped-db-testing";

jest.mock("../common/db/scoped-db", () =>
  jest.requireActual("../test-helpers/scoped-db-testing").scopedDbMockModule(),
);
import { LoanMortgageAccountService } from "./loan-mortgage-account.service";
import {
  InstallmentHistory,
  LoanPaymentDetectorService,
} from "./loan-payment-detector.service";
import { Account, AccountType } from "./entities/account.entity";
import { Transaction } from "../transactions/entities/transaction.entity";
import { TransactionSplit } from "../transactions/entities/transaction-split.entity";
import { LoanRateChange } from "../loan-rate-changes/entities/loan-rate-change.entity";
import { CategoriesService } from "../categories/categories.service";
import { ScheduledTransactionsService } from "../scheduled-transactions/scheduled-transactions.service";
import { LoanRateChangesService } from "../loan-rate-changes/loan-rate-changes.service";
import { demoAccounts } from "../database/demo-seed-data/accounts";
import { generateTransactions } from "../database/demo-seed-data/transactions";
import { roundMoney } from "../common/round.util";

const userId = "user-1";
const mortgageId = "mortgage-1";
const chequingId = "chequing-1";

interface Installment {
  date: string;
  principal: number;
  interest: number;
}

/**
 * The ledger a scheduled split payment posts: on the mortgage, a transfer of
 * the principal linked to the chequing parent; on the parent, a split with the
 * principal as a transfer leg and the interest as a category leg. The shape
 * `LoanPaymentDetectorService.buildPaymentRecords` reads.
 */
function postedLedger(installments: Installment[]) {
  const loanSide = installments.map(
    (inst, i) =>
      ({
        id: `loan-tx-${i}`,
        accountId: mortgageId,
        userId,
        transactionDate: inst.date,
        amount: inst.principal,
        isTransfer: true,
        linkedTransactionId: `parent-${i}`,
      }) as unknown as Transaction,
  );
  const parents = new Map(
    installments.map((inst, i) => [
      `parent-${i}`,
      {
        id: `parent-${i}`,
        accountId: chequingId,
        account: { name: "Chequing" },
        amount: -roundMoney(inst.principal + inst.interest),
        isSplit: true,
      },
    ]),
  );
  const splits = new Map(
    installments.map((inst, i) => [
      `parent-${i}`,
      [
        {
          amount: -inst.principal,
          transferAccountId: mortgageId,
          categoryId: null,
          memo: null,
        },
        {
          amount: -inst.interest,
          transferAccountId: null,
          categoryId: "cat-interest",
          category: { name: "Mortgage Interest" },
          memo: null,
        },
      ],
    ]),
  );
  return { loanSide, parents, splits };
}

/**
 * Installments priced the way the scheduled payment prices them: interest on
 * the debt before each date at the periodic rate, principal by the method.
 */
function priceInstallments(
  startDebt: number,
  dates: string[],
  periodicRateOn: (date: string) => number,
  principalFor: (interest: number) => number,
): { installments: Installment[]; endDebt: number } {
  let debt = startDebt;
  const installments = dates.map((date) => {
    const interest = roundMoney(debt * periodicRateOn(date));
    const principal = principalFor(interest);
    debt = roundMoney(debt - principal);
    return { date, principal, interest };
  });
  return { installments, endDebt: debt };
}

describe("LoanMortgageAccountService: mortgage type from history", () => {
  let service: LoanMortgageAccountService;
  let manager: ManagerMock;
  let transactionsRepository: Record<string, jest.Mock>;
  let rateChangesRepository: Record<string, jest.Mock>;
  let detector: LoanPaymentDetectorService;

  const makeMortgage = (overrides: Partial<Account> = {}): Account =>
    ({
      id: mortgageId,
      userId,
      accountType: AccountType.MORTGAGE,
      mortgageType: "CANADIAN_FIXED",
      isCanadianMortgage: true,
      isVariableRate: false,
      interestRate: 5.24,
      paymentFrequency: "MONTHLY",
      interestBookingMode: "SPLIT",
      interestCategoryId: null,
      currentBalance: 0,
      ...overrides,
    }) as unknown as Account;

  function useLedger(installments: Installment[]): void {
    const { loanSide, parents, splits } = postedLedger(installments);
    transactionsRepository.find.mockResolvedValue(loanSide);
    manager.findOne.mockImplementation((_entity, options) =>
      Promise.resolve(parents.get(options.where.id) ?? null),
    );
    manager.find.mockImplementation((entity, options) =>
      Promise.resolve(
        entity === TransactionSplit
          ? (splits.get(options.where.transactionId) ?? [])
          : [],
      ),
    );
  }

  function expectNothingWritten(): void {
    for (const write of [
      manager.save,
      manager.update,
      manager.delete,
      manager.remove,
      manager.query,
    ]) {
      expect(write).not.toHaveBeenCalled();
    }
    for (const repo of [transactionsRepository, rateChangesRepository]) {
      for (const method of ["save", "update", "delete", "insert", "remove"]) {
        expect(repo[method]).not.toHaveBeenCalled();
      }
    }
  }

  beforeEach(async () => {
    const writes = () => ({
      save: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      insert: jest.fn(),
      remove: jest.fn(),
    });
    transactionsRepository = { find: jest.fn(), ...writes() };
    rateChangesRepository = {
      find: jest.fn().mockResolvedValue([]),
      ...writes(),
    };
    const mocks = createScopedDbMocks([
      [Transaction, transactionsRepository],
      [LoanRateChange, rateChangesRepository],
    ]);
    manager = mocks.manager;
    detector = new LoanPaymentDetectorService(
      mocks.dataSource as unknown as DataSource,
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoanMortgageAccountService,
        { provide: DataSource, useValue: mocks.dataSource },
        { provide: CategoriesService, useValue: {} },
        { provide: ScheduledTransactionsService, useValue: {} },
        { provide: LoanRateChangesService, useValue: {} },
        { provide: LoanPaymentDetectorService, useValue: detector },
      ],
    }).compile();
    service = module.get(LoanMortgageAccountService);
  });

  it("reads CANADIAN_FIXED with high confidence off the demo seed's Scotiabank mortgage", async () => {
    // The seed's own payments: each a chequing split whose transfer leg is the
    // principal into the mortgage and whose category leg is the interest.
    const seeded = demoAccounts.find((a) => a.key === "mortgage")!;
    const installments: Installment[] = generateTransactions(
      new Date(2026, 8, 15),
    )
      .filter((tx) =>
        tx.splits?.some((leg) => leg.transferAccountKey === "mortgage"),
      )
      .map((tx) => ({
        date: tx.date,
        principal: -tx.splits!.find((leg) => leg.transferAccountKey)!.amount,
        interest: -tx.splits!.find((leg) => leg.categoryPath)!.amount,
      }));
    expect(installments.length).toBeGreaterThanOrEqual(11);
    useLedger(installments);
    const paid = installments.reduce(
      (sum, inst) => sum + Math.round(inst.principal * 100),
      0,
    );
    const account = makeMortgage({
      mortgageType: seeded.mortgageType,
      interestRate: seeded.interestRate,
      paymentFrequency: seeded.paymentFrequency,
      currentBalance: seeded.openingBalance + paid / 100,
    });

    const result = await service.detectMortgageTypeFromHistory(account, userId);

    expect(result).toEqual(
      expect.objectContaining({
        type: "CANADIAN_FIXED",
        confidence: "high",
        reason: "CONSTANT_INSTALLMENT_SEMI_ANNUAL",
        quotedAnnualRate: 5.24,
        paymentFrequency: "MONTHLY",
      }),
    );
    // The latest three, each with the ledger debt before its date.
    const latest = installments.slice(-3);
    expect(result.samples.map((s) => s.date)).toEqual(
      latest.map((inst) => inst.date),
    );
    const debtBefore = (index: number) =>
      roundMoney(
        -seeded.openingBalance -
          installments
            .slice(0, index)
            .reduce((sum, inst) => sum + inst.principal, 0),
      );
    expect(result.samples[0]).toEqual({
      ...latest[0],
      balanceBefore: debtBefore(installments.length - 3),
    });
    expect(transactionsRepository.find).toHaveBeenCalledWith({
      where: { accountId: mortgageId, userId },
      order: { transactionDate: "ASC" },
    });
    expectNothingWritten();
  });

  it("reads INTEREST_ONLY off the 0.00 principal legs an interest-only installment posts", async () => {
    const { installments } = priceInstallments(
      300000,
      ["2026-01-01", "2026-02-01", "2026-03-01"],
      () => 0.02 / 12,
      () => 0,
    );
    useLedger(installments);
    const account = makeMortgage({
      mortgageType: "INTEREST_ONLY",
      isCanadianMortgage: false,
      interestRate: 2,
      currentBalance: -300000,
    });

    const result = await service.detectMortgageTypeFromHistory(account, userId);

    expect(result).toEqual(
      expect.objectContaining({
        type: "INTEREST_ONLY",
        confidence: "high",
        reason: "ZERO_PRINCIPAL",
      }),
    );
    expect(result.samples).toEqual(
      installments.map((inst) => ({ ...inst, balanceBefore: 300000 })),
    );
    expectNothingWritten();
  });

  it("reads only the installments at the latest rate, so a rate change is not taken for a method", async () => {
    // LINEAR, 833.33 a month, 2% until a rise to 4% on 2027-01-01.
    rateChangesRepository.find.mockResolvedValue([
      { effectiveDate: "2024-01-01", annualRate: 2 },
      { effectiveDate: "2027-01-01", annualRate: 4 },
    ]);
    const { installments, endDebt } = priceInstallments(
      236666.67,
      ["2026-11-01", "2026-12-01", "2027-01-01", "2027-02-01"],
      (date) => (date < "2027-01-01" ? 0.02 : 0.04) / 12,
      () => 833.33,
    );
    useLedger(installments);
    const account = makeMortgage({
      mortgageType: "LINEAR",
      isCanadianMortgage: false,
      interestRate: 2,
      currentBalance: -endDebt,
    });

    const result = await service.detectMortgageTypeFromHistory(account, userId);

    expect(result.quotedAnnualRate).toBe(4);
    expect(result.samples.map((s) => s.date)).toEqual([
      "2027-01-01",
      "2027-02-01",
    ]);
    expect(result).toEqual(
      expect.objectContaining({
        type: "LINEAR",
        confidence: "high",
        reason: "CONSTANT_PRINCIPAL",
      }),
    );
    expectNothingWritten();
  });

  it("answers no type, with the reason, when the ledger holds no installment with its interest", async () => {
    transactionsRepository.find.mockResolvedValue([]);

    const result = await service.detectMortgageTypeFromHistory(
      makeMortgage(),
      userId,
    );

    expect(result).toEqual({
      type: null,
      confidence: "low",
      reason: "TOO_FEW_SAMPLES",
      quotedAnnualRate: 5.24,
      paymentFrequency: "MONTHLY",
      samples: [],
    });
    expectNothingWritten();
  });

  it("refuses an account that is not a mortgage before reading its ledger", async () => {
    await expect(
      service.detectMortgageTypeFromHistory(
        makeMortgage({ accountType: AccountType.LOAN }),
        userId,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(transactionsRepository.find).not.toHaveBeenCalled();
  });

  describe("sample building", () => {
    function useHistory(history: InstallmentHistory): void {
      transactionsRepository.find.mockResolvedValue([]);
      jest
        .spyOn(detector, "buildInstallmentHistory")
        .mockResolvedValue(history);
    }

    const record = (
      date: string,
      amount: number,
      principalAmount: number | null,
      interestAmount: number | null,
    ) => ({
      date,
      amount,
      sourceAccountId: chequingId,
      sourceAccountName: "Chequing",
      interestAmount,
      principalAmount,
      extraPrincipalAmount: null,
      principalSplitAmounts: [],
      interestCategoryId: "cat-interest",
      interestCategoryName: "Mortgage Interest",
    });

    it("takes the payment's own amount as its principal where interest is a separate expense", async () => {
      useHistory({
        payments: [
          record("2024-01-01", 833.33, null, 500),
          record("2024-02-01", 833.33, null, 498.61),
        ],
        balanceMap: new Map([
          ["2024-01-01", 300000],
          ["2024-02-01", 299166.67],
        ]),
        interestBookedSeparately: true,
      });

      const result = await service.detectMortgageTypeFromHistory(
        makeMortgage({ interestRate: 2, mortgageType: "LINEAR" }),
        userId,
      );

      expect(result.samples.map((s) => s.principal)).toEqual([833.33, 833.33]);
      expect(result.type).toBe("LINEAR");
    });

    it("leaves out a payment with no interest figure, or no principal it can name", async () => {
      useHistory({
        payments: [
          record("2024-01-01", 2370, 706.9, 1663.1),
          record("2024-01-15", 10000, null, null),
          record("2024-02-01", 2370, null, 1660.05),
          record("2024-03-01", 2370, 709.95, 1660.05),
        ],
        balanceMap: new Map([["2024-01-01", 385000]]),
        interestBookedSeparately: false,
      });

      const result = await service.detectMortgageTypeFromHistory(
        makeMortgage(),
        userId,
      );

      expect(result.samples).toEqual([
        {
          date: "2024-01-01",
          principal: 706.9,
          interest: 1663.1,
          balanceBefore: 385000,
        },
        {
          date: "2024-03-01",
          principal: 709.95,
          interest: 1660.05,
          balanceBefore: null,
        },
      ]);
    });

    it("cannot check the compounding of a mortgage with no rate or no mortgage frequency", async () => {
      const history: InstallmentHistory = {
        payments: [
          record("2024-01-01", 2370, 706.9, 1663.1),
          record("2024-02-01", 2370, 709.95, 1660.05),
        ],
        balanceMap: new Map([
          ["2024-01-01", 385000],
          ["2024-02-01", 384293.1],
        ]),
        interestBookedSeparately: false,
      };
      useHistory(history);

      const noRate = await service.detectMortgageTypeFromHistory(
        makeMortgage({ interestRate: null }),
        userId,
      );
      const noFrequency = await service.detectMortgageTypeFromHistory(
        makeMortgage({ paymentFrequency: null }),
        userId,
      );

      expect(noRate).toEqual(
        expect.objectContaining({
          type: "ANNUITY",
          confidence: "low",
          reason: "CONSTANT_INSTALLMENT_RATE_UNCHECKED",
          quotedAnnualRate: null,
        }),
      );
      expect(noFrequency).toEqual(
        expect.objectContaining({
          reason: "CONSTANT_INSTALLMENT_RATE_UNCHECKED",
          paymentFrequency: null,
        }),
      );
    });
  });
});

describe("LoanMortgageAccountService.detectMortgageTypeFromSamples", () => {
  it("passes the samples, the rate and the frequency to the detector", () => {
    const service = new LoanMortgageAccountService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    expect(
      service.detectMortgageTypeFromSamples({
        samples: [
          { principal: 437.83, interest: 1481.59, balanceBefore: 300000 },
          { principal: 440, interest: 1479.42, balanceBefore: 299562.17 },
        ],
        interestRate: 6,
        paymentFrequency: "MONTHLY",
      }),
    ).toEqual({
      type: "CANADIAN_FIXED",
      confidence: "high",
      reason: "CONSTANT_INSTALLMENT_SEMI_ANNUAL",
    });
    expect(
      service.detectMortgageTypeFromSamples({
        samples: [
          { principal: 437.83, interest: 1481.59 },
          { principal: 440, interest: 1479.42 },
        ],
        paymentFrequency: "MONTHLY",
      }).reason,
    ).toBe("CONSTANT_INSTALLMENT_RATE_UNCHECKED");
  });
});
