import { UnauthorizedException } from "@nestjs/common";
import * as jwt from "jsonwebtoken";
import {
  OIDC_REAUTH_PURPOSES,
  OIDC_REAUTH_TTL_SECONDS,
  OidcReauthService,
  isFreshAuthentication,
  isOidcReauthPurpose,
} from "./oidc-reauth.service";

const SECRET = "test-jwt-secret-at-least-thirty-two-characters";
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

describe("OidcReauthService", () => {
  let service: OidcReauthService;
  const originalSecret = process.env.JWT_SECRET;

  beforeEach(() => {
    process.env.JWT_SECRET = SECRET;
    service = new OidcReauthService();
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  });

  describe("purpose vocabulary", () => {
    it("recognizes each destructive action and nothing else", () => {
      for (const purpose of OIDC_REAUTH_PURPOSES) {
        expect(isOidcReauthPurpose(purpose)).toBe(true);
      }
      for (const value of ["", "delete", "DELETE-ACCOUNT", null, 7, {}]) {
        expect(isOidcReauthPurpose(value)).toBe(false);
      }
    });
  });

  describe("isFreshAuthentication", () => {
    const now = 1_700_000_000_000; // fixed epoch ms, so the cases are exact
    const nowSeconds = Math.floor(now / 1000);

    it("accepts an authentication from a moment ago", () => {
      expect(isFreshAuthentication(nowSeconds - 5, now)).toBe(true);
    });

    it("accepts the whole freshness window and nothing past it", () => {
      expect(
        isFreshAuthentication(nowSeconds - OIDC_REAUTH_TTL_SECONDS, now),
      ).toBe(true);
      expect(
        isFreshAuthentication(nowSeconds - OIDC_REAUTH_TTL_SECONDS - 1, now),
      ).toBe(false);
    });

    it("rejects a reused SSO session from this morning", () => {
      expect(isFreshAuthentication(nowSeconds - 6 * 3600, now)).toBe(false);
    });

    it("tolerates small clock skew ahead of us, but not a future claim", () => {
      // The IdP's clock running up to a minute ahead is skew, not an attack.
      expect(isFreshAuthentication(nowSeconds + 59, now)).toBe(true);
      expect(isFreshAuthentication(nowSeconds + 61, now)).toBe(false);
    });

    it("treats an absent or malformed claim as not fresh", () => {
      // A provider that omits auth_time has not answered the question.
      expect(isFreshAuthentication(undefined, now)).toBe(false);
      expect(isFreshAuthentication(Number.NaN, now)).toBe(false);
      expect(isFreshAuthentication(Infinity, now)).toBe(false);
    });
  });

  describe("consume", () => {
    it("accepts an artifact it issued for the same user and action", () => {
      const artifact = service.issue(USER, "delete-account");

      expect(() =>
        service.consume(USER, "delete-account", artifact),
      ).not.toThrow();
    });

    // The defect. Every one of these was accepted before: the check was
    // `if (!oidcIdToken) throw`, so any non-empty string passed -- and the
    // frontend sent the literal "oidc-session-confirmed".
    it.each([
      ["the old sentinel", "oidc-session-confirmed"],
      ["a single character", "x"],
      ["an empty string", ""],
      ["undefined", undefined],
      ["something JWT-shaped but unsigned", "a.b.c"],
    ])("rejects %s", (_label, token) => {
      expect(() =>
        service.consume(USER, "delete-account", token as string | undefined),
      ).toThrow(UnauthorizedException);
    });

    it("rejects an artifact signed with a different key", () => {
      const forged = jwt.sign(
        {
          sub: USER,
          type: "oidc_reauth",
          purpose: "delete-account",
          jti: "forged",
        },
        "a-different-secret-of-sufficient-length!!",
        { algorithm: "HS256", expiresIn: 300 },
      );

      expect(() => service.consume(USER, "delete-account", forged)).toThrow(
        UnauthorizedException,
      );
    });

    it("rejects an unsigned (alg=none) artifact", () => {
      // The classic JWT forgery. `algorithms: ["HS256"]` on verify is what stops
      // it, and this asserts that option is actually set.
      const unsigned = jwt.sign(
        {
          sub: USER,
          type: "oidc_reauth",
          purpose: "delete-account",
          jti: "none",
        },
        "",
        { algorithm: "none" },
      );

      expect(() => service.consume(USER, "delete-account", unsigned)).toThrow(
        UnauthorizedException,
      );
    });

    it("rejects an artifact minted for a different user", () => {
      const artifact = service.issue(OTHER, "delete-account");

      expect(() => service.consume(USER, "delete-account", artifact)).toThrow(
        UnauthorizedException,
      );
    });

    it("rejects an artifact minted for a different action", () => {
      // Action binding matters most between these two: deleting data and
      // restoring a backup are both destructive, but a restore overwrites
      // everything, and a user who confirmed one did not confirm the other.
      const artifact = service.issue(USER, "delete-data");

      expect(() => service.consume(USER, "restore-backup", artifact)).toThrow(
        UnauthorizedException,
      );
    });

    it("rejects an expired artifact", () => {
      const stale = jwt.sign(
        {
          sub: USER,
          type: "oidc_reauth",
          purpose: "delete-account",
          jti: "stale",
        },
        SECRET,
        { algorithm: "HS256", expiresIn: -1 },
      );

      expect(() => service.consume(USER, "delete-account", stale)).toThrow(
        UnauthorizedException,
      );
    });

    it("rejects a token of another type carrying the right claims", () => {
      // An ordinary access token has sub and a signature from the same secret.
      // Only `type` distinguishes it, and each type answers a different question.
      const accessToken = jwt.sign(
        { sub: USER, purpose: "delete-account", jti: "x" },
        SECRET,
        { algorithm: "HS256", expiresIn: 300 },
      );

      expect(() =>
        service.consume(USER, "delete-account", accessToken),
      ).toThrow(UnauthorizedException);
    });

    it("rejects a step-up token, which is a different proof", () => {
      const stepUp = jwt.sign(
        {
          sub: USER,
          type: "step_up",
          purpose: "emergency-access",
          jti: "y",
        },
        SECRET,
        { algorithm: "HS256", expiresIn: 300 },
      );

      expect(() => service.consume(USER, "emergency-access", stepUp)).toThrow(
        UnauthorizedException,
      );
    });

    it("refuses an artifact with no jti, which cannot be spent once", () => {
      const noJti = jwt.sign(
        { sub: USER, type: "oidc_reauth", purpose: "delete-data" },
        SECRET,
        { algorithm: "HS256", expiresIn: 300 },
      );

      expect(() => service.consume(USER, "delete-data", noJti)).toThrow(
        UnauthorizedException,
      );
    });

    it("spends an artifact exactly once", () => {
      const artifact = service.issue(USER, "delete-data");

      expect(() =>
        service.consume(USER, "delete-data", artifact),
      ).not.toThrow();
      expect(() => service.consume(USER, "delete-data", artifact)).toThrow(
        UnauthorizedException,
      );
    });

    it("shares the spent set across instances", () => {
      // UsersModule provides its own instance because it cannot import
      // AuthModule. Two independent replay counters would mean an artifact spent
      // on /users/delete-data was still good against another consumer.
      const artifact = service.issue(USER, "delete-data");
      const second = new OidcReauthService();

      expect(() =>
        service.consume(USER, "delete-data", artifact),
      ).not.toThrow();
      expect(() => second.consume(USER, "delete-data", artifact)).toThrow(
        UnauthorizedException,
      );
    });

    it("gives the same message whichever check failed", () => {
      // Which of signature / subject / action / freshness failed is a fact about
      // the server's secrets and state, so it goes to the log, not the response.
      const messages = new Set<string>();
      const cases: Array<() => void> = [
        () => service.consume(USER, "delete-account", "garbage"),
        () =>
          service.consume(
            USER,
            "delete-account",
            service.issue(OTHER, "delete-account"),
          ),
        () =>
          service.consume(
            USER,
            "delete-account",
            service.issue(USER, "delete-data"),
          ),
      ];
      for (const run of cases) {
        try {
          run();
        } catch (err) {
          messages.add((err as UnauthorizedException).message);
        }
      }

      expect(messages.size).toBe(1);
    });
  });

  describe("pending marker", () => {
    const STATE = "state-of-the-forced-round-trip";
    const OTHER_STATE = "state-of-some-other-round-trip";

    it("round-trips the purpose for the user who started the flow", () => {
      const marker = service.createPendingMarker(USER, "restore-backup", STATE);

      expect(service.readPendingMarker(marker, USER, STATE)).toBe(
        "restore-backup",
      );
    });

    it("refuses a marker started by a different account", () => {
      // The IdP authenticated somebody else. Minting here would hand user A an
      // artifact for a round trip user B completed.
      const marker = service.createPendingMarker(
        OTHER,
        "restore-backup",
        STATE,
      );

      expect(service.readPendingMarker(marker, USER, STATE)).toBeNull();
    });

    it("refuses a marker minted for a different authorization request", () => {
      // FV-001. The marker outlives its redirect: a second authorization request
      // -- an ordinary GET /auth/oidc, which sends no prompt=login -- overwrites
      // oidc_state while the marker cookie survives. Completing that callback
      // must not mint an artifact, or a live IdP SSO session substitutes for the
      // fresh challenge the whole flow exists to force.
      const marker = service.createPendingMarker(USER, "delete-account", STATE);

      expect(service.readPendingMarker(marker, USER, OTHER_STATE)).toBeNull();
    });

    it("refuses a marker with no flow binding at all", () => {
      // A cookie left over from the build before the binding existed. An
      // unbindable marker is precisely the case the binding closes, so it fails
      // closed rather than falling back to the user check alone.
      const marker = jwt.sign(
        { sub: USER, type: "oidc_reauth_pending", purpose: "delete-account" },
        SECRET,
        { algorithm: "HS256", expiresIn: 300 },
      );

      expect(service.readPendingMarker(marker, USER, STATE)).toBeNull();
    });

    it("refuses a valid marker when the callback validated no state", () => {
      const marker = service.createPendingMarker(USER, "delete-account", STATE);

      expect(service.readPendingMarker(marker, USER, undefined)).toBeNull();
    });

    it("does not carry the state in readable form", () => {
      // The binding is a hash. The state is public in the redirect URL, so this
      // is tidiness rather than secrecy -- but a marker that repeated it would
      // invite someone to read the claim instead of comparing it.
      const marker = service.createPendingMarker(USER, "delete-account", STATE);
      const payload = jwt.decode(marker) as { sth?: string };

      expect(payload.sth).not.toContain(STATE);
      expect(payload.sth).toMatch(/^[0-9a-f]{64}$/);
    });

    it("refuses a forged or absent marker", () => {
      expect(service.readPendingMarker(undefined, USER, STATE)).toBeNull();
      expect(service.readPendingMarker("not-a-jwt", USER, STATE)).toBeNull();
      expect(
        service.readPendingMarker(
          jwt.sign(
            { sub: USER, type: "oidc_reauth_pending", purpose: "delete-data" },
            "wrong-secret-wrong-secret-wrong!!",
            { algorithm: "HS256", expiresIn: 300 },
          ),
          USER,
          STATE,
        ),
      ).toBeNull();
    });

    it("refuses a marker whose purpose is not a known action", () => {
      const marker = service.createPendingMarker(
        USER,
        "become-admin" as never,
        STATE,
      );

      expect(service.readPendingMarker(marker, USER, STATE)).toBeNull();
    });

    it("refuses an artifact presented as a marker", () => {
      // Different types for different jobs: an artifact must not be replayable
      // into the callback to mint another one.
      const artifact = service.issue(USER, "delete-data");

      expect(service.readPendingMarker(artifact, USER, STATE)).toBeNull();
    });
  });

  describe("issued artifacts", () => {
    it("expire within five minutes", () => {
      const decoded = jwt.decode(service.issue(USER, "delete-data")) as {
        iat: number;
        exp: number;
      };

      expect(decoded.exp - decoded.iat).toBe(OIDC_REAUTH_TTL_SECONDS);
    });

    it("carry a distinct jti each time", () => {
      const first = jwt.decode(service.issue(USER, "delete-data")) as {
        jti: string;
      };
      const second = jwt.decode(service.issue(USER, "delete-data")) as {
        jti: string;
      };

      expect(first.jti).not.toBe(second.jti);
    });
  });
});
