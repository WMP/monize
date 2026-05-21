import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService, TokenExpiredError } from "@nestjs/jwt";
import { StepUpGuard } from "./step-up.guard";
import { REQUIRE_STEP_UP_KEY } from "./require-step-up.decorator";

function buildContext(
  headers: Record<string, string | undefined>,
  user: { id?: string } | undefined,
): ExecutionContext {
  const handler = function handler() {};
  class Cls {}
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers, user }),
    }),
    getHandler: () => handler,
    getClass: () => Cls,
  } as unknown as ExecutionContext;
}

describe("StepUpGuard", () => {
  let reflector: Reflector;
  let jwt: Record<string, jest.Mock>;
  let guard: StepUpGuard;

  beforeEach(() => {
    reflector = new Reflector();
    jwt = { verify: jest.fn() };
    guard = new StepUpGuard(reflector, jwt as unknown as JwtService);
  });

  it("returns true when no @RequireStepUp metadata is present", () => {
    const ctx = buildContext({}, { id: "u1" });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  describe("with @RequireStepUp('emergency-access')", () => {
    beforeEach(() => {
      jest
        .spyOn(reflector, "getAllAndOverride")
        .mockImplementation((key) =>
          key === REQUIRE_STEP_UP_KEY ? "emergency-access" : undefined,
        );
    });

    it("rejects when user is missing on request", () => {
      const ctx = buildContext({}, undefined);
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it("rejects when the header is missing", () => {
      const ctx = buildContext({}, { id: "u1" });
      try {
        guard.canActivate(ctx);
        fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenException);
        expect((err as ForbiddenException).getResponse()).toMatchObject({
          code: "STEP_UP_REQUIRED",
        });
      }
    });

    it("rejects when the token is expired", () => {
      jwt.verify.mockImplementation(() => {
        throw new TokenExpiredError("jwt expired", new Date());
      });
      const ctx = buildContext({ "x-step-up-token": "expired" }, { id: "u1" });
      try {
        guard.canActivate(ctx);
        fail("should have thrown");
      } catch (err) {
        expect((err as ForbiddenException).getResponse()).toMatchObject({
          code: "STEP_UP_EXPIRED",
        });
      }
    });

    it("rejects when the token has a different type claim", () => {
      jwt.verify.mockReturnValue({
        sub: "u1",
        type: "refresh",
        purpose: "emergency-access",
      });
      const ctx = buildContext(
        { "x-step-up-token": "wrong-type" },
        { id: "u1" },
      );
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it("rejects when the token is scoped to a different purpose", () => {
      jwt.verify.mockReturnValue({
        sub: "u1",
        type: "step_up",
        purpose: "other-action",
      });
      const ctx = buildContext(
        { "x-step-up-token": "wrong-purpose" },
        { id: "u1" },
      );
      try {
        guard.canActivate(ctx);
        fail("should have thrown");
      } catch (err) {
        expect((err as ForbiddenException).getResponse()).toMatchObject({
          code: "STEP_UP_INVALID",
        });
      }
    });

    it("rejects when the token sub does not match the request user", () => {
      jwt.verify.mockReturnValue({
        sub: "attacker",
        type: "step_up",
        purpose: "emergency-access",
      });
      const ctx = buildContext(
        { "x-step-up-token": "swapped" },
        { id: "victim" },
      );
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it("accepts a valid token", () => {
      jwt.verify.mockReturnValue({
        sub: "u1",
        type: "step_up",
        purpose: "emergency-access",
      });
      const ctx = buildContext({ "x-step-up-token": "valid" }, { id: "u1" });
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });
});
