import {
  MORTGAGE_TYPES,
  MORTGAGE_TYPE_TRAITS,
  amortizationMethodFor,
  annualizationFor,
  compoundingFor,
  MortgageType,
  PREPAYMENT_MODES,
  flagsFromMortgageType,
  mortgageTypeColumns,
  mortgageTypeFromFlags,
  mortgageTypeOf,
  prepaymentModeColumn,
  prepaymentModeOf,
  requestedMortgageType,
  storesConstantPayment,
} from "./mortgage-type.util";

describe("mortgageTypeOf", () => {
  it("reads the stored type over the flags", () => {
    expect(
      mortgageTypeOf({
        mortgageType: "ANNUITY",
        isCanadianMortgage: true,
        isVariableRate: false,
      }),
    ).toBe("ANNUITY");
  });

  it("falls back to the flags when the column is null or absent", () => {
    expect(
      mortgageTypeOf({
        mortgageType: null,
        isCanadianMortgage: true,
        isVariableRate: false,
      }),
    ).toBe("CANADIAN_FIXED");
    expect(
      mortgageTypeOf({ isCanadianMortgage: true, isVariableRate: true }),
    ).toBe("ANNUITY");
    expect(mortgageTypeOf({})).toBe("ANNUITY");
  });
});

describe("requestedMortgageType", () => {
  const fixed = { isCanadianMortgage: true, isVariableRate: false };

  it("is undefined when the request names neither the type nor a flag", () => {
    expect(requestedMortgageType({}, fixed)).toBeUndefined();
    expect(requestedMortgageType({ mortgageType: null }, fixed)).toBe(
      undefined,
    );
  });

  it("prefers the type over the flags", () => {
    expect(
      requestedMortgageType({ mortgageType: "ANNUITY", ...fixed }, fixed),
    ).toBe("ANNUITY");
  });

  it("translates the flags, keeping a stored flag the request omits", () => {
    expect(requestedMortgageType(fixed)).toBe("CANADIAN_FIXED");
    expect(requestedMortgageType({ isVariableRate: true }, fixed)).toBe(
      "ANNUITY",
    );
    expect(
      requestedMortgageType(
        { isVariableRate: false },
        { isCanadianMortgage: true, isVariableRate: true },
      ),
    ).toBe("CANADIAN_FIXED");
    expect(requestedMortgageType({ isCanadianMortgage: false }, fixed)).toBe(
      "ANNUITY",
    );
  });
});

describe("mortgageTypeColumns", () => {
  it("writes the type and the flags it maps to together", () => {
    expect(mortgageTypeColumns("CANADIAN_FIXED")).toEqual({
      mortgageType: "CANADIAN_FIXED",
      isCanadianMortgage: true,
      isVariableRate: false,
    });
    expect(mortgageTypeColumns("ANNUITY")).toEqual({
      mortgageType: "ANNUITY",
      isCanadianMortgage: false,
      isVariableRate: false,
    });
  });

  it("stores the same row for a flags-only and a type-only request", () => {
    // Issue #1505 acceptance: the two request shapes are one stored row.
    const cases: Array<
      [{ isCanadianMortgage: boolean; isVariableRate: boolean }, MortgageType]
    > = [
      [{ isCanadianMortgage: false, isVariableRate: false }, "ANNUITY"],
      [{ isCanadianMortgage: false, isVariableRate: true }, "ANNUITY"],
      [{ isCanadianMortgage: true, isVariableRate: false }, "CANADIAN_FIXED"],
      [{ isCanadianMortgage: true, isVariableRate: true }, "ANNUITY"],
    ];
    for (const [flags, type] of cases) {
      expect(mortgageTypeColumns(requestedMortgageType(flags)!)).toEqual(
        mortgageTypeColumns(requestedMortgageType({ mortgageType: type })!),
      );
    }
  });
});

describe("prepayment mode (spec decisions 4 and 10)", () => {
  it("lists the two modes the CHECK admits", () => {
    expect([...PREPAYMENT_MODES]).toEqual([
      "SHORTEN_TERM",
      "LOWER_INSTALLMENT",
    ]);
  });

  it("reads a null mode as SHORTEN_TERM", () => {
    expect(prepaymentModeOf({ prepaymentMode: null })).toBe("SHORTEN_TERM");
    expect(prepaymentModeOf({})).toBe("SHORTEN_TERM");
    expect(prepaymentModeOf({ prepaymentMode: "LOWER_INSTALLMENT" })).toBe(
      "LOWER_INSTALLMENT",
    );
  });

  it("writes the requested mode, else the stored one, for LINEAR", () => {
    expect(prepaymentModeColumn("LINEAR", "LOWER_INSTALLMENT", null)).toBe(
      "LOWER_INSTALLMENT",
    );
    expect(prepaymentModeColumn("LINEAR", undefined, "LOWER_INSTALLMENT")).toBe(
      "LOWER_INSTALLMENT",
    );
    expect(prepaymentModeColumn("LINEAR", null, "LOWER_INSTALLMENT")).toBe(
      null,
    );
    expect(prepaymentModeColumn("LINEAR", undefined)).toBe(null);
  });

  it.each(["ANNUITY", "CANADIAN_FIXED", "INTEREST_ONLY", null] as const)(
    "writes null for %s whatever the request carries",
    (type) => {
      expect(
        prepaymentModeColumn(type, "LOWER_INSTALLMENT", "SHORTEN_TERM"),
      ).toBe(null);
    },
  );
});

describe("storesConstantPayment (spec decision 11)", () => {
  it.each([
    ["ANNUITY", true],
    ["CANADIAN_FIXED", true],
    ["LINEAR", false],
    ["INTEREST_ONLY", false],
  ] as const)("%s: %s", (type, stores) => {
    expect(storesConstantPayment(type)).toBe(stores);
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
