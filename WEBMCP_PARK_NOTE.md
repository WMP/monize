# WebMCP — parking this for now

Update on the WebMCP / `navigator.modelContext` exploration: I'm parking it for
the time being. It works at the page level — Monize registers its tools and the
MCP-B browser extension detects them — but getting from there to a usable agent
is currently more trouble than it's worth:

- The official **Claude for Chrome** extension is gated by an enterprise
  allowlist, which blocks a self-hosted Monize URL outright.
- The local **desktop-agent-relay** path detects the tools in the extension, but
  the page never registers as a relay "source" for the CLI/Desktop client
  (likely CSP / hidden-iframe bridge friction), and debugging the
  extension→relay→client layer is fiddly and underdocumented.

The ecosystem is still early (the W3C spec is in flux and the tooling/clients are
moving targets). I'd rather revisit once it stabilizes — e.g. native browser
support for `navigator.modelContext`, or a clearer relay/extension story — than
keep chasing a brittle setup now.

The prototype branch stays around for whenever it's worth picking back up.
