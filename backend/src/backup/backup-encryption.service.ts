import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { DataSource, EntityTarget, ObjectLiteral, Repository } from "typeorm";
import { withScopedDb } from "../common/db/scoped-db";
import * as bcrypt from "bcryptjs";
import { User } from "../users/entities/user.entity";
import { AiEncryptionService } from "../ai/ai-encryption.service";
import { PasswordBreachService } from "../auth/password-breach.service";
import { tr } from "../i18n/translate";

const MIN_BACKUP_PASSWORD_LENGTH = 12;

/**
 * What the automatic backup for a user should be encrypted with. Three answers,
 * not two: "no password stored" and "a password is stored that we cannot use"
 * are different situations and the caller has to treat them differently -- the
 * first is an ordinary unencrypted backup, the second is a misconfigured server
 * that must not quietly start writing plaintext where it used to write
 * ciphertext.
 */
export type BackupPasswordResolution =
  | { status: "none" }
  | { status: "password"; password: string }
  | { status: "unrecoverable" };

/**
 * Owns the stored copy of a user's backup password that the auto-backup cron
 * needs in order to encrypt what it writes.
 *
 * For a local-auth account there is nothing to switch on. A backup is encrypted
 * with the password they already have, and the only moment the server ever sees
 * that password in plaintext is when they type it -- so it is captured there
 * (`rememberLoginPassword`, called on registration, login and password change)
 * rather than asked for a second time in Settings.
 *
 * An OIDC account has no password of ours to capture, so nothing can be
 * automatic: those users set a dedicated backup password in Settings
 * (`setBackupPasswordForOidcUser`), or leave their backups unencrypted. Both
 * management methods refuse a local-auth account rather than pretending -- a
 * local user who "disabled" encryption would have it back at their next login,
 * because that is where the copy is captured.
 *
 * Storage shape: `users.backup_password_enc` holds the password ciphertext
 * encrypted with AI_ENCRYPTION_KEY, and `backup_encryption_enabled` records
 * that a usable copy is there.
 */
@Injectable()
export class BackupEncryptionService {
  private readonly logger = new Logger(BackupEncryptionService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly aiEncryption: AiEncryptionService,
    private readonly passwordBreach: PasswordBreachService,
  ) {}

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

  /**
   * Whether this user's backups are encrypted, and whether they are the one who
   * decides. The export screen needs the first to know whether to ask for the
   * password before downloading; Settings needs the second to know whether to
   * offer the controls at all, since a local-auth account is managed for them.
   */
  async getStatus(
    userId: string,
  ): Promise<{ enabled: boolean; manageable: boolean }> {
    const user = await this.requireUser(userId);
    return {
      enabled: user.backupEncryptionEnabled,
      manageable: user.authProvider === "oidc",
    };
  }

  /**
   * OIDC accounts: set or replace the dedicated password their backups are
   * encrypted with. There is no login password of ours to capture for these
   * users, so this is the only way their backups can be encrypted at all.
   */
  async setBackupPasswordForOidcUser(
    userId: string,
    newBackupPassword: string,
  ): Promise<void> {
    const user = await this.requireManageableUser(userId);
    await this.validatePasswordStrength(newBackupPassword);
    if (!this.aiEncryption.isConfigured()) {
      throw new BadRequestException(
        tr(
          "errors.backup.encryptionNotConfigured",
          "Server is not configured for encryption (AI_ENCRYPTION_KEY missing)",
        ),
      );
    }
    user.backupPasswordEnc = this.aiEncryption.encrypt(newBackupPassword);
    user.backupEncryptionEnabled = true;
    await this.scoped(User, (repo) => repo.save(user));
  }

  /** OIDC accounts: stop encrypting backups and drop the stored password. */
  async disableForOidcUser(userId: string): Promise<void> {
    await this.requireManageableUser(userId);
    await this.forgetStoredPassword(userId);
  }

  /**
   * Store the local-auth password the user has just proved they know, so the
   * backup cron can encrypt with it. Called from registration, login and the
   * change-password flow -- those are the only points where the plaintext
   * exists, and re-storing it on every login is what keeps the copy current
   * after a reset that went through some other path.
   *
   * Best-effort by design: this is a side benefit of signing in, and a failure
   * here must never stop somebody signing in.
   */
  async rememberLoginPassword(userId: string, password: string): Promise<void> {
    try {
      if (!password || !this.aiEncryption.isConfigured()) return;
      const user = await this.scoped(User, (repo) =>
        repo.findOne({ where: { id: userId } }),
      );
      // OIDC accounts have no password of ours to remember.
      if (!user || user.authProvider !== "local") return;

      // Always re-encrypt and store, rather than reading the existing copy back
      // to see whether it changed. Comparing would mean decrypting a secret and
      // matching it against the one supplied, which is a timing side channel
      // (CWE-208) if done with `===` and an insecure password hash if done with
      // a digest; and it saves nothing, because every caller -- login,
      // registration, change-password -- already writes this row anyway
      // (`lastLogin`, the new hash). AES-GCM over one short string is cheaper
      // than the round trip the check would have avoided.
      user.backupPasswordEnc = this.aiEncryption.encrypt(password);
      user.backupEncryptionEnabled = true;
      await this.scoped(User, (repo) => repo.save(user));
    } catch (err) {
      this.logger.error(
        `Failed to store the backup password for user ${userId}: ${err.message}`,
      );
    }
  }

  /**
   * The password this user's automatic backup should be encrypted with.
   *
   * A stored copy is checked against the account's current password hash before
   * it is used. A password changed through a path that could not update the
   * stored copy would otherwise produce a backup encrypted with a password the
   * user no longer knows -- a file that looks like a backup and cannot be
   * opened. A stale copy is dropped here and re-captured at the next login.
   */
  async resolveBackupPassword(user: User): Promise<BackupPasswordResolution> {
    if (!user.backupEncryptionEnabled || !user.backupPasswordEnc) {
      return { status: "none" };
    }

    let password: string;
    try {
      password = this.aiEncryption.decrypt(user.backupPasswordEnc);
    } catch (err) {
      // Typically AI_ENCRYPTION_KEY was rotated. The user's other backups are
      // encrypted, so writing this one in plaintext instead would be a silent
      // downgrade: report it and let the caller refuse.
      this.logger.error(
        `Failed to decrypt stored backup password for user ${user.id}: ${err.message}`,
      );
      return { status: "unrecoverable" };
    }

    if (user.authProvider === "local" && user.passwordHash) {
      const current = await bcrypt.compare(password, user.passwordHash);
      if (!current) {
        this.logger.warn(
          `Stored backup password for user ${user.id} no longer matches their login password; dropping it until their next sign-in`,
        );
        await this.forgetStoredPassword(user.id);
        return { status: "none" };
      }
    }

    return { status: "password", password };
  }

  /** Drop the stored copy, leaving backups unencrypted until it is recaptured. */
  async forgetStoredPassword(userId: string): Promise<void> {
    await withScopedDb(this.dataSource, async (manager) => {
      const repo = manager.getRepository(User);
      const user = await repo.findOne({ where: { id: userId } });
      if (!user) return;
      user.backupEncryptionEnabled = false;
      user.backupPasswordEnc = null;
      await repo.save(user);
    });
  }

  /**
   * The user, provided their backup encryption is theirs to manage. A
   * local-auth account is refused rather than half-obeyed: its password is
   * recaptured at every login, so anything set or cleared here would be
   * overwritten by the next sign-in.
   */
  private async requireManageableUser(userId: string): Promise<User> {
    const user = await this.requireUser(userId);
    if (user.authProvider !== "oidc") {
      throw new BadRequestException(
        tr(
          "errors.backup.backupPasswordOidcOnly",
          "Backup password is only configurable for OIDC users; local users use their login password",
        ),
      );
    }
    return user;
  }

  private async validatePasswordStrength(password: string): Promise<void> {
    if (!password || password.length < MIN_BACKUP_PASSWORD_LENGTH) {
      throw new BadRequestException(
        tr(
          "errors.backup.backupPasswordTooShort",
          `Backup password must be at least ${MIN_BACKUP_PASSWORD_LENGTH} characters`,
          { minLength: MIN_BACKUP_PASSWORD_LENGTH },
        ),
      );
    }
    const breached = await this.passwordBreach.isBreached(password);
    if (breached) {
      throw new BadRequestException(
        tr(
          "errors.backup.backupPasswordBreached",
          "This password has been found in a data breach. Please choose a different password.",
        ),
      );
    }
  }

  private async requireUser(userId: string): Promise<User> {
    const user = await this.scoped(User, (repo) =>
      repo.findOne({ where: { id: userId } }),
    );
    if (!user) {
      throw new NotFoundException(
        tr("errors.backup.userNotFoundRestore", "User not found"),
      );
    }
    return user;
  }
}
