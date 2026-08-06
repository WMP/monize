import { DataSource, IsNull, LessThan } from "typeorm";
import { withScopedDb } from "../common/db/scoped-db";
import {
  AttachmentOrphanSweeper,
  LATE_WRITE_QUARANTINE_MS,
  ORPHAN_SWEEP_BATCH,
} from "./attachment-orphan-sweeper.service";
import { AttachmentBlobTombstone } from "./entities/attachment-blob-tombstone.entity";
import { AttachmentStorageProvider } from "./storage/attachment-storage.interface";

jest.mock("../common/db/scoped-db");
const mockedTenantTx = withScopedDb as jest.MockedFunction<typeof withScopedDb>;

/**
 * The sweeper is the compensating half of the attachment lifecycle: it performs
 * the one operation PostgreSQL cannot roll back, after the transaction that made
 * it necessary has committed.
 *
 * Since FV4-003 the same tombstone row also serves as an **upload intent**,
 * recorded before an object is written -- so the sweeper has to tell "abandoned"
 * from "still running", and an age check cannot, because nothing bounds an upload
 * to any window (audit RV4-002). It therefore *claims* the row with a conditional
 * UPDATE before deleting anything, and `AttachmentsService.clearUploadIntent`
 * refuses when that claim is present. The upload lease only keeps the sweeper away
 * from an upload that is probably alive; the claim is what makes it safe.
 *
 * The claim settles what *metadata* may commit, and RRV4-002 is about bytes: a put
 * that stalled past its lease can land after this sweep deleted the key, and a
 * process killed before its own compensating delete leaves those bytes with no row
 * to enumerate them. So a swept upload intent is **retained** for a late-write
 * quarantine and re-swept, while an ordinary deletion record is still retired at
 * once. The two are told apart by whether the row had a lease, not by age.
 */
describe("AttachmentOrphanSweeper", () => {
  let sweeper: AttachmentOrphanSweeper;
  let storage: jest.Mocked<AttachmentStorageProvider>;
  let tombstoneRepo: {
    find: jest.Mock;
  };
  let managerQuery: jest.Mock;
  /** Whether the conditional retirement DELETE matches -- i.e. no live quarantine. */
  let mayRetire: boolean;

  /** SQL the sweeper issued, whitespace-collapsed. */
  const statements = (): string[] =>
    managerQuery.mock.calls.map((call) => String(call[0]).replace(/\s+/g, " "));

  /** The claim and the retirement, each answering as the database would. */
  const respond = (opts: { claimWins?: boolean } = {}): void => {
    const claimWins = opts.claimWins ?? true;
    managerQuery.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (text.includes("SET swept_at")) {
        return claimWins ? [[{ id: "t1" }], 1] : [[], 0];
      }
      if (text.includes("DELETE FROM attachment_blob_tombstones")) {
        return mayRetire ? [[{ id: "t1" }], 1] : [[], 0];
      }
      return [];
    });
  };

  /** The retirement DELETEs this run issued. */
  const retirements = (): string[] =>
    statements().filter((sql) =>
      sql.includes("DELETE FROM attachment_blob_tombstones"),
    );

  const build = (providerName: string): void => {
    storage = {
      name: providerName,
      save: jest.fn().mockResolvedValue(undefined),
      load: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
    } as jest.Mocked<AttachmentStorageProvider>;
    sweeper = new AttachmentOrphanSweeper({} as DataSource, storage);
  };

  beforeEach(() => {
    tombstoneRepo = {
      find: jest.fn().mockResolvedValue([]),
    };
    managerQuery = jest.fn().mockResolvedValue([]);
    const manager = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity !== AttachmentBlobTombstone) {
          throw new Error("unexpected entity");
        }
        return tombstoneRepo;
      }),
      query: managerQuery,
    };
    mockedTenantTx.mockImplementation((_ds, fn) => fn(manager as never));
    build("s3");
    mayRetire = true;
    respond();
  });

  afterEach(() => jest.clearAllMocks());

  describe("sweep", () => {
    it("considers only rows with no live upload lease", async () => {
      await sweeper.sweep();

      const [[options]] = tombstoneRepo.find.mock.calls;
      expect(options.take).toBe(ORPHAN_SWEEP_BATCH);
      // Two arms, because the two meanings of the row are different states rather
      // than different ages: a deletion record has no lease at all, an upload
      // intent has one until its request is finished with it.
      expect(options.where).toEqual([
        { storageProvider: "s3", uploadLeaseExpiresAt: IsNull() },
        { storageProvider: "s3", uploadLeaseExpiresAt: expect.anything() },
      ]);
      const expired = options.where[1].uploadLeaseExpiresAt as ReturnType<
        typeof LessThan
      >;
      expect((expired as unknown as { value: Date }).value).toBeInstanceOf(
        Date,
      );
    });

    it("claims the row before deleting the object", async () => {
      tombstoneRepo.find.mockResolvedValue([
        { id: "t1", storageKey: "k1", storageProvider: "s3" },
      ]);

      const removed = await sweeper.sweep();

      expect(removed).toBe(1);
      // The claim is what the uploader's clear is fenced against, so it has to
      // commit before the bytes go -- the reverse order would delete bytes an
      // upload could still commit metadata for.
      const claim = statements().find((sql) => sql.includes("SET swept_at"));
      expect(claim).toContain("upload_lease_expires_at IS NULL");
      expect(claim).toContain("RETURNING id");
      expect(managerQuery.mock.invocationCallOrder[0]).toBeLessThan(
        storage.delete.mock.invocationCallOrder[0],
      );
      // And the row is retired after the bytes, never before: the reverse order
      // would drop the only record of an object still present.
      const retireCall = managerQuery.mock.calls.findIndex((call) =>
        String(call[0]).includes("DELETE FROM attachment_blob_tombstones"),
      );
      expect(storage.delete.mock.invocationCallOrder[0]).toBeLessThan(
        managerQuery.mock.invocationCallOrder[retireCall],
      );
    });

    /**
     * RRV4-002: the claim decides what metadata may commit, not what bytes exist.
     *
     * A put that stalled past its lease can land *after* this sweep deleted the
     * key, and the uploader's compensating delete runs only if that process is
     * still alive. Dropping the tombstone with the object therefore leaves bytes
     * nothing references and nothing can enumerate -- a receipt or a statement, so a
     * retention problem and not only a storage one. The record has to outlive the
     * writer.
     */
    describe("a swept upload intent", () => {
      it("sets a late-write window on the claim, once", async () => {
        tombstoneRepo.find.mockResolvedValue([
          { id: "t1", storageKey: "k1", storageProvider: "s3" },
        ]);

        await sweeper.sweep();

        const claim = managerQuery.mock.calls.find((call) =>
          String(call[0]).includes("SET swept_at"),
        );
        // Only for a row that *had* a lease: a deletion record's metadata is
        // already gone, so nothing can write those bytes again and there is
        // nothing to wait for.
        expect(String(claim?.[0])).toContain(
          "CASE WHEN upload_lease_expires_at IS NOT NULL",
        );
        // COALESCE, so re-claiming a quarantined row on every pass does not push
        // the deadline forward and keep it forever. Matched on the collapsed text,
        // because the assertion is about the expression and not its indentation.
        expect(
          statements().find((sql) => sql.includes("SET swept_at")),
        ).toContain("COALESCE( late_write_quarantine_until,");
        expect(claim?.[1]).toEqual(["t1", String(LATE_WRITE_QUARANTINE_MS)]);
      });

      it("keeps the row when the window has not passed, and reports zero removed", async () => {
        tombstoneRepo.find.mockResolvedValue([
          { id: "t1", storageKey: "k1", storageProvider: "s3" },
        ]);
        mayRetire = false;
        respond();

        // The object is gone; the row is not. Counting this as removed would tell
        // an operator the table should be empty when it deliberately is not.
        expect(await sweeper.sweep()).toBe(0);
        expect(storage.delete).toHaveBeenCalledWith("k1");
        expect(retirements()).toHaveLength(1);
      });

      it("retires the row only when the window is a predicate of the delete", async () => {
        tombstoneRepo.find.mockResolvedValue([
          { id: "t1", storageKey: "k1", storageProvider: "s3" },
        ]);

        await sweeper.sweep();

        // A read-then-delete would leave a window in which a concurrent pass
        // retires a row whose quarantine had not yet expired, so the condition
        // belongs in the statement that removes it.
        expect(retirements()[0]).toContain(
          "late_write_quarantine_until IS NULL",
        );
        expect(retirements()[0]).toContain(
          "late_write_quarantine_until < CURRENT_TIMESTAMP",
        );
        expect(retirements()[0]).toContain("RETURNING id");
      });

      it("re-deletes the key on the pass that finally retires the row", async () => {
        // The quarantined row keeps coming back because the claim cleared its
        // lease, which puts it back in the first candidate arm. That is what
        // removes a put that landed after the previous pass.
        tombstoneRepo.find.mockResolvedValue([
          { id: "t1", storageKey: "k1", storageProvider: "s3" },
        ]);
        mayRetire = false;
        respond();
        await sweeper.sweep();

        mayRetire = true;
        respond();
        expect(await sweeper.sweep()).toBe(1);
        expect(storage.delete).toHaveBeenCalledTimes(2);
        expect(storage.delete).toHaveBeenLastCalledWith("k1");
      });
    });

    it("leaves the object alone when the claim is refused", async () => {
      // An upload renewed its lease between the read and the claim, or another
      // replica got there first. Either way these bytes are not ours to delete.
      tombstoneRepo.find.mockResolvedValue([
        { id: "t1", storageKey: "k1", storageProvider: "s3" },
      ]);
      respond({ claimWins: false });

      expect(await sweeper.sweep()).toBe(0);
      expect(storage.delete).not.toHaveBeenCalled();
      expect(retirements()).toEqual([]);
    });

    it("reads the claim's row count rather than the result's length", async () => {
      // `UPDATE ... RETURNING` comes back as `[rows, rowCount]`, so a length check
      // is 2 whether or not anything was claimed -- every replica would win, which
      // is the exact failure the claim exists to prevent.
      tombstoneRepo.find.mockResolvedValue([
        { id: "t1", storageKey: "k1", storageProvider: "s3" },
      ]);
      managerQuery.mockResolvedValue([[], 0]);

      expect(await sweeper.sweep()).toBe(0);
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it("keeps the tombstone and records the failure when the provider refuses", async () => {
      tombstoneRepo.find.mockResolvedValue([
        { id: "t1", storageKey: "k1", storageProvider: "s3" },
      ]);
      storage.delete.mockRejectedValue(new Error("access denied"));

      const removed = await sweeper.sweep();

      expect(removed).toBe(0);
      expect(retirements()).toEqual([]);
      // On the row, not only in the log: a provider that keeps refusing one key
      // has to be diagnosable from the database.
      const attemptSql = statements().find((sql) =>
        sql.includes("attempts = attempts + 1"),
      );
      expect(attemptSql).toBeDefined();
    });

    it("carries on to the next tombstone after one fails", async () => {
      tombstoneRepo.find.mockResolvedValue([
        { id: "t1", storageKey: "k1", storageProvider: "s3" },
        { id: "t2", storageKey: "k2", storageProvider: "s3" },
      ]);
      storage.delete
        .mockRejectedValueOnce(new Error("transient"))
        .mockResolvedValueOnce(undefined);

      expect(await sweeper.sweep()).toBe(1);
      expect(retirements()).toHaveLength(1);
      const retire = managerQuery.mock.calls.find((call) =>
        String(call[0]).includes("DELETE FROM attachment_blob_tombstones"),
      );
      expect(retire?.[1]).toEqual(["t2"]);
    });
  });

  describe("sweepKey", () => {
    it("claims by key before deleting, like the cron does", async () => {
      // Its caller has already committed the metadata delete, so there is no
      // upload of *its own* to lose -- but a different upload could have taken the
      // key, and the claim refuses that rather than reasoning about whether it can.
      await sweeper.sweepKey("k1");

      const claim = statements().find((sql) => sql.includes("SET swept_at"));
      expect(claim).toContain("storage_key = $2");
      expect(storage.delete).toHaveBeenCalledWith("k1");
      // Retired by the same conditional delete as the cron's: this path normally
      // holds a deletion record, but the key can carry a swept upload intent whose
      // late-write window has not passed, and that row has to survive.
      expect(retirements()[0]).toContain("storage_key = $2");
      expect(retirements()[0]).toContain("late_write_quarantine_until IS NULL");
      // No age filter and no batch read: promptness is the point of this path.
      expect(tombstoneRepo.find).not.toHaveBeenCalled();
    });

    it("does not delete when the claim by key is refused", async () => {
      respond({ claimWins: false });

      await sweeper.sweepKey("k1");

      expect(storage.delete).not.toHaveBeenCalled();
    });

    it("leaves the tombstone in place when the provider delete fails", async () => {
      storage.delete.mockRejectedValue(new Error("timeout"));

      await sweeper.sweepKey("k1");

      expect(retirements()).toEqual([]);
    });

    it("does nothing for the database provider", async () => {
      build("database");

      await sweeper.sweepKey("k1");

      expect(storage.delete).not.toHaveBeenCalled();
    });
  });

  describe("the hourly cron", () => {
    it("does not run for the database provider", async () => {
      build("database");

      await sweeper.sweepOrphanedObjects();

      expect(tombstoneRepo.find).not.toHaveBeenCalled();
    });

    it("swallows a sweep failure rather than crashing the scheduler", async () => {
      tombstoneRepo.find.mockRejectedValue(new Error("db down"));

      await expect(sweeper.sweepOrphanedObjects()).resolves.toBeUndefined();
    });
  });
});
