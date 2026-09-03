-- Per-security control over whether we ask the quote provider for prices.
--
-- `skip_price_updates` already exists, but it means something narrower: it is
-- set by QIF/OFX imports on auto-generated symbols that may not be real
-- tickers, and it is cleared the moment the user picks a provider override. It
-- cannot express "this is a real security the user tracks, but no provider
-- carries it" -- a private fund, a delisted instrument, a bond -- where every
-- refresh is a wasted round trip that logs a failure.
--
-- `price_fetch_status` is that switch, with three states:
--   'active'        -- fetch normally (the default).
--   'auto_disabled' -- the system stopped fetching after a run of provider
--                      "no such symbol" (HTTP 404/422) answers. It is re-probed
--                      occasionally and returns to 'active' by itself if the
--                      data comes back.
--   'disabled'      -- the user turned fetching off; never fetched, never
--                      re-probed, until the user turns it back on.
--
-- Only a provider answering "this symbol does not exist" counts toward
-- auto-disable; a throttle, a timeout or an outage does not, so a provider
-- being down cannot auto-disable every security at once. The streak and the
-- last-failure instant are tracked so the count-based threshold and the
-- re-probe cooldown can both be evaluated.

ALTER TABLE securities
  ADD COLUMN IF NOT EXISTS price_fetch_status VARCHAR(20) NOT NULL DEFAULT 'active';

ALTER TABLE securities
  ADD COLUMN IF NOT EXISTS price_fetch_failure_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE securities
  ADD COLUMN IF NOT EXISTS price_fetch_last_failure_at TIMESTAMP;

ALTER TABLE securities
  ADD COLUMN IF NOT EXISTS price_fetch_auto_disabled_at TIMESTAMP;

ALTER TABLE securities
  DROP CONSTRAINT IF EXISTS securities_price_fetch_status_check;

ALTER TABLE securities
  ADD CONSTRAINT securities_price_fetch_status_check
    CHECK (price_fetch_status IN ('active', 'auto_disabled', 'disabled'));
