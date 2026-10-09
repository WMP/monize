/**
 * What the `email_receipt_parsers` tool is and how to use it: the operations,
 * the bounds of its inputs and the one description both tool surfaces (the
 * assistant's executor and the MCP server) show a model. It lives here, beside
 * the parser language it describes, so the two surfaces cannot teach different
 * languages. Plain data: no Nest, no database.
 *
 * The MCP `tools/list` payload is paid for on every request
 * (`mcp/tools-list-budget.spec.ts`), so the text is as short as it can be while
 * still teaching the whole language: version 2, its labelled entries, priority
 * by order and block items. It is sized to the byte against the per-tool cap in
 * that spec, so the validator's bounds are left out: a definition over one is
 * refused with a `too_many` or `too_long` code the model can read.
 * `parser-tool.guide.spec.ts` holds the keys and captures it names to the
 * validator.
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
  "Draft an order-email parser. " +
  "JSON: {version:2, orderId:[e], total:[e], shipping:[e], discount:[e], items:{startAfter, stopAt, skipLines:[g], patterns:[p] or record:[{line:p, optional}]}, categoryRules:[{match:g, categoryId}], defaultCategoryId, shippingCategoryId}. " +
  "p: glob on a whole line, case-insensitive: * any text, {name} captures, rest literal; no regex. g: no captures. " +
  "e: p or {label:g, value:p, within:1-10 (3)}: value read from the lines after one matching label. Entries are tried in order, each over the email. " +
  "Captures: orderId {orderid}; total, shipping, discount {amount}; items {name} + {amount} (line total) or {price}, opt. {qty}. " +
  "patterns: one item per line. record: one item over several lines (a step per line, optional steps may be absent); skipLines drop lines first. startAfter/stopAt: substrings bounding the items. " +
  "categories: category ids and the full language guide. " +
  "test: 1 to 5 emails (receiptIds), writes nothing. Test every email, fix until complete, then save_draft (requestId if claimed). The user must approve the draft; never say it was applied.";

/**
 * The whole parser language, returned by the `categories` operation (the first
 * call of the loop) and not carried in `tools/list`: the description above is
 * sized to the byte, so what it has no room for is here, once, for the one
 * model that asks. It names every field the validator accepts; the guide spec
 * holds the two together.
 */
export const EMAIL_RECEIPT_PARSER_LANGUAGE_GUIDE = [
  'Parser language, version 2. Every pattern is a glob over ONE whole line, case-insensitive: * any text, {name} a capture, everything else literal; no regex. {*} or \\* is a literal asterisk (a Gmail-bold value: "Kwota: {*}{amount} PLN{*}"). Every captured value is trimmed of spaces, * and _; invisible characters are removed from lines.',
  'Top-level "source": "text" (default) or "html" chooses which lines every pattern, guard and trace line number refers to. text is the email\'s text part, one line per line break (a wrapped product name is several lines). html is the HTML part read in one pass: every block element (p, div, br, tr, li, h1-h6, table...) and EVERY table cell (td, th) ends a line, so one cell is one line and a name the text wraps is one line; inline text is joined with single spaces; script and style are dropped; an image is its own line "[image: alt]"; an http(s) link adds its own line "<url>". Use html when the text lines split or merge cells badly. test uses the definition\'s source and its trace numbers the lines of that source; an html parser on an email with no HTML part has outcome no_html (the pipeline: parse_failed, reason no_html).',
  "Structured data: an email whose HTML carries a schema.org Order or Invoice (JSON-LD or microdata) with a total and items is read from it when no parser applies or the parser found no total, so such a sender needs no parser; a parser that finds a total always wins. test does not show it.",
  "Fields orderId, total, paid, shipping, discount, payee: each a list of up to 10 entries, tried IN ORDER, each over the whole email (put the specific entry first; a later one is read only when every earlier one found nothing). An entry is a pattern or {label, value, within}: label is a capture-free glob matched to a whole line; value a pattern with the field's capture, read from the first of the next `within` lines (1-10, default 3) that holds one; else the next label line. A labelled orderId entry never reads the subject.",
  'Captures: orderId {orderid}; total, paid, shipping, discount {amount}; payee {payee}. An amount line is only an amount: "3 × 1,47 zł" or "10,95 + 5,00" is never one.',
  "Arithmetic: gross = items + shipping; net = gross - discount. total is the email's total, paid what was actually charged (a card line after a promotion). One of them is required; paid must equal net; total must equal gross or net. A receipt is matched to a bank transaction by paid, else total.",
  "payee: the merchant when it is not the sender (a payment gateway); it becomes the transaction's payee.",
  "reference: entries like orderId, capture {reference}: an identifier the shop or the payment gateway puts into the bank operation (a statement text, a transfer title). Read like orderId (a pattern reads the subject first, then the lines; the first token is kept).",
  'match (write it always; every key is optional): how the bank transaction the email paid for is found. by: strategies in the order tried, any of "reference", "orderId", "amount_payee", "amount_date", each once (default order: reference when the profile reads a reference field, then orderId, amount_payee, amount_date). ALWAYS write the whole match section in a draft, defaults included; a saved profile shows its effective match. reference and orderId look for the value (4 or more characters, case-insensitive) in the transaction fields named by referenceIn (any of description, payee, referenceNumber; default all three). amount_payee is the amount plus a payee signal, amount_date the amount alone. A strategy with exactly one candidate matches; several are ambiguous; none passes to the next strategy. daysBefore 0-60 (default 3) and daysAfter 0-90 (default 14) set the window around the purchase date; amountTolerance a decimal string "0.00" to "5.00" (default "0") lets the amount differ by that much. "reference" in by needs a reference field. test returns, per email, match: outcome (matched, ambiguous, unmatched), strategy, transaction, candidates considered and the count each strategy kept.',
  "tag (a name, 1-50 characters) is added to every transaction the profile categorises, created when missing; aiCategories (true) asks the user's AI for the category of an item no rule matched. Both are the user's choices: do not set them unless asked.",
  "items holds exactly one of: patterns (one item per line; each captures {name} and {amount} (line total) or {price} with optional {qty}; optional joinWrapped:true puts up to 3 unread lines in front of the next line, for names wrapped over lines with the price on the last); record (an item over several lines: 1-6 steps {line, optional}, line a pattern or up to 5 alternative patterns tried in order, a capture name in one step only, {name} required; skipLines, up to 10 capture-free globs, drop section lines first; a failed record moves the cursor one line); single {name} (one item for the whole email, quantity 1, amount = total, else paid). startAfter/stopAt (substrings) bound the section for all three. An item with no amount or price takes the total (else paid) when it is the only item; else the receipt is incomplete (item_amount_missing).",
  "categoryRules[{match, categoryId, field}]: match a capture-free glob; field item (default: the item name), payee (the parsed payee) or line (any line of the email); payee and line rules cover every item. First matching rule wins; then defaultCategoryId. shippingCategoryId is the shipping line's category (required when shipping is above 0); the discount line uses defaultCategoryId.",
  "requireLine, skipIfLine, waitIfLine: up to 10 capture-free globs each. requireLine: the parser applies only when a line matches (else the next parser for the sender is tried); skipIfLine: a matching line makes the email ignored; waitIfLine: it is held (unmatched) and read again later.",
  "Bounds: 10 entries per field, 200 characters per pattern, 50 category rules, 100 characters per startAfter/stopAt. test also returns, per email, outcome (read, not_applicable, skip_line, wait_line or no_html), match and trace: for each field the entry index, the pattern and the line (number, text) that produced it (a labelled entry: its label line too), and each item's patterns and lines.",
].join("\n");
