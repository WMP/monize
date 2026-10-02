# Report breakdown by tag key

Approved specification for letting the built-in reports optionally break their
figures down by the VALUE of a single `KEY:VALUE` tag key (e.g. `scope`), and
for making tagged transfers visible in that breakdown without turning a transfer
into income. Written before the implementation, per
`docs/financial-calculation-contract.md` section 9.

Approved to build: discussion
[kenlasko/monize#1381](https://github.com/kenlasko/monize/discussions/1381)
(`approved-to-build`). The tag primitive, the `KEY:VALUE` naming convention
(`backend/src/tags/tag-key-value.util.ts`, `frontend/src/lib/tag-key-value.ts`),
the tag-key filter clause (`backend/src/transactions/tag-key-filter.util.ts`) and
the value-aggregation precedent
(`TransactionAnalyticsService.getTransactionBreakdownByTagKey`) all already
exist; this feature wires a tag-key dimension into the built-in reports and adds
the transfer-visibility rule.

## 0. Why a tag, not a redefinition of income

The reporter is retired and funds daily life by moving money out of registered /
investment accounts into a checking account. Those movements are transfers, so
"Income vs Expenses" shows zero income against real expenses. The rejected fix
was to reclassify the withdrawal as income: a salary of 100 that is invested and
later withdrawn would then read as 200 of income (the maintainer's
counterexample). The accepted fix keeps categories describing financial meaning
and adds tags describing flow/context: the withdrawal stays a transfer, is
tagged (e.g. `scope:household`), and the report gains an opt-in view that slices
by tag value and shows tagged transfer flows **as their own figure, never folded
into income**.

## 1. The dimension

A report gains one optional query parameter, `tagKey` (a bare tag key such as
`scope`). Its presence is the only switch:

- **`tagKey` absent -> the report is byte-for-byte what it is today.** No new
  rows, no new fields, no changed numbers. This is a mechanical guard
  (section 9), not a claim.
- **`tagKey` present -> the report returns the same answer partitioned by the
  values of that key**, plus the tagged-transfer figure defined in section 3.

Tag keys are discovered client-side from `GET /tags` via `collectTagKeys`
(already how `CategoryTagBreakdownPanel` populates its selector); no new
discovery endpoint is added. The server treats `tagKey` as an opaque,
case-insensitive key string and never trusts a client-supplied value list.

### 1.1 Value buckets

For key `K`, every base row is attributed to the value(s) of its own `K:<value>`
tags, parsed by the same SQL the filter clause uses
(`POSITION(':' IN name) > 1`, key = `SPLIT_PART(name,':',1)` trimmed, value =
text after the first colon trimmed, non-empty). Rules:

| # | Rule |
|---|---|
| B1 | A row tagged `K:v` contributes to bucket `v`. A row carrying two `K:*` tags (`K:a`, `K:b`) contributes to **both** `a` and `b`; per-value shares therefore can sum past 100%, exactly as `getTransactionBreakdownByTagKey` already documents. This is disclosed in the UI, not silently summed into a misleading total. |
| B2 | A row with no `K:*` tag contributes to a single reserved bucket, the **untagged** bucket (stable id, not a value a user can create; see section 6 for its label). |
| B3 | The **All** bucket is the report computed over the same base rows with no tag partition. `All` equals today's report exactly (it is the same query without the tag join); it is the reconciliation anchor, not the sum of the value buckets (which double-count multi-valued rows). |
| B4 | Attribution reads BOTH transaction-level tags (`transaction_tags`) and split-level tags (`transaction_split_tags`), matching `buildTagKeyFilterClause`; a split-level tag attributes that split's own amount, a transaction-level tag attributes the reportable amount of the whole transaction. A tag present at both levels attributes once (no leg is counted twice). |

## 2. Invariants

| # | Invariant |
|---|---|
| I1 | **Opt-in is inert by default.** With no `tagKey`, every built-in report in scope returns a response deep-equal to its pre-feature response for the same inputs. Guarded by a snapshot/parity spec per report (section 9). |
| I2 | **A tagged transfer is never income, an expense, or net.** In every value bucket and in All, `income`, `expenses` and `net` are computed from exactly today's base rows (categorized cash, transfers excluded). Tagged transfer flows are a separate, separately-named figure (`taggedInflows` / `taggedOutflows`) and are never added into income, expenses or net. INV-REPORT-003. |
| I3 | **Each leg counts once, under its own tags.** A transfer leg contributes to `taggedInflows[v]` if its reportable amount is > 0 and it carries `K:v`, to `taggedOutflows[v]` if < 0, under each value `v` of its own `K:*` tags. The two legs of one transfer are two rows; each is judged on its own tags and sign. No leg is counted in two buckets of the same value, and the parent/leg dedupe of B4 applies. |
| I4 | **The completeness model is preserved per bucket.** Each bucket keeps the existing FX-completeness discipline: a value converted through a missing rate is excluded, `missingCurrencies` lists the offending codes, `excludedCount` counts the excluded aggregate rows, and a bucket's `totals` are `null` while that bucket is incomplete (`knownIncome`/`knownExpenses`/`knownNet` still carry the partial). Completeness is per bucket; one incomplete value does not blank another. `docs/financial-calculation-contract.md` s.1.3. |
| I5 | **Investment linkage exclusion is unchanged.** `investmentExclusionSql` / `reportableTransactionAmountSql` still decide investment membership on every base row and every transfer-flow row; the tag dimension never reintroduces a brokerage sleeve or an investment cash leg. INV-REPORT-001. |
| I6 | **VOID rows never contribute**, to any bucket or to tagged flows (`status != 'VOID'` stays on every branch). A VOID tagged transfer moves no money and appears nowhere. INV-TRANSFER-001. |
| I7 | **The tag clause does not inflate aggregates.** Split-tag matching keys on `transaction.id` (as `buildTagKeyFilterClause` does), so joining the tag dimension into a `GROUP BY` query never multiplies a row's amount by its split or tag count. Guarded by a fan-out numeric test (a transaction with two matching split tags is not double-summed). |

### INV-REPORT-003 (new)

```text
Statement   A transfer appears in a report only under an explicit tag-key
            breakdown (tagKey set), only in a dedicated tagged-flows figure
            (taggedInflows / taggedOutflows), and never in the report's income,
            expenses or net. Without tagKey, every report excludes transfers
            exactly as before.
Mechanism   The transfer-flow subquery is emitted only when tagKey is present
            and writes only the taggedInflows/taggedOutflows fields; the
            income/expenses SQL keeps is_transfer = false and the split
            transfer-leg exclusion on every branch. A parity spec proves the
            no-tagKey response is unchanged; a numeric spec proves a tagged
            transfer lands in taggedInflows and not in income.
Status      enforced (once this feature ships)
```

## 3. Tagged transfer flows (Income vs Expenses / Cash Flow only)

Only the income/expense reports carry a transfer-flow figure; the
category-oriented reports (Spending by Category, Income by Source) have no
transfer rows to show, so they gain only value partitioning (section 5).

When `tagKey=K` is set, `getIncomeVsExpenses` additionally computes, per period
bucket and per value `v`:

- `taggedInflows[v]`  = SUM over transfer legs where the reportable amount > 0,
  the leg (or its parent) carries `K:v`, the leg is not VOID, and it is not an
  investment linkage row.
- `taggedOutflows[v]` = SUM over the same population where the reportable
  amount < 0, taken as a positive magnitude.

A transfer leg here is a row with `is_transfer = true` (parent) or a split with
`transfer_account_id IS NOT NULL`; the reportable amount is the leg's own signed
amount (destination legs are positive, source legs negative). These figures ride
the SAME per-currency conversion and completeness path as income/expenses, so a
missing rate blanks the bucket's totals (I4) rather than silently dropping a
flow.

### 3.1 Truth table -- one self-transfer, both legs tagged `scope:household`

RRSP cash sleeve (ordinary cash) -> Checking, 1,000, both legs tagged
`scope:household`, `tagKey=scope`, value bucket `household`:

| Figure | Value | Why |
|---|---|---|
| `income` (household, All) | +0 | A transfer is never income (I2). |
| `expenses` (household, All) | +0 | A transfer is never an expense (I2). |
| `net` | 0 | Unchanged from today. |
| `taggedInflows[household]` | +1,000 | The Checking leg is a positive transfer leg tagged `scope:household` (I3). |
| `taggedOutflows[household]` | +1,000 | The RRSP-sleeve leg is a negative transfer leg tagged `scope:household` (I3). |

The reader sees, under `household`, that 1,000 flowed in and 1,000 flowed out --
the honest picture. It does not read as 1,000 (or 2,000) of income. The UI
mirrors a transfer's tags onto BOTH legs (`syncTransferTags` in
`backend/src/transactions/transaction-bulk-update.service.ts`, and the rules
applier), so a user cannot tag only the destination leg. The way to see one side
is the account filter of section 10: scoping the report to the destination
account leaves only that account's leg in the figure. The report reflects
whatever is tagged inside the chosen accounts and never invents a one-sided
number the tags do not assert.

### 3.2 Truth table -- the maintainer's double-count case

Salary 100 categorized Income (not a transfer); later moved to a brokerage
(transfer, tagged `scope:household`); later withdrawn to Checking (transfer,
tagged `scope:household`). `tagKey=scope`, bucket `household`:

| Figure | Value |
|---|---|
| `income[household]` | +100 (the salary only; both transfers are excluded from income) |
| `taggedInflows[household]` | +100 (the withdrawal-into-Checking leg) plus the brokerage-side inflow leg if tagged |
| `taggedOutflows[household]` | the matching outflow legs |

`income` is 100, never 200. The transfers are visible as flows, distinct from
the one real 100 of income. This is I2 made concrete.

## 4. Response shape

The report responses gain an optional, additive breakdown. The existing
top-level fields are unchanged and continue to describe the **All** bucket, so an
old client ignores the new field and still renders today's report.

```jsonc
// IncomeVsExpensesResponse (additive fields only)
{
  "data": [ /* All bucket periods, exactly as today */ ],
  "totals": { /* All bucket, as today */ },
  "currency": "USD",
  "missingCurrencies": [],
  "excludedCount": 0,

  // present ONLY when tagKey was supplied:
  "tagKey": "scope",
  "buckets": [
    {
      "value": "household",          // or the reserved untagged id for B2
      "isUntagged": false,
      "data": [ /* IncomeExpensePeriodItem[] for this value */ ],
      "totals": { /* same shape as top-level totals, per bucket (I4) */ },
      "taggedInflows": 1000.0,       // Income vs Expenses / Cash Flow only
      "taggedOutflows": 1000.0,
      "missingCurrencies": [],
      "excludedCount": 0
    }
    // ... one per discovered value, plus the untagged bucket
  ]
}
```

For Spending by Category / Income by Source the per-bucket payload carries that
report's own item array (`data`) and total, and no `taggedInflows`/`Outflows`.
The exact TypeScript types live beside each report's existing response type in
`backend/src/built-in-reports/dto/` and are mirrored in
`frontend/src/types/built-in-reports.ts`.

## 5. Per-report scope and SQL hook points

| Report | Endpoint / service | Tag dimension | Transfer flows |
|---|---|---|---|
| Income vs Expenses | `income-reports.service.ts:getIncomeVsExpenses` | value partition | yes (section 3) |
| Cash Flow | same service (`built-in-reports.controller.ts:120`) | value partition | yes |
| Spending by Category | `spending-reports.service.ts:getSpendingByCategory` | value partition | no |
| Income by Source | `income-reports.service.ts:getIncomeBySource` | value partition | no |
| Budget vs Actual | budgets module `BudgetReportsService` | **deferred** (section 8) | n/a |

Value partitioning is implemented by adding the tag key/value to the `GROUP BY`
(the `getTransactionBreakdownByTagKey` shape: `innerJoin transaction.tags`,
`POSITION(':' ...) > 1`, `LOWER(SPLIT_PART(...)) = LOWER(:key)`, group by the
trimmed value expression) for the value buckets, computed alongside the untagged
and All aggregates in the same request. Reuse the existing value/key SQL
expressions rather than re-spelling them; the split-level branch mirrors
`buildTagKeyFilterClause`'s `transaction_split_tags` subquery so split tags are
honoured (B4) without row inflation (I7).

## 6. Frontend

- **Control.** Each report component's controls card
  (`IncomeVsExpensesReport.tsx:311`, and siblings) gains a "Break down by tag
  key" `Select`, populated by `collectTagKeys(tags.map(t => t.name))` and hidden
  when the user has no `KEY:VALUE` tags (the `CategoryTagBreakdownPanel`
  precedent). The default option is "None", which sends no `tagKey` and renders
  today's report.
- **Rendering.** When a key is chosen, the report shows the value buckets. Reuse
  the existing tabs/series patterns; the untagged bucket is labelled from i18n
  (`reports.tagBreakdown.untagged`), never shown as an empty string. Tagged
  flows render as a distinct, clearly-labelled pair (`taggedInflows` /
  `taggedOutflows`), visually separated from the income/expenses bars so no
  reader mistakes them for income.
- **Disclosure.** Where multi-valued rows can push shares past 100%, the UI
  states it (reuse the existing breakdown-chart disclosure copy).
- **API client.** `frontend/src/lib/built-in-reports.ts` adds the `tagKey`
  param the same way it already special-cases `accountIds`.
- Completeness (`missingCurrencies`, incomplete `totals === null`) is surfaced
  per bucket using the components the reports already use for the All figure.
- **Account scope and the funding series (section 10).** Income vs Expenses
  gains the shared `ReportAccountMultiSelect` (empty = all accounts) and, when a
  non-untagged bucket is active, two indigo bar series on the main chart (and
  two table columns) read from that bucket's per-period flows.
  `TagKeyBreakdownBuckets` can be controlled (`activeValue` /
  `onActiveValueChange`) so the report owns which bucket the chart follows;
  Cash Flow keeps the uncontrolled default.

## 7. i18n

New keys under the `reports` namespace (English-first, then
`npm run i18n:pseudo`, then every locale as the final commit):
`reports.tagBreakdown.label` (control), `reports.tagBreakdown.none`,
`reports.tagBreakdown.untagged`, `reports.tagBreakdown.inflows`,
`reports.tagBreakdown.outflows`, `reports.tagBreakdown.sharesExceedNote`. Locale
lists in `frontend/src/i18n/config.ts` and `backend/src/i18n/config.ts` stay in
sync; no backend-composed copy is added (reports are request-scoped).

## 8. Out of scope (recorded so absence reads as a decision)

- **Budget vs Actual** breakdown: it is budget-period + category based in a
  different module; a tag dimension there is a separate change, deferred to a
  later phase.
- **The rules engine** (auto-adding tags by condition): explicitly NOT in scope
  by owner decision. Tags are applied manually (the transaction form's existing
  tag MultiSelect); this feature never auto-writes a tag.
- **Split-level tag editing UI**: the backend M2M exists and this report reads
  split tags (B4); exposing a split-tag editor in the form is a separate change.
- Persisting a chosen `tagKey` as a saved report preference.
- A `tagValue` single-select filter (the breakdown returns all values at once;
  narrowing to one value is a client concern for now).

## 9. Test matrix

From `docs/testing-contract.md`. String/date classes are N/A beyond the existing
date-window boundaries; the adversarial classes here are the double-count guard,
the FX-completeness-per-bucket guard, and the no-tagKey parity guard.

Backend (unit + integration, real PostgreSQL for the SQL):

- **Parity (I1):** for each report in scope, the response with no `tagKey` is
  deep-equal to the pre-feature response over the same fixture. This is the guard
  that "default behaves exactly as today".
- **Value partition (B1-B4):** a fixture with rows under `scope:household`,
  `scope:stall`, one row under both, and untagged rows; assert each value bucket,
  the untagged bucket, and that All equals the un-partitioned report; assert the
  multi-valued row appears in both value buckets (shares > 100% is expected).
- **Split-tag attribution (B4, I7):** a split transaction whose two split lines
  carry different `scope:*` tags attributes each line's amount to its value; a
  transaction with two matching split tags is summed once (no fan-out).
- **Transfer visibility (I2, I3, section 3.1/3.2):** the self-transfer truth
  table (both legs tagged) lands +inflow and +outflow under `household` and adds
  nothing to income/expenses/net; the double-count case yields income 100 not
  200; an untagged transfer appears nowhere.
- **VOID (I6):** a VOID tagged transfer contributes to no bucket and no flow.
- **Investment linkage (I5):** an investment cash leg tagged `scope:*` is still
  excluded; a salary deposit into an INVESTMENT-type cash sleeve still counts
  (issue #1257 regression stays green).
- **FX completeness per bucket (I4):** one value bucket with a missing-rate
  currency reports `totals === null` and lists the code, while another value
  bucket with only convertible rows reports complete totals.

Frontend:

- The key selector is hidden with no `KEY:VALUE` tags, shows keys otherwise, and
  "None" renders today's report (no `tagKey` sent).
- Choosing a key renders value buckets and the untagged bucket with its i18n
  label; tagged flows render as a distinct labelled pair, not as income bars.
- An incomplete bucket shows the existing missing-rate treatment.

E2E (Playwright): a smoke path that tags two transactions under a `scope` key,
opens Income vs Expenses, switches "Break down by tag key" to `scope`, and sees
the value tabs and a tagged-transfer flow figure.

## 10. Account scope and the funding series (Phase 1b)

### 10.1 Motivation

The reporter funds living costs by transferring from an RRSP to Checking and
tags the transfer `scope:household`. With "Break down by tag key = scope" the
Household tab showed income 0, expenses 0, tagged inflows 7,066 and tagged
outflows 7,066 (the tags are mirrored onto both legs, so both legs count), and
the main chart did not change. He could not see the funding next to the expenses
it pays for. Two additive fixes, called C and B.

### 10.2 C -- account filter on the Income vs Expenses page

`GET /built-in-reports/income-vs-expenses` already accepts `accountIds` and
applies it to the base query and to every tag-key query (value, whole-transfer
flow, split-transfer flow), and the frontend client already serialises it. The
page never sent it. C adds a `ReportAccountMultiSelect` to the report (same
non-investment account list as the dashboard widget); an empty selection means
all accounts, today's behaviour. No backend change is needed for C.

With the Checking account selected, the transfer's investment-side leg is
outside the filter, so only the Checking leg is counted: tagged inflows 7,066
and tagged outflows 0. This is how a one-sided view is obtained (section 3.1).

**Decision: Cash Flow does not get the filter.** `CashFlowReport` also reads
`getIncomeBySource`, which takes no `accountIds`; a filter there would scope
half of the page and leave the other half unfiltered, an inconsistent report.
Extending `getIncomeBySource` is a separate change. Recorded so the absence
reads as a decision.

### 10.3 B -- tagged flows per period

`IncomeExpenseTagBucket.data` becomes `IncomeExpenseTagPeriodItem[]`, where
`IncomeExpenseTagPeriodItem extends IncomeExpensePeriodItem` adds
`taggedInflows: number` and `taggedOutflows: number` (additive; the top-level
`data` and `totals` keep the plain `IncomeExpensePeriodItem`).

```jsonc
// buckets[i].data[j]
{ "period": "2026-03", "periodStart": "2026-03-01", "periodEnd": "2026-03-31",
  "income": 0, "expenses": 0, "net": 0,
  "taggedInflows": 7066, "taggedOutflows": 7066 }
```

Both transfer-flow queries (whole transfer, split transfer leg) additionally
group by the period start, using the same `bucketStartSql` expression and week
offset as the value query. Every period of the window has a row, zero when
nothing happened, aligned with the bucket's existing `data` periods. When the
request has no start date, a period that only a flow touched is kept as an extra
row so the periods still sum to the window figure.

Invariants:

| # | Invariant |
|---|---|
| I8 | **Per-period flows sum to the window figure.** `taggedInflows` / `taggedOutflows` on the bucket are the integer-cent sum (`sumMoney`) of the per-period values, never a separately computed number. |
| I9 | **FX completeness per period.** A flow row converts through `tryConvertAmount`. A missing rate leaves that row out of its period, adds the currency to `missingCurrencies`, counts it in `excludedCount` and blanks the bucket's `totals` (I4); the other periods keep their flows. |
| I1, I2 | Unchanged. No `tagKey` returns today's response deep-equal; top-level `data` and `totals` (All) are unchanged; tagged flows are never added to `income`, `expenses` or `net` in any period (INV-REPORT-003). VOID (I6) and investment exclusion (I5) stay on both flow queries. |

### 10.4 Truth table -- RRSP cash -> Checking 7,066, both legs `scope:household`

| Figure | (a) no `accountIds` | (b) `accountIds=[Checking]` |
|---|---|---|
| `taggedInflows[household]` | 7,066 (Checking leg) | 7,066 |
| `taggedOutflows[household]` | 7,066 (RRSP leg) | 0 (RRSP leg outside the filter) |
| `income`, `expenses`, `net` (All and household) | unchanged | unchanged |

Two transfers in two months land in their own two periods; a month between them
carries zero flows.

### 10.5 Frontend rendering of B

When `tagKey` is set and the active bucket is not the untagged bucket, the main
chart adds two bar series from that bucket's per-period flows, labelled with the
value ("Tagged inflows: household"), in the indigo pair
`TagKeyBreakdownBuckets` already uses, never green or red. Savings bars and the
savings rate stay income minus expenses. The table view gets the same two
columns under the same condition; the tooltip shows them. With `tagKey` unset or
the untagged tab active there is no series.

### 10.6 Tests

Backend: per-period flows (two transfers, zero period, sums equal totals),
`accountIds` with `tagKey` (destination only: inflow counted, outflow 0, income
0), FX-missing per period, no-`tagKey` parity, VOID still excluded; the same
cases against PostgreSQL in the integration suite. Frontend: the account select
sends `accountIds`; series only with `tagKey` and a non-untagged tab; savings
unchanged by flows; `TagKeyBreakdownBuckets` controlled mode.
