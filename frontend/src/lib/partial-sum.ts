/**
 * Sum a list of components where any unknown component makes the total
 * unknown.
 *
 * The frontend mirror of the backend's `PartialSum`. The rule is the same one
 * `frontend/CLAUDE.md` states as "an unknown value must not render as a
 * measured zero", and the shape it replaces is just as natural to write:
 *
 * ```typescript
 * // WRONG: an unconvertible account silently drops out and the label still
 * // says "total"
 * const total = rows.reduce((sum, r) => sum + (r.value ?? 0), 0);
 * ```
 *
 * A `0` component is a known zero and is summed normally. Only `null`,
 * `undefined` and `NaN` poison the result.
 */
export function sumKnown(values: Array<number | null | undefined>): number | null {
  let total = 0;
  for (const value of values) {
    if (value === null || value === undefined || Number.isNaN(value)) return null;
    total += value;
  }
  return total;
}

/** Add two figures, staying unknown when either side is. */
export function addKnown(
  a: number | null | undefined,
  b: number | null | undefined,
): number | null {
  return sumKnown([a, b]);
}

/** Subtract, staying unknown when either side is. */
export function subtractKnown(
  a: number | null | undefined,
  b: number | null | undefined,
): number | null {
  if (a === null || a === undefined || b === null || b === undefined) return null;
  const result = a - b;
  return Number.isNaN(result) ? null : result;
}

/**
 * A percentage of `value` against `basis`.
 *
 * Mirrors the backend's `gainAgainstBasis` denominator rule: a zero basis has
 * no meaningful percentage unless the numerator is also zero, in which case
 * `0%` is a settled answer rather than a guess.
 */
export function percentOf(
  value: number | null | undefined,
  basis: number | null | undefined,
): number | null {
  if (value === null || value === undefined || basis === null || basis === undefined) {
    return null;
  }
  if (basis === 0) return value === 0 ? 0 : null;
  return (value / Math.abs(basis)) * 100;
}
