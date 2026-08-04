# Backup and restore contract

What a Monize backup promises, what it deliberately does not, and where the
boundaries are. Written because these guarantees were spread across five files
and a set of assumptions, and the gaps between them were where the defects lived:
an audit found a backup that could not be restored, attachments that came back
pointing at nothing, and a de-identified artifact carrying a user's name.

Read this before changing anything under `backend/src/backup/`.

For what was done about each audit finding that produced these rules -- including
the one deliberately left open -- see `docs/audit-phase-3-response.md`.

## 1. What travels in a backup

Everything the export produces, in one gzipped JSON document with a
`version`/`exportedAt` envelope. Coverage is not a judgement call: the guard test
in `backend/test/integration/backup-restore.integration.spec.ts` fails unless
every live table is either exported or named in
`INTENTIONALLY_EXCLUDED_TABLES` with a reason.

**Included and complete:**

- Every user-owned table in `RESTORE_PLAN` (`backend/src/backup/restore-plan.ts`).
- Attachment **metadata** for every provider.
- Attachment **bytes** only for the `database` provider, base64-encoded in
  `attachment_blobs`. See section 4.
- Every currency definition the user's data references, whoever created it —
  not just the ones they created. Currencies are shared, and a code without its
  definition means the restore invents a name, symbol and decimal places.

**Deliberately excluded**, each for a stated reason in
`INTENTIONALLY_EXCLUDED_TABLES`: the `users` row itself, credentials and sessions,
the undo log, regenerable AI caches, global `exchange_rates`, cross-user sharing
and emergency-access configuration, and import working state.

### The export is one snapshot

Every table is read inside a single `REPEATABLE READ` transaction
(`inExportSnapshot`). This is not an optimisation. With a transaction per table,
a backup taken while the user was active could contain a transaction whose
account was created after the `accounts` query ran — a file that verifies, gzips
correctly, and fails on restore with a foreign-key violation. READ COMMITTED is
not sufficient even as a single transaction: it takes a fresh snapshot per
statement.

The cost is one pooled connection and a held `xmin` for the duration — for the
streaming export, the duration of the download. That is the price of a backup
that restores.

## 2. Ordering is data, not a sequence of calls

`restore-plan.ts` declares three things:

- `RESTORE_PLAN` — the insertion order, and whether `user_id` is forced.
- `DEFERRED_FK_COLUMNS` — columns stripped on insert because they point forward
  or at the row's own table.
- `DEFERRED_FK_REPAIRS` — the Phase-3 `UPDATE`s that put them back.

`restore-plan.spec.ts` parses every foreign key out of `database/schema.sql` and
proves no restored table references a table inserted later, or itself, unless the
column is stripped and repaired. It also fails on a deferred column that names no
real FK (a rename), a strip with no repair (a silently dropped link), and a repair
with no strip.

**A migration that adds a foreign key between two backed-up tables must keep that
test green.** `accounts.linked_loan_account_id` is why the test exists: a
self-referential FK from migration 093 that nobody added to the deferred list, so
every user who linked a property to its mortgage held a valid backup that could
not be restored — and nothing said so until the restore ran.

## 3. Rejection happens before the destruction

A restore deletes everything the user owns and then inserts the backup, in one
transaction. Everything that can refuse the request must refuse it before the
delete:

- credential/step-up verification (section 5);
- decryption;
- decompression, under a hard expanded-size ceiling (section 6);
- version and envelope validation;
- **staging of external attachment objects** (section 4).

Any SQL or foreign-key error rolls the whole transaction back. The one effect
that is not transactional is the object store; that is what makes staging-first
necessary rather than merely tidy.

## 4. Attachments: the bytes travel

**A backup that cannot restore an attachment is not a backup of it.** That
sentence took four attempts to arrive at, and it is the whole of this section.

For the `database` provider the bytes were always in the artifact, base64 in
`attachment_blobs`. For `local` and `s3` they were not: the artifact carried
metadata, and the operator was told to restore the sidecar volume or bucket
alongside it. Every problem below follows from that split, and the fix is to end
it — **the export now reads every external object and carries it in
`attachment_blobs` too** (`appendExternalAttachmentBytes`), for all three export
paths.

That makes the artifact self-sufficient, which has three consequences:

- **Recovery works where it has to.** A fresh instance, and an account whose
  attachment metadata was deleted, both restore. Under the previous design neither
  could: the restore has to prove the caller may read an object before reading it,
  the only available proof was a current `transaction_attachments` row, and in both
  those cases there is no such row. So the two situations backups exist for were
  precisely the two that returned success with the attachments counted as skipped.
- **No authority question arises.** The bytes are inside a file the user
  downloaded, so there is nothing to authorize. This is what the rest of this
  section spent two rounds failing to achieve with checks on uploaded fields.
- **The provider is the target's decision.** A backup taken under `local` restores
  onto a `database` deployment and vice versa; the bytes land wherever this runtime
  keeps them and `storage_provider` is rewritten to match. Both directions used to
  be an unrestorable skip.

What it costs, stated plainly: artifacts are larger, and this method accumulates
every carried object in memory before serialising. The encrypted, automatic and
support paths assemble in memory anyway, so a large attachment set meets
`BACKUP_EXPORT_BUFFER_LIMIT` and is refused with an error naming the ceiling. **The
plain export is not exempt** — it was billed as the streaming path, but it
materialises each table and every carried attachment too, and it has no ceiling, so
a large attachment set can exceed the pod there. Bounding it is the cursor work
below (§6, still open).

**An omitted or inconsistent object does not silently pass as a complete backup
(F3R7-001).** An object the store cannot produce is logged and omitted — the ledger
is the point, and one unreadable receipt must not cost the user the whole file — but
the artifact is then **incomplete**, and the export says so. Every buffered export
returns a `BackupCompletenessReport`: how many attachment rows were expected, how
many had their bytes, how many were missing or (for the database provider,
`assessAttachmentCompleteness`) inconsistent with their metadata. The auto-backup
path acts on it — a partial artifact is written so the ledger is captured, but it is
**never promoted to weekly/monthly and never used for retention**, so it cannot
displace or age out a complete copy, and its status is `partial`, not `success`. A
later complete backup resumes normal promotion and retention. This is the invariant
that a backup shown as successful is one that restores in full.

**A `sha256` and a `byte_size` are checked against the carried bytes**, at both
ends. At export, the store is compared against the database (`storedBytesMatchMetadata`),
so a source object that was truncated or replaced is caught before it is packaged.
At restore, the carried bytes are compared against their own metadata
(`carriedBytesMatchMetadata`) — same file both sides, so that proves consistency
rather than authority, catching a corrupt or truncated artifact.

### The legacy path, and why it is still ownership-gated

An artifact produced before the above carries no external bytes. For those, the
restore still reads the source object from the store, and everything below applies:
the read is gated on the restoring user currently owning a matching row. Nothing
here is dead code — it is what an older file gets — but it is no longer the path a
new backup takes, and the disaster-recovery cases it cannot serve are the reason the
bytes now travel.

`storage_key` equals the attachment's UUID, and a restore mints a fresh UUID for
every row. Two obvious approaches are both wrong:

- **Remap the key and stop there** (what the code did): metadata points at
  `<new-uuid>` while the object is still at `<old-uuid>`. Every externally stored
  attachment is unreachable after a restore that reported success, and restoring
  the sidecar directory byte-for-byte does not help, because the mismatch is in
  the database.
- **Preserve the old key**: the bytes are not in the backup, so restoring into a
  different user on the same instance hands that user working links to files whose
  contents they were never sent.

So the bytes are **copied**. Before the destructive delete, each external object
is read at its old key, checked against the byte size and SHA-256 the metadata
claims, and written under the new key. The new keys are recorded so a failed
database transaction can remove them again. Old-key objects are left alone: the
same backup may be restored more than once.

**Both keys are derived, never read from the file.** The destination is the
remapped attachment id; the source is the id the backup was written with. The
uploaded `storage_key` is overwritten with the derived value before the insert and
is otherwise ignored, for every provider.

**And the right to read a source object comes from the database, not the file.**
Before any external object is opened, the restoring user must currently own an
attachment with that original id, on the configured provider, whose stored byte
size and SHA-256 equal the ones the uploaded row publishes — read from
`transaction_attachments`, which is still intact because staging runs before the
destructive delete. Integrity is then checked against the *stored* values, so an
object that changed under the row since is caught too. A row that fails any of
this is unrestorable: dropped and counted, with no read attempted.

This is a confidentiality boundary, not tidiness, and it has been got wrong twice
— the second time as the fix for the first:

1. The destination came from `row.storage_key`, and a key the restore did not
   recognise as a remapped id was treated as legacy or operator-chosen: skip the
   load, skip the checksum, skip the copy, on the reasoning that the object already
   sat where the metadata pointed. A crafted backup could therefore name *any*
   syntactically valid key — including one belonging to another tenant — and the row
   was inserted under the uploader's `user_id` without a byte being read.
   Downloading their own metadata returned somebody else's receipt.
2. So both keys were derived from the identifier remap instead, with "a row whose
   id is not in the remap did not come from this backup's graph" as the boundary.
   But the graph is the *uploaded* graph: `collectRowIdRemap` admits every
   UUID-shaped `row.id` in the file, so for a well-formed crafted row that guard
   could not fire. Put the victim's attachment id in `transaction_attachments.id`,
   with the byte size and hash a standard backup publishes beside it, and the
   restore read their object and copied it under the attacker's ownership. The
   uploaded document was authorizing itself.

`assertSafeStorageKey` establishes that a key is a safe *string*; nothing there
establishes that an object is *theirs*. Which field to trust was never the
question: **no unsigned value from the uploaded file can establish ownership — not
a key, not an id, not a checksum, not a byte count. Only a record the server
already holds can.**

The consequence is deliberate and matches what this section already concluded
about preserving the old key: restoring one user's backup into a **different** user
on the same instance skips external attachments rather than disclosing them, and a
fresh instance skips them because the objects are not there. Those attachments show
up in `skippedAttachments`, so the user is told.

An object that cannot be staged — missing, failing its checksum, or written by a
different provider — makes that attachment unrestorable. Refusing the whole
restore over a receipt image is the wrong trade, so the metadata row is dropped
and counted. **The count is reported as `skippedAttachments`, beside `restored`
and never inside it**: the client sums `restored`'s values into a row total, and
rows deliberately not written must not be counted as written.

**The objects the restore displaced are deleted after it commits.** A destructive
restore removes every `transaction_attachments` row the user had, and for `local`
and `s3` the bytes are not in those rows — so they used to stay in the volume or
the bucket forever, referenced by nothing. A receipt or a medical document survived
the replacement of the account it belonged to, remained in whatever backs that
storage up, and could never be found again because the metadata naming it was gone.

The timing and the scope are both load-bearing:

- **After the commit**, because bytes deleted before a transaction that then rolls
  back leave a row promising a download that does not exist — indistinguishable
  from a working attachment. Same rule as `AttachmentsService.remove`.
- **Only keys the target user held**, read before the delete because afterwards
  there is nothing to read them from. Never the old keys named by the uploaded file
  — for the legacy path, those are the source objects it reads, and the same file
  may be restored twice. (The original wording here said a cross-user restore
  "legitimately reads another user's objects as its source". That has not been true
  since the ownership rule above: such a read is now refused. The rule stands for
  the reason that survived, which is repeat restore.)
- **Never a key the restore just staged.** Restoring a backup taken from the same
  account re-uses ids, so a displaced key and a newly written key can be the same
  string.
- **Never a key the backup reads as its source.** A backup taken from this account
  names the keys this account currently holds, so its source objects *are* its
  displaced objects. Deleting them left the artifact naming bytes that no longer
  existed: the first restore worked, and a second restore of the same file skipped
  every attachment and then deleted the copy the first restore had made — losing
  the content entirely while still reporting success.

  When a key is both an orphan and a source, **the source wins**. That knowingly
  keeps an object nothing in the database references, which is what this cleanup
  exists to remove — and it is the right way round: an orphaned copy of the user's
  own receipt costs storage, while a backup that can only be restored once costs
  the receipt.

Operationally: for an artifact that carries its own bytes there is nothing to
restore alongside it — that is the point. The sidecar directory or bucket only
matters for an artifact produced before the bytes travelled, and for those it must
be restored **before or alongside** the database *and* the target must still hold
the attachment metadata. If it does not — a fresh instance, a deleted attachment —
those bytes are not recoverable from that artifact at all, whatever order they are
restored in, and the restore reports them in `skippedAttachments`. Take a fresh
backup to get a self-contained one.

**`storage_key` is attacker-chosen input.** It is a column, and a restore writes
it from the uploaded file, so by the time a provider sees it the key may be
anything. Every provider therefore addresses objects through
`assertSafeStorageKey` (`attachments/storage/storage-key.util.ts`), whose
allowlist excludes `.` and `/` so neither a traversal segment nor a separator can
be expressed. The S3 provider lacked this while the local one had it, which made
a crafted key address arbitrary objects in the bucket -- an S3 prefix is a naming
convention, not a boundary. `storage-key.util.spec.ts` asserts every provider in
the module routes its key through the validator, and names the database
provider's exemption (a parameterised primary-key lookup) rather than assuming
it.

## 5. Confirming a destructive restore — known gap

A restore requires the user's password (local accounts, bcrypt-checked). For OIDC
accounts it requires `x-restore-oidc-token`, and **`verifyAuthentication` checks
only that the value is truthy.** `x-restore-oidc-token: x` passes. The header is
documentation, not a control, so anything holding a live OIDC session can erase
and replace a user's entire financial history with no barrier.

This is a known open defect (audit P3-009), not a design decision.

The repository already contains the right mechanism, used by emergency access:

- `STEP_UP_PURPOSES` in `backend/src/auth/step-up/dto/verify-step-up.dto.ts`
- `@RequireStepUp(purpose)` + `StepUpGuard` — JWT-signed, purpose-scoped,
  expiring, with attempt lockout
- `StepUpAuthModal` and `useStepUpTokenStore` on the frontend, which already
  handle local password, TOTP, and the OIDC redirect

The fix is therefore small and should reuse that mechanism rather than invent a
second one:

1. Add `"backup-restore"` to `STEP_UP_PURPOSES`.
2. Put `@UseGuards(StepUpGuard)` and `@RequireStepUp("backup-restore")` on the
   restore handler.
3. Delete the `oidcIdToken` branch from `verifyAuthentication`.
4. Open `StepUpAuthModal` in `BackupRestoreSection` before restoring and send the
   resulting token as `x-step-up-token`.

Note when doing it: the step-up mechanism's own OIDC branch is also a
session-based soft check (`oidcConfirmed`), so this makes the proof signed,
expiring and action-scoped without making it a *fresh* identity-provider
authentication. Closing that remaining half needs a real step-up transaction
(`prompt=login`, `max_age=0`, an `auth_time` freshness check) and a browser round
trip that survives having a large file selected. Account deletion shares the same
sentinel and should be converted in the same change.

Steps 1–4 change the restore path for every user, so they need exercising in a
browser: the failure mode is "the user cannot restore their backup".

## 6. Size ceilings

Three, for three different failure modes. All configurable, all fail loudly.

| Setting | Bounds | Default |
|---|---|---|
| `BACKUP_RESTORE_LIMIT` | the compressed upload | the half-share peak divided by `PEAK_MULTIPLE` (~a sixth), no floor |
| `BACKUP_RESTORE_EXPANDED_LIMIT` | the **decompressed** payload | a quarter of the container's memory limit |
| `BACKUP_EXPORT_BUFFER_LIMIT` | JSON a buffered export may accumulate | a quarter of the container's memory limit |

The expanded and buffered defaults are cgroup-derived with a 64 MiB usability
floor, a 1024 MiB cap and a 256 MiB fallback when there is no limit to read. There
are no fixed byte defaults left; the `1024mb` and `512mb` this table used to name
were the numbers that could not fire.

**The upload default has no floor, and that is deliberate (F3R6-005).** A usability
minimum and a safety maximum are different quantities: `max(64 MiB, safe)` let the
floor win, so on a 128 MiB pod it returned 64 MiB whose modeled peak (192 MiB)
exceeded the whole container. The safety bound is the only bound —
`resolvedLimit * PEAK_MULTIPLE <= container * share` for every container size — so a
small pod derives a small, safe upload limit and `warnIfRestoreUploadLimitIsCramped`
says so at startup rather than flooring into a number the pod cannot survive.

The compressed limit bounds nothing about what comes out of gzip: a few hundred
kilobytes of repeated text expands to gigabytes. Decompression is asynchronous
(libuv threadpool) with `maxOutputLength`, so a hostile payload neither allocates
past the ceiling nor blocks the event loop. `JSON.parse` still needs a whole
document — unavoidably — but it now gets a string of bounded length.

The buffered ceiling exists because three paths cannot stream: AES-GCM needs the
whole plaintext for its auth tag, and the support export holds every table at
once to reconcile scaled balances. The plain HTTP export streams and is
deliberately unbounded.

**Every default is derived from the container's cgroup memory limit**, not fixed.
A ceiling larger than the process it protects cannot fire — the pod is killed
first — and all three used to be exactly that on the chart's 400 MiB backend.

**And the wire bytes are not the cost.** The upload limit was half the container on
the reasoning that a compressed upload is one buffer, unlike the several a buffered
export holds. That was wrong about what happens next: the request goes on to hold
the envelope, `decipher.update`'s output, `Buffer.concat`'s result, the decompressed
payload, the UTF-8 string and the parsed object graph, several of them at once. Half
of 400 MiB on the wire is `PEAK_MULTIPLE` times that at peak, so a *single* legal
request could not fit the pod it was sized for. So the **peak** gets the half share
and the wire gets that divided by `PEAK_MULTIPLE` — one constant, two numbers, and
the aggregate admission budget below is the same half share, so exactly one
full-size restore runs at a time.

`PEAK_MULTIPLE = 3` is a floor, not a measurement: the real multiple depends on
Node's version, the payload's entropy and the object graph's shape. Measuring it
wants the cgroup peak-RSS test that has never run here.

An operator's explicit value always wins, and one too large for the container is
warned about at startup — against the same share the default came from, in the same
units they set, so the derived default never warns about itself and the figure the
warning suggests is one they can paste back.

**The upload limit is the earliest one and therefore the only one that matters for
an oversized request.** `express.raw` buffers the whole body before the controller,
the guards, the authentication lookup, the decryption and every service ceiling, so
a request none of those layers ever sees can still kill the process.

**A per-request ceiling bounds one request, and the process has to survive two.**
The JWT guard and the `ThrottlerGuard` are both Nest guards, so neither runs until
after `express.raw` has buffered the body — nothing downstream can refuse an
allocation that already happened. `createRestoreUploadAdmission`
(`backend/src/backup/restore-upload-admission.ts`) therefore runs as Express
middleware **ahead of** the parser and keeps a process-wide total of the peak bytes
it has promised. Three properties, each of which was wrong once:

- **The claim is the peak, not the wire.** The first version reserved the declared
  `Content-Length`, which counts the smallest of the buffers a restore holds. Three
  60 MiB encrypted uploads declared 180 MiB, fitted a 200 MiB budget, and could pass
  540 MiB in flight. A request now claims `PEAK_MULTIPLE` times its wire bytes.
- **A reservation is held until the work is done, not until the socket shuts.**
  `ServerResponse` emits `close` when the connection ends, which is not the handler
  finishing. Releasing on `close` let a client upload a full body, let the controller
  enter `restoreData`, then hang up — freeing the reservation while the decryption,
  the staging and the SQL were still running, so a second large upload was admitted
  beside the first. The reservation now has a lifecycle: while *receiving*, a `close`
  releases it (nothing downstream took ownership); once the body has arrived, only
  the handler's `finally` (`releaseRestoreReservation`) or a completed response does.
- **A body that never arrives is reclaimed.** The gate necessarily runs before
  authentication, and a chunked request declares no length, so it reserves the whole
  ceiling. Without a deadline an unauthenticated client could trickle or withhold the
  body and hold the recovery path closed for as long as the socket survived — during
  exactly the incident a restore is for. A body that has not arrived inside
  `DEFAULT_RECEIVE_TIMEOUT_MS` gets a 408 and its socket destroyed. The deadline is
  armed only while receiving: a timeout on *processing* would be the
  release-too-early defect with a delay.

What is still not fixed: an unauthenticated client can occupy the budget for that
bounded interval, so it can make a legitimate caller retry. Remaining options, none
implemented, in rough order of preference: a smaller body limit at the ingress ahead
of the process, a two-step restore session that issues a short-lived upload token
after authorization, and streaming the upload through decryption and gzip into a
bounded temporary file or an incremental parser instead of the JavaScript heap. The
last of those is also what would replace `PEAK_MULTIPLE` with a real bound.

**The compressed budget does not bound decompressed memory (F3R6-004).** A small
gzip expands to the `BACKUP_RESTORE_EXPANDED_LIMIT` ceiling regardless of its wire
size, so a request's *processing* peak — decompressed payload, string, parsed graph
— is independent of the compressed bytes the upload gate reserved against. Four
1 MiB uploads that each expand to the ~100 MiB expanded limit pass upload admission
on their small claims and then hold ~400 MiB between them. So restore *processing*
is capped separately: `restoreProcessingGate`
(`backend/src/backup/restore-processing-gate.ts`) admits only as many concurrent
restores as fit the container. The service acquires a slot before decompression and
releases it in a `finally`, and on the default pod the count is one — a second
restore waits rather than decompressing beside the first.

The slot count budgets against the numbers that actually cost (F3R7-002): each
restore's peak is `PEAK_MULTIPLE` × the **resolved** `BACKUP_RESTORE_EXPANDED_LIMIT`
`gunzip` enforces — so an operator override is accounted for, where the earlier
version modeled every restore at the derived default and admitted five 2 GiB
restores on a 16 GiB pod — and the ordinary process baseline
(`restoreProcessBaselineBytes`) is subtracted before dividing. When one modeled
restore does not fit at all, the count is `0`: the gate still floors capacity at
one, because a running process must be able to attempt a restore, but startup warns
that a restore may exceed memory and names the levers (raise the container limit, or
lower `BACKUP_RESTORE_EXPANDED_LIMIT`). The cap is robust to `PEAK_MULTIPLE` being an
estimate — serialising to one is safe under any true multiple *as long as one
restore fits*, which is exactly the condition the warning surfaces when it does not.
The baseline and the multiple are both estimates, not measurements; settling them
needs the cgroup peak-RSS test that has never run here.

**A budget checked after the allocation is not a budget.** The support export
always discards `attachment_blobs`, which is base64 — thirty 10 MiB receipts are
~400 MiB of text — and `collectRawExport` loaded it anyway before any ceiling was
consulted. It now takes a `skipTables` set, and a test asserts the support path
passes `ALWAYS_EXCLUDED_TABLES` — and, since attachment bytes now travel, that the
augmentation does not read a single object off disk for a table the caller is going
to discard either.

**Not fixed, and now triply load-bearing (F3R6-001):** large tables are still read
whole through `manager.query` rather than a cursor, so one enormous table is bounded
only by the ceiling that follows it; `attachment_blobs` accumulates every attachment
before that ceiling is consulted; and the **plain HTTP export**, described above as
the streaming path, materialises each table (and every carried attachment) in full
before writing it, so it is no longer the unbounded-safe path it was billed as. The
encrypted, automatic and support paths at least *refuse* an over-large set with the
error naming `BACKUP_EXPORT_BUFFER_LIMIT`; the plain path has no ceiling and can
exceed the pod outright. A cursor inside the repeatable-read snapshot that
serialises rows and base64-encodes one attachment at a time, under a per-chunk
budget, is what fixes all three — the same work that would let the encrypted path
stream through an authenticated container format instead of a monolithic AES-GCM
buffer, and the same work that would replace `PEAK_MULTIPLE` with a measured bound
on the restore side. It is the single highest-value open item in this document, and
the reason attachment bytes travelling (§4) currently trades a recoverability fix
for a memory cost that only streaming repays.

## 7. Automatic backups on disk

- **Per-user directory.** Each user's artifacts go in a server-computed
  subdirectory of the root, named by their user id. Filenames carry only
  frequency and date, so isolation has to come from the path — and retention only
  ever enumerates one user's directory. Files sitting directly in a root predate
  this, carry no owner in their names, and are left exactly where they are.
- **Crash-atomic writes.** Temp file in the same directory, `fsync`, atomic
  rename, `fsync` the directory. A final filename never refers to a partial file,
  and a failed write leaves the previous artifact intact. Stale temp files are
  swept separately from retention, because a partial write is not a backup and
  counting one would silently shorten the retention window.
- **Confined destinations.** `BACKUP_ALLOWED_ROOTS` (defaulting to
  `BACKUP_CONTAINER_DIR`) bounds every user-influenced path, canonically — a
  symlink inside a permitted directory cannot lead out of one.

On Kubernetes this needs `backend.persistence.backups.enabled` (see
`helm/README.md`). With a read-only root filesystem and no mount, a schedule
reports errors forever while the UI shows it as configured.

## 8. Cross-version and cross-instance limits

Known and unresolved; none of these is a bug report waiting to be filed:

- **Format version is strict equality.** Only `1` is accepted, rejected before
  any deletion. There is no compatibility window and no offline upgrader; define
  one before incrementing.
- **`ai_provider_configs.api_key_enc` is instance-key ciphertext.** It is exported
  and restored verbatim, so a restore onto an instance with a different
  `AI_ENCRYPTION_KEY` leaves provider configs present and unusable. Re-entering
  the key is the only recovery.
- **Delegation is reset.** `account_delegates`, `account_delegate_grants` and
  `delegate_account_favourites` are excluded by design, and cascade away when
  accounts are deleted. A restore therefore removes existing grants and
  favourites. Whether that security reset is the intended product behaviour is
  undecided.
- **`ON CONFLICT DO NOTHING` counts optimistically.** `insertRows` increments its
  counter per attempted row, not per affected row, and there is no post-restore
  cardinality or closure check. UUID remapping removes ordinary primary-key
  collisions, but a natural or composite-key conflict would be reported as
  restored.

## 9. The support (de-identified) backup

`docs/support-backup.md` is authoritative. Two things belong here because they are
restore contract, not privacy policy:

- A support backup restores through the same path as any other and is logged as
  such. Its amounts are scaled by a hidden factor, so scaled balances must not
  later be mistaken for corruption.
- Custom currency codes are pseudonymised, and every reference is rewritten
  through `CURRENCY_REFERENCE_COLUMNS`. A reference left behind is a foreign-key
  violation, which would make the artifact de-identified *and* useless.
- `currencies.created_by_user_id` is rewritten to the exporting user before the
  identifier remap. The row has no `id` column, so the row-id sweep that remaps
  every other identifier never sees it — and since the export includes every code
  the user's data references whoever defined it, the column can hold another
  user's real UUID. Two support files from two users of one instance would then be
  correlatable by the creator id they share, which is the one thing the remap
  exists to prevent.
