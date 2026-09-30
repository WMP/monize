/**
 * Bank sync (Open Banking) API shapes. They mirror `docs/specs/bank-sync.md`
 * section 9 exactly. Money the API sends is a decimal STRING (`decimal(20,4)`
 * crosses the wire as text), so a balance is typed `string` here and is made a
 * number at the point of display, never earlier.
 */

/** The connection lifecycle. Mirrors the column's CHECK. */
export type BankSyncConnectionStatus =
  | 'pending'
  | 'active'
  | 'expired'
  | 'revoked'
  | 'failed';

/** The outcome of the last sync of one bank account. */
export type BankSyncAccountSyncStatus = 'succeeded' | 'failed';

/** Whose account the consent is for. */
export type BankSyncPsuType = 'personal' | 'business';

/** The provider application this user registered. Never carries the key. */
export interface BankSyncCredentialsView {
  provider: string;
  applicationId: string;
  /** True when a private key is stored. The key itself never leaves the server. */
  privateKeySet: boolean;
}

export interface BankSyncStatus {
  /** False when the server holds no ENCRYPTION_KEY, so no key can be stored. */
  encryptionAvailable: boolean;
  providers: string[];
  credentials: BankSyncCredentialsView | null;
  /** The exact URL to register in the provider's control panel. */
  redirectUrl: string;
}

export interface SaveBankSyncCredentials {
  applicationId: string;
  /** A new PEM key; omit to keep the stored one (required when none is stored). */
  privateKey?: string;
}

export interface BankSyncCredentialsTestResult {
  ok: boolean;
  applicationName: string;
  redirectUrls: string[];
}

export interface BankInstitution {
  name: string;
  country: string;
  logoUrl: string | null;
  psuTypes: string[];
  maximumConsentValidityDays: number | null;
}

export interface BankSyncAccount {
  id: string;
  connectionId: string;
  displayName: string | null;
  identifierMasked: string | null;
  currencyCode: string | null;
  /** The Monize account this bank account is mapped to, or null when unlinked. */
  accountId: string | null;
  syncFromDate: string | null;
  lastSyncedAt: string | null;
  lastSyncStatus: BankSyncAccountSyncStatus | null;
  lastSyncError: string | null;
  lastImportedCount: number | null;
  lastSkippedCount: number | null;
  lastRefusedCount: number | null;
  /** What the bank reported (decimal string), or null when it reported none. */
  bankBalance: string | null;
  bankBalanceCurrency: string | null;
  bankBalanceDate: string | null;
}

export interface BankSyncConnection {
  id: string;
  provider: string;
  institutionName: string;
  institutionCountry: string;
  status: BankSyncConnectionStatus;
  validUntil: string | null;
  autoSync: boolean;
  lastError: string | null;
  createdAt: string;
  accounts: BankSyncAccount[];
}

export interface CreateBankSyncConnection {
  institutionName: string;
  country: string;
  psuType: BankSyncPsuType;
}

/** Where to send the user to authorize at their bank. */
export interface BankSyncAuthorizationStart {
  connectionId: string;
  authorizationUrl: string;
}

export interface BankSyncCallbackPayload {
  state: string;
  code?: string;
  error?: string;
  errorDescription?: string;
}

export interface UpdateBankSyncConnection {
  autoSync: boolean;
}

export interface UpdateBankSyncAccount {
  /** `null` unlinks. */
  accountId: string | null;
  /** Sent only when the user chose a date; omitted lets the server default it. */
  syncFromDate?: string;
}

/** The outcome of syncing one bank account (spec section 7). */
export interface BankSyncResult {
  bankAccountId: string;
  /** Rows written. Above zero is what makes the client drop its balance caches. */
  imported: number;
  /** Rows already imported before (the ledger says so). */
  skipped: number;
  /** Refused rows by reason (`currency_mismatch`, `invalid_amount`, ...). */
  refused: Record<string, number>;
  /** Rows the bank has not booked yet; counted, not an error. */
  pending: number;
  /** Rows booked before the account's cut-off date. */
  beforeCutoff: number;
  bankBalance: {
    amount: string;
    currencyCode: string;
    referenceDate: string | null;
  } | null;
}

/**
 * One linked bank account that could not be synced, inside the answer to "sync
 * every account of a connection". `error.code` is a stable machine code (the
 * provider's error kind, `refused` or `unexpected`); `error.message` is the
 * server's translated, safe-to-show sentence.
 */
export interface BankSyncFailure {
  bankAccountId: string;
  error: { code: string; message: string };
}

/**
 * One entry per linked account of a connection sync: a result, or a failure.
 * Tell them apart with `isBankSyncFailure` (`lib/bank-sync-summary.ts`); only a
 * failure carries `error`.
 */
export type BankSyncConnectionEntry = BankSyncResult | BankSyncFailure;
