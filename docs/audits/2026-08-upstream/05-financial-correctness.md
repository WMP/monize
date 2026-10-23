# Monize Read-Only Audit - Phase 5: Financial Correctness

## Report metadata

| Field | Value |
|---|---|
| Repository | `kenlasko/monize` |
| Audit phase | Phase 5 - Financial Correctness |
| Worker chat | Phase 5 worker chat |
| Audited baseline | `d5cea9bfa995885ba5198f9843359362927c0fd4` |
| Baseline variable | `AUDIT_BASELINE_SHA=d5cea9bfa995885ba5198f9843359362927c0fd4` |
| Access mode | Read-only, SHA-pinned GitHub connector reads |
| Report file | `monize-audit-05-financial-correctness.md` |
| Completion status | Complete with material connector and runtime limitations |

## Executive summary

This phase confirmed **13 financial-correctness defects** at the immutable baseline:

| Severity | Count |
|---|---:|
| BLOCKER | 0 |
| HIGH | 4 |
| MEDIUM | 9 |
| LOW | 0 |

The four HIGH findings are:

1. Transfer `VOID` handling can move money while the ledger says that both legs are void, or can void only one transfer leg.
2. Transfer currency and destination amounts are client-authoritative; scheduled and split transfers can post cross-currency value at 1:1.
3. Net-worth and portfolio conversion silently treat a missing exchange rate as 1:1.
4. Historical net-worth replay adds a stock-split ratio as shares instead of multiplying the position by the ratio.

The nine MEDIUM findings cover transaction currency/account mismatch, mixed-sign splits, zero investment FX rates, acquisition commissions omitted from cost basis, transfer-split budget omissions, final-loan-payment failure, simulation valuation failure being converted to zero, stale linked-account snapshots after bulk deletion, and foreign-security transfers that reset account-currency cost basis to an implied 1:1 rate.

No BLOCKER was assigned. The baseline was stable and fetchable, and no evidence showed broad irreversible corruption across all users or all financial records. The confirmed HIGH findings are nevertheless capable of materially misreporting balances, net worth, or investment basis in realistic workflows.

No repository files, branches, commits, pull requests, issues, reviews, labels, settings, databases, or deployed environments were changed. No unit, integration, database, provider, build, or runtime test was executed because repository cloning and runtime access were unavailable. Findings are static, cross-layer confirmations against the pinned SHA.

---

## 1. Phase scope

The review followed material financial behavior through the applicable path:

```text
controller
-> DTO
-> service
-> scoped transaction
-> query/entity
-> migration/schema
-> API type
-> frontend adapter or component
-> tests
```

The review covered:

- transaction signs, current/future inclusion, `VOID`, reconciliation, transfer pairing, and bulk mutation;
- foreign-currency direction, original amount, destination amount, transaction-level and investment FX;
- split arithmetic, transfer splits, investment splits, tags, and rounding;
- investment actions, cash effects, holdings, average cost, cost basis, realized gain, transfers, and stock splits;
- current and historical prices, adjusted prices, missing prices, stale rates, and net worth;
- scheduled transactions, overrides, scheduled transfers, scheduled investments, and loan payments;
- Microsoft Money and regular import arithmetic and verification paths;
- budgets, loan/mortgage allocation, net-worth snapshots, reports, and Monte Carlo simulations;
- backup/restore field coverage where it affects financial meaning;
- frontend types and components that transform or render signed amounts, FX, holdings, budgets, net worth, and simulation values.

The audit intentionally did not report generic accounting preferences. A confirmed finding required a repository-supported invariant, a realistic path, and a concrete numerical consequence.

---

## 2. Audited baseline SHA

The authoritative baseline for this phase is:

```text
d5cea9bfa995885ba5198f9843359362927c0fd4
```

The commit object was fetched successfully before implementation review. Every file used as evidence was then re-fetched with:

```text
ref=d5cea9bfa995885ba5198f9843359362927c0fd4
```

Search results were used only to discover paths. Search links often resolved to a newer branch head and were never accepted as evidence until the file was re-fetched at the baseline SHA.

---

## 3. Method

### 3.1 Repository instruction hierarchy

The following hierarchy was applied, from broadest to most specific:

1. Project audit instructions supplied for this phase.
2. Root `CLAUDE.md`.
3. Scoped instructions:
   - `backend/CLAUDE.md`
   - `database/CLAUDE.md`
   - `frontend/CLAUDE.md`
   - `backend/src/mcp/CLAUDE.md` where MCP surfaces were relevant.
4. Auxiliary guidance, treated as potentially stale when it conflicted with scoped instructions:
   - `.claude/settings.json`
   - `.claude/skills/backend.md`
   - `.claude/skills/frontend.md`
   - `.claude/skills/infrastructure.md`
   - `CONTRIBUTING.md`
   - `SECURITY.md`
5. Product and subsystem documentation, including `README.md`, Microsoft Money import documentation, and backup code comments.

No `AGENTS.md` was located by connector search. Because an immutable recursive tree listing was unavailable, repository-wide absence was not proven.

The implementation-relevant instruction invariants included:

- money storage uses four decimal places where applicable;
- multi-row financial mutations must be atomic;
- balance changes must not be separated from their ledger mutation;
- database access must use the scoped database context;
- frontend code must preserve API semantics rather than inventing a second financial convention.

### 3.2 Evidence standard

A defect was confirmed only when all of the following were available:

- a concrete executable code path at the baseline;
- a violated financial invariant or an internal contract contradiction;
- a realistic input scenario;
- an implementation result derived from the code;
- an expected result supported by another authoritative path, a documented contract, or conservation arithmetic;
- an exact monetary, quantity, rate, or percentage difference;
- no test or adjacent implementation that invalidated the scenario.

### 3.3 Static verification procedure

For each candidate, the audit checked as many of the following as the connector exposed:

1. DTO validation and accepted null/zero/sign ranges.
2. Entity and database precision.
3. Service calculation and transaction boundary.
4. Incremental balance update and recomputation behavior.
5. Linked rows, splits, and investment side effects.
6. Reporting, net-worth, budget, or simulation consumption.
7. Frontend input transformation and output representation.
8. Unit and integration tests located for the path.
9. Earlier-phase findings to avoid duplicate root causes.

### 3.4 Important limitations

- DNS prevented cloning; all repository evidence came from SHA-pinned connector reads.
- No immutable recursive tree listing was available.
- Connector searches were sometimes capped or truncated and frequently displayed newer-branch links.
- Several large files and specifications were inspected through targeted ranges rather than one complete response.
- No application, database, migration, import fixture, quote provider, CI job, backup restore, or browser flow was executed.
- Combined commit status returned no check details; CI success at the audited SHA was not established.
- Runtime provider behavior, production data distribution, deployment configuration, and locale rendering were inaccessible.

---

## 4. Confirmed findings

### P5-001 - Transfer `VOID` transitions do not preserve ledger/balance equivalence

| Attribute | Value |
|---|---|
| Classification | confirmed defect |
| Severity | HIGH |
| Confidence | high |
| Primary paths | `backend/src/transactions/dto/create-transfer.dto.ts:17-142`; `backend/src/transactions/transaction-transfer.service.ts:113-235`; `backend/src/transactions/transaction-transfer.service.ts:710-930`; `backend/src/transactions/transaction-transfer.service.ts:1080-1215`; `backend/src/transactions/transaction-bulk-update.service.ts:160-347`; `backend/src/transactions/transactions.service.ts:2130-2295` |

**Violated invariant**

A `VOID` transaction must be excluded exactly once from current balance, reports, and both sides of a transfer. A linked transfer must move from active to void, or void to active, as one atomic pair.

**Evidence and failure path**

- `CreateTransferDto.status` accepts every `TransactionStatus`, including `VOID`.
- `createTransfer` persists that status on both legs but always applies `-amount` and `+toAmount` to current balances for a non-future transfer. Unlike ordinary transaction creation, it does not skip balance updates when status is `VOID`.
- `updateTransfer` copies a status change to both legs, but its `accountsOrAmountsChanged` condition does not include status. A status-only active-to-void or void-to-active change therefore writes the new status without reversing or reapplying either balance.
- Bulk status updates operate on eligible selected transaction IDs. The transfer counterpart is not included in the status update set, so one leg can be `VOID` while the other remains active.
- Ordinary transaction status handling contains explicit reverse/reapply logic, which establishes the intended product invariant and shows that the transfer path is inconsistent rather than merely using another convention.

**Reproduction scenario A - create a void transfer**

Input:

- Source account opening/current balance: `100.00`
- Destination account opening/current balance: `0.00`
- Transfer amount: `30.00`
- Date: today
- Status supplied to the create endpoint: `VOID`

Implementation result:

- Source stored balance: `70.00`
- Destination stored balance: `30.00`
- Both ledger rows have status `VOID`

Expected result:

- Source balance: `100.00`
- Destination balance: `0.00`
- Both rows may be stored as `VOID`, but neither may affect balance

Difference:

- Source: `-30.00`
- Destination: `+30.00`

**Reproduction scenario B - bulk-void one leg**

Input:

- Account A before transfer: `100.00`
- Account B before transfer: `0.00`
- Existing active transfer: A `-100.00`, B `+100.00`
- Bulk status update selects only the source row and sets `VOID`

Implementation result:

- Source leg is void and A is restored to `100.00`
- Destination leg remains active and B remains `100.00`
- Combined balances: `200.00`

Expected result:

- Both linked legs become void atomically
- A: `100.00`
- B: `0.00`
- Combined balances: `100.00`

Difference:

- Destination and combined balance: `+100.00`

**Impact**

Users can see money created or destroyed across accounts while ledger rows claim no active transfer occurred. Net worth, reconciliation, account balances, scheduled workflows, and later edits can all consume the contradictory state.

**Recommended correction**

- Reject `VOID` on transfer creation or create the pair without balance effects.
- Centralize linked-transfer status transitions in one service method that locks/loads both legs, computes old and new inclusion, and applies one atomic pair of balance deltas.
- Make bulk status expansion include the linked counterpart and split-transfer owner/counterpart before validation and mutation.
- Apply the same inclusion predicate everywhere: `status != VOID && transaction_date <= CURRENT_DATE`.

**Recommended regression tests**

1. Create a current-dated transfer with `VOID`; assert no balance delta on either account.
2. Update active transfer to `VOID`; assert both legs and both balances change once.
3. Update `VOID` transfer to active; assert both balances change once.
4. Bulk-void either leg; assert the counterpart is changed atomically.
5. Repeat for future-dated and split-transfer counterparts.

**Verification method**

Static DTO/service/bulk-service comparison against ordinary transaction status logic at the fixed SHA. No runtime execution was available.

---

### P5-002 - Transfer currency and destination value are not server-authoritative

| Attribute | Value |
|---|---|
| Classification | confirmed defect |
| Severity | HIGH |
| Confidence | high |
| Primary paths | `backend/src/transactions/dto/create-transfer.dto.ts:17-88`; `backend/src/transactions/transaction-transfer.service.ts:113-235`; `backend/src/scheduled-transactions/scheduled-transactions.service.ts:1120-1365`; `backend/src/transactions/transaction-split.service.ts:210-390`; `frontend/src/components/transactions/TransactionForm.tsx:520-1065` |

**Violated invariant**

A transfer must be equal and opposite after applying one documented FX direction and any explicit fee. Stored currency codes must match the actual account currencies. Missing, zero, or contradictory conversion data must not silently become a valid posting.

**Evidence and failure path**

- The create DTO accepts client-supplied source currency, destination currency, exchange rate, and an explicit destination amount.
- The exchange-rate validator permits zero.
- `createTransfer` loads the source and destination accounts but does not derive or validate the submitted currency codes against those accounts.
- A supplied `toAmount` overrides the rate calculation without any conservation or tolerance check.
- If no destination amount is supplied, a missing rate defaults to `1`.
- Scheduled transfers call `createTransfer` with only the schedule's source currency. They do not supply the target currency, destination amount, or FX rate, so a cross-currency scheduled transfer posts 1:1 and labels the target row with the source currency.
- Transfer splits create the counterpart at `-split.amount` with an implied 1:1 relationship; they do not model cross-currency conversion.
- The standard frontend normally calculates a plausible rate, but the backend remains reachable by imports, automation, MCP/API clients, tests, and altered requests. UI assistance is not an integrity control.

**Reproduction scenario A - scheduled USD to EUR transfer**

Input:

- Source account currency: USD
- Destination account currency: EUR
- Scheduled transfer amount: `100.00 USD`
- Correct conversion rate: `0.9000 EUR per USD`
- No explicit destination amount/rate exists on the scheduled transaction model

Implementation result:

- Source: `-100.00 USD`
- Destination: `+100.00`, with the row currency inherited as USD even though the account is EUR

Expected result:

- Source: `-100.00 USD`
- Destination: `+90.00 EUR`

Difference:

- Destination balance: `+10.00 EUR`
- Destination row currency metadata: USD instead of EUR

**Reproduction scenario B - unconserved direct API transfer**

Input:

- Same-currency accounts
- `amount=100.00`
- `toAmount=80.00`

Implementation result:

- Source delta: `-100.00`
- Destination delta: `+80.00`
- Net transfer effect: `-20.00`

Expected result:

- Same-currency destination delta: `+100.00`, or request rejection
- Net transfer effect: `0.00`

Difference:

- `-20.00`

**Impact**

Cross-currency transfers, scheduled postings, split transfers, and direct API clients can materially overstate or understate an account. The wrong currency code also contaminates reporting and later conversion logic.

**Recommended correction**

- Derive both currency codes from the fetched accounts.
- Require a strictly positive server-validated rate for different currencies.
- Define one convention: `destination currency units per 1 source currency unit`.
- Derive destination amount server-side and round once to its storage precision.
- If explicit destination amount is required for bank-specific settlement, validate it against rate plus a separately modeled fee/tolerance.
- Reject cross-currency scheduled and split transfers until those models carry complete FX data, or extend them to do so.

**Recommended regression tests**

Cover same currency, USD->EUR, EUR->USD, inverted rate, zero, negative, absent rate, explicit destination mismatch, four-decimal rounding, scheduled posting, transfer split, import, and restore.

**Verification method**

Static DTO, transfer service, scheduled-posting, split-service, and frontend-form trace at the fixed SHA.

---

### P5-003 - Ordinary transaction currency can disagree with its account currency

| Attribute | Value |
|---|---|
| Classification | confirmed defect |
| Severity | MEDIUM |
| Confidence | high |
| Primary paths | `backend/src/transactions/transactions.service.ts:217-410`; `backend/src/transactions/entities/transaction.entity.ts:55-155`; `database/migrations/101_transactions_original_currency.sql:1-13`; `frontend/src/types/transaction.ts:1-210`; `frontend/src/components/transactions/TransactionForm.tsx:520-1065` |

**Violated invariant**

The stored `amount` and primary `currencyCode` of an ordinary transaction must be denominated in the owning account's currency. Foreign-entry metadata belongs in `originalAmount`, `originalCurrencyCode`, and `exchangeRate`.

**Evidence and failure path**

- `normalizeFxEntry` validates completeness, positive rate, and sign consistency of the original-currency pair.
- The method explicitly leaves `amount` and `currencyCode` unchanged.
- Creation spreads the client transaction data directly into the entity and never checks `transactionData.currencyCode` against the fetched account currency.
- Current balance is incremented by the numeric `amount` without currency conversion.
- The schema and entity distinguish primary account-currency fields from original-currency metadata, showing that a mismatched primary currency is not an alternate supported model.

**Reproduction scenario**

Input:

- Account currency: EUR
- Account starting balance: `0.00 EUR`
- Direct API transaction: `amount=100.00`, `currencyCode=USD`
- Actual USD->EUR rate for the example: `0.9000`

Implementation result:

- Account current balance: `100.00 EUR` because the numeric amount is applied directly
- Stored/reporting transaction currency: USD

Expected result:

- Either reject the request, or store `currencyCode=EUR` and an account amount of `90.00 EUR` with USD original metadata

Difference:

- Account balance: `+10.00 EUR`
- Reporting also acquires a phantom `100.00 USD` primary-currency row

**Impact**

Direct clients, imports, automation, or malformed frontend requests can make account balance units disagree with transaction/report units. The error survives backup and later reporting because both fields are persisted.

**Recommended correction**

Derive primary `currencyCode` from the account on create and update. If backward compatibility requires accepting the field, reject any mismatch. Keep foreign denomination only in the original-currency fields and validate the amount/rate relationship.

**Recommended regression test**

Create and update a transaction with a primary currency different from the account. Assert rejection or canonicalization, correct balance, correct analytics bucket, and preserved original-currency fields.

**Verification method**

Static service/entity/migration/frontend trace at the fixed SHA.

---

### P5-004 - Mixed-sign split children pass validation when their signed sum matches the parent

| Attribute | Value |
|---|---|
| Classification | confirmed defect |
| Severity | MEDIUM |
| Confidence | high |
| Primary paths | `backend/src/transactions/dto/create-transaction-split.dto.ts:70-180`; `backend/src/common/split-amount.util.ts:1-160`; `backend/src/transactions/transaction-split.service.ts:1-390`; `frontend/src/components/transactions/SplitEditor.tsx:1-320` |

**Violated invariant**

Under the DTO's documented contract, split children must follow the parent's sign convention. A single expense parent must not contain an income child that creates separate income and expense actuals while only the net parent affects the account.

**Evidence and failure path**

- The split DTO documents same-sign behavior but validates only numeric range and decimal places.
- The shared split validator checks minimum child count and four-decimal signed sum equality.
- It does not reject a child whose sign differs from a non-zero parent.
- The frontend generally adjusts signs from category type but explicitly permits sign changes, and direct API callers bypass it.
- Budget and category reporting consume child signs, while the account balance consumes the parent once.

**Reproduction scenario**

Input:

- Parent transaction: `-100.00`
- Child 1, income category: `+50.00`
- Child 2, expense category: `-150.00`
- Signed child sum: `-100.00`

Implementation result:

- Validation succeeds
- Account balance effect: `-100.00`
- Category actuals: `+50.00` income and `150.00` expense

Expected result:

- Reject the mixed-sign split under the documented same-sign rule
- For a `-100.00` expense parent, expense allocations may total at most `100.00` in magnitude unless a separate refund/netting model is explicitly defined

Difference:

- Phantom income: `+50.00`
- Expense overstatement relative to cash outflow: `+50.00`

**Impact**

Budgets, category reports, tax exports, and spending analytics can show economic activity that did not occur, even though the account balance appears correct.

**Recommended correction**

Enforce that every non-zero child has the parent's sign. Define and test the treatment of zero children explicitly. If mixed-sign netting is a desired feature, represent it as separate linked transactions rather than one split parent.

**Recommended regression tests**

- `-100.00` with `-60.00/-40.00` succeeds.
- `+100.00` with `+60.00/+40.00` succeeds.
- `-100.00` with `+50.00/-150.00` fails.
- Zero child behavior is explicit.
- Four-decimal children reconcile exactly.
- Parent amount change revalidates existing children.

**Verification method**

Static DTO/shared-validator/service/frontend trace at the fixed SHA.

---

### P5-005 - Explicit investment FX rate zero produces different preview and persisted cash

| Attribute | Value |
|---|---|
| Classification | confirmed defect |
| Severity | MEDIUM |
| Confidence | high |
| Primary paths | `backend/src/securities/dto/create-investment-transaction.dto.ts:45-130`; `backend/src/securities/investment-transactions.service.ts:350-720`; `backend/src/securities/investment-transactions.service.ts:840-980`; `backend/src/securities/entities/investment-transaction.entity.ts:1-260` |

**Violated invariant**

A preview and the committed investment transaction must apply the same strictly positive FX rate. Zero must not mean both zero conversion and a fallback to one in different branches.

**Evidence and failure path**

- The investment DTO permits `exchangeRate=0` with `@Min(0)`.
- Preview calculation accepts the explicit value and multiplies cash impact by zero.
- The committed linked cash transaction converts with a truthy fallback equivalent to `Number(exchangeRate) || 1`, so zero becomes one.
- Holdings are still created for the purchase.

**Reproduction scenario**

Input:

- Action: BUY
- Quantity: `10`
- Price: `100.00 USD`
- Commission: `0.00`
- Funding account currency: CAD
- Explicit `exchangeRate=0`

Implementation result:

- Preview cash impact: `0.00 CAD`
- Persisted cash impact: `-1,000.00 CAD`
- Holding increase: `+10` shares

Expected result:

- Reject zero rate before preview or persistence
- No cash or holding mutation

Difference:

- Preview versus committed cash: `-1,000.00 CAD`
- Holding difference after a request that should fail: `+10` shares

**Impact**

A user can approve a zero-cash preview and receive a large committed debit. API clients can also create semantically invalid investment records.

**Recommended correction**

Use strict positive validation in DTO and service, never a truthy fallback for numeric financial fields, and share one rate resolver between preview and commit.

**Recommended regression tests**

Assert preview and commit equivalence for positive, missing, zero, negative, inverse, and four-decimal rates. Zero and negative must fail without side effects.

**Verification method**

Static DTO, preview, persistence, and entity trace at the fixed SHA.

---

### P5-006 - Acquisition commission is excluded from average cost and realized gain basis

| Attribute | Value |
|---|---|
| Classification | confirmed defect |
| Severity | MEDIUM |
| Confidence | high |
| Primary paths | `backend/src/securities/cash-impact.util.ts:1-170`; `backend/src/securities/investment-transactions.service.ts:1510-1695`; `backend/src/securities/holdings.service.ts:120-225`; `backend/src/securities/portfolio-calculation.service.ts:560-790` |

**Violated invariant**

The product's account-currency cost-basis path claims to represent the amount actually spent. A BUY cash debit includes commission, so the acquisition basis and later realized gain must reconcile to that debit unless the product explicitly models the commission as a separate expense.

**Evidence and failure path**

- BUY `totalAmount` and linked cash effect are `quantity * price + commission`.
- Holdings average-cost update receives only quantity and unit price.
- Historical account-currency cost-basis replay adds only `quantity * price * exchangeRate`.
- Realized-gain replay uses that commission-excluding basis, while SELL proceeds are net of sell commission.
- No separate expense transaction absorbs the acquisition commission.

**Reproduction scenario**

Input:

- Buy `10` shares at `100.00`
- Buy commission: `10.00`
- Exchange rate: `1.0000`
- Later sell all `10` shares at `110.00`
- Sell commission: `0.00`

Implementation result after BUY:

- Cash debit: `1,010.00`
- Cost basis: `1,000.00`
- Average cost: `100.00` per share

Expected result after BUY:

- Cost basis: `1,010.00`
- Average cost: `101.00` per share

Difference after BUY:

- Cost basis: `-10.00`
- Average cost: `-1.00` per share

Implementation result after SELL:

- Proceeds: `1,100.00`
- Realized gain: `100.00`

Expected result after SELL:

- Realized gain: `90.00`

Difference:

- Realized gain: `+10.00`

**Impact**

Portfolio gain, account-level cost basis, realized-gain reports, and tax-oriented outputs overstate performance by acquisition commissions. Partial sales propagate the understated average basis to every later disposal.

**Recommended correction**

Include acquisition commission in running basis, converted with the transaction's stored rate. Reduce that basis proportionally on partial sales and transfers. If the intended product policy is separate-expense treatment, create and report that expense explicitly instead of losing it.

**Recommended regression tests**

Buy with commission, partial sale, full sale, multiple lots under average cost, foreign-currency buy, transfer of commissioned basis, and sell commission. Reconcile total cash, remaining basis, and realized gain after every step.

**Verification method**

Static cash-impact, holdings, account-currency basis, and realized-gain replay comparison at the fixed SHA.

---

### P5-007 - Transfer budgets omit transfer amounts embedded in splits

| Attribute | Value |
|---|---|
| Classification | confirmed defect |
| Severity | MEDIUM |
| Confidence | high |
| Primary paths | `backend/src/budgets/budget-spending.util.ts:1-240`; `backend/src/budgets/budgets.service.ts:1-1240`; `backend/src/transactions/transaction-split.service.ts:210-390`; `backend/src/budgets/budget-spending.util.spec.ts:1-520` |

**Violated invariant**

A budget configured to track transfers to a target account must include every qualifying transfer exactly once, whether it is a normal two-leg transfer or a transfer child of a split transaction.

**Evidence and failure path**

- The transfer-budget query scans parent transaction rows marked as transfers and joins their linked transaction.
- A transfer split is represented by a parent transaction, a split row carrying `transferAccountId`, and a linked counterpart transaction in the target account.
- The parent is a split transaction, not a normal transfer row, and the budget query does not union transfer-split rows.
- The inspected budget-spending specification covers ordinary transfer behavior but not transfer children embedded in a split.

**Reproduction scenario**

Input:

- Monthly transfer budget to Savings: `100.00`
- One source-account expense parent: `-100.00`
- Category child: `-60.00` Groceries
- Transfer child to Savings: `-40.00`

Implementation result:

- Transfer-budget actual: `0.00`
- Transfer-budget remaining: `100.00`

Expected result:

- Transfer-budget actual: `40.00`
- Transfer-budget remaining: `60.00`

Difference:

- Actual: `-40.00`
- Remaining: `+40.00`

**Impact**

Savings, debt-payment, and investment-contribution budgets can under-report actual progress whenever a transfer is one component of a mixed transaction.

**Recommended correction**

Extend transfer spending aggregation to include `transaction_splits` with a transfer target, subject to the parent date/status and target-account criteria. Deduplicate the linked counterpart so the amount is counted once.

**Recommended regression tests**

Cover mixed category/transfer splits, multiple transfer children, `VOID`, future dates, refunds/reversals, target/source orientation, and ordinary transfer non-regression.

**Verification method**

Static budget query, split representation, and test-inventory comparison at the fixed SHA.

---

### P5-008 - Final scheduled loan payment is not reduced to the outstanding balance

| Attribute | Value |
|---|---|
| Classification | confirmed defect |
| Severity | MEDIUM |
| Confidence | high |
| Primary paths | `backend/src/scheduled-transactions/scheduled-transaction-loan.service.ts:1-240`; `backend/src/scheduled-transactions/scheduled-transactions.service.ts:1080-1415`; `backend/src/common/split-amount.util.ts:1-160`; `backend/src/scheduled-transactions/scheduled-transaction-loan.service.spec.ts:1-900` |

**Violated invariant**

The final installment must reconcile principal, interest, fees, parent amount, split total, and remaining debt. When remaining principal is below the normal installment, the scheduled parent and its children must be reduced together.

**Evidence and failure path**

- The loan recalculation service can cap the principal child to the current outstanding balance in the zero-rate/fallback path.
- It saves the principal and interest split rows but does not update the parent scheduled amount.
- The scheduled posting path uses the unchanged parent amount and then submits the split children to ordinary split validation.
- Ordinary split validation requires exact four-decimal equality between parent and child sum.
- The inspected loan specification tests zero balance and zero interest but does not test a positive remaining balance below the regular installment.

**Reproduction scenario**

Input:

- Outstanding loan balance: `50.00`
- Interest rate: `0%`
- Regular scheduled parent payment: `-100.00`
- Existing schedule remains active

Implementation result after loan split recalculation:

- Principal child: `-50.00`
- Interest child: `0.00`
- Parent scheduled amount: `-100.00`

Implementation result when posting:

- Parent magnitude: `100.00`
- Child magnitude: `50.00`
- Posting fails split validation with a `50.00` mismatch

Expected result:

- Final parent payment: `-50.00`
- Principal child: `-50.00`
- Interest child: `0.00`
- Loan reaches `0.00` and the schedule deactivates after the posting

Difference:

- Parent overstatement: `-50.00`
- Posted principal: `0.00` instead of `50.00` because the operation is rejected

**Impact**

The final payment can fail exactly when a user expects the loan to close. Manual overpayments or balance corrections can trigger the same condition earlier in the schedule.

**Recommended correction**

Recalculate and persist the parent amount and all loan children atomically. Cap principal to the outstanding balance, calculate interest/fees for the effective period, and ensure the resulting parent equals the child sum before posting. Deactivate only after a successful final posting.

**Recommended regression tests**

Zero-rate final installment, positive-rate final installment, manual overpayment leaving less than one installment, final cent rounding, fee-bearing loan, and Canadian/non-Canadian mortgage rate paths.

**Verification method**

Static loan-recalculation, scheduled-posting, shared split validation, and specification comparison at the fixed SHA.

---

### P5-009 - Missing exchange rates are silently interpreted as 1:1 in net worth and portfolio totals

| Attribute | Value |
|---|---|
| Classification | confirmed defect |
| Severity | HIGH |
| Confidence | high |
| Primary paths | `backend/src/common/currency-conversion.util.ts:1-39`; `backend/src/net-worth/net-worth.service.ts:2040-2115`; `backend/src/securities/portfolio-calculation.service.ts:200-310`; `frontend/src/types/net-worth.ts:1-320`; `frontend/src/types/investment.ts:1-420` |

**Violated invariant**

Missing, stale, and unknown FX values must remain distinct from a valid rate of `1.0000`. A multi-currency total must not silently claim completeness when a required conversion is unavailable.

**Evidence and failure path**

- The shared conversion helper returns no value when neither direct nor inverse rate is available.
- Net worth converts that missing result to the original amount with `result ?? amount`.
- Portfolio conversion explicitly chooses rate `1` when both direct and reverse lookups fail.
- Response types expose ordinary numeric totals without a completeness/error field.
- The frontend therefore cannot distinguish a real 1:1 conversion from missing reference data.

**Reproduction scenario**

Input:

- Asset balance: `1,000.00 USD`
- Reporting currency: EUR
- Correct rate for the valuation date: `0.9000 EUR per USD`
- Required direct and inverse rate rows are absent from the local rate index

Implementation result:

- Reported value: `1,000.00 EUR`

Expected result:

- Converted value: `900.00 EUR`, if the known rate is available
- Otherwise the total must be marked incomplete/unknown rather than treated as 1:1

Difference:

- `+100.00 EUR`
- `+11.11%` relative to the expected `900.00 EUR`

**Impact**

Net worth, portfolio totals, allocations, cash values, gain/loss, and downstream simulation inputs can be materially wrong while appearing fully valid. The error is especially dangerous because 1:1 is numerically plausible for some currency pairs.

**Recommended correction**

- Return a typed conversion result carrying value, rate, date, source, and availability.
- Propagate missing conversion as `null`, an incomplete-total flag, or a request error according to endpoint purpose.
- Never use rate `1` except when source and destination currency are the same.
- Surface stale/missing rate warnings in API responses and frontend components.

**Recommended regression tests**

Direct rate, inverse rate, no rate, zero/invalid rate, stale rate, no prior historical rate, same currency, and mixed portfolios where only one required pair is unavailable.

**Verification method**

Static shared-helper, net-worth, portfolio, and API-type trace at the fixed SHA.

---

### P5-010 - Monte Carlo converts portfolio valuation failure into a zero starting balance

| Attribute | Value |
|---|---|
| Classification | confirmed defect |
| Severity | MEDIUM |
| Confidence | high |
| Primary paths | `backend/src/monte-carlo/monte-carlo.service.ts:560-690`; `frontend/src/lib/monte-carlo.ts:1-210`; `frontend/src/components/reports/MonteCarloChartParts.tsx:1-220`; `backend/src/monte-carlo/monte-carlo.service.spec.ts:1-1000` |

**Violated invariant**

A failed or non-finite current valuation is unknown, not zero. A simulation using current balances must not continue with a fabricated zero opening portfolio.

**Evidence and failure path**

- The current-value helper catches portfolio-summary errors and returns `0`.
- It also maps a non-finite result to `0`.
- The historical-stat and scenario API types expose `currentBalance`/starting values as non-null numbers without provenance or an availability state.
- The frontend can therefore render and run a normal-looking simulation from zero.

**Reproduction scenario**

Input:

- Actual selected investment portfolio: `100,000.00`
- Scenario option: use current balance
- Portfolio summary throws because a required valuation query/provider step fails

Implementation result:

- Simulation starting balance: `0.00`

Expected result:

- Abort with a typed valuation error, or require an explicit user-entered override while showing the unavailable current value

Difference:

- `-100,000.00`
- `-100%`

**Impact**

Retirement success rates, percentile bands, depletion rates, and safe-withdrawal outputs can be generated from a completely false starting point. The output is mathematically valid but financially meaningless.

**Recommended correction**

Propagate a typed unavailable/error state. Do not run when `useCurrentBalance` is true and current valuation is unavailable. Include valuation completeness, missing-price/FX reasons, and timestamp in the input snapshot.

**Recommended regression tests**

Portfolio summary exception, missing price, missing FX, non-finite aggregate, explicit manual starting value, and frontend error/warning rendering. Assert that no simulation result is produced from an implicit zero.

**Verification method**

Static simulation-service, frontend type, and result-rendering trace at the fixed SHA.

---

### P5-011 - Historical net-worth replay treats a stock-split ratio as added shares

| Attribute | Value |
|---|---|
| Classification | confirmed defect |
| Severity | HIGH |
| Confidence | high |
| Primary paths | `backend/src/securities/holdings.service.ts:120-225`; `backend/src/securities/investment-transactions.service.ts:1510-1715`; `backend/src/net-worth/net-worth.service.ts:870-985`; `backend/src/net-worth/net-worth.service.ts:1815-1945`; `backend/src/net-worth/net-worth.service.spec.ts:300-520` |

**Violated invariant**

For a stock-split action, `quantity` is a ratio. Historical quantity must be multiplied by that ratio and average cost divided by it, preserving total cost basis.

**Evidence and failure path**

- The canonical holdings path calls `applySplit` and treats quantity as a ratio.
- Investment transaction comments state that a split scales quantity by the ratio.
- Two independent net-worth history reducers instead add the split quantity to the running share count.
- The net-worth specification includes an additive expectation, so the test entrenches the inconsistent behavior rather than protecting the canonical invariant.

**Reproduction scenario**

Input:

- Pre-split holding: `10` shares
- Split transaction quantity/ratio: `2` for a 2-for-1 split
- Post-split market price: `50.00`

Implementation result:

- Historical quantity: `10 + 2 = 12` shares
- Historical value: `12 * 50.00 = 600.00`

Expected result:

- Historical quantity: `10 * 2 = 20` shares
- Historical value: `20 * 50.00 = 1,000.00`

Difference:

- Quantity: `-8` shares
- Value: `-400.00`
- Value understatement: `-40%`

**Impact**

Historical net-worth charts, monthly account balances, investment history, and derived changes are wrong after stock splits. Multiple splits compound the error.

**Recommended correction**

Extract one pure investment-history reducer and use it for holdings rebuilds, net-worth daily/monthly replay, cost basis, reports, and import verification. Replace the additive test expectation with ratio semantics and preserve total basis.

**Recommended regression tests**

2-for-1, 3-for-2, 1-for-2 reverse split, multiple sequential splits, split followed by sale, and daily/monthly net-worth parity with current holdings.

**Verification method**

Independent comparison of canonical holdings mutation, both net-worth reducers, and their test at the fixed SHA.

---

### P5-012 - Bulk deletion leaves linked-account net-worth snapshots stale

| Attribute | Value |
|---|---|
| Classification | confirmed defect |
| Severity | MEDIUM |
| Confidence | high |
| Primary paths | `backend/src/transactions/transaction-bulk-update.service.ts:185-347`; `backend/src/net-worth/net-worth.service.ts:1-420`; `backend/src/transactions/transaction-transfer.service.ts:640-730` |

**Violated invariant**

Deleting a linked transfer must invalidate/recalculate every affected account's balance-derived snapshots, including accounts reached only through linked rows or split counterparts.

**Evidence and failure path**

- Bulk deletion discovers and deletes linked transfer rows and reverses balances for both primary and linked accounts.
- After commit, the recalculation set is built only from the originally selected `transactions` array.
- Account IDs belonging only to `linkedTransactions` are not added to that set.
- The single-transfer deletion code separately tracks all affected account IDs, demonstrating the intended coverage.

**Reproduction scenario**

Input:

- Existing active transfer: source `-100.00`, destination `+100.00`
- Destination monthly net-worth snapshot includes `+100.00`
- Bulk delete selects only the source leg

Implementation result:

- Live source balance is reversed correctly
- Live destination balance is reversed correctly
- Source account is scheduled for net-worth recalculation
- Destination snapshot remains `100.00`

Expected result:

- Both live balances and both snapshots become `0.00`

Difference:

- Destination historical/current snapshot: `+100.00` until another recalculation happens

**Impact**

Dashboard and historical net-worth values can disagree with live balances after a legitimate bulk operation. The stale value can persist long enough to affect reports and user decisions.

**Recommended correction**

Build the affected-account set from primary transactions, loaded linked transactions, split parent accounts, and split-linked counterparts before commit. Trigger or enqueue deduplicated recalculation for the complete set after commit.

**Recommended regression tests**

Bulk-delete source leg, destination leg, both legs, multiple transfers, and split transfer. Assert current balances and all affected monthly snapshots.

**Verification method**

Static bulk-delete data-flow comparison with the single-transfer affected-account logic at the fixed SHA.

---

### P5-013 - Security transfer resets foreign-security account-currency basis to an implied 1:1 rate

| Attribute | Value |
|---|---|
| Classification | confirmed defect |
| Severity | MEDIUM |
| Confidence | high |
| Primary paths | `backend/src/securities/dto/transfer-security.dto.ts:1-62`; `backend/src/securities/investment-transactions.service.ts:1390-1510`; `backend/src/securities/portfolio-calculation.service.ts:540-665`; `backend/src/securities/portfolio-calculation.service.ts:1000-1275` |

**Violated invariant**

A share transfer between investment accounts is non-taxable/non-cash in this model and must preserve both quantity and the exact carried cost basis in each relevant account currency. A sentinel cash rate must not overwrite basis conversion.

**Evidence and failure path**

- The server obtains the source holding's average cost and uses it as the per-share carried price.
- Both `TRANSFER_OUT` and `TRANSFER_IN` are persisted with `exchangeRate=1` because no cash changes hands.
- Account-currency cost-basis replay treats `TRANSFER_IN` like a buy and adds `quantity * price * exchangeRate`.
- The transfer DTO carries no rate or explicit account-currency basis.
- Therefore a foreign security transferred into an account is treated as though its native currency equals the account currency.

**Reproduction scenario**

Input:

- Security currency: USD
- Source and destination investment-account currency: EUR
- Source position: `10` shares at `100.00 USD`
- Original historical rate: `0.9000 EUR per USD`
- Correct source account-currency basis: `900.00 EUR`
- Transfer all shares

Implementation result:

- Destination basis: `10 * 100.00 * 1.0000 = 1,000.00 EUR`

Expected result:

- Destination basis preserved from source: `900.00 EUR`

Difference:

- `+100.00 EUR`
- `+11.11%`

**Impact**

Account-level cost basis, unrealized gain, future realized gain, and tax-oriented reports become wrong after transferring a foreign security. Partial transfers create two inconsistent basis pools.

**Recommended correction**

Carry an explicit basis amount (and basis currency) from the source replay into the destination leg. For a partial transfer, move the proportional basis. Do not reuse `exchangeRate=1` as both a no-cash marker and a financial conversion rate.

**Recommended regression tests**

Foreign security between same-currency accounts, different account currencies, partial transfer, transfer after commissioned buys, transfer after stock split, and round-trip transfer. Assert quantity and total basis conservation.

**Verification method**

Static transfer-creation and account-currency basis-replay trace at the fixed SHA.

---

## 5. Design risks requiring a product decision

These are not counted as confirmed defects because the expected contract is not sufficiently explicit or the exact missing value cannot be derived from repository evidence alone.

### DR-01 - Portfolio aggregate totals silently omit holdings with no current price

`calculateHoldingsWithValues` preserves `currentPrice`, `marketValue`, and gain values as `null` for an unpriced holding, which is correct at row level. Aggregate paths add only non-null values, and account aggregation uses `marketValue ?? 0`. The API has no completeness flag. A portfolio with one priced holding worth `1,000.00` and one unpriced holding of unknown value reports a total of `1,000.00`, which looks complete even though the true difference is unknowable.

Recommended decision: either refuse a complete total, return partial totals with omitted-position metadata, or use an explicitly labeled stale/manual fallback. Phase 6 should verify whether any frontend warning compensates for the missing aggregate semantics.

### DR-02 - Historical FX lookup can use a future rate when no prior rate exists

The net-worth lookup selects the earliest available rate when no rate exists on or before the valuation date. This avoids a missing result but introduces look-ahead. Whether that is acceptable for a pre-history chart is a product decision. If not, the API should return unknown before the first known rate.

### DR-03 - Transaction original amount, primary amount, rate, and account FX fee are not reconciled

Ordinary foreign-entry validation checks field completeness, positive rate, and matching sign, but not whether `amount` approximately equals `originalAmount * exchangeRate` plus a modeled account fee. The account model has an FX fee percentage and the frontend may intentionally fold it into the account amount. The backend contract should explicitly define the allowed equation and tolerance before this is treated as a defect.

### DR-04 - Tax and fee coverage is narrower than the requested investment action matrix

The investment entity models commission but not separate withholding tax, transaction tax, exchange fee, or other fee components. This may be an intentional product limit. The UI/API should state that these amounts require separate transactions if that is the supported workflow.

---

## 6. Missing tests

The following gaps were confirmed within the inspected test inventory. Where connector truncation prevented a complete inventory, the status is `test not located` rather than `confirmed missing`.

| Area | Status | Required regression coverage |
|---|---|---|
| Transfer create with `VOID` | confirmed missing in inspected transfer service spec | No balance movement; both legs remain excluded |
| Transfer status-only active<->void | confirmed missing in inspected transfer service spec | Pair status and pair balance deltas are atomic |
| Bulk status of one transfer leg | test not located | Counterpart expansion and no money creation |
| Scheduled cross-currency transfer | confirmed missing in inspected scheduled service ranges/spec search | Server-derived destination currency and amount |
| Explicit transfer `toAmount` conservation | test not located | Reject mismatch outside documented fee/tolerance |
| Ordinary transaction/account currency mismatch | confirmed missing in inspected transaction service spec search | Reject or canonicalize primary currency |
| Mixed-sign split | confirmed missing in inspected split tests | Reject `+50/-150` under a `-100` parent |
| Investment FX zero preview/commit parity | test not located | Zero rejected; preview equals committed cash |
| BUY commission in cost basis | confirmed missing in inspected portfolio calculation spec search | Cash, basis, average cost, and realized gain reconcile |
| Transfer split in transfer budget | confirmed missing in inspected budget-spending spec | Include transfer child exactly once |
| Loan final payment below regular installment | confirmed missing in inspected loan schedule spec | Parent and child amounts shrink together |
| Missing FX in net worth/portfolio | test not located | Unknown/incomplete, never 1:1 |
| Monte Carlo current-value failure | test not located | Typed failure, no implicit zero simulation |
| Net-worth stock split | present but wrong | Replace additive expectation with ratio semantics |
| Bulk delete linked-account snapshot | test not located | Recalculate all linked account snapshots |
| Foreign-security transfer basis | test not located | Preserve basis through full and partial transfers |
| Missing-price aggregate completeness | test not located | Partial-total metadata or explicit error |

No test was executed in this phase.

---

## 7. Documentation issues

### DOC-01 - Microsoft Money split documentation is internally stale

`docs/future-plans/mny-import.md` describes converting Microsoft Money `SEC_SPLIT` rows into Monize split transactions. The baseline implementation guidance in `backend/src/import/mny/README.md` states that `SEC_SPLIT` is quote-feed metadata that must not be applied to positions and that non-1 ratios are surfaced as warnings. The implemented mapper follows the latter rule. The future-plan document should be marked superseded or corrected.

### DOC-02 - Import atomicity wording conflicts with accepted Phase 4 failure modes

`docs/import-ms-money.md` states that nothing is written unless the whole import succeeds. Accepted Phase 4 finding P4-002 established a retry path after committed data. Phase 5 did not duplicate that concurrency/retry root cause, but the user-facing promise remains stronger than the confirmed behavior.

### DOC-03 - Transfer FX contract is not documented as a backend invariant

The DTO describes rate direction informally, but there is no authoritative contract covering account-currency derivation, destination amount tolerance, fees, scheduled transfer FX, split transfer FX, and restore behavior. This ambiguity contributed directly to P5-002.

### DOC-04 - Investment cost-basis fee treatment is not stated

The implementation comments call account-currency basis the amount actually spent, but BUY commission is omitted from basis. User and developer documentation should state the treatment of commissions, taxes, transfers, reinvestments, and corporate actions after P5-006 is resolved.

---

## 8. Reviewed scope

### 8.1 Financial invariant ledger

| Area | Required invariant | Implementation source | Schema source | API/frontend representation | Test status | Assessment |
|---|---|---|---|---|---|---|
| Transaction sign | Positive is inflow; negative is outflow | `transactions.service.ts`, `accounts.service.ts` | `transactions.amount numeric(20,4)` through entity/schema | `frontend/src/types/transaction.ts`; `TransactionForm.tsx` | Basic sign paths present | confirmed for ordinary transactions; contradicted in mixed-sign splits |
| Current balance | Opening balance plus included committed parents through today | `accounts.service.ts`, `transactions.service.ts` | `accounts.opening_balance/current_balance` | account API/types sampled | Unit coverage present; runtime not executed | serial ordinary formula confirmed; concurrency roots remain P4 |
| VOID | Excluded exactly once | ordinary status helpers; transfer service; bulk service | transaction status enum | transfer DTO exposes status | transfer VOID gaps | contradicted by P5-001 |
| Future transaction | Excluded from current balance until due | date predicates and recomputation | transaction date | form and scheduled posting | relevant tests located | confirmed for serial ordinary and investment paths |
| Transfer | Source/destination conserve value after FX/fees | transfer service, scheduled service, split service | linked transaction IDs and amounts | create/update transfer DTO; TransactionForm | incomplete | contradicted by P5-001 and P5-002 |
| Split | Child signed sum equals parent and follows sign contract | split validator/service | split amount numeric fields | SplitEditor | sum tests; mixed-sign gap | sum confirmed; sign contradicted by P5-004 |
| FX | One documented direction and positive known rate | transaction normalization, transfer service, investment service, conversion helper | original amount/currency/rate columns | TransactionForm and SplitEditor describe account units per foreign unit | incomplete | partly confirmed; contradicted by P5-002, P5-005, P5-009 |
| Investment cash | Correct action cash including price, quantity, commission | `cash-impact.util.ts`, investment service | investment and linked cash transaction fields | investment types/components sampled | action tests sampled | cash direction mostly confirmed; zero-rate path contradicted |
| Holding quantity | Replay of action semantics | holdings service | holdings quantity numeric | investment types/HoldingsList | service tests sampled | serial actions confirmed; P4 concurrency excluded; net-worth replay contradicted |
| Average cost | One basis method with documented fees/transfers/actions | holdings service; portfolio calculation | holding average cost; transaction price/commission/rate | holdings API/type | commission case not protected | contradicted by P5-006 and P5-013 |
| Price | Correct field by purpose, explicit missing/stale behavior | price service, portfolio, net worth, Monte Carlo | close and adjusted-close fields | holding/null types and components | mixed | current price mostly clear; aggregate completeness is a design risk |
| Budget | Intended dates/statuses/categories/transfers exactly once | budgets service and budget-spending util | budget tables | `frontend/src/types/budget.ts` | ordinary transfer tests present | contradicted for transfer splits by P5-007 |
| Loan | Principal, interest, fees, overpayment, final balance reconcile | loan amortization and scheduled-loan services | account loan fields, rate changes | account/scheduled types sampled | broad tests, final-payment gap | contradicted by P5-008 |
| Net worth | Correct asset/liability sign, conversion, holdings, dates | net-worth service | monthly account balances | `frontend/src/types/net-worth.ts` | broad tests sampled | contradicted by P5-009, P5-011, P5-012 |
| Simulation | Missing input not silently zero | Monte Carlo service | scenario/cash-flow entities | `frontend/src/lib/monte-carlo.ts` | broad tests sampled | contradicted by P5-010 |
| Unknown values | Null, zero, absent, stale, unknown remain distinct | multiple helpers | nullable numeric columns | several non-null aggregate response types | incomplete | materially contradicted by P5-005, P5-009, P5-010; design risk for missing prices |

### 8.2 Transaction-sign matrix

| Operation | Stored amount | Balance delta | UI display/input behavior reviewed | Counterpart/split behavior | Expected test status |
|---|---:|---:|---|---|---|
| Ordinary inflow | positive | positive if current and not void | Form derives sign from transaction/category type | none | basic coverage located |
| Ordinary outflow | negative | negative if current and not void | Form generally stores signed amount | none | basic coverage located |
| Future ordinary transaction | signed | zero until date becomes current | Date selected directly | recomputation later includes it | coverage located |
| VOID ordinary transaction | signed | zero | status represented | unvoid/revoid helper reverses exactly once | serial logic confirmed |
| Transfer source | `-A` | `-A` | form generally enters positive magnitude | linked destination `+B` | VOID/FX gaps |
| Transfer destination | `+B` | `+B` | displayed as positive inflow | linked source `-A` | VOID/FX gaps |
| Category split parent | signed total | parent only | editor balances children to parent | children drive category reporting | mixed-sign gap |
| Transfer split parent | signed total | parent once | editor selects target account | target counterpart created at `-child` | cross-currency unsupported; budget omission |
| BUY investment row | positive economic total | no direct account balance; linked cash is negative | action-specific form | holding quantity increases | commission basis gap |
| SELL investment row | positive proceeds magnitude | linked cash positive | action-specific form | holding quantity decreases | serial behavior confirmed |
| REINVEST | positive value/quantity | no linked cash | action-specific | holding and basis increase | serial behavior confirmed |
| Dividend/interest/capital gain | positive amount | linked cash positive | amount-only action | no holding quantity change | serial behavior confirmed |
| Stock split | ratio in quantity | no cash | ratio entry | holding quantity multiplies | net-worth replay contradicted |
| Loan payment source | negative parent | source decreases | scheduled transaction | loan transfer child increases debt account toward zero | final-payment gap |

### 8.3 FX direction matrix

The dominant implemented convention is:

```text
converted amount = source/original amount * exchange rate
exchange rate = destination/account currency units per 1 source/original currency unit
```

| Path | Source currency | Destination currency | Rate direction used | Missing/zero behavior | Assessment |
|---|---|---|---|---|---|
| Ordinary foreign entry | original currency | account currency | account units per original unit | missing/zero rejected when foreign pair supplied; amount equation not checked | direction confirmed; DR-03 |
| Direct transfer | source account | destination account | destination units per source unit | missing defaults 1; zero accepted; explicit target overrides | P5-002 |
| Scheduled transfer | source schedule | target account | no stored complete direction | omitted fields become 1:1/source currency | P5-002 |
| Transfer split | parent account | target account | implicitly 1:1 | no cross-currency model | P5-002 |
| Investment cash | security/native transaction currency | funding/account currency | account units per security unit | zero differs between preview and persistence | P5-005 |
| Security transfer basis | security native currency | destination account currency | persisted as 1 regardless history | always 1 | P5-013 |
| Current portfolio | holding/account currency | default currency | direct or inverse lookup | missing becomes 1 | P5-009 |
| Historical net worth | account/security currency | default currency | date-aware direct or inverse | missing becomes 1; no-prior may use future earliest | P5-009, DR-02 |
| MNY import | source historical rate pairs | mapped transaction/account | mapper-specific historical direction | warnings and verification used | serial logic reviewed; runtime not executed |
| Backup/restore | stored raw amount/rate/currency columns | same fields after restore | no recomputation during export | preserves existing semantics, including defects | prior Phase 3 dependencies |
| Frontend split display | account currency | selected foreign display | display amount = account amount / rate | toggle disabled if rate absent/non-positive | UI convention consistent |

Required FX regression set:

- same currency;
- USD->EUR and EUR->USD;
- direct and inverse stored rate;
- zero and negative rate;
- absent and stale rate;
- original and account amounts with opposite signs;
- four-decimal rate and four-decimal money rounding;
- scheduled transfer;
- transfer split;
- investment preview/commit;
- missing rate in aggregate responses.

### 8.4 Split arithmetic matrix

| Parent | Children | Implemented rule/result | Expected result | Difference | Assessment |
|---:|---|---|---|---:|---|
| `-100.00` | `-60.00`, `-40.00` | accepted, exact signed sum | accepted | `0.00` | confirmed correct serial case |
| `+100.00` | `+60.00`, `+40.00` | accepted | accepted | `0.00` | confirmed correct serial case |
| `-100.00` | `+50.00`, `-150.00` | accepted because sum is `-100.00` | reject same-sign violation | `+50.00` phantom income and `+50.00` excess expense | P5-004 |
| `-100.00` | `0.00`, `-100.00` | accepted | product decision required | n/a | zero-child policy unclear |
| `-1.0000` | `-0.3333`, `-0.3333`, `-0.3334` | accepted after four-decimal money sum | accepted | `0.0000` | confirmed correct precision case |
| `-100.00` | category `-60.00`, transfer `-40.00` | parent balance `-100`, target `+40` | same | `0.00` in live balances | budget consumer misses `40.00` (P5-007) |
| Parent changed `-100`->`-120` with old children `-60/-40` | old sum `-100` | update must revalidate/rewrite | reject or rebalance to `-120` | `20.00` if not | targeted service logic reviewed; concurrency P4-009 excluded |

Precision source: four-decimal money helpers and numeric columns. The frontend editor often rounds distributions to two currency decimals, while backend validation uses four decimal places. Phase 6 should verify currencies whose display precision differs from storage precision.

### 8.5 Investment-action matrix

| Action | Quantity convention | Cash effect | Price/commission | Holding effect | Basis/average-cost effect | Assessment |
|---|---|---|---|---|---|---|
| BUY | positive | negative `qty*price + commission`, then FX | price required; commission added to cash | add quantity | implementation adds `qty*price`, omits buy commission | P5-006 |
| SELL | positive magnitude | positive `qty*price - commission`, then FX | sell commission reduces proceeds | subtract quantity | average basis relieved proportionally; realized gain uses net proceeds | serial formula confirmed, inherits P5-006 basis error |
| REINVEST | positive | no linked cash | quantity and price | add quantity | adds `qty*price`; commission semantics limited | serial formula confirmed |
| DIVIDEND | amount-oriented | positive linked cash | represented through amount/price fields | no quantity | no basis | confirmed |
| INTEREST | amount-oriented | positive linked cash | represented through amount/price fields | no quantity | no basis | confirmed |
| CAPITAL_GAIN | amount-oriented | positive linked cash | represented through amount/price fields | no quantity | no basis in current replay | confirmed implementation convention |
| SPLIT | positive ratio | none | price not economic cash | multiply quantity in holdings | preserve total basis, lower per-share average | canonical path correct; net worth P5-011 |
| TRANSFER_IN | positive | none | carried per-share cost | add quantity | adds carried price * rate | rate forced to 1, P5-013 |
| TRANSFER_OUT | positive | none | carried per-share cost | subtract quantity | proportional basis removed | source side generally consistent |
| ADD_SHARES | positive | none | no price required | add quantity | no basis added | implemented convention confirmed |
| REMOVE_SHARES | positive | none | no price required | subtract quantity | current basis treatment depends consumer | serial quantity confirmed; basis policy should be documented |

Numerical scenario coverage reviewed or required:

1. Buy with commission - confirmed defect P5-006.
2. Partial sale - proportional average basis is implemented; commission-basis defect propagates.
3. Full sale - near-zero position clears basis.
4. Reinvestment - no cash leg; quantity/basis increase.
5. Stock split - canonical holdings multiply; net worth adds, P5-011.
6. Transfer - quantity conserved serially; foreign basis not conserved, P5-013.
7. Fee-only transaction - no dedicated general fee action was located; product limitation.
8. Missing price - row becomes null, aggregate completeness risk DR-01.
9. Zero quantity/price - action-specific DTO/service checks vary; no separate confirmed numerical defect beyond P5-005.
10. Imported historical trade - MNY action-driven signs reviewed; runtime fixtures not executed.
11. Adjusted versus unadjusted history - Monte Carlo uses adjusted close fallback; current valuation uses close.
12. P4-006 holding replay - serial formulas reviewed; concurrency root not duplicated.

### 8.6 Price-consumer matrix

| Consumer | Purpose | Price field/fallback | Date/freshness | Missing behavior | FX behavior | Test/assessment |
|---|---|---|---|---|---|---|
| Portfolio current holdings | current market value | latest `close_price` | latest stored/live quote path | holding row null; aggregate omits it | current direct/inverse; missing -> 1 | DR-01 and P5-009 |
| Holdings list | per-position display | API current price | API timestamp not carried in row type | displays `-` for null | values already computed | null row display correct; no aggregate warning verified |
| Top movers | latest two `close_price` values | excludes wide date gaps | gap threshold | skips insufficient data | native-currency market value | reviewed without material finding |
| Net-worth history | historical closes and replayed quantities | close as of boundary | month/day boundary | behavior varies by query | date-aware FX; missing -> 1 | P5-009 and P5-011 |
| Capital-gain periods | historical close as of period | close lookup | period boundary | lookup may become zero in some calculations | security-to-account conversion | sampled; no additional confirmed defect |
| Monte Carlo historical returns | `COALESCE(adjusted_close, close_price)` | yearly history | observed years | incomplete histories reduce observations | portfolio value path for current balance | adjusted-close use confirmed; P5-010 current value |
| Security price service/provider | ingest/manual/current history | close and adjusted close stored | provider-specific | provider failures not runtime tested | native currency | sampled |
| MNY price import | source historical security prices | additive/upsert semantics | source dates | unavailable fields warned | source currency/rates mapped | serial path reviewed, not executed |
| GEM | strategy/backtest | no baseline module located | n/a | n/a | n/a | no Track A finding |

### 8.7 Import reconciliation matrix

| Source value | Mapped value | Stored value | Expected value | Difference | Test/assessment |
|---|---|---|---|---:|---|
| Banking inflow `+100.00` | signed ordinary transaction | `+100.00` | `+100.00` | `0.00` | mapper/service paths reviewed |
| Banking outflow `-100.00` | signed ordinary transaction | `-100.00` | `-100.00` | `0.00` | mapper/service paths reviewed |
| Investment BUY source amount | magnitude from source, direction from action | positive investment total; negative cash leg | same convention | `0.00` serially | MNY mapper documentation and code reviewed |
| Investment SELL source amount | magnitude from source, direction from action | positive net proceeds; positive cash leg | same convention | `0.00` serially | reviewed |
| MNY scheduled unposted instance | filtered as non-posted | no transaction | no transaction | `0.00` | documented mapper trap reviewed |
| MNY `SEC_SPLIT` metadata ratio | warning, not applied | no holding mutation | no holding mutation for this source table | `0` shares | current implementation/docs agree; future-plan doc stale |
| Real Monize SPLIT action ratio `2` on 10 shares | ratio action | canonical holding 20 shares | 20 shares | `0` current holding; net-worth consumer `-8` shares | P5-011 |
| Foreign MNY cost basis | source base-currency value | imported with warning/known limitation | source-preserving result plus warning | file-specific | no runtime fixture; not promoted |
| Same MNY file imported twice | rows repeated | duplicate financial rows | one import or explicit prevention | P4 example `-100.00` | P4-001/P4-002 dependency, not duplicated |
| Unsupported/unknown action | warning or skipped mapping | no silent guessed row | warning/explicit status | file-specific | reviewed design, no runtime execution |

The regular CSV/QIF/OFX processors were inspected for transaction and investment writing, but connector limits and lack of fixtures prevented a complete format-by-format numeric corpus run.

### 8.8 Loan, budget, net-worth, and simulation assessment

#### Loans and mortgages

Reviewed:

- account loan/mortgage fields and precision;
- standard periodic rate and Canadian mortgage conversion utility;
- principal/interest split recurrence;
- overpayment-related account fields;
- scheduled posting and deactivation;
- unit specifications for zero rate, monthly/biweekly, and Canadian/non-Canadian mortgage examples.

Result:

- No separate defect was confirmed in the annual-to-periodic rate formulas from static review.
- P5-008 confirms that final-payment parent/split reconciliation is incomplete.
- Runtime amortization, rate-change effective dates, negative amortization, and production rounding were not executed.

#### Budgets

Reviewed:

- category actuals, income/expense sign handling, transfer spending map, date/status filters, and split use;
- budget service aggregation and budget-spending utility tests;
- frontend budget types.

Result:

- Ordinary signed category spending and ordinary transfer tracking were consistent in inspected paths.
- P5-007 confirms transfer children of splits are omitted.
- Carryover/flex-group behavior was sampled rather than exhaustively proven.

#### Net worth and reports

Reviewed:

- assets/liabilities, excluded accounts, current/future/void filters, monthly snapshots, brokerage holdings replay, prices, FX, and frontend response types.

Result:

- P5-009 confirms missing FX becomes 1:1.
- P5-011 confirms stock split replay is wrong.
- P5-012 confirms one bulk-delete path leaves a linked snapshot stale.
- No additional liability-sign defect survived review.

#### Simulations

Reviewed:

- scenario inputs, percentages, current balance, historical adjusted returns, cash flows, seeds, and frontend result types.

Result:

- P5-010 confirms valuation failure becomes zero.
- Historical return SQL uses adjusted close with close fallback, rejecting the analogous GEM-H2 hypothesis for this module.
- Statistical quality, provider history completeness, and deterministic runtime outputs were not executed.

### 8.9 Null, zero, absent, stale, and unknown matrix

| Field | Database null | API omitted | API null | Zero | Stale | Unknown | Frontend behavior reviewed | Correctness |
|---|---|---|---|---|---|---|---|---|
| Transaction amount | generally non-null | not valid on create | n/a | accepted in several DTOs | n/a | not modeled | numeric input | zero policy varies; no separate defect |
| Primary transaction currency | non-null | generally required | n/a | n/a | n/a | not modeled | derived in normal form | mismatch can persist, P5-003 |
| Original amount | nullable | means ordinary transaction | null clears pair | explicit zero accepted with code/rate | rate can be stale | absent pair distinct | form supports foreign mode | magnitude equation unclear, DR-03 |
| Exchange rate | default/nullable by table | may default | null often means resolve/default | zero accepted in transfer/investment DTOs | historical freshness varies | missing sometimes becomes 1 | UI often disables foreign mode | P5-002, P5-005, P5-009 |
| Price | nullable by action/response | action-dependent | current price can be null | zero may be stored/validated by path | no universal freshness metadata | missing preserved on row | HoldingsList shows `-` | aggregate completeness DR-01 |
| Adjusted close | nullable | not exposed to most UI | fallback to close | zero validity provider-specific | historical | unknown falls back | no direct UI field | Monte Carlo fallback correct |
| Quantity | nullable by action | action-dependent | null for cash actions | zero restricted inconsistently | n/a | not applicable | quantity formatted | no separate confirmed defect |
| Commission | nullable/default zero | omitted -> zero | null -> zero in calculations | valid | n/a | not distinguished from absent | numeric input | BUY basis omission P5-006 |
| General fee | no dedicated field | absent | absent | n/a | n/a | cannot represent | separate transaction likely | product limitation DR-04 |
| Tax/withholding | no dedicated investment field located | absent | absent | n/a | n/a | cannot represent | not verified | product limitation DR-04 |
| Cost basis | derived and/or holding average | aggregate numeric | row fields generally numeric | zero used for no basis | historical rate may be stale | missing history can fall back | holdings display numeric | P5-006, P5-013; missing-price risk |
| Current balance | non-null numeric | always returned | n/a | valid | snapshot may be stale | errors not encoded | displayed as number | P5-012 snapshot; P5-010 simulation zero |
| Budget amount | non-null by model path | required | n/a | possible | period-specific | not modeled | numeric | transfer split omission P5-007 |
| Interest rate | nullable | optional by loan | null can invoke fallback | zero supported | rate-change history | missing policy varies | form/type sampled | final payment P5-008, not rate formula |
| Simulation parameter | persisted numeric | defaults/required vary | target/seed may be null | valid for some fields | histories may be stale | current valuation error lost | non-null result types | P5-010 |
| Scheduled override | nullable row/fields | omitted means base | null generally means base/clear | explicit zero is selected through nullish checks | occurrence date scoped | missing means use schedule | override precedence reviewed | zero-vs-absent handling confirmed |
| Investment scheduled rate | nullable | omitted means resolver/default | null means absent | zero can reach investment service | potentially stale | no provenance | form not fully reviewed | P5-005 applies at post |
| GEM momentum/history | no baseline module located | n/a | n/a | n/a | n/a | n/a | n/a | not applicable at baseline |

### 8.10 Phase 1-4 finding disposition

| Earlier finding | Phase 5 disposition |
|---|---|
| P4-001 concurrent MNY import starts | Preserved as dependency. Serial signs/mapping reviewed; concurrency root not duplicated. |
| P4-002 MNY retry after committed data | Preserved as dependency and documentation contradiction. No new ID. |
| P4-003 stale transaction mutation deltas | Serial create/update/delete/VOID formulas reviewed independently. No duplicate. |
| P4-004 duplicate scheduled occurrence | One serialized occurrence reviewed. P5-002 and P5-008 are independent arithmetic/model defects. |
| P4-005 recomputation overwrites a delta | Serial recomputation inclusion rules reviewed. No duplicate. |
| P4-006 holdings lost update | Serial holdings action formulas reviewed. P5-011 is a separate historical read-model reducer defect. |
| P4-008 close vs transaction mutation | Preserved; no financial duplicate. |
| P4-009 concurrent split overflow | Serial four-decimal split sum reviewed. P5-004 concerns sign semantics, not concurrency. |
| P3-003 linked-loan restore ordering | Preserved as restore dependency; not duplicated. |
| P3-007 backup export not one snapshot | Preserved as financial backup consistency dependency. |
| P3-013 custom currency omitted from another user's backup | Preserved; relevant to restored FX meaning, not duplicated. |
| P3-015 / P2-009 currency cleanup | Preserved as cross-user currency dependency, not duplicated. |
| P3-002 attachment restore failure | Preserved only for supporting tax/financial documents. |

No earlier finding was disproved by Phase 5. P5-011 and P5-012 strengthen the need for cross-layer snapshot/replay tests but do not supersede the earlier concurrency findings.

### 8.11 Track B GEM baseline-verification table

| Hypothesis | Baseline search/result | Disposition |
|---|---|---|
| GEM-H1 configuration changes reuse signals | No GEM strategy/configuration/materialization paths located at the fixed baseline | not a Track A finding; immutable absence not fully proven |
| GEM-H2 unadjusted historical calculations | No GEM module located. Monte Carlo uses adjusted close with close fallback | GEM hypothesis not promoted; analogous Monte Carlo path rejected |
| GEM-H3 missing equity history still creates operation | No GEM operation/ranking path located | not promoted |
| GEM-H4 partial-overlap ETF operation not executable | No GEM operation model located | not promoted |
| GEM-H5 brokerage cash omitted | No GEM strategy notional path located | not promoted |
| GEM-H6 one fresh instrument hides stale inputs | No GEM freshness aggregation located | not promoted |
| Earlier `strategyId=gem` first-save blocker | Exact baseline path/failure not discovered | not reported |

Search was not accepted as proof of repository-wide absence because no recursive immutable tree listing was available.

### 8.12 Contradictions and supersession register

| Item | Sources | Resolution |
|---|---|---|
| Stock-split semantics | Holdings service multiplies; net-worth reducers and one test add | Canonical action contract is ratio multiplication; P5-011 confirmed |
| MNY `SEC_SPLIT` behavior | Future-plan doc says convert; current importer README/mapper say do not apply | Current implementation behavior retained; future-plan doc stale |
| Import atomicity | User doc says all-or-nothing; P4 accepted retry-after-commit | Documentation overstates guarantee; no duplicate P5 root |
| Account-currency basis description | Portfolio comment says amount actually spent; BUY commission omitted | P5-006 confirmed |
| Unknown FX | Shared helper can return missing; net worth/portfolio convert missing to amount/rate 1 | P5-009 confirmed |
| Frontend split sign assistance vs backend invariant | UI usually infers category sign; UI/direct API can still send mixed signs; backend only checks sum | Backend must enforce contract; P5-004 confirmed |
| Transfer account lookup vs currency fields | Service loads accounts but trusts DTO currencies/amount | Account lookup does not establish financial integrity; P5-002 confirmed |

---

## 9. Unreviewed or inaccessible scope

The following scope was not available or was not complete enough for a repository-wide claim:

- a recursive immutable file tree at the baseline SHA;
- proof that no additional `AGENTS.md`, package instructions, financial documentation, or GEM files exist outside discovered paths;
- a local checkout and dependency installation;
- database schema creation, migration application, and schema-drift execution;
- RLS-enabled database integration tests;
- real CSV, QIF, OFX, and `.mny` fixture runs;
- quote-provider responses, live/stale price behavior, and exchange-rate provider behavior;
- backup export/restore execution and support-backup de-identification output;
- browser/UI behavior, localization, accessibility, caching, and network retry behavior;
- production data, production logs, deployment configuration, cron execution, and background-job behavior;
- full tax-report semantics and jurisdiction-specific basis rules;
- every frontend component that renders the affected values;
- every unit/integration specification, because some connector responses and searches were truncated;
- CI logs and check conclusions for the audited SHA; combined status returned no detailed statuses.

No claim is made that the entire financial subsystem was exhaustively reviewed. The confirmed findings are limited to paths supported by the ledger below.

---

## 10. False positives investigated and rejected

### FP-01 - Serial ordinary transaction balance formula

Rejected. Ordinary create, update, delete, void, unvoid, future-date, and recomputation paths contain the expected serial inclusion logic. P4-003 and P4-005 remain concurrency defects; they were not relabeled as new financial arithmetic defects.

### FP-02 - Four-decimal split total drift

Rejected as a serial defect. The shared split helper sums through money rounding and compares at four decimal places. The concurrency overflow in P4-009 remains, but the basic `-0.3333/-0.3333/-0.3334` case reconciles to `-1.0000`.

### FP-03 - Scheduled override zero treated as absent

Rejected. Scheduled post precedence uses explicit null/undefined checks for amount, category, split mode, investment quantity, price, and total amount. An explicit numeric zero is generally selected rather than discarded at this layer.

### FP-04 - Future investment transactions immediately change current holdings/cash

Rejected. The inspected creation and rebuild paths defer current effects for future dates and later rebuild them through the scheduled/current-date mechanisms. No independent serial defect was confirmed.

### FP-05 - Monte Carlo historical returns always use unadjusted close

Rejected. The baseline yearly return query uses adjusted close with close fallback. This specifically prevents promoting the analogous Track B GEM-H2 concern into the Monte Carlo module.

### FP-06 - MNY investment directions are inferred from quantity sign

Rejected. Current mapper documentation and code derive direction from the Money action code and use amount magnitude separately, including explicit traps for BUY/SELL, REINVEST, REMOVE_SHARES, and phantom scheduled instances.

### FP-07 - MNY holdings verification applies `SEC_SPLIT` metadata

Rejected. The current importer intentionally does not apply those metadata rows to positions and compares holdings against Money lots. A stale future-plan document says otherwise, recorded as DOC-01.

### FP-08 - Liability accounts are always added as positive net worth

Rejected. Inspected net-worth paths preserve signed account balances and did not establish a separate systematic liability-sign inversion.

### FP-09 - Zero split child alone is a confirmed defect

Rejected. The repository does not define whether a temporary or persisted zero child is prohibited. Zero-child behavior remains a contract decision, unlike the documented mixed-sign violation in P5-004.

### FP-10 - Account FX amount must equal original amount times rate with no other term

Rejected as a confirmed defect. Account-level FX fee percentage exists and frontend code can fold a fee into the account-currency amount. The missing server equation is DR-03 until the product contract defines fee and tolerance semantics.

### FP-11 - Current holdings stock split is wrong

Rejected. The canonical holdings service multiplies quantity by the split ratio. The confirmed defect is confined to independent historical net-worth reducers (P5-011).

### FP-12 - Every missing current price should be zero

Rejected. Row-level API and `HoldingsList` correctly preserve/display null. The unresolved issue is aggregate completeness, recorded as DR-01 rather than a numerical defect with an invented expected price.

---

## 11. Audit ledger

### 11.1 Phase identity

| Ledger field | Entry |
|---|---|
| Audit phase | Phase 5 - Financial Correctness |
| Worker-chat name | Phase 5 worker chat |
| Audited SHA | `d5cea9bfa995885ba5198f9843359362927c0fd4` |
| Assigned scope | Cross-layer financial arithmetic, signs, FX, balances, splits, investments, prices, scheduled postings, imports, loans, budgets, net worth, simulations, null/zero/unknown semantics |
| Access | Read-only GitHub connector, explicit SHA ref |

### 11.2 Instruction hierarchy inspected

Files read at the baseline:

- `CLAUDE.md`
- `backend/CLAUDE.md`
- `database/CLAUDE.md`
- `frontend/CLAUDE.md`
- `backend/src/mcp/CLAUDE.md`
- `.claude/settings.json`
- `.claude/skills/backend.md`
- `.claude/skills/frontend.md`
- `.claude/skills/infrastructure.md`
- `CONTRIBUTING.md`
- `SECURITY.md`
- `README.md`

`AGENTS.md` was not located by search; immutable recursive absence was not established.

### 11.3 Directories inspected

- repository root and `.claude/`
- `.github/workflows/`
- `backend/src/accounts/`
- `backend/src/transactions/`
- `backend/src/common/`
- `backend/src/securities/`
- `backend/src/budgets/`
- `backend/src/scheduled-transactions/`
- `backend/src/import/`
- `backend/src/import/mny/`
- `backend/src/net-worth/`
- `backend/src/monte-carlo/`
- `backend/src/backup/`
- `backend/src/mcp/`
- `database/migrations/`
- `frontend/src/types/`
- `frontend/src/lib/`
- `frontend/src/components/transactions/`
- `frontend/src/components/investments/`
- `frontend/src/components/reports/`
- `docs/`
- `docs/future-plans/`

### 11.4 Files inspected in full or in contiguous chunks covering the implementation file

The connector was used in multiple SHA-pinned ranges for the following implementation files. The audit treated these as full-file or near-full-file reads where the ranges covered the available file body:

- `backend/src/transactions/transactions.service.ts`
- `backend/src/transactions/transaction-transfer.service.ts`
- `backend/src/transactions/transaction-split.service.ts`
- `backend/src/accounts/accounts.service.ts`
- `backend/src/securities/investment-transactions.service.ts`
- `backend/src/securities/holdings.service.ts`
- `backend/src/securities/portfolio-calculation.service.ts`
- `backend/src/scheduled-transactions/scheduled-transactions.service.ts`
- `backend/src/budgets/budgets.service.ts`
- `backend/src/net-worth/net-worth.service.ts`
- `backend/src/monte-carlo/monte-carlo.service.ts`
- `backend/src/accounts/loan-mortgage-account.service.ts`
- `backend/src/accounts/loan-amortization.util.ts`
- `backend/src/scheduled-transactions/scheduled-transaction-loan.service.ts`
- `backend/src/import/import.service.ts`
- `backend/src/import/import-post-processing.service.ts`
- `backend/src/import/import-regular-processor.service.ts`
- `backend/src/import/import-investment-processor.service.ts`
- `backend/src/import/mny/mny-import-job.service.ts`
- `backend/src/import/mny/mny-import.service.ts`
- `backend/src/import/mny/writers/write-investments.ts`
- `backend/src/import/mny/map/check-holdings.ts`
- `backend/src/import/mny/map/map-investments.ts`
- `backend/src/common/split-amount.util.ts`
- `backend/src/common/currency-conversion.util.ts`
- `backend/src/securities/cash-impact.util.ts`
- `backend/src/transactions/transaction-reconciliation.service.ts`
- `backend/src/transactions/transaction-bulk-update.service.ts`
- `backend/src/transactions/transaction-analytics.service.ts`
- relevant DTO/entity files listed below.

### 11.5 Files inspected through targeted ranges or sampled

- `backend/src/backup/backup.service.ts`
- `backend/src/securities/portfolio.service.ts`
- `backend/src/securities/security-price.service.ts`
- `backend/src/securities/entities/security-price.entity.ts`
- `backend/src/transactions/transaction-transfer.service.spec.ts`
- `backend/src/transactions/transactions.service.spec.ts`
- `backend/src/budgets/budget-spending.util.spec.ts`
- `backend/src/scheduled-transactions/scheduled-transaction-loan.service.spec.ts`
- `backend/src/securities/portfolio-calculation.service.spec.ts`
- `backend/src/net-worth/net-worth.service.spec.ts`
- `backend/src/monte-carlo/monte-carlo.service.spec.ts`
- `.github/workflows/ci.yml`
- `backend/package.json`
- `database/migrations/101_transactions_original_currency.sql`
- `docs/import-ms-money.md`
- `docs/future-plans/mny-import.md`
- `backend/src/import/mny/README.md`
- `frontend/src/components/transactions/TransactionForm.tsx`
- `frontend/src/components/transactions/SplitEditor.tsx`
- `frontend/src/components/investments/HoldingsList.tsx`
- `frontend/src/components/reports/MonteCarloChartParts.tsx`
- `frontend/src/types/transaction.ts`
- `frontend/src/types/investment.ts`
- `frontend/src/types/budget.ts`
- `frontend/src/types/net-worth.ts`
- `frontend/src/lib/monte-carlo.ts`

### 11.6 DTO/entity/schema files inspected

- `backend/src/accounts/entities/account.entity.ts`
- `backend/src/transactions/entities/transaction.entity.ts`
- `backend/src/transactions/dto/create-transaction.dto.ts`
- `backend/src/transactions/dto/create-transfer.dto.ts`
- `backend/src/transactions/dto/update-transfer.dto.ts`
- `backend/src/transactions/dto/create-transaction-split.dto.ts`
- `backend/src/securities/entities/investment-transaction.entity.ts`
- `backend/src/securities/dto/create-investment-transaction.dto.ts`
- `backend/src/securities/dto/transfer-security.dto.ts`
- `database/migrations/101_transactions_original_currency.sql`

The complete database schema and all relevant migrations were not re-read in full in this phase; accepted Phases 1-3 supplied baseline/schema context.

### 11.7 Inaccessible files/resources and connector constraints

- No local repository checkout.
- No recursive immutable tree endpoint.
- Directory-content fetch through the available connector did not provide a reliable recursive listing.
- Searches were capped/truncated in several broad queries.
- Large file responses were sometimes truncated, requiring targeted re-fetches.
- Search result URLs often pointed to a newer revision and were discarded until SHA-pinned re-fetch.
- No database, CI runner, object storage, quote provider, deployment, or production environment.
- No real import files or backup archives.

### 11.8 Tests, checks, and CI examined

Examined statically:

- transfer service specifications;
- transaction service specifications;
- budget spending utility specifications;
- scheduled loan service specifications;
- portfolio calculation specifications;
- net-worth specifications;
- Monte Carlo service specifications;
- CI workflow references for lint, unit, integration, and schema checks;
- commit combined status, which returned no detailed statuses.

Tests/checks actually executed:

```text
none
```

Runtime scenarios executed:

```text
none
```

### 11.9 Required matrices completed

- Financial invariant ledger: Section 8.1.
- Transaction-sign matrix: Section 8.2.
- FX direction matrix: Section 8.3.
- Split arithmetic matrix: Section 8.4.
- Investment-action matrix: Section 8.5.
- Price-consumer matrix: Section 8.6.
- Import reconciliation matrix: Section 8.7.
- Loan/budget/net-worth/simulation assessment: Section 8.8.
- Null/zero/absent/stale/unknown matrix: Section 8.9.

### 11.10 Confirmed findings by severity

| Severity | IDs | Count |
|---|---|---:|
| BLOCKER | none | 0 |
| HIGH | P5-001, P5-002, P5-009, P5-011 | 4 |
| MEDIUM | P5-003, P5-004, P5-005, P5-006, P5-007, P5-008, P5-010, P5-012, P5-013 | 9 |
| LOW | none | 0 |

### 11.11 Design risks

- DR-01: incomplete portfolio totals when prices are missing.
- DR-02: possible future-rate look-ahead before the first historical FX point.
- DR-03: undefined server equation for original amount, account amount, rate, and FX fee.
- DR-04: narrow tax/general-fee representation in investment actions.

### 11.12 Missing tests

The detailed inventory is in Section 6. High-priority gaps are transfer `VOID`, transfer FX and scheduled FX, missing FX aggregate behavior, net-worth stock-split ratio semantics, commissioned cost basis, and simulation valuation failure.

### 11.13 Documentation issues

- stale `SEC_SPLIT` guidance in future-plan documentation;
- import atomicity promise stronger than accepted Phase 4 behavior;
- missing authoritative transfer FX contract;
- missing commission/cost-basis policy.

### 11.14 Open hypotheses

- Whether aggregate portfolio endpoints intentionally return partial totals without a completeness marker.
- Whether use of the earliest future FX rate before history begins is an accepted chart policy.
- The exact permitted account-amount equation when an account FX fee is configured.
- Whether general taxes/fees should be first-class investment fields or separate transactions.

### 11.15 False positives rejected

Twelve investigated false positives are documented in Section 10, including ordinary serial balance formulas, four-decimal split sums, scheduled zero overrides, future investment timing, adjusted-close use in Monte Carlo, and current holdings split semantics.

### 11.16 Areas reviewed without a material finding

- Serial ordinary transaction create/update/delete arithmetic.
- Serial current-balance recomputation inclusion of current, non-void parent transactions.
- Four-decimal split sum arithmetic in non-concurrent execution.
- Scheduled override precedence for explicit zero versus absent values.
- Current holdings application of stock-split ratios.
- MNY action-driven BUY/SELL direction and documented phantom-row filtering.
- MNY holdings verification against open lots.
- Monte Carlo adjusted-close fallback for historical returns.
- Basic liability sign handling in inspected net-worth paths.
- Holdings list rendering of row-level missing values as unavailable rather than numeric zero.

### 11.17 Dependencies on Phases 1-4

- Baseline SHA and architecture from Phase 1.
- RLS/scoped-database assumptions from Phase 2.
- schema, migration, backup, and restore risks from Phase 3.
- concurrency root causes and duplicate-avoidance list from Phase 4.

### 11.18 Contradictions with earlier reports

No accepted earlier finding was contradicted. Phase 5 independently confirmed serial formulas where Phase 4 reported concurrency defects. P5-011 and P5-012 add read-model/snapshot defects rather than replacing concurrency findings.

### 11.19 Duplicate, strengthened, superseded, downgraded, or disproved prior findings

| Disposition | Entry |
|---|---|
| Duplicated | none |
| Strengthened | Need for holdings/net-worth replay parity tests; need for complete affected-account snapshot invalidation |
| Superseded | none |
| Downgraded | none |
| Disproved | none |

### 11.20 Track B GEM baseline-verification disposition

No GEM implementation path was located at the fixed baseline. None of GEM-H1 through GEM-H6, nor the earlier first-save blocker, was promoted into Track A. Absence is not claimed as repository-wide proof because the immutable recursive tree was unavailable.

### 11.21 Report and completion

| Field | Entry |
|---|---|
| Report filename | `monize-audit-05-financial-correctness.md` |
| Completion status | Complete with static/connector limitations |
| Next required action | Phase 6 frontend contracts, adapters, components, caching, localization, and semantic drift at the same SHA |

---

## 12. Handoff to Phase 6

Phase 6 must audit exactly:

```text
AUDIT_BASELINE_SHA=d5cea9bfa995885ba5198f9843359362927c0fd4
```

Its required report filename is:

```text
monize-audit-06-frontend-contracts.md
```

### 12.1 Backend contracts to preserve and verify in the frontend

#### Transactions and transfers

- `backend/src/transactions/entities/transaction.entity.ts`
- `backend/src/transactions/dto/create-transaction.dto.ts`
- `backend/src/transactions/dto/create-transfer.dto.ts`
- `backend/src/transactions/dto/update-transfer.dto.ts`
- `backend/src/transactions/dto/create-transaction-split.dto.ts`
- `backend/src/transactions/transactions.controller.ts`
- `backend/src/transactions/transactions.service.ts`
- `backend/src/transactions/transaction-transfer.service.ts`
- `backend/src/transactions/transaction-split.service.ts`
- `backend/src/transactions/transaction-bulk-update.service.ts`

Frontend paths already read or discovered:

- `frontend/src/types/transaction.ts`
- `frontend/src/components/transactions/TransactionForm.tsx`
- `frontend/src/components/transactions/SplitEditor.tsx`

Required Phase 6 questions:

- Does every surface preserve positive-inflow/negative-outflow semantics?
- Can the user create or edit `VOID` transfers, and how is pair status shown?
- Are source/destination account currencies derived from account objects or editable/request-controlled?
- Does the UI show the exact FX direction and the destination amount used by the server?
- Are transfer fees/rounding represented or merely hidden inside `toAmount`?
- Can mixed-sign split children be submitted, pasted, imported, or generated by AI/MCP flows?
- Does bulk status/delete UI warn that linked rows are affected?

#### Investments, holdings, prices, and reports

Backend paths:

- `backend/src/securities/entities/investment-transaction.entity.ts`
- `backend/src/securities/dto/create-investment-transaction.dto.ts`
- `backend/src/securities/dto/transfer-security.dto.ts`
- `backend/src/securities/investment-transactions.service.ts`
- `backend/src/securities/holdings.service.ts`
- `backend/src/securities/portfolio-calculation.service.ts`
- `backend/src/securities/portfolio.service.ts`
- `backend/src/securities/security-price.service.ts`

Frontend paths:

- `frontend/src/types/investment.ts`
- `frontend/src/components/investments/HoldingsList.tsx`
- report components discovered under `frontend/src/components/reports/`, including investment/security performance views; re-fetch each at the baseline before using it as evidence.

Required Phase 6 questions:

- Does preview display the exact committed FX/cash result, especially zero/missing rates (P5-005)?
- Are commissions described as part of basis, separate expense, or neither (P5-006)?
- Are `costBasis`, `costBasisAccountCurrency`, `marketValue`, and gain fields labeled with their actual currencies?
- Does security-transfer UI explain basis preservation and currency conversion (P5-013)?
- Does every split ratio input clearly mean a ratio, not shares added (P5-011)?
- Are missing/stale prices displayed as unknown, and do total cards expose partial-total status (DR-01)?
- Are adjusted versus unadjusted historical series labeled correctly?

#### Budgets and loans

Backend paths:

- `backend/src/budgets/budgets.service.ts`
- `backend/src/budgets/budget-spending.util.ts`
- `backend/src/scheduled-transactions/scheduled-transactions.service.ts`
- `backend/src/scheduled-transactions/scheduled-transaction-loan.service.ts`
- `backend/src/accounts/loan-mortgage-account.service.ts`
- `backend/src/accounts/loan-amortization.util.ts`

Frontend paths:

- `frontend/src/types/budget.ts`
- scheduled transaction, budget, loan, and mortgage components must be discovered and SHA-fetched in Phase 6.

Required Phase 6 questions:

- Do transfer budgets explain whether transfer children of splits count (P5-007)?
- Does the final-loan-payment UI preview the reduced parent amount and reconciled principal/interest children (P5-008)?
- Are percentage inputs represented consistently as percent values versus decimal fractions?
- Are zero rate, missing rate, and rate-change effective dates distinct?

#### Net worth and Monte Carlo

Backend paths:

- `backend/src/net-worth/net-worth.service.ts`
- `backend/src/common/currency-conversion.util.ts`
- `backend/src/monte-carlo/monte-carlo.service.ts`

Frontend paths:

- `frontend/src/types/net-worth.ts`
- `frontend/src/lib/monte-carlo.ts`
- `frontend/src/components/reports/MonteCarloChartParts.tsx`
- Monte Carlo scenario, historical-stat, compare, and result components discovered under `frontend/src/components/reports/monte-carlo/`; re-fetch at the baseline.

Required Phase 6 questions:

- Can API/UI distinguish a valid 1:1 rate from missing FX (P5-009)?
- Is FX rate date/source/freshness visible?
- Is an incomplete net-worth/portfolio total labeled partial?
- Can `currentBalance=0` mean both real zero and valuation failure (P5-010)?
- Do simulation input snapshots show whether a current value was successfully resolved?
- Are percentile, success-rate, inflation, contribution-growth, and withdrawal percentages consistently represented?

### 12.2 Confirmed Phase 5 findings requiring frontend verification

| Finding | Frontend verification priority |
|---|---|
| P5-001 | transfer status controls, pair display, bulk actions, reconciliation wording |
| P5-002 | transfer account/currency derivation, scheduled transfer capabilities, explicit target amount and rate direction |
| P5-003 | API adapter must not send a primary currency different from account currency |
| P5-004 | split editor, paste/import, AI/MCP-created payload sign constraints |
| P5-005 | preview/commit parity and zero-rate validation |
| P5-006 | basis and realized-gain labels; commission explanation |
| P5-007 | transfer-budget actual/remaining display and help text |
| P5-008 | final loan payment preview, error handling, and schedule deactivation |
| P5-009 | missing/stale FX warning and incomplete totals |
| P5-010 | valuation failure versus real zero in simulations |
| P5-011 | split-ratio input and historical chart semantics |
| P5-012 | stale-cache/snapshot invalidation after bulk deletion |
| P5-013 | basis currency and transferred-basis display |

### 12.3 Sign, precision, currency, percentage, date, and null semantics to preserve

- Signed money: positive inflow, negative outflow in backend storage.
- Transfer UI magnitude must map to a negative source and positive destination.
- Money storage commonly uses four decimals; display precision may be currency-specific.
- Split balancing must be checked in account currency and backend precision.
- FX direction must be stated as destination/account units per source/original unit.
- A valid zero amount must not be confused with absent override.
- A missing rate or price must not be rendered as numeric zero or implicit 1:1.
- Historical price date and FX date/freshness must remain visible or available for warnings.
- Percent values must not switch between `0.05` and `5` without an explicit adapter.
- Date-only financial fields must not shift across timezone boundaries.

### 12.4 GEM, delegated profiles, emergency access, and backup UI

- GEM was not located at the baseline; Phase 6 should search again only for frontend contract discovery and re-fetch any candidate at the SHA.
- Delegated profile and emergency-access wording may change who is allowed to view or mutate financial records; preserve Phase 2 authorization conclusions and do not infer rights from hidden UI alone.
- Backup/restore UI must not imply stronger atomicity, currency completeness, or attachment coverage than Phase 3 established.
- Support-backup/de-identification UI should distinguish transformed monetary data from a restorable personal backup.

### 12.5 Rejected false positives Phase 6 should not reopen without new evidence

- Row-level missing holding price is already rendered as unavailable in `HoldingsList`; investigate aggregate completeness instead.
- Monte Carlo historical returns already use adjusted close fallback at the backend.
- Scheduled override zero handling uses nullish precedence correctly in the reviewed service.
- Canonical current holdings already multiply a stock-split ratio; the defect is historical net-worth replay.
- Ordinary serial transaction balance arithmetic is not the Phase 5 defect; focus on frontend contract drift and the P4 concurrency roots.

### 12.6 Missing contract/localization tests to prioritize

- rate-direction labels and examples in all supported locales;
- missing/stale FX and price warnings;
- transaction and split sign transformations;
- four-decimal storage versus currency display precision;
- transfer status and linked-leg bulk action wording;
- investment commission/cost-basis labels;
- final-loan-payment error and preview;
- simulation valuation failure versus zero;
- null, absent, and explicit zero in forms and API adapters;
- date-only transaction/schedule fields across timezone boundaries.

### 12.7 Phase 6 limitations inherited from Phase 5

- no local clone or browser execution;
- no recursive immutable tree;
- search results must be treated as path discovery only;
- every frontend file used as evidence must be re-fetched with the baseline SHA;
- no claim that all localization files/components are covered unless the Phase 6 ledger proves it.

---

## Final Phase 5 conclusion

The baseline's ordinary serial ledger arithmetic is generally structured around signed amounts, four-decimal storage, current-date inclusion, and scoped transactions. Material correctness failures arise where independent models diverge: transfers bypass ordinary `VOID` and currency invariants; investment cash, basis, and transfer representations use incompatible rate/fee assumptions; historical net-worth replay does not share holdings action semantics; and unknown values are collapsed into valid-looking zeros or 1:1 conversions.

The remediation order should be:

1. Fix transfer `VOID` and server-authoritative transfer FX/currency conservation (P5-001, P5-002).
2. Remove silent unknown-to-1:1 and unknown-to-zero conversions (P5-009, P5-010), adding response completeness metadata.
3. Unify investment replay semantics across holdings, basis, net worth, and transfers (P5-006, P5-011, P5-013).
4. Close transaction/split/account-currency validation gaps (P5-003, P5-004, P5-005).
5. Correct downstream consumers and invalidation (P5-007, P5-008, P5-012).
6. Add the cross-layer regression suite before changing frontend contracts in Phase 6.
