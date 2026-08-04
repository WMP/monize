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

/**
 * How long one replica holds the right to send this owner's notice.
 *
 * A **lease**, not a permanent claim, and that distinction is the whole of
 * FV4-005: a permanent claim taken before the send is consumed by a replica that
 * dies before sending, so the notice is owed forever and nothing knows. The
 * lease only has to outlast an SMTP round trip; when it expires, whether the
 * work is still owed is decided by the delivery record, not by the claim.
 */
const SEND_LEASE_MS = 10 * 60 * 1000;

/**
 * The owner fields a grant notice needs. Narrowed to a non-null `email` because
 * `processOne` refuses an owner without one, and the notice falls back to it for
 * a display name.
 */
interface GrantNoticeOwner {
  firstName: string | null;
  lastName: string | null;
  email: string;
}

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

  /**
   * The owner's contacts that have not yet been sent a link.
   *
   * `claim_notified_at IS NULL` is the delivery record, so this answers "what is
   * still owed" rather than "who exists" -- which is what makes a resumed grant
   * safe. A contact who already received a link is never in this list, so a retry
   * cannot re-issue their token and kill the link in their inbox.
   */
  private contactsAwaitingNotice(
    ownerUserId: string,
  ): Promise<EmergencyAccessContact[]> {
    return this.scoped(EmergencyAccessContact, (repo) =>
      repo.find({
        where: { ownerUserId, claimNotifiedAt: IsNull() },
        order: { createdAt: "ASC" },
      }),
    );
  }

  /**
   * Issue a claim token to each contact still owed one and send their link.
   *
   * Returns how many were actually delivered. Each contact's
   * `claim_notified_at` is stamped only after its own `sendMail` resolved, so a
   * process killed part-way through leaves the rest owed and recoverable, and a
   * recipient who did get a link is never sent a second token.
   */
  private async notifyGrantContacts(
    settings: EmergencyAccessSettings,
    owner: GrantNoticeOwner,
    contacts: EmergencyAccessContact[],
    appUrl: string,
    now: number,
  ): Promise<number> {
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
        const rawToken = await this.credentialFor(contact, expiresAt);

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
        // The delivery record, written after the send and never before it, and it
        // clears the credential in the same statement: once delivery is
        // acknowledged there is nothing left to re-send, so the token must not
        // outlive it.
        await this.markContactNotified(contact.id, new Date(now));
        delivered += 1;
      } catch (error) {
        this.logger.error(
          `Failed to issue emergency access grant for contact ${contact.id}`,
          error instanceof Error ? error.stack : error,
        );
      }
    }
    return delivered;
  }

  /**
   * Has this owner's reminder for `dayKey` already gone out?
   *
   * Read under the lease, from `last_reminder_sent_at` -- the record written
   * after a successful send. This, not the claim, is what enforces "at most one
   * per local day": a claim taken before the send says only that somebody
   * intended to send, and an intention does not survive the process holding it.
   */
  private async reminderAlreadySent(
    ownerUserId: string,
    dayKey: string,
  ): Promise<boolean> {
    const row = await this.scoped(EmergencyAccessSettings, (repo) =>
      repo.findOne({
        where: { ownerUserId },
        select: ["ownerUserId", "lastReminderSentAt"],
      }),
    );
    const sentAt = row?.lastReminderSentAt;
    return sentAt != null && todayKeyFrom(new Date(sentAt)) === dayKey;
  }

  private async releaseReminderLease(
    ownerUserId: string,
    dayKey: string,
  ): Promise<void> {
    await this.jobClaims
      .release(JobClaimType.EmergencyAccessReminder, ownerUserId, dayKey)
      .catch(() => undefined);
  }

  private async markContactNotified(
    contactId: string,
    at: Date,
  ): Promise<void> {
    await this.scoped(EmergencyAccessContact, (repo) =>
      repo
        .createQueryBuilder()
        .update(EmergencyAccessContact)
        .set({ claimNotifiedAt: at, claimTokenCiphertext: null })
        .where("id = :id", { id: contactId })
        .execute(),
    );
  }

  /**
   * The claim token to put in this contact's email: the one already issued if the
   * notice is still owed, a fresh one otherwise.
   *
   * This is what makes a retry safe. SMTP acceptance and the delivery record
   * cannot commit together, so a process killed between them leaves a contact who
   * may well be holding a working link while the row still says the notice is
   * owed. Minting a new token then overwrites the hash and kills the delivered
   * link -- and if this send fails too, the only link in their inbox no longer
   * works, during a recovery, indistinguishable from one the owner revoked
   * (audit RV4-004). So the credential is issued once and reused until delivery is
   * acknowledged, at which point `markContactNotified` clears it.
   *
   * A stored credential that cannot be decrypted -- the key was rotated, or the row
   * predates the column -- is the one case where the token does rotate. That is
   * logged, because re-issuing invalidates whatever was delivered before, and the
   * decision to prefer a link that works over one nobody can confirm should be
   * visible rather than inferred from an empty column.
   */
  private async credentialFor(
    contact: EmergencyAccessContact,
    expiresAt: Date,
  ): Promise<string> {
    if (contact.claimTokenCiphertext && contact.claimTokenHash) {
      try {
        const stored = this.encryption.decrypt(contact.claimTokenCiphertext);
        if (hashToken(stored) === contact.claimTokenHash) {
          // Re-send the same URL. Nothing on the row changes, so a link already
          // delivered keeps working whatever happens to this attempt.
          return stored;
        }
        this.logger.error(
          `Stored emergency-access credential for contact ${contact.id} does not ` +
            `match its hash; issuing a new link, which invalidates any already delivered`,
        );
      } catch (error) {
        this.logger.error(
          `Could not read the stored emergency-access credential for contact ` +
            `${contact.id}; issuing a new link, which invalidates any already ` +
            `delivered: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } else if (contact.claimTokenHash) {
      // A token was issued by a version that did not keep it, so it cannot be
      // re-sent. Replacing it is deliberate: a delivered link beats one nobody can
      // confirm, and asserting delivery instead would disarm the safeguard
      // permanently (audit RV4-003).
      this.logger.warn(
        `Emergency-access contact ${contact.id} has a token this version cannot ` +
          `re-send; issuing a new link, which invalidates any already delivered`,
      );
    }

    const rawToken = crypto.randomBytes(CLAIM_TOKEN_BYTES).toString("hex");
    contact.claimTokenHash = hashToken(rawToken);
    contact.claimTokenExpiresAt = expiresAt;
    contact.claimTokenUsedAt = null;
    contact.claimVoidedReason = null;
    // The credential and its hash commit together, before the send: a hash with
    // no recoverable token is exactly the state that forces a rotation later.
    contact.claimTokenCiphertext = this.encryption.encrypt(rawToken);
    await this.scoped(EmergencyAccessContact, (repo) => repo.save(contact));
    return rawToken;
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
    // Captured here rather than read again where it is used: TypeScript discards
    // a narrowing of `owner.email` at the first `await` below, because the
    // property is declared nullable and a call could have changed it.
    const noticeOwner: GrantNoticeOwner = {
      firstName: owner.firstName,
      lastName: owner.lastName,
      email: owner.email,
    };
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
      const pending = await this.contactsAwaitingNotice(settings.ownerUserId);
      if (pending.length === 0) return "skipped";

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

      const delivered = await this.notifyGrantContacts(
        settings,
        noticeOwner,
        pending,
        appUrl,
        now,
      );

      // Only keep the grant if at least one contact actually received a link.
      // Otherwise hand it back so the next run retries -- a transient SMTP
      // failure must not permanently disable the safeguard. That behaviour
      // predates the claim and has to survive it, which is what the release
      // below is for.
      //
      // A *partial* delivery keeps the grant and leaves the rest owed: the
      // contacts still carrying a NULL `claim_notified_at` are picked up by
      // step 1b below, without re-issuing a token for anyone who already holds a
      // working link.
      if (delivered === 0) {
        this.logger.error(
          `Emergency access grant for user ${settings.ownerUserId} delivered no contact emails; releasing the grant claim for retry`,
        );
        await this.releaseGrant(settings.ownerUserId);
        return "skipped";
      }

      return "granted";
    }

    // Step 1b: a grant that was claimed but never delivered.
    //
    // `granted_at` used to be the claim *and* the grant state, so a replica
    // killed between the conditional transition and the emails left an account
    // permanently marked granted with no contact holding a link -- the safeguard
    // silently disarmed at the moment it was supposed to fire, and step 1's
    // `granted_at IS NULL` predicate meant nothing would ever look again
    // (audit FV4-004).
    //
    // The recovery is derived rather than scheduled: a contact of a granted owner
    // whose `claim_notified_at` is NULL is a link still owed, whatever caused it
    // -- a crash, an SMTP failure that only some recipients hit, or a contact the
    // owner added after the grant fired. Nothing has to remember to enqueue a
    // retry, which is the property that makes it hold (docs/cron-jobs.md).
    if (
      settings.grantedAt !== null &&
      daysSinceLogin >= settings.grantAfterDays
    ) {
      const pending = await this.contactsAwaitingNotice(settings.ownerUserId);
      if (pending.length === 0) return "skipped";

      // A lease, so two replicas do not both resume the same grant, and a replica
      // killed while resuming does not block tomorrow's attempt.
      const lease = await this.jobClaims.claimLease(
        JobClaimType.EmergencyAccessGrantNotify,
        settings.ownerUserId,
        todayKeyFrom(new Date(now)),
        SEND_LEASE_MS,
      );
      if (!lease) return "skipped";

      this.logger.warn(
        `Emergency access grant for user ${settings.ownerUserId} has ${pending.length} contact(s) still owed a link; resuming delivery`,
      );
      const delivered = await this.notifyGrantContacts(
        settings,
        noticeOwner,
        pending,
        appUrl,
        now,
      );
      return delivered > 0 ? "granted" : "skipped";
    }

    // Step 2: reminder cascade (only if not already granted, at most once per day)
    if (
      settings.grantedAt === null &&
      daysSinceLogin >= settings.reminderAfterDays
    ) {
      // Two separate jobs, and they must not be confused for one:
      //
      // - The **lease** stops two replicas sending at the same moment. It was a
      //   permanent `claimOnce`, which also made it the delivery record -- so a
      //   replica killed between the claim and the send consumed the day and sent
      //   nothing, and only a *handled* SMTP error released it. A lease expires,
      //   so a dead replica costs the retry window rather than the notice
      //   (audit FV4-005).
      // - The **delivery record** is `last_reminder_sent_at`, moved only after a
      //   send succeeds. Re-read here, under the lease, because that is what
      //   makes "at most once per local day" true across a process death: a claim
      //   answers "may I send now", not "has this been sent".
      const reminderKey = todayKeyFrom(new Date(now));
      const reminderLease = await this.jobClaims.claimLease(
        JobClaimType.EmergencyAccessReminder,
        settings.ownerUserId,
        reminderKey,
        SEND_LEASE_MS,
      );
      if (!reminderLease) {
        return "skipped";
      }
      if (await this.reminderAlreadySent(settings.ownerUserId, reminderKey)) {
        await this.releaseReminderLease(settings.ownerUserId, reminderKey);
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
        // Hand the lease back so the next run can retry immediately rather than
        // waiting it out. Nothing was delivered, so the delivery record below is
        // deliberately not written -- that is what keeps the notice owed.
        await this.releaseReminderLease(settings.ownerUserId, reminderKey);
        throw error;
      }

      // The delivery record. Targeted UPDATE, not a save of the entity read at
      // the top of the sweep: that snapshot would write back every other column
      // too, so an owner disabling the feature mid-sweep would find it silently
      // re-enabled.
      await this.scoped(EmergencyAccessSettings, (repo) =>
        repo
          .createQueryBuilder()
          .update(EmergencyAccessSettings)
          .set({ lastReminderSentAt: new Date(now) })
          .where("owner_user_id = :id", { id: settings.ownerUserId })
          .execute(),
      );
      await this.releaseReminderLease(settings.ownerUserId, reminderKey);
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
