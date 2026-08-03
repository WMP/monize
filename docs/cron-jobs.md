# Cron Jobs

Cron jobs use the `@Cron()` decorator from `@nestjs/schedule`. They run in the API process (`ScheduleModule.forRoot()` in `backend/src/app.module.ts`); there is no separate scheduler process, and on k8s with more than one backend replica **every replica fires every cron**.

That last sentence is the whole reason this page has a fourth column. A cron with no durable coordination does not merely *risk* duplicate work under a rare timing race -- duplicating is its **normal** behaviour on any cluster with two replicas. The Phase 4 audit found five jobs in that state: duplicate reminder emails, duplicate AI provider calls, duplicate budget alerts, an emergency-access token overwritten by the second replica so the first contact's link was dead on arrival, and a scheduled bill posted twice.

## How a job coordinates

Pick one of these; do not invent a sixth. Anything held in process memory -- a `Set` of user ids, a boolean -- is **not** coordination: each replica has its own, so every replica passes. `backend/src/common/db/derived-state-writers.guard.spec.ts` fails on that shape.

| Mechanism | Use it for | Where |
|---|---|---|
| **Durable claim** (`JobClaimService.claimOnce`) | A delivery that must happen once per user per window: an email, a notice. Permanent -- nothing retakes it -- so a failed send calls `release` to hand the window back. | `backend/src/common/jobs/job-claim.service.ts` |
| **Durable lease** (`JobClaimService.claimLease`) | An exclusion: only one replica may do this at a time. Expires, so a replica killed mid-run does not lock the user out. | same |
| **Conditional state transition** | A flag the job itself owns: `UPDATE ... WHERE granted_at IS NULL ... RETURNING`. The predicate is re-evaluated after the row lock, so exactly one replica gets a row. | `emergency-access-monitor.service.ts` |
| **Unique key + `ON CONFLICT DO NOTHING RETURNING`** | A row whose existence *is* the fact: a posted occurrence, an alert fingerprint. The insert arbitrates and the loser gets nothing back. | migration `133` |
| **An idempotent predicate** | Nothing to coordinate: `DELETE ... WHERE expired`, or a recomputation that derives its answer from scratch. Two replicas race to do the same thing and the loser does nothing. | the sweeps below |

Reading the result of a guarded statement correctly is part of the mechanism, not a detail: a data-modifying `query` with `RETURNING` comes back as `[rows, rowCount]`, and on that tuple `result.length > 0` is always true. Use `affectedRowCount` / `returnedRows` from `backend/src/common/db/query-result.ts`, never an open-coded length check.

Every `@Cron` handler is also an out-of-request entry point, so its body must seed its own RLS context: the cross-user fan-out under `withSystemContext`, each per-user body under `withUserContext(userId)`. See `backend/CLAUDE.md`.

## The schedule

Grep `@Cron(` for the authoritative list. This table is kept in sync with it -- the audit's DOC-04-06 finding was that it had drifted, which made exactly the multi-replica review this page exists for harder than it needed to be.

| Service | Schedule | Purpose | Multi-replica coordination |
|---------|----------|---------|----------------------------|
| `accounts.service` | Hourly | Roll deferred balances into `current_balance` as transactions become due, per user timezone | Recomputes from scratch under an account row lock; safe to repeat |
| `action-history.service` | Daily 3 AM | Prune old undo/redo history | Idempotent predicate delete |
| `ai-usage.service` | Daily 4 AM | AI usage-log cleanup | Idempotent predicate delete |
| `ai-insights.service` | Daily 6 AM | Generate AI insights | **Durable lease** per user, plus the existing recent-insight cooldown |
| `attachment-orphan-sweeper.service` | Hourly | Delete external attachment objects whose metadata is gone | Tombstone rows; the provider's `delete` is idempotent |
| `auto-backup.service` | Hourly | Enrol every non-admin user on the default backup policy, then run the backups that are due | None yet -- see the Phase 3 findings on backup overlap |
| `bill-reminder.service` | Daily 8 AM | Bill payment reminders | **Durable claim** keyed on the local date plus a digest of the bills named |
| `budget-alert.service` | Daily 7 AM | Budget threshold alerts | **Unique fingerprint** on `budget_alerts`; only a returned insert emails |
| `budget-alert.service` | Mon 7 AM | Weekly budget digest | Read-only aggregation; duplicate sends possible, not yet claimed |
| `budget-alert.service` | Daily 3 AM | Prune old alerts | Idempotent predicate delete |
| `budget-period-cron.service` | 1st of month, midnight | Create new budget periods | `UNIQUE(budget_id, period_start)` |
| `demo-reset.service` | Daily 4 AM | Demo database reset | Demo mode only; see DR-04-06 |
| `demo-reset.service` | Every 3 hours | Demo intraday transaction generation | Demo mode only; see DR-04-06 |
| `emergency-access-monitor.service` | Daily 9 AM | Grant emergency access after inactivity; send reminders | **Conditional transition** on `granted_at` for the grant; **durable claim** per local date for the reminder |
| `exchange-rate.service` | 5:05 PM ET weekdays | Fetch exchange rates (staggered after the price refresh) | `UNIQUE` upsert on the rate row; duplicate provider calls possible |
| `holdings.service` | Hourly at :30 | Apply matured future-dated investment transactions to holdings | Full rebuild under the per-account holdings lock |
| `job-claim.service` | Daily 4 AM | Prune claim rows past their retention window | Idempotent predicate delete |
| `mny-import-job.service` | Every 5 min | Fail import jobs whose worker stopped heartbeating | Conditional state/time predicate |
| `mny-staging.service` | Hourly | Delete expired staged import files (24 h TTL) that no active job needs | Idempotent predicate delete |
| `mortgage-reminder.service` | Daily 8 AM | Mortgage renewal reminders | **Durable claim** keyed on the local date plus a digest of the mortgages named |
| `scheduled-transactions.service` | Hourly at :05 | Post due recurring transactions | **Occurrence key** `(scheduled_transaction_id, original_due_date)`; the loser's `ConflictException` is a skip, not an error |
| `scheduled-transactions.service` | 5:25 PM ET weekdays | Re-derive the account-currency estimate on foreign-currency schedules from the rates the 5:05 PM refresh just stored | Absolute recomputation; safe to repeat |
| `security-price.service` | 5 PM ET weekdays | Fetch security prices | `UNIQUE(security_id, price_date)`; duplicate provider calls possible |
| `token.service` | Daily 3 AM | Purge expired/revoked refresh tokens | Idempotent predicate delete |
| `updates.service` | Every 12 hours | Check for a newer Monize release | Read-only external check |

Four rows above say coordination is still missing: `auto-backup`, the weekly digest, and the two provider refreshes. Those are known -- the backup one as a Phase 3 finding, the provider ones as duplicate *external calls* rather than duplicate persisted rows, and the digest as a duplicate email nobody has claimed yet. Do not read their presence as permission to add a sixth uncoordinated job.
