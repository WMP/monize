# Proposal: consistent, mobile-friendly row actions across the list views (Payees, Transactions, Accounts, Categories)

> Propose-first Discussion (per CONTRIBUTING) — for `kenlasko/monize` Discussions
> (Ideas). Not a PR. Attach the mobile Payees screenshot when posting.

## Problem

Two related issues across the main table/list views:

1. **Mobile crowding.** On a phone-width viewport the per-row action buttons take
   a large share of the row, squeezing the primary content. On the **Payees**
   list this truncates the payee name — the thing you actually scan for:
   "TOWARZYSTWO UB…", "ADYEN N.V.SIMON …", "www.envoyservices…" (see screenshot).
2. **Inconsistency.** The three list views implement row actions three different
   ways — different components, visual styles, and responsive behavior — which is
   both a UX wart (e.g. Accounts' Edit/Reconcile look nothing like Transactions'
   actions) and a maintenance burden.

## Current state (per list)

| List | Component | Actions | Style | Mobile behavior |
|------|-----------|---------|-------|-----------------|
| Payees | `PayeeList`/`PayeeRow` | Merge / Edit / Delete | `Button variant="ghost"` text | **Always shown** — only a "density" toggle shortens to `M/E/X`. **Not hidden on small screens → crowds the name.** No row-tap. |
| Transactions | `TransactionRow` | Edit/View, Delete, + a `CopyDropdown` (⋮) for duplicate/schedule | plain colored `<button>` text links | Actions cell `hidden min-[480px]:table-cell`; whole row is tappable → edit. |
| Accounts | `AccountRow` / `ActiveAccountActions` | Edit / Reconcile / Close / Delete | `Button` components (different look) + a context menu | Actions cell `hidden min-[480px]:table-cell`; context menu present. |
| Categories | `CategoryList` (`CategoryRow`) | Edit / Delete | `Button` with colored text (visually ≈ Transactions) | **Always shown** — `sticky right-0`, **no `min-[480px]` hide → crowds the name.** No row-tap. |

So the four lists split two ways. **Transactions and Accounts** already hide inline
actions below 480px (falling back to row-tap / context menu), while **Payees and
Categories show their actions at every width** — they crowd the name and are the
odd ones out. On top of that the four render "row actions" with at least three
different building blocks/styles (ghost `Button` text, plain colored `<button>`,
`Button` components, `Button` with colored text), so even where actions show, they
don't look the same from list to list.

## Why it matters

- **Mobile:** secondary, rarely-used actions outrank the primary identifier on the
  smallest screen — inverted priority.
- **Consistency / maintainability:** four divergent implementations of the same
  concept; the `CopyDropdown` (Transactions) and the Accounts context menu are
  already two separate overflow-menu patterns that could be one.

## Proposed direction

Introduce **one shared row-actions affordance** used by all three lists:

- A reusable **`RowActionsMenu`** (overflow "⋮" / kebab) — generalize the existing
  `CopyDropdown` and the Accounts context menu into a single component with a
  consistent style.
- **On mobile**, per-row actions live in the kebab (and/or the whole row taps to
  edit, matching Transactions); **on desktop**, keep inline actions — or also use
  the kebab everywhere for full consistency (open question).
- **Bring Payees in line**: hide inline Merge/Edit/Delete on small screens and
  surface them via the kebab, so the name stays readable.

### Options considered

| # | Option | Pros | Cons |
|---|--------|------|------|
| **A (recommended)** | **Shared kebab "⋮" menu on mobile**, reusing/generalizing `CopyDropdown` + Accounts context menu | Smallest behavioral change, standard pattern, fixes crowding, unifies the four implementations; Delete keeps its `ConfirmDialog` | one extra tap to reach an action |
| B | Icon-only inline actions on mobile | actions stay visible, less width | still N tap targets in a row; per-list icon sets to design |
| C | Card / stacked layout below `sm` | most mobile-native | larger rewrite of each list |
| D | Tap-row → action sheet everywhere | cleanest on phones; Transactions already half-does this | changes affordances (Payees name currently links to transactions) |

**Recommendation: A** — a shared `RowActionsMenu`, adopted by all three lists,
applied on mobile (desktop optional). It directly fixes the Payees crowding and
removes the cross-list inconsistency, while reusing patterns that already exist.

## Scope & conventions

- **Frontend only:** a new shared `RowActionsMenu`, then `PayeeRow`,
  `TransactionRow`, `AccountRow`, `CategoryRow`. No backend, no DB.
- **i18n:** menu-button aria-labels added for all locales
  (`de, en, es, fr, it, nl, pl, pt, pt-BR, xx`); existing action labels reused.
- **Tests:** the shared component (opens, fires handlers, delete via confirm) plus
  each list's adoption.
- **One concern per PR** (per CONTRIBUTING): this is best landed as a small series
  — (1) extract `RowActionsMenu`, (2) adopt in Payees, (3) Transactions, (4)
  Accounts, (5) Categories — not one sweeping change.

## Open questions

1. Kebab on mobile only, or everywhere for consistency?
2. Adopt Transactions' row-tap-to-edit on Payees and Accounts too?
3. Land as a shared component + per-list series of small PRs (preferred), or treat
   each list independently?
4. Breakpoint: match the existing `min-[480px]` used by Transactions/Accounts, or
   switch on `sm`?

Happy to implement once the approach, breakpoint, and PR sequencing are agreed.
