---
repo: kenlasko/monize
title: "[UX] Category form's Parent Category picker is a plain select; Payee form uses a searchable combobox"
labels: ["enhancement"]
---

## What's wrong

Two places let you pick a category, with inconsistent controls:

- **Payee form** (`frontend/src/components/payees/PayeeForm.tsx`) picks the default
  category with a **searchable `Combobox`** (`@/components/ui/Combobox`) built from
  the category tree — type to filter, "Parent: Child" context.
- **Category form** (`frontend/src/components/categories/CategoryForm.tsx`) picks
  the **Parent Category** with a plain native **`Select`** (`@/components/ui/Select`)
  — no search, just a long indented list.

Same task ("choose a category"), two different experiences. With many categories
the plain `<select>` is noticeably worse (no type-to-filter, long scroll).

## Suggested approach

Switch the Category form's Parent Category selector to the same searchable
`Combobox` the Payee form uses. Preserve the existing safeguard that the parent
list **excludes the category itself and its descendants** (CategoryForm already
does this via `collectChildren` / `excludeIds`) to prevent cycles. Frontend-only;
update `CategoryForm.test.tsx`, which currently drives a `<select>`.

## Environment

Frontend (Next.js). Files: `frontend/src/components/categories/CategoryForm.tsx`
(current `Select`), `frontend/src/components/payees/PayeeForm.tsx` (reference
`Combobox`).
