import {
  bookSplitsAtMinorUnit,
  currencyMinorUnitDecimals,
} from "./currency-minor-unit.util";

describe("currencyMinorUnitDecimals", () => {
  it.each([
    ["EUR", 2],
    ["CAD", 2],
    ["JPY", 0],
    ["KWD", 3],
  ])("reads %s as %i decimals", (code, decimals) => {
    expect(currencyMinorUnitDecimals(code)).toBe(decimals);
  });

  it("falls back to 2 for a missing or unknown code, as the client does", () => {
    expect(currencyMinorUnitDecimals(null)).toBe(2);
    expect(currencyMinorUnitDecimals(undefined)).toBe(2);
    expect(currencyMinorUnitDecimals("")).toBe(2);
    expect(currencyMinorUnitDecimals("NOT-A-CODE")).toBe(2);
  });
});

describe("bookSplitsAtMinorUnit", () => {
  it("books the issue #1581 installment in cents, principal taking the rounding", () => {
    // 864.5833 + 306.0625 = 1,170.6458: rounded line by line the lines make
    // 1,170.64 against a 1,170.65 bill, and the split validator refused it.
    expect(
      bookSplitsAtMinorUnit([-864.5833, -306.0625], -1170.6458, 2, 0),
    ).toEqual({ amounts: [-864.59, -306.06], parentAmount: -1170.65 });
  });

  it("books whole units for a currency without a minor unit", () => {
    expect(
      bookSplitsAtMinorUnit([-86458.33, -30606.25], -117064.58, 0, 0),
    ).toEqual({ amounts: [-86459, -30606], parentAmount: -117065 });
  });

  it("leaves a set already in the unit unchanged", () => {
    expect(bookSplitsAtMinorUnit([-500, -1000], -1500, 2, 0)).toEqual({
      amounts: [-500, -1000],
      parentAmount: -1500,
    });
  });

  it("puts a negative residual on the absorbing line too", () => {
    // 0.335 + 0.665 round to 0.34 + 0.67 = 1.01 against a 1.00 parent.
    expect(bookSplitsAtMinorUnit([0.335, 0.665], 1, 2, 1)).toEqual({
      amounts: [0.34, 0.66],
      parentAmount: 1,
    });
  });

  it("only rounds when no line is named to absorb the difference", () => {
    expect(
      bookSplitsAtMinorUnit([-864.5833, -306.0625], -1170.6458, 2, -1),
    ).toEqual({ amounts: [-864.58, -306.06], parentAmount: -1170.65 });
  });
});
