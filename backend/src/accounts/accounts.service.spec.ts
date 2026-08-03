import { Test, TestingModule } from "@nestjs/testing";
import { I18nContext } from "nestjs-i18n";
import { getRepositoryToken } from "@nestjs/typeorm";
import { NotFoundException, BadRequestException } from "@nestjs/common";
import { AccountsService } from "./accounts.service";
import {
  Account,
  AccountType,
  AccountSubType,
} from "./entities/account.entity";
import { Transaction } from "../transactions/entities/transaction.entity";
import { InvestmentTransaction } from "../securities/entities/investment-transaction.entity";
import { Institution } from "../institutions/entities/institution.entity";
import { CategoriesService } from "../categories/categories.service";
import { ScheduledTransactionsService } from "../scheduled-transactions/scheduled-transactions.service";
import { NetWorthService } from "../net-worth/net-worth.service";
import { PortfolioService } from "../securities/portfolio.service";
import { LoanMortgageAccountService } from "./loan-mortgage-account.service";
import { LoanRateChangesService } from "../loan-rate-changes/loan-rate-changes.service";
import { DataSource } from "typeorm";
import { ActionHistoryService } from "../action-history/action-history.service";
import {
  createScopedDbMocks,
  DataSourceMock,
} from "../test-helpers/scoped-db-testing";

jest.mock("../common/db/scoped-db", () =>
  jest.requireActual("../test-helpers/scoped-db-testing").scopedDbMockModule(),
);

describe("AccountsService", () => {
  let service: AccountsService;
  let accountsRepository: Record<string, jest.Mock>;
  let transactionRepository: Record<string, jest.Mock>;
  let investmentTxRepository: Record<string, jest.Mock>;
  let institutionsRepository: Record<string, jest.Mock>;
  let scheduledTransactionsService: Record<string, jest.Mock>;
  let categoriesService: Record<string, jest.Mock>;
  let netWorthService: Record<string, jest.Mock>;
  let mockQueryRunner: Record<string, any>;
  let mockDataSource: DataSourceMock;
  let mockActionHistoryService: Record<string, jest.Mock>;
  let loanRateChangesService: Record<string, jest.Mock>;
  // loanMortgageService uses the real class with mocked repositories

  const mockAccount = {
    id: "account-1",
    userId: "user-1",
    name: "Checking",
    accountType: "CHEQUING",
    currencyCode: "USD",
    openingBalance: 1000,
    currentBalance: 1500,
    isClosed: false,
    linkedAccountId: null,
    accountSubType: null,
    scheduledTransactionId: null,
    excludeFromNetWorth: false,
  };

  beforeEach(async () => {
    accountsRepository = {
      create: jest
        .fn()
        .mockImplementation((data) => ({ ...data, id: "new-account" })),
      save: jest.fn().mockImplementation((data) => data),
      findOne: jest.fn(),
      findOneOrFail: jest.fn(),
      find: jest.fn(),
      remove: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      query: jest.fn(),
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      })),
    };

    transactionRepository = {
      count: jest.fn().mockResolvedValue(0),
      createQueryBuilder: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      })),
    };

    investmentTxRepository = {
      count: jest.fn().mockResolvedValue(0),
      createQueryBuilder: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      })),
    };

    scheduledTransactionsService = {
      create: jest.fn().mockResolvedValue({ id: "sched-tx-1" }),
      update: jest.fn().mockResolvedValue({}),
      remove: jest.fn(),
    };

    loanRateChangesService = {
      create: jest.fn().mockImplementation((_userId, _accountId, dto) =>
        Promise.resolve({
          id: "rate-change-1",
          effectiveDate: dto.effectiveDate,
          annualRate: dto.annualRate,
          newPaymentAmount:
            dto.newPaymentAmount ?? (dto.recalculatePayment ? 1450.25 : null),
          source: "manual",
        }),
      ),
    };

    categoriesService = {
      findLoanCategories: jest.fn().mockResolvedValue({
        interestCategory: { id: "interest-cat-1" },
      }),
    };

    netWorthService = {
      recalculateAccount: jest.fn().mockResolvedValue(undefined),
      getMonthlyNetWorth: jest.fn().mockResolvedValue([]),
      getLatestNetWorth: jest.fn().mockResolvedValue(null),
    };

    mockActionHistoryService = {
      record: jest.fn().mockResolvedValue(null),
    };

    institutionsRepository = {
      findOne: jest.fn().mockResolvedValue({ id: "inst-1" }),
      find: jest.fn().mockResolvedValue([]),
    };

    const { manager: txManager, dataSource } = createScopedDbMocks([
      [Account, accountsRepository],
      [Transaction, transactionRepository],
      [InvestmentTransaction, investmentTxRepository],
      [Institution, institutionsRepository],
    ]);
    mockDataSource = dataSource;
    txManager.save.mockImplementation((data) => data);
    txManager.remove.mockImplementation((data) => data);
    txManager.count.mockResolvedValue(0);
    txManager.query.mockResolvedValue([]);
    // Transaction-block tests address the manager through this legacy alias.
    mockQueryRunner = { manager: txManager, query: txManager.query };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountsService,
        LoanMortgageAccountService,
        { provide: getRepositoryToken(Account), useValue: accountsRepository },
        {
          provide: getRepositoryToken(Transaction),
          useValue: transactionRepository,
        },
        {
          provide: getRepositoryToken(InvestmentTransaction),
          useValue: investmentTxRepository,
        },
        {
          provide: getRepositoryToken(Institution),
          useValue: institutionsRepository,
        },
        { provide: CategoriesService, useValue: categoriesService },
        {
          provide: ScheduledTransactionsService,
          useValue: scheduledTransactionsService,
        },
        { provide: NetWorthService, useValue: netWorthService },
        {
          provide: PortfolioService,
          useValue: {
            getAccountMarketValues: jest.fn().mockResolvedValue(new Map()),
          },
        },
        {
          provide: ActionHistoryService,
          useValue: mockActionHistoryService,
        },
        LoanMortgageAccountService,
        {
          provide: LoanRateChangesService,
          useValue: loanRateChangesService,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    service = module.get<AccountsService>(AccountsService);
  });

  describe("findOne", () => {
    it("returns account when found and belongs to user", async () => {
      accountsRepository.findOne.mockResolvedValue(mockAccount);

      const result = await service.findOne("user-1", "account-1");
      expect(result).toEqual(mockAccount);
    });

    it("throws NotFoundException when account not found", async () => {
      accountsRepository.findOne.mockResolvedValue(null);

      await expect(service.findOne("user-1", "nonexistent")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws NotFoundException when account belongs to different user", async () => {
      accountsRepository.findOne.mockResolvedValue(null);

      await expect(service.findOne("user-1", "account-1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("create", () => {
    it("creates a basic account with opening balance", async () => {
      await service.create("user-1", {
        name: "New Account",
        accountType: AccountType.CHEQUING,
        currencyCode: "USD",
        openingBalance: 500,
      } as any);

      const createCall = accountsRepository.create.mock.calls[0][0];
      expect(createCall.openingBalance).toBe(500);
      expect(createCall.currentBalance).toBe(500);
      expect(createCall.userId).toBe("user-1");
      expect(accountsRepository.save).toHaveBeenCalled();
    });

    it("assigns a valid owned institution", async () => {
      await service.create("user-1", {
        name: "Bank Account",
        accountType: AccountType.CHEQUING,
        currencyCode: "USD",
        institutionId: "inst-1",
      } as any);

      expect(institutionsRepository.findOne).toHaveBeenCalledWith({
        where: { id: "inst-1", userId: "user-1" },
        select: { id: true },
      });
      const createCall = accountsRepository.create.mock.calls[0][0];
      expect(createCall.institutionId).toBe("inst-1");
    });

    it("rejects an institution that does not belong to the user", async () => {
      institutionsRepository.findOne.mockResolvedValue(null);

      await expect(
        service.create("user-1", {
          name: "Bank Account",
          accountType: AccountType.CHEQUING,
          currencyCode: "USD",
          institutionId: "someone-elses",
        } as any),
      ).rejects.toThrow(BadRequestException);
      expect(accountsRepository.save).not.toHaveBeenCalled();
    });

    it("defaults opening balance to 0", async () => {
      await service.create("user-1", {
        name: "Zero Balance",
        accountType: AccountType.SAVINGS,
        currencyCode: "USD",
      } as any);

      const createCall = accountsRepository.create.mock.calls[0][0];
      expect(createCall.openingBalance).toBe(0);
      expect(createCall.currentBalance).toBe(0);
    });

    it("creates an account with a foreign-transaction fee percentage", async () => {
      await service.create("user-1", {
        name: "Travel Card",
        accountType: AccountType.CREDIT_CARD,
        currencyCode: "USD",
        fxFeePercent: 2.5,
      } as any);

      const createCall = accountsRepository.create.mock.calls[0][0];
      expect(createCall.fxFeePercent).toBe(2.5);
    });

    it("creates a credit card account with statement date fields", async () => {
      await service.create("user-1", {
        name: "Visa Card",
        accountType: AccountType.CREDIT_CARD,
        currencyCode: "USD",
        creditLimit: 5000,
        statementDueDay: 15,
        statementSettlementDay: 25,
      } as any);

      const createCall = accountsRepository.create.mock.calls[0][0];
      expect(createCall.statementDueDay).toBe(15);
      expect(createCall.statementSettlementDay).toBe(25);
      expect(createCall.accountType).toBe(AccountType.CREDIT_CARD);
    });

    it("creates a credit card account without statement date fields", async () => {
      await service.create("user-1", {
        name: "Mastercard",
        accountType: AccountType.CREDIT_CARD,
        currencyCode: "USD",
        creditLimit: 10000,
      } as any);

      const createCall = accountsRepository.create.mock.calls[0][0];
      expect(createCall.statementDueDay).toBeUndefined();
      expect(createCall.statementSettlementDay).toBeUndefined();
    });

    it("strips statement date fields from non-credit-card accounts", async () => {
      await service.create("user-1", {
        name: "My Savings",
        accountType: AccountType.SAVINGS,
        currencyCode: "USD",
        statementDueDay: 15,
        statementSettlementDay: 25,
      } as any);

      const createCall = accountsRepository.create.mock.calls[0][0];
      expect(createCall.statementDueDay).toBeUndefined();
      expect(createCall.statementSettlementDay).toBeUndefined();
    });

    it("records action history on create", async () => {
      await service.create("user-1", {
        name: "New Account",
        accountType: AccountType.CHEQUING,
        currencyCode: "USD",
      } as any);

      expect(mockActionHistoryService.record).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining({
          entityType: "account",
          action: "create",
          description: expect.stringContaining("New Account"),
        }),
      );
    });
  });

  describe("findAll", () => {
    it("stays strictly owner-scoped -- AI/MCP listings exclude joint accounts (N2)", async () => {
      // The joint-account union happens only in the HTTP controller. Every
      // other consumer of findAll -- AI tools, MCP, internal summaries --
      // deliberately sees own accounts only (joint-accounts spec, N2 scope
      // cut). This pins the predicate so a widened findAll fails loudly.
      const where = jest.fn().mockReturnThis();
      const getMany = jest.fn().mockResolvedValue([]);
      accountsRepository.createQueryBuilder.mockReturnValue({
        where,
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany,
      });

      await service.findAll("user-1");

      expect(where).toHaveBeenCalledWith("account.userId = :userId", {
        userId: "user-1",
      });
    });
  });

  describe("updateBalance", () => {
    /**
     * The guarded UPDATE reports whether it matched a row.
     *
     * `is_closed = false` is a predicate of the write, not of a read that came
     * before it: a separate check let a mutation of an existing transaction read
     * the account as open, wait behind `close()`, and then add its delta to a row
     * that had since been closed at zero (audit P4-008). So the double has to
     * answer the way the statement does -- a row, or nothing.
     */
    function stageBalanceUpdate(matched: boolean): void {
      mockQueryRunner.query.mockImplementation(async (sql: string) =>
        String(sql).includes("UPDATE accounts") && matched
          ? [[{ id: "account-1" }], 1]
          : [[], 0],
      );
    }

    it("adds positive amount to balance", async () => {
      stageBalanceUpdate(true);
      accountsRepository.findOneOrFail.mockResolvedValue({
        ...mockAccount,
        currentBalance: 1500,
      });

      const result = await service.updateBalance("account-1", 500);

      const [sql, params] = mockQueryRunner.query.mock.calls[0];
      expect(sql).toContain("current_balance AS numeric) + $1");
      expect(sql).toContain("is_closed = false");
      expect(sql).toContain("RETURNING");
      expect(params).toEqual([500, "account-1"]);
      expect(result.currentBalance).toBe(1500);
    });

    it("subtracts negative amount from balance", async () => {
      stageBalanceUpdate(true);
      accountsRepository.findOneOrFail.mockResolvedValue({
        ...mockAccount,
        currentBalance: 700,
      });

      const result = await service.updateBalance("account-1", -300);

      expect(mockQueryRunner.query.mock.calls[0][1]).toEqual([
        -300,
        "account-1",
      ]);
      expect(result.currentBalance).toBe(700);
    });

    it("throws NotFoundException when account not found", async () => {
      stageBalanceUpdate(false);
      accountsRepository.findOne.mockResolvedValue(null);

      await expect(service.updateBalance("nonexistent", 100)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws BadRequestException for closed accounts", async () => {
      // No row matched and the account exists: it is closed. Told apart so the
      // caller gets 400 rather than one ambiguous error.
      stageBalanceUpdate(false);
      accountsRepository.findOne.mockResolvedValue({
        ...mockAccount,
        isClosed: true,
      });

      await expect(service.updateBalance("account-1", 100)).rejects.toThrow(
        "Cannot modify balance of a closed account",
      );
    });

    it("refuses the delta when close() committed while the ledger write waited", async () => {
      // The regression guard for P4-008: an unvoid read the account as open, the
      // close committed at zero, and the delta then landed on the closed row --
      // a closed account holding -10.00. Re-evaluating the predicate after the
      // row lock refuses instead, and the throw rolls the ledger mutation back
      // with it.
      stageBalanceUpdate(false);
      accountsRepository.findOne.mockResolvedValue({
        ...mockAccount,
        isClosed: true,
      });

      await expect(
        service.updateBalance("account-1", -10),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(accountsRepository.findOneOrFail).not.toHaveBeenCalled();
    });

    it("rounds to 4 decimal places to match DB schema precision", async () => {
      stageBalanceUpdate(true);
      accountsRepository.findOneOrFail.mockResolvedValue({
        ...mockAccount,
        currentBalance: 20.3,
      });

      const result = await service.updateBalance("account-1", 10.2);

      expect(mockQueryRunner.query.mock.calls[0][0]).toContain("ROUND(");
      expect(result.currentBalance).toBe(20.3);
    });

    it("uses atomic SQL arithmetic to prevent race conditions", async () => {
      stageBalanceUpdate(true);
      accountsRepository.findOneOrFail.mockResolvedValue({
        ...mockAccount,
        currentBalance: 1100,
      });

      await service.updateBalance("account-1", 100);

      expect(mockQueryRunner.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE accounts"),
        [100, "account-1"],
      );
    });
  });

  describe("recalculateCurrentBalance", () => {
    /**
     * The recomputation locks the account rows and then reads the ledger.
     *
     * That order is the fix, not a detail: it writes an absolute balance, and
     * under READ COMMITTED its SELECT and its UPDATE are separate statement
     * snapshots -- so a delta committing between them used to be overwritten by a
     * total that never saw it (audit P4-005). The double answers the lock, the
     * sum, and the write in the order the transaction issues them.
     */
    function stageRecalc(balanceRows: unknown[]): jest.Mock {
      const query = jest.fn().mockImplementation(async (sql: string) => {
        if (String(sql).includes("FOR UPDATE")) return [{ id: "account-1" }];
        if (String(sql).includes("COALESCE(SUM(t.amount)")) return balanceRows;
        return [];
      });
      (mockQueryRunner.manager as unknown as { query: jest.Mock }).query = query;
      return query;
    }

    it("throws NotFoundException when the account is gone", async () => {
      // The ledger sum joins from `accounts`, so no row means no account.
      stageRecalc([]);
      await expect(service.recalculateCurrentBalance("nope")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("computes the new balance from the summed transactions", async () => {
      stageRecalc([{ balance: "150.5" }]);
      accountsRepository.findOneOrFail.mockResolvedValue({
        ...mockAccount,
        currentBalance: 150.5,
      });

      const result = await service.recalculateCurrentBalance("account-1");

      expect(result.currentBalance).toBe(150.5);
    });

    it("locks the account before reading the ledger", async () => {
      const query = stageRecalc([{ balance: "150.5" }]);
      accountsRepository.findOneOrFail.mockResolvedValue({ ...mockAccount });

      await service.recalculateCurrentBalance("account-1");

      const statements = query.mock.calls.map((c) => String(c[0]));
      const lockAt = statements.findIndex((sql) => sql.includes("FOR UPDATE"));
      const sumAt = statements.findIndex((sql) =>
        sql.includes("COALESCE(SUM(t.amount)"),
      );
      expect(lockAt).toBeGreaterThanOrEqual(0);
      expect(lockAt).toBeLessThan(sumAt);
    });

    it("writes only current_balance, never the whole account row", async () => {
      // Saving the entity read before the transaction would write back every
      // other column from that snapshot, so a concurrent rename or
      // opening-balance edit would be reverted by a balance recalculation.
      const query = stageRecalc([{ balance: "275.5" }]);
      accountsRepository.findOneOrFail.mockResolvedValue({
        ...mockAccount,
        currentBalance: 275.5,
      });

      const result = await service.recalculateCurrentBalance("account-1");

      expect(result.currentBalance).toBe(275.5);
      expect(accountsRepository.save).not.toHaveBeenCalled();
      const write = query.mock.calls
        .map((c) => String(c[0]))
        .find((sql) => sql.startsWith("UPDATE accounts"));
      expect(write).toBe(
        "UPDATE accounts SET current_balance = $1 WHERE id = $2",
      );
    });
  });

  describe("getProjectedBalance", () => {
    it("returns 0 when no rows", async () => {
      const ds = mockQueryRunner.manager as unknown as { query: jest.Mock };
      ds.query = jest.fn().mockResolvedValue([]);
      const v = await service.getProjectedBalance("user-1", "account-1");
      expect(v).toBe(0);
    });

    it("returns rounded balance from query result", async () => {
      const ds = mockQueryRunner.manager as unknown as { query: jest.Mock };
      ds.query = jest.fn().mockResolvedValue([{ balance: "1234.56789" }]);
      const v = await service.getProjectedBalance("user-1", "account-1");
      expect(v).toBe(1234.5679);
    });
  });

  describe("getLlmAccounts", () => {
    const allAccounts = [
      {
        id: "a1",
        userId: "user-1",
        name: "Checking",
        accountType: AccountType.CHEQUING,
        accountSubType: null,
        currencyCode: "USD",
        currentBalance: 100,
        futureTransactionsSum: 0,
        creditLimit: null,
        interestRate: null,
        excludeFromNetWorth: false,
        institutionId: "inst-1",
        accountNumber: "1234",
        isClosed: false,
      },
      {
        id: "a2",
        userId: "user-1",
        name: "Savings",
        accountType: AccountType.SAVINGS,
        accountSubType: null,
        currencyCode: "USD",
        currentBalance: 200,
        futureTransactionsSum: 0,
        creditLimit: 5000,
        interestRate: 1.25,
        excludeFromNetWorth: true,
        institutionId: null,
        accountNumber: null,
        isClosed: true,
      },
      {
        id: "a3",
        userId: "user-1",
        name: "Brokerage",
        accountType: AccountType.INVESTMENT,
        accountSubType: AccountSubType.INVESTMENT_BROKERAGE,
        currencyCode: "USD",
        currentBalance: 500,
        futureTransactionsSum: 0,
        creditLimit: null,
        interestRate: null,
        excludeFromNetWorth: false,
        institutionId: null,
        accountNumber: null,
        isClosed: false,
      },
    ];

    beforeEach(() => {
      jest.spyOn(service, "findAll").mockResolvedValue(allAccounts as never);
      (
        netWorthService as unknown as Record<string, jest.Mock>
      ).getLatestNetWorth = jest
        .fn()
        .mockResolvedValue({ assets: 800, liabilities: 0, netWorth: 800 });
      (
        service["portfolioService"] as unknown as {
          getAccountMarketValues: jest.Mock;
        }
      ).getAccountMarketValues = jest
        .fn()
        .mockResolvedValue(new Map([["a3", 750]]));
      institutionsRepository.find = jest
        .fn()
        .mockResolvedValue([{ id: "inst-1", name: "Big Bank" }]);
    });

    it("status defaults to open and filters closed accounts", async () => {
      const r = await service.getLlmAccounts("user-1");
      expect(r.accounts.find((a) => a.name === "Savings")).toBeUndefined();
      expect(r.totalAccounts).toBe(2);
    });

    it("status=closed only returns closed", async () => {
      const r = await service.getLlmAccounts("user-1", { status: "closed" });
      expect(r.accounts.length).toBe(1);
      expect(r.accounts[0].name).toBe("Savings");
      expect(r.totalAccounts).toBe(1);
    });

    it("status=all returns everything", async () => {
      const r = await service.getLlmAccounts("user-1", { status: "all" });
      expect(r.accounts.length).toBe(3);
      expect(r.totalAccounts).toBe(3);
    });

    it("filters by accountTypes", async () => {
      const r = await service.getLlmAccounts("user-1", {
        status: "all",
        accountTypes: [AccountType.CHEQUING],
      });
      expect(r.accounts.length).toBe(1);
      expect(r.accounts[0].name).toBe("Checking");
    });

    it("filters by accountNames (case-insensitive)", async () => {
      const r = await service.getLlmAccounts("user-1", {
        status: "all",
        accountNames: ["checking"],
      });
      expect(r.accounts.length).toBe(1);
      expect(r.accounts[0].name).toBe("Checking");
    });

    it("filters by accountIds", async () => {
      const r = await service.getLlmAccounts("user-1", {
        status: "all",
        accountIds: ["a2"],
      });
      expect(r.accounts.length).toBe(1);
      expect(r.accounts[0].id).toBe("a2");
    });

    it("filters by nameQuery substring (case-insensitive)", async () => {
      const r = await service.getLlmAccounts("user-1", {
        status: "all",
        nameQuery: "ING",
      });
      const names = r.accounts.map((a) => a.name).sort();
      expect(names).toEqual(["Checking", "Savings"]);
    });

    it("uses market value for brokerage accounts and currentBalance for others", async () => {
      const r = await service.getLlmAccounts("user-1", { status: "all" });
      const brokerage = r.accounts.find((a) => a.name === "Brokerage")!;
      const checking = r.accounts.find((a) => a.name === "Checking")!;
      expect(brokerage.balance).toBe(750);
      expect(brokerage.currentBalance).toBe(500);
      expect(checking.balance).toBe(100);
    });

    it("exposes full per-account detail incl. null credit/interest/institution", async () => {
      const r = await service.getLlmAccounts("user-1", { status: "all" });
      const checking = r.accounts.find((a) => a.name === "Checking")!;
      const brokerage = r.accounts.find((a) => a.name === "Brokerage")!;
      const savings = r.accounts.find((a) => a.name === "Savings")!;

      expect(checking.creditLimit).toBeNull();
      expect(checking.interestRate).toBeNull();
      expect(checking.institutionName).toBe("Big Bank");
      expect(checking.accountNumber).toBe("1234");
      expect(checking.excludeFromNetWorth).toBe(false);
      // Loan fields are null on non-debt accounts
      expect(checking.paymentAmount).toBeNull();
      expect(checking.paymentFrequency).toBeNull();
      expect(checking.paymentStartDate).toBeNull();
      expect(checking.amortizationMonths).toBeNull();
      expect(checking.originalPrincipal).toBeNull();

      expect(savings.creditLimit).toBe(5000);
      expect(savings.interestRate).toBe(1.25);
      expect(savings.excludeFromNetWorth).toBe(true);
      expect(savings.institutionName).toBeNull();
      expect(savings.accountNumber).toBeNull();

      expect(brokerage.subType).toBe(AccountSubType.INVESTMENT_BROKERAGE);
      expect(brokerage.institutionName).toBeNull();
    });

    it("exposes loan/mortgage schedule fields for debt accounts", async () => {
      const loan = {
        id: "l1",
        userId: "user-1",
        name: "Car Loan",
        accountType: AccountType.LOAN,
        accountSubType: null,
        currencyCode: "USD",
        currentBalance: -8000,
        futureTransactionsSum: 0,
        creditLimit: null,
        interestRate: 6,
        excludeFromNetWorth: false,
        institutionId: null,
        accountNumber: null,
        isClosed: false,
        paymentAmount: 500,
        paymentFrequency: "MONTHLY",
        paymentStartDate: "2024-02-01",
        amortizationMonths: 60,
        originalPrincipal: 20000,
      };
      jest.spyOn(service, "findAll").mockResolvedValue([loan] as never);
      const r = await service.getLlmAccounts("user-1", { status: "all" });
      const car = r.accounts.find((a) => a.name === "Car Loan")!;
      expect(car.paymentAmount).toBe(500);
      expect(car.paymentFrequency).toBe("MONTHLY");
      expect(car.paymentStartDate).toBe("2024-02-01");
      expect(car.amortizationMonths).toBe(60);
      expect(car.originalPrincipal).toBe(20000);
    });

    it("skips the institution lookup when no account references one", async () => {
      const r = await service.getLlmAccounts("user-1", {
        status: "all",
        accountIds: ["a3"],
      });
      expect(institutionsRepository.find).not.toHaveBeenCalled();
      expect(r.accounts[0].institutionName).toBeNull();
    });

    it("returns null institutionName when the institution is not found", async () => {
      institutionsRepository.find = jest.fn().mockResolvedValue([]);
      const r = await service.getLlmAccounts("user-1", {
        status: "all",
        accountIds: ["a1"],
      });
      expect(r.accounts[0].institutionName).toBeNull();
    });

    it("returns totals from the latest net worth snapshot", async () => {
      const r = await service.getLlmAccounts("user-1", { status: "all" });
      expect(r.totalAssets).toBe(800);
      expect(r.totalLiabilities).toBe(0);
      expect(r.netWorth).toBe(800);
    });

    it("falls back to 0 totals when the net worth snapshot is null", async () => {
      (
        netWorthService as unknown as Record<string, jest.Mock>
      ).getLatestNetWorth = jest.fn().mockResolvedValue(null);
      const r = await service.getLlmAccounts("user-1");
      expect(r.totalAssets).toBe(0);
      expect(r.totalLiabilities).toBe(0);
      expect(r.netWorth).toBe(0);
    });
  });

  describe("resetBrokerageBalances", () => {
    it("returns 0 when affected is undefined", async () => {
      accountsRepository.update.mockResolvedValue({});
      const n = await service.resetBrokerageBalances("user-1");
      expect(n).toBe(0);
    });

    it("returns affected count", async () => {
      accountsRepository.update.mockResolvedValue({ affected: 3 });
      const n = await service.resetBrokerageBalances("user-1");
      expect(n).toBe(3);
    });
  });

  describe("getDailyBalances", () => {
    it("uses provided endDate without extending", async () => {
      const ds = mockQueryRunner.manager as unknown as { query: jest.Mock };
      ds.query = jest.fn().mockResolvedValue([]);
      await service.getDailyBalances("user-1", "2024-01-01", "2024-12-31", [
        "a1",
      ]);
      // Only the main rows query runs; no max-date probing
      expect(ds.query).toHaveBeenCalledTimes(1);
    });

    it("extends end to maxFutureDate when no endDate", async () => {
      const ds = mockQueryRunner.manager as unknown as { query: jest.Mock };
      ds.query = jest
        .fn()
        .mockResolvedValueOnce([{ max_date: "2099-01-01" }])
        .mockResolvedValueOnce([
          {
            date: "2024-01-01",
            balance: "100",
            account_id: "a1",
            currency_code: "USD",
          },
        ]);
      const r = await service.getDailyBalances("user-1");
      expect(r.length).toBe(1);
      expect(r[0].balance).toBe(100);
    });

    it("uses default startDate when none provided", async () => {
      const ds = mockQueryRunner.manager as unknown as { query: jest.Mock };
      ds.query = jest
        .fn()
        .mockResolvedValueOnce([{ max_date: null }])
        .mockResolvedValueOnce([]);
      const r = await service.getDailyBalances("user-1");
      expect(r).toEqual([]);
    });

    it("treats no/empty accountIds as null filter", async () => {
      const ds = mockQueryRunner.manager as unknown as { query: jest.Mock };
      ds.query = jest.fn().mockResolvedValue([]);
      await service.getDailyBalances("user-1", "2024-01-01", "2024-12-31", []);
      expect(ds.query).toHaveBeenCalled();
    });

    it("keeps every day (step 1) for ranges within the point budget", async () => {
      const ds = mockQueryRunner.manager as unknown as { query: jest.Mock };
      ds.query = jest.fn().mockResolvedValue([]);
      await service.getDailyBalances("user-1", "2024-01-01", "2024-12-31", [
        "a1",
      ]);
      const params = ds.query.mock.calls[0][1];
      expect(params[2]).toBe("2024-01-01");
      expect(params[3]).toBe("2024-12-31");
      expect(params[4]).toBe(1); // 366 days <= 400 -> no downsampling
    });

    it("downsamples wide ranges with a step greater than 1", async () => {
      const ds = mockQueryRunner.manager as unknown as { query: jest.Mock };
      ds.query = jest.fn().mockResolvedValue([]);
      await service.getDailyBalances("user-1", "2010-01-01", "2024-12-31", [
        "a1",
      ]);
      const params = ds.query.mock.calls[0][1];
      expect(params[4]).toBeGreaterThan(1); // ~5479 days / 400 -> step 14
    });

    it("spans earliest to latest transaction when allTime and no startDate", async () => {
      const ds = mockQueryRunner.manager as unknown as { query: jest.Mock };
      ds.query = jest
        .fn()
        // allTime -> combined MIN/MAX probe (no separate future-extension probe)
        .mockResolvedValueOnce([
          { min_date: "2015-06-01", max_date: "2021-03-15" },
        ])
        // main rows query
        .mockResolvedValueOnce([]);
      await service.getDailyBalances(
        "user-1",
        undefined,
        undefined,
        ["a1"],
        true,
      );
      // Only the MIN/MAX probe and the main query run in all-time mode.
      expect(ds.query).toHaveBeenCalledTimes(2);
      const params = ds.query.mock.calls[1][1];
      expect(params[2]).toBe("2015-06-01"); // start = earliest transaction
      expect(params[3]).toBe("2021-03-15"); // end clamped to latest transaction
    });

    it("falls back to the one-year default and today when allTime finds no transactions", async () => {
      const ds = mockQueryRunner.manager as unknown as { query: jest.Mock };
      ds.query = jest
        .fn()
        .mockResolvedValueOnce([{ min_date: null, max_date: null }])
        .mockResolvedValueOnce([]);
      await service.getDailyBalances(
        "user-1",
        undefined,
        undefined,
        ["a1"],
        true,
      );
      const params = ds.query.mock.calls[1][1];
      expect(params[2]).toMatch(/^\d{4}-\d{2}-\d{2}$/); // start = one year ago
      expect(params[3]).toMatch(/^\d{4}-\d{2}-\d{2}$/); // end = today (not clamped)
    });

    it("does not probe for earliest transaction when startDate is given", async () => {
      const ds = mockQueryRunner.manager as unknown as { query: jest.Mock };
      ds.query = jest.fn().mockResolvedValue([]);
      await service.getDailyBalances(
        "user-1",
        "2024-01-01",
        "2024-12-31",
        ["a1"],
        true,
      );
      // endDate + startDate both supplied -> only the main query runs
      expect(ds.query).toHaveBeenCalledTimes(1);
      expect(ds.query.mock.calls[0][1][2]).toBe("2024-01-01");
    });
  });

  describe("applyDueTransactionBalances cron", () => {
    it("returns early when no users", async () => {
      const ds = mockQueryRunner.manager as unknown as { query: jest.Mock };
      // One sequenced mock serves both the timezone fan-out (still on
      // dataSource.query -- shared util, converted with a later R task) and the
      // per-timezone work that now runs through the withScopedDb manager.
      ds.query = mockDataSource.query = jest.fn().mockResolvedValue([]);
      await service.applyDueTransactionBalances();
      expect(ds.query).toHaveBeenCalledTimes(1);
    });

    it("skips invalid timezone users and continues", async () => {
      const ds = mockQueryRunner.manager as unknown as { query: jest.Mock };
      // One sequenced mock serves both the timezone fan-out (still on
      // dataSource.query -- shared util, converted with a later R task) and the
      // per-timezone work that now runs through the withScopedDb manager.
      ds.query = mockDataSource.query = jest
        .fn()
        // userRows
        .mockResolvedValueOnce([
          { user_id: "u1", timezone: "Invalid/Zone" },
          { user_id: "u2", timezone: null },
          { user_id: "u3", timezone: "browser" },
        ])
        // accountRows for UTC tz (u2 + u3) - empty so continues
        .mockResolvedValueOnce([]);
      await service.applyDueTransactionBalances();
      // Should not throw
    });

    it("processes due balances for valid timezone", async () => {
      const ds = mockQueryRunner.manager as unknown as { query: jest.Mock };
      // One sequenced mock serves both the timezone fan-out (still on
      // dataSource.query -- shared util, converted with a later R task) and the
      // per-timezone work that now runs through the withScopedDb manager.
      ds.query = mockDataSource.query = jest
        .fn()
        // userRows
        .mockResolvedValueOnce([{ user_id: "u1", timezone: "America/Toronto" }])
        // accountRows
        .mockResolvedValueOnce([{ account_id: "a1" }])
        // ...locked FOR UPDATE before the ledger is read, so the absolute write
        // cannot overwrite a delta that commits in between (audit P4-005)
        .mockResolvedValueOnce([{ id: "a1" }])
        // balances
        .mockResolvedValueOnce([{ account_id: "a1", balance: "150" }])
        // bulk UPDATE ... FROM (VALUES ...)
        .mockResolvedValueOnce(undefined);
      await service.applyDueTransactionBalances();
      // Balances applied via a single bulk UPDATE, not one update per account
      const bulkUpdateCall = ds.query.mock.calls.find(
        (c) =>
          typeof c[0] === "string" &&
          c[0].includes("UPDATE accounts SET current_balance"),
      );
      expect(bulkUpdateCall).toBeDefined();
      expect(bulkUpdateCall?.[1]).toEqual(["a1", 150]);
      expect(accountsRepository.update).not.toHaveBeenCalled();
      // And the lock came first.
      const statements = ds.query.mock.calls.map((c) => String(c[0]));
      expect(
        statements.findIndex((sql) => sql.includes("FOR UPDATE")),
      ).toBeLessThan(
        statements.findIndex((sql) => sql.includes("COALESCE(SUM(t.amount)")),
      );
    });

    it("logs error when query throws", async () => {
      const ds = mockQueryRunner.manager as unknown as { query: jest.Mock };
      // One sequenced mock serves both the timezone fan-out (still on
      // dataSource.query -- shared util, converted with a later R task) and the
      // per-timezone work that now runs through the withScopedDb manager.
      ds.query = mockDataSource.query = jest
        .fn()
        .mockRejectedValue(new Error("db down"));
      await service.applyDueTransactionBalances();
      // Should not throw
    });
  });

  describe("resolveByName", () => {
    it("returns the open account matching the name case-insensitively", async () => {
      jest.spyOn(service, "findAll").mockResolvedValue([
        { id: "a1", name: "Checking", currencyCode: "USD" },
        { id: "a2", name: "Savings", currencyCode: "CAD" },
      ] as never);

      const result = await service.resolveByName("user-1", "checking");
      expect(service.findAll).toHaveBeenCalledWith("user-1", false);
      expect(result).toEqual({
        id: "a1",
        name: "Checking",
        currencyCode: "USD",
      });
    });

    it("returns undefined when no open account matches", async () => {
      jest
        .spyOn(service, "findAll")
        .mockResolvedValue([
          { id: "a1", name: "Checking", currencyCode: "USD" },
        ] as never);
      const result = await service.resolveByName("user-1", "Nope");
      expect(result).toBeUndefined();
    });
  });

  describe("resolveAccountFilter", () => {
    it("returns accountIds: undefined when no names are supplied", async () => {
      const findAllSpy = jest.spyOn(service, "findAll");
      expect(await service.resolveAccountFilter("user-1")).toEqual({
        accountIds: undefined,
      });
      expect(await service.resolveAccountFilter("user-1", [])).toEqual({
        accountIds: undefined,
      });
      expect(findAllSpy).not.toHaveBeenCalled();
    });

    it("maps names to ids case-insensitively over open accounts", async () => {
      jest.spyOn(service, "findAll").mockResolvedValue([
        { id: "a1", name: "Checking", currencyCode: "USD" },
        { id: "a2", name: "RRSP", currencyCode: "CAD" },
      ] as never);

      const result = await service.resolveAccountFilter("user-1", [
        "checking",
        "RRSP",
      ]);
      expect(service.findAll).toHaveBeenCalledWith("user-1", false);
      expect(result).toEqual({ accountIds: ["a1", "a2"] });
    });

    it("returns a did-you-mean error when a name does not match", async () => {
      jest.spyOn(service, "findAll").mockResolvedValue([
        { id: "a1", name: "Checking", currencyCode: "USD" },
        { id: "a2", name: "Savings", currencyCode: "USD" },
      ] as never);

      const result = await service.resolveAccountFilter("user-1", ["Savngs"]);
      expect(result.accountIds).toBeUndefined();
      expect(result.error).toContain("Unknown account: Savngs.");
      expect(result.error).toContain("Did you mean 'Savings'?");
      expect(result.error).toContain("Call list_accounts");
    });

    it("errors on any unresolved name rather than running with a partial set", async () => {
      jest
        .spyOn(service, "findAll")
        .mockResolvedValue([
          { id: "a1", name: "Checking", currencyCode: "USD" },
        ] as never);

      const result = await service.resolveAccountFilter("user-1", [
        "Checking",
        "Nope",
      ]);
      expect(result.accountIds).toBeUndefined();
      expect(result.error).toContain("Unknown account: Nope.");
    });
  });

  describe("resolveBrokerageByName", () => {
    const rrspBrokerage = {
      id: "b1",
      name: "RRSP - Brokerage",
      currencyCode: "CAD",
      accountType: AccountType.INVESTMENT,
      accountSubType: AccountSubType.INVESTMENT_BROKERAGE,
    };
    const rrspCash = {
      id: "c1",
      name: "RRSP - Cash",
      currencyCode: "CAD",
      accountType: AccountType.INVESTMENT,
      accountSubType: AccountSubType.INVESTMENT_CASH,
    };

    it("returns an exact case-insensitive match over all open accounts", async () => {
      jest
        .spyOn(service, "findAll")
        .mockResolvedValue([
          rrspBrokerage,
          rrspCash,
          { id: "a1", name: "Checking", currencyCode: "USD" },
        ] as never);

      const result = await service.resolveBrokerageByName(
        "user-1",
        "rrsp - brokerage",
      );
      expect(service.findAll).toHaveBeenCalledWith("user-1", false);
      expect(result.match).toEqual({
        id: "b1",
        name: "RRSP - Brokerage",
        currencyCode: "CAD",
      });
      expect(result.candidates).toEqual([]);
    });

    it("resolves the base pair name to its brokerage account", async () => {
      jest
        .spyOn(service, "findAll")
        .mockResolvedValue([rrspBrokerage, rrspCash] as never);

      const result = await service.resolveBrokerageByName("user-1", "RRSP");
      expect(result.match).toEqual({
        id: "b1",
        name: "RRSP - Brokerage",
        currencyCode: "CAD",
      });
      expect(result.candidates).toEqual([]);
    });

    it("returns candidates when the base name is ambiguous", async () => {
      jest.spyOn(service, "findAll").mockResolvedValue([
        rrspBrokerage,
        {
          id: "b2",
          name: "RRSP - Brokerage",
          currencyCode: "CAD",
          accountType: AccountType.INVESTMENT,
          accountSubType: AccountSubType.INVESTMENT_BROKERAGE,
        },
      ] as never);

      const result = await service.resolveBrokerageByName("user-1", "RRSP");
      expect(result.match).toBeUndefined();
      expect(result.candidates).toEqual([
        { id: "b1", name: "RRSP - Brokerage" },
        { id: "b2", name: "RRSP - Brokerage" },
      ]);
    });

    it("does not match the cash half of the pair by its base name", async () => {
      jest.spyOn(service, "findAll").mockResolvedValue([rrspCash] as never);

      const result = await service.resolveBrokerageByName("user-1", "RRSP");
      expect(result.match).toBeUndefined();
      expect(result.candidates).toEqual([]);
    });

    it("returns no match when nothing matches", async () => {
      jest
        .spyOn(service, "findAll")
        .mockResolvedValue([rrspBrokerage] as never);

      const result = await service.resolveBrokerageByName("user-1", "TFSA");
      expect(result.match).toBeUndefined();
      expect(result.candidates).toEqual([]);
    });
  });
});
