import { BenchmarkData } from "../domain/benchmark";
import {
  lotInput,
  manifestDocument,
  ManifestName,
  polishCalendars,
} from "../adapters/pl/pl-test-input";
import { parseBondTerms } from "../domain/bond-terms";
import { BondEngineError, BondEngineInput, valueBondLot } from "./bond-engine";

const CPI = "PL_CPI_GUS_YOY";
const NBP = "PL_NBP_REFERENCE";

const cpi = (
  ...entries: [string, string][]
): ReadonlyMap<string, BenchmarkData> =>
  new Map([
    [CPI, { kind: "MONTHLY", publisher: "GUS", values: new Map(entries) }],
  ]);

const nbp = (
  coveredThrough: string | null,
  ...changes: [string, string][]
): ReadonlyMap<string, BenchmarkData> =>
  new Map([
    [
      NBP,
      {
        kind: "STEP",
        publisher: "NBP",
        changes: changes.map(([effectiveFrom, value]) => ({
          effectiveFrom,
          value,
        })),
        coveredThrough,
      },
    ],
  ]);

const announced = (...entries: [number, string][]) => new Map(entries);

function variant(
  name: ManifestName,
  change: (doc: Record<string, any>) => void,
  purchase: string,
  asOf: string,
  overrides: Partial<BondEngineInput> = {},
) {
  const doc = manifestDocument(name);
  change(doc);
  return valueBondLot({
    ...lotInput(name, purchase, asOf),
    terms: parseBondTerms(doc),
    ...overrides,
  });
}

const coi = (asOf: string, overrides: Partial<BondEngineInput> = {}) =>
  valueBondLot(lotInput("coi1030", "2026-10-15", asOf, overrides));
const edo = (asOf: string, overrides: Partial<BondEngineInput> = {}) =>
  valueBondLot(lotInput("edo1036", "2026-10-01", asOf, overrides));
const ror = (asOf: string, overrides: Partial<BondEngineInput> = {}) =>
  valueBondLot(lotInput("ror1027", "2026-10-31", asOf, overrides));
const tos = (asOf: string, overrides: Partial<BondEngineInput> = {}) =>
  valueBondLot(lotInput("tos1029", "2026-10-15", asOf, overrides));

describe("valueBondLot: rate of period k (spec section 4)", () => {
  it("k = 1 comes from the terms whatever the data says", () => {
    const v = coi("2026-10-20", {
      announcedRates: announced([1, "0.0999"]),
      benchmarks: cpi(["2026-08", "0.0900"]),
    });
    expect(v.currentPeriod).toMatchObject({
      index: 1,
      annualRate: "0.0475",
      rateSource: "TERMS",
    });
  });

  it("k >= 2 uses an announced rate over a derived one", () => {
    const v = coi("2027-10-16", {
      announcedRates: announced([2, "0.0500"]),
      benchmarks: cpi(["2027-08", "0.0290"]),
    });
    expect(v.currentPeriod).toMatchObject({
      index: 2,
      annualRate: "0.0500",
      rateSource: "ANNOUNCED",
    });
  });

  it("k >= 2 derives max(0, observation) + margin from the stored month", () => {
    const v = coi("2027-10-16", { benchmarks: cpi(["2027-08", "0.0290"]) });
    expect(v.currentPeriod).toMatchObject({
      annualRate: "0.0440",
      rateSource: "DERIVED",
    });
    expect(v.missing).toEqual([]);
  });

  it("floors a negative CPI at 0 and never uses another month", () => {
    const negative = coi("2027-10-16", {
      benchmarks: cpi(["2027-08", "-0.0050"]),
    });
    expect(negative.currentPeriod?.annualRate).toBe("0.0150");
    const wrongMonth = coi("2027-10-16", {
      benchmarks: cpi(["2027-07", "0.0300"], ["2027-09", "0.0300"]),
    });
    expect(wrongMonth.currentPeriod).toBeNull();
    expect(wrongMonth.missing).toEqual([
      { benchmarkId: CPI, observation: "2027-08", publisher: "GUS" },
    ]);
  });

  it("a started period without a rate makes every dependent value null", () => {
    const v = coi("2027-10-16");
    expect(v).toMatchObject({
      currentPeriod: null,
      principal: null,
      accruedInterest: null,
      grossValue: null,
      earlyRedemptionValue: null,
      earlyRedemptionRefusal: "RATE_UNKNOWN",
      dataCompleteness: { termsComplete: true, referenceDataComplete: false },
      valuationComplete: false,
      missing: [{ benchmarkId: CPI, observation: "2027-08", publisher: null }],
    });
  });

  it("names the publisher when the benchmark is known but the month is not", () => {
    const v = coi("2027-10-16", { benchmarks: cpi(["2026-08", "0.0290"]) });
    expect(v.missing[0].publisher).toBe("GUS");
  });

  it("a compounding bond needs every started period and lists each missing month once", () => {
    const v = edo("2029-10-02");
    expect(v.grossValue).toBeNull();
    expect(v.missing.map((m) => m.observation)).toEqual([
      "2027-08",
      "2028-08",
      "2029-08",
    ]);
  });

  it("a coupon bond needs only the current period", () => {
    const v = coi("2028-10-20", { announcedRates: announced([3, "0.0300"]) });
    expect(v.grossValue).toBe("100.04");
    expect(v.currentPeriod).toMatchObject({
      index: 3,
      rateSource: "ANNOUNCED",
    });
    expect(v.missing).toEqual([]);
  });

  it("projects a period that has not started from a supplied assumption", () => {
    const v = edo("2026-10-10", { projection: new Map([[CPI, "0.0300"]]) });
    expect(v.maturityValueKnown).toBeNull();
    expect(v.maturityValueProjected).not.toBeNull();
    expect(v.knownCashflows).toEqual([]);
    expect(v.projectedCashflows).toEqual([
      expect.objectContaining({
        type: "PRINCIPAL",
        status: "PROJECTED",
        period: 10,
      }),
    ]);
    expect(v.projectionAssumptions).toEqual([
      "PL_CPI_GUS_YOY = 0.0300 (supplied assumption), assumed for every later period",
    ]);
    expect(v.dataCompleteness.referenceDataComplete).toBe(true);
  });

  it("defaults the projection to the newest stored observation and names it", () => {
    const v = edo("2026-10-10", {
      benchmarks: cpi(["2026-07", "0.0310"], ["2026-08", "0.0290"]),
    });
    expect(v.projectionAssumptions).toEqual([
      "PL_CPI_GUS_YOY = 0.0290 (2026-08), assumed for every later period",
    ]);
    expect(v.maturityValueProjected).toBe("162.04");
    expect(v.maturityValueKnown).toBeNull();
  });

  it("without an assumption or an observation a future period stays unknown", () => {
    const v = edo("2026-10-10");
    expect(v).toMatchObject({
      maturityValueKnown: null,
      maturityValueProjected: null,
      projectionAssumptions: [],
      knownCashflows: [],
      projectedCashflows: [],
    });
    expect(
      edo("2026-10-10", { benchmarks: cpi() }).projectionAssumptions,
    ).toEqual([]);
  });

  it("never mixes known and projected: one projected period leaves the maturity value projected", () => {
    const v = edo("2026-10-10", {
      benchmarks: cpi(["2027-08", "0.0290"]),
      announcedRates: announced(
        ...[3, 4, 5, 6, 7, 8, 9, 10].map((k): [number, string] => [
          k,
          "0.0490",
        ]),
      ),
    });
    expect(v.maturityValueKnown).not.toBeNull();
    expect(v.maturityValueProjected).toBeNull();
    const partial = edo("2026-10-10", {
      benchmarks: cpi(["2027-08", "0.0290"]),
    });
    expect(partial.maturityValueKnown).toBeNull();
    expect(partial.maturityValueProjected).not.toBeNull();
  });

  it("splits coupon cash flows into known and projected", () => {
    const v = coi("2026-10-20", {
      announcedRates: announced([2, "0.0440"]),
      projection: new Map([[CPI, "0.0300"]]),
    });
    expect(v.knownCashflows.map((c) => [c.period, c.type, c.amount])).toEqual([
      [1, "INTEREST", "4.75"],
      [2, "INTEREST", "4.40"],
      [4, "PRINCIPAL", "100.00"],
    ]);
    expect(v.projectedCashflows.map((c) => [c.period, c.amount])).toEqual([
      [3, "4.50"],
      [4, "4.50"],
    ]);
    expect(v.maturityValueKnown).toBeNull();
    expect(v.maturityValueProjected).toBe("104.50");
  });

  it("lists only cash flows after asOf", () => {
    const v = coi("2027-10-16", { announcedRates: announced([2, "0.0440"]) });
    expect(v.knownCashflows.map((c) => c.period)).toEqual([2, 4]);
  });
});

describe("valueBondLot: step benchmark with a business-day observation", () => {
  const asOf = "2026-12-05";

  it("reads the rate in force on the observation day", () => {
    const v = ror(asOf, {
      benchmarks: nbp(
        "2026-10-19",
        ["2026-09-01", "0.0450"],
        ["2026-10-19", "0.0425"],
        ["2026-10-20", "0.0400"],
      ),
    });
    expect(v.currentPeriod).toMatchObject({
      index: 2,
      annualRate: "0.0425",
      rateSource: "DERIVED",
    });
  });

  it("is unknown past coveredThrough even when an older rate exists", () => {
    const v = ror(asOf, {
      benchmarks: nbp("2026-10-18", ["2026-09-01", "0.0450"]),
    });
    expect(v.currentPeriod).toBeNull();
    expect(v.missing).toEqual([
      { benchmarkId: NBP, observation: "2026-10-19", publisher: "NBP" },
    ]);
  });

  it("is unknown without coverage or without a change on or before the day", () => {
    expect(
      ror(asOf, { benchmarks: nbp(null, ["2026-09-01", "0.0450"]) })
        .currentPeriod,
    ).toBeNull();
    expect(
      ror(asOf, { benchmarks: nbp("2026-12-01", ["2026-10-20", "0.0450"]) })
        .currentPeriod,
    ).toBeNull();
  });

  it("is unknown when the stored series has the wrong shape", () => {
    const wrong = new Map<string, BenchmarkData>([
      [NBP, { kind: "MONTHLY", publisher: "NBP", values: new Map() }],
    ]);
    expect(ror(asOf, { benchmarks: wrong }).missing).toHaveLength(1);
    const wrongCpi = new Map<string, BenchmarkData>([
      [
        CPI,
        { kind: "STEP", publisher: "GUS", changes: [], coveredThrough: null },
      ],
    ]);
    expect(
      coi("2027-10-16", { benchmarks: wrongCpi }).currentPeriod,
    ).toBeNull();
  });

  it("adds the spread to the floored benchmark", () => {
    const v = variant(
      "ror1027",
      (d) => (d.rateRule.spread = "0.0050"),
      "2026-10-31",
      asOf,
      { benchmarks: nbp("2026-10-19", ["2026-10-01", "0.0425"]) },
    );
    expect(v.currentPeriod?.annualRate).toBe("0.0475");
  });

  it("projects from the newest stored change and names its date", () => {
    const v = ror("2026-11-05", {
      benchmarks: nbp(
        "2026-10-10",
        ["2026-08-01", "0.0450"],
        ["2026-10-01", "0.0425"],
      ),
    });
    expect(v.projectionAssumptions).toEqual([
      "PL_NBP_REFERENCE = 0.0425 (2026-10-01), assumed for every later period",
    ]);
    expect(v.projectedCashflows.length).toBeGreaterThan(0);
    expect(v.knownCashflows.map((c) => c.type)).toEqual([
      "INTEREST",
      "PRINCIPAL",
    ]);
  });

  it("projects from a supplied assumption, and has none without a stored change", () => {
    const supplied = ror("2026-11-05", {
      projection: new Map([[NBP, "0.0300"]]),
    });
    expect(supplied.projectionAssumptions[0]).toContain(
      "0.0300 (supplied assumption)",
    );
    expect(
      ror("2026-11-05", { benchmarks: nbp("2026-10-10") })
        .projectionAssumptions,
    ).toEqual([]);
  });
});

describe("valueBondLot: matured lots", () => {
  it("a compounding lot is worth its maturity value and cannot be redeemed early", () => {
    const v = tos("2029-10-15");
    expect(v).toMatchObject({
      currentPeriod: null,
      principal: "113.79",
      grossValue: "113.79",
      accruedInterest: "13.79",
      earlyRedemptionValue: null,
      earlyRedemptionRefusal: "MATURED",
      knownCashflows: [],
      maturityValueKnown: "113.79",
      valuationComplete: true,
    });
  });

  it("a coupon lot is worth its nominal, the last coupon being paid", () => {
    const v = coi("2030-10-15", {
      announcedRates: announced([2, "0.04"], [3, "0.04"], [4, "0.05"]),
    });
    expect(v).toMatchObject({
      grossValue: "100.00",
      accruedInterest: "0.00",
      earlyRedemptionRefusal: "MATURED",
      maturityValueKnown: "105.00",
      missing: [],
    });
  });

  it("a compounding lot with unknown rates is null and names them", () => {
    const v = edo("2036-10-01");
    expect(v.grossValue).toBeNull();
    expect(v.earlyRedemptionRefusal).toBe("MATURED");
    expect(v.missing).toHaveLength(9);
  });
});

describe("valueBondLot: refusals of the input", () => {
  it("refuses asOf before the purchase date", () => {
    expect(() => tos("2026-10-14")).toThrow(BondEngineError);
  });

  it("values a lot on its purchase date", () => {
    expect(tos("2026-10-15").currentPeriod).toMatchObject({ index: 1 });
  });

  it.each([0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1])(
    "refuses quantity %s",
    (quantity) => {
      expect(() =>
        tos("2027-01-15", { lot: { purchaseDate: "2026-10-15", quantity } }),
      ).toThrow(BondEngineError);
    },
  );

  it("refuses invalid dates and malformed decimals", () => {
    expect(() => tos("2027-02-30")).toThrow(BondEngineError);
    expect(() =>
      tos("2027-01-15", { lot: { purchaseDate: "x", quantity: 1 } }),
    ).toThrow(BondEngineError);
    expect(() =>
      edo("2027-10-02", { announcedRates: announced([2, "4.9%"]) }),
    ).toThrow(BondEngineError);
    expect(() =>
      edo("2026-10-10", { projection: new Map([[CPI, "x"]]) }),
    ).toThrow(BondEngineError);
    expect(() =>
      edo("2026-10-10", { benchmarks: cpi(["2026-08", "x"]) }),
    ).toThrow(BondEngineError);
    expect(() =>
      ror("2026-12-05", { benchmarks: nbp("2026-10-19", ["2026-10-01", "x"]) }),
    ).toThrow(BondEngineError);
    expect(() =>
      ror("2026-11-05", { benchmarks: nbp("2026-10-10", ["2026-10-01", "x"]) }),
    ).toThrow(BondEngineError);
  });
});

describe("valueBondLot: early redemption window", () => {
  it("opens 7 days after purchase", () => {
    const day6 = tos("2026-10-21");
    expect(day6).toMatchObject({
      earlyRedemptionValue: null,
      earlyRedemptionRefusal: "TOO_EARLY",
    });
    expect(day6.grossValue).not.toBeNull();
    expect(tos("2026-10-22")).toMatchObject({
      earlyRedemptionValue: "100.00",
      earlyRedemptionRefusal: null,
    });
  });

  it("closes 20 days before maturity", () => {
    expect(tos("2029-09-24").earlyRedemptionRefusal).toBeNull();
    expect(tos("2029-09-25").earlyRedemptionRefusal).toBeNull();
    expect(tos("2029-09-26")).toMatchObject({
      earlyRedemptionValue: null,
      earlyRedemptionRefusal: "TOO_LATE",
    });
  });

  it("refuses the record day of a coupon bond and only that day", () => {
    expect(ror("2026-11-23")).toMatchObject({
      earlyRedemptionValue: null,
      earlyRedemptionRefusal: "RECORD_DAY",
    });
    expect(ror("2026-11-24").earlyRedemptionRefusal).toBeNull();
    expect(ror("2026-11-20").earlyRedemptionRefusal).toBeNull();
    expect(
      coi("2027-10-08", { announcedRates: announced([1, "0.05"]) })
        .earlyRedemptionRefusal,
    ).toBe("RECORD_DAY");
  });

  it("has no record day for a bond without that blackout", () => {
    expect(tos("2027-10-08").earlyRedemptionRefusal).toBeNull();
  });

  it("refuses a bond redeemable at maturity only", () => {
    const v = variant(
      "tos1029",
      (d) => (d.redemption = { type: "MATURITY_ONLY" }),
      "2026-10-15",
      "2027-01-15",
    );
    expect(v).toMatchObject({
      earlyRedemptionValue: null,
      earlyRedemptionRefusal: "NOT_REDEEMABLE",
    });
  });

  it("applies the floor to the first period only where the terms say so", () => {
    expect(coi("2027-01-15").earlyRedemptionValue).toBe("100.00");
    expect(
      coi("2027-10-16", { announcedRates: announced([2, "0.0440"]) })
        .earlyRedemptionValue,
    ).toBe("98.01");
  });

  it("without a floor or a penalty the value is the plain accrual", () => {
    const noFloor = variant(
      "edo1036",
      (d) => (d.redemption.proceedsFloor = null),
      "2026-10-01",
      "2027-04-01",
    );
    expect(noFloor.earlyRedemptionValue).toBe("99.67");
    const noFee = variant(
      "edo1036",
      (d) => {
        d.redemption.proceedsFloor = null;
        d.redemption.penalties = [];
      },
      "2026-10-01",
      "2027-04-01",
    );
    expect(noFee.earlyRedemptionValue).toBe("102.67");
  });

  it("sums several penalties", () => {
    const v = variant(
      "edo1036",
      (d) => {
        d.redemption.proceedsFloor = null;
        d.redemption.penalties = [
          { type: "FIXED_FEE_PER_UNIT", amount: "1.00" },
          { type: "FIXED_FEE_PER_UNIT", amount: "2.00" },
        ];
      },
      "2026-10-01",
      "2027-04-01",
    );
    expect(v.earlyRedemptionValue).toBe("99.67");
  });

  it("a forfeit penalty returns the base of the period, the rounded N1 in period 2", () => {
    const forfeit = (extra: Record<string, unknown>[]) =>
      variant(
        "tos1029",
        (d) => {
          d.redemption.proceedsFloor = null;
          d.redemption.penalties = [
            { type: "FORFEIT_ACCRUED_SINCE_LAST_PAYMENT" },
            ...extra,
          ];
        },
        "2026-10-15",
        "2028-01-15",
      );
    // N1 = round(100 x 1.044) = 104.40, the base of period 2 (TOS annex 2).
    expect(forfeit([]).earlyRedemptionValue).toBe("104.40");
    // Combined with a fixed fee, both are deducted: 104.40 - 1.00.
    expect(
      forfeit([{ type: "FIXED_FEE_PER_UNIT", amount: "1.00" }])
        .earlyRedemptionValue,
    ).toBe("103.40");
  });
});

describe("valueBondLot: unknown calendars are incomplete terms, never guessed", () => {
  it("an observation calendar that is not supplied leaves the rate unknown", () => {
    const v = ror("2026-12-05", { calendars: new Map() });
    expect(v.currentPeriod).toBeNull();
    expect(v.missing).toEqual([]);
    expect(v.dataCompleteness.termsComplete).toBe(false);
    expect(v.valuationComplete).toBe(false);
  });

  it("a blackout calendar that is not supplied refuses an early redemption", () => {
    const v = ror("2026-11-15", { calendars: new Map() });
    expect(v).toMatchObject({
      earlyRedemptionValue: null,
      earlyRedemptionRefusal: "TERMS_INCOMPLETE",
      dataCompleteness: {
        termsComplete: false,
        earlyRedemptionTermsComplete: false,
      },
    });
  });

  it("a complete registry gives complete terms", () => {
    expect(
      ror("2026-11-15", { calendars: polishCalendars }).dataCompleteness,
    ).toEqual({
      termsComplete: true,
      referenceDataComplete: true,
      earlyRedemptionTermsComplete: true,
    });
  });
});

describe("valueBondLot: generic primitives", () => {
  it("derives the first period when the terms state no first-period rate", () => {
    const v = variant(
      "coi1030",
      (d) => (d.rateRule.firstPeriodRate = null),
      "2026-10-15",
      "2026-10-20",
      {
        benchmarks: cpi(["2026-08", "0.0290"]),
      },
    );
    expect(v.currentPeriod).toMatchObject({
      annualRate: "0.0440",
      rateSource: "DERIVED",
    });
  });

  it("does not floor the benchmark when the terms state no floor", () => {
    const v = variant(
      "coi1030",
      (d) => (d.rateRule.benchmarkFloor = null),
      "2026-10-15",
      "2027-10-16",
      {
        benchmarks: cpi(["2027-08", "-0.0050"]),
      },
    );
    expect(v.currentPeriod?.annualRate).toBe("0.0100");
  });

  it("scales the coupon by the periods per year (quarterly: F = 4)", () => {
    const v = variant(
      "ror1027",
      (d) => {
        d.schedule.periodMonths = 3;
        d.schedule.periodCount = 4;
      },
      "2026-10-31",
      "2026-11-05",
    );
    expect(v.maturityDate).toBe("2027-10-31");
    expect(v.knownCashflows[0]).toMatchObject({
      type: "INTEREST",
      date: "2027-01-31",
      amount: "1.00",
    });
  });

  it("a fixed rate needs no data and scales the lot by quantity", () => {
    const v = tos("2027-04-15", {
      lot: { purchaseDate: "2026-10-15", quantity: 3 },
    });
    expect(v).toMatchObject({
      quantity: 3,
      grossValue: "306.57",
      accruedInterest: "6.57",
      principal: "100.00",
    });
    expect(v.currentPeriod?.rateSource).toBe("TERMS");
  });
});
