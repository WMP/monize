import { Logger, NotFoundException } from "@nestjs/common";
import { DataSource } from "typeorm";
import { FetchSyncJob } from "../common/jobs/fetch-sync.service";
import { createScopedDbMocks } from "../test-helpers/scoped-db-testing";
import { manifest } from "./adapters/pl/pl-test-input";
import {
  BOND_ENGINE_PRICE_SOURCE,
  BondPriceService,
} from "./bond-price.service";
import {
  BondReferenceData,
  BondValuationService,
} from "./bond-valuation.service";

jest.mock("../common/db/scoped-db", () =>
  jest.requireActual("../test-helpers/scoped-db-testing").scopedDbMockModule(),
);
jest.mock("../common/db/with-context", () => ({
  withSystemContext: jest.fn((fn: () => unknown) => fn()),
  withUserContext: jest.fn((_userId: string, fn: () => unknown) => fn()),
}));
jest.mock("../securities/holding-accounts-dirty.util", () => ({
  markHoldingAccountsDirty: jest.fn(),
}));
jest.mock("../securities/portfolio-summary-memo", () => ({
  invalidatePortfolioSummary: jest.fn(),
}));

import { withSystemContext, withUserContext } from "../common/db/with-context";
import { markHoldingAccountsDirty } from "../securities/holding-accounts-dirty.util";
import { invalidatePortfolioSummary } from "../securities/portfolio-summary-memo";

const USER = "user-1";
const SECURITY = "sec-1";
const INSTRUMENT = "11111111-1111-5111-8111-111111111111";

/** TOS1029: 100.00 face, 4.40 % for the first 12-month period, per-bond value rounded to cents. */
const TOS: BondReferenceData = {
  instrument: {
    id: INSTRUMENT,
    issuerCountryCode: "PL",
    issuerCode: "PL_MF",
    programCode: "TOS",
    seriesCode: "TOS1029",
    currencyCode: "PLN",
  },
  termsVersion: 1,
  terms: manifest("tos1029"),
  announcedRates: new Map(),
  benchmarks: new Map(),
};

/**
 * The per-bond gross value `a` days into a 365-day first period, in cents,
 * computed on its own (integers only): 100 x (1 + 0.044 a / 365), half-up.
 */
function grossCents(a: number): bigint {
  const num = 10000n * (365000n + 44n * BigInt(a));
  return (2n * num + 365000n) / (2n * 365000n);
}
const money = (cents: bigint) =>
  `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
/** price = sum(lot cents x quantity) / quantity, 10 decimals. */
function price(lots: Array<{ a: number; qty: bigint }>): string {
  const total = lots.reduce((s, l) => s + grossCents(l.a) * l.qty, 0n);
  const qty = lots.reduce((s, l) => s + l.qty, 0n);
  const scaled = (2n * total * 10n ** 10n + qty * 100n) / (2n * qty * 100n);
  const digits = scaled.toString().padStart(11, "0");
  return `${digits.slice(0, -10)}.${digits.slice(-10)}`;
}

interface Tx {
  action: string;
  status?: string;
  date: string;
  quantity: string | null;
  paired?: boolean;
}

function setup(
  transactions: Tx[],
  opts: {
    upsertRows?: number;
    deleteRows?: number;
    security?: unknown[];
    reference?: BondReferenceData;
  } = {},
) {
  const { manager, dataSource } = createScopedDbMocks();
  const events: string[] = [];
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  dataSource.transaction.mockImplementation(
    async (fn: (m: unknown) => unknown) => {
      events.push("begin");
      const result = await fn(manager);
      events.push("commit");
      return result;
    },
  );
  manager.query.mockImplementation(async (sql: string, params: unknown[]) => {
    statements.push({ sql, params });
    if (sql.includes("FROM securities")) {
      return (
        opts.security ?? [
          {
            id: SECURITY,
            user_id: USER,
            symbol: "TOS1029",
            currency_code: "PLN",
            bond_instrument_id: INSTRUMENT,
          },
        ]
      );
    }
    if (sql.includes("FROM investment_transactions")) {
      return transactions.map((t) => ({
        action: t.action,
        status: t.status ?? "UNRECONCILED",
        tx_date: t.date,
        quantity: t.quantity,
        paired_transfer: t.paired ?? false,
      }));
    }
    if (sql.includes("INSERT INTO security_prices")) {
      events.push("upsert");
      return Array.from({ length: opts.upsertRows ?? 0 }, (_, i) => ({
        id: i,
      }));
    }
    if (sql.includes("DELETE FROM security_prices")) {
      events.push("delete");
      // A DELETE ... RETURNING answers the tuple [rows, rowCount].
      const rows = Array.from({ length: opts.deleteRows ?? 0 }, (_, i) => ({
        id: i,
      }));
      return [rows, rows.length];
    }
    throw new Error(`unexpected query: ${sql}`);
  });

  const valuation = new BondValuationService(
    dataSource as unknown as DataSource,
  );
  jest
    .spyOn(valuation, "loadReference")
    .mockResolvedValue(opts.reference ?? TOS);
  const netWorth = {
    triggerDebouncedRecalc: jest.fn(() => events.push("recalc")),
  };
  (markHoldingAccountsDirty as jest.Mock).mockImplementation(async () => {
    events.push("dirty");
    return ["acct-1", "acct-2"];
  });
  (invalidatePortfolioSummary as jest.Mock).mockImplementation(() =>
    events.push("invalidate"),
  );
  const fetchSync = {
    withLease: jest.fn(async (_job: string, _ms: number, fn: () => unknown) =>
      fn(),
    ),
  };
  const service = new BondPriceService(
    dataSource as unknown as DataSource,
    valuation,
    netWorth as never,
    fetchSync as never,
  );
  const call = (sqlPart: string) =>
    statements.find((s) => s.sql.includes(sqlPart));
  return { service, valuation, netWorth, fetchSync, events, statements, call };
}

const buy = (date: string, quantity: string): Tx => ({
  action: "BUY",
  date,
  quantity,
});

describe("BondPriceService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  describe("recomputeSecurity: the price of each day", () => {
    it("is the engine's gross value per bond on every day from the first lot to today", async () => {
      const { service, call } = setup([buy("2026-10-15", "25.00000000")]);

      await service.recomputeSecurity(USER, SECURITY, { today: "2026-10-20" });

      const [, dates, prices] = call("INSERT INTO security_prices")!.params;
      expect(dates).toEqual([
        "2026-10-15",
        "2026-10-16",
        "2026-10-17",
        "2026-10-18",
        "2026-10-19",
        "2026-10-20",
      ]);
      expect(prices).toEqual(
        [0, 1, 2, 3, 4, 5].map((a) => price([{ a, qty: 25n }])),
      );
      // The cents a reader can check by hand: 100.00, then 100.01 (0.0120547..).
      expect((prices as string[]).slice(0, 2)).toEqual([
        "100.0000000000",
        "100.0100000000",
      ]);
    });

    it("equals the TOS value 182 days in: 102.19 per bond, 2554.75 for 25", async () => {
      const { service, call } = setup([buy("2026-10-15", "25")]);
      await service.recomputeSecurity(USER, SECURITY, { today: "2027-04-15" });

      const [, dates, prices] = call("INSERT INTO security_prices")!.params as [
        string,
        string[],
        string[],
      ];
      expect(dates[dates.length - 1]).toBe("2027-04-15");
      expect(prices[prices.length - 1]).toBe("102.1900000000");
      expect(money(grossCents(182) * 25n)).toBe("2554.75");
    });

    it("averages lots of different dates by quantity, per bond", async () => {
      const { service, call } = setup([
        buy("2026-10-15", "10"),
        buy("2026-11-15", "30"),
      ]);
      await service.recomputeSecurity(USER, SECURITY, { today: "2026-11-15" });

      const [, dates, prices] = call("INSERT INTO security_prices")!.params as [
        string,
        string[],
        string[],
      ];
      const at = (d: string) => prices[dates.indexOf(d)];
      // Before the second purchase: the first lot alone, 30 days in.
      expect(at("2026-11-14")).toBe(price([{ a: 30, qty: 10n }]));
      // On it: 31 days into lot 1, 0 into lot 2, weighted 10 : 30.
      expect(at("2026-11-15")).toBe(
        price([
          { a: 31, qty: 10n },
          { a: 0, qty: 30n },
        ]),
      );
      expect(at("2026-11-15")).toBe("100.0925000000");
    });

    it("prices a past day on the lots held that day, not on what is left today", async () => {
      const { service, call } = setup([
        buy("2026-10-15", "10"),
        { action: "SELL", date: "2026-10-18", quantity: "10" },
        buy("2026-10-20", "5"),
      ]);
      await service.recomputeSecurity(USER, SECURITY, { today: "2026-10-21" });

      const [, dates, prices] = call("INSERT INTO security_prices")!.params as [
        string,
        string[],
        string[],
      ];
      // Held 15th-17th (sold out on the 18th: no lots, no price), bought again on the 20th.
      expect(dates).toEqual([
        "2026-10-15",
        "2026-10-16",
        "2026-10-17",
        "2026-10-20",
        "2026-10-21",
      ]);
      expect(prices[2]).toBe(price([{ a: 2, qty: 10n }]));
      expect(prices[3]).toBe(price([{ a: 0, qty: 5n }]));
    });

    it("gives no price from the day the lots become unknowable (a split), and keeps the days before", async () => {
      const { service, call } = setup([
        buy("2026-10-15", "10"),
        { action: "SPLIT", date: "2026-10-17", quantity: "2" },
      ]);
      await service.recomputeSecurity(USER, SECURITY, { today: "2026-10-20" });
      const [, dates] = call("INSERT INTO security_prices")!.params;
      expect(dates).toEqual(["2026-10-15", "2026-10-16"]);
    });

    it("skips a day on which any open lot has no gross value, never pricing it from the others", async () => {
      const { service, valuation, call } = setup([
        buy("2026-10-15", "10"),
        buy("2026-10-16", "30"),
      ]);
      const real = valuation.valueLotFrom.bind(valuation);
      jest
        .spyOn(valuation, "valueLotFrom")
        .mockImplementation((reference, lot, asOf, projection) => {
          const valuation = real(reference, lot, asOf, projection);
          // The second lot has no rate on the 18th (a started period, INV-BOND-002).
          return lot.purchaseDate === "2026-10-16" && asOf === "2026-10-18"
            ? { ...valuation, grossValue: null }
            : valuation;
        });

      await service.recomputeSecurity(USER, SECURITY, { today: "2026-10-19" });

      const [, dates] = call("INSERT INTO security_prices")!.params;
      expect(dates).toEqual([
        "2026-10-15",
        "2026-10-16",
        "2026-10-17",
        "2026-10-19",
      ]);
    });

    it("ignores VOID rows and prices nothing when there are no lots", async () => {
      const { service, call } = setup([
        { ...buy("2026-10-15", "10"), status: "VOID" },
      ]);
      const result = await service.recomputeSecurity(USER, SECURITY, {
        today: "2026-10-20",
      });
      expect(call("INSERT INTO security_prices")).toBeUndefined();
      expect(call("DELETE FROM security_prices")!.params[1]).toEqual([]);
      expect(result).toEqual({ written: 0, deleted: 0 });
    });

    it("loads the reference data once however many days it prices", async () => {
      const { service, valuation } = setup([buy("2026-10-15", "10")]);
      await service.recomputeSecurity(USER, SECURITY, { today: "2027-04-15" });
      expect(valuation.loadReference).toHaveBeenCalledTimes(1);
      expect(valuation.loadReference).toHaveBeenCalledWith(
        expect.anything(),
        INSTRUMENT,
      );
    });
  });

  describe("recomputeSecurity: what is written", () => {
    it("upserts only over a bond_engine row whose close differs, binding the one source constant", async () => {
      const { service, call } = setup([buy("2026-10-15", "10")]);
      await service.recomputeSecurity(USER, SECURITY, { today: "2026-10-16" });

      const upsert = call("INSERT INTO security_prices")!;
      expect(BOND_ENGINE_PRICE_SOURCE).toBe("bond_engine");
      expect(upsert.sql).toMatch(
        /ON CONFLICT \(security_id, price_date\) DO UPDATE/,
      );
      expect(upsert.sql).toMatch(
        /WHERE security_prices\.source = \$4::varchar/,
      );
      expect(upsert.sql).toMatch(
        /security_prices\.close_price IS DISTINCT FROM EXCLUDED\.close_price/,
      );
      expect(upsert.params[3]).toBe("bond_engine");
      expect(upsert.params[0]).toBe(SECURITY);
    });

    it("deletes bond_engine rows of the days that no longer have a price, and only those", async () => {
      const { service, call } = setup([buy("2026-10-15", "10")], {
        deleteRows: 3,
      });
      const result = await service.recomputeSecurity(USER, SECURITY, {
        today: "2026-10-16",
      });

      const del = call("DELETE FROM security_prices")!;
      expect(del.sql).toMatch(/source = \$3::varchar/);
      expect(del.sql).toMatch(/NOT \(price_date = ANY\(\$2::date\[\]\)\)/);
      expect(del.params).toEqual([
        SECURITY,
        ["2026-10-15", "2026-10-16"],
        "bond_engine",
      ]);
      expect(result.deleted).toBe(3);
    });

    it("counts only the rows the upsert reports: an unchanged day or a manual one is not written", async () => {
      const { service } = setup([buy("2026-10-15", "10")], { upsertRows: 1 });
      await expect(
        service.recomputeSecurity(USER, SECURITY, { today: "2026-10-16" }),
      ).resolves.toEqual({ written: 1, deleted: 0 });
    });

    it("loads the security under the caller's identity, and a foreign or unlinked one is a 404 before any write", async () => {
      const foreign = setup([buy("2026-10-15", "10")], { security: [] });
      await expect(
        foreign.service.recomputeSecurity(USER, SECURITY),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(foreign.call("FROM securities")!.params).toEqual([SECURITY, USER]);
      expect(foreign.call("INSERT INTO security_prices")).toBeUndefined();
      expect(foreign.call("DELETE FROM security_prices")).toBeUndefined();

      const unlinked = setup([], {
        security: [
          {
            id: SECURITY,
            user_id: USER,
            symbol: "X",
            currency_code: "PLN",
            bond_instrument_id: null,
          },
        ],
      });
      await expect(
        unlinked.service.recomputeSecurity(USER, SECURITY),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("reads the ledger in the register order every replay uses, text quantities, across accounts", async () => {
      const { service, call } = setup([buy("2026-10-15", "10")]);
      await service.recomputeSecurity(USER, SECURITY, { today: "2026-10-15" });
      const ledger = call("FROM investment_transactions t")!;
      expect(ledger.sql).toContain(
        "ORDER BY transaction_date ASC, created_at ASC, id ASC",
      );
      expect(ledger.sql).toContain("t.quantity::text");
      expect(ledger.sql).not.toMatch(/account_id\s*=/);
      expect(ledger.params).toEqual([SECURITY, USER]);
    });
  });

  describe("recomputeSecurity: derived state (INV-CACHE-001)", () => {
    it("marks the holding accounts inside the transaction and dispatches the recompute only after the commit", async () => {
      const { service, netWorth, events } = setup([buy("2026-10-15", "10")], {
        upsertRows: 2,
      });
      await service.recomputeSecurity(USER, SECURITY, { today: "2026-10-16" });

      expect(markHoldingAccountsDirty).toHaveBeenCalledWith(
        expect.anything(),
        SECURITY,
        USER,
      );
      expect(events).toEqual([
        "begin",
        "upsert",
        "delete",
        "dirty",
        "commit",
        "invalidate",
        "recalc",
        "recalc",
      ]);
      expect(netWorth.triggerDebouncedRecalc).toHaveBeenCalledWith(
        "acct-1",
        USER,
      );
      expect(netWorth.triggerDebouncedRecalc).toHaveBeenCalledWith(
        "acct-2",
        USER,
      );
    });

    it("does nothing downstream when nothing changed", async () => {
      const { service, netWorth, events } = setup([buy("2026-10-15", "10")]);
      await service.recomputeSecurity(USER, SECURITY, { today: "2026-10-16" });
      expect(markHoldingAccountsDirty).not.toHaveBeenCalled();
      expect(invalidatePortfolioSummary).not.toHaveBeenCalled();
      expect(netWorth.triggerDebouncedRecalc).not.toHaveBeenCalled();
      expect(events).not.toContain("recalc");
    });

    it("dispatches after a delete alone", async () => {
      const { service, netWorth } = setup([], { deleteRows: 1 });
      await service.recomputeSecurity(USER, SECURITY, { today: "2026-10-16" });
      expect(invalidatePortfolioSummary).toHaveBeenCalledWith(USER);
      expect(netWorth.triggerDebouncedRecalc).toHaveBeenCalledTimes(2);
    });
  });

  describe("the daily job", () => {
    const linkedRows = [
      { id: "s-a1", user_id: "u-a" },
      { id: "s-a2", user_id: "u-a" },
      { id: "s-b1", user_id: "u-b" },
    ];

    it("lists linked securities across users, then recomputes each user in its own context", async () => {
      const { service, manager } = setupForJob(linkedRows);
      const recompute = jest
        .spyOn(service, "recomputeSecurity")
        .mockResolvedValue({ written: 0, deleted: 0 });

      const result = await service.recomputeAll();

      expect(manager.query).toHaveBeenCalledWith(
        expect.stringContaining("WHERE bond_instrument_id IS NOT NULL"),
      );
      expect(
        (withUserContext as jest.Mock).mock.calls.map((c) => c[0]),
      ).toEqual(["u-a", "u-b"]);
      expect(recompute.mock.calls.map((c) => c.slice(0, 2))).toEqual([
        ["u-a", "s-a1"],
        ["u-a", "s-a2"],
        ["u-b", "s-b1"],
      ]);
      expect(result).toEqual({ securities: 3, failed: 0 });
    });

    it("isolates a failing security: logged, and the rest still run", async () => {
      const { service } = setupForJob(linkedRows);
      const recompute = jest
        .spyOn(service, "recomputeSecurity")
        .mockRejectedValueOnce(new Error("no rate"))
        .mockResolvedValue({ written: 0, deleted: 0 });

      const result = await service.recomputeAll();

      expect(recompute).toHaveBeenCalledTimes(3);
      expect(result).toEqual({ securities: 3, failed: 1 });
      expect(Logger.prototype.error).toHaveBeenCalledWith(
        expect.stringContaining("security s-a1: no rate"),
      );
    });

    it("isolates a failing user context: its securities count as failed, the next user still runs", async () => {
      const { service } = setupForJob(linkedRows);
      (withUserContext as jest.Mock).mockImplementationOnce(async () => {
        throw new Error("context refused");
      });
      const recompute = jest
        .spyOn(service, "recomputeSecurity")
        .mockResolvedValue({ written: 0, deleted: 0 });

      const result = await service.recomputeAll();

      expect(recompute.mock.calls.map((c) => c[1])).toEqual(["s-b1"]);
      expect(result).toEqual({ securities: 3, failed: 2 });
    });

    it("runs under a system context wrapped around the whole lease call, and never throws out of the cron", async () => {
      const { service, fetchSync } = setupForJob([]);
      const all = jest
        .spyOn(service, "recomputeAll")
        .mockResolvedValue({ securities: 0, failed: 0 });

      await service.scheduledRecompute();

      expect(withSystemContext).toHaveBeenCalledTimes(1);
      expect(fetchSync.withLease).toHaveBeenCalledWith(
        FetchSyncJob.BondPrices,
        30 * 60 * 1000,
        expect.any(Function),
      );
      expect(all).toHaveBeenCalledTimes(1);

      fetchSync.withLease.mockRejectedValueOnce(new Error("db down"));
      await expect(service.scheduledRecompute()).resolves.toBeUndefined();
      expect(Logger.prototype.error).toHaveBeenCalledWith(
        expect.stringContaining("db down"),
      );
    });
  });
});

function setupForJob(linked: Array<{ id: string; user_id: string }>) {
  const { manager, dataSource } = createScopedDbMocks();
  manager.query.mockResolvedValue(linked);
  const fetchSync = {
    withLease: jest.fn(async (_job: string, _ms: number, fn: () => unknown) =>
      fn(),
    ),
  };
  const service = new BondPriceService(
    dataSource as unknown as DataSource,
    {} as never,
    {} as never,
    fetchSync as never,
  );
  return { service, manager, fetchSync };
}
