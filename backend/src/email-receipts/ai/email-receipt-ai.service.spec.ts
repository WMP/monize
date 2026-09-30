import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { AiService } from "../../ai/ai.service";
import type { AiCompletionResponse } from "../../ai/providers/ai-provider.interface";
import { AiReviewRequest } from "../../ai-review/ai-review-request.entity";
import type { AiReviewRequestsService } from "../../ai-review/ai-review-requests.service";
import type { AiReviewWorkService } from "../../ai-review/ai-review-work.service";
import type { AiReviewSubmitResult } from "../../ai-review/ai-review-work.types";
import { Category } from "../../categories/entities/category.entity";
import { Payee } from "../../payees/entities/payee.entity";
import { createScopedDbMocks } from "../../test-helpers/scoped-db-testing";
import { Transaction } from "../../transactions/entities/transaction.entity";
import type { TransactionsService } from "../../transactions/transactions.service";
import { EmailReceiptMailbox } from "../entities/email-receipt-mailbox.entity";
import { EmailReceiptParser } from "../entities/email-receipt-parser.entity";
import { EmailReceipt } from "../entities/email-receipt.entity";
import { MAX_PARSERS_PER_USER } from "../parsers/email-receipt-parsers.service";
import {
  AUTOMATIC_AI_CALLS_PER_TICK,
  AUTOMATIC_DRAFTS_PER_TICK,
  buildReviewInput,
  EmailReceiptAiService,
} from "./email-receipt-ai.service";

jest.mock("../../common/db/scoped-db", () =>
  jest
    .requireActual("../../test-helpers/scoped-db-testing")
    .scopedDbMockModule(),
);

const USER = "user-1";
const RECEIPT = "receipt-1";
const REQUEST = "request-1";
const TX = "tx-1";
const CAT_BOOKS = "11111111-1111-4111-8111-111111111111";
const CAT_SHIPPING = "22222222-2222-4222-8222-222222222222";
const SECRET_TEXT = "my card number is 4111111111111111";

const categories = new Map([
  [CAT_BOOKS, "Books"],
  [CAT_SHIPPING, "Shipping"],
]);

const receiptRow = (over: Partial<EmailReceipt> = {}): EmailReceipt =>
  Object.assign(new EmailReceipt(), {
    id: RECEIPT,
    userId: USER,
    mailboxId: "mb-1",
    fromAddress: "orders@shop.example.com",
    fromDomain: "shop.example.com",
    subject: "Your order from ann@example.com",
    bodyText: `Order total: 15.00\nWrite to ann@example.com\n${SECRET_TEXT}`,
    status: "no_parser",
    transactionId: TX,
    aiReviewRequestId: null,
    ...over,
  });

const mailboxRow = (aiMode: "off" | "on_demand" | "automatic") =>
  Object.assign(new EmailReceiptMailbox(), { id: "mb-1", aiMode });

const requestRow = (over: Partial<AiReviewRequest> = {}): AiReviewRequest =>
  Object.assign(new AiReviewRequest(), {
    id: REQUEST,
    userId: USER,
    kind: "email_receipt",
    emailReceiptId: RECEIPT,
    transactionId: TX,
    status: "pending",
    ...over,
  });

const transaction = (over: Record<string, unknown> = {}) =>
  Object.assign(new Transaction(), {
    id: TX,
    amount: -15,
    currencyCode: "USD",
    transactionDate: "2026-09-11",
    payeeName: "Shop",
    description: "CARD PURCHASE",
    isTransfer: false,
    ...over,
  });

const reply = (content: string): AiCompletionResponse => ({
  content,
  usage: { inputTokens: 1, outputTokens: 1 },
  model: "m",
  provider: "p",
});

const validDefinition = {
  version: 1,
  total: ["Order total: {amount}"],
  defaultCategoryId: CAT_BOOKS,
};

interface World {
  receipt: EmailReceipt | null;
  aiMode: "off" | "on_demand" | "automatic";
}

function setup(over: Partial<World> = {}) {
  const world: World = { receipt: receiptRow(), aiMode: "on_demand", ...over };
  const receiptRepo = {
    findOne: jest.fn(async () => world.receipt),
    count: jest.fn(async () => (world.receipt ? 1 : 0)),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const mailboxRepo = {
    findOne: jest.fn(async () => mailboxRow(world.aiMode)),
  };
  const parserRepo = {
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
  };
  const categoryRepo = {
    find: jest.fn(async () =>
      [...categories].map(([id, name]) => ({ id, name, parentId: null })),
    ),
    count: jest.fn(async ({ where }) => (where.id._value as string[]).length),
  };
  const payeeRepo = { count: jest.fn() };
  const { manager, dataSource } = createScopedDbMocks([
    [EmailReceipt, receiptRepo],
    [EmailReceiptMailbox, mailboxRepo],
    [EmailReceiptParser, parserRepo],
    [Category, categoryRepo],
    [Payee, payeeRepo],
  ]);
  manager.query.mockResolvedValue([]);

  const ai = {
    complete: jest.fn(async () => reply("{}")),
  } as unknown as jest.Mocked<AiService>;
  const requests = {
    getForUser: jest.fn(async () => requestRow() as AiReviewRequest | null),
    claimById: jest.fn(
      async () => requestRow({ status: "claimed" }) as AiReviewRequest | null,
    ),
    release: jest.fn(async () => null),
    enqueuePendingForReceipt: jest.fn(
      async () => requestRow({ id: "request-new" }) as AiReviewRequest | null,
    ),
  } as unknown as jest.Mocked<AiReviewRequestsService>;
  const work = {
    submit: jest.fn(async () => ({}) as AiReviewSubmitResult),
  } as unknown as jest.Mocked<AiReviewWorkService>;
  const transactions = {
    findOne: jest.fn(async () => transaction()),
  } as unknown as jest.Mocked<TransactionsService>;

  const service = new EmailReceiptAiService(
    dataSource as never,
    ai,
    requests,
    work,
    transactions,
  );
  return {
    world,
    service,
    manager,
    receiptRepo,
    parserRepo,
    categoryRepo,
    ai,
    requests,
    work,
    transactions,
  };
}

describe("AI mode off never calls the AI", () => {
  it("draftParser is refused with a 400 before any provider call", async () => {
    const h = setup({ aiMode: "off" });
    await expect(h.service.draftParser(USER, RECEIPT)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(h.ai.complete).not.toHaveBeenCalled();
    expect(h.parserRepo.save).not.toHaveBeenCalled();
  });

  it("askAi is refused with a 400, nothing is dismissed or queued", async () => {
    const h = setup({ aiMode: "off" });
    await expect(h.service.askAi(USER, RECEIPT)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(h.ai.complete).not.toHaveBeenCalled();
    expect(h.requests.enqueuePendingForReceipt).not.toHaveBeenCalled();
    expect(h.receiptRepo.update).not.toHaveBeenCalled();
    expect(h.manager.query).not.toHaveBeenCalled();
  });

  it("processAiRequest answers ai_off without claiming the request or calling the AI", async () => {
    const h = setup({ aiMode: "off" });
    await expect(h.service.processAiRequest(USER, REQUEST)).resolves.toEqual({
      ok: false,
      requestId: REQUEST,
      reason: "ai_off",
    });
    expect(h.requests.claimById).not.toHaveBeenCalled();
    expect(h.ai.complete).not.toHaveBeenCalled();
    expect(h.work.submit).not.toHaveBeenCalled();
  });

  it("the automatic step with nothing to do calls nothing", async () => {
    const h = setup({ aiMode: "off" });
    await expect(h.service.runAutomaticStep(USER)).resolves.toEqual({
      proposed: 0,
      failed: 0,
      drafted: 0,
    });
    expect(h.ai.complete).not.toHaveBeenCalled();
  });
});

describe("EmailReceiptAiService.draftParser", () => {
  it("drafts a parser for the sender: a draft from the AI, never approved", async () => {
    const h = setup();
    h.ai.complete.mockResolvedValue(
      reply(
        "Here you go:\n```json\n" + JSON.stringify(validDefinition) + "\n```",
      ),
    );

    const view = await h.service.draftParser(USER, RECEIPT);

    const saved = h.parserRepo.save.mock.calls[0][0] as EmailReceiptParser;
    expect(saved).toMatchObject({
      userId: USER,
      name: "shop.example.com",
      fromDomains: ["shop.example.com"],
      subjectContains: [],
      payeeId: null,
      status: "draft",
      source: "ai",
      approvedAt: null,
    });
    expect(saved.definition).toEqual(validDefinition);
    expect(view).toMatchObject({ id: "p-new", status: "draft", source: "ai" });
  });

  it("calls the provider once, for the parser feature, asking for JSON, with the email as redacted data", async () => {
    const h = setup();
    h.ai.complete.mockResolvedValue(reply(JSON.stringify(validDefinition)));
    await h.service.draftParser(USER, RECEIPT);

    expect(h.ai.complete).toHaveBeenCalledTimes(1);
    const [userArg, request, feature] = h.ai.complete.mock.calls[0];
    expect(userArg).toBe(USER);
    expect(feature).toBe("email_receipt_parser");
    expect(request.responseFormat).toBe("json");
    const content = request.messages[0].content;
    expect(content).toContain(`${CAT_BOOKS}: Books`);
    expect(content).toContain("<email>");
    expect(content).toContain("1: Order total: 15.00");
    expect(content).not.toContain("ann@example.com");
    expect(content).toContain("[email]");
    expect(request.systemPrompt).toMatch(/untrusted data/);
  });

  it("reads a version-less answer as version 1", async () => {
    const h = setup();
    const { version: _v, ...noVersion } = validDefinition;
    h.ai.complete.mockResolvedValue(reply(JSON.stringify(noVersion)));
    await h.service.draftParser(USER, RECEIPT);
    expect(
      (h.parserRepo.save.mock.calls[0][0] as EmailReceiptParser).definition,
    ).toMatchObject({ version: 1 });
  });

  it("an answer that is not JSON is a 422, and nothing is saved", async () => {
    const h = setup();
    h.ai.complete.mockResolvedValue(reply("I cannot help with that"));
    await expect(h.service.draftParser(USER, RECEIPT)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(h.parserRepo.save).not.toHaveBeenCalled();
  });

  it("an answer the validator refuses is a 422 naming the codes", async () => {
    const h = setup();
    h.ai.complete.mockResolvedValue(
      reply(JSON.stringify({ version: 1, total: ["no capture"], extra: true })),
    );
    const error = await h.service.draftParser(USER, RECEIPT).catch((e) => e);
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect(error.message).toContain("total[0]: capture_missing");
    expect(error.message).toContain("extra: unknown_key");
    expect(h.parserRepo.save).not.toHaveBeenCalled();
  });

  it("a category id the user does not have is a 422", async () => {
    const h = setup();
    h.ai.complete.mockResolvedValue(
      reply(
        JSON.stringify({
          ...validDefinition,
          defaultCategoryId: "33333333-3333-4333-8333-333333333333",
        }),
      ),
    );
    await expect(h.service.draftParser(USER, RECEIPT)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(h.parserRepo.save).not.toHaveBeenCalled();
  });

  it("an email with no usable sender domain is a 400 before any provider call", async () => {
    const h = setup({ receipt: receiptRow({ fromDomain: "" }) });
    await expect(h.service.draftParser(USER, RECEIPT)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(h.ai.complete).not.toHaveBeenCalled();
  });

  it("is a 404 for an email that is not the user's", async () => {
    const h = setup({ receipt: null });
    await expect(h.service.draftParser(USER, RECEIPT)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(h.ai.complete).not.toHaveBeenCalled();
  });

  it("refuses beyond the parser cap, saving nothing", async () => {
    const h = setup();
    h.parserRepo.count.mockResolvedValue(MAX_PARSERS_PER_USER);
    h.ai.complete.mockResolvedValue(reply(JSON.stringify(validDefinition)));
    await expect(h.service.draftParser(USER, RECEIPT)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(h.parserRepo.save).not.toHaveBeenCalled();
  });

  it("lets a provider failure through untouched", async () => {
    const h = setup();
    h.ai.complete.mockRejectedValue(
      new BadRequestException("No active AI providers"),
    );
    await expect(h.service.draftParser(USER, RECEIPT)).rejects.toThrow(
      "No active AI providers",
    );
  });
});

describe("EmailReceiptAiService.askAi", () => {
  const happy = () => {
    const h = setup({
      receipt: receiptRow({
        status: "review",
        aiReviewRequestId: "request-old",
      }),
    });
    // processAiRequest's own reads
    h.requests.getForUser.mockResolvedValue(requestRow({ id: "request-new" }));
    h.manager.query.mockImplementation(async (sql: string) =>
      String(sql).includes("SELECT status FROM ai_review_requests")
        ? [{ status: "proposed" }]
        : [],
    );
    h.ai.complete.mockResolvedValue(
      reply(JSON.stringify({ categoryName: "Books" })),
    );
    return h;
  };

  it("dismisses the open request, queues a pending one, points the receipt at it, then answers it", async () => {
    const h = happy();
    const outcome = await h.service.askAi(USER, RECEIPT);

    const sqls = h.manager.query.mock.calls.map((c) => String(c[0]));
    const advisory = sqls.findIndex((s) => s.includes("pg_advisory_xact_lock"));
    const close = sqls.findIndex((s) => s.includes("SET status = 'rejected'"));
    expect(advisory).toBeGreaterThanOrEqual(0);
    expect(close).toBeGreaterThan(advisory);
    expect(h.requests.enqueuePendingForReceipt).toHaveBeenCalledWith(
      expect.anything(),
      USER,
      expect.objectContaining({ transactionId: TX, emailReceiptId: RECEIPT }),
    );
    expect(h.receiptRepo.update).toHaveBeenCalledWith(
      { id: RECEIPT, userId: USER },
      {
        status: "review",
        statusReason: null,
        aiReviewRequestId: "request-new",
      },
    );
    expect(h.requests.claimById).toHaveBeenCalledWith(
      USER,
      "request-new",
      "email-receipts-ai",
    );
    expect(h.work.submit).toHaveBeenCalledWith(
      USER,
      "email-receipts-ai",
      "request-new",
      { categoryName: "Books" },
    );
    expect(outcome).toEqual({ ok: true, requestId: "request-new" });
  });

  it("refuses an email with no transaction, changing nothing", async () => {
    const h = setup({ receipt: receiptRow({ transactionId: null }) });
    await expect(h.service.askAi(USER, RECEIPT)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(h.ai.complete).not.toHaveBeenCalled();
    expect(h.receiptRepo.update).not.toHaveBeenCalled();
  });

  it.each(["skipped", "ignored"] as const)(
    "refuses a %s email",
    async (status) => {
      const h = setup({ receipt: receiptRow({ status }) });
      await expect(h.service.askAi(USER, RECEIPT)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(h.requests.enqueuePendingForReceipt).not.toHaveBeenCalled();
    },
  );

  it("refuses when the proposal was already applied, dismissing nothing", async () => {
    const h = setup({
      receipt: receiptRow({
        status: "review",
        aiReviewRequestId: "request-old",
      }),
    });
    h.manager.query.mockResolvedValue([{ status: "applied" }]);
    await expect(h.service.askAi(USER, RECEIPT)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(
      h.manager.query.mock.calls.some((c) =>
        String(c[0]).includes("SET status = 'rejected'"),
      ),
    ).toBe(false);
  });

  it("an open request somebody else raised for the transaction is a 409, and the dismissal rolls back with it", async () => {
    const h = setup({
      receipt: receiptRow({
        status: "review",
        aiReviewRequestId: "request-old",
      }),
    });
    h.requests.enqueuePendingForReceipt.mockResolvedValue(null);
    await expect(h.service.askAi(USER, RECEIPT)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(h.receiptRepo.update).not.toHaveBeenCalled();
    expect(h.ai.complete).not.toHaveBeenCalled();
  });

  it("is a 404 for an email that is not the user's", async () => {
    const h = setup({ receipt: null });
    await expect(h.service.askAi(USER, RECEIPT)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe("EmailReceiptAiService.processAiRequest", () => {
  const answer = (value: unknown) => JSON.stringify(value);

  it("claims under its own key, asks once for the review feature, and submits what the AI proposed", async () => {
    const h = setup();
    h.ai.complete.mockResolvedValue(
      reply(
        answer({
          splits: [
            { categoryName: "books", amount: -12, memo: "Widget" },
            { categoryName: "Shipping", amount: -3 },
          ],
          description: "Order ABC",
        }),
      ),
    );

    const outcome = await h.service.processAiRequest(USER, REQUEST);

    expect(outcome).toEqual({ ok: true, requestId: REQUEST });
    expect(h.requests.claimById).toHaveBeenCalledWith(
      USER,
      REQUEST,
      "email-receipts-ai",
    );
    expect(h.ai.complete).toHaveBeenCalledTimes(1);
    const [, request, feature] = h.ai.complete.mock.calls[0];
    expect(feature).toBe("email_receipt_review");
    expect(request.responseFormat).toBe("json");
    const content = request.messages[0].content;
    expect(content).toContain("amount: -15 USD");
    expect(content).toContain("Books");
    expect(content).not.toContain("ann@example.com");
    expect(h.work.submit).toHaveBeenCalledWith(
      USER,
      "email-receipts-ai",
      REQUEST,
      {
        splits: [
          { categoryName: "Books", amount: -12, memo: "Widget" },
          { categoryName: "Shipping", amount: -3 },
        ],
        description: "CARD PURCHASE | Order ABC",
      },
    );
    expect(h.requests.release).not.toHaveBeenCalled();
  });

  it("never applies anything: its only write is the proposal", async () => {
    const h = setup();
    h.ai.complete.mockResolvedValue(reply(answer({ categoryName: "Books" })));
    await h.service.processAiRequest(USER, REQUEST);
    expect(h.receiptRepo.update).not.toHaveBeenCalled();
    expect(h.parserRepo.save).not.toHaveBeenCalled();
  });

  const gaveBack = (h: ReturnType<typeof setup>, reason: string) => {
    expect(h.requests.release).toHaveBeenCalledTimes(1);
    const [userArg, id, key, input] = h.requests.release.mock.calls[0];
    expect([userArg, id, key]).toEqual([USER, REQUEST, "email-receipts-ai"]);
    expect(input.final).toBe(false);
    expect(input.note.length).toBeLessThanOrEqual(300);
    expect(input.note).not.toContain(SECRET_TEXT);
    expect(input.note).not.toContain("ann@example.com");
    expect(reason).toBeTruthy();
    return input.note;
  };

  it("gives the claim back (not final) when the provider fails", async () => {
    const h = setup();
    h.ai.complete.mockRejectedValue(new Error(`boom ${SECRET_TEXT}`));
    const outcome = await h.service.processAiRequest(USER, REQUEST);
    expect(outcome).toEqual({
      ok: false,
      requestId: REQUEST,
      reason: "ai_unavailable",
    });
    gaveBack(h, "ai_unavailable");
    expect(h.work.submit).not.toHaveBeenCalled();
  });

  it.each([
    ["not JSON", "no json here"],
    ["the wrong shape", answer({ splits: "x" })],
    ["an unknown key", answer({ description: "x", amount: 3 })],
    ["an unknown category", answer({ categoryName: "Holidays" })],
    [
      "an unknown split category",
      answer({
        splits: [
          { categoryName: "Holidays", amount: -15 },
          { categoryName: "Books", amount: 0 },
        ],
      }),
    ],
    [
      "both splits and a category",
      answer({
        categoryName: "Books",
        splits: [
          { categoryName: "Books", amount: -15 },
          { categoryName: "Shipping", amount: 0 },
        ],
      }),
    ],
    ["nothing", answer({})],
  ])("gives the claim back when the answer is %s", async (_name, content) => {
    const h = setup();
    h.ai.complete.mockResolvedValue(reply(content));
    const outcome = await h.service.processAiRequest(USER, REQUEST);
    expect(outcome).toMatchObject({ ok: false, reason: "unusable_answer" });
    gaveBack(h, "unusable_answer");
    expect(h.work.submit).not.toHaveBeenCalled();
  });

  it("gives the claim back with the refusal when the card cannot be built", async () => {
    const h = setup();
    h.ai.complete.mockResolvedValue(
      reply(
        answer({
          splits: [
            { categoryName: "Books", amount: -10 },
            { categoryName: "Shipping", amount: -2 },
          ],
        }),
      ),
    );
    h.work.submit.mockRejectedValue(
      new BadRequestException(
        "The split lines add up to -12 but the transaction is -15",
      ),
    );
    const outcome = await h.service.processAiRequest(USER, REQUEST);
    expect(outcome).toMatchObject({ ok: false, reason: "proposal_refused" });
    expect(gaveBack(h, "proposal_refused")).toContain("add up to -12");
  });

  it("gives a transfer back without calling the AI", async () => {
    const h = setup();
    h.transactions.findOne.mockResolvedValue(transaction({ isTransfer: true }));
    const outcome = await h.service.processAiRequest(USER, REQUEST);
    expect(outcome).toMatchObject({
      ok: false,
      reason: "transaction_unreadable",
    });
    expect(h.ai.complete).not.toHaveBeenCalled();
    gaveBack(h, "transaction_unreadable");
  });

  it("gives the request back when the transaction is gone", async () => {
    const h = setup();
    h.transactions.findOne.mockRejectedValue(new NotFoundException("gone"));
    const outcome = await h.service.processAiRequest(USER, REQUEST);
    expect(outcome).toMatchObject({
      ok: false,
      reason: "transaction_unreadable",
    });
    gaveBack(h, "transaction_unreadable");
  });

  it("an unexpected error gives the claim back with a generic note", async () => {
    const h = setup();
    h.ai.complete.mockResolvedValue(reply(answer({ categoryName: "Books" })));
    h.work.submit.mockRejectedValue(new Error(`db exploded: ${SECRET_TEXT}`));
    const outcome = await h.service.processAiRequest(USER, REQUEST);
    expect(outcome).toMatchObject({ ok: false, reason: "request_failed" });
    expect(gaveBack(h, "request_failed")).toBe("The AI request failed.");
  });

  it("a request nobody can claim is reported, and nothing is asked", async () => {
    const h = setup();
    h.requests.claimById.mockResolvedValue(null);
    await expect(
      h.service.processAiRequest(USER, REQUEST),
    ).resolves.toMatchObject({
      ok: false,
      reason: "not_claimable",
    });
    expect(h.ai.complete).not.toHaveBeenCalled();
    expect(h.requests.release).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown request", null],
    ["a request of another kind", requestRow({ kind: "transaction_review" })],
    ["a request with no email", requestRow({ emailReceiptId: null })],
  ])("%s is not a receipt request", async (_name, found) => {
    const h = setup();
    h.requests.getForUser.mockResolvedValue(found);
    await expect(
      h.service.processAiRequest(USER, REQUEST),
    ).resolves.toMatchObject({
      reason: "not_a_receipt_request",
    });
    expect(h.requests.claimById).not.toHaveBeenCalled();
  });

  it("a request whose email is gone is reported without a claim", async () => {
    const h = setup({ receipt: null });
    await expect(
      h.service.processAiRequest(USER, REQUEST),
    ).resolves.toMatchObject({
      reason: "receipt_missing",
    });
    expect(h.requests.claimById).not.toHaveBeenCalled();
  });

  it("does not fail when giving the claim back fails", async () => {
    const h = setup();
    h.ai.complete.mockRejectedValue(new Error("down"));
    h.requests.release.mockRejectedValue(new Error("db down"));
    await expect(
      h.service.processAiRequest(USER, REQUEST),
    ).resolves.toMatchObject({
      reason: "ai_unavailable",
    });
  });
});

describe("buildReviewInput", () => {
  const cats = new Map([
    ["a", "Food: Groceries"],
    ["b", "Books"],
  ]);
  const build = (
    value: unknown,
    amount = -15,
    description: string | null = null,
  ) => buildReviewInput(JSON.stringify(value), cats, amount, description);

  it("spells a category as the list does, whatever case the model used", () => {
    expect(build({ categoryName: " food: groceries " })).toEqual({
      ok: true,
      input: { categoryName: "Food: Groceries" },
    });
  });

  it("turns a single line that equals the transaction into its category", () => {
    expect(
      build({ splits: [{ categoryName: "Books", amount: -15, memo: "x" }] }),
    ).toEqual({ ok: true, input: { categoryName: "Books" } });
  });

  it("refuses a single line that does not equal the transaction", () => {
    expect(
      build({ splits: [{ categoryName: "Books", amount: -10 }] }),
    ).toMatchObject({ ok: false });
  });

  it("rounds amounts to the cent, strips tags from text, and appends the description", () => {
    expect(
      build(
        {
          splits: [
            { categoryName: "Books", amount: -9.999999, memo: "<b>Hi</b>" },
            { categoryName: "Books", amount: -5.000001 },
          ],
          description: "  Order   <i>7</i> ",
        },
        -15,
        "CARD",
      ),
    ).toEqual({
      ok: true,
      input: {
        splits: [
          { categoryName: "Books", amount: -10, memo: "bHi/b" },
          { categoryName: "Books", amount: -5 },
        ],
        description: "CARD | Order i7/i",
      },
    });
  });

  it("proposes no description the transaction already carries", () => {
    expect(
      build({ description: "Order 7" }, -15, "CARD | Order 7"),
    ).toMatchObject({ ok: false });
  });

  it("treats an empty splits list as absent", () => {
    expect(build({ splits: [], categoryName: "Books" })).toEqual({
      ok: true,
      input: { categoryName: "Books" },
    });
  });
});

describe("EmailReceiptAiService.runAutomaticStep", () => {
  const draftRows = (ids: string[]) => ids.map((id) => ({ id }));

  const stepSetup = (opts: { drafts: string[]; requests: string[] }) => {
    const h = setup({ aiMode: "automatic" });
    h.manager.query.mockImplementation(
      async (sql: string, params: unknown[]) => {
        const text = String(sql);
        if (text.includes("FROM email_receipts r")) {
          return draftRows(opts.drafts.slice(0, Number(params[1])));
        }
        if (text.includes("FROM ai_review_requests")) {
          return draftRows(opts.requests.slice(0, Number(params[1])));
        }
        return [];
      },
    );
    h.ai.complete.mockImplementation(async (_u, request) =>
      reply(
        request.systemPrompt.includes("extraction")
          ? JSON.stringify(validDefinition)
          : JSON.stringify({ categoryName: "Books" }),
      ),
    );
    h.requests.getForUser.mockImplementation(async (_u, id) =>
      requestRow({ id }),
    );
    return h;
  };

  it("does at most 2 drafts and 5 AI calls in all, drafts first", async () => {
    const h = stepSetup({
      drafts: ["r1", "r2", "r3", "r4"],
      requests: ["q1", "q2", "q3", "q4", "q5", "q6", "q7"],
    });
    const result = await h.service.runAutomaticStep(USER);

    expect(AUTOMATIC_DRAFTS_PER_TICK).toBe(2);
    expect(AUTOMATIC_AI_CALLS_PER_TICK).toBe(5);
    expect(result).toEqual({ proposed: 3, failed: 0, drafted: 2 });
    expect(h.ai.complete).toHaveBeenCalledTimes(5);
    const features = h.ai.complete.mock.calls.map((c) => c[2]);
    expect(features).toEqual([
      "email_receipt_parser",
      "email_receipt_parser",
      "email_receipt_review",
      "email_receipt_review",
      "email_receipt_review",
    ]);
  });

  it("asks the database for unclaimed, never-tried pending requests and one receipt per uncovered domain", async () => {
    const h = stepSetup({ drafts: [], requests: [] });
    await h.service.runAutomaticStep(USER);
    const sqls = h.manager.query.mock.calls.map((c) => String(c[0]));
    const drafts = sqls.find((s) =>
      s.includes("DISTINCT ON (r.from_domain)"),
    ) as string;
    expect(drafts).toContain("r.status = 'no_parser'");
    expect(drafts).toContain("email_receipt_parsers p");
    expect(drafts).toContain("status_reason = 'draft_failed'");
    const pending = sqls.find((s) =>
      s.includes("kind = 'email_receipt'"),
    ) as string;
    expect(pending).toContain("status = 'pending'");
    expect(pending).toContain("claimed_by IS NULL");
    expect(pending).toContain("proposal IS NULL");
    expect(pending).toContain("expires_at > CURRENT_TIMESTAMP");
  });

  it("a failed draft is marked so the poll does not retry it, and the step goes on", async () => {
    const h = stepSetup({ drafts: ["r1"], requests: ["q1"] });
    h.ai.complete.mockImplementation(async (_u, request) =>
      request.systemPrompt.includes("extraction")
        ? reply("no json")
        : reply(JSON.stringify({ categoryName: "Books" })),
    );
    const result = await h.service.runAutomaticStep(USER);
    expect(result).toEqual({ proposed: 1, failed: 0, drafted: 0 });
    const mark = h.manager.query.mock.calls.find((c) =>
      String(c[0]).includes("SET status_reason = 'draft_failed'"),
    );
    expect(mark?.[1]).toEqual(["r1", USER]);
  });

  it("counts a request the AI could not answer as failed", async () => {
    const h = stepSetup({ drafts: [], requests: ["q1"] });
    h.ai.complete.mockRejectedValue(new Error("down"));
    await expect(h.service.runAutomaticStep(USER)).resolves.toEqual({
      proposed: 0,
      failed: 1,
      drafted: 0,
    });
  });
});
