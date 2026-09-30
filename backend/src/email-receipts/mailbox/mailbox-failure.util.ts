import { describeFetchFailure } from "../../common/http/fetch-failure.util";
import { EMAIL_RECEIPT_LAST_ERROR_MAX_LENGTH } from "../entities/email-receipt-mailbox.entity";
import { stripControlCharacters } from "../imap/strip-control-characters";

/** The most of a server's own reply text kept in a failure line. */
const MAX_SERVER_TEXT_CHARS = 120;

const REDACTED = "***";

interface ImapErrorLike {
  readonly authenticationFailed?: unknown;
  readonly responseText?: unknown;
  readonly serverResponseCode?: unknown;
  readonly code?: unknown;
}

/**
 * The exact strings an IMAP login carries, which must never reach a stored
 * error: the password, and the SASL PLAIN blob (`\0user\0password`, base64)
 * that a server or a library could echo. Empty secrets are dropped, since an
 * empty needle would match everywhere.
 */
export function mailboxSecrets(username: string, password: string): string[] {
  const plain = Buffer.from(`\u0000${username}\u0000${password}`, "utf8");
  return [password, plain.toString("base64")].filter((s) => s.length > 0);
}

function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  // Longest first, so a secret that contains another is removed whole.
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    if (secret.length === 0) continue;
    out = out.split(secret).join(REDACTED);
  }
  return out;
}

/**
 * One log- and UI-safe line for a failed mailbox connection or read, at most 300
 * characters (the column's width), which is what `last_error` stores and the
 * settings screen shows (INV-RECEIPT-005).
 *
 * It is built from `describeFetchFailure` (the cause chain and the socket-level
 * codes) plus what imapflow adds to its errors: that authentication failed, and
 * the server's own reply text, bounded. The password never belongs in any of
 * it, and is removed anyway: a server may quote a command back, and a
 * library's message is not ours to trust. Control characters are dropped so the
 * line is one line.
 */
export function describeMailboxFailure(
  error: unknown,
  secrets: readonly string[] = [],
): string {
  const base = describeFetchFailure(error);
  const extra: string[] = [];
  if (error !== null && typeof error === "object") {
    const e = error as ImapErrorLike;
    if (e.authenticationFailed === true) extra.push("authentication failed");
    if (e.code === "AI_EGRESS_REFUSED") {
      extra.push("the host resolves to a private address");
    }
    if (typeof e.serverResponseCode === "string" && e.serverResponseCode) {
      extra.push(`server code ${e.serverResponseCode}`);
    }
    if (typeof e.responseText === "string" && e.responseText.trim()) {
      extra.push(
        `server said: ${e.responseText.trim().slice(0, MAX_SERVER_TEXT_CHARS)}`,
      );
    }
  }
  const line = [base, ...extra].join("; ");
  const clean = stripControlCharacters(redact(line, secrets))
    .replace(/\s+/g, " ")
    .trim();
  const cut =
    clean.length > EMAIL_RECEIPT_LAST_ERROR_MAX_LENGTH
      ? `${clean.slice(0, EMAIL_RECEIPT_LAST_ERROR_MAX_LENGTH - 3)}...`
      : clean;
  return cut || "unknown error";
}
