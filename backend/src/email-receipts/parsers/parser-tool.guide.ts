/**
 * What the `email_receipt_parsers` tool is and how to use it: the operations,
 * the bounds of its inputs and the one description both tool surfaces (the
 * assistant's executor and the MCP server) show a model. It lives here, beside
 * the parser language it describes, so the two surfaces cannot teach different
 * languages. Plain data: no Nest, no database.
 *
 * The MCP `tools/list` payload is paid for on every request
 * (`mcp/tools-list-budget.spec.ts`), so the text is as short as it can be while
 * still teaching the whole language. The bounds quoted in it are the validator's
 * (`receipt-parser.types.ts`); `parser-tool.guide.spec.ts` holds the two
 * together.
 */

export const EMAIL_RECEIPT_PARSER_OPERATIONS = [
  "test",
  "save_draft",
  "categories",
] as const;
export type EmailReceiptParserOperation =
  (typeof EMAIL_RECEIPT_PARSER_OPERATIONS)[number];

/** Emails one `test` call reads. */
export const EMAIL_RECEIPT_PARSER_TOOL_MAX_RECEIPTS = 5;

export const EMAIL_RECEIPT_PARSER_TOOL_DESCRIPTION =
  "Write a parser for one merchant's order emails and save it as a draft. " +
  "Parser JSON: {version:1, orderId:[p], total:[p], shipping:[p], discount:[p], items:{startAfter, stopAt, patterns:[p]}, categoryRules:[{match:g, categoryId}], defaultCategoryId, shippingCategoryId}. " +
  "A pattern p is a glob matched case-insensitively against one whole line: * matches any text, {name} captures it, the rest is literal; no regex. " +
  "Captures: orderId {orderid}; total, shipping, discount {amount}; items {name} plus {amount} (line total) or {price} with optional {qty}, not both. " +
  "startAfter/stopAt: substrings bounding the item section. g: a capture-free glob over the item name. Category ids: operation categories. " +
  "Max 10 patterns per field, 200 characters each, 50 rules. " +
  "test reads 1 to 5 emails (receiptIds) with a definition and writes nothing. " +
  "Loop: test every email, fix patterns until each reads complete or you know why not, then save_draft (with requestId if you claimed a parser draft request). " +
  "The user must approve the draft in Monize before it reads mail; never say it was applied.";
