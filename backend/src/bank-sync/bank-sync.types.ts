import type {
  BankSyncConnectionStatus,
  BankSyncLastSyncStatus,
  BankSyncProviderName,
  BankSyncPsuType,
} from "./bank-sync.constants";
import type { RefusalReason } from "./bank-transaction-planner";

/**
 * What the bank-sync API returns. None of these carries key material
 * (INV-BANKSYNC-002): the credentials view says whether a key is stored, and
 * the connection view has no provider session id. Money crosses the wire as a
 * decimal string, like the rest of the API's `decimal(20,4)` values read raw.
 */

export interface BankSyncCredentialsView {
  provider: BankSyncProviderName;
  applicationId: string;
  /** True when a private key is stored. The key itself is never returned. */
  privateKeySet: boolean;
}

export interface BankSyncStatusView {
  /** False when the server holds no `ENCRYPTION_KEY`, so no key can be stored. */
  encryptionAvailable: boolean;
  providers: string[];
  credentials: BankSyncCredentialsView | null;
  /** The exact URL to register in the provider's control panel. */
  redirectUrl: string;
}

export interface BankSyncCredentialsTestView {
  ok: boolean;
  applicationName: string;
  redirectUrls: string[];
}

export interface BankInstitutionView {
  name: string;
  country: string;
  logoUrl: string | null;
  psuTypes: string[];
  maximumConsentValidityDays: number | null;
}

export interface BankSyncAccountView {
  id: string;
  connectionId: string;
  displayName: string | null;
  identifierMasked: string | null;
  currencyCode: string | null;
  /** The Monize account this bank account feeds; null while unlinked. */
  accountId: string | null;
  syncFromDate: string | null;
  lastSyncedAt: string | null;
  lastSyncStatus: BankSyncLastSyncStatus | null;
  lastSyncError: string | null;
  lastImportedCount: number;
  lastSkippedCount: number;
  lastRefusedCount: number;
  /** What the bank reported (decimal string); null means "not reported", never 0. */
  bankBalance: string | null;
  bankBalanceCurrency: string | null;
  bankBalanceDate: string | null;
}

export interface BankSyncConnectionView {
  id: string;
  provider: BankSyncProviderName;
  institutionName: string;
  institutionCountry: string;
  psuType: BankSyncPsuType;
  status: BankSyncConnectionStatus;
  validUntil: string | null;
  autoSync: boolean;
  lastError: string | null;
  createdAt: string;
  accounts: BankSyncAccountView[];
}

export interface BankSyncAuthorizationStartView {
  connectionId: string;
  authorizationUrl: string;
}

/** The outcome of syncing one bank account (spec section 7). */
export interface BankSyncResult {
  bankAccountId: string;
  /** Rows written. Above zero is what makes a client drop its balance caches. */
  imported: number;
  /** Rows the ledger says were imported before. */
  skipped: number;
  refused: Record<RefusalReason, number>;
  /** Rows the bank has not booked yet; counted, not an error. */
  pending: number;
  /** Rows booked before the account's cut-off date. */
  beforeCutoff: number;
  /** The balance this sync fetched; null when the bank reported none. */
  bankBalance: {
    amount: string;
    currencyCode: string;
    referenceDate: string | null;
  } | null;
}
