-- Reconciles the two currency-liveness functions after the shared-expense and
-- accrual migrations were merged together. Each restated the full bodies with
-- only its own new branch, so whichever replayed last dropped the other's
-- tables (shared_groups / shared_entries or accrual_system_accounts).
--
-- CREATE OR REPLACE is idempotent; the bodies match database/schema.sql.

CREATE OR REPLACE FUNCTION currency_code_in_use_globally(p_code VARCHAR)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM shared_groups WHERE currency_code = p_code
    UNION ALL SELECT 1 FROM shared_entries WHERE original_currency_code = p_code
    UNION ALL
    SELECT 1 FROM user_currency_preferences WHERE currency_code = p_code
    UNION ALL SELECT 1 FROM exchange_rates
      WHERE from_currency = p_code OR to_currency = p_code
    UNION ALL SELECT 1 FROM exchange_rate_coverage
      WHERE from_currency = p_code OR to_currency = p_code
    UNION ALL SELECT 1 FROM accounts WHERE currency_code = p_code
    UNION ALL SELECT 1 FROM transactions
      WHERE currency_code = p_code OR original_currency_code = p_code
    UNION ALL SELECT 1 FROM securities WHERE currency_code = p_code
    UNION ALL SELECT 1 FROM bond_programs WHERE currency_code = p_code
    UNION ALL SELECT 1 FROM bond_instruments WHERE currency_code = p_code
    UNION ALL SELECT 1 FROM scheduled_transactions
      WHERE currency_code = p_code OR original_currency_code = p_code
    UNION ALL SELECT 1 FROM budgets WHERE currency_code = p_code
    UNION ALL SELECT 1 FROM warranties WHERE currency_code = p_code
    UNION ALL SELECT 1 FROM accrual_system_accounts WHERE currency_code = p_code
    UNION ALL SELECT 1 FROM user_preferences WHERE default_currency = p_code
  )
$$;

CREATE OR REPLACE FUNCTION currency_codes_referenced_by_user_data(p_user_id uuid)
RETURNS SETOF varchar
LANGUAGE sql
STABLE
AS $$
  SELECT code FROM (
    SELECT currency_code AS code FROM shared_groups WHERE id IN (SELECT g.id FROM shared_groups g WHERE g.owner_user_id = p_user_id OR EXISTS (SELECT 1 FROM shared_memberships m WHERE m.group_id = g.id AND m.user_id = p_user_id AND m.revoked_at IS NULL))
    UNION SELECT original_currency_code FROM shared_entries WHERE group_id IN (SELECT g.id FROM shared_groups g WHERE g.owner_user_id = p_user_id OR EXISTS (SELECT 1 FROM shared_memberships m WHERE m.group_id = g.id AND m.user_id = p_user_id AND m.revoked_at IS NULL))
    UNION SELECT default_currency AS code FROM user_preferences WHERE user_id = p_user_id
    UNION SELECT currency_code FROM accounts WHERE user_id = p_user_id
    UNION SELECT currency_code FROM transactions WHERE user_id = p_user_id
    UNION SELECT original_currency_code FROM transactions WHERE user_id = p_user_id
    UNION SELECT currency_code FROM securities WHERE user_id = p_user_id
    UNION SELECT currency_code FROM scheduled_transactions WHERE user_id = p_user_id
    UNION SELECT original_currency_code FROM scheduled_transactions WHERE user_id = p_user_id
    UNION SELECT currency_code FROM budgets WHERE user_id = p_user_id
    UNION SELECT currency_code FROM warranties WHERE user_id = p_user_id
    UNION SELECT currency_code FROM accrual_system_accounts WHERE user_id = p_user_id
  ) referenced
  WHERE code IS NOT NULL
$$;
