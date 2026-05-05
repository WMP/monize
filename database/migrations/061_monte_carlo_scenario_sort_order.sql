-- 061: User-controlled display order for Monte Carlo scenarios.
--
-- Lets users reorder their scenarios in the sidebar via the same up/down
-- arrow UX used for favourite accounts. The position in the list corresponds
-- to ascending sort_order.

ALTER TABLE monte_carlo_scenarios
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_monte_carlo_scenarios_user_sort
  ON monte_carlo_scenarios(user_id, sort_order);
