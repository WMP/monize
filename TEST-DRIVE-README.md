# Test drive: browser push, no database migrations

**This branch is not for merge.** It exists to answer one question on a database
nobody has migrated: *does turning notifications on actually work?*

The real change is `claude/notification-settings-menu-4tebh9`. That branch adds
two migrations, and the maintainer has not accepted them yet — so this one is
built from `main` and carries only the parts that need no schema.

## Why the real branch cannot simply be run without migrating

`backend/docker-entrypoint.sh` runs `node dist/db-migrate.js` before
`node dist/main.js`, unconditionally — there is no skip flag. And even with one,
the real branch's code reads a table (`notifications`) that migration 172
creates by renaming `budget_alerts`, so the notification bell would answer 500s.

## What this branch does instead

| Real branch | Here |
|---|---|
| `push_instance_config` table (migration 171) | the VAPID key pair in process memory |
| `push_subscriptions` table (migration 171) | the registered devices in a `Map` |
| `budget_alerts` → `notifications` (migration 172) | **not included** — the bell is `main`'s, unchanged |

Everything else under `backend/src/push/` and the whole client are the real
branch's files, copied unchanged. Only `push-store.ts`, `push-config.service.ts`
and `push-subscription.service.ts` differ, and each says so at the top.

**No migration runs. `database/migrations/` is byte-identical to `main`.**

## What this costs

* **A restart loses the key pair and every registered device.** That behaves
  exactly like a key rotation: each device has to be enabled again. To avoid it,
  generate a pair once and put it in `.env`:

  ```bash
  npx web-push generate-vapid-keys
  # then, in .env:
  #   PUSH_VAPID_PUBLIC_KEY=...
  #   PUSH_VAPID_PRIVATE_KEY=...
  ```

* **One backend replica only.** Two would hold two key pairs, and a device
  registered against one is undeliverable from the other.
* **No row-level security**, because there are no rows. Ownership is still
  enforced — every read and write is keyed on the `userId` the controller takes
  from the JWT, and `push-store.spec.ts` asserts it — but here that is the only
  thing enforcing it.

## What you can test

* the banner appearing after sign-in, and after installing the PWA
  (`appinstalled`);
* the browser's own permission prompt on the **Turn on** click;
* Settings → Notifications → **Browser push**: the device list, the pre-click
  hint, **Send test notification**, and removing a device;
* an actual test push arriving, with its click opening the app;
* the two refusal states: an iPhone in a Safari tab, and a browser already
  blocking Monize (including the iOS Settings path).

## What you cannot test here

The notification centre — the bell, the `notifications` table, the one write
door, backup/restore of those rows, the admin page for the instance's push
identity. All of it needs the migrations.

## Running it

```bash
docker compose -f docker-compose.dev.yml up --build
```

Nothing about your database changes. If you want to be certain, the check is
`SELECT to_regclass('public.push_subscriptions');` before and after — `NULL`
both times.

**Push needs a secure context.** `http://localhost` counts, so desktop Chrome
and Firefox work as-is. A phone does not: install the PWA over HTTPS (a
reverse proxy with a real certificate, or a tunnel such as `cloudflared` /
`ngrok` pointed at the frontend port). On iPhone and iPad it must also be the
installed Home Screen app — Safari in a tab cannot receive push at all, which is
one of the states the banner now explains rather than staying silent about.
