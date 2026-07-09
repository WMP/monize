# Account Detail Pages for All Account Types

## Background

Loan, mortgage, and line-of-credit accounts have a dedicated detail page at
`/accounts/[id]` (`LoanDetailView` / `LineOfCreditView` in
`frontend/src/components/accounts/loan-detail/`). It shows summary cards, a
balance/payoff chart, an amortization schedule, an overpayment simulator with
saved scenarios, past-impact analysis, and a rate-history panel. Every other
account type redirects from `/accounts/[id]` straight to the transaction
register (`/transactions?accountId=`).

This plan extends the dedicated-page concept to the remaining account types:
`CHEQUING`, `SAVINGS`, `CASH`, `CREDIT_CARD`, `INVESTMENT` (brokerage +
cash pair), `ASSET`, and `OTHER`.

## Goals

- Every account gets a "home page" that answers "how is this account doing?"
  at a glance and offers the actions that make sense for its type.
- Maximize reuse of existing backend analytics (most of what is needed
  already exists and is `accountId`-aware).
- Keep the register one click away -- the detail page complements it, it does
  not replace it.

## Architecture

`/accounts/[id]/page.tsx` becomes the universal account detail route. Today it
branches `LINE_OF_CREDIT` -> `LineOfCreditView`, `LOAN`/`MORTGAGE` ->
`LoanDetailView`, and redirects everything else. The redirect is replaced with
a per-type view registry:

| Account type | View component |
|---|---|
| LOAN, MORTGAGE | `LoanDetailView` (existing) |
| LINE_OF_CREDIT | `LineOfCreditView` (existing) |
| CREDIT_CARD | `CreditCardDetailView` (new) |
| CHEQUING, SAVINGS, CASH | `BankingDetailView` (new; small per-type variations) |
| INVESTMENT (brokerage or cash half) | `InvestmentDetailView` (new; resolves the pair) |
| ASSET, OTHER | `AssetDetailView` (new) |

### Shared shell (extracted first)

A common `AccountDetailShell` provides what every view needs, so each new view
is mostly composition:

- `PageHeader` with account name, formatted type + currency, institution logo,
  and standard actions: View transactions, Reconcile (where applicable),
  Edit account, Export (CSV/QIF via `GET /accounts/:id/export`), Back to accounts.
- `SummaryCardGrid` -- generalized from `LoanSummaryCards` (a row of key-figure
  cards with label/value/subtext).
- `BalanceHistoryChart` -- already exists and is fed by
  `GET /accounts/daily-balances` (accountIds-aware, already projects scheduled
  transactions into the future).
- `UpcomingScheduledPanel` -- scheduled transactions for this account
  (`scheduled_transactions.accountId` / `transferAccountId`), with next due
  dates and skip/post shortcuts.
- `RecentActivityList` -- last N transactions with a link to the full register.
- Reconciliation status chip -- last reconciled date + uncleared count, from
  `GET /transactions/reconcile/:accountId` summary data.

Existing per-account analytics to reuse everywhere: transaction analytics
(`GET /transactions/summary`, `grouped-totals`, `monthly-totals`,
`recurring-charges` -- all accept `accountId`), net-worth monthly balances
(`monthly_account_balances`), and projected balance
(`AccountsService.getProjectedBalance`).

### Navigation

- Rename the row action `loanDetails` -> `details` in
  `AccountRow.tsx`/`AccountList.tsx` and show it for every account type.
- Keep the current row-click behaviour (register for most types, `/investments`
  for brokerage) unchanged in phase 1 to avoid disrupting muscle memory.
  Once the pages have proven themselves, consider a user preference
  ("account click opens: Register | Account page") in Settings -> Preferences.
- Dashboard/net-worth widgets that list accounts should deep-link to the
  detail page.

## Per-type design

### CREDIT_CARD -- `CreditCardDetailView`

The highest-value new page. The entity already has `creditLimit`,
`interestRate`, `statementDueDay`, and `statementSettlementDay`; the missing
piece is statement-cycle logic (net-new backend work).

**Show:**
- Summary cards: current balance, credit limit, available credit, utilization %
  (reuse the utilization bar from `LineOfCreditView`), interest rate.
- Statement panel: current cycle window (derived from `statementSettlementDay`),
  statement balance as of last settlement, payment due date (from
  `statementDueDay`) with days-remaining countdown, amount paid since statement.
- Balance history chart with statement-close markers.
- Spending breakdown for this card: by category and by payee for the current
  cycle / month (from `grouped-totals`).
- Recurring charges detected on this card (`GET /transactions/recurring-charges`
  already exists) -- "subscriptions living on this card".
- Interest & fees paid YTD (transactions in the interest category on this account).

**Do:**
- Record or schedule a payment: pre-filled transfer from a chosen funding
  account for statement balance / full balance / custom amount (creates a
  transaction or a `ScheduledTransaction`).
- Set up a due-date reminder (a cron alert like `mortgage-reminder.service.ts`).
- Reconcile against a statement (link to `/reconcile?accountId=`).
- Carried-balance payoff calculator: "paying $X/month, debt-free by ___ and
  $Y interest" -- reuses the loan schedule engine (`lib/loan-schedule.ts`)
  with revolving math.
- Edit limit / rate / statement days inline.

**New backend:** `StatementCycleService` (compute cycle boundaries + statement
balance from transactions and the day-of-month fields), optional
`minimumPayment`/`minimumPaymentPercent` columns, due-date reminder cron.

### CHEQUING / SAVINGS / CASH -- `BankingDetailView`

**Show:**
- Summary cards: current balance, projected balance (existing
  `getProjectedBalance`), money in / money out this month (`monthly-totals`),
  last reconciled.
- Balance history + forecast chart (daily-balances already projects scheduled
  transactions -- render the future segment styled like the loan page's
  projection).
- Upcoming bills/scheduled transactions hitting this account, including
  transfers in.
- Cash-flow mini-report: monthly in/out bars for the trailing 12 months.
- Top payees / top categories for this account.
- Recurring charges paid from this account.
- SAVINGS extras: interest rate field surfaced, interest earned YTD
  (income-category transactions on this account), average balance.

**Do:**
- Add transaction / add transfer (pre-scoped to this account).
- Reconcile.
- Manage the account's scheduled transactions.
- Low-balance alert threshold (new column + notification hook) -- pairs
  naturally with the projected-balance chart ("you dip below $500 on the 23rd").
- SAVINGS (later phase): savings goals -- target amount + date, progress bar,
  required monthly contribution. This is a net-new feature (entity + CRUD);
  ship it as its own follow-up rather than blocking the page.

### INVESTMENT -- `InvestmentDetailView`

Mostly composition: the `/investments` page components and the entire
`portfolio` / `holdings` / `investment-transactions` API already accept
`accountIds`. The view resolves the cash/brokerage pair via
`GET /accounts/:id/investment-pair` and presents the logical account.

**Show:**
- Summary cards: total value (holdings + cash half), cost basis, unrealized
  gain/loss ($ and %), time-weighted return and CAGR (already computed by
  `PortfolioService.getPortfolioSummary`), cash available.
- Holdings list (`GroupedHoldingsList` scoped to the account).
- Asset allocation donut for just this account.
- Account value over time (`net-worth/investments-daily` scoped).
- Top movers today within this account.
- Income panel: dividends/interest YTD and realized capital gains
  (`investment-transactions/realized-gains`, `capital-gains`).
- Recent investment transactions.

**Do:**
- Add an investment transaction (buy/sell/dividend/...) pre-scoped.
- Refresh prices for this account's securities.
- Rebuild holdings.
- Set up a recurring contribution (scheduled transaction with the existing
  investment leg).
- Jump to the full `/investments` view filtered to this account.

### ASSET / OTHER -- `AssetDetailView`

**Show:**
- Summary cards: current value, purchase value (`openingBalance`), total and
  annualized appreciation since `dateAcquired`, asset category.
- Value history chart (from `monthly_account_balances` / daily-balances --
  value changes are balance-adjustment transactions).
- **Equity panel when a loan is linked**: for a house + mortgage, show asset
  value minus linked loan balance = equity, with an equity-over-time chart.
  Requires a lightweight `linkedLoanAccountId` association (new nullable
  column) or a heuristic prompt to pick the loan.

**Do:**
- "Update value" quick action that records a balance-adjustment transaction
  with a date (keeps history clean without touching the register).
- Edit acquisition details / category.
- Link or unlink a loan for the equity view.

### LINE_OF_CREDIT (existing view, incremental)

Backfill the shared shell (scheduled panel, recent activity, export) and add
interest-paid history and a paydown simulator reusing the credit-card
carried-balance calculator.

## Backend work summary

| Item | Effort | Notes |
|---|---|---|
| Statement-cycle service + endpoints for credit cards | New service in `accounts/` or a small `statements/` module | Pure computation over transactions + day-of-month fields |
| Due-date / low-balance reminders | Small | Follow `mortgage-reminder.service.ts` pattern |
| Interest earned/paid YTD helpers | Small | Category-scoped sums via `TransactionAnalyticsService` |
| `linkedLoanAccountId` on accounts (asset equity) | Migration + DTO | Also update `database/schema.sql` |
| Optional: `minimumPayment`, `lowBalanceThreshold` columns | Migration | Only if the corresponding UI ships |
| Savings goals module | Net-new (entity, CRUD, progress calc) | Separate follow-up PR |
| Per-account params on built-in reports | Only if a page embeds one | Transaction analytics already covers most needs with `accountId` |

Any new aggregate endpoint that is also useful to the AI assistant must follow
the shared-tool rule: implement on the domain service, expose through both the
AI tool executor and the MCP server in the same PR.

## Rollout phases

1. **Phase 0 -- scaffolding.** Extract `AccountDetailShell` +
   `SummaryCardGrid`; generalize the `/accounts/[id]` branching; rename the
   row action to "Details" for all types; wire the shell into the two
   existing debt views. No behaviour change for debt accounts.
2. **Phase 1 -- Credit card.** Statement-cycle backend + `CreditCardDetailView`.
   Highest user value, moderate new backend.
3. **Phase 2 -- Banking.** `BankingDetailView` for chequing/savings/cash.
   Almost entirely reuse; fastest visible win after the shell exists.
4. **Phase 3 -- Investment.** `InvestmentDetailView` composing existing
   portfolio components scoped by account.
5. **Phase 4 -- Asset/Other.** `AssetDetailView` + equity linking.
6. **Follow-ups.** Savings goals; row-click preference; LOC enhancements;
   alert thresholds.

Each phase is a self-contained PR: English-first i18n during development with
one full localization pass at acceptance, co-located component tests (the
loan-detail components set the pattern), backend unit tests for any new
service, and `database/schema.sql` updated alongside every migration.
