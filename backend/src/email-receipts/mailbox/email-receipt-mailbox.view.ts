import type {
  EmailReceiptAiMode,
  EmailReceiptMailbox,
  EmailReceiptMailboxSecurity,
} from "../entities/email-receipt-mailbox.entity";

/**
 * What a client sees of a mailbox: every setting and the last poll's outcome,
 * and never the password (INV-RECEIPT-005) -- `passwordSet` says whether one is
 * stored. The poll cursor is the server's own bookkeeping and is not shown.
 * `encryptionConfigured` says whether this server can encrypt a password at all,
 * so the settings screen can explain a refused save.
 */
export interface EmailReceiptMailboxView {
  id: string;
  host: string;
  port: number;
  security: EmailReceiptMailboxSecurity;
  username: string;
  folder: string;
  enabled: boolean;
  aiMode: EmailReceiptAiMode;
  autoApply: boolean;
  passwordSet: boolean;
  encryptionConfigured: boolean;
  lastPolledAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The outcome of a connection test. A failure carries a bounded, secret-free line. */
export type EmailReceiptMailboxTestResult =
  | { ok: true; messages: number }
  | { ok: false; error: string };

const iso = (value: Date | null): string | null =>
  value ? value.toISOString() : null;

/** The view of a stored row. Built field by field so a new column is not shown by accident. */
export function toMailboxView(
  row: EmailReceiptMailbox,
  flags: { passwordSet: boolean; encryptionConfigured: boolean },
): EmailReceiptMailboxView {
  return {
    id: row.id,
    host: row.host,
    port: row.port,
    security: row.security,
    username: row.username,
    folder: row.folder,
    enabled: row.enabled,
    aiMode: row.aiMode,
    autoApply: row.autoApply,
    passwordSet: flags.passwordSet,
    encryptionConfigured: flags.encryptionConfigured,
    lastPolledAt: iso(row.lastPolledAt),
    lastSuccessAt: iso(row.lastSuccessAt),
    lastError: row.lastError,
    lastErrorAt: iso(row.lastErrorAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
