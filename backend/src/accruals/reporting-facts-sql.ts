/** Read-only parent/date projection. Source tables stay schema-qualified so scoped CTEs cannot recurse into themselves. */
export function reportingFactCtes(
  owner: string,
  basis: "cash" | "accrual",
  jointAccounts?: string,
) {
  const sourceScope = jointAccounts
    ? `(t.user_id=${owner} OR t.account_id IN (${jointAccounts}))`
    : `t.user_id=${owner}`;
  const schedules = basis === "accrual" ? "s.id IS NOT NULL" : "false";
  return [
    {
      name: "recognition_components",
      query: `SELECT t.id AS source_id, sp.id AS split_id,
      CASE WHEN ${schedules} THEN a.recognition_date ELSE t.transaction_date END AS effective_date,
      CASE WHEN ${schedules} THEN a.amount ELSE COALESCE(sp.amount,t.amount) END AS amount,
      t.currency_code,t.original_currency_code,t.exchange_rate,
      t.transaction_date AS cash_date,COALESCE(sp.amount,t.amount) AS source_amount,
      CASE WHEN ${schedules} THEN s.id ELSE NULL END AS schedule_id
      FROM public.transactions t
      LEFT JOIN public.transaction_splits sp ON sp.transaction_id=t.id AND t.is_split=true
      LEFT JOIN public.accrual_schedules s ON s.user_id=t.user_id AND s.source_transaction_id=t.id
        AND s.source_split_id IS NOT DISTINCT FROM sp.id AND t.is_transfer=false
        AND t.status IS DISTINCT FROM 'VOID'
        AND ${basis === "accrual" ? "true" : "false"}
      LEFT JOIN public.accrual_allocations a ON a.user_id=s.user_id AND a.schedule_id=s.id
      WHERE ${sourceScope}`,
    },
    {
      name: "recognition_parents",
      query: `SELECT source_id,effective_date,
      CASE WHEN EXISTS(SELECT 1 FROM recognition_components c2 WHERE c2.source_id=c.source_id AND c2.schedule_id IS NOT NULL)
        THEN md5(source_id::text||effective_date::text||'accrual-report-v1')::uuid ELSE source_id END AS report_id,
      SUM(amount) AS amount,BOOL_OR(schedule_id IS NOT NULL) AS is_recognition FROM recognition_components c GROUP BY source_id,effective_date`,
    },
    {
      name: "transactions",
      query: `SELECT (jsonb_populate_record(NULL::public.transactions,to_jsonb(t)||jsonb_build_object(
      'id',p.report_id,'amount',p.amount,'transaction_date',p.effective_date,
      'linked_transaction_id',COALESCE(linked.report_id,t.linked_transaction_id),
      'parent_transaction_id',COALESCE(parent.report_id,t.parent_transaction_id)))).*,
      p.is_recognition,t.id AS source_transaction_id,t.transaction_date AS source_cash_date,t.amount AS source_amount,
      t.linked_transaction_id AS source_linked_id,t.parent_transaction_id AS source_parent_id
      FROM recognition_parents p JOIN public.transactions t ON t.id=p.source_id
      LEFT JOIN public.transactions linked_source ON linked_source.id=t.linked_transaction_id
      LEFT JOIN recognition_parents linked ON linked.source_id=linked_source.id AND linked.effective_date=linked_source.transaction_date
      LEFT JOIN public.transactions parent_source ON parent_source.id=t.parent_transaction_id
      LEFT JOIN recognition_parents parent ON parent.source_id=parent_source.id AND parent.effective_date=parent_source.transaction_date`,
    },
    {
      name: "transaction_splits",
      query: `SELECT (jsonb_populate_record(NULL::public.transaction_splits,to_jsonb(s)||jsonb_build_object(
      'id',CASE WHEN p.report_id=p.source_id THEN s.id ELSE md5(s.id::text||p.effective_date::text||'accrual-report-split-v1')::uuid END,
      'transaction_id',p.report_id,'amount',c.amount,
      'linked_transaction_id',COALESCE(linked.report_id,s.linked_transaction_id)))).*,s.id AS source_split_id,
      s.amount AS source_amount,c.schedule_id,c.cash_date AS source_cash_date,c.effective_date,
      s.linked_transaction_id AS source_linked_id
      FROM recognition_components c JOIN recognition_parents p ON p.source_id=c.source_id AND p.effective_date=c.effective_date
      JOIN public.transaction_splits s ON s.id=c.split_id AND s.transaction_id=p.source_id
      LEFT JOIN public.transactions linked_source ON linked_source.id=s.linked_transaction_id
      LEFT JOIN recognition_parents linked ON linked.source_id=linked_source.id AND linked.effective_date=linked_source.transaction_date`,
    },
    {
      name: "transaction_tags",
      query: `SELECT p.report_id AS transaction_id,l.tag_id FROM recognition_parents p
      JOIN public.transaction_tags l ON l.transaction_id=p.source_id`,
    },
    {
      name: "transaction_split_tags",
      query: `SELECT s.id AS transaction_split_id,l.tag_id FROM transaction_splits s
      JOIN public.transaction_split_tags l ON l.transaction_split_id=s.source_split_id`,
    },
    {
      name: "investment_transactions",
      query: `SELECT (jsonb_populate_record(NULL::public.investment_transactions,to_jsonb(i)||jsonb_build_object(
      'transaction_id',COALESCE(t.id,i.transaction_id),'transaction_split_id',COALESCE(s.id,i.transaction_split_id)))).*,
      i.transaction_id AS source_transaction_id,i.transaction_split_id AS source_transaction_split_id
      FROM public.investment_transactions i LEFT JOIN transactions t ON t.source_transaction_id=i.transaction_id
      LEFT JOIN transaction_splits s ON s.source_split_id=i.transaction_split_id WHERE i.user_id=${owner} OR t.id IS NOT NULL OR s.id IS NOT NULL`,
    },
  ];
}
