-- Rollback for migration 103_loan_scenarios_target_monthly_payment.sql
--
-- Run this manually if the fixed monthly-budget feature is NOT merged and you
-- want to remove its columns from a database where migration 103 was applied.
--
-- Safe and idempotent:
--   * the four columns are nullable and additive, so dropping them does not
--     touch any existing scenario data (recurring extra / lump sums are intact);
--   * DROP ... IF EXISTS makes it safe to run more than once.
--
-- IMPORTANT: only run this AFTER the backend that added these columns is no
-- longer running against this database. If the branch that ships migration 103
-- is still deployed, the next startup will re-apply it and re-add the columns.

ALTER TABLE loan_scenarios
  DROP COLUMN IF EXISTS target_monthly_payment,
  DROP COLUMN IF EXISTS target_monthly_payment_mode,
  DROP COLUMN IF EXISTS target_monthly_payment_start_date,
  DROP COLUMN IF EXISTS target_monthly_payment_end_date;

-- Forget the migration so it re-applies cleanly if the feature returns later.
DELETE FROM schema_migrations
  WHERE filename = '103_loan_scenarios_target_monthly_payment.sql';
