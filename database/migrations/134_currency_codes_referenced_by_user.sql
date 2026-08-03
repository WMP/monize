-- Which currency codes does one user's data reference?
--
-- The companion to `currency_code_in_use_globally` (migration 133), and a
-- separate question: that one asks whether *anybody* still holds a code, this
-- one asks which codes a single user holds. Both enumerate the columns that
-- reference `currencies(code)`, which is precisely the list that has drifted
-- before, so both live in SQL beside each other and
-- `currency-references.spec.ts` checks each against the schema.
--
-- The backup export needs this because it selected currencies by
-- `created_by_user_id`. Currencies are shared -- any user may activate a code
-- another user created -- so a user whose accounts are denominated in somebody
-- else's custom currency exported the references without the definition, and a
-- restore onto a fresh instance invented name, symbol and decimal places from a
-- fallback. A currency defined as `PTS / Family Points / * / 0 decimals` came
-- back as `PTS / PTS / PTS / 2 decimals`: the stored amounts were unchanged, but
-- a balance of 7 rendered as `PTS 7.00` instead of `*7`.
--
-- Deliberately SECURITY INVOKER, unlike its sibling. It must answer for the
-- calling tenant only, and under RLS the caller's own policies give exactly
-- that -- so the ordinary rules apply and no privilege is granted.
--
-- `exchange_rates` is absent on purpose: it is global reference data with no
-- `user_id`, so it cannot contribute to a per-user answer. The guard test knows
-- this rule (a referencing table with no `user_id` column is exempt here) rather
-- than carrying an exception list.

CREATE OR REPLACE FUNCTION currency_codes_referenced_by_user(p_user_id uuid)
RETURNS SETOF varchar
LANGUAGE sql
STABLE
AS $$
  SELECT currency_code FROM user_currency_preferences WHERE user_id = p_user_id
  UNION SELECT default_currency FROM user_preferences WHERE user_id = p_user_id
  UNION SELECT currency_code FROM accounts WHERE user_id = p_user_id
  UNION SELECT currency_code FROM transactions WHERE user_id = p_user_id
  UNION SELECT original_currency_code FROM transactions WHERE user_id = p_user_id
  UNION SELECT currency_code FROM securities WHERE user_id = p_user_id
  UNION SELECT currency_code FROM scheduled_transactions WHERE user_id = p_user_id
  UNION SELECT original_currency_code FROM scheduled_transactions WHERE user_id = p_user_id
  UNION SELECT currency_code FROM budgets WHERE user_id = p_user_id
$$;

COMMENT ON FUNCTION currency_codes_referenced_by_user(uuid) IS
  'The currency codes one user''s rows reference. SECURITY INVOKER: the answer is '
  'meant to be the calling tenant''s, which the caller''s own RLS policies already '
  'give. Must consult every FK to currencies(code) whose table has a user_id -- '
  'enforced by currency-references.spec.ts. exchange_rates is excluded: global '
  'reference data with no owner cannot contribute to a per-user answer.';
