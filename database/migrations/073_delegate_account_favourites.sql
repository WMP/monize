-- A delegate's account favourites are independent of the owner's.
--
-- accounts.is_favourite / favourite_sort_order are owner-scoped. When a
-- delegate acts as an owner those flags must not be reused, so a delegate
-- keeps their own favourites here keyed by their own user id. The owner
-- path is unchanged. Idempotent: safe to run multiple times.

CREATE TABLE IF NOT EXISTS delegate_account_favourites (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    delegate_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (delegate_user_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_delegate_account_favourites_user
    ON delegate_account_favourites(delegate_user_id);
