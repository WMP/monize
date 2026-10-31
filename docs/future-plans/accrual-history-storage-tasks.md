# Scalable accrual undo payload tasks

- [x] Commit the storage protocol and validation plan before implementation.
- [x] Add paired schema/migration, entity, same-owner FK, direct RLS and backup classification.
- [x] Implement exact manifest/chunk storage, hydration and conditional replacement.
- [x] Wire required relationship/taxonomy/bulk-delete history without changing ordinary inline history.
- [x] Prove large mixed-operation undo/redo and retained ordinary-source data.
- [x] Prove corruption/ownership/storage failures roll back complete operations.
- [x] Verify cascade cleanup, concurrent replay and existing legacy/small history.
- [x] Run paired-schema, migration, lint/type and focused integration/unit gates.
- [x] Update server task records/inventory.
- [ ] Include results in the eventual PR response.
