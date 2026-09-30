import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from "typeorm";
import { Exclude } from "class-transformer";
import { User } from "../../users/entities/user.entity";

/** How the connection is secured. There is no plaintext mode (design 3.3). */
export type EmailReceiptMailboxSecurity = "tls" | "starttls";

/** Whether, and when, the AI is asked about receipts (design 3.6). */
export type EmailReceiptAiMode = "off" | "on_demand" | "automatic";

export const EMAIL_RECEIPT_MAILBOX_SECURITIES: readonly EmailReceiptMailboxSecurity[] =
  ["tls", "starttls"];
export const EMAIL_RECEIPT_AI_MODES: readonly EmailReceiptAiMode[] = [
  "off",
  "on_demand",
  "automatic",
];

/** The schema's bound on `last_error`. */
export const EMAIL_RECEIPT_LAST_ERROR_MAX_LENGTH = 300;

/**
 * One user's dedicated IMAP mailbox (design sections 3 and 4): at most one per
 * user. Column defaults mirror `database/migrations/*_add_email_receipts.sql`;
 * the RLS spec builds its schema from these entities.
 *
 * `passwordEnc` is AES-256-GCM ciphertext under `ENCRYPTION_KEY`. It is never
 * selected by default and never serialised, so an entity returned by mistake
 * still does not carry it; `EmailReceiptMailboxService.loadConnection` is the
 * one reader. `uidValidity` and `lastUid` are the poll's cursor: bigint
 * columns, so they are strings here and compared as such.
 */
@Entity("email_receipt_mailboxes")
@Unique("uq_email_receipt_mailboxes_user", ["userId"])
export class EmailReceiptMailbox {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid", name: "user_id" })
  userId: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user?: User;

  @Column({ type: "varchar", length: 255 })
  host: string;

  @Column({ type: "int", default: 993 })
  port: number;

  @Column({ type: "varchar", length: 10, default: "tls" })
  security: EmailReceiptMailboxSecurity;

  @Column({ type: "varchar", length: 320 })
  username: string;

  @Exclude()
  @Column({ type: "text", name: "password_enc", select: false })
  passwordEnc: string;

  @Column({ type: "varchar", length: 255, default: "INBOX" })
  folder: string;

  @Column({ type: "boolean", default: false })
  enabled: boolean;

  @Column({ type: "varchar", length: 12, name: "ai_mode", default: "off" })
  aiMode: EmailReceiptAiMode;

  @Column({ type: "boolean", name: "auto_apply", default: false })
  autoApply: boolean;

  @Column({ type: "bigint", name: "uid_validity", nullable: true })
  uidValidity: string | null;

  @Column({ type: "bigint", name: "last_uid", nullable: true })
  lastUid: string | null;

  @Column({ type: "timestamptz", name: "last_polled_at", nullable: true })
  lastPolledAt: Date | null;

  @Column({ type: "timestamptz", name: "last_success_at", nullable: true })
  lastSuccessAt: Date | null;

  @Column({ type: "varchar", length: 300, name: "last_error", nullable: true })
  lastError: string | null;

  @Column({ type: "timestamptz", name: "last_error_at", nullable: true })
  lastErrorAt: Date | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}
