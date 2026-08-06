import {
  BOOTSTRAP_LOCK_KEY,
  BOOTSTRAP_LOCK_NAMESPACE,
  REQUEST_LOCK_NAMESPACES,
  acquireBootstrapLock,
  releaseBootstrapLock,
  type BootstrapLockClient,
} from "./bootstrap-lock";

/**
 * The lock exists so two replicas starting at once do not both apply
 * `schema.sql` or the same migration. What a unit spec can pin down is the
 * part that fails silently: a lock that is reported as taken when it was not,
 * an unbounded wait, and a namespace that collides with the request-time
 * advisory locks (Postgres keeps one space for the two-int form, so a
 * collision would have a bootstrap block a transaction that has nothing to do
 * with it).
 */
describe("common/db/bootstrap-lock", () => {
  const grant = { rows: [{ acquired: true }] };
  const refuse = { rows: [{ acquired: false }] };

  function client(answers: Array<{ rows: unknown[] }>) {
    const query = jest.fn();
    for (const answer of answers) query.mockResolvedValueOnce(answer);
    query.mockResolvedValue(grant);
    return {
      query: query as unknown as BootstrapLockClient["query"],
      calls: query,
    };
  }

  const noWait = {
    sleep: async () => undefined,
    log: () => undefined,
  };

  it("stays clear of the request-time advisory namespaces", () => {
    expect(REQUEST_LOCK_NAMESPACES.length).toBeGreaterThan(0);
    expect(REQUEST_LOCK_NAMESPACES).not.toContain(BOOTSTRAP_LOCK_NAMESPACE);
  });

  it("takes the lock with the shared key, without blocking in the database", async () => {
    const c = client([grant]);

    await acquireBootstrapLock(c, noWait);

    expect(c.calls).toHaveBeenCalledWith(
      "SELECT pg_try_advisory_lock($1::int, $2::int) AS acquired",
      [BOOTSTRAP_LOCK_NAMESPACE, BOOTSTRAP_LOCK_KEY],
    );
  });

  it("retries while a peer holds it, then proceeds", async () => {
    const c = client([refuse, refuse, grant]);
    const sleep = jest.fn().mockResolvedValue(undefined);

    await acquireBootstrapLock(c, { ...noWait, sleep, pollMs: 7 });

    expect(c.calls).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(7);
  });

  it("announces the wait once, not once per attempt", async () => {
    const c = client([refuse, refuse, refuse, grant]);
    const log = jest.fn();

    await acquireBootstrapLock(c, { ...noWait, log });

    const waiting = log.mock.calls.filter((call) =>
      String(call[0]).includes("waiting for it to finish"),
    );
    expect(waiting).toHaveLength(1);
  });

  it("gives up rather than waiting forever, and names where to look", async () => {
    // A pod that hangs with no output is worse than one that fails: the wait is
    // bounded so a stuck peer surfaces as a message instead of a silent
    // ContainerCreating.
    const query = jest.fn().mockResolvedValue(refuse);
    let clock = 0;

    await expect(
      acquireBootstrapLock({ query } as unknown as BootstrapLockClient, {
        ...noWait,
        timeoutMs: 30,
        pollMs: 10,
        now: () => (clock += 10),
      }),
    ).rejects.toThrow(/Timed out after 30ms.*pg_locks/s);
  });

  it("does not report a refusal as success", async () => {
    // The failure mode this guards: a driver answer shaped differently (no row,
    // a string "f") read as truthy would let both replicas through, which is
    // exactly the state the lock exists to prevent.
    for (const answer of [
      { rows: [] },
      { rows: [{}] },
      { rows: [{ acquired: "f" }] },
      { rows: [{ acquired: null }] },
    ]) {
      const query = jest.fn().mockResolvedValue(answer);
      let clock = 0;
      await expect(
        acquireBootstrapLock({ query } as unknown as BootstrapLockClient, {
          ...noWait,
          timeoutMs: 1,
          now: () => (clock += 5),
        }),
      ).rejects.toThrow(/Timed out/);
    }
  });

  it("releases with the same key", async () => {
    const c = client([grant]);

    await releaseBootstrapLock(c, () => undefined);

    expect(c.calls).toHaveBeenCalledWith(
      "SELECT pg_advisory_unlock($1::int, $2::int)",
      [BOOTSTRAP_LOCK_NAMESPACE, BOOTSTRAP_LOCK_KEY],
    );
  });

  it("does not let a failed release mask the work it protected", async () => {
    // The lock is released on disconnect anyway, so throwing here would turn a
    // successful migration run into a non-zero exit.
    const query = jest.fn().mockRejectedValue(new Error("connection reset"));
    const log = jest.fn();

    await expect(
      releaseBootstrapLock({ query } as unknown as BootstrapLockClient, log),
    ).resolves.toBeUndefined();
    expect(log.mock.calls[0][0]).toContain("connection reset");
  });
});
