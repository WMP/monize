import type { EntityManager } from "typeorm";
import { matchReceipt } from "../matching/match-receipt";
import { loadReceiptCandidates } from "./receipt-candidates";
import { resolveMatchConfig } from "../parsing/receipt-match-config";

const USER = "11111111-1111-4111-8111-111111111111";
const CASH_ACCOUNT = "22222222-2222-4222-8222-222222222222";

/** A manager whose `query` is the only thing the loader calls. */
const managerWith = (rows: unknown[] = []) => {
  const query = jest.fn().mockResolvedValue(rows);
  return { m: { query } as unknown as EntityManager, query };
};

describe("loadReceiptCandidates: INVESTMENT_CASH accounts", () => {
  it("excludes an INVESTMENT_CASH account unless the profile lists it", async () => {
    const { m, query } = managerWith();
    await loadReceiptCandidates(m, USER, "2026-03-10", null);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain(
      "a.account_sub_type IS DISTINCT FROM 'INVESTMENT_CASH'",
    );
    expect(sql).toContain("a.id = ANY($6::uuid[])");
    expect(params[5]).toEqual([]);
  });

  it("passes the listed accounts as one parameter, never in the SQL text", async () => {
    const { m, query } = managerWith();
    const config = resolveMatchConfig({ includeAccountIds: [CASH_ACCOUNT] });
    await loadReceiptCandidates(m, USER, "2026-03-10", null, config, true);
    const [sql, params] = query.mock.calls[0];
    expect(params[5]).toEqual([CASH_ACCOUNT]);
    expect(sql).not.toContain(CASH_ACCOUNT);
  });

  it("leaves the user scope in place", async () => {
    const { m, query } = managerWith();
    await loadReceiptCandidates(m, USER, "2026-03-10", null);
    expect(query.mock.calls[0][0]).toContain("t.user_id = $1");
    expect(query.mock.calls[0][1][0]).toBe(USER);
  });

  it("an expense receipt does not match an income of the same amount (PPK contribution)", async () => {
    // What the loader would return for an INVESTMENT_CASH account listed by the profile.
    const { m } = managerWith([
      {
        id: "tx-ppk",
        transaction_date: "2026-03-10",
        amount: "249.0000",
        payee_id: null,
        payee_name: null,
        description: "Wplata pracodawcy PPK",
        reference_number: null,
      },
    ]);
    const config = resolveMatchConfig({ includeAccountIds: [CASH_ACCOUNT] });
    const candidates = await loadReceiptCandidates(
      m,
      USER,
      "2026-03-10",
      null,
      config,
    );
    const result = matchReceipt(
      { orderId: null, total: 2490000, paid: null },
      "2026-03-10",
      candidates,
      null,
      config,
    );
    expect(result.kind).toBe("unmatched");
  });

  it("an expense of 249,00 on a listed account is a candidate and matches", async () => {
    const { m } = managerWith([
      {
        id: "tx-expense",
        transaction_date: "2026-03-10",
        amount: "-249.0000",
        payee_id: null,
        payee_name: null,
        description: null,
        reference_number: null,
      },
    ]);
    const config = resolveMatchConfig({ includeAccountIds: [CASH_ACCOUNT] });
    const candidates = await loadReceiptCandidates(
      m,
      USER,
      "2026-03-10",
      null,
      config,
    );
    const result = matchReceipt(
      { orderId: null, total: 2490000, paid: null },
      "2026-03-10",
      candidates,
      null,
      config,
    );
    expect(result.kind).not.toBe("unmatched");
  });
});
