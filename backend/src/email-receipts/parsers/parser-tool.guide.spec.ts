import {
  MAX_CATEGORY_RULES,
  MAX_PATTERN_LENGTH,
  MAX_PATTERNS_PER_FIELD,
} from "../parsing/receipt-parser.types";
import {
  EMAIL_RECEIPT_PARSER_OPERATIONS,
  EMAIL_RECEIPT_PARSER_TOOL_DESCRIPTION,
  EMAIL_RECEIPT_PARSER_TOOL_MAX_RECEIPTS,
} from "./parser-tool.guide";
import { PARSER_TOOL_MAX_RECEIPTS } from "./email-receipt-parser-tools.service";
import { PARSER_DRAFT_MAX_RECEIPTS } from "./dto/email-receipt-parser.dto";
import { MAX_PARSER_DRAFT_EMAILS } from "../../ai-review/ai-review-request.entity";
import { validateReceiptParserDefinition } from "../parsing/receipt-parser.validation";

describe("the email_receipt_parsers guide", () => {
  const text = EMAIL_RECEIPT_PARSER_TOOL_DESCRIPTION;

  it("quotes the validator's own bounds", () => {
    expect(text).toContain(`Max ${MAX_PATTERNS_PER_FIELD} patterns per field`);
    expect(text).toContain(`${MAX_PATTERN_LENGTH} characters each`);
    expect(text).toContain(`${MAX_CATEGORY_RULES} rules`);
  });

  it("holds the five-email bound in every place that states it", () => {
    expect(EMAIL_RECEIPT_PARSER_TOOL_MAX_RECEIPTS).toBe(5);
    expect(PARSER_TOOL_MAX_RECEIPTS).toBe(
      EMAIL_RECEIPT_PARSER_TOOL_MAX_RECEIPTS,
    );
    expect(PARSER_DRAFT_MAX_RECEIPTS).toBe(
      EMAIL_RECEIPT_PARSER_TOOL_MAX_RECEIPTS,
    );
    expect(MAX_PARSER_DRAFT_EMAILS).toBe(
      EMAIL_RECEIPT_PARSER_TOOL_MAX_RECEIPTS,
    );
    expect(text).toContain("1 to 5 emails");
  });

  it("names every operation and the loop", () => {
    expect(EMAIL_RECEIPT_PARSER_OPERATIONS).toEqual([
      "test",
      "save_draft",
      "categories",
    ]);
    for (const operation of EMAIL_RECEIPT_PARSER_OPERATIONS) {
      expect(text).toContain(operation);
    }
    expect(text).toMatch(/test every email/);
    expect(text).toMatch(/fix patterns until each reads complete/);
  });

  it("names every top-level key of the language and the captures each field allows", () => {
    for (const key of [
      "orderId",
      "total",
      "shipping",
      "discount",
      "items",
      "startAfter",
      "stopAt",
      "patterns",
      "categoryRules",
      "defaultCategoryId",
      "shippingCategoryId",
    ]) {
      expect(text).toContain(key);
    }
    for (const capture of [
      "{orderid}",
      "{amount}",
      "{name}",
      "{price}",
      "{qty}",
    ]) {
      expect(text).toContain(capture);
    }
    expect(text).toMatch(/no regex/);
  });

  it("tells the model a draft is not applied", () => {
    expect(text).toMatch(/approve the draft/);
    expect(text).toMatch(/never say it was applied/);
  });

  it("describes a parser the validator accepts: the example in the text is the language", () => {
    // The shape the text shows, filled in with the capture names it teaches.
    const validation = validateReceiptParserDefinition({
      version: 1,
      orderId: ["*order #{orderid}*"],
      total: ["Total: {amount}"],
      shipping: ["Shipping: {amount}"],
      discount: ["Discount: {amount}"],
      items: {
        startAfter: "Items",
        stopAt: "Subtotal",
        patterns: ["{qty} x {name} {price}", "{name} {amount}"],
      },
      categoryRules: [
        {
          match: "*cable*",
          categoryId: "11111111-1111-4111-8111-111111111111",
        },
      ],
      defaultCategoryId: "11111111-1111-4111-8111-111111111111",
      shippingCategoryId: "11111111-1111-4111-8111-111111111111",
    });

    expect(validation.ok).toBe(true);
  });

  it("is short enough to ride in every tools/list: under 1,500 characters", () => {
    expect(text.length).toBeLessThan(1500);
  });
});
