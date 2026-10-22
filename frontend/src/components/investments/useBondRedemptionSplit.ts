'use client';

import { useEffect, useState } from 'react';
import { getErrorCode } from '@/lib/errors';
import { investmentsApi } from '@/lib/investments';
import type { BondLotsRefusalCode, BondRedemptionSplit } from '@/types/bond';

/** Wait for the person to stop typing a quantity or a date before asking. */
export const REDEMPTION_SPLIT_DEBOUNCE_MS = 300;

/** The refusals of a removal the server answers with 400 and the code as `errorCode`. */
const REMOVAL_REFUSAL_CODES: readonly string[] = [
  'OVER_REMOVAL',
  'REMOVAL_EXCEEDS_SERIES',
  'SPLIT',
  'FRACTIONAL_QUANTITY',
  'INVALID_QUANTITY',
  'SERIES_NOT_DETERMINED',
] satisfies BondLotsRefusalCode[];

/** Everything the split depends on; a change of any field is another request. */
export interface RedemptionSplitRequest {
  securityId: string;
  accountId: string;
  bondInstrumentId: string;
  /** YYYY-MM-DD. */
  date: string;
  /** A positive whole number of bonds. */
  quantity: number;
  /** The row being edited: its own removal is not counted as taken. */
  excludeTransactionId?: string;
}

export function redemptionRequestKey(r: RedemptionSplitRequest): string {
  return [
    r.securityId,
    r.accountId,
    r.bondInstrumentId,
    r.date,
    r.quantity,
    r.excludeTransactionId ?? '',
  ].join('|');
}

interface SplitData {
  key: string;
  split: BondRedemptionSplit | null;
  /** The removal refusal code when the server refused the quantity. */
  refusalCode: BondLotsRefusalCode | null;
  failed: boolean;
}

export interface BondRedemptionSplitResult {
  /** The key of the request the figures belong to; null while none was answered. */
  key: string | null;
  split: BondRedemptionSplit | null;
  refusalCode: BondLotsRefusalCode | null;
  /** The request failed: that is not "no split". */
  failed: boolean;
  loading: boolean;
}

/**
 * The split of a bond redemption, read from the server (the engine's figures
 * over the lots the removal takes). Debounced, and keyed by request: an answer
 * is shown only while it is the answer to the current request, so a slow reply
 * for an earlier quantity or date is dropped. A failed read is `failed`, never
 * an empty split. Null request: nothing to ask.
 */
export function useBondRedemptionSplit(
  request: RedemptionSplitRequest | null,
): BondRedemptionSplitResult {
  const [data, setData] = useState<SplitData | null>(null);
  const key = request === null ? null : redemptionRequestKey(request);
  const { securityId, accountId, bondInstrumentId, date, quantity, excludeTransactionId } =
    request ?? {
      securityId: '',
      accountId: '',
      bondInstrumentId: '',
      date: '',
      quantity: 0,
      excludeTransactionId: undefined,
    };

  useEffect(() => {
    if (key === null) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      investmentsApi
        .getBondRedemptionSplit(securityId, { accountId, bondInstrumentId, date, quantity, excludeTransactionId })
        .then((split) => {
          if (!cancelled) setData({ key, split, refusalCode: null, failed: false });
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          const code = getErrorCode(err);
          const status = (err as { response?: { status?: number } })?.response?.status;
          const refused =
            (status === 400 || status === 422) && code !== undefined && REMOVAL_REFUSAL_CODES.includes(code);
          setData({
            key,
            split: null,
            refusalCode: refused ? (code as BondLotsRefusalCode) : null,
            failed: !refused,
          });
        });
    }, REDEMPTION_SPLIT_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, securityId, accountId, bondInstrumentId, date, quantity, excludeTransactionId]);

  const current = key !== null && data?.key === key ? data : null;
  return {
    key: current?.key ?? null,
    split: current?.split ?? null,
    refusalCode: current?.refusalCode ?? null,
    failed: current?.failed ?? false,
    loading: key !== null && current === null,
  };
}
