# Monize Audit Phase 6: Frontend Contracts, Adapters, Components, Caching, and Localization

## Report metadata

| Field | Value |
| --- | --- |
| Repository | `kenlasko/monize` |
| Audit phase | Phase 6 - Frontend Contracts, Adapters, Components, Caching, and Localization |
| Worker chat | `06 - Monize Audit: Frontend Contracts` |
| Audited baseline | `d5cea9bfa995885ba5198f9843359362927c0fd4` |
| Baseline policy | Every evidentiary repository read was explicitly pinned to the audited SHA |
| Audit date | 2026-08-02 |
| Completion status | Complete subject to the limitations recorded below |
| Report filename | `monize-audit-06-frontend-contracts.md` |

## Executive finding summary

This phase confirmed 15 distinct frontend or cross-layer contract defects. It did not copy backend defects under new identifiers: every confirmed item establishes a separate frontend payload, transformation, cache, state, or presentation failure.

| Severity | Confirmed findings |
| --- | ---: |
| BLOCKER | 0 |
| HIGH | 10 |
| MEDIUM | 5 |
| LOW | 0 |
| **Total** | **15** |

The highest-risk themes are:

1. Transfer workflows can send status and FX payloads that violate linked-leg or cross-currency invariants.
2. Investment preview, security-transfer, scheduled-override, portfolio, and Monte Carlo paths turn missing, stale, or changed valuation inputs into ordinary-looking financial numbers.
3. Two OIDC destructive workflows describe identity-provider reauthentication but submit a fixed string instead, and logout failure is presented as successful local logout.
4. The frontend intentionally treats a missing FX rate as 1:1 and presents the result as complete net worth or account totals.
5. Transaction writes clear account and investment caches but not cached budget summaries, leaving successful writes followed by materially stale budget progress.

### Confirmed finding index

| ID | Severity | Confidence | Title |
| --- | --- | --- | --- |
| P6-001 | HIGH | high | Bulk status updates can VOID one leg of a linked transfer |
| P6-002 | HIGH | high | Direct, scheduled, and split transfer forms serialize an incomplete cross-currency contract |
| P6-003 | HIGH | high | Investment preview substitutes 1:1 while commit can resolve a different server-side FX rate |
| P6-004 | HIGH | high | Foreign-security transfer requests omit the account-currency basis conversion contract |
| P6-005 | HIGH | high | Reopening a scheduled investment override replaces its stored price with the latest market price |
| P6-006 | HIGH | high | Missing exchange rates are returned unchanged and labelled as converted complete totals |
| P6-007 | HIGH | high | Unavailable or partial portfolio valuations are rendered as complete ordinary totals |
| P6-008 | HIGH | high | Monte Carlo valuation failure or unknown current balance is coerced to a real zero |
| P6-009 | HIGH | high | Restore and account deletion claim OIDC reauthentication but submit a fixed confirmation string |
| P6-010 | HIGH | high | Logout API failure is hidden while a refreshable server session may remain |
| P6-011 | MEDIUM | high | The split editor permits mixed-sign children that reverse part of the parent transaction |
| P6-012 | MEDIUM | high | Two-decimal split editing and one-cent tolerance conflict with four-decimal persistence |
| P6-013 | MEDIUM | high | The Cost Basis tooltip promises transaction fees that the implemented basis excludes |
| P6-014 | MEDIUM | high | Support-backup privacy copy says names are masked while custom currency names and symbols are kept |
| P6-015 | MEDIUM | high | Transaction mutations leave cached budget progress stale after success |

## 1. Phase scope

The assigned scope was the complete material frontend contract path:

```text
backend entity / DTO / response
-> handwritten frontend type
-> API client
-> adapter or transformer
-> hook or store
-> cache
-> component or form
-> form serialization
-> localization
-> frontend tests
```

The review focused on financial signs, transfer linkage, currency and FX direction, precision, null/zero/unknown states, date-only handling, stale prices, cost basis, simulations, optimistic behavior, mutation invalidation, delegated identity, destructive security wording, backup and restore contracts, and localization of finance- or security-sensitive states. It did not perform a generic visual, styling, component-size, or subjective UX review.

## 2. Audited baseline SHA

The immutable baseline for this phase was:

```text
AUDIT_BASELINE_SHA=d5cea9bfa995885ba5198f9843359362927c0fd4
```

The commit was fetched successfully before implementation review. Every file used as evidence was subsequently fetched with this exact `ref`. Search results that pointed to the current default branch or another revision were used only for candidate path discovery and were not treated as evidence.

## 3. Method

### 3.1 Review method

The phase used a read-only, connector-first workflow:

1. Confirm the fixed commit object was available.
2. Read repository and subtree instructions before implementation code.
3. Build a frontend architecture inventory.
4. Trace material domains from backend DTO/entity/service through frontend type, client, state, component, and tests.
5. Reconcile Phase 1-5 findings against distinct frontend behavior.
6. Build sign, currency, precision, null-state, date, cache, and localization matrices.
7. Investigate plausible false positives and record rejected hypotheses.
8. Re-fetch focused, SHA-pinned ranges for every confirmed finding.
9. Avoid runtime claims because no test, browser, API, database, or deployment execution was available.

### 3.2 Evidence standard

A defect was confirmed only when the static path established all of the following:

- a concrete backend contract or expected invariant;
- a frontend transformation, request, cache decision, or presentation that violates it;
- a realistic reproduction with a material result;
- exact source paths and relevant ranges at the audited SHA;
- a correction and regression-test strategy.

Earlier backend defects were not duplicated unless the frontend independently created an invalid request, transformed a correct value incorrectly, hid a material unknown/partial state, left a materially stale cache, or made a false security/privacy promise.

### 3.3 Execution status

| Activity | Status |
| --- | --- |
| Repository clone | Not available; DNS prevented cloning |
| SHA-pinned GitHub file reads | Performed |
| Recursive immutable tree | Not available |
| Frontend build | Not executed |
| TypeScript type-check | Not executed |
| ESLint | Not executed |
| Vitest | Not executed |
| Playwright / browser scenarios | Not executed |
| Backend unit/integration tests | Not executed |
| API calls against a running deployment | Not executed |
| Database or RLS queries | Not executed |
| Backup/restore runtime | Not executed |
| CI logs and artifacts | Not available for the audited SHA |
| Commit combined status | Queried; connector returned no statuses |
| Commit workflow runs | Queried; connector returned no runs |

## 4. Repository instruction hierarchy

The following instruction sources were read before implementation review. More specific files were treated as authoritative for their subtree.

| Priority | Path | Scope | Disposition |
| ---: | --- | --- | --- |
| 1 | `frontend/CLAUDE.md` | Frontend subtree | Primary frontend rules |
| 1 | `backend/src/mcp/CLAUDE.md` | MCP subtree | Applied where MCP behavior was referenced |
| 1 | `backend/CLAUDE.md` | Backend subtree | Primary backend rules |
| 1 | `database/CLAUDE.md` | Database subtree | Primary database rules |
| 2 | `CLAUDE.md` | Repository-wide | Applied unless overridden by a nearer file |
| 3 | `.claude/skills/frontend.md` | Auxiliary frontend guidance | Read as potentially stale guidance |
| 3 | `.claude/skills/backend.md` | Auxiliary backend guidance | Read as potentially stale guidance |
| 3 | `.claude/skills/infrastructure.md` | Auxiliary infrastructure guidance | Read as potentially stale guidance |
| 3 | `.claude/settings.json` | Tooling/config guidance | Read |
| 4 | `README.md` | Product and development overview | Sampled for implemented behavior and terminology |
| 4 | `CONTRIBUTING.md` | Contributor workflow | Read; one stale contradiction recorded |
| 4 | `SECURITY.md` | Security reporting guidance | Read |

No `AGENTS.md` was located through repository search. Because the connector did not expose a recursive immutable tree, this is recorded as "not located," not as proven repository-wide absence.

### 4.1 Confirmed instruction/documentation contradiction

`CONTRIBUTING.md` still describes `QueryRunner` as the transaction pattern, while the nearer and newer repository/backend instructions require `withScopedDb` and prohibit `QueryRunner`. This is stale contributor documentation, not a Phase 6 implementation defect.

## 5. Frontend architecture inventory

| Area | Implementation and paths | Review status | Material notes |
| --- | --- | --- | --- |
| Routing and layout | Next.js App Router under `frontend/src/app`; shared layout components under `frontend/src/components/layout` | Sampled | Route-level pages own much of their loading state and error handling |
| Authentication/session | `frontend/src/lib/auth.ts`; `frontend/src/store/authStore.ts`; `frontend/src/lib/api.ts`; `frontend/src/components/layout/AppHeader.tsx` | Full or focused reads | HttpOnly cookies; Zustand tracks UI state; refresh requests are queued in the Axios interceptor |
| Delegation context | `frontend/src/lib/delegation.ts`; `frontend/src/components/layout/DelegationBanner.tsx`; `authStore.ts` | Focused | Context switch performs a full reload; cache leakage on switch was not confirmed |
| API client/interceptors | `frontend/src/lib/api.ts` | Focused | Axios, `/api/v1`, cookies, CSRF retry, timezone header, and 401 refresh queue |
| Query/cache library | `frontend/src/lib/apiCache.ts` | Full | No React Query dependency was found; a global Map provides TTL caching and in-flight deduplication |
| Query-key convention | String prefixes such as `accounts:`, `investments:`, `budgets:`, `scheduled:` | Full for cache core; sampled by domain | Prefix invalidation is manual and therefore easy to omit |
| Mutation clients | Domain modules under `frontend/src/lib/*.ts` | Sampled broadly | Most mutations await the server, then invalidate one or more prefixes |
| Optimistic updates | No general optimistic transaction layer located | Sampled | Core financial mutations generally wait for success; stale-cache defects still occur after success |
| Global/local stores | Zustand stores including `authStore.ts` and `preferencesStore.ts`; component-local state for most forms | Sampled | Logout clears API cache, preferences, AI chat, and Monte Carlo local cache |
| Forms | React Hook Form, Zod, `CurrencyInput`, `NumericInput`, `DateInput` | Full or focused reads | Money input normalizes to two decimals even where storage accepts four |
| Type definitions | Handwritten interfaces under `frontend/src/types` | Sampled broadly | Contracts are duplicated manually rather than generated from OpenAPI |
| Adapters/transformers | Mostly inline in pages, hooks, and form submit handlers | Sampled broadly | Several defects arise from inline `Number(...)`, `|| 0`, `|| 1`, and omission rules |
| Date handling | `frontend/src/lib/utils.ts`; `frontend/src/hooks/useDateFormat.ts`; `frontend/src/components/ui/DateInput.tsx` | Focused | Date-only parsing uses local components instead of `new Date("YYYY-MM-DD")`; no day-shift defect confirmed |
| Currency/number formatting | `frontend/src/hooks/useNumberFormat.ts`; `frontend/src/components/ui/CurrencyInput.tsx`; `frontend/src/lib/format.ts` | Sampled/full | Display is generally two-decimal currency; rate/quantity inputs use separate numeric fields |
| Percentage formatting | `useNumberFormat` and report helpers | Sampled | Monte Carlo percentages are decimal fractions; account interest rates use whole-percent style fields |
| Localization | `frontend/src/i18n/config.ts`; `frontend/src/i18n/messages.ts`; locale catalogs; parity tests | Full core, sampled catalogs | 22 production locale identifiers plus pseudo-locale `xx`; structural parity is tested, semantic parity is not |
| Error handling | `frontend/src/lib/errors.ts`; toast-based component handling | Sampled | Several optional data loads swallow errors and substitute null/zero-like states |
| Loading/empty/error/partial states | Page-local conditions | Sampled | Partial portfolio and FX states are not consistently represented |
| Frontend tests | Vitest, Testing Library, co-located tests | Sampled | Two tests explicitly entrench incorrect behavior identified in this phase |
| Browser tests | `e2e/playwright.config.ts`, `e2e/package.json`, `.github/workflows/ci.yml` | Configuration read | Chromium and Firefox configured; locale fixed to English; no run evidence available |
| CI | `.github/workflows/ci.yml` | Sampled focused ranges | Frontend lint/type/i18n/unit coverage and full-stack Playwright jobs are configured, but no run/status was visible for the baseline SHA |

### 5.1 Important architectural invariant: two cache layers

The frontend does not rely only on component refetches. `apiCache.ts` caches account and investment responses for up to two minutes in some callers. Navigating back to a page may still return the cached value. Therefore, correctness requires every write to invalidate every affected prefix, not merely to call a page reload callback.

### 5.2 Type generation status

No generated frontend contract package was located. Material contracts are handwritten in files such as:

- `frontend/src/types/account.ts`
- `frontend/src/types/transaction.ts`
- `frontend/src/types/investment.ts`
- `frontend/src/types/scheduled-transaction.ts`
- `frontend/src/types/budget.ts`
- `frontend/src/lib/monte-carlo.ts`
- `frontend/src/lib/backupApi.ts`

This raises drift risk, but drift was reported only where a realistic failure was confirmed.

## 6. Backend-to-frontend contract matrix

Status meanings:

- **Confirmed defect**: a Phase 6 finding is linked.
- **No material defect located**: the sampled path did not establish a material frontend defect.
- **Exposure only**: the frontend consumes an accepted backend defect but adds no distinct failure.
- **Partially traced**: connector coverage was insufficient for a complete parity claim.

| Domain | Backend DTO/response | Frontend type | Adapter/client | Hook/store | Component/form | Tests examined | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Users/profile/delegation | `backend/src/users/*`; delegated profile behavior from Phase 2 | `frontend/src/types/auth.ts`; delegation interfaces in `frontend/src/lib/delegation.ts` | `frontend/src/lib/auth.ts`; `frontend/src/lib/delegation.ts` | `frontend/src/store/authStore.ts` | `frontend/src/components/layout/DelegationBanner.tsx`; settings access UI | Delegation tests located through sampled paths | No material cache-switch defect located; full reload clears context caches |
| Accounts | `backend/src/accounts/entities/account.entity.ts`; account controller/service paths sampled | `frontend/src/types/account.ts` | `frontend/src/lib/accounts.ts` | Page-local state; number/date hooks | `frontend/src/app/accounts/page.tsx`; account and loan components sampled | Account/type tests sampled | Confirmed defects P6-006 and P6-007 in aggregate presentation |
| Transactions | `backend/src/transactions/dto/create-transaction.dto.ts`; `transaction.entity.ts` | `frontend/src/types/transaction.ts` | `frontend/src/lib/transactions.ts` | Page-local state and `useTransactionSelection` | `TransactionForm.tsx`; transaction page | Form and cache guard tests sampled | Confirmed P6-015; core account/investment balance invalidation otherwise present |
| Transfers | `create-transfer.dto.ts`; `transaction-transfer.service.ts` | `CreateTransferData`, `TransferResult` in `types/transaction.ts` | `transactionsApi.createTransfer/updateTransfer` | Local form state | `TransactionForm.tsx`; `TransferTransactionFields.tsx`; bulk modal | Targeted transfer tests not sufficient for edge cases | Confirmed P6-001 and P6-002 |
| Splits | `create-transaction-split.dto.ts`; `transaction-split.service.ts`; `split-amount.util.ts` | `CreateSplitData`, `TransactionSplit` | `transactionsApi` | Local split state | `SplitEditor.tsx`; transaction and scheduled forms | `SplitEditor.test.tsx` sampled | Confirmed P6-002, P6-011, P6-012 |
| Scheduled transactions | `scheduled-transactions.service.ts`; scheduled DTOs | `frontend/src/types/scheduled-transaction.ts` | `frontend/src/lib/scheduled-transactions.ts` | Local page/dialog state | `ScheduledTransactionForm.tsx`; `OverrideEditorDialog.tsx` | `OverrideEditorDialog.test.tsx` sampled | Confirmed P6-002 and P6-005 |
| Investments | `create-investment-transaction.dto.ts`; `investment-transactions.service.ts`; investment entity | `frontend/src/types/investment.ts` | `frontend/src/lib/investments.ts` | Local form state; exchange-rate hook | `InvestmentTransactionForm.tsx` | Form tests sampled | Confirmed P6-003, P6-004, P6-013 |
| Holdings | `portfolio-calculation.service.ts`; portfolio response | Holding and portfolio interfaces in `types/investment.ts` | `investmentsApi.getPortfolioSummary` | Page-local state | `GroupedHoldingsList.tsx`; `PortfolioSummaryCard.tsx` | `PortfolioSummaryCard.test.tsx` | Confirmed P6-007 and P6-013 |
| Prices | Securities/price services sampled through portfolio and investment services | Price fields in investment types | Investments and securities clients | Component-local latest-price fetch | Investment form; override dialog | Override tests sampled | Confirmed P6-005 and partial-value contribution to P6-007 |
| Budgets | Budget service/response paths sampled | `frontend/src/types/budget.ts` | `frontend/src/lib/budgets.ts` | API cache prefixes | Budget pages/widgets sampled | Budget tests not exhaustively inventoried | Backend P5-007 exposure; distinct cache defect P6-015 |
| Loans/mortgages | Account entity and loan posting behavior from Phase 5 | Loan and mortgage types in `types/account.ts` | `accountsApi`; schedule helpers | Local projection state | `LoanPaymentSetupDialog.tsx`; loan schedule components | Loan schedule tests sampled | No duplicate of P5-008; frontend projection caps final principal |
| Net worth | Net-worth and portfolio services from Phase 5 | Account summary and report types | Accounts, investments, exchange-rate clients | `useExchangeRates` | Accounts page and report cards | Exchange-rate tests sampled | Confirmed P6-006 and P6-007 |
| Monte Carlo | Monte Carlo services and Phase 5 valuation path | `HistoricalStats`, scenario and result interfaces in `lib/monte-carlo.ts` | `monteCarloApi` | `useMonteCarloScenarios.ts`; local result cache | `MonteCarloReport.tsx` | Hook/report tests sampled | Confirmed P6-008 |
| Generic imports | Import controllers/services sampled through pages and prior phase evidence | Import page-local types | Import clients under `frontend/src/lib` | Page-local state | `frontend/src/app/import/page.tsx` | Import tests sampled | Partially traced; no distinct generic-import frontend defect confirmed |
| MNY jobs | `mny-import-job.service.ts`; `mny-import.service.ts` | MNY job interfaces in `frontend/src/lib/import-mny.ts` | `mnyImportApi` | `useMnyImport.ts` | `MnyImportProgress.tsx`; import page | Tests sampled | Start idempotency remains a design risk; partial-write retry hypothesis rejected |
| Attachments | Attachment controllers/services from Phase 4 | `frontend/src/types/attachment.ts` | `frontend/src/lib/attachments.ts` | Component-local list | Attachment UI sampled | Attachment tests not fully inventoried | No new frontend defect confirmed; list is not cached and mutations invalidate attachment prefix |
| Backup export | Backup controller/services from Phase 3 | Interfaces in `backupApi.ts` | `backupApi.exportBackup` | Local settings state | `BackupRestoreSection.tsx` | Tests sampled | Backend risks exposed; no distinct export transformation defect confirmed |
| Restore | Backup restore service and step-up service | `RestoreResult` | `backupApi.restoreBackup` | Local settings state; global cache clear in client | `BackupRestoreSection.tsx` | Tests sampled | Confirmed P6-009; post-restore API cache is correctly cleared |
| Support backup | `support-backup-rules.ts` | Support backup input/preview types | `backupApi.supportExport*` | Local modal state | `SupportBackupModal.tsx` | Support-backup tests sampled | Confirmed P6-014 |
| Automatic backup | `auto-backup.service.ts` | Auto-backup settings in auth types | `backupApi` auto-backup methods | Local settings state | `AutoBackupSection.tsx` | Tests sampled | Backend durability/path risks exposed; no distinct frontend defect confirmed |
| Emergency access | Emergency-access controller/service and Phase 4 claim findings | `frontend/src/types/emergency-access.ts` | `frontend/src/lib/emergency-access.ts` | Step-up token store | Claim page and settings page sampled | Claim/settings tests located | No new duplicate-consumption defect confirmed; completeClaim sends once per explicit action |
| Authentication/logout/refresh | Auth controller/service and Phase 4 rotation race | `frontend/src/types/auth.ts` | `frontend/src/lib/auth.ts`; Axios interceptor | `authStore.ts` | `AppHeader.tsx` | Auth tests sampled | Confirmed P6-010 |
| AI insights | AI backend paths and Phase 4 duplicate generation | Handwritten AI types under frontend paths | AI clients/components discovered only partially | Local/chat state | AI menu and chat paths sampled | Complete inventory not established | Partially traced; no Phase 6 confirmed defect |
| Notifications | Budget alerts plus notification/reminder paths from earlier phases | Budget alert types; other notification contracts not fully located | `budgetsApi` alert methods; other clients incomplete | Component-local state | Notification surfaces sampled | Complete inventory not established | Partially traced; no Phase 6 confirmed defect |

### 6.1 Contract drift observations

- Material contracts are duplicated manually in TypeScript.
- Date-only fields are generally typed as strings, which aligns with the backend invariant.
- PostgreSQL decimals are converted to JavaScript numbers before most frontend calculations.
- Optionality is frequently implemented with truthiness (`|| 0`, `|| 1`, or `field ? value : undefined`), which collapses zero, absent, and unknown states.
- Portfolio responses contain per-holding `null` values that can signal incomplete valuation, but top-level totals do not carry an explicit completeness flag.
- The Monte Carlo historical-stats contract types `currentBalance` as an unconditional number, so a real zero and a valuation failure reduced to zero are indistinguishable.

## 7. Amount and sign matrix

| Operation | Backend stored sign | Form sign | API request sign | Display sign | Counterpart sign | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Income | Positive | Positive after category/type inference | Positive | Positive/inflow | N/A | Sampled; no material defect confirmed |
| Expense | Negative | User often enters magnitude; category/type applies negative sign | Negative | Expense styling may show magnitude with context | N/A | Sampled; no double-negation defect confirmed |
| Transfer source | Negative transaction leg | Positive magnitude in transfer form | Positive `amount`; backend creates negative source leg | Source leg shown as outflow | Destination positive | P6-001 and P6-002 |
| Transfer destination | Positive | Entered as optional received amount | Optional positive `toAmount` | Inflow | Source negative | P6-002 |
| Category split | Expected to share parent sign | Per-row sign inferred and toggleable | Signed child values | Signed row values | N/A | P6-011; mixed signs can balance numerically |
| Transfer split | Parent/child source sign; linked target inverse | One source-currency amount | Single signed split amount and target account ID | Source split and target linked leg | Inverse linked leg | P6-002; no FX field |
| Investment BUY | Investment quantity/price positive; linked cash negative | Positive quantity, price, commission | Positive fields | Purchase/negative cash context | Cash outflow | P6-003 and P6-013 |
| Investment SELL | Investment quantity/price positive; linked cash positive | Positive quantity and price | Positive fields | Sale/positive cash context | Cash inflow | Sampled; no sign defect confirmed |
| Dividend/interest/capital gain | Positive cash action | Positive amount | Positive `totalAmount`/price field | Inflow | Cash positive | Sampled |
| Loan payment | Source cash leg negative; loan principal leg moves liability toward zero | Positive payment magnitude | Positive scheduled/payment amount; backend constructs legs | Payment and projected principal/interest | Loan balance increases toward zero | Frontend projection reviewed without a new sign defect |
| Refund | Positive income-like transaction | Positive | Positive | Inflow | N/A | Sampled |
| VOID transaction | Excluded from effective balances | Status selected independently | Enum value `VOID` | Labelled as void | Linked transfer must change together | P6-001 |
| Future transaction | Stored sign retained; current-balance inclusion depends on date/status | Same as ordinary transaction | Same as ordinary transaction | Often projected separately | Same rules as counterpart | Sampled; no frontend-only defect confirmed |

### 7.1 Confirmed sign example

For P6-001, start with two USD accounts:

```text
Checking: 1,000.00 USD
Savings:      0.00 USD
Transfer:   100.00 USD
After active transfer: 900.00 + 100.00 = 1,000.00 USD
```

Select only the source leg and bulk-update it to `VOID`. The frontend sends only the selected source transaction ID. The source balance is restored to 1,000.00 while the destination leg remains active at 100.00. Displayed combined wealth becomes 1,100.00 USD, an incorrect increase of 100.00 USD.

## 8. Currency and FX matrix

| Path | Source currency | Destination currency | Rate direction | Input field | Request field | Display | Missing/stale behavior | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Ordinary foreign transaction | Original entry currency | Account currency | Account-currency units per 1 original unit | Original amount/currency and rate | `originalAmount`, `originalCurrencyCode`, `exchangeRate` | Account amount plus original context | Contract sampled; no distinct defect confirmed |
| Direct transfer | Source account | Destination account | Required: destination units per 1 source unit | Source amount plus optional received amount | `amount`, optional `toAmount`; no rate | Source and received amounts | Missing received amount falls through to server rate default 1 | P6-002 |
| Scheduled transfer | Source account | Destination account | Not represented | One amount only | Source amount and target account | Scheduled transfer label | Cross-currency target accepted without rate or destination amount | P6-002 |
| Transfer split | Parent/source account | Target split account | Not represented | One split amount only | `amount`, `transferAccountId` | Split target account | Backend linked leg receives implied 1:1 | P6-002 |
| Investment preview | Security currency | Cash/funding account currency | Cash units per 1 security unit | Optional exchange-rate field | Optional `exchangeRate` | Converted total | Preview uses `rate || 1`; commit may omit and resolve another server rate | P6-003 |
| Investment commit | Security currency | Cash/funding currency | Server resolves explicit, dated, or latest rate | Optional | Omitted when absent | Persisted cash transaction | Can differ from preview | P6-003 |
| Security transfer | Security/native basis | Destination account currency | Required for account-currency basis, absent from contract | Cost per share only | `costPerShare`; no FX/basis field | UI says cost basis is carried | Backend creates destination leg with exchange rate 1 | P6-004 |
| Holdings/cost basis | Security currency | Holding account and default currency | Historical purchase rates for basis; current rates for market value | None | Response fields | Portfolio values and gain/loss | Commission excluded; missing price produces null holding value | P6-007, P6-013 |
| Account/net-worth totals | Account currency | User default currency | Direct or inverse latest rate | None | Client rate map | Ordinary total cards | Missing rate returns original amount unchanged | P6-006 |
| Portfolio totals | Holding/account currency | Default or selected display currency | Client conversion for foreign display | None | Client rate map | Ordinary totals | Missing rates and prices are not labelled incomplete | P6-006, P6-007 |
| Reports | Mixed source currencies | Display currency | Client/server path varies by report | None | Report-specific | Charts/cards | Sampled; incomplete full matrix due connector limits | Partially traced |
| Monte Carlo current value | Portfolio valuation currencies | Scenario currency/value | Server valuation path | Account selection | Account IDs | Starting value and simulation | Failure/unknown becomes numeric zero | P6-008 |
| Backup/restore displays | Stored currencies | None | None | None | Raw backup artifact | Record counts and metadata | No conversion; privacy/coverage wording reviewed separately | P6-009, P6-014 |

### 8.1 Required transfer example

```text
Source: 100.00 USD
Expected rate: 0.9000 EUR per USD
Frontend request when received amount is left blank: amount=100.00, toCurrencyCode=EUR, no exchangeRate, no toAmount
Server default: exchangeRate=1.0
Produced destination amount: 100.00 EUR
Expected destination amount: 90.00 EUR
Difference: +10.00 EUR (+11.11% versus expected)
```

The same incomplete contract exists in scheduled transfers and transfer splits, where the UI does not collect even the optional destination amount.

## 9. Precision and rounding matrix

| Value | Database precision | Backend serialization/calculation | Frontend representation | Form step/normalization | Display | Rounding point | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Transaction money | `decimal(20,4)` | Four-decimal helpers and exact rounded split comparison | JavaScript `number` | `CurrencyInput` formats and normalizes to cents | Usually 2 decimals | Input blur and split helpers | P6-012 |
| Original amount | `decimal(20,4)` | Number transformer | `number | null` | Currency input | Currency decimals, generally 2 | Input and backend money helper | Sampled |
| Exchange rate | `decimal(20,10)` | Explicit/date/latest resolution | JavaScript `number` | Investment auto-fill rounds for display; optional field | Usually up to 6-10 significant decimals | Client input plus backend persistence | P6-003; transfer rate absent in P6-002 |
| Investment quantity | `decimal(20,8)` | Number transformer | JavaScript `number` | Numeric input; override step `0.00000001` | Context-dependent | Browser number parse | No confirmed quantity-rounding defect |
| Unit price | `decimal(24,10)` | Number transformer | JavaScript `number` | Override step `0.000001`; other forms numeric | Context-dependent | Form parse and backend | P6-005 is provenance, not precision |
| Commission | `decimal(20,4)` | Stored separately | JavaScript `number` | Currency input, usually cents | 2 decimals | Input | P6-013 concerns omission from basis |
| Total investment amount | `decimal(20,4)` | Money rounding | JavaScript `number` | Currency input | 2 decimals | Form/backend | Sampled |
| Account balances | `decimal(20,4)` | Number transformer/live aggregation | JavaScript `number` | Account forms use currency input | 2 decimals | Input/display | P6-006/P6-007 are completeness defects |
| Average cost/cost basis | Decimal storage and derived numeric calculations | Weighted calculations in JS/Node numbers | JavaScript `number` | Not directly edited for most holdings | Currency formatting | Service calculations | P6-004, P6-013 |
| Budget amounts | Money decimals | Budget service calculations | JavaScript `number` | Currency input | 2 decimals | Input/backend | P6-015 stale cache, not arithmetic rounding |
| Account interest rate | `decimal(8,4)` | Whole-percent style account value | JavaScript `number` | Numeric form | Percent display | Form/backend | Sampled |
| Monte Carlo rates | Scenario decimal fractions such as `0.07` | Numeric simulation | JavaScript `number` | Numeric/percent controls | Percent formatting | Form conversion | No unit drift confirmed in sampled path |
| Stock split ratio | Stored in investment quantity, scale 8 | Multiplies current holding in current portfolio path | JavaScript `number` | New-shares / old-shares fields | Ratio preview | Form division | No frontend transform defect; backend historical reducer remains P5-011 |
| Split totals | Parent and children are money scale 4 | Exact equality after four-decimal rounding | JavaScript `number` | Two-decimal CurrencyInput; UI tolerance `< 0.01` | 2 decimals | Frontend cents versus backend 4dp | P6-012 |

### 9.1 Confirmed four-decimal example

```text
Stored parent amount: 10.0048
Stored children: 5.0024 + 5.0024 = 10.0048
Frontend edit display: 10.00, 5.00, 5.00
Frontend balance tolerance: abs(remaining) < 0.01
```

An edit can label a 0.0048 discrepancy as balanced or round it away. The backend compares values after four-decimal rounding and can reject a request that the UI labelled balanced. The maximum demonstrated discrepancy is 0.0099 per split set before the frontend changes state from balanced to unbalanced.

## 10. Null, zero, absent, stale, unknown, and partial matrix

| Field/state | Backend omitted | Backend null | Backend zero | Stale | Unknown/partial | Frontend default | Display/submission | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Transaction amount | Invalid for ordinary create | Generally not allowed | May be allowed by some flows | Possible from cached lists | Rare | Form often defaults empty/0 | Sent as number | Sampled |
| Original amount | Ordinary transaction | Ordinary transaction | Valid explicit zero semantics unclear | Possible | N/A | Empty | Omitted/null | No confirmed defect |
| Transfer exchange rate | Optional, server default 1 | Not expected | DTO/default behavior treats absent as 1 | Account/rate data can be stale | Missing rate | No rate control | Omitted | P6-002 |
| Transfer destination amount | Optional | Not expected | UI only sends when `> 0` | Can remain from edit state | Missing | `undefined` | Omitted; server computes with rate | P6-002 |
| Price | Can be absent from latest-price map | Holding `currentPrice` and `marketValue` become null | Real zero is possible but unusual | Latest close may be stale | Unknown price | UI total uses aggregate that skipped null | Ordinary complete-looking number | P6-005, P6-007 |
| Adjusted close | Provider/report specific | Possible | Possible | Possible | Not fully traced | Varies | Varies | Partially traced |
| Quantity | Optional for amount-only actions | Stored null | Form uses `Number(value) || 0` | Possible | N/A | 0 | Action-dependent | No confirmed defect |
| Commission | Optional request | Entity normalizes/defaults | Valid zero | N/A | N/A | 0 | Sent/used as zero | P6-013 because basis ignores non-zero commission |
| Cost basis | Response number | Some holding history fallback | Valid zero | Historical FX can be stale/wrong | Can be incomplete | 0 in aggregate paths | Ordinary currency value | P6-004, P6-013 |
| Market value | N/A | Null when price missing | Valid zero | Price/rate may be stale | Partial portfolio | Aggregates skip null or use `?? 0` | Complete-looking totals | P6-007 |
| Account current balance | Response number | Not expected | Valid | API cache up to 2 minutes | N/A | 0 in some type/form paths | Ordinary currency value | Core transaction writes invalidate; missing FX still misstates P6-006 |
| Budget amount/progress | Response number | Domain-specific | Valid | Dashboard 30s, category status 60s | N/A | Varies | Ordinary progress values | P6-015 |
| Loan rate | Optional | Null when unknown | Valid zero-rate loan | Could be stale after rate change | Unknown | Form-dependent | Numeric/percent | No confirmed frontend defect |
| Simulation current balance | Contract requires number | JSON quirks can produce null; backend failure accepted as zero | Real zero valid | Cached prior result may remain | Valuation failure | `num()` and effect coerce to 0 | Form and simulation use real zero | P6-008 |
| Scheduled override | Optional per field | Explicit null supported | Explicit zero amount is preserved in non-investment path | Existing override can be overwritten by latest price | Market price may be absent | Base/current values | Full baseData sent on save | P6-005 |
| Import warning/status | Job-specific | Possible | N/A | Polling | Partial job state | Varies | Progress component | Partially traced |
| Backup verification | Not present in reviewed result | Not present | N/A | Artifact metadata can be stale | Durability/coverage not encoded | Success modal | Record counts only | Backend/design risk; not promoted without complete runtime contract |
| Partial totals | No top-level completeness flag | Per-holding null exists | Aggregate can be zero | Rates/prices can be stale | Yes | 0 or unchanged source amount | Ordinary totals | P6-006, P6-007 |

## 11. Date and timezone matrix

| Field/workflow | Backend representation | Frontend parsing | Display timezone | Submission | Boundary risk | Tests/status |
| --- | --- | --- | --- | --- | --- | --- |
| Transaction date | SQL `date`, transformed to `YYYY-MM-DD` | Local date-part parser/DateInput | User locale without UTC day conversion | `YYYY-MM-DD` | Low in reviewed path | No day-shift defect confirmed |
| Scheduled due date | Date-only string | DateInput/local utilities | User locale | `YYYY-MM-DD` | Low in reviewed path | Sampled |
| Override original/actual date | Date-only strings | DateInput | User locale | `YYYY-MM-DD` | Low; price provenance is separate | P6-005 is not a timezone defect |
| Security price date | Date-only/provider date | String/date utilities vary by component | User locale | API-specific | Provider cutoff/stale risk | Sampled, no day-shift defect confirmed |
| Exchange-rate date | Date-only rate date | String | User locale | API-specific | Staleness, not timezone, is primary risk | Sampled |
| Backup timestamp | Timestamp | JavaScript Date | Browser/user locale | Server-generated | Normal timestamp conversion | Sampled |
| Monthly period | Period string/date boundaries | Report-specific | User timezone | Query params | Month boundary risk not fully traced | Unverified |
| Loan rate effective date | Date-only | DateInput | User locale | `YYYY-MM-DD` | Low in reviewed form path | Sampled |
| Monte Carlo dates | Timestamps such as `ranAt`; year labels | JavaScript Date/string | User locale | Server-generated | Low materiality | Sampled |
| Account closed/acquired dates | Backend account `closedDate` is a Date field; frontend types use strings | Form-specific | User locale | Date-only strings | Potential serializer boundary mismatch | Open hypothesis; no concrete one-day reproduction confirmed |
| Emergency-access expiry | Timestamp | JavaScript Date | Browser/user locale | Token-driven | Client/server clock skew | Sampled; no defect confirmed |
| Import job timestamps | Timestamps | JavaScript Date | Browser/user locale | Server-generated | Polling/order risk | Sampled |

### 11.1 Rejected timezone hypothesis

The common failure `new Date("YYYY-MM-DD")` followed by local display was not confirmed in the reviewed transaction/date-input path. The backend entity keeps transaction dates as strings, and frontend utilities parse date parts locally. A transaction entered as `2026-03-29` therefore remains March 29 in the reviewed path even across UTC offsets and DST boundaries.

## 12. Cache and mutation-invalidation matrix

| Mutation | Mutation client/hook | Optimistic update | Invalidated queries/prefixes | Related entities | Rollback | Retry | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Create transaction | `transactionsApi.create` | No | `accounts:`, `investments:` via `invalidateBalanceCaches` | Account, portfolio | N/A after awaited success | Axios auth/CSRF retry only | Budget caches omitted: P6-015 |
| Update transaction | `transactionsApi.update` | No | `accounts:`, `investments:` | Account, portfolio | N/A | Same | Budget caches omitted: P6-015 |
| Delete transaction | `transactionsApi.delete` | No | `accounts:`, `investments:` | Account, portfolio | N/A | Same | Budget caches omitted: P6-015 |
| Create/update transfer | `transactionsApi.createTransfer/updateTransfer` | No | Balance prefixes | Both accounts/portfolio | N/A | Same | Cache coverage acceptable; payload defects P6-001/P6-002 |
| Split add/edit/delete | Transaction client | No | Balance prefixes | Parent account and linked target | N/A | Same | Cache coverage acceptable; precision/sign defects remain |
| Bulk status/delete | `transactionsApi.bulkUpdate/bulkDelete` | No | Balance prefixes | Selected and backend-linked deletes | N/A | Same | Status selection defect P6-001; budget cache P6-015 |
| Investment action | `investmentsApi` | No general optimistic layer | Account/investment prefixes | Cash, brokerage, holdings | N/A | Same | Reviewed balance invalidation present |
| Security transfer | `investmentsApi.transferSecurity` | No | Account/investment prefixes | Source/destination brokerage | N/A | Same | Contract defect P6-004 |
| Price refresh | Investment/securities clients | No | Investment data paths | Holdings/portfolio | N/A | Same | Sampled; no separate invalidation defect confirmed |
| Scheduled posting | `scheduledTransactionsApi.post` | No | `scheduled:` plus balance prefixes | Schedule, accounts, portfolio | N/A | Same | Correctly invalidates balance caches |
| Scheduled override create/update/delete | Scheduled client | No | `scheduled:` | Future occurrence | N/A | Same | P6-005 is input provenance, not cache |
| Budget edit | `budgetsApi` | No | `budgets:` | Budget pages/cards | N/A | Same | Correct for direct budget mutations |
| Loan setup/post | Accounts/scheduled clients | No | Domain-specific and balance prefixes when posted | Source and loan accounts | N/A | Same | Sampled |
| Import start/retry | MNY hook/client | Local job state | Completion handling sampled | Many entities | Backend transaction rollback | User retry; no stable idempotency key | Design risk, not confirmed Phase 6 duplicate |
| Attachment upload/delete | `attachmentsApi` | No | `attachments:` | Attachment list/count | N/A | Same | List itself is uncached; no material stale defect confirmed |
| Restore | `backupApi.restoreBackup` | No | `clearAllCache()` | Entire dataset | Server-controlled | User retry | Cache clearing is correct; OIDC flow defect P6-009 |
| Delegation switch | Delegation API/banner | No | Full page reload | Entire effective identity | N/A | User action | Cache separation reviewed without a defect |
| Logout | `authApi.logout` + auth store | Local state cleared even on failure | `clearAllCache()` | Session and all data | No server rollback | No visible retry | P6-010 |
| Emergency claim | `emergencyAccessApi.completeClaim` | No | N/A | Authentication credentials | Server-controlled | User can resubmit | Backend race remains; no distinct frontend finding |
| Backup run | Backup/auto-backup clients | No | Settings refresh paths | Artifact/status | N/A | User-triggered | Backend durability risks only in this phase |

### 12.1 Cache invalidation conclusion

The explicit balance-cache guard is valuable and prevented several suspected stale-account defects. Its scope is nevertheless too narrow for transaction writes: budget dashboard and per-category status entries use different prefixes and remain cached after a successful transaction mutation. P6-015 captures this distinct stale-state failure.

## 13. Localization coverage ledger

| Area | Evidence reviewed | Coverage/result |
| --- | --- | --- |
| Supported locales | `frontend/src/i18n/config.ts` | 22 production locale identifiers plus pseudo-locale `xx` |
| Catalog loading | `frontend/src/i18n/messages.ts` | Namespace registration and regional deep-merge/fallback reviewed |
| Missing-key behavior | Message loader and parity test | Structural missing keys are covered by tests |
| Parameter interpolation | ICU/parity checks | Structural compatibility covered; semantic correctness not exhaustively verified |
| Pluralization | Parity tests and sampled catalogs | Structural coverage only |
| Currency/number formatting | Number-format hooks and currency components | Locale-aware display exists; comma-decimal browser scenario was not executed |
| Rate direction | Transaction/investment copy sampled | Direct transfer UI labels received amount, not an explicit destination-per-source rate |
| Percentage units | Account and report copy sampled | No material translation-specific unit inversion confirmed |
| Transaction statuses and VOID | English and sampled catalogs; bulk status UI | VOID is exposed; P6-001 is a workflow defect, not a mistranslation |
| Transfer source/destination | Transaction catalogs/components | Labels exist; no material semantic translation defect confirmed |
| Cost basis and gain | English investment catalog | P6-013: English tooltip materially overpromises fee inclusion |
| Stock split ratio | Investment form and catalog | Ratio entry uses new/old shares; no frontend transform defect confirmed |
| Missing/stale/partial values | Portfolio/account components | Material warnings are absent in English and therefore across parity-derived catalogs: P6-006/P6-007 |
| Destructive restore | Settings catalog and component | P6-009: reauthentication wording does not match the submitted request |
| Support-backup de-identification | Settings catalog and support rules | P6-014: privacy wording conflicts with custom-currency handling |
| Delegation/emergency access | Settings and emergency paths sampled | No material translation defect confirmed |
| Retry/import status | MNY components/catalogs sampled | No wording defect promoted; idempotency remains a design risk |
| Semantic multi-locale E2E | Playwright config | Not present; E2E locale is fixed to `en` |

Structural parity is materially stronger than semantic parity. `messages.parity.test.ts` and pseudo-locale CI detect missing keys and interpolation drift, but they cannot detect a correctly keyed yet financially false sentence such as the Cost Basis or support-backup claims.

## 14. Confirmed findings

### P6-001 - Bulk status updates can VOID one leg of a linked transfer

- **Classification:** confirmed defect
- **Severity:** HIGH
- **Confidence:** high
- **Related earlier finding:** strengthens P5-001 without duplicating its backend root cause

**Locations**

- `frontend/src/components/transactions/BulkUpdateModal.tsx:45-205`
- `frontend/src/hooks/useTransactionSelection.ts:1-180`
- `frontend/src/components/transactions/TransactionForm.tsx:940-1035`
- `frontend/src/lib/transactions.ts:500-520`
- `backend/src/transactions/transaction-bulk-update.service.ts:90-205`
- `backend/src/transactions/transaction-bulk-update.service.ts:600-625`

**Expected invariant**

A linked transfer is one economic event. Any balance-affecting status transition, especially entering or leaving `VOID`, must be applied atomically to both legs or rejected when only one leg is selected.

**Frontend failure**

The bulk modal offers `VOID`. The selection hook serializes only the clicked transaction IDs, with no expansion through `linkedTransactionId` and no warning that a counterpart will be excluded. The backend bulk path adjusts balances and updates only the eligible selected IDs; its linked-transfer synchronization is for selected metadata and does not make status changes pair-atomic. The ordinary transfer form also submits its selected status directly and does not prohibit creating or editing a transfer as `VOID`.

**Reproduction**

```text
Initial checking balance: 1,000.00 USD
Initial savings balance:      0.00 USD
Active transfer:            100.00 USD
Balances after transfer: checking 900.00, savings 100.00
Combined balance:         1,000.00 USD
```

1. Open the transaction list.
2. Select only the checking/source transfer leg.
3. Open Bulk Update, enable Status, choose VOID, and submit.
4. The source leg is removed from its account balance while the destination leg remains active.

```text
Produced balances: checking 1,000.00 + savings 100.00 = 1,100.00 USD
Expected balances: both legs VOID, 1,000.00 + 0.00 = 1,000.00 USD
Difference: +100.00 USD (+10% of the initial combined balance)
```

**Impact**

The UI can create money, destroy money, and make linked accounts disagree. The incorrect state propagates into account balances, net worth, reports, reconciliation, and any downstream snapshots.

**Recommended correction**

- Do not offer balance-affecting transfer status changes as an ordinary single-row bulk operation.
- When a selected transaction is a transfer leg, either expand the request to both leg IDs and show the expanded selection, or use a dedicated server endpoint that atomically updates the pair by transfer identity.
- Reject `VOID` transfer creation/edit until the server enforces pair-safe semantics.
- Include counterpart IDs in the success response so the client can refresh both visible rows.

**Recommended regression test**

A component/integration test should create a two-leg transfer, select only one leg, choose `VOID`, and assert that the client either blocks submission or submits both IDs. A backend integration test should assert that no API path can leave one linked leg active and the other void.

**Verification method**

Static cross-layer inspection of selection serialization, modal status options, API request construction, bulk service eligible-ID handling, and VOID balance adjustment at the audited SHA. No browser scenario was executed.

---

### P6-002 - Direct, scheduled, and split transfer forms serialize an incomplete cross-currency contract

- **Classification:** confirmed defect
- **Severity:** HIGH
- **Confidence:** high
- **Related earlier finding:** distinct frontend request failure strengthening P5-002

**Locations**

- `frontend/src/components/transactions/TransactionForm.tsx:974-1030`
- `frontend/src/components/transactions/TransferTransactionFields.tsx:112-205`
- `frontend/src/components/scheduled-transactions/ScheduledTransactionForm.tsx:650-860`
- `frontend/src/components/transactions/SplitEditor.tsx:110-245`
- `frontend/src/components/transactions/SplitEditor.tsx:920-1015`
- `backend/src/transactions/dto/create-transfer.dto.ts:1-240`
- `backend/src/transactions/transaction-transfer.service.ts:90-230`
- `backend/src/scheduled-transactions/scheduled-transactions.service.ts:1230-1335`
- `backend/src/transactions/transaction-split.service.ts:1-720`

**Expected invariant**

For different account currencies, the request must carry one authoritative and internally consistent conversion contract: source amount, source currency, destination currency, rate direction defined as destination units per one source unit, and either a derived or explicitly confirmed destination amount. A missing conversion must be rejected, not silently treated as 1:1.

**Frontend failure**

Three user-facing paths admit different-currency destination accounts but do not collect the complete contract:

1. Direct transfer collects an optional Received Amount. It never sends an exchange rate, and it omits `toAmount` when the field is blank.
2. Scheduled transfer collects only one amount and a target account. It has no rate or destination-amount field.
3. Transfer split collects one signed split amount and a target account. It has no rate or destination-amount field and does not filter target accounts by currency.

The backend DTO defaults a missing rate to 1, and the service computes destination amount as source amount multiplied by that rate when `toAmount` is absent. The scheduled and split paths therefore create 1:1 linked legs by construction.

**Reproduction**

```text
Source account: USD
Destination account: EUR
Source amount: 100.00 USD
Real/expected rate: 0.9000 EUR per USD
```

Direct transfer: leave Received Amount blank. Scheduled transfer and transfer split: simply choose the EUR target account, because no FX field exists.

```text
Frontend request/result: destination 100.00 EUR
Expected: 100.00 USD * 0.9000 = 90.00 EUR
Difference: +10.00 EUR (+11.11% versus expected)
```

For a monthly scheduled transfer, the annual destination overstatement is 120.00 EUR before any rate movement.

**Impact**

The UI can post incorrect destination balances, linked transfer legs, scheduled occurrences, and split-transfer budget/history rows. Users may reconcile against bank statements using a destination amount the UI never asked them to confirm.

**Recommended correction**

- Add a mandatory cross-currency transfer model shared by direct, scheduled, and split forms.
- Derive currencies from the selected account objects at submit time.
- Require an explicit rate or destination amount; compute the other field and label the direction as `DEST per 1 SOURCE`.
- Reject missing, zero, negative, stale, or contradictory FX values before submission.
- Include the conversion fields in scheduled-transfer and split DTOs, or prohibit cross-currency targets until the backend supports them.

**Recommended regression test**

Parameterized component/API-contract tests for USD->EUR and EUR->USD should cover direct transfer, scheduled transfer, and transfer split. With 100.00 USD and 0.9000 EUR/USD, every path must submit or derive 90.00 EUR; leaving FX data empty must block submission.

**Verification method**

Static review of all three form serializers and the exact backend default/derivation path. No live exchange-rate or browser execution was performed.

---

### P6-003 - Investment preview substitutes 1:1 while commit can resolve a different server-side FX rate

- **Classification:** confirmed defect
- **Severity:** HIGH
- **Confidence:** high
- **Related earlier finding:** distinct preview/request mismatch strengthening P5-005

**Locations**

- `frontend/src/components/investments/InvestmentTransactionForm.tsx:37-66`
- `frontend/src/components/investments/InvestmentTransactionForm.tsx:210-335`
- `frontend/src/components/investments/InvestmentTransactionForm.tsx:330-520`
- `frontend/src/components/investments/InvestmentTransactionForm.tsx:700-860`
- `backend/src/securities/investment-transactions.service.ts:180-410`
- `backend/src/securities/investment-transactions.service.ts:385-510`

**Expected invariant**

The preview and committed cash movement must use the same FX input and the same rate source. Missing or unresolved FX must produce an unavailable/error state, not a preview at 1:1 followed by a server-resolved market rate.

**Frontend failure**

For a new investment action, `exchangeRate` is optional and defaults to `undefined`. The watched value is coerced through `Number(...) || 0`, while the preview calculation uses `watchedExchangeRate || 1`. Submission includes the rate only when it is truthy and positive. Therefore, when the client has no rate, the preview uses 1 while the request omits the field. The backend then resolves an explicit, historical, or latest stored market rate.

The form schema correctly rejects an explicitly entered zero or negative rate; the confirmed defect is the permitted absent/unresolved rate, not a standard user-entered zero.

**Reproduction**

```text
Action: BUY
Quantity: 10 shares
Unit price: 100.00 USD
Cash account: CAD
Client-side rate lookup: unavailable
Server-side dated/latest rate: 1.3500 CAD per USD
```

```text
Frontend preview: 10 * 100.00 * 1 = 1,000.00 CAD
Request: exchangeRate omitted
Backend persisted cash movement: 10 * 100.00 * 1.3500 = 1,350.00 CAD
Expected preview: 1,350.00 CAD, or an unavailable state that blocks commit
Difference: +350.00 CAD (+35%)
```

**Impact**

A user can confirm an investment trade after reviewing a materially different cash amount. The discrepancy changes cash balances, portfolio allocation, gain/loss, and future simulations.

**Recommended correction**

- Represent FX resolution as a discriminated state: loading, resolved, stale, unavailable, or user override.
- Do not use `|| 1` for a cross-currency preview.
- Submit the exact rate displayed in the preview, with its date/source, or request a server preview token that the commit reuses.
- Block commit when currencies differ and the rate is unresolved.

**Recommended regression test**

Mock the client rate lookup as unavailable and the server preview/commit rate as 1.3500. Assert that the form blocks submission or displays 1,350.00 CAD and sends 1.3500. Include empty, zero, negative, stale, and changed-rate cases.

**Verification method**

Static inspection of schema optionality, defaults, watched-value coercion, preview arithmetic, request omission, and backend rate resolution.

---

### P6-004 - Foreign-security transfer requests omit the account-currency basis conversion contract

- **Classification:** confirmed defect
- **Severity:** HIGH
- **Confidence:** high
- **Related earlier finding:** distinct invalid/incomplete frontend payload strengthening P5-013

**Locations**

- `frontend/src/components/investments/InvestmentTransactionForm.tsx:590-735`
- `frontend/src/components/investments/InvestmentTransactionForm.tsx:700-860`
- `frontend/src/components/investments/InvestmentTransactionForm.tsx:875-1015`
- `frontend/src/lib/investments.ts:180-360`
- `frontend/src/i18n/messages/en/investments.json:28-58`
- `backend/src/securities/investment-transactions.service.ts:1460-1665`

**Expected invariant**

A transfer of a foreign-currency security must preserve both native-security cost and the correct account-currency cost basis in the destination account. If source and destination account currencies differ, the request must carry enough FX/basis provenance to reproduce the destination basis.

**Frontend failure**

The destination selector includes all other brokerage accounts, including accounts with a different currency. The request contains source account, destination account, security, date, quantity, and cost per share, but no exchange rate, account-currency basis, original acquisition-rate history, or server preview token. The UI copy says cost basis is carried so gain/profit reports stay correct. The backend creates the destination transfer leg with the carried cost and an implied exchange rate of 1.

**Reproduction**

```text
Security currency: USD
Quantity transferred: 10
Native average cost: 50.00 USD/share
Destination brokerage currency: CAD
Correct conversion: 1.3500 CAD per USD
```

```text
Frontend request carries costPerShare=50.00 and no FX basis
Backend destination basis: 10 * 50.00 * 1 = 500.00 CAD
Expected destination basis: 10 * 50.00 * 1.3500 = 675.00 CAD
Difference: -175.00 CAD (-25.93%)
```

**Impact**

Destination average cost and realized/unrealized gains are misstated. A later sale may report 175.00 CAD too much gain in this example, before tax-policy considerations.

**Recommended correction**

- Prefer carrying immutable acquisition lots or an explicit account-currency basis, not only a native cost per share.
- At minimum, add source/destination currency, rate, rate date/source, native basis, and destination-account basis to a server-validated transfer preview and commit contract.
- Block cross-account-currency security transfers until this contract exists.
- Change the UI promise so it describes only what is actually preserved.

**Recommended regression test**

Transfer 10 USD-denominated shares with 50.00 USD average cost from a USD brokerage to a CAD brokerage at 1.3500. Assert 675.00 CAD destination basis and unchanged native basis. Include partial transfer and subsequent sale.

**Verification method**

Static trace from destination account options through payload type/client, transfer service, persisted destination leg, and user-facing wording.

---

### P6-005 - Reopening a scheduled investment override replaces its stored price with the latest market price

- **Classification:** confirmed defect
- **Severity:** HIGH
- **Confidence:** high
- **Related earlier finding:** new Phase 6 defect

**Locations**

- `frontend/src/components/scheduled-transactions/OverrideEditorDialog.tsx:110-290`
- `frontend/src/components/scheduled-transactions/OverrideEditorDialog.tsx:270-365`
- `frontend/src/components/scheduled-transactions/OverrideEditorDialog.tsx:400-500`
- `frontend/src/components/scheduled-transactions/OverrideEditorDialog.test.tsx:480-680`

**Expected invariant**

Opening an existing occurrence override must preserve every stored override field until the user explicitly edits or chooses to refresh it. A market-data lookup may be offered as a suggestion, but it must not silently replace persisted input.

**Frontend failure**

The dialog initializes quantity/price from the existing override or scheduled base, then fetches the latest market price and assigns it to the editable price and total. Saving always serializes those current fields. The existing test explicitly asserts the auto-fill behavior, so the test suite entrenches the defect.

**Reproduction**

```text
Existing scheduled BUY override: 10 shares at 100.00
Stored override total: 1,000.00
Latest close when the dialog is reopened: 120.00
User action: change only the occurrence date, then Save
```

```text
Frontend-produced saved price: 120.00
Frontend-produced total: 1,200.00
Expected preserved price/total: 100.00 / 1,000.00
Difference: +200.00 (+20%)
```

**Impact**

A harmless date or description edit can change a future investment purchase, cash requirement, projected holdings, and budget without explicit user intent.

**Recommended correction**

- Never replace an existing override price on open.
- Keep latest market price as a separate suggestion with timestamp/source and an explicit Apply action.
- Track dirty fields and submit only user-confirmed changes or the preserved existing value.
- For new overrides, clearly label whether a price was copied from the schedule or applied from market data.

**Recommended regression test**

Replace the existing auto-fill assertion. Seed an override at 100.00, mock latest close at 120.00, reopen, change only the date, save, and assert the payload still contains 100.00. Add a separate test for the explicit Apply latest price action.

**Verification method**

Static inspection of initialization, latest-price effect, rendered field, save payload, and the existing test that asserts auto-replacement.

---

### P6-006 - Missing exchange rates are returned unchanged and labelled as converted complete totals

- **Classification:** confirmed defect
- **Severity:** HIGH
- **Confidence:** high
- **Related earlier finding:** distinct frontend aggregation defect strengthening P5-009

**Locations**

- `frontend/src/hooks/useExchangeRates.ts:1-250`
- `frontend/src/app/accounts/page.tsx:45-151`
- `frontend/src/hooks/useExchangeRates.test.ts:90-190`

**Expected invariant**

A missing cross-currency rate must remain unavailable. It must not become a value in the destination currency. Any aggregate containing an unavailable conversion must be marked partial or unavailable.

**Frontend failure**

Both `convert` and `convertWithRateMap` return the original numeric amount when neither a direct nor inverse rate exists. The Accounts page then sums that returned number into Assets, Liabilities, and Net Worth and formats the aggregate in the default currency. The tests explicitly require this behavior with assertions named "returns unconverted when no rate available."

**Reproduction**

```text
Default display currency: EUR
Account balance: 100.00 USD
Correct rate: 0.9000 EUR per USD, but rate lookup is missing
```

```text
Frontend conversion result: 100.00
Frontend label: EUR total
Displayed result: 100.00 EUR
Expected: 90.00 EUR if the rate is available, otherwise Unavailable/Partial
Difference from expected conversion: +10.00 EUR (+11.11%)
```

**Impact**

Net worth, asset, liability, dashboard, report, and allocation totals can appear complete while containing arbitrary 1:1 substitutions. The error scales with every unconverted account and can reverse apparent financial trends.

**Recommended correction**

- Return a result type such as `{ status: 'ok', value, rate } | { status: 'missing' }`, not a bare number.
- Require aggregate callers to propagate partial/unavailable state.
- Show missing currency pairs and rate dates, and exclude no value silently.
- Remove unchanged-amount fallback tests and replace them with missing-state assertions.

**Recommended regression test**

With default EUR and a 100.00 USD account, mock an empty rate response. Assert that no `100.00 EUR` total is rendered, the aggregate is marked partial/unavailable, and the missing `USD->EUR` pair is visible. Repeat for direct and inverse missing-rate paths.

**Verification method**

Static review of both conversion helpers, Accounts-page aggregation, and tests that codify the fallback.

---

### P6-007 - Unavailable or partial portfolio valuations are rendered as complete ordinary totals

- **Classification:** confirmed defect
- **Severity:** HIGH
- **Confidence:** high
- **Related earlier findings:** frontend contract/presentation failure related to missing-price and net-worth concerns in Phase 5

**Locations**

- `frontend/src/app/accounts/page.tsx:45-151`
- `backend/src/securities/portfolio-calculation.service.ts:1060-1295`
- `frontend/src/components/investments/PortfolioSummaryCard.tsx:60-255`
- `frontend/src/components/investments/PortfolioSummaryCard.test.tsx:1-620`

**Expected invariant**

A portfolio total is complete only when every included holding has a usable price and every required aggregate source loaded successfully. A failure or null holding value must be surfaced, not converted into zero or omitted without qualification.

**Frontend failure**

Two related frontend paths violate this invariant:

1. The Accounts page catches portfolio-summary failure and substitutes `null`. Brokerage account market values then fall back to zero and are included in ordinary account/net-worth cards.
2. The backend exposes a detectable per-holding signal (`currentPrice`/`marketValue` null) and skips those holdings from numeric totals. `PortfolioSummaryCard` renders the top-level totals and gain/loss without scanning holdings or displaying a partial-state warning.

The card tests cover many normal values and empty holdings but not a portfolio containing at least one null-valued holding.

**Reproduction**

**Scenario A - summary request failure**

```text
Cash/checking assets: 20,000.00
Brokerage market value: 100,000.00
Portfolio summary request: fails
```

```text
Frontend displayed assets/net worth contribution: 20,000.00
Expected: unavailable/partial, preserving that 100,000.00 is unresolved
Difference if interpreted as complete: -100,000.00 (-83.33% of expected 120,000.00 total)
```

**Scenario B - one unpriced holding**

```text
Priced holdings: 100,000.00
Unpriced holding expected from last known/reference price: 50,000.00
Backend top-level known total: 100,000.00; unpriced holding marketValue=null
Frontend display: 100,000.00 as an ordinary total
Expected complete total: 150,000.00, or a clearly partial 100,000.00+
Difference if treated as complete: -50,000.00 (-33.33%)
```

**Impact**

Users can make allocation, contribution, withdrawal, sale, or simulation decisions from a materially understated portfolio or net worth without any visible indication that data is missing.

**Recommended correction**

- Preserve load failure separately from an empty/zero portfolio.
- Add response-level completeness metadata: missing security IDs, missing price dates, missing FX pairs, and last successful valuation time.
- Scan holding nulls before rendering summary totals and display partial totals with explicit warnings.
- Do not substitute zero for a failed brokerage summary in the Accounts page.

**Recommended regression test**

Add tests for a rejected portfolio request and for one holding with `marketValue: null`. Assert that totals are marked unavailable/partial and that missing symbols are listed; assert that a genuine fully priced zero portfolio still renders `0.00` without an error.

**Verification method**

Static trace of backend null-valued holding construction, aggregate skipping, Accounts-page error substitution, summary-card rendering, and current test fixtures.

---

### P6-008 - Monte Carlo valuation failure or unknown current balance is coerced to a real zero

- **Classification:** confirmed defect
- **Severity:** HIGH
- **Confidence:** high
- **Related earlier finding:** distinct frontend contract/state failure strengthening P5-010

**Locations**

- `frontend/src/lib/monte-carlo.ts:1-155`
- `frontend/src/components/reports/useMonteCarloScenarios.ts:1-260`
- `frontend/src/components/reports/MonteCarloReport.tsx:1-360`

**Expected invariant**

A manually entered zero portfolio is valid and must remain distinguishable from failed, unresolved, or partial valuation. Simulation must not run from an unknown value unless the user explicitly supplies an override.

**Frontend failure**

The historical-stats contract types `currentBalance` as an unconditional `number`. The hook's numeric normalization converts non-finite or null-like values to zero and copies the result into scenario starting value when current-balance mode is enabled. Report rendering and run paths therefore treat failure-origin zero as ordinary input, with no unavailable/error discriminator.

**Reproduction**

```text
Actual selected portfolio: 100,000.00
Valuation service outcome accepted from P5-010: failure reduced to currentBalance=0.00
useCurrentBalance: enabled
```

```text
Frontend starting value and simulation input: 0.00
Expected: unavailable/error, or explicit manual override retaining 100,000.00
Difference: -100,000.00 (-100%)
```

**Impact**

Retirement and withdrawal simulations can produce catastrophic failure projections or meaningless results from a nonexistent zero starting balance, while the UI presents the run as valid.

**Recommended correction**

- Change the API contract to return `{ value, status, missingInputs }` or an error, not a bare number on failure.
- Type `currentBalance` as nullable/discriminated and remove generic `num(...)->0` fallback for valuation fields.
- Disable Run when current balance is unresolved and provide a deliberate manual override control.
- Clear or label cached successful values when a refresh fails; do not silently replace them with zero.

**Recommended regression test**

Cover: real manual zero, successful 100,000.00 current value, request failure, null/NaN-like payload, partial holding valuation, and stale cached success followed by failure. Only the explicit real-zero/manual-zero cases may run with 0.00.

**Verification method**

Static review of the frontend API type, normalization helper, scenario synchronization, and report/run consumption, combined with the accepted Phase 5 backend failure behavior.

---

### P6-009 - Restore and account deletion claim OIDC reauthentication but submit a fixed confirmation string

- **Classification:** confirmed defect
- **Severity:** HIGH
- **Confidence:** high
- **Related earlier findings:** distinct frontend flow and wording defect strengthening P2-005 and P3-009

**Locations**

- `frontend/src/components/settings/BackupRestoreSection.tsx:135-230`
- `frontend/src/components/settings/BackupRestoreSection.tsx:315-425`
- `frontend/src/components/settings/DangerZoneSection.tsx:35-95`
- `frontend/src/components/settings/DangerZoneSection.tsx:80-210`
- `backend/src/auth/step-up/step-up.service.ts:1-340`

**Expected invariant**

When the UI says a destructive action will reauthenticate through the OIDC provider, it must initiate and complete an identity-provider flow and submit verifiable proof bound to the action, user, freshness window, and nonce.

**Frontend failure**

For OIDC restore, the button invokes `runRestore()` directly and sends `oidcIdToken: 'oidc-session-confirmed'`. Account deletion constructs the same fixed string. In the same Danger Zone component, the delete-data path has a separate `authApi.initiateOidc()` flow, proving that an actual redirect/re-auth mechanism exists and that the fixed-string paths are not the universal intended model.

**Reproduction**

1. Sign in with an OIDC account.
2. Open Restore, choose a backup, and click the button labelled as reauthentication/restore.
3. Observe from static request construction that no IdP redirect or fresh token acquisition occurs; the fixed string is sent.

The same applies to Delete Account after typing `DELETE`.

**Impact**

A person with an existing browser session can trigger full data replacement or account deletion without the fresh identity proof promised by the UI. The false wording can also cause maintainers to believe a control exists when it does not.

**Recommended correction**

- Reuse a single step-up/OIDC flow for every destructive action.
- Store only opaque, one-time pending action state in session storage.
- On callback, exchange an authorization code server-side and mint a short-lived, purpose-bound step-up token.
- Remove acceptance of arbitrary non-empty strings and remove fixed confirmation constants from frontend code.
- Make wording reflect the actual control until the flow is fixed.

**Recommended regression test**

For restore and account deletion, assert that clicking the OIDC action initiates the provider flow and that the destructive API is not called before a valid callback/step-up token. Assert that a fixed or arbitrary string is rejected by the backend.

**Verification method**

Static comparison of restore and delete-account request construction against the functioning delete-data OIDC initiation path and the accepted backend weakness.

---

### P6-010 - Logout API failure is hidden while a refreshable server session may remain

- **Classification:** confirmed defect
- **Severity:** HIGH
- **Confidence:** high
- **Related earlier finding:** frontend presentation/session-state failure strengthening P4-011

**Locations**

- `frontend/src/components/layout/AppHeader.tsx:180-235`
- `frontend/src/store/authStore.ts:1-135`
- `frontend/src/lib/auth.ts:1-460`
- `frontend/src/lib/api.ts:1-300`

**Expected invariant**

The UI may claim logout is complete only after the server has invalidated the relevant session/refresh credentials, or it must clearly warn that only local state was cleared and the session may still be active.

**Frontend failure**

`handleLogout` clears the Zustand auth state and routes to `/login` both on success and in the catch branch. The catch branch displays no warning and no retry. Local logout correctly clears client caches and local data, but it cannot clear an HttpOnly refresh cookie or invalidate a concurrently rotated refresh token. The user therefore sees an apparently completed logout even when the server request failed or the Phase 4 rotation race left a usable token.

**Reproduction**

1. Keep a valid refresh session.
2. Make `/auth/logout` fail due to network interruption, reverse-proxy failure, or the accepted concurrent rotation race.
3. Click Logout.
4. The app clears local state and navigates to `/login` with no error.
5. The server-side refresh credential can remain valid; a subsequent authenticated request/refresh or another tab may restore access.

**Impact**

On a shared or unattended device, the user may leave believing the session is terminated while it remains recoverable. This is a security-sensitive false success state.

**Recommended correction**

- Distinguish confirmed server logout from local-only cleanup.
- On failure, show a persistent warning and provide Retry Logout; do not show the normal success state.
- Consider a server-issued session version or logout-all endpoint that invalidates the entire refresh-token family atomically.
- After a successful response, verify that a refresh attempt is rejected before presenting a strong logout guarantee where feasible.

**Recommended regression test**

Mock `authApi.logout` rejection. Assert that the user receives a visible warning, that the UI does not claim successful logout, and that retry is available. Add an integration test racing refresh-token rotation with logout and assert that every token in the family is invalid afterward.

**Verification method**

Static inspection of the AppHeader success/catch branches, auth-store local cleanup, cookie ownership, and Axios refresh behavior, combined with accepted P4-011.

---

### P6-011 - The split editor permits mixed-sign children that reverse part of the parent transaction

- **Classification:** confirmed defect
- **Severity:** MEDIUM
- **Confidence:** high
- **Related earlier finding:** distinct frontend validation path strengthening P5-004

**Locations**

- `frontend/src/components/transactions/SplitEditor.tsx:110-245`
- `frontend/src/components/transactions/SplitEditor.tsx:920-1015`
- `frontend/src/components/transactions/SplitEditor.test.tsx:1-420`
- `backend/src/transactions/dto/create-transaction-split.dto.ts:1-280`
- `backend/src/common/split-amount.util.ts:1-62`

**Expected invariant**

Category split children must preserve the economic direction of the parent transaction. An expense parent must not contain an income child, and an income parent must not contain an expense child, unless a separately modelled transfer or investment operation explicitly defines the opposite leg.

**Frontend failure**

The editor can infer or toggle each category split's sign independently. Its balancing rule checks only whether the arithmetic sum is close to the parent amount. `toCreateSplitData` then serializes the mixed signed values unchanged. There is no form-level validation that all ordinary category children have the parent's sign.

**Numerical reproduction**

- Parent expense: `-100.0000`
- Child A expense: `-150.0000`
- Child B income: `+50.0000`
- Frontend sum: `-100.0000`
- Frontend result: balanced and serializable
- Expected: reject Child B because its sign reverses `50.0000` of the parent direction
- Difference: `50.0000` is represented as income inside an expense transaction

**Impact**

Budgets, category reports, cash-flow analysis, and exports can record an apparent income offset that the user did not intend. The parent total still reconciles, so the inconsistency is difficult to detect from account balance alone.

**Recommended correction**

- Validate ordinary category children against the parent sign before submit.
- Keep transfer and investment split kinds as explicit exceptions with their own direction rules.
- When the parent sign changes during edit or copy, revalidate every child and require an explicit user correction instead of silently preserving a mixed-sign set.
- Apply the same invariant in import and scheduled-override editors.

**Recommended regression test**

Create a parent `-100.0000` with children `-150.0000` and `+50.0000`. Assert that the editor blocks submission and identifies the opposite-sign row. Add the inverse income case and tests for parent-sign changes, copy/edit, transfer passthrough, and zero-value children.

**Verification method**

Static tracing of per-row sign handling, sum-only validation, split serialization, and the accepted backend mixed-sign gap.

---

### P6-012 - Two-decimal split editing and one-cent tolerance conflict with four-decimal persistence

- **Classification:** confirmed defect
- **Severity:** MEDIUM
- **Confidence:** high

**Locations**

- `frontend/src/components/ui/CurrencyInput.tsx:1-170`
- `frontend/src/components/transactions/SplitEditor.tsx:110-245`
- `frontend/src/components/transactions/SplitEditor.tsx:920-1015`
- `frontend/src/components/scheduled-transactions/ScheduledTransactionForm.tsx:650-860`
- `backend/src/common/split-amount.util.ts:1-62`
- `backend/src/transactions/entities/transaction.entity.ts:60-135`

**Expected invariant**

A frontend that edits database money stored at four decimal places must either preserve and display the material precision or validate against the same four-decimal rounded equality as the backend. It must not declare a payload balanced when the backend will reject it.

**Frontend failure**

`CurrencyInput` is designed around two-decimal display and cent rounding, while the split editor treats any residual below `0.01` as balanced. The backend compares the parent and child sum after four-decimal rounding and requires exact equality. The frontend therefore has a wider acceptance band than the API and hides the digits that determine the result.

**Numerical reproduction**

- Parent stored/request amount: `10.0048`
- Child A: `5.0000`
- Child B: `5.0000`
- Child sum: `10.0000`
- Difference: `0.0048`
- Frontend display: parent `10.00`, children `5.00` and `5.00`
- Frontend validation: balanced because `0.0048 < 0.01`
- Backend expected comparison: `10.0000 != 10.0048`; reject
- Monetary difference: `0.0048`

A related edit risk exists for existing four-decimal values: the field can display two values as identical even when their persisted values differ, so a user cannot reliably preserve or correct the hidden remainder.

**Impact**

Users can complete an apparently valid split form only to receive a backend error. Existing imported or calculated four-decimal splits can also be unintentionally normalized or become impossible to reconcile through the UI.

**Recommended correction**

- Use the shared four-decimal money rounding rule for validation and payload construction.
- Display up to four decimals when a value contains non-zero third or fourth decimal digits.
- Replace the one-cent tolerance with exact equality after four-decimal rounding.
- Do not reuse formatted display text as the authoritative numeric value.

**Recommended regression test**

Cover parent `10.0048` with `5.0000 + 5.0000` and assert that the frontend marks it unbalanced before submit. Cover `5.0024 + 5.0024` and assert that all four decimals survive focus, blur, edit, and serialization. Repeat in scheduled transaction and override split editors.

**Verification method**

Static comparison of the two-decimal input contract and one-cent frontend threshold with the backend's exact four-decimal `roundMoney`/`sumMoney` validation.

---

### P6-013 - The Cost Basis tooltip promises transaction fees that the implemented basis excludes

- **Classification:** confirmed defect
- **Severity:** MEDIUM
- **Confidence:** high
- **Related earlier finding:** distinct false frontend contract strengthening P5-006

**Locations**

- `frontend/src/i18n/messages/en/investments.json:28-58`
- `frontend/src/components/investments/PortfolioSummaryCard.tsx:185-230`
- `backend/src/securities/portfolio-calculation.service.ts:600-655`
- `backend/src/securities/entities/investment-transaction.entity.ts:105-185`

**Expected invariant**

The label and tooltip for Cost Basis must describe the value actually calculated. If commissions are excluded by the implemented model, the UI must not promise that transaction fees are included.

**Frontend failure**

The English tooltip defines Cost Basis as purchase prices plus transaction fees. The portfolio calculator replays BUY, REINVEST, and TRANSFER_IN using `quantity * price * exchangeRate` and does not add `commission`. The component renders that number as Cost Basis without a qualification or separate reconciliation item.

**Numerical reproduction**

- Purchase: `10` shares at `100.00`
- Acquisition commission: `20.00`
- Currency and FX: same currency, rate `1.0000`
- Frontend-promised basis: `10 * 100.00 + 20.00 = 1,020.00`
- Implemented/displayed basis: `10 * 100.00 = 1,000.00`
- Difference: `-20.00` (`-1.96%` of the promised basis)

If the position is later valued or sold for `1,200.00`, the displayed gain is `200.00` instead of `180.00`, overstating gain by `20.00`.

**Impact**

Users can make investment and tax-record decisions based on a value whose on-screen definition is false. The error propagates to gain/loss and percentage displays.

**Recommended correction**

Choose and document one product model:

- add acquisition commissions to the historical basis and allocate them correctly across partial sales; or
- change the tooltip and labels to state that commissions are excluded, and display fee expense separately.

Do not imply a jurisdiction-specific tax rule without an explicit product decision.

**Recommended regression test**

Create a commission-bearing BUY and a later partial/full SELL. Assert the exact basis and gain in security currency and account currency, and assert that the tooltip describes that implemented result. Include a cross-currency purchase.

**Verification method**

Static comparison of localized product copy and the rendered summary card against the basis replay formula.

---

### P6-014 - Support-backup privacy copy says names are masked while custom currency names and symbols are kept

- **Classification:** confirmed defect
- **Severity:** MEDIUM
- **Confidence:** high
- **Related earlier findings:** distinct privacy-presentation defect strengthening P3-013 and P3-014

**Locations**

- `frontend/src/i18n/messages/en/settings.json:245-305`
- `frontend/src/components/settings/SupportBackupModal.tsx:115-240`
- `backend/src/backup/support-backup/support-backup-rules.ts:35-85`

**Expected invariant**

The support-backup explanation must identify material fields that remain verbatim. A user must not be told that names are masked when a selectable dataset can preserve a user-authored name and symbol.

**Frontend failure**

The modal states that names are masked and descriptions/account numbers are removed. The support-backup rules preserve `currencies.code`, `currencies.name`, and `currencies.symbol` unchanged. Custom currency names and symbols are user-controlled and can contain a person, household, employer, project, or organization identifier. The UI provides no exception or warning for them.

**Reproduction**

1. Create a custom currency with name `Alice Family Credits` and symbol `AFam`.
2. Generate a support backup that includes data referencing that currency.
3. The modal promises that names are masked.
4. The support-backup rule keeps `Alice Family Credits` and `AFam` verbatim.

**Impact**

A user can share a support artifact believing identifying names were transformed while a custom currency discloses the household or organization. This weakens informed consent for a file intended to be sent outside the user's normal data boundary.

**Recommended correction**

- Mask or deterministically remap user-created currency names and symbols while retaining referential consistency.
- Preserve only standard, globally defined currencies verbatim, using an explicit standard/custom distinction.
- Until implemented, state the exact exception in the modal and preview every preserved custom-currency field.
- Add a privacy manifest to the generated artifact describing fields kept, transformed, and excluded.

**Recommended regression test**

Generate a support backup containing a custom currency whose name and symbol contain unique marker strings. Assert that neither marker appears in the decrypted output or preview. Add a UI copy test that matches the backend's de-identification manifest.

**Verification method**

Static comparison of the support-backup explanation and modal flow with the pinned de-identification rules.

---

### P6-015 - Transaction mutations leave cached budget progress stale after success

- **Classification:** confirmed defect
- **Severity:** MEDIUM
- **Confidence:** high

**Locations**

- `frontend/src/lib/transactions.ts:1-118`
- `frontend/src/lib/transactions.ts:150-215`
- `frontend/src/lib/transactions.ts:500-520`
- `frontend/src/lib/apiCache.ts:1-80`
- `frontend/src/lib/budgets.ts:1-420`

**Expected invariant**

A successful transaction mutation must invalidate every cached derived view whose value depends on that transaction, including budget dashboard progress and category-budget status, not only account and portfolio balances.

**Frontend failure**

Create, update, delete, status update, bulk update, and bulk delete call `invalidateBalanceCaches()`. That helper clears only `accounts:` and `investments:`. Budget data has independent cached keys: `budgets:dashboard` uses the default 30-second TTL and `budgets:cat-status:*` uses a 60-second TTL. Transaction writes do not invalidate either prefix.

**Numerical reproduction**

- Budget amount: `100.00`
- Cached actual before write: `40.00`
- Cached remaining before write: `60.00`
- New successful categorized expense: `30.00`
- Expected actual immediately after success: `70.00`
- Expected remaining: `30.00`
- Frontend cached display: actual `40.00`, remaining `60.00`
- Difference: `30.00` in both progress and remaining amount
- Stale interval: up to 30 seconds for the dashboard and 60 seconds for category status, unless another explicit invalidation occurs

The same stale state can follow an edit, delete, VOID transition, split change, transfer split, scheduled posting, investment cash posting, or import path if it writes a budget-relevant category without clearing budget-derived keys.

**Impact**

The UI confirms a financial write but can immediately show materially incorrect budget progress. Users may make a second spending decision from stale remaining funds.

**Recommended correction**

- Introduce a central dependency invalidator for all transaction-affecting writes.
- Clear `budgets:` alongside account, investment, dashboard, report, net-worth, and simulation dependencies as applicable.
- Prefer versioned query dependencies or a single mutation event bus over manually maintained prefix lists.
- Ensure optimistic views either update the exact budget values or show a refreshing state until authoritative data is loaded.

**Recommended regression test**

Prime `budgets:dashboard` and `budgets:cat-status:*`, perform each material transaction mutation, and assert that the next read reaches the API and returns updated actual/remaining values. Include transfer splits, status to/from VOID, scheduled posting, investment cash effects, bulk delete, and import completion.

**Verification method**

Static comparison of transaction mutation invalidation with the independent budget cache keys and TTLs.

## 15. Design risks

The following items are material design risks but did not meet the evidence threshold for a separate confirmed Phase 6 defect.

| ID | Risk | Evidence and realistic scenario | Required decision or verification |
| --- | --- | --- | --- |
| DR-01 | Non-idempotent mutations rely primarily on local button state | MNY start/retry, scheduled posting, emergency claim completion, AI generation, and other write flows can be invoked by double-click, reconnect, remount, another tab, or a second client. Phase 4 already established server races for several of these operations. The frontend does not provide a stable operation key across attempts. | Define which endpoints are idempotent, issue stable keys for retryable operations, and test duplicate requests at the API boundary. Do not describe an ambiguous failure as safe to retry. |
| DR-02 | Handwritten frontend contracts can drift independently of DTOs and entities | Material contracts are duplicated across `frontend/src/types/*`, `frontend/src/lib/*`, backend DTOs, and entity responses. No generated OpenAPI client or compile-time cross-package schema was located. | Choose an authoritative schema and generate or validate frontend contracts in CI, including optionality, enum, date, decimal, and nullability checks. |
| DR-03 | Cache dependencies are maintained as manual string-prefix lists | `apiCache.ts` has independent prefixes and each mutation decides what to clear. P6-015 demonstrates one missed dependency, and similar risk exists for reports, net worth, monthly snapshots, notifications, and simulations. | Introduce typed query keys and a central dependency graph or versioned domain events. Add a guard test that enumerates every money-moving mutation and every derived cache family. |
| DR-04 | Restore success cannot express attachment coverage or partial verification | `RestoreResult` contains a message and table counts; `BackupRestoreSection` presents a green success state. Accepted P3-002 established external attachment restore failure, but the frontend contract has no attachment coverage, provider, verification, or partial-failure field. | Extend the response and UI with database status, attachment status by provider, warnings, verification result, and a partial-success state. Runtime verification was not available, so this remains a design risk rather than a new defect. |
| DR-05 | Persisted Monte Carlo results have weak provenance in the visible contract | Results are cached in browser storage and restored for a scenario. The inspected contract exposes `inputsSnapshot` and `ranAt`, but the UI path did not establish a complete invalidation rule for changed prices, FX, account membership, or backend valuation semantics. | Bind cached results to an input hash, valuation timestamp/version, account data version, and application schema version; show that provenance in the report. |
| DR-06 | Automatic-backup status may conflate artifact creation with durable, verified completion | The UI consumes status fields, but this phase could not execute local/S3/Helm providers or verify how incomplete files, final rename, upload durability, and verification are represented. Accepted Phase 3 findings make this distinction operationally material. | Define an explicit state machine: started, artifact-created, uploaded, durably-finalized, verified, partial, and failed. Exercise each provider and deployment mode in Phase 7/integration testing. |

## 16. Missing tests and tests asserting incorrect behavior

### 16.1 Tests that currently entrench incorrect behavior

| Test path and range | Current assertion | Required replacement |
| --- | --- | --- |
| `frontend/src/hooks/useExchangeRates.test.ts:90-190` | Explicitly expects a missing cross-currency rate to return the original amount. | Expect an unavailable result carrying source, destination, and reason; assert that aggregate consumers render partial/unavailable rather than a number. |
| `frontend/src/components/scheduled-transactions/OverrideEditorDialog.test.tsx:480-680` | Explicitly expects opening the dialog to auto-fill Price from the latest market price. | Preserve the scheduled value or existing override on open. Test an explicit Refresh Price action separately and assert that date/description-only saves do not change money. |
| `backend/src/net-worth/net-worth.service.spec.ts:300-560` | Uses a pre-split quantity of `90`, then a SPLIT `quantity: 90`, and expects `180` shares, thereby asserting addition. | Express split quantity as a ratio and expect multiplication. For example, `90` shares with a `2.0` ratio must become `180`, while a `90.0` ratio would become `8,100`. This is the mandatory P5-011 Phase 7 revisit. |

### 16.2 Phase 6 regression tests required

The connector-limited inventory does not prove recursive absence for every test below. Entries are therefore labelled carefully.

| Finding | Required test | Inventory disposition |
| --- | --- | --- |
| P6-001 | Select one transfer leg, bulk-update status to VOID, and assert the counterpart is included or the operation is blocked. Cover filter mode and exclusion mode. | Test not located. |
| P6-002 | Direct, scheduled, and split USD-to-EUR and EUR-to-USD transfers with explicit rate direction and destination amount; reject incomplete FX. | Test not located. |
| P6-003 | Empty/absent investment FX must not preview 1:1 when commit can resolve market FX; preview and commit must share one resolved rate. | Test not located. |
| P6-004 | Foreign-security transfer must carry source and destination account-currency basis; include partial transfer. | Test not located. |
| P6-005 | Opening and saving an override without editing price must preserve the prior monetary value. | Incorrect inverse behavior is explicitly tested; correct regression is confirmed missing from the inspected file. |
| P6-006 | Missing FX must produce unavailable/partial state and block complete aggregate labels. | Existing hook test asserts the wrong fallback; correct regression is confirmed missing from the inspected file. |
| P6-007 | One holding with `marketValue: null`, portfolio request failure, and one stale price must produce partial/unavailable totals with warnings. | Confirmed missing from the inspected `PortfolioSummaryCard.test.tsx`; broader test not located. |
| P6-008 | Historical-stats failure, `null`, `NaN`, stale value, and explicit zero must remain distinguishable in form and run payload. | Test not located. |
| P6-009 | OIDC restore and account deletion must initiate real reauthentication and must not call destructive APIs with a fixed string. | Test not located. |
| P6-010 | Logout API rejection must show persistent local-only warning and a refresh/logout-family integration test must reject every token afterward. | Test not located. |
| P6-011 | Mixed-sign ordinary split children must be rejected; transfer/investment exceptions must remain valid. | Test not located in the inspected SplitEditor range. |
| P6-012 | Four-decimal split values must survive focus/blur/submit and frontend validation must match backend exact four-decimal equality. | Test not located. |
| P6-013 | Commission-bearing BUY/SELL basis and tooltip semantics must agree in both native and account currencies. | Test not located. |
| P6-014 | Unique markers in custom currency name/symbol must not survive support-backup preview or artifact. | Test not located. |
| P6-015 | Every transaction-affecting mutation must invalidate `budgets:dashboard` and `budgets:cat-status:*`. | Confirmed absent from the inspected balance-cache guard and API modules; broader integration test not located. |

### 16.3 Frontend and CI test inventory

| Area | Paths examined | Configuration observed |
| --- | --- | --- |
| Frontend unit/component | `frontend/package.json`, `frontend/vitest.config.ts`, co-located `*.test.ts`/`*.test.tsx` samples | Vitest, jsdom, Testing Library; global thresholds: branches 84%, functions 87%, lines 91%, statements 90%. |
| Frontend setup | `frontend/src/test/setup.ts`, `frontend/src/test/render.tsx` | Global cleanup and mocks; custom render loads English catalogs and ThemeProvider. |
| Localization | `frontend/src/i18n/messages.parity.test.ts`, pseudo-locale scripts/configuration, CI workflow | Key parity and pseudo-locale checks are configured; semantic correctness across locales is not established by parity. |
| Backend unit | `backend/package.json`, sampled `*.spec.ts` | Jest/ts-jest; global thresholds: branches 85%, functions 95%, lines 95%, statements 94%. Entities, DTOs, migrations, modules, and several bootstrap files are excluded from coverage collection. |
| Backend integration | `backend/test/jest-e2e.json`, CI workflow | Jest integration suite, 30-second timeout, one worker, PostgreSQL test database bootstrap. |
| Browser E2E | `e2e/package.json`, `e2e/playwright.config.ts`, CI workflow | Playwright against frontend/backend/PostgreSQL; Chromium and Firefox; CI retries 2, one worker; UI locale fixed to English. |
| CI | `.github/workflows/ci.yml` sampled | Frontend lint/type/i18n, unit coverage, backend checks/integration, and Playwright jobs are configured. Required-check status and actual results at the baseline were not observable. |

No test, build, lint, type-check, browser, or CI job was executed by this phase.

## 17. Documentation issues

| ID | Classification | Path(s) | Issue | Required correction |
| --- | --- | --- | --- | --- |
| DOC-01 | stale documentation | `CONTRIBUTING.md`; `CLAUDE.md`; `backend/CLAUDE.md` | `CONTRIBUTING.md` still instructs contributors to use `QueryRunner`, while the authoritative scoped instructions prohibit it and require `withScopedDb`. | Replace the obsolete transaction pattern and link to the scoped helper/test conventions. |
| DOC-02 | product-copy contradiction | `frontend/src/i18n/messages/en/investments.json:28-58`; `backend/src/securities/portfolio-calculation.service.ts:600-655` | Cost Basis copy says fees are included, but the formula excludes commission. | Resolve with the P6-013 product decision and update every locale. |
| DOC-03 | privacy-copy contradiction | `frontend/src/i18n/messages/en/settings.json:245-305`; `backend/src/backup/support-backup/support-backup-rules.ts:35-85` | Support-backup copy says names are masked without disclosing preserved custom currency names/symbols. | Generate copy from a versioned privacy manifest or list explicit exceptions. |
| DOC-04 | security-copy contradiction | `frontend/src/components/settings/BackupRestoreSection.tsx:315-425`; `frontend/src/components/settings/DangerZoneSection.tsx:35-95` | Restore and account deletion describe OIDC reauthentication while submitting a fixed string. | Implement actual step-up, then describe it accurately; until then, remove the false guarantee. |
| DOC-05 | incomplete valuation-state contract | Frontend type/client documentation for FX, portfolio, and Monte Carlo | Contracts generally expose numbers without a common complete/partial/unknown/stale envelope. This enables ordinary formatting of incomplete totals. | Document and type a shared valuation-result model with value, completeness, missing inputs, source timestamps, and errors. |
| DOC-06 | future-plan classification risk | `docs/future-plans/*` references encountered by search | Search results can resemble implemented architecture or security guarantees, but these files are future plans and were not treated as baseline behavior. | Add prominent implementation-status metadata and links to the implemented version or issue. |

## 18. Reviewed scope

The following ledger is evidence of inspected scope, not a claim that every file in each directory was reviewed.

### 18.1 Directories inspected

- Repository root instruction and contributor files.
- `.claude/` guidance and `.github/workflows/` CI configuration.
- `frontend/` package and test configuration.
- `frontend/src/app/` account, transaction, investment, import, emergency-access, and report entry points by targeted path.
- `frontend/src/components/` transaction, scheduled transaction, investment, settings, import, layout, report, account, and shared input components by targeted path.
- `frontend/src/hooks/`, `frontend/src/lib/`, `frontend/src/store/`, `frontend/src/types/`, `frontend/src/i18n/`, and `frontend/src/test/` by targeted path.
- `backend/src/accounts/`, `auth/`, `backup/`, `common/`, `import/`, `mcp/`, `net-worth/`, `scheduled-transactions/`, `securities/`, and `transactions/` by targeted path.
- `backend/test/` configuration and selected test paths.
- `e2e/` package and Playwright configuration.
- `database/` instructions and schema context through the accepted earlier phases.

### 18.2 Files inspected in full

A file is listed here only where the connector response or contiguous range set covered the complete file. All other evidence paths are conservatively classified as sampled in Section 18.3.

Instruction and documentation files:

- `CLAUDE.md`
- `frontend/CLAUDE.md`
- `backend/CLAUDE.md`
- `database/CLAUDE.md`
- `backend/src/mcp/CLAUDE.md`
- `.claude/settings.json`
- `.claude/skills/frontend.md`
- `.claude/skills/backend.md`
- `.claude/skills/infrastructure.md`
- `CONTRIBUTING.md`
- `SECURITY.md`

Configuration and framework files:

- `frontend/package.json`
- `frontend/vitest.config.ts`
- `frontend/src/test/setup.ts`
- `frontend/src/test/render.tsx`
- `backend/package.json`
- `backend/test/jest-e2e.json`
- `e2e/package.json`
- `e2e/playwright.config.ts`

Frontend contracts and infrastructure:

- `frontend/src/lib/apiCache.ts`
- `frontend/src/lib/transactions.ts`
- `frontend/src/lib/scheduled-transactions.ts`
- `frontend/src/lib/monte-carlo.ts`
- `frontend/src/hooks/useExchangeRates.ts`
- `frontend/src/hooks/useExchangeRates.test.ts`
- `frontend/src/hooks/useTransactionSelection.ts`
- `frontend/src/store/authStore.ts`
- `frontend/src/types/account.ts`
- `frontend/src/types/transaction.ts`
- `frontend/src/types/investment.ts`
- `frontend/src/types/scheduled-transaction.ts`
- `frontend/src/i18n/config.ts`
- `frontend/src/i18n/messages.ts`
- `frontend/src/i18n/messages.parity.test.ts`

Small backend contracts and utilities:

- `backend/src/common/split-amount.util.ts`
- `backend/src/transactions/dto/create-transfer.dto.ts`
- `backend/src/transactions/dto/create-transaction.dto.ts`
- `backend/src/transactions/dto/create-transaction-split.dto.ts`
- `backend/src/backup/support-backup/support-backup-rules.ts`

### 18.3 Files sampled or inspected through focused ranges

Root, documentation, core modules, and large contracts sampled:

- `README.md`
- `.github/workflows/ci.yml`
- `frontend/src/lib/api.ts`
- `frontend/src/lib/accounts.ts`
- `frontend/src/lib/budgets.ts`
- `frontend/src/lib/backupApi.ts`
- `frontend/src/lib/auth.ts`
- `frontend/src/lib/delegation.ts`
- `frontend/src/lib/attachments.ts`
- `frontend/src/lib/investments.ts`
- `frontend/src/lib/loan-schedule.ts`
- `frontend/src/lib/loan-schedule-rows.ts`
- `frontend/src/hooks/useDateFormat.ts`
- `backend/src/transactions/entities/transaction.entity.ts`
- `backend/src/securities/entities/investment-transaction.entity.ts`
- `backend/src/auth/step-up/step-up.service.ts`

Frontend components and pages:

- `frontend/src/components/transactions/TransactionForm.tsx`
- `frontend/src/components/transactions/TransferTransactionFields.tsx`
- `frontend/src/components/transactions/SplitEditor.tsx`
- `frontend/src/components/transactions/BulkUpdateModal.tsx`
- `frontend/src/app/transactions/page.tsx`
- `frontend/src/app/accounts/page.tsx`
- `frontend/src/app/investments/page.tsx`
- `frontend/src/components/investments/InvestmentTransactionForm.tsx`
- `frontend/src/components/investments/PortfolioSummaryCard.tsx`
- `frontend/src/components/investments/GroupedHoldingsList.tsx`
- `frontend/src/components/scheduled-transactions/ScheduledTransactionForm.tsx`
- `frontend/src/components/scheduled-transactions/OverrideEditorDialog.tsx`
- `frontend/src/components/reports/MonteCarloReport.tsx`
- `frontend/src/components/reports/useMonteCarloScenarios.ts`
- `frontend/src/components/settings/BackupRestoreSection.tsx`
- `frontend/src/components/settings/AutoBackupSection.tsx`
- `frontend/src/components/settings/SupportBackupModal.tsx`
- `frontend/src/components/settings/DangerZoneSection.tsx`
- `frontend/src/components/layout/AppHeader.tsx`
- `frontend/src/components/layout/DelegationBanner.tsx`
- `frontend/src/components/import/MnyImportProgress.tsx`
- `frontend/src/app/import/page.tsx`
- `frontend/src/hooks/useMnyImport.ts`
- `frontend/src/components/accounts/LoanPaymentSetupDialog.tsx`
- `frontend/src/components/ui/CurrencyInput.tsx`
- `frontend/src/components/ui/DateInput.tsx`

Frontend tests sampled:

- `frontend/src/components/transactions/SplitEditor.test.tsx`
- `frontend/src/components/scheduled-transactions/OverrideEditorDialog.test.tsx`
- `frontend/src/components/investments/PortfolioSummaryCard.test.tsx`
- `frontend/src/lib/balance-cache.guard.test.ts`
- selected localization and utility tests returned by targeted search

Backend services and tests sampled:

- `backend/src/transactions/transaction-transfer.service.ts`
- `backend/src/transactions/transaction-split.service.ts`
- `backend/src/transactions/transaction-bulk-update.service.ts`
- `backend/src/scheduled-transactions/scheduled-transactions.service.ts`
- `backend/src/securities/investment-transactions.service.ts`
- `backend/src/securities/portfolio.service.ts`
- `backend/src/securities/portfolio-calculation.service.ts`
- `backend/src/import/mny/mny-import.service.ts`
- `backend/src/import/mny/mny-import-job.service.ts`
- `backend/src/backup/auto-backup.service.ts`
- `backend/src/net-worth/net-worth.service.spec.ts`
- `backend/src/accounts/entities/account.entity.ts`

CI was sampled in focused ranges from `.github/workflows/ci.yml`; the complete immutable workflow dependency graph was not reconstructed.

## 19. Unreviewed or inaccessible scope

- A recursive immutable repository tree was unavailable. Search caps and branch-index behavior mean absence of a path cannot always be proven.
- No `AGENTS.md` was located, but recursive immutable absence was not proven.
- Search results frequently returned links to a newer default-branch revision. Those results were discarded unless the file was re-fetched at the audited SHA.
- Connector search output was sometimes capped, truncated, noisy, or empty. Candidate discovery for notifications, AI-insight UI, and some localization paths remained incomplete.
- The complete semantic content of every supported locale was not reviewed. Structural key parity and selected finance/security strings were inspected.
- No frontend build, TypeScript check, ESLint run, Vitest run, Jest run, Playwright run, browser screenshot, accessibility pass, or runtime locale switch was executed.
- No API, OAuth/OIDC provider, refresh-token race, emergency claim, database, RLS, backup, restore, S3, local attachment storage, Helm deployment, cron, or external-provider scenario was executed.
- CI logs, artifacts, flaky-test history, branch-protection required checks, merge-queue results, and PR-head versus merge-SHA results were inaccessible.
- Production bundle behavior, service-worker/browser cache behavior, CDN/proxy behavior, and deployed version skew were not inspected.
- Mobile browsers, non-English browser locales with comma decimal separators, DST boundary runs, and timezone changes were not executed.
- Full import coverage outside the inspected MNY paths, all AI workflows, all notification/reminder components, and every report adapter were not exhaustively reviewed.
- Track B PR #1014 implementation was not treated as evidence and was not available at the fixed baseline.

## 20. Phase 1-5 finding verification and disposition

This table records the Phase 6 frontend disposition. It does not replace the authoritative earlier reports.

### 20.1 Financial findings from Phase 5

| Earlier finding | Phase 6 disposition | Result |
| --- | --- | --- |
| P5-001 - Transfer VOID transitions break ledger and balance equivalence | The create/edit form sends `status`, and bulk update can send `VOID` for only selected IDs without expanding the linked pair. | **Strengthened by P6-001.** Distinct frontend invalid-payload/selection failure confirmed. |
| P5-002 - Transfer currency and destination value are not server-authoritative | Direct transfer makes received amount optional; scheduled transfer and transfer-split paths collect no complete FX contract. | **Strengthened by P6-002.** |
| P5-003 - Transaction currency can disagree with account currency | Main form derives account currency from account data in the inspected path. Copy/import/quick-add coverage was incomplete and no distinct stale-currency payload was proven. | No new finding; open test hypothesis. |
| P5-004 - Mixed-sign split children pass validation | Split editor independently controls child signs and validates only the sum. Its cent-level balance check also diverges from backend four-decimal equality. | **Strengthened by P6-011 and P6-012.** |
| P5-005 - Investment FX zero produces different preview and persisted cash | Zod rejects explicit zero, so the exact zero-entry frontend scenario was not reproduced. However, an empty/absent rate previews at 1:1 while commit may resolve market FX. | **Strengthened, narrowed, and superseded by P6-003 for the frontend path.** |
| P5-006 - Acquisition commission is excluded from cost basis | UI tooltip explicitly says transaction fees are included while the replay formula excludes commission. | **Strengthened by P6-013.** |
| P5-007 - Transfer budgets omit transfer amounts embedded in splits | No separate local budget calculation rule was proven. Transaction-derived budget cache invalidation is independently incomplete. | Backend defect not duplicated; **P6-015** is a separate stale-cache defect. |
| P5-008 - Final scheduled loan payment is not reduced to outstanding balance | The inspected frontend loan schedule clamps the final projected principal/payment to remaining balance. | Frontend duplicate rejected; backend posting defect remains. |
| P5-009 - Missing exchange rates are silently interpreted as 1:1 | `useExchangeRates` intentionally returns the original amount, and accounts aggregates label it in the default currency. | **Strengthened by P6-006.** |
| P5-010 - Monte Carlo valuation failure becomes zero | Frontend types `currentBalance` as required number and normalization/effects coerce unavailable/non-finite states to zero. | **Strengthened by P6-008.** |
| P5-011 - Historical net worth adds split ratio instead of multiplying shares | Frontend split entry and preview use a ratio and multiply current quantity; no independent frontend additive transform was found. The backend spec explicitly entrenches addition. | No new frontend finding. Mandatory Phase 7 test correction preserved. |
| P5-012 - Bulk deletion leaves linked-account snapshots stale | Backend bulk delete expands linked transaction IDs, and frontend bulk delete clears account and investment cache prefixes. | Frontend stale-cache duplicate rejected. Historical snapshot/backend behavior remains governed by P5-012. |
| P5-013 - Foreign-security transfer resets account-currency basis to implied 1:1 | Transfer form allows different-currency destination brokerage accounts but sends only source cost per share and no destination basis/FX contract. | **Strengthened by P6-004.** |

### 20.2 Security, backup, and concurrency findings relevant to the frontend

| Earlier finding(s) | Phase 6 disposition | Result |
| --- | --- | --- |
| P2-003 - Delegated `/users/me` exposes excess fields | Delegation switch clears cache via full reload; no distinct frontend cache leak of the excess profile fields was confirmed. | Backend exposure only in this phase; test required. |
| P2-005 and P3-009 - Weak OIDC destructive-action confirmation | Restore and account deletion submit a fixed string while claiming reauthentication; a real OIDC initiation path exists elsewhere. | **Strengthened by P6-009.** |
| P2-007 - Delegation create/link/revoke conflicts with RLS | UI visibility was not treated as authorization. No separate frontend request transformation was confirmed. | No duplicate; integration tests required. |
| P2-008 - Delegated activity updates owner timestamp | No distinct frontend semantic transform was found. | Backend finding only; delegated identity presentation tests required. |
| P4-007 - One emergency claim can be consumed twice | Frontend sends a single completion request and no automatic retry was found in the inspected client. Double-click/two-client behavior remains possible without server idempotency. | Design risk DR-01; no duplicate finding. |
| P4-011 - Logout can miss a concurrently rotated refresh token | UI hides logout API failure and presents local cleanup as completion. | **Strengthened by P6-010.** |
| P4-014 - Emergency grant issuance can send invalidated links | No distinct frontend transformation or false success path was confirmed. | No duplicate; integration test required. |
| P3-001 - Shared backup namespace | UI exposure did not establish a separate client defect. | No duplicate. |
| P3-002 - External attachment restore failure | Restore result/UI has no attachment coverage or partial state. Runtime path was unavailable. | Design risk DR-04; not promoted to a confirmed defect. |
| P3-004, P3-006, P3-007, P3-008, P3-012 | Non-atomic writes, unavailable Helm storage, missing snapshot, memory risk, unbounded decompression | No distinct frontend transformation was established. Some UI completion wording remains dependent on backend response quality. | No duplicate; provider/runtime tests required. |
| P3-005 - Arbitrary filesystem browsing/destination | Frontend controls were not exhaustively reconstructed at the pinned SHA. | Unverified hypothesis; do not promote. |
| P3-013 and P3-014 - Custom-currency portability and support-backup de-identification | UI promises names are masked while custom currency fields are preserved. | **Strengthened by P6-014** for privacy copy; portability remains backend/restore scope. |
| P3-015 - Currency cleanup | No distinct frontend defect confirmed. | No duplicate. |
| P4-001/P4-002 - MNY start/retry idempotency | Retry launches a new job, but inspected backend import writes run in one scoped transaction; partial-write duplicate hypothesis was rejected. Parallel start remains server race risk. | Design risk DR-01; no duplicate. |
| P4-004 - Scheduled occurrence duplication | Post UI has local loading state but no stable idempotency key across clients/reconnects. | Design risk DR-01; backend root cause remains. |
| P4-010 - Attachment lifecycle atomicity | Attachment client sends ordinary upload/delete requests; no additional cache or presentation failure was confirmed. | No duplicate; provider integration tests required. |
| P4-013 - Duplicate AI generation | AI frontend path discovery was incomplete. | Unverified frontend hypothesis; backend finding remains. |
| P4-015, P4-017, P4-018 - Duplicate budget alerts, attachment cap race, duplicate reminders | No distinct retry, collapse, or display defect was proven in the limited frontend path inventory. | No duplicate; concurrency/browser tests required. |

### 20.3 Phase 1-4 dependencies

- Phase 1 supplied the immutable baseline and architecture/instruction hierarchy.
- Phase 2 supplied authorization and RLS invariants used to avoid treating hidden UI as an access control.
- Phase 3 supplied backup, restore, support-backup, and provider-failure invariants.
- Phase 4 supplied concurrency, retry, session-rotation, and idempotency scenarios.
- Phase 5 supplied the financial invariants and mandatory numerical examples used throughout this report.

No earlier finding was silently copied. Duplicate candidates that lacked a distinct frontend cause are explicitly rejected below.

## 21. Track B GEM baseline-verification table

Search was used only for candidate discovery. Every candidate would have required a re-fetch at the audited SHA. No GEM implementation was confirmed at that SHA.

| Candidate | Search disposition | Baseline evidence | Phase 6 result |
| --- | --- | --- | --- |
| GEM configuration | Search returned no reliable pinned candidate; `GEM` also matched unrelated substrings/current-head content. | None at `d5cea9bfa995885ba5198f9843359362927c0fd4`. | Not present/located; no finding. |
| Signal history | No pinned frontend or backend path confirmed. | None. | No finding. |
| Momentum calculation/display | No pinned implementation confirmed. | None. | No finding. |
| Portfolio compliance | No pinned implementation confirmed. | None. | No finding. |
| Recommended operations | Search for `recommendedOperations` returned no baseline candidate. | None. | No finding. |
| Stale-price warning specific to GEM | No pinned GEM warning component/type/localization confirmed. | None. | No finding. |
| GEM frontend types/hooks/pages/components/localization | No candidate survived SHA-pinned verification. | None. | Track B remains outside the baseline audit. |

The moving PR head and short SHA `8fd4c4f` were not used as evidence.

## 22. Contradictions and supersession register

| Register item | Type | Evidence | Disposition |
| --- | --- | --- | --- |
| `CONTRIBUTING.md` recommends QueryRunner while scoped instructions prohibit it | Documentation contradiction | Root contributor guide versus `CLAUDE.md` and `backend/CLAUDE.md` | DOC-01; scoped instructions take precedence. |
| Missing FX is expected to return the original number in a frontend unit test | Test contradicts financial invariant | `frontend/src/hooks/useExchangeRates.test.ts:90-190` | Incorrect test; replace in Phase 7. |
| Scheduled override test expects latest price to overwrite form value on open | Test contradicts edit-preservation invariant | `OverrideEditorDialog.test.tsx:480-680` | Incorrect test; replace in Phase 7. |
| Historical net-worth test expects SPLIT quantity to be added | Test contradicts ratio semantics and current frontend preview | `backend/src/net-worth/net-worth.service.spec.ts:300-560` | Incorrect test entrenching P5-011; mandatory Phase 7 correction. |
| Cost Basis tooltip says fees are included | Product copy contradicts calculation | P6-013 evidence | Confirmed defect; resolve product model. |
| Support-backup copy says names are masked | Privacy copy contradicts preserved custom currency fields | P6-014 evidence | Confirmed defect; manifest/copy and transformation must agree. |
| Restore/account deletion say reauthenticate | Security copy contradicts fixed-string request | P6-009 evidence | Confirmed defect; implement real step-up. |
| P5-005 named explicit zero as the frontend trigger | Frontend schema rejects zero but absent rate still diverges | Investment form schema and request/preview path | Narrowed and superseded by P6-003 for frontend behavior. |
| P5-008 suggested checking a frontend final-payment preview | Frontend schedule already clamps final payment | `frontend/src/lib/loan-schedule.ts` | Frontend duplicate disproved; backend posting finding remains. |
| P5-012 suggested frontend linked-account cache staleness | Bulk delete expands linked rows and clears balance caches | backend bulk-delete service and `transactionsApi.bulkDelete` | Frontend duplicate disproved; backend snapshot issue remains. |

## 23. False positives investigated and rejected

| Candidate | Investigation | Rejection basis |
| --- | --- | --- |
| Bulk delete leaves the destination transfer account cached | Traced selection payload, backend linked-ID expansion, and frontend post-success invalidation. | Backend includes linked transactions in delete processing, and `transactionsApi.bulkDelete` clears both account and investment cache families. No separate Phase 6 stale-cache defect was confirmed. |
| Frontend final loan payment repeats the Phase 5 overpayment defect | Inspected `loan-schedule.ts`, schedule-row helpers, and setup dialog. | Client projection caps the final principal/payment at remaining balance. The accepted backend posting bug is not reproduced by the inspected frontend calculator. |
| Date-only transaction fields shift one day through UTC parsing | Inspected `DateInput`, date-format utilities, transaction/scheduled forms, and date string types. | Material DATE paths use `YYYY-MM-DD` strings or local component parsing rather than `new Date('YYYY-MM-DD')`. No exact one-day failure was confirmed. |
| Delegation switch leaks cached owner financial/profile data | Inspected delegation banner/context switch, auth store, and API cache behavior. | Switching context forces a full page reload, clearing the in-memory cache. No persistent user profile PII is stored in localStorage. Backend exposure findings remain separate. |
| Restore leaves pre-restore client caches intact | Inspected `backupApi.restoreBackup`. | Successful restore calls `clearAllCache()`. Other local component state may refresh on navigation/reload, but the global API cache is explicitly cleared. |
| Retrying an MNY job after a failure necessarily duplicates partially committed data | Traced retry/start client behavior and `mny-import.service.ts`. | The inspected import write path runs inside one scoped database transaction, so a thrown write failure rolls back. Parallel start/idempotency remains a design risk, not this partial-commit scenario. |
| Explicit investment FX zero reaches commit and diverges from preview | Inspected form schema and request construction. | Zod requires `exchangeRate > 0`, so explicit zero is blocked. The confirmed defect is the absent-rate path in P6-003. |
| Missing localization keys are broadly exposed in production flows | Inspected locale registry, message loader, parity test, and pseudo-locale CI configuration. | Structural parity is enforced. Semantic translation quality across every locale was not proven, but no broad missing-key defect was confirmed. |
| Stock split frontend independently adds the ratio | Inspected split form defaults, ratio construction, and preview. | Frontend computes `newQty = currentQty * splitRatio`. The additive behavior is in historical backend replay and its test, not the inspected component. |
| Track B GEM findings apply to the audit baseline | Searched GEM, momentum, signal, compliance, recommended operations, and warning terms, then required pinned re-fetch. | No implementation was confirmed at the baseline SHA. Current-head/PR evidence was rejected. |
| Automatic-backup UI definitively claims provider durability after an incomplete artifact | Inspected status component and backend service ranges. | Provider/runtime evidence and exact partial-file response semantics were unavailable. The concern remains DR-06, not a confirmed frontend defect. |
| Hidden controls provide authorization for delegation or backup operations | Inspected relevant components and API calls. | UI hiding was never treated as an authorization boundary; backend/RLS controls remain authoritative. |

## 24. Areas reviewed without a material Phase 6 finding

- Authentication tokens are documented and implemented as HttpOnly-cookie managed; the frontend store does not persist user PII or auth tokens in localStorage.
- Delegation context switching performs a full reload, which clears the in-memory API cache and avoids the most direct cross-context stale-data path.
- Successful restore explicitly clears the global API cache.
- Core transaction and scheduled-post mutations clear account and investment balance cache prefixes; the material gap confirmed in P6-015 is the omitted budget family.
- Bulk delete clears account/investment caches and the backend expands linked transfer IDs.
- The inspected date-only utilities preserve `YYYY-MM-DD` semantics and avoid a confirmed UTC-midnight day shift.
- The frontend loan projection reduces the final payment to remaining principal.
- The investment stock-split entry form labels and previews a ratio by multiplication; it does not independently implement the historical additive bug.
- Locale key parity and pseudo-locale checks are configured, and no material missing-key production failure was confirmed.
- The support-backup modal uses Web Crypto for its generated multiplier and password, and backup header values are encoded to preserve whitespace/non-ASCII bytes.
- Attachment download URLs remain same-origin and use the HttpOnly-cookie session; no separate client-side token exposure was found.
- MNY import writes inspected in the backend are transaction-scoped, rejecting the partial-commit retry hypothesis.
- No material visual, styling, component-size, memoization, or subjective UX issue was reported.

## 25. Open hypotheses requiring Phase 7 or runtime verification

1. Whether account change in every edit/copy/quick-add/import path can retain a stale transaction currency despite the main form deriving it from the selected account.
2. Whether non-idempotent buttons can be submitted twice through fast double-click, React remount, browser restore, reconnect, or two tabs before local loading state applies.
3. Whether automatic-backup success states distinguish local finalization, S3 completion, verification, and partial-file cleanup for each provider/deployment mode.
4. Whether restore can return a nominal success response while local/S3 attachment restoration is partial, and how the UI should reconcile counts with attachment failures.
5. Whether all report, net-worth, monthly-history, notification, and simulation caches are invalidated by every money-moving mutation; P6-015 proves the current dependency model is incomplete.
6. Whether semantic translations of VOID, transfer direction, rate direction, cost basis, support-backup privacy, delegation, and destructive actions remain correct across all production locales.
7. Whether browser locales using comma decimal separators round-trip all money/rate/quantity fields without reinterpretation.
8. Whether DST, browser timezone change, and server/client clock skew affect stale-rate labels, emergency expiry, backup timestamps, or import status ordering.
9. Whether the logout race in P4-011 can recreate authenticated state in the same tab after the local store has routed to login.
10. Whether AI, notification, and reminder components add retry or duplicate-display behavior to the accepted Phase 4 concurrency defects; path discovery was incomplete.

## 26. Audit ledger

### 26.1 Mandatory ledger fields

| Ledger field | Recorded value |
| --- | --- |
| Audit phase | Phase 6 - Frontend Contracts, Adapters, Components, Caching, and Localization |
| Worker chat | `06 - Monize Audit: Frontend Contracts` |
| Audited SHA | `d5cea9bfa995885ba5198f9843359362927c0fd4` |
| Assigned scope | Backend-to-frontend contracts, types, API clients, transformations, forms, signs, FX, precision, unknown states, dates, caches, localization, and frontend tests |
| Instruction hierarchy | Root and scoped `CLAUDE.md` files; `.claude` guidance treated as auxiliary; nearest scoped file took precedence |
| Directories inspected | Listed in Section 18.1; targeted inspection only, not complete directory coverage |
| Files inspected in full | Listed in Section 18.2 |
| Files sampled | Listed in Section 18.3 |
| Inaccessible files/resources | Recursive immutable tree, complete CI logs/artifacts/statuses, deployment/provider/runtime state, and some search-discovered paths |
| Capped or truncated searches | Yes. GitHub search was sometimes capped/noisy; large file responses were range-fetched; search results often pointed to a newer head and were discarded unless pinned re-fetch succeeded |
| Tests/checks/CI examined | Vitest/Jest/Playwright configs; selected component/hook/service tests; localization parity; balance-cache guard; CI workflow ranges; baseline workflow/status API queries |
| Tests actually executed | None |
| Browser/runtime scenarios executed | None |
| Frontend architecture inventory | Completed in Section 5 |
| Backend-to-frontend contract matrix | Completed in Section 6 for 24 material domains, with explicit partial/not-located statuses |
| Amount/sign matrix | Completed in Section 7 |
| Currency/FX matrix | Completed in Section 8 |
| Precision/rounding matrix | Completed in Section 9 |
| Null/zero/unknown matrix | Completed in Section 10 |
| Date/timezone matrix | Completed in Section 11 |
| Cache-invalidation matrix | Completed in Section 12 |
| Localization ledger | Completed in Section 13 |
| Confirmed findings | 15 total: 0 BLOCKER, 10 HIGH, 5 MEDIUM, 0 LOW |
| Design risks | 6, recorded in Section 15 |
| Missing/incorrect tests | Incorrect tests and Phase 6 regression backlog recorded in Section 16 |
| Documentation issues | 6, recorded in Section 17 |
| Open hypotheses | 10, recorded in Section 25 |
| False positives investigated and rejected | 12 scenarios, recorded in Section 23 |
| Areas reviewed without material findings | Recorded in Section 24 |
| Dependencies on Phases 1-5 | Baseline/instructions, authorization/RLS, backup/restore, concurrency, and financial invariants; dispositions in Section 20 |
| Contradictions with earlier reports | No accepted earlier finding was disproved globally; frontend duplicates for P5-008 and the cache portion of P5-012 were rejected; P5-005 frontend trigger was narrowed |
| Duplicate/strengthened/superseded/downgraded/disproved findings | Detailed in Sections 20 and 22 |
| Track B GEM baseline disposition | No implementation confirmed at baseline; table in Section 21 |
| Report filename | `monize-audit-06-frontend-contracts.md` |
| Completion status | Complete subject to stated static-analysis and connector limitations |
| Next required action | Phase 7 test and CI audit at the same SHA, producing `monize-audit-07-tests-ci.md` |

### 26.2 Finding ledger

| Severity | IDs | Count |
| --- | --- | ---: |
| BLOCKER | None | 0 |
| HIGH | P6-001 through P6-010 | 10 |
| MEDIUM | P6-011 through P6-015 | 5 |
| LOW | None | 0 |

### 26.3 Evidence and execution limitations ledger

- Every finding cites a pinned path and focused range at the audited SHA.
- Search-only results were not used as finding evidence.
- No finding depends on the current default-branch head, PR #1014, or short SHA `8fd4c4f`.
- No claim is made that all frontend files, all localization semantics, all test files, or all CI paths were reviewed.
- Numerical examples are derived from the traced formulas and request transformations; they were not executed against a live application.
- CI configuration was inspected, but the connector returned no workflow runs or combined statuses for the baseline.
- Because no runtime was available, browser interaction timing, double submission, provider failures, and real network retry behavior remain unexecuted.

## 27. Handoff to Phase 7: Tests and CI

Phase 7 must create:

```text
monize-audit-07-tests-ci.md
```

### 27.1 Immutable audit context

- Repository: `kenlasko/monize`
- Required SHA: `d5cea9bfa995885ba5198f9843359362927c0fd4`
- Do not resolve or follow `main`.
- Do not use PR #1014 short head `8fd4c4f` as Track A evidence.
- Re-fetch every test, workflow, helper, fixture, source file, migration, and configuration at the fixed SHA.
- Read all applicable `CLAUDE.md` files before modifying the test-audit plan.
- Phase 7 remains read-only and must not commit, push, comment, review, label, or change settings.

### 27.2 Test framework and configuration paths

| Layer | Exact path | Phase 7 action |
| --- | --- | --- |
| Frontend scripts/dependencies | `frontend/package.json` | Verify every CI script, test command, coverage invocation, and lockfile-resolved version. |
| Frontend unit config | `frontend/vitest.config.ts` | Reconfirm thresholds, exclusions, pool/timeout behavior, reporters, and changed-file behavior. |
| Frontend setup | `frontend/src/test/setup.ts` | Audit global mocks for over-broad suppression, state leakage, timer/network behavior, and hidden console failures. |
| Frontend render helper | `frontend/src/test/render.tsx` | Note that component tests load English catalogs only; add locale-specific semantic tests where required. |
| Backend scripts/Jest config | `backend/package.json` | Reconfirm unit and coverage commands, thresholds, exclusions, test regex, transform behavior, and `--fix` side effects in lint scripts. |
| Backend integration config | `backend/test/jest-e2e.json` | Verify database reset/isolation, one-worker assumptions, timeout, environment variables, and suite discovery. |
| Browser scripts | `e2e/package.json` | Inventory all suites, setup, teardown, fixtures, and browser-specific scripts. |
| Playwright config | `e2e/playwright.config.ts` | Verify Chromium/Firefox coverage, retries, trace/video/screenshots, locale/timezone, workers, web-server readiness, and CI behavior. |
| Main CI workflow | `.github/workflows/ci.yml` | Reconstruct every job, dependency, conditional, matrix, artifact, cache, service, permission, and required-check name. |
| Scoped DB helper | `backend/src/test-helpers/scoped-db-testing.ts` | Verify that unit mocks preserve transaction/RLS behavior rather than bypassing it. |
| Localization parity | `frontend/src/i18n/messages.parity.test.ts` and pseudo-locale scripts | Separate structural parity from semantic correctness. |
| Migration checks | `backend/scripts/migration-lint.mjs`, `backend/scripts/migration-lint.test.mjs`, migration directories, `database/schema.sql` | Verify schema drift, migration ordering, downgrade/restore assumptions, and fresh-install parity. |

Observed coverage thresholds at the audited SHA:

- Frontend: branches 84%, functions 87%, lines 91%, statements 90%.
- Backend: branches 85%, functions 95%, lines 95%, statements 94%.
- Backend collection excludes entities, DTOs, migrations, modules, bootstrap files, and fixtures; Phase 7 must evaluate whether those exclusions hide the exact contract/migration risks identified in Phases 2-6.

### 27.3 Tests that must be corrected before trusting a green suite

1. `frontend/src/hooks/useExchangeRates.test.ts:90-190`
   - Remove the expectation that missing FX returns the original amount.
   - Introduce an unavailable/partial result and assert downstream warning behavior.

2. `frontend/src/components/scheduled-transactions/OverrideEditorDialog.test.tsx:480-680`
   - Remove the expectation that dialog open overwrites Price with latest market price.
   - Assert value preservation and explicit refresh behavior.

3. `backend/src/net-worth/net-worth.service.spec.ts:300-560`
   - Replace additive SPLIT expectation.
   - Use a ratio and assert multiplication.
   - Add reverse split and multiple-split chronology.

A passing run that retains these assertions would validate known incorrect behavior.

### 27.4 Phase 6 regression-test ledger

| Finding | Unit/component target | Integration/E2E target | Required assertions |
| --- | --- | --- | --- |
| P6-001 | `useTransactionSelection` and `BulkUpdateModal` tests | Transaction bulk-update API plus browser selection | One selected transfer leg cannot be VOIDed alone; filter/exclusion mode handles both legs atomically. |
| P6-002 | `TransactionForm`, `ScheduledTransactionForm`, `SplitEditor` | Cross-currency transfer create/post/edit | Source/destination currencies derive from accounts; rate direction is destination units per one source unit; incomplete FX is rejected; 100 USD at 0.9 produces 90 EUR. |
| P6-003 | `InvestmentTransactionForm` | Investment preview/create API | Empty rate cannot preview 1:1 when commit uses market rate; preview and persisted cash use the same resolved rate/version. |
| P6-004 | `InvestmentTransactionForm` transfer mode | Security-transfer endpoint and portfolio replay | Destination basis preserves account-currency value through full and partial foreign-account transfer. |
| P6-005 | Existing override dialog test | Scheduled occurrence override/post | Date/description-only edit preserves quantity, price, total, and commission; explicit refresh is the only market-price update. |
| P6-006 | Existing exchange-rate hook test and accounts-page test | FX lookup failure in browser | Missing rate remains unknown; no complete total; same-currency 1.0 remains valid and distinct. |
| P6-007 | `PortfolioSummaryCard` and accounts-page tests | Price lookup failure/partial portfolio | One `marketValue: null` or portfolio request failure renders partial/unavailable, identifies missing holdings, and never formats zero as complete. |
| P6-008 | `useMonteCarloScenarios` and report form | Historical-stats failure and run API | Explicit zero, loading, failure, stale value, and unavailable valuation are distinct; 100,000 failure cannot become 0.00. |
| P6-009 | Restore and Danger Zone component tests | OIDC callback/step-up destructive flow | Fixed/arbitrary token rejected; destructive API blocked until purpose-bound reauthentication completes. |
| P6-010 | AppHeader/auth-store tests | Refresh rotation versus logout | API failure yields visible local-only warning; every token in the family is invalid after successful logout. |
| P6-011 | SplitEditor tests | Create/update/import/scheduled split APIs | Mixed-sign ordinary children rejected; parent sign changes revalidate; explicit transfer/investment exceptions covered. |
| P6-012 | CurrencyInput and SplitEditor tests | Four-decimal split API | Exact four-decimal parity between UI and backend; hidden residual cannot be called balanced; no round-trip loss. |
| P6-013 | PortfolioSummary copy/render tests | Basis/gain service tests | 10 x 100 plus 20 commission produces the product-decided basis and matching tooltip in both currencies. |
| P6-014 | SupportBackupModal copy/preview test | Decrypted support-backup artifact | Custom currency marker strings are transformed or explicitly disclosed; preview and manifest match artifact. |
| P6-015 | `balance-cache.guard.test.ts` and API module tests | Browser create/edit/delete/VOID/scheduled/import flows | Prime budget caches, mutate transaction, and require immediate authoritative actual/remaining refresh. |

### 27.5 Earlier-phase test backlog that Phase 7 must preserve

#### Security and RLS

- P2-003: delegated profile allowlist for `/users/me`; assert sensitive fields are absent in delegated context and caches are cleared on context switch.
- P2-005/P3-009: reject arbitrary OIDC confirmation values for every destructive action.
- P2-007: delegation create/link/revoke under enforced RLS, including rollback and ownership boundaries.
- P2-008: activity timestamp attribution must update the real actor, not the effective owner.
- P4-007: two concurrent emergency-claim completions; exactly one succeeds and token consumption is atomic.
- P4-011: logout raced with refresh rotation; no descendant refresh token survives.
- P4-014: emergency grant issuance must not send a link invalidated before delivery.

#### Database, migration, backup, and restore

- P3-001: namespace isolation between users/instances and concurrent backup runs.
- P3-002: local and S3 attachment restore, missing objects, partial provider failure, and accurate partial result reporting.
- P3-004: crash/power-loss simulation around temporary write, fsync, final rename, and cleanup.
- P3-005: path traversal/arbitrary destination authorization tests and normal-user UI/API restrictions.
- P3-006: default Helm deployment backup volume smoke test and persistence across pod replacement.
- P3-007: export must contain one transactionally consistent database snapshot.
- P3-008: large backup streaming/memory limit test.
- P3-012: compressed and decompressed size/ratio limits, nested/hostile input, and timeout.
- P3-013: custom-currency backup/restore portability and ID remapping.
- P3-014/P6-014: support-backup custom-currency de-identification and privacy manifest.
- P3-015: currency cleanup/referential-integrity tests.
- P4-010: local/S3 attachment row/object lifecycle atomicity, retry, and orphan cleanup.

#### Concurrency and idempotency

- P4-001/P4-002: two simultaneous MNY starts/retries, stable idempotency key, one durable result, and unambiguous retry status.
- P4-004: cron and manual scheduled posting for the same occurrence; exactly one transaction pair.
- P4-013: duplicate AI generation under reconnect/retry; one charge/result or deterministic idempotent replay.
- P4-015: concurrent budget-alert generation and notification uniqueness.
- P4-017: concurrent attachment uploads at the cap.
- P4-018: concurrent reminder generation/delivery uniqueness.

#### Financial correctness

- P5-001: transfer active-to-VOID and VOID-to-active, both legs, balances, snapshots, and net worth.
- P5-002: server-authoritative transfer currencies, destination amount, rate direction, stale account data, scheduled transfer, and transfer split.
- P5-003: account/transaction currency agreement across create, edit, copy, import, quick-add, and MCP.
- P5-004/P6-011/P6-012: split sign and exact four-decimal equality.
- P5-005/P6-003: investment FX empty, zero, negative, stale, missing, preview, and commit.
- P5-006/P6-013: acquisition commission allocation through partial and full sale.
- P5-007/P6-015: transfer splits in budget actual/remaining plus cache refresh.
- P5-008: final scheduled loan posting below normal installment, zero rate, rate change, fees, and deactivation.
- P5-009/P6-006: missing/stale FX in every aggregate and report consumer.
- P5-010/P6-008: valuation failure versus explicit manual zero.
- P5-011: historical stock-split ratio multiplication; replace the additive test identified above.
- P5-012: bulk delete followed by both accounts, monthly snapshots, net worth, reports, and budgets.
- P5-013/P6-004: foreign-security transfer basis and gain currencies.

### 27.6 CI and required-check questions

Phase 7 must explicitly determine and record:

1. Which workflow/job names are required by branch protection and whether checks run on PR head, merge group, or synthetic merge SHA.
2. Whether the audited SHA ever had a CI run, and if not, why the connector returned no workflow runs or combined statuses.
3. Whether job dependencies allow deploy/package jobs to proceed when integration, E2E, migration, localization, or coverage jobs are skipped/cancelled.
4. Whether path filters can omit relevant backend/frontend/database tests after cross-layer changes.
5. Whether cache keys can reuse stale dependencies, generated clients, browsers, or build outputs.
6. Whether retries hide deterministic race failures; Playwright CI retries are configured at 2.
7. Whether coverage is collected from the code that contains DTO/entity/migration/contract defects despite current exclusions.
8. Whether migration lint, fresh schema build, upgrade-from-supported-version, downgrade/restore, and `database/schema.sql` parity are required checks.
9. Whether Docker Compose and Helm perform real health, migration, backup-volume, attachment-provider, and restore smoke tests.
10. Whether OIDC, email, S3, quote/price, FX, AI, cron, and time providers are represented by realistic fakes rather than mocks that erase failure/race behavior.
11. Whether tests fix timezone, locale, clock, random seed, and network timing sufficiently to detect rather than mask date/precision/concurrency bugs.
12. Which logs/artifacts are retained for failed browser, integration, migration, and provider tests.

### 27.7 Required test helpers and fixture review

- Audit `backend/src/test-helpers/scoped-db-testing.ts` and every RLS/transaction helper for fidelity to `withScopedDb` nesting and rollback.
- Inventory all database reset, seed, user/delegate, account, currency, transfer, split, investment, loan, backup, attachment, and import fixtures.
- Verify fixtures contain multiple users, delegated identities, multiple currencies, missing/stale prices, custom currencies, four-decimal values, zero/null/absent fields, linked transfers, and partial provider failures.
- Ensure browser fixtures can run in at least one comma-decimal locale and non-UTC timezone, in addition to English/UTC-like defaults.
- Use controllable clocks and barriers for cron, refresh rotation, emergency claims, scheduled posting, notifications, and concurrent uploads.
- Avoid mocks that return only successful complete aggregates; include explicit partial and unknown contracts.

### 27.8 Inaccessible evidence to carry forward

- No CI logs, artifacts, workflow run, or combined status was available for the baseline through the connector.
- Required branch-protection checks were not visible.
- Merge-SHA versus PR-head behavior was not observable.
- No runtime provider, Docker, Helm, database, or browser artifact was available.
- Search results were not a reliable proof of test absence; Phase 7 must build an immutable test tree or explicitly preserve the limitation.

### 27.9 Rejected false positives that Phase 7 should not re-promote without new evidence

- Frontend loan projection already caps the final payment.
- Successful restore clears the global API cache.
- Delegation context switch performs a full reload and clears in-memory cache.
- Bulk delete clears account/investment caches and expands linked rows in the backend.
- Main date-only paths use string/local parsing; no confirmed UTC day shift was found.
- MNY write failure is transaction-scoped; partial-commit retry duplication was not confirmed.
- Explicit investment FX zero is blocked by frontend validation; absent-rate divergence is the real Phase 6 path.
- Frontend stock-split preview multiplies by a ratio; the additive bug is in backend historical replay/test.
- GEM/Track B findings are not part of the fixed baseline.

## 28. Phase completion

Phase 6 is complete at `d5cea9bfa995885ba5198f9843359362927c0fd4` subject to the recorded static-analysis, connector, and runtime limitations. The authoritative next artifact is `monize-audit-07-tests-ci.md`, and Phase 7 must remain pinned to the same SHA.
