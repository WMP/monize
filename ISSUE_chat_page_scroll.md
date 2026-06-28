### Summary

The AI chat page (`/ai`) has a stray vertical page scrollbar: the page is slightly taller than the viewport and can be scrolled down by roughly the height of the app header. The chat already has its own internal scroll area, so this outer scroll is unwanted and makes the header drift out of view.

### Steps to reproduce

1. Open the AI assistant page (`/ai`).
2. Scroll the page (not the message list) with the mouse wheel or the browser scrollbar.
3. The whole page scrolls up by about the header's height, then stops.

Expected: the page fills the viewport exactly with no outer scrollbar; only the message list scrolls.

### Root cause

`frontend/src/components/ai/ChatInterface.tsx` sizes the chat with a hardcoded magic offset:

```tsx
<div className="flex flex-col h-[calc(100vh-12rem)]">
```

`12rem` (192px) is meant to account for everything above/around the chat, but the real chrome doesn't add up to exactly that:

- the global header rendered by `PageLayout`,
- the `<main className="... pt-6 pb-8">` padding (3.5rem) in `src/app/ai/page.tsx`,
- the `PageHeader` (title + subtitle, variable height),
- and the `RelayStatusBar` when relay mode is enabled (adds height only for some users).

When the sum exceeds 12rem, `100vh - 12rem` is too tall and the page overflows the viewport by the difference — producing the page-level scrollbar. Because the offset is fixed, it can't be right across header sizes, locales (longer subtitles wrap), relay-on vs relay-off, and zoom levels.

### Suggested fix

Drop the magic number and let the chat fill the remaining space via flexbox instead of guessing the offset:

- Make the page/content a full-height flex column and give the chat container `flex-1 min-h-0` (the `min-h-0` is required so the inner `overflow-y-auto` message list can shrink and scroll), rather than `h-[calc(100vh-12rem)]`.
- While here, consider `100dvh` over `100vh` for the outer height: on mobile browsers `100vh` includes the collapsing address bar and is a common source of the same off-by-a-bit overflow.

This keeps the chat sized correctly regardless of header height, locale, or whether the relay status bar is shown.

### Environment

- Affected route: `/ai`
- File: `frontend/src/components/ai/ChatInterface.tsx:112`
- Reproduced on desktop; the `100vh` aspect likely also affects mobile.
