import { NotFoundException } from "@nestjs/common";
import { DataSource } from "typeorm";
import { createScopedDbMocks } from "../test-helpers/scoped-db-testing";
import { manifestDocument } from "./adapters/pl/pl-test-input";
import { BOND_CALENDARS } from "./bond-adapters";
import {
  BondDataInconsistentError,
  BondDataNotFoundError,
} from "./bond-errors";
import {
  BondValuationService,
  ValueLotRequest,
} from "./bond-valuation.service";

jest.mock("../common/db/scoped-db", () =>
  jest.requireActual("../test-helpers/scoped-db-testing").scopedDbMockModule(),
);

type Row = Record<string, unknown>;

interface Store {
  instruments: Row[];
  /** Newest first, like the query's ORDER BY. */
  terms: Row[];
  rates: Row[];
  series: Row[];
  values: Row[];
  /** `securities` rows for valueSecurity. */
  securities: Row[];
  /** `investment_transactions` rows for valueSecurity, in register order. */
  ledger: Row[];
}

function setup(store: Partial<Store>) {
  const data: Store = {
    instruments: [{ id: "i1", series_code: "TOS1029", currency_code: "PLN" }],
    terms: [{ version: 1, terms: manifestDocument("tos1029") }],
    rates: [],
    series: [],
    values: [],
    securities: [],
    ledger: [],
    ...store,
  };
  const { manager, dataSource } = createScopedDbMocks();
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  manager.query.mockImplementation(async (sql: string, params: unknown[]) => {
    calls.push({ sql, params });
    if (sql.includes("FROM bond_instruments")) {
      // By id (the link) or by key (the request); the rows are the same.
      return data.instruments;
    }
    if (sql.includes("FROM bond_terms_versions")) {
      const wanted = sql.includes("version = $2") ? params[1] : undefined;
      return data.terms
        .filter((t) => wanted === undefined || t.version === wanted)
        .slice(0, 1);
    }
    if (sql.includes("FROM bond_period_rates")) return data.rates;
    if (sql.includes("FROM benchmark_series")) return data.series;
    if (sql.includes("FROM benchmark_values")) return data.values;
    if (sql.includes("FROM securities")) return data.securities;
    if (sql.includes("FROM investment_transactions")) return data.ledger;
    throw new Error(`unexpected query: ${sql}`);
  });
  const service = new BondValuationService(dataSource as unknown as DataSource);
  return { service, manager, dataSource, calls };
}

const request = (over: Partial<ValueLotRequest> = {}): ValueLotRequest => ({
  issuerCountryCode: "PL",
  issuerCode: "PL_MF",
  seriesCode: "TOS1029",
  lot: { purchaseDate: "2026-10-15", quantity: 1 },
  asOf: "2027-04-15",
  ...over,
});

const edoTerms = { version: 1, terms: manifestDocument("edo1036") };
const edoInstrument = [
  { id: "i2", series_code: "EDO1036", currency_code: "PLN" },
];
const edoRequest = (over: Partial<ValueLotRequest> = {}) =>
  request({
    seriesCode: "EDO1036",
    lot: { purchaseDate: "2026-10-01", quantity: 1 },
    asOf: "2027-10-16",
    ...over,
  });

describe("BondValuationService", () => {
  it("values the lot in one transaction, with the shared calendars", async () => {
    const { service, dataSource } = setup({});
    const valuation = await service.valueLot(request());
    expect(valuation).toMatchObject({
      seriesCode: "TOS1029",
      termsVersion: 1,
      earlyRedemptionValue: "101.19",
    });
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(BOND_CALENDARS.get("PL")).toBeDefined();
  });

  it("uses the newest terms version unless one is named", async () => {
    const v2 = manifestDocument("tos1029");
    v2.rateRule.annualRate = "0.0500";
    const { service, calls } = setup({
      terms: [
        { version: 2, terms: v2 },
        { version: 1, terms: manifestDocument("tos1029") },
      ],
    });
    const newest = await service.valueLot(request());
    expect(newest.termsVersion).toBe(2);
    expect(newest.currentPeriod?.annualRate).toBe("0.0500");
    expect(
      calls.find((c) => c.sql.includes("bond_terms_versions"))?.sql,
    ).toMatch(/ORDER BY version DESC\s+LIMIT 1/);

    const named = await service.valueLot(request({ termsVersion: 1 }));
    expect(named.termsVersion).toBe(1);
    expect(named.currentPeriod?.annualRate).toBe("0.0440");
  });

  it("passes announced rates through as exact strings", async () => {
    const { service } = setup({
      instruments: edoInstrument,
      terms: [edoTerms],
      rates: [{ period_number: 2, annual_rate: "0.0490000000" }],
      series: [],
    });
    const v = await service.valueLot(edoRequest());
    expect(v.currentPeriod).toMatchObject({
      index: 2,
      annualRate: "0.0490",
      rateSource: "ANNOUNCED",
    });
  });

  it("maps a MONTHLY series to year-month keys", async () => {
    const { service, calls } = setup({
      instruments: edoInstrument,
      terms: [edoTerms],
      series: [{ kind: "MONTHLY", publisher: "GUS", covered_through: null }],
      values: [{ observation_date: "2027-08-01", value: "0.0290000000" }],
    });
    const v = await service.valueLot(edoRequest());
    expect(v.currentPeriod).toMatchObject({
      annualRate: "0.0490",
      rateSource: "DERIVED",
    });
    expect(
      calls.find((c) => c.sql.includes("FROM benchmark_series"))?.params,
    ).toEqual(["PL_CPI_GUS_YOY"]);
  });

  it("names a missing month, with the publisher of the stored series", async () => {
    const { service } = setup({
      instruments: edoInstrument,
      terms: [edoTerms],
      series: [{ kind: "MONTHLY", publisher: "GUS", covered_through: null }],
      values: [{ observation_date: "2027-07-01", value: "0.0290000000" }],
    });
    const v = await service.valueLot(edoRequest());
    expect(v.grossValue).toBeNull();
    expect(v.missing).toEqual([
      {
        benchmarkId: "PL_CPI_GUS_YOY",
        observation: "2027-08",
        publisher: "GUS",
      },
    ]);
  });

  it("maps a STEP series to changes and coverage", async () => {
    const ror = { version: 1, terms: manifestDocument("ror1027") };
    const { service } = setup({
      instruments: [{ id: "i3", series_code: "ROR1027", currency_code: "PLN" }],
      terms: [ror],
      series: [
        { kind: "STEP", publisher: "NBP", covered_through: "2026-10-19" },
      ],
      values: [
        { observation_date: "2026-09-01", value: "0.0450000000" },
        { observation_date: "2026-10-19", value: "0.0425000000" },
      ],
    });
    const v = await service.valueLot(
      request({
        seriesCode: "ROR1027",
        lot: { purchaseDate: "2026-10-31", quantity: 1 },
        asOf: "2026-12-05",
      }),
    );
    expect(v.currentPeriod).toMatchObject({
      annualRate: "0.0425",
      rateSource: "DERIVED",
    });
  });

  it("treats an absent benchmark series as absent, not as zero", async () => {
    const { service, calls } = setup({
      instruments: edoInstrument,
      terms: [edoTerms],
    });
    const v = await service.valueLot(edoRequest());
    expect(v.missing).toEqual([
      {
        benchmarkId: "PL_CPI_GUS_YOY",
        observation: "2027-08",
        publisher: null,
      },
    ]);
    expect(calls.some((c) => c.sql.includes("FROM benchmark_values"))).toBe(
      false,
    );
  });

  it("does not read a benchmark for a fixed-rate bond", async () => {
    const { service, calls } = setup({});
    await service.valueLot(request());
    expect(calls.some((c) => c.sql.includes("benchmark"))).toBe(false);
  });

  it("forwards the projection to the engine", async () => {
    const { service } = setup({
      instruments: edoInstrument,
      terms: [edoTerms],
    });
    const v = await service.valueLot(
      edoRequest({
        asOf: "2026-10-10",
        projection: new Map([["PL_CPI_GUS_YOY", "0.0300"]]),
      }),
    );
    expect(v.projectionAssumptions).toHaveLength(1);
  });

  it("refuses a missing instrument, naming it", async () => {
    const { service } = setup({ instruments: [] });
    await expect(service.valueLot(request())).rejects.toThrow(
      new BondDataNotFoundError(
        "No bond instrument stored for PL PL_MF TOS1029",
      ),
    );
  });

  it("refuses missing terms, and a missing named version", async () => {
    const { service } = setup({ terms: [] });
    await expect(service.valueLot(request())).rejects.toThrow(
      "No terms version stored for PL PL_MF TOS1029",
    );
    const named = setup({});
    await expect(
      named.service.valueLot(request({ termsVersion: 7 })),
    ).rejects.toThrow("No terms version 7 stored for PL PL_MF TOS1029");
  });

  it("refuses terms that contradict the instrument row", async () => {
    const wrongSeries = setup({
      instruments: [{ id: "i1", series_code: "TOS1030", currency_code: "PLN" }],
    });
    await expect(
      wrongSeries.service.valueLot(request()),
    ).rejects.toBeInstanceOf(BondDataInconsistentError);
    const wrongCurrency = setup({
      instruments: [{ id: "i1", series_code: "TOS1029", currency_code: "EUR" }],
    });
    await expect(wrongCurrency.service.valueLot(request())).rejects.toThrow(
      /describe TOS1029 in PLN, but the instrument row is TOS1029 in EUR/,
    );
  });

  it("refuses stored terms that do not parse", async () => {
    const { service } = setup({
      terms: [{ version: 1, terms: { schemaVersion: 1 } }],
    });
    await expect(service.valueLot(request())).rejects.toThrow(
      /Invalid bond terms/,
    );
  });

  describe("loadReference and valueLotFrom: the data is read once", () => {
    it("loads by instrument id, then values any number of (lot, asOf) pairs without another query", async () => {
      const { service, manager, calls } = setup({});
      const reference = await service.loadReference(manager as never, "i1");
      const queries = calls.length;
      expect(
        calls.find((c) => c.sql.includes("FROM bond_instruments"))?.params,
      ).toEqual(["i1"]);
      expect(reference).toMatchObject({
        termsVersion: 1,
        instrument: {
          id: "i1",
          seriesCode: "TOS1029",
          currencyCode: "PLN",
        },
      });

      const values = ["2026-10-15", "2026-10-16", "2027-04-15"].map((asOf) =>
        service.valueLotFrom(
          reference,
          { purchaseDate: "2026-10-15", quantity: 25 },
          asOf,
        ),
      );

      expect(calls).toHaveLength(queries);
      // 25 bonds, 182 days into the 365-day period: 25 x 102.19.
      expect(values.map((v) => v.grossValue)).toEqual([
        "2500.00",
        "2500.25",
        "2554.75",
      ]);
    });

    it("agrees with valueLot", async () => {
      const { service, manager } = setup({});
      const reference = await service.loadReference(manager as never, "i1");
      expect(
        service.valueLotFrom(reference, request().lot, request().asOf),
      ).toEqual(await service.valueLot(request()));
    });

    it("throws not-found for an id that is not stored, and refuses contradicting rows", async () => {
      const missing = setup({ instruments: [] });
      await expect(
        missing.service.loadReference(missing.manager as never, "nope"),
      ).rejects.toBeInstanceOf(BondDataNotFoundError);

      const wrong = setup({
        instruments: [
          { id: "i1", series_code: "TOS1029", currency_code: "EUR" },
        ],
      });
      await expect(
        wrong.service.loadReference(wrong.manager as never, "i1"),
      ).rejects.toBeInstanceOf(BondDataInconsistentError);
    });
  });

  describe("valueSecurity", () => {
    const owned = [
      {
        id: "sec-1",
        user_id: "user-1",
        symbol: "TOS1029",
        currency_code: "PLN",
        bond_instrument_id: "i1",
      },
    ];
    const buy = (date: string, quantity: string) => ({
      action: "BUY",
      status: "UNRECONCILED",
      tx_date: date,
      quantity,
      paired_transfer: false,
    });

    it("values every lot open on asOf and totals them exactly", async () => {
      const { service, calls } = setup({
        securities: owned,
        ledger: [
          buy("2026-10-15", "25.00000000"),
          buy("2026-11-15", "10.00000000"),
          // After asOf: not open on that day, so neither listed nor totalled.
          buy("2027-05-01", "99.00000000"),
        ],
      });

      const result = await service.valueSecurity(
        "user-1",
        "sec-1",
        "2027-04-15",
      );

      expect(
        calls.find((c) => c.sql.includes("FROM securities"))?.params,
      ).toEqual(["sec-1", "user-1"]);
      expect(result.instrument).toMatchObject({
        id: "i1",
        seriesCode: "TOS1029",
      });
      expect(result.refusal).toBeNull();
      expect(
        result.lots.map((l) => [
          l.purchaseDate,
          l.quantity,
          l.purchaseDateAssumed,
          l.valuation.grossValue,
        ]),
      ).toEqual([
        // 182 days in: 102.19 per bond.
        ["2026-10-15", 25, false, "2554.75"],
        // 151 days in: 101.82 per bond.
        ["2026-11-15", 10, false, "1018.20"],
      ]);
      expect(result.totals).toMatchObject({
        quantity: 35,
        grossValue: "3572.95",
      });
      expect(result.totals.accruedInterest).toBe("72.95");
    });

    it("makes a total null unless every lot has the figure: a subtotal is not a total", async () => {
      const { service } = setup({
        securities: owned,
        // Bought 3 days ago, so early redemption is outside its window, while
        // the older lot is inside it.
        ledger: [buy("2026-10-15", "25"), buy("2027-04-12", "10")],
      });
      const result = await service.valueSecurity(
        "user-1",
        "sec-1",
        "2027-04-15",
      );
      expect(result.lots[0].valuation.earlyRedemptionValue).not.toBeNull();
      expect(result.lots[1].valuation.earlyRedemptionValue).toBeNull();
      expect(result.totals.earlyRedemptionValue).toBeNull();
      expect(result.totals.grossValue).not.toBeNull();
    });

    it("reports a known zero when nothing is held, and names the refusal when the lots cannot be derived", async () => {
      const none = setup({ securities: owned, ledger: [] });
      expect(
        (await none.service.valueSecurity("user-1", "sec-1", "2027-04-15"))
          .totals,
      ).toEqual({
        quantity: 0,
        grossValue: "0.00",
        earlyRedemptionValue: "0.00",
        accruedInterest: "0.00",
      });

      const split = setup({
        securities: owned,
        ledger: [
          buy("2026-10-15", "25"),
          { ...buy("2026-12-01", "2"), action: "SPLIT" },
        ],
      });
      const result = await split.service.valueSecurity(
        "user-1",
        "sec-1",
        "2027-04-15",
      );
      expect(result.lots).toEqual([]);
      expect(result.refusal).toMatchObject({ code: "SPLIT" });
      expect(result.totals).toEqual({
        quantity: null,
        grossValue: null,
        earlyRedemptionValue: null,
        accruedInterest: null,
      });
      // The same ledger, a day before the split: lots are known.
      expect(
        (await split.service.valueSecurity("user-1", "sec-1", "2026-11-30"))
          .refusal,
      ).toBeNull();
    });

    it("answers 404 for another user's, a missing or an unlinked security", async () => {
      const foreign = setup({ securities: [] });
      await expect(
        foreign.service.valueSecurity("user-2", "sec-1", "2027-04-15"),
      ).rejects.toBeInstanceOf(NotFoundException);
      const unlinked = setup({
        securities: [{ ...owned[0], bond_instrument_id: null }],
      });
      await expect(
        unlinked.service.valueSecurity("user-1", "sec-1", "2027-04-15"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
