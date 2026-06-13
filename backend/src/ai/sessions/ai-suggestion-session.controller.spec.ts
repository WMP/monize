import { Test, TestingModule } from "@nestjs/testing";
import { AiSuggestionSessionController } from "./ai-suggestion-session.controller";
import { AiSuggestionSessionService } from "./ai-suggestion-session.service";

describe("AiSuggestionSessionController", () => {
  let controller: AiSuggestionSessionController;
  let service: Record<string, jest.Mock>;
  const req = { user: { id: "user-1" } };

  beforeEach(async () => {
    service = {
      listSessions: jest.fn().mockResolvedValue([]),
      getSession: jest.fn().mockResolvedValue({ id: "s1" }),
      applySession: jest
        .fn()
        .mockResolvedValue({ categoriesCreated: 1, payeesCategorized: 2 }),
      discardSession: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AiSuggestionSessionController],
      providers: [
        { provide: AiSuggestionSessionService, useValue: service },
      ],
    }).compile();

    controller = module.get<AiSuggestionSessionController>(
      AiSuggestionSessionController,
    );
  });

  it("is defined", () => {
    expect(controller).toBeDefined();
  });

  it("listSessions passes userId and filters through", async () => {
    await controller.listSessions(req, {
      kind: "payee_categorization",
      status: "draft",
    });
    expect(service.listSessions).toHaveBeenCalledWith("user-1", {
      kind: "payee_categorization",
      status: "draft",
    });
  });

  it("getSession passes userId and id", async () => {
    await controller.getSession(req, "s1");
    expect(service.getSession).toHaveBeenCalledWith("user-1", "s1");
  });

  it("applySession forwards the items body", async () => {
    const items = [{ payeeId: "p1", categoryId: "c1" }];
    const result = await controller.applySession(req, "s1", { items });
    expect(service.applySession).toHaveBeenCalledWith("user-1", "s1", { items });
    expect(result).toEqual({ categoriesCreated: 1, payeesCategorized: 2 });
  });

  it("discardSession passes userId and id", async () => {
    await controller.discardSession(req, "s1");
    expect(service.discardSession).toHaveBeenCalledWith("user-1", "s1");
  });
});
