# Spec: email receipts, matching and proposal arithmetic

Status: **proposed, awaiting maintainer approval** (kenlasko/monize#930). The
design is [`../future-plans/email-receipts.md`](../future-plans/email-receipts.md).

Related: INV-RULE-001 (a proposal never moves money), INV-RECEIPT-001 to 006,
`docs/financial-semantics.md` section 5 (splits),
`docs/financial-calculation-contract.md` section 7 (rejection before write).

---

## 1. Units

Every amount the parser reads is a non-negative integer in 1/10000 units
(`12.99` is `129900`), the unit rule facts use (`rule-facts.ts`). Conversion to
a decimal happens once, when the proposal is built (`/ 10000`, then
`roundMoney`). No float is summed.

## 2. The amount grammar (`parseReceiptAmount(text)`)

Input is the text of one `{amount}` or `{price}` capture. Output is 1/10000
units or `null`.

1. Remove every character that is not a digit, `.`, `,`, `-`, `'` or a space.
   Currency symbols and codes (`$`, `zł`, `PLN`, `EUR`, `€`) go.
2. A leading `-` or a surrounding `( )` is refused (`null`): a receipt amount
   is a magnitude; a discount is its own field.
3. Remove spaces, non-breaking spaces and `'` (thousand separators).
4. The decimal separator is the last `.` or `,` when it is followed by exactly
   one or two digits and nothing else. Every other `.` or `,` is a thousand
   separator and must be followed by exactly three digits, else `null`.
5. No digits, more than 12 integer digits, or anything left over: `null`.

| Text | Result (units) |
|---|---|
| `12.99` | 129900 |
| `$1,234.56` | 12345600 |
| `1 234,56 zł` | 12345600 |
| `1.234,56 €` | 12345600 |
| `1,234` | 12340000 |
| `1234` | 12340000 |
| `12,5` | 125000 |
| `0.00` | 0 |
| `-5.00` | null |
| `1,23,4` | null |
| `abc` | null |

`qty` is a positive integer from 1 to 9999 written with digits only (a trailing
`x` or `pcs` is removed first); anything else makes the item line not match.

## 3. Matching (`matchReceipt`)

Candidates are the user's transactions, loaded in one query: not a transfer,
not VOID, not an investment row, in the currency of the account, dated from
`purchase_date - 3` to `purchase_date + 14` (calendar dates in UTC,
`addDaysYMD`), at most 200, newest first. A transaction that already has an
applied receipt, or an open receipt request, is not a candidate.

`purchase_date` is the date of the original message: `original_sent_at` when
the mailbox owner forwarded the receipt to the mailbox and the forwarded
header block was recognised (`imap/forwarded-message.ts`, applied at
ingestion and again on reprocess), otherwise `received_at`. A forward arrives
days after the purchase; centring the window on the arrival date would miss
the transaction. A forwarded date later than `received_at + 1 day` is not
believed and is dropped. The manual transaction picker uses the same date as
its default range and its From / To fields are editable; linking by hand or
by request accepts a transaction of any date.

Signals per candidate:

- **O**: the parsed order id (at least 4 characters) appears, case-insensitive,
  in the transaction's `description`, `payeeName` or `referenceNumber`.
- **A**: `abs(amount)` in units equals the amount the bank was charged,
  `paid ?? total`, exactly. With neither parsed, A is false for every candidate.
- **P**: the transaction's payee is the parser's payee (by id), OR the
  transaction's payee NAME is the merchant the email names (`ParsedReceipt.payee`),
  compared with `normalizePayeeName` (case, accents and legal suffixes ignored;
  an empty normalisation never matches). A payment gateway's notice names the
  merchant, whose bank line carries the merchant's name.

| Candidates with O | with A and P | with A only | Result | `match_kind` |
|---|---|---|---|---|
| exactly 1 | any | any | that one | `order_id` |
| 2 or more | any | any | ambiguous (the O set) | -- |
| 0 | exactly 1 | any | that one | `amount_payee` |
| 0 | 2 or more | any | ambiguous (the A and P set) | -- |
| 0 | 0 | exactly 1 | that one | `amount_only` |
| 0 | 0 | 2 or more | ambiguous (the A set) | -- |
| 0 | 0 | 0 | unmatched | -- |

The candidate list stored on an ambiguous receipt is at most 10, closest date
first. A manual link sets `match_kind = manual`; the transaction must be the
user's, not a transfer and not VOID, checked in the transaction that stores the
link.

## 4. Completeness (`ParsedReceipt.complete`)

Let `gross = sum(items.amount) + shipping` and `net = gross - discount` (absent
shipping or discount is 0). `total` is the amount the email calls the total
(possibly a list price), `paid` the amount actually charged.

Checked in this order; the first that fails is the reason:

| # | Check | Fails with |
|---|---|---|
| 1 | at least one of `total` and `paid` was found | `no_total` |
| 2 | no item is left without an amount (an item with no `amount` or `price` takes `total ?? paid` when it is the only item) | `item_amount_missing` |
| 3 | at least one item | `no_items` |
| 4 | `net >= 0`, and `paid` (if found) `= net`, and `total` (if found) `= gross` or `= net` | `items_unbalanced` |
| 5 | every item categorised, and a discount above 0 has a category | `items_uncategorized` |
| 6 | shipping above 0 has a category | `shipping_uncategorized` |
| -- | all hold | complete, no reason |

Table rows (items 10.00, discount 3.00): `total 10.00` complete (gross);
`total 7.00` complete (net); `paid 7.00` complete; `paid 10.00` unbalanced;
`total 10.00, paid 7.00` complete (the promotion case); `total 8.00`
unbalanced; neither found: `no_total`. A discount above `gross` is unbalanced
whatever `total` says.

A discount needs a category only through the item it reduces: it is a line of
its own under `defaultCategoryId`, and without one the receipt is
`items_uncategorized`.

## 5. The proposal (`buildReceiptProposal`)

Let `T` be the transaction amount (signed, a decimal), `sign = T < 0 ? -1 : 1`,
and `E = paid ?? total`, the amount the bank was charged.

| Parse complete | `abs(T)` = E | Lines | Proposal |
|---|---|---|---|
| yes | yes | 1 (one item, no shipping, no discount) | `categoryName` of the item, `description` |
| yes | yes | 2 or more, summing (net) to `abs(T)` | `splits`: each item `sign * amount`, memo; shipping `sign * shipping`; discount `-sign * discount`; `description` |
| yes | yes | 2 or more, not summing to `abs(T)` | `description` only, reason `amount_differs` |
| yes | no | -- | `description` only, reason `amount_differs` |
| no | -- | -- | `description` only, reason from section 4 |

The split lines sum to `net`. When `paid` is stated, completeness proves
`net = paid = abs(T)`. When only `total` is stated and it equals `gross` while a
discount exists, `net` differs from `abs(T)`: the proposal never splits what
does not sum to the transaction, so it is description-only (`amount_differs`);
`AiReviewWorkService.submit` checks the sum again with `sumMoney`.

**Description summary**: `"{parser name} {orderId}: item1 x2, item2"`, items
in order, joined by `, `, `x qty` only when qty > 1; the whole summary is cut
to 300 characters with `...`. It is appended to an existing description with
` | ` (`composeDescription`, 750 cap); an existing description that already
contains the summary is left as it is and the proposal carries no description.

**Payee**: when the email names a merchant (`ParsedReceipt.payee`), `payeeName`
is that merchant when the transaction has no payee OR its payee is the parser's
own (the gateway, such as PayU); a transaction with another payee is left
alone. When the email names none, `payeeName` is the parser payee's name only
when the transaction has no payee.

### Numerical example

Receipt: `2 x USB-C cable 19.98`, `Phone case 15.00`, `Shipping: 4.99`,
`Discount: 2.00`, `Order total: 37.97`. Items 199800 + 150000, shipping 49900,
discount 20000: `S = 379700 = total`. Transaction `-37.97`.

Proposal splits: `-19.98` (cable, memo `USB-C cable x 2`), `-15.00` (case),
`-4.99` (shipping), `+2.00` (discount). Sum `-37.97`.

Same receipt, transaction `-35.00` (a partial capture): description only,
reason `amount_differs`.

A promotion (Google Play): item `24.99`, `Razem: 24.99` (total), a `-3.00`
promotion line (discount), `Visa-1234: 21,99 zł` (paid). `gross = 249900`,
`net = 219900`; `total = gross` and `paid = net`: complete. Transaction
`-21.99`: splits `-24.99` (item) and `+3.00` (discount), sum `-21.99`. A
transaction of `-24.99` is description only, reason `amount_differs` (`paid` is
`21.99`).

## 6. Missing-data policy

- No total: nothing is matched on amount; an order id may still match, and the
  proposal is description-only. The receipt page says the total was not found
  and names the parser.
- No parser for the domain: `no_parser`; the page offers "create parser" and,
  when AI mode is not `off`, "Draft parser with AI".
- A category id in a parser that was deleted: the proposal's validation refuses
  it, the fallback is description-only, and the page names the parser to fix.
- A mailbox error (DNS, TLS, login, folder): stored on the mailbox
  (`last_error`, 300 characters, log-safe) and shown on the settings screen; the
  cursor does not move.
- A receipt that is not text-decodable or above the size cap: `skipped` with
  the reason; its UID is still consumed.

## 7. Auto-apply gate

Applies only when every one holds: mailbox `auto_apply`; parser `approved`;
`complete`; `abs(T) = paid ?? total`; `match_kind` is `order_id` or `amount_payee`; the
card was built. Any refusal from `confirm` (write limit, reconciled lock, a
changed row) leaves the proposal waiting in the inbox.

## 7a. AI extraction

When the poll's automatic step asks the AI about an email (`processAiRequest`),
the model returns the receipt's content, never a split of the transaction:

```json
{ "orderId": "A-1",
  "items": [ { "name": "Widget", "qty": 2, "amount": "19.98", "categoryId": "<id or null>" } ],
  "shipping": "4.99", "shippingCategoryId": "<id or null>",
  "discount": "2.00", "discountCategoryId": "<id or null>",
  "total": "37.97", "paid": "37.97", "description": "..." }
```

`paid` is optional: the amount actually charged, stated only when the email
shows it separately from the total (a card line after a promotion). It is read
like `total` and judged with section 4.

Bounds (`email-receipt-ai.schema.ts`, unknown keys refused): at most 100 items,
names 1 to 200 characters, `qty` an integer from 1 to 9999, `description` at
most 300 characters, order id at most 100. An amount is a JSON number or text.

AI output becomes a `ParsedReceipt` (`source: "ai"`, `buildAiParsedReceipt`) and
goes through the same rules as a parser's reading:

- **Amounts.** A number must be finite and not negative and is converted once with
  `Math.round(n * 10000)`; text goes through the amount grammar of section 2 and
  must hold nothing but the amount and a currency mark. An item whose amount does
  not convert, is zero, or whose name is empty is dropped; a total, shipping or
  discount that does not convert is read as not stated (`null`). Each is noted in
  the log. A stated `0.00` shipping is a known zero.
- **Categories.** An item's `categoryId`, and the optional `shippingCategoryId`
  and `discountCategoryId`, that are not one of the user's categories (the list
  given in the prompt) are `null`. The shipping and discount categories go into
  the `ParsedReceipt` as a parser's definition would give them, so a reading with
  shipping or a discount is `complete` only when each line that exists has a
  category (`shipping_uncategorized` / `items_uncategorized` otherwise).
- **Completeness** is the table of section 4, computed by the same function
  (`completeness` in `parse-receipt.ts`), not a copy of it.
- **The proposal** is `buildReceiptProposal` (section 5) with the transaction's
  amount, description and payee and the sender's domain as the summary's label,
  submitted through `AiReviewWorkService.submit` under the AI claim key. A
  description-only result (`amount_differs`, `items_uncategorized`, ...) is still
  submitted, and its reason is stored on the email (`status_reason`) so the email
  page names it. With no item to name, the model's own `description` is the
  description. A reading with no item, no total and no description is not an
  answer: the claim is given back.
- **Storage.** The reading is stored on the email (`parsed`, with `source: "ai"`)
  by one UPDATE conditional on the email still pointing at this request, so a
  slow answer never overwrites a newer one.

Which requests the automatic step takes: pending `email_receipt` requests whose
`instruction` is the poll's own (`RECEIPT_AUTOMATIC_AI_INSTRUCTION`), unclaimed
and never tried. A request queued by "Recognize with AI" carries a different
instruction (`RECEIPT_CHAT_INSTRUCTION`) and is never taken by the poll.

"Recognize with AI" (the button) does not call this: it queues a request and the
assistant in the chat, or an agent, answers it by id with splits, which
`submit` validates as in section 5 (the lines must add up to the transaction).

## 7b. Parser language (version 2)

The parser language is version 2 (design 5.1), the only one: the validator
refuses any other `version` (version 1 included) with `unsupported_version`.
What the parser reads is unchanged: a `ParsedReceipt` in units, judged by the
completeness table of section 4. What version 2 adds is HOW a value is found.

- **Priority by order.** The entries of `orderId`, `total`, `paid`, `shipping`,
  `discount` and `payee` are tried in array order, each over all lines; the
  first entry that finds an accepted value wins. A general `{amount} zł` entry
  is therefore read only when the specific entries before it found nothing.
- **Labelled entry** `{label, value, within}`: a line matching `label` (whole
  line, case-insensitive, no capture), then the first of the next `within`
  non-empty lines (1 to 10, default 3) whose `value` matches and holds an
  accepted value; otherwise the next label line. The Allegro total is
  `{label: "RAZEM", value: "{amount} zł"}`: the amount under the label, not the
  second figure under it (the basket without the Smart! package).
- **Accepted amount.** Section 2's grammar AND no operator character
  (`×`, `÷`, `+`, `*`, `/`, `=`, `%`, `<`, `>`, `@`, `#`, `\`, `|`): the grammar
  drops symbols, so `3 × 1,47 zł` would read as 31,47 and `10,95 + 5,00` as
  10 955,00. Punctuation a lazy capture drags along (`: 1 234,56 zł`) is still
  an amount.
- **Literal asterisk, trimming, invisible characters.** `{*}` and `\*` in a
  pattern are a literal `*`; every captured value is trimmed of whitespace, `*`
  and `_` (a bold `*149,41 PLN*` reads as `149,41 PLN`); zero-width characters,
  bidi marks and soft hyphens are removed from every line (Amazon puts U+202B
  before an order number).
- **Block items.** `skipLines` drop section lines; a `record` of 1 to 6 steps
  (each a glob, or up to 5 alternatives tried in order) is read from a cursor,
  one item per match (name, amount or price, optional qty from separate lines).
  The line total is `amount`, else `price * qty`; a failed record moves the
  cursor one line. `joinWrapped` (patterns) puts up to three unread lines in
  front of the next. `single` is one item for the whole email: its name from the
  first line the glob reads, quantity 1, amount `total ?? paid`.
- **An item with no amount** takes `total ?? paid` when it is the only item;
  otherwise it is dropped and the reason is `item_amount_missing`.
- **Payee and category rule fields.** `payee` entries read the merchant;
  `categoryRules[].field` is `item` (default), `payee` or `line`.
- **Line guards.** `requireLine` (the next parser for the sender is tried when
  no line matches; `no_parser` when none is left), `skipIfLine` (`ignored`,
  `status_reason` `skip_line`), `waitIfLine` (`unmatched`, `status_reason`
  `wait_line`, read again whole by the poll's 30-day rematch). Skip wins over
  wait; a manual link is not held back.

Worked example (Allegro, three products, shipping 0,00): the items are
`3 × 1,47 = 4,41`, `3 × 2,50 = 7,50` and `26 × 1,94 = 50,44`; shipping is 0,00;
the total under `RAZEM` is 62,35; items plus shipping equal the total, so
`complete` is true. The second figure under `RAZEM` (73,30) and the Smart!
delivery price (10,95) are neither total nor shipping.

Worked example (Amazon): the mail names the product in `[image: ...]`, the
quantity `Ilość: 3`, the unit price `4799zł` (dropped by `skipLines: ["*zł"]`)
and `Suma 143.97zł`. One item of quantity 3 takes the total, 143,97: complete.

## 8. Test matrix

| Case | Suite |
|---|---|
| Every row of the amount table | `parsing/receipt-amount.spec.ts` |
| Item section bounds, `price * qty`, 100-item cap, 500-character lines | `parsing/parse-receipt.spec.ts` |
| Priority by array order (an earlier entry wins wherever it sits; subject before body per entry) | `parsing/parse-receipt.spec.ts`, `parsing/parse-receipt.labelled.spec.ts` |
| Labelled entries: the value under the label; `within` exactly and `within` + 1; the next label line when a window held nothing; whole-line, case-insensitive label; blank lines do not use up the window | `parsing/parse-receipt.labelled.spec.ts` |
| Block items: record with an optional step present and absent; resync after a failed record; `skipLines`; section bounds; `price * qty`; 100-item cap | `parsing/parse-receipt.block.spec.ts` |
| A quantity line or a sum is not an amount | `parsing/receipt-amount.spec.ts`, `parsing/parse-receipt.block.spec.ts` |
| The four Allegro mails read complete: totals 59,20, 62,35, 99,21, 400,00; shipping 0,00; the Smart! price and the second figure under RAZEM never total or shipping; ` x 8szt.` in a name is not a quantity | `parsing/parse-receipt.allegro.spec.ts` |
| Every validator code of the language, each at its path | `parsing/receipt-parser.validation.spec.ts` |
| The completeness table: `paid` and `total` rows, gross and net, a discount above gross | `parsing/parse-receipt.features.spec.ts`, `parsing/parse-receipt.spec.ts` |
| `items.single`, `joinWrapped` (cap of three held lines, cleared on an item), alternatives, an item without an amount (`item_amount_missing`) | `parsing/parse-receipt.features.spec.ts` |
| Literal asterisk, trimming of values, invisible characters | `parsing/parse-receipt.features.spec.ts`, `parsing/receipt-lines.spec.ts` |
| Payee field, `categoryRules[].field`, first rule wins | `parsing/parse-receipt.features.spec.ts` |
| The PayU, Google Play and Amazon mails (anonymised from real ones) read complete; the forwarded header of each; the VAT note and the unit price are never an amount | `parsing/parse-receipt.gateways.spec.ts` |
| Signal A by `paid ?? total`; signal P by the merchant's name | `matching/match-receipt.spec.ts` |
| Proposal against `paid ?? total`; the payee rule; a split that does not sum is description only | `proposal/build-receipt-proposal.spec.ts` |
| `requireLine` passes to the next parser, `skipIfLine` is `ignored`, `waitIfLine` is `unmatched` and is read again whole by the rematch | `pipeline/email-receipt-pipeline.service.spec.ts`, `pipeline/select-receipt-parser.rank.spec.ts` |
| The test result's `outcome` and `trace` (REST and tool) | `parsers/email-receipt-parsers.service.spec.ts`, `parsers/email-receipt-parser-tools.service.spec.ts` |
| Every row of the completeness table | `parsing/parse-receipt.spec.ts` |
| Every row of the match table; date window edges (day -3, day +14, day +15) | `matching/match-receipt.spec.ts` |
| Forwarded-header detection (Gmail, Outlook, Apple Mail, Thunderbird; English and Polish labels; date formats; the 200-line bound; no header means no result) | `imap/forwarded-message.spec.ts`, `imap/forwarded-receipt.spec.ts` |
| A forwarded receipt matches the transaction near the original date, on ingestion and on reprocess; a manual link of any date | `test/integration/email-receipts-pipeline.integration.spec.ts` |
| Every row of the proposal table; the numerical example; description cap and duplicate | `proposal/build-receipt-proposal.spec.ts` |
| Auto-apply gate: each condition false in turn | `email-receipt-pipeline.service.spec.ts` |
| AI extraction: amount conversion, unknown category (item, shipping, discount), dropped items, completeness through the shared function, `source: "ai"`, description-only reasons | `ai/email-receipt-ai.extraction.spec.ts`, `ai/email-receipt-ai.service.spec.ts` |
| Recognize with AI: refusals before any write, chosen transaction stored as manual, pending request visible in the inbox, claim by id, card confirm applies the request | `email-receipt-ai.service.spec.ts`, `test/integration/email-receipts-pipeline.integration.spec.ts` |
