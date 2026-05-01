import { applyInvestmentTransactionFilters } from "./investment-filter.util";

describe("applyInvestmentTransactionFilters", () => {
  it("applies both subtype and NOT EXISTS filters with the default transaction alias", () => {
    const andWhere = jest.fn().mockReturnThis();
    const qb = { andWhere } as any;

    const result = applyInvestmentTransactionFilters(qb, "account");

    expect(result).toBe(qb);
    expect(andWhere).toHaveBeenCalledTimes(2);
    expect(andWhere.mock.calls[0][0]).toContain("account.accountSubType");
    expect(andWhere.mock.calls[0][0]).toContain("INVESTMENT_BROKERAGE");
    expect(andWhere.mock.calls[1][0]).toContain("investment_transactions");
    expect(andWhere.mock.calls[1][0]).toContain("transaction.id");
  });

  it("uses a custom transaction alias when provided", () => {
    const andWhere = jest.fn().mockReturnThis();
    const qb = { andWhere } as any;

    applyInvestmentTransactionFilters(qb, "acc", "tx");

    expect(andWhere.mock.calls[1][0]).toContain("tx.id");
    expect(andWhere.mock.calls[1][0]).not.toContain("transaction.id");
  });
});
