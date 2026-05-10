-- Add an "investment" kind to scheduled_transactions, mirroring how
-- is_transfer + transfer_account_id already encode the transfer kind. When
-- is_investment = TRUE the row posts via InvestmentTransactionsService and
-- updates holdings + the linked cash transaction atomically. Action,
-- security, optional funding account (for contribution+buy from a
-- non-investment account), and the per-action numeric fields all live on
-- the row. is_transfer and is_investment are mutually exclusive.

ALTER TABLE scheduled_transactions
  ADD COLUMN IF NOT EXISTS is_investment BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS investment_action VARCHAR(50),
  ADD COLUMN IF NOT EXISTS investment_security_id UUID REFERENCES securities(id),
  ADD COLUMN IF NOT EXISTS investment_funding_account_id UUID REFERENCES accounts(id),
  ADD COLUMN IF NOT EXISTS investment_quantity NUMERIC(20, 8),
  ADD COLUMN IF NOT EXISTS investment_price NUMERIC(20, 6),
  ADD COLUMN IF NOT EXISTS investment_commission NUMERIC(20, 4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS investment_total_amount NUMERIC(20, 4),
  ADD COLUMN IF NOT EXISTS investment_exchange_rate NUMERIC(20, 10);

CREATE INDEX IF NOT EXISTS idx_scheduled_transactions_inv_security
  ON scheduled_transactions(investment_security_id)
  WHERE investment_security_id IS NOT NULL;

ALTER TABLE scheduled_transactions
  DROP CONSTRAINT IF EXISTS chk_scheduled_transactions_kind_exclusive;

ALTER TABLE scheduled_transactions
  ADD CONSTRAINT chk_scheduled_transactions_kind_exclusive CHECK (
    NOT (is_transfer = TRUE AND is_investment = TRUE)
  );
