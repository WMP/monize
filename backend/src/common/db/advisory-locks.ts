/**
 * Session advisory locks the startup paths take.
 *
 * `db-init` and `db-migrate` both run in **every** backend process. Neither took
 * a lock, and both are check-then-act: the initializer asks whether `users`
 * exists and then applies `schema.sql`; the migrator reads the applied-filename
 * set and then applies each pending file. Start two pods against a fresh
 * database, or against one pending migration, and both decide the same work is
 * outstanding. One wins; the other hits duplicate DDL or the tracker's primary
 * key, rolls back, and exits non-zero under `set -e`. It usually succeeds after
 * a restart, once it can see the winner's state -- so the symptom is a
 * crash-looping pod during every rollout that carries a migration, and a
 * rollout that looks like it is failing when it is only racing.
 *
 * A session-scoped advisory lock held across both phases makes one process the
 * migrator and the others wait, then re-read. Session-scoped rather than
 * transaction-scoped because the work spans many transactions -- one per
 * migration file -- and Postgres releases the lock when the connection closes,
 * which happens in the `finally` of each script and also if the process is
 * killed. There is no unlock to forget and no stuck lock to clean up.
 *
 * Both scripts take the **same** key on purpose: an initializer applying
 * `schema.sql` while a migrator replays migrations on top of it is exactly the
 * interleaving to prevent.
 */

/**
 * Key for the database-lifecycle lock (schema initialization plus migrations).
 *
 * An arbitrary constant, and it only has to be arbitrary: advisory lock keys
 * share one namespace per database, so the requirement is that nothing else in
 * this database picks the same number. Written as a literal rather than derived
 * from `hashtext()` so it cannot change with a Postgres version or a typo in a
 * seed string -- a key that shifts is a lock nobody is holding.
 */
export const DB_LIFECYCLE_LOCK_KEY = 4150293001;

/** Minimal query surface shared by `pg.Client` and the test doubles. */
interface LockClient {
  query(text: string, params?: unknown[]): Promise<unknown>;
}

/**
 * Block until this session holds the database-lifecycle lock.
 *
 * Deliberately blocking rather than `pg_try_advisory_lock`: a follower that
 * gives up has to either exit (a crash-looping pod, the thing being fixed) or
 * proceed unsynchronised (the race, still there). Waiting and then re-reading
 * the state is the only outcome that leaves every replica running.
 */
export async function acquireDbLifecycleLock(
  client: LockClient,
  log: (message: string) => void = console.log,
): Promise<void> {
  log(
    "Waiting for the database lifecycle lock (only one process initializes or migrates at a time)...",
  );
  await client.query("SELECT pg_advisory_lock($1)", [DB_LIFECYCLE_LOCK_KEY]);
  log("Acquired the database lifecycle lock.");
}
