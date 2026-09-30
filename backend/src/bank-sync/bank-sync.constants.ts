/**
 * The closed sets of the bank-sync feature, each written once.
 *
 * Every list here is also a database CHECK (`database/schema.sql`), and
 * `bank-sync-constants.guard.spec.ts` fails when a constant and its CHECK
 * disagree in either direction. Adding a provider or a status is one entry here
 * plus the paired migration, never a second hand-written list.
 */

/** The aggregators Monize can talk to; `enable_banking` is the first. */
export const BANK_SYNC_PROVIDERS = ["enable_banking"] as const;
export type BankSyncProviderName = (typeof BANK_SYNC_PROVIDERS)[number];

/**
 * Where a connection is in its life: `pending` until the bank's redirect comes
 * back, `active` while the consent holds, `expired` once `valid_until` passes
 * or the provider says the session is gone, `revoked` when the user withdrew it
 * at the bank, `failed` when the authorization ended in an error.
 */
export const BANK_SYNC_CONNECTION_STATUSES = [
  "pending",
  "active",
  "expired",
  "revoked",
  "failed",
] as const;
export type BankSyncConnectionStatus =
  (typeof BANK_SYNC_CONNECTION_STATUSES)[number];

/** The kind of access asked for at the bank. */
export const BANK_SYNC_PSU_TYPES = ["personal", "business"] as const;
export type BankSyncPsuType = (typeof BANK_SYNC_PSU_TYPES)[number];

/** The outcome of the last sync of one bank account; null means never synced. */
export const BANK_SYNC_LAST_SYNC_STATUSES = ["succeeded", "failed"] as const;
export type BankSyncLastSyncStatus =
  (typeof BANK_SYNC_LAST_SYNC_STATUSES)[number];
