import { DataSource } from "typeorm";
import {
  Barrier,
  Latch,
  RowGate,
  describeOutcomes,
  losers,
  raceAll,
  waitForBlockedBackends,
  waitForIdleInTransaction,
  winners,
} from "../helpers/race-harness";
import { INTEGRATION_TYPEORM_OPTIONS } from "../helpers/integration-setup";

/**
 * The harness proving itself.
 *
 * A concurrency test that passes tells you nothing until you have seen the same
 * test fail with its guard removed -- otherwise "no duplicate was created" and
 * "the second request never got close enough to create one" are the same green
 * tick. So before any real race relies on {@link RowGate}, this suite shows the
 * gate genuinely parks two independent transactions in the contended window: the
 * same read-modify-write loses an update through it without `FOR UPDATE` and
 * keeps it with one.
 *
 * That unguarded case is the positive control for every race spec in this
 * directory. If it ever starts passing, the gate has stopped gating and the
 * other suites have quietly become `Promise.all`.
 */
describe("Race harness (integration)", () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    // A bare DataSource, not the Nest graph: this suite tests the harness, and
    // nothing else needs to exist for that. `synchronize`/`dropSchema` stay off
    // so it does not fight the suites that do rebuild the schema.
    dataSource = new DataSource({
      ...INTEGRATION_TYPEORM_OPTIONS,
      entities: [],
      synchronize: false,
      dropSchema: false,
    } as never);
    await dataSource.initialize();
    await dataSource.query(`DROP TABLE IF EXISTS race_harness_counter`);
    await dataSource.query(
      `CREATE TABLE race_harness_counter (id text PRIMARY KEY, value integer NOT NULL)`,
    );
  });

  afterAll(async () => {
    await dataSource.query(`DROP TABLE IF EXISTS race_harness_counter`);
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query(
      `INSERT INTO race_harness_counter (id, value) VALUES ('c', 0)
         ON CONFLICT (id) DO UPDATE SET value = 0`,
    );
  });

  /**
   * One increment on its own connection and its own transaction. `lock` decides
   * whether the read is protected -- the only difference between the positive
   * and negative control below.
   */
  async function increment(lock: boolean): Promise<number> {
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const rows: Array<{ value: number }> = await runner.query(
        `SELECT value FROM race_harness_counter WHERE id = 'c'${
          lock ? " FOR UPDATE" : ""
        }`,
      );
      const next = rows[0].value + 1;
      await runner.query(
        `UPDATE race_harness_counter SET value = $1 WHERE id = 'c'`,
        [next],
      );
      await runner.commitTransaction();
      return next;
    } catch (error) {
      await runner.rollbackTransaction().catch(() => undefined);
      throw error;
    } finally {
      await runner.release();
    }
  }

  const currentValue = async (): Promise<number> => {
    const rows: Array<{ value: number }> = await dataSource.query(
      `SELECT value FROM race_harness_counter WHERE id = 'c'`,
    );
    return rows[0].value;
  };

  describe("Latch", () => {
    it("releases a waiter that arrived before it opened", async () => {
      const latch = new Latch("t");
      const waited = latch.wait();
      latch.open();
      await expect(waited).resolves.toBeUndefined();
    });

    it("returns immediately for a waiter that arrived after it opened", async () => {
      const latch = new Latch("t");
      latch.open();
      await expect(latch.wait()).resolves.toBeUndefined();
    });

    it("fails loudly rather than hanging when it is never opened", async () => {
      await expect(new Latch("never").wait(20)).rejects.toThrow(
        'Latch "never" was never opened',
      );
    });
  });

  describe("Barrier", () => {
    it("holds every party until the last one arrives", async () => {
      const barrier = new Barrier("t", 3);
      const order: string[] = [];
      const party = async (name: string) => {
        await barrier.arrive();
        order.push(name);
      };
      await Promise.all([party("a"), party("b"), party("c")]);
      expect(order).toHaveLength(3);
    });

    it("does not release a short-handed barrier", async () => {
      const barrier = new Barrier("short", 2);
      await expect(barrier.arrive(20)).rejects.toThrow(/never opened/);
    });
  });

  describe("RowGate", () => {
    it("refuses a SELECT that would lock nothing", async () => {
      // The mistake this catches is silent: a gate built on a plain SELECT holds
      // no locks, so participants sail past it and the race collapses into a
      // Promise.all that passes whatever the code does.
      await expect(
        RowGate.hold(dataSource, `SELECT value FROM race_harness_counter`),
      ).rejects.toThrow(/would hold nothing/);
    });

    it("blocks a participant until it is released", async () => {
      const gate = await RowGate.hold(
        dataSource,
        `SELECT value FROM race_harness_counter WHERE id = 'c' FOR UPDATE`,
      );
      let finished = false;
      const blocked = increment(true).then((value) => {
        finished = true;
        return value;
      });
      try {
        await waitForBlockedBackends(dataSource, 1);
        expect(finished).toBe(false);
      } finally {
        await gate.release();
      }
      await expect(blocked).resolves.toBe(1);
    });

    it("reports an open transaction as idle in transaction", async () => {
      const gate = await RowGate.hold(
        dataSource,
        `SELECT value FROM race_harness_counter WHERE id = 'c' FOR UPDATE`,
      );
      try {
        await expect(
          waitForIdleInTransaction(dataSource, 1),
        ).resolves.toBeUndefined();
      } finally {
        await gate.release();
      }
    });
  });

  describe("positive control: the gate reaches the conflict window", () => {
    it("loses an update when the read is not locked", async () => {
      // Both participants read 0 while parked on the gate, so both write 1: the
      // classic lost update. This asserting `1` is not the harness being wrong
      // -- it is the harness being sharp enough to catch a missing lock, which is
      // the only reason to trust the specs that assert the opposite.
      const gate = await RowGate.hold(
        dataSource,
        `SELECT value FROM race_harness_counter WHERE id = 'c' FOR UPDATE`,
      );
      let outcomes;
      try {
        const running = raceAll([
          () => increment(false),
          () => increment(false),
        ]);
        await waitForBlockedBackends(dataSource, 2);
        await gate.release();
        outcomes = await running;
      } finally {
        await gate.release();
      }

      expect(winners(outcomes)).toHaveLength(2);
      expect(await currentValue()).toBe(1);
    });

    it("keeps both updates when the read takes FOR UPDATE", async () => {
      const gate = await RowGate.hold(
        dataSource,
        `SELECT value FROM race_harness_counter WHERE id = 'c' FOR UPDATE`,
      );
      let outcomes;
      try {
        const running = raceAll([() => increment(true), () => increment(true)]);
        await waitForBlockedBackends(dataSource, 2);
        await gate.release();
        outcomes = await running;
      } finally {
        await gate.release();
      }

      expect(winners(outcomes)).toHaveLength(2);
      expect(await currentValue()).toBe(2);
    });
  });

  describe("raceAll", () => {
    it("reports a rejection instead of discarding the other outcomes", async () => {
      const outcomes = await raceAll([
        async () => "kept",
        async () => {
          throw new Error("lost");
        },
      ]);

      expect(winners(outcomes)).toEqual(["kept"]);
      expect(losers(outcomes)).toHaveLength(1);
      expect(describeOutcomes(outcomes)).toContain("Error: lost");
    });
  });
});
