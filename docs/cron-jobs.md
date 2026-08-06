# Cron Jobs

Cron jobs use the `@Cron()` decorator from `@nestjs/schedule`. They run in the API process (`ScheduleModule.forRoot()` in `backend/src/app.module.ts`); there is no separate scheduler process, and on k8s with more than one backend replica **every replica fires every cron**.

That last sentence is the whole reason this page has a fourth column. A cron with no durable coordination does not merely *risk* duplicate work under a rare timing race -- duplicating is its **normal** behaviour on any cluster with two replicas. The Phase 4 audit found five jobs in that state: duplicate reminder emails, duplicate AI provider calls, duplicate budget alerts, an emergency-access token overwritten by the second replica so the first contact's link was dead on arrival, and a scheduled bill posted twice.

## How a job coordinates

Pick one of these; do not invent a sixth. Anything held in process memory -- a `Set` of user ids, a boolean -- is **not** coordination: each replica has its own, so every replica passes. `backend/src/common/db/derived-state-writers.guard.spec.ts` fails on that shape.

| Mechanism | Use it for | Where |
|---|---|---|
| **Durable claim** (`JobClaimService.claimOnce`) | Work where the claim row *is* the fact and nothing leaves the database: a posted occurrence, an alert fingerprint. Permanent -- nothing retakes it -- so a failure calls `releasePermanentClaim` to hand the window back. **Not** for a send: see "A claim is not a delivery record" below. | `backend/src/common/jobs/job-claim.service.ts` |
| **Durable lease** (`JobClaimService.claimLease`) | An exclusion: only one replica may do this at a time. Expires, so a replica killed mid-run does not lock the user out. Returns a **lease token** identifying the winning attempt, which `markDelivered` and `releaseLease` require -- see "A lease is held by an attempt" below. Pair it with a **delivery record** (`markDelivered`/`wasDelivered`, or a column the domain already has) whenever the work leaves the database. | same |
| **Conditional state transition** | A flag the job itself owns: `UPDATE ... WHERE granted_at IS NULL ... RETURNING`. The predicate is re-evaluated after the row lock, so exactly one replica gets a row. | `emergency-access-monitor.service.ts` |
| **Unique key + `ON CONFLICT DO NOTHING RETURNING`** | A row whose existence *is* the fact: a posted occurrence, an alert fingerprint. The insert arbitrates and the loser gets nothing back. | migration `136` |
| **An idempotent predicate** | Nothing to coordinate: `DELETE ... WHERE expired`, or a recomputation that derives its answer from scratch. Two replicas race to do the same thing and the loser does nothing. | the sweeps below |

### A claim is not a delivery record

A claim answers "may I do this now". It cannot also answer "has this been done",
because the second question has to outlive the process that asked the first. A
claim taken *before* a send and treated as the record of it is consumed by a
replica that dies before sending, and the work is then owed forever with nothing
able to notice -- the FV4-004 and FV4-005 findings, in a grant that marked an
account granted with nobody holding a link, and a reminder that spent the day and
sent nothing.

So a job that delivers something keeps two pieces of state:

- **the claim** -- a `claimLease`, or a conditional transition. A lease, not a
  permanent `claimOnce`, wherever a crash between claiming and sending is
  possible: an expiring exclusion costs a retry window, a consumed permanent
  claim costs the delivery.
- **the delivery record** -- written *after* the send succeeds, and re-read under
  the claim to decide whether the work is still owed. `last_reminder_sent_at` for
  the reminder; `emergency_access_contacts.notified_grant_generation`, per
  contact, for the grant.

Per recipient where the retry would otherwise re-issue a credential: sending a
second emergency-access link invalidates the first, and a dead link during a
recovery is indistinguishable from a revoked one. Prefer to *derive* the
outstanding work from the delivery record -- "a granted owner with an un-notified
contact is a link owed" -- rather than scheduling a retry, for the same reason the
stale-snapshot sweep derives its work: nothing has to remember to enqueue
anything.

`claimOnce` remains correct where nothing is delivered outside the database, or
where the claim itself *is* the record of the fact (a posted occurrence, an alert
fingerprint). The bill and mortgage reminders were the last two sends still using
it, and they now take a lease plus `job_claims.delivered_at` (audit RV4-006).

### A delivery record is scoped to the occasion, not to the row

A record that answers "has this been done" has to say **which** doing it means, or
the first one disables every later one. `emergency_access_contacts.claim_notified_at`
was the grant's pending predicate and no path ever cleared it, so emergency access
fired at most once per contact row for the row's lifetime: the owner returns,
`revokeAfterReturn` clears `granted_at`, and the next inactivity period finds nobody
owed and grants nothing -- silently, with the settings page still reporting the
feature as armed (audit RRV4-004).

The instinct is to clear the marker wherever monitoring is re-armed. There were five
such paths in three files, and a missed one is invisible, so the state is
**generational** instead: `emergency_access_settings.grant_generation` is advanced by
the single statement that transitions ungranted to granted, and a contact is owed a
link whenever its `notified_grant_generation` differs. No re-arm path has to know
anything -- it clears `granted_at`, and the next grant's number is simply past
whatever the contacts hold. `claim_notified_at` survives as a timestamp for
operators, written by the same statement, and is no longer read as a predicate.

The one reset a generation cannot derive is a **corrected contact address**: the
owner's cycle has not moved, so `updateContact` clears that contact's marker
explicitly when the email changes.

### A lease is held by an attempt

`(claim_type, user_id, claim_key)` names the *work*. It does not name the holder, so
a worker delayed past its own expiry -- a long GC pause, a stalled SMTP connect --
could come back and write against a lease another replica had already retaken: its
`release` deleting the live lease, leaving the replica actually sending with no
exclusion, or its `markDelivered` recording a delivery for a send that replica had
not finished, so a genuine failure there would never be retried (audit DR-RRV4-01).

`claimLease` therefore mints a `lease_token` per attempt and returns it. Carry it
into `markDelivered` and `releaseLease`; both compare it, and a `markDelivered`
that matches nothing logs and records nothing, so the work stays owed and is
re-sent -- the at-least-once side of the trade, and the correct one. A permanent
`claimOnce` row, whose claim is the fact itself and has no attempt to identify,
goes back through `releasePermanentClaim` -- a separate method, so the compiler
refuses a lease caller that forgot its token instead of letting it silently
bypass the ownership predicate.

The token's `WHERE` clause protects new code from new code. It does nothing about a
**previous-release** pod during a rolling deploy, whose untokenized release/`markDelivered`
name the work and carry no token -- so lease ownership is also enforced in the
database (migration 139): the new writes declare their token in the transaction-local
`app.job_claim_lease_token` GUC, and a trigger rejects any mutation of a *live
tokenized* lease whose token the session does not hold. The old binary never sets the
GUC, so it cannot delete or mark a lease this deployment retook. Expired leases,
permanent `claimOnce` rows and delivered rows are outside the trigger's WHEN, so
retakes and the retention sweep are unaffected.

### The delivery contract, stated

SMTP and PostgreSQL cannot commit together, so every send has to pick one of these
deliberately rather than end up with whichever one the code happens to implement:

| Job | Contract | Why |
|---|---|---|
| bill reminder, mortgage renewal | **at-least-once** | A process killed after the provider accepted but before `delivered_at` committed re-sends next run. A duplicate nudge is an annoyance; a missed mortgage renewal is not. |
| emergency-access grant | **at-least-once, same credential while it is valid** | A retry re-sends the token already issued rather than minting one: a new token invalidates the link that may already be in the recipient's inbox, and a dead emergency-access link during a recovery cannot be told from a revoked one. The raw token is held encrypted only while the notice is owed, and cleared in the statement that records delivery. Reuse ends at the token's stored expiry: an expired credential is worth nothing to anyone, so it is rotated rather than delivered, and the email always states the expiry the database will enforce (audit RRV4-005). |
| emergency-access reminder | **at-least-once** | Same shape as the bill reminder, with `last_reminder_sent_at` as the record. |
| budget alert | **at-most-once** | The alert row's unique fingerprint is both the coordination and the record, and only a returned insert emails. A lost row is a lost alert, acceptable for a threshold notice that re-evaluates daily. |

Where a job is at-least-once its content has to read correctly when it arrives
twice. Where it is at-most-once the loss window belongs in this table rather than
in somebody's head.

One historical exception, decided rather than discovered: reminder claims written
*before* migration 137 recorded only the intent to send, so a delivery lost in the
old claim-before-send crash window cannot be told from one that succeeded. The
migration backfills them as delivered, which keeps any such loss lost rather than
re-sending to every user whose reminder did arrive. The trade and why it was taken
in that direction are written out in `database/migrations/137_job_claim_delivery_record.sql`;
it is bounded to rows predating that migration and does not recur.

Reading the result of a guarded statement correctly is part of the mechanism, not a detail. TypeORM's shape depends on the statement's command tag rather than on its `RETURNING` clause: `UPDATE` and `DELETE` come back as the tuple `[rows, rowCount]` with or without one, and everything else -- `INSERT` included -- comes back as bare rows. On the tuple `result.length > 0` is always true, so a `length === 0` branch beside an `UPDATE ... RETURNING` is dead code. Use `affectedRowCount` / `returnedRows` from `backend/src/common/db/query-result.ts`, which are correct for every shape, and never an open-coded length check.

Every `@Cron` handler is also an out-of-request entry point, so its body must seed its own RLS context: the cross-user fan-out under `withSystemContext`, each per-user body under `withUserContext(userId)`. See `backend/CLAUDE.md`.

## The schedule

Grep `@Cron(` for the authoritative list. This table is kept in sync with it -- the audit's DOC-04-06 finding was that it had drifted, which made exactly the multi-replica review this page exists for harder than it needed to be.

| Service | Schedule | Purpose | Multi-replica coordination |
|---------|----------|---------|----------------------------|
| `accounts.service` | Hourly | Roll deferred balances into `current_balance` as transactions become due, per user timezone | Recomputes from scratch under an account row lock; safe to repeat |
| `action-history.service` | Daily 3 AM | Prune old undo/redo history | Idempotent predicate delete |
| `ai-usage.service` | Daily 4 AM | AI usage-log cleanup | Idempotent predicate delete |
| `ai-insights.service` | Daily 6 AM | Generate AI insights | **Durable lease** per user, plus the existing recent-insight cooldown |
| `attachment-orphan-sweeper.service` | Hourly | Delete external attachment objects whose metadata is gone, and objects from uploads that never committed | Tombstone rows -- written by a trigger on deletion, and by the uploader as an intent before the put. **Conditional claim** on `swept_at` before the external delete, which the uploader's intent-clear is fenced against, so metadata can never commit pointing at deleted bytes; a live `upload_lease_expires_at` also keeps the sweep off an upload that is probably still running. A claimed *intent* is then retained for `late_write_quarantine_until` and re-swept, because the claim settles metadata and not bytes: a put that stalled past its lease can land after the delete, and the row is the only thing that would name those bytes (audit RRV4-002). The quarantine is DB-enforced (migration 144 triggers) so a previous-release sweeper cannot bypass it during a rollout, and the S3 provider bounds each request below the window so a put cannot land after it (V4R3-003). The provider's `delete` is idempotent |
| `auto-backup.service` | Hourly | Enrol every non-admin user on the default backup policy, then run the backups that are due | **Conditional transition**: the claim is the `next_backup_at` advance itself |
| `bill-reminder.service` | Daily 8 AM | Bill payment reminders | **Durable lease** keyed on the local date plus a digest of the bills named, plus `job_claims.delivered_at` written after the send. At-least-once |
| `budget-alert.service` | Daily 7 AM | Budget threshold alerts | **Unique fingerprint** on `budget_alerts`; only a returned insert emails |
| `budget-alert.service` | Mon 7 AM | Weekly budget digest | Read-only aggregation; duplicate sends possible, not yet claimed |
| `budget-alert.service` | Daily 3 AM | Prune old alerts | Idempotent predicate delete |
| `budget-period-cron.service` | 1st of month, midnight | Close expired budget periods and open the next | Period row locked `FOR UPDATE` before the actuals are read; the next period's insert is `ON CONFLICT DO NOTHING` on `UNIQUE(budget_id, period_start)` |
| `demo-reset.service` | Daily 4 AM | Demo database reset | **Durable lease** on the demo user; a wipe-and-reseed cannot be repaired by repeating |
| `demo-reset.service` | Every 3 hours | Demo intraday transaction generation | **Durable claim** per date+hour window; the generator is seeded by the window, so every replica produces identical rows |
| `emergency-access-monitor.service` | Daily 9 AM | Grant emergency access after inactivity; send reminders | **Conditional transition** on `granted_at`, which also advances `grant_generation`, plus a per-contact `notified_grant_generation` delivery record for the grant (forward-only, and a migration-147 trigger backfills a previous-release acknowledgement into the current generation so a rollout cannot rotate a delivered link), whose credential is reused on retry while it is unexpired; **durable lease** plus `last_reminder_sent_at` for the reminder. The daily check is skipped when `AI_ENCRYPTION_KEY` is absent, since grant delivery cannot encrypt a token without it (V4R3-002) |
| `exchange-rate.service` | 5:05 PM ET weekdays | Fetch exchange rates (staggered after the price refresh) | `ON CONFLICT DO UPDATE` on `UNIQUE(from_currency, to_currency, rate_date)`, both directions in one transaction; duplicate provider calls possible |
| `holdings.service` | Hourly at :30 | Apply matured future-dated investment transactions to holdings | Full rebuild under the per-account holdings lock |
| `job-claim.service` | Daily 4 AM | Prune claim rows past their retention window | Idempotent predicate delete |
| `net-worth.service` | Every 30 min | Recompute snapshots that fell behind their account | Idempotent predicate: the staleness is derived from `accounts.updated_at` vs the account's newest snapshot, so two replicas recompute the same accounts under the per-account lock |
| `mny-import-job.service` | Every 5 min | Fail import jobs whose worker stopped heartbeating | Conditional state/time predicate, and it **revokes the worker's `attempt_token`** -- reaping decides a worker is dead, the token is what stops it committing anyway |
| `mny-staging.service` | Hourly | Delete expired staged import files (24 h TTL) that no active job needs | Idempotent predicate delete |
| `mortgage-reminder.service` | Daily 8 AM | Mortgage renewal reminders | **Durable lease** keyed on the local date plus a digest of the mortgages named, plus `job_claims.delivered_at` written after the send. At-least-once |
| `scheduled-transactions.service` | Hourly at :05 | Post due recurring transactions | **Occurrence key** `(scheduled_transaction_id, original_due_date)`; the loser's `ConflictException` is a skip, not an error |
| `scheduled-transactions.service` | 5:25 PM ET weekdays | Re-derive the account-currency estimate on foreign-currency schedules from the rates the 5:05 PM refresh just stored | Absolute recomputation; safe to repeat |
| `security-price.service` | 5 PM ET weekdays | Fetch security prices | `ON CONFLICT DO UPDATE` on `UNIQUE(security_id, price_date)`, with `COALESCE` so a provider that omits a field keeps the stored one; duplicate provider calls possible |
| `token.service` | Daily 3 AM | Purge expired/revoked refresh tokens | Idempotent predicate delete |
| `updates.service` | Every 12 hours | Check for a newer Monize release | Read-only external check |

Three rows above say coordination is still missing: the weekly budget digest and the two provider refreshes. Those are known -- the provider ones as duplicate *external calls* rather than duplicate persisted rows (the row each one writes is uniquely keyed), and the digest as a duplicate email nobody has claimed yet. Do not read their presence as permission to add a fourth uncoordinated job.

## Work fired after a commit is not delivered

A `setTimeout` scheduled after a write is a latency optimization, never a
guarantee: the process holding it can be killed, and the callback can throw. Both
leave derived state disagreeing with the ledger with only a `warn` to show for it,
and nothing that will ever notice (audit DR-04-03).

A durable work queue does not fix it on its own -- the crash that loses the timer
loses the enqueue too, unless the enqueue joins the transaction that made the
work necessary, which means every write path has to know about every derived
result. So prefer **deriving** the staleness: give the derived rows a
`computed_at` (or rebuild them wholesale so their `updated_at` is one), and let a
sweep compare that against a timestamp the source keeps for its own reasons.
`NetWorthService.sweepStaleSnapshots` does exactly this -- every write that can
change a monthly snapshot also moves the account's `current_balance` in the same
transaction, so `accounts.updated_at` is the source timestamp, and an account
newer than its own snapshots by more than the debounce-plus-grace was missed.

The sweep is bounded (`STALE_SWEEP_BATCH`) and says when it truncates, because a
capped pass that logs nothing reads as "all caught up".

## Do not derive from a dataset that is being replaced

Three operations replace everything a user owns: a backup restore, the
self-service delete-my-data, and a `.mny` import started with
`wipeExistingData`. Restore and delete are one transaction each, so a concurrent
reader sees the before or the after. The `.mny` import is **not**: its wipe
commits and the rows arrive over the following minutes, so for the length of the
import the dataset is legitimately empty.

`UserMaintenanceService` (`backend/src/common/jobs/user-maintenance.service.ts`)
is how anything else finds out:

- **`withMaintenanceLease(userId, operation, fn)`** for an operation that must
  not overlap another. Refuses with a `409` before `fn` writes anything. An
  active `import_jobs` row counts as maintenance without a lease of its own --
  the row already is the fact.
- **`isUnderMaintenance(userId)`** for work that is merely pointless or harmful
  during the window and can happen later. The hourly `auto-backup` consults it
  and defers *without claiming*, so `next_backup_at` stays in the past and the
  next hour retries. Backing up mid-import would save the empty dataset as
  today's file and then enforce retention -- rotating the last good backup out to
  make room for one containing nothing.

The `.mny` importer's own wipe passes `initiator: "mny-import"` to
`UsersService.deleteData` so it does not take the lease: the import slot it
already holds is that wipe's exclusion, and taking the lease would have it refuse
on its own in-flight job.

## Schema bootstrap is not a cron, and it races the same way

`db-init` and `db-migrate` run once per container start rather than on a schedule, but on a multi-replica rollout every replica runs them at the same moment and each is a check-then-act -- "does `users` exist" then apply `schema.sql`, "which migrations are recorded" then apply the rest. Both take one session-level advisory lock (`backend/src/common/db/bootstrap-lock.ts`) around the whole check-and-act, so the loser waits and then finds the work already done instead of dying on `duplicate_table` or the `schema_migrations` primary key and reporting a crash-loop for what is a race.
