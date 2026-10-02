import { englishEmailT, type EmailT } from "../i18n/email-translator";

/**
 * The bank's own name for what kind of operation a transaction was (spec
 * section 7b): `CARD-PAYMENT`, `TRANSFER-IN`, a `bank_transaction_code`. It is
 * read beside the description and never out of it, because the description is
 * part of the `hash:` duplicate key (spec section 6) and a changed description
 * would import the same row twice.
 */
export interface BankOperation {
  /** `bank_transaction_code.code`, bounded; null when the bank sent none. */
  code: string | null;
  /** `bank_transaction_code.sub_code`, bounded. */
  subCode: string | null;
  /** `bank_transaction_code.description`, bounded. */
  description: string | null;
  /**
   * An upper-case hyphenated code found in a remittance line (the line itself,
   * or its last word): `CARD-PAYMENT`, `MOBILE-PAYMENT-POS-NO-CARD-TX-CODE`.
   */
  remittanceCode: string | null;
}

export const NO_BANK_OPERATION: BankOperation = Object.freeze({
  code: null,
  subCode: null,
  description: null,
  remittanceCode: null,
});

/** The longest operation text kept: the width of `tags.name`, which it can become. */
export const BANK_OPERATION_MAX_LENGTH = 100;

/** An operation code as banks write one: `CARD-PAYMENT`, `ATM-WITHDRAWAL-FOREIGN`. */
export const OPERATION_CODE_PATTERN = /^[A-Z][A-Z0-9]*(-[A-Z0-9]+)+$/;

/**
 * What may become a tag's name when the code is not a known one: letters,
 * digits and a little punctuation, starting with a letter or a digit. A bank is
 * a third party, so markup and control characters never reach a tag.
 */
const SAFE_TAG_NAME = /^[\p{L}\p{N}][\p{L}\p{N} _./:+-]*$/u;

/**
 * The operation code in a bank's remittance lines: the first line that is a
 * code, or whose last whitespace-separated word is one. Null when none is.
 */
export function remittanceOperationCode(
  lines: readonly string[],
): string | null {
  for (const line of lines) {
    const trimmed = line.trim();
    if (OPERATION_CODE_PATTERN.test(trimmed)) return trimmed;
    const lastWord = trimmed.split(/\s+/).pop() ?? "";
    if (OPERATION_CODE_PATTERN.test(lastWord)) return lastWord;
  }
  return null;
}

/** A known operation: how its code is recognised and how its tag is named. */
interface KnownOperation {
  readonly key: string;
  readonly matches: (code: string) => boolean;
  /** The catalogue key under `common.bankSync.operationTypes`. */
  readonly catalogKey: string;
  readonly fallback: string;
}

/**
 * The codes with a translated label (spec section 7b). A code that is not here
 * is its own tag name.
 */
const KNOWN_OPERATIONS: readonly KnownOperation[] = [
  {
    key: "CARD-PAYMENT",
    matches: (code) => code === "CARD-PAYMENT",
    catalogKey: "cardPayment",
    fallback: "Card payment",
  },
  {
    key: "TRANSFER-IN",
    matches: (code) => code === "TRANSFER-IN",
    catalogKey: "transferIn",
    fallback: "Incoming transfer",
  },
  {
    key: "TRANSFER-OUT",
    matches: (code) => code === "TRANSFER-OUT",
    catalogKey: "transferOut",
    fallback: "Outgoing transfer",
  },
  {
    key: "MOBILE-PAYMENT",
    matches: (code) => code.startsWith("MOBILE-PAYMENT-"),
    catalogKey: "mobilePayment",
    fallback: "Mobile payment",
  },
  {
    key: "ATM",
    matches: (code) => code.startsWith("ATM-"),
    catalogKey: "cashWithdrawal",
    fallback: "Cash withdrawal",
  },
];

/** The tag an operation gives a transaction. */
export interface OperationTag {
  /**
   * What names the operation: the family of a known code (`CARD-PAYMENT`,
   * `MOBILE-PAYMENT`, `ATM`), the code itself for an unknown one.
   */
  key: string;
  /** The tag's name, in the translator's language for a known code. */
  label: string;
}

/**
 * The tag a bank operation gives a transaction, or null when the bank named no
 * operation Monize can use as a tag name.
 *
 * The operation is the first of the remittance code, the transaction code's
 * sub code, its code and its description that the bank gave. A known code takes
 * its translated label (`t`, the recipient's language); any other is its own
 * name, kept as the bank wrote it, provided it is plain text of at most a tag
 * name's width: a value that is not is no tag, never a mangled one.
 */
export function operationTagLabel(
  operation: BankOperation,
  t: EmailT = englishEmailT,
): OperationTag | null {
  const candidate = [
    operation.remittanceCode,
    operation.subCode,
    operation.code,
    operation.description,
  ]
    .map((value) => value?.trim() ?? "")
    .find((value) => value !== "");
  if (candidate === undefined) return null;

  const known = KNOWN_OPERATIONS.find((entry) =>
    entry.matches(candidate.toUpperCase()),
  );
  if (known !== undefined) {
    return {
      key: known.key,
      label: t(
        `common.bankSync.operationTypes.${known.catalogKey}`,
        known.fallback,
      ),
    };
  }
  if (candidate.length > BANK_OPERATION_MAX_LENGTH) return null;
  return SAFE_TAG_NAME.test(candidate)
    ? { key: candidate, label: candidate }
    : null;
}
