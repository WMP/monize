# S18 Frontend core: lib, types, hooks, store, cache

## 1. Metadata

| Field | Value |
| --- | --- |
| Session | S18 (parallel wave; orchestrator-assigned, ledger not edited by this session) |
| `AUDIT_BASELINE_SHA` | `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86` |
| `git rev-parse HEAD` at start | `ee429c603fe527658be839fed2a58c93854d41c8` (pin check: `git diff --stat <baseline> HEAD` outside `docs/audits/2026-10` and `docs/audits/2026-08-upstream` is empty) |
| Date | 2026-10-21 |
| Primary path | `frontend/src/lib/` |
| Hint line | `prioritize the backend-to-frontend contract matrix (every nullable or optional field with its absent/undefined/null/zero meaning), completeness flags read === false, cache families and invalidation after every mutation (budget progress, balances, holdings), sumConverted and sumEffectiveOccurrences versus raw fields, number and date localization by preference, failed logout presented as success, persisted-store contents, and a formatter that rounds a rate as money` |
| Toolchain | Node 24.22.1 (`/opt/nvm`), `npm ci` in `frontend/` OK |
| Runtime executed | `npx vitest run src/lib src/hooks src/store src/types` at the baseline: **349 files, 5 825 tests, all passed**. `AppHeader.test.tsx`, `IncompleteLogoutNotice.test.tsx`, `MnyImportProgress.test.tsx`: 65/65 passed. `npm run lint`, `npm run type-check`, `npm run i18n:check`: all exit 0. Probes: 9 scratch-worktree vitest cases (P1-P8, section 7), all reproduce. Mutations: 3 executed (section 6). |
| Backend | Read only, for the DTO side of each contract; no backend suite was run (the backend facts used here were already executed by S03, S09 and S13 or are static reads cited by line). |

## 2. Invariant map

| ID | Statement | Mechanism named | `producer -> transformations -> storage -> consumers -> side effects` |
| --- | --- | --- | --- |
| INV-CACHE-001 (client half) | A money-moving write invalidates every derived cache | `invalidateBalanceCaches()` (`apiCache.ts:105-109`, prefixes `accounts:`, `investments:`, `budgets:`), `clearAllCache()` for "can touch anything" writes, the generation counter in `dedupe` (`apiCache.ts:134-168`), guards `balance-cache.guard.test.ts` (route list) and `cache-prefix-classification.guard.test.ts` (prefix list) | write in `lib/*.ts` -> HTTP 2xx -> `invalidate*` -> in-memory `Map` (`cache`, `inflight`, `keyGeneration`) -> every `getCached`/`dedupe` reader -> rendered figure. Gaps: the route list only names balance routes (A26-S18-01); hand-rolled `getCached`/`setCache` sites bypass the generation counter (A26-S18-02); valuation inputs that are not ledger rows (price, security currency, reporting currency) invalidate nothing derived (A26-S18-03). |
| INV-FX-001 (client half) | An unavailable rate never becomes 1:1, nor a rate older than `FX_MAX_RATE_AGE_DAYS` | `useExchangeRates.convert`/`getRate` return `null` on a missing pair (`hooks/useExchangeRates.ts:83-123`); `sumConverted` (`lib/currency-total.ts`) | `GET /currencies/exchange-rates` (newest row per pair, no age bound, `exchange-rate.service.ts:916-927`) -> `exchange-rates:latest` (1 h TTL) -> `rateMap` -> `convert` -> every client-side aggregate. The 1:1 half holds; the age half has no client mechanism (A26-S18-04). |
| INV-OCCURRENCE-003 (client half) | Every surface reports the effective occurrence | `lib/scheduled-effective-amount.ts` helpers; server `effectiveAmount` on `GET /scheduled-transactions` only | list route -> `scheduled:all` (2 min) -> helpers -> bills, budgets, calendar, forecast. `lib/forecast.ts` re-derives by design and normalises investment schedules onto the settlement account before selecting flows (`forecast.ts:607`, `:805`, `:977`); component bypasses are handed to S19/S20 (section 12). |
| INV-DISPLAY-001 (client half) | A figure addressed to a person is rendered in that person's number locale | `useNumberFormat()`; `ui-conventions.test.ts` | API number -> `useNumberFormat` -> JSX. Lib-level exceptions: `formatRelativeTime` and the PDF timestamp (A26-S18-09). |
| INV-AUTH (client half), MON-M36 | A failed server logout is never presented as success | `AppHeader.handleLogout` (`AppHeader.tsx:233-276`), `markLogoutIncomplete` (`lib/logout-state.ts`), `IncompleteLogoutNotice` | click -> `beginSignOut` -> `holdPushForSignOut` -> `POST /auth/logout` (public route, `auth.controller.ts:1335-1354`) -> on error: flag in `sessionStorage`, error toast, login page warning with retry. Holds. |
| INV-AUTH-001/004 (client half) | A refresh token family is revoked on reuse | 401 interceptor (`lib/api.ts:187-247`), per-tab single-flight `tokenRefreshPromise` | 401 -> `POST /auth/refresh` -> on failure `logout()` + `window.location.replace('/login')`. No cross-tab coordination (A26-S18-06). |
| INV-SHARE-001..005 | The PWA share target (S04 hand-off) | `public/sw.js`, `lib/share-inbox.ts` (claim on list and read, `isVisibleTo`), `authStore.logout` -> `clearShareInbox()` | OS share -> worker stash (Cache API) -> `/share` review -> existing upload/import/assistant doors. Reviewed; holds (section 8). |
| Persisted-store contents | Only listed stores persist to `localStorage`; logout removes per-account data | `store/persisted-storage.guard.test.ts`; `authStore.logout` (`authStore.ts:97-129`) | store -> `localStorage`/`sessionStorage` -> next session on the device. `sessionStorage` is not guarded (A26-S18-08). |
| Contract representation | `null`, absent, `0` keep distinct meanings across the API boundary | optional flags read `=== false`; `null` = unknown | backend DTO -> JSON -> `frontend/src/types/*` -> readers. Matrix in section 7.1. |

## 3. Lens ledger

| Lens | Status |
| --- | --- |
| Pin the revision | ran: baseline pinned, pin diff empty |
| Instructions before implementation | ran: `AGENTS.md`, root and `frontend/CLAUDE.md`, `docs/frontend/api-and-cache.md` in full; `financial-figures.md`, `forms-and-formatting.md` sampled by grep for the helpers named here; `docs/system-invariants.md` INV-FX-001, INV-SHARE-001..005, INV-CACHE-001 index rows |
| Summaries as hypotheses | ran: S02, S03, S04, S09, S13, S07 hand-offs re-verified at the code (section 5, section 12); the three contract-matrix sweeps were spot-checked before use (section 12) |
| Invariant model first | ran (section 2) |
| Change-surface mapping | ran: every mutating function in `lib/**/*.ts` (303) inventoried against its invalidation (script output kept in the scratchpad), every cache key prefix, every `getCached`/`setCache`/`dedupe` site, every logout and 401 path, every `sessionStorage`/`localStorage` writer in `lib/`, `hooks/`, `store/` |
| Calibration Rule 4 (semantic migration) | ran: `rateDate` beside `rate` (age is a new semantic the client never adopted, A26-S18-04); `dataCommitted` beside `status: failed` (A26-S18-05); `effectiveAmount` beside `amount` (forecast and helpers hold) |
| Calibration Rule 5 (dependency mutation matrix) | ran for the cached portfolio valuation and budget progress (section 7.2) |
| Cross-layer verification | ran for logout, refresh, MNY job failure, rate table, budget dashboard summary |
| Representation boundary | ran: contract matrix (section 7.1) |
| Browser/UI round trip | not applicable as a primary lens: S19 owns the form round trips; the cache round trip (write -> invalidate -> remount -> read) was executed instead (P1-P6) |
| Server-authoritative metadata | ran: no client-supplied identity in the lib layer; `userId` never sent; share ownership is client-side by design (INV-SHARE-005) |
| Identity versus value | ran for the share stash (bundle id vs owner) and cache keys (key without user id, A26-S18-08) |
| State machine | ran for the MNY job terminal states as rendered (A26-S18-05) and the logout state (`signingOut`, logout-incomplete flag) |
| Concurrency and idempotency | ran: in-flight read vs invalidation (A26-S18-02, executed), two-tab refresh rotation (A26-S18-06, static against `token.service.ts:164-177`) |
| Partial failure | ran: failed logout (holds), failed MNY job after commit (A26-S18-05), failed rate fetch (`ratesUnavailable` holds) |
| External provider lookup | not applicable: the client calls no provider directly; refresh endpoints gate invalidation on `updated > 0` (`investments.ts:805`), reviewed |
| Database and migration | not applicable: no schema in this slice |
| Backup/restore | ran narrowly: `backupApi.restoreBackup` calls `clearAllCache()` (`backupApi.ts:499`); the rest is S06 |
| Financial lens | ran: numerical examples in A26-S18-03, -04, -10; `roundFxRate` vs `roundMoney` (no rate rounded as money in `lib/`) |
| Authorization/RLS | ran for the client half (logout, refresh, share ownership); RLS is server-side (S04) |
| Tests as evidence | ran: three guard tests read for scope; known-wrong-test check (section 10) |
| Mutation | ran: 3 executed, plus baseline-defect rows (section 6) |
| Counterexamples, interaction | ran (section 7) |
| Rejected hypotheses | ran (section 8) |
| Adversarial approval challenge | ran (section 13) |

## 4. Confirmed findings

### A26-S18-01 - Recategorising writes leave cached budget progress stale (MON-M38 residual)

1. **Severity:** MEDIUM
2. **Confidence:** high (executed, P1 and P2)
3. **Location:** `frontend/src/lib/categories.ts:69-78` (`reassignTransactions`, no invalidation), `frontend/src/lib/payees.ts:187-204` (`applyCategorySuggestions` with `backfillTransactions`, drops only `payees:`); callers `components/categories/CategoryList.tsx:235-258`, `app/categories/[id]/page.tsx:532-549`, `components/payees/CategoryAutoAssignDialog.tsx:122-131`, `app/payees/page.tsx:190-203`; guard `frontend/src/lib/balance-cache.guard.test.ts:29-37` (route list).
4. **Violated invariant:** INV-CACHE-001 ("a money-moving write invalidates every derived cache"); `docs/frontend/api-and-cache.md` "any categorised amount moves the budget it falls in"; MON-M38.
5. **Reproduction:** budget "Groceries 500.00", spent 300.00, `budgets:dashboard` cached (30 s), `budgets:cat-status:*` cached (60 s), `budgets:all` (120 s). Delete category "Supermarket" (120.00 of this month's spending) choosing "Groceries" as the reassignment target, or run "Auto-assign categories" with "also update existing transactions".
6. **Observed (P1, P2):** the reassign `POST /categories/:id/reassign` and the backfill `POST /payees/category-suggestions/apply` return 2xx; the next `budgetsApi.getDashboardSummary()` is served from the pre-write cache (one network call in the probe, the second read equals the first).
7. **Expected:** both writes drop `budgets:` (and the transaction-derived prefixes generally), so the dashboard shows spent 420.00, remaining 80.00.
8. **Impact:** remaining budget overstated by 120.00 (24 % of the budget) for up to two minutes after the write, on the screen a spending decision is made from; navigation does not help (the remount is served from the cache).
9. **Root cause:** the guard's `BALANCE_WRITING_ROUTES` names routes that move balances; recategorising moves no balance but moves budget progress, so neither guard sees the omission, and the two lib methods never call `invalidateBalanceCaches()`.
10. **Recommended correction:** call `invalidateBalanceCaches()` in both methods (the budget family is the one that matters; dropping `accounts:`/`investments:` too is cheap and matches the helper's contract "three views of the same rows"), and widen the guard to "routes that write transaction rows", adding the two routes.
11. **Suggested remediation diff (illustrative, not applied)**

```diff
--- a/frontend/src/lib/categories.ts
+++ b/frontend/src/lib/categories.ts
@@ -69,10 +69,13 @@
   reassignTransactions: async (
     fromCategoryId: string,
     toCategoryId: string | null,
   ): Promise<{ transactionsUpdated: number; splitsUpdated: number }> => {
     const response = await apiClient.post<{ transactionsUpdated: number; splitsUpdated: number }>(
       `/categories/${fromCategoryId}/reassign`,
       { toCategoryId },
     );
+    // Moving rows between categories moves budget progress.
+    invalidateBalanceCaches();
+    invalidateCache('categories:');
     return response.data;
   },
--- a/frontend/src/lib/payees.ts
+++ b/frontend/src/lib/payees.ts
@@ -200,6 +200,9 @@
     invalidateCache('payees:');
+    // A backfill writes category_id onto existing transactions.
+    if (totalBackfilled > 0) invalidateBalanceCaches();
     return { updated: totalUpdated, transactionsBackfilled: totalBackfilled };
--- a/frontend/src/lib/balance-cache.guard.test.ts
+++ b/frontend/src/lib/balance-cache.guard.test.ts
@@ -29,6 +29,10 @@
 const BALANCE_WRITING_ROUTES = [
   /['`]\/transactions/,
+  // Recategorising writes category_id on transaction rows: budget progress moves.
+  /['`]\/categories\/\$\{[^}]+\}\/reassign['`]/,
+  /['`]\/payees\/category-suggestions\/apply['`]/,
```

12. **Recommended regression test:** prime `budgets:dashboard`, run each write, assert the next read goes to the network.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
--- a/frontend/src/lib/categories.test.ts
+++ b/frontend/src/lib/categories.test.ts
+  it('reassigning transactions drops cached budget progress', async () => {
+    setCache('budgets:dashboard', { remaining: 100 });
+    vi.mocked(apiClient.post).mockResolvedValue({ data: { transactionsUpdated: 1, splitsUpdated: 0 } });
+    await categoriesApi.reassignTransactions('from', 'to');
+    expect(getCached('budgets:dashboard')).toBeUndefined();
+  });
```

14. **Verification:** `npm run test -- categories payees balance-cache apiCache`; the probe P1/P2 inverted.
15. **Residual risks:** the guard stays a route list; a future recategorising route (rules run already uses `clearAllCache()`) needs adding. Causality: `PRIOR_REPORTED` (MON-M38), `CONFIRMED_WITH_DIFFERENT_ROOT_CAUSE`: the transaction create/edit/delete/VOID paths named by MON-M38 are fixed; the residual is the recategorising surfaces.

### A26-S18-02 - Hand-rolled cache reads are not generation-aware, so a read in flight across a trade writes the pre-trade valuation back for 60 s

1. **Severity:** MEDIUM
2. **Confidence:** high (executed, P3, with a `dedupe` control that does not reproduce)
3. **Location:** `frontend/src/lib/investments.ts:120-129` (`getPortfolioSummary`), `:132-141`, `:146-155`, `:163-177`, `:182-202`, `:227-234` (`investments:accounts`), `:286-293` (top movers), `:585-592` (favourites), `:912-929` (prices), `:935-942` (market indexes), `:1180-1222` (three weightings); `frontend/src/lib/budgets.ts:264-278` (`budgets:cat-status:*`); `lib/custom-reports.ts:30-36`, `lib/investment-reports.ts:64-70`.
4. **Violated invariant:** INV-CACHE-001; the `apiCache.ts:10-17` contract ("a read that began before a mutation could be re-served after it ... issue #1167 close-out").
5. **Reproduction:** Investments page mounts; `GET /portfolio/summary` (seconds of server work) is in flight and reads the ledger before the trade commits. The user saves a BUY of 20 000.00 from the trade form. `invalidateBalanceCaches()` runs; the page's refetch goes out and returns first; the original read lands afterwards.
6. **Observed (P3):** the late response executes `setCache('investments:summary:all', <pre-trade>, 60_000)`; the next `getPortfolioSummary()` (any remount, the dashboard widget) returns the pre-trade summary. The same race through `dedupe` (`budgets:dashboard`, control case) keeps the fresh payload.
7. **Expected:** a response whose key was invalidated after its request started is returned to its own caller but never written to the cache.
8. **Impact:** the portfolio total, cash and holdings show the pre-trade state (here 20 000.00 of cash still present, the new position absent) for up to 60 s on every surface that reads the key, including after navigation; the per-category budget status behind the transaction form for 60 s.
9. **Root cause:** the #1167 fix moved only `dedupe` onto the generation counter; sixteen read sites (13 in `investments.ts`, one each in `budgets.ts`, `custom-reports.ts`, `investment-reports.ts`) still call `getCached`/`setCache` directly, which knows nothing about `invalidateCache`'s generation bump.
10. **Recommended correction:** route every cached read through `dedupe` (it already handles TTL, in-flight sharing and the generation); keep `getCached`/`setCache` for the two optimistic list rewrites (`custom-reports.ts:75-80`, `investment-reports.ts:110-116`) only.
11. **Suggested remediation diff (illustrative, not applied)**

```diff
--- a/frontend/src/lib/investments.ts
+++ b/frontend/src/lib/investments.ts
@@ -120,10 +120,12 @@
   getPortfolioSummary: async (accountIds?: string[]): Promise<PortfolioSummary> => {
     const cacheKey = `investments:summary:${accountIds?.join(',') || 'all'}`;
-    const cached = getCached<PortfolioSummary>(cacheKey);
-    if (cached) return cached;
-    const response = await apiClient.get<PortfolioSummary>('/portfolio/summary', {
-      params: accountIds && accountIds.length > 0 ? { accountIds: accountIds.join(',') } : undefined,
-    });
-    setCache(cacheKey, response.data, 60_000);
-    return response.data;
+    return dedupe(cacheKey, async () => {
+      const response = await apiClient.get<PortfolioSummary>('/portfolio/summary', {
+        params: accountIds && accountIds.length > 0 ? { accountIds: accountIds.join(',') } : undefined,
+      });
+      return response.data;
+    }, 60_000);
   },
```

   (the same shape for each listed site; `budgets.ts:264` becomes `dedupe(cacheKey, () => apiClient.post(...).then(r => r.data), 60_000)`).
12. **Recommended regression test:** a source scan in `cache-prefix-classification.guard.test.ts` that fails a `setCache(` outside `apiCache.ts` and the two list-rewrite sites, plus one behavioural case per family.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
--- a/frontend/src/lib/investments.test.ts
+++ b/frontend/src/lib/investments.test.ts
+  it('a summary read in flight across a trade does not resurrect the pre-trade payload', async () => {
+    let resolveOld!: (v: unknown) => void;
+    vi.mocked(apiClient.get).mockImplementationOnce(() => new Promise((r) => { resolveOld = r; }));
+    const old = investmentsApi.getPortfolioSummary();
+    vi.mocked(apiClient.post).mockResolvedValueOnce({ data: {} });
+    await investmentsApi.createTransaction({} as never);
+    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: { totalPortfolioValue: 120 } });
+    await investmentsApi.getPortfolioSummary();
+    resolveOld({ data: { totalPortfolioValue: 100 } });
+    await old;
+    expect(getCached('investments:summary:all')).toEqual({ totalPortfolioValue: 120 });
+  });
```

14. **Verification:** `npm run test -- investments budgets apiCache cache-prefix`.
15. **Residual risks:** `dedupe` shares one promise between callers, so a caller that mutates the returned object would now mutate a shared one (none found in the readers sampled). Causality: `PRE_EXISTING_UNREPORTED` (the hand-rolled sites predate the #1167 generation fix, which covered `dedupe` only).

### A26-S18-03 - Valuation inputs that are not ledger rows invalidate nothing derived: a manual price, a security's currency, the reporting currency

1. **Severity:** MEDIUM
2. **Confidence:** high (executed, P4 and P5)
3. **Location:** `frontend/src/lib/investments.ts:1160-1177` (manual price create/update/delete drop only `investments:prices:`); `:652-670` (`updateSecurity` drops only `scheduled:` unless a bond program changes); `frontend/src/lib/user-settings.ts:40-43` and `components/settings/PreferencesSection.tsx:135-150` (`defaultCurrency` change, no cache drop); renderer `components/investments/PortfolioSummaryCard.tsx:43-80` (formats backend totals with the preference `defaultCurrency`; `PortfolioSummary` carries no currency code, `types/investment.ts:304-382`).
4. **Violated invariant:** INV-CACHE-001; `AGENTS.md` "a total names its currency"; Calibration Rule 5 (every channel that changes an upstream dependency of a cached derived value invalidates it).
5. **Reproduction:** (a) on a security page, enter a manual close of 200.00 for a holding of 500 shares last priced 100.00, then open Investments within 60 s; (b) change a security's currency from USD to EUR; (c) in Settings change the default currency USD -> CAD (USD->CAD 1.37), then open Investments within 60 s.
6. **Observed:** (a, P4) `investments:summary:all` survives the price write; the portfolio shows 50 000.00 for the holding instead of 100 000.00. (c, P5) the summary cached in USD survives the preference change and `PortfolioSummaryCard` renders `totalPortfolioValue` 100 000 as "CA$100,000.00".
7. **Expected:** (a) 100 000.00 after the write; (c) CA$137 000.00, or the figure withheld until the CAD payload arrives.
8. **Impact:** (a) 50 000.00 understated (50 %) for up to 60 s; (c) 37 000.00 understated (27 %) under the wrong currency label for up to 60 s on the summary, allocation, weightings, top movers and favourites, 30 s on the budget dashboard; `accounts:daily-balance-totals` keys `displayCurrency ?? ''`, so a caller that omits it is also served the old currency.
9. **Root cause:** the invalidation rule was written as "a write that moves money"; valuation also depends on prices, the security's currency and the reporting currency, and none of those writes is classified.
10. **Recommended correction:** a price write and a security currency edit drop `investments:` and `accounts:`; a preference write that changes `defaultCurrency` (or `timezone`, which moves "today") calls `clearAllCache()`.
11. **Suggested remediation diff (illustrative, not applied)**

```diff
--- a/frontend/src/lib/investments.ts
+++ b/frontend/src/lib/investments.ts
@@ -1160,19 +1160,22 @@
   createSecurityPrice: async (securityId: string, data: CreateSecurityPriceData): Promise<SecurityPrice> => {
     const response = await apiClient.post<SecurityPrice>(`/securities/${securityId}/prices`, data);
-    invalidateCache('investments:prices:');
+    // A stored close values every holding of the security.
+    invalidateBalanceCaches();
     return response.data;
   },
@@ (same for updateSecurityPrice and deleteSecurityPrice)
@@ -665,6 +668,8 @@
     invalidateScheduledFxReadModel();
+    // The security's currency decides how its holdings convert.
+    if (data.currencyCode !== undefined) invalidateBalanceCaches();
     if (data.bondProgramId !== undefined) invalidateCache('investments:');
--- a/frontend/src/lib/user-settings.ts
+++ b/frontend/src/lib/user-settings.ts
@@ -40,4 +40,8 @@
   updatePreferences: async (data: UpdatePreferencesData): Promise<UserPreferences> => {
     const response = await apiClient.patch<UserPreferences>('/users/preferences', data);
+    // Every cached figure is denominated in the reporting currency and dated by
+    // the reader's today; neither payload names which one it was computed for.
+    if (data.defaultCurrency !== undefined || data.timezone !== undefined) clearAllCache();
     return response.data;
   },
```

12. **Recommended regression test:** one lib case per channel asserting the summary key is dropped; a guard row classifying `/securities/:id/prices` as transaction-derived.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
--- a/frontend/src/lib/user-settings.test.ts
+++ b/frontend/src/lib/user-settings.test.ts
+  it('a reporting-currency change drops currency-denominated caches', async () => {
+    setCache('investments:summary:all', { totalPortfolioValue: 100000 });
+    vi.mocked(apiClient.patch).mockResolvedValue({ data: { defaultCurrency: 'CAD' } });
+    await userSettingsApi.updatePreferences({ defaultCurrency: 'CAD' });
+    expect(getCached('investments:summary:all')).toBeUndefined();
+  });
```

14. **Verification:** `npm run test -- investments user-settings PortfolioSummaryCard`.
15. **Residual risks:** the payloads still carry no currency code, so any other path that keeps one across a currency change repeats (c); the durable fix is a `currency` field on `PortfolioSummary` and an assertion in the card that it equals the rendered currency (maintainer decision). Causality: `PRE_EXISTING_UNREPORTED`.

### A26-S18-04 - The client converts at a rate of any age (INV-FX-001 client half)

1. **Severity:** MEDIUM
2. **Confidence:** high (executed, P7)
3. **Location:** `frontend/src/hooks/useExchangeRates.ts:66-123` (`rateMap` from `r.rate` only; `convert`/`getRate` never read `rateDate`); producer `backend/src/currencies/exchange-rate.service.ts:916-927` (`getLatestRates`, newest row per pair, no bound); `FX_MAX_RATE_AGE_DAYS = 45` (`backend/src/common/time-series/fx-rate-resolver.ts:102`); `convertWithRateMap` (`useExchangeRates.ts:162-178`) the same for the historical map.
4. **Violated invariant:** INV-FX-001 "nor by one older than FX_MAX_RATE_AGE_DAYS".
5. **Reproduction:** a CHF account of 100 000.00 CHF; the CHF->USD pair was last stored 2020-03-01 at 1.13 (provider stopped quoting it, or a manual rate); today's rate 1.25.
6. **Observed (P7):** `convert(100000, 'CHF', 'USD')` returns 113 000; `getRate` returns 1.13. Every client-side aggregate built on it (`sumConverted` on the accounts page, the foreign-account view of `PortfolioSummaryCard`, the calendar and budget conversions) reports a complete figure; the server's resolver for the same pair answers unknown.
7. **Expected:** `null` for an observation older than 45 days, so `sumConverted` reports the total partial and names the pair, as the server does.
8. **Impact:** 12 000.00 USD understated here (9.6 %), silently, and the client and server disagree on the same account's converted balance.
9. **Root cause:** the age half of INV-FX-001 was added to the server's one door (`resolveFxRate`) and to the `fx-rate.one-door.spec.ts` guard, whose scope is `backend/src`; the client is a second "newest rate" reader outside the door and was not migrated (Calibration Rule 4).
10. **Recommended correction:** the client applies the same bound: drop from `rateMap` any row whose `rateDate` is older than the bound (a shared constant mirrored from the backend and held by a contract test), and report the pair missing.
11. **Suggested remediation diff (illustrative, not applied)**

```diff
--- a/frontend/src/hooks/useExchangeRates.ts
+++ b/frontend/src/hooks/useExchangeRates.ts
@@ -64,9 +64,14 @@
   // Build a lookup map: "USD->CAD" => 1.365
+  // A rate older than the server's bound is not a rate for today
+  // (INV-FX-001, FX_MAX_RATE_AGE_DAYS); leaving it out makes convert() null.
+  const today = financialTodayYmd();
   const rateMap = useMemo(() => {
     const map = new Map<string, number>();
     rates.forEach((r) => {
+      if (daysBetweenYmd(r.rateDate, today) > FX_MAX_RATE_AGE_DAYS) return;
       map.set(`${r.fromCurrency}->${r.toCurrency}`, Number(r.rate));
     });
     return map;
-  }, [rates]);
+  }, [rates, today]);
```

   `FX_MAX_RATE_AGE_DAYS` and `daysBetweenYmd` would be new client exports; the constant needs a contract test against `fx-rate-resolver.ts`.
12. **Recommended regression test:** `useExchangeRates` fed a 2020 row returns `null`; a 10-day-old row converts.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
--- a/frontend/src/hooks/useExchangeRates.test.ts
+++ b/frontend/src/hooks/useExchangeRates.test.ts
+  it('refuses a rate older than FX_MAX_RATE_AGE_DAYS', async () => {
+    vi.mocked(exchangeRatesApi.getLatestRates).mockResolvedValue([
+      { id: 1, fromCurrency: 'CHF', toCurrency: 'USD', rate: 1.13, rateDate: '2020-03-01', source: 'manual' },
+    ]);
+    const { result } = renderHook(() => useExchangeRates());
+    await act(async () => {});
+    expect(result.current.convert(100000, 'CHF', 'USD')).toBeNull();
+  });
```

14. **Verification:** `npm run test -- useExchangeRates currency-total accounts/page`.
15. **Residual risks:** the "Currencies" screen must still show the old rate (it is a stored fact) while conversions refuse it; a missing-pair message must say "stale since 2020-03-01", not "missing" (`docs/financial-calculation-contract.md` 1.3). `docs/system-invariants.md` INV-FX-001 lists only the built-in reports as a known gap (section 11). Causality: `PRE_EXISTING_UNREPORTED` (the bound postdates the client path; the client was never migrated).

### A26-S18-05 - A failed MNY job whose rows committed tells the user "Nothing was saved -- you can try again"

1. **Severity:** MEDIUM
2. **Confidence:** high (static, every link cited; the copy is asserted by the existing test `MnyImportProgress.test.tsx:160-167`)
3. **Location:** `frontend/src/components/import/MnyImportProgress.tsx:43-55` (renders `mnyErrors.mnyImportFailed` when `errorKey` is the generic key or empty); copy `frontend/src/i18n/messages/en/import.json:548`; type `frontend/src/lib/import-mny.ts:254-265` (`MnyImportJob` has no committed flag); backend `backend/src/import/mny/mny-import.service.ts:296-324` (finalizing, verify, verifyHoldings and `staging.remove` run after the commit at `:680`), `mny-import-job.service.ts:678-692` (any throw -> `fail(..., 'mnyImportFailed', ...)`), `:611-625` (`retryable = ($4 AND data_committed = false)`, `error_key` left generic), `dto/mny-import.dto.ts:145-175` and `mny-import.controller.ts:68-78` (`dataCommitted` not in the DTO).
4. **Violated invariant:** "a request that failed is said to be one" and the state-machine rule that a terminal state's copy describes what was written (`docs/financial-calculation-contract.md` 1.3; S09 hand-off "the wizard has no committed-failure state").
5. **Reproduction:** import a `.mny`; the write transaction commits (accounts, 37 000 transactions); `verifyHoldings` or `staging.remove` then throws (a filesystem error on the staged file, a database error during verification).
6. **Observed:** the job is `failed`, `errorKey: 'mnyImportFailed'`, `retryable: false`; the wizard shows "Something went wrong while importing. Nothing was saved -- you can try again." with only "Start over".
7. **Expected:** a committed-failure copy ("Your data was imported, but a final check failed; do not import this file again") driven by a `dataCommitted` field on the job DTO.
8. **Impact:** the user believes the ledger is unchanged and re-imports; a second import of the same file duplicates every row (the entity says so, `import-job.entity.ts:105-112`). After a wipe-and-import the same copy hides that the wipe already ran.
9. **Root cause:** the job DTO omits `data_committed`, and `fail()` keeps the generic error key after commit, so the client has no signal to choose a different message.
10. **Recommended correction:** expose `dataCommitted` on the DTO and the client type; render a distinct message when `status === 'failed' && dataCommitted === true`; on the server, switch the error key to `mnyJobFailedAfterCommit` when `data_committed` is true.
11. **Suggested remediation diff (illustrative, not applied)**

```diff
--- a/backend/src/import/mny/dto/mny-import.dto.ts
+++ b/backend/src/import/mny/dto/mny-import.dto.ts
@@ class MnyImportJobDto
+  /** True once the import's write transaction committed; a failure after it is not "nothing saved". */
+  dataCommitted: boolean;
--- a/backend/src/import/mny/mny-import.controller.ts
+++ b/backend/src/import/mny/mny-import.controller.ts
@@ toJobDto
+    dataCommitted: job.dataCommitted,
--- a/frontend/src/lib/import-mny.ts
+++ b/frontend/src/lib/import-mny.ts
@@ export interface MnyImportJob {
+  /** Absent on an older backend: no information, so read `=== true`. */
+  dataCommitted?: boolean;
--- a/frontend/src/components/import/MnyImportProgress.tsx
+++ b/frontend/src/components/import/MnyImportProgress.tsx
@@ -50,5 +50,7 @@
           <p className="mt-1 text-sm text-red-700 dark:text-red-300">
-            {job.errorKey
+            {job.dataCommitted === true
+              ? t('mnyErrors.mnyImportFailedAfterCommit')
+              : job.errorKey
               ? t(`mnyErrors.${job.errorKey}`)
               : t('mnyErrors.mnyImportFailed')}
```

   (plus the new catalog key in every locale and the pseudo-locale regenerated).
12. **Recommended regression test:** `MnyImportProgress` with `{status: 'failed', errorKey: 'mnyImportFailed', dataCommitted: true}` must not contain "Nothing was saved"; a backend job test that throws in `verifyHoldings` and asserts `dataCommitted: true` on `GET /import/mny/jobs/:id`.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
--- a/frontend/src/components/import/MnyImportProgress.test.tsx
+++ b/frontend/src/components/import/MnyImportProgress.test.tsx
+    it('does not say nothing was saved once the rows committed', () => {
+      render(<MnyImportProgress {...defaultProps}
+        job={job({ status: 'failed', errorKey: 'mnyImportFailed', dataCommitted: true })} />);
+      expect(screen.queryByText(/Nothing was saved/)).not.toBeInTheDocument();
+    });
```

14. **Verification:** frontend `npm run test -- MnyImportProgress useMnyImport`; backend `npm run test:integration -- mny-import-job`.
15. **Residual risks:** the existing test at `:160-167` asserts the copy for `errorKey: null`, a state the backend cannot produce for a failed job; it is weak rather than wrong. Causality: `PRE_EXISTING_UNREPORTED`; client surface of the S09 hypothesis, distinct from A26-S09-01 (the replay), consolidate in S23 if the remediation lands in one PR.

### A26-S18-06 - Two tabs refreshing at once read as token theft: the family is revoked and every session ends with no explanation

1. **Severity:** MEDIUM
2. **Confidence:** medium-high (static and deterministic once both requests carry the same cookie; not executed in a browser)
3. **Location:** `frontend/src/lib/api.ts:187-247` (per-tab single flight `isRefreshingToken`, no cross-tab coordination: no `BroadcastChannel`, `navigator.locks` or storage event in `lib/` or `store/`), `:109-119` (`attemptTokenRefresh` discards the response, so the 401 reason is lost); backend `backend/src/auth/token.service.ts:149-177` (rotation under `lockTokenFamily`; a revoked token is "reuse" and revokes the family, no grace for the immediately rotated token).
4. **Violated invariant:** INV-AUTH-001/004 are about theft; a legitimate concurrent refresh must not be indistinguishable from it, and a forced sign-out must say why (S03 hand-off).
5. **Reproduction:** two tabs (or the installed PWA and a tab) are open; the access token expires (laptop wakes, both tabs poll). Both tabs get 401 and each sends `POST /auth/refresh` with the same `refresh_token` cookie T1 before either response sets T2.
6. **Observed:** the first request rotates T1 -> T2 and revokes T1; the second, serialized behind the family lock, finds T1 revoked, revokes the whole family and answers 401 "Refresh token reuse detected". That tab logs out and `replace('/login')`s; the first tab's next refresh with T2 now fails too (family revoked). The login page shows the ordinary signed-out state.
7. **Expected:** one refresh per browser (a cross-tab lock, or a short server grace that answers the just-rotated token with the current one), and a distinct login-page message when the server reports reuse.
8. **Impact:** availability (every device session of the user ends, including the PWA), and the one real security signal the server has is shown to the user as a routine expiry, so an actual theft is never reported.
9. **Root cause:** refresh rotation is single-flight per tab only, and the client throws away the 401 body.
10. **Recommended correction:** serialize refresh across tabs with `navigator.locks.request('monize-refresh', ...)` (fallback: the current per-tab flight), retry the original request after another tab's refresh, and on a reuse 401 set a `sessionStorage` reason the login page renders.
11. **Suggested remediation diff (illustrative, not applied)**

```diff
--- a/frontend/src/lib/api.ts
+++ b/frontend/src/lib/api.ts
@@ -109,12 +109,26 @@
-async function attemptTokenRefresh(): Promise<boolean> {
+type RefreshOutcome = 'ok' | 'reuse' | 'failed';
+
+async function refreshOnce(): Promise<RefreshOutcome> {
   try {
     // Use raw axios to avoid interceptor recursion; refresh_token cookie sent automatically
     await axios.post('/api/v1/auth/refresh', {}, { withCredentials: true });
-    logger.info('Access token refreshed');
-    return true;
-  } catch (_) {
-    logger.warn('Token refresh failed');
-    return false;
+    return 'ok';
+  } catch (error) {
+    const message = (error as AxiosError<{ code?: string }>).response?.data?.code;
+    return message === 'REFRESH_TOKEN_REUSE' ? 'reuse' : 'failed';
   }
 }
+
+// One refresh per browser: a second tab waiting on the lock finds the cookie
+// already rotated and its own request then succeeds with it.
+async function attemptTokenRefresh(): Promise<boolean> {
+  const run = () => refreshOnce();
+  const outcome = typeof navigator !== 'undefined' && navigator.locks
+    ? await navigator.locks.request('monize-token-refresh', run)
+    : await run();
+  if (outcome === 'reuse') markSessionRevokedForReuse();
+  return outcome === 'ok';
+}
```

   A waiting tab still sends T1 after the lock is released unless it first re-tries the original request (which now carries the rotated access cookie); the diff needs that "retry before refresh" step, and the backend needs a stable error code (the message is translated). Maintainer decision: client lock, server grace window, or both.
12. **Recommended regression test:** a Playwright two-page test in one context that expires the access cookie and fires a request from both pages; both pages must stay signed in.
13. **Suggested regression-test diff:** incomplete (needs an E2E fixture that can expire the access cookie; `e2e/` has none today).
14. **Verification:** the E2E case above; a backend integration case with two concurrent refreshes of one token under a grace rule, if chosen.
15. **Residual risks:** a grace window weakens reuse detection by its width; the lock alone does not cover two browsers on one account (no shared cookie, so no collision). Causality: `PRE_EXISTING_UNREPORTED`.

### A26-S18-07 - A finished MNY import drops only the balance caches; categories, payees, tags and schedules it created (or wiped) stay cached

1. **Severity:** LOW
2. **Confidence:** high (executed, P6)
3. **Location:** `frontend/src/lib/import-mny.ts:320-332` (`getJob` terminal state -> `invalidateBalanceCaches()` only); TTLs `categories.ts:26-34` and `payees.ts:88-95`, `tags.ts:13-20` (5 min), `scheduled-transactions.ts:30-37` (2 min). Compare `email-import/run-import.ts:308`, `transaction-rules-api.ts:144`, `backupApi.ts:499` (`clearAllCache()` for writes that touch anything).
4. **Violated invariant:** `docs/frontend/api-and-cache.md` "Where the write can touch anything ... use `clearAllCache()`".
5. **Reproduction:** with "wipe existing data", import a `.mny`; open a transaction form within five minutes.
6. **Observed (P6):** `categories:all` still holds the pre-import list; the pickers offer deleted category and payee ids and miss the imported ones; a save with a stale id is refused by the server.
7. **Expected:** the import's terminal state calls `clearAllCache()`.
8. **Impact:** confusing failures and missing choices for up to five minutes; no ledger corruption (the server refuses the stale ids).
9. **Root cause:** the MNY import writes every table, but its invalidation was modelled on the transaction-only importers.
10. **Recommended correction / 11. diff (illustrative, not applied):**

```diff
--- a/frontend/src/lib/import-mny.ts
+++ b/frontend/src/lib/import-mny.ts
@@ -328,5 +328,6 @@
     if (response.data.status === 'completed' || response.data.status === 'failed') {
-      invalidateBalanceCaches();
+      // Accounts, categories, payees, tags, securities and schedules are all written.
+      clearAllCache();
     }
```

12. **Regression test / 13. diff:** extend `import-mny.test.ts` with `setCache('categories:all', [...])` then a completed `getJob`, asserting the key is gone.
14. **Verification:** `npm run test -- import-mny useMnyImport`.
15. **Residual risks:** `clearAllCache()` on each poll of a terminal job repeats harmlessly. Causality: `PRE_EXISTING_UNREPORTED`.

### A26-S18-08 - Logout leaves the intraday portfolio series in `sessionStorage`, keyed without a user, and the next account on the tab is shown it

1. **Severity:** LOW
2. **Confidence:** high (executed, P8)
3. **Location:** `frontend/src/components/investments/portfolio-chart-utils.tsx:97-160` (`monize-intraday|<range>|<accounts>|<currency>`, no user id); `InvestmentValueChart.tsx:262-280` (hydrates from the entry before the network answers); `frontend/src/store/authStore.ts:97-129` (`logout` clears the API cache, the share inbox, preferences, the AI chat and Monte Carlo keys, but not these); `store/persisted-storage.guard.test.ts` covers `localStorage` only.
4. **Violated invariant:** the logout sweep the store documents ("so conversations don't leak across accounts"); INV-SHARE-003's reasoning applied to the same device-sharing threat.
5. **Reproduction:** user A views Investments on 1D (all accounts, USD), signs out; user B signs in on the same tab and opens Investments on 1D.
6. **Observed (P8):** the entry survives `logout()`; B's chart is drawn from A's points (value 250 000 in the probe) until B's request answers, and stays if B's intraday request fails (the fallback loads B's daily series, which replaces it).
7. **Expected:** `logout` calls `clearAllIntradayCache()`; the key carries the user id.
8. **Impact:** another account's portfolio value series is displayed briefly on a shared device.
9. **Root cause:** the sweep in `logout` was written for `localStorage` keys; the `sessionStorage` cache was added later without a guard.
10. **Correction / 11. diff (illustrative, not applied):**

```diff
--- a/frontend/src/store/authStore.ts
+++ b/frontend/src/store/authStore.ts
@@ -108,6 +108,10 @@
         import('@/store/preferencesStore').then(({ usePreferencesStore }) => {
           usePreferencesStore.getState().clearPreferences();
         });
+        // SECURITY: the intraday chart cache is one account's portfolio series.
+        import('@/components/investments/portfolio-chart-utils').then(
+          ({ clearAllIntradayCache }) => clearAllIntradayCache(),
+        );
```

12. **Regression test / 13. diff:** in `authStore.test.ts`, write an `INTRADAY_CACHE_PREFIX` key, call `logout()`, await the dynamic import, assert it is gone; extend the persisted-storage guard to scan `sessionStorage.setItem` writers.
14. **Verification:** `npm run test -- authStore persisted-storage portfolio-chart-utils`.
15. **Residual risks:** `localStorage` filter state (account-id lists and the free-text search in `AccountList.tsx:282-316`, `useTransactionFilters.ts:631-636`) also survives logout; it holds ids and the user's own typed text, recorded as a design risk (section 9). Causality: `PRE_EXISTING_UNREPORTED`.

### A26-S18-09 - Two lib formatters render user-facing text outside the reader's locale and language

1. **Severity:** LOW
2. **Confidence:** high (static)
3. **Location:** `frontend/src/lib/format.ts:476-491` (`formatRelativeTime`: hard-coded English "Never", "Just now", "5m ago", "Yesterday", then the browser's `toLocaleDateString()`), rendered by `components/investments/RefreshPricesButton.tsx:52, 79`; `frontend/src/lib/pdf-export.ts:253-259` (PDF header timestamp in `en-US`).
4. **Violated invariant:** INV-DISPLAY-001 (the date and number locale by preference) and the translation rule in `AGENTS.md`.
5. **Reproduction:** a Polish-language user with the `DD.MM.YYYY` date preference opens Investments; the button reads "(5m ago)" and, after a week, a browser-locale date; every exported PDF header says "Oct 21, 2026, 11:45 PM".
6. **Observed / 7. Expected:** English and browser-locale strings / the catalog strings and `useDateFormat`.
8. **Impact:** cosmetic but on every Investments visit and every PDF.
9. **Root cause:** pure helpers predating the locale hooks, outside the guard's patterns.
10. **Correction / 11. diff (illustrative, not applied):**

```diff
--- a/frontend/src/components/investments/RefreshPricesButton.tsx
+++ b/frontend/src/components/investments/RefreshPricesButton.tsx
-import { formatRelativeTime } from '@/lib/format';
+import { useRelativeTime } from '@/hooks/useRelativeTime';
@@
-          ? t('page.lastUpdated', { time: formatRelativeTime(lastPriceUpdate) })
+          ? t('page.lastUpdated', { time: relativeTime(lastPriceUpdate) })
```

   (`hooks/useRelativeTime.ts` exists; whether its output matches is to be checked), and `pdf-export.ts` takes the formatted timestamp from its React caller.
12. **Regression test / 13. diff:** a `ui-conventions.test.ts` rule banning imports of `formatRelativeTime` from components, and a `pdf-export` case that passes a locale.
14. **Verification:** `npm run test -- RefreshPricesButton pdf-export ui-conventions`.
15. **Residual risks:** none material. Causality: `PRE_EXISTING_UNREPORTED`.

### A26-S18-10 - The client forecast accumulates floats and rounds the projected balance with `Math.round(x * 100) / 100`

1. **Severity:** LOW
2. **Confidence:** high (computed)
3. **Location:** `frontend/src/lib/forecast.ts:745` (`currentBalance += tx.amount`), `:760` (`Math.round(currentBalance * 100) / 100`), `:992`, `:1020-1027` (the projected balance returned to the posting dialog); `:503-510` (`Number(amount) * rate` unrounded).
4. **Violated invariant:** `AGENTS.md` financial math ("never accumulate floats ... `roundMoney` every result"); `lib/format.ts` `roundToCents` is round-half-away-from-zero, `Math.round` is round-half-up and loses the IEEE midpoint.
5. **Reproduction / numbers (node):** a projected balance of 1.0050 renders 1.00 (`roundToCents` 1.01); -2 500.0050 renders -2 500.00 (expected -2 500.01).
6. **Impact:** a one-cent difference between the forecast's projected balance and the server's balance forecast for 4-decimal (FX-converted) balances; no write depends on it.
7. **Correction / 11. diff (illustrative, not applied):**

```diff
--- a/frontend/src/lib/forecast.ts
+++ b/frontend/src/lib/forecast.ts
@@ -744,3 +744,3 @@
     for (const tx of dayTransactions) {
-      currentBalance += tx.amount;
+      currentBalance = roundMoney(currentBalance + tx.amount);
     }
@@ -760 +760 @@
-        balance: Math.round(currentBalance * 100) / 100,
+        balance: roundToCents(currentBalance),
@@ -1027 +1027 @@
-  return Math.round(balance * 100) / 100;
+  return roundToCents(balance);
```

12. **Regression test:** `forecast.test.ts` with a 1.0050 starting balance asserting 1.01. 14. **Verification:** `npm run test -- forecast`. 15. **Residual risks:** none. Causality: `PRE_EXISTING_UNREPORTED`.

### A26-S18-11 - Response types drop signals the backend sends (contract drift)

1. **Severity:** LOW
2. **Confidence:** high for (a) and (b), verified at both ends; (c) as stated
3. **Location and surfaces (Rule 7, one finding):**
   - (a) `ExplainedRuleSkip` (`frontend/src/types/transaction-rule-explain.ts:66, 74`) is `'disabled' | 'invalid'`; the backend `RuleSkipReason` adds `'outside_active_window'` (`backend/src/transaction-rules/rule-effects.ts:91-95`, asserted by `rule-effects.active-window.spec.ts:52-88`); the renderer `ImportPreviewRuleTest.tsx:67` looks up `notEvaluated.${skippedRule}` and the catalog (`en/import.json:598-602`) has no `outside_active_window`, so the rule-test panel shows a missing-message key for a rule outside its active window (INV-RULE-004).
   - (b) `bondRowsWithoutSeries` (`backend/src/import/dto/import.dto.ts:413`, MNY `mny-import-job.ts:106`) is in no frontend type and rendered nowhere: bond lots imported without a series are never reported.
   - (c) `PortfolioPeriodResult.incompleteRanges` (`net-worth/portfolio-period-result.service.ts:150`) is absent from `types/net-worth.ts:175-245`: the dated gap ranges the server computes never reach the reader (the figures themselves are nullable, so no false total).
4. **Violated invariant:** `docs/financial-calculation-contract.md` 1.3 (a withheld figure names what is missing); representation contract.
5. **Correction / 11. diff (illustrative, not applied):**

```diff
--- a/frontend/src/types/transaction-rule-explain.ts
+++ b/frontend/src/types/transaction-rule-explain.ts
-export type ExplainedRuleSkip = 'disabled' | 'invalid';
+export type ExplainedRuleSkip = 'disabled' | 'invalid' | 'outside_active_window';
--- a/frontend/src/i18n/messages/en/import.json
+++ b/frontend/src/i18n/messages/en/import.json
       "notEvaluated": {
         "afterStop": "Not evaluated: a previous rule stopped the rules.",
         "disabled": "Not evaluated: the rule is switched off.",
-        "invalid": "Not evaluated: the rule is not valid. Open it to repair it."
+        "invalid": "Not evaluated: the rule is not valid. Open it to repair it.",
+        "outside_active_window": "Not evaluated: the row's date is outside the rule's active dates."
       },
```

   plus `bondRowsWithoutSeries?: number` on the import result types with a line in the completion step.
12. **Regression test:** a contract test (the `budget-trend.contract.test.ts` pattern) holding `ExplainedRuleSkip` equal to the backend union.
14. **Verification:** `npm run test -- ImportPreviewRuleTest transaction-rule-explain`; `npm run i18n:check`.
15. Causality: `NEW_SINCE_UPSTREAM_AUDIT` for (a) (`transaction-rules/` is new) and (b) (bonds are new); (c) `NEW_SINCE_UPSTREAM_AUDIT`.

## 5. Prior-finding dispositions

| ID | Disposition | Evidence |
| --- | --- | --- |
| MON-M36 | `FIXED_VERIFIED` | `AppHeader.tsx:255-275`: a rejected `authApi.logout()` sets `monize:logout-incomplete` in `sessionStorage`, clears local state, shows `toast.error(t('logoutNotConfirmed'))` and never `toast.success`; the login page renders `IncompleteLogoutNotice` with a retry that calls the public `POST /auth/logout` (`auth.controller.ts:1335-1354`, no JWT needed, so the retry works after access-token expiry). Tests: `AppHeader.test.tsx:204-218` "does not claim success when authApi.logout fails", `IncompleteLogoutNotice.test.tsx`; 65/65 passed. S02's mutation M8 (`toast.error` -> `toast.success`) was killed by that test. The 401-interceptor path (`api.ts:222-246`) is a forced logout, not a user's claim of logout, and ignores a failed `/auth/logout` by design. |
| MON-M38 | `STILL_OPEN` (narrowed) -> A26-S18-01 | The transaction create/edit/delete/VOID, split, transfer, bulk, scheduled-post, investment and import paths now call `invalidateBalanceCaches()`, which includes `budgets:` (`apiCache.ts:105-109`), pinned by `apiCache.test.ts` and `cache-prefix-classification.guard.test.ts` (mutation M1 killed by 4 tests). Residual: category reassignment and payee category backfill, which write `category_id` on transactions, invalidate no budget cache (executed P1/P2). |
| MON-M42 | `FIXED_VERIFIED` | `AppHeader.test.tsx:204-218` now asserts no success toast, an error toast and the incomplete-logout flag; the old expectation is gone. |

## 6. Mutation table

| Invariant | Mutation (file:line, what) | Test that fails | Verdict |
| --- | --- | --- | --- |
| INV-CACHE-001 (budget family) | `apiCache.ts:108` remove `invalidateCache('budgets:')` | `apiCache.test.ts` (3 cases "drops budgets:..."), `cache-prefix-classification.guard.test.ts` "drops every transaction-derived prefix" | covered |
| INV-CACHE-001 (in-flight) | `apiCache.ts:152` `currentGeneration(key) === generation` -> `true` | `apiCache.test.ts` 3 dedupe cases | covered |
| Completeness flag read `=== false` | `hooks/useInvestmentDailyValues.ts:32` drop `point.fxComplete !== false` | `InvestmentCalendarView.test.tsx` "shows unknown and names the pair when a rate is missing" (1 case; the hook has no test file of its own) | covered (thinly) |
| INV-CACHE-001 (recategorisation) | baseline: `categories.ts:69-78`, `payees.ts:187-204` have no invalidation | none; P1/P2 demonstrate | undetected (A26-S18-01) |
| INV-CACHE-001 (in-flight, hand-rolled sites) | baseline: `investments.ts:120-129` and 15 more `getCached`/`setCache` read sites | none; P3 demonstrates | undetected (A26-S18-02) |
| INV-CACHE-001 (valuation inputs) | baseline: `investments.ts:1162`, `user-settings.ts:40-43` | none; P4/P5 demonstrate | undetected (A26-S18-03) |
| INV-FX-001 (age, client) | baseline: `useExchangeRates.ts:66-73` | none; P7 demonstrates | undetected (A26-S18-04) |

## 7. Counterexamples and the interaction scenario

### 7.1 Contract matrix (backend response -> `frontend/src/types/*`)

Built by three read-only sweeps over all 36 type files and spot-checked at both ends for every row used in a finding (section 12). Kinds: 1 omitted field, 2 nullable typed non-null, 3 declared but never sent, 4 decimal string typed `number`, 5 enum drift.

| Frontend type.field | Backend producer | Kind | Meaning of absent / null / zero; consequence |
| --- | --- | --- | --- |
| `MonthlyNetWorth.fxComplete`, `missingRatePairs` (`types/net-worth.ts:3-15`) | `net-worth.service.ts:848-850, 1033` | 1 | absent in the type, so every reader treats a subtotal month as complete; already A26-S13-04 (UI half S20) |
| `MonthlyInvestmentValue.fxComplete` (`net-worth.ts:17-26`) | `net-worth.service.ts:1094-1096` | 1 | no reader outside `lib/net-worth.ts` |
| `PortfolioPeriodResult.incompleteRanges` | `portfolio-period-result.service.ts:150` | 1 | A26-S18-11 (c) |
| `DailyInvestmentValue` flags | present in the type | -- | not read by `InvestmentValueChart.tsx:218-241`, `PortfolioValueWidget.tsx:110-118` (handed to S20) |
| `PortfolioSummary.valuationComplete` etc. | `portfolio-calculation.service.ts:2184-2185` | -- | present and optional; `PortfolioValueWidget.tsx:149, 287-289` does not read it (A26-S02-03, S20) |
| `AccountHoldings.totalMarketValue` | subtotal when `valuationComplete` is false | -- | readers keyed on `unpricedHoldingsCount` (A26-S02-03, S20) |
| `AccountSummary` (`types/account.ts:321-327`) | `accounts.service.ts:1598-1606`, flags dropped server-side | -- | A26-S13-04; no frontend caller of `getSummary` outside tests |
| Sector, country, asset-class weightings | `sector-weighting.service.ts:420-431` skips unpriced/unconvertible holdings, no flag | -- | server half; handed to S13/S23 |
| `ExplainedRuleSkip` | `rule-effects.ts:91-95` | 5 | A26-S18-11 (a) |
| `MnyImportJob` (no `dataCommitted`) | entity `import-job.entity.ts:113`, DTO omits it | 1 | A26-S18-05 |
| `MnyImportResult.bondRowsWithoutSeries` | `mny-import-job.ts:106`, `import.dto.ts:413` | 1 | A26-S18-11 (b) |
| `CustomReport` `TableColumn.TAG`, `filters.tagIds` (`types/custom-report.ts:58, 82`) | backend enum `custom-report.entity.ts:57-69` has no `TAG`; no `tagIds` | 3/5 | handed to S20 (custom reports): whether the form can send either |
| `EmergencyAccessClaimPreview.message` | `emergency-access-claim.controller.ts:138-157` (decrypt failure -> `null`) | 2/1 | "no message" and "message could not be decrypted" are one state; handed to S19 (low) |
| `User.firstName`, `lastName`, `lastLogin` (`types/auth.ts:18-33`) | `user.entity.ts:25, 28, 51` nullable | 2 | `null` reaches code typed `string \| undefined`; no failing reader found |
| `CreatePatResponse.lastUsedAt`, `isRevoked` | `pat.controller.ts:45-52` omits them | 3 | type-only |
| `Category.effectiveColor`, `effectiveIcon`, `effectiveAutoSign` (non-optional) | only `findAll`, `findOne`, `getTree` add them; `create`, `update` and nested categories return the raw entity | 3 | inherited colour missing on nested categories; S20 |
| `Transaction.amount`, `TransactionSplit.amount`, `ScheduledTransaction*.amount` and `investment*`, `BudgetPeriod*` actuals, `SecurityPrice.*Price`, `Holding.quantity/averageCost` | TypeORM `decimal` columns with no transformer; `main.ts:53-60` parses only DATE/TIMESTAMP | 4 | strings typed `number`; readers coerce with `Number()` where sampled; design risk (section 9) |
| Scheduled `/due`, `/upcoming`, `/:id`, `POST`, `PATCH`, `/skip` | return the raw entity without `effectiveAmount` | -- | the effective fields are optional in the type, so a helper reading them answers "no information"; S20 checks the `getUpcoming`/`getDue` readers |
| Secret-like fields | none returned beyond the one-time enrolment/creation values (`TwoFactorSetupResponse.secret`, `CreatePatResponse.token`, backup codes, admin `temporaryPassword`) | -- | by design |

### 7.2 Dependency mutation matrix (Calibration Rule 5) for the cached portfolio valuation

| Dependency | Mutation channel | Invalidation | In-flight | Read model refresh |
| --- | --- | --- | --- | --- |
| Investment transactions | `investmentsApi.create/update/updateStatus/delete/transferSecurity` | `invalidateBalanceCaches()` | not generation-aware (A26-S18-02) | page refetch |
| Cash transactions (linked cash) | `transactionsApi.*`, scheduled post, imports, bank sync | `invalidateBalanceCaches()` | same | same |
| Security prices (provider) | `refreshPrices`, `refreshSelectedPrices` (`updated > 0`), `backfillSecurityPrices`, `recomputeSecurityBondPrices` | `invalidateCache('investments:')` | same | `usePriceRefresh` callback |
| Security prices (manual) | `create/update/deleteSecurityPrice` | `investments:prices:` only | -- | none (A26-S18-03) |
| Security currency | `updateSecurity` | `scheduled:` only | -- | none (A26-S18-03) |
| Reporting currency | `updatePreferences` | none | -- | none (A26-S18-03) |
| Exchange rates | `refreshRates` | `exchange-rates:`, `scheduled:` | -- | the portfolio summary (converted server-side with live rates) is not dropped: same class, folded into A26-S18-03's correction |
| Undo/redo, AI action, rules run, backup restore, receipt approval | respective modules | `clearAllCache()` | generation-aware for `dedupe` keys only | `useOnUndoRedo`, `useOnAiAction` |

### 7.3 Counterexamples (not copied from the suites)

- Same numeric value, different meaning: `totalPortfolioValue: 100000` computed in USD and rendered as CAD after a preference change (P5).
- Stale browser: a read issued before a trade, answered after it (P3).
- Legacy row: a CHF->USD rate last stored in 2020 (P7).
- Process crash after the first durable side effect: MNY rows committed, then `staging.remove` throws (A26-S18-05).
- Apparently cosmetic edit: recategorising rows changes no balance but moves budget progress (P1/P2).
- Two sessions, one device: user B in user A's tab (P8).

### 7.4 Interaction scenario

A user with a CHF brokerage changes the default currency to CAD and then posts a trade while the Investments page is loading. Three mechanisms interact: the cached summary in USD survives the preference change (A26-S18-03), the in-flight pre-trade read lands after the trade and is written back for 60 s (A26-S18-02), and the foreign-account view converts CHF at a 2020 rate (A26-S18-04). The card then shows a pre-trade USD figure under a CAD label, cross-converted at a five-year-old rate, with no partial marker, because every completeness signal it reads (`valuationComplete`, `ratesUnavailable`) is true for that payload. Each fix above is necessary; none alone removes the composite.

## 8. Rejected hypotheses

| Candidate | Evidence considered | Why rejected or downgraded | Final classification |
| --- | --- | --- | --- |
| A rate is rounded as money somewhere in `lib/` | grep of `roundMoney`/`roundToCents`/`toFixed` beside a rate across `src/` | every hit rounds an amount (`amount * rate`), not the rate; `roundFxRate` uses 10 dp; display uses `FX_RATE_DISPLAY_DECIMALS`; two `toFixed(FX_RATE_DISPLAY_DECIMALS)` displays (`CurrencyList.tsx:160-161`, `CurrencyExposureReport.tsx:175`) are unlocalized, a component issue | REJECTED for lib; locale half handed to S20 |
| `forecast.ts` selects investment schedules by the brokerage `accountId` (sweep claim) | `forecast.ts:607, 805, 977` normalise every schedule onto its settlement account before `scheduledFlowsForAccount` | the remap precedes selection | REJECTED |
| `useExchangeRates.convert` returns 1:1 or the input on a missing pair | `useExchangeRates.ts:83-101` returns `null`; `getRate` `null` | holds; `ratesUnavailable` distinguishes loading/failed | REJECTED |
| A share bundle can be read by another account (INV-SHARE-005) | `share-inbox.ts:85-102, 153-183, 246-283`: claim on list and read, `isVisibleTo` filter, `viewerUserId` required | holds; `discardSharedBundle(id)` takes no owner, so another account holding the random id could delete (not read) a bundle: no realistic path, ids come from the owner's own URL | REJECTED (note only) |
| Logout retry cannot succeed after the access token expires | `auth.controller.ts:1335-1354` is public, revokes by the refresh cookie | holds | REJECTED |
| The 401 interceptor loops or double-redirects during a user sign-out | `isSigningOut()` gate (`api.ts:193`), `beginSignOut` before any await (`AppHeader.tsx:255`) | holds | REJECTED |
| `budgets:dashboard` misses transaction writes (MON-M38 as filed) | prefix in `invalidateBalanceCaches`, mutation M1 killed | fixed | REJECTED for the original paths (residual is A26-S18-01) |
| Decimal strings typed `number` produce a wrong figure in `lib/` | sampled readers coerce (`investmentFold.ts:27-31`, `security-detail.ts:81-84`, `sumMoney` multiplies) | no concrete failing reader found in `lib/` | DESIGN_RISK (section 9) |
| `MnyImportJob` failure with `errorKey: null` shows "Nothing was saved" wrongly | backend always sets a key on failure | the `null` branch is unreachable; the reachable case is the generic key after commit (A26-S18-05) | merged into A26-S18-05 |
| The persisted AI chat (`localStorage`) leaks across accounts | `authStore.logout` removes `monize:ai-chat-messages` on every logout path (user, 401, rehydrate failure, PWA resume) | holds; still readable by XSS while signed in, which the guard records as a reviewed decision | REJECTED |

## 9. Design risks

- `total*` fields on `PortfolioSummary` and `AccountHoldings` stay numeric (a subtotal) when `valuationComplete` is false; every consumer must read the flag (A26-S02-03 shows several do not). Server-side rename to `null` plus a `known*Subtotal` field would make the type enforce it.
- Decimal columns arrive as strings while every type says `number` (section 7.1 kind 4). Correct today only because readers coerce; a new reader that adds two amounts concatenates them. A response mapper (or a numeric `transformer` on the entities) would close it.
- Cached payloads carry neither the reporting currency nor the reader's "today", so any cache surviving a preference change mislabels (A26-S18-03 residual).
- Filter state in `localStorage` (account ids, free-text search) survives logout; ids only resolve for their owner, but the search text is the previous user's typing.
- The balance-cache guard is a route list; any new write route that moves transaction-derived figures must be added by hand (A26-S18-01).

## 10. Missing tests and known-wrong tests

- No test covers a read in flight across a mutation for any `getCached`/`setCache` site (A26-S18-02).
- No test for recategorising writes and budget caches (A26-S18-01); no test for price, security-currency or preference writes and the valuation cache (A26-S18-03).
- `useExchangeRates.test.ts` uses `rateDate: '2025-01-15'` everywhere and never tests age (A26-S18-04).
- `hooks/useInvestmentDailyValues.ts` has no test file; its `=== false` reads are held by one component case (mutation row 3).
- `MnyImportProgress.test.tsx:160-167` asserts "Nothing was saved" for `errorKey: null`, an unreachable server state; weak, not wrong (A26-S18-05).
- No cross-tab refresh test anywhere (A26-S18-06); `e2e/` has no fixture to expire the access cookie.
- `persisted-storage.guard.test.ts` does not scan `sessionStorage` writers (A26-S18-08).
- Known-wrong test: none found in the slice (the MON-M42 assertion is corrected).

## 11. Documentation inconsistencies

- `docs/system-invariants.md` INV-CACHE-001 is `enforced`, but three classes of derived-cache staleness reproduce (A26-S18-01, -02, -03); the entry should be `partial` with these paths named.
- `docs/system-invariants.md` INV-FX-001 "Known gap" names only the built-in reports; the client's ageless conversion (A26-S18-04) is a second gap.
- `docs/frontend/api-and-cache.md` says "A write that moves money calls `invalidateBalanceCaches()`"; the budget family is moved by writes that move no money (recategorisation), and the guard enforces the narrower reading.
- `frontend/src/lib/apiCache.ts:10-17` describes the in-flight generation fix as closing the resurrection class; it closes it for `dedupe` only.
- `import.json` `mnyImportFailed` contains `--`, which `frontend/CLAUDE.md` forbids in copy (the em-dash rule); cosmetic.

## 12. Review ledger

- **Directories inspected:** `frontend/src/lib/` (inventory of every mutating method, 303), `frontend/src/types/` (all 36 files via the matrix sweeps), `frontend/src/hooks/` (sampled), `frontend/src/store/` (`authStore.ts` in full, guard sampled), `frontend/src/components/layout/AppHeader.tsx:230-280`, `components/auth/IncompleteLogoutNotice.tsx`, `components/providers/PwaLifecycleHandler.tsx:55-100`, `components/import/MnyImportProgress.tsx`, `components/investments/portfolio-chart-utils.tsx`, `InvestmentValueChart.tsx:90-110, 255-315, 395-435`.
- **Files read in full:** `lib/apiCache.ts`, `lib/api.ts`, `lib/investments.ts`, `store/authStore.ts:1-200`, `hooks/useExchangeRates.ts`, `lib/logout-state.ts:1-60`, `docs/frontend/api-and-cache.md`.
- **Files sampled with ranges:** `lib/transactions.ts:1-240` and the method list to `:572` (all mutations checked for invalidation); `lib/forecast.ts:1-130` outline, `:150-345`, `:450-560`, `:551-760`, `:985-1030` (not read line by line: `:760-980` multi-account and occurrence-count helpers); `lib/format.ts:1-180, 470-491`; `lib/budgets.ts:25-50, 240-279`; `lib/accounts.ts:1-48, 215-282`; `lib/categories.ts:17-95`; `lib/payees.ts:180-205`; `lib/import-mny.ts:277-338`; `lib/share-inbox.ts:85-300`; `lib/exchange-rates.ts:8-22, 154-170`; `lib/utils.ts:80-105`; `lib/pdf-export.ts:245-262`; `hooks/useInvestmentDailyValues.ts:20-45`; `balance-cache.guard.test.ts:1-80`; backend `token.service.ts:135-200`, `auth.controller.ts:1335-1354`, `exchange-rate.service.ts:905-935`, `mny-import-job.service.ts:605-625, 660-695`, `mny-import.service.ts:290-330`, `rule-effects.ts:88-96`, `custom-report.entity.ts:50-75`, `docs/system-invariants.md` INV-FX-001 and INV-SHARE-001..005.
- **Not read (recorded as sampled, never as clean):** `lib/push.ts`, `lib/loan-history.ts`, `lib/receipt-parser-form.ts`, `lib/document-scanner/`, `lib/email-receipts-*`, `lib/rule-*`, `lib/loan-*` (S15 read the loan helpers), `lib/backupApi.ts` beyond the restore line, `lib/number-parse.ts`, `lib/date-parse.ts`, `hooks/useNumberFormat.ts` beyond its exports, `docs/frontend/financial-figures.md` and `forms-and-formatting.md` beyond grep.
- **Searches:** every `dedupe(`/`getCached`/`setCache` site; every `invalidate*`/`clearAllCache` caller; every `apiClient.(post|patch|put|delete)` per method (script); `authApi.logout` and `/auth/logout` callers; `sessionStorage`/`localStorage.setItem` writers; `BroadcastChannel|navigator.locks`; `roundMoney|roundToCents|toFixed` beside a rate; `toLocaleString|'en-US'|Intl.NumberFormat(` in `lib/hooks/store`; `updatePreferences(` callers; `reassignTransactions|applyCategorySuggestions|confirmAction` callers; `rateDate` readers; `mnyImportFailed`; `outside_active_window`; `bondRowsWithoutSeries`.
- **Subagents:** three read-only `general-purpose` sweeps (one per type group) built the contract matrix; every row used in a finding was re-read at both ends by this session (`MnyImportJob`, `ExplainedRuleSkip`, `bondRowsWithoutSeries`, the custom report enum, the bills fallback, the forecast `accountId` claim, which was rejected).
- **Suites run (baseline code):** `npx vitest run src/lib src/hooks src/store src/types`: 349 files, 5 825 tests, passed. `AppHeader`, `IncompleteLogoutNotice`, `MnyImportProgress`: 65 passed. `npm run lint`, `npm run type-check`, `npm run i18n:check`: all exit 0. Probes (scratch worktree `scratchpad/mut`, never committed): `src/lib/zz-s18-probe.test.ts` 7 cases (P1-P6 plus the `dedupe` control), `src/hooks/zz-s18-probe2.test.ts` 2 cases (P7, P8): all reproduce. Mutations: 3 executed, all killed.
- **Areas reviewed without a finding:** logout and its retry (MON-M36/M42); the `dedupe` generation mechanism; `useExchangeRates` 1:1 half; the share target's ownership and logout sweep (INV-SHARE-001..005, S04 hand-off); `investmentsApi.refreshSelectedPrices` write-nothing rule; scheduled-post, split, transfer, bulk, import, bank-sync and investment-trade invalidation; `backupApi.restoreBackup` `clearAllCache()`; `forecast.ts` settlement-account remap and unknown-rate withholding.
- **Hand-off dispositions:** S03 (401 reuse) -> A26-S18-06. S04 (INV-SHARE-001..005) -> reviewed, holds. S09 (job DTO lacks `dataCommitted`, committed-failure copy) -> A26-S18-05. S13 A26-S13-04 / S02 A26-S02-03 (frontend types without flags, flags not read) -> the type half confirmed in section 7.1 (`MonthlyNetWorth`, `MonthlyInvestmentValue` omit the flags; `AccountSummary` has none to carry); the reader half stays with S20 (components), consolidated under A26-S13-04 and A26-S02-03, no new ID. S07 (cache after balance writes, undo) -> undo/redo call `clearAllCache()` (`action-history.ts:38-46`, `useUndoRedo.ts:44, 72`, `ActionHistoryPanel.tsx:112, 141`), so the client half of A26-S07-02 is invalidated; the server's missing net-worth recompute stays S07's.
- **Open hypotheses handed on:**
  - to S20: `DailyInvestmentValue` flags not read in `InvestmentValueChart.tsx:218-241` and `PortfolioValueWidget.tsx:110-118`; `?? 0` / `|| 0` on `totalPortfolioValue` (`AssetAllocationChart`, `InvestmentDetailView.tsx:201`, `app/investments/page.tsx:325`, `GeographicAllocationReport.tsx:347, 365`); custom report `TAG` column and `filters.tagIds` against the backend enum; `app/bills/page.tsx:540` `effective ?? Number(t.amount)` and `:507-508, 575-577` hand-rolled due dates (INV-OCCURRENCE-003); `CurrencyList.tsx:160-161` and `CurrencyExposureReport.tsx:175` unlocalized rate display; `Category.effective*` missing on nested categories; readers of `scheduledTransactionsApi.getDue/getUpcoming` that expect effective fields.
  - to S19: `PostTransactionDialog.tsx:433` `Number(nextOverride?.amount ?? scheduledTransaction.amount)` (the banned pattern, seeding the posting form) and its `:446-526` field fallbacks; `OverrideEditorDialog.tsx:203-290` seeds from the base amount; the emergency-access claim's undecryptable message reads as "no message".
  - to S13/S23: server-side weightings skip unpriced/unconvertible holdings with no flag (`sector-weighting.service.ts:420-431`).
  - to S21: A26-S18-02 and -03 join the program mutation table as baseline-undetected rows; a guard for `setCache(` outside `apiCache.ts`; no E2E fixture for access-cookie expiry (A26-S18-06).
- **Text for the ledger (orchestrator merges):**
  - Session row: S18 `done`; findings B/H/M/L = 0/0/6/5 (MEDIUM A26-S18-01..06; LOW A26-S18-07..11); verdict APPROVE (no BLOCKER or HIGH survived; the six MEDIUM findings go to the remediation plan).
  - Prior findings disposed (final): MON-M36 `FIXED_VERIFIED`; MON-M38 `STILL_OPEN` narrowed -> A26-S18-01; MON-M42 `FIXED_VERIFIED`.
  - Suites: frontend lib/hooks/store/types 349 files, 5 825 tests passed; lint, type-check, i18n:check exit 0; 3 component suites 65 passed; 9 probe cases reproduce; 3 mutations killed.
  - Undetected mutation rows: `INV-CACHE-001 | categories.ts:69-78, payees.ts:187-204 baseline (no invalidation) | none | S18`; `INV-CACHE-001 | investments.ts:120-129 and 15 more hand-rolled getCached/setCache read sites (no generation) | none | S18`; `INV-CACHE-001 | investments.ts:1160-1177, user-settings.ts:40-43 (valuation inputs) | none | S18`; `INV-FX-001 client | useExchangeRates.ts:66-73 (no age bound) | none | S18`.
  - Deviations: report-only commits (ledger, sessions and register left to the orchestrator); the contract matrix built by three read-only subagent sweeps with every finding row re-verified; `lib/` sampled by invariant per the XL rule (ranges above); the checkout's HEAD was found detached after a rebase, the partial commit was pushed as `HEAD:ccr-1f689e5c-onia07` (fast-forward, remote tip an ancestor) and the branch reattached, no remote history rewritten.

## 13. Adversarial approval challenge

Started from the slice's own abstractions, not the findings: the cache primitive (`dedupe`, generations, prefixes), the rate table, the auth store, and the type layer as the place a server signal can be dropped.

- **Searched:** every cache family against every mutation channel that changes what it derives from (section 7.2), which is how A26-S18-03 surfaced after A26-S18-01; the generation mechanism against every writer of `cache` (A26-S18-02); every "newest" read on the client against the server's one-door rule (A26-S18-04); every state the browser keeps across a session boundary (`localStorage`, `sessionStorage`, Cache API, in-memory module state such as `usePriceRefresh`'s `lastRefreshTimestamp`, which is not account data); every terminal state a job can report against the copy shown (A26-S18-05); the refresh path under two tabs (A26-S18-06).
- **Found:** A26-S18-03 (reporting-currency channel) and A26-S18-08 (sessionStorage) came from this pass. Also checked and cleared: `clearAllCache()` advances in-flight generations so a 401-forced logout cannot resurrect a previous account's cached payload for the next account (`apiCache.ts:69-78`); `usePriceRefresh` module state is per tab and holds no figures.
- **Not challenged:** component-level readers (S19/S20), the service worker beyond the share target (`public/sw.js` push paths), the E2E suite.

## 14. Verdict

**APPROVE** for the slice at `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86`: no BLOCKER or HIGH survived the adversarial approval challenge. Confirmed: 6 MEDIUM (A26-S18-01 budget progress after recategorisation, -02 in-flight cache resurrection, -03 valuation inputs not invalidating, -04 ageless client FX, -05 committed MNY failure shown as nothing saved, -06 two-tab refresh read as theft) and 5 LOW. Independently verified: every MEDIUM by execution (P1-P7) or by a cited deterministic code path (-05, -06). Limitations: `lib/` sampled by invariant (section 12); no browser or E2E run; hosted CI not consulted. The mandatory adversarial close-out pass was completed.
