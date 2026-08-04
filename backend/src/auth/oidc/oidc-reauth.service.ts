import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import * as jwt from "jsonwebtoken";
import * as crypto from "crypto";
import { tr } from "../../i18n/translate";

/**
 * Cryptographic re-authentication for OIDC accounts.
 *
 * The destructive surfaces -- account deletion, data deletion, backup restore,
 * and the .mny import's wipe-first mode -- each require a second proof of
 * identity beyond the session. For a local account that is the password. For an
 * OIDC account there is no Monize-managed password, and the previous
 * implementation resolved that by testing whether a client-supplied string was
 * non-empty: the frontend sent the literal `"oidc-session-confirmed"`, the
 * backend accepted anything, and the specs pinned the sentinel as expected
 * behaviour (P2-005). The second proof collapsed into possession of the first,
 * so a stolen-but-valid session that could satisfy CSRF could restore over,
 * delete the data of, or delete outright any OIDC account.
 *
 * What replaces it: the server sends the user through the identity provider with
 * `prompt=login`, and the OIDC callback -- which already verifies state, nonce,
 * issuer, audience and signature through `openid-client` -- mints a short-lived
 * artifact bound to the user id, the intended action, and a one-time id. The
 * destructive handler consumes it. Every property the audit asked for is
 * checked: signature, type, subject, action, freshness, single use.
 *
 * The client never mints it and cannot forge it, because it is signed with
 * JWT_SECRET, which is exactly the property the sentinel lacked.
 *
 * Signing goes through `jsonwebtoken` directly rather than Nest's `JwtService`
 * so this class has no injected dependencies. That is what lets `UsersModule`
 * provide it without importing `AuthModule` -- which it cannot, the two are
 * mutually dependent through `NotificationsModule` (see the module's own comment
 * about `PasswordBreachService`). The spent-id set is module-level rather than
 * per-instance for the same reason: two Nest instances of this class must not
 * mean two independent replay counters.
 *
 * Replay: consumed ids are held in memory. On a single replica that makes the
 * artifact strictly one-use. Across replicas it is best-effort -- an artifact
 * could be spent once per replica inside its five-minute window. That residual
 * is bounded and deliberate rather than overlooked: spending it requires the
 * session it was minted for, and that session's holder can simply run the flow
 * again, so the guarantee doing the work here is the IdP challenge, not the
 * counter. Closing it properly needs shared state (a table or a cache), which is
 * a schema decision, not a fix to smuggle into this one.
 */

/** The actions an OIDC re-authentication artifact can be minted for. */
export const OIDC_REAUTH_PURPOSES = [
  "delete-account",
  "delete-data",
  "restore-backup",
  "import-wipe",
  "emergency-access",
] as const;

export type OidcReauthPurpose = (typeof OIDC_REAUTH_PURPOSES)[number];

export function isOidcReauthPurpose(
  value: unknown,
): value is OidcReauthPurpose {
  return (
    typeof value === "string" &&
    (OIDC_REAUTH_PURPOSES as readonly string[]).includes(value)
  );
}

/** Five minutes: long enough to finish the action, short enough to be useless later. */
export const OIDC_REAUTH_TTL_SECONDS = 5 * 60;

/**
 * Whether the provider's asserted authentication time is inside the freshness
 * window.
 *
 * The authorization request sends `prompt=login` and `max_age=0`, but a
 * parameter is a request, not a property: providers honour them unevenly, and
 * one holding a live SSO session can answer the redirect with no credential
 * prompt at all. `auth_time` is the claim that reports what actually happened,
 * so the callback checks it before minting anything -- otherwise the
 * "re-authenticate to continue" step can be satisfied by an unattended browser
 * whose session was simply still warm.
 *
 * A provider that omits the claim has not answered the question, so an absent
 * or malformed `auth_time` is "not fresh" rather than "fine". A small negative
 * age is clock skew between us and the IdP, not a problem.
 */
export function isFreshAuthentication(
  authTime: number | undefined,
  now = Date.now(),
): boolean {
  if (typeof authTime !== "number" || !Number.isFinite(authTime)) return false;
  const ageSeconds = Math.floor(now / 1000) - authTime;
  return ageSeconds >= -60 && ageSeconds <= OIDC_REAUTH_TTL_SECONDS;
}

const TOKEN_TYPE = "oidc_reauth";

interface OidcReauthPayload {
  sub: string;
  type: string;
  purpose: string;
  jti: string;
  exp?: number;
}

/** Payload of the pending-reauth cookie set before the IdP redirect. */
interface PendingReauthPayload {
  sub: string;
  type: string;
  purpose: string;
  /** SHA-256 of the `state` this marker was minted alongside. See `flowHash`. */
  sth?: string;
  exp?: number;
}

const PENDING_TYPE = "oidc_reauth_pending";

const ALGORITHM = "HS256" as const;

/**
 * jti -> expiry (ms). Module-level so every Nest instance of this service shares
 * one replay counter (see the class comment).
 */
const consumedJtis = new Map<string, number>();

/**
 * Resolved per call rather than cached: `JwtStrategy` already refuses to start
 * without a JWT_SECRET of at least 32 characters, so by the time any of this runs
 * the value exists -- but reading it fresh keeps this class free of construction
 * order assumptions.
 */
function secret(): string {
  const value = process.env.JWT_SECRET;
  if (!value) {
    throw new Error("JWT_SECRET is required to sign OIDC re-authentication");
  }
  return value;
}

/** How long the user has to complete the IdP round trip. */
export const OIDC_REAUTH_PENDING_TTL_SECONDS = 10 * 60;

/**
 * Identity of one authorization round trip, as the marker records it.
 *
 * The `state` is the only value that is unique to a single redirect and comes
 * back through the provider, so it is what a marker has to be tied to. Hashed
 * rather than stored raw: a JWT payload is readable by anyone holding the
 * cookie, and there is no reason for the marker to repeat a value the caller
 * would otherwise have to have kept.
 */
function flowHash(state: string): string {
  return crypto.createHash("sha256").update(state).digest("hex");
}

/**
 * A present, non-empty string, as a type guard.
 *
 * The header arrives typed `string | undefined` but is really `unknown` -- a
 * repeated header gives an array -- so the runtime check has to stay. Written as
 * a guard on `value` rather than inline on the artifact so `consume` reads as one
 * predicate, and so the narrowing removes the `token as string` cast that
 * followed it.
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Compare two `flowHash` digests without leaking where they diverge (CWE-208).
 *
 * `!==` on hex strings returns as soon as a character differs, so the time it
 * takes reports the length of the shared prefix -- and the caller controls one
 * side of the comparison via the marker cookie, so it can be probed. That is a
 * narrow lever, since forging a match also needs a preimage of the `state` this
 * hash was taken of, but constant time here costs nothing and the alternative is
 * an argument rather than a property.
 *
 * Equal-length inputs are required by `timingSafeEqual`, so a length mismatch is
 * answered first -- it is not a secret: both sides are SHA-256 hex, and anything
 * else is malformed input rather than a near miss.
 */
function flowHashMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

@Injectable()
export class OidcReauthService {
  private readonly logger = new Logger(OidcReauthService.name);

  /**
   * Signed marker that this user started a re-authentication for this action,
   * in *this* authorization round trip.
   *
   * Carried in an httpOnly cookie across the IdP round trip. Signed rather than
   * a plain value because the callback trusts it to decide *which* action the
   * artifact it mints is for: an attacker who could rewrite the cookie would
   * turn a re-auth for a harmless purpose into one for account deletion.
   *
   * `state` binds it to one redirect. Without that binding the marker only says
   * "a re-authentication was started", and any later callback for the same user
   * satisfies it -- including the ordinary login callback, which does not ask the
   * provider to challenge the user at all (FV-001).
   */
  createPendingMarker(
    userId: string,
    purpose: OidcReauthPurpose,
    state: string,
  ): string {
    return jwt.sign(
      { sub: userId, type: PENDING_TYPE, purpose, sth: flowHash(state) },
      secret(),
      {
        algorithm: ALGORITHM,
        expiresIn: OIDC_REAUTH_PENDING_TTL_SECONDS,
      },
    );
  }

  /**
   * Read a pending marker, or null when it is absent, expired, tampered with,
   * belongs to a different user than the one the IdP just authenticated, or was
   * minted for a different round trip than the one completing now.
   *
   * `state` is the state this callback actually validated. A marker with no
   * `sth` claim is refused rather than accepted on the older two checks: an
   * unbindable marker is exactly the case this binding exists to close, so a
   * cookie left over from a previous build has to fail closed.
   */
  readPendingMarker(
    marker: string | undefined,
    authenticatedUserId: string,
    state: string | undefined,
  ): OidcReauthPurpose | null {
    if (!marker) return null;
    let payload: PendingReauthPayload;
    try {
      payload = jwt.verify(marker, secret(), {
        algorithms: [ALGORITHM],
      }) as PendingReauthPayload;
    } catch {
      return null;
    }
    if (payload.type !== PENDING_TYPE) return null;
    if (payload.sub !== authenticatedUserId) {
      // The session that started the re-auth is not the account that came back
      // from the provider. Minting here would hand user A an artifact for a
      // round trip user B completed.
      this.logger.warn(
        `OIDC re-auth marker rejected: started by ${payload.sub}, provider ` +
          `authenticated ${authenticatedUserId}`,
      );
      return null;
    }
    if (
      !payload.sth ||
      !state ||
      !flowHashMatches(payload.sth, flowHash(state))
    ) {
      // The marker outlived the redirect it was minted for. The reachable case is
      // a second authorization request overwriting `oidc_state` while the marker
      // cookie survives -- an ordinary `GET /auth/oidc` does exactly that, and it
      // sends no `prompt=login`, so the provider may answer it from an existing
      // SSO session without challenging anyone.
      this.logger.warn(
        `OIDC re-auth marker rejected for user ${authenticatedUserId}: ` +
          `minted for a different authorization request`,
      );
      return null;
    }
    return isOidcReauthPurpose(payload.purpose) ? payload.purpose : null;
  }

  /**
   * Mint the artifact. Only ever called from the OIDC callback, after
   * `openid-client` has verified the authorization code exchange (state, nonce,
   * issuer, audience, signature) and after the subject has been matched to this
   * account.
   */
  issue(userId: string, purpose: OidcReauthPurpose): string {
    this.logger.log(
      `OIDC re-authentication issued for user ${userId} purpose ${purpose}`,
    );
    return jwt.sign(
      { sub: userId, type: TOKEN_TYPE, purpose, jti: crypto.randomUUID() },
      secret(),
      { algorithm: ALGORITHM, expiresIn: OIDC_REAUTH_TTL_SECONDS },
    );
  }

  /**
   * Verify and spend an artifact, or throw.
   *
   * Every rejection is the same `401` with the same message: which of the checks
   * failed is a fact about the server's secrets and state, and the caller has no
   * legitimate use for it. The reason goes to the log instead.
   */
  consume(
    userId: string,
    purpose: OidcReauthPurpose,
    token: string | undefined,
  ): void {
    this.pruneConsumed();

    if (!isNonEmptyString(token)) {
      this.reject(userId, purpose, "no artifact presented");
    }

    let payload: OidcReauthPayload;
    try {
      payload = jwt.verify(token, secret(), {
        algorithms: [ALGORITHM],
      }) as OidcReauthPayload;
    } catch (err) {
      this.reject(
        userId,
        purpose,
        err instanceof jwt.TokenExpiredError ? "expired" : "invalid signature",
      );
    }

    if (payload!.type !== TOKEN_TYPE) {
      // An ordinary access token, a step-up token, or a 2FA-pending token is not
      // a re-authentication: each is minted for a different question.
      this.reject(userId, purpose, `wrong type "${payload!.type}"`);
    }
    if (payload!.sub !== userId) {
      this.reject(userId, purpose, `subject mismatch (${payload!.sub})`);
    }
    if (payload!.purpose !== purpose) {
      // Action binding: an artifact minted to unlock a data deletion must not
      // authorize a restore, which overwrites everything instead.
      this.reject(
        userId,
        purpose,
        `minted for a different action ("${payload!.purpose}")`,
      );
    }
    if (!payload!.jti) {
      this.reject(userId, purpose, "no jti, so it cannot be spent once");
    }
    if (consumedJtis.has(payload!.jti)) {
      this.reject(userId, purpose, "already spent");
    }

    consumedJtis.set(payload!.jti, Date.now() + OIDC_REAUTH_TTL_SECONDS * 1000);
  }

  private reject(
    userId: string,
    purpose: OidcReauthPurpose,
    reason: string,
  ): never {
    this.logger.warn(
      `OIDC re-authentication rejected for user ${userId} purpose ${purpose}: ${reason}`,
    );
    throw new UnauthorizedException(
      tr(
        "errors.auth.oidcReauthRequired",
        "Re-authenticate with your identity provider to confirm this action.",
      ),
    );
  }

  private pruneConsumed(): void {
    const now = Date.now();
    for (const [jti, expiresAt] of consumedJtis.entries()) {
      if (expiresAt <= now) consumedJtis.delete(jti);
    }
  }
}
