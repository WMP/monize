# Proposal: replace the horizontal scrolling Settings tabs with a menu on mobile

> Propose-first Discussion (per CONTRIBUTING) — `kenlasko/monize` Discussions
> (Ideas). Not a PR. Separate concern from the row-actions / category-dropdown
> proposals (part of the same mobile-UX pass).

## Problem

On phone/tablet widths (`< lg`), the Settings navigation renders as a **horizontal,
horizontally-scrollable strip of pill tabs** (`SettingsNav` `variant="horizontal"`:
`flex gap-2 overflow-x-auto scrollbar-hide`). With the number of sections, this is:

- cramped and **hard to swipe** precisely to the section you want,
- you can't see all sections at once (only a few fit; the rest are off-screen),
- the scrollbar is hidden, so the overflow isn't even obvious.

Auto-scrolling the active tab into view helps a little, but it's still a fiddly way
to navigate on a small screen.

## Where it is

- `frontend/src/components/settings/SettingsNav.tsx` — `variant="horizontal"` is the
  scrollable pill strip; the other variant is the vertical sidebar.
- `frontend/src/app/settings/page.tsx` / `layout.tsx` — renders the horizontal nav
  below `lg` and the vertical `aside` sidebar at `lg` and up (`hidden lg:block`).

## Goal

On mobile, replace the horizontal scroll strip with a **hamburger / dropdown menu**:
a single compact control showing the **current section**, which opens a menu (or
slide-in drawer) listing **all** sections at once — including the danger item in red.
Desktop sidebar stays as-is.

## Options

| # | Option | Pros | Cons |
|---|--------|------|------|
| **A (recommended)** | **Dropdown/menu button** — shows the active section label + chevron; tap opens the full list | Compact, standard, all sections reachable in one tap, reuses existing nav items | a menu layer to manage |
| B | **Slide-in drawer** (hamburger → side panel with the section list) | matches a "real" nav drawer; lots of room | heavier; the app header already has its own hamburger, risk of two drawers |
| C | Keep the strip but make overflow obvious (visible scroll affordance / arrows) | smallest change | doesn't fix the core "hard to swipe / can't see all" problem |

**Recommendation: A** — a dropdown/menu for the `< lg` Settings nav. The app already
has a hamburger menu in the header (`navigation.toggleMenu` / `mainMenu`), so there's
an existing menu/drawer pattern to reuse rather than invent.

## Scope & conventions

- **Frontend only:** `SettingsNav.tsx` (mobile variant → menu) + its mount in the
  settings page/layout. No backend, no DB.
- **i18n:** add an aria-label / "Settings sections" menu-button string for all
  locales (`de, en, es, fr, it, nl, pl, pt, pt-BR, xx`); reuse existing section
  labels.
- **Tests:** `SettingsNav` test for the menu (opens, lists sections, selecting one
  navigates / scrolls, active section shown on the trigger).
- **One concern per PR:** standalone, small.

## Open question

- Dropdown menu (A) or a full slide-in drawer (B)? Given the header already owns a
  drawer, a lightweight dropdown likely avoids two competing drawers — but happy to
  go either way.
