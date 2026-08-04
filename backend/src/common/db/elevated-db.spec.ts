import { EntityManager } from "typeorm";
import { requestContextStorage } from "../request-context";
import {
  BYPASS_OFF_SQL,
  BYPASS_ON_SQL,
  BYPASS_READ_SQL,
  callSiteFromStack,
  withElevatedDb,
} from "./elevated-db";

function makeManager(options: { elevated?: boolean } = {}) {
  const queries: string[] = [];
  // The real connection answers the bypass probe, and its answer is what decides
  // whether this window owns the restore. `elevated` simulates an outer window
  // this call cannot see.
  let bypass = options.elevated ? "on" : "";
  const manager = {
    query: jest.fn((text: string) => {
      queries.push(text);
      if (text === BYPASS_READ_SQL) return Promise.resolve([{ bypass }]);
      if (text === BYPASS_ON_SQL) bypass = "on";
      if (text === BYPASS_OFF_SQL) bypass = "";
      return Promise.resolve([]);
    }),
  } as unknown as EntityManager;
  return { manager, queries };
}

const originalMode = process.env.RLS_MODE;

afterEach(() => {
  if (originalMode === undefined) {
    delete process.env.RLS_MODE;
  } else {
    process.env.RLS_MODE = originalMode;
  }
});

const asUser = <T>(fn: () => Promise<T>) =>
  requestContextStorage.run({ userId: "user-a" }, fn);

describe("withElevatedDb", () => {
  it("brackets the callback with the bypass GUC on and off", async () => {
    process.env.RLS_MODE = "enforce";
    const { manager, queries } = makeManager();

    const result = await asUser(() =>
      withElevatedDb(manager, "test reason", async (m) => {
        await m.query("SELECT 1");
        return "value";
      }),
    );

    expect(result).toBe("value");
    expect(queries).toEqual([
      BYPASS_READ_SQL,
      BYPASS_ON_SQL,
      "SELECT 1",
      BYPASS_OFF_SQL,
    ]);
  });

  it("uses transaction-local set_config, never a session-wide SET", async () => {
    // A session-wide flip would survive the transaction and travel with the
    // pooled connection to the next request. The `true` third argument is what
    // makes it die with the transaction.
    expect(BYPASS_ON_SQL).toContain(", true)");
    expect(BYPASS_OFF_SQL).toContain(", true)");
    expect(BYPASS_ON_SQL).not.toMatch(/^\s*SET\s/);
  });

  it("turns the bypass off again when the callback throws", async () => {
    // A caller that catches the error keeps working in the same transaction. It
    // must not keep working elevated.
    process.env.RLS_MODE = "enforce";
    const { manager, queries } = makeManager();

    await expect(
      asUser(() =>
        withElevatedDb(manager, "test reason", async () => {
          throw new Error("boom");
        }),
      ),
    ).rejects.toThrow("boom");

    expect(queries).toEqual([BYPASS_READ_SQL, BYPASS_ON_SQL, BYPASS_OFF_SQL]);
  });

  it("runs the callback with the manager it was given", async () => {
    process.env.RLS_MODE = "enforce";
    const { manager } = makeManager();
    let received: EntityManager | undefined;

    await asUser(() =>
      withElevatedDb(manager, "test reason", async (m) => {
        received = m;
      }),
    );

    // Elevation is a property of the transaction, so it has to be the same
    // manager -- a different one would be a different connection.
    expect(received).toBe(manager);
  });

  it("emits no GUC at RLS_MODE=off, where none is in play", async () => {
    process.env.RLS_MODE = "off";
    const { manager, queries } = makeManager();

    await asUser(() =>
      withElevatedDb(manager, "test reason", async (m) => m.query("SELECT 1")),
    );

    expect(queries).toEqual(["SELECT 1"]);
  });

  it("emits the GUC in shadow mode, where identity GUCs are already emitted", async () => {
    process.env.RLS_MODE = "shadow";
    const { manager, queries } = makeManager();

    await asUser(() =>
      withElevatedDb(manager, "test reason", async () => undefined),
    );

    expect(queries).toEqual([BYPASS_READ_SQL, BYPASS_ON_SQL, BYPASS_OFF_SQL]);
  });

  it("does not flip the GUC inside an already-system transaction", async () => {
    // A cron fan-out or seeder is already bypassing. Flipping here would be
    // redundant on the way in and -- much worse -- would turn the bypass OFF for
    // the remainder of the caller's transaction on the way out.
    process.env.RLS_MODE = "enforce";
    const { manager, queries } = makeManager();

    await requestContextStorage.run({ system: true }, () =>
      withElevatedDb(manager, "test reason", async (m) => m.query("SELECT 1")),
    );

    expect(queries).toEqual(["SELECT 1"]);
  });

  describe("nesting", () => {
    it("leaves the bypass on for the outer window when an inner one returns", async () => {
      // One elevated operation calling another is legitimate: the owner's
      // delegate listing asks, per delegate, whether the owner may reset that
      // delegate's password, and both halves need the same reach. If the inner
      // `finally` restored, everything the outer window did after it would
      // silently run tenant-filtered -- an elevated sequence that half works.
      process.env.RLS_MODE = "enforce";
      const { manager, queries } = makeManager();

      await asUser(() =>
        withElevatedDb(manager, "outer", async (outer) => {
          await outer.query("OUTER BEFORE");
          await withElevatedDb(manager, "inner", async (inner) =>
            inner.query("INNER"),
          );
          await outer.query("OUTER AFTER");
        }),
      );

      expect(queries).toEqual([
        BYPASS_READ_SQL,
        BYPASS_ON_SQL,
        "OUTER BEFORE",
        // The inner window sees the GUC already on, so it neither sets nor
        // clears it.
        BYPASS_READ_SQL,
        "INNER",
        "OUTER AFTER",
        BYPASS_OFF_SQL,
      ]);
    });

    it("does not restore when an outer window it cannot see opened the bypass", async () => {
      process.env.RLS_MODE = "enforce";
      const { manager, queries } = makeManager({ elevated: true });

      await asUser(() =>
        withElevatedDb(manager, "inner only", async (m) => m.query("SELECT 1")),
      );

      expect(queries).toEqual([BYPASS_READ_SQL, "SELECT 1"]);
    });

    it("still restores when the inner window throws", async () => {
      process.env.RLS_MODE = "enforce";
      const { manager, queries } = makeManager();

      await expect(
        asUser(() =>
          withElevatedDb(manager, "outer", async () => {
            await withElevatedDb(manager, "inner", async () => {
              throw new Error("boom");
            });
          }),
        ),
      ).rejects.toThrow("boom");

      // Exactly one restore, and it belongs to the outer window.
      expect(queries.filter((q) => q === BYPASS_OFF_SQL)).toHaveLength(1);
      expect(queries[queries.length - 1]).toBe(BYPASS_OFF_SQL);
    });

    it("reads the { rows } result shape as well as the array one", async () => {
      // pg returns one shape and TypeORM the other, and which one arrives here
      // depends on the driver, not on us.
      process.env.RLS_MODE = "enforce";
      const queries: string[] = [];
      const manager = {
        query: jest.fn((text: string) => {
          queries.push(text);
          return Promise.resolve(
            text === BYPASS_READ_SQL ? { rows: [{ bypass: "on" }] } : [],
          );
        }),
      } as unknown as EntityManager;

      await asUser(() =>
        withElevatedDb(manager, "inner only", async (m) => m.query("SELECT 1")),
      );

      expect(queries).toEqual([BYPASS_READ_SQL, "SELECT 1"]);
    });
  });
});

describe("callSiteFromStack", () => {
  it("skips this module's own frames", () => {
    const stack = [
      "Error",
      "    at auditElevation (/app/src/common/db/elevated-db.ts:80:20)",
      "    at withElevatedDb (/app/src/common/db/elevated-db.ts:60:3)",
      "    at CurrenciesService.removeWithin (/app/src/currencies/currencies.service.ts:401:5)",
    ].join("\n");

    expect(callSiteFromStack(stack)).toBe(
      "CurrenciesService.removeWithin (/app/src/currencies/currencies.service.ts:401:5)",
    );
  });

  it("falls back to unknown rather than throwing", () => {
    expect(callSiteFromStack(undefined)).toBe("unknown");
    expect(callSiteFromStack("Error")).toBe("unknown");
  });
});
