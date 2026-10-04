import {
  ConflictException,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { Category } from "../../categories/entities/category.entity";
import { Payee } from "../../payees/entities/payee.entity";
import { createScopedDbMocks } from "../../test-helpers/scoped-db-testing";
import { EmailReceiptParser } from "../entities/email-receipt-parser.entity";
import { EmailReceipt } from "../entities/email-receipt.entity";
import { EMAIL_RECEIPT_PARSER_LANGUAGE_GUIDE } from "./parser-tool.guide";
import { MAX_PARSERS_PER_USER } from "./email-receipt-parsers.service";
import {
  EmailReceiptParserToolsService,
  PARSER_TOOL_MAX_CATEGORIES,
} from "./email-receipt-parser-tools.service";

jest.mock("../../common/db/scoped-db", () =>
  jest
    .requireActual("../../test-helpers/scoped-db-testing")
    .scopedDbMockModule(),
);

const USER = "user-1";
const R1 = "30000000-0000-4000-8000-000000000001";
const R2 = "30000000-0000-4000-8000-000000000002";
const REQ = "30000000-0000-4000-8000-000000000009";
const CAT_BOOKS = "11111111-1111-4111-8111-111111111111";
const CAT_SHIP = "22222222-2222-4222-8222-222222222222";
const CAT_GONE = "33333333-3333-4333-8333-333333333333";
const CALLER = "assistant";

const DEFINITION = {
  version: 2,
  orderId: ["Order number: {orderid}"],
  total: ["Order total: {amount}"],
  shipping: ["Shipping: {amount}"],
  items: {
    startAfter: "Items",
    stopAt: "Subtotal",
    patterns: ["{name} {amount}"],
  },
  defaultCategoryId: CAT_BOOKS,
  shippingCategoryId: CAT_SHIP,
};

const receipt = (over: Partial<EmailReceipt> = {}) =>
  Object.assign(new EmailReceipt(), {
    id: R1,
    userId: USER,
    subject: "Your order ABCD1234",
    bodyText: [
      "Order number: ABCD1234",
      "Items",
      "Widget 12.00",
      "Subtotal 12.00",
      "Shipping: 3.00",
      "Order total: 15.00",
    ].join("\n"),
    receivedAt: new Date("2026-09-10T10:00:00Z"),
    originalSentAt: null,
    ...over,
  });

function setup() {
  const parserRepo = {
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn((v: Partial<EmailReceiptParser>) =>
      Object.assign(new EmailReceiptParser(), v),
    ),
    save: jest.fn(async (v: EmailReceiptParser) =>
      Object.assign(v, { id: "p-new", fromDomains: v.fromDomains }),
    ),
  };
  const receiptRepo = { find: jest.fn().mockResolvedValue([receipt()]) };
  const categoryRepo = {
    find: jest.fn().mockResolvedValue([
      { id: CAT_BOOKS, name: "Books", parentId: null },
      { id: CAT_SHIP, name: "Shipping", parentId: null },
    ]),
    count: jest.fn(async ({ where }) => (where.id._value as string[]).length),
  };
  const payeeRepo = { count: jest.fn().mockResolvedValue(1) };
  const { manager, dataSource } = createScopedDbMocks([
    [EmailReceiptParser, parserRepo],
    [EmailReceipt, receiptRepo],
    [Category, categoryRepo],
    [Payee, payeeRepo],
  ]);
  const payees = {
    resolveByName: jest.fn().mockResolvedValue(null),
  };
  const requests = {
    proposeParserDraft: jest.fn().mockResolvedValue(true),
  };
  const service = new EmailReceiptParserToolsService(
    dataSource as never,
    payees as never,
    requests as never,
  );
  /** The request row `lockClaimedRequest` reads, when a spec gives a requestId. */
  const requestRow = (over: Record<string, unknown> = {}) =>
    manager.query.mockResolvedValue([
      {
        kind: "email_parser_draft",
        status: "claimed",
        claimed_by: CALLER,
        live: true,
        ...over,
      },
    ]);
  return {
    service,
    manager,
    parserRepo,
    receiptRepo,
    categoryRepo,
    payeeRepo,
    payees,
    requests,
    requestRow,
  };
}

describe("EmailReceiptParserToolsService.listCategories", () => {
  it("lists the user's categories as id and qualified name", async () => {
    const { service } = setup();

    await expect(service.listCategories(USER)).resolves.toEqual({
      categories: [
        { id: CAT_BOOKS, name: "Books" },
        { id: CAT_SHIP, name: "Shipping" },
      ],
      totalCount: 2,
      truncated: false,
      guide: EMAIL_RECEIPT_PARSER_LANGUAGE_GUIDE,
    });
  });

  it("is bounded, and says when more exist", async () => {
    const { service, categoryRepo } = setup();
    categoryRepo.find.mockResolvedValue(
      Array.from({ length: PARSER_TOOL_MAX_CATEGORIES + 20 }, (_, i) => ({
        id: `c${i}`,
        name: `Category ${i}`,
        parentId: null,
      })),
    );

    const result = await service.listCategories(USER);

    expect(result.categories).toHaveLength(PARSER_TOOL_MAX_CATEGORIES);
    expect(result.totalCount).toBe(PARSER_TOOL_MAX_CATEGORIES + 20);
    expect(result.truncated).toBe(true);
  });

  it("reads only the user's own categories", async () => {
    const { service, categoryRepo } = setup();

    await service.listCategories(USER);

    expect(categoryRepo.find.mock.calls[0][0].where.userId).toBe(USER);
  });

  it("returns the whole parser language beside the categories", async () => {
    const { service } = setup();

    const result = await service.listCategories(USER);

    expect(result.guide).toBe(EMAIL_RECEIPT_PARSER_LANGUAGE_GUIDE);
    expect(result.guide).toContain("joinWrapped");
  });
});

describe("EmailReceiptParserToolsService.testDefinition", () => {
  it("reads each email and reports what it parsed in decimals, with category names", async () => {
    const { service, receiptRepo } = setup();
    receiptRepo.find.mockResolvedValue([
      receipt(),
      receipt({ id: R2, subject: "Another", bodyText: "nothing here" }),
    ]);

    const result = await service.testDefinition(USER, {
      definition: DEFINITION,
      receiptIds: [R2, R1],
    });

    expect(result.valid).toBe(true);
    expect(result.emails.map((e) => e.receiptId)).toEqual([R2, R1]);
    expect(result.emails[1].parsed).toEqual({
      orderId: "ABCD1234",
      total: 15,
      paid: null,
      payee: null,
      shipping: 3,
      discount: null,
      items: [{ name: "Widget", qty: 1, amount: 12, category: "Books" }],
      complete: true,
      reason: null,
    });
    expect(result.emails[0].parsed).toMatchObject({
      total: null,
      complete: false,
      reason: "no_total",
    });
    expect(result.allComplete).toBe(false);
    expect(result.unknownCategoryIds).toEqual([]);
  });

  it("says which entry and which line read each value, and what the guards would do", async () => {
    const { service, receiptRepo } = setup();
    receiptRepo.find.mockResolvedValue([receipt()]);

    const result = await service.testDefinition(USER, {
      definition: DEFINITION,
      receiptIds: [R1],
    });

    const [email] = result.emails;
    expect(email.outcome).toBe("read");
    expect(email.trace.orderId).toMatchObject({
      entry: 0,
      pattern: "Order number: {orderid}",
      line: { line: 1, text: "Order number: ABCD1234" },
    });
    expect(email.trace.total).toMatchObject({ entry: 0, line: { line: 6 } });
    expect(email.trace.items).toEqual([
      expect.objectContaining({
        mode: "patterns",
        patterns: ["{name} {amount}"],
        lines: [{ line: 3, text: "Widget 12.00" }],
      }),
    ]);
  });

  it("reports a guard that would stop the pipeline reading the email", async () => {
    const { service, receiptRepo } = setup();
    receiptRepo.find.mockResolvedValue([receipt()]);

    const result = await service.testDefinition(USER, {
      definition: { ...DEFINITION, requireLine: ["*PayU*"] },
      receiptIds: [R1],
    });

    expect(result.emails[0].outcome).toBe("not_applicable");
    expect(result.emails[0].trace.requireLine).toBeNull();
  });

  it("traces at most 20 items per email", async () => {
    const { service, receiptRepo } = setup();
    const body = [
      "Items",
      ...Array.from({ length: 30 }, (_, i) => `P${i} 1.00`),
    ].join("\n");
    receiptRepo.find.mockResolvedValue([receipt({ bodyText: body })]);

    const result = await service.testDefinition(USER, {
      definition: {
        version: 2,
        items: { patterns: ["{name} {amount}"], startAfter: "Items" },
      },
      receiptIds: [R1],
    });

    expect(result.emails[0].parsed.items).toHaveLength(30);
    expect(result.emails[0].trace.items).toHaveLength(20);
  });

  it("is allComplete only when every email reads complete", async () => {
    const { service, receiptRepo } = setup();
    receiptRepo.find.mockResolvedValue([receipt(), receipt({ id: R2 })]);

    const result = await service.testDefinition(USER, {
      definition: DEFINITION,
      receiptIds: [R1, R2],
    });

    expect(result.allComplete).toBe(true);
  });

  it("accepts a definition with the version left out", async () => {
    const { service } = setup();
    const { version: _omit, ...unversioned } = DEFINITION;

    const result = await service.testDefinition(USER, {
      definition: unversioned,
      receiptIds: [R1],
    });

    expect(result.valid).toBe(true);
  });

  it("returns an invalid definition as a result with every error, reading no email", async () => {
    const { service, receiptRepo } = setup();

    const result = await service.testDefinition(USER, {
      definition: { total: ["no capture"], bogus: 1 },
      receiptIds: [R1],
    });

    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => `${e.path}:${e.code}`)).toEqual(
      expect.arrayContaining(["bogus:unknown_key", "total[0]:capture_missing"]),
    );
    expect(result.emails).toEqual([]);
    expect(result.allComplete).toBe(false);
    expect(receiptRepo.find).not.toHaveBeenCalled();
  });

  it("lists a category the definition names that is not the user's, and is then not allComplete", async () => {
    const { service } = setup();

    const result = await service.testDefinition(USER, {
      definition: { ...DEFINITION, defaultCategoryId: CAT_GONE },
      receiptIds: [R1],
    });

    expect(result.unknownCategoryIds).toEqual([CAT_GONE]);
    expect(result.allComplete).toBe(false);
  });

  it("is a 404 for an email that is not the user's, and reads through the user's own scope", async () => {
    const { service, receiptRepo } = setup();
    receiptRepo.find.mockResolvedValue([receipt()]);

    await expect(
      service.testDefinition(USER, {
        definition: DEFINITION,
        receiptIds: [R1, R2],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(receiptRepo.find.mock.calls[0][0].where.userId).toBe(USER);
  });

  it.each([[[]], [[R1, R1, R1, R1, R1, R1]]])(
    "refuses %j emails",
    async (receiptIds) => {
      const { service, receiptRepo } = setup();

      await expect(
        service.testDefinition(USER, { definition: DEFINITION, receiptIds }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(receiptRepo.find).not.toHaveBeenCalled();
    },
  );

  it("uses the payee's default category as the fallback, resolved by name and never created", async () => {
    const { service, payees, receiptRepo } = setup();
    payees.resolveByName.mockResolvedValue({
      id: "pay1",
      name: "Shop",
      defaultCategoryId: CAT_BOOKS,
    });
    receiptRepo.find.mockResolvedValue([receipt()]);
    const { defaultCategoryId: _drop, ...noDefault } = DEFINITION;

    const result = await service.testDefinition(USER, {
      definition: noDefault,
      receiptIds: [R1],
      payeeName: "Shop",
    });

    expect(payees.resolveByName).toHaveBeenCalledWith(USER, "Shop");
    expect(result.emails[0].parsed.items[0].category).toBe("Books");
  });

  it("writes nothing", async () => {
    const { service, parserRepo, manager } = setup();

    await service.testDefinition(USER, {
      definition: DEFINITION,
      receiptIds: [R1],
    });

    expect(parserRepo.save).not.toHaveBeenCalled();
    expect(manager.query).not.toHaveBeenCalled();
  });

  it("dates an email by the shop's day when a forward carried it", async () => {
    const { service, receiptRepo } = setup();
    receiptRepo.find.mockResolvedValue([
      receipt({ originalSentAt: new Date("2026-08-10T10:15:00Z") }),
    ]);

    const result = await service.testDefinition(USER, {
      definition: DEFINITION,
      receiptIds: [R1],
    });

    expect(result.emails[0].effectiveDate).toBe("2026-08-10T10:15:00.000Z");
  });
});

describe("EmailReceiptParserToolsService.saveDraft", () => {
  const input = {
    name: "Example Shop",
    fromDomains: [
      "Shop.Example.com",
      "shop.example.com",
      "@mail.shop.example.com",
    ],
    subjectContains: ["Order", " order ", ""],
    definition: DEFINITION,
  };

  it("stores a DRAFT of source ai, never approved, with normalized domains and subject words", async () => {
    const { service, parserRepo } = setup();

    const result = await service.saveDraft(USER, CALLER, input);

    const saved = parserRepo.save.mock.calls[0][0] as EmailReceiptParser;
    expect(saved).toMatchObject({
      userId: USER,
      name: "Example Shop",
      status: "draft",
      source: "ai",
      approvedAt: null,
      payeeId: null,
      fromDomains: ["shop.example.com", "mail.shop.example.com"],
      subjectContains: ["order"],
    });
    expect(result).toMatchObject({
      parserId: "p-new",
      status: "draft",
      requestProposed: false,
      payee: null,
    });
  });

  it("validates the definition with the one validator, and writes nothing when it is refused", async () => {
    const { service, parserRepo, manager } = setup();

    const error = await service
      .saveDraft(USER, CALLER, {
        ...input,
        definition: { version: 2, total: ["no capture"], bogus: 1 },
      })
      .catch((e) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.message).toContain("bogus: unknown_key");
    expect(parserRepo.save).not.toHaveBeenCalled();
    expect(manager.query).not.toHaveBeenCalled();
  });

  it("accepts a definition with the version left out", async () => {
    const { service, parserRepo } = setup();
    const { version: _omit, ...unversioned } = DEFINITION;

    await service.saveDraft(USER, CALLER, {
      ...input,
      definition: unversioned,
    });

    expect(
      (parserRepo.save.mock.calls[0][0] as EmailReceiptParser).definition,
    ).toMatchObject({ version: 2 });
  });

  it.each([
    ["no name", { name: "  " }],
    ["no domain", { fromDomains: [] }],
    ["a domain that is no host name", { fromDomains: ["not a domain"] }],
    ["a bare word", { fromDomains: ["localhost"] }],
  ])("refuses %s, writing nothing", async (_name, over) => {
    const { service, parserRepo } = setup();

    await expect(
      service.saveDraft(USER, CALLER, { ...input, ...over }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(parserRepo.save).not.toHaveBeenCalled();
  });

  it("resolves the payee by name, never creating one", async () => {
    const { service, payees, parserRepo } = setup();
    payees.resolveByName.mockResolvedValue({
      id: "pay1",
      name: "Example Shop",
    });

    const result = await service.saveDraft(USER, CALLER, {
      ...input,
      payeeName: "Example Shop",
    });

    expect(payees.resolveByName).toHaveBeenCalledWith(USER, "Example Shop");
    expect(
      (parserRepo.save.mock.calls[0][0] as EmailReceiptParser).payeeId,
    ).toBe("pay1");
    expect(result.payee).toEqual({ id: "pay1", name: "Example Shop" });
  });

  it("saves with no payee when the name resolves to none, and says so", async () => {
    const { service, payees, parserRepo } = setup();
    payees.resolveByName.mockResolvedValue(null);

    const result = await service.saveDraft(USER, CALLER, {
      ...input,
      payeeName: "Nobody",
    });

    expect(
      (parserRepo.save.mock.calls[0][0] as EmailReceiptParser).payeeId,
    ).toBeNull();
    expect(result.payee).toBeNull();
  });

  it("checks the user owns every category and the payee, in the write's transaction", async () => {
    const { service, categoryRepo, parserRepo, payees, payeeRepo } = setup();
    payees.resolveByName.mockResolvedValue({ id: "pay1", name: "Shop" });

    await service.saveDraft(USER, CALLER, { ...input, payeeName: "Shop" });

    expect(payeeRepo.count).toHaveBeenCalledWith({
      where: { id: "pay1", userId: USER },
    });
    expect(categoryRepo.count.mock.calls[0][0].where.userId).toBe(USER);
    expect(categoryRepo.count.mock.invocationCallOrder[0]).toBeLessThan(
      parserRepo.save.mock.invocationCallOrder[0],
    );
  });

  it("refuses a category that is not the user's, writing nothing", async () => {
    const { service, categoryRepo, parserRepo } = setup();
    categoryRepo.count.mockResolvedValue(0);

    await expect(service.saveDraft(USER, CALLER, input)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(parserRepo.save).not.toHaveBeenCalled();
  });

  it("refuses beyond the parser cap", async () => {
    const { service, parserRepo } = setup();
    parserRepo.count.mockResolvedValue(MAX_PARSERS_PER_USER);

    await expect(service.saveDraft(USER, CALLER, input)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(parserRepo.save).not.toHaveBeenCalled();
  });

  describe("answering a parser draft request", () => {
    it("locks the request first, then writes the parser and proposes the request in the same transaction", async () => {
      const { service, manager, parserRepo, requests, requestRow } = setup();
      requestRow();

      const result = await service.saveDraft(USER, CALLER, {
        ...input,
        requestId: REQ,
      });

      const [sql, params] = manager.query.mock.calls[0];
      expect(sql).toMatch(/FROM ai_review_requests/);
      expect(sql).toMatch(/FOR UPDATE/);
      expect(sql).toMatch(/user_id = \$2/);
      expect(params).toEqual([REQ, USER]);
      expect(requests.proposeParserDraft).toHaveBeenCalledWith(
        manager,
        USER,
        REQ,
        CALLER,
        "p-new",
      );
      expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(
        parserRepo.save.mock.invocationCallOrder[0],
      );
      expect(parserRepo.save.mock.invocationCallOrder[0]).toBeLessThan(
        requests.proposeParserDraft.mock.invocationCallOrder[0],
      );
      expect(result.requestProposed).toBe(true);
    });

    it.each([
      ["another caller's claim", { claimed_by: "mcp-session" }],
      [
        "a pending request nobody claimed",
        { status: "pending", claimed_by: null },
      ],
      ["a request already proposed", { status: "proposed" }],
      ["a dismissed request", { status: "rejected" }],
      ["an expired request", { live: false }],
      ["a request of another kind", { kind: "email_receipt" }],
    ])("refuses %s with a 409, writing no parser", async (_name, over) => {
      const { service, parserRepo, requests, requestRow } = setup();
      requestRow(over);

      await expect(
        service.saveDraft(USER, CALLER, { ...input, requestId: REQ }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(parserRepo.save).not.toHaveBeenCalled();
      expect(requests.proposeParserDraft).not.toHaveBeenCalled();
    });

    it("is a 404 for a request that is not the user's", async () => {
      const { service, manager, parserRepo } = setup();
      manager.query.mockResolvedValue([]);

      await expect(
        service.saveDraft(USER, CALLER, { ...input, requestId: REQ }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(parserRepo.save).not.toHaveBeenCalled();
    });

    it("refuses, so the parser rolls back, when the conditional UPDATE matches nothing after the check", async () => {
      const { service, requests, requestRow } = setup();
      requestRow();
      requests.proposeParserDraft.mockResolvedValue(false);

      await expect(
        service.saveDraft(USER, CALLER, { ...input, requestId: REQ }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("never touches a request when none is named", async () => {
      const { service, manager, requests } = setup();

      await service.saveDraft(USER, CALLER, input);

      expect(manager.query).not.toHaveBeenCalled();
      expect(requests.proposeParserDraft).not.toHaveBeenCalled();
    });
  });
});
