import {
  queryCategorySpending,
  resolveCategoryName,
  resolveCategorySpent,
} from "./budget-spending.util";
import { BudgetCategory } from "./entities/budget-category.entity";

function makeBudgetCategory(
  overrides: Partial<BudgetCategory> = {},
): BudgetCategory {
  return {
    id: "bc-1",
    budgetId: "b-1",
    categoryId: "cat-1",
    isTransfer: false,
    transferAccountId: null,
    isIncome: false,
    amount: 100,
    ...overrides,
  } as unknown as BudgetCategory;
}

describe("resolveCategoryName", () => {
  it("returns the transfer account name for transfer categories", () => {
    const bc = makeBudgetCategory({
      isTransfer: true,
      transferAccountId: "acc-1",
      transferAccount: { name: "Savings" },
    } as any);
    expect(resolveCategoryName(bc)).toBe("Savings");
  });

  it("returns 'Transfer' fallback when transfer account name is missing", () => {
    const bc = makeBudgetCategory({
      isTransfer: true,
      transferAccountId: "acc-1",
      transferAccount: undefined,
    } as any);
    expect(resolveCategoryName(bc)).toBe("Transfer");
  });

  it("falls through to category logic when isTransfer but transferAccountId is missing", () => {
    const bc = makeBudgetCategory({
      isTransfer: true,
      transferAccountId: null,
      category: { name: "Groceries" },
    } as any);
    expect(resolveCategoryName(bc)).toBe("Groceries");
  });

  it("returns 'parent: child' when category has a parent", () => {
    const bc = makeBudgetCategory({
      category: {
        name: "Restaurants",
        parent: { name: "Food" },
      },
    } as any);
    expect(resolveCategoryName(bc)).toBe("Food: Restaurants");
  });

  it("returns the bare category name when no parent is set", () => {
    const bc = makeBudgetCategory({
      category: { name: "Travel" },
    } as any);
    expect(resolveCategoryName(bc)).toBe("Travel");
  });

  it("returns 'Uncategorized' when category is null", () => {
    const bc = makeBudgetCategory({ category: null } as any);
    expect(resolveCategoryName(bc)).toBe("Uncategorized");
  });
});

describe("resolveCategorySpent", () => {
  it("returns the transfer spending for transfer categories", () => {
    const bc = makeBudgetCategory({
      isTransfer: true,
      transferAccountId: "acc-1",
    } as any);
    const transfers = new Map([["acc-1", 250.5]]);
    expect(resolveCategorySpent(bc, new Map(), transfers)).toBe(250.5);
  });

  it("returns 0 when transfer account has no recorded spending", () => {
    const bc = makeBudgetCategory({
      isTransfer: true,
      transferAccountId: "acc-2",
    } as any);
    expect(resolveCategorySpent(bc, new Map(), new Map())).toBe(0);
  });

  it("returns 0 for expense category with no entry in the spending map", () => {
    const bc = makeBudgetCategory();
    expect(resolveCategorySpent(bc, new Map(), new Map())).toBe(0);
  });

  it("returns the negated amount for expense categories (expenses are negative in DB)", () => {
    const bc = makeBudgetCategory();
    const spending = new Map([["cat-1", -123.45]]);
    expect(resolveCategorySpent(bc, spending, new Map())).toBe(123.45);
  });

  it("clamps to 0 when refunds exceed spending for expense categories", () => {
    const bc = makeBudgetCategory();
    const spending = new Map([["cat-1", 50]]); // refunds > spending => positive raw
    expect(resolveCategorySpent(bc, spending, new Map())).toBe(0);
  });

  it("returns the positive amount for income categories", () => {
    const bc = makeBudgetCategory({ isIncome: true } as any);
    const spending = new Map([["cat-1", 1500]]);
    expect(resolveCategorySpent(bc, spending, new Map())).toBe(1500);
  });

  it("clamps to 0 when income deductions exceed income", () => {
    const bc = makeBudgetCategory({ isIncome: true } as any);
    const spending = new Map([["cat-1", -75]]);
    expect(resolveCategorySpent(bc, spending, new Map())).toBe(0);
  });

  it("returns 0 when categoryId is missing", () => {
    const bc = makeBudgetCategory({ categoryId: null } as any);
    expect(resolveCategorySpent(bc, new Map(), new Map())).toBe(0);
  });
});

describe("queryCategorySpending", () => {
  function makeQbReturning(rows: any[]) {
    const qb: any = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue(rows),
    };
    return qb;
  }

  it("returns empty maps when there are no budget categories", async () => {
    const txRepo = { createQueryBuilder: jest.fn() };
    const splitRepo = { createQueryBuilder: jest.fn() };

    const result = await queryCategorySpending(
      txRepo as any,
      splitRepo as any,
      "user-1",
      [],
      "2026-01-01",
      "2026-01-31",
    );

    expect(result.spendingMap.size).toBe(0);
    expect(result.transferSpendingMap.size).toBe(0);
    expect(txRepo.createQueryBuilder).not.toHaveBeenCalled();
    expect(splitRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it("aggregates transaction and split spending for category budgets", async () => {
    const txRepo: any = {
      createQueryBuilder: jest
        .fn()
        .mockImplementation(() =>
          makeQbReturning([{ categoryId: "cat-1", total: "-50" }]),
        ),
    };
    const splitRepo: any = {
      createQueryBuilder: jest
        .fn()
        .mockImplementation(() =>
          makeQbReturning([{ categoryId: "cat-1", total: "-25" }]),
        ),
    };

    const result = await queryCategorySpending(
      txRepo,
      splitRepo,
      "user-1",
      [makeBudgetCategory({ categoryId: "cat-1" })],
      "2026-01-01",
      "2026-01-31",
    );

    expect(result.spendingMap.get("cat-1")).toBe(-75);
  });

  it("aggregates transfer spending separately for transfer budgets", async () => {
    const txRepo: any = {
      createQueryBuilder: jest
        .fn()
        // first call: category SUM (no category, returns nothing as no categoryId budgets)
        .mockReturnValueOnce(
          makeQbReturning([{ destinationAccountId: "acc-1", total: "300" }]),
        ),
    };
    const splitRepo: any = {
      createQueryBuilder: jest
        .fn()
        .mockImplementation(() => makeQbReturning([])),
    };

    const result = await queryCategorySpending(
      txRepo,
      splitRepo,
      "user-1",
      [
        makeBudgetCategory({
          categoryId: null,
          isTransfer: true,
          transferAccountId: "acc-1",
        } as any),
      ],
      "2026-01-01",
      "2026-01-31",
    );

    expect(result.transferSpendingMap.get("acc-1")).toBe(300);
  });

  it("treats null totals as 0", async () => {
    const txRepo: any = {
      createQueryBuilder: jest
        .fn()
        .mockImplementation(() =>
          makeQbReturning([{ categoryId: "cat-1", total: null }]),
        ),
    };
    const splitRepo: any = {
      createQueryBuilder: jest
        .fn()
        .mockImplementation(() =>
          makeQbReturning([{ categoryId: "cat-1", total: null }]),
        ),
    };

    const result = await queryCategorySpending(
      txRepo,
      splitRepo,
      "user-1",
      [makeBudgetCategory({ categoryId: "cat-1" })],
      "2026-01-01",
      "2026-01-31",
    );

    expect(result.spendingMap.get("cat-1")).toBe(0);
  });
});
