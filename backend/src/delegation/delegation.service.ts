import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
  ConflictException,
  Logger,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, In, DataSource } from "typeorm";
import * as bcrypt from "bcryptjs";
import * as crypto from "crypto";

import {
  AccountDelegate,
  DelegationStatus,
} from "./entities/account-delegate.entity";
import { AccountDelegateGrant } from "./entities/account-delegate-grant.entity";
import { User } from "../users/entities/user.entity";
import { UserPreference } from "../users/entities/user-preference.entity";
import { RefreshToken } from "../auth/entities/refresh-token.entity";
import { Account } from "../accounts/entities/account.entity";
import { hashToken } from "../auth/crypto.util";
import { generateReadablePassword } from "../admin/utils/password-generator";
import { EmailService } from "../notifications/email.service";
import { delegateInviteTemplate } from "../notifications/email-templates";
import { ConfigService } from "@nestjs/config";
import { CreateDelegateDto } from "./dto/create-delegate.dto";
import { AccountGrantDto } from "./dto/set-grants.dto";

export type DelegateOperation = "read" | "create" | "edit" | "delete";

/**
 * Distinct message so the frontend can route a delegate to 2FA enrollment
 * before letting them act as an owner who requires 2FA.
 */
export const DELEGATE_2FA_REQUIRED = "DELEGATE_2FA_REQUIRED";

export interface AvailableContext {
  userId: string;
  label: string;
  isSelf: boolean;
  ownerHas2FA: boolean;
}

@Injectable()
export class DelegationService {
  private readonly logger = new Logger(DelegationService.name);
  private readonly BCRYPT_ROUNDS = 12;

  constructor(
    @InjectRepository(AccountDelegate)
    private delegatesRepository: Repository<AccountDelegate>,
    @InjectRepository(AccountDelegateGrant)
    private grantsRepository: Repository<AccountDelegateGrant>,
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(UserPreference)
    private preferencesRepository: Repository<UserPreference>,
    @InjectRepository(RefreshToken)
    private refreshTokensRepository: Repository<RefreshToken>,
    @InjectRepository(Account)
    private accountsRepository: Repository<Account>,
    private emailService: EmailService,
    private configService: ConfigService,
    private dataSource: DataSource,
  ) {}

  // --- Context resolution (used by JwtStrategy and the guard) ---

  /**
   * Validate that `delegateUserId` may currently act as `actingAsUserId` via
   * `delegationId`. Throws (fail closed) on any mismatch, revoked/inactive
   * delegation, inactive owner, or unmet 2FA requirement.
   */
  async validateActingContext(args: {
    delegateUserId: string;
    actingAsUserId: string;
    delegationId: string;
  }): Promise<AccountDelegate> {
    const { delegateUserId, actingAsUserId, delegationId } = args;

    const delegation = await this.delegatesRepository.findOne({
      where: { id: delegationId },
    });

    if (
      !delegation ||
      delegation.status !== "active" ||
      delegation.delegateUserId !== delegateUserId ||
      delegation.ownerUserId !== actingAsUserId
    ) {
      throw new UnauthorizedException("Delegated access is no longer valid");
    }

    const owner = await this.usersRepository.findOne({
      where: { id: actingAsUserId },
    });
    if (!owner || !owner.isActive) {
      throw new UnauthorizedException("Delegated access is no longer valid");
    }

    if (await this.delegateMustEnrollOwn2FA(actingAsUserId, delegateUserId)) {
      throw new UnauthorizedException(DELEGATE_2FA_REQUIRED);
    }

    return delegation;
  }

  /**
   * True when the owner requires 2FA but the delegate has not enrolled their
   * own 2FA. (TOTP secrets are per-user and never shared.)
   */
  async delegateMustEnrollOwn2FA(
    ownerUserId: string,
    delegateUserId: string,
  ): Promise<boolean> {
    const [owner, ownerPref] = await Promise.all([
      this.usersRepository.findOne({ where: { id: ownerUserId } }),
      this.preferencesRepository.findOne({ where: { userId: ownerUserId } }),
    ]);
    const ownerRequires2FA = !!(
      ownerPref?.twoFactorEnabled && owner?.twoFactorSecret
    );
    if (!ownerRequires2FA) return false;

    const [delegate, delegatePref] = await Promise.all([
      this.usersRepository.findOne({ where: { id: delegateUserId } }),
      this.preferencesRepository.findOne({ where: { userId: delegateUserId } }),
    ]);
    const delegateHas2FA = !!(
      delegatePref?.twoFactorEnabled && delegate?.twoFactorSecret
    );
    return !delegateHas2FA;
  }

  /** True if the user is a delegate for at least one owner. */
  async isDelegateUser(userId: string): Promise<boolean> {
    const count = await this.delegatesRepository.count({
      where: { delegateUserId: userId },
    });
    return count > 0;
  }

  async hasReadAccess(
    delegationId: string,
    accountId: string,
  ): Promise<boolean> {
    const grant = await this.grantsRepository.findOne({
      where: { delegationId, accountId, canRead: true },
    });
    return !!grant;
  }

  async readableAccountIds(delegationId: string): Promise<string[]> {
    const grants = await this.grantsRepository.find({
      where: { delegationId, canRead: true },
      select: ["accountId"],
    });
    return grants.map((g) => g.accountId);
  }

  // --- Login / switch context ---

  /**
   * Contexts the authenticated user can operate in. Returns an empty array
   * for a normal user with no delegations (so login behaviour is unchanged).
   */
  async getAvailableContexts(userId: string): Promise<AvailableContext[]> {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) return [];

    const delegations = await this.delegatesRepository.find({
      where: { delegateUserId: user.id, status: "active" },
      relations: ["owner"],
    });

    if (delegations.length === 0) return [];

    const ownsData = await this.accountsRepository.exists({
      where: { userId: user.id },
    });

    const contexts: AvailableContext[] = [];
    if (ownsData) {
      contexts.push({
        userId: user.id,
        label: this.userLabel(user),
        isSelf: true,
        ownerHas2FA: false,
      });
    }

    for (const d of delegations) {
      contexts.push({
        userId: d.ownerUserId,
        label: d.owner ? this.userLabel(d.owner) : d.ownerUserId,
        isSelf: false,
        ownerHas2FA: await this.delegateMustEnrollOwn2FA(
          d.ownerUserId,
          user.id,
        ),
      });
    }
    return contexts;
  }

  /**
   * Resolve a target context for /auth/switch-context. Returns null context
   * for "self"; otherwise the validated active delegation.
   */
  async resolveSwitchTarget(
    delegateUserId: string,
    targetUserId: string,
  ): Promise<AccountDelegate | null> {
    if (targetUserId === delegateUserId) {
      return null;
    }
    const delegation = await this.delegatesRepository.findOne({
      where: {
        delegateUserId,
        ownerUserId: targetUserId,
        status: "active",
      },
    });
    if (!delegation) {
      throw new ForbiddenException("No active delegation for that account");
    }
    if (await this.delegateMustEnrollOwn2FA(targetUserId, delegateUserId)) {
      throw new ForbiddenException(DELEGATE_2FA_REQUIRED);
    }
    return delegation;
  }

  private userLabel(user: User): string {
    const name = [user.firstName, user.lastName].filter(Boolean).join(" ");
    return name || user.email || user.id;
  }

  // --- Owner-facing management ---

  async listDelegates(ownerUserId: string) {
    const delegations = await this.delegatesRepository.find({
      where: {
        ownerUserId,
        status: In(["active", "pending"] as DelegationStatus[]),
      },
      relations: ["delegate", "grants"],
      order: { createdAt: "DESC" },
    });
    return delegations.map((d) => ({
      id: d.id,
      status: d.status,
      createdAt: d.createdAt,
      delegate: {
        id: d.delegateUserId,
        email: d.delegate?.email ?? null,
        firstName: d.delegate?.firstName ?? null,
        lastName: d.delegate?.lastName ?? null,
        hasPassword: !!d.delegate?.passwordHash,
      },
      grants: (d.grants ?? [])
        .filter((g) => g.canRead)
        .map((g) => ({
          accountId: g.accountId,
          canRead: g.canRead,
          canCreate: g.canCreate,
          canEdit: g.canEdit,
          canDelete: g.canDelete,
        })),
    }));
  }

  /**
   * Whether the delegation grants `operation` on `accountId`. READ is implied
   * by any stored grant (rows are only written when canRead is true).
   */
  async hasAccountPermission(
    delegationId: string,
    accountId: string,
    operation: DelegateOperation,
  ): Promise<boolean> {
    const grant = await this.grantsRepository.findOne({
      where: { delegationId, accountId, canRead: true },
    });
    if (!grant) return false;
    switch (operation) {
      case "read":
        return true;
      case "create":
        return grant.canCreate;
      case "edit":
        return grant.canEdit;
      case "delete":
        return grant.canDelete;
    }
  }

  async createDelegate(ownerUserId: string, dto: CreateDelegateDto) {
    const email = dto.email.toLowerCase().trim();

    const owner = await this.usersRepository.findOne({
      where: { id: ownerUserId },
    });
    if (!owner) throw new NotFoundException("User not found");
    if (owner.email && owner.email.toLowerCase().trim() === email) {
      throw new BadRequestException("You cannot delegate access to yourself");
    }

    let temporaryPassword: string | undefined;
    let inviteToken: string | undefined;

    return this.dataSource.transaction(async (manager) => {
      let delegateUser = await manager.findOne(User, { where: { email } });

      if (!delegateUser) {
        const newUser = manager.create(User, {
          email,
          firstName: dto.firstName ?? null,
          lastName: dto.lastName ?? null,
          authProvider: "local",
          role: "user",
        });

        if (dto.sendInvite) {
          if (!this.emailService.getStatus().configured) {
            throw new BadRequestException(
              "SMTP is not configured. Set a password for the delegate instead.",
            );
          }
          const rawToken = crypto.randomBytes(32).toString("hex");
          newUser.resetToken = hashToken(rawToken);
          newUser.resetTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
          // The invitee sets their own password via the reset link, so they
          // are NOT forced to change it again on first login.
          inviteToken = rawToken;
        } else if (dto.password) {
          newUser.passwordHash = await bcrypt.hash(
            dto.password,
            this.BCRYPT_ROUNDS,
          );
        } else {
          temporaryPassword = generateReadablePassword();
          newUser.passwordHash = await bcrypt.hash(
            temporaryPassword,
            this.BCRYPT_ROUNDS,
          );
          newUser.mustChangePassword = true;
        }

        delegateUser = await manager.save(newUser);
      } else if (delegateUser.id === ownerUserId) {
        throw new BadRequestException("You cannot delegate access to yourself");
      }

      if (!delegateUser) {
        throw new BadRequestException("Unable to create delegate");
      }

      let delegation = await manager.findOne(AccountDelegate, {
        where: { ownerUserId, delegateUserId: delegateUser.id },
      });
      if (delegation) {
        if (delegation.status === "active") {
          throw new ConflictException(
            "That user is already a delegate for your account",
          );
        }
        delegation.status = "active";
        delegation.revokedAt = null;
      } else {
        delegation = manager.create(AccountDelegate, {
          ownerUserId,
          delegateUserId: delegateUser.id,
          status: "active",
        });
      }
      delegation = await manager.save(delegation);

      if (inviteToken) {
        const frontendUrl = this.configService.get<string>(
          "PUBLIC_APP_URL",
          "http://localhost:3000",
        );
        const inviteUrl = `${frontendUrl}/reset-password?token=${inviteToken}`;
        this.emailService
          .sendMail(
            email,
            "You have been invited to Monize",
            delegateInviteTemplate(
              dto.firstName || "",
              this.userLabel(owner),
              inviteUrl,
            ),
          )
          .catch((err) =>
            this.logger.warn(
              `Failed to send delegate invite email: ${
                err instanceof Error ? err.message : err
              }`,
            ),
          );
      }

      return {
        id: delegation.id,
        delegateUserId: delegateUser.id,
        email,
        temporaryPassword,
        invited: !!inviteToken,
      };
    });
  }

  async revokeDelegate(
    ownerUserId: string,
    delegationId: string,
  ): Promise<void> {
    const delegation = await this.delegatesRepository.findOne({
      where: { id: delegationId, ownerUserId },
    });
    if (!delegation) {
      throw new NotFoundException("Delegate not found");
    }
    const delegateUserId = delegation.delegateUserId;

    await this.dataSource.transaction(async (manager) => {
      // Hard-delete the delegation. FK cascades remove its grants and any
      // refresh tokens scoped to it, so live delegate sessions acting via
      // this delegation are immediately invalidated.
      await manager.delete(AccountDelegate, { id: delegationId });

      // Entirely remove the delegate's login unless it has another reason to
      // exist: a delegation elsewhere, its own data, it owns a delegation, or
      // it is an admin (i.e. it is a full user in its own right).
      const [otherDelegations, ownsAccounts, ownsDelegations] =
        await Promise.all([
          manager.count(AccountDelegate, { where: { delegateUserId } }),
          manager.count(Account, { where: { userId: delegateUserId } }),
          manager.count(AccountDelegate, {
            where: { ownerUserId: delegateUserId },
          }),
        ]);
      const delegateUser = await manager.findOne(User, {
        where: { id: delegateUserId },
      });

      if (
        otherDelegations === 0 &&
        ownsAccounts === 0 &&
        ownsDelegations === 0 &&
        delegateUser?.role !== "admin"
      ) {
        // FK ON DELETE CASCADE cleans preferences, tokens, trusted devices.
        await manager.delete(User, { id: delegateUserId });
      }
    });
  }

  async setGrants(
    ownerUserId: string,
    delegationId: string,
    grants: AccountGrantDto[],
  ): Promise<void> {
    const delegation = await this.delegatesRepository.findOne({
      where: { id: delegationId, ownerUserId },
    });
    if (!delegation) {
      throw new NotFoundException("Delegate not found");
    }

    // READ is the minimum and a prerequisite for CREATE/EDIT/DELETE.
    for (const g of grants) {
      if (!g.canRead && (g.canCreate || g.canEdit || g.canDelete)) {
        throw new BadRequestException(
          "READ access is required for CREATE, EDIT or DELETE",
        );
      }
    }

    // Only grants that include READ represent actual access.
    const readable = grants.filter((g) => g.canRead);
    const accountIds = readable.map((g) => g.accountId);

    if (accountIds.length > 0) {
      const owned = await this.accountsRepository.find({
        where: { id: In(accountIds), userId: ownerUserId },
        select: ["id"],
      });
      if (owned.length !== accountIds.length) {
        throw new ForbiddenException(
          "One or more accounts do not belong to you",
        );
      }
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.delete(AccountDelegateGrant, { delegationId });
      if (readable.length > 0) {
        const rows = readable.map((g) =>
          manager.create(AccountDelegateGrant, {
            delegationId,
            accountId: g.accountId,
            canRead: true,
            canCreate: !!g.canCreate,
            canEdit: !!g.canEdit,
            canDelete: !!g.canDelete,
          }),
        );
        await manager.save(rows);
      }
    });
  }

  async resetDelegatePassword(
    ownerUserId: string,
    delegationId: string,
  ): Promise<{ temporaryPassword: string }> {
    const delegation = await this.delegatesRepository.findOne({
      where: { id: delegationId, ownerUserId, status: "active" },
    });
    if (!delegation) {
      throw new NotFoundException("Delegate not found");
    }

    const delegate = await this.usersRepository.findOne({
      where: { id: delegation.delegateUserId },
    });
    if (!delegate) {
      throw new NotFoundException("Delegate not found");
    }
    if (delegate.oidcSubject) {
      throw new BadRequestException(
        "Cannot reset password for an SSO delegate account",
      );
    }

    const temporaryPassword = generateReadablePassword();
    delegate.passwordHash = await bcrypt.hash(
      temporaryPassword,
      this.BCRYPT_ROUNDS,
    );
    delegate.mustChangePassword = true;
    delegate.resetToken = null;
    delegate.resetTokenExpiry = null;
    await this.usersRepository.save(delegate);

    await this.refreshTokensRepository.update(
      { userId: delegate.id, isRevoked: false },
      { isRevoked: true },
    );

    return { temporaryPassword };
  }
}
