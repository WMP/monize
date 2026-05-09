import { SplitRow } from '@/components/transactions/SplitEditor';
import { OverrideSplit } from '@/types/scheduled-transaction';

/**
 * Serialize a SplitRow array into the OverrideSplit shape used by both the
 * scheduled-transaction Post and Override APIs. Round-trips the splitKind and
 * embedded investment payload so an investment-kind split survives editing in
 * the post / override dialogs.
 */
export function toOverrideSplits(splits: SplitRow[]): OverrideSplit[] {
  return splits.map((s) => ({
    splitKind: s.splitType,
    categoryId: s.splitType === 'category' ? (s.categoryId ?? null) : null,
    transferAccountId:
      s.splitType === 'transfer' ? (s.transferAccountId ?? null) : null,
    investment: s.splitType === 'investment' ? s.investment : undefined,
    amount: s.amount,
    memo: s.memo ?? null,
  }));
}
