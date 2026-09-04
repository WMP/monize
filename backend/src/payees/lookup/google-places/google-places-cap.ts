/**
 * The monthly request cap: its default and the range a stored one may occupy.
 *
 * Declared once because four places have to agree about it -- the CHECK
 * constraint in migration 188, the DTO's `@Min`/`@Max`, the operator's
 * `GOOGLE_PLACES_MONTHLY_CAP` default, and the number the settings form offers
 * -- and a bound spelled out per site is how the AI query budgets drifted
 * before they were declared as data (`ai/query/query-budgets.ts`).
 *
 * **1,000, not 10,000.** Google's free monthly allowances are per SKU, and a
 * Text Search whose field mask asks for `websiteUri` or
 * `internationalPhoneNumber` is billed at the Text Search Enterprise SKU,
 * whose free allowance is 1,000 requests per calendar month. The widely quoted
 * 10,000 belongs to the Essentials SKU, which returns neither a website nor a
 * phone number and so cannot answer this lookup at all.
 */
export const GOOGLE_PLACES_CAP = {
  default: 1000,
  min: 1,
  max: 1_000_000,
} as const;

/**
 * A stored cap outside the range falls back to the default rather than being
 * clamped: a value the database should never have held is a fault, and
 * clamping it silently substitutes a limit nobody chose. Same rule as
 * `resolveQueryBudgetsForConfig`.
 */
export function resolveMonthlyCap(stored: number | null | undefined): number {
  if (typeof stored !== "number" || !Number.isInteger(stored)) {
    return GOOGLE_PLACES_CAP.default;
  }
  return stored >= GOOGLE_PLACES_CAP.min && stored <= GOOGLE_PLACES_CAP.max
    ? stored
    : GOOGLE_PLACES_CAP.default;
}
