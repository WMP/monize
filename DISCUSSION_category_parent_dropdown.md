# Proposal: use the Payee form's searchable category Combobox for the Category form's "Parent Category" selector

> Propose-first Discussion (per CONTRIBUTING) — `kenlasko/monize` Discussions
> (Ideas). Not a PR. Separate concern from the row-actions proposal.

## Problem

Two places let you pick a category, and they use different controls:

- **Payee form** (`frontend/src/components/payees/PayeeForm.tsx`) picks the default
  category with a **searchable `Combobox`** (`@/components/ui/Combobox`), built from
  the category tree (`buildCategoryTree`) — type to filter, "Parent: Child" context.
- **Category form** (`frontend/src/components/categories/CategoryForm.tsx`) picks
  the **Parent Category** with a plain native **`Select`** (`@/components/ui/Select`)
  over `parentOptions` (indented by level) — no search.

So the same task ("choose a category") looks and behaves differently depending on
the screen. With many categories the plain `<select>` is noticeably worse (no
type-to-filter, long scroll).

## Goal

Align the Category form's Parent Category selector to the **Payee form's
`Combobox`**, so category selection is consistent and searchable across the app.

## Proposal

Replace the `Select` parent picker in `CategoryForm` with the same `Combobox`
component the payee form uses, fed by the existing parent-options tree.

Must preserve the current safeguard: the parent list **excludes the category
itself and its descendants** (CategoryForm already does this via `collectChildren`
/ `excludeIds`) to prevent cycles — the Combobox should be populated from that same
filtered, level-aware list.

## Scope & conventions

- **Frontend only:** `CategoryForm.tsx`. No backend, no DB.
- **i18n:** reuse the existing "Parent Category" label; add a search/placeholder
  string for the Combobox if needed, for all locales (`de, en, es, fr, it, nl, pl,
  pt, pt-BR, xx`).
- **Tests:** `CategoryForm.test.tsx` currently drives a `<select>`
  (`getByLabelText('Parent Category')` + `fireEvent.change`); update it to the
  Combobox interaction.
- **One concern per PR:** small, standalone — independent of the row-actions
  consistency proposal.

## Open question

- Aim for an exact reuse of the payee Combobox (extract a shared
  `CategoryCombobox` if the payee usage is bespoke), or just adopt the `Combobox`
  with category-tree options inline in `CategoryForm`?
