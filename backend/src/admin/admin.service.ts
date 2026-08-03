import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DataSource, EntityManager } from "typeorm";
import { withScopedDb } from "../common/db/scoped-db";
import { withSystemContext } from "../common/db/with-context";
import * as bcrypt from "bcryptjs";
import * as crypto from "crypto";
import { I18nService } from "nestjs-i18n";
import { tr } from "../i18n/translate";
import { emailTranslator } from "../i18n/email-translator";
import { resolveUserEmailLocale } from "../i18n/resolve-user-email-locale";
import { User } from "../users/entities/user.entity";
import { UserPreference } from "../users/entities/user-preference.entity";
import { RefreshToken } from "../auth/entities/refresh-token.entity";
import { PersonalAccessToken } from "../auth/entities/personal-access-token.entity";
import { generateReadablePassword } from "./utils/password-generator";
import { hashToken } from "../auth/crypto.util";
import { OAuthProviderService } from "../oauth/oauth-provider.service";
import { UsersService } from "../users/users.service";
import {
  lockAdminsForUpdate,
  wouldRemoveLastAdmin,
} from "../users/last-admin.util";
import { EmailService } from "../notifications/email.service";
import { accountInviteTemplate } from "../notifications/email-templates";
import { CreateUserDto } from "./dto/create-user.dto";
import { toUserProfile, UserProfile } from "../users/user-profile";

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);
  private readonly BCRYPT_ROUNDS = 12;

  constructor(
    private oauthProviderService: OAuthProviderService,
    private usersService: UsersService,
    private dataSource: DataSource,
    private configService: ConfigService,
    private emailService: EmailService,
    private readonly i18n: I18nService,
  ) {}

  async findAllUsers() {
    return withSystemContext(() => this.findAllUsersWithinContext());
  }

  private async findAllUsersWithinContext() {
    // Hide owner-managed delegate identities -- users that exist solely
    // because an account owner added them via Shared Access. Those rows
    // are managed from the owner's Shared Access page. The is_delegate_only
    // column is set when createDelegate provisions a new user and cleared
    // when the user upgrades into a full account via the /register claim
    // path, so a self-registered user who happens to also be a delegate
    // still shows up here.
    const users = await withScopedDb(this.dataSource, (manager) =>
      manager.getRepository(User).find({
        where: { isDelegateOnly: false },
        order: { createdAt: "ASC" },
      }),
    );
    return users.map((user) => toUserProfile(user));
  }

  async createUser(dto: CreateUserDto) {
    return withSystemContext(() => this.createUserWithinContext(dto));
  }

  private async createUserWithinContext(dto: CreateUserDto) {
    const email = dto.email.toLowerCase().trim();
    const role = dto.role === "admin" ? "admin" : "user";

    if (dto.password && dto.sendInvite) {
      throw new BadRequestException(
        tr(
          "errors.admin.passwordOrInviteNotBoth",
          "Provide either a password or an email invite, not both.",
        ),
      );
    }
    if (dto.sendInvite && !this.emailService.getStatus().configured) {
      throw new BadRequestException(
        tr(
          "errors.admin.smtpNotConfigured",
          "SMTP is not configured. Set a password for the user instead.",
        ),
      );
    }

    let temporaryPassword: string | undefined;
    let inviteToken: string | undefined;

    const { saved, upgraded } = await withScopedDb(
      this.dataSource,
      async (manager) => {
        const existing = await manager.findOne(User, { where: { email } });

        let user: User;
        let upgraded = false;

        if (existing) {
          // Only an owner-managed "pure delegate" row (created via Shared
          // Access, owns no data of its own) may be turned into a full
          // account here. Any other existing row belongs to a real account
          // and rotating its credentials would be account takeover. The
          // is_delegate_only flag is the canonical signal for this state --
          // it is set when a delegate is provisioned and cleared the moment
          // the user upgrades into a full account.
          const claimable =
            existing.isDelegateOnly === true &&
            existing.authProvider === "local";
          if (!claimable) {
            throw new ConflictException(
              tr(
                "errors.admin.emailAlreadyExists",
                "A user with this email address already exists.",
              ),
            );
          }
          user = existing;
          upgraded = true;
          if (dto.firstName !== undefined) {
            user.firstName = dto.firstName ?? null;
          }
          if (dto.lastName !== undefined) {
            user.lastName = dto.lastName ?? null;
          }
          user.role = role;
          // Promote out of the owner-managed delegate state: the row becomes
          // a standalone account (visible in User Management, gets its own
          // "self" context) while keeping every delegation others granted it.
          user.isDelegateOnly = false;
          // Admin-created accounts are trusted (the admin vouches for the
          // email, and any invite link is delivered to it), so they bypass the
          // self-service email-verification gate.
          user.emailVerified = true;
        } else {
          user = manager.create(User, {
            email,
            firstName: dto.firstName ?? null,
            lastName: dto.lastName ?? null,
            authProvider: "local",
            role,
            isDelegateOnly: false,
            // Admin-created accounts bypass the email-verification gate.
            emailVerified: true,
          });
        }

        if (dto.sendInvite) {
          const rawToken = crypto.randomBytes(32).toString("hex");
          user.resetToken = hashToken(rawToken);
          user.resetTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
          // The invitee sets their own password via the reset link.
          user.mustChangePassword = false;
          inviteToken = rawToken;
        } else if (dto.password) {
          user.passwordHash = await bcrypt.hash(
            dto.password,
            this.BCRYPT_ROUNDS,
          );
          user.mustChangePassword = false;
          user.resetToken = null;
          user.resetTokenExpiry = null;
          user.failedLoginAttempts = 0;
          user.lockedUntil = null;
        } else {
          temporaryPassword = generateReadablePassword();
          user.passwordHash = await bcrypt.hash(
            temporaryPassword,
            this.BCRYPT_ROUNDS,
          );
          user.mustChangePassword = true;
          user.resetToken = null;
          user.resetTokenExpiry = null;
          user.failedLoginAttempts = 0;
          user.lockedUntil = null;
        }

        const saved = await manager.save(user);
        return { saved, upgraded };
      },
    );

    if (inviteToken) {
      const frontendUrl = this.configService.get<string>(
        "PUBLIC_APP_URL",
        "http://localhost:3000",
      );
      const inviteUrl = `${frontendUrl}/reset-password?token=${inviteToken}`;
      const lang = await withScopedDb(this.dataSource, (manager) =>
        resolveUserEmailLocale(manager.getRepository(UserPreference), saved.id),
      );
      const t = emailTranslator(this.i18n, lang);
      this.emailService
        .sendMail(
          email,
          t("emails.accountInvite.subject", "Your Monize account is ready"),
          accountInviteTemplate(dto.firstName || "", inviteUrl, t),
        )
        .catch((err) =>
          this.logger.warn(
            `Failed to send account invite email: ${
              err instanceof Error ? err.message : err
            }`,
          ),
        );
    }

    return {
      ...toUserProfile(saved),
      temporaryPassword,
      invited: !!inviteToken,
      upgraded,
    };
  }

  async updateUserRole(adminId: string, targetUserId: string, role: string) {
    return withSystemContext(() =>
      this.updateUserRoleWithinContext(adminId, targetUserId, role),
    );
  }

  private async updateUserRoleWithinContext(
    adminId: string,
    targetUserId: string,
    role: string,
  ) {
    if (adminId === targetUserId) {
      throw new ForbiddenException(
        tr(
          "errors.admin.cannotChangeOwnRole",
          "You cannot change your own role",
        ),
      );
    }

    // One transaction, and the admin set locked inside it: the last-admin check
    // and the demotion are a read-modify-write over the same set of rows. A
    // count would let two concurrent demotions of two *different* admins both
    // see two and both proceed, leaving nobody able to administer the instance
    // -- one transaction is not enough on its own, because neither sees the
    // other's uncommitted change.
    const saved = await withScopedDb(this.dataSource, async (manager) => {
      const repo = manager.getRepository(User);

      // Locked before the target is read, so this read also reflects a
      // concurrent role change that has since committed.
      const adminIds = await lockAdminsForUpdate(manager);

      const targetUser = await repo.findOne({
        where: { id: targetUserId },
      });
      if (!targetUser) {
        throw new NotFoundException(
          tr("errors.admin.userNotFound", "User not found"),
        );
      }

      // Prevent removing the last admin
      if (
        targetUser.role === "admin" &&
        role === "user" &&
        wouldRemoveLastAdmin(adminIds, targetUserId)
      ) {
        throw new BadRequestException(
          tr(
            "errors.admin.removeLastAdmin",
            "Cannot remove the last admin. Promote another user first.",
          ),
        );
      }

      targetUser.role = role;
      return repo.save(targetUser);
    });
    return toUserProfile(saved);
  }

  async updateUserStatus(
    adminId: string,
    targetUserId: string,
    isActive: boolean,
  ): Promise<UserProfile> {
    return withSystemContext(() =>
      this.updateUserStatusWithinContext(adminId, targetUserId, isActive),
    );
  }

  private async updateUserStatusWithinContext(
    adminId: string,
    targetUserId: string,
    isActive: boolean,
  ) {
    if (adminId === targetUserId) {
      throw new ForbiddenException(
        tr(
          "errors.admin.cannotDisableOwnAccount",
          "You cannot disable your own account",
        ),
      );
    }

    const saved = await withScopedDb(this.dataSource, async (manager) => {
      const repo = manager.getRepository(User);
      const targetUser = await repo.findOne({
        where: { id: targetUserId },
      });
      if (!targetUser) {
        throw new NotFoundException(
          tr("errors.admin.userNotFound", "User not found"),
        );
      }

      targetUser.isActive = isActive;
      return repo.save(targetUser);
    });

    // SECURITY: Revoke all refresh tokens, PATs, and OIDC artifacts when
    // deactivating a user to immediately invalidate every authenticated
    // surface — web sessions (refresh tokens), CLI/API access (PATs), and
    // MCP/OAuth clients (access + refresh tokens, authorization codes,
    // grants, sessions). Without the OIDC sweep, an MCP client could keep
    // calling tools for up to the access-token TTL even after deactivation.
    if (!isActive) {
      await this.revokeSessionsAndTokens(targetUserId);
    }

    return toUserProfile(saved);
  }

  async deleteUser(
    adminId: string,
    targetUserId: string,
  ): Promise<{ downgraded: boolean }> {
    return withSystemContext(() =>
      this.deleteUserWithinContext(adminId, targetUserId),
    );
  }

  private async deleteUserWithinContext(
    adminId: string,
    targetUserId: string,
  ): Promise<{ downgraded: boolean }> {
    if (adminId === targetUserId) {
      throw new ForbiddenException(
        tr(
          "errors.admin.cannotDeleteOwnAccount",
          "You cannot delete your own account",
        ),
      );
    }

    // Pre-flight, so an obviously refused delete does not first revoke the
    // target's sessions. The authoritative check is in the delete transaction
    // below, under the admin lock -- a guard that commits before the delete
    // starts holds nothing by the time the row is removed.
    const targetUser = await withScopedDb(this.dataSource, async (manager) => {
      const repo = manager.getRepository(User);
      const found = await repo.findOne({
        where: { id: targetUserId },
      });
      if (!found) {
        throw new NotFoundException(
          tr("errors.admin.userNotFound", "User not found"),
        );
      }

      if (
        found.role === "admin" &&
        wouldRemoveLastAdmin(await lockAdminsForUpdate(manager), targetUserId)
      ) {
        throw new BadRequestException(
          tr(
            "errors.admin.deleteLastAdmin",
            "Cannot delete the last admin account.",
          ),
        );
      }
      return found;
    });

    // Revoke sessions/PATs and sweep OIDC artifacts (forces re-login and
    // avoids orphan oauth_payloads rows) -- needed whether the account is
    // fully removed or demoted to a delegate.
    await this.revokeSessionsAndTokens(targetUserId);

    // A full account that is also a delegate of someone else is demoted to
    // a pure delegate instead of being removed: their own data goes, but
    // their login and the delegate access others granted them stay.
    if (await this.usersService.isActingDelegate(targetUserId)) {
      await this.usersService.purgeForDowngrade(targetUserId);
      return { downgraded: true };
    }

    // Clear the rows that point at the user before removing it. Databases
    // predating migration 108 can carry TypeORM-generated foreign keys with no
    // ON DELETE CASCADE, which abort the delete outright; the sessions, tokens
    // and preferences are worthless once the account is gone either way.
    // Delegate sessions acting *as* this user go too -- the owner they point
    // at is about to disappear.
    // One transaction: a partially cleared account would leave live sessions
    // pointing at a user row that is about to disappear.
    await withScopedDb(this.dataSource, async (manager) => {
      // The authoritative last-admin check: taken here, in the transaction that
      // actually removes the row, so the lock is still held when it commits.
      if (
        targetUser.role === "admin" &&
        wouldRemoveLastAdmin(await lockAdminsForUpdate(manager), targetUserId)
      ) {
        throw new BadRequestException(
          tr(
            "errors.admin.deleteLastAdmin",
            "Cannot delete the last admin account.",
          ),
        );
      }

      const refreshTokens = manager.getRepository(RefreshToken);
      await refreshTokens.delete({ userId: targetUserId });
      await refreshTokens.delete({ actingAsUserId: targetUserId });
      await manager
        .getRepository(PersonalAccessToken)
        .delete({ userId: targetUserId });
      await manager
        .getRepository(UserPreference)
        .delete({ userId: targetUserId });
      await manager.getRepository(User).remove(targetUser);
    });
    return { downgraded: false };
  }

  async resetUserPassword(
    adminId: string,
    targetUserId: string,
  ): Promise<{ temporaryPassword: string }> {
    return withSystemContext(() =>
      this.resetUserPasswordWithinContext(adminId, targetUserId),
    );
  }

  private async resetUserPasswordWithinContext(
    adminId: string,
    targetUserId: string,
  ): Promise<{ temporaryPassword: string }> {
    if (adminId === targetUserId) {
      throw new ForbiddenException(
        tr(
          "errors.admin.cannotResetOwnPassword",
          "You cannot reset your own password through the admin panel",
        ),
      );
    }

    const targetUser = await withScopedDb(this.dataSource, (manager) =>
      manager.getRepository(User).findOne({
        where: { id: targetUserId },
      }),
    );
    if (!targetUser) {
      throw new NotFoundException(
        tr("errors.admin.userNotFound", "User not found"),
      );
    }

    if (!targetUser.passwordHash) {
      throw new BadRequestException(
        tr(
          "errors.admin.noLocalPassword",
          "Cannot reset password for accounts without a local password",
        ),
      );
    }

    const temporaryPassword = generateReadablePassword();
    const saltRounds = 12;
    targetUser.passwordHash = await bcrypt.hash(temporaryPassword, saltRounds);
    targetUser.mustChangePassword = true;
    targetUser.resetToken = null;
    targetUser.resetTokenExpiry = null;
    await withScopedDb(this.dataSource, (manager) =>
      manager.getRepository(User).save(targetUser),
    );

    // SECURITY: Revoke all refresh tokens, PATs, and OIDC artifacts so the
    // forced password change applies everywhere — web, CLI/API, and MCP.
    await this.revokeSessionsAndTokens(targetUserId);

    return { temporaryPassword };
  }

  /**
   * Revoke every authenticated surface for a user: web sessions (refresh
   * tokens), CLI/API access (PATs) and MCP/OAuth clients. The two token
   * revocations share one transaction so a user can never be left half
   * revoked; the OIDC sweep runs after, as it always did.
   */
  private async revokeSessionsAndTokens(targetUserId: string): Promise<void> {
    await withScopedDb(this.dataSource, async (manager: EntityManager) => {
      await manager
        .getRepository(RefreshToken)
        .update(
          { userId: targetUserId, isRevoked: false },
          { isRevoked: true },
        );
      await manager
        .getRepository(PersonalAccessToken)
        .update(
          { userId: targetUserId, isRevoked: false },
          { isRevoked: true },
        );
    });
    await this.oauthProviderService.revokeAllForUser(targetUserId);
  }
}
