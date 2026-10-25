# S10 CSV Import, Import Preview, Bank Sync, Transaction Rules

## 1. Metadata

| Field | Value |
| --- | --- |
| Session | S10 (parallel wave child, orchestrator session_018Nx7aian3f7dpRX5msjFBg) |
| Status | done |
| `AUDIT_BASELINE_SHA` | `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86` |
| `git rev-parse HEAD` | at start `48229feb7b8fc67de1b63eea8f259691b11cfe2f`; at the final commit, the commit carrying this file. Pin check (`git diff --stat <baseline> HEAD -- . ':!docs/audits/2026-10' ':!docs/audits/2026-08-upstream'`) empty. |
| Date | 2026-10-21 |
| Primary path | `backend/src/transaction-rules/` |
| Secondary paths | `backend/src/bank-sync/`, `backend/src/import-preview/`, the QIF/OFX/CSV path in `backend/src/import/` (`import.service.ts`, `import-regular-processor.service.ts`, `import-entity-creator.service.ts`, `import-post-processing.service.ts`, `import-context.ts`), `backend/src/payees/` (lookup, enrichment), `backend/src/accounts/accounts.service.ts` (`delete`, S07 hand-off), `backend/src/ai-review/ai-review-requests.service.ts` (S05 hand-off), `database/schema.sql` (transactions, ai_review_requests, bank_sync_*). |
| Hint line | `prioritize at-most-once import per bank transaction and per externalId under concurrency, rule application inside the inserting transaction on every creation path, preview equals commit for rules and imports, a rule never changing amount/account/date/status, the active-window check on unknown dates, bank credentials encrypted and never returned, provider failure multiplicity` |
| Runtime executed | Node 24.22.1 (`nvm use 24`), `npm ci` OK in `backend/`. PostgreSQL 16 in Docker (`mirror.gcr.io/library/postgres:16-alpine`; `dockerd` started by hand). Baseline integration `npm run test:integration -- "transaction-rules\|bank-sync\|transaction-external-id\|payee-lookup\|ofx-import-fitid\|import-balance-delta"`: **17 suites, 244 tests, all passed** in 223 s (`bank-sync`, `bank-sync-notifications`, `payee-lookup-quota`, `ofx-import-fitid`, `import-balance-delta`, `transaction-external-id`, and the eleven `transaction-rules*` suites: `-run`, `-structural`, `-apply`, `-fields`, `-transfer`, `-captures`, `-loan-fold`, `-import`, `-active-window`, `-retention`, plain). Slice unit suites at the baseline: 102 suites, 3205 tests, all passed. Scratch worktree at the baseline (`<scratchpad>/mut`): a planner probe and an integration probe for A26-S10-01, an integration probe for A26-S10-02, four mutations (section 6). Every integration run was serial (`--runInBand`), never in parallel with another. |

## 2. Invariant map

| ID | Statement | Mechanism named | Holds? |
| --- | --- | --- | --- |
| INV-BANKSYNC-001 (`partial`) | A provider transaction produces at most one row per Monize account, across every sync | Unique `uq_bank_sync_imported_transactions_key (account_id, external_key)` (schema.sql:2852, entity `@Unique`, so the synchronize-built harness has it: mutation M1 detected); `INSERT ... ON CONFLICT DO NOTHING RETURNING` before the transaction row in one `withScopedDb` (`bank-sync-writer.service.ts:355-370`); link row `FOR UPDATE` and `lockAccountsForBalanceWrite` (`:199-231`) | **No.** The index holds one row per key, but the key of one bank transaction is not stable: the `#<content hash>` discriminator for a repeated entry reference is decided per fetch (`bank-transaction-planner.ts:381-413`), so the earlier row is re-keyed and imported again, or a later reuse is silently dropped (A26-S10-01, executed). The index entry names only the `hash:`/`ref:` flip. |
| INV-BANKSYNC-002 | The provider private key never leaves the server | `EncryptionService.encrypt` (AES-256-GCM) on save (`bank-sync-credentials.service.ts:85-141`); the view has `privateKeySet: boolean` (`:227-232`); the only decrypt is `resolveCredentials` (`:205-207`), whose failure log names the user, not the key (`:210`); the four `bank_sync_*` tables are in `INTENTIONALLY_EXCLUDED_TABLES` (`backup/export-table-queries.ts:155-158`) | Yes (unit suite green; no logging of the PEM found). |
| INV-BANKSYNC-003 | A synced row is in the account's currency or not written | `classify` refuses `currency_mismatch` (`bank-transaction-planner.ts:256-258`); the writer derives the code through `assertTransactionCurrencyMatchesAccount` on the locked row and refuses a moved currency (`bank-sync-writer.service.ts:262-273`) | Yes (integration "writes nothing at all when the account's currency changed" green). |
| INV-BANKSYNC-004 | Nothing imports an unconfirmed bank account | `bankAccountNeedsPreview`; `linkAccount` clears `last_success_at`; the writer re-checks the link and cut-off under the lock (`:212-228`) | Yes; a re-link to the same account with the same cut-off during a cron fetch is not refused, but it imports the data the user already confirmed (section 8). |
| INV-API-001 (`partial`) | An API create with an `externalId` makes at most one row | Partial unique `idx_transactions_account_external_id`; `isExternalIdConflict`; on import, `loadHeldExternalIds` plus the row savepoint and `isExternalIdConflict` (`import.service.ts:1356-1362, 1436-1450`) | As recorded. Only OFX rows carry a key (`ofxExternalId`, `import-regular-processor.service.ts:42`); a CSV or QIF file carries none, so re-importing the same CSV duplicates every row (product decision, `docs/future-plans/csv-source-profiles.md` P2, not built). The two key-losing paths the index names are still the only ones found. |
| INV-RULE-001 (`partial`) | A rule never changes the matched row's amount, account, date or status | Closed action union; `writeEffects` patch limited to category, payee, payee name, description (`transaction-rules-applier.service.ts:1045-1071`); structure only through `convertRowToTransfer` / `createSplits`; VOID refused in the planner (`rule-structure.ts:139`) and in the conversion (`convert-to-transfer.ts:90`) | Yes for the matched row. The recorded gaps (undo without recompute, closed-target race) are still the gaps. |
| INV-RULE-002 (`partial`) | A rule applies inside the inserting transaction, on every creation path | The applier takes the caller's `EntityManager`; guard `rule-application-sites.guard.spec.ts` (APPLYING_SITES: transactions service, transfer service, regular import processor, MNY, bank-sync writer) | Yes on every creation path found: REST, joint, scheduled posting (`scheduled-transactions.service.ts:3698` through `TransactionsService.create`), AI (`ai-actions.service.ts:641, 944, 1232`), MCP, bulk, QIF/OFX/CSV (`import-regular-processor.service.ts:156-158`, inside the row savepoint), MNY, bank sync (`bank-sync-writer.service.ts:428-448`, same transaction). Email receipts create no transaction. Guard blind spot: `m.save(Transaction, {...})` is not one of its patterns (no current site; section 9). Mutation M4 detected. |
| INV-RULE-003 (`partial`) | Preview, draft test and commit are one planner; a run commits only the previewed plan | `planRuleEffects` behind `planForRow`/`planResolved`/`planWithChains`; run commit re-plans under `FOR SHARE` on the rule and row locks, `planFingerprint` (`transaction-rules-run.service.ts:271-319, 678`) | Yes for the manual run. The bank-sync preview plans each row alone (`bank-sync-preview.service.ts:381`) and shows no structural or settlement effect, and its confirm fingerprint covers the bank rows only (`bank-sync-plan-fingerprint.ts`), so it is a different contract (section 9). |
| INV-RULE-004 (`partial`) | A rule is evaluated only for a row dated inside its window; unknown date is outside | `isOutsideActiveWindow` before the condition (`rule-effects.ts:658-669, 750-753`); `rule-facts.ts:61-63, 129` turns anything that is not a `YYYY-MM-DD` string into `null` | Yes (mutation M3 detected by three unit cases). |
| INV-RULE-005 | A settling pass folds chronologically | `chronological` in `applyToNew` (`transaction-rules-applier.service.ts:272-285`); `orderByDateStable` in QIF/CSV (`import.service.ts:1421-1424`) and in the bank-sync writer (`bank-sync-writer.service.ts:428-431`) | Yes on the commit paths read. |
| INV-PAYEE-001 | A contact lookup never overwrites the user's value | `COALESCE(column, $n)` in one statement (`payees/lookup/payee-contact-enrichment.service.ts:42-55`) | Yes (static). |
| INV-PAYEE-002 | The Google Places monthly cap is never exceeded | Conditional upsert in `PayeeLookupQuotaService.claim` | Yes (`payee-lookup-quota.integration.spec.ts` green). |
| INV-CURRENCY (MON-M27, MON-H11 QIF half) | A row's currency is its account's currency | Bank sync: as INV-BANKSYNC-003. QIF/OFX/CSV regular rows: `ctx.account.currencyCode` (`import-regular-processor.service.ts:120`); plain transfer leg: the target's currency (`:784`) | **No** for the QIF split-transfer leg (`:604`, A26-S10-02, executed). |
| INV-BALANCE-001 / CONC (import) | An absolute balance write is made under the account lock from a current read | Post-processing recompute under `lockAccountsForBalanceWrite` (`import-post-processing.service.ts:68-101`) | The import's own `applyOpeningBalance` is an absolute write from a snapshot read in another transaction, unlocked, at 2 dp (A26-S10-05); healed by the recompute unless it fails. |
| (check and write in one transaction) | A refused command has not already written; the check runs with the write | AGENTS.md "Transactions (CRITICAL)" | **No** in `AccountsService.delete` (count and remove in separate transactions, no lock): a concurrent bank sync or import is cascaded away and leaves legs in other accounts (A26-S10-03). |
| (receipt review dedupe) | A receipt review is blocked only by another open receipt review of the same transaction | `NOT EXISTS ... rule_id IS NULL` (`ai-review-requests.service.ts:300-308`; `email-receipts/pipeline/receipt-candidates.ts:115`) | **No**: a rule's open review whose rule was deleted becomes `rule_id NULL` (`schema.sql:914`, `ON DELETE SET NULL`) and blocks the receipt (A26-S10-04). |

Material flows:

- **Bank sync:** provider rows -> `explainBankImport` (classification, key) -> preview (`bank-sync-preview.service.ts`, same plan) -> writer: link lock -> account lock -> fingerprint/selection check -> ledger claim (`ON CONFLICT`) -> payee (`ON CONFLICT (user_id, name)`) -> transaction insert -> operation tags -> import rules (`applyToNew`, same manager) -> `recalculateCurrentBalance` -> outcome -> commit -> `triggerDebouncedRecalc` and `repriceSettledLoanTemplates` after the commit.
- **QIF/OFX/CSV:** parsed rows -> account read (own transaction) -> one `withScopedDb` -> categories/accounts/securities/tags -> opening balance -> per row `SAVEPOINT` -> processor (row, splits, transfer legs, balance deltas, rules) -> commit -> post-processing recompute (own transaction, locked) -> net worth.
- **Rules:** rule row -> `loadRulesFor` (invalid dropped) -> `planRuleEffects` -> `writeEffects` (patch, tags, structure, claim, trace) in the caller's manager -> `affectedAccountIds` -> caller dispatches after commit.

## 3. Lens ledger

| Lens | Ran? |
| --- | --- |
| Pin the revision | ran (pin check empty; target is a path, `PR_REVIEW_SHA` = baseline) |
| Instructions before implementation | ran (AGENTS.md, CLAUDE.md, backend/CLAUDE.md, database/CLAUDE.md, the INV entries of section 2, `docs/specs/bank-sync.md` sections 6-7a, `docs/future-plans/csv-source-profiles.md` sections 1-4) |
| Summaries as hypotheses | ran (the S02/S05/S07/S09 hand-offs re-derived from code; A26-S02-09 executed) |
| Invariant model first | ran (section 2) |
| Change surface | ran: every insert into `transactions` (guard patterns plus a grep for `save(Transaction`), every `ensureSystemCurrency` caller, every `applyToNew` caller, every reader of `rule_id IS NULL` |
| Cross-layer | ran for the backend paths; the frontend rules editor and import-preview components were not read (not in this budget; section 12 hands them to S19) |
| Representation boundary | ran: unknown date (non-string, invalid) -> `null` -> outside the window; bank amount `-0` -> `0`; bank `null` balance means "not reported"; opening balance 2 dp vs the 4 dp column (A26-S10-05) |
| Browser/UI round trip | not applicable to the backend paths audited here because no form value of these paths was traced; the rules editor round trip is S19's (handed on) |
| Server-authoritative metadata | ran: currency from the account (bank sync, import rows); `AccountMappingDto.currencyCode` and `SecurityMappingDto.currencyCode` are `@MaxLength(3)` only, but the `currencies` FK refuses an unknown code, so no currency is created (A26-S09-06 shape absent here; a code another user created is handed to S13) |
| Identity versus value | ran: bank transaction identity (`ref:`/`hash:` keys, A26-S10-01); QIF transfer matching by `(account, date, amount)` signature (`import-regular-processor.service.ts:518-536`) noted, not new |
| State machine | ran: bank account link states (needs preview, linked, failed, expired) at the writer's re-checks; AI review request open states vs rule deletion (A26-S10-04) |
| Concurrency and idempotency | ran: two concurrent syncs (suite green, ledger arbitration); import `isExternalIdConflict`; account delete vs sync (A26-S10-03); payee `ON CONFLICT` |
| Partial failure | ran: post-commit recompute and reprice after the bank-sync commit; post-processing recompute failure leaves the opening-balance write (A26-S10-05) |
| External provider lookup | ran: one fetch per sync under a lease; a balance failure is logged and leaves the stored balance; a provider failure is recorded once per account per sync (`underLease`, `bank-sync.service.ts:529-590`); the payee quota claim is one conditional statement. No N-fold amplification found |
| Database and migration | ran at the constraint level (ledger unique key in schema, entity; transactions FK `ON DELETE CASCADE`; ai_review_requests `rule_id ON DELETE SET NULL`); no migration in this slice changed |
| Backup/restore | ran at the boundary only: the bank-sync ledger is excluded from the backup (documented BS11), so a restore re-opens re-import (section 9) |
| Financial | ran with numbers (A26-S10-01, -02, -03, -05) |
| Authorization/RLS | ran: every writer query carries `user_id`; the suites run under the enforced harness (`bank-sync.integration.spec.ts` "is enforcing row-level security") |
| Tests are evidence | ran (sections 6 and 10) |
| Mutation | ran (section 6) |
| Counterexample | ran (section 7) |
| Interaction | ran (section 7) |
| Rejected hypotheses | ran (section 8) |
| Adversarial approval challenge | ran (section 13) |

## 4. Confirmed findings

### A26-S10-01 - A bank transaction whose entry reference the bank repeats on a later day is imported twice, or a later one is silently dropped (INV-BANKSYNC-001)

1. **Severity:** HIGH
2. **Confidence:** high for the mechanism (executed); medium for frequency (it needs a bank that repeats `entry_reference`, which the spec and the code both say happens: Enable Banking FAQ, `bank-transaction-planner.ts:363-366`, `docs/specs/bank-sync.md` section 6).
3. **Location:** `backend/src/bank-sync/bank-transaction-planner.ts:381-413` (`resolveEntryReferences`: `contested` decided from the rows of this fetch only), `:544-551` (`keyFor`); `backend/src/bank-sync/bank-sync-writer.service.ts:355-370` (the claim keyed on that key); window overlap `docs/specs/bank-sync.md` section 7 (`last_success_at - 7 days`).
4. **Violated invariant:** INV-BANKSYNC-001: one provider transaction produces at most one row, across every sync; and its converse, a provider transaction is not lost.
5. **Reproduction (executed):** sync 1 fetches one booked row, reference `dup-9`, 5.00 debit; it is keyed `ref:dup-9` and imported. Three days later the bank books a second transaction (7.00, another counterparty) under the same reference; sync 2's window re-reads the week, so the fetch holds both rows. Both are now "contested" and keyed `ref:dup-9#<sha of content>`; neither equals `ref:dup-9`.
6. **Observed:** scratch integration case on real PostgreSQL (enforced RLS harness of `bank-sync.integration.spec.ts`): sync 2 returns `imported: 2, skipped: 0`; the account holds 3 rows; balance `983` = 1000 - 5 - 5 - 7. The planner probe gives `first=ref:R-1`, `second=["ref:R-1#638be0ba...","ref:R-1#6e56756a..."]`. The other direction: when the reuse arrives after the first row has left the window, the new row is alone in its fetch, keyed `ref:<reference>`, hits the first row's ledger entry, and is counted as `skipped` ("already imported"): a real bank transaction is never imported and nothing says so.
7. **Expected:** sync 2 `imported: 1, skipped: 1`, balance 988; a reused reference far apart in time imports as a new row.
8. **Impact:** financial: a duplicate expense or income of the full amount (here 5.00, 0.5 percent of the balance; any amount in practice), silently, in the account and in every report; or a missing transaction. An import rule then acts on the duplicate (a `convert_to_transfer` duplicates the counterpart in a second account; a `settle_loan_installment` settles a second slot, section 7). Recovery needs the user to notice and delete the row; deletion keeps the ledger row, so the duplicate does not come back.
9. **Root cause:** the key of a row depends on what else is in the same fetch. The discriminator is right for "two rows in one fetch", but the ledger keys earlier rows by the bare reference, and nothing relates the two forms across fetches.
10. **Recommended correction:** make a row's key a function of the row (and the ledger), never of its neighbours in the fetch: record the content signature with the ledger row and, when claiming a reference, compare against what the ledger already holds for that reference. A reference already held with the same signature is that row (skip); a reference held with another signature is a reuse (key the new row with its discriminator). Rows of the same reference within one fetch keep today's rule.
11. **Suggested remediation diff: incomplete** (illustrative, not applied). Supported part, against the baseline:

```diff
--- a/database/migrations/<UTC>_bank_sync_ledger_content_signature.sql
+++ b/database/migrations/<UTC>_bank_sync_ledger_content_signature.sql
+-- The content signature of the bank row a ledger entry claimed, so a repeated
+-- entry reference can be told apart from the row that first carried it.
+ALTER TABLE bank_sync_imported_transactions
+  ADD COLUMN IF NOT EXISTS content_signature VARCHAR(64);
--- a/backend/src/bank-sync/bank-transaction-planner.ts
+++ b/backend/src/bank-sync/bank-transaction-planner.ts
 export interface PlannedBankRow {
   externalKey: string;
+  /** `ref:<reference>` when the key is reference-based, else null. */
+  referenceKey: string | null;
+  /** SHA-256 of `contentSignature(row)`. */
+  contentSignature: string;
--- a/backend/src/bank-sync/bank-sync-writer.service.ts
+++ b/backend/src/bank-sync/bank-sync-writer.service.ts
       for (const row of plan.planned) {
         if (importKeys !== null && !importKeys.has(row.externalKey)) continue;
+        // A reference the ledger already holds for this very content is that
+        // row, whatever key the current fetch gives it (INV-BANKSYNC-001).
+        let key = row.externalKey;
+        if (row.referenceKey !== null) {
+          const held = returnedRows<{ content_signature: string | null }>(
+            await m.query(
+              `SELECT content_signature FROM bank_sync_imported_transactions
+                WHERE account_id = $1 AND external_key = $2`,
+              [accountId, row.referenceKey],
+            ),
+          );
+          if (held.length > 0) {
+            if (held[0].content_signature === row.contentSignature) {
+              skipped += 1;
+              continue;
+            }
+            key = `${row.referenceKey}#${row.contentSignature}`;
+          }
+        }
         const claimed = returnedRows<{ id: string }>(
           await m.query(
             `INSERT INTO bank_sync_imported_transactions
-               (user_id, account_id, external_key, booking_date)
-             VALUES ($1, $2, $3, $4)
+               (user_id, account_id, external_key, booking_date, content_signature)
+             VALUES ($1, $2, $3, $4, $5)
              ON CONFLICT (account_id, external_key) DO NOTHING
              RETURNING id`,
-            [userId, accountId, row.externalKey, row.transactionDate],
+            [userId, accountId, key, row.transactionDate, row.contentSignature],
           ),
         );
```

   Missing: the legacy ledger rows have `content_signature` NULL (a NULL held row must be treated as "same row" to stay safe against duplicates, which keeps the silent-loss direction for those rows until a backfill exists, and no backfill is possible without the bank's content); `schema.sql` and the entity must carry the column; the preview's `findLedgerKeys`/`newPlannedRows` and `planFingerprint` must apply the same rule, or the preview and the commit disagree; the exception path (`excluded_at`) needs the same comparison. Decision for the maintainer: whether the signature is the full `contentSignature` (dates included, so a bank that rewrites a booked row's value date re-keys it) or a narrower one (amount, currency, direction, booking date).
12. **Recommended regression test:** two syncs on real PostgreSQL: a lone reference, then the same row beside a second row under that reference; and the reverse, a reuse outside the window.
13. **Suggested regression-test diff (illustrative, not applied)**

```diff
--- a/backend/test/integration/bank-sync.integration.spec.ts
+++ b/backend/test/integration/bank-sync.integration.spec.ts
@@ describe("a second sync of the same rows (INV-BANKSYNC-001)", () => {
+    it("does not re-import a row when a later fetch repeats its entry reference", async () => {
+      const a = row({ entryReference: "dup-9", amount: "5.00" });
+      bankReturns([a]);
+      await sync();
+      const later = row({
+        entryReference: "dup-9",
+        amount: "7.00",
+        counterpartyName: "Kiosk",
+        bookingDate: daysAgo(1),
+      });
+      bankReturns([a, later]);
+      expect(await sync()).toMatchObject({ imported: 1, skipped: 1 });
+      expect(await count("transactions")).toBe(2);
+      expect(await storedBalance()).toBe(OPENING - 12);
+    });
+
+    it("imports a later transaction that reuses a reference no longer in the window", async () => {
+      bankReturns([row({ entryReference: "dup-8", amount: "5.00" })]);
+      await sync();
+      bankReturns([
+        row({ entryReference: "dup-8", amount: "7.00", counterpartyName: "Kiosk" }),
+      ]);
+      expect(await sync()).toMatchObject({ imported: 1, skipped: 0 });
+      expect(await storedBalance()).toBe(OPENING - 12);
+    });
```

   The first case fails at the baseline (`imported: 2`, executed); the second fails at the baseline by reading the code (the key is `ref:dup-8` in both fetches).
14. **Verification:** `npm run test:integration -- bank-sync`; `npm run test:unit -- bank-transaction-planner bank-sync-writer bank-sync-preview`; `scripts/verify-schema.sh` and `migration:lint` for the column.
15. **Residual risks:** the `hash:` form has its own documented flip (index Status); a bank that changes a booked row's content and reuses its reference at once defeats any signature.

Causality: `NEW_SINCE_UPSTREAM_AUDIT` (bank sync is new). Surfaces (Rule 7): the sync writer, the preview's duplicate column (`bank-sync-preview.service.ts`, `findLedgerKeys`), the exception ledger rows (`:328-343`). Execution evidence: `<scratchpad>/mut/backend/test/integration/bank-sync.integration.spec.ts` case "AUDIT-S10 probe" (failed as described), `<scratchpad>/mut/backend/src/bank-sync/audit-s10-key-probe.spec.ts`.

### A26-S10-02 - A QIF split-transfer leg into another account is written in the source account's currency and amount (MON-H11 QIF half; A26-S02-09 confirmed)

1. **Severity:** MEDIUM
2. **Confidence:** high (executed)
3. **Location:** `backend/src/import/import-regular-processor.service.ts:589-623` (`currencyCode: ctx.account.currencyCode` at `:604`, `amount: linkedAmount` = `-split.amount` at `:508`); the pending-placeholder branch `:548-587` writes the same unconverted amount; compare the plain transfer `:720-790`, which uses the target's currency and the `PENDING IMPORT` note.
4. **Violated invariant:** a row's currency is derived from the account that holds it (MON-M27, `assertTransactionCurrencyMatchesAccount`); a cross-currency transfer resolves its rate or is flagged (MON-H11).
5. **Reproduction (executed):** USD checking (1000), CAD savings (0). Import into checking: `D01/15/2025 T-100.00 PShop SGroceries $-40.00 S[Savings CAD] $-60.00`, mapping `Savings CAD` to the CAD account.
6. **Observed:** the CAD-account row is `{amount: 60.0000, currency_code: USD}`, no note; the CAD balance is `60.0000`.
7. **Expected:** a CAD row (at 1.35 CAD per USD, 81.00 CAD) or the plain path's flagged placeholder in CAD.
8. **Impact:** the CAD account's balance is off by 21.00 CAD (26 percent) per such split at that rate, with no flag to correct it; the row is labelled USD in a CAD account, in every report, export and backup.
9. **Root cause:** the split path was not given the plain path's target-account lookup and cross-currency branch.
10. **Recommended correction:** load the target account; same currency: as today in the target's code; different currency: the plain path's placeholder (target code, `PENDING IMPORT` note) so the other account's file corrects it, never a silent 1:1 row.
11. **Suggested remediation diff (illustrative, not applied)**

```diff
--- a/backend/src/import/import-regular-processor.service.ts
+++ b/backend/src/import/import-regular-processor.service.ts
@@ private async processSplitTransfer(
     ctx.affectedAccountIds.add(splitTransferAccountId);
     const linkedAmount = -split.amount;
+    const targetAccount = await ctx.manager.findOne(Account, {
+      where: { id: splitTransferAccountId, userId: ctx.userId },
+    });
+    const isCrossCurrency =
+      targetAccount !== null &&
+      targetAccount.currencyCode !== ctx.account.currencyCode;
@@
     const linkedSplitTx = ctx.manager.create(Transaction, {
@@
-      description: split.memo || qifTx.memo,
+      description: isCrossCurrency
+        ? `${split.memo || qifTx.memo || ""} ${PENDING_IMPORT_NOTE}`.trim()
+        : split.memo || qifTx.memo,
       status,
-      currencyCode: ctx.account.currencyCode,
+      currencyCode: targetAccount?.currencyCode ?? ctx.account.currencyCode,
```

   with `PENDING_IMPORT_NOTE` hoisted from `processTransfer` to a module constant, so both paths write the note `matchPendingTransfer` searches for.
12. **Recommended regression test:** the executed case, asserting the leg's currency is CAD and the row carries the pending note.
13. **Suggested regression-test diff (illustrative, not applied):** add to `backend/test/integration/transaction-rules-import.integration.spec.ts` (or a new `import-qif-split-transfer.integration.spec.ts`) the probe of `<scratchpad>/mut/backend/test/integration/audit-s10-qif-split.integration.spec.ts`, with `expect(cadLeg.currency_code).toBe("CAD")` and `expect(cadLeg.description).toContain("PENDING IMPORT")`.
14. **Verification:** `npm run test:integration -- import`; `npm run test:unit -- import-regular-processor`.
15. **Residual risks:** the placeholder is still an unconverted amount in the target account until the other file is imported (the plain path's documented behaviour); `matchPendingTransfer` updates a pending leg's amount without a VOID or reconciled check (section 9).

Causality: `PRIOR_REPORTED` (MON-H11, `CONFIRMED`, QIF half), first located by S02 as A26-S02-09; this finding supersedes A26-S02-09. OFX and CSV rows carry no splits on this path (only QIF has `S` lines), so the split shape is QIF-only; the plain transfer path of all three is the flagged-placeholder design.

### A26-S10-03 - Deleting an account checks "no transactions" in one transaction and deletes in another: a concurrent bank sync or import is cascaded away and its legs in other accounts are orphaned

1. **Severity:** MEDIUM
2. **Confidence:** medium (static; the window is short)
3. **Location:** `backend/src/accounts/accounts.service.ts:1868-1947` (counts at `:1872-1876` and `:1889-1897` each in their own `withScopedDb`, removal at `:1935-1947`, no account lock); `database/schema.sql:358` (`transactions.account_id ... ON DELETE CASCADE`), `:378` (`linked_transaction_id ... ON DELETE SET NULL`); writers `bank-sync-writer.service.ts:231`, `import-regular-processor.service.ts:590-623, 775-796`, `convert-to-transfer.ts`.
4. **Violated invariant:** AGENTS.md "A rejected command must not already have written: every check that can refuse a request runs inside the same transaction as the mutation, under the same lock where concurrency matters"; INV-TRANSFER-001 (a transfer's legs exist together).
5. **Reproduction:** an empty linked checking account A; the daily bank-sync cron writes 20 rows into A, and an import rule converts "Savings" rows into transfers to account S (the counterpart moves S's balance). The user deletes A: the count runs before the sync commits (0), the sync commits, then `m.remove(account)` cascades A's 20 rows.
6. **Observed (by reading):** A and its rows are gone; S keeps the counterpart legs with `linked_transaction_id` NULL and their balance contribution, as one-legged "transfers" from an account that no longer exists. The writer's `FOR UPDATE` on A only makes the delete wait until the sync commits, then it proceeds.
7. **Expected:** the delete is refused with "Close the account instead", because the account has transactions when it is deleted.
8. **Impact:** money appears in S with no source (for a 300.00 transfer, S overstates by 300.00); the deleted rows are not in the action-history snapshot (`beforeData` is the account only), so undo cannot bring them back. The same shape applies to a QIF import's transfer legs.
9. **Root cause:** the guard and the delete are separate transactions, and the account row is not locked before the count.
10. **Recommended correction:** one `withScopedDb`: lock the account (`lockAccountsForBalanceWrite`, which every writer of its balance also takes), count both tables, then unlink and remove.
11. **Suggested remediation diff (illustrative, not applied)**

```diff
--- a/backend/src/accounts/accounts.service.ts
+++ b/backend/src/accounts/accounts.service.ts
@@ async delete(userId: string, id: string): Promise<void> {
-    const transactionCount = await withScopedDb(this.dataSource, (m) =>
-      m.getRepository(Transaction).count({
-        where: { accountId: id },
-      }),
-    );
-    if (transactionCount > 0) { ...throw }
-    const investmentTransactionCount = await withScopedDb(...)
-    if (investmentTransactionCount > 0) { ...throw }
+    // Refuse and delete under the account's write lock: a writer that moves its
+    // balance takes the same lock, so no row can land between the count and the
+    // removal (and the cascade).
+    const assertEmpty = async (m: EntityManager): Promise<void> => {
+      await lockAccountsForBalanceWrite(m, [id], userId);
+      const transactionCount = await m
+        .getRepository(Transaction)
+        .count({ where: { accountId: id } });
+      if (transactionCount > 0) { ...throw as today }
+      const investmentTransactionCount = await m
+        .getRepository(InvestmentTransaction)
+        .count({ where: { accountId: id } });
+      if (investmentTransactionCount > 0) { ...throw as today }
+    };
+    await withScopedDb(this.dataSource, assertEmpty); // early answer, as today
@@
     await withScopedDb(this.dataSource, async (m) => {
+      await assertEmpty(m);
       if (account.linkedAccountId) {
```

   The early check keeps today's behaviour of refusing before the loan schedule is removed; the in-transaction check is the one that holds.
12. **Recommended regression test:** two connections: connection 1 holds A's row lock and inserts a row (as the writer does), connection 2 calls `delete`; release; expect `BadRequestException` and the row present.
13. **Suggested regression-test diff (illustrative, not applied):** a new case in `backend/test/integration/accounts-*.integration.spec.ts` with a barrier on `lockAccountsForBalanceWrite`, asserting `count(transactions where account_id = A) = 1` after both finish.
14. **Verification:** the two-connection test; `npm run test:unit -- accounts.service`.
15. **Residual risks:** the loan-schedule removal before the delete stays outside the transaction (existing best-effort design).

Causality: `PRE_EXISTING_UNREPORTED` (S07 hand-off; the bank-sync writer and rule conversions make the cross-account leg reachable). Not executed: MEDIUM (plan step 7 requires execution for HIGH and BLOCKER only); the FK actions and the transaction boundaries are read directly from `schema.sql` and the method.

### A26-S10-04 - Deleting a rule leaves its open AI review requests rule-less, and they then block the email-receipt review of the same transaction

1. **Severity:** LOW
2. **Confidence:** high (static; the SQL is explicit)
3. **Location:** `database/schema.sql:914` (`rule_id ... ON DELETE SET NULL`); `backend/src/transaction-rules/transaction-rules.service.ts:189-222` (`remove` does not close the rule's open requests); `backend/src/ai-review/ai-review-requests.service.ts:300-308` (`NOT EXISTS ... rule_id IS NULL AND status IN open`, no `kind`); `backend/src/email-receipts/pipeline/receipt-candidates.ts:115` (same predicate when choosing candidate transactions).
4. **Violated invariant:** a receipt review is refused only by another open receipt review of that transaction (`ai-review-requests.service.ts:239`, "never a second one").
5. **Reproduction:** rule R (`request_ai_review`) queues a `transaction_review` on T (`rule_id = R`, pending, 30-day expiry). The user deletes R; the request becomes `rule_id NULL`, still pending. A receipt email for T arrives.
6. **Observed:** the insert's `NOT EXISTS` sees the orphaned request as an open receipt review; the receipt ends `review_conflict` (or T is dropped from the candidates), for up to 30 days; the orphaned request is still offered to the AI reviewer although its rule is gone.
7. **Expected:** the receipt is queued; a deleted rule's open requests are expired with it.
8. **Impact:** a receipt is not attached automatically; the user resolves a conflict that has no visible cause.
9. **Root cause:** `rule_id IS NULL` is used as "receipt request", which stopped being true when `ON DELETE SET NULL` was chosen.
10. **Recommended correction:** expire the rule's open requests in `remove`, and key the dedupe on `kind`.
11. **Suggested remediation diff (illustrative, not applied)**

```diff
--- a/backend/src/transaction-rules/transaction-rules.service.ts
+++ b/backend/src/transaction-rules/transaction-rules.service.ts
@@ async remove(
+      // Its open review requests go with it; left behind they would read as
+      // rule-less (ON DELETE SET NULL) receipt reviews.
+      await m.query(
+        `UPDATE ai_review_requests
+            SET status = 'expired', updated_at = CURRENT_TIMESTAMP
+          WHERE user_id = $1 AND rule_id = $2
+            AND status IN ('pending', 'claimed', 'proposed')`,
+        [userId, id],
+      );
       const result = await m
         .getRepository(TransactionRule)
         .delete({ id, userId });
--- a/backend/src/ai-review/ai-review-requests.service.ts
+++ b/backend/src/ai-review/ai-review-requests.service.ts
                    WHERE open_request.user_id = $1::uuid
                      AND open_request.transaction_id = $2::uuid
-                     AND open_request.rule_id IS NULL
+                     AND open_request.kind = 'email_receipt'
```

   and the same `kind` predicate in `receipt-candidates.ts:115`.
12. **Recommended regression test:** integration: queue a rule review, delete the rule, enqueue a receipt review for the same transaction, expect a row.
13. **Suggested regression-test diff:** a case in `backend/test/integration/transaction-rules.integration.spec.ts` asserting the request's status is `expired` after `rules.remove` and that `enqueueForReceipt` returns a request.
14. **Verification:** `npm run test:integration -- "transaction-rules|email-receipt"`.
15. **Residual risks:** a request already rule-less in a deployed database needs the same `UPDATE` once (a data migration, not shown).

Causality: `NEW_SINCE_UPSTREAM_AUDIT` (AI review requests and receipts are new). Shared with S11 (receipt surface).

### A26-S10-05 - The QIF/CSV opening balance is an absolute, unlocked balance write from a snapshot read in another transaction, rounded to 2 dp

1. **Severity:** LOW
2. **Confidence:** medium (static)
3. **Location:** `backend/src/import/import-entity-creator.service.ts:379-398`; callers `backend/src/import/import.service.ts:1251-1255` (the account read in its own `withScopedDb`), `:1407-1414`; multi-account `:404-406, 464-471` (read in the transaction, not locked).
4. **Violated invariant:** INV-BALANCE-001 / MON-H07 (an absolute balance write under the account lock from a current read); "Money is `decimal(20,4)`".
5. **Reproduction:** account with opening 0 and current 500. The import reads it; a transaction of -100 commits (current 400); the import writes `current = 500 - 0 + 1000 = 1500` instead of 1400. A file opening balance of `100.1234` is stored as `100.12`.
6. **Observed:** `current_balance` is wrong by the concurrent delta until the post-processing recompute (`import-post-processing.service.ts:68-101`, locked) rewrites it after the commit; if that recompute fails (logged as an error), it stays wrong. `opening_balance` keeps the 2 dp value permanently, and the recompute adds it, so the balance is off by up to 0.0049.
7. **Expected:** the opening balance written at 4 dp, and `current_balance` moved by `newOpening - oldOpening` as an atomic delta (or left to the recompute) under the account lock.
8. **Impact:** narrow: a transient wrong balance and a sub-cent persistent difference for files with 4 dp opening balances.
9. **Root cause:** a pre-delta-era absolute write kept in the import path.
10. **Recommended correction:** write `opening_balance` with `roundMoney`, and the current balance as an atomic delta of the opening change.
11. **Suggested remediation diff (illustrative, not applied)**

```diff
--- a/backend/src/import/import-entity-creator.service.ts
+++ b/backend/src/import/import-entity-creator.service.ts
   async applyOpeningBalance(
     manager: EntityManager,
     accountId: string,
-    account: Account,
+    userId: string,
     openingBalance: number,
   ): Promise<void> {
-    const existingOpeningBalance = Number(account.openingBalance) || 0;
-    const existingCurrentBalance = Number(account.currentBalance) || 0;
-    const newOpeningBalance = Math.round(openingBalance * 100) / 100;
-    const newCurrentBalance = ...
-    await manager.update(Account, accountId, {
-      openingBalance: newOpeningBalance,
-      currentBalance: newCurrentBalance,
-    });
+    await lockAccountsForBalanceWrite(manager, [accountId], userId);
+    const [row] = await manager.query(
+      `SELECT opening_balance FROM accounts WHERE id = $1`,
+      [accountId],
+    );
+    const newOpening = roundMoney(openingBalance);
+    const delta = roundMoney(newOpening - Number(row?.opening_balance ?? 0));
+    await manager.query(
+      `UPDATE accounts SET opening_balance = $2,
+              current_balance = current_balance + $3
+        WHERE id = $1`,
+      [accountId, newOpening, delta],
+    );
   }
```

   The lock must stay after `lockImportedHoldingScopes` (advisory first, `import.service.ts:1336-1337`).
12. **Recommended regression test:** `import-balance-delta.integration.spec.ts`: an opening balance of `100.1234` and a concurrent delta on a second connection; expect opening `100.1234` and current equal to the ledger.
13. **Suggested regression-test diff:** omitted (LOW); the case above in that suite's style.
14. **Verification:** `npm run test:integration -- import-balance-delta`.
15. **Residual risks:** none beyond the post-processing step's own failure path.

Causality: `PRE_EXISTING_UNREPORTED` (S02 hand-off `applyOpeningBalance`; MON-H07 itself is FIXED_VERIFIED by S07 for the recompute paths).

## 5. Prior-finding dispositions

S10 owns no `MON-*` finding. Cross-checks and hand-offs disposed:

| ID | Disposition | Evidence |
| --- | --- | --- |
| MON-H11 (QIF half) | STILL_OPEN -> A26-S10-02 (supersedes A26-S02-09) | Executed probe: CAD leg `USD 60.0000`, CAD balance 60.0000. The plain QIF/OFX/CSV transfer path writes the target's currency with the `PENDING IMPORT` placeholder (documented design). |
| MON-M27 (import and bank-sync creation, cross-check) | FIXED_VERIFIED on these paths except the QIF split leg (MON-H11's QIF half above) | Bank sync: `assertTransactionCurrencyMatchesAccount` on the locked account (`bank-sync-writer.service.ts:262-273`), integration green. QIF/OFX/CSV regular rows: `ctx.account.currencyCode` (`import-regular-processor.service.ts:120`); plain transfer leg: target's code (`:784`). |
| A26-S02-09 | superseded by A26-S10-02 | -- |
| S02 `applyOpeningBalance` hypothesis | CONFIRMED (narrow) -> A26-S10-05 | section 4 |
| S05 rule deletion nulls `rule_id` on open reviews | CONFIRMED -> A26-S10-04 | section 4 |
| S07 account delete vs concurrent import/bank-sync | CONFIRMED (static) -> A26-S10-03 | section 4 |
| S09 INV-IMPORT-003 QIF half | CONFIRMED, no new finding (Rule 7: A26-S09-05 already names QIF) | `import.service.ts:641-686` (`findOrCreateCategoryDef`: `findOne`, then plain `save`, inside the import's one transaction and outside the row savepoints, so a unique violation aborts the file); `createCategoriesFromDefs`/`createCategoriesFromBlocks` call it. The CSV/single-file path uses `entityCreator.createCategories` (fixed, `ON CONFLICT DO NOTHING`). The top-level unique gap is as the index says. |
| S09 A26-S09-06 shape in the CSV and bank-sync writers | NOT PRESENT | Neither calls `ensureSystemCurrency` (callers: MNY, users, currencies, bonds only). The CSV/QIF `AccountMappingDto.currencyCode` / `SecurityMappingDto.currencyCode` (`import/dto/import.dto.ts:145-151, 205-212`) are `@MaxLength(3)` only, but the `currencies(code)` FK refuses a code that does not exist (the import fails with 400); a code that exists only as another user's custom currency is handed to S13. |

## 6. Mutation table

| Invariant | Mutation (file:line, what) | Test that fails | Verdict |
| --- | --- | --- | --- |
| INV-BANKSYNC-001 | M1 `entities/bank-sync-imported-transaction.entity.ts:25` remove `@Unique` (the synchronize-built harness then has no key) | 14 cases of `bank-sync.integration.spec.ts` ("no unique or exclusion constraint matching the ON CONFLICT specification") | covered |
| INV-BANKSYNC-001 | M2 `bank-transaction-planner.ts:409` discriminator always null (a repeated reference keyed alone) | 2 cases of `bank-transaction-planner.spec.ts` / `bank-sync-preview.service.spec.ts` | covered |
| INV-RULE-004 | M3 `rule-effects.ts:665` unknown date counted inside the window | 3 cases of `rule-effects.active-window.spec.ts` / `transaction-rules-run.active-window.spec.ts` | covered |
| INV-RULE-002 | M4 `import-regular-processor.service.ts:157` drop the `applyImportRules` call (the method's own `applyToNew` call stays, so the file-level guard alone would stay green) | 6 cases of `import-regular-processor*.spec.ts` | covered |
| INV-BANKSYNC-001 | M5 (the baseline itself) key of a row depends on its fetch neighbours | none: all 244 integration tests green with the defect; the probe fails | undetected (A26-S10-01) |
| MON-M27 / MON-H11 | M6 (the baseline itself) `import-regular-processor.service.ts:604` source currency on the target leg | none: the import suites green with the defect | undetected (A26-S10-02) |
| check-with-write | M7 (conceptual) `accounts.service.ts:1872` count outside the delete's transaction | no two-connection delete test exists | undetected (A26-S10-03) |
| receipt dedupe | M8 (conceptual) `ai-review-requests.service.ts:306` `rule_id IS NULL` vs `kind` | no test deletes a rule with an open request | undetected (A26-S10-04) |

M1 to M4 were executed in `<scratchpad>/mut` and reverted (`git status` clean apart from the probe files).

## 7. Counterexamples and the interaction scenario

| Invariant | Counterexample (not from the existing tests) | Result |
| --- | --- | --- |
| INV-BANKSYNC-001 | A reference first seen alone, then beside a reuse in the overlap week | double import (executed) |
| INV-BANKSYNC-001 | A reuse 10 days later, alone in its fetch | silent skip (by reading `keyFor`) |
| INV-BANKSYNC-003 | Provider currency `pln ` (lower case, trailing space) | accepted as PLN (`sameCurrency` trims and upper-cases); correct |
| INV-RULE-004 | `transactionDate` a `Date` object or `2026-02-30` | `rule-facts.ts` returns `null`, so the rule is outside its window; correct |
| INV-RULE-001 | Import rule `convert_to_transfer` on a CSV row whose status column says VOID | refused `row_is_void` (`rule-structure.ts:139`); correct |
| MON-H11 | QIF split leg into a CAD account | USD-labelled 1:1 leg (executed) |
| INV-API-001 | The same CSV imported twice | every row duplicated (no key on CSV rows; product decision, csv-source-profiles P2) |

**Interaction scenario (A26-S10-01 x INV-RULE-001/INV-LOAN-008):** a user has an import rule "payee contains `BANK MORTGAGE` -> `settle_loan_installment`". The bank repeats the mortgage debit's entry reference on the next day's card payment. The next sync re-keys the mortgage debit and imports it again; the rule, applied in the same transaction, settles the next occurrence slot with the duplicate: a second principal reduction on the loan, an interest expense, and an advanced schedule cursor, all from one real payment. Deleting the duplicate row afterwards reverses the leg balances but the claim and cursor advance are INV-LOAN-008's to undo (handed to S15). The same duplicate under a `convert_to_transfer` rule moves the target account a second time.

## 8. Rejected hypotheses

| Candidate | Evidence considered | Why rejected or downgraded | Final classification |
| --- | --- | --- | --- |
| Two concurrent syncs import a row twice | link `FOR UPDATE`, `ON CONFLICT` claim; integration "two syncs at once" (three variants) green | The ledger key arbitrates | REJECTED |
| A re-link to the same account with the same cut-off during a cron fetch imports an account that "needs preview" | writer re-checks `accountId` and `syncFromDate` only (`bank-sync-writer.service.ts:212-228`) | The rows are the ones the link already covered; a changed cut-off is refused | DESIGN_RISK (narrow), not a finding |
| The rules applier opens its own transaction somewhere | every read/write on the passed `m`; `resolveCreatedPayee` calls `PayeesService` (`withScopedDb` re-entrant, joins the ambient transaction) | Nested scoped calls join | REJECTED |
| `createSplits(new Date(row.transactionDate))` shifts a rule split's leg date in a negative time zone | `transaction-split.service.ts:124-132, 395-396, 482-483` use `toISOString()` of a UTC-midnight `Date` | Consistent UTC round trip | REJECTED |
| `balanceDiff = newAmount - oldAmount` unrounded in `matchPendingTransfer` | `updateAccountBalance` applies `roundMoney` (`import-context.ts:216`) | Rounded at the write | REJECTED |
| A VOID imported row moves the balance (`updateAccountBalance` at `import-regular-processor.service.ts:138` ignores status) | post-processing recompute uses `LEDGER_MOVEMENT_PREDICATE` under the lock | Transient only, healed after the commit like A26-S10-05; noted in section 9 | DESIGN_RISK |
| Bank-sync provider failure multiplies provider calls | one fetch per sync under the 30-minute lease; balance failure logged once; failure recorded once per account | No amplification model beyond one call per account per sync (Rule 6) | REJECTED |
| Private key leaks through `last_sync_error` | `describeSyncFailure` / bounded sanitized message (`bank-sync-errors.ts:150`); grep of `bank-sync/providers` for `privateKey` in a log, error, message or throw: none | Not reachable from the code read (the adapter itself was not read in full) | REJECTED |

## 9. Design risks

- **Bank-sync preview does not disclose structural rule effects.** `bank-sync-preview.service.ts:368-466` shows payee, category, tags and the matched rules; a `convert_to_transfer`, `split` or `settle_loan_installment` the commit will write (moving money in another account) is not shown, each row is planned alone without the pass's prior settlements (`planForRow`, `:381`), and the confirm fingerprint covers only the bank rows (`bank-sync-plan-fingerprint.ts`). Today's displayed fields agree with the commit; a person confirming the preview is not told what moves elsewhere. Handed to S19/S20 for the client side.
- **Rule-application guard patterns.** `rule-application-sites.guard.spec.ts:141-156` does not match `m.save(Transaction, {...})` or `m.insert(Transaction, ...)`-style calls through a variable not named by the held-repository scan; no such site exists today (grep empty).
- **Bank-sync ledger not in the backup** (`export-table-queries.ts:155-158`, documented BS11): after a restore the link and the ledger are gone; the default cut-off of the new link (day after the newest non-VOID row) is the only defence against a re-import.
- **Transient balances during a QIF/CSV import.** VOID rows (`:138`) and the opening balance (A26-S10-05) move `current_balance` inside the import transaction in ways only the post-commit recompute corrects; a recompute failure leaves them.
- **`matchPendingTransfer` / the split pending branch** update a pending leg's amount and the account balance with no VOID or reconciled-lock check, and select the placeholder by `description LIKE '%PENDING IMPORT%'`, a user-editable field (`import-regular-processor.service.ts:244-298, 548-587`).

## 10. Missing tests and known-wrong tests

- No test syncs a reference repeated across two fetches (A26-S10-01; M5).
- No import test covers a cross-currency split transfer (A26-S10-02; M6).
- No two-connection test for `AccountsService.delete` against a writer (A26-S10-03; M7).
- No test deletes a rule that has an open review request (A26-S10-04; M8).
- No test of a 4 dp QIF opening balance or of the opening balance under a concurrent delta (A26-S10-05).
- No known-wrong test found in the slice.

## 11. Documentation inconsistencies

- `docs/system-invariants.md` INV-BANKSYNC-001 Status names one key-instability path (`hash:` to `ref:`); the fetch-local discriminator is a second one (A26-S10-01), and the spec section 6 ("so none is lost and the key does not depend on the listing order") is true within one fetch only.
- INV-RULE-002 "Call sites" lists bank sync only through INV-RULE-005 and the guard; the call-site sentence omits `BankSyncWriterService` (the guard's APPLYING_SITES has it).
- `bank-sync-writer.service.ts:136-172` docblock sits above `CreatedOperation`, not the class it describes (cosmetic, not a finding).

## 12. Review ledger

- **Directories inspected:** `backend/src/transaction-rules/`, `backend/src/bank-sync/`, `backend/src/import-preview/`, `backend/src/import/` (non-MNY), `backend/src/payees/lookup/`, `backend/src/ai-review/` (one function), `backend/src/accounts/` (one function).
- **Files in full:** `bank-sync/bank-sync-writer.service.ts`; `import/import-regular-processor.service.ts` (1-330, 420-798; 330-420 is payee alias matching and target resolution, sampled); `transaction-rules/rule-application-sites.guard.spec.ts` (1-217).
- **Files sampled (ranges):** `bank-sync/bank-transaction-planner.ts:216-556`; `bank-sync/bank-sync.service.ts:440-660`; `bank-sync/bank-sync-preview.service.ts:300-495`; `bank-sync/bank-sync-credentials.service.ts` (grep of key handling); `transaction-rules/transaction-rules-applier.service.ts:184-345, 345-450, 590-910, 927-1258`; `transaction-rules/rule-effects.ts:650-780`; `transaction-rules/rule-facts.ts` (date); `transaction-rules/transaction-rules.service.ts:112-222`; `transaction-rules/transaction-rules-run.service.ts` (outline); `import/import.service.ts:295-480, 641-692, 1242-1504`; `import/import-entity-creator.service.ts:360-400`; `import/import-post-processing.service.ts:44-120`; `import/qif-status.util.ts`; `import/import-context.ts:211-220`; `accounts/accounts.service.ts:1868-1960`; `ai-review/ai-review-requests.service.ts:280-325`; `transactions/transaction-split.service.ts:355-420`; `payees/lookup/payee-contact-enrichment.service.ts:40-55`; `docs/specs/bank-sync.md:220-360`; `database/schema.sql:352-370, 910-975, 2798-2852`.
- **Not read:** the rule validator (`rule-validation.ts`, 810 lines), `rule-tool-prep.service.ts` (AI/MCP rule authoring, 1128 lines), `bank-sync-connections.service.ts` (authorization flow), `bank-sync-profiles.ts`, the Enable Banking adapter, `csv-parser.ts` and `qif-parser.ts` (parsers), the frontend `components/rules/` and `components/import-preview/`, `import-investment-processor.service.ts`, `import-transfer-dedupe.ts`.
- **Searches:** every insert into `transactions` outside the guard's patterns (`save(Transaction`, `.save(` with `transactionDate`); `ensureSystemCurrency|ensureCatalogCurrency`; `transactionsService.create|createTransfer|createBulk` across AI, MCP, scheduled, receipts, bonds, loans; `priorSettlements`; `rule_id IS NULL`; `VOID|status` in the rule planner and conversion; `bank_sync` in the backup.
- **Suites run:** integration baseline 17 suites / 244 passed (section 1); slice unit suites `src/transaction-rules`, `src/bank-sync`, `src/import-preview`, `src/import/*.spec` at the baseline (`TZ=UTC npm run test:unit -- src/transaction-rules src/bank-sync src/import-preview "src/import/[^/]*\.spec"`): 102 suites, 3205 tests, all passed; probes and mutations as sections 4 and 6.
- **Areas reviewed without a finding:** INV-BANKSYNC-002, -003, -004; INV-RULE-001 (matched row), -004, -005; INV-PAYEE-001, -002; concurrent sync arbitration; rules inside the inserting transaction on every creation path found.
- **Partial/unenforced invariants, status re-checked:** INV-BANKSYNC-001 (gap larger than recorded, A26-S10-01); INV-API-001 (gaps as recorded); INV-RULE-001..004 (gaps as recorded; INV-RULE-002 guard blind spot section 9); INV-IMPORT-003 (QIF still unenforced, A26-S09-05).

**Text for the ledger (orchestrator merges):**
- Session status: S10 done; commit: the commit carrying this file; findings B/H/M/L 0/1/2/2; verdict REQUEST CHANGES.
- Prior findings disposed: MON-H11 QIF half STILL_OPEN (A26-S10-02, supersedes A26-S02-09); MON-M27 import and bank-sync cross-check FIXED_VERIFIED except the QIF split leg. S10 owns no other `MON-*` row.
- Suites: integration 17 suites, 244 passed at the baseline; slice unit suites 102 suites, 3205 passed; A26-S10-01 and A26-S10-02 probes executed (both fail at the baseline as described).
- Undetected mutations: `INV-BANKSYNC-001 | bank-transaction-planner.ts:381-413 fetch-local reference discriminator (baseline) | a two-sync reference-reuse integration test | S10`; `MON-H11 | import-regular-processor.service.ts:604 source currency on the split leg (baseline) | a cross-currency QIF split integration test | S10`; `check-with-write | accounts.service.ts:1872 count outside the delete transaction | a two-connection delete-vs-writer test | S10`; `receipt dedupe | ai-review-requests.service.ts:306 rule_id IS NULL | a rule-delete-then-receipt test | S10`.
- Open hypotheses handed on:
  - from S10 to S11: A26-S10-04's receipt surface (`receipt-candidates.ts:115`) and whether an orphaned rule review is ever applied by the AI reviewer.
  - from S10 to S13: QIF/CSV `AccountMappingDto.currencyCode` (`@MaxLength(3)`) can name a code that exists only as another user's custom currency; the FK accepts it.
  - from S10 to S15: a duplicated bank row (A26-S10-01) settled by a `settle_loan_installment` import rule; what deleting the duplicate undoes of the claim and cursor (INV-LOAN-008).
  - from S10 to S19/S20: the bank-sync preview does not disclose structural rule effects (section 9); the rules editor and import-preview components were not read.
  - from S10 to S21: the four undetected rows above; A26-S10-03's missing two-connection test joins MON-M46.
- Deviations: `dockerd` started by hand; slice size L read by invariant, with the unread files listed above; report written by S10 only, ledger/sessions/register left to the orchestrator.

## 13. Adversarial approval challenge

Started from the slice's own abstractions, not from the findings: "the ledger key is the identity of a bank transaction", "the applier never opens a transaction", "the planner is pure and the only evaluator", "the preview is the same plan".

- **Ledger key as identity.** Searched every producer of `externalKey` (`keyFor`, the preview's `findLedgerKeys`, the exception claim). Found the cross-fetch instability (A26-S10-01) from the abstraction itself: a key computed from a set of rows cannot be the identity of one row.
- **Applier transaction.** Followed each collaborator the applier calls without `m` (`PayeesService.resolveByName`, `findOrCreate`, `AccountsService.updateBalance`, `TransactionSplitService.createSplits`): each is `withScopedDb`-based and joins the ambient transaction. Nothing found.
- **Single planner.** Searched for a second evaluator of conditions (`evaluateRuleCondition*` callers outside specs): `rule-effects.ts:683, 768` (the planner and the editor's Test match `ruleConditionMatches`, which shares `isOutsideActiveWindow`) and `rule-condition.explain.ts:176, 217-219` (the read-only explanation trace). Nothing writes from a second evaluator.
- **Preview equals commit.** Bank-sync preview: same plan for the bank rows; rule effects agree on the displayed fields; structural effects not displayed (section 9). QIF/CSV import has no server preview in this slice (`import-preview/` serves bank sync only); parse endpoints are not a preview of rule effects.
- **Representation.** Unknown date, `-0`, `null` balance, 4 dp amounts (`roundMoney` in the planner): correct; the 2 dp opening balance is the one exception (A26-S10-05).
- **Stale clients / mixed version.** A legacy ledger row (no signature) is exactly what makes the A26-S10-01 fix incomplete; recorded in its residual risks.
- **Failure multiplicity.** Provider, balance, credential-decrypt and lease failures each recorded once per sync; no loop re-hits the provider.

Result: no further BLOCKER or HIGH beyond A26-S10-01.

## 14. Verdict

**REQUEST CHANGES** for the slice: one HIGH (A26-S10-01, executed) survives the challenge; two MEDIUM (A26-S10-02 executed, A26-S10-03 static) and two LOW. The adversarial close-out pass was completed. Hosted CI was not consulted (read-only audit of the baseline).
