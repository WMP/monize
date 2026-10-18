import type { EntityManager } from "typeorm";
import {
  insertReceiptRows,
  normalizeMessageId,
  skippedRow,
  type ReceiptRow,
} from "./receipt-rows";

function row(messageId: string | null, uid: string): ReceiptRow {
  return {
    messageId,
    fromAddress: "orders@shop.example.com",
    fromDomain: "shop.example.com",
    subject: "Your order",
    receivedAt: new Date("2026-09-09T08:00:00Z"),
    bodyText: "Order total: 15.00",
    bodyHtml: null,
    forwardedBy: null,
    originalSentAt: null,
    uid,
    status: "pending",
    statusReason: null,
  };
}

describe("normalizeMessageId", () => {
  it("trims, keeps the case and turns an empty value into null", () => {
    expect(normalizeMessageId("  <Abc@Shop.Example.com> ")).toBe(
      "<Abc@Shop.Example.com>",
    );
    expect(normalizeMessageId("   ")).toBeNull();
    expect(normalizeMessageId("")).toBeNull();
    expect(normalizeMessageId(null)).toBeNull();
  });
});

describe("insertReceiptRows", () => {
  function managerReturning(results: Array<Array<{ id: string }>>) {
    const query = jest.fn();
    for (const result of results) query.mockResolvedValueOnce(result);
    return { query, manager: { query } as unknown as EntityManager };
  }

  it("counts a row refused by ON CONFLICT (IMAP key or Message-ID) as a duplicate", async () => {
    const { manager, query } = managerReturning([
      [{ id: "a" }],
      [], // the same Message-ID under another uid
      [{ id: "c" }],
    ]);
    const result = await insertReceiptRows(manager, "u", "m", "77", [
      row("<x@shop>", "1"),
      row("  <X@SHOP> ", "2"),
      skippedRow("3", "too_large", new Date("2026-09-09T08:00:00Z")),
    ]);
    expect(result).toEqual({ stored: 1, skipped: 1, duplicates: 1 });
    expect(String(query.mock.calls[0][0])).toContain("ON CONFLICT DO NOTHING");
    // the Message-ID is written trimmed, raw case kept
    expect(query.mock.calls[1][1][4]).toBe("<X@SHOP>");
  });
});
