/**
 * Pure helpers for the Auto-Merge Payees feature.
 *
 * Imported bank payee strings carry a lot of noise around the real name:
 * legal suffixes ("sp. z o.o.", "GmbH"), store numbers ("0421", "#5"),
 * payment-rail words ("POS", "VISA DEBIT") and punctuation. These helpers
 * strip that noise so near-duplicate payees ("Lidl", "LIDL sp. z o.o.",
 * "LIDL WARSZAWA 0421") collapse to a common normalized form ("LIDL ...")
 * and a shared significant token ("LIDL") that drives clustering and the
 * generated wildcard alias.
 */

// Legal / business entity suffixes stripped during normalization. Compared
// against upper-cased, punctuation-free tokens (so "o.o." -> "OO", "z" -> dropped
// as a single char, "S.A." -> "SA").
const BUSINESS_SUFFIXES: ReadonlySet<string> = new Set([
  "SP",
  "ZOO",
  "OO",
  "SA",
  "SAS",
  "GMBH",
  "INC",
  "LLC",
  "LTD",
  "LTDA",
  "BV",
  "AG",
  "SARL",
  "PLC",
  "OY",
  "AB",
  "KG",
  "CO",
  "CORP",
  "NV",
  "OOO",
  "SRL",
  "SPA",
  "PTY",
  "PTE",
  "AS",
  "ASA",
  "KFT",
  "DOO",
  "EOOD",
  "OOD",
  "GES",
  "MBH",
]);

// Payment-rail / generic noise tokens that never identify a payee. Filtered
// out when picking the "significant" tokens used for grouping.
const NOISE_TOKENS: ReadonlySet<string> = new Set([
  "THE",
  "AND",
  "POS",
  "CARD",
  "VISA",
  "DEBIT",
  "CREDIT",
  "PAYMENT",
  "PURCHASE",
  "PMT",
  "TXN",
  "REF",
  "WWW",
  "COM",
  "HTTP",
  "HTTPS",
  "PAYPAL",
  "SUMUP",
  "SQ",
]);

/**
 * Normalize a payee name to a canonical comparison form: strip diacritics,
 * upper-case, drop punctuation, and remove pure-digit tokens, single
 * characters, and legal/business suffixes. Returns space-joined tokens.
 *
 * "LIDL sp. z o.o." -> "LIDL"
 * "LIDL WARSZAWA 0421" -> "LIDL WARSZAWA"
 * "Lidl" -> "LIDL"
 */
export function normalizePayeeName(name: string): string {
  if (!name) return "";
  const tokens = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((tok) => {
      if (tok.length < 2) return false; // drop single chars / leftover initials
      if (/^\d+$/.test(tok)) return false; // drop store numbers
      if (BUSINESS_SUFFIXES.has(tok)) return false;
      return true;
    });
  return tokens.join(" ");
}

/**
 * Significant tokens of a normalized name: those at least `minTokenLength`
 * long and not generic noise. Used to choose a grouping key and alias token.
 */
export function significantTokens(
  normalized: string,
  minTokenLength: number,
): string[] {
  if (!normalized) return [];
  return normalized
    .split(/\s+/)
    .filter((tok) => tok.length >= minTokenLength && !NOISE_TOKENS.has(tok));
}

/**
 * The first significant token of a name, or null when none qualify.
 * This is the primary clustering key (e.g. "LIDL").
 */
export function leadingSignificantToken(
  normalized: string,
  minTokenLength: number,
): string | null {
  const tokens = significantTokens(normalized, minTokenLength);
  return tokens.length > 0 ? tokens[0] : null;
}

/**
 * Normalized Levenshtein similarity in [0, 1] (1 = identical). Length-guarded
 * to stay cheap; pure (mutates only function-local arrays).
 */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const lenA = a.length;
  const lenB = b.length;
  if (lenA === 0 || lenB === 0) return 0;
  const maxLen = Math.max(lenA, lenB);
  if (maxLen > 200) return 0; // guard against pathological inputs
  return 1 - levenshtein(a, b) / maxLen;
}

function levenshtein(a: string, b: string): number {
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}
