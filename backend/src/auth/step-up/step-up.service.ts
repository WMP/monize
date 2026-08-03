import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { DataSource, EntityTarget, ObjectLiteral, Repository } from "typeorm";
import { withScopedDb } from "../../common/db/scoped-db";
import * as bcrypt from "bcryptjs";
import * as crypto from "crypto";

import { User } from "../../users/entities/user.entity";
import { UserPreference } from "../../users/entities/user-preference.entity";
import { TwoFactorService } from "../two-factor.service";
import type { StepUpPurpose } from "./dto/verify-step-up.dto";
import { tr } from "../../i18n/translate";

interface VerifyArgs {
  password?: string;
  totpCode?: string;
  /**
   * Set by the controller after `OidcReauthService` has verified the HttpOnly
   * proof cookie the OIDC callback issued. It is deliberately not something the
   * request body can carry: the earlier `oidcConfirmed` flag let the client
   * assert its own re-authentication, which is no check at all.
   */
  oidcReauthProven?: boolean;
}

export interface StepUpVerificationResult {
  stepUpToken: string;
  expiresAt: string;
  expiresInSeconds: number;
}

/**
 * Step-up re-authentication. The user is already authenticated (JWT
 * session); for a small set of high-sensitivity surfaces we re-prompt for
 * their strongest factor and hand back a short-lived token scoped to that
 * surface only.
 */
@Injectable()
export class StepUpAuthService {
  private readonly logger = new Logger(StepUpAuthService.name);
  private readonly STEP_UP_TTL_SECONDS = 5 * 60;
  private readonly MAX_ATTEMPTS = 10;
  private readonly LOCKOUT_WINDOW_MS = 30 * 60 * 1000;
  private readonly attempts = new Map<
    string,
    { count: number; expiresAt: number }
  >();

  constructor(
    private readonly dataSource: DataSource,
    private readonly twoFactorService: TwoFactorService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    // Forces ConfigService to be retained so step-up TTL can be tuned later
    // via env without changing the constructor signature.
    void this.configService;
  }

  /**
   * One repository call in its own short scoped transaction -- the RLS-era
   * replacement for the injected repositories this class used to hold, with the
   * same autocommit boundary each of those calls had. Multi-statement units use
   * an explicit `withScopedDb` block so their statements share one transaction.
   */
  private scoped<E extends ObjectLiteral, T>(
    entity: EntityTarget<E>,
    fn: (repo: Repository<E>) => Promise<T>,
  ): Promise<T> {
    return withScopedDb(this.dataSource, (manager) =>
      fn(manager.getRepository(entity)),
    );
  }

  async verifyAndIssue(
    userId: string,
    purpose: StepUpPurpose,
    args: VerifyArgs,
  ): Promise<StepUpVerificationResult> {
    this.cleanupExpiredAttempts();
    const attemptKey = `${userId}:${purpose}`;
    const record = this.attempts.get(attemptKey);
    if (record && record.count >= this.MAX_ATTEMPTS) {
      this.logger.warn(
        `Step-up rejected: too many attempts for user ${userId} purpose ${purpose}`,
      );
      throw new UnauthorizedException(
        tr(
          "errors.auth.stepUpTooManyAttempts",
          "Too many verification attempts. Please try again later.",
        ),
      );
    }

    const user = await this.scoped(User, (repo) =>
      repo.findOne({ where: { id: userId } }),
    );
    if (!user) {
      throw new NotFoundException(
        tr("errors.auth.userNotFound", "User not found"),
      );
    }

    const preferences = await this.scoped(UserPreference, (repo) =>
      repo.findOne({
        where: { userId },
      }),
    );
    const twoFactorEnabled =
      !!preferences?.twoFactorEnabled && !!user.twoFactorSecret;

    let verified = false;

    if (twoFactorEnabled) {
      // Strongest available: TOTP. Password is not accepted as a fallback for
      // users who have enrolled 2FA.
      if (!args.totpCode) {
        throw new BadRequestException({
          code: "TOTP_REQUIRED",
          message: "Enter your 6-digit authenticator code to continue",
        });
      }
      verified = await this.twoFactorService.verifyTotpForUser(
        userId,
        args.totpCode,
      );
    } else if (user.authProvider === "oidc") {
      // OIDC users have no Monize-managed password and cannot enroll Monize 2FA
      // (see two-factor.service.ts:283), so the factor is the identity provider
      // itself. The proof is the HttpOnly cookie `/auth/oidc/callback` mints
      // after it has verified state, nonce and the code exchange -- the only
      // party that saw the authentication happen. A client-supplied flag was
      // what this used to accept, and a client cannot vouch for itself.
      if (!args.oidcReauthProven) {
        throw new BadRequestException({
          code: "OIDC_REAUTH_REQUIRED",
          message: "Re-authenticate with your identity provider to continue.",
        });
      }
      verified = true;
    } else if (user.passwordHash) {
      if (!args.password) {
        throw new BadRequestException({
          code: "PASSWORD_REQUIRED",
          message: "Enter your current password to continue",
        });
      }
      verified = await bcrypt.compare(args.password, user.passwordHash);
    } else {
      // Local account with no password set (admin-provisioned via reset
      // flow that hasn't completed yet) -- step-up isn't available until
      // the user finishes onboarding.
      this.logger.warn(
        `Step-up unavailable for user ${userId}: no password and not OIDC`,
      );
      throw new BadRequestException({
        code: "STEP_UP_FACTOR_UNAVAILABLE",
        message:
          "Finish setting up your account password to access this setting.",
      });
    }

    if (!verified) {
      this.recordFailure(attemptKey);
      this.logger.warn(
        `Step-up verification failed for user ${userId} purpose ${purpose}`,
      );
      throw new UnauthorizedException(
        twoFactorEnabled
          ? tr(
              "errors.auth.invalidAuthenticatorCode",
              "Invalid authenticator code",
            )
          : tr("errors.auth.incorrectPassword", "Incorrect password"),
      );
    }

    this.attempts.delete(attemptKey);

    const jti = crypto.randomUUID();
    const stepUpToken = this.jwtService.sign(
      { sub: userId, type: "step_up", purpose, jti },
      { expiresIn: this.STEP_UP_TTL_SECONDS },
    );
    const expiresAt = new Date(
      Date.now() + this.STEP_UP_TTL_SECONDS * 1000,
    ).toISOString();

    this.logger.log(
      `Step-up verification succeeded for user ${userId} purpose ${purpose}`,
    );

    return {
      stepUpToken,
      expiresAt,
      expiresInSeconds: this.STEP_UP_TTL_SECONDS,
    };
  }

  private recordFailure(key: string): void {
    const existing = this.attempts.get(key);
    this.attempts.set(key, {
      count: (existing?.count ?? 0) + 1,
      expiresAt: Date.now() + this.LOCKOUT_WINDOW_MS,
    });
  }

  private cleanupExpiredAttempts(): void {
    const now = Date.now();
    for (const [key, value] of this.attempts.entries()) {
      if (value.expiresAt <= now) {
        this.attempts.delete(key);
      }
    }
  }
}
