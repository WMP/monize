import { ServiceUnavailableException } from "@nestjs/common";
import type { EntityManager, SelectQueryBuilder } from "typeorm";
import { reportingRawMany } from "./reporting-query";
import { tryReportingConversion, reportingRates } from "./reporting-money";
import { reportingResultCurrency } from "./reporting-basis";
/** Keep native currency breakdowns while valuing summary components on their effective date.
 * Source identity keeps split components from inflating distinct transaction counts.
 */
export async function reportingSummaryRows(
  manager: EntityManager,
  userId: string,
  query: SelectQueryBuilder<any>,
  currency: string,
  incomeColumn = "totalIncome",
  expensesColumn = "totalExpenses",
  nativeOnly = false,
) {
  // The LLM list requests native buckets only for counts and breakdowns; its
  // nullable reporting totals are folded independently through FxAggregate.
  // A plain Cash summary still needs this conversion -- a Cash reader with
  // transactions in more than one currency has no other way to a single
  // converted total -- so only an explicit nativeOnly request skips it.
  if (nativeOnly) {
    const rows = await query.getRawMany();
    if (
      rows.some(
        (row) =>
          !row.currencyCode &&
          (Number(row[incomeColumn]) !== 0 ||
            Number(row[expensesColumn]) !== 0),
      )
    )
      throw new ServiceUnavailableException({
        code: "REPORTING_FX_INCOMPLETE",
        fxComplete: false,
      });
    return rows;
  }
  reportingResultCurrency(userId, currency);
  const alias = query.alias;
  const qb = query
    .clone()
    .addSelect(`TO_CHAR(${alias}.transaction_date,'YYYY-MM-DD')`, "__moneyDate")
    .addSelect(`${alias}.original_currency_code`, "__moneyOriginal")
    .addSelect(`${alias}.exchange_rate`, "__moneyRate")
    .addGroupBy(`${alias}.transaction_date`)
    .addGroupBy(`${alias}.original_currency_code`)
    .addGroupBy(`${alias}.exchange_rate`);
  const rows = await reportingRawMany(manager, userId, qb);
  const sources = rows.map((row) => ({
    currencyCode: row.currencyCode,
    transactionDate: row.__moneyDate,
    originalCurrencyCode: row.__moneyOriginal,
    exchangeRate: row.__moneyRate,
  }));
  const rates = await reportingRates(manager, sources, currency);
  return rows.map((row, index) => {
    const income = tryReportingConversion(
      row[incomeColumn],
      sources[index],
      currency,
      rates,
    );
    const expenses = tryReportingConversion(
      row[expensesColumn],
      sources[index],
      currency,
      rates,
    );
    return {
      ...row,
      convertedIncome: income.amount,
      convertedExpenses: expenses.amount,
      missingRatePairs: [
        income.missingRatePair,
        expenses.missingRatePair,
      ].filter(Boolean),
    };
  });
}
