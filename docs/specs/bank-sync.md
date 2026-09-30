# Spec: bank sync (Open Banking / PSD2 via Enable Banking)

Status: **approved to build.** Scope from discussion kenlasko/monize#1326
("Open Banking / PSD2 Integration via Enable Banking", label
`approved-to-build`, maintainer reply 2026-09-08: "I'm in favour of adding
it. People can choose to use it or not."). The product decisions below
(per-user credentials, booked rows only) were confirmed with the feature's
requester. The plan and the task list are
[`docs/future-plans/bank-sync.md`](../future-plans/bank-sync.md) and
[`docs/future-plans/bank-sync-tasks.md`](../future-plans/bank-sync-tasks.md).

Owner: bank-sync. Related: INV-BANKSYNC-001, INV-BANKSYNC-002,
INV-BANKSYNC-003 (this spec), INV-BALANCE-001, INV-CACHE-001,
`docs/external-side-effects.md` section 6, `docs/cron-jobs.md`,
`docs/future-plans/csv-source-profiles.md` (P2 and P4, the duplicate key and
the cut-off date this spec implements for its own source),
`docs/future-plans/transaction-rules.md` section 6.3 (rules run on the
`import` trigger).

---

## 1. What this adds

A user connects Monize to a bank through a regulated aggregator (an AISP).
The first provider is Enable Banking. After the user authorizes access at
their bank, Monize reads the list of bank accounts, the user maps each bank
account to one Monize account, and Monize imports the **booked** transactions
of that bank account into the Monize account: on request ("Sync now") and once
a day.

The feature is a generic *bank sync provider* concept. Enable Banking is the
first implementation of `BankSyncProvider`; nothing outside
`backend/src/bank-sync/providers/enable-banking/` knows its wire format.

Out of scope for the first release (tasks in the task list): pending rows,
transfers between two synced accounts, splits, a notification when consent is
about to expire, the ledger in the backup, MCP and AI tools, payment
initiation.

## 2. Terms

| Term | Meaning |
|---|---|
| Provider | An aggregator Monize talks to (`enable_banking`). |
| Credentials | The provider application a user registered: an application id and an RSA private key (PEM). One row per user and provider. |
| Institution | A bank the provider can connect to (Enable Banking: an ASPSP, identified by name and country). |
| Connection | One authorization of one user at one institution. It carries the provider session and its consent expiry. |
| Bank account | One account the connection can read. It is mapped to at most one Monize account. |
| Ledger row | One row of `bank_sync_imported_transactions`: "this provider transaction was imported into this Monize account". |
| Cut-off date | `sync_from_date`: rows booked before it are never imported. |

## 3. Invariants

```text
INV-BANKSYNC-001  A bank transaction is imported into a Monize account at most once.
INV-BANKSYNC-002  A provider private key never leaves the server.
INV-BANKSYNC-003  A synced row is written in the Monize account's currency or not at all.
```

Full entries are in `docs/system-invariants.md`. The mechanisms:

- **001**: the unique index `(account_id, external_key)` on
  `bank_sync_imported_transactions`. The ledger row is inserted with
  `INSERT ... ON CONFLICT DO NOTHING RETURNING id` **before** the transaction
  row, in the same `withScopedDb` transaction; a row that returns nothing is a
  duplicate and nothing else is written for it. Two concurrent syncs of the
  same account therefore converge (the second insert waits on the first one's
  index entry and returns nothing once it commits). The ledger is keyed on the
  **Monize** account, not the connection, so disconnecting and reconnecting a
  bank does not re-import the history.
- **002**: the key is encrypted with `EncryptionService` (AES-256-GCM) into
  `bank_sync_credentials.private_key_enc`. No response type has a field for it;
  the view carries `privateKeySet: boolean`. The column is not named
  `api_key_enc`, so the backup key transport does not pick it up, and the table
  is excluded from the backup.
- **003**: the currency of a synced row is the Monize account's currency
  (`assertTransactionCurrencyMatchesAccount`). A provider row whose currency
  differs from the account's is refused and counted (`currency_mismatch`), never
  converted and never written in the account's currency with the foreign
  amount.

## 4. Data model

One migration creates four user-owned tables. Each has `user_id` and the
direct RLS policy, enabled in the same file.

| Table | Key columns | Notes |
|---|---|---|
| `bank_sync_credentials` | `id`, `user_id`, `provider`, `application_id`, `private_key_enc` | `UNIQUE (user_id, provider)`. |
| `bank_sync_connections` | `id`, `user_id`, `provider`, `institution_name`, `institution_country`, `psu_type`, `status`, `auth_state_hash`, `auth_started_at`, `external_session_id`, `valid_until`, `auto_sync`, `last_error` | `status IN ('pending','active','expired','revoked','failed')`. Partial unique index on `auth_state_hash`. |
| `bank_sync_accounts` | `id`, `user_id`, `connection_id`, `external_account_id`, `identification_hash`, `display_name`, `identifier_masked`, `currency_code`, `account_id`, `sync_from_date`, `last_synced_at`, `last_success_at`, `last_sync_status`, `last_sync_error`, `last_imported_count`, `last_skipped_count`, `last_refused_count`, `bank_balance`, `bank_balance_currency`, `bank_balance_date` | `UNIQUE (connection_id, external_account_id)`; partial unique index on `account_id`; `CHECK (account_id IS NULL OR sync_from_date IS NOT NULL)`; `account_id` is `ON DELETE SET NULL`. |
| `bank_sync_imported_transactions` | `id`, `user_id`, `account_id`, `external_key`, `transaction_id`, `booking_date`, `created_at` | `UNIQUE (account_id, external_key)`; `account_id` is `ON DELETE CASCADE`; `transaction_id` is `ON DELETE SET NULL`. |

A deleted Monize transaction keeps its ledger row (with `transaction_id`
NULL). A deleted row therefore stays deleted: the next sync does not bring it
back. This is the intended behaviour, and the UI says so.

`bank_balance` is `NUMERIC(20,4)`, the money precision. It is what the bank
reported, shown beside the Monize balance for reconciliation. It never writes
`current_balance`.

**Backup.** All four tables are in `INTENTIONALLY_EXCLUDED_TABLES`:
credentials and connections are secrets and sessions under this instance's
key; bank accounts are re-created by a new connection. The ledger is excluded
in the first release (task BS11 exports it). The consequence, and its guard: after a
restore into a fresh instance the ledger is empty, so the link form defaults
the cut-off date to the day after the newest transaction in the Monize
account (section 7), and the form says that a date earlier than the newest
transaction in the account may import rows that are already there.

## 5. Authorization flow

```text
user            Monize API                     provider            bank
 |  connect(bank) |                               |                  |
 |--------------->| row: pending, state hash      |                  |
 |                |------ start authorization --->|                  |
 |<--- redirect --|<------------ url -------------|                  |
 |------------------------------------------------------ SCA -------->|
 |<------------------- redirect_url ?code&state -----------------------|
 | callback(code, state)                          |                  |
 |--------------->| CAS pending -> (claimed)      |                  |
 |                |------ create session -------->|                  |
 |                |<----- session, accounts ------|                  |
 |                | row: active, accounts upserted|                  |
```

- **State.** 32 random bytes, base64url. Only its SHA-256 hex is stored. The
  callback finds the connection by `(user_id, auth_state_hash)` with
  `status = 'pending'` and `auth_started_at` no older than
  the constant `AUTH_STATE_TTL_MS` (30 minutes). A state from another user, an old
  state or a used state is refused with the same 400. The row's
  `auth_state_hash` is cleared in the same transaction that claims it, so a
  replayed callback finds nothing (the clear is the claim).
- **Redirect URL.** `${PUBLIC_APP_URL}/settings/bank-sync/callback`. The user
  registers this exact URL in the provider's control panel; the status
  endpoint returns it so the settings page can show it.
- **Consent validity.** The server reads the institution's
  `maximum_consent_validity` from the provider and asks for
  `min(maximum, 180 days)`. The client never supplies a validity.
- **Error at the bank.** The callback with `error` (and no `code`) records the
  provider's description (bounded to 500 characters) in `last_error` and
  clears the state. A first-time connection (`pending`) becomes `failed`; a
  connection that was already `active` or `expired` keeps its status, so a
  failed renewal never disables a working session.
- **Re-authorization.** `POST /bank-sync/connections/:id/reauthorize` starts a
  new flow on the same row: it writes a new state hash and `auth_started_at`
  and leaves `status` unchanged, so the current session keeps syncing until
  the new one replaces it; the callback claims by the state hash alone. A
  provider failure while starting it also leaves `status` unchanged. After a
  successful re-authorization the previous provider session is revoked (best
  effort, outside any transaction). The new session's accounts are matched
  to the existing `bank_sync_accounts` rows by `identification_hash` (stable
  across sessions), so every mapping and cut-off survives; unmatched accounts
  are added unmapped.
- **Network access.** The redirect is a browser redirect: the bank sends the
  user's browser to the redirect URL, and the frontend posts `code` and
  `state` to the backend. No Enable Banking server connects to Monize, so the
  instance needs no inbound rule, no public address and no allowlist of
  provider IP addresses; the redirect URL only has to open in the browser the
  user authorizes with. The backend needs outbound HTTPS to
  `api.enablebanking.com` (port 443). Neither `docker-compose*.yml` nor the
  Helm chart restricts egress, so the default deployment needs no change; an
  operator who adds an egress policy allows that host.
- **Disconnect.** Deletes the connection (and its bank accounts, by cascade)
  after asking the provider to delete the session. A provider failure on that
  call is logged and does not block the local delete: the consent expires at
  the bank by itself.

## 6. Mapping a provider row

The provider adapter turns a wire row into `BankTransaction` (provider
neutral). `planBankImport` (pure) turns a list of those into planned rows and
refusals. Truth table (the first matching line wins):

| Input | Result |
|---|---|
| `status` is not booked | not planned, counted as `pending` (not an error) |
| no valid date (`booking_date`, then `value_date`, then `transaction_date`, each `YYYY-MM-DD`) | refused `missing_date` |
| date before `sync_from_date` | not planned, counted as `before_cutoff` |
| date after today (server date) + 1 day | refused `future_date` |
| amount not matching `^\d{1,16}(\.\d{1,8})?$` after trimming | refused `invalid_amount` |
| direction neither credit nor debit | refused `unknown_direction` |
| currency differs from the Monize account's | refused `currency_mismatch` |
| otherwise | planned |

For a planned row:

- **Amount.** `roundMoney(Number(abs))` (four decimals, the column's
  precision), negated for a debit. Example: debit `"12.34565"` gives
  `-12.3457`; credit `"1000"` gives `1000`; a zero debit gives `0`, not `-0`.
- **Date.** The first valid of `booking_date`, `value_date`,
  `transaction_date`.
- **Payee text.** Debit: the creditor's name; credit: the debtor's name;
  otherwise the first remittance line. Trimmed, bounded to 100 characters
  (the create DTO's bound). Empty gives no payee.
- **Description.** The remittance lines joined with a space, trimmed, bounded
  to `TRANSACTION_NOTE_MAX_LENGTH`.
- **Reference number.** The bank's own reference (`reference_number`),
  bounded to 100 characters, or null. It is display data only; the duplicate
  key is not stored there (csv-source-profiles C2).
- **Status.** `CLEARED`: the bank has booked it.
- **External key** (INV-BANKSYNC-001), the first that applies:
  1. `ref:` + the provider's entry reference (Enable Banking documents
     `entry_reference` as unique and immutable across sessions for accounts
     with the same identification hash);
  2. `hash:` + SHA-256 hex over `date|amount|currency|direction|payee|description`,
     then `:` + the occurrence number of that hash among the rows of this
     fetch, counted from 0 in the order the provider returned them.
  A key longer than 255 characters is replaced by its prefix and the SHA-256
  hex of the whole value. The hash form is stable because every fetch
  requests whole days (section 7), so two identical coffees on one day are
  always `:0` and `:1`.

  The provider's `transaction_id` is never part of the key: Enable Banking
  documents it as a handle for fetching details that may change when the list
  is fetched again. A row repeated within one fetch with the same entry
  reference (a pagination overlap) is planned once.

## 7. Syncing one bank account

Window: `date_from = max(sync_from_date, last_success_at::date - 7 days)`
(`sync_from_date` alone before the first success), `date_to = today`. The
overlap re-reads a week so a row the bank booked late is not missed; the
ledger makes the re-read free.

Default cut-off when a bank account is linked: the day after the newest
non-VOID transaction in the Monize account, or today minus 90 days for an
empty account. The user may choose another date.

Steps:

1. **Read** the link, the connection and the credentials (one
   `withScopedDb`). Refuse when the bank account is not linked, the connection
   is not `active`, or `valid_until` has passed (the connection is then marked
   `expired` in the same transaction and the refusal says to renew it).
2. **Lease.** `JobClaimService.claimLease(JobClaimType.BankSyncAccount, userId,
   bankAccountId, 30 min)`; 30 minutes covers the worst fetch, 100 pages at a
   15 second timeout each, plus the balances. A refused lease is a 409 ("a sync of this account
   is already running"). The lease saves the provider quota; the ledger is
   what makes a race correct.
3. **Fetch** outside any transaction: every page of booked transactions in the
   window (bounded to 100 pages), then the balances (a balance failure is
   logged and leaves the stored balance unchanged). A user-present sync passes
   the PSU IP address and user agent, so the bank does not count it against the
   unattended-access limit (PSD2 allows about four unattended reads a day).
4. **Plan** with `planBankImport` (section 6).
5. **Write**, one `withScopedDb` transaction:
   - lock the `bank_sync_accounts` row `FOR UPDATE` and re-check it is still
     linked to the same Monize account with the same cut-off date (a re-link or
     a new cut-off during the fetch refuses the whole write with 409: nothing
     is written and `last_success_at` does not move);
   - lock the Monize account for a balance write, re-read it, refuse when it is
     closed, is an investment brokerage account, or its currency changed since
     the rows were planned;
   - load the `import` rules once;
   - per planned row: insert the ledger row (`ON CONFLICT DO NOTHING
     RETURNING id`); nothing returned means `skipped`; otherwise resolve the
     payee by name, then by alias, else insert it with
     `ON CONFLICT (user_id, name) DO UPDATE ... RETURNING` (two syncs meeting
     the same new counterparty converge), create the transaction, point the
     ledger row at it;
   - apply the `import` rules to the created ids, with the raw payee text;
   - recompute the balance from the ledger with
     `AccountsService.recalculateCurrentBalance`, which joins this
     transaction under the lock already held (INV-BALANCE-001; the writer never
     writes `current_balance` itself);
   - write the sync outcome on the `bank_sync_accounts` row.
6. **After the commit**: `triggerDebouncedRecalc` for the account when
   anything was created (INV-CACHE-001), release the lease.
7. **On failure** at any step after 2: write `last_sync_status = 'failed'` and
   a bounded, sanitized message in its own transaction, release the lease,
   return the mapped error. A provider 403, or a 401 whose error code names
   the session or the consent, marks the connection `expired`; any other 401
   is a credentials refusal and leaves the connection alone.

The result: `{ imported, skipped, refused: { reason: count }, pending,
beforeCutoff, bankBalance }`. `imported > 0` is what makes the client
invalidate its balance caches. A sync whose outcome the client could not
learn (a timeout, a network error, a 5xx) invalidates them too and says the
result is not known yet: the server may have committed.

## 8. The daily sync

`BankSyncCronService` runs once a day (`17 5 * * *`, UTC). The fan-out lists
the users with at least one `active`, `auto_sync` connection that has a linked
bank account (`withSystemContext`). Per user, under `withUserContext`:
`claimOnce(JobClaimType.BankSyncDaily, userId, <UTC date>)`, then every linked
bank account of that user in turn; one account's failure is recorded on that
account and the loop continues. Two replicas therefore sync each user once a
day.

## 9. API

All routes: `@Controller("bank-sync")`, `AuthGuard("jwt")`, owner only (no
`@AllowDelegate`), `ParseUUIDPipe` on every `:id`, `@DemoRestricted()` on
every write, DTOs with `whitelist` + `forbidNonWhitelisted` and bounded
fields.

| Method and path | Body | Answer |
|---|---|---|
| `GET /bank-sync/status` | | `{ encryptionAvailable, providers, credentials: { provider, applicationId, privateKeySet } \| null, redirectUrl }` |
| `PUT /bank-sync/credentials` | `{ applicationId, privateKey? }` | the status. `privateKey` omitted keeps the stored key; it is required when none is stored. The PEM must parse as an RSA private key. |
| `DELETE /bank-sync/credentials` | | 204 |
| `POST /bank-sync/credentials/test` | | `{ ok, applicationName, redirectUrls }` |
| `GET /bank-sync/institutions?country=PL` | | `[{ name, country, logoUrl, psuTypes, maximumConsentValidityDays }]` |
| `GET /bank-sync/connections` | | connections with their bank accounts |
| `POST /bank-sync/connections` | `{ institutionName, country, psuType }` | `{ connectionId, authorizationUrl }` |
| `POST /bank-sync/connections/:id/reauthorize` | | `{ connectionId, authorizationUrl }` |
| `POST /bank-sync/callback` | `{ state, code?, error?, errorDescription? }` | the connection |
| `PATCH /bank-sync/connections/:id` | `{ autoSync }` | the connection |
| `DELETE /bank-sync/connections/:id` | | 204 |
| `PATCH /bank-sync/accounts/:id` | `{ accountId: uuid \| null, syncFromDate? }` | the bank account |
| `POST /bank-sync/accounts/:id/sync` | | the result (section 7) |
| `POST /bank-sync/connections/:id/sync` | | one entry per linked account: a result, or `{ bankAccountId, error: { code, message } }` for an account that failed |

Linking refuses (400) an account the user does not own, a closed account, an
investment brokerage account, an account already linked to another bank
account, and an account whose currency differs from the bank account's known
currency.

## 10. Missing-data policy

- A bank account without a currency from the provider can be linked; each row
  is then checked on its own (section 6).
- A balance the provider did not return is `null` and shown as "not reported
  by the bank", never `0`.
- The Monize-versus-bank difference is shown only when both balances are known
  and in the same currency.
- A provider that did not answer is reported as unavailable (the breaker in
  `ProviderHealthService`), never as "no new transactions".

## 11. Test matrix

| Claim | Test |
|---|---|
| Mapping truth table, each line | unit, `bank-transaction-planner.spec.ts` |
| Key: ref, id, hash, occurrence counter, 255 bound | unit, same file |
| JWT: RS256, `kid` = application id, `iss`/`aud`/`iat`/`exp`, verifies with the public key | unit, `enable-banking-jwt.spec.ts` |
| Adapter: pagination, booked filter, error mapping, PSU headers, breaker calls | unit, `enable-banking.client.spec.ts` with a typed `fetch` double |
| State: one use, TTL, other user's state refused | unit, service spec; integration for the claim CAS |
| A second sync of the same rows imports nothing (INV-BANKSYNC-001) | integration, real PostgreSQL |
| Two concurrent syncs import each row once | integration, two connections |
| Currency mismatch refused, nothing written (INV-BANKSYNC-003) | unit and integration |
| Key never in a response (INV-BANKSYNC-002) | unit, response type and serializer spec |
| Balance moved once by the created sum (INV-BALANCE-001) | integration |
| Cron: once per user per day, failure of one user isolated | unit with the real `withScopedDb` over a mock `DataSource` (`rls-context-smoke` pattern) |
