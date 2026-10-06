import { ConflictException, NotFoundException } from "@nestjs/common";
import { createScopedDbMocks } from "../../test-helpers/scoped-db-testing";
import { MAX_PARSE_LINES } from "../parsing/receipt-parser.types";
import { EmailReceipt } from "../entities/email-receipt.entity";
import type { EmailReceiptPipelineService } from "../pipeline/email-receipt-pipeline.service";
import {
  deriveDisplayState,
  EMAIL_RECEIPTS_BATCH_AI_CATEGORY_CALLS,
  EMAIL_RECEIPTS_MAX_DOMAINS,
  EmailReceiptsService,
} from "./email-receipts.service";

jest.mock("../../common/db/scoped-db", () =>
  jest
    .requireActual("../../test-helpers/scoped-db-testing")
    .scopedDbMockModule(),
);

const USER = "user-1";
const ID = "receipt-1";

const row = (over: Record<string, unknown> = {}) => ({
  id: ID,
  from_address: "orders@shop.example.com",
  from_domain: "shop.example.com",
  subject: "Your order",
  received_at: new Date("2026-09-10T10:00:00Z"),
  forwarded_by: null,
  original_sent_at: null,
  created_at: new Date("2026-09-10T10:05:00Z"),
  status: "review",
  status_reason: null,
  match_kind: "order_id",
  parser_id: "p1",
  parser_name: "Shop",
  ai_review_request_id: "rq1",
  request_status: "proposed",
  request_expired: false,
  request_note: null,
  transaction_id: "t1",
  tx_date: "2026-09-11",
  tx_amount: "-37.9700",
  tx_currency: "USD",
  tx_payee: "Shop",
  ...over,
});

function setup() {
  const receiptRepo = {
    findOne: jest.fn(),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const { manager, dataSource } = createScopedDbMocks([
    [EmailReceipt, receiptRepo],
  ]);
  const pipeline = {
    process: jest.fn(),
  } as unknown as jest.Mocked<EmailReceiptPipelineService>;
  const service = new EmailReceiptsService(dataSource as never, pipeline);
  return { service, manager, receiptRepo, pipeline };
}

const locked = (over: Partial<EmailReceipt> = {}) =>
  Object.assign(new EmailReceipt(), {
    id: ID,
    userId: USER,
    status: "review",
    transactionId: "t1",
    aiReviewRequestId: "rq1",
    ...over,
  });

describe("deriveDisplayState", () => {
  it.each([
    ["proposed", false, "proposed"],
    ["proposed", true, "expired"],
    ["applied", false, "applied"],
    ["rejected", false, "dismissed"],
    ["expired", false, "expired"],
    ["pending", false, "pending_ai"],
    ["claimed", false, "pending_ai"],
    ["pending", true, "expired"],
  ])("a %s request (expired %s) is %s", (status, expired, expected) => {
    expect(deriveDisplayState("review", { status, expired })).toBe(expected);
  });

  it("a review receipt with no request row is request_missing", () => {
    expect(deriveDisplayState("review", null)).toBe("request_missing");
  });

  it.each([
    "pending",
    "skipped",
    "no_parser",
    "parse_failed",
    "unmatched",
    "ambiguous",
    "review_conflict",
    "ignored",
  ] as const)("a %s receipt shows no request state", (status) => {
    expect(
      deriveDisplayState(status, { status: "proposed", expired: false }),
    ).toBeNull();
  });
});

describe("EmailReceiptsService.list", () => {
  it("lists newest first without the text, deriving the state and the transaction", async () => {
    const { service, manager } = setup();
    manager.query.mockResolvedValue([
      row(),
      row({
        id: "receipt-2",
        status: "unmatched",
        request_status: null,
        ai_review_request_id: null,
        transaction_id: null,
        tx_date: null,
        tx_amount: null,
        tx_currency: null,
        tx_payee: null,
        received_at: "2026-09-09T10:00:00.000Z",
      }),
    ]);

    const items = await service.list(USER, { status: "review", limit: 20 });

    const [sql, params] = manager.query.mock.calls[0];
    // The day the shop sent the order (the list's effectiveDate) orders the list.
    expect(sql).toContain(
      "ORDER BY COALESCE(r.original_sent_at, r.received_at) DESC, r.id DESC",
    );
    expect(sql).not.toContain("body_text");
    expect(params).toEqual([USER, "review", null, null, 20]);
    expect(items[0]).toEqual({
      id: ID,
      fromAddress: "orders@shop.example.com",
      fromDomain: "shop.example.com",
      subject: "Your order",
      receivedAt: "2026-09-10T10:00:00.000Z",
      forwardedBy: null,
      originalSentAt: null,
      effectiveDate: "2026-09-10T10:00:00.000Z",
      status: "review",
      statusReason: null,
      matchKind: "order_id",
      parserId: "p1",
      parserName: "Shop",
      aiReviewRequestId: "rq1",
      displayState: "proposed",
      requestNote: null,
      transaction: {
        id: "t1",
        date: "2026-09-11",
        amount: -37.97,
        currencyCode: "USD",
        payeeName: "Shop",
      },
      createdAt: "2026-09-10T10:05:00.000Z",
    });
    expect(items[1]).toMatchObject({
      displayState: null,
      transaction: null,
      receivedAt: "2026-09-09T10:00:00.000Z",
    });
    expect(Object.keys(items[0])).not.toContain("bodyText");
    expect(Object.keys(items[0])).not.toContain("bodyHtml");
  });

  describe("the sender domain filter", () => {
    it("matches the domain exactly or as a sub-domain, with parameters only, scoped to the user", async () => {
      const { service, manager } = setup();
      manager.query.mockResolvedValue([]);
      await service.list(USER, { domain: "shop.example.com" });
      const [sql, params] = manager.query.mock.calls[0];
      expect(sql).toContain("r.user_id = $1");
      expect(sql).toContain("r.from_domain = $3::varchar");
      expect(sql).toContain("r.from_domain LIKE $4::varchar ESCAPE '\\'");
      expect(sql).not.toContain("shop.example.com");
      expect(params).toEqual([
        USER,
        null,
        "shop.example.com",
        "%.shop.example.com",
        50,
      ]);
    });

    it("escapes % _ and backslash in the domain before it becomes a LIKE pattern", async () => {
      const { service, manager } = setup();
      manager.query.mockResolvedValue([]);
      await service.list(USER, { domain: "a%b_c\\d.example.com" });
      const params = manager.query.mock.calls[0][1];
      expect(params[2]).toBe("a%b_c\\d.example.com");
      expect(params[3]).toBe("%.a\\%b\\_c\\\\d.example.com");
    });

    it("lower-cases and trims it, and an empty value is no filter", async () => {
      const { service, manager } = setup();
      manager.query.mockResolvedValue([]);
      await service.list(USER, { domain: "  Shop.Example.COM " });
      expect(manager.query.mock.calls[0][1][2]).toBe("shop.example.com");
      await service.list(USER, { domain: "   " });
      expect(manager.query.mock.calls[1][1].slice(1, 4)).toEqual([
        null,
        null,
        null,
      ]);
    });

    it("combines with the status filter and the limit in one query", async () => {
      const { service, manager } = setup();
      manager.query.mockResolvedValue([]);
      await service.list(USER, {
        status: "no_parser",
        domain: "shop.example.com",
        limit: 7,
      });
      expect(manager.query).toHaveBeenCalledTimes(1);
      const [sql, params] = manager.query.mock.calls[0];
      expect(sql).toContain("r.status = $2::varchar");
      expect(params).toEqual([
        USER,
        "no_parser",
        "shop.example.com",
        "%.shop.example.com",
        7,
      ]);
    });
  });

  it("never selects the HTML part for the list", async () => {
    const { service, manager } = setup();
    manager.query.mockResolvedValue([]);
    await service.list(USER);
    expect(manager.query.mock.calls[0][0]).not.toContain("body_html");
  });

  it("says who forwarded an email and dates it by the shop's day, not the forward's", async () => {
    const { service, manager } = setup();
    manager.query.mockResolvedValue([
      row({
        forwarded_by: "alice.example@gmail.example.com",
        original_sent_at: new Date("2026-08-10T08:15:00Z"),
        received_at: new Date("2026-09-10T10:00:00Z"),
      }),
    ]);

    const [item] = await service.list(USER);

    expect(item).toMatchObject({
      forwardedBy: "alice.example@gmail.example.com",
      originalSentAt: "2026-08-10T08:15:00.000Z",
      receivedAt: "2026-09-10T10:00:00.000Z",
      effectiveDate: "2026-08-10T08:15:00.000Z",
    });
  });

  it("scopes by the JWT user only and clamps the limit", async () => {
    const { service, manager } = setup();
    manager.query.mockResolvedValue([]);
    await service.list(USER);
    expect(manager.query.mock.calls[0][1]).toEqual([
      USER,
      null,
      null,
      null,
      50,
    ]);
    await service.list(USER, { limit: 9999 });
    expect(manager.query.mock.calls[1][1][4]).toBe(200);
    await service.list(USER, { limit: 0 });
    expect(manager.query.mock.calls[2][1][4]).toBe(1);
  });

  it("carries why a request was closed", async () => {
    const { service, manager } = setup();
    manager.query.mockResolvedValue([
      row({ request_status: "rejected", request_note: "lines do not add up" }),
    ]);
    const [item] = await service.list(USER);
    expect(item).toMatchObject({
      displayState: "dismissed",
      requestNote: "lines do not add up",
    });
  });
});

describe("EmailReceiptsService.listDomains", () => {
  it("lists the user's sender domains with counts, most first then by name, at most 200", async () => {
    const { service, manager } = setup();
    manager.query.mockResolvedValue([
      { domain: "a.example.com", count: "5", processable: "3" },
      { domain: "b.example.com", count: 2, processable: 0 },
    ]);
    await expect(service.listDomains(USER)).resolves.toEqual([
      { domain: "a.example.com", count: 5, processable: 3 },
      { domain: "b.example.com", count: 2, processable: 0 },
    ]);
    const [sql, params] = manager.query.mock.calls[0];
    expect(sql).toContain("GROUP BY r.from_domain");
    expect(sql).toContain("ORDER BY count DESC, r.from_domain ASC");
    expect(sql).toContain("r.user_id = $1");
    // `processable` counts the six statuses "process in bulk" can act on again.
    expect(sql).toContain(
      "COUNT(*) FILTER (WHERE r.status = ANY($3::varchar[]))",
    );
    expect(params).toEqual([
      USER,
      200,
      [
        "pending",
        "no_parser",
        "parse_failed",
        "unmatched",
        "ambiguous",
        "review_conflict",
      ],
      null,
    ]);
    expect(EMAIL_RECEIPTS_MAX_DOMAINS).toBe(200);
  });

  it("counts only the emails in the given status, as a bound parameter", async () => {
    const { service, manager } = setup();
    manager.query.mockResolvedValue([]);
    await service.listDomains(USER, { status: "review" });
    const [sql, params] = manager.query.mock.calls[0];
    expect(sql).toContain("($4::varchar IS NULL OR r.status = $4::varchar)");
    expect(params[3]).toBe("review");
    expect(sql).not.toContain("review");
  });

  it("is empty for a user with no emails", async () => {
    const { service, manager } = setup();
    manager.query.mockResolvedValue([]);
    await expect(service.listDomains(USER)).resolves.toEqual([]);
  });
});

describe("EmailReceiptsService.listUncoveredDomains", () => {
  it("lists the domains no approved profile covers, with the newest draft naming each, in one statement", async () => {
    const { service, manager } = setup();
    manager.query.mockResolvedValue([
      {
        domain: "a.example.com",
        count: "5",
        draft_parser_id: "p-draft",
        request_id: "req-1",
        request_status: "pending",
      },
      {
        domain: "b.example.com",
        count: 2,
        draft_parser_id: null,
        request_id: null,
        request_status: null,
      },
    ]);
    await expect(service.listUncoveredDomains(USER)).resolves.toEqual([
      {
        domain: "a.example.com",
        count: 5,
        draftParserId: "p-draft",
        pendingRequestId: "req-1",
        pendingRequestStatus: "pending",
      },
      {
        domain: "b.example.com",
        count: 2,
        draftParserId: null,
        pendingRequestId: null,
        pendingRequestStatus: null,
      },
    ]);
    expect(manager.query).toHaveBeenCalledTimes(1);
    const [sql, params] = manager.query.mock.calls[0];
    // only an approved profile covers a domain; a draft reads no mail
    expect(sql).toContain("p.status = 'approved'");
    expect(sql).toContain("p.status = 'draft'");
    // the pipeline's sub-domain rule
    expect(sql).toContain("right(r.from_domain, length(pd.domain) + 1)");
    expect(sql).toContain("ORDER BY d.count DESC, d.domain ASC");
    expect(sql).toContain("r.user_id = $1");
    // the open parser-draft request of the domain, in the same statement
    expect(sql).toContain("q.kind = 'email_parser_draft'");
    expect(sql).toContain("q.parser_domain = d.domain");
    expect(sql).toContain("q.status IN ('pending', 'claimed')");
    expect(sql).toContain("q.expires_at > CURRENT_TIMESTAMP");
    expect(sql).toContain("q.user_id = $1");
    expect(params).toEqual([USER, EMAIL_RECEIPTS_MAX_DOMAINS]);
  });

  it("is empty when every domain is covered", async () => {
    const { service, manager } = setup();
    manager.query.mockResolvedValue([]);
    await expect(service.listUncoveredDomains(USER)).resolves.toEqual([]);
  });
});

describe("EmailReceiptsService.statusCounts", () => {
  it("counts the user's emails per status and their total", async () => {
    const { service, manager } = setup();
    manager.query.mockResolvedValue([
      { status: "review", count: "2" },
      { status: "unmatched", count: 5 },
    ]);
    await expect(service.statusCounts(USER)).resolves.toEqual({
      total: 7,
      byStatus: { review: 2, unmatched: 5 },
    });
    const [sql, params] = manager.query.mock.calls[0];
    expect(sql).toContain("r.user_id = $1");
    expect(sql).toContain("GROUP BY r.status");
    expect(params).toEqual([USER, null, null]);
  });

  it("limits the count to a domain and its sub-domains, escaped", async () => {
    const { service, manager } = setup();
    manager.query.mockResolvedValue([]);
    await expect(
      service.statusCounts(USER, { domain: " Shop_x.example.com " }),
    ).resolves.toEqual({ total: 0, byStatus: {} });
    expect(manager.query.mock.calls[0][1]).toEqual([
      USER,
      "shop_x.example.com",
      "%.shop\\_x.example.com",
    ]);
  });
});

describe("EmailReceiptsService.get", () => {
  it("returns the text, the parse and the candidates in the stored order", async () => {
    const { service, manager } = setup();
    manager.query
      .mockResolvedValueOnce([
        {
          ...row({ status: "ambiguous", ai_review_request_id: null }),
          body_text: "Order total: 9.99",
          body_html: "<p>Order total: <b>9.99</b></p>",
          parsed: { total: 99900 },
          candidate_transaction_ids: ["t2", "t1", "gone"],
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "t1",
          date: "2026-09-11",
          amount: "-9.9900",
          currency_code: "USD",
          payee_name: null,
          description: "CARD",
        },
        {
          id: "t2",
          date: "2026-09-10",
          amount: "-9.9900",
          currency_code: "USD",
          payee_name: "Shop",
          description: null,
        },
      ]);

    const detail = await service.get(USER, ID);

    expect(detail.bodyText).toBe("Order total: 9.99");
    expect(detail.bodyHtml).toBe("<p>Order total: <b>9.99</b></p>");
    expect(manager.query.mock.calls[0][0]).toContain("r.body_html");
    expect(detail.parsed).toEqual({ total: 99900 });
    expect(detail.candidates.map((c) => c.id)).toEqual(["t2", "t1"]);
    expect(detail.candidates[0]).toMatchObject({
      amount: -9.99,
      payeeName: "Shop",
    });
    expect(manager.query.mock.calls[1][1]).toEqual([
      USER,
      ["t2", "t1", "gone"],
    ]);
  });

  it("has no bodyHtml for an email with no HTML part", async () => {
    const { service, manager } = setup();
    manager.query.mockResolvedValueOnce([
      {
        ...row(),
        body_text: "x",
        body_html: null,
        parsed: null,
        candidate_transaction_ids: [],
      },
    ]);

    expect((await service.get(USER, ID)).bodyHtml).toBeNull();
  });

  describe("the lines a parser reads and the structured order", () => {
    const HTML =
      "<table><tr><td>Widget</td><td>9,99 zł</td></tr></table>" +
      '<script type="application/ld+json">' +
      JSON.stringify({
        "@type": "Order",
        orderNumber: "SO-1",
        merchant: { name: "Example Shop" },
        price: "9.99",
        acceptedOffer: [{ itemOffered: { name: "Widget" }, price: "9.99" }],
      }) +
      "</script>";
    const detailRow = (over: Record<string, unknown>) => ({
      ...row(),
      body_text: "Widget  9,99 zł\n\nTotal 9,99",
      body_html: null,
      parsed: null,
      candidate_transaction_ids: [],
      ...over,
    });

    it("returns the text lines and the html lines, as each source numbers them", async () => {
      const { service, manager } = setup();
      manager.query.mockResolvedValueOnce([detailRow({ body_html: HTML })]);
      const detail = await service.get(USER, ID);
      expect(detail.lines).toEqual({
        text: ["Widget 9,99 zł", "Total 9,99"],
        html: ["Widget", "9,99 zł"],
      });
    });

    it("has no html lines, and no structured order, for an email with no HTML part", async () => {
      const { service, manager } = setup();
      manager.query.mockResolvedValueOnce([detailRow({})]);
      const detail = await service.get(USER, ID);
      expect(detail.lines.html).toBeNull();
      expect(detail.lines.text).toEqual(["Widget 9,99 zł", "Total 9,99"]);
      expect(detail.structuredOrder).toBeNull();
    });

    it("returns the schema.org order found in the HTML, in 1/10000 units", async () => {
      const { service, manager } = setup();
      manager.query.mockResolvedValueOnce([detailRow({ body_html: HTML })]);
      const detail = await service.get(USER, ID);
      expect(detail.structuredOrder).toEqual({
        orderNumber: "SO-1",
        seller: "Example Shop",
        currency: null,
        orderDate: null,
        total: 99900,
        discount: null,
        items: [{ name: "Widget", qty: 1, unitPrice: 99900, amount: 99900 }],
      });
    });

    it("says not found (null) for HTML with no order markup", async () => {
      const { service, manager } = setup();
      manager.query.mockResolvedValueOnce([
        detailRow({ body_html: "<p>Thanks</p>" }),
      ]);
      const detail = await service.get(USER, ID);
      expect(detail.structuredOrder).toBeNull();
      expect(detail.lines.html).toEqual(["Thanks"]);
    });

    it("bounds each list at the parser's line cap", async () => {
      const { service, manager } = setup();
      manager.query.mockResolvedValueOnce([
        detailRow({
          body_text: "x\n".repeat(MAX_PARSE_LINES + 50),
          body_html: "<p>x</p>".repeat(MAX_PARSE_LINES + 50),
        }),
      ]);
      const detail = await service.get(USER, ID);
      expect(detail.lines.text).toHaveLength(MAX_PARSE_LINES);
      expect(detail.lines.html).toHaveLength(MAX_PARSE_LINES);
    });

    it("never carries lines or the order in the list", async () => {
      const { service, manager } = setup();
      manager.query.mockResolvedValue([row()]);
      const [item] = await service.list(USER, {});
      expect(Object.keys(item)).not.toContain("lines");
      expect(Object.keys(item)).not.toContain("structuredOrder");
      expect(manager.query.mock.calls[0][0]).not.toContain("body_html");
    });
  });

  it("does not look for candidates when there are none", async () => {
    const { service, manager } = setup();
    manager.query.mockResolvedValueOnce([
      { ...row(), body_text: "", parsed: null, candidate_transaction_ids: [] },
    ]);
    await service.get(USER, ID);
    expect(manager.query).toHaveBeenCalledTimes(1);
  });

  it("is a 404 for an email that is not the user's", async () => {
    const { service, manager } = setup();
    manager.query.mockResolvedValue([]);
    await expect(service.get(USER, ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe("EmailReceiptsService.reprocess and link", () => {
  it("reprocess runs the pipeline under the JWT user and returns the fresh detail", async () => {
    const { service, manager, pipeline } = setup();
    manager.query.mockResolvedValueOnce([
      { ...row(), body_text: "", parsed: null, candidate_transaction_ids: [] },
    ]);
    const detail = await service.reprocess(USER, ID);
    expect(pipeline.process).toHaveBeenCalledWith(USER, ID);
    expect(detail.id).toBe(ID);
  });

  it("link hands the pipeline the transaction, which checks it in the writing transaction", async () => {
    const { service, manager, pipeline } = setup();
    manager.query.mockResolvedValueOnce([
      { ...row(), body_text: "", parsed: null, candidate_transaction_ids: [] },
    ]);
    await service.link(USER, ID, "t9");
    expect(pipeline.process).toHaveBeenCalledWith(USER, ID, {
      link: { transactionId: "t9" },
    });
  });

  it("a refusal from the pipeline propagates and nothing is read after it", async () => {
    const { service, manager, pipeline } = setup();
    pipeline.process.mockRejectedValue(new ConflictException("applied"));
    await expect(service.link(USER, ID, "t9")).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(manager.query).not.toHaveBeenCalled();
  });
});

describe("EmailReceiptsService.ignore", () => {
  it("dismisses the receipt's open requests and marks it ignored, under the row lock", async () => {
    const { service, manager, receiptRepo } = setup();
    receiptRepo.findOne.mockResolvedValue(locked());
    manager.query.mockImplementation(async (sql: string) =>
      sql.includes("SELECT status FROM ai_review_requests")
        ? [{ status: "proposed" }]
        : sql.includes("FROM email_receipts r")
          ? [
              {
                ...row({ status: "ignored", ai_review_request_id: null }),
                body_text: "",
                parsed: null,
                candidate_transaction_ids: [],
              },
            ]
          : [],
    );

    const detail = await service.ignore(USER, ID);

    expect(receiptRepo.findOne).toHaveBeenCalledWith({
      where: { id: ID, userId: USER },
      lock: { mode: "pessimistic_write" },
    });
    const sqls = manager.query.mock.calls.map((c) => String(c[0]));
    const advisory = sqls.findIndex((s) => s.includes("pg_advisory_xact_lock"));
    const close = sqls.findIndex((s) => s.includes("SET status = 'rejected'"));
    expect(advisory).toBeGreaterThanOrEqual(0);
    expect(close).toBeGreaterThan(advisory);
    expect(receiptRepo.update).toHaveBeenCalledWith(
      { id: ID, userId: USER },
      { status: "ignored", statusReason: null, aiReviewRequestId: null },
    );
    expect(detail.status).toBe("ignored");
  });

  it("refuses an applied receipt and writes nothing", async () => {
    const { service, manager, receiptRepo } = setup();
    receiptRepo.findOne.mockResolvedValue(locked());
    manager.query.mockResolvedValue([{ status: "applied" }]);
    await expect(service.ignore(USER, ID)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(receiptRepo.update).not.toHaveBeenCalled();
    expect(
      manager.query.mock.calls.some((c) =>
        String(c[0]).includes("SET status = 'rejected'"),
      ),
    ).toBe(false);
  });

  it("refuses a skipped receipt and writes nothing", async () => {
    const { service, receiptRepo } = setup();
    receiptRepo.findOne.mockResolvedValue(locked({ status: "skipped" }));
    await expect(service.ignore(USER, ID)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(receiptRepo.update).not.toHaveBeenCalled();
  });

  it("ignoring an ignored receipt is a no-op", async () => {
    const { service, manager, receiptRepo } = setup();
    receiptRepo.findOne.mockResolvedValue(locked({ status: "ignored" }));
    manager.query.mockResolvedValue([
      { ...row(), body_text: "", parsed: null, candidate_transaction_ids: [] },
    ]);
    await service.ignore(USER, ID);
    expect(receiptRepo.update).not.toHaveBeenCalled();
  });

  it("is a 404 for another user's email", async () => {
    const { service, receiptRepo } = setup();
    receiptRepo.findOne.mockResolvedValue(null);
    await expect(service.ignore(USER, ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe("EmailReceiptsService.remove", () => {
  it("dismisses the open request and deletes the email in one transaction", async () => {
    const { service, manager, receiptRepo } = setup();
    receiptRepo.findOne.mockResolvedValue(locked());
    manager.query.mockResolvedValue([]);

    await service.remove(USER, ID);

    const dismiss = manager.query.mock.calls.find((c) =>
      String(c[0]).includes("SET status = 'rejected'"),
    );
    expect(dismiss?.[1]).toEqual([USER, ID]);
    expect(receiptRepo.delete).toHaveBeenCalledWith({ id: ID, userId: USER });
    expect(
      dismiss && receiptRepo.delete.mock.invocationCallOrder[0],
    ).toBeGreaterThan(
      manager.query.mock.invocationCallOrder[
        manager.query.mock.calls.indexOf(dismiss)
      ],
    );
  });

  it("a missing email deletes nothing and closes nothing", async () => {
    const { service, manager, receiptRepo } = setup();
    receiptRepo.findOne.mockResolvedValue(null);
    await expect(service.remove(USER, ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(receiptRepo.delete).not.toHaveBeenCalled();
    expect(manager.query).not.toHaveBeenCalled();
  });
});

describe("EmailReceiptsService.overview", () => {
  it("answers the hub's cards from ONE statement, keyed on the user", async () => {
    const { service, manager } = setup();
    manager.query.mockResolvedValue([
      {
        mailbox: {
          enabled: true,
          auth_method: "oauth2",
          ai_mode: "on_demand",
          connected: true,
          last_polled_at: "2026-10-04T11:00:00.000Z",
          last_success_at: "2026-10-04T11:00:00.000Z",
          last_error: null,
          last_error_at: null,
        },
        by_status: {
          pending: 2,
          no_parser: 5,
          unmatched: 1,
          review: 7,
          ignored: 4,
        },
        to_approve: 3,
        parsers: { approved: 2, draft: 1 },
        uncovered: [
          { domain: "shop.example.com", count: 4 },
          { domain: "pay.example.org", count: 1 },
        ],
      },
    ]);

    const overview = await service.overview(USER);

    expect(manager.query).toHaveBeenCalledTimes(1);
    const [sql, params] = manager.query.mock.calls[0];
    expect(String(sql)).toContain("user_id = $1");
    expect(params[0]).toBe(USER);
    expect(overview).toEqual({
      mailbox: {
        enabled: true,
        authMethod: "oauth2",
        aiMode: "on_demand",
        connected: true,
        lastPolledAt: "2026-10-04T11:00:00.000Z",
        lastSuccessAt: "2026-10-04T11:00:00.000Z",
        lastError: null,
        lastErrorAt: null,
      },
      emailsByStatus: {
        pending: 2,
        no_parser: 5,
        unmatched: 1,
        review: 7,
        ignored: 4,
      },
      // pending + no_parser + parse_failed + unmatched + ambiguous + review_conflict
      processable: 8,
      proposalsToApprove: 3,
      parsers: { approved: 2, draft: 1 },
      domainsWithoutProfile: [
        { domain: "shop.example.com", count: 4 },
        { domain: "pay.example.org", count: 1 },
      ],
    });
  });

  it("is empty and names no mailbox for a user with nothing yet", async () => {
    const { service, manager } = setup();
    manager.query.mockResolvedValue([
      {
        mailbox: null,
        by_status: null,
        to_approve: 0,
        parsers: { approved: 0, draft: 0 },
        uncovered: null,
      },
    ]);
    expect(await service.overview(USER)).toEqual({
      mailbox: null,
      emailsByStatus: {},
      processable: 0,
      proposalsToApprove: 0,
      parsers: { approved: 0, draft: 0 },
      domainsWithoutProfile: [],
    });
  });

  it("reads a disconnected OAuth2 mailbox as not connected", async () => {
    const { service, manager } = setup();
    manager.query.mockResolvedValue([
      {
        mailbox: {
          enabled: true,
          auth_method: "oauth2",
          ai_mode: "off",
          connected: false,
          last_polled_at: null,
          last_success_at: null,
          last_error: "Reconnect it",
          last_error_at: "2026-10-04T10:00:00.000Z",
        },
        by_status: null,
        to_approve: 0,
        parsers: { approved: 0, draft: 0 },
        uncovered: null,
      },
    ]);
    const overview = await service.overview(USER);
    expect(overview.mailbox).toMatchObject({
      connected: false,
      lastError: "Reconnect it",
    });
  });

  it("counts a domain no profile covers by the same predicate the automatic draft step uses", async () => {
    const { service, manager } = setup();
    manager.query.mockResolvedValue([
      {
        mailbox: null,
        by_status: null,
        to_approve: 0,
        parsers: { approved: 0, draft: 0 },
        uncovered: [],
      },
    ]);
    await service.overview(USER);
    const sql = String(manager.query.mock.calls[0][0]);
    expect(sql).toContain("r.status = 'no_parser'");
    expect(sql).toContain("unnest(p.from_domains)");
    expect(sql).toContain("kind = 'email_receipt'");
    expect(sql).toContain("rq.status = 'proposed'");
    expect(sql).toContain("rq.expires_at > CURRENT_TIMESTAMP");
  });

  it("is a statement of reads only", async () => {
    const { service, manager } = setup();
    manager.query.mockResolvedValue([
      {
        mailbox: null,
        by_status: null,
        to_approve: 0,
        parsers: {},
        uncovered: null,
      },
    ]);
    await service.overview(USER);
    expect(String(manager.query.mock.calls[0][0]).trim()).toMatch(/^SELECT/);
  });
});

describe("EmailReceiptsService.processBatch", () => {
  const SINCE = "2026-10-04T12:00:00.123456Z";

  /** The statements a run issues: the cutoff, the selection, the count of what is left. */
  function batch(ids: string[], remaining = 0, since = SINCE) {
    const h = setup();
    h.manager.query.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (text.includes("AS since")) return [{ since }];
      if (text.includes("SELECT r.id")) return ids.map((id) => ({ id }));
      if (text.includes("COUNT(*)::int AS remaining")) return [{ remaining }];
      return [];
    });
    return h;
  }

  const result = (status: string, over: Record<string, unknown> = {}) => ({
    status,
    statusReason: null,
    transactionId: null,
    matchKind: null,
    requestId: null,
    autoApplied: false,
    unchanged: false,
    ...over,
  });

  it("runs the pipeline over the selected emails one after the other and counts where each ended", async () => {
    const h = batch(["a", "b", "c"], 4);
    h.pipeline.process
      .mockResolvedValueOnce(result("review") as never)
      .mockResolvedValueOnce(result("unmatched") as never)
      .mockResolvedValueOnce(result("review") as never);

    const out = await h.service.processBatch(USER, {});

    expect(h.pipeline.process.mock.calls.map((c) => c[1])).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(out).toEqual({
      processed: 3,
      byOutcome: { review: 2, unmatched: 1 },
      failed: 0,
      remaining: 4,
      since: SINCE,
    });
  });

  it("is sequential: the next email starts after the previous one finished", async () => {
    const h = batch(["a", "b"]);
    const order: string[] = [];
    h.pipeline.process.mockImplementation((async (_u: string, id: string) => {
      order.push(`start ${id}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push(`end ${id}`);
      return result("review");
    }) as never);
    await h.service.processBatch(USER, {});
    expect(order).toEqual(["start a", "end a", "start b", "end b"]);
  });

  it("guards each email by the statuses it was selected for, and gives them one shared AI budget", async () => {
    const h = batch(["a", "b"]);
    h.pipeline.process.mockResolvedValue(result("review") as never);
    await h.service.processBatch(USER, { statuses: ["pending", "no_parser"] });
    const [first, second] = h.pipeline.process.mock.calls;
    expect(first[2]).toMatchObject({
      onlyWhenStatusIn: ["pending", "no_parser"],
    });
    expect(first[2]?.aiCategoryBudget).toBe(second[2]?.aiCategoryBudget);
    expect(first[2]?.aiCategoryBudget?.remaining).toBe(
      EMAIL_RECEIPTS_BATCH_AI_CATEGORY_CALLS,
    );
  });

  it("does not count an email the pipeline left as it was", async () => {
    const h = batch(["a", "b"]);
    h.pipeline.process
      .mockResolvedValueOnce(result("review", { unchanged: true }) as never)
      .mockResolvedValueOnce(result("review") as never);
    const out = await h.service.processBatch(USER, {});
    expect(out.processed).toBe(1);
    expect(out.byOutcome).toEqual({ review: 1 });
  });

  it("selects the user's emails in the given statuses (all six by default), oldest first, up to the limit, not touched since the run began", async () => {
    const h = batch([]);
    await h.service.processBatch(USER, { limit: 25 });
    const select = h.manager.query.mock.calls.find((c) =>
      String(c[0]).includes("SELECT r.id"),
    ) as [string, unknown[]];
    expect(select[0]).toContain("r.user_id = $1");
    expect(select[0]).toContain("r.status = ANY($2::varchar[])");
    expect(select[0]).toContain("r.updated_at < $5::timestamptz");
    expect(select[0]).toContain("ORDER BY r.received_at ASC, r.id ASC");
    expect(select[1]).toEqual([
      USER,
      [
        "pending",
        "no_parser",
        "parse_failed",
        "unmatched",
        "ambiguous",
        "review_conflict",
      ],
      null,
      null,
      SINCE,
      25,
    ]);
  });

  it("clamps the limit to 1..200 and defaults it to 100", async () => {
    const limitOf = async (limit?: number) => {
      const h = batch([]);
      await h.service.processBatch(USER, { limit });
      const select = h.manager.query.mock.calls.find((c) =>
        String(c[0]).includes("SELECT r.id"),
      ) as [string, unknown[]];
      return select[1][5];
    };
    expect(await limitOf(undefined)).toBe(100);
    expect(await limitOf(0)).toBe(1);
    expect(await limitOf(5000)).toBe(200);
  });

  it("filters by sender domain or one of its sub-domains, with the LIKE specials taken literally", async () => {
    const h = batch([]);
    await h.service.processBatch(USER, { domain: "Shop_1.Example.com " });
    const select = h.manager.query.mock.calls.find((c) =>
      String(c[0]).includes("SELECT r.id"),
    ) as [string, unknown[]];
    expect(select[1][2]).toBe("shop_1.example.com");
    expect(select[1][3]).toBe("%.shop\\_1.example.com");
  });

  it("takes the run's cutoff from the first call and gives it back; a later call sends it again and is clamped to now by the database", async () => {
    const h = batch([]);
    await h.service.processBatch(USER, {
      since: "2026-10-04T11:59:59.000000Z",
    });
    const stamp = h.manager.query.mock.calls.find((c) =>
      String(c[0]).includes("AS since"),
    ) as [string, unknown[]];
    expect(stamp[1]).toEqual(["2026-10-04T11:59:59.000000Z"]);
    expect(stamp[0]).toContain("LEAST(");
    expect(stamp[0]).toContain("CURRENT_TIMESTAMP");
  });

  it("counts what is left with the same filter and the same cutoff, so a run ends", async () => {
    const h = batch(["a"], 0);
    h.pipeline.process.mockResolvedValue(result("unmatched") as never);
    const out = await h.service.processBatch(USER, {
      domain: "shop.example.com",
    });
    const count = h.manager.query.mock.calls.find((c) =>
      String(c[0]).includes("COUNT(*)::int AS remaining"),
    ) as [string, unknown[]];
    expect(count[0]).toContain("r.updated_at < $5::timestamptz");
    expect(count[1]).toEqual([
      USER,
      expect.any(Array),
      "shop.example.com",
      "%.shop.example.com",
      SINCE,
    ]);
    expect(out.remaining).toBe(0);
  });

  it("passes over an email that raised an error: counts it, touches it so the run does not take it again, and goes on", async () => {
    const h = batch(["a", "b"], 0);
    h.pipeline.process
      .mockRejectedValueOnce(new ConflictException("applied"))
      .mockResolvedValueOnce(result("review") as never);

    const out = await h.service.processBatch(USER, {});

    expect(out).toMatchObject({
      processed: 1,
      failed: 1,
      byOutcome: { review: 1 },
    });
    const touch = h.manager.query.mock.calls.find((c) =>
      String(c[0]).includes("SET status_reason = status_reason"),
    ) as [string, unknown[]];
    expect(touch[1]).toEqual(["a", USER]);
  });

  it("does not fail the run when marking a failed email also fails", async () => {
    const h = batch(["a"], 0);
    h.pipeline.process.mockRejectedValue(new Error("boom"));
    const base = h.manager.query.getMockImplementation() as (
      sql: string,
    ) => Promise<unknown>;
    h.manager.query.mockImplementation(async (sql: string) => {
      if (String(sql).includes("SET status_reason = status_reason")) {
        throw new Error("also down");
      }
      return base(sql);
    });
    await expect(h.service.processBatch(USER, {})).resolves.toMatchObject({
      failed: 1,
    });
  });

  it("never runs more than the selection: an empty one is a quiet answer", async () => {
    const h = batch([], 0);
    const out = await h.service.processBatch(USER, {});
    expect(h.pipeline.process).not.toHaveBeenCalled();
    expect(out).toEqual({
      processed: 0,
      byOutcome: {},
      failed: 0,
      remaining: 0,
      since: SINCE,
    });
  });
});
