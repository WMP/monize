-- One global answer to "is this currency code still referenced?"
--
-- `currencies` is shared reference data: any user may activate a code another
-- user created, and columns across most of the financial tables point at
-- `currencies(code)`. Deleting a row any of them still holds either aborts the
-- statement with a foreign-key violation or -- for the one FK that cascades,
-- `user_currency_preferences` -- silently removes another user's row.
--
-- Two call sites decided whether a code was still live, and both were wrong in
-- their own way:
--
--   * `CurrenciesService.isInUseGlobally` enumerated only some of them.
--     `budgets.currency_code` and both `exchange_rates` columns were missing, so
--     it could report a live code as dead and hand the caller a foreign-key
--     violation instead of a conflict.
--   * The backup restore's cleanup enumerated all of them, but ran inside the
--     restoring user's transaction. Under RLS the `NOT EXISTS` subqueries over
--     other users' rows cannot see those rows, so "nobody else references it"
--     was really "I do not reference it" -- and the cascade then took another
--     user's activation with it.
--
-- The predicate is therefore written once, here, and both callers call it.
--
-- SECURITY DEFINER is what makes it global. RLS policies are evaluated against
-- `current_user`, which inside a definer function is this function's owner --
-- the schema owner, which is not subject to its own policies. Running it inside
-- the caller's transaction keeps the check and the delete a single
-- read-modify-write, which a separate system-context connection could not do.
--
-- The privilege granted is deliberately tiny: one VARCHAR in, one boolean out,
-- no row contents exposed, no way to influence which tables are consulted.
-- `search_path` is pinned so a caller cannot shadow `public` with objects of
-- their own, and EXECUTE is revoked from PUBLIC and granted back only to the
-- roles that need it. Any change to the reference list must keep
-- `currency-references.spec.ts` green: it parses every FK to `currencies(code)`
-- out of `database/schema.sql` and fails when one is not consulted here.

CREATE OR REPLACE FUNCTION currency_code_in_use_globally(p_code VARCHAR)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_currency_preferences WHERE currency_code = p_code
    UNION ALL SELECT 1 FROM exchange_rates
      WHERE from_currency = p_code OR to_currency = p_code
    UNION ALL SELECT 1 FROM accounts WHERE currency_code = p_code
    UNION ALL SELECT 1 FROM transactions
      WHERE currency_code = p_code OR original_currency_code = p_code
    UNION ALL SELECT 1 FROM securities WHERE currency_code = p_code
    UNION ALL SELECT 1 FROM scheduled_transactions
      WHERE currency_code = p_code OR original_currency_code = p_code
    UNION ALL SELECT 1 FROM budgets WHERE currency_code = p_code
    UNION ALL SELECT 1 FROM user_preferences WHERE default_currency = p_code
  )
$$;

COMMENT ON FUNCTION currency_code_in_use_globally(VARCHAR) IS
  'True when any row anywhere still references currencies(code) = p_code. '
  'SECURITY DEFINER so the answer is genuinely global rather than the calling '
  'tenant''s view of it; runs in the caller''s transaction so the check and the '
  'delete it guards are one read-modify-write. Must consult every FK to '
  'currencies(code) -- enforced by currency-references.spec.ts.';

-- Not a general-purpose helper: only the owner and the runtime role call it.
-- This migration must not name the runtime role (it may not exist yet on a
-- given deployment, and a failing GRANT would crash-loop startup), so the
-- runtime grant lives in backend/src/db-init.ts alongside the other role
-- grants. Revoking PUBLIC here is safe because PUBLIC always exists.
REVOKE ALL ON FUNCTION currency_code_in_use_globally(VARCHAR) FROM PUBLIC;
