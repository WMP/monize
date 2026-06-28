## Linked discussion / issue

Bug fix: stray page scrollbar on the AI chat page.

## Summary

The AI chat page (`/ai`) had a stray vertical page scrollbar: the page was taller than the viewport and could be scrolled down by exactly the height of the app header, even though the chat has its own internal scroll area.

**Root cause:** `AppHeader` is `sticky top-0` and `h-16` (4rem), and `PageLayout` wraps page content in `min-h-screen` (>=100vh). On a page meant to fit the viewport, that guarantees `4rem (header) + 100vh (content) = 100vh + header`, so the page overflows by exactly the header height. The chat's own `h-[calc(100vh-12rem)]` magic offset never affected this — the overflow came entirely from `min-h-screen` sitting under the sticky header.

**Fix (scoped to `/ai`):**
- The page is now bounded to `h-[calc(100dvh-4rem)]` (the space below the sticky `h-16` header) and lays out as a flex column, instead of `PageLayout`'s `min-h-screen`.
- `ChatInterface` fills that bounded parent with `h-full min-h-0` instead of the hardcoded `h-[calc(100vh-12rem)]`, so its size no longer depends on guessing the combined height of the header, page padding, page title, and (relay users only) the status bar.
- `100dvh` (not `100vh`) so the mobile address-bar collapse doesn't reintroduce the same off-by-a-bit overflow.

No other page uses `PageLayout` differently and no shared component changed, so this is contained to the chat page. No user-facing strings added.

## Checklist

- [x] This PR addresses a **single concern** (chat page viewport sizing).
- [x] Existing tests pass (`page.test.tsx`, `ChatInterface.test.tsx`); no layout-class assertions to update.
- [x] All user-facing strings are translated for every locale. _(No new strings.)_
- [x] No shared/core areas were refactored without prior agreement (change is confined to `app/ai/page.tsx` and the chat container class).
- [x] The branch is rebased on the latest `main`.
- [x] AI assistance is disclosed below, and I have reviewed and own the result.

## AI assistance disclosure

Diagnosed and fixed with Claude Code (traced the overflow to `min-h-screen` under the sticky `h-16` header). Reviewed and tested locally.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
