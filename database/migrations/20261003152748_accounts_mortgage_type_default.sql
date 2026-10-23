-- Mortgage type default (docs/specs/mortgage-types.md, decision 6, task
-- P3-B1): every accounts.mortgage_type still null takes a type, and the column
-- defaults to 'ANNUITY'.
--
-- Expand only. 1.20.0 is the first release whose code neither reads nor writes
-- is_canadian_mortgage / is_variable_rate, but 1.19.x still maps both and
-- may write a null mortgage_type on a non-mortgage account, so the columns
-- stay and mortgage_type stays nullable: a rollback to 1.19.x runs against this
-- schema. NOT NULL and the two drops are the contract migration's, in a later
-- release marked "contract-after: 1.20.0".
--
-- 1. Every MORTGAGE row still null takes the type its flags denote, with the
--    Phase 1 backfill CASE (spec table 4.2): an insert by a pre-Phase-1 pod
--    during that rollout leaves one.
-- 2. Every other null row (a non-mortgage account; a plain LOAN prices as
--    ANNUITY) takes the default.
-- 3. The default. Every statement is a no-op on re-apply.
UPDATE accounts
   SET mortgage_type = CASE
         WHEN COALESCE(is_canadian_mortgage, false)
              AND NOT COALESCE(is_variable_rate, false) THEN 'CANADIAN_FIXED'
         ELSE 'ANNUITY'
       END
 WHERE account_type = 'MORTGAGE'
   AND mortgage_type IS NULL;

UPDATE accounts
   SET mortgage_type = 'ANNUITY'
 WHERE mortgage_type IS NULL;

ALTER TABLE accounts
  ALTER COLUMN mortgage_type SET DEFAULT 'ANNUITY';
