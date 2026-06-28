# Feature mockup: AI Broker Import (paste order history -> investment trades)

> This is a design mockup for discussion, not a PR. Screenshots of the working
> prototype are attached separately.
>
> - **Branch (full implementation):** https://github.com/WMP/monize/tree/port/broker-import
> - **Running images** (if you want to click through it):
>   `ghcr.io/wmp/monize-backend:fork-ghcr-images-708264c` and
>   `ghcr.io/wmp/monize-frontend:fork-ghcr-images-708264c` (also `:latest`).

## Why this exists (the problem)

Getting historical trades into the app is the worst part of tracking investments.
Brokers rarely offer a clean export; what you *can* always do is open the order /
trade-history page and select-copy the table. But every broker lays that table
out differently (column order, Polish vs English headers, "Kupno/Sprzedaz" vs
"Buy/Sell", thousands separators, commission in a separate column or folded into
the price). Re-typing each line into the investment-transaction form is slow and
error-prone, and a custom per-broker parser would be a maintenance treadmill.

The insight: the structure is *already in the clipboard*. When you copy a table
from a web page, the browser puts a full `text/html` fragment on the clipboard,
not just flattened text. An LLM is very good at reading a messy HTML table and
normalizing it into a clean list of orders, regardless of the broker's layout or
language. So we let the AI do the parsing and the user stays the reviewer who
confirms before anything is written.

## What it does

A single screen:

1. **Paste.** The user copies the order table from their broker and pastes into a
   box. We capture `clipboardData.getData('text/html')` (falling back to plain
   text), so the AI gets the real table structure, not a flattened blob. A small
   hint confirms what was captured ("HTML table captured (~24 rows)").
2. **Parse.** The AI returns a normalized list of orders: security name,
   BUY/SELL side (it maps localized words -- e.g. Polish Kupno(K) -> BUY,
   Sprzedaz(S) -> SELL), quantity, price, commission, currency, trade date. It
   also tries to **match each order to an existing security** in the user's data,
   and surfaces any parser **warnings**.
3. **Review (the core).** An editable table, one row per order. Every field is
   editable. For each row the user:
   - ticks "Add" (deselect rows to skip them),
   - picks the **target security**: the matched existing one is pre-selected; if
     the security is new, choosing "Create new security..." reveals inline
     symbol / name / exchange / currency inputs (**a ticker symbol is required**
     to create one, so new securities are always well-formed),
   - corrects side / quantity / price / commission / currency / date if the
     parser got anything wrong.
4. **Add.** Choose the **target brokerage account** (only investment/brokerage
   accounts are offered) and click "Add selected". Applied rows are dropped from
   the list; deselected rows stay for a second pass. A toast reports exactly what
   happened ("Added 12 trades, 3 new securities, 1 skipped").

Nothing is created until "Add selected", and the parse step is read-only.

## How it is built (fits existing conventions)

- **Backend:** `backend/src/ai/broker-import/` -- a `parse` endpoint (AI,
  read-only: HTML in, normalized orders out) and an `apply` endpoint (write).
- **Apply reuses existing paths, no new money logic:** it calls the existing
  `InvestmentTransactionsService.create(...)` for each order and
  `SecuritiesService.create(...)` for approved new securities -- so holdings
  rebuild, cost basis and validation all behave exactly as for a manually entered
  trade. No new schema, no migration.
- **The provider is the user's configured one:** the parse call goes through the
  existing `AiService.complete(...)`, respecting each user's chosen
  provider/model/key.
- **Shared-tool rule honored:** the parse logic is exposed both as an MCP tool
  (`backend/src/mcp/tools/broker-import.tool.ts`) and an AI-assistant tool
  (`parse_broker_import`), returning the same shape. (Apply stays REST + MCP; the
  read/parse is the part that belongs in both surfaces.)

## Open design question: where should this live?

The prototype currently sits under the **AI menu** as its own page
(`/ai/import-broker`). As with the payee organizer, I think the AI menu is not
the most natural home and I'd like your call before this becomes a real PR.

**Recommendation: surface it from the Investments / brokerage-account view**, as
an "Import from broker (AI)" action next to the manual "Add investment
transaction" flow. Rationale:

1. **It is an investment-data-entry task.** It produces investment transactions
   on a specific brokerage account; the user is in the investments context when
   they want it, and the target-account picker is right there.
2. **It is the bulk sibling of "Add investment transaction".** Putting "add one
   by hand" and "paste a whole history and let AI structure it" side by side
   makes the fast path discoverable exactly when it is needed.
3. **The AI menu reads as "chat with an assistant".** A paste -> parse -> review
   grid is a different interaction, and is a bit of a stretch there.

Keeping the backend endpoints and the MCP/assistant tools unchanged, the only
change would be to launch the same paste/review UI (modal or sub-page) from the
Investments view instead of an AI-menu page. If you'd prefer to keep all AI
features grouped under the AI menu for consistency, that's an easy alternative --
I just wanted to flag that the natural home, by task, is Investments.

## Notes / things to decide with the real PR

- **Prototype strings are English-only for now.** Full i18n for all locales would
  land with the real PR (the parser already understands localized broker tables
  like Polish Kupno/Sprzedaz regardless of UI language).
- **FX / settlement currency:** the prototype takes price/commission/currency at
  face value from the parsed rows. If you want trades settled in the account
  currency with an FX conversion (rather than stored in the trade currency), that
  is a decision worth making explicitly before merge.

Happy to adjust the placement and wording once you tell me which way you'd like
it.
