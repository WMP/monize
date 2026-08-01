-- Simplified per-account tax estimation settings for accounts that hold
-- securities (a plain brokerage account, IKE/IKZE, a foreign investment
-- account). These drive an *estimate* only -- there are no brackets, no
-- allowances, no loss carry-forward and no tax-lot matching. Every column is
-- nullable/defaulted so existing accounts keep behaving exactly as before.
--
-- Capital gains (tax on selling an instrument):
--   'none'                      -- no tax (tax-exempt or tax-deferred account)
--   'percentage_of_profit'      -- rate applied to the positive realized profit
--   'percentage_of_sale_value'  -- rate applied to the gross sale value
--
-- Dividends:
--   'none'                          -- no additional dividend tax
--   'percentage_of_gross_dividend'  -- rate applied to the gross dividend
--
-- Rates are stored as percentages (19.0000 = 19%), matching interest_rate and
-- fx_fee_percent.

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS capital_gains_tax_mode VARCHAR(32) NOT NULL DEFAULT 'none';

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS capital_gains_tax_rate NUMERIC(8, 4);

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS dividend_tax_mode VARCHAR(32) NOT NULL DEFAULT 'none';

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS dividend_tax_rate NUMERIC(8, 4);

-- Percentage assumed to have already been withheld at source on a gross
-- dividend. User-supplied; never inferred from country, exchange or currency.
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS dividend_withholding_tax_rate NUMERIC(8, 4);

-- When true, an estimated dividend tax is reduced by the tax already withheld
-- (never below zero).
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS deduct_recorded_withholding_tax BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS chk_capital_gains_tax_mode;

ALTER TABLE accounts
  ADD CONSTRAINT chk_capital_gains_tax_mode CHECK (
    capital_gains_tax_mode IN (
      'none',
      'percentage_of_profit',
      'percentage_of_sale_value'
    )
  );

ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS chk_dividend_tax_mode;

ALTER TABLE accounts
  ADD CONSTRAINT chk_dividend_tax_mode CHECK (
    dividend_tax_mode IN ('none', 'percentage_of_gross_dividend')
  );

ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS chk_capital_gains_tax_rate_range;

ALTER TABLE accounts
  ADD CONSTRAINT chk_capital_gains_tax_rate_range CHECK (
    capital_gains_tax_rate IS NULL
    OR (capital_gains_tax_rate >= 0 AND capital_gains_tax_rate <= 100)
  );

ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS chk_dividend_tax_rate_range;

ALTER TABLE accounts
  ADD CONSTRAINT chk_dividend_tax_rate_range CHECK (
    dividend_tax_rate IS NULL
    OR (dividend_tax_rate >= 0 AND dividend_tax_rate <= 100)
  );

ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS chk_dividend_withholding_tax_rate_range;

ALTER TABLE accounts
  ADD CONSTRAINT chk_dividend_withholding_tax_rate_range CHECK (
    dividend_withholding_tax_rate IS NULL
    OR (dividend_withholding_tax_rate >= 0 AND dividend_withholding_tax_rate <= 100)
  );
