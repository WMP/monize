-- 134: Joint accounts -- delegate-read policy arms for native reads.
--
-- Migration 132 gave transactions a delegate READ arm so a delegate's own
-- session can see rows in accounts shared to them. A joint account is read
-- natively -- the grantee's session runs with app.current_user_id =
-- app.real_user_id = the grantee -- so under RLS_MODE=enforce every other
-- table those reads touch still returns zero rows. This migration adds the
-- matching read-only arm (USING only; WITH CHECK stays owner-only everywhere,
-- exactly like 132: grantee writes run under the audited withSystemContext
-- bypass after in-code authorization) to:
--
--   accounts, monthly_account_balances     -- account-scoped via the grant
--   transaction_splits, transaction_tags   -- via the parent transaction's account
--   categories, payees, tags               -- delegation-scoped (see below)
--
-- The reference-data arms (categories/payees/tags) are gated on ANY active
-- delegation from the row's owner rather than a per-account grant, because
-- those tables are not account-scoped. This widens nothing the app layer does
-- not already grant: an acting delegate already reads the owner's entire
-- category/payee/tag lists today (acting context sets app.current_user_id to
-- the owner), and the app layer serves them natively only through the
-- grant-gated reference-data endpoint.
--
-- Arms are gated on can_read (not is_joint), consistent with 132: RLS is
-- defense-in-depth, and joint-vs-plain visibility is an app-layer decision.
--
-- Each ENABLE below is a no-op on databases that ran 123/132 (and fresh
-- installs enable via schema.sql's dynamic loop), but the post-123 convention
-- requires every policy migration to ship its own enables.
--
-- Behavior-neutral at RLS_MODE=off/shadow (the app connects as the table
-- owner, so policies are not consulted).

-- ---------------------------------------------------------------------------
-- accounts
-- ---------------------------------------------------------------------------
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS accounts_isolation ON accounts;
CREATE POLICY accounts_isolation ON accounts
  USING (user_id = (SELECT app_current_user_id())
      OR (SELECT app_bypass_rls())
      OR EXISTS (SELECT 1 FROM account_delegate_grants g
                 JOIN account_delegates d ON d.id = g.delegation_id
                 WHERE g.account_id = accounts.id
                   AND g.can_read AND d.status = 'active'
                   AND d.delegate_user_id = (SELECT app_real_user_id())))
  WITH CHECK (user_id = (SELECT app_current_user_id()) OR (SELECT app_bypass_rls()));

-- ---------------------------------------------------------------------------
-- monthly_account_balances
-- ---------------------------------------------------------------------------
ALTER TABLE monthly_account_balances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS monthly_account_balances_isolation ON monthly_account_balances;
CREATE POLICY monthly_account_balances_isolation ON monthly_account_balances
  USING (user_id = (SELECT app_current_user_id())
      OR (SELECT app_bypass_rls())
      OR EXISTS (SELECT 1 FROM account_delegate_grants g
                 JOIN account_delegates d ON d.id = g.delegation_id
                 WHERE g.account_id = monthly_account_balances.account_id
                   AND g.can_read AND d.status = 'active'
                   AND d.delegate_user_id = (SELECT app_real_user_id())))
  WITH CHECK (user_id = (SELECT app_current_user_id()) OR (SELECT app_bypass_rls()));

-- ---------------------------------------------------------------------------
-- transaction_splits (indirect -> transactions; the delegate arm resolves the
-- parent transaction's account against the caller's grants)
-- ---------------------------------------------------------------------------
ALTER TABLE transaction_splits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transaction_splits_isolation ON transaction_splits;
CREATE POLICY transaction_splits_isolation ON transaction_splits
  USING ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM transactions t
    WHERE t.id = transaction_splits.transaction_id
      AND t.user_id = (SELECT app_current_user_id()))
      OR EXISTS (
    SELECT 1 FROM transactions t
    JOIN account_delegate_grants g ON g.account_id = t.account_id
    JOIN account_delegates d ON d.id = g.delegation_id
    WHERE t.id = transaction_splits.transaction_id
      AND g.can_read AND d.status = 'active'
      AND d.delegate_user_id = (SELECT app_real_user_id())))
  WITH CHECK ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM transactions t
    WHERE t.id = transaction_splits.transaction_id
      AND t.user_id = (SELECT app_current_user_id())));

-- ---------------------------------------------------------------------------
-- transaction_tags (same shape as transaction_splits)
-- ---------------------------------------------------------------------------
ALTER TABLE transaction_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transaction_tags_isolation ON transaction_tags;
CREATE POLICY transaction_tags_isolation ON transaction_tags
  USING ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM transactions t
    WHERE t.id = transaction_tags.transaction_id
      AND t.user_id = (SELECT app_current_user_id()))
      OR EXISTS (
    SELECT 1 FROM transactions t
    JOIN account_delegate_grants g ON g.account_id = t.account_id
    JOIN account_delegates d ON d.id = g.delegation_id
    WHERE t.id = transaction_tags.transaction_id
      AND g.can_read AND d.status = 'active'
      AND d.delegate_user_id = (SELECT app_real_user_id())))
  WITH CHECK ((SELECT app_bypass_rls()) OR EXISTS (
    SELECT 1 FROM transactions t
    WHERE t.id = transaction_tags.transaction_id
      AND t.user_id = (SELECT app_current_user_id())));

-- ---------------------------------------------------------------------------
-- categories / payees / tags (delegation-scoped read arms)
-- ---------------------------------------------------------------------------
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS categories_isolation ON categories;
CREATE POLICY categories_isolation ON categories
  USING (user_id = (SELECT app_current_user_id())
      OR (SELECT app_bypass_rls())
      OR EXISTS (SELECT 1 FROM account_delegates d
                 WHERE d.owner_user_id = categories.user_id
                   AND d.status = 'active'
                   AND d.delegate_user_id = (SELECT app_real_user_id())))
  WITH CHECK (user_id = (SELECT app_current_user_id()) OR (SELECT app_bypass_rls()));

ALTER TABLE payees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payees_isolation ON payees;
CREATE POLICY payees_isolation ON payees
  USING (user_id = (SELECT app_current_user_id())
      OR (SELECT app_bypass_rls())
      OR EXISTS (SELECT 1 FROM account_delegates d
                 WHERE d.owner_user_id = payees.user_id
                   AND d.status = 'active'
                   AND d.delegate_user_id = (SELECT app_real_user_id())))
  WITH CHECK (user_id = (SELECT app_current_user_id()) OR (SELECT app_bypass_rls()));

ALTER TABLE tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tags_isolation ON tags;
CREATE POLICY tags_isolation ON tags
  USING (user_id = (SELECT app_current_user_id())
      OR (SELECT app_bypass_rls())
      OR EXISTS (SELECT 1 FROM account_delegates d
                 WHERE d.owner_user_id = tags.user_id
                   AND d.status = 'active'
                   AND d.delegate_user_id = (SELECT app_real_user_id())))
  WITH CHECK (user_id = (SELECT app_current_user_id()) OR (SELECT app_bypass_rls()));
