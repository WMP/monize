import {
  buildTransactionSearchClause,
  escapeLikePattern,
} from "./transaction-search.util";

describe("escapeLikePattern", () => {
  it("escapes backslash, percent, and underscore", () => {
    expect(escapeLikePattern("a%b_c\\d")).toBe("a\\%b\\_c\\\\d");
  });

  it("returns plain text unchanged", () => {
    expect(escapeLikePattern("groceries")).toBe("groceries");
  });
});

describe("buildTransactionSearchClause", () => {
  it("matches all the user-visible transaction fields", () => {
    const clause = buildTransactionSearchClause({
      transaction: "transaction",
      splits: "splits",
    });

    // Existing fields
    expect(clause).toContain("transaction.description ILIKE :search");
    expect(clause).toContain("transaction.payeeName ILIKE :search");
    expect(clause).toContain("transaction.referenceNumber ILIKE :search");
    expect(clause).toContain("splits.memo ILIKE :search");

    // New fields
    expect(clause).toContain("CAST(transaction.amount AS TEXT) ILIKE :search");
    expect(clause).toContain("CAST(splits.amount AS TEXT) ILIKE :search");
    expect(clause).toMatch(
      /EXISTS \(SELECT 1 FROM payees [^)]*name ILIKE :search\)/,
    );
    expect(clause).toMatch(
      /EXISTS \(SELECT 1 FROM categories [^)]*transaction\.category_id[^)]*name ILIKE :search\)/,
    );
    expect(clause).toMatch(
      /EXISTS \(SELECT 1 FROM categories [^)]*splits\.category_id[^)]*name ILIKE :search\)/,
    );
    expect(clause).toContain("transaction_tags");
    expect(clause).toContain("transaction_split_tags");
  });

  it("respects custom alias and parameter names", () => {
    const clause = buildTransactionSearchClause({
      transaction: "bf",
      splits: "bfSplits",
      paramName: "bfSearch",
    });

    expect(clause).toContain("bf.description ILIKE :bfSearch");
    expect(clause).toContain("bfSplits.memo ILIKE :bfSearch");
    expect(clause).toContain("bf.payee_id");
    expect(clause).toContain("bf.category_id");
    expect(clause).toContain("bfSplits.category_id");
    expect(clause).toContain("bf.id");
    expect(clause).toContain("bfSplits.id");
    expect(clause).not.toContain(":search");
  });
});
