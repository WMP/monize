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

@Injectable()
export class OidcReauthService {
  private readonly logger = new Logger(OidcReauthService.name);

  /**
   * Signed marker that this user started a re-authentication for this action.
   *
   * Carried in an httpOnly cookie across the IdP round trip. Signed rather than
   * a plain value because the callback trusts it to decide *which* action the
   * artifact it mints is for: an attacker who could rewrite the cookie would
   * turn a re-auth for a harmless purpose into one for account deletion.
   */
  createPendingMarker(userId: string, purpose: OidcReauthPurpose): string {
    return jwt.sign({ sub: userId, type: PENDING_TYPE, purpose }, secret(), {
      algorithm: ALGORITHM,
      expiresIn: OIDC_REAUTH_PENDING_TTL_SECONDS,
    });
  }

  /**
   * Read a pending marker, or null when it is absent, expired, tampered with, or
   * belongs to a different user than the one the IdP just authenticated.
   */
  readPendingMarker(
    marker: string | undefined,
    authenticatedUserId: string,
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

    if (!token || typeof token !== "string") {
      this.reject(userId, purpose, "no artifact presented");
    }

    let payload: OidcReauthPayload;
    try {
      payload = jwt.verify(token as string, secret(), {
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
