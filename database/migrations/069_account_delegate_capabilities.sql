-- Delegate "manage" capabilities (Phase 2 / 2C). These are per-delegation
-- (not per-account): the owner may let a delegate CREATE/EDIT/DELETE payees,
-- categories and/or tags. Default false (fail closed).

ALTER TABLE account_delegates
    ADD COLUMN IF NOT EXISTS can_manage_payees     BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS can_manage_categories BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS can_manage_tags       BOOLEAN NOT NULL DEFAULT false;
