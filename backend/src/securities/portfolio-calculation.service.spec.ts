import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { PortfolioCalculationService } from "./portfolio-calculation.service";
import { Holding } from "./entities/holding.entity";
import { SecurityPrice } from "./entities/security-price.entity";
import {
  InvestmentTransaction,
  InvestmentAction,
} from "./entities/investment-transaction.entity";
import { Account } from "../accounts/entities/account.entity";
import { ExchangeRateService } from "../currencies/exchange-rate.service";

describe("PortfolioCalculationService.calculateRealizedGains", () => {
  let service: PortfolioCalculationService;
  let txRepo: { find: jest.Mock };

  const userId = "user-1";
  const accountId = "acct-1";
  const securityId = "sec-1";

  const makeTx = (overrides: Partial<InvestmentTransaction>) =>
    ({
      id: overrides.id ?? "tx",
      userId,
      accountId,
      securityId,
      action: InvestmentAction.BUY,
      transactionDate: "2024-01-01",
      quantity: 0,
      price: 0,
      commission: 0,
      totalAmount: 0,
      exchangeRate: 1,
      description: null,
      createdAt: new Date("2024-01-01"),
      updatedAt: new Date("2024-01-01"),
      account: {
        id: accountId,
        name: "TFSA",
        currencyCode: "CAD",
      } as Partial<Account>,
      security: {
        id: securityId,
        symbol: "ABC",
        name: "ABC Corp",
        currencyCode: "CAD",
      },
      ...overrides,
    }) as unknown as InvestmentTransaction;

  beforeEach(async () => {
    txRepo = { find: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PortfolioCalculationService,
        { provide: getRepositoryToken(Holding), useValue: {} },
        { provide: getRepositoryToken(SecurityPrice), useValue: {} },
        {
          provide: getRepositoryToken(InvestmentTransaction),
          useValue: txRepo,
        },
        { provide: getRepositoryToken(Account), useValue: {} },
        { provide: ExchangeRateService, useValue: {} },
      ],
    }).compile();
    service = module.get(PortfolioCalculationService);
  });

  it("uses average cost at sale time, not quantity * price, as the cost basis", async () => {
    // Buy 100 @ $50, then sell 100 @ $60. True realized gain = 100 * ($60 - $50) = $1000.
    // The old buggy formula would have produced cost basis = 100 * $60 = $6000 -> gain near zero.
    txRepo.find.mockResolvedValue([
      makeTx({
        id: "buy",
        action: InvestmentAction.BUY,
        transactionDate: "2024-01-10",
        quantity: 100,
        price: 50,
        totalAmount: 5000,
      }),
      makeTx({
        id: "sell",
        action: InvestmentAction.SELL,
        transactionDate: "2024-06-10",
        quantity: 100,
        price: 60,
        commission: 10,
        totalAmount: 5990, // 100 * 60 - 10 commission
      }),
    ]);

    const result = await service.calculateRealizedGains(userId);

    expect(result).toHaveLength(1);
    const sell = result[0];
    expect(sell.transactionId).toBe("sell");
    expect(sell.costBasis).toBe(5000);
    expect(sell.proceeds).toBe(5990); // net of commission
    expect(sell.realizedGain).toBe(990); // 5990 - 5000
  });

  it("averages cost across multiple BUYs before a partial SELL", async () => {
    // Buy 100 @ $50 -> costBasis 5000, qty 100
    // Buy 100 @ $70 -> costBasis 12000, qty 200, avg = 60
    // Sell 50 -> cost basis for sold = 50 * 60 = 3000
    txRepo.find.mockResolvedValue([
      makeTx({
        id: "b1",
        action: InvestmentAction.BUY,
        transactionDate: "2024-01-10",
        quantity: 100,
        price: 50,
        totalAmount: 5000,
      }),
      makeTx({
        id: "b2",
        action: InvestmentAction.BUY,
        transactionDate: "2024-03-10",
        quantity: 100,
        price: 70,
        totalAmount: 7000,
      }),
      makeTx({
        id: "s1",
        action: InvestmentAction.SELL,
        transactionDate: "2024-06-10",
        quantity: 50,
        price: 80,
        totalAmount: 4000,
      }),
    ]);

    const result = await service.calculateRealizedGains(userId);
    expect(result).toHaveLength(1);
    expect(result[0].costBasis).toBe(3000);
    expect(result[0].realizedGain).toBe(1000);
  });

  it("filters the output by startDate but still replays history before the range", async () => {
    txRepo.find.mockResolvedValue([
      makeTx({
        id: "b1",
        action: InvestmentAction.BUY,
        transactionDate: "2022-01-10", // well before the window
        quantity: 100,
        price: 20,
        totalAmount: 2000,
      }),
      makeTx({
        id: "s1",
        action: InvestmentAction.SELL,
        transactionDate: "2024-06-10",
        quantity: 50,
        price: 40,
        totalAmount: 2000,
      }),
    ]);

    const result = await service.calculateRealizedGains(userId, {
      startDate: "2024-01-01",
      endDate: "2024-12-31",
    });

    expect(result).toHaveLength(1);
    // Cost basis from the 2022 BUY at $20/share still applies.
    expect(result[0].costBasis).toBe(1000); // 50 * 20
    expect(result[0].realizedGain).toBe(1000); // 2000 - 1000
  });

  it("converts to account currency using the SELL transaction's exchange rate", async () => {
    // BUY 10 @ $100 USD with rate 1.3 -> costBasis 1300 CAD
    // SELL 10 @ $150 USD, totalAmount 1500 USD, rate 1.35 -> proceeds 2025 CAD
    txRepo.find.mockResolvedValue([
      makeTx({
        id: "b1",
        action: InvestmentAction.BUY,
        transactionDate: "2024-01-01",
        quantity: 10,
        price: 100,
        totalAmount: 1000,
        exchangeRate: 1.3,
      }),
      makeTx({
        id: "s1",
        action: InvestmentAction.SELL,
        transactionDate: "2024-06-01",
        quantity: 10,
        price: 150,
        totalAmount: 1500,
        exchangeRate: 1.35,
      }),
    ]);

    const result = await service.calculateRealizedGains(userId);
    expect(result[0].proceeds).toBe(2025); // 1500 * 1.35
    expect(result[0].costBasis).toBe(1300); // 10 * 100 * 1.3
    expect(result[0].realizedGain).toBe(725); // 2025 - 1300
  });

  it("returns zero realized gain when a SELL has no prior position", async () => {
    txRepo.find.mockResolvedValue([
      makeTx({
        id: "orphan-sell",
        action: InvestmentAction.SELL,
        transactionDate: "2024-06-01",
        quantity: 10,
        price: 50,
        totalAmount: 500,
      }),
    ]);

    const result = await service.calculateRealizedGains(userId);
    expect(result).toHaveLength(1);
    expect(result[0].costBasis).toBe(0);
    expect(result[0].proceeds).toBe(500);
    expect(result[0].realizedGain).toBe(500);
  });
});

describe("PortfolioCalculationService.calculateCapitalGainsByMonth", () => {
  let service: PortfolioCalculationService;
  let txRepo: { find: jest.Mock };
  let priceRepo: { query: jest.Mock };
  let exchangeRateService: { getLatestRate: jest.Mock };

  const userId = "user-1";
  const accountId = "acct-1";
  const securityId = "sec-1";

  const makeTx = (overrides: Partial<InvestmentTransaction>) =>
    ({
      id: overrides.id ?? "tx",
      userId,
      accountId,
      securityId,
      action: InvestmentAction.BUY,
      transactionDate: "2024-01-01",
      quantity: 0,
      price: 0,
      commission: 0,
      totalAmount: 0,
      exchangeRate: 1,
      description: null,
      createdAt: new Date("2024-01-01"),
      updatedAt: new Date("2024-01-01"),
      account: {
        id: accountId,
        name: "TFSA",
        currencyCode: "CAD",
      } as Partial<Account>,
      security: {
        id: securityId,
        symbol: "ABC",
        name: "ABC Corp",
        currencyCode: "CAD",
      },
      ...overrides,
    }) as unknown as InvestmentTransaction;

  // Build the rows that getAllPricesForSecurities returns from
  // security_prices, in the shape the SQL query produces.
  const priceRows = (
    rows: Array<{ date: string; price: number; securityId?: string }>,
  ) =>
    rows.map((r) => ({
      security_id: r.securityId ?? securityId,
      price_date: r.date,
      close_price: String(r.price),
    }));

  beforeEach(async () => {
    txRepo = { find: jest.fn() };
    priceRepo = { query: jest.fn().mockResolvedValue([]) };
    exchangeRateService = { getLatestRate: jest.fn().mockResolvedValue(null) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PortfolioCalculationService,
        { provide: getRepositoryToken(Holding), useValue: {} },
        { provide: getRepositoryToken(SecurityPrice), useValue: priceRepo },
        {
          provide: getRepositoryToken(InvestmentTransaction),
          useValue: txRepo,
        },
        { provide: getRepositoryToken(Account), useValue: {} },
        { provide: ExchangeRateService, useValue: exchangeRateService },
      ],
    }).compile();
    service = module.get(PortfolioCalculationService);
  });

  it("returns an empty array when there are no transactions", async () => {
    txRepo.find.mockResolvedValue([]);
    const result = await service.calculateCapitalGainsByMonth(userId, {
      startDate: "2024-01-01",
      endDate: "2024-03-31",
    });
    expect(result).toEqual([]);
  });

  it("captures unrealized mark-to-market change for a held position with no SELL", async () => {
    // Buy 100 shares at $50 in Dec; price climbs $50 -> $55 -> $60 across Jan/Feb.
    txRepo.find.mockResolvedValue([
      makeTx({
        id: "buy",
        action: InvestmentAction.BUY,
        transactionDate: "2023-12-15",
        quantity: 100,
        price: 50,
        totalAmount: 5000,
      }),
    ]);
    priceRepo.query.mockResolvedValue(
      priceRows([
        { date: "2023-12-31", price: 50 },
        { date: "2024-01-31", price: 55 },
        { date: "2024-02-29", price: 60 },
      ]),
    );

    const result = await service.calculateCapitalGainsByMonth(userId, {
      startDate: "2024-01-01",
      endDate: "2024-02-29",
    });

    expect(result).toHaveLength(2);
    const jan = result.find((r) => r.month === "2024-01")!;
    const feb = result.find((r) => r.month === "2024-02")!;
    // Jan: (55*100) - (50*100) = +500, all unrealized
    expect(jan.totalCapitalGain).toBe(500);
    expect(jan.realizedGain).toBe(0);
    expect(jan.unrealizedGain).toBe(500);
    // Feb: (60*100) - (55*100) = +500
    expect(feb.totalCapitalGain).toBe(500);
    expect(feb.unrealizedGain).toBe(500);
  });

  it("decomposes a SELL month into realized + unrealized capital gains", async () => {
    // Hold 100 shares at avg cost $50 since Dec.
    // Feb: price goes $50 -> $60, sell 40 shares mid-month at $60 (proceeds 2400),
    //      end-of-month price = $60. Remaining 60 shares.
    txRepo.find.mockResolvedValue([
      makeTx({
        id: "buy",
        action: InvestmentAction.BUY,
        transactionDate: "2023-12-15",
        quantity: 100,
        price: 50,
        totalAmount: 5000,
      }),
      makeTx({
        id: "sell",
        action: InvestmentAction.SELL,
        transactionDate: "2024-02-15",
        quantity: 40,
        price: 60,
        totalAmount: 2400,
      }),
    ]);
    priceRepo.query.mockResolvedValue(
      priceRows([
        { date: "2024-01-31", price: 50 },
        { date: "2024-02-29", price: 60 },
      ]),
    );

    const result = await service.calculateCapitalGainsByMonth(userId, {
      startDate: "2024-02-01",
      endDate: "2024-02-29",
    });

    expect(result).toHaveLength(1);
    const feb = result[0];
    // realized = 40 * (60 - 50) = 400
    expect(feb.realizedGain).toBe(400);
    // total = (endValue - startValue) + sells - buys
    //       = (60*60 - 50*100) + 2400 - 0 = 3600 - 5000 + 2400 = 1000
    expect(feb.totalCapitalGain).toBe(1000);
    // unrealized = total - realized = 600 (price gain $50 -> $60 on the 60
    // shares still held at end of month).
    expect(feb.unrealizedGain).toBe(600);
  });

  it("emits negative capital gains when prices fall", async () => {
    txRepo.find.mockResolvedValue([
      makeTx({
        id: "buy",
        action: InvestmentAction.BUY,
        transactionDate: "2023-12-15",
        quantity: 100,
        price: 50,
        totalAmount: 5000,
      }),
    ]);
    priceRepo.query.mockResolvedValue(
      priceRows([
        { date: "2023-12-31", price: 50 },
        { date: "2024-01-31", price: 42 },
      ]),
    );

    const result = await service.calculateCapitalGainsByMonth(userId, {
      startDate: "2024-01-01",
      endDate: "2024-01-31",
    });

    expect(result).toHaveLength(1);
    expect(result[0].totalCapitalGain).toBe(-800); // (42-50) * 100
    expect(result[0].unrealizedGain).toBe(-800);
  });

  it("seeds cost basis from history that predates the requested window", async () => {
    txRepo.find.mockResolvedValue([
      makeTx({
        id: "old-buy",
        action: InvestmentAction.BUY,
        transactionDate: "2022-06-01",
        quantity: 100,
        price: 20,
        totalAmount: 2000,
      }),
      makeTx({
        id: "sell",
        action: InvestmentAction.SELL,
        transactionDate: "2024-03-15",
        quantity: 100,
        price: 30,
        totalAmount: 3000,
      }),
    ]);
    priceRepo.query.mockResolvedValue(
      priceRows([
        { date: "2024-02-29", price: 28 },
        { date: "2024-03-31", price: 30 },
      ]),
    );

    const result = await service.calculateCapitalGainsByMonth(userId, {
      startDate: "2024-03-01",
      endDate: "2024-03-31",
    });

    expect(result).toHaveLength(1);
    const mar = result[0];
    // Realized: 100 * (30 - 20) = 1000
    expect(mar.realizedGain).toBe(1000);
    // Total: (0 - 28*100) + 3000 - 0 = 200
    // (start value at Feb-29 close = $2800; end value = 0; cash from sale = $3000)
    expect(mar.totalCapitalGain).toBe(200);
    // Unrealized: 200 - 1000 = -800 (the price-driven unrealized gain of $800
    // from the original $20 cost has been crystallized into realized).
    expect(mar.unrealizedGain).toBe(-800);
  });

  it("drops months with no holding and no activity", async () => {
    txRepo.find.mockResolvedValue([
      makeTx({
        id: "buy",
        action: InvestmentAction.BUY,
        transactionDate: "2024-02-10",
        quantity: 10,
        price: 100,
        totalAmount: 1000,
      }),
      makeTx({
        id: "sell",
        action: InvestmentAction.SELL,
        transactionDate: "2024-02-20",
        quantity: 10,
        price: 100,
        totalAmount: 1000,
      }),
    ]);
    priceRepo.query.mockResolvedValue(
      priceRows([{ date: "2024-02-29", price: 100 }]),
    );

    const result = await service.calculateCapitalGainsByMonth(userId, {
      startDate: "2024-01-01",
      endDate: "2024-04-30",
    });

    // Jan: no holding, no activity -> dropped.
    // Feb: BUY+SELL in the same month -> kept.
    // Mar/Apr: no holding, no activity -> dropped.
    expect(result.map((r) => r.month)).toEqual(["2024-02"]);
  });

  it("returns empty when startDate is after endDate", async () => {
    txRepo.find.mockResolvedValue([]);
    const result = await service.calculateCapitalGainsByMonth(userId, {
      startDate: "2024-12-01",
      endDate: "2024-01-01",
    });
    expect(result).toEqual([]);
  });
});

describe("PortfolioCalculationService.calculateCapitalGainsByDay", () => {
  let service: PortfolioCalculationService;
  let txRepo: { find: jest.Mock };
  let priceRepo: { query: jest.Mock };
  let exchangeRateService: { getLatestRate: jest.Mock };

  const userId = "user-1";
  const accountId = "acct-1";
  const securityId = "sec-1";

  const makeTx = (overrides: Partial<InvestmentTransaction>) =>
    ({
      id: overrides.id ?? "tx",
      userId,
      accountId,
      securityId,
      action: InvestmentAction.BUY,
      transactionDate: "2024-01-01",
      quantity: 0,
      price: 0,
      commission: 0,
      totalAmount: 0,
      exchangeRate: 1,
      description: null,
      createdAt: new Date("2024-01-01"),
      updatedAt: new Date("2024-01-01"),
      account: {
        id: accountId,
        name: "TFSA",
        currencyCode: "CAD",
      } as Partial<Account>,
      security: {
        id: securityId,
        symbol: "ABC",
        name: "ABC Corp",
        currencyCode: "CAD",
      },
      ...overrides,
    }) as unknown as InvestmentTransaction;

  const priceRows = (
    rows: Array<{ date: string; price: number; securityId?: string }>,
  ) =>
    rows.map((r) => ({
      security_id: r.securityId ?? securityId,
      price_date: r.date,
      close_price: String(r.price),
    }));

  beforeEach(async () => {
    txRepo = { find: jest.fn() };
    priceRepo = { query: jest.fn().mockResolvedValue([]) };
    exchangeRateService = { getLatestRate: jest.fn().mockResolvedValue(null) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PortfolioCalculationService,
        { provide: getRepositoryToken(Holding), useValue: {} },
        { provide: getRepositoryToken(SecurityPrice), useValue: priceRepo },
        {
          provide: getRepositoryToken(InvestmentTransaction),
          useValue: txRepo,
        },
        { provide: getRepositoryToken(Account), useValue: {} },
        { provide: ExchangeRateService, useValue: exchangeRateService },
      ],
    }).compile();
    service = module.get(PortfolioCalculationService);
  });

  it("returns an empty array when there are no transactions", async () => {
    txRepo.find.mockResolvedValue([]);
    const result = await service.calculateCapitalGainsByDay(userId, {
      startDate: "2024-01-01",
      endDate: "2024-01-03",
    });
    expect(result).toEqual([]);
  });

  it("uses YYYY-MM-DD keys in the month field", async () => {
    txRepo.find.mockResolvedValue([
      makeTx({
        id: "buy",
        action: InvestmentAction.BUY,
        transactionDate: "2024-01-01",
        quantity: 10,
        price: 100,
        totalAmount: 1000,
      }),
    ]);
    priceRepo.query.mockResolvedValue(
      priceRows([
        { date: "2023-12-31", price: 100 },
        { date: "2024-01-01", price: 105 },
      ]),
    );

    const result = await service.calculateCapitalGainsByDay(userId, {
      startDate: "2024-01-01",
      endDate: "2024-01-01",
    });

    expect(result).toHaveLength(1);
    expect(result[0].month).toBe("2024-01-01");
  });

  it("captures unrealized mark-to-market change for a held position across two days", async () => {
    // Buy 100 shares on Dec 31; price goes $50 -> $55 on Jan 1, $55 -> $60 on Jan 2.
    txRepo.find.mockResolvedValue([
      makeTx({
        id: "buy",
        action: InvestmentAction.BUY,
        transactionDate: "2023-12-31",
        quantity: 100,
        price: 50,
        totalAmount: 5000,
      }),
    ]);
    priceRepo.query.mockResolvedValue(
      priceRows([
        { date: "2023-12-30", price: 50 },
        { date: "2023-12-31", price: 50 },
        { date: "2024-01-01", price: 55 },
        { date: "2024-01-02", price: 60 },
      ]),
    );

    const result = await service.calculateCapitalGainsByDay(userId, {
      startDate: "2024-01-01",
      endDate: "2024-01-02",
    });

    expect(result).toHaveLength(2);
    const jan1 = result.find((r) => r.month === "2024-01-01")!;
    const jan2 = result.find((r) => r.month === "2024-01-02")!;
    // Jan 1: startValue = 50*100=5000, endValue = 55*100=5500, gain = +500
    expect(jan1.totalCapitalGain).toBe(500);
    expect(jan1.unrealizedGain).toBe(500);
    expect(jan1.realizedGain).toBe(0);
    // Jan 2: startValue = 55*100=5500, endValue = 60*100=6000, gain = +500
    expect(jan2.totalCapitalGain).toBe(500);
    expect(jan2.unrealizedGain).toBe(500);
  });

  it("decomposes a SELL day into realized + unrealized capital gains", async () => {
    // Hold 100 shares at avg cost $50. On Jan 5, price is $60 and sell 40 shares.
    txRepo.find.mockResolvedValue([
      makeTx({
        id: "buy",
        action: InvestmentAction.BUY,
        transactionDate: "2024-01-01",
        quantity: 100,
        price: 50,
        totalAmount: 5000,
      }),
      makeTx({
        id: "sell",
        action: InvestmentAction.SELL,
        transactionDate: "2024-01-05",
        quantity: 40,
        price: 60,
        totalAmount: 2400,
      }),
    ]);
    priceRepo.query.mockResolvedValue(
      priceRows([
        { date: "2024-01-04", price: 50 },
        { date: "2024-01-05", price: 60 },
      ]),
    );

    const result = await service.calculateCapitalGainsByDay(userId, {
      startDate: "2024-01-05",
      endDate: "2024-01-05",
    });

    expect(result).toHaveLength(1);
    const day = result[0];
    // realized = 40 * (60 - 50) = 400
    expect(day.realizedGain).toBe(400);
    // total = (endValue - startValue) + sells - buys
    //       = (60*60 - 50*100) + 2400 - 0 = 3600 - 5000 + 2400 = 1000
    expect(day.totalCapitalGain).toBe(1000);
    // unrealized = 1000 - 400 = 600
    expect(day.unrealizedGain).toBe(600);
  });

  it("drops days with no holding and no activity", async () => {
    // Buy on Jan 3, sell on Jan 3 (same day). Jan 1, 2, 4 have no holding or activity.
    txRepo.find.mockResolvedValue([
      makeTx({
        id: "buy",
        action: InvestmentAction.BUY,
        transactionDate: "2024-01-03",
        quantity: 10,
        price: 100,
        totalAmount: 1000,
      }),
      makeTx({
        id: "sell",
        action: InvestmentAction.SELL,
        transactionDate: "2024-01-03",
        quantity: 10,
        price: 100,
        totalAmount: 1000,
      }),
    ]);
    priceRepo.query.mockResolvedValue(
      priceRows([{ date: "2024-01-03", price: 100 }]),
    );

    const result = await service.calculateCapitalGainsByDay(userId, {
      startDate: "2024-01-01",
      endDate: "2024-01-05",
    });

    expect(result.map((r) => r.month)).toEqual(["2024-01-03"]);
  });

  it("returns empty when startDate is after endDate", async () => {
    txRepo.find.mockResolvedValue([]);
    const result = await service.calculateCapitalGainsByDay(userId, {
      startDate: "2024-12-01",
      endDate: "2024-01-01",
    });
    expect(result).toEqual([]);
  });
});
