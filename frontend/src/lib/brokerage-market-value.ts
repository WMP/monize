import type { Account } from '@/types/account';
import type { PortfolioSummary } from '@/types/investment';

/**
 * Market value of the holdings in each brokerage account, keyed by account id,
 * where `null` means "not known".
 *
 * Cash is deliberately not in here: a brokerage account's cash sits in its
 * linked `INVESTMENT_CASH` account and counting it twice would overstate net
 * worth. So the value of a brokerage row *is* its holdings' market value.
 *
 * Three states have to stay distinguishable, and flattening any of them into a
 * number is the defect this exists to prevent:
 *
 * - **Known.** A number, including a genuine `0` for a brokerage that holds
 *   nothing. An empty account is worth zero, and reporting that as unknown would
 *   make "nothing to show" indistinguishable from "could not be worked out".
 * - **Unknown.** The server sent `null` for the account's total because a quote
 *   or an exchange rate was missing. Every total that includes it is unknown too.
 * - **Unknown for everything.** The portfolio request itself failed, so nothing
 *   is known about any brokerage account. A failed lookup is not an empty
 *   dataset; before this, a failed portfolio load rendered every brokerage
 *   account as a `0.00` balance.
 *
 * `map.get(id) ?? 0` collapses the last two into the first, which is how a user
 * came to see a complete-looking `Total Assets` that omitted an entire holding.
 * Read through {@link brokerageMarketValue} and treat `null` as unknown.
 */
export type BrokerageMarketValues = Map<string, number | null>;

/**
 * Builds the map from a loaded portfolio summary, or from its absence.
 *
 * Every brokerage account in `accounts` gets an entry, so a caller never has to
 * decide what a missing key meant -- which was the ambiguity the `?? 0` was
 * papering over.
 */
export function buildBrokerageMarketValues(
  accounts: Account[],
  portfolioSummary: PortfolioSummary | null | undefined,
): BrokerageMarketValues {
  const map: BrokerageMarketValues = new Map();
  const brokerages = accounts.filter(
    (a) => a.accountSubType === 'INVESTMENT_BROKERAGE',
  );
  if (brokerages.length === 0) return map;

  if (!portfolioSummary) {
    // Nothing loaded: unknown for all of them, not zero for all of them.
    for (const account of brokerages) map.set(account.id, null);
    return map;
  }

  const byAccount = new Map<string, number | null>();
  for (const holdings of portfolioSummary.holdingsByAccount) {
    byAccount.set(holdings.accountId, holdings.totalMarketValue);
  }
  for (const account of brokerages) {
    // Absent from a summary that did load means the account holds nothing, which
    // is a known zero.
    map.set(account.id, byAccount.has(account.id) ? byAccount.get(account.id)! : 0);
  }
  return map;
}

/**
 * The market value to use for an account, or `null` when it is not known.
 *
 * Non-brokerage accounts are not in the map and return `null` here, so callers
 * must decide which balance an account uses before asking -- the same shape the
 * call sites already had.
 */
export function brokerageMarketValue(
  map: BrokerageMarketValues | undefined,
  accountId: string,
): number | null {
  const value = map?.get(accountId);
  return value === undefined ? null : value;
}
