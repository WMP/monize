import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import {
  DataSource,
  EntityTarget,
  IsNull,
  ObjectLiteral,
  Repository,
} from "typeorm";
import { withScopedDb } from "../common/db/scoped-db";
import { ConfigService } from "@nestjs/config";
import * as crypto from "crypto";
import { I18nService } from "nestjs-i18n";
import { EmergencyAccessSettings } from "./entities/emergency-access-settings.entity";
import { EmergencyAccessContact } from "./entities/emergency-access-contact.entity";
import { AiEncryptionService } from "../ai/ai-encryption.service";
import { EmailService } from "../notifications/email.service";
import {
  emergencyAccessGrantTemplate,
  emergencyAccessGrantRevokedTemplate,
  emergencyAccessReminderTemplate,
} from "../notifications/email-templates";
import { emailTranslator } from "../i18n/email-translator";
import { resolveUserEmailLocale } from "../i18n/resolve-user-email-locale";
import { hashToken } from "../auth/crypto.util";
import { User } from "../users/entities/user.entity";
import { UserPreference } from "../users/entities/user-preference.entity";
import { withSystemContext } from "../common/db/with-context";
import { affectedRowCount } from "../common/db/query-result";
import {
  JobClaimService,
  JobClaimType,
} from "../common/jobs/job-claim.service";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const CLAIM_TOKEN_BYTES = 32;
const CLAIM_TOKEN_TTL_DAYS = 30;

@Injectable()
export class EmergencyAccessMonitorService {
  private readonly logger = new Logger(EmergencyAccessMonitorService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly emailService: EmailService,
    private readonly encryption: AiEncryptionService,
    private readonly configService: ConfigService,
    private readonly i18n: I18nService,
    private readonly jobClaims: JobClaimService,
  ) {}

  /**
   * Move this owner from ungranted to granted, atomically. True for the one
   * caller that won.
   *
   * `granted_at IS NULL` and `enabled = true` are predicates of the UPDATE, so
   * PostgreSQL re-evaluates them after the row lock: exactly one replica gets a
   * row back, and an owner who disabled the feature between the sweep's read and
   * here is not granted at all.
   */
  private async claimGrant(ownerUserId: string): Promise<boolean> {
    const updated = await withScopedDb(this.dataSource, (manager) =>
      manager.query(
        `UPDATE emergency_access_settings
            SET granted_at = CURRENT_TIMESTAMP
          WHERE owner_user_id = $1
            AND granted_at IS NULL
            AND enabled = true
          RETURNING owner_user_id`,
        [ownerUserId],
      ),
    );
    return affectedRowCount(updated) > 0;
  }

  /** Hand a claimed grant back when no contact could be reached. */
  private async releaseGrant(ownerUserId: string): Promise<void> {
    await withScopedDb(this.dataSource, (manager) =>
      manager.query(
        `UPDATE emergency_access_settings
            SET granted_at = NULL
          WHERE owner_user_id = $1`,
        [ownerUserId],
      ),
    ).catch((error: unknown) =>
      this.logger.error(
        `Failed to release emergency-access grant claim for user ${ownerUserId}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      ),
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

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async runDailyCheck(): Promise<void> {
    if (!this.emailService.getStatus().configured) {
      this.logger.debug(
        "SMTP not configured, skipping emergency access checks",
      );
      return;
    }

    // RLS (task C4): cross-user sweep over every owner with emergency access
    // enabled; processOne reads/writes owner-keyed rows (users, the emergency-
    // access tables) for many users, so the whole sweep runs under a system
    // context. Inert at RLS_MODE=off -- only seeds AsyncLocalStorage.
    return withSystemContext(() => this.runDailyCheckWithinContext());
  }

  private async runDailyCheckWithinContext(): Promise<void> {
    const enabled = await this.scoped(EmergencyAccessSettings, (repo) =>
      repo.find({ where: { enabled: true } }),
    );
    if (enabled.length === 0) {
      this.logger.debug("No users with emergency access enabled");
      return;
    }

    this.logger.log(
      `Running emergency access check for ${enabled.length} user(s)`,
    );

    const appUrl = this.configService.get<string>(
      "PUBLIC_APP_URL",
      "http://localhost:3000",
    );

    let grants = 0;
    let reminders = 0;
    let skipped = 0;

    for (const settings of enabled) {
      try {
        const handled = await this.processOne(settings, appUrl);
        if (handled === "granted") grants += 1;
        else if (handled === "reminded") reminders += 1;
        else skipped += 1;
      } catch (error) {
        this.logger.error(
          `Emergency access processing failed for user ${settings.ownerUserId}`,
          error instanceof Error ? error.stack : error,
        );
      }
    }

    this.logger.log(
      `Emergency access check complete: ${grants} granted, ${reminders} reminded, ${skipped} skipped`,
    );
  }

  private async processOne(
    settings: EmergencyAccessSettings,
    appUrl: string,
  ): Promise<"granted" | "reminded" | "skipped"> {
    const owner = await this.scoped(User, (repo) =>
      repo.findOne({
        where: { id: settings.ownerUserId },
      }),
    );
    if (!owner || !owner.isActive || !owner.email) return "skipped";
    // Prefer last_activity_at (touched by every authenticated request); fall
    // back to last_login for users who have not done anything since the
    // backfill migration.
    const lastSeen = owner.lastActivityAt ?? owner.lastLogin;
    if (!lastSeen) return "skipped";

    const now = Date.now();
    const daysSinceLogin = Math.floor((now - lastSeen.getTime()) / MS_PER_DAY);

    // Step 0: the owner is active again after a grant fired. Revoke the
    // outstanding (unclaimed) magic links, re-arm monitoring, and tell the
    // owner. Without this, a contact could take over a fully-active account
    // for the entire 30-day link lifetime after the owner returned.
    if (
      settings.grantedAt !== null &&
      daysSinceLogin < settings.grantAfterDays
    ) {
      await this.revokeAfterReturn(settings, owner, appUrl);
      return "skipped";
    }

    // Step 1: grant cascade (only if not already granted)
    if (
      settings.grantedAt === null &&
      daysSinceLogin >= settings.grantAfterDays
    ) {
      const contacts = await this.scoped(EmergencyAccessContact, (repo) =>
        repo.find({
          where: { ownerUserId: settings.ownerUserId },
        }),
      );
      if (contacts.length === 0) return "skipped";

      // Claim the ungranted -> granted transition atomically, BEFORE generating a
      // single token.
      //
      // Every replica fires this cron and `grantedAt` was written only after the
      // emails went out, so two replicas could both see `grantedAt === null`,
      // both generate a fresh random token for the same contact, and both send.
      // Whichever token hash was stored last is the only valid one, so the other
      // delivered link is dead -- and the recipient of a dead emergency-access
      // link during a high-stakes recovery has no way to tell it from a revoked
      // one (audit P4-014). The loser now stands down before writing anything.
      if (!(await this.claimGrant(settings.ownerUserId))) {
        return "skipped";
      }

      const decryptedMessage = settings.messageCiphertext
        ? this.tryDecrypt(settings.messageCiphertext)
        : null;
      const ownerFullName =
        [owner.firstName, owner.lastName].filter(Boolean).join(" ") ||
        owner.email;
      const expiresAt = new Date(now + CLAIM_TOKEN_TTL_DAYS * MS_PER_DAY);

      let delivered = 0;
      for (const contact of contacts) {
        try {
          const rawToken = crypto
            .randomBytes(CLAIM_TOKEN_BYTES)
            .toString("hex");
          contact.claimTokenHash = hashToken(rawToken);
          contact.claimTokenExpiresAt = expiresAt;
          contact.claimTokenUsedAt = null;
          contact.claimVoidedReason = null;
          await this.scoped(EmergencyAccessContact, (repo) =>
            repo.save(contact),
          );

          const claimUrl = `${appUrl}/emergency-access/claim?token=${rawToken}`;
          // The contact may or may not be a Monize user; localize to their own
          // account language when they have one, otherwise fall back to default.
          const contactUser = await this.scoped(User, (repo) =>
            repo.findOne({
              where: { email: contact.email },
            }),
          );
          const lang = await withScopedDb(this.dataSource, (manager) =>
            resolveUserEmailLocale(
              manager.getRepository(UserPreference),
              contactUser?.id ?? null,
            ),
          );
          const t = emailTranslator(this.i18n, lang);
          const html = emergencyAccessGrantTemplate(
            {
              contactFirstName: contact.firstName,
              ownerFullName,
              message: decryptedMessage,
              claimUrl,
              expiresAt,
            },
            t,
          );
          await this.emailService.sendMail(
            contact.email,
            t(
              "emails.emergencyAccessGrant.subject",
              `You have been granted emergency access to ${ownerFullName}'s Monize account`,
              { owner: ownerFullName },
            ),
            html,
          );
          delivered += 1;
        } catch (error) {
          this.logger.error(
            `Failed to issue emergency access grant for contact ${contact.id}`,
            error instanceof Error ? error.stack : error,
          );
        }
      }

      // Only keep the grant if at least one contact actually received a link.
      // Otherwise hand it back so the next run retries -- a transient SMTP
      // failure must not permanently disable the safeguard. That behaviour
      // predates the claim and has to survive it, which is what the release
      // below is for.
      if (delivered === 0) {
        this.logger.error(
          `Emergency access grant for user ${settings.ownerUserId} delivered no contact emails; releasing the grant claim for retry`,
        );
        await this.releaseGrant(settings.ownerUserId);
        return "skipped";
      }

      return "granted";
    }

    // Step 2: reminder cascade (only if not already granted, at most once per day)
    if (
      settings.grantedAt === null &&
      daysSinceLogin >= settings.reminderAfterDays
    ) {
      // Same reasoning as the grant: the "at most once per day" rule was a read
      // of `lastReminderSentAt` followed by a write after the email, so two
      // replicas both passed it and the owner got the notice twice. The claim is
      // the rule now, keyed on the local date.
      const reminderKey = todayKeyFrom(new Date(now));
      const claimedReminder = await this.jobClaims.claimOnce(
        JobClaimType.EmergencyAccessReminder,
        settings.ownerUserId,
        reminderKey,
      );
      if (!claimedReminder) {
        return "skipped";
      }

      const contacts = await this.scoped(EmergencyAccessContact, (repo) =>
        repo.find({
          where: {
            ownerUserId: settings.ownerUserId,
            claimTokenUsedAt: IsNull(),
          },
        }),
      );
      const daysUntilGrant = Math.max(
        0,
        settings.grantAfterDays - daysSinceLogin,
      );
      const reminderLang = await withScopedDb(this.dataSource, (manager) =>
        resolveUserEmailLocale(
          manager.getRepository(UserPreference),
          settings.ownerUserId,
        ),
      );
      const reminderT = emailTranslator(this.i18n, reminderLang);
      const html = emergencyAccessReminderTemplate(
        {
          ownerFirstName: owner.firstName || "",
          daysSinceLogin,
          daysUntilGrant,
          contacts: contacts.map((c) => ({
            firstName: c.firstName,
            email: c.email,
          })),
          appUrl,
        },
        reminderT,
      );
      try {
        await this.emailService.sendMail(
          owner.email,
          daysSinceLogin === 1
            ? reminderT(
                "emails.emergencyAccessReminder.subjectOne",
                "Monize: your account has been inactive for 1 day",
              )
            : reminderT(
                "emails.emergencyAccessReminder.subjectMany",
                `Monize: your account has been inactive for ${daysSinceLogin} days`,
                { daysSinceLogin },
              ),
          html,
        );
      } catch (error) {
        // Give the day back rather than consuming it on a failed send.
        await this.jobClaims
          .release(
            JobClaimType.EmergencyAccessReminder,
            settings.ownerUserId,
            reminderKey,
          )
          .catch(() => undefined);
        throw error;
      }

      // Targeted UPDATE, not a save of the entity read at the top of the sweep:
      // that snapshot would write back every other column too, so an owner
      // disabling the feature mid-sweep would find it silently re-enabled.
      await this.scoped(EmergencyAccessSettings, (repo) =>
        repo
          .createQueryBuilder()
          .update(EmergencyAccessSettings)
          .set({ lastReminderSentAt: new Date(now) })
          .where("owner_user_id = :id", { id: settings.ownerUserId })
          .execute(),
      );
      return "reminded";
    }

    return "skipped";
  }

  /**
   * The owner signed back in after a grant had fired. Void every outstanding
   * (unclaimed) magic link, clear the grant marker so monitoring re-arms, and
   * notify the owner that access had been granted in their absence.
   */
  private async revokeAfterReturn(
    settings: EmergencyAccessSettings,
    owner: User,
    appUrl: string,
  ): Promise<void> {
    const result = await this.scoped(EmergencyAccessContact, (repo) =>
      repo
        .createQueryBuilder()
        .update(EmergencyAccessContact)
        .set({
          claimTokenHash: null,
          claimTokenExpiresAt: null,
          claimTokenUsedAt: () => "CURRENT_TIMESTAMP",
          claimVoidedReason: "owner_returned",
        })
        .where("owner_user_id = :userId", { userId: settings.ownerUserId })
        .andWhere("claim_token_hash IS NOT NULL")
        .andWhere("claim_token_used_at IS NULL")
        .execute(),
    );

    // Targeted UPDATE for the same reason as above: re-saving the sweep's
    // snapshot would revert any other setting the owner changed meanwhile.
    await this.scoped(EmergencyAccessSettings, (repo) =>
      repo
        .createQueryBuilder()
        .update(EmergencyAccessSettings)
        .set({ grantedAt: null, lastReminderSentAt: null })
        .where("owner_user_id = :id", { id: settings.ownerUserId })
        .execute(),
    );

    this.logger.warn(
      `Owner ${settings.ownerUserId} active again after a grant; voided ${
        result.affected ?? 0
      } outstanding emergency-access link(s) and re-armed monitoring`,
    );

    if (!owner.email) return;
    try {
      const revokedLang = await withScopedDb(this.dataSource, (manager) =>
        resolveUserEmailLocale(
          manager.getRepository(UserPreference),
          settings.ownerUserId,
        ),
      );
      const revokedT = emailTranslator(this.i18n, revokedLang);
      const html = emergencyAccessGrantRevokedTemplate(
        {
          ownerFirstName: owner.firstName || "",
          appUrl,
        },
        revokedT,
      );
      await this.emailService.sendMail(
        owner.email,
        revokedT(
          "emails.emergencyAccessGrantRevoked.subject",
          "Monize: emergency access was granted while you were away",
        ),
        html,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send emergency-access revocation notice to owner ${settings.ownerUserId}`,
        error instanceof Error ? error.stack : error,
      );
    }
  }

  private tryDecrypt(ciphertext: string): string | null {
    if (!this.encryption.isConfigured()) return null;
    try {
      return this.encryption.decrypt(ciphertext);
    } catch (error) {
      this.logger.error(
        "Failed to decrypt emergency access message for grant email",
        error instanceof Error ? error.stack : error,
      );
      return null;
    }
  }
}

/** `YYYY-MM-DD` in server-local time -- the reminder claim's daily key. */
function todayKeyFrom(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
