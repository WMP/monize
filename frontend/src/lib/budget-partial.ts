export interface PartialBudgetData {
  fxComplete: false;
  total: null;
  result: null;
  currency?: string;
  knownComponents: { id: string; currency: string; date: string; knownSubtotal: number }[];
  missingRatePairs: { from: string; to: string; date: string; reason: string | null }[];
  detailsTruncated?: true;
  repair: 'currency_rate_history';
  fetchAttempted: false;
}
export class BudgetFxIncompleteError extends Error {
  constructor(readonly details: PartialBudgetData) { super(); this.name = 'BudgetFxIncompleteError'; }
}
/** Never let an unknown budget result masquerade as an ordinary object/empty array. */
export function budgetResponse<T>(value: T): T {
  if (value && typeof value === 'object' && 'fxComplete' in value && value.fxComplete === false &&
      'result' in value && value.result === null && 'knownComponents' in value && Array.isArray(value.knownComponents) &&
      'missingRatePairs' in value && Array.isArray(value.missingRatePairs)) {
    throw new BudgetFxIncompleteError(value as unknown as PartialBudgetData);
  }
  return value;
}
