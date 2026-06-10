import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { PayeeOrganizerService } from "./payee-organizer.service";
import { AiService } from "../ai.service";
import { PayeesService } from "../../payees/payees.service";
import { CategoriesService } from "../../categories/categories.service";
import { PayeeMergeRejection } from "../../payees/entities/payee-merge-rejection.entity";

describe("PayeeOrganizerService", () => {
  let service: PayeeOrganizerService;
  let mockAiService: Partial<Record<keyof AiService, jest.Mock>>;
  let mockPayeesService: Partial<Record<keyof PayeesService, jest.Mock>>;
  let mockCategoriesService: Partial<
    Record<keyof CategoriesService, jest.Mock>
  >;
  let mockRejectionRepo: Record<string, jest.Mock>;
  let insertExecute: jest.Mock;
  let insertedRows: unknown;

  const userId = "user-1";

  const payees = [
    { payeeId: "p-amazon", payeeName: "Amazon", sampleDescriptions: [] },
    { payeeId: "p-amzn", payeeName: "AMZN", sampleDescriptions: [] },
    { payeeId: "p-shell", payeeName: "Shell", sampleDescriptions: ["fuel"] },
  ];

  // Active payees (id/name only) used by the duplicate-clustering merge path.
  // Includes name variants that must cluster together, plus a categorized
  // payee that the uncategorized slice would never surface.
  const activePayees = [
    { id: "p-amazon", name: "Amazon" },
    { id: "p-amzn", name: "AMZN" },
    { id: "p-shell", name: "Shell" },
    { id: "p-lidl", name: "Lidl" },
    { id: "p-lidl-caps", name: "LIDL" },
    { id: "p-lidl-wawa", name: "Lidl Warszawa" },
  ];

  const categories = [
    { id: "cat-shopping", name: "Shopping", parentName: null, isIncome: false },
    { id: "cat-gas", name: "Gas", parentName: null, isIncome: false },
  ];

  function aiContent(obj: unknown): { content: string; model: string } {
    return { content: JSON.stringify(obj), model: "test-model" };
  }

  beforeEach(async () => {
    mockAiService = { complete: jest.fn() };
    mockPayeesService = {
      findUncategorizedActiveWithSamples: jest.fn().mockResolvedValue(payees),
      findActivePayees: jest.fn().mockResolvedValue(activePayees),
      // By default every payee is uncategorized and has no extra samples.
      findActiveUncategorizedIds: jest
        .fn()
        .mockImplementation((_uid: string) =>
          Promise.resolve(new Set(activePayees.map((p) => p.id))),
        ),
      findSamplesForPayees: jest
        .fn()
        .mockResolvedValue(new Map<string, string[]>()),
      applyCategorySuggestions: jest.fn().mockResolvedValue({ updated: 0 }),
      mergePayees: jest.fn().mockResolvedValue({
        transactionsMigrated: 1,
        aliasAdded: true,
        sourcePayeeDeleted: true,
      }),
    };
    mockCategoriesService = {
      getLlmCategories: jest.fn().mockResolvedValue({ categories }),
      create: jest.fn(),
    };
    // findOwnedIds defaults to "everything passed in is owned".
    (mockPayeesService as Record<string, jest.Mock>).findOwnedIds = jest
      .fn()
      .mockImplementation((_uid: string, ids: string[]) =>
        Promise.resolve(new Set(ids)),
      );

    insertedRows = undefined;
    // Default: no rows actually inserted; tests override per case.
    insertExecute = jest.fn().mockResolvedValue({ identifiers: [] });
    const insertBuilder = {
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockImplementation((rows: unknown) => {
        insertedRows = rows;
        return insertBuilder;
      }),
      orIgnore: jest.fn().mockReturnThis(),
      execute: insertExecute,
    };
    mockRejectionRepo = {
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn().mockReturnValue(insertBuilder),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayeeOrganizerService,
        { provide: AiService, useValue: mockAiService },
        { provide: PayeesService, useValue: mockPayeesService },
        { provide: CategoriesService, useValue: mockCategoriesService },
        {
          provide: getRepositoryToken(PayeeMergeRejection),
          useValue: mockRejectionRepo,
        },
      ],
    }).compile();

    service = module.get<PayeeOrganizerService>(PayeeOrganizerService);
  });

  describe("suggest", () => {
    it("returns empty result without calling the LLM when nothing to analyse", async () => {
      // No uncategorized payees AND no duplicate candidate clusters.
      (
        mockPayeesService.findUncategorizedActiveWithSamples as jest.Mock
      ).mockResolvedValue([]);
      (mockPayeesService.findActivePayees as jest.Mock).mockResolvedValue([
        { id: "p-solo", name: "Solo Merchant" },
      ]);

      const result = await service.suggest(userId, {
        allowNewCategories: true,
      });

      expect(result).toEqual({
        categorySuggestions: [],
        mergeGroups: [],
        groups: [],
        model: "none",
        mergeCandidateClustersRemaining: 0,
      });
      expect(mockAiService.complete).not.toHaveBeenCalled();
    });

    it("in merge mode skips categories entirely and returns no category suggestions", async () => {
      (mockAiService.complete as jest.Mock).mockResolvedValue(
        aiContent({
          // Even if the model returns category suggestions, merge mode discards them.
          categorySuggestions: [
            { payeeId: "p-lidl", categoryId: "cat-shopping", isNew: false },
          ],
          mergeGroups: [
            {
              canonicalPayeeId: "p-lidl",
              duplicates: [{ payeeId: "p-lidl-caps", name: "LIDL" }],
              reason: "Same merchant",
            },
          ],
        }),
      );

      const result = await service.suggest(userId, {
        allowNewCategories: false,
        mode: "merge",
      });

      expect(
        mockPayeesService.findUncategorizedActiveWithSamples,
      ).not.toHaveBeenCalled();
      expect(mockCategoriesService.getLlmCategories).not.toHaveBeenCalled();
      expect(result.categorySuggestions).toEqual([]);
      expect(result.mergeGroups).toHaveLength(1);
    });

    it("passes minTransactions through to the uncategorized-payee finder", async () => {
      (mockAiService.complete as jest.Mock).mockResolvedValue(
        aiContent({ categorySuggestions: [], mergeGroups: [] }),
      );

      await service.suggest(userId, {
        allowNewCategories: false,
        minTransactions: 5,
      });

      expect(
        mockPayeesService.findUncategorizedActiveWithSamples,
      ).toHaveBeenCalledWith(userId, expect.any(Number), expect.any(Number), 5);
    });

    it("keeps valid category suggestions and resolves names from owned categories", async () => {
      (mockAiService.complete as jest.Mock).mockResolvedValue(
        aiContent({
          categorySuggestions: [
            {
              payeeId: "p-amazon",
              categoryId: "cat-shopping",
              categoryName: "WRONG NAME FROM LLM",
              isNew: false,
            },
          ],
          mergeGroups: [],
        }),
      );

      const result = await service.suggest(userId, {
        allowNewCategories: false,
      });

      expect(result.categorySuggestions).toEqual([
        {
          payeeId: "p-amazon",
          payeeName: "Amazon",
          categoryId: "cat-shopping",
          categoryName: "Shopping", // taken from owned category, not the LLM
          isNew: false,
          sampleDescriptions: [],
        },
      ]);
      expect(result.model).toBe("test-model");
    });

    it("drops hallucinated category ids and unknown payee ids", async () => {
      (mockAiService.complete as jest.Mock).mockResolvedValue(
        aiContent({
          categorySuggestions: [
            {
              payeeId: "p-amazon",
              categoryId: "cat-does-not-exist",
              categoryName: "Ghost",
              isNew: false,
            },
            {
              payeeId: "p-not-in-set",
              categoryId: "cat-shopping",
              categoryName: "Shopping",
              isNew: false,
            },
          ],
          mergeGroups: [],
        }),
      );

      const result = await service.suggest(userId, {
        allowNewCategories: false,
      });

      expect(result.categorySuggestions).toEqual([]);
    });

    it("drops new-category proposals when allowNewCategories is false", async () => {
      (mockAiService.complete as jest.Mock).mockResolvedValue(
        aiContent({
          categorySuggestions: [
            {
              payeeId: "p-shell",
              categoryId: null,
              categoryName: "Fuel",
              isNew: true,
            },
          ],
          mergeGroups: [],
        }),
      );

      const result = await service.suggest(userId, {
        allowNewCategories: false,
      });

      expect(result.categorySuggestions).toEqual([]);
    });

    it("keeps new-category proposals when allowNewCategories is true", async () => {
      (mockAiService.complete as jest.Mock).mockResolvedValue(
        aiContent({
          categorySuggestions: [
            {
              payeeId: "p-shell",
              categoryId: null,
              categoryName: "Fuel",
              isNew: true,
            },
          ],
          mergeGroups: [],
        }),
      );

      const result = await service.suggest(userId, {
        allowNewCategories: true,
      });

      expect(result.categorySuggestions).toEqual([
        {
          payeeId: "p-shell",
          payeeName: "Shell",
          categoryId: null,
          categoryName: "Fuel",
          isNew: true,
          sampleDescriptions: ["fuel"],
        },
      ]);
    });

    it("clusters name variants into one candidate group fed to the AI", async () => {
      (mockAiService.complete as jest.Mock).mockResolvedValue(
        aiContent({ categorySuggestions: [], mergeGroups: [] }),
      );

      await service.suggest(userId, { allowNewCategories: false });

      const prompt = (mockAiService.complete as jest.Mock).mock.calls[0][1]
        .messages[0].content as string;
      // All three Lidl variants must appear in a single candidate group line.
      const groupLines = prompt
        .split("\n")
        .filter((l) => l.startsWith("group "));
      const lidlLine = groupLines.find((l) => l.includes("p-lidl-wawa"));
      expect(lidlLine).toBeDefined();
      expect(lidlLine).toContain("p-lidl");
      expect(lidlLine).toContain("p-lidl-caps");
      expect(lidlLine).toContain("p-lidl-wawa");
    });

    it("considers CATEGORIZED payees for merge via findActivePayees", async () => {
      // p-lidl is not in the uncategorized slice; it only exists in the active
      // list. The AI may still confirm it as a merge.
      (mockAiService.complete as jest.Mock).mockResolvedValue(
        aiContent({
          categorySuggestions: [],
          mergeGroups: [
            {
              canonicalPayeeId: "p-lidl",
              duplicates: [
                { payeeId: "p-lidl-caps", name: "LIDL" },
                { payeeId: "p-lidl-wawa", name: "Lidl Warszawa" },
              ],
              reason: "Same merchant",
            },
          ],
        }),
      );

      const result = await service.suggest(userId, {
        allowNewCategories: false,
      });

      expect(mockPayeesService.findActivePayees).toHaveBeenCalledWith(userId);
      expect(result.mergeGroups).toEqual([
        {
          canonicalPayeeId: "p-lidl",
          canonicalName: "Lidl",
          duplicates: [
            { payeeId: "p-lidl-caps", name: "LIDL" },
            { payeeId: "p-lidl-wawa", name: "Lidl Warszawa" },
          ],
          reason: "Same merchant",
        },
      ]);
    });

    it("caps analysed candidate clusters by limit and reports the remainder", async () => {
      // Two distinct clusters (lidl + tesco). limit=1 analyses only one and
      // reports one remaining.
      (mockPayeesService.findActivePayees as jest.Mock).mockResolvedValue([
        { id: "p-lidl", name: "Lidl" },
        { id: "p-lidl2", name: "LIDL sklep" },
        { id: "p-tesco", name: "Tesco" },
        { id: "p-tesco2", name: "TESCO" },
      ]);
      (mockAiService.complete as jest.Mock).mockResolvedValue(
        aiContent({ categorySuggestions: [], mergeGroups: [] }),
      );

      const result = await service.suggest(userId, {
        allowNewCategories: false,
        mode: "merge",
        limit: 1,
      });

      const prompt = (mockAiService.complete as jest.Mock).mock.calls[0][1]
        .messages[0].content as string;
      const groupLines = prompt
        .split("\n")
        .filter((l) => l.startsWith("group "));
      expect(groupLines).toHaveLength(1);
      expect(result.mergeCandidateClustersRemaining).toBe(1);
    });

    it("validates merge groups and drops unknown duplicate ids", async () => {
      (mockAiService.complete as jest.Mock).mockResolvedValue(
        aiContent({
          categorySuggestions: [],
          mergeGroups: [
            {
              canonicalPayeeId: "p-lidl",
              duplicates: [
                { payeeId: "p-lidl-caps", name: "LIDL" },
                { payeeId: "p-ghost", name: "Ghost" },
              ],
              reason: "Same merchant",
            },
          ],
        }),
      );

      const result = await service.suggest(userId, {
        allowNewCategories: false,
      });

      expect(result.mergeGroups).toEqual([
        {
          canonicalPayeeId: "p-lidl",
          canonicalName: "Lidl",
          duplicates: [{ payeeId: "p-lidl-caps", name: "LIDL" }],
          reason: "Same merchant",
        },
      ]);
    });

    it("drops merge groups with no valid duplicates", async () => {
      (mockAiService.complete as jest.Mock).mockResolvedValue(
        aiContent({
          categorySuggestions: [],
          mergeGroups: [
            {
              canonicalPayeeId: "p-lidl",
              duplicates: [{ payeeId: "p-ghost", name: "Ghost" }],
              reason: "x",
            },
          ],
        }),
      );

      const result = await service.suggest(userId, {
        allowNewCategories: false,
      });

      expect(result.mergeGroups).toEqual([]);
    });

    it("excludes a rejected pair from the candidate clusters sent to the AI", async () => {
      // A two-member cluster whose only pair was rejected drops below 2 and so
      // is never offered to the AI as a candidate.
      (mockPayeesService.findActivePayees as jest.Mock).mockResolvedValue([
        { id: "p-lidl", name: "Lidl" },
        { id: "p-lidl-caps", name: "LIDL" },
      ]);
      mockRejectionRepo.find.mockResolvedValue([
        { payeeIdLow: "p-lidl", payeeIdHigh: "p-lidl-caps" },
      ]);
      (mockAiService.complete as jest.Mock).mockResolvedValue(
        aiContent({ categorySuggestions: [], mergeGroups: [] }),
      );

      const result = await service.suggest(userId, {
        allowNewCategories: false,
        mode: "merge",
      });

      // No candidate clusters survived -> the LLM is never called.
      expect(mockAiService.complete).not.toHaveBeenCalled();
      expect(result.mergeGroups).toEqual([]);
      expect(result.model).toBe("none");
    });

    it("rejected pairs match regardless of stored order (high/low swapped)", async () => {
      // Pair stored as low=p-lidl high=p-lidl-caps; the cluster builds the pair
      // in the other direction. Normalization must still drop it.
      (mockPayeesService.findActivePayees as jest.Mock).mockResolvedValue([
        { id: "p-lidl-caps", name: "LIDL" },
        { id: "p-lidl", name: "Lidl" },
      ]);
      mockRejectionRepo.find.mockResolvedValue([
        { payeeIdLow: "p-lidl", payeeIdHigh: "p-lidl-caps" },
      ]);
      (mockAiService.complete as jest.Mock).mockResolvedValue(
        aiContent({ categorySuggestions: [], mergeGroups: [] }),
      );

      const result = await service.suggest(userId, {
        allowNewCategories: false,
        mode: "merge",
      });

      expect(mockAiService.complete).not.toHaveBeenCalled();
      expect(result.mergeGroups).toEqual([]);
    });

    it("prunes only the rejected member, keeping the rest of the cluster", async () => {
      // Three Lidl variants; the p-lidl/p-lidl-caps pair is rejected. Pruning
      // drops one member but the cluster still has >= 2, so it reaches the AI.
      (mockPayeesService.findActivePayees as jest.Mock).mockResolvedValue([
        { id: "p-lidl", name: "Lidl" },
        { id: "p-lidl-caps", name: "LIDL" },
        { id: "p-lidl-wawa", name: "Lidl Warszawa" },
      ]);
      mockRejectionRepo.find.mockResolvedValue([
        { payeeIdLow: "p-lidl", payeeIdHigh: "p-lidl-caps" },
      ]);
      (mockAiService.complete as jest.Mock).mockImplementation(
        (_uid: string, req: { messages: Array<{ content: string }> }) => {
          // Echo back whichever cluster members survived into a merge group.
          const prompt = req.messages[0].content;
          // Match the exact payeeId token (avoid p-lidl matching p-lidl-caps).
          const survivors = ["p-lidl", "p-lidl-caps", "p-lidl-wawa"].filter(
            (id) => prompt.includes(`payeeId=${id},`),
          );
          return Promise.resolve(
            aiContent({
              categorySuggestions: [],
              mergeGroups: [
                {
                  canonicalPayeeId: survivors[0],
                  duplicates: survivors
                    .slice(1)
                    .map((id) => ({ payeeId: id, name: id })),
                  reason: "Same merchant",
                },
              ],
            }),
          );
        },
      );

      const result = await service.suggest(userId, {
        allowNewCategories: false,
        mode: "merge",
      });

      // Exactly one of the rejected pair's members was pruned; p-lidl-wawa and
      // one of {p-lidl, p-lidl-caps} survive.
      const surviving = new Set<string>([
        result.mergeGroups[0].canonicalPayeeId,
        ...result.mergeGroups[0].duplicates.map((d) => d.payeeId),
      ]);
      expect(surviving.has("p-lidl-wawa")).toBe(true);
      expect(surviving.has("p-lidl") && surviving.has("p-lidl-caps")).toBe(
        false,
      );
      expect(surviving.size).toBe(2);
    });

    it("tolerates markdown-fenced JSON", async () => {
      (mockAiService.complete as jest.Mock).mockResolvedValue({
        model: "test-model",
        content:
          '```json\n{"categorySuggestions":[{"payeeId":"p-amazon","categoryId":"cat-shopping","categoryName":"Shopping","isNew":false}],"mergeGroups":[]}\n```',
      });

      const result = await service.suggest(userId, {
        allowNewCategories: false,
      });

      expect(result.categorySuggestions).toHaveLength(1);
    });

    it("returns empty arrays when JSON cannot be parsed", async () => {
      (mockAiService.complete as jest.Mock).mockResolvedValue({
        model: "test-model",
        content: "the model refused to answer",
      });

      const result = await service.suggest(userId, {
        allowNewCategories: true,
      });

      expect(result.categorySuggestions).toEqual([]);
      expect(result.mergeGroups).toEqual([]);
      // Survivors still surface as singleton groups, just with no AI category.
      expect(result.groups.every((g) => g.category === null)).toBe(true);
    });
  });

  describe("suggest groups", () => {
    it("combines a confirmed cluster and standalone singletons into groups", async () => {
      // Only Lidl variants and Shell exist; the AI confirms the Lidl cluster
      // and categorizes the canonical Lidl plus the standalone Shell.
      (mockPayeesService.findActivePayees as jest.Mock).mockResolvedValue([
        { id: "p-lidl", name: "Lidl" },
        { id: "p-lidl-caps", name: "LIDL" },
        { id: "p-shell", name: "Shell" },
      ]);
      (
        mockPayeesService.findUncategorizedActiveWithSamples as jest.Mock
      ).mockResolvedValue([
        {
          payeeId: "p-lidl",
          payeeName: "Lidl",
          sampleDescriptions: ["lidl x"],
        },
        {
          payeeId: "p-shell",
          payeeName: "Shell",
          sampleDescriptions: ["fuel"],
        },
      ]);
      (mockAiService.complete as jest.Mock).mockResolvedValue(
        aiContent({
          categorySuggestions: [
            {
              payeeId: "p-lidl",
              categoryId: "cat-shopping",
              categoryName: "Shopping",
              isNew: false,
            },
            {
              payeeId: "p-shell",
              categoryId: "cat-gas",
              categoryName: "Gas",
              isNew: false,
            },
          ],
          mergeGroups: [
            {
              canonicalPayeeId: "p-lidl",
              duplicates: [{ payeeId: "p-lidl-caps", name: "LIDL" }],
              reason: "Same merchant",
            },
          ],
        }),
      );

      const result = await service.suggest(userId, {
        allowNewCategories: false,
      });

      const cluster = result.groups.find((g) => g.isCluster);
      const singleton = result.groups.find(
        (g) => !g.isCluster && g.groupId === "p-shell",
      );

      // The cluster group carries both members and the canonical's category.
      expect(cluster).toBeDefined();
      expect(cluster!.groupId).toBe("p-lidl");
      expect(cluster!.suggestedCanonicalPayeeId).toBe("p-lidl");
      expect(cluster!.mergeReason).toBe("Same merchant");
      expect(cluster!.members.map((m) => m.payeeId).sort()).toEqual([
        "p-lidl",
        "p-lidl-caps",
      ]);
      expect(cluster!.category).toEqual({
        categoryId: "cat-shopping",
        categoryName: "Shopping",
        isNew: false,
      });

      // The standalone Shell is a singleton group with its own category.
      expect(singleton).toBeDefined();
      expect(singleton!.members).toHaveLength(1);
      expect(singleton!.category).toEqual({
        categoryId: "cat-gas",
        categoryName: "Gas",
        isNew: false,
      });

      // Cluster members are never emitted as separate singleton groups.
      expect(
        result.groups.filter((g) => g.groupId === "p-lidl-caps"),
      ).toHaveLength(0);
    });

    it("attaches the cluster canonical's category even when it was not in the base slice", async () => {
      // The canonical Lidl is NOT in the uncategorized slice, but it is an
      // uncategorized cluster member, so it is augmented in and categorized.
      (mockPayeesService.findActivePayees as jest.Mock).mockResolvedValue([
        { id: "p-lidl", name: "Lidl" },
        { id: "p-lidl-caps", name: "LIDL" },
      ]);
      (
        mockPayeesService.findUncategorizedActiveWithSamples as jest.Mock
      ).mockResolvedValue([]);
      (
        mockPayeesService.findActiveUncategorizedIds as jest.Mock
      ).mockResolvedValue(new Set(["p-lidl", "p-lidl-caps"]));
      (mockPayeesService.findSamplesForPayees as jest.Mock).mockResolvedValue(
        new Map([["p-lidl", ["lidl receipt"]]]),
      );
      (mockAiService.complete as jest.Mock).mockResolvedValue(
        aiContent({
          categorySuggestions: [
            {
              payeeId: "p-lidl",
              categoryId: "cat-shopping",
              categoryName: "Shopping",
              isNew: false,
            },
          ],
          mergeGroups: [
            {
              canonicalPayeeId: "p-lidl",
              duplicates: [{ payeeId: "p-lidl-caps", name: "LIDL" }],
              reason: "Same merchant",
            },
          ],
        }),
      );

      const result = await service.suggest(userId, {
        allowNewCategories: false,
      });

      expect(result.groups).toHaveLength(1);
      const cluster = result.groups[0];
      expect(cluster.isCluster).toBe(true);
      expect(cluster.category).toEqual({
        categoryId: "cat-shopping",
        categoryName: "Shopping",
        isNew: false,
      });
      // The augmented member's samples surface on the canonical member.
      const canonical = cluster.members.find((m) => m.payeeId === "p-lidl");
      expect(canonical!.sampleDescriptions).toEqual(["lidl receipt"]);
    });
  });

  describe("apply", () => {
    it("creates new categories de-duplicated by name and assigns them", async () => {
      (mockCategoriesService.create as jest.Mock).mockResolvedValue({
        id: "cat-new-fuel",
        name: "Fuel",
      });
      (
        mockPayeesService.applyCategorySuggestions as jest.Mock
      ).mockResolvedValue({ updated: 2 });

      const result = await service.apply(userId, {
        categoryAssignments: [
          { payeeId: "p-shell", newCategoryName: "Fuel" },
          { payeeId: "p-bp", newCategoryName: "fuel" }, // same name, different case
          { payeeId: "p-amazon", categoryId: "cat-shopping" },
        ],
        merges: [],
      });

      // Only one category created despite two "Fuel" requests
      expect(mockCategoriesService.create).toHaveBeenCalledTimes(1);
      expect(mockCategoriesService.create).toHaveBeenCalledWith(userId, {
        name: "Fuel",
      });

      // Assignments resolve new + existing ids
      expect(mockPayeesService.applyCategorySuggestions).toHaveBeenCalledWith(
        userId,
        [
          { payeeId: "p-shell", categoryId: "cat-new-fuel" },
          { payeeId: "p-bp", categoryId: "cat-new-fuel" },
          { payeeId: "p-amazon", categoryId: "cat-shopping" },
        ],
      );

      expect(result.categoriesCreated).toBe(1);
      expect(result.payeesCategorized).toBe(2);
    });

    it("merges each source payee into the target once", async () => {
      const result = await service.apply(userId, {
        categoryAssignments: [],
        merges: [
          {
            targetPayeeId: "p-amazon",
            sourcePayeeIds: ["p-amzn", "p-amzn2", "p-amzn"], // dup id ignored
          },
        ],
      });

      expect(mockPayeesService.mergePayees).toHaveBeenCalledTimes(2);
      expect(mockPayeesService.mergePayees).toHaveBeenCalledWith(userId, {
        targetPayeeId: "p-amazon",
        sourcePayeeId: "p-amzn",
        addAsAlias: true,
      });
      expect(mockPayeesService.mergePayees).toHaveBeenCalledWith(userId, {
        targetPayeeId: "p-amazon",
        sourcePayeeId: "p-amzn2",
        addAsAlias: true,
      });
      expect(result.payeesMerged).toBe(2);
    });

    it("skips merging a payee into itself", async () => {
      const result = await service.apply(userId, {
        categoryAssignments: [],
        merges: [{ targetPayeeId: "p-amazon", sourcePayeeIds: ["p-amazon"] }],
      });

      expect(mockPayeesService.mergePayees).not.toHaveBeenCalled();
      expect(result.payeesMerged).toBe(0);
    });

    it("does not call applyCategorySuggestions when nothing resolves", async () => {
      const result = await service.apply(userId, {
        categoryAssignments: [{ payeeId: "p-shell" }], // no categoryId, no newName
        merges: [],
      });

      expect(mockPayeesService.applyCategorySuggestions).not.toHaveBeenCalled();
      expect(result.payeesCategorized).toBe(0);
      expect(result.categoriesCreated).toBe(0);
      expect(result.mergeRejectionsSaved).toBe(0);
    });

    it("persists normalized rejection rows and counts inserts", async () => {
      // The insert reports one identifier per row actually written.
      insertExecute.mockResolvedValue({
        identifiers: [{ id: "r1" }, { id: "r2" }],
      });

      const result = await service.apply(userId, {
        categoryAssignments: [],
        merges: [],
        rejectedMerges: [
          {
            // p-amzn > p-amazon, so the pair normalizes to low=p-amazon.
            canonicalPayeeId: "p-amzn",
            duplicatePayeeIds: ["p-amazon", "p-shell"],
          },
        ],
      });

      // Ownership was checked for every referenced id.
      expect(
        (mockPayeesService as Record<string, jest.Mock>).findOwnedIds,
      ).toHaveBeenCalledWith(
        userId,
        expect.arrayContaining(["p-amzn", "p-amazon", "p-shell"]),
      );

      // Rows are stored normalized (low < high) with the userId attached.
      expect(insertedRows).toEqual(
        expect.arrayContaining([
          { userId, payeeIdLow: "p-amazon", payeeIdHigh: "p-amzn" },
          { userId, payeeIdLow: "p-amzn", payeeIdHigh: "p-shell" },
        ]),
      );
      expect(result.mergeRejectionsSaved).toBe(2);
    });

    it("skips rejection pairs that reference an unowned payee", async () => {
      (
        mockPayeesService as Record<string, jest.Mock>
      ).findOwnedIds.mockResolvedValue(new Set(["p-amazon"]));

      const result = await service.apply(userId, {
        categoryAssignments: [],
        merges: [],
        rejectedMerges: [
          { canonicalPayeeId: "p-amazon", duplicatePayeeIds: ["p-forged"] },
        ],
      });

      // No owned pair -> never attempts an insert.
      expect(mockRejectionRepo.createQueryBuilder).not.toHaveBeenCalled();
      expect(result.mergeRejectionsSaved).toBe(0);
    });
  });
});
