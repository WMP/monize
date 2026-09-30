import {
  extractJsonObject,
  receiptReviewSchema,
  REVIEW_MAX_DESCRIPTION,
  REVIEW_MAX_MEMO,
  REVIEW_MAX_SPLITS,
} from "./email-receipt-ai.schema";

describe("extractJsonObject", () => {
  it("reads a bare object", () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it("reads a fenced ```json block", () => {
    expect(extractJsonObject('Here:\n```json\n{"a": 2}\n```\nDone')).toEqual({
      a: 2,
    });
    expect(extractJsonObject('```\n{"a": 3}\n```')).toEqual({ a: 3 });
  });

  it("reads an object inside prose", () => {
    expect(extractJsonObject('Sure! {"a": 4} hope it helps')).toEqual({ a: 4 });
  });

  it.each(["", "not json", "[1,2", "{broken", 42, null, undefined])(
    "returns undefined for %p",
    (input) => expect(extractJsonObject(input)).toBeUndefined(),
  );

  it("refuses a reply of a book's length", () => {
    expect(
      extractJsonObject('{"a":"' + "x".repeat(300_000) + '"}'),
    ).toBeUndefined();
  });
});

describe("receiptReviewSchema", () => {
  const ok = (value: unknown) => receiptReviewSchema.safeParse(value);

  it("accepts splits, a category and a description, and maps null to absent", () => {
    const parsed = ok({
      splits: [{ categoryName: "Books", amount: -12, memo: null }],
      categoryName: null,
      description: "Order 1",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({
      splits: [{ categoryName: "Books", amount: -12, memo: undefined }],
      categoryName: undefined,
      description: "Order 1",
    });
  });

  it("refuses an unknown key, so an answer cannot carry an amount or a date", () => {
    expect(ok({ description: "x", amount: 5 }).success).toBe(false);
    expect(ok({ description: "x", date: "2026-01-01" }).success).toBe(false);
    expect(
      ok({ splits: [{ categoryName: "A", amount: 1, accountId: "x" }] })
        .success,
    ).toBe(false);
  });

  it("bounds the lines, the memo and the description", () => {
    const line = { categoryName: "A", amount: 1 };
    expect(ok({ splits: Array(REVIEW_MAX_SPLITS).fill(line) }).success).toBe(
      true,
    );
    expect(
      ok({ splits: Array(REVIEW_MAX_SPLITS + 1).fill(line) }).success,
    ).toBe(false);
    expect(
      ok({ splits: [{ ...line, memo: "m".repeat(REVIEW_MAX_MEMO + 1) }] })
        .success,
    ).toBe(false);
    expect(
      ok({ description: "d".repeat(REVIEW_MAX_DESCRIPTION + 1) }).success,
    ).toBe(false);
  });

  it("refuses a non-finite or non-numeric amount and an empty category", () => {
    expect(ok({ splits: [{ categoryName: "A", amount: "5" }] }).success).toBe(
      false,
    );
    expect(ok({ splits: [{ categoryName: "A", amount: null }] }).success).toBe(
      false,
    );
    expect(ok({ splits: [{ categoryName: " ", amount: 1 }] }).success).toBe(
      false,
    );
    expect(ok({ categoryName: "" }).success).toBe(false);
  });
});
