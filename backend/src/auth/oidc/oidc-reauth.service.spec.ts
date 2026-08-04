import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import type { Request, Response } from "express";
import { createScopedDbMocks } from "../../test-helpers/scoped-db-testing";

jest.mock("../../common/db/scoped-db", () =>
  jest
    .requireActual("../../test-helpers/scoped-db-testing")
    .scopedDbMockModule(),
);
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

  /**
   * A stand-in for the `oidc_step_up_claims` table: `INSERT ... ON CONFLICT DO
   * NOTHING ... RETURNING jti` returns one row for the caller that created it and
   * none for anyone else. Shared between service instances in the multi-replica
   * test below, which is the whole point of moving the ledger out of the process.
   */
  const makeClaimStore = () => {
    const rows = new Set<string>();
    return {
      rows,
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("DELETE FROM oidc_step_up_claims")) return [];
        const jti = String(params?.[0]);
        if (rows.has(jti)) return [];
        rows.add(jti);
        return [{ jti }];
      }),
    };
  };

  let claimStore: ReturnType<typeof makeClaimStore>;

  const buildService = (
    nodeEnv = "test",
    store: ReturnType<typeof makeClaimStore> = claimStore,
  ) => {
    const { manager, dataSource } = createScopedDbMocks([]);
    manager.query.mockImplementation(store.query);
    return new OidcReauthService(jwt, configFor(nodeEnv), dataSource as never);
  };

  beforeEach(() => {
    jwt = new JwtService({
      secret,
      signOptions: { algorithm: "HS256" },
      verifyOptions: { algorithms: ["HS256"] },
    });
    claimStore = makeClaimStore();
    service = buildService();
  });

  describe("issue", () => {
    it("sets an HttpOnly cookie the client cannot read or replay", async () => {
      const res = { cookie: jest.fn() } as unknown as Response;
      service.issue(res, "user-1", "backup-restore");

      expect(res.cookie).toHaveBeenCalledWith(
        OIDC_REAUTH_COOKIE,
        expect.any(String),
        expect.objectContaining({ httpOnly: true, sameSite: "lax" }),
      );
    });

    it("marks the cookie secure in production only", async () => {
      const prodRes = { cookie: jest.fn() } as unknown as Response;
      buildService("production").issue(prodRes, "user-1", "backup-restore");
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

    it("accepts a proof it issued for the same user", async () => {
      const token = proofFor("user-1");
      expect(
        await service.verify(
          reqWith({ [OIDC_REAUTH_COOKIE]: token }),
          "user-1",
          "backup-restore",
        ),
      ).toBe(true);
    });

    // The whole point: without a proof, nothing is proven. The old contract
    // accepted any non-empty client string here.
    it("rejects a request with no proof", async () => {
      expect(
        await service.verify(reqWith({}), "user-1", "backup-restore"),
      ).toBe(false);
    });

    it("rejects a proof issued for another user", async () => {
      const token = proofFor("user-2");
      expect(
        await service.verify(
          reqWith({ [OIDC_REAUTH_COOKIE]: token }),
          "user-1",
          "backup-restore",
        ),
      ).toBe(false);
    });

    it("rejects a token signed with another secret", async () => {
      const foreign = new JwtService({
        secret: "some-other-secret-also-32-characters-x",
        signOptions: { algorithm: "HS256" },
      }).sign({ sub: "user-1", type: "oidc_reauth" });
      expect(
        await service.verify(
          reqWith({ [OIDC_REAUTH_COOKIE]: foreign }),
          "user-1",
          "backup-restore",
        ),
      ).toBe(false);
    });

    it("rejects a token of some other type", async () => {
      // A session or step-up token must not double as an IdP-roundtrip proof.
      const wrongType = jwt.sign({ sub: "user-1", type: "step_up" });
      expect(
        await service.verify(
          reqWith({ [OIDC_REAUTH_COOKIE]: wrongType }),
          "user-1",
          "backup-restore",
        ),
      ).toBe(false);
    });

    it("rejects an expired proof", async () => {
      const expired = jwt.sign(
        { sub: "user-1", type: "oidc_reauth" },
        { expiresIn: -1 },
      );
      expect(
        await service.verify(
          reqWith({ [OIDC_REAUTH_COOKIE]: expired }),
          "user-1",
          "backup-restore",
        ),
      ).toBe(false);
    });

    it("rejects a value that is not a token at all", async () => {
      expect(
        await service.verify(
          reqWith({ [OIDC_REAUTH_COOKIE]: "oidc-session-confirmed" }),
          "user-1",
          "backup-restore",
        ),
      ).toBe(false);
    });

    it("survives a request with no cookies", async () => {
      expect(
        await service.verify(
          {} as unknown as Request,
          "user-1",
          "backup-restore",
        ),
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

    it("refuses a restore proof presented for account deletion", async () => {
      const token = proofFor("backup-restore");
      expect(
        await service.verify(
          reqWith({ [OIDC_REAUTH_COOKIE]: token }),
          "user-1",
          "delete-account",
        ),
      ).toBe(false);
    });

    it("refuses a delete-account proof presented for a restore", async () => {
      const token = proofFor("delete-account");
      expect(
        await service.verify(
          reqWith({ [OIDC_REAUTH_COOKIE]: token }),
          "user-1",
          "backup-restore",
        ),
      ).toBe(false);
    });

    it("refuses a proof carrying no purpose at all", async () => {
      // The shape the previous implementation minted.
      const legacy = jwt.sign({
        sub: "user-1",
        type: "oidc_reauth",
        jti: "legacy",
      });
      expect(
        await service.verify(
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
    it("accepts a proof once and refuses the same token again", async () => {
      const token = proof();
      const req = reqWith({ [OIDC_REAUTH_COOKIE]: token });
      expect(await service.verify(req, "user-1", "backup-restore")).toBe(true);
      expect(await service.verify(req, "user-1", "backup-restore")).toBe(false);
    });

    it("spends each proof independently", async () => {
      const first = proof();
      const second = proof();
      expect(
        await service.verify(
          reqWith({ [OIDC_REAUTH_COOKIE]: first }),
          "user-1",
          "backup-restore",
        ),
      ).toBe(true);
      expect(
        await service.verify(
          reqWith({ [OIDC_REAUTH_COOKIE]: second }),
          "user-1",
          "backup-restore",
        ),
      ).toBe(true);
      expect(
        await service.verify(
          reqWith({ [OIDC_REAUTH_COOKIE]: second }),
          "user-1",
          "backup-restore",
        ),
      ).toBe(false);
    });

    it("refuses a proof with no jti to spend", async () => {
      const noJti = jwt.sign({
        sub: "user-1",
        type: "oidc_reauth",
        purpose: "backup-restore",
      });
      expect(
        await service.verify(
          reqWith({ [OIDC_REAUTH_COOKIE]: noJti }),
          "user-1",
          "backup-restore",
        ),
      ).toBe(false);
    });
  });

  // P6-RECHECK-005. The claim used to live in a per-process `Map`, so on a
  // deployment with several backend replicas two restore requests carrying the same
  // proof could be routed to different replicas, each find its own map empty, and
  // both be told yes. With N replicas the same proof was accepted up to N times.
  describe("across replicas", () => {
    const proofFrom = (instance: OidcReauthService) => {
      const res = { cookie: jest.fn() } as unknown as Response;
      instance.issue(res, "user-1", "backup-restore");
      return (res.cookie as jest.Mock).mock.calls[0][1] as string;
    };

    it("lets exactly one of two replicas spend the same proof", async () => {
      // Two service instances, one shared claim ledger -- the deployment shape.
      const replicaA = buildService();
      const replicaB = buildService();
      const token = proofFrom(replicaA);
      const req = reqWith({ [OIDC_REAUTH_COOKIE]: token });

      const results = await Promise.all([
        replicaA.verify(req, "user-1", "backup-restore"),
        replicaB.verify(req, "user-1", "backup-restore"),
      ]);

      expect(results.filter(Boolean)).toHaveLength(1);
    });

    it("refuses a proof already spent on another replica", async () => {
      const replicaA = buildService();
      const replicaB = buildService();
      const token = proofFrom(replicaA);
      const req = reqWith({ [OIDC_REAUTH_COOKIE]: token });

      expect(await replicaA.verify(req, "user-1", "backup-restore")).toBe(true);
      // B has never seen this token and its own memory is empty; the ledger is
      // what refuses it.
      expect(await replicaB.verify(req, "user-1", "backup-restore")).toBe(
        false,
      );
    });

    it("lets a fresh proof through on any replica", async () => {
      const replicaA = buildService();
      const replicaB = buildService();
      const first = proofFrom(replicaA);
      const second = proofFrom(replicaA);

      expect(
        await replicaA.verify(
          reqWith({ [OIDC_REAUTH_COOKIE]: first }),
          "user-1",
          "backup-restore",
        ),
      ).toBe(true);
      expect(
        await replicaB.verify(
          reqWith({ [OIDC_REAUTH_COOKIE]: second }),
          "user-1",
          "backup-restore",
        ),
      ).toBe(true);
    });

    it("claims the jti, the user and the purpose", async () => {
      const token = proofFrom(service);
      await service.verify(
        reqWith({ [OIDC_REAUTH_COOKIE]: token }),
        "user-1",
        "backup-restore",
      );

      const insert = claimStore.query.mock.calls.find(([sql]) =>
        String(sql).includes("INSERT INTO oidc_step_up_claims"),
      );
      expect(insert).toBeDefined();
      expect(insert![0]).toContain("ON CONFLICT (jti) DO NOTHING");
      const [, params] = insert as [string, unknown[]];
      expect(params[1]).toBe("user-1");
      expect(params[2]).toBe("backup-restore");
      expect(params[3]).toBeInstanceOf(Date);
    });

    // Nothing schedules a sweep, so the insert does it. An expired row must never
    // be the reason a fresh proof is refused.
    it("sweeps expired claims in the same statement", async () => {
      const token = proofFrom(service);
      await service.verify(
        reqWith({ [OIDC_REAUTH_COOKIE]: token }),
        "user-1",
        "backup-restore",
      );

      expect(
        claimStore.query.mock.calls.some(([sql]) =>
          String(sql).includes("DELETE FROM oidc_step_up_claims"),
        ),
      ).toBe(true);
    });
  });

  describe("freshness", () => {
    const nowSeconds = 1_800_000_000;
    const now = nowSeconds * 1000;

    it("accepts an authentication that just happened", async () => {
      expect(service.isFreshAuthentication(nowSeconds, now)).toBe(true);
      expect(service.isFreshAuthentication(nowSeconds - 60, now)).toBe(true);
    });

    // The reproduction: an IdP with a live SSO session answers the redirect
    // without prompting, and `auth_time` is from this morning.
    it("rejects a reused SSO session older than the window", async () => {
      expect(service.isFreshAuthentication(nowSeconds - 6 * 60, now)).toBe(
        false,
      );
      expect(service.isFreshAuthentication(nowSeconds - 8 * 3600, now)).toBe(
        false,
      );
    });

    // An absent claim is unknown, not fine: a provider that does not report
    // auth_time has not answered the question `max_age=0` asked.
    it("rejects an absent or unusable auth_time", async () => {
      expect(service.isFreshAuthentication(undefined, now)).toBe(false);
      expect(service.isFreshAuthentication(Number.NaN, now)).toBe(false);
    });

    it("tolerates small clock skew against the provider", async () => {
      expect(service.isFreshAuthentication(nowSeconds + 30, now)).toBe(true);
      // ...but not a wildly future claim.
      expect(service.isFreshAuthentication(nowSeconds + 3600, now)).toBe(false);
    });
  });

  it("consume clears the cookie so one roundtrip authorises one action", async () => {
    const res = { clearCookie: jest.fn() } as unknown as Response;
    service.consume(res);
    expect(res.clearCookie).toHaveBeenCalledWith(
      OIDC_REAUTH_COOKIE,
      expect.objectContaining({ httpOnly: true, path: "/" }),
    );
  });
});
