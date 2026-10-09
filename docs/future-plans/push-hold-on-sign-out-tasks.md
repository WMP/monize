# Push Hold on Sign-out: Agent Task List

> Companion to [`push-hold-on-sign-out.md`](./push-hold-on-sign-out.md) (the design). The feature ships as **one PR**; each task below is one commit in it, in this order. Mark a task done by checking its box.

## How to use this list (read first, every session)

- **One task per commit.** Each task lists its files. Touching files outside the task's scope is a scope violation: stop and leave a note instead.
- **The governing rule applies to every task:** a browser that has signed out either has its server row held, or has its subscription released. If the client cannot confirm the hold, the release runs (design decision 3). A commit that can leave a subscription delivering to a signed-out browser is off the plan.
- **Order matters for the deploy.** The backend tasks and F2 change nothing a user sees until F1 starts holding. F1 adds the hold and the resume in the same commit, so the PR never holds a device with no way to resume it.
- **Definition of done for every task** (in addition to per-task acceptance):
  - `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck`, `npm run test:changed`; plus `npm run build && npm run test:integration` when a query, the entity or the migration changed; `npm run migration:lint:test && npm run migration:lint` for B1.
  - `frontend/`: `npm run lint && npm run type-check && npm run i18n:check`, `npm run test:changed`, `npm run build`.
  - Database: `scripts/verify-schema.sh`, `node scripts/check-migration-prefixes.mjs`.
  - Stage new files before running a guard (`git add -N` is enough).
  - New user-facing strings: English catalogs only, then `npm run i18n:pseudo`. The full-locale pass is Q2.
- **Terminology:** "the design" = `push-hold-on-sign-out.md`. Section references point there. Re-locate code by symbol, never by line.

## Task graph

| ID | Task | Depends on | Deploy impact | Status |
|----|------|-----------|---------------|--------|
| S1 | Issue #1630 agreeing the design; label `approved-to-build` | -- | none | [ ] |
| B1 | Migration + `schema.sql`: `push_subscriptions.held_at`; entity field | S1 | inert | [x] |
| B2 | Service: `hold`, upsert clears `held_at`, fan-outs skip held rows, sweep, `heldAt` on the DTO; route `POST /push/subscriptions/:id/hold` | B1 | inert | [x] |
| F2 | Settings: held state in `PushDevicesPanel`, `PushDiagnostics` line, matrix counts held as live; `PushDevice.heldAt` type | B2 | inert | [x] |
| F1 | `lib/push.ts`: marker `held`, `holdDevice`, `holdPushForSignOut`, `resumePushAfterSignIn`; `usePushResumeOnSignIn` in `SwipeShell`; `AppHeader` switches to the hold; banner waits on a held marker | B2, F2 | **live** | [x] |
| Q1 | Integration spec: hold and resume under RLS enforcement | B2 | none | [x] |
| D1 | `docs/system-invariants.md` INV-PUSH-011 + INV-PUSH-001 failure paragraph; `docs/frontend/pwa-push-share.md`; `docs/backend/notifications-and-push.md` | F1 | none | [x] |
| Q2 | Full-locale i18n pass (final commit) | all above | none | [ ] |

---

## S1: Agree the design

Issue #1630 carries the design. The maintainer agreed these on 2026-10-09:

- decision 1: a held device's pushes are skipped, not queued;
- decision 7: only the header sign-out holds;
- `HELD_DEVICE_RETENTION_DAYS` is 15.

**Acceptance:** #1630 carries `approved-to-build`, and any later answer that
changes the design is written back into it before B1.

## B1: Schema

Files:
- `database/migrations/<UTC timestamp>_push_subscriptions_held_at.sql`
- `database/schema.sql`
- `backend/src/push/entities/push-subscription.entity.ts`

The migration and the `schema.sql` change are design 4.1, verbatim.
`heldAt: Date | null` is mapped with `@Column({ name: "held_at", type: "timestamp", nullable: true })`.

**Acceptance:**
- `migration:lint` and `verify-schema.sh` are green.
- `rls-enforcement.integration.spec.ts` is green with no change, because the
  table's bucket is unchanged.

## B2: Service and route

Files:
- `backend/src/push/push-subscription.service.ts` (+ `.spec.ts`)
- `backend/src/push/push.controller.ts` (+ `.spec.ts`)

Implement design 4.2-4.4.

**Acceptance:** `push-subscription.service.spec.ts` gains these cases:
- `hold` binds `id` and `user_id` and 404s on zero rows;
- `hold` never names another user (the existing "no statement names another
  user" scan covers it once the statement is in the file);
- the upsert's `DO UPDATE` arm clears `held_at`;
- `sendToUser` and `sendTest` query with `heldAt: IsNull()`;
- `sendTest` with only held devices throws `noDevices`;
- the purge deletes held rows past the cutoff and leaves younger ones.

`push.controller.spec.ts` covers the route passing `req.user.id`.
`push-route-throttle.spec.ts` is green, because the new write carries both
decorators.

## F2: Settings shows the hold

Files:
- `frontend/src/lib/push.ts` (the `PushDevice.heldAt` field only)
- `frontend/src/components/settings/PushDevicesPanel.tsx` (+ test)
- `frontend/src/components/settings/PushDiagnostics.tsx` (+ test)
- `frontend/src/components/settings/NotificationPreferencesMatrix.tsx` (+ test)
- `frontend/src/i18n/messages/en/*.json`, then `npm run i18n:pseudo`

Implement design 5.3. `heldAt` is optional on the type (absent from an older
backend) and reads as not held.

**Acceptance:** the tests render a held row with its own copy and a working
Remove. This browser's held row counts as registered. The matrix keeps its
push columns when the only device is held.

## F1: Hold on sign-out, resume on sign-in

Files:
- `frontend/src/lib/push.ts` (+ `push.test.ts`)
- `frontend/src/hooks/usePushResumeOnSignIn.ts` (+ test)
- `frontend/src/components/layout/SwipeShell.tsx`
- `frontend/src/components/layout/AppHeader.tsx` (+ test)
- `frontend/src/components/layout/PushEnableBanner.tsx` (+ test)

Implement design 5.1-5.2. The comment above `handleLogout` is rewritten to
describe the hold and its fallback.

**Acceptance:** `push.test.ts` covers a truth table for
`holdPushForSignOut`:

| Situation | Expected |
|---|---|
| Foreign marker | No request, no unsubscribe |
| Hold returns 204 | Subscription kept; marker becomes `held` |
| Hold returns 404, 403 or a network error | Today's delete + unsubscribe |
| No row for this fingerprint | Today's release |
| Bound elapses | Returns within the bound |

It also covers a truth table for `resumePushAfterSignIn`:

| Situation | Expected |
|---|---|
| Marker not held, or owned by somebody else | No request |
| Permission not granted | Local release + `retireServerRowFor` |
| Key mismatch | Local release, no post |
| Same fingerprint | One post; marker `held: false` |
| Rotated fingerprint | Post + `retireServerRowFor(old)` |
| 409 claimed | Local release |

The `AppHeader` test asserts that the hold runs before `authApi.logout()`.
The `DangerZoneSection` test still asserts the full release. The hook test
asserts that nothing is requested on a load without a held marker.

## Q1: Integration

File: `backend/test/integration/push-hold.integration.spec.ts`

Run against real PostgreSQL with RLS enforcement on:

- user B cannot hold user A's row (404, and A's `held_at` stays NULL);
- B's subscribe on A's held endpoint is still a 409 and leaves A's hold in
  place;
- A's subscribe clears the hold;
- `sendToUser`'s target query excludes the held row;
- the sweep removes a held row whose `held_at` has been backdated.

**Acceptance:** green under `npm run build && npm run test:integration`.

## D1: Docs

Files:
- `docs/system-invariants.md` (index row + INV-PUSH-011 entry; INV-PUSH-001 *Failure response*)
- `docs/frontend/pwa-push-share.md` (a paragraph under "A push subscription belongs to an account" on hold and resume, and on why an unconfirmed hold releases)
- `docs/backend/notifications-and-push.md` (the "logout releases the endpoint" sentence)

**Acceptance:** `doc-paths.spec.ts`, `instruction-files.spec.ts` and
`node scripts/check-docs-manifests.mjs` are green.

## Q2: Locales

Translate every new key into every locale in `frontend/src/i18n/config.ts`.
This is the PR's final commit.

**Acceptance:** `npm run i18n:check` is green.

## PR body

Use `.github/pull_request_template.md`. Link issue #1630, and list the
invariants INV-PUSH-001, INV-PUSH-004 and INV-PUSH-011. The behaviour change
to note for reviewers: signing out no longer turns push off in that browser.
It pauses push until the same account signs in there again.
