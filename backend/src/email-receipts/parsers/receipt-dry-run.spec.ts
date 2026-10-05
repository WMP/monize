import { createScopedDbMocks } from "../../test-helpers/scoped-db-testing";
import { Category } from "../../categories/entities/category.entity";
import {
  compareWithExpected,
  loadTransactionSummaries,
  summarizeTransaction,
} from "./receipt-dry-run";

const USER = "user-1";
const T1 = "40000000-0000-4000-8000-000000000001";
const T2 = "40000000-0000-4000-8000-000000000002";
const CAT = "11111111-1111-4111-8111-111111111111";

const CONFIG = { daysBefore: 3, daysAfter: 14, toleranceUnits: 0 };

describe("compareWithExpected", () => {
  const expected = { date: "2026-09-11", amount: -15 };

  it("agrees when the transaction is inside the window and the amount equals the total", () => {
    expect(
      compareWithExpected(
        { total: 150000, paid: null },
        "2026-09-10",
        CONFIG,
        expected,
      ),
    ).toEqual({ date: true, total: true, agrees: true });
  });

  it("prefers what was paid to the total, as the matcher does", () => {
    expect(
      compareWithExpected(
        { total: 200000, paid: 150000 },
        "2026-09-10",
        CONFIG,
        expected,
      ).total,
    ).toBe(true);
    expect(
      compareWithExpected(
        { total: 150000, paid: 200000 },
        "2026-09-10",
        CONFIG,
        expected,
      ).total,
    ).toBe(false);
  });

  it("disagrees on the date outside the window, either side", () => {
    expect(
      compareWithExpected({ total: 150000, paid: null }, "2026-09-10", CONFIG, {
        ...expected,
        date: "2026-09-06",
      }).date,
    ).toBe(false);
    expect(
      compareWithExpected({ total: 150000, paid: null }, "2026-09-10", CONFIG, {
        ...expected,
        date: "2026-09-25",
      }).date,
    ).toBe(false);
    // the window edges are inside
    expect(
      compareWithExpected({ total: 150000, paid: null }, "2026-09-10", CONFIG, {
        ...expected,
        date: "2026-09-07",
      }).date,
    ).toBe(true);
    expect(
      compareWithExpected({ total: 150000, paid: null }, "2026-09-10", CONFIG, {
        ...expected,
        date: "2026-09-24",
      }).date,
    ).toBe(true);
  });

  it("honours the profile's amount tolerance, in both directions", () => {
    const tolerant = { ...CONFIG, toleranceUnits: 5000 };
    expect(
      compareWithExpected(
        { total: 154000, paid: null },
        "2026-09-10",
        tolerant,
        expected,
      ).total,
    ).toBe(true);
    expect(
      compareWithExpected(
        { total: 156000, paid: null },
        "2026-09-10",
        tolerant,
        expected,
      ).total,
    ).toBe(false);
    expect(
      compareWithExpected(
        { total: 154000, paid: null },
        "2026-09-10",
        CONFIG,
        expected,
      ).total,
    ).toBe(false);
  });

  it("an email that states no amount does not agree on the total, and a refund is compared by size", () => {
    expect(
      compareWithExpected(
        { total: null, paid: null },
        "2026-09-10",
        CONFIG,
        expected,
      ).agrees,
    ).toBe(false);
    expect(
      compareWithExpected({ total: 150000, paid: null }, "2026-09-10", CONFIG, {
        ...expected,
        amount: 15,
      }).total,
    ).toBe(true);
  });
});

describe("summarizeTransaction", () => {
  it("reads as date, amount with currency, payee", () => {
    expect(
      summarizeTransaction({
        date: "2026-09-11",
        amount: -15,
        currencyCode: "PLN",
        payeeName: "Shop",
      }),
    ).toBe("2026-09-11, -15 PLN, Shop");
    expect(
      summarizeTransaction({
        date: "2026-09-11",
        amount: -15,
        payeeName: null,
      }),
    ).toBe("2026-09-11, -15");
  });
});

describe("loadTransactionSummaries", () => {
  function setup() {
    const categoryRepo = {
      find: jest
        .fn()
        .mockResolvedValue([{ id: CAT, name: "Books", parentId: null }]),
    };
    const { manager } = createScopedDbMocks([[Category, categoryRepo]]);
    return { manager };
  }

  it("asks nothing for no ids", async () => {
    const { manager } = setup();
    await expect(
      loadTransactionSummaries(manager as never, USER, []),
    ).resolves.toEqual(new Map());
    expect(manager.query).not.toHaveBeenCalled();
  });

  it("reads the user's transactions and their split lines in two user-scoped statements", async () => {
    const { manager } = setup();
    manager.query
      .mockResolvedValueOnce([
        {
          id: T1,
          date: "2026-09-11",
          amount: "-15.0000",
          currency_code: "USD",
          payee_name: "Shop",
          description: "Order",
          category_id: null,
        },
        {
          id: T2,
          date: "2026-09-12",
          amount: "-5.0000",
          currency_code: "USD",
          payee_name: null,
          description: null,
          category_id: CAT,
        },
      ])
      .mockResolvedValueOnce([
        {
          transaction_id: T1,
          category_id: CAT,
          amount: "-10.0000",
          memo: null,
        },
        {
          transaction_id: T1,
          category_id: null,
          amount: "-5.0000",
          memo: "ship",
        },
      ]);

    const result = await loadTransactionSummaries(manager as never, USER, [
      T1,
      T2,
    ]);

    expect(manager.query).toHaveBeenCalledTimes(2);
    for (const [sql, params] of manager.query.mock.calls) {
      expect(String(sql)).toContain("t.user_id = $1");
      expect(params[0]).toBe(USER);
    }
    expect(result.get(T1)).toEqual({
      id: T1,
      date: "2026-09-11",
      amount: -15,
      currencyCode: "USD",
      payeeName: "Shop",
      description: "Order",
      categories: [
        { category: "Books", amount: -10, memo: null },
        { category: null, amount: -5, memo: "ship" },
      ],
    });
    expect(result.get(T2)?.categories).toEqual([
      { category: "Books", amount: null, memo: null },
    ]);
  });

  it("leaves out an id that is not the user's", async () => {
    const { manager } = setup();
    manager.query.mockResolvedValueOnce([]);
    const result = await loadTransactionSummaries(manager as never, USER, [T1]);
    expect(result.size).toBe(0);
    expect(manager.query).toHaveBeenCalledTimes(1);
  });
});
