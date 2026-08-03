/**
 * Every column that holds a `currencies(code)` value.
 *
 * The two SQL functions (migrations 133 and 134) answer the *database's*
 * questions about this list. This is the same list for the one caller that
 * cannot ask the database: the support backup rewrites currency codes inside an
 * in-memory export, after the rows have left Postgres.
 *
 * It is a hand-written list, which is exactly the thing that has gone wrong here
 * three times -- so `currency-reference-columns.spec.ts` parses
 * `database/schema.sql` and fails when this and the schema disagree in either
 * direction. Add a currency reference in a migration and the test names it.
 */
export const CURRENCY_REFERENCE_COLUMNS: Readonly<
  Record<string, readonly string[]>
> = {
  user_currency_preferences: ["currency_code"],
  // Global reference data with no owner. Present for completeness (the guard
  // test compares against every FK in the schema) but never in a user's export.
  exchange_rates: ["from_currency", "to_currency"],
  accounts: ["currency_code"],
  transactions: ["currency_code", "original_currency_code"],
  securities: ["currency_code"],
  scheduled_transactions: ["currency_code", "original_currency_code"],
  budgets: ["currency_code"],
  user_preferences: ["default_currency"],
};
