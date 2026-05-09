-- Allow scheduled-transaction splits to embed an investment action so a
-- recurring paycheck-with-equity-grant template can be saved and posted
-- with brokerage holdings updates each occurrence.

ALTER TABLE scheduled_transaction_splits
  ADD COLUMN IF NOT EXISTS kind VARCHAR(20);

UPDATE scheduled_transaction_splits SET kind = 'transfer'
  WHERE kind IS NULL AND transfer_account_id IS NOT NULL;
UPDATE scheduled_transaction_splits SET category_id = NULL
  WHERE kind = 'transfer' AND category_id IS NOT NULL;
UPDATE scheduled_transaction_splits SET kind = 'category'
  WHERE kind IS NULL;

ALTER TABLE scheduled_transaction_splits
  ALTER COLUMN kind SET NOT NULL;

ALTER TABLE scheduled_transaction_splits
  ALTER COLUMN kind SET DEFAULT 'category';

ALTER TABLE scheduled_transaction_splits
  ADD COLUMN IF NOT EXISTS investment_action VARCHAR(50),
  ADD COLUMN IF NOT EXISTS investment_security_id UUID REFERENCES securities(id),
  ADD COLUMN IF NOT EXISTS investment_quantity NUMERIC(20, 8),
  ADD COLUMN IF NOT EXISTS investment_price NUMERIC(20, 6),
  ADD COLUMN IF NOT EXISTS investment_commission NUMERIC(20, 4),
  ADD COLUMN IF NOT EXISTS investment_exchange_rate NUMERIC(20, 10);

CREATE INDEX IF NOT EXISTS idx_scheduled_transaction_splits_inv_security
  ON scheduled_transaction_splits(investment_security_id);

ALTER TABLE scheduled_transaction_splits
  DROP CONSTRAINT IF EXISTS chk_scheduled_split_kind_exclusive;

ALTER TABLE scheduled_transaction_splits
  ADD CONSTRAINT chk_scheduled_split_kind_exclusive CHECK (
    (kind = 'category'   AND transfer_account_id IS NULL AND investment_action IS NULL) OR
    (kind = 'transfer'   AND transfer_account_id IS NOT NULL AND category_id IS NULL AND investment_action IS NULL) OR
    (kind = 'investment' AND category_id IS NULL AND transfer_account_id IS NULL AND investment_action IS NOT NULL)
  );
