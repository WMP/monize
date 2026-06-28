Quick progress update on this, now that it's approved-to-build.

I've implemented the relay end to end on a fork branch (`feat/ai-mcp-relay`), following the design above.

**Up front, to be clear:** I have not run or tested this yet — I don't actually know how it behaves at runtime. It's written and unit-tested, and it builds into images, but I haven't stood it up and driven a real agent through the loop. So far it only exists as these fork images:

```
ghcr.io/wmp/monize-backend:feat-ai-mcp-relay-cf53d77 (and :latest)
ghcr.io/wmp/monize-frontend:feat-ai-mcp-relay-cf53d77 (and :latest)
```

**Done (written + unit-tested, not yet functionally verified):**

- The two relay tools on the existing Streamable-HTTP MCP server: `get_next_prompt` (long-poll) and `post_response`. The agent loops get → work with the existing Monize tools → post, so the agent itself is the relay, no separate daemon.
- Backend broker (in-memory per-user queue), a browser SSE endpoint `/ai/relay/query/stream`, and `/ai/relay/status` driving the tunnel indicator.
- Attachments via signed, short-lived URLs (no base64 through MCP), built as a reusable module with pluggable storage — DB/BYTEA by default and a clear seam for local-file or S3 later, so it should line up with the storage plan in #687. Downloads are served with `nosniff` + a locked-down CSP and non-raster types forced to `attachment` to avoid stored XSS on the app origin.
- `mcpRelayEnabled` preference, Settings → AI toggle with an explanation, the 3-state tunnel dot (listening / working / offline) plus the copy-paste "how to connect" helper, and rich-paste capture (richest clipboard form kept as an attachment, plain text still goes in the box).
- i18n across all locales and unit tests for the relay service/tools, attachment signing/storage, and the new UI.

**Where it lives (key files):**

- Relay broker + browser endpoints: `backend/src/ai/relay/` — `ai-relay.service.ts` (in-memory per-user queue), `ai-relay.controller.ts` (`/ai/relay/query/stream` SSE + `/ai/relay/status`), `ai-relay.module.ts`, `dto/relay-query.dto.ts`.
- MCP relay tools: `backend/src/mcp/tools/relay.tool.ts` (`get_next_prompt` / `post_response`), registered in `mcp-server.service.ts` + `mcp.module.ts`, output schemas in `mcp/tool-output-schemas.ts`.
- Attachments (reusable, for #687): `backend/src/attachments/` — `entities/attachment.entity.ts` (polymorphic table), `storage/attachment-storage.ts` (provider interface + DB/BYTEA impl + factory), `attachment-signing.service.ts` (signed URLs), `attachments.service.ts`, `attachments.controller.ts` (upload), `attachment-download.controller.ts` (signed, XSS-hardened download); schema in `database/schema.sql` + migration `database/migrations/087_attachments.sql`.
- `mcpRelayEnabled` preference: `backend/src/users/entities/user-preference.entity.ts`, `dto/update-preferences.dto.ts`, `users.service.ts`, migration `086_user_preferences_mcp_relay.sql`.
- Frontend: Settings toggle `frontend/src/components/settings/ai/McpRelaySection.tsx` (wired in `app/settings/ai/page.tsx`); tunnel dot + connect helper `components/ai/RelayStatusBar.tsx`; rich paste `components/ai/useChatAttachments.ts` + `AttachmentChips.tsx`; chat wiring `components/ai/ChatInterface.tsx`; relay routing/status/upload in `lib/ai.ts` and `store/aiChatStore.ts`.
- i18n: `frontend/src/i18n/messages/*/ai.json` (`attachments`, `relay`) + `*/settings.json` (`aiSettings.mcpRelay`); backend `backend/src/i18n/locales/*/errors.json` (`ai.relayTimeout`).
- Tests: backend `ai/relay/*.spec.ts`, `mcp/tools/relay.tool.spec.ts`, `attachments/*.spec.ts`; frontend `components/ai/{RelayStatusBar,AttachmentChips,useChatAttachments}.test.tsx`, `components/settings/ai/McpRelaySection.test.tsx`.

Worth calling out separately: the attachments piece is a **preliminary, general-purpose module**, not chat-only. The table is polymorphic (`entity_type` / `entity_id`) and the storage layer is an interface with a DB/BYTEA implementation today plus explicit seams for local-file and S3. It's deliberately built so it can back the transaction attachments / receipt management in #687 — same table, same storage abstraction, just a different `entity_type`. Happy to split it out into its own PR first if that's more useful as the foundation for #687.

On your earlier question about public exposure: confirmed in code — Monize stays private; only the user's Claude client needs to reach it (e.g. on the home network). Per-user token auth, file-URL expiry, and the existing write-confirmation flow are all preserved.

**Next step:** stand up those images and drive a real Claude agent through the loop to verify the live browser → relay → agent → answer path. I'll report back once it's confirmed, then open a PR.

Flagging anything you'd want changed in the approach before I do the live verification.
