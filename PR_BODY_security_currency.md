## Linked discussion / issue

Bug fix for `create_security` (added in #734).

## Summary

`create_security` (and the security lookup it shares with the AI Assistant) stored the **wrong currency for non-local-currency listings** — e.g. `AGGG.L` (iShares Core Global Aggregate Bond UCITS ETF, USD) was saved as **GBP** instead of USD.

**Root cause:** the Yahoo lookup derives currency from the *exchange* via `getCurrencyFromExchange()` (`LSE → GBP`), because the Yahoo *search* endpoint doesn't return a per-instrument currency. But the London Stock Exchange lists many USD- and EUR-denominated ETFs, so the exchange→currency guess is wrong for them. This isn't cosmetic: `security.currencyCode` drives the FX conversion for investment transactions (security currency → cash-account currency), so a mislabelled GBP corrupts cost/valuation math, not just the label.

**Fix:** take the instrument's currency from the live quote's `meta.currency` (which the code already reads for prices), not from the exchange.
- `QuoteResult` gains `currencyCode` (GBX/`GBp` normalized to GBP).
- `YahooFinanceService.fetchQuoteRaw` populates it from `meta.currency`.
- New `SecurityPriceService.fetchAuthoritativeCurrency()` resolves it for a symbol via the user's provider.
- `previewCreateSecurity` now resolves currency by precedence: **live-quote currency (authoritative) → explicit `currencyCode` override → exchange-guess fallback**. This composes with the `currencyCode` override added in #737 — the live quote wins, and the explicit override remains the fallback that also rescues a lookup the provider can't price (per the maintainer's note on #736). No regression: a failed/absent quote keeps the prior behavior.

Rebased on `main` after #737 merged.

Lookups for autocomplete are unchanged (no extra network calls); the authoritative fetch happens only at create time, for the one security being saved.

Verified: `AGGG.L` now resolves to USD; a normal LSE share (`GBp`) resolves to GBP. (MSN-primary users fall back to the exchange guess until MSN also reports currency — a small follow-up.)

## Checklist

- [x] An approved discussion or issue exists and is linked above.
- [x] This PR addresses a **single concern** (correct security currency at create).
- [x] New behavior has tests, and the existing suite passes.
- [x] All user-facing strings are translated for **every** locale (i18n parity). _(No new strings.)_
- [x] No shared/core areas were refactored without prior agreement (additive `QuoteResult` field + one new service method; no behavior change for existing callers).
- [x] The branch is rebased on the latest `main`.
- [x] AI assistance is disclosed below, and I have reviewed and own the result.

## AI assistance disclosure

Diagnosed and fixed with Claude Code (traced the exchange→currency guess to `yahoo-finance.service.ts`); reviewed and tested locally. For this fix in particular I read through the logic myself and understand it — I reproduced the same resolution logic in a standalone script and verified it against live Yahoo data (`AGGG.L` reports USD, a normal LSE share reports `GBp`→GBP).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
