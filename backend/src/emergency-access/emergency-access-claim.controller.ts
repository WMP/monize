import {
  BadRequestException,
  Body,
  Controller,
  Logger,
  NotFoundException,
  Post,
  Res,
} from "@nestjs/common";
import { tr } from "../i18n/translate";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { ConfigService } from "@nestjs/config";
import { DataSource, EntityTarget, ObjectLiteral, Repository } from "typeorm";
import { withScopedDb } from "../common/db/scoped-db";
import * as bcrypt from "bcryptjs";
import { Response } from "express";
import { SkipCsrf } from "../common/decorators/skip-csrf.decorator";
import { AllowDelegate } from "../delegation/decorators/delegate-access.decorator";
import { DemoRestricted } from "../common/decorators/demo-restricted.decorator";
import { EmergencyAccessContact } from "./entities/emergency-access-contact.entity";
import { EmergencyAccessSettings } from "./entities/emergency-access-settings.entity";
import { User } from "../users/entities/user.entity";
import { UserPreference } from "../users/entities/user-preference.entity";
import { TrustedDevice } from "../users/entities/trusted-device.entity";
import { hashToken } from "../auth/crypto.util";
import { TokenService } from "../auth/token.service";
import { PasswordBreachService } from "../auth/password-breach.service";
import { AuthService } from "../auth/auth.service";
import { AiEncryptionService } from "../ai/ai-encryption.service";
import { generateCsrfToken, getCsrfCookieOptions } from "../common/csrf.util";
import { withSystemContext } from "../common/db/with-context";
import { ClaimCompleteDto, ClaimPreviewDto } from "./dto/claim.dto";

@ApiTags("Emergency Access")
@Controller("emergency-access/claim")
export class EmergencyAccessClaimController {
  private readonly logger = new Logger(EmergencyAccessClaimController.name);
  private readonly useSecureCookies: boolean;

  constructor(
    private readonly dataSource: DataSource,
    private readonly tokenService: TokenService,
    private readonly authService: AuthService,
    private readonly passwordBreachService: PasswordBreachService,
    private readonly encryption: AiEncryptionService,
    private readonly configService: ConfigService,
  ) {
    const disableHttpsHeaders =
      this.configService
        .get<string>("DISABLE_HTTPS_HEADERS", "false")
        .toLowerCase() === "true";
    this.useSecureCookies =
      this.configService.get<string>("NODE_ENV") === "production" &&
      !disableHttpsHeaders;
  }

  /**
   * One repository call in its own short scoped transaction -- the RLS-era
   * replacement for the injected repositories this class used to hold, with the
   * same autocommit boundary each of those calls had.
   */
  private scoped<E extends ObjectLiteral, T>(
    entity: EntityTarget<E>,
    fn: (repo: Repository<E>) => Promise<T>,
  ): Promise<T> {
    return withScopedDb(this.dataSource, (manager) =>
      fn(manager.getRepository(entity)),
    );
  }

  private async findValidContact(
    rawToken: string,
  ): Promise<EmergencyAccessContact> {
    const tokenHash = hashToken(rawToken);
    const contact = await this.scoped(EmergencyAccessContact, (repo) =>
      repo.findOne({
        where: { claimTokenHash: tokenHash },
      }),
    );
    if (
      !contact ||
      !contact.claimTokenExpiresAt ||
      contact.claimTokenUsedAt ||
      contact.claimTokenExpiresAt.getTime() < Date.now()
    ) {
      throw new NotFoundException(
        tr(
          "errors.emergencyAccess.invalidClaimLink",
          "This emergency access link is invalid, expired, or has already been used.",
        ),
      );
    }
    return contact;
  }

  @Post("preview")
  @AllowDelegate()
  @SkipCsrf()
  @Throttle({ default: { ttl: 900000, limit: 5 } })
  @ApiOperation({
    summary: "Validate the magic link and return owner identity + message",
  })
  async preview(@Body() dto: ClaimPreviewDto) {
    // RLS (task C4): the claimant is the grantee (or a bare token), not the
    // owner, so every read here (contacts by token hash, the owner's settings
    // and users row) is owner-keyed but runs with the wrong identity. Run under
    // a system context. Inert at RLS_MODE=off -- only seeds AsyncLocalStorage.
    return withSystemContext(() => this.previewWithinContext(dto));
  }

  private async previewWithinContext(dto: ClaimPreviewDto) {
    const contact = await this.findValidContact(dto.token);
    const settings = await this.scoped(EmergencyAccessSettings, (repo) =>
      repo.findOne({
        where: { ownerUserId: contact.ownerUserId },
      }),
    );
    const owner = await this.scoped(User, (repo) =>
      repo.findOne({
        where: { id: contact.ownerUserId },
      }),
    );
    if (!settings || !owner) {
      throw new NotFoundException(
        tr(
          "errors.emergencyAccess.ownerAccountGone",
          "Owner account no longer exists.",
        ),
      );
    }

    let message: string | null = null;
    if (settings.messageCiphertext && this.encryption.isConfigured()) {
      try {
        message = this.encryption.decrypt(settings.messageCiphertext);
      } catch (error) {
        this.logger.error(
          "Failed to decrypt emergency access message during preview",
          error instanceof Error ? error.stack : error,
        );
      }
    }

    return {
      ownerFirstName: owner.firstName,
      ownerLastName: owner.lastName,
      contactFirstName: contact.firstName,
      message,
      expiresAt: contact.claimTokenExpiresAt,
    };
  }

  @Post("complete")
  @AllowDelegate()
  @SkipCsrf()
  @DemoRestricted()
  @Throttle({ default: { ttl: 900000, limit: 5 } })
  @ApiOperation({
    summary:
      "Consume the magic link, replace the owner's password, and sign in",
  })
  async complete(@Body() dto: ClaimCompleteDto, @Res() res: Response) {
    // RLS (task C4): the claim rewrites the OWNER's credentials across users,
    // user_preferences, trusted_devices, the emergency-access tables and
    // refresh_tokens while the requester is the grantee/bare token -- run the
    // whole flow under a system context.
    return withSystemContext(() => this.completeWithinContext(dto, res));
  }

  private async completeWithinContext(dto: ClaimCompleteDto, res: Response) {
    // Validate the magic link before doing any expensive work. Otherwise an
    // unauthenticated caller could force a breach lookup and a bcrypt hash
    // (cost 12) on every request with a bogus token. The transaction below
    // re-validates under lock to close the TOCTOU window.
    await this.findValidContact(dto.token);

    const isBreached = await this.passwordBreachService.isBreached(
      dto.newPassword,
    );
    if (isBreached) {
      throw new BadRequestException(
        tr(
          "errors.emergencyAccess.passwordBreached",
          "This password has been found in a data breach. Please choose a different password.",
        ),
      );
    }

    const tokenHash = hashToken(dto.token);
    const passwordHash = await bcrypt.hash(dto.newPassword, 12);
    const ownerId = await withScopedDb(this.dataSource, async (manager) => {
      // `FOR UPDATE`, and not merely for tidiness: this is the single-use check,
      // and without the lock two claims arriving together both read
      // `claim_token_used_at IS NULL`, both rewrite the owner's password, and
      // both are told they succeeded -- while only the last write survives, so
      // one contact holds a password that does not work and the account has been
      // handed to someone who was told they lost. With the lock the second
      // claim's SELECT re-evaluates after the first commits, finds the hash
      // cleared, matches nothing, and returns the not-found this endpoint
      // already has for a spent link.
      const contact = await manager.findOne(EmergencyAccessContact, {
        where: { claimTokenHash: tokenHash },
        lock: { mode: "pessimistic_write" },
      });
      if (
        !contact ||
        !contact.claimTokenExpiresAt ||
        contact.claimTokenUsedAt ||
        contact.claimTokenExpiresAt.getTime() < Date.now()
      ) {
        throw new NotFoundException(
          tr(
            "errors.emergencyAccess.invalidClaimLink",
            "This emergency access link is invalid, expired, or has already been used.",
          ),
        );
      }
      const ownerId = contact.ownerUserId;

      const owner = await manager.findOne(User, {
        where: { id: ownerId },
      });
      if (!owner) {
        throw new NotFoundException(
          tr(
            "errors.emergencyAccess.ownerAccountGone",
            "Owner account no longer exists.",
          ),
        );
      }

      // Replace credentials so the contact can sign in.
      await manager
        .createQueryBuilder()
        .update(User)
        .set({
          passwordHash,
          mustChangePassword: false,
          twoFactorSecret: null,
          pendingTwoFactorSecret: null,
          backupCodes: null,
          authProvider: "local",
          lastLogin: new Date(),
          lastActivityAt: new Date(),
          failedLoginAttempts: 0,
          lockedUntil: null,
          resetToken: null,
          resetTokenExpiry: null,
        })
        .where("id = :id", { id: ownerId })
        .execute();

      // 2FA on the preferences side.
      await manager
        .createQueryBuilder()
        .update(UserPreference)
        .set({ twoFactorEnabled: false })
        .where("user_id = :id", { id: ownerId })
        .execute();

      // Trusted devices belonged to the previous holder.
      await manager.delete(TrustedDevice, { userId: ownerId });

      // Consume the claiming token, void all sibling tokens (single-claim wins).
      contact.claimTokenUsedAt = new Date();
      contact.claimVoidedReason = null;
      contact.claimTokenHash = null;
      await manager.save(contact);

      await manager
        .createQueryBuilder()
        .update(EmergencyAccessContact)
        .set({
          claimTokenHash: null,
          claimTokenExpiresAt: null,
          claimTokenUsedAt: () => "CURRENT_TIMESTAMP",
          claimVoidedReason: "claimed_by_other",
        })
        .where("owner_user_id = :id", { id: ownerId })
        .andWhere("id <> :contactId", { contactId: contact.id })
        .andWhere("claim_token_hash IS NOT NULL")
        .andWhere("claim_token_used_at IS NULL")
        .execute();

      // Disable the emergency access feature on the now-claimed account so
      // the cron does not re-fire if the new holder ever lapses.
      await manager
        .createQueryBuilder()
        .update(EmergencyAccessSettings)
        .set({ enabled: false, grantedAt: new Date() })
        .where("owner_user_id = :id", { id: ownerId })
        .execute();

      return ownerId;
    });

    // Revoke every existing refresh token outside the transaction so it
    // uses the TokenService API (which writes via its own repo).
    await this.tokenService.revokeAllUserRefreshTokens(ownerId);

    const freshOwner = await this.scoped(User, (repo) =>
      repo.findOne({ where: { id: ownerId } }),
    );
    if (!freshOwner) {
      throw new NotFoundException(
        tr(
          "errors.emergencyAccess.ownerAccountGone",
          "Owner account no longer exists.",
        ),
      );
    }

    const { accessToken, refreshToken } =
      await this.tokenService.generateTokenPair(freshOwner, false);

    res.cookie("auth_token", accessToken, {
      httpOnly: true,
      secure: this.useSecureCookies,
      sameSite: "lax" as const,
      maxAge: 15 * 60 * 1000,
      path: "/",
    });
    res.cookie("refresh_token", refreshToken, {
      httpOnly: true,
      secure: this.useSecureCookies,
      sameSite: "strict" as const,
      maxAge: this.tokenService.getRefreshExpiryMs(false),
      path: "/",
    });
    res.cookie(
      "csrf_token",
      generateCsrfToken(freshOwner.id, this.authService.getCsrfKey()),
      getCsrfCookieOptions(this.useSecureCookies),
    );

    this.logger.log(`Emergency access claim completed for user ${ownerId}`);

    res.json({ ok: true });
  }
}
