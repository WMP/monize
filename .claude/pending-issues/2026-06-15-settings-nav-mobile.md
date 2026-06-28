---
repo: kenlasko/monize
title: "[UX] Settings nav on mobile is a hard-to-swipe horizontal tab strip; should be a menu"
labels: ["enhancement"]
---

## What's wrong

On phone/tablet widths (`< lg`), the Settings navigation renders as a horizontal,
horizontally-scrollable strip of pill tabs (`SettingsNav` `variant="horizontal"`:
`flex gap-2 overflow-x-auto scrollbar-hide`). It is:

- cramped and **hard to swipe** precisely to the wanted section,
- unable to show all sections at once (most are off-screen),
- using a hidden scrollbar, so the overflow isn't obvious.

Auto-scrolling the active tab into view helps a little, but it's still a fiddly
way to navigate on a small screen.

## Suggested approach

On mobile, replace the horizontal scroll strip with a **hamburger / dropdown
menu**: a compact control showing the current section, opening a menu (or drawer)
listing all sections at once (danger item in red). Keep the desktop sidebar as-is.
The app header already has a hamburger menu (`navigation.toggleMenu` / `mainMenu`),
so there's an existing menu/drawer pattern to reuse. Frontend-only.

## Environment

Frontend (Next.js). Files: `frontend/src/components/settings/SettingsNav.tsx`
(`variant="horizontal"`), `frontend/src/app/settings/page.tsx` /
`frontend/src/app/settings/layout.tsx` (renders horizontal nav `< lg`, sidebar at
`lg`+).
