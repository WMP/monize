import {
  MORTGAGE_TYPES,
  MORTGAGE_TYPE_TRAITS,
  amortizationMethodFor,
  annualizationFor,
  compoundingFor,
  flagWriteStalesMortgageType,
  flagsFromMortgageType,
  mortgageTypeFromFlags,
} from "./mortgage-type.util";

describe("flagWriteStalesMortgageType", () => {
  const fixed = { isCanadianMortgage: true, isVariableRate: false };

  it("is stale when either flag's value changes", () => {
    expect(
      flagWriteStalesMortgageType(fixed, { isCanadianMortgage: false }),
    ).toBe(true);
    expect(flagWriteStalesMortgageType(fixed, { isVariableRate: true })).toBe(
      true,
    );
  });

  it("is not stale when the flags are omitted or resent unchanged", () => {
    expect(flagWriteStalesMortgageType(fixed, {})).toBe(false);
    expect(flagWriteStalesMortgageType(fixed, { ...fixed })).toBe(false);
  });

  it("treats a stored NULL flag written as false as a change", () => {
    // Clearing is always safe: a null type reads from the flags.
    expect(
      flagWriteStalesMortgageType(
        { isCanadianMortgage: true, isVariableRate: null },
        { isVariableRate: false },
      ),
    ).toBe(true);
  });
});

describe("MORTGAGE_TYPE_TRAITS", () => {
  // Spec table 4.1.
  it.each([
    ["ANNUITY", "NOMINAL", "ANNUITY", "DAY_COUNT"],
    ["CANADIAN_FIXED", "SEMI_ANNUAL", "ANNUITY", "SEMI_ANNUAL"],
    ["LINEAR", "NOMINAL", "LINEAR", "DAY_COUNT"],
    ["INTEREST_ONLY", "NOMINAL", "INTEREST_ONLY", "DAY_COUNT"],
  ] as const)(
    "%s compounds %s, amortizes %s, annualizes %s",
    (type, compounding, method, annualization) => {
      expect(compoundingFor(type)).toBe(compounding);
      expect(amortizationMethodFor(type)).toBe(method);
      expect(annualizationFor(type)).toBe(annualization);
    },
  );

  it("has a row for every type and no other", () => {
    expect(Object.keys(MORTGAGE_TYPE_TRAITS).sort()).toEqual(
      [...MORTGAGE_TYPES].sort(),
    );
  });

  it("cannot be mutated at runtime", () => {
    expect(Object.isFrozen(MORTGAGE_TYPE_TRAITS)).toBe(true);
    for (const type of MORTGAGE_TYPES) {
      expect(Object.isFrozen(MORTGAGE_TYPE_TRAITS[type])).toBe(true);
    }
  });
});

describe("mortgageTypeFromFlags", () => {
  // Spec table 4.2.
  it("is CANADIAN_FIXED only for Canadian and not variable", () => {
    expect(mortgageTypeFromFlags(true, false)).toBe("CANADIAN_FIXED");
    expect(mortgageTypeFromFlags(false, false)).toBe("ANNUITY");
    expect(mortgageTypeFromFlags(false, true)).toBe("ANNUITY");
    expect(mortgageTypeFromFlags(true, true)).toBe("ANNUITY");
  });

  it("reads a NULL flag as false, as the backfill does", () => {
    expect(mortgageTypeFromFlags(true, null)).toBe("CANADIAN_FIXED");
    expect(mortgageTypeFromFlags(true, undefined)).toBe("CANADIAN_FIXED");
    expect(mortgageTypeFromFlags(null, false)).toBe("ANNUITY");
    expect(mortgageTypeFromFlags(undefined, null)).toBe("ANNUITY");
  });
});

describe("flagsFromMortgageType", () => {
  it("writes (true, false) for CANADIAN_FIXED and (false, false) otherwise", () => {
    expect(flagsFromMortgageType("CANADIAN_FIXED")).toEqual({
      isCanadianMortgage: true,
      isVariableRate: false,
    });
    for (const type of ["ANNUITY", "LINEAR", "INTEREST_ONLY"] as const) {
      expect(flagsFromMortgageType(type)).toEqual({
        isCanadianMortgage: false,
        isVariableRate: false,
      });
    }
  });

  it("inverts mortgageTypeFromFlags for the two Phase 1 types", () => {
    for (const type of ["ANNUITY", "CANADIAN_FIXED"] as const) {
      const flags = flagsFromMortgageType(type);
      expect(
        mortgageTypeFromFlags(flags.isCanadianMortgage, flags.isVariableRate),
      ).toBe(type);
    }
  });
});
