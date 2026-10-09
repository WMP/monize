import { detectForwardedOriginal } from "./forwarded-message";

/** The bounds the `email_receipts` columns enforce. */
const MAX_FROM_ADDRESS_CHARS = 320;
const MAX_FROM_DOMAIN_CHARS = 255;
const MAX_SUBJECT_CHARS = 500;
const DAY_MS = 86_400_000;

/** The identity columns of a stored email that a forward changes. */
export interface ReceiptIdentity {
  fromAddress: string;
  fromDomain: string;
  subject: string;
  /** The mailbox's own From when the message was a forward, else null. */
  forwardedBy: string | null;
  /** When the shop sent the order, read from the forwarded header block. */
  originalSentAt: Date | null;
}

/**
 * What a stored email's sender, subject and dates are once a forwarded header
 * block in its text is taken into account, or null when the text holds none (the
 * columns stay as they are). Used at ingestion and again on reprocess, from the
 * stored text, so an email stored before this was understood heals on
 * "Reprocess".
 *
 * Idempotent: a row already healed carries `forwardedBy`, which is kept, so a
 * second pass over it writes the same values and never replaces the forwarder
 * with the shop. The original date is dropped when it names a day later than
 * the day the forward arrived: a header that claims the shop wrote after the
 * user forwarded it is garbled, and the arrival date is the better guide.
 */
export function resolveForwardedIdentity(
  current: ReceiptIdentity,
  bodyText: string,
  receivedAt: Date,
): ReceiptIdentity | null {
  const original = detectForwardedOriginal(bodyText);
  if (original === null) return null;

  const fromAddress = original.fromAddress.slice(0, MAX_FROM_ADDRESS_CHARS);
  const at = fromAddress.lastIndexOf("@");
  const fromDomain = (at >= 0 ? fromAddress.slice(at + 1) : "")
    .toLowerCase()
    .slice(0, MAX_FROM_DOMAIN_CHARS);
  const sentAt =
    original.sentAt !== null &&
    original.sentAt.getTime() <= receivedAt.getTime() + DAY_MS
      ? original.sentAt
      : null;
  const subject = (original.subject ?? current.subject)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SUBJECT_CHARS);

  return {
    fromAddress,
    fromDomain,
    subject,
    forwardedBy: (current.forwardedBy ?? current.fromAddress).slice(
      0,
      MAX_FROM_ADDRESS_CHARS,
    ),
    originalSentAt: sentAt,
  };
}

/** Whether two identities are the same, so a reprocess writes only a real change. */
export function sameIdentity(a: ReceiptIdentity, b: ReceiptIdentity): boolean {
  return (
    a.fromAddress === b.fromAddress &&
    a.fromDomain === b.fromDomain &&
    a.subject === b.subject &&
    a.forwardedBy === b.forwardedBy &&
    (a.originalSentAt?.getTime() ?? null) ===
      (b.originalSentAt?.getTime() ?? null)
  );
}

/**
 * The date a receipt's match window is centred on: the day the shop sent the
 * order when a forward carried it, else the day the email arrived.
 */
export function effectiveReceiptDate(receipt: {
  originalSentAt: Date | null;
  receivedAt: Date;
}): Date {
  return receipt.originalSentAt ?? receipt.receivedAt;
}
