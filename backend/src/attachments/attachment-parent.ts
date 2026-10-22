/**
 * Which row an attachment hangs off.
 *
 * An attachment has exactly one parent (WTY-003): a transaction, whose
 * receipts and invoices the register shows, or a warranty, whose receipt,
 * manual and photos prove the purchase. `transaction_attachments` keeps its
 * historical name and carries both columns, `transaction_id` and
 * `warranty_id`, with `chk_attachment_one_parent` requiring exactly one of
 * them; this union is the application-side form of that rule. A caller names
 * the parent as a kind and an id and never passes two ids, and every query
 * that reads under a parent derives its column from the kind here rather
 * than spelling it per site.
 *
 * Ownership is `user_id` on the attachment row itself, whichever parent it
 * has, so the `attachment_blobs` policy, the tombstone trigger, the orphan
 * sweeper and the storage migrator need no knowledge of the parent.
 */
export type AttachmentParent =
  | { readonly kind: "transaction"; readonly id: string }
  | { readonly kind: "warranty"; readonly id: string };

export type AttachmentParentKind = AttachmentParent["kind"];

/**
 * What a warranty's document is. A transaction's attachments always carry
 * `other` (the design's open question W4 keeps the picker off the register).
 */
export const DOCUMENT_KINDS = ["receipt", "manual", "photo", "other"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export const DEFAULT_DOCUMENT_KIND: DocumentKind = "other";

/** The SQL column that holds a parent of this kind. */
export function parentColumn(
  parent: AttachmentParent,
): "transaction_id" | "warranty_id" {
  switch (parent.kind) {
    case "transaction":
      return "transaction_id";
    case "warranty":
      return "warranty_id";
    default:
      return unreachableParent(parent);
  }
}

/**
 * The entity `where` fragment that restricts a read to this parent. One key
 * only, never both: TypeORM drops a `null` value from a `where`, so writing
 * the other column as `null` would read as "any parent" rather than "no
 * parent".
 */
export function attachmentParentWhere(
  parent: AttachmentParent,
): { transactionId: string } | { warrantyId: string } {
  switch (parent.kind) {
    case "transaction":
      return { transactionId: parent.id };
    case "warranty":
      return { warrantyId: parent.id };
    default:
      return unreachableParent(parent);
  }
}

/**
 * Both parent columns as a row carries them: the named one set, the other
 * `null`. For an INSERT, where the CHECK needs the pair to be explicit.
 */
export function attachmentParentColumns(parent: AttachmentParent): {
  transactionId: string | null;
  warrantyId: string | null;
} {
  switch (parent.kind) {
    case "transaction":
      return { transactionId: parent.id, warrantyId: null };
    case "warranty":
      return { transactionId: null, warrantyId: parent.id };
    default:
      return unreachableParent(parent);
  }
}

function unreachableParent(parent: never): never {
  throw new Error(`Unknown attachment parent kind: ${JSON.stringify(parent)}`);
}
