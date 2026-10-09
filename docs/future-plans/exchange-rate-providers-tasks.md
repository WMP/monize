# Exchange Rate Providers: Agent Task List

> Companion to [`exchange-rate-providers.md`](./exchange-rate-providers.md) (the plan, which also carries the contracts, truth table and recorded fixtures). This file breaks the work into tasks sized for one AI-agent session each. Do the tasks in dependency order; never start a task whose dependencies are unmerged. Mark a task done by checking its box and noting the PR.

## How to use this list (read first, every session)

- **One task per session/PR.** Each task lists its files. Touching files outside the task's scope is a scope violation -- stop and leave a note on the task's issue instead.
- **The plan is the authority on every contract and every fixture.** A Frankfurter fixture is copied from plan section 6, never from a live call made during the session (a live call may be added as a second recorded fixture, dated). If the code and the plan disagree, the plan is changed first, in its own commit, with the reason.
- **The governing invariants apply to every task:** an unavailable rate is `null`, never 1 (INV-FX-001); a pair is stored in one orientation through `canonicalRateRow` (INV-FX-003); a provider refresh may overwrite a date but a user's import may not (INV-FX-004); a stored rate names its provider and the chain keeps "answered nothing" apart from "did not answer" per provider (INV-FX-005, registered by S1). Name every one the task touches in the PR.
- **Definition of done for every task** (in addition to per-task acceptance):
  - `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`.
  - `frontend/`: `npm run lint && npm run type-check && npm run i18n:check`, `npm run test:changed`, `npm run build`.
  - A new `configService.get`: `node scripts/check-env-docs.mjs` from the repository root, with the variable documented in `.env.example` in the same PR.
  - `docs/`: `node scripts/check-docs-manifests.mjs` and, in `backend/`, `npm run test:unit -- doc-paths instruction-files`.
  - Stage new files before running a guard (`git add -N` is enough).
  - New user-facing strings: English catalogs only, then `npm run i18n:pseudo`. The full-locale pass is Q.
  - The doc line each task names lands in the same PR.
- **Terminology:** "the plan" = `exchange-rate-providers.md`; "the chain" = `FxProviderChain`; "the adapter" = one `FxRateProvider` implementation; "the providers directory" = `backend/src/currencies/providers/`. Section references point at the plan. Re-locate code by symbol, never by line.

## Deployment safety

| Class | Meaning |
|-------|---------|
| **none** | Tests, docs, or code nothing calls yet. |
| **inert** | Ships a code path or a constant that changes nothing until an operator sets `FX_PROVIDERS`. |
| **neutral** | Rewrites a live code path. Designed behaviour-preserving for every existing deployment, except where the task names a change; the full unit suite of the touched module is the gate. |
| **change** | Changes what every deployment does by default. One task (R1), revertable by one env line. |

No task adds a migration. Every task before R1 leaves a deployment with no `FX_PROVIDERS` set calling Yahoo exactly as today, except for the two named behaviour changes in B2 and B4.

## Task graph

| ID | Issue | Task | Depends on | Deploy class | Status | PR |
|----|-------|------|-----------|--------------|--------|----|
| S1 | -- | Plan pair in `docs/future-plans/`; INV-FX-005 registered `unenforced` | -- | none | [ ] | -- |
| B1 | -- | Provider contract, `FX_PROVIDERS` parser, the chain, the Yahoo adapter, module wiring; nothing calls them | S1 | none | [ ] | -- |
| B2 | -- | `ExchangeRateService` on the chain: refresh by base, backfill by window, `fillRateWindow`, live rate, `source` from the provider; the source guard | B1 | neutral | [ ] | -- |
| B3 | -- | Frankfurter adapter, tracked provider id, breaker guard over the providers directory, `FX_FRANKFURTER_BASE_URL` | B1 | inert | [ ] | -- |
| B4 | -- | Yahoo adapter: placeholder cross-check against the reverse symbol, orientation memory | B1 | neutral | [ ] | -- |
| B5 | -- | Currency lookup and verification through the chain; `currencies` under the breaker guard | B2, B3 | neutral | [ ] | -- |
| B6 | -- | Status endpoint lists the configured providers | B2 | inert | [ ] | -- |
| F1 | -- | Currencies page provider line, rate-history source label, all-failed refresh toast, en + pseudo | B6, B3 | inert | [ ] | -- |
| R1 | -- | Default `frankfurter,yahoo`; docs; release note | B2, B3, F1 | change | [ ] | -- |
| Q | -- | Acceptance: all locales, INV-FX-005 enforced, verification-contract row | R1, B4, B5 | none | [ ] | -- |

**Why B2 is neutral, not none:** it rewrites the live refresh, backfill, window and live-rate paths. With the default list `yahoo` the adapter makes the same Yahoo calls the service made, with one named change: the refresh now tries the reverse symbol when the direct one has no quote (`fillRateWindow` already did; the refresh did not).

**Why B3 is inert:** `frankfurter` is a valid name the parser accepts, but the default list stays `yahoo` until R1, so no deployment calls Frankfurter unless its operator asks.

**Why F1 waits for B3:** the source label and the provider line would otherwise name a provider that cannot be configured.

---

## Task details

### S1 -- Plan

**Files:** `docs/future-plans/exchange-rate-providers.md`, `docs/future-plans/exchange-rate-providers-tasks.md` (both new), `docs/system-invariants.md` (INV-FX-005, `unenforced`), `docs/verification-contract.md` (its matrix row).

- INV-FX-005 statement: every `exchange_rates` row a provider writes carries that provider's `source` slug; every provider question passes through `FxProviderChain` in the order `FX_PROVIDERS` names; "the provider answered with nothing" and "no provider answered" are kept apart per provider, so an outage at one provider is never remembered as an empty window. Source of truth: `FX_PROVIDERS` and `FxRateProvider.source`. Enforcement planned: `fx-provider-source.guard.spec.ts` and the section 5 cases in `fx-provider-chain.spec.ts`.
- Acceptance: the docs gate above passes; the plan's section 6 fixtures carry their recording date.

### B1 -- Contract, parser, chain, Yahoo adapter

**Files:** `backend/src/currencies/providers/fx-provider.interface.ts`, `backend/src/currencies/providers/fx-provider.config.ts`, `backend/src/currencies/providers/fx-provider-chain.ts`, `backend/src/currencies/providers/yahoo-fx.provider.ts` (all new, with specs), `backend/src/currencies/currencies.module.ts`, `.env.example` (`FX_PROVIDERS`, default `yahoo`).

- The interface exactly as plan section 4, `FX_PROVIDER_NAMES = ["yahoo"]` in this task (B3 adds `frankfurter`).
- `fx-provider.config.ts`: `DEFAULT_FX_PROVIDERS`, `resolveFxProviders(raw)` (split, trim, lower-case, dedupe, empty or unset means the default), `FxProviderConfigError` naming the bad token and the valid names.
- The chain per plan sections 4 and 5: `latest`, `dailySeries`, `live`, `carriesAny`, `describe`. Providers are asked in order; `carries` gates every call; `answered` is "every carrying provider answered".
- `YahooFxProvider` (`name: "yahoo"`, `source: "yahoo_finance"`): `carries` always true; `fetchLatest` loops the quotes with `FX_FETCH_CONCURRENCY` (moved here from `exchange-rate.service.ts`), each quote direct `${base}${quote}=X` then reverse, through `YahooFinanceService.fetchQuote`, dated `todayYMD()`; `fetchDailySeries` direct then reverse through `fetchHistoricalWindow`, `null` only when neither symbol answered (the rule `fillRateWindow` holds today); `fetchLive` is the direct-then-reverse quote. Observations come back in the orientation that answered.
- `currencies.module.ts`: a `useFactory` provider for the chain reading `FX_PROVIDERS` from `ConfigService`, in the shape of `ATTACHMENT_STORAGE_PROVIDER` in `backend/src/attachments/attachments.module.ts`; the factory throws `FxProviderConfigError` on an unknown name (plan decision 11).
- Acceptance: every row of the plan's section 5 table as a named case in `fx-provider-chain.spec.ts`, plus the `latest` per-quote rules; the parser's cases (unset, empty, mixed case, duplicate, unknown); the Yahoo adapter's symbol building, orientation of a reverse answer, `answered` rule, and that a `null` from `fetchQuote` never becomes an observation; `node scripts/check-env-docs.mjs`; `backend/src/module-graph.spec.ts` green (the `forwardRef` to `SecuritiesModule` stays).

### B2 -- `ExchangeRateService` on the chain

**Files:** `backend/src/currencies/exchange-rate.service.ts`, `backend/src/currencies/exchange-rate.service.spec.ts`, `backend/src/currencies/providers/fx-provider-source.guard.spec.ts` (new), `docs/backend/securities-and-providers.md` (a section "Exchange rates come from an ordered chain of providers"), `docs/external-side-effects.md` (section 6, one paragraph).

- Remove `fetchYahooRate`, `fetchYahooHistoricalRates`, `fetchYahooHistoricalRatesWindow` and the `YahooFinanceService` injection; inject the chain.
- `refreshAllRatesGlobally`: group the canonical pairs by their first code; one `chain.latest(base, quotes)` per base, bases in sequence; each found observation goes to `saveRate(observation, source)` dated by the observation (plan decision 5; the Yahoo adapter dates `todayYMD()`, so no Yahoo row changes); a quote in `unanswered` is a failed pair with error "no provider answered"; a quote answered without a rate is a failed pair with "no rate data available"; a pair no provider carries is failed with "no configured provider carries X/Y". The summary shape is unchanged.
- `backfillHistoricalRates`: `chain.dailySeries(from, to, earliestYmd, todayYMD())` replaces `fetchHistorical` (`range=max`) and the date filter; the 500 ms pause between pairs stays.
- `fillRateWindow`: one `chain.dailySeries` call; `stored` from `persistRateSeries(points, source)`; `answered` from the chain. The signature is unchanged, so `ExchangeRateHistoryService` is untouched.
- `getRateForDate` step 2 and `ensureRatesForDate`: the same call through the chain.
- `getLiveRate`: `chain.live`, then the stored rate in `live` mode, as today.
- `saveRate(observation, source)` and `persistRateSeries(points, source)` write the `source` they are given; `canonicalRateRow` orients each point from its own `from`/`to`. No `'yahoo_finance'` literal remains in the file.
- `fx-provider-source.guard.spec.ts`: fails on a quoted source slug (`yahoo_finance`, `frankfurter`) anywhere under `backend/src/currencies/` outside the providers directory, and on an import of `yahoo-finance.service` under `backend/src/currencies/` outside `yahoo-fx.provider.ts`. It asserts its own subject exists first (a scan matching nothing is the failure mode of every guard).
- Acceptance: `exchange-rate.service.spec.ts` green with the chain behind a typed fake whose answers are shapes the real adapter produces (`docs/backend/testing.md`), its Yahoo-specific expectations rewritten to chain expectations and the one named behaviour change (reverse symbol on refresh) covered; the "an empty answer is not a refusal" row in `docs/specs/provider-outage-alerts.md` still names this spec; `exchange-rate-history.service.spec.ts` green unchanged; the guard's own positive and negative cases.

### B3 -- Frankfurter

**Files:** `backend/src/currencies/providers/frankfurter-fx.provider.ts` (new, with spec), `backend/src/currencies/providers/fx-provider.interface.ts` (`"frankfurter"` joins `FX_PROVIDER_NAMES`), `backend/src/currencies/providers/fx-provider.config.ts`, `backend/src/currencies/currencies.module.ts`, `backend/src/provider-health/providers.ts` (`frankfurter: "Frankfurter"`), `backend/src/provider-health/provider-call.guard.spec.ts`, `.env.example` (`FX_FRANKFURTER_BASE_URL`), `docs/specs/provider-outage-alerts.md` (the sentence naming FX as a next adopter).

- `FrankfurterFxProvider` (`name: "frankfurter"`, `source: "frankfurter"`), plan section 6 in full: the three endpoints, `rates[Q]` under `base=B` as `{ from: B, to: Q }`, observations before `start` dropped, the status table of 6.3, the currency list of 6.4 cached 24 hours with the compiled-in fallback, timeouts 15 s and 60 s, `AbortSignal.timeout`, `User-Agent` naming Monize.
- Breaker: `this.health.assertAvailable("frankfurter")` before every call, `recordSuccess` in exactly two places (the non-2xx branch and the body-completion point), `logFailure` in the catch; never `error.stack`.
- `provider-call.guard.spec.ts`: `GUARDED_DIRS` gains `currencies/providers`; the "finds the clients it is guarding" list gains `currencies/providers/frankfurter-fx.provider.ts`; the recorded-in-one-place table gains `["currencies/providers/frankfurter-fx.provider.ts", 2]`; the tracked-id test finds `"frankfurter"` in the new directory.
- Acceptance: the section 6.1 responses verbatim as fixtures (latest, range with the clipped start, currencies, the three 404 and silent-drop cases, the Sunday, the pre-1999 window); the 6.3 table row by row with a fake `ProviderHealthService`; `carries` from the list, from the fallback when the list call fails, and false for `TWD`; `node scripts/check-env-docs.mjs`; a deployment with `FX_PROVIDERS=frankfurter,yahoo` set locally refreshes with Frankfurter rows written as `source = 'frankfurter'` (a manual check, noted in the PR).

### B4 -- Yahoo placeholder cross-check

**Files:** `backend/src/currencies/providers/yahoo-fx.provider.ts` and its spec.

- `YAHOO_FX_PLACEHOLDER_RATE = 0.01` and `PLACEHOLDER_TOLERANCE = 0.01` (1 %), both named with the issue number. When a direct quote equals the placeholder exactly, fetch the reverse; when `1 / reverse` differs from the direct quote by more than the tolerance, return the reverse observation and remember the pair as reverse-first in a bounded process-local map; otherwise return the direct quote (a real rate can be 0.01).
- A remembered pair asks the reverse symbol first on later `fetchLatest` and `fetchDailySeries` calls; the memory is a cost saving, not a correctness rule, and is documented as such.
- Acceptance: plan section 7.3 as a case (IDR against USD, 0.01 against 17871); the agreeing case keeps the direct quote; the memory's effect on the next call; a reverse that does not answer leaves the direct quote in place with a `warn`.

### B5 -- Currency lookup through the chain

**Files:** `backend/src/currencies/currencies.service.ts` and its spec, `backend/src/currencies/providers/yahoo-fx.provider.ts` (`verifyCurrency`, `searchCurrency`), `backend/src/currencies/providers/frankfurter-fx.provider.ts` (`verifyCurrency` from the list), `backend/src/securities/yahoo-finance.service.ts` (one public `searchQuotes(query, count)` beside `lookupSecurity`, through `throttledFetch`), `backend/src/provider-health/provider-call.guard.spec.ts` (`GUARDED_DIRS` gains `currencies`).

- `verifyAndReturnCurrency` asks `chain.carriesAny(code)` and, when no provider carries it, each provider's `verifyCurrency`; the local metadata is still the name and symbol source. The free-text step 3 asks `searchCurrency` of each provider that implements it (Yahoo, through the new door). The two bare `fetch` calls are gone.
- Acceptance: `currencies.service.spec.ts` green with the chain faked; the breaker guard now scanning `currencies` finds no bare `fetch`; `yahoo-finance.service.spec.ts` covers `searchQuotes`; the recorded-in-one-place count for Yahoo stays 3.

### B6 -- Status endpoint

**Files:** `backend/src/currencies/currencies.controller.ts` and its spec, `backend/src/currencies/providers/fx-provider-chain.ts` (`describe`).

- `GET /currencies/exchange-rates/status` answers `{ lastUpdated, providers: [{ name, source }] }` in configured order. Labels are the client's. `@AllowDelegate` stays as it is.
- Acceptance: controller spec; the response shape documented in the controller's Swagger decorators.

### F1 -- Frontend

**Files:** `frontend/src/lib/exchange-rates.ts` and `frontend/src/lib/exchange-rates.test.ts` (`getRateStatus`, the mirrored `FX_PROVIDER_NAMES`, a contract test against `backend/src/currencies/providers/fx-provider.interface.ts`), the Currencies page (route /currencies) and its test, `frontend/src/components/currencies/RateHistoryCoverage.tsx` and its test, `frontend/src/i18n/messages/en/currencies.json`.

- Plan section 12: the provider line under the page header; the all-failed refresh as an error toast; `sourceKey` learns `frankfurter`; labels keyed by provider name.
- Grep `e2e/tests/currencies.spec.ts` for the refresh button's accessible name before changing any control.
- Acceptance: component tests for the line, the toast branch and the label; `npm run i18n:pseudo`; `npm run build`.

### R1 -- Default order and docs

**Files:** `backend/src/currencies/providers/fx-provider.config.ts` (`DEFAULT_FX_PROVIDERS = ["frankfurter", "yahoo"]`), `.env.example`, `docs/backend/securities-and-providers.md`, `docs/cron-jobs.md` (the `exchange-rate.service` row names the chain), `docs/external-side-effects.md`, `README.md` (the Multi-Currency Support list), a release note per `docs/release-notes/README.md`.

- The release note names the behaviour change in plan section 10 phase 5: new rows for the 28 ECB-covered currencies are ECB reference rates dated by the ECB; stored history is not rewritten; `FX_PROVIDERS=yahoo,frankfurter` restores Yahoo first.
- Acceptance: `fx-provider.config.spec.ts` updated for the new default; `node scripts/check-docs-manifests.mjs`; `npm run test:unit -- doc-paths instruction-files`.

### Q -- Acceptance

**Files:** every locale's `currencies.json`, `docs/system-invariants.md` (INV-FX-005 flipped to `enforced` with its specs named), `docs/verification-contract.md` (the row met), the plan's status line.

- Every locale translated as the final commit (`npm run i18n:check`, `backend/src/i18n/locales.parity.spec.ts` where backend strings changed).
- The plan's section 16 open questions each carry their answer or a link to the discussion that gave it.
