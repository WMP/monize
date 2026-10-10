import {
  BondLotTransaction,
  bondLotsAsOf,
  bondLotsFromTransactions,
} from "./bond-lots";

const tx = (
  action: string,
  transactionDate: string,
  quantity: string | null,
  over: Partial<BondLotTransaction> = {},
): BondLotTransaction => ({
  action,
  status: "UNRECONCILED",
  transactionDate,
  quantity,
  pairedTransfer: false,
  ...over,
});

const lots = (rows: BondLotTransaction[]) => {
  const result = bondLotsFromTransactions(rows);
  if (result.lots === null) {
    throw new Error(`refused: ${result.refusal.code} ${result.refusal.detail}`);
  }
  return result.lots;
};

describe("bondLotsFromTransactions (spec 12.2 truth table)", () => {
  describe("adds a lot dated the transaction", () => {
    it.each(["BUY", "REINVEST", "ADD_SHARES", "REINVEST_INTEREST"])(
      "%s",
      (action) => {
        expect(lots([tx(action, "2026-10-15", "25.00000000")])).toEqual([
          {
            purchaseDate: "2026-10-15",
            quantity: 25,
            purchaseDateAssumed: false,
          },
        ]);
      },
    );
  });

  describe("transfers", () => {
    it("a linked TRANSFER_OUT / TRANSFER_IN pair changes nothing and keeps the lot's date", () => {
      expect(
        lots([
          tx("BUY", "2026-01-10", "10"),
          tx("TRANSFER_OUT", "2026-02-01", "10", { pairedTransfer: true }),
          tx("TRANSFER_IN", "2026-02-01", "10", { pairedTransfer: true }),
        ]),
      ).toEqual([
        {
          purchaseDate: "2026-01-10",
          quantity: 10,
          purchaseDateAssumed: false,
        },
      ]);
    });

    it("an unlinked TRANSFER_IN is a lot dated the transfer, flagged assumed", () => {
      expect(lots([tx("TRANSFER_IN", "2026-03-01", "7")])).toEqual([
        { purchaseDate: "2026-03-01", quantity: 7, purchaseDateAssumed: true },
      ]);
    });

    it("an unlinked TRANSFER_OUT removes first-in first-out", () => {
      expect(
        lots([
          tx("BUY", "2026-01-10", "10"),
          tx("TRANSFER_OUT", "2026-02-01", "4"),
        ]),
      ).toEqual([
        { purchaseDate: "2026-01-10", quantity: 6, purchaseDateAssumed: false },
      ]);
    });
  });

  describe("removals are first-in first-out", () => {
    const buys = [tx("BUY", "2026-01-10", "10"), tx("BUY", "2026-02-10", "5")];

    it.each(["SELL", "REDEEM", "REMOVE_SHARES"])(
      "%s takes the oldest lot first and may span lots",
      (action) => {
        expect(lots([...buys, tx(action, "2026-03-01", "12")])).toEqual([
          {
            purchaseDate: "2026-02-10",
            quantity: 3,
            purchaseDateAssumed: false,
          },
        ]);
      },
    );

    it("an exact removal closes the lot", () => {
      expect(lots([...buys, tx("SELL", "2026-03-01", "10")])).toEqual([
        { purchaseDate: "2026-02-10", quantity: 5, purchaseDateAssumed: false },
      ]);
    });

    it("everything sold leaves no lots, not a refusal", () => {
      expect(lots([...buys, tx("SELL", "2026-03-01", "15")])).toEqual([]);
    });
  });

  it("excludes VOID rows", () => {
    expect(
      lots([
        tx("BUY", "2026-01-10", "10", { status: "VOID" }),
        tx("BUY", "2026-02-10", "5"),
        tx("SELL", "2026-03-01", "99", { status: "VOID" }),
      ]),
    ).toEqual([
      { purchaseDate: "2026-02-10", quantity: 5, purchaseDateAssumed: false },
    ]);
  });

  it("ignores cash-only actions, whatever their quantity", () => {
    expect(
      lots([
        tx("BUY", "2026-01-10", "10"),
        tx("DIVIDEND", "2026-02-01", "3.5"),
        tx("INTEREST", "2026-02-02", null),
        tx("CAPITAL_GAIN", "2026-02-03", "1"),
      ]),
    ).toHaveLength(1);
  });

  it("reads NUMERIC text exactly: 25.00000000 is 25, and a zero quantity adds no lot", () => {
    expect(lots([tx("BUY", "2026-01-10", "25.00000000")])[0].quantity).toBe(25);
    expect(lots([tx("BUY", "2026-01-10", "0")])).toEqual([]);
  });

  describe("refuses, naming the reason, and returns no lots", () => {
    it("a SPLIT", () => {
      const result = bondLotsFromTransactions([
        tx("BUY", "2026-01-10", "10"),
        tx("SPLIT", "2026-02-01", "2"),
      ]);
      expect(result.lots).toBeNull();
      expect(result.refusal).toMatchObject({ code: "SPLIT" });
      expect(result.refusal?.detail).toContain("2026-02-01");
    });

    it.each(["2.5", "10.00000001", "0.5"])(
      "a non-whole quantity (%s)",
      (quantity) => {
        const result = bondLotsFromTransactions([
          tx("BUY", "2026-01-10", quantity),
        ]);
        expect(result.lots).toBeNull();
        expect(result.refusal).toMatchObject({ code: "FRACTIONAL_QUANTITY" });
      },
    );

    it("a removal larger than the open lots", () => {
      const result = bondLotsFromTransactions([
        tx("BUY", "2026-01-10", "10"),
        tx("SELL", "2026-02-01", "11"),
      ]);
      expect(result.lots).toBeNull();
      expect(result.refusal).toMatchObject({ code: "OVER_REMOVAL" });
      expect(result.refusal?.detail).toContain("11");
      expect(result.refusal?.detail).toContain("10");
    });

    it("a removal with nothing held", () => {
      expect(
        bondLotsFromTransactions([tx("SELL", "2026-02-01", "1")]).refusal,
      ).toMatchObject({ code: "OVER_REMOVAL" });
    });

    it.each([null, "-5", "abc", "99999999999999999999"])(
      "a quantity that cannot be counted (%s)",
      (quantity) => {
        expect(
          bondLotsFromTransactions([tx("BUY", "2026-01-10", quantity)]).refusal,
        ).toMatchObject({ code: "INVALID_QUANTITY" });
      },
    );

    it("a VOID split or fractional row does not refuse", () => {
      expect(
        lots([
          tx("BUY", "2026-01-10", "10"),
          tx("SPLIT", "2026-02-01", "2", { status: "VOID" }),
          tx("BUY", "2026-02-02", "1.5", { status: "VOID" }),
        ]),
      ).toHaveLength(1);
    });
  });

  it("does not modify the rows it was handed and returns new lot objects", () => {
    const rows = [tx("BUY", "2026-01-10", "10"), tx("SELL", "2026-02-01", "3")];
    const before = JSON.stringify(rows);
    const first = lots(rows);
    expect(JSON.stringify(rows)).toBe(before);
    expect(lots(rows)).toEqual(first);
    expect(lots(rows)[0]).not.toBe(first[0]);
  });

  describe("bondLotsAsOf", () => {
    const rows = [
      tx("BUY", "2026-01-10", "10"),
      tx("BUY", "2026-02-10", "5"),
      tx("SELL", "2026-03-01", "12"),
      tx("SPLIT", "2026-04-01", "2"),
    ];

    it("is the fold of the rows up to and including the date", () => {
      expect(bondLotsAsOf(rows, "2026-01-09").lots).toEqual([]);
      expect(bondLotsAsOf(rows, "2026-02-09").lots).toEqual([
        {
          purchaseDate: "2026-01-10",
          quantity: 10,
          purchaseDateAssumed: false,
        },
      ]);
      expect(bondLotsAsOf(rows, "2026-02-10").lots).toHaveLength(2);
      expect(bondLotsAsOf(rows, "2026-03-01").lots).toEqual([
        { purchaseDate: "2026-02-10", quantity: 3, purchaseDateAssumed: false },
      ]);
    });

    it("refuses from the day a row makes the lots unknowable, and not before", () => {
      expect(bondLotsAsOf(rows, "2026-03-31").refusal).toBeNull();
      expect(bondLotsAsOf(rows, "2026-04-01").refusal).toMatchObject({
        code: "SPLIT",
      });
    });
  });
});
