-- Delegate account access (Phase 1)
-- An account owner can grant another user ("delegate") scoped access to their
-- financial data. Delegates are normal `users` rows; the relationship and the
-- per-account permissions live here. Only can_read is enforced in Phase 1;
-- can_create/edit/delete columns exist for Phase 2.

CREATE TABLE IF NOT EXISTS account_delegates (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    delegate_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status           VARCHAR(20) NOT NULL DEFAULT 'active', -- 'pending' | 'active' | 'revoked'
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    revoked_at       TIMESTAMP,
    CONSTRAINT account_delegates_owner_delegate_unique UNIQUE (owner_user_id, delegate_user_id),
    CONSTRAINT account_delegates_no_self CHECK (owner_user_id <> delegate_user_id)
);

CREATE INDEX IF NOT EXISTS idx_account_delegates_delegate
    ON account_delegates(delegate_user_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_account_delegates_owner
    ON account_delegates(owner_user_id);

CREATE TABLE IF NOT EXISTS account_delegate_grants (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    delegation_id UUID NOT NULL REFERENCES account_delegates(id) ON DELETE CASCADE,
    account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    can_read   BOOLEAN NOT NULL DEFAULT true,
    can_create BOOLEAN NOT NULL DEFAULT false,
    can_edit   BOOLEAN NOT NULL DEFAULT false,
    can_delete BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT account_delegate_grants_unique UNIQUE (delegation_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_adg_delegation
    ON account_delegate_grants(delegation_id);

-- Carry the delegate "acting as owner" context across refresh-token rotation
-- so a 15-minute access-token expiry does not silently drop the context.
ALTER TABLE refresh_tokens
    ADD COLUMN IF NOT EXISTS acting_as_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS delegation_id UUID REFERENCES account_delegates(id) ON DELETE CASCADE;
