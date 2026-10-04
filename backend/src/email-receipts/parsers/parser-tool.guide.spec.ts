import {
  MAX_CATEGORY_RULES,
  MAX_PATTERN_LENGTH,
  MAX_PATTERNS_PER_FIELD,
  RECEIPT_PARSER_VERSION,
} from "../parsing/receipt-parser.types";
import {
  EMAIL_RECEIPT_PARSER_LANGUAGE_GUIDE,
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

  it("teaches version 2 and leaves the validator's bounds to its error codes", () => {
    expect(text).toContain("version:2");
    expect(RECEIPT_PARSER_VERSION).toBe(2);
    // The bounds are not quoted (the per-tool byte budget has no room); a
    // definition over one is refused with a code the model can read.
    const tooMany = validateReceiptParserDefinition({
      version: 2,
      total: Array.from(
        { length: MAX_PATTERNS_PER_FIELD + 1 },
        () => "T {amount}",
      ),
    });
    expect(tooMany).toMatchObject({
      ok: false,
      errors: [{ path: "total", code: "too_many" }],
    });
    expect(MAX_PATTERN_LENGTH).toBe(200);
    expect(MAX_CATEGORY_RULES).toBe(50);
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
    expect(text).toMatch(/Test every email/);
    expect(text).toMatch(/fix until complete/);
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
      "skipLines",
      "patterns",
      "record",
      "optional",
      "label",
      "value",
      "within",
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
    expect(text).toMatch(/tried in order/);
  });

  it("tells the model a draft is not applied", () => {
    expect(text).toMatch(/approve the draft/);
    expect(text).toMatch(/never say it was applied/);
  });

  it("describes parsers the validator accepts: both item shapes of the text are the language", () => {
    const common = {
      version: 2,
      orderId: ["*order #{orderid}*"],
      total: [
        { label: "TOTAL", value: "{amount}", within: 3 },
        "Total: {amount}",
      ],
      shipping: ["Shipping: {amount}"],
      discount: ["Discount: {amount}"],
      categoryRules: [
        {
          match: "*cable*",
          categoryId: "11111111-1111-4111-8111-111111111111",
        },
      ],
      defaultCategoryId: "11111111-1111-4111-8111-111111111111",
      shippingCategoryId: "11111111-1111-4111-8111-111111111111",
    };
    const lines = validateReceiptParserDefinition({
      ...common,
      items: {
        startAfter: "Items",
        stopAt: "Subtotal",
        patterns: ["{qty} x {name} {price}", "{name} {amount}"],
      },
    });
    const block = validateReceiptParserDefinition({
      ...common,
      items: {
        startAfter: "Items",
        stopAt: "Subtotal",
        skipLines: ["<*>"],
        record: [
          { line: "{name}" },
          { line: "{amount}" },
          { line: "{qty} x {price}", optional: true },
        ],
      },
    });

    expect(lines.ok).toBe(true);
    expect(block.ok).toBe(true);
  });

  it("is short enough to ride in every tools/list: under 1,500 characters", () => {
    expect(text.length).toBeLessThan(1500);
  });
});

describe("the language guide the categories operation returns", () => {
  const guide = EMAIL_RECEIPT_PARSER_LANGUAGE_GUIDE;

  it("names every top-level key, items shape and capture the validator accepts", () => {
    for (const word of [
      "orderId",
      "total",
      "paid",
      "shipping",
      "discount",
      "payee",
      "items",
      "categoryRules",
      "defaultCategoryId",
      "shippingCategoryId",
      "requireLine",
      "skipIfLine",
      "waitIfLine",
      "patterns",
      "record",
      "single",
      "joinWrapped",
      "skipLines",
      "startAfter",
      "stopAt",
      "label",
      "within",
      "optional",
      "{orderid}",
      "{amount}",
      "{payee}",
      "{name}",
      "{*}",
      "item_amount_missing",
      "trace",
      "outcome",
      "source",
      "html",
      "no_html",
      "schema.org",
    ]) {
      expect(guide).toContain(word);
    }
  });

  it("states the arithmetic: gross, net, and which of total and paid must equal which", () => {
    expect(guide).toMatch(/gross = items \+ shipping; net = gross - discount/);
    expect(guide).toMatch(/paid must equal net; total must equal gross or net/);
  });

  it("quotes the validator's bounds", () => {
    expect(guide).toContain(`${MAX_PATTERNS_PER_FIELD} entries per field`);
    expect(guide).toContain(`${MAX_PATTERN_LENGTH} characters per pattern`);
    expect(guide).toContain(`${MAX_CATEGORY_RULES} category rules`);
    expect(guide).toContain("1-6 steps");
    expect(guide).toContain("up to 5 alternative");
  });

  it("is what the description points to, and the description stays in budget", () => {
    expect(EMAIL_RECEIPT_PARSER_TOOL_DESCRIPTION).toMatch(
      /categories: category ids and the full language guide/,
    );
  });

  it("describes parsers the validator accepts: every shape of the guide is the language", () => {
    const definition = {
      version: 2,
      requireLine: ["*PayU*"],
      skipIfLine: ["*zwrot*"],
      waitIfLine: ["*oczekuje*"],
      orderId: ["Numer transakcji: {orderid}"],
      total: ["Kwota: {*}{amount} PLN{*}"],
      paid: [{ label: "Zapłacono", value: "{amount} zł", within: 2 }],
      payee: [{ label: "Sprzedawca", value: "{payee}" }],
      items: { single: { name: "Opis płatności: {*}{name}{*}" } },
      categoryRules: [
        {
          match: "*OLX*",
          field: "payee",
          categoryId: "11111111-1111-4111-8111-111111111111",
        },
        {
          match: "*promo*",
          field: "line",
          categoryId: "11111111-1111-4111-8111-111111111111",
        },
      ],
      defaultCategoryId: "11111111-1111-4111-8111-111111111111",
    };
    expect(validateReceiptParserDefinition(definition).ok).toBe(true);
    const joined = {
      version: 2,
      items: {
        patterns: ["{name} (deweloper: *) {amount} zł"],
        joinWrapped: true,
      },
    };
    expect(validateReceiptParserDefinition(joined).ok).toBe(true);
    const record = {
      version: 2,
      items: {
        skipLines: ["<*>"],
        record: [
          { line: ["[image: {name}]", "{name}"] },
          { line: "Ilość: {qty}" },
        ],
      },
    };
    expect(validateReceiptParserDefinition(record).ok).toBe(true);
    for (const source of ["text", "html"]) {
      expect(validateReceiptParserDefinition({ version: 2, source }).ok).toBe(
        true,
      );
    }
  });

  it("says what each source reads and that both refer to the trace's lines", () => {
    expect(guide).toMatch(/"source": "text" \(default\) or "html"/);
    expect(guide).toMatch(/EVERY table cell/);
    expect(guide).toMatch(/\[image: alt\]/);
    expect(guide).toMatch(/trace numbers the lines of that source/);
  });
});
