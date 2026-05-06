import { getTradingDateFromQuote } from "./trading-date.util";

describe("getTradingDateFromQuote", () => {
  it("returns UTC-midnight from regularMarketTime when present", () => {
    // 2024-06-15 12:00:00 UTC
    const ts = Math.floor(Date.parse("2024-06-15T12:00:00Z") / 1000);
    const d = getTradingDateFromQuote({
      symbol: "X",
      regularMarketTime: ts,
      provider: "yahoo",
    });
    expect(d.toISOString()).toBe("2024-06-15T00:00:00.000Z");
  });

  it("rolls back from Sunday to Friday when no timestamp", () => {
    // Force 'today' to Sunday by mocking Date
    const sunday = new Date(Date.UTC(2024, 5, 16)); // 2024-06-16 = Sunday
    jest.spyOn(global, "Date").mockImplementation(((..._args: unknown[]) => {
      if (_args.length === 0) return sunday;
      // @ts-expect-error testing
      return new (Date as never)(..._args);
    }) as never);
    try {
      const d = getTradingDateFromQuote({ symbol: "X", provider: "yahoo" });
      expect(d.getUTCDay()).toBe(5); // Friday
    } finally {
      jest.restoreAllMocks();
    }
  });

  it("rolls back from Saturday to Friday when no timestamp", () => {
    const sat = new Date(Date.UTC(2024, 5, 15)); // 2024-06-15 = Saturday
    jest.spyOn(global, "Date").mockImplementation(((..._args: unknown[]) => {
      if (_args.length === 0) return sat;
      // @ts-expect-error testing
      return new (Date as never)(..._args);
    }) as never);
    try {
      const d = getTradingDateFromQuote({ symbol: "X", provider: "yahoo" });
      expect(d.getUTCDay()).toBe(5); // Friday
    } finally {
      jest.restoreAllMocks();
    }
  });

  it("returns same UTC midnight on weekday when no timestamp", () => {
    const wed = new Date(Date.UTC(2024, 5, 12)); // Wednesday
    jest.spyOn(global, "Date").mockImplementation(((..._args: unknown[]) => {
      if (_args.length === 0) return wed;
      // @ts-expect-error testing
      return new (Date as never)(..._args);
    }) as never);
    try {
      const d = getTradingDateFromQuote({ symbol: "X", provider: "yahoo" });
      expect(d.getUTCDay()).toBe(3); // Wednesday
    } finally {
      jest.restoreAllMocks();
    }
  });
});
