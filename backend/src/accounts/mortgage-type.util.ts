/**
 * A mortgage's compounding convention and amortization method, stored in
 * `accounts.mortgage_type` (docs/specs/mortgage-types.md, decision 1). The list
 * is the `accounts_mortgage_type_check` CHECK in `database/schema.sql`.
 */
export const MORTGAGE_TYPES = [
  "ANNUITY",
  "CANADIAN_FIXED",
  "LINEAR",
  "INTEREST_ONLY",
] as const;
export type MortgageType = (typeof MORTGAGE_TYPES)[number];

interface MortgageFlags {
  isCanadianMortgage?: boolean | null;
  isVariableRate?: boolean | null;
}

/**
 * Whether a write of the two legacy flags leaves a stored `mortgage_type`
 * disagreeing with them. Until the writers set the type and the flags together
 * (P1-B3), a save that changes either flag's value clears the type, so the
 * reader falls back to the flags instead of trusting a stale backfill. A flag
 * the request omits, or resends unchanged, keeps the type.
 */
export function flagWriteStalesMortgageType(
  stored: MortgageFlags,
  next: MortgageFlags,
): boolean {
  const changed = (
    nextValue: boolean | null | undefined,
    storedValue: boolean | null | undefined,
  ) => nextValue !== undefined && nextValue !== storedValue;
  return (
    changed(next.isCanadianMortgage, stored.isCanadianMortgage) ||
    changed(next.isVariableRate, stored.isVariableRate)
  );
}
