import { Injectable, Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import type { Request, Response } from "express";
import * as crypto from "crypto";

export const OIDC_REAUTH_COOKIE = "oidc_reauth";

/**
 * Proof that this browser completed a fresh round trip through the identity
 * provider, issued by the server that watched it happen.
 *
 * OIDC accounts have no Monize password and cannot enrol Monize 2FA, so every
 * destructive flow used to fall back on the client saying so: the frontend sent
 * the literal string `oidc-session-confirmed` (or `oidcConfirmed: true`) and the
 * server accepted any non-empty value. That is not a check. Anyone with the
 * session cookie -- a borrowed laptop, a stolen cookie, a CSRF-adjacent bug --
 * could restore a backup over the account's data or delete the account outright,
 * while the UI promised reauthentication through the provider.
 *
 * The signal that cannot be forged is the one the callback produces. After
 * `/auth/oidc/callback` verifies state, nonce and the code exchange, it mints a
 * short-lived signed token here and sets it as an HttpOnly cookie. The
 * destructive endpoints verify that token against the caller's own user id, so
 * the proof is bound to the account, to a real IdP authentication, and to a
 * freshness window.
 *
 * Deliberately not a bearer value the client can read or replay elsewhere: it is
 * HttpOnly, single-purpose, and consumed on use.
 */
@Injectable()
export class OidcReauthService {
  private readonly logger = new Logger(OidcReauthService.name);

  /**
   * How long a completed IdP authentication counts as "fresh". Long enough to
   * cross the redirect and click a confirm button; short enough that it is not a
   * standing permission.
   */
  private readonly TTL_SECONDS = 5 * 60;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  private get useSecureCookies(): boolean {
    return this.configService.get<string>("NODE_ENV") === "production";
  }

  /** Called by the OIDC callback once the code exchange has succeeded. */
  issue(res: Response, userId: string): void {
    const token = this.jwtService.sign(
      { sub: userId, type: "oidc_reauth", jti: crypto.randomUUID() },
      { expiresIn: this.TTL_SECONDS },
    );
    res.cookie(OIDC_REAUTH_COOKIE, token, {
      httpOnly: true,
      secure: this.useSecureCookies,
      sameSite: "lax",
      maxAge: this.TTL_SECONDS * 1000,
      path: "/",
    });
  }

  /**
   * True when the request carries a valid, unexpired proof belonging to
   * `userId`. Every failure mode -- absent, malformed, expired, signed for
   * another user, or a token of some other type -- is a plain false.
   */
  verify(req: Request, userId: string): boolean {
    const token = (req.cookies as Record<string, string> | undefined)?.[
      OIDC_REAUTH_COOKIE
    ];
    if (!token) return false;
    try {
      const payload = this.jwtService.verify<{
        sub?: string;
        type?: string;
      }>(token);
      if (payload.type !== "oidc_reauth") return false;
      if (payload.sub !== userId) {
        this.logger.warn(
          `OIDC re-auth proof rejected: belongs to another user (${payload.sub ?? "unknown"})`,
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
   * Drop the proof once it has authorised something, so one redirect buys one
   * destructive action rather than a five-minute window of them.
   */
  consume(res: Response): void {
    res.clearCookie(OIDC_REAUTH_COOKIE, {
      httpOnly: true,
      secure: this.useSecureCookies,
      sameSite: "lax",
      path: "/",
    });
  }
}
