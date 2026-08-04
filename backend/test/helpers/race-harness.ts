import { DataSource, QueryRunner } from "typeorm";

/**
 * Primitives for racing two or more requests at the **production conflict
 * boundary**: independent connections, independent transactions, and
 * synchronisation on observable conditions rather than on elapsed time.
 *
 * Why this file exists. A `Promise.all` around two calls into one service
 * instance looks like a race and mostly is not: whichever call reaches the
 * database first usually also finishes first, so the interleaving that breaks
 * production is never reached and the test passes for the wrong reason. Worse,
 * the same `Promise.all` passes just as happily when the guard it is supposed to
 * exercise is deleted. Every concurrency test in this repository before this
 * harness had one of those two shapes, which is what audit finding P7-008
 * recorded.
 *
 * Three rules follow, and the helpers here exist to make them cheap:
 *
 * 1. **Independent connections.** Each participant runs under its own
 *    `withUserContext`, so its `withScopedDb` draws a fresh pooled connection
 *    and opens its own transaction. Two calls sharing one ambient transaction
 *    cannot conflict with each other at all -- they are the same transaction.
 * 2. **No sleeps.** `sleep(50)` is a guess about scheduling that is wrong under
 *    load, which is where a flaky concurrency test comes from. Wait on a
 *    condition the database can be asked about: a backend blocked on a lock, a
 *    transaction sitting open. {@link waitForBlockedBackends} and
 *    {@link waitForIdleInTransaction} are those questions.
 * 3. **A positive control per race.** A race test that passes must be shown to
 *    fail when the guard is removed, or it is only asserting that nothing
 *    happened. `race-harness.spec.ts` does that for the harness itself, with an
 *    intentionally unguarded read-modify-write that loses an update through the
 *    same gate the real tests use.
 */

/** How long any wait-for-condition helper will keep asking before giving up. */
const DEFAULT_TIMEOUT_MS = 10_000;

/** Gap between polls of a database condition. Not a synchronisation device. */
const POLL_INTERVAL_MS = 10;

/**
 * A one-shot signal. `wait()` resolves once `open()` has been called, whichever
 * happens first, so there is no window in which a participant misses it.
 */
export class Latch {
  private opened = false;
  private readonly waiters: Array<() => void> = [];

  constructor(readonly name: string) {}

  open(): void {
    if (this.opened) return;
    this.opened = true;
    for (const resolve of this.waiters.splice(0)) resolve();
  }

  get isOpen(): boolean {
    return this.opened;
  }

  async wait(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> {
    if (this.opened) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Latch "${this.name}" was never opened`));
      }, timeoutMs);
      this.waiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

/**
 * A rendezvous for a known number of participants: every `arrive()` blocks
 * until the last one arrives, then all resume.
 *
 * Use this to line participants up so each is provably inside its own
 * transaction before any of them is allowed to reach the contended write.
 */
export class Barrier {
  private arrived = 0;
  private readonly latch: Latch;

  constructor(
    readonly name: string,
    private readonly parties: number,
  ) {
    this.latch = new Latch(`barrier:${name}`);
  }

  async arrive(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> {
    this.arrived += 1;
    if (this.arrived >= this.parties) {
      this.latch.open();
      return;
    }
    await this.latch.wait(timeoutMs);
  }
}

/**
 * Waits for an arbitrary condition, polled, with a timeout that names what it was
 * waiting for.
 *
 * Exported because some races have to wait on a disjunction the harness cannot
 * know about -- "the other participant has either committed or is blocked",
 * which is the shape needed when the *presence* of the fix changes which of the
 * two happens. The condition still has to be observable; this is not a licence
 * to poll a wall clock.
 */
export async function waitUntil(
  describe: string,
  condition: () => Promise<boolean>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<void> {
  await waitFor(describe, condition, timeoutMs);
}

/** Backends of this database currently blocked waiting for a lock. */
export async function blockedBackendCount(
  dataSource: DataSource,
): Promise<number> {
  const rows: Array<{ blocked: string }> = await dataSource.query(
    `SELECT COUNT(*)::text AS blocked
       FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND wait_event_type = 'Lock'`,
  );
  return Number(rows[0].blocked);
}

async function waitFor(
  describe: string,
  condition: () => Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await condition()) return;
    if (Date.now() > deadline) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for ${describe}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

/**
 * Resolves once at least `count` backends of this database are blocked waiting
 * for a lock.
 *
 * This is the harness's substitute for "give the other request a moment to get
 * going". A participant blocked on a row lock is a fact PostgreSQL will report,
 * so the test can proceed the instant it is true and cannot proceed while it is
 * false.
 */
export async function waitForBlockedBackends(
  dataSource: DataSource,
  count: number,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<void> {
  await waitFor(
    `${count} backend(s) blocked on a lock`,
    async () => {
      const rows: Array<{ blocked: string }> = await dataSource.query(
        `SELECT COUNT(*)::text AS blocked
           FROM pg_stat_activity
          WHERE datname = current_database()
            AND pid <> pg_backend_pid()
            AND wait_event_type = 'Lock'`,
      );
      return Number(rows[0].blocked) >= count;
    },
    timeoutMs,
  );
}

/**
 * Resolves once at least `count` backends are sitting in an open transaction
 * with no statement running.
 *
 * That is the observable form of "the participant has begun its transaction and
 * taken its snapshot", which is the starting gun for every stale-snapshot race.
 */
export async function waitForIdleInTransaction(
  dataSource: DataSource,
  count: number,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<void> {
  await waitFor(
    `${count} backend(s) idle in transaction`,
    async () => {
      const rows: Array<{ open: string }> = await dataSource.query(
        `SELECT COUNT(*)::text AS open
           FROM pg_stat_activity
          WHERE datname = current_database()
            AND pid <> pg_backend_pid()
            AND state = 'idle in transaction'`,
      );
      return Number(rows[0].open) >= count;
    },
    timeoutMs,
  );
}

/**
 * An independent transaction that holds row locks until the test releases them.
 *
 * The gate is how a race becomes deterministic without reaching inside the code
 * under test. It opens its own connection, locks the rows every participant must
 * touch, and holds them; each participant then starts, runs as far as that row
 * and stops there, inside its own transaction. When {@link release} commits, all
 * of them are freed into the contended window at once -- so whatever guard the
 * application has (a conditional UPDATE, a `FOR UPDATE`, a unique index) is what
 * decides the outcome, exactly as in production.
 *
 * A gate must be released in a `finally`. A leaked gate holds locks for the rest
 * of the suite, and the failure shows up as an unrelated spec timing out.
 */
export class RowGate {
  private constructor(private readonly runner: QueryRunner) {}

  /**
   * Opens a transaction on its own connection and locks whatever `sql` selects.
   * `sql` must end in `FOR UPDATE` (or another locking clause) -- a plain SELECT
   * gates nothing, and a gate that gates nothing turns every race built on it
   * into a `Promise.all` again.
   */
  static async hold(
    dataSource: DataSource,
    sql: string,
    params: unknown[] = [],
  ): Promise<RowGate> {
    if (!/\bfor\s+(update|no\s+key\s+update|share|key\s+share)\b/i.test(sql)) {
      throw new Error(
        `RowGate.hold needs a locking SELECT; "${sql}" would hold nothing`,
      );
    }
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.query(sql, params);
    } catch (error) {
      await runner.rollbackTransaction().catch(() => undefined);
      await runner.release();
      throw error;
    }
    return new RowGate(runner);
  }

  /** Commits, freeing every participant waiting on the locked rows. */
  async release(): Promise<void> {
    if (this.runner.isReleased) return;
    if (this.runner.isTransactionActive) await this.runner.commitTransaction();
    await this.runner.release();
  }
}

/** What one racing participant did. */
export type Outcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: unknown };

/**
 * Runs every participant concurrently and reports what each one did, including
 * the ones that threw.
 *
 * `Promise.all` is the wrong tool for a race: the first rejection discards the
 * other outcomes, and "one of them was rejected" is usually the assertion the
 * test most needs to make. Losing a race is a normal, expected result here.
 */
export async function raceAll<T>(
  participants: Array<() => Promise<T>>,
): Promise<Array<Outcome<T>>> {
  const settled = await Promise.allSettled(participants.map((run) => run()));
  return settled.map((result) =>
    result.status === "fulfilled"
      ? { ok: true, value: result.value }
      : { ok: false, error: result.reason },
  );
}

/** The outcomes that succeeded. */
export const winners = <T>(outcomes: Array<Outcome<T>>): T[] =>
  outcomes.filter((o): o is { ok: true; value: T } => o.ok).map((o) => o.value);

/** The outcomes that threw. */
export const losers = <T>(outcomes: Array<Outcome<T>>): unknown[] =>
  outcomes
    .filter((o): o is { ok: false; error: unknown } => !o.ok)
    .map((o) => o.error);

/**
 * A readable summary of a race, for a failure message. Without it, a broken
 * single-winner assertion reports `2` versus `1` and nothing about why.
 */
export function describeOutcomes<T>(outcomes: Array<Outcome<T>>): string {
  return outcomes
    .map((outcome, index) =>
      outcome.ok
        ? `#${index}: ok ${JSON.stringify(outcome.value)}`
        : `#${index}: threw ${
            outcome.error instanceof Error
              ? `${outcome.error.constructor.name}: ${outcome.error.message}`
              : String(outcome.error)
          }`,
    )
    .join("\n");
}
