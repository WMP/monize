import { Test, TestingModule } from "@nestjs/testing";
import { DataSource } from "typeorm";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { BackupEncryptionService } from "./backup-encryption.service";
import { User } from "../users/entities/user.entity";
import { AiEncryptionService } from "../ai/ai-encryption.service";
import { PasswordBreachService } from "../auth/password-breach.service";
import { createScopedDbMocks } from "../test-helpers/scoped-db-testing";

jest.mock("../common/db/scoped-db", () =>
  jest.requireActual("../test-helpers/scoped-db-testing").scopedDbMockModule(),
);

jest.mock("bcryptjs");

describe("BackupEncryptionService", () => {
  let service: BackupEncryptionService;
  let usersRepo: Record<string, jest.Mock>;
  let aiEncryption: Record<string, jest.Mock>;
  let passwordBreach: Record<string, jest.Mock>;

  const userId = "user-1";

  function makeUser(overrides: Partial<User> = {}): User {
    return {
      id: userId,
      authProvider: "local",
      passwordHash: "bcrypt-hash",
      backupEncryptionEnabled: false,
      backupPasswordEnc: null,
      ...overrides,
    } as User;
  }

  beforeEach(async () => {
    usersRepo = {
      findOne: jest.fn(),
      save: jest.fn().mockImplementation((u) => Promise.resolve(u)),
    };
    aiEncryption = {
      isConfigured: jest.fn().mockReturnValue(true),
      encrypt: jest.fn((s: string) => `enc:${s}`),
      decrypt: jest.fn((s: string) => s.replace(/^enc:/, "")),
    };
    passwordBreach = {
      isBreached: jest.fn().mockResolvedValue(false),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: DataSource,
          useValue: createScopedDbMocks([[User, usersRepo as never]])
            .dataSource,
        },
        BackupEncryptionService,
        { provide: AiEncryptionService, useValue: aiEncryption },
        { provide: PasswordBreachService, useValue: passwordBreach },
      ],
    }).compile();

    service = module.get(BackupEncryptionService);
  });

  afterEach(() => jest.clearAllMocks());

  describe("getStatus", () => {
    it("reports a local user's encryption as enabled but not theirs to manage", async () => {
      usersRepo.findOne.mockResolvedValue(
        makeUser({ backupEncryptionEnabled: true }),
      );
      // Their password is recaptured at every login, so Settings offers them
      // nothing to change.
      expect(await service.getStatus(userId)).toEqual({
        enabled: true,
        manageable: false,
      });
    });

    it("reports an OIDC user's encryption as theirs to manage", async () => {
      usersRepo.findOne.mockResolvedValue(
        makeUser({ authProvider: "oidc", passwordHash: null }),
      );
      expect(await service.getStatus(userId)).toEqual({
        enabled: false,
        manageable: true,
      });
    });

    it("throws when user not found", async () => {
      usersRepo.findOne.mockResolvedValue(null);
      await expect(service.getStatus(userId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("rememberLoginPassword", () => {
    it("stores the encrypted password and turns encryption on", async () => {
      const user = makeUser();
      usersRepo.findOne.mockResolvedValue(user);

      await service.rememberLoginPassword(userId, "hunter2hunter2");

      expect(aiEncryption.encrypt).toHaveBeenCalledWith("hunter2hunter2");
      expect(usersRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          backupPasswordEnc: "enc:hunter2hunter2",
          backupEncryptionEnabled: true,
        }),
      );
    });

    it("replaces a stored copy that no longer matches", async () => {
      usersRepo.findOne.mockResolvedValue(
        makeUser({
          backupEncryptionEnabled: true,
          backupPasswordEnc: "enc:old-password",
        }),
      );

      await service.rememberLoginPassword(userId, "new-password");

      expect(usersRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ backupPasswordEnc: "enc:new-password" }),
      );
    });

    it("refreshes the stored copy even when it already matches", async () => {
      usersRepo.findOne.mockResolvedValue(
        makeUser({
          backupEncryptionEnabled: true,
          backupPasswordEnc: "enc:hunter2hunter2",
        }),
      );

      await service.rememberLoginPassword(userId, "hunter2hunter2");

      // Deliberately unconditional. Reading the stored copy back to compare it
      // means decrypting a secret and matching it against the supplied one,
      // which is a timing side channel with `===` (CWE-208) and an insecure
      // password hash with a digest -- both were flagged, and neither bought
      // anything, since every caller writes this row regardless.
      expect(usersRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ backupPasswordEnc: "enc:hunter2hunter2" }),
      );
      expect(aiEncryption.decrypt).not.toHaveBeenCalled();
    });

    it("stores nothing for an OIDC account", async () => {
      usersRepo.findOne.mockResolvedValue(
        makeUser({ authProvider: "oidc", passwordHash: null }),
      );

      await service.rememberLoginPassword(userId, "hunter2hunter2");

      expect(usersRepo.save).not.toHaveBeenCalled();
    });

    it("stores nothing when the server has no encryption key", async () => {
      aiEncryption.isConfigured.mockReturnValue(false);
      usersRepo.findOne.mockResolvedValue(makeUser());

      await service.rememberLoginPassword(userId, "hunter2hunter2");

      expect(usersRepo.save).not.toHaveBeenCalled();
    });

    it("swallows a storage failure rather than breaking sign-in", async () => {
      usersRepo.findOne.mockResolvedValue(makeUser());
      usersRepo.save.mockRejectedValue(new Error("db down"));

      await expect(
        service.rememberLoginPassword(userId, "hunter2hunter2"),
      ).resolves.toBeUndefined();
    });
  });

  describe("resolveBackupPassword", () => {
    it("returns 'none' when nothing is stored", async () => {
      expect(await service.resolveBackupPassword(makeUser())).toEqual({
        status: "none",
      });
    });

    it("returns the password when it still matches the login password", async () => {
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.resolveBackupPassword(
        makeUser({
          backupEncryptionEnabled: true,
          backupPasswordEnc: "enc:hunter2hunter2",
        }),
      );

      expect(result).toEqual({
        status: "password",
        password: "hunter2hunter2",
      });
    });

    it("drops a stale copy rather than encrypting with a password the user has changed", async () => {
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      usersRepo.findOne.mockResolvedValue(
        makeUser({
          backupEncryptionEnabled: true,
          backupPasswordEnc: "enc:old-password",
        }),
      );

      const result = await service.resolveBackupPassword(
        makeUser({
          backupEncryptionEnabled: true,
          backupPasswordEnc: "enc:old-password",
        }),
      );

      // A backup encrypted with a forgotten password is a file the user
      // cannot open; better an unencrypted one until the next sign-in.
      expect(result).toEqual({ status: "none" });
      expect(usersRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          backupEncryptionEnabled: false,
          backupPasswordEnc: null,
        }),
      );
    });

    it("reports 'unrecoverable' when the stored copy cannot be decrypted", async () => {
      aiEncryption.decrypt.mockImplementation(() => {
        throw new Error("bad key");
      });

      const result = await service.resolveBackupPassword(
        makeUser({
          backupEncryptionEnabled: true,
          backupPasswordEnc: "enc:unreadable",
        }),
      );

      // Distinct from "none": the caller must refuse rather than silently
      // writing plaintext where it used to write ciphertext.
      expect(result).toEqual({ status: "unrecoverable" });
    });

    it("skips the login-password check for an OIDC account", async () => {
      const result = await service.resolveBackupPassword(
        makeUser({
          authProvider: "oidc",
          passwordHash: null,
          backupEncryptionEnabled: true,
          backupPasswordEnc: "enc:dedicated",
        }),
      );

      expect(result).toEqual({ status: "password", password: "dedicated" });
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });
  });

  describe("setBackupPasswordForOidcUser", () => {
    function oidcUser(overrides: Partial<User> = {}) {
      return makeUser({
        authProvider: "oidc",
        passwordHash: null,
        ...overrides,
      });
    }

    it("stores the dedicated password and turns encryption on", async () => {
      usersRepo.findOne.mockResolvedValue(oidcUser());

      await service.setBackupPasswordForOidcUser(userId, "a-strong-password");

      expect(usersRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          backupPasswordEnc: "enc:a-strong-password",
          backupEncryptionEnabled: true,
        }),
      );
    });

    it("replaces an existing dedicated password", async () => {
      usersRepo.findOne.mockResolvedValue(
        oidcUser({
          backupEncryptionEnabled: true,
          backupPasswordEnc: "enc:old-backup-password",
        }),
      );

      await service.setBackupPasswordForOidcUser(userId, "new-backup-password");

      expect(usersRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          backupPasswordEnc: "enc:new-backup-password",
        }),
      );
    });

    it("refuses a local-auth account", async () => {
      usersRepo.findOne.mockResolvedValue(makeUser());

      // Their copy is recaptured at the next login, so accepting this would
      // store a password that is about to be overwritten.
      await expect(
        service.setBackupPasswordForOidcUser(userId, "a-strong-password"),
      ).rejects.toThrow(BadRequestException);
      expect(usersRepo.save).not.toHaveBeenCalled();
    });

    it("rejects a password shorter than the minimum", async () => {
      usersRepo.findOne.mockResolvedValue(oidcUser());

      await expect(
        service.setBackupPasswordForOidcUser(userId, "short"),
      ).rejects.toThrow(/at least 12/);
      expect(usersRepo.save).not.toHaveBeenCalled();
    });

    it("rejects a breached password", async () => {
      usersRepo.findOne.mockResolvedValue(oidcUser());
      passwordBreach.isBreached.mockResolvedValue(true);

      await expect(
        service.setBackupPasswordForOidcUser(userId, "correct horse battery"),
      ).rejects.toThrow(/data breach/);
      expect(usersRepo.save).not.toHaveBeenCalled();
    });

    it("refuses when the server has no encryption key", async () => {
      usersRepo.findOne.mockResolvedValue(oidcUser());
      aiEncryption.isConfigured.mockReturnValue(false);

      await expect(
        service.setBackupPasswordForOidcUser(userId, "a-strong-password"),
      ).rejects.toThrow(/AI_ENCRYPTION_KEY/);
      expect(usersRepo.save).not.toHaveBeenCalled();
    });
  });

  describe("disableForOidcUser", () => {
    it("clears the stored password", async () => {
      usersRepo.findOne.mockResolvedValue(
        makeUser({
          authProvider: "oidc",
          passwordHash: null,
          backupEncryptionEnabled: true,
          backupPasswordEnc: "enc:dedicated",
        }),
      );

      await service.disableForOidcUser(userId);

      expect(usersRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          backupEncryptionEnabled: false,
          backupPasswordEnc: null,
        }),
      );
    });

    it("refuses a local-auth account", async () => {
      usersRepo.findOne.mockResolvedValue(
        makeUser({
          backupEncryptionEnabled: true,
          backupPasswordEnc: "enc:hunter2hunter2",
        }),
      );

      // "Disabled" would be a lie: the next sign-in captures the password
      // again and turns it straight back on.
      await expect(service.disableForOidcUser(userId)).rejects.toThrow(
        BadRequestException,
      );
      expect(usersRepo.save).not.toHaveBeenCalled();
    });
  });

  describe("forgetStoredPassword", () => {
    it("clears the stored copy", async () => {
      usersRepo.findOne.mockResolvedValue(
        makeUser({
          backupEncryptionEnabled: true,
          backupPasswordEnc: "enc:whatever",
        }),
      );

      await service.forgetStoredPassword(userId);

      expect(usersRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          backupEncryptionEnabled: false,
          backupPasswordEnc: null,
        }),
      );
    });

    it("is a no-op for a user that no longer exists", async () => {
      usersRepo.findOne.mockResolvedValue(null);
      await expect(
        service.forgetStoredPassword(userId),
      ).resolves.toBeUndefined();
      expect(usersRepo.save).not.toHaveBeenCalled();
    });
  });
});
