# Accrual accounting

Status: local feature scope approved by the deployment owner. Upstream discussion link, maintainer ownership and `approved-to-build` designation must be supplied before a pull request is opened. This document records the implemented scope; it does not claim upstream approval.

## Scope and invariants

An optional schedule allocates one existing income or expense, or an eligible saved category split, equally across calendar months. The actual payment remains the cash ledger source. Recognition facts are separate from cash transactions and do not create bank payments or change reconciliation, import identity or account balances.

- Previous twelve months and next twelve months include the payment month. Custom uses a start month and month count. Recognition defaults to month-end; the first-business-day option uses weekdays without a holiday calendar.
- Allocation uses integer minor units, retaining source precision under the engine's currency rules; a division remainder belongs to the final period. The recognized amounts sum to the source amount.
- Source edits, schedule writes and removals validate the reviewed fingerprint and revision under source locks inside the same `withScopedDb` transaction as their writes. A stale preview refuses before commit. Undo/redo retains linked schedule state.
- Expense timing positions net in one Prepaid Expenses bucket; income positions net in one Unearned Revenue bucket. Past recognition and payment offset within that bucket. Read-only system-account detail remains separate by native currency under Accounts / Other.
- Cash / Accrual controls use one user-level default, with an ephemeral view override. Cash is the fallback default. Disabling accrual forces cash execution while retaining schedules and the saved basis preference for later re-enabling.
- Register recognition rows open their parent editor on Accrual. The clicked month is highlighted until a draft change. Source fields and the schedule are reviewed and saved together.
- Ownership, delegated-read restrictions, VOID exclusion, investment linkage, category netting and missing-FX disclosure apply to recognition as they do to cash reporting.

Existing contracts touched: INV-BALANCE-001, INV-REGISTER-001, INV-TRANSFER-001, INV-RECONCILE-001, INV-FX-001, INV-FX-002, INV-REPORT-001, INV-REPORT-003, INV-REPORT-004 and INV-CACHE-001 in `docs/system-invariants.md`.

## Examples and truth table

| Case                                                              | Expected result                                                                              |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Expense -2,400 paid October 15; next twelve months                | Twelve -200 rows, October 31 through September 30; cash retains one -2,400 row               |
| Expense -100 over three months                                    | -33.33, -33.33, -33.34 at month-end                                                          |
| Same expense over the prior twelve months including payment month | Historical expense rows remain visible; timing balance after recognition and payment is zero |
| Income received before its recognition                            | Unearned Revenue carries the unrecognized amount, declining as periods recognize it          |
| Source amount changes after review                                | Stale fingerprint refuses; a new preview is required                                         |
| Remove schedule                                                   | Remove linked recognition allocations; ordinary cash treatment resumes                       |
| Missing conversion rate                                           | Disclose incomplete conversion or refuse the unsupported result; never substitute rate 1     |
| Transfer or investment-linked source                              | No independently editable accrual schedule                                                   |

Count metrics count recognition events by their own selected direction without requiring FX. They do not sum native currencies. Monetary metrics retain category netting, including refunds.

## Verification matrix

Pure tests cover exact division, remainder, calendar boundaries, signs, fingerprints and timing balances. Enforced PostgreSQL suites cover ownership, policies, lifecycle, source/split mutations, bulk operations, history, imports, reporting, budgets, FX and system movements. Frontend tests cover editor draft/review/save, context and request isolation, linked register rows, basis controls, exports, settings and system-account detail. Validation after porting to upstream must be recorded separately from historical local results.

## Limits

Equal monthly allocations only. No daily recurrence, weighted allocations, partial-month proration, closed-period locking or general journal editor. An unsaved new split component must first receive its persisted identity. Unsupported report filters refuse rather than approximate. Bounded custom-report selections disclose truncation and withhold complete totals; their known subtotals and selection counts describe only the returned rows.

## Review repairs: previews, source writes and history

Previews, including incremental split previews, read without source/schedule write locks or the bulk-history advisory lock. Source writers re-read and validate the reviewed fingerprint under the existing parent-before-leg row locks. Add/remove split and bulk deletion do not serialize unrelated sources on a user-wide accrual lock. Versioned bulk-history undo/redo retains its advisory lock before source/account rows, rechecks the history state after acquiring it, and conditionally writes history last. Existing source locks, fingerprint checks and rollback on a failed history write remain in place.

New history stores the recognition date rule explicitly. A legacy history payload that omitted the rule may recover it only when exactly one regenerated supported plan matches its stored content fingerprint; failure refuses undo and rolls back source, schedules and balance changes. Closed-period accrual trends use the period's stored category IDs, rather than current budget membership; historical transfer/income metadata and deleted budget-category snapshots remain bounded by what the existing period schema actually retained.


## Reporting compatibility decisions, October 29

Native Cash net-worth output retains its existing whole-unit rounding; active Accrual net-worth uses four-decimal money. Selected Accrual with no schedules uses native execution, including closed budget snapshots. Active recognition trends and health comparisons use the retained period category IDs. Missing historical transfer/income metadata or cascaded-away snapshots cannot be reconstructed from that schema.

Reporting entry points refuse a supplied owner that conflicts with the effective request owner before preferences or SQL. Delegation uses the effective owner, not the delegate's real identity; explicit system jobs may select an owner. Cash SQL and its parameters remain unchanged. This adds a caller-scope refusal without adding owner semi-joins to native queries.

Taxonomy operations require owner review when the affected sources include an accrual schedule; an unrelated schedule is not by itself a delegate refusal. Parent-before-leg source locks and fresh membership checks fence matching import/category/payee writes. Automatic-rule APIs still accept existing IDs, so they retain a scoped lock/discovery batch rather than trusting a caller's claim that rows are new.

Partial budget reads expose known components and missing pair/date details through an explicit opt-in response, with derived scores, ratios and recommendations withheld. Non-opt-in internal calls and period-closing writes retain refusal on unknown FX. Transaction summary/tool contracts carry nullable totals and named known subtotals; monthly charts still refuse missing FX until their partial-result public/UI contract is implemented.
