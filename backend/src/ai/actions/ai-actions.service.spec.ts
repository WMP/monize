import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AiActionsService } from "./ai-actions.service";
import { AiActionSigningService } from "./ai-action-signing.service";
import { AiWriteLimiter, AI_DAILY_WRITE_LIMIT } from "./ai-write-limiter";
import {
  CategorizeTransactionDescriptor,
  CreatePayeeDescriptor,
  CreateSecurityDescriptor,
  CreateTransactionDescriptor,
  CreateInvestmentTransactionDescriptor,
  CreateTransactionsDescriptor,
  CreateInvestmentTransactionsDescriptor,
  TransactionRowDescriptor,
  InvestmentTransactionRowDescriptor,
  AiActionDescriptor,
} from "./ai-action.types";
import { InvestmentAction } from "../../securities/entities/investment-transaction.entity";
import { ConfirmAiActionDto } from "./dto/confirm-ai-action.dto";

const USER = "user-1";
const ACC = "11111111-1111-4111-8111-111111111111";
const CAT = "22222222-2222-4222-8222-222222222222";
const TX = "33333333-3333-4333-8333-333333333333";
const PAYEE = "44444444-4444-4444-8444-444444444444";
const SEC = "55555555-5555-4555-8555-555555555555";

describe("AiActionsService", () => {
  let service: AiActionsService;
  let signing: AiActionSigningService;
  let limiter: AiWriteLimiter;
  let transactions: Record<string, jest.Mock>;
  let payees: Record<string, jest.Mock>;
  let investments: Record<string, jest.Mock>;
  let securities: Record<string, jest.Mock>;

  beforeEach(() => {
    const config = {
      get: jest
        .fn()
        .mockReturnValue("test-secret-key-at-least-32-chars-long!!"),
    } as unknown as ConfigService;
    signing = new AiActionSigningService(config);
    limiter = new AiWriteLimiter();
    transactions = {
      create: jest.fn().mockResolvedValue({ id: "tx-new" }),
      update: jest.fn().mockResolvedValue({ id: TX }),
      createBulk: jest.fn(),
    };
    payees = {
      create: jest.fn().mockResolvedValue({ id: "payee-new" }),
    };
    investments = {
      create: jest.fn().mockResolvedValue({ id: "inv-tx-new" }),
      createBulk: jest.fn(),
    };
    securities = {
      create: jest.fn().mockResolvedValue({ id: "sec-new" }),
    };
    service = new AiActionsService(
      transactions as never,
      payees as never,
      investments as never,
      securities as never,
      signing,
      limiter,
    );
  });

  function createTxDescriptor(
    overrides: Partial<CreateTransactionDescriptor> = {},
  ): CreateTransactionDescriptor {
    return {
      type: "create_transaction",
      userId: USER,
      actionId: "act-create",
      expiresAt: Date.now() + 60_000,
      accountId: ACC,
      amount: -12.5,
      transactionDate: "2026-01-15",
      payeeId: null,
      payeeName: "Starbucks",
      createPayee: false,
      categoryId: CAT,
      description: null,
      currencyCode: "USD",
      ...overrides,
    };
  }

  function createInvestmentDescriptor(
    overrides: Partial<CreateInvestmentTransactionDescriptor> = {},
  ): CreateInvestmentTransactionDescriptor {
    return {
      type: "create_investment_transaction",
      userId: USER,
      actionId: "act-create-inv",
      expiresAt: Date.now() + 60_000,
      accountId: ACC,
      action: InvestmentAction.BUY,
      transactionDate: "2026-01-15",
      securityId: SEC,
      fundingAccountId: null,
      quantity: 10,
      price: 150,
      commission: 4.99,
      exchangeRate: 1,
      description: null,
      ...overrides,
    };
  }

  function dtoFor(descriptor: AiActionDescriptor): ConfirmAiActionDto {
    return {
      actionId: descriptor.actionId,
      signature: signing.sign(descriptor),
      descriptor: descriptor as unknown as Record<string, unknown>,
    };
  }

  it("creates a transaction on a valid confirmation", async () => {
    const descriptor = createTxDescriptor();
    const result = await service.confirm(USER, dtoFor(descriptor));

    expect(transactions.create).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({
        accountId: ACC,
        amount: -12.5,
        currencyCode: "USD",
        transactionDate: "2026-01-15",
      }),
      { createPayeeIfMissing: false },
    );
    expect(result).toEqual({ type: "create_transaction", id: "tx-new" });
  });

  it("links the resolved payee when the descriptor carries a payeeId", async () => {
    const descriptor = createTxDescriptor({ payeeId: PAYEE });
    await service.confirm(USER, dtoFor(descriptor));

    expect(transactions.create).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ payeeId: PAYEE }),
      { createPayeeIfMissing: false },
    );
  });

  it("creates a payee for an unmatched name when the descriptor sets createPayee", async () => {
    const descriptor = createTxDescriptor({
      payeeId: null,
      payeeName: "Brand New Store",
      createPayee: true,
    });
    await service.confirm(USER, dtoFor(descriptor));

    expect(transactions.create).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ payeeName: "Brand New Store" }),
      { createPayeeIfMissing: true },
    );
  });

  it("categorizes a transaction on a valid confirmation", async () => {
    const descriptor: CategorizeTransactionDescriptor = {
      type: "categorize_transaction",
      userId: USER,
      actionId: "act-cat",
      expiresAt: Date.now() + 60_000,
      transactionId: TX,
      categoryId: CAT,
    };
    const result = await service.confirm(USER, dtoFor(descriptor));
    expect(transactions.update).toHaveBeenCalledWith(USER, TX, {
      categoryId: CAT,
    });
    expect(result).toEqual({ type: "categorize_transaction", id: TX });
  });

  it("creates a payee on a valid confirmation", async () => {
    const descriptor: CreatePayeeDescriptor = {
      type: "create_payee",
      userId: USER,
      actionId: "act-payee",
      expiresAt: Date.now() + 60_000,
      name: "Acme",
      defaultCategoryId: CAT,
    };
    const result = await service.confirm(USER, dtoFor(descriptor));
    expect(payees.create).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ name: "Acme", defaultCategoryId: CAT }),
    );
    expect(result).toEqual({ type: "create_payee", id: "payee-new" });
  });

  it("creates a security on a valid confirmation", async () => {
    const descriptor: CreateSecurityDescriptor = {
      type: "create_security",
      userId: USER,
      actionId: "act-sec",
      expiresAt: Date.now() + 60_000,
      symbol: "AAPL",
      name: "Apple Inc.",
      securityType: "STOCK",
      exchange: "NASDAQ",
      currencyCode: "USD",
      isFavourite: false,
      quoteProvider: "yahoo",
      msnInstrumentId: null,
    };
    const result = await service.confirm(USER, dtoFor(descriptor));
    expect(securities.create).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({
        symbol: "AAPL",
        name: "Apple Inc.",
        securityType: "STOCK",
        exchange: "NASDAQ",
        currencyCode: "USD",
      }),
    );
    expect(result).toEqual({ type: "create_security", id: "sec-new" });
  });

  it("creates an investment transaction on a valid confirmation", async () => {
    const descriptor = createInvestmentDescriptor();
    const result = await service.confirm(USER, dtoFor(descriptor));
    expect(investments.create).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({
        accountId: ACC,
        action: InvestmentAction.BUY,
        transactionDate: "2026-01-15",
        securityId: SEC,
        quantity: 10,
        price: 150,
        commission: 4.99,
        exchangeRate: 1,
      }),
    );
    expect(result).toEqual({
      type: "create_investment_transaction",
      id: "inv-tx-new",
    });
  });

  it("omits security and funding ids for a cash-only investment action", async () => {
    const descriptor = createInvestmentDescriptor({
      action: InvestmentAction.INTEREST,
      securityId: null,
      quantity: null,
      price: 25,
      commission: 0,
    });
    await service.confirm(USER, dtoFor(descriptor));
    const dto = investments.create.mock.calls[0][1];
    expect(dto.securityId).toBeUndefined();
    expect(dto.fundingAccountId).toBeUndefined();
    expect(dto.action).toBe(InvestmentAction.INTEREST);
  });

  it("rejects a bad signature", async () => {
    const descriptor = createTxDescriptor();
    const dto = dtoFor(descriptor);
    dto.signature = "deadbeef";
    await expect(service.confirm(USER, dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(transactions.create).not.toHaveBeenCalled();
  });

  it("rejects a tampered descriptor (signature no longer matches)", async () => {
    const descriptor = createTxDescriptor();
    const dto = dtoFor(descriptor);
    (dto.descriptor as Record<string, unknown>).amount = -99999;
    await expect(service.confirm(USER, dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(transactions.create).not.toHaveBeenCalled();
  });

  it("rejects an expired descriptor", async () => {
    const descriptor = createTxDescriptor({ expiresAt: Date.now() - 1000 });
    await expect(
      service.confirm(USER, dtoFor(descriptor)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects a descriptor minted for another user", async () => {
    // Signed for a different user; the caller is USER.
    const descriptor = createTxDescriptor({ userId: "other-user" });
    await expect(
      service.confirm(USER, dtoFor(descriptor)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transactions.create).not.toHaveBeenCalled();
  });

  it("rejects a replayed action id", async () => {
    const descriptor = createTxDescriptor();
    await service.confirm(USER, dtoFor(descriptor));
    await expect(
      service.confirm(USER, dtoFor(descriptor)),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transactions.create).toHaveBeenCalledTimes(1);
  });

  it("allows retry after a failed write (action id released)", async () => {
    const descriptor = createTxDescriptor();
    transactions.create.mockRejectedValueOnce(new Error("db down"));
    await expect(service.confirm(USER, dtoFor(descriptor))).rejects.toThrow();
    // Same descriptor can be retried because the id was released on failure.
    const result = await service.confirm(USER, dtoFor(descriptor));
    expect(result).toEqual({ type: "create_transaction", id: "tx-new" });
  });

  it("rejects when the daily write limit is reached", async () => {
    for (let i = 0; i < AI_DAILY_WRITE_LIMIT; i++) {
      limiter.record(USER, "create_transaction");
    }
    await expect(
      service.confirm(USER, dtoFor(createTxDescriptor())),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transactions.create).not.toHaveBeenCalled();
  });

  it("rejects when descriptor fields fail DTO validation", async () => {
    const descriptor = createTxDescriptor({ currencyCode: "not-a-currency" });
    await expect(
      service.confirm(USER, dtoFor(descriptor)),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transactions.create).not.toHaveBeenCalled();
  });

  describe("bulk create_transactions", () => {
    function bulkTxDescriptor(
      overrides: Partial<CreateTransactionsDescriptor> = {},
    ): CreateTransactionsDescriptor {
      const row = (amount: number): TransactionRowDescriptor => ({
        accountId: ACC,
        amount,
        transactionDate: "2026-01-15",
        payeeId: null,
        payeeName: "Store",
        createPayee: false,
        categoryId: CAT,
        description: null,
        currencyCode: "USD",
      });
      return {
        type: "create_transactions",
        userId: USER,
        actionId: "act-bulk",
        expiresAt: Date.now() + 60_000,
        rows: [row(-10), row(-20)],
        ...overrides,
      };
    }

    it("creates all valid rows best-effort and returns ids/count/skipped", async () => {
      transactions.createBulk.mockResolvedValue({
        created: [{ id: "tx-1" }, { id: "tx-2" }],
        skipped: [],
      });
      const descriptor = bulkTxDescriptor();
      const result = await service.confirm(USER, dtoFor(descriptor));

      expect(transactions.createBulk).toHaveBeenCalledTimes(1);
      const passedRows = transactions.createBulk.mock.calls[0][1];
      expect(passedRows).toHaveLength(2);
      expect(passedRows[0]).toMatchObject({ createPayeeIfMissing: false });
      expect(result).toEqual({
        type: "create_transactions",
        id: "tx-1",
        ids: ["tx-1", "tx-2"],
        count: 2,
        skipped: [],
      });
    });

    it("reports rows the service skipped, remapped to original indices", async () => {
      // Row 1 (index 1) fails inside createBulk.
      transactions.createBulk.mockResolvedValue({
        created: [{ id: "tx-1" }],
        skipped: [{ index: 1, reason: "Insufficient funds" }],
      });
      const result = await service.confirm(USER, dtoFor(bulkTxDescriptor()));
      expect(result.count).toBe(1);
      expect(result.skipped).toEqual([
        { index: 1, reason: "Insufficient funds" },
      ]);
    });

    it("skips a row that fails re-validation without aborting the batch", async () => {
      transactions.createBulk.mockResolvedValue({
        created: [{ id: "tx-1" }],
        skipped: [],
      });
      // Second row has an invalid currency -> dropped before createBulk.
      const descriptor = bulkTxDescriptor();
      descriptor.rows[1] = {
        ...descriptor.rows[1],
        currencyCode: "not-a-currency",
      };
      const result = await service.confirm(USER, dtoFor(descriptor));

      // Only the valid row reaches the service.
      expect(transactions.createBulk.mock.calls[0][1]).toHaveLength(1);
      expect(result.count).toBe(1);
      expect(result.skipped?.some((s) => s.index === 1)).toBe(true);
    });

    it("records one write per created row against the daily cap", async () => {
      transactions.createBulk.mockResolvedValue({
        created: [{ id: "tx-1" }, { id: "tx-2" }],
        skipped: [],
      });
      await service.confirm(USER, dtoFor(bulkTxDescriptor()));
      expect(limiter.checkLimit(USER).currentCount).toBe(2);
    });

    it("rejects the batch when it would exceed the daily cap", async () => {
      for (let i = 0; i < AI_DAILY_WRITE_LIMIT - 1; i++) {
        limiter.record(USER, "create_transaction");
      }
      // Two rows + 49 existing = 51 > 50 cap.
      await expect(
        service.confirm(USER, dtoFor(bulkTxDescriptor())),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(transactions.createBulk).not.toHaveBeenCalled();
    });

    it("cannot be replayed after a best-effort confirm", async () => {
      transactions.createBulk.mockResolvedValue({
        created: [{ id: "tx-1" }, { id: "tx-2" }],
        skipped: [],
      });
      const descriptor = bulkTxDescriptor();
      await service.confirm(USER, dtoFor(descriptor));
      await expect(
        service.confirm(USER, dtoFor(descriptor)),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(transactions.createBulk).toHaveBeenCalledTimes(1);
    });
  });

  describe("bulk create_investment_transactions", () => {
    it("creates all valid rows and returns ids/count", async () => {
      investments.createBulk.mockResolvedValue({
        created: [{ id: "inv-1" }, { id: "inv-2" }],
        skipped: [],
      });
      const row = (): InvestmentTransactionRowDescriptor => ({
        accountId: ACC,
        action: InvestmentAction.BUY,
        transactionDate: "2026-01-15",
        securityId: SEC,
        fundingAccountId: null,
        quantity: 10,
        price: 150,
        commission: 0,
        exchangeRate: 1,
        description: null,
      });
      const descriptor: CreateInvestmentTransactionsDescriptor = {
        type: "create_investment_transactions",
        userId: USER,
        actionId: "act-bulk-inv",
        expiresAt: Date.now() + 60_000,
        rows: [row(), row()],
      };
      const result = await service.confirm(USER, dtoFor(descriptor));
      expect(investments.createBulk).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        type: "create_investment_transactions",
        id: "inv-1",
        ids: ["inv-1", "inv-2"],
        count: 2,
      });
    });
  });
});
