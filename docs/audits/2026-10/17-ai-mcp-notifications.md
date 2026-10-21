# S17 AI assistant, MCP tools, notifications, push

## 1. Metadata

| Field | Value |
| --- | --- |
| Session | S17 (child session_01111K7XW3AyLWdho7J2V8cV), parallel wave with S14 and S16 |
| `AUDIT_BASELINE_SHA` | `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86` |
| `git rev-parse HEAD` at start | `4e796dd7f8f01da49f36276ead7104a03e98f649` (pin check: `git diff --stat` against the baseline outside `docs/audits/` is empty) |
| Date | 2026-10-21 |
| Primary path | `backend/src/mcp/` |
| Hint line | `prioritize every AI tool implemented once on a domain service and adapted by both the executor and the MCP layer (a tool in one layer only is a finding), the compact LLM shape carrying every completeness flag, MCP scopes bound to the current token not the session, every write tool reaching the same refusals as the HTTP path (VOID, currency, ownership), prompt content as untrusted input, insight generation across replicas, push subscription lifecycle and the chart artifact TTL, and dispatch at-most-once` |
| Status | in-progress, remaining: lens groups 2-3, suites, sections 6-14 |

Runtime executed so far: Node 24.22.1, backend `npm ci` OK, PostgreSQL 16 in Docker. Probes P1 and P2 (section 7) in a scratch worktree at the baseline.

## 2. Invariant map

(in progress)

## 4. Confirmed findings

(in progress)
