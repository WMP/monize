import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { isIP } from "node:net";
import { DataSource } from "typeorm";
import { withScopedDb } from "../../common/db/scoped-db";
import { EncryptionService } from "../../common/encryption/encryption.service";
import { tr } from "../../i18n/translate";
import { User } from "../../users/entities/user.entity";
import {
  EmailReceiptAiMode,
  EmailReceiptMailbox,
} from "../entities/email-receipt-mailbox.entity";
import {
  ImapMailboxClient,
  MailboxConnection,
  MailboxCursor,
} from "../imap/imap-mailbox-client";
import {
  assertMailboxHostAllowed,
  MailboxHostPolicy,
  resolveMailboxHostPolicy,
} from "../imap/mailbox-host-policy";
import {
  TestEmailReceiptMailboxDto,
  UpsertEmailReceiptMailboxDto,
} from "./dto/upsert-email-receipt-mailbox.dto";
import { describeMailboxFailure, mailboxSecrets } from "./mailbox-failure.util";
import {
  EmailReceiptMailboxTestResult,
  EmailReceiptMailboxView,
  toMailboxView,
} from "./email-receipt-mailbox.view";

const DEFAULT_FOLDER = "INBOX";
/** PostgreSQL's unique_violation, raised by a second mailbox for one user. */
const UNIQUE_VIOLATION = "23505";

/** A stored mailbox ready for the poll: decrypted connection, cursor and switches. */
export interface LoadedEmailReceiptMailbox {
  readonly mailboxId: string;
  readonly connection: MailboxConnection;
  /** The plaintext password, for redacting a failure line. Never log or store it. */
  readonly secrets: readonly string[];
  readonly cursor: MailboxCursor;
  readonly enabled: boolean;
  readonly aiMode: EmailReceiptAiMode;
  readonly autoApply: boolean;
}

/** What one poll stores about the mailbox's cursor. */
export interface MailboxCursorUpdate {
  readonly uidValidity: string;
  /** Null leaves the stored UID where it is (or clears it when UIDVALIDITY changed). */
  readonly lastUid: string | null;
}

/**
 * The user's one IMAP mailbox: its settings, its connection test and the
 * bookkeeping a poll writes back (design sections 3, 4 and 8).
 *
 * The password is encrypted with `EncryptionService` before it is stored and
 * decrypted only in `loadConnection` and the connection test; it is never part
 * of a view, a log line or a stored error (INV-RECEIPT-005). A mailbox host is
 * checked against the owner's policy before anything is written
 * (INV-RECEIPT-004), and a changed host or user name needs the password typed
 * again, so a stolen session cannot point the stored password at a server of its
 * own. All database access is `withScopedDb`, keyed on the JWT's user.
 */
@Injectable()
export class EmailReceiptMailboxService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly encryption: EncryptionService,
    private readonly imap: ImapMailboxClient,
  ) {}

  /** The user's mailbox as a client sees it, or null when none is set up. */
  async getView(userId: string): Promise<EmailReceiptMailboxView | null> {
    const row = await withScopedDb(this.dataSource, (m) =>
      m.getRepository(EmailReceiptMailbox).findOne({ where: { userId } }),
    );
    return row ? this.view(row) : null;
  }

  /**
   * Create or replace the user's mailbox settings. Everything that can refuse
   * the request runs before the write: the host policy (outside the transaction,
   * since it resolves a name), and inside it, under the row lock, the password
   * rules. A change of host, user name or folder starts the poll over (the
   * cursor names messages in the old mailbox); a password alone does not.
   */
  async upsert(
    userId: string,
    dto: UpsertEmailReceiptMailboxDto,
  ): Promise<EmailReceiptMailboxView> {
    const host = normalizeHost(dto.host);
    const username = dto.username.trim();
    const folder = dto.folder?.trim() || DEFAULT_FOLDER;
    const password = dto.password ? dto.password : undefined;
    this.requireEncryption();
    await this.resolvePolicy(userId, host, dto.port);
    const passwordEnc =
      password === undefined ? undefined : this.encryption.encrypt(password);

    try {
      const row = await withScopedDb(this.dataSource, async (m) => {
        const repo = m.getRepository(EmailReceiptMailbox);
        const existing = await repo.findOne({
          where: { userId },
          lock: { mode: "pessimistic_write" },
        });

        if (!existing) {
          if (passwordEnc === undefined) throw passwordRequired();
          return repo.save(
            repo.create({
              userId,
              host,
              port: dto.port,
              security: dto.security,
              username,
              passwordEnc,
              folder,
              enabled: dto.enabled,
              aiMode: dto.aiMode,
              autoApply: dto.autoApply,
            }),
          );
        }

        const targetChanged =
          existing.host !== host || existing.username !== username;
        if (targetChanged && passwordEnc === undefined) {
          throw passwordRequiredForChange();
        }
        const mailboxChanged = targetChanged || existing.folder !== folder;
        const credentialsChanged = mailboxChanged || passwordEnc !== undefined;
        await repo.update(
          { id: existing.id, userId },
          {
            host,
            port: dto.port,
            security: dto.security,
            username,
            folder,
            enabled: dto.enabled,
            aiMode: dto.aiMode,
            autoApply: dto.autoApply,
            ...(passwordEnc === undefined ? {} : { passwordEnc }),
            // The cursor names messages of the mailbox it was read from.
            ...(mailboxChanged ? { uidValidity: null, lastUid: null } : {}),
            // An error about the old settings says nothing about the new ones.
            ...(credentialsChanged
              ? { lastError: null, lastErrorAt: null }
              : {}),
          },
        );
        return repo.findOneByOrFail({ id: existing.id, userId });
      });
      return this.view(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          tr(
            "errors.emailReceipts.mailboxExists",
            "A mailbox is already set up for this account.",
          ),
        );
      }
      throw error;
    }
  }

  /**
   * Delete the user's mailbox. Its stored emails go with it (the foreign key
   * cascades), and any open review request raised for one of them is rejected
   * in the same transaction, so nothing is left in the inbox pointing at an
   * email that no longer exists.
   */
  async remove(userId: string): Promise<void> {
    await withScopedDb(this.dataSource, async (m) => {
      // The refusal comes first: nothing is written for a mailbox that is not there.
      const deleted = await m
        .getRepository(EmailReceiptMailbox)
        .delete({ userId });
      if (!deleted.affected) throw mailboxNotFound();
      await m.query(
        `UPDATE ai_review_requests
            SET status = 'rejected'
          WHERE user_id = $1
            AND kind = 'email_receipt'
            AND status IN ('pending', 'claimed', 'proposed')`,
        [userId],
      );
    });
  }

  /**
   * Try a connection without saving anything. With no draft the stored settings
   * are tried; with one, any field left out is read from the stored mailbox. The
   * stored password is used when none is sent, and only for the stored host and
   * user name. A host the policy refuses is a 400, like a save; a connection
   * that fails is `{ ok: false }` with a bounded line that cannot hold the
   * password.
   */
  async testConnection(
    userId: string,
    dto?: TestEmailReceiptMailboxDto,
  ): Promise<EmailReceiptMailboxTestResult> {
    const stored = await this.readStored(userId);
    const host =
      dto?.host !== undefined ? normalizeHost(dto.host) : stored?.host;
    const port = dto?.port ?? stored?.port;
    const security = dto?.security ?? stored?.security;
    const username = dto?.username?.trim() ?? stored?.username;
    const folder = dto?.folder?.trim() || stored?.folder || DEFAULT_FOLDER;
    if (
      host === undefined ||
      port === undefined ||
      security === undefined ||
      username === undefined
    ) {
      throw new BadRequestException(
        tr(
          "errors.emailReceipts.testNeedsSettings",
          "Enter the server, port, security and user name to test, or save the mailbox first.",
        ),
      );
    }

    let password = dto?.password ? dto.password : undefined;
    if (password === undefined) {
      if (!stored) throw passwordRequired();
      if (stored.host !== host || stored.username !== username) {
        throw passwordRequiredForChange();
      }
      try {
        password = this.encryption.decrypt(stored.passwordEnc);
      } catch {
        return {
          ok: false,
          error: tr(
            "errors.emailReceipts.storedPasswordUnreadable",
            "The stored password cannot be read on this server. Enter the password again.",
          ),
        };
      }
    }

    const policy = await this.resolvePolicy(userId, host, port);
    try {
      const result = await this.imap.testConnection({
        host,
        port,
        security,
        username,
        password,
        folder,
        allowPrivateHost: policy.allowPrivate,
      });
      return { ok: true, messages: result.messages };
    } catch (error) {
      // A refusal of the host is the caller's to see as a 400, not a test result.
      if (error instanceof HttpException) throw error;
      const reason = describeMailboxFailure(
        error,
        mailboxSecrets(username, password),
      );
      return {
        ok: false,
        error: tr(
          "errors.emailReceipts.connectionFailed",
          `Could not read the mailbox: ${reason}`,
          { reason },
        ),
      };
    }
  }

  /**
   * The user's mailbox with its password decrypted, for the poll and nothing
   * else. Null when none is set up. A stored password this server cannot
   * decrypt throws, without the ciphertext or any detail in the message.
   */
  async loadConnection(
    userId: string,
  ): Promise<LoadedEmailReceiptMailbox | null> {
    const row = await this.readStored(userId);
    if (!row) return null;
    let password: string;
    try {
      password = this.encryption.decrypt(row.passwordEnc);
    } catch {
      throw new Error("The stored mailbox password cannot be decrypted");
    }
    const ownerIsAdmin = await this.ownerIsAdmin(userId);
    const policy = resolveMailboxHostPolicy({
      host: row.host,
      port: row.port,
      ownerIsAdmin,
    });
    return {
      mailboxId: row.id,
      connection: {
        host: row.host,
        port: row.port,
        security: row.security,
        username: row.username,
        password,
        folder: row.folder,
        allowPrivateHost: policy.allowPrivate,
      },
      secrets: mailboxSecrets(row.username, password),
      cursor: { uidValidity: row.uidValidity, lastUid: row.lastUid },
      enabled: row.enabled,
      aiMode: row.aiMode,
      autoApply: row.autoApply,
    };
  }

  /**
   * The enabled mailboxes of every user, for the poll's fan-out. The caller
   * runs it under the system identity: it reads across users by design.
   */
  async listEnabledMailboxes(): Promise<Array<{ id: string; userId: string }>> {
    const rows = await withScopedDb(this.dataSource, (m) =>
      m.getRepository(EmailReceiptMailbox).find({
        where: { enabled: true },
        select: { id: true, userId: true },
        order: { createdAt: "ASC", id: "ASC" },
      }),
    );
    return rows.map((row) => ({ id: row.id, userId: row.userId }));
  }

  /**
   * Move the poll's cursor, in the caller's transaction when there is one (a
   * nested `withScopedDb` joins it), so the cursor advances with the rows it
   * covers and never without them (INV-RECEIPT-002). One conditional UPDATE: on
   * the same UIDVALIDITY the stored UID only ever rises (`GREATEST`), so a stale
   * poll cannot rewind it; on a different UIDVALIDITY every stored UID is void
   * and the new value replaces it.
   */
  async advanceCursor(
    userId: string,
    mailboxId: string,
    cursor: MailboxCursorUpdate,
  ): Promise<void> {
    await withScopedDb(this.dataSource, async (m) => {
      await m.query(
        `UPDATE email_receipt_mailboxes
            SET last_uid = CASE
                  WHEN uid_validity IS NOT DISTINCT FROM $3::bigint
                    THEN GREATEST(last_uid, $4::bigint)
                  ELSE $4::bigint
                END,
                uid_validity = $3::bigint
          WHERE id = $1
            AND user_id = $2`,
        [mailboxId, userId, cursor.uidValidity, cursor.lastUid],
      );
    });
  }

  /** A poll finished without an error: stamp it and clear the last error. */
  async recordPollSuccess(
    userId: string,
    mailboxId: string,
    at: Date = new Date(),
  ): Promise<void> {
    await withScopedDb(this.dataSource, async (m) => {
      await m.getRepository(EmailReceiptMailbox).update(
        { id: mailboxId, userId },
        {
          lastPolledAt: at,
          lastSuccessAt: at,
          lastError: null,
          lastErrorAt: null,
        },
      );
    });
  }

  /**
   * A poll failed: stamp it and keep a bounded, secret-free line of why
   * (`describeMailboxFailure`, at most 300 characters, the secrets removed).
   */
  async recordPollFailure(
    userId: string,
    mailboxId: string,
    error: unknown,
    secrets: readonly string[] = [],
    at: Date = new Date(),
  ): Promise<string> {
    const line = describeMailboxFailure(error, secrets);
    await withScopedDb(this.dataSource, async (m) => {
      await m
        .getRepository(EmailReceiptMailbox)
        .update(
          { id: mailboxId, userId },
          { lastPolledAt: at, lastError: line, lastErrorAt: at },
        );
    });
    return line;
  }

  // ---------------------------------------------------------------------

  private view(row: EmailReceiptMailbox): EmailReceiptMailboxView {
    return toMailboxView(row, {
      // `password_enc` is NOT NULL and only ever written as ciphertext, so a row
      // existing is a password being stored.
      passwordSet: true,
      encryptionConfigured: this.encryption.isConfigured(),
    });
  }

  private requireEncryption(): void {
    if (!this.encryption.isConfigured()) {
      throw new BadRequestException(
        tr(
          "errors.emailReceipts.encryptionNotConfigured",
          "This server has no encryption key configured, so a mailbox password cannot be stored.",
        ),
      );
    }
  }

  /** The stored row with its ciphertext, which no other read selects. */
  private readStored(userId: string): Promise<EmailReceiptMailbox | null> {
    return withScopedDb(this.dataSource, (m) =>
      m
        .getRepository(EmailReceiptMailbox)
        .createQueryBuilder("mailbox")
        .addSelect("mailbox.passwordEnc")
        .where("mailbox.userId = :userId", { userId })
        .getOne(),
    );
  }

  /**
   * Whether the owner is an admin, read from the user's own row so a cron's
   * poll gets the same answer a request does.
   */
  private async ownerIsAdmin(userId: string): Promise<boolean> {
    const owner = await withScopedDb(this.dataSource, (m) =>
      m.getRepository(User).findOne({
        where: { id: userId },
        select: { id: true, role: true },
      }),
    );
    return owner?.role === "admin";
  }

  /** The save-time host check (INV-RECEIPT-004), under the owner's own role. */
  private async resolvePolicy(
    userId: string,
    host: string,
    port: number,
  ): Promise<MailboxHostPolicy> {
    return assertMailboxHostAllowed({
      host,
      port,
      ownerIsAdmin: await this.ownerIsAdmin(userId),
    });
  }
}

/** A host as stored: unbracketed, and an IPv6 literal must really be one. */
export function normalizeHost(raw: string): string {
  const host = raw.trim().toLowerCase();
  const bare =
    host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (bare.includes(":") && isIP(bare) !== 6) {
    throw new BadRequestException(
      tr(
        "errors.emailReceipts.invalidHost",
        "The mail server must be a host name or an IP address.",
      ),
    );
  }
  return bare;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

function passwordRequired(): BadRequestException {
  return new BadRequestException(
    tr("errors.emailReceipts.passwordRequired", "Enter the mailbox password."),
  );
}

function passwordRequiredForChange(): BadRequestException {
  return new BadRequestException(
    tr(
      "errors.emailReceipts.passwordRequiredForChange",
      "Enter the mailbox password again: it is only sent to the server and user name it was saved with.",
    ),
  );
}

function mailboxNotFound(): NotFoundException {
  return new NotFoundException(
    tr(
      "errors.emailReceipts.mailboxNotFound",
      "No mailbox is set up for this account.",
    ),
  );
}
