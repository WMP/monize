# Bank CSV Import: Profiles, Row Rules and Idempotent Re-import

> Design + task breakdown for absorbing the work a hand-written per-bank import script has to do
> today into the built-in Import Transactions wizard. Written 2026-07 in response to discussion
> [#991](https://github.com/kenlasko/monize/discussions/991), which reports on a ~1200-line
> external script driving the public REST API against real PKO BP (Poland) exports for several
> months. Related: #173 (import path), #990 / `docs/future-plans/mny-import.md` (`.mny` reader),
> #822 (generic engine in core, local knowledge as user content).

## 1. Summary

The CSV importer today assumes a bank export is a table: one column per field, one row per
transaction, the same meaning in every row. Real bank exports frequently are not. The PKO BP
export described in #991 is WINDOWS-1250 encoded, has six positional columns followed by a
variable-length tail of `Label: value` fragments whose meaning depends on the operation type,
has **no payee column at all** (the payee is derived differently for each of ~20 operation
types), and encodes facts inside the transaction title that need to become splits.

The good news, established by reading the pipeline: almost nothing downstream needs to change.
`parseCsv()` (`backend/src/import/csv-parser.ts:687`) produces a `QifTransaction[]`, and the
importer behind it (`ImportRegularProcessorService`) **already supports every outcome #991 asks
for** — transfers, split transactions with transfer legs, uncategorized transfer legs, tags,
reference numbers. The gap is entirely in the row → `QifTransaction` mapping stage, which is
currently a fixed column map, plus the absence of any re-import safety.

So the plan inserts one new stage and changes nothing after it:

```
raw bytes
  -> decode(encoding)                 [P2 - new; today file.text() is UTF-8 only]
  -> parseCsvRows()                   [exists, csv-parser.ts:331]
  -> resolveVariant(row)              [P3 - new: pick a field map by operation type]
  -> extractFields(row, variant)      [P3 - new: column | labelled tail | regex | literal]
  -> applyRowRules(mapped)            [P4 - new: ordered rules -> transfer / split / category / tag]
  -> QifTransaction[]                 [unchanged shape, qif-parser.ts:27]
  -> importParsedTransactions()       [unchanged, import.service.ts]
```

Independently of the mapping work, re-import safety is a correctness fix that benefits every
format (CSV, QIF, OFX, and the planned `.mny` reader, whose v1 explicitly lists dedupe as a
non-goal): a per-transaction **import key** written by the importer on every row it creates,
with a partial unique index and a cheap lookup endpoint. That is what actually retires the
"page through every transaction and build a content hash" backstop #991 had to write.

## 2. Findings: what #991 asks for vs. what exists

`referenceNumber` first, because it is item 1 in the discussion's own priority list.

| #991 claim | Verified state in the codebase |
|---|---|
| "the transfer-create endpoint does not reliably persist `referenceNumber`" | **Not reproducible on that path.** `createTransfer` destructures `referenceNumber` (`transaction-transfer.service.ts:141`) and writes it to **both** legs (`:193`, `:209`); `CreateTransferDto` accepts it (`create-transfer.dto.ts:106-111`); the manual transfer form sends it (`TransactionForm.tsx:1007`); `updateTransfer` honours it on all three leg paths (`:979`, `:1085`, `:1153`); `findAll` uses `leftJoinAndSelect` so the full entity including `reference_number` is returned (`transactions.service.ts:853`). |
| — but the reported symptom is real, from **other** creation paths | **Confirmed gaps.** (a) Split **transfer counterpart legs** are built without `referenceNumber` (`transaction-split.service.ts:332-343` and `:578`), so the parent row carries the key and its counterpart in the other account does not — exactly what a cross-account listing pass sees as `null`. (b) **Auto-posted scheduled transactions** always land with `reference_number = NULL`: the scheduled template entity has no such field and posting only reads it from the manual `PostScheduledTransactionDto` (`scheduled-transactions.service.ts:1195`, `:1305`). Standing orders (`Zlecenie stałe`) are precisely the case #991 names. |
| Encoding is WINDOWS-1250, silent mojibake if read as UTF-8 | **No encoding handling anywhere.** The wizard reads files with `file.text()` (`useImportWizard.ts:363`, `:372`, `:396`, `:438`), which is always UTF-8. No `TextDecoder`, `iconv`, or charset option exists in the import path. |
| No fixed column schema; meaning depends on operation type | **Not supported.** `CsvColumnMappingConfig` (`csv-parser.ts:19-41`) is one flat index per field, applied to every row. There is an `amountTypeColumn` with income/expense/transfer value lists (`:809-863`), which is the closest existing concept, but it only decides the sign and transfer-ness — it cannot select a different field map. |
| No payee column; payee derived per operation type | **Not supported.** `payee` is a single column index (`:769`). The six derivations in #991 (merchant from tail, `Bankomat` + location, `Nazwa odbiorcy`, `Nazwa nadawcy`, whichever-is-present, synthetic literal) are all inexpressible. |
| Re-running the import must be safe | **Only transfers are deduped**, and only within the import (`import-regular-processor.service.ts:22`, `:131-...`, counting-based to avoid false positives). Regular transactions have no duplicate check at all — re-importing a CSV duplicates every non-transfer row. |
| A mapped row may become a **transfer** | **Partly supported.** `CsvTransferRule` (`csv-parser.ts:43-47`) matches `payee` or `category` by case-insensitive `contains` and rewrites the row to a transfer, clearing the category (`:866-879`). It cannot match on the memo/title or the operation type, has no explicit ordering semantics beyond array order, and the UI offers only those two fields (`CsvTransferRules.tsx:63-64`). |
| A mapped row may become a **split** | **Supported downstream, unreachable from CSV.** `processSplits` already handles `split.isTransfer` + `split.transferAccount` (`import-regular-processor.service.ts:469-490`) and — the subtlety #991 flags — sets `categoryId: null` for transfer splits (`:496-499`), so a capital leg is automatically uncategorized and stays out of the spending-by-category breakdown. `CreateTransferDto.categoryId`'s doc comment (`create-transfer.dto.ts:91-97`) confirms the behaviour #991 discovered is intentional and documented. The CSV parser simply always emits `splits: []` (`csv-parser.ts:900`). **No downstream work needed for item 2 — only parser-side work.** |
| Category rules must see the **memo**, with priority, overriding the payee default | **Half supported.** No memo-matching rules exist. But the override direction is already right: the processor does `categoryId \|\| resolvedPayee.defaultCategoryId` (`import-regular-processor.service.ts:46`), so a rule-assigned category wins over `payee.defaultCategoryId`. Only the rule engine is missing. |
| Preview/diff before anything is written | **Summary only.** `ReviewStep.tsx` shows counts (transactions, categories, transfer accounts, securities) — no per-row preview of what each row becomes. `POST /import/csv/parse` (`import.controller.ts:169`) returns aggregates, not rows. |
| Tags carry card-last-4 and operation type | **Supported for a column, not for derived values.** One `tags` column index with separator auto-detection (`csv-parser.ts:74-119`, `:722`). A card number embedded in a tail fragment cannot become a tag. |
| Account number in the memo, formatted | Expressible once field extraction can compose values (P3). No dedicated work. |
| Cutoff so reconciled history is not re-processed | **Not supported.** No date bound on import. #991 works around it with a median-monthly-volume heuristic. |
| `paymentMethod` column | Deliberately absent from `transactions` (`schema.sql:255-280`). Tags stay the sanctioned answer; see §7. |

## 3. Goals and non-goals

### Goals

- Re-running any import (CSV, QIF, OFX) is safe: already-imported rows are skipped, not duplicated,
  with no client-side state and no full-table paging pass.
- `reference_number` is written by every creation path, including split transfer counterpart legs
  and auto-posted scheduled transactions.
- A saved **import profile** carries the source encoding, per-operation-type field maps, and an
  ordered rule list, and can be exported/imported as JSON so bank-specific knowledge is shareable
  user content rather than code in this repository (#822's framing).
- A mapped row can become a transfer, or a split with mixed transfer/category legs, driven by
  matches on any extracted field including the memo/title, first-match-wins with explicit order.
- A dry-run preview shows, per row, what will be created and what will be skipped, before writing.
- Every rule outcome is reachable through the existing `QifTransaction` contract; the importer,
  split service and balance logic are not touched.

### Non-goals

- No PKO BP (or any bank) specific code in the repository. The engine ships generic; PKO BP ships
  as a profile JSON in the wiki / a community profile gallery.
- No new `paymentMethod` column on `transactions`.
- No scraping or bank API connectivity. File import only.
- No arbitrary user code execution. Rules are declarative data with a fixed operator set (§7).
- Not a fuzzy "looks like the same transaction" matcher. Dedup is exact-key only; near-duplicate
  review stays a manual job.

## 4. P0 — `reference_number` on every creation path

Small, independent, worth shipping regardless of everything else. Answers #991 item 1 literally.

**T0.1 — Split transfer counterpart legs inherit the parent's reference number.**
`backend/src/transactions/transaction-split.service.ts:332` and `:578` build the counterpart
`Transaction` without `referenceNumber`. Thread the parent transaction's value into
`createSplits` / the update path and set it on the counterpart. Tests: create a split with a
transfer leg and a reference number, assert both the parent and the counterpart carry it;
assert clearing it on update clears both.

**T0.2 — Scheduled transactions carry a reference number template.**
Add `reference_number VARCHAR(100)` to `scheduled_transactions` (migration `115_*`, plus
`schema.sql`, entity, create/update DTOs with `@MaxLength(100)` + `@SanitizeHtml()`, frontend
type and form field). Posting uses `postDto?.referenceNumber ?? template.referenceNumber`
(`scheduled-transactions.service.ts:1195`, `:1305`). Tests: auto-post inherits the template
value; an explicit post override wins.

**T0.3 — Regression guard.** A spec that walks every place a `Transaction` is constructed
(`grep -n "create(Transaction"`) and asserts `referenceNumber` is among the assigned fields, so
a future write path cannot silently reintroduce the hole.

## 5. P1 — Idempotent re-import

This, not P0, is what removes the content-hash backstop. It also lifts the "fresh profile only"
restriction that `docs/future-plans/mny-import.md` §2 lists as a v1 non-goal.

**T1.1 — `import_key` column.**
Migration `116_transactions_import_key.sql`:

```sql
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS import_key VARCHAR(128);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_import_key
  ON transactions (user_id, account_id, import_key)
  WHERE import_key IS NOT NULL;
```

Mirror in `schema.sql`, add to `Transaction` entity as `importKey: string | null`. Not user
editable — no DTO field, excluded from the transaction create/update DTOs so
`forbidNonWhitelisted` rejects any client attempt to set it. It is written only by importers.
The partial unique index makes the database the final arbiter: a concurrent double-submit of the
same file fails the second insert rather than duplicating.

**T1.2 — Key derivation.** `backend/src/import/dedup/import-key.ts`:

```
importKey = sha256(
  profileId-or-format || '\x1f' ||
  externalReference   // the source's own id when present
    ?? [date, amountInTenThousandths, operationType, normalizedPayee, normalizedTitle].join('\x1f')
).slice(0, 64)
```

Deterministic, stable across runs, and independent of anything Monize assigns. Amounts enter as
integers (`Math.round(Number(amount) * 10000)`) per the financial-math rule, never as a float
string. Normalisation is documented and frozen: trim, collapse internal whitespace, casefold.
Changing normalisation later changes every key, so the key is prefixed with a version tag
(`v1:`) and the derivation module is the single place it lives.

**T1.3 — Both transfer legs and split counterparts share the row's key.** One source row is one
key, carried onto every `Transaction` the row produces. The unique index is scoped by
`account_id`, so the two legs of a transfer do not collide while a re-import of either still
finds a match.

**T1.4 — Skip on match, inside the import transaction.** In `ImportRegularProcessorService` /
`ImportInvestmentProcessorService`, before creating: look up the key set for the target account
once per import (one `SELECT import_key FROM transactions WHERE user_id = $1 AND account_id = $2
AND import_key IS NOT NULL`), and `ctx.importResult.skipped++` on a hit. The existing
counting-based transfer dedup (`import-regular-processor.service.ts:131`) stays as the fallback
for rows with no key.

**T1.5 — `skipRowsBefore`.** Optional `IsDateString` field on `ImportCsvDto` / `ImportQifDto` /
`ImportOfxDto`: rows dated before it are skipped and counted, replacing #991's median-volume
heuristic. Surfaced in the wizard as "ignore transactions before <date>", defaulted from the
target account's last reconciled date when there is one.

**T1.6 — `GET /import/keys?accountId=&since=`.** Returns `{ keys: string[] }` for external
tooling, so a script that still wants to pre-check does one cheap call instead of paging the
register. `@UseGuards(AuthGuard('jwt'))` at class level already applies; `accountId` via
`ParseUUIDPipe`; ownership derived from `req.user.id`.

**T1.7 — RLS.** All new DB access uses `withScopedDb` (`backend/src/common/db/scoped-db.ts`).
The ratchet (`backend/scripts/rls-ratchet.mjs`, baseline `injectRepository: 187`,
`createQueryRunner: 31`) fails the build on any **new** `@InjectRepository(` or
`createQueryRunner(` under `src/`, and `import.service.ts` already holds four injected repos
(`:73-79`) and two query runners (`:210`, `:1207`). The dedup service must inject `DataSource`
and get repositories from the transaction's `EntityManager`.

Tests: key stability across runs for identical input; different rows never collide; import →
re-import of the same file yields `imported: 0, skipped: N`; a transfer row re-imported does not
create a third leg; `skipRowsBefore` boundary is inclusive/exclusive as documented; concurrent
identical imports leave one row (index enforcement).

## 6. P2 — Source encoding

**T2.1 — Decode with an explicit charset.** Replace `file.text()` in
`frontend/src/hooks/useImportWizard.ts` with `new TextDecoder(encoding).decode(buffer)` over
`await file.arrayBuffer()`. `windows-1250`, `windows-1252`, `iso-8859-2`, `utf-8` and
`utf-16le` are all built into the browser's `TextDecoder` — no dependency. The wire format stays
a decoded string, so no backend contract changes.

**T2.2 — Keep the raw buffer in wizard state.** Changing the encoding must re-decode without
re-picking the file. Store the `ArrayBuffer` alongside the decoded content.

**T2.3 — Auto-detect, then let the user override.** Try `new TextDecoder('utf-8', { fatal: true })`
first; on throw, score `windows-1250` / `windows-1252` / `iso-8859-2` by counting how many
decoded bytes land in that locale's letter ranges and pick the best. Add an encoding `<select>`
on the CSV mapping step, defaulted to the detection result, re-decoding and re-previewing on
change.

**T2.4 — Mojibake warning.** #991's sharpest point is that misreading succeeds *plausibly*. On
the mapping step, warn when the decoded preview contains U+FFFD, or when the tell-tale
UTF-8-read-as-single-byte sequences (`Ã`/`Å`/`Â` immediately followed by another high
character) exceed a small threshold. A visible warning on the preview, not a blocked import.

**T2.5 — Persist the encoding in the profile** so the next month's file needs no re-picking (§7).

Tests: a WINDOWS-1250 fixture with Polish diacritics decodes to the expected payee strings;
detection picks 1250 over 1252 for a Polish fixture; UTF-8 files still detect as UTF-8;
mojibake heuristic fires on a deliberately mis-decoded fixture and not on clean text.

## 7. P3 — Import profiles with per-operation-type variants

### 7.1 Storage

Extend `import_column_mappings` rather than adding a table — it is already the saved-mapping
store, already JSONB, already has per-user unique names (`schema.sql:1208-1221`), and the
existing CRUD and UI (`import.service.ts:982+`, `CsvColumnMappingStep.tsx:561+`) carry over.
Migration `117_import_profiles.sql`:

```sql
ALTER TABLE import_column_mappings
  ADD COLUMN IF NOT EXISTS encoding VARCHAR(20) NOT NULL DEFAULT 'utf-8',
  ADD COLUMN IF NOT EXISTS variants  JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS row_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS profile_version SMALLINT NOT NULL DEFAULT 1;
```

Existing saved mappings keep working untouched: empty `variants` means "use `column_mappings`
for every row", which is exactly today's behaviour.

### 7.2 Variants

A variant is a discriminator plus a field map:

```jsonc
{
  "discriminator": { "column": 2 },              // operation type column
  "variants": [
    {
      "name": "Card payment",
      "match": { "op": "startsWith", "value": "Zakup przy użyciu karty" },
      "fields": {
        "payee":  { "from": "label", "label": "Lokalizacja" },
        "memo":   { "from": "concat", "parts": [
                      { "from": "label", "label": "Oryginalna kwota operacji" },
                      { "from": "literal", "value": " card " },
                      { "from": "regex", "source": { "from": "label", "label": "Numer karty" },
                        "pattern": "(\\d{4})$", "group": 1 } ] },
        "tags":   [ { "from": "regex", "source": { "from": "label", "label": "Numer karty" },
                     "pattern": "(\\d{4})$", "group": 1 },
                    { "from": "literal", "value": "Karta" } ]
      }
    },
    { "name": "Fees", "match": { "op": "contains", "value": "Opłata" },
      "fields": { "payee": { "from": "literal", "value": "PKO BP fees" } } }
  ]
}
```

Extractor kinds, which between them cover all six payee derivations in #991 with no
bank-specific code:

| `from` | Source |
|---|---|
| `column` | positional column by index (today's behaviour) |
| `label` | a `Label: value` fragment in the row tail |
| `regex` | a capture group over another extractor's output |
| `literal` | a constant (the synthetic payee for fees) |
| `coalesce` | first non-empty of a list (`Nazwa odbiorcy` or `Nazwa nadawcy`) |
| `concat` | joined list (account number formatted into the memo) |

The tail parser is its own small module: split the post-positional cells, recognise
`Label: value` (the label set is data, not code), and expose a case-insensitive label lookup.
Cells that are not `Label: value` are collected under a reserved `_tail` key so a `regex`
extractor can still reach them. Variant resolution is first-match-wins with an optional
`default` variant; a row matching nothing and having no default is reported as an unmapped row
in the preview rather than silently dropped (today, an unparseable date just `continue`s —
`csv-parser.ts:734-738`).

### 7.3 Profile export/import

`GET /import/profiles/:id/export` → the profile JSON; `POST /import/profiles/import` → validate
and store under a new name. This is what makes "here is my PKO BP profile" a shareable artifact
and keeps §3's no-bank-code-in-repo goal honest. Export must strip `id`/`user_id`/timestamps.

### 7.4 Code layout

Per the many-small-files rule (`csv-parser.ts` is already 927 lines):

```
backend/src/import/profile/
  import-profile.types.ts     # discriminated unions for extractors, matchers, rules
  import-profile.dto.ts       # class-validator DTOs mirroring the types
  row-tail-parser.ts          # positional cells + Label: value fragments
  field-extractor.ts          # the six `from` kinds
  variant-resolver.ts         # discriminator -> variant, default handling
  csv-profile-parser.ts       # orchestration: rows -> QifTransaction[]
backend/src/import/dedup/
  import-key.ts
  import-dedup.service.ts
```

## 8. P4 — Row rules

An ordered array, first match wins, evaluated against the **extracted** fields (so it can see
the memo/title, the operation type, the derived payee, the amount sign — everything #991 needs):

```jsonc
"row_rules": [
  { "name": "IKE contributions -> transfer",
    "when": { "field": "payee", "op": "contains", "value": "Dom Maklerski" },
    "then": { "type": "transfer", "account": "IKE cash" } },

  { "name": "Mortgage repayment -> split",
    "when": { "field": "memo", "op": "regex", "pattern": "KAPITAŁ:\\s*([\\d.,]+).*ODSETKI:\\s*([\\d.,]+)" },
    "then": { "type": "split", "legs": [
        { "amount": { "from": "match", "group": 1 }, "target": { "transfer": "Mortgage" } },
        { "amount": { "from": "match", "group": 2 }, "target": { "category": "Home:Mortgage interest" } } ] } },

  { "name": "Overtime",  "when": { "field": "memo", "op": "regex", "pattern": "(?i)nadgodzin" },
    "then": { "type": "category", "category": "Income:Overtime" } },
  { "name": "Salary",    "when": { "field": "payee", "op": "contains", "value": "ACME" },
    "then": { "type": "category", "category": "Income:Salary" } },

  { "name": "Operation-type tag", "continue": true,
    "then": { "type": "tag", "tags": [ { "from": "variant", "property": "name" } ] } }
]
```

Semantics to nail down in tests, because they are where this silently goes wrong:

- **Order matters and is explicit.** Overtime before the generic salary rule. First match ends
  evaluation unless the rule sets `continue: true` (tag rules, which accumulate).
- **A rule category beats `payee.defaultCategoryId`.** Already true downstream
  (`import-regular-processor.service.ts:46`) — cover it with a test so it stays true.
- **Split legs must sum exactly to the row amount.** Parse leg amounts to integer
  ten-thousandths, sum, and assign any remainder to the last leg. An overpayment row where both
  parts are non-zero splits into both legs; a row where one part is zero produces a single-leg
  split, which the engine collapses back to a plain transfer or expense rather than writing a
  degenerate split.
- **Transfer legs stay uncategorized.** Guaranteed by `processSplits`
  (`import-regular-processor.service.ts:496-499`); assert it end-to-end so the capital leg never
  reappears in the spending-by-category breakdown.
- **`transfer` clears the category**, matching the existing `CsvTransferRule` behaviour
  (`csv-parser.ts:875`).
- Existing `transferRules` are migrated in place: a `{type, pattern, accountName}` triple is
  read as `{when: {field: type, op: 'contains', value: pattern}, then: {type: 'transfer',
  account: accountName}}`, so no saved mapping breaks and the old UI keeps editing them.

### Security: rules are user-supplied patterns

- **ReDoS.** This codebase already refuses regex for user patterns where it can — payee alias
  globs use iterative matching explicitly "to avoid ReDoS risks"
  (`import-regular-processor.service.ts:383-405`). So: `contains` / `startsWith` / `endsWith` /
  `equals` / `glob` are the default operators and use the same iterative matcher; `regex` is
  opt-in and constrained — pattern length ≤ 200, a validator rejecting nested quantifiers and
  large bounded repeats, input truncated to 500 characters before matching (mirroring
  `:387`), and a per-import step budget that aborts the import with a clear error rather than
  hanging a worker. Compile each pattern once per import, not once per row.
- **DTO shape.** `forbidNonWhitelisted: true` is global, so the profile payload must be fully
  typed — nested `@ValidateNested()` discriminated unions via `@Type(() => X, { discriminator })`,
  not `Record<string, unknown>`. `@MaxLength` on every string, `@ArrayMaxSize` on every array
  (50 rules, 30 variants, 20 legs, matching the existing `ArrayMaxSize(50)` on `transferRules`),
  bounded recursion depth on `concat`/`coalesce` nesting (≤ 3).
- **Sanitisation.** `@SanitizeHtml()` on every user-facing string that can reach a stored field
  (rule names, literals, category and account names), same as `CsvTransferRuleDto`
  (`import.dto.ts:692-708`). Extracted values continue through the existing `truncate()`/
  `stripHtml()` path in the parser (`csv-parser.ts:230-240`).
- Category and account names in rules resolve through the **existing** category/account mapping
  steps, so a rule cannot create an entity the user never confirmed.

## 9. P5 — Preview

**T5.1 — `POST /import/csv/preview`.** Same body as `POST /import/csv` plus a page/limit. Runs
the whole pipeline including rule evaluation and dedup lookup, writes nothing, and returns per
row: source line number, resolved variant name, matched rule name, outcome
(`expense | income | transfer | split | skipped-duplicate | skipped-before-cutoff | unmapped`),
payee, category, tags, split legs, and the computed import key. Reuse
`previewCreateTransfer`-style resolution (`transaction-transfer.service.ts:307`) where it fits.

**T5.2 — A `csvPreview` wizard step** between mapping and review, with a per-outcome filter and
counts. Dry run is the *default path* — you reach Import from the preview, matching #991's
"nothing is written without `--apply`".

**T5.3 — Warnings surfaced from the preview**: unmapped rows, unparseable dates, rows whose
split legs did not sum, mojibake suspicion. Feed them into `ImportResultDto.warnings`, which
already exists (`import.dto.ts:365-370`).

## 10. Sequencing and independence

| Phase | Ships value alone | Depends on |
|---|---|---|
| P0 `reference_number` everywhere | yes | — |
| P1 idempotent re-import | yes — biggest single win, all formats | — |
| P2 encoding | yes — fixes silent corruption today | — |
| P3 profiles + variants | yes — makes the file parseable at all | P2 (encoding lives in the profile) |
| P4 row rules | yes | P3 (rules match extracted fields) |
| P5 preview | yes | P3, P4 to be worth much; useful after P1 alone |

P0, P1 and P2 are small and independent; ship them first. P3 is the large one. P4 without P3 is
possible (rules over flat column maps) but the interesting rules need extracted fields.

## 11. Testing

Per the always-test rule, and because backend coverage gates at 95% lines / 85% branches
(frontend 91% / 85%):

- **Unit, backend.** Each extractor kind; tail parsing of `Label: value` including duplicate and
  missing labels; variant resolution including default and no-match; rule ordering and
  `continue`; split leg integer arithmetic and remainder assignment; single-leg collapse;
  import-key stability and collision behaviour; ReDoS validator rejecting known-bad patterns;
  encoding detection scoring.
- **Service, backend.** `importCsvFile` with a profile end-to-end asserting the resulting
  `Transaction` / `TransactionSplit` rows, including that a transfer split leg has
  `category_id IS NULL`; re-import yields `imported: 0`; `skipRowsBefore`; preview writes nothing
  (assert no rows and no balance change).
- **Frontend.** Encoding select re-decodes without re-picking; mojibake warning renders; preview
  step filters and counts; profile save/load/export/import round-trip preserves variants and
  rules; the legacy transfer-rules UI still edits a migrated profile.
- **E2E.** An anonymised WINDOWS-1250 fixture with the PKO BP shape — card payment, ATM
  withdrawal, fee, outgoing and incoming transfer, standing order, a mortgage row with
  `KAPITAŁ`/`ODSETKI`, and an overpayment row — imported through the wizard, then re-imported,
  asserting zero new transactions and unchanged balances. #991 offers real exports and testing
  against them; the committed fixture must be anonymised.

## 12. What is deliberately left out, and why

- **A PKO BP profile in this repository.** The engine is general; the profile is user content.
  Ship it in the wiki alongside the existing "Importing from Microsoft Money" / "from Quicken"
  pages that `UploadStep.tsx:13-14` already links to.
- **Fuzzy duplicate matching.** Exact-key only. A near-duplicate reviewer is a separate feature.
- **`paymentMethod`.** Tags with derived values (P3/P4) give "how much did each of us spend on
  cards" without a schema change, which is what #991 actually asked for.
- **AI-assisted profile authoring.** Plausible as a later layer — describe your bank's export,
  get a candidate profile JSON, review it in the preview — and it fits #822's "AI as a one-time
  compiler, deterministic execution afterwards" exactly. Out of scope here: the profile format
  and the preview step are the prerequisites, and both must stand on their own first.
