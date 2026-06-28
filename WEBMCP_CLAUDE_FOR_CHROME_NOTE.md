# WebMCP findings — "Claude in Chrome" is org-gated; local relay works

> Draft note for `kenlasko/monize` — best posted as a comment on #646 (where the
> "Claude in Chrome" path was suggested). Paste manually.

Follow-up on the MCP/WebMCP direction. I prototyped exposing Monize's tools to an
in-browser AI agent via the W3C Web Model Context API (`navigator.modelContext`,
polyfilled by `@mcp-b/global`) — an opt-in toggle registers Monize tools that an
agent in the tab can call using the existing session, with **no backend exposed
externally** and using the agent's own subscription.

Two practical findings from testing in real conditions:

## 1. The official "Claude in Chrome" extension is gated by an enterprise allowlist
I could not use it against Monize: my organization's policy blocks my self-hosted
Monize URL in the extension, so Claude for Chrome never reaches the page's tools.
This makes "Claude in Chrome" unreliable as *the* WebMCP client — many users on
managed browsers will hit the same wall. Worth noting before betting the broker
-import / payee flows on it.

## 2. The local relay path works and avoids external exposure
The MCP-B browser extension + **desktop-agent-relay** (a localhost-only bridge,
docs.mcp-b.ai/tutorials/desktop-agent-relay) connects the page's WebMCP tools to a
local MCP client such as **Claude CLI / Claude Desktop**. Nothing is exposed to the
internet, and it uses a subscription rather than per-token API billing — which was
my main concern with the "expose Monize publicly + Claude in Chrome" flow.

Status: Monize already registers its WebMCP tools — the MCP-B extension detects the
site ("MCP monize" appears). One open issue I'm debugging: on the Monize tab the
extension sees the tools, but the Claude CLI relay does not yet list Monize as a
connected source (it does on the MCP-B demo pages). Prime suspect is Monize's strict
Content-Security-Policy (`connect-src 'self'`, nonce + `strict-dynamic` script-src)
blocking the page→relay bridge that the CSP-less demo pages allow. Will confirm via
the browser console and, if so, relax CSP just enough for the bridge behind the
opt-in.

Net: I'd treat the **local relay (CLI/Desktop)** as the primary WebMCP target and
"Claude in Chrome" as a nice-to-have, given the enterprise-allowlist limitation.
