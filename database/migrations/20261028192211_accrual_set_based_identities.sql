-- Replace per-row identity mapping with sparse invoker joins for enforced RLS.
CREATE INDEX IF NOT EXISTS idx_accrual_schedule_source ON accrual_schedules(source_transaction_id);

-- Sparse mapping: only scheduled sources that have a reporting row on their
-- payment date need a changed identity. Callers join this set, never invoke a
-- table-reading scalar function once per ledger row. Policies remain invoker's.
CREATE OR REPLACE FUNCTION accrual_reporting_cash_links_rows() RETURNS TABLE(
 source_id uuid,reporting_id uuid,cash_date date,user_id uuid
) LANGUAGE sql STABLE SECURITY INVOKER AS $read_model$
 SELECT t.id,md5(t.id::text||TO_CHAR(t.transaction_date,'YYYY-MM-DD')||'accrual-report-v1')::uuid,t.transaction_date,t.user_id
 FROM (SELECT DISTINCT source_transaction_id,user_id FROM public.accrual_schedules) scheduled
 JOIN public.transactions t ON t.id=scheduled.source_transaction_id AND t.user_id=scheduled.user_id
 WHERE NOT t.is_transfer AND t.status IS DISTINCT FROM 'VOID'
 AND (
   EXISTS(SELECT 1 FROM public.accrual_schedules s JOIN public.accrual_allocations a ON a.schedule_id=s.id AND a.user_id=s.user_id
          WHERE s.source_transaction_id=t.id AND s.user_id=t.user_id AND a.recognition_date=t.transaction_date)
   OR (t.is_split AND EXISTS(SELECT 1 FROM public.transaction_splits sp WHERE sp.transaction_id=t.id
       AND NOT EXISTS(SELECT 1 FROM public.accrual_schedules s WHERE s.source_transaction_id=t.id AND s.user_id=t.user_id AND s.source_split_id=sp.id)))
 )
$read_model$;
CREATE OR REPLACE VIEW public.accrual_reporting_cash_links WITH (security_invoker=true) AS
SELECT * FROM public.accrual_reporting_cash_links_rows();

CREATE OR REPLACE FUNCTION accrual_reporting_transactions_rows() RETURNS TABLE(
 "id" uuid,
 "user_id" uuid,
 "account_id" uuid,
 "transaction_date" date,
 "payee_id" uuid,
 "payee_name" character varying(255),
 "category_id" uuid,
 "amount" numeric,
 "currency_code" character varying(3),
 "exchange_rate" numeric(20,10),
 "original_amount" numeric(20,4),
 "original_currency_code" character varying(3),
 "description" text,
 "reference_number" character varying(100),
 "status" character varying(20),
 "reconciled_date" date,
 "is_split" boolean,
 "parent_transaction_id" uuid,
 "is_transfer" boolean,
 "linked_transaction_id" uuid,
 "external_id" character varying(255),
 "created_at" timestamp without time zone,
 "updated_at" timestamp without time zone,
 "is_recognition" boolean,
 "source_transaction_id" uuid,
 "source_cash_date" date,
 "source_amount" numeric(20,4),
 "source_linked_id" uuid,
 "source_parent_id" uuid
) LANGUAGE sql STABLE SECURITY INVOKER AS $read_model$
SELECT t.id AS id,
 t.user_id AS user_id,
 t.account_id AS account_id,
 t.transaction_date AS transaction_date,
 t.payee_id AS payee_id,
 t.payee_name AS payee_name,
 t.category_id AS category_id,
 t.amount AS amount,
 t.currency_code AS currency_code,
 t.exchange_rate AS exchange_rate,
 t.original_amount AS original_amount,
 t.original_currency_code AS original_currency_code,
 t.description AS description,
 t.reference_number AS reference_number,
 t.status AS status,
 t.reconciled_date AS reconciled_date,
 t.is_split AS is_split,
 COALESCE(parent_map.reporting_id,t.parent_transaction_id) AS parent_transaction_id,
 t.is_transfer AS is_transfer,
 t.linked_transaction_id AS linked_transaction_id,
 t.external_id AS external_id,
 t.created_at AS created_at,
 t.updated_at AS updated_at,false AS is_recognition,t.id AS source_transaction_id,t.transaction_date AS source_cash_date,t.amount AS source_amount,t.linked_transaction_id AS source_linked_id,t.parent_transaction_id AS source_parent_id
FROM public.transactions t
LEFT JOIN public.accrual_reporting_cash_links parent_map ON parent_map.source_id=t.parent_transaction_id AND parent_map.user_id=t.user_id
WHERE NOT EXISTS(SELECT 1 FROM public.accrual_schedules s WHERE s.source_transaction_id=t.id AND s.user_id=t.user_id AND NOT t.is_transfer AND t.status IS DISTINCT FROM 'VOID')
UNION ALL
SELECT md5(t.id::text||TO_CHAR(p.effective_date,'YYYY-MM-DD')||'accrual-report-v1')::uuid AS id,
 t.user_id AS user_id,
 t.account_id AS account_id,
 p.effective_date AS transaction_date,
 t.payee_id AS payee_id,
 t.payee_name AS payee_name,
 t.category_id AS category_id,
 p.amount AS amount,
 t.currency_code AS currency_code,
 t.exchange_rate AS exchange_rate,
 t.original_amount AS original_amount,
 t.original_currency_code AS original_currency_code,
 t.description AS description,
 t.reference_number AS reference_number,
 t.status AS status,
 t.reconciled_date AS reconciled_date,
 t.is_split AS is_split,
 COALESCE(parent_map.reporting_id,t.parent_transaction_id) AS parent_transaction_id,
 t.is_transfer AS is_transfer,
 t.linked_transaction_id AS linked_transaction_id,
 t.external_id AS external_id,
 t.created_at AS created_at,
 t.updated_at AS updated_at,p.is_recognition,t.id AS source_transaction_id,t.transaction_date AS source_cash_date,t.amount AS source_amount,t.linked_transaction_id AS source_linked_id,t.parent_transaction_id AS source_parent_id
FROM public.transactions t
LEFT JOIN public.accrual_reporting_cash_links parent_map ON parent_map.source_id=t.parent_transaction_id AND parent_map.user_id=t.user_id
CROSS JOIN LATERAL (
 SELECT c.effective_date,SUM(c.amount) AS amount,BOOL_OR(c.schedule_id IS NOT NULL) AS is_recognition
 FROM public.accrual_reporting_components c WHERE c.source_id=t.id GROUP BY c.effective_date
) p WHERE EXISTS(SELECT 1 FROM public.accrual_schedules s WHERE s.source_transaction_id=t.id AND s.user_id=t.user_id AND NOT t.is_transfer AND t.status IS DISTINCT FROM 'VOID')
$read_model$;
CREATE OR REPLACE VIEW public.accrual_reporting_transactions WITH (security_invoker=true) AS
SELECT * FROM public.accrual_reporting_transactions_rows();

-- A SQL-string function body avoids base-column view dependencies during
-- historical migration replay. Set-returning SQL functions have no per-row scalar lookups.
CREATE OR REPLACE FUNCTION accrual_reporting_transaction_splits_rows() RETURNS TABLE(
 "id" uuid,
 "transaction_id" uuid,
 "kind" character varying(20),
 "category_id" uuid,
 "transfer_account_id" uuid,
 "linked_transaction_id" uuid,
 "amount" numeric(20,4),
 "memo" text,
 "created_at" timestamp without time zone,
 "source_split_id" uuid,
 "source_amount" numeric(20,4),
 "schedule_id" uuid,
 "source_cash_date" date,
 "effective_date" date,
 "source_linked_id" uuid,
 "reporting_user_id" uuid
) LANGUAGE sql STABLE SECURITY INVOKER AS $read_model$
SELECT sp.id AS id,
 sp.transaction_id AS transaction_id,
 sp.kind AS kind,
 sp.category_id AS category_id,
 sp.transfer_account_id AS transfer_account_id,
 sp.linked_transaction_id AS linked_transaction_id,
 sp.amount AS amount,
 sp.memo AS memo,
 sp.created_at AS created_at,sp.id AS source_split_id,sp.amount AS source_amount,NULL::uuid AS schedule_id,t.transaction_date AS source_cash_date,t.transaction_date AS effective_date,sp.linked_transaction_id AS source_linked_id,t.user_id AS reporting_user_id
FROM public.transaction_splits sp JOIN public.transactions t ON t.id=sp.transaction_id
WHERE NOT EXISTS(SELECT 1 FROM public.accrual_schedules s WHERE s.source_transaction_id=t.id AND s.user_id=t.user_id AND NOT t.is_transfer AND t.status IS DISTINCT FROM 'VOID')
UNION ALL
SELECT md5(sp.id::text||TO_CHAR(t.transaction_date,'YYYY-MM-DD')||'accrual-report-split-v1')::uuid AS id,
 md5(t.id::text||TO_CHAR(t.transaction_date,'YYYY-MM-DD')||'accrual-report-v1')::uuid AS transaction_id,
 sp.kind AS kind,
 sp.category_id AS category_id,
 sp.transfer_account_id AS transfer_account_id,
 sp.linked_transaction_id AS linked_transaction_id,
 sp.amount AS amount,
 sp.memo AS memo,
 sp.created_at AS created_at,
 sp.id AS source_split_id,
 sp.amount AS source_amount,
 NULL::uuid AS schedule_id,
 t.transaction_date AS source_cash_date,
 t.transaction_date AS effective_date,
 sp.linked_transaction_id AS source_linked_id,t.user_id AS reporting_user_id
FROM public.transaction_splits sp JOIN public.transactions t ON t.id=sp.transaction_id
WHERE EXISTS(SELECT 1 FROM public.accrual_schedules s WHERE s.source_transaction_id=t.id AND s.user_id=t.user_id AND NOT t.is_transfer AND t.status IS DISTINCT FROM 'VOID')
AND NOT EXISTS(SELECT 1 FROM public.accrual_schedules s WHERE s.source_split_id=sp.id AND s.source_transaction_id=t.id AND s.user_id=t.user_id)
UNION ALL
SELECT md5(sp.id::text||TO_CHAR(a.recognition_date,'YYYY-MM-DD')||'accrual-report-split-v1')::uuid AS id,
 md5(t.id::text||TO_CHAR(a.recognition_date,'YYYY-MM-DD')||'accrual-report-v1')::uuid AS transaction_id,
 sp.kind AS kind,
 sp.category_id AS category_id,
 sp.transfer_account_id AS transfer_account_id,
 sp.linked_transaction_id AS linked_transaction_id,
 a.amount AS amount,
 sp.memo AS memo,
 sp.created_at AS created_at,
 sp.id AS source_split_id,
 sp.amount AS source_amount,
 s.id AS schedule_id,
 t.transaction_date AS source_cash_date,
 a.recognition_date AS effective_date,
 sp.linked_transaction_id AS source_linked_id,t.user_id AS reporting_user_id
FROM public.transaction_splits sp JOIN public.transactions t ON t.id=sp.transaction_id
JOIN public.accrual_schedules s ON s.source_transaction_id=t.id AND s.user_id=t.user_id AND s.source_split_id=sp.id
JOIN public.accrual_allocations a ON a.schedule_id=s.id AND a.user_id=s.user_id
WHERE NOT t.is_transfer AND t.status IS DISTINCT FROM 'VOID'
$read_model$;
CREATE OR REPLACE VIEW public.accrual_reporting_transaction_splits WITH (security_invoker=true) AS
SELECT * FROM public.accrual_reporting_transaction_splits_rows();

-- A SQL-string function body avoids base-column view dependencies during
-- historical migration replay. Set-returning SQL functions have no per-row scalar lookups.
CREATE OR REPLACE FUNCTION accrual_reporting_transaction_tags_rows() RETURNS TABLE(
 "transaction_id" uuid,
 "tag_id" uuid,
 "reporting_user_id" uuid
) LANGUAGE sql STABLE SECURITY INVOKER AS $read_model$
SELECT t.id AS transaction_id,l.tag_id,t.user_id AS reporting_user_id FROM public.transactions t JOIN public.transaction_tags l ON l.transaction_id=t.id
WHERE NOT EXISTS(SELECT 1 FROM public.accrual_schedules s WHERE s.source_transaction_id=t.id AND s.user_id=t.user_id AND NOT t.is_transfer AND t.status IS DISTINCT FROM 'VOID')
UNION ALL
SELECT md5(t.id::text||TO_CHAR(p.effective_date,'YYYY-MM-DD')||'accrual-report-v1')::uuid,l.tag_id,t.user_id AS reporting_user_id
FROM public.transactions t JOIN public.transaction_tags l ON l.transaction_id=t.id
CROSS JOIN LATERAL (SELECT DISTINCT c.effective_date FROM public.accrual_reporting_components c WHERE c.source_id=t.id) p
WHERE EXISTS(SELECT 1 FROM public.accrual_schedules s WHERE s.source_transaction_id=t.id AND s.user_id=t.user_id AND NOT t.is_transfer AND t.status IS DISTINCT FROM 'VOID')
$read_model$;
CREATE OR REPLACE VIEW public.accrual_reporting_transaction_tags WITH (security_invoker=true) AS
SELECT * FROM public.accrual_reporting_transaction_tags_rows();
-- A SQL-string function body avoids base-column view dependencies during
-- historical migration replay. Set-returning SQL functions have no per-row scalar lookups.
CREATE OR REPLACE FUNCTION accrual_reporting_transaction_split_tags_rows() RETURNS TABLE(
 "transaction_split_id" uuid,
 "tag_id" uuid,
 "reporting_user_id" uuid
) LANGUAGE sql STABLE SECURITY INVOKER AS $read_model$
SELECT s.id AS transaction_split_id,l.tag_id,s.reporting_user_id FROM public.accrual_reporting_transaction_splits s
JOIN public.transaction_split_tags l ON l.transaction_split_id=s.source_split_id
$read_model$;
CREATE OR REPLACE VIEW public.accrual_reporting_transaction_split_tags WITH (security_invoker=true) AS
SELECT * FROM public.accrual_reporting_transaction_split_tags_rows();

-- A SQL-string function body avoids base-column view dependencies during
-- historical migration replay. Set-returning SQL functions have no per-row scalar lookups.
CREATE OR REPLACE FUNCTION accrual_reporting_investment_transactions_rows() RETURNS TABLE(
 "id" uuid,
 "user_id" uuid,
 "account_id" uuid,
 "transaction_id" uuid,
 "transaction_split_id" uuid,
 "linked_transaction_id" uuid,
 "security_id" uuid,
 "funding_account_id" uuid,
 "action" character varying(50),
 "transaction_date" date,
 "quantity" numeric(20,8),
 "price" numeric(24,10),
 "commission" numeric(20,4),
 "total_amount" numeric(20,4),
 "exchange_rate" numeric(20,10),
 "description" text,
 "status" character varying(20),
 "bond_instrument_id" uuid,
 "created_at" timestamp without time zone,
 "updated_at" timestamp without time zone,
 "source_transaction_id" uuid,
 "source_transaction_split_id" uuid
) LANGUAGE sql STABLE SECURITY INVOKER AS $read_model$
SELECT i.id AS id,
 i.user_id AS user_id,
 i.account_id AS account_id,
 i.transaction_id AS transaction_id,
 CASE WHEN split_parent_map.source_id IS NULL THEN i.transaction_split_id ELSE md5(cash_split.id::text||TO_CHAR(split_parent_map.cash_date,'YYYY-MM-DD')||'accrual-report-split-v1')::uuid END AS transaction_split_id,
 i.linked_transaction_id AS linked_transaction_id,
 i.security_id AS security_id,
 i.funding_account_id AS funding_account_id,
 i.action AS action,
 i.transaction_date AS transaction_date,
 i.quantity AS quantity,
 i.price AS price,
 i.commission AS commission,
 i.total_amount AS total_amount,
 i.exchange_rate AS exchange_rate,
 i.description AS description,
 i.status AS status,
 i.bond_instrument_id AS bond_instrument_id,
 i.created_at AS created_at,
 i.updated_at AS updated_at,i.transaction_id AS source_transaction_id,i.transaction_split_id AS source_transaction_split_id
FROM public.investment_transactions i
LEFT JOIN public.transaction_splits cash_split ON cash_split.id=i.transaction_split_id
LEFT JOIN public.accrual_reporting_cash_links split_parent_map ON split_parent_map.source_id=cash_split.transaction_id AND split_parent_map.user_id=i.user_id
$read_model$;
CREATE OR REPLACE VIEW public.accrual_reporting_investment_transactions WITH (security_invoker=true) AS
SELECT * FROM public.accrual_reporting_investment_transactions_rows();

DROP FUNCTION IF EXISTS public.accrual_reporting_cash_split_id(uuid);
DROP FUNCTION IF EXISTS public.accrual_reporting_cash_id(uuid);
