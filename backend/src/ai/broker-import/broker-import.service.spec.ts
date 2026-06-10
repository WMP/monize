import { BadRequestException, NotFoundException } from "@nestjs/common";
import { BrokerImportService } from "./broker-import.service";
import { InvestmentAction } from "../../securities/entities/investment-transaction.entity";
import { AccountType } from "../../accounts/entities/account.entity";

describe("BrokerImportService", () => {
  let service: BrokerImportService;
  let aiService: Record<string, jest.Mock>;
  let securitiesService: Record<string, jest.Mock>;
  let investmentTransactionsService: Record<string, jest.Mock>;
  let accountsService: Record<string, jest.Mock>;

  const userId = "user-1";

  const completeWith = (orders: unknown, model = "test-model") => {
    aiService.complete.mockResolvedValue({
      content: JSON.stringify({ orders }),
      model,
      usage: { inputTokens: 1, outputTokens: 1 },
    });
  };

  beforeEach(() => {
    aiService = { complete: jest.fn() };
    securitiesService = {
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      create: jest.fn(),
    };
    investmentTransactionsService = { create: jest.fn() };
    accountsService = { findOne: jest.fn() };

    service = new BrokerImportService(
      aiService as any,
      securitiesService as any,
      investmentTransactionsService as any,
      accountsService as any,
    );
  });

  describe("parse", () => {
    it("maps broker fields and skips orders the model omitted (non-executed)", async () => {
      // The model has already dropped non-executed orders per the prompt, so it
      // returns only the executed one.
      completeWith([
        {
          securityName: "iShares MSCI ACWI UCITS ETF",
          exchange: "Xetra",
          side: "BUY",
          quantity: 3,
          price: 104.66,
          value: 313.98,
          commission: 0,
          currency: "eur",
          tradeDate: "2026-06-05",
        },
      ]);

      const result = await service.parse(userId, {
        html: "<table><tr><td>iShares MSCI ACWI UCITS ETF</td></tr></table>",
      });

      expect(result.model).toBe("test-model");
      expect(result.orders).toHaveLength(1);
      const order = result.orders[0];
      expect(order.rowId).toBe("order-0");
      expect(order.securityName).toBe("iShares MSCI ACWI UCITS ETF");
      expect(order.exchange).toBe("Xetra");
      expect(order.side).toBe("BUY");
      expect(order.quantity).toBe(3);
      expect(order.price).toBe(104.66);
      expect(order.value).toBe(313.98);
      expect(order.commission).toBe(0);
      expect(order.currency).toBe("EUR");
      expect(order.tradeDate).toBe("2026-06-05");
      expect(order.matchedSecurityId).toBeNull();
    });

    it("drops invalid orders (bad date, non-positive quantity, bad side) with warnings", async () => {
      completeWith([
        {
          securityName: "A",
          side: "BUY",
          quantity: 0,
          price: 1,
          tradeDate: "2026-06-05",
        },
        {
          securityName: "B",
          side: "HOLD",
          quantity: 1,
          price: 1,
          tradeDate: "2026-06-05",
        },
        {
          securityName: "C",
          side: "SELL",
          quantity: 1,
          price: 1,
          tradeDate: "05.06.2026",
        },
        {
          securityName: "",
          side: "BUY",
          quantity: 1,
          price: 1,
          tradeDate: "2026-06-05",
        },
      ]);

      const result = await service.parse(userId, {
        html: "<table><tr><td>order rows</td></tr></table>",
      });

      expect(result.orders).toHaveLength(0);
      expect(result.warnings.length).toBeGreaterThanOrEqual(4);
    });

    it("fuzzy-matches a parsed name to an existing security (case/diacritics-insensitive)", async () => {
      securitiesService.findAll.mockResolvedValue([
        { id: "sec-1", name: "iShares MSCI ACWI UCITS ETF" },
      ]);
      completeWith([
        {
          securityName: "ISHARES  msci acwi ucits etf",
          side: "SELL",
          quantity: 2,
          price: 50,
          commission: 1,
          currency: "EUR",
          tradeDate: "2026-06-06",
        },
      ]);

      const result = await service.parse(userId, {
        html: "<table><tr><td>order rows</td></tr></table>",
      });

      expect(result.orders[0].matchedSecurityId).toBe("sec-1");
      expect(result.orders[0].matchedSecurityName).toBe(
        "iShares MSCI ACWI UCITS ETF",
      );
      expect(result.orders[0].side).toBe("SELL");
    });

    it("returns an empty result when the HTML has no tabular content", async () => {
      const result = await service.parse(userId, { html: "   " });
      expect(result.orders).toHaveLength(0);
      expect(aiService.complete).not.toHaveBeenCalled();
    });

    it("returns no orders when the model output is not JSON", async () => {
      aiService.complete.mockResolvedValue({
        content: "I could not find any orders.",
        model: "m",
        usage: { inputTokens: 1, outputTokens: 1 },
      });
      const result = await service.parse(userId, { html: "<table>x</table>" });
      expect(result.orders).toHaveLength(0);
    });
  });

  describe("apply", () => {
    beforeEach(() => {
      accountsService.findOne.mockResolvedValue({
        id: "acct-1",
        accountType: AccountType.INVESTMENT,
      });
      investmentTransactionsService.create.mockResolvedValue({ id: "tx-1" });
    });

    it("rejects a non-investment account", async () => {
      accountsService.findOne.mockResolvedValue({
        id: "acct-1",
        accountType: AccountType.CHEQUING,
      });

      await expect(
        service.apply(userId, { accountId: "acct-1", orders: [] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("resolves an existing securityId (validates ownership) and creates a BUY", async () => {
      securitiesService.findOne.mockResolvedValue({ id: "sec-1" });

      const result = await service.apply(userId, {
        accountId: "acct-1",
        orders: [
          {
            securityId: "sec-1",
            side: "BUY",
            quantity: 3,
            price: 104.66,
            commission: 0,
            currency: "EUR",
            tradeDate: "2026-06-05",
          },
        ],
      });

      expect(securitiesService.findOne).toHaveBeenCalledWith(userId, "sec-1");
      expect(investmentTransactionsService.create).toHaveBeenCalledWith(
        userId,
        {
          accountId: "acct-1",
          action: InvestmentAction.BUY,
          transactionDate: "2026-06-05",
          securityId: "sec-1",
          quantity: 3,
          price: 104.66,
          commission: 0,
        },
      );
      expect(result).toEqual({
        created: 1,
        securitiesCreated: 0,
        skipped: 0,
        errors: [],
      });
    });

    it("creates a new security for newSecurity, deduped by symbol, and a SELL", async () => {
      securitiesService.create.mockResolvedValue({ id: "new-sec-1" });

      const newSecurity = {
        symbol: "ACWI",
        name: "iShares MSCI ACWI UCITS ETF",
        exchange: "Xetra",
        currency: "EUR",
        type: "ETF",
      };

      const result = await service.apply(userId, {
        accountId: "acct-1",
        orders: [
          {
            newSecurity,
            side: "SELL",
            quantity: 1,
            price: 100,
            commission: 0,
            currency: "EUR",
            tradeDate: "2026-06-05",
          },
          {
            newSecurity,
            side: "BUY",
            quantity: 2,
            price: 101,
            commission: 0,
            currency: "EUR",
            tradeDate: "2026-06-06",
          },
        ],
      });

      // Only one Security created despite two orders referencing the symbol.
      expect(securitiesService.create).toHaveBeenCalledTimes(1);
      expect(securitiesService.create).toHaveBeenCalledWith(userId, {
        symbol: "ACWI",
        name: "iShares MSCI ACWI UCITS ETF",
        exchange: "Xetra",
        currencyCode: "EUR",
        securityType: "ETF",
      });
      expect(investmentTransactionsService.create).toHaveBeenCalledTimes(2);
      expect(investmentTransactionsService.create.mock.calls[0][1].action).toBe(
        InvestmentAction.SELL,
      );
      expect(
        investmentTransactionsService.create.mock.calls[1][1].securityId,
      ).toBe("new-sec-1");
      expect(result).toEqual({
        created: 2,
        securitiesCreated: 1,
        skipped: 0,
        errors: [],
      });
    });

    it("counts a failed order as skipped and records the error without aborting the batch", async () => {
      securitiesService.findOne
        .mockResolvedValueOnce({ id: "sec-1" })
        .mockRejectedValueOnce(new NotFoundException("not found"));

      const result = await service.apply(userId, {
        accountId: "acct-1",
        orders: [
          {
            securityId: "sec-1",
            side: "BUY",
            quantity: 1,
            price: 1,
            commission: 0,
            currency: "EUR",
            tradeDate: "2026-06-05",
          },
          {
            securityId: "sec-2",
            side: "BUY",
            quantity: 1,
            price: 1,
            commission: 0,
            currency: "EUR",
            tradeDate: "2026-06-05",
          },
        ],
      });

      expect(result.created).toBe(1);
      expect(result.skipped).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("Order 2");
    });

    it("skips an order with neither securityId nor newSecurity", async () => {
      const result = await service.apply(userId, {
        accountId: "acct-1",
        orders: [
          {
            side: "BUY",
            quantity: 1,
            price: 1,
            commission: 0,
            currency: "EUR",
            tradeDate: "2026-06-05",
          } as any,
        ],
      });

      expect(result.created).toBe(0);
      expect(result.skipped).toBe(1);
      expect(investmentTransactionsService.create).not.toHaveBeenCalled();
    });
  });
});
