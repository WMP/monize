import type { DataSource, EntityManager } from "typeorm";
import {
  withPartialBudgetRead,
  recordBudgetComponent,
  stopIncompleteBudgetRead,
  currentBudgetPartialScope,
} from "./reporting-partial-budget";
import { currentReportingRead, withReportingRead } from "./reporting-basis";
jest.mock("../common/db/scoped-db", () => ({
  withScopedDb: async (
    source: { manager: EntityManager },
    fn: (m: EntityManager) => unknown,
  ) => fn(source.manager),
}));
const gap = {
  from: "USD",
  to: "EUR",
  date: "2026-10-31",
  reason: "missing_history",
};
function source(enabled = true, present = true) {
  return {
    manager: {
      getRepository: () => ({
        findOne: async () => ({
          accrualEnabled: enabled,
          reportingBasis: "accrual",
          defaultCurrency: "EUR",
        }),
      }),
      query: jest.fn().mockResolvedValue([{ present }]),
    },
  } as unknown as DataSource;
}
describe("partial budget read boundary", () => {
  it("withholds the calculated score/result while preserving separate known components", async () => {
    const result = await withPartialBudgetRead(source(), "owner", async () => {
      recordBudgetComponent("owner", "known", "EUR", "2026-10-01", -80);
      recordBudgetComponent("owner", "missing", "EUR", gap.date, null, gap);
      return { score: 100, remaining: 420 };
    });
    expect(result).toMatchObject({
      fxComplete: false,
      total: null,
      result: null,
      knownComponents: [{ knownSubtotal: -80 }],
      missingRatePairs: [gap],
      fetchAttempted: false,
    });
    expect(result).not.toHaveProperty("score");
    expect(result).not.toHaveProperty("remaining");
    expect(currentReportingRead("owner")).toBeUndefined();
  });
  it("stops optional advice work without swallowing unrelated errors", async () => {
    const optional = jest.fn();
    const result = await withPartialBudgetRead(source(), "owner", async () => {
      recordBudgetComponent("owner", "missing", "EUR", gap.date, null, gap);
      stopIncompleteBudgetRead("owner");
      optional();
      return { score: 100 };
    });
    expect(result).toHaveProperty("result", null);
    expect(optional).not.toHaveBeenCalled();
    await expect(
      withPartialBudgetRead(source(), "owner", async () => {
        throw new Error("database offline");
      }),
    ).rejects.toThrow("database offline");
  });

  it.each([
    [false, true],
    [true, false],
  ])(
    "does not allocate a partial scope on native execution (%s/%s)",
    async (enabled, present) => {
      const value = { score: 95 };
      expect(
        await withPartialBudgetRead(
          source(enabled, present),
          "owner",
          async () => {
            expect(currentBudgetPartialScope("owner")).toBeUndefined();
            return value;
          },
        ),
      ).toEqual(enabled ? { ...value, basis: "accrual" } : value);
    },
  );
  it("does not poison sibling reads and lets only the outer boundary finalize", async () => {
    const ds = source();
    const [partial, complete] = await Promise.all([
      withPartialBudgetRead(ds, "owner", async () => {
        const nested = await withPartialBudgetRead(ds, "owner", async () => {
          recordBudgetComponent("owner", "missing", "EUR", gap.date, null, gap);
          return { score: 100 };
        });
        expect(nested).toMatchObject({ score: 100 });
        return nested;
      }),
      withPartialBudgetRead(ds, "owner", async () => ({ score: 90 })),
    ]);
    expect(partial).toHaveProperty("result", null);
    expect(complete).toMatchObject({ score: 90 });
    expect(complete).not.toHaveProperty("result");
  });
  it("bounds diagnostic lists without claiming the derived result is complete", async () => {
    const result = await withPartialBudgetRead(source(), "owner", async () => {
      recordBudgetComponent("owner", "missing", "EUR", gap.date, null, gap);
      for (const id of Array.from({ length: 1002 }, (_, i) => String(i)))
        recordBudgetComponent("owner", id, "EUR", "2026-10-01", 1);
      return { score: 100 };
    });
    expect(result).toHaveProperty("detailsTruncated", true);
    expect("knownComponents" in result && result.knownComponents).toHaveLength(
      1000,
    );
    expect(result).toHaveProperty("result", null);
  });
});

it("isolates sibling partial boundaries inside one ambient reporting read", async () => {
  const ds = source();
  let release!: () => void;
  const barrier = new Promise<void>((done) => {
    release = done;
  });
  const results = await withReportingRead(ds, "owner", async () => {
    const first = withPartialBudgetRead(ds, "owner", async () => {
      recordBudgetComponent("owner", "first-known", "EUR", gap.date, 10);
      recordBudgetComponent("owner", "first-gap", "EUR", gap.date, null, gap);
      await barrier;
      return { score: 99 };
    });
    const second = withPartialBudgetRead(ds, "owner", async () => {
      recordBudgetComponent("owner", "second-known", "GBP", gap.date, 20);
      recordBudgetComponent("owner", "second-gap", "GBP", gap.date, null, {
        ...gap,
        to: "GBP",
      });
      return { score: 88 };
    });
    release();
    return Promise.all([first, second]);
  });
  expect(results[0]).toMatchObject({
    result: null,
    currency: "EUR",
    knownComponents: [{ id: "first-known", knownSubtotal: 10 }],
    missingRatePairs: [gap],
  });
  expect(results[1]).toMatchObject({
    result: null,
    currency: "GBP",
    knownComponents: [{ id: "second-known", knownSubtotal: 20 }],
    missingRatePairs: [{ ...gap, to: "GBP" }],
  });
});

it("does not expose an accumulator to a different owner or retain it after completion", async () => {
  await withPartialBudgetRead(source(), "owner", async () => {
    expect(currentBudgetPartialScope("owner")).toBeDefined();
    expect(currentBudgetPartialScope("other")).toBeUndefined();
  });
  expect(currentBudgetPartialScope("owner")).toBeUndefined();
});
