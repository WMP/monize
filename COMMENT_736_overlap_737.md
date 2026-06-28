Heads-up: this overlaps #737, which adds an optional `currencyCode` override to `create_security`. Both touch the same currency-resolution line in `SecuritiesService.previewCreateSecurity` (plus the `create_security` input schema and its specs), so whichever lands second will need a small rebase.

They're complementary rather than competing:

- **#737** lets the AI *explicitly* pass a currency — a manual override, and a rescue when the provider reports none.
- **#736 (this PR)** fixes the *default*: it reads the instrument's currency from the live quote (`meta.currency`), so a USD/EUR ETF on the LSE (e.g. `AGGG.L`) resolves correctly with no one having to intervene. The exchange→currency guess (`LSE → GBP`) is simply wrong for those listings, and the override alone doesn't fix the default — the AI would still have to know to pass `currencyCode: "USD"` every time.

Combined, the natural precedence is: explicit override → live-quote currency → exchange-guess fallback:

```ts
// explicit AI override wins; otherwise prefer the instrument's live-quote
// currency; otherwise fall back to the exchange-derived guess
let currencyCode = input.currencyCode?.trim() || lookup.currencyCode?.trim();
if (!input.currencyCode) {
  const authoritative = await this.securityPriceService.fetchAuthoritativeCurrency(
    userId, lookup.symbol, lookup.exchange,
  );
  if (authoritative) currencyCode = authoritative;
}
```

Happy to rebase this PR onto #737 (or vice-versa) and wire in that precedence once either one lands — just let me know which you'd prefer to merge first.
