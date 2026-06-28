## Linked discussion / issue

Approved in: https://github.com/kenlasko/monize/discussions/712 (labelled `approved-to-build`)

## Summary

Adds a **reverse MCP relay** so the in-app AI chat can run on the user's own Claude/ChatGPT subscription via their local MCP agent, instead of a server-side LLM provider. The chat enqueues a prompt; the user's agent long-polls it with the new `get_next_prompt` MCP tool, does the work with the existing Monize tools, and returns the answer with `post_response`. Monize never needs to be public — only the user's agent needs to reach it (e.g. on a home network).

**Read-only and text-only for now.** Queries, reports and investment data work end to end. Writes (`create_transaction`, etc.) are intentionally not enabled through the relay yet: the MCP write confirmation is an in-client elicitation, which has no one to answer it when the human is in the web chat. Moving that confirmation into the chat (typed, batchable cards reusing the #686 signed-action flow) is the agreed next step, discussed in #712.

What's included:
- **MCP relay tools** `get_next_prompt` / `post_response` on the existing Streamable-HTTP server, an in-memory per-user broker, a browser SSE endpoint, and a 3-state tunnel indicator (listening / working / offline) with a copy-paste "how to connect" helper (Claude CLI + Codex, with the `--allowedTools` / `default_tools_approval_mode` auto-approve step).
- **MCP Relay as a provider type** — selectable in the existing *Add AI Provider* flow with priority and a live connection state, per the direction in #712. LLM resolution skips it; the chat routes to the relay when it's the top-priority active provider.
- **Rich paste (client-only)** — pasting a table from a web page drops a readable Markdown table into the prompt instead of the browser's flattened plain text. No upload, no backend.
- i18n for every locale; unit tests for the relay service/tools and the HTML-to-Markdown util.

**Not in this PR:** file/image upload and the attachment storage module were split into a separate branch/PR at the maintainer's request (it's general-purpose and lays groundwork for #687). This relay PR no longer depends on it; the chat's rich paste is the only "paste rich content" path here, and it's inline-only.

Note: one unrelated, pre-existing test (`insights-aggregator.service.spec` "average monthly spending") is date-sensitive and fails independently of this PR; no insights files are touched here.

## Checklist

- [x] An approved discussion or issue exists and is linked above.
- [x] This PR addresses a **single concern** (the reverse MCP relay).
- [x] New behavior has tests, and the existing suite passes.
- [x] All user-facing strings are translated for **every** locale (i18n parity).
- [x] No shared/core areas were refactored without prior agreement (the "treat MCP Relay as just another provider" integration was requested by the maintainer in #712).
- [x] The branch is rebased on the latest `main`.
- [x] AI assistance is disclosed below, and I have reviewed and own the result.

## AI assistance disclosure

Developed with Claude Code as a pair-programming assistant (design, implementation, tests, and translations). I reviewed the changes, ran the suites locally, and own the result.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
