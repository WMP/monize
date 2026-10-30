-- Expand required accrual history storage without raising the inline JSONB limit.
-- The composite parent key enforces ownership independently of RLS.
-- A versioned physical kind refuses unsupported replay on older backends;
-- presentation keeps the original kind in this private, nullable field.
ALTER TABLE action_history ADD COLUMN IF NOT EXISTS accrual_entity_type VARCHAR(50);
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'action_history'::regclass AND conname = 'uq_action_history_owner') THEN
        ALTER TABLE action_history ADD CONSTRAINT uq_action_history_owner UNIQUE (id, user_id);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS accrual_history_chunks (
    action_id UUID NOT NULL,
    user_id UUID NOT NULL,
    side VARCHAR(6) NOT NULL,
    part_index INTEGER NOT NULL,
    payload BYTEA NOT NULL,
    PRIMARY KEY (action_id, side, part_index),
    CONSTRAINT fk_accrual_history_chunk_owner FOREIGN KEY (action_id, user_id)
        REFERENCES action_history(id, user_id) ON DELETE CASCADE,
    CONSTRAINT ck_accrual_history_chunk_side CHECK (side IN ('before', 'after')),
    CONSTRAINT ck_accrual_history_chunk_index CHECK (part_index >= 0),
    CONSTRAINT ck_accrual_history_chunk_size CHECK (octet_length(payload) BETWEEN 1 AND 65536)
);

DROP POLICY IF EXISTS accrual_history_chunks_isolation ON accrual_history_chunks;
CREATE POLICY accrual_history_chunks_isolation ON accrual_history_chunks
    USING (user_id = (SELECT app_current_user_id()) OR (SELECT app_bypass_rls()))
    WITH CHECK (user_id = (SELECT app_current_user_id()) OR (SELECT app_bypass_rls()));
ALTER TABLE accrual_history_chunks ENABLE ROW LEVEL SECURITY;
