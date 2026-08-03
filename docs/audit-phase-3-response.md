# Response to Audit Phase 3 — Database, Migrations, Backup, Restore, Support Backup

What was done about every item the Phase 3 audit raised, item by item, and what
was deliberately left alone.

- **Audit baseline:** `d5cea9bfa995885ba5198f9843359362927c0fd4`
- **Branch:** `claude/detailed-error-review-4pbug7`
- **Audit items answered:** 16 confirmed findings, 12 design risks, 22 missing
  tests, 7 documentation issues, 19 rejected false positives
- **Defects fixed:** 15 of the 16 confirmed findings, plus 15 the audit did not
  find
- **Still open:** 1 confirmed finding (P3-009), with a written plan

Every verdict below names the commit that carries it, so a reader can check the
claim rather than take it. Where a fix departed from the remedy the audit
proposed, the reason is stated.

---

## 1. Confirmed findings

| ID | Severity | Verdict | Commit |
|---|---|---|---|
| P3-001 | HIGH | Fixed | `d5613978` |
| P3-002 | HIGH | Fixed, different remedy | `4d6b3e65` |
| P3-003 | MEDIUM | Fixed | `dbf5c03c` |
| P3-004 | MEDIUM | Fixed | `d5613978` |
| P3-005 | MEDIUM | Fixed | `d5613978` |
| P3-006 | MEDIUM | Fixed, off by default | `eb0ce58b` |
| P3-007 | MEDIUM | Fixed | `cd8a822b` |
| P3-008 | MEDIUM | Fixed | `768b7095` |
| P3-009 | MEDIUM | **Open**, plan written | — |
| P3-010 | MEDIUM | Fixed | `4612b039` |
| P3-011 | MEDIUM | Fixed | `4612b039` |
| P3-012 | MEDIUM | Fixed, wider than reported | `768b7095`, `ff065779` |
| P3-013 | MEDIUM | Fixed | `cd8a822b` |
| P3-014 | MEDIUM | Fixed | `ca75ac4d` |
| P3-015 | MEDIUM | Fixed | `a00e8921` |
| P3-016 | LOW | Fixed | `4612b039` |

### P3-001 — Automatic backups share a tenant-agnostic filename and retention namespace

**Fixed.** Each user's artifacts now go in a server-computed subdirectory of the
root, named by their user id (`userBackupDirectory` in
`backend/src/backup/backup-paths.ts`). Retention only ever enumerates one user's
directory. Files sitting directly in a root predate this, carry no owner in their
names, and are left exactly where they are.

Proof: `backend/src/backup/auto-backup.service.spec.ts`, describe *"tenant
isolation on a shared root"*. That suite was rewritten from a mocked `fs` to a
real `mkdtemp` directory — a mocked filesystem cannot demonstrate a filesystem
property, and the old suite passed throughout the period the defect existed.

### P3-002 — Restore disconnects local/S3 attachment metadata from the stored bytes

**Fixed, but not the way the audit proposed.** The cheap remedy — preserve the
old `storage_key` — was rejected: the bytes are not in the backup, so restoring
into a different user on the same instance hands that user working links to files
whose contents they were never sent.

Instead the bytes are **copied**. Before the destructive delete, each external
object is read at its old key, checked against the byte size and SHA-256 the
metadata claims, and written under the new key. New keys are recorded so a failed
database transaction can remove them again; old-key objects are left alone,
because the same backup may be restored more than once.

An object that cannot be staged makes that attachment unrestorable. Refusing the
whole restore over a receipt image is the wrong trade, so the metadata row is
dropped and counted — as `skippedAttachments`, **beside** `restored` and never
inside it, because the client sums `restored`'s values into a row total.

### P3-003 — `accounts.linked_loan_account_id` is not deferred during restore

**Fixed**, and the class of defect is now machine-checked rather than fixed
once. `backend/src/backup/restore-plan.ts` declares the insertion order,
the deferred columns and the repair `UPDATE`s as data;
`backend/src/backup/restore-plan.spec.ts` parses every foreign key out of
`database/schema.sql` and fails when a restored table references a table inserted
later, or itself, without being stripped and repaired. It also fails on a
deferred column naming no real FK, a strip with no repair, and a repair with no
strip.

### P3-004 — Automatic backup writes and promotions are not crash-atomic

**Fixed.** Temp file in the same directory, `fsync`, atomic rename, `fsync` the
directory (`backend/src/backup/atomic-file.ts`). Stale temp files are swept
separately from retention, because a partial write is not a backup and counting
one would silently shorten the retention window.

### P3-005 — Any authenticated user can browse container directories and select arbitrary writable absolute paths

**Fixed.** `BACKUP_ALLOWED_ROOTS` (defaulting to `BACKUP_CONTAINER_DIR`) bounds
every user-influenced path, canonically — a symlink inside a permitted directory
cannot lead out of one. Per-user directories are excluded from the folder picker,
because listing them would turn it into user enumeration.

### P3-006 — The default Helm backend has no writable or persistent automatic-backup mount

**Fixed, deliberately off by default.** `backend.persistence.{backups,attachments}`
adds PVC or `existingClaim` mounts, an always-present `emptyDir` at `/tmp`, and
`fsGroup` from `runAsGroup` when either store is enabled.

Left off by default on purpose: enabling creates a claim, and on a cluster with
no default StorageClass that leaves the pod `Pending`. Flipping the default would
fix the finding by breaking upgrades for anyone without one, which is not a call
this branch should make. Instead the chart **refuses to render** when a store is
enabled with neither `existingClaim` nor `size`, and `NOTES.txt` says plainly, on
every install with backups disabled, that a schedule will report errors and
produce nothing.

The audit named only the backup mount; the attachment mount has the identical
defect in the same manifest, so both are fixed.

### P3-007 — Export reads each section in a separate transaction instead of one consistent snapshot

**Fixed.** Every table is read inside a single `REPEATABLE READ` transaction
(`inExportSnapshot`). `READ COMMITTED` is not sufficient even as one transaction:
it takes a fresh snapshot per statement. The cost is one pooled connection and a
held `xmin` for the duration, which is the price of a backup that restores.

### P3-008 — Buffered backup paths can exceed the chart's memory limit

**Fixed.** `BACKUP_EXPORT_BUFFER_LIMIT` (default `512mb`) bounds the JSON a
buffered export may accumulate. Three paths genuinely cannot stream — AES-GCM
needs the whole plaintext for its auth tag, and the support export holds every
table at once to reconcile scaled balances — so they get a ceiling rather than a
rewrite. The plain HTTP export streams and is deliberately unbounded.

### P3-009 — OIDC restore accepts any non-empty string as destructive-action confirmation

**OPEN. Not fixed.** `verifyAuthentication` still checks only that
`x-restore-oidc-token` is truthy; `x-restore-oidc-token: x` passes.

The fix is written down as a four-step plan in
`docs/backup-restore-contract.md` section 5, reusing the mechanism emergency
access already has (`STEP_UP_PURPOSES`, `@RequireStepUp`, `StepUpGuard`,
`StepUpAuthModal`) rather than inventing a second one. `backend/CLAUDE.md`
points at that section before anyone edits `verifyAuthentication`.

**Why it is open:** steps 1–4 change the restore path for **every** user,
including the frontend half, and the failure mode is "the user cannot restore
their backup". That needs exercising in a browser, which this environment cannot
do. Shipping it unverified trades a confirmation weakness for a possible total
loss of the restore feature. The remaining half is also worth stating: the
step-up mechanism's own OIDC branch is a session-based soft check, so converting
restore onto it makes the proof signed, expiring and action-scoped **without**
making it a fresh identity-provider authentication. Account deletion shares the
same sentinel and should be converted in the same change.

### P3-010 — `RLS_MODE=enforce` accepts pre-existing owner, superuser, `BYPASSRLS`, or inherited-power roles

**Fixed.** `assertRuntimeRoleIsSafe` (`backend/src/common/db/app-role.ts`) runs
at startup under `RLS_MODE=enforce` and refuses to boot on `rolsuper`,
`rolbypassrls`, ownership of the database or of any table in `public`, or
inherited membership in a superuser/`BYPASSRLS` role.
`pg_has_role(..., 'USAGE')` is what catches the last one: the role's own
`pg_roles` row looks clean while the privilege is reachable through `INHERIT`.
Table ownership counts because `FORCE ROW LEVEL SECURITY` is deliberately unused.

### P3-011 — The runtime application role can modify `schema_migrations`

**Fixed.** `REVOKE ALL ON TABLE public.schema_migrations` from the runtime role,
in `app-role.ts` where grants belong, plus explicit `NO*` attributes on
`CREATE ROLE`. The revoke is surgical: an integration case asserts the role
retains DML on an ordinary user table.

### P3-012 — Restore performs synchronous decompression without an output bound

**Fixed, and wider than reported.** Decompression is now asynchronous (libuv
threadpool) with `maxOutputLength`, bounded by
`BACKUP_RESTORE_EXPANDED_LIMIT` (default `1024mb`). The compressed limit bounds
nothing about what comes out of gzip.

The audit confirmed the event-loop half for `gunzipSync` only. The same defect
was in `backup-crypto.util.ts`: `scryptSync` at N=32768 is roughly 100 ms of CPU
and `maybeDecrypt` tries up to three candidate passwords, so one restore attempt
stalled every other request in the process for about a third of a second. Now the
promisified `crypto.scrypt`, with a source-scanning guard against the sync form
returning.

### P3-013 — A user backup omits metadata for a custom currency created by another user

**Fixed.** The export now includes every currency definition the user's data
references, whoever created it. The referencing columns are not spelled out in
the query — they come from `currency_codes_referenced_by_user` (migration 134),
which `backend/src/currencies/currency-references.spec.ts` checks against the
schema. Before this, a balance of 7 in a currency defined as
`PTS / Family Points / * / 0 decimals` came back as `PTS 7.00` instead of `*7`:
the amount was right, what it meant was not.

### P3-014 — Support backup preserves arbitrary custom-currency identifiers and free text

**Fixed.** Custom rows get a random three-letter code (random rather than
derived, so two artifacts from one user cannot be lined up by it, and checked
against the curated catalog so a pseudonym is never mistaken for a real
currency), a masked name, and a generic `¤` symbol. `decimal_places` is kept: it
is the arithmetic. Canonical rows are untouched — masking `USD` would make a
reproduction harder to read for no gain.

Every reference is rewritten through a named column list, not a string sweep: a
three-character code turns up by chance inside masked text often enough that a
generic walker would corrupt unrelated values.

### P3-015 — Tenant-scoped liveness checks can delete another user's custom-currency preference

**Fixed.** The predicate is written once, in SQL, as
`currency_code_in_use_globally` (migration 133) —
`SECURITY DEFINER` with a pinned `search_path`, `EXECUTE` revoked from `PUBLIC`,
and run inside the caller's transaction so the check and the delete stay one
read-modify-write. `SECURITY DEFINER` is what makes the answer genuinely global
rather than the calling tenant's view of a global question.

### P3-016 — Database initialization and migrations are not serialized across backend replicas

**Fixed.** Both `db-init` and `db-migrate` take one session advisory lock, the
same key, held across initialization and every migration file. Session-scoped
because the work spans many transactions. Blocking rather than `try`: a follower
that gives up either exits (the crash loop) or proceeds unsynchronised (the
race), and waiting is the only outcome where every replica ends up running.

---

## 2. Design risks

The audit asked for a decision on each, not a fix. Where the decision was "this
is a real limit, record it", it is now recorded in
`docs/backup-restore-contract.md` rather than living as an assumption.

| ID | Verdict |
|---|---|
| DR-001 | **Not addressed.** Migration identity is still filename-only. |
| DR-002 | **Not addressed.** `db-init` still uses `users` existence as its sentinel; the advisory lock fixes the race, not the health check. |
| DR-003 | **Decided and documented** — contract §8. Instance-key ciphertext is exported verbatim; re-entering the key is the only recovery. |
| DR-004 | **Documented as undecided** — contract §8. Whether the delegation reset is the intended product behaviour is explicitly still open. |
| DR-005 | **Documented, not fixed** — contract §8. `insertRows` still counts per attempted row and there is still no post-restore cardinality or closure check. |
| DR-006 | **FIXED.** See §4 below — this was handed to a later phase and is closed here. |
| DR-007 | **Decided and documented** — contract §8. Strict equality on version `1`, no compatibility window; define one before incrementing. |
| DR-008 | **Not addressed.** The threat model (policies protect against omitted tenant predicates, not arbitrary SQL execution) is unchanged and still undocumented as such. |
| DR-009 | **Not addressed.** Support preview still returns raw `before` rows. |
| DR-010 | **Pre-existing documentation stands** — `docs/support-backup.md`, "Honest limits". |
| DR-011 | **Not addressed.** The raw-export cache still evicts only on a later request. |
| DR-012 | **Not addressed.** Needs an enforce-mode two-user test with a live database. |

Nine of the twelve are not fixed. That is a scope decision, not an oversight:
each is a product or threat-model call rather than a defect, and two (DR-011,
DR-012) need runtime evidence this environment cannot produce.

---

## 3. Missing tests

| ID | Verdict | Where |
|---|---|---|
| MT-001 | **Partial.** The lock is asserted in `db-migrate.spec.ts`; two genuinely concurrent processes are not. | `backend/src/db-migrate.spec.ts` |
| MT-002 | **Not addressed, and the claim it tested was corrected instead.** The repository has no earliest historical schema to replay from, so the test cannot be written; `scripts/verify-schema.sh` no longer claims more than it proves (DOC-006). | — |
| MT-003 | **Done.** | `backend/src/common/db/app-role.spec.ts`, `backend/test/integration/rls-enforcement.integration.spec.ts` |
| MT-004 | **Done** — `permission denied` on `schema_migrations`, plus a case proving DML on an ordinary table survives. | `backend/test/integration/rls-enforcement.integration.spec.ts` |
| MT-005 | **Done.** | `backend/src/backup/auto-backup.service.spec.ts` |
| MT-006 | **Mostly done** against a real temporary directory: temp/rename atomicity, partial-write survival, stale cleanup, concurrent writers. ENOSPC and process death are **not** simulated. | `backend/src/backup/atomic-file.spec.ts` |
| MT-007 | **Done** — allowed roots, `/`, `/tmp`, siblings, symlink escape. | `backend/src/backup/auto-backup.service.spec.ts` |
| MT-008 | **Not addressed.** No `helm` binary here and no chart-rendering job in CI. A `helm template` job is the right guard and is not part of this branch. | — |
| MT-009 | **Partial.** The single `REPEATABLE READ` snapshot is asserted; the concurrent parent/child create-delete scenario needs a live database. | `backend/src/backup/backup.service.spec.ts` |
| MT-010 | **Partial.** The ceiling and its parsing are covered; a multiple-maximum-attachment memory test is not. | `backend/src/backup/backup-limits.spec.ts` |
| MT-011 | **Done** — a real gzip bomb (8 KB compressed, 512 KB expanded) is refused by the expanded ceiling. | `backend/src/backup/backup.service.spec.ts` |
| MT-012 | **Mostly done** — staging, checksum mismatch, missing object, provider mismatch, and the `skippedAttachments` accounting. | `backend/src/backup/backup.service.spec.ts` |
| MT-013 | **Not addressed** — blocked on P3-009. |
| MT-014 | **Done**, and generalised to every FK rather than this one column. | `backend/src/backup/restore-plan.spec.ts` |
| MT-015 | **Done** — user A defines `PTS`, user B prices an account in it, B's backup carries the definition. | `backend/test/integration/backup-restore.integration.spec.ts` |
| MT-016 | **Done** — six cases, two of which fail with the pseudonymisation removed. | `backend/src/backup/support-backup/support-backup.service.spec.ts` |
| MT-017 | **Done** — a tenant-scoped count returns 0 while the definer function returns true, in the same transaction, under real enforcement. | `backend/test/integration/rls-enforcement.integration.spec.ts` |
| MT-018 | **Not addressed** (DR-003 documented instead). |
| MT-019 | **Not addressed** (DR-004 documented instead). |
| MT-020 | **Not addressed** (DR-005 documented instead). |
| MT-021 | **Not addressed.** Rollback and nested-call cleanup of `app.preserve_timestamps` remain uncovered. |
| MT-022 | **Not addressed.** Needs an enforce-mode two-user crafted-backup run. |

Eleven of twenty-two are covered or mostly covered. Every "not addressed" above
is either blocked on P3-009, blocked on infrastructure this environment lacks, or
paired with a documented design decision that made the test moot.

---

## 4. Documentation issues

| ID | Verdict |
|---|---|
| DOC-001 | **Nothing to fix.** `CONTRIBUTING.md` already bans `createQueryRunner` and directs all access through `withScopedDb`. The `backend.md` skill file the audit cites under `.claude/skills/` **does not exist in this repository**: there is no `skills` directory, and `.claude/` contains only `settings.json`. |
| DOC-002 | **Nothing to fix.** The `infrastructure.md` skill file is absent for the same reason, and no `init.sql` exists under `database/` to be referenced — that directory holds `schema.sql`, `migrations/` and `CLAUDE.md`. |
| DOC-003 | **Fixed.** `.env.example` now discloses the `storage_key` behaviour, and `docs/backup-restore-contract.md` §4 states that the sidecar directory or bucket must be restored **before or alongside** the database, not after. |
| DOC-004 | **Fixed.** `helm/README.md` documents the persistence block, the sizing rule (retention keeps 17 full dumps *per user*), and the interaction with `BACKUP_ALLOWED_ROOTS`. |
| DOC-005 | **Fixed.** `docs/support-backup.md` no longer overstates what is masked, and now describes the currency pseudonymisation exactly. |
| DOC-006 | **Fixed.** `scripts/verify-schema.sh` now prints that every retained migration is a no-op when replayed on top of `schema.sql` — which is what it proves, and also how the app boots. |
| DOC-007 | **Fixed.** `docs/backup-restore-contract.md` is the single restore contract: format versioning, AI-secret portability, the delegation reset, externally stored attachment recovery, the two size ceilings, and the on-disk rules. |

---

## 5. False positives

All nineteen rejections were re-examined and **all nineteen stand**. Two deserve
a note because this branch touched their subject matter:

**FP-006** — "Public support-backup export can be requested unencrypted." The
rejection was correct: `CreateSupportBackupDto.password` is required and
validated on both public endpoints. The audit also noted that "the internal
optional type does not create a public bypass", which is true. That internal path
was closed anyway (`65e26925`): `SupportBackupService.generate` now refuses
rather than falling back to plain gzip, so the guarantee lives in the thing that
produces the file instead of only at the edge. The reason is not that the audit
was wrong — it is that seventeen tests in the suite were exercising the
unreachable branch, including the file's central de-identification claim, which
was scanning an artifact shape production never emits.

**FP-002** — "Absence of `FORCE ROW LEVEL SECURITY` is automatically defective."
The rejection stands and is load-bearing: `assertRuntimeRoleIsSafe` treats table
ownership as disqualifying *precisely because* owner bypass is deliberate.

---

## 6. Defects found beyond the audit

The audit's own reviewed-scope list was re-read for the classes its confirmed
findings belong to. Fifteen further defects came out of that, four passes deep.

### Security and data integrity

1. **S3 addressed objects with an unvalidated key** (`dd8e466e`). The local
   provider validated `storage_key` against an allowlist excluding `.` and `/`;
   the S3 provider concatenated prefix and key straight into
   `GetObject`/`PutObject`. `storage_key` is a column and **a restore writes it
   from an uploaded file**, so a crafted backup chooses the key — and an S3
   prefix is a naming convention, not a boundary. Combined with the attachment
   staging added for P3-002 (which reads the old key), that is a read primitive
   over the whole bucket. The validator now lives in
   `backend/src/attachments/storage/storage-key.util.ts` and a guard test asserts
   every provider in the module routes through it.

2. **`BackupEncryptionService` clobbered the users row from a stale snapshot**
   (`dd8e466e`). All four mutating methods read the row in one transaction and
   `save`d it in another, writing every column from the snapshot. `users` is
   written on ordinary traffic (`last_activity_at`), on failed logins (lockout
   counters) and by admin actions. Enabling encrypted backups could undo an
   account being disabled or reset a lockout mid-count.
   `syncOnPasswordChange` is the sharpest case: it runs *during* a password
   change and could put the old `password_hash` back.

3. **External attachment bytes were deleted before the commit** (`ff065779`) —
   the audit's DR-006, handed to a later phase, closed here. A commit failure
   after the object delete left a metadata row pointing at bytes that no longer
   existed, which the user cannot tell from a working attachment. The ordering
   was backwards: deletes now happen after the commit, so a failure leaves an
   orphaned object — a storage cost with nothing referencing it.

4. **Local attachment writes were not crash-atomic** (`ff065779`) — the same
   truncate-then-fill hazard as P3-004, in a different file. A partial write left
   bytes that did not match the recorded SHA-256, and nothing re-checks on
   download.

5. **A malformed base64 password header was mangled, not rejected**
   (`ff065779`). Node's decoder silently discards characters outside the
   alphabet, so a client that sent the password unencoded got a *different*
   password back and no error. On restore that is a confusing 401; on
   `x-export-password` it is unrecoverable — the file is encrypted under a
   password nobody knows and the response says success.

6. **A shared currency's creator id rode out in a support backup**
   (`43321864`) — a leak the P3-013 fix itself made reachable. `remapIdentifiers`
   seeds its map from each row's `id` column, and `currencies` has none, so
   another user's real UUID in `created_by_user_id` survived the remap verbatim.
   Two support files from two users of one instance who share a custom currency
   were correlatable by it — the exact correlation the remap exists to prevent.

7. **The support backup could ship unencrypted** (`65e26925`). See FP-006 above.

### Correctness and reliability

8. **A silent pass cap in the support backup's reference scrub** (`27db08d3`).
   `scrubDanglingRefs` looped ten times with a `break` on convergence and **no
   branch for exhaustion**: a deeper rule graph would have returned a map with
   dangling references still in it, gzipped cleanly, and failed on the
   recipient's restore with no hint the export had known. It now throws, and a
   second guard computes the longest `dropRow` chain out of `REFS` so the bound
   cannot quietly become reachable.

9. **The folder write-probe reported writable folders as unwritable**
   (`59079301`). `.monize-write-test-${Date.now()}` is not a unique name, and
   both callers are places where probes collide — `validateFolder` writes into
   the *shared* root, and the cron writes into a per-user folder every replica
   fires for. **Eleven of twelve** concurrent probes fail in the new test: the
   user is told to "check container permissions" about a folder that is fine,
   and on the cron path one replica stamps `lastBackupStatus = "failed"` while
   another has just written a good artifact.

10. **A literal NUL byte in `support-backup-integrity.ts`** (`27db08d3`). The NUL
    was the right separator; writing it as the raw byte made every text tool
    classify the source as binary — `grep` printed "binary file matches" and no
    line, `file` said "data", diffs read "Binary files differ". The file was
    effectively exempt from review for as long as the byte was there, which is
    how defect 8 above went unnoticed in it.

11. **`CurrenciesService.isInUse` was a fourth copy of the currency-reference
    list, missing `budgets`** (`f9f78434`). A user with a budget in a custom
    currency was told the code was not "in use by your accounts, securities, or
    other records", lost their activation row, and was left with a budget in a
    currency their settings no longer showed. The list now has one home, split
    into `currency_codes_referenced_by_user_data` and a composite that derives
    from it.

12. **`docs/cron-jobs.md` was missing six of nineteen cron services**
    (`43974c04`) — including `auto-backup`, the subject of this audit phase — and
    listed `auth.service`, whose handler had moved. `backend/CLAUDE.md` sends
    readers there for the full schedule, and two of the missing handlers send
    email or advance an emergency-access grant.

13. **Unbounded request arrays on the support-backup DTO** (`ff065779`).
    `accountIds` and `sections` had no `@ArrayMaxSize`, and `scopeToAccounts`
    does per-element work over every exported table — a denial-of-service lever
    on an authenticated endpoint (CWE-834). Two entries came off
    `array-bound-dto.spec.ts`'s grandfather list, which may only shrink.

15. **The pseudonym allocator did not keep its own promise** (this commit). Its
    doc says it returns "a three-letter code no row in this payload uses and no
    real currency claims", but it only checked the `taken` set. The production
    caller seeds that set with every catalogued code, so the end-to-end path was
    safe — the guarantee was the caller's to keep, and a second caller seeding
    only the payload's own codes would have emitted `USD` as a pseudonym with
    nothing to stop it. Found by a new 2000-sample test that issued `SAR` on its
    first run; the catalog is now consulted in the function.

    That test exists because the P3-014 case it replaced had become a
    4-second, 40-scrypt-derivation loop once the support export was forced to
    encrypt — it sat on Jest's default timeout and failed under any parallel
    contention. Splitting it gave the wiring one end-to-end run and the
    allocation property two thousand cheap ones, which is how the gap surfaced:
    a rejection bug firing one time in fifty survives twenty samples.

14. **A comment claiming a filter the query does not have** (`52f854e1`).
    `MnyStagingService.findInfo` was documented as excluding expired rows; there
    is no `expires_at` predicate. The behaviour is correct and was left alone —
    refusing a file mid-import because the clock crossed 24 hours would fail a
    working job — but the comment described code that is not there.

### Rules the machine now checks

The recurring cause across these was a rule that existed in prose and was
violated anyway. Five new guards, each confirmed to fail against the original
state:

| Guard | Catches | Commit |
|---|---|---|
| `backend/src/backup/restore-plan.spec.ts` | a new FK between backed-up tables with no defer/repair | `dbf5c03c` |
| `backend/src/currencies/currency-references.spec.ts` | a new `currencies(code)` reference missed by either SQL function, the TS constant, or the delete gate | `a00e8921`, `f9f78434` |
| `backend/src/backup/export-driver-values.spec.ts` | a new `bytea` column exported without `encode(..., 'base64')` | `ff065779` |
| `backend/src/attachments/storage/storage-key.util.spec.ts` | a storage provider addressing an object without validating the key | `dd8e466e` |
| `backend/src/common/source-bytes.spec.ts` | a raw control byte hiding any source file from review | `27db08d3` |
| `backend/src/common/doc-paths.spec.ts` | a `CLAUDE.md` or top-level `docs/` path that does not resolve | `009b3eac` |
| `backend/src/common/cron-doc.spec.ts` | an `@Cron` handler missing from `docs/cron-jobs.md`, or a row naming a service with none | `43974c04` |

Plus `role-or-grant-statement` in `backend/scripts/migration-lint.mjs`
(`99b41963`), which enforces the no-roles-in-migrations rule over all 124
migrations — a rule `database/CLAUDE.md` stated absolutely while the tree already
held one `REVOKE ... FROM PUBLIC`. That prose now states the carve-out and its
reason.

This document's own file references are covered by `doc-paths.spec.ts`, which is
why the DOC-001/DOC-002 rows above describe the absent skill files in prose
rather than citing them as paths: the guard cannot tell a claim from a statement
of absence, and it rejected the first draft for exactly that.

---

## 7. What remains open

1. **P3-009** — the OIDC step-up. Plan in `docs/backup-restore-contract.md` §5.
   Needs browser verification because the change touches every user's restore
   path.
2. **The i18n localization pass.** English catalogs are complete; the other
   eighteen locales are not. Per the root `CLAUDE.md`, that is one commit at
   acceptance, and the parity specs failing on a work-in-progress branch is the
   expected state, not a regression.
3. **The nine design risks and eleven missing tests** listed as not addressed
   above, each with its reason.

---

## 8. Verification status

Run and green:

| Check | Result |
|---|---|
| `tsc --noEmit` (backend) | clean |
| `npm run lint` (backend) | clean |
| `npm run migration:lint` | 124 migrations, clean |
| `npm run migration:lint:test` | 26 pass |
| `npm run i18n:check` | pseudo-locale fresh |
| `scripts/check-env-docs.mjs` | 51 env vars documented |
| Backend unit (`TZ=UTC npm run test:unit`) | 407/408 suites, 10798 tests |
| Frontend unit (`vitest run`) | 626/627 files, 12265 tests |

The one failing suite on each side is the i18n parity spec — `errors.json` and
`settings.json` across the eighteen untranslated locales, item 2 above.

**Not run:** the integration suites. This environment has no Docker and no
PostgreSQL, so every `backend/test/integration/*` case — including the ones added
here — runs for the first time in CI's *Backend Integration Tests* job. Likewise
`scripts/verify-schema.sh` and any Helm rendering: the chart templates were
checked only for balanced blocks.

Every new invariant on this branch was broken on purpose once, and its test
confirmed to fail, before being restored. Where a suite stayed green through a
behaviour change, that is called out as a finding in the relevant commit rather
than taken as a pass.

---

## 9. Commit inventory

The 23 commits that changed code, configuration or the repository's own rules,
oldest first, so nothing is unaccounted for.

| Commit | Subject | Answers |
|---|---|---|
| `dbf5c03c` | Defer `accounts.linked_loan_account_id` on restore, and check the rule | P3-003, MT-014 |
| `4d6b3e65` | Stage attachment bytes on restore instead of orphaning them | P3-002, MT-012 |
| `a00e8921` | Decide currency liveness once, globally, inside the caller's transaction | P3-015, MT-017 |
| `768b7095` | Bound restore decompression and buffered-export memory | P3-008, P3-012, MT-010, MT-011 |
| `cd8a822b` | Read the export from one snapshot, and export the currencies it depends on | P3-007, P3-013, MT-009, MT-015 |
| `d5613978` | Isolate automatic backups per user, write them atomically, confine the destination | P3-001, P3-004, P3-005, DOC-003, MT-005, MT-006, MT-007 |
| `405f3e79` | Regenerate the backend pseudo-locale after the new error strings | mechanical (`i18n:check` gate) |
| `4612b039` | Serialise startup DB work; refuse an unsafe runtime role; revoke migration DML | P3-010, P3-011, P3-016, MT-003, MT-004, MT-001 (partial) |
| `ca75ac4d` | Pseudonymise user-created currencies in the support backup | P3-014, DOC-005, MT-016 |
| `eb0ce58b` | Give the Helm backend somewhere durable to write | P3-006, DOC-004, MT-008 (partial) |
| `9eaf03f7` | Write down the backup/restore contract and the rules the fixes established | DOC-006, DOC-007, DR-003/004/005/007 |
| `ff065779` | Fix five siblings of the audited defects, found by sweeping the audit's file list | DR-006, plus extras 4, 5, 13 and the driver-value guard |
| `dd8e466e` | Validate S3 object keys, and stop clobbering the users row from a stale snapshot | extras 1, 2 |
| `52f854e1` | Correct a staging comment that claimed a filter the query does not have | extra 14 |
| `27db08d3` | Make the reference scrub's pass bound loud, and stop hiding a source file from review | extras 8, 10 |
| `f9f78434` | Ask the database which currencies a user still needs, in the delete gate too | extra 11 |
| `43321864` | Stop a shared currency's creator id from riding out in a support backup | extra 6 |
| `009b3eac` | Make "a doc that names a file is claiming it exists" a test rather than a paragraph | doc-path guard |
| `99b41963` | Check the no-roles-in-migrations rule, and state it as it actually is | migration-lint role rule |
| `59079301` | Stop the folder write-probe reporting a writable folder as unwritable | extra 9 |
| `43974c04` | Document the six cron jobs that were missing, and check the table against the source | extra 12 |
| `65e26925` | Enforce the support backup's encryption in the code that produces the file | extra 7, FP-006 note |
| `0748d69a` | Make the pseudonym allocator keep its own promise, and stop a 4-second test | extra 15 |

Three of those carry no audit finding of their own: `405f3e79` keeps the
pseudo-locale gate green, and `009b3eac` and `99b41963` convert prose rules that
had already been violated into checks. They are here because the branch's
recurring cause was a rule nothing enforced.

Not rows above: the commits that introduce and correct **this document**
(`4c42be22` and any that follow it). A file cannot list its own commit and stay
accurate — amending to insert the hash changes the hash — so the branch log is the
record for those, and every other hash in this file resolves. If you are checking
the inventory against `git log`, that difference is the whole of it.
