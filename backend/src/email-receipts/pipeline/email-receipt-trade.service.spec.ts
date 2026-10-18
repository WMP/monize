import { NotFoundException } from "@nestjs/common";
import type { PendingAiAction } from "../../ai/actions/ai-action.types";
import { AiReviewRequest } from "../../ai-review/ai-review-request.entity";
import type { AiReviewRequestsService } from "../../ai-review/ai-review-requests.service";
import type { AiReviewWorkService } from "../../ai-review/ai-review-work.service";
import { EMAIL_RECEIPTS_CLAIM_KEY } from "../../ai-review/ai-review-work.types";
import { EmailReceiptParser } from "../entities/email-receipt-parser.entity";
import { EmailReceipt } from "../entities/email-receipt.entity";
import {
  WEALTHSIMPLE_BUY_BODY,
  WEALTHSIMPLE_RRSP_ACCOUNT_ID,
  WEALTHSIMPLE_TRADE_DEFINITION,
} from "../parsing/fixtures/wealthsimple-trade";
import { normalizeReceiptLines } from "../parsing/receipt-lines";
import type { ReceiptTradeDefinition } from "../parsing/receipt-parser.types";
import {
  EmailReceiptTradeService,
  RECEIPT_TRADE_EXISTS_REASON,
} from "./email-receipt-trade.service";
import { RECEIPT_TRADE_INSTRUCTION } from "./receipt-instructions";

const USER = "user-1";
const definition =
  WEALTHSIMPLE_TRADE_DEFINITION.trade as ReceiptTradeDefinition;

const receipt = (over: Partial<EmailReceipt> = {}): EmailReceipt =>
  Object.assign(new EmailReceipt(), {
    id: "receipt-1",
    userId: USER,
    subject: "Your order has been filled",
    receivedAt: new Date("2026-10-15T16:10:19Z"),
    originalSentAt: null,
    ...over,
  });

const parser = (status: "approved" | "draft" = "approved") =>
  Object.assign(new EmailReceiptParser(), { id: "parser-1", status });

const card = {
  actionId: "action-1",
  type: "create_investment_transaction",
  signature: "sig",
} as unknown as PendingAiAction;

function setup(
  over: {
    /** A matching ledger row: `unclaimed` no email accounts for, `claimed` another email does. */
    booked?: "unclaimed" | "claimed";
    enqueue?: AiReviewRequest | null;
    timezone?: string;
  } = {},
) {
  const manager = {
    query: jest.fn(async (sql: string, ..._params: unknown[]) => {
      if (String(sql).includes("FROM investment_transactions")) {
        return over.booked
          ? [{ id: "it-1", claimed: over.booked === "claimed" }]
          : [];
      }
      if (String(sql).includes("FROM user_preferences")) {
        return over.timezone
          ? [{ timezone: over.timezone, last_client_timezone: null }]
          : [];
      }
      // closeReceiptRequests
      return [[], 0];
    }),
  };
  const requests = {
    enqueueTrade: jest.fn(async () =>
      over.enqueue === undefined
        ? Object.assign(new AiReviewRequest(), { id: "rq-trade" })
        : over.enqueue,
    ),
    release: jest.fn(async (..._args: unknown[]) => null),
  };
  const work = {
    submitTrade: jest.fn(async (..._args: unknown[]) => ({
      request: {},
      action: card,
    })),
  };
  const service = new EmailReceiptTradeService(
    requests as unknown as AiReviewRequestsService,
    work as unknown as AiReviewWorkService,
  );
  return { service, manager, requests, work };
}

const run = (
  h: ReturnType<typeof setup>,
  body = WEALTHSIMPLE_BUY_BODY,
  context: { autoApply?: boolean; status?: "approved" | "draft" } = {},
) =>
  h.service.process(h.manager as never, USER, receipt(), {
    parser: parser(context.status),
    definition,
    lines: normalizeReceiptLines(body),
    mailboxAutoApply: context.autoApply ?? false,
  });

describe("EmailReceiptTradeService.process", () => {
  it("proposes the trade the email reports, as the executed total, and writes no ledger row", async () => {
    const h = setup();
    const outcome = await run(h);
    expect(h.requests.enqueueTrade).toHaveBeenCalledWith(h.manager, USER, {
      emailReceiptId: "receipt-1",
      instruction: RECEIPT_TRADE_INSTRUCTION,
      claimedBy: EMAIL_RECEIPTS_CLAIM_KEY,
    });
    expect(h.work.submitTrade).toHaveBeenCalledWith(
      USER,
      EMAIL_RECEIPTS_CLAIM_KEY,
      "rq-trade",
      {
        accountId: WEALTHSIMPLE_RRSP_ACCOUNT_ID,
        action: "BUY",
        symbol: "XCNS",
        quantity: 75.9878,
        totalAmount: 2000,
        commission: 0,
        date: "2026-10-15",
        description: "Email receipt: Your order has been filled",
        currency: null,
      },
    );
    expect(outcome).toMatchObject({
      status: "review",
      reason: null,
      requestId: "rq-trade",
      investmentTransactionId: null,
      autoApply: null,
    });
  });

  it("closes the email's earlier requests before queueing the new one", async () => {
    const h = setup();
    await run(h);
    const closed = h.manager.query.mock.calls.findIndex(([sql]) =>
      String(sql).includes("SET status = 'rejected'"),
    );
    expect(closed).toBeGreaterThanOrEqual(0);
    expect(h.manager.query.mock.calls[closed][1]).toContain("superseded");
    expect(h.manager.query.mock.invocationCallOrder[closed]).toBeLessThan(
      h.requests.enqueueTrade.mock.invocationCallOrder[0],
    );
  });

  it("dates the trade from the email when the profile reads no date", async () => {
    const h = setup();
    const noDate = { ...definition, date: undefined };
    await h.service.process(h.manager as never, USER, receipt(), {
      parser: parser(),
      definition: noDate,
      lines: normalizeReceiptLines(WEALTHSIMPLE_BUY_BODY),
      mailboxAutoApply: false,
    });
    expect(h.work.submitTrade.mock.calls[0][3]).toMatchObject({
      date: "2026-10-15",
    });
  });

  it("dates an undated trade by the day it was sent in the user's timezone, not the UTC day", async () => {
    // 01:30 UTC on the 16th is the evening of the 15th in Toronto.
    const h = setup({ timezone: "America/Toronto" });
    const noDate = { ...definition, date: undefined };
    await h.service.process(
      h.manager as never,
      USER,
      receipt({ receivedAt: new Date("2026-10-16T01:30:00Z") }),
      {
        parser: parser(),
        definition: noDate,
        lines: normalizeReceiptLines(WEALTHSIMPLE_BUY_BODY),
        mailboxAutoApply: false,
      },
    );
    expect(h.work.submitTrade.mock.calls[0][3]).toMatchObject({
      date: "2026-10-15",
    });
  });

  it("derives the total from the price when the email states only a price", async () => {
    const h = setup();
    const priceOnly = { ...definition, total: undefined };
    await h.service.process(h.manager as never, USER, receipt(), {
      parser: parser(),
      definition: priceOnly,
      lines: normalizeReceiptLines(WEALTHSIMPLE_BUY_BODY),
      mailboxAutoApply: true,
    });
    // 75.9878 shares at the written price 26.32: what the price implies, to the
    // ledger's four decimals, not the executed total the email did not state.
    expect(h.work.submitTrade.mock.calls[0][3]).toMatchObject({
      totalAmount: 1999.9989,
    });
  });

  it("stores an incomplete reading as parse_failed with its reason and queues nothing", async () => {
    const h = setup();
    const outcome = await run(
      h,
      WEALTHSIMPLE_BUY_BODY.replace("Symbol: XCNS", "Ticker: XCNS"),
    );
    expect(outcome).toMatchObject({
      status: "parse_failed",
      reason: "trade_no_symbol",
      requestId: null,
    });
    expect(h.requests.enqueueTrade).not.toHaveBeenCalled();
    expect(h.manager.query).not.toHaveBeenCalled();
  });

  it("ignores a trade the ledger already holds instead of proposing it twice, and accounts for that row", async () => {
    const h = setup({ booked: "unclaimed" });
    const outcome = await run(h);
    expect(outcome).toMatchObject({
      status: "ignored",
      reason: RECEIPT_TRADE_EXISTS_REASON,
      requestId: null,
      investmentTransactionId: "it-1",
    });
    expect(h.requests.enqueueTrade).not.toHaveBeenCalled();
    const [sql, params] = h.manager.query.mock.calls.find(([text]) =>
      String(text).includes("FROM investment_transactions"),
    ) as [string, unknown[]];
    expect(sql).toContain("it.status != 'VOID'");
    expect(sql).toContain("r.investment_transaction_id = it.id");
    expect(params).toEqual([
      USER,
      WEALTHSIMPLE_RRSP_ACCOUNT_ID,
      "BUY",
      "2026-10-15",
      "75.9878",
      "XCNS",
      "XCNS.%",
      "receipt-1",
      null,
    ]);
  });

  it("proposes a second identical fill whose twin another email accounts for, but never auto-applies it", async () => {
    const h = setup({ booked: "claimed" });
    const outcome = await run(h, WEALTHSIMPLE_BUY_BODY, { autoApply: true });
    expect(outcome).toMatchObject({ status: "review", requestId: "rq-trade" });
    expect(outcome.trade.consistent).toBe(true);
    expect(outcome.autoApply).toBeNull();
  });

  it("is a conflict, not a second proposal, when the email already has one open", async () => {
    const h = setup({ enqueue: null });
    const outcome = await run(h);
    expect(outcome).toMatchObject({
      status: "review_conflict",
      requestId: null,
    });
    expect(h.work.submitTrade).not.toHaveBeenCalled();
  });

  it("keeps the request, rejected with the reason, when the card is refused", async () => {
    const h = setup();
    h.work.submitTrade.mockRejectedValueOnce(
      new NotFoundException("You have no security with the ticker XCNS"),
    );
    const outcome = await run(h);
    expect(h.requests.release).toHaveBeenCalledWith(
      USER,
      "rq-trade",
      EMAIL_RECEIPTS_CLAIM_KEY,
      { final: true, note: "You have no security with the ticker XCNS" },
    );
    expect(outcome).toMatchObject({
      status: "review",
      reason: "proposal_refused",
      requestId: "rq-trade",
      autoApply: null,
    });
  });

  it("does not hide a failure of our own as a refusal", async () => {
    const h = setup();
    h.work.submitTrade.mockRejectedValueOnce(new Error("connection lost"));
    await expect(run(h)).rejects.toThrow("connection lost");
    expect(h.requests.release).not.toHaveBeenCalled();
  });

  describe("the opt-in auto-apply gate", () => {
    it("passes the card on only for an opted-in mailbox, an approved profile and a cross-checked price", async () => {
      const h = setup();
      const outcome = await run(h, WEALTHSIMPLE_BUY_BODY, { autoApply: true });
      expect(outcome.trade.consistent).toBe(true);
      expect(outcome.autoApply).toBe(card);
    });

    it.each([
      [
        "the mailbox did not opt in",
        { autoApply: false },
        WEALTHSIMPLE_BUY_BODY,
      ],
      [
        "the profile is only a draft",
        { autoApply: true, status: "draft" as const },
        WEALTHSIMPLE_BUY_BODY,
      ],
      [
        "the email states no price to cross-check",
        { autoApply: true },
        WEALTHSIMPLE_BUY_BODY.replace("Average price: $26.32\n", ""),
      ],
      [
        "the price disagrees with the total",
        { autoApply: true },
        WEALTHSIMPLE_BUY_BODY.replace("$26.32", "$31.00"),
      ],
    ])("holds the card for a person when %s", async (_why, context, body) => {
      const h = setup();
      const outcome = await run(h, body, context);
      expect(outcome.status).toBe("review");
      expect(outcome.autoApply).toBeNull();
    });
  });
});
