#!/usr/bin/env python3
"""
Standalone Python replica of the Monize 'security currency at create' logic,
for reviewing the fix in branch fix/security-currency-from-quote.

It mirrors three pieces of the TypeScript code:

  1. getCurrencyFromExchange()  -> the OLD guess (exchange -> currency map)
     backend/src/securities/yahoo-finance.service.ts:888
  2. YahooFinanceService.fetchQuoteRaw() currencyCode field  -> the live quote
     backend/src/securities/yahoo-finance.service.ts:313  (currencyCode at :364)
  3. previewCreateSecurity() override -> prefer authoritative, fall back to guess
     backend/src/securities/securities.service.ts:595

Usage:
    python3 verify_security_currency.py AGGG.L LSE
    python3 verify_security_currency.py VOD.L LSE
    python3 verify_security_currency.py AAPL ""        # no exchange suffix
    DEBUG=0 python3 verify_security_currency.py AGGG.L LSE   # quiet

No third-party deps. Uses urllib so it runs anywhere Python 3 does.
"""

import json
import os
import sys
import urllib.request
import urllib.error
import urllib.parse

DEBUG = os.environ.get("DEBUG", "1") != "0"

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"


def dbg(*args):
    if DEBUG:
        print("  [debug]", *args, file=sys.stderr)


# --- 1. OLD behavior: guess currency from the exchange ----------------------
# Port of getCurrencyFromExchange(exchange, symbol).
EXCHANGE_TO_CURRENCY = {
    "TSX": "CAD",
    "TSX-V": "CAD",
    "CSE": "CAD",
    "NEO": "CAD",
    "LSE": "GBP",
    "ASX": "AUD",
    "Frankfurt": "EUR",
    "XETRA": "EUR",
    "Paris": "EUR",
    "Tokyo": "JPY",
    "HKEX": "HKD",
}


def get_currency_from_exchange(exchange, symbol):
    # Matches the TS: no exchange OR no "." in symbol -> assume USD.
    if not exchange or "." not in symbol:
        return "USD"
    return EXCHANGE_TO_CURRENCY.get(exchange)  # None if unknown


# --- GBX/GBp normalization (port of isGbxCurrency) --------------------------
def is_gbx_currency(currency):
    if not currency:
        return False
    trimmed = currency.strip()
    return trimmed == "GBp" or trimmed.upper() == "GBX"


# --- 2. NEW behavior: read currency from the live quote ---------------------
# Port of fetchQuoteRaw()'s currencyCode field. We hit the same Yahoo v8 chart
# endpoint the TS code uses and read meta.currency.
def fetch_quote_currency(yahoo_symbol):
    url = (
        "https://query1.finance.yahoo.com/v8/finance/chart/"
        + urllib.parse.quote(yahoo_symbol)
        + "?interval=1d&range=1d"
    )
    dbg("REQUEST  GET", url)
    dbg("REQUEST  headers:", {"User-Agent": USER_AGENT})

    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            status = resp.status
            body = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        dbg("RESPONSE status", e.code, "(HTTPError)")
        dbg("RESPONSE body:", e.read().decode("utf-8", "replace")[:500])
        print(f"  Yahoo returned {e.code} for {yahoo_symbol}")
        return None
    except Exception as e:
        dbg("RESPONSE error:", repr(e))
        print(f"  Network error for {yahoo_symbol}: {e}")
        return None

    dbg("RESPONSE status", status)
    data = json.loads(body)

    meta = (
        data.get("chart", {})
        .get("result", [{}])[0]
        .get("meta")
        if data.get("chart", {}).get("result")
        else None
    )
    if not meta:
        dbg("RESPONSE no meta block (chart.result empty?)")
        dbg("RESPONSE body (truncated):", body[:500])
        return None

    dbg(
        "RESPONSE meta (relevant):",
        json.dumps(
            {
                "symbol": meta.get("symbol"),
                "currency": meta.get("currency"),
                "exchangeName": meta.get("exchangeName"),
                "fullExchangeName": meta.get("fullExchangeName"),
                "instrumentType": meta.get("instrumentType"),
                "regularMarketPrice": meta.get("regularMarketPrice"),
            },
            indent=2,
        ),
    )

    currency = meta.get("currency")
    gbx = is_gbx_currency(currency)
    # Port of: meta.currency ? (gbx ? "GBP" : meta.currency) : null
    currency_code = ("GBP" if gbx else currency) if currency else None
    dbg(f"NORMALIZE currency={currency!r} gbx={gbx} -> currencyCode={currency_code!r}")
    return currency_code


# --- 3. The fix: previewCreateSecurity currency resolution ------------------
def resolve_currency(lookup_symbol, lookup_exchange):
    print(f"\n=== {lookup_symbol}  (exchange={lookup_exchange or 'none'}) ===")

    # What the lookup (search endpoint) would have produced: the exchange guess.
    guessed = get_currency_from_exchange(lookup_exchange, lookup_symbol)
    currency_code = guessed.strip() if guessed else None
    print(f"  OLD (exchange guess)      : {guessed}")

    # The fix: override with the authoritative live-quote currency if present.
    authoritative = fetch_quote_currency(lookup_symbol)
    print(f"  NEW (live quote currency) : {authoritative}")

    if authoritative:
        currency_code = authoritative

    if not currency_code:
        print("  RESULT                    : (none) -> would reject / ask manual entry")
        return None

    verdict = "SAME" if currency_code == guessed else "CHANGED by fix"
    print(f"  RESULT stored currency    : {currency_code}   [{verdict}]")
    return currency_code


def main():
    args = sys.argv[1:]
    if not args:
        # A few illustrative defaults, including the reported bug.
        cases = [
            ("AGGG.L", "LSE"),  # USD bond ETF on LSE -> bug: was GBP
            ("VOD.L", "LSE"),   # genuine GBP (GBp/pence) LSE share
            ("AAPL", ""),       # plain US listing
        ]
    else:
        cases = [(args[0], args[1] if len(args) > 1 else "")]

    for symbol, exchange in cases:
        resolve_currency(symbol, exchange)


if __name__ == "__main__":
    main()
