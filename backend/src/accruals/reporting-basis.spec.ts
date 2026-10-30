import { reportingQuery } from "./reporting-query";
import { requestContextStorage } from "../common/request-context";
import type { DataSource, EntityManager } from "typeorm";
import {
  currentReportingRead,
  resolveReportingBasis,
  resolveReportingExecution,
  withReportingRead,
  reportingExecutionBasis,
} from "./reporting-basis";
jest.mock("../common/db/scoped-db", () => ({
  withScopedDb: async (
    source: { manager: EntityManager },
    fn: (m: EntityManager) => unknown,
  ) => fn(source.manager),
}));
function fixture(
  enabled: boolean,
  present = false,
  preferred?: "cash" | "accrual",
) {
  const preference = { accrualEnabled: enabled, reportingBasis: preferred };
  const query = jest.fn().mockResolvedValue([{ present }]);
  const manager = {
    getRepository: () => ({ findOne: async () => preference }),
    query,
  } as unknown as EntityManager;
  return { manager, query, source: { manager } as DataSource };
}
describe("selected basis and physical execution", () => {
  it("forces cash while disabled, including an explicit or remembered accrual selection", async () => {
    const f = fixture(false, true, "accrual");
    expect(await resolveReportingBasis(f.manager, "owner", "accrual")).toBe(
      "cash",
    );
    await withReportingRead(
      f.source,
      "owner",
      async () => {
        expect(currentReportingRead("owner")?.basis).toBe("cash");
        expect(
          await resolveReportingExecution(f.manager, "owner", "accrual"),
        ).toBe("cash");
      },
      "accrual",
    );
    expect(f.query).not.toHaveBeenCalled();
  });
  it("uses cash as the fallback default for an enabled user", async () => {
    const f = fixture(true);
    expect(await resolveReportingBasis(f.manager, "owner")).toBe("cash");
  });
  it("keeps the selected accrual label while using native SQL without schedules", async () => {
    const f = fixture(true, false, "accrual");
    const result = await withReportingRead(f.source, "owner", async () => {
      expect(currentReportingRead("owner")?.basis).toBe("accrual");
      expect(reportingExecutionBasis("owner")).toBe("cash");
      expect(await resolveReportingExecution(f.manager, "owner")).toBe("cash");
      return { total: 0 };
    });
    expect(result).toEqual({ total: 0, basis: "accrual" });
    expect(f.query).toHaveBeenCalledTimes(1);
    expect(currentReportingRead("owner")).toBeUndefined();
  });
  it("memoizes schedule presence per authorized account scope within one read only", async () => {
    const f = fixture(true, true, "accrual");
    const read = () =>
      withReportingRead(f.source, "owner", async () => {
        expect(reportingExecutionBasis("owner")).toBe("accrual");
        await resolveReportingExecution(f.manager, "owner", undefined, [
          "b",
          "a",
          "a",
        ]);
        await resolveReportingExecution(f.manager, "owner", undefined, [
          "a",
          "b",
        ]);
        expect(currentReportingRead("other")).toBeUndefined();
      });
    await read();
    expect(f.query).toHaveBeenCalledTimes(2);
    expect(f.query.mock.calls[1][1]).toEqual(["owner", ["b", "a", "a"]]);
    await read();
    expect(f.query).toHaveBeenCalledTimes(4);
  });
  it("preserves Map responses and leaves disabled-user payloads unchanged", async () => {
    const map = new Map([["category", { spent: 5 }]]);
    expect(
      await withReportingRead(
        fixture(true, true, "accrual").source,
        "owner",
        async () => map,
      ),
    ).toBe(map);
    const payload = { total: 5 };
    expect(
      await withReportingRead(
        fixture(false).source,
        "owner",
        async () => payload,
      ),
    ).toBe(payload);
  });
  it("validates basis input before opening a read", async () => {
    const f = fixture(true);
    await expect(
      withReportingRead(f.source, "owner", async () => 0, "invalid" as "cash"),
    ).rejects.toThrow();
    expect(f.query).not.toHaveBeenCalled();
  });
});

describe("reporting owner scope", () => {
  it.each(["cash", "accrual"] as const)(
    "refuses conflicting raw %s reads before preferences or SQL",
    async (basis) => {
      const f = fixture(true, true);
      await requestContextStorage.run({ userId: "authenticated" }, async () => {
        await expect(
          reportingQuery(
            f.manager,
            "other",
            "SELECT * FROM transactions",
            [],
            basis,
          ),
        ).rejects.toMatchObject({
          response: { code: "REPORTING_OWNER_MISMATCH" },
        });
      });
      expect(f.query).not.toHaveBeenCalled();
    },
  );
  it("uses the effective owner for a delegate and permits explicitly system-scoped reads", async () => {
    const f = fixture(false);
    await requestContextStorage.run(
      { userId: "owner", realUserId: "delegate" },
      async () => {
        expect(
          await withReportingRead(f.source, "owner", async () => "ok", "cash"),
        ).toBe("ok");
        await expect(
          reportingQuery(
            f.manager,
            "delegate",
            "SELECT * FROM transactions",
            [],
            "cash",
          ),
        ).rejects.toMatchObject({ status: 403 });
      },
    );
    await requestContextStorage.run({ system: true }, async () => {
      expect(
        await withReportingRead(
          f.source,
          "owner",
          async () => "system",
          "cash",
        ),
      ).toBe("system");
    });
  });
});

it("does not apply the raw-SQL mismatch policy to account-scoped joint readers", async () => {
  const f = fixture(false);
  await requestContextStorage.run({ userId: "joint-member" }, async () => {
    expect(
      await withReportingRead(
        f.source,
        "authorized-owner",
        async () => "account-scoped",
        "cash",
      ),
    ).toBe("account-scoped");
  });
});
