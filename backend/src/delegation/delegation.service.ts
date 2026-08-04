import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
  ConflictException,
  Logger,
} from "@nestjs/common";
import {
  Repository,
  In,
  Not,
  DataSource,
  EntityTarget,
  ObjectLiteral,
} from "typeorm";
import { withScopedDb } from "../common/db/scoped-db";
import * as bcrypt from "bcryptjs";
import * as crypto from "crypto";

import {
  AccountDelegate,
  DelegationStatus,
} from "./entities/account-delegate.entity";
import { AccountDelegateGrant } from "./entities/account-delegate-grant.entity";
import { DelegateAccountFavourite } from "./entities/delegate-account-favourite.entity";
import { User } from "../users/entities/user.entity";
import { UserPreference } from "../users/entities/user-preference.entity";
import { RefreshToken } from "../auth/entities/refresh-token.entity";
import { Account, AccountType } from "../accounts/entities/account.entity";
import { Transaction } from "../transactions/entities/transaction.entity";
import { ScheduledTransaction } from "../scheduled-transactions/entities/scheduled-transaction.entity";
import { hashToken } from "../auth/crypto.util";
import { generateReadablePassword } from "../admin/utils/password-generator";
import { I18nService } from "nestjs-i18n";
import { tr } from "../i18n/translate";
import { emailTranslator } from "../i18n/email-translator";
import { resolveUserEmailLocale } from "../i18n/resolve-user-email-locale";
import { EmailService } from "../notifications/email.service";
import { delegateInviteTemplate } from "../notifications/email-templates";
import { ConfigService } from "@nestjs/config";
import { CreateDelegateDto } from "./dto/create-delegate.dto";
import { AccountGrantDto } from "./dto/set-grants.dto";
import {
  DelegateResource,
  DelegateCapabilityOp,
  DelegateSection,
} from "./decorators/delegate-access.decorator";

export interface ResourceCapabilities {
  create: boolean;
  edit: boolean;
  delete: boolean;
}
export interface DelegateCapabilitySet {
  payees: ResourceCapabilities;
  categories: ResourceCapabilities;
  tags: ResourceCapabilities;
}

export interface DelegateSectionSet {
  bills: boolean;
  investments: boolean;
  budgets: boolean;
  reports: boolean;
  ai: boolean;
}

const SECTION_FIELD: Record<DelegateSection, keyof AccountDelegate> = {
  bills: "billsCanRead",
  investments: "investmentsCanRead",
  budgets: "budgetsCanRead",
  reports: "reportsCanRead",
  ai: "aiCanRead",
};

/**
 * Every boolean on a delegation that makes the owner's context worth entering:
 * the section reads, and the reference-data manage capabilities that put a
 * Tools entry in the delegate's nav. Both are derived rather than listed --
 * SECTION_FIELDS from the SECTION_FIELD map, CAPABILITY_FIELDS from the
 * resource x operation product the entity's columns already follow -- so a new
 * grantable flag cannot be missed by the joint-only check.
 */
const SECTION_FIELDS: ReadonlyArray<keyof AccountDelegate> =
  Object.values(SECTION_FIELD);

const CAPABILITY_FIELDS: ReadonlyArray<keyof AccountDelegate> = (
  ["payees", "categories", "tags"] as const
).flatMap((resource) =>
  (["Create", "Edit", "Delete"] as const).map(
    (op) => `${resource}Can${op}` as keyof AccountDelegate,
  ),
);

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
    private emailService: EmailService,
    private configService: ConfigService,
    private dataSource: DataSource,
    private readonly i18n: I18nService,
  ) {}

  /**
   * One repository call in its own short scoped transaction -- the RLS-era
   * equivalent of the injected repositories this service used to hold, with the
   * same autocommit boundary each of those calls had. Multi-statement units
   * (favourite upsert, reorder, the delegate-provisioning flow) use an explicit
   * `withScopedDb` block instead so their statements share one transaction.
   */
  private scoped<E extends ObjectLiteral, T>(
    entity: EntityTarget<E>,
    fn: (repo: Repository<E>) => Promise<T>,
  ): Promise<T> {
    return withScopedDb(this.dataSource, (manager) =>
      fn(manager.getRepository(entity)),
    );
  }

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

    const delegation = await this.scoped(AccountDelegate, (repo) =>
      repo.findOne({
        where: { id: delegationId },
      }),
    );

    if (
      !delegation ||
      delegation.status !== "active" ||
      delegation.delegateUserId !== delegateUserId ||
      delegation.ownerUserId !== actingAsUserId
    ) {
      throw new UnauthorizedException(
        tr(
          "errors.delegation.delegatedAccessInvalid",
          "Delegated access is no longer valid",
        ),
      );
    }

    const owner = await this.scoped(User, (repo) =>
      repo.findOne({
        where: { id: actingAsUserId },
      }),
    );
    if (!owner || !owner.isActive) {
      throw new UnauthorizedException(
        tr(
          "errors.delegation.delegatedAccessInvalid",
          "Delegated access is no longer valid",
        ),
      );
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
      this.scoped(User, (repo) => repo.findOne({ where: { id: ownerUserId } })),
      this.scoped(UserPreference, (repo) =>
        repo.findOne({ where: { userId: ownerUserId } }),
      ),
    ]);
    const ownerRequires2FA = !!(
      ownerPref?.twoFactorEnabled && owner?.twoFactorSecret
    );
    if (!ownerRequires2FA) return false;

    const [delegate, delegatePref] = await Promise.all([
      this.scoped(User, (repo) =>
        repo.findOne({ where: { id: delegateUserId } }),
      ),
      this.scoped(UserPreference, (repo) =>
        repo.findOne({ where: { userId: delegateUserId } }),
      ),
    ]);
    const delegateHas2FA = !!(
      delegatePref?.twoFactorEnabled && delegate?.twoFactorSecret
    );
    return !delegateHas2FA;
  }

  /** True if the user is a delegate for at least one owner. */
  async isDelegateUser(userId: string): Promise<boolean> {
    const count = await this.scoped(AccountDelegate, (repo) =>
      repo.count({
        where: { delegateUserId: userId },
      }),
    );
    return count > 0;
  }

  async hasReadAccess(
    delegationId: string,
    accountId: string,
  ): Promise<boolean> {
    const grant = await this.scoped(AccountDelegateGrant, (repo) =>
      repo.findOne({
        where: { delegationId, accountId, canRead: true },
      }),
    );
    return !!grant;
  }

  /** The account a transaction belongs to, or null if it does not exist. */
  async accountIdForTransaction(transactionId: string): Promise<string | null> {
    const tx = await this.scoped(Transaction, (repo) =>
      repo.findOne({
        where: { id: transactionId },
        select: ["accountId"],
      }),
    );
    return tx?.accountId ?? null;
  }

  /**
   * Both account ids involved in a transfer identified by either leg's
   * transaction id (this leg + the linked leg). Empty if the transaction
   * does not exist.
   */
  async accountIdsForTransfer(transactionId: string): Promise<string[]> {
    // Both legs from one snapshot: the guard gates a write on holding the
    // permission for every account the transfer touches, so reading the second
    // leg from a later snapshot could miss an account that just moved.
    return withScopedDb(this.dataSource, async (manager) => {
      const repo = manager.getRepository(Transaction);
      const tx = await repo.findOne({
        where: { id: transactionId },
        select: ["accountId", "linkedTransactionId"],
      });
      if (!tx) return [];
      const ids = new Set<string>([tx.accountId]);
      const linkedId = tx.linkedTransactionId;
      if (linkedId) {
        const linked = await repo.findOne({
          where: { id: linkedId },
          select: ["accountId"],
        });
        if (linked) ids.add(linked.accountId);
      }
      return [...ids];
    });
  }

  /**
   * Every account a scheduled transaction touches: its own account plus the
   * transfer counterpart when it is a transfer. Empty if the row does not
   * exist (the owner-scoped service then returns 404).
   */
  async accountIdsForScheduled(scheduledId: string): Promise<string[]> {
    const st = await this.scoped(ScheduledTransaction, (repo) =>
      repo.findOne({
        where: { id: scheduledId },
        select: ["accountId", "transferAccountId", "isTransfer"],
      }),
    );
    if (!st) return [];
    const ids = new Set<string>([st.accountId]);
    if (st.isTransfer && st.transferAccountId) {
      ids.add(st.transferAccountId);
    }
    return [...ids];
  }

  async readableAccountIds(delegationId: string): Promise<string[]> {
    const grants = await this.scoped(AccountDelegateGrant, (repo) =>
      repo.find({
        where: { delegationId, canRead: true },
        select: ["accountId"],
      }),
    );
    return grants.map((g) => g.accountId);
  }

  /**
   * Whether the delegate can READ at least one account whose activity shows
   * in the Transactions section (i.e. any non-investment account they were
   * granted). Drives the delegate Transactions nav/route visibility.
   */
  async hasTransactionalAccess(delegationId: string): Promise<boolean> {
    const readable = await this.readableAccountIds(delegationId);
    if (readable.length === 0) return false;
    const count = await this.scoped(Account, (repo) =>
      repo.count({
        where: { id: In(readable), accountType: Not(AccountType.INVESTMENT) },
      }),
    );
    return count > 0;
  }

  /**
   * Whether the delegate can READ at least one account at all. Drives the
   * delegate Accounts nav/route visibility (any granted account, including
   * investment accounts, makes the Accounts section reachable).
   */
  async hasAnyAccountAccess(delegationId: string): Promise<boolean> {
    const count = await this.scoped(AccountDelegateGrant, (repo) =>
      repo.count({
        where: { delegationId, canRead: true },
      }),
    );
    return count > 0;
  }

  // --- Delegate's own (non-shared) account favourites ---

  /** Map of accountId -> sortOrder for the delegate's own favourites. */
  async getDelegateFavourites(
    delegateUserId: string,
  ): Promise<Map<string, number>> {
    const rows = await this.scoped(DelegateAccountFavourite, (repo) =>
      repo.find({
        where: { delegateUserId },
        select: ["accountId", "sortOrder"],
      }),
    );
    return new Map(rows.map((r) => [r.accountId, r.sortOrder]));
  }

  /** Add or remove an account from the delegate's own favourites. */
  async setDelegateFavourite(
    delegateUserId: string,
    accountId: string,
    isFavourite: boolean,
  ): Promise<void> {
    await withScopedDb(this.dataSource, async (manager) => {
      const repo = manager.getRepository(DelegateAccountFavourite);
      if (!isFavourite) {
        await repo.delete({
          delegateUserId,
          accountId,
        });
        return;
      }
      // Read-modify-write: the existence check and the insert are one unit.
      const existing = await repo.findOne({
        where: { delegateUserId, accountId },
      });
      if (existing) return;
      await repo.save(
        repo.create({
          delegateUserId,
          accountId,
          sortOrder: 0,
        }),
      );
    });
  }

  /**
   * Set the delegate's favourite display order. The position of each id in
   * `accountIds` becomes its sort order; ids that are not favourites are
   * ignored.
   */
  async reorderDelegateFavourites(
    delegateUserId: string,
    accountIds: string[],
  ): Promise<void> {
    // Defensive: reject anything that isn't a proper array. An attacker
    // could submit {length: 1e100} and force an unbounded loop (CWE-834).
    // The DTO layer already validates this via @IsArray + @ArrayMaxSize, but
    // re-check here so the invariant holds for any caller.
    if (!Array.isArray(accountIds)) {
      throw new BadRequestException(
        tr(
          "errors.delegation.accountIdsMustBeArray",
          "accountIds must be an array",
        ),
      );
    }
    // One transaction around the whole reorder, as the QueryRunner block was:
    // a partially applied order would leave duplicate sort positions.
    await withScopedDb(this.dataSource, async (manager) => {
      // for...of over .entries(), never `i < accountIds.length`: a request
      // value's .length must not bound a loop inside this closure (CWE-834,
      // CodeQL js/loop-bound-injection cannot see the isArray guard above
      // through the withScopedDb callback).
      for (const [i, accountId] of accountIds.entries()) {
        await manager.update(
          DelegateAccountFavourite,
          { delegateUserId, accountId },
          { sortOrder: i },
        );
      }
    });
  }

  // --- Login / switch context ---

  /**
   * Whether switching into this delegation's owner context would show the
   * grantee anything they do not already have natively. A purely joint share
   * offers nothing: every readable account already appears in the grantee's
   * own context, no whole-section read was granted, and no reference-data
   * manage capability was granted -- so the owner context is dropped from the
   * switcher rather than offering a switch between two views of the same
   * accounts. A grant that is readable but not joint, any section, or any
   * manage capability makes the context reachable only by switching, so it
   * stays.
   *
   * A delegation with nothing readable yet (freshly invited, grants not
   * assigned) is NOT joint-only: it has no joint share to stand in for the
   * context, and hiding it would leave the delegate unable to switch in at
   * all once the owner grants something.
   */
  private isJointOnlyDelegation(
    delegation: AccountDelegate,
    grants: AccountDelegateGrant[],
  ): boolean {
    if (SECTION_FIELDS.some((f) => !!delegation[f])) return false;
    if (CAPABILITY_FIELDS.some((f) => !!delegation[f])) return false;
    const readable = grants.filter((g) => g.canRead);
    return readable.length > 0 && readable.every((g) => g.isJoint);
  }

  /**
   * Contexts the authenticated user can operate in. Returns an empty array
   * for a normal user with no delegations (so login behaviour is unchanged).
   *
   * `actingAsUserId` is the owner the caller is currently acting as, if any.
   * Its context is never filtered out: a switcher that hides the context the
   * user is standing in is a one-way door, and the way back to their own
   * account is the switcher.
   */
  async getAvailableContexts(
    userId: string,
    actingAsUserId?: string | null,
  ): Promise<AvailableContext[]> {
    const user = await this.scoped(User, (repo) =>
      repo.findOne({ where: { id: userId } }),
    );
    if (!user) return [];

    const allDelegations = await this.scoped(AccountDelegate, (repo) =>
      repo.find({
        where: { delegateUserId: user.id, status: "active" },
        relations: ["owner"],
      }),
    );

    if (allDelegations.length === 0) return [];

    // Drop the owner contexts that are purely joint shares: those accounts are
    // already in the grantee's own context, so offering a switch to them
    // presents a chooser whose two sides show the same thing.
    const grantsByDelegation = await this.scoped(AccountDelegateGrant, (repo) =>
      repo.find({
        where: { delegationId: In(allDelegations.map((d) => d.id)) },
      }),
    );
    const delegations = allDelegations.filter(
      (d) =>
        d.ownerUserId === actingAsUserId ||
        !this.isJointOnlyDelegation(
          d,
          grantsByDelegation.filter((g) => g.delegationId === d.id),
        ),
    );

    if (delegations.length === 0) return [];

    // A user gets a "self" context whenever the row represents a real
    // account in their own right -- they own data, or they claimed /
    // self-registered (isDelegateOnly=false). A pure delegate identity
    // (created via Shared Access, never claimed) deliberately has no
    // self context so the front end auto-picks the owner on first
    // login. Without this, a freshly-claimed delegate who has not yet
    // created any accounts would have only the owner's context and the
    // banner would never appear.
    const ownsData = await this.scoped(Account, (repo) =>
      repo.exists({
        where: { userId: user.id },
      }),
    );

    const contexts: AvailableContext[] = [];
    if (ownsData || !user.isDelegateOnly) {
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
    const delegation = await this.scoped(AccountDelegate, (repo) =>
      repo.findOne({
        where: {
          delegateUserId,
          ownerUserId: targetUserId,
          status: "active",
        },
      }),
    );
    if (!delegation) {
      throw new ForbiddenException(
        tr(
          "errors.delegation.noActiveDelegation",
          "No active delegation for that account",
        ),
      );
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

  /**
   * A delegate is a "full account" -- a real user in their own right --
   * when they own data, are an owner of their own delegations, or are an
   * admin. Owners must not be able to reset such a user's password (it is
   * that person's own login, not an owner-provisioned credential).
   */
  async isFullAccount(userId: string): Promise<boolean> {
    const [ownsAccounts, ownsDelegations, user] = await Promise.all([
      this.scoped(Account, (repo) => repo.count({ where: { userId } })),
      this.scoped(AccountDelegate, (repo) =>
        repo.count({ where: { ownerUserId: userId } }),
      ),
      this.scoped(User, (repo) =>
        repo.findOne({
          where: { id: userId },
          select: ["id", "role"],
        }),
      ),
    ]);
    return ownsAccounts > 0 || ownsDelegations > 0 || user?.role === "admin";
  }

  /**
   * An owner may reset a delegate's password only when that password is an
   * owner-provisioned credential used solely for this relationship: the
   * delegate is not a full account in their own right AND is not also a
   * delegate for any other owner. Otherwise the password belongs to the
   * person, not the owner, so only they may change it.
   *
   * "Full account" includes a delegate that has gone through the
   * /register claim path (isDelegateOnly=false) but has not yet created
   * any data of their own -- their login is theirs, not the owner's,
   * even with zero accounts under their name.
   */
  async canOwnerResetDelegatePassword(
    delegateUserId: string,
  ): Promise<boolean> {
    const user = await this.scoped(User, (repo) =>
      repo.findOne({
        where: { id: delegateUserId },
        select: ["id", "isDelegateOnly"],
      }),
    );
    if (!user || !user.isDelegateOnly) return false;
    if (await this.isFullAccount(delegateUserId)) return false;
    const delegationCount = await this.scoped(AccountDelegate, (repo) =>
      repo.count({
        where: { delegateUserId },
      }),
    );
    return delegationCount <= 1;
  }

  async listDelegates(ownerUserId: string) {
    const delegations = await this.scoped(AccountDelegate, (repo) =>
      repo.find({
        where: {
          ownerUserId,
          status: In(["active", "pending"] as DelegationStatus[]),
        },
        relations: ["delegate", "grants"],
        order: { createdAt: "DESC" },
      }),
    );
    return Promise.all(
      delegations.map(async (d) => ({
        id: d.id,
        status: d.status,
        createdAt: d.createdAt,
        delegate: {
          id: d.delegateUserId,
          email: d.delegate?.email ?? null,
          firstName: d.delegate?.firstName ?? null,
          lastName: d.delegate?.lastName ?? null,
          hasPassword: !!d.delegate?.passwordHash,
          // False when the password is the delegate's own (full account or
          // a delegate elsewhere); the owner cannot reset it.
          canResetPassword: await this.canOwnerResetDelegatePassword(
            d.delegateUserId,
          ),
          // Gates the Joint toggle client-side; setGrants re-checks.
          isFullAccount: await this.isFullAccount(d.delegateUserId),
        },
        // isJoint must round-trip: setGrants is delete-and-recreate, so a
        // client saving a matrix without it would silently clear the flag.
        grants: (d.grants ?? [])
          .filter((g) => g.canRead)
          .map((g) => ({
            accountId: g.accountId,
            canRead: g.canRead,
            canCreate: g.canCreate,
            canEdit: g.canEdit,
            canDelete: g.canDelete,
            isJoint: g.isJoint,
          })),
        capabilities: this.toCapabilitySet(d),
        sections: this.toSectionSet(d),
      })),
    );
  }

  private toSectionSet(d?: AccountDelegate | null): DelegateSectionSet {
    return {
      bills: !!d?.billsCanRead,
      investments: !!d?.investmentsCanRead,
      budgets: !!d?.budgetsCanRead,
      reports: !!d?.reportsCanRead,
      ai: !!d?.aiCanRead,
    };
  }

  private toCapabilitySet(d?: AccountDelegate | null): DelegateCapabilitySet {
    return {
      payees: {
        create: !!d?.payeesCanCreate,
        edit: !!d?.payeesCanEdit,
        delete: !!d?.payeesCanDelete,
      },
      categories: {
        create: !!d?.categoriesCanCreate,
        edit: !!d?.categoriesCanEdit,
        delete: !!d?.categoriesCanDelete,
      },
      tags: {
        create: !!d?.tagsCanCreate,
        edit: !!d?.tagsCanEdit,
        delete: !!d?.tagsCanDelete,
      },
    };
  }

  /** Whether the delegation may perform `operation` on `resource`. */
  async hasCapability(
    delegationId: string,
    resource: DelegateResource,
    operation: DelegateCapabilityOp,
  ): Promise<boolean> {
    const delegation = await this.scoped(AccountDelegate, (repo) =>
      repo.findOne({
        where: { id: delegationId, status: "active" },
      }),
    );
    if (!delegation) return false;
    const opKey =
      operation === "create"
        ? "Create"
        : operation === "edit"
          ? "Edit"
          : "Delete";
    const field = `${resource}Can${opKey}` as keyof AccountDelegate;
    return !!delegation[field];
  }

  /** All granular capabilities for an active delegation (all false if none). */
  async getCapabilities(delegationId: string): Promise<DelegateCapabilitySet> {
    const delegation = await this.scoped(AccountDelegate, (repo) =>
      repo.findOne({
        where: { id: delegationId, status: "active" },
      }),
    );
    return this.toCapabilitySet(delegation);
  }

  /** Whether the active delegation was granted READ on `section`. */
  async hasSection(
    delegationId: string,
    section: DelegateSection,
  ): Promise<boolean> {
    const delegation = await this.scoped(AccountDelegate, (repo) =>
      repo.findOne({
        where: { id: delegationId, status: "active" },
      }),
    );
    if (!delegation) return false;
    return !!delegation[SECTION_FIELD[section]];
  }

  /** All section grants for an active delegation (all false if none). */
  async getSections(delegationId: string): Promise<DelegateSectionSet> {
    const delegation = await this.scoped(AccountDelegate, (repo) =>
      repo.findOne({
        where: { id: delegationId, status: "active" },
      }),
    );
    return this.toSectionSet(delegation);
  }

  async setSectionGrants(
    ownerUserId: string,
    delegationId: string,
    sections: Partial<
      Record<
        | "billsCanRead"
        | "investmentsCanRead"
        | "budgetsCanRead"
        | "reportsCanRead"
        | "aiCanRead",
        boolean
      >
    >,
  ): Promise<void> {
    const delegation = await this.scoped(AccountDelegate, (repo) =>
      repo.findOne({
        where: { id: delegationId, ownerUserId },
      }),
    );
    if (!delegation) {
      throw new NotFoundException(
        tr("errors.delegation.delegateNotFound", "Delegate not found"),
      );
    }
    for (const [key, value] of Object.entries(sections)) {
      if (value !== undefined) {
        (delegation as unknown as Record<string, boolean>)[key] = value;
      }
    }
    await this.scoped(AccountDelegate, (repo) => repo.save(delegation));
  }

  async setCapabilities(
    ownerUserId: string,
    delegationId: string,
    caps: Partial<
      Record<
        | "payeesCanCreate"
        | "payeesCanEdit"
        | "payeesCanDelete"
        | "categoriesCanCreate"
        | "categoriesCanEdit"
        | "categoriesCanDelete"
        | "tagsCanCreate"
        | "tagsCanEdit"
        | "tagsCanDelete",
        boolean
      >
    >,
  ): Promise<void> {
    const delegation = await this.scoped(AccountDelegate, (repo) =>
      repo.findOne({
        where: { id: delegationId, ownerUserId },
      }),
    );
    if (!delegation) {
      throw new NotFoundException(
        tr("errors.delegation.delegateNotFound", "Delegate not found"),
      );
    }
    for (const [key, value] of Object.entries(caps)) {
      if (value !== undefined) {
        (delegation as unknown as Record<string, boolean>)[key] = value;
      }
    }
    await this.scoped(AccountDelegate, (repo) => repo.save(delegation));
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
    const grant = await this.scoped(AccountDelegateGrant, (repo) =>
      repo.findOne({
        where: { delegationId, accountId, canRead: true },
      }),
    );
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

  /**
   * Whether a Monize login already exists for this email (existing full
   * account or a delegate of another owner). Used by the Add-delegate UI
   * to skip the password / invite controls -- such a user keeps their own
   * credentials and is only granted the additional shared access.
   */
  async delegateEmailExists(email: string): Promise<boolean> {
    const normalized = email.toLowerCase().trim();
    const user = await this.scoped(User, (repo) =>
      repo.findOne({
        where: { email: normalized },
      }),
    );
    return !!user;
  }

  async createDelegate(ownerUserId: string, dto: CreateDelegateDto) {
    const email = dto.email.toLowerCase().trim();

    const owner = await this.scoped(User, (repo) =>
      repo.findOne({
        where: { id: ownerUserId },
      }),
    );
    if (!owner)
      throw new NotFoundException(
        tr("errors.delegation.userNotFound", "User not found"),
      );
    if (owner.email && owner.email.toLowerCase().trim() === email) {
      throw new BadRequestException(
        tr(
          "errors.delegation.cannotDelegateToSelf",
          "You cannot delegate access to yourself",
        ),
      );
    }

    let temporaryPassword: string | undefined;
    let inviteToken: string | undefined;

    return withScopedDb(this.dataSource, async (manager) => {
      let delegateUser = await manager.findOne(User, { where: { email } });
      const isNew = !delegateUser;

      if (delegateUser && delegateUser.id === ownerUserId) {
        throw new BadRequestException(
          tr(
            "errors.delegation.cannotDelegateToSelf",
            "You cannot delegate access to yourself",
          ),
        );
      }

      // An existing user that is a full account in its own right (owns data,
      // owns delegations, is an admin, or is SSO) must NEVER have its
      // credentials touched here -- that would be account takeover. They log
      // in with their own credentials; the owner only links the delegation.
      // New users and pure-delegate identities are owner-managed, so the
      // owner may set their password / send an invite.
      //
      // "Pure delegate" means the row already exists solely as some other
      // owner's delegate (a record in account_delegates.delegate_user_id).
      // A user that self-registered (passwordHash exists, not in any
      // delegate row) is a full account even if they have not created any
      // accounts yet -- their login is theirs, not ours to rotate. Without
      // this check the front end's email-lookup race (Add clicked before
      // the 400ms debounced lookup finishes) lets a stray dto.password
      // overwrite a real user's password.
      let mayManageCredentials = true;
      if (delegateUser) {
        if (delegateUser.oidcSubject || delegateUser.role === "admin") {
          mayManageCredentials = false;
        } else {
          const [ownsAccounts, ownsDelegations, alreadyDelegate] =
            await Promise.all([
              manager.count(Account, {
                where: { userId: delegateUser.id },
              }),
              manager.count(AccountDelegate, {
                where: { ownerUserId: delegateUser.id },
              }),
              manager.count(AccountDelegate, {
                where: { delegateUserId: delegateUser.id },
              }),
            ]);
          const isPureDelegateRow = alreadyDelegate > 0;
          if (
            ownsAccounts > 0 ||
            ownsDelegations > 0 ||
            (!isPureDelegateRow && !!delegateUser.passwordHash)
          ) {
            mayManageCredentials = false;
          }
        }
      }

      if (!delegateUser) {
        delegateUser = manager.create(User, {
          email,
          firstName: dto.firstName ?? null,
          lastName: dto.lastName ?? null,
          authProvider: "local",
          role: "user",
          // Marks the row as owner-managed -- hidden from admin User
          // Management, no "self" context offered to the delegate.
          // Cleared by the /register claim path the moment the user
          // upgrades into a full account in their own right.
          isDelegateOnly: true,
          // Owner-provisioned and invited to this email, so the address is
          // trusted -- delegates skip the self-service verification gate.
          emailVerified: true,
        });
      }

      if (mayManageCredentials) {
        if (dto.sendInvite) {
          if (!this.emailService.getStatus().configured) {
            throw new BadRequestException(
              tr(
                "errors.delegation.smtpNotConfigured",
                "SMTP is not configured. Set a password for the delegate instead.",
              ),
            );
          }
          const rawToken = crypto.randomBytes(32).toString("hex");
          delegateUser.resetToken = hashToken(rawToken);
          delegateUser.resetTokenExpiry = new Date(
            Date.now() + 24 * 60 * 60 * 1000,
          );
          // The invitee sets their own password via the reset link.
          inviteToken = rawToken;
        } else if (dto.password) {
          delegateUser.passwordHash = await bcrypt.hash(
            dto.password,
            this.BCRYPT_ROUNDS,
          );
          delegateUser.mustChangePassword = false;
          delegateUser.resetToken = null;
          delegateUser.resetTokenExpiry = null;
          delegateUser.failedLoginAttempts = 0;
          delegateUser.lockedUntil = null;
        } else if (isNew || !delegateUser.passwordHash) {
          // Guarantee the delegate can actually sign in.
          temporaryPassword = generateReadablePassword();
          delegateUser.passwordHash = await bcrypt.hash(
            temporaryPassword,
            this.BCRYPT_ROUNDS,
          );
          delegateUser.mustChangePassword = true;
          delegateUser.resetToken = null;
          delegateUser.resetTokenExpiry = null;
          delegateUser.failedLoginAttempts = 0;
          delegateUser.lockedUntil = null;
        }
      }

      delegateUser = await manager.save(delegateUser);

      let delegation = await manager.findOne(AccountDelegate, {
        where: { ownerUserId, delegateUserId: delegateUser.id },
      });
      if (delegation) {
        if (delegation.status === "active") {
          throw new ConflictException(
            tr(
              "errors.delegation.alreadyDelegate",
              "That user is already a delegate for your account",
            ),
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
        const lang = await withScopedDb(this.dataSource, (manager) =>
          resolveUserEmailLocale(
            manager.getRepository(UserPreference),
            delegateUser.id,
          ),
        );
        const t = emailTranslator(this.i18n, lang);
        this.emailService
          .sendMail(
            email,
            t(
              "emails.delegateInvite.subject",
              "You have been invited to Monize",
            ),
            delegateInviteTemplate(
              dto.firstName || "",
              this.userLabel(owner),
              inviteUrl,
              t,
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
    const delegation = await this.scoped(AccountDelegate, (repo) =>
      repo.findOne({
        where: { id: delegationId, ownerUserId },
      }),
    );
    if (!delegation) {
      throw new NotFoundException(
        tr("errors.delegation.delegateNotFound", "Delegate not found"),
      );
    }
    const delegateUserId = delegation.delegateUserId;

    await withScopedDb(this.dataSource, async (manager) => {
      // Hard-delete the delegation. FK cascades remove its grants and any
      // refresh tokens scoped to it, so live delegate sessions acting via
      // this delegation are immediately invalidated.
      await manager.delete(AccountDelegate, { id: delegationId });

      // Entirely remove the delegate's login unless it has another reason to
      // exist: a delegation elsewhere, its own data, it owns a delegation,
      // it is an admin, or it has been claimed as a full account in its
      // own right (isDelegateOnly=false). Without the isDelegateOnly
      // check a self-registered user who hasn't created any accounts yet
      // would be silently deleted on revoke.
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
        delegateUser?.role !== "admin" &&
        delegateUser?.isDelegateOnly !== false
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
    const delegation = await this.scoped(AccountDelegate, (repo) =>
      repo.findOne({
        where: { id: delegationId, ownerUserId },
      }),
    );
    if (!delegation) {
      throw new NotFoundException(
        tr("errors.delegation.delegateNotFound", "Delegate not found"),
      );
    }

    // READ is the minimum and a prerequisite for CREATE/EDIT/DELETE.
    for (const g of grants) {
      if (!g.canRead && (g.canCreate || g.canEdit || g.canDelete)) {
        throw new BadRequestException(
          tr(
            "errors.delegation.readRequiredForWrite",
            "READ access is required for CREATE, EDIT or DELETE",
          ),
        );
      }
      if (!g.canRead && g.isJoint) {
        throw new BadRequestException(
          tr(
            "errors.delegation.jointRequiresRead",
            "READ access is required to mark an account as joint",
          ),
        );
      }
    }

    // Joint visibility is only offered to delegates who are full Monize
    // accounts -- never an owner-provisioned credential identity.
    if (
      grants.some((g) => g.canRead && g.isJoint) &&
      !(await this.isFullAccount(delegation.delegateUserId))
    ) {
      throw new BadRequestException(
        tr(
          "errors.delegation.jointRequiresFullAccount",
          "Joint accounts can only be shared with users who have their own Monize account",
        ),
      );
    }

    // Only grants that include READ represent actual access.
    const readable = grants.filter((g) => g.canRead);
    const accountIds = readable.map((g) => g.accountId);

    if (accountIds.length > 0) {
      const owned = await this.scoped(Account, (repo) =>
        repo.find({
          where: { id: In(accountIds), userId: ownerUserId },
          select: ["id"],
        }),
      );
      if (owned.length !== accountIds.length) {
        throw new ForbiddenException(
          tr(
            "errors.delegation.accountsNotOwned",
            "One or more accounts do not belong to you",
          ),
        );
      }
    }

    await withScopedDb(this.dataSource, async (manager) => {
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
            isJoint: !!g.isJoint,
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
    const delegation = await this.scoped(AccountDelegate, (repo) =>
      repo.findOne({
        where: { id: delegationId, ownerUserId, status: "active" },
      }),
    );
    if (!delegation) {
      throw new NotFoundException(
        tr("errors.delegation.delegateNotFound", "Delegate not found"),
      );
    }

    const delegate = await this.scoped(User, (repo) =>
      repo.findOne({
        where: { id: delegation.delegateUserId },
      }),
    );
    if (!delegate) {
      throw new NotFoundException(
        tr("errors.delegation.delegateNotFound", "Delegate not found"),
      );
    }
    if (delegate.oidcSubject) {
      throw new BadRequestException(
        tr(
          "errors.delegation.cannotResetSsoPassword",
          "Cannot reset password for an SSO delegate account",
        ),
      );
    }
    if (!(await this.canOwnerResetDelegatePassword(delegate.id))) {
      throw new ForbiddenException(
        tr(
          "errors.delegation.delegateManagesOwnPassword",
          "This delegate manages their own password (they have their own Monize account or delegated access elsewhere). Only they can change it.",
        ),
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
    // Owner-driven reset is an explicit recovery action: clear any lockout
    // so a locked-out delegate can sign in with the new password.
    delegate.failedLoginAttempts = 0;
    delegate.lockedUntil = null;
    await this.scoped(User, (repo) => repo.save(delegate));

    await this.scoped(RefreshToken, (repo) =>
      repo.update(
        { userId: delegate.id, isRevoked: false },
        { isRevoked: true },
      ),
    );

    return { temporaryPassword };
  }
}
