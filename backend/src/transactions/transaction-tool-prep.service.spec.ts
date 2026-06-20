import { Test, TestingModule } from "@nestjs/testing";
import {
  BadRequestException,
  InternalServerErrorException,
} from "@nestjs/common";
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

    it("skips a row when previewCreate throws (best-effort catch)", async () => {
      transactions.previewCreate.mockRejectedValueOnce(
        new BadRequestException("Amount out of range"),
      );
      const result = await service.prepareCreate(userId, [
        { accountName: "Checking", amount: -10, date: "2026-01-15" },
      ]);
      expect(result.okPreviews).toHaveLength(0);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0].reason).toContain("Amount out of range");
      expect(result.previewRows[0].status).toBe("error");
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

    it("throws on an unknown category", async () => {
      analytics.resolveLlmCategoryIds.mockResolvedValueOnce({
        categoryIds: [],
        unresolved: ["Nope"],
      });
      await expect(
        service.prepareCreateSingle(userId, {
          accountName: "Checking",
          amount: -1,
          date: "2026-01-15",
          categoryName: "Nope",
        }),
      ).rejects.toThrow(/Unknown category/);
    });

    it("resolves a category and threads createPayeeIfMissing=false", async () => {
      const result = await service.prepareCreateSingle(userId, {
        accountName: "Checking",
        amount: -1,
        date: "2026-01-15",
        categoryName: "Dining",
        createPayeeIfMissing: false,
      });
      expect(result.createPayee).toBe(false);
      expect(transactions.previewCreate).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({
          categoryId: "c1",
          createPayeeIfMissing: false,
        }),
      );
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

    it("passes a custom payeeName and default createPayeeIfMissing through to previewCreateTransfer", async () => {
      await service.prepareCreateTransfer(userId, [
        {
          fromAccountName: "Checking",
          toAccountName: "Savings",
          amount: 100,
          date: "2026-01-15",
          payeeName: "Shared rent",
        },
      ]);
      expect(transfer.previewCreateTransfer).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({
          payeeName: "Shared rent",
          createPayeeIfMissing: true,
        }),
      );
    });

    it("threads createPayeeIfMissing=false to previewCreateTransfer", async () => {
      await service.prepareCreateTransfer(userId, [
        {
          fromAccountName: "Checking",
          toAccountName: "Savings",
          amount: 100,
          date: "2026-01-15",
          payeeName: "Shared rent",
          createPayeeIfMissing: false,
        },
      ]);
      expect(transfer.previewCreateTransfer).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({ createPayeeIfMissing: false }),
      );
    });

    it("skips when the source account is unknown", async () => {
      const result = await service.prepareCreateTransfer(userId, [
        {
          fromAccountName: "Ghost",
          toAccountName: "Savings",
          amount: 100,
          date: "2026-01-15",
        },
      ]);
      expect(result.okPreviews).toHaveLength(0);
      expect(result.skipped[0].reason).toContain("Unknown account: Ghost");
      expect(transfer.previewCreateTransfer).not.toHaveBeenCalled();
    });

    it("skips a row when previewCreateTransfer throws (best-effort catch)", async () => {
      transfer.previewCreateTransfer.mockRejectedValueOnce(
        new BadRequestException("Transfer amount must be positive"),
      );
      const result = await service.prepareCreateTransfer(userId, [
        {
          fromAccountName: "Checking",
          toAccountName: "Savings",
          amount: 100,
          date: "2026-01-15",
        },
      ]);
      expect(result.okPreviews).toHaveLength(0);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0].reason).toContain("must be positive");
      expect(result.previewRows[0].status).toBe("error");
    });
  });

  describe("prepareCreateTransferSingle", () => {
    it("resolves both accounts and returns a preview", async () => {
      const preview = await service.prepareCreateTransferSingle(userId, {
        fromAccountName: "Checking",
        toAccountName: "Savings",
        amount: 100,
        date: "2026-01-15",
      });
      expect(preview.fromAccountId).toBe("a1");
      expect(transfer.previewCreateTransfer).toHaveBeenCalled();
    });

    it("throws on an unknown source account", async () => {
      await expect(
        service.prepareCreateTransferSingle(userId, {
          fromAccountName: "Ghost",
          toAccountName: "Savings",
          amount: 100,
          date: "2026-01-15",
        }),
      ).rejects.toThrow(/Unknown account: Ghost/);
    });

    it("throws on an unknown destination account", async () => {
      await expect(
        service.prepareCreateTransferSingle(userId, {
          fromAccountName: "Checking",
          toAccountName: "Ghost",
          amount: 100,
          date: "2026-01-15",
        }),
      ).rejects.toThrow(/Unknown account: Ghost/);
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
      // createPayeeIfMissing defaults to true and is threaded to the preview.
      expect(transfer.previewUpdateTransfer).toHaveBeenCalledWith(
        userId,
        "t1",
        expect.objectContaining({ createPayeeIfMissing: true }),
        expect.anything(),
      );
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

    it("skips a row whose prepare throws a 4xx, surfacing the date when present", async () => {
      transactions.findOne.mockResolvedValueOnce({
        id: "t1",
        isTransfer: false,
      });
      transactions.previewUpdate.mockRejectedValueOnce(
        new BadRequestException("No fields to update"),
      );
      const result = await service.prepareUpdateBulk(userId, [
        { transactionId: "t1", date: "2026-03-03" },
      ]);
      expect(result.okRows).toHaveLength(0);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0].reason).toContain("No fields to update");
      expect(result.previewRows[0]).toMatchObject({
        status: "error",
        transactionDate: "2026-03-03",
      });
    });

    it("skips a row with a generic reason for a 5xx error and no date", async () => {
      transactions.findOne.mockResolvedValueOnce({
        id: "t1",
        isTransfer: false,
      });
      transactions.previewUpdate.mockRejectedValueOnce(
        new InternalServerErrorException("boom"),
      );
      const result = await service.prepareUpdateBulk(userId, [
        { transactionId: "t1", amount: -1 },
      ]);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0].reason).toBe("Could not be prepared.");
      expect(result.previewRows[0].transactionDate).toBeUndefined();
    });

    it("falls back to a generic reason for a non-Error rejection", async () => {
      transactions.findOne.mockResolvedValueOnce({
        id: "t1",
        isTransfer: false,
      });
      transactions.previewUpdate.mockRejectedValueOnce("string failure");
      const result = await service.prepareUpdateBulk(userId, [
        { transactionId: "t1", amount: -1 },
      ]);
      expect(result.skipped[0].reason).toBe("Could not be prepared.");
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
        payeeId: "payee-1",
        payeeName: "Custom label",
        payeeMatched: true,
        payeeWillBeCreated: false,
      });
      expect(row).toMatchObject({
        fromAccountId: "a1",
        toAccountId: "a2",
        amount: 100,
        toAmount: 100,
        payeeId: "payee-1",
        payeeName: "Custom label",
        createPayee: false,
      });
    });

    it("carries createPayee from payeeWillBeCreated for an unmatched label", () => {
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
        payeeId: null,
        payeeName: "New label",
        payeeMatched: false,
        payeeWillBeCreated: true,
      });
      expect(row.payeeId).toBeNull();
      expect(row.createPayee).toBe(true);
    });
  });
});
