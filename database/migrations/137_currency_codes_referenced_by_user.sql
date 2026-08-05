-- Which currency codes does one user reference?
--
-- The companion to `currency_code_in_use_globally` (migration 136), and a
-- separate question: that one asks whether *anybody* still holds a code, this
-- one asks which codes a single user holds. Both enumerate the columns that
-- reference `currencies(code)`, which is precisely the list that has drifted
-- before, so both live in SQL beside each other and
-- `currency-references.spec.ts` checks each against the schema.
--
-- Two callers ask it in two slightly different ways, so it is two functions --
-- one list, derived twice, rather than the list written twice:
--
--   * `currency_codes_referenced_by_user_data` -- the codes this user's *data*
--     is denominated in. What the delete gate needs: deleting a currency the
--     caller still has a budget or an account in has to be refused.
--   * `currency_codes_referenced_by_user` -- the above plus the user's own
--     activation row. What the backup export needs: a currency the user
--     activated but has not spent anything in yet must still travel with the
--     backup, or the restore has a preference row pointing at a definition that
--     is not in the file.
--
-- The composite calls the data function rather than repeating its branches. The
-- delete gate could not use the composite: it runs *before* deleting the
-- caller's own preference row, so the activation it is about to remove would
-- always answer "in use" and no currency could ever be deleted.
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
-- The delete gate needs it because `CurrenciesService.isInUse` was a third
-- hand-written spelling of the same list and was missing `budgets.currency_code`
-- -- so a user with a budget denominated in a custom currency was told the code
-- was not "in use by your accounts, securities, or other records", had their
-- activation deleted, and was left with a budget in a currency they could no
-- longer see or reactivate.
--
-- Both are deliberately SECURITY INVOKER, unlike their sibling in 133. They must
-- answer for the calling tenant only, and under RLS the caller's own policies
-- give exactly that -- so the ordinary rules apply and no privilege is granted.
--
-- `exchange_rates` is absent on purpose: it is global reference data with no
-- `user_id`, so it cannot contribute to a per-user answer. The guard test knows
-- this rule (a referencing table with no `user_id` column is exempt here) rather
-- than carrying an exception list.

-- NULLs are filtered once here rather than per branch: three of the columns are
-- nullable, and a NULL in the result set turns a caller's `NOT IN` into a
-- silently empty answer.
CREATE OR REPLACE FUNCTION currency_codes_referenced_by_user_data(p_user_id uuid)
RETURNS SETOF varchar
LANGUAGE sql
STABLE
AS $$
  SELECT code FROM (
    SELECT default_currency AS code FROM user_preferences WHERE user_id = p_user_id
    UNION SELECT currency_code FROM accounts WHERE user_id = p_user_id
    UNION SELECT currency_code FROM transactions WHERE user_id = p_user_id
    UNION SELECT original_currency_code FROM transactions WHERE user_id = p_user_id
    UNION SELECT currency_code FROM securities WHERE user_id = p_user_id
    UNION SELECT currency_code FROM scheduled_transactions WHERE user_id = p_user_id
    UNION SELECT original_currency_code FROM scheduled_transactions WHERE user_id = p_user_id
    UNION SELECT currency_code FROM budgets WHERE user_id = p_user_id
  ) referenced
  WHERE code IS NOT NULL
$$;

COMMENT ON FUNCTION currency_codes_referenced_by_user_data(uuid) IS
  'The currency codes one user''s data is denominated in, excluding their own '
  'user_currency_preferences activation row. What the delete gate needs, since it '
  'runs before removing that row. SECURITY INVOKER: the answer is meant to be the '
  'calling tenant''s, which the caller''s own RLS policies already give. Must '
  'consult every FK to currencies(code) whose table has a user_id -- enforced by '
  'currency-references.spec.ts. exchange_rates is excluded: global reference data '
  'with no owner cannot contribute to a per-user answer.';

CREATE OR REPLACE FUNCTION currency_codes_referenced_by_user(p_user_id uuid)
RETURNS SETOF varchar
LANGUAGE sql
STABLE
AS $$
  SELECT currency_code FROM user_currency_preferences WHERE user_id = p_user_id
  UNION SELECT referenced.code
    FROM currency_codes_referenced_by_user_data(p_user_id) AS referenced(code)
$$;

COMMENT ON FUNCTION currency_codes_referenced_by_user(uuid) IS
  'Every currency code one user references: the codes their data is denominated '
  'in, plus the codes they have activated. What the backup export needs, so an '
  'activated-but-unused currency definition still travels with the backup. '
  'Derives from currency_codes_referenced_by_user_data rather than repeating its '
  'branches -- that list has drifted three times.';
