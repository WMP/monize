# Hold push delivery across a sign-out

Design for keeping a browser's push subscription when its account signs out,
with the server holding delivery to that device until the same account signs
in on it again. The task list is
[`push-hold-on-sign-out-tasks.md`](./push-hold-on-sign-out-tasks.md).

Status: **decisions agreed** in issue #1630 (2026-10-09): skip rather than
queue (decision 1), only the header sign-out holds (decision 7), and a 15-day
`HELD_DEVICE_RETENTION_DAYS`. Implementation waits for the `approved-to-build`
label on that issue (`CONTRIBUTING.md`). It changes push behaviour on both
layers and adds a column, so it lands as one PR whose commits follow the task
list.

## 1. What happens today

Read from the code on 2026-10-09.

- **Sign-out releases both halves.** `AppHeader.handleLogout` calls
  `releasePushForSignOut` (`frontend/src/lib/push.ts`) before
  `authApi.logout()`. Within `SIGN_OUT_PUSH_RELEASE_TIMEOUT_MS` (1.5 s) it
  finds this browser's row by endpoint fingerprint, deletes it
  (`DELETE /push/subscriptions/:id`), then unsubscribes the browser and clears
  the marker (`releaseLocalPushSubscription` -> `forgetRegisteredEndpoint`).
- **Account deletion** (`DangerZoneSection`) calls the same function.
- **A session that merely expires** (the 401 interceptor in `lib/api.ts`, the
  rehydrate failure in `authStore`, the PWA resume path in
  `PwaLifecycleHandler`) calls the store's `logout()` only and leaves push
  alone. The comment in `AppHeader.handleLogout` gives the reason: a timeout
  is not someone handing the browser over.
- **The marker already names the owner.** `monize.push.registeredEndpoint`
  stores `{ userId, fingerprint }` (`rememberRegisteredEndpoint`), and
  `classifyPushRegistration` reads a marker written by another account as
  `foreign`. Sign-out already skips a subscription whose marker names
  somebody else.
- **The server has no notion of a signed-out device.** A row is live while
  `disabled_at IS NULL`. `sendToUser` and `sendTest` select exactly that
  (`PushSubscriptionService`), so every live row receives every push.

So for the user the cost is this: each sign-out wipes the device. Signing back
in leaves push off on that browser until they find Enable again, in the banner
or in Settings. The browser permission is still granted, so nothing prevents an
automatic resume. The subscription was simply thrown away.

## 2. What changes

| Moment | Today | After |
|---|---|---|
| Sign-out from the header | Row deleted, browser unsubscribed, marker cleared | Row **held**, browser subscription kept, marker kept and flagged `held` |
| Sign-out where the hold cannot be confirmed (error, older backend, delegate context) | as above | Falls back to today's release, in full |
| Delivery to a held row | n/a | Skipped by `sendToUser` and `sendTest` |
| Same account signs in on that browser | Push is off until Enable is clicked | The subscription is re-posted, the hold clears, and delivery resumes with no prompt |
| A different account signs in | Clean browser; the banner offers Enable | The marker reads `foreign` and the banner offers Enable. Enabling takes the existing 409 path: unsubscribe, then subscribe fresh. The first account's held row stays until the sweep removes it |
| Account deletion | Full release | **Unchanged**: full release |
| Session expiry | Push left alone, still delivering | **Unchanged** |
| A held row nobody resumes | n/a | Deleted by the daily sweep after `HELD_DEVICE_RETENTION_DAYS` (15) |

## 3. Product decisions

1. **"Hold" means skip, not queue.** Pushes for a held device are not sent and
   not stored for later. Every notification already has its row in the
   notification centre (`NotificationService.create` writes the row before any
   push is dispatched), so the bell shows what was missed when the user signs
   back in. Queueing would mean replaying stale alerts in a burst, adding a
   second store whose lifecycle PostgreSQL cannot roll back, and deciding
   which of them still matter. Agreed in #1630; a queue, if ever wanted, is a
   separate proposal.
2. **The hold is a column, not a disable.** `disabled_at` means the endpoint
   is dead and the user has to repair it. A held endpoint is healthy and needs
   nothing from the user. Reusing `disabled_reason` would show a repair message
   on a device that needs none, and it would put the row in the 30-day purge of
   retired devices. So a new nullable `held_at TIMESTAMP` is added, and a row
   is deliverable when `disabled_at IS NULL AND held_at IS NULL`.
3. **Release unless the hold is confirmed.** If the hold has not been
   confirmed, sign-out releases exactly as it does today. A subscription that
   stays in the browser while the server does not know it is held would keep
   showing the departing account's notifications to whoever uses the browser
   next. That is the defect today's release exists to prevent, so the new path
   may only skip the release when the server has confirmed the hold. An older
   backend answers the new route with 404, and that also falls through to the
   release.
4. **Resume is a re-registration.** The existing `POST /push/subscriptions`
   upsert, run for the same user, gains `held_at = NULL` on its `DO UPDATE`
   arm. No second write path exists, so the cap check, the key check, the
   in-transaction refusals and INV-PUSH-001's ownership guard all apply to a
   resume unchanged. A held row the sweep has already deleted is simply
   inserted again.
5. **Held rows count against `MAX_LIVE_DEVICES_PER_USER`.** They are real
   devices that will resume, and leaving them out of the count would let a
   resume fail on the cap with no explanation.
6. **The device list shows the hold.** "Signed out on this device. Push resumes
   when you sign in here again." The user can still Remove the row, and it
   behaves like any other device.
7. **Only the header sign-out holds.** Account deletion keeps the full release
   (a downgraded account's row would otherwise sit held for 15 days with no
   way to resume). Session expiry stays as it is.
8. **Delegate context falls back.** `PushController` is `@OwnerOnly()`. A
   sign-out while acting as an owner gets a 403 on the hold. Under decision 3
   that is the same fallback as any other refusal, so the full release runs.
   Today's code fails at the list step in that context too.

## 4. Backend

### 4.1 Schema

One expand-only migration, `YYYYMMDDHHMMSS_push_subscriptions_held_at.sql`:

```sql
-- A push device whose account signed out of this browser. Delivery skips it
-- until the same account signs in there again (the subscribe upsert clears it).
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS held_at TIMESTAMP;
```

`database/schema.sql` changes in the same commit, with the comment above.
`push_subscriptions` is already excluded from backups (INV-PUSH-005) and from
the support backup, and the table is already in the RLS direct bucket. A new
nullable column needs no policy, no backup classification and no index change.
`idx_push_subscriptions_user_live` stays as it is; the extra predicate filters
within the user's handful of rows.

During a rolling deploy, a pod still on the previous release ignores
`held_at`. It delivers to held rows and does not clear the column on
subscribe. Both effects end when the rollout finishes, and neither one
writes anything incorrect.

### 4.2 Entity and DTO

- `PushSubscription.heldAt: Date | null` (`held_at`).
- `PushDeviceDto.heldAt: string | null`, filled in by `toDeviceDto`.

### 4.3 `PushSubscriptionService`

- **`hold(userId, id)`**, one statement inside `withScopedDb`:

  ```sql
  UPDATE push_subscriptions
     SET held_at = CURRENT_TIMESTAMP
   WHERE id = $1 AND user_id = $2 AND disabled_at IS NULL
  ```

  It returns 404 (`errors.push.deviceNotFound`) when no row matches, so a
  retired or foreign row cannot be held and the client falls back to release.
  Holding a row that is already held only moves `held_at`, so a repeat call
  is harmless.
- **`claimEndpointForCaller`**: `held_at = NULL` is added to the `DO UPDATE`
  arm beside `disabled_at = NULL`. The arm's existing
  `WHERE push_subscriptions.user_id = EXCLUDED.user_id` is what keeps another
  account's resume from clearing this hold.
- **`sendToUser` and `sendTest`**: their target queries add
  `heldAt: IsNull()`. `sendTest` with only held devices answers the existing
  `errors.push.noDevices`, and that is accurate: no device this account is
  signed in on can receive.
- **`purgeRetiredDevices`** gains a second `DELETE` in the same transaction
  and the same `withSystemContext` (so `WITH_CONTEXT_ALLOWLIST` is unchanged):

  ```sql
  DELETE FROM push_subscriptions
   WHERE held_at IS NOT NULL AND held_at < $1
  ```

  This uses `HELD_DEVICE_RETENTION_DAYS = 15`, exported beside
  `RETIRED_DEVICE_RETENTION_DAYS`. Deleting the row loses nothing: a later
  resume inserts it again.

`PushConfigService.getAdminConfig` keeps counting held rows as live. The
admin counts say how many devices exist, and a held device still exists.

### 4.4 Route

```text
POST /push/subscriptions/:id/hold     204
```

The route goes on `PushController` with `ParseUUIDPipe`, `@DemoRestricted()`
and `@Throttle({ default: { ttl: 60_000, limit: 20 } })`, the same as the
other writes in the module. `push-route-throttle.spec.ts` scans for both.

## 5. Frontend

### 5.1 `lib/push.ts`

- **The marker gains `held: boolean`.** `rememberRegisteredEndpoint` writes
  `held: false`, and a new `markRegisteredEndpointHeld()` rewrites the stored
  marker with `held: true`. `readRegisteredEndpoint` reads a missing `held` as
  `false`, so a marker written before this change still reads as it did.
  `classifyPushRegistration` ignores the field.
- **`pushApi.holdDevice(id, options?)`** -> `POST /push/subscriptions/:id/hold`.
- **`holdPushForSignOut(timeoutMs = SIGN_OUT_PUSH_RELEASE_TIMEOUT_MS)`** takes
  `releasePushForSignOut`'s place in `AppHeader` only. Inside the same race
  against the bound:
  1. If the marker is foreign, return without acting (the current rule).
  2. Find this browser's row by fingerprint (`listDevices(BEST_EFFORT)`).
  3. If there is a row, call `holdDevice(row.id, BEST_EFFORT)`. When it
     resolves, call `markRegisteredEndpointHeld()` and return without
     unsubscribing.
  4. With no row, or with any error in steps 2-3, run today's
     `removeThisBrowsersRegistration` (decision 3).

  If the bound elapses, the result is the same as today: whatever has not
  finished is abandoned.
- **`releasePushForSignOut`** is unchanged and stays the account-deletion path.
- **`resumePushAfterSignIn(publicKey)`** never throws. It acts only when all
  of the following hold:
  - the marker is `held`;
  - `marker.userId` is the signed-in user;
  - `Notification.permission === 'granted'`;
  - the browser holds a subscription.

  Then:
  1. If the subscription's key does not match `publicKey`
     (`keyMatches`), the instance rotated while the user was signed out.
     Release locally and stop: the server row is already `KEY_ROTATED`, and
     the panel's Enable is the repair, as it is today.
  2. Post the subscription (`postSubscription`, which rewrites the marker with
     `held: false`).
  3. If the current fingerprint differs from `marker.fingerprint`, the push
     service rotated the endpoint during the hold. Call
     `retireServerRowFor(marker.fingerprint)` after the post. This is the same
     repair `PushDevicesPanel` makes for `rotated`.
  4. On a 409 `pushEndpointClaimed`, or on any other refusal, release
     locally. A browser should not hold a subscription the server will not
     deliver to.

  When permission is no longer `granted`, it releases locally and calls
  `retireServerRowFor(marker.fingerprint)`. The subscription cannot be shown,
  and the held row would otherwise wait the full 15 days.

### 5.2 Where resume runs

A new hook, `usePushResumeOnSignIn`, is mounted in `SwipeShell` beside
`PushEnableBanner`, which is the authenticated shell that every sign-in path
(password, 2FA, OIDC, passkey) lands in. It runs at most once per `user.id` per
page lifetime. It reads the marker first and makes no request unless the
marker is `held` and names the reader, so an ordinary page load costs nothing.
After a successful resume it calls `notifyPushDevicesChanged()` so the matrix
and the banner re-read.

`PushEnableBanner` computes `registeredHere` before the resume can land. To
avoid a flash of "Enable notifications" on the first page after sign-in, the
banner treats a `held` marker naming the reader as "not yet known" (`null`)
until the resume settles. The same `notifyPushDevicesChanged` event clears it.

### 5.3 Settings

- `PushDevicesPanel` renders `heldAt` as its own state (decision 6) with new
  keys under `settings.notifications.push.devices`. A held row is neither
  "active" nor retired.
- A held row of this browser's own fingerprint counts as registered in
  `registeredHere`: the user is signed in, so the hook resumes it, and
  offering Enable would duplicate that work.
- `PushDiagnostics` adds one line, `marker.held`.
- `NotificationPreferencesMatrix` gates its push columns on a live device. A
  held device counts as one, because notifications will reach it once the
  account signs in there.

## 6. Invariants

- **INV-PUSH-011 (new)**: *A held device receives nothing until its own
  account resumes it.* Source of truth: `push_subscriptions.held_at`.
  Enforcement:
  - the `held_at IS NULL` predicate in both fan-out queries;
  - the cleared hold only on the same-user upsert arm;
  - the client releasing whenever the hold is unconfirmed.

  Required tests: those in task Q1, and the frontend truth table in F1.
- **INV-PUSH-001**: its *Failure response* paragraph says that logout
  releases the endpoint. That changes to: logout holds it, and the release
  is the fallback. The other paragraphs are unchanged.
- **INV-PUSH-004**: unaffected. A held row is never attempted, so it can
  never be counted as failing.

## 7. What this does not do

- It does not touch session expiry. A browser whose session simply lapses
  keeps delivering, as it does today. Holding on expiry would need the server
  to know which refresh-token family a device belongs to, and that is a
  separate proposal.
- It does not let an administrator hold or release devices (discussion #1291
  stands).
- It does not change the service worker. Nothing is delivered to a held
  device, so `sw.js` has nothing to suppress.
  `e2e/push/notifications.spec.ts` covers the worker alone and needs no new
  case.

## 8. Risks

- **A sign-out that races a fan-out.** `sendToUser` may already have read the
  row when the hold commits. That one in-flight push still arrives. The window
  is one fan-out, it is the same window as today's delete, and closing it
  would mean locking every delivery against sign-out.
- **A shared browser.** After A signs out, the browser still holds A's
  subscription. If B signs in and clicks Enable, the existing 409 path replaces
  it, because the platform allows one subscription per origin. A's row stays
  held, undeliverable and visible in A's device list until the sweep removes
  it. This is the same outcome as today's
  "session ended without a logout" case, and it is bounded by the sweep.

## 9. Assumptions a fresh session should check

- `releasePushForSignOut` is called from exactly `AppHeader` and
  `DangerZoneSection` (`grep -rn releasePushForSignOut frontend/src`).
- `PushEnableBanner` is mounted only in `SwipeShell`, and `SwipeShell` renders
  only for an authenticated user.
- No other backend query selects push rows for delivery. Today that means
  `sendToUser` and `sendTest` in `push-subscription.service.ts`; check
  `grep -rn "PushSubscription" backend/src --include=*.ts` outside specs.
