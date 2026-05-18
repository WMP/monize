import { ForbiddenException } from "@nestjs/common";
import { AccountDelegateGuard } from "./account-delegate.guard";
import {
  ALLOW_DELEGATE_KEY,
  DELEGATED_ACCOUNT_PARAM_KEY,
} from "../decorators/delegate-access.decorator";

describe("AccountDelegateGuard", () => {
  let guard: AccountDelegateGuard;
  let reflector: Record<string, jest.Mock>;
  let jwtService: Record<string, jest.Mock>;
  let delegationService: Record<string, jest.Mock>;

  const makeContext = (req: any) =>
    ({
      getType: () => "http",
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => ({}),
      getClass: () => ({}),
    }) as any;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    jwtService = { verify: jest.fn() };
    delegationService = { hasReadAccess: jest.fn() };
    guard = new AccountDelegateGuard(
      reflector as any,
      jwtService as any,
      delegationService as any,
    );
  });

  it("allows requests with no token (normal AuthGuard handles auth)", async () => {
    const ctx = makeContext({ headers: {} });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(jwtService.verify).not.toHaveBeenCalled();
  });

  it("allows when the token is invalid (AuthGuard will reject)", async () => {
    jwtService.verify.mockImplementation(() => {
      throw new Error("bad token");
    });
    const ctx = makeContext({
      headers: { authorization: "Bearer x" },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it("allows a normal (non-delegate) token unchanged", async () => {
    jwtService.verify.mockReturnValue({ sub: "u1" });
    const ctx = makeContext({ headers: { authorization: "Bearer x" } });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(reflector.getAllAndOverride).not.toHaveBeenCalled();
  });

  it("blocks a delegate on a route not annotated @AllowDelegate (fail closed)", async () => {
    jwtService.verify.mockReturnValue({
      sub: "d1",
      actingAsUserId: "o1",
      delegationId: "g1",
    });
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const ctx = makeContext({ headers: { authorization: "Bearer x" } });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("allows a delegate on an @AllowDelegate route with no account param", async () => {
    jwtService.verify.mockReturnValue({
      sub: "d1",
      actingAsUserId: "o1",
      delegationId: "g1",
    });
    reflector.getAllAndOverride.mockImplementation((key: string) =>
      key === ALLOW_DELEGATE_KEY ? true : undefined,
    );
    const ctx = makeContext({ headers: { authorization: "Bearer x" } });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it("blocks a delegate without READ access to the account", async () => {
    jwtService.verify.mockReturnValue({
      sub: "d1",
      actingAsUserId: "o1",
      delegationId: "g1",
    });
    reflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === ALLOW_DELEGATE_KEY) return true;
      if (key === DELEGATED_ACCOUNT_PARAM_KEY) return "id";
      return undefined;
    });
    delegationService.hasReadAccess.mockResolvedValue(false);
    const ctx = makeContext({
      headers: { authorization: "Bearer x" },
      params: { id: "acc-1" },
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(delegationService.hasReadAccess).toHaveBeenCalledWith("g1", "acc-1");
  });

  it("allows a delegate with READ access to the account", async () => {
    jwtService.verify.mockReturnValue({
      sub: "d1",
      actingAsUserId: "o1",
      delegationId: "g1",
    });
    reflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === ALLOW_DELEGATE_KEY) return true;
      if (key === DELEGATED_ACCOUNT_PARAM_KEY) return "id";
      return undefined;
    });
    delegationService.hasReadAccess.mockResolvedValue(true);
    const ctx = makeContext({
      headers: {},
      cookies: { auth_token: "ck" },
      params: { id: "acc-1" },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it("ignores 2fa_pending tokens", async () => {
    jwtService.verify.mockReturnValue({ sub: "u1", type: "2fa_pending" });
    const ctx = makeContext({ headers: { authorization: "Bearer x" } });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});
