import { flagWriteStalesMortgageType } from "./mortgage-type.util";

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
