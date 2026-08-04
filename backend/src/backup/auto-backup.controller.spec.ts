import { Test, TestingModule } from "@nestjs/testing";
import { Reflector } from "@nestjs/core";
import { AutoBackupController } from "./auto-backup.controller";
import { AutoBackupService } from "./auto-backup.service";
import { AutoBackupSettings } from "./entities/auto-backup-settings.entity";
import { RolesGuard } from "../auth/guards/roles.guard";
import { ROLES_KEY } from "../auth/guards/roles.guard";

describe("AutoBackupController", () => {
  let controller: AutoBackupController;
  let mockAutoBackupService: Record<string, jest.Mock>;

  const userId = "test-user-id";

  beforeEach(async () => {
    mockAutoBackupService = {
      getSettings: jest.fn(),
      updateSettings: jest.fn(),
      validateFolder: jest.fn(),
      browseFolders: jest.fn(),
      runManualBackup: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AutoBackupController],
      providers: [
        { provide: AutoBackupService, useValue: mockAutoBackupService },
      ],
    }).compile();

    controller = module.get<AutoBackupController>(AutoBackupController);
  });

  describe("access control", () => {
    it("requires the admin role for the whole controller", () => {
      // Class-level rather than per-handler, so an endpoint added to this
      // controller is admin-only without anyone remembering to say so.
      expect(Reflect.getMetadata(ROLES_KEY, AutoBackupController)).toEqual([
        "admin",
      ]);
    });

    it("turns a non-admin away from every endpoint", () => {
      const guard = new RolesGuard(new Reflector());
      const context = {
        getHandler: () => controller.getAutoBackupSettings,
        getClass: () => AutoBackupController,
        switchToHttp: () => ({
          getRequest: () => ({ user: { id: userId, role: "user" } }),
        }),
      };

      expect(guard.canActivate(context as never)).toBe(false);
    });

    it("lets an admin through", () => {
      const guard = new RolesGuard(new Reflector());
      const context = {
        getHandler: () => controller.getAutoBackupSettings,
        getClass: () => AutoBackupController,
        switchToHttp: () => ({
          getRequest: () => ({ user: { id: userId, role: "admin" } }),
        }),
      };

      expect(guard.canActivate(context as never)).toBe(true);
    });
  });

  describe("getAutoBackupSettings", () => {
    it("should delegate to autoBackupService.getSettings", async () => {
      const settings = new AutoBackupSettings();
      settings.userId = userId;
      settings.enabled = false;
      mockAutoBackupService.getSettings.mockResolvedValue(settings);

      const result = await controller.getAutoBackupSettings({
        user: { id: userId },
      });

      expect(mockAutoBackupService.getSettings).toHaveBeenCalledWith(userId);
      expect(result).toBe(settings);
    });
  });

  describe("updateAutoBackupSettings", () => {
    it("should delegate to autoBackupService.updateSettings", async () => {
      const dto = { folderPath: "/backups", frequency: "daily" as const };
      const settings = new AutoBackupSettings();
      settings.userId = userId;
      settings.folderPath = "/backups";
      mockAutoBackupService.updateSettings.mockResolvedValue(settings);

      const result = await controller.updateAutoBackupSettings(
        { user: { id: userId } },
        dto,
      );

      expect(mockAutoBackupService.updateSettings).toHaveBeenCalledWith(
        userId,
        dto,
      );
      expect(result).toBe(settings);
    });
  });

  describe("validateFolder", () => {
    it("should delegate to autoBackupService.validateFolder", async () => {
      mockAutoBackupService.validateFolder.mockResolvedValue({ valid: true });

      const result = await controller.validateFolder({
        folderPath: "/backups",
      });

      expect(mockAutoBackupService.validateFolder).toHaveBeenCalledWith(
        "/backups",
      );
      expect(result).toEqual({ valid: true });
    });

    it("should return validation error for invalid folder", async () => {
      mockAutoBackupService.validateFolder.mockResolvedValue({
        valid: false,
        error: "Folder does not exist",
      });

      const result = await controller.validateFolder({
        folderPath: "/nonexistent",
      });

      expect(result).toEqual({ valid: false, error: "Folder does not exist" });
    });
  });

  describe("browseFolders", () => {
    it("should delegate to autoBackupService.browseFolders", async () => {
      const expected = {
        current: "/backups",
        directories: ["daily", "weekly"],
      };
      mockAutoBackupService.browseFolders.mockResolvedValue(expected);

      const result = await controller.browseFolders({
        folderPath: "/backups",
      });

      expect(mockAutoBackupService.browseFolders).toHaveBeenCalledWith(
        "/backups",
      );
      expect(result).toEqual(expected);
    });
  });

  describe("runAutoBackup", () => {
    it("should delegate to autoBackupService.runManualBackup", async () => {
      const expected = {
        message: "Backup completed successfully",
        filename: "monize-backup-daily-2026-04-02.json.gz",
      };
      mockAutoBackupService.runManualBackup.mockResolvedValue(expected);

      const result = await controller.runAutoBackup({
        user: { id: userId },
      });

      expect(mockAutoBackupService.runManualBackup).toHaveBeenCalledWith(
        userId,
      );
      expect(result).toEqual(expected);
    });
  });
});
