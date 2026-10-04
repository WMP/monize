import "reflect-metadata";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { ROUTE_ARGS_METADATA } from "@nestjs/common/constants";
import { ParseUUIDPipe } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { ALLOW_DELEGATE_KEY } from "../../delegation/decorators/delegate-access.decorator";
import {
  AskAiEmailReceiptDto,
  ListEmailReceiptsDto,
  ProcessBatchEmailReceiptsDto,
} from "./dto/email-receipts.dto";
import { EmailReceiptsController } from "./email-receipts.controller";

describe("EmailReceiptsController", () => {
  const req = { user: { id: "user-1" } };
  const receipts = {
    list: jest.fn(),
    listDomains: jest.fn(),
    overview: jest.fn(),
    processBatch: jest.fn(),
    get: jest.fn(),
    reprocess: jest.fn(),
    link: jest.fn(),
    ignore: jest.fn(),
    remove: jest.fn(),
  };
  const ai = { askAi: jest.fn() };
  const controller = new EmailReceiptsController(
    receipts as never,
    ai as never,
  );
  const proto = EmailReceiptsController.prototype as unknown as Record<
    string,
    (...args: never[]) => unknown
  >;
  const ID = "0b9c6b1e-0f3a-4a55-9d57-0c5d3d9f1a11";

  beforeEach(() => jest.clearAllMocks());

  it("lists for the JWT user with the status and limit of the query", async () => {
    receipts.list.mockResolvedValue([]);
    await controller.list(req, { status: "review", limit: 10 } as never);
    expect(receipts.list).toHaveBeenCalledWith("user-1", {
      status: "review",
      limit: 10,
    });
  });

  it("lists with the domain of the query as well, still for the JWT user", async () => {
    receipts.list.mockResolvedValue([]);
    await controller.list(req, {
      status: "review",
      domain: "shop.example.com",
      userId: "someone-else",
    } as never);
    expect(receipts.list).toHaveBeenCalledWith("user-1", {
      status: "review",
      domain: "shop.example.com",
      limit: undefined,
    });
  });

  it("lists the sender domains for the JWT user", async () => {
    receipts.listDomains.mockResolvedValue([
      { domain: "a.example.com", count: 2 },
    ]);
    await expect(controller.domains(req)).resolves.toEqual([
      { domain: "a.example.com", count: 2 },
    ]);
    expect(receipts.listDomains).toHaveBeenCalledWith("user-1");
  });

  it("declares the domains route before :id, so the literal segment is matched first", () => {
    const names = Object.getOwnPropertyNames(EmailReceiptsController.prototype);
    expect(names.indexOf("domains")).toBeGreaterThan(-1);
    expect(names.indexOf("domains")).toBeLessThan(names.indexOf("get"));
    expect(Reflect.getMetadata("path", proto.domains)).toBe("domains");
  });

  describe("the list query", () => {
    const check = async (query: object) => {
      const dto = plainToInstance(ListEmailReceiptsDto, query);
      const errors = await validate(dto, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      return { dto, errors };
    };

    it("accepts no domain, and a host name", async () => {
      expect((await check({})).errors).toHaveLength(0);
      expect((await check({ domain: "shop.example.com" })).errors).toHaveLength(
        0,
      );
    });

    it("lower-cases and trims the domain, drops a leading @ and a trailing dot", async () => {
      const { dto, errors } = await check({ domain: "  @Shop.Example.COM. " });
      expect(errors).toHaveLength(0);
      expect(dto.domain).toBe("shop.example.com");
    });

    it.each([
      "not a domain",
      "nodots",
      "a%.example.com",
      "a_b.example.com",
      "shop.example.com/path",
      "a@b.example.com",
      "x".repeat(250) + ".com",
      "",
      5,
      ["a.example.com"],
    ])("refuses the domain %j", async (domain) => {
      expect((await check({ domain })).errors.length).toBeGreaterThan(0);
    });

    it("refuses a key the query does not have", async () => {
      expect((await check({ userId: "x" })).errors.length).toBeGreaterThan(0);
    });
  });

  it.each([
    ["get", "get"],
    ["reprocess", "reprocess"],
    ["ignore", "ignore"],
    ["remove", "remove"],
  ] as const)("%s acts for the JWT user on the id", async (method, service) => {
    await (controller[method] as (r: unknown, id: string) => Promise<unknown>)(
      req,
      ID,
    );
    expect(receipts[service]).toHaveBeenCalledWith("user-1", ID);
  });

  it("links with the transaction of the body, never a user of the body", async () => {
    await controller.link(req, ID, {
      transactionId: "t1",
      userId: "someone-else",
    } as never);
    expect(receipts.link).toHaveBeenCalledWith("user-1", ID, "t1");
  });

  it("asks the AI with the chosen transaction of the body, never a user of the body", async () => {
    await controller.askAi(req, ID, {
      transactionId: "t1",
      userId: "someone-else",
    } as never);
    expect(ai.askAi).toHaveBeenCalledWith("user-1", ID, "t1");
  });

  it.each([{}, { transactionId: null }, { transactionId: "" }])(
    "asks the AI about the email's own transaction for the body %j",
    async (body) => {
      await controller.askAi(req, ID, body as never);
      expect(ai.askAi).toHaveBeenCalledWith("user-1", ID, null);
    },
  );

  it("answers the overview for the JWT user", async () => {
    receipts.overview.mockResolvedValue({ parsers: { approved: 1, draft: 0 } });
    expect(await controller.overview(req)).toEqual({
      parsers: { approved: 1, draft: 0 },
    });
    expect(receipts.overview).toHaveBeenCalledWith("user-1");
  });

  it("processes in bulk for the JWT user with exactly the fields of the body", async () => {
    receipts.processBatch.mockResolvedValue({ processed: 2 });
    await controller.processBatch(req, {
      domain: "shop.example.com",
      statuses: ["pending"],
      limit: 20,
      since: "2026-10-04T12:00:00.000000Z",
      userId: "someone-else",
    } as never);
    expect(receipts.processBatch).toHaveBeenCalledWith("user-1", {
      domain: "shop.example.com",
      statuses: ["pending"],
      limit: 20,
      since: "2026-10-04T12:00:00.000000Z",
    });
  });

  it("registers overview and process-batch before :id, and throttles the bulk route", () => {
    const names = Object.getOwnPropertyNames(EmailReceiptsController.prototype);
    expect(names.indexOf("overview")).toBeLessThan(names.indexOf("get"));
    expect(names.indexOf("processBatch")).toBeLessThan(names.indexOf("get"));
    expect(
      Reflect.getMetadata("THROTTLER:LIMITdefault", proto.processBatch),
    ).toBe(30);
  });

  describe("the process-batch body", () => {
    const check = async (body: object) =>
      validate(plainToInstance(ProcessBatchEmailReceiptsDto, body), {
        whitelist: true,
        forbidNonWhitelisted: true,
      });

    it.each([
      {},
      { domain: "Shop.Example.com" },
      { statuses: ["pending", "no_parser", "parse_failed"] },
      {
        statuses: [
          "pending",
          "no_parser",
          "parse_failed",
          "unmatched",
          "ambiguous",
          "review_conflict",
        ],
      },
      { limit: 1 },
      { limit: 200 },
      { since: "2026-10-04T12:00:00.123456Z" },
    ])("accepts %j", async (body) => {
      expect(await check(body)).toHaveLength(0);
    });

    it.each([
      { limit: 0 },
      { limit: 201 },
      { limit: 1.5 },
      { limit: "20" },
      { statuses: ["review"] },
      { statuses: ["ignored"] },
      { statuses: ["pending", "pending"] },
      { statuses: "pending" },
      { statuses: [].concat(Array(7).fill("pending") as never) },
      { domain: "not a domain" },
      { domain: "has@sign.example.com" },
      { since: "yesterday" },
      { since: 5 },
      { userId: "x" },
      { unknown: true },
    ])("refuses %j", async (body) => {
      expect((await check(body)).length).toBeGreaterThan(0);
    });
  });

  it("has no synchronous draft-parser route: parsers are drafted through the chat", () => {
    expect(
      (controller as unknown as Record<string, unknown>).draftParser,
    ).toBeUndefined();
  });

  describe("the ask-ai body", () => {
    const check = (body: object) =>
      validate(plainToInstance(AskAiEmailReceiptDto, body), {
        whitelist: true,
        forbidNonWhitelisted: true,
      });

    it.each([
      {},
      { transactionId: null },
      { transactionId: "" },
      { transactionId: ID },
    ])("accepts %j", async (body) => {
      expect(await check(body)).toHaveLength(0);
    });

    it.each([
      { transactionId: "not-a-uuid" },
      { transactionId: 5 },
      { transactionId: ID, userId: "x" },
      { unknown: true },
    ])("refuses %j", async (body) => {
      expect((await check(body)).length).toBeGreaterThan(0);
    });
  });

  it("is under the JWT guard and refuses a delegate session on every route", () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, EmailReceiptsController),
    ).toHaveLength(1);
    expect(
      Reflect.getMetadata(ALLOW_DELEGATE_KEY, EmailReceiptsController),
    ).toBe(false);
    for (const name of Object.getOwnPropertyNames(
      EmailReceiptsController.prototype,
    )) {
      if (name === "constructor") continue;
      expect(Reflect.getMetadata(ALLOW_DELEGATE_KEY, proto[name])).not.toBe(
        true,
      );
    }
  });

  it("parses every :id with ParseUUIDPipe", () => {
    const routes = Object.getOwnPropertyNames(
      EmailReceiptsController.prototype,
    ).filter(
      (name) =>
        ![
          "constructor",
          "list",
          "domains",
          "overview",
          "processBatch",
        ].includes(name),
    );
    expect(routes).toHaveLength(6);
    for (const name of routes) {
      const args = Reflect.getMetadata(
        ROUTE_ARGS_METADATA,
        EmailReceiptsController,
        name,
      ) as Record<string, { data?: string; pipes: unknown[] }>;
      const idArg = Object.values(args).find((a) => a.data === "id");
      expect(idArg).toBeDefined();
      expect(idArg?.pipes).toContain(ParseUUIDPipe);
    }
  });

  it("throttles the AI routes tightly", () => {
    const limitOf = (name: string) =>
      Reflect.getMetadata("THROTTLER:LIMITdefault", proto[name]) as
        | number
        | undefined;
    expect(limitOf("askAi")).toBe(10);
  });
});
