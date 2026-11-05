# Session S06: Backup, restore, support backup, attachments

## 1. Metadata

| Field | Value |
| --- | --- |
| Session | S06 (parallel wave, child of orchestrator session_018Nx7aian3f7dpRX5msjFBg) |
| Status | done |
| `AUDIT_BASELINE_SHA` | `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86` |
| `git rev-parse HEAD` at start of audit | `3070f39a49b97a0be6c5dd2dc2b2e197e351e1ee`; at report write `fb4067571e322c1bd87c6f47dd6d997d6236c729` (only `docs/audits/2026-10/` differs; pin check of plan step 2 returned empty) |
| Date | 2026-10-21 |
| Primary path | `backend/src/backup/` |
| Hint line used | `prioritize backup/restore atomicity, owner and instance namespace isolation, external attachment bytes versus metadata on every provider, ID remapping, restore ordering and deferred FKs, decompression bounds, one export snapshot, cleanup and rollback, legacy-backup compatibility, off-machine copy verification and reclaim, key wrapping and what the server can decrypt, support-backup de-identification` |
| Toolchain | Node 24.22.1 (`/opt/nvm`), `npm ci` in `backend/` OK; `dockerd` started by hand; `mirror.gcr.io/library/postgres:16-alpine` on 127.0.0.1:5432; no MinIO image reachable (`mirror.gcr.io/minio/minio` not found, `ghcr.io/minio/minio` denied), so `moto[server]` 5.2.4 (pip, scratch venv) served as the S3-compatible endpoint on 127.0.0.1:9000 |
| Runtime executed | see the table below |

| Suite / script | Result |
| --- | --- |
| `TZ=UTC npx jest src/backup src/attachments src/currencies src/common/shard-path` (unit) | 90 suites, 1942 passed, 2 skipped, 0 failed |
| `npm run test:integration -- backup-restore` | 25 passed |
| `npm run test:integration -- support-backup` | 5 passed |
| `npm run test:integration -- attachment-late-write` | 12 passed |
| `npm run test:integration -- attachment-scan-pair` | 8 passed |
| `npm run test:integration -- backup-offsite-claim` | 7 passed |
| `npm run test:integration -- backup-store-s3` without endpoint (the CI configuration) | 1 passed, the 8 bucket-backed cases skipped |
| `BACKUP_STORE_S3_TEST_ENDPOINT=http://127.0.0.1:9000 npm run test:integration -- backup-store-s3` (moto) | 7 passed, 2 failed (A26-S06-02: one test defect, one emulator limitation) |
| Scratch round trip `s06-roundtrip.integration.spec.ts` (scratch worktree, `S06_PROVIDER=local`, real `mkdtemp`) | 6 passed (R1..R6, section 7) |
| Same scratch spec, `S06_PROVIDER=s3` against moto | 6 passed |
| Mutations M1..M4 in the scratch worktree | section 6 |

The scratch worktree was `git worktree add --detach <scratchpad>/mut 72c59ec4`; no file on the audit branch was modified. The scratch spec is kept at `<scratchpad>/s06-roundtrip.integration.spec.ts` (it reuses lines 1-413 of `backend/test/integration/backup-restore.integration.spec.ts` verbatim, swapping `attachmentStorageProviders()` for a local or S3 provider set, then adds R1..R6).

## 2. Invariant map

| ID | Statement | Mechanism named | Status found |
| --- | --- | --- | --- |
| INV-BACKUP-001 | An artifact is owner-namespaced, complete and verified before reported done | `userFolderPath` = `<base>/<ab>/<cd>/<userId>/` via `shardedSegments` + `isShardableId` (`storage/local-backup-storage.target.ts:487-500`); `writeFileAtomic` (`atomic-file.ts`); completeness in the envelope; name chosen after export (`auto-backup.service.ts:2146-2160`) | held for the owner's own folder; **violated by the legacy flat-root sweep** (A26-S06-01); no instance namespace (section 9) |
| INV-BACKUP-002 | Only `.mzbe` leaves the machine | `isEncryptedBackupFileName` at both doors, guard spec | held (unit suites green; not re-derived beyond the guard) |
| INV-BACKUP-003 | Local copy complete before off-machine copy | `dispatchOffsiteCopy` after `applyBackupOutcome`, `report.complete` gate | held |
| INV-BACKUP-004 (partial) | Egress can add, never delete or overwrite | `IfNoneMatch: "*"`, uploader without Delete; IAM half operator-only | the gap the index records is still the gap; no new unenforced path found |
| INV-BACKUP-005 (partial) | Off-machine copy verified, a dead claim reclaimed | `ChecksumSHA256` echo, conditional claim, lease expiry in `handleRetrySweep` | `backup-offsite-claim.integration.spec.ts` 7 passed; lease reclamation still has no two-connection test (the recorded gap, unchanged); email half unchanged |
| INV-BACKUP-006 | Published whole or not at all, every target | local temp+fsync+rename; S3 one `PutObject` with `ChecksumSHA256`, `CopyObject` promotion | local held (real tmpdir unit tests); S3 half's **required integration evidence never runs in CI and is itself wrong** (A26-S06-02); "two runs for the same user and day cannot interleave" is false for the manual fan-out (section 11) |
| INV-BACKUP-007 | Store and off-machine destination are two places | separate variable prefixes | not re-derived (no change surface in slice) |
| INV-BACKUP-008 (partial) | Server stores nothing that decrypts to a password | `storeBackupKey` clears `backup_password_enc`; legacy rows until next sign-in | gap unchanged: `maybeDecrypt` still consults `resolveStoredBackupPassword` (`backup-restore.service.ts:477-481`) for unconverted rows, which is the recorded gap and the only path found |
| INV-BACKUP-009 | Restore writes only the restoring user's rows; every reference names a row of the file | `resolveRestoreReferences` (canonical UUIDs, refusal), remap, Phase-3 `user_id = $3` / `ownedThrough` | held (integration 25 passed); the Phase-3 predicate itself is untested (M4 undetected, section 10) |
| INV-ATTACHMENT-001 | Visible metadata resolves to committed bytes; no bytes without metadata (eventually) | create path: upload intent tombstone, compensation, sweeper; DELETE trigger tombstones every external row (`schema.sql:549`) | create path held; **restore staging writes no intent**, so a process death or a failed discard leaves bytes nothing can enumerate (A26-S06-03, executed) |
| INV-ATTACHMENT-002 | A scan pair is one attachment; cap under the parent row lock | `attachments.service.ts:188-214` lock then count | held (MON-L05 fixed) |
| INV-ATTACHMENT-003 | Bytes read from the row's backend; a switch is a move | `AttachmentStorageRegistry`; export reads `resolve(row.storage_provider)` (`backup-export.service.ts:553-556`) | held for export; restore stages to the bound provider and rewrites `storage_provider` to it, which is consistent with the invariant |
| S05-D (handed by S05) | A semantic backfill reaches rows that arrive later from an artifact | none on the restore path; `BACKUP_VERSION = 1` carries no producing release | violated (A26-S06-04) |

Material flows:

- Export: `POST /backup/export` or cron -> `inExportSnapshot` (one `REPEATABLE READ` transaction, `backup-export.service.ts:419-437`) -> `auditAttachments` (registry read per row, size + SHA-256 check) -> `exportJsonChunks` -> gzip (+ framed encryption) -> stream to response, or `ExportBufferSink` bounded by `BACKUP_EXPORT_BUFFER_LIMIT` -> `store.publish` (atomic) -> promote -> `enforceRetention` -> `recordBackupOutcome` -> `dispatchOffsiteCopy`.
- Restore: upload (admission, ticket) -> `restoreProcessingGate` -> decrypt candidates -> `gunzip` with `maxOutputLength` -> `JSON.parse` -> version check -> legacy table renames -> `resolveRestoreReferences` (refuse) -> re-auth (password or OIDC artifact, spent) -> bond series recovery (external fetch) -> remap ids -> `stageAttachmentObjects` (external bytes written, **no intent**) -> `collectExternalAttachmentKeys` -> maintenance lease -> one `withPreserveTimestamps(withScopedDb)` transaction (delete all, currencies, catalog severing, `RESTORE_PLAN` inserts, Phase-3 repairs, `clearForeignSeriesOfUser`) -> commit -> `.then` (delete displaced, memo invalidation, bond reprice) -> `.catch` (discard staged).
- Attachment delete side effect: every `DELETE` of an external `transaction_attachments` row inserts a tombstone (trigger, `schema.sql:549`), so Phase 1 of a restore hands the displaced objects to the hourly sweeper even if the post-commit delete fails (R6).

## 3. Lens ledger

| Lens | Result |
| --- | --- |
| Pin the exact revision | ran (section 1) |
| Repository instructions first | ran: `AGENTS.md`, `CLAUDE.md`, `backend/CLAUDE.md`, `.claude/commands/audit.md` (structure, backup lens, finding standard, severity), `docs/system-invariants.md` INV-BACKUP-001..009 and INV-ATTACHMENT-001..003 in full, `docs/backup-restore-contract.md` section 8 tail, `docs/external-side-effects.md` restore paragraph, `docs/support-backup.md` currency paragraph, `docs/specs/joint-accounts.md` revoke section |
| Summaries as hypotheses | ran: every MON row and S02/S05 hand-off re-derived from code; R6 refuted my own hypothesis (displaced delete failure orphans bytes) |
| Invariant model first | ran (section 2) |
| Complete change surface | ran: section 12 lists full reads and sampled ranges; producers/consumers of `storage_key`, `storage_provider`, `currencies(code)` FKs, `legacy` entries |
| Cross-layer verification | ran for schema FK -> `ensureCurrenciesExist` list -> export `currency_codes_referenced_by_user`; trigger -> tombstone -> sweeper; frontend `backupApi.ts` / settings not opened (no candidate needed it; handed to S19 for the restore dialog round trip) |
| Representation boundary | ran: UUID spellings (`canonicalUuid`, `deepRemapIds` length pre-check only matches canonical form, safe because references are canonicalised first); monthly tier name uses a 2-digit year (`auto-backup.service.ts:2214`, parsed as `20YY`, consistent); `bytea` via base64 (guard spec, not re-derived) |
| Browser/UI round trip | not applicable in full because the slice's UI (restore dialog, policy screen) is S19's form round trip; the server responses it reads (`skippedAttachments`, `unusableAiProviderKeys`) were checked to be outside `restored` |
| Server-authoritative metadata | ran: `storage_key` forced to the attachment id, `storage_provider` forced to the runtime, `user_id` forced, ownership of legacy source objects proven from the database (`backup-attachment-transfer.service.ts:284-359`) |
| Identity versus value | ran: currencies keyed by code (global namespace, section 9); attachment id = object key; legacy flat-root filenames have no owner (A26-S06-01) |
| State machine | ran for the restore phases and the auto-backup tiers (daily, weekly, monthly, partial); off-machine row states via the integration suite only |
| Concurrency and idempotency | ran: `claimDueBackup` conditional `UPDATE`; manual fan-out claim; manual run vs cron for one user (no per-user claim, section 11); restore under the maintenance lease; attachment cap under row lock |
| Partial failure and compensation | ran and executed: R3 (failure inside the transaction), R4 (death between staging and commit), R5 (throw after commit), R6 (failed displaced delete) on local and S3 |
| External/provider lookup | ran: bond series recovery before the transaction, refused fetch recorded (not re-executed; S14 owns the adapter) |
| Database and migration | ran: restore ordering against FKs (M3), deferred FK list, A26-S05-03 restore half |
| Backup/restore | ran, every item of the protocol's list: tenant namespace (A26-S06-01), ownership/RLS (INV-BACKUP-009 held), external bytes (R1/R2 executed), snapshot (REPEATABLE READ), atomic publication (local held, S3 evidence A26-S06-02), incomplete archive visibility (completeness envelope, `warnIfArtifactIncomplete`), crash cleanup (A26-S06-03), retention isolation (A26-S06-01), staged object cleanup (A26-S06-03, R5 design risk), path traversal (`assertSafeStorageKey`, `safePath`, `isShardableId`), decompression limits (`maxOutputLength`), restore ordering and FK dependencies (M3), ID and relationship remapping, duplicate ids (blob rebuild), restore into non-empty state (Phase 1), rollback (R3), cross-tenant references (refusal), support-backup de-identification (MON-M18), secrets omitted (AI keys re-keyed, `unusableAiProviderKeys`), legacy compatibility (A26-S06-04, legacy attachment path), externally stored objects (R1/R2) |
| Financial and loan | ran only for the linked asset/loan restore order (MON-M08); no money arithmetic in the slice |
| Authorization, authentication and RLS | ran: `auto-backup.controller.ts:46-47` `@Roles("admin")` on every policy/browse route; restore re-auth ordering; legacy object reads gated by a database ownership proof |
| Tests are evidence | ran: A26-S06-02 (gated suite wrong and never run), M4 undetected, restore-plan spec checks declarations not SQL |
| Mutation | ran (section 6) |
| Counterexample | ran (section 7) |
| Interaction | ran (section 7) |
| Rejected hypotheses | section 8 |
| Suggested fix diff | per finding |
| Adversarial approval challenge | section 13 |

## 4. Confirmed findings

### A26-S06-01 - Automatic-backup retention deletes legacy flat-root artifacts of other owners (MON-H01 residual, MON-M43; carries A26-S02-06)

1. **Severity:** MEDIUM
2. **Confidence:** high (executed: mutation M1)
3. **Location:** `backend/src/backup/auto-backup.service.ts:2253-2311` (sort tie-break `:2297`, comment `:2256-2263`); `backend/src/backup/storage/local-backup-storage.target.ts:335-341` (`list` returns the flat base as `legacy: true`), `:427-434` (`remove` deletes there); specs `auto-backup.service.spec.ts:3870`, `:3907`.
4. **Violated invariant:** INV-BACKUP-001 "namespaced by owner": one owner's retention pass never deletes another owner's artifact.
5. **Realistic reproduction scenario:** a deployment upgraded from the pre-sharding layout holds `monize-backup-daily-*.json.gz` files of several users directly in `BACKUP_CONTAINER_DIR`. Any user's next run (cron or the admin's "Run Backup Now" fan-out, which runs every account) lists those files as its own `legacy` entries and `deleteExcess` removes every one past that user's `retentionDaily`.
6. **Observed:** the flat files are deleted by whichever account runs first; on an equal date the legacy copy is preferred for deletion. Two tests assert this as correct.
7. **Expected:** an artifact whose owner cannot be recovered from its name is never deleted by a per-user pass; it is left for an explicit operator action.
8. **Impact:** loss of other users' only pre-upgrade recovery points (encrypted or plaintext), silently, the first hour after the upgrade. Recovery and data-integrity impact on a one-time population; no ongoing cross-owner effect on the sharded layout.
9. **Root cause:** the owner ambiguity of a legacy name is resolved by sweeping instead of refusing; `open()` already refuses legacy entries for the same reason (`:392-395`), so the two methods disagree about whether a legacy file belongs to the caller.
10. **Recommended correction:** exclude `legacy` entries from `deleteExcess`; document the flat root as operator-owned (a one-line release note and a log line counting what is left).
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/backup/auto-backup.service.ts
+++ b/backend/src/backup/auto-backup.service.ts
@@ -2290,9 +2290,11 @@
     const deleteExcess = async (tier: BackupTier, limit: number) => {
       if (!tiers.includes(tier)) return;
+      // A legacy flat-root file names no owner, so it is never this user's to
+      // delete (open() refuses it for the same reason).
       const sorted = files
-        .filter((f) => f.tier === tier)
+        .filter((f) => f.tier === tier && !f.entry.legacy)
         .sort(
           (a, b) =>
-            b.date.getTime() - a.date.getTime() ||
-            Number(a.entry.legacy) - Number(b.entry.legacy),
+            b.date.getTime() - a.date.getTime(),
         );
```

12. **Recommended regression test:** invert `auto-backup.service.spec.ts:3870` and `:3907`: legacy files survive any user's retention, and a sharded file is still pruned to the limit.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
-    it("counts files left flat in the base folder by an older version", async () => {
+    it("never deletes a file left flat in the base folder by an older version", async () => {
 ...
-      for (const name of legacyNames) {
-        await expect(fs.access(join(root, name))).rejects.toThrow();
-      }
+      for (const name of legacyNames) {
+        await expect(fs.access(join(root, name))).resolves.toBeUndefined();
+      }
```

14. **Verification method:** `TZ=UTC npm run test:unit -- auto-backup`; M1 shows exactly these two tests change verdict.
15. **Residual risks / patch limitations:** legacy files then accumulate until an operator removes them; the instance-namespace half (two deployments sharing one directory or bucket prefix with the same user ids) is a design decision, section 9.

Causality: `PRIOR_REPORTED`, `CONFIRMED_WITH_DIFFERENT_ROOT_CAUSE` (MON-H01 residual; MON-M43 narrowed to the two legacy tests). Rule 7 surfaces: cron path and manual fan-out, both through `applyBackupOutcome -> enforceRetention`.

### A26-S06-02 - The S3 half of INV-BACKUP-006 rests on an integration suite that never runs in CI and fails when it does

1. **Severity:** MEDIUM (verification defect)
2. **Confidence:** high (executed against an S3-compatible endpoint)
3. **Location:** `backend/test/integration/backup-store-s3.integration.spec.ts:21-41` (gate on `BACKUP_STORE_S3_TEST_ENDPOINT`), `:160-185` (test defect); `.github/workflows/ci.yml` (no MinIO service, no endpoint variable: `grep -i minio` returns nothing); `docs/system-invariants.md` INV-BACKUP-006 "Required tests ... Integration against MinIO", status `enforced`.
4. **Violated invariant:** `docs/release-integrity.md` / verification contract: a property listed as enforced by a test is enforced by a test that runs and passes.
5. **Realistic reproduction scenario:** run the suite with an endpoint: `BACKUP_STORE_S3_TEST_ENDPOINT=http://127.0.0.1:9000 npm run test:integration -- backup-store-s3` (bucket `monize-store-test` created).
6. **Observed:** 7 passed, 2 failed. (a) "carries one hourly cycle end to end" names its dailies `monize-backup-daily-2026-09-${day}` with `day` unpadded (8, 9, 10..14), prunes by `localeCompare`, and so keeps `09-8` and `09-9` as "newest": the test's own pruning is wrong, independent of the emulator. The production names are zero-padded (`getLocalDateString`, `en-CA` 2-digit), so this is a test defect, not a code defect. (b) "is refused by the destination when the declared checksum does not match" resolved: moto does not validate `ChecksumSHA256`. That is an emulator limitation, but it also shows the invariant text's claim "where an S3-compatible service ignores the checksum header we learn it from a rejected put, not from a silent acceptance" is false for at least one S3-compatible implementation: an ignoring service accepts silently.
7. **Expected:** the suite runs in the `backend-integration-tests` job (the comment at `:23-27` says that is where it is meant to run) and passes; or INV-BACKUP-006 records the S3 half as `partial` until it does.
8. **Impact:** the only bucket-backed evidence for atomic publish, promotion and prune on S3 has never executed green; a regression in `s3-backup-storage.target.ts` would ship. Operations: an S3-compatible store that ignores checksums gives no integrity check on publish, contrary to the invariant text.
9. **Root cause:** an environment-gated suite with no CI job that sets the gate, plus a fixture that was never run.
10. **Recommended correction:** add the MinIO service and the variable to the integration job (an agreed `.github/` change, out of this audit's scope), fix the fixture to zero-pad, and reword the checksum sentence to "a store that ignores the header accepts silently; only AWS S3 and MinIO are known to validate".
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/test/integration/backup-store-s3.integration.spec.ts
+++ b/backend/test/integration/backup-store-s3.integration.spec.ts
-      const dailies = [8, 9, 10, 11, 12, 13, 14].map(
-        (day) => `monize-backup-daily-2026-09-${day}.mzbe`,
-      );
+      const dailies = [8, 9, 10, 11, 12, 13, 14].map(
+        (day) => `monize-backup-daily-2026-09-${String(day).padStart(2, "0")}.mzbe`,
+      );
--- a/docs/system-invariants.md
+++ b/docs/system-invariants.md
-                    S3-compatible service ignores the checksum header we learn
-                    it from a rejected put, not from a silent acceptance.
+                    S3-compatible service ignores the checksum header, the put
+                    is accepted silently; the integration suite against MinIO
+                    is what shows the configured store validates it.
```

12. **Recommended regression test:** the existing suite, run in CI with the endpoint set.
13. **Suggested regression-test diff:** the fixture fix above; the CI service block is a `.github/` change for the maintainer.
14. **Verification method:** the command in field 5 against MinIO: 9 passed.
15. **Residual risks / patch limitations:** not re-run against MinIO here (no image reachable); case (b) is expected to pass on MinIO and remains unverified in this session.

Causality: `NEW_SINCE_UPSTREAM_AUDIT` (the S3 store target and its suite postdate `d5cea9bf`). Handed to S21 for the CI half.

### A26-S06-03 - Restore staging writes external attachment objects without an upload intent; a process death or a failed discard leaves bytes nothing can find (MON-M22 residual)

1. **Severity:** LOW
2. **Confidence:** high (executed: R4 on local and S3)
3. **Location:** `backend/src/backup/backup-attachment-transfer.service.ts:503-529` (`tryStageAttachmentObject`, a bare `attachmentStorage.save`), `:532-542` (`discardStagedAttachmentObjects`, failures only logged); `backend/src/backup/backup-restore.service.ts:244-283, 438-448`. Contrast `backend/src/attachments/attachments.service.ts` create path (intent committed before the put).
4. **Violated invariant:** INV-ATTACHMENT-001 "no bytes exist without metadata", eventually, which the create path achieves through an upload-intent tombstone the sweeper can enumerate.
5. **Realistic reproduction scenario:** a restore of an artifact carrying attachments on a `local` or `s3` deployment; the pod is killed (OOM, rollout) after staging and before the commit, or the commit fails and the discard `DeleteObject` fails transiently.
6. **Observed:** R4 (injected failure in `restoreDeferredFkColumns`, discard suppressed to model process death): both staged keys hold bytes, no `transaction_attachments` row names them, and `attachment_blob_tombstones` gained 0 rows. The sweeper works only from tombstones, so the objects are permanent.
7. **Expected:** staging follows the create path's protocol: an intent tombstone per staged key committed before the put, cleared inside the restore transaction (or left for the sweeper on any failure).
8. **Impact:** storage leak of copies of the user's own receipts in the volume or bucket, outside any metadata, surviving later account deletion. No exposure to another tenant; no incorrect figure.
9. **Root cause:** the restore was given its own object-write path instead of reusing the intent/compensation protocol of INV-ATTACHMENT-001.
10. **Recommended correction:** write `attachment_blob_tombstones` intents (`upload_lease_expires_at` set) for the staged keys in a short transaction before staging; in the restore transaction, clear them fenced on `swept_at IS NULL` exactly as `AttachmentsService.create` does; on failure leave them.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/backup/backup-attachment-transfer.service.ts
+++ b/backend/src/backup/backup-attachment-transfer.service.ts
   private async tryStageAttachmentObject(key: string, bytes: Buffer): Promise<boolean> {
     try {
+      // Same protocol as AttachmentsService.create: the intent outlives the
+      // process, so a death before the commit leaves a key the sweeper finds.
+      await this.objectIntents.record(this.attachmentStorage.name, key);
       await this.attachmentStorage.save(key, bytes);
       return true;
--- a/backend/src/backup/backup-restore.service.ts
+++ b/backend/src/backup/backup-restore.service.ts
                 await clearForeignSeriesOfUser(manager, userId);
+                await this.attachments.clearStagingIntents(manager, stagedKeys);
```

   (`objectIntents` stands for the helper in `attachments/storage/object-intent.ts`; its exact API was not read in this session.)
12. **Recommended regression test:** R4 of the scratch spec, asserting the tombstone count rises by the number of staged keys and the sweeper then removes them.
13. **Suggested regression-test diff:** R4 in `<scratchpad>/s06-roundtrip.integration.spec.ts`, with `expect(await tombstones()).toBe(before + staged.length)`.
14. **Verification method:** the integration case on `local` with a real tmpdir, then one sweeper pass.
15. **Residual risks / patch limitations:** the intent must not be swept while a long restore is still staging; the lease length has to cover the gate's queue time.

Causality: `PRIOR_REPORTED`, `CONFIRMED_WITH_DIFFERENT_ROOT_CAUSE` (MON-M22: the upload and delete paths are fixed; the restore staging path is the remaining uncoupled writer).

### A26-S06-04 - A restore applies no semantic backfill to rows from an older artifact (`skip_price_updates`; carries A26-S05-03)

1. **Severity:** LOW
2. **Confidence:** medium (static; LOW does not require execution)
3. **Location:** `database/migrations/20261012131846_securities_skip_price_updates_user_switch.sql` (one-time `UPDATE`); `backend/src/backup/backup-format.ts:13` (`BACKUP_VERSION = 1`, compared for equality at `backup-restore.service.ts:720`); no reference to `skip_price_updates` anywhere in `backend/src/backup/` except `support-backup/support-backup-rules.ts:439`.
4. **Violated invariant:** S05-D: a migration that changes what a stored value means reaches every row that will carry the old meaning.
5. **Realistic reproduction scenario:** as A26-S05-03: a 1.18 backup holding a security with `skip_price_updates = true` and a provider override, restored on 1.19.
6. **Observed:** the row is inserted as stored; the security never refreshes under 1.19 semantics.
7. **Expected:** the restore normalizes rows from artifacts older than the change.
8. **Impact:** stale prices for the affected securities until the user flips the switch; visible in the UI; no money moves.
9. **Root cause:** the artifact carries no producing release or schema marker, so the restore cannot tell an old meaning from a deliberate new value; every future semantic backfill has the same gap.
10. **Recommended correction:** add `producedBy` (application version or the newest applied migration name) to the envelope, and a restore-side table of normalizations keyed by the migration that introduced them; apply `skip_price_updates` normalization when the artifact predates `20261012131846` or carries no marker.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/backup/backup-restore-database.service.ts
+++ b/backend/src/backup/backup-restore-database.service.ts
+  /** Semantic backfills a restored row must pass through, keyed by migration. */
+  async applyLegacyNormalizations(m: EntityManager, userId: string, producedBy: string | null) {
+    if (producedBy === null || producedBy < "20261012131846") {
+      await m.query(
+        `UPDATE securities SET skip_price_updates = false
+          WHERE user_id = $1 AND skip_price_updates
+            AND (quote_provider IS NOT NULL OR msn_instrument_id IS NOT NULL)`,
+        [userId],
+      );
+    }
+  }
```

12. **Recommended regression test:** restore a fixture without `producedBy` holding `{ skip_price_updates: true, quote_provider: "yahoo" }` and assert `false`; one with `producedBy` at or after the migration keeps `true`.
13. **Suggested regression-test diff:** a case in `backup-restore.integration.spec.ts` built from `seedUserData` plus one `UPDATE securities`.
14. **Verification method:** the integration case.
15. **Residual risks / patch limitations:** artifacts written by 1.19.0 itself carry no marker and would be normalized too, clearing a deliberate switch on a security with a provider; the marker has to ship before the normalization is keyed on it, or the predicate accepted as safe.

Causality: `NEW_SINCE_UPSTREAM_AUDIT`.

### A26-S06-05 - The repository still has no local/S3 attachment backup-restore round trip (MON-M47)

1. **Severity:** LOW (missing test; the behaviour itself was executed and holds)
2. **Confidence:** high
3. **Location:** `backend/test/integration/backup-restore.integration.spec.ts` (database provider only, via `attachmentStorageProviders()`, `test/helpers/integration-setup.ts:502-516`); `backend/src/backup/backup.service.spec.ts` (mocked storage).
4. **Violated invariant:** INV-ATTACHMENT-001 and MON-H02's fix: a restored external attachment downloads the same bytes under its remapped key.
5. **Realistic reproduction scenario:** revert the carried-bytes branch of `stageAttachmentObjects` for external providers; every repository suite stays green because none restores onto `local` or `s3`.
6. **Observed:** no repository test uses `LocalStorageProvider` or `S3StorageProvider` in a restore.
7. **Expected:** the six cases of the scratch spec (R1..R6) in the repository, parameterized over `local` (real tmpdir) and, where an endpoint is set, `s3`.
8. **Impact:** regression risk on the path MON-H02 fixed.
9. **Root cause:** the shared harness binds the database provider because it "needs no extra config".
10. **Recommended correction:** add the parameterized spec.
11. **Suggested remediation diff:** `<scratchpad>/s06-roundtrip.integration.spec.ts` lines 1-30 (provider factory) and R1..R3, R6; R4 and R5 belong to A26-S06-03 and section 9.
12. **Recommended regression test:** as 10.
13. **Suggested regression-test diff:** as 11.
14. **Verification method:** `S06_PROVIDER=local npm run test:integration -- <spec>`: 6 passed here; `S06_PROVIDER=s3` with an endpoint: 6 passed here.
15. **Residual risks / patch limitations:** the S3 variant needs the CI endpoint of A26-S06-02.

Causality: `PRIOR_REPORTED`, `CONFIRMED` (MON-M47, still open).

### A26-S06-06 - The Phase-3 owner predicate of the restore has no test that fails without it (M4 undetected)

1. **Severity:** LOW (missing test on a defence-in-depth layer)
2. **Confidence:** high (executed: mutation M4)
3. **Location:** `backend/src/backup/backup-restore-database.service.ts` `restoreDeferredFkColumns` (the `"user_id = $3"` / `ownedThrough` predicate); `backend/src/backup/restore-plan.spec.ts:141-169` (checks the `DEFERRED_FK_REPAIRS` declarations, not the SQL); INV-BACKUP-009 lists that spec as the test of the confinement.
4. **Violated invariant:** INV-BACKUP-009 "Phase-3 repair UPDATEs carry user_id = $3", as a tested property.
5. **Realistic reproduction scenario:** replace the predicate with `(user_id = $3 OR true)`.
6. **Observed:** 208 unit tests in `restore-plan`, `backup-restore-database`, `backup.service` and 25 integration tests pass.
7. **Expected:** a test seeds a second user's row and calls `restoreDeferredFkColumns` with a `data` row whose id is that row's id, and asserts the other row is unchanged.
8. **Impact:** today unreachable (resolveRestoreReferences and the remap make every id fresh); the predicate is the layer that must hold if either regresses, and nothing would notice its removal.
9. **Root cause:** the spec proves the plan is declared confined, not that the SQL is.
10. **Recommended correction:** add the direct test; reword INV-BACKUP-009's required-tests line.
11. **Suggested remediation diff:** none to production code.
12. **Recommended regression test:** as 7.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+  it("a Phase-3 repair never updates another user's row, whatever id the data names", async () => {
+    const victim = await createTestUserDirect(dataSource);
+    const v = await seedUserData(victim.id);
+    const restorer = await createTestUserDirect(dataSource);
+    await withScopedDb(dataSource, (m) =>
+      module.get(BackupRestoreDatabaseService).restoreDeferredFkColumns(
+        m, { categories: [{ id: v.childCategoryId, parent_id: null as never, }],
+             payees: [{ id: v.payeeId, default_category_id: v.childCategoryId }] } as never,
+        restorer.id));
+    const [row] = await dataSource.query(`SELECT default_category_id FROM payees WHERE id = $1`, [v.payeeId]);
+    expect(row.default_category_id).toBe(v.childCategoryId); // unchanged
+  });
```

14. **Verification method:** M4 must turn this case red.
15. **Residual risks / patch limitations:** none beyond the test's own fixture.

Causality: `NEW_SINCE_UPSTREAM_AUDIT` (the predicate and the spec postdate the upstream audit).

## 5. Prior-finding dispositions

| ID | Disposition | Evidence |
| --- | --- | --- |
| MON-H01 | STILL_OPEN (residual) -> A26-S06-01 | Owner collision FIXED: per-user sharded folder (`local-backup-storage.target.ts:487-500`, `s3-backup-storage.target.ts` per-user prefix); `auto-backup.service.spec.ts` "writes two users' same-day backups to different files" and "applies one user's retention only to their own artifacts" run through the real `AutoBackupService` and the real local target on a real `mkdtemp` (unit batch green; this is the two-owner same-date run, executed). Residual: legacy flat-root sweep (A26-S06-01, M1) and no instance namespace (section 9). |
| MON-H02 | FIXED_VERIFIED | Bytes travel for every provider (`export-attachments.ts`, registry read `backup-export.service.ts:553`), validated before the destructive delete, keys forced to the remapped id (`backup-attachment-transfer.service.ts:288`). Executed: scratch R1 (same-user restore twice: 2 attachments, SHA-256 of every restored object equals its row and the original bytes, old objects removed, 2 files left on disk) and R2 (cross-user: bytes carried, source untouched) on a real tmpdir and on S3 (moto), 6/6 each. Latent post-commit hazard: section 9 (R5). |
| MON-M08 | FIXED_VERIFIED | `accounts.linked_loan_account_id` (and `linked_account_id`, `source_account_id`) in `DEFERRED_FK_COLUMNS` (`restore-plan.ts`), proven against schema FKs by `restore-plan.spec.ts`; integration case asserting `restoredAsset.linked_loan_account_id` (`backup-restore.integration.spec.ts` ~:775) passed; M3 (remove the deferral) fails 3 unit and 1 integration test. |
| MON-M09 | FIXED_VERIFIED | `writeFileAtomic` / `copyFileAtomic` (temp `wx`, full write loop, fsync, size check, rename, dir fsync; `atomic-file.ts`); stale temp sweep before each run (`auto-backup.service.ts:2139`); name chosen after the export (`:2146-2156`). Real-tmpdir tests in `atomic-file.spec.ts` and `auto-backup.service.spec.ts` green. S3 half: A26-S06-02. |
| MON-M10 | FIXED_VERIFIED | `auto-backup.controller.ts:46-47` `@UseGuards(AuthGuard("jwt"), RolesGuard) @Roles("admin")` on settings, validate, browse, capability and run; `assertWithinAllowedRoots` canonical containment (`backup-paths.ts`) for browse, validate and every resolved location, including the per-user folder after sharding (`local-backup-storage.target.ts:146-158`); symlink tests (`auto-backup.service.spec.ts:1262`) green. |
| MON-M11 | FIXED_VERIFIED (backup half; Helm half S21) | The service no longer assumes the mount: `describeStore` probes containment then writability and reports `available: false` with the reason (`local-backup-storage.target.ts:162-192`); enabling the policy probes the namespace at save time (`auto-backup.service.ts:920-937`). Whether the chart mounts a volume is S21's. |
| MON-M12 | FIXED_VERIFIED | One `REPEATABLE READ` transaction for the audit and every table cursor (`backup-export.service.ts:419-437`), with an idle timeout; `backup.service.spec.ts:801-813`, `:1618` assert the single isolation level. |
| MON-M13 | FIXED_VERIFIED (narrowed) | The download streams (framed encryption, issue #1070); the automatic and support paths buffer under `BACKUP_EXPORT_BUFFER_LIMIT` and refuse with a 400 naming the table (`backup-export.service.ts:194-215`); attachment bytes are resident one object at a time. The bounded in-memory automatic export is a stated design, not an unbounded buffer. |
| MON-M16 | FIXED_VERIFIED | `gunzip` with `maxOutputLength` = the same resolver the processing gate budgets against (`backup-restore.service.ts:103-109, 533-566`); `restoreProcessingGate` caps concurrent decompression; `backup.service.spec.ts` asserts the `decompressTooLarge` path. |
| MON-M17 | FIXED_VERIFIED, residual design risk | The export carries every currency the user created or references, via `currency_codes_referenced_by_user` (migration 137) checked against the schema by `currency-references.spec.ts`; the restore inserts them `ON CONFLICT (code) DO NOTHING` before any referencing row (`backup-restore-database.service.ts` `ensureCurrenciesExist`). Residuals: the restore's fallback list omits `transactions.original_currency_code` and `scheduled_transactions.original_currency_code` (only matters for an artifact older than migration 137); and currency codes are one global namespace, so a target where another user already defined the same custom code keeps that user's definition (section 9). |
| MON-M18 | FIXED_VERIFIED | `pseudonymiseCustomCurrencies` (`support-backup/support-backup.service.ts:508-560`): random code outside the catalogue and taken set, masked name, generic symbol, every `CURRENCY_REFERENCE_COLUMNS` reference rewritten; `support-backup.service.spec.ts:774-893` and `support-backup.integration.spec.ts` (5 passed). |
| MON-M22 | STILL_OPEN (narrowed) -> A26-S06-03 | Create path: upload intent before the put, fenced clear, compensation; delete path: DELETE trigger tombstones every external row (`schema.sql:549`), and R6 shows a failed post-restore delete is reclaimed by the sweeper (tombstones 0 -> 2). Remaining uncoupled writer: restore staging (R4). |
| MON-M43 | STILL_OPEN (narrowed) -> A26-S06-01 | Owner keys asserted per user (`folderFor(id)`); `auto-backup.service.spec.ts:3870` and `:3907` still assert the cross-owner legacy sweep (M1). |
| MON-M47 | STILL_OPEN -> A26-S06-05 | Round trip executed in a scratch spec (local and S3, 6/6 each); the repository still has none. |
| MON-L05 | FIXED_VERIFIED | `attachments.service.ts:188-214` locks the parent transaction row before counting; `attachment-scan-pair.integration.spec.ts` (8 passed) covers the cap per INV-ATTACHMENT-002. A two-connection race at count 9 was not run (the lock is the mechanism; S21 may add it to MON-M46). |

## 6. Mutation table

| Invariant | Mutation (file:line, what) | Test that fails | Verdict |
| --- | --- | --- | --- |
| INV-BACKUP-001 (M1) | `auto-backup.service.ts:2293` add `&& !f.entry.legacy` (the remediation) | `auto-backup.service.spec.ts:3870`, `:3907` (2 failed, 190 passed) | detected; the failing tests are the known-wrong tests of A26-S06-01 |
| INV-ATTACHMENT-001 (M2) | `backup-restore.service.ts:430` make `recomputeLinkedSecurities` reject (any post-commit throw) | no repository test; scratch R5 shows 2 committed rows whose bytes were deleted by the `.catch` | **undetected** (section 9) |
| Restore ordering (M3) | `restore-plan.ts:335` remove `"linked_loan_account_id"` from `DEFERRED_FK_COLUMNS.accounts` | `restore-plan.spec.ts` (3 failed), `backup-restore.integration.spec.ts` (1 failed) | detected |
| INV-BACKUP-009 (M4) | `backup-restore-database.service.ts` `restoreDeferredFkColumns`: `"user_id = $3"` -> `"(user_id = $3 OR true)"` | none: 208 unit, 25 integration passed | **undetected** (A26-S06-06) |
| INV-ATTACHMENT-001 (R4, injected fault rather than code mutation) | discard suppressed after a failure inside the transaction | no repository test; scratch R4 | **undetected** (A26-S06-03) |

A first form of M4 (`"true"`, dropping `$3` from the SQL) failed 7 integration tests for the wrong reason (an untyped parameter), which is why the `OR true` form is the one recorded.

## 7. Counterexamples and the interaction scenario

| Invariant | Counterexample | Result |
| --- | --- | --- |
| INV-BACKUP-001 owner | flat-root daily of user B, user A runs with `retentionDaily = 1` | deleted (A26-S06-01) |
| INV-BACKUP-001 owner | A and B, same date, same root | different folders, both kept (unit, real tmpdir) |
| MON-H02 | A's backup with 2 local attachments restored into A twice | R1: both rounds 2 attachments, `storage_key = id`, fresh ids, SHA-256 equal, old objects removed (local and S3) |
| MON-H02 | the same into B | R2: B has 2 working attachments; A's objects and rows untouched |
| Rollback | failure in Phase 3 | R3: A's rows and objects unchanged; staged objects discarded |
| Crash before commit | failure in Phase 3 with the discard not reached | R4: 2 staged objects with bytes, no row, 0 new tombstones (A26-S06-03) |
| Post-commit | throw in the post-commit hook | R5: restore reported failed, 2 committed rows, bytes deleted (section 9) |
| Displaced cleanup | every `delete` rejects during the restore | R6: restore succeeds, old objects remain, but 2 tombstones were written by the trigger: reclaimed by the sweeper (hypothesis rejected) |
| Path traversal | `transaction_attachments.id = "../../x"` in an uploaded file | refused by `resolveRestoreReferences` (`restore-references.ts:328-329`) before staging; `assertSafeStorageKey` is the second layer |
| Decompression | a small gzip expanding past the limit | `ERR_BUFFER_TOO_LARGE` -> 400 (unit) |

Interaction scenario (two features at once): an administrator presses "Run Backup Now" (the fan-out backs up every account) while the hourly cron runs the same account, on a deployment upgraded from the flat layout. The manual path takes no per-user claim (`runBackupForUser`, `auto-backup.service.ts:1293-1355`), so both runs export and publish the same `monize-backup-daily-<date>` name; each publish is atomic, so the name always holds one complete artifact (INV-BACKUP-006 local holds), but the two runs' digests differ (`exportedAt`), so one run's off-machine dispatch finds the artifact changed under it and refuses, and the other may record a digest conflict and an admin alert. Both runs' retention passes delete the flat-root files of other owners (A26-S06-01). No complete artifact is lost from the owner's own folder. The doc sentence "two runs for the same user and day cannot interleave" is false (section 11).

## 8. Rejected hypotheses

| Candidate | Evidence considered | Why rejected or downgraded | Final classification |
| --- | --- | --- | --- |
| A failed post-restore delete of displaced objects orphans the old receipts forever | R6; `schema.sql:549` trigger | Every DELETE of an external row writes a tombstone; the sweeper deletes the key unless a live row names it | REJECTED |
| A concurrent upload between `collectExternalAttachmentKeys` and Phase 1 orphans its bytes | trigger as above | Phase 1's DELETE tombstones it | REJECTED |
| A non-UUID or traversal `storage_key` from the file reaches a provider | `backup-attachment-transfer.service.ts:288`, `restore-references.ts:328`, `storage-key.util.ts` | key forced to the id; non-UUID ids refused; key validated per provider | REJECTED |
| A crafted file reads another tenant's external object (F3RRR-001) | `loadOwnedAttachmentSources` scoped by `user_id`, stored size and hash compared | ownership comes from the database only | REJECTED |
| Duplicate `attachment_blobs` rows validate one copy and insert another | `:242-251, 427-432` rebuild | collapsed to the validated bytes | REJECTED |
| Non-admin users choose backup folders (MON-M10) | controller guards | admin only, canonical containment | REJECTED (fixed) |
| Restore silently removes a joint-account grantee's access | `docs/backup-restore-contract.md` "Delegation is reset" | documented, product decision recorded as undecided | DESIGN_RISK (documented; not a finding) |
| A cross-owner transfer's counterpart leg keeps a balance effect after the owner restores | `restore-references.ts:217-226` | documented severing; each owner's ledger is self-consistent | REJECTED (documented behaviour; S07 owns the ledger) |
| Manual backup races a restore (TOCTOU on `isUnderMaintenance`) | `auto-backup.service.ts:1297-1305`; export in one `REPEATABLE READ` snapshot; restore one transaction | the snapshot sees either the before or the after state, never a mixture | REJECTED |
| Monthly name with a two-digit year mis-sorts | `backup-file-names.ts` parses `20YY-MM` | consistent within the century | REJECTED |

## 9. Design risks

- **Post-commit `.then` chained to the failure `.catch`** (`backup-restore.service.ts:417-448`): any throw after the commit runs `discardStagedAttachmentObjects` over keys the committed metadata now names, and reports a committed restore as failed. Every callee swallows today (`deleteDisplacedAttachmentObjects` per-key try, `recomputeLinkedSecurities` wraps everything, `invalidatePortfolioSummary` synchronous), so it is not reachable; M2/R5 shows the first future throwing call deletes every restored attachment's bytes, and no test would notice. Remedy: `.then(onCommitted, onFailed)` form, or wrap the post-commit block in its own try so only pre-commit failures discard.
- **No instance namespace in automatic-backup keys** (A26-S02-06 second half): two deployments sharing a directory or `BACKUP_STORE_S3_*` bucket and prefix with the same user ids (a staging clone) write and retain each other's artifacts. Operator-configurable for S3 (prefix), not for local beyond the mount. Needs a decision on an instance id.
- **Currency codes are one global namespace**: a restore onto an instance where another user already created the same custom code keeps that user's `name`, `symbol` and `decimal_places` (`ON CONFLICT (code) DO NOTHING`), and the restoring user cannot edit it.
- **The local attachment provider reuses the backup temp prefix** (`writeFileAtomic`): a crash mid-upload leaves `.monize-backup-tmp-*` inside attachment shard directories, and `cleanStaleTempFiles` is only ever called on backup folders. Storage leak only.
- **Restore format has no producing-release marker** (A26-S06-04 root): every future semantic backfill repeats the gap.

## 10. Missing tests and known-wrong tests

- Known-wrong: `backend/src/backup/auto-backup.service.spec.ts:3870`, `:3907` (assert the cross-owner legacy sweep; A26-S06-01).
- Known-wrong and never run: `backend/test/integration/backup-store-s3.integration.spec.ts:160-185` (unpadded day names; A26-S06-02).
- Missing: local/S3 restore round trip (A26-S06-05, MON-M47).
- Missing: Phase-3 owner predicate (A26-S06-06, M4).
- Missing: restore staging crash/discard-failure leaves an enumerable intent (A26-S06-03, R4).
- Missing: post-commit throw must not discard committed bytes (section 9, M2/R5).
- Missing: two-connection test of the off-machine lease reclamation (INV-BACKUP-005 owed, unchanged).
- Missing: two-connection attachment cap race at count 9 (MON-L05, mechanism present).

## 11. Documentation inconsistencies

- `docs/system-invariants.md` INV-BACKUP-006: status `enforced` with "Integration against MinIO: test/integration/backup-store-s3.integration.spec.ts" as required test; CI never sets the endpoint and the suite fails when run (A26-S06-02). The sentence "where an S3-compatible service ignores the checksum header we learn it from a rejected put, not from a silent acceptance" is false for a service that ignores the header (moto accepts silently).
- INV-BACKUP-006 "Two runs for the same user and day cannot interleave -- the run is claimed (claimDueBackup)": the manual fan-out (`runManualBackupClaimed` -> `runBackupForUser`) takes only the deployment-wide manual claim, never the per-user one (section 7).
- INV-BACKUP-009 lists `restore-plan.spec.ts` "confines every repair to the restoring user's rows" as the test of the Phase-3 scoping; it tests the declarations, not the SQL (A26-S06-06).
- `auto-backup.service.ts:2256-2263` documents the legacy sweep as intended, while `local-backup-storage.target.ts:392-395` refuses to serve the same files because they "can[not] be attributed to anybody" (A26-S06-01).
- `docs/external-side-effects.md` restore paragraph says nothing about the staged objects' crash semantics (A26-S06-03).

## 12. Review ledger

- **Directories inspected:** `backend/src/backup/` (and `storage/`, `support-backup/`, `offsite/` by sampling), `backend/src/attachments/` (+ `storage/`), `backend/test/integration/` (backup, attachment suites), `database/schema.sql` (attachments, tombstones, delegation, currency FKs), `docs/` rows named in section 3.
- **Files read in full:** `backup/backup.service.ts`, `backup/backup-id-remap.util.ts`, `backup/backup-restore.service.ts`, `backup/backup-attachment-transfer.service.ts`, `backup/restore-plan.ts` (code, comments skimmed), `backup/backup-file-names.ts`, `backup/atomic-file.ts`, `attachments/storage/local-storage.provider.ts`, `attachments/storage/s3-storage.provider.ts`, `attachments/storage/database-storage.provider.ts`, `attachments/storage/storage-key.util.ts`, `attachments/storage/attachment-storage.interface.ts`.
- **Files sampled (ranges):** `backup/auto-backup.service.ts` 880-1145, 1166-1262 (grep), 1293-1460, 1601-1660, 2083-2332 (of 2452; the cron fan-out 1654-1906 and reconcile 1906-2080 not read; S08 owns the cron matrix); `backup/backup-restore-database.service.ts` 39-420 (delete phase by grep, 296-520 read); `backup/backup-export.service.ts` 194-300, 400-568; `backup/storage/local-backup-storage.target.ts` 1-560; `backup/storage/s3-backup-storage.target.ts` grep only (legacy, keys); `backup/restore-references.ts` 215-235, 320-345; `backup/export-table-queries.ts` 120-165, 295-330; `backup/support-backup/support-backup-rules.ts` 40-75; `backup/support-backup/support-backup.service.ts` 505-560; `attachments/attachments.service.ts` 180-215 (grep); `attachments/attachment-orphan-sweeper.service.ts` 1-80; `attachments/storage/attachment-storage.registry.ts` 50-70; `bonds/bond-price.service.ts` 239-274; `backup/restore-plan.spec.ts` 141-169; `backup/auto-backup.service.spec.ts` around 1443, 3870-3926 and the two-owner block; `test/integration/backup-restore.integration.spec.ts` 1-413, 775-860; `test/integration/backup-store-s3.integration.spec.ts` 18-185; `test/helpers/integration-setup.ts` 378-400, 502-516.
- **Not read:** `backup/offsite/*` beyond the invariant text and the integration suite result; `backup-envelope.ts`, `backup-key-wrap.ts`, `backup-encryption.service.ts` (INV-BACKUP-008 assessed from the invariant entry and the decrypt-candidate list only); `restore-upload-admission.ts`, `restore-processing-gate.ts`, `restore-peak-rss.harness.ts`; `frontend/src/lib/backupApi.ts`, `frontend/src/components/settings/`; `docs/specs/backup-off-machine.md`, `backup-storage-targets.md`, `backup-envelope-key-wrapping.md`, `docs/adr/0003-*`.
- **Searches performed:** `REFERENCES currencies` over `schema.sql`; `skip_price_updates|appVersion` over `backend/src/backup`; `legacy` in both store targets; `minio|S3_ENDPOINT` in `ci.yml`; `account_delegate|joint|cross-owner` in `backend/src/backup`; `attachment_blob_tombstones` in `schema.sql` and `backend/src/backup`; `REPEATABLE READ`, `decompressTooLarge`, `pseudonym` in specs; `@Roles` in the two controllers.
- **Call sites inspected:** `stageAttachmentObjects`, `discardStagedAttachmentObjects`, `deleteDisplacedAttachmentObjects`, `collectExternalAttachmentKeys`, `enforceRetention`, `claimDueBackup`, `runBackupForUser`, `ensureCurrenciesExist`, `restoreDeferredFkColumns`, `recomputeLinkedSecurities`.
- **Suites run:** section 1 (all green except the two A26-S06-02 failures under an endpoint the CI never sets).
- **Areas reviewed without a finding:** export snapshot, decompression bound, re-auth ordering, AI key transport, reference resolution and remap, carried-bytes validation and blob rebuild, legacy ownership proof, path containment on both stores and both providers, support-backup currency pseudonymisation, admin gating of the policy and browse routes, attachment cap lock.
- **Finding counts:** BLOCKER 0, HIGH 0, MEDIUM 2 (A26-S06-01, -02), LOW 4 (A26-S06-03..06).
- **Undetected mutation rows for the program table:** `INV-ATTACHMENT-001 | backup-restore.service.ts:430 post-commit hook throws -> .catch discards committed bytes | a post-commit-throw restore test | S06`; `INV-BACKUP-009 | backup-restore-database.service.ts restoreDeferredFkColumns predicate -> (user_id = $3 OR true) | a direct Phase-3 cross-user test | S06`; `INV-ATTACHMENT-001 | restore staging crash (fault injection R4) | an intent-count assertion after a failed restore | S06`.
- **Open hypotheses handed on:** to S21: add MinIO and `BACKUP_STORE_S3_TEST_ENDPOINT` to the integration job, and A26-S06-05's parameterized round trip (A26-S06-02, -05); two-connection tests for the off-machine lease and the attachment cap join MON-M46. To S08: the manual fan-out takes no per-user claim against the cron (section 7, doc half here); confirm no effect beyond the off-machine conflict alert. To S19: restore dialog shows `skippedAttachments`, `unusableAiProviderKeys`, `unlinkedBond*` (not opened here). To S04/maintainer: "Delegation is reset" on restore is recorded as an undecided product question in `docs/backup-restore-contract.md`. Disposed from the ledger: "from S02 to S06" (A26-S02-06 -> A26-S06-01; MON-H02 round trip executed; post-commit `.then` -> section 9) and "from S05 to S06" (A26-S05-03 -> A26-S06-04).
- **Deviations:** parallel wave; S04 dependency waived; MinIO unavailable, moto used instead (its checksum behaviour differs, so the checksum case of A26-S06-02 stays unverified here); `auto-backup.service.ts` and `backup-restore-database.service.ts` sampled rather than read in full (L slice, budget); the ledger, sessions and register are not edited by this session (the orchestrator merges this section).

## 13. Adversarial approval challenge

Started from the slice's own abstractions rather than the findings: (1) "bytes before the commit, deletes after it" -- searched every object write and delete on the restore path for its crash and failure semantics, which produced A26-S06-03 and the R5 design risk, and refuted the displaced-delete orphan by finding the DELETE trigger; (2) "sharding is storage distribution, never authorization" -- checked every place a stored artifact is listed, opened and removed for whose it is, which produced the `open` vs `remove` disagreement behind A26-S06-01; (3) "a mock proves the call, not the property" -- ran every gated or provider-specific suite with a real endpoint and a real tmpdir, which produced A26-S06-02 and A26-S06-05; (4) "a restore stays inside the restoring user's rows" -- removed each layer in turn (M3, M4) to see which one the tests actually hold, which produced A26-S06-06. Also searched for a HIGH: a crafted artifact reading or writing another tenant's rows or objects (references refused, ownership from the database, keys forced), a restore that commits rows promising absent bytes (R1..R3, R6 negative), and an unbounded decompression (bounded). None survived. The challenge did not reach the off-machine egress code itself (relied on its guard spec and integration suite) or the encryption envelope.

## 14. Verdict

APPROVE for the slice: no BLOCKER or HIGH survived the approval challenge. Two MEDIUM findings (A26-S06-01 legacy cross-owner retention sweep; A26-S06-02 the S3 store's required integration evidence never runs and is wrong) and four LOW findings should be remediated; MON-H02 is FIXED_VERIFIED by execution on a real directory and an S3-compatible endpoint.
