import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { DataSource } from "typeorm";
import { AiSuggestionSessionService } from "./ai-suggestion-session.service";
import { AiSuggestionSession } from "./entities/ai-suggestion-session.entity";
import { Category } from "../../categories/entities/category.entity";
import { PayeesService } from "../../payees/payees.service";
import { CategoriesService } from "../../categories/categories.service";

describe("AiSuggestionSessionService", () => {
  let service: AiSuggestionSessionService;
  let sessionsRepository: Record<string, jest.Mock>;
  let payeesService: Record<string, jest.Mock>;
  let categoriesService: Record<string, jest.Mock>;
  let queryRunnerManager: Record<string, jest.Mock>;
  let queryRunner: Record<string, jest.Mock | Record<string, jest.Mock>>;

  const userId = "user-1";

  beforeEach(async () => {
    sessionsRepository = {
      create: jest.fn().mockImplementation((data) => ({ id: "sess-new", ...data })),
      save: jest.fn().mockImplementation((data) => ({ id: data.id ?? "sess-new", ...data })),
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
    };

    queryRunnerManager = {
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation((_e, data) => ({ id: "cat-new", ...data })),
      save: jest.fn().mockImplementation((data) => ({ id: data.id ?? "cat-new", ...data })),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    queryRunner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      manager: queryRunnerManager,
    };

    payeesService = {
      findOwnedIds: jest.fn().mockResolvedValue(new Set(["payee-1", "payee-2"])),
      getNamesByIds: jest
        .fn()
        .mockResolvedValue(new Map([["payee-1", "Starbucks"]])),
      getRecentDescriptionsByPayee: jest
        .fn()
        .mockResolvedValue(new Map([["payee-1", ["COFFEE STARBUCKS #123"]]])),
    };

    categoriesService = {
      findAll: jest.fn().mockResolvedValue([
        { id: "cat-1", name: "Food", parentId: null, isIncome: false },
        { id: "cat-2", name: "Travel", parentId: null, isIncome: false },
      ]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiSuggestionSessionService,
        {
          provide: getRepositoryToken(AiSuggestionSession),
          useValue: sessionsRepository,
        },
        {
          provide: DataSource,
          useValue: { createQueryRunner: jest.fn().mockReturnValue(queryRunner) },
        },
        { provide: PayeesService, useValue: payeesService },
        { provide: CategoriesService, useValue: categoriesService },
      ],
    }).compile();

    service = module.get<AiSuggestionSessionService>(AiSuggestionSessionService);
  });

  it("is defined", () => {
    expect(service).toBeDefined();
  });

  describe("savePayeeCategorySuggestions", () => {
    it("creates a draft session with normalized items", async () => {
      const result = await service.savePayeeCategorySuggestions(userId, {
        title: "  My draft  ",
        suggestions: [
          { payeeId: "payee-1", categoryId: "cat-1", reason: " good ", confidence: 0.9 },
          { payeeId: "payee-2", newCategoryName: "  New Cat  " },
        ],
      });

      expect(result).toEqual({ sessionId: "sess-new", savedCount: 2 });
      const created = sessionsRepository.create.mock.calls[0][0];
      expect(created.kind).toBe("payee_categorization");
      expect(created.status).toBe("draft");
      expect(created.title).toBe("My draft");
      expect(created.items[0]).toEqual({
        payeeId: "payee-1",
        suggestedCategoryId: "cat-1",
        newCategoryName: null,
        reason: "good",
        confidence: 0.9,
      });
      expect(created.items[1].newCategoryName).toBe("New Cat");
      expect(created.items[1].suggestedCategoryId).toBeNull();
    });

    it("rejects when a suggestion has neither category nor new name", async () => {
      await expect(
        service.savePayeeCategorySuggestions(userId, {
          suggestions: [{ payeeId: "payee-1" }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects when a suggestion has both category and new name", async () => {
      await expect(
        service.savePayeeCategorySuggestions(userId, {
          suggestions: [
            { payeeId: "payee-1", categoryId: "cat-1", newCategoryName: "X" },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects when no suggestions are provided", async () => {
      await expect(
        service.savePayeeCategorySuggestions(userId, { suggestions: [] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects when a payee is not owned by the user", async () => {
      payeesService.findOwnedIds.mockResolvedValue(new Set(["payee-1"]));
      await expect(
        service.savePayeeCategorySuggestions(userId, {
          suggestions: [{ payeeId: "payee-9", categoryId: "cat-1" }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects when a referenced category is not owned by the user", async () => {
      await expect(
        service.savePayeeCategorySuggestions(userId, {
          suggestions: [{ payeeId: "payee-1", categoryId: "cat-missing" }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("replaces items of an existing owned draft when sessionId is given", async () => {
      sessionsRepository.findOne.mockResolvedValue({
        id: "sess-1",
        userId,
        kind: "payee_categorization",
        status: "applied",
        title: "old",
        items: [],
      });
      const result = await service.savePayeeCategorySuggestions(userId, {
        sessionId: "sess-1",
        suggestions: [{ payeeId: "payee-1", categoryId: "cat-1" }],
      });
      expect(result.sessionId).toBe("sess-1");
      const saved = sessionsRepository.save.mock.calls[0][0];
      expect(saved.status).toBe("draft");
      expect(saved.items).toHaveLength(1);
    });

    it("throws NotFound when replacing a session the user does not own", async () => {
      sessionsRepository.findOne.mockResolvedValue(null);
      await expect(
        service.savePayeeCategorySuggestions(userId, {
          sessionId: "missing",
          suggestions: [{ payeeId: "payee-1", categoryId: "cat-1" }],
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("listSessions", () => {
    it("maps sessions and applies kind/status filters", async () => {
      sessionsRepository.find.mockResolvedValue([
        {
          id: "s1",
          kind: "payee_categorization",
          status: "draft",
          title: "t",
          items: [{ payeeId: "p1" }, { payeeId: "p2" }],
          createdAt: new Date("2026-01-01"),
          updatedAt: new Date("2026-01-02"),
        },
      ]);
      const result = await service.listSessions(userId, {
        kind: "payee_categorization",
        status: "draft",
      });
      expect(sessionsRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId, kind: "payee_categorization", status: "draft" },
        }),
      );
      expect(result[0].itemCount).toBe(2);
    });
  });

  describe("getSession", () => {
    it("enriches items with names and sample descriptions", async () => {
      sessionsRepository.findOne.mockResolvedValue({
        id: "sess-1",
        userId,
        kind: "payee_categorization",
        status: "draft",
        title: "t",
        items: [
          {
            payeeId: "payee-1",
            suggestedCategoryId: "cat-1",
            newCategoryName: null,
            reason: "coffee",
            confidence: 0.8,
          },
          {
            payeeId: "payee-2",
            suggestedCategoryId: null,
            newCategoryName: "Brand New",
            reason: null,
            confidence: null,
          },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.getSession(userId, "sess-1");
      expect(result.items[0].payeeName).toBe("Starbucks");
      expect(result.items[0].suggestedCategoryName).toBe("Food");
      expect(result.items[0].sampleDescriptions).toEqual([
        "COFFEE STARBUCKS #123",
      ]);
      // New-category item surfaces the proposed name as the suggested name.
      expect(result.items[1].suggestedCategoryName).toBe("Brand New");
    });

    it("throws NotFound when the session is not owned", async () => {
      sessionsRepository.findOne.mockResolvedValue(null);
      await expect(service.getSession(userId, "x")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe("applySession", () => {
    beforeEach(() => {
      sessionsRepository.findOne.mockResolvedValue({
        id: "sess-1",
        userId,
        kind: "payee_categorization",
        status: "draft",
        title: "t",
        items: [],
      });
    });

    it("creates new categories and sets payee defaults in a transaction", async () => {
      const result = await service.applySession(userId, "sess-1", {
        items: [
          { payeeId: "payee-1", categoryId: "cat-1" },
          { payeeId: "payee-2", newCategoryName: "Coffee Shops" },
        ],
      });

      expect(result.categoriesCreated).toBe(1);
      expect(result.payeesCategorized).toBe(2);
      // category created via the transaction manager
      expect(queryRunnerManager.create).toHaveBeenCalledWith(
        Category,
        expect.objectContaining({ name: "Coffee Shops", userId, isIncome: false }),
      );
      // payee defaults set via the transaction manager
      expect(queryRunnerManager.update).toHaveBeenCalledWith(
        "payees",
        expect.objectContaining({ id: "payee-1", userId }),
        expect.objectContaining({ defaultCategoryId: "cat-1" }),
      );
      // session marked applied + committed
      const savedSession = queryRunnerManager.save.mock.calls.find(
        (c) => c[0]?.id === "sess-1",
      );
      expect(savedSession?.[0].status).toBe("applied");
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalled();
    });

    it("dedupes a new category name against an existing category", async () => {
      queryRunnerManager.find.mockResolvedValue([
        { id: "cat-existing", name: "Coffee Shops" },
      ]);
      const result = await service.applySession(userId, "sess-1", {
        items: [{ payeeId: "payee-1", newCategoryName: "coffee shops" }],
      });
      expect(result.categoriesCreated).toBe(0);
      expect(queryRunnerManager.update).toHaveBeenCalledWith(
        "payees",
        expect.objectContaining({ id: "payee-1" }),
        expect.objectContaining({ defaultCategoryId: "cat-existing" }),
      );
    });

    it("rolls back on failure", async () => {
      queryRunnerManager.update.mockRejectedValue(new Error("DB error"));
      await expect(
        service.applySession(userId, "sess-1", {
          items: [{ payeeId: "payee-1", categoryId: "cat-1" }],
        }),
      ).rejects.toThrow("DB error");
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalled();
    });

    it("rejects unowned payees before opening a transaction", async () => {
      payeesService.findOwnedIds.mockResolvedValue(new Set());
      await expect(
        service.applySession(userId, "sess-1", {
          items: [{ payeeId: "payee-1", categoryId: "cat-1" }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(queryRunner.startTransaction).not.toHaveBeenCalled();
    });

    it("throws NotFound when the session is not owned", async () => {
      sessionsRepository.findOne.mockResolvedValue(null);
      await expect(
        service.applySession(userId, "x", {
          items: [{ payeeId: "payee-1", categoryId: "cat-1" }],
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("discardSession", () => {
    it("sets status to discarded", async () => {
      sessionsRepository.findOne.mockResolvedValue({
        id: "sess-1",
        userId,
        status: "draft",
      });
      await service.discardSession(userId, "sess-1");
      const saved = sessionsRepository.save.mock.calls[0][0];
      expect(saved.status).toBe("discarded");
    });

    it("throws NotFound when the session is not owned", async () => {
      sessionsRepository.findOne.mockResolvedValue(null);
      await expect(service.discardSession(userId, "x")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
