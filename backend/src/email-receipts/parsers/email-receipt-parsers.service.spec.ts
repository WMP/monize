import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Category } from "../../categories/entities/category.entity";
import { Payee } from "../../payees/entities/payee.entity";
import { createScopedDbMocks } from "../../test-helpers/scoped-db-testing";
import { EmailReceiptParser } from "../entities/email-receipt-parser.entity";
import { EmailReceipt } from "../entities/email-receipt.entity";
import {
  dominantSenderDomain,
  EmailReceiptParsersService,
  MAX_PARSERS_PER_USER,
} from "./email-receipt-parsers.service";
import { RECEIPT_PARSER_DRAFT_INSTRUCTION } from "./parser-draft-instruction";

jest.mock("../../common/db/scoped-db", () =>
  jest
    .requireActual("../../test-helpers/scoped-db-testing")
    .scopedDbMockModule(),
);

const USER = "user-1";
const CAT_A = "11111111-1111-4111-8111-111111111111";
const CAT_B = "22222222-2222-4222-8222-222222222222";

const definition = (over: Record<string, unknown> = {}) => ({
  version: 2,
  total: ["Order total: {amount}"],
  defaultCategoryId: CAT_A,
  ...over,
});

const stored = (over: Partial<EmailReceiptParser> = {}): EmailReceiptParser =>
  Object.assign(new EmailReceiptParser(), {
    id: "p1",
    userId: USER,
    name: "Shop",
    payeeId: null,
    fromDomains: ["shop.example.com"],
    subjectContains: [],
    definition: definition(),
    status: "draft",
    source: "manual",
    approvedAt: null,
    revision: 3,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-09-02T00:00:00Z"),
    ...over,
  });

function setup() {
  const parserRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    findOneByOrFail: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn((v: Partial<EmailReceiptParser>) =>
      Object.assign(new EmailReceiptParser(), v),
    ),
    save: jest.fn(async (v: EmailReceiptParser) =>
      Object.assign(v, {
        id: "p-new",
        revision: 1,
        createdAt: new Date("2026-09-30T00:00:00Z"),
        updatedAt: new Date("2026-09-30T00:00:00Z"),
      }),
    ),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const categoryRepo = {
    count: jest.fn().mockImplementation(
      async ({ where }) =>
        // every id asked for is owned, unless a spec says otherwise
        (where.id._value as string[]).length,
    ),
  };
  const payeeRepo = {
    count: jest.fn().mockResolvedValue(1),
    findOne: jest.fn(),
  };
  const receiptRepo = { findOne: jest.fn(), count: jest.fn(), find: jest.fn() };
  const requests = {
    enqueueParserDraft: jest.fn(),
    markParserDraftApplied: jest.fn().mockResolvedValue(0),
    dismissParserDraftsFor: jest.fn().mockResolvedValue(0),
  };
  const { manager, dataSource } = createScopedDbMocks([
    [EmailReceiptParser, parserRepo],
    [Category, categoryRepo],
    [Payee, payeeRepo],
    [EmailReceipt, receiptRepo],
  ]);
  const service = new EmailReceiptParsersService(
    dataSource as never,
    requests as never,
  );
  return {
    service,
    manager,
    parserRepo,
    categoryRepo,
    payeeRepo,
    receiptRepo,
    requests,
  };
}

const createDto = (over: Record<string, unknown> = {}) =>
  ({
    name: "Shop",
    fromDomains: [
      "shop.example.com",
      "shop.example.com",
      "mail.shop.example.com",
    ],
    definition: definition(),
    ...over,
  }) as never;

describe("EmailReceiptParsersService.create", () => {
  it("saves a manual parser as approved, de-duplicating domains", async () => {
    const { service, parserRepo } = setup();
    const view = await service.create(USER, createDto());
    const saved = parserRepo.save.mock.calls[0][0] as EmailReceiptParser;
    expect(saved).toMatchObject({
      userId: USER,
      name: "Shop",
      status: "approved",
      source: "manual",
      fromDomains: ["shop.example.com", "mail.shop.example.com"],
      subjectContains: [],
    });
    expect(saved.approvedAt).toBeInstanceOf(Date);
    expect(view).toMatchObject({
      id: "p-new",
      status: "approved",
      definitionValid: true,
      definitionErrors: [],
    });
  });

  it("checks the user owns every category, in the write's transaction", async () => {
    const { service, categoryRepo, parserRepo, manager } = setup();
    await service.create(
      USER,
      createDto({
        definition: definition({
          categoryRules: [{ match: "*x*", categoryId: CAT_B }],
        }),
      }),
    );
    const where = categoryRepo.count.mock.calls[0][0].where;
    expect(where.userId).toBe(USER);
    expect(where.id._value).toEqual([CAT_B, CAT_A]);
    // checked before the write, inside the same transaction
    expect(categoryRepo.count.mock.invocationCallOrder[0]).toBeLessThan(
      parserRepo.save.mock.invocationCallOrder[0],
    );
    expect(manager.getRepository).toHaveBeenCalled();
  });

  it("refuses a category that is not the user's and writes nothing", async () => {
    const { service, categoryRepo, parserRepo } = setup();
    categoryRepo.count.mockResolvedValue(0);
    await expect(service.create(USER, createDto())).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(parserRepo.save).not.toHaveBeenCalled();
  });

  it("refuses a payee that is not the user's and writes nothing", async () => {
    const { service, payeeRepo, parserRepo } = setup();
    payeeRepo.count.mockResolvedValue(0);
    await expect(
      service.create(USER, createDto({ payeeId: "payee-x" })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(payeeRepo.count).toHaveBeenCalledWith({
      where: { id: "payee-x", userId: USER },
    });
    expect(parserRepo.save).not.toHaveBeenCalled();
  });

  it("lists every code of an invalid definition in the 400, and opens no transaction", async () => {
    const { service, manager } = setup();
    const error = await service
      .create(
        USER,
        createDto({
          definition: { version: 2, total: ["no capture"], bogus: 1 },
        }),
      )
      .catch((e) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.message).toContain("bogus: unknown_key");
    expect(error.message).toContain("total[0]: capture_missing");
    expect(manager.getRepository).not.toHaveBeenCalled();
  });

  it("reports a definition restored as {} as invalid rather than crashing", async () => {
    const { service } = setup();
    const error = await service
      .create(USER, createDto({ definition: {} }))
      .catch((e) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.message).toContain("version: unsupported_version");
  });

  it("refuses beyond the cap", async () => {
    const { service, parserRepo } = setup();
    parserRepo.count.mockResolvedValue(MAX_PARSERS_PER_USER);
    await expect(service.create(USER, createDto())).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(parserRepo.save).not.toHaveBeenCalled();
  });
});

describe("EmailReceiptParsersService reads", () => {
  it("lists the user's parsers, flagging a {} definition as invalid", async () => {
    const { service, parserRepo } = setup();
    parserRepo.find.mockResolvedValue([
      stored(),
      stored({ id: "p2", definition: {} }),
    ]);
    const views = await service.list(USER);
    expect(parserRepo.find.mock.calls[0][0].where).toEqual({ userId: USER });
    expect(views.map((v) => v.definitionValid)).toEqual([true, false]);
    expect(views[1].definitionErrors.map((e) => e.code)).toContain(
      "unsupported_version",
    );
  });

  it("gets one, or 404s for a parser that is not the user's", async () => {
    const { service, parserRepo } = setup();
    parserRepo.findOne.mockResolvedValueOnce(stored());
    await expect(service.get(USER, "p1")).resolves.toMatchObject({ id: "p1" });
    expect(parserRepo.findOne).toHaveBeenCalledWith({
      where: { id: "p1", userId: USER },
    });
    parserRepo.findOne.mockResolvedValueOnce(null);
    await expect(service.get(USER, "p1")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe("EmailReceiptParsersService.update", () => {
  const dto = (over: Record<string, unknown> = {}) =>
    ({ expectedRevision: 3, ...over }) as never;

  it("changes what was sent under the row lock and bumps the revision", async () => {
    const { service, parserRepo } = setup();
    parserRepo.findOne.mockResolvedValue(stored());
    parserRepo.findOneByOrFail.mockResolvedValue(
      stored({ revision: 4, name: "New" }),
    );

    const view = await service.update(
      USER,
      "p1",
      dto({
        name: "New",
        definition: definition({ shipping: ["Shipping: {amount}"] }),
      }),
    );

    expect(parserRepo.findOne).toHaveBeenCalledWith({
      where: { id: "p1", userId: USER },
      lock: { mode: "pessimistic_write" },
    });
    const [where, patch] = parserRepo.update.mock.calls[0];
    expect(where).toEqual({ id: "p1", userId: USER });
    expect(patch.name).toBe("New");
    expect(patch.definition).toMatchObject({
      shipping: ["Shipping: {amount}"],
    });
    expect(patch.revision()).toBe("revision + 1");
    expect(patch).not.toHaveProperty("fromDomains");
    expect(patch).not.toHaveProperty("status");
    expect(view.revision).toBe(4);
  });

  it("is a 409 when the parser moved on, and writes nothing", async () => {
    const { service, parserRepo } = setup();
    parserRepo.findOne.mockResolvedValue(stored({ revision: 5 }));
    await expect(
      service.update(USER, "p1", dto({ name: "New" })),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(parserRepo.update).not.toHaveBeenCalled();
  });

  it("is a 404 for a missing parser, before any revision talk", async () => {
    const { service, parserRepo } = setup();
    parserRepo.findOne.mockResolvedValue(null);
    await expect(service.update(USER, "p1", dto())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("validates a new definition and refuses a bad one before locking", async () => {
    const { service, parserRepo } = setup();
    await expect(
      service.update(USER, "p1", dto({ definition: {} })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(parserRepo.findOne).not.toHaveBeenCalled();
  });

  it("checks a new payee and new categories are the user's, and writes nothing otherwise", async () => {
    const { service, parserRepo, payeeRepo, categoryRepo } = setup();
    parserRepo.findOne.mockResolvedValue(stored());
    payeeRepo.count.mockResolvedValue(0);
    await expect(
      service.update(USER, "p1", dto({ payeeId: "payee-x" })),
    ).rejects.toBeInstanceOf(BadRequestException);
    payeeRepo.count.mockResolvedValue(1);
    categoryRepo.count.mockResolvedValue(0);
    await expect(
      service.update(USER, "p1", dto({ definition: definition() })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(parserRepo.update).not.toHaveBeenCalled();
  });

  it("does not re-check a payee that did not change, and can clear it", async () => {
    const { service, parserRepo, payeeRepo } = setup();
    parserRepo.findOne.mockResolvedValue(stored({ payeeId: "payee-1" }));
    parserRepo.findOneByOrFail.mockResolvedValue(stored());
    await service.update(USER, "p1", dto({ payeeId: "payee-1" }));
    expect(payeeRepo.count).not.toHaveBeenCalled();
    await service.update(USER, "p1", dto({ payeeId: null }));
    expect(parserRepo.update.mock.calls[1][1].payeeId).toBeNull();
  });
});

describe("EmailReceiptParsersService.approve", () => {
  it("approves a valid draft, stamping the time and bumping the revision", async () => {
    const { service, parserRepo } = setup();
    parserRepo.findOne.mockResolvedValue(stored());
    parserRepo.findOneByOrFail.mockResolvedValue(
      stored({ status: "approved", revision: 4, approvedAt: new Date() }),
    );
    const view = await service.approve(USER, "p1");
    const [, patch] = parserRepo.update.mock.calls[0];
    expect(patch.status).toBe("approved");
    expect(patch.approvedAt).toBeInstanceOf(Date);
    expect(patch.revision()).toBe("revision + 1");
    expect(view.status).toBe("approved");
  });

  it("marks the parser-draft request that proposed it applied, in the approving transaction", async () => {
    const { service, parserRepo, requests, manager } = setup();
    parserRepo.findOne.mockResolvedValue(stored());
    parserRepo.findOneByOrFail.mockResolvedValue(
      stored({ status: "approved", revision: 4 }),
    );

    await service.approve(USER, "p1");

    expect(requests.markParserDraftApplied).toHaveBeenCalledWith(
      manager,
      USER,
      "p1",
    );
    // after the status UPDATE, before the row is read back
    expect(parserRepo.update.mock.invocationCallOrder[0]).toBeLessThan(
      requests.markParserDraftApplied.mock.invocationCallOrder[0],
    );
  });

  it("does not touch a request when the approval is refused or a no-op", async () => {
    const { service, parserRepo, requests, categoryRepo } = setup();
    parserRepo.findOne.mockResolvedValue(stored({ status: "approved" }));
    await service.approve(USER, "p1");
    parserRepo.findOne.mockResolvedValue(stored({ definition: {} }));
    await service.approve(USER, "p1").catch(() => undefined);
    parserRepo.findOne.mockResolvedValue(stored());
    categoryRepo.count.mockResolvedValue(0);
    await service.approve(USER, "p1").catch(() => undefined);
    parserRepo.findOne.mockResolvedValue(stored({ revision: 9 }));
    await service
      .approve(USER, "p1", { expectedRevision: 3 })
      .catch(() => undefined);

    expect(requests.markParserDraftApplied).not.toHaveBeenCalled();
  });

  it("refuses to approve a definition that is not valid (a {} restored from a backup)", async () => {
    const { service, parserRepo } = setup();
    parserRepo.findOne.mockResolvedValue(stored({ definition: {} }));
    const error = await service.approve(USER, "p1").catch((e) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.message).toContain("unsupported_version");
    expect(parserRepo.update).not.toHaveBeenCalled();
  });

  it("refuses a draft whose category is gone since it was written", async () => {
    const { service, parserRepo, categoryRepo } = setup();
    parserRepo.findOne.mockResolvedValue(stored());
    categoryRepo.count.mockResolvedValue(0);
    await expect(service.approve(USER, "p1")).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(parserRepo.update).not.toHaveBeenCalled();
  });

  it("is a 409 when the approval was of another revision", async () => {
    const { service, parserRepo } = setup();
    parserRepo.findOne.mockResolvedValue(stored({ revision: 5 }));
    await expect(
      service.approve(USER, "p1", { expectedRevision: 3 }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(parserRepo.update).not.toHaveBeenCalled();
  });

  it("approving an approved parser changes nothing", async () => {
    const { service, parserRepo } = setup();
    parserRepo.findOne.mockResolvedValue(stored({ status: "approved" }));
    const view = await service.approve(USER, "p1");
    expect(parserRepo.update).not.toHaveBeenCalled();
    expect(view.status).toBe("approved");
  });

  it("is a 404 for a parser that is not the user's", async () => {
    const { service, parserRepo } = setup();
    parserRepo.findOne.mockResolvedValue(null);
    await expect(service.approve(USER, "p1")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe("EmailReceiptParsersService.remove", () => {
  it("deletes by id and owner, or 404s", async () => {
    const { service, parserRepo } = setup();
    await service.remove(USER, "p1");
    expect(parserRepo.delete).toHaveBeenCalledWith({ id: "p1", userId: USER });
    parserRepo.delete.mockResolvedValue({ affected: 0 });
    await expect(service.remove(USER, "p1")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("dismisses the parser-draft requests that proposed it, in the same transaction", async () => {
    const { service, requests, manager } = setup();
    await service.remove(USER, "p1");
    expect(requests.dismissParserDraftsFor).toHaveBeenCalledWith(
      manager,
      USER,
      "p1",
    );
  });

  it("dismisses nothing for a parser that was not there", async () => {
    const { service, parserRepo, requests } = setup();
    parserRepo.delete.mockResolvedValue({ affected: 0 });
    await service.remove(USER, "p1").catch(() => undefined);
    expect(requests.dismissParserDraftsFor).not.toHaveBeenCalled();
  });
});

describe("dominantSenderDomain", () => {
  it("is the most common non-empty domain, the first one winning a tie", () => {
    expect(dominantSenderDomain(["a.example", "b.example", "b.example"])).toBe(
      "b.example",
    );
    expect(dominantSenderDomain(["a.example", "b.example"])).toBe("a.example");
    expect(dominantSenderDomain(["", "b.example"])).toBe("b.example");
    expect(dominantSenderDomain(["", ""])).toBe("");
    expect(dominantSenderDomain([])).toBe("");
  });
});

describe("EmailReceiptParsersService.requestAiDraft", () => {
  const R1 = "00000000-0000-4000-8000-000000000001";
  const R2 = "00000000-0000-4000-8000-000000000002";
  const row = (id: string, fromDomain: string, status = "no_parser") => ({
    id,
    fromDomain,
    status,
  });

  it("queues one pending request for the emails, filed under their sender, and calls no provider", async () => {
    const { service, receiptRepo, requests, manager } = setup();
    receiptRepo.find.mockResolvedValue([
      row(R1, "shop.example.com"),
      row(R2, "shop.example.com"),
    ]);
    requests.enqueueParserDraft.mockResolvedValue({ id: "req-1" });

    const result = await service.requestAiDraft(USER, [R2, R1]);

    expect(result).toEqual({ ok: true, requestId: "req-1" });
    expect(requests.enqueueParserDraft).toHaveBeenCalledWith(manager, USER, {
      emailReceiptIds: [R2, R1],
      parserDomain: "shop.example.com",
      instruction: RECEIPT_PARSER_DRAFT_INSTRUCTION,
    });
    // the emails are read through the user's own scope
    expect(receiptRepo.find.mock.calls[0][0].where.userId).toBe(USER);
  });

  it("files a mixed selection under the most common sender", async () => {
    const { service, receiptRepo, requests } = setup();
    receiptRepo.find.mockResolvedValue([
      row(R1, "a.example.com"),
      row(R2, "b.example.com"),
      row("r3", "b.example.com"),
    ]);
    requests.enqueueParserDraft.mockResolvedValue({ id: "req-1" });

    await service.requestAiDraft(USER, [R1, R2, "r3"]);

    expect(requests.enqueueParserDraft.mock.calls[0][2].parserDomain).toBe(
      "b.example.com",
    );
  });

  it("is a 404 for an email that is not the user's, and writes nothing", async () => {
    const { service, receiptRepo, requests } = setup();
    receiptRepo.find.mockResolvedValue([row(R1, "shop.example.com")]);

    await expect(service.requestAiDraft(USER, [R1, R2])).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(requests.enqueueParserDraft).not.toHaveBeenCalled();
  });

  it("refuses a skipped email (it has no text), and writes nothing", async () => {
    const { service, receiptRepo, requests } = setup();
    receiptRepo.find.mockResolvedValue([
      row(R1, "shop.example.com"),
      row(R2, "", "skipped"),
    ]);

    await expect(service.requestAiDraft(USER, [R1, R2])).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(requests.enqueueParserDraft).not.toHaveBeenCalled();
  });

  it("refuses a selection with no usable sender domain", async () => {
    const { service, receiptRepo, requests } = setup();
    receiptRepo.find.mockResolvedValue([row(R1, "")]);

    await expect(service.requestAiDraft(USER, [R1])).rejects.toBeInstanceOf(
      BadRequestException,
    );
    receiptRepo.find.mockResolvedValue([row(R1, "localhost")]);
    await expect(service.requestAiDraft(USER, [R1])).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(requests.enqueueParserDraft).not.toHaveBeenCalled();
  });
});

describe("EmailReceiptParsersService.test", () => {
  const receipt = Object.assign(new EmailReceipt(), {
    id: "r1",
    userId: USER,
    subject: "Order #ABCD1234",
    bodyText: "Order number: ABCD1234\nOrder total: 37.97",
    receivedAt: new Date("2026-09-10T10:00:00Z"),
  });
  const testDto = (over: Record<string, unknown> = {}) =>
    ({
      receiptId: "r1",
      definition: {
        version: 2,
        orderId: ["Order number: {orderid}"],
        total: ["Order total: {amount}"],
      },
      ...over,
    }) as never;

  it("reads the stored email and previews the match, writing nothing", async () => {
    const { service, manager, receiptRepo, parserRepo } = setup();
    receiptRepo.findOne.mockResolvedValue(receipt);
    manager.query.mockResolvedValue([
      {
        id: "t1",
        transaction_date: "2026-09-11",
        amount: "-37.9700",
        payee_id: null,
        payee_name: "Shop",
        description: "Order ABCD1234",
        reference_number: null,
      },
    ]);

    const result = await service.test(USER, testDto());

    expect(result.parsed).toMatchObject({ orderId: "ABCD1234", total: 379700 });
    expect(result.outcome).toBe("read");
    expect(result.trace.total).toEqual({
      entry: 0,
      pattern: "Order total: {amount}",
      line: { line: 2, text: "Order total: 37.97" },
    });
    expect(result.match).toEqual({
      kind: "matched",
      transactionId: "t1",
      matchKind: "order_id",
    });
    expect(result.candidateCount).toBe(1);
    expect(result.transaction).toEqual({
      id: "t1",
      date: "2026-09-11",
      amount: -37.97,
      payeeName: "Shop",
    });
    expect(parserRepo.save).not.toHaveBeenCalled();
    expect(parserRepo.update).not.toHaveBeenCalled();
    // every statement it ran is a read
    for (const [sql] of manager.query.mock.calls) {
      expect(String(sql).trim()).toMatch(/^SELECT/);
    }
  });

  describe("the lines source", () => {
    const html =
      "<table><tr><td>Order number:</td><td>HTML-7777</td></tr>" +
      "<tr><td>Wrapped product name that the text splits</td><td>12,00 zł</td></tr>" +
      "<tr><td>Razem</td><td>12,00 zł</td></tr></table>";
    const htmlDefinition = (source?: string) => ({
      version: 2,
      ...(source === undefined ? {} : { source }),
      orderId: [{ label: "Order number:", value: "{orderid}" }],
      total: [{ label: "Razem", value: "{amount} zł" }],
    });

    it("reads the HTML lines for source html, and the trace numbers those lines", async () => {
      const { service, manager, receiptRepo } = setup();
      receiptRepo.findOne.mockResolvedValue(
        Object.assign(new EmailReceipt(), receipt, { bodyHtml: html }),
      );
      manager.query.mockResolvedValue([]);
      const result = await service.test(
        USER,
        testDto({ definition: htmlDefinition("html") }),
      );
      expect(result.outcome).toBe("read");
      expect(result.parsed).toMatchObject({
        orderId: "HTML-7777",
        total: 120000,
      });
      expect(result.trace.total?.labelLine).toEqual({
        line: 5,
        text: "Razem",
      });
      expect(result.trace.total?.line).toEqual({ line: 6, text: "12,00 zł" });
    });

    it("reads the text for source text and for none, even when the email has HTML", async () => {
      const { service, manager, receiptRepo } = setup();
      receiptRepo.findOne.mockResolvedValue(
        Object.assign(new EmailReceipt(), receipt, { bodyHtml: html }),
      );
      manager.query.mockResolvedValue([]);
      for (const source of [undefined, "text"]) {
        const result = await service.test(
          USER,
          testDto({
            definition: {
              version: 2,
              ...(source === undefined ? {} : { source }),
              total: ["Order total: {amount}"],
            },
          }),
        );
        expect(result.parsed.total).toBe(379700);
        expect(result.trace.total?.line).toEqual({
          line: 2,
          text: "Order total: 37.97",
        });
      }
    });

    it("says no_html, and reads nothing, for source html on an email with no HTML part", async () => {
      const { service, manager, receiptRepo } = setup();
      receiptRepo.findOne.mockResolvedValue(
        Object.assign(new EmailReceipt(), receipt, { bodyHtml: null }),
      );
      manager.query.mockResolvedValue([]);
      const result = await service.test(
        USER,
        testDto({ definition: htmlDefinition("html") }),
      );
      expect(result.outcome).toBe("no_html");
      expect(result.parsed).toMatchObject({
        total: null,
        complete: false,
        reason: "no_total",
      });
      expect(result.trace.total).toBeNull();
      expect(result.trace.items).toEqual([]);
    });

    it("refuses an unknown source with the validator's code, before any read", async () => {
      const { service, manager } = setup();
      const error = await service
        .test(USER, testDto({ definition: htmlDefinition("pdf") }))
        .catch((e) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toContain("source");
      expect(manager.getRepository).not.toHaveBeenCalled();
    });
  });

  it("uses the payee's default category as the fallback and as a match signal", async () => {
    const { service, manager, receiptRepo, payeeRepo } = setup();
    receiptRepo.findOne.mockResolvedValue(
      Object.assign(new EmailReceipt(), receipt, {
        bodyText: "Order total: 9.99\nItem: Widget 9.99",
      }),
    );
    payeeRepo.findOne.mockResolvedValue({
      id: "pay1",
      defaultCategoryId: CAT_A,
    });
    manager.query.mockResolvedValue([]);
    const result = await service.test(
      USER,
      testDto({
        payeeId: "pay1",
        definition: {
          version: 2,
          total: ["Order total: {amount}"],
          items: { patterns: ["Item: {name} {amount}"] },
        },
      }),
    );
    expect(result.parsed.items[0]).toMatchObject({ categoryId: CAT_A });
    expect(result.match).toEqual({ kind: "unmatched" });
    expect(result.transaction).toBeNull();
  });

  it("is a 404 for an email or a payee that is not the user's", async () => {
    const { service, receiptRepo, payeeRepo, manager } = setup();
    receiptRepo.findOne.mockResolvedValue(null);
    await expect(service.test(USER, testDto())).rejects.toBeInstanceOf(
      NotFoundException,
    );
    receiptRepo.findOne.mockResolvedValue(receipt);
    payeeRepo.findOne.mockResolvedValue(null);
    await expect(
      service.test(USER, testDto({ payeeId: "nope" })),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(manager.query).not.toHaveBeenCalled();
  });

  it("is a 400 listing the codes for an invalid draft definition, before any read", async () => {
    const { service, manager } = setup();
    const error = await service
      .test(USER, testDto({ definition: {} }))
      .catch((e) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.message).toContain("unsupported_version");
    expect(manager.getRepository).not.toHaveBeenCalled();
  });
});
