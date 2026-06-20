import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException } from "@nestjs/common";
import { TransactionToolPrepService } from "./transaction-tool-prep.service";
import { AccountsService } from "../accounts/accounts.service";
import { TransactionsService } from "./transactions.service";
import { TransactionTransferService } from "./transaction-transfer.service";
import { TransactionAnalyticsService } from "./transaction-analytics.service";

describe("TransactionToolPrepService", () => {
  let service: TransactionToolPrepService;
  let accounts: Record<string, jest.Mock>;
  let transactions: Record<string, jest.Mock>;
  let transfer: Record<string, jest.Mock>;
  let analytics: Record<string, jest.Mock>;

  const userId = "user-1";

  const createPreview = {
    accountId: "a1",
    accountName: "Checking",
    amount: -10,
    transactionDate: "2026-01-15",
    payeeId: null,
    payeeName: "Store",
    payeeMatched: false,
    payeeWillBeCreated: true,
    categoryId: "c1",
    categoryName: "Dining",
    description: null,
    currencyCode: "USD",
  };

  beforeEach(async () => {
    accounts = {
      resolveByName: jest.fn(async (_u: string, name: string) =>
        name.toLowerCase() === "checking"
          ? { id: "a1", name: "Checking", currencyCode: "USD" }
          : name.toLowerCase() === "savings"
            ? { id: "a2", name: "Savings", currencyCode: "USD" }
            : undefined,
      ),
    };
    transactions = {
      previewCreate: jest.fn().mockResolvedValue(createPreview),
      previewUpdate: jest.fn().mockResolvedValue({
        transactionId: "t1",
        accountId: "a1",
        accountName: "Checking",
        amount: -30,
        transactionDate: "2026-02-01",
        payeeId: "p1",
        payeeName: "Store",
        payeeMatched: true,
        payeeWillBeCreated: false,
        categoryId: "c1",
        categoryName: "Dining",
        description: null,
        currencyCode: "USD",
      }),
      previewDelete: jest.fn().mockResolvedValue({
        transactionId: "t1",
        accountName: "Checking",
        amount: -30,
        transactionDate: "2026-02-01",
        payeeName: "Store",
        categoryName: "Dining",
        description: null,
        currencyCode: "USD",
      }),
      findOne: jest.fn().mockResolvedValue({
        id: "t1",
        isTransfer: false,
        linkedTransactionId: null,
      }),
    };
    transfer = {
      isTransfer: jest.fn(
        (t: { isTransfer?: boolean }) => t.isTransfer === true,
      ),
      previewCreateTransfer: jest.fn().mockResolvedValue({
        fromAccountId: "a1",
        fromAccountName: "Checking",
        fromCurrencyCode: "USD",
        toAccountId: "a2",
        toAccountName: "Savings",
        toCurrencyCode: "USD",
        amount: 100,
        toAmount: 100,
        exchangeRate: 1,
        transactionDate: "2026-01-15",
        description: null,
      }),
      previewUpdateTransfer: jest.fn().mockResolvedValue({
        transactionId: "t1",
        fromAccountId: "a1",
        fromAccountName: "Checking",
        fromCurrencyCode: "USD",
        toAccountId: "a2",
        toAccountName: "Savings",
        toCurrencyCode: "USD",
        amount: 100,
        toAmount: 100,
        exchangeRate: 1,
        transactionDate: "2026-01-15",
        description: null,
      }),
    };
    analytics = {
      resolveLlmCategoryIds: jest
        .fn()
        .mockResolvedValue({ categoryIds: ["c1"], unresolved: [] }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionToolPrepService,
        { provide: AccountsService, useValue: accounts },
        { provide: TransactionsService, useValue: transactions },
        { provide: TransactionTransferService, useValue: transfer },
        { provide: TransactionAnalyticsService, useValue: analytics },
      ],
    }).compile();

    service = module.get(TransactionToolPrepService);
  });

  describe("prepareCreate", () => {
    it("resolves names and builds previews, skipping unknown accounts", async () => {
      const result = await service.prepareCreate(userId, [
        { accountName: "Checking", amount: -10, date: "2026-01-15" },
        { accountName: "Ghost", amount: -5, date: "2026-01-15" },
      ]);
      expect(result.okPreviews).toHaveLength(1);
      expect(result.okIndex).toEqual([0]);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0].reason).toContain("Unknown account");
      expect(result.previewRows).toHaveLength(2);
    });

    it("skips a row with an unknown category", async () => {
      analytics.resolveLlmCategoryIds.mockResolvedValueOnce({
        categoryIds: [],
        unresolved: ["Nope"],
      });
      const result = await service.prepareCreate(userId, [
        {
          accountName: "Checking",
          amount: -10,
          date: "2026-01-15",
          categoryName: "Nope",
        },
      ]);
      expect(result.okPreviews).toHaveLength(0);
      expect(result.skipped[0].reason).toContain("Unknown category");
    });
  });

  describe("prepareCreateSingle", () => {
    it("throws on unknown account", async () => {
      await expect(
        service.prepareCreateSingle(userId, {
          accountName: "Ghost",
          amount: -1,
          date: "2026-01-15",
        }),
      ).rejects.toThrow(/Unknown account/);
    });
  });

  describe("prepareCreateTransfer", () => {
    it("resolves both accounts and builds a preview", async () => {
      const result = await service.prepareCreateTransfer(userId, [
        {
          fromAccountName: "Checking",
          toAccountName: "Savings",
          amount: 100,
          date: "2026-01-15",
        },
      ]);
      expect(result.okPreviews).toHaveLength(1);
      expect(transfer.previewCreateTransfer).toHaveBeenCalled();
    });

    it("skips when the destination account is unknown", async () => {
      const result = await service.prepareCreateTransfer(userId, [
        {
          fromAccountName: "Checking",
          toAccountName: "Ghost",
          amount: 100,
          date: "2026-01-15",
        },
      ]);
      expect(result.okPreviews).toHaveLength(0);
      expect(result.skipped[0].reason).toContain("Unknown account: Ghost");
    });
  });

  describe("prepareUpdate", () => {
    it("returns a standard preview and resolves the category", async () => {
      const result = await service.prepareUpdate(userId, {
        transactionId: "t1",
        categoryName: "Dining",
      });
      expect(result.kind).toBe("standard");
      expect(analytics.resolveLlmCategoryIds).toHaveBeenCalledWith(userId, [
        "Dining",
      ]);
    });

    it("auto-detects a transfer and returns a transfer preview", async () => {
      transactions.findOne.mockResolvedValueOnce({
        id: "t1",
        isTransfer: true,
        linkedTransactionId: "t2",
      });
      const result = await service.prepareUpdate(userId, {
        transactionId: "t1",
        amount: 100,
      });
      expect(result.kind).toBe("transfer");
      expect(transfer.previewUpdateTransfer).toHaveBeenCalled();
    });

    it("throws on an unknown category", async () => {
      analytics.resolveLlmCategoryIds.mockResolvedValueOnce({
        categoryIds: [],
        unresolved: ["Nope"],
      });
      await expect(
        service.prepareUpdate(userId, {
          transactionId: "t1",
          categoryName: "Nope",
        }),
      ).rejects.toThrow(/Unknown category/);
    });
  });

  describe("prepareUpdateBulk", () => {
    it("maps standard edits to batch rows and skips transfers", async () => {
      transactions.findOne
        .mockResolvedValueOnce({ id: "t1", isTransfer: false })
        .mockResolvedValueOnce({
          id: "t2",
          isTransfer: true,
          linkedTransactionId: "t3",
        });
      const result = await service.prepareUpdateBulk(userId, [
        { transactionId: "t1", amount: -5 },
        { transactionId: "t2", amount: 5 },
      ]);
      expect(result.okRows).toHaveLength(1);
      expect(result.skipped).toHaveLength(1);
    });
  });

  describe("prepareDelete / prepareDeleteBulk", () => {
    it("previews a single delete", async () => {
      const preview = await service.prepareDelete(userId, "t1");
      expect(preview.transactionId).toBe("t1");
    });

    it("builds batch delete rows best-effort", async () => {
      transactions.previewDelete
        .mockResolvedValueOnce({
          transactionId: "t1",
          accountName: "Checking",
          amount: -1,
          transactionDate: "2026-01-15",
          payeeName: null,
          categoryName: null,
          description: null,
          currencyCode: "USD",
        })
        .mockRejectedValueOnce(
          new BadRequestException("Transaction not found"),
        );
      const result = await service.prepareDeleteBulk(userId, ["t1", "t2"]);
      expect(result.okRows).toEqual([{ transactionId: "t1" }]);
      expect(result.skipped).toHaveLength(1);
    });
  });

  describe("transferToBatchRow", () => {
    it("maps a transfer preview to a batch row descriptor", () => {
      const row = service.transferToBatchRow({
        fromAccountId: "a1",
        fromAccountName: "Checking",
        fromCurrencyCode: "USD",
        toAccountId: "a2",
        toAccountName: "Savings",
        toCurrencyCode: "USD",
        amount: 100,
        toAmount: 100,
        exchangeRate: 1,
        transactionDate: "2026-01-15",
        description: null,
      });
      expect(row).toMatchObject({
        fromAccountId: "a1",
        toAccountId: "a2",
        amount: 100,
        toAmount: 100,
      });
    });
  });
});
