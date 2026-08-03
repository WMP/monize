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

## 4. Attachments: bytes live outside the database

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

An object that cannot be staged — missing, failing its checksum, or written by a
different provider — makes that attachment unrestorable. Refusing the whole
restore over a receipt image is the wrong trade, so the metadata row is dropped
and counted. **The count is reported as `skippedAttachments`, beside `restored`
and never inside it**: the client sums `restored`'s values into a row total, and
rows deliberately not written must not be counted as written.

Operationally: the sidecar directory or bucket must be restored **before or
alongside** the database, not after.

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

Two, for two different failure modes. Both configurable, both fail loudly.

| Setting | Bounds | Default |
|---|---|---|
| `BACKUP_RESTORE_LIMIT` | the compressed upload | `500mb` |
| `BACKUP_RESTORE_EXPANDED_LIMIT` | the **decompressed** payload | `1024mb` |
| `BACKUP_EXPORT_BUFFER_LIMIT` | JSON a buffered export may accumulate | `512mb` |

The compressed limit bounds nothing about what comes out of gzip: a few hundred
kilobytes of repeated text expands to gigabytes. Decompression is asynchronous
(libuv threadpool) with `maxOutputLength`, so a hostile payload neither allocates
past the ceiling nor blocks the event loop. `JSON.parse` still needs a whole
document — unavoidably — but it now gets a string of bounded length.

The buffered ceiling exists because three paths cannot stream: AES-GCM needs the
whole plaintext for its auth tag, and the support export holds every table at
once to reconcile scaled balances. The plain HTTP export streams and is
deliberately unbounded.

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
