-- 133: Joint accounts -- opt-in flag on delegation grants + per-grantee
-- net-worth exclusions.
--
-- A grant row with can_read AND is_joint (under an active delegation) makes
-- the account natively visible in the delegate's OWN context: account list,
-- register, net worth. Plain grants (is_joint = false) keep today's behavior
-- exactly -- visible only while acting in the owner's context -- so the
-- default false changes nothing on deploy.
--
-- delegate_net_worth_exclusions is the grantee-side overlay: row presence
-- means "exclude this joint account from MY net worth". It is modeled on
-- delegate_account_favourites (owner-column bucket, keyed by the REAL user)
-- so the owner's accounts.exclude_from_net_worth stays owner-scoped and the
-- owner can never read or write a grantee's private preference.

ALTER TABLE account_delegate_grants
    ADD COLUMN IF NOT EXISTS is_joint BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS delegate_net_worth_exclusions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    delegate_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (delegate_user_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_delegate_net_worth_exclusions_user
    ON delegate_net_worth_exclusions(delegate_user_id);

-- Owner-column policy: belongs to the delegate personally, like
-- delegate_account_favourites. The current arm covers the delegate's own
-- session; the real arm keeps the row reachable while acting.
ALTER TABLE delegate_net_worth_exclusions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS delegate_net_worth_exclusions_isolation ON delegate_net_worth_exclusions;
CREATE POLICY delegate_net_worth_exclusions_isolation ON delegate_net_worth_exclusions
  USING (delegate_user_id = (SELECT app_real_user_id())
      OR (SELECT app_bypass_rls()))
  WITH CHECK (delegate_user_id = (SELECT app_real_user_id())
      OR (SELECT app_bypass_rls()));
