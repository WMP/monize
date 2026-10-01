import type { PayeesService } from "../payees/payees.service";

/** A payee the bank's counterparty text resolved to. */
export interface ResolvedPayee {
  payeeId: string | null;
  payeeName: string | null;
  defaultCategoryId: string | null;
  /** For the preview's category column; the write never reads it. */
  defaultCategoryName: string | null;
}

export const NO_PAYEE: ResolvedPayee = {
  payeeId: null,
  payeeName: null,
  defaultCategoryId: null,
  defaultCategoryName: null,
};

/**
 * The payee an existing counterparty resolves to, the way the file import does:
 * an exact name, then an alias pattern (the `PayeesService` lookups the importer
 * shares). Null when the user has no such payee. Read-only, so the sync (which
 * creates the payee on a null) and the preview (which only reports it) ask the
 * same question.
 */
export async function findExistingPayee(
  payees: Pick<PayeesService, "findByName" | "findPayeeByAlias">,
  userId: string,
  text: string,
): Promise<ResolvedPayee | null> {
  const found =
    (await payees.findByName(userId, text)) ??
    (await payees.findPayeeByAlias(userId, text));
  if (!found) return null;
  return {
    payeeId: found.id,
    payeeName: found.name,
    defaultCategoryId: found.defaultCategoryId,
    defaultCategoryName: found.defaultCategory?.name ?? null,
  };
}
