import { Test, TestingModule } from "@nestjs/testing";
import { UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtStrategy } from "./jwt.strategy";
import { AuthService } from "../auth.service";
import { DelegationService } from "../../delegation/delegation.service";

describe("JwtStrategy", () => {
  let strategy: JwtStrategy;
  let authService: Record<string, jest.Mock>;
  let configService: Record<string, jest.Mock>;
  let delegationService: Record<string, jest.Mock>;

  const mockUser = {
    id: "user-1",
    isActive: true,
    mustChangePassword: false,
    role: "user",
  };

  beforeEach(async () => {
    authService = {
      getUserStateById: jest.fn(),
    };

    delegationService = {
      validateActingContext: jest.fn(),
    };

    configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === "JWT_SECRET")
          return "test-secret-at-least-32-characters-long";
        return undefined;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        { provide: AuthService, useValue: authService },
        { provide: ConfigService, useValue: configService },
        { provide: DelegationService, useValue: delegationService },
      ],
    }).compile();

    strategy = module.get<JwtStrategy>(JwtStrategy);
  });

  it("should be defined", () => {
    expect(strategy).toBeDefined();
  });

  describe("constructor", () => {
    it("throws an error if JWT_SECRET is not configured", () => {
      const noSecretConfig = {
        get: jest.fn().mockReturnValue(undefined),
      };

      expect(() => {
        new JwtStrategy(
          noSecretConfig as any,
          authService as any,
          delegationService as any,
        );
      }).toThrow(
        "JWT_SECRET environment variable must be at least 32 characters",
      );
    });

    it("throws an error if JWT_SECRET is too short", () => {
      const shortSecretConfig = {
        get: jest.fn().mockReturnValue("short-secret"),
      };

      expect(() => {
        new JwtStrategy(
          shortSecretConfig as any,
          authService as any,
          delegationService as any,
        );
      }).toThrow(
        "JWT_SECRET environment variable must be at least 32 characters",
      );
    });
  });

  describe("validate", () => {
    it("rejects 2fa_pending tokens", async () => {
      const payload = { sub: "user-1", type: "2fa_pending" };

      await expect(strategy.validate(payload)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(strategy.validate(payload)).rejects.toThrow(
        "2FA verification required",
      );
    });

    it("rejects inactive users", async () => {
      const payload = { sub: "user-1" };
      authService.getUserStateById.mockResolvedValue({
        ...mockUser,
        isActive: false,
      });

      await expect(strategy.validate(payload)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(strategy.validate(payload)).rejects.toThrow(
        "User not found or inactive",
      );
    });

    it("rejects when user is not found", async () => {
      const payload = { sub: "nonexistent" };
      authService.getUserStateById.mockResolvedValue(null);

      await expect(strategy.validate(payload)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it("returns enriched self user for a non-delegate payload", async () => {
      const payload = { sub: "user-1" };
      authService.getUserStateById.mockResolvedValue(mockUser);

      const result = await strategy.validate(payload);

      expect(authService.getUserStateById).toHaveBeenCalledWith("user-1");
      expect(result).toEqual({
        ...mockUser,
        realUserId: "user-1",
        isActing: false,
        delegationId: null,
      });
      expect(delegationService.validateActingContext).not.toHaveBeenCalled();
    });

    it("maps the effective id to the owner when acting as a delegate", async () => {
      const payload = {
        sub: "delegate-1",
        actingAsUserId: "owner-1",
        delegationId: "deleg-1",
      };
      authService.getUserStateById.mockResolvedValue({
        id: "delegate-1",
        isActive: true,
        mustChangePassword: false,
        role: "user",
      });
      delegationService.validateActingContext.mockResolvedValue({});

      const result = await strategy.validate(payload);

      expect(delegationService.validateActingContext).toHaveBeenCalledWith({
        delegateUserId: "delegate-1",
        actingAsUserId: "owner-1",
        delegationId: "deleg-1",
      });
      expect(result).toEqual({
        id: "owner-1",
        realUserId: "delegate-1",
        isActing: true,
        delegationId: "deleg-1",
        isActive: true,
        mustChangePassword: false,
        role: "user",
      });
    });

    it("fails closed when the delegation is no longer valid", async () => {
      const payload = {
        sub: "delegate-1",
        actingAsUserId: "owner-1",
        delegationId: "deleg-1",
      };
      authService.getUserStateById.mockResolvedValue(mockUser);
      delegationService.validateActingContext.mockRejectedValue(
        new UnauthorizedException("Delegated access is no longer valid"),
      );

      await expect(strategy.validate(payload)).rejects.toThrow(
        "Delegated access is no longer valid",
      );
    });

    it("rejects the inactive real user before resolving delegation", async () => {
      const payload = {
        sub: "delegate-1",
        actingAsUserId: "owner-1",
        delegationId: "deleg-1",
      };
      authService.getUserStateById.mockResolvedValue({
        ...mockUser,
        isActive: false,
      });

      await expect(strategy.validate(payload)).rejects.toThrow(
        "User not found or inactive",
      );
      expect(delegationService.validateActingContext).not.toHaveBeenCalled();
    });
  });

  describe("JWT extraction (jwtFromRequest)", () => {
    function getExtractor(): (req: any) => string | null {
      const fn = (strategy as any)._jwtFromRequest;
      expect(typeof fn).toBe("function");
      return fn;
    }

    it("extracts a Bearer token from the Authorization header", () => {
      const extractor = getExtractor();
      const token = extractor({
        headers: { authorization: "Bearer header-token" },
      });
      expect(token).toBe("header-token");
    });

    it("falls back to the auth_token cookie when no Authorization header is present", () => {
      const extractor = getExtractor();
      const token = extractor({
        headers: {},
        cookies: { auth_token: "cookie-token" },
      });
      expect(token).toBe("cookie-token");
    });

    it("returns null when neither header nor cookie is present", () => {
      const extractor = getExtractor();
      const token = extractor({ headers: {} });
      expect(token).toBeNull();
    });

    it("returns null when cookies object exists but has no auth_token", () => {
      const extractor = getExtractor();
      const token = extractor({ headers: {}, cookies: {} });
      expect(token).toBeNull();
    });

    it("prefers the Authorization header over the cookie", () => {
      const extractor = getExtractor();
      const token = extractor({
        headers: { authorization: "Bearer header-wins" },
        cookies: { auth_token: "ignored-cookie" },
      });
      expect(token).toBe("header-wins");
    });
  });
});
