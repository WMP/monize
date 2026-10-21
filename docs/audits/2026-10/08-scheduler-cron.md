# S08 Scheduler, Cron Matrix, Job Claims, Loan Posting

## 1. Metadata

| Field | Value |
| --- | --- |
| Session | S08 (child session of orchestrator session_018Nx7aian3f7dpRX5msjFBg, parallel wave 2) |
| `AUDIT_BASELINE_SHA` | `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86` |
| `git rev-parse HEAD` | at start `308e087b944f4253b6c2fdcf8d369d3b9c72eb0e`; at the final commit, the commit carrying this file. Pin check (`git diff --stat <baseline> HEAD -- . ':!docs/audits/2026-10' ':!docs/audits/2026-08-upstream'`) returned empty. |
| Date | 2026-10-21 |
| Primary path | `backend/src/scheduled-transactions/` |
| Secondary paths | every `@Cron` handler (49 handlers in 46 files, not 40), `backend/src/common/jobs/` (`JobClaimService`, `FetchSyncService`), `notifications/bill-reminder.service.ts`, `accounts/mortgage-reminder.service.ts`, `loan-installments/claim-loan-occurrence.ts`, `occurrence-slots.ts`, `budgets/budget-period-cron.service.ts`, `ai/insights/ai-insights.service.ts`, `notifications/notification-dispatch.service.ts`, `frontend/src/components/scheduled-transactions/` (post and skip call sites, dialog pre-fill) |
| Hint line | `prioritize one logical effect per tick across replicas for all 40 jobs, durable occurrence identity before money moves, the occurrence-first rule on every surface (nextOccurrenceEffectiveAmount, never amount), override lifecycle, lease and claim expiry versus a still-running worker, duplicate email from every replica, and retry after a partial commit` |
| Runtime executed | Node 24.22.1 (`nvm use 24`), `npm ci` OK in `backend/`. PostgreSQL 16 in Docker (`mirror.gcr.io/library/postgres:16-alpine`, `dockerd` started by hand). Baseline integration: `npm run test:integration -- "scheduled\|job-claim\|loan-settlement-claim\|dated-loan-payment\|loan-settlement-debt\|backup-offsite-claim"` 8 suites, 45 passed. Probes (scratch worktree `<scratchpad>/mut` at the baseline, never committed): `zz-s08-probe.integration.spec.ts` constructs the REAL `ScheduledTransactionsService` by hand over the real `TransactionsService` and PostgreSQL (P1-P7, 8 cases); `zz-s08-probe2.integration.spec.ts` runs the real `BillReminderService` x3 and `AiInsightsService` x2 over the real `JobClaimService` (R1, R2). Mutations M1-M3, M5-M7 run against `scheduled-transactions.service.spec.ts`, `job-claim.service.spec.ts`, `job-claim-lease-rollout.integration.spec.ts` and the probes. |

## 2. Invariant map

| ID | Statement | Mechanism named | Holds? |
| --- | --- | --- | --- |
| INV-OCCURRENCE-001 | One scheduled occurrence has at most one financial effect | `post()` (`scheduled-transactions.service.ts:2862-3768`): pre-lock pin check (`:2921-2931`), `pessimistic_write` on the schedule row (`:3335-3338`), CAS `next_due_date` = the pre-lock read (`:3348`), `INSERT INTO scheduled_transaction_postings ... ON CONFLICT (scheduled_transaction_id, original_due_date) DO NOTHING RETURNING id` (`:3646-3663`), money, override removal and cursor advance in the SAME `withScopedDb` transaction (`:3332-3741`); unique index on the entity (`scheduled-transaction-posting.entity.ts:41`) and `idx_stp_occurrence` in `schema.sql` | **Cron path: yes**, executed (P1, P1b, P5). **Manual post and skip: no** -- the HTTP route sends no pin (A26-S08-01, executed P2, P3, P7). **Cursor after a rule claim: no** (A26-S08-03, executed P4). |
| INV-CRON-001 (`partial`) | One logical cron effect per tick across replicas | per job; see the matrix in section 12 | Every one of the 49 handlers names a cross-replica mechanism in code (section 12). The `partial` gap stands as indexed: two-instance tests exist only for the MNY reaper; the scheduler's has now been written as a probe (P1) but is not in the suite (A26-S08-05). Lease overrun (A26-S08-04) is a second, unindexed gap. |
| INV-OCCURRENCE-003 | Every surface reports the effective occurrence | `ScheduledOccurrenceService`, `expandOccurrenceSlots`, `occurrence-selection.guard.spec.ts`; client `nextOccurrenceEffectiveAmount` | Server: the reminder (`bill-reminder.service.ts:299-325`) and the cron selection read occurrences. Client: `PostTransactionDialog.tsx:433` pre-fills `nextOverride?.amount ?? scheduledTransaction.amount`, the shape `frontend/CLAUDE.md` forbids; the server re-prices echoes for loan/FX/investment lines, so no wrong posting was shown here. Handed to S19 (section 12). |
| INV-OCCURRENCE-002 | A stored override price survives reopening | `OverrideEditorDialog` seeding | Not re-tested (frontend, S19). |
| (override lifecycle) | An override is consumed with its occurrence and never outlives the cursor | `post()` removes the locked override (`:3719-3721`); `advanceScheduleCursor` prunes `original_date < next` (`schedule-cursor.ts`); `skip()` deletes the override at the skipped slot (`:2691-2697`) | Yes on post and skip; `skip()` from a stale view deletes the NEXT slot's override with it (A26-S08-01, P3). |
| INV-CLAIM-001 | Emergency-access claim token consumed once | conditional `UPDATE` | Not this slice's path (S03 disposed it); the `JobClaimService` lease protocol was audited instead (below). |
| (lease protocol) | A lease excludes concurrent work; a delivery record is written only by the holder; a delivered row is never retaken | `claimLease` `ON CONFLICT ... DO UPDATE ... WHERE delivered_at IS NULL AND expires_at < CURRENT_TIMESTAMP RETURNING lease_token` (`job-claim.service.ts:126-158`); `markDelivered`/`releaseLease` compare the token and set the migration-143 GUC (`:182-201, :269-292`) | Yes within the TTL (R1 executed: three replicas, one email). Not beyond it: no renewal, and a holder's own writes other than `markDelivered`/`release` are unfenced (A26-S08-04, R2 executed). |
| INV-DISPATCH-001..004 | The dispatch seam: `create` is the sole writer; the in-app row is always written; the throttle gates only the fan-out; a fan-out failure never rolls back the row | `NotificationDispatchService.notify` (`notification-dispatch.service.ts:175-241`): advisory lock, `notifications.create` (`INSERT ... ON CONFLICT DO NOTHING RETURNING`), throttle decision in the same transaction, fan-out after commit with `.catch` | Yes by inspection; the loser of a dedupe gets `null` and sends nothing (`:209-210, :225`). |
| INV-LOAN-HISTORY-001 (`partial`) | Historical loan interest counted as paid is ledger-backed | `resolvePostingAllocation` at the consumption boundary under `lockLoanLedgerForPricing` | Posting half only: re-resolution under the lock is present on both the base-split and the inline-echo path (`:3460-3531, :3546-3636`); `scheduled-loan-pricing-concurrency` passed. The index's gap (history) is S15's. |
| (failure semantics) | A refused or failed post writes nothing; a reported failure means nothing was written | claim + money + advance in one transaction (P5 executed: injected failure after the claim leaves no claim, no row, no advance) | **No** for errors raised after the commit: `completeTransfer`, `recalculateLoanPaymentSplits` and the final `findOne` run after it (`:3747-3767`), so a committed post is reported as failed (A26-S08-02, executed P6). |

Material flows:

- Auto-post: `@Cron("5 * * * *") processAutoPostTransactions` -> `withSystemContext` -> per timezone bucket, a committed read of due schedules (`:558-610`) -> per schedule `withUserContext(owner, post(..., { requireActiveAutoPost, expectedDueDate }))` -> lock, CAS, claim, money (`TransactionsService.create` / `writeTransferLegs` / `postInvestment`), override removal, `advanceScheduleCursor` -> commit -> post-commit transfer completion, loan split recalculation -> `ConflictException` and a vanished schedule count as skipped; every other error raises `SCHEDULED_POST_FAILED` (`:628-728`).
- Manual post: `PostTransactionDialog` (pre-fill from `nextOverride ?? schedule`, `:426-479`) or the row menu (`ScheduledTransactionListParts.tsx:210`, no body) -> `POST /scheduled-transactions/:id/post` (`controller.ts:329-352`, no pin) -> `post()` re-reads `next_due_date` and claims whatever it now is.
- Skip: row menu -> `POST /:id/skip` (`controller.ts:354-368`) -> `skip()` (`:2662-2699`): unlocked read, compute next, unconditional `UPDATE`.
- Rule settlement: `settle_loan_installment` -> `claimLoanOccurrence` (`claim-loan-occurrence.ts:69-145`) claims the nearest free slot inside the window, which may be after the cursor (`occurrence-slots.ts:96-140, 255-285`), and advances only when the slot is the cursor.
- Reminder: `@Cron 8AM` -> cross-user read -> per user `claimLease(BillReminder, user, date#digest, 10 min)` -> `wasDelivered` -> occurrence expansion -> SMTP -> `markDelivered(token)`; failure releases by token.

## 3. Lens ledger

| Lens | Status |
| --- | --- |
| Pin the revision | ran: pin check empty at start. |
| Instructions first | ran: `AGENTS.md`, root and `backend/CLAUDE.md`, `frontend/CLAUDE.md`, `docs/cron-jobs.md` (full), `docs/backend/cron-and-background-work.md` (full), `docs/system-invariants.md` entries INV-OCCURRENCE-001..003, INV-CRON-001, INV-DISPATCH-001..004 (index rows), INV-LOAN-HISTORY-001 (index row), `.claude/commands/audit.md` (via `/audit`). The two specs named in the session block were not read in full (budget; the posting half they describe was read in code). |
| Summaries as hypotheses | ran: A26-S02-04, A26-S07-02, A26-S07-06, S06 section 12, and the sweep agent's matrix were each re-checked in code; the agent's lease and clock claims were verified where they became findings (R2) or rejected (section 8). |
| Invariant model first | ran (section 2). |
| Change surface (producer/consumer) | ran: every writer of `scheduled_transaction_postings` (`post()`, `claim-loan-occurrence.ts`, `rule-run-undo.ts` delete, backup restore), every caller of `post()` (cron, controller, AI action, email-receipt link) and of `skip()`, every `claimOnce`/`claimLease` call site (13), every `@Cron` (49). |
| Rule 4 (read-model migration) | ran on the client: `nextOverride?.amount ?? amount` in the post dialog (section 12, to S19). |
| Rule 5 (upstream mutation matrix) | ran for the posting amount: schedule edit, override edit, FX refresh cron (`refreshForeignCurrencyEstimates` absolute overwrite), loan ledger movement; each is re-checked under the lock by `sameScheduleMutationBasis`, `sameOverrideMutationBasis`, the split basis and `resolvePostingAllocation`. The FX cron's unconditioned `update` is section 8. |
| Cross-layer | ran for manual post and skip: dialog -> API client -> controller -> DTO -> service -> claim; and for the reminder: cron -> lease -> SMTP -> delivery record. |
| Representation boundary | ran: `expectedDueDate` absent vs present (absent means "post whatever is due now"); `transactionDate` vs claim key (`original_due_date` is the cursor, not the date sent); `occurrences_remaining` 0 with `is_active=false` still postable manually (P7). |
| Browser round trip | ran statically: the dialog's `transactionDate` is the occurrence date the user saw, but it is never sent as an identity (A26-S08-01). |
| Server-authoritative metadata | ran: the occurrence identity is server-derived (the cursor), which is exactly why a stale client cannot name the one it meant (A26-S08-01). |
| Identity vs value | ran: the claim key is `(schedule, original_due_date)`; a posted row's date is not its identity; two rows with the same date and amount in P2/P7 belong to two different slots. |
| State machine | ran: cursor states (due, posted/advanced, skipped, claimed-by-rule-not-advanced, deactivated); transition `claimed-by-rule ahead of cursor -> post(cursor) -> cursor on a claimed slot` has no exit except skip (A26-S08-03). |
| Concurrency and idempotency | ran and executed: two replicas with a barrier after selection (P1), loser selecting before the winner commits (P1b), three reminder replicas (R1), lease expiry under a running holder (R2). |
| Partial failure | ran and executed: failure between claim and money rolls back (P5); failure after commit is reported as a failure (P6). Email: at-least-once by design (crash between SMTP and `markDelivered`), documented, not a finding. |
| External provider | ran for the AI insight generation (R2) and, through the sweep, for every leased fetch; Rule 6: no N+1 claimed. |
| Database and migration | ran: unique index declared on the entity and in `schema.sql`; `chk_stp_rule_claim_transaction`; `ON DELETE CASCADE` from the transaction releases a claim. No migration in the slice. |
| Backup/restore lens | applicable only to the S06 hand-off (manual fan-out vs cron), ran (section 12). |
| Financial lens | ran: every confirmed financial finding carries amounts (P2, P6, P7). Loan payment matrix: not applicable beyond the posting boundary, which is S15's slice (pricing re-resolution checked only for presence). |
| Authorization / RLS | ran at the seams: cron fan-out `withSystemContext`, per-user `withUserContext`, claims inside the user context; the cross-owner scheduled transfer under the cron's single-user context was not executed (open hypothesis, section 12). |
| Tests as evidence | ran: no integration test constructs the real `post()` (the harness stubs the module, `test/helpers/integration-setup.ts:117-150`); `job-claim.service.spec.ts` asserts SQL text; `job-claim-lease-rollout` covers only the migration-143 trigger (A26-S08-05). |
| Mutation | ran (section 6). |
| Counterexamples and interaction | ran (section 7). |
| Adversarial approval challenge | ran (section 13). |

## 4. Confirmed findings

### A26-S08-01 - Manual post and skip are not pinned to the occurrence the user saw; a stale view pays a bill twice or consumes the next occurrence (MON-H06 residual; supersedes A26-S02-04)

1. **Severity:** HIGH
2. **Confidence:** high (executed, P2, P3, P7)
3. **Location:** `backend/src/scheduled-transactions/scheduled-transactions.controller.ts:329-368` (post and skip routes pass no occurrence); `dto/post-scheduled-transaction.dto.ts` (no `expectedDueDate`); `scheduled-transactions.service.ts:2908-2931` (pin optional), `:2662-2699` (`skip()`: unlocked read, unconditional update); client `frontend/src/components/scheduled-transactions/PostTransactionDialog.tsx:453-454, 770`, `ScheduledTransactionListParts.tsx:210, 214`, `frontend/src/lib/scheduled-transactions.ts:154`.
4. **Violated invariant:** INV-OCCURRENCE-001 -- one logical occurrence, one financial effect, on every entry point; the cron, AI-action and email-receipt paths carry the pin (`:624`, `ai-actions.service.ts:1147`, `email-receipt-trade-link.service.ts:296`), the two human ones do not.
5. **Realistic reproduction scenario:** (a) Monthly "Rent" -50.00 due 2026-09-01, balance 100.00. The Bills tab was loaded before 00:05; the cron posts 2026-09-01 and advances to 2026-10-01; the user opens Post on the stale row (dialog date 2026-09-01) and confirms. (b) Same, with a schedule of one remaining occurrence (`occurrences_remaining = 1`): the cron posts it and deactivates the schedule; the stale tab posts it again. (c) Same as (a), the user presses Skip on the stale row instead. A lost HTTP response retried by the client, and the false failure alert of A26-S08-02, are two more ways to reach (a)/(b) without a second tab.
6. **Observed implementation behavior (executed):** (a) P2: two rows dated 2026-09-01, balance 0.00, claims `[2026-09-01, 2026-10-01]`, cursor 2026-11-01 -- October was consumed early under September's date. (b) P7: the deactivated schedule posts again: two rows dated 2026-09-01, balance 0.00 instead of 50.00, a claim on 2026-10-01 for a schedule that had no occurrence left. (c) P3: cursor 2026-10-01 -> 2026-11-01; October is skipped although the user skipped September (already paid), and October's override, if any, is deleted with it.
7. **Expected behavior:** 409 "already posted" (or "already skipped"), nothing written, as the cron gets.
8. **Impact:** (a) a payment booked a month early under the wrong date; the register shows the bill paid twice in one month and the next month's bill silently missing. (b) a genuine extra payment: -50.00 on a 50.00 bill, 100 % of the occurrence, on an exhausted schedule (the last installment of a loan, a fixed-count plan, any schedule past `end_date`). (c) a real occurrence never booked, with no record that it was owed. All three are user-visible only by reading the register.
9. **Root cause:** the occurrence identity is the cursor the server reads at request time; the client knows which occurrence it means but the API has no field to say it, and `post()` accepts an inactive or exhausted schedule for a manual post (`:3357-3371` checks activity only for the cron).
10. **Recommended correction:** carry the occurrence the client displays on both routes, refuse a mismatch inside the locked transaction (the existing pre-lock check plus the CAS already do this when `expectedDueDate` is set), and do the same in `skip()` under a lock. Decision for the maintainer: whether an absent pin remains accepted for one release (old clients) or is required at once; the safer default is to require it for the dialog and the row menu, both of which have the date.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/scheduled-transactions/dto/post-scheduled-transaction.dto.ts
+++ b/backend/src/scheduled-transactions/dto/post-scheduled-transaction.dto.ts
@@
+  @ApiPropertyOptional({
+    description:
+      "The occurrence (recurrence slot, YYYY-MM-DD) the client is posting; refused with 409 once it is no longer the due one",
+  })
+  @IsOptional()
+  @ValidateIf((_o, v) => v !== null && v !== "")
+  @IsDateString()
+  expectedDueDate?: string;
--- a/backend/src/scheduled-transactions/dto/skip-scheduled-transaction.dto.ts
+++ b/backend/src/scheduled-transactions/dto/skip-scheduled-transaction.dto.ts
+export class SkipScheduledTransactionDto {
+  @ApiPropertyOptional()
+  @IsOptional()
+  @ValidateIf((_o, v) => v !== null && v !== "")
+  @IsDateString()
+  expectedDueDate?: string;
+}
--- a/backend/src/scheduled-transactions/scheduled-transactions.controller.ts
+++ b/backend/src/scheduled-transactions/scheduled-transactions.controller.ts
@@ post
     return this.scheduledTransactionsService.post(req.user.id, id, postDto, {
       actorIsNotOwner: req.user.isActing === true,
+      expectedDueDate: postDto?.expectedDueDate,
     });
@@ skip
-    return this.scheduledTransactionsService.skip(req.user.id, id);
+    return this.scheduledTransactionsService.skip(req.user.id, id, dto?.expectedDueDate);
--- a/backend/src/scheduled-transactions/scheduled-transactions.service.ts
+++ b/backend/src/scheduled-transactions/scheduled-transactions.service.ts
@@ async skip(userId: string, id: string): Promise<ScheduledTransaction> {
-  async skip(userId: string, id: string): Promise<ScheduledTransaction> {
-    const scheduled = await this.findOne(userId, id);
-    const nextDueDateStr = ensureYMD(scheduled.nextDueDate);
+  async skip(userId: string, id: string, expectedDueDate?: string): Promise<ScheduledTransaction> {
+    await withScopedDb(this.dataSource, async (m) => {
+      const scheduled = await m.findOne(ScheduledTransaction, {
+        where: { id, userId },
+        lock: { mode: "pessimistic_write" },
+      });
+      if (!scheduled) throw new NotFoundException(/* errors.scheduled.notFound */);
+      const nextDueDateStr = ensureYMD(scheduled.nextDueDate);
+      if (expectedDueDate !== undefined && nextDueDateStr !== ensureYMD(expectedDueDate)) {
+        throw new ConflictException(
+          tr("errors.scheduled.occurrenceAlreadyPosted", "This occurrence has already been posted."),
+        );
+      }
+      // ... existing computation of updateFields from the LOCKED row, then the
+      // override delete and the update, unchanged ...
+    });
+    return this.findOne(userId, id);
--- a/frontend/src/components/scheduled-transactions/PostTransactionDialog.tsx
+++ b/frontend/src/components/scheduled-transactions/PostTransactionDialog.tsx
@@
-      await scheduledTransactionsApi.post(scheduledTransaction.id, postData);
+      await scheduledTransactionsApi.post(scheduledTransaction.id, {
+        ...postData,
+        // The recurrence slot, not the (possibly overridden) posting date.
+        expectedDueDate: scheduledTransaction.nextDueDate.split('T')[0],
+      });
--- a/frontend/src/components/scheduled-transactions/ScheduledTransactionListParts.tsx
+++ b/frontend/src/components/scheduled-transactions/ScheduledTransactionListParts.tsx
@@
-        await scheduledTransactionsApi.post(transactionId);
+        await scheduledTransactionsApi.post(transactionId, { expectedDueDate: dueSlot });
@@
-        await scheduledTransactionsApi.skip(transactionId);
+        await scheduledTransactionsApi.skip(transactionId, dueSlot);
```

   `dueSlot` is the row's `nextDueDate` (the slot), which the list already holds; `scheduledTransactionsApi.skip` gains the optional body. Self-check: the pin names the slot, not the override date, so an override that moves the posting date does not trip it; a user who deliberately posts a not-yet-due occurrence still can (the slot they see is the cursor); the cron path is unchanged. Needs: i18n key reuse check, controller and DTO unit tests, the client tests, and `e2e/` grep for the Post/Skip controls (names unchanged).
12. **Recommended regression test:** the P2/P7/P3 probes as an integration spec against the real `post()`/`skip()` (the harness change of A26-S08-05), asserting 409 and an unchanged ledger; a controller spec asserting the pin is forwarded; a dialog test asserting the payload carries `expectedDueDate`.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+++ b/backend/test/integration/scheduled-post-occurrence-pin.integration.spec.ts
+  it("refuses a manual post of an occurrence the cron already posted", async () => {
+    const s = await makeSchedule({ nextDueDate: "2026-09-01", amount: -50 });
+    await service.processAutoPostTransactions();          // posts 2026-09-01
+    await expect(
+      withUserContext(userId, () =>
+        service.post(userId, s.id, { transactionDate: "2026-09-01" } as any, {
+          expectedDueDate: "2026-09-01",
+        }),
+      ),
+    ).rejects.toBeInstanceOf(ConflictException);
+    expect(await balance()).toBe(50);                      // 100.00 - 50.00, once
+    expect(await claims(s.id)).toEqual(["2026-09-01"]);
+  });
+  it("refuses a stale skip", async () => { /* same, skip(userId, id, "2026-09-01") -> 409, cursor stays 2026-10-01 */ });
+  it("refuses a manual post of an exhausted schedule's consumed slot", async () => { /* occurrences_remaining 1, P7 */ });
```

14. **Verification method:** that spec; `npm run test:unit -- scheduled-transactions`; `npm run test -- PostTransactionDialog ScheduledTransactionList scheduled-transactions` in `frontend/`; manual check that a deliberate early post (pin = current cursor) still works.
15. **Residual risks / patch limitations:** old clients that omit the pin keep today's behaviour until it is required; `post()` still accepts an inactive schedule manually by design (the pin is what refuses the consumed slot, not the activity flag).

Causality: `PRIOR_REPORTED`, `CONFIRMED` (MON-H06 residual path; A26-S02-04 superseded, with the skip surface and the exhausted-schedule case added). Rule 7 surfaces: dialog post, row-menu post, row-menu skip, any retry of either. Severity raised from S02's MEDIUM on execution: case (b) is an outright extra payment, and A26-S08-02 gives a server-induced trigger.

### A26-S08-02 - An error after the posting commit is reported as "could not be posted": the cron raises a false alert telling the user to post manually, and the HTTP caller sees a failure for a committed post

1. **Severity:** MEDIUM
2. **Confidence:** high (executed, P6)
3. **Location:** `backend/src/scheduled-transactions/scheduled-transactions.service.ts:3743-3767` (post-commit `completeTransfer`, `recalculateLoanPaymentSplits`, `findOne` inside `post()`); classification `:628-728` (only `ConflictException` and a vanished schedule are "skipped"; every other error raises `SCHEDULED_POST_FAILED` with "You can post it manually from Bills").
4. **Violated invariant:** a reported failure means nothing was written (the "rejection before write" rule read in reverse: a caller must be able to tell "not posted" from "posted, follow-up failed"); INV-OCCURRENCE-001 through its consequence.
5. **Realistic reproduction scenario:** a split schedule (any `splits.length > 0`, loan templates included) due 2026-09-01 auto-posts; the post-commit `recalculateLoanPaymentSplits` fails (a lock timeout or deadlock against a concurrent ledger writer, a connection drop). For a transfer schedule the same holds for `completeTransfer` (two `findOne` reads and the history write).
6. **Observed implementation behavior (executed, failure injected into the post-commit recalculation):** the September row is committed and the cursor advanced to 2026-10-01, yet the cron raised "Rent could not be posted" (`SCHEDULED_POST_FAILED`). On the manual path the first `post()` rejected with the injected error after committing October; the user's retry posted again: three rows (2026-09-01, 2026-10-01, 2026-10-01), claims through 2026-11-01, balance -50.00 instead of 0.00.
7. **Expected behavior:** the posting succeeds as far as the caller is concerned; the follow-up failure is logged (and, for the loan recalculation, retried by the next posting's re-resolution, which already exists) without changing the outcome reported.
8. **Impact:** the alert text instructs the exact action that books the bill a second time (A26-S08-01); the HTTP error invites a retry with the same result. -50.00 per occurrence in the example, 100 % of the bill.
9. **Root cause:** the post-commit half of `post()` propagates its errors through the same promise as the posting itself; neither the cron's classifier nor the client can distinguish them.
10. **Recommended correction:** catch and log the post-commit half inside `post()` (it is best-effort by design: the net-worth recalculation and the loan template are both re-derived later), and return the posted schedule; keep the error path only for failures before the commit.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/scheduled-transactions/scheduled-transactions.service.ts
+++ b/backend/src/scheduled-transactions/scheduled-transactions.service.ts
@@ post()
-    if (preparedTransfer && writtenTransfer) {
-      await this.transactionsService.completeTransfer(
-        preparedTransfer,
-        writtenTransfer.savedFromId,
-        writtenTransfer.savedToId,
-      );
-    }
+    // Everything below runs after the occurrence committed. A failure here must
+    // not be reported as "not posted": the cron would alert the user to post
+    // it again, and a client would retry an operation that already happened.
+    await this.afterPostCommit(id, async () => {
+      if (preparedTransfer && writtenTransfer) {
+        await this.transactionsService.completeTransfer(
+          preparedTransfer,
+          writtenTransfer.savedFromId,
+          writtenTransfer.savedToId,
+        );
+      }
+    });
@@
-    if (scheduled.splits && scheduled.splits.length > 0) {
-      await this.loanService.recalculateLoanPaymentSplits(id);
-    }
+    if (scheduled.splits && scheduled.splits.length > 0) {
+      await this.afterPostCommit(id, () =>
+        this.loanService.recalculateLoanPaymentSplits(id),
+      );
+    }
@@
+  private async afterPostCommit(id: string, fn: () => Promise<unknown>): Promise<void> {
+    try {
+      await fn();
+    } catch (error) {
+      this.logger.error(
+        `Scheduled transaction ${id} posted; a follow-up step failed and is left to the next run`,
+        error instanceof Error ? error.stack : error,
+      );
+    }
+  }
```

   Self-check: the final `return this.findOne(userId, id)` can still throw (schedule deleted concurrently); the cron already treats a vanished schedule as skipped. A failed `completeTransfer` loses the transfer's tags and history entry (pre-existing post-commit property); the money and the claim are already consistent. Needs: unit tests for both paths, the P6 probe as an integration case.
12. **Recommended regression test:** inject a failure into the post-commit recalculation; assert the cron raises no `SCHEDULED_POST_FAILED`, `post()` resolves, and a manual retry with the pin of A26-S08-01 is refused.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+  it("a failure after the commit is not reported as a failed posting", async () => {
+    loan.recalculateLoanPaymentSplits.mockRejectedValueOnce(new Error("lock timeout"));
+    await service.processAutoPostTransactions();
+    expect(alerts.raiseUserAlert).not.toHaveBeenCalled();
+    expect(await ledger()).toMatchObject({ n: 1, sum: -50 });
+  });
```

14. **Verification method:** that case in the integration spec of A26-S08-05; `npm run test:unit -- scheduled-transactions.service`.
15. **Residual risks / patch limitations:** the AI-action and email-receipt callers of `post()` also see a resolved promise afterwards, which is the intended change; a caller that relied on the throw to roll back its own outer transaction cannot (the posting already committed in its own `withScopedDb` unless nested), so the nesting of those callers should be re-checked (S17, S11).

Causality: `NEW_SINCE_UPSTREAM_AUDIT` (the single-transaction posting with a post-commit half is the MON-H06 fix).

### A26-S08-03 - `post()` advances the cursor past its own slot only, so a slot a settlement rule claimed ahead of the cursor becomes `next_due_date` and the schedule is stuck: every tick is skipped silently and every manual post is refused

1. **Severity:** MEDIUM
2. **Confidence:** high (executed, P4)
3. **Location:** `backend/src/scheduled-transactions/scheduled-transactions.service.ts:3739` (`advanceScheduleCursor(m, current, new Set([nextDueDateStr]))`); contrast `loan-installments/claim-loan-occurrence.ts:150-180` (the rule's advance reads every claim on or after the cursor); slot selection `loan-installments/occurrence-slots.ts:96-140, 255-285` (the nearest free slot, cursor and later slots included); classification `scheduled-transactions.service.ts:629-636` (a `ConflictException` counts as "claimed elsewhere", no alert).
4. **Violated invariant:** `schedule-cursor.ts`'s own contract, "the cursor steps past every consecutive claimed slot so the bill never offers an occurrence whose own claim key is taken"; INV-CRON-001 (one effect per tick, here zero forever with no report).
5. **Realistic reproduction scenario:** a loan bill (manual or auto-post) whose 2026-08-01 installment is not yet posted; the bank row for the September installment arrives dated in late August and the `settle_loan_installment` rule claims slot 2026-09-01 (nearest free slot; `cursorAdvanced = false`). The August installment is then posted (cron or manual).
6. **Observed implementation behavior (executed):** after the August post the cursor is 2026-09-01, the slot the rule already holds; two further cron ticks post nothing and raise no alert (`raiseUserAlert` calls: 0); a manual post answers 409 "This occurrence has already been posted." The October, November, ... installments never post until the user presses Skip.
7. **Expected behavior:** the August post advances the cursor past every consecutive claimed slot (to 2026-10-01), exactly as the rule's own advance does.
8. **Impact:** a loan's scheduled installments stop being booked with no signal (the cron log counts them as "already claimed elsewhere"); the loan and chequing balances drift by one installment per month until noticed. The manual 409 message is misleading (the bill shown as due is reported as already posted).
9. **Root cause:** two callers of `advanceScheduleCursor` pass different consumed sets; `post()` predates rule claims ahead of the cursor and was not updated when they became possible.
10. **Recommended correction:** in `post()`, read the schedule's claims dated on or after the slot inside the locked transaction (after the insert) and pass them all, as `claim-loan-occurrence.ts` does.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/scheduled-transactions/scheduled-transactions.service.ts
+++ b/backend/src/scheduled-transactions/scheduled-transactions.service.ts
@@ post(), recurring branch
-      await advanceScheduleCursor(m, current, new Set([nextDueDateStr]));
+      // Step past every slot already claimed at or after this one -- a
+      // settlement rule may hold a later slot (INV-LOAN-008) -- so the cursor
+      // never lands on an occurrence whose claim key is taken.
+      const claimedAhead = returnedRows<{ d: string }>(
+        await m.query(
+          `SELECT TO_CHAR(original_due_date, 'YYYY-MM-DD') AS d
+             FROM scheduled_transaction_postings
+            WHERE scheduled_transaction_id = $1 AND original_due_date >= $2`,
+          [id, nextDueDateStr],
+        ),
+      ).map((r) => r.d);
+      await advanceScheduleCursor(m, current, new Set([nextDueDateStr, ...claimedAhead]));
```

   Self-check: `advanceScheduleCursor` already decrements `occurrences_remaining` once per stepped slot, so a rule-paid slot is counted as consumed (consistent with the rule's own advance). The skipped-over slot's override is pruned by the existing `original_date < next` delete. Needs: the P4 probe as an integration case; a unit case with a claim ahead.
12. **Recommended regression test:** P4 against the real `post()`.
13. **Suggested regression-test diff (illustrative, not applied):**

```diff
+  it("steps past a slot a settlement rule already claimed", async () => {
+    const s = await makeSchedule({ nextDueDate: "2026-08-01" });
+    await insertRuleClaim(s.id, "2026-09-01", bankRowId);
+    await service.processAutoPostTransactions();
+    expect(await cursor(s.id)).toBe("2026-10-01");
+  });
```

14. **Verification method:** that case; `npm run test:unit -- schedule-cursor scheduled-transactions.service claim-loan-occurrence`.
15. **Residual risks / patch limitations:** a schedule already stuck in production is not repaired by the fix (its cursor already sits on the claimed slot, so every post is still refused); it needs a skip or a one-off data repair; the cron should also alert when a due occurrence is refused for many consecutive ticks (design risk, section 9).

Causality: `NEW_SINCE_UPSTREAM_AUDIT` (rule claims on the occurrence key, INV-LOAN-008).

### A26-S08-04 - The AI insight lease (15 min) is shorter than the provider call it guards (Ollama aborts at 20 min), and the save is not fenced by the lease token: a second generation runs and both sets are saved (MON-M25 residual)

1. **Severity:** LOW
2. **Confidence:** high (executed, R2)
3. **Location:** `backend/src/ai/insights/ai-insights.service.ts:52` (`INSIGHT_GENERATION_LEASE_MS = 15 min`), `:184-238` (lease, cooldown re-read), `:741-790` (`saveInsights`, no token check); `ai/providers/ollama.provider.ts:160` (20-minute abort "for CPU inference"); `ai/providers/long-running-fetch.ts` (undici timeouts disabled).
4. **Violated invariant:** INV-CRON-001 / the lease contract in `job-claim.service.ts` ("only one replica may do this now").
5. **Realistic reproduction scenario:** a self-hosted deployment on CPU inference; the 6 AM cron's generation for a user takes 16 minutes; the user presses "Generate insights" (or a second replica's request arrives) after minute 15.
6. **Observed implementation behavior (executed, the holder's lease expired by its own token while its provider call was in flight):** two provider calls, two insight rows saved for one generation window (`providerCalls: 2, rows: 2`).
7. **Expected behavior:** the second caller stands down while the first is still running; or the first's save is refused once its lease is gone.
8. **Impact:** duplicate insight cards (bounded by `MAX_INSIGHTS_PER_USER` pruning) and a second full CPU inference on the hardware the 20-minute budget exists for.
9. **Root cause:** a TTL chosen independently of the work's own upper bound, with no renewal and an unfenced final write.
10. **Recommended correction:** make the lease outlast the provider budget (derive it from the largest provider timeout plus margin), and fence the save: re-check under the lease token inside the save transaction.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/src/ai/insights/ai-insights.service.ts
+++ b/backend/src/ai/insights/ai-insights.service.ts
-const INSIGHT_GENERATION_LEASE_MS = 15 * 60 * 1000;
+// Longer than the slowest provider call it guards (Ollama aborts at 20 min,
+// ollama.provider.ts) plus aggregation and save, so a live generation is never
+// retaken by a second one.
+const INSIGHT_GENERATION_LEASE_MS = 25 * 60 * 1000;
@@ saveInsights
-    await withScopedDb(this.dataSource, async (manager) => {
+    await withScopedDb(this.dataSource, async (manager) => {
+      const held = await manager.query(
+        `SELECT 1 FROM job_claims
+          WHERE claim_type = $1 AND user_id = $2 AND claim_key = $3
+            AND lease_token = $4::uuid FOR UPDATE`,
+        [JobClaimType.AiInsightGeneration, userId, INSIGHT_GENERATION_CLAIM_KEY, leaseToken],
+      );
+      if (returnedRows(held).length === 0) return; // retaken: the holder saves
```

   (`saveInsights` gains the `leaseToken` parameter.) Needs: unit tests, the R2 probe as an integration case.
12. **Recommended regression test:** R2.
13. **Suggested regression-test diff (illustrative, not applied):** the R2 probe asserting `rows === 1`.
14. **Verification method:** `npm run test:unit -- ai-insights`; R2 as an integration spec.
15. **Residual risks / patch limitations:** the provider is still paid twice when the lease is outrun; only a longer TTL (or renewal) prevents the call.

Causality: `PRIOR_REPORTED`, MON-M25 residual with a different root cause (the process-local guard is gone; the lease replacing it is outrun). Related, not executed, same class (section 9): `email-receipt-poll` (10-min lease, provider steps up to the same 20-min budget), `bond-series` (`withLease` 90 min vs a worst case of hours; writes converge), `backup-offsite-retry` (outcome write not fenced by attempt).

### A26-S08-05 - No integration test runs the real `post()`, the auto-post cron, or the lease semantics against PostgreSQL

1. **Severity:** LOW
2. **Confidence:** high
3. **Location:** `backend/test/helpers/integration-setup.ts:117-150` (the module is stubbed); `scheduled-loan-pricing-concurrency.integration.spec.ts:38-45` and `loan-settlement-claim.integration.spec.ts:53` say so; `src/common/jobs/job-claim.service.spec.ts:62-195` (asserts SQL text); `job-claim-lease-rollout.integration.spec.ts` (migration-143 trigger only).
4. **Violated invariant:** INV-OCCURRENCE-001 "a two-instance integration test is still owed"; INV-CRON-001 "two-instance per job"; `docs/verification-contract.md` (a mock proves the call, not the property).
5. **Reproduction:** mutations M1-M3 and M5-M7 (section 6) leave every integration suite green; A26-S08-01..03 are invisible to the suite.
6. **Observed:** the probes in this report are the first runs of the real posting path against PostgreSQL in the program.
7. **Expected:** the probe harness (construct `ScheduledTransactionsService` by hand over the real `TransactionsService`, stub only the loan and FX collaborators) in the suite, plus a real-database lease test (retake after expiry, no retake once delivered, stale holder's `markDelivered` refused).
8. **Impact:** regressions of the occurrence protocol reach `main` with green CI as long as the unit mocks are unchanged.
9. **Root cause:** the module cycle the stub breaks, and no hand-constructed alternative.
10. **Recommended correction:** add `scheduled-posting.integration.spec.ts` built as `<scratchpad>/mut/backend/test/integration/zz-s08-probe.integration.spec.ts` is built, and `job-claim-lease.integration.spec.ts`.
11. **Suggested remediation diff (illustrative, not applied):** a test-only change, acceptable here because the defect is the missing test:

```diff
+++ b/backend/test/integration/scheduled-posting.integration.spec.ts
+  function replica(): ScheduledTransactionsService {
+    return new ScheduledTransactionsService(
+      accounts, transactions, {} as any, {} as any, {} as any, {} as any,
+      loanStub as any, dataSource, history, {} as any, alerts as any,
+    );
+  }
+  it("two replicas, one tick: one posting", async () => { /* P1 with a two-party barrier after selection */ });
+  it("a replica that selected before the winner committed posts nothing", async () => { /* P1b */ });
+  it("a failure between claim and money leaves no claim", async () => { /* P5 */ });
```

12-14. **Regression test / diff / verification:** as above; `npm run test:integration -- scheduled-posting job-claim-lease`.
15. **Residual risks:** the hand-built service stubs the FX and investment collaborators, so FX and investment postings still need their own cases.

Causality: `PRE_EXISTING_UNREPORTED` as a test gap (S02 noted it; joins MON-M46 in S21).

## 5. Prior-finding dispositions

| ID | Disposition | Evidence |
| --- | --- | --- |
| MON-H06 | STILL_OPEN (residual) -> A26-S08-01 | Core fix verified by execution: claim, money and advance in one transaction (P5: an injected failure after the claim leaves no claim and no row); two replicas with a barrier post once (P1); a replica that selected before the winner committed posts nothing (P1b; removing the cron pin makes it post the next occurrence, M1). Residual: the manual post and skip carry no occurrence pin (P2, P3, P7). Related new defects in the same protocol: A26-S08-02, A26-S08-03. |
| MON-M25 (claim half) | FIXED_VERIFIED, with residual A26-S08-04 | The process-local `Set` is no longer the exclusion: `claimLease(AiInsightGeneration, user, "generation", 15 min)` plus the cooldown re-read under the lease (`ai-insights.service.ts:184-219`), release by token in `finally` (`:311-327`). R2 shows a duplicate only once the lease is outrun (A26-S08-04). The provider half stays with S17. |
| MON-L06 | FIXED_VERIFIED | Bill reminder: `claimLease(BillReminder, user, date#digest, 10 min)` -> `wasDelivered` -> SMTP -> `markDelivered(token)` (`bill-reminder.service.ts:226-401`); mortgage reminder the same shape (`mortgage-reminder.service.ts:176-258`). Executed R1: two replicas meeting at the claim with a barrier plus a third replica after the winner finished: one email, one `delivered_at` row. Unit tests in both services' specs. Residual design risk: the key's date is server-local (section 9). |

Hand-offs received and disposed:

- A26-S02-04 (from S02): superseded by A26-S08-01 (executed; severity re-evaluated).
- S02 "`skip()` lost update": included in A26-S08-01 (P3). The concurrent case (skip racing the cron) degrades to the stale case, since the cron's own pin and CAS refuse a moved cursor.
- S02 "cross-owner scheduled transfer cannot post": not executed; open hypothesis to S21 (section 12).
- A26-S07-02 (undo restores absolutely): the schedule undo set (`action-history.service.ts`, `ALLOWED_COLUMNS.scheduled_transactions`) also restores `next_due_date`, `occurrences_remaining`, `is_active` and `last_posted_date` from the edit-time snapshot. The ordinary path stays consistent because the posting's own "Created transaction" action is newer and is undone first (its claim cascades with the row). A posting that records no action (`recordOnly`, a retired loan bill) or a rule claim leaves the claim in place, and an undo of an earlier schedule edit then rewinds the cursor onto a claimed slot -- the stuck state of A26-S08-03. Design risk (section 9), not executed.
- A26-S07-06 (closing over a future row, then the fold cron): no additional scheduler defect. A schedule whose account was closed after it was created is refused by the `is_closed = false` delta predicate (`accounts.service.ts:166-181`, `openOnly`) and raises a daily `SCHEDULED_POST_FAILED`; `close()` neither deactivates nor warns about active schedules (section 9).
- S07 "writers disagree on today": confirmed statically for this slice (section 9).
- S06 "manual fan-out takes no per-user claim against the cron": confirmed no effect beyond S06's own: `runBackupForUser` (`auto-backup.service.ts:1293-1373`) records only the outcome (`recordBackupOutcome`), never `next_backup_at`, so it cannot rewind or re-arm the cron's claim; concurrent publishes of one name are atomic; the off-machine conflict alert and A26-S06-01 are the effects.

## 6. Mutation table

| Invariant | Mutation (file:line, what) | Test that fails | Verdict |
| --- | --- | --- | --- |
| INV-OCCURRENCE-001 (stale replica) | M1 `scheduled-transactions.service.ts:624` drop `expectedDueDate` from the cron's `post()` | `scheduled-transactions.service.spec.ts` (1 of 320); probe P1b posts 2026-09-01 as a second row | covered (unit only; no suite integration test) |
| INV-OCCURRENCE-001 (under-lock CAS) | M2 `:3348` disable the CAS | unit spec (1 of 320); P1 still single (the claim key backstops) | covered (unit only) |
| INV-OCCURRENCE-001 (claim) | M3 `:3656` ignore a lost claim | unit spec (1 of 320); P1 still single (the CAS backstops) | covered (unit only) |
| Lease exclusion | M5 `job-claim.service.ts:146` drop `expires_at < CURRENT_TIMESTAMP` | `job-claim.service.spec.ts` (SQL text); `job-claim-lease-rollout` 5/5 green | covered by text only; undetected at integration |
| Delivered never retaken | M6 `:144` drop `delivered_at IS NULL` | unit (SQL text); integration green | covered by text only; undetected at integration |
| Holder-only delivery record | M7 `:281` drop the token predicate of `markDelivered` | unit (SQL text); integration green | covered by text only; undetected at integration |
| Cursor past claimed slots | (baseline defect, A26-S08-03) `:3739` | none: P4 shows the defect at baseline and every suite is green | undetected (finding) |
| Manual pin | (baseline defect, A26-S08-01) | none at baseline | undetected (finding) |

Program-wide rows for S21: M5, M6, M7 (`INV-CRON-001 | job-claim.service.ts:144/146/281 | a real-database lease spec | S08`), and A26-S08-01/-03 as baseline defects no suite sees.

## 7. Counterexamples and the interaction scenario

- Stale browser (INV-OCCURRENCE-001): P2, P3, P7 (section 4).
- Process dies after the first durable side effect: P5 (before the commit: nothing remains) and P6 (after the commit: reported as failed).
- Two workers claim the same job: P1, P1b, R1.
- Lease expires under a running worker: R2.
- Same value, different identity: P2's two rows carry the same date and amount and belong to two slots; P4's bank row and the posted row are different slots for one month's money.
- Legacy / old client: a client without the pin keeps today's behaviour (A26-S08-01 residual).

Interaction scenario (A26-S08-02 + A26-S08-01): an auto-post of a loan bill commits on 2026-09-01 and its post-commit recalculation hits a lock timeout; the cron raises "Mortgage could not be posted ... You can post it manually from Bills". The user opens Bills: the row now shows 2026-10-01 (cursor advanced); the user sets the dialog date to 2026-09-01 as the alert said and posts. Without a pin the server claims 2026-10-01 and books it dated September: the installment is paid twice in September and October's is consumed. On a final installment it is an outright second payment (P7). Executed in two halves (P6 for the alert and the manual retry, P7 for the exhausted schedule).

Second interaction (A26-S08-03 + A26-S07-02): a rule claims slot 2026-09-01 ahead of a cursor at 2026-08-01; the user then undoes an earlier rename of the schedule; the cursor is restored to its edit-time value. Whatever the order, a cursor that lands on a claimed slot is refused forever by both the cron and the manual post. Not executed (the A26-S08-03 half is).

## 8. Rejected hypotheses

| Candidate | Evidence considered | Why rejected or downgraded | Final classification |
| --- | --- | --- | --- |
| Budget rollover keyed on the UTC month while the cron fires at server-local midnight (sweep agent) | `budget-period-cron.service.ts:40-42, 75-100, 150-155` | The close decision parses `periodEnd + "T23:59:59"` on the same local clock that fired the cron, so the right period closes; the key is a label. Replicas in different zones fire at different instants and the guarded writes (`closePeriod` row lock, `ON CONFLICT (budget_id, period_start)`) hold | REJECTED |
| Reminder lease (10 min) vs nodemailer's default 10-minute socket timeout | `email.service.ts:199`; one tick per day per key | A second replica fires at the same instant and has already lost; a later tick of the same key does not exist (date-keyed, daily) | REJECTED |
| `claimOnce` keys reset by the 30-day sweep | sweep agent; every key is a day, hour or month | No undated permanent key | REJECTED |
| One email per replica on any cron | the 49-row sweep (section 12) | Every external effect sits behind a claim, a lease or a dedupe insert | REJECTED |
| `refreshForeignCurrencyEstimates` overwrites a concurrent edit of `originalAmount` (unlocked read then `update`) | `scheduled-transactions.service.ts:769-829` | Writes only the account-currency estimate; posting re-derives from `originalAmount` and the dated rate (`resolveFxForPosting`, `:2721-2795`); INV-OCCURRENCE-003 says no surface substitutes the persisted `amount` (not re-verified per surface here); at worst a stale estimate until the next weekday | DESIGN_RISK (LOW, not a finding) |
| Two replicas both post a due occurrence | P1, P1b, M2, M3 | Lock + CAS + claim key, each a backstop for the other | REJECTED (holds) |
| A failure between the claim and the money leaves a claim and no money | P5 | One transaction | REJECTED (holds) |
| The cron alerts on every replica | `raiseUserAlert` dedupe key `SCHEDULED_POST_FAILED:<id>:<UTC day>` | One row per schedule per day | REJECTED |
| Manual backup fan-out rewinds the cron's per-user claim (S06) | `auto-backup.service.ts:1293-1373` | Records only the outcome | REJECTED (beyond S06's own effects) |

## 9. Design risks

- No alert for a schedule refused tick after tick: the cron counts a `ConflictException` as "claimed elsewhere" (`:629-636`) whatever its cause, so any state that makes the cursor's slot unclaimable is silent (A26-S08-03, and the undo rewind below). A refusal of the same occurrence across, say, 24 ticks is not a replica race.
- Undo of a schedule edit restores `next_due_date`, `occurrences_remaining`, `is_active`, `last_posted_date` absolutely (A26-S07-02 family); with a posting that recorded no action or a rule claim, it rewinds the cursor onto a claimed slot.
- "Today" in this slice: the cron selects by the user's timezone (`todayInTimezone`), while `advanceScheduleCursor` stamps `last_posted_date` with `todayYMD()`, which outside a request is the server's local date (`common/date-utils.ts:111-122`); the bill reminder's run date, the mortgage reminder key and the emergency-access key are server-local too. Replicas with different `TZ` would key reminders differently (one email each); a single image has one `TZ`, so this is a configuration hazard, not a present failure.
- `close()` neither deactivates nor warns about active schedules on the account; the cron then fails daily with `SCHEDULED_POST_FAILED`.
- Lease overruns of the same class as A26-S08-04, not executed: `email-receipt-poll` (10-min lease, work budget checked only before a step, provider steps up to 20 min; stored rows are idempotent, provider calls are not); `bond-series` `withLease` 90 min against a worst case of about 270 x (3 s + 2 x 30 s); `backup-offsite-retry` reclaims after 60 min and the late worker's outcome write is conditioned on `status = 'uploading'` only.
- A post-commit failure in `completeTransfer` loses the transfer's tags and history entry (the money is consistent); independent of A26-S08-02's reporting fix.

## 10. Missing tests and known-wrong tests

- No integration test of the real `post()`, the auto-post cron or `skip()` (A26-S08-05).
- No real-database test of `claimLease` expiry, the delivered-row exclusion, or the stale holder's `markDelivered` (M5-M7).
- No test of a rule claim ahead of the cursor followed by a post (A26-S08-03).
- No test asserting the HTTP routes carry an occurrence pin (A26-S08-01).
- Known-wrong: none found in the slice.

## 11. Documentation inconsistencies

- `docs/system-invariants.md` INV-OCCURRENCE-001 "Crash semantics: a crash between claim and advance leaves the claim row, so the next tick is refused rather than reposting" describes the pre-fix two-transaction shape; claim, money and advance now commit or roll back together (P5).
- `docs/concurrency-and-idempotency.md:470-476` says manual posting is covered by the occurrence pin; the HTTP path is not (A26-S08-01; S02 recorded the same line).
- `schedule-cursor.ts` header: "the cursor steps past every consecutive claimed slot so the bill never offers an occurrence whose own claim key is taken" is true of the rule's caller, not of `post()` (A26-S08-03).
- `docs/audits/2026-10/plan.md` section 1 and `sessions.md` S08 say 40 cron jobs; the code has 49 `@Cron` handlers in 46 files (and `docs/cron-jobs.md` has 49 rows).
- `docs/cron-jobs.md` `email-receipt-poll` "at most 5 provider calls ... per user per tick": the code also allows `AI_CATEGORY_CALLS_PER_POLL = 10` (`email-receipt-poll.service.ts:54, 355`; sweep, not executed) -- to S11.
- `docs/cron-jobs.md` `updates.service` "every 12 hours": the 12-hour window equals the period with a strict comparison (`updates.service.ts:28, 302-308`), so a tick can find the window not yet elapsed; effective cadence up to 24 h (sweep, not executed) -- to S17.
- `docs/cron-jobs.md` notification purge "both deletes are by predicate on stored timestamps": the cutoffs come from the process clock (`notification.service.ts:323`); harmless across replicas.

## 12. Review ledger

- **Directories inspected:** `backend/src/scheduled-transactions/`, `backend/src/common/jobs/`, `backend/src/loan-installments/` (claim and slots), `backend/src/notifications/` (bill reminder, dispatch), `backend/src/ai/insights/`, `backend/src/budgets/` (period cron), `backend/src/backup/` (manual run), `frontend/src/components/scheduled-transactions/` (post and skip call sites).
- **Files read in full:** `common/jobs/job-claim.service.ts`; `notifications/bill-reminder.service.ts`; `scheduled-transactions/schedule-cursor.ts` (to `PrunedScheduleOverride`); `docs/cron-jobs.md`; `docs/backend/cron-and-background-work.md`.
- **Files sampled (ranges):** `scheduled-transactions.service.ts` 486-864, 2640-3900 (of 4305; `create`/`update` 866-2640 and the override and loan delegations after 4079 not read); `scheduled-transactions.controller.ts` 329-368; `loan-installments/claim-loan-occurrence.ts` 1-180; `occurrence-slots.ts` 70-140, 240-300; `ai/insights/ai-insights.service.ts` 140-360, 602-650, 741-790; `ai/providers/ollama.provider.ts` 158-160; `long-running-fetch.ts` 1-40; `budgets/budget-period-cron.service.ts` 30-260; `backup/auto-backup.service.ts` 1293-1430; `accounts/accounts.service.ts` 150-215; `notifications/notification-dispatch.service.ts` 175-262; `transactions/transactions.service.ts` 410-440, 2488-2520, 3493-3540, 3591-3610, 3795-3830; `transactions/transaction-transfer.service.ts` 952-990; `action-history/action-history.service.ts` 160-260 (allowed columns), 490-535 (undo order); `common/date-utils.ts` 105-122; `common/users-by-timezone.util.ts` 26-70; `frontend/.../PostTransactionDialog.tsx` 405-480; `test/helpers/integration-setup.ts` 52-70, 117-150; `system-invariants.md` 4002-4130, 5745-5770.
- **Cron matrix (49 handlers; built by a read-only sweep agent and spot-checked by me where a row became a finding or a rejection):** every row names a cross-replica mechanism present in code. Claims: `claimOnce` (demo reset x2 by UTC day/hour, budget rollover by UTC month, bank sync by UTC day, system-alert email by UTC day); `claimLease` (AI insights 15 min, bill and mortgage reminders 10 min + delivery record, weekly budget digest 10 min, emergency access 10 min, email-receipt poll 10 min, bank-sync account 10 min, user maintenance); `FetchSyncService.withLease` (exchange rates 15 min, security prices 30 min, market indexes 20 min, bond benchmarks 10 min, bond prices 30 min, bond series 90 min, attachment relocation 20 min); dedupe `INSERT ... ON CONFLICT DO NOTHING RETURNING` (budget alerts, bond notifications, GEM signal, portfolio movement, security-price alert, AI review notices, bank-sync consent, system-alert monitor, provider outage with a conditional `UPDATE` per episode); conditional `UPDATE ... RETURNING` / `SKIP LOCKED` (auto-backup, off-site retry, MNY reaper, reminder cron, AI review expiry, rule-application retention, attachment tombstones, updates check); locks with absolute recompute (account fold, holdings rebuild, net-worth threshold latch); idempotent delete predicates (ai-usage, tokens, action history, notifications, push artifacts and subscriptions, relay sweeper, MNY staging, job-claim sweep, auth-state sweeper); scheduled auto-post (pin + lock + occurrence claim); FX estimate refresh (absolute overwrite). Losing-replica behaviour: skips, writes nothing, sends nothing.
- **Searches:** `@Cron(` across `src`; `claimOnce|claimLease|releasePermanentClaim|markDelivered|wasDelivered`; `scheduled_transaction_postings`; `expectedDueDate`; `generateInsights`; `INSIGHT_GENERATION_LEASE_MS`; `actionHistoryService.record` in the scheduler; `recordTransactionAction`; `openOnly`; `scheduledTransactionsApi.(post|skip)`; `\.(amount|nextDueDate)\b` in `components/scheduled-transactions`.
- **Suites run:** baseline integration 8 suites 45 passed (`dated-loan-payment`, `job-claim-lease-rollout`, `loan-settlement-claim`, `loan-settlement-debt`, `scheduled-investment-split-fx`, `scheduled-loan-dated-balance`, `scheduled-loan-pricing-concurrency`, `backup-offsite-claim`); `scheduled-transactions.service.spec.ts` 320 passed at baseline (319 + 1 failed under each of M1-M3); `job-claim.service.spec.ts` 16 passed at baseline (15 + 1 failed under each of M5-M7); probes P1-P7 and R1-R2 as reported.
- **Reviewed without a finding:** cron selection (postponed and override-moved occurrences, `:574-608`); the pre-lock and under-lock checks (`sameScheduleMutationBasis`, override and split bases); loan pricing re-resolution on both posting paths (presence and lock order); the reminder lease and delivery record; the dispatch seam; budget rollover claim and release; the 30-day claim sweep; the S06 manual fan-out.
- **Finding counts:** BLOCKER 0, HIGH 1 (A26-S08-01), MEDIUM 2 (A26-S08-02, -03), LOW 2 (A26-S08-04, -05).
- **Text for the ledger (orchestrator merges):**
  - Session status: S08 done; commit: the commit carrying this file; findings B/H/M/L 0/1/2/2; verdict REQUEST CHANGES.
  - Prior findings disposed (final): MON-H06 STILL_OPEN residual (A26-S08-01; core fix FIXED by execution P1, P1b, P5); MON-M25 claim half FIXED_VERIFIED (residual A26-S08-04); MON-L06 FIXED_VERIFIED (R1). A26-S02-04 superseded by A26-S08-01.
  - Suites: baseline integration 8 suites 45 passed; probes P1-P7, R1-R2 (scratch worktree); mutations M1-M3, M5-M7.
  - Undetected mutations: `INV-CRON-001 | job-claim.service.ts:146 drop expiry predicate | a real-database lease spec | S08`; `same | :144 drop delivered_at IS NULL | same | S08`; `same | :281 drop markDelivered token predicate | same | S08` (each caught only by SQL-text unit asserts); M1-M3 caught by unit only.
  - Open hypotheses handed on:
    - from S08 to S19: `PostTransactionDialog.tsx:433` pre-fills `nextOverride?.amount ?? scheduledTransaction.amount` (the forbidden shape) and sends it as `amount`; find a schedule kind whose echo is not re-priced server-side; and the client half of A26-S08-01 (pin in the dialog and the row menu).
    - from S08 to S15: A26-S08-03 starts from a settlement claim ahead of the cursor; check whether the slot selection should prefer the cursor's own unpaid slot over a later one; loan posting half of INV-LOAN-HISTORY-001 only checked for presence.
    - from S08 to S17: A26-S08-02's change makes `post()` resolve after a post-commit failure -- re-check the AI-action caller's outer transaction; MON-M25 provider half; `updates.service` window equal to its period; whether any `NotificationDispatchService.notify` caller runs inside an outer transaction (the fan-out would then send for a row that can still roll back); portfolio-movement baseline stored before the notify (a crash loses the alert).
    - from S08 to S11: email-receipt poll lease overrun and the 5-vs-15 provider-call budget in `docs/cron-jobs.md`.
    - from S08 to S21: A26-S08-05 (real `post()` integration harness, real lease spec) joins MON-M46; the cross-owner scheduled transfer posted by the cron under a single-owner `withUserContext` was not executed (S02's hypothesis); M5-M7 rows.
  - Deviations: "two processes" were run as two service instances in one Node process over separate pool connections with an explicit barrier (the property under test is PostgreSQL's, not the process's); the `job_claims` expiry in R2 was forced by setting the holder's own token GUC (the migration-143 trigger refused an untokenized update, which is itself evidence the fence works); the 40-row figure in the plan is 49; report written by S08 only, ledger/sessions/register left to the orchestrator.

## 13. Adversarial approval challenge

Assumption: "the occurrence protocol holds because the cron path is proven". Started from the abstractions, not the findings:

- **The occurrence key** `(schedule, original_due_date)`: asked who else writes it (the settlement rule) and whether every reader of the cursor knows. `post()`'s advance does not (A26-S08-03, executed).
- **The pin** `expectedDueDate`: searched every caller of `post()` and `skip()`; the two human routes have none (A26-S08-01, executed, including the exhausted-schedule case that turns a displacement into an extra payment).
- **The single transaction:** asked what runs after it and how its errors are reported (A26-S08-02, executed).
- **The lease:** asked what bounds the work against the TTL; the insight generation's provider budget exceeds it (A26-S08-04, executed); listed the same class elsewhere (section 9).
- **The delivery record:** asked whether a third replica after the winner finished re-sends (R1: no).
- **The cron classifier:** asked what "skipped" hides (section 9: any permanent refusal).
- **Undo (A26-S07-02) against the cursor:** the ordinary order is safe; the claim-without-action cases are not (section 9, not executed).

Not challenged: the investment and FX posting branches against PostgreSQL (stubbed in the probe), the AI-action and email-receipt callers' transactions, RLS enforcement under `monize_app` for the cron, E2E.

## 14. Verdict

`REQUEST CHANGES` for the slice: one HIGH (A26-S08-01) survived the challenge, executed. The cron's own exactly-once posting across replicas and the reminder delivery across replicas were demonstrated against PostgreSQL and hold.
