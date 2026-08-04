import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException } from "@nestjs/common";
import { BackupController } from "./backup.controller";
import { BackupService } from "./backup.service";
import { BackupEncryptionService } from "./backup-encryption.service";
import { SupportBackupService } from "./support-backup/support-backup.service";

describe("BackupController", () => {
  let controller: BackupController;
  let mockBackupService: Record<string, jest.Mock>;
  let mockBackupEncryption: Record<string, jest.Mock>;
  let mockSupportBackup: Record<string, jest.Mock>;

  const userId = "test-user-id";
  const mockReq = {
    user: { id: userId },
    body: Buffer.from("gzip-data"),
    headers: {},
  };

  beforeEach(async () => {
    mockBackupService = {
      streamExport: jest.fn().mockResolvedValue(undefined),
      restoreData: jest.fn(),
    };

    mockBackupEncryption = {
      getStatus: jest.fn(),
      setBackupPasswordForOidcUser: jest.fn(),
      disableForOidcUser: jest.fn(),
    };

    mockSupportBackup = {
      generate: jest.fn(),
      preview: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BackupController],
      providers: [
        {
          provide: BackupService,
          useValue: mockBackupService,
        },
        {
          provide: BackupEncryptionService,
          useValue: mockBackupEncryption,
        },
        {
          provide: SupportBackupService,
          useValue: mockSupportBackup,
        },
      ],
    }).compile();

    controller = module.get<BackupController>(BackupController);
  });

  describe("exportBackup", () => {
    it("should set response headers and delegate to streamExport", async () => {
      const mockRes = {
        setHeader: jest.fn(),
      };

      await controller.exportBackup(mockReq, mockRes as any);

      expect(mockRes.setHeader).toHaveBeenCalledWith(
        "Content-Type",
        "application/gzip",
      );
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        "Content-Disposition",
        expect.stringContaining(".json.gz"),
      );
      expect(mockBackupService.streamExport).toHaveBeenCalledWith(
        userId,
        mockRes,
        undefined,
      );
    });

    it("uses .mzbe filename and octet-stream content-type when encrypted", async () => {
      const mockRes = { setHeader: jest.fn() };
      const encryptedReq = {
        ...mockReq,
        headers: { "x-export-password": Buffer.from("pw").toString("base64") },
      };
      await controller.exportBackup(encryptedReq, mockRes as any);
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        "Content-Type",
        "application/octet-stream",
      );
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        "Content-Disposition",
        expect.stringContaining(".mzbe"),
      );
      expect(mockBackupService.streamExport).toHaveBeenCalledWith(
        userId,
        mockRes,
        "pw",
      );
    });
  });

  describe("supportExport", () => {
    it("sends the generated buffer with a gzip filename", async () => {
      const mockRes = { setHeader: jest.fn(), send: jest.fn() };
      mockSupportBackup.generate.mockResolvedValue({
        buffer: Buffer.from("gz"),
        encrypted: false,
      });
      const dto = { multiplier: 2.5 };

      await controller.supportExport(mockReq, dto as any, mockRes as any);

      expect(mockSupportBackup.generate).toHaveBeenCalledWith(userId, dto);
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        "Content-Type",
        "application/gzip",
      );
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        "Content-Disposition",
        expect.stringContaining(".json.gz"),
      );
      expect(mockRes.send).toHaveBeenCalledWith(Buffer.from("gz"));
    });

    it("uses .mzbe when the file is encrypted", async () => {
      const mockRes = { setHeader: jest.fn(), send: jest.fn() };
      mockSupportBackup.generate.mockResolvedValue({
        buffer: Buffer.from("enc"),
        encrypted: true,
      });

      await controller.supportExport(
        mockReq,
        { multiplier: 2.5, password: "pw" } as any,
        mockRes as any,
      );

      expect(mockRes.setHeader).toHaveBeenCalledWith(
        "Content-Type",
        "application/octet-stream",
      );
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        "Content-Disposition",
        expect.stringContaining(".mzbe"),
      );
    });

    it("preview delegates to the service", async () => {
      mockSupportBackup.preview.mockResolvedValue({ samples: [] });
      const dto = { multiplier: 2.5 };

      const result = await controller.supportExportPreview(mockReq, dto as any);

      expect(mockSupportBackup.preview).toHaveBeenCalledWith(userId, dto);
      expect(result).toEqual({ samples: [] });
    });
  });

  describe("restoreBackup", () => {
    it("should pass compressed body and auth headers to service", async () => {
      const mockResult = {
        message: "Backup restored successfully",
        restored: { categories: 5 },
      };
      mockBackupService.restoreData.mockResolvedValue(mockResult);

      const req = {
        user: { id: userId },
        body: Buffer.from("gzip-data"),
        headers: {
          "x-restore-password": Buffer.from("mypassword").toString("base64"),
        },
      };

      const result = await controller.restoreBackup(req);

      expect(mockBackupService.restoreData).toHaveBeenCalledWith(userId, {
        compressedData: req.body,
        password: "mypassword",
        oidcIdToken: undefined,
        backupPassword: undefined,
      });
      expect(result).toEqual(mockResult);
    });

    it("should pass OIDC token header to service", async () => {
      mockBackupService.restoreData.mockResolvedValue({
        message: "ok",
        restored: {},
      });

      const req = {
        user: { id: userId },
        body: Buffer.from("gzip-data"),
        headers: {
          "x-restore-oidc-token": "oidc-token-value",
        },
      };

      await controller.restoreBackup(req);

      expect(mockBackupService.restoreData).toHaveBeenCalledWith(userId, {
        compressedData: req.body,
        password: undefined,
        oidcIdToken: "oidc-token-value",
        backupPassword: undefined,
      });
    });

    it("should throw BadRequestException if body is not a buffer", async () => {
      const req = {
        user: { id: userId },
        body: "not-a-buffer",
        headers: {},
      };

      await expect(controller.restoreBackup(req)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should throw BadRequestException if body is empty buffer", async () => {
      const req = {
        user: { id: userId },
        body: Buffer.alloc(0),
        headers: {},
      };

      await expect(controller.restoreBackup(req)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("passes through the backup password header", async () => {
      mockBackupService.restoreData.mockResolvedValue({
        message: "ok",
        restored: {},
      });
      const req = {
        user: { id: userId },
        body: Buffer.from("data"),
        headers: {
          "x-backup-password": Buffer.from("old-password").toString("base64"),
        },
      };
      await controller.restoreBackup(req);
      expect(mockBackupService.restoreData).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({ backupPassword: "old-password" }),
      );
    });

    it("decodes a restore password that begins with a space", async () => {
      mockBackupService.restoreData.mockResolvedValue({
        message: "ok",
        restored: {},
      });
      const req = {
        user: { id: userId },
        body: Buffer.from("data"),
        headers: {
          "x-restore-password":
            Buffer.from(" leading space").toString("base64"),
        },
      };
      await controller.restoreBackup(req);
      expect(mockBackupService.restoreData).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({ password: " leading space" }),
      );
    });
  });

  describe("encryption endpoints", () => {
    it("getEncryptionStatus delegates to the encryption service", async () => {
      mockBackupEncryption.getStatus.mockResolvedValue({
        enabled: true,
        manageable: false,
      });
      const result = await controller.getEncryptionStatus({
        user: { id: userId },
      });
      expect(mockBackupEncryption.getStatus).toHaveBeenCalledWith(userId);
      expect(result).toEqual({ enabled: true, manageable: false });
    });

    it("setBackupPassword delegates with the new password", async () => {
      await controller.setBackupPassword(
        { user: { id: userId } },
        { backupPassword: "long-good-password" },
      );
      expect(
        mockBackupEncryption.setBackupPasswordForOidcUser,
      ).toHaveBeenCalledWith(userId, "long-good-password");
    });

    it("disableEncryption delegates", async () => {
      await controller.disableEncryption({ user: { id: userId } });
      expect(mockBackupEncryption.disableForOidcUser).toHaveBeenCalledWith(
        userId,
      );
    });
  });
});
