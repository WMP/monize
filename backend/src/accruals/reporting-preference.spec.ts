import { requestContextStorage } from "../common/request-context";
import type { UserPreference } from "../users/entities/user-preference.entity";
import { reportingPreference } from "./reporting-preference";

describe("reporting preference request snapshot", () => {
  const value = (enabled: boolean) =>
    ({ accrualEnabled: enabled, defaultCurrency: "USD" }) as UserPreference;
  it("coalesces sibling reads and does not retain the snapshot in another request", async () => {
    const load = jest.fn().mockResolvedValue(value(false));
    await requestContextStorage.run({ userId: "owner" }, async () => {
      const [first, second] = await Promise.all([
        reportingPreference("owner", load),
        reportingPreference("owner", load),
      ]);
      expect(first).toBe(second);
      expect(load).toHaveBeenCalledTimes(1);
      load.mockResolvedValue(value(true));
      expect((await reportingPreference("owner", load))?.accrualEnabled).toBe(
        false,
      );
    });
    await requestContextStorage.run({ userId: "owner" }, async () => {
      expect((await reportingPreference("owner", load))?.accrualEnabled).toBe(
        true,
      );
    });
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("keeps owners separate and copies the resolved row", async () => {
    const row = value(true);
    const load = jest.fn().mockResolvedValue(row);
    await requestContextStorage.run({ system: true }, async () => {
      const first = await reportingPreference("one", load);
      row.defaultCurrency = "EUR";
      expect(first?.defaultCurrency).toBe("USD");
      expect((await reportingPreference("two", load))?.defaultCurrency).toBe(
        "EUR",
      );
      expect(load).toHaveBeenCalledTimes(2);
    });
  });
  it("does not cache failures or reads outside a request", async () => {
    const load = jest
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(null);
    await requestContextStorage.run({ userId: "owner" }, async () => {
      await expect(reportingPreference("owner", load)).rejects.toThrow(
        "offline",
      );
      await expect(reportingPreference("owner", load)).resolves.toBeNull();
    });
    await reportingPreference("owner", load);
    await reportingPreference("owner", load);
    expect(load).toHaveBeenCalledTimes(4);
  });
});
