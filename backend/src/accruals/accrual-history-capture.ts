import type { EntityManager } from "typeorm";
import type { StoredAccrual } from "./accrual-store";
import type { AccrualHistoryState } from "./accrual-history-snapshot";
import { requireAccrualOwner } from "./accrual-source";
import { accrualErrors } from "./accrual-errors";

type Snapshot = Record<string, unknown>;

/** Compact settings only; single-source and batch history share this projection. */
export async function readAccrualHistoryStates(
  m: EntityManager,
  userId: string,
  ids: readonly string[],
): Promise<Map<string, AccrualHistoryState>> {
  const selected = [...new Set(ids)].sort();
  const states = new Map<string, AccrualHistoryState>(
    selected.map((id) => [id, { version: 1, schedules: [] }]),
  );
  if (!selected.length) return states;
  const schedules: StoredAccrual[] = await m.query(
    `SELECT id,source_transaction_id AS "sourceTransactionId",source_split_id AS "sourceSplitId",
      family,currency_code AS "currencyCode",preset,TO_CHAR(start_month,'YYYY-MM') AS "startMonth",
      month_count AS "monthCount",revision,source_fingerprint AS "sourceFingerprint",
      recognition_date_rule AS "recognitionDateRule"
     FROM accrual_schedules WHERE user_id=$1 AND source_transaction_id=ANY($2::uuid[]) ORDER BY source_transaction_id,id`,
    [userId, selected],
  );
  for (const schedule of schedules)
    states.get(schedule.sourceTransactionId)!.schedules.push(schedule);
  return states;
}

/** Caller locks the source set. Three set-based reads retain exact source/split values. */
export async function captureAccrualHistorySnapshots(
  m: EntityManager,
  userId: string,
  ids: readonly string[],
  force = false,
): Promise<Map<string, Snapshot>> {
  const states = await readAccrualHistoryStates(m, userId, ids);
  const selected = [...states]
    .filter(([, state]) => force || state.schedules.length)
    .map(([id]) => id);
  const result = new Map<string, Snapshot>();
  if (!selected.length) return result;
  requireAccrualOwner(userId);
  const sources: Snapshot[] = await m.query(
    `SELECT t.id,t.account_id AS "accountId",TO_CHAR(t.transaction_date,'YYYY-MM-DD') AS "transactionDate",
      t.amount::text AS amount,t.currency_code AS "currencyCode",t.exchange_rate::text AS "exchangeRate",
      t.original_amount::text AS "originalAmount",t.original_currency_code AS "originalCurrencyCode",
      t.payee_id AS "payeeId",t.payee_name AS "payeeName",t.category_id AS "categoryId",
      t.description,t.reference_number AS "referenceNumber",t.status,t.is_split AS "isSplit",
      t.is_transfer AS "isTransfer",t.linked_transaction_id AS "linkedTransactionId",
      t.parent_transaction_id AS "parentTransactionId",t.reconciled_date AS "reconciledDate",
      t.created_at AS "createdAt",ARRAY(SELECT tt.tag_id FROM transaction_tags tt WHERE tt.transaction_id=t.id ORDER BY tt.tag_id) AS "tagIds"
     FROM transactions t WHERE t.id=ANY($1::uuid[]) AND t.user_id=$2 ORDER BY t.id`,
    [selected, userId],
  );
  if (sources.length !== selected.length) throw accrualErrors.conflict();
  const splits: (Snapshot & { __transactionId: string })[] = await m.query(
    `SELECT s.transaction_id AS "__transactionId",s.id,s.kind,s.category_id AS "categoryId",s.transfer_account_id AS "transferAccountId",
      s.linked_transaction_id AS "linkedTransactionId",s.amount::text AS amount,s.memo,
      ARRAY(SELECT st.tag_id FROM transaction_split_tags st WHERE st.transaction_split_id=s.id ORDER BY st.tag_id) AS "tagIds"
     FROM transaction_splits s JOIN transactions t ON t.id=s.transaction_id
     WHERE t.id=ANY($1::uuid[]) AND t.user_id=$2 ORDER BY t.id,s.id`,
    [selected, userId],
  );
  const bySource = new Map<string, Snapshot[]>();
  for (const { __transactionId, ...split } of splits) {
    const group = bySource.get(__transactionId) ?? [];
    group.push(split);
    bySource.set(__transactionId, group);
  }
  for (const source of sources) {
    const id = String(source.id);
    result.set(id, {
      accrualState: states.get(id),
      ...source,
      splits: bySource.get(id) ?? [],
      accrualExact: true,
    });
  }
  return result;
}
