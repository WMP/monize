import { DataSource } from "typeorm";

import {
  AttachmentObjectSweptError,
  AttachmentsService,
  UPLOAD_INTENT_LEASE_MS,
} from "@/attachments/attachments.service";
import { AttachmentOrphanSweeper } from "@/attachments/attachment-orphan-sweeper.service";
import type { AttachmentStorageProvider } from "@/attachments/storage/attachment-storage.interface";
import { withSystemContext, withUserContext } from "@/common/db/with-context";

import {
  INTEGRATION_TYPEORM_OPTIONS,
  cleanTables,
  createTestUserDirect,
} from "../helpers/integration-setup";
import { applyRlsPolicies } from "../helpers/rls-setup";

/**
 * The attachment lifecycle's external half, against a real database and a storage
 * provider whose put can be made to land whenever the test says (audit RRV4-002).
 *
 * The metadata fence added for RV4-002 is correct and is not what this is about: it
 * guarantees that a *metadata row* never commits over deleted bytes. The remaining
 * failure is about bytes. An object-store put that stalls past its 15-minute lease
 * can complete *after* the sweep deleted the key, and the uploader's compensating
 * delete runs only if that process is still alive:
 *
 *   1. intent committed, put started;
 *   2. the put stalls past the lease;
 *   3. the sweep claims the row, deletes a key where nothing is yet visible;
 *   4. the put lands, creating the object;
 *   5. the process is killed before `clearUploadIntent` and before the `catch`.
 *
 * With the row dropped at step 3 there is nothing left that names the key, so those
 * bytes are unreferenced *and* unenumerable -- a receipt or a bank statement, so a
 * retention problem rather than only a storage one. The row therefore has to outlive
 * the writer, which is what these specs check: what the table still holds after each
 * step, and whether a later pass removes the late object.
 *
 * A unit test cannot settle it. The claim, the conditional retirement and the
 * upsert's refusal are three SQL predicates over one row, and step 5 is defined by
 * what is *durable* -- so the fixture has to be a real database and a real
 * post-crash read.
 */
describe("attachment bytes written after their intent was swept", () => {
  let dataSource: DataSource;
  let service: AttachmentsService;
  let sweeper: AttachmentOrphanSweeper;
  let objects: Map<string, Buffer>;
  let storage: AttachmentStorageProvider;
  let userId: string;

  const KEY = "aaaaaaaa-0000-4000-8000-00000000aaaa";

  /** The tombstone rows the sweep can still see, whatever state they are in. */
  const tombstones = (): Promise<
    {
      storage_key: string;
      swept_at: Date | null;
      upload_lease_expires_at: Date | null;
      late_write_quarantine_until: Date | null;
    }[]
  > =>
    dataSource.query(
      `SELECT storage_key, swept_at, upload_lease_expires_at,
              late_write_quarantine_until
         FROM attachment_blob_tombstones ORDER BY storage_key`,
    );

  /**
   * `recordUploadIntent` and `clearUploadIntent` are private because no caller
   * outside `create` may use them. Reached here through the index signature on
   * purpose: `create` needs a parent transaction, a real file and a lock, none of
   * which is what these specs are about, and going through it would test the upload
   * flow rather than the two statements whose predicates are the mechanism.
   */
  const recordIntent = (key: string): Promise<void> =>
    (
      service as unknown as {
        recordUploadIntent(userId: string, key: string): Promise<void>;
      }
    ).recordUploadIntent(userId, key);

  const clearIntent = (key: string): Promise<void> =>
    withScopedDbForTest((manager) =>
      (
        service as unknown as {
          clearUploadIntent(m: unknown, key: string): Promise<void>;
        }
      ).clearUploadIntent(manager, key),
    );

  /** A short scoped transaction, so the clear runs where `create` would run it. */
  const withScopedDbForTest = async <T>(
    fn: (manager: unknown) => Promise<T>,
  ): Promise<T> => {
    const { withScopedDb } = await import("@/common/db/scoped-db");
    return withUserContext(userId, () =>
      withScopedDb(dataSource, (m) => fn(m)),
    );
  };

  /** Age the intent's lease past expiry, as a stalled put would. */
  const expireLease = (key: string): Promise<unknown> =>
    dataSource.query(
      `UPDATE attachment_blob_tombstones
          SET upload_lease_expires_at = CURRENT_TIMESTAMP - INTERVAL '1 minute'
        WHERE storage_key = $1`,
      [key],
    );

  /** Age the late-write quarantine past expiry, as six hours of sweeps would. */
  const expireQuarantine = (key: string): Promise<unknown> =>
    dataSource.query(
      `UPDATE attachment_blob_tombstones
          SET late_write_quarantine_until = CURRENT_TIMESTAMP - INTERVAL '1 minute'
        WHERE storage_key = $1`,
      [key],
    );

  const sweep = (): Promise<number> => withSystemContext(() => sweeper.sweep());

  beforeAll(async () => {
    dataSource = new DataSource(INTEGRATION_TYPEORM_OPTIONS as never);
    await dataSource.initialize();
    await applyRlsPolicies(dataSource);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    await cleanTables(dataSource, [
      "attachment_blob_tombstones",
      "transaction_attachments",
      "users",
    ]);
    objects = new Map();
    storage = {
      // Named as an external provider, because the whole difference is that its
      // writes cannot join a PostgreSQL transaction.
      name: "s3",
      save: async (key: string, data: Buffer) => {
        objects.set(key, data);
      },
      load: async (key: string) => {
        const found = objects.get(key);
        if (!found) throw new Error(`no object at ${key}`);
        return found;
      },
      // Idempotent, per the provider contract the sweeper relies on.
      delete: async (key: string) => {
        objects.delete(key);
      },
    };
    sweeper = new AttachmentOrphanSweeper(dataSource, storage);
    service = new AttachmentsService(dataSource, storage, sweeper);
    userId = (
      await createTestUserDirect(dataSource, { email: "uploader@example.com" })
    ).id;
  });

  it("keeps the object discoverable when the put lands after the sweep and the process dies", async () => {
    await withUserContext(userId, () => recordIntent(KEY));
    await expireLease(KEY);

    // The sweep decides this upload is gone. Nothing is at the key yet.
    expect(await sweep()).toBe(0);
    const afterSweep = await tombstones();
    expect(afterSweep).toHaveLength(1);
    expect(afterSweep[0].swept_at).not.toBeNull();
    // The window is what keeps the row: dropping it here is the whole finding.
    expect(
      afterSweep[0].late_write_quarantine_until!.getTime(),
    ).toBeGreaterThan(Date.now());

    // The stalled PutObject finally lands, and the process is killed immediately
    // afterwards -- so nothing else in `create` runs, not even its catch.
    await storage.save(KEY, Buffer.from("a receipt"));
    expect(objects.has(KEY)).toBe(true);

    // The state a new process wakes up to: bytes at a key, no metadata, and a row
    // that still names them. That last part is the requirement.
    expect((await tombstones())[0].storage_key).toBe(KEY);

    // Six hours of hourly sweeps later, the window has passed.
    await expireQuarantine(KEY);
    expect(await sweep()).toBe(1);
    expect(objects.has(KEY)).toBe(false);
    expect(await tombstones()).toEqual([]);
  });

  it("re-deletes on each pass, so a put landing between passes is still removed", async () => {
    await withUserContext(userId, () => recordIntent(KEY));
    await expireLease(KEY);
    await sweep();

    // Two late writes, one per interval. Both have to go, and neither pass can be
    // the one that dropped the row.
    await storage.save(KEY, Buffer.from("first"));
    expect(await sweep()).toBe(0);
    expect(objects.has(KEY)).toBe(false);

    await storage.save(KEY, Buffer.from("second"));
    await expireQuarantine(KEY);
    expect(await sweep()).toBe(1);
    expect(objects.has(KEY)).toBe(false);
    expect(await tombstones()).toEqual([]);
  });

  it("retires an ordinary deletion record on the first pass", async () => {
    // No lease, because the trigger wrote it when metadata was deleted. Its bytes
    // cannot be written again, so there is nothing to wait for and quarantining it
    // would only keep dead rows around.
    await dataSource.query(
      `INSERT INTO attachment_blob_tombstones (user_id, storage_provider, storage_key)
       VALUES ($1, 's3', $2)`,
      [userId, KEY],
    );
    objects.set(KEY, Buffer.from("orphan"));

    expect(await sweep()).toBe(1);
    expect(objects.has(KEY)).toBe(false);
    expect(await tombstones()).toEqual([]);
  });

  it("refuses the uploader's clear once the sweeper has claimed the row", async () => {
    // The RV4-002 fence, exercised against the real predicate rather than a mocked
    // result shape: `swept_at IS NULL` is what stops metadata committing over bytes
    // the sweep is about to remove.
    await withUserContext(userId, () => recordIntent(KEY));
    await expireLease(KEY);
    await sweep();

    await expect(clearIntent(KEY)).rejects.toBeInstanceOf(
      AttachmentObjectSweptError,
    );
    // And the row survives the refusal, so the object stays enumerable.
    expect(await tombstones()).toHaveLength(1);
  });

  it("clears the intent for an upload that beat the sweeper", async () => {
    await withUserContext(userId, () => recordIntent(KEY));

    // The live lease is why the sweep does not even look, but the clear would
    // succeed regardless -- correctness is the claim, not the lease.
    expect(await sweep()).toBe(0);
    await expect(clearIntent(KEY)).resolves.toBeUndefined();
    expect(await tombstones()).toEqual([]);
  });

  it("refuses to take a key a swept tombstone still holds", async () => {
    // Not reachable with per-upload UUID keys, which is exactly why it is a
    // predicate rather than an argument: resurrecting a swept row would un-fence the
    // claim, and the row may be quarantining bytes still pending deletion.
    await withUserContext(userId, () => recordIntent(KEY));
    await expireLease(KEY);
    await sweep();

    await expect(
      withUserContext(userId, () => recordIntent(KEY)),
    ).rejects.toBeInstanceOf(AttachmentObjectSweptError);
    const rows = await tombstones();
    expect(rows[0].swept_at).not.toBeNull();
  });

  it("renews the lease of an upload retrying the same key", async () => {
    // The upsert's legitimate case: the intent is still ours, so re-recording it
    // extends the window the sweeper stays away for.
    await withUserContext(userId, () => recordIntent(KEY));
    await expireLease(KEY);

    await withUserContext(userId, () => recordIntent(KEY));

    const [row] = await tombstones();
    expect(row.upload_lease_expires_at!.getTime()).toBeGreaterThan(Date.now());
    expect(
      row.upload_lease_expires_at!.getTime() - Date.now(),
    ).toBeLessThanOrEqual(UPLOAD_INTENT_LEASE_MS + 1000);
    expect(row.swept_at).toBeNull();
  });

  describe("during a rolling deployment", () => {
    /**
     * The previous-release sweeper (audit V4R3-003): it claims the row (setting
     * swept_at, nulling the lease) and then unconditionally deletes the tombstone.
     * Executed verbatim, so the migration-146 triggers are what have to stamp the
     * quarantine on its claim and reject its premature delete.
     */
    const oldSweeperClaim = (): Promise<unknown> =>
      dataSource.query(
        `UPDATE attachment_blob_tombstones
            SET swept_at = CURRENT_TIMESTAMP, upload_lease_expires_at = NULL
          WHERE storage_provider = 's3' AND storage_key = $1`,
        [KEY],
      );
    const oldSweeperDelete = (): Promise<unknown> =>
      dataSource.query(
        `DELETE FROM attachment_blob_tombstones
          WHERE storage_provider = 's3' AND storage_key = $1`,
        [KEY],
      );

    it("stamps the quarantine on a previous-release sweeper's claim", async () => {
      await withUserContext(userId, () => recordIntent(KEY));
      await expireLease(KEY);

      await oldSweeperClaim();

      // The old binary does not know the column exists; the trigger filled it.
      const [row] = await tombstones();
      expect(row.late_write_quarantine_until).not.toBeNull();
      expect(row.late_write_quarantine_until!.getTime()).toBeGreaterThan(
        Date.now(),
      );
    });

    it("rejects a previous-release sweeper's unconditional delete while quarantined", async () => {
      await withUserContext(userId, () => recordIntent(KEY));
      await expireLease(KEY);
      await oldSweeperClaim();

      // The old binary would delete the row here; the trigger refuses, so the
      // record survives to name a late put.
      await expect(oldSweeperDelete()).rejects.toThrow(/quarantine/i);
      expect(await tombstones()).toHaveLength(1);

      // Once the window passes, the same delete is allowed -- so nothing is stuck.
      await expireQuarantine(KEY);
      await expect(oldSweeperDelete()).resolves.toBeDefined();
      expect(await tombstones()).toEqual([]);
    });

    it("still lets an ordinary deletion record be removed by either binary", async () => {
      // A trigger-written tombstone has no lease, so it is not quarantined and the
      // old sweeper's unconditional delete must still work.
      await dataSource.query(
        `INSERT INTO attachment_blob_tombstones (user_id, storage_provider, storage_key)
         VALUES ($1, 's3', $2)`,
        [userId, KEY],
      );

      await expect(oldSweeperDelete()).resolves.toBeDefined();
      expect(await tombstones()).toEqual([]);
    });
  });
});
