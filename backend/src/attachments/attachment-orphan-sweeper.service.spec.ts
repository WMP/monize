import { DataSource, IsNull, LessThan } from "typeorm";
import { withScopedDb } from "../common/db/scoped-db";
import {
  AttachmentOrphanSweeper,
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
 */
describe("AttachmentOrphanSweeper", () => {
  let sweeper: AttachmentOrphanSweeper;
  let storage: jest.Mocked<AttachmentStorageProvider>;
  let tombstoneRepo: {
    find: jest.Mock;
    delete: jest.Mock;
  };
  let managerQuery: jest.Mock;

  /** SQL the sweeper issued, whitespace-collapsed. */
  const statements = (): string[] =>
    managerQuery.mock.calls.map((call) => String(call[0]).replace(/\s+/g, " "));

  /** Make the conditional claim win or lose, as the database would. */
  const claimResult = (won: boolean): void => {
    managerQuery.mockImplementation(async (sql: string) => {
      if (String(sql).includes("SET swept_at")) {
        return won ? [[{ id: "t1" }], 1] : [[], 0];
      }
      return [];
    });
  };

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
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
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
    claimResult(true);
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
      expect(storage.delete.mock.invocationCallOrder[0]).toBeLessThan(
        tombstoneRepo.delete.mock.invocationCallOrder[0],
      );
    });

    it("leaves the object alone when the claim is refused", async () => {
      // An upload renewed its lease between the read and the claim, or another
      // replica got there first. Either way these bytes are not ours to delete.
      tombstoneRepo.find.mockResolvedValue([
        { id: "t1", storageKey: "k1", storageProvider: "s3" },
      ]);
      claimResult(false);

      expect(await sweeper.sweep()).toBe(0);
      expect(storage.delete).not.toHaveBeenCalled();
      expect(tombstoneRepo.delete).not.toHaveBeenCalled();
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
      expect(tombstoneRepo.delete).not.toHaveBeenCalled();
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
      expect(tombstoneRepo.delete).toHaveBeenCalledWith({ id: "t2" });
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
      expect(tombstoneRepo.delete).toHaveBeenCalledWith({
        storageProvider: "s3",
        storageKey: "k1",
      });
      // No age filter and no batch read: promptness is the point of this path.
      expect(tombstoneRepo.find).not.toHaveBeenCalled();
    });

    it("does not delete when the claim by key is refused", async () => {
      claimResult(false);

      await sweeper.sweepKey("k1");

      expect(storage.delete).not.toHaveBeenCalled();
    });

    it("leaves the tombstone in place when the provider delete fails", async () => {
      storage.delete.mockRejectedValue(new Error("timeout"));

      await sweeper.sweepKey("k1");

      expect(tombstoneRepo.delete).not.toHaveBeenCalled();
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
