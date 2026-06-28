## Problem

The frontend's server-process logs are hard to work with in production (Docker / aggregated logs):

1. **No timestamps.** `frontend/src/lib/logger.ts` (`createLogger`) prefixes lines with only `[context]` and calls `console.info/warn/error(tag, ...args)`. There's no time on the line, so you can't tell *when* something happened or line it up against the backend (NestJS `Logger`, which does timestamp).

2. **Multi-line errors.** Errors are logged as `console.error(tag, error)` with the `Error` object, so the stack trace spans many lines. In Docker/log shippers each line becomes a separate record, which breaks grep and correlation (the message and its stack get split apart).

## Suggested direction

- **Prefix an ISO timestamp** (at least server-side), e.g. `2026-06-19T11:20:00.123Z [Context] ERROR: message`. Cheap and immediately useful.
- **Keep an error to one record.** Either serialize the `Error` (message + flattened/escaped stack) onto a single line, or emit structured JSON logs (`{ts, level, context, msg, stack}`) so a shipper keeps one event per error.
- Optionally **align the format with the backend** (timestamp + level + context) so frontend and backend logs read consistently.

## Notes

- Scope is the frontend logger + the Next.js standalone server console; browser-side console output matters less.
- Level is already configurable via `NEXT_PUBLIC_LOG_LEVEL`; this is about the *format*, not the levels.
