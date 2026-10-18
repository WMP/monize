import * as fs from "fs";
import * as path from "path";
import { DataSource } from "typeorm";

import {
  insertReceiptRows,
  type ReceiptRow,
} from "@/email-receipts/poll/receipt-rows";

import {
  INTEGRATION_TYPEORM_OPTIONS,
  createTestUserDirect,
} from "../helpers/integration-setup";

/**
 * The Message-ID identity of a stored email
 * (docs/future-plans/ai-review-retry.md, decision 7), on the schema production
 * has: `schema.sql` in a scratch database (entity-built schemas carry neither
 * the partial expression index nor the CHECKs), and the migration file run on
 * copies seeded the way the old key let them in.
 */
describe("email receipt Message-ID identity", () => {
  const SCRATCH_DB = "monize_email_receipts_message_id_test";
  const ROOT = path.join(__dirname, "../../..");
  const MIGRATION = path.join(
    ROOT,
    "database/migrations/20261018210000_email_receipt_message_id_unique.sql",
  );
  const INDEX = "uq_email_receipts_user_message_id";

  let admin: DataSource;
  let db: DataSource;
  let userId: string;
  let otherUserId: string;
  let mailboxId: string;
  let otherMailboxId: string;
  let accountId: string;
  let uidSeq = 0;

  const connect = async (database: string): Promise<DataSource> => {
    const ds = new DataSource({
      ...INTEGRATION_TYPEORM_OPTIONS,
      database,
      synchronize: false,
      dropSchema: false,
    } as never);
    await ds.initialize();
    return ds;
  };

  const runMigration = () => db.query(fs.readFileSync(MIGRATION, "utf8"));

  const transaction = async (): Promise<string> => {
    const [tx] = await db.query(
      `INSERT INTO transactions (user_id, account_id, transaction_date, amount, currency_code, status)
       VALUES ($1, $2, '2026-03-10', -50, 'USD', 'UNRECONCILED') RETURNING id`,
      [userId, accountId],
    );
    return tx.id;
  };

  const copy = async (
    messageId: string | null,
    createdAt: string,
    over: { transactionId?: string; user?: string } = {},
  ): Promise<string> => {
    const user = over.user ?? userId;
    const [row] = await db.query(
      `INSERT INTO email_receipts
         (user_id, mailbox_id, uid_validity, uid, message_id, from_address,
          from_domain, subject, received_at, body_text, transaction_id,
          status, created_at)
       VALUES ($1, $2, 5, $3, $4, 'a@shop.example.com', 'shop.example.com', 's',
               now(), 't', $5, $6, $7) RETURNING id`,
      [
        user,
        user === userId ? mailboxId : otherMailboxId,
        ++uidSeq,
        messageId,
        over.transactionId ?? null,
        over.transactionId ? "review" : "unmatched",
        createdAt,
      ],
    );
    return row.id;
  };

  const request = async (receiptId: string, status: string) => {
    const [row] = await db.query(
      `INSERT INTO ai_review_requests
         (user_id, transaction_id, kind, instruction, email_receipt_id, status, proposal)
       VALUES ($1, $2, 'email_receipt', 'x', $3, $4,
               '{"agentNote":{"reason":"n"}}'::jsonb) RETURNING id`,
      [userId, await transaction(), receiptId, status],
    );
    return row.id as string;
  };

  const receiptRow = async (id: string) =>
    (
      await db.query(
        `SELECT message_id, status, status_reason FROM email_receipts WHERE id = $1`,
        [id],
      )
    )[0];

  const requestRow = async (id: string) =>
    (
      await db.query(
        `SELECT status, close_reason, proposal FROM ai_review_requests WHERE id = $1`,
        [id],
      )
    )[0];

  beforeAll(async () => {
    admin = await connect(
      (INTEGRATION_TYPEORM_OPTIONS as { database: string }).database,
    );
    await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`);
    await admin.query(`CREATE DATABASE ${SCRATCH_DB}`);
    db = await connect(SCRATCH_DB);
    await db.query(
      fs.readFileSync(path.join(ROOT, "database/schema.sql"), "utf8"),
    );

    userId = (await createTestUserDirect(db, { firstName: "A" })).id;
    otherUserId = (await createTestUserDirect(db, { firstName: "B" })).id;
    await db.query(
      `INSERT INTO currencies (code, name, symbol, decimal_places) VALUES ('USD', 'US Dollar', '$', 2) ON CONFLICT DO NOTHING`,
    );
    [{ id: accountId }] = await db.query(
      `INSERT INTO accounts (user_id, account_type, name, currency_code)
       VALUES ($1, 'CHEQUING', 'Checking', 'USD') RETURNING id`,
      [userId],
    );
    for (const [user, set] of [
      [userId, (id: string) => (mailboxId = id)],
      [otherUserId, (id: string) => (otherMailboxId = id)],
    ] as const) {
      const [m] = await db.query(
        `INSERT INTO email_receipt_mailboxes (user_id, host, username, password_enc)
         VALUES ($1, 'imap.example.com', 'r@example.com', 'cipher') RETURNING id`,
        [user],
      );
      set(m.id);
    }
  });

  afterAll(async () => {
    await db?.destroy();
    await admin?.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`);
    await admin?.destroy();
  });

  beforeEach(async () => {
    await db.query(`DROP INDEX IF EXISTS ${INDEX}`);
    await db.query(`TRUNCATE email_receipts, ai_review_requests CASCADE`);
  });

  describe("the migration over existing copies", () => {
    it("keeps the copy that holds something, ignores an empty copy and closes its request", async () => {
      const holder = await copy("<Dup@Shop>", "2026-02-02", {
        transactionId: await transaction(),
      });
      // older than the holder, but it holds nothing
      const empty = await copy("  <dup@shop> ", "2026-01-01");
      const emptyRequest = await request(empty, "pending");
      const other = await copy("<dup@shop>", "2026-01-01", {
        user: otherUserId,
      });

      await runMigration();

      expect(await receiptRow(holder)).toMatchObject({
        message_id: "<Dup@Shop>",
        status: "review",
      });
      expect(await receiptRow(empty)).toEqual({
        message_id: null,
        status: "ignored",
        status_reason: "duplicate",
      });
      expect(await requestRow(emptyRequest)).toEqual({
        status: "rejected",
        close_reason: "duplicate",
        proposal: null,
      });
      expect((await receiptRow(other)).message_id).toBe("<dup@shop>");
    });

    it("keeps the oldest of two holders and only clears the other one's message_id", async () => {
      const newer = await copy("<h@shop>", "2026-02-02", {
        transactionId: await transaction(),
      });
      const older = await copy("<h@shop>", "2026-01-01", {
        transactionId: await transaction(),
      });
      const openRequest = await request(newer, "pending");

      await runMigration();

      expect((await receiptRow(older)).message_id).toBe("<h@shop>");
      expect(await receiptRow(newer)).toEqual({
        message_id: null,
        status: "review",
        status_reason: null,
      });
      // it holds something: its request is not touched
      expect((await requestRow(openRequest)).status).toBe("pending");
    });

    it("treats a link row and an applied request as holding something", async () => {
      const settlement = await copy("<l@shop>", "2026-02-02");
      const linked = await copy("<l@shop>", "2026-03-03");
      await db.query(
        `INSERT INTO email_receipt_links (user_id, settlement_receipt_id, component_receipt_id, part_amount)
         VALUES ($1, $2, $3, 1)`,
        [userId, settlement, linked],
      );
      const applied = await copy("<a@shop>", "2026-03-03");
      const oldEmpty = await copy("<a@shop>", "2026-01-01");
      await request(applied, "applied");

      await runMigration();

      // both of the first pair hold (settlement and component): oldest stays
      expect((await receiptRow(settlement)).message_id).toBe("<l@shop>");
      expect((await receiptRow(linked)).status).not.toBe("ignored");
      expect((await receiptRow(applied)).message_id).toBe("<a@shop>");
      expect((await receiptRow(oldEmpty)).status).toBe("ignored");
    });

    it("keeps the oldest of empty copies, creates the index and is a no-op the second time", async () => {
      const oldest = await copy("<e@shop>", "2026-01-01");
      const newest = await copy("<e@shop>", "2026-03-03");
      await copy(null, "2026-01-01");
      await copy("   ", "2026-01-01");
      await copy("   ", "2026-01-02");

      await runMigration();
      const afterFirst = await db.query(
        `SELECT id, message_id, status FROM email_receipts ORDER BY id`,
      );
      await runMigration();
      const afterSecond = await db.query(
        `SELECT id, message_id, status FROM email_receipts ORDER BY id`,
      );

      expect(afterSecond).toEqual(afterFirst);
      expect((await receiptRow(oldest)).message_id).toBe("<e@shop>");
      expect(await receiptRow(newest)).toMatchObject({
        message_id: null,
        status: "ignored",
      });
      const [{ count }] = await db.query(
        `SELECT count(*)::int AS count FROM pg_indexes WHERE indexname = $1`,
        [INDEX],
      );
      expect(count).toBe(1);
    });
  });

  describe("the insert", () => {
    const row = (messageId: string | null, uid: string): ReceiptRow => ({
      messageId,
      fromAddress: "a@shop.example.com",
      fromDomain: "shop.example.com",
      subject: "s",
      receivedAt: new Date("2026-03-03T10:00:00Z"),
      bodyText: "t",
      bodyHtml: null,
      forwardedBy: null,
      originalSentAt: null,
      uid,
      status: "pending",
      statusReason: null,
    });

    it("skips the same Message-ID under another uid, and stores it for another user", async () => {
      await runMigration();
      const first = await insertReceiptRows(
        db.manager,
        userId,
        mailboxId,
        "5",
        [row("<m@shop>", "1")],
      );
      const second = await insertReceiptRows(
        db.manager,
        userId,
        mailboxId,
        "6",
        [row(" <M@SHOP> ", "1"), row(null, "2"), row(null, "3")],
      );
      const imported = await insertReceiptRows(
        db.manager,
        userId,
        mailboxId,
        "0",
        [row("<m@shop>", "99")],
      );
      const otherUser = await insertReceiptRows(
        db.manager,
        otherUserId,
        otherMailboxId,
        "5",
        [row("<m@shop>", "1")],
      );

      expect(first).toEqual({ stored: 1, skipped: 0, duplicates: 0 });
      expect(second).toEqual({ stored: 2, skipped: 0, duplicates: 1 });
      expect(imported).toEqual({ stored: 0, skipped: 0, duplicates: 1 });
      expect(otherUser).toEqual({ stored: 1, skipped: 0, duplicates: 0 });
      const [{ count }] = await db.query(
        `SELECT count(*)::int AS count FROM email_receipts WHERE user_id = $1 AND message_id IS NOT NULL`,
        [userId],
      );
      expect(count).toBe(1);
    });

    it("stores a known Message-ID from another sender (it cannot hide the real email)", async () => {
      await runMigration();
      await insertReceiptRows(db.manager, userId, mailboxId, "5", [
        row("<s@shop>", "1"),
      ]);
      const forged = await insertReceiptRows(
        db.manager,
        userId,
        mailboxId,
        "5",
        [{ ...row("<s@shop>", "2"), fromAddress: "x@elsewhere.example" }],
      );
      expect(forged).toEqual({ stored: 1, skipped: 0, duplicates: 0 });
    });

    it("still skips the same IMAP key", async () => {
      await runMigration();
      await insertReceiptRows(db.manager, userId, mailboxId, "5", [
        row("<k@shop>", "1"),
      ]);
      const again = await insertReceiptRows(
        db.manager,
        userId,
        mailboxId,
        "5",
        [row("<other@shop>", "1")],
      );
      expect(again.duplicates).toBe(1);
    });
  });
});
