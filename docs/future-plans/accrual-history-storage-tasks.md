# Scalable accrual undo payload tasks

- [x] Commit the storage protocol and validation plan before implementation.
- [ ] Add paired schema/migration, entity, same-owner FK, direct RLS and backup classification.
- [ ] Implement exact manifest/chunk storage, hydration and conditional replacement.
- [ ] Wire required relationship/taxonomy/bulk-delete history without changing ordinary inline history.
- [ ] Prove large mixed-operation undo/redo and retained ordinary-source data.
- [ ] Prove corruption/ownership/storage failures roll back complete operations.
- [ ] Verify cascade cleanup, concurrent replay and existing legacy/small history.
- [ ] Run paired-schema, migration, lint/type and focused integration/unit gates.
- [ ] Update server task records/inventory and include results in the eventual PR response.
