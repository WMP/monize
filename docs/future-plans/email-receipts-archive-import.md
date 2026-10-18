# Email receipts: importing archived emails

Status: approved by the owner in the session that wrote it; implemented by the
tasks in `email-receipts-archive-import-tasks.md`.

## 1. Why

The receipts mailbox reads only what arrives from now on (the first sync reads
a bounded window). Order confirmations from earlier years sit in the person's
own mailbox. Forwarding them in bulk loses the shop's identity: a forward made
through the Gmail API (Apps Script `GmailMessage.forward`) copies the body
without the "Forwarded message" header block, so the stored email is the
forwarder's (`from_domain = gmail.com`, no parser applies) and its date is the
day of the forward (the match window misses a purchase made years before).

An exported message file (`.eml`, or a `.mbox` holding many) carries the
original `From`, `Date` and `Message-ID`, so the email is stored as the shop
wrote it and the match window is centred on the purchase.

## 2. Scope

In:

- Upload of one or more files to the person's existing receipts mailbox, from
  the Mailbox tab: `.eml` (one RFC 5322 message) and `.mbox` (mboxo / mboxrd,
  the format Google Takeout, Thunderbird and Apple Mail write). A file with no
  extension whose first line starts with `From ` is read as mbox (Apple Mail
  exports a folder holding a file named `mbox`).
- A short guide in the same card: how to export from Gmail (Takeout, one
  message), Outlook, Apple Mail, Yahoo, Onet, WP, Interia, o2 (through
  Thunderbird and ImportExportTools NG for every IMAP provider).

- `.zip` (the Google Takeout download, or any archive of exported files): the
  entries named `.eml`, `.mbox`, `.mbx`, `.msg`, or extension-less mbox, are read
  as if uploaded one by one; other entries (Takeout's `archive_browser.html`,
  folders) are ignored and counted; a nested `.zip` is not followed. Read with
  `fflate` (no dependencies), approved by the owner.
- Outlook `.msg` (OLE compound file): read with `@kenjiuno/msgreader`, approved
  by the owner. The message is rebuilt as a minimal RFC 5322 source (the
  original transport headers when the file carries them, else From, Date,
  Subject and Message-ID from its properties; the plain body and, when present,
  the HTML body) and then goes through the same row builder as every other
  message.

Out (follow-ups, each its own agreement):

- `.pst`.
- Storing the uploaded file. Nothing is written to disk or an object store.

## 3. Decisions

1. **No migration.** Imported emails are rows of the person's existing mailbox
   (`mailbox_id`), with `uid_validity = 0` (`IMPORTED_UID_VALIDITY`). IMAP's
   UIDVALIDITY is a non-zero number (RFC 9051 `nz-number`), so an imported row
   can never collide with a polled one. The cursor
   (`email_receipt_mailboxes.uid_validity / last_uid`) is not touched.
2. **Stored once (INV-RECEIPT-002).** `uid` is the first 63 bits of SHA-256 of
   a dedupe key: `mid:<Message-ID, lower-case>` when the message has one, else
   `raw:<SHA-256 of its bytes>`. `ON CONFLICT DO NOTHING` (the
   IMAP key and the user's Message-ID index) makes a second import of the same message (the same file twice,
   or a Takeout `.mbox` and an `.eml` of one message) a duplicate, counted and
   not stored. The same message read by the poll has another `uid_validity`
   but the same Message-ID, so it is a duplicate too
   (`uq_email_receipts_user_message_id`); a message without a Message-ID is
   still a separate row.
3. **One row builder.** A file's messages go through the same code as the
   poll's: `extractMailText`, `resolveForwardedIdentity`, `pickReceivedAt`, the
   same column bounds and the same `skipped` rows (`too_large` above the poll's
   `maxMessageBytes`, `undecodable`). The fallback arrival time of an mbox
   message is the date on its `From ` separator line, else the upload time.
4. **Bounded.** Per request: at most 20 files, 25 MB each (multer limits, a
   translated 413), at most 26 MB in total, one file's worth (multer holds the files in memory:
   the backend refuses a declared `Content-Length` above it before multer
   reads the body, and the frontend's streaming route for this path,
   `LARGE_UPLOAD_ROUTES` in `frontend/src/lib/proxy-body-limit.ts`, cuts an
   undeclared body off at the same ceiling), at most 5,000 messages in total; a message beyond the cap is
   not read and the response says how many were left out. The mbox scan is
   linear, line-based, and builds no regular expression from input. A `.zip` is
   read entry by entry with a ceiling on what it may expand to: at most 2,000
   entries, 100 MB uncompressed in total per request, each entry no larger than
   the uploaded-file limit for mbox (100 MB) or the per-message limit for
   `.eml` / `.msg`. The ceiling counts the bytes the inflater actually
   produces, never only the size the archive declares, so a lying header cannot
   expand past it (`invalid_archive` / `archive_too_large`). Entry names are
   used only to choose the format; nothing is written to disk, so a path in a
   name reaches nothing.
5. **Processing.** The import stores the rows (one `withScopedDb` transaction per
   file) and then runs the stored-email part of a poll (pending, rematch, the
   automatic AI step) under the mailbox's poll lease (INV-RECEIPT-006),
   `processStoredNow`. When the lease is held the rows wait for the next poll or
   "Poll now"; the response says so. What one run does not reach is processed
   by later polls, as for polled mail.
6. **Access.** `POST /email-receipts/mailbox/import`, the mailbox controller's
   guards (JWT, owner only), throttled to 30 a minute (section 6). No mailbox is a 404
   (`errors.emailReceipts.mailboxNotFound`). The mailbox need not be enabled or
   reachable. The file content is untrusted, as an IMAP message is: it can only
   choose which approved parser reads the email and which days to look at
   (decision 12 of `email-receipts.md`).

## 4. Response

```ts
interface EmailReceiptImportResult {
  files: Array<{
    name: string;               // the uploaded file name, bounded
    format: 'eml' | 'mbox' | 'msg' | 'zip' | null; // null: refused
    messages: number;           // messages found in the file (in a zip: in all its entries)
    stored: number;             // new rows, `pending`
    duplicates: number;         // already imported
    skipped: number;            // stored as `skipped` (too large, undecodable)
    ignoredEntries: number;     // zip entries that are not mail files (0 otherwise)
    error: 'unsupported_format' | 'invalid_archive' | 'archive_too_large' | 'empty' | null;
  }>;
  truncated: number;            // messages not read because of the 5,000 cap
  processed: number;            // emails the run took through the pipeline
  busy: boolean;                // the poll lease was held; nothing was processed
}
```

## 5. Verification

- Unit: the mbox splitter (separator rules, mboxrd unescaping, CRLF, a file
  with no trailing newline, the message cap), format detection, the uid
  derivation (stable, positive, Message-ID normalised), the import service
  (duplicates, skipped rows, 404, busy lease, truncation), the controller
  (limits, the translated 413), the frontend card (upload, result, refusals,
  the guide).
- Integration is not required: no new query shape; the insert is the poll's.
- The fixture derived from a real Allegro email is masked (no real name,
  address, telephone or order number).

## 6. Splitting in the browser (follow-up)

A Google Takeout export of one label is easily larger than the request limits
(an observed `monize.mbox` was 117.7 MiB, its `.zip` 62 MiB). The person should
not need a script, so the browser plans the upload and the server's limits stay
as they are (decision 4).

1. **Upload planner** (`frontend/src/lib/email-import/`). The selected files are
   turned into a list of upload parts, then packed into requests: at most 20
   parts, 24 MiB and 5,000 messages per request, each part at most 24 MiB
   (one full part per request: Next.js hands the streaming route the body
   without backpressure, so the frontend buffers what the backend has not read
   yet, and a 99 MiB request OOM-killed a frontend pod limited to 300 MiB). The
   20-file pick limit goes away; one selection may hold up to 1 GiB in total.
2. **Large `.mbox`** (above 24 MiB): scanned in 4 MiB slices
   (`Blob.slice().arrayBuffer()`) for separators by the backend's rule (a line
   starting `From ` at the start of the file or after an empty line, LF or
   CRLF). A part is a `File.slice()` of whole messages, so nothing is copied. A
   single message above 24 MiB is not sent and is counted in the result.
3. **Large `.zip`** (above 24 MiB): read locally with `fflate`'s streaming
   `Unzip` (loaded by a dynamic `import()` only for this path). Mail entries
   become parts the same way (an mbox entry is split as it inflates, holding at
   most one part in memory); other entries are counted as ignored; a nested zip
   is not followed. A `.zip` up to 24 MiB, and every `.eml` / `.msg`, is sent as
   it is.
4. **Requests** go one after another; each response's per-file counts are
   summed under the original file name. A 429 waits and retries (the backend
   throttle becomes 30 a minute, still bounded per request by decision 4); any
   other failure stops the run and reports what was already imported. Every
   request is sent with `?process=false` (the server only stores the rows and
   answers `processed: 0, busy: false`), so one request never processes or counts
   rows of another request or of the rest of the mailbox. After the last request
   the browser processes the new emails with a run of `POST /email-receipts/process-batch`
   (`statuses: ['pending']`, 100 per call, `since` passed back until `remaining` is 0;
   a 429 waits and retries, a cancel stops between calls) and reports the sum of
   its `processed`, the `failed` and the `remaining` that were left.
5. **Progress**: "Sending part N of M" with a cancel button; a cancelled run
   keeps what was imported (the import is idempotent).
