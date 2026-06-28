---
repo: kenlasko/monize
title: "[UX] List row actions crowd the row on mobile and differ across Payees/Transactions/Accounts/Categories"
labels: ["enhancement"]
---

## What's wrong

On phone-width viewports, the per-row action buttons take a large share of the
row and squeeze the primary content. On the **Payees** list the payee name is
truncated ("TOWARZYSTWO UB…", "ADYEN N.V.SIMON…", "www.envoyservices…") because
Merge / Edit / Delete sit inline and eat ~half the row.

The four main list views also implement row actions inconsistently — different
components, styles, and responsive behavior:

| List | Actions | Style | Hidden < 480px? |
|------|---------|-------|------------------|
| Payees (`PayeeRow`) | Merge / Edit / Delete | `Button variant="ghost"` text | **No — always shown, crowds** |
| Transactions (`TransactionRow`) | Edit/View, Delete + `CopyDropdown` (⋮) | plain colored `<button>` | Yes (`min-[480px]`), row tap → edit |
| Accounts (`AccountRow`/`ActiveAccountActions`) | Edit / Reconcile / Close / Delete | `Button` components + context menu | Yes (`min-[480px]`) |
| Categories (`CategoryRow`) | Edit / Delete | `Button` w/ colored text | **No — always shown, crowds** |

So Transactions/Accounts already hide inline actions on small screens (row-tap /
context menu), while **Payees and Categories show them at every width** — they're
the offenders. And there are ~3 different action styles across the four.

## Suggested approach

Introduce one shared `RowActionsMenu` (overflow "⋮" / kebab), generalizing the
existing `CopyDropdown` (Transactions) and Accounts context menu. On mobile,
collapse per-row actions into the menu (and/or adopt Transactions' row-tap-to-edit);
keep inline actions on desktop. Bring Payees and Categories in line so the name
stays readable. Frontend-only; best landed as a small series (extract the shared
menu, then adopt per list) rather than one sweeping change.

## Environment

Frontend (Next.js). Files: `frontend/src/components/payees/PayeeList.tsx`,
`frontend/src/components/transactions/TransactionRow.tsx`,
`frontend/src/components/accounts/AccountRow.tsx`,
`frontend/src/components/categories/CategoryList.tsx`. Screenshot of the Payees
list on mobile available on request.
