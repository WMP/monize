import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import type { Request, Response } from "express";
import { OidcReauthService, OIDC_REAUTH_COOKIE } from "./oidc-reauth.service";

describe("OidcReauthService", () => {
  const secret = "test-secret-at-least-32-characters-long";
  let service: OidcReauthService;
  let jwt: JwtService;

  const configFor = (nodeEnv: string) =>
    ({
      get: (key: string) => (key === "NODE_ENV" ? nodeEnv : undefined),
    }) as unknown as ConfigService;

  const reqWith = (cookies: Record<string, string>) =>
    ({ cookies }) as unknown as Request;

  beforeEach(() => {
    jwt = new JwtService({
      secret,
      signOptions: { algorithm: "HS256" },
      verifyOptions: { algorithms: ["HS256"] },
    });
    service = new OidcReauthService(jwt, configFor("test"));
  });

  describe("issue", () => {
    it("sets an HttpOnly cookie the client cannot read or replay", () => {
      const res = { cookie: jest.fn() } as unknown as Response;
      service.issue(res, "user-1");

      expect(res.cookie).toHaveBeenCalledWith(
        OIDC_REAUTH_COOKIE,
        expect.any(String),
        expect.objectContaining({ httpOnly: true, sameSite: "lax" }),
      );
    });

    it("marks the cookie secure in production only", () => {
      const prodRes = { cookie: jest.fn() } as unknown as Response;
      new OidcReauthService(jwt, configFor("production")).issue(
        prodRes,
        "user-1",
      );
      expect(prodRes.cookie).toHaveBeenCalledWith(
        OIDC_REAUTH_COOKIE,
        expect.any(String),
        expect.objectContaining({ secure: true }),
      );
    });
  });

  describe("verify", () => {
    /** The token the callback would have set, for `userId`. */
    const proofFor = (userId: string) => {
      const res = { cookie: jest.fn() } as unknown as Response;
      service.issue(res, userId);
      return (res.cookie as jest.Mock).mock.calls[0][1] as string;
    };

    it("accepts a proof it issued for the same user", () => {
      const token = proofFor("user-1");
      expect(
        service.verify(reqWith({ [OIDC_REAUTH_COOKIE]: token }), "user-1"),
      ).toBe(true);
    });

    // The whole point: without a proof, nothing is proven. The old contract
    // accepted any non-empty client string here.
    it("rejects a request with no proof", () => {
      expect(service.verify(reqWith({}), "user-1")).toBe(false);
    });

    it("rejects a proof issued for another user", () => {
      const token = proofFor("user-2");
      expect(
        service.verify(reqWith({ [OIDC_REAUTH_COOKIE]: token }), "user-1"),
      ).toBe(false);
    });

    it("rejects a token signed with another secret", () => {
      const foreign = new JwtService({
        secret: "some-other-secret-also-32-characters-x",
        signOptions: { algorithm: "HS256" },
      }).sign({ sub: "user-1", type: "oidc_reauth" });
      expect(
        service.verify(reqWith({ [OIDC_REAUTH_COOKIE]: foreign }), "user-1"),
      ).toBe(false);
    });

    it("rejects a token of some other type", () => {
      // A session or step-up token must not double as an IdP-roundtrip proof.
      const wrongType = jwt.sign({ sub: "user-1", type: "step_up" });
      expect(
        service.verify(reqWith({ [OIDC_REAUTH_COOKIE]: wrongType }), "user-1"),
      ).toBe(false);
    });

    it("rejects an expired proof", () => {
      const expired = jwt.sign(
        { sub: "user-1", type: "oidc_reauth" },
        { expiresIn: -1 },
      );
      expect(
        service.verify(reqWith({ [OIDC_REAUTH_COOKIE]: expired }), "user-1"),
      ).toBe(false);
    });

    it("rejects a value that is not a token at all", () => {
      expect(
        service.verify(
          reqWith({ [OIDC_REAUTH_COOKIE]: "oidc-session-confirmed" }),
          "user-1",
        ),
      ).toBe(false);
    });

    it("survives a request with no cookies", () => {
      expect(service.verify({} as unknown as Request, "user-1")).toBe(false);
    });
  });

  it("consume clears the cookie so one roundtrip authorises one action", () => {
    const res = { clearCookie: jest.fn() } as unknown as Response;
    service.consume(res);
    expect(res.clearCookie).toHaveBeenCalledWith(
      OIDC_REAUTH_COOKIE,
      expect.objectContaining({ httpOnly: true, path: "/" }),
    );
  });
});
