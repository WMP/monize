import { BadRequestException } from "@nestjs/common";
import {
  resolveTransferConversion,
  resolveTransferUpdateConversion,
} from "./transfer-conversion.util";

describe("resolveTransferConversion", () => {
  describe("same currency", () => {
    it("is 1:1 with no conversion supplied", () => {
      expect(
        resolveTransferConversion({
          amount: 100,
          fromCurrencyCode: "USD",
          toCurrencyCode: "USD",
        }),
      ).toEqual({ amount: 100, toAmount: 100, exchangeRate: 1 });
    });

    it("accepts a restated rate of exactly 1", () => {
      expect(
        resolveTransferConversion({
          amount: 100,
          fromCurrencyCode: "USD",
          toCurrencyCode: "usd",
          exchangeRate: 1,
          toAmount: 100,
        }),
      ).toEqual({ amount: 100, toAmount: 100, exchangeRate: 1 });
    });

    it("refuses a rate other than 1", () => {
      expect(() =>
        resolveTransferConversion({
          amount: 100,
          fromCurrencyCode: "USD",
          toCurrencyCode: "USD",
          exchangeRate: 1.3,
        }),
      ).toThrow(BadRequestException);
    });

    it("refuses a received amount other than the sent amount", () => {
      expect(() =>
        resolveTransferConversion({
          amount: 100,
          fromCurrencyCode: "USD",
          toCurrencyCode: "USD",
          toAmount: 130,
        }),
      ).toThrow(/must receive the amount it sends \(100\), not 130/);
    });

    it("rounds the amount to storage precision", () => {
      expect(
        resolveTransferConversion({
          amount: 100.123456,
          fromCurrencyCode: "USD",
          toCurrencyCode: "USD",
        }),
      ).toEqual({ amount: 100.1235, toAmount: 100.1235, exchangeRate: 1 });
    });
  });

  describe("different currencies", () => {
    // The P6-002 reproduction, at the unit that decides it.
    it("refuses a transfer that carries no conversion", () => {
      expect(() =>
        resolveTransferConversion({
          amount: 100,
          fromCurrencyCode: "USD",
          toCurrencyCode: "EUR",
        }),
      ).toThrow(/needs an exchange rate or the amount received/);
    });

    it("derives the received amount from a rate", () => {
      expect(
        resolveTransferConversion({
          amount: 100,
          fromCurrencyCode: "USD",
          toCurrencyCode: "EUR",
          exchangeRate: 0.9,
        }),
      ).toEqual({ amount: 100, toAmount: 90, exchangeRate: 0.9 });
    });

    it("derives the rate from a received amount", () => {
      expect(
        resolveTransferConversion({
          amount: 100,
          fromCurrencyCode: "USD",
          toCurrencyCode: "EUR",
          toAmount: 90,
        }),
      ).toEqual({ amount: 100, toAmount: 90, exchangeRate: 0.9 });
    });

    // A rate is NUMERIC(20,10), not money. Deriving it from the two amounts must
    // not round it to 4 dp: roundMoney(90.5 / 137.25) is 0.6594, which converts
    // back to 90.4772 -- 2 cents adrift on a three-figure transfer, and far more
    // on a real one.
    it("keeps a derived rate at rate precision, not money precision", () => {
      const { exchangeRate } = resolveTransferConversion({
        amount: 137.25,
        fromCurrencyCode: "USD",
        toCurrencyCode: "EUR",
        toAmount: 90.5,
      });
      expect(exchangeRate).toBeCloseTo(0.6593806922, 10);
      expect(exchangeRate).not.toBe(0.6594);
    });

    it("accepts a rate and a received amount that agree", () => {
      expect(
        resolveTransferConversion({
          amount: 100,
          fromCurrencyCode: "USD",
          toCurrencyCode: "EUR",
          exchangeRate: 0.9,
          toAmount: 90,
        }),
      ).toEqual({ amount: 100, toAmount: 90, exchangeRate: 0.9 });
    });

    it("refuses a rate and a received amount that disagree", () => {
      expect(() =>
        resolveTransferConversion({
          amount: 100,
          fromCurrencyCode: "USD",
          toCurrencyCode: "EUR",
          exchangeRate: 0.9,
          toAmount: 95,
        }),
      ).toThrow(/converts 100 USD to 90 EUR, not 95/);
    });

    it("tolerates a disagreement below storage precision", () => {
      // 3 x 0.33333333 = 0.99999999, which is 1.0000 at 4 dp -- the same stored
      // number as the client's 1.0000, so this is not a contradiction.
      expect(
        resolveTransferConversion({
          amount: 3,
          fromCurrencyCode: "USD",
          toCurrencyCode: "EUR",
          exchangeRate: 0.33333333,
          toAmount: 1,
        }).toAmount,
      ).toBe(1);
    });

    it.each([0, -0.5])("refuses a rate of %p", (rate) => {
      expect(() =>
        resolveTransferConversion({
          amount: 100,
          fromCurrencyCode: "USD",
          toCurrencyCode: "EUR",
          exchangeRate: rate,
        }),
      ).toThrow(/greater than zero/);
    });

    it("refuses a negative received amount", () => {
      expect(() =>
        resolveTransferConversion({
          amount: 100,
          fromCurrencyCode: "USD",
          toCurrencyCode: "EUR",
          toAmount: -90,
        }),
      ).toThrow(/must not be negative/);
    });

    // A zero transfer moves a known zero -- but the rate cannot be derived from
    // it, and storing 1 on a cross-currency leg is the same claim of parity in
    // miniature.
    it("needs an explicit rate for a zero-amount transfer", () => {
      expect(() =>
        resolveTransferConversion({
          amount: 0,
          fromCurrencyCode: "USD",
          toCurrencyCode: "EUR",
          toAmount: 0,
        }),
      ).toThrow(/needs an exchange rate or the amount received/);
      expect(
        resolveTransferConversion({
          amount: 0,
          fromCurrencyCode: "USD",
          toCurrencyCode: "EUR",
          exchangeRate: 0.9,
        }),
      ).toEqual({ amount: 0, toAmount: 0, exchangeRate: 0.9 });
    });

    it("refuses a zero transfer that claims to deliver something", () => {
      expect(() =>
        resolveTransferConversion({
          amount: 0,
          fromCurrencyCode: "USD",
          toCurrencyCode: "EUR",
          toAmount: 50,
        }),
      ).toThrow(/cannot receive 50 EUR/);
    });

    it("treats null and undefined alike as 'not supplied'", () => {
      expect(() =>
        resolveTransferConversion({
          amount: 100,
          fromCurrencyCode: "USD",
          toCurrencyCode: "EUR",
          exchangeRate: null,
          toAmount: null,
        }),
      ).toThrow(/needs an exchange rate or the amount received/);
    });

    it("treats a NaN rate as 'not supplied' rather than as a conversion", () => {
      expect(() =>
        resolveTransferConversion({
          amount: 100,
          fromCurrencyCode: "USD",
          toCurrencyCode: "EUR",
          exchangeRate: Number.NaN,
        }),
      ).toThrow(/needs an exchange rate or the amount received/);
    });
  });
});

describe("resolveTransferUpdateConversion", () => {
  const stored = {
    fromCurrencyCode: "USD",
    toCurrencyCode: "EUR",
    storedFromCurrencyCode: "USD",
    storedToCurrencyCode: "EUR",
    storedAmount: 100,
    storedToAmount: 90,
    storedExchangeRate: 0.9,
  };

  it("keeps the stored conversion when nothing about the money changes", () => {
    expect(resolveTransferUpdateConversion(stored)).toEqual({
      amount: 100,
      toAmount: 90,
      exchangeRate: 0.9,
    });
  });

  it("keeps the stored conversion when the amount is restated unchanged", () => {
    expect(
      resolveTransferUpdateConversion({ ...stored, requestedAmount: 100 }),
    ).toEqual({ amount: 100, toAmount: 90, exchangeRate: 0.9 });
  });

  // The compounding half of P6-002: the old code rescaled the destination leg by
  // the rate stored on it, and that rate was 1 on every cross-currency transfer
  // the affected paths created.
  it("refuses an amount change with no conversion", () => {
    expect(() =>
      resolveTransferUpdateConversion({ ...stored, requestedAmount: 200 }),
    ).toThrow(/needs an exchange rate or the amount received/);
  });

  it("accepts an amount change that restates the conversion", () => {
    expect(
      resolveTransferUpdateConversion({
        ...stored,
        requestedAmount: 200,
        requestedExchangeRate: 0.91,
      }),
    ).toEqual({ amount: 200, toAmount: 182, exchangeRate: 0.91 });
  });

  it("refuses an amount change on a legacy leg storing a rate of 1", () => {
    expect(() =>
      resolveTransferUpdateConversion({
        ...stored,
        storedToAmount: 100,
        storedExchangeRate: 1,
        requestedAmount: 200,
      }),
    ).toThrow(/needs an exchange rate or the amount received/);
  });

  it("refuses a currency change with no conversion, even at an unchanged amount", () => {
    expect(() =>
      resolveTransferUpdateConversion({
        ...stored,
        toCurrencyCode: "GBP",
      }),
    ).toThrow(/needs an exchange rate or the amount received/);
  });

  it("rescales a same-currency transfer without any FX field", () => {
    expect(
      resolveTransferUpdateConversion({
        fromCurrencyCode: "USD",
        toCurrencyCode: "USD",
        storedFromCurrencyCode: "USD",
        storedToCurrencyCode: "USD",
        storedAmount: 100,
        storedToAmount: 100,
        storedExchangeRate: 1,
        requestedAmount: 250,
      }),
    ).toEqual({ amount: 250, toAmount: 250, exchangeRate: 1 });
  });

  it("refuses a rate on an edit that leaves both accounts in one currency", () => {
    expect(() =>
      resolveTransferUpdateConversion({
        fromCurrencyCode: "USD",
        toCurrencyCode: "USD",
        storedFromCurrencyCode: "USD",
        storedToCurrencyCode: "USD",
        storedAmount: 100,
        storedToAmount: 100,
        storedExchangeRate: 1,
        requestedExchangeRate: 1.3,
      }),
    ).toThrow(/cannot carry an exchange rate/);
  });

  it("derives the rate when an edit supplies only the received amount", () => {
    expect(
      resolveTransferUpdateConversion({ ...stored, requestedToAmount: 95 }),
    ).toEqual({ amount: 100, toAmount: 95, exchangeRate: 0.95 });
  });
});
