import "reflect-metadata";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { ROUTE_ARGS_METADATA } from "@nestjs/common/constants";
import { ParseUUIDPipe } from "@nestjs/common";
import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { AiReviewRequestsController } from "./ai-review-requests.controller";
import { ListAiReviewRequestsDto } from "./dto/list-ai-review-requests.dto";
import { ReopenAiReviewBatchDto } from "./dto/reopen-ai-review-batch.dto";
import { ALLOW_DELEGATE_KEY } from "../delegation/decorators/delegate-access.decorator";

describe("AiReviewRequestsController", () => {
  const req = { user: { id: "user-1" } };
  const work = {
    listInbox: jest.fn(),
    dismiss: jest.fn(),
    reopenOne: jest.fn(),
    reopenMany: jest.fn(),
  };
  const controller = new AiReviewRequestsController(work as never);
  const proto = AiReviewRequestsController.prototype;

  beforeEach(() => jest.clearAllMocks());

  it("lists the JWT user's requests with the query's filters", async () => {
    work.listInbox.mockResolvedValue([{ id: "r1" }]);

    const result = await controller.list(req, {
      status: "proposed",
      limit: 10,
    });

    expect(work.listInbox).toHaveBeenCalledWith("user-1", {
      status: "proposed",
      limit: 10,
    });
    expect(result).toEqual([{ id: "r1" }]);
  });

  it("dismisses for the JWT user", async () => {
    work.dismiss.mockResolvedValue({ id: "r1", status: "rejected" });
    await controller.dismiss(req, "r1");
    expect(work.dismiss).toHaveBeenCalledWith("user-1", "r1");
  });

  it("reopens one request for the JWT user", async () => {
    const summary = {
      results: [{ id: "r1", outcome: "reopened" }],
      reopened: 1,
    };
    work.reopenOne.mockResolvedValue(summary);
    await expect(controller.reopen(req, "r1")).resolves.toBe(summary);
    expect(work.reopenOne).toHaveBeenCalledWith("user-1", "r1");
  });

  it("reopens a batch for the JWT user by ids, or by the preset", async () => {
    work.reopenMany.mockResolvedValue({ results: [], reopened: 0 });
    await controller.reopenBatch(req, { ids: ["a", "b"] });
    expect(work.reopenMany).toHaveBeenLastCalledWith("user-1", {
      ids: ["a", "b"],
      preset: undefined,
    });
    await controller.reopenBatch(req, { preset: "provider_timeout" });
    expect(work.reopenMany).toHaveBeenLastCalledWith("user-1", {
      ids: undefined,
      preset: "provider_timeout",
    });
  });

  it.each(["dismiss", "reopen"])(
    "parses the :id param of %s as a UUID",
    (route) => {
      const meta = Reflect.getMetadata(
        ROUTE_ARGS_METADATA,
        AiReviewRequestsController,
        route,
      ) as Record<string, { data?: string; pipes: unknown[] }>;
      const param = Object.values(meta).find((m) => m.data === "id");
      expect(param?.pipes).toContain(ParseUUIDPipe);
    },
  );

  it("is under the JWT guard and refuses a delegate session on every route", () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, AiReviewRequestsController),
    ).toHaveLength(1);
    expect(
      Reflect.getMetadata(ALLOW_DELEGATE_KEY, AiReviewRequestsController),
    ).toBe(false);
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === "constructor") continue;
      expect(
        Reflect.getMetadata(ALLOW_DELEGATE_KEY, (proto as never)[name]),
      ).not.toBe(true);
    }
  });

  describe("ListAiReviewRequestsDto", () => {
    const check = async (plain: Record<string, unknown>) =>
      validate(plainToInstance(ListAiReviewRequestsDto, plain), {
        whitelist: true,
        forbidNonWhitelisted: true,
      });

    it("accepts a known status and a bounded limit given as a query string", async () => {
      expect(await check({ status: "expired", limit: "200" })).toEqual([]);
      expect(await check({})).toEqual([]);
    });

    it.each([
      [{ status: "bogus" }],
      [{ limit: "0" }],
      [{ limit: "201" }],
      [{ limit: "1.5" }],
      [{ userId: "someone-else" }],
    ])("refuses %j", async (plain) => {
      expect((await check(plain)).length).toBeGreaterThan(0);
    });
  });

  describe("ReopenAiReviewBatchDto", () => {
    const check = async (plain: Record<string, unknown>) =>
      validate(plainToInstance(ReopenAiReviewBatchDto, plain), {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
    const uuid = (n: number) =>
      `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

    it("accepts a list of ids, or the preset", async () => {
      expect(await check({ ids: [uuid(1), uuid(2)] })).toEqual([]);
      expect(await check({ preset: "provider_timeout" })).toEqual([]);
      expect(
        await check({
          ids: Array.from({ length: 500 }, (_, i) => uuid(i + 1)),
        }),
      ).toEqual([]);
    });

    it.each([
      ["neither", {}],
      ["an empty list", { ids: [] }],
      [
        "more than 500 ids",
        { ids: Array.from({ length: 501 }, (_, i) => uuid(i + 1)) },
      ],
      ["an id that is not a uuid", { ids: ["nope"] }],
      ["ids that are not an array", { ids: uuid(1) }],
      ["an unknown preset", { preset: "everything" }],
      [
        "a field that is not allowed",
        { preset: "provider_timeout", userId: "x" },
      ],
    ])("refuses %s", async (_name, plain) => {
      expect((await check(plain)).length).toBeGreaterThan(0);
    });
  });

  it("is guarded as the rest of the controller: the two new routes are POSTs", () => {
    for (const route of ["reopen", "reopenBatch"]) {
      expect(Reflect.getMetadata("method", (proto as never)[route])).toBe(1); // RequestMethod.POST
    }
  });
});
