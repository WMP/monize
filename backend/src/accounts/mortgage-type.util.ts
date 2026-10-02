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

/**
 * How the quoted annual rate becomes a per-period rate (spec table 4.1):
 * `NOMINAL` divides it by the payments per year, `SEMI_ANNUAL` compounds it
 * twice a year and converts that to the payment period.
 */
export type MortgageCompounding = "NOMINAL" | "SEMI_ANNUAL";

/** How each installment's principal is derived (spec table 4.3). */
export type MortgageAmortizationMethod = "ANNUITY" | "LINEAR" | "INTEREST_ONLY";

/**
 * How rate inference turns an observed periodic rate back into an annual one:
 * `DAY_COUNT` scales by the days the period spans, `SEMI_ANNUAL` inverts the
 * semi-annual conversion.
 */
export type MortgageAnnualization = "DAY_COUNT" | "SEMI_ANNUAL";

export interface MortgageTypeTraits {
  readonly compounding: MortgageCompounding;
  readonly method: MortgageAmortizationMethod;
  readonly annualization: MortgageAnnualization;
}

/**
 * Spec table 4.1, the one place a type's behaviour is decided. A `Record` over
 * `MortgageType`, so a type added to `MORTGAGE_TYPES` without a row here is a
 * compile error. A consumer asks a trait through the accessors below rather
 * than comparing type literals, so a new type is one row plus whatever the
 * compiler then names.
 */
export const MORTGAGE_TYPE_TRAITS: Readonly<
  Record<MortgageType, MortgageTypeTraits>
> = Object.freeze({
  ANNUITY: Object.freeze({
    compounding: "NOMINAL",
    method: "ANNUITY",
    annualization: "DAY_COUNT",
  }),
  CANADIAN_FIXED: Object.freeze({
    compounding: "SEMI_ANNUAL",
    method: "ANNUITY",
    annualization: "SEMI_ANNUAL",
  }),
  LINEAR: Object.freeze({
    compounding: "NOMINAL",
    method: "LINEAR",
    annualization: "DAY_COUNT",
  }),
  INTEREST_ONLY: Object.freeze({
    compounding: "NOMINAL",
    method: "INTEREST_ONLY",
    annualization: "DAY_COUNT",
  }),
});

export function compoundingFor(type: MortgageType): MortgageCompounding {
  return MORTGAGE_TYPE_TRAITS[type].compounding;
}

export function amortizationMethodFor(
  type: MortgageType,
): MortgageAmortizationMethod {
  return MORTGAGE_TYPE_TRAITS[type].method;
}

export function annualizationFor(type: MortgageType): MortgageAnnualization {
  return MORTGAGE_TYPE_TRAITS[type].annualization;
}

/**
 * The type the two legacy flags denote (spec table 4.2): Canadian and not
 * variable is `CANADIAN_FIXED`, every other combination `ANNUITY`. A NULL flag
 * reads as false, as the P1-B1 backfill and the pre-type `getPeriodicRate`
 * test (`isCanadian && !isVariableRate`) did. Used where
 * `accounts.mortgage_type` is null until P3-B1 makes it NOT NULL.
 */
export function mortgageTypeFromFlags(
  isCanadian: boolean | null | undefined,
  isVariableRate: boolean | null | undefined,
): MortgageType {
  return isCanadian === true && isVariableRate !== true
    ? "CANADIAN_FIXED"
    : "ANNUITY";
}

/**
 * The flags a save writes beside the type while the booleans still exist:
 * `CANADIAN_FIXED` is `(true, false)`, every other type `(false, false)`. The
 * inverse of `mortgageTypeFromFlags` for those two types; a `(true, true)` row
 * reads back as `(false, false)`, which denotes the same arithmetic.
 */
export function flagsFromMortgageType(type: MortgageType): {
  isCanadianMortgage: boolean;
  isVariableRate: boolean;
} {
  return {
    isCanadianMortgage: type === "CANADIAN_FIXED",
    isVariableRate: false,
  };
}

/**
 * The types a request may write in Phase 1 (docs/future-plans/mortgage-types.md,
 * section 4). The CHECK accepts all four from P1-B1, but `LINEAR` and
 * `INTEREST_ONLY` have no method behind them until P2-B1, so the DTOs refuse
 * them (`@IsIn`) rather than store a type the engine would price as an annuity.
 */
export const WRITABLE_MORTGAGE_TYPES = [
  "ANNUITY",
  "CANADIAN_FIXED",
] as const satisfies readonly MortgageType[];
export type WritableMortgageType = (typeof WRITABLE_MORTGAGE_TYPES)[number];

interface MortgageFlags {
  isCanadianMortgage?: boolean | null;
  isVariableRate?: boolean | null;
}

/**
 * The type a stored mortgage row carries: `accounts.mortgage_type`, else the
 * type its two legacy flags denote. The column is nullable until P3-B1, and a
 * pod of the previous release clears it when a save changes a flag, so a null
 * column is read through the flags rather than as `ANNUITY`. Every consumer of
 * the type reads it through here.
 */
export function mortgageTypeOf(
  row: MortgageFlags & { mortgageType?: MortgageType | null },
): MortgageType {
  return (
    row.mortgageType ??
    mortgageTypeFromFlags(row.isCanadianMortgage, row.isVariableRate)
  );
}

/**
 * The type a write asks for, or `undefined` when the request says nothing about
 * it. `mortgageType` wins when present; otherwise a request carrying either
 * legacy flag denotes the type of the flags it leaves behind, a flag it omits
 * keeping its stored value. A writer stores the result together with
 * `flagsFromMortgageType` of it, so the row a request carrying only the flags
 * writes and the row a request carrying only the type writes are the same, and
 * a pod of the previous release reading the flags prices it identically.
 */
export function requestedMortgageType(
  request: MortgageFlags & { mortgageType?: MortgageType | null },
  stored: MortgageFlags = {},
): MortgageType | undefined {
  if (request.mortgageType != null) return request.mortgageType;
  if (
    request.isCanadianMortgage === undefined &&
    request.isVariableRate === undefined
  ) {
    return undefined;
  }
  return mortgageTypeFromFlags(
    request.isCanadianMortgage ?? stored.isCanadianMortgage,
    request.isVariableRate ?? stored.isVariableRate,
  );
}

/**
 * The columns a save writes for `type`: the type and the flags it maps to,
 * always together while the booleans exist (spec decision 6).
 */
export function mortgageTypeColumns(type: MortgageType): {
  mortgageType: MortgageType;
  isCanadianMortgage: boolean;
  isVariableRate: boolean;
} {
  return { mortgageType: type, ...flagsFromMortgageType(type) };
}
