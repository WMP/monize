# Response to Audit Phase 3 — Database, Migrations, Backup, Restore, Support Backup

What was done about every item the Phase 3 audit raised, item by item, and what
was deliberately left alone.

- **Audit baseline:** `d5cea9bfa995885ba5198f9843359362927c0fd4`
- **Branch:** `claude/detailed-error-review-4pbug7`
- **Audit items answered:** 16 confirmed findings, 12 design risks, 22 missing
  tests, 7 documentation issues, 19 rejected false positives
- **Follow-up reviews answered:** F3R-001…008 (section 10), F3RR-001…005 and
  F3RR-RISK-001 (section 11)
- **Defects fixed:** 15 of the 16 confirmed findings, 6 of the 7 first-review
  findings, 4 of the 5 re-review findings and its LOW residual, plus 17 the audits
  did not find
- **Still open:** 1 confirmed finding (P3-009 / F3R-008 / F3RR-005), with a written
  plan, and one partial (large-table streaming — see section 11)

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

A follow-up review (F3R-001) called this not fixed for the default chart, on the
reading that a user "can enable a schedule that reports errors and produces no
files". That premise is wrong: `updateSettings` with `enabled: true` calls
`resolveUserFolder`, which creates the directory, and then `assertFolderWritable`,
which probes it — so on a read-only root filesystem with no mount the save is
**refused and nothing is stored**. A test now pins that, including that
`save` is never called.

What the review was right about is what the user was told. The refusal said
"Ensure the path is mapped as a Docker volume" — one of the two mechanisms, and the
wrong one on Kubernetes, where the same thing is a Helm persistence value. It also
read as a mistyped path rather than as a deployment with nowhere to write, which is
not something any path the user types can fix. The message now says that, and names
both mechanisms, because the code cannot tell which platform it is on.
`GET /backup/auto-backup-capability` reports the same thing before the user
configures anything, so a surface can say it first.

Not done, and stated as such: hiding or disabling the frontend control. That needs
browser verification, the same constraint as P3-009.

### P3-007 — Export reads each section in a separate transaction instead of one consistent snapshot

**Fixed.** Every table is read inside a single `REPEATABLE READ` transaction
(`inExportSnapshot`). `READ COMMITTED` is not sufficient even as one transaction:
it takes a fresh snapshot per statement. The cost is one pooled connection and a
held `xmin` for the duration, which is the price of a backup that restores.

### P3-008 — Buffered backup paths can exceed the chart's memory limit

**Fixed, then fixed properly.** `BACKUP_EXPORT_BUFFER_LIMIT` bounds the JSON a
buffered export may accumulate. Three paths genuinely cannot stream — AES-GCM
needs the whole plaintext for its auth tag, and the support export holds every
table at once to reconcile scaled balances — so they get a ceiling rather than a
rewrite. The plain HTTP export streams and is deliberately unbounded.

The first attempt defaulted it to `512mb` against the chart's `400Mi` backend, so
the ceiling could never fire: the pod was OOM-killed first, which is the outcome it
existed to prevent. The file's own comment named the 400 MiB figure while the
constant below it said 512. A follow-up review (F3R-002) caught it, and the
support export had no ceiling at all.

The default is now **derived from the container's cgroup memory limit** — about a
quarter of it, because a buffered export holds several copies of the payload at
peak — with a floor, a cap, a fallback when no limit can be read, and a startup
warning when a configured value is too large to protect the process. The support
path applies the same budget. `backend.backupLimits` in the chart sets both
explicitly beside `resources.limits.memory` so they cannot drift apart.

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
membership in a superuser/`BYPASSRLS` role.
`pg_has_role(..., 'MEMBER')` is what catches the last one: the role's own
`pg_roles` row looks clean while the privilege is reachable.
Table ownership counts because `FORCE ROW LEVEL SECURITY` is deliberately unused.

This first shipped with `'USAGE'`, which asks only whether the privileges arrive
automatically through `INHERIT`. A follow-up review (F3R-004) found the gap:
membership permits `SET ROLE` by default, so
`GRANT owner TO app WITH INHERIT FALSE, SET TRUE` passed the check while
`SET ROLE owner` succeeded in every session. `MEMBER` is "can `SET ROLE` to it"
and is implied by `USAGE`, so it subsumes the original check.

### P3-011 — The runtime application role can modify `schema_migrations`

**Fixed.** `REVOKE ALL ON TABLE public.schema_migrations` from the runtime role,
in `app-role.ts` where grants belong, plus explicit `NO*` attributes on
`CREATE ROLE`. The revoke is surgical: an integration case asserts the role
retains DML on an ordinary user table.

### P3-012 — Restore performs synchronous decompression without an output bound

**Fixed, and wider than reported.** Decompression is now asynchronous (libuv
threadpool) with `maxOutputLength`, bounded by
`BACKUP_RESTORE_EXPANDED_LIMIT`. The compressed limit bounds nothing about what
comes out of gzip.

The default was `1024mb`, above the chart's `400Mi` backend limit and therefore
unable to fire (F3R-003). It is now derived from the container's memory limit, as
described under P3-008.

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

1. **P3-009** — the OIDC step-up, also reported as F3R-008, F3RR-005, F3RRR-004,
   F3R5-006 and F3R6-006. Plan in `docs/backup-restore-contract.md` §5. Needs a
   decision about the provider interaction (`prompt=login` / `max_age=0` /
   `auth_time`) and browser verification, because the change touches every user's
   restore path.
2. **F3RRR-002 / F3R5-004 / DR-F3R6-001, the pre-authentication half** — an
   unauthenticated client can occupy the aggregate upload budget until the receive
   deadline expires, which degrades a legitimate restore to a retry. The
   concurrency and lifecycle halves are fixed (§13); the remaining options are
   ingress-level limits, an upload token, or streaming to disk, and none is on this
   branch.
3. **F3RRR-003 / F3R5-005 / F3R6-001** — the export materialises each table (and,
   since `5a578061`, every carried attachment) before the ceiling is consulted, and
   the plain HTTP export has no ceiling at all. One cursor inside the repeatable-read
   snapshot — serialising rows, base64-encoding one attachment at a time, under a
   per-chunk budget — fixes all of it, and would also replace `PEAK_MULTIPLE` with a
   measured bound. **The single highest-value open item**, because it is what repays
   the memory cost of self-contained artifacts (§14).
4. **DR-F3R6-002** — `PEAK_MULTIPLE` and the derived memory shares are argued from
   allocation counting, not measured. The processing cap (F3R6-004) is designed to
   survive them being wrong, but settling the numbers needs the cgroup peak-RSS test
   this environment cannot run.
4. **DR-F3RRR-001 / DR-F3R5-001** — the retention policy for source attachment
   objects the restore keeps so a backup can be restored twice. Largely dissolved by
   `5a578061`: an artifact that carries its own bytes has no source objects to
   retain, so this survives only for artifacts exported before that commit.
5. **The i18n localization pass.** English catalogs are complete; the other
   eighteen locales are not. Per the root `CLAUDE.md`, that is one commit at
   acceptance, and the parity specs failing on a work-in-progress branch is the
   expected state, not a regression.
6. **The nine design risks and eleven missing tests** listed as not addressed
   above, each with its reason, plus items 2-4, 6 and 7 of the fourth review's
   missing-test list — all of which need live storage, a real cgroup, a browser or
   a cluster.

---

## 8. Verification status

Run and green:

| Check | Result |
|---|---|
| `tsc --noEmit` (backend) | clean |
| `npm run lint` (backend) | clean |
| `npm run lint` (frontend) | clean (one pre-existing `exhaustive-deps` warning in `Combobox.tsx`) |
| `npm run type-check` (frontend) | clean |
| `npm run migration:lint` | 124 migrations, clean |
| `npm run migration:lint:test` | 26 pass |
| `npm run i18n:check` | pseudo-locale fresh |
| `scripts/check-env-docs.mjs` | 51 env vars documented |
| Backend unit (`TZ=UTC npm run test:unit`) | 409/410 suites, 10924 tests |
| Frontend unit (`npm test`) | 626/627 files, 12270 tests |

The one failing suite on each side is the i18n parity spec — `errors.json` and
`settings.json` across the eighteen untranslated locales, item 5 above. Both totals
are from full runs at `fd4ed827`, the current head of executable code.

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

The 40 commits that changed code, configuration or the repository's own rules,
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
| `6fabd14f` | Write every byte before renaming a backup into place | F3R-007 |
| `3f0cd837` | Refuse a runtime role that can SET ROLE to power | F3R-004 |
| `88f55e65` | Lock the currency row across the liveness decision | F3R-005 |
| `35d103c1` | Delete the attachment bytes a restore displaced, after it commits | F3R-006 |
| `f6504c73` | Make the backup memory ceilings smaller than the pod they protect | F3R-002, F3R-003, extra 16 |
| `8863f104` | Say what is actually wrong when a deployment has no backup storage | F3R-001, extra 17 |
| `7fe0eedb` | Stop the uploaded storage_key from being an authorization capability | F3RR-001, F3RR-002 |
| `2b5dd399` | Bound the earliest allocation; stop loading discarded tables | F3RR-003, F3RR-004 (partial) |
| `a9ac6f1d` | Tell the user there is no backup storage before they configure a schedule | F3RR-RISK-001 |
| `51de3519` | Take ownership from the database, not the uploaded file | F3RRR-001, DOC-F3RRR-1/2 |
| `39f4e6a1` | Let a user switch a failing backup schedule off | F3RRR-005 |
| `531f7366` | Make the upload limit's startup warning real, and stop the header lying | DOC-F3RRR-3/4 |
| `5a578061` | Carry attachment bytes in the artifact for every provider | F3R5-001, DR-F3R5-001/002, DOC-F3R5-003/004 |
| `2dcbd768` | Budget the restore's peak, and hold it until the work is done | F3R5-002, F3R5-003, F3R5-004 (bounded), DOC-F3R5-001/002 |
| `bf2e5622` | Verify attachment bytes at export; canonicalize duplicate blob rows | F3R6-002, F3R6-003, DOC-F3R6-001/003 |
| `fd4ed827` | Cap concurrent restore processing; stop the upload floor going unsafe | F3R6-004, F3R6-005, DOC-F3R6-002 |
| `fb67516b` | Budget restore uploads across the process, not per request | F3RRR-002 (concurrency half) |

Three of those carry no audit finding of their own: `405f3e79` keeps the
pseudo-locale gate green, and `009b3eac` and `99b41963` convert prose rules that
had already been violated into checks. They are here because the branch's
recurring cause was a rule nothing enforced.

Not rows above: the commits that only change **this document**
(`4c42be22`, `774c646d`, `a0819951`, `e20a65b2`, `ab2e420f`, `c3cfa704`, `29bda3f9`, `8b829a97` and any that follow). A file cannot list its own
commit and stay accurate — amending to insert the hash changes the hash — so the
branch log is the record for those, and every other hash in this file resolves. If
you are checking the inventory against `git log`, that difference is the whole of
it.

---

## 10. The remediation review (F3R-001…008)

A second review re-checked this branch at `a0819951` and reported eight unresolved
MEDIUM findings. Each was verified against the code before being accepted.

| ID | Verdict | Commit |
|---|---|---|
| F3R-001 | **Premise wrong; residual fixed** | `8863f104` |
| F3R-002 | Confirmed, fixed | `f6504c73` |
| F3R-003 | Confirmed, fixed | `f6504c73` |
| F3R-004 | Confirmed, fixed | `3f0cd837` |
| F3R-005 | Confirmed, fixed | `88f55e65` |
| F3R-006 | Confirmed, fixed | `35d103c1` |
| F3R-007 | Confirmed, fixed | `6fabd14f` |
| F3R-008 | Same as P3-009 — **still open** | — |

Six of the seven new findings were real. Details are under the original finding
each one belongs to (P3-004, P3-006, P3-008, P3-010, P3-012, P3-015 and P3-002
respectively); what follows is what the review got wrong, and what verifying it
turned up on its own.

**F3R-001's reproduction step 3 is not what the code does.** It says the settings
"can be stored" on a deployment with no writable destination. They cannot:
`updateSettings` creates the per-user directory and probes it before saving, so the
save is refused. The residual — a refusal message naming a Docker volume on
Kubernetes, and nothing letting a surface say so beforehand — was real and is fixed.

**Two defects came out of verifying the review rather than out of the review.**
Writing F3R-001's test surfaced that `realpathOfExistingAncestor` rethrew every
non-ENOENT error raw, so a folder path containing a file component answered with a
500 carrying the resolved filesystem path instead of a 400 (`8863f104`). Writing
F3R-002's test surfaced that the support suite's `BackupService` double was cast
`as unknown as BackupService`, so the new export ceiling read as `undefined` and was
silently disabled in all 57 of that file's tests while every one passed
(`f6504c73`).

**One thing the review asked for is deliberately not done.** F3R-001's option 2
includes hiding or disabling the frontend control when backup storage is
unavailable. The backend half is done (`GET /backup/auto-backup-capability`); the
frontend half needs browser verification, which is the same constraint that keeps
P3-009 open, so it is not in this branch.

The review's other recommendations that are **not** implemented, each with a
reason:

- *Enable a durable backup claim by default* (F3R-001 option 1). Creating a claim
  on a cluster with no default StorageClass leaves the pod `Pending`, so this fixes
  the finding by breaking upgrades for anyone without one.
- *Incremental JSON parsing or a temporary-file representation for large restores*
  (F3R-003). A real improvement and a larger change than a ceiling; the ceiling now
  fires before the process dies, which was the defect.
- *Process-level tests with cgroup memory enforcement* (F3R-002, F3R-003) and
  *`helm template` plus a pod-level smoke test* (F3R-001). Neither is possible in
  this environment — no Docker, no cluster — and both remain the right verification.

---

## 11. The remediation re-review (F3RR-001…005, F3RR-RISK-001)

A third review re-checked the branch at `8863f104` and reported two HIGH and three
MEDIUM defects plus a LOW residual. Each was verified against the code first.

| ID | Severity | Verdict | Commit |
|---|---|---|---|
| F3RR-001 | HIGH | Confirmed; `7fe0eedb` fixed the wrong half — see §12 | `7fe0eedb`, `51de3519` |
| F3RR-002 | HIGH | Confirmed, fixed | `7fe0eedb` |
| F3RR-003 | MEDIUM | Confirmed, fixed | `2b5dd399` |
| F3RR-004 | MEDIUM | Confirmed, **partly** fixed | `2b5dd399` |
| F3RR-005 | MEDIUM | Same as P3-009 — **still open** | — |
| F3RR-RISK-001 | LOW | Confirmed, fixed | `a9ac6f1d` |

Both HIGH findings were real and both were mine.

**F3RR-001 was the most serious defect on this branch.** The restore derived an
external attachment's destination key from `row.storage_key`, and a key it did not
recognise as a remapped id was treated as legacy or operator-chosen: skip the load,
skip the checksum, skip the copy. So a crafted backup could name *any* syntactically
valid key — including another tenant's — and the row was inserted under the
uploader's `user_id` without a byte being read. Downloading their own metadata
returned somebody else's receipt. `assertSafeStorageKey` proves a key is a safe
*string*; nothing proved it was *theirs*. Both keys now come from the id remap, and
`storage_key` is overwritten with the derived value for every provider.

**That fix was not enough, and the sentence above is why.** "Nothing proved it was
theirs" is the defect; moving the source from one uploaded field to another does
not answer it. The fourth review found the hole: `collectRowIdRemap` admits every
UUID-shaped `row.id`, so a crafted row carrying the victim's attachment id was
still read. See §12, F3RRR-001.

**F3RR-002 was a regression I introduced two commits earlier.** The F3R-006 cleanup
deleted every displaced key, and for a backup taken from the same account its
*source* objects are that account's displaced objects — so the first restore
deleted the artifact's source bytes, and a second restore of the same file skipped
every attachment and then deleted the copy the first restore had made. Content gone
from every reachable key, restore still reporting success.
`stageAttachmentObjects` said "old-key objects are deliberately left alone: the same
backup may be restored more than once" the entire time. Two halves of one change
with opposite intentions about the same object, and no test ran a second restore.

**F3RR-004 is fixed in part and open in part, stated here rather than implied.**
Its concrete example was right: the support export loaded base64 `attachment_blobs`
it always discards — potentially the whole of a 400 MiB pod — because the ceiling is
consulted after the load. `collectRawExport` now takes a `skipTables` set. What is
**not** done is the rest: large tables are still read whole through `manager.query`
rather than a cursor, and there is no per-row budget, so one enormous table is
bounded only by the ceiling that follows it. That is a rearchitecture of the read
path, not a limit.

Three things the review got right that I had not seen, and one thing about my
tests:

- Its F3R-001 correction was accepted in the previous round and it re-confirmed it.
- It correctly identified that my "never deletes a key the restore just staged"
  test could not prove its case, because the staged key is generated dynamically
  and the mocked displaced list never contained it.
- It correctly identified that the new tests ran only one restore.

Writing the replacements found a further problem with my own work: the first
crafted-key test I wrote asserted that the restore never *reads* the victim key —
which the vulnerable code also never does, because skipping the read *was* the bug.
It passed against the defect. It now asserts the row is staged normally, and fails
against it.

Verification the review asked for and this environment cannot provide: a live
two-user crafted-key restore against real local/S3 storage, a process-level cgroup
test with peak-RSS measurement, `helm template` plus a pod-level write test, and
the browser OIDC step-up flow. All four remain the right way to verify these, and
none of them ran here.

---

## 12. The fourth-pass re-review (F3RRR-001…005, DR-F3RRR-001)

A fourth review re-checked the branch at `c3cfa704` and reported one HIGH, three
MEDIUM and one LOW defect, plus a MEDIUM design risk and five documentation
issues. Every finding was verified against the code before being accepted.

| ID | Severity | Verdict | Commit |
|---|---|---|---|
| F3RRR-001 | HIGH | Confirmed, fixed | `51de3519` |
| F3RRR-002 | MEDIUM | Confirmed; concurrency half fixed, pre-auth half **open** | `fb67516b` |
| F3RRR-003 | MEDIUM | Confirmed — **open**, as already documented | — |
| F3RRR-004 | MEDIUM | Same as P3-009 — **still open** | — |
| F3RRR-005 | LOW | Confirmed, fixed | `39f4e6a1` |
| DR-F3RRR-001 | MEDIUM design risk | Accepted — **needs a decision** | — |
| DOC-F3RRR-1/2 | — | Fixed | `51de3519` |
| DOC-F3RRR-3/4 | — | Fixed | `531f7366` |
| DOC-F3RRR-5 | — | Fixed | this document |

**F3RRR-001 was right, and it is the third time this code has been wrong in the
same place.** The review's summary is exact: the previous fix "stopped trusting
uploaded `storage_key`, but now derives the source object key from uploaded
`transaction_attachments.id`. That field is equally attacker-controlled and is
automatically admitted into the remap."

The reasoning that failed was "a row whose id is not in the remap did not come from
this backup's graph". The remap is built from the *uploaded* graph:
`collectRowIdRemap` (`backup-id-remap.util.ts:14-35`) adds every UUID-shaped
`row.id` in the file, so for any well-formed crafted row the guard could not fire.
Put the victim's attachment id in `transaction_attachments.id`, with the byte size
and SHA-256 that a standard backup publishes beside it, and the restore read their
object and copied it under the attacker's ownership. The uploaded document was
authorizing itself.

Of the review's three recommended contracts, option 2 is implemented:
`loadOwnedAttachmentSources` reads `transaction_attachments` scoped to the
restoring user, before the destructive delete, and staging requires the stored row
to exist, to be on the configured provider, and to agree with the uploaded row's
size and hash. Integrity is then checked against the **stored** values, so an
object that changed under the row since is caught too. Anything that fails is
unrestorable: dropped, counted in `skippedAttachments`, no read attempted. Options
1 and 3 (self-contained artifact, signed manifest) remain available and are the
better long-term answer for cross-instance restore; neither is on this branch.

The consequence the review anticipated is accepted deliberately: restoring one
user's backup into a different user on the same instance now skips external
attachments rather than disclosing them, and a fresh instance skips them because
the objects are not there. That is the conclusion §4 of
`docs/backup-restore-contract.md` already reached about *preserving* the old key,
applied to *reading* it.

Five tests, all confirmed failing against the pre-fix service. Missing test 1 from
the review's list ("crafted external attachment with victim UUID in
`transaction_attachments.id`, not merely in `storage_key`") is now
`backup.service.spec.ts` › "an attachment id the uploader does not own". Missing
test 2 (real two-user local and S3) is not: it needs live object storage and two
real accounts, which this environment does not have.

**F3RRR-005 was a regression in the previous commit's own fix.** `a9ac6f1d` added
the capability banner and disabled the toggle unconditionally, which is wrong in
the case that matters most — storage that *used* to work. A volume unmounted or
turned read-only leaves a schedule armed and failing, and the user who comes to
this screen wants to switch it off. The control is now disabled only for the
false-to-true transition, and "Run Backup Now" is disabled outright when capability
is definitely unavailable. Missing test 5 is now two tests, both confirmed failing
against `a9ac6f1d`.

**The two documentation issues about `backup-limits.ts` turned out to be one
behaviour issue.** The header's stale "two of them" and 500 MB text is now correct
for three limits. The claim that an oversized upload override "gets the same
startup warning as the other two" was false, and the reason it was never wired is
worth recording: `warnIfLimitExceedsMemory` compared against the buffered
quarter-share while the upload default is derived from half the container, so the
check as written would have warned on every deployment about a number the code
itself chose. The threshold is now a parameter, the half-share is a named exported
constant that both the derivation and the check read, and `main.ts` calls it.

### What this review found that the previous three did not

Nothing about F3RRR-001 was new information about the *code*; it was new
information about my reasoning. Three rounds in a row, the external-attachment
path was fixed in the right direction and left the mirror-image concern
unconsidered:

| Round | What was fixed | What was left |
|---|---|---|
| F3R-006 | displaced bytes are deleted after commit | the same keys are the backup's sources |
| F3RR-001/002 | the key is derived, not taken from the file | the *id* it is derived from is also from the file |
| F3RRR-001 | ownership comes from the database | cross-instance restore of external bytes now needs a signed artifact |

The rule that generalises is in the code and in the contract now, in the strongest
form I can state it: **no unsigned value from the uploaded file can establish
ownership — not a key, not an id, not a checksum, not a byte count. Only a record
the server already holds can.** Which field to trust was never the question, and
answering it as though it were is what produced two of these three rounds.

A scan cannot enforce all of that: it cannot tell an uploaded identifier from a
derived one, and typing the boundary would mean a distinct type for every value
that crosses it — a change to the whole backup module, not a guard. But the half a
scan *can* hold, it now holds. `backup.service.spec.ts` › "reads an external object
in exactly one place, after the ownership check" asserts that
`this.attachmentStorage.load(` appears exactly once in the module, that the call is
inside `stageAttachmentObjects`, and that `loadOwnedAttachmentSources` and
`ownedSources.get` both appear before it. That does not prove the check is
*correct*; it does mean the next reader added beside this one trips a test and has
to read the rule. Which is the specific failure mode here: three rounds, three
edits to the same path, each one reasoning locally.

### Open, with reasons

- **F3RRR-002** (concurrent pre-auth upload OOM). The concurrency half is fixed;
  the pre-authentication half is not. `createRestoreUploadAdmission` runs as
  Express middleware *ahead of* `express.raw` and keeps a process-wide total of the
  bytes it has promised to buffer, so the second of two 190 MiB uploads gets a 503
  with `Retry-After` instead of both being admitted onto a 400 MiB pod.
  Twenty-three tests cover the budget, the release on `finish`/`close`, the
  double-release case, the conservative claim for a chunked upload, the requests
  the parser will not buffer (a CORS preflight has no `Content-Length`, so
  budgeting it would claim the whole ceiling for a request that allocates nothing),
  and two source guards — that the gate sits before the parser, and that it covers
  every content type the parser is configured with. Both guards scan `main.ts`,
  which has no test harness of its own, and either mistake would leave bytes
  buffered outside the budget.

  What is **not** fixed: an unauthenticated client can still occupy the budget, so
  it can make a legitimate caller retry. That is a refused request rather than a
  dead process, which is the trade this takes deliberately. The three remaining
  options — a smaller body limit at the ingress ahead of the process, a two-step
  restore session issuing a short-lived upload token after authorization, and
  streaming to a bounded temporary file — are recorded in
  `docs/backup-restore-contract.md` §6 and none is implemented. The review's
  cgroup load test with peak-RSS measurement is still the right way to verify any
  of this, and it did not run here.
- **F3RRR-003** (one table materialised before the ceiling). Confirmed and stated
  as open in §11 already; the fourth review agrees the response document was
  accurate about it. Needs a cursor and a per-chunk budget.
- **F3RRR-004** = P3-009 = F3R-008 = F3RR-005. Open across all four reviews. Plan
  in `docs/backup-restore-contract.md` §5; it needs a decision about the OIDC
  provider interaction (`prompt=login` / `max_age=0` / `auth_time`) and browser
  verification.
- **DR-F3RRR-001** (retained source objects). Accepted as stated. The retention is
  deliberate and documented, and the review is right that "leaving unindexed
  objects forever should not be an accidental retention policy". It is now a
  narrower question than before F3RRR-001: only objects the restoring user
  *demonstrably owns* are ever read, so the retained set is their own files rather
  than potentially anyone's. That does not make it a policy. Deciding it means
  choosing between self-contained artifacts (which would remove the need to retain
  anything) and a bounded, indexed retention window with visible cleanup status.
  Not implemented either way.

---

## 13. The fifth-pass re-review (F3R5-001…006, DR-F3R5-001/002)

A fifth review re-checked the branch at `29bda3f9` and reported one HIGH and five
MEDIUM defects, two design risks and four documentation inconsistencies. Every
finding was verified against the code first.

| ID | Severity | Verdict | Commit |
|---|---|---|---|
| F3R5-001 | HIGH | Confirmed, fixed | `5a578061` |
| F3R5-002 | MEDIUM | Confirmed, fixed | `2dcbd768` |
| F3R5-003 | MEDIUM | Confirmed, fixed | `2dcbd768` |
| F3R5-004 | MEDIUM | Confirmed, **bounded** — see below | `2dcbd768` |
| F3R5-005 | MEDIUM | Confirmed — **open**, as documented | — |
| F3R5-006 | MEDIUM | Same as P3-009 — **still open** | — |
| DR-F3R5-001 | MEDIUM design risk | Largely **dissolved** by `5a578061` | `5a578061` |
| DR-F3R5-002 | MEDIUM design risk | **Answered** by `5a578061` | `5a578061` |
| DOC-F3R5-001…004 | — | Fixed | `2dcbd768`, `5a578061` |

**F3R5-001 is the one that mattered, and it is the cost of the previous round's
fix.** The fourth review's F3RRR-001 was a real cross-tenant disclosure and the
ownership check closed it. What I wrote at the time was that the consequence —
"restoring one user's backup into a different user on the same instance now skips
external attachments rather than disclosing them, and a fresh instance skips them
because the objects are not there" — was *deliberate*. It was deliberate. It was
also wrong, and calling it deliberate is what stopped me looking at it again: a
fresh instance and an account whose attachment metadata was deleted are the two
situations backups exist for, and both returned success with the attachments
counted as skipped and the sidecar volume sitting there intact.

The review's diagnosis is exact: "the ownership gate reads the current database,
not the sidecar and not a signed export-time manifest". Of its three recommended
contracts, option 1 is implemented — the export now reads every external object and
carries it in `attachment_blobs`, so the artifact is self-sufficient and there is no
authority question to get wrong. That also dissolves two things I had been treating
as unavoidable:

- **Cross-provider restore.** A `local` backup onto a `database` deployment, and
  the reverse, were both unrestorable skips. The bytes travel, so where they land is
  the target's decision.
- **DR-F3R5-001, the retained source objects.** The retention existed because a
  self-restore's source objects were its own displaced objects, so deleting them
  broke repeat restore. An artifact carrying its own bytes has no source objects, so
  for anything exported from now on the question does not arise. It survives only
  for artifacts produced before this, which is a bounded and shrinking set rather
  than an accidental retention policy.
- **DR-F3R5-002, migration semantics.** Also answered rather than deferred: the
  supported contract is that the artifact is self-contained, and §4 of
  `docs/backup-restore-contract.md` now says what an older artifact can and cannot
  do instead of telling operators to restore a sidecar that will not help them.

What it costs is in the contract and in the commit: artifacts are larger, and a
large attachment set on the encrypted or automatic path now meets
`BACKUP_EXPORT_BUFFER_LIMIT` and is refused with an error naming the ceiling. (Not
the *support* path: `ALWAYS_EXCLUDED_TABLES` drops both `transaction_attachments`
and `attachment_blobs` from support backups, so carried attachment bytes never reach
it -- DOC-F3R6-004 corrected this sentence, which originally named support here too.)
The review's own option 1 asks for a streaming container format so the file need not
be materialised at once; that is not done, so the honest position is that the refusal
is the failure mode, not a silent omission. Not implemented: the signed manifest
(option 2), which would let an artifact authorize a sidecar read for the cases where
carrying bytes is too expensive.

**F3R5-002 and F3R5-003 were both defects in the gate I added one round earlier**,
and F3R5-002 turned out to be wrong one level further up than the review said.
Budgeting wire bytes counts the smallest of the buffers a restore holds; but the
*per-request ceiling* had the same hole, at half the container, so a single legal
request peaked at three times what the pod could hold. `PEAK_MULTIPLE` is now one
named constant from which both numbers derive, and the startup warning is measured
in the units an operator sets so its suggestion is one they can use. The multiple is
a floor rather than a measurement and the code says so; measuring it needs the
cgroup peak-RSS test that has never run here.

F3R5-003 is the sharper of the two as a lesson: I released the reservation on
`ServerResponse.close` and wrote a test that called every close a mid-upload
disconnect. The test named the assumption and then asserted it, which is how an
assumption survives having a test.

**F3R5-004 is bounded rather than closed.** An unauthenticated chunked request can
still occupy the budget, because the gate necessarily runs before authentication;
it can now do so only until the receive deadline expires, so it degrades a
legitimate restore to a retry instead of holding the recovery path closed
indefinitely. The real answers — an ingress body limit, a two-step session with an
upload token, streaming to disk — are named in the contract and none is implemented.

### Open, with reasons

- **F3R5-005** (one table materialised before the export ceiling). Confirmed and
  open through three reviews now. Needs a cursor inside the repeatable-read snapshot
  and a per-chunk budget. It is also the change that would let attachment bytes
  stream rather than accumulate, so it and the remaining half of F3R5-001 are one
  piece of work.
- **F3R5-006** = P3-009 = F3R-008 = F3RR-005 = F3RRR-004. Open across all five
  reviews. Plan in `docs/backup-restore-contract.md` §5; needs a decision on the
  OIDC provider interaction and browser verification.
- **The pre-authentication half of F3R5-004**, above.

### The pattern, four rounds on

§12 recorded that three rounds running had fixed the external-attachment path in
the right direction and left the mirror-image concern unconsidered. This round adds
a fourth row, and it is a different mistake:

| Round | What was fixed | What was left |
|---|---|---|
| F3R-006 | displaced bytes deleted after commit | those keys are the backup's sources |
| F3RR-001/002 | the key is derived, not taken from the file | the id it derives from is also from the file |
| F3RRR-001 | ownership comes from the database | the database is not there when you need a backup |
| F3R5-001 | the bytes travel in the artifact | the artifact is not streamed, so large ones are refused |

The first three were failures of analysis. The fourth is a stated trade with a
readable failure mode, which is a different thing — but the row belongs in the table
because the previous three all *felt* like stated trades at the time. The specific
tell, and the one worth carrying forward: **I wrote "the consequence is deliberate"
and stopped there.** A consequence being intended says nothing about whether it is
acceptable, and the sentence reads as though it does. Where a fix removes a
capability, the thing to write down is who loses it and in what situation — and then
to check whether that situation is the one the feature exists for. Here it was
exactly that situation, twice over.

---

## 14. The sixth-pass re-review (F3R6-001…006, DR-F3R6-001/002)

A sixth review re-checked the branch at `8b829a97` and reported six MEDIUM defects
and two design risks -- no HIGH, no BLOCKER. Most are the second-order consequences
of the fifth round's fix (attachment bytes now travel) and of the admission gate the
round before. Each was verified against the code first.

| ID | Severity | Verdict | Commit |
|---|---|---|---|
| F3R6-001 | MEDIUM | Confirmed -- **open**, = F3R5-005, doc corrected | `bf2e5622` (doc) |
| F3R6-002 | MEDIUM | Confirmed, fixed | `bf2e5622` |
| F3R6-003 | MEDIUM | Confirmed, fixed | `bf2e5622` |
| F3R6-004 | MEDIUM | Confirmed, fixed | `fd4ed827` |
| F3R6-005 | MEDIUM | Confirmed, fixed | `fd4ed827` |
| F3R6-006 | MEDIUM | Same as P3-009 -- **still open** | — |
| DR-F3R6-001 | design risk | Bounded (was F3R5-004's pre-auth half) | — |
| DR-F3R6-002 | design risk | Accepted -- `PEAK_MULTIPLE` is unmeasured | — |
| DOC-F3R6-001…004 | — | Fixed | `bf2e5622`, `fd4ed827` |

**F3R6-002 and F3R6-003 were real integrity holes, and both are the kind that only
show up once you look at the two ends together.** The export loaded an external
object and packaged it without checking it against the size and hash the server
recorded -- while the restore, at the far end, *does* check and would silently drop
it. So the export reported a success the artifact could not honour. And the restore
validated the last duplicate blob row while the SQL committed the first, so a
crafted backup could get corrupt bytes past a check that had approved different
ones. Both are fixed at the point the reviewer identified: verify at export, and
rebuild `attachment_blobs` from the validated bytes so the row inserted is the row
checked.

**F3R6-004 is the one worth dwelling on, because it is the third distinct memory
defect in the same admission path and it says something about the previous two.**
Round four added the aggregate gate; round five corrected it to budget the peak
rather than the wire and to hold the reservation through the handler. This round
points out that *both* of those still measure the compressed upload, and a small
gzip expands to the expanded ceiling no matter how small it was -- so the thing the
gate reserves against and the thing that actually costs memory are different
quantities. The fix is a separate cap on concurrent *processing*, denominated in
the expanded limit, which on the default pod serialises restores to one. Its
virtue is that it does not depend on `PEAK_MULTIPLE` being right: one-at-a-time is
safe under any multiple, as long as one restore fits.

That is the honest boundary of what this round could fix without measurement, and
it lines up with the reviewer's own closing instruction -- *the next review should
not accept further memory-limit changes based only on unit arithmetic; it should
require a cgroup-constrained peak-RSS test.* This environment cannot run that test.
So the numbers here (`PEAK_MULTIPLE = 3`, the quarter/sixth shares, the slot count)
are argued, not measured, and **DR-F3R6-002 stands as an open risk on purpose.**
The processing cap is the design that survives the numbers being wrong; the numbers
themselves still want the RSS test.

**F3R6-005 is a clean bug the review found by arithmetic:** the upload limit floored
to 64 MiB even when the safe value was lower, so a small pod modeled a peak larger
than itself. The floor is gone from the upload derivation; the safe-share invariant
now holds at every container size, and a cramped pod gets a warning instead of an
unsafe number.

### F3R6-001 is F3R5-005 wearing a new number, and the doc now says so

The plain HTTP export was billed as the streaming, unbounded-safe path. It never
fully was -- it materialises each table -- and the fifth round's change made it
worse by accumulating every carried attachment before serialising. I fixed the
*claim* (the code comment and the contract both said "streams and is unaffected",
which was false) but not the *behaviour*: bounding it is the cursor/one-object-at-a-
time work already tracked as F3R5-005, and doing half of it -- streaming attachments
but not the large tables -- would not make the path bounded, so it would buy a more
convincing false claim rather than a fix. The contract now names it the single
highest-value open item and states plainly that attachment bytes travelling (the
F3R5-001 recovery fix) trades a memory cost that only streaming repays. That is the
truthful position: the recovery fix was right, its cost is real, and the repayment
is scheduled, not done.

### The pattern, five rounds on

| Round | What was fixed | What was left |
|---|---|---|
| F3R-006 | displaced bytes deleted after commit | those keys are the backup's sources |
| F3RR-001/002 | the key is derived, not taken from the file | the id it derives from is also from the file |
| F3RRR-001 | ownership comes from the database | the database is not there when you need a backup |
| F3R5-001 | the bytes travel in the artifact | the artifact is not streamed, so large ones are refused |
| F3R6-* | integrity at both ends; processing capped | export is still not streamed; `PEAK_MULTIPLE` still unmeasured |

The through-line for the memory findings specifically (F3R5-002 → F3R5-003 →
F3R6-004): three rounds, three corrections to the same gate, each measuring the
compressed upload and each missing that the cost is downstream of it. The lesson
this round writes down: **when you bound a resource, name the quantity you are
bounding and the quantity that actually costs, and check they are the same one.**
They were not, twice, and the fix that finally holds (serialise processing) is the
one that stopped trying to get the *number* right and bounded the *concurrency*
instead.

### Open, with reasons

- **F3R6-001 / F3R5-005** -- stream the export (cursor + per-chunk budget + one
  attachment at a time). The highest-value open item; it repays the memory cost of
  self-contained artifacts and would replace `PEAK_MULTIPLE` with a measured bound.
- **F3R6-006** = P3-009 = F3R-008 = F3RR-005 = F3RRR-004 = F3R5-006. The OIDC
  step-up, open across all six reviews. Needs the provider-interaction decision and
  browser verification.
- **DR-F3R6-001** -- the pre-authentication half of the upload budget: bounded to a
  120-second window, not closed. Ingress limits or an upload token remain the real
  answer.
- **DR-F3R6-002** -- `PEAK_MULTIPLE` and the derived shares are argued, not
  measured. The cgroup peak-RSS test the reviewer specifies is the way to settle
  them and has not run here.
