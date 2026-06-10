-- Persist "these two payees are NOT the same" decisions from the AI Payee
-- Organizer, so suggest() never re-proposes a merge the user has rejected.
--
-- Normalization: a rejection is an unordered pair of payees. We store it
-- canonically so {A,B} and {B,A} map to one row: the lexicographically
-- smaller UUID (string compare) goes in payee_id_low, the larger in
-- payee_id_high. The UNIQUE(user_id, payee_id_low, payee_id_high) then
-- dedupes regardless of the order the pair was submitted in.
CREATE TABLE IF NOT EXISTS payee_merge_rejections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    payee_id_low UUID NOT NULL REFERENCES payees(id) ON DELETE CASCADE,
    payee_id_high UUID NOT NULL REFERENCES payees(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, payee_id_low, payee_id_high)
);

CREATE INDEX IF NOT EXISTS idx_payee_merge_rejections_user
    ON payee_merge_rejections(user_id);
