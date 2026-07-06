-- Per-user dashboard widget layout: an ordered list of { id, visible } entries
-- describing widget order and visibility. An empty array means "use the
-- frontend registry defaults", so existing users see no change until they edit
-- their dashboard.
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS dashboard_widgets JSONB DEFAULT '[]';
