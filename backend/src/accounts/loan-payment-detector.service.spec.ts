import { Test, TestingModule } from "@nestjs/testing";
import { DataSource } from "typeorm";
import { createScopedDbMocks } from "../test-helpers/scoped-db-testing";

jest.mock("../common/db/scoped-db", () =>
  jest.requireActual("../test-helpers/scoped-db-testing").scopedDbMockModule(),
);
import { NotFoundException } from "@nestjs/common";
import { LoanPaymentDetectorService } from "./loan-payment-detector.service";
import { Account, AccountType } from "./entities/account.entity";
import {
  Transaction,
  TransactionStatus,
} from "../transactions/entities/transaction.entity";

describe("LoanPaymentDetectorService", () => {
  let service: LoanPaymentDetectorService;
  let accountsRepository: any;
  let transactionRepository: any;

  const mockLoanAccount = {
    id: "loan-1",
    userId: "user-1",
    name: "Auto Loan",
    accountType: AccountType.LOAN,
    currentBalance: -15000,
    openingBalance: -20000,
    interestRate: 5.5,
    scheduledTransactionId: null,
  };

  const mockMortgageAccount = {
    id: "mortgage-1",
    userId: "user-1",
    name: "Home Mortgage",
    accountType: AccountType.MORTGAGE,
    currentBalance: -250000,
    openingBalance: -300000,
    interestRate: 4.25,
    scheduledTransactionId: null,
  };

  const mockChequingAccount = {
    id: "chequing-1",
    userId: "user-1",
    name: "Checking",
    accountType: AccountType.CHEQUING,
    currentBalance: 5000,
  };

  beforeEach(async () => {
    accountsRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
    };

    transactionRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      count: jest.fn(),
      manager: {
        find: jest.fn(),
      },
    };

    const { manager, dataSource } = createScopedDbMocks([
      [Account, accountsRepository],
      [Transaction, transactionRepository],
    ]);
    // The linked-transfer walk and the split lookup run on the transaction
    // manager now; route them at the same per-test mocks.
    manager.findOne.mockImplementation((_entity, opts) =>
      transactionRepository.findOne(opts),
    );
    manager.find.mockImplementation((_entity, opts) =>
      transactionRepository.manager.find(_entity, opts),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoanPaymentDetectorService,
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<LoanPaymentDetectorService>(
      LoanPaymentDetectorService,
    );
  });

  describe("detectPaymentPattern", () => {
    it("throws NotFoundException for unknown account", async () => {
      accountsRepository.findOne.mockResolvedValue(null);
      await expect(
        service.detectPaymentPattern("user-1", "nonexistent"),
      ).rejects.toThrow(NotFoundException);
    });

    it("returns null for non-loan account type", async () => {
      accountsRepository.findOne.mockResolvedValue(mockChequingAccount);
      const result = await service.detectPaymentPattern("user-1", "chequing-1");
      expect(result).toBeNull();
    });

    it("returns null when no transactions exist", async () => {
      accountsRepository.findOne.mockResolvedValue(mockLoanAccount);
      transactionRepository.find.mockResolvedValue([]);
      const result = await service.detectPaymentPattern("user-1", "loan-1");
      expect(result).toBeNull();
    });

    it("detects monthly payment pattern from regular transactions", async () => {
      accountsRepository.findOne.mockResolvedValue(mockLoanAccount);

      // Simulate 6 monthly payments of $500
      const payments: any[] = [];
      for (let i = 0; i < 6; i++) {
        const date = new Date(2025, i, 15);
        const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        payments.push({
          id: `tx-${i}`,
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: dateStr,
          amount: 500,
          isTransfer: true,
          isSplit: false,
          linkedTransactionId: `linked-${i}`,
        });
      }

      transactionRepository.find.mockResolvedValue(payments);

      // Mock linked transactions (source account)
      transactionRepository.findOne.mockImplementation(({ where }) => {
        if (where?.id?.startsWith("linked-")) {
          return Promise.resolve({
            id: where.id,
            accountId: "chequing-1",
            amount: -500,
            account: { name: "Checking" },
            isSplit: false,
          });
        }
        return Promise.resolve(null);
      });

      const result = await service.detectPaymentPattern("user-1", "loan-1");

      expect(result).not.toBeNull();
      expect(result!.paymentAmount).toBe(500);
      expect(result!.paymentFrequency).toBe("MONTHLY");
      expect(result!.sourceAccountId).toBe("chequing-1");
      expect(result!.sourceAccountName).toBe("Checking");
      expect(result!.paymentCount).toBe(6);
      expect(result!.currentBalance).toBe(15000);
      expect(result!.isMortgage).toBe(false);
      expect(result!.confidence).toBeGreaterThan(0.3);
    });

    it("detects biweekly payment pattern", async () => {
      accountsRepository.findOne.mockResolvedValue(mockLoanAccount);

      // Simulate biweekly payments (every 14 days)
      const payments: any[] = [];
      const startDate = new Date(2025, 0, 1);
      for (let i = 0; i < 8; i++) {
        const date = new Date(startDate);
        date.setDate(date.getDate() + i * 14);
        const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        payments.push({
          id: `tx-${i}`,
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: dateStr,
          amount: 250,
          isTransfer: false,
          isSplit: false,
          linkedTransactionId: null,
        });
      }

      transactionRepository.find.mockResolvedValue(payments);

      const result = await service.detectPaymentPattern("user-1", "loan-1");

      expect(result).not.toBeNull();
      expect(result!.paymentAmount).toBe(250);
      expect(result!.paymentFrequency).toBe("BIWEEKLY");
    });

    it("returns isMortgage true for mortgage accounts", async () => {
      accountsRepository.findOne.mockResolvedValue(mockMortgageAccount);

      const payments: any[] = [];
      for (let i = 0; i < 3; i++) {
        const date = new Date(2025, i, 1);
        const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
        payments.push({
          id: `tx-${i}`,
          accountId: "mortgage-1",
          userId: "user-1",
          transactionDate: dateStr,
          amount: 1500,
          isTransfer: false,
          isSplit: false,
          linkedTransactionId: null,
        });
      }

      transactionRepository.find.mockResolvedValue(payments);

      const result = await service.detectPaymentPattern("user-1", "mortgage-1");

      expect(result).not.toBeNull();
      expect(result!.isMortgage).toBe(true);
      expect(result!.currentBalance).toBe(250000);
    });

    it("detects interest/principal splits from linked transactions", async () => {
      accountsRepository.findOne.mockResolvedValue(mockLoanAccount);

      const payments: any[] = [];
      for (let i = 0; i < 4; i++) {
        const date = new Date(2025, i, 15);
        const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-15`;
        payments.push({
          id: `tx-${i}`,
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: dateStr,
          amount: 500,
          isTransfer: true,
          isSplit: false,
          linkedTransactionId: `linked-${i}`,
        });
      }

      transactionRepository.find.mockResolvedValue(payments);

      // Mock linked transactions with splits (source account side)
      transactionRepository.findOne.mockImplementation(({ where }) => {
        if (where?.id?.startsWith("linked-")) {
          return Promise.resolve({
            id: where.id,
            accountId: "chequing-1",
            amount: -500,
            account: { name: "Checking" },
            isSplit: true,
          });
        }
        return Promise.resolve(null);
      });

      // Mock split data
      transactionRepository.manager.find.mockResolvedValue([
        {
          transferAccountId: "loan-1",
          categoryId: null,
          amount: -420,
          category: null,
        },
        {
          transferAccountId: null,
          categoryId: "interest-cat-1",
          amount: -80,
          category: { name: "Interest" },
        },
      ]);

      const result = await service.detectPaymentPattern("user-1", "loan-1");

      expect(result).not.toBeNull();
      expect(result!.interestCategoryId).toBe("interest-cat-1");
      expect(result!.interestCategoryName).toBe("Interest");
    });

    it("handles single payment with low confidence", async () => {
      accountsRepository.findOne.mockResolvedValue(mockLoanAccount);

      transactionRepository.find.mockResolvedValue([
        {
          id: "tx-1",
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: "2025-01-15",
          amount: 500,
          isTransfer: false,
          isSplit: false,
          linkedTransactionId: null,
        },
      ]);

      const result = await service.detectPaymentPattern("user-1", "loan-1");

      expect(result).not.toBeNull();
      expect(result!.paymentAmount).toBe(500);
      expect(result!.paymentFrequency).toBe("MONTHLY"); // Default
      expect(result!.confidence).toBe(0.2);
      expect(result!.paymentCount).toBe(1);
    });

    it("ignores outgoing transactions (negative amounts)", async () => {
      accountsRepository.findOne.mockResolvedValue(mockLoanAccount);

      transactionRepository.find.mockResolvedValue([
        {
          id: "tx-1",
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: "2025-01-15",
          amount: -100, // Outgoing (e.g., fee)
          isTransfer: false,
          isSplit: false,
          linkedTransactionId: null,
        },
      ]);

      const result = await service.detectPaymentPattern("user-1", "loan-1");
      expect(result).toBeNull();
    });

    it("calculates next due date correctly", async () => {
      accountsRepository.findOne.mockResolvedValue(mockLoanAccount);

      transactionRepository.find.mockResolvedValue([
        {
          id: "tx-1",
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: "2025-05-15",
          amount: 500,
          isTransfer: false,
          isSplit: false,
          linkedTransactionId: null,
        },
        {
          id: "tx-2",
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: "2025-06-15",
          amount: 500,
          isTransfer: false,
          isSplit: false,
          linkedTransactionId: null,
        },
      ]);

      const result = await service.detectPaymentPattern("user-1", "loan-1");

      expect(result).not.toBeNull();
      expect(result!.suggestedNextDueDate).toBe("2025-07-15");
    });

    it("returns null when detectRegularAmount finds no repeating amounts", async () => {
      accountsRepository.findOne.mockResolvedValue(mockLoanAccount);

      // All different amounts, no two within 5% of median
      transactionRepository.find.mockResolvedValue([
        {
          id: "tx-1",
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: "2025-01-15",
          amount: 100,
          isTransfer: false,
          isSplit: false,
          linkedTransactionId: null,
        },
        {
          id: "tx-2",
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: "2025-02-15",
          amount: 500,
          isTransfer: false,
          isSplit: false,
          linkedTransactionId: null,
        },
        {
          id: "tx-3",
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: "2025-03-15",
          amount: 1000,
          isTransfer: false,
          isSplit: false,
          linkedTransactionId: null,
        },
      ]);

      const result = await service.detectPaymentPattern("user-1", "loan-1");
      expect(result).toBeNull();
    });

    it("returns null when fewer than 2 regular payments after filtering", async () => {
      accountsRepository.findOne.mockResolvedValue(mockLoanAccount);

      // 2 payments at 500, but 1 payment at 505 (within 5% of 500) -- still 2 regular
      // Use amounts where there are 2 identical but many outliers so after
      // fuzzy detection, filtering yields < 2
      transactionRepository.find.mockResolvedValue([
        {
          id: "tx-1",
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: "2025-01-15",
          amount: 500,
          isTransfer: false,
          isSplit: false,
          linkedTransactionId: null,
        },
        {
          id: "tx-2",
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: "2025-02-15",
          amount: 500,
          isTransfer: false,
          isSplit: false,
          linkedTransactionId: null,
        },
        {
          id: "tx-3",
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: "2025-03-15",
          amount: 200,
          isTransfer: false,
          isSplit: false,
          linkedTransactionId: null,
        },
        {
          id: "tx-4",
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: "2025-04-15",
          amount: 800,
          isTransfer: false,
          isSplit: false,
          linkedTransactionId: null,
        },
      ]);

      const result = await service.detectPaymentPattern("user-1", "loan-1");
      // 500 appears twice, so regularAmount=500, filtering within 5% yields tx-1 and tx-2
      expect(result).not.toBeNull();
      expect(result!.paymentAmount).toBe(500);
    });

    it("uses fuzzy amount detection when no exact matches exist", async () => {
      accountsRepository.findOne.mockResolvedValue(mockLoanAccount);

      // Amounts all within 5% of each other but not identical
      transactionRepository.find.mockResolvedValue([
        {
          id: "tx-1",
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: "2025-01-15",
          amount: 498,
          isTransfer: false,
          isSplit: false,
          linkedTransactionId: null,
        },
        {
          id: "tx-2",
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: "2025-02-15",
          amount: 502,
          isTransfer: false,
          isSplit: false,
          linkedTransactionId: null,
        },
        {
          id: "tx-3",
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: "2025-03-15",
          amount: 501,
          isTransfer: false,
          isSplit: false,
          linkedTransactionId: null,
        },
      ]);

      const result = await service.detectPaymentPattern("user-1", "loan-1");
      expect(result).not.toBeNull();
      // Fuzzy detection returns average of near-median amounts
      expect(result!.paymentAmount).toBeCloseTo(500.33, 0);
    });

    it("skips duplicate linked transactions (processedLinkedIds)", async () => {
      accountsRepository.findOne.mockResolvedValue(mockLoanAccount);

      // Two loan-side transactions referencing the same linked source
      transactionRepository.find.mockResolvedValue([
        {
          id: "tx-1",
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: "2025-01-15",
          amount: 300,
          isTransfer: true,
          isSplit: false,
          linkedTransactionId: "source-1",
        },
        {
          id: "tx-2",
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: "2025-01-15",
          amount: 200,
          isTransfer: true,
          isSplit: false,
          linkedTransactionId: "source-1",
        },
        {
          id: "tx-3",
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: "2025-02-15",
          amount: 500,
          isTransfer: true,
          isSplit: false,
          linkedTransactionId: "source-2",
        },
        {
          id: "tx-4",
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: "2025-03-15",
          amount: 500,
          isTransfer: true,
          isSplit: false,
          linkedTransactionId: "source-3",
        },
      ]);

      transactionRepository.findOne.mockImplementation(({ where }) => {
        if (where?.id === "source-1") {
          return Promise.resolve({
            id: "source-1",
            accountId: "chequing-1",
            amount: -500,
            account: { name: "Checking" },
            isSplit: false,
          });
        }
        if (where?.id === "source-2") {
          return Promise.resolve({
            id: "source-2",
            accountId: "chequing-1",
            amount: -500,
            account: { name: "Checking" },
            isSplit: false,
          });
        }
        if (where?.id === "source-3") {
          return Promise.resolve({
            id: "source-3",
            accountId: "chequing-1",
            amount: -500,
            account: { name: "Checking" },
            isSplit: false,
          });
        }
        return Promise.resolve(null);
      });

      const result = await service.detectPaymentPattern("user-1", "loan-1");
      expect(result).not.toBeNull();
      // tx-2 should be skipped (same linkedTransactionId as tx-1)
      expect(result!.paymentCount).toBeGreaterThanOrEqual(2);
    });

    it("detects single principal split with extra memo keyword", async () => {
      accountsRepository.findOne.mockResolvedValue(mockLoanAccount);

      const payments: any[] = [];
      for (let i = 0; i < 4; i++) {
        const date = new Date(2025, i, 15);
        const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-15`;
        payments.push({
          id: `tx-${i}`,
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: dateStr,
          amount: 500,
          isTransfer: true,
          isSplit: false,
          linkedTransactionId: `linked-${i}`,
        });
      }

      transactionRepository.find.mockResolvedValue(payments);

      transactionRepository.findOne.mockImplementation(({ where }) => {
        if (where?.id?.startsWith("linked-")) {
          return Promise.resolve({
            id: where.id,
            accountId: "chequing-1",
            amount: -500,
            account: { name: "Checking" },
            isSplit: true,
          });
        }
        return Promise.resolve(null);
      });

      // Single principal split with "Extra" memo
      transactionRepository.manager.find.mockResolvedValue([
        {
          transferAccountId: "loan-1",
          categoryId: null,
          amount: -500,
          memo: "Extra Principal",
          category: null,
        },
      ]);

      const result = await service.detectPaymentPattern("user-1", "loan-1");
      expect(result).not.toBeNull();
    });

    it("handles multiple principal splits without memo cues", async () => {
      accountsRepository.findOne.mockResolvedValue(mockLoanAccount);

      const payments: any[] = [];
      for (let i = 0; i < 4; i++) {
        const date = new Date(2025, i, 15);
        const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-15`;
        payments.push({
          id: `tx-${i}`,
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: dateStr,
          amount: 600,
          isTransfer: true,
          isSplit: false,
          linkedTransactionId: `linked-${i}`,
        });
      }

      transactionRepository.find.mockResolvedValue(payments);

      transactionRepository.findOne.mockImplementation(({ where }) => {
        if (where?.id?.startsWith("linked-")) {
          return Promise.resolve({
            id: where.id,
            accountId: "chequing-1",
            amount: -600,
            account: { name: "Checking" },
            isSplit: true,
          });
        }
        return Promise.resolve(null);
      });

      // Two principal splits (no memo cues) + interest split
      transactionRepository.manager.find.mockResolvedValue([
        {
          transferAccountId: "loan-1",
          categoryId: null,
          amount: -400,
          memo: null,
          category: null,
        },
        {
          transferAccountId: "loan-1",
          categoryId: null,
          amount: -100,
          memo: null,
          category: null,
        },
        {
          transferAccountId: null,
          categoryId: "interest-cat-1",
          amount: -100,
          memo: null,
          category: { name: "Interest" },
        },
      ]);

      const result = await service.detectPaymentPattern("user-1", "loan-1");
      expect(result).not.toBeNull();
      expect(result!.interestCategoryId).toBe("interest-cat-1");
    });

    it("handles multiple principal splits with memo cues for extra", async () => {
      accountsRepository.findOne.mockResolvedValue(mockLoanAccount);

      const payments: any[] = [];
      for (let i = 0; i < 4; i++) {
        const date = new Date(2025, i, 15);
        const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-15`;
        payments.push({
          id: `tx-${i}`,
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: dateStr,
          amount: 600,
          isTransfer: true,
          isSplit: false,
          linkedTransactionId: `linked-${i}`,
        });
      }

      transactionRepository.find.mockResolvedValue(payments);

      transactionRepository.findOne.mockImplementation(({ where }) => {
        if (where?.id?.startsWith("linked-")) {
          return Promise.resolve({
            id: where.id,
            accountId: "chequing-1",
            amount: -600,
            account: { name: "Checking" },
            isSplit: true,
          });
        }
        return Promise.resolve(null);
      });

      // Two principal splits, one with "additional" memo
      transactionRepository.manager.find.mockResolvedValue([
        {
          transferAccountId: "loan-1",
          categoryId: null,
          amount: -400,
          memo: "Regular principal",
          category: null,
        },
        {
          transferAccountId: "loan-1",
          categoryId: null,
          amount: -100,
          memo: "Additional principal",
          category: null,
        },
        {
          transferAccountId: null,
          categoryId: "interest-cat-1",
          amount: -100,
          memo: null,
          category: { name: "Interest" },
        },
      ]);

      const result = await service.detectPaymentPattern("user-1", "loan-1");
      expect(result).not.toBeNull();
    });

    it("consolidates multiple payment records on the same date", async () => {
      accountsRepository.findOne.mockResolvedValue(mockLoanAccount);

      // Two transactions on the same date, one on a different date -- tests consolidation
      transactionRepository.find.mockResolvedValue([
        {
          id: "tx-1a",
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: "2025-01-15",
          amount: 300,
          isTransfer: false,
          isSplit: false,
          linkedTransactionId: null,
        },
        {
          id: "tx-1b",
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: "2025-01-15",
          amount: 200,
          isTransfer: false,
          isSplit: false,
          linkedTransactionId: null,
        },
        {
          id: "tx-2",
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: "2025-02-15",
          amount: 500,
          isTransfer: false,
          isSplit: false,
          linkedTransactionId: null,
        },
        {
          id: "tx-3",
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: "2025-03-15",
          amount: 500,
          isTransfer: false,
          isSplit: false,
          linkedTransactionId: null,
        },
      ]);

      const result = await service.detectPaymentPattern("user-1", "loan-1");
      expect(result).not.toBeNull();
      // Jan 15 gets consolidated to max(300, 200)=300; only Feb and Mar are 500, so regularAmount=500
      expect(result!.paymentAmount).toBe(500);
    });

    it("consolidates same-date payments merging source account info", async () => {
      accountsRepository.findOne.mockResolvedValue(mockLoanAccount);

      transactionRepository.find.mockResolvedValue([
        {
          id: "tx-1a",
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: "2025-01-15",
          amount: 400,
          isTransfer: false,
          isSplit: false,
          linkedTransactionId: null,
        },
        {
          id: "tx-1b",
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: "2025-01-15",
          amount: 100,
          isTransfer: true,
          isSplit: false,
          linkedTransactionId: "linked-1b",
        },
        {
          id: "tx-2",
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: "2025-02-15",
          amount: 500,
          isTransfer: true,
          isSplit: false,
          linkedTransactionId: "linked-2",
        },
        {
          id: "tx-3",
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: "2025-03-15",
          amount: 500,
          isTransfer: true,
          isSplit: false,
          linkedTransactionId: "linked-3",
        },
      ]);

      transactionRepository.findOne.mockImplementation(({ where }) => {
        if (where?.id === "linked-1b") {
          return Promise.resolve({
            id: "linked-1b",
            accountId: "chequing-1",
            amount: -100,
            account: { name: "Checking" },
            isSplit: false,
          });
        }
        if (where?.id === "linked-2") {
          return Promise.resolve({
            id: "linked-2",
            accountId: "chequing-1",
            amount: -500,
            account: { name: "Checking" },
            isSplit: false,
          });
        }
        if (where?.id === "linked-3") {
          return Promise.resolve({
            id: "linked-3",
            accountId: "chequing-1",
            amount: -500,
            account: { name: "Checking" },
            isSplit: false,
          });
        }
        return Promise.resolve(null);
      });

      const result = await service.detectPaymentPattern("user-1", "loan-1");
      expect(result).not.toBeNull();
      // Source account should be detected from the linked transactions
      expect(result!.sourceAccountId).toBe("chequing-1");
    });

    it("detects quarterly payment frequency", async () => {
      accountsRepository.findOne.mockResolvedValue(mockLoanAccount);

      const payments: any[] = [];
      for (let i = 0; i < 4; i++) {
        const date = new Date(2025, i * 3, 1);
        const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
        payments.push({
          id: `tx-${i}`,
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: dateStr,
          amount: 1500,
          isTransfer: false,
          isSplit: false,
          linkedTransactionId: null,
        });
      }

      transactionRepository.find.mockResolvedValue(payments);

      const result = await service.detectPaymentPattern("user-1", "loan-1");
      expect(result).not.toBeNull();
      expect(result!.paymentFrequency).toBe("QUARTERLY");
      // Next due date should be 3 months from last payment
      expect(result!.suggestedNextDueDate).toBe("2026-01-01");
    });

    it("detects yearly payment frequency", async () => {
      accountsRepository.findOne.mockResolvedValue(mockLoanAccount);

      const payments: any[] = [];
      for (let i = 0; i < 3; i++) {
        const dateStr = `${2023 + i}-06-01`;
        payments.push({
          id: `tx-${i}`,
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: dateStr,
          amount: 5000,
          isTransfer: false,
          isSplit: false,
          linkedTransactionId: null,
        });
      }

      transactionRepository.find.mockResolvedValue(payments);

      const result = await service.detectPaymentPattern("user-1", "loan-1");
      expect(result).not.toBeNull();
      expect(result!.paymentFrequency).toBe("YEARLY");
      expect(result!.suggestedNextDueDate).toBe("2026-06-01");
    });

    it("detects weekly payment frequency", async () => {
      accountsRepository.findOne.mockResolvedValue(mockLoanAccount);

      const payments: any[] = [];
      const startDate = new Date(2025, 0, 6); // Monday
      for (let i = 0; i < 6; i++) {
        const date = new Date(startDate);
        date.setDate(date.getDate() + i * 7);
        const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        payments.push({
          id: `tx-${i}`,
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: dateStr,
          amount: 125,
          isTransfer: false,
          isSplit: false,
          linkedTransactionId: null,
        });
      }

      transactionRepository.find.mockResolvedValue(payments);

      const result = await service.detectPaymentPattern("user-1", "loan-1");
      expect(result).not.toBeNull();
      expect(result!.paymentFrequency).toBe("WEEKLY");
    });

    it("detects semimonthly payment frequency", async () => {
      accountsRepository.findOne.mockResolvedValue(mockLoanAccount);

      // Payments ~20 days apart to hit the semimonthly range (19-21 days)
      const payments: any[] = [];
      const dates = [
        "2025-01-01",
        "2025-01-21",
        "2025-02-10",
        "2025-03-02",
        "2025-03-22",
      ];
      dates.forEach((dateStr, i) => {
        payments.push({
          id: `tx-${i}`,
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: dateStr,
          amount: 250,
          isTransfer: false,
          isSplit: false,
          linkedTransactionId: null,
        });
      });

      transactionRepository.find.mockResolvedValue(payments);

      const result = await service.detectPaymentPattern("user-1", "loan-1");
      expect(result).not.toBeNull();
      expect(result!.paymentFrequency).toBe("SEMIMONTHLY");
    });

    it("calculates next due date for semimonthly (day <= 15)", async () => {
      accountsRepository.findOne.mockResolvedValue(mockLoanAccount);

      // ~20 day intervals, last payment on the 10th (day <= 15)
      const payments: any[] = [];
      const dates = [
        "2025-01-01",
        "2025-01-21",
        "2025-02-10",
        "2025-03-02",
        "2025-03-10",
      ];
      dates.forEach((dateStr, i) => {
        payments.push({
          id: `tx-${i}`,
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: dateStr,
          amount: 250,
          isTransfer: false,
          isSplit: false,
          linkedTransactionId: null,
        });
      });

      transactionRepository.find.mockResolvedValue(payments);

      const result = await service.detectPaymentPattern("user-1", "loan-1");
      expect(result).not.toBeNull();
      expect(result!.paymentFrequency).toBe("SEMIMONTHLY");
      // Last payment is March 10th (day <= 15), so next should be end of month (April 0 = March 31)
      expect(result!.suggestedNextDueDate).toBe("2025-03-31");
    });

    it("calculates next due date for semimonthly (day > 15)", async () => {
      accountsRepository.findOne.mockResolvedValue(mockLoanAccount);

      // ~20 day intervals, last payment on the 22nd (day > 15)
      const payments: any[] = [];
      const dates = [
        "2025-01-01",
        "2025-01-21",
        "2025-02-10",
        "2025-03-02",
        "2025-03-22",
      ];
      dates.forEach((dateStr, i) => {
        payments.push({
          id: `tx-${i}`,
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: dateStr,
          amount: 250,
          isTransfer: false,
          isSplit: false,
          linkedTransactionId: null,
        });
      });

      transactionRepository.find.mockResolvedValue(payments);

      const result = await service.detectPaymentPattern("user-1", "loan-1");
      expect(result).not.toBeNull();
      expect(result!.paymentFrequency).toBe("SEMIMONTHLY");
      // Last payment March 22 (day > 15), so next is 15th of next month
      expect(result!.suggestedNextDueDate).toBe("2025-04-15");
    });

    it("estimates interest rate from consecutive split payments", async () => {
      accountsRepository.findOne.mockResolvedValue({
        ...mockLoanAccount,
        currentBalance: -10000,
      });

      // Simulate amortizing loan payments with decreasing interest
      const payments: any[] = [];
      for (let i = 0; i < 5; i++) {
        const date = new Date(2025, i, 15);
        const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-15`;
        payments.push({
          id: `tx-${i}`,
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: dateStr,
          amount: 500,
          isTransfer: true,
          isSplit: false,
          linkedTransactionId: `linked-${i}`,
        });
      }

      transactionRepository.find.mockResolvedValue(payments);

      // Principal increases, interest decreases (amortization)
      const principalAmounts = [410, 412, 414, 416, 418];
      const interestAmounts = [90, 88, 86, 84, 82];

      let callIndex = 0;
      transactionRepository.findOne.mockImplementation(({ where }) => {
        if (where?.id?.startsWith("linked-")) {
          return Promise.resolve({
            id: where.id,
            accountId: "chequing-1",
            amount: -500,
            account: { name: "Checking" },
            isSplit: true,
          });
        }
        return Promise.resolve(null);
      });

      transactionRepository.manager.find.mockImplementation(() => {
        const idx = callIndex++;
        return Promise.resolve([
          {
            transferAccountId: "loan-1",
            categoryId: null,
            amount: -principalAmounts[idx],
            memo: null,
            category: null,
          },
          {
            transferAccountId: null,
            categoryId: "interest-cat-1",
            amount: -interestAmounts[idx],
            memo: null,
            category: { name: "Interest" },
          },
        ]);
      });

      const result = await service.detectPaymentPattern("user-1", "loan-1");
      expect(result).not.toBeNull();
      expect(result!.estimatedInterestRate).not.toBeNull();
      expect(result!.estimatedInterestRate).toBeGreaterThan(0);
      expect(result!.estimatedInterestRate).toBeLessThan(50);
    });

    it("returns null estimated rate when no split data exists", async () => {
      accountsRepository.findOne.mockResolvedValue(mockLoanAccount);

      const payments: any[] = [];
      for (let i = 0; i < 4; i++) {
        const date = new Date(2025, i, 15);
        const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-15`;
        payments.push({
          id: `tx-${i}`,
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: dateStr,
          amount: 500,
          isTransfer: false,
          isSplit: false,
          linkedTransactionId: null,
        });
      }

      transactionRepository.find.mockResolvedValue(payments);

      const result = await service.detectPaymentPattern("user-1", "loan-1");
      expect(result).not.toBeNull();
      expect(result!.estimatedInterestRate).toBeNull();
    });

    it("detects extra principal via memo-based strategy", async () => {
      accountsRepository.findOne.mockResolvedValue(mockLoanAccount);

      const payments: any[] = [];
      for (let i = 0; i < 6; i++) {
        const date = new Date(2025, i, 15);
        const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-15`;
        payments.push({
          id: `tx-${i}`,
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: dateStr,
          amount: 600,
          isTransfer: true,
          isSplit: false,
          linkedTransactionId: `linked-${i}`,
        });
      }

      transactionRepository.find.mockResolvedValue(payments);

      transactionRepository.findOne.mockImplementation(({ where }) => {
        if (where?.id?.startsWith("linked-")) {
          return Promise.resolve({
            id: where.id,
            accountId: "chequing-1",
            amount: -600,
            account: { name: "Checking" },
            isSplit: true,
          });
        }
        return Promise.resolve(null);
      });

      // Each payment has a principal split marked "Extra" plus regular principal + interest
      transactionRepository.manager.find.mockResolvedValue([
        {
          transferAccountId: "loan-1",
          categoryId: null,
          amount: -400,
          memo: null,
          category: null,
        },
        {
          transferAccountId: "loan-1",
          categoryId: null,
          amount: -100,
          memo: "Extra principal payment",
          category: null,
        },
        {
          transferAccountId: null,
          categoryId: "interest-cat-1",
          amount: -100,
          memo: null,
          category: { name: "Interest" },
        },
      ]);

      const result = await service.detectPaymentPattern("user-1", "loan-1");
      expect(result).not.toBeNull();
      expect(result!.averageExtraPrincipal).toBe(100);
      expect(result!.extraPrincipalCount).toBe(6);
    });

    it("detects extra principal via multiple-split CV analysis", async () => {
      accountsRepository.findOne.mockResolvedValue(mockLoanAccount);

      const payments: any[] = [];
      for (let i = 0; i < 6; i++) {
        const date = new Date(2025, i, 15);
        const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-15`;
        payments.push({
          id: `tx-${i}`,
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: dateStr,
          amount: 600,
          isTransfer: true,
          isSplit: false,
          linkedTransactionId: `linked-${i}`,
        });
      }

      transactionRepository.find.mockResolvedValue(payments);

      transactionRepository.findOne.mockImplementation(({ where }) => {
        if (where?.id?.startsWith("linked-")) {
          return Promise.resolve({
            id: where.id,
            accountId: "chequing-1",
            amount: -600,
            account: { name: "Checking" },
            isSplit: true,
          });
        }
        return Promise.resolve(null);
      });

      // Two principal splits, no memo cues. Extra principal (100) is constant,
      // regular principal varies (simulating amortization).
      let splitCallIndex = 0;
      const regularPrincipals = [395, 397, 399, 401, 403, 405];
      transactionRepository.manager.find.mockImplementation(() => {
        const idx = splitCallIndex++;
        return Promise.resolve([
          {
            transferAccountId: "loan-1",
            categoryId: null,
            amount: -regularPrincipals[idx],
            memo: null,
            category: null,
          },
          {
            transferAccountId: "loan-1",
            categoryId: null,
            amount: -100, // constant extra principal
            memo: null,
            category: null,
          },
          {
            transferAccountId: null,
            categoryId: "interest-cat-1",
            amount: -(600 - regularPrincipals[idx] - 100),
            memo: null,
            category: { name: "Interest" },
          },
        ]);
      });

      const result = await service.detectPaymentPattern("user-1", "loan-1");
      expect(result).not.toBeNull();
      expect(result!.averageExtraPrincipal).toBe(100);
      expect(result!.extraPrincipalCount).toBe(6);
    });

    it("projects split trend with amortization pattern", async () => {
      accountsRepository.findOne.mockResolvedValue({
        ...mockLoanAccount,
        currentBalance: -10000,
      });

      const payments: any[] = [];
      for (let i = 0; i < 5; i++) {
        const date = new Date(2025, i, 15);
        const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-15`;
        payments.push({
          id: `tx-${i}`,
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: dateStr,
          amount: 500,
          isTransfer: true,
          isSplit: false,
          linkedTransactionId: `linked-${i}`,
        });
      }

      transactionRepository.find.mockResolvedValue(payments);

      // Amortization pattern: principal increases by ~2, interest decreases by ~2
      const principalAmounts = [400, 402, 404, 406, 408];
      const interestAmounts = [100, 98, 96, 94, 92];

      let callIdx = 0;
      transactionRepository.findOne.mockImplementation(({ where }) => {
        if (where?.id?.startsWith("linked-")) {
          return Promise.resolve({
            id: where.id,
            accountId: "chequing-1",
            amount: -500,
            account: { name: "Checking" },
            isSplit: true,
          });
        }
        return Promise.resolve(null);
      });

      transactionRepository.manager.find.mockImplementation(() => {
        const idx = callIdx++;
        return Promise.resolve([
          {
            transferAccountId: "loan-1",
            categoryId: null,
            amount: -principalAmounts[idx],
            memo: null,
            category: null,
          },
          {
            transferAccountId: null,
            categoryId: "interest-cat-1",
            amount: -interestAmounts[idx],
            memo: null,
            category: { name: "Interest" },
          },
        ]);
      });

      const result = await service.detectPaymentPattern("user-1", "loan-1");
      expect(result).not.toBeNull();
      // Projected next: principal ~410, interest ~90
      expect(result!.lastPrincipalAmount).toBeCloseTo(410, 0);
      expect(result!.lastInterestAmount).toBeCloseTo(90, 0);
    });

    it("returns most recent split values when no amortization trend", async () => {
      accountsRepository.findOne.mockResolvedValue(mockLoanAccount);

      const payments: any[] = [];
      for (let i = 0; i < 4; i++) {
        const date = new Date(2025, i, 15);
        const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-15`;
        payments.push({
          id: `tx-${i}`,
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: dateStr,
          amount: 500,
          isTransfer: true,
          isSplit: false,
          linkedTransactionId: `linked-${i}`,
        });
      }

      transactionRepository.find.mockResolvedValue(payments);

      // No clear amortization pattern (principal goes up AND down)
      const principalAmounts = [420, 410, 430, 415];
      const interestAmounts = [80, 90, 70, 85];

      let callIdx = 0;
      transactionRepository.findOne.mockImplementation(({ where }) => {
        if (where?.id?.startsWith("linked-")) {
          return Promise.resolve({
            id: where.id,
            accountId: "chequing-1",
            amount: -500,
            account: { name: "Checking" },
            isSplit: true,
          });
        }
        return Promise.resolve(null);
      });

      transactionRepository.manager.find.mockImplementation(() => {
        const idx = callIdx++;
        return Promise.resolve([
          {
            transferAccountId: "loan-1",
            categoryId: null,
            amount: -principalAmounts[idx],
            memo: null,
            category: null,
          },
          {
            transferAccountId: null,
            categoryId: "interest-cat-1",
            amount: -interestAmounts[idx],
            memo: null,
            category: { name: "Interest" },
          },
        ]);
      });

      const result = await service.detectPaymentPattern("user-1", "loan-1");
      expect(result).not.toBeNull();
      // No trend, so should return the most recent split values
      expect(result!.lastPrincipalAmount).toBe(415);
      expect(result!.lastInterestAmount).toBe(85);
    });

    it("returns single split values when only one payment has splits", async () => {
      accountsRepository.findOne.mockResolvedValue(mockLoanAccount);

      // 3 payments total, but only 1 has splits
      const payments: any[] = [
        {
          id: "tx-0",
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: "2025-01-15",
          amount: 500,
          isTransfer: false,
          isSplit: false,
          linkedTransactionId: null,
        },
        {
          id: "tx-1",
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: "2025-02-15",
          amount: 500,
          isTransfer: true,
          isSplit: false,
          linkedTransactionId: "linked-1",
        },
        {
          id: "tx-2",
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: "2025-03-15",
          amount: 500,
          isTransfer: false,
          isSplit: false,
          linkedTransactionId: null,
        },
      ];

      transactionRepository.find.mockResolvedValue(payments);

      transactionRepository.findOne.mockImplementation(({ where }) => {
        if (where?.id === "linked-1") {
          return Promise.resolve({
            id: "linked-1",
            accountId: "chequing-1",
            amount: -500,
            account: { name: "Checking" },
            isSplit: true,
          });
        }
        return Promise.resolve(null);
      });

      transactionRepository.manager.find.mockResolvedValue([
        {
          transferAccountId: "loan-1",
          categoryId: null,
          amount: -420,
          memo: null,
          category: null,
        },
        {
          transferAccountId: null,
          categoryId: "interest-cat-1",
          amount: -80,
          memo: null,
          category: { name: "Interest" },
        },
      ]);

      const result = await service.detectPaymentPattern("user-1", "loan-1");
      expect(result).not.toBeNull();
      // Only 1 payment has splits, so analyzeSplitTrend returns single values
      expect(result!.lastPrincipalAmount).toBe(420);
      expect(result!.lastInterestAmount).toBe(80);
    });

    it("handles LINE_OF_CREDIT account type", async () => {
      const locAccount = {
        id: "loc-1",
        userId: "user-1",
        name: "Line of Credit",
        accountType: AccountType.LINE_OF_CREDIT,
        currentBalance: -5000,
        openingBalance: -10000,
        interestRate: 7.5,
        scheduledTransactionId: null,
      };

      accountsRepository.findOne.mockResolvedValue(locAccount);

      const payments: any[] = [];
      for (let i = 0; i < 3; i++) {
        const date = new Date(2025, i, 1);
        const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
        payments.push({
          id: `tx-${i}`,
          accountId: "loc-1",
          userId: "user-1",
          transactionDate: dateStr,
          amount: 200,
          isTransfer: false,
          isSplit: false,
          linkedTransactionId: null,
        });
      }

      transactionRepository.find.mockResolvedValue(payments);

      const result = await service.detectPaymentPattern("user-1", "loc-1");
      expect(result).not.toBeNull();
      expect(result!.isMortgage).toBe(false);
      expect(result!.currentBalance).toBe(5000);
    });

    it("builds single payment result with extra principal", async () => {
      accountsRepository.findOne.mockResolvedValue(mockLoanAccount);

      transactionRepository.find.mockResolvedValue([
        {
          id: "tx-1",
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: "2025-01-15",
          amount: 600,
          isTransfer: true,
          isSplit: false,
          linkedTransactionId: "linked-1",
        },
      ]);

      transactionRepository.findOne.mockImplementation(({ where }) => {
        if (where?.id === "linked-1") {
          return Promise.resolve({
            id: "linked-1",
            accountId: "chequing-1",
            amount: -600,
            account: { name: "Checking" },
            isSplit: true,
          });
        }
        return Promise.resolve(null);
      });

      // Single principal split with "Extra" memo
      transactionRepository.manager.find.mockResolvedValue([
        {
          transferAccountId: "loan-1",
          categoryId: null,
          amount: -500,
          memo: null,
          category: null,
        },
        {
          transferAccountId: "loan-1",
          categoryId: null,
          amount: -100,
          memo: "Extra Principal",
          category: null,
        },
      ]);

      const result = await service.detectPaymentPattern("user-1", "loan-1");
      expect(result).not.toBeNull();
      // Single payment result with extra principal deducted
      expect(result!.paymentAmount).toBe(500);
      expect(result!.confidence).toBe(0.2);
      expect(result!.paymentCount).toBe(1);
      expect(result!.averageExtraPrincipal).toBe(100);
      expect(result!.extraPrincipalCount).toBe(1);
    });

    it("consolidates same-date payments with linked and non-linked transactions", async () => {
      accountsRepository.findOne.mockResolvedValue(mockLoanAccount);

      transactionRepository.find.mockResolvedValue([
        {
          id: "tx-1a",
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: "2025-01-15",
          amount: 500,
          isTransfer: true,
          isSplit: false,
          linkedTransactionId: "linked-1a",
        },
        {
          id: "tx-1b",
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: "2025-01-15",
          amount: 200,
          isTransfer: true,
          isSplit: false,
          linkedTransactionId: "linked-1b",
        },
        {
          id: "tx-2",
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: "2025-02-15",
          amount: 500,
          isTransfer: false,
          isSplit: false,
          linkedTransactionId: null,
        },
        {
          id: "tx-3",
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: "2025-03-15",
          amount: 500,
          isTransfer: false,
          isSplit: false,
          linkedTransactionId: null,
        },
      ]);

      // linked-1a has no splits, linked-1b has splits with interest
      transactionRepository.findOne.mockImplementation(({ where }) => {
        if (where?.id === "linked-1a") {
          return Promise.resolve({
            id: "linked-1a",
            accountId: "chequing-1",
            amount: -500,
            account: { name: "Checking" },
            isSplit: false,
          });
        }
        if (where?.id === "linked-1b") {
          return Promise.resolve({
            id: "linked-1b",
            accountId: "chequing-1",
            amount: -200,
            account: { name: "Checking" },
            isSplit: true,
          });
        }
        return Promise.resolve(null);
      });

      transactionRepository.manager.find.mockResolvedValue([
        {
          transferAccountId: "loan-1",
          categoryId: null,
          amount: -150,
          memo: null,
          category: null,
        },
        {
          transferAccountId: null,
          categoryId: "interest-cat-1",
          amount: -50,
          memo: null,
          category: { name: "Interest" },
        },
      ]);

      const result = await service.detectPaymentPattern("user-1", "loan-1");
      expect(result).not.toBeNull();
      expect(result!.paymentAmount).toBe(500);
    });

    it("falls back to balance-based interest rate estimation", async () => {
      accountsRepository.findOne.mockResolvedValue({
        ...mockLoanAccount,
        currentBalance: -10000,
      });

      // Only 2 payments with splits (not enough for consecutive approach to be useful
      // since principal amounts are inconsistent)
      const payments: any[] = [];
      for (let i = 0; i < 3; i++) {
        const date = new Date(2025, i, 15);
        const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-15`;
        payments.push({
          id: `tx-${i}`,
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: dateStr,
          amount: 500,
          isTransfer: true,
          isSplit: false,
          linkedTransactionId: `linked-${i}`,
        });
      }

      transactionRepository.find.mockResolvedValue(payments);

      // Interest stays same (no consecutive drop), so consecutive approach yields 0 drop
      transactionRepository.findOne.mockImplementation(({ where }) => {
        if (where?.id?.startsWith("linked-")) {
          return Promise.resolve({
            id: where.id,
            accountId: "chequing-1",
            amount: -500,
            account: { name: "Checking" },
            isSplit: true,
          });
        }
        return Promise.resolve(null);
      });

      // Same interest amount each time (no drop, so consecutive approach yields no rates)
      transactionRepository.manager.find.mockResolvedValue([
        {
          transferAccountId: "loan-1",
          categoryId: null,
          amount: -450,
          memo: null,
          category: null,
        },
        {
          transferAccountId: null,
          categoryId: "interest-cat-1",
          amount: -50,
          memo: null,
          category: { name: "Interest" },
        },
      ]);

      const result = await service.detectPaymentPattern("user-1", "loan-1");
      expect(result).not.toBeNull();
      // Falls back to balance-based estimation
      expect(result!.estimatedInterestRate).not.toBeNull();
      expect(result!.estimatedInterestRate).toBeGreaterThan(0);
    });

    /**
     * REV-20260803-006. Three principal-only transfers ($450) with the
     * matching interest booked as a separate categorized expense ($50) on the
     * source account -- never a split leg of the transfer. Before the fix,
     * `amount` stayed at the principal-only $450 after pairing, so the
     * detected `paymentAmount` under-reported the real $500 installment.
     * Both components are real, already-known ledger amounts once pairing has
     * matched them, so summing is a correct total, not a guess.
     */
    it("includes paired separate interest in the detected payment amount", async () => {
      accountsRepository.findOne.mockResolvedValue({
        ...mockLoanAccount,
        interestCategoryId: "cat-int",
      });

      const dates = ["2025-01-15", "2025-02-15", "2025-03-15"];
      const loanTxns = dates.map((dateStr, i) => ({
        id: `tx-${i}`,
        accountId: "loan-1",
        userId: "user-1",
        transactionDate: dateStr,
        amount: 450, // Principal transfer only -- interest booked separately
        isTransfer: true,
        isSplit: false,
        linkedTransactionId: `linked-${i}`,
      }));

      transactionRepository.find.mockImplementation((opts: any) => {
        if (opts?.where?.categoryId) {
          // The separate interest expense transactions on the source account.
          return Promise.resolve(
            dates.map((dateStr) => ({
              transactionDate: dateStr,
              amount: -50,
              accountId: "chequing-1",
              categoryId: "cat-int",
            })),
          );
        }
        return Promise.resolve(loanTxns);
      });

      transactionRepository.findOne.mockImplementation(({ where }: any) => {
        if (where?.id?.startsWith("linked-")) {
          return Promise.resolve({
            id: where.id,
            accountId: "chequing-1",
            amount: -450,
            account: { name: "Checking" },
            isSplit: false,
          });
        }
        return Promise.resolve(null);
      });

      const result = await service.detectPaymentPattern("user-1", "loan-1");

      expect(result).not.toBeNull();
      // Full installment is principal ($450) + separately booked interest
      // ($50) = $500, not the principal-only $450.
      expect(result!.paymentAmount).toBe(500);
    });

    /**
     * REV-20260803-006 (reopened). Three $450 principal-only transfers, but
     * only ONE has a standalone interest expense close enough to pair (the
     * other two have no matching separate interest nearby -- e.g. not
     * imported, not categorized, or just outside the pairing window). Before
     * this fix, the two unmatched $450 records outvoted the one correctly
     * completed $500 record in `detectRegularAmount`'s majority vote, so the
     * detected `paymentAmount` was the wrong, incomplete $450 rather than the
     * real $500 installment the paired record establishes.
     */
    it("does not let unmatched principal-only payments outvote a correctly-paired installment", async () => {
      accountsRepository.findOne.mockResolvedValue({
        ...mockLoanAccount,
        interestCategoryId: "cat-int",
      });

      const dates = ["2025-01-15", "2025-02-15", "2025-03-15"];
      const loanTxns = dates.map((dateStr, i) => ({
        id: `tx-${i}`,
        accountId: "loan-1",
        userId: "user-1",
        transactionDate: dateStr,
        amount: 450, // Principal transfer only -- interest booked separately
        isTransfer: true,
        isSplit: false,
        linkedTransactionId: `linked-${i}`,
      }));

      transactionRepository.find.mockImplementation((opts: any) => {
        if (opts?.where?.categoryId) {
          // Only the FIRST payment has a matching standalone interest
          // expense nearby -- the other two dates have none, simulating
          // partially imported/uncategorized interest history.
          return Promise.resolve([
            {
              transactionDate: dates[0],
              amount: -50,
              accountId: "chequing-1",
              categoryId: "cat-int",
            },
          ]);
        }
        return Promise.resolve(loanTxns);
      });

      transactionRepository.findOne.mockImplementation(({ where }: any) => {
        if (where?.id?.startsWith("linked-")) {
          return Promise.resolve({
            id: where.id,
            accountId: "chequing-1",
            amount: -450,
            account: { name: "Checking" },
            isSplit: false,
          });
        }
        return Promise.resolve(null);
      });

      const result = await service.detectPaymentPattern("user-1", "loan-1");

      expect(result).not.toBeNull();
      // The one paired record establishes the real $500 installment; the two
      // unmatched $450 records must not win the majority vote against it.
      expect(result!.paymentAmount).toBe(500);
      // All three payments are still part of the payment schedule (the
      // amount vote excludes the unmatched ones, but they aren't dropped
      // from frequency/next-due-date detection just because they lack
      // paired interest).
      expect(result!.paymentCount).toBe(3);
    });

    /**
     * REV-20260803-006 (reopened a THIRD time). Three $450 principal-only
     * transfers, but the interest-category query finds NOTHING at all --
     * no standalone interest expense anywhere near any of the three
     * payments (missing from the ledger entirely, or uncategorized). Before
     * this fix, `pairSeparateInterest` returned the three records unmarked
     * (interestTxns.length === 0 short-circuited before any record was
     * touched), so `detectRegularAmount` could not tell this apart from "no
     * separate interest at all" and fell back to voting over the full set,
     * reporting the $450 principal-only subtotal as if it were the whole
     * $500 installment. The full installment genuinely cannot be
     * established from what's available, so `paymentAmount` must now come
     * back null/unknown rather than $450 -- see "Missing data: a subtotal
     * is not a total" in root CLAUDE.md.
     */
    it("reports no payment amount when a SEPARATE-mode account has zero paired interest across every record", async () => {
      accountsRepository.findOne.mockResolvedValue({
        ...mockLoanAccount,
        interestCategoryId: "cat-int",
      });

      const dates = ["2025-01-15", "2025-02-15", "2025-03-15"];
      const loanTxns = dates.map((dateStr, i) => ({
        id: `tx-${i}`,
        accountId: "loan-1",
        userId: "user-1",
        transactionDate: dateStr,
        amount: 450, // Principal transfer only -- interest booked separately
        isTransfer: true,
        isSplit: false,
        linkedTransactionId: `linked-${i}`,
      }));

      transactionRepository.find.mockImplementation((opts: any) => {
        if (opts?.where?.categoryId) {
          // No standalone interest expense anywhere near any payment --
          // separate interest is expected (interestCategoryId is set) but
          // none of it could be found at all.
          return Promise.resolve([]);
        }
        return Promise.resolve(loanTxns);
      });

      transactionRepository.findOne.mockImplementation(({ where }: any) => {
        if (where?.id?.startsWith("linked-")) {
          return Promise.resolve({
            id: where.id,
            accountId: "chequing-1",
            amount: -450,
            account: { name: "Checking" },
            isSplit: false,
          });
        }
        return Promise.resolve(null);
      });

      const result = await service.detectPaymentPattern("user-1", "loan-1");

      // Not $450 (principal-only subtotal masquerading as the total) and
      // not a DetectedLoanPayment at all -- the existing "cannot detect a
      // pattern" convention in this function is to return null outright.
      expect(result).toBeNull();
    });

    /**
     * REV-20260803-006, reopened a SIXTH time. The reopen note's exact
     * scenario: a SEPARATE-mode loan whose interestCategoryId has been
     * cleared (it is nullable independently of the booking mode) and three
     * imported $450 principal transfers. Before this fix,
     * `pairSeparateInterest`'s `!interestCategoryId` early-return treated
     * every account with no configured category the same way regardless of
     * booking mode and returned the three records unmarked, so
     * `detectRegularAmount` voted over them and `detectPaymentPattern`
     * reported `paymentAmount: 450` as if that were the complete $500
     * installment. SEPARATE mode asserts separate interest exists for this
     * loan, so a missing category is a failed pairing attempt, not "doesn't
     * apply" -- the correct result is null, matching the sibling
     * "interest expected but none found at all" case directly above.
     */
    it("reports no payment amount for a SEPARATE-mode account with a cleared interest category and only principal transfers", async () => {
      accountsRepository.findOne.mockResolvedValue({
        ...mockLoanAccount,
        interestBookingMode: "SEPARATE",
        interestCategoryId: null,
      });

      const dates = ["2025-01-15", "2025-02-15", "2025-03-15"];
      const loanTxns = dates.map((dateStr, i) => ({
        id: `tx-${i}`,
        accountId: "loan-1",
        userId: "user-1",
        transactionDate: dateStr,
        amount: 450, // Principal transfer only -- interest booked separately
        isTransfer: true,
        isSplit: false,
        linkedTransactionId: `linked-${i}`,
      }));

      transactionRepository.find.mockResolvedValue(loanTxns);
      transactionRepository.findOne.mockImplementation(({ where }: any) => {
        if (where?.id?.startsWith("linked-")) {
          return Promise.resolve({
            id: where.id,
            accountId: "chequing-1",
            amount: -450,
            account: { name: "Checking" },
            isSplit: false,
          });
        }
        return Promise.resolve(null);
      });

      const result = await service.detectPaymentPattern("user-1", "loan-1");

      // Not $450 (principal-only subtotal) -- the cleared interest category
      // means the $500 installment can never be established from what's
      // available on a SEPARATE-mode loan.
      expect(result).toBeNull();
    });

    /**
     * Confirms the fix above is scoped to "SEPARATE mode, zero successful
     * pairings" and does not regress the legitimately different state of
     * "this account has no separate interest at all" (no interestCategoryId
     * configured, so `pairSeparateInterest` never runs its pairing logic).
     * That case must keep reporting its normal detected amount from the
     * loan-side transfer amounts directly.
     */
    it("still detects a normal payment amount when the account has no separate interest configured at all", async () => {
      accountsRepository.findOne.mockResolvedValue({
        ...mockLoanAccount,
        interestCategoryId: null,
      });

      const dates = ["2025-01-15", "2025-02-15", "2025-03-15"];
      const loanTxns = dates.map((dateStr, i) => ({
        id: `tx-${i}`,
        accountId: "loan-1",
        userId: "user-1",
        transactionDate: dateStr,
        amount: 500,
        isTransfer: false,
        isSplit: false,
        linkedTransactionId: null,
      }));

      transactionRepository.find.mockResolvedValue(loanTxns);
      transactionRepository.findOne.mockResolvedValue(null);

      const result = await service.detectPaymentPattern("user-1", "loan-1");

      expect(result).not.toBeNull();
      expect(result!.paymentAmount).toBe(500);
      expect(result!.paymentCount).toBe(3);
    });

    /**
     * Explicit control (mode set to "AUTO" rather than left undefined, as
     * the test above does) for the sixth-reopen fix: AUTO mode never
     * asserted separate interest applies to this loan, so a missing
     * interestCategoryId is still "the question doesn't apply" and
     * detection must proceed exactly as before -- unmarked records, normal
     * amount reported. This must not regress.
     */
    it("still detects a normal payment amount for an AUTO-mode account with no interest category configured (control)", async () => {
      accountsRepository.findOne.mockResolvedValue({
        ...mockLoanAccount,
        interestBookingMode: "AUTO",
        interestCategoryId: null,
      });

      const dates = ["2025-01-15", "2025-02-15", "2025-03-15"];
      const loanTxns = dates.map((dateStr, i) => ({
        id: `tx-${i}`,
        accountId: "loan-1",
        userId: "user-1",
        transactionDate: dateStr,
        amount: 500,
        isTransfer: false,
        isSplit: false,
        linkedTransactionId: null,
      }));

      transactionRepository.find.mockResolvedValue(loanTxns);
      transactionRepository.findOne.mockResolvedValue(null);

      const result = await service.detectPaymentPattern("user-1", "loan-1");

      expect(result).not.toBeNull();
      expect(result!.paymentAmount).toBe(500);
      expect(result!.paymentCount).toBe(3);
    });

    /**
     * REV-20260803-007. A SPLIT-mode account books interest only as a split
     * leg of the transfer. A payment missing that split must not acquire a
     * standalone expense from the configured interest category -- that
     * expense could be unrelated to the loan payment entirely. Mirrors the
     * SPLIT-mode skip RateChangeInferenceService.detectAndPersist already
     * applies before calling the same `pairSeparateInterest`.
     */
    it("does not pair a standalone interest-category expense for SPLIT accounts", async () => {
      accountsRepository.findOne.mockResolvedValue({
        ...mockLoanAccount,
        interestBookingMode: "SPLIT",
        interestCategoryId: "cat-int",
      });

      const dates = ["2025-01-15", "2025-02-15", "2025-03-15"];
      const loanTxns = dates.map((dateStr, i) => ({
        id: `tx-${i}`,
        accountId: "loan-1",
        userId: "user-1",
        transactionDate: dateStr,
        amount: 450, // Payment is missing its interest split
        isTransfer: true,
        isSplit: false,
        linkedTransactionId: `linked-${i}`,
      }));

      const pairSeparateInterestSpy = jest.spyOn(
        service,
        "pairSeparateInterest",
      );

      transactionRepository.find.mockImplementation((opts: any) => {
        if (opts?.where?.categoryId) {
          // A standalone expense in the configured interest category. If the
          // SPLIT skip regresses, this gets paired in and inflates the
          // detected payment and interest category despite SPLIT explicitly
          // meaning standalone expenses must not be considered.
          return Promise.resolve(
            dates.map((dateStr) => ({
              transactionDate: dateStr,
              amount: -50,
              accountId: "chequing-1",
              categoryId: "cat-int",
            })),
          );
        }
        return Promise.resolve(loanTxns);
      });

      transactionRepository.findOne.mockImplementation(({ where }: any) => {
        if (where?.id?.startsWith("linked-")) {
          return Promise.resolve({
            id: where.id,
            accountId: "chequing-1",
            amount: -450,
            account: { name: "Checking" },
            isSplit: false,
          });
        }
        return Promise.resolve(null);
      });

      const result = await service.detectPaymentPattern("user-1", "loan-1");

      expect(pairSeparateInterestSpy).not.toHaveBeenCalled();
      expect(result).not.toBeNull();
      // The standalone expense must not be folded into the detected payment
      // or its interest category.
      expect(result!.paymentAmount).toBe(450);
      expect(result!.interestCategoryId).toBeNull();
    });

    /**
     * REV-20260803-006, reopened a fifth time. With only one payment in the
     * history, detectPaymentPattern short-circuits to buildSinglePaymentResult
     * *before* detectRegularAmount -- and its interestUnmatched guard from
     * passes 2-4 -- ever runs. A SEPARATE-mode loan with a configured
     * interest category and a single unlinked/imported $450 principal
     * transfer (no source account, so pairSeparateInterest's
     * sourceIds.length === 0 branch marks it interestUnmatched) must not have
     * that $450 principal-only subtotal reported as paymentAmount: the
     * missing $50 interest means the full $500 installment was never
     * established, so the correct answer is null ("cannot determine"), the
     * same convention detectRegularAmount uses for the multi-payment
     * all-unmatched case.
     */
    it("returns null (not the $450 principal subtotal) for a single unlinked payment on a SEPARATE-mode loan with unmatched separate interest", async () => {
      const account = {
        id: "loan-1",
        userId: "user-1",
        accountType: AccountType.LOAN,
        interestBookingMode: "SEPARATE",
        interestCategoryId: "cat-int",
        currentBalance: -10000,
      } as any;

      accountsRepository.findOne.mockResolvedValue(account);
      transactionRepository.find.mockResolvedValue([
        {
          id: "tx-1",
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: "2026-01-05",
          amount: 450,
          isTransfer: false,
          isSplit: false,
          linkedTransactionId: null,
        },
      ]);

      const result = await service.detectPaymentPattern("user-1", "loan-1");

      // No source account is known for the sole payment, so the interest
      // lookup is skipped entirely (the sourceIds.length === 0 early-return)
      // -- confirming the null result comes from the interestUnmatched
      // guard, not from an unrelated failure to find the account.
      expect(transactionRepository.find).toHaveBeenCalledTimes(1);
      expect(result).toBeNull();
    });

    /**
     * REV-20260803-006, reopened a SIXTH time -- single-payment variant.
     * Same short-circuit to `buildSinglePaymentResult` as the fifth-reopen
     * test above, but the interest category itself is missing/cleared
     * (`interestCategoryId: null`) rather than configured-but-unmatched.
     * Before this fix, `pairSeparateInterest`'s `!interestCategoryId`
     * early-return returned the sole record unchanged regardless of booking
     * mode, so `buildSinglePaymentResult`'s `interestUnmatched` guard never
     * saw the flag and reported the $450 principal-only transfer as the
     * complete payment. SEPARATE mode asserts separate interest exists for
     * this loan, so the correct answer is null, matching the sibling test
     * above.
     */
    it("returns null (not the $450 principal subtotal) for a single payment on a SEPARATE-mode loan with a cleared interest category", async () => {
      const account = {
        id: "loan-1",
        userId: "user-1",
        accountType: AccountType.LOAN,
        interestBookingMode: "SEPARATE",
        interestCategoryId: null,
        currentBalance: -10000,
      } as any;

      accountsRepository.findOne.mockResolvedValue(account);
      transactionRepository.find.mockResolvedValue([
        {
          id: "tx-1",
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: "2026-01-05",
          amount: 450,
          isTransfer: false,
          isSplit: false,
          linkedTransactionId: null,
        },
      ]);

      const result = await service.detectPaymentPattern("user-1", "loan-1");

      // No interest category to query against at all, so the interest
      // lookup never runs (the !interestCategoryId early-return, not the
      // sourceIds.length === 0 branch the sibling test above exercises).
      expect(transactionRepository.find).toHaveBeenCalledTimes(1);
      expect(result).toBeNull();
    });

    /**
     * Control for the fix above: a single payment on an account that does
     * NOT expect separate interest (no interestCategoryId configured) must
     * still return its plain amount -- interestUnmatched never applies here,
     * so buildSinglePaymentResult's new guard must not fire.
     */
    it("still returns the plain amount for a single payment when separate interest is not configured", async () => {
      accountsRepository.findOne.mockResolvedValue(mockLoanAccount);

      transactionRepository.find.mockResolvedValue([
        {
          id: "tx-1",
          accountId: "loan-1",
          userId: "user-1",
          transactionDate: "2025-01-15",
          amount: 500,
          isTransfer: false,
          isSplit: false,
          linkedTransactionId: null,
        },
      ]);

      const result = await service.detectPaymentPattern("user-1", "loan-1");

      expect(result).not.toBeNull();
      expect(result!.paymentAmount).toBe(500);
    });
  });

  describe("buildPaymentRecords", () => {
    /**
     * REV-20260803-024, fifth reopen: a split-leg leak distinct from the
     * four prior passes' pairing-leak fixes (`pairSeparateInterest`'s
     * `asOfDate`, `excludeFutureLeakedInterest`'s epsilon). A split transfer
     * to the loan has two legs: the loan-side leg (this test's `tx-1`,
     * dated today) and its linked SOURCE parent, which carries the actual
     * principal/interest splits. A PATCH that moves only the source
     * parent's `transactionDate` to tomorrow -- without touching its splits
     * -- leaves the loan-side leg dated as before, so `buildPaymentRecords`
     * still walks `linkedTransactionId` to the now-future source parent and,
     * before this fix, read its interest split as if it were a genuine
     * observation of today's interest. These use real `Transaction`
     * instances for the linked source (not plain object literals) because
     * the voided case exercises the entity's own `isVoid` getter over
     * `status` -- a plain `{ isVoid: true }` literal would pass even
     * against unfixed code, the exact trap `backend/CLAUDE.md` calls out
     * for "a mock must return what the real collaborator returns".
     */
    const loanSideTx = (over: Partial<any> = {}): any => ({
      id: "tx-1",
      accountId: "loan-1",
      userId: "user-1",
      transactionDate: "2026-08-04",
      amount: 500,
      isTransfer: true,
      isSplit: false,
      linkedTransactionId: "linked-1",
      ...over,
    });

    const makeLinkedSourceTx = (over: Partial<Transaction> = {}): Transaction =>
      Object.assign(new Transaction(), {
        id: "linked-1",
        accountId: "chequing-1",
        amount: -500,
        transactionDate: "2026-08-04",
        isSplit: true,
        isTransfer: false,
        status: TransactionStatus.CLEARED,
        account: { name: "Checking" },
        ...over,
      });

    const splitRows = [
      {
        transferAccountId: "loan-1",
        categoryId: null,
        amount: -400,
        memo: null,
        category: null,
      },
      {
        transferAccountId: null,
        categoryId: "interest-cat-1",
        amount: -100,
        memo: null,
        category: { name: "Interest" },
      },
    ];

    it("does not surface a future-dated linked source's interest split when bounded by asOfDate", async () => {
      transactionRepository.findOne.mockResolvedValue(
        makeLinkedSourceTx({ transactionDate: "2026-08-05" }), // tomorrow
      );
      transactionRepository.manager.find.mockResolvedValue(splitRows);

      const result = await service.buildPaymentRecords(
        "user-1",
        "loan-1",
        [loanSideTx()],
        "2026-08-04", // asOfDate = today
      );

      expect(result).toHaveLength(1);
      expect(result[0].interestAmount).toBeNull();
      expect(result[0].interestCategoryId).toBeNull();
      expect(result[0].interestCategoryName).toBeNull();
      // Principal attribution from the same splits is untouched -- only the
      // interest split of a future/voided linked source is untrusted.
      expect(result[0].principalAmount).toBe(400);
    });

    it("does not surface a voided linked source's interest split when bounded by asOfDate", async () => {
      transactionRepository.findOne.mockResolvedValue(
        makeLinkedSourceTx({
          transactionDate: "2026-08-04", // not future -- void is the only defect
          status: TransactionStatus.VOID,
        }),
      );
      transactionRepository.manager.find.mockResolvedValue(splitRows);

      const result = await service.buildPaymentRecords(
        "user-1",
        "loan-1",
        [loanSideTx()],
        "2026-08-04",
      );

      expect(result[0].interestAmount).toBeNull();
    });

    it("control: still uses the linked source's interest split when it is not future-dated or voided", async () => {
      transactionRepository.findOne.mockResolvedValue(
        makeLinkedSourceTx({ transactionDate: "2026-08-04" }),
      );
      transactionRepository.manager.find.mockResolvedValue(splitRows);

      const result = await service.buildPaymentRecords(
        "user-1",
        "loan-1",
        [loanSideTx()],
        "2026-08-04",
      );

      expect(result[0].interestAmount).toBe(100);
      expect(result[0].interestCategoryId).toBe("interest-cat-1");
    });

    it("control: with no asOfDate (detectPaymentPattern's unbounded default), a future-dated linked source's interest is still used", async () => {
      transactionRepository.findOne.mockResolvedValue(
        makeLinkedSourceTx({ transactionDate: "2026-08-05" }),
      );
      transactionRepository.manager.find.mockResolvedValue(splitRows);

      const result = await service.buildPaymentRecords(
        "user-1",
        "loan-1",
        [loanSideTx()],
        // no asOfDate -- must behave exactly as before this parameter existed
      );

      expect(result[0].interestAmount).toBe(100);
      expect(result[0].interestCategoryId).toBe("interest-cat-1");
    });
  });

  describe("pairSeparateInterest", () => {
    const interestAccount = {
      id: "loan-1",
      userId: "user-1",
      interestCategoryId: "cat-int",
    } as any;

    const makePayment = (date: string, over: Partial<any> = {}): any => ({
      date,
      amount: 900,
      sourceAccountId: "bank-1",
      sourceAccountName: "Bank",
      interestAmount: null,
      principalAmount: null,
      extraPrincipalAmount: null,
      principalSplitAmounts: [],
      interestCategoryId: null,
      interestCategoryName: null,
      ...over,
    });

    // Default: no conflicting loan accounts share this interest category.
    // Tests that need conflict detection override this per-test.
    beforeEach(() => {
      accountsRepository.find.mockResolvedValue([]);
    });

    it("returns payments untouched when the loan has no interest category", async () => {
      const payments = [makePayment("2026-01-05"), makePayment("2026-02-05")];
      const result = await service.pairSeparateInterest(
        "user-1",
        { id: "loan-1" } as any,
        payments,
      );
      expect(result).toBe(payments);
      expect(transactionRepository.find).not.toHaveBeenCalled();
    });

    /**
     * Control for the fix below: an AUTO-mode account (or any mode other
     * than SEPARATE) never asserted that this loan's interest is booked
     * separately, so a missing/cleared interestCategoryId is still "the
     * question doesn't apply" -- must keep returning payments unchanged by
     * reference, with no DB query attempted. This must not regress.
     */
    it("returns payments untouched when an AUTO-mode account has no interest category configured (control)", async () => {
      const payments = [makePayment("2026-01-05"), makePayment("2026-02-05")];
      const result = await service.pairSeparateInterest(
        "user-1",
        {
          id: "loan-1",
          interestBookingMode: "AUTO",
          interestCategoryId: null,
        } as any,
        payments,
      );
      expect(result).toBe(payments);
      expect(transactionRepository.find).not.toHaveBeenCalled();
    });

    /**
     * REV-20260803-006, reopened a SIXTH time. Pass 5's structural audit
     * categorized the `!interestCategoryId` early-return as
     * "correctly-unmarked -- the question doesn't apply" for every account
     * with no configured category, without distinguishing booking mode.
     * That is wrong for SEPARATE-mode accounts specifically: SEPARATE is
     * the account's own positive assertion that this loan's interest IS
     * booked as a separate expense, so a cleared/missing category (nullable
     * independently of the booking mode) means detection cannot find the
     * interest it knows must exist -- the same "pairing attempted
     * (implicitly, by the account's own configuration) and failed to find
     * anything" state as the interestTxns.length === 0 branch, not "doesn't
     * apply." Every eligible record must come back marked
     * `interestUnmatched: true`, not returned unchanged.
     */
    it("marks every eligible record interestUnmatched when a SEPARATE-mode account has a cleared interest category", async () => {
      const payments = [
        makePayment("2026-01-05", { amount: 450 }),
        makePayment("2026-02-05", { amount: 450 }),
        makePayment("2026-03-05", { amount: 450 }),
      ];
      const result = await service.pairSeparateInterest(
        "user-1",
        {
          id: "loan-1",
          interestBookingMode: "SEPARATE",
          interestCategoryId: null,
        } as any,
        payments,
      );
      // No category to query against, so no DB lookup is even attempted --
      // matching the "skips the lookup but still marks" shape of the
      // sourceIds.length === 0 branch elsewhere in this method.
      expect(transactionRepository.find).not.toHaveBeenCalled();
      expect(result.every((p) => p.interestUnmatched === true)).toBe(true);
      // `amount` is left as the principal-only subtotal it already was --
      // this method never invents an interest figure, it only flags that
      // one is missing.
      expect(result.every((p) => p.amount === 450)).toBe(true);
      // Records are copied, not mutated in place.
      expect(payments.every((p) => p.interestUnmatched === undefined)).toBe(
        true,
      );
    });

    /**
     * REV-20260803-008. These two use real `Transaction` instances rather than
     * the plain object literals the rest of this describe block uses, because
     * the claim under test is about the entity's own `isVoid` getter. A plain
     * `{ status: "VOID" }` literal has no getter, so `isVoid` would be
     * `undefined` and the test would pass against the unfixed code -- the
     * "a mock must return what the real collaborator returns" trap in
     * backend/CLAUDE.md. `find()` returns hydrated entities, so this is also
     * what the real repository hands back.
     */
    const makeInterestTx = (over: Partial<Transaction>): Transaction =>
      Object.assign(new Transaction(), {
        accountId: "bank-1",
        categoryId: "cat-int",
        isTransfer: false,
        status: TransactionStatus.CLEARED,
        ...over,
      });

    it("ignores a voided interest transaction while still counting its live sibling", async () => {
      const payments = [makePayment("2026-01-05"), makePayment("2026-02-05")];
      transactionRepository.find.mockResolvedValue([
        // Voided: out of the ledger, so it must not reach the interest sum.
        makeInterestTx({
          transactionDate: "2026-01-05",
          amount: -153.63,
          status: TransactionStatus.VOID,
        }),
        // Live, same category and window: proves the filter is selective
        // rather than dropping the whole batch.
        makeInterestTx({ transactionDate: "2026-02-05", amount: -140.7 }),
      ]);

      const result = await service.pairSeparateInterest(
        "user-1",
        interestAccount,
        payments,
      );

      expect(result[0].interestAmount).toBeNull();
      expect(result[1].interestAmount).toBeCloseTo(140.7, 2);
    });

    it("keeps an interest transaction whose status is null", async () => {
      // `transactions.status` is nullable (VARCHAR(20) DEFAULT 'UNRECONCILED',
      // no NOT NULL), which is why the reports spell the filter
      // `(t.status IS NULL OR t.status != 'VOID')`. A SQL `status != 'VOID'`
      // here would silently discard these rows -- trading the voided-interest
      // bug for a missing-interest one.
      const payments = [makePayment("2026-01-05")];
      transactionRepository.find.mockResolvedValue([
        makeInterestTx({
          transactionDate: "2026-01-05",
          amount: -153.63,
          status: null as unknown as TransactionStatus,
        }),
      ]);

      const result = await service.pairSeparateInterest(
        "user-1",
        interestAccount,
        payments,
      );

      expect(result[0].interestAmount).toBeCloseTo(153.63, 2);
    });

    it("fills interest from separate categorized transactions, paired by nearest date and summed per period", async () => {
      const payments = [
        makePayment("2026-01-05"),
        makePayment("2026-02-05"),
        makePayment("2026-03-05"),
      ];
      transactionRepository.find.mockResolvedValue([
        {
          transactionDate: "2026-01-05",
          amount: -153.63,
          accountId: "bank-1",
          categoryId: "cat-int",
        },
        {
          transactionDate: "2026-02-06",
          amount: -140.7,
          accountId: "bank-1",
          categoryId: "cat-int",
        },
        // Interest split across two rows in the same period is summed.
        {
          transactionDate: "2026-03-04",
          amount: -100,
          accountId: "bank-1",
          categoryId: "cat-int",
        },
        {
          transactionDate: "2026-03-05",
          amount: -27.5,
          accountId: "bank-1",
          categoryId: "cat-int",
        },
      ]);

      const result = await service.pairSeparateInterest(
        "user-1",
        interestAccount,
        payments,
      );

      expect(result[0].interestAmount).toBeCloseTo(153.63, 2);
      expect(result[1].interestAmount).toBeCloseTo(140.7, 2);
      expect(result[2].interestAmount).toBeCloseTo(127.5, 2);
      // Records are copied, not mutated.
      expect(payments[0].interestAmount).toBeNull();
    });

    it("excludes principal transfers that share the interest category (only expenses count)", async () => {
      const payments = [makePayment("2024-06-05", { amount: 259.13 })];
      transactionRepository.find.mockResolvedValue([
        // The interest expense -- counted.
        {
          transactionDate: "2024-06-05",
          amount: -849.93,
          accountId: "bank-1",
          categoryId: "cat-int",
          isTransfer: false,
        },
        // The principal transfer, tagged with the same category -- excluded, so
        // it is not folded into "interest" (which would give the full rata).
        {
          transactionDate: "2024-06-05",
          amount: -259.13,
          accountId: "bank-1",
          categoryId: "cat-int",
          isTransfer: true,
        },
      ]);

      const result = await service.pairSeparateInterest(
        "user-1",
        interestAccount,
        payments,
      );

      // Only the expense -> 849.93, not 849.93 + 259.13 = 1109.06 (full rata).
      expect(result[0].interestAmount).toBeCloseTo(849.93, 2);
    });

    it("does not override interest already read from a payment split", async () => {
      const payments = [
        makePayment("2026-01-05", { interestAmount: 200 }),
        makePayment("2026-02-05"),
      ];
      transactionRepository.find.mockResolvedValue([
        {
          transactionDate: "2026-01-05",
          amount: -153.63,
          accountId: "bank-1",
          categoryId: "cat-int",
        },
        {
          transactionDate: "2026-02-05",
          amount: -140.7,
          accountId: "bank-1",
          categoryId: "cat-int",
        },
      ]);

      const result = await service.pairSeparateInterest(
        "user-1",
        interestAccount,
        payments,
      );

      expect(result[0].interestAmount).toBe(200);
      expect(result[1].interestAmount).toBeCloseTo(140.7, 2);
    });

    it("ignores interest transactions that are not near any payment", async () => {
      const payments = [makePayment("2026-01-05"), makePayment("2026-02-05")];
      transactionRepository.find.mockResolvedValue([
        {
          transactionDate: "2026-01-05",
          amount: -153.63,
          accountId: "bank-1",
          categoryId: "cat-int",
        },
        // Far from every payment -> dropped.
        {
          transactionDate: "2026-06-01",
          amount: -999,
          accountId: "bank-1",
          categoryId: "cat-int",
        },
      ]);

      const result = await service.pairSeparateInterest(
        "user-1",
        interestAccount,
        payments,
      );

      expect(result[0].interestAmount).toBeCloseTo(153.63, 2);
      expect(result[1].interestAmount).toBeNull();
    });

    /**
     * REV-20260803-006 (reopened a third time). Distinct from "no interest
     * category configured" (returns payments untouched, above) and "no
     * source account" (also marks every record interestUnmatched, below):
     * here the account DOES expect separate interest and the payments DO
     * have known source accounts, but the query for that category found
     * nothing at all. Every record must come back marked
     * `interestUnmatched: true` so `detectRegularAmount` can tell this apart
     * from "not applicable" and refuse to vote over the resulting
     * principal-only subtotals.
     */
    it("marks every record interestUnmatched when the interest-category query finds nothing at all", async () => {
      const payments = [
        makePayment("2026-01-05"),
        makePayment("2026-02-05"),
        makePayment("2026-03-05"),
      ];
      transactionRepository.find.mockResolvedValue([]);

      const result = await service.pairSeparateInterest(
        "user-1",
        interestAccount,
        payments,
      );

      expect(result.every((p) => p.interestUnmatched === true)).toBe(true);
      expect(result.every((p) => p.interestAmount == null)).toBe(true);
    });

    /**
     * REV-20260803-006 (reopened a fourth time). Previously this asserted
     * `result === payments` (returned unchanged, by reference) -- but that is
     * exactly the bug: with no source account known for any payment, there is
     * nothing to query, yet the account still expects separate interest and
     * each payment's `amount` is still a principal-only subtotal. The
     * "skips the lookup" behavior worth keeping is that no DB query is
     * attempted (asserted below via the repository mock), not that the
     * records come back unmarked -- so this now asserts every record is
     * marked `interestUnmatched: true`, the same signal used when the query
     * runs and finds nothing.
     */
    it("skips the lookup but still marks every record interestUnmatched when the payments have no source account", async () => {
      const payments = [
        makePayment("2026-01-05", { sourceAccountId: null }),
        makePayment("2026-02-05", { sourceAccountId: null }),
      ];
      const result = await service.pairSeparateInterest(
        "user-1",
        interestAccount,
        payments,
      );
      expect(transactionRepository.find).not.toHaveBeenCalled();
      expect(result.every((p) => p.interestUnmatched === true)).toBe(true);
      expect(result.every((p) => p.interestAmount == null)).toBe(true);
      // Records are copied, not mutated in place.
      expect(payments.every((p) => p.interestUnmatched === undefined)).toBe(
        true,
      );
    });

    /**
     * REV-20260803-006, the exact scenario from the fourth reopen note:
     * three imported/unlinked principal transfers on a SEPARATE-mode loan
     * with a configured interest category, none carrying a sourceAccountId.
     * Before the fix, `pairSeparateInterest`'s no-source early-return left
     * every record unmarked, so `detectRegularAmount` voted over the three
     * repeated $450 principal-only amounts and `detectPaymentPattern`
     * reported `paymentAmount: 450` as if that were the complete
     * installment -- a subtotal reported as a total. The interest was never
     * established (no source account to pair against), so the correct
     * result is `null` ("cannot determine"), matching the third-pass
     * convention for the sibling "query found nothing" case.
     */
    it("returns null (not the $450 principal subtotal) when a SEPARATE-mode loan's payments have no source account at all", async () => {
      const account = {
        id: "loan-1",
        userId: "user-1",
        accountType: AccountType.LOAN,
        interestBookingMode: "SEPARATE",
        interestCategoryId: "cat-int",
        currentBalance: -10000,
      } as any;

      const transactions = [
        {
          id: "tx-1",
          accountId: "loan-1",
          amount: 450,
          transactionDate: "2026-01-05",
          isTransfer: false,
          linkedTransactionId: null,
        },
        {
          id: "tx-2",
          accountId: "loan-1",
          amount: 450,
          transactionDate: "2026-02-05",
          isTransfer: false,
          linkedTransactionId: null,
        },
        {
          id: "tx-3",
          accountId: "loan-1",
          amount: 450,
          transactionDate: "2026-03-05",
          isTransfer: false,
          linkedTransactionId: null,
        },
      ] as any;

      accountsRepository.findOne.mockResolvedValue(account);
      transactionRepository.find.mockResolvedValue(transactions);

      const result = await service.detectPaymentPattern("user-1", "loan-1");

      // The interest-category query would only ever be reached past the
      // sourceIds.length === 0 early-return; transactionRepository.find is
      // called exactly once here (the main transactions read), confirming
      // that early-return short-circuited before any interest lookup.
      expect(transactionRepository.find).toHaveBeenCalledTimes(1);
      expect(result).toBeNull();
    });

    /**
     * Companion fix for REV-20260803-024 ("Future-dated loan transactions
     * contaminate historical rate inference"). The finding was reopened three
     * times against `rate-change-inference.service.ts`, but the actual leak
     * traces back here: this method's separate-interest-candidate query had
     * no upper date bound at all, so a future-dated interest expense within
     * the 45-day window could pair to a payment regardless of "today".
     *
     * The mock below is functional (filters by the real `Between` bounds
     * passed to `find`, read off the FindOperator's `.value`) rather than a
     * fixed `mockResolvedValue`, precisely so this test exercises the actual
     * query range this method builds -- a fixed-return mock would pass
     * whether or not the date bound were applied, proving nothing.
     */
    const makeDateBoundedFindMock = (
      rows: Array<{
        transactionDate: string;
        amount: number;
        accountId: string;
        categoryId: string;
      }>,
    ) =>
      jest.fn().mockImplementation((opts: any) => {
        const dateOp = opts.where.transactionDate;
        const [start, end] = dateOp.value as [string, string];
        return Promise.resolve(
          rows.filter(
            (r) => r.transactionDate >= start && r.transactionDate <= end,
          ),
        );
      });

    it("excludes a future-dated separate-interest expense when asOfDate is given, leaving that payment interestUnmatched", async () => {
      const payments = [makePayment("2026-01-05"), makePayment("2026-02-05")];
      // Jan-05 candidate is real as of asOfDate; Feb-20 is beyond asOfDate
      // but would otherwise land within 45 days of Feb-05 and the ~16-day
      // nearest-payment tolerance derived from these two dates.
      transactionRepository.find = makeDateBoundedFindMock([
        {
          transactionDate: "2026-01-05",
          amount: -150,
          accountId: "bank-1",
          categoryId: "cat-int",
        },
        {
          transactionDate: "2026-02-20",
          amount: -140,
          accountId: "bank-1",
          categoryId: "cat-int",
        },
      ]);

      const result = await service.pairSeparateInterest(
        "user-1",
        interestAccount,
        payments,
        "2026-02-10",
      );

      expect(result[0].interestAmount).toBeCloseTo(150, 2);
      // The Feb-20 expense is after asOfDate, so it never reaches the
      // pairing step: this payment stays unmatched, not silently paired to
      // a future transaction.
      expect(result[1].interestUnmatched).toBe(true);
      expect(result[1].interestAmount).toBeNull();
    });

    it("still pairs a future-dated separate-interest expense when asOfDate is omitted (detectPaymentPattern's existing behavior is unaffected)", async () => {
      const payments = [makePayment("2026-01-05"), makePayment("2026-02-05")];
      transactionRepository.find = makeDateBoundedFindMock([
        {
          transactionDate: "2026-01-05",
          amount: -150,
          accountId: "bank-1",
          categoryId: "cat-int",
        },
        {
          transactionDate: "2026-02-20",
          amount: -140,
          accountId: "bank-1",
          categoryId: "cat-int",
        },
      ]);

      // No asOfDate passed -- identical to every pre-existing call site,
      // including detectPaymentPattern's.
      const result = await service.pairSeparateInterest(
        "user-1",
        interestAccount,
        payments,
      );

      expect(result[0].interestAmount).toBeCloseTo(150, 2);
      expect(result[1].interestAmount).toBeCloseTo(140, 2);
      expect(result[1].interestUnmatched).toBeUndefined();
    });

    /**
     * REV-20260803-022. Two loans (loan-1 and loan-2) share the same
     * interest category ("cat-int") and are both paid from the same chequing
     * account ("bank-1"). Before this fix, pairSeparateInterest queried all
     * interest transactions in "bank-1" with category "cat-int" and summed
     * them, so both loans saw both sets of interest expenses and each
     * produced a falsely-inflated rate. After the fix, the linked-transfer
     * check detects that "bank-1" also funds loan-2, and all payments for
     * loan-1 are returned with interestUnmatched: true instead of a wrong sum.
     */
    it("marks every record interestUnmatched when the same interest category is shared with another loan paid from the same source account (REV-20260803-022)", async () => {
      const payments = [
        makePayment("2026-01-05", { amount: 450 }),
        makePayment("2026-02-05", { amount: 450 }),
        // One payment already has split-based interest -- must be left untouched.
        makePayment("2026-03-05", { amount: 500, interestAmount: 50 }),
      ];

      // Two loan accounts share the same interest category.
      accountsRepository.find.mockResolvedValue([
        { id: "loan-1" },
        { id: "loan-2" },
      ]);

      // The source account ("bank-1") has transfers to both loans: one linked
      // to loan-1 (this account's payment) and one linked to loan-2.
      transactionRepository.find.mockResolvedValue([
        { linkedTransactionId: "loan1-tx" },
        { linkedTransactionId: "loan2-tx" },
      ]);

      // The conflict: one of the linked transactions lands on loan-2.
      transactionRepository.findOne.mockResolvedValue({
        id: "loan2-tx",
        accountId: "loan-2",
      });

      const result = await service.pairSeparateInterest(
        "user-1",
        interestAccount,
        payments,
      );

      // Payments without split-based interest are ambiguous -- must not carry
      // a falsely summed interest figure.
      expect(result[0].interestUnmatched).toBe(true);
      expect(result[0].interestAmount).toBeNull();
      expect(result[1].interestUnmatched).toBe(true);
      expect(result[1].interestAmount).toBeNull();
      // A payment that already has split-based interest is left untouched --
      // the ambiguity applies only to the separate-expense pairing path.
      expect(result[2].interestAmount).toBe(50);
      expect(result[2].interestUnmatched).toBeUndefined();
      // Records are copied, not mutated.
      expect(payments[0].interestUnmatched).toBeUndefined();
    });

    /**
     * REV-20260803-022 re-review. Same setup as above but loan-2's principal
     * payment is imported without transfer linkage: the source account (bank-1)
     * has no linked transaction pointing to loan-2, and loan-2's own account
     * record carries linkedTransactionId: null. The source-side chain therefore
     * finds no evidence of a conflict and the old code returned isAmbiguous =
     * false, letting loan-1 sum $300 interest ($100 its own + $200 loan-2's).
     * The fix checks the other loan accounts directly and treats any unlinked
     * transaction as a source-unknown record that cannot be ruled out.
     */
    it("marks every record interestUnmatched when another loan's payment is unlinked/imported (no linkedTransactionId on either side)", async () => {
      const payments = [
        makePayment("2026-01-05", { amount: 450 }),
        makePayment("2026-02-05", { amount: 450 }),
        makePayment("2026-03-05", { amount: 500, interestAmount: 50 }),
      ];

      // Two loans share the same interest category.
      accountsRepository.find.mockResolvedValue([
        { id: "loan-1" },
        { id: "loan-2" },
      ]);

      // The source account (bank-1) has a linked transfer only for loan-1.
      // Loan-2's payment was imported without linkage, so bank-1 has no
      // corresponding linked record for it.
      transactionRepository.find
        .mockResolvedValueOnce([{ linkedTransactionId: "loan1-tx" }])
        .mockResolvedValueOnce([{ linkedTransactionId: null }]);

      // "loan1-tx" does not land on loan-2 -- no source-side conflict found.
      transactionRepository.findOne.mockResolvedValue(null);

      const result = await service.pairSeparateInterest(
        "user-1",
        interestAccount,
        payments,
      );

      // Pairing is ambiguous: loan-2's unlinked transaction has an unknown
      // source account, so interest on bank-1 cannot be attributed to loan-1
      // alone. Payments without split-based interest must be marked unmatched.
      expect(result[0].interestUnmatched).toBe(true);
      expect(result[0].interestAmount).toBeNull();
      expect(result[1].interestUnmatched).toBe(true);
      expect(result[1].interestAmount).toBeNull();
      // A payment that already has split-based interest is left untouched.
      expect(result[2].interestAmount).toBe(50);
      expect(result[2].interestUnmatched).toBeUndefined();
    });

    /**
     * REV-20260803-022 re-review (third reopen). Loan A and loan B share
     * interestCategoryId="cat-int" and sourceAccountId="bank-1", but loan B
     * has no transactions on its loan account in the ±45-day window (its
     * principal posting has not arrived yet). The source-side transfer chain
     * therefore finds nothing pointing to loan B, otherLoanTxs is empty, and
     * the previous code returned isAmbiguous=false -- letting loan A sum
     * $300 ($100 its own + $200 belonging to loan B).
     *
     * The fix checks conflicting loans' sourceAccountId directly from account
     * configuration before querying transactions, so a shared funding source
     * is detected regardless of whether any transactions have been imported.
     */
    it("marks every record interestUnmatched when another loan shares the same source account but has no transactions yet in the window", async () => {
      const payments = [
        makePayment("2026-01-05", { amount: 450 }),
        makePayment("2026-02-05", { amount: 450 }),
        makePayment("2026-03-05", { amount: 500, interestAmount: 50 }),
      ];

      // Loan B shares both the interest category and the source account
      // (bank-1), but has no transactions in the date window.
      accountsRepository.find.mockResolvedValue([
        { id: "loan-1", sourceAccountId: "bank-1" },
        { id: "loan-2", sourceAccountId: "bank-1" },
      ]);

      // Transaction queries must NOT be reached -- the config-level check
      // returns ambiguous before any transaction lookup runs.
      const result = await service.pairSeparateInterest(
        "user-1",
        interestAccount,
        payments,
      );

      // No transaction-level queries were needed for ambiguity detection.
      expect(transactionRepository.find).not.toHaveBeenCalled();
      expect(transactionRepository.findOne).not.toHaveBeenCalled();
      // Payments without split-based interest are ambiguous.
      expect(result[0].interestUnmatched).toBe(true);
      expect(result[0].interestAmount).toBeNull();
      expect(result[1].interestUnmatched).toBe(true);
      expect(result[1].interestAmount).toBeNull();
      // A payment that already has split-based interest is left untouched.
      expect(result[2].interestAmount).toBe(50);
      expect(result[2].interestUnmatched).toBeUndefined();
      // Records are copied, not mutated.
      expect(payments[0].interestUnmatched).toBeUndefined();
    });

    /**
     * REV-20260803-022 (fourth reopen). Loan A has sourceAccountId=bank-1
     * and interestCategoryId=cat-int; loan B has interestCategoryId=cat-int
     * but no configured sourceAccountId and no loan-account transactions in
     * the ±45-day window.
     *
     * bank-1 carries both A's $100 and B's $200 standalone cat-int expenses.
     * The previous code returned isAmbiguous=false because:
     *   - sharedSourceLoan check requires sourceAccountId != null (B skipped)
     *   - otherLoanTxs for B is empty (no principal transactions posted yet)
     *   - otherLoanTxs.some(unlinked) => false on an empty array
     * ...so loan A summed $300. The fix counts non-transfer interest-category
     * expenses on our source accounts; finding any while an unknown-source
     * loan exists flags the pairing as ambiguous.
     */
    it("marks every record interestUnmatched when another loan has the same interest category but no configured sourceAccountId and no loan-account transactions (REV-20260803-022 fourth reopen)", async () => {
      const payments = [
        makePayment("2026-01-05", { amount: 350 }),
        makePayment("2026-02-05", { amount: 350 }),
        makePayment("2026-03-05", { amount: 400, interestAmount: 50 }),
      ];

      // Loan B shares the interest category but has no sourceAccountId.
      accountsRepository.find.mockResolvedValue([
        { id: "loan-1", sourceAccountId: "bank-1" },
        { id: "loan-2", sourceAccountId: null },
      ]);

      // No linked transfers on bank-1 pointing to either loan.
      transactionRepository.find
        .mockResolvedValueOnce([]) // sourceTransfers
        .mockResolvedValueOnce([]); // otherLoanTxs for loan-2 (no activity)

      // Candidate count: bank-1 has 2 non-transfer cat-int expenses ($100 A,
      // $200 B). The fix detects > 0 candidates and flags as ambiguous.
      transactionRepository.count.mockResolvedValue(2);

      const result = await service.pairSeparateInterest(
        "user-1",
        interestAccount,
        payments,
      );

      // Pairing is ambiguous: loan B's interest is indistinguishable from
      // loan A's by account+category alone. Payments without split-based
      // interest must be marked unmatched rather than summed.
      expect(result[0].interestUnmatched).toBe(true);
      expect(result[0].interestAmount).toBeNull();
      expect(result[1].interestUnmatched).toBe(true);
      expect(result[1].interestAmount).toBeNull();
      // A payment with existing split-based interest is left untouched.
      expect(result[2].interestAmount).toBe(50);
      expect(result[2].interestUnmatched).toBeUndefined();
      // Records are copied, not mutated.
      expect(payments[0].interestUnmatched).toBeUndefined();
    });

    /**
     * Control for the fourth reopen: when the same null-sourceAccountId loan
     * exists but there are NO interest-category expenses on our source
     * accounts in the window, attribution is not ambiguous and pairing
     * proceeds normally.
     */
    it("still pairs interest normally when a null-sourceAccountId conflicting loan exists but has no candidate expenses on our source accounts (REV-20260803-022 fourth reopen control)", async () => {
      const payments = [makePayment("2026-01-05"), makePayment("2026-02-05")];

      // Loan B shares category but has no sourceAccountId.
      accountsRepository.find.mockResolvedValue([
        { id: "loan-1", sourceAccountId: "bank-1" },
        { id: "loan-2", sourceAccountId: null },
      ]);

      transactionRepository.find
        .mockResolvedValueOnce([]) // sourceTransfers
        .mockResolvedValueOnce([]); // otherLoanTxs

      // No candidate interest expenses on bank-1 -- nothing to confuse.
      transactionRepository.count.mockResolvedValue(0);

      // Interest transactions for the main pairing query.
      transactionRepository.find.mockResolvedValueOnce([
        {
          transactionDate: "2026-01-05",
          amount: -100,
          accountId: "bank-1",
          categoryId: "cat-int",
          isTransfer: false,
          status: TransactionStatus.CLEARED,
        },
        {
          transactionDate: "2026-02-05",
          amount: -200,
          accountId: "bank-1",
          categoryId: "cat-int",
          isTransfer: false,
          status: TransactionStatus.CLEARED,
        },
      ]);

      const result = await service.pairSeparateInterest(
        "user-1",
        interestAccount,
        payments,
      );

      // No ambiguity: pairing proceeds and attributes the interest correctly.
      expect(result[0].interestAmount).toBeCloseTo(100, 2);
      expect(result[1].interestAmount).toBeCloseTo(200, 2);
      expect(result[0].interestUnmatched).toBeUndefined();
      expect(result[1].interestUnmatched).toBeUndefined();
    });

    /**
     * REV-20260803-022 (fifth reopen). Loan A has sourceAccountId=bank-1 and
     * interestCategoryId=cat-int. Loan B has sourceAccountId=bank-1 but
     * interestCategoryId=null (not configured). Loan B is therefore invisible
     * to sameInterestAccounts (which filters by category) and to all checks
     * derived from it -- sharedSourceLoan, otherLoanIds, unknownSourceLoans.
     * bank-1 carries both A's $100 and B's $200 cat-int expenses; without the
     * fix, otherLoanIds is empty and the code returns isAmbiguous=false,
     * letting loan A sum $300.
     */
    it("marks every record interestUnmatched when another loan shares the source account but has no interestCategoryId configured (REV-20260803-022 fifth reopen)", async () => {
      const payments = [
        makePayment("2026-01-05", { amount: 350 }),
        makePayment("2026-02-05", { amount: 350 }),
        makePayment("2026-03-05", { amount: 400, interestAmount: 50 }),
      ];

      // sameInterestAccounts: only loan-1 has category=cat-int; loan-2's null
      // category excludes it from this query.
      accountsRepository.find
        .mockResolvedValueOnce([{ id: "loan-1", sourceAccountId: "bank-1" }])
        // sameSourceNoCategoryLoans: loan-2 shares sourceAccountId=bank-1 but
        // has interestCategoryId=null.
        .mockResolvedValueOnce([{ id: "loan-2" }]);

      // bank-1 has 2 non-transfer cat-int expenses ($100 A + $200 B).
      transactionRepository.count.mockResolvedValue(2);

      const result = await service.pairSeparateInterest(
        "user-1",
        interestAccount,
        payments,
      );

      // Pairing is ambiguous: B's expenses are indistinguishable from A's.
      expect(result[0].interestUnmatched).toBe(true);
      expect(result[0].interestAmount).toBeNull();
      expect(result[1].interestUnmatched).toBe(true);
      expect(result[1].interestAmount).toBeNull();
      // A payment with existing split-based interest is left untouched.
      expect(result[2].interestAmount).toBe(50);
      expect(result[2].interestUnmatched).toBeUndefined();
      // Records are copied, not mutated.
      expect(payments[0].interestUnmatched).toBeUndefined();
    });

    /**
     * Control for the fifth reopen: when the same-source unconfigured loan
     * exists but has NO cat-int expenses on our source accounts, attribution is
     * not ambiguous and pairing proceeds normally.
     */
    it("still pairs interest normally when a same-source null-category loan exists but has no candidate expenses (REV-20260803-022 fifth reopen control)", async () => {
      const payments = [makePayment("2026-01-05"), makePayment("2026-02-05")];

      accountsRepository.find
        .mockResolvedValueOnce([{ id: "loan-1", sourceAccountId: "bank-1" }])
        .mockResolvedValueOnce([{ id: "loan-2" }]);

      // No candidate expenses on bank-1 -- nothing to confuse.
      transactionRepository.count.mockResolvedValue(0);

      // Main pairing query returns the interest transactions.
      transactionRepository.find.mockResolvedValueOnce([
        {
          transactionDate: "2026-01-05",
          amount: -100,
          accountId: "bank-1",
          categoryId: "cat-int",
          isTransfer: false,
          status: TransactionStatus.CLEARED,
        },
        {
          transactionDate: "2026-02-05",
          amount: -200,
          accountId: "bank-1",
          categoryId: "cat-int",
          isTransfer: false,
          status: TransactionStatus.CLEARED,
        },
      ]);

      const result = await service.pairSeparateInterest(
        "user-1",
        interestAccount,
        payments,
      );

      expect(result[0].interestAmount).toBeCloseTo(100, 2);
      expect(result[1].interestAmount).toBeCloseTo(200, 2);
      expect(result[0].interestUnmatched).toBeUndefined();
      expect(result[1].interestUnmatched).toBeUndefined();
    });

    /**
     * Control for REV-20260803-022: when only one loan has this interest
     * category (no conflict), pairing still proceeds normally and the
     * separate interest is attributed to this loan's payments.
     */
    it("still pairs interest normally when no other loan shares the same interest category and source account", async () => {
      const payments = [makePayment("2026-01-05"), makePayment("2026-02-05")];

      // Only this loan has the interest category -- no conflict.
      accountsRepository.find.mockResolvedValue([{ id: "loan-1" }]);

      transactionRepository.find.mockResolvedValue([
        {
          transactionDate: "2026-01-05",
          amount: -100,
          accountId: "bank-1",
          categoryId: "cat-int",
          isTransfer: false,
          status: TransactionStatus.CLEARED,
        },
        {
          transactionDate: "2026-02-05",
          amount: -200,
          accountId: "bank-1",
          categoryId: "cat-int",
          isTransfer: false,
          status: TransactionStatus.CLEARED,
        },
      ]);

      const result = await service.pairSeparateInterest(
        "user-1",
        interestAccount,
        payments,
      );

      expect(result[0].interestAmount).toBeCloseTo(100, 2);
      expect(result[1].interestAmount).toBeCloseTo(200, 2);
      expect(result[0].interestUnmatched).toBeUndefined();
      expect(result[1].interestUnmatched).toBeUndefined();
    });
  });
});
