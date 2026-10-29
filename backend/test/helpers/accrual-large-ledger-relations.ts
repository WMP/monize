import type { EntityManager } from "typeorm";
import { createTestAccount } from "./test-factories";

/** Synthetic relationship shapes omitted by the original volume-only fixture. */
export async function seedAccrualLedgerRelations(
  m: EntityManager,
  userId: string,
  backgroundId: string,
) {
  const other = await createTestAccount(m.connection, userId, {
    name: "Synthetic transfer destination",
  });
  const investments = await createTestAccount(m.connection, userId, {
    name: "Synthetic investments",
    accountType: "INVESTMENT",
  });
  // Reuse seeded rows so total volume stays comparable. Each pair has equal
  // and opposite legs in different accounts, with reciprocal links.
  await m.query(
    `UPDATE transactions t SET is_transfer=true, category_id=NULL,
       account_id=CASE WHEN g<=3000 THEN $2::uuid ELSE $3::uuid END,
       amount=CASE WHEN g<=3000 THEN -10 ELSE 10 END,
       linked_transaction_id=other.id
     FROM generate_series(1,6000) g JOIN transactions other
       ON other.user_id=$1 AND other.description='Background '||(5141+CASE WHEN g<=3000 THEN g+3000 ELSE g-3000 END)
     WHERE t.user_id=$1 AND t.description='Background '||(5141+g)`,
    [userId, backgroundId, other.id],
  );
  // Mixed split parents with an embedded investment and an ordinary category
  // component exercise the investment-linked anti join in real analytics.
  await m.query(
    `WITH chosen AS (
       SELECT DISTINCT ON (s.transaction_id) s.id,t.id AS source_id,t.transaction_date
       FROM transaction_splits s JOIN transactions t ON t.id=s.transaction_id
       WHERE t.user_id=$1 AND t.account_id=$2 ORDER BY s.transaction_id,s.id LIMIT 2250
     ), marked AS (
       UPDATE transaction_splits s SET kind='investment',category_id=NULL,amount=5
       FROM chosen c WHERE s.id=c.id RETURNING s.id
     ) INSERT INTO investment_transactions(user_id,account_id,transaction_split_id,action,transaction_date,quantity,price,commission,total_amount)
       SELECT $1,$3,c.id,'INTEREST',c.transaction_date,0,0,0,5 FROM chosen c JOIN marked s ON s.id=c.id`,
    [userId, backgroundId, investments.id],
  );
  await m.query(
    `UPDATE transactions t SET amount=(SELECT SUM(s.amount) FROM transaction_splits s WHERE s.transaction_id=t.id)
     WHERE t.user_id=$1 AND EXISTS(SELECT 1 FROM transaction_splits s WHERE s.transaction_id=t.id AND s.kind='investment')`,
    [userId],
  );
  await m.query(
    `INSERT INTO investment_transactions(user_id,account_id,transaction_id,action,transaction_date,quantity,price,commission,total_amount)
     SELECT $1,$3,t.id,'INTEREST',t.transaction_date,0,0,0,10 FROM transactions t
     WHERE t.user_id=$1 AND t.account_id=$2 AND NOT t.is_split AND NOT t.is_transfer
     ORDER BY t.id LIMIT 2250`,
    [userId, backgroundId, investments.id],
  );
  await m.query(
    `UPDATE transactions t SET amount=10,category_id=NULL WHERE t.user_id=$1 AND EXISTS(
      SELECT 1 FROM investment_transactions i WHERE i.transaction_id=t.id AND i.action='INTEREST')`,
    [userId],
  );
  // Transfer children of split parents must remain excluded from ordinary
  // spending; the parent pointer is a hot predicate, not a display-only field.
  await m.query(
    `WITH parents AS (
       SELECT s.id AS split_id,t.id FROM transaction_splits s JOIN transactions t ON t.id=s.transaction_id
       WHERE t.user_id=$1 AND t.account_id=$2 AND t.is_split AND s.kind='category' AND s.amount=-5
       ORDER BY t.id,s.id LIMIT 500
     ), legs AS (
       SELECT p.id AS parent_id,p.split_id,gen_random_uuid() AS outgoing,gen_random_uuid() AS incoming FROM parents p
     ) INSERT INTO transactions(id,user_id,account_id,transaction_date,amount,currency_code,is_transfer,parent_transaction_id,linked_transaction_id,description)
       SELECT outgoing,$1,$2,DATE '2025-06-15',-5,'USD',true,parent_id,incoming,'Synthetic split transfer '||split_id FROM legs
       UNION ALL SELECT incoming,$1,$3,DATE '2025-06-15',5,'USD',true,NULL,outgoing,'Synthetic split transfer '||split_id FROM legs`,
    [userId, backgroundId, other.id],
  );
  await m.query(
    `UPDATE transaction_splits s SET kind='transfer',category_id=NULL,transfer_account_id=$2,linked_transaction_id=t.linked_transaction_id
     FROM transactions t WHERE t.user_id=$1 AND t.parent_transaction_id=s.transaction_id
       AND t.description='Synthetic split transfer '||s.id`,
    [userId, other.id],
  );
  await m.query("ANALYZE transactions");
  await m.query("ANALYZE transaction_splits");
  await m.query("ANALYZE investment_transactions");
}
