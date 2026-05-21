import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import * as bcrypt from "bcryptjs";

import { StepUpAuthService } from "./step-up.service";
import { TwoFactorService } from "../two-factor.service";
import { User } from "../../users/entities/user.entity";
import { UserPreference } from "../../users/entities/user-preference.entity";

describe("StepUpAuthService", () => {
  let service: StepUpAuthService;
  let usersRepo: Record<string, jest.Mock>;
  let preferencesRepo: Record<string, jest.Mock>;
  let twoFactor: Record<string, jest.Mock>;
  let jwt: Record<string, jest.Mock>;

  const userId = "11111111-1111-1111-1111-111111111111";

  beforeEach(async () => {
    usersRepo = { findOne: jest.fn() };
    preferencesRepo = { findOne: jest.fn() };
    twoFactor = { verifyTotpForUser: jest.fn() };
    jwt = { sign: jest.fn().mockReturnValue("signed.jwt.token") };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StepUpAuthService,
        { provide: getRepositoryToken(User), useValue: usersRepo },
        {
          provide: getRepositoryToken(UserPreference),
          useValue: preferencesRepo,
        },
        { provide: TwoFactorService, useValue: twoFactor },
        { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    service = module.get(StepUpAuthService);
  });

  it("throws NotFoundException when the user is missing", async () => {
    usersRepo.findOne.mockResolvedValue(null);
    await expect(
      service.verifyAndIssue(userId, "emergency-access", {
        password: "x",
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  describe("2FA-enabled users", () => {
    beforeEach(() => {
      usersRepo.findOne.mockResolvedValue({
        id: userId,
        authProvider: "local",
        passwordHash: "irrelevant",
        twoFactorSecret: "enc-secret",
      });
      preferencesRepo.findOne.mockResolvedValue({ twoFactorEnabled: true });
    });

    it("requires totpCode and rejects password-only attempts", async () => {
      await expect(
        service.verifyAndIssue(userId, "emergency-access", {
          password: "hunter2",
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(twoFactor.verifyTotpForUser).not.toHaveBeenCalled();
    });

    it("issues a token when the TOTP code is valid", async () => {
      twoFactor.verifyTotpForUser.mockResolvedValue(true);
      const result = await service.verifyAndIssue(userId, "emergency-access", {
        totpCode: "123456",
      });

      expect(twoFactor.verifyTotpForUser).toHaveBeenCalledWith(
        userId,
        "123456",
      );
      expect(jwt.sign).toHaveBeenCalled();
      const payload = jwt.sign.mock.calls[0][0];
      expect(payload).toMatchObject({
        sub: userId,
        type: "step_up",
        purpose: "emergency-access",
      });
      expect(typeof payload.jti).toBe("string");
      expect(result.stepUpToken).toBe("signed.jwt.token");
      expect(result.expiresInSeconds).toBe(300);
      expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it("rejects invalid TOTP codes", async () => {
      twoFactor.verifyTotpForUser.mockResolvedValue(false);
      await expect(
        service.verifyAndIssue(userId, "emergency-access", {
          totpCode: "999999",
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe("local users without 2FA", () => {
    beforeEach(async () => {
      const hash = await bcrypt.hash("hunter2", 4);
      usersRepo.findOne.mockResolvedValue({
        id: userId,
        authProvider: "local",
        passwordHash: hash,
        twoFactorSecret: null,
      });
      preferencesRepo.findOne.mockResolvedValue({ twoFactorEnabled: false });
    });

    it("requires password and rejects totp-only attempts", async () => {
      await expect(
        service.verifyAndIssue(userId, "emergency-access", {
          totpCode: "123456",
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("issues a token when the password is correct", async () => {
      const result = await service.verifyAndIssue(userId, "emergency-access", {
        password: "hunter2",
      });
      expect(result.stepUpToken).toBe("signed.jwt.token");
    });

    it("rejects wrong passwords", async () => {
      await expect(
        service.verifyAndIssue(userId, "emergency-access", {
          password: "wrong",
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe("OIDC users without 2FA", () => {
    beforeEach(() => {
      usersRepo.findOne.mockResolvedValue({
        id: userId,
        authProvider: "oidc",
        passwordHash: null,
        twoFactorSecret: null,
      });
      preferencesRepo.findOne.mockResolvedValue({ twoFactorEnabled: false });
    });

    it("rejects with STEP_UP_FACTOR_UNAVAILABLE", async () => {
      await expect(
        service.verifyAndIssue(userId, "emergency-access", { password: "x" }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("rate limiting", () => {
    beforeEach(async () => {
      const hash = await bcrypt.hash("hunter2", 4);
      usersRepo.findOne.mockResolvedValue({
        id: userId,
        authProvider: "local",
        passwordHash: hash,
        twoFactorSecret: null,
      });
      preferencesRepo.findOne.mockResolvedValue({ twoFactorEnabled: false });
    });

    it("locks out after 10 failed attempts", async () => {
      for (let i = 0; i < 10; i++) {
        await expect(
          service.verifyAndIssue(userId, "emergency-access", {
            password: "wrong",
          }),
        ).rejects.toBeInstanceOf(UnauthorizedException);
      }
      // 11th attempt -- even with the correct password -- should be locked out.
      await expect(
        service.verifyAndIssue(userId, "emergency-access", {
          password: "hunter2",
        }),
      ).rejects.toThrow(/too many/i);
    });

    it("clears the attempt counter after a successful verification", async () => {
      // First a few failures
      for (let i = 0; i < 3; i++) {
        await service
          .verifyAndIssue(userId, "emergency-access", { password: "wrong" })
          .catch(() => undefined);
      }
      // Then a success
      await expect(
        service.verifyAndIssue(userId, "emergency-access", {
          password: "hunter2",
        }),
      ).resolves.toBeDefined();

      // Counter is reset -- another 10 failures should be needed to lock out.
      for (let i = 0; i < 9; i++) {
        await service
          .verifyAndIssue(userId, "emergency-access", { password: "wrong" })
          .catch(() => undefined);
      }
      await expect(
        service.verifyAndIssue(userId, "emergency-access", {
          password: "hunter2",
        }),
      ).resolves.toBeDefined();
    });
  });
});
