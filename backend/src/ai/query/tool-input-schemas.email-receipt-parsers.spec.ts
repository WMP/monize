import "reflect-metadata";
import {
  emailReceiptParsersSchema,
  validateToolInput,
} from "./tool-input-schemas";

const R1 = "e0000000-0000-4000-8000-000000000001";
const REQ = "e0000000-0000-4000-8000-000000000009";
const DEFINITION = { version: 1, total: ["Order total: {amount}"] };

describe("email_receipt_parsers schema", () => {
  it.each([
    [{ operation: "categories" }],
    [{ operation: "test", definition: DEFINITION, receiptIds: [R1] }],
    [
      {
        operation: "test",
        definition: DEFINITION,
        receiptIds: [R1],
        payeeName: "Shop",
      },
    ],
    [
      {
        operation: "save_draft",
        name: "Shop",
        fromDomains: ["shop.example.com"],
        definition: DEFINITION,
      },
    ],
    [
      {
        operation: "save_draft",
        requestId: REQ,
        name: "Shop",
        fromDomains: ["shop.example.com"],
        subjectContains: ["order"],
        payeeName: "Shop",
        definition: DEFINITION,
      },
    ],
  ])("accepts %j", (input) => {
    expect(emailReceiptParsersSchema.safeParse(input).success).toBe(true);
  });

  it.each([
    ["an unknown operation", { operation: "approve" }],
    ["test with no definition", { operation: "test", receiptIds: [R1] }],
    ["test with no emails", { operation: "test", definition: DEFINITION }],
    [
      "test with no email ids",
      { operation: "test", definition: DEFINITION, receiptIds: [] },
    ],
    [
      "test with six emails",
      {
        operation: "test",
        definition: DEFINITION,
        receiptIds: [R1, R1, R1, R1, R1, R1],
      },
    ],
    [
      "test with a non-uuid email",
      { operation: "test", definition: DEFINITION, receiptIds: ["nope"] },
    ],
    [
      "a non-object definition",
      { operation: "test", definition: "x", receiptIds: [R1] },
    ],
    [
      "an array as the definition",
      { operation: "test", definition: [], receiptIds: [R1] },
    ],
    [
      "save_draft with no name",
      {
        operation: "save_draft",
        fromDomains: ["a.example.com"],
        definition: DEFINITION,
      },
    ],
    [
      "save_draft with a blank name",
      {
        operation: "save_draft",
        name: " ",
        fromDomains: ["a.example.com"],
        definition: DEFINITION,
      },
    ],
    [
      "save_draft with no domains",
      { operation: "save_draft", name: "x", definition: DEFINITION },
    ],
    [
      "save_draft with eleven domains",
      {
        operation: "save_draft",
        name: "x",
        definition: DEFINITION,
        fromDomains: Array.from({ length: 11 }, (_, i) => `d${i}.example.com`),
      },
    ],
    [
      "save_draft with no definition",
      { operation: "save_draft", name: "x", fromDomains: ["a.example.com"] },
    ],
    [
      "save_draft with a non-uuid request",
      {
        operation: "save_draft",
        requestId: "x",
        name: "x",
        fromDomains: ["a.example.com"],
        definition: DEFINITION,
      },
    ],
    [
      "a name over 100 characters",
      {
        operation: "save_draft",
        name: "x".repeat(101),
        fromDomains: ["a.example.com"],
        definition: DEFINITION,
      },
    ],
  ])("refuses %s", (_name, input) => {
    expect(emailReceiptParsersSchema.safeParse(input).success).toBe(false);
  });

  it("strips a field it does not know: a user id in the arguments is never read", () => {
    const parsed = emailReceiptParsersSchema.parse({
      operation: "categories",
      userId: "someone-else",
    });

    expect(parsed).not.toHaveProperty("userId");
  });

  it("is registered for validateToolInput", () => {
    expect(
      validateToolInput("email_receipt_parsers", { operation: "categories" }),
    ).toEqual({ success: true, data: { operation: "categories" } });
    expect(
      validateToolInput("email_receipt_parsers", { operation: "test" }).success,
    ).toBe(false);
  });
});
