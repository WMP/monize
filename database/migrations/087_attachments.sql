-- Generic attachments table (receipts, invoices, screenshots, PDFs).
--
-- Polymorphic by (entity_type, entity_id) so the same table backs AI-chat
-- uploads now and transaction attachments later without a schema change. Bytes
-- default to Postgres BYTEA (storage_driver='db', mirroring institution logo
-- storage). storage_driver/storage_key leave room for local-file or S3 backends
-- where the bytes live elsewhere and 'data' stays null.

CREATE TABLE IF NOT EXISTS attachments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entity_type VARCHAR(40) NOT NULL,
    entity_id UUID,
    file_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(150) NOT NULL,
    size_bytes INTEGER NOT NULL,
    storage_driver VARCHAR(20) NOT NULL DEFAULT 'db',
    storage_key VARCHAR(500),
    data BYTEA,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT attachments_size_bytes_check CHECK (size_bytes >= 0)
);

CREATE INDEX IF NOT EXISTS idx_attachments_user ON attachments(user_id);
CREATE INDEX IF NOT EXISTS idx_attachments_entity ON attachments(entity_type, entity_id);
