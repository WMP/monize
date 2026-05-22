import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { ConfigService } from "@nestjs/config";
import { DataSource, Repository } from "typeorm";
import * as bcrypt from "bcryptjs";
import * as crypto from "crypto";
import { User } from "../users/entities/user.entity";
import { UserPreference } from "../users/entities/user-preference.entity";
import { RefreshToken } from "../auth/entities/refresh-token.entity";
import { PersonalAccessToken } from "../auth/entities/personal-access-token.entity";
import { generateReadablePassword } from "./utils/password-generator";
import { hashToken } from "../auth/crypto.util";
import { OAuthProviderService } from "../oauth/oauth-provider.service";
import { UsersService } from "../users/users.service";
import { EmailService } from "../notifications/email.service";
import { accountInviteTemplate } from "../notifications/email-templates";
import { CreateUserDto } from "./dto/create-user.dto";

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);
  private readonly BCRYPT_ROUNDS = 12;

  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(UserPreference)
    private preferencesRepository: Repository<UserPreference>,
    @InjectRepository(RefreshToken)
    private refreshTokensRepository: Repository<RefreshToken>,
    @InjectRepository(PersonalAccessToken)
    private patRepository: Repository<PersonalAccessToken>,
    private oauthProviderService: OAuthProviderService,
    private usersService: UsersService,
    private dataSource: DataSource,
    private configService: ConfigService,
    private emailService: EmailService,
  ) {}

  async findAllUsers() {
    // Hide owner-managed delegate identities -- users that exist solely
    // because an account owner added them via Shared Access. Those rows
    // are managed from the owner's Shared Access page. The is_delegate_only
    // column is set when createDelegate provisions a new user and cleared
    // when the user upgrades into a full account via the /register claim
    // path, so a self-registered user who happens to also be a delegate
    // still shows up here.
    const users = await this.usersRepository.find({
      where: { isDelegateOnly: false },
      order: { createdAt: "ASC" },
    });
    return users.map((user) => {
      const {
        passwordHash,
        resetToken,
        resetTokenExpiry,
        twoFactorSecret,
        ...rest
      } = user;
      return { ...rest, hasPassword: !!passwordHash };
    });
  }

  private sanitizeUser(user: User) {
    const {
      passwordHash,
      resetToken,
      resetTokenExpiry,
      twoFactorSecret,
      ...rest
    } = user;
    return { ...rest, hasPassword: !!passwordHash };
  }

  async createUser(dto: CreateUserDto) {
    const email = dto.email.toLowerCase().trim();
    const role = dto.role === "admin" ? "admin" : "user";

    if (dto.password && dto.sendInvite) {
      throw new BadRequestException(
        "Provide either a password or an email invite, not both.",
      );
    }
    if (dto.sendInvite && !this.emailService.getStatus().configured) {
      throw new BadRequestException(
        "SMTP is not configured. Set a password for the user instead.",
      );
    }

    let temporaryPassword: string | undefined;
    let inviteToken: string | undefined;

    const { saved, upgraded } = await this.dataSource.transaction(
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
              "A user with this email address already exists.",
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
        } else {
          user = manager.create(User, {
            email,
            firstName: dto.firstName ?? null,
            lastName: dto.lastName ?? null,
            authProvider: "local",
            role,
            isDelegateOnly: false,
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
      this.emailService
        .sendMail(
          email,
          "Your Monize account is ready",
          accountInviteTemplate(dto.firstName || "", inviteUrl),
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
      ...this.sanitizeUser(saved),
      temporaryPassword,
      invited: !!inviteToken,
      upgraded,
    };
  }

  async updateUserRole(adminId: string, targetUserId: string, role: string) {
    if (adminId === targetUserId) {
      throw new ForbiddenException("You cannot change your own role");
    }

    const targetUser = await this.usersRepository.findOne({
      where: { id: targetUserId },
    });
    if (!targetUser) {
      throw new NotFoundException("User not found");
    }

    // Prevent removing the last admin
    if (targetUser.role === "admin" && role === "user") {
      const adminCount = await this.usersRepository.count({
        where: { role: "admin" },
      });
      if (adminCount <= 1) {
        throw new BadRequestException(
          "Cannot remove the last admin. Promote another user first.",
        );
      }
    }

    targetUser.role = role;
    const saved = await this.usersRepository.save(targetUser);
    return this.sanitizeUser(saved);
  }

  async updateUserStatus(
    adminId: string,
    targetUserId: string,
    isActive: boolean,
  ): Promise<
    Omit<
      User,
      "passwordHash" | "resetToken" | "resetTokenExpiry" | "twoFactorSecret"
    > & { hasPassword: boolean }
  > {
    if (adminId === targetUserId) {
      throw new ForbiddenException("You cannot disable your own account");
    }

    const targetUser = await this.usersRepository.findOne({
      where: { id: targetUserId },
    });
    if (!targetUser) {
      throw new NotFoundException("User not found");
    }

    targetUser.isActive = isActive;
    const saved = await this.usersRepository.save(targetUser);

    // SECURITY: Revoke all refresh tokens, PATs, and OIDC artifacts when
    // deactivating a user to immediately invalidate every authenticated
    // surface — web sessions (refresh tokens), CLI/API access (PATs), and
    // MCP/OAuth clients (access + refresh tokens, authorization codes,
    // grants, sessions). Without the OIDC sweep, an MCP client could keep
    // calling tools for up to the access-token TTL even after deactivation.
    if (!isActive) {
      await this.refreshTokensRepository.update(
        { userId: targetUserId, isRevoked: false },
        { isRevoked: true },
      );
      await this.patRepository.update(
        { userId: targetUserId, isRevoked: false },
        { isRevoked: true },
      );
      await this.oauthProviderService.revokeAllForUser(targetUserId);
    }

    return this.sanitizeUser(saved);
  }

  async deleteUser(
    adminId: string,
    targetUserId: string,
  ): Promise<{ downgraded: boolean }> {
    if (adminId === targetUserId) {
      throw new ForbiddenException("You cannot delete your own account");
    }

    const targetUser = await this.usersRepository.findOne({
      where: { id: targetUserId },
    });
    if (!targetUser) {
      throw new NotFoundException("User not found");
    }

    // Prevent deleting the last admin
    if (targetUser.role === "admin") {
      const adminCount = await this.usersRepository.count({
        where: { role: "admin" },
      });
      if (adminCount <= 1) {
        throw new BadRequestException("Cannot delete the last admin account.");
      }
    }

    // Revoke sessions/PATs and sweep OIDC artifacts (forces re-login and
    // avoids orphan oauth_payloads rows) -- needed whether the account is
    // fully removed or demoted to a delegate.
    await this.refreshTokensRepository.update(
      { userId: targetUserId, isRevoked: false },
      { isRevoked: true },
    );
    await this.patRepository.update(
      { userId: targetUserId, isRevoked: false },
      { isRevoked: true },
    );
    await this.oauthProviderService.revokeAllForUser(targetUserId);

    // A full account that is also a delegate of someone else is demoted to
    // a pure delegate instead of being removed: their own data goes, but
    // their login and the delegate access others granted them stay.
    if (await this.usersService.isActingDelegate(targetUserId)) {
      await this.usersService.purgeForDowngrade(targetUserId);
      return { downgraded: true };
    }

    // Delete preferences first (FK constraint), then the user.
    await this.preferencesRepository.delete({ userId: targetUserId });
    await this.usersRepository.remove(targetUser);
    return { downgraded: false };
  }

  async resetUserPassword(
    adminId: string,
    targetUserId: string,
  ): Promise<{ temporaryPassword: string }> {
    if (adminId === targetUserId) {
      throw new ForbiddenException(
        "You cannot reset your own password through the admin panel",
      );
    }

    const targetUser = await this.usersRepository.findOne({
      where: { id: targetUserId },
    });
    if (!targetUser) {
      throw new NotFoundException("User not found");
    }

    if (!targetUser.passwordHash) {
      throw new BadRequestException(
        "Cannot reset password for accounts without a local password",
      );
    }

    const temporaryPassword = generateReadablePassword();
    const saltRounds = 12;
    targetUser.passwordHash = await bcrypt.hash(temporaryPassword, saltRounds);
    targetUser.mustChangePassword = true;
    targetUser.resetToken = null;
    targetUser.resetTokenExpiry = null;
    await this.usersRepository.save(targetUser);

    // SECURITY: Revoke all refresh tokens, PATs, and OIDC artifacts so the
    // forced password change applies everywhere — web, CLI/API, and MCP.
    await this.refreshTokensRepository.update(
      { userId: targetUserId, isRevoked: false },
      { isRevoked: true },
    );
    await this.patRepository.update(
      { userId: targetUserId, isRevoked: false },
      { isRevoked: true },
    );
    await this.oauthProviderService.revokeAllForUser(targetUserId);

    return { temporaryPassword };
  }
}
