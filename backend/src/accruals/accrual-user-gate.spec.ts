import { requestContextStorage } from "../common/request-context";
import {
  userHasAnyAccrualSchedule,
  markAccrualScheduleExists,
} from "./accrual-user-gate";

describe("accrual user gate", () => {
  const managerWith = (present: boolean) => {
    const query = jest.fn().mockResolvedValue([{ present }]);
    return { query } as unknown as import("typeorm").EntityManager;
  };
  it("coalesces sibling checks for the same user within one request", async () => {
    const m = managerWith(false);
    await requestContextStorage.run({ userId: "owner" }, async () => {
      const [first, second] = await Promise.all([
        userHasAnyAccrualSchedule(m, "owner"),
        userHasAnyAccrualSchedule(m, "owner"),
      ]);
      expect(first).toBe(false);
      expect(second).toBe(false);
      expect(
        (m as unknown as { query: jest.Mock }).query,
      ).toHaveBeenCalledTimes(1);
    });
  });
  it("does not leak a cached answer into another request", async () => {
    const m = managerWith(false);
    await requestContextStorage.run({ userId: "owner" }, () =>
      userHasAnyAccrualSchedule(m, "owner"),
    );
    await requestContextStorage.run({ userId: "owner" }, () =>
      userHasAnyAccrualSchedule(m, "owner"),
    );
    expect((m as unknown as { query: jest.Mock }).query).toHaveBeenCalledTimes(
      2,
    );
  });
  it("re-queries outside a request scope every time", async () => {
    const m = managerWith(true);
    await userHasAnyAccrualSchedule(m, "owner");
    await userHasAnyAccrualSchedule(m, "owner");
    expect((m as unknown as { query: jest.Mock }).query).toHaveBeenCalledTimes(
      2,
    );
  });
  it("does not cache a failed lookup", async () => {
    const query = jest
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue([{ present: true }]);
    const m = { query } as unknown as import("typeorm").EntityManager;
    await requestContextStorage.run({ userId: "owner" }, async () => {
      await expect(userHasAnyAccrualSchedule(m, "owner")).rejects.toThrow(
        "offline",
      );
      await expect(userHasAnyAccrualSchedule(m, "owner")).resolves.toBe(true);
    });
    expect(query).toHaveBeenCalledTimes(2);
  });
  it("lets a just-created schedule override a cached false answer in the same request", async () => {
    const m = managerWith(false);
    await requestContextStorage.run({ userId: "owner" }, async () => {
      expect(await userHasAnyAccrualSchedule(m, "owner")).toBe(false);
      markAccrualScheduleExists("owner");
      expect(await userHasAnyAccrualSchedule(m, "owner")).toBe(true);
    });
    expect((m as unknown as { query: jest.Mock }).query).toHaveBeenCalledTimes(
      1,
    );
  });
  it("marking outside a request scope is a harmless no-op", () => {
    expect(() => markAccrualScheduleExists("owner")).not.toThrow();
  });
});
