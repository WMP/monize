import { DataSource, LessThan } from "typeorm";
import { withScopedDb } from "../common/db/scoped-db";
import {
  AttachmentOrphanSweeper,
  ORPHAN_SWEEP_BATCH,
  ORPHAN_SWEEP_MIN_AGE_MS,
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
 * recorded before an object is written. That makes the age filter load-bearing
 * rather than cosmetic -- sweeping a young row could delete the bytes a metadata
 * row is about to reference, which is a committed attachment pointing at nothing.
 */
describe("AttachmentOrphanSweeper", () => {
  let sweeper: AttachmentOrphanSweeper;
  let storage: jest.Mocked<AttachmentStorageProvider>;
  let tombstoneRepo: {
    find: jest.Mock;
    delete: jest.Mock;
  };
  let managerQuery: jest.Mock;

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
  });

  afterEach(() => jest.clearAllMocks());

  describe("sweep", () => {
    it("only considers rows older than the grace period", async () => {
      const before = Date.now();

      await sweeper.sweep();

      const [[options]] = tombstoneRepo.find.mock.calls;
      expect(options.where.storageProvider).toBe("s3");
      expect(options.take).toBe(ORPHAN_SWEEP_BATCH);
      // A young row may be an upload still in flight. Deleting its bytes would
      // leave a committed attachment pointing at nothing (audit FV4-003).
      const cutoff = options.where.deletedAt as ReturnType<typeof LessThan>;
      const boundary = (cutoff as unknown as { value: Date }).value;
      expect(boundary.getTime()).toBeGreaterThanOrEqual(
        before - ORPHAN_SWEEP_MIN_AGE_MS - 1000,
      );
      expect(boundary.getTime()).toBeLessThanOrEqual(
        Date.now() - ORPHAN_SWEEP_MIN_AGE_MS + 1000,
      );
    });

    it("deletes the object before dropping its tombstone", async () => {
      tombstoneRepo.find.mockResolvedValue([
        { id: "t1", storageKey: "k1", storageProvider: "s3" },
      ]);

      const removed = await sweeper.sweep();

      expect(removed).toBe(1);
      // That order is the point: the reverse would drop the only record of an
      // object still present.
      expect(storage.delete.mock.invocationCallOrder[0]).toBeLessThan(
        tombstoneRepo.delete.mock.invocationCallOrder[0],
      );
      expect(tombstoneRepo.delete).toHaveBeenCalledWith({ id: "t1" });
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
      const [sql, params] = managerQuery.mock.calls[0];
      expect(String(sql)).toContain("attempts = attempts + 1");
      expect(params).toEqual(["t1", "access denied"]);
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
    it("is not delayed by the grace period", async () => {
      // Its caller has already committed the metadata delete, so there is no
      // in-flight upload left to protect -- and the whole point is promptness.
      await sweeper.sweepKey("k1");

      expect(storage.delete).toHaveBeenCalledWith("k1");
      expect(tombstoneRepo.delete).toHaveBeenCalledWith({
        storageProvider: "s3",
        storageKey: "k1",
      });
      expect(tombstoneRepo.find).not.toHaveBeenCalled();
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
