import { BadRequestException } from "@nestjs/common";
import { LockScope } from "../common/db/locks";
import { providerTimeoutRequestIds, reopenRequests } from "./ai-review-reopen";
import { AI_REVIEW_REOPEN_MAX } from "./ai-review-retry";

const USER = "user-1";
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const TX_A = id(901);
const TX_B = id(902);
const EMAIL_A = id(801);
const EMAIL_B = id(802);

interface Req {
  id: string;
  kind: string;
  status: string;
  transaction_id: string | null;
  rule_id: string | null;
  email_receipt_id: string | null;
  attempts: number;
  needs_agent: boolean;
  last_error: string | null;
  proposal: unknown;
  close_reason: string | null;
}
interface Mail {
  id: string;
  ai_review_request_id: string | null;
  transaction_id: string | null;
  status: string;
}

const req = (n: number, over: Partial<Req> = {}): Req => ({
  id: id(n),
  kind: "email_receipt",
  status: "rejected",
  transaction_id: TX_A,
  rule_id: null,
  email_receipt_id: EMAIL_A,
  attempts: 5,
  needs_agent: true,
  last_error: "The AI provider did not answer.",
  proposal: { agentNote: { reason: "x" } },
  close_reason: "superseded",
  ...over,
});

/** A model of the two tables, answering the statements `reopenRequests` issues. */
function world(requests: Req[], mails: Mail[]) {
  const log: Array<{ sql: string; params: unknown[] }> = [];
  const query = jest.fn(async (rawSql: string, params: unknown[] = []) => {
    const sql = rawSql.replace(/\s+/g, " ").trim();
    log.push({ sql, params });
    if (sql.startsWith("SELECT pg_advisory_xact_lock")) return [];
    if (sql.startsWith("SELECT kind, transaction_id, email_receipt_id")) {
      const ids = params[0] as string[];
      return requests.filter((r) => ids.includes(r.id));
    }
    if (sql.startsWith("SELECT id FROM email_receipts WHERE id = ANY")) {
      return mails.filter((m) => (params[0] as string[]).includes(m.id));
    }
    if (sql.startsWith("SELECT id, kind, status, transaction_id")) {
      const ids = params[0] as string[];
      return requests
        .filter((r) => ids.includes(r.id))
        .sort((a, b) => a.id.localeCompare(b.id));
    }
    if (sql.includes("FROM email_receipts WHERE id = $1")) {
      const [emailId, , requestId, transactionId] = params as string[];
      return mails.filter(
        (m) =>
          m.id === emailId &&
          m.ai_review_request_id === requestId &&
          m.transaction_id === transactionId &&
          m.status === "review",
      );
    }
    if (sql.includes("IS NOT DISTINCT FROM")) {
      const [, transactionId, kind, ruleId, ownId] = params as Array<
        string | null
      >;
      return requests.filter(
        (r) =>
          r.transaction_id === transactionId &&
          r.kind === kind &&
          r.rule_id === ruleId &&
          r.id !== ownId &&
          ["pending", "claimed", "proposed"].includes(r.status),
      );
    }
    if (sql.startsWith("UPDATE ai_review_requests SET status = 'pending'")) {
      const row = requests.find((r) => r.id === params[0]);
      if (!row || !["rejected", "expired"].includes(row.status)) return [];
      Object.assign(row, {
        status: "pending",
        proposal: null,
        attempts: 0,
        last_error: null,
        needs_agent: false,
        close_reason: null,
      });
      return [{ id: row.id }];
    }
    throw new Error(`unexpected statement: ${sql}`);
  });
  return { manager: { query } as never, query, log, requests };
}

const mail = (over: Partial<Mail> = {}): Mail => ({
  id: EMAIL_A,
  ai_review_request_id: id(1),
  transaction_id: TX_A,
  status: "review",
  ...over,
});

describe("reopenRequests", () => {
  it("reopens a closed receipt request its email still stands behind, clearing claim, proposal and counters", async () => {
    const w = world([req(1)], [mail()]);
    const summary = await reopenRequests(w.manager, USER, [id(1)]);
    expect(summary).toEqual({
      results: [{ id: id(1), outcome: "reopened" }],
      reopened: 1,
    });
    expect(w.requests[0]).toMatchObject({
      status: "pending",
      proposal: null,
      attempts: 0,
      last_error: null,
      needs_agent: false,
      close_reason: null,
    });
    const update = w.log.find((l) => l.sql.startsWith("UPDATE"));
    // The claim is cleared, the life is fresh, and only a closed row matches.
    expect(update?.sql).toContain("claimed_by = NULL");
    expect(update?.sql).toContain("claimed_at = NULL");
    expect(update?.sql).toContain("last_attempt_at = NULL");
    expect(update?.sql).toContain(
      "expires_at = CURRENT_TIMESTAMP + make_interval(days => $3::int)",
    );
    expect(update?.sql).toContain("status IN ('rejected', 'expired')");
    expect(update?.params).toEqual([id(1), USER, 30]);
  });

  it("reopens an expired request too", async () => {
    const w = world(
      [req(1, { status: "expired", close_reason: null })],
      [mail()],
    );
    const summary = await reopenRequests(w.manager, USER, [id(1)]);
    expect(summary.results[0].outcome).toBe("reopened");
  });

  it("reopens a closed transaction_review request with no email involved", async () => {
    const w = world(
      [
        req(1, {
          kind: "transaction_review",
          rule_id: id(700),
          email_receipt_id: null,
        }),
      ],
      [],
    );
    const summary = await reopenRequests(w.manager, USER, [id(1)]);
    expect(summary.results[0].outcome).toBe("reopened");
    expect(
      w.log.some((l) => l.sql.includes("FROM email_receipts WHERE id = $1")),
    ).toBe(false);
  });

  it("reports an id that is absent (or another user's) as not_found, without a write", async () => {
    const w = world([], []);
    const summary = await reopenRequests(w.manager, USER, [id(1)]);
    expect(summary).toEqual({
      results: [{ id: id(1), outcome: "not_found" }],
      reopened: 0,
    });
    expect(w.log.some((l) => l.sql.startsWith("UPDATE"))).toBe(false);
  });

  it.each(["pending", "claimed", "proposed", "applied"])(
    "refuses a %s request as not_closed",
    async (status) => {
      const w = world([req(1, { status })], [mail()]);
      const summary = await reopenRequests(w.manager, USER, [id(1)]);
      expect(summary.results[0].outcome).toBe("not_closed");
      expect(w.requests[0].status).toBe(status);
    },
  );

  it.each(["email_trade", "email_parser_draft"])(
    "refuses a %s request as kind_not_reopenable",
    async (kind) => {
      const w = world([req(1, { kind, transaction_id: null })], [mail()]);
      const summary = await reopenRequests(w.manager, USER, [id(1)]);
      expect(summary.results[0].outcome).toBe("kind_not_reopenable");
      expect(w.requests[0].status).toBe("rejected");
    },
  );

  it.each([
    ["the email was deleted", [] as Mail[], {}],
    [
      "the email points at another request",
      [mail({ ai_review_request_id: id(2) })],
      {},
    ],
    [
      "the email moved to another transaction",
      [mail({ transaction_id: TX_B })],
      {},
    ],
    ["the email is ignored", [mail({ status: "ignored" })], {}],
    ["the email is skipped", [mail({ status: "skipped" })], {}],
    ["the request lost its email", [mail()], { email_receipt_id: null }],
  ])("refuses as superseded when %s", async (_name, mails, over) => {
    const w = world([req(1, over)], mails);
    const summary = await reopenRequests(w.manager, USER, [id(1)]);
    expect(summary.results[0].outcome).toBe("superseded");
    expect(w.requests[0].status).toBe("rejected");
  });

  it.each(["pending", "claimed", "proposed"])(
    "refuses as open_exists when another %s request has the same transaction, kind and rule",
    async (status) => {
      const w = world(
        [req(1), req(2, { status, email_receipt_id: EMAIL_B })],
        [mail()],
      );
      const summary = await reopenRequests(w.manager, USER, [id(1)]);
      expect(summary.results[0].outcome).toBe("open_exists");
      expect(w.requests[0].status).toBe("rejected");
    },
  );

  it("does not count another transaction, another kind or another rule as an open request", async () => {
    const w = world(
      [
        req(1, {
          kind: "transaction_review",
          rule_id: id(700),
          email_receipt_id: null,
        }),
        req(2, {
          status: "pending",
          transaction_id: TX_B,
          kind: "transaction_review",
          rule_id: id(700),
          email_receipt_id: null,
        }),
        req(3, {
          status: "pending",
          kind: "email_trade",
          transaction_id: TX_A,
          rule_id: id(700),
          email_receipt_id: null,
        }),
        req(4, {
          status: "pending",
          kind: "transaction_review",
          rule_id: id(701),
          email_receipt_id: null,
        }),
      ],
      [],
    );
    const summary = await reopenRequests(w.manager, USER, [id(1)]);
    expect(summary.results[0].outcome).toBe("reopened");
  });

  it("gives two closed requests of one transaction one reopening and one open_exists", async () => {
    const w = world(
      [req(1), req(2, { email_receipt_id: EMAIL_B })],
      [mail(), mail({ id: EMAIL_B, ai_review_request_id: id(2) })],
    );
    const summary = await reopenRequests(w.manager, USER, [id(2), id(1)]);
    // Ascending id order, whatever order the caller named them in.
    expect(summary.results).toEqual([
      { id: id(2), outcome: "open_exists" },
      { id: id(1), outcome: "reopened" },
    ]);
    expect(summary.reopened).toBe(1);
  });

  it("answers a repeated id once", async () => {
    const w = world([req(1)], [mail()]);
    const summary = await reopenRequests(w.manager, USER, [id(1), id(1)]);
    expect(summary.results).toEqual([{ id: id(1), outcome: "reopened" }]);
  });

  it("takes the email rows, then the transactions' advisory locks, then the request rows, each ascending", async () => {
    const w = world(
      [req(2, { transaction_id: TX_B, email_receipt_id: EMAIL_B }), req(1)],
      [
        mail(),
        mail({
          id: EMAIL_B,
          ai_review_request_id: id(2),
          transaction_id: TX_B,
        }),
      ],
    );
    await reopenRequests(w.manager, USER, [id(2), id(1)]);
    const order = w.log.map((l) => l.sql);
    const emailLock = order.findIndex((s) =>
      s.startsWith("SELECT id FROM email_receipts WHERE id = ANY"),
    );
    const advisory = order.findIndex((s) =>
      s.includes("pg_advisory_xact_lock"),
    );
    const requestLock = order.findIndex((s) =>
      s.startsWith("SELECT id, kind, status"),
    );
    expect(emailLock).toBeGreaterThanOrEqual(0);
    expect(advisory).toBeGreaterThan(emailLock);
    expect(requestLock).toBeGreaterThan(advisory);
    expect(w.log[emailLock].params[0]).toEqual([EMAIL_A, EMAIL_B]);
    const lockCalls = w.log.filter((l) =>
      l.sql.includes("pg_advisory_xact_lock"),
    );
    expect(lockCalls.map((l) => l.params)).toEqual([
      [LockScope.AiReviewRequests, TX_A],
      [LockScope.AiReviewRequests, TX_B],
    ]);
    expect(w.log[requestLock].sql).toMatch(/ORDER BY id FOR UPDATE$/);
  });

  it("issues nothing for an empty list", async () => {
    const w = world([], []);
    expect(await reopenRequests(w.manager, USER, [])).toEqual({
      results: [],
      reopened: 0,
    });
    expect(w.query).not.toHaveBeenCalled();
  });

  it("refuses more than the maximum before touching the database", async () => {
    const w = world([], []);
    const ids = Array.from({ length: AI_REVIEW_REOPEN_MAX + 1 }, (_, i) =>
      id(i + 1),
    );
    await expect(reopenRequests(w.manager, USER, ids)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(w.query).not.toHaveBeenCalled();
  });
});

describe("providerTimeoutRequestIds", () => {
  it("selects the user's closed receipt requests by last_error or the old agent note, newest first, capped", async () => {
    const query = jest.fn(async () => [{ id: id(1) }, { id: id(2) }]);
    const ids = await providerTimeoutRequestIds({ query } as never, USER);
    expect(ids).toEqual([id(1), id(2)]);
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("user_id = $1");
    expect(sql).toContain("kind = 'email_receipt'");
    expect(sql).toContain("status IN ('rejected', 'expired')");
    expect(sql).toContain("last_error = $2");
    expect(sql).toContain("proposal #>> '{agentNote,reason}' = $2");
    expect(sql).toContain("ORDER BY created_at DESC");
    expect(params).toEqual([USER, "The AI provider did not answer.", 500]);
  });
});
