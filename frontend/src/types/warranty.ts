import type { PaginationInfo } from './transaction';

/**
 * A warranty as the API answers it, mirrored from
 * `backend/src/warranties/dto/warranty-response.dto.ts`
 * (docs/future-plans/warranty-tracker.md section 6.5).
 *
 * `status` and `daysLeft` are the server's, computed against `today`, the
 * reader's own date in their timezone (WTY-002). A component formats them and
 * never compares two dates itself.
 */

export type WarrantyStatus = 'lifetime' | 'active' | 'expiring' | 'expired';

export const WARRANTY_STATUSES: readonly WarrantyStatus[] = [
  'lifetime',
  'active',
  'expiring',
  'expired',
];

/** `GET /warranties?status=`: one of the four, or every one. */
export type WarrantyStatusFilter = WarrantyStatus | 'all';

export type WarrantyKind = 'manufacturer' | 'extended' | 'store' | 'other';

export const WARRANTY_KINDS: readonly WarrantyKind[] = [
  'manufacturer',
  'extended',
  'store',
  'other',
];

/** `GET /warranties?sort=`. The server owns the direction of each. */
export type WarrantySort = 'expiresOn' | 'name' | 'purchaseDate';

/** The most serial numbers one warranty carries (`WARRANTY_MAX_SERIAL_NUMBERS`). */
export const WARRANTY_MAX_SERIAL_NUMBERS = 10;
/** Each serial number's length cap (`@MaxLength(100, { each: true })`). */
export const WARRANTY_SERIAL_NUMBER_MAX_LENGTH = 100;

/** The purchase a warranty links to (design section 4). */
export interface WarrantyLinkedTransaction {
  id: string;
  transactionDate: string;
  payeeName: string | null;
  amount: number;
  currencyCode: string;
  accountId: string;
}

export interface Warranty {
  id: string;
  name: string;
  vendorName: string | null;
  payeeId: string | null;
  modelNumber: string | null;
  serialNumbers: string[];
  warrantyKind: WarrantyKind;
  purchaseDate: string;
  expiresOn: string | null;
  isLifetime: boolean;
  /** Informational only: no surface sums it (design decision 6). */
  purchasePrice: number | null;
  currencyCode: string | null;
  productUrl: string | null;
  notes: string | null;
  today: string;
  status: WarrantyStatus;
  /** Negative once expired; `null` for a lifetime warranty. */
  daysLeft: number | null;
  documentCount: number;
  openClaimCount: number;
  /** Omitted when the reader may not see the linked purchase. */
  transactionId?: string;
  linkedTransaction: WarrantyLinkedTransaction | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WarrantyListResult {
  data: Warranty[];
  pagination: PaginationInfo;
}

/** `GET /warranties/summary`: unarchived warranties counted per status. */
export interface WarrantySummary {
  today: string;
  windowDays: number;
  counts: Record<WarrantyStatus, number>;
  total: number;
}

export interface WarrantyListParams {
  status?: WarrantyStatusFilter;
  q?: string;
  transactionId?: string;
  archived?: boolean;
  sort?: WarrantySort;
  page?: number;
  limit?: number;
}

/** A duration from the purchase date; absent parts are zero. */
export interface WarrantyTerm {
  years?: number | null;
  months?: number | null;
  days?: number | null;
}

/**
 * `POST /warranties`. Exactly one of `expiresOn`, `term` or
 * `isLifetime: true`; `purchasePrice` and `currencyCode` together or neither;
 * `productUrl` http or https only.
 */
export interface CreateWarrantyData {
  name: string;
  vendorName?: string | null;
  payeeId?: string | null;
  transactionId?: string | null;
  modelNumber?: string | null;
  serialNumbers?: string[];
  warrantyKind?: WarrantyKind;
  purchaseDate: string;
  expiresOn?: string | null;
  term?: WarrantyTerm | null;
  isLifetime?: boolean;
  purchasePrice?: number | null;
  currencyCode?: string | null;
  productUrl?: string | null;
  notes?: string | null;
}

/**
 * `PATCH /warranties/:id`. Every field optional; at most one of `expiresOn`,
 * `term` or `isLifetime: true` (none keeps the stored expiry).
 */
export type UpdateWarrantyData = Partial<CreateWarrantyData>;

/** A claim's state (`warranty_claims.status`). A claim never moves its warranty's status. */
export type WarrantyClaimStatus = 'open' | 'approved' | 'denied' | 'resolved';

export const WARRANTY_CLAIM_STATUSES: readonly WarrantyClaimStatus[] = [
  'open',
  'approved',
  'denied',
  'resolved',
];

/** The statuses that close a claim, and the only ones a `resolvedOn` may carry. */
export const WARRANTY_CLAIM_CLOSED_STATUSES: readonly WarrantyClaimStatus[] = ['resolved', 'denied'];

/** The cap on a claim's description and resolution (`@MaxLength(2000)`). */
export const WARRANTY_CLAIM_TEXT_MAX_LENGTH = 2000;

/**
 * One claim as the API answers it, mirrored from `WarrantyClaimView` in
 * `backend/src/warranties/warranty-claims.service.ts`.
 */
export interface WarrantyClaim {
  id: string;
  warrantyId: string;
  claimDate: string;
  status: WarrantyClaimStatus;
  description: string | null;
  resolution: string | null;
  resolvedOn: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * `POST /warranties/:id/claims`. `resolvedOn` only with a status of resolved
 * or denied, and never before `claimDate`.
 */
export interface CreateWarrantyClaimData {
  claimDate: string;
  status?: WarrantyClaimStatus;
  description?: string | null;
  resolution?: string | null;
  resolvedOn?: string | null;
}

/**
 * `PATCH /warranties/:id/claims/:claimId`. Every field optional. Reopening a
 * claim that has a stored `resolvedOn` must send `resolvedOn: null` with it;
 * the server refuses the pair otherwise.
 */
export type UpdateWarrantyClaimData = Partial<CreateWarrantyClaimData>;
