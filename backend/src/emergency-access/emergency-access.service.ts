import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DataSource, EntityTarget, ObjectLiteral, Repository } from "typeorm";
import { withScopedDb } from "../common/db/scoped-db";
import { tr } from "../i18n/translate";
import { EmergencyAccessSettings } from "./entities/emergency-access-settings.entity";
import { EmergencyAccessContact } from "./entities/emergency-access-contact.entity";
import { UpsertSettingsDto } from "./dto/upsert-settings.dto";
import { UpsertContactDto } from "./dto/upsert-contact.dto";
import { AiEncryptionService } from "../ai/ai-encryption.service";
import { EmailService } from "../notifications/email.service";
import { User } from "../users/entities/user.entity";

export interface ContactView {
  id: string;
  firstName: string;
  email: string;
  createdAt: Date;
}

export interface MessageMetadata {
  hasMessage: boolean;
  charCount: number;
  updatedAt: Date | null;
}

export interface SettingsView {
  emailConfigured: boolean;
  /**
   * Whether the credential encryption this feature's delivery path needs is
   * configured.
   *
   * Separate from `emailConfigured` because they can fail independently and the
   * consequence of the second is silent: a grant issues a claim token, stores it
   * encrypted so a retry can re-send the same link, and without a key that store
   * throws for every contact -- so the notice is never delivered and nothing on
   * screen says why (audit RRV4-003). The feature refuses to be enabled without
   * it, and this field is what lets the UI say so before the user tries.
   */
  credentialEncryptionConfigured: boolean;
  enabled: boolean;
  grantAfterDays: number;
  reminderAfterDays: number;
  messageMetadata: MessageMetadata;
  lastReminderSentAt: Date | null;
  grantedAt: Date | null;
  lastActivityAt: Date | null;
  contacts: ContactView[];
}

@Injectable()
export class EmergencyAccessService {
  private readonly logger = new Logger(EmergencyAccessService.name);

  constructor(
    private readonly encryption: AiEncryptionService,
    private readonly emailService: EmailService,
    private readonly dataSource: DataSource,
  ) {}

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

  private toContactView(c: EmergencyAccessContact): ContactView {
    return {
      id: c.id,
      firstName: c.firstName,
      email: c.email,
      createdAt: c.createdAt,
    };
  }

  private decryptMessage(ciphertext: string | null): string | null {
    if (!ciphertext) return null;
    if (!this.encryption.isConfigured()) {
      this.logger.warn(
        "Encryption key not configured; emergency access message cannot be decrypted",
      );
      return null;
    }
    try {
      return this.encryption.decrypt(ciphertext);
    } catch (error) {
      this.logger.error(
        "Failed to decrypt emergency access message",
        error instanceof Error ? error.stack : error,
      );
      return null;
    }
  }

  private buildMessageMetadata(
    settings: EmergencyAccessSettings | null,
  ): MessageMetadata {
    const decrypted = this.decryptMessage(settings?.messageCiphertext ?? null);
    return {
      hasMessage: !!decrypted,
      charCount: decrypted?.length ?? 0,
      updatedAt: decrypted ? (settings?.updatedAt ?? null) : null,
    };
  }

  async getView(userId: string): Promise<SettingsView> {
    const [settings, contacts, user] = await Promise.all([
      this.scoped(EmergencyAccessSettings, (repo) =>
        repo.findOne({ where: { ownerUserId: userId } }),
      ),
      this.scoped(EmergencyAccessContact, (repo) =>
        repo.find({
          where: { ownerUserId: userId },
          order: { createdAt: "ASC" },
        }),
      ),
      this.scoped(User, (repo) => repo.findOne({ where: { id: userId } })),
    ]);

    const emailConfigured = this.emailService.getStatus().configured;

    return {
      emailConfigured,
      credentialEncryptionConfigured: this.encryption.isConfigured(),
      enabled: settings?.enabled ?? false,
      grantAfterDays: settings?.grantAfterDays ?? 14,
      reminderAfterDays: settings?.reminderAfterDays ?? 7,
      messageMetadata: this.buildMessageMetadata(settings ?? null),
      lastReminderSentAt: settings?.lastReminderSentAt ?? null,
      grantedAt: settings?.grantedAt ?? null,
      lastActivityAt: user?.lastActivityAt ?? user?.lastLogin ?? null,
      contacts: contacts.map((c) => this.toContactView(c)),
    };
  }

  /**
   * Read the decrypted emergency-access message. Guarded by step-up auth at
   * the controller layer -- callers must have already proven possession of
   * their strongest factor in the last few minutes.
   */
  async getMessage(userId: string): Promise<{ message: string | null }> {
    const settings = await this.scoped(EmergencyAccessSettings, (repo) =>
      repo.findOne({
        where: { ownerUserId: userId },
      }),
    );
    return {
      message: this.decryptMessage(settings?.messageCiphertext ?? null),
    };
  }

  async upsertSettings(
    userId: string,
    dto: UpsertSettingsDto,
  ): Promise<SettingsView> {
    if (!this.emailService.getStatus().configured) {
      throw new ServiceUnavailableException(
        tr(
          "errors.emergencyAccess.smtpNotConfigured",
          "Email is not configured. Emergency access cannot be enabled until SMTP is set up.",
        ),
      );
    }
    // The grant path stores each contact's claim token encrypted, so a retry
    // re-sends the same link instead of one that invalidates what is already in
    // their inbox. Without a key that store throws for every contact, the notice is
    // never delivered, and the only trace is a per-contact log line -- so a user
    // could arm a recovery mechanism that can never fire. Refuse instead, visibly
    // (audit RRV4-003).
    if (dto.enabled && !this.encryption.isConfigured()) {
      throw new ServiceUnavailableException(
        tr(
          "errors.emergencyAccess.encryptionRequiredToEnable",
          "Credential encryption is not configured. Emergency access cannot be enabled until AI_ENCRYPTION_KEY is set, because a grant has to store each contact's access link securely.",
        ),
      );
    }

    await withScopedDb(this.dataSource, async (manager) => {
      let row = await manager.findOne(EmergencyAccessSettings, {
        where: { ownerUserId: userId },
      });
      if (!row) {
        row = manager.create(EmergencyAccessSettings, {
          ownerUserId: userId,
        });
      }

      const wasEnabled = row.enabled;
      row.enabled = dto.enabled;
      row.grantAfterDays = dto.grantAfterDays;
      row.reminderAfterDays = dto.reminderAfterDays;

      // If the owner is (re-)enabling, reset the grant marker and the
      // last-reminder gate so the cron starts fresh.
      if (!wasEnabled && dto.enabled) {
        row.grantedAt = null;
        row.lastReminderSentAt = null;
      }
      // If the owner explicitly disables, also clear the grant marker so
      // a subsequent re-enable starts fresh.
      if (wasEnabled && !dto.enabled) {
        row.grantedAt = null;
        row.lastReminderSentAt = null;
        // Void any outstanding magic links -- the owner has revoked the feature.
        // The delivery markers are deliberately left alone: a re-enable does not
        // have to reset them, because the next grant advances the owner's
        // `grant_generation` past whatever the contacts were notified at
        // (audit RRV4-004).
        await manager
          .createQueryBuilder()
          .update(EmergencyAccessContact)
          .set({
            claimTokenHash: null,
            claimTokenExpiresAt: null,
            claimTokenUsedAt: () => "CURRENT_TIMESTAMP",
            claimVoidedReason: "owner_revoked",
            // The credential goes with the hash that made it usable: worthless
            // without one, but still a recoverable secret under the application
            // key, and nothing will ever want it again (DR-RRV4-03).
            claimTokenCiphertext: null,
          })
          .where("owner_user_id = :userId", { userId })
          .andWhere("claim_token_hash IS NOT NULL")
          .andWhere("claim_token_used_at IS NULL")
          .execute();
      }

      await manager.save(row);
    });

    return this.getView(userId);
  }

  /**
   * Persist a new encrypted emergency-access message. Guarded by step-up
   * auth at the controller layer.
   */
  async updateMessage(
    userId: string,
    message: string | null | undefined,
  ): Promise<MessageMetadata> {
    const trimmed = message?.trim() ?? null;
    if (trimmed && !this.encryption.isConfigured()) {
      throw new ServiceUnavailableException(
        tr(
          "errors.emergencyAccess.encryptionNotConfigured",
          "Encryption key is not configured. The free-form message cannot be stored securely until AI_ENCRYPTION_KEY is set.",
        ),
      );
    }

    return withScopedDb(this.dataSource, async (manager) => {
      let row = await manager.findOne(EmergencyAccessSettings, {
        where: { ownerUserId: userId },
      });
      if (!row) {
        row = manager.create(EmergencyAccessSettings, {
          ownerUserId: userId,
        });
      }
      row.messageCiphertext = trimmed ? this.encryption.encrypt(trimmed) : null;
      const saved = await manager.save(row);
      return this.buildMessageMetadata(saved);
    });
  }

  async addContact(
    userId: string,
    dto: UpsertContactDto,
  ): Promise<ContactView> {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const existing = await this.scoped(EmergencyAccessContact, (repo) =>
      repo
        .createQueryBuilder("c")
        .where("c.owner_user_id = :userId", { userId })
        .andWhere("lower(c.email) = :email", { email: normalizedEmail })
        .getOne(),
    );
    if (existing) {
      throw new ConflictException(
        tr(
          "errors.emergencyAccess.contactEmailExists",
          "An emergency contact with this email already exists.",
        ),
      );
    }
    const contact = await this.scoped(EmergencyAccessContact, (repo) =>
      repo.save(
        repo.create({
          ownerUserId: userId,
          firstName: dto.firstName.trim(),
          email: dto.email.trim(),
        }),
      ),
    );
    return this.toContactView(contact);
  }

  async updateContact(
    userId: string,
    contactId: string,
    dto: UpsertContactDto,
  ): Promise<ContactView> {
    const contact = await this.scoped(EmergencyAccessContact, (repo) =>
      repo.findOne({
        where: { id: contactId, ownerUserId: userId },
      }),
    );
    if (!contact) {
      throw new NotFoundException(
        tr("errors.emergencyAccess.contactNotFound", "Contact not found"),
      );
    }
    const normalizedEmail = dto.email.trim().toLowerCase();
    if (normalizedEmail !== contact.email.toLowerCase()) {
      const dup = await this.scoped(EmergencyAccessContact, (repo) =>
        repo
          .createQueryBuilder("c")
          .where("c.owner_user_id = :userId", { userId })
          .andWhere("lower(c.email) = :email", { email: normalizedEmail })
          .andWhere("c.id <> :id", { id: contactId })
          .getOne(),
      );
      if (dup) {
        throw new ConflictException(
          tr(
            "errors.emergencyAccess.contactEmailExists",
            "An emergency contact with this email already exists.",
          ),
        );
      }
    }
    const emailChanged = normalizedEmail !== contact.email.toLowerCase();
    contact.firstName = dto.firstName.trim();
    contact.email = dto.email.trim();
    // Editing email invalidates any in-flight magic link.
    contact.claimTokenHash = null;
    contact.claimTokenExpiresAt = null;
    // And the credential it made usable (DR-RRV4-03).
    contact.claimTokenCiphertext = null;
    if (emailChanged) {
      // A different address has not been notified, whatever the old one received.
      // This is the one per-contact reset the generation cannot derive: the owner's
      // grant cycle has not moved, so without it a grant already in flight would
      // consider the corrected address already served (audit RRV4-004).
      contact.claimNotifiedAt = null;
      contact.notifiedGrantGeneration = null;
    }
    await this.scoped(EmergencyAccessContact, (repo) => repo.save(contact));
    return this.toContactView(contact);
  }

  async removeContact(userId: string, contactId: string): Promise<void> {
    const result = await this.scoped(EmergencyAccessContact, (repo) =>
      repo.delete({
        id: contactId,
        ownerUserId: userId,
      }),
    );
    if (!result.affected) {
      throw new NotFoundException(
        tr("errors.emergencyAccess.contactNotFound", "Contact not found"),
      );
    }
  }

  async resetGrantedState(userId: string): Promise<SettingsView> {
    const settings = await this.scoped(EmergencyAccessSettings, (repo) =>
      repo.findOne({
        where: { ownerUserId: userId },
      }),
    );
    if (!settings) {
      throw new NotFoundException(
        tr(
          "errors.emergencyAccess.notConfigured",
          "Emergency access not configured",
        ),
      );
    }
    settings.grantedAt = null;
    settings.lastReminderSentAt = null;
    await this.scoped(EmergencyAccessSettings, (repo) => repo.save(settings));
    // As with a disable: the delivery markers stay, because the next grant's
    // generation is what makes every contact owed a link again (audit RRV4-004).
    await this.scoped(EmergencyAccessContact, (repo) =>
      repo
        .createQueryBuilder()
        .update(EmergencyAccessContact)
        .set({
          claimTokenHash: null,
          claimTokenExpiresAt: null,
          claimTokenUsedAt: () => "CURRENT_TIMESTAMP",
          claimVoidedReason: "owner_revoked",
          // The credential goes with the hash that made it usable (DR-RRV4-03).
          claimTokenCiphertext: null,
        })
        .where("owner_user_id = :userId", { userId })
        .andWhere("claim_token_hash IS NOT NULL")
        .andWhere("claim_token_used_at IS NULL")
        .execute(),
    );
    return this.getView(userId);
  }
}
