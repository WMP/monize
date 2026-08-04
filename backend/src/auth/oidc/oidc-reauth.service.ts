import { Injectable, Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import type { Request, Response } from "express";
import * as crypto from "crypto";
import { DataSource } from "typeorm";
import { withScopedDb } from "../../common/db/scoped-db";

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
 *    now spent server-side on first successful verification. The claim is a row in
 *    `oidc_step_up_claims`, not a field in this process: a `Map` enforces single use
 *    inside one Node process, and on a deployment with several backend replicas two
 *    requests carrying the same proof could be routed to different replicas and
 *    both be told yes. `INSERT ... ON CONFLICT DO NOTHING` on the primary key is
 *    atomic across every replica, so exactly one wins.
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

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
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

  /**
   * Claim a `jti` for this proof, atomically and across every replica.
   *
   * Returns true only for the caller whose INSERT actually created the row.
   * Expired rows are swept in the same statement rather than by a timer: the
   * table only ever holds proofs from the last few minutes, so the delete is
   * trivial and there is nothing to schedule or forget.
   */
  private async claim(
    jti: string,
    userId: string,
    purpose: OidcReauthPurpose,
    expiresAt: Date,
  ): Promise<boolean> {
    return withScopedDb(this.dataSource, async (m) => {
      await m.query(
        `DELETE FROM oidc_step_up_claims WHERE expires_at <= now()`,
      );
      const result: { jti: string }[] = await m.query(
        `INSERT INTO oidc_step_up_claims (jti, user_id, purpose, expires_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (jti) DO NOTHING
         RETURNING jti`,
        [jti, userId, purpose, expiresAt],
      );
      return result.length > 0;
    });
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
   * expired, already claimed, signed for another user, issued for another purpose,
   * or a token of some other type -- is a plain false.
   *
   * Verifying **spends** the proof, by claiming its `jti` in the shared ledger:
   * one redirect buys one destructive action, across the whole deployment rather
   * than once per process. `consume(res)` then clears the browser's copy, which is
   * defence in depth and not the record.
   */
  async verify(
    req: Request,
    userId: string,
    purpose: OidcReauthPurpose,
  ): Promise<boolean> {
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

      // Claimed before the caller acts on the answer, so two requests racing on
      // one proof cannot both be told yes -- including when they land on
      // different replicas.
      const expiresAt = new Date(
        payload.exp ? payload.exp * 1000 : Date.now() + this.TTL_SECONDS * 1000,
      );
      const claimed = await this.claim(payload.jti, userId, purpose, expiresAt);
      if (!claimed) {
        this.logger.warn(
          `OIDC re-auth proof rejected: already spent (purpose "${purpose}")`,
        );
        return false;
      }
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
