import {
  SPLIT_AMOUNT,
  SPLIT_CATEGORY_ID,
  SPLIT_CATEGORY_NAME,
  joinSplitsForAnalytics,
} from "./transaction-split-query.util";

describe("transaction-split-query SQL fragments", () => {
  it("exposes COALESCE expressions for category id, amount, and name", () => {
    expect(SPLIT_CATEGORY_ID).toBe("COALESCE(ts.categoryId, t.categoryId)");
    expect(SPLIT_AMOUNT).toBe("COALESCE(ts.amount, t.amount)");
    expect(SPLIT_CATEGORY_NAME).toBe(
      "COALESCE(splitCat.name, cat.name, 'Uncategorized')",
    );
  });
});

describe("joinSplitsForAnalytics", () => {
  it("left joins splits and split category and excludes transfer splits", () => {
    const leftJoin = jest.fn().mockReturnThis();
    const andWhere = jest.fn().mockReturnThis();
    const qb = { leftJoin, andWhere } as any;

    const result = joinSplitsForAnalytics(qb);

    expect(result).toBe(qb);
    expect(leftJoin).toHaveBeenCalledWith("t.splits", "ts");
    expect(leftJoin).toHaveBeenCalledWith("ts.category", "splitCat");
    expect(andWhere).toHaveBeenCalledWith(
      "(ts.transferAccountId IS NULL OR ts.id IS NULL)",
    );
  });
});
