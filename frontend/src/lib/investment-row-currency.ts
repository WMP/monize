import type { InvestmentTransaction } from '@/types/investment';

/**
 * The unit each money field on an investment row is in, asked of the row
 * itself rather than inferred at the surface.
 *
 * `price`, `commission` and `totalAmount` are stored in the SECURITY's
 * currency, so taking the label from the account it is filed under is what
 * printed a EUR trade and a USD trade with the same symbol (issue #1394). A row
 * that names no security is the other case and is not unknown: the server
 * denominates it in the investment account's currency when it writes it, and
 * stamps that on the row (`investmentRowCurrencies` on the backend).
 *
 * So the server's stamp is the answer, and `security.currencyCode` -- the same
 * fact from the same row -- is the only accepted fallback, for a backend that
 * predates the stamped fields. `null` is unknown and renders as unknown; the
 * reader's own currency is never the answer.
 */
export function rowAmountCurrency(
  tx: Pick<InvestmentTransaction, 'amountCurrencyCode' | 'security'>,
): string | null {
  return tx.amountCurrencyCode ?? tx.security?.currencyCode ?? null;
}

export function rowPriceCurrency(tx: InvestmentTransaction): string | null {
  return tx.priceCurrencyCode ?? tx.security?.currencyCode ?? null;
}

export function rowCommissionCurrency(tx: InvestmentTransaction): string | null {
  return tx.commissionCurrencyCode ?? tx.security?.currencyCode ?? null;
}

/**
 * Which rate converts this row wherever it is reported in the reader's own
 * currency: its own settlement rate, or the market rate on its trade date.
 *
 * The row's rate is the one the realized-gains report multiplies by and the one
 * the summary KPIs now use, so the export states it per row rather than leaving
 * a reader to wonder which of two figures for one sale is the broker's
 * (INV-FX-002). A non-positive or absent rate is not a rate: such a row is
 * converted at the market rate on its trade date, which is what the server
 * counts in `marketRateCount`.
 */
export function rowConversionBasis(
  tx: Pick<InvestmentTransaction, 'exchangeRate'>,
): 'transaction' | 'market' {
  const rate = Number(tx.exchangeRate);
  return Number.isFinite(rate) && rate > 0 ? 'transaction' : 'market';
}

/**
 * An amount of this row, in `rowAmountCurrency(tx)`, expressed in `target`, or
 * `null` when it cannot be.
 *
 * Into the account's currency, a row carrying its own settlement rate converts
 * at that rate, the one its cash leg settled at (INV-FX-002). Beyond the
 * account's currency, and for a row without a rate of its own, `convert`
 * supplies the market rate. A row whose own currency is unknown is unknown:
 * it is never taken to be in the account's currency.
 */
export function convertRowAmount(
  tx: Pick<InvestmentTransaction, 'amountCurrencyCode' | 'security' | 'exchangeRate'>,
  amount: number,
  accountCurrency: string | null | undefined,
  target: string,
  convert: (amount: number, from: string, to: string) => number | null,
): number | null {
  const from = rowAmountCurrency(tx);
  if (from === null) return null;
  if (from === target) return amount;
  if (
    accountCurrency &&
    from !== accountCurrency &&
    rowConversionBasis(tx) === 'transaction'
  ) {
    const inAccount = amount * Number(tx.exchangeRate);
    return accountCurrency === target ? inAccount : convert(inAccount, accountCurrency, target);
  }
  return convert(amount, from, target);
}
