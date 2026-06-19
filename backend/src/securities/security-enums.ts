/**
 * Canonical security `exchange` and `securityType` values.
 *
 * Both columns are free-text on the entity, but the user-facing pickers offer a
 * fixed list (frontend `EXCHANGE_OPTIONS` in `lib/constants.ts` and
 * `SECURITY_TYPE_OPTIONS` in `app/import/import-utils.ts`). The AI Assistant and
 * MCP `create_security` tools constrain their `exchange`/`securityType`
 * arguments to these same lists so the model picks from known values instead of
 * inventing one. Keep these in sync with the frontend lists.
 */

export const SECURITY_EXCHANGES = [
  // North America
  "NYSE",
  "NASDAQ",
  "AMEX",
  "ARCA",
  "BATS",
  "TSX",
  "TSX-V",
  "CSE",
  "NEO",
  // Europe
  "LSE",
  "XETRA",
  "Frankfurt",
  "Paris",
  "AMS",
  "MIL",
  "STO",
  // Asia-Pacific
  "Tokyo",
  "HKEX",
  "SHA",
  "SHE",
  "ASX",
  "KRX",
  "TAI",
  "SGX",
  "BSE",
  "NSE",
] as const;

export type SecurityExchange = (typeof SECURITY_EXCHANGES)[number];

export const SECURITY_TYPES = [
  "STOCK",
  "ETF",
  "MUTUAL_FUND",
  "BOND",
  "OPTION",
  "GIC",
  "CRYPTO",
  "CASH",
  "OTHER",
] as const;

export type SecurityType = (typeof SECURITY_TYPES)[number];
