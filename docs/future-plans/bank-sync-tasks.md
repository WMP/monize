# Bank sync: agent task list

> Companion to [`bank-sync.md`](./bank-sync.md) and
> [`docs/specs/bank-sync.md`](../specs/bank-sync.md). Tasks in dependency
> order.

## How to use this list

- **The governing invariants apply to every task**: INV-BANKSYNC-001 (at most
  once), INV-BANKSYNC-002 (the key never leaves the server), INV-BANKSYNC-003
  (the account's currency or nothing).
- **Definition of done**: the layer gates of `AGENTS.md`; the migration with
  `migration:lint`, `scripts/verify-schema.sh` and
  `node scripts/check-migration-prefixes.mjs`; strings in every locale; the PR
  body per `.github/pull_request_template.md`.

## Task graph

| ID | Task | Depends on | Deploy impact | Status |
|----|------|-----------|---------------|--------|
| BS1 | Spec, plan and invariants merged | -- | none | [x] |
| BS2 | Migration and `schema.sql`: four tables, indexes, RLS; entities; backup classification | BS1 | inert | [x] |
| BS3 | Provider interface, registry, Enable Banking JWT, client and mapper; provider-health adoption | BS1 | inert | [x] |
| BS4 | Credentials service and routes | BS2 | additive | [x] |
| BS5 | Connections: start, callback with the state CAS, re-authorize, disconnect | BS3, BS4 | additive | [x] |
| BS6 | Planner, writer and sync of one account; link routes; integration spec | BS5 | additive | [x] |
| BS7 | Daily cron, `docs/cron-jobs.md` row | BS6 | additive | [x] |
| BS8 | Settings pages, callback page, API client, English strings | BS6 | additive | [x] |
| BS9 | Every other locale | BS8 | none | [x] |
| BS10 | Verify the wire format against an Enable Banking sandbox application; correct the mapper and the plan's assumption 3 | BS6 | none | [ ] |
| BS11 | Export and restore the ledger in the backup (id remap on `account_id`, `transaction_id`) | BS6 | neutral | [ ] |
| BS12 | Notification when a connection's consent expires within 7 days, and when a daily sync fails twice in a row | BS7 | additive | [ ] |
| BS13 | Pending rows: import as `UNRECONCILED`, replace when booked (needs its own spec for the match) | BS10 | additive | [ ] |
| BS14 | A row whose counterparty is another synced account becomes a transfer | BS10 | additive | [ ] |
| BS15 | MCP and AI tools: list connections, sync now (with confirmation) | BS6 | additive | [ ] |

## Notes per task

- **BS10** is the only task that needs a real provider account. Record the
  observed field names in the plan; never paste a real account number, IBAN
  or name into the repository (use synthetic fixtures).
- **BS10, observed so far (control panel, "Add a new application" form):**
  - The environment is chosen per application: Sandbox (activated
    automatically, connected to a limited set of bank sandboxes and a
    "Mock ASPSP") or Production.
  - The RSA key is either generated in the browser, with the private key saved
    as a file on "Register", or generated outside the browser, with the public
    certificate imported. The default is the browser.
  - Redirect URLs are entered in "Allowed redirect URLs (one per line)".
  - The settings card's steps follow this form.
  - The downloaded key file is named `<application id>.pem` (observed).
  - A new Production application shows "Inactive" with two buttons:
    "Activate by linking accounts" (restricted mode: "Only linked accounts
    can be accessed") and "Request activation" (general availability, not
    needed for personal use).
  - Production redirect URLs must be https; Sandbox accepts http; the
    redirect URL does not have to be public; restricted mode does not check
    the privacy and terms URLs (Firefly III data importer tutorial, secondary
    source).
  - Still to check: the API wire format against a live session, and the
    control panel URL path.
- **BS11** replaces the cut-off-date mitigation in spec section 4, not the
  cut-off date itself.
