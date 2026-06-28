## Linked discussion / issue

Closes #744 (labeled `approved-to-build`).

## Summary

A cross-currency investment **Buy/Sell** created via the MCP server (and the AI Assistant) silently used an exchange rate of **1.000000** when no stored daily rate was available, so the amount posted to the funding cash account was wrong by the size of the FX rate. For a EUR security funded from a PLN account this understated the PLN cash posting ~4.3x, corrupting the cash balance and the recorded cost basis with no error shown.

Resolution now follows a clear precedence and **never silently falls back to 1.0** for a genuine cross-currency pair.

## Behavior

`InvestmentTransactionsService.resolveCashExchangeRate()` resolves the rate, in order:

1. **Explicit override.** An `exchangeRate` supplied by the caller (the web form already does this; now MCP/AI can too, e.g. from the broker's settlement data).
2. **The rate as of the transaction date.** New `ExchangeRateService.getRateForDate(from, to, date)`: the closest stored rate on or before the date, otherwise a historical fetch from Yahoo for that date (the chosen point is persisted, with its inverse, for reuse). This replaces the old `getLatestRate()` snapshot, so a back-dated buy converts at the historical rate, not today's.
3. **The latest stored rate**, as a secondary source.
4. **No determinable rate for a cross-currency pair -> reject** with `errors.securities.exchangeRateUnavailable`, instead of posting at 1.0.

Same-currency transactions are unaffected (rate stays 1). The transaction date is now threaded into all four `resolveCashExchangeRate` call sites (create, preview, embedded split, update re-resolve).

## Changes

**Backend (FX resolution)**
- `currencies/exchange-rate.service.ts`: add `getRateForDate()` (dated lookup + Yahoo historical fallback, persisted).
- `securities/investment-transactions.service.ts`: `resolveCashExchangeRate()` takes the transaction date, prefers the dated rate, and throws for an undeterminable cross-currency pair; thread the date through every caller; expose `exchangeRate` on the create/update preview and row inputs.

**Backend (shared tools, both layers in sync per the shared-tool rule)**
- MCP `mcp/tools/investments.tool.ts`: optional `exchangeRate` on `manage_investment_transactions` (create + update), forwarded through `toInvCreateRow`/`toInvUpdateRow`.
- AI `ai/query/tool-input-schemas.ts`, `tool-definitions.ts`, `tool-executor.service.ts`: matching optional `exchangeRate` field and converters.

**i18n**
- New `errors.securities.exchangeRateUnavailable` key, translated for every locale (regional `en-*` variants inherit from `en`), preserving the `{{ from }}` / `{{ to }}` placeholders.

## Acceptance criteria (from the issue)

- [x] A cross-currency Buy/Sell via MCP/AI posts using the FX rate for the **transaction date** (supplied or Yahoo), not 1.
- [x] MCP and AI investment-transaction tools accept an optional rate override (both layers in sync).
- [x] No silent 1.0 for genuinely different currencies; an undeterminable rate is reported, not hidden.
- [x] Reproduction (IUSQ EUR -> PLN, 2026-06-08, 3 @ EUR 104.66) posts ~zl 1350, not zl 313.98.

## Tests

- `getRateForDate`: stored carry-forward, dated Yahoo fallback, and null when unavailable.
- `create`: rejects an undeterminable cross-currency rate; uses the dated rate when present.
- MCP and AI: forward an explicit `exchangeRate` to the create prep.
- Touched suites green (exchange-rate, investment-transactions, MCP investments, AI tool-executor, i18n parity).

## Checklist

- [x] An approved discussion or issue exists and is linked above (#744, `approved-to-build`).
- [x] This PR addresses a **single concern** (cross-currency FX rate for investment transactions).
- [x] New behavior has tests, and the existing suite passes.
- [x] All user-facing strings are translated for **every** locale (1 new key: `errors.securities.exchangeRateUnavailable`).
- [x] No shared/core areas were refactored without prior agreement (additive optional field on the shared tools; the FX resolution change is internal).
- [x] The branch is rebased on the latest `main`.
- [x] AI assistance is disclosed below, and I have reviewed and own the result.

## AI assistance disclosure

Implemented with Claude Code; design, approach, and the FX precedence reviewed and owned by me. Verified the reproduction case locally.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
