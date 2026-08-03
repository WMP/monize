import {
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { createHash } from "crypto";
import { withScopedDb } from "../common/db/scoped-db";
import { Transaction } from "../transactions/entities/transaction.entity";
import { TransactionAttachment } from "./entities/transaction-attachment.entity";
import {
  AttachmentsService,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_TRANSACTION,
  UploadedAttachmentFile,
  sanitizeFilename,
} from "./attachments.service";
import { AttachmentStorageProvider } from "./storage/attachment-storage.interface";

jest.mock("../common/db/scoped-db");
const mockedTenantTx = withScopedDb as jest.MockedFunction<typeof withScopedDb>;

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
  let txnRepo: { findOne: jest.Mock };
  let attRepo: {
    count: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    delete: jest.Mock;
  };

  beforeEach(() => {
    txnRepo = { findOne: jest.fn().mockResolvedValue({ id: "txn-1" }) };
    attRepo = {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn((x) => x),
      save: jest.fn((x) => Promise.resolve(x)),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    const manager = {
      getRepository: jest.fn((entity) =>
        entity === Transaction ? txnRepo : attRepo,
      ),
    } as unknown as EntityManager;

    mockedTenantTx.mockImplementation((_dataSource, fn) => fn(manager));

    storage = {
      name: "database",
      save: jest.fn().mockResolvedValue(undefined),
      load: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
    };

    service = new AttachmentsService({} as DataSource, storage);
  });

  afterEach(() => jest.clearAllMocks());

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
      txnRepo.findOne.mockResolvedValue(null);
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
    it("deletes metadata and bytes for an owned attachment", async () => {
      attRepo.findOne.mockResolvedValue({ id: "a1", storageKey: "a1" });
      await service.remove("user-1", "a1");
      expect(attRepo.delete).toHaveBeenCalledWith({
        id: "a1",
        userId: "user-1",
      });
      expect(storage.delete).toHaveBeenCalledWith("a1");
    });

    it("throws when the attachment is not found for the user", async () => {
      attRepo.findOne.mockResolvedValue(null);
      await expect(service.remove("user-1", "a1")).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(storage.delete).not.toHaveBeenCalled();
    });
  });

  /**
   * Only the `database` provider's bytes are transactional -- its `save`/`delete`
   * are nested `withScopedDb` calls that join the caller's transaction. `local`
   * and `s3` write outside it, so where the object operation sits relative to the
   * commit decides which way a failure breaks.
   *
   * The rule: a failure must leave an orphaned object, never a metadata row
   * promising a download that does not exist. The user cannot tell a broken
   * attachment from a working one; an orphan costs storage and nothing else.
   */
  describe("external storage against the transaction boundary", () => {
    /** Rebuilds the service with a non-transactional provider. */
    function withExternalStorage(): void {
      storage = {
        name: "local",
        save: jest.fn().mockResolvedValue(undefined),
        load: jest.fn(),
        delete: jest.fn().mockResolvedValue(undefined),
      };
      service = new AttachmentsService({} as DataSource, storage);
    }

    it("deletes external bytes only after the metadata row is committed gone", async () => {
      withExternalStorage();
      attRepo.findOne.mockResolvedValue({ id: "a1", storageKey: "a1" });
      const order: string[] = [];
      attRepo.delete.mockImplementation(() => {
        order.push("delete-row");
        return Promise.resolve({ affected: 1 });
      });
      storage.delete.mockImplementation(() => {
        order.push("delete-bytes");
        return Promise.resolve(undefined);
      });
      // The transaction body has to finish before the object write happens, so
      // the double resolves only after the callback returns.
      mockedTenantTx.mockImplementation(async (_ds, fn) => {
        const result = await fn({
          getRepository: jest.fn(() => attRepo),
        } as unknown as EntityManager);
        order.push("commit");
        return result;
      });

      await service.remove("user-1", "a1");

      // Sliced: `remove` opens a second short transaction first, to read the row
      // it is about to delete, and that commit is not the one under test.
      //
      // This used to be delete-row, delete-bytes, commit -- so a commit failure
      // left the row pointing at bytes that were already gone.
      expect(order.slice(-3)).toEqual(["delete-row", "commit", "delete-bytes"]);
    });

    it("keeps external bytes when the metadata delete fails", async () => {
      withExternalStorage();
      attRepo.findOne.mockResolvedValue({ id: "a1", storageKey: "a1" });
      attRepo.delete.mockRejectedValue(new Error("deadlock detected"));

      await expect(service.remove("user-1", "a1")).rejects.toThrow(
        "deadlock detected",
      );
      // The row survives, so its bytes must too.
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it("still deletes database-provider bytes inside the transaction", async () => {
      // The cascade handles attachment_blobs, and the provider call joins the
      // transaction -- moving it outside would take it out of that atomicity.
      attRepo.findOne.mockResolvedValue({ id: "a1", storageKey: "a1" });
      const order: string[] = [];
      attRepo.delete.mockImplementation(() => {
        order.push("delete-row");
        return Promise.resolve({ affected: 1 });
      });
      storage.delete.mockImplementation(() => {
        order.push("delete-bytes");
        return Promise.resolve(undefined);
      });
      mockedTenantTx.mockImplementation(async (_ds, fn) => {
        const result = await fn({
          getRepository: jest.fn(() => attRepo),
        } as unknown as EntityManager);
        order.push("commit");
        return result;
      });

      await service.remove("user-1", "a1");

      expect(order.slice(-3)).toEqual(["delete-row", "delete-bytes", "commit"]);
    });

    it("removes orphaned external bytes when the upload transaction fails", async () => {
      withExternalStorage();
      attRepo.save.mockRejectedValue(new Error("constraint violation"));

      await expect(
        service.create("user-1", "txn-1", pngFile()),
      ).rejects.toThrow("constraint violation");

      // Nothing references them, so leaving them would be a slow leak on every
      // failed upload.
      expect(storage.delete).toHaveBeenCalledTimes(1);
    });

    it("does not try to clean up database-provider bytes on failure", async () => {
      attRepo.save.mockRejectedValue(new Error("constraint violation"));

      await expect(
        service.create("user-1", "txn-1", pngFile()),
      ).rejects.toThrow("constraint violation");

      // The rollback already took them; a delete afterwards would run outside any
      // transaction against a row that never existed.
      expect(storage.delete).not.toHaveBeenCalled();
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
