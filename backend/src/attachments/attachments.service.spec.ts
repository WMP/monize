import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AttachmentsService } from "./attachments.service";
import { AttachmentStorageProvider } from "./storage/attachment-storage";

describe("AttachmentsService", () => {
  let repo: Record<string, jest.Mock>;
  let storage: AttachmentStorageProvider;
  let service: AttachmentsService;

  beforeEach(() => {
    repo = {
      create: jest.fn((v) => ({ id: "att-1", ...v })),
      save: jest.fn((v) => Promise.resolve({ ...v, createdAt: new Date(0) })),
      find: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    storage = {
      driver: "db",
      save: jest.fn(() =>
        Promise.resolve({ inlineData: Buffer.from("x"), storageKey: null }),
      ),
      load: jest.fn((a) => Promise.resolve(a.data as Buffer)),
      remove: jest.fn(() => Promise.resolve()),
    };
    const config = { get: () => undefined } as unknown as ConfigService;
    service = new AttachmentsService(repo as any, storage, config);
  });

  describe("create", () => {
    const base = {
      fileName: "receipt.pdf",
      mimeType: "application/pdf",
      data: Buffer.from("pdf-bytes"),
      entityType: "ai_chat",
    };

    it("persists a valid attachment and returns metadata without bytes", async () => {
      const meta = await service.create("user-1", base);
      expect(storage.save).toHaveBeenCalled();
      expect(repo.save).toHaveBeenCalled();
      expect(meta).toEqual({
        id: "att-1",
        fileName: "receipt.pdf",
        mimeType: "application/pdf",
        sizeBytes: 9,
        createdAt: new Date(0),
      });
      expect((meta as unknown as Record<string, unknown>).data).toBeUndefined();
    });

    it("accepts any image/* type", async () => {
      await expect(
        service.create("user-1", { ...base, mimeType: "image/png" }),
      ).resolves.toBeDefined();
    });

    it("rejects an unsupported mime type", async () => {
      await expect(
        service.create("user-1", {
          ...base,
          mimeType: "application/x-msdownload",
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects an empty file", async () => {
      await expect(
        service.create("user-1", { ...base, data: Buffer.alloc(0) }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects a file over the size limit", async () => {
      const big = Buffer.alloc(11 * 1024 * 1024);
      await expect(
        service.create("user-1", { ...base, data: big }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("sanitizes path separators out of the file name", async () => {
      await service.create("user-1", { ...base, fileName: "../../etc/passwd" });
      const created = repo.create.mock.calls[0][0];
      expect(created.fileName).not.toContain("/");
    });
  });

  describe("getRaw", () => {
    it("returns bytes for an owned attachment", async () => {
      const qb = {
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn(() =>
          Promise.resolve({
            id: "att-1",
            fileName: "r.pdf",
            mimeType: "application/pdf",
            data: Buffer.from("bytes"),
          }),
        ),
      };
      repo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getRaw("user-1", "att-1");
      expect(result.fileName).toBe("r.pdf");
      expect(result.data.toString()).toBe("bytes");
      expect(qb.andWhere).toHaveBeenCalled();
    });

    it("throws NotFound when missing or not owned", async () => {
      const qb = {
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn(() => Promise.resolve(null)),
      };
      repo.createQueryBuilder.mockReturnValue(qb);
      await expect(service.getRaw("user-1", "att-1")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe("getMetadataByIds", () => {
    it("returns [] for no ids without hitting the repo", async () => {
      await expect(service.getMetadataByIds("user-1", [])).resolves.toEqual([]);
      expect(repo.find).not.toHaveBeenCalled();
    });

    it("maps rows to metadata scoped by user", async () => {
      repo.find.mockResolvedValue([
        {
          id: "att-1",
          fileName: "r.pdf",
          mimeType: "application/pdf",
          sizeBytes: 10,
          createdAt: new Date(0),
        },
      ]);
      const metas = await service.getMetadataByIds("user-1", ["att-1"]);
      expect(metas).toHaveLength(1);
      expect(metas[0].id).toBe("att-1");
    });
  });
});
