import { createHash } from "node:crypto";
import { DataSource, EntityManager } from "typeorm";
import { withScopedDb } from "../../common/db/scoped-db";
import { ImportStagedFile } from "./entities/import-staged-file.entity";
import {
  MnyStagingService,
  STAGED_FILE_TTL_HOURS,
} from "./mny-staging.service";

jest.mock("../../common/db/scoped-db");
const mockedScopedDb = withScopedDb as jest.MockedFunction<typeof withScopedDb>;

jest.mock("../../common/db/with-context", () => ({
  withSystemContext: <T>(fn: () => T): T => fn(),
}));

/**
 * A chainable query-builder double. Every method returns the builder so the
 * service's fluent chains work, and the terminal calls are asserted directly.
 */
function queryBuilder(overrides: Record<string, unknown> = {}) {
  const builder: Record<string, unknown> = {
    addSelect: jest.fn(() => builder),
    where: jest.fn(() => builder),
    andWhere: jest.fn(() => builder),
    delete: jest.fn(() => builder),
    getOne: jest.fn().mockResolvedValue(null),
    execute: jest.fn().mockResolvedValue({ affected: 0 }),
    ...overrides,
  };
  return builder;
}

describe("MnyStagingService", () => {
  let repo: Record<string, jest.Mock>;
  let builder: Record<string, unknown>;
  let service: MnyStagingService;

  beforeEach(() => {
    builder = queryBuilder();
    repo = {
      create: jest.fn((entity) => entity),
      save: jest.fn((entity) => Promise.resolve({ id: "staged-1", ...entity })),
      findOne: jest.fn().mockResolvedValue(null),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(() => builder),
    };

    const manager = {
      getRepository: jest.fn(() => repo),
    } as unknown as EntityManager;

    mockedScopedDb.mockImplementation((_dataSource, fn) => fn(manager));

    service = new MnyStagingService({} as DataSource);
  });

  afterEach(() => jest.clearAllMocks());

  describe("stage", () => {
    const data = Buffer.from("decrypted money bytes");

    it("stores the bytes with their digest and size", async () => {
      const info = await service.stage("user-1", {
        filename: "finances.mny",
        data,
      });

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-1",
          filename: "finances.mny",
          sourceFormat: "mny",
          sizeBytes: data.length,
          sha256: createHash("sha256").update(data).digest("hex"),
          data,
        }),
      );
      expect(info.id).toBe("staged-1");
      expect(info.sizeBytes).toBe(data.length);
    });

    it("never returns the bytes in the metadata", async () => {
      const info = await service.stage("user-1", {
        filename: "finances.mny",
        data,
      });

      expect(Object.keys(info)).not.toContain("data");
    });

    it("expires the file a TTL from now", async () => {
      const before = Date.now();
      const info = await service.stage("user-1", {
        filename: "finances.mny",
        data,
      });
      const expected = before + STAGED_FILE_TTL_HOURS * 60 * 60 * 1000;

      expect(info.expiresAt.getTime()).toBeGreaterThanOrEqual(expected - 1000);
      expect(info.expiresAt.getTime()).toBeLessThanOrEqual(expected + 5000);
    });

    it("drops the user's superseded files, but not one a live job still needs", async () => {
      await service.stage("user-1", { filename: "finances.mny", data });

      expect(builder.delete).toHaveBeenCalled();
      const conditions = (builder.andWhere as jest.Mock).mock.calls.map(
        (call) => String(call[0]),
      );
      expect(conditions.join(" ")).toContain("NOT EXISTS");
      expect(conditions.join(" ")).toContain("'pending', 'running'");
    });

    it("honours an explicit source format", async () => {
      await service.stage("user-1", {
        filename: "other.bin",
        data,
        sourceFormat: "future",
      });

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ sourceFormat: "future" }),
      );
    });
  });

  describe("findInfo", () => {
    it("scopes the lookup to the caller and excludes expired rows", async () => {
      await service.findInfo("user-1", "staged-1");

      const conditions = [
        ...(builder.where as jest.Mock).mock.calls,
        ...(builder.andWhere as jest.Mock).mock.calls,
      ].map((call) => String(call[0]));
      expect(conditions.join(" ")).toContain("file.id = :id");
      expect(conditions.join(" ")).toContain("file.user_id = :userId");
      // The regression guard for P4-016 / DOC-04-03: the comment claimed expired
      // rows were absent while the query filtered only by id and user, so a file
      // past its TTL could still start an import -- and then be swept away
      // before the worker loaded its bytes.
      expect(conditions.join(" ")).toContain(
        "file.expires_at >= CURRENT_TIMESTAMP",
      );
    });

    it("returns null when the row is gone", async () => {
      expect(await service.findInfo("user-1", "staged-1")).toBeNull();
    });

    it("maps a bigint size back to a number", async () => {
      (builder.getOne as jest.Mock).mockResolvedValue({
        id: "staged-1",
        filename: "finances.mny",
        sourceFormat: "mny",
        sizeBytes: "1048576" as unknown as number,
        sha256: "abc",
        expiresAt: new Date("2026-07-30T00:00:00Z"),
      } as ImportStagedFile);

      const info = await service.findInfo("user-1", "staged-1");

      expect(info?.sizeBytes).toBe(1048576);
    });
  });

  describe("sweepExpiredFiles", () => {
    it("excludes staged files an active job still needs", async () => {
      repo.createQueryBuilder.mockReturnValue(builder);

      await service.sweepExpiredFiles();

      const conditions = [
        ...(builder.where as jest.Mock).mock.calls,
        ...(builder.andWhere as jest.Mock).mock.calls,
      ].map((call) => String(call[0]));
      expect(conditions.join(" ")).toContain("expires_at < CURRENT_TIMESTAMP");
      // The other half of P4-016: expiry alone deleted the bytes out from under
      // a pending or running import. The FK is ON DELETE SET NULL, so the job
      // survived and failed partway through with a missing-file error.
      expect(conditions.join(" ")).toContain("NOT EXISTS");
      expect(conditions.join(" ")).toContain("'pending', 'running'");
    });
  });

  describe("loadBytes", () => {
    it("explicitly selects the bytea column", async () => {
      const data = Buffer.from("bytes");
      builder = queryBuilder({
        getOne: jest.fn().mockResolvedValue({ data }),
      });
      repo.createQueryBuilder.mockReturnValue(builder);

      expect(await service.loadBytes("user-1", "staged-1")).toBe(data);
      expect(builder.addSelect).toHaveBeenCalledWith("file.data");
    });

    it("returns null when the row is gone", async () => {
      expect(await service.loadBytes("user-1", "staged-1")).toBeNull();
    });
  });

  describe("remove", () => {
    it("reports whether a row was deleted", async () => {
      expect(await service.remove("user-1", "staged-1")).toBe(true);

      repo.delete.mockResolvedValue({ affected: 0 });
      expect(await service.remove("user-1", "staged-1")).toBe(false);
    });

    it("cannot delete another user's file", async () => {
      await service.remove("user-1", "staged-1");

      expect(repo.delete).toHaveBeenCalledWith({
        id: "staged-1",
        userId: "user-1",
      });
    });
  });

  describe("sweepExpiredFiles", () => {
    it("deletes only rows already past their expiry", async () => {
      builder = queryBuilder({
        execute: jest.fn().mockResolvedValue({ affected: 3 }),
      });
      repo.createQueryBuilder.mockReturnValue(builder);

      await service.sweepExpiredFiles();

      expect(builder.where).toHaveBeenCalledWith(
        "expires_at < CURRENT_TIMESTAMP",
      );
    });

    it("never throws, so one bad sweep cannot kill the scheduler", async () => {
      builder = queryBuilder({
        execute: jest.fn().mockRejectedValue(new Error("connection reset")),
      });
      repo.createQueryBuilder.mockReturnValue(builder);

      await expect(service.sweepExpiredFiles()).resolves.toBeUndefined();
    });
  });
});
