import {
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { createHash } from "crypto";
import {
  runOutsideActiveScopedManager,
  withScopedDb,
} from "../common/db/scoped-db";
import { TransactionAttachment } from "./entities/transaction-attachment.entity";
import {
  AttachmentsService,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_TRANSACTION,
  UploadedAttachmentFile,
  sanitizeFilename,
} from "./attachments.service";
import { AttachmentStorageProvider } from "./storage/attachment-storage.interface";
import { AttachmentOrphanSweeper } from "./attachment-orphan-sweeper.service";
import { lockTransactionRow } from "../common/db/locks";
import {
  lockedTransactionRow,
  stubLockedTransactions,
} from "../test-helpers/locks-testing";

jest.mock("../common/db/scoped-db");
jest.mock("../common/db/locks", () =>
  jest.requireActual("../test-helpers/locks-testing").locksMockModule(),
);
const mockedTenantTx = withScopedDb as jest.MockedFunction<typeof withScopedDb>;
// The upload intent is committed on its own connection, outside whatever
// transaction the caller may already hold (audit FV4-003). The automock returns
// undefined, which would make every awaited call resolve to nothing, so the
// double calls through -- whether it really got its own connection is
// scoped-db.spec.ts's question, not this file's.
const mockedOutsideTx = runOutsideActiveScopedManager as jest.MockedFunction<
  typeof runOutsideActiveScopedManager
>;

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01,
]);
const PDF_BYTES = Buffer.from("%PDF-1.7\n...", "ascii");

function pngFile(
  overrides: Partial<UploadedAttachmentFile> = {},
): UploadedAttachmentFile {
  return {
    originalname: "receipt.png",
    buffer: PNG_BYTES,
    size: PNG_BYTES.length,
    ...overrides,
  };
}

describe("AttachmentsService", () => {
  let service: AttachmentsService;
  let storage: jest.Mocked<AttachmentStorageProvider>;
  let orphanSweeper: jest.Mocked<Pick<AttachmentOrphanSweeper, "sweepKey">>;
  /**
   * The parent-transaction row `create` locks before counting. Present by
   * default; a spec that wants the not-found path clears it.
   */
  let lockedParent: ReturnType<typeof lockedTransactionRow> | null;
  let managerQuery: jest.Mock;
  /**
   * The transaction manager every `withScopedDb` in a spec receives. Exposed
   * because the upload intent opens a *second* transaction, and a spec that wants
   * only the metadata one to fail has to say which is which.
   */
  let manager: EntityManager;
  let attRepo: {
    count: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    delete: jest.Mock;
  };

  beforeEach(() => {
    lockedParent = lockedTransactionRow({ id: "txn-1" });
    stubLockedTransactions(
      {
        lockTransactionRow: lockTransactionRow as jest.Mock,
        lockTransactionRows: jest.fn(),
      },
      lockedParent ? [lockedParent] : [],
    );
    attRepo = {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn((x) => x),
      save: jest.fn((x) => Promise.resolve(x)),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    // `remove` deletes with a RETURNING statement, so the manager needs `query`
    // as well as the attachment repository.
    manager = {
      getRepository: jest.fn(() => attRepo),
      query: jest.fn().mockResolvedValue([]),
    } as unknown as EntityManager;
    managerQuery = manager.query as unknown as jest.Mock;

    mockedTenantTx.mockImplementation((_dataSource, fn) => fn(manager));
    mockedOutsideTx.mockImplementation((fn) => fn());

    storage = {
      name: "database",
      save: jest.fn().mockResolvedValue(undefined),
      load: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
    };

    orphanSweeper = { sweepKey: jest.fn().mockResolvedValue(undefined) };

    service = new AttachmentsService(
      {} as DataSource,
      storage,
      orphanSweeper as unknown as AttachmentOrphanSweeper,
    );
  });

  afterEach(() => jest.clearAllMocks());

  /**
   * Re-point the service at an external provider, whose bytes PostgreSQL cannot
   * roll back. `name` is readonly on the interface -- deliberately, it is
   * persisted -- so the double is rebuilt rather than mutated.
   */
  function externalStorage(): void {
    storage = {
      ...storage,
      name: "s3",
    } as jest.Mocked<AttachmentStorageProvider>;
    service = new AttachmentsService(
      {} as DataSource,
      storage,
      orphanSweeper as unknown as AttachmentOrphanSweeper,
    );
  }

  describe("create", () => {
    it("stores metadata and bytes, sniffing the real MIME type", async () => {
      const result = await service.create("user-1", "txn-1", pngFile());

      expect(result.contentType).toBe("image/png");
      expect(result.userId).toBe("user-1");
      expect(result.transactionId).toBe("txn-1");
      expect(result.byteSize).toBe(PNG_BYTES.length);
      expect(result.sha256).toBe(
        createHash("sha256").update(PNG_BYTES).digest("hex"),
      );
      expect(result.storageProvider).toBe("database");
      // Database provider keys the bytes by the attachment id.
      expect(result.storageKey).toBe(result.id);
      expect(storage.save).toHaveBeenCalledWith(result.id, PNG_BYTES);
    });

    it("accepts PDFs", async () => {
      const result = await service.create(
        "user-1",
        "txn-1",
        pngFile({
          originalname: "invoice.pdf",
          buffer: PDF_BYTES,
          size: PDF_BYTES.length,
        }),
      );
      expect(result.contentType).toBe("application/pdf");
    });

    it("rejects an empty file", async () => {
      await expect(
        service.create("user-1", "txn-1", pngFile({ buffer: Buffer.alloc(0) })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.save).not.toHaveBeenCalled();
    });

    it("rejects a missing file", async () => {
      await expect(
        service.create("user-1", "txn-1", undefined),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects a file over the size limit", async () => {
      const big = Buffer.concat([
        PNG_BYTES,
        Buffer.alloc(MAX_ATTACHMENT_BYTES),
      ]);
      await expect(
        service.create(
          "user-1",
          "txn-1",
          pngFile({ buffer: big, size: big.length }),
        ),
      ).rejects.toBeInstanceOf(PayloadTooLargeException);
    });

    it("rejects an unrecognised file type", async () => {
      const junk = Buffer.from("not a real image or pdf", "ascii");
      await expect(
        service.create(
          "user-1",
          "txn-1",
          pngFile({ buffer: junk, size: junk.length }),
        ),
      ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    });

    it("rejects when the transaction is not owned by the user", async () => {
      lockedParent = null;
      (lockTransactionRow as jest.Mock).mockResolvedValue(null);
      await expect(
        service.create("user-1", "txn-1", pngFile()),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.save).not.toHaveBeenCalled();
    });

    it("rejects when the per-transaction cap is reached", async () => {
      attRepo.count.mockResolvedValue(MAX_ATTACHMENTS_PER_TRANSACTION);
      await expect(
        service.create("user-1", "txn-1", pngFile()),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.save).not.toHaveBeenCalled();
    });

    it("counts the cap under a lock on the parent transaction", async () => {
      // The regression guard for P4-017: the count is only a cap if every
      // uploader queues behind the same row first. Two uploads that both counted
      // 9 both passed `< 10` and the transaction ended with 11.
      await service.create("user-1", "txn-1", pngFile());

      expect(lockTransactionRow).toHaveBeenCalledWith(
        expect.anything(),
        "txn-1",
        "user-1",
      );
      const lockOrder = (lockTransactionRow as jest.Mock).mock
        .invocationCallOrder[0];
      expect(lockOrder).toBeLessThan(attRepo.count.mock.invocationCallOrder[0]);
    });

    it("removes the stored object when the transaction rolls back", async () => {
      // An external provider's put cannot roll back with PostgreSQL, so the bytes
      // have to be cleaned up explicitly -- there is no metadata row left to
      // record a tombstone against (P4-010).
      externalStorage();
      attRepo.save.mockRejectedValue(new Error("commit failed"));

      await expect(
        service.create("user-1", "txn-1", pngFile()),
      ).rejects.toThrow("commit failed");

      // save() threw before the object was written, so nothing to clean up.
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it("removes the stored object when the commit fails after the put", async () => {
      externalStorage();
      let capturedId = "";
      storage.save.mockImplementation(async (key: string) => {
        capturedId = key;
      });
      // Fails after storage.save() has already run.
      const failingManager = {
        getRepository: jest.fn(() => attRepo),
        query: jest.fn(),
      } as unknown as EntityManager;
      // Two transactions now, and only the second one fails: the upload intent is
      // committed on its own connection first, precisely so it survives this
      // rollback (audit FV4-003).
      mockedTenantTx
        .mockImplementationOnce((_ds, fn) => fn(manager))
        .mockImplementationOnce(async (_ds, fn) => {
          await fn(failingManager);
          throw new Error("commit failed");
        });

      await expect(
        service.create("user-1", "txn-1", pngFile()),
      ).rejects.toThrow("commit failed");

      expect(storage.delete).toHaveBeenCalledWith(capturedId);
    });

    /**
     * FV4-003: the bytes had to become *discoverable*, not merely cleaned up.
     *
     * The old code deleted the object in a catch, which runs only if this process
     * is still alive. Killed between the put and the commit, the bytes survived
     * with no metadata row -- and therefore no tombstone, so the orphan sweep
     * could not enumerate them either. An upload intent committed before the put
     * is what makes the object findable whatever happens next.
     */
    describe("the upload intent", () => {
      /** The tombstone inserts recorded across every transaction this run opened. */
      function intentInserts(): unknown[][] {
        return managerQuery.mock.calls.filter((call) =>
          String(call[0]).includes("INSERT INTO attachment_blob_tombstones"),
        );
      }

      it("is committed before a single byte is written", async () => {
        externalStorage();
        let queriesBeforePut = 0;
        storage.save.mockImplementation(async () => {
          queriesBeforePut = intentInserts().length;
        });

        await service.create("user-1", "txn-1", pngFile());

        expect(queriesBeforePut).toBe(1);
        const [sql, params] = intentInserts()[0];
        expect(String(sql)).toContain("ON CONFLICT");
        expect(params).toEqual(["user-1", "s3", expect.any(String)]);
      });

      it("is cleared inside the transaction that commits the metadata row", async () => {
        externalStorage();

        const saved = await service.create("user-1", "txn-1", pngFile());

        // Same transaction as the metadata row, so the pair is atomic: a rollback
        // after this point keeps the intent and the sweeper finds the object.
        expect(attRepo.delete).toHaveBeenCalledWith({
          storageProvider: "s3",
          storageKey: saved.id,
        });
      });

      it("is not recorded at all for the database provider", async () => {
        // Its blob write joins the transaction and genuinely rolls back with the
        // metadata row, so there is nothing to compensate for.
        await service.create("user-1", "txn-1", pngFile());

        expect(intentInserts()).toEqual([]);
      });

      it("survives a rollback whose cleanup delete also fails", async () => {
        externalStorage();
        storage.save.mockResolvedValue(undefined);
        storage.delete.mockRejectedValue(new Error("s3 unreachable"));
        mockedTenantTx
          .mockImplementationOnce((_ds, fn) => fn(manager))
          .mockImplementationOnce(async (_ds, fn) => {
            await fn(manager);
            throw new Error("commit failed");
          });

        await expect(
          service.create("user-1", "txn-1", pngFile()),
        ).rejects.toThrow("commit failed");

        // Nothing else ran, so the intent recorded before the put is the only
        // remaining pointer to the object -- and it is still there.
        expect(intentInserts()).toHaveLength(1);
      });
    });
  });

  describe("findAllForTransaction", () => {
    it("lists metadata scoped to the user and transaction", async () => {
      const rows = [{ id: "a1" }] as TransactionAttachment[];
      attRepo.find.mockResolvedValue(rows);
      const result = await service.findAllForTransaction("user-1", "txn-1");
      expect(result).toBe(rows);
      expect(attRepo.find).toHaveBeenCalledWith({
        where: { transactionId: "txn-1", userId: "user-1" },
        order: { createdAt: "ASC" },
      });
    });
  });

  describe("getForDownload", () => {
    it("returns bytes and headers for an owned attachment", async () => {
      attRepo.findOne.mockResolvedValue({
        id: "a1",
        contentType: "image/png",
        filename: "r.png",
        byteSize: 10,
        storageKey: "a1",
      });
      storage.load.mockResolvedValue(PNG_BYTES);

      const result = await service.getForDownload("user-1", "a1");

      expect(result).toEqual({
        data: PNG_BYTES,
        contentType: "image/png",
        filename: "r.png",
        byteSize: 10,
      });
      expect(storage.load).toHaveBeenCalledWith("a1");
    });

    it("throws when the attachment is not found for the user", async () => {
      attRepo.findOne.mockResolvedValue(null);
      await expect(
        service.getForDownload("user-1", "a1"),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.load).not.toHaveBeenCalled();
    });
  });

  describe("remove", () => {
    it("deletes metadata, then hands the object to the sweeper", async () => {
      managerQuery.mockResolvedValue([{ storage_key: "a1" }]);

      await service.remove("user-1", "a1");

      const [sql, params] = managerQuery.mock.calls[0];
      expect(sql).toContain("DELETE FROM transaction_attachments");
      expect(sql).toContain("RETURNING storage_key");
      expect(params).toEqual(["a1", "user-1"]);
      // The external delete happens AFTER the metadata delete has committed, so
      // a commit failure cannot leave metadata pointing at bytes that are gone.
      expect(orphanSweeper.sweepKey).toHaveBeenCalledWith("a1");
    });

    it("throws when the attachment is not found for the user", async () => {
      managerQuery.mockResolvedValue([]);
      await expect(service.remove("user-1", "a1")).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(orphanSweeper.sweepKey).not.toHaveBeenCalled();
    });

    it("does not sweep when a concurrent delete already removed the row", async () => {
      // Both requests pass their own ownership read; only one DELETE matches, and
      // only that one may go on to remove the bytes. The loser reporting success
      // and sweeping would delete an object the winner's metadata still names if
      // the two ever disagreed about the key.
      managerQuery.mockResolvedValue([[], 0]);
      await expect(service.remove("user-1", "a1")).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(orphanSweeper.sweepKey).not.toHaveBeenCalled();
    });
  });
});

describe("sanitizeFilename", () => {
  it("strips path components", () => {
    expect(sanitizeFilename("/etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("C:\\Users\\a\\receipt.png")).toBe("receipt.png");
  });

  it("removes control characters that could break headers", () => {
    expect(sanitizeFilename("re\r\nceipt.png")).toBe("receipt.png");
  });

  it("falls back when the name is empty", () => {
    expect(sanitizeFilename("")).toBe("attachment");
    expect(sanitizeFilename(undefined)).toBe("attachment");
  });

  it("truncates to the column length", () => {
    expect(sanitizeFilename("a".repeat(300)).length).toBe(255);
  });
});
