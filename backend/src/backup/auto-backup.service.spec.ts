import { Test, TestingModule } from "@nestjs/testing";
import { DataSource } from "typeorm";
import { ConfigService } from "@nestjs/config";
import { BadRequestException } from "@nestjs/common";
import * as fs from "fs";
import {
  AutoBackupService,
  DEFAULT_BACKUP_CONTAINER_DIR,
} from "./auto-backup.service";
import { BackupService } from "./backup.service";
import { AutoBackupSettings } from "./entities/auto-backup-settings.entity";
import { User } from "../users/entities/user.entity";
import { createScopedDbMocks } from "../test-helpers/scoped-db-testing";

jest.mock("../common/db/scoped-db", () =>
  jest.requireActual("../test-helpers/scoped-db-testing").scopedDbMockModule(),
);

jest.mock("fs", () => {
  const actual = jest.requireActual("fs");
  return {
    ...actual,
    createWriteStream: jest.fn(),
    readdirSync: jest.fn(),
    unlinkSync: jest.fn(),
    copyFileSync: jest.fn(),
    promises: {
      stat: jest.fn(),
      writeFile: jest.fn(),
      // Publishing links rather than renames, so that the target name being
      // taken is an error instead of a silent overwrite. `rename` stays on the
      // double because the weekly/monthly tier copies still use it.
      link: jest.fn(),
      rename: jest.fn(),
      unlink: jest.fn(),
      readdir: jest.fn(),
      mkdir: jest.fn(),
    },
  };
});

const fsMock = fs as jest.Mocked<typeof fs>;
const fsPromises = fs.promises as jest.Mocked<typeof fs.promises>;

/**
 * Mirrors the service's DAILY_FILE_PATTERN, including the optional time and the
 * collision discriminator two same-second runs use.
 */
const DAILY_PATTERN =
  /^monize-backup-daily-\d{4}-\d{2}-\d{2}(?:-\d{6}(?:-\d+)?)?\.(json\.gz|mzbe)$/;

jest.mock("stream/promises", () => ({
  pipeline: jest.fn().mockResolvedValue(undefined),
}));

describe("AutoBackupService", () => {
  let service: AutoBackupService;
  let mockSettingsRepo: Record<string, jest.Mock>;
  let mockUsersRepo: Record<string, jest.Mock>;
  let mockBackupService: Record<string, jest.Mock>;

  const userId = "55555555-5555-5555-5555-555555555555";

  function createSettings(
    overrides: Partial<AutoBackupSettings> = {},
  ): AutoBackupSettings {
    const s = new AutoBackupSettings();
    s.userId = userId;
    s.enabled = false;
    s.folderPath = "";
    s.frequency = "daily";
    s.backupTime = "02:00";
    s.timezone = "UTC";
    s.retentionDaily = 7;
    s.retentionWeekly = 4;
    s.retentionMonthly = 6;
    s.lastBackupAt = null;
    s.lastBackupStatus = null;
    s.lastBackupError = null;
    s.nextBackupAt = null;
    Object.assign(s, overrides);
    return s;
  }

  function setupFsWritableMocks() {
    (fsPromises.stat as unknown as jest.Mock).mockResolvedValue({
      isDirectory: () => true,
    });
    (fsPromises.writeFile as unknown as jest.Mock).mockResolvedValue(undefined);
    (fsPromises.unlink as unknown as jest.Mock).mockResolvedValue(undefined);
  }

  function setupExportMocks() {
    setupFsWritableMocks();
    (fsMock.createWriteStream as unknown as jest.Mock).mockReturnValue({
      on: jest.fn(),
    });
    (fsMock.readdirSync as unknown as jest.Mock).mockReturnValue([]);
  }

  async function createService(
    env: Record<string, string> = {},
  ): Promise<AutoBackupService> {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: DataSource,
          useValue: createScopedDbMocks([
            [AutoBackupSettings, mockSettingsRepo as never],
            [User, mockUsersRepo as never],
          ]).dataSource,
        },
        AutoBackupService,
        {
          provide: BackupService,
          useValue: mockBackupService,
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((key: string) => env[key]) },
        },
      ],
    }).compile();

    return module.get<AutoBackupService>(AutoBackupService);
  }

  beforeEach(async () => {
    mockSettingsRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn().mockImplementation((data) => {
        const s = new AutoBackupSettings();
        Object.assign(s, data);
        return s;
      }),
      save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
    };

    mockUsersRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: userId,
        backupEncryptionEnabled: false,
        backupPasswordEnc: null,
      }),
    };

    mockBackupService = {
      exportToBuffer: jest
        .fn()
        .mockResolvedValue(Buffer.from("gzipped-export")),
      resolveStoredBackupPassword: jest.fn().mockReturnValue(null),
    };

    service = await createService();
  });

  afterEach(() => {
    // `clearAllMocks` resets call history but NOT implementations, so a
    // `mockRejectedValue` set by one test leaks into every later one. The
    // folder-permission test below sets `fsPromises.mkdir` to reject, and once
    // the service began creating a per-owner directory that leak failed
    // fourteen unrelated tests. Restore the default here rather than relying on
    // each test to undo its own doubles.
    jest.clearAllMocks();
    (fsPromises.mkdir as unknown as jest.Mock).mockResolvedValue(undefined);
    (fsPromises.writeFile as unknown as jest.Mock).mockResolvedValue(undefined);
    (fsPromises.rename as unknown as jest.Mock).mockResolvedValue(undefined);
    (fsPromises.link as unknown as jest.Mock).mockResolvedValue(undefined);
    (fsPromises.unlink as unknown as jest.Mock).mockResolvedValue(undefined);
  });

  describe("getSettings", () => {
    it("should return existing settings when found", async () => {
      const existing = createSettings({
        enabled: true,
        folderPath: "/backups",
      });
      mockSettingsRepo.findOne.mockResolvedValue(existing);

      const result = await service.getSettings(userId);

      expect(result).toStrictEqual(existing);
      expect(mockSettingsRepo.findOne).toHaveBeenCalledWith({
        where: { userId },
      });
    });

    it("should return defaults when no settings exist", async () => {
      mockSettingsRepo.findOne.mockResolvedValue(null);

      const result = await service.getSettings(userId);

      expect(result.userId).toBe(userId);
      expect(result.enabled).toBe(false);
      expect(result.folderPath).toBe(DEFAULT_BACKUP_CONTAINER_DIR);
      expect(result.frequency).toBe("daily");
      expect(result.backupTime).toBe("02:00");
      expect(result.retentionDaily).toBe(7);
      expect(result.retentionWeekly).toBe(4);
      expect(result.retentionMonthly).toBe(6);
    });

    it("should report the default folder for a stored row without one", async () => {
      mockSettingsRepo.findOne.mockResolvedValue(
        createSettings({ enabled: true, folderPath: "" }),
      );

      const result = await service.getSettings(userId);

      expect(result.folderPath).toBe(DEFAULT_BACKUP_CONTAINER_DIR);
      expect(result.enabled).toBe(true);
    });

    it("should default the folder path to BACKUP_CONTAINER_DIR when configured", async () => {
      service = await createService({
        BACKUP_CONTAINER_DIR: "/mnt/monize-backups",
      });
      mockSettingsRepo.findOne.mockResolvedValue(null);

      const result = await service.getSettings(userId);

      expect(result.folderPath).toBe("/mnt/monize-backups");
    });

    it("should trim a configured BACKUP_CONTAINER_DIR", async () => {
      service = await createService({
        BACKUP_CONTAINER_DIR: "  /mnt/backups/  ",
      });
      mockSettingsRepo.findOne.mockResolvedValue(null);

      const result = await service.getSettings(userId);

      expect(result.folderPath).toBe("/mnt/backups");
    });

    it("should fall back to the built-in default for an invalid BACKUP_CONTAINER_DIR", async () => {
      service = await createService({
        BACKUP_CONTAINER_DIR: "relative/backups",
      });
      mockSettingsRepo.findOne.mockResolvedValue(null);

      const result = await service.getSettings(userId);

      expect(result.folderPath).toBe(DEFAULT_BACKUP_CONTAINER_DIR);
    });
  });

  describe("updateSettings", () => {
    it("should create new settings if none exist", async () => {
      mockSettingsRepo.findOne.mockResolvedValue(null);

      await service.updateSettings(userId, {
        folderPath: "/backups",
        frequency: "weekly",
      });

      // The row is built by defaultSettingsFor() and saved directly; the
      // repo.create() round-trip it used to go through was a no-op clone.
      expect(mockSettingsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          folderPath: "/backups",
          frequency: "weekly",
        }),
      );
    });

    it("should update existing settings", async () => {
      const existing = createSettings({ folderPath: "/old" });
      mockSettingsRepo.findOne.mockResolvedValue(existing);

      await service.updateSettings(userId, {
        folderPath: "/new-backups",
        retentionDaily: 14,
      });

      expect(mockSettingsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          folderPath: "/new-backups",
          retentionDaily: 14,
        }),
      );
    });

    it("should fall back to BACKUP_CONTAINER_DIR when enabling without a folder path", async () => {
      service = await createService({
        BACKUP_CONTAINER_DIR: "/mnt/monize-backups",
      });
      mockSettingsRepo.findOne.mockResolvedValue(null);
      setupFsWritableMocks();

      await service.updateSettings(userId, { enabled: true });

      expect(mockSettingsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          enabled: true,
          folderPath: "/mnt/monize-backups",
        }),
      );
    });

    it("should validate folder is writable when enabling", async () => {
      const existing = createSettings({ folderPath: "/backups" });
      mockSettingsRepo.findOne.mockResolvedValue(existing);
      setupFsWritableMocks();

      await service.updateSettings(userId, { enabled: true });

      expect(mockSettingsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          enabled: true,
          nextBackupAt: expect.any(Date),
        }),
      );
    });

    it("should clear nextBackupAt when disabling", async () => {
      const existing = createSettings({
        enabled: true,
        folderPath: "/backups",
        nextBackupAt: new Date(),
      });
      mockSettingsRepo.findOne.mockResolvedValue(existing);

      await service.updateSettings(userId, { enabled: false });

      expect(mockSettingsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          enabled: false,
          nextBackupAt: null,
        }),
      );
    });

    it("should reject non-absolute paths", async () => {
      mockSettingsRepo.findOne.mockResolvedValue(null);

      await expect(
        service.updateSettings(userId, { folderPath: "relative/path" }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should reject paths with '..'", async () => {
      mockSettingsRepo.findOne.mockResolvedValue(null);

      await expect(
        service.updateSettings(userId, { folderPath: "/backups/../etc" }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should update retention values", async () => {
      const existing = createSettings();
      mockSettingsRepo.findOne.mockResolvedValue(existing);

      await service.updateSettings(userId, {
        retentionDaily: 30,
        retentionWeekly: 12,
        retentionMonthly: 24,
      });

      expect(mockSettingsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          retentionDaily: 30,
          retentionWeekly: 12,
          retentionMonthly: 24,
        }),
      );
    });

    it("should update backupTime", async () => {
      const existing = createSettings();
      mockSettingsRepo.findOne.mockResolvedValue(existing);

      await service.updateSettings(userId, { backupTime: "14:30" });

      expect(mockSettingsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ backupTime: "14:30" }),
      );
    });
  });

  describe("validateFolder", () => {
    it("should return valid for a writable directory", async () => {
      setupFsWritableMocks();

      const result = await service.validateFolder("/backups");

      expect(result).toEqual({ valid: true });
    });

    it("should return invalid for non-existent directory", async () => {
      (fsPromises.stat as unknown as jest.Mock).mockRejectedValue({
        code: "ENOENT",
      });

      const result = await service.validateFolder("/no-such-dir");

      expect(result.valid).toBe(false);
      expect(result.error).toContain("does not exist");
    });

    it("should return invalid for non-directory path", async () => {
      (fsPromises.stat as unknown as jest.Mock).mockResolvedValue({
        isDirectory: () => false,
      });

      const result = await service.validateFolder("/some/file.txt");

      expect(result.valid).toBe(false);
      expect(result.error).toContain("not a directory");
    });

    it("should return invalid for non-writable directory", async () => {
      (fsPromises.stat as unknown as jest.Mock).mockResolvedValue({
        isDirectory: () => true,
      });
      (fsPromises.writeFile as unknown as jest.Mock).mockRejectedValue(
        new Error("EACCES"),
      );

      const result = await service.validateFolder("/read-only");

      expect(result.valid).toBe(false);
      expect(result.error).toContain("not writable");
    });

    it("should return invalid for relative paths", async () => {
      const result = await service.validateFolder("relative/path");

      expect(result.valid).toBe(false);
      expect(result.error).toContain("absolute path");
    });

    it("should return invalid for paths with '..'", async () => {
      const result = await service.validateFolder("/backups/../etc");

      expect(result.valid).toBe(false);
      expect(result.error).toContain("..");
    });
  });

  describe("default backup folder creation", () => {
    it("should create the configured default folder when it is missing", async () => {
      (fsPromises.stat as unknown as jest.Mock).mockRejectedValue({
        code: "ENOENT",
      });
      (fsPromises.mkdir as unknown as jest.Mock).mockResolvedValue(undefined);
      (fsPromises.writeFile as unknown as jest.Mock).mockResolvedValue(
        undefined,
      );
      (fsPromises.unlink as unknown as jest.Mock).mockResolvedValue(undefined);

      const result = await service.validateFolder(DEFAULT_BACKUP_CONTAINER_DIR);

      expect(result).toEqual({ valid: true });
      expect(fsPromises.mkdir).toHaveBeenCalledWith(
        DEFAULT_BACKUP_CONTAINER_DIR,
        {
          recursive: true,
        },
      );
    });

    it("should not create a user-chosen folder that is missing", async () => {
      (fsPromises.stat as unknown as jest.Mock).mockRejectedValue({
        code: "ENOENT",
      });

      const result = await service.validateFolder("/some/other/folder");

      expect(result.valid).toBe(false);
      expect(result.error).toContain("does not exist");
      expect(fsPromises.mkdir).not.toHaveBeenCalled();
    });

    it("should report an error when the default folder cannot be created", async () => {
      (fsPromises.stat as unknown as jest.Mock).mockRejectedValue({
        code: "ENOENT",
      });
      (fsPromises.mkdir as unknown as jest.Mock).mockRejectedValue(
        new Error("EACCES"),
      );

      const result = await service.validateFolder(DEFAULT_BACKUP_CONTAINER_DIR);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("does not exist");
    });
  });

  describe("browseFolders", () => {
    it("should list subdirectories", async () => {
      (fsPromises.stat as unknown as jest.Mock).mockResolvedValue({
        isDirectory: () => true,
      });
      (fsPromises.readdir as unknown as jest.Mock).mockResolvedValue([
        { name: "backups", isDirectory: () => true },
        { name: "data", isDirectory: () => true },
        { name: ".hidden", isDirectory: () => true },
        { name: "file.txt", isDirectory: () => false },
      ]);

      const result = await service.browseFolders("/");

      expect(result.current).toBe("/");
      expect(result.directories).toEqual(["backups", "data"]);
    });

    it("should throw for non-existent path", async () => {
      (fsPromises.stat as unknown as jest.Mock).mockRejectedValue({
        code: "ENOENT",
      });

      await expect(service.browseFolders("/no-such")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should throw for relative paths", async () => {
      await expect(service.browseFolders("relative")).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe("runManualBackup", () => {
    it("should back up to BACKUP_CONTAINER_DIR when no settings exist", async () => {
      service = await createService({
        BACKUP_CONTAINER_DIR: "/mnt/monize-backups",
      });
      mockSettingsRepo.findOne.mockResolvedValue(null);
      setupExportMocks();

      await service.runManualBackup(userId);

      expect(mockSettingsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          folderPath: "/mnt/monize-backups",
          lastBackupStatus: "success",
        }),
      );
    });

    it("should back up to BACKUP_CONTAINER_DIR when no folder path is set", async () => {
      mockSettingsRepo.findOne.mockResolvedValue(
        createSettings({ folderPath: "" }),
      );
      setupExportMocks();

      await service.runManualBackup(userId);

      // The bytes go to a temporary name and are linked into place, so the
      // destination of the link is what the backup actually ends up as.
      expect(fsPromises.link).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining(
          `${DEFAULT_BACKUP_CONTAINER_DIR}/${userId}/monize-backup-daily-`,
        ),
      );
    });

    it("should run backup and update status on success", async () => {
      const existing = createSettings({
        enabled: true,
        folderPath: "/backups",
      });
      mockSettingsRepo.findOne.mockResolvedValue(existing);
      setupExportMocks();

      const result = await service.runManualBackup(userId);

      expect(result.message).toBe("Backup completed successfully");
      expect(result.filename).toMatch(
        /^monize-backup-daily-\d{4}-\d{2}-\d{2}-\d{6}\.json\.gz$/,
      );
      expect(mockSettingsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          lastBackupStatus: "success",
          lastBackupError: null,
        }),
      );
    });

    it("writes an .mzbe file when the user has encryption enabled", async () => {
      mockSettingsRepo.findOne.mockResolvedValue(
        createSettings({ enabled: true, folderPath: "/backups" }),
      );
      mockUsersRepo.findOne.mockResolvedValue({
        id: userId,
        backupEncryptionEnabled: true,
        backupPasswordEnc: "enc:secret",
      });
      mockBackupService.resolveStoredBackupPassword.mockReturnValue("secret");
      setupExportMocks();

      const result = await service.runManualBackup(userId);

      expect(mockBackupService.exportToBuffer).toHaveBeenCalledWith(
        userId,
        "secret",
      );
      expect(result.filename).toMatch(
        /^monize-backup-daily-\d{4}-\d{2}-\d{2}-\d{6}\.mzbe$/,
      );
    });

    it("throws when encryption is enabled but the stored password cannot be decrypted", async () => {
      mockSettingsRepo.findOne.mockResolvedValue(
        createSettings({ enabled: true, folderPath: "/backups" }),
      );
      mockUsersRepo.findOne.mockResolvedValue({
        id: userId,
        backupEncryptionEnabled: true,
        backupPasswordEnc: "enc:bad",
      });
      // Cron has no way to recover the password (e.g. master key rotated).
      mockBackupService.resolveStoredBackupPassword.mockReturnValue(null);
      setupExportMocks();

      await expect(service.runManualBackup(userId)).rejects.toThrow(
        /Re-enable encryption in Security/,
      );
      expect(mockBackupService.exportToBuffer).not.toHaveBeenCalled();
    });

    it("throws when the user row vanishes mid-flight", async () => {
      mockSettingsRepo.findOne.mockResolvedValue(
        createSettings({ enabled: true, folderPath: "/backups" }),
      );
      mockUsersRepo.findOne.mockResolvedValue(null);
      setupExportMocks();

      await expect(service.runManualBackup(userId)).rejects.toThrow(
        /not found/,
      );
    });
  });

  describe("handleAutoBackupCron", () => {
    it("should do nothing if no backups are due", async () => {
      mockSettingsRepo.find.mockResolvedValue([]);

      await service.handleAutoBackupCron();

      expect(mockBackupService.exportToBuffer).not.toHaveBeenCalled();
    });

    it("should process due backups and update status", async () => {
      const settings = createSettings({
        enabled: true,
        folderPath: "/backups",
        nextBackupAt: new Date(Date.now() - 3600000),
      });
      mockSettingsRepo.find.mockResolvedValue([settings]);
      setupExportMocks();

      await service.handleAutoBackupCron();

      expect(mockSettingsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          lastBackupStatus: "success",
          nextBackupAt: expect.any(Date),
        }),
      );
    });

    it("should write to BACKUP_CONTAINER_DIR when a due row has no folder path", async () => {
      const settings = createSettings({
        enabled: true,
        folderPath: "",
        nextBackupAt: new Date(Date.now() - 3600000),
      });
      mockSettingsRepo.find.mockResolvedValue([settings]);
      setupExportMocks();

      await service.handleAutoBackupCron();

      // The bytes go to a temporary name and are linked into place, so the
      // destination of the link is what the backup actually ends up as.
      expect(fsPromises.link).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining(
          `${DEFAULT_BACKUP_CONTAINER_DIR}/${userId}/monize-backup-daily-`,
        ),
      );
    });

    it("should mark status as failed on error and continue", async () => {
      const settings = createSettings({
        enabled: true,
        folderPath: "/backups",
        nextBackupAt: new Date(Date.now() - 3600000),
      });
      mockSettingsRepo.find.mockResolvedValue([settings]);

      (fsPromises.stat as unknown as jest.Mock).mockRejectedValue({
        code: "ENOENT",
      });

      await service.handleAutoBackupCron();

      expect(mockSettingsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          lastBackupStatus: "failed",
          lastBackupError: expect.any(String),
          nextBackupAt: expect.any(Date),
        }),
      );
    });
  });

  describe("owner isolation", () => {
    // The suite used to assert generic date-only names against a shared
    // listing, with a single mocked owner -- so it could not have exposed a
    // filename collision or a cross-owner deletion, and a green run was
    // evidence the shared namespace survived. The default folder is one
    // deployment-wide directory, so two users backing up on the same date
    // picked the same key.
    const otherUserId = "66666666-6666-6666-6666-666666666666";

    it("writes each owner's backup under its own directory", async () => {
      const settings = createSettings({
        enabled: true,
        folderPath: "/backups",
      });
      mockSettingsRepo.findOne.mockResolvedValue(settings);
      setupExportMocks();
      (fsMock.readdirSync as unknown as jest.Mock).mockReturnValue([]);

      // `writeFile` is also used for the folder-writability probe, so pick the
      // call that actually wrote a backup.
      const backupWritePath = (): string =>
        (fsPromises.writeFile as unknown as jest.Mock).mock.calls
          .map((c) => c[0] as string)
          .find((path) => path.includes("monize-backup-"))!;

      await service.runManualBackup(userId);
      const firstPath = backupWritePath();

      (fsPromises.writeFile as unknown as jest.Mock).mockClear();
      mockUsersRepo.findOne.mockResolvedValue({ id: otherUserId });
      await service.runManualBackup(otherUserId);
      const secondPath = backupWritePath();

      // Same date, same destination folder, two different keys.
      expect(firstPath).toContain(`/backups/${userId}/`);
      expect(secondPath).toContain(`/backups/${otherUserId}/`);
      expect(firstPath).not.toBe(secondPath);
    });

    it("creates the owner directory before writing into it", async () => {
      const settings = createSettings({
        enabled: true,
        folderPath: "/backups",
      });
      mockSettingsRepo.findOne.mockResolvedValue(settings);
      setupExportMocks();
      (fsMock.readdirSync as unknown as jest.Mock).mockReturnValue([]);

      await service.runManualBackup(userId);

      expect(fsPromises.mkdir).toHaveBeenCalledWith(`/backups/${userId}`, {
        recursive: true,
      });
    });

    it("retention lists and deletes only inside the owner's directory", async () => {
      const settings = createSettings({
        enabled: true,
        folderPath: "/backups",
        retentionDaily: 1,
        retentionWeekly: 0,
        retentionMonthly: 0,
      });
      mockSettingsRepo.findOne.mockResolvedValue(settings);
      setupExportMocks();
      (fsMock.readdirSync as unknown as jest.Mock).mockReturnValue([
        "monize-backup-daily-2026-04-01.json.gz",
        "monize-backup-daily-2026-04-02.json.gz",
      ]);

      await service.runManualBackup(userId);

      // The directory it enumerated for retention is the owner's, not the
      // shared parent -- so another owner's files were never candidates.
      expect(fsMock.readdirSync).toHaveBeenCalledWith(`/backups/${userId}`);
      for (const call of (fsMock.unlinkSync as unknown as jest.Mock).mock
        .calls) {
        expect(call[0]).toContain(`/backups/${userId}/`);
        expect(call[0]).not.toContain(`/backups/${otherUserId}/`);
      }
    });

    it("never deletes a legacy file sitting in the shared parent folder", async () => {
      // Those files carry no owner id, so nothing can attribute them. Deleting
      // them would destroy another user's recovery points; they are reported
      // instead.
      const settings = createSettings({
        enabled: true,
        folderPath: "/backups",
        retentionDaily: 0,
        retentionWeekly: 0,
        retentionMonthly: 0,
      });
      mockSettingsRepo.findOne.mockResolvedValue(settings);
      setupExportMocks();
      (fsMock.readdirSync as unknown as jest.Mock).mockImplementation(
        (path: string) =>
          path === "/backups"
            ? ["monize-backup-daily-2020-01-01.json.gz", `${userId}`]
            : [],
      );

      await service.runManualBackup(userId);

      for (const call of (fsMock.unlinkSync as unknown as jest.Mock).mock
        .calls) {
        expect(call[0]).not.toBe(
          "/backups/monize-backup-daily-2020-01-01.json.gz",
        );
      }
    });
  });

  describe("sub-daily occurrences are distinct recovery points", () => {
    // `every6hours` and `every12hours` are offered as frequencies, but the
    // filename was date-only: four runs on one day wrote the same path, the last
    // replaced the first three, and the settings row plus the log still reported
    // four successful backups. Per-user directories fixed collisions *between*
    // owners and did nothing for these.
    const runInstants = [
      "2026-04-14T02:00:00Z",
      "2026-04-14T08:00:00Z",
      "2026-04-14T14:00:00Z",
      "2026-04-14T20:00:00Z",
    ];

    it("writes four distinct files for four runs on the same day", async () => {
      const settings = createSettings({
        enabled: true,
        folderPath: "/backups",
        frequency: "every6hours",
        timezone: "UTC",
        // Retention must not remove any of the four while we count them.
        retentionDaily: 10,
        retentionWeekly: 0,
        retentionMonthly: 0,
      });
      mockSettingsRepo.findOne.mockResolvedValue(settings);
      setupExportMocks();

      const written: string[] = [];
      for (const instant of runInstants) {
        jest.useFakeTimers().setSystemTime(new Date(instant));
        try {
          (fsPromises.link as unknown as jest.Mock).mockClear();
          await service.runManualBackup(userId);
          written.push(
            (fsPromises.link as unknown as jest.Mock).mock
              .calls[0][1] as string,
          );
        } finally {
          jest.useRealTimers();
        }
      }

      expect(written).toHaveLength(4);
      expect(new Set(written).size).toBe(4);
      // All four are the same day, distinguished only by the time component.
      for (const path of written) {
        expect(path).toMatch(
          new RegExp(
            `/backups/${userId}/monize-backup-daily-2026-04-14-\\d{6}\\.json\\.gz$`,
          ),
        );
      }
      expect(written[0]).toContain("-020000.");
      expect(written[3]).toContain("-200000.");
    });

    it("retains the newest occurrences within a single day", async () => {
      // Retention sorts newest-first. Without the time in the name every
      // occurrence from one day compared equal, so which survived depended on the
      // order the filesystem happened to list them in.
      const settings = createSettings({
        enabled: true,
        folderPath: "/backups",
        retentionDaily: 2,
        retentionWeekly: 0,
        retentionMonthly: 0,
      });
      mockSettingsRepo.findOne.mockResolvedValue(settings);
      setupExportMocks();
      (fsMock.readdirSync as unknown as jest.Mock).mockReturnValue([
        "monize-backup-daily-2026-04-14-020000.json.gz",
        "monize-backup-daily-2026-04-14-080000.json.gz",
        "monize-backup-daily-2026-04-14-140000.json.gz",
      ]);

      await service.runManualBackup(userId);

      const deleted = (
        fsMock.unlinkSync as unknown as jest.Mock
      ).mock.calls.map((c) => c[0] as string);
      expect(deleted).toContain(
        `/backups/${userId}/monize-backup-daily-2026-04-14-020000.json.gz`,
      );
      expect(deleted).not.toContain(
        `/backups/${userId}/monize-backup-daily-2026-04-14-140000.json.gz`,
      );
    });

    it("still recognises a legacy date-only file, and treats it as the oldest", async () => {
      // Files written before the time component existed must keep being counted
      // and retained rather than becoming invisible to retention.
      const settings = createSettings({
        enabled: true,
        folderPath: "/backups",
        retentionDaily: 1,
        retentionWeekly: 0,
        retentionMonthly: 0,
      });
      mockSettingsRepo.findOne.mockResolvedValue(settings);
      setupExportMocks();
      (fsMock.readdirSync as unknown as jest.Mock).mockReturnValue([
        "monize-backup-daily-2026-04-14.json.gz",
        "monize-backup-daily-2026-04-14-140000.json.gz",
      ]);

      await service.runManualBackup(userId);

      const deleted = (
        fsMock.unlinkSync as unknown as jest.Mock
      ).mock.calls.map((c) => c[0] as string);
      expect(deleted).toContain(
        `/backups/${userId}/monize-backup-daily-2026-04-14.json.gz`,
      );
      expect(deleted).not.toContain(
        `/backups/${userId}/monize-backup-daily-2026-04-14-140000.json.gz`,
      );
    });
  });

  describe("a partial write never becomes a backup", () => {
    it("writes to a temporary name and links it into place", async () => {
      const settings = createSettings({
        enabled: true,
        folderPath: "/backups",
      });
      mockSettingsRepo.findOne.mockResolvedValue(settings);
      setupExportMocks();

      await service.runManualBackup(userId);

      const [tempPath, flags] = (
        fsPromises.writeFile as unknown as jest.Mock
      ).mock.calls.find((c) => (c[0] as string).includes("partial"))! as [
        string,
        unknown,
        { flag?: string },
      ];
      const [linkFrom, linkTo] = (fsPromises.link as unknown as jest.Mock).mock
        .calls[0] as [string, string];
      void flags;

      expect(tempPath).toBe(linkFrom);
      // Exclusive create: if the temporary name somehow exists, the open must
      // fail rather than truncate whatever is there.
      const writeOptions = (
        fsPromises.writeFile as unknown as jest.Mock
      ).mock.calls.find((c) => (c[0] as string).includes("partial"))![2] as {
        flag?: string;
      };
      expect(writeOptions.flag).toBe("wx");
      // Each run's temporary name is its own, so two writers cannot share one.
      expect(tempPath).toMatch(
        /\.monize-backup-partial-\d{4}-\d{2}-\d{2}-\d{6}-[0-9a-f-]{36}\./,
      );
      // The temporary name must not look like a backup, or retention would count
      // and could delete it.
      expect(DAILY_PATTERN.test(tempPath.split("/").pop()!)).toBe(false);
      expect(DAILY_PATTERN.test(linkTo.split("/").pop()!)).toBe(true);
    });

    it("removes the temporary file when publishing fails", async () => {
      const settings = createSettings({
        enabled: true,
        folderPath: "/backups",
      });
      mockSettingsRepo.findOne.mockResolvedValue(settings);
      setupExportMocks();
      (fsPromises.link as unknown as jest.Mock).mockRejectedValueOnce(
        new Error("ENOSPC"),
      );

      await expect(service.runManualBackup(userId)).rejects.toThrow("ENOSPC");
      expect(fsPromises.unlink).toHaveBeenCalledWith(
        expect.stringContaining("partial"),
      );
    });

    it("drops the temporary link once the backup has its real name", async () => {
      // The payload has two names after the link; leaving ours behind would
      // accumulate a dot-file per backup forever.
      const settings = createSettings({
        enabled: true,
        folderPath: "/backups",
      });
      mockSettingsRepo.findOne.mockResolvedValue(settings);
      setupExportMocks();

      await service.runManualBackup(userId);

      expect(fsPromises.unlink).toHaveBeenCalledWith(
        expect.stringContaining("partial"),
      );
    });

    it("names the second backup of the same second differently instead of overwriting", async () => {
      // Two accepted backups must not become one file. `link` refuses a name
      // that exists, so the loser takes a discriminated name -- and it still has
      // to match the retention pattern, or it becomes a recovery point nothing
      // ever sweeps.
      const settings = createSettings({
        enabled: true,
        folderPath: "/backups",
      });
      mockSettingsRepo.findOne.mockResolvedValue(settings);
      setupExportMocks();
      const taken = Object.assign(new Error("EEXIST"), { code: "EEXIST" });
      (fsPromises.link as unknown as jest.Mock)
        .mockRejectedValueOnce(taken)
        .mockResolvedValueOnce(undefined);

      await service.runManualBackup(userId);

      const [firstFrom, first] = (fsPromises.link as unknown as jest.Mock).mock
        .calls[0] as [string, string];
      const [secondFrom, second] = (fsPromises.link as unknown as jest.Mock)
        .mock.calls[1] as [string, string];
      // Same payload, two candidate names -- never an overwrite of the first.
      expect(secondFrom).toBe(firstFrom);
      expect(second).not.toBe(first);
      expect(second).toMatch(
        /monize-backup-daily-\d{4}-\d{2}-\d{2}-\d{6}-1\.json\.gz$/,
      );
      expect(DAILY_PATTERN.test(second.split("/").pop()!)).toBe(true);
    });

    it("fails rather than looping when every discriminated name is taken", async () => {
      const settings = createSettings({
        enabled: true,
        folderPath: "/backups",
      });
      mockSettingsRepo.findOne.mockResolvedValue(settings);
      setupExportMocks();
      (fsPromises.link as unknown as jest.Mock).mockRejectedValue(
        Object.assign(new Error("EEXIST"), { code: "EEXIST" }),
      );

      await expect(service.runManualBackup(userId)).rejects.toThrow(
        /same second/,
      );
      expect(fsPromises.unlink).toHaveBeenCalledWith(
        expect.stringContaining("partial"),
      );
    });
  });

  describe("retention policy", () => {
    it("should keep the most recent N daily backups", async () => {
      const settings = createSettings({
        enabled: true,
        folderPath: "/backups",
        retentionDaily: 2,
        retentionWeekly: 0,
        retentionMonthly: 0,
      });
      mockSettingsRepo.findOne.mockResolvedValue(settings);

      const files = [
        "monize-backup-daily-2026-04-01.json.gz",
        "monize-backup-daily-2026-04-02.json.gz",
        "monize-backup-daily-2026-04-03.json.gz",
      ];
      setupExportMocks();
      (fsMock.readdirSync as unknown as jest.Mock).mockReturnValue(files);

      await service.runManualBackup(userId);

      // Should delete the oldest file (April 1), keep April 2 and 3
      expect(fsMock.unlinkSync).toHaveBeenCalledWith(
        `/backups/${userId}/monize-backup-daily-2026-04-01.json.gz`,
      );
    });

    it("should keep the most recent N weekly backups independently", async () => {
      const settings = createSettings({
        enabled: true,
        folderPath: "/backups",
        retentionDaily: 7,
        retentionWeekly: 2,
        retentionMonthly: 0,
      });
      mockSettingsRepo.findOne.mockResolvedValue(settings);

      const files = [
        "monize-backup-weekly-2026-03-07.json.gz",
        "monize-backup-weekly-2026-03-14.json.gz",
        "monize-backup-weekly-2026-03-21.json.gz",
      ];
      setupExportMocks();
      (fsMock.readdirSync as unknown as jest.Mock).mockReturnValue(files);

      await service.runManualBackup(userId);

      // Should delete the oldest weekly (March 7), keep March 14 and 21
      expect(fsMock.unlinkSync).toHaveBeenCalledWith(
        `/backups/${userId}/monize-backup-weekly-2026-03-07.json.gz`,
      );
    });

    it("should keep the most recent N monthly backups independently", async () => {
      const settings = createSettings({
        enabled: true,
        folderPath: "/backups",
        retentionDaily: 7,
        retentionWeekly: 4,
        retentionMonthly: 1,
      });
      mockSettingsRepo.findOne.mockResolvedValue(settings);

      const files = [
        "monize-backup-monthly-26-01.json.gz",
        "monize-backup-monthly-26-02.json.gz",
      ];
      setupExportMocks();
      (fsMock.readdirSync as unknown as jest.Mock).mockReturnValue(files);

      await service.runManualBackup(userId);

      // Should delete the oldest monthly (Jan), keep Feb
      expect(fsMock.unlinkSync).toHaveBeenCalledWith(
        `/backups/${userId}/monize-backup-monthly-26-01.json.gz`,
      );
    });

    it("should copy daily to weekly on days 7, 14, 21, 28", async () => {
      const settings = createSettings({
        enabled: true,
        folderPath: "/backups",
      });
      mockSettingsRepo.findOne.mockResolvedValue(settings);
      setupExportMocks();

      jest.useFakeTimers();
      jest.setSystemTime(new Date("2026-04-14T10:00:00Z"));

      try {
        await service.runManualBackup(userId);

        expect(fsMock.copyFileSync).toHaveBeenCalledWith(
          `/backups/${userId}/monize-backup-daily-2026-04-14-100000.json.gz`,
          `/backups/${userId}/monize-backup-weekly-2026-04-14.json.gz`,
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it("should copy daily to monthly on day 1", async () => {
      const settings = createSettings({
        enabled: true,
        folderPath: "/backups",
      });
      mockSettingsRepo.findOne.mockResolvedValue(settings);
      setupExportMocks();

      jest.useFakeTimers();
      jest.setSystemTime(new Date("2026-04-01T10:00:00Z"));

      try {
        await service.runManualBackup(userId);

        expect(fsMock.copyFileSync).toHaveBeenCalledWith(
          `/backups/${userId}/monize-backup-daily-2026-04-01-100000.json.gz`,
          `/backups/${userId}/monize-backup-monthly-26-04.json.gz`,
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it("should not delete non-backup files", async () => {
      const settings = createSettings({
        enabled: true,
        folderPath: "/backups",
        retentionDaily: 1,
        retentionWeekly: 0,
        retentionMonthly: 0,
      });
      mockSettingsRepo.findOne.mockResolvedValue(settings);

      const files = [
        "monize-backup-daily-2026-04-01.json.gz",
        "some-other-file.txt",
        "readme.md",
      ];
      setupExportMocks();
      (fsMock.readdirSync as unknown as jest.Mock).mockReturnValue(files);

      await service.runManualBackup(userId);

      expect(fsMock.unlinkSync).not.toHaveBeenCalled();
    });
  });

  describe("frequency calculation with backup time", () => {
    it("should schedule daily backup at configured time", async () => {
      const existing = createSettings({
        folderPath: "/backups",
        backupTime: "03:30",
      });
      mockSettingsRepo.findOne.mockResolvedValue(existing);
      setupFsWritableMocks();

      await service.updateSettings(userId, {
        enabled: true,
        frequency: "daily",
      });

      const savedCall = mockSettingsRepo.save.mock.calls[0][0];
      const nextAt = savedCall.nextBackupAt as Date;
      expect(nextAt.getUTCHours()).toBe(3);
      // Minutes are snapped to 0 since the cron fires at minute 0 each hour
      expect(nextAt.getUTCMinutes()).toBe(0);
    });

    it("should schedule next slot for sub-daily frequency", async () => {
      const existing = createSettings({
        folderPath: "/backups",
        backupTime: "00:00",
      });
      mockSettingsRepo.findOne.mockResolvedValue(existing);
      setupFsWritableMocks();

      await service.updateSettings(userId, {
        enabled: true,
        frequency: "every6hours",
      });

      const savedCall = mockSettingsRepo.save.mock.calls[0][0];
      const nextAt = savedCall.nextBackupAt as Date;
      // Should be at minute 0 (aligned to configured time)
      expect(nextAt.getUTCMinutes()).toBe(0);
    });

    it("should schedule weekly backup at configured time", async () => {
      const existing = createSettings({
        folderPath: "/backups",
        backupTime: "23:00",
      });
      mockSettingsRepo.findOne.mockResolvedValue(existing);
      setupFsWritableMocks();

      await service.updateSettings(userId, {
        enabled: true,
        frequency: "weekly",
      });

      const savedCall = mockSettingsRepo.save.mock.calls[0][0];
      const nextAt = savedCall.nextBackupAt as Date;
      expect(nextAt.getUTCHours()).toBe(23);
      expect(nextAt.getUTCMinutes()).toBe(0);
    });

    it("should convert local timezone backup time to UTC", async () => {
      // America/New_York is UTC-5 (EST) or UTC-4 (EDT)
      const existing = createSettings({
        folderPath: "/backups",
        backupTime: "02:00",
        timezone: "America/New_York",
      });
      mockSettingsRepo.findOne.mockResolvedValue(existing);
      setupFsWritableMocks();

      await service.updateSettings(userId, {
        enabled: true,
        frequency: "daily",
      });

      const savedCall = mockSettingsRepo.save.mock.calls[0][0];
      const nextAt = savedCall.nextBackupAt as Date;
      // 02:00 EST = 07:00 UTC, or 02:00 EDT = 06:00 UTC
      expect([6, 7]).toContain(nextAt.getUTCHours());
      expect(nextAt.getUTCMinutes()).toBe(0);
    });

    it("should handle UTC timezone without offset", async () => {
      const existing = createSettings({
        folderPath: "/backups",
        backupTime: "14:30",
        timezone: "UTC",
      });
      mockSettingsRepo.findOne.mockResolvedValue(existing);
      setupFsWritableMocks();

      await service.updateSettings(userId, {
        enabled: true,
        frequency: "daily",
      });

      const savedCall = mockSettingsRepo.save.mock.calls[0][0];
      const nextAt = savedCall.nextBackupAt as Date;
      expect(nextAt.getUTCHours()).toBe(14);
      // Minutes are snapped to 0 since the cron fires at minute 0 each hour
      expect(nextAt.getUTCMinutes()).toBe(0);
    });

    it("should handle positive UTC offset timezone", async () => {
      // Europe/Berlin is UTC+1 (CET) or UTC+2 (CEST)
      const existing = createSettings({
        folderPath: "/backups",
        backupTime: "03:00",
        timezone: "Europe/Berlin",
      });
      mockSettingsRepo.findOne.mockResolvedValue(existing);
      setupFsWritableMocks();

      await service.updateSettings(userId, {
        enabled: true,
        frequency: "daily",
      });

      const savedCall = mockSettingsRepo.save.mock.calls[0][0];
      const nextAt = savedCall.nextBackupAt as Date;
      // 03:00 CET = 02:00 UTC, or 03:00 CEST = 01:00 UTC
      expect([1, 2]).toContain(nextAt.getUTCHours());
      expect(nextAt.getUTCMinutes()).toBe(0);
    });

    it("should store timezone when updating settings", async () => {
      const existing = createSettings({ folderPath: "/backups" });
      mockSettingsRepo.findOne.mockResolvedValue(existing);
      setupFsWritableMocks();

      await service.updateSettings(userId, {
        timezone: "Asia/Tokyo",
      });

      const savedCall = mockSettingsRepo.save.mock.calls[0][0];
      expect(savedCall.timezone).toBe("Asia/Tokyo");
    });

    it("should use timezone for sub-daily frequency scheduling", async () => {
      // America/Chicago is UTC-6 (CST) or UTC-5 (CDT)
      const existing = createSettings({
        folderPath: "/backups",
        backupTime: "06:00",
        timezone: "America/Chicago",
      });
      mockSettingsRepo.findOne.mockResolvedValue(existing);
      setupFsWritableMocks();

      await service.updateSettings(userId, {
        enabled: true,
        frequency: "every12hours",
      });

      const savedCall = mockSettingsRepo.save.mock.calls[0][0];
      const nextAt = savedCall.nextBackupAt as Date;
      // 06:00 CST = 12:00 UTC, or 06:00 CDT = 11:00 UTC
      // Slots are at 06:00 and 18:00 local, so UTC equivalents vary
      expect(nextAt.getUTCMinutes()).toBe(0);
    });
  });
});
