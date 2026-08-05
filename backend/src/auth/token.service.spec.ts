import { Test, TestingModule } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { UnauthorizedException } from "@nestjs/common";
import { DataSource } from "typeorm";
import { TokenService } from "./token.service";
import { RefreshToken } from "./entities/refresh-token.entity";
import { createScopedDbMocks } from "../test-helpers/scoped-db-testing";

jest.mock("../common/db/scoped-db", () =>
  jest.requireActual("../test-helpers/scoped-db-testing").scopedDbMockModule(),
);

jest.mock("crypto", () => {
  const actual = jest.requireActual("crypto");
  return {
    ...actual,
    randomBytes: jest.fn().mockReturnValue({
      toString: () => "mock-random-token-hex",
    }),
    randomUUID: jest.fn().mockReturnValue("mock-family-uuid"),
  };
});

jest.mock("./crypto.util", () => ({
  hashToken: jest.fn().mockReturnValue("hashed-token"),
}));

describe("TokenService", () => {
  let service: TokenService;
  let refreshTokensRepository: Record<string, jest.Mock>;
  let jwtService: Record<string, jest.Mock>;
  let dataSource: Record<string, jest.Mock>;

  const mockUser = {
    id: "user-1",
    email: "test@example.com",
    authProvider: "local",
    role: "user",
    isActive: true,
  };

  const mockRefreshToken = {
    id: "token-1",
    userId: "user-1",
    tokenHash: "hashed-token",
    familyId: "family-1",
    isRevoked: false,
    rememberMe: false,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    replacedByHash: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    refreshTokensRepository = {
      create: jest.fn().mockReturnValue(mockRefreshToken),
      save: jest.fn().mockResolvedValue(mockRefreshToken),
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      // A revocation re-reads to confirm nothing is still live, so the double
      // has to answer that question -- see revokeUntilNoneLive.
      count: jest.fn().mockResolvedValue(0),
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
    };

    jwtService = {
      sign: jest.fn().mockReturnValue("mock-access-token"),
    };

    dataSource = createScopedDbMocks([
      [RefreshToken, refreshTokensRepository as never],
    ]).dataSource as unknown as Record<string, jest.Mock>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokenService,
        {
          provide: JwtService,
          useValue: jwtService,
        },
        {
          provide: DataSource,
          useValue: dataSource,
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue("30") },
        },
      ],
    }).compile();

    service = module.get<TokenService>(TokenService);
  });

  describe("getRefreshExpiryMs", () => {
    it("should return 1-day expiry when rememberMe is false", () => {
      const result = service.getRefreshExpiryMs(false);

      expect(result).toBe(1 * 24 * 60 * 60 * 1000);
    });

    it("should return 1-day expiry when rememberMe is undefined", () => {
      const result = service.getRefreshExpiryMs();

      expect(result).toBe(1 * 24 * 60 * 60 * 1000);
    });

    it("should return configured REMEMBER_ME_DAYS expiry when rememberMe is true", () => {
      const result = service.getRefreshExpiryMs(true);

      // ConfigService returns "30", so 30 days
      expect(result).toBe(30 * 24 * 60 * 60 * 1000);
    });
  });

  describe("generateTokenPair", () => {
    it("should create an access token and refresh token", async () => {
      const result = await service.generateTokenPair(mockUser as any);

      expect(jwtService.sign).toHaveBeenCalledWith(
        {
          sub: "user-1",
          email: "test@example.com",
          authProvider: "local",
          role: "user",
        },
        { expiresIn: "15m" },
      );
      expect(refreshTokensRepository.create).toHaveBeenCalledWith({
        userId: "user-1",
        tokenHash: "hashed-token",
        familyId: "mock-family-uuid",
        isRevoked: false,
        expiresAt: expect.any(Date),
        replacedByHash: null,
        rememberMe: false,
        actingAsUserId: null,
        delegationId: null,
      });
      expect(refreshTokensRepository.save).toHaveBeenCalledWith(
        mockRefreshToken,
      );
      expect(result).toEqual({
        accessToken: "mock-access-token",
        refreshToken: "mock-random-token-hex",
      });
    });

    it("should use shorter expiry without rememberMe", async () => {
      const now = Date.now();
      jest.spyOn(Date, "now").mockReturnValue(now);

      await service.generateTokenPair(mockUser as any);

      const createCall = refreshTokensRepository.create.mock.calls[0][0];
      const expectedExpiry = new Date(now + 1 * 24 * 60 * 60 * 1000);
      expect(createCall.expiresAt).toEqual(expectedExpiry);

      jest.restoreAllMocks();
    });

    it("should use longer expiry with rememberMe", async () => {
      const now = Date.now();
      jest.spyOn(Date, "now").mockReturnValue(now);

      await service.generateTokenPair(mockUser as any, true);

      const createCall = refreshTokensRepository.create.mock.calls[0][0];
      const expectedExpiry = new Date(now + 30 * 24 * 60 * 60 * 1000);
      expect(createCall.expiresAt).toEqual(expectedExpiry);

      jest.restoreAllMocks();
    });

    it("embeds delegate context in the payload and refresh row when acting", async () => {
      await service.generateTokenPair(mockUser as any, false, {
        actingAsUserId: "owner-9",
        delegationId: "deleg-9",
      });

      expect(jwtService.sign).toHaveBeenCalledWith(
        {
          sub: "user-1",
          email: "test@example.com",
          authProvider: "local",
          role: "user",
          actingAsUserId: "owner-9",
          delegationId: "deleg-9",
        },
        { expiresIn: "15m" },
      );
      const createCall = refreshTokensRepository.create.mock.calls[0][0];
      expect(createCall.actingAsUserId).toBe("owner-9");
      expect(createCall.delegationId).toBe("deleg-9");
    });
  });

  describe("refreshTokens", () => {
    let mockManager: Record<string, jest.Mock>;
    let familyRepo: Record<string, jest.Mock>;

    beforeEach(() => {
      // The in-transaction family revocations go through
      // `manager.getRepository(RefreshToken)` rather than `manager.update`, so
      // the double routes there and the spec asserts on it. Typed as the
      // repository surface the service actually uses, so a signature change
      // shows up here rather than as a passing test of a method that moved.
      familyRepo = {
        update: jest.fn().mockResolvedValue({ affected: 1 }),
        count: jest.fn().mockResolvedValue(0),
      };
      mockManager = {
        findOne: jest.fn(),
        update: jest.fn().mockResolvedValue({ affected: 1 }),
        save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
        create: jest.fn().mockImplementation((_Entity, data) => data),
        getRepository: jest.fn(() => familyRepo),
      };

      dataSource.transaction.mockImplementation(async (callback) => {
        return callback(mockManager);
      });
    });

    it("should rotate token and return new token pair on success", async () => {
      const existingToken = {
        ...mockRefreshToken,
        isRevoked: false,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      };

      mockManager.findOne
        .mockResolvedValueOnce(existingToken)
        .mockResolvedValueOnce(mockUser);

      const result = await service.refreshTokens("raw-refresh-token");

      expect(mockManager.findOne).toHaveBeenCalledWith(RefreshToken, {
        where: { tokenHash: "hashed-token" },
        lock: { mode: "pessimistic_write" },
      });

      expect(existingToken.isRevoked).toBe(true);
      expect(existingToken.replacedByHash).toBe("hashed-token");
      expect(mockManager.save).toHaveBeenCalledWith(existingToken);

      expect(mockManager.create).toHaveBeenCalledWith(RefreshToken, {
        userId: "user-1",
        tokenHash: "hashed-token",
        familyId: "family-1",
        isRevoked: false,
        expiresAt: expect.any(Date),
        replacedByHash: null,
        rememberMe: false,
        actingAsUserId: null,
        delegationId: null,
      });

      expect(jwtService.sign).toHaveBeenCalledWith(
        {
          sub: "user-1",
          email: "test@example.com",
          authProvider: "local",
          role: "user",
        },
        { expiresIn: "15m" },
      );

      expect(result).toEqual({
        accessToken: "mock-access-token",
        refreshToken: "mock-random-token-hex",
        userId: "user-1",
      });
    });

    it("carries the delegate context forward through rotation", async () => {
      const existingToken = {
        ...mockRefreshToken,
        isRevoked: false,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        actingAsUserId: "owner-9",
        delegationId: "deleg-9",
      };
      mockManager.findOne
        .mockResolvedValueOnce(existingToken)
        .mockResolvedValueOnce(mockUser);

      await service.refreshTokens("raw-refresh-token");

      const createCall = mockManager.create.mock.calls[0][1];
      expect(createCall.actingAsUserId).toBe("owner-9");
      expect(createCall.delegationId).toBe("deleg-9");
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          actingAsUserId: "owner-9",
          delegationId: "deleg-9",
        }),
        { expiresIn: "15m" },
      );
    });

    it("should throw UnauthorizedException when token is not found", async () => {
      mockManager.findOne.mockResolvedValueOnce(null);

      await expect(service.refreshTokens("unknown-token")).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.refreshTokens("unknown-token")).rejects.toThrow(
        "Invalid refresh token",
      );
    });

    it("should revoke entire family and throw when token is already revoked (replay detection)", async () => {
      const revokedToken = {
        ...mockRefreshToken,
        isRevoked: true,
        familyId: "family-1",
      };

      mockManager.findOne.mockResolvedValueOnce(revokedToken);

      await expect(service.refreshTokens("reused-token")).rejects.toThrow(
        UnauthorizedException,
      );

      expect(familyRepo.update).toHaveBeenCalledWith(
        { familyId: "family-1", isRevoked: false },
        { isRevoked: true },
      );
      // And it confirmed the family is actually dead rather than assuming one
      // statement was enough.
      expect(familyRepo.count).toHaveBeenCalledWith({
        where: { familyId: "family-1", isRevoked: false },
      });
    });

    it("should throw with correct message on replay detection", async () => {
      const revokedToken = {
        ...mockRefreshToken,
        isRevoked: true,
      };

      mockManager.findOne.mockResolvedValueOnce(revokedToken);

      await expect(service.refreshTokens("reused-token")).rejects.toThrow(
        "Refresh token reuse detected",
      );
    });

    it("should revoke token and throw when token is expired", async () => {
      const expiredToken = {
        ...mockRefreshToken,
        isRevoked: false,
        expiresAt: new Date(Date.now() - 1000),
      };

      mockManager.findOne.mockResolvedValueOnce(expiredToken);

      await expect(service.refreshTokens("expired-token")).rejects.toThrow(
        UnauthorizedException,
      );

      expect(expiredToken.isRevoked).toBe(true);
      expect(mockManager.save).toHaveBeenCalledWith(expiredToken);
    });

    it("should throw with correct message on expired token", async () => {
      const expiredToken = {
        ...mockRefreshToken,
        isRevoked: false,
        expiresAt: new Date(Date.now() - 1000),
      };

      mockManager.findOne.mockResolvedValueOnce(expiredToken);

      await expect(service.refreshTokens("expired-token")).rejects.toThrow(
        "Refresh token expired",
      );
    });

    it("should revoke family and throw when user is not found", async () => {
      const validToken = {
        ...mockRefreshToken,
        isRevoked: false,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        familyId: "family-1",
      };

      mockManager.findOne
        .mockResolvedValueOnce(validToken)
        .mockResolvedValueOnce(null);

      await expect(service.refreshTokens("valid-token")).rejects.toThrow(
        UnauthorizedException,
      );

      expect(familyRepo.update).toHaveBeenCalledWith(
        { familyId: "family-1", isRevoked: false },
        { isRevoked: true },
      );
      // And it confirmed the family is actually dead rather than assuming one
      // statement was enough.
      expect(familyRepo.count).toHaveBeenCalledWith({
        where: { familyId: "family-1", isRevoked: false },
      });
    });

    it("should revoke family and throw when user is inactive", async () => {
      const validToken = {
        ...mockRefreshToken,
        isRevoked: false,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        familyId: "family-1",
      };

      const inactiveUser = { ...mockUser, isActive: false };

      mockManager.findOne
        .mockResolvedValueOnce(validToken)
        .mockResolvedValueOnce(inactiveUser);

      await expect(service.refreshTokens("valid-token")).rejects.toThrow(
        "User not found or inactive",
      );

      expect(familyRepo.update).toHaveBeenCalledWith(
        { familyId: "family-1", isRevoked: false },
        { isRevoked: true },
      );
      // And it confirmed the family is actually dead rather than assuming one
      // statement was enough.
      expect(familyRepo.count).toHaveBeenCalledWith({
        where: { familyId: "family-1", isRevoked: false },
      });
    });
  });

  describe("revokeTokenFamily", () => {
    it("should update all tokens in family to revoked", async () => {
      await service.revokeTokenFamily("family-1");

      expect(refreshTokensRepository.update).toHaveBeenCalledWith(
        { familyId: "family-1", isRevoked: false },
        { isRevoked: true },
      );
    });

    it("looks again, and revokes again, when a token is still live", async () => {
      // The shape of the real race: a rotation committed its replacement after
      // the first statement's snapshot, so the first pass could not see it and
      // the second must. A single-pass revocation returns here having left a
      // usable session behind a confirmed logout --
      // `test/integration/race-refresh-token-revocation.integration.spec.ts`
      // drives that against a real database; this asserts the loop exists.
      refreshTokensRepository.count
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0);

      await service.revokeTokenFamily("family-1");

      expect(refreshTokensRepository.update).toHaveBeenCalledTimes(2);
      expect(refreshTokensRepository.count).toHaveBeenCalledTimes(2);
    });

    it("fails loudly rather than reporting a partial revocation", async () => {
      // A revocation that cannot converge must not return: the caller is a
      // logout, and "mostly logged out" is the failure this method exists to
      // prevent.
      refreshTokensRepository.count.mockResolvedValue(1);

      await expect(service.revokeTokenFamily("family-1")).rejects.toThrow(
        /did not converge/,
      );
    });
  });

  describe("revokeRefreshToken", () => {
    it("should find token by hash and revoke its family", async () => {
      refreshTokensRepository.findOne.mockResolvedValueOnce({
        ...mockRefreshToken,
        familyId: "family-1",
      });

      await service.revokeRefreshToken("raw-token");

      expect(refreshTokensRepository.findOne).toHaveBeenCalledWith({
        where: { tokenHash: "hashed-token" },
      });
      expect(refreshTokensRepository.update).toHaveBeenCalledWith(
        { familyId: "family-1", isRevoked: false },
        { isRevoked: true },
      );
    });

    it("should return early when given an empty string", async () => {
      await service.revokeRefreshToken("");

      expect(refreshTokensRepository.findOne).not.toHaveBeenCalled();
      expect(refreshTokensRepository.update).not.toHaveBeenCalled();
    });

    it("should return early when given a falsy value", async () => {
      await service.revokeRefreshToken(undefined as any);

      expect(refreshTokensRepository.findOne).not.toHaveBeenCalled();
      expect(refreshTokensRepository.update).not.toHaveBeenCalled();
    });

    it("should be a no-op when token is not found in DB", async () => {
      refreshTokensRepository.findOne.mockResolvedValueOnce(null);

      await service.revokeRefreshToken("unknown-token");

      expect(refreshTokensRepository.findOne).toHaveBeenCalled();
      expect(refreshTokensRepository.update).not.toHaveBeenCalled();
    });
  });

  describe("revokeAllUserRefreshTokens", () => {
    it("should batch revoke all non-revoked tokens for user", async () => {
      await service.revokeAllUserRefreshTokens("user-1");

      expect(refreshTokensRepository.update).toHaveBeenCalledWith(
        { userId: "user-1", isRevoked: false },
        { isRevoked: true },
      );
    });
  });

  describe("purgeExpiredRefreshTokens", () => {
    it("should delete expired and revoked tokens", async () => {
      refreshTokensRepository.delete
        .mockResolvedValueOnce({ affected: 3 })
        .mockResolvedValueOnce({ affected: 5 });

      await service.purgeExpiredRefreshTokens();

      expect(refreshTokensRepository.delete).toHaveBeenCalledTimes(2);
      expect(refreshTokensRepository.delete).toHaveBeenCalledWith({
        expiresAt: expect.anything(),
      });
      expect(refreshTokensRepository.delete).toHaveBeenCalledWith({
        isRevoked: true,
      });
    });

    it("should log when totalPurged > 0", async () => {
      refreshTokensRepository.delete
        .mockResolvedValueOnce({ affected: 2 })
        .mockResolvedValueOnce({ affected: 3 });

      const logSpy = jest.spyOn(service["logger"], "log");

      await service.purgeExpiredRefreshTokens();

      expect(logSpy).toHaveBeenCalledWith(
        "Purged 5 expired/revoked refresh tokens",
      );
    });

    it("should not log when totalPurged is 0", async () => {
      refreshTokensRepository.delete
        .mockResolvedValueOnce({ affected: 0 })
        .mockResolvedValueOnce({ affected: 0 });

      const logSpy = jest.spyOn(service["logger"], "log");

      await service.purgeExpiredRefreshTokens();

      expect(logSpy).not.toHaveBeenCalled();
    });

    it("should handle undefined affected counts", async () => {
      refreshTokensRepository.delete
        .mockResolvedValueOnce({ affected: undefined })
        .mockResolvedValueOnce({ affected: undefined });

      const logSpy = jest.spyOn(service["logger"], "log");

      await service.purgeExpiredRefreshTokens();

      expect(logSpy).not.toHaveBeenCalled();
    });
  });
});

describe("TokenService with zero REMEMBER_ME_DAYS", () => {
  it("defaults to 30 days when REMEMBER_ME_DAYS is 0", async () => {
    const module = await Test.createTestingModule({
      providers: [
        TokenService,
        { provide: JwtService, useValue: { sign: jest.fn() } },
        { provide: DataSource, useValue: { createQueryRunner: jest.fn() } },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue("0") },
        },
      ],
    }).compile();

    const svc = module.get<TokenService>(TokenService);
    // With REMEMBER_ME_DAYS=0, it falls back to 30 days
    expect(svc.getRefreshExpiryMs(true)).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
