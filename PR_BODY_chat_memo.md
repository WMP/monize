## Linked discussion / issue

Bug fix: typing/deleting in the AI chat input lags.

## Summary

Editing the prompt in the AI chat (typing, and especially deleting) felt laggy once a conversation had a few messages.

**Root cause:** the `input` state lives in `ChatInterface`, the same component that renders the whole message list. Every keystroke calls `setInput`, re-rendering `ChatInterface` and — because `ChatMessage` was not memoized — re-rendering every message, which re-parses each one's markdown via `AssistantMarkdown` (react-markdown). The cost scales with conversation length, so the input box stutters.

**Fix:** wrap `ChatMessage` in `React.memo`. Its props are primitives or store-stable references (`msg.id`, `content`, `toolsUsed`, …) that don't change when only `input` does, so the default shallow comparison skips the re-render. Typing no longer re-parses the conversation's markdown.

One-line behavioral change, no API or markup change.

## Checklist

- [x] This PR addresses a **single concern** (chat input typing performance).
- [x] Existing tests pass (`ChatMessage.test.tsx`).
- [x] All user-facing strings are translated for every locale. _(No new strings.)_
- [x] No shared/core areas were refactored without prior agreement (memo wrapper on one component).
- [x] The branch is rebased on the latest `main`.
- [x] AI assistance is disclosed below, and I have reviewed and own the result.

## AI assistance disclosure

Diagnosed and fixed with Claude Code (traced the lag to unmemoized `ChatMessage` re-rendering on every keystroke). Reviewed and tested locally.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
