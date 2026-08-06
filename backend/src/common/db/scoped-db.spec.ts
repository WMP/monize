import { DataSource, EntityManager } from "typeorm";
import { requestContextStorage, RequestContext } from "../request-context";
import {
  IDENTITY_MISMATCH_MESSAGE,
  MISSING_CONTEXT_MESSAGE,
  getActiveScopedManager,
  runOutsideActiveScopedManager,
  withScopedDb,
} from "./scoped-db";

interface RecordedQuery {
  text: string;
  params?: unknown[];
}

function makeDataSource() {
  const queries: RecordedQuery[] = [];
  const manager = {
    query: jest.fn((text: string, params?: unknown[]) => {
      queries.push({ text, params });
      return Promise.resolve([]);
    }),
  } as unknown as EntityManager;
  const transaction = jest.fn(
    async <T>(cb: (m: EntityManager) => Promise<T>): Promise<T> => cb(manager),
  );
  const dataSource = { transaction } as unknown as DataSource;
  return { dataSource, manager, queries, transaction };
}

function run<T>(ctx: RequestContext, fn: () => Promise<T>): Promise<T> {
  return requestContextStorage.run(ctx, fn);
}

const originalMode = process.env.RLS_MODE;

afterEach(() => {
  if (originalMode === undefined) {
    delete process.env.RLS_MODE;
  } else {
    process.env.RLS_MODE = originalMode;
  }
});

describe("withScopedDb -- context guard", () => {
  it.each(["off", "shadow", "enforce"])(
    "throws when there is no ambient context (mode %s)",
    async (mode) => {
      process.env.RLS_MODE = mode;
      const { dataSource, transaction } = makeDataSource();
      await expect(
        withScopedDb(dataSource, async () => "unreachable"),
      ).rejects.toThrow(MISSING_CONTEXT_MESSAGE);
      expect(transaction).not.toHaveBeenCalled();
    },
  );

  it("throws when the context carries neither userId nor system", async () => {
    process.env.RLS_MODE = "enforce";
    const { dataSource } = makeDataSource();
    await expect(
      run({ timezone: "UTC" }, () =>
        withScopedDb(dataSource, async () => "unreachable"),
      ),
    ).rejects.toThrow(MISSING_CONTEXT_MESSAGE);
  });
});

describe("withScopedDb -- identity GUC emission", () => {
  it("emits both identity GUCs for a user context (enforce)", async () => {
    process.env.RLS_MODE = "enforce";
    const { dataSource, queries } = makeDataSource();
    await run({ userId: "user-a", realUserId: "delegate-b" }, () =>
      withScopedDb(dataSource, async () => undefined),
    );
    expect(queries).toEqual([
      {
        text: "SELECT set_config('app.current_user_id', $1, true)",
        params: ["user-a"],
      },
      {
        text: "SELECT set_config('app.real_user_id', $1, true)",
        params: ["delegate-b"],
      },
    ]);
  });

  it("defaults real_user_id to userId when realUserId is absent", async () => {
    process.env.RLS_MODE = "shadow";
    const { dataSource, queries } = makeDataSource();
    await run({ userId: "user-a" }, () =>
      withScopedDb(dataSource, async () => undefined),
    );
    expect(queries[1]).toEqual({
      text: "SELECT set_config('app.real_user_id', $1, true)",
      params: ["user-a"],
    });
  });

  it("emits the bypass GUC (not identity) for a system context", async () => {
    process.env.RLS_MODE = "enforce";
    const { dataSource, queries } = makeDataSource();
    await run({ system: true }, () =>
      withScopedDb(dataSource, async () => undefined),
    );
    expect(queries).toEqual([
      {
        text: "SELECT set_config('app.bypass_rls', 'on', true)",
        params: undefined,
      },
    ]);
  });

  it("emits NO identity GUC at RLS_MODE=off", async () => {
    process.env.RLS_MODE = "off";
    const { dataSource, queries, transaction } = makeDataSource();
    const result = await run({ userId: "user-a" }, () =>
      withScopedDb(dataSource, async () => "value"),
    );
    // Still wraps a transaction and runs fn, but sets no GUCs.
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(queries).toEqual([]);
    expect(result).toBe("value");
  });

  it("emits no bypass GUC for a system context at off", async () => {
    process.env.RLS_MODE = "off";
    const { dataSource, queries } = makeDataSource();
    await run({ system: true }, () =>
      withScopedDb(dataSource, async () => undefined),
    );
    expect(queries).toEqual([]);
  });
});

describe("withScopedDb -- preserveTimestamps", () => {
  it.each(["off", "shadow", "enforce"])(
    "emits app.preserve_timestamps in every mode including %s",
    async (mode) => {
      process.env.RLS_MODE = mode;
      const { dataSource, queries } = makeDataSource();
      await run({ userId: "user-a", preserveTimestamps: true }, () =>
        withScopedDb(dataSource, async () => undefined),
      );
      expect(queries).toContainEqual({
        text: "SELECT set_config('app.preserve_timestamps', 'on', true)",
        params: undefined,
      });
    },
  );

  it("emits only preserve_timestamps (no identity) at off", async () => {
    process.env.RLS_MODE = "off";
    const { dataSource, queries } = makeDataSource();
    await run({ userId: "user-a", preserveTimestamps: true }, () =>
      withScopedDb(dataSource, async () => undefined),
    );
    expect(queries).toEqual([
      {
        text: "SELECT set_config('app.preserve_timestamps', 'on', true)",
        params: undefined,
      },
    ]);
  });
});

describe("withScopedDb -- re-entrancy", () => {
  it("joins the ambient transaction and opens no second one", async () => {
    process.env.RLS_MODE = "enforce";
    const { dataSource, transaction, manager } = makeDataSource();

    await run({ userId: "user-a" }, () =>
      withScopedDb(dataSource, async (outer) => {
        expect(outer).toBe(manager);
        expect(transaction).toHaveBeenCalledTimes(1);
        expect(getActiveScopedManager()).toBe(manager);

        const innerManager = await withScopedDb(dataSource, async (inner) => {
          // Same manager, no new transaction opened.
          expect(transaction).toHaveBeenCalledTimes(1);
          return inner;
        });
        expect(innerManager).toBe(outer);
        // Still exactly one transaction after the nested call.
        expect(transaction).toHaveBeenCalledTimes(1);
      }),
    );
  });

  it("does not re-emit identity GUCs in the nested call", async () => {
    process.env.RLS_MODE = "enforce";
    const { dataSource, queries } = makeDataSource();
    await run({ userId: "user-a" }, () =>
      withScopedDb(dataSource, async () => {
        const before = queries.length;
        await withScopedDb(dataSource, async () => undefined);
        // No additional set_config calls from the nested withScopedDb.
        expect(queries.length).toBe(before);
      }),
    );
  });

  it("clears the active manager after the transaction completes", async () => {
    process.env.RLS_MODE = "enforce";
    const { dataSource } = makeDataSource();
    await run({ userId: "user-a" }, () =>
      withScopedDb(dataSource, async () => undefined),
    );
    expect(getActiveScopedManager()).toBeUndefined();
  });
});

/**
 * DR-01. The GUCs are the transaction's first statement and are
 * transaction-local, so a nested call that joins under a different ambient
 * identity runs under the OUTER transaction's GUCs while the code around it
 * believes it changed identity. That disagreement is silent: it usually fails
 * closed or writes to the outer identity, and a nested `withSystemContext` reads
 * as an escape hatch that does not escape.
 */
describe("withScopedDb -- nested identity", () => {
  const withMode = (mode: string) => {
    process.env.RLS_MODE = mode;
  };

  it.each(["off", "shadow", "enforce"])(
    "refuses a nested user change at RLS_MODE=%s",
    async (mode) => {
      // Rejected in every mode, not just under enforcement: at `off` the GUCs
      // are not emitted, so the mistake has no database symptom at all and would
      // only surface the day an operator flips the flag.
      withMode(mode);
      const { dataSource } = makeDataSource();

      await expect(
        run({ userId: "user-a" }, () =>
          withScopedDb(dataSource, () =>
            run({ userId: "user-b" }, () =>
              withScopedDb(dataSource, async () => "reached"),
            ),
          ),
        ),
      ).rejects.toThrow(IDENTITY_MISMATCH_MESSAGE);
    },
  );

  it("refuses a nested system bypass inside a user transaction", async () => {
    withMode("enforce");
    const { dataSource } = makeDataSource();

    await expect(
      run({ userId: "user-a" }, () =>
        withScopedDb(dataSource, () =>
          run({ system: true }, () =>
            withScopedDb(dataSource, async () => "reached"),
          ),
        ),
      ),
    ).rejects.toThrow(IDENTITY_MISMATCH_MESSAGE);
  });

  it("refuses a nested user identity inside a system transaction", async () => {
    withMode("enforce");
    const { dataSource } = makeDataSource();

    await expect(
      run({ system: true }, () =>
        withScopedDb(dataSource, () =>
          run({ userId: "user-a" }, () =>
            withScopedDb(dataSource, async () => "reached"),
          ),
        ),
      ),
    ).rejects.toThrow(IDENTITY_MISMATCH_MESSAGE);
  });

  it("refuses a nested delegation change", async () => {
    // Same effective owner, different authenticated delegate: app.real_user_id
    // would still name the first one, which decides what the delegate-keyed
    // policies return.
    withMode("enforce");
    const { dataSource } = makeDataSource();

    await expect(
      run({ userId: "owner", realUserId: "delegate-1" }, () =>
        withScopedDb(dataSource, () =>
          run({ userId: "owner", realUserId: "delegate-2" }, () =>
            withScopedDb(dataSource, async () => "reached"),
          ),
        ),
      ),
    ).rejects.toThrow(IDENTITY_MISMATCH_MESSAGE);
  });

  it("refuses a nested preserveTimestamps change", async () => {
    // The GUC is already set (or not) for the whole transaction, so an inner
    // scope asking for the other behaviour cannot get it.
    withMode("off");
    const { dataSource } = makeDataSource();

    await expect(
      run({ userId: "user-a" }, () =>
        withScopedDb(dataSource, () =>
          run({ userId: "user-a", preserveTimestamps: true }, () =>
            withScopedDb(dataSource, async () => "reached"),
          ),
        ),
      ),
    ).rejects.toThrow(IDENTITY_MISMATCH_MESSAGE);
  });

  it("names both identities in the error", async () => {
    // The operator (or the next agent) has to be able to tell which of the two
    // the code meant, so both appear.
    withMode("enforce");
    const { dataSource } = makeDataSource();

    await expect(
      run({ userId: "user-a" }, () =>
        withScopedDb(dataSource, () =>
          run({ system: true }, () => withScopedDb(dataSource, async () => 1)),
        ),
      ),
    ).rejects.toThrow(/current=user-a[\s\S]*system bypass/);
  });

  it("joins on an identical identity spelled out differently", async () => {
    // `withScopedDb` defaults the real user to the current one, so a context
    // that omits realUserId is the same identity as one that names it. Rejecting
    // that would break every ordinary nested service call.
    withMode("enforce");
    const { dataSource, transaction, manager } = makeDataSource();

    const joined = await run({ userId: "user-a" }, () =>
      withScopedDb(dataSource, () =>
        run({ userId: "user-a", realUserId: "user-a" }, () =>
          withScopedDb(dataSource, async (m) => m),
        ),
      ),
    );

    expect(joined).toBe(manager);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("joins when only the timezone differs", async () => {
    // Timezone is not part of the transaction's identity: it emits no GUC.
    withMode("enforce");
    const { dataSource, transaction } = makeDataSource();

    await run({ userId: "user-a", timezone: "UTC" }, () =>
      withScopedDb(dataSource, () =>
        run({ userId: "user-a", timezone: "America/Toronto" }, () =>
          withScopedDb(dataSource, async () => undefined),
        ),
      ),
    );

    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("joins two system scopes even when one also carries a userId", async () => {
    // A system transaction emits only app.bypass_rls, so a stray userId beside
    // `system` does not change what the database is doing.
    withMode("enforce");
    const { dataSource, transaction } = makeDataSource();

    await run({ system: true }, () =>
      withScopedDb(dataSource, () =>
        run({ system: true, userId: "user-a" }, () =>
          withScopedDb(dataSource, async () => undefined),
        ),
      ),
    );

    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("lets a deliberate second transaction change identity", async () => {
    // The sanctioned escape: runOutsideActiveScopedManager opens its own
    // transaction, which gets its own GUCs -- at the cost of atomicity, which is
    // why it has to be asked for explicitly.
    withMode("enforce");
    const { dataSource, transaction, queries } = makeDataSource();

    await run({ userId: "user-a" }, () =>
      withScopedDb(dataSource, async () => {
        await runOutsideActiveScopedManager(() =>
          run({ system: true }, () =>
            withScopedDb(dataSource, async () => undefined),
          ),
        );
      }),
    );

    expect(transaction).toHaveBeenCalledTimes(2);
    expect(queries.map((q) => q.text)).toContain(
      "SELECT set_config('app.bypass_rls', 'on', true)",
    );
  });

  it("propagates an inner refusal out of the outer transaction when nobody catches it", async () => {
    // The other half of the case below: uncaught, the refusal has to take the
    // outer transaction down rather than being absorbed into a partial success.
    withMode("off");
    const { dataSource } = makeDataSource();

    await expect(
      run({ userId: "user-a" }, () =>
        withScopedDb(dataSource, async () =>
          run({ system: true }, () =>
            withScopedDb(dataSource, async () => undefined),
          ),
        ),
      ),
    ).rejects.toThrow(IDENTITY_MISMATCH_MESSAGE);
  });

  it("clears the ambient scope after a callback throws something that is not an Error", async () => {
    // A thrown string still unwinds the ALS scope; if it did not, the next
    // request on this async chain would join a transaction that no longer
    // exists.
    withMode("enforce");
    const { dataSource, transaction } = makeDataSource();

    await expect(
      run({ userId: "user-a" }, () =>
        withScopedDb(dataSource, async () => {
          throw "not an Error";
        }),
      ),
    ).rejects.toBe("not an Error");

    expect(getActiveScopedManager()).toBeUndefined();

    // And the connection is usable again for a different identity.
    await run({ system: true }, () =>
      withScopedDb(dataSource, async () => undefined),
    );
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it("keeps an inner throw catchable by the outer body", async () => {
    // Refusing is an ordinary throw, so an outer body that already handles
    // failures keeps handling it -- the guard must not become an unrecoverable
    // state.
    withMode("off");
    const { dataSource, transaction } = makeDataSource();

    const result = await run({ userId: "user-a" }, () =>
      withScopedDb(dataSource, async (outer) => {
        try {
          await run({ system: true }, () =>
            withScopedDb(dataSource, async () => "never"),
          );
          return "no refusal";
        } catch {
          // The outer transaction is still usable: the refusal happened before
          // any statement was issued.
          await outer.query("SELECT 1");
          return "refused and recovered";
        }
      }),
    );

    expect(result).toBe("refused and recovered");
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});

describe("runOutsideActiveScopedManager", () => {
  it("opens a second transaction instead of joining the ambient one", async () => {
    // The progress-publishing shape: a long write needs a concurrent reader to
    // see a row before the outer transaction commits.
    process.env.RLS_MODE = "enforce";
    const { dataSource, transaction } = makeDataSource();

    await run({ userId: "user-a" }, () =>
      withScopedDb(dataSource, async () => {
        expect(transaction).toHaveBeenCalledTimes(1);

        await runOutsideActiveScopedManager(() =>
          withScopedDb(dataSource, async () => undefined),
        );

        expect(transaction).toHaveBeenCalledTimes(2);
      }),
    );
  });

  it("hides the ambient manager only for the duration of the call", async () => {
    process.env.RLS_MODE = "enforce";
    const { dataSource, manager } = makeDataSource();

    await run({ userId: "user-a" }, () =>
      withScopedDb(dataSource, async () => {
        runOutsideActiveScopedManager(() => {
          expect(getActiveScopedManager()).toBeUndefined();
        });
        expect(getActiveScopedManager()).toBe(manager);
      }),
    );
  });

  it("still requires an identity context", async () => {
    process.env.RLS_MODE = "enforce";
    const { dataSource } = makeDataSource();

    await expect(
      runOutsideActiveScopedManager(() =>
        withScopedDb(dataSource, async () => undefined),
      ),
    ).rejects.toThrow(MISSING_CONTEXT_MESSAGE);
  });
});
