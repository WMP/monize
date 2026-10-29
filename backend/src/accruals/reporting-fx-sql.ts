import { currentReportingRead } from "./reporting-basis";

/** Cash keeps the upstream native-currency aggregate. Recognition carries the
 * effective date and entered rate until after conversion, without source IDs. */
export function reportingFxColumns(
  userId: string,
  alias = "t",
  projected = false,
): string {
  const currency = `${alias}.currency_code`;
  if (currentReportingRead(userId)?.basis !== "accrual") return currency;
  const date = projected
    ? `${alias}.conversion_date`
    : `TO_CHAR(${alias}.transaction_date, 'YYYY-MM-DD') AS conversion_date`;
  return `${currency}, ${date}, ${alias}.original_currency_code, ${alias}.exchange_rate`;
}
export function reportingFxGrouping(
  userId: string,
  alias = "t",
  projected = false,
): string {
  const currency = `${alias}.currency_code`;
  if (currentReportingRead(userId)?.basis !== "accrual") return currency;
  return `${currency}, ${alias}.${projected ? "conversion_date" : "transaction_date"}, ${alias}.original_currency_code, ${alias}.exchange_rate`;
}
