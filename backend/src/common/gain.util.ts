/**
 * Unrealized gain and its percentage against a cost basis, with every
 * not-known branch stated rather than defaulted.
 *
 * The shape this replaces was written out at each site as
 *
 * ```typescript
 * const gainLoss = marketValue - costBasis;
 * const gainLossPercent = costBasis > 0 ? (gainLoss / costBasis) * 100 : 0;
 * ```
 *
 * which makes two silent claims. It treats an unknown market value or basis as
 * a number (so the gain is computed from a guess), and it reports `0%` for a
 * zero basis -- but a position acquired at no cost and now worth something has
 * no meaningful percentage return, and `0%` says the opposite of that.
 *
 * The rules here:
 *
 * - Either input unknown -> both outputs unknown. Rule 1 of
 *   `docs/financial-calculation-contract.md`.
 * - Basis `0` and gain `0` -> `0` and `0%`. Nothing was invested and nothing
 *   was made: a settled answer, not a missing one.
 * - Basis `0` and gain non-zero -> the gain is known, the percentage is not.
 *   Dividing by zero has no answer, and `0%` would hide a real gain.
 */
export function gainAgainstBasis(
  marketValue: number | null,
  costBasis: number | null,
): { gainLoss: number | null; gainLossPercent: number | null } {
  if (marketValue === null || costBasis === null) {
    return { gainLoss: null, gainLossPercent: null };
  }

  const gainLoss = marketValue - costBasis;

  if (costBasis === 0) {
    return { gainLoss, gainLossPercent: gainLoss === 0 ? 0 : null };
  }

  // A negative basis (a short-style residual) still divides meaningfully in
  // magnitude terms, but the sign would flip and read as a loss on a gain, so
  // use the magnitude of the basis as the denominator.
  return {
    gainLoss,
    gainLossPercent: (gainLoss / Math.abs(costBasis)) * 100,
  };
}
