import { Injectable, Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import type { Request, Response } from "express";
import * as crypto from "crypto";

export const OIDC_REAUTH_COOKIE = "oidc_reauth";

/**
 * Cookie carrying the destructive purpose a step-up redirect was started for.
 * HttpOnly and set only by `/auth/oidc/step-up`, so the callback learns which
 * single action it may vouch for and the client cannot widen it.
 */
export const OIDC_STEP_UP_PURPOSE_COOKIE = "oidc_step_up_purpose";

/**
 * Destructive surfaces a proof can authorise. Kept in step with
 * `STEP_UP_PURPOSES` in `auth/step-up/dto/verify-step-up.dto.ts`.
 */
export const OIDC_REAUTH_PURPOSES = [
  "backup-restore",
  "delete-account",
  "delete-data",
  "emergency-access",
] as const;
export type OidcReauthPurpose = (typeof OIDC_REAUTH_PURPOSES)[number];

/**
 * Proof that this browser completed a fresh round trip through the identity
 * provider **for one named destructive action**, issued by the server that
 * watched it happen.
 *
 * OIDC accounts have no Monize password and cannot enrol Monize 2FA, so every
 * destructive flow used to fall back on the client saying so: the frontend sent
 * the literal string `oidc-session-confirmed` and the server accepted any
 * non-empty value. That is not a check. Replacing it with a signed HttpOnly
 * cookie closed the forgery, but left three ways the advertised step-up was still
 * not delivered, all of them fixed here:
 *
 * 1. **Freshness.** The authorization request asked for nothing, so an IdP with a
 *    live SSO session could answer immediately with no credential prompt. Step-up
 *    now goes through its own route, which sends `prompt=login` and `max_age=0`,
 *    and the callback checks the returned `auth_time` really is inside the window
 *    before vouching for anything.
 * 2. **Purpose.** One generic proof authorised restore, delete-account and
 *    delete-data alike, and it was minted after *every* ordinary OIDC login -- so
 *    simply signing in armed a full-account restore. The proof now carries the
 *    purpose it was requested for, and is only issued on a step-up callback.
 * 3. **One use.** Clearing the cookie clears the client's copy, not the server's
 *    record, so two requests sent before the clear both passed. A proof's `jti` is
 *    now spent server-side on first successful verification, which also closes the
 *    parallel-request replay.
 */
@Injectable()
export class OidcReauthService {
  private readonly logger = new Logger(OidcReauthService.name);

  /**
   * How long a completed IdP authentication counts as "fresh". Long enough to
   * cross the redirect and click a confirm button; short enough that it is not a
   * standing permission. Also the ceiling on the IdP's own `auth_time`.
   */
  private readonly TTL_SECONDS = 5 * 60;

  /**
   * Spent `jti`s, with the moment they can be forgotten.
   *
   * A token outlives its use by at most `TTL_SECONDS`, so the set stays small and
   * prunes itself. In-memory is the right scope: the proof is a cookie on one
   * browser and a replay has to reach the same process within five minutes. With
   * several replicas a parallel replay could land on another one -- which is why
   * the purpose binding and the freshness check are what carry the security
   * property, and this closes the common case rather than being the only defence.
   */
  private readonly spentJtis = new Map<string, number>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  private get useSecureCookies(): boolean {
    return this.configService.get<string>("NODE_ENV") === "production";
  }

  private get cookieOptions() {
    return {
      httpOnly: true as const,
      secure: this.useSecureCookies,
      sameSite: "lax" as const,
      path: "/",
    };
  }

  private prune(now: number): void {
    for (const [jti, expiresAt] of this.spentJtis) {
      if (expiresAt <= now) this.spentJtis.delete(jti);
    }
  }

  /**
   * Called by the OIDC callback of a **step-up** redirect, once the code exchange
   * has succeeded and the IdP's `auth_time` has been checked.
   *
   * Never called for an ordinary login: signing in must not arm a destructive
   * action the user did not ask for.
   */
  issue(res: Response, userId: string, purpose: OidcReauthPurpose): void {
    const token = this.jwtService.sign(
      {
        sub: userId,
        type: "oidc_reauth",
        purpose,
        jti: crypto.randomUUID(),
      },
      { expiresIn: this.TTL_SECONDS },
    );
    res.cookie(OIDC_REAUTH_COOKIE, token, {
      ...this.cookieOptions,
      maxAge: this.TTL_SECONDS * 1000,
    });
  }

  /**
   * Whether the IdP's asserted authentication time is inside the freshness
   * window. `auth_time` is what separates "the user just authenticated" from "the
   * user has an SSO session from this morning", and `max_age=0` asks the provider
   * to supply it.
   *
   * A provider that omits it has not answered the question, so it fails: an absent
   * claim is unknown, not fresh.
   */
  isFreshAuthentication(
    authTime: number | undefined,
    now = Date.now(),
  ): boolean {
    if (typeof authTime !== "number" || !Number.isFinite(authTime))
      return false;
    const ageSeconds = Math.floor(now / 1000) - authTime;
    // A small negative age is clock skew between us and the IdP, not a problem.
    return ageSeconds >= -60 && ageSeconds <= this.TTL_SECONDS;
  }

  /**
   * True when the request carries a valid, unexpired, unspent proof belonging to
   * `userId` and issued for `purpose`. Every failure mode -- absent, malformed,
   * expired, already spent, signed for another user, issued for another purpose,
   * or a token of some other type -- is a plain false.
   *
   * Verifying **spends** the proof: one redirect buys one destructive action.
   * `consume(res)` then clears the browser's copy.
   */
  verify(req: Request, userId: string, purpose: OidcReauthPurpose): boolean {
    const token = (req.cookies as Record<string, string> | undefined)?.[
      OIDC_REAUTH_COOKIE
    ];
    if (!token) return false;
    try {
      const payload = this.jwtService.verify<{
        sub?: string;
        type?: string;
        purpose?: string;
        jti?: string;
        exp?: number;
      }>(token);
      if (payload.type !== "oidc_reauth") return false;
      if (payload.sub !== userId) {
        this.logger.warn(
          `OIDC re-auth proof rejected: belongs to another user (${payload.sub ?? "unknown"})`,
        );
        return false;
      }
      if (payload.purpose !== purpose) {
        this.logger.warn(
          `OIDC re-auth proof rejected: issued for "${payload.purpose ?? "none"}", presented for "${purpose}"`,
        );
        return false;
      }
      if (!payload.jti) return false;

      const now = Date.now();
      this.prune(now);
      if (this.spentJtis.has(payload.jti)) {
        this.logger.warn(
          `OIDC re-auth proof rejected: already spent (purpose "${purpose}")`,
        );
        return false;
      }
      // Spent before the caller acts on the answer, so two requests racing on one
      // proof cannot both be told yes.
      this.spentJtis.set(
        payload.jti,
        payload.exp ? payload.exp * 1000 : now + this.TTL_SECONDS * 1000,
      );
      return true;
    } catch {
      // Expired or tampered with. Both mean "not proven".
      return false;
    }
  }

  /**
   * Drop the browser's copy once the proof has authorised something. The
   * server-side record of the spent `jti` is what actually prevents reuse; this
   * keeps the client from presenting a token that can only be refused.
   */
  consume(res: Response): void {
    res.clearCookie(OIDC_REAUTH_COOKIE, this.cookieOptions);
  }
}
