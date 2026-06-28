## Linked discussion / issue

Approved in: https://github.com/kenlasko/monize/discussions/712 (the maintainer asked, in the MCP-relay review, to split this module out into its own branch/PR)
Lays groundwork for: #687 (transaction attachments / receipts)

## Summary

A standalone, general-purpose **attachments module**, split out of the MCP-relay PR (#712) at the maintainer's request so it can be reviewed on its own and serve as the foundation for transaction attachments / receipt management (#687).

- **Polymorphic table** (`entity_type` / `entity_id`) so one table can back different owners (AI chat today, transactions later) without a schema change.
- **Pluggable storage**: Postgres BYTEA by default (mirroring how institution logos are stored), behind an `AttachmentStorageProvider` interface + factory with explicit seams for local-file and S3 — matching the "DB first, maybe local/S3 later" direction from #687.
- **Upload** via base64 JSON (no multipart dependency; the global 10 MB body limit caps size), with MIME-type and size validation and filename sanitisation.
- **Download** via short-lived **HMAC-signed URLs** so a client can fetch a file without a bearer-authenticated request. Hardened against stored XSS on the app origin: `X-Content-Type-Options: nosniff`, a locked-down `Content-Security-Policy` (`default-src 'none'; sandbox`), and non-raster types forced to `Content-Disposition: attachment` (only known raster images render inline).
- Schema + migration `087_attachments.sql`; registered in `app.module`.
- Tests for the entity/service/storage/signing/download (incl. the XSS-hardening headers).

No frontend in this PR — it's the backend storage layer. (The relay PR consumes a similar capability; the chat's file-upload UI will be wired on top once this lands.)

## Checklist

- [x] An approved discussion or issue exists and is linked above.
- [x] This PR addresses a **single concern** (a reusable attachment storage module).
- [x] New behavior has tests, and the existing suite passes.
- [x] All user-facing strings are translated for **every** locale (i18n parity) — no new user-facing strings in this PR.
- [x] No shared/core areas were refactored without prior agreement (additive module; only registers itself in app.module and adds a table).
- [x] The branch is rebased on the latest `main`.
- [x] AI assistance is disclosed below, and I have reviewed and own the result.

## AI assistance disclosure

Developed with Claude Code as a pair-programming assistant (design, implementation, tests). I reviewed the changes, ran the suite locally, and own the result.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
