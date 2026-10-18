import {
  closeReceiptRequests,
  closeRequestsOfReceipts,
} from "./receipt-requests.util";

const USER = "user-1";
const RECEIPT = "40000000-0000-4000-8000-000000000001";
const OTHER = "40000000-0000-4000-8000-000000000002";

const manager = () => ({ query: jest.fn(async () => []) });

describe("closeReceiptRequests", () => {
  it("closes the receipt's open requests with the reason it is given, and removes the agent's note", async () => {
    const m = manager();
    await closeReceiptRequests(m as never, USER, RECEIPT, "receipt_ignored");
    const [sql, params] = m.query.mock.calls[0] as unknown as [
      string,
      unknown[],
    ];
    expect(sql).toContain("status = 'rejected'");
    expect(sql).toContain("close_reason = $3");
    // The note described a past attempt, not the close; nothing else in
    // `proposal` is touched, and a proposal that was only the note becomes NULL.
    expect(sql).toContain(
      "proposal = NULLIF(proposal - 'agentNote', '{}'::jsonb)",
    );
    expect(sql).toContain("status IN ('pending', 'claimed', 'proposed')");
    expect(sql).toContain("user_id = $1");
    expect(params).toEqual([USER, RECEIPT, "receipt_ignored"]);
  });

  it.each(["superseded", "receipt_ignored", "receipt_deleted"] as const)(
    "passes %s through unchanged",
    async (reason) => {
      const m = manager();
      await closeReceiptRequests(m as never, USER, RECEIPT, reason);
      expect((m.query.mock.calls[0] as unknown[])[1]).toEqual([
        USER,
        RECEIPT,
        reason,
      ]);
    },
  );
});

describe("closeRequestsOfReceipts", () => {
  it("closes many receipts' open requests in one statement with the same reason and the same note removal", async () => {
    const m = manager();
    await closeRequestsOfReceipts(
      m as never,
      USER,
      [RECEIPT, OTHER],
      "receipt_deleted",
    );
    expect(m.query).toHaveBeenCalledTimes(1);
    const [sql, params] = m.query.mock.calls[0] as unknown as [
      string,
      unknown[],
    ];
    expect(sql).toContain("email_receipt_id = ANY($2::uuid[])");
    expect(sql).toContain("close_reason = $3");
    expect(sql).toContain(
      "proposal = NULLIF(proposal - 'agentNote', '{}'::jsonb)",
    );
    expect(params).toEqual([USER, [RECEIPT, OTHER], "receipt_deleted"]);
  });

  it("writes nothing for no receipts", async () => {
    const m = manager();
    await closeRequestsOfReceipts(m as never, USER, [], "receipt_ignored");
    expect(m.query).not.toHaveBeenCalled();
  });
});
