import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import type { Request, Response } from "express";
import {
  OidcReauthService,
  OIDC_REAUTH_COOKIE,
  type OidcReauthPurpose,
} from "./oidc-reauth.service";

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
      service.issue(res, "user-1", "backup-restore");

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
        "backup-restore",
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
    const proofFor = (
      userId: string,
      purpose: OidcReauthPurpose = "backup-restore",
    ) => {
      const res = { cookie: jest.fn() } as unknown as Response;
      service.issue(res, userId, purpose);
      return (res.cookie as jest.Mock).mock.calls[0][1] as string;
    };

    it("accepts a proof it issued for the same user", () => {
      const token = proofFor("user-1");
      expect(
        service.verify(
          reqWith({ [OIDC_REAUTH_COOKIE]: token }),
          "user-1",
          "backup-restore",
        ),
      ).toBe(true);
    });

    // The whole point: without a proof, nothing is proven. The old contract
    // accepted any non-empty client string here.
    it("rejects a request with no proof", () => {
      expect(service.verify(reqWith({}), "user-1", "backup-restore")).toBe(
        false,
      );
    });

    it("rejects a proof issued for another user", () => {
      const token = proofFor("user-2");
      expect(
        service.verify(
          reqWith({ [OIDC_REAUTH_COOKIE]: token }),
          "user-1",
          "backup-restore",
        ),
      ).toBe(false);
    });

    it("rejects a token signed with another secret", () => {
      const foreign = new JwtService({
        secret: "some-other-secret-also-32-characters-x",
        signOptions: { algorithm: "HS256" },
      }).sign({ sub: "user-1", type: "oidc_reauth" });
      expect(
        service.verify(
          reqWith({ [OIDC_REAUTH_COOKIE]: foreign }),
          "user-1",
          "backup-restore",
        ),
      ).toBe(false);
    });

    it("rejects a token of some other type", () => {
      // A session or step-up token must not double as an IdP-roundtrip proof.
      const wrongType = jwt.sign({ sub: "user-1", type: "step_up" });
      expect(
        service.verify(
          reqWith({ [OIDC_REAUTH_COOKIE]: wrongType }),
          "user-1",
          "backup-restore",
        ),
      ).toBe(false);
    });

    it("rejects an expired proof", () => {
      const expired = jwt.sign(
        { sub: "user-1", type: "oidc_reauth" },
        { expiresIn: -1 },
      );
      expect(
        service.verify(
          reqWith({ [OIDC_REAUTH_COOKIE]: expired }),
          "user-1",
          "backup-restore",
        ),
      ).toBe(false);
    });

    it("rejects a value that is not a token at all", () => {
      expect(
        service.verify(
          reqWith({ [OIDC_REAUTH_COOKIE]: "oidc-session-confirmed" }),
          "user-1",
          "backup-restore",
        ),
      ).toBe(false);
    });

    it("survives a request with no cookies", () => {
      expect(
        service.verify({} as unknown as Request, "user-1", "backup-restore"),
      ).toBe(false);
    });
  });

  // P6-RECHECK-002. The signed cookie closed the forgery but left three holes:
  // the proof was generic, it was minted after every ordinary login, and clearing
  // the cookie is the client's copy rather than the server's record.
  describe("purpose binding", () => {
    const proofFor = (purpose: OidcReauthPurpose) => {
      const res = { cookie: jest.fn() } as unknown as Response;
      service.issue(res, "user-1", purpose);
      return (res.cookie as jest.Mock).mock.calls[0][1] as string;
    };

    it("refuses a restore proof presented for account deletion", () => {
      const token = proofFor("backup-restore");
      expect(
        service.verify(
          reqWith({ [OIDC_REAUTH_COOKIE]: token }),
          "user-1",
          "delete-account",
        ),
      ).toBe(false);
    });

    it("refuses a delete-account proof presented for a restore", () => {
      const token = proofFor("delete-account");
      expect(
        service.verify(
          reqWith({ [OIDC_REAUTH_COOKIE]: token }),
          "user-1",
          "backup-restore",
        ),
      ).toBe(false);
    });

    it("refuses a proof carrying no purpose at all", () => {
      // The shape the previous implementation minted.
      const legacy = jwt.sign({
        sub: "user-1",
        type: "oidc_reauth",
        jti: "legacy",
      });
      expect(
        service.verify(
          reqWith({ [OIDC_REAUTH_COOKIE]: legacy }),
          "user-1",
          "backup-restore",
        ),
      ).toBe(false);
    });
  });

  describe("single use", () => {
    const proof = () => {
      const res = { cookie: jest.fn() } as unknown as Response;
      service.issue(res, "user-1", "backup-restore");
      return (res.cookie as jest.Mock).mock.calls[0][1] as string;
    };

    // Two restores submitted before the cookie is cleared both used to pass:
    // `consume` clears the browser's copy, which is not a record of anything.
    it("accepts a proof once and refuses the same token again", () => {
      const token = proof();
      const req = reqWith({ [OIDC_REAUTH_COOKIE]: token });
      expect(service.verify(req, "user-1", "backup-restore")).toBe(true);
      expect(service.verify(req, "user-1", "backup-restore")).toBe(false);
    });

    it("spends each proof independently", () => {
      const first = proof();
      const second = proof();
      expect(
        service.verify(
          reqWith({ [OIDC_REAUTH_COOKIE]: first }),
          "user-1",
          "backup-restore",
        ),
      ).toBe(true);
      expect(
        service.verify(
          reqWith({ [OIDC_REAUTH_COOKIE]: second }),
          "user-1",
          "backup-restore",
        ),
      ).toBe(true);
      expect(
        service.verify(
          reqWith({ [OIDC_REAUTH_COOKIE]: second }),
          "user-1",
          "backup-restore",
        ),
      ).toBe(false);
    });

    it("refuses a proof with no jti to spend", () => {
      const noJti = jwt.sign({
        sub: "user-1",
        type: "oidc_reauth",
        purpose: "backup-restore",
      });
      expect(
        service.verify(
          reqWith({ [OIDC_REAUTH_COOKIE]: noJti }),
          "user-1",
          "backup-restore",
        ),
      ).toBe(false);
    });
  });

  describe("freshness", () => {
    const nowSeconds = 1_800_000_000;
    const now = nowSeconds * 1000;

    it("accepts an authentication that just happened", () => {
      expect(service.isFreshAuthentication(nowSeconds, now)).toBe(true);
      expect(service.isFreshAuthentication(nowSeconds - 60, now)).toBe(true);
    });

    // The reproduction: an IdP with a live SSO session answers the redirect
    // without prompting, and `auth_time` is from this morning.
    it("rejects a reused SSO session older than the window", () => {
      expect(service.isFreshAuthentication(nowSeconds - 6 * 60, now)).toBe(
        false,
      );
      expect(service.isFreshAuthentication(nowSeconds - 8 * 3600, now)).toBe(
        false,
      );
    });

    // An absent claim is unknown, not fine: a provider that does not report
    // auth_time has not answered the question `max_age=0` asked.
    it("rejects an absent or unusable auth_time", () => {
      expect(service.isFreshAuthentication(undefined, now)).toBe(false);
      expect(service.isFreshAuthentication(Number.NaN, now)).toBe(false);
    });

    it("tolerates small clock skew against the provider", () => {
      expect(service.isFreshAuthentication(nowSeconds + 30, now)).toBe(true);
      // ...but not a wildly future claim.
      expect(service.isFreshAuthentication(nowSeconds + 3600, now)).toBe(false);
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
