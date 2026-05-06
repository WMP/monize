import { Test, TestingModule } from "@nestjs/testing";
import { NetWorthController } from "./net-worth.controller";
import { NetWorthService } from "./net-worth.service";

describe("NetWorthController", () => {
  let controller: NetWorthController;
  let mockNetWorthService: Partial<Record<keyof NetWorthService, jest.Mock>>;
  const mockReq = { user: { id: "user-1" } };

  beforeEach(async () => {
    mockNetWorthService = {
      getMonthlyNetWorth: jest.fn(),
      getMonthlyInvestments: jest.fn(),
      getDailyInvestments: jest.fn(),
      recalculateAllAccounts: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NetWorthController],
      providers: [
        {
          provide: NetWorthService,
          useValue: mockNetWorthService,
        },
      ],
    }).compile();

    controller = module.get<NetWorthController>(NetWorthController);
  });

  describe("getMonthlyNetWorth()", () => {
    it("delegates to netWorthService.getMonthlyNetWorth with userId and date range", () => {
      mockNetWorthService.getMonthlyNetWorth!.mockReturnValue("netWorth");

      const result = controller.getMonthlyNetWorth(
        mockReq,
        "2024-01-01",
        "2024-12-31",
      );

      expect(result).toBe("netWorth");
      expect(mockNetWorthService.getMonthlyNetWorth).toHaveBeenCalledWith(
        "user-1",
        "2024-01-01",
        "2024-12-31",
      );
    });

    it("passes undefined when no dates provided", () => {
      mockNetWorthService.getMonthlyNetWorth!.mockReturnValue("netWorth");

      controller.getMonthlyNetWorth(mockReq, undefined, undefined);

      expect(mockNetWorthService.getMonthlyNetWorth).toHaveBeenCalledWith(
        "user-1",
        undefined,
        undefined,
      );
    });
  });

  describe("getMonthlyInvestments()", () => {
    it("delegates to netWorthService.getMonthlyInvestments with userId, dates, and parsed accountIds", () => {
      mockNetWorthService.getMonthlyInvestments!.mockReturnValue("investments");

      const result = controller.getMonthlyInvestments(
        mockReq,
        "2024-01-01",
        "2024-12-31",
        "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d,b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
        undefined,
      );

      expect(result).toBe("investments");
      expect(mockNetWorthService.getMonthlyInvestments).toHaveBeenCalledWith(
        "user-1",
        "2024-01-01",
        "2024-12-31",
        [
          "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
          "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
        ],
        undefined,
      );
    });

    it("passes undefined accountIds when not provided", () => {
      mockNetWorthService.getMonthlyInvestments!.mockReturnValue("investments");

      controller.getMonthlyInvestments(
        mockReq,
        "2024-01-01",
        "2024-12-31",
        undefined,
        undefined,
      );

      expect(mockNetWorthService.getMonthlyInvestments).toHaveBeenCalledWith(
        "user-1",
        "2024-01-01",
        "2024-12-31",
        undefined,
        undefined,
      );
    });
  });

  describe("getDailyInvestments()", () => {
    it("delegates to netWorthService.getDailyInvestments with userId, dates, and parsed accountIds", () => {
      mockNetWorthService.getDailyInvestments!.mockReturnValue("daily");

      const result = controller.getDailyInvestments(
        mockReq,
        "2025-02-01",
        "2025-03-04",
        "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
        "USD",
      );

      expect(result).toBe("daily");
      expect(mockNetWorthService.getDailyInvestments).toHaveBeenCalledWith(
        "user-1",
        "2025-02-01",
        "2025-03-04",
        ["a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"],
        "USD",
      );
    });

    it("passes undefined accountIds when not provided", () => {
      mockNetWorthService.getDailyInvestments!.mockReturnValue("daily");

      controller.getDailyInvestments(
        mockReq,
        "2025-02-01",
        "2025-03-04",
        undefined,
        undefined,
      );

      expect(mockNetWorthService.getDailyInvestments).toHaveBeenCalledWith(
        "user-1",
        "2025-02-01",
        "2025-03-04",
        undefined,
        undefined,
      );
    });

    it("throws BadRequestException for invalid startDate format", () => {
      expect(() =>
        controller.getDailyInvestments(
          mockReq,
          "invalid",
          undefined,
          undefined,
          undefined,
        ),
      ).toThrow("startDate must be YYYY-MM-DD");
    });

    it("throws BadRequestException for invalid accountIds", () => {
      expect(() =>
        controller.getDailyInvestments(
          mockReq,
          "2025-01-01",
          "2025-03-04",
          "not-a-uuid",
          undefined,
        ),
      ).toThrow("accountIds must be comma-separated UUIDs");
    });
  });

  describe("recalculate()", () => {
    it("delegates to netWorthService.recalculateAllAccounts and returns success", async () => {
      mockNetWorthService.recalculateAllAccounts!.mockResolvedValue(undefined);

      const result = await controller.recalculate(mockReq);

      expect(result).toEqual({ success: true });
      expect(mockNetWorthService.recalculateAllAccounts).toHaveBeenCalledWith(
        "user-1",
      );
    });
  });

  // ─── Branch coverage extras ───────────────────────────────────────────

  describe("getMonthlyNetWorth date validation", () => {
    it("throws on invalid startDate format", () => {
      expect(() =>
        controller.getMonthlyNetWorth(mockReq, "not-a-date"),
      ).toThrow(/startDate/);
    });
    it("throws on invalid endDate format", () => {
      expect(() =>
        controller.getMonthlyNetWorth(mockReq, "2024-01-01", "bad"),
      ).toThrow(/endDate/);
    });
  });

  describe("getMonthlyInvestments edge cases", () => {
    it("uppercases and slices currency to 3 chars", () => {
      mockNetWorthService.getMonthlyInvestments!.mockReturnValue("ok");
      controller.getMonthlyInvestments(
        mockReq,
        undefined,
        undefined,
        undefined,
        "usdextra",
      );
      expect(
        mockNetWorthService.getMonthlyInvestments,
      ).toHaveBeenCalledWith(
        "user-1",
        undefined,
        undefined,
        undefined,
        "USD",
      );
    });

    it("throws on invalid endDate", () => {
      expect(() =>
        controller.getMonthlyInvestments(mockReq, undefined, "bad-date"),
      ).toThrow(/endDate/);
    });

    it("throws on invalid startDate", () => {
      expect(() =>
        controller.getMonthlyInvestments(mockReq, "x"),
      ).toThrow(/startDate/);
    });

    it("throws when accountIds contains a non-UUID", () => {
      expect(() =>
        controller.getMonthlyInvestments(
          mockReq,
          undefined,
          undefined,
          "not-a-uuid",
        ),
      ).toThrow(/UUID/);
    });
  });

  describe("getDailyInvestments edge cases", () => {
    it("uppercases and slices currency to 3 chars", () => {
      mockNetWorthService.getDailyInvestments!.mockReturnValue("ok");
      controller.getDailyInvestments(
        mockReq,
        undefined,
        undefined,
        undefined,
        "eurmixed",
      );
      expect(mockNetWorthService.getDailyInvestments).toHaveBeenCalledWith(
        "user-1",
        undefined,
        undefined,
        undefined,
        "EUR",
      );
    });

    it("throws on invalid endDate", () => {
      expect(() =>
        controller.getDailyInvestments(mockReq, undefined, "bad-date"),
      ).toThrow(/endDate/);
    });
  });
});
