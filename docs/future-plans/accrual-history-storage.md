# Scalable accrual undo payloads

## Problem and scope

A relationship operation or mixed bulk deletion with one scheduled source must retain every affected ordinary source for exact undo. Serializing that complete state into one history JSONB field currently rejects otherwise supported operations at the 512 KB inline history limit. Batched capture already removes the per-source database round trips. This change addresses storage without raising the generic inline limit, omitting ordinary sources, or changing Cash-only history recording.

Only required accrual relationship/taxonomy/bulk-delete history uses the larger-payload mechanism initially. Existing inline history remains readable. No production deployment or additional public API is part of this repair.

## Persistence and ownership

Add a direct-owned `accrual_history_chunks` table containing action ID, user ID, before/after side, ordinal and a bounded byte payload. The primary key orders parts within one side. A composite foreign key to the action-history ID/owner pair enforces ownership even without RLS. Parent deletion cascades chunks, including redo-stack clearing, pruning, user removal and restore wiping. Use the uniform direct-owner RLS policy with initplans and an explicit enable statement in the paired schema/migration. No role-specific grants.

Required accrual history uses a versioned physical entity kind, with its original kind in a private nullable parent column. Older backends refuse that unknown kind; new history presentation exposes the original kind without loading payloads. Legacy records keep their original behavior.

The small history JSONB field contains a versioned manifest only when the combined sides exceed the inline limit. Its manifest records byte length, part count and SHA-256 digest. Small sides retain their existing shape and issue no chunk queries. Parts store UTF-8 bytes, so splitting a multibyte character never changes the restored JSON. Each part has a database size constraint; the inline history limit remains unchanged.

History is transient and intentionally excluded from backups today. Classify the new child table the same way; restore wiping and pruning delete its parent and rely on the cascade. No payload bytes are added to public history responses or support exports.

## Write and replay protocol

All storage work joins the caller's scoped transaction. Required source changes and required history inserts either commit together or roll back together. Create the history parent before its chunks. On replay, validate the manifest, exact ordered parts, byte count and digest before accepting the reconstructed state; missing/corrupt/foreign-owner data refuses without a partial source or balance change.

Keep existing parent-before-leg source locks, account ordering, versioned undo arbitration, fingerprint checks and conditional history updates. When replay refreshes one side, acquire the existing conditional parent history update before deleting/replacing chunks. Thus the order remains source, account, history parent, history children, avoiding an inverse order against redo-stack deletion cascades. A failed conditional parent update or chunk write rolls back the complete replay.

Hydrate only manifested sides at the undo/redo boundary and when versioned bulk replay re-reads its current action. Preserve the outer entity's response exclusions. Existing legacy inline payloads and ordinary history take their original paths. Do not turn history into client-supplied financial facts.

## Implementation sequence

1. Add the paired idempotent migration/schema, mapped entity and backup classification; retain same-owner integrity and test RLS/cascade behavior.
2. Add a focused storage helper for manifest creation, exact hydration, required action saves and conditional side replacement. Keep it out of reporting reads and ordinary Cash writes.
3. Wire required relationship/taxonomy/bulk-delete recording and replay. Replace their inline-size refusal with the bounded storage representation; retain structural validation and complete mixed-source snapshots.
4. Prove valid large-operation undo/redo through actual services, including a mixed batch where one source is accrued. Verify names, source IDs, split tags, numeric text, schedules and balances. Existing small/legacy cases must remain green.
5. Prove missing/corrupt chunks and failed required history storage leave no partial writes. Exercise same-owner foreign keys, enforced RLS, cascade cleanup and simultaneous replay. Keep normal source/history guards intact.
6. Run schema replay twice, migration lint, relevant backup/RLS/history suites, types/lint and changed tests. Update the server development task list and exact changed-file inventory. Final PR gates and push/comment occur only after the broader review repairs are ready.

## Boundaries still separate

Targeted taxonomy locking and delegated operations need their own membership/permission repair. Active Accrual partial FX, report truncation, and any missing historical budget metadata remain separate findings. This storage change does not claim to fix them.
