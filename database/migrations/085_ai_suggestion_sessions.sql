-- AI suggestion sessions: a generic DRAFT -> REVIEW -> APPLY store for AI
-- suggestions. The external LLM (via the AI assistant or the MCP write tool)
-- may only create a DRAFT here; applying a session is a human action performed
-- in the UI through a REST endpoint. The mechanism is intentionally generic so
-- other features can reuse it: 'payee_categorization' now, 'broker_import'
-- (#646) later. Per-item suggestion data lives in the jsonb `items` column;
-- display fields (names, samples) are resolved fresh on read, never stored.

CREATE TABLE IF NOT EXISTS ai_suggestion_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind VARCHAR(40) NOT NULL,            -- 'payee_categorization', 'broker_import'
    status VARCHAR(20) NOT NULL DEFAULT 'draft',  -- 'draft', 'applied', 'discarded'
    title VARCHAR(255),
    items JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_suggestion_sessions_user
    ON ai_suggestion_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_ai_suggestion_sessions_user_kind_status
    ON ai_suggestion_sessions(user_id, kind, status);
