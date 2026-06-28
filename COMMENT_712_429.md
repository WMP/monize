On the 429 you hit when reconnecting — I traced it, and it's your per-user session cap (not throttling). In `mcp-http.controller.ts`: `MAX_SESSIONS_PER_USER = 10`, and sessions are only dropped on an explicit DELETE or after the 1-hour `SESSION_TTL_MS`. A relay reconnect (restarting Claude) opens a *new* session id without releasing the old one, so the stale sessions pile up; after ~10 reconnects within the hour, the next new-session request gets `429 Too many active sessions`.

This is your security hardening (from "Fix 11 medium-priority security issues"), so I didn't want to touch it in the relay PR. Two options, both keeping the cap intact:

1. **Rotate instead of reject (LRU):** when a new session would exceed the cap, evict that user's *oldest* session and admit the new one. Reconnect just works, memory is still bounded at 10.
2. **Idle-based reaping:** track `lastSeen` per session and reap idle ones sooner (e.g. 20–30 min) on top of the 1-hour absolute TTL. A live relay agent long-polls every ~25s so it keeps a fresh `lastSeen` and is never reaped; only abandoned sessions get cleaned up.

I'd do both (rotate + idle reaping) — it removes the reconnect 429 without loosening the limit. Happy to put it up as a separate small PR against `mcp-http.controller.ts` so it's reviewed as a change to your security area, rather than bundling it into the relay PR. Want me to?
