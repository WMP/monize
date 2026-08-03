/**
 * An accumulator for a total that must not be reported when any of its
 * components is unknown.
 *
 * `docs/financial-calculation-contract.md` rule 1 and the root `CLAUDE.md`
 * both say the same thing: a field named `total*` may only carry a value when
 * every component of the calculation is known, and a partial sum -- if it is
 * returned at all -- goes in a separately named field, never in the total's.
 * That rule has been written down and broken repeatedly, because the shape of
 * the violating code is so natural:
 *
 * ```typescript
 * // WRONG: silently returns a subtotal wearing a total's name
 * let totalHoldingsValue = 0;
 * for (const h of holdings) {
 *   if (h.marketValue !== null) totalHoldingsValue += h.marketValue;
 * }
 * ```
 *
 * Reaching for this class instead makes the decision explicit and impossible
 * to forget: feeding it a `null` poisons `total`, and the surviving partial
 * figure is only reachable through the deliberately awkward
 * `knownSubtotal`.
 *
 * `add(null)` is the *only* way to mark incompleteness -- there is no separate
 * flag to set -- so a caller that correctly threads a nullable component
 * through gets the right answer without having to remember a second step.
 */
export class PartialSum {
  private sum = 0;
  private complete = true;
  private unknownCount = 0;

  /**
   * Add one component. `null` means "this component could not be computed",
   * which makes the whole total unknown. `0` is a known zero and is added
   * normally -- the two are never conflated.
   */
  add(value: number | null | undefined): void {
    if (value === null || value === undefined || Number.isNaN(value)) {
      this.complete = false;
      this.unknownCount += 1;
      return;
    }
    this.sum += value;
  }

  /** Mark the total unknown for a reason other than a component's value. */
  markIncomplete(): void {
    this.complete = false;
    this.unknownCount += 1;
  }

  /**
   * The total, or `null` when any component was unknown. This is the only
   * value that may be assigned to a `total*` field.
   */
  get total(): number | null {
    return this.complete ? this.sum : null;
  }

  /** True when every component was known. */
  get isComplete(): boolean {
    return this.complete;
  }

  /** How many components could not be computed. */
  get unknownComponents(): number {
    return this.unknownCount;
  }

  /**
   * The sum of the components that *were* known. Only ever assign this to a
   * field whose name says it is a subtotal (`knownMarketValueSubtotal`), never
   * to a `total*` field.
   */
  get knownSubtotal(): number {
    return this.sum;
  }
}
