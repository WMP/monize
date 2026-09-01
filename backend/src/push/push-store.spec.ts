import {
  EndpointClaimedError,
  PushDisabledReason,
  isChannelEnabled,
  listForUser,
  liveCountForUser,
  recordExpired,
  recordFailure,
  recordSuccess,
  remove,
  resetPushStoreForTests,
  resolveInstanceConfig,
  upsert,
} from "./push-store";

/**
 * TEST DRIVE BUILD -- but the substitution still needs proving.
 *
 * Everything else in `src/push/` is the real branch's code, copied unchanged and
 * covered by the real branch's specs. This store is the one thing that is NOT
 * that code: it stands in for two tables and a row-level security policy. The
 * properties those give for free are exactly what an in-memory Map can lose
 * silently, so they are asserted here rather than assumed:
 *
 *   * one endpoint has one owner, and the second subscriber is refused;
 *   * every read and write is scoped to the caller;
 *   * a retired device stays retired, and keeps the reason it was retired with.
 */
describe("the in-memory push store", () => {
  const USER = "11111111-1111-4111-8111-111111111111";
  const OTHER = "22222222-2222-4222-8222-222222222222";

  const device = (overrides: Partial<Parameters<typeof upsert>[0]> = {}) =>
    upsert({
      userId: USER,
      endpoint: "https://updates.push.services.mozilla.com/wpush/v2/abc",
      endpointHash: "hash-abc",
      p256dh: "p256dh",
      auth: "auth",
      deviceName: "Pixel 9",
      userAgent: "Mozilla/5.0",
      vapidPublicKey: "PUB",
      ...overrides,
    });

  beforeEach(() => resetPushStoreForTests());

  describe("ownership", () => {
    // The real table's unique index is on the endpoint hash ALONE, so one
    // endpoint has one owner. A Map keyed on a generated id would happily hold
    // two rows for one browser -- which is how the first account's notification
    // ends up decrypted on the device the second one is now using.
    it("refuses an endpoint another account registered", () => {
      device();

      expect(() => device({ userId: OTHER })).toThrow(EndpointClaimedError);
    });

    it("refreshes the row when the same account registers again", () => {
      const first = device();
      const again = device({ deviceName: "Pixel 9 Pro" });

      expect(again.id).toBe(first.id);
      expect(again.deviceName).toBe("Pixel 9 Pro");
      expect(listForUser(USER)).toHaveLength(1);
    });

    it("shows each account only its own devices", () => {
      device();
      device({ userId: OTHER, endpointHash: "hash-def" });

      expect(listForUser(USER).map((r) => r.endpointHash)).toEqual([
        "hash-abc",
      ]);
      expect(listForUser(OTHER).map((r) => r.endpointHash)).toEqual([
        "hash-def",
      ]);
    });

    it.each([
      ["remove", (id: string) => remove(OTHER, id)],
      [
        "recordExpired",
        (id: string) => recordExpired(OTHER, id, PushDisabledReason.GONE),
      ],
      ["recordFailure", (id: string) => recordFailure(OTHER, id, 1)],
    ])("refuses %s against another account's device", (_name, act) => {
      const row = device();

      expect(act(row.id)).toBe(false);
      expect(listForUser(USER)).toHaveLength(1);
    });

    it("ignores a success recorded by the wrong account", () => {
      const row = device();

      recordSuccess(OTHER, row.id);

      expect(listForUser(USER)[0].lastSuccessAt).toBeNull();
    });
  });

  describe("retirement", () => {
    it("retires a device once, keeping the first reason", () => {
      const row = device();

      expect(recordExpired(USER, row.id, PushDisabledReason.GONE)).toBe(true);
      // A device already retired as GONE must not be relabelled: the two ask the
      // user for different repairs.
      expect(recordExpired(USER, row.id, PushDisabledReason.KEY_ROTATED)).toBe(
        false,
      );
      expect(listForUser(USER)[0].disabledReason).toBe(PushDisabledReason.GONE);
    });

    it("counts transient failures and retires on the bound, not before", () => {
      const row = device();

      expect(recordFailure(USER, row.id, 3)).toBe(false);
      expect(recordFailure(USER, row.id, 3)).toBe(false);
      expect(recordFailure(USER, row.id, 3)).toBe(true);
      expect(listForUser(USER)[0].disabledReason).toBe(
        PushDisabledReason.FAILING,
      );
    });

    it("resets the counter on a success, so an occasional failure never retires", () => {
      const row = device();

      recordFailure(USER, row.id, 2);
      recordSuccess(USER, row.id);

      expect(recordFailure(USER, row.id, 2)).toBe(false);
      expect(listForUser(USER)[0].disabledAt).toBeNull();
    });

    it("counts a retired device out of the live total", () => {
      const row = device();
      device({ endpointHash: "hash-def", endpoint: "https://x.example/2" });

      recordExpired(USER, row.id, PushDisabledReason.GONE);

      expect(listForUser(USER)).toHaveLength(2);
      expect(liveCountForUser(USER)).toBe(1);
    });

    it("re-enables a retired device when it registers again", () => {
      const row = device();
      recordExpired(USER, row.id, PushDisabledReason.GONE);

      const again = device();

      expect(again.id).toBe(row.id);
      expect(again.disabledAt).toBeNull();
      expect(again.disabledReason).toBeNull();
      expect(liveCountForUser(USER)).toBe(1);
    });
  });

  describe("the instance key pair", () => {
    const KEYS = { publicKey: "PUB-GEN", privateKey: "PRIV-GEN" };

    afterEach(() => {
      delete process.env.PUSH_VAPID_PUBLIC_KEY;
      delete process.env.PUSH_VAPID_PRIVATE_KEY;
    });

    it("generates once and answers the same pair afterwards", () => {
      const generate = jest.fn(() => KEYS);

      const first = resolveInstanceConfig(generate);
      const second = resolveInstanceConfig(generate);

      expect(generate).toHaveBeenCalledTimes(1);
      expect(second.vapidPublicKey).toBe(first.vapidPublicKey);
    });

    // The reason the environment override exists: without it every restart
    // invalidates the subscriptions the browser already holds, which reads to a
    // tester as "push broke" rather than "the key pair was in memory".
    it("prefers a pair from the environment, so devices survive a restart", () => {
      process.env.PUSH_VAPID_PUBLIC_KEY = "PUB-ENV";
      process.env.PUSH_VAPID_PRIVATE_KEY = "PRIV-ENV";
      const generate = jest.fn(() => KEYS);

      const config = resolveInstanceConfig(generate);

      expect(generate).not.toHaveBeenCalled();
      expect(config.vapidPublicKey).toBe("PUB-ENV");
    });

    it.each([
      ["only the public half", "PUB-ENV", undefined],
      ["only the private half", undefined, "PRIV-ENV"],
      ["blank values", "  ", "  "],
    ])("generates when the environment supplies %s", (_name, pub, priv) => {
      if (pub !== undefined) process.env.PUSH_VAPID_PUBLIC_KEY = pub;
      if (priv !== undefined) process.env.PUSH_VAPID_PRIVATE_KEY = priv;
      const generate = jest.fn(() => KEYS);

      // Half a key pair is not a key pair: signing with a public half nobody
      // holds the private of produces a subscription nothing can deliver to.
      expect(resolveInstanceConfig(generate).vapidPublicKey).toBe("PUB-GEN");
      expect(generate).toHaveBeenCalledTimes(1);
    });

    it("reports the channel as on before anything has been resolved", () => {
      // There is no admin page in this build, so the channel is on by default --
      // otherwise the banner would never offer to enable anything.
      expect(isChannelEnabled()).toBe(true);
    });
  });
});
