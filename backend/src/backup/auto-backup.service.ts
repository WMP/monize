import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  DataSource,
  EntityTarget,
  In,
  LessThanOrEqual,
  Not,
  ObjectLiteral,
  Repository,
} from "typeorm";
import { withScopedDb } from "../common/db/scoped-db";
import { affectedRowCount } from "../common/db/query-result";
import { Cron } from "@nestjs/schedule";
import { promises as fs, readdirSync, unlinkSync, copyFileSync } from "fs";
import { resolve } from "path";
import { randomUUID } from "crypto";
import { AutoBackupSettings } from "./entities/auto-backup-settings.entity";
import { BackupService } from "./backup.service";
import { BackupEncryptionService } from "./backup-encryption.service";
import { User } from "../users/entities/user.entity";
import { DemoModeService } from "../common/demo-mode.service";
import { isShardableId, shardedSegments } from "../common/shard-path.util";
import { withSystemContext, withUserContext } from "../common/db/with-context";
import { UserMaintenanceService } from "../common/jobs/user-maintenance.service";
import {
  UpdateAutoBackupSettingsDto,
  AutoBackupFrequency,
} from "./dto/update-auto-backup-settings.dto";
import { tr } from "../i18n/translate";

const BACKUP_FILE_PREFIX = "monize-backup-";

/**
 * Role that may see and change automatic backup settings. Everyone else is
 * enrolled on the deployment defaults by `enrollManagedUsers` and never sees
 * the feature -- see the class comment.
 */
const BACKUP_ADMIN_ROLE = "admin";

/**
 * Folder automatic backups are written to when BACKUP_CONTAINER_DIR is unset.
 * Monize runs in a container, so this is a container path: mount a host folder
 * there (see .env.example and the docker-compose files).
 */
export const DEFAULT_BACKUP_CONTAINER_DIR = "/data/backups";

// File extensions: .json.gz for unencrypted, .mzbe for encrypted Monize backups.
// Retention enforcement matches both so we can clean up legacy and encrypted
// files uniformly.
const DAILY_FILE_PATTERN =
  /^monize-backup-daily-(\d{4}-\d{2}-\d{2})\.(json\.gz|mzbe)$/;
const WEEKLY_FILE_PATTERN =
  /^monize-backup-weekly-(\d{4}-\d{2}-\d{2})\.(json\.gz|mzbe)$/;
const MONTHLY_FILE_PATTERN =
  /^monize-backup-monthly-(\d{2}-\d{2})\.(json\.gz|mzbe)$/;

const WEEKLY_DAYS = [7, 14, 21, 28];

const FREQUENCY_HOURS: Record<AutoBackupFrequency, number> = {
  every6hours: 6,
  every12hours: 12,
  daily: 24,
  weekly: 168,
};

interface BackupFile {
  name: string;
  /** Directory the file was found in -- the user's folder, or the legacy flat base. */
  dir: string;
  /** True for a file written by a version that wrote flat into the base folder. */
  legacy: boolean;
  date: Date;
  tier: "daily" | "weekly" | "monthly";
}

function parseDateString(ds: string): Date | null {
  const date = new Date(ds + "T00:00:00Z");
  return isNaN(date.getTime()) ? null : date;
}

function parseYearMonthString(ym: string): Date | null {
  const date = new Date(`20${ym}-01T00:00:00Z`);
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Automatic backups: scheduling, retention, and where the files land.
 *
 * **Layout.** Each user's backups live in their own folder under the configured
 * base, fanned out by user id exactly the way attachment bytes are:
 * `<BACKUP_CONTAINER_DIR>/<ab>/<cd>/<userId>/monize-backup-daily-<date>.json.gz`
 * (see `common/shard-path.util.ts`). The filenames carry only a tier and a
 * date, so a flat shared folder gave every user the same name for the same day
 * -- whoever ran last overwrote the others, and one user's retention pass
 * deleted another's files. The per-user folder is what makes a backup belong to
 * somebody.
 *
 * **Who configures it.** Only an administrator sees the settings (the endpoints
 * live on `AutoBackupController`, behind `@Roles("admin")`). Every other user is
 * enrolled automatically on the deployment defaults by `enrollManagedUsers`, so
 * their data is protected without them having to ask -- and without them being
 * able to point backups at a folder the operator did not mount.
 */
@Injectable()
export class AutoBackupService {
  private readonly logger = new Logger(AutoBackupService.name);

  /** Deployment-wide backup folder (BACKUP_CONTAINER_DIR), used whenever a user has not
   *  chosen one of their own. */
  private readonly defaultFolderPath: string;

  constructor(
    private readonly dataSource: DataSource,
    private readonly backupService: BackupService,
    private readonly backupEncryption: BackupEncryptionService,
    private readonly demoMode: DemoModeService,
    private readonly maintenance: UserMaintenanceService,
    config: ConfigService,
  ) {
    this.defaultFolderPath = this.resolveConfiguredFolderPath(
      config.get<string>("BACKUP_CONTAINER_DIR"),
    );
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

  /**
   * BACKUP_CONTAINER_DIR is operator-supplied, so it goes through the same CWE-22
   * validation as a user-supplied path. An unusable value falls back to the
   * built-in default with a loud log rather than taking the whole app down.
   */
  private resolveConfiguredFolderPath(configured: string | undefined): string {
    const trimmed = configured?.trim();
    if (!trimmed) return DEFAULT_BACKUP_CONTAINER_DIR;
    try {
      return this.validateFolderPath(trimmed);
    } catch (error) {
      this.logger.error(
        `Invalid BACKUP_CONTAINER_DIR "${trimmed}": ${error.message}. Falling back to ${DEFAULT_BACKUP_CONTAINER_DIR}`,
      );
      return DEFAULT_BACKUP_CONTAINER_DIR;
    }
  }

  /**
   * The base folder backups are filed under: the configured choice when there
   * is one, otherwise the deployment-wide default. This is never the folder
   * written to -- see `userFolderPath`.
   */
  private resolveFolderPath(folderPath: string | null | undefined): string {
    const trimmed = folderPath?.trim();
    return trimmed ? trimmed : this.defaultFolderPath;
  }

  /**
   * The folder one user's backup files live in: `<base>/<ab>/<cd>/<userId>`.
   *
   * User ids are server-generated UUIDs, but they are validated before they
   * reach the filesystem all the same, and the resolved path is asserted to be
   * inside the base folder (CWE-22).
   */
  private userFolderPath(basePath: string, userId: string): string {
    if (!isShardableId(userId)) {
      throw new BadRequestException(
        tr(
          "errors.backup.pathTraversal",
          `Path traversal detected: ${userId}`,
          {
            filename: userId,
          },
        ),
      );
    }
    return this.safePath(basePath, shardedSegments(userId).join("/"));
  }

  /**
   * Resolve, create and check the folder this user's backups go in, returning
   * it. The base folder must already be usable (only the deployment default is
   * created on demand, so a typo in an operator-chosen path still surfaces);
   * the per-user folder underneath is created on first use, the way attachment
   * shard directories are.
   */
  private async ensureUserFolder(
    basePath: string,
    userId: string,
  ): Promise<string> {
    await this.assertFolderWritable(basePath);
    const userFolder = this.userFolderPath(basePath, userId);
    await this.assertFolderWritable(userFolder, { createIfMissing: true });
    return userFolder;
  }

  /** Settings for a user with no persisted row yet (not saved by this method). */
  private defaultSettingsFor(userId: string): AutoBackupSettings {
    const defaults = new AutoBackupSettings();
    defaults.userId = userId;
    defaults.enabled = false;
    defaults.folderPath = this.defaultFolderPath;
    defaults.frequency = "daily";
    defaults.backupTime = "02:00";
    defaults.timezone = "UTC";
    defaults.retentionDaily = 7;
    defaults.retentionWeekly = 4;
    defaults.retentionMonthly = 6;
    defaults.lastBackupAt = null;
    defaults.lastBackupStatus = null;
    defaults.lastBackupError = null;
    defaults.nextBackupAt = null;
    return defaults;
  }

  /**
   * Attach the read-only `resolvedFolderPath` -- the per-user folder the files
   * actually land in -- so the settings screen can show where to look. Computed
   * on every read rather than stored: the layout is derived from the base
   * folder and the user id, and a persisted copy could disagree with both.
   */
  private withResolvedFolder(settings: AutoBackupSettings): AutoBackupSettings {
    const basePath = this.resolveFolderPath(settings.folderPath);
    let resolvedFolderPath: string | undefined;
    try {
      resolvedFolderPath = this.userFolderPath(basePath, settings.userId);
    } catch {
      // A base path the operator has since made invalid must not break the
      // settings screen; the folder validation on save reports it properly.
      resolvedFolderPath = undefined;
    }
    return Object.assign(new AutoBackupSettings(), settings, {
      folderPath: basePath,
      resolvedFolderPath,
    });
  }

  async getSettings(userId: string): Promise<AutoBackupSettings> {
    const existing = await this.scoped(AutoBackupSettings, (repo) =>
      repo.findOne({
        where: { userId },
      }),
    );
    // Report the folder backups are actually written to, so a stored row that
    // never had one chosen shows the deployment default instead of a blank.
    return this.withResolvedFolder(existing ?? this.defaultSettingsFor(userId));
  }

  async updateSettings(
    userId: string,
    dto: UpdateAutoBackupSettingsDto,
  ): Promise<AutoBackupSettings> {
    let settings = await this.scoped(AutoBackupSettings, (repo) =>
      repo.findOne({
        where: { userId },
      }),
    );

    if (!settings) {
      // Seed the row with the same defaults getSettings reports, so an update
      // that only touches one field still lands on a complete row.
      settings = this.defaultSettingsFor(userId);
    }

    if (dto.folderPath !== undefined) {
      settings.folderPath = this.validateFolderPath(dto.folderPath);
    }
    if (dto.frequency !== undefined) {
      settings.frequency = dto.frequency;
    }
    if (dto.backupTime !== undefined) {
      settings.backupTime = dto.backupTime;
    }
    if (dto.timezone !== undefined) {
      settings.timezone = dto.timezone;
    }
    if (dto.retentionDaily !== undefined) {
      settings.retentionDaily = dto.retentionDaily;
    }
    if (dto.retentionWeekly !== undefined) {
      settings.retentionWeekly = dto.retentionWeekly;
    }
    if (dto.retentionMonthly !== undefined) {
      settings.retentionMonthly = dto.retentionMonthly;
    }

    if (dto.enabled !== undefined) {
      settings.enabled = dto.enabled;
      if (dto.enabled) {
        // Persist the resolved folder so the stored row always records where
        // backups actually go, even when the user never picked one.
        settings.folderPath = this.resolveFolderPath(settings.folderPath);
        // Create and check the user's own folder now, so a base folder that is
        // readable but not writable is reported at save time rather than at
        // 02:00 as a failed backup.
        await this.ensureUserFolder(settings.folderPath, userId);
        settings.nextBackupAt = this.calculateNextBackupAt(
          settings.frequency as AutoBackupFrequency,
          settings.backupTime,
          settings.timezone,
          new Date(),
        );
      } else {
        settings.nextBackupAt = null;
      }
    }

    const saved = await this.scoped(AutoBackupSettings, (repo) =>
      repo.save(settings),
    );
    return this.withResolvedFolder(saved);
  }

  async validateFolder(
    folderPath: string,
  ): Promise<{ valid: boolean; error?: string }> {
    try {
      const safePath = this.validateFolderPath(folderPath);
      await this.assertFolderWritable(safePath);
      return { valid: true };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  async browseFolders(
    folderPath: string,
  ): Promise<{ current: string; directories: string[] }> {
    const safePath = this.validateFolderPath(folderPath);

    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(safePath);
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new BadRequestException(
          tr(
            "errors.backup.folderNotExist",
            `Folder does not exist: ${safePath}`,
            { safePath },
          ),
        );
      }
      throw new BadRequestException(
        tr(
          "errors.backup.folderAccessError",
          `Cannot access folder: ${safePath}`,
          { safePath },
        ),
      );
    }

    if (!stat.isDirectory()) {
      throw new BadRequestException(
        tr(
          "errors.backup.pathNotDirectory",
          `Path is not a directory: ${safePath}`,
          { safePath },
        ),
      );
    }

    const entries = await fs.readdir(safePath, { withFileTypes: true });
    const directories = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));

    return { current: safePath, directories };
  }

  async runManualBackup(
    userId: string,
  ): Promise<{ message: string; filename: string }> {
    // The cron defers in this state; a manual run has a user watching, so it says
    // so instead. Writing the file anyway would produce an empty backup and then
    // rotate the last good one out to keep the retention count.
    if (await this.maintenance.isUnderMaintenance(userId)) {
      throw new ConflictException(
        tr(
          "errors.maintenance.inProgress",
          "Another operation is currently replacing this account's data. Wait for it to finish and try again.",
        ),
      );
    }

    // A user who has never opened the auto-backup settings still gets a working
    // manual run: the row is seeded with defaults here and persisted by the
    // save at the end of this method.
    const settings =
      (await this.scoped(AutoBackupSettings, (repo) =>
        repo.findOne({ where: { userId } }),
      )) ?? this.defaultSettingsFor(userId);
    settings.folderPath = this.resolveFolderPath(settings.folderPath);

    const userFolder = await this.ensureUserFolder(settings.folderPath, userId);
    const timezone = settings.timezone || "UTC";
    const filename = await this.exportToFile(userId, userFolder, timezone);
    this.copyToWeeklyIfNeeded(userFolder, filename, timezone);
    this.copyToMonthlyIfNeeded(userFolder, filename, timezone);
    this.enforceRetention(userFolder, settings.folderPath, settings);

    settings.lastBackupAt = new Date();
    settings.lastBackupStatus = "success";
    settings.lastBackupError = null;
    if (settings.enabled) {
      settings.nextBackupAt = this.calculateNextBackupAt(
        settings.frequency as AutoBackupFrequency,
        settings.backupTime,
        settings.timezone,
        new Date(),
      );
    }
    await this.scoped(AutoBackupSettings, (repo) => repo.save(settings));

    return { message: "Backup completed successfully", filename };
  }

  /**
   * Claim one due backup by advancing its own schedule.
   *
   * Every replica fires this cron, so without a claim a two-replica cluster
   * writes every user's backup twice -- and worse, one replica's
   * `enforceRetention` can delete the file the other is still writing.
   *
   * The claim is the schedule advance itself: `next_backup_at` is a column this
   * job owns, so `UPDATE ... WHERE next_backup_at <= now RETURNING` re-evaluates
   * the predicate after taking the row lock and exactly one replica gets a row
   * back. No claim table and no lease to expire -- the row already carries the
   * fact. Advancing *before* the export also means a crash mid-backup skips this
   * window rather than retrying forever, which is the behaviour the failure path
   * already had.
   */
  private async claimDueBackup(
    settings: AutoBackupSettings,
    now: Date,
    nextBackupAt: Date,
  ): Promise<boolean> {
    const rows = await withUserContext(settings.userId, () =>
      withScopedDb(this.dataSource, (manager) =>
        manager.query(
          `UPDATE auto_backup_settings
              SET next_backup_at = $1
            WHERE user_id = $2
              AND enabled = true
              AND next_backup_at IS NOT NULL
              AND next_backup_at <= $3
            RETURNING id`,
          [nextBackupAt, settings.userId, now],
        ),
      ),
    );
    return affectedRowCount(rows) > 0;
  }

  /**
   * Write only the columns describing how the run went.
   *
   * `repo.save(settings)` would write back every column of the snapshot this
   * sweep read at the top, so a user who changed their folder, frequency or
   * retention through the UI while the sweep was running would find those edits
   * reverted. The outcome columns are the only ones this job is entitled to
   * write; `next_backup_at` was already set by the claim.
   */
  private async recordBackupOutcome(
    userId: string,
    at: Date,
    status: "success" | "failed",
    error: string | null,
  ): Promise<void> {
    await withUserContext(userId, () =>
      this.scoped(AutoBackupSettings, (repo) =>
        repo
          .createQueryBuilder()
          .update(AutoBackupSettings)
          .set({
            lastBackupAt: at,
            lastBackupStatus: status,
            lastBackupError: error,
          })
          .where("user_id = :userId", { userId })
          .execute(),
      ),
    );
  }

  @Cron("0 * * * *")
  async handleAutoBackupCron(): Promise<void> {
    const now = new Date();
    await this.enrollManagedUsers(now);
    // RLS (task C2): cross-user fan-out over every user's due backup settings.
    const dueSettings = await withSystemContext(() =>
      this.scoped(AutoBackupSettings, (repo) =>
        repo.find({
          where: {
            enabled: true,
            nextBackupAt: LessThanOrEqual(now),
          },
        }),
      ),
    );

    if (dueSettings.length === 0) return;

    this.logger.log(`Auto-backup cron: ${dueSettings.length} backup(s) due`);

    for (const settings of dueSettings) {
      const nextBackupAt = this.calculateNextBackupAt(
        settings.frequency as AutoBackupFrequency,
        settings.backupTime,
        settings.timezone,
        now,
      );

      // Never back up a dataset that is mid-replacement. A `.mny` import with
      // "start fresh" commits its wipe and then writes rows for minutes, so an
      // hourly backup landing in that window would export the empty dataset,
      // save it as today's file, and enforce retention -- rotating the last good
      // backup out to make room for one containing nothing. Skipping without
      // claiming leaves `next_backup_at` in the past, so the next hour retries
      // (audit DR-04-02).
      if (await this.maintenance.isUnderMaintenance(settings.userId)) {
        this.logger.log(
          `Auto-backup deferred for user ${settings.userId}: their data is being replaced`,
        );
        continue;
      }

      const claimed = await this.claimDueBackup(settings, now, nextBackupAt);
      if (!claimed) {
        // Either another replica took this window, or the user disabled or
        // rescheduled the backup after this sweep read its snapshot. Both mean
        // "not ours to run".
        continue;
      }

      try {
        settings.folderPath = this.resolveFolderPath(settings.folderPath);
        const userFolder = await this.ensureUserFolder(
          settings.folderPath,
          settings.userId,
        );
        const timezone = settings.timezone || "UTC";
        // RLS (task C2): the export reads this user's entire dataset, and the
        // settings write below is that user's row -- both under a user context.
        const filename = await withUserContext(settings.userId, () =>
          this.exportToFile(settings.userId, userFolder, timezone),
        );
        this.copyToWeeklyIfNeeded(userFolder, filename, timezone);
        this.copyToMonthlyIfNeeded(userFolder, filename, timezone);
        this.enforceRetention(userFolder, settings.folderPath, settings);

        await this.recordBackupOutcome(settings.userId, now, "success", null);

        this.logger.log(
          `Auto-backup completed for user ${settings.userId}: ${filename}`,
        );
      } catch (error) {
        this.logger.error(
          `Auto-backup failed for user ${settings.userId}: ${error.message}`,
        );
        await this.recordBackupOutcome(
          settings.userId,
          now,
          "failed",
          String(error.message).slice(0, 1024),
        );
      }
    }
  }

  /**
   * Put every non-admin user on the deployment's default backup schedule.
   *
   * Automatic backups are not a per-user preference: only an administrator can
   * see or change the settings, so anybody else would silently have no backups
   * at all unless something enrolled them. This runs at the top of the hourly
   * cron rather than at registration so that users who already existed -- and
   * anyone demoted out of the admin role later -- are covered too, with no
   * migration to write and nothing to re-run by hand.
   *
   * The row is fully managed: it is written back to the defaults whenever it
   * has drifted, which is also how a row left over from when the feature was
   * user-configurable gets brought into line. `lastBackup*` and `nextBackupAt`
   * are the schedule's own bookkeeping and are never reset, so an enrolled user
   * is not re-backed-up every hour.
   */
  private async enrollManagedUsers(now: Date): Promise<void> {
    // Demo data is regenerated daily and every visitor is a separate user, so
    // enrolling them would write throwaway exports for accounts that are about
    // to be deleted.
    if (this.demoMode.isDemo) return;

    // RLS: reading every user and writing rows that are not the caller's is
    // cross-user work by definition.
    const managedUserIds = await withSystemContext(async () => {
      const users = await this.scoped(User, (repo) =>
        repo.find({
          select: { id: true },
          where: { role: Not(BACKUP_ADMIN_ROLE), isActive: true },
        }),
      );
      return users.map((u) => u.id);
    });
    if (managedUserIds.length === 0) return;

    const existing = await withSystemContext(() =>
      this.scoped(AutoBackupSettings, (repo) =>
        repo.find({ where: { userId: In(managedUserIds) } }),
      ),
    );
    const byUserId = new Map(existing.map((s) => [s.userId, s]));

    for (const userId of managedUserIds) {
      const current = byUserId.get(userId);
      const managed = this.applyManagedDefaults(current, userId, now);
      if (!managed) continue;
      try {
        await withUserContext(userId, () =>
          this.scoped(AutoBackupSettings, (repo) => repo.save(managed)),
        );
        this.logger.log(
          `Enrolled user ${userId} in automatic backups on the deployment defaults`,
        );
      } catch (error) {
        // One user's row failing must not stop the others from being enrolled,
        // nor the backups that are already due from running.
        this.logger.error(
          `Failed to enroll user ${userId} in automatic backups: ${error.message}`,
        );
      }
    }
  }

  /**
   * The managed form of `current` when it differs from the deployment defaults,
   * or `null` when it is already correct -- so a settled deployment writes
   * nothing on the hourly tick.
   */
  private applyManagedDefaults(
    current: AutoBackupSettings | undefined,
    userId: string,
    now: Date,
  ): AutoBackupSettings | null {
    const defaults = this.defaultSettingsFor(userId);
    const managed = Object.assign(
      new AutoBackupSettings(),
      current ?? defaults,
      {
        enabled: true,
        folderPath: defaults.folderPath,
        frequency: defaults.frequency,
        backupTime: defaults.backupTime,
        timezone: defaults.timezone,
        retentionDaily: defaults.retentionDaily,
        retentionWeekly: defaults.retentionWeekly,
        retentionMonthly: defaults.retentionMonthly,
      },
    );
    // A managed row with no next run would never be picked up by the cron.
    if (!managed.nextBackupAt) {
      managed.nextBackupAt = this.calculateNextBackupAt(
        managed.frequency as AutoBackupFrequency,
        managed.backupTime,
        managed.timezone,
        now,
      );
    }
    if (!current) return managed;
    const changed = (
      [
        "enabled",
        "folderPath",
        "frequency",
        "backupTime",
        "timezone",
        "retentionDaily",
        "retentionWeekly",
        "retentionMonthly",
        "nextBackupAt",
      ] as const
    ).some((key) => current[key] !== managed[key]);
    return changed ? managed : null;
  }

  /** Write one export into `userFolder` and return the filename written. */
  private async exportToFile(
    userId: string,
    userFolder: string,
    timezone: string,
  ): Promise<string> {
    const user = await this.scoped(User, (repo) =>
      repo.findOne({ where: { id: userId } }),
    );
    if (!user) {
      throw new BadRequestException(
        tr("errors.backup.userNotFound", `User ${userId} not found`, {
          userId,
        }),
      );
    }

    // Backups are encrypted with the user's own password whenever the server
    // holds a usable copy of it -- there is nothing for them to switch on.
    const resolution = await this.backupEncryption.resolveBackupPassword(user);
    if (resolution.status === "unrecoverable") {
      // A password is stored but cannot be decrypted (typically
      // AI_ENCRYPTION_KEY was rotated). Their previous backups are encrypted,
      // so quietly writing this one in plaintext would be a downgrade nobody
      // sees. Fail loud instead.
      throw new BadRequestException(
        tr(
          "errors.backup.encryptedPasswordDecryptFailed",
          "Encrypted backups are enabled but the stored password could not be decrypted. Re-enable encryption in Security settings.",
        ),
      );
    }
    const encryptionPassword =
      resolution.status === "password" ? resolution.password : undefined;

    const dateStr = this.getLocalDateString(new Date(), timezone);
    const ext = encryptionPassword ? "mzbe" : "json.gz";
    const filename = `${BACKUP_FILE_PREFIX}daily-${dateStr}.${ext}`;
    const filepath = this.safePath(userFolder, filename);

    const payload = await this.backupService.exportToBuffer(
      userId,
      encryptionPassword,
    );
    // Write to a temporary name and rename into place. `rename` within a
    // directory is atomic, so a reader (or a restore) never sees a half-written
    // backup, and a crash mid-write leaves the previous good file rather than a
    // truncated one that looks like a successful backup. Replacing our own
    // same-day file is intended -- the collision that mattered was between
    // different users, and the per-user directory removes it.
    // FV-004: unique per write, not per process. `process.pid` looked unique and
    // is not -- a manual backup and the scheduled one for the same user, day and
    // extension collide inside a single process, and across replicas sharing a
    // volume PIDs collide outright. The loser's `rename` then fails with ENOENT,
    // or its own cleanup unlinks the temp file the winner is about to rename, so a
    // legitimate backup run reports failure. Replacing our own *final* same-day
    // file is still intended; it is the intermediate name that has to be private.
    const tempPath = this.safePath(
      userFolder,
      `.${filename}.partial-${process.pid}-${randomUUID()}`,
    );
    try {
      await fs.writeFile(tempPath, payload);
      await fs.rename(tempPath, filepath);
    } catch (error) {
      await fs.unlink(tempPath).catch(() => {});
      throw error;
    }

    this.logger.log(
      `Backup written to ${filepath}${encryptionPassword ? " (encrypted)" : ""}`,
    );
    return filename;
  }

  private copyToWeeklyIfNeeded(
    folderPath: string,
    dailyFilename: string,
    timezone: string,
  ): void {
    const dayOfMonth = this.getLocalDayOfMonth(new Date(), timezone);
    if (!WEEKLY_DAYS.includes(dayOfMonth)) return;

    const ext = dailyFilename.endsWith(".mzbe") ? "mzbe" : "json.gz";
    const dateStr = this.getLocalDateString(new Date(), timezone);
    const weeklyFilename = `${BACKUP_FILE_PREFIX}weekly-${dateStr}.${ext}`;
    try {
      copyFileSync(
        this.safePath(folderPath, dailyFilename),
        this.safePath(folderPath, weeklyFilename),
      );
      this.logger.log(`Copied daily backup to weekly: ${weeklyFilename}`);
    } catch (err) {
      this.logger.warn(`Failed to copy daily to weekly: ${err.message}`);
    }
  }

  private copyToMonthlyIfNeeded(
    folderPath: string,
    dailyFilename: string,
    timezone: string,
  ): void {
    const dayOfMonth = this.getLocalDayOfMonth(new Date(), timezone);
    if (dayOfMonth !== 1) return;

    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "2-digit",
      month: "2-digit",
    });
    const parts = formatter.formatToParts(now);
    const year = parts.find((p) => p.type === "year")!.value;
    const month = parts.find((p) => p.type === "month")!.value;
    const ext = dailyFilename.endsWith(".mzbe") ? "mzbe" : "json.gz";
    const monthlyFilename = `${BACKUP_FILE_PREFIX}monthly-${year}-${month}.${ext}`;

    try {
      copyFileSync(
        this.safePath(folderPath, dailyFilename),
        this.safePath(folderPath, monthlyFilename),
      );
      this.logger.log(`Copied daily backup to monthly: ${monthlyFilename}`);
    } catch (err) {
      this.logger.warn(`Failed to copy daily to monthly: ${err.message}`);
    }
  }

  /** Backup files found directly in `dir`, tagged with where they came from. */
  private collectBackupFiles(dir: string, legacy: boolean): BackupFile[] {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return [];
    }

    const files: BackupFile[] = [];
    for (const name of entries) {
      const dailyMatch = DAILY_FILE_PATTERN.exec(name);
      if (dailyMatch) {
        const date = parseDateString(dailyMatch[1]);
        if (date) files.push({ name, dir, legacy, date, tier: "daily" });
        continue;
      }
      const weeklyMatch = WEEKLY_FILE_PATTERN.exec(name);
      if (weeklyMatch) {
        const date = parseDateString(weeklyMatch[1]);
        if (date) files.push({ name, dir, legacy, date, tier: "weekly" });
        continue;
      }
      const monthlyMatch = MONTHLY_FILE_PATTERN.exec(name);
      if (monthlyMatch) {
        const date = parseYearMonthString(monthlyMatch[1]);
        if (date) files.push({ name, dir, legacy, date, tier: "monthly" });
        continue;
      }
    }
    return files;
  }

  /**
   * Delete backups past the retention limit of their tier, newest kept.
   *
   * Two directories are swept: the user's own folder, and the flat base folder
   * where a version before per-user folders wrote. Those legacy filenames carry
   * no user id, so they were already shared -- every user's pass has always
   * deleted whatever it found there -- and sweeping them alongside the new
   * layout ages them out as sharded backups accumulate, rather than stranding
   * them under a limit that no longer looks at them. On an equal date the
   * legacy copy is the one deleted, so the file that is definitely this user's
   * is the one kept.
   */
  private enforceRetention(
    userFolder: string,
    basePath: string,
    settings: AutoBackupSettings,
  ): void {
    const files = [
      ...this.collectBackupFiles(userFolder, false),
      ...this.collectBackupFiles(basePath, true),
    ];

    // Sort each tier newest first and delete beyond retention limit
    const deleteExcess = (tier: BackupFile["tier"], limit: number) => {
      const sorted = files
        .filter((f) => f.tier === tier)
        .sort(
          (a, b) =>
            b.date.getTime() - a.date.getTime() ||
            Number(a.legacy) - Number(b.legacy),
        );
      for (let i = limit; i < sorted.length; i++) {
        try {
          unlinkSync(this.safePath(sorted[i].dir, sorted[i].name));
          this.logger.log(`Retention: deleted old backup ${sorted[i].name}`);
        } catch (err) {
          this.logger.warn(
            `Retention: failed to delete ${sorted[i].name}: ${err.message}`,
          );
        }
      }
    };

    deleteExcess("daily", settings.retentionDaily);
    deleteExcess("weekly", settings.retentionWeekly);
    deleteExcess("monthly", settings.retentionMonthly);
  }

  private getLocalDateString(date: Date, timezone: string): string {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(date);
  }

  private getLocalDayOfMonth(date: Date, timezone: string): number {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      day: "numeric",
    });
    return Number(formatter.format(date));
  }

  private calculateNextBackupAt(
    frequency: AutoBackupFrequency,
    backupTime: string,
    timezone: string,
    fromDate: Date,
  ): Date {
    const [hours] = backupTime.split(":").map(Number);
    const intervalHours = FREQUENCY_HOURS[frequency] ?? 24;

    // Snap minutes to 0 -- the cron fires at minute 0 of each hour,
    // so non-zero minutes would cause the backup to run an hour late.
    const todayInTz = this.localTimeToUtc(fromDate, hours, 0, timezone);

    if (frequency === "daily" || frequency === "weekly") {
      const next = new Date(todayInTz);

      // If the target time is in the past for today, move forward by one interval
      if (next.getTime() <= fromDate.getTime()) {
        next.setTime(next.getTime() + intervalHours * 60 * 60 * 1000);
      }
      return next;
    }

    // Sub-daily frequencies (every6hours, every12hours):
    // Align to the configured time, then add interval increments
    let next = new Date(todayInTz);
    while (next.getTime() <= fromDate.getTime()) {
      next = new Date(next.getTime() + intervalHours * 60 * 60 * 1000);
    }
    return next;
  }

  /**
   * Convert a local time (hours:minutes) in the given timezone to a UTC Date
   * for the same calendar day as `referenceDate`.
   */
  private localTimeToUtc(
    referenceDate: Date,
    hours: number,
    minutes: number,
    timezone: string,
  ): Date {
    // Get the current date parts in the target timezone
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = formatter.formatToParts(referenceDate);
    const year = parts.find((p) => p.type === "year")!.value;
    const month = parts.find((p) => p.type === "month")!.value;
    const day = parts.find((p) => p.type === "day")!.value;

    // Build an ISO string representing the local time in the timezone,
    // then compute the UTC equivalent by finding the offset
    const localIso = `${year}-${month}-${day}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`;

    // Use the timezone offset at that specific moment to convert to UTC
    const offsetMs = this.getTimezoneOffsetMs(localIso, timezone);
    return new Date(new Date(localIso + "Z").getTime() - offsetMs);
  }

  /**
   * Get the UTC offset in milliseconds for a given local datetime in a timezone.
   */
  private getTimezoneOffsetMs(localIso: string, timezone: string): number {
    const utcDate = new Date(localIso + "Z");
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = formatter.formatToParts(utcDate);
    const get = (type: string) => parts.find((p) => p.type === type)!.value;
    const localAtUtc = `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}Z`;
    return new Date(localAtUtc).getTime() - utcDate.getTime();
  }

  /**
   * Safely join a folder path with a filename, ensuring the result
   * stays within the base folder (prevents path traversal CWE-22).
   */
  private safePath(basePath: string, filename: string): string {
    const full = resolve(basePath, filename);
    if (!full.startsWith(basePath + "/") && full !== basePath) {
      throw new BadRequestException(
        tr(
          "errors.backup.pathTraversal",
          `Path traversal detected: ${filename}`,
          { filename },
        ),
      );
    }
    return full;
  }

  /**
   * Validate a user-supplied folder path and return the normalized form.
   * All filesystem operations must use the returned value (not the original
   * input) so CodeQL/SAST tools can see the explicit sanitization boundary
   * (CWE-22: Path traversal).
   */
  private validateFolderPath(folderPath: string): string {
    if (typeof folderPath !== "string") {
      throw new BadRequestException(
        tr(
          "errors.backup.folderPathMustBeString",
          "Folder path must be a string",
        ),
      );
    }
    if (folderPath.length > 4096) {
      throw new BadRequestException(
        tr("errors.backup.folderPathTooLong", "Folder path is too long"),
      );
    }
    if (!folderPath.startsWith("/")) {
      throw new BadRequestException(
        tr(
          "errors.backup.folderPathMustBeAbsolute",
          "Folder path must be an absolute path",
        ),
      );
    }
    if (folderPath.includes("..")) {
      throw new BadRequestException(
        tr(
          "errors.backup.folderPathNoDotDot",
          "Folder path must not contain '..' segments",
        ),
      );
    }
    if (folderPath.includes("\0")) {
      throw new BadRequestException(
        tr(
          "errors.backup.folderPathNoNullBytes",
          "Folder path must not contain null bytes",
        ),
      );
    }
    // Trim trailing slashes without a greedy regex (avoids ReDoS on '/' runs).
    let trimmed = folderPath;
    while (trimmed.length > 1 && trimmed.endsWith("/")) {
      trimmed = trimmed.slice(0, -1);
    }
    // Ensure the resolved path matches the input (no symlink-like tricks via //)
    const normalized = resolve(trimmed);
    if (normalized !== trimmed) {
      throw new BadRequestException(
        tr(
          "errors.backup.folderPathMustBeNormalized",
          "Folder path must be a normalized absolute path",
        ),
      );
    }
    return normalized;
  }

  /**
   * Ensure `safePath` is an existing directory. The configured default folder
   * is created on first use so a deployment only has to mount the volume, and
   * so are the per-user folders underneath a base that already checks out
   * (`createIfMissing`); any other chosen folder must already exist, since
   * creating arbitrary paths on demand would mask typos.
   */
  private async assertDirectoryExists(
    safePath: string,
    createIfMissing = false,
  ): Promise<void> {
    try {
      const stat = await fs.stat(safePath);
      if (!stat.isDirectory()) {
        throw new BadRequestException(
          tr(
            "errors.backup.pathNotDirectory",
            `Path is not a directory: ${safePath}`,
            { safePath },
          ),
        );
      }
      return;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      if (error.code !== "ENOENT") {
        throw new BadRequestException(
          tr(
            "errors.backup.folderAccessErrorDetail",
            `Cannot access folder: ${safePath} - ${error.message}`,
            { safePath, message: error.message },
          ),
        );
      }
      if (!createIfMissing && safePath !== this.defaultFolderPath) {
        throw new BadRequestException(
          tr(
            "errors.backup.folderNotExistVolume",
            `Folder does not exist: ${safePath}. Ensure the path is mapped as a Docker volume.`,
            { safePath },
          ),
        );
      }
    }

    try {
      await fs.mkdir(safePath, { recursive: true });
      this.logger.log(`Created backup folder ${safePath}`);
    } catch (error) {
      this.logger.error(
        `Failed to create backup folder ${safePath}: ${error.message}`,
      );
      throw new BadRequestException(
        tr(
          "errors.backup.folderNotExistVolume",
          `Folder does not exist: ${safePath}. Ensure the path is mapped as a Docker volume.`,
          { safePath },
        ),
      );
    }
  }

  private async assertFolderWritable(
    folderPath: string,
    { createIfMissing = false }: { createIfMissing?: boolean } = {},
  ): Promise<void> {
    // Re-validate defensively: this method is also invoked with folder paths
    // read back from the database (originally user-supplied), so CWE-22
    // sanitization must run every time before we touch the filesystem.
    const safePath = this.validateFolderPath(folderPath);
    await this.assertDirectoryExists(safePath, createIfMissing);

    // Test write access by creating and removing a temporary file
    const testFile = this.safePath(
      safePath,
      `.monize-write-test-${Date.now()}`,
    );
    try {
      await fs.writeFile(testFile, "");
      await fs.unlink(testFile);
    } catch {
      throw new BadRequestException(
        tr(
          "errors.backup.folderNotWritable",
          `Folder is not writable: ${safePath}. Check container permissions.`,
          { safePath },
        ),
      );
    }
  }
}
