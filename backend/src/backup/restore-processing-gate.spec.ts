import { PEAK_MULTIPLE } from "./backup-limits";
import {
  RestoreProcessingGate,
  computeRestoreProcessingSlots,
} from "./restore-processing-gate";

const MIB = 1024 * 1024;

/** A promise plus the function that settles it, so a test controls timing. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** Let all currently-queued microtasks run. */
const flush = () => new Promise<void>((r) => setImmediate(r));

describe("RestoreProcessingGate", () => {
  it("runs a single task immediately", async () => {
    const gate = new RestoreProcessingGate(1);
    const result = await gate.run(async () => 42);
    expect(result).toBe(42);
    expect(gate.activeCount).toBe(0);
  });

  /**
   * The point of the gate (F3R6-004): a second restore does not begin processing
   * while the first still holds its slot, so their expanded payloads never live at
   * the same time.
   */
  it("holds the second task until the first releases at capacity 1", async () => {
    const gate = new RestoreProcessingGate(1);
    const first = deferred();
    const started: string[] = [];

    const p1 = gate.run(async () => {
      started.push("a");
      await first.promise;
    });
    const p2 = gate.run(async () => {
      started.push("b");
    });

    await flush();
    // Only the first ran; the second is waiting for the slot.
    expect(started).toEqual(["a"]);
    expect(gate.waitingCount).toBe(1);

    first.resolve();
    await Promise.all([p1, p2]);
    expect(started).toEqual(["a", "b"]);
    expect(gate.activeCount).toBe(0);
  });

  it("allows exactly `capacity` tasks to run at once", async () => {
    const gate = new RestoreProcessingGate(2);
    const gates = [deferred(), deferred(), deferred()];
    const started: number[] = [];
    const runs = gates.map((g, i) =>
      gate.run(async () => {
        started.push(i);
        await g.promise;
      }),
    );

    await flush();
    // Two admitted, the third queued.
    expect(started).toEqual([0, 1]);
    expect(gate.waitingCount).toBe(1);

    gates[0].resolve();
    await flush();
    expect(started).toEqual([0, 1, 2]);

    gates[1].resolve();
    gates[2].resolve();
    await Promise.all(runs);
    expect(gate.activeCount).toBe(0);
  });

  it("releases the slot even when the task throws", async () => {
    const gate = new RestoreProcessingGate(1);
    await expect(
      gate.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    // A leaked slot would deadlock every later restore.
    expect(gate.activeCount).toBe(0);
    await expect(gate.run(async () => "ok")).resolves.toBe("ok");
  });

  it("wakes a waiter when capacity is raised at runtime", async () => {
    const gate = new RestoreProcessingGate(1);
    const first = deferred();
    const started: string[] = [];
    const p1 = gate.run(async () => {
      started.push("a");
      await first.promise;
    });
    const p2 = gate.run(async () => {
      started.push("b");
    });
    await flush();
    expect(started).toEqual(["a"]);

    gate.configure(2);
    await flush();
    // The raised capacity admits the waiter without the first finishing.
    expect(started).toEqual(["a", "b"]);

    first.resolve();
    await Promise.all([p1, p2]);
  });

  it("never drops below one slot", () => {
    const gate = new RestoreProcessingGate(0);
    expect(gate.activeCount).toBe(0);
    gate.configure(-5);
    // Capacity floored at 1: a task still runs.
    return expect(gate.run(async () => "ran")).resolves.toBe("ran");
  });
});

describe("computeRestoreProcessingSlots", () => {
  it("serialises on the chart's default backend", () => {
    // One restore's processing peak leaves no room for a second on a 400 MiB pod.
    expect(computeRestoreProcessingSlots(400 * MIB)).toBeLessThanOrEqual(1);
  });

  it("allows more on a much larger container", () => {
    expect(computeRestoreProcessingSlots(8192 * MIB)).toBeGreaterThan(1);
  });

  it("serialises when the container limit is unknown", () => {
    // "Cannot tell how big the pod is" reads as "run them one at a time".
    expect(computeRestoreProcessingSlots(null)).toBe(1);
  });

  /**
   * F3R7-002 scenario A: the slot count must budget against the *resolved*
   * expanded limit, not a separately derived default. A 2 GiB override that lets
   * each restore decompress to 2 GiB must not still be modeled at the 1 GiB cap.
   */
  it("uses the passed expanded limit, not a re-derived default", () => {
    const container = 16 * 1024 * MIB;
    const withOverride = computeRestoreProcessingSlots(
      container,
      2 * 1024 * MIB, // resolved BACKUP_RESTORE_EXPANDED_LIMIT=2gb
    );
    // 5 was the pre-fix answer (16 / (3 * 1 GiB)); the honest answer with the
    // real 2 GiB limit and a baseline is far smaller.
    expect(withOverride).toBeLessThan(5);
    // And every admitted restore's peak fits: slots * 3 * 2GiB <= container.
    expect(withOverride * PEAK_MULTIPLE * 2 * 1024 * MIB).toBeLessThanOrEqual(
      container,
    );
  });

  /**
   * F3R7-002 scenario B: a container where one modeled restore does not fit
   * returns 0 -- an honest signal the caller surfaces -- rather than forcing an
   * unsafe slot. (The gate itself still floors capacity at one.)
   */
  it("returns zero when one restore does not fit, rather than forcing one", () => {
    // 256 MiB container, ~96 MiB baseline, 3 * 64 MiB expanded peak = 192 MiB,
    // which does not fit the ~160 MiB left.
    expect(computeRestoreProcessingSlots(256 * MIB, 64 * MIB, 96 * MIB)).toBe(
      0,
    );
  });

  it("subtracts the baseline before dividing", () => {
    // Without a baseline, container/peak would give one more slot than is safe.
    const withBaseline = computeRestoreProcessingSlots(
      1200 * MIB,
      100 * MIB,
      600 * MIB,
    );
    const withoutBaseline = computeRestoreProcessingSlots(
      1200 * MIB,
      100 * MIB,
      0,
    );
    expect(withBaseline).toBeLessThan(withoutBaseline);
  });
});
