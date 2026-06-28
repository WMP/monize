## Summary

A cross-currency investment **Buy** created via the MCP server (and the AI Assistant) silently uses an exchange rate of **1.000000** when no stored daily rate is available, so the amount posted to the funding cash account is wrong by the size of the FX rate. For a EUR security funded from a PLN account this understates the PLN cash posting ~4.3x.

This corrupts the cash-account balance and the recorded cost basis, with no error shown.

## Reproduction (real case)

Added an investment transaction via MCP (`manage_investment_transactions`, Buy):

- Brokerage account: `BOŚ Bank IKE - Brokerage (PLN)`
- Funds from: `BOŚ Bank IKE - Cash` (PLN)
- Security: `IUSQ - iShares MSCI ACWI UCITS ETF USD Acc` — quoted in **EUR**
- Date: `2026-06-08`, Qty 3 @ €104.66 → Total **€313.98**

Result in the edit form: **Currency conversion (EUR → PLN), Exchange rate 1 EUR = 1.000000 PLN**, "Posts to cash account (PLN): zł 313.98". The PLN posting equals the EUR amount; it should be ~313.98 × (EUR/PLN ≈ 4.3) ≈ **zł 1350** for 2026-06-08.

## What the source data looks like (both tiers happen in practice)

The data actually fed into MCP for this order (BOŚ, order 147291850) was the basic order summary — it has **no FX rate**, only the EUR figures, the settlement currency, and the date:

```
Papier: iShares MSCI ACWI UCITS ETF   Giełda: Deutsche Börse (Xetra)   K
Limit: 104.66   Wartość: 313.98   Prowizja: 0.00   Waluta: EUR / Waluta rozl.: PLN
Data od: 08.06.2026   Status: wykonane
```

With only this, there is nothing to derive the rate from — so this is the **Yahoo-for-the-date** case: fetch EUR/PLN for 2026-06-08 (≈ 4.25) and post ≈ zł 1335, instead of the silent 1.0 that gives zł 313.98.

A **more detailed view is optionally available** from the broker (order execution detail), and it does carry the rate and the settled PLN amount:

```
Transakcje do zlecenia:
Data        Liczba  Cena        Liczba*Cena  Po prowizji  Waluta  Kurs waluty           Rynek
08.06.2026  3       437.37909   1 312.14     1 312.14     PLN     4.251352 EUR /PLN     XETA
```

When that is supplied (**rate = 4.251352 EUR/PLN**, **settled total = 1 312.14 PLN**), it should be used directly and exactly — the **derive-from-supplied-data** case — but the MCP/AI tools currently have no field to accept a rate or a converted total, so even this is dropped and the backend defaults to 1.0.

So the two tiers below are not hypothetical: the same order yields the Yahoo case (basic paste) or the derive case (detailed paste) depending on what the user provides.

(Aside: the per-share price in the basic data, €104.66, is the order *limit*; the actual fill was ~€102.88, which is why the exact settlement is 1 312.14 PLN and not 313.98 × 4.251352. The most reliable anchor, when present, is the settled PLN total / stated rate — not a recomputation from the limit price. With only the basic data, Yahoo-for-the-date is a close approximation, off by the limit-vs-fill price difference, not by the ~4.3x FX error.)

## Root cause

- `InvestmentTransactionsService.resolveCashExchangeRate()` (`backend/src/securities/investment-transactions.service.ts:325-369`) calls `exchangeRateService.getLatestRate(source, cashCurrency)` and, when it returns `null`, **logs a warning and returns `1`** (`:361-365`). `getLatestRate` is the once-per-day stored snapshot, not the rate for the transaction's date — so a back-dated transaction (e.g. 2026-06-08) gets either today's snapshot or, if missing, `1`.
- The MCP tool (`backend/src/mcp/tools/investments.tool.ts`, create schema ~`:488-543`) and the AI Assistant tool (`backend/src/ai/query/tool-input-schemas.ts:262-272`, `tool-definitions.ts:743-807`) **expose no `exchangeRate` / converted-total field**, so the caller cannot supply or correct the rate even when it knows it. The web form pre-fills a rate via `useExchangeRates().getRate()` and lets the user adjust, but MCP/AI have no equivalent path and fall through to the `1` default.

## Proposed change

Mirror the approach we took for security currency (read it from an authoritative source instead of guessing): determine the FX rate from the best available source, and **never silently fall back to 1 for a genuine cross-currency pair**.

Precedence (analogous to currency detection):

1. **Derive from the data given to MCP/AI, if present.** If the caller supplies enough to compute the rate — e.g. the cash amount actually posted (converted total) alongside the security-currency total, or an explicit `exchangeRate` — use that. This requires exposing an optional `exchangeRate` and/or `convertedTotal`/`cashAmount` field on the investment-transaction create tools (MCP + AI, kept in sync), so an import that already contains the PLN amount can pin the exact rate.
2. **Otherwise fetch the rate for the transaction's date from Yahoo.** Use the EUR/PLN (source→cash) rate **as of the transaction date**, not "latest". The infrastructure already exists — `exchangeRateService.getLiveRate()` and `backfillHistoricalRates()` (`backend/src/currencies/exchange-rate.service.ts`); `resolveCashExchangeRate` should request the dated/historical rate (fetching from Yahoo if not stored) rather than only `getLatestRate()`.
3. **If no rate can be determined, surface it** (reject the create, or flag the transaction for review) instead of defaulting to `1` and silently corrupting the cash posting.

## Acceptance criteria

- A cross-currency investment Buy/Sell created via MCP/AI posts to the cash account using the FX rate for the **transaction date** (from supplied data if available, else Yahoo), not `1`.
- The MCP and AI Assistant investment-transaction tools accept an optional rate/converted-total override (both layers in sync, per the shared-tool rule), so callers with the real cash amount can pin it exactly.
- No silent `1.0` fallback for genuinely different currencies; an undeterminable rate is reported, not hidden.
- The reproduction case (IUSQ EUR → PLN, 2026-06-08, 3 @ €104.66) posts ~zł 1350, not zł 313.98.

## Notes / scope

- Same-currency transactions are unaffected (rate stays 1).
- This pairs naturally with PR #743 / #736 (authoritative security currency): once the security currency is correct, the cash conversion is the remaining gap for non-base-currency holdings.
- Possible follow-up: backfill/repair transactions already created with a bogus `exchangeRate = 1`.
