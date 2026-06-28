## Summary

Makes the AI chat's **"View …"** link land on the record it just created/edited and flash it, instead of dumping the user on an unfiltered list.

Today the confirmation card's success link is a bare list route (`/transactions`, `/payees`, `/securities`), so after approving an action you have to hunt for the affected row yourself. The card already has the result id (`action.resultId`); this wires it into a deep link and flashes the row on arrival.

Two commits:
1. **Transactions** — reuses the existing `targetTransactionId` machinery (the backend resolves which page contains the row, used today for transfer-leg navigation).
2. **Payees / securities / categories** — a small shared `useHighlightTarget` hook (`?highlight=<id>` URL param + scroll-into-view + flash style) for the client-loaded lists.

## Behavior

- After a confirmed create / update / categorize:
  - **transaction / transfer** → `/transactions?targetTransactionId=<id>`
  - **payee** → `/payees?highlight=<id>`
  - **security** → `/securities?highlight=<id>`
- The destination list opens on the page that contains the record, and the row briefly flashes (amber ring) and scrolls into view; the flash clears a few seconds after it appears.
- **Categories** get the same `?highlight=<id>` support (the tree flashes in place) even though no AI action links there yet — ready for other entry points.
- Falls back to the plain list when no result id is present. Delete actions still have no link.

## Not included

**Investments** are deferred: the card's investment result is a *transaction* id, but `/investments` lists holdings (by security), so there's no matching row there. Highlighting it needs the transaction-list path on that page plus server-side page resolution for investment transactions — a separate change.

## Changes

**Shared**
- `hooks/useHighlightTarget.ts`: `useHighlightParam` (reads `?highlight`, auto-clears), `useScrollIntoViewWhen` (scrolls a row in), `HIGHLIGHT_RING` (shared flash style).

**Transactions**
- `TransactionConfirmationCard.tsx`: build the transaction link from `action.resultId`.
- `useTransactionFilters.ts`: read `targetTransactionId` from the URL (UUID-validated), feed the existing `targetTransactionIdRef`, expose `highlightTransactionId`.
- `TransactionList.tsx` / `TransactionRow.tsx`: `highlightTransactionId` prop → ring + scroll.
- `transactions/page.tsx`: clear the flash a few seconds after the row renders.
- `test/setup.ts`: mock `Element.prototype.scrollIntoView` (absent in jsdom).

**Payees / securities / categories**
- `PayeeList` / `SecurityList` / `CategoryList`: `isHighlighted` row prop (ring + scroll via the shared hook).
- `payees` + `securities` pages: jump to the client-side page holding the target. `categories` renders a full tree, so it flashes in place.
- `TransactionConfirmationCard.tsx`: payee/security links use `?highlight=<resultId>`.

## Why minimal backend impact

Transactions reuse the existing `targetTransactionId` query param + "find the page" logic; the other lists are fully client-loaded. No controller, service, or schema changes.

## Tests

- `useHighlightTarget`: param read + auto-clear, custom param name, scroll only when active.
- `TransactionConfirmationCard`: each link deep-links with its id and falls back without one (transactions, payees, securities).
- `useTransactionFilters`: valid/invalid `targetTransactionId` init.
- `TransactionRow` / `PayeeList`: the targeted row gets the ring and scrolls; others don't.
- Touched component + page suites green; ESLint + `tsc --noEmit` clean.

## Checklist

- [x] Single concern (deep-link + flash the AI card's "View" links).
- [x] New behavior has tests, and the existing suite passes.
- [x] No new user-facing strings (reuses existing `ai.confirmAction.view*` keys) — no i18n impact.
- [x] No shared/core refactor beyond an additive `highlight`/`isHighlighted` prop and a small shared hook.
- [x] The branch is based on the latest `main`.
- [x] AI assistance is disclosed below, and I have reviewed and own the result.

## AI assistance disclosure

Implemented with Claude Code; design and approach reviewed and owned by me.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
