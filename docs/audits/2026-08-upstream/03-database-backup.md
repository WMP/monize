
# Monize Full Audit — Phase 3: Database, Migrations, Backup, Restore, and Support Backup

**Audit phase:** 3 of 8  
**Worker chat:** Phase 3 — Database, Migrations, Backup, Restore, and Support Backup  
**Repository:** `kenlasko/monize`  
**Audited baseline SHA:** `d5cea9bfa995885ba5198f9843359362927c0fd4`  
**Audit date:** 2026-08-01  
**Mode:** Read-only static audit using GitHub connector reads pinned to the audited SHA  
**Report filename:** `monize-audit-03-database-backup.md`  
**Completion status:** Complete within the static-access limitations documented below

## Executive finding summary

| Severity | Confirmed findings |
|---|---:|
| BLOCKER | 0 |
| HIGH | 2 |
| MEDIUM | 13 |
| LOW | 1 |
| **Total** | **16** |

The two highest-impact defects are in backup durability. First, all users using the default automatic-backup folder share the same date-based filenames and retention namespace, so one user's job can overwrite or delete another user's backup. Second, destructive restore remaps attachment UUIDs and `storage_key` values while local/S3 bytes remain under their original keys, making externally stored attachments inaccessible after restore.

The remaining confirmed defects include a deterministic restore failure for linked asset/loan accounts, non-atomic automatic-backup writes, arbitrary authenticated filesystem browsing and destination selection, an unusable default Helm backup layout, non-snapshot exports, memory-unbounded buffered exports and restore decompression, weak OIDC destructive-action confirmation, unsafe runtime-role acceptance, runtime write access to migration history, custom-currency portability/de-identification failures, RLS-filtered global currency cleanup, and uncoordinated database lifecycle startup.

No evidence invalidated the fixed audit baseline. No runtime database, backup volume, object store, container, Kubernetes cluster, or CI artifact was available, so all findings are based on deterministic code/schema/configuration paths and proposed executable reproductions rather than executed end-to-end scenarios.

---

## 1. Phase scope

This phase reviewed, at the fixed baseline SHA:

- fresh-install database initialization;
- migration discovery, ordering, tracking, failure behavior, idempotency controls, and startup concurrency;
- current `database/schema.sql` against the retained migration set and the repository's schema-drift guard;
- tables, columns, defaults, checks, unique constraints, foreign keys, indexes, functions, triggers, RLS policies, grants, ownership assumptions, and sequence privileges where statically observable;
- runtime owner/migrator/application-role separation;
- standard backup export, compression, encryption, table coverage, attachment handling, and snapshot consistency;
- automatic backup scheduling, storage path selection, naming, promotion, retention, atomicity, Compose and Helm layouts, and multi-user/multi-replica behavior;
- destructive restore authentication, decompression, version validation, deletion/insertion order, UUID remapping, JSON remapping, timestamp preservation, closure, rollback, and externally stored data;
- support-backup allowlisting, field classification, masking, scaling, relationship closure, account/date scoping, preview behavior, and re-identification risks;
- database lifecycle portions of Microsoft Money staging/import jobs; and
- Phase 1 and Phase 2 findings assigned for independent Phase 3 verification.

This was not a generic checklist review. Every confirmed defect below has a concrete trigger at the audited SHA.

## 2. Audited baseline SHA

`AUDIT_BASELINE_SHA=d5cea9bfa995885ba5198f9843359362927c0fd4`

The baseline commit was fetched successfully through the GitHub connector. Every evidentiary repository file used in this report was re-fetched with:

```text
ref=d5cea9bfa995885ba5198f9843359362927c0fd4
```

The current default branch was not used as audit evidence. Search results were used only to discover candidate paths and were re-fetched at the baseline before being relied upon. A comparison showed the searchable current head differed from the baseline only by later documentation commits, but that observation was not used as a substitute for baseline-pinned reads.

## 3. Method

### 3.1 Evidence sequence

1. Verified the immutable baseline commit.
2. Read the root and nearest scoped repository instructions before implementation code.
3. Read database, backup, RLS, migration, import, Compose, Helm, and CI documentation/configuration.
4. Reconstructed a 111-file migration inventory. Because immutable recursive tree enumeration was unavailable and search was capped, the inventory was assembled from capped path search, direct baseline fetches, and baseline-reachable commit history; critical files were then fetched at the baseline.
5. Read `database/schema.sql` in full in pinned ranges.
6. Traced database initialization and migration execution.
7. Built a role/privilege model from code, schema, policies, Compose, and Helm.
8. Traced standard export, automatic backup, restore, and support backup across controller, DTO, service, transaction, SQL/schema, deployment, and tests.
9. Compared restore order and remapping against every backed-up section and every declared foreign-key edge represented by the support-backup integrity map.
10. Inspected relevant unit/integration tests and CI workflow source.
11. Re-checked each `HIGH` finding against the baseline source path before inclusion.

### 3.2 Static versus executable verification

No repository checkout, PostgreSQL service, S3-compatible service, filesystem volume, Kubernetes cluster, secrets, or CI artifacts were available. No tests or commands were executed against the application. “Confirmed” therefore means the failure follows deterministically from the baseline source/schema/configuration, with an exact executable regression scenario supplied. Runtime-only properties are labeled as design risks or unverified hypotheses.

### 3.3 Repository instruction hierarchy applied

Precedence was applied from nearest scope to broadest scope:

1. `database/CLAUDE.md` for `database/**`.
2. `backend/CLAUDE.md` for `backend/**`.
3. `frontend/CLAUDE.md` only where frontend backup contracts were relevant.
4. Root `CLAUDE.md` repository-wide.
5. `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `docs/**`, `.claude/settings.json`, and `.claude/skills/**` as auxiliary guidance.

Material expectations applied:

- every migration must be idempotent and accompanied by `database/schema.sql` parity;
- full migration filenames, not numeric prefixes alone, identify migrations;
- user-owned database access must use scoped database context;
- multi-statement data changes must share one scoped transaction;
- the runtime RLS role must not be the owner, a superuser, or `BYPASSRLS`;
- backup and restore behavior must preserve tenant isolation, relationship integrity, and timestamps.

`CONTRIBUTING.md` and `.claude/skills/backend.md` still recommend direct TypeORM transaction/`QueryRunner` patterns that conflict with the nearer scoped RLS instructions. This is recorded as documentation drift rather than a new implementation defect.

A search for `AGENTS.md` returned no results, consistent with Phase 1, but the absence could not be proved because recursive immutable tree listing was unavailable.

---

## 4. Confirmed findings

### P3-001 — Automatic backups share a tenant-agnostic filename and retention namespace

- **Classification:** confirmed defect
- **Severity:** HIGH
- **Confidence:** high
- **Independent verification of:** Phase 2 `P2-001`
- **Evidence:**
  - `backend/src/backup/auto-backup.service.ts:25-46`
  - `backend/src/backup/auto-backup.service.ts:126-145`
  - `backend/src/backup/auto-backup.service.ts:276-536`
  - `docker-compose.prod.yml:31-82`
  - `backend/src/backup/auto-backup.service.spec.ts:260-700`
- **Violated invariant:** A tenant's backup artifact and retention policy must be isolated from every other tenant, even when all users accept the default folder.
- **Mechanism:** The default folder is deployment-wide. Daily, weekly, and monthly filenames contain only frequency, date, and extension; they contain no user identifier and are written directly into the shared folder. Retention enumerates the same folder using global filename patterns and applies the current user's retention counts to every matching artifact.
- **Realistic reproduction:**
  1. User A and User B both keep `/data/backups` and have unencrypted backups enabled.
  2. On the same local date, A's job writes `monize-daily-2026-08-01.json.gz`.
  3. B's job later writes the identical path and replaces A's artifact.
  4. Alternatively, give B a shorter retention window; B's retention pass can delete A's older daily/weekly/monthly files. Different encryption states avoid one same-day filename collision but do not isolate retention because both `.json.gz` and `.mzbe` patterns are enumerated.
- **Impact:** Cross-tenant backup loss and false confidence in recovery coverage. One replica and two users are sufficient; replica duplication only amplifies the defect.
- **Recommended correction:** Compute a server-owned per-user directory, for example `/data/backups/<opaque-user-id>/`, and run naming, promotion, listing, and retention only inside it. Do not derive ownership from legacy filenames. Preserve legacy shared files in a read-only quarantine because they cannot be safely attributed after the fact.
- **Recommended regression test:** Use User A and User B with the same configured root and same date. Assert distinct paths, distinct retention listings, and that either user's job cannot overwrite or delete the other's artifacts for both encrypted and unencrypted extensions.
- **Verification method:** Static end-to-end trace of default resolution, filename construction, direct write, weekly/monthly copy, retention enumeration, Compose mount, and tests.

### P3-002 — Restore disconnects local/S3 attachment metadata from the stored bytes

- **Classification:** confirmed defect
- **Severity:** HIGH
- **Confidence:** high
- **Evidence:**
  - `database/migrations/109_transaction_attachments.sql:1-35`
  - `backend/src/attachments/attachments.service.ts:90-155`
  - `backend/src/attachments/storage/local-storage.provider.ts:11-40,100-145`
  - `backend/src/attachments/storage/s3-storage.provider.ts:10-26,75-125`
  - `backend/src/backup/backup.service.ts:375-399`
  - `backend/src/backup/backup.service.ts:1010-1055`
  - `backend/src/backup/backup-id-remap.util.ts:1-65`
  - `.env.example:250-257`
- **Violated invariant:** A successful destructive restore must leave every restored attachment retrievable, or fail before deleting current data.
- **Mechanism:** Local and S3 providers store bytes outside PostgreSQL under a `storage_key` derived from the attachment UUID. Standard backup exports metadata for all providers but embeds bytes only from `attachment_blobs` (database provider). Restore builds a map from each attachment UUID to a fresh UUID, and the generic deep remapper also rewrites an identical `storage_key`. The filesystem object/S3 object remains under the old key; no copy, rename, provider migration, or sidecar manifest is performed. Destructive cleanup deletes metadata directly and does not reconcile external objects.
- **Realistic reproduction:**
  1. Configure `ATTACHMENT_STORAGE_PROVIDER=local` or `s3`.
  2. Create attachment UUID `U`; bytes are stored at key/path `U`, and metadata contains `id=U, storage_key=U`.
  3. Export and restore the backup.
  4. Restore remaps both values to `N`; metadata now points to `N`, while the sidecar file/object still exists at `U`.
  5. Download requests load `N` and fail. Restoring an unchanged sidecar volume/bucket does not repair the mismatch. A provider change across instances also fails because the runtime has one configured provider and no migration path.
- **Impact:** Broad attachment unavailability after a nominally successful restore, plus orphaned external objects. This affects every local/S3 attachment in the restored scope.
- **Recommended correction:** Version the backup format with an explicit attachment-object manifest. Before destructive deletion, stage every external object, verify checksum/size, map old object keys to new attachment IDs, and copy/write under the final provider. Commit database metadata only after staged objects are durable, then clean up old objects after commit. If external bytes are intentionally out of scope, preserve `storage_key` and require/verify an exact sidecar layout rather than remapping it.
- **Recommended regression test:** Round-trip database, local-temp-directory, and S3-emulator providers; restore both to the same provider and to a different provider; verify checksum retrieval for every attachment, rollback behavior on object-copy failure, and absence of orphaned destination objects.
- **Verification method:** Cross-layer trace from schema and upload key creation through export selection, UUID remapping, restore insertion, and provider load path. The full backup integration test was inspected and contains no local/S3 case.

### P3-003 — `accounts.linked_loan_account_id` is not deferred during restore

- **Classification:** confirmed defect
- **Severity:** MEDIUM
- **Confidence:** high
- **Evidence:**
  - `database/migrations/093_accounts_linked_loan_account_id.sql:1-19`
  - `database/schema.sql:130-184`
  - `backend/src/backup/backup.service.ts:350-365`
  - `backend/src/backup/backup.service.ts:600-665`
  - `backend/src/backup/backup.service.ts:1330-1425`
  - `backend/src/backup/backup.service.ts:1530-1590`
- **Violated invariant:** Every self-reference or forward reference in a backup must either target a row already inserted or be stripped and repaired after all target rows exist.
- **Mechanism:** `linked_loan_account_id` is an immediate self-referential FK. Accounts are exported `ORDER BY name` and inserted row-by-row. The restore's deferred-column list covers `linked_account_id`, `source_account_id`, and other forward references, but omits `linked_loan_account_id`; the Phase 3 repair list omits it as well.
- **Realistic reproduction:** Create asset account `Home` linked to loan account `Mortgage`. Export order places `Home` first. During restore, `Home` is inserted with a remapped `linked_loan_account_id` pointing to the remapped `Mortgage` UUID, but `Mortgage` has not yet been inserted. PostgreSQL raises a foreign-key violation and the entire restore rolls back.
- **Impact:** Users with a linked asset/loan pair can have a valid backup that cannot be restored. Support backups containing the same pair inherit the failure.
- **Recommended correction:** Add `linked_loan_account_id` to the `accounts` deferred columns and to `restoreDeferredFkColumns`; apply it only after all account rows exist. Add a closure check before deletion so malformed links fail before destructive work.
- **Recommended regression test:** Round-trip an asset-to-loan link in both lexical orders (`Home`→`Mortgage` and `Z Asset`→`A Loan`), verify the remapped link, and verify rollback on an intentionally missing target.
- **Verification method:** Direct comparison of the schema FK, deterministic export order, insertion implementation, and complete deferred-update registry.

### P3-004 — Automatic backup writes and promotions are not crash-atomic

- **Classification:** confirmed defect
- **Severity:** MEDIUM
- **Confidence:** high
- **Evidence:**
  - `backend/src/backup/auto-backup.service.ts:391-536`
  - `backend/src/backup/auto-backup.service.spec.ts:500-700`
- **Violated invariant:** A final-looking backup filename must refer only to a complete, durable artifact.
- **Mechanism:** Daily backup uses `fs.writeFile` on the final predictable filename. Weekly and monthly promotions use `copyFileSync` directly to final filenames. There is no same-directory temporary file, exclusive creation, `fsync`, atomic rename, checksum sidecar, or startup cleanup of incomplete files.
- **Realistic reproduction:** Kill the process or exhaust the filesystem after truncation but before the write/copy completes. A partial artifact remains with a valid `.json.gz` or `.mzbe` name and is included in later retention calculations. The status row may retain an earlier success if the process dies before failure handling.
- **Impact:** Operators may retain and select an unusable artifact as the newest recovery point; same-date concurrent writers can truncate or replace each other.
- **Recommended correction:** Write to a unique temporary file in the same directory with exclusive creation, stream/checksum it, `fsync` the file, atomically rename to the final path, and `fsync` the directory. Promote through a temporary path and rename. Ignore and clean stale temporary files separately from retention.
- **Recommended regression test:** Inject short writes, ENOSPC, process interruption, and promotion failure. Assert no final filename exists until completion, prior valid artifacts remain intact, and status reflects failure.
- **Verification method:** Static filesystem trace and full unit-spec inspection.

### P3-005 — Any authenticated user can browse container directories and select arbitrary writable absolute paths

- **Classification:** confirmed defect
- **Severity:** MEDIUM
- **Confidence:** high
- **Independent verification of:** Phase 2 `P2-002`
- **Evidence:**
  - `backend/src/backup/backup.controller.ts:48-54,230-275`
  - `backend/src/backup/auto-backup.service.ts:220-274,636-738`
  - `backend/src/backup/auto-backup.service.spec.ts:330-500`
  - `docker-compose.prod.yml:20-82`
- **Violated invariant:** Tenant-facing backup configuration must be confined to an operator-approved storage root and must not expose the process filesystem namespace.
- **Mechanism:** Folder endpoints require authentication but no admin/operator role. Validation requires an absolute normalized path and writable directory but has no allowed-root check, canonical `realpath`, symlink containment, sibling-tenant isolation, or appliance-only mode. The lexical `safePath` protects the generated filename relative to the user-selected directory, not the selected directory itself.
- **Realistic reproduction:** A normal user browses `/`, `/tmp`, or mounted paths, selects any writable absolute directory, then invokes “run now.” A symlink located inside an apparently allowed path can redirect writes outside it because canonical containment is never checked.
- **Impact:** Filesystem structure disclosure, writes into unrelated writable locations, cross-tenant/sibling-directory interaction where permissions are shared, and unsafe coupling to mounted secrets or operational directories if deployment permissions permit.
- **Recommended correction:** Remove arbitrary path selection from normal-user APIs. Compute per-user paths under an operator-configured root. If custom paths are retained for single-user appliance mode, require an explicit admin-only mode, canonicalize existing ancestors with `realpath`, reject symlinks, enforce mount-boundary/allowlist containment, and open files with no-follow/exclusive semantics.
- **Recommended regression test:** As a normal user, assert `/`, `/tmp`, sibling tenant folders, secret mounts, traversal variants, and symlink escapes are rejected; assert only the server-computed tenant directory is writable.
- **Verification method:** Controller/guard trace, path-normalization trace, Compose permission review, and full relevant unit-test review.

### P3-006 — The default Helm backend has no writable or persistent automatic-backup mount

- **Classification:** confirmed defect
- **Severity:** MEDIUM
- **Confidence:** high
- **Evidence:**
  - `helm/values.yaml:45-75`
  - `helm/templates/statefulset-backend.yaml:1-80`
  - `backend/src/backup/auto-backup.service.ts:25-45,126-145`
  - `backend/Dockerfile:60-112`
- **Violated invariant:** A deployment surface that exposes automatic backup must provide a documented writable durable destination, or disable/reject the feature explicitly.
- **Mechanism:** The backend security context sets `readOnlyRootFilesystem: true`. The StatefulSet renders no backend `volumeMounts`, PVC, or writable `emptyDir` for `/data/backups`. The image declares no volume. Auto backup defaults to `/data/backups` and attempts to create/write it.
- **Realistic reproduction:** Install the chart with default values, enable automatic backup, and run it. Directory creation or write fails with a read-only filesystem error; no persistent backup can be produced.
- **Impact:** The feature is operationally unusable in the canonical Helm deployment and may repeatedly report failures while users believe scheduling is configured.
- **Recommended correction:** Add an explicit backup persistence block with PVC/existingClaim, mount path, access mode, ownership/security-context handling, and validation. Disable the UI/API or fail chart rendering when automatic backup is enabled without a durable writable mount.
- **Recommended regression test:** Render the chart with defaults and with backup persistence enabled; run a pod-level write/rename smoke test as UID 1001; verify persistence across pod replacement.
- **Verification method:** Complete Helm template/value and image review.

### P3-007 — Export reads each section in a separate transaction instead of one consistent snapshot

- **Classification:** confirmed defect
- **Severity:** MEDIUM
- **Confidence:** high
- **Evidence:**
  - `backend/src/backup/backup.service.ts:185-316`
  - `backend/src/backup/backup.service.ts:324-531`
- **Violated invariant:** A backup must represent a relationship-closed database snapshot.
- **Mechanism:** Every table query calls a helper that opens its own short `withScopedDb` transaction. Streaming export, buffered export, and support-backup raw collection therefore observe different committed database states.
- **Realistic reproduction:** Pause export after the `accounts` query. Create a new account and a transaction for it, then resume before the `transactions` query. The backup contains the transaction but not its account. The gzip/envelope is valid, but restore fails on `transactions.account_id`, or other interleavings silently omit dependent rows.
- **Impact:** A backup taken while the user is active can be unrestorable or internally stale without any export error.
- **Recommended correction:** Run all reads on one manager in a single read-only `REPEATABLE READ` transaction/snapshot. Stream serialization while retaining that snapshot, and make support/automatic export consume the same snapshot API.
- **Recommended regression test:** Use barriers around the account and transaction queries; commit parent/child creation and deletion during export; assert the resulting artifact is always one of the valid pre- or post-change snapshots and restores successfully.
- **Verification method:** Full export call-chain and transaction-boundary trace.

### P3-008 — Buffered backup paths can exceed the chart's memory limit with ordinary attachment volumes

- **Classification:** confirmed defect
- **Severity:** MEDIUM
- **Confidence:** high
- **Evidence:**
  - `backend/src/backup/backup.service.ts:375-399,535-548`
  - `backend/src/backup/auto-backup.service.ts:391-440`
  - `backend/src/backup/support-backup/support-backup.service.ts:24-145`
  - `helm/values.yaml:45-57`
- **Violated invariant:** Supported backup sizes must not require multiple full in-memory copies beyond the documented deployment limit.
- **Mechanism:** Automatic backup, encrypted standard export, and support backup collect rows, base64 attachment bytes, JSON strings, a joined full payload, a UTF-8 buffer, and gzip/encryption output in memory. The chart's default backend limit is 400 MiB.
- **Realistic reproduction and size example:** Thirty database-provider attachments at 10 MiB each contain 300 MiB raw. Base64 alone is approximately 400 MiB (`300 × 4/3`) before the JSON container, joined string, `Buffer`, gzip output, query result objects, and normal process heap. The pod can be OOM-killed during a supported backup workload.
- **Impact:** Backup jobs fail or kill the backend; no artifact or a partial automatic-backup artifact remains. Support preview/generation can retain large raw exports in cache.
- **Recommended correction:** Introduce a streaming/chunked authenticated backup format, stream attachment blobs, cap total exported bytes, and avoid building duplicate strings/buffers. Until then, enforce a conservative export-size preflight and document/chart memory sizing.
- **Recommended regression test:** Run buffered, encrypted, automatic, and support exports under a 400 MiB cgroup with multiple 10 MiB attachments; assert bounded memory and successful artifact verification.
- **Verification method:** Static allocation/data-flow analysis with chart limits and schema/provider maximums.

### P3-009 — OIDC restore accepts any non-empty string as destructive-action confirmation

- **Classification:** confirmed defect
- **Severity:** MEDIUM
- **Confidence:** high
- **Independent verification of:** Phase 2 `P2-005` restore branch
- **Evidence:**
  - `backend/src/backup/backup.controller.ts:120-174`
  - `backend/src/backup/backup.service.ts:945-979`
  - `backend/src/backup/backup.service.spec.ts:520-650`
- **Violated invariant:** Destructive restore requires a fresh, action-bound identity proof distinct from possession of the current bearer session.
- **Mechanism:** For OIDC users, `verifyAuthentication` checks only that `oidcIdToken` is truthy. The controller accepts the value from `x-restore-oidc-token`; it is not parsed, signed, issuer/audience checked, freshness checked, nonce-bound, or tied to the restore action.
- **Realistic reproduction:** With any valid OIDC-backed JWT/session, submit a backup and `x-restore-oidc-token: x`. The destructive restore passes the purported reauthentication check.
- **Impact:** A stolen or unattended live session can erase and replace the user's financial data without the intended step-up barrier.
- **Recommended correction:** Implement a fresh OIDC authorization/step-up transaction and issue a short-lived, single-use server token bound to user, action, backup digest, nonce, and expiry. Do not treat the login session or arbitrary sentinel as reauthentication.
- **Recommended regression test:** Reject absent, arbitrary, stale, replayed, wrong-user, wrong-action, and wrong-backup proofs; accept exactly one fresh bound proof.
- **Verification method:** Controller-header and authentication-branch trace plus unit/integration test inventory.

### P3-010 — `RLS_MODE=enforce` accepts pre-existing owner, superuser, `BYPASSRLS`, or inherited-power roles

- **Classification:** confirmed defect
- **Severity:** MEDIUM
- **Confidence:** high
- **Independent verification of:** Phase 2 `P2-006`
- **Evidence:**
  - `backend/src/common/db/app-role.ts:44-98,105-165`
  - `backend/src/common/db/rls-config.ts:65-96`
  - `backend/src/db-init.ts:20-105`
  - `backend/src/common/db/app-role.spec.ts:1-145`
  - `backend/src/common/db/rls-config.spec.ts` (full file inspected)
- **Violated invariant:** Enforced RLS must fail closed unless the runtime login is non-owner, non-superuser, non-`BYPASSRLS`, and has no inherited membership that bypasses those boundaries.
- **Mechanism:** A newly created role receives PostgreSQL defaults, but an existing role is only changed to `LOGIN PASSWORD`. Startup never queries `pg_roles`, ownership catalogs, or role memberships. Enforce mode only selects the configured credentials.
- **Realistic reproduction:** Pre-create `monize_app` as the database owner, a superuser, or `BYPASSRLS`; configure valid app credentials and `RLS_MODE=enforce`; start the service. Provisioning does not remove or reject the dangerous attributes, and the application connects using a role that can ignore tenant policies.
- **Impact:** A configuration or managed-PostgreSQL role mistake silently disables the intended tenant boundary.
- **Recommended correction:** At startup, query role attributes, memberships, database/schema/table ownership, and reject unsafe state in enforce mode. Provision with explicit `NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION` and an intentional inheritance model; ensure the runtime role owns no protected object.
- **Recommended regression test:** Create safe, owner, superuser, `BYPASSRLS`, inherited-owner, and inherited-bypass roles in disposable PostgreSQL. Assert only the safe role starts in enforce mode.
- **Verification method:** Role DDL, credential selection, startup, and test-source inspection.

### P3-011 — The runtime application role can modify `schema_migrations`

- **Classification:** confirmed defect
- **Severity:** MEDIUM
- **Confidence:** high
- **Evidence:**
  - `backend/src/common/db/app-role.ts:105-165`
  - `database/migrations/000_schema_migrations.sql:1-7`
  - `database/schema.sql:1880-2005`
- **Violated invariant:** Ordinary runtime credentials must not write migration bookkeeping.
- **Mechanism:** The role receives `SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public`. `schema_migrations` is a public, RLS-exempt table and is not revoked or excluded. Repository comments state it should be written only by the owner/migrator, but grants contradict that boundary.
- **Realistic reproduction:** Connect using `DATABASE_APP_USER` and insert a future migration filename. The next deployment sees it as applied and skips required DDL. Deleting an entry causes a migration body to run again. No application endpoint was found that performs this today; the defect is the database privilege boundary exposed to compromised runtime code or an injection bug.
- **Impact:** Upgrade integrity can be suppressed or destabilized without owner credentials.
- **Recommended correction:** Replace blanket table grants with an explicit runtime allowlist and `REVOKE ALL ON schema_migrations FROM <app-role>`. Add post-migration privilege verification so future infrastructure tables remain excluded.
- **Recommended regression test:** With runtime credentials, assert `SELECT` only if operationally required and assert insert/update/delete/alter/truncate all fail; with owner credentials, assert the migration runner succeeds.
- **Verification method:** Deterministic grant expansion against the current schema and tracker definition.

### P3-012 — Restore performs synchronous decompression without an output bound

- **Classification:** confirmed defect
- **Severity:** MEDIUM
- **Confidence:** high
- **Evidence:**
  - `backend/src/main.ts:60-78`
  - `backend/src/backup/backup.service.ts:918-944`
- **Violated invariant:** Restore resource limits must apply to decompressed data, not only the compressed request body.
- **Mechanism:** Express limits the uploaded compressed/encrypted body (default 500 MB). After optional decryption, restore calls `gunzipSync` with no `maxOutputLength`, ratio limit, streaming bound, or worker isolation, then converts the complete output to a string and parses complete JSON.
- **Realistic reproduction:** An authenticated user uploads a small valid gzip containing a JSON field with hundreds of megabytes or gigabytes of repeated text. The request passes the compressed-body limit, then blocks the event loop and allocates the expanded buffer/string before format validation or the restore transaction.
- **Impact:** Backend process OOM or prolonged event-loop denial of service; on a single replica this affects all users.
- **Recommended correction:** Decompress incrementally with a hard maximum output size, ratio/section/row limits, cancellation, and preferably worker isolation. Validate the envelope and schema incrementally before retaining the full payload.
- **Recommended regression test:** Submit high-ratio valid gzip payloads just below/above the configured expanded limit; assert bounded memory, fast rejection, no data deletion, and healthy concurrent requests.
- **Verification method:** Request-parser and decompression call trace.

### P3-013 — A user backup omits metadata for a custom currency created by another user

- **Classification:** confirmed defect
- **Severity:** MEDIUM
- **Confidence:** high
- **Evidence:**
  - `backend/src/backup/backup.service.ts:324-330,1420-1525`
  - `backend/src/currencies/currencies.service.ts:320-345`
  - `backend/src/currencies/currency-metadata.ts:1-120`
  - `backend/src/currencies/dto/create-currency.dto.ts:1-43`
- **Violated invariant:** Every natural-key reference required to interpret restored financial values must carry or validate the exact referenced definition.
- **Mechanism:** Currencies are shared globally and any user can activate one. Export includes only rows where `created_by_user_id` equals the exporting user. If User B uses a custom currency created by User A, B's backup contains references but not the definition. On a fresh target, `ensureCurrenciesExist` synthesizes metadata from a curated/`Intl` fallback.
- **Realistic reproduction and numerical example:**
  - Input definition created by A: `PTS`, name `Family Points`, symbol `★`, `decimal_places=0`.
  - B activates it and stores an account balance of `7`.
  - B's backup omits the `PTS` currency row.
  - Restore creates `PTS` with name/symbol `PTS` and `decimal_places=2`.
  - **Implementation result:** display semantics become `PTS 7.00`.
  - **Expected result:** `★7` with the original name.
  - **Numeric amount difference:** `0.0000` units; **precision metadata difference:** `+2` decimal places. The corruption is semantic/display precision rather than arithmetic value.
- **Impact:** Cross-instance restore is not full fidelity for shared custom currencies; an existing conflicting natural key can also silently retain unrelated metadata because insertion uses conflict-ignore behavior.
- **Recommended correction:** Export exact definitions for every referenced non-canonical currency, regardless of creator. Version the format with provenance and conflict rules; on restore, require semantic equivalence or perform explicit code remapping rather than silently inventing/accepting metadata.
- **Recommended regression test:** A creates a custom currency, B activates/uses it, B exports, and a fresh instance restores. Assert exact name, symbol, decimal places, all code references, and deterministic conflict behavior.
- **Verification method:** Cross-user activation, export predicate, referenced-code collection, and fallback trace.

### P3-014 — Support backup preserves arbitrary custom-currency identifiers and free text

- **Classification:** confirmed defect
- **Severity:** MEDIUM
- **Confidence:** high
- **Evidence:**
  - `backend/src/backup/support-backup/support-backup-rules.ts:50-72`
  - `backend/src/backup/support-backup/support-backup.service.ts:90-145,220-280`
  - `backend/src/currencies/dto/create-currency.dto.ts:1-43`
  - `docs/support-backup.md:1-90`
- **Violated invariant:** A field advertised as de-identified must not preserve user-authored identifiers or names merely because its table is also used for public reference data.
- **Mechanism:** The support rules keep `currencies.code`, `name`, and `symbol` unchanged. Those fields are arbitrary for user-created currencies: code is any three characters, name is sanitized free text up to 100 characters, and symbol is free text up to 10 characters.
- **Realistic reproduction:** Create currency `KEN`, name `Kenneth Lasko Family Credits`, symbol `KL`. Generate a support backup and decrypt it as the intended support recipient. All three values are present unchanged, directly defeating masking of the user's identity elsewhere.
- **Impact:** Direct personal or organization identifiers can leave the user's system in an artifact described as de-identified. Encryption protects transit/storage only after the password is shared; it does not correct the payload classification.
- **Recommended correction:** Distinguish canonical public currencies from custom rows. For custom rows, pseudonymize code/name/symbol consistently and rewrite every currency-code reference, preserving uniqueness and three-character constraints. Add an explicit field-classification test for custom values.
- **Recommended regression test:** Seed custom code/name/symbol values containing unique personal markers, generate/decrypt support backup, assert no marker survives in any table/JSON path and all currency FKs remain restorable.
- **Verification method:** DTO permissiveness, export predicate, field rules, generated payload flow, and documentation claim comparison.

### P3-015 — Tenant-scoped liveness checks can delete another user's custom-currency preference

- **Classification:** confirmed defect
- **Severity:** MEDIUM
- **Confidence:** high
- **Independent verification of:** Phase 2 `P2-009`
- **Evidence:**
  - `backend/src/currencies/currencies.service.ts:338-402,520-537`
  - `backend/src/backup/backup.service.ts:1280-1335`
  - `database/migrations/018_user_currency_preferences.sql:7-18`
  - `database/migrations/112_rls_policies_direct.sql:33-79`
- **Violated invariant:** Deleting a shared reference row must use a genuinely global liveness decision and must not mutate another tenant through RLS-hidden state.
- **Mechanism:** Currency removal and restore cleanup execute under the current user's scoped RLS transaction. Counts and `NOT EXISTS` queries intended to inspect other users' preferences/references cannot see those rows. The currency FK on `user_currency_preferences` is `ON DELETE CASCADE`.
- **Realistic reproduction A — API removal:** A creates currency `PTS`; B only activates it (preference row, no account). A removes their own preference. A's count sees zero remaining rows; the global check sees no B data; deleting `currencies.PTS` cascades B's hidden preference.
- **Realistic reproduction B — restore:** A restores a backup. Cleanup checks `user_currency_preferences ... user_id != A`, but A's RLS policy only exposes `user_id=A`, so B's preference is invisible. The currency is deleted and later reinserted; B's preference remains lost. If B has a non-cascading account/transaction reference, the delete can instead abort A's entire restore.
- **Impact:** Limited but real cross-tenant data loss or another user's restore failure.
- **Recommended correction:** Prefer soft retirement/no physical deletion of shared currency codes. If deletion remains, perform it through a narrowly scoped owner-controlled database function that atomically checks every global reference outside tenant RLS, with explicit authorization and audit, or move custom currencies to tenant-scoped identifiers.
- **Recommended regression test:** In enforce mode, create A/B with preference-only and account-reference variants. Exercise both currency removal and A's restore. Assert B's preferences/references remain unchanged and A's operation returns a safe conflict when the currency is globally live.
- **Verification method:** Service transaction trace, restore cleanup SQL, FK action, and direct-policy evaluation.

### P3-016 — Database initialization and migrations are not serialized across backend replicas

- **Classification:** confirmed defect
- **Severity:** LOW
- **Confidence:** high
- **Evidence:**
  - `backend/docker-entrypoint.sh:1-15`
  - `backend/src/db-init.ts:20-130`
  - `backend/src/db-migrate.ts:250-397`
  - `backend/src/db-migrate.spec.ts:1-300`
- **Violated invariant:** Exactly one process should claim database lifecycle work, while other replicas wait and then verify the resulting state.
- **Mechanism:** Every backend process runs `db-init` followed by `db-migrate`. Neither uses a PostgreSQL advisory lock or atomic migration claim. Migrators read the applied filename set before per-file transactions. Two processes can both consider a file pending; after one commits, the other reaches the same tracker primary key and exits. Fresh initializers also use a check-then-apply flow and can race on first install.
- **Realistic reproduction:** Start two backend pods simultaneously against a fresh database or one pending migration. One completes; the other encounters duplicate DDL/tracker state, rolls back its current transaction, and exits under `set -e`. It normally succeeds after restart once it observes the winner's state.
- **Impact:** Avoidable crash/restart and rollout instability. No persistent corruption was established because each migration file is transactional and a false success record is not written before commit.
- **Recommended correction:** Hold a well-known session advisory lock across initialization and all migration discovery/application, or run database lifecycle as one deployment Job/init step. Waiting replicas should re-read and verify state after acquiring the lock.
- **Recommended regression test:** Launch two real migrator processes against the same disposable PostgreSQL database for fresh install and pending upgrade. Assert both exit successfully, each migration is recorded once, and no partial catalog state remains after injected failure.
- **Verification method:** Entrypoint, initialization, migration transaction, tracker, and unit-test trace.

---

## 5. Design risks requiring a decision

These are not counted as confirmed defects because the intended product contract or runtime behavior was not sufficiently established.

| ID | Risk | Evidence and decision required |
|---|---|---|
| DR-001 | Migration history has no checksum/content identity. | `schema_migrations` stores only filename. Editing an applied file is invisible; renaming makes the same body appear new; deleting a file loses auditability. Decide whether immutable releases are sufficient or add hash/version metadata and startup verification. |
| DR-002 | `db-init` treats existence of `users` as proof of a complete fresh schema. | A manually damaged/partially restored database containing `users` but missing later objects skips `schema.sql`. Normal one-message schema application may be atomic, but the sentinel is not a catalog-health check. |
| DR-003 | `ai_provider_configs.api_key_enc` is copied as instance-key ciphertext. | Standard backup includes the row, but decryption uses the target instance's `AI_ENCRYPTION_KEY`. Cross-instance restore with a different key leaves provider configs unusable. Decide whether secrets should be omitted/re-entered or re-encrypted through an explicit portable envelope. |
| DR-004 | Destructive restore removes delegate grants/favourites but does not back them up. | `account_delegate_grants` and `delegate_account_favourites` cascade from accounts and are intentionally excluded. Existing delegation relationships can survive while permissions/favourites disappear. Define whether this security reset is intentional and document/test it. |
| DR-005 | `INSERT ... ON CONFLICT DO NOTHING` can hide skipped rows and overstate `restored` counts. | `insertRows` increments its counter regardless of affected-row count and performs no post-restore cardinality/closure verification. UUID remapping prevents most ordinary collisions, but natural/composite conflicts and crafted data need an explicit contract. |
| DR-006 | External object writes/deletes and database transactions are not one atomic unit. | Attachment upload/removal invokes local/S3 operations inside a database transaction callback. A database commit failure after object success, or object failure after partial external effects, can orphan or remove bytes. Phase 4 should verify failure injection and compensation. |
| DR-007 | Backup format compatibility is strict equality with no migration path. | Version mismatch is correctly rejected before deletion, but the only supported version is `1`; there is no documented compatibility window, feature flags, or offline upgrader. Define forward/backward compatibility before incrementing the format. |
| DR-008 | The runtime role can set custom session GUCs if arbitrary SQL execution is obtained. | RLS policies trust `app.user_id`/`app.bypass_rls`; PostgreSQL custom GUCs are session-settable. This architecture protects against omitted tenant predicates, not arbitrary SQL injection or stolen DB credentials. Confirm and document the threat model; consider a separate narrowly privileged system role instead of a bypass flag. |
| DR-009 | Support preview returns raw `before` rows. | Preview is owner-authenticated and intentionally shows before/after samples, but it is not de-identified output and must never be logged, cached outside the process, or sent to support. |
| DR-010 | Support backup preserves linkage-rich dates, prices, rates, and structure. | The documentation honestly limits protection to casual exposure. Exact transaction dates plus per-unit prices/average costs/market attributes can identify a masked security. Decide whether stronger privacy modes are needed. |
| DR-011 | The support raw-export cache retains complete sensitive exports in process memory. | Expired entries are removed only when a later support request invokes cache cleanup. A burst can leave large raw snapshots resident until another call or process restart. Add bounded LRU/byte limits and timer-based eviction if the cache remains. |
| DR-012 | Crafted backup references not present as backed-up row IDs are not preflight-validated. | Deep remapping rewrites exact IDs it collected but leaves arbitrary UUIDs unchanged. Direct-table RLS policies check `user_id`, not every referenced parent's ownership. An enforce-mode two-user test is required to determine whether crafted foreign keys can create cross-tenant relationships through PostgreSQL RI checks. |

## 6. Missing tests

| ID | Classification | Missing coverage | Relevant paths |
|---|---|---|---|
| MT-001 | confirmed missing test | Two concurrent `db-init`/`db-migrate` processes and advisory-lock behavior. | `backend/src/db-init.ts`, `backend/src/db-migrate.ts`, `backend/src/db-migrate.spec.ts` |
| MT-002 | confirmed missing test | A real supported historical schema upgraded through every retained migration and compared with fresh schema, including owners, grants, default privileges, comments, and role attributes. | `scripts/verify-schema.sh`, `database/schema.sql`, `database/migrations/**` |
| MT-003 | confirmed missing test | Enforce-mode startup rejects owner/superuser/`BYPASSRLS`/dangerous membership roles. | `app-role.spec.ts`, `rls-config.spec.ts` |
| MT-004 | confirmed missing test | Runtime role cannot write `schema_migrations`, alter/create/truncate objects, disable triggers/RLS, or assume another role. | `app-role.ts` |
| MT-005 | confirmed missing test | Two users sharing the default backup root cannot overwrite or delete each other's daily/weekly/monthly files. | `auto-backup.service.spec.ts` |
| MT-006 | confirmed missing test | Temp-file/rename atomicity, ENOSPC, short write, process death, stale partial cleanup, and concurrent same-date writers. | `auto-backup.service.spec.ts` |
| MT-007 | confirmed missing test | Allowed-root enforcement, `/`, `/tmp`, sibling directories, mounted secrets, and symlink escape. | `auto-backup.service.spec.ts`, `backup.controller.ts` |
| MT-008 | confirmed missing test | Helm render/pod smoke test for writable persistent backup storage as UID 1001. | `helm/templates/statefulset-backend.yaml` |
| MT-009 | confirmed missing test | Export under concurrent parent/child create/delete using one repeatable snapshot. | `backup.service.spec.ts`, `backup-restore.integration.spec.ts` |
| MT-010 | confirmed missing test | Buffered export memory ceiling with multiple maximum-size database attachments. | backup tests, Helm resources |
| MT-011 | confirmed missing test | Expanded-size/decompression-ratio limit and event-loop health under a gzip bomb. | restore unit/integration tests |
| MT-012 | confirmed missing test | Local/S3 attachment round-trip, storage-key remap, provider change, sidecar failure, and compensation. | `backup-restore.integration.spec.ts` |
| MT-013 | confirmed missing test | Fresh OIDC step-up proof, expiry, nonce/action binding, replay prevention, and backup-digest binding. | `backup.service.spec.ts` |
| MT-014 | confirmed missing test | `linked_loan_account_id` in both account insertion orders. | `backup-restore.integration.spec.ts` |
| MT-015 | confirmed missing test | Shared custom currency created by A and exported/restored by B. | backup integration tests |
| MT-016 | confirmed missing test | Custom currency identifiers are transformed in support backup. | support golden/integration tests |
| MT-017 | confirmed missing test | Two-user enforce-mode currency removal and restore cleanup preserve the other user's preferences/references. | currency and backup integration tests |
| MT-018 | confirmed missing test | AI provider config restore across different `AI_ENCRYPTION_KEY` values. | backup integration tests |
| MT-019 | confirmed missing test | Documented behavior for delegation grants/favourites across destructive restore. | backup integration tests |
| MT-020 | confirmed missing test | Affected-row counts and post-restore row/FK closure verification when `ON CONFLICT DO NOTHING` fires. | restore tests |
| MT-021 | confirmed partial test gap | Commit cleanup and resumed stamping are covered; explicit rollback, thrown-error, and nested scoped-call cleanup were not located. | `with-context.ts`, `scoped-db.ts`, migration 111, `rls-helpers-and-trigger.integration.spec.ts` |
| MT-022 | unexecuted required scenario | Crafted backup containing another tenant's UUID in direct and indirect FK columns. | restore, RLS migrations 112–114 |

## 7. Documentation issues

| ID | Classification | Issue |
|---|---|---|
| DOC-001 | stale documentation | `CONTRIBUTING.md` and `.claude/skills/backend.md` recommend direct transaction/`QueryRunner` patterns prohibited by the nearer RLS-scoped instructions. This preserves Phase 1 `P1-003`; it is not duplicated as a Phase 3 implementation defect. |
| DOC-002 | stale documentation | `.claude/skills/infrastructure.md` references older initialization/volume assumptions, including `database/init.sql`, while current production uses `schema.sql`, migrations, and explicit Compose mounts. |
| DOC-003 | incomplete recovery documentation | `.env.example` says local/S3 bytes must be backed up alongside the database, but does not disclose that restore remaps `storage_key`, so an unchanged sidecar directory/bucket is still unusable. |
| DOC-004 | deployment gap | Helm documentation does not explain that the default read-only backend has no automatic-backup mount or provide a supported persistence configuration. |
| DOC-005 | overbroad de-identification claim | `docs/support-backup.md` says free-text names are masked, but user-created currency code/name/symbol are retained unchanged. |
| DOC-006 | ambiguous parity claim | `scripts/verify-schema.sh` prints that schema matches “the state produced by all migrations,” while it actually applies current `schema.sql` first and then proves retained migrations are no-ops/idempotent on that current state. |
| DOC-007 | missing compatibility contract | Backup format versioning, cross-version policy, AI-secret portability, delegation reset behavior, and externally stored attachment recovery are not documented as one restore contract. |

---
## 8. Complete migration inventory

The inventory contains **111 migration files**. It was reconstructed under the connector limitations described in Section 3. All names below were tied back to the baseline; critical files were fetched in full. Historical duplicate numeric prefixes are intentional filename-distinct entries and are not a defect.

```text
000_schema_migrations.sql
018_user_currency_preferences.sql
019_add_missing_indexes.sql
020_add_pending_two_factor_secret.sql
021_security_sector_data.sql
022_add_account_lockout.sql
022_security_fixes.sql
023_add_2fa_backup_codes.sql
024_payee_is_active.sql
025_favourite_report_ids.sql
026_trusted_device_fingerprint.sql
027_credit_card_date_options.sql
028_credit_card_statement_fields_constraint.sql
029_share_price_6_decimals.sql
030_import_column_mappings.sql
031_payee_aliases.sql
032_tags.sql
033_scheduled_transaction_tag_ids.sql
034_refresh_token_remember_me.sql
035_scheduled_transaction_split_tags.sql
036_show_created_at_preference.sql
037_budget_alerts_nullable_budget.sql
038_exclude_from_net_worth.sql
039_action_history.sql
040_default_exchange_preference.sql
041_every4weeks_frequency.sql
042_favourite_sort_order.sql
043_auto_backup_settings.sql
044_auto_backup_time.sql
045_auto_backup_timezone.sql
046_timezone_default_browser.sql
047_time_format_preference.sql
048_investment_transaction_exchange_rate.sql
049_ai_provider_costs.sql
050_ai_provider_cost_currency.sql
051_cascade_securities_user.sql
052_dismissed_update_version.sql
053_add_quote_provider.sql
054_recent_transactions_limit.sql
055_oauth_provider.sql
056_monte_carlo_scenarios.sql
057_monte_carlo_use_historical_returns.sql
058_monte_carlo_cash_flows.sql
059_security_prices_adjusted_close.sql
060_securities_historical_backfill_attempted_at.sql
061_monte_carlo_scenario_sort_order.sql
062_investment_splits.sql
063_scheduled_investment_splits.sql
064_scheduled_investment_transactions.sql
065_scheduled_transactions_inline_investment.sql
066_scheduled_transaction_overrides_investment.sql
067_user_preferences_last_client_timezone.sql
068_account_delegates.sql
069_account_delegate_capabilities.sql
070_account_delegate_granular_capabilities.sql
071_account_delegate_sections.sql
072_category_fk_set_null_on_delete.sql
073_delegate_account_favourites.sql
074_users_is_delegate_only.sql
075_backup_encryption.sql
075_emergency_access.sql
076_users_last_activity_at.sql
077_investment_reports.sql
078_investment_transaction_transfer_link.sql
079_securities_is_favourite.sql
080_transaction_search_trgm_indexes.sql
081_user_preferences_language.sql
082_institutions.sql
083_user_preferences_color_theme.sql
084_action_history_i18n.sql
085_users_email_verification.sql
086_security_description_and_tags.sql
087_securities_country_weightings.sql
088_user_preferences_ai_bubble_enabled.sql
089_user_preferences_dashboard_widgets.sql
090_user_preferences_dashboard_widget_config.sql
091_loan_scenarios.sql
092_loan_rate_changes.sql
093_accounts_linked_loan_account_id.sql
094_accounts_overpayment_category_id.sql
095_accounts_overpayment_memo.sql
096_accounts_overpayment_payee_id.sql
097_accounts_interest_booking_mode.sql
098_loan_scenarios_recurring_extra_mode.sql
099_loan_scenarios_recurring_extra_frequency.sql
100_accounts_fx_fee.sql
101_transactions_original_currency.sql
102_transaction_splits_drop_is_fx_fee.sql
103_loan_scenarios_target_monthly_payment.sql
104_loan_scenarios_widen_mode_columns.sql
105_loan_scenarios_widen_recurring_extra_mode.sql
106_user_preferences_whats_new.sql
107_user_preferences_tour_progress.sql
108_users_fk_cascade.sql
109_transaction_attachments.sql
110_transactions_drop_legacy_cleared_flags.sql
111_rls_helpers_and_trigger.sql
112_rls_policies_direct.sql
113_rls_policies_indirect.sql
114_rls_policies_special.sql
115_securities_asset_weightings.sql
116_every2months_semiannual_frequency.sql
116_unit_prices_precision.sql
117_mny_import_staging_and_jobs.sql
117_security_documents.sql
118_security_documents_rls.sql
119_scheduled_investment_price_precision.sql
120_securities_websites.sql
121_security_quote_time_and_market_hours.sql
122_payee_website.sql
123_rls_enable.sql
```


Duplicate numeric prefixes present:

- `022_add_account_lockout.sql` and `022_security_fixes.sql`
- `075_backup_encryption.sql` and `075_emergency_access.sql`
- `116_every2months_semiannual_frequency.sql` and `116_unit_prices_precision.sql`
- `117_mny_import_staging_and_jobs.sql` and `117_security_documents.sql`

The runner sorts and tracks full filenames, so these pairs do not collide merely because their numeric prefixes repeat.

## 9. Fresh-schema versus migrated-schema parity ledger

| Category | Fresh state evidence | Migrated-state evidence | Status / limitation |
|---|---|---|---|
| Migration discovery and order | N/A | `.sql` files, full-filename lexicographic sort in `db-migrate.ts` | Confirmed statically. Numeric prefixes are not parsed. |
| Migration tracker | `schema_migrations` present in `schema.sql` | Migration `000` and runner `CREATE TABLE IF NOT EXISTS`; filename PK | Current definition aligned. No checksum/content identity. |
| Tables and columns | `database/schema.sql` read in full | Complete filenames inventoried; critical/table-creating migrations inspected; no-op drift script exists | No material mismatch found statically. Historical replay not executed. |
| Types, nullability, defaults | Full current schema inspected | Critical migrations sampled/full; no-op drift script compares `pg_dump --schema-only` | Static/current-state confidence medium; historical path unverified. |
| Primary/unique/check constraints | Full current schema inspected | Critical migrations and migration lint inspected | No confirmed mismatch. Semantic data upgrades not exercised. |
| Foreign keys and actions | Full schema and support FK registry inspected | Critical FK migrations inspected | Current closure map is strong; restore omission for `linked_loan_account_id` is P3-003. |
| Indexes, partial/expression indexes | Full current schema inspected | Critical index migrations inspected; drift script would retain index definitions | No confirmed current mismatch; all 111 files were not read in full. |
| Sequences/ownership | Current serial columns inspected | Runtime receives sequence `USAGE, SELECT` | Ownership not compared because drift dump uses `--no-owner`; catalog not available. |
| Functions and volatility/security | Current helper/timestamp functions and migration 111 inspected | No `SECURITY DEFINER` found by search; functions are expected invoker helpers | Search cannot prove repository-wide absence; function ownership/execute grants unverified in catalog. |
| Triggers | Current schema and migration 111/117 inspected | Drift dump retains trigger definitions | Current timestamp/import triggers aligned statically. |
| RLS policies / `relrowsecurity` | Schema policies/enables inspected | Migrations 112–114/123 path sampled; 112 and 123 read in full | Current definitions aligned statically; actual production enablement not established. |
| Grants | App-role grant generator inspected | Not represented by migration drift check | **Not parity-tested.** Blanket DML creates P3-011. |
| Default privileges | App-role code sets them for the current owner | Drift check omits privileges | **Not parity-tested.** Future objects depend on migrator identity. |
| Database/schema/table/function ownership | Expected to be the `DATABASE_USER` applying schema/migrations | Runtime expected not to own objects | **Not verified.** No live catalogs. |
| Extensions | Current schema extension assumptions inspected | Retained migrations assume extensions already available | Historical/fresh extension provisioning not executed. |
| Comments treated as contract | Current schema comments inspected | `pg_dump --no-comments` explicitly omits them | **Not parity-tested.** |
| Enum/lookup/check values | Current check constraints and code constants sampled | Migration changes inventoried | No material mismatch confirmed; not exhaustively data-tested. |
| Fresh install | `db-init` applies current `schema.sql` when `users` is absent | N/A | Source path confirmed; not executed. |
| Sequential upgrade | Repository notes older migrations were rolled into `schema.sql` | Retained migrations are applied atop current schema twice by `verify-schema.sh` | The repository cannot reconstruct an earliest historical schema solely from retained migrations. No claim of full upgrade parity is made. |
| CI guard | Workflow invokes migration lint, PostgreSQL integration, and schema verification | Workflow source inspected | CI result/artifacts were unavailable; source presence is not proof of pass. |

### Parity conclusion

The strongest supported conclusion is: the current `schema.sql` is internally coherent with the inspected critical migrations and the repository has a guard that checks retained migrations are re-runnable/no-op on the current schema. This audit did **not** establish executable parity between an initial supported historical schema and the baseline, nor parity of ownership, grants, default privileges, comments, and role attributes.

## 10. Database role and privilege matrix

| Field | Owner / migrator (`DATABASE_USER`) | Runtime app role (`DATABASE_APP_USER`, default `monize_app`) | Test role / test database | Other / managed roles |
|---|---|---|---|---|
| Creation path | External PostgreSQL/Compose/CNPG configuration | `provisionAppRole()` creates or updates, or operator pre-creates | Integration setup/owner-like credentials; some tests use entity synchronization | Provider/operator controlled |
| Login | Yes | Yes | Yes | Environment-dependent |
| Superuser | Compose bootstrap user commonly has broad bootstrap power; managed environment may not | Expected no; **not validated for existing role** | Not a production boundary | Environment-dependent |
| `BYPASSRLS` | Owner can bypass as owner unless forced; documented architecture relies on separation | Expected no; **not validated** (P3-010) | Not verified | Environment-dependent |
| Inherit / membership | Not catalog-verified | Default inheritance on new role; existing memberships not validated | Not verified | Provider-dependent |
| Database ownership | Expected owner/migrator | Must not own; not verified | Test owner | Provider-dependent |
| Schema ownership | Expected owner/migrator | Receives `USAGE`, not intended owner | Test owner | Provider-dependent |
| Table/function ownership | Objects created by schema/migrations under owner | Must not own; not verified | Test owner | Provider-dependent |
| Table grants | Owner implicit | `SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN public`; includes infrastructure tables | Broad | Provider-dependent |
| Sequence grants | Owner implicit | `USAGE, SELECT ON ALL SEQUENCES` | Broad | Provider-dependent |
| Function execute | Owner implicit; default PostgreSQL PUBLIC execute applies unless revoked | Not explicitly restricted; inspected helpers are invoker functions | Broad | Provider-dependent |
| Default privileges | App-role provisioning runs `ALTER DEFAULT PRIVILEGES` for objects subsequently created by the current owner | Receives future table DML and sequence access | Not material | Breaks if migrations use a different owner and grants are not repeated afterward |
| Runtime use | `db-init`, `db-migrate`, bootstrap/admin operations | TypeORM application connection when RLS enforce credentials resolve | Tests | CNPG/operator tasks |
| Can write `schema_migrations` | Yes, intended | **Yes, unintended** (P3-011) | Yes | Depends |
| Can alter schema / disable triggers / disable RLS / truncate | Yes | Not through intended grants if safely non-owner; unsafe pre-existing role can | Usually yes | Depends |
| Can change role | Yes as permitted | Should not; memberships not validated | Not verified | Depends |
| Can set custom GUCs | Yes | Yes; architecture assumes no arbitrary SQL execution | Yes | Depends |
| Can access RLS-exempt infrastructure | Yes | Yes according to table grants; some exemptions intentional, `schema_migrations` is not | Yes | Depends |
| Failure mode | Wrong owner can break grants/default privileges | Missing role/password prevents connection; unsafe role can silently bypass RLS | Test-only | Managed restrictions may prevent role creation/grants |
| Test coverage | Migration unit tests and integration setup | SQL generation/password handling only; no catalog privilege matrix | Partial | Missing |

### Ordinary-runtime capability conclusion

With a safely provisioned non-owner role, ordinary runtime is not intentionally granted `ALTER`, `TRUNCATE`, schema `CREATE`, trigger disabling, or RLS disabling. It is, however, granted DML to every table including `schema_migrations`; it can set custom GUCs; and startup does not prove it lacks owner/superuser/`BYPASSRLS`/membership powers.

## 11. Automatic-backup namespace and filesystem assessment

| Property | Baseline behavior | Assessment |
|---|---|---|
| Default root | `/data/backups` or `BACKUP_CONTAINER_DIR` | Shared deployment namespace; P3-001 |
| Custom root | Any normalized writable absolute directory | No tenant/operator root; P3-005 |
| Daily name | `monize-daily-YYYY-MM-DD.(json.gz|mzbe)` | No user component |
| Weekly/monthly name | Frequency/date plus same extension | No user component |
| Encryption extension | `.mzbe` when stored password resolves; `.json.gz` otherwise | Encryption failure is correctly fail-loud; no silent downgrade found |
| Direct write | `fs.writeFile(finalPath, payload)` | No temp/rename; P3-004 |
| Promotion | `copyFileSync` to final weekly/monthly path | No atomic promotion |
| Retention | Enumerates all matching names in selected folder | Cross-user deletion in shared root |
| Concurrent same-date jobs | Same target path | Last writer wins or partial concurrent state |
| Symlink handling | Lexical path checks only | `realpath`/no-follow absent |
| Compose | One backend-wide host mount to `/data/backups` | Persists data but does not isolate tenants |
| Helm | Read-only root, no backend volume mount | Feature unusable by default; P3-006 |
| Multi-replica | Every replica can run due-job loop; no distributed lock | Not a defect by itself, but amplifies same-path writes and duplicate work |
| Status consistency | Success/failure stored after file operations | Process death can leave artifact/status disagreement |
| Storage exhaustion | Error caught in normal path | Partial final file can remain |
| Legacy migration | Filenames contain no owner identity | Existing shared files cannot be safely auto-attributed; preserve/quarantine rather than move into arbitrary tenant directories |

## 12. Backup and restore cross-layer trace

### 12.1 Standard backup export

```text
POST /backup/export
→ JWT / controller
→ optional x-export-password
→ BackupService.streamExport
→ getTableQueries
→ one withScopedDb transaction per table query
→ JSON serialization
→ gzip stream for plaintext OR full-buffer gzip + AES-256-GCM for encrypted
→ HTTP response
```

Key conclusions:

- Table coverage is guarded by an integration test that requires each live table to be exported or explicitly excluded.
- Database-provider attachment bytes are base64 encoded and exported; local/S3 bytes are not.
- Plain export streams the JSON/gzip response, but each SQL query still materializes its result; encrypted export buffers the whole artifact.
- Export is not one database snapshot (P3-007).
- Crypto uses authenticated AES-256-GCM with random salt/IV and scrypt; wrong password and tampering are tested. No material crypto-format defect was confirmed.

### 12.2 Automatic backup

```text
cron/manual trigger
→ enumerate due user settings
→ withUserContext(user)
→ resolve stored encryption password
→ BackupService.exportToBuffer
→ resolve user-selected/default root
→ final daily write
→ optional weekly/monthly direct copy
→ folder-wide retention
→ status update
```

Key conclusions: shared namespace (P3-001), non-atomic writes (P3-004), unrestricted roots (P3-005), buffered-memory risk (P3-008), and deployment divergence between Compose and Helm (P3-006).

### 12.3 Restore

```text
POST /backup/restore
→ JWT + demo restriction
→ raw compressed/encrypted body (default compressed limit 500 MB)
→ local password OR OIDC sentinel check
→ decrypt if MZBE
→ synchronous gunzip + JSON.parse
→ exact version/exportedAt validation
→ build UUID remap and deep-remap exact UUID strings
→ withPreserveTimestamps
→ one withScopedDb transaction
   → FK-ordered destructive delete
   → ensure currencies
   → FK-ordered inserts
   → deferred FK updates
→ commit/rollback
→ response counts
```

Positive controls confirmed:

- version validation occurs before destructive deletion;
- all database deletion/insertion/repair is in one transaction;
- invalid password, invalid gzip/JSON, and wrong version fail before data mutation;
- unknown column names are removed using `information_schema`, preventing crafted-key SQL injection;
- target `user_id` is forced on direct user-owned rows;
- database-provider blobs participate in the same transaction;
- timestamp preservation uses a transaction-local GUC.

Material exceptions: OIDC step-up (P3-009), unbounded expansion (P3-012), linked-loan ordering (P3-003), external objects (P3-002), currency cleanup/portability (P3-013/P3-015), and no post-insert affected-row/closure verification (DR-005).

### 12.4 Support backup

```text
POST /backup/support-export or /preview
→ JWT + DTO
→ mandatory password on public DTO
→ raw standard export collection/cache
→ date/account/section scoping
→ FK and non-FK closure scrub
→ allowlisted per-column / per-JSON-key transformations
→ derived-money reconciliation
→ fresh UUID remap
→ gzip
→ AES-256-GCM for public generation
```

Positive controls confirmed:

- Public DTO requires a password of at least eight characters.
- Unknown tables/columns are omitted by allowlist.
- Integration tests compare rules to the live schema and FK map.
- JSON handlers are allowlists and drop unknown keys.
- Attachment and AI-config tables are excluded.
- Price history is excluded by default.
- Date/account scoping adjusts opening balances and scrubs dangling references.

Exception: custom currency fields are misclassified as public reference data (P3-014). The documented privacy model intentionally preserves dates/structure and is not anonymity against a determined linker.

---

## 13. ID-remapping matrix

### 13.1 Remapping algorithm and global behavior

- `collectRowIdRemap` collects valid UUID values from each row's `id` field and assigns a fresh UUID.
- `deepRemapIds` recursively replaces any exact string equal to a collected old UUID, including scalar FKs, arrays, and JSON object values.
- Source `user_id` is not part of the map because `users` is not exported; direct user-owned rows are forcibly scoped to the restoring user during insertion.
- Sequence-backed identifiers are stripped and regenerated by PostgreSQL.
- Natural/global keys such as currency code are preserved and separately ensured.
- Arbitrary UUIDs not present as exported row IDs remain unchanged; relationship closure is not preflight-validated for a normal backup.
- Inserts use `ON CONFLICT DO NOTHING`; there is no explicit collision/error report or post-insert closure audit.

| Table / section | Primary identifier and remap | Foreign keys / deferred links | JSON / embedded references | Global key, collision, missing-parent behavior | Test / verification status |
|---|---|---|---|---|---|
| `currencies` | Natural key `code`; not UUID-remapped | `created_by_user_id` is not portable ownership | None | Code preserved; exact metadata exported only for creator; conflict ignored; missing referenced code synthesized | P3-013; custom/shared case missing |
| `user_preferences` | `user_id` replaced by target user | `default_currency` preserved/ensured | `favourite_report_ids` and UUID strings in widget/config JSON are recursively remapped | Unique target row; conflict-ignore can hide a skipped row | Broad integration, no affected-row assertion |
| `user_currency_preferences` | Composite `(target user_id, currency_code)` | Currency code preserved/ensured | None | Cascades with global currency deletion; natural-key conflict ignored | P3-013/P3-015 gaps |
| `categories` | UUID `id` remapped | `parent_id` stripped then restored | None | Missing deferred parent fails update unless null; full backup expected closed | Parent remap tested |
| `payees` | UUID `id` remapped | `default_category_id` deferred | None | Parent must exist after category insert | Tested |
| `payee_aliases` | UUID `id` remapped | `payee_id` inline-remapped | None | Missing parent causes FK rollback | Basic coverage only |
| `institutions` | UUID `id` remapped | None to exported parent | Logo bytes base64-decoded, not an ID | Unique `(user,name)` conflict ignored | Institution/deferred account link tested |
| `accounts` | UUID `id` remapped | Self: `linked_account_id`, `source_account_id` deferred; `linked_loan_account_id` **not deferred**; category/payee/institution/schedule references; currency preserved | UUID-looking strings in any JSON-like field would remap; no primary JSON ID field identified | Missing inline parent rolls back; P3-003 for linked loan | Linked account/institution tested; linked loan missing |
| `tags` | UUID `id` remapped | None | None | User/name uniqueness after wipe | Junction coverage tested |
| `scheduled_transactions` | UUID `id` remapped | Account/payee/category/transfer/funding IDs remapped; `investment_security_id` deferred | `tag_ids` UUID array and nested split/config IDs recursively remapped | Missing required account rolls back | Partial integration coverage |
| `scheduled_transaction_splits` | UUID `id` remapped | Schedule/category/transfer IDs remapped; `investment_security_id` deferred | None beyond row fields | Missing required schedule rolls back | Partial |
| `scheduled_transaction_overrides` | UUID `id` remapped | `scheduled_transaction_id` inline | `splits[*].categoryId` and exact UUID strings remapped | Unknown/dangling JSON IDs not semantically validated | Support handler tested; normal closure not fully tested |
| `scheduled_transaction_split_tags` | Composite link; no standalone remapped ID required | Split and tag IDs remapped | None | Missing parent rolls back | Coverage guard/partial integration |
| `securities` | UUID `id` remapped | Currency code preserved | Asset/country weighting JSON may contain no relational UUIDs; exact strings still remap | User/symbol uniqueness after wipe | Security-tag coverage tested |
| `security_prices` | Sequence-backed `id` stripped/regenerated | `security_id` remapped | None | Existing sequence value cannot collide; duplicate natural price constraints can be conflict-ignored | Basic coverage |
| `security_documents` | UUID `id` remapped | `security_id` remapped | Content metadata, no known relational JSON | Missing security rolls back | Table covered; detailed round-trip not located |
| `holdings` | UUID `id` remapped | `account_id`, `security_id` remapped | None | Indirect RLS/parents required | Basic coverage |
| `security_tags` | Composite `(security_id, tag_id)` | Both IDs remapped | None | Missing parent rolls back | Explicit integration assertion |
| `transactions` | UUID `id` remapped | Account/payee/category inline; `parent_transaction_id` and `linked_transaction_id` deferred; currency codes preserved | Exact UUID strings in any JSON value remap | Required account missing rolls back | Transfer/self links tested |
| `transaction_splits` | UUID `id` remapped | Transaction/category/transfer account/linked transaction remapped inline | None | Required transaction/transfer constraints can roll back | Split round-trip tested |
| `transaction_attachments` | UUID `id` remapped | `transaction_id` remapped | `storage_key` exact UUID is also remapped | External object is not moved; P3-002 | Database blob only; local/S3 missing |
| `attachment_blobs` | Primary `attachment_id` remapped from attachment map | Attachment metadata parent required | Base64 data decoded to `BYTEA` | DB-provider bytes share transaction; external providers have no row | DB provider structurally covered |
| `transaction_tags` | Composite `(transaction_id, tag_id)` | Both IDs remapped | None | Missing parent rolls back | Explicit integration assertion |
| `transaction_split_tags` | Composite `(transaction_split_id, tag_id)` | Both IDs remapped | None | Missing parent rolls back | Coverage guard |
| `investment_transactions` | UUID `id` remapped | Account, transaction, split, security, funding IDs remapped; self `linked_transaction_id` deferred | None | Optional missing parents may still violate if non-null | Self-linked transfer tested |
| `loan_rate_changes` | UUID `id` remapped | `account_id` remapped | None | Missing account rolls back | Explicit integration assertion |
| `loan_scenarios` | UUID `id` remapped | `account_id` remapped | `lump_sums` contains date/amount/mode, no relational UUID path identified | Missing account rolls back | JSON round-trip tested |
| `budgets` | UUID `id` remapped | Currency code preserved | `config` exact UUID strings remap generically | Currency ensured; conflict-ignore | Basic coverage |
| `budget_categories` | UUID `id` remapped | Budget/category/transfer account IDs remapped | None | Required budget missing rolls back | Closure covered by FK registry |
| `budget_periods` | UUID `id` remapped | `budget_id` remapped | None | Unique period conflict can be ignored | Basic coverage |
| `budget_period_categories` | UUID `id` remapped | Period, budget-category, category IDs remapped | None | Required parents missing roll back | Basic closure coverage |
| `budget_alerts` | UUID `id` remapped | Budget/budget-category IDs remapped | `data` generic deep-remapped in normal backup | Optional parent deletion/collision behavior not post-verified | Table coverage only |
| `custom_reports` | UUID `id` remapped | No physical FK | `filters.accountIds/categoryIds/payeeIds` and exact UUIDs in `config` remapped | No semantic validation of arbitrary filter paths in normal backup | Support JSON handler tested; normal round-trip partial |
| `investment_reports` | UUID `id` remapped | No physical FK | Exact UUID strings in `config` remapped | Unknown config references remain if not exact collected IDs | Integration row test, limited config closure |
| `import_column_mappings` | UUID `id` remapped | No physical FK | Exact UUID strings in `column_mappings`/`transfer_rules` remapped; support handler masks text | Schema semantics not validated | Table coverage; import-specific remap missing |
| `monthly_account_balances` | UUID `id` remapped | `account_id` remapped | None | Missing account rolls back | Basic coverage |
| `auto_backup_settings` | `user_id` replaced by target; no UUID row ID | No exported parent | Folder path/settings preserved in standard backup | One row; conflict-ignore can hide update | Unit coverage, no cross-instance path contract |
| `ai_provider_configs` | UUID `id` remapped | User forced to target | Encrypted API key is opaque ciphertext; UUID strings would remap | Instance-key portability unresolved (DR-003) | Cross-key test missing |
| `monte_carlo_scenarios` | UUID `id` remapped | `account_ids` is a non-FK UUID array and deep-remapped | Cash-flow/config values; exact UUID strings remap | Normal backup does not preflight missing account IDs; support scrub filters them | Support closure tested; normal closure limited |
| `monte_carlo_cash_flows` | UUID `id` remapped | `scenario_id` remapped | None | Missing scenario rolls back | Basic closure coverage |

## 14. Restore ordering and relationship-closure ledger

### 14.1 Deletion order

All operations below occur inside the single restore database transaction:

1. Undo/action history and user-derived caches/log-like data.
2. Monte Carlo children and scenarios.
3. AI provider configuration.
4. Investment transactions, security tags, holdings, security prices/documents, then securities after scheduled security references are nulled.
5. Budget alerts and budget children, then budgets.
6. Transaction tag junctions, splits, attachment blobs/metadata, then transactions and tags.
7. Scheduled overrides/split tags/splits, clear account schedule links, then scheduled transactions.
8. Monthly balances, custom/investment reports, import mappings, AI insights.
9. Payee aliases and payees.
10. Loan rate changes and scenarios.
11. Clear selected account category references, then accounts.
12. Institutions, categories, auto-backup settings, currency preferences, and user preferences.
13. Attempt to delete creator-owned currencies that appear unreferenced; this step is RLS-unsafe (P3-015).

Important external effect: direct SQL deletion of attachment metadata does not delete/re-key local/S3 objects.

### 14.2 Insertion / repair order

| Order | Section(s) | Parent dependency | Cycle / temporary null / deferred action | Constraint and verification status |
|---:|---|---|---|---|
| 0 | Referenced currencies | Global natural key | Existing conflicts ignored; missing codes synthesized | P3-013/P3-015; no semantic equality check |
| 1 | `user_preferences`, `user_currency_preferences` | Target user, currencies | User forced to target | Conflict affected rows not checked |
| 2 | `categories` | Target user | `parent_id` deferred | Parent remap tested |
| 3 | `payees`, `payee_aliases` | Categories/payees | Payee default category deferred | Tested partially |
| 4 | `institutions` | Target user | None | Logo bytes decoded |
| 5 | `accounts` | Categories/payees/institutions/currencies; self links; schedule later | Most self/forward links deferred, but `linked_loan_account_id` is not (P3-003) | Deterministic FK failure scenario |
| 6 | `tags` | Target user | None | Junctions later |
| 7 | Scheduled transactions and child rows | Accounts/payees/categories; securities inserted later | Security IDs deferred; account/schedule links repaired later | Support closure map strong |
| 8 | Securities, prices, documents, holdings, security tags | Accounts/tags/currencies | No self-cycle | Parent FKs immediate |
| 9 | Transactions and splits | Accounts/payees/categories | Transaction parent/linked IDs deferred | Transfer pairs tested |
| 10 | Attachment metadata and DB blobs | Transactions/attachment metadata | External provider objects are outside transaction (P3-002) | DB blobs atomic only |
| 11 | Transaction tag junctions | Transactions/splits/tags | None | Junction tests/coverage |
| 12 | Investment transactions | Accounts/transactions/splits/securities | Self linked transaction deferred | Tested |
| 13 | Loan rate changes/scenarios | Accounts | JSON lump sums inline | Tested partially |
| 14 | Budgets and children/alerts | Categories/accounts/currencies | None beyond parent order | Closure registry |
| 15 | Reports, import mappings | User plus embedded IDs | Generic deep UUID remap | Semantic path validation incomplete |
| 16 | Monthly balances, auto-backup settings, AI configs | Accounts/user | AI ciphertext opaque | Cross-instance risk |
| 17 | Monte Carlo scenarios/cash flows | Accounts/scenario | `account_ids` array remapped | Support scrub; normal preflight absent |
| 18 | Deferred FK repair | All target tables now populated | Categories parent; account institution/link/source/schedule/category links; transaction parent/link; investment link; payee default category; scheduled security refs | Missing account `linked_loan_account_id` repair is P3-003 |

### 14.3 Transaction, RLS, trigger, and rollback behavior

- The complete database restore mutation is one `withScopedDb` transaction wrapped in timestamp-preservation context.
- RLS context is set transaction-locally for the target user.
- Any SQL/FK error rolls back all database changes.
- Format/version/decryption/decompression errors occur before deletion, although decompression itself is resource-unbounded (P3-012).
- External filesystem/S3 objects are not part of the transaction.
- No final verification query compares expected versus inserted counts or checks every relationship after deferred updates.

## 15. Timestamp-preservation assessment

### Mechanism

- Migration `111_rls_helpers_and_trigger.sql` replaces `update_updated_at_column()` with a version that returns the supplied row unchanged when `current_setting('app.preserve_timestamps', true) = 'on'`; otherwise it stamps `CURRENT_TIMESTAMP`.
- `withPreserveTimestamps` carries an application context flag.
- `withScopedDb` starts/joins the restore transaction and executes `set_config('app.preserve_timestamps', 'on', true)`. The third argument makes the setting transaction-local.
- Deferred FK updates run inside the same preserve scope, so they do not overwrite restored `updated_at` values.

### Tables with current-schema update triggers observed

The full schema and trigger migrations show timestamp triggers on the core mutable entities and feature tables, including users/accounts/transactions, tags, scheduled transactions, securities/investment transactions, budgets and their mutable child tables, import column mappings/jobs, investment reports, Monte Carlo scenarios, and security documents. The exact catalog list was not executable; current definitions were inspected in `schema.sql` and the relevant trigger-adding migrations.

### Cleanup and nesting conclusions

| Scenario | Assessment |
|---|---|
| Commit | Confirmed by `rls-helpers-and-trigger.integration.spec.ts`: same physical connection reports the identity GUC cleared, and timestamp stamping resumes after the preserving transaction commits. |
| Rollback | PostgreSQL transaction-local setting should clear; a dedicated preserve-timestamp rollback assertion was not located. |
| Thrown error | Restore transaction rolls back; dedicated pooled-connection assertion after a thrown restore error was not located. |
| Nested scoped call | `scoped-db.ts` joins the ambient manager, so nested calls remain in the same transaction/preserve scope. Dedicated nested-call integration coverage was not located. |
| Caller setting outside restore | Any role able to execute arbitrary SQL can set custom GUCs; this is a threat-model constraint, not a durable privilege. |
| Created versus updated timestamps | Inserts include both source values where columns exist. The trigger affects updates; deferred repair preserves restored `updated_at`. |
| Integrity/order risk | Backdated timestamps are intentionally accepted. No constraint tying `updated_at >= created_at` was identified. |

No timestamp-preservation defect was confirmed. Earlier concern that the GUC leaked after commit was disproved by the real PostgreSQL integration test.

## 16. Support-backup field-classification ledger

The table below groups columns with identical treatment while preserving exact column/path names. `keep` means unchanged before UUID remapping; `scale` applies the file-wide multiplier; `mask` preserves rough shape while replacing text; `drop` omits the value; `constant` replaces it. All UUID identifiers are freshly remapped after transformation.

| Table / section | Column(s) / JSON path | Included | Classification | Transformation | Relationship role / re-identification concern | Test/status |
|---|---|---:|---|---|---|---|
| `currencies` | `code`, `name`, `symbol`, `decimal_places`, `is_active`, `created_at` | Yes | global identifier / free text / enum | keep | Custom values can directly identify user (P3-014); code is referenced globally | **Finding** |
| `currencies` | `created_by_user_id` | Yes | identifier | keep then remap/user-scope processing | Attribution, not ownership in schema | Risk |
| `user_preferences` | identifiers, booleans, enums, timezone/locale/theme, dates | Yes | identifier/enum/date | keep/remap | User row | Safe by rule |
| `user_preferences` | security/free-text/provider-sensitive fields | No or constant | security/free text | drop/constant per rule | Avoids 2FA/security leakage | Golden-tested |
| `user_preferences` | UUID arrays/config JSON | Yes | identifiers/config | keep then remap exact UUIDs | May preserve structure | Coverage test |
| `user_currency_preferences` | `user_id`, `currency_code`, `is_active`, `created_at` | Yes | identifier/global code/boolean/date | keep/remap | Currency relation; inherits P3-014 | Finding-dependent |
| `categories` | `id`, `user_id`, `parent_id`, flags, icon/color, dates | Yes | identifiers/enum/date | keep/remap | Parent/child hierarchy preserved | Safe by model |
| `categories` | `name` | Yes | free text | mask | Hierarchy shape still linkable | Golden-tested |
| `categories` | `description` | No | free text | drop | — | Safe |
| `payees` | IDs, category link, flags, dates | Yes | identifiers/boolean/date | keep/remap | Parent/category role | Safe |
| `payees` | `name` | Yes | free text | mask | Frequency/structure preserved | Safe for stated threat model |
| `payees` | notes/website and other direct text | No | free text/provider | drop | — | Safe |
| `payee_aliases` | IDs/dates | Yes | identifiers/date | keep/remap | Child of payee | Safe |
| `payee_aliases` | alias | Yes | free text | mask | Could preserve length/pattern | Accepted risk |
| `institutions` | IDs, country, flags, dates | Yes | identifiers/enum/date | keep/remap | Parent of account | Safe |
| `institutions` | `name` | Yes | free text | mask | — | Safe |
| `institutions` | website/logo bytes/content metadata | No | provider/binary | drop | Prevents branding and binary leakage | Safe |
| `accounts` | IDs, account type/subtype, links, currency, booleans, dates, payment-frequency/mode fields | Yes | identifiers/enums/date | keep/remap | Core parent; account/date scope applies | Closure-tested |
| `accounts` | `name` | Yes | free text | mask | Account structure remains | Safe for stated model |
| `accounts` | description/account number/institution legacy/memo | No or masked/constant per rule | free text/security | drop/mask | Removes direct identifiers | Golden-tested |
| `accounts` | balances, limits, payment/principal amounts, opening/current balance | Yes | monetary | scale | Reconciled after scoping | Numerical tests present |
| `accounts` | interest/fx percentages | Yes | rate | keep | Rates can be distinctive but are not absolute amounts | Accepted risk |
| `tags` | IDs/color/dates | Yes | identifiers/enum/date | keep/remap | Junction parent | Safe |
| `tags` | name | Yes | free text | mask | — | Safe |
| `transactions` | IDs, account/category/payee links, status/flags, dates, currency codes | Yes | identifiers/enums/date/global codes | keep/remap | Central child; date scope | Closure-tested |
| `transactions` | amount/original_amount | Yes | monetary | scale | Multiplier shared within artifact | Numerical tests present |
| `transactions` | exchange_rate/fx percentage | Yes | rate | keep | Supports reproduction; linkage risk | Accepted risk |
| `transactions` | payee_name/description/reference | Yes/No per rule | free text | mask/drop | Direct text removed/masked | Golden-tested |
| `transaction_splits` | IDs/links/kind | Yes | identifiers/enums | keep/remap | Child of transaction | Closure-tested |
| `transaction_splits` | amount | Yes | monetary | scale | — | Tested |
| `transaction_splits` | memo | No | free text | drop | — | Safe |
| attachment tables | all columns | No | binary/security/provider | table excluded | drop section | Avoids receipt/document leakage | Safe |
| tag junctions | all ID columns | Yes | identifiers | keep/remap | Relationship-only | Closure-tested |
| scheduled family | IDs, dates, recurrence/status/options, links | Yes | identifiers/enums/date | keep/remap | Optional section; closure scrub | Tested |
| scheduled family | amounts | Yes | monetary | scale | — | Tested |
| scheduled family | payee/memo/descriptions | Mask/drop | free text | mask/drop | — | Golden/JSON tests |
| `scheduled_transaction_overrides.splits[*]` | `categoryId`, `amount`; unknown keys | Yes/Yes/No | identifier/monetary/other | remap/scale/drop | Memo intentionally dropped | JSON allowlist tested |
| `securities` | IDs, currency, type, exchange/sector/industry/market attributes, dates | Yes | identifiers/public market metadata/date | keep/remap | Combination can identify masked security | Accepted linkage risk |
| `securities` | symbol/name/description | Yes/No | identifier/free text | mask/drop | Symbol/name masked | Tested |
| `securities.asset_weightings[*]` | `name`, `weight`; unknown keys | Yes | free text/percentage | mask/keep/drop unknown | Weight is share, not amount | JSON allowlist tested |
| `security_prices` | IDs, date/time, price/adjusted-close/source | Optional | provider/public market data | keep | Excluded by default; can identify security | User-controlled risk |
| `security_documents` | IDs/type/dates/status | Yes | identifiers/enums/date | keep/remap | Document text/URLs handled by rules | Golden-tested |
| `holdings` | IDs/account/security links | Yes | identifiers | keep/remap | Child of account/security | Closure-tested |
| `holdings` | quantity | Yes | quantity | scale | Shared multiplier | Tested |
| `holdings` | average_cost/current_price style per-unit values | Yes | price | keep | Exact price basis can aid linkage | Accepted risk/decision |
| `investment_transactions` | IDs, action, dates, links, currency/rates | Yes | identifiers/enums/date/rate | keep/remap | Core investment history | Closure-tested |
| `investment_transactions` | quantity/amount/commission/fees/taxes | Yes | quantity/monetary | scale | Shared multiplier preserves arithmetic | Numerical tests |
| `investment_transactions` | price | Yes | per-unit price | keep | Date+price can identify security | Accepted risk |
| `loan_rate_changes` | IDs, date/source | Yes | identifiers/date/enum | keep/remap | Account child | Safe |
| `loan_rate_changes` | annual_rate | Yes | percentage | keep | — | Accepted |
| `loan_scenarios` | IDs/modes/frequencies/dates/rates | Yes | identifiers/enums/date/rate | keep/remap | Account child | Safe |
| `loan_scenarios` | extra/target/payment amounts | Yes | monetary | scale | — | Numerical tests |
| `loan_scenarios.lump_sums[*]` | `date`, `amount`, `mode`; unknown keys | Yes | date/monetary/enum | keep/scale/drop unknown | — | JSON allowlist tested |
| budgets and periods | IDs, dates, statuses, links | Yes | identifiers/date/enum | keep/remap | Parent/child graph | Closure-tested |
| budgets and periods | all budget/actual/rollover amounts | Yes | monetary | scale | Opening/derived values reconciled | Numerical/integration tests |
| budget names | name/title/message | Yes | free text | mask or `***` | — | Golden-tested |
| `budget_alerts.data` | all paths | No | mixed JSON | drop | Regenerable, can contain names/amounts | Safe |
| `custom_reports` | IDs, enums, dates, icon/colors | Yes | identifiers/enums/date | keep/remap | Report definition | Safe structurally |
| `custom_reports` | name | Yes | free text | mask | — | Safe |
| `custom_reports` | description/search text | No | free text | drop | — | Safe |
| `custom_reports.filters` | `accountIds`, `categoryIds`, `payeeIds`; unknown/search keys | Yes/No | identifier/free text | keep+remap/drop | Scoped to included parents | JSON/closure tested |
| `investment_reports` | IDs/enums/config/dates | Yes | identifiers/config/date | keep/remap exact UUIDs | Config remains structurally linkable | Risk/coverage |
| `investment_reports` | name/description | Mask/drop | free text | mask/drop | — | Safe |
| `import_column_mappings` | IDs/dates | Yes | identifiers/date | keep/remap | — | Safe |
| `import_column_mappings` | name | Yes | free text | mask | — | Safe |
| `import_column_mappings.column_mappings` | all preserved keys/values | Yes | configuration/free text | keep | CSV header names may contain identifiers | Design risk |
| `transfer_rules[*]` | type, pattern, accountName; unknown keys | Yes | enum/free text | keep/mask/mask/drop unknown | — | JSON allowlist tested |
| `monthly_account_balances` | IDs/account/month/dates | Yes | identifiers/date | keep/remap | Account child | Closure-tested |
| `monthly_account_balances` | balance/market_value | Yes | monetary | scale | — | Numerical tests |
| `auto_backup_settings` | enabled/frequency/time/retention/status/dates | Yes | config/enums/date | keep | Operational structure preserved | Safe |
| `auto_backup_settings` | folder_path/timezone/error | Yes/Yes/No | path/location/free text | constant empty/UTC/drop | Removes host/user path | Safe |
| AI config/insights/logs | all | No | security/provider/content | excluded | drop tables | Prevents API-key/support content export | Safe |
| `monte_carlo_scenarios` | IDs/account_ids/config/rates/counts/dates | Yes | identifiers/config/rates/date | keep/remap; account_ids scoped | Scenario structure preserved | Closure-tested |
| `monte_carlo_scenarios` | starting/contribution/withdrawal/target amounts | Yes | monetary | scale | — | Numerical tests |
| `monte_carlo_scenarios` | name/description | Mask/drop | free text | mask/drop | — | Safe |
| `monte_carlo_cash_flows` | IDs/type/years/flags/dates | Yes | identifiers/enums/date | keep/remap | Scenario child | Closure-tested |
| `monte_carlo_cash_flows` | name/amount | Yes | free text/monetary | mask/scale | — | Tested |

### Classification conclusion

The allowlist/unknown-key controls are materially stronger than ordinary denylist redaction. The confirmed classification failure is custom currency metadata. Linkage through exact dates, rates, prices, and structure remains an explicit threat-model limitation rather than a hidden implementation bug.

---


## 17. Phase 1 and Phase 2 finding verification and disposition

| Prior finding | Phase 3 disposition | Independent evidence / Phase 3 action |
|---|---|---|
| `P1-001` — concurrent `.mny` starts can create separate active jobs | **Strengthened; not duplicated as a new Phase 3 finding.** The database side is confirmed and handed to Phase 4. | `database/migrations/117_mny_import_staging_and_jobs.sql` and `database/schema.sql` define ordinary user/staged-file/heartbeat indexes but no tenant-safe partial unique constraint over active states. Phase 4 must verify the service-side start/claim race and choose whether uniqueness is per user or per staged file. |
| `P1-002` — deployment documentation does not match manifests | **Relevant portions confirmed; general finding not duplicated.** | Compose supplies a shared backup mount; default Helm supplies no writable backup mount. These facts support P3-001 and P3-006 and refine the database/backup deployment contract. |
| `P1-003` — official guidance recommends prohibited transaction APIs | **Preserved as documentation drift.** | `CONTRIBUTING.md` and auxiliary skill guidance conflict with scoped `CLAUDE.md` instructions. No active production manual `QueryRunner` use was established in this phase. |
| `P1-004` — PAT `reports` comment drift | **No material Phase 3 database effect.** | No privilege is granted by the comment. Not reopened. |
| `P2-001` — shared auto-backup namespace | **Independently confirmed and strengthened as P3-001 (HIGH).** | Verified default root, all frequency filenames, both extensions, direct write/copy, retention enumeration, single-replica/two-user failure, Compose mount, and missing isolation tests. |
| `P2-002` — arbitrary authenticated filesystem path selection | **Independently confirmed and strengthened as P3-005 (MEDIUM).** | Verified route guards, normalization, absent allowed-root/`realpath`/symlink checks, arbitrary absolute paths, Compose permissions, and unit tests that accept browsing `/`. |
| `P2-005` — OIDC destructive operations accept any non-empty string | **Restore branch independently confirmed as P3-009 (MEDIUM).** | The restore controller accepts the header and `BackupService` tests only presence for OIDC. Backup decryption remains a separate credential. User-service deletion was not duplicated. |
| `P2-006` — unsafe runtime role can be accepted in enforce mode | **Independently confirmed as P3-010 (MEDIUM); a distinct grant defect is P3-011.** | Startup validates configured names/passwords but not `rolsuper`, `rolbypassrls`, inheritance, memberships, or ownership. Blanket grants also include `schema_migrations`. |
| `P2-009` — RLS-filtered currency liveness check deletes another user's preference | **Independently confirmed and strengthened as P3-015 (MEDIUM).** | Verified schema FK `ON DELETE CASCADE`, direct-table RLS policy, API cleanup, and destructive-restore currency cleanup under tenant scope. |
| `P2-003` — delegated `/users/me` field leakage | **Preserved; no distinct Phase 3 database finding.** | Security-sensitive user columns are excluded from standard backup because `users` is not exported. |
| `P2-004` — MCP cached scopes | **Preserved; outside Phase 3 scope.** | No database lifecycle defect was established. |
| `P2-007` — delegation create/link/revoke incompatible with `users_self` | **Preserved; outside the confirmed Phase 3 findings.** | Delegation relationships are intentionally excluded from backup; their destructive-restore behavior remains DR-004. |
| `P2-008` — delegated requests update owner activity | **Preserved; outside Phase 3 scope.** | `users` and activity timestamps are not part of standard user-data restore. |

## 18. Contradictions and supersession register

| ID | Sources in tension | Resolution in this phase |
|---|---|---|
| CR-001 | `database/schema.sql` documents `schema_migrations` as owner-written infrastructure; `app-role.ts` grants DML on every table. | Implementation widens the runtime role beyond the documented boundary. Confirmed as P3-011. |
| CR-002 | `docs/support-backup.md` says free-text names are masked; `support-backup-rules.ts` keeps user-created currency code/name/symbol. | The implementation does not meet the broad documentation claim. Confirmed as P3-014 and DOC-005. |
| CR-003 | `.env.example` says local/S3 storage can be backed up alongside the database; restore remaps attachment UUIDs and matching `storage_key` values. | A byte-for-byte sidecar restore is insufficient without key rewriting/copying. Confirmed as P3-002 and DOC-003. |
| CR-004 | Automatic backup is exposed as a supported backend feature; default Helm runs a read-only root with no backup volume or mount. | The feature is not operable in the default chart. Confirmed as P3-006. |
| CR-005 | `verify-schema.sh` output suggests migrations build the compared state; script comments state older migrations were rolled into `schema.sql` and both databases begin from current schema. | The check proves current-schema no-op/idempotency, not historical upgrade parity. Recorded as DOC-006 and MT-002. |
| CR-006 | Root/nearest `CLAUDE.md` requires scoped transaction helpers; `CONTRIBUTING.md` and auxiliary skill guidance recommend direct TypeORM transactions/`QueryRunner`. | Nearest instructions control. Documentation drift is preserved, not treated as live implementation use. |
| CR-007 | Backup restore claims a full-fidelity user-data copy; delegation grants/favourites are deliberately excluded yet can cascade when accounts are deleted. | Product intent is unclear. Kept as DR-004 pending a documented recovery contract. |
| CR-008 | Standard export has a streaming path; encryption, automatic backup, and support backup require full buffering and deployment defaults permit only 400 MiB in Helm. | “Streaming” is true only for unencrypted HTTP export. Buffered paths have P3-008. |
| CR-009 | RLS architecture expects migration infrastructure to be owner-only; default privileges are set without `FOR ROLE`, so their effect depends on whichever role runs provisioning. | Live owner/default-privilege catalogs are required. P3-011 is confirmed for existing tables; future-object behavior remains a role-model limitation. |

### Supersession outcome

- No accepted Phase 1 or Phase 2 finding was disproved by Phase 3.
- `P2-001`, `P2-002`, `P2-005` (restore branch), `P2-006`, and `P2-009` were independently verified and strengthened as the corresponding Phase 3 findings above.
- `P1-001` was strengthened with exact database constraints/index gaps but remains primarily a Phase 4 backend-concurrency finding.
- No duplicate finding was retained under two IDs in the Phase 3 confirmed-finding list.

## 19. Reviewed scope

### 19.1 Directories inspected

- repository root configuration and documentation;
- `.claude/` instruction and skill guidance;
- `.github/workflows/` CI source;
- `backend/src/backup/` and `backend/src/backup/support-backup/`;
- `backend/src/common/db/`;
- `backend/src/attachments/` and storage providers;
- `backend/src/currencies/` relevant cleanup and metadata paths;
- `backend/src/import/mny/` relevant staging paths;
- `backend/test/integration/` relevant backup/RLS suites;
- `backend/scripts/` migration lint;
- `database/` and `database/migrations/`;
- `docs/` database, backup, RLS, import, cron, and deployment documentation;
- `helm/` values, README, and backend StatefulSet template; and
- root Compose and environment examples.

### 19.2 Files inspected in full or in complete pinned ranges

**Instruction and documentation files**

- `CLAUDE.md`
- `backend/CLAUDE.md`
- `database/CLAUDE.md`
- `frontend/CLAUDE.md`
- `.claude/settings.json`
- `.claude/skills/backend.md`
- `.claude/skills/frontend.md`
- `.claude/skills/infrastructure.md`
- `README.md`
- `CONTRIBUTING.md`
- `SECURITY.md`
- `docs/database-migrations.md`
- `docs/support-backup.md`
- `docs/cron-jobs.md`
- `docs/future-plans/row-level-security.md`
- `docs/future-plans/row-level-security-tasks.md`
- `docs/future-plans/row-level-security-runbook.md`
- `docs/import-ms-money.md`
- `backend/src/import/mny/README.md`
- `helm/README.md`

**Schema, migration, database-role, and deployment files**

- `database/schema.sql` — all 2,005 lines, fetched in pinned ranges
- `backend/src/db-init.ts`
- `backend/src/db-migrate.ts`
- `backend/docker-entrypoint.sh`
- `backend/Dockerfile`
- `backend/src/common/db/app-role.ts`
- `backend/src/common/db/rls-config.ts`
- `backend/src/common/db/scoped-db.ts`
- `backend/src/common/db/with-context.ts`
- `docker-compose.dev.yml`
- `docker-compose.prod.yml`
- `helm/values.yaml`
- `helm/templates/statefulset-backend.yaml`
- `.env.example` relevant attachment/backup/AI sections

**Critical migration bodies read in full**

- `database/migrations/000_schema_migrations.sql`
- `database/migrations/018_user_currency_preferences.sql`
- `database/migrations/068_account_delegates.sql`
- `database/migrations/073_delegate_account_favourites.sql`
- `database/migrations/075_backup_encryption.sql`
- `database/migrations/093_accounts_linked_loan_account_id.sql`
- `database/migrations/109_transaction_attachments.sql`
- `database/migrations/111_rls_helpers_and_trigger.sql`
- `database/migrations/112_rls_policies_direct.sql`
- `database/migrations/117_mny_import_staging_and_jobs.sql`
- `database/migrations/123_rls_enable.sql`

**Backup, restore, support-backup, attachment, and currency files**

- `backend/src/backup/backup.service.ts` — complete implementation in pinned ranges
- `backend/src/backup/auto-backup.service.ts` — complete implementation in pinned ranges
- `backend/src/backup/backup.controller.ts` — complete relevant controller surface
- `backend/src/backup/backup-id-remap.util.ts`
- `backend/src/backup/backup-crypto.util.ts`
- `backend/src/backup/support-backup/support-backup.service.ts`
- `backend/src/backup/support-backup/support-backup-rules.ts`
- `backend/src/backup/support-backup/support-backup-integrity.ts`
- `backend/src/backup/support-backup/support-backup-jsonb.ts`
- `backend/src/backup/support-backup/dto/create-support-backup.dto.ts`
- `backend/src/attachments/attachments.service.ts`
- `backend/src/attachments/attachments.module.ts`
- `backend/src/attachments/storage/local-storage.provider.ts`
- `backend/src/attachments/storage/s3-storage.provider.ts`
- `backend/src/currencies/currency-metadata.ts`
- `backend/src/currencies/dto/create-currency.dto.ts`

**Tests and checks inspected**

- `backend/src/db-migrate.spec.ts`
- `backend/src/common/db/app-role.spec.ts`
- `backend/src/common/db/rls-config.spec.ts`
- `backend/src/backup/auto-backup.service.spec.ts`
- `backend/src/backup/backup.service.spec.ts` relevant full restore/export ranges
- `backend/src/backup/backup-crypto.util.spec.ts`
- `backend/src/backup/support-backup/support-backup.service.spec.ts` relevant ranges
- `backend/test/integration/backup-restore.integration.spec.ts`
- `backend/test/integration/support-backup.integration.spec.ts`
- `backend/test/integration/rls-helpers-and-trigger.integration.spec.ts`
- `backend/scripts/migration-lint.test.mjs`
- `scripts/verify-schema.sh`
- `.github/workflows/ci.yml`

### 19.3 Files sampled or read only in targeted ranges

- `backend/src/app.module.ts` — database provider/startup configuration ranges
- `backend/src/main.ts` — raw-body/restore-size configuration ranges
- `backend/src/currencies/currencies.service.ts` — remove, tenant/global liveness, and metadata paths
- `backend/src/import/mny/mny-staging.service.ts` — staging/job lifecycle ranges
- selected RLS policy migrations and schema ranges outside the full critical files above;
- selected migration bodies identified by the complete inventory where necessary to verify specific tables, constraints, or triggers.

### 19.4 Areas reviewed without a material finding

- Backup encryption envelope uses authenticated AES-256-GCM, random salt/IV, scrypt derivation, and tamper/wrong-password tests.
- Public support-backup DTO requires a password; no public unencrypted request path was found.
- Restore validates backup version and envelope before destructive deletion.
- Database modifications during restore are wrapped in one scoped transaction; a thrown database error rolls back the user-data changes.
- Database-provider attachment bytes are included as base64 and restored inside the database transaction.
- Restore validates table and column names against allowlists/catalog metadata before constructing SQL.
- Support backup uses a table/column allowlist and per-key JSON handlers that drop unknown keys.
- Support account/date scoping has FK closure scrubbing and opening-balance/current-balance reconciliation with numerical tests.
- The timestamp-preservation GUC is transaction-local; the real PostgreSQL integration test demonstrates reset after commit and normal trigger behavior afterward.
- Migration ordering and tracking use full filenames; duplicate numeric prefixes do not collide.
- A failed migration body is rolled back before its filename is recorded.
- Auto-backup refuses to write plaintext when encryption is enabled but its stored password cannot be decrypted.
- Current schema, inspected critical migrations, and drift/lint source did not reveal a material current-schema mismatch.

## 20. Unreviewed or inaccessible scope

- No recursive immutable Git tree was available. Repository search was capped/truncated and resolved candidate paths against the searchable branch; every evidentiary file was re-fetched at the baseline, but complete path absence cannot be proven.
- `AGENTS.md` was not found by search, but its repository-wide absence could not be established.
- All 111 migration filenames were inventoried; not all 111 migration bodies were read in full. Files outside the critical set were sampled as needed.
- No supported historical starting schema was available from which to execute every retained migration. The retained history explicitly assumes older migrations were rolled into `schema.sql`.
- No PostgreSQL catalogs were available to verify actual database/schema/table/function/sequence owners, role attributes, role memberships, grants, default privileges, `relrowsecurity`, extensions, or managed-service role behavior.
- No application runtime, disposable database, Compose stack, Helm release, Kubernetes cluster, persistent volume, filesystem permission model, symlink layout, object store, or secrets were available.
- No actual test command, migration command, schema-drift command, backup, restore, OOM scenario, gzip-bomb scenario, concurrent migrator, or two-user RLS scenario was executed.
- CI workflow source was inspected, but current/archived CI status, logs, artifacts, and database-service output were unavailable. Missing status was not treated as failure.
- No real legacy backup files or future-version artifacts were available for compatibility tests.
- Frontend behavior was not comprehensively audited; only documentation/controller contracts relevant to this phase were followed.
- Actual deployed CNPG/managed PostgreSQL ownership and volume topology were unavailable.
- Cross-instance AI ciphertext portability, crafted cross-tenant foreign keys, delegation-reset intent, and external-object compensation require executable or product-owner confirmation.

## 21. False positives investigated and rejected

| ID | Investigated claim | Rejection basis |
|---|---|---|
| FP-001 | Migration `123_rls_enable.sql` by itself proves a production outage. | Enabling RLS is derived from policies and owner connections bypass ordinary RLS. Actual deployed role/mode was not established. |
| FP-002 | Absence of `FORCE ROW LEVEL SECURITY` is automatically defective. | The documented owner/migrator versus runtime-role architecture deliberately relies on owner bypass. Unsafe runtime-role acceptance is the actual defect. |
| FP-003 | Global `currencies` and `exchange_rates` exemptions are accidental. | Schema/RLS documentation deliberately treats them as shared reference data. The defect is tenant-scoped liveness cleanup, not their global visibility. |
| FP-004 | The PAT `reports` schema/comment drift grants a privilege. | A comment does not authorize access. |
| FP-005 | Active production manual `QueryRunner` use was established. | No such production path was confirmed; stale guidance alone is not implementation evidence. |
| FP-006 | Public support-backup export can be requested unencrypted. | `CreateSupportBackupDto.password` is required and validated on both public support endpoints. The internal optional type does not create a public bypass. |
| FP-007 | Unavailable CI status proves CI failed. | Only workflow source was available. |
| FP-008 | Every-replica cron execution is automatically a defect. | Replica scheduling alone is not necessarily wrong. P3-001 is independently reproducible with one replica and two users because the namespace is shared. |
| FP-009 | Repeated migration numeric prefixes collide. | The runner orders and records full filenames. |
| FP-010 | OAuth adapter access to `oauth_payloads` is an accidental RLS bypass. | The table is intentionally exempt infrastructure used in a pre-session system context. |
| FP-011 | RLS task status proves production is in enforce mode. | Documentation and migration presence do not establish deployed configuration. |
| FP-012 | Restore can commit a partially modified database after an insertion error. | User-data deletion and insertion run in one scoped transaction; errors roll back. External filesystem/object effects remain separate risks. |
| FP-013 | Timestamp-preservation GUC leaks after commit. | A real PostgreSQL integration test checks the same connection after commit and confirms the GUC is cleared and trigger stamping resumes. |
| FP-014 | Backup encryption lacks integrity protection. | AES-GCM authentication and tamper tests were present. |
| FP-015 | Crafted backup keys can inject arbitrary SQL column names. | `insertRows` and currency restore query `information_schema` and drop unknown columns; table names are allowlisted. |
| FP-016 | Database-provider attachment blobs are outside restore atomicity. | Their bytes are in `attachment_blobs` and participate in the database transaction. The confirmed defect applies to local/S3 providers. |
| FP-017 | Auto-backup silently downgrades to plaintext after master-key rotation. | The service throws when encryption is enabled but no stored password can be decrypted. |
| FP-018 | `ON CONFLICT DO NOTHING` necessarily corrupts every restore. | UUID remapping eliminates ordinary primary-key collisions. Missing affected-row verification is DR-005 until a concrete surviving natural/composite conflict is executed. |
| FP-019 | Any arbitrary foreign UUID in a crafted backup definitely creates a cross-tenant link. | The code lacks preflight closure, but the final behavior depends on RLS/RI evaluation under the actual role. Kept as DR-012/MT-022, not a runtime fact. |

## 22. Audit ledger

| Ledger field | Recorded value |
|---|---|
| Audit phase | Phase 3 — Database, Migrations, Backup, Restore, and Support Backup |
| Worker-chat name | Phase 3 — Database, Migrations, Backup, Restore, and Support Backup |
| Audited SHA | `d5cea9bfa995885ba5198f9843359362927c0fd4` |
| Assigned scope | Fresh schema; retained migrations; ownership/grants/RLS representation; standard/automatic/support backup; destructive restore; ID remapping; timestamps; attachments; import lifecycle schema; Compose/Helm database/backup deployment |
| Repository instruction hierarchy | `database/CLAUDE.md` or `backend/CLAUDE.md` / `frontend/CLAUDE.md` → root `CLAUDE.md` → auxiliary docs and `.claude` guidance |
| Directories inspected | Root, `.claude`, `.github/workflows`, `backend/src/backup`, `backend/src/common/db`, `backend/src/attachments`, relevant currencies/import paths, backend integration tests/scripts, `database`, `docs`, `helm` |
| Files inspected in full | Listed in Section 19.2, including all of `database/schema.sql`, core database/backup implementations, support-backup engine/rules, critical migrations, and relevant tests/checks |
| Files sampled | Listed in Section 19.3 |
| Complete migration inventory | 111 filenames in Section 8; four duplicate-prefix pairs; full-filename tracking confirmed |
| Inaccessible files/resources | Recursive immutable tree; live catalogs; runtime services; deployment volumes; object store; secrets; CI logs/artifacts; real backups; historical starting schema |
| Capped/truncated searches | Migration/path searches and several code searches were capped/truncated. Search was discovery-only; evidence was re-fetched at the fixed SHA. |
| Commands/checks examined as source | `backend/docker-entrypoint.sh`, `db-init`, `db-migrate`, migration lint, `scripts/verify-schema.sh`, Compose, Helm, CI workflow |
| Tests/CI results examined | Test source and workflow source only; no execution result or artifact was available |
| Tests actually executed | None |
| Runtime scenarios actually executed | None |
| Confirmed findings by severity | `BLOCKER 0`, `HIGH 2`, `MEDIUM 13`, `LOW 1` |
| Design risks | 12 (`DR-001`–`DR-012`) |
| Missing tests/scenarios | 22 entries (`MT-001`–`MT-022`), with partial timestamp coverage corrected below |
| Documentation issues | 7 (`DOC-001`–`DOC-007`) |
| Open hypotheses | Crafted cross-tenant FKs; cross-key AI config portability; delegation reset intent; managed-role/default-privilege behavior; external-object compensation; historical upgrade parity |
| False positives rejected | 19 (`FP-001`–`FP-019`) |
| Areas without material findings | Encryption format, public support encryption, pre-delete version validation, DB transaction rollback, database blobs, identifier SQL allowlists, support allowlist/closure, timestamp commit cleanup, filename ordering, fail-loud backup-password behavior |
| Phase 1 dependencies | Fixed baseline; architecture and deployment inventory; `P1-001` import race; documentation findings |
| Phase 2 dependencies | Independent verification of `P2-001`, `P2-002`, restore portion of `P2-005`, `P2-006`, and `P2-009` |
| Contradictions with earlier reports | None disproved; relevant findings were strengthened or preserved without duplication |
| Findings duplicated/strengthened/superseded | Prior findings mapped in Section 17; no duplicate Phase 3 root-cause entries; none superseded or downgraded |
| Report filename | `monize-audit-03-database-backup.md` |
| Report completion status | Complete within documented static-access limits |
| Next required action | Phase 4 must independently audit backend transactions, locking, background jobs, import claims, balance updates, and external side effects at the same SHA |

### Missing-test classification correction

`MT-021` is a **confirmed partial test gap**, not a wholesale missing test: `backend/test/integration/rls-helpers-and-trigger.integration.spec.ts` proves commit cleanup and resumed timestamp stamping on the same connection. Explicit rollback, thrown-exception, and nested-scoped-call coverage was not located.

## 23. Handoff to Phase 4 — Backend Transactions and Concurrency

### 23.1 Immutable baseline

Phase 4 must audit exactly:

```text
AUDIT_BASELINE_SHA=d5cea9bfa995885ba5198f9843359362927c0fd4
```

Do not resolve or follow `main`.

### 23.2 Database transaction and context paths to preserve

- `backend/src/common/db/scoped-db.ts`
- `backend/src/common/db/with-context.ts`
- `backend/src/common/db/rls-config.ts`
- `backend/src/common/db/app-role.ts`
- `backend/src/db-init.ts`
- `backend/src/db-migrate.ts`
- `backend/docker-entrypoint.sh`
- `backend/src/backup/backup.service.ts`
- `backend/src/backup/auto-backup.service.ts`
- `backend/src/attachments/attachments.service.ts`
- `backend/src/import/mny/mny-staging.service.ts`
- the import start/worker/reaper services and controllers discovered at the baseline.

`withScopedDb` joins an existing AsyncLocalStorage-bound transaction when present. Restore wraps delete/insert/deferred repair in one scoped transaction and enables `app.preserve_timestamps` transaction-locally. Export does not use one transaction; each table query opens a separate scoped transaction (P3-007).

### 23.3 `P1-001` import-job uniqueness and locking

Confirmed database shape:

- `database/migrations/117_mny_import_staging_and_jobs.sql`
- `database/schema.sql`
- `import_staged_files.id` is UUID PK; `user_id` FK cascades from users; expiry index supports TTL cleanup.
- `import_jobs.id` is UUID PK; `user_id` FK cascades; `staged_file_id` FK is `ON DELETE SET NULL`.
- Existing indexes cover `user_id`, `staged_file_id`, and `heartbeat_at WHERE status='running'`.
- There is no `CHECK` constraint limiting status to `pending|running|completed|failed`.
- There is no unique constraint preventing multiple active jobs for one user or one staged file.

Required invariant to decide and enforce atomically:

```text
At most one active (`pending` or `running`) .mny import for the intended tenant key.
```

The likely database mechanism is a partial unique index, for example:

```sql
CREATE UNIQUE INDEX ... ON import_jobs (user_id)
WHERE status IN ('pending', 'running');
```

Phase 4 must not adopt that blindly. Independently verify whether the product permits parallel imports of different staged files, whether retries are keyed per staged file, and whether the correct key is `user_id`, `(user_id, source_format)`, or `staged_file_id`. Pair any partial index with a status `CHECK`/enum so an invalid status cannot evade the invariant. Verify the start request inserts/claims in one transaction and maps unique violations to an idempotent “existing active job” response.

### 23.4 Migration and startup concurrency

P3-016 established that every backend pod executes `db-init` and `db-migrate`, while neither path acquires a PostgreSQL advisory lock. Phase 4 should execute two simultaneous startup processes on:

1. an empty database;
2. a database with one pending migration; and
3. a database whose first process pauses after DDL but before tracker insertion.

Required invariant: one elected migrator applies the sequence; followers wait and then re-read the tracker. A failed migration must not record success, and a successful migration by one process must not crash-loop every follower.

### 23.5 Account balances and lost updates

The database stores `accounts.current_balance`; no database trigger was found that universally derives it from transactions. Support backup explicitly recomputes balances in `support-backup.service.ts`, while ordinary restore imports stored snapshots. Phase 4 must trace every create/update/delete/transfer/split/import/schedule/investment path that mutates transactions and balances. Verify:

- locking or atomic arithmetic around concurrent balance changes;
- transfer-pair atomicity;
- split-parent recomputation;
- import batches versus interactive writes;
- scheduled posting versus user edits;
- rollback of both ledger rows and cached balances;
- stale snapshot overwrites; and
- monthly balance/background recalculation races.

### 23.6 Restore and import transaction boundaries

Restore is one database transaction but has pre-transaction authentication/decompression/parsing and can perform no external attachment migration. Verify nested scoped-call behavior, connection reuse, and that every service called within restore joins rather than opens an independent commit.

Import staging bytes and job progress deliberately use different transactions from the long import. Phase 4 must inspect:

- atomic job claim (`pending` → `running`);
- heartbeat ownership and stale-job reaping;
- worker crash after partial financial writes;
- progress visibility versus rollback;
- retry over the same staged file;
- TTL deletion racing with job start/retry;
- staged-file ownership under RLS; and
- multi-replica workers claiming the same job.

### 23.7 External filesystem and object-store side effects

Preserve these Phase 3 findings/risks:

- P3-001 shared backup namespace;
- P3-004 non-atomic final backup files;
- P3-005 arbitrary path selection;
- P3-006 missing Helm mount;
- P3-002 external attachment restore failure; and
- DR-006 external attachment side effects are not database-atomic.

Inspect upload/delete compensation, retries, idempotency keys, temporary object names, orphan cleanup, checksum verification, transaction-commit ordering, and concurrent delete/download/update behavior for local and S3 providers.

### 23.8 Background and multi-replica behavior

At minimum inspect:

- automatic-backup cron and manual “run now” overlap;
- import worker, heartbeat, and reaper overlap;
- staged-file TTL cleanup;
- scheduled transaction posting;
- exchange-rate/price refresh jobs where they update shared rows;
- monthly account balance or alert jobs;
- cleanup/retention jobs; and
- any leader-election, advisory-lock, `SKIP LOCKED`, lease, or idempotency mechanism.

Do not reopen the generic claim “every-replica cron is always defective.” Establish a concrete shared side effect or duplicate business operation.

### 23.9 Database invariants backend services must preserve

- Every user-owned row and indirect child remains tenant-scoped under RLS.
- Global currencies/exchange rates remain shared, but cleanup decisions must use a true system/global context.
- Every transfer/split/investment/schedule pair is complete or wholly rolled back.
- Account balances and derived aggregates match committed ledger rows.
- One active import exists per chosen product key.
- Job status follows a constrained state machine.
- Timestamp-preservation GUC is transaction-local and cannot leak across pooled requests.
- Runtime application connections cannot write migration history or assume owner capabilities.
- Backup file/object side effects are not presented as committed until durable.
- Attachment object keys and database metadata remain consistent across every commit/rollback.

### 23.10 Findings Phase 4 must independently verify

- `P1-001` service-level race and correct active-job uniqueness key.
- P3-007 non-snapshot export interactions with concurrent backend writes.
- P3-015 currency cleanup's use of nested scoped context/system context.
- P3-003 linked-loan restore ordering, especially if backend services enforce reciprocal links.
- P3-016 migration/startup race under two processes.
- DR-006 external object compensation.
- DR-012 crafted foreign-key ownership behavior under enforce-mode RLS.
- All potential account-balance lost-update paths.

### 23.11 Rejected hypotheses not to reopen without new evidence

- Duplicate numeric migration prefixes do not collide under the full-filename runner.
- A failed restore database transaction does not partially commit merely because deletion occurs before insertion.
- Transaction-local timestamp GUC does not leak after commit in the tested path.
- Database-provider attachment bytes are transactionally restored with metadata.
- Every-replica cron execution alone is not a defect.
- No active production manual `QueryRunner` path was established in this phase.

### 23.12 Missing concurrency tests to carry forward

- two simultaneous migrators and fresh-schema initializers;
- two simultaneous import starts for one user/staged file;
- two workers claiming one pending job;
- reaper versus heartbeat/update/commit;
- staged-file TTL versus start/retry;
- manual and scheduled auto-backup on the same tenant/date;
- two tenants on the same backup root;
- concurrent transaction/transfer/split mutations and balance updates;
- scheduled posting versus edits/deletes;
- local/S3 object write/delete versus database commit failure;
- restore/export versus concurrent writes;
- nested scoped transaction success, rollback, and exception cleanup.

### 23.13 Evidence limitations inherited by Phase 4

No runtime, PostgreSQL service, object store, volumes, CI artifacts, or recursive immutable tree were available in Phase 3. Phase 4 must clearly label any static conclusion that remains unexecuted and keep all repository reads pinned to the baseline SHA.

---

**End of Phase 3 report.**
