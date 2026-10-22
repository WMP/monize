# Warranty Tracker: Agent Task List

> Companion to [`warranty-tracker.md`](./warranty-tracker.md) (the design). This file breaks the plan into tasks sized for one AI-agent session each. Do the tasks in dependency order; never start a task whose dependencies are unmerged. Mark a task done by checking its box and noting the PR.

## How to use this list (read first, every session)

- **One task per session/PR.** Each task lists its files. Touching files outside the task's scope is a scope violation -- stop and leave a note instead.
- **The governing invariant applies to every task:** a warranty never writes a ledger row, a balance or a holding (WTY-001). A task that finds itself calling a transaction, account or holdings writer is off the plan.
- **Every status is the server's** (WTY-002). A component that compares `expiresOn` with today to decide a colour, a badge or a sort group is off the plan; read `status` and `daysLeft` from the response.
- **An attachment has one parent** (WTY-003). Code that passes both a transaction id and a warranty id, or that reads `transaction_id` as if it were still NOT NULL, is off the plan.
- **Definition of done for every task** (in addition to per-task acceptance):
  - `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`; plus `npm run build && npm run test:integration` when a query, an entity, a migration or an RLS context changed; `npm run migration:lint` when a migration changed.
  - `frontend/`: `npm run lint && npm run type-check && npm run i18n:check`, `npm run test:changed`, `npm run build`.
  - A migration or `database/schema.sql`: `scripts/verify-schema.sh` and `node scripts/check-migration-prefixes.mjs` as well.
  - Stage new files before running a guard (`git add -N` is enough).
  - New user-facing strings: English catalogs only, then `npm run i18n:pseudo`. The full-locale pass is Q3, once, at acceptance.
  - The doc line each task names lands in the same PR.
- **Terminology:** "the design" = `warranty-tracker.md`; section references point there. Re-locate code by symbol, never by line.

## Deployment safety

| Class | Meaning |
|-------|---------|
| **none** | Tests, docs, or code nothing calls yet. |
| **inert** | Ships real code, a table or endpoints that change nothing until a user creates a warranty (or until a later task calls them). |
| **neutral** | Rewrites a live code path (the attachments table and service, a register enrichment, a nav filter, an additive enum value). Designed behaviour-preserving; the full unit suite of the touched module plus the integration suite is the gate. |

Every task is safe to merge in any order that respects its dependencies: the tables are empty until a user writes to them, the cron finds no candidates, the widget is off by default (`defaultEnabled: false`), the Tools link leads to an empty list, and the attachment generalisation keeps every existing row a transaction's (`warranty_id` null, `document_kind` `other`).

## Task graph

| ID | Task | Depends on | Deploy impact | Status |
|----|------|-----------|---------------|--------|
| S1 | Discussion agreeing `warranty-tracker.md`; label `approved-to-build`; answers to W1 to W4 recorded in the design | -- | none | [ ] approved directly by the maintainer, 2026-10-21; no Discussion was opened |
| B1 | Migration + `schema.sql`: `warranties` and `warranty_claims` with RLS; entities; currency reference column list and SQL function; backup classification (export queries, `RESTORE_PLAN`, `restore-references.ts`, `BackupData`, restore wipe, support-backup rules, `RESTORE_LABELS`); `runOwnedDataDeletes` | S1 | inert | [x] (b0ea503fc, 2026-10-21) |
| B2 | Attachment generalisation: migration on `transaction_attachments` (design 6.3), entity, `AttachmentParent` through `AttachmentsService`, `lockWarrantyRow`, warranty routes in the controller, tool-prep cap per parent, restore references; transaction-only consumers asserted so by test | B1 | neutral | [x] (1b4d56711, 2026-10-21) |
| B3 | `WarrantiesModule`: `warranty-status.util.ts`, `warranty-expiry.util.ts`, service CRUD with WTY-005, DTOs, controller, list filters, summary route, `warranties.guard.spec.ts` (WTY-001) | B1 | inert | [x] (0613ac927, 2026-10-21) |
| B4 | Claims: entity wiring, DTOs, service methods, routes | B3 | inert | [x] (07cc3ca2d, 2026-10-21) |
| B5 | Delegate section `warranties` on the backend: migration (design 6.4), entity, `DelegateSection`, `SECTION_FIELD`, `toSectionSet`, `setSectionGrants`, `SetSectionsDto`; `@AllowDelegate` + section on the read routes incl. warranty attachment reads and download; `linkedTransaction` scoping (WTY-007) | B2, B4 | neutral | [x] (44fd5c69b, 2026-10-21) |
| B6 | Notification types, `WARRANTIES` category and channels on both layers; push and email copy; spec row | S1 | neutral | [x] (1f93214a4, 2026-10-21) |
| B7 | `WarrantyExpiryReminderService` cron, `WITH_CONTEXT_ALLOWLIST`, `docs/cron-jobs.md` row, two-replica test | B3, B6 | inert | [x] (a8d7367eb, 2026-10-21) |
| B8 | Register enrichment `warrantyCount`; `has:warranty` search and interpretation | B3 | neutral | [x] (00f19ef59, 2026-10-21) |
| B9 | `WarrantyImportService` and `POST /warranties/import` (RFC 4180 via `parseCsv`, dry run, limits, WTY-006) | B3 | inert | [x] (db2836f1d, 2026-10-21) |
| F1 | `warrantiesApi`, types, `warranties` i18n namespace, Tools link and icon, density view, cache prefix, Warranties page (list, filters, summary, form, archive, delete) | B3 | inert | [x] (8a78af826, 2026-10-21) |
| F2 | `attachmentsApi` parent union and `AttachmentsSection` warranty variant; warranty detail page with documents, claims and the linked transaction | F1, B2, B4 | neutral | [x] (210daf05a, 2026-10-21) |
| F3 | Register hook: action sheet and Copy dropdown items, `WarrantyBadge`, `TransactionWarrantiesLine`, `?new=1&transactionId=` prefill | F1, B8 | neutral | [x] (1e542138d, 2026-10-21) |
| F4 | `WarrantiesExpiringWidget` in the dashboard registry (`defaultEnabled: false`), icon, title section | F1 | inert | [x] (1c539dcbe, 2026-10-21) |
| F5 | Notification copy (`useNotificationCopy`, `notifications.json`) and the `/warranties/<id>` target | B6, F1 | inert | [x] (c438b6e48, 2026-10-21) |
| F6 | Delegate section on the client: `DelegateAccessModal` toggle, `delegation.ts`, nav gating by section in `AppHeader` and `MobileNavDrawer`, the warranties layout with `DelegateSectionGuard`, `section-layouts.test.tsx`, widget visibility | B5, F1 | neutral | [x] (6575d1608, 2026-10-21) |
| F7 | CSV export through `csv-export.ts` and the import dialog (file picker, preview table, commit) | F1, B9 | inert | [x] (b1aef04eb, 2026-10-21) |
| A1 | `list_warranties` on MCP and the in-app assistant over one `getLlmWarranties` method; tool-count and byte-budget specs | B3 | inert | [x] (07b98839c, 2026-10-21) |
| Q1 | Backend integration suite `warranties.integration.spec.ts` (RLS buckets, WTY-003 CHECK, WTY-005, WTY-007, backup round-trip with a warranty attachment, cron dedupe across two connections) | B5, B7, B9 | none | [x] (1f97366df, 2026-10-21) |
| Q2 | Playwright `tests/warranties.spec.ts` | F2, F3, F7 | none | [ ] |
| Q3 | Full-locale i18n pass (acceptance, final commit) | all above | none | [x] (2026-10-21) |
| D1 | Wiki page `Warranties.md`, a README feature line, `docs/system-invariants.md` WTY-001..007, `docs/external-side-effects.md` wording for a two-parent attachment | F7 | none | [x] (2026-10-21) |

**Why B6 depends only on S1:** the category and the two types are additive constants; they can land before the producer exists, as the notification-preferences spec allows ("arrives with its producer" is satisfied by B7 landing before Q3).

**Why B5 depends on B2 and B4:** the section gates the warranty attachment reads and the claims list, which must exist to be decorated.

---

## Task details

### S1 -- Proposal

Open a Discussion linking `warranty-tracker.md`, summarising decisions 1 to 14, the two tables, the attachment generalisation, the delegate section and the cron, and asking the maintainer to answer W1 to W4. Record the answers as edits to the design before B1 starts.

### B1 -- Tables, entities, currency references, backup classification

**Files:** `database/migrations/<UTC timestamp>_warranties.sql` (new), `database/schema.sql`, `backend/src/warranties/entities/warranty.entity.ts` and `backend/src/warranties/entities/warranty-claim.entity.ts` (new), `backend/src/currencies/currency-reference-columns.ts` and the migration adding `warranties` to `currency_codes_referenced_by_user`, `backend/src/backup/export-table-queries.ts`, `backend/src/backup/restore-plan.ts`, `backend/src/backup/restore-references.ts`, `backend/src/backup/backup-format.ts`, `backend/src/backup/backup-restore-database.service.ts`, `backend/src/backup/support-backup/support-backup-rules.ts`, `backend/src/backup/support-backup/support-backup-sections.ts`, `frontend/src/lib/restore-labels.ts`, `backend/src/users/users.service.ts` (`runOwnedDataDeletes`), `docs/backup-restore-contract.md` (one row each).

- The DDL of design 6.1 and 6.2, the uniform direct policy and `ENABLE ROW LEVEL SECURITY` for both tables in the same file, `update_updated_at_column` triggers, the indexes named in the design; both table names in `direct_tables` in `schema.sql`.
- DATE columns are `type: "date"` strings on the entity; `serial_numbers` is `type: "text", array: true`; `purchase_price` is `decimal` precision 20 scale 4 (`entity-decimal-precision.spec.ts`); every varchar length matches (`entity-varchar-capacity.spec.ts`).
- `RESTORE_PLAN`: `warranties` after `transactions` and `payees`, `warranty_claims` after `warranties`; `restore-references.ts` rows for `warranties.transaction_id`, `warranties.payee_id`, `warranty_claims.warranty_id`. The restore wipe deletes claims, then warranties, before `transactions`.
- Acceptance: `npm run migration:lint`, `scripts/verify-schema.sh`, `node scripts/check-migration-prefixes.mjs`; `rls-enforcement.integration.spec.ts` places both tables in the direct bucket; `backup-restore.integration.spec.ts` coverage guard passes; `restore-plan.spec.ts` ordering passes; the support-backup golden test passes with the masking of design 6.1 and 6.2; `currency-references.spec.ts` green.
- Inert: nothing reads or writes the tables until B3.

### B2 -- Attachment generalisation

**Files:** `database/migrations/<UTC timestamp>_attachment_parent.sql` (new), `database/schema.sql`, `backend/src/attachments/entities/transaction-attachment.entity.ts`, `backend/src/attachments/attachments.service.ts` + `.spec.ts`, `backend/src/attachments/attachments.controller.ts` + `.spec.ts`, `backend/src/attachments/attachment-tool-prep.service.ts` + `.spec.ts`, `backend/src/attachments/attachment-parent.ts` (new: the `AttachmentParent` union and `attachmentParentWhere`), `backend/src/common/db/locks.ts` (`lockWarrantyRow`), `backend/src/backup/restore-references.ts`, `backend/src/attachments/attachment-parent.guard.spec.ts` (new), `docs/external-side-effects.md` (section 2: an attachment's parent is a transaction or a warranty; ownership is `user_id`), `docs/backend/README.md` (the attachments row).

- Design 6.3 exactly. The migration is idempotent: `DROP NOT NULL` is naturally so, columns use `IF NOT EXISTS`, the two CHECK constraints are added inside a `DO $$ ... IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = ...)` block.
- `AttachmentsService.create(userId, parent, file, original?, documentKind?)` and `findAllFor(userId, parent)`: the lock is `lockTransactionRow` or `lockWarrantyRow` by `parent.kind`; the cap counts `WHERE <parent column> = $1 AND user_id = $2 AND original_of_attachment_id IS NULL` (`primaryAttachmentSql`); both halves of a scan pair carry the parent. `remove`, `getForDownload`, the sweeper and the migrator are untouched (keyed by id).
- The controller adds `POST warranties/:warrantyId/attachments` and `GET warranties/:warrantyId/attachments` with the same interceptor and limits; the response DTO carries `transactionId: string | null`, `warrantyId: string | null`, `documentKind`.
- `attachment-parent.guard.spec.ts`: scans `backend/src/transactions/transactions.service.ts`, `transaction-search.util.ts` and `backend/src/transaction-rules/rule-facts.ts` and fails if any `transaction_attachments` predicate lacks a `transaction_id` restriction (WTY-003's consumer side: a warranty document never counts as a transaction's). Name the invariant in the failure message.
- Acceptance: unit specs for both parents, the cap per parent, the CHECK refusals (integration in Q1), existing attachment specs green unchanged; `primary-attachment.guard.spec.ts` green; `migration:lint`, `verify-schema.sh`.
- Neutral: every existing row keeps `transaction_id` and gets `document_kind = 'other'`; the transaction routes behave as before.

### B3 -- Module, status, CRUD, guard

**Files:** `backend/src/warranties/warranties.module.ts`, `warranties.service.ts` + `.spec.ts`, `warranties.controller.ts` + `.spec.ts`, `warranty-status.util.ts` + `.spec.ts`, `warranty-expiry.util.ts` + `.spec.ts`, `dto/create-warranty.dto.ts`, `dto/update-warranty.dto.ts`, `dto/list-warranties.dto.ts`, `dto/warranty-response.dto.ts`, `warranties.guard.spec.ts`, `rls-context-smoke.spec.ts` (all new), `backend/src/app.module.ts`, `backend/src/i18n/locales/en/errors.json`, `docs/backend/README.md` (one row naming the module and WTY-001).

- `withScopedDb` only. The create and update paths load the named transaction and payee by `(id, userId)` inside the same transaction as the write (WTY-005); a missing one is `NotFoundException` with `tr(...)`.
- `warrantyStatus` and `termToExpiresOn` are pure and the only date arithmetic; the list route computes `today` with `todayInTimezone` of the request's user and returns `WarrantyView` of design 6.5 with `linkedTransaction` for the owner (the delegate narrowing is B5). `documentCount` and `openClaimCount` are two grouped counts over the page's ids, the register's pattern.
- The DTO: `@ValidateIf((_o, v) => v !== null && v !== "")` beside every optional formatted field; the class-level "exactly one of `expiresOn` / `term` / `isLifetime`" validator; `@ArrayMaxSize(10)` and `@MaxLength(100, { each: true })` on `serialNumbers`; `@SanitizeHtml()` on free text; `@IsUrl` with `require_protocol` on `productUrl`; no `userId`.
- `@UseGuards(AuthGuard('jwt'))`, `ParseUUIDPipe` on `:id`, no `@AllowDelegate()` yet (B5 adds it to the reads).
- `warranties.guard.spec.ts` as design 5 WTY-001.
- Acceptance: truth table A and examples 1 and 2 as unit tests; CRUD, refusal and the summary route specs; `module-graph.spec.ts` green.

### B4 -- Claims

**Files:** `backend/src/warranties/warranty-claims.service.ts` + `.spec.ts`, `backend/src/warranties/warranty-claims.controller.ts` + `.spec.ts`, `dto/create-warranty-claim.dto.ts`, `dto/update-warranty-claim.dto.ts` (new), `backend/src/warranties/warranties.module.ts`.

- Every claim route loads the parent warranty by `(id, userId)` in the same transaction (WTY-005); `resolvedOn` requires `status` `resolved` or `denied` (class-level validator); `openClaimCount` in B3's view counts `status = 'open'`.
- Acceptance: CRUD specs, foreign-warranty 404, the status and date rule.

### B5 -- Delegate section

**Files:** `database/migrations/<UTC timestamp>_delegate_warranties_section.sql` (new), `database/schema.sql`, `backend/src/delegation/entities/account-delegate.entity.ts`, `backend/src/delegation/decorators/delegate-access.decorator.ts` (`DelegateSection`), `backend/src/delegation/delegation.service.ts` (`SECTION_FIELD`, `toSectionSet`, `setSectionGrants`), `backend/src/delegation/dto/set-sections.dto.ts`, `backend/src/warranties/warranties.controller.ts`, `backend/src/warranties/warranty-claims.controller.ts`, `backend/src/warranties/warranties.service.ts` (`linkedTransaction` under `delegateReadableAccountScope`), `backend/src/attachments/attachments.controller.ts` and `attachments.service.ts` (the warranty GET and the download under the section), `backend/src/delegation/rls-context-smoke.spec.ts`, `docs/backend/README.md` (the delegation row, one line).

- Read routes gain `@AllowDelegate()` and `@DelegateRequiresSection('warranties')`; write routes gain nothing (owner-only by default, `AccountDelegateGuard`).
- `linkedTransaction` resolution: for a delegate context, the transaction's account must be in `delegateReadableAccountScope`; otherwise `null` and no `transactionId` (truth table C).
- Download by a delegate: `getForDownload` checks, when the caller is a delegate, that the row's parent is a warranty and the section is granted; an attachment of a transaction stays on today's rule.
- Acceptance: truth table C as specs; `delegation.service.spec.ts` green; `migration:lint`, `verify-schema.sh`.
- Neutral: the column defaults to false; nothing changes for existing delegations.

### B6 -- Notification types and category

**Files:** `backend/src/notification-center/entities/notification.entity.ts`, `backend/src/notification-center/notification-category.spec.ts`, `backend/src/notification-center/notification-preference.service.ts` + `.spec.ts`, `backend/src/notifications/notification-dispatch.service.ts` (`PUSH_CATEGORY_COPY`), `backend/src/notifications/notification-email-copy.ts`, `backend/src/notifications/notification-email-messages.ts`, `backend/src/i18n/locales/en/emails.json`, `backend/src/i18n/locales/en/push.json`, `frontend/src/types/notification.ts`, `frontend/src/lib/notification-preferences.ts`, `frontend/src/i18n/messages/en/settings.json`, `docs/specs/notification-preferences.md` (the new `warranties` group).

- Design 6.6. The commit that added the AI-review category is the template for the file set.
- Acceptance: `notification-category.spec.ts` maps both types to `WARRANTIES`; `notification.contract.test.ts` and `notification-preferences.contract.test.ts` green; the preferences matrix shows a Warranties row with in-app on and email configurable.

### B7 -- Expiry reminder cron

**Files:** `backend/src/warranties/warranty-expiry-reminder.service.ts` + `.spec.ts`, `backend/src/warranties/warranty-notifications.ts` + `.spec.ts` (new, pure: thresholds, `warrantyReminderThreshold`, `warrantyExpiryDedupeKey`, `buildWarrantyExpiringNotification`), `backend/src/warranties/warranties.module.ts`, `backend/eslint.config.mjs` (`WITH_CONTEXT_ALLOWLIST` with a justification comment), `docs/cron-jobs.md` (one row; `cron-doc.spec.ts` checks the decorator verbatim and the mechanism vocabulary), `backend/test/integration/warranty-expiry-reminders.integration.spec.ts` (new).

- Design 6.7 exactly, `BankSyncConsentReminderService` as the template; `target: "/warranties/<id>"` as a literal in the builder; `data` holds facts.
- Acceptance: truth table B and examples 3 and 4 as unit tests; the two-connection test proves one notification across two concurrent ticks; archived and lifetime rows produce nothing.

### B8 -- Register enrichment and search

**Files:** `backend/src/transactions/transactions.service.ts` + `.spec.ts` (the enrichment method that computes `attachmentCount`), `backend/src/transactions/transaction-search.util.ts` + `.spec.ts`, `backend/src/transactions/dto/` (the row response type gains `warrantyCount`), `frontend/src/types/transaction.ts` (`warrantyCount?: number`), `docs/frontend/tables-and-registers.md` or the advanced-search doc that lists `has:` values (one line).

- One grouped count over `warranties WHERE transaction_id IN (...) AND archived_at IS NULL`; `has:warranty` is an `EXISTS` beside `has:attachment` and `searchInterpretation` names it.
- Acceptance: the enrichment spec with and without warranties; the search spec; the register page's existing tests green with the new optional field.
- Neutral: one extra index-backed query per register page; no visible change until F3.

### B9 -- CSV import

**Files:** `backend/src/warranties/warranty-import.service.ts` + `.spec.ts`, `backend/src/warranties/warranty-csv.ts` + `.spec.ts` (new, pure: the Warracker column map, serial-number and tag parsing, row validation), `backend/src/warranties/dto/import-warranties.dto.ts` (new), `backend/src/warranties/warranties.controller.ts`, `backend/src/warranties/warranties.module.ts`, `backend/src/i18n/locales/en/errors.json`.

- `parseCsv` and `validateCsvContent` from `backend/src/import/csv-parser.ts`; `FileInterceptor` with `memoryStorage` and `limits: { fileSize: 1 MiB }`; at most 1000 data rows; `dryRun` through one `run` (WTY-006); `termToExpiresOn` from B3 for duration columns; `resolveUserDefaultCurrency` for a blank or unknown `Currency` when `PurchasePrice` is present; `Tags` reported in `skippedColumns`.
- Acceptance: a Warracker sample file (fixture in the spec) imports; dry run and commit agree; the invalid-row cases of the test matrix; the limits.

### F1 -- API client, types, page, form

**Files:** `frontend/src/lib/warranties.ts` + `.test.ts`, `frontend/src/types/warranty.ts`, the Warranties page under the app router at route /warranties with its loading file and test (new), `frontend/src/components/warranties/WarrantyList.tsx` + `.test.tsx`, `frontend/src/components/warranties/WarrantyForm.tsx` + `.test.tsx`, `frontend/src/components/warranties/WarrantyStatusBadge.tsx` + `.test.tsx` (all new), `frontend/src/i18n/messages.ts`, `frontend/src/i18n/messages/en/warranties.json` (new), `frontend/src/i18n/messages/en/navigation.json`, `frontend/src/lib/nav-links.ts` + `.test.ts`, `frontend/src/store/densityStore.ts`, `frontend/src/lib/cache-prefix-classification.guard.test.ts`, `docs/frontend/ui-conventions.md` (one line: a warranty's status pill is `WarrantyStatusBadge`, fed by the server's `status`).

- Design 10, first two bullets. `Card`, `Modal`, `DateInput`, `CurrencyInput`, `CurrencyPickerButton`, `EmptyState`, `Badge`, `Table.tsx`, `SortableHeader`, `ListTopToolbar`, `ListBottomPager`, `useLongPress`, `RowActions`, `RowActionSheet`, `ConfirmDialog`, `useFormModal`, `useNumberFormat()`, `formatDate` with the user's format.
- The form's duration helper fills `expiresOn` client-side as a convenience and submits `expiresOn`; the DTO's `term` form is for the importer and the API. The lifetime switch clears and disables the date.
- The summary strip and every pill read `status` and `daysLeft` from the response (WTY-002).
- Acceptance: tests for loading, empty, list, filters, sort, form validation (exactly one expiry source, price with currency, serial list), archive and delete flows; `nav-links.test.ts` with the new link and icon; `density-preference.guard.test.ts` green.

### F2 -- Documents, claims, detail page

**Files:** `frontend/src/lib/attachments.ts` + `.test.ts`, `frontend/src/types/attachment.ts`, `frontend/src/components/transactions/AttachmentsSection.tsx` + tests, `frontend/src/hooks/useAttachmentBytes.ts` (if it names `transactionId`), the warranty detail page at route /warranties/[id] with its test (new), `frontend/src/components/warranties/WarrantyDetailCard.tsx`, `WarrantyDocumentsSection.tsx`, `WarrantyClaimList.tsx`, `WarrantyClaimForm.tsx` + tests (new), `frontend/src/components/transactions/AttachmentPreviewDialog.tsx` only if a prop names the parent, `docs/frontend/ui-conventions.md` (one line: a warranty's documents are `AttachmentsSection` with a warranty parent, never a second uploader).

- `attachmentsApi.list(parent)` and `upload(parent, file, original?, documentKind?)`; `AttachmentsSection` accepts `{ warrantyId, documentKind? }` as a third variant of its props union and otherwise renders as today; the existing transaction callers pass `{ transactionId }`.
- The detail page links the transaction with `/transactions?targetTransactionId=<id>` and shows the "cannot read this account" copy when `linkedTransaction` is `null` but `transactionId` is absent in a delegate session (design 9).
- Acceptance: attachment lib and section tests for both parents; detail page tests for the status card, documents, claims CRUD, linked and unlinked transaction; `e2e/tests/attachments.spec.ts` selectors unchanged (grep the accessible names).
- Neutral: the transaction attachment UI renders exactly as before.

### F3 -- Register hook

**Files:** `frontend/src/components/transactions/TransactionActionSheet.tsx` + `.test.tsx`, `frontend/src/components/transactions/TransactionRow.tsx` + tests (`CopyDropdown`, `WarrantyBadge`), `frontend/src/components/transactions/TransactionList.tsx` (one optional prop), `frontend/src/components/transactions/TransactionWarrantiesLine.tsx` + `.test.tsx` (new), `frontend/src/components/transactions/TransactionForm.tsx`, the Transactions page under the app router (`handleAddWarranty`, `handleViewWarranties` beside `handleScheduleRecurring`), the Warranties page (reads `?new=1&transactionId=` and `?transactionId=`), `frontend/src/components/ui/row-actions/ActionIcon.tsx` (a shield icon key), `frontend/src/i18n/messages/en/transactions.json`, `frontend/src/test/ui-conventions.test.ts` only if its `<TransactionList` scan needs the new prop listed.

- The action sheet shows "Add warranty" when `warrantyCount` is 0 and "View warranties" otherwise, hidden when `linkedInvestmentTransactionId` is set (as Schedule recurring is) and on a joint row (as attachments are). Every control inside the row calls `stopPropagation` on click, mousedown, touchstart and contextmenu.
- `WarrantyBadge` sits beside `AttachmentBadge` with the same density rules; the phone card shows it too.
- `TransactionWarrantiesLine` fetches `GET /warranties?transactionId=` only when `transaction.warrantyCount > 0`, lists name and expiry with a link to the detail, and offers Add warranty.
- Acceptance: tests for the three entry points; every other `TransactionList` consumer renders without the prop; `register-columns.guard.test.ts` green.
- Neutral: with no warranties the register renders exactly as before.

### F4 -- Dashboard widget

**Files:** `frontend/src/components/dashboard/WarrantiesExpiringWidget.tsx` + `.test.tsx` (new), `frontend/src/components/dashboard/widget-registry.tsx` + `.test.tsx`, `frontend/src/components/dashboard/widget-meta.tsx`, `frontend/src/i18n/messages/en/dashboard.json`.

- Self-fetching (`InsightsWidget.tsx` pattern): `GET /warranties?status=expiring&limit=5&sort=expiresOn`; `defaultEnabled: false`; `titleHref="/warranties"`; rows print `name`, `daysLeft`, `expiresOn` from the response.
- Acceptance: `widget-registry.test.tsx` green; the widget renders the server's figures; empty state when nothing is expiring.

### F5 -- Notification copy

**Files:** `frontend/src/hooks/useNotificationCopy.ts` + tests, `frontend/src/i18n/messages/en/notifications.json`, `frontend/src/components/notifications/NotificationList.tsx` (the default-target switch), `frontend/src/lib/notification-target.contract.test.ts` (the `/warranties/<id>` route is now real).

### F6 -- Delegate section on the client

**Files:** `frontend/src/components/settings/DelegateAccessModal.tsx` + `.test.tsx`, `frontend/src/lib/delegation.ts`, `frontend/src/store/authStore.ts` only if `DelegateSectionSet` is typed there, `frontend/src/components/layout/AppHeader.tsx` + tests, `frontend/src/components/layout/MobileNavDrawer.tsx` + tests, the warranties layout under the app router wrapping `DelegateSectionGuard section="warranties"` (new), `frontend/src/app/section-layouts.test.tsx`, `frontend/src/components/dashboard/widget-registry.tsx` (`delegateVisible` and the section check on the warranties widget), `frontend/src/i18n/messages/en/settings.json`.

- `toolsSectionByHref` beside `toolsCapabilityByHref`: a Tools link passes for a delegate when either its capability or its section is granted.
- Acceptance: the modal shows and saves the toggle; the Tools link and the widget appear for a delegate only with the section; `section-layouts.test.tsx` green.
- Neutral: owners see no change.

### F7 -- CSV export and import

**Files:** `frontend/src/components/warranties/WarrantyCsvExport.ts` + `.test.ts`, `frontend/src/components/warranties/WarrantyImportDialog.tsx` + `.test.tsx` (new), `frontend/src/lib/warranties.ts` (`import(file, dryRun)`), the Warranties page (toolbar buttons), `frontend/src/i18n/messages/en/warranties.json`.

- Export: the Warracker column order of design decision 12 through `csv-export.ts` (`CsvSection` with headers), over the loaded list with the current filter; serial numbers comma-joined, JSON-encoded when one holds a comma; `IsLifetime` as `true` / `false`.
- Import: a file picker, a dry-run call, a preview table of per-row outcomes with the errors and skipped columns, then commit; the toast names the count created.
- Acceptance: export round-trips through the importer's fixture; the dialog tests for a valid, an invalid and a mixed file.

### A1 -- AI tools

**Files:** `backend/src/mcp/tools/warranties.tool.ts` + `.spec.ts` (new), `backend/src/mcp/tool-output-schemas.ts`, `backend/src/mcp/mcp.module.ts`, `backend/src/mcp/mcp-server.service.ts`, `backend/src/mcp/mcp-annotations.spec.ts` (`EXPECTED_TOOL_COUNT`), `backend/src/mcp/tools-list-budget.spec.ts`, `backend/src/ai/query/tool-definitions.ts` + `.spec.ts`, `backend/src/ai/query/tool-input-schemas.ts`, `backend/src/ai/query/tool-executor.service.ts` + `.spec.ts`, `backend/src/warranties/warranties.service.ts` (`getLlmWarranties`), `docs/backend/mcp.md` and `docs/backend/ai-and-payees.md` (one line each).

- Read-only annotations; `requireScope(user.scopes, "read")`; inputs `status?`, `q?`, `limit?`; the LLM shape carries `status`, `daysLeft`, `expiresOn`, `vendorName`, `linkedTransactionId`, `openClaimCount`, `documentCount`.

### Q1 -- Integration suite

**Files:** `backend/test/integration/warranties.integration.spec.ts` (new).

- The RLS bucket for both tables; the attachment CHECK refusals and a warranty document's absence from the register count; WTY-005 row counts; truth table C as a delegate; a backup export and restore that carries a warranty, its claim and its attachment bytes; the two-connection reminder test if B7 did not already place it here.

### Q2 -- E2E

**Files:** `e2e/tests/warranties.spec.ts`, `e2e/helpers/factories.ts` (`createWarranty`) (new and edited).

- Seed a transaction through the API; from its row open the action sheet and add a warranty; upload a receipt on the detail page; back on the register see the badge; on the Warranties page filter by status; archive; reload and re-assert.

### Q3 -- Localization pass

Every locale in `frontend/src/i18n/config.ts` and `backend/src/i18n/config.ts` for the `warranties`, `navigation`, `dashboard`, `settings`, `transactions`, `notifications` and backend keys. Final commit on the last PR.

### D1 -- Documentation

**Files:** the wiki repository's Warranties page (new), `README.md` (one feature line in the features list and the release table row for the version that ships it), `docs/system-invariants.md` (WTY-001..007 admitted with their mechanisms and an honest status), `docs/external-side-effects.md` (the attachment section's wording, if B2 left any), `docs/row-level-security-contract.md` only if it enumerates direct tables by then.
